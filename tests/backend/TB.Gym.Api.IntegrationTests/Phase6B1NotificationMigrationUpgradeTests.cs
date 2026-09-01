using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.SharedKernel;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Proves the Phase 6B-1 migration against the four outbox states that already existed in Phase 2.
/// </summary>
[TestClass]
public sealed class Phase6B1NotificationMigrationUpgradeTests
{
    private const string MigrationBeforeDispatch = "Phase6FinalHardening";
    private static readonly Guid RecipientUserId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid TenantId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly DateTimeOffset ScheduledAtUtc = new(2026, 8, 30, 9, 0, 0, TimeSpan.Zero);

    private string? adminConnection;
    private string? databaseName;
    private string? databaseConnection;

    [TestInitialize]
    public async Task InitializeAsync()
    {
        adminConnection = PostgreSqlTestEnvironment.RequireAdminConnection();
        databaseName = await PostgreSqlTestEnvironment.CreateDatabaseAsync("tbgym_p6b1mig");
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
    public async Task ExistingPhase2StatesBackfillWithoutLosingStatusOrHistory()
    {
        await using (var beforeUpgrade = CreateContext())
        {
            await beforeUpgrade.Database.GetInfrastructure()
                .GetRequiredService<IMigrator>()
                .MigrateAsync(MigrationBeforeDispatch);
        }

        await ExecuteAsync(
            """
            INSERT INTO identity."Users"
                ("Id", "DisplayName", "IsPlatformBlocked", "EmailConfirmed", "PhoneNumberConfirmed",
                 "TwoFactorEnabled", "LockoutEnabled", "AccessFailedCount")
            VALUES (@userId, 'Legacy Recipient', FALSE, TRUE, FALSE, FALSE, TRUE, 0);

            INSERT INTO notifications."OutboxItems"
                ("Id", "TenantId", "RecipientUserId", "AggregateId", "Kind", "DeduplicationKey",
                 "PayloadJson", "ScheduledAtUtc", "TenantTimeZoneId", "Status", "AttemptCount",
                 "DispatchedAtUtc", "FailureCode")
            VALUES
                (@pendingId, @tenantId, @userId, @pendingAggregate, 'PaymentRequired', 'legacy:pending',
                 '{}'::jsonb, @scheduled, 'Asia/Beirut', 'Pending', 0, NULL, NULL),
                (@failedId, @tenantId, @userId, @failedAggregate, 'PaymentRequired', 'legacy:failed',
                 '{}'::jsonb, @scheduled, 'Asia/Beirut', 'Failed', 2, NULL, 'legacy-transient'),
                (@cancelledId, @tenantId, @userId, @cancelledAggregate, 'PaymentRequired', 'legacy:cancelled',
                 '{}'::jsonb, @scheduled, 'Asia/Beirut', 'Cancelled', 0, NULL, NULL),
                (@dispatchedId, @tenantId, @userId, @dispatchedAggregate, 'EnrollmentActivated', 'legacy:dispatched',
                 '{}'::jsonb, @scheduled, 'Asia/Beirut', 'Dispatched', 1, @dispatched, NULL);
            """,
            command =>
            {
                command.Parameters.AddWithValue("userId", RecipientUserId);
                command.Parameters.AddWithValue("tenantId", TenantId);
                command.Parameters.AddWithValue("pendingId", LegacyId(1));
                command.Parameters.AddWithValue("failedId", LegacyId(2));
                command.Parameters.AddWithValue("cancelledId", LegacyId(3));
                command.Parameters.AddWithValue("dispatchedId", LegacyId(4));
                command.Parameters.AddWithValue("pendingAggregate", LegacyId(11));
                command.Parameters.AddWithValue("failedAggregate", LegacyId(12));
                command.Parameters.AddWithValue("cancelledAggregate", LegacyId(13));
                command.Parameters.AddWithValue("dispatchedAggregate", LegacyId(14));
                command.Parameters.AddWithValue("scheduled", ScheduledAtUtc);
                command.Parameters.AddWithValue("dispatched", ScheduledAtUtc.AddMinutes(2));
            });

        await using (var afterUpgrade = CreateContext())
        {
            await afterUpgrade.Database.MigrateAsync();
        }

        var rows = await ReadRowsAsync();
        Assert.AreEqual("Pending", rows[LegacyId(1)].Status);
        Assert.AreEqual("Pending", rows[LegacyId(2)].Status, "Legacy Failed work becomes retryable.");
        Assert.AreEqual("Cancelled", rows[LegacyId(3)].Status);
        Assert.AreEqual("Dispatched", rows[LegacyId(4)].Status);
        Assert.AreEqual(0, rows[LegacyId(1)].AttemptCount);
        Assert.AreEqual(2, rows[LegacyId(2)].AttemptCount, "Historical attempt counts are preserved.");
        Assert.AreEqual("legacy-transient", rows[LegacyId(2)].FailureCode);
        Assert.AreEqual(1, rows[LegacyId(4)].AttemptCount);
        Assert.IsNotNull(rows[LegacyId(4)].DispatchedAtUtc);

        foreach (var row in rows.Values)
        {
            Assert.AreEqual(ScheduledAtUtc, row.NextAttemptAtUtc);
            Assert.IsFalse(row.HasClaim);
            Assert.IsNull(row.DeadLetteredAtUtc);
        }

        Assert.AreEqual(0L, await ScalarAsync("""SELECT count(*) FROM notifications."DeliveryAttempts";"""));
        Assert.AreEqual(0L, await ScalarAsync("""SELECT count(*) FROM notifications."Notifications";"""));
    }

    private GymDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<GymDbContext>()
            .UseNpgsql(
                databaseConnection,
                npgsql => npgsql.MigrationsHistoryTable("__EFMigrationsHistory", "platform"))
            .Options;
        return new GymDbContext(options, new MigrationClock(), new MigrationCurrentUser(), new MigrationTenantContext());
    }

