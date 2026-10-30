using TB.Gym.Modules.Nutrition;
using TB.Gym.SharedKernel;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// Critique B8a (NUT-015): energy model version 2. Every cell of the new table, version 1's nine cells as they always
/// were, the steps bands' edges, the workouts' term, the words beside the multiplier, the coach's own multiplier, what
/// steps are worth, a goal's rate and share, the floors, and the preview that works out what the sheet has so far.
/// </summary>
[TestClass]
public sealed class B8aEnergyModelDomainTests
{
    /// <summary>Elie, from Toufic's screenshot: 97.4 kg, 178 cm, 42, male, mixed work, 5,000 steps.</summary>
    private static readonly BmrInput Elie = new(97.4m, 178m, 42, FormulaSex.Male);

    private static readonly string[] BothFloors =
    [
        "The target, 1,150 calories a day, is under what their body burns at rest (1,300). This is a warning, not a clinical determination.",
        "The target, 1,150 calories a day, is under 1,200, the floor most calculators keep for women. This is a warning, not a clinical determination.",
    ];

    /// <summary>The targets sheet's five goal picks for Elie, who burns 3,160.92 a day.</summary>
    private static readonly string[] ElieGoals =
    [
        "−500 a day ≈ 0.5 kg a week, 84% of what they burn",
        "−300 a day ≈ 0.3 kg a week, 91% of what they burn",
        "0 a day ≈ no change in weight, 100% of what they burn",
        "+250 a day ≈ 0.2 kg a week, 108% of what they burn",
        "+400 a day ≈ 0.4 kg a week, 113% of what they burn",
    ];

    private static readonly OccupationActivityType[] VersionOneKinds =
        [OccupationActivityType.Seated, OccupationActivityType.Mixed, OccupationActivityType.Physical];

    private static readonly OccupationActivityType[] VersionTwoKinds =
        [OccupationActivityType.Seated, OccupationActivityType.Mixed, OccupationActivityType.OnTheirFeet, OccupationActivityType.HeavyManual];

    [TestMethod]
    [DataRow(OccupationActivityType.Seated, 3_000, "1.45")]
    [DataRow(OccupationActivityType.Seated, 6_000, "1.50")]
    [DataRow(OccupationActivityType.Seated, 8_000, "1.55")]
    [DataRow(OccupationActivityType.Seated, 11_000, "1.60")]
    [DataRow(OccupationActivityType.Seated, 14_000, "1.65")]
    [DataRow(OccupationActivityType.Mixed, 3_000, "1.55")]
    [DataRow(OccupationActivityType.Mixed, 6_000, "1.60")]
    [DataRow(OccupationActivityType.Mixed, 8_000, "1.65")]
    [DataRow(OccupationActivityType.Mixed, 11_000, "1.70")]
    [DataRow(OccupationActivityType.Mixed, 14_000, "1.75")]
    [DataRow(OccupationActivityType.OnTheirFeet, 3_000, "1.65")]
    [DataRow(OccupationActivityType.OnTheirFeet, 6_000, "1.70")]
    [DataRow(OccupationActivityType.OnTheirFeet, 8_000, "1.75")]
    [DataRow(OccupationActivityType.OnTheirFeet, 11_000, "1.80")]
    [DataRow(OccupationActivityType.OnTheirFeet, 14_000, "1.85")]
    [DataRow(OccupationActivityType.HeavyManual, 3_000, "1.90")]
    [DataRow(OccupationActivityType.HeavyManual, 6_000, "1.95")]
    [DataRow(OccupationActivityType.HeavyManual, 8_000, "2.00")]
    [DataRow(OccupationActivityType.HeavyManual, 11_000, "2.05")]
    [DataRow(OccupationActivityType.HeavyManual, 14_000, "2.10")]
    public void B8aEveryCellOfVersionTwosTableIsPinned(OccupationActivityType kind, int steps, string cell)
    {
        var expected = decimal.Parse(cell, System.Globalization.CultureInfo.InvariantCulture);

        var result = OccupationStepsActivityModelVersion2.Calculate(new ActivityModelInput(kind, steps, 0));

        Assert.AreEqual(expected, result.Pal);
        Assert.AreEqual(expected, OccupationStepsActivityModelVersion2.TableValue(kind, OccupationStepsActivityModelVersion2.BandFor(steps)));
        Assert.AreEqual(("OccupationStepsPal", "2.0"), (result.MethodKey, result.MethodVersion));
        Assert.AreEqual(PalGuard.BandFor(expected), result.Band);
    }

