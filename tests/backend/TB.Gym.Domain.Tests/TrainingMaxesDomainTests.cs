using TB.Gym.Modules.Strength;
using TB.Gym.Modules.Training;
using StrengthLoadUnit = TB.Gym.Modules.Strength.LoadUnit;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// P2, training maxes (ADR 0036): the max a week 1 weight implies (STR-011), the week 1 set it is read
/// from (TRN-026), the append-only chain of a program's maxes (STR-002), renaming (TRN-002), and storing
/// recalculated loads only on sets of sessions not started (TRN-004).
/// </summary>
[TestClass]
public sealed class TrainingMaxesDomainTests
{
    private static readonly Guid TenantId = Guid.Parse("10000000-0000-0000-0000-000000000011");
    private static readonly Guid ClientId = Guid.Parse("20000000-0000-0000-0000-000000000011");
    private static readonly Guid SquatId = Guid.Parse("30000000-0000-0000-0000-000000000011");
    private static readonly Guid BenchId = Guid.Parse("30000000-0000-0000-0000-000000000012");

    // ----- the max a weight implies -----

    [TestMethod]
    public void AWeightAtRepsAndRpeImpliesTheMaxTheChartDividesItBy()
    {
        // 5 reps at RPE 7 is 78.6% of the max on the chart, so 100 kg means a max of 100 / 0.786.
        var estimate = RpeChartMaxEstimator.Estimate(100m, 5, 7m, StrengthLoadUnit.Kilogram);

        Assert.AreEqual(127.226m, estimate.Value);
        Assert.AreEqual(78.6m, estimate.Percent);
        Assert.AreEqual(StrengthLoadUnit.Kilogram, estimate.Unit);
        Assert.AreEqual("RpeChart", estimate.StrategyKey);
        Assert.AreEqual("1.0", estimate.Version);
        Assert.AreEqual(
            "RTS RPE chart v1: 5 reps at RPE 7 is 78.6% of the max, so 100 kg / 78.6% = 127.226 kg.",
            estimate.Explanation);
    }

    [TestMethod]
    public void TheMaxIsKeptInThePoundsTheWeightWasGivenIn()
    {
        var estimate = RpeChartMaxEstimator.Estimate(225m, 3, 8.5m, StrengthLoadUnit.Pound);

        Assert.AreEqual(StrengthLoadUnit.Pound, estimate.Unit);
        Assert.AreEqual(87.8m, estimate.Percent);
        Assert.AreEqual(256.264m, estimate.Value);
        StringAssert.EndsWith(estimate.Explanation, "225 lb / 87.8% = 256.264 lb.");
    }

    [TestMethod]
    public void EveryCellOfTheChartReadsBackToTheWeightItWasGiven()
    {
        // The estimate and the load formula are one table read two ways: a week 1 weight, turned into a
        // max and back into a load for the same reps and RPE, comes out as that weight.
        var strategy = new RpeChartLoadStrategy();
        for (var repetitions = RtsRpeChart.MinimumRepetitions; repetitions <= RtsRpeChart.MaximumRepetitions; repetitions++)
        {
            for (var rpe = RtsRpeChart.MinimumRpe; rpe <= RtsRpeChart.MaximumRpe; rpe += 0.5m)
            {
                var estimate = RpeChartMaxEstimator.Estimate(100m, repetitions, rpe, StrengthLoadUnit.Kilogram);
                var load = strategy.Recommend(new LoadRecommendationInput(
                    PrescriptionLoadStrategy.RpeChart,
                    null,
                    null,
                    estimate.Value,
                    repetitions,
                    rpe,
                    StrengthLoadUnit.Kilogram));

                Assert.IsLessThanOrEqualTo(0.001m, Math.Abs(load.Value - 100m), $"{repetitions} reps at RPE {rpe}");
            }
        }
    }

    [TestMethod]
    public void ASetTheChartDoesNotCoverNeverGetsAGuessedMax()
    {
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(
            () => RpeChartMaxEstimator.Estimate(100m, 5, 6m, StrengthLoadUnit.Kilogram));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(
            () => RpeChartMaxEstimator.Estimate(100m, 13, 8m, StrengthLoadUnit.Kilogram));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(
            () => RpeChartMaxEstimator.Estimate(100m, 5, 7.25m, StrengthLoadUnit.Kilogram));
    }

