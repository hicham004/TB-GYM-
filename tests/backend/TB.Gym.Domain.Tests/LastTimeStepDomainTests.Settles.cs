using TB.Gym.Modules.Training;

namespace TB.Gym.Domain.Tests;

// The notes plan's N6d: Coach Today counts the weights waiting to be applied from each lift's last weeks rather than its
// whole history (audit BEB-2), and LastTimeStepRule.RecentSettles says when those weeks give the answer the whole
// history gives, so the count is the client's Training tab's. Reference cases for each way the check answers, then the
// same claim over thousands of generated histories, judged on Tuesday 10 Nov 2026 as N6b's cases are.
public sealed partial class LastTimeStepDomainTests
{
    // A property, not a field: partial files initialise their statics in no fixed order, and Today lives in another.
    private static DateOnly WindowFrom => Today.AddDays(-LastTimeStepRule.LookbackDays);

    [TestMethod]
    public void N6dARecentLogNearTheWeightItsWorkoutAskedSettlesWhateverCameBeforeIt()
    {
        // A typo three weeks ago (150 kg on a 15 kg curl) is outside the window; last week's workout asked 15 kg and the
        // client logged 15 kg, which stands whatever came before, so the window answers as the whole history does.
        var typo = Done(WorkoutA, ThreeWeeksAgo, Did(150m, 10, 10, 10));
        var lastWeek = Done(WorkoutB, LastWeek,
            Logged(1, 15m, 10, prescribed: 15m), Logged(2, 15m, 10, prescribed: 15m), Logged(3, 15m, 10, prescribed: 15m));
        LoggedLift[] whole = [typo, lastWeek];
        LoggedLift[] recent = [lastWeek];

        Assert.IsTrue(LastTimeStepRule.RecentSettles(ThreeSets(), recent, WindowFrom, Today));
        AssertSameAnswer(Judge(ThreeSets(), whole), Judge(ThreeSets(), recent));
        AssertStanding(Judge(ThreeSets(), recent),
            LiftStandingOutcome.StepUp, Why(LiftStandingReason.EverySetDone, LastWeek), lastWeek, UpAll(17m, current: 15m));
    }

    [TestMethod]
    public void N6dATypoBeforeTheWindowThatTheRecentLogsCannotSettleNeedsTheWholeHistory()
    {
        // The client's very first log was a typo (150 kg) and stood, having nothing before it; every sensible log since,
        // with no weight asked, is a typo against it (line e) until the coach types a weight. The window alone would
        // start from last week's 15 kg and step up, which is why the check says no and the reader reads it all.
        var first = Done(WorkoutA, FourWeeksAgo, Did(150m, 10, 10, 10));
        var lastWeek = Done(WorkoutB, LastWeek, Did(15m, 10, 10, 10));
        LoggedLift[] whole = [first, lastWeek];
        LoggedLift[] recent = [lastWeek];

        Assert.IsFalse(LastTimeStepRule.RecentSettles(ThreeSets(), recent, WindowFrom, Today));
        AssertStanding(Judge(ThreeSets(), whole),
            LiftStandingOutcome.Hold,
            Why(LiftStandingReason.LooksLikeTypo, LastWeek, set: 1, weight: 15m, earlier: 150m, unit: Kg),
            lastWeek, KeptAll(15m));
        Assert.AreEqual(LiftStandingOutcome.StepUp, Judge(ThreeSets(), recent).Outcome, "The window alone would step up.");
    }

    [TestMethod]
    public void N6dNoRecentWorkoutOfTheLiftSettlesSinceNothingCanApply()
    {
        // Last done three weeks ago: the whole history holds it as too long ago (line b) and the window holds it as never
        // done; neither writes a weight, so Today counts it nowhere, as the Training tab offers nothing.
        var old = Done(WorkoutA, ThreeWeeksAgo, Did(15m, 10, 10, 10));

        Assert.IsTrue(LastTimeStepRule.RecentSettles(ThreeSets(), [], WindowFrom, Today));
        Assert.IsEmpty(LastTimeStepRule.SetsToApply(Judge(ThreeSets(), old)));
        Assert.IsEmpty(LastTimeStepRule.SetsToApply(Judge(ThreeSets())));
    }

