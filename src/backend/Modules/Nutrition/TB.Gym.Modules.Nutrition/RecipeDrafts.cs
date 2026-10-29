using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Nutrition;

/// <summary>
/// A coach's working copy of a recipe in the editor (NUT-014, critique B5d): kept on the server as they
/// type, read back on any device, and turned into a version only by Publish or Save as draft.
/// </summary>
/// <remarks>
/// It follows the program and meal-plan builders' drafts (ADR 0033). It belongs to one Owner or Coach in
/// one workspace and nobody else reads it, the workspace owner included. Its content is what the editor
/// holds mid-edit, so it may break every recipe rule (no name yet, an ingredient still waiting for a food,
/// an amount being typed); only its shape is bounded (<see cref="RecipeDraftShape"/>). A new recipe's
/// draft may carry the AI suggestion it began from, still awaiting the coach's review (ADR 0035). Making a
/// version checks every rule a save has (NUT-002), creates the recipe's next immutable version and removes
/// the draft. A draft never reaches a meal plan or a client.
/// </remarks>
public sealed class RecipeDraft : TenantEntity
{
    /// <summary>How many recipes not saved yet one person keeps in one workspace.</summary>
    public const int MaximumNewRecipesPerOwner = 20;

    private RecipeDraft()
    {
    }

    private RecipeDraft(Guid tenantId, Guid ownerUserId, Guid? recipeId, int startedAtRevision, RecipeDraftShape shape)
        : base(tenantId)
    {
        if (ownerUserId == Guid.Empty)
        {
            throw new ArgumentException("A recipe draft needs its owner.", nameof(ownerUserId));
        }

        if (recipeId == Guid.Empty)
        {
            throw new ArgumentException("A draft of a saved recipe names the recipe.", nameof(recipeId));
        }

        if (recipeId is null ? startedAtRevision != 0 : startedAtRevision < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(startedAtRevision));
        }

        OwnerUserId = ownerUserId;
        RecipeId = recipeId;
        StartedAtRevision = startedAtRevision;
        Replace(shape);
    }

    public Guid OwnerUserId { get; private set; }

    /// <summary>The recipe it changes; null for a recipe not saved yet.</summary>
    public Guid? RecipeId { get; private set; }

    /// <summary>
    /// The recipe's newest revision when this draft began, 0 for a new recipe. A higher revision when a
    /// version is made means someone saved one in between.
    /// </summary>
    public int StartedAtRevision { get; private set; }

    /// <summary>The recipe's name as typed, for the Recipes page; it may be empty.</summary>
    public string Name { get; private set; } = string.Empty;

    public int LineCount { get; private set; }

    /// <summary>
    /// The cover photo the content names, kept beside it so the photo's workspace is enforced and the
    /// unused-photo sweep leaves it alone while a draft names it (MED-014).
    /// </summary>
    public Guid? PhotoMediaAssetId { get; private set; }

    /// <summary>The AI suggestion a new recipe began from, approved when its first version is made (ADR 0035).</summary>
    public Guid? AiMealDraftOperationId { get; private set; }

    public string ContentJson { get; private set; } = "{}";

    public static RecipeDraft ForNewRecipe(Guid tenantId, Guid ownerUserId, RecipeDraftShape shape) =>
        new(tenantId, ownerUserId, null, 0, shape);

    public static RecipeDraft ForRecipe(Guid tenantId, Guid ownerUserId, Guid recipeId, int startedAtRevision, RecipeDraftShape shape) =>
        new(tenantId, ownerUserId, recipeId, startedAtRevision, shape);

    public void Replace(RecipeDraftShape shape)
    {
        ArgumentNullException.ThrowIfNull(shape);
        if (RecipeId is not null && shape.AiMealDraftOperationId is not null)
        {
            throw new ArgumentException("Only a new recipe starts from an AI suggestion.", nameof(shape));
        }

        Name = shape.Name;
        LineCount = shape.LineCount;
        PhotoMediaAssetId = shape.PhotoMediaAssetId;
        AiMealDraftOperationId = shape.AiMealDraftOperationId;
        ContentJson = shape.Json;
    }

    /// <summary>True when a version of the recipe was saved after this draft began.</summary>
    public bool IsBehind(int currentRevision) =>
        RecipeId is not null && currentRevision != StartedAtRevision;
}

