using Microsoft.EntityFrameworkCore;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.SharedKernel;

namespace TB.Gym.Api.IntegrationTests;

internal static class PostgreSqlTestEnvironment
{
    private const string AdminConnectionVariable = "TB_GYM_TEST_ADMIN_CONNECTION";
    private const string RequiredVariable = "TB_GYM_REQUIRE_POSTGRES_TESTS";

    // Replaying every migration into each test's empty database was the largest single cost of the
    // suite, about 12 s a test. The run migrates one template instead and each test starts from a
    // copy, so the API's own startup migration finds nothing left to apply. Tests of a migration
    // upgrade, or of startup against an unmigrated database, keep using an empty one.
    private static readonly SemaphoreSlim TemplateGate = new(1, 1);
    private static string? migratedTemplate;

    public static string RequireAdminConnection()
    {
        var connection = Environment.GetEnvironmentVariable(AdminConnectionVariable);
        if (!string.IsNullOrWhiteSpace(connection))
        {
            return connection;
        }

        Unavailable($"{AdminConnectionVariable} is not configured.");
        throw new InvalidOperationException("Unreachable PostgreSQL test gate.");
    }

    public static void Unavailable(string reason)
    {
        var required = string.Equals(
            Environment.GetEnvironmentVariable(RequiredVariable),
            "true",
            StringComparison.OrdinalIgnoreCase);
        if (required)
        {
            Assert.Fail($"Required PostgreSQL integration tests cannot run: {reason}");
        }

        Assert.Inconclusive($"PostgreSQL integration test skipped: {reason}");
    }

    /// <summary>An empty database, for tests that migrate it themselves or must find it unmigrated.</summary>
    public static Task<string> CreateDatabaseAsync(string prefix) => CreateDatabaseAsync(prefix, template: null);

    /// <summary>A database already at the latest migration, copied from this run's template.</summary>
    public static async Task<string> CreateMigratedDatabaseAsync(string prefix) =>
        await CreateDatabaseAsync(prefix, await EnsureMigratedTemplateAsync());

    public static async Task DropMigratedTemplateAsync()
    {
        if (migratedTemplate is null)
        {
            return;
        }

        await DropDatabaseAsync(migratedTemplate);
        migratedTemplate = null;
    }

    private static async Task<string> CreateDatabaseAsync(string prefix, string? template)
    {
        var adminConnection = RequireAdminConnection();
        var databaseName = $"{prefix}_{Guid.NewGuid():N}";
        try
        {
            await using var connection = new NpgsqlConnection(adminConnection);
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = template is null
                ? $"CREATE DATABASE \"{databaseName}\""
                : $"CREATE DATABASE \"{databaseName}\" TEMPLATE \"{template}\"";
            await command.ExecuteNonQueryAsync();
            return databaseName;
        }
        catch (NpgsqlException exception)
        {
            Unavailable(exception.Message);
            throw new InvalidOperationException("Unreachable PostgreSQL test gate.", exception);
        }
    }

    private static async Task<string> EnsureMigratedTemplateAsync()
    {
        await TemplateGate.WaitAsync();
        try
        {
            if (migratedTemplate is not null)
            {
                return migratedTemplate;
            }

            var template = await CreateDatabaseAsync("tbgym_template", template: null);
            try
            {
                // Unpooled, so no idle connection is left on the template: PostgreSQL refuses to copy
                // a database that anyone is still connected to.
                var connection = new NpgsqlConnectionStringBuilder(RequireAdminConnection())
                {
                    Database = template,
                    Pooling = false,
                }.ConnectionString;
                var options = new DbContextOptionsBuilder<GymDbContext>()
                    .UseNpgsql(connection, npgsql => npgsql.MigrationsHistoryTable("__EFMigrationsHistory", "platform"))
                    .Options;
                await using var context = new GymDbContext(
                    options,
                    new TemplateClock(),
                    new TemplateCurrentUser(),
                    new TemplateTenantContext());
                await context.Database.MigrateAsync();
            }
            catch
            {
                await DropDatabaseAsync(template);
                throw;
            }

            migratedTemplate = template;
            return template;
        }
        finally
        {
            TemplateGate.Release();
        }
    }

    private static async Task DropDatabaseAsync(string databaseName)
    {
        await using var connection = new NpgsqlConnection(RequireAdminConnection());
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = $"DROP DATABASE IF EXISTS \"{databaseName}\" WITH (FORCE)";
        await command.ExecuteNonQueryAsync();
    }

    // Migrations write no rows through these; GymDbContext only needs them to be constructed.
    private sealed class TemplateClock : IClock
    {
        public DateTimeOffset UtcNow => DateTimeOffset.UtcNow;
    }

    private sealed class TemplateCurrentUser : ICurrentUser
    {
        public Guid? UserId => null;

        public bool IsAuthenticated => false;
    }

    private sealed class TemplateTenantContext : IMutableTenantContext
    {
        public Guid TenantId { get; private set; }

        public bool HasTenant => TenantId != Guid.Empty;

        public void SetTenant(Guid tenantId) => TenantId = tenantId;
    }
}

[TestClass]
public sealed class PostgreSqlTestRun
{
    [AssemblyCleanup]
    public static Task DropMigratedTemplateAsync() => PostgreSqlTestEnvironment.DropMigratedTemplateAsync();
}
