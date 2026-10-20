using TB.Gym.Modules.Nutrition;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// The audit's batch A6 in the domain: a label typed as an EU label prints it is counted as printed
/// (C6, NCM-3), and a coach's own macros are new targets that keep the formula's estimates they adjust
/// and leave those targets as they were (NUT-008, NUT-009, INV-2).
/// </summary>
[TestClass]
public sealed class A6NutritionCoachToolsDomainTests
{
    private static readonly Guid TenantId = Guid.Parse("10000000-0000-0000-0000-0000000000a6");

    // Fixed reference (C6): porridge oats per 100 g on a typical UK label, protein 11 g, carbohydrate
    // 60 g, fat 8 g, fibre 9 g, 374 kcal. The EU's carbohydrate leaves the fibre out (EU 1169/2011,
    // Annex I), so the total kept is 69 g, and Annex XIV's factors give the label's own 374 kcal:
    // 11 * 4 + (69 - 9) * 4 + 8 * 9 + 9 * 2.
    [TestMethod]
    public void OatsTypedAsAnEuLabelPrintsThemCountTheLabelsCalories()
    {
        var total = LabelCarbohydrateRule.TotalCarbohydrate(60m, 9m, CarbohydrateDeclaration.WithoutFibre);
        Assert.AreEqual(69m, total);

        var asPrinted = Oats(total);
        Assert.AreEqual((374m, false), (asPrinted.ComputedCalories, asPrinted.HasCalorieDiscrepancy));

        // Saved as typed, the fibre came off twice: 338 kcal, flagged as a wrong label.
        var twice = Oats(60m);
        Assert.AreEqual((338m, true), (twice.ComputedCalories, twice.HasCalorieDiscrepancy));
    }

