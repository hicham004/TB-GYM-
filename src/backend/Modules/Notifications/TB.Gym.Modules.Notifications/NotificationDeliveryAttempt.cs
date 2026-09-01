using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Notifications;

/// <summary>
/// One try at delivering one outbox intent over one channel.
/// </summary>
/// <remarks>
/// Every started attempt is persisted before any work happens, so a worker that dies leaves evidence
/// rather than silence. A completed attempt is immutable and is never deleted: the history of what
/// was tried, when, by which claim, and how it ended is the only thing that can explain a
/// dead-lettered item afterwards.
/// <para>
/// <see cref="IdempotencyKey"/> is stable across every attempt for the same intent and channel. In
/// this slice the in-app materialization is made idempotent by a unique database constraint instead,
/// but an external provider cannot be given a constraint — it can only be given a key it promises to
/// deduplicate on. Even then the honest guarantee is at-least-once with provider-specific
/// reconciliation, never exactly-once.
/// </para>
/// </remarks>
public sealed class NotificationDeliveryAttempt : TenantEntity
{
    private NotificationDeliveryAttempt()
    {
    }

    private NotificationDeliveryAttempt(
        Guid tenantId,
        Guid outboxItemId,
        NotificationChannel channel,
        int attemptNumber,
        Guid claimToken,
        string idempotencyKey,
        DateTimeOffset startedAtUtc)
        : base(tenantId)
    {
        if (outboxItemId == Guid.Empty || claimToken == Guid.Empty || !Enum.IsDefined(channel))
        {
            throw new ArgumentException("Outbox item, claim token, and channel are required.");
        }

        if (attemptNumber < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(attemptNumber), "Attempt numbers start at 1.");
        }

        OutboxItemId = outboxItemId;
        Channel = channel;
        AttemptNumber = attemptNumber;
        ClaimToken = claimToken;
        IdempotencyKey = Normalize(idempotencyKey, 200, nameof(idempotencyKey));
        StartedAtUtc = startedAtUtc;
        Outcome = NotificationDeliveryOutcome.Started;
    }

    public Guid OutboxItemId { get; private set; }

    public NotificationChannel Channel { get; private set; }

    public int AttemptNumber { get; private set; }

    /// <summary>The claim this attempt was started under, so a stale worker cannot finish it.</summary>
    public Guid ClaimToken { get; private set; }

    public string IdempotencyKey { get; private set; } = string.Empty;

    public DateTimeOffset StartedAtUtc { get; private set; }

    public DateTimeOffset? CompletedAtUtc { get; private set; }

    public NotificationDeliveryOutcome Outcome { get; private set; }

    /// <summary>
    /// A stable, bounded classification. Never an exception message, a stack trace, or anything a
    /// future provider returned in a response body.
    /// </summary>
    public string? FailureCode { get; private set; }

    /// <summary>
    /// Reserved for a future external adapter. Nothing writes it in this slice; the in-app channel
    /// has no provider and inventing an identifier for it would be a lie about where it came from.
    /// </summary>
    public string? ProviderMessageId { get; private set; }

    public bool IsCompleted => Outcome != NotificationDeliveryOutcome.Started;

    /// <summary>
    /// The key an external provider would be asked to deduplicate on. Stable for the intent and the
    /// channel, deliberately not for the attempt: a retry of the same intent must be recognisable as
    /// the same message, which is the entire purpose of the key.
    /// </summary>
    public static string BuildIdempotencyKey(Guid outboxItemId, NotificationChannel channel) =>
        $"notification:{outboxItemId:N}:{channel.ToString().ToLowerInvariant()}:v1";

    public static NotificationDeliveryAttempt Start(
        Guid tenantId,
        Guid outboxItemId,
        NotificationChannel channel,
        int attemptNumber,
        Guid claimToken,
        DateTimeOffset startedAtUtc) =>
        new(
            tenantId,
            outboxItemId,
            channel,
            attemptNumber,
            claimToken,
            BuildIdempotencyKey(outboxItemId, channel),
            startedAtUtc);

    public void Succeed(DateTimeOffset now, string? providerMessageId = null)
    {
        Complete(NotificationDeliveryOutcome.Succeeded, now, null);
        ProviderMessageId = providerMessageId is null
            ? null
            : Normalize(providerMessageId, 200, nameof(providerMessageId));
    }

    public void FailTransiently(DateTimeOffset now, string failureCode) =>
        Complete(NotificationDeliveryOutcome.TransientFailure, now, failureCode);

    public void FailPermanently(DateTimeOffset now, string failureCode) =>
        Complete(NotificationDeliveryOutcome.PermanentFailure, now, failureCode);

    /// <summary>
    /// Authoritative state changed after this attempt was durably started but before anything was
    /// materialized. The suppression did not fail and does not earn a retry, but the started attempt
    /// remains a completed historical fact rather than being erased or left open forever.
    /// </summary>
    public void Suppress(DateTimeOffset now, string reasonCode) =>
        Complete(NotificationDeliveryOutcome.Suppressed, now, reasonCode);

    /// <summary>
    /// The claim that started this attempt expired without finishing it. Recorded before the
    /// replacement attempt is created, so a reclaimed item shows what happened to the try it
    /// replaced rather than appearing to have skipped an attempt number.
    /// </summary>
    public void Abandon(DateTimeOffset now, string failureCode) =>
        Complete(NotificationDeliveryOutcome.Abandoned, now, failureCode);

    private void Complete(NotificationDeliveryOutcome outcome, DateTimeOffset now, string? failureCode)
    {
        if (IsCompleted)
        {
            throw new InvalidOperationException("A completed delivery attempt is immutable.");
        }

        Outcome = outcome;
        CompletedAtUtc = now;
        FailureCode = failureCode is null ? null : Normalize(failureCode, 100, nameof(failureCode));
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

/// <summary>
/// Delivery channels. Only <see cref="InApp"/> exists in this slice; the enum is here so an attempt
/// row is already channel-scoped when email or WhatsApp is added behind the existing ports.
/// </summary>
public enum NotificationChannel
{
    InApp = 1,
}

public enum NotificationDeliveryOutcome
{
    Started = 1,
    Succeeded = 2,
    TransientFailure = 3,
    PermanentFailure = 4,
    Abandoned = 5,
    Suppressed = 6,
}
