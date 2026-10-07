using System.Text.Json;
using System.Text.Json.Serialization;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Nutrition;

/// <summary>
/// A coach's working copy of a meal plan in the builder (NUT-013, R4.4a): kept on the server as they
/// work, read back on any device, and turned into a version only by Publish.
/// </summary>
/// <remarks>
/// It follows the program builder's drafts (ADR 0033). It belongs to one Owner or Coach in one
/// workspace and nobody else reads it, the workspace owner included. Its content is what the builder
/// holds mid-edit, so it may break the meal-plan rules (a day with no meals, a meal with no name);
/// only its shape is bounded (<see cref="MealPlanDraftShape"/>). Publishing checks every rule a
/// version has (NUT-005), creates the next immutable version, published (ADR 0008), and removes the
/// draft. A draft never reaches a client.
/// </remarks>
public sealed class MealPlanDraft : TenantEntity
{
    /// <summary>How many meal plans not published yet one person keeps in one workspace.</summary>
    public const int MaximumNewPlansPerOwner = 20;

    private MealPlanDraft()
    {
    }

    private MealPlanDraft(
        Guid tenantId,
        Guid ownerUserId,
        Guid? mealPlanTemplateId,
        Guid? sourceVersionId,
        int startedAtRevision,
        MealPlanDraftShape shape)
        : base(tenantId)
    {
        if (ownerUserId == Guid.Empty)
        {
            throw new ArgumentException("A meal-plan draft needs its owner.", nameof(ownerUserId));
        }

        if (mealPlanTemplateId == Guid.Empty ||
            sourceVersionId == Guid.Empty ||
            mealPlanTemplateId is null != sourceVersionId is null)
        {
            throw new ArgumentException("A draft of a saved meal plan names the plan and the version it started from.");
        }

        if (mealPlanTemplateId is null ? startedAtRevision != 0 : startedAtRevision < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(startedAtRevision));
        }

        OwnerUserId = ownerUserId;
        MealPlanTemplateId = mealPlanTemplateId;
        SourceVersionId = sourceVersionId;
        StartedAtRevision = startedAtRevision;
        Replace(shape);
    }

    public Guid OwnerUserId { get; private set; }

    /// <summary>The meal plan it changes; null for a plan not published yet.</summary>
    public Guid? MealPlanTemplateId { get; private set; }

    /// <summary>The version its content started from; null for a plan not published yet.</summary>
    public Guid? SourceVersionId { get; private set; }

    /// <summary>
    /// The plan's newest revision when this draft began, 0 for a new plan. A higher revision at
    /// Publish means someone published in between.
    /// </summary>
    public int StartedAtRevision { get; private set; }

    /// <summary>The plan's name as typed, for the meal-plans list; it may be empty.</summary>
    public string Name { get; private set; } = string.Empty;

    public int DayCount { get; private set; }

    public string ContentJson { get; private set; } = "{}";

    public static MealPlanDraft ForNewPlan(Guid tenantId, Guid ownerUserId, MealPlanDraftShape shape) =>
        new(tenantId, ownerUserId, null, null, 0, shape);

    public static MealPlanDraft ForPlan(
        Guid tenantId,
        Guid ownerUserId,
        Guid mealPlanTemplateId,
        Guid sourceVersionId,
        int startedAtRevision,
        MealPlanDraftShape shape) =>
        new(tenantId, ownerUserId, mealPlanTemplateId, sourceVersionId, startedAtRevision, shape);

    public void Replace(MealPlanDraftShape shape)
    {
        ArgumentNullException.ThrowIfNull(shape);
        Name = shape.Name;
        DayCount = shape.DayCount;
        ContentJson = shape.Json;
    }

    /// <summary>True when a version was published after this draft began.</summary>
    public bool IsBehind(int currentRevision) =>
        MealPlanTemplateId is not null && currentRevision != StartedAtRevision;
}

/// <summary>
/// The meal plan as the builder holds it: a name, the daily targets and each day's meals in order.
/// Values are kept as typed, so a target being typed may be missing; Publish checks them.
/// </summary>
public sealed record MealPlanDraftContent(
    string? Name,
    decimal? TargetCalories,
    decimal? TargetProteinGrams,
    decimal? TargetCarbohydrateGrams,
    decimal? TargetFatGrams,
    IReadOnlyList<MealPlanDraftDay>? Days);

/// <summary>One day of the plan; its meals in the order the client sees them.</summary>
public sealed record MealPlanDraftDay(IReadOnlyList<MealPlanDraftMeal>? Meals);

/// <summary>A meal: its name and the recipes the client chooses between, the first one the main one.</summary>
public sealed record MealPlanDraftMeal(string? Name, IReadOnlyList<MealPlanChoiceRequest>? Choices);

/// <summary>
/// A draft's content once its shape is checked: the limits a version has on how many days, meals and
/// choices it holds and how long its text is, and nothing about the values themselves, which Publish
/// checks (NUT-013).
/// </summary>
public sealed class MealPlanDraftShape
{
    /// <summary>The stored content in characters; a year of six meals a day takes about half of it.</summary>
    public const int MaximumContentLength = 2_000_000;

