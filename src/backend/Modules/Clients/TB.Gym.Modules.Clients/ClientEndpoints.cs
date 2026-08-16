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
        var group = endpoints
            .MapGroup("/api/clients")
            .RequireAuthorization(AuthorizationPolicies.TenantCoach)
            .WithTags(ClientsModule.Name);

        group.MapGet("/", async (
            IClientProfileRepository repository,
            CancellationToken cancellationToken) =>
            Results.Ok(await repository.ListAsync(cancellationToken)));

        group.MapPost("/", async (
            CreateClientRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ITenantContext tenantContext,
            IClientProfileRepository repository,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);

            try
            {
                var profile = ClientProfile.Create(
                    tenantContext.TenantId,
                    request.FirstName,
                    request.LastName,
                    request.Email,
                    request.BirthDate);

                await repository.AddAsync(profile, cancellationToken);
                return Results.Created($"/api/clients/{profile.Id}", ToSummary(profile));
            }
            catch (ArgumentException exception)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["client"] = [exception.Message],
                });
            }
            catch (InvalidOperationException exception)
            {
                return Results.Conflict(new { error = exception.Message });
            }
        });

        return endpoints;
    }

    private static ClientSummary ToSummary(ClientProfile profile) =>
        new(
            profile.Id,
            profile.FirstName,
            profile.LastName,
            profile.Email,
            profile.BirthDate,
            profile.IsCoachBlocked,
            profile.Version);
}
