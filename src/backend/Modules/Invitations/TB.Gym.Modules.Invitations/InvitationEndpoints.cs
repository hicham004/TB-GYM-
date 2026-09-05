using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.RateLimiting;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Invitations;

public static class InvitationEndpoints
{
    public static IEndpointRouteBuilder MapInvitationsModule(this IEndpointRouteBuilder endpoints)
    {
        var coachGroup = endpoints
            .MapGroup("/api/invitations")
            .RequireAuthorization(AuthorizationPolicies.TenantCoach)
            .WithTags(InvitationsModule.Name);

        coachGroup.MapGet("/", async (
            IInvitationApplicationService service,
            CancellationToken cancellationToken) =>
            Results.Ok(await service.ListAsync(cancellationToken)))
            .WithName("ListClientInvitations")
            .Produces<InvitationSummary[]>();

        coachGroup.MapPost("/", async (
            CreateClientInvitationRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            IInvitationApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToCommandResult(await service.CreateAsync(request, cancellationToken), created: true);
        })
        .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
        .WithName("CreateClientInvitation")
        .Produces<InvitationSummary>(StatusCodes.Status201Created)
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict);

        // A deliberate resend takes a body, unlike the Phase 1 endpoint it replaces, and both fields
        // are required for a reason this phase created. The idempotency key makes two concurrent
        // presses converge on one new logical-send generation; the version makes a press issued against
        // a stale view conflict instead of revoking a link the presser did not know existed.
        coachGroup.MapPost("/{invitationId:guid}/resend", async (
            Guid invitationId,
            ResendClientInvitationRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            IInvitationApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToCommandResult(await service.ResendAsync(invitationId, request, cancellationToken));
        })
        .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
        .WithName("ResendClientInvitation")
        .Produces<InvitationSummary>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict);

        coachGroup.MapPost("/{invitationId:guid}/revoke", async (
            Guid invitationId,
            RevokeClientInvitationRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            IInvitationApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToCommandResult(await service.RevokeAsync(invitationId, request, cancellationToken));
        })
        .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
        .WithName("RevokeClientInvitation")
        .Produces<InvitationSummary>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict);

        endpoints.MapGet("/api/invitations/public/{token}", async (
            string token,
            IInvitationApplicationService service,
            CancellationToken cancellationToken) =>
        {
            var invitation = await service.GetPublicAsync(token, cancellationToken);
            return invitation is null ? Results.NotFound() : Results.Ok(invitation);
        })
        .AllowAnonymous()
        .RequireRateLimiting(RateLimitPolicies.PublicAuthentication)
        .WithName("GetPublicClientInvitation")
        .WithTags(InvitationsModule.Name)
        .Produces<PublicInvitationDetails>()
        .Produces(StatusCodes.Status404NotFound);

        endpoints.MapPost("/api/invitations/accept", async (
            AcceptClientInvitationRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            IInvitationApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            var result = await service.AcceptAsync(request, cancellationToken);
            return result.Status switch
            {
                InvitationAcceptanceStatus.Accepted => Results.Ok(
                    new InvitationAcceptanceResponse(
                        result.TenantId!.Value,
                        result.ClientProfileId!.Value,
                        result.SignedIn)),
                InvitationAcceptanceStatus.ExistingAccountSignInRequired => Results.Conflict(new
                {
                    code = "existing_account_sign_in_required",
                    message = "Sign in with the invited email before accepting this invitation.",
                }),
                InvitationAcceptanceStatus.WrongSignedInAccount => Results.Json(
                    new
                    {
                        code = "wrong_signed_in_account",
                        message = "This invitation belongs to a different account.",
                    },
                    statusCode: StatusCodes.Status403Forbidden),
                InvitationAcceptanceStatus.Revoked => Results.Json(
                    new { code = "invitation_revoked", message = "This invitation was revoked." },
                    statusCode: StatusCodes.Status410Gone),
                InvitationAcceptanceStatus.InvalidOrExpired => Results.Json(
                    new { code = "invitation_invalid_or_expired", message = "This invitation is invalid or expired." },
                    statusCode: StatusCodes.Status410Gone),
                InvitationAcceptanceStatus.Invalid => Results.ValidationProblem(
                    result.Errors ?? new Dictionary<string, string[]>()),
                _ => Results.Conflict(new
                {
                    code = "invitation_conflict",
                    message = "The invitation could not be accepted because related data changed.",
                }),
            };
        })
        .AllowAnonymous()
        .RequireRateLimiting(RateLimitPolicies.PublicAuthentication)
        .WithName("AcceptClientInvitation")
        .WithTags(InvitationsModule.Name)
        .Produces<InvitationAcceptanceResponse>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict)
        .ProducesProblem(StatusCodes.Status410Gone);

        return endpoints;
    }

    private static IResult ToCommandResult(InvitationCommandResult result, bool created = false) =>
        result.Status switch
        {
            InvitationCommandStatus.Success when created => Results.Created(
                $"/api/invitations/{result.Invitation?.Id}",
                result.Invitation),
            InvitationCommandStatus.Success => Results.Ok(result.Invitation),
            InvitationCommandStatus.NotFound => Results.NotFound(),
            InvitationCommandStatus.Invalid => Results.ValidationProblem(
                result.Errors ?? new Dictionary<string, string[]>()),
            _ => Results.Conflict(new
            {
                code = "invitation_conflict",
                message = "An active invitation or client relationship already exists for this email.",
            }),
        };
}
