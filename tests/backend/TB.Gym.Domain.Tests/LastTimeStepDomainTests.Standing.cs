using TB.Gym.Modules.Training;

namespace TB.Gym.Domain.Tests;

// The notes plan's N6b (decisions 20 to 22, 5 and 7 Nov 2026): where a lift stands, LastTimeStep v1. A fixed reference
// case for each line of the rule, (a) to (i), for the unit hold and for the order the holds are read in: the coming
// writing of a lift and the client's workouts of it are built by hand and judged on Tuesday 10 Nov 2026, and every
// answer is checked whole: its outcome, its reason with everything the reason names, last time, and each set's move,
// weight, own weight and note.
public sealed partial class LastTimeStepDomainTests
{
    private const TrainingLoadUnit Kg = TrainingLoadUnit.Kilogram;
    private const TrainingLoadUnit Lb = TrainingLoadUnit.Pound;

    // Judged on Tuesday 10 Nov 2026, the coming session's own day unless a test says otherwise.
    private static readonly DateOnly Today = new(2026, 11, 10);
    private static readonly DateOnly LastWeek = new(2026, 11, 3);
    private static readonly DateOnly TwoWeeksAgo = new(2026, 10, 27);
    private static readonly DateOnly FifteenDaysAgo = new(2026, 10, 26);
    private static readonly DateOnly ThreeWeeksAgo = new(2026, 10, 20);
    private static readonly DateOnly FourWeeksAgo = new(2026, 10, 13);

    // A sorts before B, B before C and C before D, so a test can show that last time is never found by a workout's id.
    private static readonly Guid WorkoutA = Guid.Parse("50000000-0000-0000-0000-0000000006b1");
    private static readonly Guid WorkoutB = Guid.Parse("50000000-0000-0000-0000-0000000006b2");
    private static readonly Guid WorkoutC = Guid.Parse("50000000-0000-0000-0000-0000000006b3");
    private static readonly Guid WorkoutD = Guid.Parse("50000000-0000-0000-0000-0000000006b4");

    // ----- where a lift stands (N6b) -----

    [TestMethod]
    public void WhereALiftStandsIsLastTimeStepVersionOne()
    {
        // 14 days back (line b), a quarter either way (line e), and the heaviest weight a set holds (TRN-032).
        Assert.AreEqual(
            ("LastTimeStep", 1, 14, 0.25m, 2_000m),
            (LastTimeStepRule.Key, LastTimeStepRule.Version, LastTimeStepRule.LookbackDays, LastTimeStepRule.TypoShare,
                LastTimeStepRule.MaximumWeight));
    }

    [TestMethod]
    public void EverySetDoneStepsEachSetFromItsLoggedWeightByItsStep()
    {
        // "Last 15 kg × 10, 10, 10 on Tue · next time 17 kg if every set is done."
        var last = Done(WorkoutA, LastWeek, Did(15m, 10, 10, 10));

        AssertStanding(Judge(ThreeSets(own: 15m, step: 2m), last),
            LiftStandingOutcome.StepUp, Why(LiftStandingReason.EverySetDone, LastWeek), last, UpAll(17m, current: 15m));
    }

    [TestMethod]
    public void TheStepIsAddedExactlyWithNoRoundingAndPoundsStayPounds()
    {
        // Decision 22: 22.5 kg + 1.25 kg is 23.75 kg, on no plate's grid, and a 0.01 kg step keeps its hundredth.
        var kilograms = Done(WorkoutA, LastWeek, Logged(1, 22.5m, 10), Logged(2, 20m, 10));
        AssertStanding(Judge(Coming(ComingSet(1, 1.25m, 22.5m), ComingSet(2, 0.01m, 20m)), kilograms),
            LiftStandingOutcome.StepUp, Why(LiftStandingReason.EverySetDone, LastWeek), kilograms,
            [Up(1, 23.75m, 22.5m, 1.25m), Up(2, 20.01m, 20m, 0.01m)]);

        // A set in pounds steps in pounds: nothing is converted.
        var pounds = Done(WorkoutA, LastWeek, Logged(1, 52.5m, 10, unit: Lb));
        AssertStanding(Judge(Coming(ComingSet(1, 1.25m, 52.5m, Lb)), pounds),
            LiftStandingOutcome.StepUp, Why(LiftStandingReason.EverySetDone, LastWeek), pounds,
            [Up(1, 53.75m, 52.5m, 1.25m, Lb)]);
    }

    [TestMethod]
    public void EachSetStepsByItsOwnNumber()
    {
        // Line (i): 5 → 7 and 6 → 8, and set 3 by its own 1 kg step, in whatever order the sets come.
        var last = Done(WorkoutA, LastWeek, Logged(3, 10m, 10), Logged(1, 5m, 10), Logged(2, 6m, 10));

        AssertStanding(Judge(Coming(ComingSet(2, 2m, 6m), ComingSet(3, 1m, 10m), ComingSet(1, 2m, 5m)), last),
            LiftStandingOutcome.StepUp, Why(LiftStandingReason.EverySetDone, LastWeek), last,
            [Up(1, 7m, 5m, 2m), Up(2, 8m, 6m, 2m), Up(3, 11m, 10m, 1m)]);
    }

    // ----- line (a): every set ticked with its reps typed, at or above what that workout asked -----

    [TestMethod]
    public void ASetShortOfItsRepsHoldsAtLastTimesWeight()
    {
        // Decision 20: "Same weight · set 3 reached 8 of 10 on Tue".
        var last = Done(WorkoutA, LastWeek, Did(15m, 10, 10, 8));
        AssertStanding(Judge(ThreeSets(), last),
            LiftStandingOutcome.Hold, Why(LiftStandingReason.RepsShort, LastWeek, set: 3, reps: 8, asked: 10), last,
            SameAll(15m, current: 15m));

        // Two sets short: the first is named.
        var twoShort = Done(WorkoutA, LastWeek, Did(15m, 10, 9, 8));
        AssertStanding(Judge(ThreeSets(), twoShort),
            LiftStandingOutcome.Hold, Why(LiftStandingReason.RepsShort, LastWeek, set: 2, reps: 9, asked: 10), twoShort,
            SameAll(15m, current: 15m));
    }

    [TestMethod]
    public void ASetLoggedWithNoRepsTypedNeverCounts()
    {
        // Decision 22: set 2 was ticked at 15 kg with the reps box left empty, whether reps were asked or not.
        var last = Done(WorkoutA, LastWeek, Did(15m, 10, null, 10));
        AssertStanding(Judge(ThreeSets(), last),
            LiftStandingOutcome.Hold, Why(LiftStandingReason.NoRepsTyped, LastWeek, set: 2), last,
            SameAll(15m, current: 15m));

        var nothingAsked = Done(WorkoutA, LastWeek, Logged(1, 15m, 10), Logged(2, 15m, null, asked: null), Logged(3, 15m, 10));
        AssertStanding(Judge(ThreeSets(), nothingAsked),
            LiftStandingOutcome.Hold, Why(LiftStandingReason.NoRepsTyped, LastWeek, set: 2), nothingAsked,
            SameAll(15m, current: 15m));
    }

    [TestMethod]
    public void ASetNeverTickedHoldsAndHasNoWeightToKeep()
    {
        // Set 3 was never ticked and never logged before: sets 1 and 2 keep last time's 15 kg over their own 14 kg, and
        // set 3, with no earlier log to carry on, keeps its own.
        var untouched = Done(WorkoutA, LastWeek, [.. Did(15m, 10, 10), Logged(3, null, null, completed: false)]);
        AssertStanding(Judge(ThreeSets(own: 14m), untouched),
            LiftStandingOutcome.Hold, Why(LiftStandingReason.SetNotLogged, LastWeek, set: 3), untouched,
            [Same(1, 15m, 14m, 2m), Same(2, 15m, 14m, 2m), Kept(3, 14m, 2m, SetStandingNote.NoWeightLogged)]);

        // A weight and reps typed but never ticked are the same: only a ticked set is logged.
        var typed = Done(WorkoutA, LastWeek, [.. Did(15m, 10, 10), Logged(3, 15m, 10, completed: false)]);
        AssertStanding(Judge(ThreeSets(own: 14m), typed),
            LiftStandingOutcome.Hold, Why(LiftStandingReason.SetNotLogged, LastWeek, set: 3), typed,
            [Same(1, 15m, 14m, 2m), Same(2, 15m, 14m, 2m), Kept(3, 14m, 2m, SetStandingNote.NoWeightLogged)]);
    }

    [TestMethod]
    public void RepsAtOrAboveWhatThatWorkoutAskedCountAndAnyRepsCountWhenNoneWereAsked()
    {
        // A range of 8 to 12 asks its top, 12: 13 counts and 11 holds.
        var aboveTop = Done(WorkoutA, LastWeek,
            Logged(1, 15m, 13, asked: 12), Logged(2, 15m, 12, asked: 12), Logged(3, 15m, 12, asked: 12));
        AssertStanding(Judge(ThreeSets(), aboveTop),
            LiftStandingOutcome.StepUp, Why(LiftStandingReason.EverySetDone, LastWeek), aboveTop, UpAll(17m, current: 15m));

        var belowTop = Done(WorkoutA, LastWeek,
            Logged(1, 15m, 12, asked: 12), Logged(2, 15m, 11, asked: 12), Logged(3, 15m, 12, asked: 12));
        AssertStanding(Judge(ThreeSets(), belowTop),
            LiftStandingOutcome.Hold, Why(LiftStandingReason.RepsShort, LastWeek, set: 2, reps: 11, asked: 12), belowTop,
            SameAll(15m, current: 15m));

        // A fixed 10 is reached at 10.
        var exactly = Done(WorkoutA, LastWeek, Did(15m, 10, 10, 10));
        AssertStanding(Judge(ThreeSets(), exactly),
            LiftStandingOutcome.StepUp, Why(LiftStandingReason.EverySetDone, LastWeek), exactly, UpAll(17m, current: 15m));

        // A set that asked no reps counts any reps typed.
        var nothingAsked = Done(WorkoutA, LastWeek,
            Logged(1, 15m, 1, asked: null), Logged(2, 15m, 3, asked: null), Logged(3, 15m, 20, asked: null));
        AssertStanding(Judge(ThreeSets(), nothingAsked),
            LiftStandingOutcome.StepUp, Why(LiftStandingReason.EverySetDone, LastWeek), nothingAsked,
            UpAll(17m, current: 15m));
    }

