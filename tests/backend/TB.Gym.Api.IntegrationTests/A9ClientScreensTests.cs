using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using TB.Gym.Modules.Training;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The audit's batch A9, the client's Today, Training and Progress (docs/FULL-AUDIT-2026-10.md, section 11): a
/// client may start a missed session of a running program late ("Do it now", the owner's decision of 2026-10-19,
/// CLIENT-12), it then counts as done rather than missed, and the client and their coach see it done late
/// (TRN-020 v2); a session still to come and a program past its last day are refused with their reasons; and a
/// moved weigh-in carries the trail of the one it replaced (CLIENT-14, PRG-011). Every template week holds one
/// session, on the week's first day.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task A9AMissedSessionDoneLateCountsAsDoneForTheClientAndTheCoach()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "a9-late-coach@example.test", "Coach", "A9 Late");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "a9-late-client@example.test", true);
        SetTenant(client, tenant);
        var resources = await CreateTrainingResourcesAsync(coach, clientId, 8, 3, today);
        var block = await AssignAsync(coach, clientId, resources, today);

        // Week 1's session was not done on its day: two days later it is missed, for the client and the coach.
        RequiredTestClock.Advance(TimeSpan.FromDays(2));
        var own = (await ReadSliceAsync<ClientTrainingProgramView>(client, "/api/training/me/program")).Program!;
        var missed = own.Weeks[0].Sessions.Single();
        Assert.AreEqual((ClientSessionState.Missed, (DateOnly?)null, false),
            (missed.State, missed.StartedOn, missed.IsLate));
        Assert.AreEqual(1, own.MissedCount);
        var coachBlock = (await ReadSliceAsync<CoachClientProgramView>(coach, R34aProgramUrl(clientId))).Blocks.Single();
        Assert.AreEqual((ClientSessionState.Missed, 1), (coachBlock.Weeks[0].Sessions.Single().State, coachBlock.MissedCount));

        // "Do it now": the client starts it late. It is in progress, started today, late, and no longer missed.
        await RefreshCsrfAsync(client);
        var started = await client.PostAsync($"/api/training/me/sessions/{missed.SessionId}/start", null);
        await AssertStatusAsync(started, HttpStatusCode.OK);
        var execution = await ReadSlicePayloadAsync<WorkoutExecutionView>(started);
        own = (await ReadSliceAsync<ClientTrainingProgramView>(client, "/api/training/me/program")).Program!;
        var doing = own.Weeks[0].Sessions.Single();
        Assert.AreEqual((ClientSessionState.InProgress, (DateOnly?)today.AddDays(2), true, execution.Id),
            (doing.State, doing.StartedOn, doing.IsLate, doing.WorkoutExecutionId));
        Assert.AreEqual(0, own.MissedCount);

        // It is finished from the player like any unfinished workout, then reads done late on both sides.
        var upcoming = await ReadSliceAsync<ClientTrainingUpcomingView>(client, "/api/training/me/upcoming");
        var unfinished = upcoming.UnfinishedWorkouts.Single();
        Assert.AreEqual(today, unfinished.Date, "The workout keeps its session's own day.");
        var set = unfinished.Workout.Exercises.Single().Sets.Single();
        await RefreshCsrfAsync(client);
        var saved = await client.PutAsJsonAsync(
            $"/api/training/me/workouts/{execution.Id}/sets/{set.PerformanceId}",
            new { repetitions = 5, load = 80m, loadUnit = "Kilogram", rpe = 8m,
                isCompleted = true, clientNote = (string?)null, version = execution.Version });
        await AssertStatusAsync(saved, HttpStatusCode.OK);
        var savedSet = await ReadSlicePayloadAsync<WorkoutSetSaveView>(saved);
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(await client.PostAsJsonAsync($"/api/training/me/workouts/{execution.Id}/complete",
            new { version = savedSet.ExecutionVersion }), HttpStatusCode.OK);

        own = (await ReadSliceAsync<ClientTrainingProgramView>(client, "/api/training/me/program")).Program!;
        var done = own.Weeks[0].Sessions.Single();
        Assert.AreEqual((ClientSessionState.Completed, (DateOnly?)today.AddDays(2), true),
            (done.State, done.StartedOn, done.IsLate));
        Assert.AreEqual((1, 0), (own.CompletedCount, own.MissedCount));
        coachBlock = (await ReadSliceAsync<CoachClientProgramView>(coach, R34aProgramUrl(clientId))).Blocks.Single();
        var seen = coachBlock.Weeks[0].Sessions.Single();
        Assert.AreEqual((ClientSessionState.Completed, (DateOnly?)today.AddDays(2), true, (Guid?)execution.Id),
            (seen.State, seen.StartedOn, seen.IsLate, seen.WorkoutExecutionId));
        Assert.AreEqual((1, 0), (coachBlock.CompletedCount, coachBlock.MissedCount));

        // A session done on its own day is not late.
        RequiredTestClock.Advance(TimeSpan.FromDays(5));
        await R25bFinishTodaysWorkoutAsync(client, 82.5m);
        own = (await ReadSliceAsync<ClientTrainingProgramView>(client, "/api/training/me/program")).Program!;
        var onTime = own.Weeks[1].Sessions.Single();
        Assert.AreEqual((ClientSessionState.Completed, (DateOnly?)today.AddDays(7), false),
            (onTime.State, onTime.StartedOn, onTime.IsLate));
        Assert.AreEqual(block.Id, own.Id);
    }

    [TestMethod]
    public async Task A9ASessionStillToComeWaitsForItsDayAndAnEndedProgramStartsNoMissedSession()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "a9-due-coach@example.test", "Coach", "A9 Due");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "a9-due-client@example.test", true);
        SetTenant(client, tenant);
        var resources = await CreateTrainingResourcesAsync(coach, clientId, 8, 2, today);
        var block = await AssignAsync(coach, clientId, resources, today);
        var weeks = (await ReadSliceAsync<CoachClientProgramView>(coach, R34aProgramUrl(clientId))).Blocks.Single().Weeks;
        var nextWeek = weeks[1].Sessions.Single();

        // Week 2 is locked until its day: the client cannot see it, so its session is refused without a reason.
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsync($"/api/training/me/sessions/{nextWeek.SessionId}/start", null),
            HttpStatusCode.Forbidden);

        // With every week shown, the client sees it, and it waits for its day with a reason.
        var mesocycle = await ReadSliceAsync<TrainingMesocycleView>(coach, $"/api/training/mesocycles/{block.Id}");
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PutAsJsonAsync($"/api/training/mesocycles/{block.Id}/visibility",
            new { revealAllWeeks = true, mesocycle.Version }), HttpStatusCode.OK);
        await RefreshCsrfAsync(client);
        var early = await A9ConflictAsync(
            await client.PostAsync($"/api/training/me/sessions/{nextWeek.SessionId}/start", null));
        Assert.AreEqual("session_not_due", early.Code);
        Assert.IsEmpty((await ReadSliceAsync<ClientTrainingUpcomingView>(client, "/api/training/me/upcoming"))
            .UnfinishedWorkouts, "Nothing was started.");

        // Past the program's last day, before the coach closes it, a missed session can no longer be done late.
        RequiredTestClock.Advance(TimeSpan.FromDays(15));
        var own = (await ReadSliceAsync<ClientTrainingProgramView>(client, "/api/training/me/program")).Program!;
        Assert.AreEqual(ClientProgramPhase.Finished, own.Phase);
        Assert.AreEqual(ClientSessionState.Missed, own.Weeks[0].Sessions.Single().State);
        await RefreshCsrfAsync(client);
        var ended = await A9ConflictAsync(
            await client.PostAsync($"/api/training/me/sessions/{own.Weeks[0].Sessions.Single().SessionId}/start", null));
        Assert.AreEqual("program_ended", ended.Code);
        own = (await ReadSliceAsync<ClientTrainingProgramView>(client, "/api/training/me/program")).Program!;
        Assert.AreEqual((ClientSessionState.Missed, 2), (own.Weeks[0].Sessions.Single().State, own.MissedCount));
    }

    [TestMethod]
    public async Task A9AMovedWeighInCarriesTheTrailOfWhatItReplaced()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "a9-move-coach@example.test", "Move Coach", "A9 Move");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "a9-move-client@example.test", true);
        SetTenant(client, workspaceId);

        // 70.2 kg typed, corrected to 70.4, moved a day by the client and another by the coach.
        var first = await Phase5B6RecordAsync(client, 70.2m, "2026-08-17");
        await RefreshCsrfAsync(client);
        var corrected = await client.PutAsJsonAsync($"/api/progress/me/bodyweight/{first.Id}",
            new { value = 70.4m, unit = "Kilogram", reason = "Typed it wrong.", first.Version });
        await AssertStatusAsync(corrected, HttpStatusCode.OK);
        var correction = await RequiredJsonAsync<A9History>(corrected);
        Assert.IsEmpty(correction.Moves);
        await RefreshCsrfAsync(client);
        var moved = await client.PostAsJsonAsync($"/api/progress/me/bodyweight/{first.Id}/replace-date",
            new { measurementDate = "2026-08-18", reason = "Logged on the wrong day.", correction.Current.Version });
        await AssertStatusAsync(moved, HttpStatusCode.OK);
        var once = await RequiredJsonAsync<Phase5B6Correction>(moved);
        await RefreshCsrfAsync(coach);
        var movedAgain = await coach.PostAsJsonAsync(
            $"/api/progress/clients/{clientId}/bodyweight/{once.Replacement.Id}/replace-date",
            new { measurementDate = "2026-08-19", reason = "Weighed on the 19th.", once.Replacement.Version });
        await AssertStatusAsync(movedAgain, HttpStatusCode.OK);
        var twice = await RequiredJsonAsync<Phase5B6Correction>(movedAgain);

        // The newest weigh-in's See changes holds both moves, newest first, and the correction made before them.
        var clientUserId = once.Void.VoidedByUserId;
        var coachUserId = twice.Void.VoidedByUserId;
        foreach (var history in new[]
                 {
                     await RequiredJsonAsync<A9History>(
                         await client.GetAsync($"/api/progress/me/bodyweight/{twice.Replacement.Id}/history")),
                     await RequiredJsonAsync<A9History>(await coach.GetAsync(
                         $"/api/progress/clients/{clientId}/bodyweight/{twice.Replacement.Id}/history")),
                 })
        {
            Assert.AreEqual((new DateOnly(2026, 8, 19), 70.4m, "Active"),
                (history.Current.MeasurementDate, history.Current.EnteredValue, history.Current.Status));
            Assert.IsNull(history.Void);
            Assert.HasCount(2, history.Moves);
            Assert.AreEqual(
                (once.Replacement.Id, new DateOnly(2026, 8, 18), new DateOnly(2026, 8, 19), "Weighed on the 19th.", coachUserId),
                (history.Moves[0].FromObservationId, history.Moves[0].FromDate, history.Moves[0].ToDate,
                    history.Moves[0].Reason, history.Moves[0].MovedByUserId));
            Assert.AreEqual(
                (first.Id, new DateOnly(2026, 8, 17), new DateOnly(2026, 8, 18), "Logged on the wrong day.", clientUserId),
                (history.Moves[1].FromObservationId, history.Moves[1].FromDate, history.Moves[1].ToDate,
                    history.Moves[1].Reason, history.Moves[1].MovedByUserId));
            Assert.AreEqual((70.2m, "Typed it wrong."),
                (history.PreviousValues.Single().EnteredValue, history.PreviousValues.Single().Reason));
        }

        // The middle weigh-in, now voided, still reads its own move out and the trail that brought it there.
        var middle = await RequiredJsonAsync<A9History>(
            await client.GetAsync($"/api/progress/me/bodyweight/{once.Replacement.Id}/history"));
        Assert.AreEqual(("Voided", twice.Replacement.Id), (middle.Current.Status, middle.Void?.ReplacementObservationId));
        Assert.AreEqual(first.Id, middle.Moves.Single().FromObservationId);

        // Another workspace's coach reaches none of it.
        using var other = CreateClient();
        await RegisterCoachAsync(other, "a9-move-other@example.test", "Other Coach", "A9 Elsewhere");
        await AssertStatusAsync(
            await other.GetAsync($"/api/progress/clients/{clientId}/bodyweight/{twice.Replacement.Id}/history"),
            HttpStatusCode.NotFound);
    }

    private static async Task<(string Code, string Message)> A9ConflictAsync(HttpResponseMessage response)
    {
        await AssertStatusAsync(response, HttpStatusCode.Conflict);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return (body.RootElement.GetProperty("code").GetString()!, body.RootElement.GetProperty("message").GetString()!);
    }

    private sealed record A9HistoryObservation(
        Guid Id,
        DateOnly MeasurementDate,
        decimal EnteredValue,
        string Status,
        uint Version);

    private sealed record A9PreviousValue(decimal EnteredValue, string Reason);

    private sealed record A9Move(
        Guid FromObservationId,
        DateOnly FromDate,
        DateOnly ToDate,
        string Reason,
        Guid MovedByUserId,
        DateTimeOffset MovedAtUtc);

    private sealed record A9History(
        A9HistoryObservation Current,
        A9PreviousValue[] PreviousValues,
        Phase5B6Void? Void,
        A9Move[] Moves);
}
