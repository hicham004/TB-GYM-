using System.Text.Json;
using TB.Gym.Modules.Training;

namespace TB.Gym.Domain.Tests;

/// <summary>Week progression v1 (WeekStep, TRN-025): copies one week with per-copy steps, as plain numbers.</summary>
[TestClass]
public sealed class WeekProgressionDomainTests
{
    private static readonly Guid SquatId = Guid.Parse("40000000-0000-0000-0000-000000000001");
    private static readonly Guid BenchId = Guid.Parse("40000000-0000-0000-0000-000000000002");
    private static readonly Guid DeadliftId = Guid.Parse("40000000-0000-0000-0000-000000000003");
    private static readonly Guid CurlId = Guid.Parse("40000000-0000-0000-0000-000000000004");

    private static readonly IReadOnlyDictionary<Guid, string> Names = new Dictionary<Guid, string>
    {
        [SquatId] = "Back squat",
        [BenchId] = "Bench press",
        [DeadliftId] = "Deadlift",
        [CurlId] = "Curl",
    };

    private static SetPrescriptionRequest Set(
        int position,
        TrainingSetType type = TrainingSetType.Normal,
        int? repsMin = 5,
        int? repsMax = 5,
        TrainingLoadStrategy strategy = TrainingLoadStrategy.None,
        decimal? direct = null,
        decimal? percentage = null,
        decimal? rpe = null,
        decimal? rir = null,
        decimal? manual = null) =>
        new(
            position, type, repsMin, repsMax, strategy, direct,
            strategy == TrainingLoadStrategy.None ? null : TrainingLoadUnit.Kilogram,
            percentage, rpe, rir,
            rir is null ? ExertionDisplayPreference.Rpe : ExertionDisplayPreference.Rir,
            null, null, null, manual);

    private static ExercisePrescriptionRequest Exercise(Guid id, params SetPrescriptionRequest[] sets) =>
        new(id, 1, false, PrescriptionModificationPolicy.CoachApprovedSwap, null, [], sets);

    private static TrainingWeekRequest SourceWeek() =>
        new("Week 1", true,
        [
            new TrainingSessionRequest("Lower A", 0, null,
            [
                Exercise(SquatId,
                    Set(1, TrainingSetType.WarmUp, strategy: TrainingLoadStrategy.Direct, direct: 60m),
                    Set(2, strategy: TrainingLoadStrategy.PercentageWorkingMax, percentage: 70m, rpe: 6m),
                    Set(3, TrainingSetType.BackOff, strategy: TrainingLoadStrategy.RpeChart, rpe: 7m)),
                Exercise(CurlId, Set(1, repsMin: 8, repsMax: 10, rir: 3m)),
            ]),
            new TrainingSessionRequest("Upper A", 2, null,
            [
                Exercise(BenchId,
                    Set(1, strategy: TrainingLoadStrategy.Direct, direct: 100m, rpe: 7m),
                    Set(2, strategy: TrainingLoadStrategy.PercentageWorkingMax, percentage: 80m, rpe: 8m, manual: 102.5m)),
                Exercise(DeadliftId, Set(1, repsMin: 3, repsMax: 3, strategy: TrainingLoadStrategy.RpeChart, rpe: 8m)),
            ]),
        ]);

    private static SetPrescriptionRequest[] Sets(TrainingWeekRequest week) =>
        week.Sessions.SelectMany(session => session.Exercises).SelectMany(exercise => exercise.Sets).ToArray();

