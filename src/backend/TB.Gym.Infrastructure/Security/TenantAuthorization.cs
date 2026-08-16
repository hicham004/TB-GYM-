using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using TB.Gym.Modules.Tenancy;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Security;

internal sealed class TenantRoleRequirement(params TenantRole[] allowedRoles) : IAuthorizationRequirement
{
    public IReadOnlySet<TenantRole> AllowedRoles { get; } = allowedRoles.ToHashSet();
}

internal sealed class TenantRoleAuthorizationHandler(
    IHttpContextAccessor httpContextAccessor,
    ICurrentUser currentUser,
    IMutableTenantContext tenantContext,
    ITenantMembershipStore membershipStore)
    : AuthorizationHandler<TenantRoleRequirement>
{
    protected override async Task HandleRequirementAsync(
        AuthorizationHandlerContext context,
        TenantRoleRequirement requirement)
    {
        var httpContext = httpContextAccessor.HttpContext;
        if (httpContext is null || currentUser.UserId is not { } userId)
        {
            return;
        }

        if (!Guid.TryParse(httpContext.Request.Headers[TenantHeaders.TenantId].FirstOrDefault(), out var tenantId))
        {
            return;
        }

        var membership = await membershipStore.FindActiveAsync(
            tenantId,
            userId,
            httpContext.RequestAborted);

        if (membership is null || !requirement.AllowedRoles.Contains(membership.Role))
        {
            return;
        }

        tenantContext.SetTenant(tenantId);
        context.Succeed(requirement);
    }
}
