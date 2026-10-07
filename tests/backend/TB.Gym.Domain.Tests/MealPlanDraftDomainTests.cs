using TB.Gym.Modules.Nutrition;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// A meal-plan draft (NUT-013): the builder's plan mid-edit, bounded in shape like a version and
/// checked for its values only when published.
/// </summary>
[TestClass]
public sealed class MealPlanDraftDomainTests
{
    private static readonly Guid TenantId = Guid.Parse("10000000-0000-0000-0000-000000000440");
    private static readonly Guid OwnerId = Guid.Parse("20000000-0000-0000-0000-000000000440");
    private static readonly Guid OatsId = Guid.Parse("30000000-0000-0000-0000-000000000440");
    private static readonly decimal[] OptionServings = [1.5m, 1m];

    [TestMethod]
    public void ADraftKeepsValuesPublishWouldRefuseAndReadsBackAsSent()
    {
        // Unnamed, no targets, an empty day, a meal with no name or recipe, 0 servings: all mid-edit, all kept.
        var content = new MealPlanDraftContent(
            "  ",
            null,
            -5m,
            null,
            null,
            [Day(), Day(Meal(string.Empty), Meal("Breakfast", Choice(0m)))]);

        Assert.IsTrue(MealPlanDraftShape.TryCreate(content, out var shape, out _, out _));
        Assert.AreEqual((string.Empty, 2), (shape.Name, shape.DayCount));
        var read = MealPlanDraftShape.Read(shape.Json);
        Assert.IsNull(read.TargetCalories);
        Assert.AreEqual(-5m, read.TargetProteinGrams);
        Assert.IsEmpty(read.Days![0].Meals!);
        Assert.AreEqual(string.Empty, read.Days[1].Meals![0].Name);
        Assert.AreEqual((OatsId, 0m), (read.Days[1].Meals![1].Choices![0].RecipeVersionId, read.Days[1].Meals![1].Choices![0].Servings));
    }

    [TestMethod]
    public void TheShapeIsKeptInOneFormWithEveryListPresentAndTextAsTyped()
    {
        var content = new MealPlanDraftContent(
            " Cut, week one ",
            2000m,
            150m,
            200m,
            60m,
            [new MealPlanDraftDay(null), Day(new MealPlanDraftMeal(null, null), Meal("  Lunch  ", Choice(1.5m), Choice(1m)))]);

        Assert.IsTrue(MealPlanDraftShape.TryCreate(content, out var shape, out _, out _));
        var read = MealPlanDraftShape.Read(shape.Json);
        Assert.AreEqual("Cut, week one", shape.Name, "The list shows the name trimmed.");
        Assert.AreEqual(" Cut, week one ", read.Name, "The draft keeps it as typed; Publish trims it.");
        Assert.IsEmpty(read.Days![0].Meals!);
        Assert.AreEqual((string.Empty, 0), (read.Days[1].Meals![0].Name, read.Days[1].Meals![0].Choices!.Count));
        Assert.AreEqual("  Lunch  ", read.Days[1].Meals![1].Name);
        CollectionAssert.AreEqual(
            OptionServings,
            read.Days[1].Meals![1].Choices!.Select(choice => choice.Servings).ToArray(),
            "Options keep the order the coach gave them.");
    }

    [TestMethod]
    public void TheLimitsAreAVersionsLimits()
    {
        Assert.IsTrue(MealPlanDraftShape.TryCreate(Content("Year", [.. Enumerable.Repeat(Day(), 365)]), out _, out _, out _));
        AssertRefused(Content("Too long", [.. Enumerable.Repeat(Day(), 366)]), "days");
        AssertRefused(Content("None"), "days");
        AssertRefused(Content("Busy", Day([.. Enumerable.Repeat(Meal("Snack"), 31)])), "meals");
        AssertRefused(Content("Choices", Day(Meal("Lunch", [.. Enumerable.Repeat(Choice(1m), 101)]))), "choices");
        AssertRefused(Content(new string('n', 301), Day()), "name");
        AssertRefused(Content("Meal name", Day(Meal(new string('m', 201)))), "meals");
        AssertRefused(Content("Nobody", Day(Meal("Lunch", new MealPlanChoiceRequest(Guid.Empty, 1m)))), "choices");
        AssertRefused(Content("Missing", Day(new MealPlanDraftMeal("Lunch", [null!]))), "choices");
        AssertRefused(Content("Lost meal", Day([null!])), "meals");
    }

