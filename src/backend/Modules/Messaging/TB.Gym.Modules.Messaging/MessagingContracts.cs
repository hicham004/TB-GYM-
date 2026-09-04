using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Messaging;

/// <summary>
/// What one participant may know about the other side of a direct conversation.
/// </summary>
/// <remarks>
/// A display name and nothing else. Not an email address, not a phone number, not intake or health
/// data, not a membership list, and not which other coaches a client works with: a messaging screen
/// is not a directory, and every extra field here would be one the workspace never agreed to publish.
/// </remarks>
public sealed record ConversationCounterpart(
    Guid UserId,
    string DisplayName,
    ConversationParticipantRole Role);

/// <summary>
/// A bounded, safe rendering of the newest message in a conversation.
/// </summary>
/// <remarks>
/// <see cref="Body"/> is null for a removed message and for a conversation the caller currently has
/// no Messaging access to. Both cases still carry their metadata, so a list row stays in place and
/// explains itself rather than silently disappearing.
/// </remarks>
public sealed record ConversationMessagePreview(
    Guid MessageId,
    long Sequence,
    Guid SenderUserId,
    bool IsFromCaller,
    DateTimeOffset SentAtUtc,
    string? Body,
    bool IsDeleted,
    MessageDeletionKind? DeletionKind);

/// <summary>One conversation as its own participant sees it.</summary>
public sealed record ConversationSummary(
    Guid Id,
    Guid ClientProfileId,
    ConversationCounterpart Counterpart,
    ConversationParticipantRole CallerRole,
    bool CanModerate,
    DateTimeOffset StartedAtUtc,
    DateTimeOffset LastActivityAtUtc,
    long LastSequence,
    long UnreadCount,
    long LastReadSequence,
    DateTimeOffset? LastReadAtUtc,
    bool IsAvailable,
    FeatureAccessReason AccessReason,
    ConversationMessagePreview? LastMessage);

/// <summary>
/// One keyset page of the caller's own conversations, newest activity first.
/// </summary>
/// <remarks>
/// The cursor is the last row's activity instant and identifier together. Offset paging would
/// silently skip or repeat rows every time a message arrived between two pages, which on a list
/// ordered by activity is not an edge case but the normal state of affairs.
/// </remarks>
public sealed record ConversationPage(
    IReadOnlyList<ConversationSummary> Items,
    bool HasMore,
    DateTimeOffset? NextBeforeActivityAtUtc,
    Guid? NextBeforeConversationId);

/// <summary>One message as a participant sees it.</summary>
/// <remarks>
/// <see cref="Body"/> is null once the message is removed, whichever way it was removed, and the
/// moderation reason is never present at all. <see cref="RevisionNumber"/> says how many times the
/// message has been edited; the earlier revisions themselves are audit history and no ordinary API
/// returns them.
/// </remarks>
public sealed record MessageView(
    Guid Id,
    Guid ConversationId,
    long Sequence,
    Guid SenderUserId,
    bool IsFromCaller,
    DateTimeOffset SentAtUtc,
    DateTimeOffset AvailableAtUtc,
    DateTimeOffset? EditedAtUtc,
    int RevisionNumber,
    string? Body,
    bool IsDeleted,
    MessageDeletionKind? DeletionKind,
    DateTimeOffset? DeletedAtUtc,
    MessageDeliveryState DeliveryState,
    bool CanEdit,
    bool CanDelete,
    bool CanModerate,
    bool IsUnreadByCaller,
    uint Version);

/// <summary>The caller's own read cursor for one conversation, as the server holds it.</summary>
public sealed record ConversationReadState(
    Guid ConversationId,
    Guid UserId,
    ConversationParticipantRole Role,
    long LastReadSequence,
    DateTimeOffset? LastReadAtUtc,
    long UnreadCount,
    long LatestSequence);

/// <summary>
/// One ascending page of history.
/// </summary>
/// <remarks>
/// Rows are returned oldest first even though PostgreSQL retrieves them newest first, because that is
/// the order a thread is read in and reversing in the browser is one more place to get it wrong.
/// <see cref="OldestSequence"/> is the cursor for the next older page; it is stable under insertion,
/// because a newer message never changes which sequences are older than a given one.
/// </remarks>
/// <param name="LatestEventSequence">
/// The conversation's realtime watermark at the moment this page was read.
/// <para>
/// It is here because a client has to be able to say "everything up to this point is already on my
/// screen" before it starts merging deltas, and the full read is the only thing that establishes
/// that. A conversation created before Phase 6B-2B reports zero, which is the honest answer: it has
/// no events, and its current state came from this read rather than from a delta. Subscribing and
/// then catching up from this watermark is what closes the window between the two.
/// </para>
/// </param>
public sealed record MessagePage(
    Guid ConversationId,
    IReadOnlyList<MessageView> Items,
    bool HasOlder,
    long? OldestSequence,
    long LatestSequence,
    long LatestEventSequence,
    ConversationReadState ReadState);

