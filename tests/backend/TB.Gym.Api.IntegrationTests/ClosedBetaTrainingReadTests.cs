using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using TB.Gym.Modules.Training;

namespace TB.Gym.Api.IntegrationTests;

public sealed partial class Phase3TrainingWorkflowTests
{
    private static readonly JsonSerializerOptions SliceReadJson = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    [TestMethod]
    public async Task Slice1UpcomingDistinguishesNoProgramHiddenWeeksAndNextSession()
    {
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "slice-states-coach@example.test", "Coach", "States");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "slice-states-client@example.test", true);
        SetTenant(client, tenant);
        var resources = await CreateTrainingResourcesAsync(coach, clientId, 8, 2, TenantToday());
        var unassigned = await ReadSliceAsync<ClientTrainingUpcomingView>(client, "/api/training/me/upcoming");
        Assert.IsTrue(unassigned.IsAllowed);
        Assert.IsFalse(unassigned.HasAssignedProgram);

        var block = await AssignAsync(coach, clientId, resources, TenantToday());
        var initial = await ReadSliceAsync<ClientTrainingUpcomingView>(client, "/api/training/me/upcoming");
        Assert.IsTrue(initial.HasAssignedProgram);
        Assert.IsTrue(initial.HasVisibleSessions);
        Assert.IsNull(initial.NextSession, "Week two must remain hidden until unlocked or revealed.");

        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PutAsJsonAsync($"/api/training/mesocycles/{block.Id}/visibility",
            new { revealAllWeeks = true, block.Version }), HttpStatusCode.OK);
        var revealed = await ReadSliceAsync<ClientTrainingUpcomingView>(client, "/api/training/me/upcoming");
        Assert.IsNotNull(revealed.NextSession);
        Assert.AreEqual(TenantToday().AddDays(7), revealed.NextSession.Date);

        var current = await ReadSliceAsync<TrainingMesocycleView>(coach, $"/api/training/mesocycles/{block.Id}");
        foreach (var week in current.Weeks)
        {
            await RefreshCsrfAsync(coach);
            var response = await coach.PutAsJsonAsync($"/api/training/mesocycles/{block.Id}/weeks/{week.Id}/publish",
                new { isPublished = false, current.Version });
            await AssertStatusAsync(response, HttpStatusCode.OK);
            current = await ReadSliceAsync<TrainingMesocycleView>(coach, $"/api/training/mesocycles/{block.Id}");
        }
        var hidden = await ReadSliceAsync<ClientTrainingUpcomingView>(client, "/api/training/me/upcoming");
        Assert.IsTrue(hidden.HasAssignedProgram);
        Assert.IsFalse(hidden.HasVisibleSessions);
        Assert.IsNull(hidden.NextSession);
    }

    [TestMethod]
    public async Task Slice1ResumeRetainsSnapshotsSwapsNotesAndCompletionVersion()
    {
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "slice-resume-coach@example.test", "Coach", "Resume");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "slice-resume-client@example.test", true);
        SetTenant(client, tenant);
        var resources = await CreateTrainingResourcesAsync(coach, clientId, 8, 2, TenantToday());
        await AssignAsync(coach, clientId, resources, TenantToday());
        var today = await ReadSliceAsync<ClientTrainingDayResult>(client, "/api/training/me/today");
        await RefreshCsrfAsync(client);
        var started = await client.PostAsync($"/api/training/me/sessions/{today.Workouts.Single().SessionId}/start", null);
        await AssertStatusAsync(started, HttpStatusCode.OK);
        var execution = await RequiredJsonAsync<Execution>(started);
        today = await ReadSliceAsync<ClientTrainingDayResult>(client, "/api/training/me/today");
        var exercise = today.Workouts.Single().Exercises.Single();
        await RefreshCsrfAsync(client);
        var swapped = await client.PutAsJsonAsync($"/api/training/me/workouts/{execution.Id}/exercises/{exercise.PerformanceId}/substitution",
            new { exerciseId = resources.Alternative.Id, execution.Version });
        await AssertStatusAsync(swapped, HttpStatusCode.OK);
        execution = await RequiredJsonAsync<Execution>(swapped);
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(await client.PutAsJsonAsync($"/api/training/me/workouts/{execution.Id}/sets/{exercise.Sets.Single().PerformanceId}",
            new { repetitions = 5, load = 80m, loadUnit = "Kilogram", rpe = 8m, isCompleted = true,
                clientNote = "Set note retained", execution.Version }), HttpStatusCode.OK);
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(await client.PostAsJsonAsync($"/api/training/workouts/{execution.Id}/notes",
            new { text = "Workout note retained" }), HttpStatusCode.OK);

        RequiredTestClock.Advance(TimeSpan.FromDays(1));
        var emptyToday = await ReadSliceAsync<ClientTrainingDayResult>(client, "/api/training/me/today");
        Assert.IsEmpty(emptyToday.Workouts);
        var resumed = await MeasureSliceAsync<ClientTrainingUpcomingView>(client, "/api/training/me/upcoming", 32);
        var earlier = resumed.UnfinishedWorkouts.Single();
        Assert.AreEqual(TenantToday(), earlier.Date);
        var performed = earlier.Workout.Exercises.Single();
        Assert.IsTrue(performed.WasSubstituted);
        Assert.AreEqual(resources.Exercise.Id, performed.PrescribedExerciseId);
        Assert.AreEqual(resources.Alternative.Id, performed.ActualExerciseId);
        Assert.AreEqual(80m, performed.Sets.Single().ActualLoad);
        Assert.AreEqual("Set note retained", performed.Sets.Single().ClientNote);
        Assert.AreEqual("Workout note retained", earlier.Workout.Notes.Single().Text);
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(await client.PostAsJsonAsync($"/api/training/me/workouts/{execution.Id}/complete",
            new { version = earlier.Workout.ExecutionVersion }), HttpStatusCode.OK);
        var after = await ReadSliceAsync<ClientTrainingUpcomingView>(client, "/api/training/me/upcoming");
        Assert.IsEmpty(after.UnfinishedWorkouts);

        var detail = await MeasureSliceAsync<CoachWorkoutDetailResult>(coach,
            $"/api/training/clients/{clientId}/workouts/{execution.Id}", 24);
        Assert.IsTrue(detail.IsAllowed);
        Assert.IsNotNull(detail.Detail);
        Assert.AreEqual(WorkoutExecutionStatus.Completed, detail.Detail.Workout.Status);
        Assert.AreEqual("Set note retained", detail.Detail.Workout.Exercises.Single().Sets.Single().ClientNote);
        Assert.AreEqual("Workout note retained", detail.Detail.Workout.Notes.Single().Text);
    }

    [TestMethod]
    public async Task Slice1ReadsRejectWrongRolesTenantsClientsBlockingAndExpiredAccess()
    {
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "slice-security-coach@example.test", "Coach", "Security");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "slice-security-client@example.test", true);
        SetTenant(client, tenant);
        var resources = await CreateTrainingResourcesAsync(coach, clientId, 8, 1, TenantToday());
        var block = await AssignAsync(coach, clientId, resources, TenantToday());
        var schedule = await ReadSliceAsync<TrainingMesocycleView>(coach, $"/api/training/mesocycles/{block.Id}");
        await RefreshCsrfAsync(client);
        var started = await client.PostAsync($"/api/training/me/sessions/{schedule.Weeks[0].Sessions[0].Id}/start", null);
        await AssertStatusAsync(started, HttpStatusCode.OK);
        var execution = await RequiredJsonAsync<Execution>(started);
        var detailUrl = $"/api/training/clients/{clientId}/workouts/{execution.Id}";
        using var anonymous = CreateClient();
        await AssertStatusAsync(await anonymous.GetAsync(detailUrl), HttpStatusCode.Unauthorized);
        await AssertStatusAsync(await anonymous.GetAsync("/api/training/me/upcoming"), HttpStatusCode.Unauthorized);
        await AssertStatusAsync(await client.GetAsync(detailUrl), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await coach.GetAsync("/api/training/me/upcoming"), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await coach.GetAsync($"/api/training/clients/{Guid.NewGuid()}/workouts/{execution.Id}"), HttpStatusCode.NotFound);

        using var foreignCoach = CreateClient();
        var foreignTenant = await RegisterCoachAsync(foreignCoach, "slice-foreign@example.test", "Other", "Other");
        await AssertStatusAsync(await foreignCoach.GetAsync(detailUrl), HttpStatusCode.NotFound);
        SetTenant(client, foreignTenant);
        await AssertStatusAsync(await client.GetAsync("/api/training/me/upcoming"), HttpStatusCode.Forbidden);
        SetTenant(client, tenant);

        var profile = await ReadSliceAsync<SliceProfileVersion>(coach, $"/api/clients/{clientId}");
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PostAsJsonAsync($"/api/clients/{clientId}/relationship/block",
            new { reason = "Slice privacy check", profile.Version }), HttpStatusCode.OK);
        var blocked = await ReadSliceAsync<CoachWorkoutDetailResult>(coach, detailUrl);
        Assert.IsFalse(blocked.IsAllowed);
        Assert.AreEqual("RelationshipBlocked", blocked.AccessReason);
        Assert.IsNull(blocked.Detail);
        var blockedUpcoming = await ReadSliceAsync<ClientTrainingUpcomingView>(client, "/api/training/me/upcoming");
        Assert.IsFalse(blockedUpcoming.IsAllowed);
        Assert.IsFalse(blockedUpcoming.HasAssignedProgram);
        Assert.IsEmpty(blockedUpcoming.UnfinishedWorkouts);
        profile = await ReadSliceAsync<SliceProfileVersion>(coach, $"/api/clients/{clientId}");
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PostAsJsonAsync($"/api/clients/{clientId}/relationship/unblock",
            new { reason = "End privacy check", profile.Version }), HttpStatusCode.OK);
        RequiredTestClock.Advance(TimeSpan.FromDays(57));
        var expired = await ReadSliceAsync<CoachWorkoutDetailResult>(coach, detailUrl);
        Assert.IsFalse(expired.IsAllowed);
        Assert.AreEqual("Expired", expired.AccessReason);
        Assert.IsNull(expired.Detail);
        var expiredUpcoming = await ReadSliceAsync<ClientTrainingUpcomingView>(client, "/api/training/me/upcoming");
        Assert.IsFalse(expiredUpcoming.IsAllowed);
        Assert.IsNull(expiredUpcoming.NextSession);
    }

    [TestMethod]
    public async Task Slice1UnfinishedPageHasFixedQueryBudgetAndNotesArePaged()
    {
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "slice-budget-coach@example.test", "Coach", "Budget");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "slice-budget-client@example.test", true);
        SetTenant(client, tenant);
        var start = TenantToday().AddDays(-42);
        var resources = await CreateTrainingResourcesAsync(coach, clientId, 16, 7, start);
        var block = await AssignAsync(coach, clientId, resources, start);
        var schedule = await ReadSliceAsync<TrainingMesocycleView>(coach, $"/api/training/mesocycles/{block.Id}");
        foreach (var session in schedule.Weeks.Take(6).SelectMany(week => week.Sessions))
        {
            await RefreshCsrfAsync(client);
            await AssertStatusAsync(await client.PostAsync($"/api/training/me/sessions/{session.Id}/start", null), HttpStatusCode.OK);
        }
        var page = await MeasureSliceAsync<ClientTrainingUpcomingView>(client, "/api/training/me/upcoming", 36);
        Assert.HasCount(5, page.UnfinishedWorkouts);
        Assert.AreEqual(5, page.NextSkip);
        var second = await ReadSliceAsync<ClientTrainingUpcomingView>(client, "/api/training/me/upcoming?skip=5");
        Assert.HasCount(1, second.UnfinishedWorkouts);
        Assert.IsNull(second.NextSkip);
        Assert.IsFalse(page.UnfinishedWorkouts.Any(item => item.Workout.SessionId == second.UnfinishedWorkouts[0].Workout.SessionId));
        var executionId = second.UnfinishedWorkouts[0].Workout.WorkoutExecutionId;
        await RefreshCsrfAsync(client);
        for (var index = 0; index < 51; index++)
        {
            await AssertStatusAsync(await client.PostAsJsonAsync($"/api/training/workouts/{executionId}/notes",
                new { text = $"Note {index}" }), HttpStatusCode.OK);
        }
        var detailUrl = $"/api/training/clients/{clientId}/workouts/{executionId}";
        var notes = await ReadSliceAsync<CoachWorkoutDetailResult>(coach, detailUrl);
        Assert.HasCount(50, notes.Detail!.Workout.Notes);
        Assert.AreEqual(50, notes.NextNotesSkip);
        var older = await ReadSliceAsync<CoachWorkoutDetailResult>(coach, detailUrl + "?notesSkip=50");
        Assert.HasCount(1, older.Detail!.Workout.Notes);
        Assert.IsNull(older.NextNotesSkip);
        Assert.IsFalse(notes.Detail.Workout.Notes.Any(item => item.Id == older.Detail.Workout.Notes[0].Id));
    }

    private async Task<T> MeasureSliceAsync<T>(HttpClient client, string url, int queryBudget)
    {
        RequiredTodayQueryCounter.Reset();
        var stopwatch = Stopwatch.StartNew();
        var result = await ReadSliceAsync<T>(client, url);
        stopwatch.Stop();
        Console.WriteLine($"Slice 1 {typeof(T).Name}: {RequiredTodayQueryCounter.Count} SQL commands; {stopwatch.Elapsed.TotalMilliseconds:F1} ms including HTTP and JSON.");
        Assert.IsLessThanOrEqualTo(queryBudget, RequiredTodayQueryCounter.Count);
        return result;
    }

    private static async Task<T> ReadSliceAsync<T>(HttpClient client, string url)
    {
        var response = await client.GetAsync(url);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await response.Content.ReadFromJsonAsync<T>(SliceReadJson)
            ?? throw new AssertFailedException("Training read response was empty.");
    }

    private sealed record SliceProfileVersion(uint Version);
}
