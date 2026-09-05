using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Options;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Notifications;

public static class NotificationEndpoints
{
    public static IEndpointRouteBuilder MapNotificationsModule(this IEndpointRouteBuilder endpoints)
    {
        MapInbox(endpoints);
        MapPreferences(endpoints);
        MapDeadLetters(endpoints);
        MapProviderEvents(endpoints);
        return endpoints;
    }

    /// <summary>
    /// The caller's own notification settings, in the active workspace.
    /// </summary>
    /// <remarks>
    /// Behind the tenant-member policy, which reverifies active membership of the workspace named in
    /// the request on every call, with antiforgery on the write and the sensitive-write rate limit.
    /// The subject is taken from the authentication cookie and never from the route or the body, so
    /// there is deliberately no shape in which one member changes another member's settings — a coach
    /// or an owner cannot opt somebody into email.
    /// </remarks>
    private static void MapPreferences(IEndpointRouteBuilder endpoints)
    {
        var preferences = endpoints.MapGroup("/api/notifications/preferences")
            .RequireAuthorization(AuthorizationPolicies.TenantMember)
            .WithTags(NotificationsModule.Name);

        preferences.MapGet("", async (
            INotificationPreferenceService service,
            CancellationToken token) =>
        {
            var view = await service.GetOwnAsync(token);
            return view is null ? Results.NotFound() : Results.Ok(view);
        })
        .WithName("GetOwnNotificationPreferences")
        .Produces<NotificationPreferenceView>()
        .ProducesProblem(StatusCodes.Status404NotFound);

        preferences.MapPut("", async (
            UpdateNotificationPreferenceRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            INotificationPreferenceService service,
            CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.UpdateOwnAsync(request, token));
        })
        .WithName("UpdateOwnNotificationPreferences")
        .Produces<NotificationPreferenceView>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status404NotFound)
        .ProducesProblem(StatusCodes.Status409Conflict)
        .RequireRateLimiting(RateLimitPolicies.SensitiveWrite);
    }

    /// <summary>
    /// The caller's own inbox. Every route is behind the tenant-member policy, which reverifies
    /// active membership of the workspace named in the request on every call, and the application
    /// service then narrows to the signed-in recipient. A member of the workspace is not thereby a
    /// reader of another member's notifications.
    /// </summary>
    private static void MapInbox(IEndpointRouteBuilder endpoints)
    {
        var inbox = endpoints.MapGroup("/api/notifications")
            .RequireAuthorization(AuthorizationPolicies.TenantMember)
            .WithTags(NotificationsModule.Name);

        inbox.MapGet("", async (
            int? skip,
            int? take,
            INotificationApplicationService service,
            CancellationToken token) =>
            Results.Ok(await service.ListOwnAsync(
                NotificationPaging.NormalizeSkip(skip),
                NotificationPaging.NormalizeTake(take),
                token)))
        .WithName("ListOwnNotifications")
        .Produces<NotificationPage>();

        inbox.MapGet("/unread-count", async (
            INotificationApplicationService service,
            CancellationToken token) =>
            Results.Ok(await service.CountOwnUnreadAsync(token)))
        .WithName("GetOwnUnreadNotificationCount")
        .Produces<NotificationUnreadCount>();

        inbox.MapPost("/{notificationId:guid}/read", async (
            Guid notificationId,
            HttpContext context,
            IAntiforgery antiforgery,
            INotificationApplicationService service,
            CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.MarkOwnReadAsync(notificationId, token));
        })
        .WithName("MarkOwnNotificationRead")
        .Produces<NotificationView>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status404NotFound)
        .RequireRateLimiting(RateLimitPolicies.SensitiveWrite);
    }

    /// <summary>
    /// Owner-only operational visibility of intents the dispatcher gave up on. Bounded, paginated,
    /// and carrying nothing about the recipient or the content. There is no manual replay in this
    /// slice: replay is a write against somebody else's inbox and needs its own decision.
    /// </summary>
    private static void MapDeadLetters(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/workspace/notification-dead-letters", async (
            int? skip,
            int? take,
            INotificationApplicationService service,
            CancellationToken token) =>
            Results.Ok(await service.ListDeadLettersAsync(
                NotificationPaging.NormalizeSkip(skip),
                NotificationPaging.NormalizeTake(take),
                token)))
        .RequireAuthorization(AuthorizationPolicies.TenantOwner)
        .WithTags(NotificationsModule.Name)
        .WithName("ListWorkspaceNotificationDeadLetters")
        .Produces<NotificationDeadLetterPage>();
    }

    /// <summary>
    /// The one public, provider-authenticated route in the Notifications module.
    /// </summary>
    /// <remarks>
    /// Everything else here is behind a cookie, a workspace and an antiforgery token. This is not,
    /// and cannot be: the caller is a provider's servers, which hold no session, send no cookie and
    /// have no way to obtain an antiforgery token. Its authentication is a signature over the exact
    /// request body, which is strictly stronger than a cookie for this purpose — a cookie would
    /// prove only that a browser had one, while the signature proves the body came from whoever holds
    /// the signing secret and has not been altered by a byte.
    /// <para>
    /// Antiforgery is therefore deliberately disabled rather than forgotten. Cross-site request
    /// forgery is an attack that rides an ambient credential, and this endpoint has none to ride: an
    /// unsigned request from anywhere, including a victim's browser, is refused before the body is
    /// parsed.
    /// </para>
    /// <para>
    /// The order inside the handler is the security property. The body is bounded before it is read,
    /// verified before it is parsed, and parsed before anything is resolved or written. A caller
    /// without a valid signature therefore reaches no parser, no query and no row, and learns nothing
    /// from the response beyond the fact that it was refused.
    /// </para>
    /// <para>
    /// It is still rate limited by source address. A signature check is cheap but not free, and an
    /// endpoint whose only cost control is cryptography is an endpoint anybody can make expensive.
    /// </para>
    /// </remarks>
    private static void MapProviderEvents(IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/notifications/email/provider-events", async (
            HttpContext context,
            IOptions<NotificationEmailOptions> emailOptions,
            INotificationProviderEventIngestion ingestion,
            CancellationToken token) =>
        {
            var email = emailOptions.Value;
            if (!email.UsesProviderAdapter)
            {
                // A deployment with no provider has no provider events. Answering as though the route
                // did not exist keeps a scan from learning which deployments send real mail.
                return Results.NotFound();
            }

            var limit = email.Provider.MaximumWebhookBodyBytes;
            var body = await ReadBoundedBodyAsync(context.Request, limit, token);
            if (body is null)
            {
                return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
            }

            var result = await ingestion.IngestAsync(
                new NotificationProviderEventRequest(
                    Header(context, NotificationWebhookSignature.IdHeader),
                    Header(context, NotificationWebhookSignature.TimestampHeader),
                    Header(context, NotificationWebhookSignature.SignatureHeader),
                    body),
                token);

            return result.Status switch
            {
                // Recorded, already recorded, deliberately not recorded, and about a message this
                // deployment never issued are one answer. Distinguishing them would tell an
                // unauthenticated observer which identifiers exist, and would make a provider retry
                // an event nothing can ever do anything with.
                NotificationProviderEventIngestionStatus.Recorded or
                NotificationProviderEventIngestionStatus.Duplicate or
                NotificationProviderEventIngestionStatus.Ignored or
                NotificationProviderEventIngestionStatus.UnknownMessage =>
                    Results.Accepted(),
                NotificationProviderEventIngestionStatus.PayloadTooLarge =>
                    Results.StatusCode(StatusCodes.Status413PayloadTooLarge),
                NotificationProviderEventIngestionStatus.Malformed => Results.BadRequest(),
                NotificationProviderEventIngestionStatus.Unavailable => Results.NotFound(),
                _ => Results.Unauthorized(),
            };
        })
        .AllowAnonymous()
        .DisableAntiforgery()
        .WithTags(NotificationsModule.Name)
        .WithName("IngestNotificationEmailProviderEvents")
        .ExcludeFromDescription()
        .RequireRateLimiting(RateLimitPolicies.ProviderWebhook);
    }

    /// <summary>
    /// Reads at most <paramref name="limit"/> bytes, or gives up.
    /// </summary>
    /// <remarks>
    /// Returns null rather than a truncated body, because a truncated body would fail signature
    /// verification and be reported as a forgery rather than as the size problem it is. The declared
    /// content length is checked first as a cheap rejection and then ignored: a caller controls it,
    /// so the running total is what actually enforces the bound.
    /// </remarks>
    private static async Task<byte[]?> ReadBoundedBodyAsync(HttpRequest request, int limit, CancellationToken token)
    {
        if (request.ContentLength is { } declared && declared > limit)
        {
            return null;
        }

        using var buffer = new MemoryStream();
        var chunk = new byte[8 * 1024];
        var total = 0;
        int read;
        while ((read = await request.Body.ReadAsync(chunk, token)) > 0)
        {
            total += read;
            if (total > limit)
            {
                return null;
            }

            buffer.Write(chunk, 0, read);
        }

        return buffer.ToArray();
    }

    /// <summary>
    /// One header value, or null. Deliberately refuses a repeated header rather than concatenating or
    /// taking the first: a request carrying two signatures is not a request this endpoint understands,
    /// and picking one of them is how header-smuggling bugs start.
    /// </summary>
    private static string? Header(HttpContext context, string name) =>
        context.Request.Headers.TryGetValue(name, out var values) && values.Count == 1
            ? values[0]
            : null;

    private static IResult ToResult(NotificationCommandResult result) => result.Status switch
    {
        NotificationCommandStatus.Success => Results.Ok(result.Notification),
        // A notification belonging to another workspace, another recipient, or nothing at all are
        // one answer. Distinguishing them would confirm that a given identifier exists.
        NotificationCommandStatus.NotFound => Results.NotFound(),
        NotificationCommandStatus.Invalid => Results.ValidationProblem(new Dictionary<string, string[]>
        {
            [result.Field ?? "notification"] = [result.Message ?? "The request is not valid."],
        }),
        _ => Results.Problem(statusCode: StatusCodes.Status500InternalServerError),
    };

    /// <summary>
    /// Sanitized throughout. A validation message names a field and states a rule; it never echoes an
    /// address, a token, a notification's wording or anything from a payload.
    /// </summary>
    private static IResult ToResult(NotificationPreferenceCommandResult result) => result.Status switch
    {
        NotificationPreferenceCommandStatus.Success => Results.Ok(result.Preference),
        NotificationPreferenceCommandStatus.NotFound => Results.NotFound(),
        NotificationPreferenceCommandStatus.Conflict => Results.Problem(
            statusCode: StatusCodes.Status409Conflict,
            title: result.Message ?? "Your notification settings were changed by another request.",
            extensions: result.Field is null
                ? null
                : new Dictionary<string, object?> { ["code"] = result.Field }),
        NotificationPreferenceCommandStatus.Invalid => Results.ValidationProblem(new Dictionary<string, string[]>
        {
            [result.Field ?? "preferences"] = [result.Message ?? "The request is not valid."],
        }),
        _ => Results.Problem(statusCode: StatusCodes.Status500InternalServerError),
    };
}
