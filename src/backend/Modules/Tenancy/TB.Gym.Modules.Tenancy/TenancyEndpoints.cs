using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.RateLimiting;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Tenancy;

public static class TenancyEndpoints
{
    public static IEndpointRouteBuilder MapTenancyModule(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/auth/register/coach", async (
            RegisterCoachRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            IWorkspaceApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            var result = await service.RegisterCoachAsync(request, cancellationToken);
            return result.Status switch
            {
                WorkspaceRegistrationStatus.Created => Results.Accepted(
                    value: new CoachRegistrationResponse(
                        result.Email,
                        result.DevelopmentConfirmationUrl)),
                WorkspaceRegistrationStatus.EmailAlreadyRegistered => Results.Conflict(new
                {
                    code = "email_already_registered",
                    message = "An account already uses this email.",
                }),
                WorkspaceRegistrationStatus.Invalid => Results.ValidationProblem(
                    result.Errors ?? new Dictionary<string, string[]>()),
                _ => Results.Conflict(new
                {
                    code = "registration_conflict",
                    message = "The workspace could not be registered.",
                }),
            };
        })
        .AllowAnonymous()
        .RequireRateLimiting(RateLimitPolicies.PublicAuthentication)
        .WithName("RegisterCoach")
        .WithTags(TenancyModule.Name)
        .Produces<CoachRegistrationResponse>(StatusCodes.Status202Accepted)
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict);

        endpoints.MapGet("/api/tenants", async (
            ICurrentUser currentUser,
            ITenantMembershipStore store,
            CancellationToken cancellationToken) =>
        {
            if (currentUser.UserId is not { } userId)
            {
                return Results.Unauthorized();
            }

            var memberships = await store.ListForUserAsync(userId, cancellationToken);
            return Results.Ok(memberships);
        })
        .RequireAuthorization()
        .WithName("ListCurrentUserWorkspaces")
        .WithTags(TenancyModule.Name)
        .Produces<TenantMembershipSummary[]>();

        endpoints.MapGet("/api/workspace", async (
            IWorkspaceApplicationService service,
            CancellationToken cancellationToken) =>
        {
            var workspace = await service.GetCurrentAsync(cancellationToken);
            return workspace is null ? Results.NotFound() : Results.Ok(workspace);
        })
        .RequireAuthorization(AuthorizationPolicies.TenantMember)
        .WithName("GetCurrentWorkspace")
        .WithTags(TenancyModule.Name)
        .Produces<WorkspaceDetails>()
        .Produces(StatusCodes.Status404NotFound);

        endpoints.MapPut("/api/workspace", async (
            UpdateWorkspaceRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            IWorkspaceApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            var result = await service.UpdateCurrentAsync(request, cancellationToken);
            return result.Status switch
            {
                WorkspaceUpdateStatus.Updated => Results.Ok(result.Workspace),
                WorkspaceUpdateStatus.NotFound => Results.NotFound(),
                WorkspaceUpdateStatus.Invalid => Results.ValidationProblem(
                    result.Errors ?? new Dictionary<string, string[]>()),
                _ => Results.Conflict(new
                {
                    code = "concurrency_conflict",
                    message = "The workspace was changed by another request.",
                }),
            };
        })
        .RequireAuthorization(AuthorizationPolicies.TenantOwner)
        .WithName("UpdateCurrentWorkspace")
        .WithTags(TenancyModule.Name)
        .Produces<WorkspaceDetails>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict);

        return endpoints;
    }
}
