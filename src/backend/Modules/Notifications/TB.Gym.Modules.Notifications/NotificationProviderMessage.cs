using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Notifications;

/// <summary>
/// The durable, tenant-aware relationship between one accepted provider request and the delivery it
/// came from, plus every later fact that provider reported about it.
/// </summary>
/// <remarks>
/// This row exists for two reasons, and the second is the one that shapes it.
/// <para>
/// The first is correlation. A provider event arrives on a public route with no session, no
/// workspace header and nothing but the provider's own message identifier. Resolving that identifier
/// to a workspace has to be a durable lookup rather than something inferred from the request, and it
/// has to fail closed: an identifier this deployment never issued belongs to nobody, and an event is
/// only ever applied to the exact delivery whose acceptance created this row.
/// </para>
/// <para>
/// The second is immutability. Phase 6B-3A made a terminal channel delivery immutable, and that is
/// worth keeping exactly as it is: once an email is materialized, nothing may rewrite what happened.
/// Provider facts arrive afterwards, asynchronously and out of order, so they cannot live on the
/// delivery without either weakening that rule or pretending the later facts are part of the earlier
/// one. They live here instead. The delivery records provider acceptance in the same statement that
/// makes it terminal — that much is synchronous and known — and every later fact accumulates on this
/// row, each written exactly once.
/// </para>
/// <para>
/// Write-once is what makes out-of-order events safe. A bounce that arrives before the
/// recipient-server acceptance it contradicts does not overwrite anything, and neither does the
/// acceptance when it turns up second: both are recorded, both are true statements about what the
/// provider said, and the append-only <see cref="NotificationProviderEvent"/> history says in which
/// order they were learned. Nothing collapses them into a single "status" that the last writer wins.
/// </para>
/// <para>
/// It carries no address. <see cref="RecipientAddressFingerprint"/> is a keyed MAC of the mailbox this
/// message was accepted for, recorded at submission from the address the application itself resolved
/// rather than from anything the provider echoes back, so a bounce can suppress that exact mailbox
/// without any row, log or backup ever holding it.
/// </para>
/// </remarks>
public sealed class NotificationProviderMessage : TenantEntity
{
    private NotificationProviderMessage()
    {
    }

    private NotificationProviderMessage(
        Guid tenantId,
        Guid outboxItemId,
        Guid channelDeliveryId,
        Guid recipientUserId,
        string adapter,
        string providerMessageId,
        string recipientAddressFingerprint,
        string fingerprintKeyId,
        DateTimeOffset providerAcceptedAtUtc)
        : base(tenantId)
    {
        if (outboxItemId == Guid.Empty || channelDeliveryId == Guid.Empty || recipientUserId == Guid.Empty)
        {
            throw new ArgumentException("A provider message needs its intent, delivery and recipient.");
        }

        if (!NotificationEmailAdapters.IsProviderAdapterName(adapter))
        {
            throw new ArgumentException(
                "Only an adapter that contacted a real provider may record a provider message.",
                nameof(adapter));
        }

        if (!NotificationProviderMessageId.IsValid(providerMessageId))
        {
            throw new ArgumentException(
                "A provider message identifier must be bounded and use a safe alphabet.",
                nameof(providerMessageId));
        }

        if (!NotificationAddressFingerprint.IsValidFingerprint(recipientAddressFingerprint))
        {
            throw new ArgumentException(
                "A recipient address fingerprint must be lowercase hex of a SHA-256 MAC.",
                nameof(recipientAddressFingerprint));
        }

        if (!NotificationAddressFingerprint.IsValidKeyId(fingerprintKeyId))
        {
            throw new ArgumentException("A fingerprint key id is required.", nameof(fingerprintKeyId));
        }

        OutboxItemId = outboxItemId;
        ChannelDeliveryId = channelDeliveryId;
        Channel = NotificationChannel.Email;
        RecipientUserId = recipientUserId;
        Adapter = adapter;
        ProviderMessageId = providerMessageId;
        RecipientAddressFingerprint = recipientAddressFingerprint;
        FingerprintKeyId = fingerprintKeyId;
        ProviderAcceptedAtUtc = providerAcceptedAtUtc;
    }