    [TestMethod]
    public void AWeightOrAMaxOutsideTheLimitsIsRefused()
    {
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(
            () => RpeChartMaxEstimator.Estimate(0m, 5, 7m, StrengthLoadUnit.Kilogram));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(
            () => RpeChartMaxEstimator.Estimate(2_000.5m, 5, 7m, StrengthLoadUnit.Kilogram));
        // 1,900 kg for 12 reps at RPE 6.5 would be a max above 3,000.
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(
            () => RpeChartMaxEstimator.Estimate(1_900m, 12, 6.5m, StrengthLoadUnit.Kilogram));
        Assert.ThrowsExactly<ArgumentException>(
            () => RpeChartMaxEstimator.Estimate(100m, 5, 7m, (StrengthLoadUnit)9));
    }

    // ----- the week 1 set the weight belongs to -----

    [TestMethod]
    public void TheAnchorIsTheFirstWorkingSetOfTheLiftByDayAndPosition()
    {
        var week = Week(
            Session("Friday", 4, Exercise(SquatId, "Back squat", Set(0, reps: 3, rpe: 8m, load: 110m))),
            Session(
                "Monday",
                0,
                Exercise(BenchId, "Bench press", Set(0, reps: 5, rpe: 7m, load: 80m)),
                Exercise(
                    SquatId,
                    "Back squat",
                    Set(0, reps: 5, rpe: 6m, load: 90m), // RPE 6 is outside the chart
                    Set(1, reps: 5, rpe: 7m, load: 100m),
                    Set(2, reps: 5, rpe: 7m, load: 102.5m))));

        var anchor = WeekOneAnchors.Find(week, SquatId, RtsRpeChart.Covers);

        Assert.IsNotNull(anchor);
        Assert.AreEqual("Monday", anchor.SessionName);
        Assert.AreEqual(1, anchor.SetPosition);
        Assert.AreEqual(5, anchor.Repetitions);
        Assert.AreEqual(7m, anchor.Rpe);
        Assert.AreEqual(100m, anchor.Load);
        Assert.AreEqual("Back squat", anchor.ExerciseName);
    }

    [TestMethod]
    public void WarmUpsAndSetsWithoutRepsOrRpeNeverAnchorAWeight()
    {
        var week = Week(Session(
            "Lower",
            0,
            Exercise(
                SquatId,
                "Back squat",
                Set(0, reps: 5, rpe: 7m, load: 60m, type: TrainingSetType.WarmUp),
                Set(1, reps: null, rpe: 7m, load: 100m),
                Set(2, reps: 5, rpe: null, load: 100m),
                Set(3, reps: 4, rpe: 8m, load: null))));

        var anchor = WeekOneAnchors.Find(week, SquatId, RtsRpeChart.Covers);

        Assert.IsNotNull(anchor);
        Assert.AreEqual(3, anchor.SetPosition);
        Assert.AreEqual(4, anchor.Repetitions);
        Assert.IsNull(anchor.Load);
    }

    [TestMethod]
    public void ALiftMissingFromWeekOneOrOutsideTheChartHasNoAnchor()
    {
        var week = Week(Session("Lower", 0, Exercise(SquatId, "Back squat", Set(0, reps: 15, rpe: 7m, load: 60m))));

        Assert.IsNull(WeekOneAnchors.Find(week, SquatId, RtsRpeChart.Covers));
        Assert.IsNull(WeekOneAnchors.Find(week, BenchId, RtsRpeChart.Covers));
    }

    [TestMethod]
    public void AnAssignedSetsPrescribedWeightIsTheAnchorsWeight()
    {
        var calculated = Set(0, reps: 5, rpe: 7m, load: null) with
        {
            LoadStrategy = TrainingLoadStrategy.RpeChart,
            PrescribedLoad = 97.5m,
        };
        var week = Week(Session("Lower", 0, Exercise(SquatId, "Back squat", calculated)));

        Assert.AreEqual(97.5m, WeekOneAnchors.Find(week, SquatId, RtsRpeChart.Covers)!.Load);
    }

