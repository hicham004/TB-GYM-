using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Messaging;

/// <summary>
/// How a message came to be removed. Two stable, distinguishable facts, because "the sender took it
/// back" and "the coach removed it" are different events with different audiences and different
/// audit obligations.
/// </summary>
public enum MessageDeletionKind
{
    SenderRemoved = 1,
    CoachModerated = 2,
}

/// <summary>
/// How far a message has actually got.
/// </summary>
/// <remarks>
/// Phase 6B-2A can truthfully claim exactly one thing: the message is committed to PostgreSQL and
/// available to an authorized reader who asks for it. It is deliberately not called "Delivered",
/// because a REST command that returned 200 has told nobody anything. Phase 6B-2B adds realtime
/// acknowledgement as a further state; a later channel adds provider acknowledgement. None of them
/// is read state, which belongs to <see cref="ConversationParticipant"/>.
/// </remarks>
public enum MessageDeliveryState
{
    Persisted = 1,
}

/// <summary>
/// One message in one conversation.
/// </summary>
/// <remarks>
/// A message is never hard-deleted and its body never lives on this row. The body is held by
/// <see cref="MessageRevision"/>, append-only, one row per version, and this row names which revision
/// is current by number. That is stronger than a nullable pointer column would be: the current
/// revision is found by <c>(TenantId, MessageId, RevisionNumber)</c>, a key that already contains the
/// tenant and the message, so pointing at another workspace's or another message's revision is not
/// expressible rather than merely refused. It also avoids a circular foreign key between the two
/// tables, which PostgreSQL would need deferred to insert either row.
/// <para>
/// Deletion is one-way and idempotent. The revisions stay exactly as they were, so what was said
/// remains auditable, and no ordinary API returns a body, an old revision or a moderation reason once
/// a message is removed.
/// </para>
/// </remarks>
public sealed class Message : TenantEntity
{
    private Message()
    {
    }

    private Message(
        Guid tenantId,
        Guid conversationId,
        Guid senderUserId,
        long sequence,
        DateTimeOffset now)
        : base(tenantId)
    {
        if (conversationId == Guid.Empty || senderUserId == Guid.Empty)
        {
            throw new ArgumentException("A message needs a conversation and a sender.");
        }

        ArgumentOutOfRangeException.ThrowIfLessThan(sequence, 1);

        ConversationId = conversationId;
        SenderUserId = senderUserId;
        Sequence = sequence;
        SentAtUtc = now;
        AvailableAtUtc = now;
        CurrentRevisionNumber = 1;
    }

    public Guid ConversationId { get; private set; }

    public Guid SenderUserId { get; private set; }

    /// <summary>
    /// Positive and strictly increasing within the conversation. Allocated under the conversation's
    /// row lock and protected by a unique index, so two concurrent senders receive different numbers
    /// in a deterministic order rather than racing for the same one.
    /// </summary>
    public long Sequence { get; private set; }

    public DateTimeOffset SentAtUtc { get; private set; }

    /// <summary>
    /// When this message became durable and available for an authorized reader to catch up on. This
    /// is the only delivery claim this slice makes.
    /// </summary>
    public DateTimeOffset AvailableAtUtc { get; private set; }

    /// <summary>
    /// Reserved for Phase 6B-2B and null throughout this slice: no realtime channel has acknowledged
    /// anything, because there is no realtime channel.
    /// </summary>
    public DateTimeOffset? RealtimeAcknowledgedAtUtc { get; private set; }

    /// <summary>
    /// Reserved for a future external channel and null throughout this slice. Provider
    /// acknowledgement is not read state and will never be written into one.
    /// </summary>
    public DateTimeOffset? ProviderAcknowledgedAtUtc { get; private set; }

    /// <summary>Which revision is the current body. Starts at 1 and only ever increases.</summary>
    public int CurrentRevisionNumber { get; private set; }

    public DateTimeOffset? EditedAtUtc { get; private set; }

    public DateTimeOffset? DeletedAtUtc { get; private set; }

