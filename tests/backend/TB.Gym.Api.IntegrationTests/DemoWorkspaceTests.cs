using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Hosting.Internal;
using Npgsql;
using TB.Gym.Infrastructure.Initialization;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.CheckIns;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Invitations;
using TB.Gym.Modules.Messaging;
using TB.Gym.Modules.Nutrition;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.Modules.Tenancy;
using TB.Gym.Modules.Training;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// UI-REDESIGN-PLAN.md R0.1: one development-only command fills an empty database with Atlas
/// Performance through the real application services, so every screen is built, screenshotted and
/// demoed on a business that looks real instead of an empty workspace.
/// </summary>
[TestClass]
public sealed class DemoWorkspaceTests
{
    /// <summary>
    /// The full cast takes minutes, almost all of it logging sets through the real workout service.
    /// These seven still reach every path: the hero's workout today, renewals and a renewal request,
    /// a pause, an overdue and a waiting check-in, a plan ending soon and a client with no program.
    /// </summary>
    private static readonly string[] CastForTheTest = ["maya", "jad", "sara", "elie", "karl", "rita", "lynn"];

    private static readonly string[] OmarsClients = ["Elie", "Jad", "Karl"];

    private string? adminConnection;
    private string? databaseName;

    [TestCleanup]
    public async Task CleanupAsync()
    {
        NpgsqlConnection.ClearAllPools();
        if (databaseName is null || adminConnection is null)
        {
            return;
        }

        await using var connection = new NpgsqlConnection(adminConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = $"DROP DATABASE IF EXISTS \"{databaseName}\" WITH (FORCE)";
        await command.ExecuteNonQueryAsync();
    }

    [TestMethod]
    public async Task TheDemoIsRefusedOutsideDevelopment()
    {
        await using var services = new ServiceCollection()
            .AddSingleton<IHostEnvironment>(new HostingEnvironment { EnvironmentName = Environments.Production })
            .BuildServiceProvider();
        using var output = new StringWriter();

        var exitCode = await DemoWorkspaceCommand.RunAsync(services, [DemoWorkspaceCommand.Name], output);

        Assert.AreEqual(2, exitCode);
        Assert.Contains("only runs in Development", output.ToString());
    }

    [TestMethod]
    public async Task OneCommandFillsAnEmptyDatabaseWithACoachingBusinessThatLooksReal()
    {
        adminConnection = PostgreSqlTestEnvironment.RequireAdminConnection();
        databaseName = await PostgreSqlTestEnvironment.CreateDatabaseAsync("tbgym_demo");
        var connection = new NpgsqlConnectionStringBuilder(adminConnection) { Database = databaseName }.ConnectionString;
        await using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Development");
            builder.UseSetting("ConnectionStrings:Database", connection);
            builder.UseSetting("Database:ApplyMigrationsOnStartup", "false");
            builder.UseSetting("Seed:Enabled", "false");
            builder.ConfigureTestServices(services =>
            {
                services.AddDemoWorkspaceClock();

                // The command exits before the host would start its background workers; so does this.
                var workers = services
                    .Where(descriptor => descriptor.ServiceType == typeof(IHostedService) &&
                        descriptor.ImplementationType?.Assembly == typeof(GymDbContext).Assembly)
                    .ToList();
                foreach (var worker in workers)
                {
                    services.Remove(worker);
                }
            });
        });
        using var output = new StringWriter();
        var cast = DemoWorkspaceCast.Clients.Where(client => CastForTheTest.Contains(client.Key)).ToList();

        var exitCode = await DemoWorkspaceCommand.RunAsync(
            factory.Services, [DemoWorkspaceCommand.Name], output, cast, CancellationToken.None);

        Assert.AreEqual(0, exitCode, output.ToString());
        Assert.Contains("Atlas Performance is ready.", output.ToString());
        var clock = factory.Services.GetRequiredService<DemoClock>();
        var today = new DemoCalendar(clock.Ceiling, DemoWorkspaceCast.TimeZoneId).Today;

        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GymDbContext>();
            var tenant = await db.Tenants.SingleAsync(item => item.Name == DemoWorkspaceCast.WorkspaceName);
            var memberships = await db.TenantMemberships.IgnoreQueryFilters()
                .Where(item => item.TenantId == tenant.Id && item.Status == MembershipStatus.Active)
                .GroupBy(item => item.Role)
                .ToDictionaryAsync(group => group.Key, group => group.Count());
            Assert.AreEqual(1, memberships[TenantRole.Owner]);
            Assert.AreEqual(2, memberships[TenantRole.Coach]);
            Assert.AreEqual(cast.Count, memberships[TenantRole.Client]);

            var clients = await db.ClientProfiles.IgnoreQueryFilters().Where(item => item.TenantId == tenant.Id).ToListAsync();
            Assert.HasCount(cast.Count, clients);
            Assert.IsTrue(clients.All(client => client.OnboardingStatus == ClientOnboardingStatus.Completed));
            Assert.AreEqual(2, await db.ClientInvitations.IgnoreQueryFilters()
                .CountAsync(item => item.TenantId == tenant.Id && item.Status == InvitationStatus.Pending));

            // Over two months of training, all finished, none of it in the future.
            var workouts = await db.WorkoutExecutions.IgnoreQueryFilters().Where(item => item.TenantId == tenant.Id).ToListAsync();
            Assert.IsGreaterThan(80, workouts.Count);
            Assert.IsTrue(workouts.All(item => item.Status == WorkoutExecutionStatus.Completed));
            Assert.IsTrue(workouts.All(item => item.CompletedAtUtc <= clock.Ceiling));
            Assert.IsLessThan(today.AddDays(-56), DateOnly.FromDateTime(workouts.Min(item => item.StartedAtUtc).UtcDateTime));

