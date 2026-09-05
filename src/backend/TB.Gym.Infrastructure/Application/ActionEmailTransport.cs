using System.Collections.Concurrent;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using TB.Gym.Modules.Notifications;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// The owned seam between materializing an action email and doing something with it.
/// </summary>
/// <remarks>
/// Separate from <c>INotificationEmailTransport</c> on purpose, and the difference is not cosmetic. A
/// notification message is addressed to a member of a workspace and carries a tenant and an intent
/// identifier; an action email may have no workspace at all, because account confirmation and password
/// reset belong to a global Identity account that may predate every membership it will ever have.
/// Giving the notification message a nullable tenant so both could share it would put "this row has no
/// workspace" one careless join away from the tenant-scoped model that Phase 6B-3A built.
/// <para>
/// The two seams share one provider client, one request shape and one classification, through
/// <see cref="ResendEmailExchange"/>. What they do not share is durable state: nothing about an action
/// email is written to a notification row, and nothing here produces provider evidence on a channel
/// delivery.
/// </para>
/// <para>
/// Everything sensitive — the address, the subject, the body, the raw token inside the body — is
/// constructed in memory at materialization, passed across this call, and dropped.
/// </para>
/// </remarks>
internal interface IActionEmailTransport
{
    /// <summary>The adapter's stable name, recorded on the request it materializes.</summary>
    string AdapterName { get; }

    /// <summary>Whether this adapter contacts a real provider, and may therefore report evidence.</summary>
    bool ContactsProvider { get; }

    Task<ActionEmailTransportResult> SendAsync(
        ActionEmailMessage message,
        CancellationToken cancellationToken);
}

/// <summary>
/// One materialized action email, in memory only.
/// </summary>
/// <param name="Scope">A stable code naming which queue produced it, for logging and test inspection.</param>
/// <param name="RequestId">The durable request. The only identifier that reaches a log line.</param>
/// <param name="AttemptNumber">Which materialization this is. Part of the idempotency key.</param>
/// <param name="IdempotencyKey">
/// The key the provider is asked to deduplicate on. Per attempt rather than per request, because a
/// re-minted token changes the body: presenting one key with two bodies is what a provider answers with
/// a conflict instead of a send.
/// </param>
internal sealed record ActionEmailMessage(
    string Scope,
    Guid RequestId,
    int AttemptNumber,
    string IdempotencyKey,
    string RecipientAddress,
    string Subject,
    string TextBody);

internal sealed record ActionEmailTransportResult(
    ActionEmailTransportOutcome Outcome,
    ResendFailureKind? Failure = null,
    string? ProviderMessageId = null)
{
    public static ActionEmailTransportResult Captured() =>
        new(ActionEmailTransportOutcome.Captured);

    public static ActionEmailTransportResult ProviderAccepted(string providerMessageId) =>
        new(ActionEmailTransportOutcome.ProviderAccepted, ProviderMessageId: providerMessageId);

    public static ActionEmailTransportResult Refused(ResendFailureKind failure) =>
        new(ActionEmailTransportOutcome.Refused, failure);
}

internal enum ActionEmailTransportOutcome
{
    /// <summary>The adapter took the message. No network call happened and no provider was involved.</summary>
    Captured = 1,

    /// <summary>A real provider accepted responsibility and returned a usable identifier.</summary>
    ProviderAccepted = 2,

    /// <summary>The provider refused, or could not be reached. The failure kind says how.</summary>
    Refused = 3,
}

/// <summary>
/// The development and test action-mail transport: it captures the message in memory and contacts
/// nothing.
/// </summary>
/// <remarks>
/// Registered exclusively outside Production, where startup validation refuses it outright. It exists
/// so that the whole path — enqueue, claim, recheck, mint, commit the token hash, render, send and
/// finalize — can be built and proven end to end without a provider, and so that adding one is a new
/// implementation of this interface rather than a change to the model.
/// <para>
/// What it captures never becomes durable. The bounded buffer lives in this process, is dropped when
/// the process ends, and is the only place a recipient address, a rendered body or a raw action URL
/// exists at all. It is also what a development caller reads to get the link it would otherwise have
/// had to open a mailbox for.
/// </para>
/// </remarks>
internal sealed class CapturedActionEmailTransport : IActionEmailTransport
{
    /// <summary>The value recorded on a request this adapter materialized.</summary>
    public const string CapturedAdapterName = "captured";

    /// <summary>
    /// Bounded so a long development session cannot grow the buffer without limit. The oldest capture
    /// is dropped rather than the newest refused: a full buffer must never turn into a delivery
    /// failure, because that would make the adapter's own bookkeeping change the domain outcome.
    /// </summary>
    private const int Capacity = 200;

    private readonly ConcurrentQueue<string> captureOrder = new();

    private readonly ConcurrentDictionary<string, CapturedActionEmail> captured = new(StringComparer.Ordinal);

    public string AdapterName => CapturedAdapterName;

    /// <summary>False, and the reason this property exists. A capture contacted nobody.</summary>
    public bool ContactsProvider => false;

