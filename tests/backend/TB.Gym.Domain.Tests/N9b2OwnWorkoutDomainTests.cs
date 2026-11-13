using TB.Gym.Modules.Training;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// The notes plan's N9b2, a workout of one's own (TRN-033): it starts empty with no program or session behind it; each
/// exercise added goes after the others as its own prescribed one, locked, with no swap and no demo of its own, and
/// with the empty sets asked for; a set holds only what was typed, within the set limits (TRN-016), and nothing
/// prescribed or worked out; a workout holds forty exercises and an exercise twenty sets (TRN-024's limits); only an
/// exercise's last set is taken away; once finished it is as frozen as a program's workout (TRN-012); a program's
/// workout takes none of it; and the record rule reads it as any workout (TRN-019).
/// </summary>
[TestClass]
public sealed class N9b2OwnWorkoutDomainTests
{
    private const string Frozen = "Completed workout history is immutable.";

    private const string NotOwn =
        "Exercises and sets are added or taken away only in a workout of your own, not in a program's workout.";

    private static readonly Guid HouseId = Guid.Parse("10000000-0000-0000-0000-0000000009b2");
    private static readonly Guid ProfileId = Guid.Parse("20000000-0000-0000-0000-0000000009b2");
    private static readonly Guid SquatId = Guid.Parse("30000000-0000-0000-0000-0000000009b2");
    private static readonly Guid HoldId = Guid.Parse("30000000-0000-0000-0000-0000000019b2");
    private static readonly Guid RaiseId = Guid.Parse("30000000-0000-0000-0000-0000000029b2");
    private static readonly Guid CarryId = Guid.Parse("30000000-0000-0000-0000-0000000039b2");
    private static readonly DateOnly Day = new(2026, 11, 13);
    private static readonly DateTimeOffset Now = new(2026, 11, 13, 9, 0, 0, TimeSpan.Zero);

    /// <summary>TRN-033: a workout of one's own starts empty, named "Workout", with no program or session; a program's still names both.</summary>
    [TestMethod]
    public void N9b2DAWorkoutOfOnesOwnStartsEmptyWithNoProgramWhileAProgramsWorkoutNamesBoth()
    {
        var own = WorkoutExecution.StartOwn(HouseId, ProfileId, Day, Now);

        Assert.AreEqual(
            ((Guid?)null, (Guid?)null, true, WorkoutExecutionStatus.InProgress, 0),
            (own.MesocycleId, own.TrainingSessionId, own.IsOwn, own.Status, own.MutationSequence));
        Assert.AreEqual(
            ("Workout", Day, (string?)null, 0u),
            (own.SessionNameSnapshot, own.ScheduledDateSnapshot, own.SessionCoachNotesSnapshot, own.PrescriptionVersionSnapshot));
        Assert.AreEqual(
            (HouseId, ProfileId, Now, (DateTimeOffset?)null),
            (own.TenantId, own.ClientProfileId, own.StartedAtUtc, own.CompletedAtUtc));
        Assert.AreEqual(OwnWorkoutRule.Name, own.SessionNameSnapshot);
        Assert.IsEmpty(own.Exercises);

        var mesocycle = Mesocycle();
        var session = mesocycle.Weeks.Single().Sessions.Single();
        var program = WorkoutExecution.Start(HouseId, ProfileId, mesocycle.Id, session, Now);
        Assert.AreEqual(
            ((Guid?)mesocycle.Id, (Guid?)session.Id, false, "Lower A", WorkoutExecutionStatus.InProgress),
            (program.MesocycleId, program.TrainingSessionId, program.IsOwn, program.SessionNameSnapshot, program.Status));
        var exercise = program.Exercises.Single();
        Assert.AreEqual((Guid?)session.Exercises.Single().Id, exercise.ExercisePrescriptionId);
        Assert.HasCount(2, exercise.Sets);
        Assert.IsTrue(exercise.Sets.All(set => set.SetPrescriptionId is not null), "A program's set names its prescription.");

        var refused = Assert.ThrowsExactly<ArgumentException>(() => WorkoutExecution.StartOwn(HouseId, Guid.Empty, Day, Now));
        Assert.AreEqual("A client id is required.", refused.Message);
    }