/// <summary>One conversation plus the caller's own view of their position in it.</summary>
public sealed record ConversationDetail(
    ConversationSummary Conversation,
    ConversationReadState ReadState);

public sealed record CreateDirectConversationRequest(Guid ClientProfileId, Guid IdempotencyKey);

public sealed record SendMessageRequest(string Body, Guid IdempotencyKey);

public sealed record EditMessageRequest(string Body, uint ExpectedVersion, Guid IdempotencyKey);

public sealed record DeleteMessageRequest(uint ExpectedVersion, Guid IdempotencyKey);

public sealed record ModerateMessageRequest(string Reason, uint ExpectedVersion, Guid IdempotencyKey);

public sealed record AdvanceReadCursorRequest(long ThroughSequence);

public sealed record MessagingUnreadCount(long Unread);

public enum MessagingCommandStatus
{
    Success = 1,
    NotFound = 2,
    Invalid = 3,
    Conflict = 4,
    Forbidden = 5,
}

/// <summary>Stable conflict codes, so a screen never has to read prose to decide what happened.</summary>
public static class MessagingConflictCodes
{
    public const string IdempotencyKeyReused = "messaging_idempotency_key_reused";

    public const string StaleMessageVersion = "messaging_stale_message_version";

    public const string MessageAlreadyRemoved = "messaging_message_already_removed";
}

public sealed record ConversationCommandResult(
    MessagingCommandStatus Status,
    ConversationDetail? Conversation = null,
    string? Field = null,
    string? Message = null,
    string? Code = null,
    FeatureAccessReason? AccessReason = null)
{
    public static ConversationCommandResult Success(ConversationDetail conversation) =>
        new(MessagingCommandStatus.Success, conversation);

    public static ConversationCommandResult NotFound() => new(MessagingCommandStatus.NotFound);

    public static ConversationCommandResult Invalid(string field, string message) =>
        new(MessagingCommandStatus.Invalid, Field: field, Message: message);

    public static ConversationCommandResult Conflict(string code, string message) =>
        new(MessagingCommandStatus.Conflict, Code: code, Message: message);

    public static ConversationCommandResult Forbidden(FeatureAccessReason reason) =>
        new(MessagingCommandStatus.Forbidden, AccessReason: reason);
}

public sealed record MessageCommandResult(
    MessagingCommandStatus Status,
    MessageView? Message = null,
    string? Field = null,
    string? Detail = null,
    string? Code = null,
    FeatureAccessReason? AccessReason = null)
{
    public static MessageCommandResult Success(MessageView message) =>
        new(MessagingCommandStatus.Success, message);

    public static MessageCommandResult NotFound() => new(MessagingCommandStatus.NotFound);

    public static MessageCommandResult Invalid(string field, string detail) =>
        new(MessagingCommandStatus.Invalid, Field: field, Detail: detail);

    public static MessageCommandResult Conflict(string code, string detail) =>
        new(MessagingCommandStatus.Conflict, Code: code, Detail: detail);

    public static MessageCommandResult Forbidden(FeatureAccessReason reason) =>
        new(MessagingCommandStatus.Forbidden, AccessReason: reason);
}

public sealed record MessagePageResult(
    MessagingCommandStatus Status,
    MessagePage? Page = null,
    string? Field = null,
    string? Detail = null,
    FeatureAccessReason? AccessReason = null)
{
    public static MessagePageResult Success(MessagePage page) => new(MessagingCommandStatus.Success, page);

    public static MessagePageResult NotFound() => new(MessagingCommandStatus.NotFound);

    public static MessagePageResult Invalid(string field, string detail) =>
        new(MessagingCommandStatus.Invalid, Field: field, Detail: detail);

    public static MessagePageResult Forbidden(FeatureAccessReason reason) =>
        new(MessagingCommandStatus.Forbidden, AccessReason: reason);
}