    [TestMethod]
    public void AWarmUpNeverHoldsTheLiftButStillStepsByItsOwnNumber()
    {
        // Warm-ups are left out of line (a) (the chat's choice: no week step moves a warm-up, TRN-025). Set 1 is a
        // warm-up step set, 10 kg and 1 kg a time, and moves from its own last weight.
        var coming = Coming(ComingSet(1, 1m, 10m), ComingSet(2, 2m, 15m), ComingSet(3, 2m, 15m));

        var shortWarmUp = Done(WorkoutA, LastWeek,
            Logged(1, 10m, 6, type: TrainingSetType.WarmUp), Logged(2, 15m, 10), Logged(3, 15m, 10));
        AssertStanding(Judge(coming, shortWarmUp),
            LiftStandingOutcome.StepUp, Why(LiftStandingReason.EverySetDone, LastWeek), shortWarmUp,
            [Up(1, 11m, 10m, 1m), Up(2, 17m, 15m, 2m), Up(3, 17m, 15m, 2m)]);

        // A warm-up ticked with its reps box left empty holds nothing either, but it never steps (decision 22, revised
        // after the review): it carries on the 10 kg it logged, the latest log that stood, and says why, while the
        // working sets step.
        var noRepsWarmUp = Done(WorkoutA, LastWeek,
            Logged(1, 10m, null, type: TrainingSetType.WarmUp), Logged(2, 15m, 10), Logged(3, 15m, 10));
        AssertStanding(Judge(coming, noRepsWarmUp),
            LiftStandingOutcome.StepUp, Why(LiftStandingReason.EverySetDone, LastWeek), noRepsWarmUp,
            [Same(1, 10m, 10m, 1m, SetStandingNote.NoRepsTyped), Up(2, 17m, 15m, 2m), Up(3, 17m, 15m, 2m)]);

        // A warm-up never ticked holds nothing either; with no weight to step from and no earlier log to carry on, it
        // keeps its own.
        var skippedWarmUp = Done(WorkoutA, LastWeek,
            Logged(1, null, null, type: TrainingSetType.WarmUp, completed: false), Logged(2, 15m, 10), Logged(3, 15m, 10));
        AssertStanding(Judge(coming, skippedWarmUp),
            LiftStandingOutcome.StepUp, Why(LiftStandingReason.EverySetDone, LastWeek), skippedWarmUp,
            [Kept(1, 10m, 1m, SetStandingNote.NoWeightLogged), Up(2, 17m, 15m, 2m), Up(3, 17m, 15m, 2m)]);
    }

    // ----- line (b): last time within the last 14 days -----

    [TestMethod]
    public void LastTimeMoreThanFourteenDaysAgoHoldsAtTheSetsOwnWeight()
    {
        // "Same weight · last done Mon 26 Oct, more than 14 days ago": each set keeps its own 12.5 kg (line d), and the
        // reason names the workout last done.
        var fifteenDays = Done(WorkoutA, FifteenDaysAgo, Did(15m, 10, 10, 10));
        AssertStanding(Judge(ThreeSets(own: 12.5m), fifteenDays),
            LiftStandingOutcome.Hold, Why(LiftStandingReason.LastDoneTooLongAgo, FifteenDaysAgo, workout: WorkoutA), null,
            KeptAll(12.5m));

        // 14 days ago to the day is within.
        var fourteenDays = Done(WorkoutA, TwoWeeksAgo, Did(15m, 10, 10, 10));
        AssertStanding(Judge(ThreeSets(own: 12.5m), fourteenDays),
            LiftStandingOutcome.StepUp, Why(LiftStandingReason.EverySetDone, TwoWeeksAgo), fourteenDays,
            UpAll(17m, current: 12.5m));

        // The days count back from today, never from a coming session three days off.
        AssertStanding(Judge(ThreeSets(own: 12.5m) with { SessionDate = Today.AddDays(3) }, fourteenDays),
            LiftStandingOutcome.StepUp, Why(LiftStandingReason.EverySetDone, TwoWeeksAgo), fourteenDays,
            UpAll(17m, current: 12.5m));
    }

    // ----- line (c): no harder than planned -----

    [TestMethod]
    public void ASetRatedHarderThanItsTargetHoldsAtLastTimesWeight()
    {
        // "Same weight · set 2 felt harder than planned (RPE 9 of 8)"; set 3, harder still, comes after it.
        var last = Done(WorkoutA, LastWeek, Rated(1, 8m, 8m), Rated(2, 8m, 9m), Rated(3, 8m, 9.5m));
        AssertStanding(Judge(ThreeSets(), last),
            LiftStandingOutcome.Hold,
            Why(LiftStandingReason.HarderThanPlanned, LastWeek, set: 2, rpe: 9m, targetRpe: 8m), last,
            SameAll(15m, current: 15m));

        // Half a point over is over.
        var half = Done(WorkoutA, LastWeek, Rated(1, 8m, 8.5m), Rated(2, 8m, 8m), Rated(3, 8m, 8m));
        AssertStanding(Judge(ThreeSets(), half),
            LiftStandingOutcome.Hold,
            Why(LiftStandingReason.HarderThanPlanned, LastWeek, set: 1, rpe: 8.5m, targetRpe: 8m), half,
            SameAll(15m, current: 15m));
    }

    [TestMethod]
    public void AnEqualRatingNoRatingOrNoTargetNeverHolds()
    {
        // No rating is no hold, nor is a rating with no target to be harder than; a warm-up is left out of line (c) as
        // of line (a) (the chat's choice).
        (string Label, LoggedLift Last)[] cases =
        [
            ("rated 8 of 8", Done(WorkoutA, LastWeek, Rated(1, 8m, 8m), Rated(2, 8m, 8m), Rated(3, 8m, 8m))),
            ("no target, no rating", Done(WorkoutA, LastWeek, Rated(1, null, null), Rated(2, null, null), Rated(3, null, null))),
            ("a target, no rating", Done(WorkoutA, LastWeek, Rated(1, 8m, null), Rated(2, 8m, null), Rated(3, 8m, null))),
            ("a rating, no target", Done(WorkoutA, LastWeek, Rated(1, null, 9.5m), Rated(2, null, 9.5m), Rated(3, null, 9.5m))),
            ("a warm-up over its target", Done(WorkoutA, LastWeek,
                Logged(1, 15m, 10, type: TrainingSetType.WarmUp, targetRpe: 5m, rpe: 7m), Rated(2, 8m, 8m), Rated(3, 8m, 7.5m))),
        ];

        foreach (var (label, last) in cases)
        {
            AssertStanding(Judge(ThreeSets(), last),
                LiftStandingOutcome.StepUp, Why(LiftStandingReason.EverySetDone, LastWeek), last, UpAll(17m, current: 15m),
                label);
        }
    }

    // ----- line (d): carry on from last time -----

    [TestMethod]
    public void LastTimesWeightCarriesOnOverANewProgramsStartingWeight()
    {
        // Decision 22: the new program starts the curl at 5 kg, but the client did 15 kg last time.
        var done = Done(WorkoutA, LastWeek, Did(15m, 10, 10, 10));
        AssertStanding(Judge(ThreeSets(own: 5m), done),
            LiftStandingOutcome.StepUp, Why(LiftStandingReason.EverySetDone, LastWeek), done, UpAll(17m, current: 5m));

        // On a hold of line (a) or (c), last time's 15 kg is the weight to keep, never the 5 kg start.
        var missed = Done(WorkoutA, LastWeek, Did(15m, 10, 10, 8));
        AssertStanding(Judge(ThreeSets(own: 5m), missed),
            LiftStandingOutcome.Hold, Why(LiftStandingReason.RepsShort, LastWeek, set: 3, reps: 8, asked: 10), missed,
            SameAll(15m, current: 5m));

        var harder = Done(WorkoutA, LastWeek, Rated(1, 8m, 9m), Rated(2, 8m, 8m), Rated(3, 8m, 8m));
        AssertStanding(Judge(ThreeSets(own: 5m), harder),
            LiftStandingOutcome.Hold,
            Why(LiftStandingReason.HarderThanPlanned, LastWeek, set: 1, rpe: 9m, targetRpe: 8m), harder,
            SameAll(15m, current: 5m));
    }

    [TestMethod]
    public void LastTimeIsTheLatestWorkoutOfTheLiftWhateverItsProgramOrSessionName()
    {
        // The rule reads workouts only, never a program or a session's name: the old program's "Lower A" on 27 Oct at
        // 14 kg and the new program's "Legs" on 3 Nov at 15 kg are both the leg curl, and the later one is last time.
        var oldProgram = Done(WorkoutB, TwoWeeksAgo, Did(14m, 10, 10, 10));
        var newProgram = Done(WorkoutA, LastWeek, Did(15m, 10, 10, 10));

        AssertStanding(Judge(ThreeSets(own: 5m), newProgram, oldProgram),
            LiftStandingOutcome.StepUp, Why(LiftStandingReason.EverySetDone, LastWeek), newProgram, UpAll(17m, current: 5m));
    }

