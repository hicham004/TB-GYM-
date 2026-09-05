using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Notifications;

/// <summary>
/// One try at one channel's delivery of one logical notification.
/// </summary>
/// <remarks>
/// Every started attempt is persisted before any work happens, so a worker that dies leaves evidence
/// rather than silence. A completed attempt is immutable and is never deleted: the history of what was
/// tried, when, by which claim, and how it ended is the only thing that can explain a dead-lettered
/// delivery afterwards.
/// <para>
/// The attempt belongs to a <see cref="NotificationChannelDelivery"/> rather than to the intent, so
/// the retry budget, the numbering and the history of one channel are entirely its own. The channel is
/// stored as well and is part of a composite foreign key to the delivery, which makes an attempt whose
/// channel disagrees with its delivery structurally impossible rather than merely unlikely.
/// </para>
/// <para>
/// <see cref="IdempotencyKey"/> is stable across every attempt for the same intent and channel. In-app
/// materialization is made idempotent by a unique database constraint instead, but an external
/// provider cannot be given a constraint — only a key it promises to deduplicate on, and even then the
/// honest guarantee is at-least-once within that provider's own retention window, never exactly-once.
/// The key an adapter actually sends is <see cref="BuildProviderIdempotencyKey"/>, which additionally
/// binds the exact mailbox; this column records the logical key, which is what identifies the message
/// regardless of where it was addressed.
/// </para>
/// </remarks>
public sealed class NotificationDeliveryAttempt : TenantEntity
{
    private NotificationDeliveryAttempt()
    {
    }

    private NotificationDeliveryAttempt(
        Guid tenantId,
        Guid channelDeliveryId,
        NotificationChannel channel,
        int attemptNumber,
        Guid claimToken,
        string idempotencyKey,
        DateTimeOffset startedAtUtc)
        : base(tenantId)
    {
        if (channelDeliveryId == Guid.Empty || claimToken == Guid.Empty || !Enum.IsDefined(channel))
        {
            throw new ArgumentException("Channel delivery, claim token, and channel are required.");
        }

        if (attemptNumber < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(attemptNumber), "Attempt numbers start at 1.");
        }

