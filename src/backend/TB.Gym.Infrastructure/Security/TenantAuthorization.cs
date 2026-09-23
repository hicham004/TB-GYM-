using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Policy;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using TB.Gym.Infrastructure.Application;
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
    ITenantMembershipStore membershipStore,
    CoachClientScope coachClientScope)
    : AuthorizationHandler<TenantRoleRequirement>
{
    /// <summary>
    /// The route parameters that name a client. A Coach may reach one only when it is assigned to
    /// them; an integration test asserts no other client-naming route parameter exists.
    /// </summary>
    public static readonly IReadOnlyList<string> ClientRouteParameters = ["clientProfileId", "clientId"];

    public const string ClientNotAssignedFailure = "client_not_assigned";

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

        if (membership.Role == TenantRole.Coach &&
            RouteClientId(httpContext) is { } clientProfileId &&
            await coachClientScope.ExcludesAsync(clientProfileId, httpContext.RequestAborted))
        {
            context.Fail(new AuthorizationFailureReason(this, ClientNotAssignedFailure));
            return;
        }

        context.Succeed(requirement);
    }

    private static Guid? RouteClientId(HttpContext httpContext)
    {
        foreach (var name in ClientRouteParameters)
        {
            if (httpContext.GetRouteValue(name) is { } value &&
                Guid.TryParse(value.ToString(), out var clientProfileId))
            {
                return clientProfileId;
            }
        }

        return null;
    }
}

/// <summary>
/// Answers a Coach who names another coach's client exactly as it answers a client that does not
/// exist: 404, not 403. A distinct refusal would confirm that the identifier is a real client of this
/// workspace, which is the same oracle the cross-workspace rules already refuse to be.
/// </summary>
internal sealed class TenantAuthorizationResultHandler : IAuthorizationMiddlewareResultHandler
{
    private readonly AuthorizationMiddlewareResultHandler defaultHandler = new();

    public Task HandleAsync(
        RequestDelegate next,
        HttpContext context,
        AuthorizationPolicy policy,
        PolicyAuthorizationResult authorizeResult)
    {
        if (authorizeResult.Forbidden &&
            authorizeResult.AuthorizationFailure?.FailureReasons.Any(reason =>
                reason.Message == TenantRoleAuthorizationHandler.ClientNotAssignedFailure) == true)
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return Task.CompletedTask;
        }

        return defaultHandler.HandleAsync(next, context, policy, authorizeResult);
    }
}
