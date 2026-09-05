using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Notifications;

/// <summary>
/// One authenticated statement a provider made about one message it accepted.
/// </summary>
/// <remarks>
/// Append-only, and deliberately a record of what was said rather than a copy of what was sent. The
/// raw webhook body is verified, read, mapped and dropped; what survives is the provider's event
/// identifier, an owned classification, the two instants that matter, and — for a bounce or a
/// failure — a stable code this repository owns. Never the body, never the recipient address, never a
/// subject, never a header, never a signature.
/// <para>
/// The identifier is what makes ingestion idempotent. A provider that guarantees at-least-once
/// delivery will re-send an event whenever it is unsure, and a unique index on the adapter and this
/// identifier is what turns the second arrival into a no-op instead of a second bounce.
/// </para>
/// <para>
/// It is history, not state. The fact each event establishes is applied write-once to
/// <see cref="NotificationProviderMessage"/>; this row records that the statement was made, when it
/// was made, and when it was learned — which is the only way to explain afterwards why a message that
/// bounced also has a recipient-server acceptance, or in which order the two arrived.
/// </para>
/// </remarks>
public sealed class NotificationProviderEvent : TenantEntity
{
    private NotificationProviderEvent()
    {
    }

    private NotificationProviderEvent(
        Guid tenantId,
        Guid providerMessageRecordId,
        string adapter,
        string providerEventId,
        NotificationProviderEventType eventType,
        NotificationProviderBounceClass? bounceClass,
        string? failureCode,
        DateTimeOffset occurredAtUtc,
        DateTimeOffset receivedAtUtc,
        bool appliedNewFact)
        : base(tenantId)
    {
        if (providerMessageRecordId == Guid.Empty)
        {
            throw new ArgumentException(
                "Provider evidence belongs to the message it describes.",
                nameof(providerMessageRecordId));
        }

        if (!NotificationEmailAdapters.IsProviderAdapterName(adapter))
        {
            throw new ArgumentException("Only a real provider adapter records events.", nameof(adapter));
        }

        if (!IsValidEventId(providerEventId))
        {
            throw new ArgumentException(
                "A provider event identifier must be bounded and use a safe alphabet.",
                nameof(providerEventId));
        }

        if (!Enum.IsDefined(eventType))
        {
            throw new ArgumentException("An unknown provider event type cannot be recorded.", nameof(eventType));
        }

        if ((eventType == NotificationProviderEventType.Bounced) != (bounceClass is not null))
        {
            throw new ArgumentException("Exactly a bounce carries a bounce classification.", nameof(bounceClass));
        }

        ProviderMessageRecordId = providerMessageRecordId;
        Adapter = adapter;
        ProviderEventId = providerEventId;
        EventType = eventType;
        BounceClass = bounceClass;
        FailureCode = failureCode is null ? null : Normalize(failureCode, 100, nameof(failureCode));
        OccurredAtUtc = occurredAtUtc;
        ReceivedAtUtc = receivedAtUtc;
        AppliedNewFact = appliedNewFact;
        SignatureScheme = NotificationWebhookSignature.SchemeName;
        SignatureSchemeVersion = NotificationWebhookSignature.SchemeVersion;
    }

    public Guid ProviderMessageRecordId { get; private set; }

    public string Adapter { get; private set; } = string.Empty;

    /// <summary>The provider's own event identifier, unique per adapter and the basis of idempotency.</summary>
    public string ProviderEventId { get; private set; } = string.Empty;

    public NotificationProviderEventType EventType { get; private set; }

    public NotificationProviderBounceClass? BounceClass { get; private set; }

    /// <summary>A stable owned code. Never the provider's own diagnostic text, which quotes addresses.</summary>
    public string? FailureCode { get; private set; }

    /// <summary>When the provider says it happened. Untrusted enough to be bounded before it is stored.</summary>
    public DateTimeOffset OccurredAtUtc { get; private set; }

