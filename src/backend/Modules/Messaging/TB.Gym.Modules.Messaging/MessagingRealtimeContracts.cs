using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Messaging;

/// <summary>
/// One realtime event as an authorized participant is allowed to see it.
/// </summary>
/// <remarks>
/// The same shape on the socket and in a catch-up page, deliberately: a client that had to merge two
/// shapes would end up with two merge rules and one of them would be wrong. <see cref="Message"/> is
/// the caller-specific current safe projection, built after that caller's authorization was
/// re-established, so a removed message arrives as the ordinary tombstone with no body — and never
/// with a moderation reason, which no participant-facing projection carries at all.
/// </remarks>
public sealed record RealtimeEventView(
    Guid TenantId,
    Guid ConversationId,
    Guid EventId,
    long EventSequence,
    MessagingRealtimeEventKind Kind,
    DateTimeOffset OccurredAtUtc,
    MessageView? Message);

/// <summary>
/// The compact signal that something changed in a conversation, carrying no content at all.
/// </summary>
/// <remarks>
/// Sent to the tenant-user group so the root service can debounce a bounded conversation-list and
/// unread refresh. A thread the reader does not have open needs to move up the list and change its
/// badge; it does not need the message. Keeping the two signals apart is what stops an unopened
/// conversation's body being pushed to a browser that had no reason to hold it.
/// </remarks>
public sealed record RealtimeConversationInvalidation(
    Guid TenantId,
    Guid ConversationId,
    long EventSequence,
    DateTimeOffset OccurredAtUtc);

/// <summary>
/// Everything the server may send a connected client, and nothing else.
/// </summary>
/// <remarks>
/// A strongly typed hub client, so the two frames are a compile-time contract rather than a magic
/// string that drifts from whatever the browser is listening for.
/// </remarks>
public interface IMessagingRealtimeClient
{
    /// <summary>A bounded list/unread refresh is worth doing for this conversation.</summary>
    Task ConversationChanged(RealtimeConversationInvalidation invalidation);

    /// <summary>A full, caller-safe event for a thread this connection has explicitly subscribed to.</summary>
    Task RealtimeEvent(RealtimeEventView realtimeEvent);
}

/// <summary>
/// One bounded, ascending page of realtime events for one conversation.
/// </summary>
/// <remarks>
/// The cursor is the event sequence, not the message sequence, which is the whole reason this
/// endpoint exists: an edit or a removal of an old message is a new event about an old position, and
/// a client resuming from a message sequence would never ask for it.
/// <para>
/// <see cref="LatestEventSequence"/> is the conversation's current watermark. It is what an initial
/// load uses to start from "now" without replaying the history it has just fetched in full, and it is
/// what a conversation created before this phase reports as zero — those rows have no events, and
/// their current state came from the ordinary REST read.
/// </para>
/// </remarks>
public sealed record RealtimeEventPage(
    Guid ConversationId,
    IReadOnlyList<RealtimeEventView> Items,
    bool HasMore,
    long? NextAfterEventSequence,
    long LatestEventSequence);

/// <summary>
/// The events this client accepted, by conversation event sequence.
/// </summary>
/// <remarks>
/// No user identifier: the acknowledging participant is the signed-in caller, always. Accepting a
/// transport frame is not acknowledgement — the browser sends this only after it has checked the
/// event belongs to the workspace, account and conversation it is currently showing and has merged
/// it.
/// </remarks>
public sealed record AcknowledgeRealtimeEventsRequest(IReadOnlyList<long> EventSequences);

/// <summary>What one acknowledgement batch actually recorded.</summary>
/// <remarks>
/// <see cref="Accepted"/> counts the sequences that named an event currently addressed to and visible
/// to this caller. <see cref="AlreadyAcknowledged"/> counts the ones that were already a durable
/// fact, because a retry after a lost response must be a success rather than an error.
/// </remarks>
public sealed record RealtimeAcknowledgementResult(
    Guid ConversationId,
    int Accepted,
    int AlreadyAcknowledged,
    long LatestEventSequence);

/// <summary>Bounds shared by the realtime endpoints, the service and the browser.</summary>
public static class MessagingRealtimePaging
{
    public const int DefaultEventPageSize = 50;

    public const int MaximumEventPageSize = 100;

