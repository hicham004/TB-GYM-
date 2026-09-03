using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Messaging;

public static class MessagingEndpoints
{
    public static IEndpointRouteBuilder MapMessagingModule(this IEndpointRouteBuilder endpoints)
    {
        MapConversations(endpoints);
        MapMessages(endpoints);
        return endpoints;
    }

    /// <summary>
    /// The caller's own conversations. Every route sits behind the tenant-member policy, which
    /// reverifies active membership of the workspace named in the request; the application service
    /// then narrows to conversations the caller is an explicit participant of and evaluates Messaging
    /// access per conversation. Membership is necessary and never sufficient.
    /// </summary>
    private static void MapConversations(IEndpointRouteBuilder endpoints)
    {
        var conversations = endpoints.MapGroup("/api/messaging/conversations")
            .RequireAuthorization(AuthorizationPolicies.TenantMember)
            .WithTags(MessagingModule.Name);

        conversations.MapGet("", async (
            DateTimeOffset? beforeActivityAtUtc,
            Guid? beforeConversationId,
            int? take,
            IMessagingApplicationService service,
            CancellationToken token) =>
        {
            // Both halves of a keyset cursor or neither. One without the other cannot identify a
            // position, and guessing the missing half is how a page silently repeats or skips rows.
            if (beforeActivityAtUtc is null != (beforeConversationId is null))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["beforeConversationId"] =
                        ["Provide both beforeActivityAtUtc and beforeConversationId, or neither."],
                });
            }

