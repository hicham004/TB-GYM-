using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using TB.Gym.Modules.Identity;

namespace TB.Gym.Infrastructure.Initialization;

/// <summary>
/// The only way to grant or revoke the global platform-admin role (ADR 0028). Nobody can give it to
/// themselves through the application: it is run by whoever operates the deployment, against the
/// deployment's own database.
/// </summary>
/// <remarks>
/// <code>
/// dotnet TB.Gym.Api.dll platform-admin grant someone@example.com
/// dotnet TB.Gym.Api.dll platform-admin revoke someone@example.com
/// dotnet TB.Gym.Api.dll platform-admin list
/// </code>
/// The account must already exist with a confirmed email. A grant takes effect on the account's next
/// request, because the session's roles are re-read on every one; a revoke also ends its sessions.
/// </remarks>
public static class PlatformAdminCommand
{
    public const string Name = "platform-admin";

    public static bool IsInvocation(IReadOnlyList<string> args) =>
        args.Count > 0 && string.Equals(args[0], Name, StringComparison.Ordinal);

    /// <returns>A process exit code: 0 on success, 2 for a usage or account problem.</returns>
    public static async Task<int> RunAsync(IServiceProvider services, IReadOnlyList<string> args, TextWriter output)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(output);
        var verb = args.Count > 1 ? args[1] : string.Empty;
        await using var scope = services.CreateAsyncScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<Guid>>>();
        if (!await roles.RoleExistsAsync(SystemRoles.PlatformAdmin))
        {
            var created = await roles.CreateAsync(new IdentityRole<Guid>(SystemRoles.PlatformAdmin));
            if (!created.Succeeded)
            {
                await output.WriteLineAsync("Could not create the platform-admin role.");
                return 2;
            }
        }

        switch (verb)
        {
            case "list":
                foreach (var admin in (await users.GetUsersInRoleAsync(SystemRoles.PlatformAdmin)).OrderBy(user => user.Email))
                {
                    await output.WriteLineAsync(admin.Email);
                }

                return 0;
            case "grant" or "revoke" when args.Count == 3:
                break;
            default:
                await output.WriteLineAsync($"Usage: {Name} grant <email> | {Name} revoke <email> | {Name} list");
                return 2;
        }

        var user = await users.FindByEmailAsync(args[2].Trim());
        if (user is null)
        {
            await output.WriteLineAsync("No account uses that email. Register it and confirm the email first.");
            return 2;
        }

        var isAdmin = await users.IsInRoleAsync(user, SystemRoles.PlatformAdmin);
        if (verb == "grant")
        {
            if (!user.EmailConfirmed || user.IsPlatformBlocked)
            {
                await output.WriteLineAsync("That account must have a confirmed email and must not be blocked.");
                return 2;
            }

            if (!isAdmin && !(await users.AddToRoleAsync(user, SystemRoles.PlatformAdmin)).Succeeded)
            {
                await output.WriteLineAsync("Could not grant the platform-admin role.");
                return 2;
            }
        }
        else
        {
            if (isAdmin && !(await users.RemoveFromRoleAsync(user, SystemRoles.PlatformAdmin)).Succeeded)
            {
                await output.WriteLineAsync("Could not revoke the platform-admin role.");
                return 2;
            }

            // Ends the account's sessions, so a revoked admin signs in again without the role.
            await users.UpdateSecurityStampAsync(user);
        }

        await output.WriteLineAsync(verb == "grant"
            ? $"{user.Email} is a platform admin."
            : $"{user.Email} is no longer a platform admin.");
        return 0;
    }
}