    /// <summary>TRN-033: an exercise goes after the others as its own prescribed one, locked, with no swap, no demo and only its empty sets.</summary>
    [TestMethod]
    public void N9b2DAnOwnExerciseGoesAfterTheOthersAsItsOwnLockedPrescriptionWithItsEmptySets()
    {
        var workout = StartOwn();
        var squat = workout.AddOwnExercise(SquatId, "  Back Squat  ", emptySets: 3);
        var hold = workout.AddOwnExercise(HoldId, "arch hold");
        var raise = workout.AddOwnExercise(RaiseId, "Élévations latérales", 1);

        Assert.AreEqual((1, 2, 3), (squat.Position, hold.Position, raise.Position));
        Assert.AreEqual(
            ((Guid?)null, SquatId, SquatId, "Back Squat", "Back Squat", false),
            (squat.ExercisePrescriptionId, squat.PrescribedExerciseId, squat.ActualExerciseId, squat.PrescribedExerciseName,
                squat.ActualExerciseName, squat.WasSubstituted));
        Assert.AreEqual(
            (PrescriptionModificationPolicy.Locked, false, (string?)null, workout.Id, HouseId),
            (squat.ModificationPolicySnapshot, squat.IsMainLiftSnapshot, squat.CoachNotesSnapshot, squat.WorkoutExecutionId,
                squat.TenantId));
        foreach (var exercise in workout.Exercises)
        {
            Assert.AreEqual(
                ((Guid?)null, exercise.PrescribedExerciseId, PrescriptionModificationPolicy.Locked, false),
                (exercise.ExercisePrescriptionId, exercise.ActualExerciseId, exercise.ModificationPolicySnapshot, exercise.IsMainLiftSnapshot),
                exercise.ActualExerciseName);
            Assert.IsEmpty(exercise.ApprovedAlternatives, exercise.ActualExerciseName);
            Assert.IsEmpty(exercise.Media, exercise.ActualExerciseName);
        }

        Assert.AreEqual("1 2 3", Positions(squat.Sets));
        Assert.IsEmpty(hold.Sets);
        Assert.AreEqual(1, raise.Sets.Single().Position);
        foreach (var set in squat.Sets.Concat(raise.Sets))
        {
            AssertNothingPrescribed(set);
            AssertNothingTyped(set);
            Assert.AreEqual(HouseId, set.TenantId);
        }

        Assert.IsTrue(squat.Sets.All(set => set.WorkoutExercisePerformanceId == squat.Id));

        // The next exercise goes after the last one there, wherever one was taken away.
        workout.RemoveOwnExercise(hold.Id);
        var carry = workout.AddOwnExercise(CarryId, "Zercher Carry");
        Assert.AreEqual(4, carry.Position);
        workout.RemoveOwnExercise(carry.Id);
        Assert.AreEqual(4, workout.AddOwnExercise(HoldId, "arch hold", 2).Position);
        Assert.AreEqual("1 3 4", string.Join(' ', workout.Exercises.Select(item => item.Position).Order()));
    }