    [TestMethod]
    public void EachCopyMovesFurtherFromTheSourceByTheSameStep()
    {
        var steps = new WeekProgressionSteps(RpeStep: 0.5m, RepetitionsStep: 0, PercentageStep: 2.5m, LoadStep: 2.5m);

        var copies = WeekStepProgressionTransform.Generate(SourceWeek(), steps, 3, Names);

        Assert.HasCount(3, copies);
        for (var copy = 1; copy <= 3; copy++)
        {
            var sets = Sets(copies[copy - 1]);
            Assert.AreEqual(60m, sets[0].DirectLoad, "warm-up weight stays");
            Assert.AreEqual(70m + 2.5m * copy, sets[1].PercentageWorkingMax);
            Assert.AreEqual(6m + 0.5m * copy, sets[1].TargetRpe);
            Assert.AreEqual(7m + 0.5m * copy, sets[2].TargetRpe, "an RPE-chart set moves its RPE");
            Assert.IsNull(sets[2].DirectLoad);
            Assert.AreEqual(10m - (7m + 0.5m * copy), sets[3].TargetRir, "an RIR target falls as RPE rises");
            Assert.IsNull(sets[3].TargetRpe);
            Assert.AreEqual(100m + 2.5m * copy, sets[4].DirectLoad, "a fixed weight steps by the weight step");
            Assert.AreEqual(7m + 0.5m * copy, sets[4].TargetRpe);
            Assert.AreEqual(80m + 2.5m * copy, sets[5].PercentageWorkingMax);
            Assert.AreEqual(102.5m + 2.5m * copy, sets[5].ManualLoadOverride, "a typed weight steps with the weight step");
            Assert.AreEqual(8m + 0.5m * copy, sets[6].TargetRpe);
        }
    }

    [TestMethod]
    public void RepetitionsStepMovesBothEndsOfARangeAndSkipsWarmUps()
    {
        var steps = new WeekProgressionSteps(0m, RepetitionsStep: 1, 0m, 0m);

        var copies = WeekStepProgressionTransform.Generate(SourceWeek(), steps, 2, Names);

        var first = Sets(copies[0]);
        var second = Sets(copies[1]);
        Assert.AreEqual(5, first[0].RepetitionsMinimum, "warm-up reps stay");
        Assert.AreEqual(6, first[1].RepetitionsMinimum);
        Assert.AreEqual(6, first[1].RepetitionsMaximum);
        Assert.AreEqual(9, first[3].RepetitionsMinimum);
        Assert.AreEqual(11, first[3].RepetitionsMaximum);
        Assert.AreEqual(7, second[1].RepetitionsMinimum);
        Assert.AreEqual(5, second[6].RepetitionsMinimum, "the deadlift's 3 reps plus 2 steps");
    }

    [TestMethod]
    public void ZeroStepsGiveExactCopiesAndTheSourceIsNeverChanged()
    {
        var source = SourceWeek();
        var before = JsonSerializer.Serialize(source);

        var copies = WeekStepProgressionTransform.Generate(source, new WeekProgressionSteps(0m, 0, 0m, 0m), 2, Names);

        Assert.AreEqual(before, JsonSerializer.Serialize(source));
        Assert.AreEqual(before, JsonSerializer.Serialize(copies[0]));
        Assert.AreEqual(before, JsonSerializer.Serialize(copies[1]));
        Assert.AreNotSame(copies[0], copies[1]);
    }

    [TestMethod]
    public void TheSameRequestAlwaysGivesTheSameWeeks()
    {
        var steps = new WeekProgressionSteps(0.5m, 1, 1.25m, -2.5m);

        var first = JsonSerializer.Serialize(WeekStepProgressionTransform.Generate(SourceWeek(), steps, 4, Names));
        var second = JsonSerializer.Serialize(WeekStepProgressionTransform.Generate(SourceWeek(), steps, 4, Names));

        Assert.AreEqual(first, second);
    }