    [TestMethod]
    public void LineAReadsEverySetOfLastTimeNotOnlyTheComingStepSets()
    {
        // Last time's program wrote the curl as four typed sets and the fourth reached 6 of 10: the coming writing's
        // three step sets hold at last time's weight.
        var last = Done(WorkoutA, LastWeek, Did(15m, 10, 10, 10, 6));

        AssertStanding(Judge(ThreeSets(own: 5m), last),
            LiftStandingOutcome.Hold, Why(LiftStandingReason.RepsShort, LastWeek, set: 4, reps: 6, asked: 10), last,
            SameAll(15m, current: 5m));
    }

    [TestMethod]
    public void ASetWithNoWeightOfItsOwnStepsFromLastTimeAndKeepsNoneWhenItHolds()
    {
        // A step set with no starting weight: the client picks, so its own weight is none.
        var done = Done(WorkoutA, LastWeek, Did(15m, 10, 10, 10));
        AssertStanding(Judge(ThreeSets(own: null), done),
            LiftStandingOutcome.StepUp, Why(LiftStandingReason.EverySetDone, LastWeek), done, UpAll(17m, current: null));

        AssertStanding(Judge(ThreeSets(own: null)),
            LiftStandingOutcome.Hold, Why(LiftStandingReason.NeverDone), null, KeptAll(null));
    }

    [TestMethod]
    public void AHoldCarriesASetLastTimeLeftWithoutAWeightOnFromItsEarlierLog()
    {
        // Revised after the review: last week set 2 was never ticked, and the week before (14 days ago, within the
        // lookback) logged it at 15 kg. On the hold, set 2 carries on at 15 kg over its own 14 kg and says last time had
        // no weight, while sets 1 and 3 keep last week's 16 kg.
        var before = Done(WorkoutA, TwoWeeksAgo, Did(15m, 10, 10, 10));
        var notTicked = Done(WorkoutB, LastWeek, Logged(1, 16m, 10), Logged(2, null, null, completed: false), Logged(3, 16m, 10));
        AssertStanding(Judge(ThreeSets(own: 14m), before, notTicked),
            LiftStandingOutcome.Hold, Why(LiftStandingReason.SetNotLogged, LastWeek, set: 2), notTicked,
            [Same(1, 16m, 14m, 2m), Same(2, 15m, 14m, 2m, SetStandingNote.NoWeightLogged), Same(3, 16m, 14m, 2m)]);

        // A weight typed but never ticked is no log: set 2 carries on at 15 kg, never the 20 kg left in its box.
        var typed = Done(WorkoutB, LastWeek, Logged(1, 16m, 10), Logged(2, 20m, 10, completed: false), Logged(3, 16m, 10));
        AssertStanding(Judge(ThreeSets(own: 14m), before, typed),
            LiftStandingOutcome.Hold, Why(LiftStandingReason.SetNotLogged, LastWeek, set: 2), typed,
            [Same(1, 16m, 14m, 2m), Same(2, 15m, 14m, 2m, SetStandingNote.NoWeightLogged), Same(3, 16m, 14m, 2m)]);

        // The whole lift skipped in a finished workout never drops a new program back to its 5 kg start: every set
        // carries on at the 15 kg logged the week before, and says last time had no weight.
        var skipped = Done(WorkoutB, LastWeek, Logged(1, null, null, completed: false),
            Logged(2, null, null, completed: false), Logged(3, null, null, completed: false));
        AssertStanding(Judge(ThreeSets(own: 5m), before, skipped),
            LiftStandingOutcome.Hold, Why(LiftStandingReason.SetNotLogged, LastWeek, set: 1), skipped,
            SameAll(15m, current: 5m, note: SetStandingNote.NoWeightLogged));

        // With no earlier log at all, each set keeps its own and says so.
        AssertStanding(Judge(ThreeSets(own: 5m), skipped),
            LiftStandingOutcome.Hold, Why(LiftStandingReason.SetNotLogged, LastWeek, set: 1), skipped,
            KeptAll(5m, note: SetStandingNote.NoWeightLogged));

        // A hold of line (c) carries on the same way: set 2 was ticked with its reps but no weight, and set 1 felt harder.
        var harder = Done(WorkoutB, LastWeek,
            Logged(1, 16m, 10, targetRpe: 8m, rpe: 9m), Logged(2, null, 10), Logged(3, 16m, 10));
        AssertStanding(Judge(ThreeSets(own: 14m), before, harder),
            LiftStandingOutcome.Hold,
            Why(LiftStandingReason.HarderThanPlanned, LastWeek, set: 1, rpe: 9m, targetRpe: 8m), harder,
            [Same(1, 16m, 14m, 2m), Same(2, 15m, 14m, 2m, SetStandingNote.NoWeightLogged), Same(3, 16m, 14m, 2m)]);
    }

    [TestMethod]
    public void ACarriedOnWeightIsTheSetsLatestEarlierLogThatStoodInItsUnit()
    {
        // Set 2 logged 13 kg, 14 kg, then 150 kg (a typo), and last week it was never ticked. The latest log that stood is
        // the 14 kg of three weeks ago, past the lookback: it is never carried on, nor is the typo after it, within the
        // lookback but never standing, so the set keeps its own 12.5 kg and says last time had no weight.
        var oldest = Done(WorkoutA, FourWeeksAgo, Did(13m, 10, 10, 10));
        var earlier = Done(WorkoutB, ThreeWeeksAgo, Did(14m, 10, 10, 10));
        var typo = Done(WorkoutC, TwoWeeksAgo, Logged(1, 15m, 10), Logged(2, 150m, 10), Logged(3, 15m, 10));
        var notTicked = Done(WorkoutD, LastWeek, Logged(1, 16m, 10), Logged(2, null, null, completed: false), Logged(3, 16m, 10));
        AssertStanding(Judge(ThreeSets(own: 12.5m), oldest, earlier, typo, notTicked),
            LiftStandingOutcome.Hold, Why(LiftStandingReason.SetNotLogged, LastWeek, set: 2), notTicked,
            [Same(1, 16m, 12.5m, 2m), Kept(2, 12.5m, 2m, SetStandingNote.NoWeightLogged), Same(3, 16m, 12.5m, 2m)]);

        // With the 14 kg logged 12 days ago and the typo after it, set 2 carries on at 14 kg, the latest log that stood,
        // never the typo after it nor the 13 kg before it, and says last time had no weight.
        var recent = Done(WorkoutB, LastWeek.AddDays(-5), Did(14m, 10, 10, 10));
        var recentTypo = Done(WorkoutC, LastWeek.AddDays(-2), Logged(1, 15m, 10), Logged(2, 150m, 10), Logged(3, 15m, 10));
        AssertStanding(Judge(ThreeSets(own: 12.5m), oldest, recent, recentTypo, notTicked),
            LiftStandingOutcome.Hold, Why(LiftStandingReason.SetNotLogged, LastWeek, set: 2), notTicked,
            [Same(1, 16m, 12.5m, 2m), Same(2, 14m, 12.5m, 2m, SetStandingNote.NoWeightLogged), Same(3, 16m, 12.5m, 2m)]);

        // A log in the other unit is never carried on: set 2's 33 lb is passed over for the 14 kg before it, which is
        // carried on when logged 12 days ago and not when logged three weeks ago, and with no log in kg at all the set
        // keeps its own.
        var pounds = Done(WorkoutC, TwoWeeksAgo, Logged(1, 15m, 10), Logged(2, 33m, 10, unit: Lb), Logged(3, 15m, 10));
        AssertStanding(Judge(ThreeSets(own: 12.5m), earlier, pounds, notTicked),
            LiftStandingOutcome.Hold, Why(LiftStandingReason.SetNotLogged, LastWeek, set: 2), notTicked,
            [Same(1, 16m, 12.5m, 2m), Kept(2, 12.5m, 2m, SetStandingNote.NoWeightLogged), Same(3, 16m, 12.5m, 2m)]);

        var recentPounds = Done(WorkoutC, LastWeek.AddDays(-2),
            Logged(1, 15m, 10), Logged(2, 33m, 10, unit: Lb), Logged(3, 15m, 10));
        AssertStanding(Judge(ThreeSets(own: 12.5m), recent, recentPounds, notTicked),
            LiftStandingOutcome.Hold, Why(LiftStandingReason.SetNotLogged, LastWeek, set: 2), notTicked,
            [Same(1, 16m, 12.5m, 2m), Same(2, 14m, 12.5m, 2m, SetStandingNote.NoWeightLogged), Same(3, 16m, 12.5m, 2m)]);

        AssertStanding(Judge(ThreeSets(own: 12.5m), pounds, notTicked),
            LiftStandingOutcome.Hold, Why(LiftStandingReason.SetNotLogged, LastWeek, set: 2), notTicked,
            [Same(1, 16m, 12.5m, 2m), Kept(2, 12.5m, 2m, SetStandingNote.NoWeightLogged), Same(3, 16m, 12.5m, 2m)]);
    }

