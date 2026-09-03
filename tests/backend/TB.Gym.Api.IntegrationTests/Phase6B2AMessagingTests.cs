using System.Net;
using System.Net.Http.Json;
using Npgsql;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Phase 6B-2A persisted messaging, against real PostgreSQL.
/// </summary>
/// <remarks>
/// Everything asserted here needs the database to mean anything: sequence allocation under a real row
/// lock, the append-only and one-way triggers, tenant-composite foreign keys, keyset pagination under
/// concurrent insertion, and the unread aggregate. SQLite and the in-memory provider reproduce none
/// of it, so none of it is tested against them.
/// </remarks>
[TestClass]
public sealed partial class Phase6B2AMessagingTests
{
    /// <summary>
    /// The contested statements, each identified by the marker comment its own lock carries.
    /// </summary>
    /// <remarks>
    /// Marker comments rather than table names: <c>FROM messaging."Conversations"</c> also appears in
    /// every ordinary LINQ query against that table, so a barrier armed on it could trip on a read
    /// and report contention that never happened.
    /// </remarks>
    private const string SequenceLockFragment = "messaging-sequence";

    private const string CreateLockFragment = "messaging-direct-pair";

    private const string ReadCursorLockFragment = "messaging-read-cursor";

    // ---------- creating a conversation ----------

    [TestMethod]
    public async Task CreatingADirectConversationWritesExactlyTwoParticipantsAtomically()
    {
        var workspace = await CreateWorkspaceAsync("create");

        var created = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);

        Assert.AreEqual(workspace.ClientProfileId, created.Conversation.ClientProfileId);
        Assert.AreEqual("Coach", created.Conversation.CallerRole);
        Assert.IsTrue(created.Conversation.CanModerate, "The coach side of a direct conversation moderates.");
        Assert.AreEqual(workspace.ClientUserId, created.Conversation.Counterpart.UserId);
        Assert.AreEqual("Messaged Client", created.Conversation.Counterpart.DisplayName);
        Assert.AreEqual("Client", created.Conversation.Counterpart.Role);
        Assert.AreEqual(0L, created.Conversation.LastSequence);
        Assert.IsNull(created.Conversation.LastMessage, "A new conversation has nothing to preview.");
        Assert.IsTrue(created.Conversation.IsAvailable);
        Assert.AreEqual("Granted", created.Conversation.AccessReason);
        Assert.AreEqual(0L, created.ReadState.LastReadSequence);
        Assert.IsNull(created.ReadState.LastReadAtUtc);

        Assert.AreEqual(
            2L,
            await CountAsync("ConversationParticipants", "\"ConversationId\" = @id", ("id", created.Conversation.Id)));
        Assert.AreEqual(
            1L,
            await CountAsync(
                "ConversationParticipants",
                "\"ConversationId\" = @id AND \"Role\" = 'Coach' AND \"UserId\" = @user",
                ("id", created.Conversation.Id),
                ("user", workspace.CoachUserId)));
        Assert.AreEqual(
            1L,
            await CountAsync(
                "ConversationParticipants",
                "\"ConversationId\" = @id AND \"Role\" = 'Client' AND \"UserId\" = @user",
                ("id", created.Conversation.Id),
                ("user", workspace.ClientUserId)));

