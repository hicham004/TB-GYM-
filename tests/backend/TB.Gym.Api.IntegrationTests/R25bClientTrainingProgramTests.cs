using System.Net;
using System.Net.Http.Json;
using TB.Gym.Modules.Training;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// R2.5b: the client's Training page reads one program with its weeks and session states, and the
/// finished workouts with the records each one set. Every template week holds one session, on the
/// week's first day, so week n's session is "Squat day n" on today + 7(n - 1).
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task R25bProgramShowsVisibleWeeksWithSessionStatesAndNothingOfLockedWeeks()
    {
        var today = TenantToday();
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "r25b-weeks-coach@example.test", "Coach", "Weeks");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "r25b-weeks-client@example.test", true);
        SetTenant(client, tenant);
        var resources = await CreateTrainingResourcesAsync(coach, clientId, 8, 3, today);
        var block = await AssignAsync(coach, clientId, resources, today);

        var program = await ReadSliceAsync<ClientTrainingProgramView>(client, "/api/training/me/program");
        Assert.IsTrue(program.IsAllowed);
        Assert.AreEqual(today, program.LocalDate);
        Assert.AreEqual(ClientSessionStatePolicy.Key, program.SessionStateRuleKey);
        Assert.AreEqual(ClientSessionStatePolicy.Version, program.SessionStateRuleVersion);
        var view = program.Program ?? throw new AssertFailedException("The current program is missing.");
        Assert.AreEqual(block.Id, view.Id);
        Assert.AreEqual(ClientProgramPhase.Current, view.Phase);
        Assert.AreEqual((3, (int?)1, today, today.AddDays(21)),
            (view.WeekCount, view.CurrentWeekNumber, view.StartDate, view.EndDateExclusive));
        var firstSession = view.Weeks[0].Sessions.Single();
        Assert.AreEqual(("Squat day 1", today, ClientSessionState.Today, 1, 1),
            (firstSession.Name, firstSession.ScheduledDate, firstSession.State,
                firstSession.ExerciseCount, firstSession.SetCount));
        Assert.IsNull(firstSession.WorkoutExecutionId);
        foreach (var locked in view.Weeks.Skip(1))
        {
            Assert.IsFalse(locked.IsVisible);
            Assert.IsTrue(locked.IsShared);
            Assert.IsEmpty(locked.Sessions);
        }
        Assert.AreEqual(today.AddDays(7), view.Weeks[1].StartDate);
        Assert.AreEqual((1, 0, 0), (view.SessionCount, view.CompletedCount, view.MissedCount));
        var raw = await client.GetStringAsync("/api/training/me/program");
        Assert.IsFalse(raw.Contains("Squat day 2", StringComparison.Ordinal), "A locked week leaked its session.");

        // Week 1's session was never started: a week later it is missed, and week 2's is today.
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        var workoutId = await R25bFinishTodaysWorkoutAsync(client, 80m);
        view = (await ReadSliceAsync<ClientTrainingProgramView>(client, "/api/training/me/program")).Program!;
        Assert.AreEqual(2, view.CurrentWeekNumber);
        Assert.AreEqual(ClientSessionState.Missed, view.Weeks[0].Sessions.Single().State);
        var done = view.Weeks[1].Sessions.Single();
        Assert.AreEqual(ClientSessionState.Completed, done.State);
        Assert.AreEqual(workoutId, done.WorkoutExecutionId);
        Assert.AreEqual((2, 1, 1), (view.SessionCount, view.CompletedCount, view.MissedCount));

        // A week the coach stops sharing says so, still without its content.
        var coachView = await ReadSliceAsync<TrainingMesocycleView>(coach, $"/api/training/mesocycles/{block.Id}");
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PutAsJsonAsync(
            $"/api/training/mesocycles/{block.Id}/weeks/{coachView.Weeks.Single(week => week.WeekNumber == 3).Id}/publish",
            new { isPublished = false, coachView.Version }), HttpStatusCode.OK);
        coachView = await ReadSliceAsync<TrainingMesocycleView>(coach, $"/api/training/mesocycles/{block.Id}");
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PutAsJsonAsync($"/api/training/mesocycles/{block.Id}/visibility",
            new { revealAllWeeks = true, coachView.Version }), HttpStatusCode.OK);
        view = (await ReadSliceAsync<ClientTrainingProgramView>(client, "/api/training/me/program")).Program!;
        Assert.IsFalse(view.Weeks[2].IsShared);
        Assert.IsFalse(view.Weeks[2].IsVisible, "Revealing all weeks never shows an unshared week.");
        Assert.IsEmpty(view.Weeks[2].Sessions);
    }

    [TestMethod]
    public async Task R25bHistoryListsFinishedWorkoutsNewestFirstWithTheRecordsEachSet()
    {
        var today = TenantToday();
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "r25b-history-coach@example.test", "Coach", "History");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "r25b-history-client@example.test", true);
        SetTenant(client, tenant);
        var resources = await CreateTrainingResourcesAsync(coach, clientId, 8, 3, today);
        var block = await AssignAsync(coach, clientId, resources, today);
        var empty = await ReadSliceAsync<ClientWorkoutHistoryPage>(client, "/api/training/me/history");
        Assert.IsTrue(empty.IsAllowed);
        Assert.IsEmpty(empty.Items);

        await R25bFinishTodaysWorkoutAsync(client, 80m);
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        await R25bFinishTodaysWorkoutAsync(client, 85m);
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        await R25bFinishTodaysWorkoutAsync(client, 85m);

        var history = await ReadSliceAsync<ClientWorkoutHistoryPage>(client, "/api/training/me/history");
        Assert.AreEqual((WorkoutPersonalRecordRule.Key, WorkoutPersonalRecordRule.Version),
            (history.PersonalRecordRuleKey, history.PersonalRecordRuleVersion));
        Assert.AreEqual("Squat day 3, Squat day 2, Squat day 1",
            string.Join(", ", history.Items.Select(item => item.Name)));
        Assert.IsNull(history.NextSkip);
        var latest = history.Items[0];
        Assert.IsEmpty(latest.PersonalRecords, "Tying the best is not a new record.");
        Assert.AreEqual((today.AddDays(14), 1, 1), (latest.Date, latest.CompletedSetCount, latest.TotalSetCount));
        Assert.AreEqual(425m, latest.Volume.Single().LoadTimesRepetitions);
        Assert.AreEqual(85m, history.Items[1].PersonalRecords.Single().Load);
        var first = history.Items[2].PersonalRecords.Single();
        Assert.AreEqual(("Scenario squat", 5, 80m, TrainingLoadUnit.Kilogram),
            (first.ExerciseName, first.Repetitions, first.Load, first.Unit));
        var blockName = (await ReadSliceAsync<TrainingMesocycleView>(coach,
            $"/api/training/mesocycles/{block.Id}")).Name;
        Assert.IsTrue(history.Items.All(item => item.ProgramName == blockName));

        var rest = await ReadSliceAsync<ClientWorkoutHistoryPage>(client, "/api/training/me/history?skip=2");
        Assert.AreEqual("Squat day 1", rest.Items.Single().Name);
        Assert.IsNull(rest.NextSkip);

        // Finishing every session finishes the program; the page keeps describing it until the next.
        var program = await ReadSliceAsync<ClientTrainingProgramView>(client, "/api/training/me/program");
        Assert.AreEqual(ClientProgramPhase.Finished, program.Program?.Phase);
        Assert.IsNull(program.Program?.CurrentWeekNumber);
        Assert.AreEqual((3, 3, 0), (program.Program!.SessionCount, program.Program.CompletedCount,
            program.Program.MissedCount));
        var next = await AssignAsync(coach, clientId, resources, today.AddDays(21));
        program = await ReadSliceAsync<ClientTrainingProgramView>(client, "/api/training/me/program");
        Assert.AreEqual(next.Id, program.Program?.Id);
        Assert.AreEqual(ClientProgramPhase.Upcoming, program.Program?.Phase);
        Assert.AreEqual(today.AddDays(21), program.NextProgramStartDate);
        Assert.IsTrue(program.Program!.Weeks.All(week => week.Sessions.Count == 0),
            "A program that has not started shows no sessions until its weeks open.");
    }

    [TestMethod]
    public async Task R25bProgramAndHistoryStayWithTheSignedInClientAndWorkspace()
    {
        var today = TenantToday();
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "r25b-scope-coach@example.test", "Coach", "Scope");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "r25b-scope-client@example.test", true);
        SetTenant(client, tenant);
        var resources = await CreateTrainingResourcesAsync(coach, clientId, 8, 2, today);
        await AssignAsync(coach, clientId, resources, today);
        await R25bFinishTodaysWorkoutAsync(client, 80m);

        // Another client of the same coach, with training but no program, sees nothing of the first.
        using var other = CreateClient();
        var otherId = await InviteAndAcceptAsync(coach, other, "r25b-scope-other@example.test", true);
        SetTenant(other, tenant);
        await CreateTrainingEnrollmentAsync(coach, otherId, today, 8);
        var otherProgram = await ReadSliceAsync<ClientTrainingProgramView>(other, "/api/training/me/program");
        Assert.IsTrue(otherProgram.IsAllowed);
        Assert.IsNull(otherProgram.Program);
        Assert.IsNull(otherProgram.NextProgramStartDate);
        Assert.IsEmpty((await ReadSliceAsync<ClientWorkoutHistoryPage>(other, "/api/training/me/history")).Items);

        using var anonymous = CreateClient();
        foreach (var url in new[] { "/api/training/me/program", "/api/training/me/history" })
        {
            await AssertStatusAsync(await anonymous.GetAsync(url), HttpStatusCode.Unauthorized);
            await AssertStatusAsync(await coach.GetAsync(url), HttpStatusCode.Forbidden);
        }

        using var foreignCoach = CreateClient();
        var foreign = await RegisterCoachAsync(foreignCoach, "r25b-scope-foreign@example.test", "Foreign", "Coach");
        SetTenant(client, foreign);
        await AssertStatusAsync(await client.GetAsync("/api/training/me/program"), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await client.GetAsync("/api/training/me/history"), HttpStatusCode.Forbidden);

        // Once the plan has ended, training is closed: nothing of the program or history is sent.
        SetTenant(client, tenant);
        RequiredTestClock.Advance(TimeSpan.FromDays(60));
        var closed = await ReadSliceAsync<ClientTrainingProgramView>(client, "/api/training/me/program");
        Assert.IsFalse(closed.IsAllowed);
        Assert.AreEqual("Expired", closed.AccessReason);
        Assert.IsNull(closed.Program);
        var closedHistory = await ReadSliceAsync<ClientWorkoutHistoryPage>(client, "/api/training/me/history");
        Assert.IsFalse(closedHistory.IsAllowed);
        Assert.IsEmpty(closedHistory.Items);
    }

    /// <summary>Starts today's single session, logs its one set as 5 reps at the load, and finishes it.</summary>
    private static async Task<Guid> R25bFinishTodaysWorkoutAsync(HttpClient client, decimal load)
    {
        var day = await ReadSliceAsync<ClientTrainingDayResult>(client, "/api/training/me/today");
        await RefreshCsrfAsync(client);
        var start = await client.PostAsync($"/api/training/me/sessions/{day.Workouts.Single().SessionId}/start", null);
        await AssertStatusAsync(start, HttpStatusCode.OK);
        var execution = await ReadSlicePayloadAsync<WorkoutExecutionView>(start);
        day = await ReadSliceAsync<ClientTrainingDayResult>(client, "/api/training/me/today");
        var set = day.Workouts.Single().Exercises.Single().Sets.Single();
        await RefreshCsrfAsync(client);
        var saved = await client.PutAsJsonAsync(
            $"/api/training/me/workouts/{execution.Id}/sets/{set.PerformanceId}",
            new { repetitions = 5, load, loadUnit = "Kilogram", rpe = 8m,
                isCompleted = true, clientNote = (string?)null, version = execution.Version });
        await AssertStatusAsync(saved, HttpStatusCode.OK);
        var savedSet = await ReadSlicePayloadAsync<WorkoutSetSaveView>(saved);
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(await client.PostAsJsonAsync($"/api/training/me/workouts/{execution.Id}/complete",
            new { version = savedSet.ExecutionVersion }), HttpStatusCode.OK);
        return execution.Id;
    }
}