/// <summary>
/// The recipe as the editor holds it: its name, servings, ingredient lines, method, photo and times, and
/// the AI suggestion a new one began from. Values are kept as typed, so an amount being typed may be
/// missing and a time may not be whole yet; making a version checks them (NUT-002).
/// </summary>
public sealed record RecipeDraftContent(
    string? Name,
    decimal? Servings,
    string? Instructions,
    IReadOnlyList<RecipeDraftLine>? Lines,
    Guid? PhotoMediaAssetId = null,
    decimal? PrepMinutes = null,
    decimal? CookMinutes = null,
    Guid? AiMealDraftOperationId = null);

/// <summary>
/// One ingredient line: the food version chosen, its amount in that food's own unit (grams cooked when it
/// is weighed cooked through a conversion), and what an AI suggestion said of it.
/// </summary>
/// <param name="FoodItemVersionId">Null while a suggested ingredient waits for the coach to choose a food.</param>
/// <param name="YieldFactorId">With <paramref name="RetentionFactorId"/>, the conversion a raw food is weighed cooked through (NUT-001).</param>
/// <param name="ConvertedRawGrams">
/// The raw grams a converted cooked amount came from, with that cooked amount, while the box still holds
/// it: the editor weighs the line raw again from them, so a round trip never moves the amount.
/// </param>
public sealed record RecipeDraftLine(
    Guid? FoodItemVersionId,
    decimal? Quantity,
    Guid? YieldFactorId = null,
    Guid? RetentionFactorId = null,
    RecipeDraftSuggestion? Suggestion = null,
    decimal? ConvertedRawGrams = null,
    decimal? ConvertedCookedGrams = null);

/// <summary>What an AI suggestion said of an ingredient, kept beside its line (ADR 0035).</summary>
public sealed record RecipeDraftSuggestion(string? Name, decimal? Quantity, string? Unit, bool Uncertain);

/// <summary>
/// A draft's content once its shape is checked: the limits a version has on how many lines it holds and
/// how long its text is, and nothing about the values themselves, which making a version checks (NUT-014).
/// </summary>
public sealed class RecipeDraftShape
{
    /// <summary>The stored content in characters; 500 lines and the longest method take about half of it.</summary>
    public const int MaximumContentLength = 500_000;

    public const int MaximumLines = 500;

    public const int MaximumNameLength = 300;

    public const int MaximumInstructionsLength = 20_000;

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private RecipeDraftShape(string name, int lineCount, Guid? photoMediaAssetId, Guid? aiMealDraftOperationId, string json)
    {
        Name = name;
        LineCount = lineCount;
        PhotoMediaAssetId = photoMediaAssetId;
        AiMealDraftOperationId = aiMealDraftOperationId;
        Json = json;
    }

    public string Name { get; }

    public int LineCount { get; }

    public Guid? PhotoMediaAssetId { get; }

    public Guid? AiMealDraftOperationId { get; }

    public string Json { get; }

    /// <summary>
    /// Checks the shape and keeps the content in one form: every list present and every text as typed.
    /// Returns the field and the reason when the shape is refused.
    /// </summary>
    public static bool TryCreate(
        RecipeDraftContent? content,
        out RecipeDraftShape shape,
        out string field,
        out string problem)
    {
        shape = new RecipeDraftShape(string.Empty, 0, null, null, "{}");
        var (normalized, refusal) = content is null
            ? (null, new Refusal("content", "The recipe is missing."))
            : Normalize(content);
        if (refusal is null && normalized is not null)
        {
            var json = JsonSerializer.Serialize(normalized, JsonOptions);
            if (json.Length <= MaximumContentLength)
            {
                shape = new RecipeDraftShape(
                    normalized.Name!.Trim(),
                    normalized.Lines!.Count,
                    normalized.PhotoMediaAssetId,
                    normalized.AiMealDraftOperationId,
                    json);
                (field, problem) = (string.Empty, string.Empty);
                return true;
            }

            refusal = new Refusal("content", "This recipe is too long to keep as a draft. Shorten the method or the ingredients.");
        }

        (field, problem) = (refusal!.Field, refusal.Problem);
        return false;
    }