    public const int MaximumDays = 365;

    public const int MaximumMealsPerDay = 30;

    public const int MaximumChoicesPerMeal = 100;

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Converters = { new JsonStringEnumConverter(namingPolicy: null, allowIntegerValues: false) },
    };

    private MealPlanDraftShape(string name, int dayCount, string json)
    {
        Name = name;
        DayCount = dayCount;
        Json = json;
    }

    public string Name { get; }

    public int DayCount { get; }

    public string Json { get; }

    /// <summary>
    /// Checks the shape and keeps the content in one form: every list present and every text as typed.
    /// Returns the field and the reason when the shape is refused.
    /// </summary>
    public static bool TryCreate(
        MealPlanDraftContent? content,
        out MealPlanDraftShape shape,
        out string field,
        out string problem)
    {
        shape = new MealPlanDraftShape(string.Empty, 0, "{}");
        var (normalized, refusal) = content is null
            ? (null, new Refusal("content", "The meal plan is missing."))
            : Normalize(content);
        if (refusal is null && normalized is not null)
        {
            var json = JsonSerializer.Serialize(normalized, JsonOptions);
            if (json.Length <= MaximumContentLength)
            {
                shape = new MealPlanDraftShape(normalized.Name!.Trim(), normalized.Days!.Count, json);
                (field, problem) = (string.Empty, string.Empty);
                return true;
            }

            refusal = new Refusal(
                "content",
                "This meal plan is too long to keep as a draft. Publish it, or split it into two plans.");
        }

        (field, problem) = (refusal!.Field, refusal.Problem);
        return false;
    }

    public static MealPlanDraftContent Read(string json) =>
        JsonSerializer.Deserialize<MealPlanDraftContent>(json, JsonOptions)
        ?? throw new InvalidOperationException("A stored meal-plan draft could not be read.");

    private static (MealPlanDraftContent? Content, Refusal? Refusal) Normalize(MealPlanDraftContent content)
    {
        var name = content.Name ?? string.Empty;
        if (Text(name, 300, "name", "A meal-plan name") is { } nameRefusal)
        {
            return (null, nameRefusal);
        }

        var days = content.Days ?? [];
        if (days.Count is < 1 or > MaximumDays)
        {
            return (null, new Refusal("days", $"A meal plan has 1 to {MaximumDays} days."));
        }

        var normalDays = new List<MealPlanDraftDay>(days.Count);
        foreach (var day in days)
        {
            var meals = day?.Meals ?? [];
            if (meals.Count > MaximumMealsPerDay)
            {
                return (null, new Refusal("meals", $"A day holds at most {MaximumMealsPerDay} meals."));
            }

            var normalMeals = new List<MealPlanDraftMeal>(meals.Count);
            foreach (var meal in meals)
            {
                var (normalMeal, refusal) = Normalize(meal);
                if (refusal is not null)
                {
                    return (null, refusal);
                }

                normalMeals.Add(normalMeal!);
            }

            normalDays.Add(new MealPlanDraftDay(normalMeals));
        }

        return (content with { Name = name, Days = normalDays }, null);
    }

    private static (MealPlanDraftMeal? Meal, Refusal? Refusal) Normalize(MealPlanDraftMeal? meal)
    {
        if (meal is null)
        {
            return (null, new Refusal("meals", "A meal is missing."));
        }

        var name = meal.Name ?? string.Empty;
        if (Text(name, 200, "meals", "A meal name") is { } nameRefusal)
        {
            return (null, nameRefusal);
        }

        var choices = meal.Choices ?? [];
        if (choices.Count > MaximumChoicesPerMeal)
        {
            return (null, new Refusal("choices", $"A meal offers at most {MaximumChoicesPerMeal} recipes."));
        }

        if (choices.Any(choice => choice is null || choice.RecipeVersionId == Guid.Empty))
        {
            return (null, new Refusal("choices", "A recipe in a meal is missing or not valid."));
        }

        return (new MealPlanDraftMeal(name, [.. choices]), null);
    }

    /// <summary>
    /// Text up to its limit. A NUL character is refused because PostgreSQL cannot store one; any
    /// other character is kept as typed, and Publish trims and checks it as any save does.
    /// </summary>
    private static Refusal? Text(string value, int maximum, string field, string what) =>
        value.Length > maximum
            ? new Refusal(field, $"{what} can be at most {maximum} characters.")
            : value.Contains('\0', StringComparison.Ordinal)
                ? new Refusal(field, $"{what} cannot contain a NUL character.")
                : null;

    private sealed record Refusal(string Field, string Problem);
}

public static class MealPlanDraftConflictCodes
{
    /// <summary>The caller already has a draft of this meal plan, made in another tab or device.</summary>
    public const string AlreadyExists = "meal_plan_draft_exists";

    public const string LimitReached = "meal_plan_draft_limit";

    /// <summary>The draft was changed or removed in another tab or device since this one read it.</summary>
    public const string Stale = "meal_plan_draft_stale";

    /// <summary>Someone published a version of the meal plan after this draft began.</summary>
    public const string NewerVersionPublished = "newer_version_published";
}
