using TB.Gym.Modules.Strength;
using TB.Gym.Modules.Training;
using StrengthLoadUnit = TB.Gym.Modules.Strength.LoadUnit;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// Audit batch A3: the training rules that protect the record. A set logged under a lift stays that lift's
/// (CLIENT-2), a swapped session keeps its day (TRAIN-3), the set save and the finish summary read records by one
/// rule (BEA-4), a weight that rounds to nothing is a refusal of the set's numbers (BEA-10), and a logged set's
/// max is read on the RTS chart when it carries an RPE the chart covers (TRAIN-4).
/// </summary>
[TestClass]
public sealed class A3TrainingRecordDomainTests
{
    private static readonly Guid TenantId = Guid.Parse("10000000-0000-0000-0000-0000000000a3");
    private static readonly Guid ClientId = Guid.Parse("20000000-0000-0000-0000-0000000000a3");
    private static readonly Guid SplitSquatId = Guid.Parse("30000000-0000-0000-0000-0000000000a1");
    private static readonly Guid LungeId = Guid.Parse("30000000-0000-0000-0000-0000000000a2");
    private static readonly Guid StepUpId = Guid.Parse("30000000-0000-0000-0000-0000000000a3");
    private static readonly DateTimeOffset Now = new(2026, 10, 20, 9, 0, 0, TimeSpan.Zero);

    [TestMethod]
    public void ASwapIsRefusedOnceASetIsLoggedUnderTheLiftBeingDone()
    {
        var execution = Start(Session("Lower B", 2, Exercise(SplitSquatId, "Bulgarian Split Squat", 0, LungeId, StepUpId)));
        var exercise = execution.Exercises.Single();
        var set = exercise.Sets.First();

        // Before any set is logged the client may swap, and swap back.
        execution.SelectActuallyPerformedExercise(exercise.Id, LungeId, "Walking Lunge");
        execution.SelectActuallyPerformedExercise(exercise.Id, SplitSquatId, "Bulgarian Split Squat");
        execution.SelectActuallyPerformedExercise(exercise.Id, LungeId, "Walking Lunge");
        Assert.AreEqual((LungeId, true), (exercise.ActualExerciseId, exercise.WasSubstituted));

        // A typed set that is not done yet does not hold the choice.
        execution.RecordSetActual(set.Id, 8, 10m, TrainingLoadUnit.Kilogram, null, isCompleted: false, null);
        execution.SelectActuallyPerformedExercise(exercise.Id, StepUpId, "Step-up");
        execution.SelectActuallyPerformedExercise(exercise.Id, LungeId, "Walking Lunge");

        // Once a set is done as Walking Lunge, it stays Walking Lunge: neither back to the prescribed lift nor on.
        execution.RecordSetActual(set.Id, 8, 10m, TrainingLoadUnit.Kilogram, 8m, isCompleted: true, null);
        var back = Assert.ThrowsExactly<WorkoutExerciseSwapLockedException>(() =>
            execution.SelectActuallyPerformedExercise(exercise.Id, SplitSquatId, "Bulgarian Split Squat"));
        Assert.AreEqual(
            "You logged a set as Walking Lunge, so this exercise stays Walking Lunge for this workout.",
            back.Message);
        Assert.ThrowsExactly<WorkoutExerciseSwapLockedException>(() =>
            execution.SelectActuallyPerformedExercise(exercise.Id, StepUpId, "Step-up"));
        Assert.AreEqual(
            (SplitSquatId, LungeId, "Walking Lunge", true),
            (exercise.PrescribedExerciseId, exercise.ActualExerciseId, exercise.ActualExerciseName, exercise.WasSubstituted));

        // Choosing the lift already chosen is no change, so a retried swap still answers.
        execution.SelectActuallyPerformedExercise(exercise.Id, LungeId, "Walking Lunge");

        // A lift the coach never approved is refused as before, logged set or not.
        var refused = Assert.ThrowsExactly<InvalidOperationException>(() =>
            execution.SelectActuallyPerformedExercise(exercise.Id, Guid.NewGuid(), "Leg press"));
        Assert.Contains("does not authorize", refused.Message);
    }

