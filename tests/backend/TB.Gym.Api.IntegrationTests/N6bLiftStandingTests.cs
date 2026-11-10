using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using TB.Gym.Modules.Training;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The notes plan's N6b (decisions 20 to 22, 5 and 7 Nov 2026): where each lift with "Last time + step" sets stands,
/// <c>LastTimeStep</c> v1 (STR-019). For each writing of a lift in its coming session (the earliest one not started and
/// not before today), the coach's program read, the block's read and the logged workout's read give the same answer:
/// each set's last logged weight plus its step, exactly, when every set reached its reps, or a hold and its reason, read
/// from the client's latest workout of the lift in any program. Only the client's own coach reads it, a closed training
/// read (TRN-023) carries none, and the client's own reads never carry it. Each test that steps whole days starts at
/// midday in the workspace's zone, so each step lands on the next calendar day; the one about midnight sets each instant
/// in that zone itself.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    /// <summary>The client's own training reads, which never say where a lift stands (decision 21: the coach applies).</summary>
    private static readonly string[] N6bClientReads =
    [
        "/api/training/me/today",
        "/api/training/me/upcoming",
        "/api/training/me/program",
        "/api/training/me/history",
    ];

    [TestMethod]
    public async Task N6bEverySetDoneStepsEachSetFromItsOwnLoggedWeightExactlyOnEveryCoachRead()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        using var client = CreateClient();
        // A step of 2 kg from 20 kg, and one of 1.25 kg with no starting weight, in a program that rounds to 2.5 kg.
        var scenario = await P2CustomStartAsync(coach, client, "n6b-step", exerciseId =>
        [
            P2Week("Week 1", exerciseId, N6aStepSet(1, 2m, 20m), N6aStepSet(2, 1.25m)),
            P2Week("Week 2", exerciseId, N6aStepSet(1, 2m, 20m), N6aStepSet(2, 1.25m)),
        ]);
        var block = await P2AssignAsync(coach, scenario, []);
        Assert.IsNull(block.LiftStandings, "A write's answer never says where the lifts stand.");

        // Never done: week 1's session is the coming one, and each set keeps its own weight.
        var week1 = N6bSession(block, 1);
        var sets = N6bSets(week1);
        var never = N6bAnswer(await N6bStandingsAsync(coach, scenario.ClientId, [block.Id]), scenario.Exercise.Id);
        N6bAssertComing(never, block.Id, week1, today);
        N6bAssertAnswer(
            never,
            LiftStandingOutcome.Hold,
            N6bReason(LiftStandingReason.NeverDone),
            today,
            N6bSet(sets[0].Id, 1, SetStandingMove.Unchanged, 20m, 20m, 2m),
            N6bSet(sets[1].Id, 2, SetStandingMove.Unchanged, null, null, 1.25m));
        Assert.IsNull(never.Standing.LastTime);

        // Every set reached its 10 reps, the second at 21 kg the client picked: each set steps from its own logged weight,
        // exactly (22.25 kg is off the program's 2.5 kg grid), and week 2's session is the coming one.
        var workout = await N6bTrainTodayAsync(client, true, new N6bLog(10, 20m), new N6bLog(10, 21m));
        var week2 = N6bSession(block, 2);
        sets = N6bSets(week2);
        var stepped = N6bAnswer(await N6bStandingsAsync(coach, scenario.ClientId, [block.Id], workout), scenario.Exercise.Id);
        N6bAssertComing(stepped, block.Id, week2, today.AddDays(7));
        N6bAssertAnswer(
            stepped,
            LiftStandingOutcome.StepUp,
            N6bReason(LiftStandingReason.EverySetDone, today),
            today,
            N6bSet(sets[0].Id, 1, SetStandingMove.StepUp, 22m, 20m, 2m),
            N6bSet(sets[1].Id, 2, SetStandingMove.StepUp, 22.25m, null, 1.25m));
        N6bAssertLastTime(stepped, workout, today, N6bLogged(1, 10, 20m, 10, 20m), N6bLogged(2, 10, null, 10, 21m));
    }

    [TestMethod]
    public async Task N6bAMissedRepOrASetLoggedWithoutRepsHoldsTheLiftAtLastTimesWeights()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "n6b-reps", exerciseId =>
        [
            P2Week("Week 1", exerciseId, N6aStepSet(1, 2.5m, 20m), N6aStepSet(2, 2.5m, 20m)),
            P2Week("Week 2", exerciseId, N6aStepSet(1, 2.5m, 20m), N6aStepSet(2, 2.5m, 20m)),
            P2Week("Week 3", exerciseId, N6aStepSet(1, 2.5m, 20m), N6aStepSet(2, 2.5m, 20m)),
        ]);
        var block = await P2AssignAsync(coach, scenario, []);

        // Set 2 reached 8 of 10, both at 22.5 kg where the program says 20 kg: the lift holds at what was logged (line d).
        var first = await N6bTrainTodayAsync(client, true, new N6bLog(10, 22.5m), new N6bLog(8, 22.5m));
        var week2 = N6bSession(block, 2);
        var sets = N6bSets(week2);
        var missed = N6bAnswer(await N6bStandingsAsync(coach, scenario.ClientId, [block.Id], first), scenario.Exercise.Id);
        N6bAssertComing(missed, block.Id, week2, today.AddDays(7));
        N6bAssertAnswer(
            missed,
            LiftStandingOutcome.Hold,
            N6bReason(LiftStandingReason.RepsShort, today, set: 2, reps: 8, asked: 10),
            today,
            N6bSet(sets[0].Id, 1, SetStandingMove.SameAsLastTime, 22.5m, 20m, 2.5m),
            N6bSet(sets[1].Id, 2, SetStandingMove.SameAsLastTime, 22.5m, 20m, 2.5m));
        N6bAssertLastTime(missed, first, today, N6bLogged(1, 10, 20m, 10, 22.5m), N6bLogged(2, 10, 20m, 8, 22.5m));

        // A week on, set 2 is logged with its reps box left empty: a set without reps never counts (decision 22).
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        var second = await N6bTrainTodayAsync(client, true, new N6bLog(10, 22.5m), new N6bLog(null, 22.5m));
        var week3 = N6bSession(block, 3);
        sets = N6bSets(week3);
        var empty = N6bAnswer(
            await N6bStandingsAsync(coach, scenario.ClientId, [block.Id], first, second), scenario.Exercise.Id);
        N6bAssertComing(empty, block.Id, week3, today.AddDays(14));
        N6bAssertAnswer(
            empty,
            LiftStandingOutcome.Hold,
            N6bReason(LiftStandingReason.NoRepsTyped, today.AddDays(7), set: 2),
            today.AddDays(7),
            N6bSet(sets[0].Id, 1, SetStandingMove.SameAsLastTime, 22.5m, 20m, 2.5m),
            N6bSet(sets[1].Id, 2, SetStandingMove.SameAsLastTime, 22.5m, 20m, 2.5m));
        N6bAssertLastTime(
            empty, second, today.AddDays(7), N6bLogged(1, 10, 20m, 10, 22.5m), N6bLogged(2, 10, 20m, null, 22.5m));
    }

    [TestMethod]
    public async Task N6bALoggedWeightThatLooksLikeATypoHoldsOnceAndTheNextSensibleLogStepsAgain()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "n6b-typo", exerciseId =>
        [
            P2Week("Week 1", exerciseId, N6aStepSet(1, 2m, 20m)),
            P2Week("Week 2", exerciseId, N6aStepSet(1, 2m, 20m)),
            P2Week("Week 3", exerciseId, N6aStepSet(1, 2m, 20m)),
            P2Week("Week 4", exerciseId, N6aStepSet(1, 2m, 20m)),
        ]);
        var block = await P2AssignAsync(coach, scenario, []);
        var first = await N6bTrainTodayAsync(client, true, new N6bLog(10, 20m));

        // A week on, 200 kg is logged for 20: more than 25% from the 20 kg before it (line e). A finished workout cannot
        // be edited, so the lift holds at its own weight and says what it compared.
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        var typo = await N6bTrainTodayAsync(client, true, new N6bLog(10, 200m));
        var week3 = N6bSession(block, 3);
        var held = N6bAnswer(
            await N6bStandingsAsync(coach, scenario.ClientId, [block.Id], first, typo), scenario.Exercise.Id);
        N6bAssertComing(held, block.Id, week3, today.AddDays(14));
        N6bAssertAnswer(
            held,
            LiftStandingOutcome.Hold,
            N6bReason(
                LiftStandingReason.LooksLikeTypo, today.AddDays(7), set: 1, weight: 200m, earlier: 20m, unit: TrainingLoadUnit.Kilogram),
            today.AddDays(7),
            N6bSet(N6bSets(week3)[0].Id, 1, SetStandingMove.Unchanged, 20m, 20m, 2m));
        N6bAssertLastTime(held, typo, today.AddDays(7), N6bLogged(1, 10, 20m, 10, 200m));

        // Another week on, 22 kg is logged, within 25% of the 20 kg that stood: the typo held once, and the lift steps again.
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        var sensible = await N6bTrainTodayAsync(client, true, new N6bLog(10, 22m));
        var week4 = N6bSession(block, 4);
        var stepped = N6bAnswer(
            await N6bStandingsAsync(coach, scenario.ClientId, [block.Id], typo, sensible), scenario.Exercise.Id);
        N6bAssertComing(stepped, block.Id, week4, today.AddDays(21));
        N6bAssertAnswer(
            stepped,
            LiftStandingOutcome.StepUp,
            N6bReason(LiftStandingReason.EverySetDone, today.AddDays(14)),
            today.AddDays(14),
            N6bSet(N6bSets(week4)[0].Id, 1, SetStandingMove.StepUp, 24m, 20m, 2m));
        N6bAssertLastTime(stepped, sensible, today.AddDays(14), N6bLogged(1, 10, 20m, 10, 22m));
    }

    [TestMethod]
    public async Task N6bALiftLastDoneMoreThan14DaysAgoKeepsItsOwnWeightAndALapsedPlanReadsNoAnswer()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "n6b-lookback", exerciseId =>
        [
            P2Week("Week 1", exerciseId, N6aStepSet(1, 2.5m, 20m)),
            P2Week("Week 2", exerciseId, N6aStepSet(1, 2.5m, 20m)),
            P2Week("Week 3", exerciseId, N6aStepSet(1, 2.5m, 20m)),
            P2Week("Week 4", exerciseId, N6aStepSet(1, 2.5m, 20m)),
        ]);
        var block = await P2AssignAsync(coach, scenario, []);
        var workout = await N6bTrainTodayAsync(client, true, new N6bLog(10, 22.5m));

        // 14 days on, week 2 missed: last time is exactly 14 days old, still within line (b), and week 3's session, today,
        // steps from it.
        RequiredTestClock.Advance(TimeSpan.FromDays(14));
        var week3 = N6bSession(block, 3);
        var within = N6bAnswer(await N6bStandingsAsync(coach, scenario.ClientId, [block.Id], workout), scenario.Exercise.Id);
        N6bAssertComing(within, block.Id, week3, today.AddDays(14));
        N6bAssertAnswer(
            within,
            LiftStandingOutcome.StepUp,
            N6bReason(LiftStandingReason.EverySetDone, today),
            today.AddDays(14),
            N6bSet(N6bSets(week3)[0].Id, 1, SetStandingMove.StepUp, 25m, 20m, 2.5m));

        // A day later it is 15 days old: week 4's coming session keeps its own 20 kg and names the day and the workout last
        // done.
        RequiredTestClock.Advance(TimeSpan.FromDays(1));
        var week4 = N6bSession(block, 4);
        var stale = N6bAnswer(await N6bStandingsAsync(coach, scenario.ClientId, [block.Id], workout), scenario.Exercise.Id);
        N6bAssertComing(stale, block.Id, week4, today.AddDays(21));
        N6bAssertAnswer(
            stale,
            LiftStandingOutcome.Hold,
            N6bReason(LiftStandingReason.LastDoneTooLongAgo, today, workout: workout),
            today.AddDays(15),
            N6bSet(N6bSets(week4)[0].Id, 1, SetStandingMove.Unchanged, 20m, 20m, 2.5m));
        Assert.IsNull(stale.Standing.LastTime);

        // Once the eight-week plan has run out, the coach's training reads are closed (TRN-023) and none says anything.
        RequiredTestClock.Advance(TimeSpan.FromDays(42));
        await N6bAssertClosedAsync(coach, scenario.ClientId, block.Id, workout, "Expired");
    }

    [TestMethod]
    public async Task N6bASwappedAndRenamedComingSessionStillReadsLastTime()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "n6b-swap", exerciseId =>
        [
            P2Week("Week 1", exerciseId, N6aStepSet(1, 2m, 20m)),
            P2Week("Week 2", exerciseId, N6aStepSet(1, 2m, 20m)),
        ]);
        var block = await P2AssignAsync(coach, scenario, []);
        var workout = await N6bTrainTodayAsync(client, true, new N6bLog(10, 20m));

        // The coach swaps week 2's session for one named "Lower A", as a saved session is put in its place, and renames the
        // program. Neither write's answer says where the lifts stand: that rides the block's read alone.
        var program = await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id));
        var target = N6bSession(program, 2);
        await RefreshCsrfAsync(coach);
        var swapped = await coach.PutAsJsonAsync(
            $"/api/training/mesocycles/{block.Id}/sessions/{target.Id}",
            new ReplaceTrainingSessionRequest(P3bRequest(target) with { Name = "Lower A", DayOffset = 3 }, program.Version),
            SliceReadJson);
        await AssertStatusAsync(swapped, HttpStatusCode.OK);
        var afterSwap = await ReadSlicePayloadAsync<TrainingMesocycleView>(swapped);
        Assert.IsNull(afterSwap.LiftStandings, "A write's answer never says where the lifts stand.");
        await RefreshCsrfAsync(coach);
        var renamed = await coach.PutAsJsonAsync(
            $"/api/training/mesocycles/{block.Id}/name",
            new RenameMesocycleRequest("Strength block", afterSwap.Version));
        await AssertStatusAsync(renamed, HttpStatusCode.OK);
        Assert.IsNull(
            (await ReadSlicePayloadAsync<TrainingMesocycleView>(renamed)).LiftStandings,
            "A write's answer never says where the lifts stand.");

        // Last time was "Week 1 squat" and the coming session is "Lower A": the lift carries on from last time (line d).
        var current = await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id));
        var week2 = N6bSession(current, 2);
        Assert.AreEqual((target.Id, "Lower A", "Strength block"), (week2.Id, week2.Name, current.Name));
        var stepped = N6bAnswer(await N6bStandingsAsync(coach, scenario.ClientId, [block.Id], workout), scenario.Exercise.Id);
        N6bAssertComing(stepped, block.Id, week2, today.AddDays(7));
        N6bAssertAnswer(
            stepped,
            LiftStandingOutcome.StepUp,
            N6bReason(LiftStandingReason.EverySetDone, today),
            today,
            N6bSet(N6bSets(week2)[0].Id, 1, SetStandingMove.StepUp, 22m, 20m, 2m));
        N6bAssertLastTime(stepped, workout, today, N6bLogged(1, 10, 20m, 10, 20m));
    }

    [TestMethod]
    public async Task N6bANewProgramCarriesOnFromLastTimesWeightAndEachReadKeepsItsOwnAnswers()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "n6b-carry", exerciseId =>
        [
            P2Week("Week 1", exerciseId, N6aStepSet(1, 2.5m, 15m), N6aStepSet(2, 2.5m, 15m)),
        ]);
        var squat = scenario.Exercise.Id;
        var curl = await CreateExerciseAsync(coach, "Seated leg curl", [], []);
        // The next program starts the squat again from 5 kg, beside a leg curl the client has never done.
        var nextProgram = await PublishProgramAsync(coach, N6aProgram(
            "n6b carry next",
            N6bWeek(
                "Week 1",
                "Lower A",
                N6bLift(squat, 1, N6aStepSet(1, 2.5m, 5m), N6aStepSet(2, 2.5m, 5m)),
                N6bLift(curl.Id, 2, N6aStepSet(1, 1m, 10m)))));
        var first = await P2AssignAsync(coach, scenario, []);
        var next = await N6bAssignAsync(coach, scenario, nextProgram, today.AddDays(7));
        var nextSession = N6bSession(next, 1);

        // Before anything is done, each lift's coming session is its first open one: the squat's in the first program, the
        // leg curl's in the next. Each block's read carries only its own, so the next one says nothing of the squat yet.
        var before = await N6bStandingsAsync(coach, scenario.ClientId, [first.Id, next.Id]);
        Assert.HasCount(2, before);
        N6bAssertComing(N6bAnswer(before, squat), first.Id, N6bSession(first, 1), today);
        N6bAssertComing(N6bAnswer(before, curl.Id), next.Id, nextSession, today.AddDays(7), exercise: 1);
        Assert.AreEqual(
            (LiftStandingReason.NeverDone, LiftStandingReason.NeverDone),
            (N6bAnswer(before, squat).Standing.Reason.Kind, N6bAnswer(before, curl.Id).Standing.Reason.Kind));

        // The client lifts 15 kg for 10 twice. The squat's coming session is now the next program's: it carries on from
        // 15 kg plus the step, never the new program's 5 kg (line d, decision 22).
        var workout = await N6bTrainTodayAsync(client, true, new N6bLog(10, 15m), new N6bLog(10, 15m));
        var after = await N6bStandingsAsync(coach, scenario.ClientId, [first.Id, next.Id], workout);
        Assert.HasCount(2, after);
        var squatSets = N6bSets(nextSession);
        var carried = N6bAnswer(after, squat);
        N6bAssertComing(carried, next.Id, nextSession, today.AddDays(7));
        N6bAssertAnswer(
            carried,
            LiftStandingOutcome.StepUp,
            N6bReason(LiftStandingReason.EverySetDone, today),
            today,
            N6bSet(squatSets[0].Id, 1, SetStandingMove.StepUp, 17.5m, 5m, 2.5m),
            N6bSet(squatSets[1].Id, 2, SetStandingMove.StepUp, 17.5m, 5m, 2.5m));
        N6bAssertLastTime(carried, workout, today, N6bLogged(1, 10, 15m, 10, 15m), N6bLogged(2, 10, 15m, 10, 15m));

        // The leg curl is still never done and keeps its own 10 kg.
        var fresh = N6bAnswer(after, curl.Id);
        N6bAssertComing(fresh, next.Id, nextSession, today.AddDays(7), exercise: 1);
        N6bAssertAnswer(
            fresh,
            LiftStandingOutcome.Hold,
            N6bReason(LiftStandingReason.NeverDone),
            today,
            N6bSet(N6bSets(nextSession, 1)[0].Id, 1, SetStandingMove.Unchanged, 10m, 10m, 1m));

        // The first block has nothing coming, and the logged workout's read names only the lift done in it.
        Assert.IsEmpty((await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(first.Id))).LiftStandings!);
        var detail = await ReadSliceAsync<CoachWorkoutDetailResult>(coach, N6bWorkoutUrl(scenario.ClientId, workout));
        Assert.AreEqual(squat, detail.LiftStandings!.Single().ExerciseId);
    }

    [TestMethod]
    public async Task N6bANewProgramReadsLastTimesTypedWeightSetsShortHarderOrDone()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        using var client = CreateClient();
        // Three weeks of two typed 15 kg sets of 10 at RPE 8, then a program that steps the same lift, with no starting
        // weight.
        var scenario = await P2CustomStartAsync(coach, client, "n6b-typed", exerciseId =>
        [
            P2Week("Week 1", exerciseId, N6bTypedSet(1), N6bTypedSet(2)),
            P2Week("Week 2", exerciseId, N6bTypedSet(1), N6bTypedSet(2)),
            P2Week("Week 3", exerciseId, N6bTypedSet(1), N6bTypedSet(2)),
        ]);
        var stepping = await PublishProgramAsync(coach, N6aProgram(
            "n6b typed next",
            P2Week("Week 1", scenario.Exercise.Id, N6aStepSet(1, 2.5m), N6aStepSet(2, 2.5m))));
        var first = await P2AssignAsync(coach, scenario, []);
        var next = await N6bAssignAsync(coach, scenario, stepping, today.AddDays(21));
        var session = N6bSession(next, 1);
        var sets = N6bSets(session);

        // Set 2 reached 9 of 10: line (a) reads every set of last time, typed weights included, and holds at their 15 kg.
        var shortOne = await N6bTrainTodayAsync(client, true, new N6bLog(10, 15m, 8m), new N6bLog(9, 15m, 8m));
        var held = N6bAnswer(
            await N6bStandingsAsync(coach, scenario.ClientId, [first.Id, next.Id], shortOne), scenario.Exercise.Id);
        N6bAssertComing(held, next.Id, session, today.AddDays(21));
        N6bAssertAnswer(
            held,
            LiftStandingOutcome.Hold,
            N6bReason(LiftStandingReason.RepsShort, today, set: 2, reps: 9, asked: 10),
            today,
            N6bSet(sets[0].Id, 1, SetStandingMove.SameAsLastTime, 15m, null, 2.5m),
            N6bSet(sets[1].Id, 2, SetStandingMove.SameAsLastTime, 15m, null, 2.5m));
        N6bAssertLastTime(
            held, shortOne, today, N6bLogged(1, 10, 15m, 10, 15m, 8m, 8m), N6bLogged(2, 10, 15m, 9, 15m, 8m, 8m));

        // A week on every set reached its reps, but set 1 felt harder than its target: that holds too (line c).
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        var hard = await N6bTrainTodayAsync(client, true, new N6bLog(10, 15m, 9m), new N6bLog(10, 15m, 8m));
        var harder = N6bAnswer(
            await N6bStandingsAsync(coach, scenario.ClientId, [first.Id, next.Id], hard), scenario.Exercise.Id);
        N6bAssertAnswer(
            harder,
            LiftStandingOutcome.Hold,
            N6bReason(LiftStandingReason.HarderThanPlanned, today.AddDays(7), set: 1, rpe: 9m, target: 8m),
            today.AddDays(7),
            N6bSet(sets[0].Id, 1, SetStandingMove.SameAsLastTime, 15m, null, 2.5m),
            N6bSet(sets[1].Id, 2, SetStandingMove.SameAsLastTime, 15m, null, 2.5m));

        // Another week on every set is done at 17.5 kg, at or under its target: the new program's sets step from it.
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        var done = await N6bTrainTodayAsync(client, true, new N6bLog(10, 17.5m, 8m), new N6bLog(10, 17.5m, 7.5m));
        var stepped = N6bAnswer(
            await N6bStandingsAsync(coach, scenario.ClientId, [first.Id, next.Id], done), scenario.Exercise.Id);
        N6bAssertComing(stepped, next.Id, session, today.AddDays(21));
        N6bAssertAnswer(
            stepped,
            LiftStandingOutcome.StepUp,
            N6bReason(LiftStandingReason.EverySetDone, today.AddDays(14)),
            today.AddDays(14),
            N6bSet(sets[0].Id, 1, SetStandingMove.StepUp, 20m, null, 2.5m),
            N6bSet(sets[1].Id, 2, SetStandingMove.StepUp, 20m, null, 2.5m));
    }

    [TestMethod]
    public async Task N6bAForgottenFinishHoldsNamingThatWorkoutsDayAndTheClientsOwnReadsCarryNoStanding()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "n6b-finish", exerciseId =>
        [
            P2Week("Week 1", exerciseId, N6aStepSet(1, 2m, 20m)),
            P2Week("Week 2", exerciseId, N6aStepSet(1, 2m, 20m)),
            P2Week("Week 3", exerciseId, N6aStepSet(1, 2m, 20m)),
        ]);
        var block = await P2AssignAsync(coach, scenario, []);
        var first = await N6bTrainTodayAsync(client, true, new N6bLog(10, 20m));
        await N6bAssertClientReadsCarryNoStandingAsync(client);

        // A week on, the client logs week 2 at 22 kg and never presses Finish: a workout in progress is not last time
        // (line g), so the lift holds at its own weight and names that workout and its day.
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        var running = await N6bTrainTodayAsync(client, false, new N6bLog(10, 22m));
        var week3 = N6bSession(block, 3);
        var held = N6bAnswer(
            await N6bStandingsAsync(coach, scenario.ClientId, [block.Id], first, running), scenario.Exercise.Id);
        N6bAssertComing(held, block.Id, week3, today.AddDays(14));
        N6bAssertAnswer(
            held,
            LiftStandingOutcome.Hold,
            N6bReason(LiftStandingReason.WorkoutInProgress, today.AddDays(7), workout: running),
            today.AddDays(7),
            N6bSet(N6bSets(week3)[0].Id, 1, SetStandingMove.Unchanged, 20m, 20m, 2m));
        Assert.IsNull(held.Standing.LastTime);

        // The client's own reads, today's holding the step workout still running and history the finished one, carry none.
        var day = await ReadSliceAsync<ClientTrainingDayResult>(client, "/api/training/me/today");
        Assert.AreEqual((WorkoutExecutionStatus?)WorkoutExecutionStatus.InProgress, day.Workouts.Single().Status);
        await N6bAssertClientReadsCarryNoStandingAsync(client);

        // The next day the unfinished workout is offered again; the hold still names it and its day, and the client's reads
        // carry none.
        RequiredTestClock.Advance(TimeSpan.FromDays(1));
        var upcoming = await ReadSliceAsync<ClientTrainingUpcomingView>(client, "/api/training/me/upcoming");
        var unfinished = upcoming.UnfinishedWorkouts.Single().Workout;
        Assert.AreEqual((Guid?)running, unfinished.WorkoutExecutionId);
        Assert.AreEqual(
            (TrainingLoadStrategy?)TrainingLoadStrategy.LastTimeStep, unfinished.Exercises.Single().Sets.Single().LoadStrategy);
        await N6bAssertClientReadsCarryNoStandingAsync(client);
        held = N6bAnswer(await N6bStandingsAsync(coach, scenario.ClientId, [block.Id], running), scenario.Exercise.Id);
        Assert.AreEqual(N6bReason(LiftStandingReason.WorkoutInProgress, today.AddDays(7), workout: running), held.Standing.Reason);

        // Finished late, it is last time: the lift steps from its 22 kg.
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync(
                $"/api/training/me/workouts/{running}/complete", new { version = unfinished.ExecutionVersion }),
            HttpStatusCode.OK);
        var stepped = N6bAnswer(
            await N6bStandingsAsync(coach, scenario.ClientId, [block.Id], first, running), scenario.Exercise.Id);
        N6bAssertComing(stepped, block.Id, week3, today.AddDays(14));
        N6bAssertAnswer(
            stepped,
            LiftStandingOutcome.StepUp,
            N6bReason(LiftStandingReason.EverySetDone, today.AddDays(7)),
            today.AddDays(8),
            N6bSet(N6bSets(week3)[0].Id, 1, SetStandingMove.StepUp, 24m, 20m, 2m));
        N6bAssertLastTime(stepped, running, today.AddDays(7), N6bLogged(1, 10, 20m, 10, 22m));
        await N6bAssertClientReadsCarryNoStandingAsync(client);
    }

    [TestMethod]
    public async Task N6bALiftWrittenTwiceInOneSessionGetsAnAnswerForEachWritingFromItsOwnSets()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        using var client = CreateClient();
        // A top set of 5 from 30 kg stepping 2.5 kg, then the same lift again for two back-off sets of 10 from 20 kg
        // stepping 1 kg.
        var scenario = await P2CustomStartAsync(coach, client, "n6b-twice", exerciseId =>
        [
            N6bTopAndBackOff("Week 1", exerciseId),
            N6bTopAndBackOff("Week 2", exerciseId),
        ]);
        var block = await P2AssignAsync(coach, scenario, []);
        var squat = scenario.Exercise.Id;

        // Never done, each writing has its own answer.
        var week1 = N6bSession(block, 1);
        var never = await N6bStandingsAsync(coach, scenario.ClientId, [block.Id]);
        Assert.HasCount(2, never);
        N6bAssertComing(N6bAnswer(never, squat, 1), block.Id, week1, today, exercise: 0, occurrence: 1);
        N6bAssertComing(N6bAnswer(never, squat, 2), block.Id, week1, today, exercise: 1, occurrence: 2);

        // The top set reached its 5 at 30 kg; the back-off's second set reached 8 of 10 at 20 kg. Matched by order (line f),
        // the top set steps and the back-off holds, never mixed.
        var workout = await N6bTrainLiftsTodayAsync(
            client, true, [[new N6bLog(5, 30m)], [new N6bLog(10, 20m), new N6bLog(8, 20m)]]);
        var week2 = N6bSession(block, 2);
        var answers = await N6bStandingsAsync(coach, scenario.ClientId, [block.Id], workout);
        Assert.HasCount(2, answers);
        var top = N6bAnswer(answers, squat, 1);
        N6bAssertComing(top, block.Id, week2, today.AddDays(7), exercise: 0, occurrence: 1);
        N6bAssertAnswer(
            top,
            LiftStandingOutcome.StepUp,
            N6bReason(LiftStandingReason.EverySetDone, today),
            today,
            N6bSet(N6bSets(week2, 0)[0].Id, 1, SetStandingMove.StepUp, 32.5m, 30m, 2.5m));
        N6bAssertLastTime(top, workout, today, N6bLogged(1, 5, 30m, 5, 30m));
        var backOff = N6bAnswer(answers, squat, 2);
        var backOffSets = N6bSets(week2, 1);
        N6bAssertComing(backOff, block.Id, week2, today.AddDays(7), exercise: 1, occurrence: 2);
        N6bAssertAnswer(
            backOff,
            LiftStandingOutcome.Hold,
            N6bReason(LiftStandingReason.RepsShort, today, set: 2, reps: 8, asked: 10),
            today,
            N6bSet(backOffSets[0].Id, 1, SetStandingMove.SameAsLastTime, 20m, 20m, 1m),
            N6bSet(backOffSets[1].Id, 2, SetStandingMove.SameAsLastTime, 20m, 20m, 1m));
        N6bAssertLastTime(backOff, workout, today, N6bLogged(1, 10, 20m, 10, 20m), N6bLogged(2, 10, 20m, 8, 20m));
    }

    [TestMethod]
    public async Task N6bOnlyTheClientsOwnCoachReadsWhereTheirLiftsStand()
    {
        R61aStartAtMidday();
        using var owner = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(owner, client, "n6b-scope", exerciseId =>
        [
            P2Week("Week 1", exerciseId, N6aStepSet(1, 2m, 20m)),
            P2Week("Week 2", exerciseId, N6aStepSet(1, 2m, 20m)),
        ]);
        var block = await P2AssignAsync(owner, scenario, []);
        var workout = await N6bTrainTodayAsync(client, true, new N6bLog(10, 20m));
        string[] urls = [R34aProgramUrl(scenario.ClientId), P2MesocycleUrl(block.Id), N6bWorkoutUrl(scenario.ClientId, workout)];

        // The owner, who coaches every client, reads the answer on each.
        Assert.HasCount(1, await N6bStandingsAsync(owner, scenario.ClientId, [block.Id], workout));

        // The client is refused the coach's reads.
        foreach (var url in urls)
        {
            await AssertStatusAsync(await client.GetAsync(url), HttpStatusCode.Forbidden);
        }

        // A colleague who does not coach the client finds nothing, as for a client that does not exist (ADR 0026).
        using var colleague = CreateClient();
        await JoinAsCoachAsync(owner, colleague, "n6b-scope-colleague@example.test", "Lina Saad");
        foreach (var url in urls)
        {
            var missing = await colleague.GetAsync(url);
            await AssertStatusAsync(missing, HttpStatusCode.NotFound);
            Assert.DoesNotContain("standing", await missing.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase, url);
        }

        // Another workspace's owner finds nothing in their own and is refused this one; nobody signed out reads it.
        using var stranger = CreateClient();
        await RegisterCoachAsync(stranger, "n6b-scope-stranger@example.test", "Other Owner", "N6b Elsewhere");
        foreach (var url in urls)
        {
            await AssertStatusAsync(await stranger.GetAsync(url), HttpStatusCode.NotFound);
        }

        SetTenant(stranger, scenario.WorkspaceId);
        foreach (var url in urls)
        {
            await AssertStatusAsync(await stranger.GetAsync(url), HttpStatusCode.Forbidden);
        }

        using var anonymous = CreateClient();
        SetTenant(anonymous, scenario.WorkspaceId);
        foreach (var url in urls)
        {
            await AssertStatusAsync(await anonymous.GetAsync(url), HttpStatusCode.Unauthorized);
        }
    }

    [TestMethod]
    public async Task N6bABlockedOrReleasedClientsTrainingReadsCarryNoAnswerWhileTheBlockStillReads()
    {
        R61aStartAtMidday();
        using var owner = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(owner, client, "n6b-closed", exerciseId =>
        [
            P2Week("Week 1", exerciseId, N6aStepSet(1, 2m, 20m)),
            P2Week("Week 2", exerciseId, N6aStepSet(1, 2m, 20m)),
        ]);
        var block = await P2AssignAsync(owner, scenario, []);
        var workout = await N6bTrainTodayAsync(client, true, new N6bLog(10, 20m));
        Assert.HasCount(1, await N6bStandingsAsync(owner, scenario.ClientId, [block.Id], workout));

        // A blocked relationship closes the coach's training reads (TRN-023, ADR 0009): none says where the lift stands.
        await N6bRelationshipAsync(owner, scenario.ClientId, "block");
        await N6bAssertClosedAsync(owner, scenario.ClientId, block.Id, workout, "RelationshipBlocked");

        // Unblocked, the answer is back on each read.
        await N6bRelationshipAsync(owner, scenario.ClientId, "unblock");
        Assert.HasCount(1, await N6bStandingsAsync(owner, scenario.ClientId, [block.Id], workout));

        // Released (ADR 0027), the record is kept, the block still reads as it was, and no read says where the lift stands.
        await ReleaseAsync(owner, scenario.ClientId, "Moved away");
        await N6bAssertClosedAsync(owner, scenario.ClientId, block.Id, workout, null);
    }

    [TestMethod]
    public async Task N6bAnotherClientsProgramAndWorkoutsNeverAnswerForThisClient()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        using var client = CreateClient();
        using var other = CreateClient();
        // Two clients of one coach on the same program from today.
        var scenario = await P2CustomStartAsync(coach, client, "n6b-two", exerciseId =>
        [
            P2Week("Week 1", exerciseId, N6aStepSet(1, 2m, 20m)),
            P2Week("Week 2", exerciseId, N6aStepSet(1, 2m, 20m)),
        ]);
        var block = await P2AssignAsync(coach, scenario, []);
        var otherId = await InviteAndAcceptAsync(coach, other, "n6b-two-other@example.test", newAccount: true);
        var theirs = scenario with
        {
            ClientId = otherId,
            Enrollment = await CreateTrainingEnrollmentAsync(coach, otherId, today, 8),
        };
        var otherBlock = await P2AssignAsync(coach, theirs, []);

        // Only the other client trains today, 20 kg for 10. Their coming session is their own week 2, though this client's
        // week 1, today, comes earlier and is still to come: the coming sessions are read for the client alone.
        var workout = await N6bTrainTodayAsync(other, true, new N6bLog(10, 20m));
        var otherWeek2 = N6bSession(otherBlock, 2);
        var stepped = await N6bStandingsAsync(coach, otherId, [otherBlock.Id], workout);
        Assert.HasCount(1, stepped);
        N6bAssertComing(stepped[0], otherBlock.Id, otherWeek2, today.AddDays(7));
        N6bAssertAnswer(
            stepped[0],
            LiftStandingOutcome.StepUp,
            N6bReason(LiftStandingReason.EverySetDone, today),
            today,
            N6bSet(N6bSets(otherWeek2)[0].Id, 1, SetStandingMove.StepUp, 22m, 20m, 2m));
        N6bAssertLastTime(stepped[0], workout, today, N6bLogged(1, 10, 20m, 10, 20m));

        // This client has done nothing: the other client's workout is never read as theirs, so their own week 1 is never
        // done and keeps its 20 kg.
        var week1 = N6bSession(block, 1);
        var mine = await N6bStandingsAsync(coach, scenario.ClientId, [block.Id]);
        Assert.HasCount(1, mine);
        N6bAssertComing(mine[0], block.Id, week1, today);
        N6bAssertAnswer(
            mine[0],
            LiftStandingOutcome.Hold,
            N6bReason(LiftStandingReason.NeverDone),
            today,
            N6bSet(N6bSets(week1)[0].Id, 1, SetStandingMove.Unchanged, 20m, 20m, 2m));
        Assert.IsNull(mine[0].Standing.LastTime);

        // Nor is the other client's workout read through this client.
        await AssertStatusAsync(await coach.GetAsync(N6bWorkoutUrl(scenario.ClientId, workout)), HttpStatusCode.NotFound);
    }

    [TestMethod]
    public async Task N6bSetsAndWritingsAreCountedByRankAndARangeAsksItsTopReps()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "n6b-ranks", exerciseId =>
        [
            P2Week("Week 1", exerciseId, N6aStepSet(1, 2m, 20m)),
        ]);
        var squat = scenario.Exercise.Id;
        var bench = await CreateExerciseAsync(coach, "Bench press", [], []);
        // The bench press first, then the squat: a typed warm-up, then two step sets of 8 to 10 reps.
        var program = await PublishProgramAsync(coach, N6aProgram(
            "n6b ranks",
            N6bBenchThenSquat("Week 1", bench.Id, squat),
            N6bBenchThenSquat("Week 2", bench.Id, squat),
            N6bBenchThenSquat("Week 3", bench.Id, squat)));
        var block = await N6bAssignAsync(coach, scenario, program, today);

        // The squat is the session's second lift but its first writing of the squat, and its step sets are its sets 2 and 3,
        // the warm-up counted.
        var week1 = N6bSession(block, 1);
        var sets = N6bSets(week1, 1);
        var standings = await N6bStandingsAsync(coach, scenario.ClientId, [block.Id]);
        Assert.HasCount(1, standings);
        var never = N6bAnswer(standings, squat);
        N6bAssertComing(never, block.Id, week1, today, exercise: 1);
        N6bAssertAnswer(
            never,
            LiftStandingOutcome.Hold,
            N6bReason(LiftStandingReason.NeverDone),
            today,
            N6bSet(sets[1].Id, 2, SetStandingMove.Unchanged, 20m, 20m, 2.5m),
            N6bSet(sets[2].Id, 3, SetStandingMove.Unchanged, 20m, 20m, 2.5m));

        // Set 3 reaches 9: within its range, but short of the range's top, the reps that workout asked (line h), so the lift
        // holds at last time's weights.
        var first = await N6bTrainLiftsTodayAsync(
            client, true, [[new N6bLog(5, 40m)], [new N6bLog(5, 10m), new N6bLog(10, 20m), new N6bLog(9, 20m)]]);
        var week2 = N6bSession(block, 2);
        sets = N6bSets(week2, 1);
        var held = N6bAnswer(await N6bStandingsAsync(coach, scenario.ClientId, [block.Id], first), squat);
        N6bAssertComing(held, block.Id, week2, today.AddDays(7), exercise: 1);
        N6bAssertAnswer(
            held,
            LiftStandingOutcome.Hold,
            N6bReason(LiftStandingReason.RepsShort, today, set: 3, reps: 9, asked: 10),
            today,
            N6bSet(sets[1].Id, 2, SetStandingMove.SameAsLastTime, 20m, 20m, 2.5m),
            N6bSet(sets[2].Id, 3, SetStandingMove.SameAsLastTime, 20m, 20m, 2.5m));
        N6bAssertLastTime(
            held,
            first,
            today,
            N6bLoggedWarmUp(1, 5, 10m, 5, 10m),
            N6bLogged(2, 10, 20m, 10, 20m),
            N6bLogged(3, 10, 20m, 9, 20m));

        // A week on both step sets reach 10, and a warm-up short of its 5 holds nothing (line a reads the working sets):
        // each step set steps from its own logged weight.
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        var second = await N6bTrainLiftsTodayAsync(
            client, true, [[new N6bLog(5, 40m)], [new N6bLog(3, 10m), new N6bLog(10, 20m), new N6bLog(10, 20m)]]);
        var week3 = N6bSession(block, 3);
        sets = N6bSets(week3, 1);
        var stepped = N6bAnswer(await N6bStandingsAsync(coach, scenario.ClientId, [block.Id], first, second), squat);
        N6bAssertComing(stepped, block.Id, week3, today.AddDays(14), exercise: 1);
        N6bAssertAnswer(
            stepped,
            LiftStandingOutcome.StepUp,
            N6bReason(LiftStandingReason.EverySetDone, today.AddDays(7)),
            today.AddDays(7),
            N6bSet(sets[1].Id, 2, SetStandingMove.StepUp, 22.5m, 20m, 2.5m),
            N6bSet(sets[2].Id, 3, SetStandingMove.StepUp, 22.5m, 20m, 2.5m));
        N6bAssertLastTime(
            stepped,
            second,
            today.AddDays(7),
            N6bLoggedWarmUp(1, 5, 10m, 3, 10m),
            N6bLogged(2, 10, 20m, 10, 20m),
            N6bLogged(3, 10, 20m, 10, 20m));
    }

    [TestMethod]
    public async Task N6bAWorkoutWhereTheLiftWasSwappedForItsAlternativeIsNeverItsLastTime()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "n6b-swapped", exerciseId =>
        [
            P2Week("Week 1", exerciseId, N6aStepSet(1, 2m, 20m)),
        ]);
        var squat = scenario.Exercise.Id;
        var press = await CreateExerciseAsync(coach, "Leg press", [], []);
        // Four weeks of the squat stepping 2 kg from 20 kg, which the coach lets the client swap for the leg press.
        var program = await PublishProgramAsync(coach, N6aProgram(
            "n6b swapped",
            N6bWeek("Week 1", "Week 1 lower", N6bSwappableLift(squat, 1, press.Id, N6aStepSet(1, 2m, 20m))),
            N6bWeek("Week 2", "Week 2 lower", N6bSwappableLift(squat, 1, press.Id, N6aStepSet(1, 2m, 20m))),
            N6bWeek("Week 3", "Week 3 lower", N6bSwappableLift(squat, 1, press.Id, N6aStepSet(1, 2m, 20m))),
            N6bWeek("Week 4", "Week 4 lower", N6bSwappableLift(squat, 1, press.Id, N6aStepSet(1, 2m, 20m)))));
        var block = await N6bAssignAsync(coach, scenario, program, today);

        // Week 1 the client swaps the squat for the leg press, 30 kg for 10. The squat was not done, so it is never done,
        // and the workout's read answers for no lift: the leg press steps nothing.
        var swapped = await N6bTrainLiftsTodayAsync(client, true, [[new N6bLog(10, 30m)]], [press.Id]);
        var week2 = N6bSession(block, 2);
        var never = N6bAnswer(await N6bStandingsAsync(coach, scenario.ClientId, [block.Id], swapped), squat);
        N6bAssertComing(never, block.Id, week2, today.AddDays(7));
        N6bAssertAnswer(
            never,
            LiftStandingOutcome.Hold,
            N6bReason(LiftStandingReason.NeverDone),
            today,
            N6bSet(N6bSets(week2)[0].Id, 1, SetStandingMove.Unchanged, 20m, 20m, 2m));
        Assert.IsNull(never.Standing.LastTime);
        Assert.IsEmpty(
            (await ReadSliceAsync<CoachWorkoutDetailResult>(coach, N6bWorkoutUrl(scenario.ClientId, swapped))).LiftStandings!);

        // Week 2 the squat is done as written, 20 kg for 10: it steps from there.
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        var done = await N6bTrainTodayAsync(client, true, new N6bLog(10, 20m));
        var week3 = N6bSession(block, 3);
        var stepped = N6bAnswer(await N6bStandingsAsync(coach, scenario.ClientId, [block.Id], done), squat);
        N6bAssertComing(stepped, block.Id, week3, today.AddDays(14));
        N6bAssertAnswer(
            stepped,
            LiftStandingOutcome.StepUp,
            N6bReason(LiftStandingReason.EverySetDone, today.AddDays(7)),
            today.AddDays(7),
            N6bSet(N6bSets(week3)[0].Id, 1, SetStandingMove.StepUp, 22m, 20m, 2m));
        N6bAssertLastTime(stepped, done, today.AddDays(7), N6bLogged(1, 10, 20m, 10, 20m));

        // Week 3 the client swaps again, 21 kg for 10 on the leg press: last time is still week 2's squat, never the later
        // workout that holds the squat's place.
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        var swappedAgain = await N6bTrainLiftsTodayAsync(client, true, [[new N6bLog(10, 21m)]], [press.Id]);
        var week4 = N6bSession(block, 4);
        var still = N6bAnswer(
            await N6bStandingsAsync(coach, scenario.ClientId, [block.Id], swapped, done, swappedAgain), squat);
        N6bAssertComing(still, block.Id, week4, today.AddDays(21));
        N6bAssertAnswer(
            still,
            LiftStandingOutcome.StepUp,
            N6bReason(LiftStandingReason.EverySetDone, today.AddDays(7)),
            today.AddDays(14),
            N6bSet(N6bSets(week4)[0].Id, 1, SetStandingMove.StepUp, 22m, 20m, 2m));
        N6bAssertLastTime(still, done, today.AddDays(7), N6bLogged(1, 10, 20m, 10, 20m));
        Assert.IsEmpty(
            (await ReadSliceAsync<CoachWorkoutDetailResult>(coach, N6bWorkoutUrl(scenario.ClientId, swappedAgain))).LiftStandings!);
    }

    [TestMethod]
    public async Task N6bASwappedFirstWritingKeepsItsPlaceSoTheSecondIsMatchedOnlyToTheSecond()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "n6b-swapped-top", exerciseId =>
        [
            P2Week("Week 1", exerciseId, N6aStepSet(1, 2m, 20m)),
        ]);
        var squat = scenario.Exercise.Id;
        var press = await CreateExerciseAsync(coach, "Leg press", [], []);
        // A top set of 5 from 30 kg, which the client may swap for the leg press, then the back-off sets of 10 from 20 kg.
        var program = await PublishProgramAsync(coach, N6aProgram(
            "n6b swapped top",
            N6bSwappableTopAndBackOff("Week 1", squat, press.Id),
            N6bSwappableTopAndBackOff("Week 2", squat, press.Id)));
        var block = await N6bAssignAsync(coach, scenario, program, today);

        // The client swaps the top set for the leg press, 40 kg for 5, and does the back-off as written, 20 kg for 10 twice.
        var workout = await N6bTrainLiftsTodayAsync(
            client, true, [[new N6bLog(5, 40m)], [new N6bLog(10, 20m), new N6bLog(10, 20m)]], [press.Id, null]);
        var week2 = N6bSession(block, 2);
        var answers = await N6bStandingsAsync(coach, scenario.ClientId, [block.Id], workout);
        Assert.HasCount(2, answers);

        // The swapped writing still holds its place, so last time had no first writing of the squat done: the top set keeps
        // its own 30 kg (line f), reading neither the back-off nor the leg press.
        var top = N6bAnswer(answers, squat, 1);
        N6bAssertComing(top, block.Id, week2, today.AddDays(7), exercise: 0, occurrence: 1);
        N6bAssertAnswer(
            top,
            LiftStandingOutcome.Hold,
            N6bReason(LiftStandingReason.NoMatchLastTime, today),
            today,
            N6bSet(N6bSets(week2, 0)[0].Id, 1, SetStandingMove.Unchanged, 30m, 30m, 2.5m));
        Assert.IsNull(top.Standing.LastTime);

        // The back-off, last time's second writing, is matched to the coming second writing and steps from its own sets.
        var backOff = N6bAnswer(answers, squat, 2);
        var backOffSets = N6bSets(week2, 1);
        N6bAssertComing(backOff, block.Id, week2, today.AddDays(7), exercise: 1, occurrence: 2);
        N6bAssertAnswer(
            backOff,
            LiftStandingOutcome.StepUp,
            N6bReason(LiftStandingReason.EverySetDone, today),
            today,
            N6bSet(backOffSets[0].Id, 1, SetStandingMove.StepUp, 21m, 20m, 1m),
            N6bSet(backOffSets[1].Id, 2, SetStandingMove.StepUp, 21m, 20m, 1m));
        N6bAssertLastTime(backOff, workout, today, N6bLogged(1, 10, 20m, 10, 20m), N6bLogged(2, 10, 20m, 10, 20m));
    }

    [TestMethod]
    public async Task N6bACancelledBlockAnswersForNothingAndTheNextProgramCarriesOnFromItsWorkout()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "n6b-cancel", exerciseId =>
        [
            P2Week("Week 1", exerciseId, N6aStepSet(1, 2m, 20m)),
            P2Week("Week 2", exerciseId, N6aStepSet(1, 2m, 20m)),
            P2Week("Week 3", exerciseId, N6aStepSet(1, 2m, 20m)),
        ]);
        var squat = scenario.Exercise.Id;
        var block = await P2AssignAsync(coach, scenario, []);
        var workout = await N6bTrainTodayAsync(client, true, new N6bLog(10, 20m));
        var open = await N6bStandingsAsync(coach, scenario.ClientId, [block.Id], workout);
        Assert.HasCount(1, open);
        N6bAssertComing(open[0], block.Id, N6bSession(block, 2), today.AddDays(7));

        // The coach cancels the program with weeks 2 and 3 still to come: no read answers for it any more, though the
        // client's training reads stay open.
        var version = (await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id))).Version;
        await RefreshCsrfAsync(coach);
        var cancel = await coach.PostAsJsonAsync(
            $"/api/training/mesocycles/{block.Id}/cancel", new { reason = "Changed the plan", version });
        await AssertStatusAsync(cancel, HttpStatusCode.OK);
        var cancelled = await ReadSlicePayloadAsync<TrainingMesocycleView>(cancel);
        Assert.AreEqual(MesocycleStatus.Cancelled, cancelled.Status);
        Assert.IsNull(cancelled.LiftStandings, "A write's answer never says where the lifts stand.");
        Assert.IsEmpty(await N6bStandingsAsync(coach, scenario.ClientId, [block.Id], workout));

        // A new program from next week writes the squat again from 10 kg. Its session is the coming one, beside the
        // cancelled week 2 on the same day, and it carries on from the cancelled program's workout (line d).
        var nextProgram = await PublishProgramAsync(coach, N6aProgram(
            "n6b cancel next", P2Week("Week 1", squat, N6aStepSet(1, 2m, 10m))));
        var next = await N6bAssignAsync(coach, scenario, nextProgram, today.AddDays(7));
        var session = N6bSession(next, 1);
        var carried = await N6bStandingsAsync(coach, scenario.ClientId, [block.Id, next.Id], workout);
        Assert.HasCount(1, carried);
        N6bAssertComing(carried[0], next.Id, session, today.AddDays(7));
        N6bAssertAnswer(
            carried[0],
            LiftStandingOutcome.StepUp,
            N6bReason(LiftStandingReason.EverySetDone, today),
            today,
            N6bSet(N6bSets(session)[0].Id, 1, SetStandingMove.StepUp, 22m, 10m, 2m));
        N6bAssertLastTime(carried[0], workout, today, N6bLogged(1, 10, 20m, 10, 20m));
    }

    [TestMethod]
    public async Task N6bASetLoggedInPoundsOnAKilogramStepSetHoldsTheLiftNamingThatSet()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "n6b-pounds", exerciseId =>
        [
            P2Week("Week 1", exerciseId, N6aStepSet(1, 2m, 20m), N6aStepSet(2, 2m, 20m)),
            P2Week("Week 2", exerciseId, N6aStepSet(1, 2m, 20m), N6aStepSet(2, 2m, 20m)),
        ]);
        var block = await P2AssignAsync(coach, scenario, []);

        // Set 2 of a kilogram lift is logged as 45 lb: it counts for nothing, nothing is converted, and the lift holds at
        // its own weights, naming the set and the unit it was logged in.
        var workout = await N6bTrainTodayAsync(client, true, new N6bLog(10, 20m), new N6bLog(10, 45m, Unit: "Pound"));
        var week2 = N6bSession(block, 2);
        var sets = N6bSets(week2);
        var held = N6bAnswer(await N6bStandingsAsync(coach, scenario.ClientId, [block.Id], workout), scenario.Exercise.Id);
        N6bAssertComing(held, block.Id, week2, today.AddDays(7));
        N6bAssertAnswer(
            held,
            LiftStandingOutcome.Hold,
            N6bReason(LiftStandingReason.LoggedInOtherUnit, today, set: 2, weight: 45m, unit: TrainingLoadUnit.Pound),
            today,
            N6bSet(sets[0].Id, 1, SetStandingMove.Unchanged, 20m, 20m, 2m),
            N6bSet(sets[1].Id, 2, SetStandingMove.Unchanged, 20m, 20m, 2m));
        N6bAssertLastTime(
            held,
            workout,
            today,
            N6bLogged(1, 10, 20m, 10, 20m),
            new LoggedSet(
                2, TrainingSetType.Normal, 10, null, 20m, TrainingLoadUnit.Kilogram, true, 10, 45m, TrainingLoadUnit.Pound, null));
    }

    [TestMethod]
    public async Task N6bAStepSetWrittenInRirSaysSoWhileItsEffortsStayOnTheRpeScale()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        using var client = CreateClient();
        // A typed warm-up written in RPE, then a step set of 10 from 20 kg at 2 reps in reserve, written in RIR.
        var scenario = await P2CustomStartAsync(coach, client, "n6b-rir", exerciseId =>
        [
            P2Week("Week 1", exerciseId, N6bWarmUpSet(), N6bStepSet(2, 2.5m, 20m, 10, 10, targetRir: 2m)),
            P2Week("Week 2", exerciseId, N6bWarmUpSet(), N6bStepSet(2, 2.5m, 20m, 10, 10, targetRir: 2m)),
        ]);
        var block = await P2AssignAsync(coach, scenario, []);
        var week1 = N6bSession(block, 1);
        var sets = N6bSets(week1);
        // The block keeps the step set's target as RPE 8 and shows it as 2 in reserve.
        Assert.AreEqual(
            (ExertionDisplayPreference.Rpe, ExertionDisplayPreference.Rir, (decimal?)8m, (decimal?)2m),
            (sets[0].ExertionDisplayPreference, sets[1].ExertionDisplayPreference, sets[1].TargetRpe, sets[1].TargetRir));
        var never = N6bAnswer(await N6bStandingsAsync(coach, scenario.ClientId, [block.Id]), scenario.Exercise.Id);
        N6bAssertComing(never, block.Id, week1, today, exertion: ExertionDisplayPreference.Rir);
        N6bAssertAnswer(
            never,
            LiftStandingOutcome.Hold,
            N6bReason(LiftStandingReason.NeverDone),
            today,
            N6bSet(sets[1].Id, 2, SetStandingMove.Unchanged, 20m, 20m, 2.5m));

        // The client logs 1 rep in reserve, RPE 9, harder than the target's RPE 8: the hold names both on the RPE scale
        // (line c), and the answer says the coach wrote the set in RIR, for the screen to say it so.
        var workout = await N6bTrainTodayAsync(client, true, new N6bLog(5, 10m), new N6bLog(10, 20m, Rir: 1m));
        var week2 = N6bSession(block, 2);
        sets = N6bSets(week2);
        var held = N6bAnswer(await N6bStandingsAsync(coach, scenario.ClientId, [block.Id], workout), scenario.Exercise.Id);
        N6bAssertComing(held, block.Id, week2, today.AddDays(7), exertion: ExertionDisplayPreference.Rir);
        N6bAssertAnswer(
            held,
            LiftStandingOutcome.Hold,
            N6bReason(LiftStandingReason.HarderThanPlanned, today, set: 2, rpe: 9m, target: 8m),
            today,
            N6bSet(sets[1].Id, 2, SetStandingMove.SameAsLastTime, 20m, 20m, 2.5m));
        N6bAssertLastTime(
            held, workout, today, N6bLoggedWarmUp(1, 5, 10m, 5, 10m), N6bLogged(2, 10, 20m, 10, 20m, target: 8m, rpe: 9m));
    }

    [TestMethod]
    public async Task N6bJustAfterMidnightInTheWorkspacesZoneTheComingSessionAndItsDayAreThatZones()
    {
        // No whole day is stepped here: each instant is set in Beirut's own time, so a clock change never moves the day.
        var today = TenantToday();
        RequiredTestClock.Set(N6bBeirutInstant(today.AddDays(-1), new TimeOnly(23, 30)));
        using var coach = CreateClient();
        using var client = CreateClient();
        // Half an hour before midnight, the evening before today, the coach gives the client a program from that day: a
        // session that day and one the next, today.
        await RegisterCoachAsync(coach, "n6b-midnight@example.test", "P2 Coach", "n6b-midnight Gym");
        var clientId = await InviteAndAcceptAsync(coach, client, "n6b-midnight-client@example.test", newAccount: true);
        var enrollment = await CreateTrainingEnrollmentAsync(coach, clientId, today.AddDays(-1), 8);
        var squat = await CreateExerciseAsync(coach, "Competition squat", [], []);
        var program = await PublishProgramAsync(coach, N6aProgram(
            "n6b midnight",
            N6bWeekOfDays(
                "Week 1",
                N6bDay("Day 1 squat", 0, N6bLift(squat.Id, 1, N6aStepSet(1, 2m, 20m))),
                N6bDay("Day 2 squat", 1, N6bLift(squat.Id, 1, N6aStepSet(1, 2m, 20m))))));
        var block = await N6bAssignAsync(coach, clientId, enrollment.Id, program, today.AddDays(-1));
        var days = block.Weeks.Single(week => week.WeekNumber == 1).Sessions.OrderBy(session => session.DayOffset).ToArray();
        Assert.HasCount(2, days);

        // That evening the first session is the coming one, judged on its day.
        var evening = await N6bStandingsAsync(coach, clientId, [block.Id]);
        Assert.HasCount(1, evening);
        N6bAssertComing(evening[0], block.Id, days[0], today.AddDays(-1));
        N6bAssertAnswer(
            evening[0],
            LiftStandingOutcome.Hold,
            N6bReason(LiftStandingReason.NeverDone),
            today.AddDays(-1),
            N6bSet(N6bSets(days[0])[0].Id, 1, SetStandingMove.Unchanged, 20m, 20m, 2m));

        // An hour later it is half past midnight in Beirut and still the day before in UTC: yesterday's session has passed,
        // today's is the coming one, and the answer is judged on Beirut's day.
        RequiredTestClock.Set(N6bBeirutInstant(today, new TimeOnly(0, 30)));
        Assert.AreEqual(
            today.AddDays(-1),
            DateOnly.FromDateTime(RequiredTestClock.UtcNow.UtcDateTime),
            "Half past midnight in Beirut is still the day before in UTC.");
        var night = await N6bStandingsAsync(coach, clientId, [block.Id]);
        Assert.HasCount(1, night);
        N6bAssertComing(night[0], block.Id, days[1], today);
        N6bAssertAnswer(
            night[0],
            LiftStandingOutcome.Hold,
            N6bReason(LiftStandingReason.NeverDone),
            today,
            N6bSet(N6bSets(days[1])[0].Id, 1, SetStandingMove.Unchanged, 20m, 20m, 2m));
    }

    // ----- helpers -----

    /// <summary>
    /// One set as the client logs it, in kilograms unless another unit is given; null reps is a set logged with the reps
    /// box left empty, and an effort is typed as RPE or as reps in reserve.
    /// </summary>
    private sealed record N6bLog(int? Reps, decimal Load, decimal? Rpe = null, string Unit = "Kilogram", decimal? Rir = null);

    private static string N6bWorkoutUrl(Guid clientId, Guid workoutId) =>
        $"/api/training/clients/{clientId}/workouts/{workoutId}";

    /// <summary>A typed 15 kg set of 10 at RPE 8.</summary>
    private static object N6bTypedSet(int position) => P1Set(position, "Direct", rpe: 8m, reps: 10, direct: 15m);

    /// <summary>A week of one session holding the given lifts, as the builder sends it.</summary>
    private static object N6bWeek(string label, string session, params object[] lifts) => new
    {
        label,
        isPublished = true,
        sessions = new[] { new { name = session, dayOffset = 0, coachNotes = (string?)null, exercises = lifts } },
    };

    /// <summary>One lift of a session, at its place, with its sets.</summary>
    private static object N6bLift(Guid exerciseId, int position, params object[] sets) => new
    {
        exerciseId,
        position,
        isMainLift = false,
        modificationPolicy = "CoachApprovedSwap",
        coachNotes = (string?)null,
        approvedAlternativeExerciseIds = Array.Empty<Guid>(),
        sets,
    };

    /// <summary>A top set of 5 from 30 kg stepping 2.5 kg, then the same lift for two back-off sets of 10 from 20 kg stepping 1 kg.</summary>
    private static object N6bTopAndBackOff(string label, Guid exerciseId) =>
        N6bWeek(
            label,
            $"{label} lower",
            N6bLift(exerciseId, 1, N6aStepSet(1, 2.5m, 30m, reps: 5)),
            N6bLift(exerciseId, 2, N6aStepSet(1, 1m, 20m), N6aStepSet(2, 1m, 20m)));

    /// <summary>The same top set and back-off, the top set a writing the client may swap for the alternative.</summary>
    private static object N6bSwappableTopAndBackOff(string label, Guid exerciseId, Guid alternativeId) =>
        N6bWeek(
            label,
            $"{label} lower",
            N6bSwappableLift(exerciseId, 1, alternativeId, N6aStepSet(1, 2.5m, 30m, reps: 5)),
            N6bLift(exerciseId, 2, N6aStepSet(1, 1m, 20m), N6aStepSet(2, 1m, 20m)));

    /// <summary>One lift of a session, at its place, which the coach lets the client swap for the alternative.</summary>
    private static object N6bSwappableLift(Guid exerciseId, int position, Guid alternativeId, params object[] sets) => new
    {
        exerciseId,
        position,
        isMainLift = false,
        modificationPolicy = "CoachApprovedSwap",
        coachNotes = (string?)null,
        approvedAlternativeExerciseIds = new[] { alternativeId },
        sets,
    };

    /// <summary>A week of the given sessions, as the builder sends it.</summary>
    private static object N6bWeekOfDays(string label, params object[] sessions) => new { label, isPublished = true, sessions };

    /// <summary>One session on its day of the week (0 for the first), holding the given lifts.</summary>
    private static object N6bDay(string name, int dayOffset, params object[] lifts) =>
        new { name, dayOffset, coachNotes = (string?)null, exercises = lifts };

    /// <summary>
    /// A last time + step set in kilograms from a starting weight, with a range of reps; given a target in reps in reserve,
    /// the coach writes its effort as RIR.
    /// </summary>
    private static object N6bStepSet(
        int position,
        decimal step,
        decimal start,
        int minimum,
        int maximum,
        decimal? targetRir = null) => new
        {
            position,
            setType = "Normal",
            repetitionsMinimum = minimum,
            repetitionsMaximum = maximum,
            loadStrategy = "LastTimeStep",
            directLoad = (decimal?)start,
            loadUnit = "Kilogram",
            percentageWorkingMax = (decimal?)null,
            loadStep = (decimal?)step,
            targetRpe = (decimal?)null,
            targetRir,
            exertionDisplayPreference = targetRir is null ? "Rpe" : "Rir",
            restSeconds = (int?)90,
            tempo = (string?)null,
            coachNotes = (string?)null,
            manualLoadOverride = (decimal?)null,
        };

    /// <summary>A typed 10 kg warm-up of 5, its effort written as RPE, as the first set of a lift.</summary>
    private static object N6bWarmUpSet() => P1Set(1, "Direct", rpe: null, direct: 10m, setType: "WarmUp");

    /// <summary>
    /// A session of the bench press, a typed 40 kg set of 5, then the squat: a typed 10 kg warm-up of 5, then two step sets
    /// of 8 to 10 reps from 20 kg stepping 2.5 kg.
    /// </summary>
    private static object N6bBenchThenSquat(string label, Guid benchId, Guid squatId) =>
        N6bWeek(
            label,
            $"{label} full body",
            N6bLift(benchId, 1, P1Set(1, "Direct", rpe: null, direct: 40m)),
            N6bLift(squatId, 2, N6bWarmUpSet(), N6bStepSet(2, 2.5m, 20m, 8, 10), N6bStepSet(3, 2.5m, 20m, 8, 10)));

    /// <summary>The instant <paramref name="time"/> strikes on <paramref name="day"/> in the workspace's zone, Asia/Beirut, in UTC.</summary>
    private static DateTimeOffset N6bBeirutInstant(DateOnly day, TimeOnly time)
    {
        var local = day.ToDateTime(time);
        return new DateTimeOffset(local, TimeZoneInfo.FindSystemTimeZoneById("Asia/Beirut").GetUtcOffset(local))
            .ToUniversalTime();
    }

    /// <summary>Assigns a program from the given day with no training max, which a step set never needs.</summary>
    private static Task<TrainingMesocycleView> N6bAssignAsync(
        HttpClient coach,
        P2Custom scenario,
        TemplateVersion template,
        DateOnly startDate) =>
        N6bAssignAsync(coach, scenario.ClientId, scenario.Enrollment.Id, template, startDate);

    /// <summary>Assigns a program to the client on the plan from the given day, with no training max.</summary>
    private static async Task<TrainingMesocycleView> N6bAssignAsync(
        HttpClient coach,
        Guid clientId,
        Guid enrollmentId,
        TemplateVersion template,
        DateOnly startDate)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync($"/api/training/clients/{clientId}/mesocycles", new
        {
            enrollmentId,
            templateVersionId = template.Id,
            startDate,
            kind = "Primary",
            loadUnit = "Kilogram",
            loadIncrement = 2.5m,
            loadRoundingMode = "Nearest",
            workingMaxes = Array.Empty<object>(),
            idempotencyKey = Guid.NewGuid(),
        });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        var block = await ReadSlicePayloadAsync<TrainingMesocycleView>(response);
        Assert.IsNull(block.LiftStandings, "A write's answer never says where the lifts stand.");
        return block;
    }

    private static TrainingSessionView N6bSession(TrainingMesocycleView block, int weekNumber) =>
        block.Weeks.Single(week => week.WeekNumber == weekNumber).Sessions.Single();

    /// <summary>The sets of the session's <paramref name="exercise"/>th lift (0 for the first), in order.</summary>
    private static SetPrescriptionView[] N6bSets(TrainingSessionView session, int exercise = 0) =>
        [.. session.Exercises.OrderBy(item => item.Position).ElementAt(exercise).Sets.OrderBy(set => set.Position)];

    /// <summary>The client starts today's only session, logs its one lift's sets in order and finishes it unless told not to.</summary>
    private static Task<Guid> N6bTrainTodayAsync(HttpClient client, bool finish, params N6bLog[] sets) =>
        N6bTrainLiftsTodayAsync(client, finish, [sets]);

    /// <summary>
    /// The client starts today's only session, logs each lift's sets in order (the lifts in the session's order) and,
    /// unless told not to, finishes it. A lift given a swap is first swapped for that coach-approved alternative, so its
    /// sets are logged as the alternative's. Returns the workout's id.
    /// </summary>
    private static async Task<Guid> N6bTrainLiftsTodayAsync(
        HttpClient client,
        bool finish,
        N6bLog[][] lifts,
        Guid?[]? swaps = null)
    {
        var day = await ReadSliceAsync<ClientTrainingDayResult>(client, "/api/training/me/today");
        await RefreshCsrfAsync(client);
        var start = await client.PostAsync($"/api/training/me/sessions/{day.Workouts.Single().SessionId}/start", null);
        await AssertStatusAsync(start, HttpStatusCode.OK);
        var workout = await ReadSlicePayloadAsync<WorkoutExecutionView>(start);
        var exercises = (await ReadSliceAsync<ClientTrainingDayResult>(client, "/api/training/me/today")).Workouts.Single().Exercises;
        Assert.HasCount(lifts.Length, exercises);
        var version = workout.Version;
        for (var lift = 0; lift < lifts.Length; lift++)
        {
            if (swaps?[lift] is { } alternative)
            {
                var swapped = await A3SwapAsync(client, workout.Id, exercises[lift].PerformanceId!.Value, alternative, version);
                await AssertStatusAsync(swapped, HttpStatusCode.OK);
                version = (await ReadSlicePayloadAsync<WorkoutExecutionView>(swapped)).Version;
            }

            var sets = exercises[lift].Sets.OrderBy(set => set.Position).ToArray();
            Assert.HasCount(lifts[lift].Length, sets);
            for (var index = 0; index < sets.Length; index++)
            {
                var log = lifts[lift][index];
                await RefreshCsrfAsync(client);
                var saved = await client.PutAsJsonAsync(
                    $"/api/training/me/workouts/{workout.Id}/sets/{sets[index].PerformanceId}",
                    new
                    {
                        repetitions = log.Reps,
                        load = log.Load,
                        loadUnit = log.Unit,
                        rpe = log.Rpe,
                        rir = log.Rir,
                        isCompleted = true,
                        clientNote = (string?)null,
                        version,
                    });
                await AssertStatusAsync(saved, HttpStatusCode.OK);
                version = (await ReadSlicePayloadAsync<WorkoutSetSaveView>(saved)).ExecutionVersion;
            }
        }

        if (finish)
        {
            await RefreshCsrfAsync(client);
            await AssertStatusAsync(
                await client.PostAsJsonAsync($"/api/training/me/workouts/{workout.Id}/complete", new { version }),
                HttpStatusCode.OK);
        }

        return workout.Id;
    }

    /// <summary>
    /// Where the client's lifts stand, as the program read says, after asserting that each block's read carries exactly
    /// the program's answers whose coming session is in that block, and each logged workout's read exactly those for the
    /// lifts done in it: the same answers, word for word.
    /// </summary>
    private static async Task<LiftStandingView[]> N6bStandingsAsync(
        HttpClient coach,
        Guid clientId,
        Guid[] blocks,
        params Guid[] workouts)
    {
        var program = await ReadSliceAsync<CoachClientProgramView>(coach, R34aProgramUrl(clientId));
        Assert.IsTrue(program.IsAllowed, program.AccessReason);
        var all = program.LiftStandings?.ToArray()
            ?? throw new AssertFailedException("An open program read says where the lifts stand.");
        foreach (var blockId in blocks)
        {
            var block = await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(blockId));
            N6bAssertSameAnswers([.. all.Where(item => item.MesocycleId == blockId)], block.LiftStandings, $"block {blockId}");
        }

        foreach (var workoutId in workouts)
        {
            var detail = await ReadSliceAsync<CoachWorkoutDetailResult>(coach, N6bWorkoutUrl(clientId, workoutId));
            Assert.IsTrue(detail.IsAllowed, detail.AccessReason);
            // The lifts done there as the coach wrote them: a swapped writing is not its lift's (STR-019).
            var done = detail.Detail!.Workout.Exercises
                .Where(item => item.ActualExerciseId == item.PrescribedExerciseId)
                .Select(item => item.ActualExerciseId).ToHashSet();
            N6bAssertSameAnswers(
                [.. all.Where(item => done.Contains(item.ExerciseId))], detail.LiftStandings, $"workout {workoutId}");
        }

        return all;
    }

    private static void N6bAssertSameAnswers(LiftStandingView[] expected, IReadOnlyList<LiftStandingView>? actual, string read)
    {
        Assert.IsNotNull(actual, $"The {read} read is open, so it says where the lifts stand.");
        Assert.AreEqual(JsonSerializer.Serialize(expected, SliceReadJson), JsonSerializer.Serialize(actual, SliceReadJson), read);
    }

    private static LiftStandingView N6bAnswer(LiftStandingView[] standings, Guid exerciseId, int occurrence = 1) =>
        standings.Single(item => item.ExerciseId == exerciseId && item.Occurrence == occurrence);

    /// <summary>
    /// Asserts the rule's name and version and which coming writing the answer is for: the block, the session, its day and
    /// name, the session's <paramref name="exercise"/>th lift (0 for the first), its occurrence of the lift there and how
    /// the coach wrote its effort.
    /// </summary>
    private static void N6bAssertComing(
        LiftStandingView answer,
        Guid blockId,
        TrainingSessionView session,
        DateOnly day,
        int exercise = 0,
        int occurrence = 1,
        ExertionDisplayPreference exertion = ExertionDisplayPreference.Rpe)
    {
        var lift = session.Exercises.OrderBy(item => item.Position).ElementAt(exercise);
        Assert.AreEqual((DateOnly?)day, session.ScheduledDate);
        Assert.AreEqual(
            ("LastTimeStep", 1, blockId, session.Id, session.Name, day),
            (answer.RuleKey, answer.RuleVersion, answer.MesocycleId, answer.SessionId, answer.SessionName, answer.SessionDate));
        Assert.AreEqual(
            (lift.Id, lift.ExerciseId, lift.ExerciseName, occurrence, exertion),
            (answer.ExercisePrescriptionId, answer.ExerciseId, answer.ExerciseName, answer.Occurrence, answer.ExertionDisplay));
    }

    /// <summary>Asserts the answer's outcome, its reason with all it names, the day it was judged on and each set's answer.</summary>
    private static void N6bAssertAnswer(
        LiftStandingView answer,
        LiftStandingOutcome outcome,
        LiftStandingReasonDetail reason,
        DateOnly judgedOn,
        params SetStanding[] sets)
    {
        Assert.AreEqual(
            (outcome, reason, judgedOn),
            (answer.Standing.Outcome, answer.Standing.Reason, answer.Standing.JudgedOn));
        CollectionAssert.AreEqual(sets, answer.Standing.Sets.ToArray());
    }

    /// <summary>Asserts the finished workout the answer read as last time, its day, and its writing's sets.</summary>
    private static void N6bAssertLastTime(LiftStandingView answer, Guid workoutId, DateOnly day, params LoggedSet[] sets)
    {
        var lastTime = answer.Standing.LastTime;
        Assert.IsNotNull(lastTime, "The answer read a finished workout as last time.");
        Assert.AreEqual((workoutId, day), (lastTime.WorkoutExecutionId, lastTime.Day));
        CollectionAssert.AreEqual(sets, lastTime.Sets.ToArray());
    }

    private static LiftStandingReasonDetail N6bReason(
        LiftStandingReason kind,
        DateOnly? day = null,
        int? set = null,
        int? reps = null,
        int? asked = null,
        decimal? rpe = null,
        decimal? target = null,
        decimal? weight = null,
        decimal? earlier = null,
        TrainingLoadUnit? unit = null,
        Guid? workout = null) =>
        new(kind, day, set, reps, asked, rpe, target, weight, earlier, unit, workout);

    /// <summary>One coming kilogram step set's answer: the weight it names beside the set's own weight, and its step.</summary>
    private static SetStanding N6bSet(
        Guid setId,
        int number,
        SetStandingMove move,
        decimal? weight,
        decimal? current,
        decimal step,
        SetStandingNote note = SetStandingNote.None) =>
        new(setId, number, move, weight, current, TrainingLoadUnit.Kilogram, step, note);

    /// <summary>One completed kilogram set of last time: what that workout asked and what the client logged.</summary>
    private static LoggedSet N6bLogged(
        int number,
        int asked,
        decimal? prescribed,
        int? reps,
        decimal weight,
        decimal? target = null,
        decimal? rpe = null) =>
        new(number, TrainingSetType.Normal, asked, target, prescribed, TrainingLoadUnit.Kilogram, true, reps, weight,
            TrainingLoadUnit.Kilogram, rpe);

    /// <summary>One completed kilogram warm-up of last time, with no target effort: what that workout asked and what was logged.</summary>
    private static LoggedSet N6bLoggedWarmUp(int number, int asked, decimal prescribed, int reps, decimal weight) =>
        new(number, TrainingSetType.WarmUp, asked, null, prescribed, TrainingLoadUnit.Kilogram, true, reps, weight,
            TrainingLoadUnit.Kilogram, null);

    /// <summary>The owner blocks or unblocks the relationship: <paramref name="action"/> is "block" or "unblock".</summary>
    private static async Task N6bRelationshipAsync(HttpClient owner, Guid clientId, string action)
    {
        var profile = await ReadSliceAsync<SliceProfileVersion>(owner, $"/api/clients/{clientId}");
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync(
                $"/api/clients/{clientId}/relationship/{action}", new { reason = "N6b privacy check", profile.Version }),
            HttpStatusCode.OK);
    }

    /// <summary>
    /// Asserts a closed training read (TRN-023): the program read and the logged workout's read are refused with their
    /// reason and say nothing of where the lifts stand; the block itself still reads, without an answer.
    /// </summary>
    private static async Task N6bAssertClosedAsync(
        HttpClient coach,
        Guid clientId,
        Guid blockId,
        Guid workoutId,
        string? reason)
    {
        var program = await ReadSliceAsync<CoachClientProgramView>(coach, R34aProgramUrl(clientId));
        Assert.AreEqual((false, 0), (program.IsAllowed, program.Blocks.Count));
        Assert.IsNull(program.LiftStandings, "A closed program read says nothing of where the lifts stand.");
        var detail = await ReadSliceAsync<CoachWorkoutDetailResult>(coach, N6bWorkoutUrl(clientId, workoutId));
        Assert.IsFalse(detail.IsAllowed);
        Assert.IsNull(detail.Detail);
        Assert.IsNull(detail.LiftStandings, "A closed workout read says nothing of where the lifts stand.");
        if (reason is not null)
        {
            Assert.AreEqual((reason, reason), (program.AccessReason, detail.AccessReason));
        }

        var block = await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(blockId));
        Assert.IsNotEmpty(block.Weeks, "The block itself still reads as before.");
        Assert.IsNull(block.LiftStandings, "A closed client's block says nothing of where the lifts stand.");
    }

    /// <summary>Asserts that none of the client's own training reads says where a lift stands, in any form.</summary>
    private static async Task N6bAssertClientReadsCarryNoStandingAsync(HttpClient client)
    {
        foreach (var url in N6bClientReads)
        {
            // Typed reads skip a member they do not know, and the API writes nulls, so only the text proves it absent.
            var raw = await client.GetStringAsync(url);
            Assert.DoesNotContain("liftStandings", raw, StringComparison.OrdinalIgnoreCase, url);
            Assert.DoesNotContain("standing", raw, StringComparison.OrdinalIgnoreCase, url);
        }
    }
}