    [TestMethod]
    public void AnEarlierLogMoreThanFourteenDaysOldIsNeverCarriedOnButOneFourteenDaysOldIs()
    {
        // Last week set 2 was never ticked, and its 15 kg before that was logged 15 days ago: past the lookback (line b),
        // counted back from today and never from last time's day, eight days after it. Set 2 keeps its own 14 kg and says
        // last time had no weight.
        var notTicked = Done(WorkoutB, LastWeek, Logged(1, 16m, 10), Logged(2, null, null, completed: false), Logged(3, 16m, 10));
        var fifteenDays = Done(WorkoutA, FifteenDaysAgo, Did(15m, 10, 10, 10));
        AssertStanding(Judge(ThreeSets(own: 14m), fifteenDays, notTicked),
            LiftStandingOutcome.Hold, Why(LiftStandingReason.SetNotLogged, LastWeek, set: 2), notTicked,
            [Same(1, 16m, 14m, 2m), Kept(2, 14m, 2m, SetStandingNote.NoWeightLogged), Same(3, 16m, 14m, 2m)]);

        // Logged 14 days ago to the day, it is within: set 2 carries on at 15 kg, and still does for a coming session three
        // days off, the days counted back from today.
        var fourteenDays = Done(WorkoutA, TwoWeeksAgo, Did(15m, 10, 10, 10));
        SetStanding[] carried =
            [Same(1, 16m, 14m, 2m), Same(2, 15m, 14m, 2m, SetStandingNote.NoWeightLogged), Same(3, 16m, 14m, 2m)];
        AssertStanding(Judge(ThreeSets(own: 14m), fourteenDays, notTicked),
            LiftStandingOutcome.Hold, Why(LiftStandingReason.SetNotLogged, LastWeek, set: 2), notTicked, carried);
        AssertStanding(Judge(ThreeSets(own: 14m) with { SessionDate = Today.AddDays(3) }, fourteenDays, notTicked),
            LiftStandingOutcome.Hold, Why(LiftStandingReason.SetNotLogged, LastWeek, set: 2), notTicked, carried);

        // The same where every set is done and set 2 was ticked with its reps but no weight: sets 1 and 3 step from 16 kg,
        // and set 2 keeps its own past the lookback and carries on within it.
        var blank = Done(WorkoutB, LastWeek, Logged(1, 16m, 10), Logged(2, null, 10), Logged(3, 16m, 10));
        AssertStanding(Judge(ThreeSets(own: 14m), fifteenDays, blank),
            LiftStandingOutcome.StepUp, Why(LiftStandingReason.EverySetDone, LastWeek), blank,
            [Up(1, 18m, 14m, 2m), Kept(2, 14m, 2m, SetStandingNote.NoWeightLogged), Up(3, 18m, 14m, 2m)]);
        AssertStanding(Judge(ThreeSets(own: 14m), fourteenDays, blank),
            LiftStandingOutcome.StepUp, Why(LiftStandingReason.EverySetDone, LastWeek), blank,
            [Up(1, 18m, 14m, 2m), Same(2, 15m, 14m, 2m, SetStandingNote.NoWeightLogged), Up(3, 18m, 14m, 2m)]);
    }

    // ----- line (e): the typo guard -----

    [TestMethod]
    public void AWeightMoreThanAQuarterFromTheOneBeforeLooksLikeATypoAndEachSetKeepsItsOwn()
    {
        // Decision 22: "Same weight · 55 kg logged on Tue looks like a typo (5.5 kg the time before)".
        var first = Done(WorkoutA, ThreeWeeksAgo, Logged(1, 5.5m, 10), Logged(2, 5.5m, 10));
        var second = Done(WorkoutB, TwoWeeksAgo, Logged(1, 5.5m, 10), Logged(2, 5.5m, 10));
        var typo = Done(WorkoutC, LastWeek, Logged(1, 5.5m, 10), Logged(2, 55m, 10));

        AssertStanding(Judge(Coming(ComingSet(1, 0.5m, 5.5m), ComingSet(2, 0.5m, 5.5m)), first, second, typo),
            LiftStandingOutcome.Hold,
            Why(LiftStandingReason.LooksLikeTypo, LastWeek, set: 2, weight: 55m, earlier: 5.5m, unit: Kg), typo,
            [Kept(1, 5.5m, 0.5m), Kept(2, 5.5m, 0.5m)]);
    }

    [TestMethod]
    public void OneTypoHoldsOnceAndTheNextSensibleLogStepsAgain()
    {
        // 55 kg never stood, so last week's 5.5 kg is read against the 5.5 kg before the typo.
        var first = Done(WorkoutA, ThreeWeeksAgo, Logged(1, 5.5m, 10));
        var typo = Done(WorkoutB, TwoWeeksAgo, Logged(1, 55m, 10));
        var sensible = Done(WorkoutC, LastWeek, Logged(1, 5.5m, 10));

        AssertStanding(Judge(Coming(ComingSet(1, 0.5m, 5.5m)), first, typo, sensible),
            LiftStandingOutcome.StepUp, Why(LiftStandingReason.EverySetDone, LastWeek), sensible, [Up(1, 6m, 5.5m, 0.5m)]);
    }

    [TestMethod]
    public void AQuarterEitherWayStandsAndAHundredthPastItHolds()
    {
        var coming = Coming(ComingSet(1, 2m, 15m));

        // 12 to 15 kg is a quarter up and 16 to 12 kg a quarter down: both stand.
        var up = Done(WorkoutB, LastWeek, Logged(1, 15m, 10));
        AssertStanding(Judge(coming, Done(WorkoutA, TwoWeeksAgo, Logged(1, 12m, 10)), up),
            LiftStandingOutcome.StepUp, Why(LiftStandingReason.EverySetDone, LastWeek), up, [Up(1, 17m, 15m, 2m)]);

        var down = Done(WorkoutB, LastWeek, Logged(1, 12m, 10));
        AssertStanding(Judge(coming, Done(WorkoutA, TwoWeeksAgo, Logged(1, 16m, 10)), down),
            LiftStandingOutcome.StepUp, Why(LiftStandingReason.EverySetDone, LastWeek), down, [Up(1, 14m, 15m, 2m)]);

        // 12 to 15.01 kg and 16 to 11.99 kg are past it.
        var pastUp = Done(WorkoutB, LastWeek, Logged(1, 15.01m, 10));
        AssertStanding(Judge(coming, Done(WorkoutA, TwoWeeksAgo, Logged(1, 12m, 10)), pastUp),
            LiftStandingOutcome.Hold,
            Why(LiftStandingReason.LooksLikeTypo, LastWeek, set: 1, weight: 15.01m, earlier: 12m, unit: Kg), pastUp,
            [Kept(1, 15m, 2m)]);

        var pastDown = Done(WorkoutB, LastWeek, Logged(1, 11.99m, 10));
        AssertStanding(Judge(coming, Done(WorkoutA, TwoWeeksAgo, Logged(1, 16m, 10)), pastDown),
            LiftStandingOutcome.Hold,
            Why(LiftStandingReason.LooksLikeTypo, LastWeek, set: 1, weight: 11.99m, earlier: 16m, unit: Kg), pastDown,
            [Kept(1, 15m, 2m)]);
    }

    [TestMethod]
    public void ARepeatedJumpOrTypoHoldsAgainUntilTheCoachTypesTheWeight()
    {
        // The coach asked 10 kg and the client did 15 kg: half as much again, so it holds.
        var before = Done(WorkoutA, TwoWeeksAgo, Logged(1, 10m, 10, prescribed: 10m));
        var jump = Done(WorkoutB, LastWeek, Logged(1, 15m, 10, prescribed: 10m));
        AssertStanding(Judge(Coming(ComingSet(1, 2.5m, 10m)), before, jump),
            LiftStandingOutcome.Hold,
            Why(LiftStandingReason.LooksLikeTypo, LastWeek, set: 1, weight: 15m, earlier: 10m, unit: Kg), jump,
            [Kept(1, 10m, 2.5m)]);

        // 15 kg again the next time holds again, still read against the 10 kg that stood (revised after the review: the
        // player opens a step set's box at last time's weight, so a repeated log proves nothing).
        var earlier = Done(WorkoutA, ThreeWeeksAgo, Logged(1, 10m, 10, prescribed: 10m));
        var jumped = Done(WorkoutB, TwoWeeksAgo, Logged(1, 15m, 10, prescribed: 10m));
        var again = Done(WorkoutC, LastWeek, Logged(1, 15m, 10, prescribed: 10m));
        AssertStanding(Judge(Coming(ComingSet(1, 2.5m, 10m)), earlier, jumped, again),
            LiftStandingOutcome.Hold,
            Why(LiftStandingReason.LooksLikeTypo, LastWeek, set: 1, weight: 15m, earlier: 10m, unit: Kg), again,
            [Kept(1, 10m, 2.5m)]);

        // Decision 22's typo, logged twice on a set with no starting weight: 5.5 kg, then 55 kg, then 55 kg again. The
        // second 55 kg holds again, read against 5.5 kg, and the set keeps its own: none, the client picks.
        var light = Done(WorkoutA, ThreeWeeksAgo, Logged(1, 5.5m, 10));
        var typo = Done(WorkoutB, TwoWeeksAgo, Logged(1, 55m, 10));
        var repeated = Done(WorkoutC, LastWeek, Logged(1, 55m, 10));
        AssertStanding(Judge(Coming(ComingSet(1, 0.5m, null)), light, typo, repeated),
            LiftStandingOutcome.Hold,
            Why(LiftStandingReason.LooksLikeTypo, LastWeek, set: 1, weight: 55m, earlier: 5.5m, unit: Kg), repeated,
            [Kept(1, null, 0.5m)]);

        // Until the coach types 55 kg with Edit weeks: the next workout asks 55 kg and the client logs it. What that
        // workout asked is never a typo, so 55 kg stands and the lift steps from it.
        var typed = Done(WorkoutD, LastWeek, Logged(1, 55m, 10, prescribed: 55m));
        LoggedLift[] untilTyped =
        [
            Done(WorkoutA, FourWeeksAgo, Logged(1, 5.5m, 10)),
            Done(WorkoutB, ThreeWeeksAgo, Logged(1, 55m, 10)),
            Done(WorkoutC, TwoWeeksAgo, Logged(1, 55m, 10)),
            typed,
        ];
        AssertStanding(Judge(Coming(ComingSet(1, 0.5m, 55m)), untilTyped),
            LiftStandingOutcome.StepUp, Why(LiftStandingReason.EverySetDone, LastWeek), typed, [Up(1, 55.5m, 55m, 0.5m)]);
    }