    [TestMethod]
    [DataRow(OccupationActivityType.Seated, 3_000, "1.50")]
    [DataRow(OccupationActivityType.Seated, 6_000, "1.70")]
    [DataRow(OccupationActivityType.Seated, 12_000, "1.85")]
    [DataRow(OccupationActivityType.Mixed, 3_000, "1.65")]
    [DataRow(OccupationActivityType.Mixed, 6_000, "1.80")]
    [DataRow(OccupationActivityType.Mixed, 12_000, "2.00")]
    [DataRow(OccupationActivityType.Physical, 3_000, "1.80")]
    [DataRow(OccupationActivityType.Physical, 6_000, "2.00")]
    [DataRow(OccupationActivityType.Physical, 12_000, "2.20")]
    public void B8aVersionOneKeepsItsNineCellsForEveryCalculationMadeWithIt(OccupationActivityType kind, int steps, string cell)
    {
        var result = EnergyModels.Activity(EnergyModelVersion.Version1, new ActivityRequest(kind, steps));

        Assert.AreEqual(decimal.Parse(cell, System.Globalization.CultureInfo.InvariantCulture), result.Pal);
        Assert.AreEqual(("OccupationStepsPal", "1.0"), (result.MethodKey, result.MethodVersion));
        Assert.IsNull(EnergyModels.Words(result.MethodKey, result.MethodVersion, new ActivityRequest(kind, steps, 0)), "Version 1 has no words beside its multiplier.");
    }

    [TestMethod]
    [DataRow(0, StepsBand.Sedentary)]
    [DataRow(4_999, StepsBand.Sedentary)]
    [DataRow(5_000, StepsBand.LowActive)]
    [DataRow(7_499, StepsBand.LowActive)]
    [DataRow(7_500, StepsBand.SomewhatActive)]
    [DataRow(9_999, StepsBand.SomewhatActive)]
    [DataRow(10_000, StepsBand.Active)]
    [DataRow(12_499, StepsBand.Active)]
    [DataRow(12_500, StepsBand.HighlyActive)]
    [DataRow(100_000, StepsBand.HighlyActive)]
    public void B8aTheStepsBandsStartWhereTudorLockesDo(int steps, StepsBand band) =>
        Assert.AreEqual(band, OccupationStepsActivityModelVersion2.BandFor(steps));

    [TestMethod]
    public void B8aEachWorkoutAWeekAddsTwoHundredthsUpToFourteen()
    {
        for (var workouts = 0; workouts <= 7; workouts++)
        {
            Assert.AreEqual(workouts * 0.02m, OccupationStepsActivityModelVersion2.TermFor(workouts));
        }

        // Toufic's Elie with four workouts, the most the table and the term can reach, and the least.
        Assert.AreEqual(1.68m, Pal(OccupationActivityType.Mixed, 5_000, 4));
        Assert.AreEqual(2.24m, Pal(OccupationActivityType.HeavyManual, 12_500, 7));
        Assert.AreEqual(1.45m, Pal(OccupationActivityType.Seated, 0, 0));
        Assert.IsLessThanOrEqualTo(PalGuard.Maximum, Pal(OccupationActivityType.HeavyManual, 100_000, 7));

        foreach (var workouts in new int?[] { -1, 8, null })
        {
            var refusal = Assert.ThrowsExactly<EnergyModelInputException>(() =>
                EnergyModels.Activity(EnergyModelVersion.Version2, new ActivityRequest(OccupationActivityType.Mixed, 5_000, workouts)));
            Assert.AreEqual("workoutsPerWeek", refusal.ParamName);
            Assert.AreEqual("Say how many workouts a week they do, from 0 to 7.", refusal.PersonMessage());
        }
    }

