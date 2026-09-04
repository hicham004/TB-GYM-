using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Messaging;

/// <summary>
/// What externally visible thing happened to a conversation.
/// </summary>
/// <remarks>
/// One member per 6B-2A command mutation that another participant could observe. There is
/// deliberately no read-receipt kind: the read cursor is one person's own act, it is reported over
/// REST by the person who read, and publishing "they have seen it" is a product decision nobody has
/// taken.
/// </remarks>
public enum MessagingRealtimeEventKind
{
    ConversationCreated = 1,
    MessageSent = 2,
    MessageEdited = 3,
    MessageSenderRemoved = 4,
    MessageCoachModerated = 5,
}

/// <summary>
/// How far one recipient's publication of one event has got.
/// </summary>
/// <remarks>
/// <see cref="Published"/> means the hub — and behind it, possibly a Redis backplane — accepted the
/// frame. It is not <c>Delivered</c> and it is not <c>Read</c>. Nobody's browser has been asked, and
/// a socket that accepted a write can still be gone by the time the bytes reach it. What the other
/// side actually accepted is a separate append-only fact,
/// <see cref="MessagingRealtimeAcknowledgement"/>, and what a person actually read is a third one on
/// the participant row.
/// </remarks>
public enum MessagingRealtimeStatus
{
    Pending = 1,
    Processing = 2,
    Published = 3,
    Suppressed = 4,
    DeadLettered = 5,
}

/// <summary>How one durably started publication attempt ended.</summary>
public enum MessagingRealtimeOutcome
{
    Started = 1,
    Published = 2,
    TransientFailure = 3,
    PermanentFailure = 4,
    Abandoned = 5,
    Suppressed = 6,
}

/// <summary>
/// One content-free record that something happened in a conversation, written in the same
/// transaction as the mutation it describes.
/// </summary>
/// <remarks>
/// The event sequence is deliberately <b>not</b> the message sequence. An edit or a removal of an old
/// message happens after newer messages have been sent, so a client catching up from a message
/// sequence would never see it: the message it concerns is already behind the cursor. Two counters
/// answer two different questions — "which messages exist" and "what has happened since I last
/// looked" — and only the second can be resumed from.
/// <para>
/// The row holds routing and audit facts only: which workspace, which conversation, which position,
/// what kind of thing happened, which message and which revision of it, which command produced it,
/// and when the server observed it. It carries no body, no previous revision, no moderation reason,
/// no name, no address, no client profile and no rendered or serialized payload. The safe projection
/// a participant is allowed to see is built at delivery time, from the live tables, after that
/// participant's current authorization has been re-established — so an event that outlives somebody's
/// access can never be replayed into content.
/// </para>
/// </remarks>
public sealed class MessagingRealtimeEvent : TenantEntity
{
    private MessagingRealtimeEvent()
    {
    }

    private MessagingRealtimeEvent(
        Guid tenantId,
        Guid conversationId,
        long eventSequence,
        MessagingRealtimeEventKind kind,
        Guid? messageId,
        long? messageSequence,
        int? messageRevisionNumber,
        Guid sourceCommandRecordId,
        DateTimeOffset now)
        : base(tenantId)
    {
        if (conversationId == Guid.Empty || sourceCommandRecordId == Guid.Empty)
        {
            throw new ArgumentException("A realtime event needs a conversation and a source command.");
        }

        if (!Enum.IsDefined(kind))
        {
            throw new ArgumentException("An unknown realtime event kind cannot be recorded.", nameof(kind));
        }

        ArgumentOutOfRangeException.ThrowIfLessThan(eventSequence, 1);

        var describesMessage = kind != MessagingRealtimeEventKind.ConversationCreated;
        if (describesMessage != (messageId is not null) ||
            describesMessage != (messageSequence is not null) ||
            describesMessage != (messageRevisionNumber is not null))
        {
            throw new ArgumentException(
                "Every realtime event except a conversation creation names exactly one message.");
        }

        if (messageSequence is { } sequence)
        {
            ArgumentOutOfRangeException.ThrowIfLessThan(sequence, 1);
        }

        if (messageRevisionNumber is { } revision)
        {
            ArgumentOutOfRangeException.ThrowIfLessThan(revision, 1);
        }

        ConversationId = conversationId;
        EventSequence = eventSequence;
        Kind = kind;
        MessageId = messageId;
        MessageSequence = messageSequence;
        MessageRevisionNumber = messageRevisionNumber;
        SourceCommandRecordId = sourceCommandRecordId;
        OccurredAtUtc = now;
    }

