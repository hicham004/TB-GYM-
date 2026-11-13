using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Training;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The notes plan's N6a (decisions 20 to 22, 5 and 7 Nov 2026): "Last time + step", the sixth weight choice. A coach
/// publishes a set with a step and, if they like, a starting weight; it is assigned without a training max, and the
/// coach's and the client's reads carry the choice and the step, from the program before the workout starts and from
/// the workout's own snapshot after, whether a set is logged with reps or without. The builder's week copies and Build
/// next block move its starting weight by the weight step and copy its step, never working it out from a max or rounding
/// it; Edit weeks keeps it as stored and changes only what the coach changed; a training-max update passes it by. Only
/// the client's own coach reads it, and a released client's program stays as it was. The database refuses a step set
/// without its step or unit, a step on any other set, and a change of a started workout's choice or step; a draft keeps
/// it whole; and the migration reverts and reapplies over the sets made before it, and refuses to revert over a step
/// set. Each test with a client starts at midday in the workspace's zone, so each whole day it steps lands on the next
/// calendar day.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string N6aStepWords = "A step must be more than 0 and at most 50 in the set's unit, with at most two decimals.";

    private static readonly string[] N6aStepTables = ["ProgramTemplateSets", "SetPrescriptions"];

    [TestMethod]
    public async Task N6aAStepSetIsAssignedWithoutAMaxAndEveryReadAndTheWorkoutKeepItsStep()
    {
        R61aStartAtMidday();
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "n6a-reads", exerciseId =>
        [
            P2Week("Week 1", exerciseId, N6aStepSet(1, 2m, 21m), N6aStepSet(2, 2m)),
        ]);

        // The program version keeps the choice, the step and the starting weight as the coach typed them.
        var version = await ReadSliceAsync<ProgramTemplateVersionView>(coach, N6aVersionUrl(scenario.Template.Id));
        var typed = version.Weeks.Single().Sessions.Single().Exercises.Single().Sets.OrderBy(set => set.Position).ToArray();
        Assert.IsTrue(typed.All(set =>
            set.LoadStrategy == TrainingLoadStrategy.LastTimeStep && set.LoadStep == 2m && set.LoadUnit == TrainingLoadUnit.Kilogram));
        CollectionAssert.AreEqual(new decimal?[] { 21m, null }, typed.Select(set => set.DirectLoad).ToArray());

        // A step set is never worked out from a max, so a max sent for a lift that has only step sets is refused; a set in
        // pounds on a program in kilograms is refused as any loaded set's is, since nothing is ever converted.
        Assert.AreEqual(
            "Provide exactly one working max for every exercise that uses calculated loading.",
            await A7FieldErrorAsync(await P2TryAssignAsync(coach, scenario, [P2SavedMax(scenario)], Guid.NewGuid()), "assignment"));
        var pounds = await PublishProgramAsync(
            coach, N6aProgram("n6a pounds", P2Week("Week 1", scenario.Exercise.Id, N6aStepSet(1, 5m, 45m, unit: "Pound"))));
        Assert.Contains(
            "Set load units must match the mesocycle load unit",
            await A7FieldErrorAsync(await P2TryAssignAsync(coach, scenario with { Template = pounds }, [], Guid.NewGuid()), "assignment"));

        // Assigned with no max: the starting weight is the weight, unrounded (21 kg is off the 2.5 kg grid), or none.
        var block = await P2AssignAsync(coach, scenario, []);
        Assert.IsEmpty(block.WorkingMaxes);
        var assigned = P2Sets(block);
        Assert.IsTrue(assigned.All(set =>
            set.LoadStrategy == TrainingLoadStrategy.LastTimeStep && set.LoadStep == 2m && set.WorkingMaxSnapshotId is null));
        CollectionAssert.AreEqual(new decimal?[] { 21m, null }, assigned.Select(set => set.PrescribedLoad).ToArray());
        CollectionAssert.AreEqual(new decimal?[] { 21m, null }, assigned.Select(set => set.UnroundedRecommendedLoad).ToArray());
        CollectionAssert.AreEqual(new[] { "CoachStartingWeight", null }, assigned.Select(set => set.CalculationStrategyKey).ToArray());

        // The coach's read of the program, which their session sheet shows, says the same.
        var read = P2Sets(await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id)));
        CollectionAssert.AreEqual(new decimal?[] { 2m, 2m }, read.Select(set => set.LoadStep).ToArray());
        CollectionAssert.AreEqual(new decimal?[] { 21m, null }, read.Select(set => set.DirectLoad).ToArray());
        CollectionAssert.AreEqual(new decimal?[] { 21m, null }, read.Select(set => set.PrescribedLoad).ToArray());

        // The client's today, before the workout starts, read from the program.
        N6aAssertStepSets(N6aTodaysSets(await ReadSliceAsync<ClientTrainingDayResult>(client, "/api/training/me/today")), started: false);

        // Started, the read comes from the workout's snapshot, which kept the same.
        await RefreshCsrfAsync(client);
        var start = await client.PostAsync($"/api/training/me/sessions/{block.Weeks.Single().Sessions.Single().Id}/start", null);
        await AssertStatusAsync(start, HttpStatusCode.OK);
        var execution = await ReadSlicePayloadAsync<WorkoutExecutionView>(start);
        var started = N6aTodaysSets(await ReadSliceAsync<ClientTrainingDayResult>(client, "/api/training/me/today"));
        N6aAssertStepSets(started, started: true);

        // A set logs with its reps typed, and another with the reps box left empty: the server takes both (N6b's rule is
        // what will make a set without reps never count).
        var logged = await N6aLogAsync(client, execution.Id, started[0].PerformanceId!.Value, execution.Version, 10, 21m);
        logged = await N6aLogAsync(client, execution.Id, started[1].PerformanceId!.Value, logged, null, 20m);

        // The next day the unfinished workout is offered again, from the same snapshot.
        RequiredTestClock.Advance(TimeSpan.FromDays(1));
        var upcoming = await ReadSliceAsync<ClientTrainingUpcomingView>(client, "/api/training/me/upcoming");
        N6aAssertStepSets(
            upcoming.UnfinishedWorkouts.Single().Workout.Exercises.Single().Sets.OrderBy(set => set.Position).ToArray(),
            started: true);

        // Finished, the coach's read of the logged workout carries the choice, the step and what was logged.
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync($"/api/training/me/workouts/{execution.Id}/complete", new { version = logged }),
            HttpStatusCode.OK);
        var detail = await ReadSliceAsync<CoachWorkoutDetailResult>(
            coach, $"/api/training/clients/{scenario.ClientId}/workouts/{execution.Id}");
        Assert.IsTrue(detail.IsAllowed);
        var sets = detail.Detail!.Workout.Exercises.Single().Sets.OrderBy(set => set.Position).ToArray();
        N6aAssertStepSets(sets, started: true);
        Assert.AreEqual(((int?)10, (decimal?)21m, true), (sets[0].ActualRepetitions, sets[0].ActualLoad, sets[0].IsCompleted));
        Assert.AreEqual(((int?)null, (decimal?)20m, true), (sets[1].ActualRepetitions, sets[1].ActualLoad, sets[1].IsCompleted));

        // The snapshot keeps both in columns of its own, the choice by its name.
        Assert.AreEqual(
            2L,
            await P2CountAsync(
                """
                SELECT count(*) FROM training."WorkoutSetPerformances" AS s
                JOIN training."WorkoutExercisePerformances" AS e ON e."TenantId" = s."TenantId" AND e."Id" = s."WorkoutExercisePerformanceId"
                WHERE e."WorkoutExecutionId" = @id AND s."LoadStrategySnapshot" = 'LastTimeStep' AND s."PrescribedLoadStep" = 2
                """,
                execution.Id));
    }

    [TestMethod]
    public async Task N6aPublishRefusesAStepSetMissingWhatItNeedsAndDropsAStepSentOnAnyOtherSet()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "n6a-publish@example.test", "N6a Coach", "N6a Publish");
        var curl = await CreateExerciseAsync(coach, "Seated leg curl", [], []);

        // A draft keeps any value mid-edit (TRN-024); Publish refuses each of these with its reason and publishes nothing.
        (object Set, string Words)[] refused =
        [
            (N6aStepSet(1, 0m), N6aStepWords),
            (N6aStepSet(1, 50.01m), N6aStepWords),
            (N6aStepSet(1, 2.125m), N6aStepWords),
            (N6aStepSet(1, null), N6aStepWords),
            (N6aStepSet(1, 2m, unit: null), "A last time + step set needs its unit, kg or lb."),
            (N6aStepSet(1, 2m, reps: null), "A last time + step set needs its reps."),
            (N6aStepSet(1, 2m, 0m), "A starting weight must be more than 0 and at most 2,000."),
            // The database keeps three decimals, so this start would be stored as 0: a 400 here, never a 500.
            (N6aStepSet(1, 2m, 0.0004m), "A starting weight must be more than 0 and at most 2,000."),
            (N6aStepSet(1, 2m, manual: 25m), "A last time + step set takes no fixed load instead; type its starting weight."),
        ];
        foreach (var (set, words) in refused)
        {
            var response = await PublishProgramContentAsync(coach, N6aProgram("Refused", P1Week(curl.Id, set)));
            Assert.AreEqual(words, await A7FieldErrorAsync(response, "program"));
        }

        Assert.AreEqual(0, (await ReadSliceAsync<ProgramTemplatePage>(coach, "/api/training/templates")).Total);
        Assert.AreEqual(0L, await A7ScalarAsync("""SELECT count(*) FROM training."ProgramTemplateSets" """));

        // A step sent on any other weight choice is no part of that set: the program is published without it.
        var published = await PublishProgramAsync(coach, N6aProgram("Stray steps", P1Week(
            curl.Id,
            N6aSet(1, "Direct", step: 5m, direct: 40m),
            N6aSet(2, "None", step: 5m, unit: null))));
        var sets = (await ReadSliceAsync<ProgramTemplateVersionView>(coach, N6aVersionUrl(published.Id)))
            .Weeks.Single().Sessions.Single().Exercises.Single().Sets.OrderBy(set => set.Position).ToArray();
        Assert.IsTrue(sets.All(set => set.LoadStep is null));
        Assert.AreEqual((TrainingLoadStrategy.Direct, (decimal?)40m), (sets[0].LoadStrategy, sets[0].DirectLoad));
        Assert.AreEqual(TrainingLoadStrategy.None, sets[1].LoadStrategy);
        Assert.AreEqual(0L, await A7ScalarAsync("""SELECT count(*) FROM training."ProgramTemplateSets" WHERE "LoadStep" IS NOT NULL"""));
    }

    [TestMethod]
    public async Task N6aTheBuildersWeekCopiesMoveAStartingWeightByTheWeightStepAndKeepTheStep()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "n6a-copies@example.test", "N6a Coach", "N6a Copies");
        var curl = await CreateExerciseAsync(coach, "Seated leg curl", [], []);

        var response = await P1PreviewAsync(
            coach, P1Request(P1Week(curl.Id, N6aStepSet(1, 2m, 21m), N6aStepSet(2, 2m)), 3, loadStep: 2.5m));

        await AssertStatusAsync(response, HttpStatusCode.OK);
        var preview = await ReadSlicePayloadAsync<WeekProgressionPreviewView>(response);
        Assert.HasCount(3, preview.Weeks);
        var copies = preview.Weeks.Select(week => week.Sessions.Single().Exercises.Single().Sets).ToArray();
        CollectionAssert.AreEqual(new decimal?[] { 23.5m, 26m, 28.5m }, copies.Select(sets => sets[0].DirectLoad).ToArray());
        foreach (var sets in copies)
        {
            Assert.IsTrue(sets.All(set =>
                set.LoadStrategy == TrainingLoadStrategy.LastTimeStep && set.LoadStep == 2m && set.LoadUnit == TrainingLoadUnit.Kilogram));
            Assert.IsNull(sets[1].DirectLoad, "With no starting weight there is nothing to move.");
        }

        // The source week is checked as a save checks it, step and all.
        Assert.AreEqual(
            "Fix this week before copying it. " + N6aStepWords,
            await A7FieldErrorAsync(await P1PreviewAsync(coach, P1Request(P1Week(curl.Id, N6aStepSet(1, 0m)), 1, loadStep: 2.5m)), "progression"));

        // A preview is a calculation: no program or draft exists afterwards.
        Assert.AreEqual(0, (await ReadSliceAsync<ProgramTemplatePage>(coach, "/api/training/templates")).Total);
        Assert.IsEmpty(await ReadSliceAsync<ProgramDraftSummary[]>(coach, R42aDraftsUrl));
    }

    [TestMethod]
    public async Task N6aBuildNextBlockMovesAStepSetsStartingWeightAndNeverWorksItOutFromAMaxOrRoundsIt()
    {
        R61aStartAtMidday();
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "n6a-next", exerciseId =>
        [
            P2Week(
                "Week 1",
                exerciseId,
                P1Set(1, "PercentageWorkingMax", rpe: null, percentage: 70m),
                N6aStepSet(2, 2m, 21m),
                N6aStepSet(3, 2m)),
        ]);

        // The lift has a max, which its % set needs; the step sets beside it never use it.
        var block = await P2AssignAsync(coach, scenario, [P2SavedMax(scenario)]);
        var max = block.WorkingMaxes.Single().Id;
        var source = block.Weeks.Single();
        CollectionAssert.AreEqual(new decimal?[] { 70m, 21m, null }, P3Sets(source).Select(set => set.PrescribedLoad).ToArray());

        var preview = await P3PreviewOkAsync(coach, block, [source.Id], 2, percentage: 2.5m, load: 2.5m);

        // 72.5% and then 75% of 100 kg; the starting weight goes 2.5 kg a week, to 23.5 and 26 kg, which the program's
        // 2.5 kg rounding would have moved; the set with no starting weight still has none.
        N6aAssertNextBlockWeek(P3Sets(preview.GeneratedWeeks[0]), max, 72.5m, 23.5m);
        N6aAssertNextBlockWeek(P3Sets(preview.GeneratedWeeks[1]), max, 75m, 26m);

        var applied = await P3ApplyOkAsync(coach, block, [source.Id], 2, preview.PreviewHash, percentage: 2.5m, load: 2.5m);
        var weeks = applied.Weeks.OrderBy(week => week.WeekNumber).ToArray();
        Assert.HasCount(3, weeks);
        N6aAssertNextBlockWeek(P3Sets(weeks[0]), max, 70m, 21m);
        N6aAssertNextBlockWeek(P3Sets(weeks[1]), max, 72.5m, 23.5m);
        N6aAssertNextBlockWeek(P3Sets(weeks[2]), max, 75m, 26m);
    }

    [TestMethod]
    public async Task N6aEditWeeksKeepsAStepSetAsStoredAndChangesOnlyWhatTheCoachChanged()
    {
        R61aStartAtMidday();
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "n6a-edit", exerciseId =>
        [
            P2Week("Week 1", exerciseId, N6aStepSet(1, 2m, 21m)),
            P2Week("Week 2", exerciseId, N6aStepSet(1, 2m, 21m)),
            P2Week("Week 3", exerciseId, N6aStepSet(1, 2m, 21m)),
        ]);
        var block = await P2AssignAsync(coach, scenario, []);
        var today = TenantToday();

        // The grid sent back as it is stored changes nothing, so there is nothing to apply.
        var untouched = await P3bPreviewOkAsync(coach, block, P3bGrid(block, today));
        Assert.AreEqual(
            (0, 0, 0, 0, 0, 0, 0),
            (untouched.WeeksAdded, untouched.WeeksMoved, untouched.WeeksRemoved, untouched.SessionsAdded, untouched.SessionsEdited,
                untouched.SessionsMoved, untouched.SessionsRemoved));
        Assert.IsEmpty(untouched.SessionChanges);
        Assert.AreEqual(
            "There is nothing to change.",
            await A7FieldErrorAsync(await P3bApplyAsync(coach, block.Id, block.Version, P3bGrid(block, today), untouched.PreviewHash), "edit"));

        // Week 2's step alone, 2 kg to 2.5 kg: one session edited, its weight still the starting weight, with no max.
        var grid = P3bGrid(block, today);
        grid[1] = P3bEditFirstSet(grid[1], set => set with { LoadStep = 2.5m });
        var stepped = await P3bPreviewOkAsync(coach, block, grid);
        Assert.AreEqual((0, 1, 0, 0), (stepped.SessionsAdded, stepped.SessionsEdited, stepped.SessionsMoved, stepped.SessionsRemoved));
        var change = stepped.SessionChanges.Single();
        Assert.AreEqual((ProgramEditChangeKind.Edited, 2), (change.Kind, change.WeekNumber));
        N6aAssertStepSet(change.After!.Exercises[0].Sets[0], 2.5m, 21m);
        var applied = await P3bApplyOkAsync(coach, block, grid, stepped.PreviewHash);
        var weeks = applied.Weeks.OrderBy(week => week.WeekNumber).ToArray();
        Assert.AreEqual(P3bOnlySession(block.Weeks[1]).Id, P3bOnlySession(weeks[1]).Id, "The edited session keeps its row.");
        N6aAssertStepSet(P3bOnlySession(weeks[0]).Exercises[0].Sets[0], 2m, 21m);
        N6aAssertStepSet(P3bOnlySession(weeks[1]).Exercises[0].Sets[0], 2.5m, 21m);
        N6aAssertStepSet(P3bOnlySession(weeks[2]).Exercises[0].Sets[0], 2m, 21m);

        // Week 3's starting weight alone, to 23.5 kg: an edit too, and the weight is never rounded to the 2.5 kg grid.
        grid = P3bGrid(applied, today);
        grid[2] = P3bEditFirstSet(grid[2], set => set with { DirectLoad = 23.5m });
        var restarted = await P3bPreviewOkAsync(coach, applied, grid);
        Assert.AreEqual((1, 3), (restarted.SessionsEdited, restarted.SessionChanges.Single().WeekNumber));
        N6aAssertStepSet(restarted.SessionChanges.Single().After!.Exercises[0].Sets[0], 2m, 23.5m);
        applied = await P3bApplyOkAsync(coach, applied, grid, restarted.PreviewHash);
        N6aAssertStepSet(P3bOnlySession(applied.Weeks.Single(week => week.WeekNumber == 3)).Exercises[0].Sets[0], 2m, 23.5m);

        // Week 2 goes and week 3 takes its place: a session that only moves is built again as stored, step and weight.
        grid = P3bGrid(applied, today);
        var moved = await P3bPreviewOkAsync(coach, applied, [grid[0], grid[2]]);
        Assert.AreEqual(
            (1, 1, 0, 1, 1),
            (moved.WeeksMoved, moved.WeeksRemoved, moved.SessionsEdited, moved.SessionsMoved, moved.SessionsRemoved));
        var shorter = await P3bApplyOkAsync(coach, applied, [grid[0], grid[2]], moved.PreviewHash);
        weeks = shorter.Weeks.OrderBy(week => week.WeekNumber).ToArray();
        Assert.HasCount(2, weeks);
        Assert.AreEqual(today.AddDays(7), P3bOnlySession(weeks[1]).ScheduledDate);
        N6aAssertStepSet(P3bOnlySession(weeks[0]).Exercises[0].Sets[0], 2m, 21m);
        N6aAssertStepSet(P3bOnlySession(weeks[1]).Exercises[0].Sets[0], 2m, 23.5m);

        // Each edit is recorded, with the removed week's session as it was, its step included.
        Assert.AreEqual(3L, await P3bEditCountAsync(block.Id));
        Assert.AreEqual(
            1L,
            await P2CountAsync(
                """
                SELECT count(*) FROM training."ProgramEdits"
                WHERE "MesocycleId" = @id AND "SessionsRemoved" = 1 AND "ChangesJson"::text LIKE '%"loadStep": 2.5%'
                """,
                block.Id));
    }

    [TestMethod]
    public async Task N6aATrainingMaxUpdateChangesTheCalculatedSetAndLeavesTheStepSetsWeight()
    {
        R61aStartAtMidday();
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "n6a-maxes", exerciseId =>
        [
            P2Week(
                "Week 1",
                exerciseId,
                P1Set(1, "PercentageWorkingMax", rpe: null, percentage: 70m),
                N6aStepSet(2, 2m, 21m)),
        ]);
        var block = await P2AssignAsync(coach, scenario, [P2SavedMax(scenario)]);
        CollectionAssert.AreEqual(new decimal?[] { 70m, 21m }, P2Sets(block).Select(set => set.PrescribedLoad).ToArray());

        var changes = new[] { P2Change(scenario.Exercise.Id, value: 120m) };
        var preview = await P2PreviewOkAsync(coach, block.Id, block.Version, changes);

        // Only the % set moves: 70% of 120 kg is 84 kg, which rounds to 85 kg.
        Assert.AreEqual((1, 1), (preview.ChangedSetCount, preview.SessionCount));
        Assert.AreEqual((1, 85m), (preview.Sets.Single().SetPosition, preview.Sets.Single().NewLoad));
        var applied = await P2ApplyOkAsync(coach, block.Id, block.Version, changes, null, preview.PreviewHash, Guid.NewGuid());
        var sets = P2Sets(applied);
        Assert.AreEqual(85m, sets[0].PrescribedLoad);
        Assert.AreEqual(applied.WorkingMaxes.Single(item => item.SupersedesSnapshotId is not null).Id, sets[0].WorkingMaxSnapshotId);
        N6aAssertStepSet(sets[1], 2m, 21m);
    }

    [TestMethod]
    public async Task N6aOnlyTheClientsOwnCoachReadsAStepSetAndAReleasedClientsProgramStaysAsItWas()
    {
        R61aStartAtMidday();
        using var owner = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(owner, client, "n6a-scope", exerciseId =>
        [
            P2Week("Week 1", exerciseId, N6aStepSet(1, 2m, 21m)),
            P2Week("Week 2", exerciseId, N6aStepSet(1, 2m, 21m)),
        ]);
        var block = await P2AssignAsync(owner, scenario, []);
        var url = P2MesocycleUrl(block.Id);

        // The client is refused the coach's reads.
        await AssertStatusAsync(await client.GetAsync(url), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await client.GetAsync(R34aProgramUrl(scenario.ClientId)), HttpStatusCode.Forbidden);

        // A colleague who does not coach the client finds nothing, as for a client that does not exist.
        using var colleague = CreateClient();
        await JoinAsCoachAsync(owner, colleague, "n6a-scope-colleague@example.test", "Lina Saad");
        await AssertStatusAsync(await colleague.GetAsync(url), HttpStatusCode.NotFound);
        await AssertStatusAsync(await colleague.GetAsync(R34aProgramUrl(scenario.ClientId)), HttpStatusCode.NotFound);
        await AssertStatusAsync(
            await P3PreviewAsync(colleague, block.Id, block.Version, [block.Weeks[0].Id], 1, load: 2.5m),
            HttpStatusCode.NotFound);
        await AssertStatusAsync(
            await P3bPreviewAsync(colleague, block.Id, block.Version, P3bGrid(block, TenantToday())),
            HttpStatusCode.NotFound);

        // Another workspace's owner finds nothing in their own, and is refused this one; nobody signed out reads it.
        using var stranger = CreateClient();
        await RegisterCoachAsync(stranger, "n6a-scope-stranger@example.test", "Other Owner", "N6a Elsewhere");
        await AssertStatusAsync(await stranger.GetAsync(url), HttpStatusCode.NotFound);
        SetTenant(stranger, scenario.WorkspaceId);
        await AssertStatusAsync(await stranger.GetAsync(url), HttpStatusCode.Forbidden);
        using var anonymous = CreateClient();
        SetTenant(anonymous, scenario.WorkspaceId);
        await AssertStatusAsync(await anonymous.GetAsync(url), HttpStatusCode.Unauthorized);

        // Previews the owner reads before releasing the client, which apply would otherwise take.
        var next = await P3PreviewOkAsync(owner, block, [block.Weeks[0].Id], 1, load: 2.5m);
        var grid = P3bGrid(block, TenantToday());
        grid[1] = P3bEditFirstSet(grid[1], set => set with { LoadStep = 2.5m });
        var edit = await P3bPreviewOkAsync(owner, block, grid);

        // Released (ADR 0027), the program is read as it was, its steps intact, and neither write reaches it.
        await ReleaseAsync(owner, scenario.ClientId, "Moved away");
        await RefreshCsrfAsync(owner);
        HttpResponseMessage[] refusals =
        [
            await P3ApplyAsync(owner, block.Id, block.Version, [block.Weeks[0].Id], 1, next.PreviewHash, load: 2.5m),
            await P3bApplyAsync(owner, block.Id, block.Version, grid, edit.PreviewHash),
        ];
        foreach (var refused in refusals)
        {
            await AssertStatusAsync(refused, HttpStatusCode.Conflict);
            Assert.Contains("client_released", await refused.Content.ReadAsStringAsync());
        }

        var kept = await ReadSliceAsync<TrainingMesocycleView>(owner, url);
        Assert.HasCount(2, kept.Weeks);
        foreach (var set in P2Sets(kept))
        {
            N6aAssertStepSet(set, 2m, 21m);
        }
    }

    [TestMethod]
    public async Task N6aTheDatabaseRefusesAStepSetWithoutItsStepOrUnitAStepOnAnyOtherSetAndAChangeOfAStartedOnesStep()
    {
        R61aStartAtMidday();
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "n6a-checks", exerciseId =>
        [
            P2Week("Week 1", exerciseId, N6aStepSet(1, 2m, 21m), N6aSet(2, "Direct", direct: 60m)),
            P2Week("Week 2", exerciseId, N6aStepSet(1, 2m, 21m), N6aSet(2, "Direct", direct: 60m)),
        ]);
        var block = await P2AssignAsync(coach, scenario, []);

        // Both load-strategy checks name the sixth choice and keep the chart's; each set table has its step check.
        await using (var connection = new NpgsqlConnection(RequiredDatabaseConnection))
        {
            await connection.OpenAsync();
            foreach (var table in N6aStepTables)
            {
                var strategy = await N6aConstraintAsync(connection, $"CK_{table}_LoadStrategy");
                StringAssert.Contains(strategy, "LastTimeStep");
                StringAssert.Contains(strategy, "RpeChart");
                StringAssert.Contains(await N6aConstraintAsync(connection, $"CK_{table}_LoadStep"), "LastTimeStep");
            }

            StringAssert.Contains(await N6aConstraintAsync(connection, "CK_WorkoutSetPerformances_LoadStep"), "PrescribedLoadStep");
        }

        // A program version's sets are append-only, so a copy is what reaches its checks. As it is, the copy is stored.
        var template = (await ReadSliceAsync<ProgramTemplateVersionView>(coach, N6aVersionUrl(scenario.Template.Id)))
            .Weeks.OrderBy(week => week.WeekNumber).First().Sessions.Single().Exercises.Single().Sets.OrderBy(set => set.Position).ToArray();
        await Phase6ExecuteAsync(N6aCopySql("ProgramTemplateSets", template[0].Id, 60, string.Empty));
        await N10bAssertRefusedByAsync("23514", "CK_ProgramTemplateSets_LoadStrategy", N6aCopySql("ProgramTemplateSets", template[0].Id, 50, "r.\"LoadStep\" := NULL;"));
        await N10bAssertRefusedByAsync("23514", "CK_ProgramTemplateSets_LoadStrategy", N6aCopySql("ProgramTemplateSets", template[0].Id, 50, "r.\"LoadUnit\" := NULL;"));
        await N10bAssertRefusedByAsync("23514", "CK_ProgramTemplateSets_LoadStep", N6aCopySql("ProgramTemplateSets", template[1].Id, 50, "r.\"LoadStep\" := 2;"));

        // Week 2's sets have not started, so an update reaches the checks; one inside the rule is stored.
        var assigned = P2Sets(block);
        var (openStep, openDirect) = (assigned[2].Id, assigned[3].Id);
        await Phase6ExecuteAsync("""UPDATE training."SetPrescriptions" SET "LoadStep" = 2.5 WHERE "Id" = @id""", ("id", openStep));
        string[] broken =
        [
            "\"LoadStep\" = NULL",
            "\"LoadUnit\" = NULL",
            "\"LoadStep\" = 0",
            "\"LoadStep\" = 50.01",
            "\"LoadStep\" = 2.125",
            "\"RepetitionsMaximum\" = NULL",
            "\"DirectLoad\" = 0",
        ];
        foreach (var change in broken)
        {
            await N10bAssertRefusedByAsync(
                "23514",
                "CK_SetPrescriptions_LoadStrategy",
                $"""UPDATE training."SetPrescriptions" SET {change} WHERE "Id" = @id""",
                ("id", openStep));
        }

        await N10bAssertRefusedByAsync(
            "23514",
            "CK_SetPrescriptions_LoadStep",
            """UPDATE training."SetPrescriptions" SET "LoadStep" = 2 WHERE "Id" = @id""",
            ("id", openDirect));

        // A started workout keeps the choice and the step it was started with.
        var session = block.Weeks.OrderBy(week => week.WeekNumber).First().Sessions.Single();
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(await client.PostAsync($"/api/training/me/sessions/{session.Id}/start", null), HttpStatusCode.OK);
        var performed = N6aTodaysSets(await ReadSliceAsync<ClientTrainingDayResult>(client, "/api/training/me/today"));
        var (stepSnapshot, directSnapshot) = (performed[0].PerformanceId!.Value, performed[1].PerformanceId!.Value);

        // What the client logs is still written; the step and the choice are not.
        await Phase6ExecuteAsync("""UPDATE training."WorkoutSetPerformances" SET "ActualRepetitions" = 9 WHERE "Id" = @id""", ("id", stepSnapshot));
        await N6aAssertSnapshotRefusedAsync("""UPDATE training."WorkoutSetPerformances" SET "PrescribedLoadStep" = 5 WHERE "Id" = @id""", stepSnapshot);
        await N6aAssertSnapshotRefusedAsync("""UPDATE training."WorkoutSetPerformances" SET "LoadStrategySnapshot" = 'None' WHERE "Id" = @id""", directSnapshot);

        // A snapshot row keeps its step exactly when it was started from a step set.
        await Phase6ExecuteAsync(N6aCopySql("WorkoutSetPerformances", stepSnapshot, 60, string.Empty));
        await N10bAssertRefusedByAsync("23514", "CK_WorkoutSetPerformances_LoadStep", N6aCopySql("WorkoutSetPerformances", stepSnapshot, 50, "r.\"PrescribedLoadStep\" := NULL;"));
        await N10bAssertRefusedByAsync("23514", "CK_WorkoutSetPerformances_LoadStep", N6aCopySql("WorkoutSetPerformances", stepSnapshot, 50, "r.\"PrescribedLoadUnit\" := NULL;"));
        await N10bAssertRefusedByAsync("23514", "CK_WorkoutSetPerformances_LoadStep", N6aCopySql("WorkoutSetPerformances", directSnapshot, 50, "r.\"PrescribedLoadStep\" := 2;"));
        // A snapshot with no choice is one started before N6a, which never carries a step.
        await N10bAssertRefusedByAsync("23514", "CK_WorkoutSetPerformances_LoadStep", N6aCopySql("WorkoutSetPerformances", stepSnapshot, 50, "r.\"LoadStrategySnapshot\" := NULL;"));
    }

    [TestMethod]
    public async Task N6aADraftHoldingAStepSetSavesAtItsVersionReadsBackWholeAndPublishesWithItsStep()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "n6a-draft@example.test", "N6a Coach", "N6a Drafts");
        var curl = await CreateExerciseAsync(coach, "Seated leg curl", [], []);

        var created = await R42aCreateAsync(coach, new(null, null, null, N6aDraftContent(curl.Id, 2m)));
        var saved = await R42aSaveAsync(coach, created.Id, created.Version, N6aDraftContent(curl.Id, 2.5m));
        Assert.AreNotEqual(created.Version, saved.Version);

        // Saved again from the version before, another tab's change would be lost, so it is refused and changes nothing.
        await R42aAssertConflictAsync(
            await R42aPutAsync(coach, created.Id, created.Version, N6aDraftContent(curl.Id, 5m)),
            ProgramDraftConflictCodes.Stale);

        var draft = await ReadSliceAsync<ProgramDraftView>(coach, R42aDraftUrl(created.Id));
        Assert.AreEqual(saved.Version, draft.Version);
        Assert.AreEqual(
            N6aDraftSet(2.5m),
            draft.Content.Weeks.Single().Sessions.Single().Exercises.Single().Sets.Single(),
            "The saved step set reads back whole.");

        var published = await R42aPublishAsync(coach, created.Id, saved.Version, false);
        var set = published.Weeks.Single().Sessions.Single().Exercises.Single().Sets.Single();
        Assert.AreEqual(
            (TrainingLoadStrategy.LastTimeStep, (decimal?)2.5m, (decimal?)21m, (TrainingLoadUnit?)TrainingLoadUnit.Kilogram, (int?)12, (decimal?)8m),
            (set.LoadStrategy, set.LoadStep, set.DirectLoad, set.LoadUnit, set.RepetitionsMaximum, set.TargetRpe));
    }

    [TestMethod]
    public async Task N6aTheMigrationRevertsAndReappliesOverTheSetsMadeBeforeIt()
    {
        R61aStartAtMidday();
        using var coach = CreateClient();
        using var client = CreateClient();

        // Before N6a's choice existed: a % set and a typed set, assigned, one workout finished and the next one started.
        var scenario = await P2CustomStartAsync(coach, client, "n6a-migration", exerciseId =>
        [
            P2Week("Week 1", exerciseId, P1Set(1, "PercentageWorkingMax", rpe: null, percentage: 70m), P1Set(2, "Direct", rpe: 7m, direct: 60m)),
            P2Week("Week 2", exerciseId, P1Set(1, "PercentageWorkingMax", rpe: null, percentage: 72.5m), P1Set(2, "Direct", rpe: 7m, direct: 62.5m)),
            P2Week("Week 3", exerciseId, P1Set(1, "PercentageWorkingMax", rpe: null, percentage: 75m), P1Set(2, "Direct", rpe: 7m, direct: 65m)),
        ]);
        var block = await P2AssignAsync(coach, scenario, [P2SavedMax(scenario)]);
        await P4bLogTodayAsync(client, finish: true, new P4bLog(5, 70m, "Kilogram", 7m), new P4bLog(5, 60m, "Kilogram", 7m));
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        var inProgress = await P4bLogTodayAsync(client, finish: false, new P4bLog(5, 72.5m, "Kilogram", 7m));
        var counts = await N6aRowCountsAsync();
        Assert.AreEqual(4L, await A7ScalarAsync("""SELECT count(*) FROM training."WorkoutSetPerformances" WHERE "LoadStrategySnapshot" IS NOT NULL"""));

        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var migrations = context.Database.GetMigrations().ToArray();
        var migration = migrations.Single(item => item.EndsWith("_LastTimeStepSets", StringComparison.Ordinal));
        var previous = migrations[Array.IndexOf(migrations, migration) - 1];
        var migrator = context.Database.GetInfrastructure().GetRequiredService<IMigrator>();

        // Reverted: the four columns, the step checks and the sixth choice are gone, every row is still there, and the
        // workout guard is Phase 3's again, which still keeps the started workout's snapshot and lets its sets be logged.
        // Nothing asks the API anything until every migration is back.
        await migrator.MigrateAsync(previous);
        Assert.AreEqual(0L, await A7ScalarAsync(N6aColumnsSql));
        Assert.AreEqual(0L, await A7ScalarAsync(N6aStepChecksSql));
        Assert.AreEqual(0L, await A7ScalarAsync(N6aStrategyChecksSql("LastTimeStep")));
        Assert.AreEqual(2L, await A7ScalarAsync(N6aStrategyChecksSql("RpeChart")));
        Assert.AreEqual(0L, await A7ScalarAsync(N6aWorkoutGuardSql("PrescribedLoadStep")));
        Assert.AreEqual(0L, await A7ScalarAsync(N6aWorkoutGuardSql("LoadStrategySnapshot")));
        Assert.AreEqual(1L, await A7ScalarAsync(N6aWorkoutGuardSql("PrescribedLoadUnit")));
        CollectionAssert.AreEqual(counts, await N6aRowCountsAsync());
        await Phase6ExecuteAsync("""UPDATE training."WorkoutSetPerformances" SET "ActualRepetitions" = 6 WHERE "Id" = @id""", ("id", inProgress[0]));
        await N6aAssertSnapshotRefusedAsync("""UPDATE training."WorkoutSetPerformances" SET "PrescribedLoad" = 75 WHERE "Id" = @id""", inProgress[0]);

        // Reapplied over those rows: they keep no step and no choice, and the checks and the guard are N6a's again.
        await migrator.MigrateAsync(migration);
        Assert.AreEqual(4L, await A7ScalarAsync(N6aColumnsSql));
        Assert.AreEqual(3L, await A7ScalarAsync(N6aStepChecksSql));
        Assert.AreEqual(2L, await A7ScalarAsync(N6aStrategyChecksSql("LastTimeStep")));
        Assert.AreEqual(1L, await A7ScalarAsync(N6aWorkoutGuardSql("PrescribedLoadStep")));
        Assert.AreEqual(1L, await A7ScalarAsync(N6aWorkoutGuardSql("LoadStrategySnapshot")));
        CollectionAssert.AreEqual(counts, await N6aRowCountsAsync());
        Assert.AreEqual(
            0L,
            await A7ScalarAsync(
                """
                SELECT (SELECT count(*) FROM training."ProgramTemplateSets" WHERE "LoadStep" IS NOT NULL)
                     + (SELECT count(*) FROM training."SetPrescriptions" WHERE "LoadStep" IS NOT NULL)
                     + (SELECT count(*) FROM training."WorkoutSetPerformances" WHERE "PrescribedLoadStep" IS NOT NULL OR "LoadStrategySnapshot" IS NOT NULL)
                """));
        await N6aAssertSnapshotRefusedAsync("""UPDATE training."WorkoutSetPerformances" SET "PrescribedLoadStep" = 5 WHERE "Id" = @id""", inProgress[0]);

        // The API reads the newest model, so the migrations after this one go back on before it is asked. The program and
        // both workouts read as before; the started one's snapshot kept no choice, as a workout started before N6a.
        await migrator.MigrateAsync();
        var program = await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id));
        var sets = P2Sets(program);
        Assert.IsTrue(sets.All(set => set.LoadStep is null));
        CollectionAssert.AreEqual(
            new decimal?[] { 70m, 60m, 72.5m, 62.5m, 75m, 65m },
            sets.Select(set => set.PrescribedLoad).ToArray());
        var today = N6aTodaysSets(await ReadSliceAsync<ClientTrainingDayResult>(client, "/api/training/me/today"));
        Assert.AreEqual(((int?)6, (decimal?)72.5m), (today[0].ActualRepetitions, today[0].PrescribedLoad));
        Assert.IsTrue(today.All(set => set.LoadStrategy is null && set.LoadStep is null));
        var finished = program.Weeks.OrderBy(week => week.WeekNumber).First().Sessions.Single().WorkoutExecutionId!.Value;
        var detail = await ReadSliceAsync<CoachWorkoutDetailResult>(
            coach, $"/api/training/clients/{scenario.ClientId}/workouts/{finished}");
        CollectionAssert.AreEqual(
            new decimal?[] { 70m, 60m },
            detail.Detail!.Workout.Exercises.Single().Sets.OrderBy(set => set.Position).Select(set => set.ActualLoad).ToArray());

        // And the sixth choice is taken again.
        var stepping = await PublishProgramAsync(coach, N6aProgram("After the revert", P1Week(scenario.Exercise.Id, N6aStepSet(1, 2.5m))));
        Assert.AreEqual(
            2.5m,
            (await ReadSliceAsync<ProgramTemplateVersionView>(coach, N6aVersionUrl(stepping.Id))).Weeks.Single().Sessions.Single()
                .Exercises.Single().Sets.Single().LoadStep);
    }

    [TestMethod]
    public async Task N6aTheMigrationRefusesToRevertOverAProgramVersionsStepSet()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "n6a-revert-version@example.test", "N6a Coach", "N6a Revert");
        var curl = await CreateExerciseAsync(coach, "Seated leg curl", [], []);
        var published = await PublishProgramAsync(coach, N6aProgram("Stepping", P1Week(curl.Id, N6aStepSet(1, 2.5m))));

        await N6aAssertRevertRefusedAsync();

        // Nothing was taken away, and the API reads the step as before.
        Assert.AreEqual(
            2.5m,
            (await ReadSliceAsync<ProgramTemplateVersionView>(coach, N6aVersionUrl(published.Id))).Weeks.Single().Sessions.Single()
                .Exercises.Single().Sets.Single().LoadStep);
    }

    [TestMethod]
    public async Task N6aTheMigrationRefusesToRevertOverAnAssignedProgramsStepSet()
    {
        R61aStartAtMidday();
        using var coach = CreateClient();
        using var client = CreateClient();

        // The program was published with a typed weight; Edit weeks made week 2's set a step set, so only the assigned
        // program holds one.
        var scenario = await P2CustomStartAsync(coach, client, "n6a-revert-program", exerciseId =>
        [
            P2Week("Week 1", exerciseId, P1Set(1, "Direct", rpe: 7m, direct: 60m)),
            P2Week("Week 2", exerciseId, P1Set(1, "Direct", rpe: 7m, direct: 60m)),
        ]);
        var block = await P2AssignAsync(coach, scenario, []);
        var grid = P3bGrid(block, TenantToday());
        grid[1] = P3bEditFirstSet(grid[1], set => set with { LoadStrategy = TrainingLoadStrategy.LastTimeStep, DirectLoad = 21m, LoadStep = 2m });
        var preview = await P3bPreviewOkAsync(coach, block, grid);
        var edited = await P3bApplyOkAsync(coach, block, grid, preview.PreviewHash);
        N6aAssertStepSet(P2Sets(edited)[1], 2m, 21m);
        Assert.AreEqual(0L, await A7ScalarAsync("""SELECT count(*) FROM training."ProgramTemplateSets" WHERE "LoadStrategy" = 'LastTimeStep'"""));

        await N6aAssertRevertRefusedAsync();

        N6aAssertStepSet(P2Sets(await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id)))[1], 2m, 21m);
    }

    // ----- helpers -----

    private const string N6aColumnsSql =
        """
        SELECT count(*) FROM information_schema.columns
        WHERE table_schema = 'training' AND (
            (table_name IN ('ProgramTemplateSets', 'SetPrescriptions') AND column_name = 'LoadStep') OR
            (table_name = 'WorkoutSetPerformances' AND column_name IN ('LoadStrategySnapshot', 'PrescribedLoadStep')))
        """;

    private const string N6aStepChecksSql =
        """
        SELECT count(*) FROM pg_constraint
        WHERE conname IN ('CK_ProgramTemplateSets_LoadStep', 'CK_SetPrescriptions_LoadStep', 'CK_WorkoutSetPerformances_LoadStep')
        """;

    private static string N6aStrategyChecksSql(string strategy) =>
        $"""
        SELECT count(*) FROM pg_constraint
        WHERE conname IN ('CK_ProgramTemplateSets_LoadStrategy', 'CK_SetPrescriptions_LoadStrategy')
          AND pg_get_constraintdef(oid) LIKE '%''{strategy}''%'
        """;

    private static string N6aWorkoutGuardSql(string column) =>
        $"""
        SELECT count(*) FROM pg_proc AS p JOIN pg_namespace AS n ON n.oid = p.pronamespace
        WHERE n.nspname = 'training' AND p.proname = 'protect_workout_set' AND p.prosrc LIKE '%"{column}"%'
        """;

    private static string N6aVersionUrl(Guid templateVersionId) => $"/api/training/template-versions/{templateVersionId}";

    /// <summary>One set as the builder sends it, with the set's own step: null on any set but a last time + step one.</summary>
    private static object N6aSet(
        int position,
        string strategy,
        decimal? step = null,
        decimal? direct = null,
        int? reps = 10,
        string? unit = "Kilogram",
        decimal? manual = null) => new
        {
            position,
            setType = "Normal",
            repetitionsMinimum = reps,
            repetitionsMaximum = reps,
            loadStrategy = strategy,
            directLoad = direct,
            loadUnit = unit,
            percentageWorkingMax = (decimal?)null,
            loadStep = step,
            targetRpe = (decimal?)null,
            targetRir = (decimal?)null,
            exertionDisplayPreference = "Rpe",
            restSeconds = (int?)90,
            tempo = (string?)null,
            coachNotes = (string?)null,
            manualLoadOverride = manual,
        };

    /// <summary>A last time + step set of 10 reps: its step, and its starting weight when it has one.</summary>
    private static object N6aStepSet(
        int position,
        decimal? step,
        decimal? start = null,
        int? reps = 10,
        string? unit = "Kilogram",
        decimal? manual = null) =>
        N6aSet(position, "LastTimeStep", step, start, reps, unit, manual);

    private static object N6aProgram(string name, params object[] weeks) => new { name, description = (string?)null, weeks };

    /// <summary>A draft of one week: the leg curl's step set, 12 reps from 21 kg at RPE 8, stepping by the given step.</summary>
    private static ProgramDraftContent N6aDraftContent(Guid exerciseId, decimal step) =>
        new(
            "Hypertrophy",
            null,
            [new TrainingWeekRequest("Week 1", true,
            [
                new TrainingSessionRequest("Lower A", 0, null,
                [
                    new ExercisePrescriptionRequest(
                        exerciseId,
                        1,
                        false,
                        PrescriptionModificationPolicy.CoachApprovedSwap,
                        null,
                        [],
                        [N6aDraftSet(step)]),
                ]),
            ])]);

    private static SetPrescriptionRequest N6aDraftSet(decimal step) =>
        new(
            1,
            TrainingSetType.Normal,
            12,
            12,
            TrainingLoadStrategy.LastTimeStep,
            21m,
            TrainingLoadUnit.Kilogram,
            null,
            LoadStep: step,
            8m,
            null,
            ExertionDisplayPreference.Rpe,
            90,
            "3-1-1",
            "Pause at the top");

    private static ClientSetView[] N6aTodaysSets(ClientTrainingDayResult day) =>
        [.. day.Workouts.Single().Exercises.Single().Sets.OrderBy(set => set.Position)];

    /// <summary>Today's two step sets: a step of 2 kg, the first from 21 kg and the second with no starting weight.</summary>
    private static void N6aAssertStepSets(ClientSetView[] sets, bool started)
    {
        Assert.HasCount(2, sets);
        foreach (var set in sets)
        {
            Assert.AreEqual(
                ((TrainingLoadStrategy?)TrainingLoadStrategy.LastTimeStep, (decimal?)2m, (TrainingLoadUnit?)TrainingLoadUnit.Kilogram),
                (set.LoadStrategy, set.LoadStep, set.PrescribedLoadUnit));
            Assert.AreEqual(started, set.PerformanceId is not null, "A started workout's sets are read from its snapshot.");
        }

        Assert.AreEqual(21m, sets[0].PrescribedLoad);
        Assert.IsNull(sets[1].PrescribedLoad);
    }

    /// <summary>A step set's weight is the coach's starting weight, unrounded and from no max, and its step is its own.</summary>
    private static void N6aAssertStepSet(SetPrescriptionView set, decimal step, decimal start)
    {
        Assert.AreEqual(
            (TrainingLoadStrategy.LastTimeStep, (decimal?)step, (decimal?)start, (decimal?)start, (Guid?)null, "CoachStartingWeight"),
            (set.LoadStrategy, set.LoadStep, set.DirectLoad, set.PrescribedLoad, set.WorkingMaxSnapshotId, set.CalculationStrategyKey));
        Assert.AreEqual(start, set.UnroundedRecommendedLoad);
    }

    /// <summary>One week of Build next block: the % set worked out from the max, and the two step sets beside it.</summary>
    private static void N6aAssertNextBlockWeek(SetPrescriptionView[] sets, Guid maxId, decimal percentLoad, decimal start)
    {
        Assert.AreEqual(
            (TrainingLoadStrategy.PercentageWorkingMax, (decimal?)percentLoad, (Guid?)maxId),
            (sets[0].LoadStrategy, sets[0].PrescribedLoad, sets[0].WorkingMaxSnapshotId));
        N6aAssertStepSet(sets[1], 2m, start);
        Assert.AreEqual(
            (TrainingLoadStrategy.LastTimeStep, (decimal?)2m, (decimal?)null, (decimal?)null, (Guid?)null, (string?)null),
            (sets[2].LoadStrategy, sets[2].LoadStep, sets[2].DirectLoad, sets[2].PrescribedLoad, sets[2].WorkingMaxSnapshotId, sets[2].CalculationStrategyKey));
    }

    private static async Task<uint> N6aLogAsync(
        HttpClient client,
        Guid executionId,
        Guid performanceId,
        uint version,
        int? reps,
        decimal load)
    {
        await RefreshCsrfAsync(client);
        var saved = await client.PutAsJsonAsync(
            $"/api/training/me/workouts/{executionId}/sets/{performanceId}",
            new
            {
                repetitions = reps,
                load,
                loadUnit = "Kilogram",
                rpe = (decimal?)null,
                isCompleted = true,
                clientNote = (string?)null,
                version,
            });
        await AssertStatusAsync(saved, HttpStatusCode.OK);
        var view = await ReadSlicePayloadAsync<WorkoutSetSaveView>(saved);
        Assert.AreEqual((reps, (decimal?)load, true), (view.ActualRepetitions, view.ActualLoad, view.IsCompleted));
        return view.ExecutionVersion;
    }

    /// <summary>A copy of one row as a record, moved <paramref name="offset"/> places on, with the given change.</summary>
    private static string N6aCopySql(string table, Guid id, int offset, string change) =>
        $$"""
        DO $copy$
        DECLARE r training."{{table}}"%ROWTYPE;
        BEGIN
            SELECT * INTO STRICT r FROM training."{{table}}" WHERE "Id" = '{{id}}';
            r."Id" := gen_random_uuid();
            r."Position" := r."Position" + {{offset}};
            {{change}}
            INSERT INTO training."{{table}}" SELECT r.*;
        END $copy$;
        """;

    private static async Task<string> N6aConstraintAsync(NpgsqlConnection connection, string name)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = @name";
        command.Parameters.AddWithValue("name", name);
        return (string?)await command.ExecuteScalarAsync() ?? throw new AssertFailedException($"{name} is missing.");
    }

    /// <summary>Asserts that the update is refused by the started workout's guard, not by a check.</summary>
    private async Task N6aAssertSnapshotRefusedAsync(string sql, Guid id)
    {
        var refused = await Assert.ThrowsExactlyAsync<PostgresException>(() => Phase6ExecuteAsync(sql, ("id", id)));
        Assert.AreEqual(("55000", "Workout set prescription snapshots are immutable"), (refused.SqlState, refused.MessageText));
    }

    private async Task<long[]> N6aRowCountsAsync() =>
    [
        await A7ScalarAsync("""SELECT count(*) FROM training."ProgramTemplateSets" """),
        await A7ScalarAsync("""SELECT count(*) FROM training."SetPrescriptions" """),
        await A7ScalarAsync("""SELECT count(*) FROM training."WorkoutExecutions" """),
        await A7ScalarAsync("""SELECT count(*) FROM training."WorkoutSetPerformances" """),
    ];

    /// <summary>
    /// Going back over a step set would drop its step and break the older checks, and its rows are never rewritten, so the
    /// migration stops with a plain message, keeps everything, and stays applied (a forward fix, ADR 0036).
    /// </summary>
    private async Task N6aAssertRevertRefusedAsync()
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var migrations = context.Database.GetMigrations().ToArray();
        var migration = migrations.Single(item => item.EndsWith("_LastTimeStepSets", StringComparison.Ordinal));
        var previous = migrations[Array.IndexOf(migrations, migration) - 1];
        var migrator = context.Database.GetInfrastructure().GetRequiredService<IMigrator>();

        // Npgsql counts 55000 as transient, so the context's retrying strategy (EnableRetryOnFailure) runs the refused
        // revert again, each time rolled back, and then hands over PostgreSQL's refusal inside its own exception.
        var thrown = await Assert.ThrowsAsync<Exception>(() => migrator.MigrateAsync(previous));
        var refused = thrown as PostgresException ?? thrown.InnerException as PostgresException
            ?? throw new AssertFailedException($"Expected PostgreSQL's refusal, not {thrown}");

        Assert.AreEqual(
            ("55000", "Some sets use Last time + step; roll forward instead of reverting this migration."),
            (refused.SqlState, refused.MessageText));
        Assert.Contains(migration, await context.Database.GetAppliedMigrationsAsync());
        Assert.AreEqual(4L, await A7ScalarAsync(N6aColumnsSql));
        Assert.AreEqual(3L, await A7ScalarAsync(N6aStepChecksSql));
        Assert.AreEqual(1L, await A7ScalarAsync(N6aWorkoutGuardSql("PrescribedLoadStep")));

        // The migrations after this one were reverted, each in its own transaction, before this one refused: the newest
        // model goes back on before the API is asked anything.
        await migrator.MigrateAsync();
    }
}