    public Guid OutboxItemId { get; private set; }

    public Guid ChannelDeliveryId { get; private set; }

    /// <summary>Always <see cref="NotificationChannel.Email"/>; part of the composite key to the delivery.</summary>
    public NotificationChannel Channel { get; private set; }

    public Guid RecipientUserId { get; private set; }

    public string Adapter { get; private set; } = string.Empty;

    /// <summary>The provider's own identifier for the request it accepted. Globally unique per adapter.</summary>
    public string ProviderMessageId { get; private set; } = string.Empty;

    /// <summary>When the provider accepted responsibility. Not recipient-server acceptance.</summary>
    public DateTimeOffset ProviderAcceptedAtUtc { get; private set; }

    /// <summary>The keyed MAC of the mailbox this message was accepted for. Never an address.</summary>
    public string RecipientAddressFingerprint { get; private set; } = string.Empty;

    public string FingerprintKeyId { get; private set; } = string.Empty;

    /// <summary>
    /// A verified provider event said the destination mail server accepted the message. Distinct from
    /// <see cref="ProviderAcceptedAtUtc"/>, and never written from it.
    /// </summary>
    public DateTimeOffset? RecipientServerAcceptedAtUtc { get; private set; }

    public DateTimeOffset? BouncedAtUtc { get; private set; }

    /// <summary>Whether the bounce was permanent. Only a permanent bounce suppresses.</summary>
    public NotificationProviderBounceClass? BounceClass { get; private set; }

    public DateTimeOffset? ComplainedAtUtc { get; private set; }

    /// <summary>A soft failure the provider expects to retry itself. Never suppresses.</summary>
    public DateTimeOffset? DelayedAtUtc { get; private set; }

    public DateTimeOffset? FailedAtUtc { get; private set; }

    /// <summary>A stable owned code for a provider-side failure. Never the provider's own message.</summary>
    public string? FailureCode { get; private set; }

    /// <summary>The provider refused to send because its own suppression list holds the address.</summary>
    public DateTimeOffset? ProviderSuppressedAtUtc { get; private set; }

    /// <summary>How many verified events have been applied. Bookkeeping, never evidence.</summary>
    public int EventCount { get; private set; }

    /// <summary>
    /// When the newest event was received, on this system's clock. Monotonic by construction, unlike
    /// the provider's own occurrence instants, which arrive out of order.
    /// </summary>
    public DateTimeOffset? LastEventReceivedAtUtc { get; private set; }

    public static NotificationProviderMessage Record(
        Guid tenantId,
        Guid outboxItemId,
        Guid channelDeliveryId,
        Guid recipientUserId,
        string adapter,
        string providerMessageId,
        string recipientAddressFingerprint,
        string fingerprintKeyId,
        DateTimeOffset providerAcceptedAtUtc) =>
        new(
            tenantId,
            outboxItemId,
            channelDeliveryId,
            recipientUserId,
            adapter,
            providerMessageId,
            recipientAddressFingerprint,
            fingerprintKeyId,
            providerAcceptedAtUtc);

    /// <summary>
    /// Applies one verified event's fact.
    /// </summary>
    /// <remarks>
    /// Returns whether this event recorded something new. A repeat of a fact already held is not an
    /// error and not a rewrite: it converges, which is the only correct behaviour for an at-least-once
    /// provider whose events arrive in no guaranteed order.
    /// </remarks>
    public bool Apply(
        NotificationProviderEventType eventType,
        NotificationProviderBounceClass? bounceClass,
        string? failureCode,
        DateTimeOffset occurredAtUtc,
        DateTimeOffset receivedAtUtc)
    {
        var recorded = eventType switch
        {
            NotificationProviderEventType.RecipientServerAccepted =>
                RecordRecipientServerAcceptance(occurredAtUtc),
            NotificationProviderEventType.Bounced => RecordBounce(bounceClass, occurredAtUtc),
            NotificationProviderEventType.Complained => RecordComplaint(occurredAtUtc),
            NotificationProviderEventType.DeliveryDelayed => RecordDelay(occurredAtUtc),
            NotificationProviderEventType.Failed => RecordFailure(failureCode, occurredAtUtc),
            NotificationProviderEventType.ProviderSuppressed => RecordProviderSuppression(occurredAtUtc),
            // The provider echoing its own acceptance carries nothing the synchronous response did
            // not already establish, so it is verified, recorded in history, and applied to nothing.
            NotificationProviderEventType.ProviderAccepted => false,
            _ => throw new ArgumentOutOfRangeException(nameof(eventType), "Unknown provider event type."),
        };

        // Counted for every verified event, including one whose fact was already held: the count is
        // how many times the provider has spoken about this message, not how many facts are set.
        EventCount++;
        if (LastEventReceivedAtUtc is null || receivedAtUtc > LastEventReceivedAtUtc)
        {
            LastEventReceivedAtUtc = receivedAtUtc;
        }

        return recorded;
    }