    /// <summary>TRN-033 with TRN-016: an own set is saved as typed within the set limits, and nothing in it is ever prescribed or worked out.</summary>
    [TestMethod]
    public void N9b2DAnOwnSetHoldsOnlyWhatWasTypedWithinTheSetLimits()
    {
        var workout = StartOwn();
        var squat = workout.AddOwnExercise(SquatId, "Back Squat", 2);
        var third = workout.AddOwnSet(squat.Id);
        var (first, second) = (squat.Sets.First(), squat.Sets.ElementAt(1));
        Assert.AreEqual(3, third.Position);

        workout.RecordSetActual(first.Id, 5, 102.5m, TrainingLoadUnit.Kilogram, 8.5m, isCompleted: true, "  Felt quick  ");
        workout.RecordSetActual(second.Id, 12, null, null, null, isCompleted: false, null);
        workout.RecordSetActual(third.Id, 0, 2_000m, TrainingLoadUnit.Pound, 10m, isCompleted: true, null);
        Assert.AreEqual(
            ((int?)5, (decimal?)102.5m, (TrainingLoadUnit?)TrainingLoadUnit.Kilogram, (decimal?)8.5m, true, "Felt quick"),
            Actuals(first));
        Assert.AreEqual(((int?)12, (decimal?)null, (TrainingLoadUnit?)null, (decimal?)null, false, (string?)null), Actuals(second));
        Assert.AreEqual(
            ((int?)0, (decimal?)2_000m, (TrainingLoadUnit?)TrainingLoadUnit.Pound, (decimal?)10m, true, (string?)null),
            Actuals(third));

        // Outside the limits nothing is saved and nothing changes.
        var sequence = workout.MutationSequence;
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() =>
            workout.RecordSetActual(first.Id, 201, 100m, TrainingLoadUnit.Kilogram, null, true, null));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() =>
            workout.RecordSetActual(first.Id, 5, 2_000.5m, TrainingLoadUnit.Kilogram, null, true, null));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() =>
            workout.RecordSetActual(first.Id, 5, -1m, TrainingLoadUnit.Kilogram, null, true, null));
        var noUnit = Assert.ThrowsExactly<ArgumentException>(() =>
            workout.RecordSetActual(first.Id, 5, 100m, null, null, true, null));
        Assert.Contains("A load unit is required when actual load is recorded.", noUnit.Message);
        var rpe = Assert.ThrowsExactly<ArgumentOutOfRangeException>(() =>
            workout.RecordSetActual(first.Id, 5, 100m, TrainingLoadUnit.Kilogram, 8.2m, true, null));
        Assert.Contains("RPE must be between 5 and 10 in 0.5 steps.", rpe.Message);
        Assert.AreEqual(
            ((int?)5, (decimal?)102.5m, (TrainingLoadUnit?)TrainingLoadUnit.Kilogram, (decimal?)8.5m, true, "Felt quick"),
            Actuals(first));
        Assert.AreEqual(sequence, workout.MutationSequence);

        foreach (var set in squat.Sets)
        {
            AssertNothingPrescribed(set);
        }
    }

    /// <summary>TRN-033 with TRN-024's limits: forty exercises a workout and twenty sets an exercise, each refused past that as own_workout_limit.</summary>
    [TestMethod]
    public void N9b2DAWorkoutOfOnesOwnHoldsFortyExercisesAndAnExerciseTwentySets()
    {
        Assert.AreEqual((40, 20, "own_workout_limit"), (OwnWorkoutRule.MaximumExercises, OwnWorkoutRule.MaximumSetsPerExercise, OwnWorkoutConflictException.LimitCode));
        var workout = StartOwn();
        for (var count = 1; count <= 40; count++)
        {
            workout.AddOwnExercise(Guid.NewGuid(), $"Exercise {count}");
        }

        var sequence = workout.MutationSequence;
        var full = Assert.ThrowsExactly<OwnWorkoutConflictException>(() => workout.AddOwnExercise(SquatId, "Back Squat"));
        Assert.AreEqual(("own_workout_limit", "A workout holds at most 40 exercises."), (full.Code, full.Message));
        Assert.HasCount(40, workout.Exercises);
        Assert.AreEqual(sequence, workout.MutationSequence);

        // Taking one away makes room for one more, after the last.
        workout.RemoveOwnExercise(workout.Exercises.First().Id);
        Assert.AreEqual(41, workout.AddOwnExercise(SquatId, "Back Squat").Position);
        Assert.HasCount(40, workout.Exercises);

        var other = StartOwn();
        var squat = other.AddOwnExercise(SquatId, "Back Squat", OwnWorkoutRule.MaximumSetsPerExercise);
        Assert.HasCount(20, squat.Sets);
        var noRoom = Assert.ThrowsExactly<OwnWorkoutConflictException>(() => other.AddOwnSet(squat.Id));
        Assert.AreEqual(("own_workout_limit", "An exercise holds at most 20 sets."), (noRoom.Code, noRoom.Message));

        var hold = other.AddOwnExercise(HoldId, "arch hold");
        for (var count = 1; count <= 20; count++)
        {
            Assert.AreEqual(count, other.AddOwnSet(hold.Id).Position);
        }

        sequence = other.MutationSequence;
        noRoom = Assert.ThrowsExactly<OwnWorkoutConflictException>(() => other.AddOwnSet(hold.Id));
        Assert.AreEqual(("own_workout_limit", "An exercise holds at most 20 sets."), (noRoom.Code, noRoom.Message));
        Assert.HasCount(20, hold.Sets);

        // An exercise starts with at most twenty empty sets.
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => other.AddOwnExercise(RaiseId, "Élévations latérales", 21));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => other.AddOwnExercise(RaiseId, "Élévations latérales", -1));
        Assert.HasCount(2, other.Exercises);
        Assert.AreEqual(sequence, other.MutationSequence);
    }

    /// <summary>TRN-033: only an exercise's last set is taken away (own_workout_not_last_set), and the next set added takes its place.</summary>
    [TestMethod]
    public void N9b2DOnlyAnExercisesLastSetIsTakenAwayAndTheNextSetTakesItsPlace()
    {
        var workout = StartOwn();
        var squat = workout.AddOwnExercise(SquatId, "Back Squat", 3);
        var hold = workout.AddOwnExercise(HoldId, "arch hold", 2);
        var sets = squat.Sets.ToArray();
        var sequence = workout.MutationSequence;

        foreach (var set in sets[..2])
        {
            var refused = Assert.ThrowsExactly<OwnWorkoutConflictException>(() => workout.RemoveOwnSet(set.Id));
            Assert.AreEqual(
                ("own_workout_not_last_set", "Only an exercise's last set can be taken away."),
                (refused.Code, refused.Message),
                $"Set {set.Position}");
        }

        Assert.HasCount(3, squat.Sets);
        Assert.AreEqual(sequence, workout.MutationSequence);

        // Each exercise's own last set goes: the hold's while the squat keeps three, then the squat's.
        var holdLast = hold.Sets.Single(set => set.Position == 2);
        Assert.AreSame(holdLast, workout.RemoveOwnSet(holdLast.Id));
        Assert.HasCount(3, squat.Sets);
        Assert.AreSame(sets[2], workout.RemoveOwnSet(sets[2].Id));
        Assert.AreEqual(("1 2", "1"), (Positions(squat.Sets), Positions(hold.Sets)));

        // Its place goes to the next set added.
        var next = workout.AddOwnSet(squat.Id);
        Assert.AreEqual(3, next.Position);

        // Down to none, one last set at a time, and the next is the first again.
        workout.RemoveOwnSet(next.Id);
        workout.RemoveOwnSet(sets[1].Id);
        workout.RemoveOwnSet(sets[0].Id);
        Assert.IsEmpty(squat.Sets);
        Assert.AreEqual(1, workout.AddOwnSet(squat.Id).Position);

        Assert.ThrowsExactly<ArgumentException>(() => workout.RemoveOwnSet(Guid.NewGuid()));
    }

    /// <summary>TRN-012 and TRN-033: once finished, every change to a workout of one's own is refused as completed history, nothing else.</summary>
    [TestMethod]
    public void N9b2DAFinishedWorkoutOfOnesOwnRefusesEveryChangeAsCompletedHistory()
    {
        var workout = StartOwn();
        var squat = workout.AddOwnExercise(SquatId, "Back Squat", 2);
        var (logged, open) = (squat.Sets.First(), squat.Sets.Last());
        workout.RecordSetActual(logged.Id, 5, 100m, TrainingLoadUnit.Kilogram, 8m, isCompleted: true, null);
        workout.Complete(Now.AddHours(1));
        Assert.AreEqual(
            (WorkoutExecutionStatus.Completed, (DateTimeOffset?)Now.AddHours(1)),
            (workout.Status, workout.CompletedAtUtc));
        var sequence = workout.MutationSequence;

        foreach (var (name, change) in new (string, Action)[]
        {
            ("add an exercise", () => workout.AddOwnExercise(HoldId, "arch hold")),
            ("add an exercise with sets", () => workout.AddOwnExercise(HoldId, "arch hold", 2)),
            ("add a set", () => workout.AddOwnSet(squat.Id)),
            ("take an exercise away", () => workout.RemoveOwnExercise(squat.Id)),
            ("take the last set away", () => workout.RemoveOwnSet(open.Id)),
            ("take a set that is not the last away", () => workout.RemoveOwnSet(logged.Id)),
            ("save a logged set", () => workout.RecordSetActual(logged.Id, 6, 100m, TrainingLoadUnit.Kilogram, null, true, null)),
            ("save an open set", () => workout.RecordSetActual(open.Id, 5, 100m, TrainingLoadUnit.Kilogram, null, true, null)),
            ("finish again", () => workout.Complete(Now.AddHours(2))),
        })
        {
            var refused = Assert.ThrowsExactly<InvalidOperationException>(change, name);
            Assert.AreEqual(Frozen, refused.Message, name);
        }

        Assert.AreEqual(sequence, workout.MutationSequence);
        Assert.HasCount(1, workout.Exercises);
        Assert.HasCount(2, squat.Sets);
        Assert.AreEqual(
            ((int?)5, (decimal?)100m, (TrainingLoadUnit?)TrainingLoadUnit.Kilogram, (decimal?)8m, true, (string?)null),
            Actuals(logged));
        AssertNothingTyped(open);
    }

    /// <summary>TRN-033: a program's workout takes no exercise or set of one's own and loses none (own_workout_only), and once finished says so first.</summary>
    [TestMethod]
    public void N9b2DAProgramsWorkoutRefusesEveryOwnChangeAsOwnWorkoutOnly()
    {
        var program = StartProgram();
        var exercise = program.Exercises.Single();
        var last = exercise.Sets.Single(set => set.Position == exercise.Sets.Max(item => item.Position));
        var changes = new (string, Action)[]
        {
            ("add an exercise", () => program.AddOwnExercise(HoldId, "arch hold")),
            ("add a set", () => program.AddOwnSet(exercise.Id)),
            ("take an exercise away", () => program.RemoveOwnExercise(exercise.Id)),
            ("take the last set away", () => program.RemoveOwnSet(last.Id)),
        };

        foreach (var (name, change) in changes)
        {
            var refused = Assert.ThrowsExactly<OwnWorkoutConflictException>(change, name);
            Assert.AreEqual(("own_workout_only", NotOwn), (refused.Code, refused.Message), name);
        }

        Assert.AreEqual(0, program.MutationSequence);
        Assert.HasCount(1, program.Exercises);
        Assert.HasCount(2, exercise.Sets);

        program.Complete(Now.AddHours(1));
        foreach (var (name, change) in changes)
        {
            var refused = Assert.ThrowsExactly<InvalidOperationException>(change, name);
            Assert.AreEqual(Frozen, refused.Message, name);
        }
    }

    /// <summary>TRN-033 with TRN-010: an own exercise is locked to itself, so a swap to another lift is refused and choosing it again changes nothing.</summary>
    [TestMethod]
    public void N9b2DAnOwnExerciseIsLockedToItselfSoNoSwapOpensOnIt()
    {
        var workout = StartOwn();
        var squat = workout.AddOwnExercise(SquatId, "Back Squat", 1);

        var refused = Assert.ThrowsExactly<InvalidOperationException>(() =>
            workout.SelectActuallyPerformedExercise(squat.Id, HoldId, "arch hold"));
        Assert.AreEqual("This prescription does not authorize the selected substitution.", refused.Message);
        Assert.AreEqual((SquatId, "Back Squat", false), (squat.ActualExerciseId, squat.ActualExerciseName, squat.WasSubstituted));

        workout.SelectActuallyPerformedExercise(squat.Id, SquatId, "Back Squat");
        Assert.AreEqual(
            (SquatId, SquatId, "Back Squat", false),
            (squat.PrescribedExerciseId, squat.ActualExerciseId, squat.ActualExerciseName, squat.WasSubstituted));
    }

    /// <summary>TRN-033: every change to a workout of one's own counts once in its mutation sequence, and a refused change not at all.</summary>
    [TestMethod]
    public void N9b2DEveryChangeToAWorkoutOfOnesOwnCountsOnceAndARefusalNever()
    {
        var workout = StartOwn();
        var sequences = new List<int> { workout.MutationSequence };
        var squat = workout.AddOwnExercise(SquatId, "Back Squat", 3);
        sequences.Add(workout.MutationSequence);
        var set = workout.AddOwnSet(squat.Id);
        sequences.Add(workout.MutationSequence);
        Assert.ThrowsExactly<OwnWorkoutConflictException>(() => workout.RemoveOwnSet(squat.Sets.First().Id));
        workout.RemoveOwnSet(set.Id);
        sequences.Add(workout.MutationSequence);
        var hold = workout.AddOwnExercise(HoldId, "arch hold");
        sequences.Add(workout.MutationSequence);
        Assert.ThrowsExactly<ArgumentException>(() => workout.RemoveOwnExercise(Guid.NewGuid()));
        workout.RemoveOwnExercise(hold.Id);
        sequences.Add(workout.MutationSequence);
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() =>
            workout.RecordSetActual(squat.Sets.First().Id, 201, 100m, TrainingLoadUnit.Kilogram, null, true, null));
        workout.RecordSetActual(squat.Sets.First().Id, 5, 100m, TrainingLoadUnit.Kilogram, null, true, null);
        sequences.Add(workout.MutationSequence);
        workout.Complete(Now.AddHours(1));
        sequences.Add(workout.MutationSequence);

        Assert.AreEqual("0 1 2 3 4 5 6 7", string.Join(' ', sequences));
    }

    /// <summary>TRN-019 and TRN-033: the record rule reads an own workout's completed sets by exercise place then set place, and finds its records.</summary>
    [TestMethod]
    public void N9b2DTheRecordRuleReadsAnOwnWorkoutsCompletedSetsInOrder()
    {
        var workout = StartOwn();
        var squat = workout.AddOwnExercise(SquatId, "Back Squat", 3);
        var hold = workout.AddOwnExercise(HoldId, "arch hold", 1);
        var squatSets = squat.Sets.ToArray();
        var holdSet = hold.Sets.Single();

        // Logged out of order, one typed but not done, and one with reps alone.
        workout.RecordSetActual(holdSet.Id, 30, null, null, null, isCompleted: true, null);
        workout.RecordSetActual(squatSets[2].Id, 5, 105m, TrainingLoadUnit.Kilogram, null, isCompleted: true, null);
        workout.RecordSetActual(squatSets[0].Id, 5, 100m, TrainingLoadUnit.Kilogram, null, isCompleted: true, null);
        workout.RecordSetActual(squatSets[1].Id, 5, 120m, TrainingLoadUnit.Kilogram, null, isCompleted: false, null);

        var inOrder = WorkoutPersonalRecordRule.CompletedSetsInOrder(workout);
        CollectionAssert.AreEqual(
            new[] { squatSets[0].Id, squatSets[2].Id, holdSet.Id },
            inOrder.Select(set => set.SetId).ToArray());
        Assert.AreEqual(new PerformedSet(squatSets[0].Id, SquatId, 5, 100m, TrainingLoadUnit.Kilogram, true), inOrder[0]);
        Assert.AreEqual(new PerformedSet(holdSet.Id, HoldId, 30, null, null, true), inOrder[2]);

        // Against an earlier best of 102.5 kg for five, only the 105 kg set is a record; with none, both squat sets are.
        var earlier = new[] { new PerformedSet(Guid.NewGuid(), SquatId, 5, 102.5m, TrainingLoadUnit.Kilogram, true) };
        CollectionAssert.AreEqual(new[] { squatSets[2].Id }, WorkoutPersonalRecordRule.RecordSetIds(inOrder, earlier).ToArray());
        CollectionAssert.AreEqual(
            new[] { squatSets[0].Id, squatSets[2].Id },
            WorkoutPersonalRecordRule.RecordSetIds(inOrder, Array.Empty<PerformedSet>()).ToArray());
        Assert.IsTrue(WorkoutPersonalRecordRule.IsRecordSet(squatSets[2].Id, inOrder, earlier));
        Assert.IsFalse(WorkoutPersonalRecordRule.IsRecordSet(squatSets[1].Id, inOrder, earlier));
    }

    /// <summary>TRN-033: a workout started from a finished one gives each exercise the sets done there, at least one and at most twenty.</summary>
    [TestMethod]
    public void N9b2DSetsCarriedOverAreTheSetsDoneAtLeastOneAndAtMostTwenty()
    {
        Assert.AreEqual(
            (1, 1, 3, 20, 20, 20),
            (OwnWorkoutRule.SetsCarriedOver(0), OwnWorkoutRule.SetsCarriedOver(1), OwnWorkoutRule.SetsCarriedOver(3),
                OwnWorkoutRule.SetsCarriedOver(20), OwnWorkoutRule.SetsCarriedOver(21), OwnWorkoutRule.SetsCarriedOver(25)));
    }

    /// <summary>TRN-033: an own exercise needs an exercise and a name of at most 160 characters, and only this workout's exercise or set is changed.</summary>
    [TestMethod]
    public void N9b2DAnOwnExerciseNeedsAnExerciseAndANameAndOnlyThisWorkoutsRowsChange()
    {
        var workout = StartOwn();

        var noExercise = Assert.ThrowsExactly<ArgumentException>(() => workout.AddOwnExercise(Guid.Empty, "Back Squat"));
        Assert.AreEqual("The workout, the exercise and a position are required.", noExercise.Message);
        Assert.ThrowsExactly<ArgumentException>(() => workout.AddOwnExercise(SquatId, "   "));
        Assert.ThrowsExactly<ArgumentException>(() => workout.AddOwnExercise(SquatId, string.Empty));
        Assert.ThrowsExactly<ArgumentException>(() => workout.AddOwnExercise(SquatId, new string('x', 161)));
        Assert.IsEmpty(workout.Exercises);
        Assert.AreEqual(0, workout.MutationSequence);

        var longest = workout.AddOwnExercise(SquatId, new string('x', 160));
        Assert.AreEqual((1, 160), (longest.Position, longest.ActualExerciseName.Length));

        var other = StartOwn();
        var elsewhere = other.AddOwnExercise(HoldId, "arch hold", 1);
        Assert.ThrowsExactly<ArgumentException>(() => workout.AddOwnSet(elsewhere.Id));
        Assert.ThrowsExactly<ArgumentException>(() => workout.RemoveOwnExercise(elsewhere.Id));
        Assert.ThrowsExactly<ArgumentException>(() => workout.RemoveOwnSet(elsewhere.Sets.Single().Id));
        Assert.AreEqual((1, 1), (workout.MutationSequence, other.MutationSequence));
        Assert.HasCount(1, other.Exercises);
    }

    private static WorkoutExecution StartOwn() => WorkoutExecution.StartOwn(HouseId, ProfileId, Day, Now);

    private static string Positions(IEnumerable<WorkoutSetPerformance> sets) => string.Join(' ', sets.Select(set => set.Position));

    private static WorkoutExecution StartProgram()
    {
        var mesocycle = Mesocycle();
        return WorkoutExecution.Start(HouseId, ProfileId, mesocycle.Id, mesocycle.Weeks.Single().Sessions.Single(), Now);
    }

    private static (int? Repetitions, decimal? Load, TrainingLoadUnit? Unit, decimal? Rpe, bool IsCompleted, string? Note) Actuals(
        WorkoutSetPerformance set) =>
        (set.ActualRepetitions, set.ActualLoad, set.ActualLoadUnit, set.ActualRpe, set.IsCompleted, set.ClientNote);

    /// <summary>Asserts a set holds no prescription, no prescribed figure, no weight choice and no calculation.</summary>
    private static void AssertNothingPrescribed(WorkoutSetPerformance set)
    {
        CollectionAssert.AreEqual(
            new object?[14],
            new object?[]
            {
                set.SetPrescriptionId, set.PrescribedRepetitionsMinimum, set.PrescribedRepetitionsMaximum, set.PrescribedLoad,
                set.PrescribedLoadUnit, set.LoadStrategySnapshot, set.PrescribedLoadStep, set.PrescribedTargetRpe,
                set.PrescribedRestSeconds, set.PrescribedTempo, set.CoachNotesSnapshot, set.CalculationStrategyKeySnapshot,
                set.CalculationStrategyVersionSnapshot, set.UnroundedRecommendedLoadSnapshot,
            },
            $"Set {set.Position} holds something prescribed or worked out.");
        Assert.AreEqual(TrainingSetType.Normal, set.SetTypeSnapshot);
    }

    private static void AssertNothingTyped(WorkoutSetPerformance set) =>
        Assert.AreEqual(
            ((int?)null, (decimal?)null, (TrainingLoadUnit?)null, (decimal?)null, false, (string?)null),
            Actuals(set),
            $"Set {set.Position}");

    private static TrainingMesocycle Mesocycle() =>
        TrainingMesocycle.CreateSnapshot(
            HouseId,
            ProfileId,
            Guid.NewGuid(),
            Guid.NewGuid(),
            Guid.NewGuid(),
            "Strength Base",
            new DateOnly(2026, 11, 9),
            "Asia/Beirut",
            MesocycleKind.Primary,
            TrainingLoadUnit.Kilogram,
            2.5m,
            TrainingLoadRoundingMode.Nearest,
            Guid.NewGuid(),
            new ProgramBlueprint(
                "Strength Base",
                null,
                [
                    new TrainingWeekBlueprint(
                        null,
                        true,
                        [
                            new TrainingSessionBlueprint(
                                "Lower A",
                                4,
                                null,
                                [
                                    new ExercisePrescriptionBlueprint(
                                        SquatId,
                                        "Back Squat",
                                        0,
                                        false,
                                        PrescriptionModificationPolicy.CoachApprovedSwap,
                                        null,
                                        [HoldId],
                                        [],
                                        [Set(0), Set(1)]),
                                ]),
                        ]),
                ]));

    private static SetPrescriptionBlueprint Set(int position) =>
        new(
            position,
            TrainingSetType.Normal,
            5,
            5,
            TrainingLoadStrategy.Direct,
            100m,
            TrainingLoadUnit.Kilogram,
            null,
            LoadStep: null,
            8m,
            ExertionDisplayPreference.Rpe,
            120,
            null,
            null,
            PrescribedLoad: 100m,
            CalculationStrategyKey: "CoachDirect",
            CalculationStrategyVersion: "1.0");
}