    // ----- a program's maxes -----

    [TestMethod]
    public void AMaxKnowsWhereItCameFromWithoutAnyOtherFieldToDisagree()
    {
        var typed = Snapshot(140m, null, null);
        var saved = MesocycleWorkingMaxSnapshot.Capture(
            TenantId, Guid.NewGuid(), ClientId, SquatId, Guid.NewGuid(), 140m, StrengthLoadUnit.Kilogram, 1, null, "Saved max");
        var estimate = RpeChartMaxEstimator.Estimate(100m, 5, 7m, StrengthLoadUnit.Kilogram);
        var worked = MesocycleWorkingMaxSnapshot.CaptureFromWeekOneWeight(
            TenantId, Guid.NewGuid(), ClientId, SquatId, estimate, 100m, 5, 7m, 1, null, "From week 1");

        Assert.AreEqual(WorkingMaxSource.Typed, typed.Source);
        Assert.AreEqual(WorkingMaxSource.SavedMax, saved.Source);
        Assert.AreEqual(WorkingMaxSource.WeekOneWeight, worked.Source);
        Assert.AreEqual(127.226m, worked.Value);
        Assert.AreEqual(100m, worked.BasisLoad);
        Assert.AreEqual(5, worked.BasisRepetitions);
        Assert.AreEqual(7m, worked.BasisRpe);
        Assert.AreEqual("RpeChart", worked.EstimateMethodKey);
        Assert.AreEqual("1.0", worked.EstimateMethodVersion);
        Assert.IsNull(typed.BasisLoad);
        Assert.IsNull(saved.EstimateMethodKey);
    }