    [TestMethod]
    public void ANulCharacterIsRefusedBecauseTheDatabaseCannotStoreIt()
    {
        AssertRefused(Content("Bad\0name", Day()), "name");
        AssertRefused(Content("Plan", Day(Meal("Bad\0meal"))), "meals");
        Assert.IsTrue(MealPlanDraftShape.TryCreate(Content("Tabs\tand\nlines", Day()), out _, out _, out _));
    }

    [TestMethod]
    public void APlanTooLongToKeepIsRefusedAsAWhole()
    {
        var meal = Meal(new string('m', 200), [.. Enumerable.Repeat(Choice(1m), 100)]);
        var content = Content("Huge", [.. Enumerable.Repeat(Day([.. Enumerable.Repeat(meal, 30)]), 30)]);

        AssertRefused(content, "content");
    }

    [TestMethod]
    public void ADraftOfAPlanNamesTheVersionItStartedFromAndKnowsWhenItIsBehind()
    {
        Assert.IsTrue(MealPlanDraftShape.TryCreate(Content("Lean", Day(), Day()), out var shape, out _, out _));
        var templateId = Guid.NewGuid();
        var draft = MealPlanDraft.ForPlan(TenantId, OwnerId, templateId, Guid.NewGuid(), 3, shape);

        Assert.AreEqual(((Guid?)templateId, 3, "Lean", 2), (draft.MealPlanTemplateId, draft.StartedAtRevision, draft.Name, draft.DayCount));
        Assert.IsFalse(draft.IsBehind(3));
        Assert.IsTrue(draft.IsBehind(4), "Someone published after it began.");

        var fresh = MealPlanDraft.ForNewPlan(TenantId, OwnerId, shape);
        Assert.AreEqual(((Guid?)null, (Guid?)null, 0), (fresh.MealPlanTemplateId, fresh.SourceVersionId, fresh.StartedAtRevision));
        Assert.IsFalse(fresh.IsBehind(7), "A plan not published yet has nobody to fall behind.");
    }

    [TestMethod]
    public void ADraftNeedsItsOwnerAndAWholeOrigin()
    {
        Assert.IsTrue(MealPlanDraftShape.TryCreate(Content("Lean", Day()), out var shape, out _, out _));
        Assert.ThrowsExactly<ArgumentException>(() => MealPlanDraft.ForNewPlan(TenantId, Guid.Empty, shape));
        Assert.ThrowsExactly<ArgumentException>(() => MealPlanDraft.ForPlan(TenantId, OwnerId, Guid.NewGuid(), Guid.Empty, 1, shape));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => MealPlanDraft.ForPlan(TenantId, OwnerId, Guid.NewGuid(), Guid.NewGuid(), 0, shape));
    }

    [TestMethod]
    public void AMealPlanIsRenamedTrimmedAndNeverToNothing()
    {
        var plan = MealPlanTemplate.Create(TenantId, "Lean");

        plan.Rename("  Lean, phase two ");
        Assert.AreEqual(("Lean, phase two", "LEAN, PHASE TWO"), (plan.Name, plan.NormalizedName));
        Assert.ThrowsExactly<ArgumentException>(() => plan.Rename("   "));
        Assert.ThrowsExactly<ArgumentException>(() => plan.Rename(new string('n', 301)));
        Assert.AreEqual("Lean, phase two", plan.Name);
    }

    private static void AssertRefused(MealPlanDraftContent content, string field)
    {
        Assert.IsFalse(MealPlanDraftShape.TryCreate(content, out _, out var refused, out var problem));
        Assert.AreEqual(field, refused);
        Assert.IsFalse(string.IsNullOrWhiteSpace(problem));
    }

    private static MealPlanDraftContent Content(string name, params MealPlanDraftDay[] days) =>
        new(name, 2000m, 150m, 200m, 60m, days);

    private static MealPlanDraftDay Day(params MealPlanDraftMeal[] meals) => new(meals);

    private static MealPlanDraftMeal Meal(string name, params MealPlanChoiceRequest[] choices) => new(name, choices);

    private static MealPlanChoiceRequest Choice(decimal servings) => new(OatsId, servings);
}
