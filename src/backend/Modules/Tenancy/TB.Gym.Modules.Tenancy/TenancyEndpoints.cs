using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Tenancy;

public static class TenancyEndpoints
{
    public static IEndpointRouteBuilder MapTenancyModule(this IEndpointRouteBuilder endpoints)
    {
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
        .WithTags(TenancyModule.Name);

        return endpoints;
    }
}
