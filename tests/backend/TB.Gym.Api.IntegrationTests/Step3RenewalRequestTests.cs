using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TB.Gym.Modules.Notifications;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Step 3B2, ADR 0029: a client whose whole plan has run out asks their coach to renew. The coach is
/// told in-app, by the client's name, with a link to the client; at most once per client in any 7
/// days, which PostgreSQL enforces.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string RenewalUrl = "/api/client-renewal/me";
    private const string RenewalRequestsUrl = "/api/client-renewal/me/requests";

    [TestMethod]
    public async Task Step3RenewalAskedAfterThePlanRanOutTellsTheCoachByNameInAppOnly()
    {
        var today = TenantToday();
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "renew-coach@example.test", "Hicham Haddad", "Renew Gym");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "renew-client@example.test", true);
        SetTenant(client, tenant);
        await Step3EnrollAsync(coach, clientId, today, 1, "Training");

        var running = await ReadSliceAsync<RenewalStatus>(client, RenewalUrl);
        Assert.IsFalse(running.PlanEnded);
        Assert.IsFalse(running.CanAsk);
        Assert.IsNull(running.CoachName);
        await Step3AssertPlanNotEndedAsync(client);

        RequiredTestClock.Advance(TimeSpan.FromDays(8));
        var ended = await ReadSliceAsync<RenewalStatus>(client, RenewalUrl);
        Assert.IsTrue(ended.PlanEnded);
        Assert.AreEqual(today.AddDays(6), ended.EndedOn, "The plan's last covered day, not its exclusive end.");
        Assert.AreEqual("Hicham Haddad", ended.CoachName);
        Assert.IsTrue(ended.CanAsk);
        Assert.IsNull(ended.LastRequest);

        await RefreshCsrfAsync(client);
        var asked = await client.PostAsync(RenewalRequestsUrl, null);
        await AssertStatusAsync(asked, HttpStatusCode.Created);
        var status = await RequiredJsonAsync<RenewalStatus>(asked);
        Assert.IsFalse(status.CanAsk);
        Assert.AreEqual(today.AddDays(8), status.LastRequest?.RequestedOn);
        Assert.AreEqual(today.AddDays(15), status.LastRequest?.AskAgainFrom);

        // The intent names nobody and carries nothing but the client's id: no health or payment data.
        var payload = await Step3RenewalPayloadAsync(clientId);
        using (var document = JsonDocument.Parse(payload))
        {
            Assert.AreEqual(
                "clientProfileId,schemaVersion",
                string.Join(',', document.RootElement.EnumerateObject().Select(property => property.Name).Order()));
        }

        await Step3SweepNotificationsAsync();
        var inbox = await RequiredJsonAsync<RenewalInbox>(await coach.GetAsync("/api/notifications"));
        var notice = inbox.Items.Single(item => item.Kind == nameof(CommercialNotificationKind.RenewalRequested));
        Assert.AreEqual("Training Client asked to renew", notice.Title);
        Assert.AreEqual(clientId, notice.ClientProfileId, "The coach's notice links to the client.");
        foreach (var forbidden in new[] { "USD", "$", "0.00", "allerg", "injur", "medic" })
        {
            Assert.IsFalse(notice.Title.Contains(forbidden, StringComparison.OrdinalIgnoreCase), forbidden);
            Assert.IsFalse(notice.Body.Contains(forbidden, StringComparison.OrdinalIgnoreCase), forbidden);
        }

        // Marking it read keeps the link, so the inbox row can be replaced by the answer.
        await RefreshCsrfAsync(coach);
        var read = await coach.PostAsync($"/api/notifications/{notice.Id}/read", null);
        await AssertStatusAsync(read, HttpStatusCode.OK);
        Assert.AreEqual(clientId, (await RequiredJsonAsync<RenewalNotice>(read)).ClientProfileId);

        // Nothing is emailed, and the client's own inbox has no notice about it.
        Assert.AreEqual(0L, await Phase6CountAsync(
            RequiredDatabaseConnection,
            """
            SELECT count(*) FROM notifications."ChannelDeliveries" d
            JOIN notifications."OutboxItems" o ON o."Id" = d."OutboxItemId"
            WHERE o."AggregateId" = @id AND o."Kind" = 'RenewalRequested' AND d."Channel" <> 'InApp'
            """,
            clientId));
        var own = await RequiredJsonAsync<RenewalInbox>(await client.GetAsync("/api/notifications"));
        Assert.IsFalse(own.Items.Any(item => item.Kind == nameof(CommercialNotificationKind.RenewalRequested)));
        Assert.IsTrue(own.Items.All(item => item.ClientProfileId is null));
    }

    [TestMethod]
    public async Task Step3RenewalADoubleTapAndTwoRequestsAtOnceStoreOneRequestAndOneNotice()
    {
        var (client, clientId) = await Step3ClientWithOneWeekPlanAsync("renew-twice");
        var (racer, racerId) = await Step3ClientWithOneWeekPlanAsync("renew-race");
        RequiredTestClock.Advance(TimeSpan.FromDays(8));
        using (client)
        {
            await RefreshCsrfAsync(client);
            var first = await client.PostAsync(RenewalRequestsUrl, null);
            await AssertStatusAsync(first, HttpStatusCode.Created);
            var second = await client.PostAsync(RenewalRequestsUrl, null);
            await AssertStatusAsync(second, HttpStatusCode.OK);
            Assert.AreEqual(
                (await RequiredJsonAsync<RenewalStatus>(first)).LastRequest?.Id,
                (await RequiredJsonAsync<RenewalStatus>(second)).LastRequest?.Id);
            Assert.AreEqual(1L, await Step3CountRenewalRequestsAsync(clientId));
            Assert.AreEqual(1L, await Step3CountRenewalNoticesAsync(clientId));
        }

        using (racer)
        {
            await RefreshCsrfAsync(racer);
            // Both requests are held at the insert, after both have found no request yet.
            RequiredInsertBarrier.Arm("subscriptions.\"RenewalRequests\"", 2);
            HttpResponseMessage[] asks;
            try
            {
                asks = await Task.WhenAll(racer.PostAsync(RenewalRequestsUrl, null), racer.PostAsync(RenewalRequestsUrl, null));
                Assert.AreEqual(2, RequiredInsertBarrier.Arrived, "The two requests never raced.");
            }
            finally
            {
                RequiredInsertBarrier.Disarm();
            }

            CollectionAssert.AreEquivalent(
                new[] { HttpStatusCode.Created, HttpStatusCode.OK },
                asks.Select(response => response.StatusCode).ToArray());
            var ids = await Task.WhenAll(asks.Select(async response =>
                (await RequiredJsonAsync<RenewalStatus>(response)).LastRequest?.Id));
            Assert.AreEqual(ids[0], ids[1]);
            Assert.AreEqual(1L, await Step3CountRenewalRequestsAsync(racerId));
            Assert.AreEqual(1L, await Step3CountRenewalNoticesAsync(racerId));
        }
    }

    [TestMethod]
    public async Task Step3RenewalWindowIsSevenWorkspaceDaysAndTheDatabaseHoldsIt()
    {
        var (client, clientId) = await Step3ClientWithOneWeekPlanAsync("renew-window");
        RequiredTestClock.Advance(TimeSpan.FromDays(8));
        using (client)
        {
            await RefreshCsrfAsync(client);
            var first = await RequiredJsonAsync<RenewalStatus>(await client.PostAsync(RenewalRequestsUrl, null));

            RequiredTestClock.Advance(TimeSpan.FromDays(6));
            await RefreshCsrfAsync(client);
            var sixDaysLater = await client.PostAsync(RenewalRequestsUrl, null);
            await AssertStatusAsync(sixDaysLater, HttpStatusCode.OK);
            Assert.AreEqual(first.LastRequest?.Id, (await RequiredJsonAsync<RenewalStatus>(sixDaysLater)).LastRequest?.Id);

            RequiredTestClock.Advance(TimeSpan.FromDays(1));
            Assert.IsTrue((await ReadSliceAsync<RenewalStatus>(client, RenewalUrl)).CanAsk);
            await RefreshCsrfAsync(client);
            var sevenDaysLater = await client.PostAsync(RenewalRequestsUrl, null);
            await AssertStatusAsync(sevenDaysLater, HttpStatusCode.Created);
            Assert.AreNotEqual(first.LastRequest?.Id, (await RequiredJsonAsync<RenewalStatus>(sevenDaysLater)).LastRequest?.Id);
            Assert.AreEqual(2L, await Step3CountRenewalRequestsAsync(clientId));
            Assert.AreEqual(2L, await Step3CountRenewalNoticesAsync(clientId));
        }

        // The rule is the database's, not only the service's: an overlapping row is refused, and
        // stored requests can be neither changed nor removed.
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using (var overlap = connection.CreateCommand())
        {
            overlap.CommandText =
                """
                INSERT INTO subscriptions."RenewalRequests"
                    ("Id", "TenantId", "ClientProfileId", "EndedEnrollmentId", "CoachUserId", "RequestedOn",
                     "AskAgainFrom", "RequestedAtUtc")
                SELECT uuidv7(), "TenantId", "ClientProfileId", "EndedEnrollmentId", "CoachUserId",
                       "RequestedOn" + 3, "RequestedOn" + 10, now()
                FROM subscriptions."RenewalRequests" WHERE "ClientProfileId" = @id
                ORDER BY "RequestedOn" LIMIT 1
                """;
            overlap.Parameters.AddWithValue("id", clientId);
            var refused = await Assert.ThrowsAsync<PostgresException>(() => overlap.ExecuteNonQueryAsync());
            Assert.AreEqual(PostgresErrorCodes.ExclusionViolation, refused.SqlState);
        }

        await using (var rewrite = connection.CreateCommand())
        {
            rewrite.CommandText = """UPDATE subscriptions."RenewalRequests" SET "RequestedAtUtc" = now() WHERE "ClientProfileId" = @id""";
            rewrite.Parameters.AddWithValue("id", clientId);
            await Assert.ThrowsAsync<PostgresException>(() => rewrite.ExecuteNonQueryAsync());
        }

        await using (var remove = connection.CreateCommand())
        {
            remove.CommandText = """DELETE FROM subscriptions."RenewalRequests" WHERE "ClientProfileId" = @id""";
            remove.Parameters.AddWithValue("id", clientId);
            await Assert.ThrowsAsync<PostgresException>(() => remove.ExecuteNonQueryAsync());
        }
    }

    [TestMethod]
    public async Task Step3RenewalIsRefusedUnlessTheWholePlanRanOut()
    {
        var today = TenantToday();
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "renew-refused@example.test", "Coach", "Refused Gym");

        // Paused and cancelled plans are the coach's decisions; neither offers the button.
        using var paused = CreateClient();
        var pausedId = await InviteAndAcceptAsync(coach, paused, "renew-paused@example.test", true);
        SetTenant(paused, tenant);
        var pausedPlan = await Step3EnrollAsync(coach, pausedId, today, 4, "Training");
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PostAsJsonAsync($"/api/commercial/enrollments/{pausedPlan.Id}/pause",
            new { reason = "Travelling", pausedPlan.Version }), HttpStatusCode.OK);

        using var cancelled = CreateClient();
        var cancelledId = await InviteAndAcceptAsync(coach, cancelled, "renew-cancelled@example.test", true);
        SetTenant(cancelled, tenant);
        var cancelledPlan = await Step3EnrollAsync(coach, cancelledId, today, 4, "Training");
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PostAsJsonAsync($"/api/commercial/enrollments/{cancelledPlan.Id}/cancel",
            new { reason = "Ended early", cancelledPlan.Version }), HttpStatusCode.OK);

        // Training ran out but nutrition runs on: the plan has not ended.
        using var partial = CreateClient();
        var partialId = await InviteAndAcceptAsync(coach, partial, "renew-partial@example.test", true);
        SetTenant(partial, tenant);
        await Step3EnrollAsync(coach, partialId, today, 1, "Training");
        await Step3EnrollAsync(coach, partialId, today, 4, "Nutrition");

        RequiredTestClock.Advance(TimeSpan.FromDays(8));
        foreach (var refused in new[] { paused, cancelled, partial })
        {
            Assert.IsFalse((await ReadSliceAsync<RenewalStatus>(refused, RenewalUrl)).PlanEnded);
            await Step3AssertPlanNotEndedAsync(refused);
        }

        Assert.AreEqual(0L, await Phase6CountAsync(
            RequiredDatabaseConnection,
            """SELECT count(*) FROM subscriptions."RenewalRequests" WHERE "TenantId" = @id""",
            tenant));
    }

    [TestMethod]
    public async Task Step3RenewalStaysInItsWorkspaceAndIsClosedOnceTheClientIsReleased()
    {
        var today = TenantToday();
        using var coachA = CreateClient();
        var workspaceA = await RegisterCoachAsync(coachA, "renew-scope-a@example.test", "Coach A", "Scope A");
        using var shared = CreateClient();
        var clientA = await InviteAndAcceptAsync(coachA, shared, "renew-scope-client@example.test", true);
        await Step3EnrollAsync(coachA, clientA, today, 1, "Training");

        using var coachB = CreateClient();
        var workspaceB = await RegisterCoachAsync(coachB, "renew-scope-b@example.test", "Coach B", "Scope B");
        var clientB = await InviteAndAcceptAsync(coachB, shared, "renew-scope-client@example.test", false);
        await Step3EnrollAsync(coachB, clientB, today, 8, "Training");
        RequiredTestClock.Advance(TimeSpan.FromDays(8));

        // The plan in B runs on, so asking there is refused; asking in A reaches A's coach only.
        SetTenant(shared, workspaceB);
        await Step3AssertPlanNotEndedAsync(shared);
        SetTenant(shared, workspaceA);
        await RefreshCsrfAsync(shared);
        await AssertStatusAsync(await shared.PostAsync(RenewalRequestsUrl, null), HttpStatusCode.Created);
        await Step3SweepNotificationsAsync();
        var inboxB = await RequiredJsonAsync<RenewalInbox>(await coachB.GetAsync("/api/notifications"));
        Assert.IsFalse(inboxB.Items.Any(item => item.Kind == nameof(CommercialNotificationKind.RenewalRequested)));
        Assert.AreEqual(0L, await Step3CountRenewalRequestsAsync(clientB));

        // A workspace the person does not belong to, and a coach using the client route, are refused.
        using var foreignCoach = CreateClient();
        var foreign = await RegisterCoachAsync(foreignCoach, "renew-scope-foreign@example.test", "Other", "Other");
        SetTenant(shared, foreign);
        await RefreshCsrfAsync(shared);
        await AssertStatusAsync(await shared.PostAsync(RenewalRequestsUrl, null), HttpStatusCode.Forbidden);
        await RefreshCsrfAsync(coachA);
        await AssertStatusAsync(await coachA.PostAsync(RenewalRequestsUrl, null), HttpStatusCode.Forbidden);

        // Once the owner releases the client, the client can no longer ask at all.
        SetTenant(shared, workspaceA);
        var profile = await ReadSliceAsync<SliceProfileVersion>(coachA, $"/api/clients/{clientA}");
        await RefreshCsrfAsync(coachA);
        await AssertStatusAsync(await coachA.PostAsJsonAsync($"/api/clients/{clientA}/release",
            new { reason = "Moved away", profile.Version }), HttpStatusCode.OK);
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        await RefreshCsrfAsync(shared);
        await AssertStatusAsync(await shared.PostAsync(RenewalRequestsUrl, null), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await shared.GetAsync(RenewalUrl), HttpStatusCode.Forbidden);
    }

    /// <summary>A client with a one-week plan from today; move the clock 8 days to end it.</summary>
    private async Task<(HttpClient Client, Guid ClientId)> Step3ClientWithOneWeekPlanAsync(string name)
    {
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, $"{name}-coach@example.test", "Coach", name);
        var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, $"{name}-client@example.test", true);
        SetTenant(client, tenant);
        await Step3EnrollAsync(coach, clientId, TenantToday(), 1, "Training");
        return (client, clientId);
    }

    private static async Task<RenewalEnrollment> Step3EnrollAsync(
        HttpClient coach,
        Guid clientId,
        DateOnly startDate,
        int weeks,
        params string[] features)
    {
        await RefreshCsrfAsync(coach);
        var productResponse = await coach.PostAsJsonAsync("/api/commercial/products", new
        {
            name = $"{string.Join(" + ", features)} for {weeks} weeks {Guid.NewGuid():N}",
            description = "Step 3B2 renewal scenario",
            initialOffer = new
            {
                label = $"{weeks} weeks",
                durationCount = weeks,
                durationUnit = "Week",
                priceAmount = 0m,
                priceCurrency = "USD",
                features = features.Select(feature => new { feature, allowsConcurrentCoverage = false }).ToArray(),
            },
        });
        await AssertStatusAsync(productResponse, HttpStatusCode.OK);
        var product = await RequiredJsonAsync<Product>(productResponse);
        await RefreshCsrfAsync(coach);
        var enrollment = await coach.PostAsJsonAsync(
            $"/api/commercial/clients/{clientId}/enrollments",
            new { offerId = product.Offers[0].Id, startDate, idempotencyKey = Guid.NewGuid() });
        await AssertStatusAsync(enrollment, HttpStatusCode.OK);
        return await RequiredJsonAsync<RenewalEnrollment>(enrollment);
    }

    private static async Task Step3AssertPlanNotEndedAsync(HttpClient client)
    {
        await RefreshCsrfAsync(client);
        var response = await client.PostAsync(RenewalRequestsUrl, null);
        await AssertStatusAsync(response, HttpStatusCode.Conflict);
        StringAssert.Contains(await response.Content.ReadAsStringAsync(), "plan_not_ended");
    }

    private async Task Step3SweepNotificationsAsync()
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<INotificationDispatchService>().DispatchDueAsync(CancellationToken.None);
    }

    private Task<long> Step3CountRenewalRequestsAsync(Guid clientId) =>
        Phase6CountAsync(
            RequiredDatabaseConnection,
            """SELECT count(*) FROM subscriptions."RenewalRequests" WHERE "ClientProfileId" = @id""",
            clientId);

    private Task<long> Step3CountRenewalNoticesAsync(Guid clientId) =>
        Phase6CountAsync(
            RequiredDatabaseConnection,
            """SELECT count(*) FROM notifications."OutboxItems" WHERE "AggregateId" = @id AND "Kind" = 'RenewalRequested'""",
            clientId);

    private async Task<string> Step3RenewalPayloadAsync(Guid clientId)
    {
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            """SELECT "PayloadJson"::text FROM notifications."OutboxItems" WHERE "AggregateId" = @id AND "Kind" = 'RenewalRequested'""";
        command.Parameters.AddWithValue("id", clientId);
        return (string)(await command.ExecuteScalarAsync() ?? throw new AssertFailedException("No renewal notice was queued."));
    }

    private sealed record RenewalEnrollment(Guid Id, uint Version);
    private sealed record RenewalRequestSummary(Guid Id, DateOnly RequestedOn, DateOnly AskAgainFrom);
    private sealed record RenewalStatus(
        bool PlanEnded,
        DateOnly? EndedOn,
        string? CoachName,
        RenewalRequestSummary? LastRequest,
        bool CanAsk);
    private sealed record RenewalNotice(Guid Id, string Kind, string Title, string Body, Guid? ClientProfileId);
    private sealed record RenewalInbox(RenewalNotice[] Items);
}
