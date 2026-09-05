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
/// What an owner may see about a dead-lettered channel delivery.
/// </summary>
/// <remarks>
/// Deliberately almost nothing: an identifier to quote to support, the kind, which channel it was,
/// when it was due, how many attempts it took, when it was given up on, and a stable code. No
/// recipient, no address, no name, no rendered wording, no payload, no exception. A workspace owner is
/// not automatically entitled to read a member's notifications, and an operational view is the wrong
/// place to change that.
/// <para>
/// It is per channel because dead-lettering now is: an intent whose in-app row was written and whose
/// email exhausted its retries has exactly one thing to show an operator, and reporting it against the
/// intent would either hide the failure or misrepresent the success.
/// </para>
/// </remarks>
public sealed record NotificationDeadLetterView(
    Guid OutboxItemId,
    Guid ChannelDeliveryId,
    NotificationChannel Channel,
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

/// <summary>
/// The signed-in member's own notification settings in the active workspace.
/// </summary>
/// <remarks>
/// <paramref name="InAppEnabled"/> is always true and is present so the screen can state the rule
/// rather than imply it: in-app notifications are passive persisted state, every supported type keeps
/// them, and this slice deliberately offers no way to switch them off.
/// <para>
/// Local times are rendered as <c>HH:mm</c> and are meaningless without
/// <paramref name="TenantTimeZoneId"/>, which is the workspace's configured IANA zone and the frame
/// every quiet-hours decision is made in — never the browser's.
/// </para>
/// </remarks>
public sealed record NotificationPreferenceView(
    bool InAppEnabled,
    bool EmailServiceEnabled,
    bool EmailMarketingEnabled,
    bool EmailChannelAvailable,
    bool QuietHoursEnabled,
    string? QuietHoursStartLocal,
    string? QuietHoursEndLocal,
    string TenantTimeZoneId,
    int PolicyVersion,
    uint Version);

/// <summary>
/// A member changing their own settings.
/// </summary>
/// <remarks>
/// There is no subject in the body. The API derives it from the authentication cookie, so there is no
/// shape in which one member asks to change another's — a coach or an owner cannot opt somebody into
/// email, silently or otherwise.
/// <para>
/// Marketing is absent too: nothing produces marketing notifications in this phase, so there is
/// nothing to consent to and no route that records consent for it.
/// </para>
/// </remarks>
public sealed record UpdateNotificationPreferenceRequest(
    bool EmailServiceEnabled,
    bool QuietHoursEnabled,
    string? QuietHoursStartLocal,
    string? QuietHoursEndLocal,
    Guid IdempotencyKey,
    uint Version);

public enum NotificationPreferenceCommandStatus
{
    Success = 1,
    Invalid = 2,
    Conflict = 3,
    NotFound = 4,
}

public sealed record NotificationPreferenceCommandResult(
    NotificationPreferenceCommandStatus Status,
    NotificationPreferenceView? Preference = null,
    string? Field = null,
    string? Message = null)
{
    public static NotificationPreferenceCommandResult Success(NotificationPreferenceView preference) =>
        new(NotificationPreferenceCommandStatus.Success, preference);

    public static NotificationPreferenceCommandResult Invalid(string field, string message) =>
        new(NotificationPreferenceCommandStatus.Invalid, Field: field, Message: message);

    public static NotificationPreferenceCommandResult Conflict(string field, string message) =>
        new(NotificationPreferenceCommandStatus.Conflict, Field: field, Message: message);

    public static NotificationPreferenceCommandResult NotFound() =>
        new(NotificationPreferenceCommandStatus.NotFound);
}

/// <summary>
/// The caller's own notification settings. Every method is scoped to the active workspace and to the
/// signed-in member; there is no method that takes a subject.
/// </summary>
public interface INotificationPreferenceService
{
    Task<NotificationPreferenceView?> GetOwnAsync(CancellationToken cancellationToken);

    Task<NotificationPreferenceCommandResult> UpdateOwnAsync(
        UpdateNotificationPreferenceRequest request,
        CancellationToken cancellationToken);
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
/// What one sweep did, counted per channel delivery rather than per intent.
/// </summary>
/// <remarks>
/// Counts only: nothing here identifies a recipient or carries content. <c>Materialized</c> is named
/// for what actually happened — an inbox row was written, or a message was materialized and taken by
/// the configured transport — because a sweep cannot establish that a provider accepted anything, that
/// a mail server took it, or that a person read it. <c>Deferred</c> counts quiet-hours postponements,
/// which are not failures and consume no attempt.
/// </remarks>
public sealed record NotificationDispatchOutcome(
    int Claimed,
    int Materialized,
    int Suppressed,
    int Retried,
    int DeadLettered,
    int Reclaimed,
    int Deferred)
{
    public static NotificationDispatchOutcome Empty { get; } = new(0, 0, 0, 0, 0, 0, 0);

    public NotificationDispatchOutcome Add(NotificationDispatchOutcome other) => new(
        Claimed + other.Claimed,
        Materialized + other.Materialized,
        Suppressed + other.Suppressed,
        Retried + other.Retried,
        DeadLettered + other.DeadLettered,
        Reclaimed + other.Reclaimed,
        Deferred + other.Deferred);

    public int Total => Claimed + Suppressed + Reclaimed + Deferred;
}
