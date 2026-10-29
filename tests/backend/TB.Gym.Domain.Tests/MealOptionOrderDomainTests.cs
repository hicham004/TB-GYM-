using TB.Gym.Modules.Nutrition;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// Meal options (critique B5a, NUT-005): a meal's options keep the coach's order in the published
/// version and in each client's copy, so the coach's option 1 is what the client sees first, while the
/// day still counts their average for planning. A meal logged again replaces what was logged for it.
/// </summary>
[TestClass]
public sealed class MealOptionOrderDomainTests
{
    private static readonly Guid TenantId = Guid.Parse("10000000-0000-0000-0000-0000000005a0");
    private static readonly Guid ClientId = Guid.Parse("20000000-0000-0000-0000-0000000005a0");
    private static readonly Guid EnrollmentId = Guid.Parse("30000000-0000-0000-0000-0000000005a0");
    private static readonly Guid EggsVersionId = Guid.Parse("40000000-0000-0000-0000-0000000005a0");
    private static readonly Guid OatsVersionId = Guid.Parse("50000000-0000-0000-0000-0000000005a0");
    private static readonly Guid ToastVersionId = Guid.Parse("60000000-0000-0000-0000-0000000005a0");
    private static readonly string[] ToastThenEggs = ["Toast", "Eggs"];

    [TestMethod]
    public void APublishedMealKeepsItsOptionsInTheCoachsOrderAndCountsTheirAverage()
    {
        var template = MealPlanTemplate.Create(TenantId, "Lean bulk");

        // Not alphabetical and not by id: the order the coach gave them.
        var version = template.AddDraft(1, 2_000m, 150m, 200m, 60m,
            [new MealSlotInput(0, 0, "Breakfast", [Eggs(), Oats(), Toast()])]);

        var options = version.Slots.Single().Choices.OrderBy(choice => choice.Order).ToArray();
        CollectionAssert.AreEqual(new[] { (0, "Eggs"), (1, "Oats"), (2, "Toast") }, options.Select(choice => (choice.Order, choice.RecipeName)).ToArray());
        var slot = version.Slots.Single();
        Assert.AreEqual((420m + 510m + 300m) / 3m, slot.AverageCalories);
        Assert.AreEqual((30m + 20m + 12m) / 3m, slot.AverageProteinGrams);
    }

    [TestMethod]
    public void AClientsPlanCopiesEachMealsOptionsInTheSameOrder()
    {
        var plan = ClientNutritionPlan.Assign(
            TenantId,
            ClientId,
            EnrollmentId,
            Guid.NewGuid(),
            Guid.NewGuid(),
            new DateOnly(2026, 10, 26),
            new DateOnly(2026, 10, 28),
            [new MealSlotInput(0, 0, "Breakfast", [Toast(), Eggs()]), new MealSlotInput(1, 0, "Breakfast", [Oats(), Toast(), Eggs()])],
            [Copy(EggsVersionId, "Eggs"), Copy(OatsVersionId, "Oats"), Copy(ToastVersionId, "Toast")],
            new NutritionCoverageAuthorization(EnrollmentId, ClientId, new DateOnly(2026, 10, 1), new DateOnly(2026, 11, 1), true, false));

        var days = plan.Days.OrderBy(day => day.Date).ToArray();
        CollectionAssert.AreEqual(
            ToastThenEggs,
            days[0].Slots.Single().Choices.OrderBy(choice => choice.Order).Select(choice => choice.RecipeName).ToArray());
        CollectionAssert.AreEqual(
            new[] { (0, "Oats"), (1, "Toast"), (2, "Eggs") },
            days[1].Slots.Single().Choices.OrderBy(choice => choice.Order).Select(choice => (choice.Order, choice.RecipeName)).ToArray());
    }

    [TestMethod]
    public void AMealLoggedAgainReplacesWhatWasLoggedForIt()
    {
        var log = DailyNutritionLog.Start(TenantId, ClientId, Guid.NewGuid(), Guid.NewGuid(), new DateOnly(2026, 10, 29));
        var breakfast = Guid.NewGuid();
        var lunch = Guid.NewGuid();
        var eggs = Guid.NewGuid();
        var oats = Guid.NewGuid();
        log.Record(lunch, Guid.NewGuid(), "Chicken bowl", 1m, 600m, 45m, 60m, 15m);
        log.Record(breakfast, eggs, "Eggs", 1m, 420m, 30m, 20m, 25m);

        // The client ate the other option, one and a half servings of it.
        var entry = log.Record(breakfast, oats, "Oats", 1.5m, 765m, 30m, 120m, 15m);

        Assert.HasCount(2, log.Entries);
        Assert.AreSame(entry, log.Entries.Single(item => item.ClientNutritionPlanSlotId == breakfast));
        Assert.AreEqual(oats, entry.SelectedClientNutritionPlanChoiceId);
        Assert.AreEqual(600m + 765m, log.SelectedCalories);
        log.Complete(DateTimeOffset.UtcNow);
        Assert.ThrowsExactly<InvalidOperationException>(() => log.Record(breakfast, eggs, "Eggs", 1m, 420m, 30m, 20m, 25m));
    }

    private static MealChoiceInput Eggs() => new(EggsVersionId, "Eggs", 1m, 420m, 30m, 20m, 25m);

    private static MealChoiceInput Oats() => new(OatsVersionId, "Oats", 1m, 510m, 20m, 80m, 10m);

    private static MealChoiceInput Toast() => new(ToastVersionId, "Toast", 1m, 300m, 12m, 45m, 8m);

    private static PlanRecipeInput Copy(Guid versionId, string name) =>
        new(versionId, name, "Cook and serve.", 1m, null, null, null, [new PlanRecipeIngredientInput(name, 100m, FoodQuantityUnit.Gram, PreparationBasis.AsSold)]);
}
