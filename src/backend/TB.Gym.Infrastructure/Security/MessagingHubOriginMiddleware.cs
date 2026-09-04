using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using TB.Gym.Modules.Messaging;

namespace TB.Gym.Infrastructure.Security;

/// <summary>
/// Refuses a hub handshake that does not come from an explicitly allowed origin.
/// </summary>
/// <remarks>
/// A WebSocket handshake is not protected by the same-origin policy the way an XHR is. The browser
/// will happily open one to another site and attach the user's cookies to it, and the response is not
/// gated on a CORS header the way a fetch is — so without this check, any page the signed-in user
/// visits could open an authenticated socket as them and read their conversations. That is why the
/// <c>Origin</c> header is checked here, explicitly, on the hub path, in addition to whatever
/// negotiate and ordinary CORS behaviour would do.
/// <para>
/// The check is an allowlist of exact origins and there is deliberately no wildcard: a wildcard
/// origin with credentials is the configuration this exists to make impossible. A request with no
/// <c>Origin</c> at all is refused too whenever the list is configured — a browser always sends one
/// on a WebSocket handshake and on the negotiate POST, so a missing header is not a browser making a
/// same-origin request, and treating "absent" as "fine" would be an opt-out anybody could take.
/// </para>
/// <para>
/// An empty list is allowed only in Development, where the Angular dev server proxies <c>/hubs</c>;
/// outside Development the options validation refuses to start at all, so the empty case cannot reach
/// production. The refusal is a bare 403 with no body: which origins a deployment allows is not
/// something an unauthorized caller needs told.
/// </para>
/// </remarks>
internal sealed class MessagingHubOriginMiddleware(
    RequestDelegate next,
    IOptions<MessagingRealtimeOptions> options,
    ILogger<MessagingHubOriginMiddleware> logger)
{
    /// <summary>The origin is not logged: an attacker's chosen string is untrusted input.</summary>
    private static readonly Action<ILogger, Exception?> LogRefused =
        LoggerMessage.Define(
            LogLevel.Warning,
            new EventId(6220, "MessagingHubOriginRefused"),
            "A realtime hub handshake was refused because its origin is not allowed.");

    private readonly MessagingRealtimeOptions settings = options.Value;

    public async Task InvokeAsync(HttpContext context)
    {
        if (!context.Request.Path.StartsWithSegments("/hubs") || settings.AllowedOrigins.Count == 0)
        {
            await next(context);
            return;
        }

        if (!MessagingHubOrigin.IsAllowed(context.Request.Headers.Origin, settings.AllowedOrigins))
        {
            LogRefused(logger, null);
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return;
        }

        await next(context);
    }
}

public static class MessagingHubOriginMiddlewareExtensions
{
    /// <summary>
    /// Placed before authentication deliberately, so a disallowed origin is refused before a cookie
    /// is decoded and before any hub or endpoint sees the request.
    /// </summary>
    public static IApplicationBuilder UseTbGymMessagingHubOrigin(this IApplicationBuilder app) =>
        app.UseMiddleware<MessagingHubOriginMiddleware>();
}