    [TestMethod]
    public void ANewMaxNamesTheOneItSupersedesAndTheWeekItAppliesFrom()
    {
        var first = Snapshot(140m, null, null);
        var second = MesocycleWorkingMaxSnapshot.Capture(
            TenantId, first.MesocycleId, ClientId, SquatId, null, 145m, StrengthLoadUnit.Kilogram, 4, first.Id, "New PR in testing");

        Assert.AreEqual(first.Id, second.SupersedesSnapshotId);
        Assert.AreEqual(4, second.EffectiveFromWeek);
        Assert.AreEqual(140m, first.Value);
        Assert.AreEqual(1, first.EffectiveFromWeek);
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => MesocycleWorkingMaxSnapshot.Capture(
            TenantId, first.MesocycleId, ClientId, SquatId, null, 145m, StrengthLoadUnit.Kilogram, 0, first.Id, "No week 0"));
        Assert.ThrowsExactly<ArgumentException>(() => MesocycleWorkingMaxSnapshot.Capture(
            TenantId, first.MesocycleId, ClientId, SquatId, null, 145m, StrengthLoadUnit.Kilogram, 2, first.Id, " "));
    }

    [TestMethod]
    public void ACarriedMaxStartsTheNewProgramsChainWithTheSameClientsLiftUnitAndValue()
    {
        // P4c, STR-014: the next program starts where the last one ended.
        var ended = MesocycleWorkingMaxSnapshot.Capture(
            TenantId, Guid.NewGuid(), ClientId, SquatId, null, 152.5m, StrengthLoadUnit.Pound, 1, null, "Typed");
        var next = Guid.NewGuid();

        var carried = MesocycleWorkingMaxSnapshot.CaptureCarried(TenantId, next, ClientId, ended, "Carried over");

        Assert.AreEqual(WorkingMaxSource.PreviousProgram, carried.Source);
        Assert.AreEqual(
            (next, SquatId, 152.5m, StrengthLoadUnit.Pound, 1, (Guid?)null, (Guid?)ended.Id),
            (carried.MesocycleId, carried.ExerciseId, carried.Value, carried.Unit, carried.EffectiveFromWeek,
                carried.SupersedesSnapshotId, carried.CarriedFromSnapshotId));
        Assert.IsNull(carried.SourceMaxRecordId);
        Assert.IsNull(carried.BasisLoad);

        // Never another client's max, another workspace's, or one from the same program.
        Assert.ThrowsExactly<ArgumentException>(() => MesocycleWorkingMaxSnapshot.CaptureCarried(
            TenantId, next, Guid.NewGuid(), ended, "Another client"));
        Assert.ThrowsExactly<ArgumentException>(() => MesocycleWorkingMaxSnapshot.CaptureCarried(
            Guid.NewGuid(), next, ClientId, ended, "Another workspace"));
        Assert.ThrowsExactly<ArgumentException>(() => MesocycleWorkingMaxSnapshot.CaptureCarried(
            TenantId, ended.MesocycleId, ClientId, ended, "Same program"));
    }

    [TestMethod]
    public void AWeekOneEstimateKeepsOnlyASetThatIsAValidPrescription()
    {
        var estimate = RpeChartMaxEstimator.Estimate(100m, 5, 7m, StrengthLoadUnit.Kilogram);

        Assert.ThrowsExactly<ArgumentException>(() => MesocycleWorkingMaxSnapshot.CaptureFromWeekOneWeight(
            TenantId, Guid.NewGuid(), ClientId, SquatId, estimate, 100m, 5, 4m, 1, null, "RPE 4 is not a prescription"));
        Assert.ThrowsExactly<ArgumentException>(() => MesocycleWorkingMaxSnapshot.CaptureFromWeekOneWeight(
            TenantId, Guid.NewGuid(), ClientId, SquatId, estimate, 100m, 0, 7m, 1, null, "No reps"));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => MesocycleWorkingMaxSnapshot.CaptureFromWeekOneWeight(
            TenantId, Guid.NewGuid(), ClientId, SquatId, estimate, 0m, 5, 7m, 1, null, "No weight"));
    }

    [TestMethod]
    public void AnUpdateRecordBindsItsKeyHashesAndCounts()
    {
        var hash = new string('a', 64);
        var record = WorkingMaxUpdate.Record(
            TenantId, Guid.NewGuid(), Guid.NewGuid(), hash, new string('B', 64), "PR on Saturday", 3, 2, 6, 14);

        Assert.AreEqual(new string('b', 64), record.PreviewHash);
        Assert.AreEqual(3, record.EffectiveFromWeek);
        Assert.AreEqual(14, record.SetCount);
        Assert.ThrowsExactly<ArgumentException>(() => WorkingMaxUpdate.Record(
            TenantId, Guid.NewGuid(), Guid.Empty, hash, hash, "x", 1, 1, 0, 0));
        Assert.ThrowsExactly<ArgumentException>(() => WorkingMaxUpdate.Record(
            TenantId, Guid.NewGuid(), Guid.NewGuid(), "not a hash", hash, "x", 1, 1, 0, 0));
        Assert.ThrowsExactly<ArgumentException>(() => WorkingMaxUpdate.Record(
            TenantId, Guid.NewGuid(), Guid.NewGuid(), hash, hash, " ", 1, 1, 0, 0));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => WorkingMaxUpdate.Record(
            TenantId, Guid.NewGuid(), Guid.NewGuid(), hash, hash, "x", 1, 0, 0, 0));
    }

    // ----- renaming -----

    [TestMethod]
    public void RenamingChangesOnlyTheNameAndNeverWhereTheProgramCameFrom()
    {
        var templateId = Guid.NewGuid();
        var versionId = Guid.NewGuid();
        var mesocycle = Mesocycle(templateId, versionId);
        var sequence = mesocycle.MutationSequence;

        Assert.IsTrue(mesocycle.Rename("  Spring peak  "));

        Assert.AreEqual("Spring peak", mesocycle.Name);
        Assert.AreEqual(templateId, mesocycle.SourceTemplateId);
        Assert.AreEqual(versionId, mesocycle.SourceTemplateVersionId);
        Assert.AreEqual(new DateOnly(2026, 10, 12), mesocycle.StartDate);
        Assert.AreEqual(sequence + 1, mesocycle.MutationSequence);
    }

    [TestMethod]
    public void RenamingToTheSameNameChangesNothingAndASavedNameIsBounded()
    {
        var mesocycle = Mesocycle(Guid.NewGuid(), Guid.NewGuid());
        var sequence = mesocycle.MutationSequence;

        Assert.IsFalse(mesocycle.Rename("Powerlifting block"));
        Assert.AreEqual(sequence, mesocycle.MutationSequence);
        Assert.ThrowsExactly<ArgumentException>(() => mesocycle.Rename("   "));
        Assert.ThrowsExactly<ArgumentException>(() => mesocycle.Rename(new string('x', 161)));
        Assert.IsTrue(mesocycle.Rename(new string('x', 160)));
    }

    [TestMethod]
    public void AFinishedOrCancelledProgramKeepsItsName()
    {
        var mesocycle = Mesocycle(Guid.NewGuid(), Guid.NewGuid());
        mesocycle.Cancel(new DateTimeOffset(2026, 10, 1, 9, 0, 0, TimeSpan.Zero));

        Assert.ThrowsExactly<InvalidOperationException>(() => mesocycle.Rename("Another name"));
        Assert.AreEqual("Powerlifting block", mesocycle.Name);
    }

    // ----- recalculated loads -----

    [TestMethod]
    public void RecalculatedLoadsLandOnTheSetsAndOnlyTheirCalculatedFieldsMove()
    {
        var mesocycle = Mesocycle(Guid.NewGuid(), Guid.NewGuid());
        var session = mesocycle.Weeks.Single().Sessions.Single();
        var squat = session.Exercises.Single(item => item.ExerciseId == SquatId).Sets.Single();
        var snapshotId = Guid.NewGuid();
        var sequence = mesocycle.MutationSequence;

        var (sessions, sets) = mesocycle.ApplyRecalculatedLoads(new Dictionary<Guid, SetLoadCalculation>
        {
            [squat.Id] = new(snapshotId, 110.04m, 110m, "RpeChart", "1.0", "RTS RPE chart v1: ..."),
        });

        Assert.AreEqual((1, 1), (sessions, sets));
        Assert.AreEqual(snapshotId, squat.WorkingMaxSnapshotId);
        Assert.AreEqual(110m, squat.PrescribedLoad);
        Assert.AreEqual(110.04m, squat.UnroundedRecommendedLoad);
        Assert.AreEqual("RTS RPE chart v1: ...", squat.CalculationExplanation);
        Assert.AreEqual(TrainingLoadStrategy.RpeChart, squat.LoadStrategy);
        Assert.AreEqual(5, squat.RepetitionsMaximum);
        Assert.AreEqual(7m, squat.TargetRpe);
        Assert.AreEqual(sequence + 1, mesocycle.MutationSequence);
    }

    [TestMethod]
    public void ATypedWeightAndASetOfAnotherProgramNeverTakeARecalculatedLoad()
    {
        var mesocycle = Mesocycle(Guid.NewGuid(), Guid.NewGuid());
        var bench = mesocycle.Weeks.Single().Sessions.Single().Exercises.Single(item => item.ExerciseId == BenchId).Sets.Single();
        var calculation = new SetLoadCalculation(Guid.NewGuid(), 80m, 80m, "RpeChart", "1.0", "x");

        Assert.ThrowsExactly<InvalidOperationException>(() => mesocycle.ApplyRecalculatedLoads(
            new Dictionary<Guid, SetLoadCalculation> { [bench.Id] = calculation }));
        Assert.ThrowsExactly<ArgumentException>(() => mesocycle.ApplyRecalculatedLoads(
            new Dictionary<Guid, SetLoadCalculation> { [Guid.NewGuid()] = calculation }));
        Assert.AreEqual(80m, bench.PrescribedLoad);
    }

    [TestMethod]
    public void AStartedSessionKeepsItsWeights()
    {
        var mesocycle = Mesocycle(Guid.NewGuid(), Guid.NewGuid());
        var session = mesocycle.Weeks.Single().Sessions.Single();
        var squat = session.Exercises.Single(item => item.ExerciseId == SquatId).Sets.Single();
        mesocycle.MarkSessionStarted(session.Id);

        Assert.ThrowsExactly<InvalidOperationException>(() => mesocycle.ApplyRecalculatedLoads(
            new Dictionary<Guid, SetLoadCalculation>
            {
                [squat.Id] = new(Guid.NewGuid(), 120m, 120m, "RpeChart", "1.0", "x"),
            }));
        Assert.AreEqual(100m, squat.PrescribedLoad);
    }

    [TestMethod]
    public void ARecalculatedLoadNeedsItsMaxAndAPositiveWeight()
    {
        var mesocycle = Mesocycle(Guid.NewGuid(), Guid.NewGuid());
        var squat = mesocycle.Weeks.Single().Sessions.Single().Exercises.Single(item => item.ExerciseId == SquatId).Sets.Single();

        Assert.ThrowsExactly<ArgumentException>(() => mesocycle.ApplyRecalculatedLoads(
            new Dictionary<Guid, SetLoadCalculation> { [squat.Id] = new(Guid.Empty, 120m, 120m, "RpeChart", "1.0", "x") }));
        Assert.ThrowsExactly<ArgumentException>(() => mesocycle.ApplyRecalculatedLoads(
            new Dictionary<Guid, SetLoadCalculation> { [squat.Id] = new(Guid.NewGuid(), 0m, 0m, "RpeChart", "1.0", "x") }));
        Assert.AreEqual(100m, squat.PrescribedLoad);
    }

    // ----- builders -----

    private static MesocycleWorkingMaxSnapshot Snapshot(decimal value, Guid? recordId, Guid? supersedes) =>
        MesocycleWorkingMaxSnapshot.Capture(
            TenantId, Guid.NewGuid(), ClientId, SquatId, recordId, value, StrengthLoadUnit.Kilogram, 1, supersedes, "Typed by the coach");

    private static TrainingMesocycle Mesocycle(Guid templateId, Guid versionId)
    {
        var calculatedSquat = Set(0, reps: 5, rpe: 7m, load: 100m) with
        {
            LoadStrategy = TrainingLoadStrategy.RpeChart,
            DirectLoad = null,
            WorkingMaxSnapshotId = Guid.NewGuid(),
            PrescribedLoad = 100m,
            UnroundedRecommendedLoad = 100.01m,
            CalculationStrategyKey = "RpeChart",
            CalculationStrategyVersion = "1.0",
            CalculationExplanation = "RTS RPE chart v1: before",
        };
        var typedBench = Set(0, reps: 5, rpe: 7m, load: 80m) with
        {
            CalculationStrategyKey = "CoachDirect",
            CalculationStrategyVersion = "1.0",
            PrescribedLoad = 80m,
        };
        var program = new ProgramBlueprint(
            "Powerlifting block",
            null,
            [new TrainingWeekBlueprint(
                null,
                true,
                [Session(
                    "Lower",
                    0,
                    Exercise(SquatId, "Back squat", calculatedSquat),
                    Exercise(BenchId, "Bench press", typedBench))])]);
        return TrainingMesocycle.CreateSnapshot(
            TenantId,
            ClientId,
            Guid.NewGuid(),
            templateId,
            versionId,
            program.Name,
            new DateOnly(2026, 10, 12),
            "Asia/Beirut",
            MesocycleKind.Primary,
            TrainingLoadUnit.Kilogram,
            2.5m,
            TrainingLoadRoundingMode.Nearest,
            Guid.NewGuid(),
            program);
    }

    private static TrainingWeekBlueprint Week(params TrainingSessionBlueprint[] sessions) =>
        new(null, true, sessions);

    private static TrainingSessionBlueprint Session(
        string name,
        int dayOffset,
        params ExercisePrescriptionBlueprint[] exercises) =>
        new(name, dayOffset, null, exercises);

    private static ExercisePrescriptionBlueprint Exercise(
        Guid exerciseId,
        string name,
        params SetPrescriptionBlueprint[] sets) =>
        new(
            exerciseId,
            name,
            0,
            false,
            PrescriptionModificationPolicy.CoachApprovedSwap,
            null,
            [],
            [],
            sets);

    private static SetPrescriptionBlueprint Set(
        int position,
        int? reps,
        decimal? rpe,
        decimal? load,
        TrainingSetType type = TrainingSetType.Normal) =>
        new(
            position,
            type,
            reps,
            reps,
            load is null ? TrainingLoadStrategy.None : TrainingLoadStrategy.Direct,
            load,
            load is null ? null : TrainingLoadUnit.Kilogram,
            null,
            rpe,
            ExertionDisplayPreference.Rpe,
            120,
            null,
            null);
}