    private async Task ExecuteAsync(string sql, Action<NpgsqlCommand> configure)
    {
        await using var connection = new NpgsqlConnection(databaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        configure(command);
        await command.ExecuteNonQueryAsync();
    }

    private async Task<long> ScalarAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(databaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        return Convert.ToInt64(await command.ExecuteScalarAsync(), System.Globalization.CultureInfo.InvariantCulture);
    }

    private async Task<Dictionary<Guid, UpgradedRow>> ReadRowsAsync()
    {
        await using var connection = new NpgsqlConnection(databaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            """
            SELECT "Id", "Status", "AttemptCount", "NextAttemptAtUtc", "FailureCode",
                   "ClaimToken" IS NOT NULL, "DispatchedAtUtc", "DeadLetteredAtUtc"
            FROM notifications."OutboxItems"
            """;
        var rows = new Dictionary<Guid, UpgradedRow>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(
                reader.GetGuid(0),
                new UpgradedRow(
                    reader.GetString(1),
                    reader.GetInt32(2),
                    reader.GetFieldValue<DateTimeOffset>(3),
                    reader.IsDBNull(4) ? null : reader.GetString(4),
                    reader.GetBoolean(5),
                    reader.IsDBNull(6) ? null : reader.GetFieldValue<DateTimeOffset>(6),
                    reader.IsDBNull(7) ? null : reader.GetFieldValue<DateTimeOffset>(7)));
        }

        return rows;
    }

    private static Guid LegacyId(int value) => Guid.Parse($"00000000-0000-0000-0000-{value:000000000000}");

    private sealed record UpgradedRow(
        string Status,
        int AttemptCount,
        DateTimeOffset NextAttemptAtUtc,
        string? FailureCode,
        bool HasClaim,
        DateTimeOffset? DispatchedAtUtc,
        DateTimeOffset? DeadLetteredAtUtc);

    private sealed class MigrationTenantContext : IMutableTenantContext
    {
        public Guid TenantId { get; private set; }

        public bool HasTenant => TenantId != Guid.Empty;

        public void SetTenant(Guid tenantId) => TenantId = tenantId;
    }

    private sealed class MigrationCurrentUser : ICurrentUser
    {
        public Guid? UserId => RecipientUserId;

        public bool IsAuthenticated => true;
    }

    private sealed class MigrationClock : IClock
    {
        public DateTimeOffset UtcNow => ScheduledAtUtc;
    }
}