    [TestMethod]
    public void ASwappedSessionKeepsItsOwnDayWhateverDayTheReplacementWasWrittenFor()
    {
        // A one-week program from Mon 19 Oct with Lower B on Wednesday (day 3).
        var mesocycle = Mesocycle(Session("Lower B", 2, Exercise(SplitSquatId, "Bulgarian Split Squat", 0)));
        var session = mesocycle.Weeks.Single().Sessions.Single();
        Assert.AreEqual((2, new DateOnly(2026, 10, 21)), (session.DayOffset, session.ScheduledDate));

        // The saved session sat on day 1 of its own program.
        mesocycle.ReplaceFutureSession(session.Id, Session("Lower A", 0, Exercise(LungeId, "Walking Lunge", 0)));

        Assert.AreEqual(
            ("Lower A", "Walking Lunge", 2, new DateOnly(2026, 10, 21)),
            (session.Name, session.Exercises.Single().ExerciseNameSnapshot, session.DayOffset, session.ScheduledDate));
    }

    [TestMethod]
    public void TheSetSaveAndTheSummaryReadALiftPrescribedTwiceByOneRule()
    {
        // The session prescribes the split squat twice: a heavy top set, then a lighter back-off set.
        var execution = Start(Session(
            "Lower B",
            0,
            Exercise(SplitSquatId, "Bulgarian Split Squat", 0),
            Exercise(SplitSquatId, "Bulgarian Split Squat", 1)));
        var top = execution.Exercises.Single(item => item.Position == 0).Sets.First();
        var backOff = execution.Exercises.Single(item => item.Position == 1).Sets.First();
        execution.RecordSetActual(top.Id, 8, 20m, TrainingLoadUnit.Kilogram, 9m, true, null);
        execution.RecordSetActual(backOff.Id, 8, 15m, TrainingLoadUnit.Kilogram, 7m, true, null);
        var inOrder = WorkoutPersonalRecordRule.CompletedSetsInOrder(execution);
        PerformedSet[] earlier = [new(Guid.NewGuid(), SplitSquatId, 8, 12.5m, TrainingLoadUnit.Kilogram, true)];

        CollectionAssert.AreEqual(new[] { top.Id, backOff.Id }, inOrder.Select(item => item.SetId).ToArray());
        CollectionAssert.AreEqual(new[] { top.Id }, WorkoutPersonalRecordRule.RecordSetIds(inOrder, earlier).ToArray());

        // The set save asks the same question of each set, and gets the same answer.
        Assert.IsTrue(WorkoutPersonalRecordRule.IsRecordSet(top.Id, inOrder, earlier));
        Assert.IsFalse(WorkoutPersonalRecordRule.IsRecordSet(backOff.Id, inOrder, earlier));

        // A set not done is not read at all.
        execution.RecordSetActual(backOff.Id, 8, 25m, TrainingLoadUnit.Kilogram, 9m, false, null);
        Assert.IsFalse(WorkoutPersonalRecordRule.IsRecordSet(
            backOff.Id, WorkoutPersonalRecordRule.CompletedSetsInOrder(execution), earlier));
    }

    [TestMethod]
    public void AWeightThatRoundsToNothingIsARefusalOfTheSetsNumbers()
    {
        var down = Assert.ThrowsExactly<ArgumentException>(() =>
            new LoadRoundingPolicy(StrengthLoadUnit.Kilogram, 2.5m, LoadRoundingMode.Down).Round(2.4m));
        Assert.AreEqual(
            "The weight works out to 2.4 kg, which rounds to 0 kg at the program's 2.5 kg step. Type a weight for this set, or prescribe it without one.",
            down.Message);
        var pounds = Assert.ThrowsExactly<ArgumentException>(() =>
            new LoadRoundingPolicy(StrengthLoadUnit.Pound, 5m, LoadRoundingMode.Nearest).Round(2.4m));
        Assert.Contains("rounds to 0 lb at the program's 5 lb step", pounds.Message);

        // A broken policy is still the program's own fault, not the set's.
        Assert.ThrowsExactly<InvalidOperationException>(() =>
            new LoadRoundingPolicy(StrengthLoadUnit.Kilogram, 0m, LoadRoundingMode.Nearest).Round(10m));
    }

