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
            .WithMetadata(ClientSide.Private)
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
        .WithMetadata(ClientSide.Business)
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
        .ProducesProblem(StatusCodes.Status409Conflict)
        .RequireRateLimiting(RateLimitPolicies.RoutineWrite);

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
        .ProducesProblem(StatusCodes.Status409Conflict)
        .RequireRateLimiting(RateLimitPolicies.RoutineWrite);

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
        .ProducesProblem(StatusCodes.Status409Conflict)
        .RequireRateLimiting(RateLimitPolicies.RoutineWrite);

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
        .WithMetadata(ClientSide.Business)
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
        .WithMetadata(ClientSide.Business)
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
        .WithMetadata(ClientSide.Business)
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
        .WithMetadata(ClientSide.Business)
        .Produces<ClientCoachAssignmentView[]>()
        .Produces(StatusCodes.Status404NotFound);

        // Only the owner ends a client's relationship with the workspace (ADR 0027). There is no undo.
        coachGroup.MapPost("/{clientId:guid}/release", async (
            Guid clientId,
            ReleaseClientRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            IClientProfileApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.ReleaseAsync(clientId, request, cancellationToken));
        })
        .RequireAuthorization(AuthorizationPolicies.TenantOwner)
        .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
        .WithName("ReleaseClient")
        .WithMetadata(ClientSide.Business)
        .Produces<CoachClientDetails>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict);

        coachGroup.MapGet("/former", async (
            IClientProfileApplicationService service,
            CancellationToken cancellationToken) =>
            Results.Ok(await service.ListFormerAsync(cancellationToken)))
        .RequireAuthorization(AuthorizationPolicies.TenantOwner)
        .WithName("ListFormerClients")
        .Produces<FormerClientSummary[]>();

        // The coach's client list (C2): every client they coach with status and recent activity (R3.1).
        coachGroup.MapGet("/overview", async (
            ICoachOverviewService service,
            CancellationToken cancellationToken) =>
            Results.Ok(await service.ListAsync(cancellationToken)))
        .WithName("ListClientOverview")
        .Produces<ClientOverviewView>();

        // One client's slice of the same read for their page (C3, R3.3b). The client id is a route
        // parameter, so the tenant handler answers another coach's client 404 before this runs.
        coachGroup.MapGet("/{clientId:guid}/overview", async (
            Guid clientId,
            ICoachOverviewService service,
            CancellationToken cancellationToken) =>
        {
            var view = await service.GetClientAsync(clientId, cancellationToken);
            return view is null ? Results.NotFound() : Results.Ok(view);
        })
        .WithName("GetClientOverview")
        .WithMetadata(ClientSide.Business)
        .Produces<ClientProfileOverviewView>()
        .Produces(StatusCodes.Status404NotFound);

        // Coach Today (C1, R3.1, critique B4b): who needs the coach now, this month's money received and
        // active clients, the plans ending soon or ended and not renewed, and what their clients did.
        endpoints.MapGet("/api/coach-today", async (
            ICoachOverviewService service,
            CancellationToken cancellationToken) =>
            Results.Ok(await service.GetTodayAsync(cancellationToken)))
        .RequireAuthorization(AuthorizationPolicies.TenantCoach)
        .WithTags(ClientsModule.Name)
        .WithName("GetCoachToday")
        .Produces<CoachTodayView>();

        // This month (critique B10d, SUB-018): the month's numbers beside last month's, the caller's own, or for the
        // owner the workspace's with each coach's. It decides nothing and writes nothing.
        endpoints.MapGet("/api/coach-month", async (
            ICoachMonthService service,
            CancellationToken cancellationToken) =>
            Results.Ok(await service.GetAsync(cancellationToken)))
        .RequireAuthorization(AuthorizationPolicies.TenantCoach)
        .WithTags(ClientsModule.Name)
        .WithName("GetCoachMonth")
        .Produces<CoachMonthReportView>();

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

        selfGroup.MapGet("/me/coach", async (
            IClientProfileApplicationService service,
            CancellationToken cancellationToken) =>
        {
            var coach = await service.GetOwnCoachAsync(cancellationToken);
            return coach is null ? Results.NotFound() : Results.Ok(coach);
        })
        .WithName("GetOwnCoach")
        .Produces<OwnCoachView>()
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
        .ProducesProblem(StatusCodes.Status409Conflict)
        .RequireRateLimiting(RateLimitPolicies.RoutineWrite);

        // A client leaves the workspace themselves (ADR 0027). Their access ends with this request.
        selfGroup.MapPost("/me/leave", async (
            LeaveWorkspaceRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            IClientProfileApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            var result = await service.LeaveAsync(request, cancellationToken);
            return result.Status == ClientCommandStatus.Success ? Results.NoContent() : ToResult(result);
        })
        .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
        .WithName("LeaveWorkspace")
        .Produces(StatusCodes.Status204NoContent)
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
        .ProducesProblem(StatusCodes.Status409Conflict)
        .RequireRateLimiting(RateLimitPolicies.RoutineWrite);

        return endpoints;
    }

    private static IResult ToResult(ClientCommandResult result) =>
        result.Status switch
        {
            ClientCommandStatus.Success => Results.Ok((object?)result.SelfProfile ?? result.CoachDetails),
            ClientCommandStatus.NotFound => Results.NotFound(),
            ClientCommandStatus.Invalid => Results.ValidationProblem(
                result.Errors ?? new Dictionary<string, string[]>()),
            ClientCommandStatus.HealthStepClosed => Results.Conflict(new
            {
                code = "health_step_closed",
                message = HealthStepClosedException.Sentence,
            }),
            _ => Results.Conflict(new
            {
                code = "concurrency_conflict",
                message = "The client profile was changed by another request.",
            }),
        };
}
