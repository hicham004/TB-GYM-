using System.Net;
using System.Net.Http.Json;
using TB.Gym.Modules.Training;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Step 3B: the coverage the client's Today switches on (rest day, week not shared, between blocks),
/// and the start-workout idempotency Today's "Open workout" relies on.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task Step3TodayCoverageBetweenBlocksIsNotARestDayWhenTheNextBlockIsRevealedEarly()
    {
        var today = TenantToday();
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "today-gap-coach@example.test", "Coach", "Gap");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "today-gap-client@example.test", true);
        SetTenant(client, tenant);
        var resources = await CreateTrainingResourcesAsync(coach, clientId, 8, 1, today);
        await AssignAsync(coach, clientId, resources, today);
        var next = await AssignAsync(coach, clientId, resources, today.AddDays(14));
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PutAsJsonAsync($"/api/training/mesocycles/{next.Id}/visibility",
            new { revealAllWeeks = true, next.Version }), HttpStatusCode.OK);

        // The first block has ended and the second starts in a week, already revealed to the client.
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        var day = await ReadSliceAsync<ClientTrainingDayResult>(client, "/api/training/me/today");
        var upcoming = await ReadSliceAsync<ClientTrainingUpcomingView>(client, "/api/training/me/upcoming");

        // The two flags Today used to switch on both say "yes", which it read as a rest day.
        Assert.IsEmpty(day.Workouts);
        Assert.IsTrue(upcoming.HasAssignedProgram);
        Assert.IsTrue(upcoming.HasVisibleSessions);
        Assert.IsNotNull(upcoming.TodayCoverage);
        Assert.IsNull(upcoming.TodayCoverage.ActiveBlock, "No block covers a day between two blocks.");
        Assert.AreEqual(today.AddDays(14), upcoming.TodayCoverage.NextBlockStartDate);
        Assert.AreEqual(today.AddDays(14), upcoming.NextSession?.Date);
    }

    [TestMethod]
    public async Task Step3TodayCoverageReportsAnUnpublishedCurrentWeekInsideAnActiveBlock()
    {
        var today = TenantToday();
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "today-week-coach@example.test", "Coach", "Week");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "today-week-client@example.test", true);
        SetTenant(client, tenant);
        var resources = await CreateTrainingResourcesAsync(coach, clientId, 8, 2, today);
        var block = await AssignAsync(coach, clientId, resources, today);
        var view = await ReadSliceAsync<TrainingMesocycleView>(coach, $"/api/training/mesocycles/{block.Id}");
        var secondWeek = view.Weeks.Single(week => week.WeekNumber == 2);
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PutAsJsonAsync(
            $"/api/training/mesocycles/{block.Id}/weeks/{secondWeek.Id}/publish",
            new { isPublished = false, view.Version }), HttpStatusCode.OK);

        // Week 2 is now current: week 1 stays visible behind it, so the old flags said "rest day".
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        var day = await ReadSliceAsync<ClientTrainingDayResult>(client, "/api/training/me/today");
        var hidden = await ReadSliceAsync<ClientTrainingUpcomingView>(client, "/api/training/me/upcoming");
        Assert.IsEmpty(day.Workouts);
        Assert.IsTrue(hidden.HasVisibleSessions);
        var active = hidden.TodayCoverage?.ActiveBlock;
        Assert.IsNotNull(active);
        Assert.AreEqual(block.Id, active.Id);
        Assert.AreEqual(view.Name, active.Name);
        Assert.AreEqual(2, active.WeekNumber);
        Assert.AreEqual(2, active.WeekCount);
        Assert.IsFalse(active.IsCurrentWeekPublished);

        view = await ReadSliceAsync<TrainingMesocycleView>(coach, $"/api/training/mesocycles/{block.Id}");
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PutAsJsonAsync(
            $"/api/training/mesocycles/{block.Id}/weeks/{secondWeek.Id}/publish",
            new { isPublished = true, view.Version }), HttpStatusCode.OK);
        var shared = await ReadSliceAsync<ClientTrainingUpcomingView>(client, "/api/training/me/upcoming");
        Assert.IsTrue(shared.TodayCoverage?.ActiveBlock?.IsCurrentWeekPublished);
        Assert.HasCount(1, (await ReadSliceAsync<ClientTrainingDayResult>(client, "/api/training/me/today")).Workouts);
    }

    [TestMethod]
    public async Task Step3TodayCoverageComesOnlyFromTheSelectedWorkspace()
    {
        var today = TenantToday();
        using var coachA = CreateClient();
        var workspaceA = await RegisterCoachAsync(coachA, "today-scope-a@example.test", "Coach A", "Scope A");
        using var sharedClient = CreateClient();
        var clientA = await InviteAndAcceptAsync(coachA, sharedClient, "today-scope-client@example.test", true);
        var resourcesA = await CreateTrainingResourcesAsync(coachA, clientA, 8, 1, today);
        var blockA = await AssignAsync(coachA, clientA, resourcesA, today);

        // The same person is also a client of a second workspace, with training but no block there.
        using var coachB = CreateClient();
        var workspaceB = await RegisterCoachAsync(coachB, "today-scope-b@example.test", "Coach B", "Scope B");
        var clientB = await InviteAndAcceptAsync(coachB, sharedClient, "today-scope-client@example.test", false);
        await CreateTrainingEnrollmentAsync(coachB, clientB, today, 8);

        SetTenant(sharedClient, workspaceB);
        var inB = await ReadSliceAsync<ClientTrainingUpcomingView>(sharedClient, "/api/training/me/upcoming");
        Assert.IsTrue(inB.IsAllowed);
        Assert.IsNotNull(inB.TodayCoverage);
        Assert.IsNull(inB.TodayCoverage.ActiveBlock, "Workspace A's block leaked into workspace B.");
        Assert.IsNull(inB.TodayCoverage.NextBlockStartDate);

        SetTenant(sharedClient, workspaceA);
        var inA = await ReadSliceAsync<ClientTrainingUpcomingView>(sharedClient, "/api/training/me/upcoming");
        Assert.AreEqual(blockA.Id, inA.TodayCoverage?.ActiveBlock?.Id);

        // A workspace the person does not belong to is refused before anything is read.
        using var foreignCoach = CreateClient();
        var foreign = await RegisterCoachAsync(foreignCoach, "today-scope-foreign@example.test", "Other", "Other");
        SetTenant(sharedClient, foreign);
        await AssertStatusAsync(await sharedClient.GetAsync("/api/training/me/upcoming"), HttpStatusCode.Forbidden);
        // Nor may the other workspace's coach read it as a client.
        await AssertStatusAsync(await coachA.GetAsync("/api/training/me/upcoming"), HttpStatusCode.Forbidden);
    }

    [TestMethod]
    public async Task Step3StartingTheSameWorkoutAgainReturnsTheOriginalExecution()
    {
        var (client, sessionId) = await Step3ClientWithTodaysSessionAsync("start-repeat");
        using (client)
        {
            await RefreshCsrfAsync(client);
            var first = await client.PostAsync($"/api/training/me/sessions/{sessionId}/start", null);
            await AssertStatusAsync(first, HttpStatusCode.OK);
            var second = await client.PostAsync($"/api/training/me/sessions/{sessionId}/start", null);
            await AssertStatusAsync(second, HttpStatusCode.OK);

            Assert.AreEqual((await RequiredJsonAsync<Execution>(first)).Id, (await RequiredJsonAsync<Execution>(second)).Id);
            Assert.AreEqual(1L, await Step3CountExecutionsAsync(sessionId));
        }
    }

    [TestMethod]
    public async Task Step3TwoConcurrentStartsOfTheSameWorkoutCreateOneExecution()
    {
        var (client, sessionId) = await Step3ClientWithTodaysSessionAsync("start-race");
        using (client)
        {
            await RefreshCsrfAsync(client);
            var url = $"/api/training/me/sessions/{sessionId}/start";

            // Both requests are held at the insert, after both have read "not started yet".
            RequiredInsertBarrier.Arm("training.\"WorkoutExecutions\"", 2);
            HttpResponseMessage[] starts;
            try
            {
                starts = await Task.WhenAll(client.PostAsync(url, null), client.PostAsync(url, null));
                Assert.AreEqual(2, RequiredInsertBarrier.Arrived, "The two starts never raced.");
            }
            finally
            {
                RequiredInsertBarrier.Disarm();
            }

            foreach (var start in starts)
            {
                await AssertStatusAsync(start, HttpStatusCode.OK);
            }

            Assert.AreEqual((await RequiredJsonAsync<Execution>(starts[0])).Id, (await RequiredJsonAsync<Execution>(starts[1])).Id);
            Assert.AreEqual(1L, await Step3CountExecutionsAsync(sessionId));
        }
    }

    private async Task<(HttpClient Client, Guid SessionId)> Step3ClientWithTodaysSessionAsync(string name)
    {
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, $"{name}-coach@example.test", "Coach", name);
        var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, $"{name}-client@example.test", true);
        SetTenant(client, tenant);
        var resources = await CreateTrainingResourcesAsync(coach, clientId, 8, 1, TenantToday());
        await AssignAsync(coach, clientId, resources, TenantToday());
        var day = await ReadSliceAsync<ClientTrainingDayResult>(client, "/api/training/me/today");
        return (client, day.Workouts.Single().SessionId);
    }

    private Task<long> Step3CountExecutionsAsync(Guid sessionId) =>
        Phase6CountAsync(
            RequiredDatabaseConnection,
            "SELECT count(*) FROM training.\"WorkoutExecutions\" WHERE \"TrainingSessionId\" = @id",
            sessionId);
}