    [TestMethod]
    public void ALoggedSetIsReadOnTheChartOnlyWhereTheChartCoversIt()
    {
        // Maya's deadlift: 62.5 kg x 7 at RPE 8.5 is 77.4% of the max on the chart, as the maxes panel reads it.
        var chart = RpeChartMaxEstimator.TryEstimate(62.5m, 7, 8.5m, StrengthLoadUnit.Kilogram);
        Assert.IsNotNull(chart);
        Assert.AreEqual((80.749m, 77.4m, RtsRpeChart.Key), (chart.Value, chart.Percent, chart.StrategyKey));
        Assert.AreEqual(
            RpeChartMaxEstimator.Estimate(62.5m, 7, 8.5m, StrengthLoadUnit.Kilogram).Value,
            chart.Value);

        // Outside the chart, without a weight, or past 2,000: nothing, never a stretched chart.
        Assert.IsNull(RpeChartMaxEstimator.TryEstimate(62.5m, 7, 6m, StrengthLoadUnit.Kilogram));
        Assert.IsNull(RpeChartMaxEstimator.TryEstimate(62.5m, 13, 8m, StrengthLoadUnit.Kilogram));
        Assert.IsNull(RpeChartMaxEstimator.TryEstimate(62.5m, 7, 8.2m, StrengthLoadUnit.Kilogram));
        Assert.IsNull(RpeChartMaxEstimator.TryEstimate(0m, 7, 8m, StrengthLoadUnit.Kilogram));
        Assert.IsNull(RpeChartMaxEstimator.TryEstimate(1_900m, 12, 6.5m, StrengthLoadUnit.Kilogram));
    }

    private static WorkoutExecution Start(TrainingSessionBlueprint session)
    {
        var mesocycle = Mesocycle(session);
        return WorkoutExecution.Start(TenantId, ClientId, mesocycle.Id, mesocycle.Weeks.Single().Sessions.Single(), Now);
    }

    private static TrainingMesocycle Mesocycle(TrainingSessionBlueprint session) =>
        TrainingMesocycle.CreateSnapshot(
            TenantId,
            ClientId,
            Guid.NewGuid(),
            Guid.NewGuid(),
            Guid.NewGuid(),
            "Hypertrophy",
            new DateOnly(2026, 10, 19),
            "Asia/Beirut",
            MesocycleKind.Primary,
            TrainingLoadUnit.Kilogram,
            2.5m,
            TrainingLoadRoundingMode.Nearest,
            Guid.NewGuid(),
            new ProgramBlueprint("Hypertrophy", null, [new TrainingWeekBlueprint(null, true, [session])]));

    private static TrainingSessionBlueprint Session(
        string name,
        int dayOffset,
        params ExercisePrescriptionBlueprint[] exercises) =>
        new(name, dayOffset, null, exercises);

    private static ExercisePrescriptionBlueprint Exercise(
        Guid exerciseId,
        string name,
        int position,
        params Guid[] alternatives) =>
        new(
            exerciseId,
            name,
            position,
            false,
            PrescriptionModificationPolicy.CoachApprovedSwap,
            null,
            alternatives,
            [],
            [Set(0), Set(1)]);

    private static SetPrescriptionBlueprint Set(int position) =>
        new(
            position,
            TrainingSetType.Normal,
            8,
            8,
            TrainingLoadStrategy.Direct,
            12.5m,
            TrainingLoadUnit.Kilogram,
            null,
            8m,
            ExertionDisplayPreference.Rpe,
            90,
            null,
            null,
            PrescribedLoad: 12.5m,
            CalculationStrategyKey: "CoachDirect",
            CalculationStrategyVersion: "1.0");
}
