using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Messaging;

/// <summary>Which side of a direct conversation a participant is.</summary>
public enum ConversationParticipantRole
{
    Coach = 1,
    Client = 2,
}

/// <summary>
/// One tenant-scoped direct conversation between one coach and one linked client.
/// </summary>
/// <remarks>
/// Phase 6B-2A has exactly one conversation shape: one active Owner or Coach, one linked Client, and
/// the tenant-local client profile whose Messaging entitlement governs both sides. The participant
/// set is explicit and immutable in this slice — there is no add, remove, reassign, leave, invite or
/// second coach — so a conversation's membership is decided once, at creation, and never drifts.
/// <para>
/// Tenant membership alone grants nothing. Another Owner or Coach of the same workspace is not a
/// participant of this conversation and is refused exactly as a stranger is, because a coach opening
/// somebody else's thread is the failure this design exists to prevent.
/// </para>
/// <para>
/// <see cref="LastSequence"/> is the conversation's own sequence allocator. It is advanced under a
/// row lock inside the sending transaction, so committed sequences are unique, gap-free and ordered,
/// and a rolled-back send gives its number back rather than leaving a hole.
/// </para>
/// </remarks>
public sealed class Conversation : TenantEntity
{
    private Conversation()
    {
    }

    private Conversation(
        Guid tenantId,
        Guid clientProfileId,
        Guid coachUserId,
        Guid clientUserId,
        DateTimeOffset now)
        : base(tenantId)
    {
        if (clientProfileId == Guid.Empty || coachUserId == Guid.Empty || clientUserId == Guid.Empty)
        {
            throw new ArgumentException("A direct conversation needs a client profile, a coach and a client.");
        }

        if (coachUserId == clientUserId)
        {
            throw new ArgumentException("A direct conversation needs two different people.");
        }

        ClientProfileId = clientProfileId;
        CoachUserId = coachUserId;
        ClientUserId = clientUserId;
        LastActivityAtUtc = now;
        StartedAtUtc = now;
    }

    /// <summary>
    /// The tenant-local client profile whose Messaging entitlement governs this conversation, for the
    /// coach as much as for the client. Access is a property of the coaching relationship, not of who
    /// happens to be asking.
    /// </summary>
    public Guid ClientProfileId { get; private set; }

    public Guid CoachUserId { get; private set; }

    public Guid ClientUserId { get; private set; }

    public DateTimeOffset StartedAtUtc { get; private set; }

    /// <summary>The newest sequence this conversation has committed. Zero until the first message.</summary>
    public long LastSequence { get; private set; }

    /// <summary>
    /// What the conversation list orders by, newest first, with the identifier as tie-breaker. It is
    /// server-owned and never accepted from a browser.
    /// </summary>
    public DateTimeOffset LastActivityAtUtc { get; private set; }

    public Guid? LastMessageId { get; private set; }

    public static Conversation StartDirect(
        Guid tenantId,
        Guid clientProfileId,
        Guid coachUserId,
        Guid clientUserId,
        DateTimeOffset now) =>
        new(tenantId, clientProfileId, coachUserId, clientUserId, now);

    /// <summary>
    /// The exact two participants of a direct conversation, created with it in one transaction. There
    /// is no code path that adds a third or removes one of these two.
    /// </summary>
    public IReadOnlyList<ConversationParticipant> CreateDirectParticipants() =>
    [
        ConversationParticipant.Join(TenantId, Id, CoachUserId, ConversationParticipantRole.Coach),
        ConversationParticipant.Join(TenantId, Id, ClientUserId, ConversationParticipantRole.Client),
    ];

    /// <summary>
    /// Allocates the next sequence. The caller must already hold this row's lock, because two
    /// allocators reading the same <see cref="LastSequence"/> would both produce the same number and
    /// the loser's insert would be refused by the unique index rather than ordered behind the winner.
    /// </summary>
    public long AllocateNextSequence()
    {
        LastSequence += 1;
        return LastSequence;
    }

    /// <summary>
    /// Records that a message was persisted. Activity never moves backwards, so a clock adjustment
    /// cannot reorder the conversation list under the reader.
    /// </summary>
    public void RecordMessage(Guid messageId, DateTimeOffset now)
    {
        if (messageId == Guid.Empty)
        {
            throw new ArgumentException("A message id is required.", nameof(messageId));
        }

        LastMessageId = messageId;
        LastActivityAtUtc = now > LastActivityAtUtc ? now : LastActivityAtUtc;
    }

