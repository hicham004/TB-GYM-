using TB.Gym.Modules.Nutrition;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// Recipes for clients in the domain (R4.4d): an assigned plan holds its own copy of each recipe it
/// names (NUT-006), and a recipe's prep and cook time are whole minutes up to two days.
/// </summary>
[TestClass]
public sealed class ClientRecipeCopyDomainTests
{
    private static readonly Guid TenantId = Guid.Parse("10000000-0000-0000-0000-000000000444");
    private static readonly Guid ClientId = Guid.Parse("20000000-0000-0000-0000-000000000444");
    private static readonly Guid EnrollmentId = Guid.Parse("30000000-0000-0000-0000-000000000444");
    private static readonly Guid OatsVersionId = Guid.Parse("40000000-0000-0000-0000-000000000444");
    private static readonly Guid BowlVersionId = Guid.Parse("50000000-0000-0000-0000-000000000444");
    private static readonly Guid PhotoId = Guid.Parse("60000000-0000-0000-0000-000000000444");

    [TestMethod]
    public void APlanCopiesEachRecipeItNamesOnceWithItsLinesInOrder()
    {
        // Oats is offered on both days; the plan still holds one copy of it.
        var plan = Assign(
            [Slot(0, Choice(OatsVersionId), Choice(BowlVersionId)), Slot(1, Choice(OatsVersionId))],
            [Oats(), Bowl()]);

        Assert.HasCount(2, plan.Recipes);
        var oats = plan.Recipes.Single(item => item.SourceRecipeVersionId == OatsVersionId);
        Assert.AreEqual(("Overnight oats", 2m, (int?)10, (int?)0, (Guid?)PhotoId), (oats.Name, oats.Servings, oats.PrepMinutes, oats.CookMinutes, oats.PhotoMediaAssetId));
        CollectionAssert.AreEqual(
            new[] { (0, "Rolled oats", 80m), (1, "Greek yogurt", 150m) },
            oats.Ingredients.OrderBy(line => line.Order).Select(line => (line.Order, line.FoodName, line.Quantity)).ToArray());
        Assert.IsTrue(plan.Recipes.All(item => item.ClientNutritionPlanId == plan.Id && item.TenantId == TenantId));
    }

    [TestMethod]
    public void APlanMustCopyEveryRecipeItNamesAndNoOther()
    {
        var slots = new[] { Slot(0, Choice(OatsVersionId), Choice(BowlVersionId)) };
        Assert.ThrowsExactly<ArgumentException>(() => Assign(slots, [Oats()]), "a named recipe without its copy");
        Assert.ThrowsExactly<ArgumentException>(() => Assign(slots, [Oats(), Bowl(), Oats()]), "a recipe copied twice");
        Assert.ThrowsExactly<ArgumentException>(() => Assign([Slot(0, Choice(OatsVersionId))], [Oats(), Bowl()]), "a copy no meal names");
    }

    [TestMethod]
    public void ACopyRefusesWhatARecipeVersionCouldNeverHold()
    {
        var slots = new[] { Slot(0, Choice(OatsVersionId)) };
        Assert.ThrowsExactly<ArgumentException>(() => Assign(slots, [Oats() with { Ingredients = [] }]));
        Assert.ThrowsExactly<ArgumentException>(() => Assign(slots, [Oats() with { Instructions = "  " }]));
        Assert.ThrowsExactly<ArgumentException>(() => Assign(slots, [Oats() with { PhotoMediaAssetId = Guid.Empty }]));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => Assign(slots, [Oats() with { CookMinutes = RecipeVersion.MaximumMinutes + 1 }]));
    }

    [TestMethod]
    public void PrepAndCookTimeAreWholeMinutesUpToTwoDaysOrNotGiven()
    {
        var recipe = Recipe.Create(TenantId, "Overnight oats");
        var soaked = recipe.AddDraft("Stir and chill overnight.", 2m, [Line()], prepMinutes: 480, cookMinutes: 0);
        var plain = recipe.AddDraft("Stir and chill overnight.", 2m, [Line()]);
        var longest = recipe.AddDraft("Ferment.", 2m, [Line()], prepMinutes: RecipeVersion.MaximumMinutes);

        Assert.AreEqual(((int?)480, (int?)0), (soaked.PrepMinutes, soaked.CookMinutes));
        Assert.AreEqual(((int?)null, (int?)null), (plain.PrepMinutes, plain.CookMinutes));
        Assert.AreEqual(2_880, longest.PrepMinutes);
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => recipe.AddDraft("Stir.", 1m, [Line()], prepMinutes: -1));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => recipe.AddDraft("Stir.", 1m, [Line()], cookMinutes: 2_881));
        Assert.AreEqual(3, recipe.CurrentRevision, "A refused version leaves the revision where it was.");
    }

    private static ClientNutritionPlan Assign(IEnumerable<MealSlotInput> slots, IEnumerable<PlanRecipeInput> recipes) =>
        ClientNutritionPlan.Assign(
            TenantId,
            ClientId,
            EnrollmentId,
            Guid.NewGuid(),
            Guid.NewGuid(),
            new DateOnly(2026, 10, 12),
            new DateOnly(2026, 10, 12).AddDays(slots.Max(slot => slot.DayOffset) + 1),
            slots,
            recipes,
            new NutritionCoverageAuthorization(EnrollmentId, ClientId, new DateOnly(2026, 10, 1), new DateOnly(2026, 11, 1), true, false));

    private static MealSlotInput Slot(int day, params MealChoiceInput[] choices) => new(day, 0, "Breakfast", choices);

    private static MealChoiceInput Choice(Guid versionId) => new(versionId, versionId == OatsVersionId ? "Overnight oats" : "Chicken bowl", 1m, 400m, 30m, 45m, 10m);

    private static PlanRecipeInput Oats() => new(
        OatsVersionId,
        "Overnight oats",
        "Stir everything together and chill overnight.",
        2m,
        10,
        0,
        PhotoId,
        [new PlanRecipeIngredientInput("Rolled oats", 80m, FoodQuantityUnit.Gram, PreparationBasis.AsSold), new PlanRecipeIngredientInput("Greek yogurt", 150m, FoodQuantityUnit.Gram, PreparationBasis.AsSold)]);

    private static PlanRecipeInput Bowl() => new(
        BowlVersionId,
        "Chicken bowl",
        "Grill the chicken and serve it on the rice.",
        1m,
        null,
        null,
        null,
        [new PlanRecipeIngredientInput("Chicken breast", 150m, FoodQuantityUnit.Gram, PreparationBasis.Raw)]);

    private static RecipeIngredientInput Line() =>
        new(Guid.NewGuid(), "Rolled oats", 80m, FoodQuantityUnit.Gram, PreparationBasis.AsSold, 10m, 48m, 6m, 300m, "Coach-authored food", []);
}
