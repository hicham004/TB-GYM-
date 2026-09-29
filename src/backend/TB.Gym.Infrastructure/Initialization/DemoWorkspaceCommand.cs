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
/// </code>
/// It applies pending migrations, then refuses if the workspace already exists. Dates are relative to
/// the day it runs, so rebuild it (drop the development database and run it again) before a demo.
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
    public static Task<int> RunAsync(
        IServiceProvider services,
        IReadOnlyList<string> args,
        TextWriter output,
        CancellationToken cancellationToken = default) =>
        RunAsync(services, args, output, DemoWorkspaceCast.Clients, cancellationToken);

    /// <summary>Builds the demo with only some of its clients, which keeps the integration test quick.</summary>
    internal static async Task<int> RunAsync(
        IServiceProvider services,
        IReadOnlyList<string> args,
        TextWriter output,
        IReadOnlyList<DemoClient> clients,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(output);
        if (!services.GetRequiredService<IHostEnvironment>().IsDevelopment())
        {
            await output.WriteLineAsync($"{Name} only runs in Development. It never touches a real workspace.");
            return 2;
        }

        if (!TryReadPassword(args, out var password))
        {
            await output.WriteLineAsync($"Usage: {Name} [--password <password>]");
            return 2;
        }

        if (services.GetRequiredService<IClock>() is not DemoClock clock)
        {
            await output.WriteLineAsync($"The demo clock is not registered. Call {nameof(AddDemoWorkspaceClock)} before the host is built.");
            return 2;
        }

        await using (var scope = services.CreateAsyncScope())
        {
            await scope.ServiceProvider.GetRequiredService<GymDbContext>().Database.MigrateAsync(cancellationToken);
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            if (await users.FindByEmailAsync(DemoWorkspaceCast.Owner.Email) is not null)
            {
                await output.WriteLineAsync(
                    $"{DemoWorkspaceCast.WorkspaceName} is already in this database. " +
                    "To rebuild it with today's dates, drop the development database and run this again.");
                return 2;
            }
        }

        await output.WriteLineAsync($"Building {DemoWorkspaceCast.WorkspaceName}. This takes a minute or two.");
        DemoWorkspaceTally tally;
        try
        {
            tally = await new DemoWorkspaceGenerator(services, clock, password, clients, cancellationToken).GenerateAsync(output);
        }
        catch (DemoStepFailedException exception)
        {
            await output.WriteLineAsync(exception.Message);
            await output.WriteLineAsync("The database now holds a partial demo. Drop it before running this again.");
            return 1;
        }

        await WriteSummaryAsync(output, tally, password, clients);
        return 0;
    }

    private static bool TryReadPassword(IReadOnlyList<string> args, out string password)
    {
        password = DefaultPassword;
        switch (args.Count)
        {
            case 1:
                return true;
            case 3 when args[1] == "--password" && !string.IsNullOrWhiteSpace(args[2]):
                password = args[2];
                return true;
            default:
                return false;
        }
    }

    private static async Task WriteSummaryAsync(
        TextWriter output,
        DemoWorkspaceTally tally,
        string password,
        IReadOnlyList<DemoClient> clients)
    {
        var waiting = tally.CheckInsSubmitted - tally.CheckInsReviewed;
        await output.WriteLineAsync();
        await output.WriteLineAsync($"{DemoWorkspaceCast.WorkspaceName} is ready.");
        await output.WriteLineAsync(
            $"  {tally.Clients} clients and {tally.PendingInvitations} pending invitations, {tally.Workouts} workouts " +
            $"({tally.Sets} sets, {tally.PersonalBests} personal bests), {tally.WeighIns} weigh-ins, " +
            $"{tally.Measurements} waist measurements, {tally.CheckInsSubmitted} check-ins ({waiting} waiting for review), " +
            $"{tally.Messages} messages.");
        await output.WriteLineAsync();
        await output.WriteLineAsync($"Sign in with any of these, password {password}:");
        await output.WriteLineAsync($"  Owner   {DemoWorkspaceCast.Owner.Email}");
        foreach (var coach in DemoWorkspaceCast.Coaches)
        {
            await output.WriteLineAsync($"  Coach   {coach.Email}");
        }

        if (clients.SingleOrDefault(client => client.IsHero) is { } hero)
        {
            await output.WriteLineAsync($"  Client  {hero.Email} (has a workout today), or any client as first.last@mail.example");
        }
    }
}
