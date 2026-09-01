using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Notifications;

/// <summary>
/// A durable scheduled intent to notify one recipient about one commercial event.
/// </summary>
/// <remarks>
/// The row is not evidence that anything was delivered. It records that a notification became due,
/// when it became due, and what the dispatcher has since managed to do about it. The notification a
/// person actually reads is <see cref="Notification"/>; each try at a channel is a
/// <see cref="NotificationDeliveryAttempt"/>; and whether it has been read is neither of those.
/// Keeping the four apart is the point of the model: provider acknowledgement is not read state,
/// and a scheduled intent is not a delivery.
/// <para>
/// Lifecycle: Pending -&gt; Processing -&gt; Dispatched or DeadLettered, with a retryable failure
/// returning to Pending at a later <see cref="NextAttemptAtUtc"/>, and Cancelled reachable from
/// either non-terminal state when the business reason for the notification has gone away. Cancelled
/// and DeadLettered are deliberately different facts: cancelled means nobody should be told any
/// more, dead-lettered means somebody should have been and the dispatcher could not safely do it.
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
        NextAttemptAtUtc = scheduledAtUtc;
        TenantTimeZoneId = Normalize(tenantTimeZoneId, 100, nameof(tenantTimeZoneId));
        Status = NotificationOutboxStatus.Pending;
    }

    public Guid RecipientUserId { get; private set; }

    public Guid AggregateId { get; private set; }

    public CommercialNotificationKind Kind { get; private set; }

    public string DeduplicationKey { get; private set; } = string.Empty;

    public string PayloadJson { get; private set; } = string.Empty;

    /// <summary>When the business event said this notification became due. Never rewritten.</summary>
    public DateTimeOffset ScheduledAtUtc { get; private set; }

    /// <summary>
    /// The earliest instant a dispatcher may claim this item. Starts equal to
    /// <see cref="ScheduledAtUtc"/> and moves forward with every retryable failure, so the retry
    /// backoff is durable state rather than something a worker holds in memory.
    /// </summary>
    public DateTimeOffset NextAttemptAtUtc { get; private set; }

    /// <summary>
    /// The workspace time zone that was used to calculate <see cref="ScheduledAtUtc"/>. Scheduling
    /// provenance only: a delayed item re-reads the workspace current time zone when it decides
    /// what today means, because the workspace may have moved since.
    /// </summary>
    public string TenantTimeZoneId { get; private set; } = string.Empty;

    public NotificationOutboxStatus Status { get; private set; }

    public int AttemptCount { get; private set; }

    /// <summary>
    /// The lease held by the dispatcher currently processing this item. Cleared by every terminal
    /// transition, so a terminal row never carries a live claim.
    /// </summary>
    public Guid? ClaimToken { get; private set; }

    public DateTimeOffset? ClaimExpiresAtUtc { get; private set; }

    public DateTimeOffset? DispatchedAtUtc { get; private set; }

    public DateTimeOffset? DeadLetteredAtUtc { get; private set; }

    /// <summary>
    /// A stable, bounded, non-sensitive classification of the last thing that went wrong, or of why
    /// the item was suppressed. Never an exception message and never anything from the payload.
    /// </summary>
    public string? FailureCode { get; private set; }

    public bool IsTerminal => Status is NotificationOutboxStatus.Dispatched
        or NotificationOutboxStatus.DeadLettered
        or NotificationOutboxStatus.Cancelled;

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

    /// <summary>Whether a dispatcher may claim this item now.</summary>
    public bool IsClaimable(DateTimeOffset now) =>
        (Status == NotificationOutboxStatus.Pending && NextAttemptAtUtc <= now) ||
        IsClaimExpired(now);

    /// <summary>
    /// A claim whose lease has run out. The worker that held it either crashed or lost its
    /// connection; either way the item must become visible again, or one crash could hide a
    /// notification permanently.
    /// </summary>
    public bool IsClaimExpired(DateTimeOffset now) =>
        Status == NotificationOutboxStatus.Processing &&
        ClaimExpiresAtUtc is { } expiry &&
        expiry <= now;

    /// <summary>
    /// Takes the lease and starts the next attempt. The returned token is what every later
    /// finalization must present: a worker whose lease has already expired and been taken over
    /// cannot overwrite the newer worker result.
    /// </summary>
    public Guid Claim(
        DateTimeOffset now,
        TimeSpan lease,
        int maximumAttempts = NotificationDispatchOptions.DefaultMaximumAttempts)
    {
        if (lease <= TimeSpan.Zero)
        {
            throw new ArgumentOutOfRangeException(nameof(lease), "A claim lease must be positive.");
        }

        NotificationDispatchOptions.ValidateMaximumAttempts(maximumAttempts);

        if (!IsClaimable(now))
        {
            throw new InvalidOperationException("This notification is not claimable.");
        }

        if (AttemptCount >= maximumAttempts)
        {
            throw new InvalidOperationException("This notification has exhausted its delivery attempts.");
        }

        AttemptCount++;
        Status = NotificationOutboxStatus.Processing;
        ClaimToken = Guid.CreateVersion7();
        ClaimExpiresAtUtc = now.Add(lease);
        return ClaimToken.Value;
    }

    /// <summary>
    /// Ends due work whose already-started attempts consumed the configured budget. No replacement
    /// attempt is invented merely to record exhaustion: the last real attempt remains in history
    /// with its own outcome, including <c>Abandoned</c> when its lease expired.
    /// </summary>
    public void MarkAttemptsExhausted(DateTimeOffset now)
    {
        if (IsTerminal)
        {
            throw new InvalidOperationException("A terminal notification cannot exhaust attempts again.");
        }

        if (Status != NotificationOutboxStatus.Pending && !IsClaimExpired(now))
        {
            throw new InvalidOperationException("Only due or expired work can exhaust its attempts.");
        }

        Status = NotificationOutboxStatus.DeadLettered;
        DeadLetteredAtUtc = now;
        FailureCode = NotificationFailureCodes.AttemptsExhausted;
        ReleaseClaim();
    }

    public void MarkDispatched(Guid claimToken, DateTimeOffset now)
    {
        RequireClaim(claimToken);
        Status = NotificationOutboxStatus.Dispatched;
        DispatchedAtUtc = now;
        FailureCode = null;
        ReleaseClaim();
    }

    /// <summary>
    /// A transient failure. The item goes back to Pending and stays invisible until
    /// <paramref name="nextAttemptAtUtc"/>, so the backoff survives a worker restart.
    /// </summary>
    public void MarkRetrying(Guid claimToken, DateTimeOffset nextAttemptAtUtc, string failureCode)
    {
        RequireClaim(claimToken);
        Status = NotificationOutboxStatus.Pending;
        NextAttemptAtUtc = nextAttemptAtUtc;
        FailureCode = Normalize(failureCode, 100, nameof(failureCode));
        ReleaseClaim();
    }

    public void MarkDeadLettered(Guid claimToken, DateTimeOffset now, string failureCode)
    {
        RequireClaim(claimToken);
        Status = NotificationOutboxStatus.DeadLettered;
        DeadLetteredAtUtc = now;
        FailureCode = Normalize(failureCode, 100, nameof(failureCode));
        ReleaseClaim();
    }

    /// <summary>
    /// The business reason for the notification has gone away. Recorded with a stable code so an
    /// operator can tell suppression apart from failure without reading anything sensitive.
    /// </summary>
    public void Suppress(string reasonCode)
    {
        if (IsTerminal)
        {
            throw new InvalidOperationException("A terminal notification cannot be suppressed.");
        }

        Status = NotificationOutboxStatus.Cancelled;
        FailureCode = Normalize(reasonCode, 100, nameof(reasonCode));
        ReleaseClaim();
    }

    /// <summary>
    /// Commercial cancellation, from the request that changed the underlying state.
    /// </summary>
    /// <remarks>
    /// Deliberately a no-op on anything that is not Pending. An item a worker currently holds is
    /// left alone rather than pulled out from under it: the dispatcher re-establishes eligibility
    /// before it renders anything, finds the enrollment no longer eligible, and suppresses the item
    /// itself with a stable code.
    /// </remarks>
    public void Cancel()
    {
        if (Status == NotificationOutboxStatus.Pending)
        {
            Status = NotificationOutboxStatus.Cancelled;
            ReleaseClaim();
        }
    }

    private void RequireClaim(Guid claimToken)
    {
        if (Status != NotificationOutboxStatus.Processing)
        {
            throw new InvalidOperationException("Only a claimed notification can be finalized.");
        }

        if (ClaimToken != claimToken)
        {
            throw new InvalidOperationException("This notification is held by a different claim.");
        }
    }

    private void ReleaseClaim()
    {
        ClaimToken = null;
        ClaimExpiresAtUtc = null;
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
/// The outbox lifecycle. The numbers of the three Phase 2 states are preserved so stored history
/// keeps its meaning; 3 is retired with the old <c>Failed</c> state, whose rows the Phase 6B-1
/// migration returns to retryable Pending.
/// </summary>
public enum NotificationOutboxStatus
{
    Pending = 1,
    Dispatched = 2,
    Cancelled = 4,
    Processing = 5,
    DeadLettered = 6,
}
