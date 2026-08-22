using TB.Gym.Modules.Nutrition;

namespace TB.Gym.Domain.Tests;

[TestClass]
public sealed class Phase4NutritionDomainTests
{
    [TestMethod]
    public void MifflinStJeorMatchesFixedReferenceCase()
    {
        var result = new MifflinStJeorBmrStrategy().Estimate(new BmrInput(80m, 180m, 30, FormulaSex.Male));

        Assert.AreEqual(1780m, result.KilocaloriesPerDay);
        Assert.AreEqual("MifflinStJeor", result.MethodKey);
        Assert.AreEqual("1.0", result.MethodVersion);
    }

    [TestMethod]
    public void KatchMcArdleMatchesFixedReferenceAndRequiresBodyFat()
    {
        var strategy = new KatchMcArdleBmrStrategy();
        var result = strategy.Estimate(new BmrInput(80m, 180m, 30, FormulaSex.Male, 20m));

        Assert.AreEqual(1752.4m, result.KilocaloriesPerDay);
        Assert.ThrowsExactly<ArgumentException>(() =>
            strategy.Estimate(new BmrInput(80m, 180m, 30, FormulaSex.Male)));
    }

    [TestMethod]
    public void HarrisBenedictRevisedMatchesFixedReferenceCase()
    {
        var result = new HarrisBenedictRevisedBmrStrategy().Estimate(new BmrInput(80m, 180m, 30, FormulaSex.Male));

        Assert.AreEqual(1853.632m, result.KilocaloriesPerDay);
    }

    [TestMethod]
    public void PalAndTdeeUseOccupationAndSteps()
    {
        var bmr = new MifflinStJeorBmrStrategy().Estimate(new BmrInput(80m, 180m, 30, FormulaSex.Male));
        var activity = OccupationStepsActivityModel.Calculate(new ActivityModelInput(OccupationActivityType.Seated, 6_000));
        var tdee = TdeeEstimator.Estimate(bmr, activity);

        Assert.AreEqual(1.70m, activity.Pal);
        Assert.AreEqual(PalBand.Moderate, activity.Band);
        Assert.AreEqual(3026m, tdee.KilocaloriesPerDay);
    }

    [TestMethod]
    public void Nut008MacroSplitRetainsUnroundedValues()
    {
        var result = MacroTargetCalculator.Calculate(new MacroTargetInput(2_000m, 150m, 25m, 80m));

        Assert.AreEqual(600m, result.ProteinCalories);
        Assert.AreEqual(500m, result.FatCalories);
        Assert.AreEqual(900m, result.CarbohydrateCalories);
        Assert.AreEqual(55.555555555555555555555555556m, result.FatGrams);
        Assert.AreEqual(225m, result.CarbohydrateGrams);
        Assert.IsEmpty(result.Warnings);
    }