    [TestMethod]
    public void B8aEachVersionTakesOnlyItsOwnInputsAndSaysSo()
    {
        foreach (var kind in new[] { OccupationActivityType.OnTheirFeet, OccupationActivityType.HeavyManual })
        {
            var refusal = Assert.ThrowsExactly<EnergyModelInputException>(() =>
                EnergyModels.Activity(EnergyModelVersion.Version1, new ActivityRequest(kind, 6_000)));
            Assert.AreEqual("occupationType", refusal.ParamName);
            StringAssert.Contains(refusal.PersonMessage(), "Choose seated, mixed or physical.");
        }

        // Version 1 never gives a kind it does not know its default 2.20.
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() =>
            OccupationStepsActivityModel.Calculate(new ActivityModelInput(OccupationActivityType.OnTheirFeet, 6_000)));

        var workouts = Assert.ThrowsExactly<EnergyModelInputException>(() =>
            EnergyModels.Activity(EnergyModelVersion.Version1, new ActivityRequest(OccupationActivityType.Mixed, 6_000, 3)));
        Assert.AreEqual("workoutsPerWeek", workouts.ParamName);
        var chosen = Assert.ThrowsExactly<EnergyModelInputException>(() =>
            EnergyModels.Activity(EnergyModelVersion.Version1, new ActivityRequest(OccupationActivityType.Mixed, 6_000, ChosenPal: 1.55m)));
        Assert.AreEqual("chosenPal", chosen.ParamName);

        var physical = Assert.ThrowsExactly<EnergyModelInputException>(() =>
            EnergyModels.Activity(EnergyModelVersion.Version2, new ActivityRequest(OccupationActivityType.Physical, 6_000, 3)));
        Assert.AreEqual("occupationType", physical.ParamName);
        Assert.AreEqual(
            "Physical work is split in two now: choose on their feet (teaching, retail, nursing, serving) or heavy manual work (building, farm, moving loads).",
            physical.PersonMessage());