    public static RecipeDraftContent Read(string json) =>
        JsonSerializer.Deserialize<RecipeDraftContent>(json, JsonOptions)
        ?? throw new InvalidOperationException("A stored recipe draft could not be read.");

    private static (RecipeDraftContent? Content, Refusal? Refusal) Normalize(RecipeDraftContent content)
    {
        var name = content.Name ?? string.Empty;
        if (Text(name, MaximumNameLength, "name", "A recipe name") is { } nameRefusal)
        {
            return (null, nameRefusal);
        }

        var instructions = content.Instructions ?? string.Empty;
        if (Text(instructions, MaximumInstructionsLength, "instructions", "The method") is { } methodRefusal)
        {
            return (null, methodRefusal);
        }

        if (content.PhotoMediaAssetId == Guid.Empty)
        {
            return (null, new Refusal("photoMediaAssetId", "The recipe's photo is not valid."));
        }

        if (content.AiMealDraftOperationId == Guid.Empty)
        {
            return (null, new Refusal("aiMealDraftOperationId", "The suggestion this recipe started from is not valid."));
        }

        var lines = content.Lines ?? [];
        if (lines.Count > MaximumLines)
        {
            return (null, new Refusal("lines", $"A recipe holds up to {MaximumLines} ingredients."));
        }

        var normalLines = new List<RecipeDraftLine>(lines.Count);
        foreach (var line in lines)
        {
            var (normalLine, refusal) = Normalize(line);
            if (refusal is not null)
            {
                return (null, refusal);
            }

            normalLines.Add(normalLine!);
        }

        return (content with { Name = name, Instructions = instructions, Lines = normalLines }, null);
    }

    private static (RecipeDraftLine? Line, Refusal? Refusal) Normalize(RecipeDraftLine? line)
    {
        if (line is null)
        {
            return (null, new Refusal("lines", "An ingredient is missing."));
        }

        if (line.FoodItemVersionId == Guid.Empty || line.YieldFactorId == Guid.Empty || line.RetentionFactorId == Guid.Empty)
        {
            return (null, new Refusal("lines", "An ingredient's food or cooking conversion is not valid."));
        }

        if (line.Suggestion is { } suggestion &&
            (Text(suggestion.Name ?? string.Empty, MaximumNameLength, "lines", "A suggested ingredient's name") ??
             Text(suggestion.Unit ?? string.Empty, 20, "lines", "A suggested ingredient's unit")) is { } suggestionRefusal)
        {
            return (null, suggestionRefusal);
        }

        return (line, null);
    }

    /// <summary>
    /// Text up to its limit. A NUL character is refused because PostgreSQL cannot store one; any other
    /// character is kept as typed, and making a version trims and checks it as any save does.
    /// </summary>
    private static Refusal? Text(string value, int maximum, string field, string what) =>
        value.Length > maximum
            ? new Refusal(field, $"{what} can be at most {maximum.ToString("N0", CultureInfo.InvariantCulture)} characters.")
            : value.Contains('\0', StringComparison.Ordinal)
                ? new Refusal(field, $"{what} cannot contain a NUL character.")
                : null;

    private sealed record Refusal(string Field, string Problem);
}

public static class RecipeDraftConflictCodes
{
    /// <summary>The caller already has a draft of this recipe, made in another tab or device.</summary>
    public const string AlreadyExists = "recipe_draft_exists";

    public const string LimitReached = "recipe_draft_limit";

    /// <summary>The draft was changed or removed in another tab or device since this one read it.</summary>
    public const string Stale = "recipe_draft_stale";

    /// <summary>Someone saved a version of the recipe after this draft began.</summary>
    public const string NewerVersionSaved = "newer_recipe_version";
}
