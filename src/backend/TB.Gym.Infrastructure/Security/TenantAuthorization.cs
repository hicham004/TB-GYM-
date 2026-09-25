using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Policy;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using TB.Gym.Infrastructure.Application;
using TB.Gym.Modules.Clients;
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
    CoachClientScope coachClientScope,
    WorkspaceBillingLock billingLock)
    : AuthorizationHandler<TenantRoleRequirement>
{
    /// <summary>
    /// The route parameters that name a client. A Coach may reach one only when it is assigned to
    /// them; an integration test asserts no other client-naming route parameter exists.
    /// </summary>
    public static readonly IReadOnlyList<string> ClientRouteParameters = ["clientProfileId", "clientId"];

    public const string ClientNotAssignedFailure = "client_not_assigned";

    public const string ClientReleasedFailure = "client_released";

    public const string WorkspaceReadOnlyFailure = "workspace_read_only";

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

        var routeClientId = RouteClientId(httpContext);
        if (membership.Role == TenantRole.Coach &&
            routeClientId is { } clientProfileId &&
            await coachClientScope.ExcludesAsync(clientProfileId, httpContext.RequestAborted))
        {
            context.Fail(new AuthorizationFailureReason(this, ClientNotAssignedFailure));
            return;
        }

        // A released client's record is read-only for everyone (ADR 0027): every state-changing
        // request that names one is refused here, once, instead of in each module's handlers.
        if (routeClientId is { } releasedCandidate &&
            !IsReadOnlyMethod(httpContext.Request.Method) &&
            await coachClientScope.IsReleasedAsync(releasedCandidate, httpContext.RequestAborted))
        {
            context.Fail(new AuthorizationFailureReason(this, ClientReleasedFailure));
            return;
        }

        // An unpaid platform bill makes the workspace read-only for its owner and coaches (ADR 0028),
        // decided here once for every module. Clients are never affected, and a route marked
        // AllowedWhileWorkspaceReadOnly (a read sent as POST, or the person's own settings) stays open.
        if (membership.Role is TenantRole.Owner or TenantRole.Coach &&
            !IsReadOnlyMethod(httpContext.Request.Method) &&
            httpContext.GetEndpoint()?.Metadata.GetMetadata<AllowedWhileWorkspaceReadOnly>() is null &&
            await billingLock.IsReadOnlyAsync(tenantId, httpContext.RequestAborted))
        {
            context.Fail(new AuthorizationFailureReason(this, WorkspaceReadOnlyFailure));
            return;
        }

        context.Succeed(requirement);
    }

    private static bool IsReadOnlyMethod(string method) =>
        HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method);

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

        if (authorizeResult.Forbidden &&
            authorizeResult.AuthorizationFailure?.FailureReasons.Any(reason =>
                reason.Message == TenantRoleAuthorizationHandler.ClientReleasedFailure) == true)
        {
            return ClientReleasedExceptionHandler.WriteAsync(context);
        }

        if (authorizeResult.Forbidden &&
            authorizeResult.AuthorizationFailure?.FailureReasons.Any(reason =>
                reason.Message == TenantRoleAuthorizationHandler.WorkspaceReadOnlyFailure) == true)
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return context.Response.WriteAsJsonAsync(new
            {
                code = TenantRoleAuthorizationHandler.WorkspaceReadOnlyFailure,
                message = "This workspace is read-only until its TB Gym bill is paid. You can still view everything.",
            });
        }

        return defaultHandler.HandleAsync(next, context, policy, authorizeResult);
    }
}

/// <summary>
/// Turns a write that reached a released client into 409 <c>client_released</c>, the same answer the
/// authorization handler gives when the client is named in the route (ADR 0027).
/// </summary>
internal sealed class ClientReleasedExceptionHandler : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(
        HttpContext httpContext,
        Exception exception,
        CancellationToken cancellationToken)
    {
        if (exception is not ClientReleasedException)
        {
            return false;
        }

        await WriteAsync(httpContext);
        return true;
    }

    public static Task WriteAsync(HttpContext context)
    {
        context.Response.StatusCode = StatusCodes.Status409Conflict;
        return context.Response.WriteAsJsonAsync(new
        {
            code = TenantRoleAuthorizationHandler.ClientReleasedFailure,
            message = "This client has been released from the workspace; their record is read-only.",
        });
    }
}
