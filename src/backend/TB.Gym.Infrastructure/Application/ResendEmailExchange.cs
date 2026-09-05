using System.Buffers;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using TB.Gym.Modules.Notifications;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// One HTTP exchange with the transactional email provider, owned in one place.
/// </summary>
/// <remarks>
/// Extracted so that the two things this repository mails — tenant notifications and global action mail
/// — reach the same provider through the same request shape, the same bounded read, the same parser
/// limits and the same classification, without either of them owning a second copy of it. What the two
/// callers keep for themselves is the vocabulary: each maps the neutral
/// <see cref="ResendFailureKind"/> to its own module's stable failure codes, and each does its own
/// logging with its own identifiers, because a code that means two things in two places explains
/// neither.
/// <para>
/// The rules are unchanged from ADR 0022 and are the reason this is a shared function rather than a
/// shared base class: nothing sensitive escapes, the response is untrusted, and every failure is
/// classified rather than thrown. The API key, the recipient address, the rendered subject and body and
/// the provider's response body exist as locals for the duration of one call; the only exception that
/// leaves is the caller's own cancellation.
/// </para>
/// </remarks>
internal static class ResendEmailExchange
{
    /// <summary>The named client. One handler, one set of default headers, both transports.</summary>
    public const string HttpClientName = "notification-email-provider";

    /// <summary>
    /// The provider requires a user agent and answers 403 without one. Naming the application rather
    /// than a library is also what lets the provider's support tell one sender from another.
    /// </summary>
    public const string UserAgent = "TB.Gym-Notifications/1.0";

    /// <summary>
    /// The most of a provider response this adapter will read. Large enough for the documented success
    /// and error shapes, small enough that a misrouted endpoint streaming megabytes cannot become a
    /// memory problem inside a worker sweep.
    /// </summary>
    private const int MaximumResponseBytes = 8 * 1024;

    private static readonly JsonSerializerOptions RequestJson = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private static readonly JsonDocumentOptions ResponseJson = new() { MaxDepth = 8 };

    /// <summary>
    /// Sends one message and classifies the answer. Never throws for a provider outcome.
    /// </summary>
    /// <remarks>
    /// The caller's cancellation is rethrown, because host shutdown is not a delivery failure: the
    /// claim lease expires and the work becomes visible again. The adapter's own bounded timeout is a
    /// classification instead, and nothing about the request is in that path, so nothing about the
    /// recipient can leak through it.
    /// </remarks>
    public static async Task<ResendExchangeResult> SendAsync(
        IHttpClientFactory httpClientFactory,
        NotificationEmailProviderOptions provider,
        ResendEmailRequest message,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(provider.TimeoutSeconds));

        try
        {
            using var request = BuildRequest(message, provider);
            var client = httpClientFactory.CreateClient(HttpClientName);
            using var response = await client.SendAsync(
                request,
                HttpCompletionOption.ResponseHeadersRead,
                timeout.Token);

            if (!response.IsSuccessStatusCode)
            {
                return ResendExchangeResult.Refused(Classify(response.StatusCode), (int)response.StatusCode);
            }

            var body = await ReadBoundedAsync(response, timeout.Token);
            return body is not null && TryReadMessageId(body, out var providerMessageId)
                ? ResendExchangeResult.Accepted(providerMessageId, (int)response.StatusCode)
                : ResendExchangeResult.Refused(ResendFailureKind.ResponseInvalid, (int)response.StatusCode);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (OperationCanceledException)
        {
            return ResendExchangeResult.Refused(ResendFailureKind.Timeout, null);
        }
        catch (HttpRequestException)
        {
            // Deliberately swallowed rather than attached to a log. A connection exception can carry
            // the resolved host, the URI and, through inner socket errors, details of the outbound
            // request; the stable classification is what an operator needs and all they get.
            return ResendExchangeResult.Refused(ResendFailureKind.Unavailable, null);
        }
    }