    public Guid ConversationId { get; private set; }

    /// <summary>
    /// Positive, unique and gap-free within the conversation, allocated under the same row lock the
    /// message sequence uses. A rolled-back command gives its number back.
    /// </summary>
    public long EventSequence { get; private set; }

    public MessagingRealtimeEventKind Kind { get; private set; }

    public Guid? MessageId { get; private set; }

    /// <summary>
    /// The immutable position of the message this event concerns. Retained so a client can place an
    /// edit of an old message back where it belongs rather than at the tip.
    /// </summary>
    public long? MessageSequence { get; private set; }

    /// <summary>
    /// Which revision was current when the event happened. It is a version marker, never a body: a
    /// client uses it to reject a projection older than one it has already merged.
    /// </summary>
    public int? MessageRevisionNumber { get; private set; }

    /// <summary>
    /// The spent idempotency record that produced this event. One event per source mutation, enforced
    /// by a unique index, so an identical replay of a settled command cannot allocate a second event.
    /// </summary>
    public Guid SourceCommandRecordId { get; private set; }

    public DateTimeOffset OccurredAtUtc { get; private set; }

    public static MessagingRealtimeEvent Record(
        Guid tenantId,
        Guid conversationId,
        long eventSequence,
        MessagingRealtimeEventKind kind,
        Guid? messageId,
        long? messageSequence,
        int? messageRevisionNumber,
        Guid sourceCommandRecordId,
        DateTimeOffset now) =>
        new(
            tenantId,
            conversationId,
            eventSequence,
            kind,
            messageId,
            messageSequence,
            messageRevisionNumber,
            sourceCommandRecordId,
            now);

    /// <summary>
    /// The publication state for each explicit participant, created with the event in the same
    /// transaction.
    /// </summary>
    /// <remarks>
    /// Both participants get a row, including the one who caused the event. Their own other tabs and
    /// devices still need to be told, and giving the actor a row is also what makes a sender
    /// acknowledgement expressible without letting it be mistaken for the counterpart's — the
    /// acknowledgement is bound to the recipient row it answers, and the message delivery timestamp
    /// is only ever written from the other participant's.
    /// </remarks>
    public IReadOnlyList<MessagingRealtimeRecipient> CreateRecipients(
        IReadOnlyList<Guid> participantUserIds,
        DateTimeOffset dueAtUtc)
    {
        ArgumentNullException.ThrowIfNull(participantUserIds);
        if (participantUserIds.Count == 0)
        {
            throw new ArgumentException("A realtime event needs at least one recipient.", nameof(participantUserIds));
        }

        return [.. participantUserIds.Distinct().Select(userId =>
            MessagingRealtimeRecipient.Queue(TenantId, ConversationId, Id, userId, dueAtUtc))];
    }
}

/// <summary>
/// One event's publication state for one explicit participant.
/// </summary>
/// <remarks>
/// Per recipient rather than per event, because the two sides of a conversation are authorized
/// separately and can stop being authorized at different moments. A coach whose membership is
/// revoked between the send and the sweep must be suppressed while the client is still published to,
/// and one row per event could only ever decide that once, for both.
/// <para>
/// The lifecycle is the one Phase 6B-1 proved for notifications: Pending, claimed under a random
/// token and a lease, then Published, Suppressed or DeadLettered. Every finalization presents the
/// token it was issued, so a worker whose lease expired and whose row has since been taken over
/// cannot overwrite the newer worker's result.
/// </para>
/// </remarks>
public sealed class MessagingRealtimeRecipient : TenantEntity
{
    private MessagingRealtimeRecipient()
    {
    }

    private MessagingRealtimeRecipient(
        Guid tenantId,
        Guid conversationId,
        Guid realtimeEventId,
        Guid recipientUserId,
        DateTimeOffset dueAtUtc)
        : base(tenantId)
    {
        if (conversationId == Guid.Empty || realtimeEventId == Guid.Empty || recipientUserId == Guid.Empty)
        {
            throw new ArgumentException("A realtime recipient needs a conversation, an event and a participant.");
        }

        ConversationId = conversationId;
        RealtimeEventId = realtimeEventId;
        RecipientUserId = recipientUserId;
        NextAttemptAtUtc = dueAtUtc;
        Status = MessagingRealtimeStatus.Pending;
    }

