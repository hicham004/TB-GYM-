using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Infrastructure.Security;
using TB.Gym.Modules.Training;
using TB.Gym.SharedKernel;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The notes plan's N9b2, a workout of one's own (TRN-033), through the API against PostgreSQL: a current client of
/// the house with Training open starts one empty or from a finished workout, adds exercises in use in the house's
/// pool and sets, logs them through the set route and finishes them through the finish route, and their history,
/// records, last time, Today and week read it as theirs; one runs at a time, even for two starts at once; another
/// client's, a coach's workspace, a blocked trainee, the house's staff and someone signed out change nothing; a
/// finished one, a stale tab, a set not the last, a twenty-first set, an exercise outside the pool, a noted exercise,
/// a staff note and a swap are refused; its pool demos open; the coach reads its records but no page of it; no log
/// holds a set's note; and its five routes are a client's writes. Every name, address and figure here is invented.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string N9b2AWorkoutsUrl = "/api/training/me/workouts";

    /// <summary>A word that occurs nowhere else in a run, so a log line holding it proves a set's note leaked.</summary>
    private const string N9b2AMarker = "n9b2a-marker-quince-elbow-5821";

    private static readonly string[] N9b2ARouteNames =
        ["StartMyOwnWorkout", "AddMyOwnWorkoutExercise", "RemoveMyOwnWorkoutExercise", "AddMyOwnWorkoutSet", "RemoveMyOwnWorkoutSet"];

    private static readonly string[] N9b2ARouteParameters = ["workoutExecutionId", "exercisePerformanceId", "setPerformanceId"];

    private static readonly string[] N9b2ATenantClientPolicy = [AuthorizationPolicies.TenantClient];

    private static readonly string[] N9b2APostOnly = ["POST"];

    private static readonly string[] N9b2ADeleteOnly = ["DELETE"];

    private static readonly (string Code, string Message) N9b2AInProgress =
        ("own_workout_in_progress", "You have a workout you have not finished. Carry on with it, or finish it first.");

    private static readonly (string Code, string Message) N9b2ANothingToCopy =
        ("own_workout_nothing_to_copy", "None of that workout's exercises is in the exercise pool now.");

    private static readonly (string Code, string Message) N9b2ANotOwn =
        ("own_workout_only", "Exercises and sets are added or taken away only in a workout of your own, not in a program's workout.");

    private static readonly (string Code, string Message) N9b2AImmutable =
        ("workout_immutable", "Completed workout history is immutable.");

    private static readonly (string Code, string Message) N9b2AStale =
        ("concurrency_conflict", "Training data was changed by another request.");

    private static readonly (string Code, string Message) N9b2ANotLastSet =
        ("own_workout_not_last_set", "Only an exercise's last set can be taken away.");

    private static readonly (string Code, string Message) N9b2ASetLimit =
        ("own_workout_limit", "An exercise holds at most 20 sets.");

    private static readonly (string Code, string Message) N9b2AHasNote =
        ("own_exercise_has_note", "This exercise has a note, so it stays in this workout.");

    private static readonly (string Code, string Message) N9b2AStaffNote =
        ("own_workout_staff_note", "Only the client writes notes on a workout of their own.");

    /// <summary>
    /// TRN-033 end to end, with TRN-019's reads: a trainee starts an empty workout of their own on the house's day, adds
    /// two pool exercises and their sets, logs them through the set route, takes away an exercise and a last set, and
    /// finishes it through the finish route; the finish summary, history, records, Today and the week read it.
    /// </summary>
    [TestMethod]
    public async Task N9b2AATraineeBuildsLogsAndFinishesAWorkoutOfTheirOwnAndEachOfTheirReadsCountsIt()
    {
        var today = N9b1FStartAtMidday();
        using var house = await N9a1OpenHouseAsync("n9b2a-flow", withCoach: true);
        var library = await N9b1PLibraryAsync(house.Coach!);
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9b2a-flow-dalia@example.test", address: "203.0.113.151");
        var client = trainee.Client;
        Assert.IsNull((await N9b2ATodayAsync(client)).OwnWorkout, "Nothing to carry on with before the first start.");

        // Started empty, on the house's day and under the rule's name, and Today offers to carry on with it beside the
        // day's program sessions, of which a trainee on Free has none.
        var started = RequiredTestClock.UtcNow;
        var workout = await N9b2AOkAsync<OwnWorkoutView>(N9b2AStartAsync(client));
        var id = workout.WorkoutExecutionId;
        Assert.AreEqual(
            ("Workout", today, WorkoutExecutionStatus.InProgress, started, (DateTimeOffset?)null, "no exercises", 0),
            (workout.Name, workout.Date, workout.Status, workout.StartedAtUtc, workout.CompletedAtUtc, N9b2ALine(workout), workout.Notes.Count));
        var day = await N9b2ATodayAsync(client);
        Assert.AreEqual(
            (true, (Guid?)id, (uint?)workout.Version, 0),
            (day.IsAllowed, day.OwnWorkout?.WorkoutExecutionId, day.OwnWorkout?.Version, day.Workouts.Count));

        // Two exercises from the pool, each after the others, then the sets meant: three squats and one carry.
        workout = await N9b2AOkAsync<OwnWorkoutView>(N9b2AAddExerciseAsync(client, id, library.Squat.Id, workout.Version));
        workout = await N9b2AOkAsync<OwnWorkoutView>(N9b2AAddExerciseAsync(client, id, library.Carry.Id, workout.Version));
        var squat = workout.Exercises[0].PerformanceId;
        var carry = workout.Exercises[1].PerformanceId;
        for (var count = 0; count < 3; count++)
        {
            workout = await N9b2AOkAsync<OwnWorkoutView>(N9b2AAddSetAsync(client, id, squat, workout.Version));
        }

        workout = await N9b2AOkAsync<OwnWorkoutView>(N9b2AAddSetAsync(client, id, carry, workout.Version));
        Assert.AreEqual("1 Back Squat: 1 empty, 2 empty, 3 empty | 2 Zercher Carry: 1 empty", N9b2ALine(workout));
        CollectionAssert.AreEqual(
            new[] { library.Squat.Id, library.Carry.Id },
            workout.Exercises.Select(item => item.ExerciseId).ToArray());
        var squatSets = workout.Exercises[0].Sets.Select(item => item.PerformanceId).ToArray();
        var carrySet = workout.Exercises[1].Sets.Single().PerformanceId;

        // Logged through the set route a program's workout uses, each with the version the last answer gave: the first
        // squat is a record, the lighter second is not, and the carry is logged too.
        var first = await N9b2AOkAsync<WorkoutSetSaveView>(N9b2ALogAsync(client, id, squatSets[0], 5, 100m, 8m, workout.Version));
        Assert.AreEqual(
            ("5x100 Kilogram @8", (decimal?)2m, true, true),
            (N9b2ATyped(first.ActualRepetitions, first.ActualLoad, first.ActualLoadUnit, first.ActualRpe), first.ActualRir,
                first.IsCompleted, first.IsPersonalRecord));
        var second = await N9b2AOkAsync<WorkoutSetSaveView>(N9b2ALogAsync(client, id, squatSets[1], 5, 90m, 7m, first.ExecutionVersion));
        Assert.IsFalse(second.IsPersonalRecord);
        var carried = await N9b2AOkAsync<WorkoutSetSaveView>(N9b2ALogAsync(client, id, carrySet, 1, 60m, null, second.ExecutionVersion));

        // The third squat was not done and the carry was a mistake: the last set and the whole exercise go, the carry's
        // logged set with it, and nothing of them is left in the tables.
        workout = await N9b2AOkAsync<OwnWorkoutView>(N9b2ARemoveSetAsync(client, id, squatSets[2], carried.ExecutionVersion));
        workout = await N9b2AOkAsync<OwnWorkoutView>(N9b2ARemoveExerciseAsync(client, id, carry, workout.Version));
        Assert.AreEqual("1 Back Squat: 1 5x100 Kilogram @8, 2 5x90 Kilogram @7", N9b2ALine(workout));
        Assert.AreEqual((1L, 2L), await N9b2ARowsAsync(id));
        foreach (var gone in new[] { carry, carrySet, squatSets[2] })
        {
            Assert.AreEqual(0L, await Phase6CountAsync(
                RequiredDatabaseConnection,
                """
                SELECT (SELECT count(*) FROM training."WorkoutExercisePerformances" WHERE "Id" = @id)
                     + (SELECT count(*) FROM training."WorkoutSetPerformances" WHERE "Id" = @id)
                """,
                gone));
        }

        // Finished forty minutes in through the finish route: two of two sets, 950 kg moved, and the first squat a record.
        RequiredTestClock.Advance(TimeSpan.FromMinutes(40));
        var finished = await N9b2AOkAsync<WorkoutExecutionView>(N9b2AFinishAsync(client, id, workout.Version));
        var summary = finished.FinishSummary!;
        Assert.AreEqual(
            (WorkoutExecutionStatus.Completed, (DateTimeOffset?)started.AddMinutes(40), 2400, 2, 2, (ClientProgramSummaryView?)null),
            (finished.Status, finished.CompletedAtUtc, summary.DurationSeconds, summary.CompletedSetCount, summary.TotalSetCount, summary.FinishedProgram));
        Assert.AreEqual("950 Kilogram", N9b2AVolume(summary.Volume));
        var record = $"{squatSets[0]} Back Squat 5x100 Kilogram ExactRepsLoad v1";
        Assert.AreEqual(record, N9b2ARecords(summary.PersonalRecords));

        // History lists it as a workout of their own, under its name, with no program.
        var history = await ReadSliceAsync<ClientWorkoutHistoryPage>(client, "/api/training/me/history");
        var item = history.Items.Single();
        Assert.AreEqual(
            (id, "Workout", string.Empty, true, today, 2400, 2, 2),
            (item.WorkoutExecutionId, item.Name, item.ProgramName, item.IsOwnWorkout, item.Date, item.DurationSeconds, item.CompletedSetCount, item.TotalSetCount));
        Assert.AreEqual(("950 Kilogram", record), (N9b2AVolume(item.Volume), N9b2ARecords(item.PersonalRecords)));

        // The record is theirs on the records read.
        var records = await ReadSliceAsync<ClientPersonalRecordsResult>(client, "/api/training/me/personal-records");
        var best = records.Items.Single();
        Assert.AreEqual(
            (true, library.Squat.Id, "Back Squat", today, 5, 100m, TrainingLoadUnit.Kilogram),
            (records.IsAllowed, best.ExerciseId, best.ExerciseName, best.Date, best.Repetitions, best.Load, best.Unit));

        // Today has nothing to carry on with again, and the week counts it on its day apart from any program's sessions.
        day = await N9b2ATodayAsync(client);
        Assert.AreEqual((true, (OwnWorkoutView?)null), (day.IsAllowed, day.OwnWorkout));
        var week = await ReadSliceAsync<ClientTrainingWeekView>(client, "/api/training/me/week");
        Assert.IsTrue(week.IsAllowed);
        Assert.AreEqual(1, week.Days.Single(item => item.Date == today).OwnCompleted);
        Assert.AreEqual(
            (0, 0, 1),
            (week.Days.Sum(item => item.Scheduled), week.Days.Sum(item => item.Completed), week.Days.Sum(item => item.OwnCompleted)));
    }

    /// <summary>
    /// TRN-033 with TRN-029 and LIB-004: last time reads only earlier days, and a start from a finished workout takes its
    /// exercises still in the pool, in order and under the pool's names now, each with as many empty sets as were done
    /// there and at least one; a source with nothing left in the pool is refused, and another trainee's, an unfinished
    /// or an unknown one is missing.
    /// </summary>
    [TestMethod]
    public async Task N9b2ALastTimeReadsEarlierDaysAndAStartFromAFinishedWorkoutCarriesItsLiftsStillInThePool()
    {
        var today = N9b1FStartAtMidday();
        var tomorrow = today.AddDays(1);
        using var house = await N9a1OpenHouseAsync("n9b2a-again", withCoach: true);
        var library = await N9b1PLibraryAsync(house.Coach!);
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9b2a-again-dalia@example.test", address: "203.0.113.152");
        using var karim = await N9a1TraineeAsync(
            house.TenantId, "n9b2a-again-karim@example.test", "Karim", "Nassar", address: "203.0.113.153");
        var client = trainee.Client;

        // Today: four exercises, the squat's third set and the hold's one set left undone.
        var full = await N9b2ABuildAsync(
            client,
            new N9b2ALift(library.Squat.Id, [new(5, 100m, 8m), new(5, 90m, 7m), null]),
            new N9b2ALift(library.Carry.Id, [new(1, 60m)]),
            new N9b2ALift(library.Raise.Id, [new(12, 8m)]),
            new N9b2ALift(library.Hold.Id, [null]));
        await N9b2AOkAsync<WorkoutExecutionView>(N9b2AFinishAsync(client, full.WorkoutExecutionId, full.Version));

        // Then a carry alone: a workout finished the same day is not its last time.
        R31Tick();
        var carry = await N9b2ABuildAsync(client, new N9b2ALift(library.Carry.Id, [new(1, 70m)]));
        Assert.AreEqual("none", N9b2ALastTime(carry.Exercises.Single().PreviousPerformance));
        await N9b2AOkAsync<WorkoutExecutionView>(N9b2AFinishAsync(client, carry.WorkoutExecutionId, carry.Version));

        // Karim finishes a workout of his own; the house's staff give Dalia a program, whose workout she starts and leaves
        // unfinished; and the coach archives the carry.
        var his = await N9b2ABuildAsync(karim.Client, new N9b2ALift(library.Squat.Id, [new(5, 80m)]));
        await N9b2AOkAsync<WorkoutExecutionView>(N9b2AFinishAsync(karim.Client, his.WorkoutExecutionId, his.Version));
        var training = await CreateTrainingResourcesAsync(house.Owner, trainee.ProfileId, 8, 1, today);
        await AssignAsync(house.Owner, trainee.ProfileId, training, today);
        var (program, _) = await A3StartTodayAsync(client);
        await N9b1PSetArchivedAsync(house.Coach!, library.Carry.Id, archived: true, library.Carry.Version);

        // The coach also renames the raise in the library.
        await RefreshCsrfAsync(house.Coach!);
        await AssertStatusAsync(
            await house.Coach!.PutAsJsonAsync($"/api/exercises/{library.Raise.Id}", new
            {
                name = "Lateral Raise",
                instructions = "Raise to shoulder height, slowly.",
                equipment = "Dumbbell",
                movementPattern = "Isolation",
                classification = "Strength",
                muscles = new[] { new { muscle = "Shoulders", role = "Primary" } },
                tags = Array.Empty<string>(),
                alternatives = Array.Empty<object>(),
                mediaAssetIds = Array.Empty<Guid>(),
                version = library.Raise.Version,
            }),
            HttpStatusCode.OK);

        // The next day. The carry alone has nothing left in the pool to start from; Karim's workout, her unfinished
        // program workout and an unknown id are missing; and none of them started anything.
        N9b1FSetHouseDay(tomorrow);
        Assert.AreEqual(N9b2ANothingToCopy, await A7ConflictAsync(await N9b2AStartAsync(client, carry.WorkoutExecutionId)));
        foreach (var (source, what) in new[]
                 {
                     (his.WorkoutExecutionId, "another trainee's"),
                     (program.Id, "unfinished"),
                     (Guid.NewGuid(), "unknown"),
                 })
        {
            Assert.AreEqual(HttpStatusCode.NotFound, (await N9b2AStartAsync(client, source)).StatusCode, what);
        }

        Assert.IsNull((await N9b2ATodayAsync(client)).OwnWorkout, "A refused start leaves nothing to carry on with.");
        Assert.AreEqual(2L, await N9b2AOwnRowsAsync(trainee.ProfileId));

        // From the full workout: the squat, raise and hold in their order, each under the name the pool gives it now, the
        // archived carry left out, with two, one and one empty sets (two squats done, one raise, and at least one for the
        // hold, none of whose was done).
        var again = await N9b2AOkAsync<OwnWorkoutView>(N9b2AStartAsync(client, full.WorkoutExecutionId));
        Assert.AreEqual(("Workout", tomorrow, WorkoutExecutionStatus.InProgress), (again.Name, again.Date, again.Status));
        Assert.AreNotEqual(full.WorkoutExecutionId, again.WorkoutExecutionId);
        CollectionAssert.AreEqual(
            new[] { library.Squat.Id, library.Raise.Id, library.Hold.Id },
            again.Exercises.Select(item => item.ExerciseId).ToArray());
        Assert.AreEqual("1 Back Squat: 1 empty, 2 empty | 2 Lateral Raise: 1 empty | 3 arch hold: 1 empty", N9b2ALine(again));

        // Last time is yesterday's workout, set by set as done; the hold, never done, has none.
        var yesterday = N9a1Day(today);
        var lastTime = new[]
        {
            $"{yesterday} best 5x100 Kilogram @8: 1 5x100 Kilogram @8, 2 5x90 Kilogram @7",
            $"{yesterday} best 12x8 Kilogram: 1 12x8 Kilogram",
            "none",
        };
        CollectionAssert.AreEqual(lastTime, again.Exercises.Select(item => N9b2ALastTime(item.PreviousPerformance)).ToArray());

        // Today offers to carry on with it, as started.
        var offered = await N9b2ACarryOnAsync(client);
        Assert.AreEqual(
            (again.WorkoutExecutionId, again.Version, N9b2ALine(again)),
            (offered.WorkoutExecutionId, offered.Version, N9b2ALine(offered)));
        CollectionAssert.AreEqual(lastTime, offered.Exercises.Select(item => N9b2ALastTime(item.PreviousPerformance)).ToArray());
    }

    /// <summary>
    /// TRN-033: one unfinished workout of one's own at a time. Two starts at once leave one workout and one refusal (the
    /// partial unique index), a start after it is refused with the reason, and a finished one blocks no new one.
    /// </summary>
    [TestMethod]
    public async Task N9b2AOneUnfinishedWorkoutOfOnesOwnAtATimeEvenWhenTwoStartAtOnce()
    {
        using var house = await N9a1OpenHouseAsync("n9b2a-once");
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9b2a-once-nour@example.test", "Nour", "Fares", address: "203.0.113.154");
        var client = trainee.Client;

        // Both starts are held at their insert, after both have found nothing unfinished.
        await RefreshCsrfAsync(client);
        RequiredInsertBarrier.Arm("training.\"WorkoutExecutions\"", 2);
        HttpResponseMessage[] starts;
        try
        {
            starts = await Task.WhenAll(
                client.PostAsJsonAsync(N9b2AWorkoutsUrl, new { fromWorkoutId = (Guid?)null }),
                client.PostAsJsonAsync(N9b2AWorkoutsUrl, new { fromWorkoutId = (Guid?)null }));
            Assert.IsGreaterThanOrEqualTo(2, RequiredInsertBarrier.Arrived, "The two starts never raced.");
        }
        finally
        {
            RequiredInsertBarrier.Disarm();
        }

        Assert.AreEqual(1, starts.Count(item => item.StatusCode == HttpStatusCode.OK), "One start wins.");
        Assert.AreEqual(N9b2AInProgress, await A7ConflictAsync(starts.Single(item => item.StatusCode != HttpStatusCode.OK)));
        var workout = await ReadSlicePayloadAsync<OwnWorkoutView>(starts.Single(item => item.StatusCode == HttpStatusCode.OK));
        Assert.AreEqual(1L, await N9b2AOwnRowsAsync(trainee.ProfileId));
        Assert.AreEqual(workout.WorkoutExecutionId, (await N9b2ACarryOnAsync(client)).WorkoutExecutionId);

        // One after the other, the same answer: carry on with it, or finish it first.
        Assert.AreEqual(N9b2AInProgress, await A7ConflictAsync(await N9b2AStartAsync(client)));

        // Finished, with nothing logged, it blocks no new start; while the new one runs, nothing starts, not even from
        // a finished workout.
        var finished = await N9b2AOkAsync<WorkoutExecutionView>(N9b2AFinishAsync(client, workout.WorkoutExecutionId, workout.Version));
        Assert.AreEqual(
            (WorkoutExecutionStatus.Completed, 0, 0),
            (finished.Status, finished.FinishSummary!.CompletedSetCount, finished.FinishSummary.TotalSetCount));
        var next = await N9b2AOkAsync<OwnWorkoutView>(N9b2AStartAsync(client));
        Assert.AreEqual(N9b2AInProgress, await A7ConflictAsync(await N9b2AStartAsync(client, workout.WorkoutExecutionId)));
        Assert.AreEqual(2L, await N9b2AOwnRowsAsync(trainee.ProfileId));
        Assert.AreEqual(next.WorkoutExecutionId, (await N9b2ACarryOnAsync(client)).WorkoutExecutionId);
    }

    /// <summary>
    /// TRN-033 with ADR 0026: another trainee's workout, exercise and set are missing on every route that starts or changes
    /// a workout of one's own, the set and finish routes included, also inside a workout of the caller's own; nothing changes.
    /// </summary>
    [TestMethod]
    public async Task N9b2AAnotherTraineesWorkoutExerciseAndSetAreMissingOnEveryRoute()
    {
        using var house = await N9a1OpenHouseAsync("n9b2a-other", withCoach: true);
        var library = await N9b1PLibraryAsync(house.Coach!);
        using var dalia = await N9a1TraineeAsync(house.TenantId, "n9b2a-other-dalia@example.test", address: "203.0.113.155");
        using var karim = await N9a1TraineeAsync(
            house.TenantId, "n9b2a-other-karim@example.test", "Karim", "Nassar", address: "203.0.113.156");

        // Dalia has a workout of her own finished and another under way.
        var done = await N9b2ABuildAsync(dalia.Client, new N9b2ALift(library.Squat.Id, [new(5, 100m)]));
        await N9b2AOkAsync<WorkoutExecutionView>(N9b2AFinishAsync(dalia.Client, done.WorkoutExecutionId, done.Version));
        var open = await N9b2ABuildAsync(dalia.Client, new N9b2ALift(library.Squat.Id, [new(5, 100m), null]));
        var exercise = open.Exercises.Single();
        var last = exercise.Sets[^1].PerformanceId;
        var rows = (await N9b2ARowsAsync(done.WorkoutExecutionId), await N9b2ARowsAsync(open.WorkoutExecutionId));

        // Karim, a trainee of the same house with Training open, sends her ids to every route: each is missing to him.
        await AssertStatusAsync(await N9b2AStartAsync(karim.Client, done.WorkoutExecutionId), HttpStatusCode.NotFound);
        foreach (var (route, response) in await N9b2AChangesAsync(
                     karim.Client, open.WorkoutExecutionId, library.Hold.Id, exercise.PerformanceId, last, open.Version))
        {
            Assert.AreEqual(HttpStatusCode.NotFound, response.StatusCode, route);
        }

        // In a workout of his own, her exercise and her set are not his either.
        var his = await N9b2AOkAsync<OwnWorkoutView>(N9b2AStartAsync(karim.Client));
        foreach (var (route, response) in new[]
                 {
                     ("take her exercise out of his", await N9b2ARemoveExerciseAsync(
                         karim.Client, his.WorkoutExecutionId, exercise.PerformanceId, his.Version)),
                     ("add a set to her exercise in his", await N9b2AAddSetAsync(
                         karim.Client, his.WorkoutExecutionId, exercise.PerformanceId, his.Version)),
                     ("take her set out of his", await N9b2ARemoveSetAsync(karim.Client, his.WorkoutExecutionId, last, his.Version)),
                 })
        {
            Assert.AreEqual(HttpStatusCode.NotFound, response.StatusCode, route);
        }

        // Nothing changed: her two workouts as they were, and his as he started it.
        var hers = await N9b2ACarryOnAsync(dalia.Client);
        Assert.AreEqual(
            (open.WorkoutExecutionId, open.Version, "1 Back Squat: 1 5x100 Kilogram, 2 empty"),
            (hers.WorkoutExecutionId, hers.Version, N9b2ALine(hers)));
        Assert.AreEqual(rows, (await N9b2ARowsAsync(done.WorkoutExecutionId), await N9b2ARowsAsync(open.WorkoutExecutionId)));
        var stillHis = await N9b2ACarryOnAsync(karim.Client);
        Assert.AreEqual((his.Version, "no exercises"), (stillHis.Version, N9b2ALine(stillHis)));
        Assert.AreEqual((2L, 1L), (await N9b2AOwnRowsAsync(dalia.ProfileId), await N9b2AOwnRowsAsync(karim.ProfileId)));
    }

    /// <summary>
    /// TRN-033 with LIB-006 and CLI-024: only the house starts a workout of one's own. A coach's client with Training open
    /// starts none under their coach's header, nor does a trainee of the house who is that coach's client too until back
    /// under the house's; and a program's workout takes no exercise or set added or taken away (own_workout_only).
    /// </summary>
    [TestMethod]
    public async Task N9b2AOnlyTheHouseStartsOneAndNoProgramsWorkoutTakesAnExerciseOrSetAddedOrTakenAway()
    {
        var today = N9b1FStartAtMidday();
        using var house = await N9a1OpenHouseAsync("n9b2a-who", withCoach: true);
        var library = await N9b1PLibraryAsync(house.Coach!);
        using var zeina = CreateClient();
        await RegisterCoachAsync(zeina, "n9b2a-who-zeina@example.test", "Zeina Aoun", "N9b2A Who Zeina Gym");

        // Maya, Zeina's client, with a plan covering Training: under Zeina's header no workout of one's own starts.
        using var maya = CreateClient();
        var mayaId = await InviteAndAcceptAsync(zeina, maya, "n9b2a-who-maya@example.test", newAccount: true);
        var plan = await CreateFreeTrainingEnrollmentAsync(zeina, mayaId, today);
        Assert.AreEqual("Granted", await N9b1PTrainingAsync(maya));
        await AssertStatusAsync(await N9b2AStartAsync(maya), HttpStatusCode.NotFound);
        Assert.AreEqual(0L, await N9b2AOwnRowsAsync(mayaId));

        // Zeina gives her a program on that plan, and Maya starts today's workout of it.
        var alternative = await CreateExerciseAsync(zeina, "Scenario alternative", [], []);
        var programSquat = await CreateExerciseAsync(zeina, "Scenario squat", [alternative.Id], []);
        var resources = new TrainingResources(
            new CoverageEnrollment(plan.Id, today.AddDays(56), plan.Version),
            null,
            alternative,
            programSquat,
            await RecordWorkingMaxAsync(zeina, mayaId, programSquat.Id, 100m),
            await CreateTemplateWithWeeksAsync(zeina, programSquat.Id, alternative.Id, 1));
        await AssignAsync(zeina, mayaId, resources, today);
        var (program, day) = await A3StartTodayAsync(maya);
        var exercise = day.Exercises.Single();
        var performanceId = exercise.PerformanceId!.Value;
        var setId = exercise.Sets.Single().PerformanceId!.Value;
        var rows = await N9b2ARowsAsync(program.Id);

        // Its own ids on the four routes that add or take away: refused as a program's workout, and nothing changes.
        foreach (var (route, response) in new[]
                 {
                     ("add an exercise", await N9b2AAddExerciseAsync(maya, program.Id, alternative.Id, program.Version)),
                     ("take an exercise away", await N9b2ARemoveExerciseAsync(maya, program.Id, performanceId, program.Version)),
                     ("add a set", await N9b2AAddSetAsync(maya, program.Id, performanceId, program.Version)),
                     ("take a set away", await N9b2ARemoveSetAsync(maya, program.Id, setId, program.Version)),
                 })
        {
            Assert.AreEqual(N9b2ANotOwn, await A7ConflictAsync(response), route);
        }

        Assert.AreEqual((1L, 1L), rows);
        Assert.AreEqual(rows, await N9b2ARowsAsync(program.Id));

        // Jad, a trainee of the house who is Zeina's client too, with Training open there: under her header nothing
        // starts; under the house's his workout of his own does.
        const string jadEmail = "n9b2a-who-jad@example.test";
        using var jad = await N9a1TraineeAsync(house.TenantId, jadEmail, "Jad", "Rizk", address: "203.0.113.157");
        var jadThere = await InviteAndAcceptAsync(zeina, jad.Client, jadEmail, newAccount: false);
        await CreateFreeTrainingEnrollmentAsync(zeina, jadThere, N9a1HouseToday());
        Assert.AreEqual("Granted", await N9b1PTrainingAsync(jad.Client));
        await AssertStatusAsync(await N9b2AStartAsync(jad.Client), HttpStatusCode.NotFound);
        SetTenant(jad.Client, house.TenantId);
        var jads = await N9b2AOkAsync<OwnWorkoutView>(N9b2AStartAsync(jad.Client));
        jads = await N9b2AOkAsync<OwnWorkoutView>(N9b2AAddExerciseAsync(jad.Client, jads.WorkoutExecutionId, library.Squat.Id, jads.Version));
        Assert.AreEqual((today, "1 Back Squat: no sets"), (jads.Date, N9b2ALine(jads)));
        Assert.AreEqual((0L, 1L), (await N9b2AOwnRowsAsync(jadThere), await N9b2AOwnRowsAsync(jad.ProfileId)));
    }

    /// <summary>
    /// TRN-033 with SUB-010 and the TenantClient policy: a trainee the house blocks is refused (403) on every route, with
    /// nothing to carry on with on Today until unblocked; the house's owner and coach are refused (403) and someone
    /// signed out is asked to sign in (401); the workout is left as it was.
    /// </summary>
    [TestMethod]
    public async Task N9b2AABlockedTraineeTheHousesStaffAndSomeoneSignedOutChangeNothing()
    {
        using var house = await N9a1OpenHouseAsync("n9b2a-closed", withCoach: true);
        var library = await N9b1PLibraryAsync(house.Coach!);
        using var trainee = await N9a1TraineeAsync(
            house.TenantId, "n9b2a-closed-lina@example.test", "Lina", "Saleh", address: "203.0.113.158");
        var client = trainee.Client;
        var workout = await N9b2ABuildAsync(client, new N9b2ALift(library.Squat.Id, [new(5, 100m), null]));
        var exercise = workout.Exercises.Single();
        var last = exercise.Sets[^1].PerformanceId;

        // Blocked, Training is closed: Today offers nothing to carry on with, and every route refuses before it asks
        // whether a workout is under way.
        await B4aSetBlockedAsync(house.Owner, trainee.ProfileId, blocked: true);
        var day = await N9b2ATodayAsync(client);
        Assert.AreEqual(
            (false, "RelationshipBlocked", (OwnWorkoutView?)null),
            (day.IsAllowed, day.AccessReason, day.OwnWorkout));
        await AssertStatusAsync(await N9b2AStartAsync(client), HttpStatusCode.Forbidden);
        foreach (var (route, response) in await N9b2AChangesAsync(
                     client, workout.WorkoutExecutionId, library.Hold.Id, exercise.PerformanceId, last, workout.Version))
        {
            Assert.AreEqual(HttpStatusCode.Forbidden, response.StatusCode, route);
        }

        // The house's owner and coach are no client of it, and someone signed out is nobody yet.
        using var anonymous = CreateClient();
        SetTenant(anonymous, house.TenantId);
        foreach (var (caller, who, status) in new[]
                 {
                     (house.Owner, "owner", HttpStatusCode.Forbidden),
                     (house.Coach!, "coach", HttpStatusCode.Forbidden),
                     (anonymous, "signed out", HttpStatusCode.Unauthorized),
                 })
        {
            Assert.AreEqual(status, (await N9b2AStartAsync(caller)).StatusCode, $"{who}: start");
            foreach (var (route, response) in await N9b2AChangesAsync(
                         caller, workout.WorkoutExecutionId, library.Hold.Id, exercise.PerformanceId, last, workout.Version))
            {
                Assert.AreEqual(status, response.StatusCode, $"{who}: {route}");
            }
        }

        // Unblocked, the workout is offered again exactly as it was left.
        await B4aSetBlockedAsync(house.Owner, trainee.ProfileId, blocked: false);
        var back = await N9b2ACarryOnAsync(client);
        Assert.AreEqual(
            (workout.WorkoutExecutionId, workout.Version, "1 Back Squat: 1 5x100 Kilogram, 2 empty"),
            (back.WorkoutExecutionId, back.Version, N9b2ALine(back)));
        Assert.AreEqual(1L, await N9b2AOwnRowsAsync(trainee.ProfileId));
    }

    /// <summary>
    /// TRN-033's refusals of a running workout of one's own: a stale version (concurrency_conflict) on every route that
    /// adds or takes away, a set that is not its exercise's last, a twenty-first set, an exercise not in use in the
    /// house's pool (missing), and a swap to another exercise (substitution_not_allowed); none of them changes it.
    /// </summary>
    [TestMethod]
    public async Task N9b2AStaleOutOfOrderAndOverTheLimitChangesExercisesOutsideThePoolAndSwapsAreRefused()
    {
        using var house = await N9a1OpenHouseAsync("n9b2a-state", withCoach: true);
        var library = await N9b1PLibraryAsync(house.Coach!);
        using var stranger = CreateClient();
        await RegisterCoachAsync(stranger, "n9b2a-state-rami@example.test", "Rami Saad", "N9b2A State Elsewhere");
        var theirs = await N9b1PExerciseAsync(stranger, N9b1PBody(
            "Box Squat", "Strength", "Barbell", "Squat", [("Quadriceps", "Primary")], null, []));
        using var trainee = await N9a1TraineeAsync(
            house.TenantId, "n9b2a-state-omar@example.test", "Omar", "Khalil", address: "203.0.113.159");
        var client = trainee.Client;
        var workout = await N9b2AOkAsync<OwnWorkoutView>(N9b2AStartAsync(client));
        var id = workout.WorkoutExecutionId;
        var stale = workout.Version;
        workout = await N9b2AOkAsync<OwnWorkoutView>(N9b2AAddExerciseAsync(client, id, library.Squat.Id, workout.Version));
        var squat = workout.Exercises.Single().PerformanceId;
        workout = await N9b2AOkAsync<OwnWorkoutView>(N9b2AAddSetAsync(client, id, squat, workout.Version));
        workout = await N9b2AOkAsync<OwnWorkoutView>(N9b2AAddSetAsync(client, id, squat, workout.Version));
        var (first, second) = (workout.Exercises[0].Sets[0].PerformanceId, workout.Exercises[0].Sets[1].PerformanceId);

        // A tab still showing the workout as it began: every change it sends is refused, and none is made.
        foreach (var (route, response) in new[]
                 {
                     ("add an exercise", await N9b2AAddExerciseAsync(client, id, library.Raise.Id, stale)),
                     ("take an exercise away", await N9b2ARemoveExerciseAsync(client, id, squat, stale)),
                     ("add a set", await N9b2AAddSetAsync(client, id, squat, stale)),
                     ("take a set away", await N9b2ARemoveSetAsync(client, id, second, stale)),
                 })
        {
            Assert.AreEqual(N9b2AStale, await A7ConflictAsync(response), route);
        }

        var unchanged = await N9b2ACarryOnAsync(client);
        Assert.AreEqual((workout.Version, "1 Back Squat: 1 empty, 2 empty"), (unchanged.Version, N9b2ALine(unchanged)));

        // Only an exercise's last set is taken away, so its sets keep their numbers.
        Assert.AreEqual(N9b2ANotLastSet, await A7ConflictAsync(await N9b2ARemoveSetAsync(client, id, first, workout.Version)));

        // Twenty sets an exercise, as a program's session holds: the twenty-first is refused.
        for (var count = 2; count < 20; count++)
        {
            workout = await N9b2AOkAsync<OwnWorkoutView>(N9b2AAddSetAsync(client, id, squat, workout.Version));
        }

        Assert.HasCount(20, workout.Exercises.Single().Sets);
        Assert.AreEqual(N9b2ASetLimit, await A7ConflictAsync(await N9b2AAddSetAsync(client, id, squat, workout.Version)));

        // Only an exercise in use in the house's pool is added: an archived one, another workspace's and an unknown id
        // are missing alike.
        foreach (var (exerciseId, what) in new[]
                 {
                     (library.Goblet.Id, "archived"),
                     (theirs.Id, "another workspace's"),
                     (Guid.NewGuid(), "unknown"),
                 })
        {
            Assert.AreEqual(
                HttpStatusCode.NotFound,
                (await N9b2AAddExerciseAsync(client, id, exerciseId, workout.Version)).StatusCode,
                what);
        }

        // An exercise of one's own is its own prescription, locked: the swap route takes it to no other exercise.
        Assert.AreEqual(
            "substitution_not_allowed",
            (await A7ConflictAsync(await A3SwapAsync(client, id, squat, library.Hold.Id, workout.Version))).Code);

        var after = await N9b2ACarryOnAsync(client);
        Assert.AreEqual(
            (workout.Version, library.Squat.Id, 20),
            (after.Version, after.Exercises.Single().ExerciseId, after.Exercises.Single().Sets.Count));
    }

    /// <summary>
    /// TRN-033 with TRN-012: a finished workout of one's own is history; every route that changes one, the set and finish
    /// routes included, answers workout_immutable, and its rows stay as they were.
    /// </summary>
    [TestMethod]
    public async Task N9b2AAFinishedWorkoutOfOnesOwnTakesNoChangeOnAnyRoute()
    {
        using var house = await N9a1OpenHouseAsync("n9b2a-frozen", withCoach: true);
        var library = await N9b1PLibraryAsync(house.Coach!);
        using var trainee = await N9a1TraineeAsync(
            house.TenantId, "n9b2a-frozen-hala@example.test", "Hala", "Daher", address: "203.0.113.160");
        var client = trainee.Client;
        var workout = await N9b2ABuildAsync(client, new N9b2ALift(library.Squat.Id, [new(5, 100m), null]));
        var id = workout.WorkoutExecutionId;
        var exercise = workout.Exercises.Single();
        var finished = await N9b2AOkAsync<WorkoutExecutionView>(N9b2AFinishAsync(client, id, workout.Version));
        var rows = await N9b2ARowsAsync(id);

        // Sent with the version the finish gave, so it is the finish that refuses each, not a stale tab.
        foreach (var (route, response) in await N9b2AChangesAsync(
                     client, id, library.Hold.Id, exercise.PerformanceId, exercise.Sets[^1].PerformanceId, finished.Version))
        {
            Assert.AreEqual(N9b2AImmutable, await A7ConflictAsync(response), route);
        }

        Assert.AreEqual((1L, 2L), rows);
        Assert.AreEqual(rows, await N9b2ARowsAsync(id));
        var item = (await ReadSliceAsync<ClientWorkoutHistoryPage>(client, "/api/training/me/history")).Items.Single();
        Assert.AreEqual(
            (id, 1, 2, "500 Kilogram"),
            (item.WorkoutExecutionId, item.CompletedSetCount, item.TotalSetCount, N9b2AVolume(item.Volume)));
    }

    /// <summary>
    /// TRN-033 with TRN-009 and ADR 0036: only the client writes notes on a workout of their own; they are kept, an exercise
    /// with one stays in the workout, the house's owner and coach write none (own_workout_staff_note), and no note on it
    /// queues a notice, not even for a client the house invited, whose coach a note on a program's workout would tell.
    /// </summary>
    [TestMethod]
    public async Task N9b2AOnlyTheClientWritesNotesOnTheirOwnWorkoutTheyTellNobodyAndANotedExerciseStays()
    {
        var today = N9b1FStartAtMidday();
        using var house = await N9a1OpenHouseAsync("n9b2a-notes", withCoach: true);
        var library = await N9b1PLibraryAsync(house.Coach!);
        using var trainee = await N9a1TraineeAsync(
            house.TenantId, "n9b2a-notes-sami@example.test", "Sami", "Aoun", address: "203.0.113.161");
        var client = trainee.Client;
        var workout = await N9b2ABuildAsync(
            client,
            new N9b2ALift(library.Squat.Id, [new(5, 100m)]),
            new N9b2ALift(library.Hold.Id, [null]));
        var id = workout.WorkoutExecutionId;
        var (squat, hold) = (workout.Exercises[0].PerformanceId, workout.Exercises[1].PerformanceId);

        // The trainee's notes, one on the squat and one on the workout, a minute apart, are kept.
        await AssertStatusAsync(await N9b2ANoteAsync(client, id, squat, "Knees stayed out today"), HttpStatusCode.OK);
        R31Tick();
        await AssertStatusAsync(await N9b2ANoteAsync(client, id, null, "Short on sleep"), HttpStatusCode.OK);

        // The house's owner and coach, the coach being the one the trainee's record names, write none on it.
        foreach (var (staff, who) in new[] { (house.Owner, "owner"), (house.Coach!, "coach") })
        {
            Assert.AreEqual(N9b2AStaffNote, await A7ConflictAsync(await N9b2ANoteAsync(staff, id, null, "Strong work")), who);
        }

        // A note holds its exercise, so the squat stays; the hold, with none, goes.
        workout = await N9b2ACarryOnAsync(client);
        Assert.AreEqual(N9b2AHasNote, await A7ConflictAsync(await N9b2ARemoveExerciseAsync(client, id, squat, workout.Version)));
        workout = await N9b2AOkAsync<OwnWorkoutView>(N9b2ARemoveExerciseAsync(client, id, hold, workout.Version));
        Assert.AreEqual("1 Back Squat: 1 5x100 Kilogram", N9b2ALine(workout));
        CollectionAssert.AreEqual(
            new[]
            {
                ((Guid?)squat, WorkoutNoteAuthorRole.Client, "Knees stayed out today"),
                ((Guid?)null, WorkoutNoteAuthorRole.Client, "Short on sleep"),
            },
            workout.Notes.Select(note => (note.ExercisePerformanceId, note.AuthorRole, note.Text)).ToArray());

        // Finished, history carries both notes; and nothing was queued to tell anybody of either.
        await N9b2AOkAsync<WorkoutExecutionView>(N9b2AFinishAsync(client, id, workout.Version));
        var item = (await ReadSliceAsync<ClientWorkoutHistoryPage>(client, "/api/training/me/history")).Items.Single();
        Assert.AreEqual((id, 2), (item.WorkoutExecutionId, item.Notes.Count));
        Assert.AreEqual(0, await N9b2ANoticesAsync(id));

        // A client the house's coach invited and coaches, on a program of the house's: her note on its workout tells the
        // coach (the outbox read sees it), and her note on a workout of her own tells nobody.
        using var rana = CreateClient();
        var ranaId = await R31InviteAsync(house.Coach!, rana, house.TenantId, "n9b2a-notes-rana@example.test", "Rana", "Haddad");
        Assert.AreEqual((false, house.CoachUserId), await N9b2ACoachedAsync(ranaId));
        var training = await CreateTrainingResourcesAsync(house.Owner, ranaId, 8, 1, today);
        await AssignAsync(house.Owner, ranaId, training, today);
        var (program, _) = await A3StartTodayAsync(rana);
        await AssertStatusAsync(await N9b2ANoteAsync(rana, program.Id, null, "Left knee hurt on the last set"), HttpStatusCode.OK);
        Assert.AreEqual(1, await N9b2ANoticesAsync(program.Id), "A note on her program's workout tells her coach.");
        var hers = await N9b2AOkAsync<OwnWorkoutView>(N9b2AStartAsync(rana));
        await AssertStatusAsync(await N9b2ANoteAsync(rana, hers.WorkoutExecutionId, null, "First time on my own"), HttpStatusCode.OK);
        Assert.HasCount(1, (await N9b2ACarryOnAsync(rana)).Notes);
        Assert.AreEqual(0, await N9b2ANoticesAsync(hers.WorkoutExecutionId));
    }

    /// <summary>
    /// TRN-033 with MED-017: an exercise of the pool brings its demos that open now into the workout of one's own, the
    /// trainee's grant opens a clip linked when the exercise was made, and an archived exercise shows none.
    /// </summary>
    [TestMethod]
    public async Task N9b2AAPoolDemoShowsOnTheWorkoutAndOpensForTheTraineeUntilItsExerciseIsArchived()
    {
        using var house = await N9a1OpenHouseAsync("n9b2a-demo", withCoach: true);
        var coach = house.Coach!;
        var clip = await N9b1PUploadClipAsync(coach);
        var squat = await N9b1PExerciseAsync(coach, N9b1PBody(
            "Back Squat", "Strength", "Barbell", "Squat", [("Quadriceps", "Primary")], "Brace, then sit between the hips.", [],
            mediaAssetIds: [clip.Id]));
        var plank = await N9b1PExerciseAsync(coach, N9b1PBody(
            "Front Plank", "Other", "Bodyweight", "Other", [("Abdominals", "Primary")], null, []));
        using var trainee = await N9a1TraineeAsync(
            house.TenantId, "n9b2a-demo-maher@example.test", "Maher", "Awad", address: "203.0.113.162");
        var client = trainee.Client;
        var workout = await N9b2AOkAsync<OwnWorkoutView>(N9b2AStartAsync(client));
        workout = await N9b2AOkAsync<OwnWorkoutView>(N9b2AAddExerciseAsync(client, workout.WorkoutExecutionId, squat.Id, workout.Version));
        workout = await N9b2AOkAsync<OwnWorkoutView>(N9b2AAddExerciseAsync(client, workout.WorkoutExecutionId, plank.Id, workout.Version));
        CollectionAssert.AreEqual(new[] { clip.Id }, workout.Exercises[0].MediaAssetIds.ToArray());
        Assert.IsEmpty(workout.Exercises[1].MediaAssetIds);

        // The clip opens for the trainee through the private grant every demo uses.
        N9b1PCatchUpClock();
        var grant = await N9b1PGrantAsync(client, clip.Id);
        var played = await client.GetAsync(grant.Url);
        await AssertStatusAsync(played, HttpStatusCode.OK);
        Assert.AreEqual("video/mp4", played.Content.Headers.ContentType?.MediaType);

        // Archived, the squat stays in the workout with no demo, and its clip no longer opens.
        await N9b1PSetArchivedAsync(coach, squat.Id, archived: true, squat.Version);
        var archived = await N9b2ACarryOnAsync(client);
        Assert.AreEqual(
            ("Back Squat", 0),
            (archived.Exercises[0].ExerciseName, archived.Exercises[0].MediaAssetIds.Count));
        Assert.AreEqual(HttpStatusCode.NotFound, (await N9b1PAccessAsync(client, clip.Id)).StatusCode);
    }

    /// <summary>
    /// TRN-033 with TRN-019: the client's coach opens no page of a workout of the client's own, under way or finished,
    /// yet reads its record on the client's records and its set on the client's history of the exercise.
    /// </summary>
    [TestMethod]
    public async Task N9b2ATheCoachOpensNoWorkoutOfTheClientsOwnButReadsItsRecordAndItsSet()
    {
        var today = N9b1FStartAtMidday();
        using var house = await N9a1OpenHouseAsync("n9b2a-coach", withCoach: true);
        var library = await N9b1PLibraryAsync(house.Coach!);
        using var trainee = await N9a1TraineeAsync(
            house.TenantId, "n9b2a-coach-yara@example.test", "Yara", "Haddad", address: "203.0.113.163");
        var coach = house.Coach!;
        var workout = await N9b2ABuildAsync(trainee.Client, new N9b2ALift(library.Squat.Id, [new(5, 100m, 8m)]));
        var id = workout.WorkoutExecutionId;
        var page = $"/api/training/clients/{trainee.ProfileId}/workouts/{id}";
        await AssertStatusAsync(await coach.GetAsync(page), HttpStatusCode.NotFound);
        await N9b2AOkAsync<WorkoutExecutionView>(N9b2AFinishAsync(trainee.Client, id, workout.Version));
        await AssertStatusAsync(await coach.GetAsync(page), HttpStatusCode.NotFound);

        var records = await ReadSliceAsync<ClientPersonalRecordsResult>(
            coach, $"/api/training/clients/{trainee.ProfileId}/personal-records");
        var record = records.Items.Single();
        Assert.AreEqual(
            (true, library.Squat.Id, "Back Squat", today, 5, 100m, TrainingLoadUnit.Kilogram),
            (records.IsAllowed, record.ExerciseId, record.ExerciseName, record.Date, record.Repetitions, record.Load, record.Unit));

        var history = await ReadSliceAsync<ExerciseHistoryPage>(
            coach, $"/api/training/clients/{trainee.ProfileId}/exercises/{library.Squat.Id}/history");
        var set = history.Items.Single();
        Assert.AreEqual(
            (1, id, today, (int?)5, (decimal?)100m, (decimal?)8m),
            (history.Total, set.WorkoutExecutionId, set.Date, set.Repetitions, set.Load, set.Rpe));

        // The same page opens a program's workout of the same client: it is the workout being their own that hides it.
        var training = await CreateTrainingResourcesAsync(house.Owner, trainee.ProfileId, 8, 1, today);
        await AssignAsync(house.Owner, trainee.ProfileId, training, today);
        var (program, _) = await A3StartTodayAsync(trainee.Client);
        await AssertStatusAsync(
            await coach.GetAsync($"/api/training/clients/{trainee.ProfileId}/workouts/{program.Id}"),
            HttpStatusCode.OK);
    }

    /// <summary>
    /// TRN-033 with the sensitive-data rule: a set's note on a workout of one's own, saved, refused as stale and refused
    /// for an effort off the scale, reaches no log line, with or without the exception it carried.
    /// </summary>
    [TestMethod]
    public async Task N9b2AASetsNoteOnAWorkoutOfOnesOwnReachesNoLog()
    {
        using var house = await N9a1OpenHouseAsync("n9b2a-log", withCoach: true);
        var library = await N9b1PLibraryAsync(house.Coach!);
        using var trainee = await N9a1TraineeAsync(
            house.TenantId, "n9b2a-log-dina@example.test", "Dina", "Mrad", address: "203.0.113.164");
        var client = trainee.Client;
        var workout = await N9b2ABuildAsync(client, new N9b2ALift(library.Squat.Id, [null]));
        var id = workout.WorkoutExecutionId;
        var setId = workout.Exercises.Single().Sets.Single().PerformanceId;

        var saved = await N9b2AOkAsync<WorkoutSetSaveView>(N9b2ALogAsync(client, id, setId, 5, 100m, 8m, workout.Version, N9b2AMarker));
        Assert.AreEqual(N9b2AMarker, saved.ClientNote);
        Assert.AreEqual(N9b2AStale, await A7ConflictAsync(await N9b2ALogAsync(client, id, setId, 5, 105m, 8m, workout.Version, N9b2AMarker)));
        await AssertStatusAsync(
            await N9b2ALogAsync(client, id, setId, 5, 105m, 8.2m, saved.ExecutionVersion, N9b2AMarker),
            HttpStatusCode.BadRequest);
        Assert.AreEqual(N9b2AMarker, (await N9b2ACarryOnAsync(client)).Exercises.Single().Sets.Single().ClientNote);
        await N9b2AOkAsync<WorkoutExecutionView>(N9b2AFinishAsync(client, id, saved.ExecutionVersion));
        Assert.HasCount(1, (await ReadSliceAsync<ClientWorkoutHistoryPage>(client, "/api/training/me/history")).Items);

        Assert.IsFalse(string.IsNullOrEmpty(RequiredEveryLogLine.Text), "The host logged nothing, so the capture proves nothing.");
        Assert.DoesNotContain(N9b2AMarker, RequiredEveryLogLine.Text);
        Assert.DoesNotContain(N9b2AMarker, RequiredSensitiveLogCapture.Text);
    }

    /// <summary>
    /// TRN-033 with A10b's surface rules: the five new routes are writes behind the TenantClient policy alone, under the
    /// routine write limit, never kept open while a workspace is read-only, never anonymous, naming no client.
    /// </summary>
    [TestMethod]
    public void N9b2AFiveNewRoutesAreWritesOfAClientAloneUnderTheRoutineLimit()
    {
        var routes = A10bApiRoutes().Where(route => N9b2ARouteNames.Contains(A10bName(route))).ToArray();
        CollectionAssert.AreEquivalent(N9b2ARouteNames, routes.Select(A10bName).ToArray());

        foreach (var route in routes)
        {
            var name = A10bName(route);
            Assert.StartsWith(N9b2AWorkoutsUrl, route.RoutePattern.RawText!, name);
            var policies = route.Metadata.GetOrderedMetadata<IAuthorizeData>()
                .Select(data => data.Policy)
                .OfType<string>()
                .ToArray();
            CollectionAssert.AreEqual(N9b2ATenantClientPolicy, policies, $"{name} is not behind the TenantClient policy alone.");
            Assert.IsNull(route.Metadata.GetMetadata<IAllowAnonymous>(), name);
            var methods = route.Metadata.GetMetadata<IHttpMethodMetadata>();
            CollectionAssert.AreEqual(
                name.StartsWith("Remove", StringComparison.Ordinal) ? N9b2ADeleteOnly : N9b2APostOnly,
                methods?.HttpMethods.ToArray(),
                name);
            Assert.IsTrue(WriteRateLimiting.IsStateChanging(methods), name);
            Assert.AreEqual(RateLimitPolicies.RoutineWrite, A10bPolicy(route), $"{name} is not under the routine write limit.");
            Assert.IsNull(
                route.Metadata.GetMetadata<AllowedWhileWorkspaceReadOnly>(),
                $"{name}: no client route is on the list kept open while a workspace is read-only.");
            CollectionAssert.IsSubsetOf(
                route.RoutePattern.Parameters.Select(parameter => parameter.Name).ToArray(),
                N9b2ARouteParameters,
                $"{name} names no client in its route.");
        }
    }

    // ---------- helpers (writer A of N9b2: a workout of one's own) ----------

    /// <summary>Starts a workout of one's own, empty or from <paramref name="fromWorkoutId"/>, whatever the answer.</summary>
    private static async Task<HttpResponseMessage> N9b2AStartAsync(HttpClient client, Guid? fromWorkoutId = null)
    {
        await RefreshCsrfAsync(client);
        return await client.PostAsJsonAsync(N9b2AWorkoutsUrl, new { fromWorkoutId });
    }

    private static async Task<HttpResponseMessage> N9b2AAddExerciseAsync(HttpClient client, Guid workoutId, Guid exerciseId, uint version)
    {
        await RefreshCsrfAsync(client);
        return await client.PostAsJsonAsync($"{N9b2AWorkoutsUrl}/{workoutId}/exercises", new { exerciseId, version });
    }

    private static Task<HttpResponseMessage> N9b2ARemoveExerciseAsync(
        HttpClient client,
        Guid workoutId,
        Guid exercisePerformanceId,
        uint version) =>
        N9b2ADeleteAsync(client, $"{N9b2AWorkoutsUrl}/{workoutId}/exercises/{exercisePerformanceId}", version);

    private static async Task<HttpResponseMessage> N9b2AAddSetAsync(
        HttpClient client,
        Guid workoutId,
        Guid exercisePerformanceId,
        uint version)
    {
        await RefreshCsrfAsync(client);
        return await client.PostAsJsonAsync(
            $"{N9b2AWorkoutsUrl}/{workoutId}/exercises/{exercisePerformanceId}/sets",
            new { version });
    }

    private static Task<HttpResponseMessage> N9b2ARemoveSetAsync(HttpClient client, Guid workoutId, Guid setPerformanceId, uint version) =>
        N9b2ADeleteAsync(client, $"{N9b2AWorkoutsUrl}/{workoutId}/sets/{setPerformanceId}", version);

    /// <summary>A DELETE with the workout's version in its JSON body, as the two routes that take something away read it.</summary>
    private static async Task<HttpResponseMessage> N9b2ADeleteAsync(HttpClient client, string url, uint version)
    {
        await RefreshCsrfAsync(client);
        using var request = new HttpRequestMessage(HttpMethod.Delete, url)
        {
            Content = JsonContent.Create(new { version }),
        };
        return await client.SendAsync(request);
    }

    /// <summary>Saves a set through the set route a program's workout uses, in kilograms, ticked done.</summary>
    private static async Task<HttpResponseMessage> N9b2ALogAsync(
        HttpClient client,
        Guid workoutId,
        Guid setId,
        int? repetitions,
        decimal? load,
        decimal? rpe,
        uint version,
        string? clientNote = null)
    {
        await RefreshCsrfAsync(client);
        return await client.PutAsJsonAsync($"{N9b2AWorkoutsUrl}/{workoutId}/sets/{setId}", new
        {
            repetitions,
            load,
            loadUnit = load is null ? null : "Kilogram",
            rpe,
            rir = (decimal?)null,
            isCompleted = true,
            clientNote,
            version,
        });
    }

    private static async Task<HttpResponseMessage> N9b2AFinishAsync(HttpClient client, Guid workoutId, uint version)
    {
        await RefreshCsrfAsync(client);
        return await client.PostAsJsonAsync($"{N9b2AWorkoutsUrl}/{workoutId}/complete", new { version });
    }

    private static async Task<HttpResponseMessage> N9b2ANoteAsync(
        HttpClient caller,
        Guid workoutId,
        Guid? exercisePerformanceId,
        string text)
    {
        await RefreshCsrfAsync(caller);
        return await caller.PostAsJsonAsync($"/api/training/workouts/{workoutId}/notes", new { exercisePerformanceId, text });
    }

    /// <summary>
    /// The six routes that change a workout of one's own, each sent once by <paramref name="caller"/> with these ids, in
    /// this order: add an exercise, take one away, add a set, take the last away, save a set and finish (the last two
    /// shared with a program's workout).
    /// </summary>
    private static async Task<(string Route, HttpResponseMessage Response)[]> N9b2AChangesAsync(
        HttpClient caller,
        Guid workoutId,
        Guid exerciseToAdd,
        Guid exercisePerformanceId,
        Guid setPerformanceId,
        uint version) =>
        new (string Route, HttpResponseMessage Response)[]
        {
            ("add an exercise", await N9b2AAddExerciseAsync(caller, workoutId, exerciseToAdd, version)),
            ("take an exercise away", await N9b2ARemoveExerciseAsync(caller, workoutId, exercisePerformanceId, version)),
            ("add a set", await N9b2AAddSetAsync(caller, workoutId, exercisePerformanceId, version)),
            ("take a set away", await N9b2ARemoveSetAsync(caller, workoutId, setPerformanceId, version)),
            ("save a set", await N9b2ALogAsync(caller, workoutId, setPerformanceId, 5, 120m, null, version)),
            ("finish", await N9b2AFinishAsync(caller, workoutId, version)),
        };

    /// <summary>Asserts a 200 and reads its body with the training reads' string enums.</summary>
    private static async Task<T> N9b2AOkAsync<T>(Task<HttpResponseMessage> sending)
    {
        var response = await sending;
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<T>(response);
    }

    private static Task<ClientTrainingDayResult> N9b2ATodayAsync(HttpClient client) =>
        ReadSliceAsync<ClientTrainingDayResult>(client, "/api/training/me/today");

    /// <summary>The unfinished workout of one's own Today offers to carry on with; fails when it offers none.</summary>
    private static async Task<OwnWorkoutView> N9b2ACarryOnAsync(HttpClient client) =>
        (await N9b2ATodayAsync(client)).OwnWorkout
        ?? throw new AssertFailedException("Today offers no workout of one's own to carry on with.");

    /// <summary>
    /// Starts a workout of one's own and builds it as its player does: each exercise added after the others, each of its
    /// sets added and then saved as typed (a null one added and left empty). Returns it as Today offers it.
    /// </summary>
    private static async Task<OwnWorkoutView> N9b2ABuildAsync(HttpClient client, params N9b2ALift[] lifts)
    {
        var workout = await N9b2AOkAsync<OwnWorkoutView>(N9b2AStartAsync(client));
        var id = workout.WorkoutExecutionId;
        var version = workout.Version;
        foreach (var lift in lifts)
        {
            workout = await N9b2AOkAsync<OwnWorkoutView>(N9b2AAddExerciseAsync(client, id, lift.ExerciseId, version));
            var performanceId = workout.Exercises[^1].PerformanceId;
            version = workout.Version;
            foreach (var done in lift.Sets)
            {
                workout = await N9b2AOkAsync<OwnWorkoutView>(N9b2AAddSetAsync(client, id, performanceId, version));
                version = workout.Version;
                if (done is not null)
                {
                    var setId = workout.Exercises.Single(item => item.PerformanceId == performanceId).Sets[^1].PerformanceId;
                    version = (await N9b2AOkAsync<WorkoutSetSaveView>(
                        N9b2ALogAsync(client, id, setId, done.Repetitions, done.Load, done.Rpe, version))).ExecutionVersion;
                }
            }
        }

        return await N9b2ACarryOnAsync(client);
    }

    /// <summary>The rows of one workout: its exercises and their sets, read past every filter.</summary>
    private async Task<(long Exercises, long Sets)> N9b2ARowsAsync(Guid workoutId) =>
    (
        await Phase6CountAsync(
            RequiredDatabaseConnection,
            """SELECT count(*) FROM training."WorkoutExercisePerformances" WHERE "WorkoutExecutionId" = @id""",
            workoutId),
        await Phase6CountAsync(
            RequiredDatabaseConnection,
            """
            SELECT count(*) FROM training."WorkoutSetPerformances" AS item
            JOIN training."WorkoutExercisePerformances" AS exercise
              ON exercise."TenantId" = item."TenantId" AND exercise."Id" = item."WorkoutExercisePerformanceId"
            WHERE exercise."WorkoutExecutionId" = @id
            """,
            workoutId)
    );

    /// <summary>A client record's workouts of their own, finished or not.</summary>
    private Task<long> N9b2AOwnRowsAsync(Guid clientProfileId) => Phase6CountAsync(
        RequiredDatabaseConnection,
        """SELECT count(*) FROM training."WorkoutExecutions" WHERE "ClientProfileId" = @id AND "TrainingSessionId" IS NULL""",
        clientProfileId);

    /// <summary>Notices queued in the outbox about a workout, of any kind, read past every filter.</summary>
    private async Task<int> N9b2ANoticesAsync(Guid workoutExecutionId)
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        return await context.NotificationOutboxItems.IgnoreQueryFilters().AsNoTracking()
            .CountAsync(item => item.AggregateId == workoutExecutionId);
    }

    /// <summary>Whether a client record is self-directed, and the coach it names, read past every filter.</summary>
    private async Task<(bool SelfDirected, Guid? CoachUserId)> N9b2ACoachedAsync(Guid clientProfileId)
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var profile = await context.ClientProfiles.IgnoreQueryFilters().AsNoTracking()
            .Where(item => item.Id == clientProfileId)
            .Select(item => new { item.IsSelfDirected, item.AssignedCoachUserId })
            .SingleAsync();
        return (profile.IsSelfDirected, profile.AssignedCoachUserId);
    }

    /// <summary>
    /// A workout of one's own on one line: each exercise by its place and name, then its sets as typed, for example
    /// "1 Back Squat: 1 5x100 Kilogram @8, 2 empty | 2 arch hold: no sets".
    /// </summary>
    private static string N9b2ALine(OwnWorkoutView workout) => workout.Exercises.Count == 0
        ? "no exercises"
        : string.Join(" | ", workout.Exercises.Select(exercise =>
            $"{exercise.Position} {exercise.ExerciseName}: " +
            (exercise.Sets.Count == 0 ? "no sets" : string.Join(", ", exercise.Sets.Select(N9b2ASetLine)))));

    private static string N9b2ASetLine(OwnWorkoutSetView set) =>
        set is { IsCompleted: false, ActualRepetitions: null, ActualLoad: null, ActualRpe: null }
            ? $"{set.Position} empty"
            : $"{set.Position} {N9b2ATyped(set.ActualRepetitions, set.ActualLoad, set.ActualLoadUnit, set.ActualRpe)}" +
              (set.IsCompleted ? string.Empty : " (not done)");

    /// <summary>Last time (TRN-029) on one line: its day and best set, then each set done, or "none".</summary>
    private static string N9b2ALastTime(PreviousExercisePerformanceView? previous) => previous is null
        ? "none"
        : $"{N9a1Day(previous.Date)} best {N9b2ATyped(previous.Repetitions, previous.BestLoad, previous.Unit, previous.Rpe)}: " +
          string.Join(", ", (previous.Sets ?? []).Select(set =>
              $"{set.Position} {N9b2ATyped(set.Repetitions, set.Load, set.LoadUnit, set.Rpe)}"));

    /// <summary>A set as typed: "5x100 Kilogram @8", the effort only when one was given.</summary>
    private static string N9b2ATyped(int? repetitions, decimal? load, TrainingLoadUnit? unit, decimal? rpe) =>
        rpe is { } effort
            ? string.Create(CultureInfo.InvariantCulture, $"{repetitions}x{load:0.##} {unit} @{effort:0.#}")
            : string.Create(CultureInfo.InvariantCulture, $"{repetitions}x{load:0.##} {unit}");

    private static string N9b2AVolume(IReadOnlyList<WorkoutVolumeView> volume) => string.Join(
        ", ",
        volume.Select(item => string.Create(CultureInfo.InvariantCulture, $"{item.LoadTimesRepetitions:0.##} {item.Unit}")));

    private static string N9b2ARecords(IReadOnlyList<WorkoutPersonalRecordView> records) => string.Join(
        ", ",
        records.Select(item =>
            $"{item.SetPerformanceId} {item.ExerciseName} {N9b2ATyped(item.Repetitions, item.Load, item.Unit, null)} " +
            string.Create(CultureInfo.InvariantCulture, $"{item.RuleKey} v{item.RuleVersion}")));

    /// <summary>One exercise of a workout built by <see cref="N9b2ABuildAsync"/>: its sets in order, a null one left empty.</summary>
    private sealed record N9b2ALift(Guid ExerciseId, N9b2ADone?[] Sets);

    /// <summary>A set as the trainee types it, in kilograms, ticked done.</summary>
    private sealed record N9b2ADone(int Repetitions, decimal Load, decimal? Rpe = null);
}
