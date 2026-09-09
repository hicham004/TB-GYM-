using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.SharedKernel;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The Phase 6B-4C follow-up migrations against a database that already has reconciliation history.
/// </summary>
/// <remarks>
/// Both follow-up migrations add a column with a default and then a constraint that relates it to a
/// column that already has data — the failure total to the failure count, and the resolution flag to
/// the completed state. A default cannot satisfy either relation for rows that already exist, so on
/// an empty database both migrations pass and on a real one the constraint is refused and the upgrade
/// stops with the schema half applied. That is precisely the shape of defect that only a seeded
/// upgrade finds, because every test that starts from nothing agrees the migration is fine.
/// <para>
/// So the seed is the reconciliation history a real deployment would be carrying at this point: a run
/// still going that has failed a page, a run that failed outright with its budget spent, one that was
/// abandoned, and one that completed cleanly under the previous rules.
/// </para>
/// </remarks>
[TestClass]
public sealed class Phase6B4CInventoryMigrationUpgradeTests
{
    /// <summary>The migration that created the reconciliation tables, before either follow-up.</summary>
    private const string MigrationBeforeFollowUps = "Phase6B4CMediaInventoryReconciliation";

    private const string Location = "r2-eu-v1";

    private static readonly Guid RunningWithFailuresId = Guid.Parse("51111111-1111-1111-1111-111111111101");
    private static readonly Guid FailedId = Guid.Parse("51111111-1111-1111-1111-111111111102");
    private static readonly Guid AbandonedId = Guid.Parse("51111111-1111-1111-1111-111111111103");
    private static readonly Guid CompletedId = Guid.Parse("51111111-1111-1111-1111-111111111104");

    private static readonly DateTimeOffset SeededAtUtc = new(2026, 9, 8, 20, 0, 0, TimeSpan.Zero);

    private string? adminConnection;
    private string? databaseName;
    private string? databaseConnection;

    public TestContext TestContext { get; set; } = null!;

