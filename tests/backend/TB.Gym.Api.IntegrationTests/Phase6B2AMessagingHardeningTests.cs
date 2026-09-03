using System.Net;
using Npgsql;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Phase 6B-2A review remediation: the guarantees the first pass claimed but did not hold.
/// </summary>
/// <remarks>
/// Each test here was written against the unrepaired implementation and observed to fail before the
/// fix that makes it pass. They fall into three groups: the workspace-wide idempotency namespace
/// under real contention, the database invariants ADR 0019 calls impossible, and resource
/// authorization ordering.
/// </remarks>
public sealed partial class Phase6B2AMessagingTests
{
    /// <summary>
    /// The workspace-wide idempotency boundary. Every command takes this lock first, before any
    /// aggregate lock, so arming a barrier here proves two requests contended for the same key.
    /// </summary>
    private const string IdempotencyLockFragment = "messaging-idempotency";

    // ---------- 1. workspace-wide idempotency under concurrency ----------

    [TestMethod]
    public async Task ConcurrentIdenticalEditsAppendOneRevisionAndReplayTheSameResult()
    {
        var workspace = await CreateWorkspaceAsync("editrace");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        var sent = await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, "frist");
        using var second = await SecondSessionAsync(workspace.CoachEmail, workspace.TenantId);
        var key = Guid.NewGuid();
        await RefreshCsrfAsync(workspace.Coach);

        Barrier.Arm(IdempotencyLockFragment, 2);
        var first = PostEditAsync(
            workspace.Coach,
            conversation.Conversation.Id,
            sent.Id,
            "first",
            sent.Version,
            key);
        var retry = PostEditAsync(second, conversation.Conversation.Id, sent.Id, "first", sent.Version, key);
        await Barrier.ArrivedAsync(2).WaitAsync(TimeSpan.FromSeconds(30));
        Barrier.Disarm();
        var responses = await Task.WhenAll(first, retry);

        Assert.AreEqual(2, Barrier.Arrived, "Both edits must have reached the idempotency boundary.");
        foreach (var response in responses)
        {
            // The loser replays the winner rather than reporting a stale version: it presented the
            // same key and the same normalized payload, so it is the same command.
            await AssertStatusAsync(response, HttpStatusCode.OK);
            var view = await RequiredJsonAsync<MessageResponse>(response);
            Assert.AreEqual(sent.Id, view.Id);
            Assert.AreEqual("first", view.Body);
            Assert.AreEqual(2, view.RevisionNumber);
        }