    [TestMethod]
    public void N6dEverySetTheGuardOrACarriedWeightCanReadMustBeSettled()
    {
        // Sets 1 and 2 were logged near the 15 kg their workout asked; set 3 was logged with no weight asked. Set 3's own
        // logs fold from the oldest, so one unsettled set is enough to read the whole history.
        var lastWeek = Done(WorkoutB, LastWeek,
            Logged(1, 15m, 10, prescribed: 15m), Logged(2, 15m, 10, prescribed: 15m), Logged(3, 15m, 10));
        Assert.IsFalse(LastTimeStepRule.RecentSettles(ThreeSets(), [lastWeek], WindowFrom, Today));

        // A set with no recent log at all (not logged last week) settles: anything it could carry on is older than the
        // lookback, so it keeps its own weight either way (line d).
        var skipped = Done(WorkoutB, LastWeek,
            Logged(1, 15m, 10, prescribed: 15m), Logged(2, 15m, 10, prescribed: 15m), Logged(3, null, null, completed: false));
        Assert.IsTrue(LastTimeStepRule.RecentSettles(ThreeSets(), [skipped], WindowFrom, Today));

        // A log in the other unit than the set's is no log of its chain (line e reads one unit), and a weight asked in
        // the other unit is no weight asked.
        var pounds = Done(WorkoutB, LastWeek,
            Logged(1, 15m, 10, prescribed: 15m), Logged(2, 15m, 10, prescribed: 15m),
            Logged(3, 33m, 10, unit: Lb, prescribed: 33m));
        Assert.IsTrue(LastTimeStepRule.RecentSettles(ThreeSets(), [pounds], WindowFrom, Today));
        var askedInPounds = Done(WorkoutB, LastWeek,
            Logged(1, 15m, 10, prescribed: 15m), Logged(2, 15m, 10, prescribed: 15m),
            new LoggedSet(3, TrainingSetType.Normal, 10, null, 33m, Lb, true, 10, 15m, Kg, null));
        Assert.IsFalse(LastTimeStepRule.RecentSettles(ThreeSets(), [askedInPounds], WindowFrom, Today));

        // A log far from the weight asked is no anchor: whether it stands depends on what came before it.
        var far = Done(WorkoutB, LastWeek,
            Logged(1, 30m, 10, prescribed: 15m), Logged(2, 15m, 10, prescribed: 15m), Logged(3, 15m, 10, prescribed: 15m));
        Assert.IsFalse(LastTimeStepRule.RecentSettles(ThreeSets(), [far], WindowFrom, Today));
    }

    [TestMethod]
    public void N6dOnlyTheComingWritingsOwnLogsAndFinishedWorkoutsAreFolded()
    {
        // The guard folds finished workouts of the same writing (line f) alone: a running workout's unanchored sets and
        // a back-off writing's (occurrence 2) do not need settling for the first writing.
        var anchored = Done(WorkoutA, LastWeek,
            Logged(1, 15m, 10, prescribed: 15m), Logged(2, 15m, 10, prescribed: 15m), Logged(3, 15m, 10, prescribed: 15m));
        var running = Running(WorkoutB, Today.AddDays(-1), Did(15m, 10, 10, 10));
        var backOff = Done(WorkoutA, LastWeek, Did(10m, 12, 12)) with { Occurrence = 2 };

        Assert.IsTrue(LastTimeStepRule.RecentSettles(ThreeSets(), [anchored, running, backOff], WindowFrom, Today));
        Assert.IsFalse(LastTimeStepRule.RecentSettles(
            Squat(2, ComingSet(1, 2m, 10m), ComingSet(2, 2m, 10m)), [anchored, backOff], WindowFrom, Today),
            "For the back-off writing, its own unanchored logs need the whole history.");
    }

    [TestMethod]
    public void N6dOutsideItsTermsTheCheckSendsTheReaderToTheWholeHistory()
    {
        var anchored = Done(WorkoutB, LastWeek,
            Logged(1, 15m, 10, prescribed: 15m), Logged(2, 15m, 10, prescribed: 15m), Logged(3, 15m, 10, prescribed: 15m));

        // A window shorter than the lookback could miss last time or a weight carried on.
        Assert.IsFalse(LastTimeStepRule.RecentSettles(ThreeSets(), [anchored], WindowFrom.AddDays(1), Today));
        Assert.IsTrue(LastTimeStepRule.RecentSettles(ThreeSets(), [anchored], WindowFrom.AddDays(-30), Today));

        // A writing older than the window says the caller's window is not what it claims.
        var older = Done(WorkoutA, WindowFrom.AddDays(-1), Did(15m, 10, 10, 10));
        Assert.IsFalse(LastTimeStepRule.RecentSettles(ThreeSets(), [older, anchored], WindowFrom, Today));
    }

