using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Notifications;

/// <summary>
/// The logical notification: one durable statement that somebody should be told one thing, and when.
/// </summary>
/// <remarks>
/// The row is not evidence that anything was delivered, and since Phase 6B-3A it no longer carries a
/// dispatch lifecycle either. What one channel has managed to do belongs to that channel's own
/// <see cref="NotificationChannelDelivery"/>, because an intent cannot truthfully be both "the in-app
/// row was written" and "the email is waiting to retry", and a single mutable status forced exactly
/// that lie as soon as a second channel existed.
/// <para>
/// Five facts are now kept apart. This row is the scheduled logical notification; a channel delivery
/// is one channel's own lifecycle; a <see cref="NotificationDeliveryAttempt"/> is one try within it;
/// <see cref="Notification"/> is what a person was actually told; and <c>ReadAtUtc</c> is that
/// person's own act. No code writes any one of them from another.
/// </para>
/// <para>
/// Everything here is written once. The single exception is <see cref="Status"/>, which records
/// whether the business later withdrew the intent — a fact about the notification itself rather than
/// about any channel, and the reason a still-pending payment reminder disappears when the payment
/// arrives.
/// </para>
/// </remarks>
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
        NotificationPurpose purpose,
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

        if (!Enum.IsDefined(purpose))
        {
            throw new ArgumentException("A notification purpose is required.", nameof(purpose));
        }

        RecipientUserId = recipientUserId;
        AggregateId = aggregateId;
        Kind = kind;
        Purpose = purpose;
        DeduplicationKey = Normalize(deduplicationKey, 200, nameof(deduplicationKey));
        PayloadJson = Normalize(payloadJson, 4_000, nameof(payloadJson));
        ScheduledAtUtc = scheduledAtUtc;
        TenantTimeZoneId = Normalize(tenantTimeZoneId, 100, nameof(tenantTimeZoneId));
        Status = NotificationIntentStatus.Scheduled;
    }

    public Guid RecipientUserId { get; private set; }

    public Guid AggregateId { get; private set; }

    public CommercialNotificationKind Kind { get; private set; }

    /// <summary>
    /// Service/transactional or marketing, decided from the kind rather than inferred from wording.
    /// Snapshotted here as well as on each delivery so the classification a notification was created
    /// under stays legible even if the catalog is later extended.
    /// </summary>
    public NotificationPurpose Purpose { get; private set; }

    public string DeduplicationKey { get; private set; } = string.Empty;

    public string PayloadJson { get; private set; } = string.Empty;

    /// <summary>When the business event said this notification became due. Never rewritten.</summary>
    public DateTimeOffset ScheduledAtUtc { get; private set; }

    /// <summary>
    /// The workspace time zone that was used to calculate <see cref="ScheduledAtUtc"/>. Scheduling
    /// provenance only: a delayed item re-reads the workspace's current time zone when it decides what
    /// today means, and quiet hours are evaluated in the current zone too, because the workspace may
    /// have moved since.
    /// </summary>
    public string TenantTimeZoneId { get; private set; } = string.Empty;

    /// <summary>
    /// Whether the business still wants this said at all. Not a delivery status: a scheduled intent
    /// whose in-app row was written and whose email is still retrying is <c>Scheduled</c> throughout,
    /// because the two channels answer for themselves.
    /// </summary>
    public NotificationIntentStatus Status { get; private set; }

    public DateTimeOffset? CancelledAtUtc { get; private set; }

    public bool IsCancelled => Status == NotificationIntentStatus.Cancelled;

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
            NotificationPurposeCatalog.For(kind),
            deduplicationKey,
            payloadJson,
            scheduledAtUtc,
            tenantTimeZoneId);

    /// <summary>
    /// The business withdrew the intent, from the request that changed the underlying state.
    /// </summary>
    /// <remarks>
    /// Idempotent, and one way. Cancelling the intent does not itself stop a channel: the caller
    /// suppresses each still-pending delivery, and a delivery a worker currently holds is deliberately
    /// left alone rather than pulled out from under it. That worker re-establishes eligibility before
    /// it materializes anything, finds the reason gone, and closes its own claimed row honestly.
    /// </remarks>
    public void Cancel(DateTimeOffset now)
    {
        if (Status == NotificationIntentStatus.Cancelled)
        {
            return;
        }

        Status = NotificationIntentStatus.Cancelled;
        CancelledAtUtc = now;
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

/// <summary>
/// Whether the business still wants a scheduled notification said.
/// </summary>
/// <remarks>
/// Two states, because there are only two things this row can say. Everything the old Phase 6B-1
/// lifecycle expressed — processing, dispatched, dead-lettered, and dispatcher suppression — was
/// per-channel state wearing the intent's clothes, and moved to <see cref="NotificationChannelDelivery"/>
/// in Phase 6B-3A. The forward migration preserves every one of those legacy facts on the in-app
/// delivery it creates.
/// </remarks>
public enum NotificationIntentStatus
{
    Scheduled = 1,
    Cancelled = 2,
}