    [TestMethod]
    public void ResultsOutsideASetsLimitsRefuseTheWholeCopyAndSayWhere()
    {
        // RPE 8 + 0.5 x 5 = 10.5 on copy 5, so asking for five copies is refused and names the set.
        var rpe = Assert.ThrowsExactly<ArgumentException>(() => WeekStepProgressionTransform.Generate(
            SourceWeek(), new WeekProgressionSteps(0.5m, 0, 0m, 0m), 5, Names));
        StringAssert.Contains(rpe.Message, "Copy 5");
        StringAssert.Contains(rpe.Message, "Upper A");
        StringAssert.Contains(rpe.Message, "Bench press");
        StringAssert.Contains(rpe.Message, "set 2");
        StringAssert.Contains(rpe.Message, "RPE would be 10.5");

        var reps = Assert.ThrowsExactly<ArgumentException>(() => WeekStepProgressionTransform.Generate(
            SourceWeek(), new WeekProgressionSteps(0m, -1, 0m, 0m), 3, Names));
        StringAssert.Contains(reps.Message, "repetitions would be 0");

        var percentage = Assert.ThrowsExactly<ArgumentException>(() => WeekStepProgressionTransform.Generate(
            SourceWeek(), new WeekProgressionSteps(0m, 0, 20m, 0m), 4, Names));
        // 70% and 80% plus 20 points a copy: the 80% set is the first past 150 (160 on copy 4).
        StringAssert.Contains(percentage.Message, "the percentage would be 160");

        var weight = Assert.ThrowsExactly<ArgumentException>(() => WeekStepProgressionTransform.Generate(
            SourceWeek(), new WeekProgressionSteps(0m, 0, 0m, -60m), 2, Names));
        StringAssert.Contains(weight.Message, "the weight would be");
    }

    [TestMethod]
    [DataRow(0.3, 0, 0.0, 0.0)]
    [DataRow(2.5, 0, 0.0, 0.0)]
    [DataRow(0.0, 21, 0.0, 0.0)]
    [DataRow(0.0, 0, 50.5, 0.0)]
    [DataRow(0.0, 0, 1.005, 0.0)]
    [DataRow(0.0, 0, 0.0, 500.5)]
    [DataRow(0.0, 0, 0.0, 1.005)]
    public void StepsOutsideTheirRangesAreRefusedBeforeAnythingIsCopied(
        double rpe, int reps, double percentage, double load)
    {
        var steps = new WeekProgressionSteps((decimal)rpe, reps, (decimal)percentage, (decimal)load);

        Assert.ThrowsExactly<ArgumentException>(() => WeekStepProgressionTransform.ValidateSteps(steps));
        Assert.ThrowsExactly<ArgumentException>(() => WeekStepProgressionTransform.Generate(
            SourceWeek(), steps, 1, Names));
    }

    [TestMethod]
    [DataRow(0)]
    [DataRow(13)]
    public void OnlyOneToTwelveCopiesAreAllowed(int copies)
    {
        Assert.ThrowsExactly<ArgumentException>(() => WeekStepProgressionTransform.Generate(
            SourceWeek(), new WeekProgressionSteps(0m, 0, 0m, 0m), copies, Names));
    }

    [TestMethod]
    public void TwelveCopiesAtTheLimitsAreAllowed()
    {
        var week = new TrainingWeekRequest("W", true,
        [
            new TrainingSessionRequest("Day", 0, null,
            [Exercise(SquatId, Set(1, strategy: TrainingLoadStrategy.PercentageWorkingMax, percentage: 60m, rpe: 5m))]),
        ]);

        // 5 + 0.5 x 10 = 10, so ten copies end exactly on RPE 10; 12 copies would pass it.
        var ten = WeekStepProgressionTransform.Generate(week, new WeekProgressionSteps(0.5m, 0, 0m, 0m), 10, Names);
        Assert.AreEqual(10m, Sets(ten[9])[0].TargetRpe);
        Assert.ThrowsExactly<ArgumentException>(() => WeekStepProgressionTransform.Generate(
            week, new WeekProgressionSteps(0.5m, 0, 0m, 0m), 12, Names));
        Assert.HasCount(12, WeekStepProgressionTransform.Generate(
            week, new WeekProgressionSteps(0m, 0, 1m, 0m), 12, Names));
    }
}
