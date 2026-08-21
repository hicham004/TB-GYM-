using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Strength;

public static class StrengthEndpoints
{
    public static IEndpointRouteBuilder MapStrengthModule(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints
            .MapGroup("/api/strength")
            .RequireAuthorization(AuthorizationPolicies.TenantCoach)
            .WithTags(StrengthModule.Name);

        group.MapGet("/clients/{clientProfileId:guid}/maxes", async (
            Guid clientProfileId,
            Guid? exerciseId,
            int? skip,
            int? take,
            IStrengthApplicationService service,
            CancellationToken cancellationToken) =>
        {
            var page = NormalizePage(skip, take, 50);
            var records = await service.ListAsync(
                clientProfileId,
                exerciseId,
                page.Skip,
                page.Take,
                cancellationToken);
            return records is null ? Results.NotFound() : Results.Ok(records);
        })
        .WithName("ListStrengthMaxHistory")
        .Produces<StrengthMaxPage>()
        .Produces(StatusCodes.Status404NotFound);

        group.MapPost("/clients/{clientProfileId:guid}/maxes", async (
            Guid clientProfileId,
            RecordStrengthMaxRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            IStrengthApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            var result = await service.RecordAsync(clientProfileId, request, cancellationToken);
            return result.Status switch
            {
                StrengthCommandStatus.Success => Results.Ok(result.Record),
                StrengthCommandStatus.NotFound => Results.NotFound(),
                _ => Results.ValidationProblem(result.Errors ?? new Dictionary<string, string[]>()),
            };
        })
        .WithName("RecordStrengthMax")
        .Produces<StrengthMaxView>()
        .ProducesValidationProblem()
        .Produces(StatusCodes.Status404NotFound);

        group.MapPost("/estimate-one-rep-max", (
            EstimateOneRepMaxRequest request,
            IStrengthApplicationService service) =>
        {
            try
            {
                return Results.Ok(service.Estimate(request));
            }
            catch (ArgumentException exception)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["estimate"] = [exception.Message],
                });
            }
        })
            .WithName("EstimateOneRepMax")
            .Produces<OneRepMaxEstimateView>()
            .ProducesValidationProblem();

        return endpoints;
    }

    private static (int Skip, int Take) NormalizePage(int? skip, int? take, int defaultTake) =>
        (Math.Max(skip ?? 0, 0), Math.Clamp(take ?? defaultTake, 1, 100));
}
