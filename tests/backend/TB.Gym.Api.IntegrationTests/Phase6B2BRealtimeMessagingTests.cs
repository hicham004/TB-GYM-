using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using TB.Gym.Modules.Messaging;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Phase 6B-2B against real PostgreSQL: the durable event, the claim, the authorization recheck, the
/// catch-up cursor and the application acknowledgement.
/// </summary>
/// <remarks>
/// Real PostgreSQL because almost everything here is a property of it: an event sequence allocated
/// under a row lock, a claim taken with <c>FOR UPDATE SKIP LOCKED</c>, a deferred constraint trigger
/// that can only be true at commit, and a unique index that turns a concurrent duplicate
/// acknowledgement into one fact. None of that is provable against an in-memory provider.
/// </remarks>
[TestClass]
public sealed partial class Phase6B2BRealtimeMessagingTests
{
    private static readonly long[] ExpectedSevenPositions = [1L, 2L, 3L, 4L, 5L, 6L, 7L];

    private static readonly long[] ExpectedThreePositions = [1L, 2L, 3L];

    private static readonly string[] ExpectedEventKinds =
    [
        "ConversationCreated",
        "MessageSent",
        "MessageEdited",
        "MessageSent",
        "MessageCoachModerated",
        "MessageSent",
        "MessageSenderRemoved",
    ];

    // ---------- one event per externally visible mutation ----------

    [TestMethod]
    public async Task CreatingAConversationCommitsOneEventAddressedToBothParticipants()
    {
        var workspace = await CreateWorkspaceAsync("create");

        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        var conversationId = conversation.Conversation.Id;

        var events = await EventsAsync(conversationId);
        Assert.HasCount(1, events);
        Assert.AreEqual(1L, events[0].EventSequence);
        Assert.AreEqual("ConversationCreated", events[0].Kind);
        Assert.IsNull(events[0].MessageId, "A conversation creation is about no message.");
        Assert.AreEqual(1L, await ConversationEventTipAsync(conversationId));

        var recipients = await RecipientsAsync(conversationId);
        CollectionAssert.AreEquivalent(
            new[] { workspace.CoachUserId, workspace.ClientUserId },
            recipients.Select(recipient => recipient.RecipientUserId).ToArray(),
            "Both participants get publication state, including the coach who created it.");
        Assert.IsTrue(recipients.All(recipient => recipient.Status == "Pending"));
        Assert.IsTrue(recipients.All(recipient => recipient.AttemptCount == 0));
    }

    [TestMethod]
    public async Task EachCommandKindCommitsExactlyOneCorrectlyShapedEvent()
    {
        var thread = await OpenThreadAsync("kinds");
        var sent = await SendMessageAsync(thread.Coach, thread.ConversationId, "first");
        var edited = await EditMessageAsync(
            thread.Coach,
            thread.ConversationId,
            sent.Id,
            "first, corrected",
            sent.Version);
        var clientMessage = await SendMessageAsync(thread.Client, thread.ConversationId, "a reply");
        await ModerateMessageAsync(
            thread.Coach,
            thread.ConversationId,
            clientMessage.Id,
            "off topic",
            clientMessage.Version);
        var ownMessage = await SendMessageAsync(thread.Coach, thread.ConversationId, "mine to remove");
        await DeleteMessageAsync(thread.Coach, thread.ConversationId, ownMessage.Id, ownMessage.Version);

        var events = await EventsAsync(thread.ConversationId);

        CollectionAssert.AreEqual(
            ExpectedEventKinds,
            events.Select(item => item.Kind).ToArray(),
            "Every externally visible mutation commits exactly one event, in commit order.");
        CollectionAssert.AreEqual(
            ExpectedSevenPositions,
            events.Select(item => item.EventSequence).ToArray(),
            "Event positions are gap-free.");
        Assert.AreEqual(7L, await ConversationEventTipAsync(thread.ConversationId));

        // The edit is the load-bearing one: a new event position for an old message position.
        var editEvent = events[2];
        Assert.AreEqual(sent.Id, editEvent.MessageId);
        Assert.AreEqual(1L, editEvent.MessageSequence, "The message keeps the position it has always had.");
        Assert.AreEqual(2, editEvent.MessageRevisionNumber);
        Assert.AreEqual(3L, editEvent.EventSequence);

        Assert.AreEqual(
            events.Count * 2,
            (int)await RecipientCountAsync(thread.ConversationId),
            "Two participants, so two publication rows per event.");
        Assert.AreEqual(2, edited.RevisionNumber);
    }

