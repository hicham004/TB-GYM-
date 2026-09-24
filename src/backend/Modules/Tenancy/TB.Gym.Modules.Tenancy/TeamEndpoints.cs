using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Tenancy;

public static class TeamEndpoints
{
    public static IEndpointRouteBuilder MapTeamEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var owner = endpoints
            .MapGroup("/api/team/members")
            .RequireAuthorization(AuthorizationPolicies.TenantOwner)
            .WithTags(TenancyModule.Name);

        owner.MapGet("/", async (
            ITeamApplicationService service,
            CancellationToken cancellationToken) =>
            Results.Ok(await service.ListMembersAsync(cancellationToken)))
            .WithName("ListTeamMembers")
            .Produces<TeamMemberSummary[]>();

        owner.MapPost("/{coachUserId:guid}/remove", async (
            Guid coachUserId,
            RemoveCoachRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ITeamApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            var result = await service.RemoveCoachAsync(coachUserId, request, cancellationToken);
            return result.Status switch
            {
                CoachRemovalStatus.Removed => Results.Ok(new CoachRemovalResponse(
                    result.ReassignedClientCount,
                    result.ReassignedInvitationCount)),
                CoachRemovalStatus.NotFound => Results.NotFound(),
                _ => Results.Conflict(new
                {
                    code = "concurrency_conflict",
                    message = "The team changed since this page loaded. Refresh and try again.",
                }),
            };
        })
        .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
        .WithName("RemoveTeamCoach")
        .Produces<CoachRemovalResponse>()
        .Produces(StatusCodes.Status404NotFound)
        .ProducesProblem(StatusCodes.Status409Conflict);

        // A coach leaves the team themselves (ADR 0027). Their access ends with this request.
        endpoints.MapPost("/api/team/me/resign", async (
            HttpContext context,
            IAntiforgery antiforgery,
            ITeamApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            var result = await service.ResignAsync(cancellationToken);
            return result.Status switch
            {
                CoachRemovalStatus.Removed => Results.Ok(new CoachRemovalResponse(
                    result.ReassignedClientCount,
                    result.ReassignedInvitationCount)),
                CoachRemovalStatus.NotFound => Results.NotFound(),
                _ => Results.Conflict(new
                {
                    code = "concurrency_conflict",
                    message = "Your clients changed while you were leaving. Try again.",
                }),
            };
        })
        .RequireAuthorization(AuthorizationPolicies.TenantCoach)
        .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
        .WithTags(TenancyModule.Name)
        .WithName("ResignFromTeam")
        .Produces<CoachRemovalResponse>()
        .Produces(StatusCodes.Status404NotFound)
        .ProducesProblem(StatusCodes.Status409Conflict);

        return endpoints;
    }
}
