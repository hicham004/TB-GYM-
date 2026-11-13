using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using TB.Gym.Modules.Training;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The notes plan's N9b2, a workout of one's own (TRN-033): the eight gaps the review of its tests kept
/// (artifacts/notes-plan/N9b2/review-tests.json), one test each. The antiforgery token on every write; a coach's header
/// over the house's workout; the prescription ids of program and own rows at the database; a workout carried into the
/// next day; where a lift stands; a trainee who leaves mid-workout and comes back; a start from a program's finished
/// workout; and two changes racing. Every name, address and figure here is invented.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string N9b2GTokenRefused = "antiforgery_token_invalid";

    /// <summary>A row of either child table counted when its prescription id is filled.</summary>
    private const string N9b2GPrescribedSql =
        """
        SELECT (SELECT count(*) FROM training."WorkoutExercisePerformances" WHERE "Id" = @id AND "ExercisePrescriptionId" IS NOT NULL)
             + (SELECT count(*) FROM training."WorkoutSetPerformances" WHERE "Id" = @id AND "SetPrescriptionId" IS NOT NULL)
        """;

    private const string N9b2GRunningSql =
        """SELECT count(*) FROM training."WorkoutExecutions" WHERE "Id" = @id AND "Status" = 'InProgress'""";

    /// <summary>The unique place of an exercise in its workout, as PostgreSQL names the index (cut to 63 characters).</summary>
    private const string N9b2GPlaceIndex = "IX_WorkoutExercisePerformances_TenantId_WorkoutExecutionId_Pos~";

    private const string N9b2GEmptySetSql =
        """
        SELECT count(*) FROM training."WorkoutSetPerformances"
        WHERE "Id" = @id AND NOT "IsCompleted" AND "ActualRepetitions" IS NULL AND "ActualLoad" IS NULL
        """;

    /// <summary>TRN-033 with the antiforgery rule on state changes: no write of a workout of one's own is taken without the token.</summary>
    [TestMethod]
    public async Task N9b2GEveryWriteOfAWorkoutOfOnesOwnWithoutTheAntiforgeryTokenIsRefusedAndChangesNothing()
    {
        using var house = await N9a1OpenHouseAsync("n9b2g-token", withCoach: true);
        var library = await N9b1PLibraryAsync(house.Coach!);
        using var trainee = await N9a1TraineeAsync(
            house.TenantId, "n9b2g-token-rima@example.test", "Rima", "Aoun", address: "203.0.113.181");
        var client = trainee.Client;

        // Nothing under way: a start sent without the token, with a body that binds, starts nothing.
        await RefreshCsrfAsync(client);
        client.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
        var refusedStart = await client.PostAsJsonAsync(N9b2AWorkoutsUrl, new { fromWorkoutId = (Guid?)null });
        Assert.AreEqual(N9b2GTokenRefused, (await A10AnswerAsync(refusedStart, HttpStatusCode.BadRequest)).Code);
        Assert.AreEqual(0L, await N9b2AOwnRowsAsync(trainee.ProfileId));

        // A workout under way (each helper fetches the token first): one squat logged, one set left empty.
        var workout = await N9b2ABuildAsync(client, new N9b2ALift(library.Squat.Id, [new(5, 100m), null]));
        var id = workout.WorkoutExecutionId;
        var squat = workout.Exercises.Single();
        var last = squat.Sets[^1].PerformanceId;
        var rows = await N9b2ARowsAsync(id);

        // Without the token again, every write is refused for it: the five new routes and the set and finish routes the
        // workout shares with a program's. The code is asserted, not the status alone: a body that fails to bind answers
        // 400 too, and a start beside the running workout would otherwise answer 409.
        client.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
        foreach (var (route, response) in new (string Route, HttpResponseMessage Response)[]
                 {
                     ("start", await client.PostAsJsonAsync(N9b2AWorkoutsUrl, new { fromWorkoutId = (Guid?)null })),
                     ("add an exercise", await client.PostAsJsonAsync(
                         $"{N9b2AWorkoutsUrl}/{id}/exercises", new { exerciseId = library.Hold.Id, version = workout.Version })),
                     ("take an exercise away", await N9b2GDeleteAsIsAsync(
                         client, $"{N9b2AWorkoutsUrl}/{id}/exercises/{squat.PerformanceId}", workout.Version)),
                     ("add a set", await client.PostAsJsonAsync(
                         $"{N9b2AWorkoutsUrl}/{id}/exercises/{squat.PerformanceId}/sets", new { version = workout.Version })),
                     ("take a set away", await N9b2GDeleteAsIsAsync(client, $"{N9b2AWorkoutsUrl}/{id}/sets/{last}", workout.Version)),
                     ("save a set", await client.PutAsJsonAsync($"{N9b2AWorkoutsUrl}/{id}/sets/{last}", new
                     {
                         repetitions = 5,
                         load = 120m,
                         loadUnit = "Kilogram",
                         rpe = (decimal?)null,
                         rir = (decimal?)null,
                         isCompleted = true,
                         clientNote = (string?)null,
                         version = workout.Version,
                     })),
                     ("finish", await client.PostAsJsonAsync($"{N9b2AWorkoutsUrl}/{id}/complete", new { version = workout.Version })),
                 })
        {
            Assert.AreEqual(N9b2GTokenRefused, (await A10AnswerAsync(response, HttpStatusCode.BadRequest)).Code, route);
        }

        // Read back, the workout is as it was left, and still the trainee's only one.
        var after = await N9b2ACarryOnAsync(client);
        Assert.AreEqual(
            (id, workout.Version, WorkoutExecutionStatus.InProgress, "1 Back Squat: 1 5x100 Kilogram, 2 empty"),
            (after.WorkoutExecutionId, after.Version, after.Status, N9b2ALine(after)));
        Assert.AreEqual(rows, await N9b2ARowsAsync(id));
        Assert.AreEqual(1L, await N9b2AOwnRowsAsync(trainee.ProfileId));
    }

    /// <summary>TRN-033 with SYS-002: under a coach's X-Tenant-Id, the house's workout of one's own is missing on every route and on Today.</summary>
    [TestMethod]
    public async Task N9b2GUnderACoachsHeaderTheHousesWorkoutOfOnesOwnIsMissingOnEveryRouteAndOnToday()
    {
        var today = N9b1FStartAtMidday();
        using var house = await N9a1OpenHouseAsync("n9b2g-tenant", withCoach: true);
        var library = await N9b1PLibraryAsync(house.Coach!);
        using var zeina = CreateClient();
        var zeinaSpace = await RegisterCoachAsync(zeina, "n9b2g-tenant-zeina@example.test", "Zeina Aoun", "N9b2G Tenant Zeina Gym");

        // Jad, a trainee of the house, has a workout of his own under way there: one squat logged, one set left empty.
        const string jadEmail = "n9b2g-tenant-jad@example.test";
        using var jad = await N9a1TraineeAsync(house.TenantId, jadEmail, "Jad", "Rizk", address: "203.0.113.182");
        var workout = await N9b2ABuildAsync(jad.Client, new N9b2ALift(library.Squat.Id, [new(5, 100m), null]));
        var id = workout.WorkoutExecutionId;
        var exercise = workout.Exercises.Single();
        var last = exercise.Sets[^1].PerformanceId;
        var rows = await N9b2ARowsAsync(id);

        // He becomes Zeina's client too, with Training open in her space, and his header names her space.
        var jadThere = await InviteAndAcceptAsync(zeina, jad.Client, jadEmail, newAccount: false);
        await CreateFreeTrainingEnrollmentAsync(zeina, jadThere, today);
        SetTenant(jad.Client, zeinaSpace);
        Assert.AreEqual("Granted", await N9b1PTrainingAsync(jad.Client));

        // Under her header the house's workout, its exercise and its set are missing on every route that changes one, the
        // set and finish routes included; and Today there, open, has nothing to carry on with.
        foreach (var (route, response) in await N9b2AChangesAsync(
                     jad.Client, id, library.Hold.Id, exercise.PerformanceId, last, workout.Version))
        {
            Assert.AreEqual(HttpStatusCode.NotFound, response.StatusCode, $"under Zeina's header: {route}");
        }

        var there = await N9b2ATodayAsync(jad.Client);
        Assert.AreEqual((true, (OwnWorkoutView?)null), (there.IsAllowed, there.OwnWorkout));
        Assert.AreEqual(0L, await N9b2AOwnRowsAsync(jadThere));

        // Back under the house's header it is as he left it.
        SetTenant(jad.Client, house.TenantId);
        var kept = await N9b2ACarryOnAsync(jad.Client);
        Assert.AreEqual(
            (id, workout.Version, WorkoutExecutionStatus.InProgress, "1 Back Squat: 1 5x100 Kilogram, 2 empty"),
            (kept.WorkoutExecutionId, kept.Version, kept.Status, N9b2ALine(kept)));
        Assert.AreEqual(rows, await N9b2ARowsAsync(id));
        Assert.AreEqual(1L, await N9b2AOwnRowsAsync(jad.ProfileId));
    }

    /// <summary>TRN-012 and TRN-033 at the database: a program's row never loses its prescription id, nor does a row of one's own gain one.</summary>
    [TestMethod]
    public async Task N9b2GAProgramsRowNeverLosesItsPrescriptionIdNorDoesARowOfOnesOwnGainOne()
    {
        using var shapes = await N9b2DBothShapesAsync("n9b2g-ids");
        var client = shapes.Trainee.Client;
        var own = shapes.Own;
        var ownSquat = own.Exercises[0];
        var ownSet = ownSquat.Sets[0].PerformanceId;
        var rows = await N9b2DAllRowsAsync();

        // Both workouts running: the guards refuse each UPDATE, before any check sees the row, in the snapshot's words.
        await N9b2GAssertPrescriptionIdsKeptAsync(shapes, ownSquat.PerformanceId, ownSet, running: true);

        // Both finished through their routes: each is refused as history.
        var programVersion = (await N9b2ATodayAsync(client)).Workouts.Single().ExecutionVersion!.Value;
        Assert.AreEqual(
            WorkoutExecutionStatus.Completed,
            (await A3FinishAsync(client, shapes.ProgramWorkoutId, programVersion)).Status);
        Assert.AreEqual(
            WorkoutExecutionStatus.Completed,
            (await A3FinishAsync(client, own.WorkoutExecutionId, own.Version)).Status);
        await N9b2GAssertPrescriptionIdsKeptAsync(shapes, ownSquat.PerformanceId, ownSet, running: false);
        Assert.AreEqual(rows, await N9b2DAllRowsAsync());
    }

    /// <summary>TRN-033: a workout of one's own never closes by itself; carried on and finished the next day, it counts on the day it started.</summary>
    [TestMethod]
    public async Task N9b2GAWorkoutLeftUnfinishedIsCarriedOnTheNextDayAndCountsOnTheDayItStarted()
    {
        using var house = await N9a1OpenHouseAsync("n9b2g-carry", withCoach: true);
        var library = await N9b1PLibraryAsync(house.Coach!);
        using var trainee = await N9a1TraineeAsync(
            house.TenantId, "n9b2g-carry-maher@example.test", "Maher", "Awad", address: "203.0.113.183");
        var client = trainee.Client;

        // Monday at ten in the house, so Monday and Tuesday fall in one of its weeks: one squat logged, one set left empty.
        N9b1PNextHouseWeek();
        var monday = N9a1HouseToday();
        var workout = await N9b2ABuildAsync(client, new N9b2ALift(library.Squat.Id, [new(5, 100m), null]));
        Assert.AreEqual(monday, workout.Date);

        // Tuesday: Today still carries it as it was left, dated Monday, and nothing new starts beside it.
        var tuesday = monday.AddDays(1);
        N9b1FSetHouseDay(tuesday);
        var day = await N9b2ATodayAsync(client);
        var carried = day.OwnWorkout ?? throw new AssertFailedException("Tuesday's Today carries no workout of one's own.");
        Assert.AreEqual(
            (tuesday, workout.WorkoutExecutionId, workout.Version, monday, WorkoutExecutionStatus.InProgress,
                "1 Back Squat: 1 5x100 Kilogram, 2 empty"),
            (day.LocalDate, carried.WorkoutExecutionId, carried.Version, carried.Date, carried.Status, N9b2ALine(carried)));
        Assert.AreEqual(N9b2AInProgress, await A7ConflictAsync(await N9b2AStartAsync(client)));

        // Carried on: its empty set logged on Tuesday, then finished on Tuesday.
        var saved = await N9b2AOkAsync<WorkoutSetSaveView>(N9b2ALogAsync(
            client, carried.WorkoutExecutionId, carried.Exercises.Single().Sets[1].PerformanceId, 5, 105m, null, carried.Version));
        var finishedAt = RequiredTestClock.UtcNow;
        var finished = await N9b2AOkAsync<WorkoutExecutionView>(
            N9b2AFinishAsync(client, carried.WorkoutExecutionId, saved.ExecutionVersion));
        Assert.AreEqual(
            (WorkoutExecutionStatus.Completed, (DateTimeOffset?)finishedAt),
            (finished.Status, finished.CompletedAtUtc));

        // History, records and the week all date it Monday, the day it started; Tuesday counts nothing.
        var entry = (await ReadSliceAsync<ClientWorkoutHistoryPage>(client, "/api/training/me/history")).Items.Single();
        Assert.AreEqual(
            (carried.WorkoutExecutionId, monday, finishedAt, 2, 2),
            (entry.WorkoutExecutionId, entry.Date, entry.CompletedAtUtc, entry.CompletedSetCount, entry.TotalSetCount));
        var record = (await ReadSliceAsync<ClientPersonalRecordsResult>(client, "/api/training/me/personal-records")).Items.Single();
        Assert.AreEqual((library.Squat.Id, 5, 105m, monday), (record.ExerciseId, record.Repetitions, record.Load, record.Date));
        var week = await ReadSliceAsync<ClientTrainingWeekView>(client, "/api/training/me/week");
        Assert.AreEqual(
            (true, monday, 1, 0, 1),
            (week.IsAllowed, week.WeekStart, week.Days.Single(d => d.Date == monday).OwnCompleted,
                week.Days.Single(d => d.Date == tuesday).OwnCompleted, week.Days.Sum(d => d.OwnCompleted)));
        Assert.IsNull((await N9b2ATodayAsync(client)).OwnWorkout, "Finished, it is no longer carried.");
    }

    /// <summary>TRN-033 with STR-019: where a lift stands reads a program's workouts alone, never a workout of one's own, finished or running.</summary>
    [TestMethod]
    public async Task N9b2GWhereALiftStandsNeverReadsAWorkoutOfOnesOwnFinishedOrRunning()
    {
        var today = N9b1FStartAtMidday();
        using var house = await N9a1OpenHouseAsync("n9b2g-stand", withCoach: true);
        var coach = house.Coach!;
        var library = await N9b1PLibraryAsync(coach);
        using var trainee = await N9a1TraineeAsync(
            house.TenantId, "n9b2g-stand-rami@example.test", "Rami", "Khoury", address: "203.0.113.184");
        var client = trainee.Client;

        // The house's staff give the trainee a program whose pool squat steps 2.5 kg from 100 kg (Last time + step).
        var enrollment = await CreateTrainingEnrollmentAsync(house.Owner, trainee.ProfileId, today, 8);
        var template = await PublishProgramAsync(house.Owner, N6aProgram(
            "n9b2g-stand program",
            P2Week("Week 1", library.Squat.Id, N6aStepSet(1, 2.5m, 100m)),
            P2Week("Week 2", library.Squat.Id, N6aStepSet(1, 2.5m, 100m))));
        var block = await N6bAssignAsync(house.Owner, trainee.ProfileId, enrollment.Id, template, today);

        // Week 1's session done at 100 kg for its 10 reps: the coach's reads step the lift to 102.5 kg from that workout.
        var program = await N6bTrainTodayAsync(client, true, new N6bLog(10, 100m));
        var before = N6bAnswer(await N6bStandingsAsync(coach, trainee.ProfileId, [block.Id], program), library.Squat.Id);
        Assert.AreEqual(
            (LiftStandingOutcome.StepUp, (Guid?)program, (decimal?)102.5m),
            (before.Standing.Outcome, before.Standing.LastTime?.WorkoutExecutionId, before.Standing.Sets.Single().Weight));
        var expected = JsonSerializer.Serialize(before, SliceReadJson);

        // A minute later the same day, a workout of the trainee's own of the squat finished at 105 kg for 10, within the
        // typo guard's 25%, so a read of it would step from 105 kg: the answer is the same, word for word.
        R31Tick();
        var own = await N9b2ABuildAsync(client, new N9b2ALift(library.Squat.Id, [new(10, 105m)]));
        await N9b2AOkAsync<WorkoutExecutionView>(N9b2AFinishAsync(client, own.WorkoutExecutionId, own.Version));
        var afterFinished = N6bAnswer(await N6bStandingsAsync(coach, trainee.ProfileId, [block.Id], program), library.Squat.Id);
        Assert.AreEqual(expected, JsonSerializer.Serialize(afterFinished, SliceReadJson), "A finished workout of one's own was read.");

        // Another minute on, one started at 110 kg and left running, which a read would hold the lift for: the same again.
        R31Tick();
        var running = await N9b2ABuildAsync(client, new N9b2ALift(library.Squat.Id, [new(10, 110m)]));
        Assert.AreEqual(WorkoutExecutionStatus.InProgress, running.Status);
        var afterRunning = N6bAnswer(await N6bStandingsAsync(coach, trainee.ProfileId, [block.Id], program), library.Squat.Id);
        Assert.AreEqual(expected, JsonSerializer.Serialize(afterRunning, SliceReadJson), "A running workout of one's own was read.");
    }

    /// <summary>TRN-033 with ADR 0027: a trainee who left is refused by the policy, and back on a new record the old workout is missing and a new one starts.</summary>
    [TestMethod]
    public async Task N9b2GATraineeWhoLeftIsRefusedAndBackOnANewRecordFindsTheOldWorkoutMissingAndStartsAnew()
    {
        N9b1FStartAtMidday();
        using var house = await N9a1OpenHouseAsync("n9b2g-back", withCoach: true);
        var library = await N9b1PLibraryAsync(house.Coach!);
        const string email = "n9b2g-back-lina@example.test";
        using var trainee = await N9a1TraineeAsync(house.TenantId, email, "Lina", "Saad", address: "203.0.113.185");
        var client = trainee.Client;
        var old = await N9b2ABuildAsync(client, new N9b2ALift(library.Squat.Id, [new(5, 100m), null]));
        var exercise = old.Exercises.Single();
        var last = exercise.Sets[^1].PerformanceId;
        var rows = await N9b2ARowsAsync(old.WorkoutExecutionId);

        // She leaves mid-workout: her membership over, the TenantClient policy refuses every route before any of its code.
        await N9a1LeaveAsync(client, "Trying it alone");
        await AssertStatusAsync(await N9b2AStartAsync(client), HttpStatusCode.Forbidden);
        foreach (var (route, response) in await N9b2AChangesAsync(
                     client, old.WorkoutExecutionId, library.Hold.Id, exercise.PerformanceId, last, old.Version))
        {
            Assert.AreEqual(HttpStatusCode.Forbidden, response.StatusCode, $"after leaving: {route}");
        }

        Assert.AreEqual(rows, await N9b2ARowsAsync(old.WorkoutExecutionId));

        // Back the next house week, still signed in: she joins at once on a new record beside the ended one.
        N9b1PNextHouseWeek();
        var back = await N9a1SignUpAsync(client, email, "Lina", "Saad", withPassword: false);
        await AssertStatusAsync(back, HttpStatusCode.OK);
        Assert.IsTrue((await RequiredJsonAsync<N9a1Answer>(back)).Joined);
        var profiles = (await N9a1PersonAsync(email)).Profiles;
        Assert.HasCount(2, profiles);
        Assert.AreEqual(trainee.ProfileId, profiles.Single(item => item.ReleasedAtUtc is not null).Id);
        var current = profiles.Single(item => item.ReleasedAtUtc is null).Id;

        // Her new record has nothing to carry on with, and the ended record's workout, its exercise and its set are missing
        // on every route (ClientProfiles.CurrentFor): a lookup by her account would find them.
        var day = await N9b2ATodayAsync(client);
        Assert.AreEqual((true, (OwnWorkoutView?)null), (day.IsAllowed, day.OwnWorkout));
        foreach (var (route, response) in await N9b2AChangesAsync(
                     client, old.WorkoutExecutionId, library.Hold.Id, exercise.PerformanceId, last, old.Version))
        {
            Assert.AreEqual(HttpStatusCode.NotFound, response.StatusCode, $"back: {route}");
        }

        // A new one starts on her new record and is the one Today carries; the old one stays unfinished, as she left it.
        var fresh = await N9b2AOkAsync<OwnWorkoutView>(N9b2AStartAsync(client));
        fresh = await N9b2AOkAsync<OwnWorkoutView>(
            N9b2AAddExerciseAsync(client, fresh.WorkoutExecutionId, library.Squat.Id, fresh.Version));
        var carried = await N9b2ACarryOnAsync(client);
        Assert.AreEqual(
            (fresh.WorkoutExecutionId, fresh.Version, N9a1HouseToday(), "1 Back Squat: no sets"),
            (carried.WorkoutExecutionId, carried.Version, carried.Date, N9b2ALine(carried)));
        Assert.AreEqual((1L, 1L), (await N9b2AOwnRowsAsync(trainee.ProfileId), await N9b2AOwnRowsAsync(current)));
        Assert.AreEqual(rows, await N9b2ARowsAsync(old.WorkoutExecutionId));
        Assert.AreEqual(
            (1L, 1L),
            (await Phase6CountAsync(RequiredDatabaseConnection, N9b2GRunningSql, old.WorkoutExecutionId),
                await Phase6CountAsync(RequiredDatabaseConnection, N9b2GEmptySetSql, last)));
    }

    /// <summary>TRN-033: a start from a finished program's workout takes the lifts done there still in the pool, and history tells the kinds apart.</summary>
    [TestMethod]
    public async Task N9b2GAStartFromAFinishedProgramsWorkoutTakesTheLiftsDoneStillInThePoolAndHistoryTellsTheKindsApart()
    {
        var today = N9b1FStartAtMidday();
        using var house = await N9a1OpenHouseAsync("n9b2g-copy", withCoach: true);
        var coach = house.Coach!;
        var library = await N9b1PLibraryAsync(coach);
        var boxSquat = await CreateExerciseAsync(coach, "Box Squat", [], []);

        // Rana, a client the house's coach invited, on a plan of the house's with a program of three pool lifts: the
        // squat twice (she may swap it for the box squat), the carry once and the raise three times.
        using var rana = CreateClient();
        var ranaId = await R31InviteAsync(coach, rana, house.TenantId, "n9b2g-copy-rana@example.test", "Rana", "Haddad");
        var enrollment = await CreateTrainingEnrollmentAsync(house.Owner, ranaId, today, 8);
        var template = await PublishProgramAsync(house.Owner, N6aProgram(
            "n9b2g-copy program",
            N6bWeek(
                "Week 1",
                "Week 1 lower",
                N6bSwappableLift(
                    library.Squat.Id, 1, boxSquat.Id, P1Set(1, "Direct", rpe: null, direct: 60m), P1Set(2, "Direct", rpe: null, direct: 60m)),
                N6bLift(library.Carry.Id, 2, P1Set(1, "Direct", rpe: null, direct: 40m)),
                N6bLift(
                    library.Raise.Id,
                    3,
                    P1Set(1, "Direct", rpe: null, direct: 8m),
                    P1Set(2, "Direct", rpe: null, direct: 8m),
                    P1Set(3, "Direct", rpe: null, direct: 8m)))));
        var block = await N6bAssignAsync(house.Owner, ranaId, enrollment.Id, template, today);

        // She swaps the squat for the box squat and does one set of it, the carry's one set and two of the three raises.
        var (program, day) = await A3StartTodayAsync(rana);
        var (squat, carry, raise) = (day.Exercises[0], day.Exercises[1], day.Exercises[2]);
        var version = (await N9b2AOkAsync<WorkoutExecutionView>(
            A3SwapAsync(rana, program.Id, squat.PerformanceId!.Value, boxSquat.Id, program.Version))).Version;
        foreach (var (set, load) in new[] { (squat.Sets[0], 70m), (carry.Sets[0], 40m), (raise.Sets[0], 8m), (raise.Sets[1], 8m) })
        {
            version = (await A3LogAsync(rana, program.Id, set.PerformanceId!.Value, 5, load, null, version)).ExecutionVersion;
        }

        await A3FinishAsync(rana, program.Id, version);

        // The coach archives the carry. Started from that workout, a workout of her own takes the box squat she did, not
        // the squat written, and the raise, in their order, with one and two empty sets for the sets done there; the
        // carry, out of the pool now, stays out.
        await N9b1PSetArchivedAsync(coach, library.Carry.Id, archived: true, library.Carry.Version);
        R31Tick();
        var copy = await N9b2AOkAsync<OwnWorkoutView>(N9b2AStartAsync(rana, program.Id));
        Assert.AreEqual(
            ("Workout", today, "1 Box Squat: 1 empty | 2 Élévations latérales: 1 empty, 2 empty"),
            (copy.Name, copy.Date, N9b2ALine(copy)));
        CollectionAssert.AreEqual(
            new[] { boxSquat.Id, library.Raise.Id },
            copy.Exercises.Select(item => item.ExerciseId).ToArray());

        // She logs a set of it and finishes it: history lists both, newest first, the program's under its program and not
        // her own, hers as her own with no program.
        var saved = await N9b2AOkAsync<WorkoutSetSaveView>(N9b2ALogAsync(
            rana, copy.WorkoutExecutionId, copy.Exercises[0].Sets[0].PerformanceId, 5, 75m, null, copy.Version));
        R31Tick();
        await N9b2AOkAsync<WorkoutExecutionView>(N9b2AFinishAsync(rana, copy.WorkoutExecutionId, saved.ExecutionVersion));
        var items = (await ReadSliceAsync<ClientWorkoutHistoryPage>(rana, "/api/training/me/history")).Items;
        Assert.IsFalse(string.IsNullOrEmpty(block.Name), "The program has a name to show.");
        CollectionAssert.AreEqual(
            new[]
            {
                (copy.WorkoutExecutionId, "Workout", string.Empty, true, 1, 3),
                (program.Id, "Week 1 lower", block.Name, false, 4, 6),
            },
            items.Select(item => (item.WorkoutExecutionId, item.Name, item.ProgramName, item.IsOwnWorkout,
                item.CompletedSetCount, item.TotalSetCount)).ToArray());
    }

    /// <summary>TRN-033 with SYS-006: two adds racing on one version, or an add racing a finish, answer 409 concurrency_conflict, never a 500.</summary>
    [TestMethod]
    public async Task N9b2GTwoAddsAtOnceOrAnAddBesideAFinishAnswerAConflictNeverAServerError()
    {
        N9b1FStartAtMidday();
        using var house = await N9a1OpenHouseAsync("n9b2g-race", withCoach: true);
        var library = await N9b1PLibraryAsync(house.Coach!);
        using var trainee = await N9a1TraineeAsync(
            house.TenantId, "n9b2g-race-dina@example.test", "Dina", "Mrad", address: "203.0.113.186");
        var client = trainee.Client;
        var workout = await N9b2AOkAsync<OwnWorkoutView>(N9b2AStartAsync(client));
        var id = workout.WorkoutExecutionId;
        workout = await N9b2AOkAsync<OwnWorkoutView>(N9b2AAddExerciseAsync(client, id, library.Squat.Id, workout.Version));

        // Two tabs each add an exercise from the same version, both held at their write until both have read the workout,
        // so each takes the same next place.
        await RefreshCsrfAsync(client);
        RequiredInsertBarrier.Arm("training.\"WorkoutExercisePerformances\"", 2);
        HttpResponseMessage[] adds;
        try
        {
            adds = await Task.WhenAll(
                client.PostAsJsonAsync($"{N9b2AWorkoutsUrl}/{id}/exercises", new { exerciseId = library.Hold.Id, version = workout.Version }),
                client.PostAsJsonAsync($"{N9b2AWorkoutsUrl}/{id}/exercises", new { exerciseId = library.Raise.Id, version = workout.Version }));
            Assert.IsGreaterThanOrEqualTo(2, RequiredInsertBarrier.Arrived, "The two adds never raced.");
        }
        finally
        {
            RequiredInsertBarrier.Disarm();
        }

        // One is taken, the other answers a conflict, and the workout holds the squat and the one taken.
        Assert.AreEqual(1, adds.Count(item => item.StatusCode == HttpStatusCode.OK), "One add is taken.");
        Assert.AreEqual(N9b2AStale, await A7ConflictAsync(adds.Single(item => item.StatusCode != HttpStatusCode.OK)));
        var taken = await ReadSlicePayloadAsync<OwnWorkoutView>(adds.Single(item => item.StatusCode == HttpStatusCode.OK));
        var after = await N9b2ACarryOnAsync(client);
        Assert.AreEqual((taken.Version, N9b2ALine(taken), 2), (after.Version, N9b2ALine(after), after.Exercises.Count));
        Assert.AreEqual((2L, 0L), await N9b2ARowsAsync(id));
        // The conflict came from the database's unique place in the workout (23505), the branch this race is for.
        Assert.Contains(N9b2GPlaceIndex, RequiredEveryLogLine.Text, "The losing add never reached the unique place.");

        // An add held between its read and its write while another tab finishes the workout: the guard refuses its write,
        // the refusal is retried and given up, and the add answers a conflict; the workout stays as the finish left it.
        RequiredInsertBarrier.Arm("training.\"WorkoutExercisePerformances\"", 2);
        HttpResponseMessage added;
        try
        {
            var add = N9b2AAddExerciseAsync(client, id, library.Carry.Id, after.Version);
            Assert.AreNotSame(add, await Task.WhenAny(add, RequiredInsertBarrier.ArrivedAsync(1)), "The add answered before its write.");
            await AssertStatusAsync(await N9b2AFinishAsync(client, id, after.Version), HttpStatusCode.OK);
            RequiredInsertBarrier.Disarm();
            added = await add;
        }
        finally
        {
            RequiredInsertBarrier.Disarm();
        }

        Assert.AreEqual(N9b2AStale, await A7ConflictAsync(added));
        // The conflict came from the exercise guard's refusal of a finished workout (55000, retried and given up), the
        // branch this race is for, not from the stale version alone.
        Assert.Contains("Workout exercise history is immutable", RequiredEveryLogLine.Text, "The add never reached the guard.");
        Assert.AreEqual((2L, 0L), await N9b2ARowsAsync(id));
        var entry = (await ReadSliceAsync<ClientWorkoutHistoryPage>(client, "/api/training/me/history")).Items.Single();
        Assert.AreEqual((id, 0, 0), (entry.WorkoutExecutionId, entry.CompletedSetCount, entry.TotalSetCount));
        Assert.IsNull((await N9b2ATodayAsync(client)).OwnWorkout, "The finish was taken.");
    }

    // ---------- helpers (writer G of N9b2: the review's gaps) ----------

    /// <summary>A DELETE with the workout's version in its JSON body, sent as the client stands: no token is fetched first.</summary>
    private static async Task<HttpResponseMessage> N9b2GDeleteAsIsAsync(HttpClient client, string url, uint version)
    {
        using var request = new HttpRequestMessage(HttpMethod.Delete, url)
        {
            Content = JsonContent.Create(new { version }),
        };
        return await client.SendAsync(request);
    }

    /// <summary>
    /// Asserts the workout guards refuse emptying the prescription id of a program's exercise and set and filling that of
    /// an exercise and set of one's own, with 55000 in the snapshot's words while running and history's once finished;
    /// that each row kept its shape; and that the program's set and exercise, still prescribed, still never go.
    /// </summary>
    private async Task N9b2GAssertPrescriptionIdsKeptAsync(N9b2DShapes shapes, Guid ownExerciseId, Guid ownSetId, bool running)
    {
        var (exerciseWords, setWords) = running
            ? ("Workout exercise prescription snapshots are immutable", "Workout set prescription snapshots are immutable")
            : ("Workout exercise history is immutable", "Workout set history is immutable");
        foreach (var (sql, id, words) in new[]
                 {
                     ("""UPDATE training."WorkoutExercisePerformances" SET "ExercisePrescriptionId" = NULL WHERE "Id" = @id""",
                         shapes.ProgramExerciseId, exerciseWords),
                     ("""UPDATE training."WorkoutSetPerformances" SET "SetPrescriptionId" = NULL WHERE "Id" = @id""",
                         shapes.ProgramSetId, setWords),
                     ("""UPDATE training."WorkoutExercisePerformances" SET "ExercisePrescriptionId" = gen_random_uuid() WHERE "Id" = @id""",
                         ownExerciseId, exerciseWords),
                     ("""UPDATE training."WorkoutSetPerformances" SET "SetPrescriptionId" = gen_random_uuid() WHERE "Id" = @id""",
                         ownSetId, setWords),
                 })
        {
            await N9b2DAssertGuardRefusesAsync(sql, id, words);
        }

        Assert.AreEqual(
            (1L, 1L, 0L, 0L),
            (await Phase6CountAsync(RequiredDatabaseConnection, N9b2GPrescribedSql, shapes.ProgramExerciseId),
                await Phase6CountAsync(RequiredDatabaseConnection, N9b2GPrescribedSql, shapes.ProgramSetId),
                await Phase6CountAsync(RequiredDatabaseConnection, N9b2GPrescribedSql, ownExerciseId),
                await Phase6CountAsync(RequiredDatabaseConnection, N9b2GPrescribedSql, ownSetId)),
            running ? "running" : "finished");
        await N9b2DAssertGuardRefusesAsync(N9b2DDeleteSetSql, shapes.ProgramSetId, "Workout set history is immutable");
        await N9b2DAssertGuardRefusesAsync(N9b2DDeleteExerciseSql, shapes.ProgramExerciseId, "Workout exercise history is immutable");
    }
}