    public Guid ConversationId { get; private set; }

    public Guid RealtimeEventId { get; private set; }

    public Guid RecipientUserId { get; private set; }

    public MessagingRealtimeStatus Status { get; private set; }

    /// <summary>Every durably started attempt, including one abandoned when a lease expired.</summary>
    public int AttemptCount { get; private set; }

    public DateTimeOffset NextAttemptAtUtc { get; private set; }

    /// <summary>The lease a dispatcher holds. Cleared by every terminal transition.</summary>
    public Guid? ClaimToken { get; private set; }

    public DateTimeOffset? ClaimExpiresAtUtc { get; private set; }

    /// <summary>
    /// When the hub accepted the frame. Named for what actually happened: the hub, and behind it the
    /// backplane, took the write. Nobody has been shown anything.
    /// </summary>
    public DateTimeOffset? PublishedAtUtc { get; private set; }

    public DateTimeOffset? CompletedAtUtc { get; private set; }

    /// <summary>
    /// A stable, bounded, content-free classification. Never an exception message, never a Redis
    /// endpoint, never anything about the message it was carrying.
    /// </summary>
    public string? FailureCode { get; private set; }

    public bool IsTerminal => Status is MessagingRealtimeStatus.Published
        or MessagingRealtimeStatus.Suppressed
        or MessagingRealtimeStatus.DeadLettered;

    public static MessagingRealtimeRecipient Queue(
        Guid tenantId,
        Guid conversationId,
        Guid realtimeEventId,
        Guid recipientUserId,
        DateTimeOffset dueAtUtc) =>
        new(tenantId, conversationId, realtimeEventId, recipientUserId, dueAtUtc);

    public bool IsClaimable(DateTimeOffset now) =>
        (Status == MessagingRealtimeStatus.Pending && NextAttemptAtUtc <= now) || IsClaimExpired(now);

    public bool IsClaimExpired(DateTimeOffset now) =>
        Status == MessagingRealtimeStatus.Processing &&
        ClaimExpiresAtUtc is { } expiry &&
        expiry <= now;

    /// <summary>
    /// Takes the lease and starts the next attempt.
    /// </summary>
    /// <remarks>
    /// The attempt number is incremented here, before anything is published, so a process that dies
    /// mid-publication has still spent its attempt. That is what makes the budget a real bound rather
    /// than a count of successes.
    /// </remarks>
    public Guid Claim(DateTimeOffset now, TimeSpan lease, int maximumAttempts)
    {
        if (lease <= TimeSpan.Zero)
        {
            throw new ArgumentOutOfRangeException(nameof(lease), "A claim lease must be positive.");
        }

        MessagingRealtimeOptions.ValidateMaximumAttempts(maximumAttempts);

        if (!IsClaimable(now))
        {
            throw new InvalidOperationException("This realtime publication is not claimable.");
        }

        if (AttemptCount >= maximumAttempts)
        {
            throw new InvalidOperationException("This realtime publication has exhausted its attempts.");
        }

        AttemptCount++;
        Status = MessagingRealtimeStatus.Processing;
        ClaimToken = Guid.CreateVersion7();
        ClaimExpiresAtUtc = now.Add(lease);
        return ClaimToken.Value;
    }

    /// <summary>
    /// Closes work whose already-started attempts consumed the budget, without inventing a
    /// replacement attempt merely to record exhaustion.
    /// </summary>
    public void MarkAttemptsExhausted(DateTimeOffset now)
    {
        if (IsTerminal)
        {
            throw new InvalidOperationException("A terminal realtime publication cannot exhaust attempts again.");
        }

        if (Status != MessagingRealtimeStatus.Pending && !IsClaimExpired(now))
        {
            throw new InvalidOperationException("Only due or expired realtime work can exhaust its attempts.");
        }

        Status = MessagingRealtimeStatus.DeadLettered;
        CompletedAtUtc = now;
        FailureCode = MessagingRealtimeFailureCodes.AttemptsExhausted;
        ReleaseClaim();
    }

    public void MarkPublished(Guid claimToken, DateTimeOffset now)
    {
        RequireClaim(claimToken);
        Status = MessagingRealtimeStatus.Published;
        PublishedAtUtc = now;
        CompletedAtUtc = now;
        FailureCode = null;
        ReleaseClaim();
    }