    [TestMethod]
    public void N6dTheLastWeeksAnswerAsTheWholeHistoryWheneverTheySettleIt()
    {
        // Thousands of generated histories (fixed draws, so every run reads the same): typos, missed and short sets,
        // warm-ups, running workouts, two writings, pounds, weights asked or not, near or far, over the last 70 days. The
        // window starts at the lookback or earlier. Wherever the check settles it, the window's answer is the whole
        // history's, set for set; where it does not, the reader reads the whole history.
        var draws = new Draws(20261110);
        var settled = 0;
        var needed = 0;
        for (var index = 0; index < 4000; index++)
        {
            var coming = DrawComing(draws);
            var whole = DrawHistory(draws);
            var from = WindowFrom.AddDays(-draws.Next(21));
            var recent = whole.Where(item => item.Day >= from).ToArray();
            var fromWhole = LastTimeStepRule.Read(coming, whole, Today);
            var fromRecent = LastTimeStepRule.Read(coming, recent, Today);
            if (!LastTimeStepRule.RecentSettles(coming, recent, from, Today))
            {
                // Counted where the window alone would write another weight or say another outcome: the check is needed.
                if (AppliedText(fromWhole) != AppliedText(fromRecent) || fromWhole.Outcome != fromRecent.Outcome)
                {
                    needed++;
                }

                continue;
            }

            settled++;
            var label = $"case {index}";
            Assert.AreEqual(AppliedText(fromWhole), AppliedText(fromRecent), $"what applying writes, {label}");
            Assert.AreEqual(fromWhole.Outcome, fromRecent.Outcome, $"the outcome, {label}");
            if (recent.Any(item => item.Day <= coming.SessionDate))
            {
                Assert.AreEqual(Canonical(fromWhole), Canonical(fromRecent), $"the whole answer, {label}");
            }
        }

        // The claim bites: many histories settle, many do not, and among those that do not, many windows would apply
        // another weight or say another outcome than the whole history.
        Assert.IsGreaterThan(1000, settled, $"settled {settled}");
        Assert.IsLessThan(3600, settled, $"settled {settled}");
        Assert.IsGreaterThan(50, needed, $"needed {needed}");
    }

    [TestMethod]
    public void N6dAnAnswerThatEndsBeforeTheGuardSettlesAndOnlyTheSetsItReadsCount()
    {
        // Nothing asked anywhere, so no recent log anchors; but a workout still running ends the answer (line g) before
        // any set's logs are folded, and so does last time logged in another unit: the window settles both.
        var unanchored = Done(WorkoutA, LastWeek, Did(15m, 10, 10, 10));
        var running = Running(WorkoutB, Today.AddDays(-1), Did(15m, 10, 10, 10));
        Assert.IsTrue(LastTimeStepRule.RecentSettles(ThreeSets(), [unanchored, running], WindowFrom, Today));
        Assert.AreEqual(LiftStandingReason.WorkoutInProgress, Judge(ThreeSets(), unanchored, running).Reason.Kind);
        var pounds = Done(WorkoutB, Today.AddDays(-1),
            Logged(1, 33m, 10, unit: Lb), Logged(2, 33m, 10, unit: Lb), Logged(3, 33m, 10, unit: Lb));
        Assert.IsTrue(LastTimeStepRule.RecentSettles(ThreeSets(), [unanchored, pounds], WindowFrom, Today));
        Assert.AreEqual(LiftStandingReason.LoggedInOtherUnit, Judge(ThreeSets(), unanchored, pounds).Reason.Kind);

        // Set 4 was logged, unanchored, two weeks ago and is neither in last time's workout nor coming: the guard never
        // folds it, so it needs no settling, while last time's three anchored sets do the rest.
        var fourSets = Done(WorkoutA, TwoWeeksAgo, Did(15m, 10, 10, 10, 10));
        var anchored = Done(WorkoutB, LastWeek,
            Logged(1, 15m, 10, prescribed: 15m), Logged(2, 15m, 10, prescribed: 15m), Logged(3, 15m, 10, prescribed: 15m));
        Assert.IsTrue(LastTimeStepRule.RecentSettles(ThreeSets(), [fourSets, anchored], WindowFrom, Today));
    }

