using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Training;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The notes plan's N6c (decision 21, 5 Nov 2026; STR-020): the coach applies where a lift stands. An apply names, lift by
/// lift, the sets its "Last time + step" answer moves and the weights the coach's read gave them; the rule judges the lift
/// again and writes only when it still says exactly that, as each set's own weight named by <c>LastTimeStep</c> v1, with
/// one append-only record per lift, and the program's version moves on. A retry answers with the first apply, a reused key
/// for another request is refused, two applies racing for one lift let one win, and only the client's own coach applies:
/// never while the training read is closed, for a released client, or in a workspace with an unpaid bill. The client is
/// told why on a workout still to do or running, while every set still holds what was applied. Each test that steps whole
/// days starts at midday in the workspace's zone, so each step lands on the next calendar day.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string N6cStandingChanged =
        "Where this lift stands changed since it was read. Read it again, then apply.";

    private const string N6cProgramChanged = "Training data was changed by another request.";

    private const string N6cWeightWords = "A weight is more than 0 and at most 2,000, to three decimals.";

    private const string N6cRevertRefusal =
        "Some weights were applied from Last time + step; roll forward instead of reverting this migration.";

    private const string N6cTableSql =
        """
        SELECT count(*) FROM information_schema.tables
        WHERE table_schema = 'training' AND table_name = 'LiftWeightApplications'
        """;

    private const string N6cTriggerSql =
        """SELECT count(*) FROM pg_trigger WHERE tgname = 'TR_LiftWeightApplications_AppendOnly'""";

    private const string N6cKeyIndexSql =
        """
        SELECT count(*) FROM pg_indexes
        WHERE schemaname = 'training' AND indexname = 'IX_LiftWeightApplications_OnePerKeyAndLift'
        """;

    [TestMethod]
    public async Task N6cApplyingAStepGivesEachSetItsNewWeightKeepsARecordAndTellsTheClientWhyUntilTheWorkoutIsDone()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        using var client = CreateClient();
        var (scenario, block) = await N6cStartAsync(coach, client, "n6c-step", 3);
        var squat = scenario.Exercise.Id;

        // Every set reached its 10 at 20 kg: week 2's session steps each set to 22 kg.
        var workout = await N6bTrainTodayAsync(client, true, new N6bLog(10, 20m), new N6bLog(10, 20m));
        var week2 = N6bSession(block, 2);
        var sets = N6bSets(week2);
        var standing = N6bAnswer(await N6bStandingsAsync(coach, scenario.ClientId, [block.Id], workout), squat);
        N6bAssertComing(standing, block.Id, week2, today.AddDays(7));
        N6bAssertAnswer(
            standing,
            LiftStandingOutcome.StepUp,
            N6bReason(LiftStandingReason.EverySetDone, today),
            today,
            N6bSet(sets[0].Id, 1, SetStandingMove.StepUp, 22m, 20m, 2m),
            N6bSet(sets[1].Id, 2, SetStandingMove.StepUp, 22m, 20m, 2m));
        var before = await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id));

        // The coach applies what the read says; the answer names the session and each set's weight before and after.
        var key = Guid.NewGuid();
        var applied = await N6cApplyOkAsync(coach, scenario.ClientId, N6cRequestFor(standing, key));
        Assert.AreEqual(scenario.ClientId, applied.ClientProfileId);
        var lift = applied.Lifts.Single();
        N6cAssertApplied(
            lift,
            block.Id,
            week2,
            today.AddDays(7),
            N6cSet(sets[0].Id, 1, SetStandingMove.StepUp, 20m, 22m),
            N6cSet(sets[1].Id, 2, SetStandingMove.StepUp, 20m, 22m));
        Assert.AreEqual(RequiredTestClock.UtcNow, lift.AppliedAtUtc);

        // Week 2's sets hold 22 kg as their own weight, unrounded and from no max, named by the rule with why; weeks 1 and 3
        // keep their starting weight, and the program's version moved on.
        var after = await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id));
        Assert.AreNotEqual(before.Version, after.Version);
        var words = N6cSteppedWords(20m, today);
        foreach (var set in N6bSets(N6bSession(after, 2)))
        {
            N6cAssertAppliedSet(set, 22m, words);
        }

        foreach (var set in N6bSets(N6bSession(after, 1)).Concat(N6bSets(N6bSession(after, 3))))
        {
            N6aAssertStepSet(set, 2m, 20m);
        }

        // Where the lift stands now names the weight each set already holds: nothing is left to apply.
        N6bAssertAnswer(
            N6bAnswer(await N6bStandingsAsync(coach, scenario.ClientId, [block.Id], workout), squat),
            LiftStandingOutcome.StepUp,
            N6bReason(LiftStandingReason.EverySetDone, today),
            today,
            N6bSet(sets[0].Id, 1, SetStandingMove.StepUp, 22m, 22m, 2m),
            N6bSet(sets[1].Id, 2, SetStandingMove.StepUp, 22m, 22m, 2m));

        // One record: the rule and its version, what it read as last time, who applied it, and each set it wrote.
        Assert.AreEqual(1L, await N6cRowsAsync(scenario.ClientId));
        var ownerId = (await TeamMembersAsync(coach)).Single(member => member.Email == "n6c-step@example.test").UserId;
        var record = await N6cRecordAsync(lift.ApplicationId);
        Assert.AreEqual(
            (scenario.ClientId, block.Id, week2.Id, week2.Name, standing.ExercisePrescriptionId, squat, 1),
            (record.GetProperty("ClientProfileId").GetGuid(),
                record.GetProperty("MesocycleId").GetGuid(),
                record.GetProperty("TrainingSessionId").GetGuid(),
                record.GetProperty("SessionName").GetString(),
                record.GetProperty("ExercisePrescriptionId").GetGuid(),
                record.GetProperty("ExerciseId").GetGuid(),
                record.GetProperty("Occurrence").GetInt32()));
        Assert.AreEqual(
            ("LastTimeStep", 1, "StepUp", "EverySetDone", 2, key, ownerId),
            (record.GetProperty("RuleKey").GetString(),
                record.GetProperty("RuleVersion").GetInt32(),
                record.GetProperty("Outcome").GetString(),
                record.GetProperty("ReasonKind").GetString(),
                record.GetProperty("SetCount").GetInt32(),
                record.GetProperty("IdempotencyKey").GetGuid(),
                record.GetProperty("CreatedByUserId").GetGuid()));
        Assert.AreEqual(
            (workout, today, today, today.AddDays(7)),
            (record.GetProperty("LastTimeWorkoutExecutionId").GetGuid(),
                N6cDay(record, "LastTimeDay"),
                N6cDay(record, "JudgedOn"),
                N6cDay(record, "SessionDate")));
        CollectionAssert.AreEqual(
            lift.Sets.Select(set => (set.SetPrescriptionId, set.WeightBefore, set.WeightAfter)).ToArray(),
            record.GetProperty("AppliedSetsJson").EnumerateArray()
                .Select(set => (
                    set.GetProperty("setPrescriptionId").GetGuid(),
                    (decimal?)set.GetProperty("weightBefore").GetDecimal(),
                    set.GetProperty("weightAfter").GetDecimal()))
                .ToArray());
        Assert.AreEqual(
            workout,
            record.GetProperty("StandingJson").GetProperty("standing").GetProperty("lastTime").GetProperty("workoutExecutionId").GetGuid());

        // A week on, the client's today shows 22 kg and why: each set went up by its 2 kg step after 2 working sets of 10.
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        var planned = await N6cTodaysLiftAsync(client);
        CollectionAssert.AreEqual(new decimal?[] { 22m, 22m }, N6cWeights(planned));
        N6cAssertNote(planned.WeightNote, SetStandingMove.StepUp, today, null, 2m, 2m);

        // Started and logged, the running workout keeps the line, and none of the client's reads says where the lift stands.
        var running = await N6bTrainTodayAsync(client, false, new N6bLog(10, 22m), new N6bLog(10, 22m));
        var inProgress = (await ReadSliceAsync<ClientTrainingDayResult>(client, "/api/training/me/today")).Workouts.Single();
        Assert.AreEqual(
            ((Guid?)running, (WorkoutExecutionStatus?)WorkoutExecutionStatus.InProgress),
            (inProgress.WorkoutExecutionId, inProgress.Status));
        CollectionAssert.AreEqual(new decimal?[] { 22m, 22m }, N6cWeights(inProgress.Exercises.Single()));
        N6cAssertNote(inProgress.Exercises.Single().WeightNote, SetStandingMove.StepUp, today, null, 2m, 2m);
        await N6bAssertClientReadsCarryNoStandingAsync(client);

        // Finished, the workout says nothing more of why.
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync(
                $"/api/training/me/workouts/{running}/complete", new { version = inProgress.ExecutionVersion }),
            HttpStatusCode.OK);
        var finished = (await ReadSliceAsync<ClientTrainingDayResult>(client, "/api/training/me/today")).Workouts.Single();
        Assert.AreEqual((WorkoutExecutionStatus?)WorkoutExecutionStatus.Completed, finished.Status);
        Assert.IsNull(finished.Exercises.Single().WeightNote, "A finished workout says nothing of why its weight was set.");
    }

    [TestMethod]
    public async Task N6cAHoldAppliedToANewProgramCarriesLastTimesWeightOnAndTellsTheClientWhyItWasKept()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        using var client = CreateClient();
        // One week of the lift from 20 kg, then a program from next week that starts it again from 20 kg.
        var scenario = await P2CustomStartAsync(coach, client, "n6c-carry", N6cWeeks(1));
        var squat = scenario.Exercise.Id;
        var nextProgram = await PublishProgramAsync(coach, N6aProgram("n6c carry next", N6cWeeks(1)(squat)));
        var first = await P2AssignAsync(coach, scenario, []);
        var next = await N6bAssignAsync(coach, scenario, nextProgram, today.AddDays(7));
        var session = N6bSession(next, 1);
        var sets = N6bSets(session);

        // 25 kg for 10, then 25 kg for 8 of 10: the lift holds, and the next program's sets carry 25 kg on (line d).
        var workout = await N6bTrainTodayAsync(client, true, new N6bLog(10, 25m), new N6bLog(8, 25m));
        var held = N6bAnswer(await N6bStandingsAsync(coach, scenario.ClientId, [first.Id, next.Id], workout), squat);
        var reason = N6bReason(LiftStandingReason.RepsShort, today, set: 2, reps: 8, asked: 10);
        N6bAssertComing(held, next.Id, session, today.AddDays(7));
        N6bAssertAnswer(
            held,
            LiftStandingOutcome.Hold,
            reason,
            today,
            N6bSet(sets[0].Id, 1, SetStandingMove.SameAsLastTime, 25m, 20m, 2m),
            N6bSet(sets[1].Id, 2, SetStandingMove.SameAsLastTime, 25m, 20m, 2m));

        // Applied, the new program's sets hold 25 kg, kept from last time.
        var applied = (await N6cApplyOkAsync(coach, scenario.ClientId, N6cRequestFor(held))).Lifts.Single();
        N6cAssertApplied(
            applied,
            next.Id,
            session,
            today.AddDays(7),
            N6cSet(sets[0].Id, 1, SetStandingMove.SameAsLastTime, 20m, 25m),
            N6cSet(sets[1].Id, 2, SetStandingMove.SameAsLastTime, 20m, 25m));
        var words = N6cKeptWords(25m, today);
        foreach (var set in N6bSets(N6bSession(await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(next.Id)), 1)))
        {
            N6cAssertAppliedSet(set, 25m, words);
        }

        var record = await N6cRecordAsync(applied.ApplicationId);
        Assert.AreEqual(
            (next.Id, "Hold", "RepsShort", workout),
            (record.GetProperty("MesocycleId").GetGuid(),
                record.GetProperty("Outcome").GetString(),
                record.GetProperty("ReasonKind").GetString(),
                record.GetProperty("LastTimeWorkoutExecutionId").GetGuid()));

        // On the new program's day the client reads 25 kg and why it was kept: set 2 reached 8 of its 10.
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        var planned = await N6cTodaysLiftAsync(client);
        CollectionAssert.AreEqual(new decimal?[] { 25m, 25m }, N6cWeights(planned));
        N6cAssertNote(planned.WeightNote, SetStandingMove.SameAsLastTime, today, reason);

        // Left unfinished, it is offered again the next day with the same line, and nothing says where the lift stands.
        var running = await N6bTrainTodayAsync(client, false, new N6bLog(10, 25m), new N6bLog(10, 25m));
        RequiredTestClock.Advance(TimeSpan.FromDays(1));
        var unfinished = (await ReadSliceAsync<ClientTrainingUpcomingView>(client, "/api/training/me/upcoming"))
            .UnfinishedWorkouts.Single().Workout;
        Assert.AreEqual((Guid?)running, unfinished.WorkoutExecutionId);
        N6cAssertNote(unfinished.Exercises.Single().WeightNote, SetStandingMove.SameAsLastTime, today, reason);
        await N6bAssertClientReadsCarryNoStandingAsync(client);
    }

    [TestMethod]
    public async Task N6cAnApplyThatIsNotWhatTheLiftStandsAtOrIsBadlyShapedIsRefusedAndWritesNothing()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        using var client = CreateClient();
        var (scenario, block) = await N6cStartAsync(coach, client, "n6c-refused", 3);
        var squat = scenario.Exercise.Id;
        var clientId = scenario.ClientId;

        // Never done, the answer keeps each set's own weight, so it applies nothing: a set named is refused, even one sent at
        // the weight it has.
        var never = N6bAnswer(await N6bStandingsAsync(coach, clientId, [block.Id]), squat);
        Assert.AreEqual(LiftStandingReason.NeverDone, never.Standing.Reason.Kind);
        var week1 = N6bSets(N6bSession(block, 1));
        var nothing = await N6cApplyAsync(
            coach, clientId, N6cRequestOf(never.ExercisePrescriptionId, new SetWeightRequest(week1[0].Id, 20m, 22m)));
        Assert.AreEqual(("lift_standing_changed", N6cStandingChanged), await A7ConflictAsync(nothing));
        await N6cAssertConflictAsync(
            await N6cApplyAsync(
                coach, clientId, N6cRequestOf(never.ExercisePrescriptionId, new SetWeightRequest(week1[0].Id, 20m, 20m))),
            "lift_standing_changed",
            "A set sent at its own weight");

        // Every set done: week 2 steps each set from 20 kg to 22 kg.
        var workout = await N6bTrainTodayAsync(client, true, new N6bLog(10, 20m), new N6bLog(10, 20m));
        var standing = N6bAnswer(await N6bStandingsAsync(coach, clientId, [block.Id], workout), squat);
        var lift = standing.ExercisePrescriptionId;
        var sets = N6bSets(N6bSession(block, 2));
        var one = new SetWeightRequest(sets[0].Id, 20m, 22m);
        var two = new SetWeightRequest(sets[1].Id, 20m, 22m);
        var week3 = N6bSession(block, 3);
        var week3Sets = N6bSets(week3);
        var version = (await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id))).Version;

        // Anything but exactly what the answer moves, from and to the weights it names, is refused.
        (string Because, ApplyLiftWeightsRequest Request)[] stale =
        [
            ("Another weight than the answer's", N6cRequestOf(lift, one with { Weight = 23m }, two)),
            ("A weight the set does not have", N6cRequestOf(lift, one with { CurrentWeight = 19m }, two)),
            ("No weight for a set that has one", N6cRequestOf(lift, one with { CurrentWeight = null }, two)),
            ("Only one of the two sets", N6cRequestOf(lift, one)),
            ("A set of week 3 under week 2's lift", N6cRequestOf(lift, one, new SetWeightRequest(week3Sets[1].Id, 20m, 22m))),
            ("Week 3's lift, which is not the coming one", N6cRequestOf(
                week3.Exercises.Single().Id,
                new SetWeightRequest(week3Sets[0].Id, 20m, 22m),
                new SetWeightRequest(week3Sets[1].Id, 20m, 22m))),
            ("A lift of no program", N6cRequestOf(Guid.NewGuid(), one, two)),
        ];
        foreach (var (because, request) in stale)
        {
            await N6cAssertConflictAsync(await N6cApplyAsync(coach, clientId, request), "lift_standing_changed", because);
        }

        // A badly shaped request is refused before anything is read.
        (string Because, string Field, string Words, ApplyLiftWeightsRequest Request)[] shapes =
        [
            ("No key", "idempotencyKey", "A non-empty idempotency key is required.",
                N6cRequestOf(lift, one, two) with { IdempotencyKey = Guid.Empty }),
            ("No lift", "lifts", "Name at least one lift to apply.", new ApplyLiftWeightsRequest([], Guid.NewGuid())),
            ("More than 100 lifts", "lifts", "Apply at most 100 lifts at once.", new ApplyLiftWeightsRequest(
                [.. Enumerable.Range(0, 101).Select(_ => new LiftWeightRequest(Guid.NewGuid(), [one]))], Guid.NewGuid())),
            ("A lift named twice", "lifts", "Name each lift once.",
                new ApplyLiftWeightsRequest([new(lift, [one, two]), new(lift, [one, two])], Guid.NewGuid())),
            ("A lift without sets", "lifts", "Name the sets to apply for each lift, 20 at most.", N6cRequestOf(lift)),
            ("More than 20 sets", "lifts", "Name the sets to apply for each lift, 20 at most.", N6cRequestOf(
                lift, [.. Enumerable.Range(0, 21).Select(_ => new SetWeightRequest(Guid.NewGuid(), 20m, 22m))])),
            ("A set named twice", "lifts", "Name each set once.", N6cRequestOf(lift, one, one)),
            ("A weight of 0", "lifts", N6cWeightWords, N6cRequestOf(lift, one with { Weight = 0m }, two)),
            ("A weight past 2,000", "lifts", N6cWeightWords, N6cRequestOf(lift, one with { Weight = 2000.5m }, two)),
            ("A weight to four decimals", "lifts", N6cWeightWords, N6cRequestOf(lift, one with { Weight = 22.0001m }, two)),
            ("A current weight of 0", "lifts", N6cWeightWords, N6cRequestOf(lift, one with { CurrentWeight = 0m }, two)),
        ];
        foreach (var (because, field, words, request) in shapes)
        {
            await N6cAssertInvalidAsync(await N6cApplyAsync(coach, clientId, request), field, words, because);
        }

        // None of them wrote anything.
        Assert.AreEqual(0L, await N6cRowsAsync(clientId));
        var untouched = await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id));
        Assert.AreEqual(version, untouched.Version);
        foreach (var set in P2Sets(untouched))
        {
            N6aAssertStepSet(set, 2m, 20m);
        }

        // The coach moves week 2's first set to 21 kg with Edit weeks: the request read before it is refused, and the weights
        // stay as the edit left them.
        var grid = P3bGrid(untouched, today);
        grid[1] = P3bEditFirstSet(grid[1], set => set with { DirectLoad = 21m });
        var edited = await P3bApplyOkAsync(coach, untouched, grid, (await P3bPreviewOkAsync(coach, untouched, grid)).PreviewHash);
        await N6cAssertConflictAsync(
            await N6cApplyAsync(coach, clientId, N6cRequestOf(lift, one, two)),
            "lift_standing_changed",
            "A request read before Edit weeks");
        Assert.AreEqual(0L, await N6cRowsAsync(clientId));
        var editedSets = N6bSets(N6bSession(await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id)), 2));
        N6aAssertStepSet(editedSets[0], 2m, 21m);
        N6aAssertStepSet(editedSets[1], 2m, 20m);
        N6bAssertAnswer(
            N6bAnswer(await N6bStandingsAsync(coach, clientId, [block.Id], workout), squat),
            LiftStandingOutcome.StepUp,
            N6bReason(LiftStandingReason.EverySetDone, today),
            today,
            N6bSet(N6bSets(N6bSession(edited, 2))[0].Id, 1, SetStandingMove.StepUp, 22m, 21m, 2m),
            N6bSet(N6bSets(N6bSession(edited, 2))[1].Id, 2, SetStandingMove.StepUp, 22m, 20m, 2m));
    }

    [TestMethod]
    public async Task N6cARetryAnswersWithTheFirstApplyAndAReusedKeyForAnotherRequestConflicts()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        using var client = CreateClient();
        var (scenario, block) = await N6cStartAsync(coach, client, "n6c-retry", 3);
        var workout = await N6bTrainTodayAsync(client, true, new N6bLog(10, 20m), new N6bLog(10, 20m));
        var standing = N6bAnswer(
            await N6bStandingsAsync(coach, scenario.ClientId, [block.Id], workout), scenario.Exercise.Id);
        var request = N6cRequestFor(standing, Guid.NewGuid());
        var first = await N6cApplyOkAsync(coach, scenario.ClientId, request);
        var lift = first.Lifts.Single();
        var version = (await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id))).Version;
        var moving = request.Lifts[0].Sets;

        // Minutes later the same request again: where the lift stands has moved on, yet each retry answers with the first
        // apply as it was made, and writes nothing. The same sets in another order, or the same weights written another way,
        // are the same request.
        RequiredTestClock.Advance(TimeSpan.FromMinutes(5));
        (string Because, ApplyLiftWeightsRequest Request)[] retries =
        [
            ("The same request", request),
            ("The same sets in another order", request with
            {
                Lifts = [new(standing.ExercisePrescriptionId, [.. Enumerable.Reverse(moving)])],
            }),
            ("The same weights written another way", request with
            {
                Lifts = [new(standing.ExercisePrescriptionId, [.. moving.Select(set => set with { CurrentWeight = 20.0m, Weight = 22.00m })])],
            }),
        ];
        foreach (var (because, retry) in retries)
        {
            var again = await N6cApplyOkAsync(coach, scenario.ClientId, retry);
            var replayed = again.Lifts.Single();
            Assert.AreEqual(
                (first.ClientProfileId, lift.ApplicationId, lift.AppliedAtUtc, lift.MesocycleId, lift.SessionId, lift.ExercisePrescriptionId),
                (again.ClientProfileId, replayed.ApplicationId, replayed.AppliedAtUtc, replayed.MesocycleId, replayed.SessionId, replayed.ExercisePrescriptionId),
                because);
            CollectionAssert.AreEqual(lift.Sets.ToArray(), replayed.Sets.ToArray(), because);
        }

        Assert.AreEqual(1L, await N6cRowsAsync(scenario.ClientId));
        Assert.AreEqual(version, (await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id))).Version);

        // The key is bound to its request: another weight, a set fewer, or the same request for another client conflicts.
        (string Because, ApplyLiftWeightsRequest Request)[] others =
        [
            ("Another weight", request with
            {
                Lifts = [new(standing.ExercisePrescriptionId, [moving[0] with { Weight = 24m }, moving[1]])],
            }),
            ("A set fewer", request with { Lifts = [new(standing.ExercisePrescriptionId, [moving[0]])] }),
        ];
        foreach (var (because, other) in others)
        {
            await N6cAssertConflictAsync(await N6cApplyAsync(coach, scenario.ClientId, other), "idempotency_conflict", because);
        }

        using var otherClient = CreateClient();
        var otherId = await InviteAndAcceptAsync(coach, otherClient, "n6c-retry-other@example.test", newAccount: true);
        await CreateTrainingEnrollmentAsync(coach, otherId, today, 8);
        await N6cAssertConflictAsync(
            await N6cApplyAsync(coach, otherId, request), "idempotency_conflict", "The same request for another client");
        Assert.AreEqual((1L, 0L), (await N6cRowsAsync(scenario.ClientId), await N6cRowsAsync(otherId)));
    }

    [TestMethod]
    public async Task N6cTwoAppliesRacingForOneLiftLetExactlyOneWinAndTheSameKeyRacesAgainstItself()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        using var client = CreateClient();
        var (scenario, block) = await N6cStartAsync(coach, client, "n6c-race", 3);
        var squat = scenario.Exercise.Id;
        var first = await N6bTrainTodayAsync(client, true, new N6bLog(10, 20m), new N6bLog(10, 20m));
        var request = N6cRequestFor(N6bAnswer(await N6bStandingsAsync(coach, scenario.ClientId, [block.Id], first), squat));

        // Two applies of week 2 under different keys, each held at its write once it has read the lift and the program: the
        // database lets one win, and the other is told the program moved on.
        var answers = await N6cRaceAsync(
            coach,
            scenario.ClientId,
            request with { IdempotencyKey = Guid.NewGuid() },
            request with { IdempotencyKey = Guid.NewGuid() });
        var won = answers.Where(answer => answer.StatusCode == HttpStatusCode.OK).ToArray();
        Assert.HasCount(1, won, await N6cBodiesAsync(answers));
        var (code, _) = await A7ConflictAsync(answers.Single(answer => answer.StatusCode != HttpStatusCode.OK));
        Assert.IsTrue(code is "concurrency_conflict" or "lift_standing_changed", code);
        var winner = (await ReadSlicePayloadAsync<LiftWeightsAppliedView>(won[0])).Lifts.Single();
        Assert.AreEqual(1L, await N6cRowsAsync(scenario.ClientId));
        Assert.AreEqual(
            1L,
            await P2CountAsync("""SELECT count(*) FROM training."LiftWeightApplications" WHERE "Id" = @id""", winner.ApplicationId));
        var words = N6cSteppedWords(20m, today);
        foreach (var set in N6bSets(N6bSession(await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id)), 2)))
        {
            N6cAssertAppliedSet(set, 22m, words);
        }

        // A week on, week 2 is done at 22 kg, so week 3 steps to 24 kg. One request sent twice at once with one key: both are
        // answered with the one apply, made once.
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        var second = await N6bTrainTodayAsync(client, true, new N6bLog(10, 22m), new N6bLog(10, 22m));
        var week3 = N6bSets(N6bSession(block, 3));
        var standing = N6bAnswer(await N6bStandingsAsync(coach, scenario.ClientId, [block.Id], first, second), squat);
        N6bAssertAnswer(
            standing,
            LiftStandingOutcome.StepUp,
            N6bReason(LiftStandingReason.EverySetDone, today.AddDays(7)),
            today.AddDays(7),
            N6bSet(week3[0].Id, 1, SetStandingMove.StepUp, 24m, 20m, 2m),
            N6bSet(week3[1].Id, 2, SetStandingMove.StepUp, 24m, 20m, 2m));
        var twin = N6cRequestFor(standing, Guid.NewGuid());
        var twins = await N6cRaceAsync(coach, scenario.ClientId, twin, twin);
        foreach (var answer in twins)
        {
            await AssertStatusAsync(answer, HttpStatusCode.OK);
        }

        var views = await Task.WhenAll(twins.Select(ReadSlicePayloadAsync<LiftWeightsAppliedView>));
        var made = views[0].Lifts.Single();
        var replayed = views[1].Lifts.Single();
        Assert.AreEqual((made.ApplicationId, made.AppliedAtUtc), (replayed.ApplicationId, replayed.AppliedAtUtc));
        CollectionAssert.AreEqual(made.Sets.ToArray(), replayed.Sets.ToArray());
        Assert.AreEqual(
            1L,
            await P2CountAsync(
                """SELECT count(*) FROM training."LiftWeightApplications" WHERE "IdempotencyKey" = @id""", twin.IdempotencyKey));
        Assert.AreEqual(2L, await N6cRowsAsync(scenario.ClientId));
        var stepped = N6cSteppedWords(22m, today.AddDays(7));
        foreach (var set in N6bSets(N6bSession(await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id)), 3)))
        {
            N6cAssertAppliedSet(set, 24m, stepped);
        }
    }

    [TestMethod]
    public async Task N6cTwoRequestsUnderOneKeyForLiftsOfTwoProgramsLetOnlyOneLand()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        using var client = CreateClient();
        await RegisterCoachAsync(coach, "n6c-key@example.test", "P2 Coach", "n6c-key Gym");
        var clientId = await InviteAndAcceptAsync(coach, client, "n6c-key-client@example.test", newAccount: true);
        var enrollment = await CreateTrainingEnrollmentAsync(coach, clientId, today, 8);
        var squat = await CreateExerciseAsync(coach, "Competition squat", [], []);
        var bench = await CreateExerciseAsync(coach, "Bench press", [], []);
        // This week the squat and the bench press today and the bench press again in three days; from next week, the squat.
        var thisWeek = await PublishProgramAsync(coach, N6aProgram(
            "n6c key this week",
            N6bWeekOfDays(
                "Week 1",
                N6bDay(
                    "Day 1 full body",
                    0,
                    N6bLift(squat.Id, 1, N6aStepSet(1, 2m, 20m)),
                    N6bLift(bench.Id, 2, N6aStepSet(1, 2m, 20m))),
                N6bDay("Day 4 bench", 3, N6bLift(bench.Id, 1, N6aStepSet(1, 2m, 20m))))));
        var nextWeeks = await PublishProgramAsync(
            coach, N6aProgram("n6c key next", P2Week("Week 1", squat.Id, N6aStepSet(1, 2m, 20m))));
        var first = await N6bAssignAsync(coach, clientId, enrollment.Id, thisWeek, today);
        var next = await N6bAssignAsync(coach, clientId, enrollment.Id, nextWeeks, today.AddDays(7));
        var workout = await N6bTrainLiftsTodayAsync(client, true, [[new N6bLog(10, 20m)], [new N6bLog(10, 20m)]]);

        // The squat's coming session is in next week's program, the bench press's on this week's day 4: two programs.
        var standings = await N6bStandingsAsync(coach, clientId, [first.Id, next.Id], workout);
        var squatStanding = N6bAnswer(standings, squat.Id);
        var benchStanding = N6bAnswer(standings, bench.Id);
        Assert.AreEqual((next.Id, first.Id), (squatStanding.MesocycleId, benchStanding.MesocycleId));
        Assert.AreEqual(
            (LiftStandingOutcome.StepUp, LiftStandingOutcome.StepUp),
            (squatStanding.Standing.Outcome, benchStanding.Standing.Outcome));

        // One key sent with two requests at once, each for a lift of its own program: they share no program row, so only the
        // database's one request per key lets one land, and the other is told the key was used for another request.
        var key = Guid.NewGuid();
        var answers = await N6cRaceAsync(
            coach, clientId, N6cRequestFor(squatStanding, key), N6cRequestFor(benchStanding, key));
        var won = answers.Where(answer => answer.StatusCode == HttpStatusCode.OK).ToArray();
        Assert.HasCount(1, won, await N6cBodiesAsync(answers));
        await N6cAssertConflictAsync(
            answers.Single(answer => answer.StatusCode != HttpStatusCode.OK),
            "idempotency_conflict",
            "The other request under the key");
        var landed = (await ReadSlicePayloadAsync<LiftWeightsAppliedView>(won[0])).Lifts.Single();
        Assert.AreEqual(
            1L,
            await P2CountAsync("""SELECT count(*) FROM training."LiftWeightApplications" WHERE "IdempotencyKey" = @id""", key));
        Assert.AreEqual(1L, await N6cRowsAsync(clientId));

        // Only the lift that landed moved; the other keeps its own 20 kg.
        var squatSet = N6bSets(N6bSession(await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(next.Id)), 1)).Single();
        var benchSet = (await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(first.Id))).Weeks.Single().Sessions
            .Single(session => session.DayOffset == 3).Exercises.Single().Sets.Single();
        decimal? squatWeight = landed.ExerciseId == squat.Id ? 22m : 20m;
        decimal? benchWeight = landed.ExerciseId == bench.Id ? 22m : 20m;
        Assert.AreEqual((squatWeight, benchWeight), (squatSet.PrescribedLoad, benchSet.PrescribedLoad));
    }

    [TestMethod]
    public async Task N6cOnlyTheClientsOwnCoachAppliesAndNeverWhileTheirTrainingReadIsClosedOrOnceTheyAreReleased()
    {
        var today = R61aStartAtMidday();
        using var owner = CreateClient();
        using var client = CreateClient();
        var (scenario, block) = await N6cStartAsync(owner, client, "n6c-who", 3);
        var workout = await N6bTrainTodayAsync(client, true, new N6bLog(10, 20m), new N6bLog(10, 20m));
        var standing = N6bAnswer(await N6bStandingsAsync(owner, scenario.ClientId, [block.Id], workout), scenario.Exercise.Id);
        var request = N6cRequestFor(standing);
        var version = (await ReadSliceAsync<TrainingMesocycleView>(owner, P2MesocycleUrl(block.Id))).Version;

        // The client never applies their own weights.
        await AssertStatusAsync(await N6cApplyAsync(client, scenario.ClientId, request), HttpStatusCode.Forbidden);

        // A colleague who does not coach the client finds nothing, as for a client that does not exist (ADR 0026).
        using var colleague = CreateClient();
        await JoinAsCoachAsync(owner, colleague, "n6c-who-colleague@example.test", "Lina Saad");
        await AssertStatusAsync(await N6cApplyAsync(colleague, scenario.ClientId, request), HttpStatusCode.NotFound);

        // Another workspace's owner finds nothing in their own and is refused this one; nobody signed out applies.
        using var stranger = CreateClient();
        await RegisterCoachAsync(stranger, "n6c-who-stranger@example.test", "Other Owner", "N6c Elsewhere");
        await AssertStatusAsync(await N6cApplyAsync(stranger, scenario.ClientId, request), HttpStatusCode.NotFound);
        SetTenant(stranger, scenario.WorkspaceId);
        await AssertStatusAsync(await N6cApplyAsync(stranger, scenario.ClientId, request), HttpStatusCode.Forbidden);
        using var anonymous = CreateClient();
        SetTenant(anonymous, scenario.WorkspaceId);
        await AssertStatusAsync(await N6cApplyAsync(anonymous, scenario.ClientId, request), HttpStatusCode.Unauthorized);

        // The owner without the antiforgery token is refused, though the request would apply.
        owner.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
        await AssertStatusAsync(
            await owner.PostAsJsonAsync(N6cUrl(scenario.ClientId), request, SliceReadJson), HttpStatusCode.BadRequest);

        // A blocked relationship closes the coach's training read, and with it the apply (TRN-023).
        await N6bRelationshipAsync(owner, scenario.ClientId, "block");
        await AssertStatusAsync(await N6cApplyAsync(owner, scenario.ClientId, request), HttpStatusCode.Forbidden);

        // Nothing was written by any of them.
        Assert.AreEqual(0L, await N6cRowsAsync(scenario.ClientId));
        var untouched = await ReadSliceAsync<TrainingMesocycleView>(owner, P2MesocycleUrl(block.Id));
        Assert.AreEqual(version, untouched.Version);
        foreach (var set in N6bSets(N6bSession(untouched, 2)))
        {
            N6aAssertStepSet(set, 2m, 20m);
        }

        // Unblocked, the owner, who coaches every client, applies it.
        await N6bRelationshipAsync(owner, scenario.ClientId, "unblock");
        var applied = (await N6cApplyOkAsync(owner, scenario.ClientId, request)).Lifts.Single();
        Assert.AreEqual((block.Id, today.AddDays(7)), (applied.MesocycleId, applied.SessionDate));
        Assert.AreEqual(1L, await N6cRowsAsync(scenario.ClientId));

        // Released (ADR 0027), the client's record is read-only: nothing more is applied, and what was applied stays.
        await ReleaseAsync(owner, scenario.ClientId, "Moved away");
        await N6cAssertConflictAsync(
            await N6cApplyAsync(owner, scenario.ClientId, request with { IdempotencyKey = Guid.NewGuid() }),
            "client_released",
            "A released client");
        Assert.AreEqual(1L, await N6cRowsAsync(scenario.ClientId));
        var words = N6cSteppedWords(20m, today);
        foreach (var set in N6bSets(N6bSession(await ReadSliceAsync<TrainingMesocycleView>(owner, P2MesocycleUrl(block.Id)), 2)))
        {
            N6cAssertAppliedSet(set, 22m, words);
        }
    }

    [TestMethod]
    public async Task N6cAnUnpaidWorkspaceRefusesAnApplyWhileTheProgramStillReads()
    {
        RequiredTestClock.Set(BillingWorkspaceCreated);
        using var owner = CreateClient();
        await RegisterCoachAsync(owner, "n6c-ro-owner@example.test", "Read Owner", "N6c Read Gym");
        using var coach = CreateClient();
        await JoinAsCoachAsync(owner, coach, "n6c-ro-coach@example.test", "Read Coach");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "n6c-ro-client@example.test", true);
        await CreateFreeTrainingEnrollmentAsync(coach, clientId, BillingLocalDate());

        RequiredTestClock.Set(new DateTimeOffset(2026, 8, 1, 0, 10, 0, TimeSpan.Zero));
        await IssueBillingAsync(BillingJuly);

        // Seven days past the bill's due date the workspace is read-only for its staff (ADR 0028): the tenant handler refuses
        // the apply before it reads anything, for the owner and the client's coach alike, and the program still reads.
        RequiredTestClock.Set(new DateTimeOffset(2026, 8, 15, 8, 0, 0, TimeSpan.Zero));
        var request = N6cRequestOf(Guid.NewGuid(), new SetWeightRequest(Guid.NewGuid(), 20m, 22m));
        await AssertReadOnlyAsync(await N6cApplyAsync(owner, clientId, request));
        await AssertReadOnlyAsync(await N6cApplyAsync(coach, clientId, request));
        await AssertStatusAsync(await owner.GetAsync(R34aProgramUrl(clientId)), HttpStatusCode.OK);
        await AssertStatusAsync(await coach.GetAsync(R34aProgramUrl(clientId)), HttpStatusCode.OK);
        Assert.AreEqual(0L, await N6cRowsAsync(clientId));
    }

    [TestMethod]
    public async Task N6cAnEditOfTheWeeksReadBeforeAnApplyIsRefusedAndOneReadAfterKeepsTheAppliedWeight()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        using var client = CreateClient();
        var (scenario, block) = await N6cStartAsync(coach, client, "n6c-edit", 3);
        var workout = await N6bTrainTodayAsync(client, true, new N6bLog(10, 20m), new N6bLog(10, 20m));

        // The coach opens Edit weeks on the program as it is and moves week 3's first set to 21 kg, previewed.
        var before = await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id));
        var staleGrid = P3bGrid(before, today);
        staleGrid[2] = P3bEditFirstSet(staleGrid[2], set => set with { DirectLoad = 21m });
        var stalePreview = await P3bPreviewOkAsync(coach, before, staleGrid);

        // Meanwhile week 2's step is applied, and the program's version moves on.
        var standing = N6bAnswer(await N6bStandingsAsync(coach, scenario.ClientId, [block.Id], workout), scenario.Exercise.Id);
        await N6cApplyOkAsync(coach, scenario.ClientId, N6cRequestFor(standing));

        // The edit read before the apply holds week 2 at 20 kg, so it is refused and changes nothing.
        await N6cAssertConflictAsync(
            await P3bApplyAsync(coach, block.Id, before.Version, staleGrid, stalePreview.PreviewHash),
            "program_edit_conflict",
            "An edit read before the apply");
        Assert.AreEqual(0L, await P3bEditCountAsync(block.Id));
        var applied = await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id));
        var words = N6cSteppedWords(20m, today);
        foreach (var set in N6bSets(N6bSession(applied, 2)))
        {
            N6cAssertAppliedSet(set, 22m, words);
        }

        foreach (var set in N6bSets(N6bSession(applied, 3)))
        {
            N6aAssertStepSet(set, 2m, 20m);
        }

        // Read again, the grid sends week 2 as stored: the edit changes week 3 alone, and week 2 keeps the applied 22 kg.
        var grid = P3bGrid(applied, today);
        grid[2] = P3bEditFirstSet(grid[2], set => set with { DirectLoad = 21m });
        var preview = await P3bPreviewOkAsync(coach, applied, grid);
        Assert.AreEqual(
            (0, 1, 0, 0, 3),
            (preview.SessionsAdded, preview.SessionsEdited, preview.SessionsMoved, preview.SessionsRemoved,
                preview.SessionChanges.Single().WeekNumber));
        var edited = await P3bApplyOkAsync(coach, applied, grid, preview.PreviewHash);
        foreach (var set in N6bSets(N6bSession(edited, 2)))
        {
            N6cAssertAppliedSet(set, 22m, words);
        }

        var week3 = N6bSets(N6bSession(edited, 3));
        N6aAssertStepSet(week3[0], 2m, 21m);
        N6aAssertStepSet(week3[1], 2m, 20m);

        // On week 2's day the client is told why; once the coach edits that weight, it is the coach's own and the line goes.
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        N6cAssertNote((await N6cTodaysLiftAsync(client)).WeightNote, SetStandingMove.StepUp, today, null, 2m, 2m);
        var onTheDay = await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id));
        var changed = P3bGrid(onTheDay, today.AddDays(7));
        changed[1] = P3bEditFirstSet(changed[1], set => set with { DirectLoad = 25m });
        await P3bApplyOkAsync(coach, onTheDay, changed, (await P3bPreviewOkAsync(coach, onTheDay, changed)).PreviewHash);
        var lift = await N6cTodaysLiftAsync(client);
        CollectionAssert.AreEqual(new decimal?[] { 25m, 22m }, N6cWeights(lift));
        Assert.IsNull(lift.WeightNote, "A weight the coach typed is not the rule's, so nothing says the rule set it.");
    }

    [TestMethod]
    public async Task N6cTheRecordOfAnApplyIsAppendOnlyAndTheDatabaseKeepsOnePerKeyAndLiftInItsOwnWorkspace()
    {
        R61aStartAtMidday();
        using var coach = CreateClient();
        using var client = CreateClient();
        var (scenario, block) = await N6cStartAsync(coach, client, "n6c-append", 3);
        var workout = await N6bTrainTodayAsync(client, true, new N6bLog(10, 20m), new N6bLog(10, 20m));
        var standing = N6bAnswer(await N6bStandingsAsync(coach, scenario.ClientId, [block.Id], workout), scenario.Exercise.Id);
        var applied = (await N6cApplyOkAsync(coach, scenario.ClientId, N6cRequestFor(standing))).Lifts.Single();
        using var stranger = CreateClient();
        var elsewhere = await RegisterCoachAsync(stranger, "n6c-append-stranger@example.test", "Other Owner", "N6c Append Elsewhere");

        // Whatever reaches the table, a record is never rewritten or taken away.
        await AssertSqlStateAsync(
            "55000",
            """UPDATE training."LiftWeightApplications" SET "SetCount" = 1 WHERE "Id" = @id""",
            ("id", applied.ApplicationId));
        await AssertSqlStateAsync(
            "55000",
            """DELETE FROM training."LiftWeightApplications" WHERE "Id" = @id""",
            ("id", applied.ApplicationId));

        // One record per key and lift, one request per key whatever lift it names, a fingerprint of 64 lowercase hex digits,
        // 1 to 20 sets, and a program of its own workspace.
        await AssertSqlStateAsync("23505", N6cCopySql(applied.ApplicationId, string.Empty));
        await AssertSqlStateAsync(
            "23P01",
            N6cCopySql(applied.ApplicationId, """r."ExercisePrescriptionId" := gen_random_uuid(); r."RequestFingerprint" := repeat('a', 64);"""));
        await AssertSqlStateAsync(
            "23514",
            N6cCopySql(applied.ApplicationId, """r."IdempotencyKey" := gen_random_uuid(); r."RequestFingerprint" := repeat('G', 64);"""));
        await AssertSqlStateAsync(
            "23514",
            N6cCopySql(applied.ApplicationId, """r."IdempotencyKey" := gen_random_uuid(); r."SetCount" := 21;"""));
        await AssertSqlStateAsync(
            "23503",
            N6cCopySql(applied.ApplicationId, $"""r."IdempotencyKey" := gen_random_uuid(); r."TenantId" := '{elsewhere}';"""));
        Assert.AreEqual(1L, await N6cRowsAsync(scenario.ClientId));
        Assert.AreEqual(
            1L,
            await P2CountAsync("""SELECT count(*) FROM training."LiftWeightApplications" WHERE "SetCount" = 2 AND "Id" = @id""", applied.ApplicationId));
    }

    [TestMethod]
    public async Task N6cTheMigrationRevertsAndReappliesWhileNoWeightHasBeenApplied()
    {
        R61aStartAtMidday();
        using var coach = CreateClient();
        using var client = CreateClient();
        var (scenario, block) = await N6cStartAsync(coach, client, "n6c-migration", 3);
        var workout = await N6bTrainTodayAsync(client, true, new N6bLog(10, 20m), new N6bLog(10, 20m));
        var standing = N6bAnswer(await N6bStandingsAsync(coach, scenario.ClientId, [block.Id], workout), scenario.Exercise.Id);

        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var (migration, previous, migrator) = N6cMigrations(context);

        // With nothing applied, going back drops the table and its guard. Nothing asks the API anything until it is back.
        await migrator.MigrateAsync(previous);
        Assert.AreEqual((0L, 0L), (await A7ScalarAsync(N6cTableSql), await A7ScalarAsync(N6cTriggerSql)));
        Assert.DoesNotContain(migration, await context.Database.GetAppliedMigrationsAsync());

        // Reapplied, the table, its key and its guard are back; the migrations after it go back on before the API is asked.
        await migrator.MigrateAsync(migration);
        Assert.AreEqual(
            (1L, 1L, 1L),
            (await A7ScalarAsync(N6cTableSql), await A7ScalarAsync(N6cTriggerSql), await A7ScalarAsync(N6cKeyIndexSql)));
        await migrator.MigrateAsync();
        Assert.Contains(migration, await context.Database.GetAppliedMigrationsAsync());

        // The API applies over the table made again, and its record is guarded as before.
        var applied = (await N6cApplyOkAsync(coach, scenario.ClientId, N6cRequestFor(standing))).Lifts.Single();
        Assert.AreEqual(1L, await N6cRowsAsync(scenario.ClientId));
        await AssertSqlStateAsync(
            "55000",
            """DELETE FROM training."LiftWeightApplications" WHERE "Id" = @id""",
            ("id", applied.ApplicationId));
    }

    [TestMethod]
    public async Task N6cTheMigrationRefusesToRevertOverAnAppliedWeight()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        using var client = CreateClient();
        var (scenario, block) = await N6cStartAsync(coach, client, "n6c-revert", 3);
        var workout = await N6bTrainTodayAsync(client, true, new N6bLog(10, 20m), new N6bLog(10, 20m));
        var standing = N6bAnswer(await N6bStandingsAsync(coach, scenario.ClientId, [block.Id], workout), scenario.Exercise.Id);
        await N6cApplyOkAsync(coach, scenario.ClientId, N6cRequestFor(standing));

        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var (migration, previous, migrator) = N6cMigrations(context);

        // An applied weight is history kept append-only, so going back is a forward fix: the migration stops with a plain
        // message, keeps everything and stays applied. Npgsql counts 55000 as transient, so the context's retrying strategy
        // runs the refused revert again, each time rolled back, and then hands over PostgreSQL's refusal inside its own.
        var thrown = await Assert.ThrowsAsync<Exception>(() => migrator.MigrateAsync(previous));
        var refused = thrown as PostgresException ?? thrown.InnerException as PostgresException
            ?? throw new AssertFailedException($"Expected PostgreSQL's refusal, not {thrown}");
        Assert.AreEqual(("55000", N6cRevertRefusal), (refused.SqlState, refused.MessageText));
        Assert.Contains(migration, await context.Database.GetAppliedMigrationsAsync());
        Assert.AreEqual(
            (1L, 1L, 1L),
            (await A7ScalarAsync(N6cTableSql), await A7ScalarAsync(N6cTriggerSql), await N6cRowsAsync(scenario.ClientId)));

        // The migrations after this one were reverted, each in its own transaction, before this one refused: the newest
        // model goes back on before the API is asked anything.
        await migrator.MigrateAsync();

        // The API reads the applied weight as before.
        var words = N6cSteppedWords(20m, today);
        foreach (var set in N6bSets(N6bSession(await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id)), 2)))
        {
            N6cAssertAppliedSet(set, 22m, words);
        }
    }

    [TestMethod]
    public async Task N6cAWorkoutStartedWhileItsWeightIsBeingAppliedKeepsWhatItStartedWithAndTheApplyIsRefused()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        using var client = CreateClient();
        var (scenario, block) = await N6cStartAsync(coach, client, "n6c-started", 3);
        var workout = await N6bTrainTodayAsync(client, true, new N6bLog(10, 20m), new N6bLog(10, 20m));

        // On week 2's own day, before the client starts it, week 2 still stands at 22 kg.
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        var standing = N6bAnswer(await N6bStandingsAsync(coach, scenario.ClientId, [block.Id], workout), scenario.Exercise.Id);
        N6bAssertComing(standing, block.Id, N6bSession(block, 2), today.AddDays(7));
        var request = N6cRequestFor(standing);
        Assert.HasCount(2, request.Lifts[0].Sets);

        // The coach's apply is held at its write, having read the lift and loaded the program, while the client starts week 2.
        await RefreshCsrfAsync(coach);
        RequiredInsertBarrier.Arm("training.\"LiftWeightApplications\"", 2);
        HttpResponseMessage answer;
        try
        {
            var apply = coach.PostAsJsonAsync(N6cUrl(scenario.ClientId), request, SliceReadJson);
            var held = RequiredInsertBarrier.ArrivedAsync(1);
            if (await Task.WhenAny(apply, held) == apply)
            {
                var early = await apply;
                Assert.Fail($"The apply answered before its write: {(int)early.StatusCode} {await early.Content.ReadAsStringAsync()}");
            }

            var day = await ReadSliceAsync<ClientTrainingDayResult>(client, "/api/training/me/today");
            await RefreshCsrfAsync(client);
            await AssertStatusAsync(
                await client.PostAsync($"/api/training/me/sessions/{day.Workouts.Single().SessionId}/start", null),
                HttpStatusCode.OK);
            RequiredInsertBarrier.Disarm();
            answer = await apply;
        }
        finally
        {
            RequiredInsertBarrier.Disarm();
        }

        // The apply is refused in the coach's words, and the workout keeps the 20 kg it started with.
        var body = await answer.Content.ReadAsStringAsync();
        Assert.AreEqual(HttpStatusCode.Conflict, answer.StatusCode, body);
        using (var conflict = JsonDocument.Parse(body))
        {
            var said = (conflict.RootElement.GetProperty("code").GetString(), conflict.RootElement.GetProperty("message").GetString());
            Assert.IsTrue(
                said is ("lift_standing_changed", N6cStandingChanged) or ("concurrency_conflict", N6cProgramChanged),
                body);
        }

        Assert.AreEqual(0L, await N6cRowsAsync(scenario.ClientId));
        var running = (await ReadSliceAsync<ClientTrainingDayResult>(client, "/api/training/me/today")).Workouts.Single();
        Assert.AreEqual((WorkoutExecutionStatus?)WorkoutExecutionStatus.InProgress, running.Status);
        CollectionAssert.AreEqual(new decimal?[] { 20m, 20m }, N6cWeights(running.Exercises.Single()));
        Assert.IsNull(running.Exercises.Single().WeightNote);
        foreach (var set in N6bSets(N6bSession(await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id)), 2)))
        {
            N6aAssertStepSet(set, 2m, 20m);
        }
    }

    // ----- helpers -----

    private static string N6cUrl(Guid clientId) => $"/api/training/clients/{clientId}/lift-weights/apply";

    /// <summary>Weeks of one session of the lift: two "Last time + step" sets of 10 from 20 kg, each stepping 2 kg.</summary>
    private static Func<Guid, object[]> N6cWeeks(int weeks) =>
        exerciseId =>
        [
            .. Enumerable.Range(1, weeks).Select(week =>
                P2Week($"Week {week}", exerciseId, N6aStepSet(1, 2m, 20m), N6aStepSet(2, 2m, 20m))),
        ];

    /// <summary>A coach, a client on an eight-week plan, and <see cref="N6cWeeks"/> assigned from today with no max.</summary>
    private static async Task<(P2Custom Scenario, TrainingMesocycleView Block)> N6cStartAsync(
        HttpClient coach,
        HttpClient client,
        string tag,
        int weeks)
    {
        var scenario = await P2CustomStartAsync(coach, client, tag, N6cWeeks(weeks));
        return (scenario, await P2AssignAsync(coach, scenario, []));
    }

    /// <summary>The sets an answer moves, each from the weight it has to the one the answer names, as the coach's screen sends them.</summary>
    private static SetWeightRequest[] N6cMoving(LiftStandingView standing) =>
    [
        .. standing.Standing.Sets
            .Where(set => (set.Move is SetStandingMove.StepUp or SetStandingMove.SameAsLastTime) &&
                          set.Weight is { } weight &&
                          weight != set.CurrentWeight)
            .OrderBy(set => set.SetNumber)
            .Select(set => new SetWeightRequest(set.SetPrescriptionId, set.CurrentWeight, set.Weight!.Value)),
    ];

    /// <summary>Applying one lift as the read gave it.</summary>
    private static ApplyLiftWeightsRequest N6cRequestFor(LiftStandingView standing, Guid? key = null) =>
        new([new LiftWeightRequest(standing.ExercisePrescriptionId, N6cMoving(standing))], key ?? Guid.NewGuid());

    /// <summary>Applying the given sets of one writing of a lift, under a new key.</summary>
    private static ApplyLiftWeightsRequest N6cRequestOf(Guid exercisePrescriptionId, params SetWeightRequest[] sets) =>
        new([new LiftWeightRequest(exercisePrescriptionId, sets)], Guid.NewGuid());

    private static async Task<HttpResponseMessage> N6cApplyAsync(
        HttpClient caller,
        Guid clientId,
        ApplyLiftWeightsRequest request)
    {
        await RefreshCsrfAsync(caller);
        return await caller.PostAsJsonAsync(N6cUrl(clientId), request, SliceReadJson);
    }

    private static async Task<LiftWeightsAppliedView> N6cApplyOkAsync(
        HttpClient coach,
        Guid clientId,
        ApplyLiftWeightsRequest request)
    {
        var response = await N6cApplyAsync(coach, clientId, request);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<LiftWeightsAppliedView>(response);
    }

    /// <summary>
    /// Sends the two applies at once, the token refreshed once before, and holds each at its write until both are there:
    /// each has read where the lift stands and loaded the program, so the database decides between them. Released
    /// together, two inserts under one key can each wait on the other's row in the one-request-per-key exclusion
    /// constraint; PostgreSQL then ends one as a deadlock (40P01) and the execution strategy saves it again, so it
    /// reaches the insert a third time. Both arriving is what shows the race.
    /// </summary>
    private async Task<HttpResponseMessage[]> N6cRaceAsync(
        HttpClient coach,
        Guid clientId,
        ApplyLiftWeightsRequest one,
        ApplyLiftWeightsRequest other)
    {
        await RefreshCsrfAsync(coach);
        RequiredInsertBarrier.Arm("training.\"LiftWeightApplications\"", 2);
        try
        {
            var answers = await Task.WhenAll(
                coach.PostAsJsonAsync(N6cUrl(clientId), one, SliceReadJson),
                coach.PostAsJsonAsync(N6cUrl(clientId), other, SliceReadJson));
            Assert.IsGreaterThanOrEqualTo(2, RequiredInsertBarrier.Arrived, "The two applies never raced.");
            return answers;
        }
        finally
        {
            RequiredInsertBarrier.Disarm();
        }
    }

    private static async Task<string> N6cBodiesAsync(IEnumerable<HttpResponseMessage> answers) =>
        string.Join(
            " | ",
            await Task.WhenAll(answers.Select(async answer =>
                $"{(int)answer.StatusCode} {await answer.Content.ReadAsStringAsync()}")));

    private static async Task N6cAssertConflictAsync(HttpResponseMessage response, string code, string because)
    {
        var body = await response.Content.ReadAsStringAsync();
        Assert.AreEqual(HttpStatusCode.Conflict, response.StatusCode, $"{because}: {body}");
        using var document = JsonDocument.Parse(body);
        Assert.AreEqual(code, document.RootElement.GetProperty("code").GetString(), $"{because}: {body}");
    }

    private static async Task N6cAssertInvalidAsync(HttpResponseMessage response, string field, string words, string because)
    {
        var body = await response.Content.ReadAsStringAsync();
        Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode, $"{because}: {body}");
        using var document = JsonDocument.Parse(body);
        Assert.AreEqual(
            words,
            document.RootElement.GetProperty("errors").GetProperty(field).EnumerateArray().Single().GetString(),
            $"{because}: {body}");
    }

    /// <summary>Asserts what an apply says it wrote for one lift: its block, session, day and writing, and each set.</summary>
    private static void N6cAssertApplied(
        AppliedLiftWeightView lift,
        Guid blockId,
        TrainingSessionView session,
        DateOnly day,
        params AppliedLiftSetView[] sets)
    {
        var exercise = session.Exercises.Single();
        Assert.AreEqual((DateOnly?)day, session.ScheduledDate);
        Assert.AreEqual(
            (blockId, session.Id, session.Name, day, exercise.Id, exercise.ExerciseId, exercise.ExerciseName),
            (lift.MesocycleId, lift.SessionId, lift.SessionName, lift.SessionDate, lift.ExercisePrescriptionId, lift.ExerciseId, lift.ExerciseName));
        CollectionAssert.AreEqual(sets, lift.Sets.ToArray());
    }

    /// <summary>One kilogram set an apply wrote, stepping 2 kg: what the answer did, and the weight before and after.</summary>
    private static AppliedLiftSetView N6cSet(Guid setId, int number, SetStandingMove move, decimal? before, decimal after) =>
        new(setId, number, move, before, after, TrainingLoadUnit.Kilogram, 2m);

    /// <summary>
    /// A step set holding the weight a coach applied: its own weight, unrounded and from no max, its step unchanged, and the
    /// rule's name, version and why.
    /// </summary>
    private static void N6cAssertAppliedSet(SetPrescriptionView set, decimal weight, string explanation)
    {
        Assert.AreEqual(
            (TrainingLoadStrategy.LastTimeStep, (decimal?)2m, (decimal?)weight, (decimal?)weight, (decimal?)weight, (Guid?)null, false),
            (set.LoadStrategy, set.LoadStep, set.DirectLoad, set.PrescribedLoad, set.UnroundedRecommendedLoad, set.WorkingMaxSnapshotId, set.IsManualLoadOverride));
        Assert.AreEqual(
            ("LastTimeStep", "1", explanation),
            (set.CalculationStrategyKey, set.CalculationStrategyVersion, set.CalculationExplanation));
    }

    private static string N6cSteppedWords(decimal from, DateOnly day) =>
        string.Create(
            CultureInfo.InvariantCulture,
            $"{from:0.###} kg logged on {day:yyyy-MM-dd} plus the 2 kg step (LastTimeStep v1), applied by the coach.");

    private static string N6cKeptWords(decimal weight, DateOnly day) =>
        string.Create(
            CultureInfo.InvariantCulture,
            $"{weight:0.###} kg logged on {day:yyyy-MM-dd}, kept (LastTimeStep v1), applied by the coach.");

    private static async Task<ClientExerciseView> N6cTodaysLiftAsync(HttpClient client) =>
        (await ReadSliceAsync<ClientTrainingDayResult>(client, "/api/training/me/today")).Workouts.Single().Exercises.Single();

    private static decimal?[] N6cWeights(ClientExerciseView exercise) =>
        [.. exercise.Sets.OrderBy(set => set.Position).Select(set => set.PrescribedLoad)];

    /// <summary>
    /// Asserts the client's line for a lift of two kilogram working sets of 10, its effort written as RPE: what the coach did
    /// with last time's sets, the day of last time, why the weight was kept, and each stepped set's rise.
    /// </summary>
    private static void N6cAssertNote(
        ClientWeightNoteView? note,
        SetStandingMove move,
        DateOnly lastTimeDay,
        LiftStandingReasonDetail? reason,
        params decimal[] increases)
    {
        Assert.IsNotNull(note, "The client is told why the coach set this weight.");
        Assert.AreEqual(
            (move, TrainingLoadUnit.Kilogram, lastTimeDay, 2, (int?)10, reason, ExertionDisplayPreference.Rpe),
            (note.Move, note.Unit, note.LastTimeDay, note.WorkingSets, note.RepetitionsAsked, note.Reason, note.ExertionDisplay));
        CollectionAssert.AreEqual(increases, note.Increases.ToArray());
    }

    private async Task<long> N6cRowsAsync(Guid clientId) =>
        await P2CountAsync(
            """SELECT count(*) FROM training."LiftWeightApplications" WHERE "ClientProfileId" = @id""", clientId);

    /// <summary>One record of an apply as the database keeps it, every column by name (its answer and sets as JSON).</summary>
    private async Task<JsonElement> N6cRecordAsync(Guid applicationId)
    {
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            """SELECT row_to_json(r)::text FROM training."LiftWeightApplications" AS r WHERE r."Id" = @id""";
        command.Parameters.AddWithValue("id", applicationId);
        var text = (string?)await command.ExecuteScalarAsync()
            ?? throw new AssertFailedException("The apply left no record.");
        using var document = JsonDocument.Parse(text);
        return document.RootElement.Clone();
    }

    private static DateOnly N6cDay(JsonElement record, string column) =>
        DateOnly.Parse(record.GetProperty(column).GetString()!, CultureInfo.InvariantCulture);

    /// <summary>A copy of one record under a new id, with the given change, as a statement that reaches the table directly.</summary>
    private static string N6cCopySql(Guid applicationId, string change) =>
        $$"""
        DO $copy$
        DECLARE r training."LiftWeightApplications"%ROWTYPE;
        BEGIN
            SELECT * INTO STRICT r FROM training."LiftWeightApplications" WHERE "Id" = '{{applicationId}}';
            r."Id" := gen_random_uuid();
            {{change}}
            INSERT INTO training."LiftWeightApplications" SELECT r.*;
        END $copy$;
        """;

    /// <summary>N6c's migration, the one before it, and the migrator of the test database.</summary>
    private static (string Migration, string Previous, IMigrator Migrator) N6cMigrations(GymDbContext context)
    {
        var migrations = context.Database.GetMigrations().ToArray();
        var migration = migrations.Single(item => item.EndsWith("_LiftWeightApplications", StringComparison.Ordinal));
        return (
            migration,
            migrations[Array.IndexOf(migrations, migration) - 1],
            context.Database.GetInfrastructure().GetRequiredService<IMigrator>());
    }
}
