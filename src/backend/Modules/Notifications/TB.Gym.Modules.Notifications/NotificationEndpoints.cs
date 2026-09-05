using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Notifications;

public static class NotificationEndpoints
{
    public static IEndpointRouteBuilder MapNotificationsModule(this IEndpointRouteBuilder endpoints)
    {
        MapInbox(endpoints);
        MapPreferences(endpoints);
        MapDeadLetters(endpoints);
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