    /// <summary>
    /// Whether this message's own facts require the recipient's mailbox to stop receiving email, and
    /// under which reason. A soft bounce or a delay deliberately answers null.
    /// </summary>
    public NotificationEmailSuppressionReason? SuppressionReasonFor(NotificationProviderEventType eventType) =>
        eventType switch
        {
            NotificationProviderEventType.Bounced when BounceClass == NotificationProviderBounceClass.Permanent =>
                NotificationEmailSuppressionReason.PermanentBounce,
            NotificationProviderEventType.Complained => NotificationEmailSuppressionReason.Complaint,
            NotificationProviderEventType.ProviderSuppressed =>
                NotificationEmailSuppressionReason.ProviderSuppressed,
            _ => null,
        };

    private bool RecordRecipientServerAcceptance(DateTimeOffset occurredAtUtc)
    {
        if (RecipientServerAcceptedAtUtc is not null)
        {
            return false;
        }

        RecipientServerAcceptedAtUtc = occurredAtUtc;
        return true;
    }

    private bool RecordComplaint(DateTimeOffset occurredAtUtc)
    {
        if (ComplainedAtUtc is not null)
        {
            return false;
        }

        ComplainedAtUtc = occurredAtUtc;
        return true;
    }

    private bool RecordDelay(DateTimeOffset occurredAtUtc)
    {
        if (DelayedAtUtc is not null)
        {
            return false;
        }

        DelayedAtUtc = occurredAtUtc;
        return true;
    }

    private bool RecordProviderSuppression(DateTimeOffset occurredAtUtc)
    {
        if (ProviderSuppressedAtUtc is not null)
        {
            return false;
        }

        ProviderSuppressedAtUtc = occurredAtUtc;
        return true;
    }

    private bool RecordBounce(NotificationProviderBounceClass? bounceClass, DateTimeOffset occurredAtUtc)
    {
        if (bounceClass is not { } classification)
        {
            throw new ArgumentException("A bounce event needs its classification.", nameof(bounceClass));
        }

        if (BouncedAtUtc is not null)
        {
            return false;
        }

        BouncedAtUtc = occurredAtUtc;
        BounceClass = classification;
        return true;
    }

    private bool RecordFailure(string? failureCode, DateTimeOffset occurredAtUtc)
    {
        if (FailedAtUtc is not null)
        {
            return false;
        }

        FailedAtUtc = occurredAtUtc;
        FailureCode = failureCode ?? NotificationProviderEventCodes.ProviderFailed;
        return true;
    }
}

/// <summary>
/// How permanent a bounce the provider reported was.
/// </summary>
/// <remarks>
/// Owned vocabulary, mapped from the provider's own words rather than stored as them. Only
/// <see cref="Permanent"/> suppresses: a transient bounce is a mailbox that was full or a server that
/// was busy, and turning that into a permanent stop would silently end somebody's notifications
/// because their employer's mail server had a bad afternoon. Anything the provider does not classify
/// is <see cref="Undetermined"/> and is likewise not permanent.
/// </remarks>
public enum NotificationProviderBounceClass
{
    Permanent = 1,
    Transient = 2,
    Undetermined = 3,
}
