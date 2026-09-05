using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using TB.Gym.Modules.Notifications;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// The production notification email transport: one owned HTTP adapter in front of one real provider.
/// </summary>
/// <remarks>
/// It is an <c>HttpClient</c> and two small records rather than the provider's SDK, deliberately. The
/// SDK would be a package that authenticates, serializes, retries and throws on this repository's
/// behalf, and every one of those is already a decision made here — the retry schedule is durable and
/// named, the idempotency key is derived from domain state, failures must be classified into stable
/// codes before they touch a row, and no exception may ever carry a response body. Wrapping an SDK to
/// take all of that back is more code than not having one, and it would put the provider's types one
/// careless <c>using</c> away from the domain. See ADR 0022.
/// <para>
/// The HTTP exchange itself lives in <see cref="ResendEmailExchange"/>, which Phase 6B-3C extracted so
/// that global action mail reaches the same provider through the same request shape, bounded read,
/// parser limits and classification. What stays here is this channel's own vocabulary: the mapping
/// from a neutral refusal to <c>NotificationFailureCodes</c>, and logging that carries the intent and
/// workspace identifiers a notification operator needs.
/// </para>
/// <para>
/// Three rules govern everything below.
/// </para>
/// <list type="bullet">
/// <item><description><b>Nothing sensitive escapes.</b> The API key, the recipient address, the
/// rendered subject and body and the provider's response body exist as locals for the duration of one
/// call. No log line, no exception message and no returned failure code contains any of them; every
/// outcome is one of a fixed set of stable codes.</description></item>
/// <item><description><b>The response is untrusted.</b> It is read up to a hard byte limit, parsed
/// with a depth limit, and the one field taken from it is validated before it is allowed to become a
/// durable correlation key.</description></item>
/// <item><description><b>Every failure is classified, never rethrown.</b> A transport that throws
/// hands the dispatcher an exception object whose message may quote anything; this returns a result
/// instead, and the only exception it lets through is the caller's own cancellation.</description></item>
/// </list>
/// </remarks>
internal sealed class ResendNotificationEmailTransport(
    IHttpClientFactory httpClientFactory,
    IOptions<NotificationEmailOptions> options,
    ILogger<ResendNotificationEmailTransport> logger)
    : INotificationEmailTransport
{
    /// <summary>The named client, so the handler lifetime and default headers are composed once.</summary>
    public const string HttpClientName = ResendEmailExchange.HttpClientName;

    /// <summary>The user agent the provider requires, naming the application rather than a library.</summary>
    public const string UserAgent = ResendEmailExchange.UserAgent;

    // Identifiers and stable codes only. Never the address, the subject, the body, the provider's
    // response, the idempotency key's fingerprint half, or anything resembling a credential.
    private static readonly Action<ILogger, Guid, Guid, int, string, Exception?> LogProviderRefused =
        LoggerMessage.Define<Guid, Guid, int, string>(
            LogLevel.Warning,
            new EventId(6111, "NotificationEmailProviderRefused"),
            "Email provider refused notification {OutboxItemId} in workspace {TenantId} with status {StatusCode} classified as {FailureCode}.");

    private static readonly Action<ILogger, Guid, Guid, string, Exception?> LogProviderFault =
        LoggerMessage.Define<Guid, Guid, string>(
            LogLevel.Error,
            new EventId(6112, "NotificationEmailProviderOperationalFault"),
            "Email provider rejected this deployment's configuration for notification {OutboxItemId} in workspace {TenantId} ({FailureCode}). Check the provider credentials and sending identity.");

    private static readonly Action<ILogger, Guid, Guid, string, Exception?> LogProviderUnreachable =
        LoggerMessage.Define<Guid, Guid, string>(
            LogLevel.Warning,
            new EventId(6113, "NotificationEmailProviderUnreachable"),
            "Email provider could not be reached for notification {OutboxItemId} in workspace {TenantId} ({FailureCode}).");

    private readonly NotificationEmailOptions email = options.Value;

    public string AdapterName => NotificationEmailAdapters.ResendAdapterName;

    public bool ContactsProvider => true;

    public async Task<NotificationEmailTransportResult> SendAsync(
        NotificationEmailMessage message,
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

        return exchange.IsAccepted
            ? NotificationEmailTransportResult.ProviderAccepted(exchange.ProviderMessageId!)
            : Refuse(message, exchange);
    }

    /// <summary>
    /// Turns a neutral refusal into this channel's own stable code, and logs it.
    /// </summary>
    /// <remarks>
    /// Authentication and configuration refusals are classified transient and logged as an operational
    /// fault rather than dead-lettered. A revoked key or an unverified sending domain is a deployment
    /// problem, and discarding every due notification the moment one appears would throw away work that
    /// becomes deliverable again as soon as somebody fixes it. The bounded schedule still ends in a
    /// dead letter, so nothing retries forever.
    /// </remarks>
    private NotificationEmailTransportResult Refuse(
        NotificationEmailMessage message,
        ResendExchangeResult exchange)
    {
        switch (exchange.Failure)
        {
            case ResendFailureKind.Unauthorized:
                LogProviderFault(
                    logger,
                    message.OutboxItemId,
                    message.TenantId,
                    NotificationFailureCodes.EmailProviderUnauthorized,
                    null);
                return NotificationEmailTransportResult.TransientFailure(
                    NotificationFailureCodes.EmailProviderUnauthorized);

            case ResendFailureKind.Timeout when exchange.StatusCode is null:
            case ResendFailureKind.Unavailable when exchange.StatusCode is null:
                var unreachableCode = exchange.Failure == ResendFailureKind.Timeout
                    ? NotificationFailureCodes.EmailProviderTimeout
                    : NotificationFailureCodes.EmailProviderUnavailable;
                LogProviderUnreachable(logger, message.OutboxItemId, message.TenantId, unreachableCode, null);
                return NotificationEmailTransportResult.TransientFailure(unreachableCode);

            case ResendFailureKind.RateLimited:
                return Transient(message, exchange, NotificationFailureCodes.EmailProviderRateLimited);

            case ResendFailureKind.Timeout:
                return Transient(message, exchange, NotificationFailureCodes.EmailProviderTimeout);

            case ResendFailureKind.Unavailable:
                return Transient(message, exchange, NotificationFailureCodes.EmailProviderUnavailable);

            case ResendFailureKind.IdempotencyConflict:
                // The provider says this key was used for a different payload. The key binds the
                // immutable message and the exact mailbox, so an unchanged retry cannot resolve it.
                return Permanent(message, exchange, NotificationFailureCodes.EmailProviderIdempotencyConflict);

            case ResendFailureKind.ResponseInvalid:
                // A 2xx with no usable identifier is a permanent failure rather than a success.
                // Recording acceptance without the identifier the whole event model correlates on
                // would produce a delivery nothing can ever say anything more about, and inventing one
                // would be worse.
                return Permanent(message, exchange, NotificationFailureCodes.EmailProviderResponseInvalid);

            default:
                return Permanent(message, exchange, NotificationFailureCodes.EmailProviderRejected);
        }
    }

    private NotificationEmailTransportResult Transient(
        NotificationEmailMessage message,
        ResendExchangeResult exchange,
        string failureCode)
    {
        LogProviderRefused(
            logger,
            message.OutboxItemId,
            message.TenantId,
            exchange.StatusCode ?? 0,
            failureCode,
            null);
        return NotificationEmailTransportResult.TransientFailure(failureCode);
    }

    private NotificationEmailTransportResult Permanent(
        NotificationEmailMessage message,
        ResendExchangeResult exchange,
        string failureCode)
    {
        LogProviderRefused(
            logger,
            message.OutboxItemId,
            message.TenantId,
            exchange.StatusCode ?? 0,
            failureCode,
            null);
        return NotificationEmailTransportResult.PermanentFailure(failureCode);
    }
}