    /// <summary>
    /// The reason the two counters exist, over HTTP: an edit of an old message must be reachable from
    /// an event cursor that has already passed newer messages.
    /// </summary>
    [TestMethod]
    public async Task AnOldMessageEditAppearsAtTheNewEventCursorWithItsOriginalMessagePosition()
    {
        var thread = await OpenThreadAsync("old-edit");
        var first = await SendMessageAsync(thread.Coach, thread.ConversationId, "the first thing");
        await SendMessageAsync(thread.Coach, thread.ConversationId, "the second thing");
        await SendMessageAsync(thread.Coach, thread.ConversationId, "the third thing");

        // A client that is up to date with everything so far.
        var caughtUp = await GetRealtimeEventsAsync(thread.Client, thread.ConversationId);
        var cursor = caughtUp.LatestEventSequence;

        await EditMessageAsync(
            thread.Coach,
            thread.ConversationId,
            first.Id,
            "the first thing, corrected",
            first.Version);

        var page = await GetRealtimeEventsAsync(thread.Client, thread.ConversationId, cursor);

        Assert.HasCount(1, page.Items);
        var edit = page.Items[0];
        Assert.AreEqual("MessageEdited", edit.Kind);
        Assert.AreEqual(cursor + 1, edit.EventSequence);
        Assert.IsNotNull(edit.Message);
        Assert.AreEqual(
            1L,
            edit.Message.Sequence,
            "Resuming from a message sequence would never have asked for this; the message is behind the tip.");
        Assert.AreEqual("the first thing, corrected", edit.Message.Body);
        Assert.AreEqual(2, edit.Message.RevisionNumber);
    }

    // ---------- idempotency ----------

    [TestMethod]
    public async Task AnIdenticalRetryReplaysTheResultAndAllocatesNoSecondEvent()
    {
        var thread = await OpenThreadAsync("retry");
        var key = Guid.NewGuid();

        var first = await SendMessageAsync(thread.Coach, thread.ConversationId, "say it once", key);
        var replay = await SendMessageAsync(thread.Coach, thread.ConversationId, "say it once", key);

        Assert.AreEqual(first.Id, replay.Id);
        var events = await EventsAsync(thread.ConversationId);
        Assert.HasCount(2, events, "The creation and one send; a replay writes no second event.");
        Assert.AreEqual(2L, await ConversationEventTipAsync(thread.ConversationId));
    }

    [TestMethod]
    public async Task ConcurrentIdenticalRetriesCommitOneEvent()
    {
        var thread = await OpenThreadAsync("concurrent-retry");
        var second = await SecondSessionAsync(thread.Workspace.CoachEmail, thread.Workspace.TenantId);
        var key = Guid.NewGuid();

        // Both requests are held at the idempotency-key lock, so they really do contend on it rather
        // than happening to interleave.
        Barrier.Arm("messaging-idempotency", 2);
        var firstCall = PostMessageAsync(thread.Coach, thread.ConversationId, "exactly once", key);
        var secondCall = PostMessageAsync(second, thread.ConversationId, "exactly once", key);
        await Barrier.ArrivedAsync(2);
        var responses = await Task.WhenAll(firstCall, secondCall);
        Barrier.Disarm();

        Assert.AreEqual(2, Barrier.Arrived, "Both requests must have reached the key lock.");
        foreach (var response in responses)
        {
            await AssertStatusAsync(response, HttpStatusCode.OK);
        }

        var events = await EventsAsync(thread.ConversationId);
        Assert.HasCount(2, events, "One creation and one send, whichever request won.");
        Assert.AreEqual(2L, await ConversationEventTipAsync(thread.ConversationId));
        Assert.AreEqual(4L, await RecipientCountAsync(thread.ConversationId));
    }

