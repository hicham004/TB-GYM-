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
    /// These seven still reach every path: the hero's workout today and session pack, renewals and a
    /// renewal request, a pause, an overdue and a waiting check-in, a plan ending soon and a client with
    /// no program.
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
        // Pooled even when the admin connection is not: the demo makes tens of thousands of queries,
        // and opening a new server process for each one took this test from minutes to over half an
        // hour in a full run. Cleanup clears the pools before it drops the database.
        var connection = new NpgsqlConnectionStringBuilder(adminConnection)
        {
            Database = databaseName,
            Pooling = true,
        }.ConnectionString;
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
        var cast = DemoWorkspaceCast.Atlas.Clients.Where(client => CastForTheTest.Contains(client.Key)).ToList();
        var demo = DemoWorkspaceCast.Atlas.WithClients(cast);

        var exitCode = await DemoWorkspaceCommand.RunAsync(
            factory.Services, DemoWorkspaceCommand.DefaultPassword, output, demo, CancellationToken.None);

        Assert.AreEqual(0, exitCode, output.ToString());
        Assert.Contains("Atlas Performance is ready.", output.ToString());
        var clock = factory.Services.GetRequiredService<DemoClock>();
        var today = new DemoCalendar(clock.Ceiling, DemoWorkspaceCast.TimeZoneId).Today;
        Guid mayaProfileId;

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

            // One 10-session pack, sold to Maya beside her coaching plan and paid in full, with a few sessions held,
            // the last of them today, so This month always has one to count (critique B17).
            var pack = enrollments.Single(item => item.IsSessionPack);
            var maya = clients.Single(client => client.FirstName == "Maya");
            Assert.AreEqual(
                (maya.Id, 10, EnrollmentStatus.Active, today.AddDays(-20), today.AddDays(70)),
                (pack.ClientProfileId, pack.SessionCountSnapshot, pack.Status, pack.StartDate, pack.EndDateExclusive));
            Assert.AreEqual(2, enrollments.Count(item => item.ClientProfileId == maya.Id), "Her coaching plan and the pack.");
            Assert.AreEqual(pack.PriceAmount, await db.PaymentRecords.IgnoreQueryFilters()
                .Where(item => item.EnrollmentId == pack.Id).SumAsync(item => item.Amount));
            var ledger = await db.SessionLedgerEntries.IgnoreQueryFilters().Where(item => item.EnrollmentId == pack.Id).ToListAsync();
            Assert.AreEqual(6, SessionLedger.Balance(ledger));
            CollectionAssert.AreEqual(
                new[] { today.AddDays(-19), today.AddDays(-12), today.AddDays(-5), today },
                ledger.Where(item => item.Kind == SessionEntryKind.Held).OrderBy(item => item.Day).Select(item => item.Day).ToArray());

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

            // Development works energy out with version 2 (critique B8b): both demo targets come from the new table, at a
            // desk with four workouts a week, and from Mifflin-St Jeor, so no example shows 1.80 or Harris-Benedict.
            var targets = await db.NutritionCalculationSnapshots.IgnoreQueryFilters()
                .Where(item => item.TenantId == tenant.Id).ToListAsync();
            Assert.HasCount(2, targets);
            Assert.IsTrue(targets.All(item =>
                (item.BmrMethodKey, item.ActivityModelKey, item.ActivityModelVersion, item.ActivityModelPal) ==
                (MifflinStJeorBmrStrategy.Key, OccupationStepsActivityModelVersion2.Key, OccupationStepsActivityModelVersion2.Version, 1.58m)));
            mayaProfileId = clients.Single(client => client.FirstName == "Maya").Id;
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

        // The demo's one last time + step lift (notes plan N6a): the leg curl steps by 2.5 kg from no starting
        // weight, so Maya picks hers, and nothing else in the workout steps.
        var curl = workout.Exercises.Single(item => item.PrescribedExerciseName == "Seated Leg Curl");
        Assert.IsNotEmpty(curl.Sets);
        Assert.IsTrue(curl.Sets.All(set =>
            set.LoadStrategy == TrainingLoadStrategy.LastTimeStep && set.LoadStep == 2.5m && set.PrescribedLoad is null));
        Assert.IsTrue(workout.Exercises.Where(item => item != curl).SelectMany(item => item.Sets)
            .All(set => set.LoadStrategy != TrainingLoadStrategy.LastTimeStep && set.LoadStep is null));

        var mayaMeals = await requests.AsAsync<INutritionApplicationService, ClientNutritionDayView?>(
            new DemoActor(people.MayaId, people.TenantId),
            service => service.GetOwnDayAsync(today, CancellationToken.None));
        Assert.IsNotNull(mayaMeals);
        Assert.HasCount(4, mayaMeals.Slots);
        Assert.AreEqual(1, mayaMeals.Slots.Count(item => item.SelectedChoiceId is not null));
        Assert.AreEqual("Afternoon coffee", mayaMeals.CustomFoods.Single().Name);
        Assert.IsGreaterThan(0m, mayaMeals.SelectedCalories);

        // The owner reads Maya's targets with the words beside the multiplier and what her steps are worth.
        var mayaTargets = await requests.AsAsync<INutritionApplicationService, ClientNutritionRead<NutritionCalculationRecord[]>>(
            new DemoActor(people.OwnerId, people.TenantId),
            service => service.ListCalculationsAsync(mayaProfileId, 1, CancellationToken.None));
        var mayaLatest = mayaTargets.Value!.Single().Result;
        Assert.AreEqual(
            "Counts as low active: × 1.58 (seated work with 7,000 steps a day × 1.50, plus 4 workouts a week + 0.08)",
            mayaLatest.Activity?.Words);
        Assert.AreEqual("Their 7,000 steps are inside that, worth about 180 calories a day at 68 kg.", mayaLatest.Walking?.Words);

        // Jad's check-in from last week is overdue (CHK-015): Omar, his coach, reminds him in their chat; the owner,
        // who may not message another coach's client, is not offered it (critique B4a).
        var omarToday = await requests.AsAsync<ICoachOverviewService, CoachTodayView>(
            new DemoActor(people.OmarId, people.TenantId), service => service.GetTodayAsync(CancellationToken.None));
        var ownerToday = await requests.AsAsync<ICoachOverviewService, CoachTodayView>(
            new DemoActor(people.OwnerId, people.TenantId), service => service.GetTodayAsync(CancellationToken.None));
        var overdue = omarToday.Attention.Single(item => item.Kind == CoachAttentionKind.CheckInOverdue);
        Assert.AreEqual(("Jad", true, 1), (overdue.Client.FirstName, overdue.CanMessage, overdue.Count));
        Assert.IsNotNull(overdue.SubjectId, "Remind opens Omar's chat with Jad.");
        Assert.IsTrue(overdue.Date <= today.AddDays(-CheckInAttentionPolicy.OverdueAfterDays), $"Due {overdue.Date}.");
        var ownersItem = ownerToday.Attention.Single(item => item.Kind == CoachAttentionKind.CheckInOverdue);
        Assert.AreEqual(
            (overdue.Client.ClientProfileId, overdue.Date, false, (Guid?)null),
            (ownersItem.Client.ClientProfileId, ownersItem.Date, ownersItem.CanMessage, ownersItem.SubjectId));

        // The sessions screens have something to show (critique B17): Lea's row and Today, her month and the owner's
        // line for her, and what Maya reads. Nineteen days back is this month or the last, whatever day this runs.
        var lea = new DemoActor(people.LeaId, people.TenantId);
        var leaClients = await requests.AsAsync<ICoachOverviewService, ClientOverviewView>(
            lea, service => service.ListAsync(CancellationToken.None));
        Assert.AreEqual(6, leaClients.Clients.Single(row => row.Client.FirstName == "Maya").SessionsLeft);
        var leaToday = await requests.AsAsync<ICoachOverviewService, CoachTodayView>(
            lea, service => service.GetTodayAsync(CancellationToken.None));
        Assert.IsGreaterThanOrEqualTo(1, leaToday.Month.SessionsHeld ?? 0);
        Assert.DoesNotContain(
            CoachAttentionKind.SessionsRunningOut,
            leaToday.Attention.Select(item => item.Kind).ToArray(),
            "A pack with six left is not running out.");
        var leaMonth = await requests.AsAsync<ICoachMonthService, CoachMonthReportView>(
            lea, service => service.GetAsync(CancellationToken.None));
        Assert.AreEqual(4, leaMonth.ThisMonth.SessionsHeld + leaMonth.LastMonth.SessionsHeld);
        Assert.AreEqual(1, leaMonth.ThisMonth.PacksSold + leaMonth.LastMonth.PacksSold);
        var ownerMonth = await requests.AsAsync<ICoachMonthService, CoachMonthReportView>(
            new DemoActor(people.OwnerId, people.TenantId), service => service.GetAsync(CancellationToken.None));
        var leaRow = ownerMonth.Coaches!.Single(row => row.Name == "Lea Khoury");
        Assert.AreEqual(
            (leaMonth.ThisMonth.SessionsHeld, leaMonth.LastMonth.SessionsHeld),
            (leaRow.ThisMonth.SessionsHeld, leaRow.LastMonth.SessionsHeld));
        var mayaPlans = await requests.AsAsync<ICommercialApplicationService, OwnPlansView?>(
            new DemoActor(people.MayaId, people.TenantId), service => service.GetOwnPlansAsync(CancellationToken.None));
        var mayaPack = mayaPlans!.Plans.Single(plan => plan.Sessions is not null);
        Assert.AreEqual(
            ("Personal Training", "10 sessions", 10, 6, 4),
            (mayaPack.Name, mayaPack.OptionLabel, mayaPack.Sessions!.Count, mayaPack.Sessions.Left, mayaPack.Sessions.Sessions.Count));

        // TB Gym's own coaching space beside it (notes plan N9a2): marked as the house, with its owner and its coach,
        // nobody signed up and no setting written, so its sign-up is closed.
        Assert.Contains($"{DemoWorkspaceCast.HouseName} is the house", output.ToString());
        Assert.Contains(DemoWorkspaceCast.HouseCoach.Email, output.ToString());
        Guid houseId;
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GymDbContext>();
            var house = await db.Tenants.SingleAsync(item => item.IsHouse);
            houseId = house.Id;
            Assert.AreEqual(
                (DemoWorkspaceCast.HouseName, DemoWorkspaceCast.TimeZoneId, DayOfWeek.Monday),
                (house.Name, house.TimeZoneId, house.WeekStartsOn));
            var houseRoles = await db.TenantMemberships.IgnoreQueryFilters()
                .Where(item => item.TenantId == house.Id && item.Status == MembershipStatus.Active)
                .GroupBy(item => item.Role)
                .ToDictionaryAsync(group => group.Key, group => group.Count());
            Assert.HasCount(2, houseRoles);
            Assert.AreEqual((1, 1), (houseRoles[TenantRole.Owner], houseRoles[TenantRole.Coach]));
            Assert.AreEqual(0, await db.ClientProfiles.IgnoreQueryFilters().CountAsync(item => item.TenantId == house.Id));
            Assert.AreEqual(0, await db.HouseSettingChanges.IgnoreQueryFilters().CountAsync());
            Assert.AreEqual(0, await db.TraineeSignUps.IgnoreQueryFilters().CountAsync());

            // Marking the house made its Free plan (notes plan N9b1, SUB-019): one plan with one option, booked by nobody.
            var housePlan = await db.CoachingProducts.IgnoreQueryFilters().SingleAsync(item => item.TenantId == house.Id);
            Assert.AreEqual(
                ("Free", (HouseTier?)HouseTier.Free, true),
                (housePlan.Name, housePlan.HouseTier, housePlan.IsActive));
            var houseOption = await db.ProductOffers.IgnoreQueryFilters().SingleAsync(item => item.TenantId == house.Id);
            Assert.AreEqual(
                (housePlan.Id, 0m, 365, OfferDurationUnit.Day, true),
                (houseOption.ProductId, houseOption.PriceAmount, houseOption.DurationCount, houseOption.DurationUnit, houseOption.IsActive));
            Assert.AreEqual(0, await db.ClientEnrollments.IgnoreQueryFilters().CountAsync(item => item.TenantId == house.Id));
        }

        var signUp = await requests.AsAsync<ITraineeSignUpService, TraineeSignUpStatusView>(
            DemoActor.Anonymous, service => service.GetStatusAsync(CancellationToken.None));
        Assert.AreEqual(TraineeSignUpStatus.Closed, signUp.Status);

        using var again = new StringWriter();
        Assert.AreEqual(2, await DemoWorkspaceCommand.RunAsync(
            factory.Services, DemoWorkspaceCommand.DefaultPassword, again, demo, CancellationToken.None));
        Assert.Contains("already in this database", again.ToString());

        // The other cast built into the same database leaves the one house as it was. Lynn alone, who has no
        // program, keeps the second build short.
        var lynnOnly = DemoWorkspaceCast.Sample.WithClients(
            [.. DemoWorkspaceCast.Sample.Clients.Where(client => client.Key == "lynn")]);
        using var second = new StringWriter();
        Assert.AreEqual(0, await DemoWorkspaceCommand.RunAsync(
            factory.Services, DemoWorkspaceCommand.DefaultPassword, second, lynnOnly, CancellationToken.None), second.ToString());
        Assert.Contains("This database already had a house, which is left as it was.", second.ToString());
        await using (var scope = factory.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<GymDbContext>();
            Assert.AreEqual(houseId, (await db.Tenants.SingleAsync(item => item.IsHouse)).Id);
            var houseRoles = await db.TenantMemberships.IgnoreQueryFilters()
                .Where(item => item.TenantId == houseId && item.Status == MembershipStatus.Active)
                .GroupBy(item => item.Role)
                .ToDictionaryAsync(group => group.Key, group => group.Count());
            Assert.AreEqual((2, 1, 1), (houseRoles.Count, houseRoles[TenantRole.Owner], houseRoles[TenantRole.Coach]));
            Assert.AreEqual(1, await db.CoachingProducts.IgnoreQueryFilters().CountAsync(item => item.TenantId == houseId));
            Assert.AreEqual(1, await db.Tenants.CountAsync(item => item.Name == lynnOnly.WorkspaceName));
        }
    }

    private static async Task<(Guid TenantId, Guid OwnerId, Guid OmarId, Guid LeaId, Guid MayaId)> PeopleAsync(IServiceProvider services)
    {
        await using var scope = services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var tenantId = await db.Tenants.Where(item => item.Name == DemoWorkspaceCast.WorkspaceName).Select(item => item.Id).SingleAsync();
        var owner = await db.Users.SingleAsync(user => user.Email == DemoWorkspaceCast.Atlas.Owner.Email);
        var omar = await db.Users.SingleAsync(user => user.Email == "omar@atlas.example");
        var lea = await db.Users.SingleAsync(user => user.Email == "lea@atlas.example");
        var heroEmail = DemoWorkspaceCast.Atlas.Clients.Single(client => client.IsHero).Email;
        var maya = await db.Users.SingleAsync(user => user.Email == heroEmail);
        return (tenantId, owner.Id, omar.Id, lea.Id, maya.Id);
    }
}