    [TestInitialize]
    public async Task InitializeAsync()
    {
        adminConnection = PostgreSqlTestEnvironment.RequireAdminConnection();
        databaseName = await PostgreSqlTestEnvironment.CreateDatabaseAsync("tbgym_p6b4cmig");
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
    public async Task TheFollowUpMigrationsUpgradeADatabaseThatAlreadyHasFailedAndCompletedRuns()
    {
        await MigrateToAsync(MigrationBeforeFollowUps);
        await SeedReconciliationHistoryAsync();

        // The upgrade itself is the assertion: a constraint the existing rows cannot satisfy makes
        // this throw, and the schema is then left half applied.
        await MigrateToLatestAsync();

        Assert.AreEqual(
            1,
            await ScalarAsync(
                """
                SELECT count(*) FROM platform."__EFMigrationsHistory"
                WHERE "MigrationId" LIKE '%Phase6B4CFollowUpInventoryFailureRecovery'
                """),
            "The failure-recovery migration did not apply.");
        Assert.AreEqual(
            1,
            await ScalarAsync(
                """
                SELECT count(*) FROM platform."__EFMigrationsHistory"
                WHERE "MigrationId" LIKE '%Phase6B4CFollowUpBoundedFindingResolution'
                """),
            "The bounded-resolution migration did not apply.");

        // The total is the history of the count, so a run that had failed twice is carried forward
        // saying so rather than being reset to a number smaller than what it already recorded.
        Assert.AreEqual(2, await TotalFailuresAsync(RunningWithFailuresId));
        Assert.AreEqual(2, await FailureCountAsync(RunningWithFailuresId));
        Assert.AreEqual(3, await TotalFailuresAsync(FailedId));
        Assert.AreEqual(3, await FailureCountAsync(FailedId));
        Assert.AreEqual(1, await TotalFailuresAsync(AbandonedId));
        Assert.AreEqual(0, await TotalFailuresAsync(CompletedId));
        Assert.AreEqual(
            0,
            await ScalarAsync(
                """
                SELECT count(*) FROM media."InventoryRuns"
                WHERE "TotalPageFailureCount" < "PageFailureCount"
                """),
            "A run came out of the upgrade with a total smaller than the count it supersedes.");

        // A run that completed under the previous rules had already closed everything it was going
        // to, so it satisfies the completion evidence the new constraint demands.
        Assert.AreEqual(1, await ResolutionCompletedAsync(CompletedId));
        Assert.AreEqual(0, await ResolutionCompletedAsync(RunningWithFailuresId));
        Assert.AreEqual(0, await ResolutionCompletedAsync(AbandonedId));
        Assert.AreEqual(
            0,
            await ScalarAsync(
                """
                SELECT count(*) FROM media."InventoryRuns"
                WHERE "State" = 'Completed' AND NOT "ResolutionCompleted"
                """),
            "A completed run survived the upgrade without the evidence its state now requires.");

        // Every seeded run is still there, in the state it was in.
        Assert.AreEqual(4, await ScalarAsync("SELECT count(*) FROM media.\"InventoryRuns\""));
        Assert.AreEqual("Running", await StateAsync(RunningWithFailuresId));
        Assert.AreEqual("Failed", await StateAsync(FailedId));
        Assert.AreEqual("Abandoned", await StateAsync(AbandonedId));
        Assert.AreEqual("Completed", await StateAsync(CompletedId));

        // And the constraints the upgrade added are actually there, refusing what they are for.
        await AssertRefusedAsync(
            $"""
            UPDATE media."InventoryRuns"
            SET "TotalPageFailureCount" = 0
            WHERE "Id" = '{FailedId}'
            """,
            "A total below the count it supersedes was accepted.");
        await AssertRefusedAsync(
            $"""
            UPDATE media."InventoryRuns"
            SET "ResolutionCompleted" = FALSE
            WHERE "Id" = '{CompletedId}'
            """,
            "A completed run was allowed to say it had not finished resolving.");
    }

    /// <summary>
    /// The reconciliation history a deployment running the first cut would be carrying: a run in
    /// every state the previous migration could produce, and failure counts that are not zero.
    /// </summary>
    private async Task SeedReconciliationHistoryAsync()
    {
        await InsertRunAsync(RunningWithFailuresId, "Running", pageFailureCount: 2, completed: false);
        await InsertRunAsync(FailedId, "Failed", pageFailureCount: 3, completed: false);
        await InsertRunAsync(AbandonedId, "Abandoned", pageFailureCount: 1, completed: false);
        await InsertRunAsync(CompletedId, "Completed", pageFailureCount: 0, completed: true);

        Assert.AreEqual(
            0,
            await ScalarAsync(
                """
                SELECT count(*) FROM information_schema.columns
                WHERE table_schema = 'media' AND table_name = 'InventoryRuns'
                  AND column_name IN ('TotalPageFailureCount', 'ResolutionCompleted')
                """),
            "The seed was written against a schema that already had the follow-up columns.");
    }

    private Task InsertRunAsync(Guid id, string state, int pageFailureCount, bool completed) =>
        ExecuteAsync(
            """
            INSERT INTO media."InventoryRuns"
                ("Id", "Location", "State", "StartedAtUtc", "LastProgressAtUtc",
                 "InventoryCompleted", "ProbeStage", "ObjectsScanned", "ObjectsSkippedRecent",
                 "ObjectsSkippedOwnedByPurge", "UnattributableKeyCount", "OwnersProbed",
                 "OwnersSkippedNotReconciled", "OwnersSkippedOwnedByPurge", "FindingsOpened",
                 "FindingsResolved", "PageFailureCount", "LastFailureCode", "CompletedAtUtc",
                 "CreatedAtUtc", "UpdatedAtUtc")
            VALUES (@id, @location, @state, @now, @now,
                    @inventoryCompleted, @probeStage, 12, 0,
                    0, 0, 5,
                    0, 0, 3,
                    0, @pageFailureCount, @failureCode, @completedAt,
                    @now, @now)
            """,
            ("id", id),
            ("location", Location),
            ("state", state),
            ("now", SeededAtUtc),
            ("inventoryCompleted", completed),
            ("probeStage", completed ? "Completed" : "Assets"),
            ("pageFailureCount", pageFailureCount),
            ("failureCode", pageFailureCount > 0 ? "storage_provider_unavailable" : (object)DBNull.Value),
            ("completedAt", completed ? SeededAtUtc : (object)DBNull.Value));

    private Task<long> TotalFailuresAsync(Guid id) => ScalarAsync(
        "SELECT \"TotalPageFailureCount\" FROM media.\"InventoryRuns\" WHERE \"Id\" = @id",
        ("id", id));

    private Task<long> FailureCountAsync(Guid id) => ScalarAsync(
        "SELECT \"PageFailureCount\" FROM media.\"InventoryRuns\" WHERE \"Id\" = @id",
        ("id", id));

    private Task<long> ResolutionCompletedAsync(Guid id) => ScalarAsync(
        "SELECT \"ResolutionCompleted\"::int FROM media.\"InventoryRuns\" WHERE \"Id\" = @id",
        ("id", id));

    private async Task<string> StateAsync(Guid id)
    {
        await using var connection = new NpgsqlConnection(databaseConnection);
        await connection.OpenAsync(TestContext.CancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT \"State\" FROM media.\"InventoryRuns\" WHERE \"Id\" = @id";
        command.Parameters.AddWithValue("id", id);
        return (string)(await command.ExecuteScalarAsync(TestContext.CancellationToken))!;
    }

    private async Task AssertRefusedAsync(string sql, string message)
    {
        var refusal = await Assert.ThrowsExactlyAsync<PostgresException>(() => ExecuteAsync(sql));
        Assert.AreEqual("23514", refusal.SqlState, message);
    }

    private async Task MigrateToAsync(string migration)
    {
        await using var context = CreateContext();
        await context.Database.GetInfrastructure()
            .GetRequiredService<IMigrator>()
            .MigrateAsync(migration);
    }

    private async Task MigrateToLatestAsync()
    {
        await using var context = CreateContext();
        await context.Database.MigrateAsync();
    }

    private GymDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<GymDbContext>()
            .UseNpgsql(
                databaseConnection,
                npgsql => npgsql.MigrationsHistoryTable("__EFMigrationsHistory", "platform"))
            .Options;
        return new GymDbContext(
            options,
            new MigrationUpgradeClock(),
            new MigrationUpgradeCurrentUser(),
            new MigrationUpgradeTenantContext());
    }

    private async Task ExecuteAsync(string sql, params (string Name, object Value)[] parameters)
    {
        await using var connection = new NpgsqlConnection(databaseConnection);
        await connection.OpenAsync(TestContext.CancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        foreach (var (name, value) in parameters)
        {
            command.Parameters.AddWithValue(name, value);
        }

        await command.ExecuteNonQueryAsync(TestContext.CancellationToken);
    }

    private async Task<long> ScalarAsync(string sql, params (string Name, object Value)[] parameters)
    {
        await using var connection = new NpgsqlConnection(databaseConnection);
        await connection.OpenAsync(TestContext.CancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        foreach (var (name, value) in parameters)
        {
            command.Parameters.AddWithValue(name, value);
        }

        return Convert.ToInt64(
            await command.ExecuteScalarAsync(TestContext.CancellationToken),
            CultureInfo.InvariantCulture);
    }

    private sealed class MigrationUpgradeClock : IClock
    {
        public DateTimeOffset UtcNow => SeededAtUtc;
    }

    private sealed class MigrationUpgradeCurrentUser : ICurrentUser
    {
        public bool IsAuthenticated => false;

        public Guid? UserId => null;
    }

    private sealed class MigrationUpgradeTenantContext : ITenantContext
    {
        public bool HasTenant => false;

        public Guid TenantId => Guid.Empty;
    }
}
