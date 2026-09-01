using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Notifications;

/// <summary>
/// One notification a person can read, in one workspace.
/// </summary>
/// <remarks>
/// This is passive persisted state. Creating it is not a push, an email, a message or a realtime
/// event, and it deliberately does not consult quiet hours: nothing about it interrupts anybody.
/// The first interruptive channel is what will need preferences and quiet hours, and it is not in
/// this slice.
/// <para>
/// <see cref="Title"/> and <see cref="Body"/> are historical snapshots rendered from the template
/// named by <see cref="TemplateKey"/> and <see cref="TemplateVersion"/> at the moment of delivery.
/// Editing a template later publishes a new version and never rewrites what somebody was already
/// told, in the same way a published check-in version never rewrites a submitted answer.
/// </para>
/// <para>
/// <see cref="ReadAtUtc"/> is the reader's own act. It is never used to record that a channel or a
/// provider acknowledged anything; that belongs to <see cref="NotificationDeliveryAttempt"/>.
/// </para>
/// </remarks>
public sealed class Notification : TenantEntity
{
    private Notification()
    {
    }

    private Notification(
        Guid tenantId,
        Guid recipientUserId,
        Guid sourceOutboxItemId,
        CommercialNotificationKind kind,
        NotificationTemplate template)
        : base(tenantId)
    {
        if (recipientUserId == Guid.Empty || sourceOutboxItemId == Guid.Empty || !Enum.IsDefined(kind))
        {
            throw new ArgumentException("Recipient, source outbox item, and notification kind are required.");
        }

        RecipientUserId = recipientUserId;
        SourceOutboxItemId = sourceOutboxItemId;
        Kind = kind;
        TemplateKey = template.Key;
        TemplateVersion = template.Version;
        Culture = template.Culture;
        Title = template.Title;
        Body = template.Body;
    }

    public Guid RecipientUserId { get; private set; }

    /// <summary>
    /// The intent this notification was materialized from. Unique per workspace, which is what makes
    /// a replayed dispatch idempotent even if a worker died between writing the notification and
    /// completing the outbox row.
    /// </summary>
    public Guid SourceOutboxItemId { get; private set; }

    public CommercialNotificationKind Kind { get; private set; }

    public string TemplateKey { get; private set; } = string.Empty;

    public int TemplateVersion { get; private set; }

    public string Culture { get; private set; } = string.Empty;

    public string Title { get; private set; } = string.Empty;

    public string Body { get; private set; } = string.Empty;

    public DateTimeOffset? ReadAtUtc { get; private set; }

    public bool IsRead => ReadAtUtc is not null;

    public static Notification Materialize(
        Guid tenantId,
        Guid recipientUserId,
        Guid sourceOutboxItemId,
        CommercialNotificationKind kind,
        NotificationTemplate template) =>
        new(tenantId, recipientUserId, sourceOutboxItemId, kind, template);

    /// <summary>
    /// Idempotent: reading something twice does not move the instant it was first read, and a repeat
    /// request is a success rather than a conflict.
    /// </summary>
    public bool MarkRead(DateTimeOffset now)
    {
        if (ReadAtUtc is not null)
        {
            return false;
        }

        ReadAtUtc = now;
        return true;
    }
}
