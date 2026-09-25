using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using TB.Gym.Modules.Identity;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Security;

/// <summary>
/// The platform admin is a global role (ADR 0028), never a workspace role and never self-registered:
/// only the <c>platform-admin</c> command grants it.
/// </summary>
internal sealed class PlatformAdminRequirement : IAuthorizationRequirement;

/// <summary>
/// Checks the account itself on every request rather than trusting the role claim in the cookie: the
/// account must still exist, be confirmed, not be blocked, and hold the role in the database now. A
/// workspace header plays no part, so no owner, coach or client of any workspace can satisfy it.
/// </summary>
internal sealed class PlatformAdminAuthorizationHandler(
    ICurrentUser currentUser,
    UserManager<ApplicationUser> userManager)
    : AuthorizationHandler<PlatformAdminRequirement>
{
    protected override async Task HandleRequirementAsync(
        AuthorizationHandlerContext context,
        PlatformAdminRequirement requirement)
    {
        if (currentUser.UserId is not { } userId)
        {
            return;
        }

        var user = await userManager.FindByIdAsync(userId.ToString());
        if (user is null || user.IsPlatformBlocked || !user.EmailConfirmed)
        {
            return;
        }

        if (await userManager.IsInRoleAsync(user, SystemRoles.PlatformAdmin))
        {
            context.Succeed(requirement);
        }
    }
}
