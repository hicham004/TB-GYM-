using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Clients;

public static class ClientEndpoints
{
    public static IEndpointRouteBuilder MapClientsModule(this IEndpointRouteBuilder endpoints)
    {
        var coachGroup = endpoints
            .MapGroup("/api/clients")
            .RequireAuthorization(AuthorizationPolicies.TenantCoach)
            .WithTags(ClientsModule.Name);

        coachGroup.MapGet("/", async (
            IClientProfileApplicationService service,
            CancellationToken cancellationToken) =>
            Results.Ok(await service.ListAsync(cancellationToken)))
            .WithName("ListClients")
            .Produces<ClientSummary[]>();

        coachGroup.MapGet("/{clientId:guid}", async (
            Guid clientId,
            IClientProfileApplicationService service,
            CancellationToken cancellationToken) =>
        {
            var client = await service.GetForCoachAsync(clientId, cancellationToken);
            return client is null ? Results.NotFound() : Results.Ok(client);
        })
        .WithName("GetClientForCoach")
        .Produces<CoachClientDetails>()
        .Produces(StatusCodes.Status404NotFound);

        coachGroup.MapPut("/{clientId:guid}/intake", async (
            Guid clientId,
            UpdateClientIntakeRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            IClientProfileApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.UpdateForCoachAsync(clientId, request, cancellationToken));
        })
        .WithName("UpdateClientIntakeForCoach")
        .Produces<CoachClientDetails>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict);

        coachGroup.MapPost("/{clientId:guid}/complete-onboarding", async (
            Guid clientId,
            CompleteClientOnboardingRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            IClientProfileApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.CompleteForCoachAsync(clientId, request, cancellationToken));
        })
        .WithName("CompleteClientOnboardingForCoach")
        .Produces<CoachClientDetails>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict);

        coachGroup.MapPut("/{clientId:guid}/coach-notes", async (
            Guid clientId,
            UpdateCoachNotesRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            IClientProfileApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.UpdateCoachNotesAsync(clientId, request, cancellationToken));
        })
        .WithName("UpdateClientCoachNotes")
        .Produces<CoachClientDetails>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict);

        coachGroup.MapPost("/{clientId:guid}/relationship/block", async (
            Guid clientId,
            ChangeClientRelationshipRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            IClientProfileApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.BlockRelationshipAsync(clientId, request, cancellationToken));
        })
        .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
        .WithName("BlockClientRelationship")
        .Produces<CoachClientDetails>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict);

        coachGroup.MapPost("/{clientId:guid}/relationship/unblock", async (
            Guid clientId,
            ChangeClientRelationshipRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            IClientProfileApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.UnblockRelationshipAsync(clientId, request, cancellationToken));
        })
        .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
        .WithName("UnblockClientRelationship")
        .Produces<CoachClientDetails>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict);

        // Only the owner moves clients between coaches; a coach cannot give a client away or take one.
        coachGroup.MapPost("/{clientId:guid}/coach", async (
            Guid clientId,
            ReassignClientCoachRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            IClientProfileApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.ReassignCoachAsync(clientId, request, cancellationToken));
        })
        .RequireAuthorization(AuthorizationPolicies.TenantOwner)
        .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
        .WithName("ReassignClientCoach")
        .Produces<CoachClientDetails>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict);

        coachGroup.MapGet("/{clientId:guid}/coach-assignments", async (
            Guid clientId,
            IClientProfileApplicationService service,
            CancellationToken cancellationToken) =>
        {
            var history = await service.ListCoachAssignmentsAsync(clientId, cancellationToken);
            return history is null ? Results.NotFound() : Results.Ok(history);
        })
        .RequireAuthorization(AuthorizationPolicies.TenantOwner)
        .WithName("ListClientCoachAssignments")
        .Produces<ClientCoachAssignmentView[]>()
        .Produces(StatusCodes.Status404NotFound);

        var selfGroup = endpoints
            .MapGroup("/api/client-profile")
            .RequireAuthorization(AuthorizationPolicies.TenantClient)
            .WithTags(ClientsModule.Name);

        selfGroup.MapGet("/me", async (
            IClientProfileApplicationService service,
            CancellationToken cancellationToken) =>
        {
            var profile = await service.GetSelfAsync(cancellationToken);
            return profile is null ? Results.NotFound() : Results.Ok(profile);
        })
        .WithName("GetOwnClientProfile")
        .Produces<ClientSelfProfile>()
        .Produces(StatusCodes.Status404NotFound);

        selfGroup.MapPut("/me/intake", async (
            UpdateClientIntakeRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            IClientProfileApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.UpdateSelfAsync(request, cancellationToken));
        })
        .WithName("UpdateOwnClientIntake")
        .Produces<ClientSelfProfile>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict);

        selfGroup.MapPost("/me/complete-onboarding", async (
            CompleteClientOnboardingRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            IClientProfileApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.CompleteSelfAsync(request, cancellationToken));
        })
        .WithName("CompleteOwnClientOnboarding")
        .Produces<ClientSelfProfile>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict);

        return endpoints;
    }

    private static IResult ToResult(ClientCommandResult result) =>
        result.Status switch
        {
            ClientCommandStatus.Success => Results.Ok((object?)result.SelfProfile ?? result.CoachDetails),
            ClientCommandStatus.NotFound => Results.NotFound(),
            ClientCommandStatus.Invalid => Results.ValidationProblem(
                result.Errors ?? new Dictionary<string, string[]>()),
            _ => Results.Conflict(new
            {
                code = "concurrency_conflict",
                message = "The client profile was changed by another request.",
            }),
        };
}