    [TestMethod]
    public void TotalCarbohydrateIsKeptAsTypedAndNothingNegativeIsAccepted()
    {
        Assert.AreEqual(69m, LabelCarbohydrateRule.TotalCarbohydrate(69m, 9m, CarbohydrateDeclaration.TotalWithFibre));
        Assert.AreEqual(12m, LabelCarbohydrateRule.TotalCarbohydrate(12m, 0m, CarbohydrateDeclaration.WithoutFibre));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() =>
            LabelCarbohydrateRule.TotalCarbohydrate(-5m, 10m, CarbohydrateDeclaration.WithoutFibre));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() =>
            LabelCarbohydrateRule.TotalCarbohydrate(5m, -1m, CarbohydrateDeclaration.TotalWithFibre));
        Assert.ThrowsExactly<ArgumentException>(() =>
            LabelCarbohydrateRule.TotalCarbohydrate(5m, 1m, (CarbohydrateDeclaration)9));
    }

    [TestMethod]
    public void ACoachsMacrosMakeTheirCaloriesAtFourFourAndNine()
    {
        // 180 * 4 + 220 * 4 + 62 * 9.
        Assert.AreEqual(2_158m, CoachMacroOverride.CalorieTarget(180m, 220m, 62m));
        Assert.AreEqual(9m, CoachMacroOverride.CalorieTarget(0m, 0m, 1m));
        Assert.ThrowsExactly<ArgumentException>(() => CoachMacroOverride.CalorieTarget(0m, 0m, 0m));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => CoachMacroOverride.CalorieTarget(-1m, 200m, 60m));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => CoachMacroOverride.CalorieTarget(150m, 1_001m, 60m));
    }

    [TestMethod]
    public void ACoachsMacrosAreNewTargetsThatKeepTheEstimatesAndLeaveTheFormulasAlone()
    {
        var formula = Calculation(proteinGrams: 150m, goal: -300m);
        var before = (formula.CalorieTarget, formula.ProteinGrams, formula.CarbohydrateGrams, formula.FatGrams);
        var coach = Guid.NewGuid();
        var adjustment = MacroOverrideAudit.Create(TenantId, formula.Id, 180m, 62m, 220m, "  More carbs on training days ", coach);

        var adjusted = formula.WithCoachMacros(adjustment);

        // What the body burns and the activity stay the formula's; the target is what the grams make.
        Assert.AreNotEqual(formula.Id, adjusted.Id);
        Assert.AreEqual(
            (formula.ClientProfileId, formula.BmrMethodKey, formula.BmrEstimate, formula.ActivityModelPal, formula.TdeeEstimate, formula.InputJson, formula.EnergyPolicyKey),
            (adjusted.ClientProfileId, adjusted.BmrMethodKey, adjusted.BmrEstimate, adjusted.ActivityModelPal, adjusted.TdeeEstimate, adjusted.InputJson, adjusted.EnergyPolicyKey));
        Assert.AreEqual((2_158m, 180m, 220m, 62m), (adjusted.CalorieTarget, adjusted.ProteinGrams, adjusted.CarbohydrateGrams, adjusted.FatGrams));
        Assert.AreEqual(adjusted.CalorieTarget, adjusted.TdeeEstimate + adjusted.CoachGoalAdjustment, "The target is still the TDEE plus the goal.");
        Assert.AreEqual((CoachMacroOverride.Key, CoachMacroOverride.CurrentVersion, adjustment.Id), (adjusted.MacroMethodKey, adjusted.MacroMethodVersion, adjusted.MacroOverrideAuditId));
        Assert.AreEqual("More carbs on training days", adjustment.Reason);

        // The formula's targets are untouched, so a plan assigned with them keeps them (NUT-009).
        Assert.AreEqual(before, (formula.CalorieTarget, formula.ProteinGrams, formula.CarbohydrateGrams, formula.FatGrams));
        Assert.IsNull(formula.MacroOverrideAuditId);

        // An override of another calculation, or of another workspace's, is not this one's to apply.
        var other = Calculation(proteinGrams: 140m, goal: 0m);
        Assert.ThrowsExactly<ArgumentException>(() => formula.WithCoachMacros(MacroOverrideAudit.Create(TenantId, other.Id, 1m, 1m, 1m, "Why", coach)));
        Assert.ThrowsExactly<ArgumentException>(() => formula.WithCoachMacros(MacroOverrideAudit.Create(Guid.NewGuid(), formula.Id, 1m, 1m, 1m, "Why", coach)));
        Assert.ThrowsExactly<ArgumentException>(() => formula.WithCoachMacros(MacroOverrideAudit.Create(TenantId, formula.Id, 0m, 0m, 0m, "Why", coach)));
        Assert.ThrowsExactly<ArgumentException>(() => MacroOverrideAudit.Create(TenantId, formula.Id, 180m, 62m, 220m, "   ", coach));
    }

    [TestMethod]
    public void ACoachsProteinIsFlaggedOnTheSameRangeAsTheFormulas()
    {
        Assert.IsEmpty(MacroTargetCalculator.ProteinWarnings(144m, 80m, isEnergyDeficit: false));
        Assert.Contains("g/kg/day", MacroTargetCalculator.ProteinWarnings(200m, 80m, isEnergyDeficit: false).Single());
        // Eating below what they burn widens the range to 3.1 g a kilogram.
        Assert.IsEmpty(MacroTargetCalculator.ProteinWarnings(200m, 80m, isEnergyDeficit: true));
        Assert.IsEmpty(MacroTargetCalculator.ProteinWarnings(500m, null, isEnergyDeficit: false));
    }

    private static FoodItemVersion Oats(decimal totalCarbohydrate)
    {
        var food = FoodItem.Create(TenantId, "Porridge oats", FoodProvenance.CoachAuthored);
        return food.AddVersion(new FoodVersionInput(
            100m, FoodQuantityUnit.Gram, PreparationBasis.AsSold, 11m, totalCarbohydrate, 8m, 9m, 0m, 0m, 374m,
            Eu1169EnergyPolicy.Key, 25m, "Coach-authored food", "coach-entry-v1", []));
    }

    private static NutritionCalculationSnapshot Calculation(decimal proteinGrams, decimal goal)
    {
        var bmr = new MifflinStJeorBmrStrategy().Estimate(new BmrInput(80m, 180m, 30, FormulaSex.Male));
        var activity = OccupationStepsActivityModel.Calculate(new ActivityModelInput(OccupationActivityType.Seated, 6_000));
        var tdee = TdeeEstimator.Estimate(bmr, activity);
        var macro = MacroTargetCalculator.Calculate(new MacroTargetInput(tdee.KilocaloriesPerDay + goal, proteinGrams, 25m, 80m, goal < 0m));
        return NutritionCalculationSnapshot.Create(TenantId, Guid.Parse("20000000-0000-0000-0000-0000000000a6"), bmr, activity, tdee, goal, macro, AtwaterEnergyPolicy.Key, AtwaterEnergyPolicy.CurrentVersion, "{\"weightKilograms\":80}");
    }
}
