using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using TB.Gym.Modules.Notifications;
using TB.Gym.Modules.Training;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// R5.1c, ADR 0036: the client hears in-app of a new program, of weeks they can now open, of a change
/// to weeks they could already open, and of a coach's note on a workout; the coach hears of a client's
/// note. A notice says only what the client can see now, names weeks by number, never carries a note's
/// text, and is not said once it no longer holds. The inbox filters unread and marks all read.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task R51cANewProgramAndItsWeeksTellTheClientOnlyWhatTheyCanOpenNow()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        // Three weeks from today: week 1 is open now, weeks 2 and 3 open on their days.
        var scenario = await P2StartAsync(coach, client, "r51c-weeks", 3);
        SetTenant(client, scenario.WorkspaceId);
        var block = scenario.Block;

        await R51cSweepAsync();
        // Enrolling the client already said "Coaching access activated"; only training notices are counted here.
        var first = await R51cTrainingAsync(client);
        var assigned = first.Single();
        Assert.AreEqual(nameof(CommercialNotificationKind.ProgramAssigned), assigned.Kind);
        Assert.AreEqual("Your coach set up a new program", assigned.Title);
        Assert.IsNull(assigned.ClientProfileId, "A client's own notice links to their own Training, not a client page.");
        Assert.AreEqual(
            "clientProfileId,mesocycleId,schemaVersion,sessionId,weeks,workoutExecutionId",
            await R51cPayloadKeysAsync(block.Id, nameof(CommercialNotificationKind.ProgramAssigned)));

        // Unsharing and sharing a week whose day has not come says nothing: it arrives on its day.
        var view = await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id));
        var version = await R51cPublishAsync(coach, block.Id, view.Weeks[1].Id, false, view.Version);
        version = await R51cPublishAsync(coach, block.Id, view.Weeks[1].Id, true, version);
        await R51cSweepAsync();
        Assert.HasCount(1, await R51cTrainingAsync(client));

        // New weights for all three weeks: the client can open only week 1, so only week 1 is named, and
        // never a weight.
        var change = P2Change(scenario.Resources.Exercise.Id, value: 110m);
        var preview = await P2PreviewOkAsync(coach, block.Id, version, change);
        version = (await P2ApplyOkAsync(coach, block.Id, version, [change], null, preview.PreviewHash, Guid.NewGuid())).Version;
        await R51cSweepAsync();
        var updated = (await R51cInboxAsync(client)).Items.Single(item => item.Kind == nameof(CommercialNotificationKind.WeeksChanged));
        Assert.AreEqual("Your coach updated week 1", updated.Title);
        Assert.AreEqual(1, updated.WeekNumber);
        Assert.DoesNotContain("kg", updated.Title + updated.Body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("110", updated.Title + updated.Body, StringComparison.Ordinal);

        // Revealing every week opens weeks 2 and 3 now: one notice names both.
        await RefreshCsrfAsync(coach);
        var revealed = await coach.PutAsJsonAsync(
            $"/api/training/mesocycles/{block.Id}/visibility",
            new { revealAllWeeks = true, version });
        await AssertStatusAsync(revealed, HttpStatusCode.OK);
        version = (await ReadSlicePayloadAsync<TrainingMesocycleView>(revealed)).Version;
        await R51cSweepAsync();
        var shared = (await R51cInboxAsync(client)).Items.Single(item => item.Kind == nameof(CommercialNotificationKind.WeeksShared));
        Assert.AreEqual("Your coach shared weeks 2 and 3", shared.Title);
        Assert.AreEqual(2, shared.WeekNumber);

        // Week 3 unshared then shared again is open again: said once more, for that week alone.
        version = await R51cPublishAsync(coach, block.Id, view.Weeks[2].Id, false, version);
        version = await R51cPublishAsync(coach, block.Id, view.Weeks[2].Id, true, version);
        await R51cSweepAsync();
        var inbox = await R51cInboxAsync(client);
        Assert.AreEqual(
            "Your coach shared week 3",
            inbox.Items.First(item => item.Kind == nameof(CommercialNotificationKind.WeeksShared)).Title);


        // Nothing reaches email, and the coach's own inbox has none of it.
        Assert.AreEqual(0L, await Phase6CountAsync(
            RequiredDatabaseConnection,
            """
            SELECT count(*) FROM notifications."ChannelDeliveries" d
            JOIN notifications."OutboxItems" o ON o."Id" = d."OutboxItemId"
            WHERE o."AggregateId" = @id AND d."Channel" <> 'InApp'
            """,
            block.Id));
        Assert.IsFalse((await R51cInboxAsync(coach, scenario.WorkspaceId)).Items.Any(item => item.Kind.StartsWith("Week", StringComparison.Ordinal)));
    }

    [TestMethod]
    public async Task R51cANoteOnAWorkoutTellsTheOtherSideWithoutItsText()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2StartAsync(coach, client, "r51c-notes", 1);
        SetTenant(client, scenario.WorkspaceId);

        var day = await client.GetFromJsonAsync<TrainingDay>("/api/training/me/today")
            ?? throw new AssertFailedException("Training day was empty.");
        await RefreshCsrfAsync(client);
        var start = await client.PostAsync($"/api/training/me/sessions/{day.Workouts.Single().SessionId}/start", null);
        await AssertStatusAsync(start, HttpStatusCode.OK);
        var execution = await RequiredJsonAsync<Execution>(start);
        const string secret = "Left knee hurt on the last set";
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync($"/api/training/workouts/{execution.Id}/notes", new { exercisePerformanceId = (Guid?)null, text = secret }),
            HttpStatusCode.OK);

        await R51cSweepAsync();
        var toCoach = (await R51cInboxAsync(coach, scenario.WorkspaceId)).Items
            .Single(item => item.Kind == nameof(CommercialNotificationKind.ClientWorkoutNote));
        Assert.AreEqual("Training Client left a note on a workout", toCoach.Title);
        Assert.AreEqual(scenario.ClientId, toCoach.ClientProfileId);
        Assert.AreEqual(day.Workouts.Single().SessionId, toCoach.SessionId);
        Assert.AreEqual(execution.Id, toCoach.WorkoutExecutionId);
        Assert.DoesNotContain("knee", toCoach.Title + toCoach.Body, StringComparison.OrdinalIgnoreCase);
        Assert.IsFalse((await R51cInboxAsync(client)).Items.Any(item => item.Kind.EndsWith("WorkoutNote", StringComparison.Ordinal)),
            "The client is not told of their own note.");

        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync($"/api/training/workouts/{execution.Id}/notes", new { exercisePerformanceId = (Guid?)null, text = "Ease off next time" }),
            HttpStatusCode.OK);
        await R51cSweepAsync();
        var toClient = (await R51cInboxAsync(client)).Items
            .Single(item => item.Kind == nameof(CommercialNotificationKind.CoachWorkoutNote));
        Assert.AreEqual("Your coach left a note on a workout", toClient.Title);
        Assert.AreEqual(execution.Id, toClient.WorkoutExecutionId);
        Assert.IsNull(toClient.ClientProfileId);
        Assert.DoesNotContain("Ease", toClient.Title + toClient.Body, StringComparison.OrdinalIgnoreCase);

        // The payload holds identifiers only, never the note.
        var payloads = await R51cPayloadsAsync(execution.Id);
        Assert.HasCount(2, payloads);
        Assert.IsTrue(payloads.All(payload => !payload.Contains("knee", StringComparison.OrdinalIgnoreCase) &&
            !payload.Contains("Ease", StringComparison.Ordinal)));
    }

    [TestMethod]
    public async Task R51cANoticeThatNoLongerHoldsIsNotSaid()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2StartAsync(coach, client, "r51c-stale", 3);
        SetTenant(client, scenario.WorkspaceId);
        var block = scenario.Block;

        // Weeks revealed then hidden again before the notice is delivered: nothing is said.
        await RefreshCsrfAsync(coach);
        var revealed = await coach.PutAsJsonAsync(
            $"/api/training/mesocycles/{block.Id}/visibility",
            new { revealAllWeeks = true, version = block.Version });
        await AssertStatusAsync(revealed, HttpStatusCode.OK);
        var version = (await ReadSlicePayloadAsync<TrainingMesocycleView>(revealed)).Version;
        await RefreshCsrfAsync(coach);
        var hidden = await coach.PutAsJsonAsync(
            $"/api/training/mesocycles/{block.Id}/visibility",
            new { revealAllWeeks = false, version });
        await AssertStatusAsync(hidden, HttpStatusCode.OK);
        version = (await ReadSlicePayloadAsync<TrainingMesocycleView>(hidden)).Version;

        // A program cancelled before its notice is delivered: the client is not told of it either.
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync($"/api/training/mesocycles/{block.Id}/cancel", new { reason = "Changed plan", version }),
            HttpStatusCode.OK);
        await R51cSweepAsync();

        Assert.IsEmpty(await R51cTrainingAsync(client));
        Assert.AreEqual(2L, await Phase6CountAsync(
            RequiredDatabaseConnection,
            """
            SELECT count(*) FROM notifications."ChannelDeliveries" d
            JOIN notifications."OutboxItems" o ON o."Id" = d."OutboxItemId"
            WHERE o."AggregateId" = @id AND d."Status" = 'Suppressed' AND d."FailureCode" = 'notification-state-changed'
            """,
            block.Id));
    }

    [TestMethod]
    public async Task R51cTheInboxFiltersUnreadAndMarksAllOfOnlyTheReadersOwnRead()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2StartAsync(coach, client, "r51c-readall", 3);
        SetTenant(client, scenario.WorkspaceId);
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PutAsJsonAsync(
                $"/api/training/mesocycles/{scenario.Block.Id}/visibility",
                new { revealAllWeeks = true, version = scenario.Block.Version }),
            HttpStatusCode.OK);
        await R51cAddClientNoteAsync(client);
        await R51cSweepAsync();

        // A new program and two weeks shared, beside the plan's own activation notice.
        var all = await R51cInboxAsync(client);
        Assert.HasCount(2, all.Items.Where(R51cIsTraining).ToArray());
        Assert.AreEqual(all.Total, all.UnreadTotal);
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(await client.PostAsync($"/api/notifications/{all.Items[0].Id}/read", null), HttpStatusCode.OK);
        var unread = await RequiredJsonAsync<R51cInbox>(await client.GetAsync("/api/notifications?unread=true"));
        Assert.AreEqual(all.Total - 1, unread.Total);
        Assert.AreEqual(all.Total - 1, unread.UnreadTotal);
        CollectionAssert.AreEqual(all.Items.Skip(1).Select(item => item.Id).ToArray(), unread.Items.Select(item => item.Id).ToArray());
        Assert.IsTrue(unread.Items.All(item => !item.IsRead));

        // Mark all as read: the client's own only. The coach's notice of the client's note stays unread.
        var coachUnreadBefore = (await R51cInboxAsync(coach, scenario.WorkspaceId)).UnreadTotal;
        Assert.IsGreaterThanOrEqualTo(1L, coachUnreadBefore);
        await RefreshCsrfAsync(client);
        var marked = await client.PostAsync("/api/notifications/read-all", null);
        await AssertStatusAsync(marked, HttpStatusCode.OK);
        var result = await RequiredJsonAsync<NotificationReadAllResult>(marked);
        Assert.AreEqual(all.Total - 1, result.Marked);
        Assert.AreEqual(0L, result.Unread);
        var again = await client.PostAsync("/api/notifications/read-all", null);
        await AssertStatusAsync(again, HttpStatusCode.OK);
        Assert.AreEqual(0, (await RequiredJsonAsync<NotificationReadAllResult>(again)).Marked, "Marking all read twice changes nothing.");
        Assert.IsEmpty((await RequiredJsonAsync<R51cInbox>(await client.GetAsync("/api/notifications?unread=true"))).Items);
        Assert.AreEqual(coachUnreadBefore, (await R51cInboxAsync(coach, scenario.WorkspaceId)).UnreadTotal);

        // Without the antiforgery token, signed out, or in a workspace the person is not a member of: refused.
        using var stranger = CreateClient();
        var otherWorkspace = await RegisterCoachAsync(stranger, "r51c-stranger@example.test", "Other Coach", "Other Gym");
        SetTenant(client, otherWorkspace);
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(await client.PostAsync("/api/notifications/read-all", null), HttpStatusCode.Forbidden);
        SetTenant(client, scenario.WorkspaceId);
        using var anonymous = CreateClient();
        SetTenant(anonymous, scenario.WorkspaceId);
        Assert.IsFalse((await anonymous.PostAsync("/api/notifications/read-all", null)).IsSuccessStatusCode);
    }

    private async Task R51cSweepAsync()
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<INotificationDispatchService>().DispatchDueAsync(CancellationToken.None);
    }

    private static async Task<R51cInbox> R51cInboxAsync(HttpClient reader, Guid? workspaceId = null)
    {
        if (workspaceId is { } tenant)
        {
            SetTenant(reader, tenant);
        }

        return await RequiredJsonAsync<R51cInbox>(await reader.GetAsync("/api/notifications"));
    }

    private static bool R51cIsTraining(R51cNotice notice) =>
        Enum.TryParse<CommercialNotificationKind>(notice.Kind, out var kind) && NotificationPurposeCatalog.IsTrainingKind(kind);

    private static async Task<R51cNotice[]> R51cTrainingAsync(HttpClient reader) =>
        (await R51cInboxAsync(reader)).Items.Where(R51cIsTraining).ToArray();

    private static async Task<uint> R51cPublishAsync(HttpClient coach, Guid mesocycleId, Guid weekId, bool isPublished, uint version)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PutAsJsonAsync(
            $"/api/training/mesocycles/{mesocycleId}/weeks/{weekId}/publish",
            new { isPublished, version });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return (await ReadSlicePayloadAsync<TrainingMesocycleView>(response)).Version;
    }

    private static async Task R51cAddClientNoteAsync(HttpClient client)
    {
        var day = await client.GetFromJsonAsync<TrainingDay>("/api/training/me/today")
            ?? throw new AssertFailedException("Training day was empty.");
        await RefreshCsrfAsync(client);
        var start = await client.PostAsync($"/api/training/me/sessions/{day.Workouts.Single().SessionId}/start", null);
        await AssertStatusAsync(start, HttpStatusCode.OK);
        var execution = await RequiredJsonAsync<Execution>(start);
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync($"/api/training/workouts/{execution.Id}/notes", new { exercisePerformanceId = (Guid?)null, text = "Felt strong" }),
            HttpStatusCode.OK);
    }

    private async Task<string> R51cPayloadKeysAsync(Guid aggregateId, string kind)
    {
        var payloads = await R51cPayloadsAsync(aggregateId, kind);
        using var document = JsonDocument.Parse(payloads.Single());
        return string.Join(',', document.RootElement.EnumerateObject().Select(property => property.Name).Order());
    }

    private async Task<string[]> R51cPayloadsAsync(Guid aggregateId, string? kind = null)
    {
        await using var connection = new Npgsql.NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = new Npgsql.NpgsqlCommand(
            """SELECT "PayloadJson"::text FROM notifications."OutboxItems" WHERE "AggregateId" = @id AND (@kind::text IS NULL OR "Kind" = @kind)""",
            connection);
        command.Parameters.AddWithValue("id", aggregateId);
        command.Parameters.Add(new Npgsql.NpgsqlParameter("kind", NpgsqlTypes.NpgsqlDbType.Text) { Value = (object?)kind ?? DBNull.Value });
        var payloads = new List<string>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            payloads.Add(reader.GetString(0));
        }

        return [.. payloads];
    }

    private sealed record R51cNotice(
        Guid Id,
        string Kind,
        string Title,
        string Body,
        bool IsRead,
        Guid? ClientProfileId,
        Guid? SessionId,
        Guid? WorkoutExecutionId,
        int? WeekNumber);

    private sealed record R51cInbox(long Total, long UnreadTotal, R51cNotice[] Items);
}
