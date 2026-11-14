using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Subscriptions;

/// <summary>
/// The house's asks for a paid plan (SUB-020, notes plan N9c1): the trainee's plans page, their ask and their word
/// that the money was sent; the house's staff reading a trainee's asks, booking one with its receipt, or closing it.
/// Every write is a money write: antiforgery and the sensitive-write limit.
/// </summary>
internal static class HousePlanAskEndpoints
{
    public static IEndpointRouteBuilder MapHousePlanAsks(this IEndpointRouteBuilder endpoints)
    {
        var own = endpoints
            .MapGroup("/api/house-plans/me")
            .RequireAuthorization(AuthorizationPolicies.TenantClient)
            .WithTags(SubscriptionsModule.Name);

        own.MapGet("", async (
            IHousePlanAskService service,
            CancellationToken cancellationToken) =>
        {
            var view = await service.GetOwnAsync(cancellationToken);
            return view is null ? Results.NotFound() : Results.Ok(view);
        })
        .WithName("GetOwnHousePlans")
        .Produces<HousePlansView>()
        .Produces(StatusCodes.Status404NotFound);

        own.MapPost("/asks", async (
            AskForHousePlanRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            IHousePlanAskService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.AskAsync(request, cancellationToken), "/api/house-plans/me");
        })
        .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
        .WithName("AskForHousePlan")
        .Produces<HousePlanAskView>(StatusCodes.Status201Created)
        .Produces<HousePlanAskView>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict)
        .Produces(StatusCodes.Status404NotFound);

        own.MapPost("/asks/{askId:guid}/money-sent", async (
            Guid askId,
            HousePlanMoneySentRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            IHousePlanAskService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.SayMoneySentAsync(askId, request, cancellationToken), null);
        })
        .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
        .WithName("SayHousePlanMoneySent")
        .Produces<HousePlanAskView>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict)
        .Produces(StatusCodes.Status404NotFound);

        // The house's staff, on one trainee: the route names the client, so the tenant handler keeps a Coach to their
        // own clients and refuses a write on a released one (ADR 0026, 0027).
        var staff = endpoints
            .MapGroup("/api/commercial/clients/{clientProfileId:guid}/house-plan-asks")
            .RequireAuthorization(AuthorizationPolicies.TenantCoach)
            .WithMetadata(ClientSide.Business)
            .WithTags(SubscriptionsModule.Name);

        staff.MapGet("", async (
            Guid clientProfileId,
            IHousePlanAskService service,
            CancellationToken cancellationToken) =>
        {
            var asks = await service.ListForClientAsync(clientProfileId, cancellationToken);
            return asks is null ? Results.NotFound() : Results.Ok(asks);
        })
        .WithName("ListClientHousePlanAsks")
        .Produces<HousePlanAskView[]>()
        .Produces(StatusCodes.Status404NotFound);

        staff.MapPost("/{askId:guid}/book", async (
            Guid clientProfileId,
            Guid askId,
            BookHousePlanAskRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            IHousePlanAskService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.BookAsync(clientProfileId, askId, request, cancellationToken), null);
        })
        .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
        .WithName("BookHousePlanAsk")
        .Produces<HousePlanAskView>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict)
        .Produces(StatusCodes.Status404NotFound);

        staff.MapPost("/{askId:guid}/close", async (
            Guid clientProfileId,
            Guid askId,
            CloseHousePlanAskRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            IHousePlanAskService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.CloseAsync(clientProfileId, askId, request, cancellationToken), null);
        })
        .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
        .WithName("CloseHousePlanAsk")
        .Produces<HousePlanAskView>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict)
        .Produces(StatusCodes.Status404NotFound);

        return endpoints;
    }

    private static IResult ToResult(HousePlanAskResult result, string? createdAt) =>
        result.Status switch
        {
            HousePlanAskStatus.Created => Results.Created(createdAt, result.Ask),
            HousePlanAskStatus.Unchanged or HousePlanAskStatus.Changed => Results.Ok(result.Ask),
            HousePlanAskStatus.NotFound => Results.NotFound(),
            HousePlanAskStatus.Invalid => Results.ValidationProblem(
                result.Errors ?? new Dictionary<string, string[]>()),
            _ => Results.Conflict(new
            {
                code = result.Code ?? HousePlanAskCodes.Changed,
                message = result.Message ?? "The ask changed meanwhile. Reload the page to see where it stands.",
            }),
        };
}
