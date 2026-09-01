using System.Net;
using System.Net.Http.Json;
using TB.Gym.Modules.Notifications;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The tenant-member inbox and the owner-only dead-letter view, over HTTP against real PostgreSQL.
/// </summary>
public sealed partial class Phase6B1NotificationDispatchTests
{
    /// <summary>
    /// Requirement 15: a notification belongs to one workspace. A member of another workspace cannot
    /// see it or mark it read, and the refusal discloses nothing about whether it exists.
    /// </summary>
    [TestMethod]
    public async Task AnotherWorkspaceCanNeitherReadNorMarkThisWorkspaceNotification()
    {
        var alpha = await CreateWorkspaceAsync("iso-alpha");
        var beta = await CreateWorkspaceAsync("iso-beta");
        await AssignPaidLaterAsync(alpha, 120m);
        await SweepAsync();

        var alphaInbox = await InboxAsync(alpha.Client);
        Assert.HasCount(1, alphaInbox.Items);
        var notificationId = alphaInbox.Items[0].Id;

        // Beta's own client sees an empty inbox, and cannot reach alpha's notification.
        var betaInbox = await InboxAsync(beta.Client);
        Assert.IsEmpty(betaInbox.Items);
        Assert.AreEqual(0L, betaInbox.Total);
        await AssertStatusAsync(await MarkReadAsync(beta.Client, notificationId), HttpStatusCode.NotFound);

        // Naming alpha's workspace in the header does not help: membership is verified server-side.
        SetTenant(beta.Client, alpha.TenantId);
        await AssertStatusAsync(await beta.Client.GetAsync("/api/notifications"), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await MarkReadAsync(beta.Client, notificationId), HttpStatusCode.Forbidden);

        // Nothing was changed by any of that.
        Assert.IsFalse((await InboxAsync(alpha.Client)).Items[0].IsRead);
    }

    /// <summary>
    /// Requirement 16: inside one workspace, a notification still belongs to one recipient. The coach
    /// is a member of the same workspace and is not thereby a reader of the client's inbox.
    /// </summary>
    [TestMethod]
    public async Task AnotherRecipientInTheSameWorkspaceCanNeitherReadNorMarkIt()
    {
        var workspace = await CreateWorkspaceAsync("recipient");
        await AssignPaidLaterAsync(workspace, 120m);
        await SweepAsync();

        var clientInbox = await InboxAsync(workspace.Client);
        Assert.HasCount(1, clientInbox.Items);
        var notificationId = clientInbox.Items[0].Id;

        var coachInbox = await InboxAsync(workspace.Coach);
        Assert.IsEmpty(coachInbox.Items);
        Assert.AreEqual(0L, coachInbox.Total);
        Assert.AreEqual(0L, (await UnreadCountAsync(workspace.Coach)).Unread);
        await AssertStatusAsync(await MarkReadAsync(workspace.Coach, notificationId), HttpStatusCode.NotFound);

        Assert.IsFalse((await InboxAsync(workspace.Client)).Items[0].IsRead);
    }

    /// <summary>
    /// Requirement 17: removing the membership closes the inbox immediately, for reads and for writes.
    /// The notifications are not deleted; they simply stop being reachable through that workspace.
    /// </summary>
    [TestMethod]
    public async Task RemovingTheMembershipClosesInboxAccess()
    {
        var workspace = await CreateWorkspaceAsync("membership");
        await AssignPaidLaterAsync(workspace, 120m);
        await SweepAsync();
        var notificationId = (await InboxAsync(workspace.Client)).Items[0].Id;

        await ExecuteAsync(
            """UPDATE tenancy."Memberships" SET "Status" = 'Removed' WHERE "UserId" = @id""",
            ("id", workspace.ClientUserId));

        await AssertStatusAsync(
            await workspace.Client.GetAsync("/api/notifications"),
            HttpStatusCode.Forbidden);
        await AssertStatusAsync(
            await workspace.Client.GetAsync("/api/notifications/unread-count"),
            HttpStatusCode.Forbidden);
        await AssertStatusAsync(await MarkReadAsync(workspace.Client, notificationId), HttpStatusCode.Forbidden);

        Assert.AreEqual(1L, await ScalarAsync<long>(
            """SELECT count(*) FROM notifications."Notifications" WHERE "Id" = @id""",
            ("id", notificationId)));
    }

