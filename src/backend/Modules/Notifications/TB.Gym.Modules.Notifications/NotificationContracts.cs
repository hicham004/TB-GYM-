namespace TB.Gym.Modules.Notifications;

/// <summary>
/// The versioned shape of a commercial outbox payload.
/// </summary>
/// <remarks>
/// The payload holds identifiers only. It is never rendered, never returned by an API, and never
/// logged: every fact a notification needs is re-read from the authoritative rows at dispatch time,
/// because a payload written days earlier is a snapshot of a world that may have moved. It also
/// never carries a token. Account confirmation, password reset and invitation delivery stay on their
/// own paths precisely so a single-use credential is not parked in a durable, replayable,
/// operator-visible queue row.
/// <para>
/// <see cref="SchemaVersion"/> is 1. A payload written before this field existed has no version at
/// all and is read as 1; any other value is a permanent dead letter, because a build that cannot
/// read a payload will not learn to by waiting.
/// </para>
/// </remarks>
public sealed record CommercialNotificationPayload(
    Guid EnrollmentId,
    Guid ClientProfileId,
    int SchemaVersion = CommercialNotificationPayload.CurrentSchemaVersion)
{
    public const int CurrentSchemaVersion = 1;
}

/// <summary>The signed-in recipient view of one of their own notifications.</summary>
public sealed record NotificationView(
    Guid Id,
    CommercialNotificationKind Kind,
    string Title,
    string Body,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset? ReadAtUtc,
    bool IsRead,
    uint Version);

/// <summary>One newest-first page of the caller's own inbox.</summary>
public sealed record NotificationPage(long Total, long UnreadTotal, IReadOnlyList<NotificationView> Items);

public sealed record NotificationUnreadCount(long Unread);

/// <summary>
/// What an owner may see about a dead-lettered intent.
/// </summary>
/// <remarks>
/// Deliberately almost nothing: an identifier to quote to support, the kind, when it was due, how
/// many attempts it took, when it was given up on, and a stable code. No recipient, no address, no
/// name, no rendered wording, no payload, no exception. A workspace owner is not automatically
/// entitled to read a member's notifications, and an operational view is the wrong place to change
/// that.
/// </remarks>
public sealed record NotificationDeadLetterView(
    Guid OutboxItemId,
    CommercialNotificationKind Kind,
    DateTimeOffset ScheduledAtUtc,
    int AttemptCount,
    DateTimeOffset? DeadLetteredAtUtc,
    string? FailureCode);

public sealed record NotificationDeadLetterPage(long Total, IReadOnlyList<NotificationDeadLetterView> Items);

public enum NotificationCommandStatus
{
    Success = 1,
    NotFound = 2,
    Invalid = 3,
}

public sealed record NotificationCommandResult(
    NotificationCommandStatus Status,
    NotificationView? Notification = null,
    string? Field = null,
    string? Message = null)
{
    public static NotificationCommandResult Success(NotificationView notification) =>
        new(NotificationCommandStatus.Success, notification);

    public static NotificationCommandResult NotFound() => new(NotificationCommandStatus.NotFound);

    public static NotificationCommandResult Invalid(string field, string message) =>
        new(NotificationCommandStatus.Invalid, Field: field, Message: message);
}

/// <summary>
/// The caller's own inbox, plus the owner-only operational read. Every method is scoped to the
/// active workspace and, for the inbox, to the signed-in recipient.
/// </summary>
public interface INotificationApplicationService
{
    Task<NotificationPage> ListOwnAsync(int skip, int take, CancellationToken cancellationToken);

    Task<NotificationUnreadCount> CountOwnUnreadAsync(CancellationToken cancellationToken);

    Task<NotificationCommandResult> MarkOwnReadAsync(Guid notificationId, CancellationToken cancellationToken);

    Task<NotificationDeadLetterPage> ListDeadLettersAsync(int skip, int take, CancellationToken cancellationToken);
}

/// <summary>Paging bounds shared by the endpoints and the application service.</summary>
public static class NotificationPaging
{
    public const int DefaultPageSize = 25;

    public const int MaximumPageSize = 100;

    public static int NormalizeTake(int? take) =>
        take is null or <= 0 ? DefaultPageSize : Math.Min(take.Value, MaximumPageSize);

    public static int NormalizeSkip(int? skip) => skip is null or < 0 ? 0 : skip.Value;
}

/// <summary>
/// The outbox dispatch sweep. Implemented in Infrastructure and driven by the Worker process.
/// </summary>
public interface INotificationDispatchService
{
    Task<NotificationDispatchOutcome> DispatchDueAsync(CancellationToken cancellationToken);
}

/// <summary>
/// What one sweep did. Counts only: nothing here identifies a recipient or carries content.
/// </summary>
public sealed record NotificationDispatchOutcome(
    int Claimed,
    int Dispatched,
    int Suppressed,
    int Retried,
    int DeadLettered,
    int Reclaimed)
{
    public static NotificationDispatchOutcome Empty { get; } = new(0, 0, 0, 0, 0, 0);

    public NotificationDispatchOutcome Add(NotificationDispatchOutcome other) => new(
        Claimed + other.Claimed,
        Dispatched + other.Dispatched,
        Suppressed + other.Suppressed,
        Retried + other.Retried,
        DeadLettered + other.DeadLettered,
        Reclaimed + other.Reclaimed);

    public int Total => Claimed + Suppressed + Reclaimed;
}