    [TestMethod]
    public void MacroSplitRejectsNegativeAndImpossibleResiduals()
    {
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() =>
            MacroTargetCalculator.Calculate(new MacroTargetInput(2_000m, -1m, 25m)));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() =>
            MacroTargetCalculator.Calculate(new MacroTargetInput(2_000m, 100m, 110m)));
        Assert.ThrowsExactly<ArgumentException>(() =>
            MacroTargetCalculator.Calculate(new MacroTargetInput(1_000m, 200m, 30m)));
    }

    [TestMethod]
    public void MacroProteinGuidanceIsWarningOnly()
    {
        var result = MacroTargetCalculator.Calculate(new MacroTargetInput(3_000m, 280m, 20m, 80m));

        Assert.HasCount(1, result.Warnings);
        Assert.Contains("warning", result.Warnings[0], StringComparison.OrdinalIgnoreCase);
    }

    [TestMethod]
    public void PositiveMacroCannotRoundSilentlyToZero()
    {
        var result = MacroTargetCalculator.Calculate(new MacroTargetInput(1m, 0m, 1m));

        Assert.ThrowsExactly<InvalidOperationException>(() => result.RoundForPrescription());
    }

    [TestMethod]
    public void AtwaterAndEu1169DifferForFibreAndAlcohol()
    {
        // CarbohydrateGrams is TOTAL carbohydrate, so the 20 g here already contains the 10 g of
        // fibre, exactly as USDA "Carbohydrate, by difference" reports it.
        var fibreHeavy = new EnergyNutrients(10m, 20m, 5m, FibreGrams: 10m);
        var alcoholContaining = fibreHeavy with { EthanolGrams = 20m };

        // Atwater charges total carbohydrate at 4: 40 + 80 + 45.
        Assert.AreEqual(165m, new AtwaterEnergyPolicy().Calculate(fibreHeavy).Kilocalories);
        // EU 1169 charges only available carbohydrate at 4 and fibre at 2: 40 + 40 + 45 + 20.
        // Charging the total would bill fibre at 4 + 2 and overstate this food by 20 kcal.
        Assert.AreEqual(145m, new Eu1169EnergyPolicy().Calculate(fibreHeavy).Kilocalories);
        Assert.AreEqual(165m, new AtwaterEnergyPolicy().Calculate(alcoholContaining).Kilocalories);
        Assert.AreEqual(285m, new Eu1169EnergyPolicy().Calculate(alcoholContaining).Kilocalories);
    }

    [TestMethod]
    public void Eu1169UsesAvailableCarbohydrateForRealUsdaLentilValues()
    {
        // USDA FDC 172420 (lentils, mature seeds, cooked, boiled) per 100 g: carbohydrate by
        // difference 20.13 g, of which 7.9 g dietary fibre, protein 9.02 g, fat 0.38 g.
        var lentils = new EnergyNutrients(9.02m, 20.13m, 0.38m, FibreGrams: 7.9m);

        // Available carbohydrate 12.23 g -> 48.92 + 36.08 + 3.42 + 15.8.
        Assert.AreEqual(104.22m, new Eu1169EnergyPolicy().Calculate(lentils).Kilocalories);
        // The pre-fix behaviour charged the full 20.13 g at 4 kcal/g, inflating this by 31.6 kcal.
        Assert.AreEqual(120.02m, new AtwaterEnergyPolicy().Calculate(lentils).Kilocalories);
    }

    [TestMethod]
    public void EnergyPolicyRejectsComponentsExceedingTotalCarbohydrate()
    {
        // Guards against a caller pre-subtracting fibre and then declaring it again.
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() =>
            new Eu1169EnergyPolicy().Calculate(new EnergyNutrients(10m, 5m, 5m, FibreGrams: 6m)));
    }

    [TestMethod]
    public void ProviderCaloriesAreRetainedAndDiscrepancyIsFlagged()
    {
        var comparison = EnergyComparisonCalculator.Compare(
            new AtwaterEnergyPolicy(),
            new EnergyNutrients(10m, 20m, 5m),
            providerKilocalories: 220m,
            toleranceKilocalories: 25m);

        Assert.AreEqual(165m, comparison.ComputedKilocalories);
        Assert.AreEqual(220m, comparison.ProviderKilocalories);
        Assert.IsTrue(comparison.HasDiscrepancy);
    }

    [TestMethod]
    public void RawToCookedAppliesYieldBeforeRetention()
    {
        var source = new NutrientQuantity(100m, PreparationBasis.Raw, new EnergyNutrients(20m, 0m, 0m));
        var yield = new CookingFactor("UsdaCookingYields", "v1", PreparationBasis.Raw, PreparationBasis.Cooked, 0.8m);
        var retention = new CookingFactor("UsdaRetentionFactors", "release-6", PreparationBasis.Raw, PreparationBasis.Cooked, 0.9m);

        var cooked = PreparationBasisCalculator.Resolve(source, 40m, PreparationBasis.Cooked, yield, retention);

        Assert.AreEqual(40m, cooked.WeightGrams);
        Assert.AreEqual(9m, cooked.Nutrients.ProteinGrams);
    }

    [TestMethod]
    public void RawCookedMismatchWithoutSourcedFactorsIsRejected()
    {
        var source = new NutrientQuantity(100m, PreparationBasis.Raw, new EnergyNutrients(20m, 0m, 0m));

        Assert.ThrowsExactly<ArgumentException>(() =>
            PreparationBasisCalculator.Resolve(source, 80m, PreparationBasis.Cooked));
    }

    [TestMethod]
    public void AssignmentIsDeepSnapshotAndLibraryEditCannotAlterIt()
    {
        var tenantId = Guid.NewGuid();
        var clientId = Guid.NewGuid();
        var enrollmentId = Guid.NewGuid();
        var recipeId = Guid.NewGuid();
        var sourceVersionId = Guid.NewGuid();
        var choice = new MealChoiceInput(recipeId, "Original recipe", 1m, 500m, 40m, 50m, 15m);
        var slots = new[] { new MealSlotInput(0, 0, "Lunch", [choice]) };
        var coverage = new NutritionCoverageAuthorization(
            enrollmentId,
            clientId,
            new DateOnly(2026, 8, 1),
            new DateOnly(2026, 9, 1),
            true,
            false);
        var plan = ClientNutritionPlan.Assign(
            tenantId,
            clientId,
            enrollmentId,
            sourceVersionId,
            Guid.NewGuid(),
            new DateOnly(2026, 8, 10),
            new DateOnly(2026, 8, 11),
            slots,
            coverage);

        choice = choice with { RecipeName = "Edited library recipe", Calories = 700m };

        var snapshot = plan.Days.Single().Slots.Single().Choices.Single();
        Assert.AreEqual("Original recipe", snapshot.RecipeName);
        Assert.AreEqual(500m, snapshot.Calories);
    }

    [TestMethod]
    public void LoggingActualChoiceDoesNotMutatePrescription()
    {
        var tenantId = Guid.NewGuid();
        var choiceId = Guid.NewGuid();
        var log = DailyNutritionLog.Start(tenantId, Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), new DateOnly(2026, 8, 22));

        log.Record(Guid.NewGuid(), choiceId, "Chosen recipe", 1.5m, 750m, 60m, 75m, 22.5m);

        Assert.AreEqual(750m, log.SelectedCalories);
        Assert.AreEqual(choiceId, log.Entries.Single().SelectedClientNutritionPlanChoiceId);
    }

    [TestMethod]
    public void EntitlementExpiryMidPlanIsRejected()
    {
        var clientId = Guid.NewGuid();
        var enrollmentId = Guid.NewGuid();
        var coverage = new NutritionCoverageAuthorization(
            enrollmentId,
            clientId,
            new DateOnly(2026, 8, 1),
            new DateOnly(2026, 8, 15),
            true,
            false);

        var decision = NutritionCoveragePolicy.Evaluate(
            clientId,
            new DateOnly(2026, 8, 10),
            new DateOnly(2026, 8, 17),
            coverage);

        Assert.IsFalse(decision.IsAuthorized);
    }

    [TestMethod]
    public void AllergenConflictWarnsWithoutClaimingSafety()
    {
        var warning = AllergenRegimes.EvaluateConflict(
            [AllergenCode.Milk],
            [AllergenCode.Milk, AllergenCode.Sesame]);
        var noKnownConflict = AllergenRegimes.EvaluateConflict(
            [AllergenCode.Eggs],
            [AllergenCode.Sesame]);

        Assert.IsTrue(warning.HasConflict);
        Assert.Contains(AllergenCode.Milk, warning.ConflictingCodes);
        Assert.Contains("does not assert", warning.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("not evidence", noKnownConflict.Message, StringComparison.OrdinalIgnoreCase);
    }

    [TestMethod]
    public void InvalidAiDraftCanFailWithoutBecomingReviewable()
    {
        var operation = AiMealDraftOperation.Start(Guid.NewGuid(), "prompt-v1", "meal-draft-v1", "provider");

        operation.Fail("schema_invalid");

        Assert.AreEqual(AiDraftStatus.Failed, operation.Status);
        Assert.IsNull(operation.ValidatedDraftJson);
        Assert.ThrowsExactly<InvalidOperationException>(() => operation.Review(true, Guid.NewGuid(), new DateTimeOffset(2026, 8, 22, 12, 0, 0, TimeSpan.Zero)));
    }

    [TestMethod]
    public void MealPlanTemplateRequiresEveryDayToHaveAPrescription()
    {
        var template = MealPlanTemplate.Create(Guid.NewGuid(), "Two-day plan");
        var choice = new MealChoiceInput(Guid.NewGuid(), "Meal", 1m, 500m, 30m, 50m, 20m);

        Assert.ThrowsExactly<ArgumentException>(() =>
            template.AddDraft(2, 2_000m, 150m, 220m, 60m, [new MealSlotInput(0, 0, "Day one", [choice])]));
    }
}