    private static void AssertSameAnswer(LiftStanding whole, LiftStanding recent) =>
        Assert.AreEqual(Canonical(whole), Canonical(recent));

    /// <summary>What applying the answer writes, set by set (STR-020).</summary>
    private static string AppliedText(LiftStanding standing) =>
        string.Join("; ", LastTimeStepRule.SetsToApply(standing).Select(set => $"{set.SetNumber} {set.Move} {set.Weight}"));

    /// <summary>The whole answer as text: outcome, reason, last time and every set.</summary>
    private static string Canonical(LiftStanding standing) =>
        $"{standing.Outcome} | {standing.Reason} | {standing.LastTime?.WorkoutExecutionId} {standing.LastTime?.Day} | " +
        string.Join("; ", standing.Sets.Select(set => set.ToString()));

    private static ComingLift DrawComing(Draws draws)
    {
        var count = 1 + draws.Next(4);
        decimal[] steps = [1m, 2m, 2.5m, 5m];
        decimal?[] owns = [null, null, 10m, 15m, 20m, 25m];
        var unit = draws.Next(10) == 0 ? Lb : Kg;
        var step = steps[draws.Next(steps.Length)];
        var own = owns[draws.Next(owns.Length)];
        return new ComingLift(CurlId, draws.Next(5) == 0 ? 2 : 1, Today, [.. Enumerable.Range(1, count)
            .Select(number => new ComingStepSet(SetId(number), number, step, unit, own))]);
    }

    private static LoggedLift[] DrawHistory(Draws draws)
    {
        var count = draws.Next(9);
        var weight = 10m + (draws.Next(6) * 5m);
        return [.. Enumerable.Range(0, count)
            .Select(index =>
            {
                var day = Today.AddDays(-draws.Next(71));
                weight += draws.Next(3) == 0 ? 2.5m : 0m;
                var workout = Guid.Parse($"60000000-0000-0000-0000-{index + 1:D12}");
                var status = draws.Next(8) == 0 ? WorkoutExecutionStatus.InProgress : WorkoutExecutionStatus.Completed;
                var sets = Enumerable.Range(1, 1 + draws.Next(5)).Select(number => DrawSet(draws, number, weight)).ToArray();
                return new LoggedLift(workout, day, status, At(day, 6 + draws.Next(12)), draws.Next(5) == 0 ? 2 : 1, sets);
            })];
    }

    private static LoggedSet DrawSet(Draws draws, int number, decimal weight)
    {
        var completed = draws.Next(8) != 0;
        var unit = draws.Next(15) == 0 ? Lb : Kg;
        decimal? logged = draws.Next(25) switch
        {
            0 => null,
            1 => weight * 10m,
            2 => weight / 10m,
            3 => 0m,
            _ => weight + (draws.Next(3) * 2.5m) - 2.5m,
        };
        decimal? asked = draws.Next(5) switch
        {
            0 or 1 => null,
            2 => weight * 2m,
            _ => weight,
        };
        var askedUnit = asked is null ? (TrainingLoadUnit?)null : draws.Next(12) == 0 ? (unit == Kg ? Lb : Kg) : unit;
        var reps = draws.Next(10) switch
        {
            0 => (int?)null,
            1 => 8,
            _ => 10 + draws.Next(3),
        };
        decimal?[] targets = [null, 7m, 8m];
        decimal?[] ratings = [null, 7m, 8m, 9m];
        return new LoggedSet(
            number,
            draws.Next(10) == 0 ? TrainingSetType.WarmUp : TrainingSetType.Normal,
            10,
            targets[draws.Next(targets.Length)],
            asked,
            askedUnit,
            completed,
            reps,
            logged,
            logged is null ? null : unit,
            ratings[draws.Next(ratings.Length)]);
    }

    /// <summary>A fixed sequence of draws (xorshift), so the generated histories are the same on every run.</summary>
    private sealed class Draws(uint seed)
    {
        private uint state = seed;

        public int Next(int below)
        {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            return (int)(state % (uint)below);
        }
    }
}