        Assert.AreEqual(2L, await RevisionCountAsync(sent.Id), "An identical retry appends no second revision.");
        Assert.AreEqual(1L, await CountAsync("CommandRecords", "\"IdempotencyKey\" = @key", ("key", key)));
    }

    [TestMethod]
    public async Task ConcurrentIdenticalDeletesRemoveOnceAndReplayTheSameResult()
    {
        var workspace = await CreateWorkspaceAsync("deleterace");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        var sent = await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, "regrettable");
        using var second = await SecondSessionAsync(workspace.CoachEmail, workspace.TenantId);
        var key = Guid.NewGuid();
        await RefreshCsrfAsync(workspace.Coach);

        Barrier.Arm(IdempotencyLockFragment, 2);
        var first = PostDeleteAsync(workspace.Coach, conversation.Conversation.Id, sent.Id, sent.Version, key);
        var retry = PostDeleteAsync(second, conversation.Conversation.Id, sent.Id, sent.Version, key);
        await Barrier.ArrivedAsync(2).WaitAsync(TimeSpan.FromSeconds(30));
        Barrier.Disarm();
        var responses = await Task.WhenAll(first, retry);

        Assert.AreEqual(2, Barrier.Arrived);
        foreach (var response in responses)
        {
            await AssertStatusAsync(response, HttpStatusCode.OK);
            var view = await RequiredJsonAsync<MessageResponse>(response);
            Assert.IsTrue(view.IsDeleted);
            Assert.AreEqual("SenderRemoved", view.DeletionKind);
            Assert.IsNull(view.Body);
        }

        Assert.AreEqual(
            1L,
            await CountAsync("MessageDeletionEvents", "\"MessageId\" = @id", ("id", sent.Id)),
            "Removal is one way and records one event.");
        Assert.AreEqual(1L, await CountAsync("CommandRecords", "\"IdempotencyKey\" = @key", ("key", key)));
    }

    [TestMethod]
    public async Task ConcurrentIdenticalModerationRemovesOnceAndReplaysTheSameResult()
    {
        var workspace = await CreateWorkspaceAsync("moderaterace");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        var fromClient = await SendMessageAsync(workspace.Client, conversation.Conversation.Id, "client text");
        using var second = await SecondSessionAsync(workspace.CoachEmail, workspace.TenantId);
        var key = Guid.NewGuid();
        await RefreshCsrfAsync(workspace.Coach);

        Barrier.Arm(IdempotencyLockFragment, 2);
        var first = PostModerateAsync(
            workspace.Coach,
            conversation.Conversation.Id,
            fromClient.Id,
            "Off topic",
            fromClient.Version,
            key);
        var retry = PostModerateAsync(
            second,
            conversation.Conversation.Id,
            fromClient.Id,
            "Off topic",
            fromClient.Version,
            key);
        await Barrier.ArrivedAsync(2).WaitAsync(TimeSpan.FromSeconds(30));
        Barrier.Disarm();
        var responses = await Task.WhenAll(first, retry);

        Assert.AreEqual(2, Barrier.Arrived);
        foreach (var response in responses)
        {
            await AssertStatusAsync(response, HttpStatusCode.OK);
            var view = await RequiredJsonAsync<MessageResponse>(response);
            Assert.IsTrue(view.IsDeleted);
            Assert.AreEqual("CoachModerated", view.DeletionKind);
            Assert.IsNull(view.Body);
        }

        Assert.AreEqual(1L, await CountAsync("MessageDeletionEvents", "\"MessageId\" = @id", ("id", fromClient.Id)));
        Assert.AreEqual(1L, await CountAsync("CommandRecords", "\"IdempotencyKey\" = @key", ("key", key)));
    }

    /// <summary>
    /// One key, two conversations. Nothing about a conversation row serializes this, so only a
    /// workspace-wide boundary on the key itself can settle it.
    /// </summary>
    [TestMethod]
    public async Task OneKeyRacingAcrossTwoConversationsWritesOneMessageAndConflictsTheOther()
    {
        var workspace = await CreateWorkspaceAsync("keyacrossconversations");
        var first = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        var otherClient = await AddEntitledClientAsync(workspace, "keyacrossconversations");
        var second = await StartConversationAsync(workspace.Coach, otherClient.ClientProfileId);
        using var session = await SecondSessionAsync(workspace.CoachEmail, workspace.TenantId);
        var key = Guid.NewGuid();
        await RefreshCsrfAsync(workspace.Coach);

        Barrier.Arm(IdempotencyLockFragment, 2);
        var toFirst = PostMessageAsync(workspace.Coach, first.Conversation.Id, "hello", key);
        var toSecond = PostMessageAsync(session, second.Conversation.Id, "hello", key);
        await Barrier.ArrivedAsync(2).WaitAsync(TimeSpan.FromSeconds(30));
        Barrier.Disarm();
        var responses = await Task.WhenAll(toFirst, toSecond);

        Assert.AreEqual(2, Barrier.Arrived, "Both sends must have reached the idempotency boundary.");
        await AssertOneWinnerOneConflictAsync(responses);
        Assert.AreEqual(
            1L,
            await CountAsync("Messages", "\"TenantId\" = @id", ("id", workspace.TenantId)),
            "A key spent in one conversation cannot also write in another.");
        Assert.AreEqual(1L, await CountAsync("CommandRecords", "\"IdempotencyKey\" = @key", ("key", key)));
        Assert.AreEqual(1L, await CountAsync("MessageRevisions", "\"TenantId\" = @id", ("id", workspace.TenantId)));
    }

    [TestMethod]
    public async Task OneKeyRacingAcrossTwoClientCreatesMakesOneConversationAndConflictsTheOther()
    {
        var workspace = await CreateWorkspaceAsync("keyacrosscreates", grantMessaging: false);
        var firstClient = await AddEntitledClientAsync(workspace, "keyacrosscreatesa");
        var secondClient = await AddEntitledClientAsync(workspace, "keyacrosscreatesb");
        using var session = await SecondSessionAsync(workspace.CoachEmail, workspace.TenantId);
        var key = Guid.NewGuid();
        await RefreshCsrfAsync(workspace.Coach);

        Barrier.Arm(IdempotencyLockFragment, 2);
        var toFirst = CreateConversationAsync(workspace.Coach, firstClient.ClientProfileId, key);
        var toSecond = CreateConversationAsync(session, secondClient.ClientProfileId, key);
        await Barrier.ArrivedAsync(2).WaitAsync(TimeSpan.FromSeconds(30));
        Barrier.Disarm();
        var responses = await Task.WhenAll(toFirst, toSecond);

        Assert.AreEqual(2, Barrier.Arrived, "Both creates must have reached the idempotency boundary.");
        await AssertOneWinnerOneConflictAsync(responses);
        Assert.AreEqual(
            1L,
            await CountAsync("Conversations", "\"TenantId\" = @id", ("id", workspace.TenantId)),
            "Different client pairs share nothing but the key, and the key admits one command.");
        Assert.AreEqual(
            2L,
            await CountAsync("ConversationParticipants", "\"TenantId\" = @id", ("id", workspace.TenantId)));
        Assert.AreEqual(1L, await CountAsync("CommandRecords", "\"IdempotencyKey\" = @key", ("key", key)));
    }

    /// <summary>
    /// The same key presented as two different command types. Neither aggregate lock is shared, so
    /// without the key boundary both would commit and the key would be spent twice.
    /// </summary>
    [TestMethod]
    public async Task OneKeyRacingAcrossDifferentCommandTypesAdmitsExactlyOne()
    {
        var workspace = await CreateWorkspaceAsync("keyacrosstypes");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        var sent = await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, "original");
        using var session = await SecondSessionAsync(workspace.CoachEmail, workspace.TenantId);
        var key = Guid.NewGuid();
        await RefreshCsrfAsync(workspace.Coach);

        Barrier.Arm(IdempotencyLockFragment, 2);
        var send = PostMessageAsync(workspace.Coach, conversation.Conversation.Id, "a new message", key);
        var edit = PostEditAsync(
            session,
            conversation.Conversation.Id,
            sent.Id,
            "an edited message",
            sent.Version,
            key);
        await Barrier.ArrivedAsync(2).WaitAsync(TimeSpan.FromSeconds(30));
        Barrier.Disarm();
        var responses = await Task.WhenAll(send, edit);

        Assert.AreEqual(2, Barrier.Arrived);
        await AssertOneWinnerOneConflictAsync(responses);
        Assert.AreEqual(1L, await CountAsync("CommandRecords", "\"IdempotencyKey\" = @key", ("key", key)));
        // Exactly one of the two mutations happened: either a second message exists, or the first
        // gained a second revision — never both.
        var messages = await MessageCountAsync(conversation.Conversation.Id);
        var revisions = await RevisionCountAsync(sent.Id);
        Assert.IsTrue(
            (messages == 2 && revisions == 1) || (messages == 1 && revisions == 2),
            $"Exactly one command may have written: {messages} messages, {revisions} revisions.");
    }

    [TestMethod]
    public async Task AChangedPayloadRacingTheOriginalConflictsWithoutASecondWrite()
    {
        var workspace = await CreateWorkspaceAsync("keychangedpayload");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        using var session = await SecondSessionAsync(workspace.CoachEmail, workspace.TenantId);
        var key = Guid.NewGuid();
        await RefreshCsrfAsync(workspace.Coach);

        Barrier.Arm(IdempotencyLockFragment, 2);
        var original = PostMessageAsync(workspace.Coach, conversation.Conversation.Id, "the original", key);
        var changed = PostMessageAsync(session, conversation.Conversation.Id, "something else", key);
        await Barrier.ArrivedAsync(2).WaitAsync(TimeSpan.FromSeconds(30));
        Barrier.Disarm();
        var responses = await Task.WhenAll(original, changed);

        Assert.AreEqual(2, Barrier.Arrived);
        await AssertOneWinnerOneConflictAsync(responses);
        Assert.AreEqual(1L, await MessageCountAsync(conversation.Conversation.Id));
        Assert.AreEqual(1L, await ConversationLastSequenceAsync(conversation.Conversation.Id));
        Assert.AreEqual(1L, await CountAsync("CommandRecords", "\"IdempotencyKey\" = @key", ("key", key)));
    }

    // ---------- 2. database invariants ----------

    [TestMethod]
    public async Task TheDatabaseRefusesAnArbitraryParticipantRole()
    {
        var workspace = await CreateWorkspaceAsync("rolecheck");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        var outsider = await AddSecondCoachAsync(workspace, "rolecheck");

        // The unique (TenantId, ConversationId, Role) index only prevents a duplicate of a role that
        // already exists. An unconstrained text column lets a third participant sit beside it under
        // any other spelling, which is a participant the domain has no concept of.
        var failure = await Assert.ThrowsExactlyAsync<PostgresException>(() => ExecuteAsync(
            """
            INSERT INTO messaging."ConversationParticipants"
                ("Id", "TenantId", "ConversationId", "UserId", "Role", "LastReadSequence",
                 "CreatedAtUtc", "UpdatedAtUtc")
            VALUES (@id, @tenantId, @conversationId, @userId, 'Observer', 0,
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            ("id", Guid.CreateVersion7()),
            ("tenantId", workspace.TenantId),
            ("conversationId", conversation.Conversation.Id),
            ("userId", outsider.UserId)));

        Assert.AreEqual("23514", failure.SqlState);
        Assert.AreEqual(
            2L,
            await CountAsync(
                "ConversationParticipants",
                "\"ConversationId\" = @id",
                ("id", conversation.Conversation.Id)));
    }

    [TestMethod]
    public async Task TheDatabaseRefusesUnknownPersistedEnumStrings()
    {
        var workspace = await CreateWorkspaceAsync("enumcheck");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        var sent = await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, "hello");

        await AssertCheckViolationAsync(
            """
            UPDATE messaging."Messages"
            SET "DeletedAtUtc" = CURRENT_TIMESTAMP, "DeletionKind" = 'Vaporised',
                "DeletedByUserId" = @userId
            WHERE "Id" = @id
            """,
            ("id", sent.Id),
            ("userId", workspace.CoachUserId));

        await AssertCheckViolationAsync(
            """
            INSERT INTO messaging."MessageDeletionEvents"
                ("Id", "TenantId", "ConversationId", "MessageId", "Kind", "ActorUserId",
                 "RevisionNumberAtRemoval", "OccurredAtUtc", "CreatedAtUtc", "UpdatedAtUtc")
            VALUES (@id, @tenantId, @conversationId, @messageId, 'Vaporised', @userId, 1,
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            ("id", Guid.CreateVersion7()),
            ("tenantId", workspace.TenantId),
            ("conversationId", conversation.Conversation.Id),
            ("messageId", sent.Id),
            ("userId", workspace.CoachUserId));

        await AssertCheckViolationAsync(
            """
            INSERT INTO messaging."CommandRecords"
                ("Id", "TenantId", "IdempotencyKey", "CommandType", "PayloadFingerprint",
                 "ActorUserId", "ConversationId", "MessageId", "RecordedAtUtc",
                 "CreatedAtUtc", "UpdatedAtUtc")
            VALUES (@id, @tenantId, @key, 'TeleportMessage', @fingerprint, @userId, @conversationId,
                    @messageId, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            ("id", Guid.CreateVersion7()),
            ("tenantId", workspace.TenantId),
            ("key", Guid.NewGuid()),
            ("fingerprint", new string('a', 64)),
            ("userId", workspace.CoachUserId),
            ("conversationId", conversation.Conversation.Id),
            ("messageId", sent.Id));
    }

    [TestMethod]
    public async Task TheDatabaseRefusesAMessageWithNoRevision()
    {
        var workspace = await CreateWorkspaceAsync("norevision");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);

        // A body lives only in a revision row, so a message without one is a message that says
        // nothing and can never be rendered.
        var failure = await Assert.ThrowsExactlyAsync<PostgresException>(() => InsertMessageAsync(
            workspace.TenantId,
            conversation.Conversation.Id,
            workspace.CoachUserId,
            1));

        Assert.AreEqual("23514", failure.SqlState);
        Assert.AreEqual(0L, await MessageCountAsync(conversation.Conversation.Id));
    }

    [TestMethod]
    public async Task TheDatabaseRefusesACurrentRevisionThatDoesNotExistOrSkipsANumber()
    {
        var workspace = await CreateWorkspaceAsync("revisionpointer");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        var sent = await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, "original");

        // Revision 2 does not exist.
        await AssertCheckViolationAsync(
            """UPDATE messaging."Messages" SET "CurrentRevisionNumber" = 2, "EditedAtUtc" = CURRENT_TIMESTAMP WHERE "Id" = @id""",
            ("id", sent.Id));

        // A revision numbered 3 with no revision 2 skips the chain the audit trail depends on.
        await AssertCheckViolationAsync(
            """
            WITH inserted AS (
                INSERT INTO messaging."MessageRevisions"
                    ("Id", "TenantId", "MessageId", "RevisionNumber", "Body", "AuthoredByUserId",
                     "AuthoredAtUtc", "CreatedAtUtc", "UpdatedAtUtc")
                VALUES (@revisionId, @tenantId, @messageId, 3, 'skipped', @userId,
                        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                RETURNING 1
            )
            UPDATE messaging."Messages"
            SET "CurrentRevisionNumber" = 3, "EditedAtUtc" = CURRENT_TIMESTAMP
            WHERE "Id" = @messageId
            """,
            ("revisionId", Guid.CreateVersion7()),
            ("tenantId", workspace.TenantId),
            ("messageId", sent.Id),
            ("userId", workspace.CoachUserId));

        Assert.AreEqual(1L, await RevisionCountAsync(sent.Id));
    }

    [TestMethod]
    public async Task TheDatabaseRefusesARevisionBeyondTheCurrentChain()
    {
        var workspace = await CreateWorkspaceAsync("revisionbeyondtip");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        var sent = await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, "original");

        // The message still declares revision 1. Inserting revision 2 by itself would leave audit
        // history ahead of the mutable root, even though the documented invariant is the exact
        // contiguous chain 1..CurrentRevisionNumber.
        await AssertCheckViolationAsync(
            """
            INSERT INTO messaging."MessageRevisions"
                ("Id", "TenantId", "MessageId", "RevisionNumber", "Body", "AuthoredByUserId",
                 "AuthoredAtUtc", "CreatedAtUtc", "UpdatedAtUtc")
            VALUES (@id, @tenantId, @messageId, 2, 'uncommitted future revision', @userId,
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            ("id", Guid.CreateVersion7()),
            ("tenantId", workspace.TenantId),
            ("messageId", sent.Id),
            ("userId", workspace.CoachUserId));

        Assert.AreEqual(1L, await RevisionCountAsync(sent.Id));
    }

    [TestMethod]
    public async Task TheDatabaseRefusesAdvancingTheConversationTipWithoutItsMessage()
    {
        var workspace = await CreateWorkspaceAsync("imaginarytip");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        var sent = await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, "only message");

        await AssertCheckViolationAsync(
            """
            UPDATE messaging."Conversations"
            SET "LastSequence" = 2, "LastMessageId" = @messageId
            WHERE "Id" = @conversationId
            """,
            ("messageId", sent.Id),
            ("conversationId", conversation.Conversation.Id));

        Assert.AreEqual(1L, await ConversationLastSequenceAsync(conversation.Conversation.Id));
    }

    [TestMethod]
    public async Task TheDatabaseRefusesAMessageBeyondTheConversationTip()
    {
        var workspace = await CreateWorkspaceAsync("messagebeyondtip");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, "first");
        var messageId = Guid.CreateVersion7();

        await AssertCheckViolationAsync(
            """
            WITH message AS (
                INSERT INTO messaging."Messages"
                    ("Id", "TenantId", "ConversationId", "SenderUserId", "Sequence", "SentAtUtc",
                     "AvailableAtUtc", "CurrentRevisionNumber", "CreatedAtUtc", "UpdatedAtUtc")
                VALUES (@messageId, @tenantId, @conversationId, @senderUserId, 2, CURRENT_TIMESTAMP,
                        CURRENT_TIMESTAMP, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                RETURNING "Id", "TenantId", "SenderUserId"
            )
            INSERT INTO messaging."MessageRevisions"
                ("Id", "TenantId", "MessageId", "RevisionNumber", "Body", "AuthoredByUserId",
                 "AuthoredAtUtc", "CreatedAtUtc", "UpdatedAtUtc")
            SELECT @revisionId, "TenantId", "Id", 1, 'not attached to the tip', "SenderUserId",
                   CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            FROM message
            """,
            ("messageId", messageId),
            ("revisionId", Guid.CreateVersion7()),
            ("tenantId", workspace.TenantId),
            ("conversationId", conversation.Conversation.Id),
            ("senderUserId", workspace.CoachUserId));

        Assert.AreEqual(1L, await MessageCountAsync(conversation.Conversation.Id));
        Assert.AreEqual(1L, await ConversationLastSequenceAsync(conversation.Conversation.Id));
    }

    [TestMethod]
    public async Task TheDatabaseRefusesARevisionAuthoredByAnybodyButTheSender()
    {
        var workspace = await CreateWorkspaceAsync("revisionauthor");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        var sent = await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, "mine");

        // Only the sender may edit, so only the sender can have authored any revision of it.
        var failure = await Assert.ThrowsExactlyAsync<PostgresException>(() => ExecuteAsync(
            """
            INSERT INTO messaging."MessageRevisions"
                ("Id", "TenantId", "MessageId", "RevisionNumber", "Body", "AuthoredByUserId",
                 "AuthoredAtUtc", "CreatedAtUtc", "UpdatedAtUtc")
            VALUES (@id, @tenantId, @messageId, 2, 'rewritten by somebody else', @userId,
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            ("id", Guid.CreateVersion7()),
            ("tenantId", workspace.TenantId),
            ("messageId", sent.Id),
            ("userId", workspace.ClientUserId)));

        Assert.IsTrue(
            failure.SqlState is "23503" or "23514",
            $"Expected a referential or check refusal, received {failure.SqlState}.");
        var onlyOriginal = new[] { "mine" };
        CollectionAssert.AreEqual(onlyOriginal, (await RevisionBodiesAsync(sent.Id)).ToArray());
    }

    [TestMethod]
    public async Task TheDatabaseRefusesADeletionEventNamingAnotherConversation()
    {
        var workspace = await CreateWorkspaceAsync("eventconversation");
        var first = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        var otherClient = await AddEntitledClientAsync(workspace, "eventconversation");
        var second = await StartConversationAsync(workspace.Coach, otherClient.ClientProfileId);
        var sent = await SendMessageAsync(workspace.Coach, first.Conversation.Id, "hello");

        var failure = await Assert.ThrowsExactlyAsync<PostgresException>(() => ExecuteAsync(
            """
            INSERT INTO messaging."MessageDeletionEvents"
                ("Id", "TenantId", "ConversationId", "MessageId", "Kind", "ActorUserId",
                 "RevisionNumberAtRemoval", "OccurredAtUtc", "CreatedAtUtc", "UpdatedAtUtc")
            VALUES (@id, @tenantId, @conversationId, @messageId, 'SenderRemoved', @userId, 1,
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            ("id", Guid.CreateVersion7()),
            ("tenantId", workspace.TenantId),
            ("conversationId", second.Conversation.Id),
            ("messageId", sent.Id),
            ("userId", workspace.CoachUserId)));

        Assert.IsTrue(
            failure.SqlState is "23503" or "23514",
            $"Expected a referential or check refusal, received {failure.SqlState}.");
    }

    [TestMethod]
    public async Task TheDatabaseRefusesACommandRecordNamingAnotherConversationsMessage()
    {
        var workspace = await CreateWorkspaceAsync("commandconversation");
        var first = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        var otherClient = await AddEntitledClientAsync(workspace, "commandconversation");
        var second = await StartConversationAsync(workspace.Coach, otherClient.ClientProfileId);
        var sent = await SendMessageAsync(workspace.Coach, first.Conversation.Id, "hello");

        var failure = await Assert.ThrowsExactlyAsync<PostgresException>(() => ExecuteAsync(
            """
            INSERT INTO messaging."CommandRecords"
                ("Id", "TenantId", "IdempotencyKey", "CommandType", "PayloadFingerprint",
                 "ActorUserId", "ConversationId", "MessageId", "RecordedAtUtc",
                 "CreatedAtUtc", "UpdatedAtUtc")
            VALUES (@id, @tenantId, @key, 'SendMessage', @fingerprint, @userId, @conversationId,
                    @messageId, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            ("id", Guid.CreateVersion7()),
            ("tenantId", workspace.TenantId),
            ("key", Guid.NewGuid()),
            ("fingerprint", new string('b', 64)),
            ("userId", workspace.CoachUserId),
            ("conversationId", second.Conversation.Id),
            ("messageId", sent.Id)));

        Assert.IsTrue(
            failure.SqlState is "23503" or "23514",
            $"Expected a referential or check refusal, received {failure.SqlState}.");
    }

    [TestMethod]
    public async Task TheDatabaseRefusesRemovalStateWithoutAMatchingEvent()
    {
        var workspace = await CreateWorkspaceAsync("removalagreement");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        var sent = await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, "hello");

        // Removal state with no event at all: the fact of who removed it and why would be lost.
        await AssertCheckViolationAsync(
            """
            UPDATE messaging."Messages"
            SET "DeletedAtUtc" = CURRENT_TIMESTAMP, "DeletionKind" = 'SenderRemoved',
                "DeletedByUserId" = @userId
            WHERE "Id" = @id
            """,
            ("id", sent.Id),
            ("userId", workspace.CoachUserId));

        // An event describing a message nobody removed: a body would be hidden with no state saying
        // so, and the two records of one fact would disagree.
        await AssertCheckViolationAsync(
            """
            INSERT INTO messaging."MessageDeletionEvents"
                ("Id", "TenantId", "ConversationId", "MessageId", "Kind", "ActorUserId",
                 "RevisionNumberAtRemoval", "OccurredAtUtc", "CreatedAtUtc", "UpdatedAtUtc")
            VALUES (@eventId, @tenantId, @conversationId, @messageId, 'SenderRemoved', @clientId,
                    1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            ("eventId", Guid.CreateVersion7()),
            ("tenantId", workspace.TenantId),
            ("conversationId", conversation.Conversation.Id),
            ("messageId", sent.Id),
            ("clientId", workspace.ClientUserId));

        Assert.IsFalse(
            (await GetMessagesAsync(workspace.Coach, conversation.Conversation.Id)).Items.Single().IsDeleted);
    }

    [TestMethod]
    public async Task TheRemovalTupleIsImmutableOnceAMessageIsRemoved()
    {
        var workspace = await CreateWorkspaceAsync("removalimmutable");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        var fromClient = await SendMessageAsync(workspace.Client, conversation.Conversation.Id, "client text");
        await RefreshCsrfAsync(workspace.Coach);
        await AssertStatusAsync(
            await PostModerateAsync(
                workspace.Coach,
                conversation.Conversation.Id,
                fromClient.Id,
                "Off topic",
                fromClient.Version),
            HttpStatusCode.OK);

        // Who removed it and why are as much a part of the record as the fact that it happened.
        await AssertCheckViolationAsync(
            """UPDATE messaging."Messages" SET "DeletedByUserId" = @userId WHERE "Id" = @id""",
            ("id", fromClient.Id),
            ("userId", workspace.ClientUserId));
        await AssertCheckViolationAsync(
            """UPDATE messaging."Messages" SET "ModerationReason" = 'a different reason' WHERE "Id" = @id""",
            ("id", fromClient.Id));

        Assert.AreEqual(
            1L,
            await CountAsync(
                "MessageDeletionEvents",
                "\"MessageId\" = @id AND \"Reason\" = 'Off topic' AND \"ActorUserId\" = @actor",
                ("id", fromClient.Id),
                ("actor", workspace.CoachUserId)));
    }

    [TestMethod]
    public async Task TheDatabaseRefusesAReadCursorBeyondTheNewestCommittedSequence()
    {
        var workspace = await CreateWorkspaceAsync("cursorceiling");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, "one");

        // The application clamps. A repair script does not, and a cursor past the tip would silently
        // hide the next message that arrives.
        await AssertCheckViolationAsync(
            """
            UPDATE messaging."ConversationParticipants"
            SET "LastReadSequence" = 99, "LastReadAtUtc" = CURRENT_TIMESTAMP
            WHERE "ConversationId" = @id AND "UserId" = @userId
            """,
            ("id", conversation.Conversation.Id),
            ("userId", workspace.ClientUserId));

        Assert.AreEqual(0L, await ReadCursorAsync(conversation.Conversation.Id, workspace.ClientUserId));
    }

    // ---------- 3. authorization before validation ----------

    [TestMethod]
    public async Task AnInvalidPayloadAgainstAnUnreachableConversationIsStillNotFound()
    {
        var workspace = await CreateWorkspaceAsync("orderalpha");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        var sent = await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, "private");
        var outsider = await AddSecondCoachAsync(workspace, "orderalpha");
        var otherWorkspace = await CreateWorkspaceAsync("orderbeta");
        var unknownConversation = Guid.CreateVersion7();

        // Three callers who must all be told the same thing, and three payloads that would each be
        // refused on their own merits if the handler validated first. Validating before resolving
        // tells a stranger that the identifier is real.
        foreach (var (caller, label) in new[]
                 {
                     (workspace.Coach, "unknown conversation"),
                     (outsider.Client, "same-workspace non-participant"),
                     (otherWorkspace.Coach, "another workspace"),
                 })
        {
            await RefreshCsrfAsync(caller);
            var target = label == "unknown conversation" ? unknownConversation : conversation.Conversation.Id;

            await AssertStatusAsync(
                await GetMessagesResponseAsync(caller, target, beforeSequence: 0),
                HttpStatusCode.NotFound);
            await AssertStatusAsync(
                await GetMessagesResponseAsync(caller, target, beforeSequence: -5),
                HttpStatusCode.NotFound);
            await AssertStatusAsync(
                await PostReadAsync(caller, target, -1),
                HttpStatusCode.NotFound);
            await AssertStatusAsync(
                await PostModerateAsync(caller, target, sent.Id, "   ", sent.Version),
                HttpStatusCode.NotFound);
            await AssertStatusAsync(
                await PostMessageAsync(caller, target, "   "),
                HttpStatusCode.NotFound);
        }
    }

    [TestMethod]
    public async Task ADeniedParticipantSendingAnInvalidPayloadStillGetsTheStableRefusal()
    {
        var workspace = await CreateWorkspaceAsync("orderdenied");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, "before the block");
        await BlockClientAsync(workspace.Coach, workspace.ClientProfileId);
        await RefreshCsrfAsync(workspace.Coach);

        // A known participant is not a stranger, so they keep the explained refusal rather than a
        // 404 — and the invalid payload does not change which refusal they get.
        Assert.AreEqual(
            "RelationshipBlocked",
            await AccessReasonAsync(
                await GetMessagesResponseAsync(workspace.Coach, conversation.Conversation.Id, beforeSequence: 0)));
        Assert.AreEqual(
            "RelationshipBlocked",
            await AccessReasonAsync(await PostReadAsync(workspace.Coach, conversation.Conversation.Id, -1)));
        Assert.AreEqual(
            "RelationshipBlocked",
            await AccessReasonAsync(
                await PostModerateAsync(
                    workspace.Coach,
                    conversation.Conversation.Id,
                    Guid.CreateVersion7(),
                    "   ",
                    1)));
    }

    /// <summary>
    /// An unavailable conversation must be refused before its bodies are read, not read and then
    /// redacted. A SQL interceptor counts what the listing actually asked the database for.
    /// </summary>
    [TestMethod]
    public async Task ListingAnUnavailableConversationNeverReadsItsMessageBodies()
    {
        var workspace = await CreateWorkspaceAsync("listingorder");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        await SendMessageAsync(workspace.Coach, conversation.Conversation.Id, "a private sentence");
        await BlockClientAsync(workspace.Coach, workspace.ClientProfileId);

        Recorder.Clear();
        var listed = await ListConversationsAsync(workspace.Coach);

        var summary = listed.Items.Single();
        Assert.IsFalse(summary.IsAvailable);
        Assert.AreEqual("RelationshipBlocked", summary.AccessReason);
        Assert.IsNull(summary.LastMessage);
        Assert.AreEqual(0L, summary.UnreadCount);
        Assert.IsFalse(
            Recorder.Touched("messaging.\"MessageRevisions\""),
            "An unavailable conversation's bodies were fetched and then suppressed.");
        Assert.IsFalse(
            Recorder.Touched("messaging.\"Messages\""),
            "An unavailable conversation's messages were queried before the refusal was known.");
    }

    [TestMethod]
    public async Task ListingAnAvailableConversationStillReadsItsPreviewAndUnreadCount()
    {
        var workspace = await CreateWorkspaceAsync("listingavailable");
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        await SendMessageAsync(workspace.Client, conversation.Conversation.Id, "a reply");

        Recorder.Clear();
        var listed = await ListConversationsAsync(workspace.Coach);

        var summary = listed.Items.Single();
        Assert.IsTrue(summary.IsAvailable);
        Assert.AreEqual("a reply", summary.LastMessage!.Body);
        Assert.AreEqual(1L, summary.UnreadCount);
        Assert.IsTrue(
            Recorder.Touched("messaging.\"MessageRevisions\""),
            "An available conversation still needs its preview body.");
    }

    // ---------- helpers ----------

    /// <summary>
    /// Exactly one of two racing responses succeeded and the other received the stable idempotency
    /// conflict. Neither may be a 500: a unique-constraint violation is an implementation detail.
    /// </summary>
    private static async Task AssertOneWinnerOneConflictAsync(HttpResponseMessage[] responses)
    {
        var statuses = responses.Select(response => response.StatusCode).ToArray();
        foreach (var status in statuses)
        {
            Assert.AreNotEqual(
                HttpStatusCode.InternalServerError,
                status,
                "A contended idempotency key must never surface as a server error.");
        }

        Assert.AreEqual(
            1,
            statuses.Count(status => status == HttpStatusCode.OK),
            $"Exactly one request may win; received {string.Join(", ", statuses)}.");
        var loser = responses.Single(response => response.StatusCode != HttpStatusCode.OK);
        Assert.AreEqual("messaging_idempotency_key_reused", await ConflictCodeAsync(loser));
    }

    private async Task AssertCheckViolationAsync(string sql, params (string Name, object Value)[] parameters)
    {
        var failure = await Assert.ThrowsExactlyAsync<PostgresException>(() => ExecuteAsync(sql, parameters));
        Assert.AreEqual("23514", failure.SqlState, $"Expected a check or trigger refusal for: {sql}");
    }
}