    private static HttpRequestMessage BuildRequest(
        ResendEmailRequest message,
        NotificationEmailProviderOptions provider)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, provider.Endpoint)
        {
            Content = JsonContent.Create(
                new ResendSendRequest(
                    provider.FromAddress,
                    [message.RecipientAddress],
                    message.Subject,
                    message.TextBody),
                options: RequestJson),
        };

        // Set per request rather than as a default header on the shared client, so the credential
        // lives on one message that is disposed with it.
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", provider.ApiKey);
        request.Headers.Add("Idempotency-Key", message.IdempotencyKey);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        return request;
    }

    /// <summary>
    /// Turns a refusal into a neutral classification the callers map to their own codes.
    /// </summary>
    /// <remarks>
    /// The provider's own error body is deliberately not read, not parsed and not logged. It quotes the
    /// request — including the recipient address — and classification does not need it: the status code
    /// carries everything a dispatcher must decide, which is whether waiting could help.
    /// </remarks>
    private static ResendFailureKind Classify(HttpStatusCode status) => status switch
    {
        HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden => ResendFailureKind.Unauthorized,
        HttpStatusCode.TooManyRequests => ResendFailureKind.RateLimited,
        HttpStatusCode.RequestTimeout => ResendFailureKind.Timeout,
        HttpStatusCode.Conflict => ResendFailureKind.IdempotencyConflict,
        _ => (int)status >= 500 ? ResendFailureKind.Unavailable : ResendFailureKind.Rejected,
    };

    /// <summary>
    /// Reads at most <see cref="MaximumResponseBytes"/>, or gives up.
    /// </summary>
    /// <remarks>
    /// The declared content length is checked first and then ignored, because a hostile or
    /// misconfigured endpoint controls it. Returning null rather than a truncated buffer keeps a
    /// truncated document from being parsed into something that looks like an identifier.
    /// </remarks>
    private static async Task<byte[]?> ReadBoundedAsync(
        HttpResponseMessage response,
        CancellationToken cancellationToken)
    {
        if (response.Content.Headers.ContentLength is { } declared && declared > MaximumResponseBytes)
        {
            return null;
        }

        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        var rented = ArrayPool<byte>.Shared.Rent(MaximumResponseBytes + 1);
        try
        {
            var total = 0;
            while (total <= MaximumResponseBytes)
            {
                var read = await stream.ReadAsync(
                    rented.AsMemory(total, rented.Length - total),
                    cancellationToken);
                if (read == 0)
                {
                    return rented[..total];
                }

                total += read;
            }

            return null;
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(rented);
        }
    }

    private static bool TryReadMessageId(byte[] body, out string providerMessageId)
    {
        providerMessageId = string.Empty;
        if (body.Length == 0)
        {
            return false;
        }

        try
        {
            using var document = JsonDocument.Parse(body, ResponseJson);
            if (document.RootElement.ValueKind != JsonValueKind.Object ||
                !document.RootElement.TryGetProperty("id", out var id) ||
                id.ValueKind != JsonValueKind.String)
            {
                return false;
            }

            var candidate = id.GetString();
            if (!NotificationProviderMessageId.IsValid(candidate))
            {
                return false;
            }

            providerMessageId = candidate!;
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    /// <summary>
    /// The provider's own request shape, owned here and nowhere else.
    /// </summary>
    /// <remarks>
    /// Kept to the four fields this repository actually sends. There is no <c>html</c>, no
    /// <c>tags</c>, no tracking and no attachment: a field that is never set cannot later carry
    /// something that should not leave the building.
    /// </remarks>
    private sealed record ResendSendRequest(
        [property: JsonPropertyName("from")] string From,
        [property: JsonPropertyName("to")] IReadOnlyList<string> To,
        [property: JsonPropertyName("subject")] string Subject,
        [property: JsonPropertyName("text")] string Text);
}

/// <summary>One outbound message, in memory only.</summary>
internal sealed record ResendEmailRequest(
    string IdempotencyKey,
    string RecipientAddress,
    string Subject,
    string TextBody);

/// <summary>What the exchange established, with no module's vocabulary in it.</summary>
internal sealed record ResendExchangeResult(
    bool IsAccepted,
    string? ProviderMessageId,
    ResendFailureKind? Failure,
    int? StatusCode)
{
    public static ResendExchangeResult Accepted(string providerMessageId, int statusCode) =>
        new(true, providerMessageId, null, statusCode);

    public static ResendExchangeResult Refused(ResendFailureKind failure, int? statusCode) =>
        new(false, null, failure, statusCode);
}

/// <summary>
/// The neutral classification of a provider refusal.
/// </summary>
/// <remarks>
/// Deliberately without a "transient" or "permanent" flag. Whether waiting could help is a policy
/// decision each caller makes with its own retry schedule and its own operational codes, and burying
/// it here would make it invisible to both of them.
/// </remarks>
internal enum ResendFailureKind
{
    /// <summary>The provider refused this deployment's credentials or sending identity.</summary>
    Unauthorized = 1,

    /// <summary>This sender is over its rate limit.</summary>
    RateLimited = 2,

    /// <summary>The provider did not answer inside the adapter's bounded timeout.</summary>
    Timeout = 3,

    /// <summary>The provider could not be reached, or answered with a server error.</summary>
    Unavailable = 4,

    /// <summary>This idempotency key was already used for a different request.</summary>
    IdempotencyConflict = 5,

    /// <summary>The request itself was rejected.</summary>
    Rejected = 6,

    /// <summary>A success with a body this build cannot use — no identifier, or one that fails validation.</summary>
    ResponseInvalid = 7,
}