    /// <summary>
    /// Requirement 18: marking read is idempotent, and two concurrent requests for the same
    /// notification both succeed while only one read instant is recorded.
    /// </summary>
    [TestMethod]
    public async Task MarkingReadIsIdempotentAndSafeUnderConcurrency()
    {
        var workspace = await CreateWorkspaceAsync("markread");
        await AssignPaidLaterAsync(workspace, 120m);
        await SweepAsync();
        var notificationId = (await InboxAsync(workspace.Client)).Items[0].Id;
        Assert.AreEqual(1L, (await UnreadCountAsync(workspace.Client)).Unread);

        var first = await MarkReadAsync(workspace.Client, notificationId);
        await AssertStatusAsync(first, HttpStatusCode.OK);
        var read = await RequiredJsonAsync<NotificationItem>(first);
        Assert.IsTrue(read.IsRead);
        Assert.IsNotNull(read.ReadAtUtc);
        Assert.AreEqual(0L, (await UnreadCountAsync(workspace.Client)).Unread);

        // Repeating it is a success that changes nothing, including the instant.
        Clock.Advance(TimeSpan.FromMinutes(5));
        var repeat = await MarkReadAsync(workspace.Client, notificationId);
        await AssertStatusAsync(repeat, HttpStatusCode.OK);
        Assert.AreEqual(read.ReadAtUtc, (await RequiredJsonAsync<NotificationItem>(repeat)).ReadAtUtc);

        // Two taps at once on a still-unread notification: both are answered, one instant is stored.
        var second = await CreateWorkspaceAsync("markread-race");
        await AssignPaidLaterAsync(second, 120m);
        await SweepAsync();
        var racedId = (await InboxAsync(second.Client)).Items[0].Id;
        using var otherTab = CreateClient();
        await SignInAsync(otherTab, $"client-markread-race-{second.Suffix}@tbgym.test");
        SetTenant(otherTab, second.TenantId);

        Barrier.Arm("UPDATE notifications.\"Notifications\"", 2);
        var left = MarkReadAsync(second.Client, racedId);
        var right = MarkReadAsync(otherTab, racedId);
        var responses = await Task.WhenAll(left, right).WaitAsync(TimeSpan.FromSeconds(60));
        Barrier.Disarm();

        Assert.AreEqual(2, Barrier.Arrived, "Both requests must have reached the update at once.");
        foreach (var response in responses)
        {
            await AssertStatusAsync(response, HttpStatusCode.OK);
            response.Dispose();
        }

        Assert.AreEqual(0L, (await UnreadCountAsync(second.Client)).Unread);
        Assert.AreEqual(1L, await ScalarAsync<long>(
            """SELECT count(*) FROM notifications."Notifications" WHERE "Id" = @id AND "ReadAtUtc" IS NOT NULL""",
            ("id", racedId)));
    }

