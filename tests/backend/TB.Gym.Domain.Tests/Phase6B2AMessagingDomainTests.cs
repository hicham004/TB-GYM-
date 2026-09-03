using TB.Gym.Modules.Messaging;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// Phase 6B-2A persisted messaging: conversation identity, message content, ordering, revisions,
/// one-way removal, moderation, read state and idempotency binding.
/// </summary>
/// <remarks>
/// These assert the rules that hold with no database in the room. Everything that depends on
/// PostgreSQL — real sequence races, the append-only triggers, cross-tenant refusal, keyset paging
/// and the unread aggregate — is asserted against real PostgreSQL in the integration suite instead,
/// because a rule proved in memory and enforced in SQL is two rules until both are measured.
/// </remarks>
[TestClass]
public sealed class Phase6B2AMessagingDomainTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 1, 9, 0, 0, TimeSpan.Zero);

    private static readonly Guid TenantId = Guid.CreateVersion7();
    private static readonly Guid ClientProfileId = Guid.CreateVersion7();
    private static readonly Guid CoachUserId = Guid.CreateVersion7();
    private static readonly Guid ClientUserId = Guid.CreateVersion7();

    // ---------- conversation identity and participants ----------

    [TestMethod]
    public void DirectConversationRecordsItsCoachClientAndGoverningProfile()
    {
        var conversation = NewConversation();

        Assert.AreEqual(TenantId, conversation.TenantId);
        Assert.AreEqual(ClientProfileId, conversation.ClientProfileId);
        Assert.AreEqual(CoachUserId, conversation.CoachUserId);
        Assert.AreEqual(ClientUserId, conversation.ClientUserId);
        Assert.AreEqual(0L, conversation.LastSequence, "A new conversation has committed nothing.");
        Assert.IsNull(conversation.LastMessageId);
        Assert.AreEqual(Now, conversation.LastActivityAtUtc);
        Assert.IsTrue(conversation.IsParticipant(CoachUserId));
        Assert.IsTrue(conversation.IsParticipant(ClientUserId));
        Assert.IsFalse(
            conversation.IsParticipant(Guid.CreateVersion7()),
            "Workspace membership is not participation.");
    }

    [TestMethod]
    public void DirectConversationCreatesExactlyOneCoachAndOneClientParticipant()
    {
        var conversation = NewConversation();

        var participants = conversation.CreateDirectParticipants();

        Assert.HasCount(2, participants);
        var coach = participants.Single(item => item.Role == ConversationParticipantRole.Coach);
        var client = participants.Single(item => item.Role == ConversationParticipantRole.Client);
        Assert.AreEqual(CoachUserId, coach.UserId);
        Assert.AreEqual(ClientUserId, client.UserId);
        Assert.IsTrue(coach.CanModerate, "The coach side moderates.");
        Assert.IsFalse(client.CanModerate, "The client side does not.");
        Assert.IsTrue(participants.All(item => item.ConversationId == conversation.Id));
        Assert.IsTrue(participants.All(item => item.TenantId == TenantId));
        Assert.IsTrue(participants.All(item => item.LastReadSequence == 0 && item.LastReadAtUtc is null));
    }

    [TestMethod]
    public void ADirectConversationCannotBeWithYourself()
    {
        Assert.ThrowsExactly<ArgumentException>(() => Conversation.StartDirect(
            TenantId,
            ClientProfileId,
            CoachUserId,
            CoachUserId,
            Now));
    }

    [TestMethod]
    public void ADirectConversationRequiresATenantProfileCoachAndClient()
    {
        Assert.ThrowsExactly<ArgumentException>(() =>
            Conversation.StartDirect(Guid.Empty, ClientProfileId, CoachUserId, ClientUserId, Now));
        Assert.ThrowsExactly<ArgumentException>(() =>
            Conversation.StartDirect(TenantId, Guid.Empty, CoachUserId, ClientUserId, Now));
        Assert.ThrowsExactly<ArgumentException>(() =>
            Conversation.StartDirect(TenantId, ClientProfileId, Guid.Empty, ClientUserId, Now));
        Assert.ThrowsExactly<ArgumentException>(() =>
            Conversation.StartDirect(TenantId, ClientProfileId, CoachUserId, Guid.Empty, Now));
    }

    [TestMethod]
    public void CounterpartIsTheOtherSideWhicheverSideIsAsking()
    {
        var conversation = NewConversation();

        Assert.AreEqual(ClientUserId, conversation.CounterpartOf(CoachUserId));
        Assert.AreEqual(CoachUserId, conversation.CounterpartOf(ClientUserId));
    }

    // ---------- message content ----------

    [TestMethod]
    public void MessageContentNormalizesLineEndingsAndTrimsOuterWhitespace()
    {
        Assert.IsTrue(MessageContentPolicy.TryNormalize(
            "  first\r\nsecond\rthird  \n\n",
            out var normalized,
            out _));

        Assert.AreEqual("first\nsecond\nthird", normalized);
    }

    [TestMethod]
    public void MessageContentKeepsInnerTabsAndBlankLines()
    {
        Assert.IsTrue(MessageContentPolicy.TryNormalize("a\n\n\tb", out var normalized, out _));

        Assert.AreEqual("a\n\n\tb", normalized);
    }

    [TestMethod]
    public void MessageContentRefusesBlankAndWhitespaceOnlyBodies()
    {
        foreach (var candidate in new[] { null, string.Empty, "   ", "\r\n", "\t\n \n" })
        {
            Assert.IsFalse(
                MessageContentPolicy.TryNormalize(candidate, out _, out var failure),
                $"'{candidate}' is not a message.");
            Assert.AreEqual(MessageContentFailure.Empty, failure);
        }
    }

    [TestMethod]
    public void MessageContentRefusesControlCharactersOtherThanLineFeedAndTab()
    {
        Assert.IsFalse(MessageContentPolicy.TryNormalize("hello\u0000world", out _, out var nul));
        Assert.AreEqual(MessageContentFailure.InvalidCharacter, nul);
        Assert.IsFalse(MessageContentPolicy.TryNormalize("bell\u0007", out _, out var bell));
        Assert.AreEqual(MessageContentFailure.InvalidCharacter, bell);
        // C1 controls are the ones a naive "is it printable" check misses.
        Assert.IsFalse(MessageContentPolicy.TryNormalize("c1\u0085here", out _, out var c1));
        Assert.AreEqual(MessageContentFailure.InvalidCharacter, c1);
        // An unpaired surrogate is not encodable as UTF-8 and would fail at the database instead of
        // at the boundary, where the caller can be told which field was wrong.
        Assert.IsFalse(MessageContentPolicy.TryNormalize("lone\ud83dtail", out _, out var surrogate));
        Assert.AreEqual(MessageContentFailure.InvalidCharacter, surrogate);
    }

    [TestMethod]
    public void MessageContentAcceptsTwoThousandCharactersAndRefusesTheNextOne()
    {
        Assert.IsTrue(MessageContentPolicy.TryNormalize(
            new string('a', MessageContentPolicy.MaximumLength),
            out var atLimit,
            out _));
        Assert.AreEqual(MessageContentPolicy.MaximumLength, atLimit.Length);

        Assert.IsFalse(MessageContentPolicy.TryNormalize(
            new string('a', MessageContentPolicy.MaximumLength + 1),
            out _,
            out var failure));
        Assert.AreEqual(MessageContentFailure.TooLong, failure);
    }

    [TestMethod]
    public void MessageContentMeasuresLengthAfterNormalizationNotBefore()
    {
        // 2 000 characters plus surrounding whitespace and CRLF pairs. Measuring the raw string would
        // refuse a body the user is entitled to send.
        var raw = "  " + new string('a', MessageContentPolicy.MaximumLength - 1) + "\r\n  ";

        Assert.IsTrue(MessageContentPolicy.TryNormalize(raw, out var normalized, out _));
        Assert.AreEqual(MessageContentPolicy.MaximumLength - 1, normalized.Length);
    }

    [TestMethod]
    public void MessagePreviewIsBoundedAndNeverSplitsASurrogatePair()
    {
        var body = new string('x', MessageContentPolicy.PreviewLength - 1) + "\U0001F600tail";

        var preview = MessageContentPolicy.Preview(body);

        Assert.AreEqual(MessageContentPolicy.PreviewLength - 1, preview.Length);
        Assert.IsTrue(preview.All(character => character == 'x'));
    }

    [TestMethod]
    public void ModerationReasonIsRequiredAndBounded()
    {
        Assert.IsFalse(MessageContentPolicy.TryNormalizeModerationReason("   ", out _, out var empty));
        Assert.AreEqual(MessageContentFailure.Empty, empty);
        Assert.IsFalse(MessageContentPolicy.TryNormalizeModerationReason(
            new string('r', MessageContentPolicy.MaximumModerationReasonLength + 1),
            out _,
            out var tooLong));
        Assert.AreEqual(MessageContentFailure.TooLong, tooLong);
        Assert.IsTrue(MessageContentPolicy.TryNormalizeModerationReason(
            "  Off topic\r\n ",
            out var normalized,
            out _));
        Assert.AreEqual("Off topic", normalized);
    }

    // ---------- ordering ----------

    [TestMethod]
    public void SequencesArePositiveAndStrictlyIncreasingWithinAConversation()
    {
        var conversation = NewConversation();

        var allocated = Enumerable.Range(0, 5).Select(_ => conversation.AllocateNextSequence()).ToArray();

        long[] expected = [1L, 2L, 3L, 4L, 5L];
        CollectionAssert.AreEqual(expected, allocated);
        Assert.AreEqual(5L, conversation.LastSequence);
    }

    [TestMethod]
    public void ASequenceBelowOneIsNotAMessage()
    {
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => Message.Send(
            TenantId,
            Guid.CreateVersion7(),
            CoachUserId,
            0,
            "hello",
            Now,
            out _));
    }

    [TestMethod]
    public void ConversationActivityFollowsTheNewestMessageAndNeverMovesBackwards()
    {
        var conversation = NewConversation();
        var later = Now.AddMinutes(5);
        var messageId = Guid.CreateVersion7();

        conversation.RecordMessage(messageId, later);
        Assert.AreEqual(later, conversation.LastActivityAtUtc);
        Assert.AreEqual(messageId, conversation.LastMessageId);

        // A clock adjustment must not reorder the conversation list under a reader.
        var earlierMessageId = Guid.CreateVersion7();
        conversation.RecordMessage(earlierMessageId, Now.AddMinutes(1));
        Assert.AreEqual(later, conversation.LastActivityAtUtc);
        Assert.AreEqual(earlierMessageId, conversation.LastMessageId);
    }

    // ---------- revisions ----------

    [TestMethod]
    public void SendingCreatesTheMessageAndItsFirstImmutableRevisionTogether()
    {
        var message = Message.Send(
            TenantId,
            Guid.CreateVersion7(),
            CoachUserId,
            1,
            "the original",
            Now,
            out var revision);

        Assert.AreEqual(1, message.CurrentRevisionNumber);
        Assert.IsNull(message.EditedAtUtc, "An unedited message has no edit instant.");
        Assert.AreEqual(Now, message.SentAtUtc);
        Assert.AreEqual(Now, message.AvailableAtUtc);
        Assert.IsNull(message.RealtimeAcknowledgedAtUtc, "There is no realtime channel in this slice.");
        Assert.IsNull(message.ProviderAcknowledgedAtUtc, "There is no provider in this slice.");
        Assert.AreEqual(message.Id, revision.MessageId);
        Assert.AreEqual(1, revision.RevisionNumber);
        Assert.AreEqual("the original", revision.Body);
        Assert.AreEqual(CoachUserId, revision.AuthoredByUserId);
    }

    [TestMethod]
    public void EditingAppendsTheNextRevisionAndStampsAServerEditInstant()
    {
        var message = NewMessage(out var first);
        var editedAt = Now.AddMinutes(3);

        var second = message.Edit(CoachUserId, "the correction", editedAt);

        Assert.AreEqual(2, message.CurrentRevisionNumber);
        Assert.AreEqual(editedAt, message.EditedAtUtc);
        Assert.AreEqual(2, second.RevisionNumber);
        Assert.AreEqual("the correction", second.Body);
        // The earlier revision object is untouched: an edit appends, it does not rewrite.
        Assert.AreEqual(1, first.RevisionNumber);
        Assert.AreEqual("the original", first.Body);

        var third = message.Edit(CoachUserId, "the second correction", editedAt.AddMinutes(1));
        Assert.AreEqual(3, third.RevisionNumber);
        Assert.AreEqual(3, message.CurrentRevisionNumber);
    }

    [TestMethod]
    public void OnlyTheSenderMayEditAMessage()
    {
        var message = NewMessage(out _);

        Assert.ThrowsExactly<InvalidOperationException>(() =>
            message.Edit(ClientUserId, "not yours", Now.AddMinutes(1)));
        Assert.AreEqual(1, message.CurrentRevisionNumber, "A refused edit appends nothing.");
        Assert.IsNull(message.EditedAtUtc);
    }

    // ---------- one-way removal ----------

    [TestMethod]
    public void TheSenderMayRemoveTheirOwnMessageAndTheRemovalIsRecorded()
    {
        var message = NewMessage(out _);
        var removedAt = Now.AddMinutes(2);

        var recorded = message.DeleteBySender(CoachUserId, removedAt);

        Assert.IsNotNull(recorded);
        Assert.IsTrue(message.IsDeleted);
        Assert.AreEqual(removedAt, message.DeletedAtUtc);
        Assert.AreEqual(MessageDeletionKind.SenderRemoved, message.DeletionKind);
        Assert.AreEqual(CoachUserId, message.DeletedByUserId);
        Assert.IsNull(message.ModerationReason, "A sender removal carries no moderation reason.");
        Assert.AreEqual(MessageDeletionKind.SenderRemoved, recorded.Kind);
        Assert.AreEqual(CoachUserId, recorded.ActorUserId);
        Assert.IsNull(recorded.Reason);
        Assert.AreEqual(1, recorded.RevisionNumberAtRemoval);
    }

    [TestMethod]
    public void SelfDeletionIsIdempotentAndRecordsNoSecondEvent()
    {
        var message = NewMessage(out _);
        var removedAt = Now.AddMinutes(2);
        Assert.IsNotNull(message.DeleteBySender(CoachUserId, removedAt));

        var repeated = message.DeleteBySender(CoachUserId, removedAt.AddMinutes(5));

        Assert.IsNull(repeated, "A repeat removal is a success that changes nothing.");
        Assert.AreEqual(removedAt, message.DeletedAtUtc, "The original removal instant stands.");
    }

    [TestMethod]
    public void OnlyTheSenderMayRemoveTheirOwnMessage()
    {
        var message = NewMessage(out _);

        Assert.ThrowsExactly<InvalidOperationException>(() =>
            message.DeleteBySender(ClientUserId, Now.AddMinutes(1)));
        Assert.IsFalse(message.IsDeleted);
    }

    [TestMethod]
    public void ARemovedMessageCannotBeEditedOrRestored()
    {
        var message = NewMessage(out _);
        message.DeleteBySender(CoachUserId, Now.AddMinutes(1));

        Assert.ThrowsExactly<InvalidOperationException>(() =>
            message.Edit(CoachUserId, "back again", Now.AddMinutes(2)));
        Assert.AreEqual(1, message.CurrentRevisionNumber);
        Assert.IsTrue(message.IsDeleted);
        // There is no restore operation at all: removal is expressed as a one-way transition, so
        // undoing it is not a refused call but an absent one.
        Assert.IsFalse(
            typeof(Message).GetMethods().Any(method =>
                method.Name.Contains("Restore", StringComparison.OrdinalIgnoreCase) ||
                method.Name.Contains("Undelete", StringComparison.OrdinalIgnoreCase)),
            "Message removal is one way, so no restore operation may exist.");
    }

    // ---------- moderation ----------

    [TestMethod]
    public void TheCoachParticipantMayModerateTheOtherParticipantsMessageWithAReason()
    {
        var message = NewMessage(out _, sender: ClientUserId);
        var removedAt = Now.AddMinutes(4);

        var recorded = message.ModerateRemove(CoachUserId, "Off topic", removedAt);

        Assert.IsNotNull(recorded);
        Assert.IsTrue(message.IsDeleted);
        Assert.AreEqual(MessageDeletionKind.CoachModerated, message.DeletionKind);
        Assert.AreEqual(CoachUserId, message.DeletedByUserId);
        Assert.AreEqual("Off topic", message.ModerationReason);
        Assert.AreEqual(MessageDeletionKind.CoachModerated, recorded.Kind);
        Assert.AreEqual("Off topic", recorded.Reason);
    }

    [TestMethod]
    public void ModerationRequiresANonEmptyReason()
    {
        var message = NewMessage(out _, sender: ClientUserId);

        Assert.ThrowsExactly<ArgumentException>(() =>
            message.ModerateRemove(CoachUserId, "   ", Now.AddMinutes(1)));
        Assert.IsFalse(message.IsDeleted);
    }

    [TestMethod]
    public void ModerationIsForTheOtherParticipantsMessageNotYourOwn()
    {
        var message = NewMessage(out _, sender: CoachUserId);

        Assert.ThrowsExactly<InvalidOperationException>(() =>
            message.ModerateRemove(CoachUserId, "Off topic", Now.AddMinutes(1)));
    }

    [TestMethod]
    public void ModerationIsOneWayAndIdempotent()
    {
        var message = NewMessage(out _, sender: ClientUserId);
        var removedAt = Now.AddMinutes(1);
        message.ModerateRemove(CoachUserId, "Off topic", removedAt);

        var repeated = message.ModerateRemove(CoachUserId, "Off topic", removedAt.AddMinutes(9));

        Assert.IsNull(repeated);
        Assert.AreEqual(removedAt, message.DeletedAtUtc);
        Assert.AreEqual("Off topic", message.ModerationReason);
    }

    [TestMethod]
    public void AModeratorRemovesAndNeverRewritesSomebodyElsesWords()
    {
        var message = NewMessage(out _, sender: ClientUserId);

        // Edit refuses anybody but the sender, so a moderator has removal and nothing else.
        Assert.ThrowsExactly<InvalidOperationException>(() =>
            message.Edit(CoachUserId, "what the coach wishes had been said", Now.AddMinutes(1)));
    }

    [TestMethod]
    public void ASenderRemovalEventCannotCarryAModerationReason()
    {
        var message = NewMessage(out _);
        var recorded = message.DeleteBySender(CoachUserId, Now.AddMinutes(1));

        Assert.IsNotNull(recorded);
        Assert.IsNull(recorded.Reason);
        Assert.AreEqual(MessageDeletionKind.SenderRemoved, recorded.Kind);
    }

    [TestMethod]
    public void SelfRemovalAndModerationAreDistinguishableAfterwards()
    {
        var mine = NewMessage(out _);
        var theirs = NewMessage(out _, sender: ClientUserId);

        mine.DeleteBySender(CoachUserId, Now.AddMinutes(1));
        theirs.ModerateRemove(CoachUserId, "Off topic", Now.AddMinutes(1));

        Assert.AreEqual(MessageDeletionKind.SenderRemoved, mine.DeletionKind);
        Assert.AreEqual(MessageDeletionKind.CoachModerated, theirs.DeletionKind);
        Assert.AreNotEqual(mine.DeletionKind, theirs.DeletionKind);
    }

    // ---------- read state ----------

    [TestMethod]
    public void AReadCursorStartsAtZeroAndAdvancesWithAServerInstant()
    {
        var participant = NewParticipant();

        Assert.IsTrue(participant.AdvanceReadCursor(3, latestCommittedSequence: 5, Now));

        Assert.AreEqual(3L, participant.LastReadSequence);
        Assert.AreEqual(Now, participant.LastReadAtUtc);
    }

    [TestMethod]
    public void AReadCursorNeverMovesBackwards()
    {
        var participant = NewParticipant();
        participant.AdvanceReadCursor(5, 10, Now);

        Assert.IsFalse(
            participant.AdvanceReadCursor(2, 10, Now.AddMinutes(1)),
            "A lower report is accepted and changes nothing.");

        Assert.AreEqual(5L, participant.LastReadSequence);
        Assert.AreEqual(Now, participant.LastReadAtUtc, "A no-op does not restamp the instant.");
    }

    [TestMethod]
    public void RepeatingTheCurrentReadCursorIsANoOpRatherThanAnError()
    {
        var participant = NewParticipant();
        participant.AdvanceReadCursor(4, 10, Now);

        Assert.IsFalse(participant.AdvanceReadCursor(4, 10, Now.AddMinutes(1)));
        Assert.AreEqual(4L, participant.LastReadSequence);
    }

    [TestMethod]
    public void AReadCursorBeyondTheNewestCommittedSequenceIsClampedToIt()
    {
        var participant = NewParticipant();

        // The exact boundary: at the newest sequence it lands there; one beyond it lands there too,
        // because a message committed between rendering and reporting is a race rather than an error.
        Assert.IsTrue(participant.AdvanceReadCursor(7, latestCommittedSequence: 7, Now));
        Assert.AreEqual(7L, participant.LastReadSequence);

        Assert.IsFalse(
            participant.AdvanceReadCursor(8, latestCommittedSequence: 7, Now.AddMinutes(1)),
            "Clamping to the newest sequence leaves an already-current cursor unchanged.");
        Assert.AreEqual(7L, participant.LastReadSequence);

        var fresh = NewParticipant();
        Assert.IsTrue(fresh.AdvanceReadCursor(long.MaxValue, latestCommittedSequence: 2, Now));
        Assert.AreEqual(2L, fresh.LastReadSequence, "A cursor can never name a message that does not exist.");
    }

    [TestMethod]
    public void AnEmptyConversationHasNothingToRead()
    {
        var participant = NewParticipant();

        Assert.IsFalse(participant.AdvanceReadCursor(5, latestCommittedSequence: 0, Now));
        Assert.AreEqual(0L, participant.LastReadSequence);
        Assert.IsNull(participant.LastReadAtUtc);
    }

    [TestMethod]
    public void ANegativeReadCursorIsRefused()
    {
        var participant = NewParticipant();

        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() =>
            participant.AdvanceReadCursor(-1, 10, Now));
    }

    [TestMethod]
    public void AParticipantsOwnMessagesAreNeverUnreadToThem()
    {
        var conversationId = Guid.CreateVersion7();
        var coach = ConversationParticipant.Join(
            TenantId,
            conversationId,
            CoachUserId,
            ConversationParticipantRole.Coach);
        var client = ConversationParticipant.Join(
            TenantId,
            conversationId,
            ClientUserId,
            ConversationParticipantRole.Client);
        var fromCoach = Message.Send(TenantId, conversationId, CoachUserId, 1, "hello", Now, out _);

        Assert.IsFalse(coach.CountsAsUnread(fromCoach), "Sending is not being told something.");
        Assert.IsTrue(client.CountsAsUnread(fromCoach));
    }

    [TestMethod]
    public void UnreadStopsAtTheCursorAndSkipsRemovedMessages()
    {
        var conversationId = Guid.CreateVersion7();
        var client = ConversationParticipant.Join(
            TenantId,
            conversationId,
            ClientUserId,
            ConversationParticipantRole.Client);
        var first = Message.Send(TenantId, conversationId, CoachUserId, 1, "one", Now, out _);
        var second = Message.Send(TenantId, conversationId, CoachUserId, 2, "two", Now, out _);
        var third = Message.Send(TenantId, conversationId, CoachUserId, 3, "three", Now, out _);
        third.DeleteBySender(CoachUserId, Now.AddMinutes(1));

        client.AdvanceReadCursor(1, latestCommittedSequence: 3, Now);

        Assert.IsFalse(client.CountsAsUnread(first), "Already read.");
        Assert.IsTrue(client.CountsAsUnread(second));
        Assert.IsFalse(client.CountsAsUnread(third), "A removed message has no body to be unread.");
    }

    [TestMethod]
    public void AMessageFromAnotherConversationIsNeverUnreadHere()
    {
        var client = NewParticipant(ConversationParticipantRole.Client, ClientUserId);
        var elsewhere = Message.Send(TenantId, Guid.CreateVersion7(), CoachUserId, 1, "hello", Now, out _);

        Assert.IsFalse(client.CountsAsUnread(elsewhere));
    }

    // ---------- idempotency binding ----------

    [TestMethod]
    public void ASendFingerprintBindsTenantConversationSenderAndNormalizedBody()
    {
        var conversationId = Guid.CreateVersion7();
        var otherTenant = Guid.CreateVersion7();
        var baseline = MessagingCommandFingerprint.ForSend(TenantId, conversationId, CoachUserId, "hello");

        Assert.AreEqual(
            baseline,
            MessagingCommandFingerprint.ForSend(TenantId, conversationId, CoachUserId, "hello"),
            "The same command hashes the same way.");
        Assert.AreNotEqual(
            baseline,
            MessagingCommandFingerprint.ForSend(otherTenant, conversationId, CoachUserId, "hello"));
        Assert.AreNotEqual(
            baseline,
            MessagingCommandFingerprint.ForSend(TenantId, Guid.CreateVersion7(), CoachUserId, "hello"));
        Assert.AreNotEqual(
            baseline,
            MessagingCommandFingerprint.ForSend(TenantId, conversationId, ClientUserId, "hello"));
        Assert.AreNotEqual(
            baseline,
            MessagingCommandFingerprint.ForSend(TenantId, conversationId, CoachUserId, "hello there"));
    }

    [TestMethod]
    public void ARetryDifferingOnlyInLineEndingsIsTheSameCommand()
    {
        var conversationId = Guid.CreateVersion7();
        MessageContentPolicy.TryNormalize("first\r\nsecond  ", out var first, out _);
        MessageContentPolicy.TryNormalize("  first\nsecond", out var second, out _);

        Assert.AreEqual(
            MessagingCommandFingerprint.ForSend(TenantId, conversationId, CoachUserId, first),
            MessagingCommandFingerprint.ForSend(TenantId, conversationId, CoachUserId, second));
    }

    [TestMethod]
    public void AKeySpentOnOneCommandIsNotHonouredByAnother()
    {
        var conversationId = Guid.CreateVersion7();
        var messageId = Guid.CreateVersion7();
        var key = Guid.CreateVersion7();
        var sendFingerprint = MessagingCommandFingerprint.ForSend(
            TenantId,
            conversationId,
            CoachUserId,
            "hello");
        var record = MessagingCommandRecord.Record(
            TenantId,
            key,
            MessagingCommandType.SendMessage,
            sendFingerprint,
            CoachUserId,
            conversationId,
            messageId,
            Now);

        Assert.IsTrue(record.Matches(MessagingCommandType.SendMessage, sendFingerprint));
        Assert.IsFalse(
            record.Matches(MessagingCommandType.EditMessage, sendFingerprint),
            "The command type is part of the match, not only the payload.");
        Assert.IsFalse(record.Matches(
            MessagingCommandType.SendMessage,
            MessagingCommandFingerprint.ForSend(TenantId, conversationId, CoachUserId, "different")));
    }

    [TestMethod]
    public void AnEditFingerprintIgnoresTheExpectedVersionSoAnHonestRetryIsNotAConflict()
    {
        var conversationId = Guid.CreateVersion7();
        var messageId = Guid.CreateVersion7();

        // Nothing about the fingerprint depends on the concurrency token: a client that re-read the
        // message before retrying carries a newer version and must still be recognised.
        var first = MessagingCommandFingerprint.ForEdit(
            TenantId,
            conversationId,
            messageId,
            CoachUserId,
            "corrected");
        var second = MessagingCommandFingerprint.ForEdit(
            TenantId,
            conversationId,
            messageId,
            CoachUserId,
            "corrected");

        Assert.AreEqual(first, second);
    }

    [TestMethod]
    public void ModerationFingerprintsIncludeTheReason()
    {
        var conversationId = Guid.CreateVersion7();
        var messageId = Guid.CreateVersion7();

        Assert.AreNotEqual(
            MessagingCommandFingerprint.ForModerate(TenantId, conversationId, messageId, CoachUserId, "Off topic"),
            MessagingCommandFingerprint.ForModerate(TenantId, conversationId, messageId, CoachUserId, "Abusive"));
    }

    [TestMethod]
    public void EveryFingerprintIsALowercaseSha256Digest()
    {
        var conversationId = Guid.CreateVersion7();
        string[] fingerprints =
        [
            MessagingCommandFingerprint.ForCreateConversation(TenantId, CoachUserId, ClientProfileId),
            MessagingCommandFingerprint.ForSend(TenantId, conversationId, CoachUserId, "hello"),
            MessagingCommandFingerprint.ForEdit(TenantId, conversationId, Guid.CreateVersion7(), CoachUserId, "x"),
            MessagingCommandFingerprint.ForDelete(TenantId, conversationId, Guid.CreateVersion7(), CoachUserId),
            MessagingCommandFingerprint.ForModerate(TenantId, conversationId, Guid.CreateVersion7(), CoachUserId, "r"),
        ];

        foreach (var fingerprint in fingerprints)
        {
            Assert.AreEqual(64, fingerprint.Length);
            Assert.IsTrue(
                fingerprint.All(character => character is >= '0' and <= '9' or >= 'a' and <= 'f'),
                "The database check constraint requires lowercase hexadecimal.");
        }
    }

    [TestMethod]
    public void ACommandRecordRequiresAKeyAnActorAndAConversation()
    {
        Assert.ThrowsExactly<ArgumentException>(() => MessagingCommandRecord.Record(
            TenantId,
            Guid.Empty,
            MessagingCommandType.SendMessage,
            new string('a', 64),
            CoachUserId,
            Guid.CreateVersion7(),
            Guid.CreateVersion7(),
            Now));
        Assert.ThrowsExactly<ArgumentException>(() => MessagingCommandRecord.Record(
            TenantId,
            Guid.CreateVersion7(),
            MessagingCommandType.SendMessage,
            new string('a', 64),
            Guid.Empty,
            Guid.CreateVersion7(),
            Guid.CreateVersion7(),
            Now));
    }

    // ---------- history immutability ----------

    [TestMethod]
    public void ARevisionExposesNoWayToChangeWhatItSaid()
    {
        NewMessage(out var revision);

        // Every property is externally read-only. A revision that could be rewritten would make the
        // history it exists for worthless, and the database trigger is the second guarantee.
        var writable = typeof(MessageRevision)
            .GetProperties()
            .Where(property => property.SetMethod is { IsPublic: true })
            .Select(property => property.Name)
            .ToArray();

        Assert.IsEmpty(writable, $"MessageRevision exposes public setters: {string.Join(", ", writable)}");
        Assert.AreEqual("the original", revision.Body);
    }

    [TestMethod]
    public void ADeletionEventExposesNoWayToChangeWhatHappened()
    {
        var writable = typeof(MessageDeletionEvent)
            .GetProperties()
            .Where(property => property.SetMethod is { IsPublic: true })
            .Select(property => property.Name)
            .ToArray();

        Assert.IsEmpty(writable, $"MessageDeletionEvent exposes public setters: {string.Join(", ", writable)}");
    }

    [TestMethod]
    public void ThisSliceClaimsOnlyThatAMessageWasPersisted()
    {
        // MessageDeliveryState has exactly one member. A "Delivered" or "Read" state would be a claim
        // no code in this slice can substantiate: nothing has been sent anywhere.
        MessageDeliveryState[] expected = [MessageDeliveryState.Persisted];
        CollectionAssert.AreEqual(expected, Enum.GetValues<MessageDeliveryState>());
    }

    // ---------- fixtures ----------

    private static Conversation NewConversation() =>
        Conversation.StartDirect(TenantId, ClientProfileId, CoachUserId, ClientUserId, Now);

    private static ConversationParticipant NewParticipant(
        ConversationParticipantRole role = ConversationParticipantRole.Coach,
        Guid? userId = null) =>
        ConversationParticipant.Join(
            TenantId,
            Guid.CreateVersion7(),
            userId ?? CoachUserId,
            role);

    private static Message NewMessage(out MessageRevision revision, Guid? sender = null) =>
        Message.Send(
            TenantId,
            Guid.CreateVersion7(),
            sender ?? CoachUserId,
            1,
            "the original",
            Now,
            out revision);
}
