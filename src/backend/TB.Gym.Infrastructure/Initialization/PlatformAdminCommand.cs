using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TB.Gym.Infrastructure.Application;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Tenancy;

namespace TB.Gym.Infrastructure.Initialization;

/// <summary>
/// The only way to grant or revoke the global platform-admin role (ADR 0028), and the only way a coaching space is
/// marked as the house (ADR 0041). Nobody can do either through the application: the command is run by whoever
/// operates the deployment, against the deployment's own database.
/// </summary>
/// <remarks>
/// <code>
/// dotnet TB.Gym.Api.dll platform-admin grant someone@example.com
/// dotnet TB.Gym.Api.dll platform-admin revoke someone@example.com
/// dotnet TB.Gym.Api.dll platform-admin list
/// dotnet TB.Gym.Api.dll platform-admin house
/// dotnet TB.Gym.Api.dll platform-admin house set the-space-slug
/// dotnet TB.Gym.Api.dll platform-admin house clear
/// </code>
/// The account must already exist with a confirmed email. A grant takes effect on the account's next
/// request, because the session's roles are re-read on every one; a revoke also ends its sessions.
/// <para>
/// <c>house set</c> takes a coaching space's slug or id. At most one space is the house, so a second is refused
/// until the first is cleared, and a house that holds a sign-up or a self-directed trainee keeps its mark. Marking
/// a space for the first time opens nothing: sign-up stays closed until the platform admin fills the house's
/// settings in the app. A space marked again keeps the settings it was given before, and the command says so.
/// </para>
/// </remarks>
public static class PlatformAdminCommand
{
    public const string Name = "platform-admin";

    private const string Usage =
        $"Usage: {Name} grant <email> | {Name} revoke <email> | {Name} list | {Name} house | {Name} house set <slug or id> | {Name} house clear";

    public static bool IsInvocation(IReadOnlyList<string> args) =>
        args.Count > 0 && string.Equals(args[0], Name, StringComparison.Ordinal);

    /// <returns>A process exit code: 0 on success, 2 for a usage, account or coaching space problem.</returns>
    public static async Task<int> RunAsync(IServiceProvider services, IReadOnlyList<string> args, TextWriter output)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(output);
        var verb = args.Count > 1 ? args[1] : string.Empty;
        await using var scope = services.CreateAsyncScope();
        if (verb == "house")
        {
            return await RunHouseAsync(scope.ServiceProvider.GetRequiredService<GymDbContext>(), args, output);
        }

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
                await output.WriteLineAsync(Usage);
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

    /// <summary>
    /// <c>house</c> says which coaching space is the house, <c>house set</c> marks one and <c>house clear</c> takes
    /// the mark away (CLI-022). The database keeps both rules whoever writes: one house at most, and a house that
    /// holds anyone keeps its mark.
    /// </summary>
    private static async Task<int> RunHouseAsync(GymDbContext dbContext, IReadOnlyList<string> args, TextWriter output)
    {
        var action = args.Count > 2 ? args[2] : string.Empty;
        var house = await dbContext.Tenants.SingleOrDefaultAsync(tenant => tenant.IsHouse);
        switch (action)
        {
            case "" when args.Count == 2:
                await output.WriteLineAsync(house is null
                    ? "No coaching space is the house."
                    : $"{house.Name} ({house.Slug}) is the house.");
                return 0;
            case "set" when args.Count == 4:
                return await SetHouseAsync(dbContext, house, args[3].Trim(), output);
            case "clear" when args.Count == 3:
                return await ClearHouseAsync(dbContext, house, output);
            default:
                await output.WriteLineAsync(Usage);
                return 2;
        }
    }

    private static async Task<int> SetHouseAsync(GymDbContext dbContext, Tenant? house, string slugOrId, TextWriter output)
    {
        var slug = slugOrId.ToLowerInvariant();
        var target = Guid.TryParse(slugOrId, out var id)
            ? await dbContext.Tenants.SingleOrDefaultAsync(tenant => tenant.Id == id)
            : await dbContext.Tenants.SingleOrDefaultAsync(tenant => tenant.Slug == slug);
        if (target is null || !target.IsActive)
        {
            await output.WriteLineAsync("No coaching space has that slug or id.");
            return 2;
        }

        if (house is not null && house.Id != target.Id)
        {
            await output.WriteLineAsync(
                $"{house.Name} ({house.Slug}) is already the house. Clear it first: {Name} house clear");
            return 2;
        }

        if (target.MarkAsHouse())
        {
            try
            {
                await dbContext.SaveChangesAsync();
            }
            catch (DbUpdateException)
            {
                // Another run marked a space between the read above and this write; the unique index refused.
                await output.WriteLineAsync($"Another coaching space was marked as the house meanwhile. Run: {Name} house");
                return 2;
            }
        }

        // A space marked before keeps the settings it was given then (they are append-only), so the command
        // says what stands instead of promising that sign-up is closed.
        var settings = await HouseReader.SettingsAsync(dbContext, target.Id, CancellationToken.None);
        await output.WriteLineAsync(TraineeSignUpRule.IsOpenFor(settings)
            ? $"{target.Name} ({target.Slug}) is the house. Its settings from an earlier mark still stand and sign-up is open; the platform admin closes it by emptying a setting."
            : $"{target.Name} ({target.Slug}) is the house. Sign-up stays closed until the platform admin fills the house's settings.");
        return 0;
    }

    private static async Task<int> ClearHouseAsync(GymDbContext dbContext, Tenant? house, TextWriter output)
    {
        if (house is null)
        {
            await output.WriteLineAsync("No coaching space is the house.");
            return 0;
        }

        // The command names no workspace of its own, so these reads look past the tenant filter at the house alone.
        var holdsAnyone =
            await dbContext.TraineeSignUps.IgnoreQueryFilters().AnyAsync(signUp => signUp.TenantId == house.Id) ||
            await dbContext.ClientProfiles.IgnoreQueryFilters().AnyAsync(
                client => client.TenantId == house.Id && client.IsSelfDirected);
        if (holdsAnyone)
        {
            await output.WriteLineAsync(
                $"{house.Name} ({house.Slug}) holds sign-ups or self-directed trainees and keeps its mark.");
            return 2;
        }

        house.ClearHouse();
        try
        {
            await dbContext.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            // Somebody signed up between the check above and this write; the database kept the mark.
            await output.WriteLineAsync(
                $"{house.Name} ({house.Slug}) holds sign-ups or self-directed trainees and keeps its mark.");
            return 2;
        }

        await output.WriteLineAsync($"{house.Name} ({house.Slug}) is no longer the house.");
        return 0;
    }
}