    [TestMethod]
    public void TwoTyposInARowAreBothReadAgainstTheLastWeightThatStood()
    {
        // 55 kg never stood, so last week's 550 kg is read against the 5.5 kg before both, and named with it.
        var light = Done(WorkoutA, ThreeWeeksAgo, Logged(1, 5.5m, 10));
        var typo = Done(WorkoutB, TwoWeeksAgo, Logged(1, 55m, 10));
        var worse = Done(WorkoutC, LastWeek, Logged(1, 550m, 10));

        AssertStanding(Judge(Coming(ComingSet(1, 0.5m, 5.5m)), light, typo, worse),
            LiftStandingOutcome.Hold,
            Why(LiftStandingReason.LooksLikeTypo, LastWeek, set: 1, weight: 550m, earlier: 5.5m, unit: Kg), worse,
            [Kept(1, 5.5m, 0.5m)]);
    }

    [TestMethod]
    public void AJumpToTheWeightThatWorkoutAskedIsNeverATypo()
    {
        // The coach applied a 2.5 kg step to a light 5 kg curl: 7.5 kg is half as much again, but it is what that
        // workout asked (the chat's choice).
        var before = Done(WorkoutA, TwoWeeksAgo, Logged(1, 5m, 10, prescribed: 5m));
        var applied = Done(WorkoutB, LastWeek, Logged(1, 7.5m, 10, prescribed: 7.5m));
        AssertStanding(Judge(Coming(ComingSet(1, 2.5m, 7.5m)), before, applied),
            LiftStandingOutcome.StepUp, Why(LiftStandingReason.EverySetDone, LastWeek), applied, [Up(1, 10m, 7.5m, 2.5m)]);

        // The same 7.5 kg holds where that workout still asked 5 kg, or asked 7.5 in pounds.
        var unasked = Done(WorkoutB, LastWeek, Logged(1, 7.5m, 10, prescribed: 5m));
        AssertStanding(Judge(Coming(ComingSet(1, 2.5m, 7.5m)), before, unasked),
            LiftStandingOutcome.Hold,
            Why(LiftStandingReason.LooksLikeTypo, LastWeek, set: 1, weight: 7.5m, earlier: 5m, unit: Kg), unasked,
            [Kept(1, 7.5m, 2.5m)]);

        var askedInPounds = Done(WorkoutB, LastWeek, Logged(1, 7.5m, 10, prescribed: 7.5m) with { PrescribedUnit = Lb });
        AssertStanding(Judge(Coming(ComingSet(1, 2.5m, 7.5m)), before, askedInPounds),
            LiftStandingOutcome.Hold,
            Why(LiftStandingReason.LooksLikeTypo, LastWeek, set: 1, weight: 7.5m, earlier: 5m, unit: Kg), askedInPounds,
            [Kept(1, 7.5m, 2.5m)]);
    }

    [TestMethod]
    public void AFirstLogOrALogAfterZeroNeverTrips()
    {
        // A first log has nothing to compare: 55 kg on a set that asked 5.5 kg steps from 55 kg.
        var only = Done(WorkoutA, LastWeek, Logged(1, 55m, 10, prescribed: 5.5m));
        AssertStanding(Judge(Coming(ComingSet(1, 0.5m, 5.5m)), only),
            LiftStandingOutcome.StepUp, Why(LiftStandingReason.EverySetDone, LastWeek), only, [Up(1, 55.5m, 5.5m, 0.5m)]);

        // A quarter of nothing is nothing, so a log after 0 kg never trips.
        var zero = Done(WorkoutA, TwoWeeksAgo, Logged(1, 0m, 10));
        var loaded = Done(WorkoutB, LastWeek, Logged(1, 20m, 10));
        AssertStanding(Judge(Coming(ComingSet(1, 2m, 20m)), zero, loaded),
            LiftStandingOutcome.StepUp, Why(LiftStandingReason.EverySetDone, LastWeek), loaded, [Up(1, 22m, 20m, 2m)]);
    }

    [TestMethod]
    public void TheTypoGuardReadsOnlyFinishedLogsInTheLoggedUnit()
    {
        // The old program logged the curl in pounds: 100 lb is nothing to read 15 kg against, so 15 kg is a first log.
        var pounds = Done(WorkoutA, TwoWeeksAgo, Logged(1, 100m, 10, unit: Lb));
        var kilograms = Done(WorkoutB, LastWeek, Logged(1, 15m, 10));
        AssertStanding(Judge(Coming(ComingSet(1, 2m, 15m)), pounds, kilograms),
            LiftStandingOutcome.StepUp, Why(LiftStandingReason.EverySetDone, LastWeek), kilograms, [Up(1, 17m, 15m, 2m)]);

        // A workout left running is never in the chain, its ticked 55 kg neither.
        var running = Running(WorkoutA, TwoWeeksAgo, Logged(1, 55m, 10));
        var finished = Done(WorkoutB, LastWeek, Logged(1, 15m, 10));
        AssertStanding(Judge(Coming(ComingSet(1, 2m, 15m)), running, finished),
            LiftStandingOutcome.StepUp, Why(LiftStandingReason.EverySetDone, LastWeek), finished, [Up(1, 17m, 15m, 2m)]);
    }

    // ----- line (f): a lift written twice in one session -----

    [TestMethod]
    public void ALiftWrittenTwiceIsReadWritingByWritingNeverMixed()
    {
        // The squat's top set (its first writing) at 100 kg × 5 and its back-off (its second) at 60 kg × 8, two weeks
        // running; last week the back-off's third set reached 6 of 8. A guard that mixed the two writings would read
        // 60 kg after 100 kg as a typo.
        var topBefore = Done(WorkoutA, TwoWeeksAgo, Logged(1, 100m, 5, asked: 5));
        var backOffBefore = Done(WorkoutA, TwoWeeksAgo,
            Logged(1, 60m, 8, asked: 8), Logged(2, 60m, 8, asked: 8), Logged(3, 60m, 8, asked: 8)) with { Occurrence = 2 };
        var top = Done(WorkoutB, LastWeek, Logged(1, 100m, 5, asked: 5));
        var backOff = Done(WorkoutB, LastWeek,
            Logged(1, 60m, 8, asked: 8), Logged(2, 60m, 8, asked: 8), Logged(3, 60m, 6, asked: 8)) with { Occurrence = 2 };
        LoggedLift[] history = [topBefore, backOffBefore, top, backOff];

        // The back-off's miss does not hold the top set.
        AssertStanding(Judge(Squat(1, ComingSet(1, 2.5m, 100m)), history),
            LiftStandingOutcome.StepUp, Why(LiftStandingReason.EverySetDone, LastWeek), top, [Up(1, 102.5m, 100m, 2.5m)]);

        AssertStanding(Judge(Squat(2, ComingSet(1, 2.5m, 60m), ComingSet(2, 2.5m, 60m), ComingSet(3, 2.5m, 60m)), history),
            LiftStandingOutcome.Hold, Why(LiftStandingReason.RepsShort, LastWeek, set: 3, reps: 6, asked: 8), backOff,
            [Same(1, 60m, 60m, 2.5m), Same(2, 60m, 60m, 2.5m), Same(3, 60m, 60m, 2.5m)]);
    }

    [TestMethod]
    public void AWritingLastTimeDidNotHaveHoldsAtItsOwnWeightNamingThatDay()
    {
        // Two weeks ago the session had the squat twice, last week once: the back-off is matched to last week's
        // workout alone, never to an older one, and keeps its own 62.5 kg.
        var topBefore = Done(WorkoutA, TwoWeeksAgo, Logged(1, 100m, 5, asked: 5));
        var backOffBefore = Done(WorkoutA, TwoWeeksAgo, Logged(1, 60m, 8, asked: 8)) with { Occurrence = 2 };
        var top = Done(WorkoutB, LastWeek, Logged(1, 100m, 5, asked: 5));

        AssertStanding(Judge(Squat(2, ComingSet(1, 2.5m, 62.5m)), topBefore, backOffBefore, top),
            LiftStandingOutcome.Hold, Why(LiftStandingReason.NoMatchLastTime, LastWeek), null, [Kept(1, 62.5m, 2.5m)]);
    }

    // ----- line (g): a forgotten Finish -----

    [TestMethod]
    public void AWorkoutStillRunningIsNotLastTimeAndHoldsNamingItsDay()
    {
        // "Finish Tuesday's workout to go up": last week's workout was started, one set ticked, never finished. Each
        // set keeps its own 12.5 kg, whatever the finished workout before it says, and the reason names the running one.
        var finished = Done(WorkoutA, TwoWeeksAgo, Did(15m, 10, 10, 10));
        var running = Running(WorkoutB, LastWeek,
            Logged(1, 15m, 10), Logged(2, null, null, completed: false), Logged(3, null, null, completed: false));

        AssertStanding(Judge(ThreeSets(own: 12.5m), finished, running),
            LiftStandingOutcome.Hold, Why(LiftStandingReason.WorkoutInProgress, LastWeek, workout: WorkoutB), null,
            KeptAll(12.5m));
    }