    /// <summary>
    /// The most sequences one acknowledgement request may carry. A batch is a convenience, not a
    /// bulk-import channel, and an unbounded list is an unbounded amount of work per request.
    /// </summary>
    public const int MaximumAcknowledgementBatch = 100;

    public static int NormalizeEventTake(int? take) =>
        take is null or <= 0
            ? DefaultEventPageSize
            : Math.Min(take.Value, MaximumEventPageSize);
}

/// <summary>
/// The bounded result shape the realtime reads use, matching the 6B-2A result convention.
/// </summary>
public sealed record RealtimeEventPageResult(
    MessagingCommandStatus Status,
    RealtimeEventPage? Page = null,
    string? Field = null,
    string? Detail = null,
    FeatureAccessReason? AccessReason = null)
{
    public static RealtimeEventPageResult Success(RealtimeEventPage page) =>
        new(MessagingCommandStatus.Success, page);

    public static RealtimeEventPageResult NotFound() => new(MessagingCommandStatus.NotFound);

    public static RealtimeEventPageResult Invalid(string field, string detail) =>
        new(MessagingCommandStatus.Invalid, Field: field, Detail: detail);

    public static RealtimeEventPageResult Forbidden(FeatureAccessReason reason) =>
        new(MessagingCommandStatus.Forbidden, AccessReason: reason);
}

public sealed record RealtimeAcknowledgementCommandResult(
    MessagingCommandStatus Status,
    RealtimeAcknowledgementResult? Acknowledgement = null,
    string? Field = null,
    string? Detail = null,
    FeatureAccessReason? AccessReason = null)
{
    public static RealtimeAcknowledgementCommandResult Success(RealtimeAcknowledgementResult result) =>
        new(MessagingCommandStatus.Success, result);

    public static RealtimeAcknowledgementCommandResult NotFound() =>
        new(MessagingCommandStatus.NotFound);

    public static RealtimeAcknowledgementCommandResult Invalid(string field, string detail) =>
        new(MessagingCommandStatus.Invalid, Field: field, Detail: detail);

    public static RealtimeAcknowledgementCommandResult Forbidden(FeatureAccessReason reason) =>
        new(MessagingCommandStatus.Forbidden, AccessReason: reason);
}

/// <summary>
/// What a hub connection has proved about itself, owned by the server and stored on the connection.
/// </summary>
/// <remarks>
/// The tenant in the query string is untrusted routing input. This record only ever comes into
/// existence after active membership has been read from PostgreSQL, and it is what every later hub
/// method reads instead of re-parsing the query — so a connection cannot change workspace, and a hub
/// method with no binding fails closed rather than falling back to whatever the caller sent.
/// </remarks>
public sealed record MessagingHubConnectionBinding(Guid TenantId, Guid UserId);

/// <summary>
/// Current authorization for the hub, re-read from PostgreSQL every time it is asked.
/// </summary>
/// <remarks>
/// The narrow port that lets the Messaging module stay composed with the shared kernel alone.
/// Infrastructure implements it over the tenant memberships, the platform and relationship blocks,
/// the explicit participant rows and <c>ICoachingFeatureAccessService</c>; the hub knows only that it
/// must ask again.
/// <para>
/// It must be asked again, every time. SignalR caches the principal for the life of a connection, so
/// a socket opened before a membership was revoked still presents a valid, authenticated,
/// role-carrying principal afterwards. Nothing about the connection expires on its own.
/// </para>
/// </remarks>
public interface IMessagingRealtimeAuthorizer
{
    /// <summary>
    /// Verifies the user is an active member of the workspace and binds the scoped tenant context to
    /// it, so every subsequent tenant-filtered query in this scope is scoped to a verified workspace
    /// rather than to an unverified query-string value.
    /// </summary>
    Task<bool> BindVerifiedTenantAsync(Guid tenantId, Guid userId, CancellationToken cancellationToken);

    /// <summary>
    /// Whether this user may currently read this conversation: active membership, no platform block,
    /// no workspace relationship block, an explicit participant row, and a granted Messaging
    /// decision. Anything else is a single indistinguishable "no".
    /// </summary>
    Task<bool> CanAccessConversationAsync(
        Guid tenantId,
        Guid userId,
        Guid conversationId,
        CancellationToken cancellationToken);
}
