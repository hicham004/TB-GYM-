using TB.Gym.Modules.Nutrition;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// The meal-plan builder's daily target (critique B5c2): "Fill in fat and carbs" is the macro split
/// (NUT-008), whose fat is flagged under 20 % of the calories and, with a weight, under 0.5 g a kilogram,
/// warnings and never refusals; and a version filled in names the share its fat and carbohydrate came
/// from, which it keeps only while they are the split's own grams.
/// </summary>
[TestClass]
public sealed class B5c2DailyTargetDomainTests
{
    private static readonly Guid TenantId = Guid.Parse("10000000-0000-0000-0000-0000000005c2");
    private static readonly Guid OatsVersionId = Guid.Parse("40000000-0000-0000-0000-0000000005c2");

    private static readonly string[] LowFatForEightyKilograms =
    [
        "Fat is 15% of calories, under the coaching review floor of 20%. This is a warning, not a clinical determination.",
        "Fat is 0.42 g/kg/day, under the coaching review floor of 0.5 g/kg/day. This is a warning, not a clinical determination.",
    ];

    [TestMethod]
    public void FatUnderTheFloorIsFlaggedAndStillWorkedOut()
    {
        // 15 % of 2,000 kcal is 300 kcal of fat, 33.3 g; carbs are the rest: (2,000 - 600 - 300) / 4.
        var low = MacroTargetCalculator.Calculate(new MacroTargetInput(2_000m, 150m, 15m));
        Assert.AreEqual(300m / 9m, low.FatGrams);
        Assert.AreEqual(275m, low.CarbohydrateGrams);
        Assert.AreEqual(
            "Fat is 15% of calories, under the coaching review floor of 20%. This is a warning, not a clinical determination.",
            low.Warnings.Single());

        // With their weight, the same split is also under half a gram a kilogram: 33.3 g for 80 kg.
        var lowForTheirWeight = MacroTargetCalculator.Calculate(new MacroTargetInput(2_000m, 150m, 15m, 80m));
        CollectionAssert.AreEqual(LowFatForEightyKilograms, lowForTheirWeight.Warnings.ToArray());

        // 20 % of 1,500 kcal for 70 kg is 33.3 g, 0.48 g a kilogram: the share is fine, the grams are not.
        Assert.AreEqual(
            "Fat is 0.48 g/kg/day, under the coaching review floor of 0.5 g/kg/day. This is a warning, not a clinical determination.",
            MacroTargetCalculator.Calculate(new MacroTargetInput(1_500m, 120m, 20m, 70m)).Warnings.Single());
    }

    [TestMethod]
    public void TheFloorsThemselvesAreNotFlagged()
    {
        // Exactly 20 %, and exactly half a gram a kilogram (45 g for 90 kg: 405 kcal of 2,025).
        Assert.IsEmpty(MacroTargetCalculator.Calculate(new MacroTargetInput(2_000m, 150m, 20m)).Warnings);
        Assert.IsEmpty(MacroTargetCalculator.FatWarnings(20m, 45m, 90m));
        Assert.IsEmpty(MacroTargetCalculator.FatWarnings(25m, 60m, null));
        Assert.HasCount(1, MacroTargetCalculator.FatWarnings(19.99m, 60m, null));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => MacroTargetCalculator.FatWarnings(25m, 60m, 0m));
    }

    [TestMethod]
    public void AVersionFilledInNamesTheShareItsFatAndCarbohydrateCameFrom()
    {
        var split = MacroTargetCalculator.Calculate(new MacroTargetInput(2_000m, 150m, 25m));
        var template = MealPlanTemplate.Create(TenantId, "Lean bulk");

        var filled = template.AddDraft(1, 2_000m, 150m, split.CarbohydrateGrams, split.FatGrams, [Breakfast()], targetFatPercentage: 25m);
        Assert.AreEqual(
            (25m, MacroTargetCalculator.Key, MacroTargetCalculator.CurrentVersion, 55.555555555555555555555555556m, 225m),
            (filled.TargetFatPercentage, filled.TargetMacroMethodKey, filled.TargetMacroMethodVersion, filled.TargetFatGrams, filled.TargetCarbohydrateGrams));

        // Typed grams name nothing.
        var typed = template.AddDraft(1, 2_000m, 150m, 225m, 56m, [Breakfast()]);
        Assert.AreEqual(((decimal?)null, (string?)null, (string?)null), (typed.TargetFatPercentage, typed.TargetMacroMethodKey, typed.TargetMacroMethodVersion));

        // A share whose split the grams are not is refused, so a version never names a share falsely.
        Assert.ThrowsExactly<ArgumentException>(() =>
            template.AddDraft(1, 2_000m, 150m, 225m, 56m, [Breakfast()], targetFatPercentage: 25m));
        Assert.ThrowsExactly<ArgumentException>(() =>
            template.AddDraft(1, 2_000m, 150m, split.CarbohydrateGrams, split.FatGrams, [Breakfast()], targetFatPercentage: 30m));
    }

    private static MealSlotInput Breakfast() =>
        new(0, 0, "Breakfast", [new MealChoiceInput(OatsVersionId, "Oats", 1m, 510m, 20m, 70m, 15m)]);
}