    [TestMethod]
    public void AnOlderWorkoutLeftRunningIsPassedOver()
    {
        // Left running two weeks ago, behind last week's finished workout: no last time and no hold.
        var forgotten = Running(WorkoutA, TwoWeeksAgo,
            Logged(1, 15m, 10), Logged(2, null, null, completed: false), Logged(3, null, null, completed: false));
        var finished = Done(WorkoutB, LastWeek, Did(15m, 10, 10, 10));
        AssertStanding(Judge(ThreeSets(), forgotten, finished),
            LiftStandingOutcome.StepUp, Why(LiftStandingReason.EverySetDone, LastWeek), finished, UpAll(17m, current: 15m));

        // Line (b) is read before line (g) (the chat's choice): one left running 15 days ago reads as last done then, and
        // is named.
        var abandoned = Running(WorkoutA, FifteenDaysAgo, Did(15m, 10, 10, 10));
        AssertStanding(Judge(ThreeSets(own: 12.5m), abandoned),
            LiftStandingOutcome.Hold, Why(LiftStandingReason.LastDoneTooLongAgo, FifteenDaysAgo, workout: WorkoutA), null,
            KeptAll(12.5m));
    }

    [TestMethod]
    public void TheHoldsOfLinesBAndGNameTheWorkoutTheyRead()
    {
        // Line (b): of two workouts more than 14 days old, the one last done by its day is named, never the other, whose
        // id sorts after it.
        var older = Done(WorkoutB, ThreeWeeksAgo, Did(15m, 10, 10, 10));
        var lastDone = Done(WorkoutA, FifteenDaysAgo, Did(15m, 10, 10, 10));
        AssertStanding(Judge(ThreeSets(own: 12.5m), older, lastDone),
            LiftStandingOutcome.Hold, Why(LiftStandingReason.LastDoneTooLongAgo, FifteenDaysAgo, workout: WorkoutA), null,
            KeptAll(12.5m));

        // Line (g): the running workout is named, never the one finished that morning, whose id sorts after it.
        var finished = Done(WorkoutB, LastWeek, Did(15m, 10, 10, 10)) with { StartedAtUtc = At(LastWeek, 8) };
        var running = Running(WorkoutA, LastWeek, Logged(1, 16m, 10)) with { StartedAtUtc = At(LastWeek, 18) };
        AssertStanding(Judge(ThreeSets(own: 12.5m), running, finished),
            LiftStandingOutcome.Hold, Why(LiftStandingReason.WorkoutInProgress, LastWeek, workout: WorkoutA), null,
            KeptAll(12.5m));
    }

    // ----- line (h): weeks whose reps step up -----

    [TestMethod]
    public void TheRepsLastTimeAskedDecideNeverTheComingWeeks()
    {
        // Last week asked 8 and got 8 on every set. This week asks 10, which the rule never reads (a coming step set
        // carries no reps), so a block whose reps step up each week never blocks the step.
        var last = Done(WorkoutA, LastWeek, Logged(1, 15m, 8, asked: 8), Logged(2, 15m, 8, asked: 8), Logged(3, 15m, 8, asked: 8));

        AssertStanding(Judge(ThreeSets(), last),
            LiftStandingOutcome.StepUp, Why(LiftStandingReason.EverySetDone, LastWeek), last, UpAll(17m, current: 15m));
    }

    // ----- line (i): each set by its own number -----

    [TestMethod]
    public void AComingSetLastTimeDidNotHaveKeepsItsOwnWeightAndSaysSo()
    {
        // This week added a fourth set at 12.5 kg: sets 1 to 3 step, and set 4 keeps its own weight, never set 3's.
        var coming = Coming(ComingSet(1, 2m, 15m), ComingSet(2, 2m, 15m), ComingSet(3, 2m, 15m), ComingSet(4, 2m, 12.5m));

        var done = Done(WorkoutA, LastWeek, Did(15m, 10, 10, 10));
        AssertStanding(Judge(coming, done),
            LiftStandingOutcome.StepUp, Why(LiftStandingReason.EverySetDone, LastWeek), done,
            [.. UpAll(17m, current: 15m), Kept(4, 12.5m, 2m, SetStandingNote.NewSet)]);

        // On a hold too.
        var missed = Done(WorkoutA, LastWeek, Did(15m, 10, 10, 8));
        AssertStanding(Judge(coming, missed),
            LiftStandingOutcome.Hold, Why(LiftStandingReason.RepsShort, LastWeek, set: 3, reps: 8, asked: 10), missed,
            [.. SameAll(15m, current: 15m), Kept(4, 12.5m, 2m, SetStandingNote.NewSet)]);
    }

    [TestMethod]
    public void ASetDoneWithoutAWeightKeepsItsOwnAndWhenNoSetHasOneTheLiftHolds()
    {
        // Set 2 was ticked with its reps and no weight: it keeps its own 15 kg while sets 1 and 3 step.
        var oneBlank = Done(WorkoutA, LastWeek, Logged(1, 15m, 10), Logged(2, null, 10), Logged(3, 15m, 10));
        AssertStanding(Judge(ThreeSets(), oneBlank),
            LiftStandingOutcome.StepUp, Why(LiftStandingReason.EverySetDone, LastWeek), oneBlank,
            [Up(1, 17m, 15m, 2m), Kept(2, 15m, 2m, SetStandingNote.NoWeightLogged), Up(3, 17m, 15m, 2m)]);

        // No set has a weight: nothing can step, and the lift holds naming the first.
        var allBlank = Done(WorkoutA, LastWeek, Logged(1, null, 10), Logged(2, null, 10), Logged(3, null, 10));
        AssertStanding(Judge(ThreeSets(), allBlank),
            LiftStandingOutcome.Hold, Why(LiftStandingReason.NoWeightLogged, LastWeek, set: 1), allBlank,
            KeptAll(15m, note: SetStandingNote.NoWeightLogged));
    }

    [TestMethod]
    public void OnTheStepASetLastTimeLeftWithoutAWeightCarriesOnItsRecentEarlierLog()
    {
        // Last week set 2 was ticked with its reps but no weight, and four days before that it was logged at 15 kg: sets 1
        // and 3 step from last week's 16 kg, and set 2 carries on at 15 kg over its own 14 kg, never stepped from it, and
        // says last time had no weight.
        var before = Done(WorkoutA, LastWeek.AddDays(-4), Did(15m, 10, 10, 10));
        var blank = Done(WorkoutB, LastWeek, Logged(1, 16m, 10), Logged(2, null, 10), Logged(3, 16m, 10));
        AssertStanding(Judge(ThreeSets(own: 14m), before, blank),
            LiftStandingOutcome.StepUp, Why(LiftStandingReason.EverySetDone, LastWeek), blank,
            [Up(1, 18m, 14m, 2m), Same(2, 15m, 14m, 2m, SetStandingNote.NoWeightLogged), Up(3, 18m, 14m, 2m)]);

        // A warm-up step set never ticked last week carries on its earlier 10 kg over its own 8 kg the same way, while the
        // working sets step.
        var coming = Coming(ComingSet(1, 1m, 8m), ComingSet(2, 2m, 14m), ComingSet(3, 2m, 14m));
        var warmUpBefore = Done(WorkoutA, LastWeek.AddDays(-4),
            Logged(1, 10m, 5, asked: 5, type: TrainingSetType.WarmUp), Logged(2, 15m, 10), Logged(3, 15m, 10));
        var skippedWarmUp = Done(WorkoutB, LastWeek,
            Logged(1, null, null, asked: 5, type: TrainingSetType.WarmUp, completed: false), Logged(2, 16m, 10),
            Logged(3, 16m, 10));
        AssertStanding(Judge(coming, warmUpBefore, skippedWarmUp),
            LiftStandingOutcome.StepUp, Why(LiftStandingReason.EverySetDone, LastWeek), skippedWarmUp,
            [Same(1, 10m, 8m, 1m, SetStandingNote.NoWeightLogged), Up(2, 18m, 14m, 2m), Up(3, 18m, 14m, 2m)]);
    }

    [TestMethod]
    public void AWarmUpTickedWithoutRepsKeepsItsOwnAndWhenNoSetCanStepTheLiftHolds()
    {
        // Revised after the review: the coming writing's step sets are its two warm-ups (its working sets are typed
        // weights), and last week ticked both at their weights with the reps boxes left empty. Neither counts (decision
        // 22), so nothing can step and the lift holds naming the first; each carries on the weight it logged.
        var warmUps = Coming(ComingSet(1, 1m, 10m), ComingSet(2, 1m, 12.5m));
        var noReps = Done(WorkoutA, LastWeek,
            Logged(1, 10m, null, type: TrainingSetType.WarmUp), Logged(2, 12.5m, null, type: TrainingSetType.WarmUp),
            Logged(3, 20m, 10), Logged(4, 20m, 10));
        AssertStanding(Judge(warmUps, noReps),
            LiftStandingOutcome.Hold, Why(LiftStandingReason.NoRepsTyped, LastWeek, set: 1), noReps,
            [Same(1, 10m, 10m, 1m, SetStandingNote.NoRepsTyped), Same(2, 12.5m, 12.5m, 1m, SetStandingNote.NoRepsTyped)]);

        // A missing weight is named before missing reps: the second warm-up was never ticked and, with no earlier log to
        // carry on, keeps its own.
        var oneSkipped = Done(WorkoutA, LastWeek,
            Logged(1, 10m, null, type: TrainingSetType.WarmUp),
            Logged(2, null, null, type: TrainingSetType.WarmUp, completed: false),
            Logged(3, 20m, 10), Logged(4, 20m, 10));
        AssertStanding(Judge(warmUps, oneSkipped),
            LiftStandingOutcome.Hold, Why(LiftStandingReason.NoWeightLogged, LastWeek, set: 2), oneSkipped,
            [Same(1, 10m, 10m, 1m, SetStandingNote.NoRepsTyped), Kept(2, 12.5m, 1m, SetStandingNote.NoWeightLogged)]);
    }

