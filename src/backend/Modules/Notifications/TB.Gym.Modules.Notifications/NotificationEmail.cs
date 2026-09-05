namespace TB.Gym.Modules.Notifications;

/// <summary>
/// The owned seam between materializing an email and doing something with it.
/// </summary>
/// <remarks>
/// The interface is the boundary a provider sits behind, and it is shaped so that the durable model
/// never has to know which one. Everything sensitive — the address, the subject, the body — is
/// constructed in memory at materialization time, passed across this call, and dropped. It is never
/// written to the outbox, a channel delivery, an attempt, a dead-letter row or a log.
/// <para>
/// Two implementations exist. The captured adapter contacts nothing and reports
/// <see cref="NotificationEmailTransportOutcome.Captured"/> with no provider identifier, because
/// calling a capture "sent" or "accepted" would be a claim about a provider that was never asked.
/// The production adapter contacts one real provider over HTTP and may report
/// <see cref="NotificationEmailTransportOutcome.ProviderAccepted"/> together with the identifier that
/// provider returned — which is a claim that the provider took responsibility for the request, and
/// deliberately not a claim that any mail server accepted it or that anybody read it.
/// </para>
/// </remarks>
public interface INotificationEmailTransport
{
    /// <summary>The adapter's stable name, recorded on the delivery it materializes.</summary>
    string AdapterName { get; }

    /// <summary>
    /// Whether this adapter contacts a real provider, and may therefore report provider evidence.
    /// The captured adapter answers false, and database checks refuse it those columns anyway.
    /// </summary>
    bool ContactsProvider { get; }

    Task<NotificationEmailTransportResult> SendAsync(
        NotificationEmailMessage message,
        CancellationToken cancellationToken);
}

/// <summary>
/// One materialized email, in memory only.
/// </summary>
/// <remarks>
/// Constructed immediately before the transport call and never persisted.
/// <para>
/// <paramref name="IdempotencyKey"/> is the key the provider is asked to deduplicate on. It binds the
/// intent, the channel and the exact recipient, so a retry of the same message to the same mailbox is
/// recognisably the same request while a message to a mailbox the account has since changed is a
/// different one — which is what keeps a legitimate later send from colliding with a key the provider
/// still remembers. The recipient participates through a keyed fingerprint rather than through the
/// address itself, so the key is safe to persist and quote. Even with a stable key the honest
/// guarantee is at-least-once within the provider's own retention window, never exactly-once.
/// </para>
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

    /// <summary>
    /// A real provider returned success and a usable identifier for the request it took. The
    /// identifier is validated by <see cref="NotificationProviderMessageId.IsValid"/> before it is
    /// allowed anywhere near a database row.
    /// </summary>
    public static NotificationEmailTransportResult ProviderAccepted(string providerMessageId) =>
        new(NotificationEmailTransportOutcome.ProviderAccepted, ProviderMessageId: providerMessageId);

    public static NotificationEmailTransportResult TransientFailure(string failureCode) =>
        new(NotificationEmailTransportOutcome.TransientFailure, failureCode);

    public static NotificationEmailTransportResult PermanentFailure(string failureCode) =>
        new(NotificationEmailTransportOutcome.PermanentFailure, failureCode);
}

/// <summary>
/// What a transport managed to do.
/// </summary>
/// <remarks>
/// Deliberately without a <c>Delivered</c> or <c>Sent</c> member. The strongest thing a synchronous
/// call can establish is that the provider accepted responsibility for the request; whether a
/// recipient's mail server then accepted the message is a separate, later, asynchronous fact that
/// only an authenticated provider event may record.
/// </remarks>
public enum NotificationEmailTransportOutcome
{
    /// <summary>The adapter took the message. No network call happened and no provider was involved.</summary>
    Captured = 1,

    /// <summary>Something that may work later. Earns a retry from the named backoff schedule.</summary>
    TransientFailure = 2,

    /// <summary>Something no amount of retrying will change. Dead-letters immediately.</summary>
    PermanentFailure = 3,

    /// <summary>
    /// A real provider accepted responsibility for the request and returned a usable identifier.
    /// Not recipient-server acceptance, not delivery, and not read.
    /// </summary>
    ProviderAccepted = 4,
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
    /// <summary>No transport. The default, and the only value that needs no provider configuration.</summary>
    public const string None = "None";

    /// <summary>
    /// The in-memory development and test adapter. Refused outright in Production, so a deployment
    /// cannot end up believing it is emailing anybody while the messages go into a process's memory.
    /// </summary>
    public const string Captured = "Captured";

    /// <summary>The one production transactional email provider this build implements. See ADR 0022.</summary>
    public const string Resend = "Resend";

    /// <summary>The value recorded on a delivery the captured adapter materialized.</summary>
    public const string CapturedAdapterName = "captured";

    /// <summary>The value recorded on a delivery the production provider adapter materialized.</summary>
    public const string ResendAdapterName = "resend";

    /// <summary>Every adapter name that contacts a real provider, as recorded on a delivery.</summary>
    public static IReadOnlyList<string> ProviderAdapterNames { get; } = [ResendAdapterName];

    /// <summary>Whether a recorded transport-adapter name is one that contacted a real provider.</summary>
    public static bool IsProviderAdapterName(string? adapterName) =>
        adapterName is not null &&
        ProviderAdapterNames.Contains(adapterName, StringComparer.Ordinal);
}
