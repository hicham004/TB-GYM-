namespace TB.Gym.Modules.Notifications;

/// <summary>
/// The owned seam between materializing an email and doing something with it.
/// </summary>
/// <remarks>
/// The interface is the boundary a provider SDK will one day sit behind, and it is shaped so that the
/// durable model never has to know one exists. Everything sensitive — the address, the subject, the
/// body — is constructed in memory at materialization time, passed across this call, and dropped. It
/// is never written to the outbox, a channel delivery, an attempt, a dead-letter row or a log.
/// <para>
/// The only implementation in this phase captures in memory for development and tests. It contacts
/// nothing, so it returns <see cref="NotificationEmailTransportOutcome.Captured"/> and a null provider
/// message identifier: calling a capture "delivered", "sent" or "accepted" would be a claim about a
/// provider that was never asked.
/// </para>
/// </remarks>
public interface INotificationEmailTransport
{
    /// <summary>The adapter's stable name, recorded on the delivery it materializes.</summary>
    string AdapterName { get; }

    Task<NotificationEmailTransportResult> SendAsync(
        NotificationEmailMessage message,
        CancellationToken cancellationToken);
}

/// <summary>
/// One materialized email, in memory only.
/// </summary>
/// <remarks>
/// Constructed immediately before the transport call and never persisted. <paramref name="IdempotencyKey"/>
/// is stable for the intent and the channel, which is the key a real provider would be asked to
/// deduplicate on; the honest guarantee even then is at-least-once with provider-specific
/// reconciliation, never exactly-once.
/// </remarks>
public sealed record NotificationEmailMessage(
    Guid TenantId,
    Guid OutboxItemId,
    string IdempotencyKey,
    string RecipientAddress,
    string Subject,
    string TextBody);

public sealed record NotificationEmailTransportResult(
    NotificationEmailTransportOutcome Outcome,
    string? FailureCode = null,
    string? ProviderMessageId = null)
{
    public static NotificationEmailTransportResult Captured() =>
        new(NotificationEmailTransportOutcome.Captured);

    public static NotificationEmailTransportResult TransientFailure(string failureCode) =>
        new(NotificationEmailTransportOutcome.TransientFailure, failureCode);

    public static NotificationEmailTransportResult PermanentFailure(string failureCode) =>
        new(NotificationEmailTransportOutcome.PermanentFailure, failureCode);
}

/// <summary>
/// What a transport managed to do. Deliberately without a <c>Delivered</c> or <c>Sent</c> member:
/// this phase can establish capture and nothing beyond it.
/// </summary>
public enum NotificationEmailTransportOutcome
{
    /// <summary>The adapter took the message. No network call happened and no provider was involved.</summary>
    Captured = 1,

    /// <summary>Something that may work later. Earns a retry from the named backoff schedule.</summary>
    TransientFailure = 2,

    /// <summary>Something no amount of retrying will change. Dead-letters immediately.</summary>
    PermanentFailure = 3,
}

/// <summary>
/// The narrow contract by which the Notifications module learns a recipient's address.
/// </summary>
/// <remarks>
/// The address is resolved at materialization and nowhere else, so it exists for the duration of one
/// transport call and is never snapshotted into a queue row that a dead-letter view or an operator
/// could read. The implementation lives in Infrastructure, which is what composes the modules; the
/// Notifications module does not reach into Identity's tables to find an email address, and an
/// architecture test asserts it holds no reference that would let it.
/// <para>
/// The contract is authorized, not merely a lookup: it returns nothing unless the account still holds
/// an active membership of that workspace, so a removed member cannot be mailed by a delivery row
/// scheduled while they were still there.
/// </para>
/// </remarks>
public interface INotificationRecipientContacts
{
    Task<NotificationRecipientContact?> ResolveAsync(
        Guid tenantId,
        Guid userId,
        CancellationToken cancellationToken);
}

/// <summary>
/// A recipient's current contact facts. Held in memory for one materialization and never persisted.
/// </summary>
public sealed record NotificationRecipientContact(string EmailAddress, bool EmailConfirmed);

/// <summary>
/// The email adapter names this build understands.
/// </summary>
public static class NotificationEmailAdapters
{
    /// <summary>No transport. The default, and the only permitted production value in this phase.</summary>
    public const string None = "None";

    /// <summary>
    /// The in-memory development and test adapter. Refused outright in Production, so a deployment
    /// cannot end up believing it is emailing anybody while the messages go into a process's memory.
    /// </summary>
    public const string Captured = "Captured";

    /// <summary>The value recorded on a delivery the captured adapter materialized.</summary>
    public const string CapturedAdapterName = "captured";
}

/// <summary>
/// Whether this deployment may materialize email at all, and with what.
/// </summary>
/// <remarks>
/// Disabled by default. Startup validation is deliberately strict rather than forgiving:
/// <list type="bullet">
/// <item><description>an unknown adapter name fails startup instead of being read as "none";</description></item>
/// <item><description><see cref="Enabled"/> with no adapter fails startup, because enabling a channel
/// that cannot send is a configuration error and not a quiet no-op;</description></item>
/// <item><description>the captured adapter in Production fails startup whether email is enabled or
/// not, so production configuration can never silently use it;</description></item>
/// <item><description><see cref="Enabled"/> in Production fails startup in this phase, because no
/// real provider exists yet and there is nothing honest for it to mean.</description></item>
/// </list>
/// </remarks>
public sealed class NotificationEmailOptions
{
    public const string SectionName = "Notifications:Email";

    /// <summary>Off by default. A durable channel that reaches a mailbox is opt-in for a deployment too.</summary>
    public bool Enabled { get; set; }

    public string Adapter { get; set; } = NotificationEmailAdapters.None;

    public bool IsKnownAdapter =>
        string.Equals(Adapter, NotificationEmailAdapters.None, StringComparison.OrdinalIgnoreCase) ||
        string.Equals(Adapter, NotificationEmailAdapters.Captured, StringComparison.OrdinalIgnoreCase);

    public bool UsesCapturedAdapter =>
        string.Equals(Adapter, NotificationEmailAdapters.Captured, StringComparison.OrdinalIgnoreCase);

    /// <summary>Whether email may actually be planned and materialized right now.</summary>
    public bool IsAvailable => Enabled && UsesCapturedAdapter;

    /// <summary>
    /// The startup rule, in one place so the API, the Worker and the architecture test all assert the
    /// same thing. Returns null when the configuration is acceptable, or the reason it is not.
    /// </summary>
    public string? Validate(bool isProduction)
    {
        if (!IsKnownAdapter)
        {
            return $"{SectionName}:Adapter must be '{NotificationEmailAdapters.None}' or '{NotificationEmailAdapters.Captured}'.";
        }

        if (isProduction && UsesCapturedAdapter)
        {
            return $"{SectionName}:Adapter cannot be '{NotificationEmailAdapters.Captured}' in Production; captured email is a development and test adapter.";
        }

        if (isProduction && Enabled)
        {
            return $"{SectionName}:Enabled cannot be true in Production until a real email provider is configured.";
        }

        if (Enabled && !UsesCapturedAdapter)
        {
            return $"{SectionName}:Enabled requires a configured email adapter.";
        }

        return null;
    }
}
