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
        MapDeadLetters(endpoints);
        return endpoints;
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
}
