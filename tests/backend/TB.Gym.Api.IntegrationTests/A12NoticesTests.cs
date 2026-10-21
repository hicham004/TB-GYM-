using System.Net;
using System.Net.Http.Json;
using TB.Gym.Modules.Notifications;
using TB.Gym.Modules.Training;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Audit A12: a week an edit moves is not shared with the client again (BEA-5, the test BEA-15 asks for),
/// since weeks are compared by the numbers the client knows them by; and a staff note on a workout asks
/// the shared access port first, as the coach's read of that workout does (BEA-8).
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task A12AWeekAnEditMovesIsUpdatedForTheClientNotSharedAgain()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "a12-moved-week", exerciseId =>
        [
            P2Week("Week 1", exerciseId, P1Set(1, "Direct", rpe: 7m, direct: 100m)),
            P2Week("Week 2", exerciseId, P1Set(1, "Direct", rpe: 7m, direct: 100m)),
        ]);
        SetTenant(client, scenario.WorkspaceId);
        var block = await P2AssignAsync(coach, scenario, []);
        await R51cSweepAsync();
        var before = (await R51cInboxAsync(client)).Items.Select(item => item.Id).ToHashSet();

        // An opening week before week 1, which the client can open today: week 1 becomes week 2, built as a
        // new row, and the new week 1 opens today in its place.
        var grid = P3bGrid(block, TenantToday());
        var opener = new ProgramEditWeekRequest(null, "Opener", true, [P3bNewSession("Opener squat", 0, scenario.Exercise.Id, 80m)]);
        ProgramEditWeekRequest[] edited = [opener, grid[0], grid[1]];
        var preview = await P3bPreviewOkAsync(coach, block, edited);
        var applied = await P3bApplyOkAsync(coach, block, edited, preview.PreviewHash);
        Assert.IsFalse(applied.Weeks.Any(week => week.Id == block.Weeks[0].Id), "The moved week is a new row.");
        await R51cSweepAsync();

        // The client could open week 1 before the edit and still can: it is updated, never newly shared.
        var told = (await R51cInboxAsync(client)).Items.Where(item => !before.Contains(item.Id)).ToArray();
        Assert.IsFalse(
            told.Any(item => item.Kind == nameof(CommercialNotificationKind.WeeksShared)),
            string.Join(" | ", told.Select(item => item.Title)));
        var updated = told.Single(item => item.Kind == nameof(CommercialNotificationKind.WeeksChanged));
        Assert.AreEqual("Your coach updated week 1", updated.Title);
        Assert.AreEqual(1, updated.WeekNumber);
    }

    [TestMethod]
    public async Task A12OnlyAWeekNumberTheClientCouldNotOpenBeforeIsShared()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "a12-numbered-weeks", exerciseId =>
        [
            P2Week("Week 1", exerciseId, P1Set(1, "Direct", rpe: 7m, direct: 100m)),
            P2Week("Week 2", exerciseId, P1Set(1, "Direct", rpe: 7m, direct: 100m)),
            P2Week("Week 3", exerciseId, P1Set(1, "Direct", rpe: 7m, direct: 100m)),
        ]);
        SetTenant(client, scenario.WorkspaceId);
        var assigned = await P2AssignAsync(coach, scenario, []);
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PutAsJsonAsync(
                $"/api/training/mesocycles/{assigned.Id}/visibility",
                new { revealAllWeeks = true, version = assigned.Version }),
            HttpStatusCode.OK);
        var block = await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(assigned.Id));
        await R51cSweepAsync();
        var before = (await R51cInboxAsync(client)).Items.Select(item => item.Id).ToHashSet();

        // Every week is open to the client. A new week before week 2 moves weeks 2 and 3 to 3 and 4, both as
        // new rows: weeks 2 and 3 hold something else now, and only week 4 is a number they could not open.
        var grid = P3bGrid(block, TenantToday());
        var inserted = new ProgramEditWeekRequest(null, "Deload", true, [P3bNewSession("Deload squat", 0, scenario.Exercise.Id, 70m)]);
        ProgramEditWeekRequest[] edited = [grid[0], inserted, grid[1], grid[2]];
        var preview = await P3bPreviewOkAsync(coach, block, edited);
        await P3bApplyOkAsync(coach, block, edited, preview.PreviewHash);
        await R51cSweepAsync();

        var told = (await R51cInboxAsync(client)).Items.Where(item => !before.Contains(item.Id)).ToArray();
        Assert.AreEqual(
            "Your coach shared week 4",
            told.Single(item => item.Kind == nameof(CommercialNotificationKind.WeeksShared)).Title);
        var updated = told.Single(item => item.Kind == nameof(CommercialNotificationKind.WeeksChanged));
        Assert.AreEqual("Your coach updated weeks 2 and 3", updated.Title);
        Assert.AreEqual(2, updated.WeekNumber);
    }

    [TestMethod]
    public async Task A12AStaffNoteOnAWorkoutWaitsUntilTheClientsTrainingIsOpen()
    {
        using var owner = CreateClient();
        using var client = CreateClient();
        using var coach = CreateClient();
        var scenario = await P2StartAsync(owner, client, "a12-note-closed", 1);
        SetTenant(client, scenario.WorkspaceId);
        var coachUserId = await JoinAsCoachAsync(owner, coach, "a12-note-coach@example.test", "Rhea Coach");
        await ReassignAsync(owner, scenario.ClientId, coachUserId, null);

        var day = await client.GetFromJsonAsync<TrainingDay>("/api/training/me/today")
            ?? throw new AssertFailedException("Training day was empty.");
        await RefreshCsrfAsync(client);
        var start = await client.PostAsync($"/api/training/me/sessions/{day.Workouts.Single().SessionId}/start", null);
        await AssertStatusAsync(start, HttpStatusCode.OK);
        var execution = await RequiredJsonAsync<Execution>(start);

        await RefreshCsrfAsync(owner);
        var paused = await owner.PostAsJsonAsync(
            $"/api/commercial/enrollments/{scenario.Resources.Enrollment.Id}/pause",
            new { reason = "Away for a month", scenario.Resources.Enrollment.Version });
        await AssertStatusAsync(paused, HttpStatusCode.OK);
        var pausedVersion = (await RequiredJsonAsync<CoverageEnrollment>(paused)).Version;

        // The coach's read of the workout is closed, and so is writing on it: neither the coach nor the
        // owner leaves a note, nothing is kept and the client is told of nothing.
        var read = await RequiredJsonAsync<A12CoachWorkoutRead>(
            await coach.GetAsync($"/api/training/clients/{scenario.ClientId}/workouts/{execution.Id}"));
        Assert.AreEqual((false, "Paused"), (read.IsAllowed, read.AccessReason));
        foreach (var staff in new[] { coach, owner })
        {
            await RefreshCsrfAsync(staff);
            await AssertStatusAsync(
                await staff.PostAsJsonAsync(
                    $"/api/training/workouts/{execution.Id}/notes",
                    new { exercisePerformanceId = (Guid?)null, text = "Rest that knee" }),
                HttpStatusCode.Forbidden);
        }

        Assert.AreEqual(0L, await P2CountAsync("""SELECT count(*) FROM training."WorkoutNotes" WHERE "WorkoutExecutionId" = @id""", execution.Id));
        Assert.AreEqual(0L, await P2CountAsync("""SELECT count(*) FROM notifications."OutboxItems" WHERE "AggregateId" = @id""", execution.Id));

        // Once the plan runs again the coach's note is kept, and the client hears of it by the workout's name.
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync(
                $"/api/commercial/enrollments/{scenario.Resources.Enrollment.Id}/resume",
                new { version = pausedVersion }),
            HttpStatusCode.OK);
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync(
                $"/api/training/workouts/{execution.Id}/notes",
                new { exercisePerformanceId = (Guid?)null, text = "Rest that knee" }),
            HttpStatusCode.OK);
        await R51cSweepAsync();
        var toClient = (await R51cInboxAsync(client)).Items.Single(item => item.Kind == nameof(CommercialNotificationKind.CoachWorkoutNote));
        Assert.AreEqual("Your coach left a note on Squat day 1", toClient.Title);
        Assert.DoesNotContain("knee", toClient.Title + toClient.Body, StringComparison.OrdinalIgnoreCase);
    }

    private sealed record A12CoachWorkoutRead(bool IsAllowed, string AccessReason);
}
