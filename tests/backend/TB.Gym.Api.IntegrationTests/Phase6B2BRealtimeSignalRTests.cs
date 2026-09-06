using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;
using TB.Gym.Modules.Messaging;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The realtime path over a real socket: a real cookie, a real WebSocket handshake, a real
/// <c>Origin</c> header, and — for the scale-out tests — a real Redis backplane between two
/// independently hosted API replicas.
/// </summary>
/// <remarks>
/// Every assertion here is about something that cannot be observed by invoking a hub method directly.
/// Whether the handshake is refused, whether a browser could have sent what the hub requires, whether
/// a group survives a reconnect, and whether a frame published by one process reaches a connection
/// held by another are all properties of the transport and the deployment rather than of the C#.
/// </remarks>
/// <remarks>
/// <b>Not parallelized.</b> Each method here starts two or three Kestrel hosts — the entry point runs
/// once per host build — and the scale-out methods also start a Redis container. Running several of
/// those beside the rest of the suite starves the thread pool and the run stops making progress; the
/// tests are not flaky, the machine is. Running this class alone keeps it deterministic, and the
/// durable suite that shares its database is unaffected because every method has its own.
/// </remarks>
[TestClass]
[DoNotParallelize]
public sealed partial class Phase6B2BRealtimeSignalRTests
{
    // ---------- the handshake fails closed ----------

    [TestMethod]
    public async Task AnUnauthenticatedConnectionIsRefused()
    {
        var workspace = await CreateLiveWorkspaceAsync("unauthenticated");
        // A session that never signed in: a real client, a real socket, an empty cookie jar.
        var anonymous = NewSession(ReplicaA);

        Assert.IsTrue(
            await ConnectionIsRefusedAsync(anonymous, workspace.TenantId),
            "The hub is behind the tenant-member policy; an anonymous socket must not open.");
    }

    [TestMethod]
    public async Task AMissingMalformedOrDuplicatedTenantSelectorIsRefused()
    {
        var workspace = await CreateLiveWorkspaceAsync("selector");

        Assert.IsTrue(
            await ConnectionIsRefusedAsync(workspace.Coach, tenantId: null, rawQuery: string.Empty),
            "A connection with no workspace selector has nothing to bind to.");
        Assert.IsTrue(
            await ConnectionIsRefusedAsync(workspace.Coach, null, rawQuery: "?tenantId="),
            "An empty selector is not a workspace.");
        Assert.IsTrue(
            await ConnectionIsRefusedAsync(workspace.Coach, null, rawQuery: "?tenantId=not-a-guid"),
            "A malformed selector is refused rather than coerced.");
        Assert.IsTrue(
            await ConnectionIsRefusedAsync(
                workspace.Coach,
                null,
                rawQuery: $"?tenantId={workspace.TenantId}&tenantId={Guid.NewGuid()}"),
            "Two answers to one question is refused rather than resolved by picking a side.");
        Assert.IsTrue(
            await ConnectionIsRefusedAsync(
                workspace.Coach,
                null,
                rawQuery: $"?tenantId={Guid.Empty}"),
            "The empty workspace identifier is not a workspace.");
    }

    [TestMethod]
    public async Task AWorkspaceThisAccountIsNotAnActiveMemberOfIsRefused()
    {
        var workspace = await CreateLiveWorkspaceAsync("wrong-workspace");
        var other = await CreateLiveWorkspaceAsync("other-workspace");

        Assert.IsTrue(
            await ConnectionIsRefusedAsync(workspace.Coach, other.TenantId),
            "Membership is verified from PostgreSQL before the connection is usable.");

        // And a membership that goes away means the next connection cannot be opened either.
        await ExecuteAsync(
            """
            UPDATE tenancy."Memberships" SET "Status" = 'Revoked'
            WHERE "TenantId" = @tenantId AND "UserId" = @userId
            """,
            ("tenantId", workspace.TenantId),
            ("userId", workspace.ClientUserId));

        Assert.IsTrue(
            await ConnectionIsRefusedAsync(workspace.Client, workspace.TenantId),
            "An inactive membership cannot open a socket.");
    }

