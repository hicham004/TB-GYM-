using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Notifications;

/// <summary>
/// A durable refusal to email one mailbox again, because a verified provider event said it is not
/// worth mailing.
/// </summary>
/// <remarks>
/// Continuing to mail an address that hard-bounced, or somebody who pressed "this is spam", is how a
/// sending domain's reputation is destroyed and how everybody else's mail from the same domain starts
/// landing in spam folders. It is also simply rude. So a permanent bounce and a complaint both stop
/// further email, durably, and the record explains itself: which reason, which provider event
/// established it, and when.
/// <para>
/// It is keyed on a mailbox, not on a person. That distinction is the whole design: a client who
/// mistyped their address, bounced, and then corrected it must start receiving mail again, and a
/// suppression recorded against the member would leave them permanently silent for a mistake they
/// already fixed. The mailbox participates as a keyed fingerprint, so no address is stored here
/// either — see <see cref="NotificationAddressFingerprint"/> for why an unsalted hash would not do.
/// </para>
/// <para>
/// It affects email and nothing else. The in-app delivery of the same notification is untouched, so a
/// suppressed member still sees everything in their inbox when they sign in; suppression is about a
/// mailbox refusing mail, never about withdrawing what somebody is entitled to be told.
/// </para>
/// <para>
/// Immutable once written, and never deleted by this application. There is no override, no manual
/// clearing and no replay surface in this phase: a control that un-suppresses somebody's mailbox is a
/// control that can be used to keep mailing an address that complained, and it needs its own decision
/// about who may press it and what is recorded when they do.
/// </para>
/// </remarks>
public sealed class NotificationEmailSuppression : TenantEntity
{
    private NotificationEmailSuppression()
    {
    }

    private NotificationEmailSuppression(
        Guid tenantId,
        Guid userId,
        string addressFingerprint,
        string fingerprintKeyId,
        NotificationEmailSuppressionReason reason,
        DateTimeOffset suppressedAtUtc,
        Guid sourceProviderEventId,
        Guid sourceProviderMessageId)
        : base(tenantId)
    {
        if (userId == Guid.Empty || sourceProviderEventId == Guid.Empty || sourceProviderMessageId == Guid.Empty)
        {
            throw new ArgumentException("A suppression needs its subject and the evidence that caused it.");
        }

        if (!NotificationAddressFingerprint.IsValidFingerprint(addressFingerprint))
        {
            throw new ArgumentException(
                "A suppression is keyed on a fingerprint, which is lowercase hex of a SHA-256 MAC.",
                nameof(addressFingerprint));
        }

        if (!NotificationAddressFingerprint.IsValidKeyId(fingerprintKeyId))
        {
            throw new ArgumentException("A fingerprint key id is required.", nameof(fingerprintKeyId));
        }

        if (!Enum.IsDefined(reason))
        {
            throw new ArgumentException("An unknown suppression reason cannot be recorded.", nameof(reason));
        }

        UserId = userId;
        AddressFingerprint = addressFingerprint;
        FingerprintKeyId = fingerprintKeyId;
        Reason = reason;
        SuppressedAtUtc = suppressedAtUtc;
        SourceProviderEventId = sourceProviderEventId;
        SourceProviderMessageId = sourceProviderMessageId;
    }

    /// <summary>The member whose mailbox this was, so the record stays inside one workspace and subject.</summary>
    public Guid UserId { get; private set; }

    /// <summary>The keyed MAC of the suppressed mailbox. Never an address.</summary>
    public string AddressFingerprint { get; private set; } = string.Empty;

    public string FingerprintKeyId { get; private set; } = string.Empty;

    public NotificationEmailSuppressionReason Reason { get; private set; }

    public DateTimeOffset SuppressedAtUtc { get; private set; }

    /// <summary>The exact append-only provider event that established this. Never null, never rewritten.</summary>
    public Guid SourceProviderEventId { get; private set; }

    public Guid SourceProviderMessageId { get; private set; }

    public static NotificationEmailSuppression Record(
        Guid tenantId,
        Guid userId,
        string addressFingerprint,
        string fingerprintKeyId,
        NotificationEmailSuppressionReason reason,
        DateTimeOffset suppressedAtUtc,
        Guid sourceProviderEventId,
        Guid sourceProviderMessageId) =>
        new(
            tenantId,
            userId,
            addressFingerprint,
            fingerprintKeyId,
            reason,
            suppressedAtUtc,
            sourceProviderEventId,
            sourceProviderMessageId);
}

/// <summary>
/// Why a mailbox stopped receiving email.
/// </summary>
/// <remarks>
/// Three reasons, all of them things a provider verified rather than things this application decided.
/// There is deliberately no "too many transient failures" member: turning a run of soft failures into
/// a permanent stop is a policy with a threshold, and a threshold nobody has chosen is not a policy.
/// </remarks>
public enum NotificationEmailSuppressionReason
{
    /// <summary>A verified permanent bounce. The mailbox does not exist or refuses this sender.</summary>
    PermanentBounce = 1,

    /// <summary>The recipient marked a message as spam. Continuing would be both harmful and rude.</summary>
    Complaint = 2,

    /// <summary>The provider itself refused, because its own suppression list already holds the address.</summary>
    ProviderSuppressed = 3,
}