    public Task<ActionEmailTransportResult> SendAsync(
        ActionEmailMessage message,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(message);
        cancellationToken.ThrowIfCancellationRequested();

        var capture = new CapturedActionEmail(
            message.Scope,
            message.RequestId,
            message.AttemptNumber,
            message.IdempotencyKey,
            message.RecipientAddress,
            message.Subject,
            message.TextBody);
        if (captured.TryAdd(message.IdempotencyKey, capture))
        {
            captureOrder.Enqueue(message.IdempotencyKey);
        }

        while (captured.Count > Capacity && captureOrder.TryDequeue(out var oldestKey))
        {
            captured.TryRemove(oldestKey, out _);
        }

        return Task.FromResult(ActionEmailTransportResult.Captured());
    }

    /// <summary>Everything captured so far, newest last. For development inspection and tests only.</summary>
    public IReadOnlyList<CapturedActionEmail> Captured =>
        [.. captureOrder.Select(key => captured.TryGetValue(key, out var capture) ? capture : null)
            .OfType<CapturedActionEmail>()];

    /// <summary>The most recent capture for one request, or null. This is the development link source.</summary>
    public CapturedActionEmail? LatestFor(Guid requestId) =>
        Captured.LastOrDefault(capture => capture.RequestId == requestId);

    /// <summary>Empties the buffer. Development and test convenience; it deletes nothing durable.</summary>
    public void Clear()
    {
        captured.Clear();
        while (captureOrder.TryDequeue(out _))
        {
            // Drain.
        }
    }
}

/// <summary>One captured action email. Exists only in the adapter's memory, and only outside Production.</summary>
internal sealed record CapturedActionEmail(
    string Scope,
    Guid RequestId,
    int AttemptNumber,
    string IdempotencyKey,
    string RecipientAddress,
    string Subject,
    string TextBody)
{
    /// <summary>
    /// The action URL this message carries, recovered from the rendered body.
    /// </summary>
    /// <remarks>
    /// Development and test only. The templates put the link on its own line, so this reads the first
    /// absolute URL in the body rather than requiring the renderer to hand the link back separately —
    /// which would mean a second path along which a live credential travels.
    /// </remarks>
    public string? ActionUrl => TextBody
        .Split('\n', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
        .FirstOrDefault(line =>
            (line.StartsWith("https://", StringComparison.Ordinal) ||
                line.StartsWith("http://", StringComparison.Ordinal)) &&
            Uri.TryCreate(line, UriKind.Absolute, out _));
}

/// <summary>
/// The production action-mail transport, over the same provider client the notification channel uses.
/// </summary>
/// <remarks>
/// It shares the exchange and therefore the request shape, the bounded read, the parser limits and the
/// classification. What it keeps for itself is its own logging: an action-mail operator needs the
/// request identifier and the queue that produced it, and must never be given a tenant identifier for
/// a global account mail that has none.
/// <para>
/// It carries a live credential in its body, so the discipline is stricter rather than looser: no log
/// line, no exception message and no returned classification contains the address, the subject, the
/// body, the token or the link.
/// </para>
/// </remarks>
internal sealed class ResendActionEmailTransport(
    IHttpClientFactory httpClientFactory,
    IOptions<NotificationEmailOptions> options,
    ILogger<ResendActionEmailTransport> logger)
    : IActionEmailTransport
{
    /// <summary>The value recorded on a request this adapter materialized.</summary>
    public const string ResendAdapterName = "resend";

    private static readonly Action<ILogger, string, Guid, int, int, string, Exception?> LogRefused =
        LoggerMessage.Define<string, Guid, int, int, string>(
            LogLevel.Warning,
            new EventId(6141, "ActionEmailProviderRefused"),
            "Email provider refused {Scope} action mail {RequestId} attempt {AttemptNumber} with status {StatusCode} classified as {FailureKind}.");

    private static readonly Action<ILogger, string, Guid, int, Exception?> LogFault =
        LoggerMessage.Define<string, Guid, int>(
            LogLevel.Error,
            new EventId(6142, "ActionEmailProviderOperationalFault"),
            "Email provider rejected this deployment's configuration for {Scope} action mail {RequestId} attempt {AttemptNumber}. Check the provider credentials and sending identity.");

    private readonly NotificationEmailOptions email = options.Value;

    public string AdapterName => ResendAdapterName;

    public bool ContactsProvider => true;

    public async Task<ActionEmailTransportResult> SendAsync(
        ActionEmailMessage message,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(message);

        var exchange = await ResendEmailExchange.SendAsync(
            httpClientFactory,
            email.Provider,
            new ResendEmailRequest(
                message.IdempotencyKey,
                message.RecipientAddress,
                message.Subject,
                message.TextBody),
            cancellationToken);

        if (exchange.IsAccepted)
        {
            return ActionEmailTransportResult.ProviderAccepted(exchange.ProviderMessageId!);
        }

        if (exchange.Failure == ResendFailureKind.Unauthorized)
        {
            LogFault(logger, message.Scope, message.RequestId, message.AttemptNumber, null);
        }
        else
        {
            LogRefused(
                logger,
                message.Scope,
                message.RequestId,
                message.AttemptNumber,
                exchange.StatusCode ?? 0,
                exchange.Failure?.ToString() ?? "Unknown",
                null);
        }

        return ActionEmailTransportResult.Refused(exchange.Failure ?? ResendFailureKind.Rejected);
    }
}