    public void MarkRetrying(Guid claimToken, DateTimeOffset nextAttemptAtUtc, string failureCode)
    {
        RequireClaim(claimToken);
        Status = MessagingRealtimeStatus.Pending;
        NextAttemptAtUtc = nextAttemptAtUtc;
        FailureCode = Normalize(failureCode, nameof(failureCode));
        ReleaseClaim();
    }

    public void MarkDeadLettered(Guid claimToken, DateTimeOffset now, string failureCode)
    {
        RequireClaim(claimToken);
        Status = MessagingRealtimeStatus.DeadLettered;
        CompletedAtUtc = now;
        FailureCode = Normalize(failureCode, nameof(failureCode));
        ReleaseClaim();
    }

    /// <summary>
    /// Current authorization went away. Suppression is not failure: nothing broke, this participant
    /// simply may no longer be told, and no frame is built or sent.
    /// </summary>
    public void Suppress(Guid claimToken, DateTimeOffset now, string reasonCode)
    {
        RequireClaim(claimToken);
        Status = MessagingRealtimeStatus.Suppressed;
        CompletedAtUtc = now;
        FailureCode = Normalize(reasonCode, nameof(reasonCode));
        ReleaseClaim();
    }

    /// <summary>
    /// Suppression discovered inside the claim transaction, before any attempt was started. It costs
    /// no attempt, because nothing was tried.
    /// </summary>
    public void SuppressBeforeClaim(DateTimeOffset now, string reasonCode)
    {
        if (IsTerminal)
        {
            throw new InvalidOperationException("A terminal realtime publication cannot be suppressed again.");
        }

        if (Status != MessagingRealtimeStatus.Pending && !IsClaimExpired(now))
        {
            throw new InvalidOperationException("Only due or expired realtime work can be suppressed before a claim.");
        }

        Status = MessagingRealtimeStatus.Suppressed;
        CompletedAtUtc = now;
        FailureCode = Normalize(reasonCode, nameof(reasonCode));
        ReleaseClaim();
    }

    private void RequireClaim(Guid claimToken)
    {
        if (Status != MessagingRealtimeStatus.Processing)
        {
            throw new InvalidOperationException("Only a claimed realtime publication can be finalized.");
        }

        if (ClaimToken != claimToken)
        {
            throw new InvalidOperationException("This realtime publication is held by a different claim.");
        }
    }

    private void ReleaseClaim()
    {
        ClaimToken = null;
        ClaimExpiresAtUtc = null;
    }

    private static string Normalize(string value, string parameterName)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(value);
        var normalized = value.Trim();
        return normalized.Length <= 100
            ? normalized
            : throw new ArgumentException("A failure code cannot exceed 100 characters.", parameterName);
    }
}

/// <summary>
/// One durably started try at publishing one event to one participant. Append-only.
/// </summary>
/// <remarks>
/// The row exists before the frame is built, so a dispatcher that dies leaves evidence rather than
/// silence, and the attempt numbers form the contiguous chain <c>1..AttemptCount</c> that a database
/// trigger asserts. A completed attempt is immutable and is never deleted; it is the only thing that
/// can afterwards explain why something was never published.
/// </remarks>
public sealed class MessagingRealtimeAttempt : TenantEntity
{
    private MessagingRealtimeAttempt()
    {
    }

    private MessagingRealtimeAttempt(
        Guid tenantId,
        Guid recipientId,
        int attemptNumber,
        Guid claimToken,
        DateTimeOffset startedAtUtc)
        : base(tenantId)
    {
        if (recipientId == Guid.Empty || claimToken == Guid.Empty)
        {
            throw new ArgumentException("A realtime attempt needs a recipient state and a claim token.");
        }

        ArgumentOutOfRangeException.ThrowIfLessThan(attemptNumber, 1);
        ArgumentOutOfRangeException.ThrowIfGreaterThan(
            attemptNumber,
            MessagingRealtimeOptions.MaximumMaximumAttempts);

        RecipientId = recipientId;
        AttemptNumber = attemptNumber;
        ClaimToken = claimToken;
        StartedAtUtc = startedAtUtc;
        Outcome = MessagingRealtimeOutcome.Started;
    }

    public Guid RecipientId { get; private set; }

    public int AttemptNumber { get; private set; }

    /// <summary>The claim this attempt belongs to, so a stale dispatcher cannot finish it.</summary>
    public Guid ClaimToken { get; private set; }