    public bool IsParticipant(Guid userId) => userId == CoachUserId || userId == ClientUserId;

    public Guid CounterpartOf(Guid userId) => userId == CoachUserId ? ClientUserId : CoachUserId;
}

/// <summary>
/// One person's explicit membership of one conversation, and their own read cursor.
/// </summary>
/// <remarks>
/// Read state belongs here rather than to the conversation, because "read" is one person's act. A
/// conversation-wide read flag could only ever describe whoever looked last, and a delivery
/// acknowledgement — this slice has none, and Phase 6B-2B will — is not a person looking at all.
/// <para>
/// The cursor only ever moves forward. A concurrent pair of advances resolves to the greater valid
/// sequence, and a database trigger refuses a decrease whatever wrote it.
/// </para>
/// </remarks>
public sealed class ConversationParticipant : TenantEntity
{
    private ConversationParticipant()
    {
    }

    private ConversationParticipant(
        Guid tenantId,
        Guid conversationId,
        Guid userId,
        ConversationParticipantRole role)
        : base(tenantId)
    {
        if (conversationId == Guid.Empty || userId == Guid.Empty || !Enum.IsDefined(role))
        {
            throw new ArgumentException("A participant needs a conversation, a user and a role.");
        }

        ConversationId = conversationId;
        UserId = userId;
        Role = role;
    }

    public Guid ConversationId { get; private set; }

    public Guid UserId { get; private set; }

    public ConversationParticipantRole Role { get; private set; }

    public long LastReadSequence { get; private set; }

    public DateTimeOffset? LastReadAtUtc { get; private set; }

    /// <summary>Only the coach side may moderate, and only the other participant's message.</summary>
    public bool CanModerate => Role == ConversationParticipantRole.Coach;

    /// <summary>
    /// Whether one message is something this participant has not yet read.
    /// </summary>
    /// <remarks>
    /// Four conditions, and the first two are the ones that get forgotten. A participant's own
    /// message is never unread to them, because sending is not being told something; and a removed
    /// message is never unread, because a badge pointing at a body nobody can read is noise rather
    /// than information. This is the canonical statement of the rule — the unread count is its
    /// aggregate form in SQL, and the integration suite proves the two agree.
    /// </remarks>
    public bool CountsAsUnread(Message message)
    {
        ArgumentNullException.ThrowIfNull(message);
        return message.ConversationId == ConversationId &&
               message.SenderUserId != UserId &&
               !message.IsDeleted &&
               message.Sequence > LastReadSequence;
    }

    public static ConversationParticipant Join(
        Guid tenantId,
        Guid conversationId,
        Guid userId,
        ConversationParticipantRole role) =>
        new(tenantId, conversationId, userId, role);

    /// <summary>
    /// Advances this participant's own cursor.
    /// </summary>
    /// <param name="throughSequence">The sequence the caller says it has displayed.</param>
    /// <param name="latestCommittedSequence">The conversation's newest committed sequence.</param>
    /// <param name="now">The server instant to stamp when the cursor moves.</param>
    /// <returns><see langword="true"/> when the cursor actually moved.</returns>
    /// <remarks>
    /// A sequence beyond the newest committed message is <b>clamped down</b> to it rather than
    /// refused. The client reports what it has displayed, and a message committed between rendering
    /// and reporting is a normal race rather than a caller error; clamping records the honest truth —
    /// everything that existed has been read — while making it impossible to mark a message that does
    /// not exist. A request at or below the current cursor is accepted and changes nothing, because
    /// retrying a read report must not be an error.
    /// </remarks>
    public bool AdvanceReadCursor(
        long throughSequence,
        long latestCommittedSequence,
        DateTimeOffset now)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(throughSequence);
        ArgumentOutOfRangeException.ThrowIfNegative(latestCommittedSequence);

        var clamped = Math.Min(throughSequence, latestCommittedSequence);
        if (clamped <= LastReadSequence)
        {
            return false;
        }

        LastReadSequence = clamped;
        LastReadAtUtc = now;
        return true;
    }
}