    [TestMethod]
    public async Task AConflictingKeyReuseWritesNoEventAtAll()
    {
        var thread = await OpenThreadAsync("key-reuse");
        var key = Guid.NewGuid();
        await SendMessageAsync(thread.Coach, thread.ConversationId, "the original", key);
        var before = await EventsAsync(thread.ConversationId);

        await RefreshCsrfAsync(thread.Coach);
        var conflict = await PostMessageAsync(thread.Coach, thread.ConversationId, "something else", key);

        await AssertStatusAsync(conflict, HttpStatusCode.Conflict);
        var after = await EventsAsync(thread.ConversationId);
        Assert.HasCount(before.Count, after, "A conflicting reuse writes nothing, including no event.");
    }

    /// <summary>
    /// A removal repeated against an already-removed message satisfies the caller and changes
    /// nothing, so it must allocate no event for the other side to reconcile.
    /// </summary>
    [TestMethod]
    public async Task ARepeatedRemovalAllocatesNoSecondEvent()
    {
        var thread = await OpenThreadAsync("repeat-removal");
        var message = await SendMessageAsync(thread.Coach, thread.ConversationId, "take this back");
        await DeleteMessageAsync(thread.Coach, thread.ConversationId, message.Id, message.Version);
        var afterFirst = await EventsAsync(thread.ConversationId);

        var current = (await GetMessagesAsync(thread.Coach, thread.ConversationId))
            .Items.Single(item => item.Id == message.Id);
        await DeleteMessageAsync(thread.Coach, thread.ConversationId, message.Id, current.Version);

        var afterSecond = await EventsAsync(thread.ConversationId);
        Assert.HasCount(afterFirst.Count, afterSecond);
    }

    /// <summary>
    /// A fresh key against a conversation that already exists returns it and changes nothing
    /// externally visible, so it must not announce a creation the other side already had.
    /// </summary>
    [TestMethod]
    public async Task RecreatingAnExistingConversationAllocatesNoSecondEvent()
    {
        var workspace = await CreateWorkspaceAsync("recreate");
        var first = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);