    [TestMethod]
    public void AWarmUpTickedWithoutRepsCarriesOnTheWeightItLoggedWhileTheWorkingSetsStep()
    {
        // The warm-up step set starts at 8 kg, and last week it was ticked at 10 kg with its reps box left empty: it never
        // steps (decision 22), so it carries on the 10 kg it logged, the latest log that stood, never 10 kg plus its step
        // nor its own 8 kg, and says why, while the working sets step.
        var coming = Coming(ComingSet(1, 1m, 8m), ComingSet(2, 2m, 15m), ComingSet(3, 2m, 15m));
        var noReps = Done(WorkoutB, LastWeek,
            Logged(1, 10m, null, asked: 5, type: TrainingSetType.WarmUp), Logged(2, 15m, 10), Logged(3, 15m, 10));
        SetStanding[] sets = [Same(1, 10m, 8m, 1m, SetStandingNote.NoRepsTyped), Up(2, 17m, 15m, 2m), Up(3, 17m, 15m, 2m)];
        AssertStanding(Judge(coming, noReps),
            LiftStandingOutcome.StepUp, Why(LiftStandingReason.EverySetDone, LastWeek), noReps, sets);

        // A warm-up logged at 9 kg the week before changes nothing: last week's 10 kg is the latest log that stood.
        var before = Done(WorkoutA, TwoWeeksAgo,
            Logged(1, 9m, 5, asked: 5, type: TrainingSetType.WarmUp), Logged(2, 15m, 10), Logged(3, 15m, 10));
        AssertStanding(Judge(coming, before, noReps),
            LiftStandingOutcome.StepUp, Why(LiftStandingReason.EverySetDone, LastWeek), noReps, sets);
    }

    [TestMethod]
    public void StepSetsPastAllOfLastTimesSetsHoldAsNoMatchWithLastTimeShown()
    {
        // The coming writing's step sets are its sets 4 and 5 (sets 1 to 3 are typed weights) and last time had three
        // sets: nothing can step, so the lift holds as no match. Last time's writing was found, and the answer keeps it.
        var last = Done(WorkoutA, LastWeek, Did(15m, 10, 10, 10));

        AssertStanding(Judge(Coming(ComingSet(4, 2m, 12.5m), ComingSet(5, 2m, 10m)), last),
            LiftStandingOutcome.Hold, Why(LiftStandingReason.NoMatchLastTime, LastWeek), last,
            [Kept(4, 12.5m, 2m, SetStandingNote.NewSet), Kept(5, 10m, 2m, SetStandingNote.NewSet)]);
    }

    // ----- the unit, never done, and the limit -----

    [TestMethod]
    public void AWeightLoggedInTheOtherUnitHoldsAtTheSetsOwnWeight()
    {
        // "Same weight · logged in lb": nothing is converted, so set 2's 33 lb counts for nothing.
        var last = Done(WorkoutA, LastWeek, Logged(1, 15m, 10), Logged(2, 33m, 10, unit: Lb), Logged(3, 15m, 10));
        AssertStanding(Judge(ThreeSets(own: 12.5m), last),
            LiftStandingOutcome.Hold, Why(LiftStandingReason.LoggedInOtherUnit, LastWeek, set: 2, weight: 33m, unit: Lb), last,
            KeptAll(12.5m));

        // A warm-up logged in pounds holds too.
        var warmUp = Done(WorkoutA, LastWeek,
            Logged(1, 22m, 10, type: TrainingSetType.WarmUp, unit: Lb), Logged(2, 15m, 10), Logged(3, 15m, 10));
        AssertStanding(Judge(ThreeSets(own: 12.5m), warmUp),
            LiftStandingOutcome.Hold, Why(LiftStandingReason.LoggedInOtherUnit, LastWeek, set: 1, weight: 22m, unit: Lb), warmUp,
            KeptAll(12.5m));
    }

    [TestMethod]
    public void ALiftNeverDoneHoldsAtTheSetsOwnWeight() =>
        AssertStanding(Judge(ThreeSets(own: 12.5m)),
            LiftStandingOutcome.Hold, Why(LiftStandingReason.NeverDone), null, KeptAll(12.5m));

    [TestMethod]
    public void AStepPastTwoThousandKeepsLastTimesWeightAndHoldsWhenNoSetCanStep()
    {
        // 1,999 + 2 kg would pass the heaviest weight a set holds, so set 1 keeps 1,999 kg; 1,998 + 2 is 2,000 exactly.
        var heavy = Done(WorkoutA, LastWeek, Logged(1, 1_999m, 10), Logged(2, 1_998m, 10), Logged(3, 1_990m, 10));
        AssertStanding(Judge(Coming(ComingSet(1, 2m, 1_999m), ComingSet(2, 2m, 1_998m), ComingSet(3, 2m, 1_990m)), heavy),
            LiftStandingOutcome.StepUp, Why(LiftStandingReason.EverySetDone, LastWeek), heavy,
            [Same(1, 1_999m, 1_999m, 2m, SetStandingNote.AboveLimit), Up(2, 2_000m, 1_998m, 2m), Up(3, 1_992m, 1_990m, 2m)]);

        // No set can step: the lift holds, naming the first.
        var top = Done(WorkoutA, LastWeek, Did(1_999m, 10, 10, 10));
        AssertStanding(Judge(ThreeSets(own: 1_999m), top),
            LiftStandingOutcome.Hold, Why(LiftStandingReason.AboveLimit, LastWeek, set: 1), top,
            SameAll(1_999m, current: 1_999m, note: SetStandingNote.AboveLimit));

        // A missing weight is named before the limit, even after two sets at it.
        var topThenBlank = Done(WorkoutA, LastWeek, Logged(1, 1_999m, 10), Logged(2, 1_999m, 10), Logged(3, null, 10));
        AssertStanding(Judge(ThreeSets(own: 1_999m), topThenBlank),
            LiftStandingOutcome.Hold, Why(LiftStandingReason.NoWeightLogged, LastWeek, set: 3), topThenBlank,
            [
                Same(1, 1_999m, 1_999m, 2m, SetStandingNote.AboveLimit),
                Same(2, 1_999m, 1_999m, 2m, SetStandingNote.AboveLimit),
                Kept(3, 1_999m, 2m, SetStandingNote.NoWeightLogged),
            ]);
    }

    // ----- the order the holds are read in -----

    [TestMethod]
    public void ATypoIsNamedBeforeASetShortOfItsRepsAndEachSetKeepsItsOwn()
    {
        // Last week set 2 reached 8 of 10 and set 3 logged 150 kg after 15 kg: the typo guard is read before line (a),
        // whatever the sets' order, and a typo keeps each set's own 12.5 kg.
        var before = Done(WorkoutA, TwoWeeksAgo, Did(15m, 10, 10, 10));
        var last = Done(WorkoutB, LastWeek, Logged(1, 15m, 10), Logged(2, 15m, 8), Logged(3, 150m, 10));

        AssertStanding(Judge(ThreeSets(own: 12.5m), before, last),
            LiftStandingOutcome.Hold,
            Why(LiftStandingReason.LooksLikeTypo, LastWeek, set: 3, weight: 150m, earlier: 15m, unit: Kg), last,
            KeptAll(12.5m));
    }

    [TestMethod]
    public void AWeightInTheOtherUnitIsNamedBeforeASetShortOfItsReps()
    {
        // Set 1 reached 8 of 10 and set 3 was logged in pounds: the unit is read first, and each set keeps its own.
        var last = Done(WorkoutA, LastWeek, Logged(1, 15m, 8), Logged(2, 15m, 10), Logged(3, 33m, 10, unit: Lb));

        AssertStanding(Judge(ThreeSets(own: 12.5m), last),
            LiftStandingOutcome.Hold, Why(LiftStandingReason.LoggedInOtherUnit, LastWeek, set: 3, weight: 33m, unit: Lb), last,
            KeptAll(12.5m));
    }

    [TestMethod]
    public void ASetShortOfItsRepsIsNamedBeforeASetRatedHarder()
    {
        // Line (a) is read before line (c): set 3's 8 of 10 is named before set 1, rated RPE 9 of 8, and the hold keeps
        // last time's 15 kg over each set's own 12.5 kg.
        var last = Done(WorkoutA, LastWeek, Rated(1, 8m, 9m), Rated(2, 8m, 8m), Logged(3, 15m, 8, targetRpe: 8m, rpe: 8m));

        AssertStanding(Judge(ThreeSets(own: 12.5m), last),
            LiftStandingOutcome.Hold, Why(LiftStandingReason.RepsShort, LastWeek, set: 3, reps: 8, asked: 10), last,
            SameAll(15m, current: 12.5m));
    }

    [TestMethod]
    public void OfASetNotLoggedAndASetShortTheFirstBySetNumberIsNamed()
    {
        // Line (a) reads the working sets in order and names the first it trips on: set 2, never ticked, before set 3's
        // 8 of 10.
        var notTickedFirst = Done(WorkoutA, LastWeek,
            Logged(1, 15m, 10), Logged(2, null, null, completed: false), Logged(3, 15m, 8));
        AssertStanding(Judge(ThreeSets(own: 14m), notTickedFirst),
            LiftStandingOutcome.Hold, Why(LiftStandingReason.SetNotLogged, LastWeek, set: 2), notTickedFirst,
            [Same(1, 15m, 14m, 2m), Kept(2, 14m, 2m, SetStandingNote.NoWeightLogged), Same(3, 15m, 14m, 2m)]);

        // Set 2's 8 of 10 before set 3, never ticked.
        var shortFirst = Done(WorkoutA, LastWeek,
            Logged(1, 15m, 10), Logged(2, 15m, 8), Logged(3, null, null, completed: false));
        AssertStanding(Judge(ThreeSets(own: 14m), shortFirst),
            LiftStandingOutcome.Hold, Why(LiftStandingReason.RepsShort, LastWeek, set: 2, reps: 8, asked: 10), shortFirst,
            [Same(1, 15m, 14m, 2m), Same(2, 15m, 14m, 2m), Kept(3, 14m, 2m, SetStandingNote.NoWeightLogged)]);
    }