        ChannelDeliveryId = channelDeliveryId;
        Channel = channel;
        AttemptNumber = attemptNumber;
        ClaimToken = claimToken;
        IdempotencyKey = Normalize(idempotencyKey, 200, nameof(idempotencyKey));
        StartedAtUtc = startedAtUtc;
        Outcome = NotificationDeliveryOutcome.Started;
    }

    public Guid ChannelDeliveryId { get; private set; }

    public NotificationChannel Channel { get; private set; }

    public int AttemptNumber { get; private set; }

    /// <summary>The claim this attempt was started under, so a stale worker cannot finish it.</summary>
    public Guid ClaimToken { get; private set; }

    public string IdempotencyKey { get; private set; } = string.Empty;

    public DateTimeOffset StartedAtUtc { get; private set; }

    public DateTimeOffset? CompletedAtUtc { get; private set; }

    public NotificationDeliveryOutcome Outcome { get; private set; }

    /// <summary>
    /// A stable, bounded classification. Never an exception message, a stack trace, an address, or
    /// anything a future provider returned in a response body.
    /// </summary>
    public string? FailureCode { get; private set; }

    /// <summary>
    /// The identifier a real external provider returned for this attempt's request, or null.
    /// </summary>
    /// <remarks>
    /// In-app has no provider and the captured email adapter contacts none, so inventing an
    /// identifier for either would be a lie about where it came from; a check constraint and a
    /// trigger both refuse it. Where it is set, it records provider acceptance for this attempt and
    /// nothing beyond it.
    /// </remarks>
    public string? ProviderMessageId { get; private set; }

    public bool IsCompleted => Outcome != NotificationDeliveryOutcome.Started;

    /// <summary>
    /// The logical key for this intent and channel. Stable for the intent and the channel,
    /// deliberately not for the attempt: a retry of the same intent over the same channel must be
    /// recognisable as the same message, which is the entire purpose of the key. Two channels of one
    /// intent get different keys, because they are different messages.
    /// </summary>
    public static string BuildIdempotencyKey(Guid outboxItemId, NotificationChannel channel) =>
        $"notification:{outboxItemId:N}:{channel.ToString().ToLowerInvariant()}:v1";

    /// <summary>
    /// The key a real provider is asked to deduplicate on: the logical key, bound to the exact
    /// mailbox the message is going to.
    /// </summary>
    /// <remarks>
    /// The recipient has to participate, and it has to participate as a fingerprint. Without it, a
    /// member who corrects a mistyped address mid-retry presents the provider with the same key and a
    /// different payload, which the provider answers with a conflict rather than a send; with the
    /// address itself, a queue row, a log line or a support export would end up holding a mailbox
    /// this design spends considerable effort never storing. A truncated keyed fingerprint gives the
    /// key exactly the sensitivity it needs — different mailbox, different key — and no more.
    /// <para>
    /// The result stays well inside the 256 characters the provider allows.
    /// </para>
    /// </remarks>
    public static string BuildProviderIdempotencyKey(string logicalKey, string addressFingerprint)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(logicalKey);
        if (!NotificationAddressFingerprint.IsValidFingerprint(addressFingerprint))
        {
            throw new ArgumentException(
                "A provider idempotency key binds a valid address fingerprint.",
                nameof(addressFingerprint));
        }

        return $"{logicalKey}:{addressFingerprint[..32]}";
    }

    public static NotificationDeliveryAttempt Start(
        Guid tenantId,
        Guid outboxItemId,
        Guid channelDeliveryId,
        NotificationChannel channel,
        int attemptNumber,
        Guid claimToken,
        DateTimeOffset startedAtUtc) =>
        new(
            tenantId,
            channelDeliveryId,
            channel,
            attemptNumber,
            claimToken,
            BuildIdempotencyKey(outboxItemId, channel),
            startedAtUtc);

    /// <summary>
    /// This attempt produced the channel's artefact: an inbox row, or a message the configured
    /// transport took. Not a claim that a provider accepted it, which is why nothing here is called
    /// delivered and why <see cref="ProviderMessageId"/> stays null without a real provider.
    /// </summary>
    public void Succeed(DateTimeOffset now, string? providerMessageId = null)
    {
        if (providerMessageId is not null)
        {
            if (Channel != NotificationChannel.Email)
            {
                throw new InvalidOperationException(
                    "Only an email attempt may record a provider message identifier.");
            }

            if (!NotificationProviderMessageId.IsValid(providerMessageId))
            {
                throw new ArgumentException(
                    "A provider message identifier must be bounded and use a safe alphabet.",
                    nameof(providerMessageId));
            }
        }

        Complete(NotificationDeliveryOutcome.Succeeded, now, null);
        ProviderMessageId = providerMessageId;
    }

    public void FailTransiently(DateTimeOffset now, string failureCode) =>
        Complete(NotificationDeliveryOutcome.TransientFailure, now, failureCode);

    public void FailPermanently(DateTimeOffset now, string failureCode) =>
        Complete(NotificationDeliveryOutcome.PermanentFailure, now, failureCode);

    /// <summary>
    /// Authoritative state changed after this attempt was durably started but before anything was
    /// materialized — including a recipient opting out of email after the claim committed. The
    /// suppression did not fail and does not earn a retry, but the started attempt remains a completed
    /// historical fact rather than being erased or left open forever.
    /// </summary>
    public void Suppress(DateTimeOffset now, string reasonCode) =>
        Complete(NotificationDeliveryOutcome.Suppressed, now, reasonCode);

    /// <summary>
    /// The claim that started this attempt expired without finishing it. Recorded before the
    /// replacement attempt is created, so a reclaimed delivery shows what happened to the try it
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
/// The delivery channels a notification may be selected for.
/// </summary>
/// <remarks>
/// <see cref="InApp"/> is passive persisted state that interrupts nobody and is always selected.
/// <see cref="Email"/> is the first interruptive channel: it costs money, lands in a mailbox, arrives
/// at whatever hour it arrives, and is therefore opt-in, quiet-hours aware, and independently
/// retried. Nothing about one channel's state is readable or writable from the other.
/// </remarks>
public enum NotificationChannel
{
    InApp = 1,
    Email = 2,
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