    /// <summary>
    /// Requirement 19: dead-letter visibility is owner-only, bounded, and carries nothing about the
    /// recipient, the payload, the wording or the exception.
    /// </summary>
    [TestMethod]
    public async Task DeadLetterVisibilityIsOwnerOnlyAndDisclosesNothingSensitive()
    {
        const string Marker = "PAYLOAD-SECRET-MARKER-8823";
        var workspace = await CreateWorkspaceAsync("deadletter");
        var enrollment = await AssignPaidLaterAsync(workspace, 120m);
        var intent = await IntentIdAsync(enrollment.Id, CommercialNotificationKind.PaymentRequired);
        await ExecuteAsync(
            """UPDATE notifications."OutboxItems" SET "PayloadJson" = @payload::jsonb WHERE "Id" = @id""",
            ("id", intent),
            ("payload", $$"""{"enrollmentId":"{{enrollment.Id}}","clientProfileId":"{{workspace.ClientProfileId}}","schemaVersion":41,"note":"{{Marker}}"}"""));
        await SweepAsync();
        Assert.AreEqual("DeadLettered", await OutboxStatusAsync(intent));

        // The client is a member of the workspace, and this is still not theirs to read.
        await AssertStatusAsync(
            await workspace.Client.GetAsync("/api/workspace/notification-dead-letters"),
            HttpStatusCode.Forbidden);

        var response = await workspace.Coach.GetAsync("/api/workspace/notification-dead-letters");
        await AssertStatusAsync(response, HttpStatusCode.OK);
        var raw = await response.Content.ReadAsStringAsync();
        var page = await RequiredJsonAsync<DeadLetterPageResponse>(
            await workspace.Coach.GetAsync("/api/workspace/notification-dead-letters"));

        Assert.AreEqual(1L, page.Total);
        Assert.HasCount(1, page.Items);
        Assert.AreEqual(intent, page.Items[0].OutboxItemId);
        Assert.AreEqual("PaymentRequired", page.Items[0].Kind);
        Assert.AreEqual(1, page.Items[0].AttemptCount);
        Assert.AreEqual(NotificationFailureCodes.PayloadInvalid, page.Items[0].FailureCode);
        Assert.IsNotNull(page.Items[0].DeadLetteredAtUtc);

        // The raw body, not the parsed shape: a leak would arrive as an extra property.
        Assert.DoesNotContain(Marker, raw);
        Assert.DoesNotContain("@tbgym.test", raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(workspace.ClientUserId.ToString(), raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(workspace.ClientProfileId.ToString(), raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(enrollment.Id.ToString(), raw, StringComparison.OrdinalIgnoreCase);
        // The stable code names the classification, which is the whole point of it; what must be
        // absent is the payload column and anything that was inside it.
        Assert.DoesNotContain("payloadJson", raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("\"note\"", raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("recipient", raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Exception", raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("   at TB.Gym", raw, StringComparison.Ordinal);
        foreach (var template in NotificationTemplateCatalog.Published)
        {
            Assert.DoesNotContain(template.Body, raw);
        }
    }

    /// <summary>
    /// Requirement 20: the list is newest first, deterministic across requests, and pages through the
    /// whole inbox without repeating or skipping anything.
    /// </summary>
    [TestMethod]
    public async Task InboxListIsDeterministicNewestFirstAndFullyPageable()
    {
        var workspace = await CreateWorkspaceAsync("paging");
        // Five features that do not conflict, so one client can hold five concurrent enrollments and
        // therefore five due payment-required intents.
        foreach (var feature in new[] { "Training", "Nutrition", "CheckIns", "Messaging", "ResourceLibrary" })
        {
            await AssignPaidLaterAsync(workspace, 100m, feature);
            // Each sweep is a separate instant, so the notifications have a real order to assert.
            Clock.Advance(TimeSpan.FromMinutes(1));
            await SweepAsync();
        }

        var all = await InboxAsync(workspace.Client, take: 100);
        Assert.AreEqual(5L, all.Total);
        Assert.AreEqual(5L, all.UnreadTotal);
        Assert.HasCount(5, all.Items);
        CollectionAssert.AreEqual(
            all.Items.OrderByDescending(item => item.CreatedAtUtc).Select(item => item.Id).ToArray(),
            all.Items.Select(item => item.Id).ToArray(),
            "The list must be newest first.");

        // The same request twice returns the same order.
        var again = await InboxAsync(workspace.Client, take: 100);
        CollectionAssert.AreEqual(
            all.Items.Select(item => item.Id).ToArray(),
            again.Items.Select(item => item.Id).ToArray());

        // Paged two at a time, the union is the whole inbox with nothing repeated.
        var paged = new List<Guid>();
        for (var skip = 0; skip < 5; skip += 2)
        {
            var page = await InboxAsync(workspace.Client, skip, 2);
            Assert.AreEqual(5L, page.Total);
            paged.AddRange(page.Items.Select(item => item.Id));
        }

        CollectionAssert.AreEqual(all.Items.Select(item => item.Id).ToArray(), paged.ToArray());
        Assert.HasCount(5, paged.Distinct().ToArray());

        // The page size is capped rather than trusted.
        var oversized = await InboxAsync(workspace.Client, take: 5_000);
        Assert.HasCount(5, oversized.Items);
    }

    /// <summary>
    /// The recipient's own view carries the rendered snapshot and read state, and nothing about how
    /// the notification got there.
    /// </summary>
    [TestMethod]
    public async Task InboxResponseCarriesTheSnapshotAndNothingOperational()
    {
        var workspace = await CreateWorkspaceAsync("shape");
        var enrollment = await AssignPaidLaterAsync(workspace, 120m);
        var intent = await IntentIdAsync(enrollment.Id, CommercialNotificationKind.PaymentRequired);
        await SweepAsync();

        var response = await workspace.Client.GetAsync("/api/notifications");
        await AssertStatusAsync(response, HttpStatusCode.OK);
        var raw = await response.Content.ReadAsStringAsync();

        Assert.IsTrue(NotificationTemplateCatalog.TryResolve(
            CommercialNotificationKind.PaymentRequired,
            "en-LB",
            out var template));
        Assert.Contains(template.Title, raw);
        Assert.DoesNotContain("payload", raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("claim", raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("attempt", raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("failureCode", raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(intent.ToString(), raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("@tbgym.test", raw, StringComparison.OrdinalIgnoreCase);

        var page = await RequiredJsonAsync<NotificationPageResponse>(
            await workspace.Client.GetAsync("/api/notifications"));
        Assert.AreEqual(template.Title, page.Items[0].Title);
        Assert.AreEqual(template.Body, page.Items[0].Body);
        Assert.AreEqual("PaymentRequired", page.Items[0].Kind);
        Assert.IsFalse(page.Items[0].IsRead);
    }

    /// <summary>
    /// A later template version does not rewrite what somebody was already told. The stored snapshot
    /// is what the inbox returns, whatever the catalog says now.
    /// </summary>
    [TestMethod]
    public async Task ARenderedNotificationIsAHistoricalSnapshot()
    {
        var workspace = await CreateWorkspaceAsync("snapshot");
        await AssignPaidLaterAsync(workspace, 120m);
        await SweepAsync();
        var before = (await InboxAsync(workspace.Client)).Items[0];

        // The database refuses to rewrite delivered wording, which is what makes the snapshot a
        // snapshot rather than a convention.
        var failure = await Assert.ThrowsExactlyAsync<Npgsql.PostgresException>(() => ExecuteAsync(
            """UPDATE notifications."Notifications" SET "Title" = 'Rewritten' WHERE "Id" = @id""",
            ("id", before.Id)));
        Assert.AreEqual("23514", failure.SqlState);

        var after = (await InboxAsync(workspace.Client)).Items[0];
        Assert.AreEqual(before.Title, after.Title);
        Assert.AreEqual(before.Body, after.Body);
    }

    /// <summary>
    /// State-changing inbox requests are protected exactly like every other authenticated write.
    /// </summary>
    [TestMethod]
    public async Task MarkingReadRequiresAntiforgeryAndAuthentication()
    {
        var workspace = await CreateWorkspaceAsync("antiforgery");
        await AssignPaidLaterAsync(workspace, 120m);
        await SweepAsync();
        var notificationId = (await InboxAsync(workspace.Client)).Items[0].Id;

        // Without the paired request token the write is refused and nothing changes. The status is
        // deliberately not pinned: this repository's endpoints all call ValidateRequestAsync directly
        // and its AntiforgeryValidationException reaches the generic handler, so a missing token is
        // reported as 500 rather than 400. That is pre-existing across every write endpoint and is
        // recorded rather than changed here.
        workspace.Client.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
        var refused = await workspace.Client.PostAsync($"/api/notifications/{notificationId}/read", null);
        Assert.IsFalse(refused.IsSuccessStatusCode, "A write without an antiforgery token must be refused.");
        Assert.IsFalse((await InboxAsync(workspace.Client)).Items[0].IsRead);

        using var anonymous = CreateClient();
        SetTenant(anonymous, workspace.TenantId);
        await AssertStatusAsync(
            await anonymous.GetAsync("/api/notifications"),
            HttpStatusCode.Unauthorized);

        // A notification identifier that does not exist is the same answer as one that is not yours.
        await AssertStatusAsync(
            await MarkReadAsync(workspace.Client, Guid.CreateVersion7()),
            HttpStatusCode.NotFound);
    }

    private static async Task<NotificationPageResponse> InboxAsync(HttpClient caller, int? skip = null, int? take = null)
    {
        var query = new List<string>();
        if (skip is not null)
        {
            query.Add($"skip={skip}");
        }

        if (take is not null)
        {
            query.Add($"take={take}");
        }

        var url = query.Count == 0 ? "/api/notifications" : $"/api/notifications?{string.Join("&", query)}";
        var response = await caller.GetAsync(url);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<NotificationPageResponse>(response);
    }

    private static async Task<UnreadCount> UnreadCountAsync(HttpClient caller)
    {
        var response = await caller.GetAsync("/api/notifications/unread-count");
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<UnreadCount>(response);
    }

    private static async Task<HttpResponseMessage> MarkReadAsync(HttpClient caller, Guid notificationId)
    {
        await RefreshCsrfAsync(caller);
        return await caller.PostAsync($"/api/notifications/{notificationId}/read", null);
    }
}