        var steps = Assert.ThrowsExactly<EnergyModelInputException>(() =>
            EnergyModels.Activity(EnergyModelVersion.Version2, new ActivityRequest(OccupationActivityType.Mixed, 100_001, 3)));
        Assert.AreEqual("averageDailySteps", steps.ParamName);
    }

    [TestMethod]
    public void B8aTheWordsBesideTheMultiplierAreTheCritiques()
    {
        Assert.AreEqual(
            "Counts as low active: × 1.68 (mixed work with 5,000 steps a day × 1.60, plus 4 workouts a week + 0.08)",
            WordsOf(OccupationActivityType.Mixed, 5_000, 4).Words);
        Assert.AreEqual(
            "Counts as sedentary: × 1.45 (seated work with 3,000 steps a day, no workouts a week)",
            WordsOf(OccupationActivityType.Seated, 3_000, 0).Words);
        Assert.AreEqual(
            "Counts as active: × 1.82 (work on their feet with 11,000 steps a day × 1.80, plus 1 workout a week + 0.02)",
            WordsOf(OccupationActivityType.OnTheirFeet, 11_000, 1).Words);
        Assert.AreEqual(
            "Counts as highly active: × 2.24 (heavy manual work with 14,000 steps a day × 2.10, plus 7 workouts a week + 0.14)",
            WordsOf(OccupationActivityType.HeavyManual, 14_000, 7).Words);
        Assert.AreEqual(
            "Counts as somewhat active: × 1.61 (seated work with 8,000 steps a day × 1.55, plus 3 workouts a week + 0.06)",
            WordsOf(OccupationActivityType.Seated, 8_000, 3).Words);

        var elie = WordsOf(OccupationActivityType.Mixed, 5_000, 4);
        Assert.AreEqual(
            (1.68m, StepsBand.LowActive, "low active", 1.60m, 4, 0.08m, (string?)null, (string?)null),
            (elie.Pal, elie.StepsBand, elie.StepsBandName, elie.TableValue, elie.WorkoutsPerWeek, elie.WorkoutTerm, elie.ChosenWords, elie.Reason));
    }

    [TestMethod]
    public void B8aElieComesToTheCritiquesNumbers()
    {
        var bmr = new MifflinStJeorBmrStrategy().Estimate(Elie);
        var withWorkouts = TdeeEstimator.Estimate(bmr, EnergyModels.Activity(EnergyModelVersion.Version2, new ActivityRequest(OccupationActivityType.Mixed, 5_000, 4)));
        var without = TdeeEstimator.Estimate(bmr, EnergyModels.Activity(EnergyModelVersion.Version2, new ActivityRequest(OccupationActivityType.Mixed, 5_000, 0)));

        Assert.AreEqual(1_881.5m, bmr.KilocaloriesPerDay);
        Assert.AreEqual(3_160.92m, withWorkouts.KilocaloriesPerDay, "1,882 × 1.68 = 3,161 in the critique.");
        Assert.AreEqual(3_010.4m, without.KilocaloriesPerDay, "1.60 without workouts: 3,010.");
        Assert.AreEqual(("BmrTimesPal", "1.0"), (withWorkouts.MethodKey, withWorkouts.MethodVersion));
        Assert.AreEqual("−500 a day ≈ 0.5 kg a week, 84% of what they burn", WeeklyWeightChange.Describe(-500m, withWorkouts.KilocaloriesPerDay).Words);
        Assert.AreEqual("Their 5,000 steps are inside that, worth about 180 calories a day at 97 kg.", WalkingCost.Describe(5_000, Elie.WeightKilograms)!.Words);
    }

    [TestMethod]
    public void B8aTheCoachChoosesTheirOwnMultiplierInsideTheGuard()
    {
        foreach (var pal in new[] { 1.40m, 1.725m, 2.40m, 1.62m })
        {
            var result = EnergyModels.Activity(EnergyModelVersion.Version2, new ActivityRequest(OccupationActivityType.Seated, 3_000, 2, pal));
            Assert.AreEqual((pal, "CoachChosenPal", "1.0"), (result.Pal, result.MethodKey, result.MethodVersion));
        }

        foreach (var (pal, words) in new[]
        {
            (1.2m, "A multiplier of 1.2 is under 1.40, the lowest FAO/WHO/UNU's scale gives a healthy adult's whole day. Choose one from 1.40 to 2.40."),
            (1.375m, "A multiplier of 1.375 is under 1.40, the lowest FAO/WHO/UNU's scale gives a healthy adult's whole day. Choose one from 1.40 to 2.40."),
            (2.41m, "A multiplier of 2.41 is over 2.40, the highest FAO/WHO/UNU's scale gives a whole day that can be kept up. Choose one from 1.40 to 2.40."),
            (1.7255m, "Type the multiplier with at most three decimals, like 1.725."),
        })
        {
            var refusal = Assert.ThrowsExactly<EnergyModelInputException>(() =>
                EnergyModels.Activity(EnergyModelVersion.Version2, new ActivityRequest(OccupationActivityType.Seated, 3_000, 2, pal)));
            Assert.AreEqual(("chosenPal", words), (refusal.ParamName, refusal.PersonMessage()));
        }

        // A pick says its words; a typed number says only itself. The reason is kept trimmed, and none when empty.
        var picked = EnergyModels.Words(CoachChosenPal.Key, CoachChosenPal.Version, new ActivityRequest(OccupationActivityType.Seated, 3_000, 2, 1.55m, "  Trains for a marathon. "))!;
        Assert.AreEqual("Chosen by the coach: × 1.55 (moderate exercise 3 to 5 days a week)", picked.Words);
        Assert.AreEqual(("moderate exercise 3 to 5 days a week", "Trains for a marathon.", (decimal?)null, (decimal?)null), (picked.ChosenWords, picked.Reason, picked.TableValue, picked.WorkoutTerm));
        Assert.AreEqual("Chosen by the coach: × 1.62", EnergyModels.Words(CoachChosenPal.Key, CoachChosenPal.Version, new ActivityRequest(OccupationActivityType.Seated, 3_000, 2, 1.62m))!.Words);
        Assert.AreEqual("Chosen by the coach: × 1.725 (hard exercise 6 to 7 days a week)", EnergyModels.Words(CoachChosenPal.Key, CoachChosenPal.Version, new ActivityRequest(OccupationActivityType.Seated, 3_000, 2, 1.725m))!.Words);
        Assert.IsNull(CoachChosenPal.Reason("   "));
        Assert.AreEqual("chosenPalReason", Assert.ThrowsExactly<EnergyModelInputException>(() => CoachChosenPal.Reason(new string('a', 501))).ParamName);
        Assert.AreEqual(new string('a', 500), CoachChosenPal.Reason(new string('a', 500)));
        var orphan = Assert.ThrowsExactly<EnergyModelInputException>(() =>
            EnergyModels.Activity(EnergyModelVersion.Version2, new ActivityRequest(OccupationActivityType.Seated, 3_000, 2, null, "Because")));
        Assert.AreEqual("chosenPalReason", orphan.ParamName);

        // The picks climb from FAO/WHO/UNU's lowest whole day to its highest, in the critique's words at both ends shown.
        var picks = CoachChosenPal.Picks;
        Assert.AreEqual((1.40m, "little movement, no exercise"), (picks[0].Pal, picks[0].Words));
        Assert.IsTrue(picks.Any(pick => pick is { Pal: 1.90m, Words: "very hard training daily or heavy manual work" }));
        Assert.AreEqual(2.40m, picks[^1].Pal);
        CollectionAssert.AreEqual(picks.Select(pick => pick.Pal).Order().ToArray(), picks.Select(pick => pick.Pal).ToArray());
        Assert.IsTrue(picks.All(pick => pick.Pal is >= PalGuard.Minimum and <= PalGuard.Maximum));
    }

    [TestMethod]
    public void B8aWhatStepsAreWorthIsSaidAndNeverAdded()
    {
        var elie = WalkingCost.Describe(5_000, 97.4m)!;
        Assert.AreEqual((180m, "WalkingCost", "1.0"), (elie.Kilocalories, elie.MethodKey, elie.MethodVersion));

        // 0.5 kcal a kilogram and kilometre at 0.75 m a step, rounded to ten, half away from zero.
        Assert.AreEqual(230m, WalkingCost.Kilocalories(10_000, 60m), "225 kcal rounds up to 230.");
        Assert.AreEqual(10m, WalkingCost.Kilocalories(150, 100m), "5.6 kcal is about 10.");
        Assert.IsNull(WalkingCost.Describe(100, 50m), "1.9 kcal is not worth a line.");
        Assert.IsNull(WalkingCost.Describe(0, 80m));
        Assert.AreEqual("Their 12,000 steps are inside that, worth about 280 calories a day at 63 kg.", WalkingCost.Describe(12_000, 62.5m)!.Words);
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => WalkingCost.Kilocalories(5_000, 0m));
    }

    [TestMethod]
    public void B8aAGoalSaysItsRateAndShareByANamedRule()
    {
        var cut = WeeklyWeightChange.Describe(-500m, 3_160.92m);
        Assert.AreEqual((-0.5m, 84m, "WeeklyWeightChange", "1.0"), (cut.KilogramsPerWeek, cut.ShareOfMaintenance, cut.MethodKey, cut.MethodVersion));
        Assert.AreEqual(-500m * 7m / 7_700m, WeeklyWeightChange.KilogramsPerWeek(-500m), "The rate is kept unrounded; only its words round.");

        Assert.AreEqual("+250 a day ≈ 0.2 kg a week, 108% of what they burn", WeeklyWeightChange.Describe(250m, 3_160.92m).Words);
        Assert.AreEqual("0 a day ≈ no change in weight, 100% of what they burn", WeeklyWeightChange.Describe(0m, 3_160.92m).Words);
        Assert.AreEqual("−20 a day ≈ under 0.1 kg a week, 99% of what they burn", WeeklyWeightChange.Describe(-20m, 3_160.92m).Words);
        Assert.AreEqual("−1,000 a day ≈ 0.9 kg a week, 68% of what they burn", WeeklyWeightChange.Describe(-1_000m, 3_160.92m).Words);
        Assert.AreEqual("−300 a day ≈ 0.3 kg a week", WeeklyWeightChange.Describe(-300m, null).Words, "No share until what they burn is known.");
        Assert.AreEqual("−4,000 a day is more than they burn", WeeklyWeightChange.Describe(-4_000m, 3_000m).Words);
        Assert.IsNull(WeeklyWeightChange.Describe(-4_000m, 3_000m).ShareOfMaintenance);
    }

    [TestMethod]
    public void B8aTheFloorsWarnAndNeverRefuse()
    {
        CollectionAssert.AreEqual(BothFloors, EnergyTargetFloors.Warnings(1_150m, 1_300m, FormulaSex.Female).ToArray());
        Assert.AreEqual(
            "The target, 1,450 calories a day, is under 1,500, the floor most calculators keep for men. This is a warning, not a clinical determination.",
            EnergyTargetFloors.Warnings(1_450m, 1_400m, FormulaSex.Male).Single());
        StringAssert.Contains(EnergyTargetFloors.Warnings(1_600m, 1_700m, FormulaSex.Male).Single(), "under what their body burns at rest (1,700)");
        Assert.IsEmpty(EnergyTargetFloors.Warnings(1_200m, 1_100m, FormulaSex.Female), "At the floor is not under it.");
        Assert.IsEmpty(EnergyTargetFloors.Warnings(1_400m, 1_300m, FormulaSex.Female), "1,400 is under the men's floor, not the women's.");
    }

    [TestMethod]
    public void B8aThePreviewWorksOutWhatTheSheetHasSoFar()
    {
        var nothing = EnergyPreviews.Work(new PreviewEnergyRequest());
        Assert.AreEqual((null, null, null, null), (nothing.Activity, nothing.Walking, nothing.BmrEstimate, nothing.TdeeEstimate));
        Assert.IsEmpty(nothing.Goals);

        // The activity alone gives the line under "How active they are"; the goals have their rate but no share yet.
        var activityOnly = EnergyPreviews.Work(new PreviewEnergyRequest(OccupationType: OccupationActivityType.Mixed, AverageDailySteps: 5_000, WorkoutsPerWeek: 4, GoalAdjustments: [-500m]));
        Assert.AreEqual("Counts as low active: × 1.68 (mixed work with 5,000 steps a day × 1.60, plus 4 workouts a week + 0.08)", activityOnly.Activity!.Words);
        Assert.IsNull(activityOnly.TdeeEstimate);
        Assert.AreEqual("−500 a day ≈ 0.5 kg a week", activityOnly.Goals.Single().Words);

        var whole = EnergyPreviews.Work(ElieSoFar(goalAdjustments: [-500m, -300m, 0m, 250m, 400m]));
        Assert.AreEqual((1_881.5m, 3_160.92m), (whole.BmrEstimate, whole.TdeeEstimate));
        Assert.AreEqual("Their 5,000 steps are inside that, worth about 180 calories a day at 97 kg.", whole.Walking!.Words);
        CollectionAssert.AreEqual(ElieGoals, whole.Goals.Select(goal => goal.Words).ToArray());

        // The coach's own multiplier takes the table's place.
        var chosen = EnergyPreviews.Work(ElieSoFar(chosenPal: 1.55m));
        Assert.AreEqual(("CoachChosenPal", 2_916.325m), (chosen.Activity!.MethodKey, chosen.TdeeEstimate));

        // Katch-McArdle waits for body fat; an unknown formula, a wrong number or too many goals is refused at once.
        Assert.IsNull(EnergyPreviews.Work(ElieSoFar(bmrMethodKey: KatchMcArdleBmrStrategy.Key)).BmrEstimate);
        Assert.AreEqual(1_842.688m, EnergyPreviews.Work(ElieSoFar(bmrMethodKey: KatchMcArdleBmrStrategy.Key, bodyFatPercentage: 30m)).BmrEstimate);
        Assert.AreEqual("bmrMethodKey", Assert.ThrowsExactly<EnergyModelInputException>(() => EnergyPreviews.Work(new PreviewEnergyRequest(BmrMethodKey: "Ladder"))).ParamName);
        Assert.AreEqual("averageDailySteps", Assert.ThrowsExactly<EnergyModelInputException>(() => EnergyPreviews.Work(new PreviewEnergyRequest(AverageDailySteps: -1))).ParamName);
        Assert.AreEqual("workoutsPerWeek", Assert.ThrowsExactly<EnergyModelInputException>(() => EnergyPreviews.Work(new PreviewEnergyRequest(WorkoutsPerWeek: 9))).ParamName);
        Assert.AreEqual("chosenPal", Assert.ThrowsExactly<EnergyModelInputException>(() => EnergyPreviews.Work(new PreviewEnergyRequest(ChosenPal: 1.375m))).ParamName);
        Assert.AreEqual("occupationType", Assert.ThrowsExactly<EnergyModelInputException>(() => EnergyPreviews.Work(new PreviewEnergyRequest(OccupationType: OccupationActivityType.Physical))).ParamName);
        Assert.AreEqual("weightKilograms", Assert.ThrowsExactly<EnergyModelInputException>(() => EnergyPreviews.Work(new PreviewEnergyRequest(WeightKilograms: 0m))).ParamName);
        Assert.AreEqual("goalAdjustments", Assert.ThrowsExactly<EnergyModelInputException>(() => EnergyPreviews.Work(new PreviewEnergyRequest(GoalAdjustments: [.. Enumerable.Repeat(0m, 11)]))).ParamName);
        Assert.AreEqual("goalAdjustments", Assert.ThrowsExactly<EnergyModelInputException>(() => EnergyPreviews.Work(new PreviewEnergyRequest(GoalAdjustments: [-5_001m]))).ParamName);
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => EnergyPreviews.Work(ElieSoFar(ageYears: 17)));
    }

    [TestMethod]
    public void B8aEachVersionSaysWhatTheSheetShouldAskFor()
    {
        var one = EnergyModels.Describe(EnergyModelVersion.Version1);
        Assert.AreEqual((1, "OccupationStepsPal", "1.0", (int?)null, (CoachChosenPalView?)null), (one.Version, one.ActivityModelKey, one.ActivityModelVersion, one.MaximumWorkoutsPerWeek, one.CoachChosen));
        CollectionAssert.AreEqual(VersionOneKinds, one.KindsOfWork.ToArray());

        var two = EnergyModels.Describe(EnergyModelVersion.Version2);
        Assert.AreEqual((2, "OccupationStepsPal", "2.0", (int?)7), (two.Version, two.ActivityModelKey, two.ActivityModelVersion, two.MaximumWorkoutsPerWeek));
        CollectionAssert.AreEqual(VersionTwoKinds, two.KindsOfWork.ToArray());
        Assert.AreEqual(("CoachChosenPal", "1.0", 1.40m, 2.40m), (two.CoachChosen!.MethodKey, two.CoachChosen.MethodVersion, two.CoachChosen.Minimum, two.CoachChosen.Maximum));
        Assert.AreSame(CoachChosenPal.Picks, two.CoachChosen.Picks);
    }

    private static decimal Pal(OccupationActivityType kind, int steps, int workouts) =>
        EnergyModels.Activity(EnergyModelVersion.Version2, new ActivityRequest(kind, steps, workouts)).Pal;

    private static ActivityWords WordsOf(OccupationActivityType kind, int steps, int workouts)
    {
        var request = new ActivityRequest(kind, steps, workouts);
        var result = EnergyModels.Activity(EnergyModelVersion.Version2, request);
        var words = EnergyModels.Words(result.MethodKey, result.MethodVersion, request);
        Assert.IsNotNull(words);
        Assert.AreEqual(result.Pal, words.Pal, "The words name the multiplier the calculation used.");
        return words;
    }

    private static PreviewEnergyRequest ElieSoFar(
        string bmrMethodKey = MifflinStJeorBmrStrategy.Key,
        int ageYears = 42,
        decimal? bodyFatPercentage = null,
        decimal? chosenPal = null,
        IReadOnlyList<decimal>? goalAdjustments = null) =>
        new(bmrMethodKey, 97.4m, 178m, ageYears, FormulaSex.Male, bodyFatPercentage, OccupationActivityType.Mixed, 5_000, 4, chosenPal, goalAdjustments);
}
