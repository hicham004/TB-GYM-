using TB.Gym.Modules.Nutrition;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// A recipe draft (NUT-014, critique B5d): the editor's recipe mid-edit, bounded in shape like a version
/// and checked for its values only when it becomes one.
/// </summary>
[TestClass]
public sealed class RecipeDraftDomainTests
{
    private static readonly Guid TenantId = Guid.Parse("10000000-0000-0000-0000-0000000005d0");
    private static readonly Guid OwnerId = Guid.Parse("20000000-0000-0000-0000-0000000005d0");
    private static readonly Guid OatsId = Guid.Parse("30000000-0000-0000-0000-0000000005d0");
    private static readonly Guid PhotoId = Guid.Parse("40000000-0000-0000-0000-0000000005d0");
    private static readonly Guid SuggestionId = Guid.Parse("50000000-0000-0000-0000-0000000005d0");

    [TestMethod]
    public void ADraftKeepsValuesASaveWouldRefuseAndReadsBackAsSent()
    {
        // Unnamed, no servings, a line still waiting for a food, an amount of 0, half a minute: all kept.
        var content = new RecipeDraftContent(
            "  ",
            null,
            null,
            [
                new RecipeDraftLine(null, null, Suggestion: new RecipeDraftSuggestion("Chickpeas", 200m, "g", true)),
                new RecipeDraftLine(OatsId, 0m),
            ],
            PrepMinutes: 2.5m,
            CookMinutes: -3m);

        Assert.IsTrue(RecipeDraftShape.TryCreate(content, out var shape, out _, out _));
        Assert.AreEqual((string.Empty, 2), (shape.Name, shape.LineCount));
        var read = RecipeDraftShape.Read(shape.Json);
        Assert.IsNull(read.Servings);
        Assert.AreEqual(string.Empty, read.Instructions, "The method is kept empty, never missing.");
        Assert.AreEqual((2.5m, -3m), (read.PrepMinutes, read.CookMinutes));
        Assert.IsNull(read.Lines![0].FoodItemVersionId);
        Assert.AreEqual(("Chickpeas", 200m, "g", true), (read.Lines[0].Suggestion!.Name, read.Lines[0].Suggestion!.Quantity, read.Lines[0].Suggestion!.Unit, read.Lines[0].Suggestion!.Uncertain));
        Assert.AreEqual(((Guid?)OatsId, (decimal?)0m), (read.Lines[1].FoodItemVersionId, read.Lines[1].Quantity));
    }

    [TestMethod]
    public void TheShapeIsKeptInOneFormWithEveryListPresentAndTextAsTyped()
    {
        var yieldId = Guid.NewGuid();
        var retentionId = Guid.NewGuid();
        var content = new RecipeDraftContent(
            " Overnight oats ",
            2m,
            "  Stir and chill.  ",
            [new RecipeDraftLine(OatsId, 290m, yieldId, retentionId, ConvertedRawGrams: 100m, ConvertedCookedGrams: 290m)],
            PhotoId);

        Assert.IsTrue(RecipeDraftShape.TryCreate(content, out var shape, out _, out _));
        Assert.AreEqual(("Overnight oats", (Guid?)PhotoId, (Guid?)null), (shape.Name, shape.PhotoMediaAssetId, shape.AiMealDraftOperationId), "The list shows the name trimmed.");
        var read = RecipeDraftShape.Read(shape.Json);
        Assert.AreEqual((" Overnight oats ", "  Stir and chill.  "), (read.Name, read.Instructions), "The draft keeps text as typed; a version trims it.");
        var line = read.Lines!.Single();
        Assert.AreEqual(((Guid?)yieldId, (Guid?)retentionId, (decimal?)100m, (decimal?)290m), (line.YieldFactorId, line.RetentionFactorId, line.ConvertedRawGrams, line.ConvertedCookedGrams));

        Assert.IsTrue(RecipeDraftShape.TryCreate(new RecipeDraftContent(null, null, null, null), out var empty, out _, out _));
        var nothing = RecipeDraftShape.Read(empty.Json);
        Assert.AreEqual((string.Empty, string.Empty, 0), (nothing.Name, nothing.Instructions, nothing.Lines!.Count));
    }

    [TestMethod]
    public void TheLimitsAreAVersionsLimits()
    {
        Assert.IsTrue(RecipeDraftShape.TryCreate(Content("Big", [.. Enumerable.Repeat(Line(), 500)]), out var full, out _, out _));
        Assert.AreEqual(500, full.LineCount);
        AssertRefused(Content("Too big", [.. Enumerable.Repeat(Line(), 501)]), "lines");
        AssertRefused(Content(new string('n', 301)), "name");
        AssertRefused(Content("Method") with { Instructions = new string('m', 20_001) }, "instructions");
        AssertRefused(Content("Lost line", [null!]), "lines");
        AssertRefused(Content("Nobody", new RecipeDraftLine(Guid.Empty, 1m)), "lines");
        AssertRefused(Content("No conversion", new RecipeDraftLine(OatsId, 1m, Guid.Empty, Guid.NewGuid())), "lines");
        AssertRefused(Content("Suggested", new RecipeDraftLine(null, null, Suggestion: new RecipeDraftSuggestion(new string('s', 301), 1m, "g", false))), "lines");
        AssertRefused(Content("Unit", new RecipeDraftLine(null, null, Suggestion: new RecipeDraftSuggestion("Rice", 1m, new string('u', 21), false))), "lines");
        AssertRefused(Content("Photo") with { PhotoMediaAssetId = Guid.Empty }, "photoMediaAssetId");
        AssertRefused(Content("Suggestion") with { AiMealDraftOperationId = Guid.Empty }, "aiMealDraftOperationId");
        Assert.IsTrue(RecipeDraftShape.TryCreate(Content("Longest method") with { Instructions = new string('m', 20_000) }, out _, out _, out _));
    }