            return Results.Ok(await service.ListConversationsAsync(
                beforeActivityAtUtc,
                beforeConversationId,
                MessagingPaging.NormalizeConversationTake(take),
                token));
        })
        .WithName("ListOwnConversations")
        .Produces<ConversationPage>()
        .ProducesValidationProblem();

        // Coach-only by policy. A client cannot start a conversation, choose workspace staff, or
        // learn who the workspace employs; they reply once an authorized coach has opened one.
        conversations.MapPost("", async (
            CreateDirectConversationRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            IMessagingApplicationService service,
            CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToConversationResult(await service.CreateDirectConversationAsync(request, token));
        })
        .RequireAuthorization(AuthorizationPolicies.TenantCoach)
        .WithName("CreateDirectConversation")
        .Produces<ConversationDetail>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status403Forbidden)
        .ProducesProblem(StatusCodes.Status404NotFound)
        .ProducesProblem(StatusCodes.Status409Conflict)
        .RequireRateLimiting(RateLimitPolicies.SensitiveWrite);

        endpoints.MapGet("/api/messaging/unread-count", async (
            IMessagingApplicationService service,
            CancellationToken token) =>
            Results.Ok(await service.CountUnreadAsync(token)))
        .RequireAuthorization(AuthorizationPolicies.TenantMember)
        .WithTags(MessagingModule.Name)
        .WithName("GetOwnMessagingUnreadCount")
        .Produces<MessagingUnreadCount>();
    }

    private static void MapMessages(IEndpointRouteBuilder endpoints)
    {
        var messages = endpoints.MapGroup("/api/messaging/conversations/{conversationId:guid}")
            .RequireAuthorization(AuthorizationPolicies.TenantMember)
            .WithTags(MessagingModule.Name);

        messages.MapGet("/messages", async (
            Guid conversationId,
            long? beforeSequence,
            int? take,
            IMessagingApplicationService service,
            CancellationToken token) =>
            ToPageResult(await service.ListMessagesAsync(
                conversationId,
                beforeSequence,
                MessagingPaging.NormalizeMessageTake(take),
                token)))
        .WithName("ListConversationMessages")
        .Produces<MessagePage>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status403Forbidden)
        .ProducesProblem(StatusCodes.Status404NotFound);

        messages.MapPost("/messages", async (
            Guid conversationId,
            SendMessageRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            IMessagingApplicationService service,
            CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToMessageResult(await service.SendAsync(conversationId, request, token));
        })
        .WithName("SendConversationMessage")
        .Produces<MessageView>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status403Forbidden)
        .ProducesProblem(StatusCodes.Status404NotFound)
        .ProducesProblem(StatusCodes.Status409Conflict)
        .RequireRateLimiting(RateLimitPolicies.SensitiveWrite);

        messages.MapPost("/messages/{messageId:guid}/edit", async (
            Guid conversationId,
            Guid messageId,
            EditMessageRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            IMessagingApplicationService service,
            CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToMessageResult(await service.EditAsync(conversationId, messageId, request, token));
        })
        .WithName("EditConversationMessage")
        .Produces<MessageView>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status403Forbidden)
        .ProducesProblem(StatusCodes.Status404NotFound)
        .ProducesProblem(StatusCodes.Status409Conflict)
        .RequireRateLimiting(RateLimitPolicies.SensitiveWrite);

        messages.MapPost("/messages/{messageId:guid}/delete", async (
            Guid conversationId,
            Guid messageId,
            DeleteMessageRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            IMessagingApplicationService service,
            CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToMessageResult(await service.DeleteAsync(conversationId, messageId, request, token));
        })
        .WithName("DeleteOwnConversationMessage")
        .Produces<MessageView>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status403Forbidden)
        .ProducesProblem(StatusCodes.Status404NotFound)
        .ProducesProblem(StatusCodes.Status409Conflict)
        .RequireRateLimiting(RateLimitPolicies.SensitiveWrite);

        messages.MapPost("/messages/{messageId:guid}/moderate", async (
            Guid conversationId,
            Guid messageId,
            ModerateMessageRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            IMessagingApplicationService service,
            CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToMessageResult(await service.ModerateAsync(conversationId, messageId, request, token));
        })
        .WithName("ModerateConversationMessage")
        .Produces<MessageView>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status403Forbidden)
        .ProducesProblem(StatusCodes.Status404NotFound)
        .ProducesProblem(StatusCodes.Status409Conflict)
        .RequireRateLimiting(RateLimitPolicies.SensitiveWrite);

        messages.MapPost("/read", async (
            Guid conversationId,
            AdvanceReadCursorRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            IMessagingApplicationService service,
            CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToReadStateResult(await service.AdvanceReadCursorAsync(conversationId, request, token));
        })
        .WithName("AdvanceOwnConversationReadCursor")
        .Produces<ConversationReadState>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status403Forbidden)
        .ProducesProblem(StatusCodes.Status404NotFound)
        .RequireRateLimiting(RateLimitPolicies.SensitiveWrite);
    }

    private static IResult ToConversationResult(ConversationCommandResult result) => result.Status switch
    {
        MessagingCommandStatus.Success => Results.Ok(result.Conversation),
        MessagingCommandStatus.NotFound => Results.NotFound(),
        MessagingCommandStatus.Invalid => Validation(result.Field, result.Message),
        MessagingCommandStatus.Conflict => Conflict(result.Code, result.Message),
        MessagingCommandStatus.Forbidden => Denied(result.AccessReason),
        _ => Results.Problem(statusCode: StatusCodes.Status500InternalServerError),
    };

    private static IResult ToMessageResult(MessageCommandResult result) => result.Status switch
    {
        MessagingCommandStatus.Success => Results.Ok(result.Message),
        MessagingCommandStatus.NotFound => Results.NotFound(),
        MessagingCommandStatus.Invalid => Validation(result.Field, result.Detail),
        MessagingCommandStatus.Conflict => Conflict(result.Code, result.Detail),
        MessagingCommandStatus.Forbidden => Denied(result.AccessReason),
        _ => Results.Problem(statusCode: StatusCodes.Status500InternalServerError),
    };

    private static IResult ToPageResult(MessagePageResult result) => result.Status switch
    {
        MessagingCommandStatus.Success => Results.Ok(result.Page),
        MessagingCommandStatus.NotFound => Results.NotFound(),
        MessagingCommandStatus.Invalid => Validation(result.Field, result.Detail),
        MessagingCommandStatus.Forbidden => Denied(result.AccessReason),
        _ => Results.Problem(statusCode: StatusCodes.Status500InternalServerError),
    };

    private static IResult ToReadStateResult(ReadStateCommandResult result) => result.Status switch
    {
        MessagingCommandStatus.Success => Results.Ok(result.ReadState),
        MessagingCommandStatus.NotFound => Results.NotFound(),
        MessagingCommandStatus.Invalid => Validation(result.Field, result.Detail),
        MessagingCommandStatus.Forbidden => Denied(result.AccessReason),
        _ => Results.Problem(statusCode: StatusCodes.Status500InternalServerError),
    };

    private static IResult Validation(string? field, string? message) =>
        Results.ValidationProblem(new Dictionary<string, string[]>
        {
            [field ?? "request"] = [message ?? "The request is not valid."],
        });

    private static IResult Conflict(string? code, string? message) =>
        Results.Problem(
            statusCode: StatusCodes.Status409Conflict,
            title: message ?? "The message conflicts with current state.",
            extensions: code is null
                ? null
                : new Dictionary<string, object?> { ["code"] = code });

    /// <summary>
    /// A denied conversation carries the stable feature-access reason and no content, so a screen can
    /// explain the refusal in the audience's own words instead of rendering an empty thread. An
    /// unknown conversation, another workspace's conversation and a same-workspace non-participant are
    /// all 404 instead, because telling them apart would confirm that a given identifier exists.
    /// </summary>
    private static IResult Denied(FeatureAccessReason? reason) =>
        reason is null
            ? Results.Forbid()
            : Results.Problem(
                statusCode: StatusCodes.Status403Forbidden,
                title: "Messaging is not available for this conversation.",
                extensions: new Dictionary<string, object?> { ["accessReason"] = reason.ToString() });
}