    // ----- which workouts, and in what order -----

    [TestMethod]
    public void AWorkoutAfterTheComingSessionsDayIsNeverLastTimeButOneEarlierThatDayIs()
    {
        // A later session done early, dated Wednesday 11 Nov, is no last time for Tuesday's coming session.
        var lastWeek = Done(WorkoutA, LastWeek, Did(15m, 10, 10, 10));
        var tomorrow = Done(WorkoutB, Today.AddDays(1), Did(30m, 10, 10, 10));
        AssertStanding(Judge(ThreeSets(), lastWeek, tomorrow),
            LiftStandingOutcome.StepUp, Why(LiftStandingReason.EverySetDone, LastWeek), lastWeek, UpAll(17m, current: 15m));
        AssertStanding(Judge(ThreeSets(), tomorrow),
            LiftStandingOutcome.Hold, Why(LiftStandingReason.NeverDone), null, KeptAll(15m));

        // A workout done earlier on the coming session's own day is last time (the chat's choice).
        var earlierToday = Done(WorkoutB, Today, Did(16m, 10, 10, 10));
        AssertStanding(Judge(ThreeSets(), lastWeek, earlierToday),
            LiftStandingOutcome.StepUp, Why(LiftStandingReason.EverySetDone, Today), earlierToday, UpAll(18m, current: 15m));
    }

    [TestMethod]
    public void OfTwoWorkoutsOnOneDayTheLaterStartIsLastTimeAndTheDayComesFirst()
    {
        // Both dated Tuesday 3 Nov: the one started at 18:00 is last time, whatever its id or its place in the list.
        var evening = Done(WorkoutA, LastWeek, Did(16m, 10, 10, 10)) with { StartedAtUtc = At(LastWeek, 18) };
        var morning = Done(WorkoutB, LastWeek, Did(15m, 10, 10, 10)) with { StartedAtUtc = At(LastWeek, 8) };
        AssertStanding(Judge(ThreeSets(), evening, morning),
            LiftStandingOutcome.StepUp, Why(LiftStandingReason.EverySetDone, LastWeek), evening, UpAll(18m, current: 15m));

        // The day comes first: Monday's session done on Thursday evening is older than Tuesday's done on Tuesday.
        var mondayDoneLate = Done(WorkoutA, LastWeek.AddDays(-1), Did(16m, 10, 10, 10)) with
        {
            StartedAtUtc = At(LastWeek.AddDays(2), 18),
        };
        var tuesday = Done(WorkoutB, LastWeek, Did(15m, 10, 10, 10));
        AssertStanding(Judge(ThreeSets(), tuesday, mondayDoneLate),
            LiftStandingOutcome.StepUp, Why(LiftStandingReason.EverySetDone, LastWeek), tuesday, UpAll(17m, current: 15m));
    }

    // ----- builders for where a lift stands -----

    private static LiftStanding Judge(ComingLift coming, params LoggedLift[] history) =>
        LastTimeStepRule.Read(coming, history, Today);

    /// <summary>The whole answer: the outcome, the reason, last time's writing, each set's answer and the day judged.</summary>
    private static void AssertStanding(
        LiftStanding actual,
        LiftStandingOutcome outcome,
        LiftStandingReasonDetail reason,
        LoggedLift? lastTime,
        SetStanding[] sets,
        string label = "")
    {
        Assert.AreEqual(outcome, actual.Outcome, $"outcome {label}");
        Assert.AreEqual(reason, actual.Reason, $"reason {label}");
        if (lastTime is null)
        {
            Assert.IsNull(actual.LastTime, $"last time {label}");
        }
        else
        {
            var read = actual.LastTime;
            Assert.IsNotNull(read, $"last time {label}");
            Assert.AreEqual((lastTime.WorkoutExecutionId, lastTime.Day), (read.WorkoutExecutionId, read.Day), $"last time {label}");
            CollectionAssert.AreEqual(
                lastTime.Sets.OrderBy(set => set.SetNumber).ToArray(), read.Sets.ToArray(), $"last time's sets {label}");
        }

        Assert.HasCount(sets.Length, actual.Sets, $"sets {label}");
        for (var index = 0; index < sets.Length; index++)
        {
            Assert.AreEqual(sets[index], actual.Sets[index], $"set {sets[index].SetNumber} {label}");
        }

        Assert.AreEqual(Today, actual.JudgedOn, $"judged on {label}");
    }

    /// <summary>The leg curl's first writing in today's session, with the given step sets.</summary>
    private static ComingLift Coming(params ComingStepSet[] sets) => new(CurlId, 1, Today, sets);

    /// <summary>The squat's given writing in today's session.</summary>
    private static ComingLift Squat(int occurrence, params ComingStepSet[] sets) => new(SquatId, occurrence, Today, sets);

    /// <summary>Sets 1 to 3, each with the same step and own weight (none when the client picks).</summary>
    private static ComingLift ThreeSets(decimal? own = 15m, decimal step = 2m) =>
        Coming(ComingSet(1, step, own), ComingSet(2, step, own), ComingSet(3, step, own));

    private static ComingStepSet ComingSet(int setNumber, decimal step, decimal? own, TrainingLoadUnit unit = Kg) =>
        new(SetId(setNumber), setNumber, step, unit, own);

    private static Guid SetId(int setNumber) => Guid.Parse($"40000000-0000-0000-0000-0000000006b{setNumber}");

    /// <summary>A finished workout's first writing of the lift, started at 09:00 UTC on its day.</summary>
    private static LoggedLift Done(Guid workout, DateOnly day, params LoggedSet[] sets) =>
        new(workout, day, WorkoutExecutionStatus.Completed, At(day, 9), 1, sets);

    /// <summary>A workout started at 09:00 UTC on its day and never finished.</summary>
    private static LoggedLift Running(Guid workout, DateOnly day, params LoggedSet[] sets) =>
        new(workout, day, WorkoutExecutionStatus.InProgress, At(day, 9), 1, sets);

    private static DateTimeOffset At(DateOnly day, int hour) => new(day.ToDateTime(new TimeOnly(hour, 0)), TimeSpan.Zero);

    /// <summary>Sets 1 on, each ticked at the weight in kg with its reps typed (null: none typed), 10 asked.</summary>
    private static LoggedSet[] Did(decimal weight, params int?[] reps) =>
        [.. reps.Select((typed, index) => Logged(index + 1, weight, typed))];

    /// <summary>A set ticked at 15 kg × 10 of 10, with the effort that workout asked and the client's rating.</summary>
    private static LoggedSet Rated(int setNumber, decimal? targetRpe, decimal? rpe) =>
        Logged(setNumber, 15m, 10, targetRpe: targetRpe, rpe: rpe);

    /// <summary>
    /// One set of a logged writing: a working set, ticked, 10 reps asked, in kg, with no weight asked (the client
    /// picked) and no effort, unless told otherwise.
    /// </summary>
    private static LoggedSet Logged(
        int setNumber,
        decimal? weight,
        int? reps,
        int? asked = 10,
        TrainingSetType type = TrainingSetType.Normal,
        bool completed = true,
        TrainingLoadUnit unit = Kg,
        decimal? prescribed = null,
        decimal? targetRpe = null,
        decimal? rpe = null) =>
        new(setNumber, type, asked, targetRpe, prescribed, prescribed is null ? null : unit, completed, reps, weight,
            weight is null ? null : unit, rpe);

    private static SetStanding Up(int setNumber, decimal weight, decimal? current, decimal step, TrainingLoadUnit unit = Kg) =>
        new(SetId(setNumber), setNumber, SetStandingMove.StepUp, weight, current, unit, step, SetStandingNote.None);

    private static SetStanding Same(
        int setNumber,
        decimal weight,
        decimal? current,
        decimal step,
        SetStandingNote note = SetStandingNote.None) =>
        new(SetId(setNumber), setNumber, SetStandingMove.SameAsLastTime, weight, current, Kg, step, note);

    private static SetStanding Kept(int setNumber, decimal? own, decimal step, SetStandingNote note = SetStandingNote.None) =>
        new(SetId(setNumber), setNumber, SetStandingMove.Unchanged, own, own, Kg, step, note);

    private static SetStanding[] UpAll(decimal weight, decimal? current, decimal step = 2m) =>
        [Up(1, weight, current, step), Up(2, weight, current, step), Up(3, weight, current, step)];

    private static SetStanding[] SameAll(
        decimal weight,
        decimal? current,
        decimal step = 2m,
        SetStandingNote note = SetStandingNote.None) =>
        [Same(1, weight, current, step, note), Same(2, weight, current, step, note), Same(3, weight, current, step, note)];

    private static SetStanding[] KeptAll(decimal? own, decimal step = 2m, SetStandingNote note = SetStandingNote.None) =>
        [Kept(1, own, step, note), Kept(2, own, step, note), Kept(3, own, step, note)];

    private static LiftStandingReasonDetail Why(
        LiftStandingReason kind,
        DateOnly? day = null,
        int? set = null,
        int? reps = null,
        int? asked = null,
        decimal? rpe = null,
        decimal? targetRpe = null,
        decimal? weight = null,
        decimal? earlier = null,
        TrainingLoadUnit? unit = null,
        Guid? workout = null) =>
        new(kind, day, set, reps, asked, rpe, targetRpe, weight, earlier, unit, workout);
}
