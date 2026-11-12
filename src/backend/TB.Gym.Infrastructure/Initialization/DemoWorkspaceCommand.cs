using System.Diagnostics.CodeAnalysis;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Identity;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Initialization;

/// <summary>
/// Fills a development database with "Atlas Performance": an owner, two coaches and twelve clients
/// with about ten weeks of history, so every screen can be built, screenshotted and demoed on data
/// that looks real (UI-REDESIGN-PLAN.md §7). Development only.
/// </summary>
/// <remarks>
/// <code>
/// dotnet run --project src/backend/TB.Gym.Api -- demo-workspace
/// dotnet run --project src/backend/TB.Gym.Api -- demo-workspace --password "Another-Pass-1"
/// dotnet run --project src/backend/TB.Gym.Api -- demo-workspace --cast sample
/// </code>
/// It applies pending migrations, then refuses if the workspace already exists. Dates are relative to
/// the day it runs, so rebuild it (drop the development database and run it again) before a demo.
/// <c>--cast sample</c> builds the same people as a first-name cast in "Oakline Strength", for the
/// pictures on the public homepage (UI plan R6.2d); the owner's own demo keeps its names.
/// <para>
/// Beside either cast it builds TB Gym's own coaching space, marked as the house with its settings empty, so
/// its sign-up stays closed (notes plan N9a2); a database that already has a house keeps it as it is.
/// </para>
/// </remarks>
public static class DemoWorkspaceCommand
{
    public const string Name = "demo-workspace";

    /// <summary>Every demo account signs in with this unless <c>--password</c> says otherwise.</summary>
    public const string DefaultPassword = "AtlasDemo-2026!";

    public static bool IsInvocation(IReadOnlyList<string> args) =>
        args.Count > 0 && string.Equals(args[0], Name, StringComparison.Ordinal);

    /// <summary>
    /// Swaps the system clock for the one the generator walks through the past. Registered only when
    /// the command runs, before the host is built, and never in a host that serves requests.
    /// </summary>
    public static IServiceCollection AddDemoWorkspaceClock(this IServiceCollection services)
    {
        services.AddSingleton<DemoClock>();
        services.Replace(ServiceDescriptor.Singleton<IClock>(provider => provider.GetRequiredService<DemoClock>()));
        return services;
    }

    /// <returns>0 when the demo was built, 1 when a step failed, 2 for a usage or setup problem.</returns>
    public static async Task<int> RunAsync(
        IServiceProvider services,
        IReadOnlyList<string> args,
        TextWriter output,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(output);
        if (!DemoWorkspaceOptions.TryParse(args, out var options))
        {
            await output.WriteLineAsync($"Usage: {Name} [--password <password>] [--cast atlas|sample]");
            return 2;
        }

        return await RunAsync(services, options.Password, output, options.People, cancellationToken);
    }

    /// <summary>Builds the demo for the given people, which lets the integration test run with a few of its clients.</summary>
    internal static async Task<int> RunAsync(
        IServiceProvider services,
        string password,
        TextWriter output,
        DemoPeople people,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(output);
        if (!services.GetRequiredService<IHostEnvironment>().IsDevelopment())
        {
            await output.WriteLineAsync($"{Name} only runs in Development. It never touches a real workspace.");
            return 2;
        }

        if (services.GetRequiredService<IClock>() is not DemoClock clock)
        {
            await output.WriteLineAsync($"The demo clock is not registered. Call {nameof(AddDemoWorkspaceClock)} before the host is built.");
            return 2;
        }

        bool buildHouse;
        await using (var scope = services.CreateAsyncScope())
        {
            var dbContext = scope.ServiceProvider.GetRequiredService<GymDbContext>();
            await dbContext.Database.MigrateAsync(cancellationToken);
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            if (await users.FindByEmailAsync(people.Owner.Email) is not null)
            {
                await output.WriteLineAsync(
                    $"{people.WorkspaceName} is already in this database. " +
                    "To rebuild it with today's dates, drop the development database and run this again.");
                return 2;
            }

            // The other cast built into the same database already made the house; there is only ever one.
            buildHouse = !await dbContext.Tenants.AnyAsync(tenant => tenant.IsHouse, cancellationToken) &&
                await users.FindByEmailAsync(DemoWorkspaceCast.HouseOwner.Email) is null;
        }

        await output.WriteLineAsync($"Building {people.WorkspaceName}. This takes a minute or two.");
        DemoWorkspaceTally tally;
        try
        {
            tally = await new DemoWorkspaceGenerator(services, clock, password, people, buildHouse, cancellationToken)
                .GenerateAsync(output);
        }
        catch (DemoStepFailedException exception)
        {
            await output.WriteLineAsync(exception.Message);
            await output.WriteLineAsync("The database now holds a partial demo. Drop it before running this again.");
            return 1;
        }

        await WriteSummaryAsync(output, tally, password, people);
        return 0;
    }