    [TestMethod]
    public void ANulCharacterIsRefusedBecauseTheDatabaseCannotStoreIt()
    {
        AssertRefused(Content("Bad\0name"), "name");
        AssertRefused(Content("Method") with { Instructions = "Stir\0" }, "instructions");
        AssertRefused(Content("Suggested", new RecipeDraftLine(null, null, Suggestion: new RecipeDraftSuggestion("Rice\0", 1m, "g", false))), "lines");
        Assert.IsTrue(RecipeDraftShape.TryCreate(Content("Tabs\tand\nlines") with { Instructions = "1.\tSoak\n2.\tStir" }, out _, out _, out _));
    }

    [TestMethod]
    public void ARecipeTooLongToKeepIsRefusedAsAWhole()
    {
        // The stored content is counted as it is written: an Arabic letter takes six characters (م).
        var suggested = new RecipeDraftLine(null, null, Suggestion: new RecipeDraftSuggestion(new string('م', 300), 1m, "g", false));
        var content = Content("Huge", [.. Enumerable.Repeat(suggested, 500)]);

        AssertRefused(content, "content");
        Assert.IsTrue(RecipeDraftShape.TryCreate(Content("Arabic", [.. Enumerable.Repeat(suggested, 200)]), out _, out _, out _));
    }

    [TestMethod]
    public void ADraftOfARecipeNamesTheRevisionItStartedFromAndKnowsWhenItIsBehind()
    {
        Assert.IsTrue(RecipeDraftShape.TryCreate(Content("Oats", Line()) with { PhotoMediaAssetId = PhotoId }, out var shape, out _, out _));
        var recipeId = Guid.NewGuid();
        var draft = RecipeDraft.ForRecipe(TenantId, OwnerId, recipeId, 3, shape);

        Assert.AreEqual(((Guid?)recipeId, 3, "Oats", 1, (Guid?)PhotoId), (draft.RecipeId, draft.StartedAtRevision, draft.Name, draft.LineCount, draft.PhotoMediaAssetId));
        Assert.IsFalse(draft.IsBehind(3));
        Assert.IsTrue(draft.IsBehind(4), "Someone saved a version after it began.");

        var fresh = RecipeDraft.ForNewRecipe(TenantId, OwnerId, shape);
        Assert.AreEqual(((Guid?)null, 0), (fresh.RecipeId, fresh.StartedAtRevision));
        Assert.IsFalse(fresh.IsBehind(7), "A recipe not saved yet has nobody to fall behind.");
    }

    [TestMethod]
    public void OnlyANewRecipesDraftCarriesTheSuggestionItBeganFrom()
    {
        Assert.IsTrue(RecipeDraftShape.TryCreate(Content("Shawarma bowl") with { AiMealDraftOperationId = SuggestionId }, out var suggested, out _, out _));
        Assert.IsTrue(RecipeDraftShape.TryCreate(Content("Shawarma bowl"), out var plain, out _, out _));

        var fresh = RecipeDraft.ForNewRecipe(TenantId, OwnerId, suggested);
        Assert.AreEqual((Guid?)SuggestionId, fresh.AiMealDraftOperationId);
        fresh.Replace(plain);
        Assert.IsNull(fresh.AiMealDraftOperationId, "Turning the suggestion down lets go of it.");

        Assert.ThrowsExactly<ArgumentException>(() => RecipeDraft.ForRecipe(TenantId, OwnerId, Guid.NewGuid(), 1, suggested));
        var change = RecipeDraft.ForRecipe(TenantId, OwnerId, Guid.NewGuid(), 1, plain);
        Assert.ThrowsExactly<ArgumentException>(() => change.Replace(suggested));
        Assert.IsNull(change.AiMealDraftOperationId);
    }

    [TestMethod]
    public void ADraftNeedsItsOwnerAndAWholeOrigin()
    {
        Assert.IsTrue(RecipeDraftShape.TryCreate(Content("Oats"), out var shape, out _, out _));
        Assert.ThrowsExactly<ArgumentException>(() => RecipeDraft.ForNewRecipe(TenantId, Guid.Empty, shape));
        Assert.ThrowsExactly<ArgumentException>(() => RecipeDraft.ForRecipe(TenantId, OwnerId, Guid.Empty, 1, shape));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => RecipeDraft.ForRecipe(TenantId, OwnerId, Guid.NewGuid(), 0, shape));
        Assert.ThrowsExactly<ArgumentException>(() => RecipeDraft.ForNewRecipe(Guid.Empty, OwnerId, shape));
    }

    private static void AssertRefused(RecipeDraftContent content, string field)
    {
        Assert.IsFalse(RecipeDraftShape.TryCreate(content, out _, out var refused, out var problem));
        Assert.AreEqual(field, refused);
        Assert.IsFalse(string.IsNullOrWhiteSpace(problem));
    }

    private static RecipeDraftContent Content(string name, params RecipeDraftLine[] lines) =>
        new(name, 1m, "Stir and chill.", lines);

    private static RecipeDraftLine Line() => new(OatsId, 100m);
}