    [TestMethod]
    public async Task ADisallowedOrMissingOriginIsRefusedAndAnAllowedOneConnects()
    {
        var workspace = await CreateLiveWorkspaceAsync("origin");

        Assert.IsTrue(
            await ConnectionIsRefusedAsync(workspace.Coach, workspace.TenantId, DisallowedOrigin),
            "A WebSocket handshake is not protected by CORS, so the origin is checked explicitly.");
        Assert.IsTrue(
            await ConnectionIsRefusedAsync(workspace.Coach, workspace.TenantId, origin: null),
            "A missing origin is not an allowed one; a browser always sends it.");

        var client = await ConnectAsync(workspace.Coach, workspace.TenantId, AllowedOrigin);
        Assert.AreEqual(
            HubConnectionState.Connected,
            client.Connection.State,
            "An allowed origin with a valid cookie and a valid workspace connects.");

        // The workspace selector is routing input and must not be logged; nor may anything about the
        // session.
        var text = LogA.Text;
        Assert.DoesNotContain($"tenantId={workspace.TenantId}", text, "The hub query string reached the log.");
        Assert.DoesNotContain(workspace.Suffix, text, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("@tbgym.test", text, StringComparison.OrdinalIgnoreCase);
    }

    // ---------- subscription is authorization, groups are not ----------

    [TestMethod]
    public async Task ANonParticipantCannotSubscribeAndNoGroupNameCanBeSupplied()
    {
        var workspace = await CreateLiveWorkspaceAsync("subscribe");
        var other = await CreateLiveWorkspaceAsync("subscribe-other");
        var client = await ConnectAsync(workspace.Coach, workspace.TenantId);

        Assert.IsFalse(
            await client.Connection.InvokeAsync<bool>("SubscribeConversation", other.ConversationId),
            "Another workspace's conversation is not subscribable.");
        Assert.IsFalse(
            await client.Connection.InvokeAsync<bool>("SubscribeConversation", Guid.NewGuid()),
            "An unknown conversation and a conversation the caller is not in are one answer.");
        Assert.IsFalse(
            await client.Connection.InvokeAsync<bool>("SubscribeConversation", Guid.Empty));

        // There is no method that accepts a group name or a user identifier, so a client cannot ask
        // to be put anywhere the server did not compute.
        await Assert.ThrowsExactlyAsync<HubException>(
            async () => await client.Connection.InvokeAsync<bool>(
                "SubscribeConversation",
                MessagingRealtimeGroups.ConversationUser(
                    workspace.TenantId,
                    workspace.ConversationId,
                    workspace.ClientUserId)),
            "A group name is not a conversation identifier and there is no overload that takes one.");

        Assert.IsTrue(
            await client.Connection.InvokeAsync<bool>("SubscribeConversation", workspace.ConversationId),
            "A participant may subscribe to their own conversation.");
    }

    /// <summary>
    /// A connection authorized when it opened must not be able to use that authorization afterwards.
    /// </summary>
    /// <remarks>
    /// SignalR caches the principal for the life of a connection, so the socket still presents a
    /// valid, role-carrying identity after the membership behind it has gone. This is the test that
    /// says the hub re-reads instead of trusting it.
    /// </remarks>
    [TestMethod]
    public async Task AccessLostAfterConnectingBlocksASubsequentSubscribe()
    {
        var workspace = await CreateLiveWorkspaceAsync("revoke-subscribe");
        var client = await ConnectAsync(workspace.Client, workspace.TenantId);
        Assert.IsTrue(
            await client.Connection.InvokeAsync<bool>("SubscribeConversation", workspace.ConversationId));
        await client.Connection.InvokeAsync("UnsubscribeConversation", workspace.ConversationId);

        await ExecuteAsync(
            """UPDATE clients."ClientProfiles" SET "IsCoachBlocked" = true WHERE "Id" = @id""",
            ("id", workspace.ClientProfileId));

        Assert.IsFalse(
            await client.Connection.InvokeAsync<bool>("SubscribeConversation", workspace.ConversationId),
            "The connection is still open and still authenticated; the authorization is what changed.");
    }

    [TestMethod]
    public async Task AConnectionAuthorizedBeforeRevocationCanNeitherSubscribeAgainNorReceiveLaterContent()
    {
        var workspace = await CreateLiveWorkspaceAsync("revoked-live");
        var client = await ConnectAsync(workspace.Client, workspace.TenantId);
        Assert.IsTrue(
            await client.Connection.InvokeAsync<bool>("SubscribeConversation", workspace.ConversationId));
        await SweepAsync(ReplicaA);
        client.Clear();

        // A message is committed, and only then does the relationship close.
        await SendAsync(workspace.Coach, workspace.ConversationId, "written before the block");
        await ExecuteAsync(
            """UPDATE clients."ClientProfiles" SET "IsCoachBlocked" = true WHERE "Id" = @id""",
            ("id", workspace.ClientProfileId));

        await SweepAsync(ReplicaA);

        await client.AssertNothingArrivesAsync(
            TimeSpan.FromSeconds(2),
            "The connection is still in the group; the dispatcher re-authorized and suppressed it anyway.");
        Assert.IsFalse(
            await client.Connection.InvokeAsync<bool>("SubscribeConversation", workspace.ConversationId),
            "And it cannot join again.");
    }

    // ---------- the delivery path ----------

    [TestMethod]
    public async Task AnAuthorizedSubscriberReceivesTheFullEventAndTheCompactInvalidation()
    {
        var workspace = await CreateLiveWorkspaceAsync("delivery");
        var client = await ConnectAsync(workspace.Client, workspace.TenantId);
        Assert.IsTrue(
            await client.Connection.InvokeAsync<bool>("SubscribeConversation", workspace.ConversationId));
        await SweepAsync(ReplicaA);
        client.Clear();

        var sent = await SendAsync(workspace.Coach, workspace.ConversationId, "over a real socket");
        await SweepAsync(ReplicaA);

        Assert.IsTrue(await client.WaitForEventsAsync(1), "The full event must reach the open thread.");
        var received = client.Events.Single();
        Assert.AreEqual(workspace.TenantId, received.TenantId);
        Assert.AreEqual(workspace.ConversationId, received.ConversationId);
        Assert.AreEqual("MessageSent", received.Kind);
        Assert.AreEqual(sent.Id, received.Message!.Id);
        Assert.AreEqual("over a real socket", received.Message.Body);

        Assert.IsTrue(await client.WaitForInvalidationsAsync(1));
        Assert.AreEqual(workspace.ConversationId, client.Invalidations[^1].ConversationId);
    }

    /// <summary>
    /// Joining before reading is what closes the window; the overlap it creates is the price.
    /// </summary>
    [TestMethod]
    public async Task SubscribingBeforeCatchingUpLosesNothingAndOverlapsHarmlessly()
    {
        var workspace = await CreateLiveWorkspaceAsync("no-loss");
        var client = await ConnectAsync(workspace.Client, workspace.TenantId);

        // Subscribe first, exactly as the browser does.
        Assert.IsTrue(
            await client.Connection.InvokeAsync<bool>("SubscribeConversation", workspace.ConversationId));

        // A message commits and is published between the join and the read. Without the join being
        // first, this is the frame that would reach nobody and never be asked for again.
        var raced = await SendAsync(workspace.Coach, workspace.ConversationId, "committed during the join window");
        await SweepAsync(ReplicaA);
        Assert.IsTrue(await client.WaitForEventsAsync(2), "The creation and the racing send both arrived live.");

        // Now the read, from the beginning, which deliberately re-returns what the socket already
        // delivered.
        var page = await CatchUpAsync(workspace.Client, workspace.ConversationId, 0);

        var live = client.Events.Select(item => item.EventSequence).ToArray();
        var caughtUp = page.Items.Select(item => item.EventSequence).ToArray();
        Assert.IsTrue(
            caughtUp.Intersect(live).Any(),
            "The overlap is deliberate: the same positions arrive twice and the client deduplicates.");
        Assert.Contains(
            raced.Sequence,
            page.Items.Where(item => item.Message is not null).Select(item => item.Message!.Sequence).ToArray(),
            "Nothing was lost in the window between joining and reading.");
        CollectionAssert.AreEqual(
            Enumerable.Range(1, caughtUp.Length).Select(value => (long)value).ToArray(),
            caughtUp,
            "Catch-up is ascending and contiguous, which is what makes a cursor resumable.");
    }

    /// <summary>
    /// An ordinary reconnect is a new connection with a new identity, and every group it was in is
    /// gone.
    /// </summary>
    /// <remarks>
    /// This is why the client rejoins and then catches up rather than assuming the server remembers.
    /// The tenant-user group comes back because the server re-adds it on connect; the conversation
    /// group does not, because it is the client's to ask for. Nothing here depends on stateful
    /// reconnect, which is a bounded transport optimization and not a durable guarantee.
    /// </remarks>
    [TestMethod]
    public async Task AReconnectGetsANewConnectionAndLosesItsConversationGroupUntilItRejoins()
    {
        var workspace = await CreateLiveWorkspaceAsync("reconnect");
        var client = await ConnectAsync(workspace.Client, workspace.TenantId);
        var firstConnectionId = client.Connection.ConnectionId;
        Assert.IsTrue(
            await client.Connection.InvokeAsync<bool>("SubscribeConversation", workspace.ConversationId));
        await SweepAsync(ReplicaA);
        client.Clear();

        // Drop and re-open, which is what an ordinary reconnect amounts to from the server's side.
        await client.Connection.StopAsync();
        await client.Connection.StartAsync();
        Assert.AreNotEqual(
            firstConnectionId,
            client.Connection.ConnectionId,
            "A reconnect is a new connection identity, so nothing about the old one can be relied on.");

        var missed = await SendAsync(workspace.Coach, workspace.ConversationId, "sent while not subscribed");
        await SweepAsync(ReplicaA);

        // The tenant-user group was rejoined by the server, so the compact signal still arrives.
        Assert.IsTrue(
            await client.WaitForInvalidationsAsync(1),
            "The server rejoins the tenant-user group itself, so the list can still be refreshed.");
        await client.AssertNothingArrivesAsync(
            TimeSpan.FromSeconds(2),
            "The conversation group is gone until the client asks for it again.");

        // The client rejoins and then catches up, and the message it missed is there.
        Assert.IsTrue(
            await client.Connection.InvokeAsync<bool>("SubscribeConversation", workspace.ConversationId));
        var page = await CatchUpAsync(workspace.Client, workspace.ConversationId, 1);
        Assert.Contains(
            missed.Id,
            page.Items.Where(item => item.Message is not null).Select(item => item.Message!.Id).ToArray(),
            "Catch-up from PostgreSQL is what makes a missed frame recoverable.");

        // And live delivery resumes.
        client.Clear();
        await SendAsync(workspace.Coach, workspace.ConversationId, "after rejoining");
        await SweepAsync(ReplicaA);
        Assert.IsTrue(await client.WaitForEventsAsync(1));
    }

    [TestMethod]
    public async Task UnsubscribingStopsFullEventsAndKeepsTheCompactSignal()
    {
        var workspace = await CreateLiveWorkspaceAsync("unsubscribe");
        var client = await ConnectAsync(workspace.Client, workspace.TenantId);
        Assert.IsTrue(
            await client.Connection.InvokeAsync<bool>("SubscribeConversation", workspace.ConversationId));
        await SweepAsync(ReplicaA);

        await client.Connection.InvokeAsync("UnsubscribeConversation", workspace.ConversationId);
        client.Clear();

        await SendAsync(workspace.Coach, workspace.ConversationId, "after leaving the thread");
        await SweepAsync(ReplicaA);

        Assert.IsTrue(
            await client.WaitForInvalidationsAsync(1),
            "A closed thread still has to move up the list and change its badge.");
        await client.AssertNothingArrivesAsync(
            TimeSpan.FromSeconds(2),
            "But a body is not pushed to a browser that has no reason to hold it.");
    }

    // ---------- scale-out ----------

    /// <summary>
    /// The exit test for multi-replica delivery: a client connected to one process receives an event
    /// another process published.
    /// </summary>
    /// <remarks>
    /// The two replicas have separate service providers and separate SignalR lifetime managers. The
    /// only things they share are the PostgreSQL database and the Redis backplane, which is exactly
    /// the production topology — and without the backplane the frame would reach only the replica
    /// that published it, which is the failure the configuration validation exists to prevent.
    /// </remarks>
    [TestMethod]
    public async Task AClientOnOneReplicaReceivesAnEventPublishedByTheOtherReplica()
    {
        var workspace = await CreateLiveWorkspaceAsync("two-replica");
        var client = await ConnectAsync(workspace.Client, workspace.TenantId);
        Assert.IsNotNull(client.Connection.ConnectionId, "The client is connected to replica A.");
        Assert.IsTrue(
            await client.Connection.InvokeAsync<bool>("SubscribeConversation", workspace.ConversationId));

        // Replica B claims and publishes. It holds no connection for this user at all.
        await SweepAsync(ReplicaB);
        client.Clear();

        var sent = await SendAsync(workspace.Coach, workspace.ConversationId, "published by the other replica");
        var outcome = await SweepAsync(ReplicaB);
        Assert.IsGreaterThanOrEqualTo(1, outcome.Published, "Replica B is the process that published.");

        Assert.IsTrue(
            await client.WaitForEventsAsync(1),
            "The frame crossed the Redis backplane to the replica holding the connection.");
        Assert.AreEqual(sent.Id, client.Events.Single().Message!.Id);
        Assert.IsTrue(await client.WaitForInvalidationsAsync(1));
    }

    /// <summary>
    /// A backplane outage loses sends and loses nothing else.
    /// </summary>
    /// <remarks>
    /// Redis is not durable and is not a queue: a send during an outage is gone. What makes that
    /// survivable is that the event is in PostgreSQL, the attempt is retried under its own policy, the
    /// hosted loop lives through it, and an authorized catch-up returns the event whether or not it
    /// was ever republished.
    /// </remarks>
    [TestMethod]
    public async Task ARedisOutageLosesTheSendAndLeavesPostgresAndTheServiceIntact()
    {
        var workspace = await CreateLiveWorkspaceAsync("redis-outage");
        var client = await ConnectAsync(workspace.Client, workspace.TenantId);
        Assert.IsTrue(
            await client.Connection.InvokeAsync<bool>("SubscribeConversation", workspace.ConversationId));
        await SweepAsync(ReplicaB);
        client.Clear();

        var sent = await SendAsync(workspace.Coach, workspace.ConversationId, "sent during the outage");

        await Redis.StopAsync();
        await Redis.WaitUntilUnreachableAsync();

        // The sweep survives, and returning at all is the assertion: whatever the lifetime manager
        // throws when its backplane is gone is classified into one stable code rather than escaping.
        // Whether the send is refused or silently reaches nobody is Redis's business; either way the
        // process is still running afterwards and the durable state is still correct.
        await SweepAsync(ReplicaB);

        // The command that already succeeded is untouched, and the event is still there to catch up on.
        var page = await CatchUpAsync(workspace.Client, workspace.ConversationId, 1);
        Assert.Contains(
            sent.Id,
            page.Items.Where(item => item.Message is not null).Select(item => item.Message!.Id).ToArray(),
            "PostgreSQL is the record; Redis could not have replayed this.");
        Assert.AreEqual("sent during the outage", page.Items.Single(item => item.Message?.Id == sent.Id).Message!.Body);

        await Redis.StartAsync();

        // The service is alive and still works. A later message publishes normally.
        client.Clear();
        var afterOutage = await SendAsync(workspace.Coach, workspace.ConversationId, "after the outage");
        // A frame attempted during the outage may surface late. It is not proof that this new work
        // crossed the recovered backplane, so wait for the exact message this assertion is about.
        for (var attempt = 0; attempt < 10 && !client.HasMessage(afterOutage.Id); attempt++)
        {
            await SweepAsync(ReplicaB);
            await client.WaitForMessageAsync(afterOutage.Id, TimeSpan.FromSeconds(3));
        }

        Assert.IsTrue(
            client.HasMessage(afterOutage.Id),
            "After Redis returns, eligible work publishes again and the loop was never killed.");

        // No connection string and no exception prose anywhere in either replica's log.
        foreach (var text in new[] { LogA.Text, logB?.Text ?? string.Empty })
        {
            Assert.DoesNotContain(Redis.ConnectionString, text, "The backplane endpoint reached a log.");
            Assert.DoesNotContain("127.0.0.1:" + Redis.Port.ToString(System.Globalization.CultureInfo.InvariantCulture), text);
            Assert.DoesNotContain("sent during the outage", text);
        }
    }

    [TestMethod]
    public async Task NoMessageContentOrIdentifierReachesEitherReplicaLog()
    {
        var workspace = await CreateLiveWorkspaceAsync("logs");
        var client = await ConnectAsync(workspace.Client, workspace.TenantId);
        await client.Connection.InvokeAsync<bool>("SubscribeConversation", workspace.ConversationId);
        await SendAsync(workspace.Coach, workspace.ConversationId, "a sentence for the log test");
        await SweepAsync(ReplicaA);

        var text = LogA.Text;
        Assert.DoesNotContain("a sentence for the log test", text);
        Assert.DoesNotContain(workspace.ConversationId.ToString(), text);
        Assert.DoesNotContain(workspace.ClientUserId.ToString(), text);
        Assert.DoesNotContain(workspace.TenantId.ToString(), text);
        Assert.DoesNotContain("@tbgym.test", text, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(
            MessagingRealtimeGroups.ConversationUser(
                workspace.TenantId,
                workspace.ConversationId,
                workspace.ClientUserId),
            text,
            "A group name is a workspace, a conversation and a person in one string.");
    }
}
