using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Notifications;

public sealed class NotificationOutboxItem : TenantEntity
{
    private NotificationOutboxItem()
    {
    }

    private NotificationOutboxItem(
        Guid tenantId,
        Guid recipientUserId,
        Guid aggregateId,
        CommercialNotificationKind kind,
        string deduplicationKey,
        string payloadJson,
        DateTimeOffset scheduledAtUtc,
        string tenantTimeZoneId)
        : base(tenantId)
    {
        if (recipientUserId == Guid.Empty || aggregateId == Guid.Empty || !Enum.IsDefined(kind))
        {
            throw new ArgumentException("Recipient, aggregate, and notification kind are required.");
        }

        RecipientUserId = recipientUserId;
        AggregateId = aggregateId;
        Kind = kind;
        DeduplicationKey = Normalize(deduplicationKey, 200, nameof(deduplicationKey));
        PayloadJson = Normalize(payloadJson, 4_000, nameof(payloadJson));
        ScheduledAtUtc = scheduledAtUtc;
        TenantTimeZoneId = Normalize(tenantTimeZoneId, 100, nameof(tenantTimeZoneId));
        Status = NotificationOutboxStatus.Pending;
    }

    public Guid RecipientUserId { get; private set; }

    public Guid AggregateId { get; private set; }

    public CommercialNotificationKind Kind { get; private set; }

    public string DeduplicationKey { get; private set; } = string.Empty;

    public string PayloadJson { get; private set; } = string.Empty;

    public DateTimeOffset ScheduledAtUtc { get; private set; }

    public string TenantTimeZoneId { get; private set; } = string.Empty;

    public NotificationOutboxStatus Status { get; private set; }

    public int AttemptCount { get; private set; }

    public DateTimeOffset? DispatchedAtUtc { get; private set; }

    public string? FailureCode { get; private set; }

    public static NotificationOutboxItem Schedule(
        Guid tenantId,
        Guid recipientUserId,
        Guid aggregateId,
        CommercialNotificationKind kind,
        string deduplicationKey,
        string payloadJson,
        DateTimeOffset scheduledAtUtc,
        string tenantTimeZoneId) =>
        new(
            tenantId,
            recipientUserId,
            aggregateId,
            kind,
            deduplicationKey,
            payloadJson,
            scheduledAtUtc,
            tenantTimeZoneId);

    public void MarkDispatched(DateTimeOffset now)
    {
        if (Status is NotificationOutboxStatus.Dispatched or NotificationOutboxStatus.Cancelled)
        {
            throw new InvalidOperationException("A completed or cancelled notification cannot be dispatched again.");
        }

        AttemptCount++;
        Status = NotificationOutboxStatus.Dispatched;
        DispatchedAtUtc = now;
        FailureCode = null;
    }

    public void MarkFailed(string failureCode)
    {
        if (Status is NotificationOutboxStatus.Dispatched or NotificationOutboxStatus.Cancelled)
        {
            throw new InvalidOperationException("A completed or cancelled notification cannot fail.");
        }

        AttemptCount++;
        Status = NotificationOutboxStatus.Failed;
        FailureCode = Normalize(failureCode, 100, nameof(failureCode));
    }

    public void Cancel()
    {
        if (Status is NotificationOutboxStatus.Pending or NotificationOutboxStatus.Failed)
        {
            Status = NotificationOutboxStatus.Cancelled;
        }
    }

    private static string Normalize(string value, int maxLength, string parameterName)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(value);
        var normalized = value.Trim();
        return normalized.Length <= maxLength
            ? normalized
            : throw new ArgumentException($"The value cannot exceed {maxLength} characters.", parameterName);
    }
}

public enum CommercialNotificationKind
{
    PaymentRequired = 1,
    EnrollmentActivated = 2,
    EnrollmentEndingSoon = 3,
    EnrollmentExpired = 4,
    EnrollmentRenewed = 5,
}

public enum NotificationOutboxStatus
{
    Pending = 1,
    Dispatched = 2,
    Failed = 3,
    Cancelled = 4,
}
