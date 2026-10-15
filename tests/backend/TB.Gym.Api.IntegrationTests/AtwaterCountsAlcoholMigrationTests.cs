using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.SharedKernel;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// C7 against a database that already holds workspaces: a workspace on Atwater 1.0 names Atwater 2.0
/// afterwards, since that is what its foods and recipes are counted with from then on, and a workspace
/// on EU 1169 keeps its own version.
/// </summary>
[TestClass]
public sealed class AtwaterCountsAlcoholMigrationTests
{
    private const string MigrationBefore = "TalkToUsContactRequests";

    private static readonly Guid AtwaterTenantId = Guid.Parse("71111111-1111-1111-1111-111111111111");
    private static readonly Guid EuTenantId = Guid.Parse("72222222-2222-2222-2222-222222222222");

    private string? adminConnection;
    private string? databaseName;
    private string? databaseConnection;

    [TestInitialize]
    public async Task InitializeAsync()
    {
        adminConnection = PostgreSqlTestEnvironment.RequireAdminConnection();
        databaseName = await PostgreSqlTestEnvironment.CreateDatabaseAsync("tbgym_c7mig");
        databaseConnection = new NpgsqlConnectionStringBuilder(adminConnection)
        {
            Database = databaseName,
        }.ConnectionString;
    }

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
    public async Task AtwaterWorkspacesMoveToVersionTwoAndEuWorkspacesStay()
    {
        await MigrateToAsync(MigrationBefore);
        await ExecuteAsync(
            """
            INSERT INTO tenancy."Tenants"
                ("Id", "Name", "Slug", "TimeZoneId", "DefaultCulture", "DefaultCurrencyCode",
                 "WeekStartsOn", "IsActive")
            VALUES (@atwater, 'Atwater Gym', 'atwater-gym', 'Asia/Beirut', 'en-LB', 'USD', 'Monday', TRUE),
                   (@eu, 'EU Gym', 'eu-gym', 'Asia/Beirut', 'en-LB', 'USD', 'Monday', TRUE);

            INSERT INTO nutrition."WorkspaceSettings"
                ("Id", "TenantId", "EnergyPolicyKey", "EnergyPolicyVersion", "ProviderCalorieTolerance",
                 "AiMonthlyRequestLimit", "AiMonthlyCostLimit", "AiCostCurrency")
            VALUES (gen_random_uuid(), @atwater, 'Atwater', '1.0', 25, 0, 0, 'USD'),
                   (gen_random_uuid(), @eu, 'Eu1169', '1.0', 25, 0, 0, 'USD');
            """);

        await MigrateToAsync(null);
        Assert.AreEqual("2.0", await VersionOfAsync(AtwaterTenantId));
        Assert.AreEqual("1.0", await VersionOfAsync(EuTenantId));

        // Down puts the Atwater workspace back on the version it had.
        await MigrateToAsync(MigrationBefore);
        Assert.AreEqual("1.0", await VersionOfAsync(AtwaterTenantId));
        Assert.AreEqual("1.0", await VersionOfAsync(EuTenantId));
    }

    private async Task MigrateToAsync(string? migration)
    {
        var options = new DbContextOptionsBuilder<GymDbContext>()
            .UseNpgsql(databaseConnection, npgsql => npgsql.MigrationsHistoryTable("__EFMigrationsHistory", "platform"))
            .Options;
        await using var context = new GymDbContext(options, new FixedClock(), new NoUser(), new NoTenant());
        await context.Database.GetInfrastructure().GetRequiredService<IMigrator>().MigrateAsync(migration);
    }

    private async Task ExecuteAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(databaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.Parameters.AddWithValue("atwater", AtwaterTenantId);
        command.Parameters.AddWithValue("eu", EuTenantId);
        await command.ExecuteNonQueryAsync();
    }

    private async Task<string?> VersionOfAsync(Guid tenantId)
    {
        await using var connection = new NpgsqlConnection(databaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """SELECT "EnergyPolicyVersion" FROM nutrition."WorkspaceSettings" WHERE "TenantId" = @tenant;""";
        command.Parameters.AddWithValue("tenant", tenantId);
        return await command.ExecuteScalarAsync() as string;
    }

    private sealed class NoTenant : IMutableTenantContext
    {
        public Guid TenantId { get; private set; }

        public bool HasTenant => TenantId != Guid.Empty;

        public void SetTenant(Guid tenantId) => TenantId = tenantId;
    }

    private sealed class NoUser : ICurrentUser
    {
        public Guid? UserId => null;

        public bool IsAuthenticated => false;
    }

    private sealed class FixedClock : IClock
    {
        public DateTimeOffset UtcNow => new(2026, 10, 15, 12, 0, 0, TimeSpan.Zero);
    }
}