    public MessageDeletionKind? DeletionKind { get; private set; }

    public Guid? DeletedByUserId { get; private set; }

    /// <summary>
    /// Required for a coach moderation and retained for audit. It is never returned to the other
    /// participant and never logged.
    /// </summary>
    public string? ModerationReason { get; private set; }

    public bool IsDeleted => DeletedAtUtc is not null;

    /// <summary>
    /// Creates the message and its first, immutable revision together. There is no state in which a
    /// message exists without the body it was sent with.
    /// </summary>
    public static Message Send(
        Guid tenantId,
        Guid conversationId,
        Guid senderUserId,
        long sequence,
        string normalizedBody,
        DateTimeOffset now,
        out MessageRevision initialRevision)
    {
        var message = new Message(tenantId, conversationId, senderUserId, sequence, now);
        initialRevision = MessageRevision.Create(
            tenantId,
            message.Id,
            1,
            normalizedBody,
            senderUserId,
            now);
        return message;
    }

    /// <summary>
    /// Appends a new revision authored by the original sender.
    /// </summary>
    /// <remarks>
    /// Only the sender may edit, and only a message that has not been removed. There is no edit-time
    /// window in this slice: inventing one would be a product rule nobody has decided, and the wrong
    /// number is worse than no number. Every earlier revision is retained; no ordinary API returns
    /// one.
    /// </remarks>
    public MessageRevision Edit(Guid editorUserId, string normalizedBody, DateTimeOffset now)
    {
        if (editorUserId != SenderUserId)
        {
            throw new InvalidOperationException("Only the sender of a message may edit it.");
        }

        if (IsDeleted)
        {
            throw new InvalidOperationException("A removed message cannot be edited.");
        }

        CurrentRevisionNumber += 1;
        EditedAtUtc = now;
        return MessageRevision.Create(
            TenantId,
            Id,
            CurrentRevisionNumber,
            normalizedBody,
            editorUserId,
            now);
    }

    /// <summary>
    /// The sender removes their own message. One-way and idempotent: a repeated request is a success
    /// that changes nothing rather than a conflict.
    /// </summary>
    /// <returns>The recorded event, or <see langword="null"/> when the message was already removed.</returns>
    public MessageDeletionEvent? DeleteBySender(Guid actorUserId, DateTimeOffset now)
    {
        if (actorUserId != SenderUserId)
        {
            throw new InvalidOperationException("Only the sender of a message may remove it.");
        }

        if (IsDeleted)
        {
            return null;
        }

        DeletedAtUtc = now;
        DeletionKind = MessageDeletionKind.SenderRemoved;
        DeletedByUserId = actorUserId;
        return MessageDeletionEvent.Record(
            TenantId,
            ConversationId,
            Id,
            MessageDeletionKind.SenderRemoved,
            actorUserId,
            reason: null,
            CurrentRevisionNumber,
            now);
    }

    /// <summary>
    /// The explicit coach participant removes the other participant's message, with a required
    /// reason.
    /// </summary>
    /// <remarks>
    /// A moderator removes; a moderator never edits. Rewriting somebody else's words under their name
    /// is not a moderation power, and no code path here offers one. The reason and the removed body
    /// are retained for audit and are not returned to the other participant.
    /// </remarks>
    /// <returns>The recorded event, or <see langword="null"/> when the message was already removed.</returns>
    public MessageDeletionEvent? ModerateRemove(
        Guid moderatorUserId,
        string normalizedReason,
        DateTimeOffset now)
    {
        if (moderatorUserId == SenderUserId)
        {
            throw new InvalidOperationException(
                "Moderation removes the other participant's message; the sender removes their own.");
        }

        ArgumentException.ThrowIfNullOrWhiteSpace(normalizedReason);

        if (IsDeleted)
        {
            return null;
        }

        DeletedAtUtc = now;
        DeletionKind = MessageDeletionKind.CoachModerated;
        DeletedByUserId = moderatorUserId;
        ModerationReason = normalizedReason;
        return MessageDeletionEvent.Record(
            TenantId,
            ConversationId,
            Id,
            MessageDeletionKind.CoachModerated,
            moderatorUserId,
            normalizedReason,
            CurrentRevisionNumber,
            now);
    }
}