        var second = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);

        Assert.AreEqual(first.Conversation.Id, second.Conversation.Id);
        Assert.AreEqual(1L, await EventCountAsync(first.Conversation.Id));
    }

    /// <summary>
    /// A rolled-back command leaves no event, no publication state and no attempt, and gives its
    /// event position back.
    /// </summary>
    /// <remarks>
    /// The commit is failed after every statement in the transaction has run, so the message, its
    /// revision, the conversation tip, the event and both recipient rows have all been written and
    /// the transaction still has to leave none of them behind. An allocator that leaked its number
    /// would leave a hole a catch-up cursor could never get past.
    /// </remarks>
    [TestMethod]
    public async Task AFailedCommitLeavesNoEventAndReturnsItsEventPosition()
    {
        var thread = await OpenThreadAsync("rollback");
        var tipBefore = await ConversationEventTipAsync(thread.ConversationId);
        var eventsBefore = await EventCountAsync(thread.ConversationId);
        var recipientsBefore = await RecipientCountAsync(thread.ConversationId);

        Commits.ArmOnce();
        await RefreshCsrfAsync(thread.Coach);
        var failed = await PostMessageAsync(thread.Coach, thread.ConversationId, "never committed");
        Commits.Disarm();

        Assert.IsTrue(Commits.Fired, "The commit fault must actually have fired.");
        Assert.AreNotEqual(HttpStatusCode.OK, failed.StatusCode);
        Assert.AreEqual(eventsBefore, await EventCountAsync(thread.ConversationId));
        Assert.AreEqual(recipientsBefore, await RecipientCountAsync(thread.ConversationId));
        Assert.AreEqual(
            tipBefore,
            await ConversationEventTipAsync(thread.ConversationId),
            "The allocator gives a rolled-back number back rather than leaving a hole.");

        // The next command takes the position the failed one would have had.
        var sent = await SendMessageAsync(thread.Coach, thread.ConversationId, "committed instead");
        var events = await EventsAsync(thread.ConversationId);
        Assert.AreEqual(tipBefore + 1, events[^1].EventSequence);
        Assert.AreEqual(sent.Id, events[^1].MessageId);
        Assert.AreEqual(tipBefore + 1, await ConversationEventTipAsync(thread.ConversationId));

        var outcome = await SweepAsync();
        Assert.AreEqual(
            0,
            outcome.DeadLettered,
            "Nothing was left behind for a sweep to fail on.");
    }

    // ---------- concurrency ----------

    [TestMethod]
    public async Task ConcurrentSendsAllocateUniqueGapFreeEventPositionsInCommitOrder()
    {
        var thread = await OpenThreadAsync("concurrent-send");

        // Both tokens refreshed first. An antiforgery token is bound to the signed-in principal, and
        // the client's was minted before it accepted the invitation and signed in — so without this
        // the client's send is refused before it ever reaches the lock, and the barrier waits for an
        // arrival that is never coming.
        await RefreshCsrfAsync(thread.Coach);
        await RefreshCsrfAsync(thread.Client);

        // Both senders are held at the conversation row lock, which is where the event position is
        // allocated as well as the message sequence.
        Barrier.Arm("messaging-sequence", 2);
        var coachSend = PostMessageAsync(thread.Coach, thread.ConversationId, "from the coach");
        var clientSend = PostMessageAsync(thread.Client, thread.ConversationId, "from the client");
        await Barrier.ArrivedAsync(2);
        var responses = await Task.WhenAll(coachSend, clientSend);
        Barrier.Disarm();

        Assert.AreEqual(2, Barrier.Arrived);
        foreach (var response in responses)
        {
            await AssertStatusAsync(response, HttpStatusCode.OK);
        }

        var events = await EventsAsync(thread.ConversationId);
        CollectionAssert.AreEqual(
            ExpectedThreePositions,
            events.Select(item => item.EventSequence).ToArray(),
            "Two senders racing produce two different positions with no gap.");
        Assert.AreEqual(3L, await ConversationEventTipAsync(thread.ConversationId));
    }

    // ---------- database protections ----------

    [TestMethod]
    public async Task TheDatabaseRefusesAnEventPositionGap()
    {
        var thread = await OpenThreadAsync("gap");
        var sourceCommand = await UnusedCommandRecordAsync(thread);

        var rejection = await ExpectRejectionAsync(
            """
            INSERT INTO messaging."RealtimeEvents"
                ("Id", "TenantId", "ConversationId", "EventSequence", "Kind", "MessageId",
                 "MessageSequence", "MessageRevisionNumber", "SourceCommandRecordId", "OccurredAtUtc",
                 "CreatedAtUtc", "UpdatedAtUtc")
            VALUES (@id, @tenantId, @conversationId, 900, 'MessageSenderRemoved', @messageId,
                    @messageSequence, 1, @sourceCommand, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
                    CURRENT_TIMESTAMP)
            """,
            ("id", Guid.CreateVersion7()),
            ("tenantId", thread.Workspace.TenantId),
            ("conversationId", thread.ConversationId),
            ("messageId", await ScalarAsync<Guid>(
                """SELECT "MessageId" FROM messaging."CommandRecords" WHERE "Id" = @id""",
                ("id", sourceCommand))),
            ("messageSequence", await ScalarAsync<long>(
                """
                SELECT m."Sequence" FROM messaging."Messages" m
                JOIN messaging."CommandRecords" r ON r."MessageId" = m."Id"
                WHERE r."Id" = @id
                """,
                ("id", sourceCommand))),
            ("sourceCommand", sourceCommand));

        Assert.Contains("gap", rejection.MessageText, StringComparison.OrdinalIgnoreCase);
    }

    [TestMethod]
    public async Task TheDatabaseRefusesAnEventTipThatDoesNotIdentifyTheNewestEvent()
    {
        var thread = await OpenThreadAsync("tip");

        var rejection = await ExpectRejectionAsync(
            """
            UPDATE messaging."Conversations" SET "LastEventSequence" = "LastEventSequence" + 1
            WHERE "Id" = @id
            """,
            ("id", thread.ConversationId));

        Assert.Contains("event tip", rejection.MessageText, StringComparison.OrdinalIgnoreCase);
    }

    [TestMethod]
    public async Task TheDatabaseRefusesAnEventAllocatorThatJumpsOrRewinds()
    {
        var thread = await OpenThreadAsync("allocator");

        var jump = await ExpectRejectionAsync(
            """UPDATE messaging."Conversations" SET "LastEventSequence" = 40 WHERE "Id" = @id""",
            ("id", thread.ConversationId));
        Assert.Contains("one position at a time", jump.MessageText, StringComparison.OrdinalIgnoreCase);

        var rewind = await ExpectRejectionAsync(
            """UPDATE messaging."Conversations" SET "LastEventSequence" = 0 WHERE "Id" = @id""",
            ("id", thread.ConversationId));
        Assert.Contains("backwards", rewind.MessageText, StringComparison.OrdinalIgnoreCase);
    }

    [TestMethod]
    public async Task TheDatabaseRefusesAForgedRecipientForANonParticipant()
    {
        var thread = await OpenThreadAsync("forged-recipient");
        var stranger = await AddSecondCoachAsync(thread.Workspace, "stranger");
        var eventId = (await EventsAsync(thread.ConversationId))[0].Id;

        var rejection = await ExpectRejectionAsync(
            """
            INSERT INTO messaging."RealtimeRecipients"
                ("Id", "TenantId", "ConversationId", "RealtimeEventId", "RecipientUserId", "Status",
                 "AttemptCount", "NextAttemptAtUtc", "CreatedAtUtc", "UpdatedAtUtc")
            VALUES (@id, @tenantId, @conversationId, @eventId, @userId, 'Pending', 0,
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            ("id", Guid.CreateVersion7()),
            ("tenantId", thread.Workspace.TenantId),
            ("conversationId", thread.ConversationId),
            ("eventId", eventId),
            ("userId", stranger.UserId));

        Assert.AreEqual(
            PostgresErrorCodesForeignKey,
            rejection.SqlState,
            "A recipient who is not an explicit participant is refused by referential integrity.");
    }

    [TestMethod]
    public async Task TheDatabaseRefusesACrossTenantEventReference()
    {
        var first = await OpenThreadAsync("tenant-a");
        var second = await OpenThreadAsync("tenant-b");
        var foreignCommand = await ScalarAsync<Guid>(
            """SELECT "Id" FROM messaging."CommandRecords" WHERE "ConversationId" = @id LIMIT 1""",
            ("id", second.ConversationId));

        var rejection = await ExpectRejectionAsync(
            """
            INSERT INTO messaging."RealtimeEvents"
                ("Id", "TenantId", "ConversationId", "EventSequence", "Kind", "MessageId",
                 "MessageSequence", "MessageRevisionNumber", "SourceCommandRecordId", "OccurredAtUtc",
                 "CreatedAtUtc", "UpdatedAtUtc")
            VALUES (@id, @tenantId, @conversationId, 2, 'ConversationCreated', NULL, NULL, NULL,
                    @sourceCommand, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            ("id", Guid.CreateVersion7()),
            ("tenantId", first.Workspace.TenantId),
            ("conversationId", first.ConversationId),
            ("sourceCommand", foreignCommand));

        Assert.AreEqual(
            PostgresErrorCodesForeignKey,
            rejection.SqlState,
            "An event cannot name another workspace's command record.");
    }

    [TestMethod]
    public async Task TheDatabaseRefusesADeletedOrRewrittenAttemptAndAcknowledgement()
    {
        var thread = await OpenThreadAsync("append-only");
        await SweepAsync();
        var recipient = (await RecipientsAsync(thread.ConversationId))[0];
        var attempts = await AttemptsAsync(recipient.Id);
        Assert.HasCount(1, attempts);

        var rewritten = await ExpectRejectionAsync(
            """UPDATE messaging."RealtimeAttempts" SET "Outcome" = 'Published' WHERE "RecipientId" = @id""",
            ("id", recipient.Id));
        Assert.Contains("immutable", rewritten.MessageText, StringComparison.OrdinalIgnoreCase);

        var deleted = await ExpectRejectionAsync(
            """DELETE FROM messaging."RealtimeAttempts" WHERE "RecipientId" = @id""",
            ("id", recipient.Id));
        Assert.Contains("never deleted", deleted.MessageText, StringComparison.OrdinalIgnoreCase);

        await AcknowledgeAsync(thread.Client, thread.ConversationId, 1);
        var movedAck = await ExpectRejectionAsync(
            """
            UPDATE messaging."RealtimeAcknowledgements"
            SET "AcknowledgedAtUtc" = CURRENT_TIMESTAMP WHERE "ConversationId" = @id
            """,
            ("id", thread.ConversationId));
        Assert.Contains("immutable once written", movedAck.MessageText, StringComparison.OrdinalIgnoreCase);

        var deletedAck = await ExpectRejectionAsync(
            """DELETE FROM messaging."RealtimeAcknowledgements" WHERE "ConversationId" = @id""",
            ("id", thread.ConversationId));
        Assert.Contains("never deleted", deletedAck.MessageText, StringComparison.OrdinalIgnoreCase);

        // The event itself is immutable too: it is the position a client resumes from.
        var rewrittenEvent = await ExpectRejectionAsync(
            """UPDATE messaging."RealtimeEvents" SET "EventSequence" = 99 WHERE "ConversationId" = @id""",
            ("id", thread.ConversationId));
        Assert.Contains("immutable once written", rewrittenEvent.MessageText, StringComparison.OrdinalIgnoreCase);
    }

    [TestMethod]
    public async Task TheDatabaseRefusesAnAttemptAboveTheCeilingAndAnInvalidStatusCombination()
    {
        var thread = await OpenThreadAsync("invalid-state");
        var recipient = (await RecipientsAsync(thread.ConversationId))[0];

        var tooMany = await ExpectRejectionAsync(
            """UPDATE messaging."RealtimeRecipients" SET "AttemptCount" = 21 WHERE "Id" = @id""",
            ("id", recipient.Id));
        Assert.AreEqual(PostgresErrorCodesCheckViolation, tooMany.SqlState);

        // Published with no publication instant, and a terminal row still carrying a live claim, are
        // both states the dispatcher's correctness depends on being impossible.
        var noInstant = await ExpectRejectionAsync(
            """UPDATE messaging."RealtimeRecipients" SET "Status" = 'Published' WHERE "Id" = @id""",
            ("id", recipient.Id));
        Assert.AreEqual(PostgresErrorCodesCheckViolation, noInstant.SqlState);

        var liveClaimOnTerminal = await ExpectRejectionAsync(
            """
            UPDATE messaging."RealtimeRecipients"
            SET "Status" = 'DeadLettered', "CompletedAtUtc" = CURRENT_TIMESTAMP,
                "FailureCode" = 'x', "ClaimToken" = gen_random_uuid(),
                "ClaimExpiresAtUtc" = CURRENT_TIMESTAMP
            WHERE "Id" = @id
            """,
            ("id", recipient.Id));
        Assert.AreEqual(PostgresErrorCodesCheckViolation, liveClaimOnTerminal.SqlState);
    }

    [TestMethod]
    public async Task TheDatabaseRefusesReopeningATerminalPublication()
    {
        var thread = await OpenThreadAsync("terminal");
        await SweepAsync();
        var recipient = (await RecipientsAsync(thread.ConversationId))[0];
        Assert.AreEqual("Published", recipient.Status);

        var rejection = await ExpectRejectionAsync(
            """
            UPDATE messaging."RealtimeRecipients"
            SET "Status" = 'Pending', "PublishedAtUtc" = NULL, "CompletedAtUtc" = NULL
            WHERE "Id" = @id
            """,
            ("id", recipient.Id));

        Assert.Contains("terminal", rejection.MessageText, StringComparison.OrdinalIgnoreCase);
    }

    [TestMethod]
    public async Task TheDatabaseRefusesAClaimThatDoesNotConsumeAnAttempt()
    {
        var thread = await OpenThreadAsync("claim-attempt");
        var recipient = (await RecipientsAsync(thread.ConversationId))[0];

        var rejection = await ExpectRejectionAsync(
            """
            UPDATE messaging."RealtimeRecipients"
            SET "Status" = 'Processing', "ClaimToken" = gen_random_uuid(),
                "ClaimExpiresAtUtc" = CURRENT_TIMESTAMP + interval '1 minute'
            WHERE "Id" = @id
            """,
            ("id", recipient.Id));

        Assert.Contains("exactly one attempt", rejection.MessageText, StringComparison.OrdinalIgnoreCase);
    }

    [TestMethod]
    public async Task TheDatabaseRefusesAnEventWhoseSourceCommandNamesAnotherMessage()
    {
        var thread = await OpenThreadAsync("event-source");
        var first = await SendMessageAsync(thread.Coach, thread.ConversationId, "first");
        var sourceCommand = await UnusedCommandRecordAsync(thread);
        var tip = await ConversationEventTipAsync(thread.ConversationId);

        // The event claims a command about one message produced an event about a different one. The
        // conversation tip is advanced in the same transaction so the tip assertion is satisfied and
        // the source assertion is the one that has to refuse it.
        var rejection = await ExpectRejectionAsync(
            $"""
            UPDATE messaging."Conversations" SET "LastEventSequence" = "LastEventSequence" + 1
            WHERE "Id" = @conversationId;

            INSERT INTO messaging."RealtimeEvents"
                ("Id", "TenantId", "ConversationId", "EventSequence", "Kind", "MessageId",
                 "MessageSequence", "MessageRevisionNumber", "SourceCommandRecordId", "OccurredAtUtc",
                 "CreatedAtUtc", "UpdatedAtUtc")
            VALUES (@id, @tenantId, @conversationId, {(tip + 1).ToString(CultureInfo.InvariantCulture)},
                    'MessageSenderRemoved', @messageId, 1, 1,
                    @sourceCommand, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            ("id", Guid.CreateVersion7()),
            ("tenantId", thread.Workspace.TenantId),
            ("conversationId", thread.ConversationId),
            ("messageId", first.Id),
            ("sourceCommand", sourceCommand));

        Assert.Contains("source command message", rejection.MessageText, StringComparison.OrdinalIgnoreCase);
    }

    [TestMethod]
    public async Task TheDatabaseRefusesASecondEventForOneSourceCommand()
    {
        var thread = await OpenThreadAsync("one-per-command");
        var sourceCommand = await ScalarAsync<Guid>(
            """SELECT "Id" FROM messaging."CommandRecords" WHERE "ConversationId" = @id LIMIT 1""",
            ("id", thread.ConversationId));

        var rejection = await ExpectRejectionAsync(
            """
            INSERT INTO messaging."RealtimeEvents"
                ("Id", "TenantId", "ConversationId", "EventSequence", "Kind", "MessageId",
                 "MessageSequence", "MessageRevisionNumber", "SourceCommandRecordId", "OccurredAtUtc",
                 "CreatedAtUtc", "UpdatedAtUtc")
            VALUES (@id, @tenantId, @conversationId, 2, 'ConversationCreated', NULL, NULL, NULL,
                    @sourceCommand, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            ("id", Guid.CreateVersion7()),
            ("tenantId", thread.Workspace.TenantId),
            ("conversationId", thread.ConversationId),
            ("sourceCommand", sourceCommand));

        Assert.AreEqual(PostgresErrorCodesUniqueViolation, rejection.SqlState);
    }

    [TestMethod]
    public async Task TheDatabaseRefusesAnEventWithoutPublicationStateForEveryParticipant()
    {
        var thread = await OpenThreadAsync("incomplete-recipients");
        var sourceCommand = await UnusedCommandRecordAsync(thread);
        var tip = await ConversationEventTipAsync(thread.ConversationId);

        // A well-formed event with no publication state at all. The conversation tip is advanced in
        // the same transaction so the tip assertion is satisfied and the completeness assertion is
        // the one that has to refuse it: without it, one participant would silently never be told.
        var rejection = await ExpectRejectionAsync(
            $"""
            UPDATE messaging."Conversations" SET "LastEventSequence" = "LastEventSequence" + 1
            WHERE "Id" = @conversationId;

            INSERT INTO messaging."RealtimeEvents"
                ("Id", "TenantId", "ConversationId", "EventSequence", "Kind", "MessageId",
                 "MessageSequence", "MessageRevisionNumber", "SourceCommandRecordId", "OccurredAtUtc",
                 "CreatedAtUtc", "UpdatedAtUtc")
            VALUES (@id, @tenantId, @conversationId, {(tip + 1).ToString(CultureInfo.InvariantCulture)},
                    'MessageSenderRemoved', @messageId, @messageSequence, 1,
                    @sourceCommand, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            ("id", Guid.CreateVersion7()),
            ("tenantId", thread.Workspace.TenantId),
            ("conversationId", thread.ConversationId),
            ("messageId", await ScalarAsync<Guid>(
                """
                SELECT "MessageId" FROM messaging."CommandRecords" WHERE "Id" = @id
                """,
                ("id", sourceCommand))),
            ("messageSequence", await ScalarAsync<long>(
                """
                SELECT m."Sequence" FROM messaging."Messages" m
                JOIN messaging."CommandRecords" r ON r."MessageId" = m."Id"
                WHERE r."Id" = @id
                """,
                ("id", sourceCommand))),
            ("sourceCommand", sourceCommand));

        Assert.Contains(
            "every conversation participant",
            rejection.MessageText,
            StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// The 6B-2A protections this phase must not have weakened, re-run against the upgraded schema.
    /// </summary>
    [TestMethod]
    public async Task TheExistingRevisionChainAndConversationTipProtectionsStillHold()
    {
        var thread = await OpenThreadAsync("existing-protections");
        var message = await SendMessageAsync(thread.Coach, thread.ConversationId, "protected");

        var futureRevision = await ExpectRejectionAsync(
            """
            INSERT INTO messaging."MessageRevisions"
                ("Id", "TenantId", "MessageId", "RevisionNumber", "Body", "AuthoredByUserId",
                 "AuthoredAtUtc", "CreatedAtUtc", "UpdatedAtUtc")
            VALUES (@id, @tenantId, @messageId, 5, 'inserted behind the chain', @author,
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            ("id", Guid.CreateVersion7()),
            ("tenantId", thread.Workspace.TenantId),
            ("messageId", message.Id),
            ("author", thread.Workspace.CoachUserId));
        Assert.Contains("contiguous chain", futureRevision.MessageText, StringComparison.OrdinalIgnoreCase);

        var tipWithoutMessage = await ExpectRejectionAsync(
            """UPDATE messaging."Conversations" SET "LastSequence" = "LastSequence" + 1 WHERE "Id" = @id""",
            ("id", thread.ConversationId));
        Assert.Contains("newest message", tipWithoutMessage.MessageText, StringComparison.OrdinalIgnoreCase);

        var providerClaim = await ExpectRejectionAsync(
            """UPDATE messaging."Messages" SET "ProviderAcknowledgedAtUtc" = CURRENT_TIMESTAMP WHERE "Id" = @id""",
            ("id", message.Id));
        Assert.Contains("provider channel", providerClaim.MessageText, StringComparison.OrdinalIgnoreCase);
    }

    [TestMethod]
    public async Task ARealtimeAcknowledgementInstantCannotBeMoved()
    {
        var thread = await OpenThreadAsync("ack-instant");
        var message = await SendMessageAsync(thread.Coach, thread.ConversationId, "acknowledge me");
        var events = await EventsAsync(thread.ConversationId);
        await AcknowledgeAsync(thread.Client, thread.ConversationId, events[^1].EventSequence);
        Assert.IsNotNull(await RealtimeAcknowledgedAtAsync(message.Id));

        var rejection = await ExpectRejectionAsync(
            """
            UPDATE messaging."Messages"
            SET "RealtimeAcknowledgedAtUtc" = "RealtimeAcknowledgedAtUtc" + interval '1 hour'
            WHERE "Id" = @id
            """,
            ("id", message.Id));

        Assert.Contains("never moved", rejection.MessageText, StringComparison.OrdinalIgnoreCase);
    }

    private const string PostgresErrorCodesCheckViolation = "23514";
    private const string PostgresErrorCodesForeignKey = "23503";
    private const string PostgresErrorCodesUniqueViolation = "23505";
}