public sealed record ReadStateCommandResult(
    MessagingCommandStatus Status,
    ConversationReadState? ReadState = null,
    string? Field = null,
    string? Detail = null,
    FeatureAccessReason? AccessReason = null)
{
    public static ReadStateCommandResult Success(ConversationReadState readState) =>
        new(MessagingCommandStatus.Success, readState);

    public static ReadStateCommandResult NotFound() => new(MessagingCommandStatus.NotFound);

    public static ReadStateCommandResult Invalid(string field, string detail) =>
        new(MessagingCommandStatus.Invalid, Field: field, Detail: detail);

    public static ReadStateCommandResult Forbidden(FeatureAccessReason reason) =>
        new(MessagingCommandStatus.Forbidden, AccessReason: reason);
}

/// <summary>Paging bounds shared by the endpoints and the application service.</summary>
public static class MessagingPaging
{
    public const int DefaultConversationPageSize = 25;

    public const int MaximumConversationPageSize = 100;

    public const int DefaultMessagePageSize = 50;

    public const int MaximumMessagePageSize = 100;

    public static int NormalizeConversationTake(int? take) =>
        take is null or <= 0
            ? DefaultConversationPageSize
            : Math.Min(take.Value, MaximumConversationPageSize);

    public static int NormalizeMessageTake(int? take) =>
        take is null or <= 0
            ? DefaultMessagePageSize
            : Math.Min(take.Value, MaximumMessagePageSize);
}

/// <summary>
/// Every messaging read and write, scoped to the active workspace and the signed-in caller.
/// </summary>
/// <remarks>
/// Nothing here accepts a user identifier: the caller is the signed-in user, always. Every operation
/// requires both an explicit participant row and a current <see cref="CoachingFeature.Messaging"/>
/// decision for the conversation's client profile, and those are separate requirements — being a
/// member of the workspace grants neither.
/// </remarks>
public interface IMessagingApplicationService
{
    Task<ConversationPage> ListConversationsAsync(
        DateTimeOffset? beforeActivityAtUtc,
        Guid? beforeConversationId,
        int take,
        CancellationToken cancellationToken);

    Task<ConversationCommandResult> CreateDirectConversationAsync(
        CreateDirectConversationRequest request,
        CancellationToken cancellationToken);

    Task<MessagePageResult> ListMessagesAsync(
        Guid conversationId,
        long? beforeSequence,
        int take,
        CancellationToken cancellationToken);

    Task<MessageCommandResult> SendAsync(
        Guid conversationId,
        SendMessageRequest request,
        CancellationToken cancellationToken);

    Task<MessageCommandResult> EditAsync(
        Guid conversationId,
        Guid messageId,
        EditMessageRequest request,
        CancellationToken cancellationToken);

    Task<MessageCommandResult> DeleteAsync(
        Guid conversationId,
        Guid messageId,
        DeleteMessageRequest request,
        CancellationToken cancellationToken);

    Task<MessageCommandResult> ModerateAsync(
        Guid conversationId,
        Guid messageId,
        ModerateMessageRequest request,
        CancellationToken cancellationToken);

    Task<ReadStateCommandResult> AdvanceReadCursorAsync(
        Guid conversationId,
        AdvanceReadCursorRequest request,
        CancellationToken cancellationToken);

    Task<MessagingUnreadCount> CountUnreadAsync(CancellationToken cancellationToken);

    /// <summary>
    /// One bounded, ascending page of realtime events for a conversation the caller may read now.
    /// </summary>
    /// <remarks>
    /// Authorization is identical to opening the conversation: the same participation, block and
    /// Messaging decisions, resolved before the cursor is looked at. Each event carries the
    /// caller-specific current safe projection, materialized at read time, so a removed message
    /// arrives as its tombstone and an old revision is never republished.
    /// </remarks>
    Task<RealtimeEventPageResult> ListRealtimeEventsAsync(
        Guid conversationId,
        long? afterEventSequence,
        int take,
        CancellationToken cancellationToken);

    /// <summary>
    /// Records that this caller's application accepted the named events.
    /// </summary>
    /// <remarks>
    /// The acknowledging participant is the signed-in caller; no user identifier is accepted from the
    /// request. It writes an append-only fact per event and participant, it is idempotent under a
    /// unique key, and it changes neither participant's read cursor nor any unread count.
    /// </remarks>
    Task<RealtimeAcknowledgementCommandResult> AcknowledgeRealtimeEventsAsync(
        Guid conversationId,
        AcknowledgeRealtimeEventsRequest request,
        CancellationToken cancellationToken);
}