/// <summary>
/// One immutable version of a message body.
/// </summary>
/// <remarks>
/// Revision 1 is written with the message. Every edit appends the next number and retains every
/// earlier one, so what a message said at any point is recoverable for audit. No participant-facing
/// API in this slice exposes an old revision: they are history, not a revision browser, and offering
/// one would publish a sentence somebody deliberately replaced.
/// </remarks>
public sealed class MessageRevision : TenantEntity
{
    private MessageRevision()
    {
    }

    private MessageRevision(
        Guid tenantId,
        Guid messageId,
        int revisionNumber,
        string body,
        Guid authoredByUserId,
        DateTimeOffset now)
        : base(tenantId)
    {
        if (messageId == Guid.Empty || authoredByUserId == Guid.Empty)
        {
            throw new ArgumentException("A revision needs a message and an author.");
        }

        ArgumentOutOfRangeException.ThrowIfLessThan(revisionNumber, 1);
        ArgumentException.ThrowIfNullOrWhiteSpace(body);

        MessageId = messageId;
        RevisionNumber = revisionNumber;
        Body = body;
        AuthoredByUserId = authoredByUserId;
        AuthoredAtUtc = now;
    }

    public Guid MessageId { get; private set; }

    public int RevisionNumber { get; private set; }

    public string Body { get; private set; } = string.Empty;

    public Guid AuthoredByUserId { get; private set; }

    public DateTimeOffset AuthoredAtUtc { get; private set; }

    internal static MessageRevision Create(
        Guid tenantId,
        Guid messageId,
        int revisionNumber,
        string body,
        Guid authoredByUserId,
        DateTimeOffset now) =>
        new(tenantId, messageId, revisionNumber, body, authoredByUserId, now);
}

/// <summary>
/// The append-only record of a message being removed.
/// </summary>
/// <remarks>
/// The mutable message row carries the current removal state so a read can render it without a join,
/// but state alone loses the fact: who removed it, when, why, and which revision was current at the
/// time. One event per message, enforced by a unique index, because removal is one-way.
/// </remarks>
public sealed class MessageDeletionEvent : TenantEntity
{
    private MessageDeletionEvent()
    {
    }

    private MessageDeletionEvent(
        Guid tenantId,
        Guid conversationId,
        Guid messageId,
        MessageDeletionKind kind,
        Guid actorUserId,
        string? reason,
        int revisionNumberAtRemoval,
        DateTimeOffset now)
        : base(tenantId)
    {
        if (conversationId == Guid.Empty || messageId == Guid.Empty || actorUserId == Guid.Empty)
        {
            throw new ArgumentException("A deletion event needs a conversation, a message and an actor.");
        }

        if (!Enum.IsDefined(kind))
        {
            throw new ArgumentException("An unknown deletion kind cannot be recorded.", nameof(kind));
        }

        if (kind == MessageDeletionKind.CoachModerated && string.IsNullOrWhiteSpace(reason))
        {
            throw new ArgumentException("A moderation removal requires a reason.", nameof(reason));
        }

        if (kind == MessageDeletionKind.SenderRemoved && reason is not null)
        {
            throw new ArgumentException("A sender removal carries no moderation reason.", nameof(reason));
        }

        ArgumentOutOfRangeException.ThrowIfLessThan(revisionNumberAtRemoval, 1);

        ConversationId = conversationId;
        MessageId = messageId;
        Kind = kind;
        ActorUserId = actorUserId;
        Reason = reason;
        RevisionNumberAtRemoval = revisionNumberAtRemoval;
        OccurredAtUtc = now;
    }

    public Guid ConversationId { get; private set; }

    public Guid MessageId { get; private set; }

    public MessageDeletionKind Kind { get; private set; }

    public Guid ActorUserId { get; private set; }

