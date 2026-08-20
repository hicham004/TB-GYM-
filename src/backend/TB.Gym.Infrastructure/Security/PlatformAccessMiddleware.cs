using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using TB.Gym.Modules.Identity;

namespace TB.Gym.Infrastructure.Security;

internal sealed class PlatformAccessMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(
        HttpContext context,
        UserManager<ApplicationUser> userManager,
        SignInManager<ApplicationUser> signInManager)
    {
        if (context.User.Identity?.IsAuthenticated == true)
        {
            var user = await userManager.GetUserAsync(context.User);
            if (user is null || user.IsPlatformBlocked)
            {
                await signInManager.SignOutAsync();
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                return;
            }
        }

        await next(context);
    }
}

public static class PlatformAccessMiddlewareExtensions
{
    public static IApplicationBuilder UseTbGymPlatformAccess(this IApplicationBuilder app) =>
        app.UseMiddleware<PlatformAccessMiddleware>();
}