    private static async Task WriteSummaryAsync(
        TextWriter output,
        DemoWorkspaceTally tally,
        string password,
        DemoPeople people)
    {
        var waiting = tally.CheckInsSubmitted - tally.CheckInsReviewed;
        await output.WriteLineAsync();
        await output.WriteLineAsync($"{people.WorkspaceName} is ready.");
        await output.WriteLineAsync(
            $"  {tally.Clients} clients and {tally.PendingInvitations} pending invitations, {tally.Workouts} workouts " +
            $"({tally.Sets} sets, {tally.PersonalBests} personal bests), {tally.WeighIns} weigh-ins, " +
            $"{tally.Measurements} waist measurements, {tally.SessionsHeld} 1-on-1 sessions held, " +
            $"{tally.CheckInsSubmitted} check-ins ({waiting} waiting for review), " +
            $"{tally.Messages} messages, {tally.Notifications} notifications delivered.");
        await output.WriteLineAsync();
        await output.WriteLineAsync($"Sign in with any of these, password {password}:");
        await output.WriteLineAsync($"  Owner   {people.Owner.Email}");
        foreach (var coach in people.Coaches)
        {
            await output.WriteLineAsync($"  Coach   {coach.Email}");
        }

        if (people.Clients.SingleOrDefault(client => client.IsHero) is { } hero)
        {
            await output.WriteLineAsync($"  Client  {hero.Email} (has a workout today); every client's address is made the same way");
        }

        await output.WriteLineAsync();
        if (tally.House)
        {
            await output.WriteLineAsync(
                $"{DemoWorkspaceCast.HouseName} is the house; its sign-up stays closed until a platform admin fills its settings:");
            await output.WriteLineAsync($"  Owner   {DemoWorkspaceCast.HouseOwner.Email}");
            await output.WriteLineAsync($"  Coach   {DemoWorkspaceCast.HouseCoach.Email}");
        }
        else
        {
            await output.WriteLineAsync("This database already had a house, which is left as it was.");
        }
    }
}

/// <summary>What the command was asked for: the shared password and which people to build.</summary>
internal sealed record DemoWorkspaceOptions(string Password, DemoPeople People)
{
    /// <summary>
    /// <c>demo-workspace [--password &lt;password&gt;] [--cast atlas|sample]</c>, in any order. Anything else
    /// is a usage error, so a mistyped option never quietly builds the wrong demo.
    /// </summary>
    public static bool TryParse(IReadOnlyList<string> args, [NotNullWhen(true)] out DemoWorkspaceOptions? options)
    {
        options = null;
        if (!DemoWorkspaceCommand.IsInvocation(args))
        {
            return false;
        }

        var password = DemoWorkspaceCommand.DefaultPassword;
        var people = DemoWorkspaceCast.Atlas;
        for (var index = 1; index < args.Count; index += 2)
        {
            if (index + 1 >= args.Count || string.IsNullOrWhiteSpace(args[index + 1]))
            {
                return false;
            }

            switch (args[index], args[index + 1])
            {
                case ("--password", var value):
                    password = value;
                    break;
                case ("--cast", "atlas"):
                    people = DemoWorkspaceCast.Atlas;
                    break;
                case ("--cast", "sample"):
                    people = DemoWorkspaceCast.Sample;
                    break;
                default:
                    return false;
            }
        }

        options = new DemoWorkspaceOptions(password, people);
        return true;
    }
}