    public string? Reason { get; private set; }

    public int RevisionNumberAtRemoval { get; private set; }

    public DateTimeOffset OccurredAtUtc { get; private set; }

    internal static MessageDeletionEvent Record(
        Guid tenantId,
        Guid conversationId,
        Guid messageId,
        MessageDeletionKind kind,
        Guid actorUserId,
        string? reason,
        int revisionNumberAtRemoval,
        DateTimeOffset now) =>
        new(
            tenantId,
            conversationId,
            messageId,
            kind,
            actorUserId,
            reason,
            revisionNumberAtRemoval,
            now);
}

/// <summary>Which messaging command an idempotency key was spent on.</summary>
public enum MessagingCommandType
{
    CreateConversation = 1,
    SendMessage = 2,
    EditMessage = 3,
    DeleteMessage = 4,
    ModerateMessage = 5,
}

/// <summary>
/// One spent idempotency key, bound to the normalized payload it was spent on.
/// </summary>
/// <remarks>
/// One table for every messaging command rather than one per command, so a key cannot be spent on a
/// send and then reused for an edit: the unique index is on <c>(TenantId, IdempotencyKey)</c> alone.
/// <para>
/// <see cref="PayloadFingerprint"/> is a SHA-256 of the normalized command — the workspace, the
/// conversation, the actor and the normalized body or reason. An identical retry matches it and
/// returns the original result; a reused key carrying different content does not match and conflicts,
/// writing neither another message nor another revision. Binding to the normalized form is what makes
/// a retry that differs only in line endings or trailing space the same command rather than a new
/// one.
/// </para>
/// </remarks>
public sealed class MessagingCommandRecord : TenantEntity
{
    private MessagingCommandRecord()
    {
    }

    private MessagingCommandRecord(
        Guid tenantId,
        Guid idempotencyKey,
        MessagingCommandType commandType,
        string payloadFingerprint,
        Guid actorUserId,
        Guid conversationId,
        Guid? messageId,
        DateTimeOffset now)
        : base(tenantId)
    {
        if (idempotencyKey == Guid.Empty || actorUserId == Guid.Empty || conversationId == Guid.Empty)
        {
            throw new ArgumentException("A command record needs a key, an actor and a conversation.");
        }

        if (!Enum.IsDefined(commandType))
        {
            throw new ArgumentException("An unknown command type cannot be recorded.", nameof(commandType));
        }

        ArgumentException.ThrowIfNullOrWhiteSpace(payloadFingerprint);

        IdempotencyKey = idempotencyKey;
        CommandType = commandType;
        PayloadFingerprint = payloadFingerprint;
        ActorUserId = actorUserId;
        ConversationId = conversationId;
        MessageId = messageId;
        RecordedAtUtc = now;
    }

    public Guid IdempotencyKey { get; private set; }

    public MessagingCommandType CommandType { get; private set; }

    public string PayloadFingerprint { get; private set; } = string.Empty;

    public Guid ActorUserId { get; private set; }

    public Guid ConversationId { get; private set; }

    public Guid? MessageId { get; private set; }

    public DateTimeOffset RecordedAtUtc { get; private set; }

    public static MessagingCommandRecord Record(
        Guid tenantId,
        Guid idempotencyKey,
        MessagingCommandType commandType,
        string payloadFingerprint,
        Guid actorUserId,
        Guid conversationId,
        Guid? messageId,
        DateTimeOffset now) =>
        new(
            tenantId,
            idempotencyKey,
            commandType,
            payloadFingerprint,
            actorUserId,
            conversationId,
            messageId,
            now);

    /// <summary>
    /// Whether a retry presenting this key is the same command. The type is compared as well as the
    /// fingerprint so a key spent on one operation cannot be honoured by another.
    /// </summary>
    public bool Matches(MessagingCommandType commandType, string payloadFingerprint) =>
        CommandType == commandType &&
        string.Equals(PayloadFingerprint, payloadFingerprint, StringComparison.Ordinal);
}