            var weighIns = await db.BodyweightObservations.IgnoreQueryFilters().Where(item => item.TenantId == tenant.Id).ToListAsync();
            Assert.IsGreaterThan(150, weighIns.Count);
            Assert.IsLessThan(today.AddDays(-56), weighIns.Min(item => item.MeasurementDate));

            // The states the coach screens need: plans ending soon, a pause, a renewal ask.
            var enrollments = await db.ClientEnrollments.IgnoreQueryFilters().Where(item => item.TenantId == tenant.Id).ToListAsync();
            Assert.AreEqual(1, enrollments.Count(item => item.Status == EnrollmentStatus.Paused));
            Assert.IsGreaterThanOrEqualTo(1, enrollments.Count(item =>
                item.Status == EnrollmentStatus.Active && item.EndDateExclusive > today && item.EndDateExclusive <= today.AddDays(14)));
            Assert.AreEqual(1, await db.RenewalRequests.IgnoreQueryFilters().CountAsync(item => item.TenantId == tenant.Id));

            // Check-ins: most reviewed, some waiting, and one client behind.
            var responses = await db.CheckInResponses.IgnoreQueryFilters().Where(item => item.TenantId == tenant.Id).ToListAsync();
            Assert.IsGreaterThanOrEqualTo(1, responses.Count(item => item.Status == CheckInResponseStatus.Submitted));
            Assert.IsGreaterThan(15, responses.Count(item => item.Status == CheckInResponseStatus.Reviewed));
            var jad = clients.Single(client => client.FirstName == "Jad");
            var answered = responses.Where(item => item.Status != CheckInResponseStatus.Draft).Select(item => item.AssignmentId).ToHashSet();
            Assert.IsTrue(await db.CheckInAssignments.IgnoreQueryFilters()
                .Where(item => item.ClientProfileId == jad.Id && item.DueDate < today)
                .AnyAsync(item => !answered.Contains(item.Id)));

            Assert.IsGreaterThan(40, await db.Messages.IgnoreQueryFilters().CountAsync(item => item.TenantId == tenant.Id));
            Assert.AreEqual(2, await db.ClientNutritionPlans.IgnoreQueryFilters()
                .CountAsync(item => item.TenantId == tenant.Id && item.Status == ClientNutritionPlanStatus.Active));
            Assert.AreEqual(2, await db.DailyNutritionLogs.IgnoreQueryFilters()
                .CountAsync(item => item.TenantId == tenant.Id && item.Date == today));
        }

        // What people see, through the same services and scoping the API uses.
        var requests = new DemoRequests(factory.Services);
        var people = await PeopleAsync(factory.Services);
        var omarClients = await requests.AsAsync<IClientProfileApplicationService, IReadOnlyList<ClientSummary>>(
            new DemoActor(people.OmarId, people.TenantId), service => service.ListAsync(CancellationToken.None));
        CollectionAssert.AreEquivalent(
            OmarsClients,
            omarClients.Select(client => client.FirstName).ToArray(),
            "A coach sees only their own clients.");
        var unread = await requests.AsAsync<IMessagingApplicationService, MessagingUnreadCount>(
            new DemoActor(people.OwnerId, people.TenantId), service => service.CountUnreadAsync(CancellationToken.None));
        Assert.IsGreaterThan(0, unread.Unread, "Sara's message this afternoon is still unread.");

        var mayaToday = await requests.AsAsync<ITrainingApplicationService, ClientTrainingDayResult>(
            new DemoActor(people.MayaId, people.TenantId), service => service.GetTodayAsync(CancellationToken.None));
        Assert.IsTrue(mayaToday.IsAllowed);
        var workout = mayaToday.Workouts.Single();
        Assert.AreEqual("Lower A", workout.Name, "The hero client has a workout waiting today.");
        Assert.IsNull(workout.Status);

        var mayaMeals = await requests.AsAsync<INutritionApplicationService, ClientNutritionDayView?>(
            new DemoActor(people.MayaId, people.TenantId),
            service => service.GetOwnDayAsync(today, CancellationToken.None));
        Assert.IsNotNull(mayaMeals);
        Assert.HasCount(4, mayaMeals.Slots);
        Assert.AreEqual(1, mayaMeals.Slots.Count(item => item.SelectedChoiceId is not null));
        Assert.AreEqual("Afternoon coffee", mayaMeals.CustomFoods.Single().Name);
        Assert.IsGreaterThan(0m, mayaMeals.SelectedCalories);

        using var again = new StringWriter();
        Assert.AreEqual(2, await DemoWorkspaceCommand.RunAsync(
            factory.Services, [DemoWorkspaceCommand.Name], again, cast, CancellationToken.None));
        Assert.Contains("already in this database", again.ToString());
    }

    private static async Task<(Guid TenantId, Guid OwnerId, Guid OmarId, Guid MayaId)> PeopleAsync(IServiceProvider services)
    {
        await using var scope = services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var tenantId = await db.Tenants.Where(item => item.Name == DemoWorkspaceCast.WorkspaceName).Select(item => item.Id).SingleAsync();
        var owner = await db.Users.SingleAsync(user => user.Email == DemoWorkspaceCast.Owner.Email);
        var omar = await db.Users.SingleAsync(user => user.Email == "omar@atlas.example");
        var heroEmail = DemoWorkspaceCast.Clients.Single(client => client.IsHero).Email;
        var maya = await db.Users.SingleAsync(user => user.Email == heroEmail);
        return (tenantId, owner.Id, omar.Id, maya.Id);
    }
}