    public DateTimeOffset StartedAtUtc { get; private set; }

    public DateTimeOffset? CompletedAtUtc { get; private set; }

    public MessagingRealtimeOutcome Outcome { get; private set; }

    public string? FailureCode { get; private set; }

    public bool IsCompleted => Outcome != MessagingRealtimeOutcome.Started;

    public static MessagingRealtimeAttempt Start(
        Guid tenantId,
        Guid recipientId,
        int attemptNumber,
        Guid claimToken,
        DateTimeOffset startedAtUtc) =>
        new(tenantId, recipientId, attemptNumber, claimToken, startedAtUtc);

    /// <summary>The hub accepted the frame. Not delivery, and certainly not reading.</summary>
    public void Publish(DateTimeOffset now) => Complete(MessagingRealtimeOutcome.Published, now, null);

    public void FailTransiently(DateTimeOffset now, string failureCode) =>
        Complete(MessagingRealtimeOutcome.TransientFailure, now, failureCode);

    public void FailPermanently(DateTimeOffset now, string failureCode) =>
        Complete(MessagingRealtimeOutcome.PermanentFailure, now, failureCode);

    public void Suppress(DateTimeOffset now, string reasonCode) =>
        Complete(MessagingRealtimeOutcome.Suppressed, now, reasonCode);

    public void Abandon(DateTimeOffset now, string failureCode) =>
        Complete(MessagingRealtimeOutcome.Abandoned, now, failureCode);

    private void Complete(MessagingRealtimeOutcome outcome, DateTimeOffset now, string? failureCode)
    {
        if (IsCompleted)
        {
            throw new InvalidOperationException("A completed realtime attempt is immutable.");
        }

        Outcome = outcome;
        CompletedAtUtc = now;
        if (failureCode is null)
        {
            FailureCode = null;
            return;
        }

        ArgumentException.ThrowIfNullOrWhiteSpace(failureCode);
        var normalized = failureCode.Trim();
        FailureCode = normalized.Length <= 100
            ? normalized
            : throw new ArgumentException("A failure code cannot exceed 100 characters.", nameof(failureCode));
    }
}

/// <summary>
/// One participant's application accepting one event. Append-only, server-stamped, never moved.
/// </summary>
/// <remarks>
/// This is the third of four separate facts and the only one this phase can newly establish about
/// the far side. Publication says the hub took the frame; this says the other application received a
/// current safe projection and merged it, whether live or through catch-up; the participant's read
/// cursor says a person looked; and a future provider acknowledgement would say an external channel
/// accepted it. None of them is any of the others, and nothing here writes read state.
/// <para>
/// It is bound by foreign key to the recipient row it answers, so an event nobody addressed to this
/// participant cannot be acknowledged by them at all, and the acknowledging user is taken from the
/// authenticated principal rather than from the request.
/// </para>
/// </remarks>
public sealed class MessagingRealtimeAcknowledgement : TenantEntity
{
    private MessagingRealtimeAcknowledgement()
    {
    }

    private MessagingRealtimeAcknowledgement(
        Guid tenantId,
        Guid conversationId,
        Guid realtimeEventId,
        Guid acknowledgedByUserId,
        DateTimeOffset now)
        : base(tenantId)
    {
        if (conversationId == Guid.Empty || realtimeEventId == Guid.Empty || acknowledgedByUserId == Guid.Empty)
        {
            throw new ArgumentException(
                "A realtime acknowledgement needs a conversation, an event and the acknowledging participant.");
        }

        ConversationId = conversationId;
        RealtimeEventId = realtimeEventId;
        AcknowledgedByUserId = acknowledgedByUserId;
        AcknowledgedAtUtc = now;
    }

    public Guid ConversationId { get; private set; }

    public Guid RealtimeEventId { get; private set; }

    public Guid AcknowledgedByUserId { get; private set; }

    /// <summary>The server clock, always. No browser instant is ever accepted here.</summary>
    public DateTimeOffset AcknowledgedAtUtc { get; private set; }

    public static MessagingRealtimeAcknowledgement Record(
        Guid tenantId,
        Guid conversationId,
        Guid realtimeEventId,
        Guid acknowledgedByUserId,
        DateTimeOffset now) =>
        new(tenantId, conversationId, realtimeEventId, acknowledgedByUserId, now);
}