        // The client sees the same conversation from the other side, with the coach as counterpart
        // and no moderation power.
        var clientView = await ListConversationsAsync(workspace.Client);
        var mine = clientView.Items.Single();
        Assert.AreEqual(created.Conversation.Id, mine.Id);
        Assert.AreEqual("Client", mine.CallerRole);
        Assert.IsFalse(mine.CanModerate);
        Assert.AreEqual(workspace.CoachUserId, mine.Counterpart.UserId);
    }

    /// <summary>
    /// The deferred constraint trigger, exercised the only way it can be: by writing a conversation
    /// with no participants, which the application never does and a repair script easily could.
    /// </summary>
    [TestMethod]
    public async Task TheDatabaseRefusesADirectConversationWithoutItsTwoParticipants()
    {
        var workspace = await CreateWorkspaceAsync("participants");

        var failure = await Assert.ThrowsExactlyAsync<PostgresException>(() => ExecuteAsync(
            """
            INSERT INTO messaging."Conversations"
                ("Id", "TenantId", "ClientProfileId", "CoachUserId", "ClientUserId", "StartedAtUtc",
                 "LastSequence", "LastActivityAtUtc", "CreatedAtUtc", "UpdatedAtUtc")
            VALUES (@id, @tenantId, @clientProfileId, @coachUserId, @clientUserId, CURRENT_TIMESTAMP,
                    0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            ("id", Guid.CreateVersion7()),
            ("tenantId", workspace.TenantId),
            ("clientProfileId", workspace.ClientProfileId),
            ("coachUserId", workspace.CoachUserId),
            ("clientUserId", workspace.ClientUserId)));

        Assert.AreEqual("23514", failure.SqlState);
        Assert.Contains("exactly two participants", failure.MessageText);
    }

    [TestMethod]
    public async Task AThirdParticipantCannotBeAddedToADirectConversation()
    {
        var workspace = await CreateWorkspaceAsync("third");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        var other = await AddClientAsync(workspace, "third");

        var failure = await Assert.ThrowsExactlyAsync<PostgresException>(() => ExecuteAsync(
            """
            INSERT INTO messaging."ConversationParticipants"
                ("Id", "TenantId", "ConversationId", "UserId", "Role", "LastReadSequence",
                 "CreatedAtUtc", "UpdatedAtUtc")
            VALUES (@id, @tenantId, @conversationId, @userId, 'Client', 0,
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            ("id", Guid.CreateVersion7()),
            ("tenantId", workspace.TenantId),
            ("conversationId", conversation.Conversation.Id),
            ("userId", other.UserId)));

        Assert.AreEqual("23505", failure.SqlState, "There is one Coach side and one Client side, and no third.");
    }

    [TestMethod]
    public async Task AnIdenticalSequentialCreateRetryReturnsTheOriginalConversation()
    {
        var workspace = await CreateWorkspaceAsync("retry");
        var key = Guid.NewGuid();

        var first = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId, key);
        var second = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId, key);

        Assert.AreEqual(first.Conversation.Id, second.Conversation.Id);
        Assert.AreEqual(1L, await CountAsync("Conversations", "\"TenantId\" = @id", ("id", workspace.TenantId)));
        Assert.AreEqual(1L, await CountAsync("CommandRecords", "\"IdempotencyKey\" = @key", ("key", key)));
    }

    [TestMethod]
    public async Task ConcurrentIdenticalCreateRetriesProduceOneConversation()
    {
        var workspace = await CreateWorkspaceAsync("createrace");
        using var secondSession = await SecondSessionAsync(workspace.CoachEmail, workspace.TenantId);
        var key = Guid.NewGuid();
        await RefreshCsrfAsync(workspace.Coach);

        Barrier.Arm(IdempotencyLockFragment, 2);
        var first = CreateConversationAsync(workspace.Coach, workspace.ClientProfileId, key);
        var second = CreateConversationAsync(secondSession, workspace.ClientProfileId, key);
        await Barrier.ArrivedAsync(2).WaitAsync(TimeSpan.FromSeconds(30));
        Barrier.Disarm();
        var responses = await Task.WhenAll(first, second);

        Assert.AreEqual(2, Barrier.Arrived, "Both creates must have reached the contended lock.");
        foreach (var response in responses)
        {
            await AssertStatusAsync(response, HttpStatusCode.OK);
        }

        var ids = new List<Guid>();
        foreach (var response in responses)
        {
            ids.Add((await RequiredJsonAsync<ConversationDetailResponse>(response)).Conversation.Id);
        }

        Assert.AreEqual(ids[0], ids[1], "An identical concurrent retry returns the original conversation.");
        Assert.AreEqual(1L, await CountAsync("Conversations", "\"TenantId\" = @id", ("id", workspace.TenantId)));
        Assert.AreEqual(
            2L,
            await CountAsync("ConversationParticipants", "\"ConversationId\" = @id", ("id", ids[0])));
        Assert.AreEqual(1L, await CountAsync("CommandRecords", "\"IdempotencyKey\" = @key", ("key", key)));
    }

    /// <summary>
    /// Two creates for the same pair with different keys. Only one conversation may exist for
    /// (workspace, client, coach), and the loser must receive the winner rather than an error.
    /// </summary>
    [TestMethod]
    public async Task ConcurrentCreatesForTheSamePairProduceOneConversationUnderARealRace()
    {
        var workspace = await CreateWorkspaceAsync("uniquerace");
        using var secondSession = await SecondSessionAsync(workspace.CoachEmail, workspace.TenantId);
        await RefreshCsrfAsync(workspace.Coach);

        Barrier.Arm(CreateLockFragment, 2);
        var first = CreateConversationAsync(workspace.Coach, workspace.ClientProfileId, Guid.NewGuid());
        var second = CreateConversationAsync(secondSession, workspace.ClientProfileId, Guid.NewGuid());
        await Barrier.ArrivedAsync(2).WaitAsync(TimeSpan.FromSeconds(30));
        Barrier.Disarm();
        var responses = await Task.WhenAll(first, second);

        Assert.AreEqual(2, Barrier.Arrived);
        var ids = new List<Guid>();
        foreach (var response in responses)
        {
            await AssertStatusAsync(response, HttpStatusCode.OK);
            ids.Add((await RequiredJsonAsync<ConversationDetailResponse>(response)).Conversation.Id);
        }

        Assert.AreEqual(ids[0], ids[1]);
        Assert.AreEqual(1L, await CountAsync("Conversations", "\"TenantId\" = @id", ("id", workspace.TenantId)));
        Assert.AreEqual(
            2L,
            await CountAsync("ConversationParticipants", "\"ConversationId\" = @id", ("id", ids[0])));
    }

    [TestMethod]
    public async Task TheUniqueDirectConversationIndexRefusesASecondRowForTheSamePair()
    {
        var workspace = await CreateWorkspaceAsync("uniqueindex");
        await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);

        var failure = await Assert.ThrowsExactlyAsync<PostgresException>(() => ExecuteAsync(
            """
            INSERT INTO messaging."Conversations"
                ("Id", "TenantId", "ClientProfileId", "CoachUserId", "ClientUserId", "StartedAtUtc",
                 "LastSequence", "LastActivityAtUtc", "CreatedAtUtc", "UpdatedAtUtc")
            VALUES (@id, @tenantId, @clientProfileId, @coachUserId, @clientUserId, CURRENT_TIMESTAMP,
                    0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            ("id", Guid.CreateVersion7()),
            ("tenantId", workspace.TenantId),
            ("clientProfileId", workspace.ClientProfileId),
            ("coachUserId", workspace.CoachUserId),
            ("clientUserId", workspace.ClientUserId)));

        Assert.AreEqual("23505", failure.SqlState);
    }

    [TestMethod]
    public async Task ReusingACreateKeyWithADifferentClientConflicts()
    {
        var workspace = await CreateWorkspaceAsync("createconflict");
        var other = await AddClientAsync(workspace, "createconflict");
        // Entitled as well, so the refusal under test is the reused key rather than access. Feature
        // access is deliberately evaluated first: a caller who may not message the named client is
        // refused before learning whether an idempotency key has been spent.
        var otherOffer = await CreateOfferAsync(workspace.Coach, 120m, 8, "Messaging second");
        var otherEnrollment = await AssignAsync(
            workspace.Coach,
            other.ClientProfileId,
            otherOffer,
            TenantToday());
        await PayInFullAsync(workspace.Coach, otherEnrollment);
        var key = Guid.NewGuid();
        await StartConversationAsync(workspace.Coach, workspace.ClientProfileId, key);

        await RefreshCsrfAsync(workspace.Coach);
        var conflict = await CreateConversationAsync(workspace.Coach, other.ClientProfileId, key);

        Assert.AreEqual("messaging_idempotency_key_reused", await ConflictCodeAsync(conflict));
        Assert.AreEqual(1L, await CountAsync("Conversations", "\"TenantId\" = @id", ("id", workspace.TenantId)));
    }

    [TestMethod]
    public async Task AClientCannotCreateAConversationAndADifferentCoachGetsTheirOwn()
    {
        var workspace = await CreateWorkspaceAsync("authority");
        await RefreshCsrfAsync(workspace.Client);

        // The route is coach-only, so the client is refused by tenant policy before any handler runs.
        await AssertStatusAsync(
            await CreateConversationAsync(workspace.Client, workspace.ClientProfileId),
            HttpStatusCode.Forbidden);

        var first = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        var secondCoach = await AddSecondCoachAsync(workspace, "authority");
        var theirs = await StartConversationAsync(secondCoach.Client, workspace.ClientProfileId);

        Assert.AreNotEqual(
            first.Conversation.Id,
            theirs.Conversation.Id,
            "A second coach opens their own thread rather than joining somebody else's.");
        Assert.AreEqual(2L, await CountAsync("Conversations", "\"TenantId\" = @id", ("id", workspace.TenantId)));
        // And neither coach can see the other's, because neither is a participant of it.
        await AssertStatusAsync(
            await GetMessagesResponseAsync(workspace.Coach, theirs.Conversation.Id),
            HttpStatusCode.NotFound);
        await AssertStatusAsync(
            await GetMessagesResponseAsync(secondCoach.Client, first.Conversation.Id),
            HttpStatusCode.NotFound);
    }

    // ---------- sending ----------

    [TestMethod]
    public async Task SendingPersistsTheMessageItsFirstRevisionAndTheConversationActivity()
    {
        var workspace = await CreateWorkspaceAsync("send");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);

        var sent = await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, "  hello\r\nthere  ");

        Assert.AreEqual(1L, sent.Sequence);
        Assert.AreEqual("hello\nthere", sent.Body, "The stored body is the normalized one.");
        Assert.AreEqual(1, sent.RevisionNumber);
        Assert.IsNull(sent.EditedAtUtc);
        Assert.IsFalse(sent.IsDeleted);
        Assert.AreEqual("Persisted", sent.DeliveryState, "This slice claims persistence and nothing more.");
        Assert.IsTrue(sent.IsFromCaller);
        Assert.IsFalse(sent.IsUnreadByCaller, "Your own message is never unread to you.");
        Assert.IsTrue(sent.CanEdit);
        Assert.IsTrue(sent.CanDelete);
        Assert.IsFalse(sent.CanModerate, "A coach removes their own message; they do not moderate it.");
        Assert.AreEqual(sent.SentAtUtc, sent.AvailableAtUtc);

        Assert.AreEqual(1L, await MessageCountAsync(conversation.Conversation.Id));
        Assert.AreEqual(1L, await RevisionCountAsync(sent.Id));
        Assert.AreEqual(1L, await ConversationLastSequenceAsync(conversation.Conversation.Id));

        var list = await ListConversationsAsync(workspace.Client);
        Assert.AreEqual("hello\nthere", list.Items.Single().LastMessage!.Body);
        Assert.AreEqual(1L, list.Items.Single().UnreadCount, "The other side has one unread message.");
    }

    [TestMethod]
    public async Task ABlankOrOverlongOrControlBearingBodyIsRefused()
    {
        var workspace = await CreateWorkspaceAsync("content");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        await RefreshCsrfAsync(workspace.Coach);

        string[] refused = ["   ", "\r\n", new string('a', 2001), "bad\u0000body"];
        foreach (var body in refused)
        {
            await AssertStatusAsync(
                await PostMessageAsync(workspace.Coach, conversation.Conversation.Id, body),
                HttpStatusCode.BadRequest);
        }

        Assert.AreEqual(0L, await MessageCountAsync(conversation.Conversation.Id));
        Assert.AreEqual(0L, await ConversationLastSequenceAsync(conversation.Conversation.Id));

        // Exactly at the limit is accepted, so the boundary is where it is documented to be.
        var atLimit = await SendMessageAsync(
            workspace.Coach,
            conversation.Conversation.Id,
            new string('a', 2000));
        Assert.AreEqual(2000, atLimit.Body!.Length);
    }

    [TestMethod]
    public async Task SimultaneousSendsProduceUniqueGapFreeCommittedSequences()
    {
        var workspace = await CreateWorkspaceAsync("sequences");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        await RefreshCsrfAsync(workspace.Coach);
        await RefreshCsrfAsync(workspace.Client);

        Barrier.Arm(SequenceLockFragment, 2);
        var fromCoach = PostMessageAsync(workspace.Coach, conversation.Conversation.Id, "from the coach");
        var fromClient = PostMessageAsync(workspace.Client, conversation.Conversation.Id, "from the client");
        await Barrier.ArrivedAsync(2).WaitAsync(TimeSpan.FromSeconds(30));
        Barrier.Disarm();
        var responses = await Task.WhenAll(fromCoach, fromClient);

        Assert.AreEqual(2, Barrier.Arrived, "Both sends must have reached the sequence lock together.");
        var sequences = new List<long>();
        foreach (var response in responses)
        {
            await AssertStatusAsync(response, HttpStatusCode.OK);
            sequences.Add((await RequiredJsonAsync<MessageResponse>(response)).Sequence);
        }

        var expected1 = new[] { 1L, 2L };
        CollectionAssert.AreEquivalent(expected1, sequences);
        var expectedSequences = new[] { 1L, 2L };
        CollectionAssert.AreEqual(
            expectedSequences,
            (await CommittedSequencesAsync(conversation.Conversation.Id)).ToArray(),
            "Committed sequences must be unique, gap-free and ordered.");
        Assert.AreEqual(2L, await ConversationLastSequenceAsync(conversation.Conversation.Id));

        // And the history page presents them in ascending order whichever way they were retrieved.
        var page = await GetMessagesAsync(workspace.Client, conversation.Conversation.Id);
        var expected2 = new[] { 1L, 2L };
        CollectionAssert.AreEqual(expected2, page.Items.Select(item => item.Sequence).ToArray());
    }

    [TestMethod]
    public async Task IdenticalConcurrentSendRetriesProduceOneMessageAndOneRevision()
    {
        var workspace = await CreateWorkspaceAsync("sendretry");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        using var secondSession = await SecondSessionAsync(workspace.CoachEmail, workspace.TenantId);
        var key = Guid.NewGuid();
        await RefreshCsrfAsync(workspace.Coach);

        // Two sends carrying the same key contend on the key, not on the sequence: the loser is
        // turned back before it ever reaches the allocator, which is the whole point of taking the
        // idempotency lock first.
        Barrier.Arm(IdempotencyLockFragment, 2);
        var first = PostMessageAsync(workspace.Coach, conversation.Conversation.Id, "only once", key);
        var second = PostMessageAsync(secondSession, conversation.Conversation.Id, "only once", key);
        await Barrier.ArrivedAsync(2).WaitAsync(TimeSpan.FromSeconds(30));
        Barrier.Disarm();
        var responses = await Task.WhenAll(first, second);

        Assert.AreEqual(2, Barrier.Arrived);
        var ids = new List<Guid>();
        foreach (var response in responses)
        {
            await AssertStatusAsync(response, HttpStatusCode.OK);
            ids.Add((await RequiredJsonAsync<MessageResponse>(response)).Id);
        }

        Assert.AreEqual(ids[0], ids[1], "Both retries return the original message.");
        Assert.AreEqual(1L, await MessageCountAsync(conversation.Conversation.Id));
        Assert.AreEqual(1L, await RevisionCountAsync(ids[0]));
        Assert.AreEqual(1L, await ConversationLastSequenceAsync(conversation.Conversation.Id));
        Assert.AreEqual(1L, await CountAsync("CommandRecords", "\"IdempotencyKey\" = @key", ("key", key)));
    }

    [TestMethod]
    public async Task AnIdenticalSequentialSendRetryReturnsTheOriginalMessage()
    {
        var workspace = await CreateWorkspaceAsync("sendreplay");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        var key = Guid.NewGuid();

        var first = await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, "once  ", key);
        // Different whitespace and line endings, same normalized body: the same command.
        var replay = await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, "\r\n once", key);

        Assert.AreEqual(first.Id, replay.Id);
        Assert.AreEqual(first.Sequence, replay.Sequence);
        Assert.AreEqual(1L, await MessageCountAsync(conversation.Conversation.Id));
        Assert.AreEqual(1L, await RevisionCountAsync(first.Id));
    }

    [TestMethod]
    public async Task ReusingASendKeyWithAChangedBodyConflictsAndWritesNothing()
    {
        var workspace = await CreateWorkspaceAsync("sendconflict");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        var key = Guid.NewGuid();
        var original = await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, "first", key);

        await RefreshCsrfAsync(workspace.Coach);
        var conflict = await PostMessageAsync(workspace.Coach, conversation.Conversation.Id, "second", key);

        Assert.AreEqual("messaging_idempotency_key_reused", await ConflictCodeAsync(conflict));
        Assert.AreEqual(1L, await MessageCountAsync(conversation.Conversation.Id));
        Assert.AreEqual(1L, await RevisionCountAsync(original.Id));
        Assert.AreEqual(1L, await ConversationLastSequenceAsync(conversation.Conversation.Id));
        var expected3 = new[] { "first" };
        CollectionAssert.AreEqual(expected3, (await RevisionBodiesAsync(original.Id)).ToArray());
    }

    /// <summary>
    /// The commit is failed after every statement inside the sending transaction has run, so anything
    /// that survives would genuinely not have been atomic.
    /// </summary>
    [TestMethod]
    public async Task AFailedCommitLeavesNoMessageRevisionActivityOrSpentKey()
    {
        var workspace = await CreateWorkspaceAsync("atomic");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, "committed");
        var key = Guid.NewGuid();
        await RefreshCsrfAsync(workspace.Coach);

        Commits.ArmOnce();
        var failed = await PostMessageAsync(workspace.Coach, conversation.Conversation.Id, "never lands", key);

        Assert.IsTrue(Commits.Fired, "The commit fault must have fired, or this proves nothing.");
        Assert.IsFalse(failed.IsSuccessStatusCode);
        Assert.AreEqual(1L, await MessageCountAsync(conversation.Conversation.Id));
        Assert.AreEqual(1L, await ConversationLastSequenceAsync(conversation.Conversation.Id));
        Assert.AreEqual(0L, await CountAsync("CommandRecords", "\"IdempotencyKey\" = @key", ("key", key)));
        Assert.AreEqual(
            0L,
            await CountAsync("MessageRevisions", "\"Body\" = 'never lands'"),
            "A rolled-back attempt leaves no revision behind.");

        // The rolled-back attempt gave its number back, so the next send is 2 rather than 3.
        var next = await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, "after the failure");
        Assert.AreEqual(2L, next.Sequence);
        var expectedAfterRollback = new[] { 1L, 2L };
        CollectionAssert.AreEqual(
            expectedAfterRollback,
            (await CommittedSequencesAsync(conversation.Conversation.Id)).ToArray());
    }

    // ---------- editing ----------

    [TestMethod]
    public async Task TheSenderCanEditAndEveryEarlierRevisionSurvives()
    {
        var workspace = await CreateWorkspaceAsync("edit");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        var sent = await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, "frist");

        await RefreshCsrfAsync(workspace.Coach);
        var response = await PostEditAsync(
            workspace.Coach,
            conversation.Conversation.Id,
            sent.Id,
            "first",
            sent.Version);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        var edited = await RequiredJsonAsync<MessageResponse>(response);

        Assert.AreEqual("first", edited.Body);
        Assert.AreEqual(2, edited.RevisionNumber);
        Assert.IsNotNull(edited.EditedAtUtc);
        Assert.AreEqual(sent.Sequence, edited.Sequence, "An edit does not reorder the thread.");
        var expectedRevisions = new[] { "frist", "first" };
        CollectionAssert.AreEqual(
            expectedRevisions,
            (await RevisionBodiesAsync(sent.Id)).ToArray(),
            "Every revision is retained in order.");

        // No ordinary API exposes an earlier revision.
        var page = await GetMessagesAsync(workspace.Client, conversation.Conversation.Id);
        Assert.AreEqual("first", page.Items.Single().Body);
        Assert.DoesNotContain("frist", await (await GetMessagesResponseAsync(
            workspace.Client,
            conversation.Conversation.Id)).Content.ReadAsStringAsync());
    }

    [TestMethod]
    public async Task AnotherParticipantCannotEditSomebodyElsesMessage()
    {
        var workspace = await CreateWorkspaceAsync("editauthority");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        var sent = await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, "the coach said this");

        await RefreshCsrfAsync(workspace.Client);
        await AssertStatusAsync(
            await PostEditAsync(
                workspace.Client,
                conversation.Conversation.Id,
                sent.Id,
                "the client rewrote it",
                sent.Version),
            HttpStatusCode.BadRequest);

        var expected4 = new[] { "the coach said this" };
        CollectionAssert.AreEqual(expected4, (await RevisionBodiesAsync(sent.Id)).ToArray());
    }

    [TestMethod]
    public async Task AStaleExpectedVersionConflictsAndAppendsNoRevision()
    {
        var workspace = await CreateWorkspaceAsync("editstale");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        var sent = await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, "original");
        await RefreshCsrfAsync(workspace.Coach);
        var firstEdit = await PostEditAsync(
            workspace.Coach,
            conversation.Conversation.Id,
            sent.Id,
            "corrected",
            sent.Version);
        await AssertStatusAsync(firstEdit, HttpStatusCode.OK);

        // The stale version is the one the caller read before the first edit.
        var stale = await PostEditAsync(
            workspace.Coach,
            conversation.Conversation.Id,
            sent.Id,
            "from a stale screen",
            sent.Version);

        Assert.AreEqual("messaging_stale_message_version", await ConflictCodeAsync(stale));
        var expectedAfterStaleEdit = new[] { "original", "corrected" };
        CollectionAssert.AreEqual(
            expectedAfterStaleEdit,
            (await RevisionBodiesAsync(sent.Id)).ToArray());
    }

    [TestMethod]
    public async Task AnIdenticalEditRetryAppendsOnlyOneRevision()
    {
        var workspace = await CreateWorkspaceAsync("editretry");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        var sent = await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, "original");
        var key = Guid.NewGuid();
        await RefreshCsrfAsync(workspace.Coach);

        var first = await PostEditAsync(
            workspace.Coach,
            conversation.Conversation.Id,
            sent.Id,
            "corrected",
            sent.Version,
            key);
        await AssertStatusAsync(first, HttpStatusCode.OK);
        var edited = await RequiredJsonAsync<MessageResponse>(first);

        // The retry carries the version the caller had before the reply was lost, which is now stale.
        // Idempotency is what makes it a success rather than a conflict.
        var replay = await PostEditAsync(
            workspace.Coach,
            conversation.Conversation.Id,
            sent.Id,
            "corrected",
            sent.Version,
            key);
        await AssertStatusAsync(replay, HttpStatusCode.OK);
        var replayed = await RequiredJsonAsync<MessageResponse>(replay);

        Assert.AreEqual(edited.Id, replayed.Id);
        Assert.AreEqual(2, replayed.RevisionNumber);
        Assert.AreEqual(2L, await RevisionCountAsync(sent.Id));
    }

    // ---------- removal ----------

    [TestMethod]
    public async Task SelfDeletionIsOneWayAndIdempotentAndKeepsTheMessageInPlace()
    {
        var workspace = await CreateWorkspaceAsync("delete");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        var first = await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, "regrettable");
        var second = await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, "kept");
        await RefreshCsrfAsync(workspace.Coach);

        var response = await PostDeleteAsync(
            workspace.Coach,
            conversation.Conversation.Id,
            first.Id,
            first.Version);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        var deleted = await RequiredJsonAsync<MessageResponse>(response);

        Assert.IsTrue(deleted.IsDeleted);
        Assert.AreEqual("SenderRemoved", deleted.DeletionKind);
        Assert.IsNull(deleted.Body, "A removed message exposes no body.");
        Assert.IsNotNull(deleted.DeletedAtUtc);
        Assert.IsFalse(deleted.CanEdit);
        Assert.IsFalse(deleted.CanDelete);

        // A repeat is a success that changes nothing, whatever version it carries.
        var repeat = await PostDeleteAsync(
            workspace.Coach,
            conversation.Conversation.Id,
            first.Id,
            first.Version);
        await AssertStatusAsync(repeat, HttpStatusCode.OK);
        Assert.AreEqual(
            deleted.DeletedAtUtc,
            (await RequiredJsonAsync<MessageResponse>(repeat)).DeletedAtUtc);

        // Editing it afterwards is refused, and the revision is still there for audit.
        await AssertStatusAsync(
            await PostEditAsync(
                workspace.Coach,
                conversation.Conversation.Id,
                first.Id,
                "back again",
                deleted.Version),
            HttpStatusCode.Conflict);
        var expected5 = new[] { "regrettable" };
        CollectionAssert.AreEqual(expected5, (await RevisionBodiesAsync(first.Id)).ToArray());

        // It keeps its place and its sequence in the thread.
        var page = await GetMessagesAsync(workspace.Client, conversation.Conversation.Id);
        Assert.HasCount(2, page.Items);
        Assert.AreEqual(first.Sequence, page.Items[0].Sequence);
        Assert.IsNull(page.Items[0].Body);
        Assert.IsTrue(page.Items[0].IsDeleted);
        Assert.AreEqual("kept", page.Items[1].Body);
        Assert.AreEqual(second.Id, page.Items[1].Id);
    }

    [TestMethod]
    public async Task TheCoachParticipantModeratesTheClientsMessageAndTheReasonNeverReachesThem()
    {
        var workspace = await CreateWorkspaceAsync("moderate");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        var fromClient = await SendMessageAsync(workspace.Client, conversation.Conversation.Id, "unacceptable text");
        await RefreshCsrfAsync(workspace.Coach);

        var response = await PostModerateAsync(
            workspace.Coach,
            conversation.Conversation.Id,
            fromClient.Id,
            "Abusive language",
            fromClient.Version);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        var moderated = await RequiredJsonAsync<MessageResponse>(response);

        Assert.IsTrue(moderated.IsDeleted);
        Assert.AreEqual("CoachModerated", moderated.DeletionKind);
        Assert.IsNull(moderated.Body);
        Assert.AreEqual(
            1L,
            await CountAsync(
                "MessageDeletionEvents",
                "\"MessageId\" = @id AND \"Kind\" = 'CoachModerated' AND \"Reason\" = 'Abusive language'",
                ("id", fromClient.Id)));

        // Neither side receives the reason or the removed body from any participant-facing route.
        foreach (var caller in new[] { workspace.Coach, workspace.Client })
        {
            var payload = await (await GetMessagesResponseAsync(
                caller,
                conversation.Conversation.Id)).Content.ReadAsStringAsync();
            Assert.DoesNotContain("Abusive language", payload);
            Assert.DoesNotContain("unacceptable text", payload);
        }

        var listed = await (await workspace.Client.GetAsync("/api/messaging/conversations")).Content.ReadAsStringAsync();
        Assert.DoesNotContain("unacceptable text", listed);
        Assert.DoesNotContain("Abusive language", listed);
        AssertLogIsSafe(workspace, "unacceptable text", "Abusive language");
    }

    [TestMethod]
    public async Task ModerationRequiresAReasonAndIsRefusedAgainstTheModeratorsOwnMessage()
    {
        var workspace = await CreateWorkspaceAsync("moderaterules");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        var fromClient = await SendMessageAsync(workspace.Client, conversation.Conversation.Id, "client text");
        var fromCoach = await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, "coach text");
        await RefreshCsrfAsync(workspace.Coach);

        await AssertStatusAsync(
            await PostModerateAsync(
                workspace.Coach,
                conversation.Conversation.Id,
                fromClient.Id,
                "   ",
                fromClient.Version),
            HttpStatusCode.BadRequest);
        await AssertStatusAsync(
            await PostModerateAsync(
                workspace.Coach,
                conversation.Conversation.Id,
                fromCoach.Id,
                "Off topic",
                fromCoach.Version),
            HttpStatusCode.BadRequest);

        // The client side has no moderation power over the coach's message at all.
        await RefreshCsrfAsync(workspace.Client);
        await AssertStatusAsync(
            await PostModerateAsync(
                workspace.Client,
                conversation.Conversation.Id,
                fromCoach.Id,
                "I disagree",
                fromCoach.Version),
            HttpStatusCode.BadRequest);

        Assert.AreEqual(0L, await CountAsync("MessageDeletionEvents", "\"ConversationId\" = @id", ("id", conversation.Conversation.Id)));
    }

    [TestMethod]
    public async Task ANonParticipantCoachCannotModerateAnything()
    {
        var workspace = await CreateWorkspaceAsync("moderateoutsider");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        var fromClient = await SendMessageAsync(workspace.Client, conversation.Conversation.Id, "client text");
        var outsider = await AddSecondCoachAsync(workspace, "moderateoutsider");

        await AssertStatusAsync(
            await PostModerateAsync(
                outsider.Client,
                conversation.Conversation.Id,
                fromClient.Id,
                "Because I can",
                fromClient.Version),
            HttpStatusCode.NotFound);

        Assert.AreEqual(0L, await CountAsync("MessageDeletionEvents", "\"MessageId\" = @id", ("id", fromClient.Id)));
    }

    [TestMethod]
    public async Task AModeratorCannotEditTheOtherParticipantsMessage()
    {
        var workspace = await CreateWorkspaceAsync("moderateedit");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        var fromClient = await SendMessageAsync(workspace.Client, conversation.Conversation.Id, "what the client said");
        await RefreshCsrfAsync(workspace.Coach);

        await AssertStatusAsync(
            await PostEditAsync(
                workspace.Coach,
                conversation.Conversation.Id,
                fromClient.Id,
                "what the coach wishes had been said",
                fromClient.Version),
            HttpStatusCode.BadRequest);

        var expected6 = new[] { "what the client said" };
        CollectionAssert.AreEqual(expected6, (await RevisionBodiesAsync(fromClient.Id)).ToArray());
    }

    // ---------- read state ----------

    [TestMethod]
    public async Task AReadCursorAdvancesOnlyForTheCallerAndOnlyForwards()
    {
        var workspace = await CreateWorkspaceAsync("read");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, "one");
        await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, "two");
        await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, "three");

        var advanced = await AdvanceReadAsync(workspace.Client, conversation.Conversation.Id, 2);
        Assert.AreEqual(2L, advanced.LastReadSequence);
        Assert.IsNotNull(advanced.LastReadAtUtc);
        Assert.AreEqual(1L, advanced.UnreadCount);
        Assert.AreEqual(3L, advanced.LatestSequence);

        // The other participant's cursor is untouched: read state is one person's own act.
        Assert.AreEqual(0L, await ReadCursorAsync(conversation.Conversation.Id, workspace.CoachUserId));

        var backwards = await AdvanceReadAsync(workspace.Client, conversation.Conversation.Id, 1);
        Assert.AreEqual(2L, backwards.LastReadSequence, "A cursor never regresses.");
        Assert.AreEqual(advanced.LastReadAtUtc, backwards.LastReadAtUtc);
    }

    [TestMethod]
    public async Task AReadCursorBeyondTheNewestCommittedSequenceIsClampedToIt()
    {
        var workspace = await CreateWorkspaceAsync("clamp");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, "one");
        await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, "two");

        // The exact boundary: the newest sequence is honoured, and the next one up is clamped rather
        // than refused, because a message committed between rendering and reporting is a normal race.
        var exact = await AdvanceReadAsync(workspace.Client, conversation.Conversation.Id, 2);
        Assert.AreEqual(2L, exact.LastReadSequence);

        var beyond = await AdvanceReadAsync(workspace.Client, conversation.Conversation.Id, 3);
        Assert.AreEqual(2L, beyond.LastReadSequence);
        Assert.AreEqual(0L, beyond.UnreadCount);

        var wildlyBeyond = await AdvanceReadAsync(workspace.Client, conversation.Conversation.Id, long.MaxValue);
        Assert.AreEqual(2L, wildlyBeyond.LastReadSequence);

        // A negative cursor is a caller error rather than something to clamp.
        await RefreshCsrfAsync(workspace.Client);
        await AssertStatusAsync(
            await PostReadAsync(workspace.Client, conversation.Conversation.Id, -1),
            HttpStatusCode.BadRequest);
    }

    [TestMethod]
    public async Task ConcurrentReadAdvancesResolveToTheGreatestValidSequence()
    {
        var workspace = await CreateWorkspaceAsync("readrace");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        for (var index = 0; index < 5; index++)
        {
            await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, $"message {index}");
        }

        using var secondSession = await SecondSessionAsync(workspace.ClientEmail, workspace.TenantId);
        await RefreshCsrfAsync(workspace.Client);

        Barrier.Arm(ReadCursorLockFragment, 2);
        var higher = PostReadAsync(workspace.Client, conversation.Conversation.Id, 5);
        var lower = PostReadAsync(secondSession, conversation.Conversation.Id, 2);
        await Barrier.ArrivedAsync(2).WaitAsync(TimeSpan.FromSeconds(30));
        Barrier.Disarm();
        var responses = await Task.WhenAll(higher, lower);

        Assert.AreEqual(2, Barrier.Arrived, "Both advances must have reached the cursor lock together.");
        foreach (var response in responses)
        {
            await AssertStatusAsync(response, HttpStatusCode.OK);
        }

        Assert.AreEqual(
            5L,
            await ReadCursorAsync(conversation.Conversation.Id, workspace.ClientUserId),
            "The greatest valid sequence wins; the lower advance cannot pull it back.");
    }

    [TestMethod]
    public async Task YourOwnMessagesDoNotIncreaseYourOwnUnreadCount()
    {
        var workspace = await CreateWorkspaceAsync("unread");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);

        await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, "one");
        await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, "two");

        Assert.AreEqual(0L, await UnreadCountAsync(workspace.Coach), "Sending is not being told something.");
        Assert.AreEqual(2L, await UnreadCountAsync(workspace.Client));

        // A reply does not mark the sender's own earlier messages as read for the other side, and
        // does not mark anything read for the replier's counterpart.
        await SendMessageAsync(workspace.Client, conversation.Conversation.Id, "reply");
        Assert.AreEqual(2L, await UnreadCountAsync(workspace.Client), "Replying is not reading.");
        Assert.AreEqual(1L, await UnreadCountAsync(workspace.Coach));

        await AdvanceReadAsync(workspace.Client, conversation.Conversation.Id, 3);
        Assert.AreEqual(0L, await UnreadCountAsync(workspace.Client));
        Assert.AreEqual(1L, await UnreadCountAsync(workspace.Coach), "Reading is one person's own act.");
    }

    [TestMethod]
    public async Task ARemovedMessageStopsCountingAsUnread()
    {
        var workspace = await CreateWorkspaceAsync("unreadremoved");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        var sent = await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, "withdrawn");
        Assert.AreEqual(1L, await UnreadCountAsync(workspace.Client));

        await RefreshCsrfAsync(workspace.Coach);
        await AssertStatusAsync(
            await PostDeleteAsync(workspace.Coach, conversation.Conversation.Id, sent.Id, sent.Version),
            HttpStatusCode.OK);

        Assert.AreEqual(
            0L,
            await UnreadCountAsync(workspace.Client),
            "A badge pointing at a body nobody can read is noise.");
    }

    // ---------- history pagination ----------

    [TestMethod]
    public async Task HistoryPagingStaysCompleteWhenANewMessageArrivesBetweenPages()
    {
        var workspace = await CreateWorkspaceAsync("paging");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        for (var index = 1; index <= 6; index++)
        {
            await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, $"message {index}");
        }

        var newest = await GetMessagesAsync(workspace.Client, conversation.Conversation.Id, take: 3);
        var expected7 = new[] { 4L, 5L, 6L };
        CollectionAssert.AreEqual(expected7, newest.Items.Select(item => item.Sequence).ToArray());
        Assert.IsTrue(newest.HasOlder);
        Assert.AreEqual(4L, newest.OldestSequence);

        // Something arrives while the reader is paging backwards. A sequence cursor is unaffected:
        // which messages are older than 4 does not depend on what happens after 6.
        await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, "message 7");

        var older = await GetMessagesAsync(
            workspace.Client,
            conversation.Conversation.Id,
            beforeSequence: newest.OldestSequence,
            take: 3);
        var expected8 = new[] { 1L, 2L, 3L };
        CollectionAssert.AreEqual(expected8, older.Items.Select(item => item.Sequence).ToArray());
        Assert.IsFalse(older.HasOlder, "The whole thread has now been read.");
        Assert.AreEqual(7L, older.LatestSequence, "The page still reports the conversation's newest sequence.");

        var loaded = newest.Items.Concat(older.Items).Select(item => item.Id).ToArray();
        Assert.AreEqual(loaded.Length, loaded.Distinct().Count(), "Overlapping pages must not duplicate a message.");
        var expectedWholeThread = new[] { 1L, 2L, 3L, 4L, 5L, 6L };
        CollectionAssert.AreEquivalent(
            expectedWholeThread,
            newest.Items.Concat(older.Items).Select(item => item.Sequence).ToArray());
    }

    [TestMethod]
    public async Task ConversationListPagingIsAStableKeysetAndRequiresBothCursorHalves()
    {
        var workspace = await CreateWorkspaceAsync("listpaging");
        var conversations = new List<Guid>();
        for (var index = 0; index < 3; index++)
        {
            var extra = await AddClientAsync(workspace, $"listpaging{index}");
            var offerId = await CreateOfferAsync(workspace.Coach, 120m, 8, $"Messaging {index}");
            var enrollment = await AssignAsync(workspace.Coach, extra.ClientProfileId, offerId, TenantToday());
            await PayInFullAsync(workspace.Coach, enrollment);
            var conversation = await StartConversationAsync(workspace.Coach, extra.ClientProfileId);
            Clock.Advance(TimeSpan.FromMinutes(1));
            await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, $"hello {index}");
            conversations.Add(conversation.Conversation.Id);
            extra.Session.Dispose();
        }

        var first = await ListConversationsAsync(workspace.Coach, take: 2);
        Assert.HasCount(2, first.Items);
        Assert.IsTrue(first.HasMore);
        // Newest activity first.
        CollectionAssert.AreEqual(
            new[] { conversations[2], conversations[1] },
            first.Items.Select(item => item.Id).ToArray());

        var second = await ListConversationsAsync(
            workspace.Coach,
            first.NextBeforeActivityAtUtc,
            first.NextBeforeConversationId,
            take: 2);
        Assert.AreEqual(conversations[0], second.Items[0].Id);
        Assert.IsFalse(second.HasMore);
        var all = first.Items.Concat(second.Items).Select(item => item.Id).ToArray();
        Assert.AreEqual(all.Length, all.Distinct().Count());

        // One half of a cursor cannot identify a position, so it is refused rather than guessed at.
        await AssertStatusAsync(
            await workspace.Coach.GetAsync(
                $"/api/messaging/conversations?beforeConversationId={conversations[0]}"),
            HttpStatusCode.BadRequest);
    }

    // ---------- authorization and tenant isolation ----------

    [TestMethod]
    public async Task AnotherWorkspaceCannotListReadSendEditDeleteModerateOrMarkRead()
    {
        var workspace = await CreateWorkspaceAsync("tenantalpha");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        var sent = await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, "private");
        var other = await CreateWorkspaceAsync("tenantbeta");

        // Naming another workspace in the header is refused by tenant authorization: the header is a
        // request, not a credential.
        SetTenant(other.Coach, workspace.TenantId);
        await RefreshCsrfAsync(other.Coach);
        await AssertStatusAsync(
            await other.Coach.GetAsync("/api/messaging/conversations"),
            HttpStatusCode.Forbidden);
        await AssertStatusAsync(
            await GetMessagesResponseAsync(other.Coach, conversation.Conversation.Id),
            HttpStatusCode.Forbidden);
        await AssertStatusAsync(
            await PostMessageAsync(other.Coach, conversation.Conversation.Id, "intrusion"),
            HttpStatusCode.Forbidden);

        // And inside their own workspace the identifier simply does not exist.
        SetTenant(other.Coach, other.TenantId);
        await RefreshCsrfAsync(other.Coach);
        Assert.IsEmpty((await ListConversationsAsync(other.Coach)).Items);
        await AssertStatusAsync(
            await GetMessagesResponseAsync(other.Coach, conversation.Conversation.Id),
            HttpStatusCode.NotFound);
        await AssertStatusAsync(
            await PostMessageAsync(other.Coach, conversation.Conversation.Id, "intrusion"),
            HttpStatusCode.NotFound);
        await AssertStatusAsync(
            await PostEditAsync(other.Coach, conversation.Conversation.Id, sent.Id, "rewritten", sent.Version),
            HttpStatusCode.NotFound);
        await AssertStatusAsync(
            await PostDeleteAsync(other.Coach, conversation.Conversation.Id, sent.Id, sent.Version),
            HttpStatusCode.NotFound);
        await AssertStatusAsync(
            await PostModerateAsync(other.Coach, conversation.Conversation.Id, sent.Id, "no", sent.Version),
            HttpStatusCode.NotFound);
        await AssertStatusAsync(
            await PostReadAsync(other.Coach, conversation.Conversation.Id, 1),
            HttpStatusCode.NotFound);
        Assert.AreEqual(0L, await UnreadCountAsync(other.Coach));

        Assert.AreEqual(1L, await MessageCountAsync(conversation.Conversation.Id));
        var expected9 = new[] { "private" };
        CollectionAssert.AreEqual(expected9, (await RevisionBodiesAsync(sent.Id)).ToArray());
    }

    [TestMethod]
    public async Task ASameWorkspaceNonParticipantIncludingAnotherCoachReceivesNotFound()
    {
        var workspace = await CreateWorkspaceAsync("nonparticipant");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        var sent = await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, "between us");
        var otherCoach = await AddSecondCoachAsync(workspace, "nonparticipant");
        var otherClient = await AddClientAsync(workspace, "nonparticipant");

        foreach (var outsider in new[] { otherCoach.Client, otherClient.Session })
        {
            await RefreshCsrfAsync(outsider);
            Assert.IsEmpty((await ListConversationsAsync(outsider)).Items);
            await AssertStatusAsync(
                await GetMessagesResponseAsync(outsider, conversation.Conversation.Id),
                HttpStatusCode.NotFound);
            await AssertStatusAsync(
                await PostMessageAsync(outsider, conversation.Conversation.Id, "let me in"),
                HttpStatusCode.NotFound);
            await AssertStatusAsync(
                await PostReadAsync(outsider, conversation.Conversation.Id, 1),
                HttpStatusCode.NotFound);
            await AssertStatusAsync(
                await PostDeleteAsync(outsider, conversation.Conversation.Id, sent.Id, sent.Version),
                HttpStatusCode.NotFound);
            Assert.AreEqual(0L, await UnreadCountAsync(outsider));
        }

        otherClient.Session.Dispose();
    }

    [TestMethod]
    public async Task RemovedMembershipLosesAccessImmediately()
    {
        var workspace = await CreateWorkspaceAsync("membership");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, "while you were here");
        Assert.HasCount(1, (await ListConversationsAsync(workspace.Client)).Items);

        await ExecuteAsync(
            """
            UPDATE tenancy."Memberships" SET "Status" = 'Removed'
            WHERE "TenantId" = @tenantId AND "UserId" = @userId
            """,
            ("tenantId", workspace.TenantId),
            ("userId", workspace.ClientUserId));

        // The tenant policy refuses the workspace outright once membership has gone.
        await AssertStatusAsync(
            await workspace.Client.GetAsync("/api/messaging/conversations"),
            HttpStatusCode.Forbidden);
        await AssertStatusAsync(
            await GetMessagesResponseAsync(workspace.Client, conversation.Conversation.Id),
            HttpStatusCode.Forbidden);

        // Nothing was deleted: the coach's side still reports the conversation, now unavailable,
        // because the client's own membership is what the Messaging decision depends on.
        var coachList = await ListConversationsAsync(workspace.Coach);
        Assert.HasCount(1, coachList.Items);
        Assert.IsFalse(coachList.Items[0].IsAvailable);
        Assert.AreEqual("MembershipInactive", coachList.Items[0].AccessReason);
        Assert.IsNull(coachList.Items[0].LastMessage);
        Assert.AreEqual(1L, await MessageCountAsync(conversation.Conversation.Id));
    }

    [TestMethod]
    public async Task APlatformBlockAndARelationshipBlockBothDenyWithoutDeletingAnything()
    {
        var blocked = await CreateWorkspaceAsync("platformblock");
        var conversation = await StartConversationAsync(blocked.Coach, blocked.ClientProfileId);
        await SendMessageAsync(blocked.Coach, conversation.Conversation.Id, "still on disk");

        await ExecuteAsync(
            """UPDATE identity."Users" SET "IsPlatformBlocked" = TRUE WHERE "Id" = @id""",
            ("id", blocked.ClientUserId));

        // A platform-blocked account is stopped at the platform gate before any Messaging decision is
        // reached, and is signed out, so its own side is a 401 rather than a feature-access refusal.
        Assert.AreEqual(
            HttpStatusCode.Unauthorized,
            (await GetMessagesResponseAsync(blocked.Client, conversation.Conversation.Id)).StatusCode);
        // The coach's side is where the Messaging decision is visible.
        await AssertDeniedEverywhereAsync(
            blocked,
            conversation.Conversation.Id,
            "PlatformBlocked",
            [blocked.Coach]);

        await ExecuteAsync(
            """UPDATE identity."Users" SET "IsPlatformBlocked" = FALSE WHERE "Id" = @id""",
            ("id", blocked.ClientUserId));

        // Restoring access restores the thread, because the refusal never deleted anything.
        var restored = await GetMessagesAsync(blocked.Coach, conversation.Conversation.Id);
        Assert.AreEqual("still on disk", restored.Items.Single().Body);

        // A workspace relationship block is local to this workspace, so the client keeps their
        // account and their session and is refused by the Messaging decision on both sides.
        await SignInAsync(blocked.Client, blocked.ClientEmail);
        SetTenant(blocked.Client, blocked.TenantId);
        await BlockClientAsync(blocked.Coach, blocked.ClientProfileId);
        await AssertDeniedEverywhereAsync(
            blocked,
            conversation.Conversation.Id,
            "RelationshipBlocked",
            [blocked.Coach, blocked.Client]);
        Assert.AreEqual(1L, await MessageCountAsync(conversation.Conversation.Id));
    }

    [TestMethod]
    public async Task EveryDeniedMessagingStateRefusesWithoutContent()
    {
        // Unpaid.
        var unpaid = await CreateWorkspaceAsync("unpaid", grantMessaging: false);
        var unpaidOffer = await CreateOfferAsync(unpaid.Coach, 120m, 8, "Messaging unpaid");
        await AssignAsync(unpaid.Coach, unpaid.ClientProfileId, unpaidOffer, TenantToday());
        await AssertCreateDeniedAsync(unpaid, "PaymentRequired");

        // No entitlement at all.
        var none = await CreateWorkspaceAsync("noentitlement", grantMessaging: false);
        await AssertCreateDeniedAsync(none, "NoEntitlement");

        // Paid, but the service has not started yet. A conversation cannot be opened before the
        // relationship it belongs to begins, so this is a create-time denial rather than a read one.
        var upcoming = await CreateWorkspaceAsync("upcoming", grantMessaging: false);
        var upcomingOffer = await CreateOfferAsync(upcoming.Coach, 120m, 8, "Messaging upcoming");
        var future = await AssignAsync(
            upcoming.Coach,
            upcoming.ClientProfileId,
            upcomingOffer,
            TenantToday().AddDays(30));
        await PayInFullAsync(upcoming.Coach, future);
        await AssertCreateDeniedAsync(upcoming, "NotStarted");

        // Paused, cancelled and expired, each against a live conversation with a stored message.
        await AssertLifecycleDenialAsync("paused", "Paused", async (workspace, enrollmentId) =>
            await ChangeEnrollmentAsync(workspace, enrollmentId, "pause", "Travelling."));

        await AssertLifecycleDenialAsync("cancelled", "Cancelled", async (workspace, enrollmentId) =>
            await ChangeEnrollmentAsync(workspace, enrollmentId, "cancel", "Ended early."));

        await AssertLifecycleDenialAsync("expired", "Expired", (_, _) =>
        {
            // The service date is authoritative, so moving the clock past it expires access whether
            // or not a projection has written the status.
            Clock.Advance(TimeSpan.FromDays(70));
            return Task.CompletedTask;
        });
    }

    // ---------- privacy, transport and database protections ----------

    [TestMethod]
    public async Task NoMessageContentNameOrAddressReachesTheLog()
    {
        var workspace = await CreateWorkspaceAsync("logging");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        var sent = await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, "a private sentence");
        await RefreshCsrfAsync(workspace.Coach);
        await PostEditAsync(
            workspace.Coach,
            conversation.Conversation.Id,
            sent.Id,
            "a corrected private sentence",
            sent.Version);
        var fromClient = await SendMessageAsync(workspace.Client, conversation.Conversation.Id, "the client replied");
        await RefreshCsrfAsync(workspace.Coach);
        await PostModerateAsync(
            workspace.Coach,
            conversation.Conversation.Id,
            fromClient.Id,
            "A confidential removal reason",
            fromClient.Version);

        AssertLogIsSafe(
            workspace,
            "a private sentence",
            "a corrected private sentence",
            "the client replied",
            "A confidential removal reason");
    }

    [TestMethod]
    public async Task EveryWriteRequiresAuthenticationTenantMembershipAndAnAntiforgeryToken()
    {
        var workspace = await CreateWorkspaceAsync("transport");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);

        using var anonymous = CreateClient();
        SetTenant(anonymous, workspace.TenantId);
        await AssertStatusAsync(
            await anonymous.GetAsync("/api/messaging/conversations"),
            HttpStatusCode.Unauthorized);
        await AssertStatusAsync(
            await anonymous.GetAsync("/api/messaging/unread-count"),
            HttpStatusCode.Unauthorized);
        await AssertStatusAsync(
            await GetMessagesResponseAsync(anonymous, conversation.Conversation.Id),
            HttpStatusCode.Unauthorized);

        // Signed in but naming no workspace: the tenant policy has nothing to verify.
        using var noTenant = await SecondSessionAsync(workspace.CoachEmail, workspace.TenantId);
        noTenant.DefaultRequestHeaders.Remove("X-Tenant-Id");
        await AssertStatusAsync(
            await noTenant.GetAsync("/api/messaging/conversations"),
            HttpStatusCode.Forbidden);

        // Without the paired request token the write is refused and nothing changes. The status is
        // deliberately not pinned: this repository's endpoints call ValidateRequestAsync directly and
        // its AntiforgeryValidationException reaches the generic handler, so a missing token is
        // reported as 500 rather than 400. That is pre-existing across every write endpoint.
        workspace.Coach.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
        var refused = await workspace.Coach.PostAsJsonAsync(
            $"/api/messaging/conversations/{conversation.Conversation.Id}/messages",
            new { body = "no token", idempotencyKey = Guid.NewGuid() });
        Assert.IsFalse(refused.IsSuccessStatusCode, "A write without an antiforgery token must be refused.");
        Assert.AreEqual(0L, await MessageCountAsync(conversation.Conversation.Id));
    }

    [TestMethod]
    public async Task SensitiveMessagingWritesAreRateLimitedPerSignedInUser()
    {
        var workspace = await CreateWorkspaceAsync("ratelimit");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        await RefreshCsrfAsync(workspace.Client);

        // Marking read is the cheapest sensitive write, so the limiter is measured rather than the
        // database. The limit is 60 per minute per signed-in user.
        var accepted = 0;
        var limited = false;
        for (var attempt = 0; attempt < 70 && !limited; attempt++)
        {
            var response = await PostReadAsync(workspace.Client, conversation.Conversation.Id, 0);
            if (response.StatusCode == HttpStatusCode.TooManyRequests)
            {
                limited = true;
            }
            else
            {
                await AssertStatusAsync(response, HttpStatusCode.OK);
                accepted++;
            }
        }

        Assert.IsTrue(limited, "A sensitive messaging write must be rate limited.");
        Assert.IsGreaterThanOrEqualTo(
            50,
            accepted,
            "The limit must not be so tight that ordinary use is refused.");

        // The partition is the signed-in user, so the coach is unaffected by the client's spending.
        await RefreshCsrfAsync(workspace.Coach);
        await AssertStatusAsync(
            await PostMessageAsync(workspace.Coach, conversation.Conversation.Id, "still allowed"),
            HttpStatusCode.OK);
    }

    [TestMethod]
    public async Task TheDatabaseRefusesCrossTenantAndNonParticipantMessageRows()
    {
        var workspace = await CreateWorkspaceAsync("dbfk");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        var outsider = await AddSecondCoachAsync(workspace, "dbfk");
        var other = await CreateWorkspaceAsync("dbfkother");

        // A sender who is not an explicit participant of this conversation.
        var nonParticipant = await Assert.ThrowsExactlyAsync<PostgresException>(() =>
            InsertMessageAsync(workspace.TenantId, conversation.Conversation.Id, outsider.UserId, 99));
        Assert.AreEqual("23503", nonParticipant.SqlState);

        // The same conversation identifier under another workspace's tenant id.
        var crossTenant = await Assert.ThrowsExactlyAsync<PostgresException>(() =>
            InsertMessageAsync(other.TenantId, conversation.Conversation.Id, workspace.CoachUserId, 98));
        Assert.AreEqual("23503", crossTenant.SqlState);

        // A duplicate sequence.
        await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, "one");
        var duplicate = await Assert.ThrowsExactlyAsync<PostgresException>(() =>
            InsertMessageAsync(workspace.TenantId, conversation.Conversation.Id, workspace.CoachUserId, 1));
        Assert.AreEqual("23505", duplicate.SqlState);

        // A non-positive sequence.
        var nonPositive = await Assert.ThrowsExactlyAsync<PostgresException>(() =>
            InsertMessageAsync(workspace.TenantId, conversation.Conversation.Id, workspace.CoachUserId, 0));
        Assert.AreEqual("23514", nonPositive.SqlState);
    }

    [TestMethod]
    public async Task TheDatabaseRefusesHistoryMutationHardDeletionAndCursorRegression()
    {
        var workspace = await CreateWorkspaceAsync("dbtriggers");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        var sent = await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, "the original");
        await AdvanceReadAsync(workspace.Client, conversation.Conversation.Id, 1);
        var messageId = await AnyMessageIdAsync(conversation.Conversation.Id);

        await AssertRefusedAsync(
            """UPDATE messaging."MessageRevisions" SET "Body" = 'rewritten' WHERE "MessageId" = @id""",
            ("id", messageId));
        await AssertRefusedAsync(
            """DELETE FROM messaging."MessageRevisions" WHERE "MessageId" = @id""",
            ("id", messageId));
        await AssertRefusedAsync(
            """DELETE FROM messaging."Messages" WHERE "Id" = @id""",
            ("id", messageId));
        await AssertRefusedAsync(
            """DELETE FROM messaging."Conversations" WHERE "Id" = @id""",
            ("id", conversation.Conversation.Id));
        await AssertRefusedAsync(
            """DELETE FROM messaging."ConversationParticipants" WHERE "ConversationId" = @id""",
            ("id", conversation.Conversation.Id));
        await AssertRefusedAsync(
            """
            UPDATE messaging."ConversationParticipants" SET "LastReadSequence" = 0
            WHERE "ConversationId" = @id AND "UserId" = @userId
            """,
            ("id", conversation.Conversation.Id),
            ("userId", workspace.ClientUserId));
        await AssertRefusedAsync(
            """UPDATE messaging."Messages" SET "Sequence" = 42 WHERE "Id" = @id""",
            ("id", messageId));
        await AssertRefusedAsync(
            """
            UPDATE messaging."Conversations" SET "LastSequence" = 0, "LastMessageId" = NULL WHERE "Id" = @id
            """,
            ("id", conversation.Conversation.Id));

        // Removal is one way at the database as well as in the domain.
        await RefreshCsrfAsync(workspace.Coach);
        await AssertStatusAsync(
            await PostDeleteAsync(workspace.Coach, conversation.Conversation.Id, sent.Id, sent.Version),
            HttpStatusCode.OK);
        await AssertRefusedAsync(
            """
            UPDATE messaging."Messages"
            SET "DeletedAtUtc" = NULL, "DeletionKind" = NULL, "DeletedByUserId" = NULL
            WHERE "Id" = @id
            """,
            ("id", messageId));
        await AssertRefusedAsync(
            """UPDATE messaging."MessageDeletionEvents" SET "Reason" = 'changed' WHERE "MessageId" = @id""",
            ("id", messageId));
        await AssertRefusedAsync(
            """DELETE FROM messaging."CommandRecords" WHERE "ConversationId" = @id""",
            ("id", conversation.Conversation.Id));

        var expected10 = new[] { "the original" };
        CollectionAssert.AreEqual(expected10, (await RevisionBodiesAsync(messageId)).ToArray());
        Assert.AreEqual(1L, await MessageCountAsync(conversation.Conversation.Id));
    }

    // ---------- helpers ----------

    private Task InsertMessageAsync(Guid tenantId, Guid conversationId, Guid senderUserId, long sequence) =>
        ExecuteAsync(
            """
            INSERT INTO messaging."Messages"
                ("Id", "TenantId", "ConversationId", "SenderUserId", "Sequence", "SentAtUtc",
                 "AvailableAtUtc", "CurrentRevisionNumber", "CreatedAtUtc", "UpdatedAtUtc")
            VALUES (@id, @tenantId, @conversationId, @senderUserId, @sequence, CURRENT_TIMESTAMP,
                    CURRENT_TIMESTAMP, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            ("id", Guid.CreateVersion7()),
            ("tenantId", tenantId),
            ("conversationId", conversationId),
            ("senderUserId", senderUserId),
            ("sequence", sequence));

    private async Task AssertRefusedAsync(string sql, params (string Name, object Value)[] parameters)
    {
        var failure = await Assert.ThrowsExactlyAsync<PostgresException>(() => ExecuteAsync(sql, parameters));
        Assert.AreEqual("23514", failure.SqlState, $"Expected a check/trigger refusal for: {sql}");
    }

    /// <summary>
    /// Every participant-facing route refuses with the same stable reason and returns no content, on
    /// both sides of the conversation.
    /// </summary>
    private static async Task AssertDeniedEverywhereAsync(
        Workspace workspace,
        Guid conversationId,
        string expectedReason,
        HttpClient[]? callers = null)
    {
        foreach (var caller in callers ?? [workspace.Coach, workspace.Client])
        {
            await RefreshCsrfAsync(caller);
            Assert.AreEqual(
                expectedReason,
                await AccessReasonAsync(await GetMessagesResponseAsync(caller, conversationId)));
            Assert.AreEqual(
                expectedReason,
                await AccessReasonAsync(await PostMessageAsync(caller, conversationId, "denied")));
            Assert.AreEqual(
                expectedReason,
                await AccessReasonAsync(await PostReadAsync(caller, conversationId, 1)));
            Assert.AreEqual(0L, await UnreadCountAsync(caller), "An inaccessible conversation contributes no badge.");

            var listed = await ListConversationsAsync(caller);
            var summary = listed.Items.Single();
            Assert.IsFalse(summary.IsAvailable);
            Assert.AreEqual(expectedReason, summary.AccessReason);
            Assert.IsNull(summary.LastMessage, "An unavailable conversation returns no preview.");
            Assert.AreEqual(0L, summary.UnreadCount);
        }
    }

    private async Task AssertCreateDeniedAsync(Workspace workspace, string expectedReason)
    {
        await RefreshCsrfAsync(workspace.Coach);
        Assert.AreEqual(
            expectedReason,
            await AccessReasonAsync(await CreateConversationAsync(workspace.Coach, workspace.ClientProfileId)));
        Assert.AreEqual(0L, await CountAsync("Conversations", "\"TenantId\" = @id", ("id", workspace.TenantId)));
    }

    private async Task AssertLifecycleDenialAsync(
        string label,
        string expectedReason,
        Func<Workspace, Guid, Task> breakAccess)
    {
        var workspace = await CreateWorkspaceAsync(label);
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, "before the change");

        await breakAccess(workspace, workspace.Enrollment!.Id);

        await AssertDeniedEverywhereAsync(workspace, conversation.Conversation.Id, expectedReason);
        Assert.AreEqual(
            1L,
            await MessageCountAsync(conversation.Conversation.Id),
            $"{label}: a denial stores nothing and deletes nothing.");
    }
}