    /// <summary>When this deployment verified and accepted it. Monotonic, unlike the provider's instant.</summary>
    public DateTimeOffset ReceivedAtUtc { get; private set; }

    /// <summary>
    /// Whether this event was the one that established its fact, or arrived after another already had.
    /// Recorded so an out-of-order history can be read without recomputing it.
    /// </summary>
    public bool AppliedNewFact { get; private set; }

    /// <summary>The named signature scheme this event was authenticated under.</summary>
    public string SignatureScheme { get; private set; } = string.Empty;

    public int SignatureSchemeVersion { get; private set; }

    public static NotificationProviderEvent Record(
        Guid tenantId,
        Guid providerMessageRecordId,
        string adapter,
        string providerEventId,
        NotificationProviderEventType eventType,
        NotificationProviderBounceClass? bounceClass,
        string? failureCode,
        DateTimeOffset occurredAtUtc,
        DateTimeOffset receivedAtUtc,
        bool appliedNewFact) =>
        new(
            tenantId,
            providerMessageRecordId,
            adapter,
            providerEventId,
            eventType,
            bounceClass,
            failureCode,
            occurredAtUtc,
            receivedAtUtc,
            appliedNewFact);

    public static bool IsValidEventId(string? providerEventId)
    {
        if (string.IsNullOrEmpty(providerEventId) ||
            providerEventId.Length > NotificationWebhookSignature.MaximumEventIdLength)
        {
            return false;
        }

        foreach (var character in providerEventId)
        {
            if (!char.IsAsciiLetterOrDigit(character) && character is not ('-' or '_' or '.' or ':'))
            {
                return false;
            }
        }

        return true;
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
/// The owned vocabulary of provider events.
/// </summary>
/// <remarks>
/// Mapped from the provider's own event names rather than stored as them, so a rename at the provider
/// is a change to one mapping table instead of a change to the domain, and so a second provider can
/// be added later without either one's words leaking into a column somebody queries.
/// <para>
/// The set is deliberately small. Open and click events are not in it and are not persisted at all:
/// an open is not a read, a tracking pixel is a surveillance mechanism this product has no use for,
/// and recording "somebody opened it" would be the beginning of exactly the tracking log the consent
/// evidence was carefully kept from becoming.
/// </para>
/// </remarks>
public enum NotificationProviderEventType
{
    /// <summary>The provider restating its own acceptance. Carries nothing the send response did not.</summary>
    ProviderAccepted = 1,

    /// <summary>The destination mail server accepted the message. Not read, and not the provider's own acceptance.</summary>
    RecipientServerAccepted = 2,

    /// <summary>The destination refused it. Only a permanent classification suppresses.</summary>
    Bounced = 3,

    /// <summary>The recipient marked it as spam. Always suppresses.</summary>
    Complained = 4,

    /// <summary>A temporary problem the provider expects to retry itself. Never suppresses.</summary>
    DeliveryDelayed = 5,

    /// <summary>The provider could not send it at all.</summary>
    Failed = 6,

    /// <summary>The provider refused because its own suppression list holds the address.</summary>
    ProviderSuppressed = 7,
}

/// <summary>
/// Stable owned codes for the facts a provider event can carry. Safe to log and to show an operator:
/// no address, no subject, no body, no provider diagnostic text.
/// </summary>
public static class NotificationProviderEventCodes
{
    public const string ProviderFailed = "notification-email-provider-failed";

    public const string BouncePermanent = "notification-email-bounce-permanent";

    public const string BounceTransient = "notification-email-bounce-transient";

    public const string BounceUndetermined = "notification-email-bounce-undetermined";

    public static string For(NotificationProviderBounceClass bounceClass) => bounceClass switch
    {
        NotificationProviderBounceClass.Permanent => BouncePermanent,
        NotificationProviderBounceClass.Transient => BounceTransient,
        _ => BounceUndetermined,
    };
}
