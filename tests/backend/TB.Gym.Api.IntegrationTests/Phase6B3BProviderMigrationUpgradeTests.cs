using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.SharedKernel;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Proves the Phase 6B-3B migration against production-shaped Phase 6B-3A data, in both directions.
/// </summary>
/// <remarks>
/// The migration adds three tables and tightens two existing check constraints, and the tightening is
/// the part worth proving: a constraint added to a populated table fails the whole migration if any
/// existing row violates it. Every Phase 6B-3A row shape therefore has to be seeded and carried
/// across — a materialized in-app delivery with no transport at all, a materialized email delivery
/// from the captured adapter, their attempts, the inbox row somebody has already read, and a
/// preference with the append-only consent evidence that explains it.
/// <para>
/// The round trip is deliberate. Reverting discards provider-event history and suppressions, because
/// the tables that hold them go with it, and that asymmetry is exactly why this repository treats a
/// production rollback as a forward repair migration rather than a down migration. What must survive
/// a revert is every Phase 6B-3A fact — including the provider acceptance recorded on a delivery,
/// whose columns predate this migration — and that is what these assertions check.
/// </para>
/// </remarks>
[TestClass]
public sealed class Phase6B3BProviderMigrationUpgradeTests
{
    private const string MigrationBeforeProvider = "Phase6B3AIntegrityCorrections";

    private static readonly Guid TenantId = Guid.Parse("55555555-5555-5555-5555-555555555555");
    private static readonly Guid RecipientUserId = Guid.Parse("66666666-6666-6666-6666-666666666666");
    private static readonly Guid InAppIntentId = Guid.Parse("77777777-7777-7777-7777-777777777701");
    private static readonly Guid CapturedIntentId = Guid.Parse("77777777-7777-7777-7777-777777777702");
    private static readonly Guid ProviderIntentId = Guid.Parse("77777777-7777-7777-7777-777777777703");
    private static readonly Guid ConsentEventId = Guid.Parse("88888888-8888-8888-8888-888888888888");
    private static readonly DateTimeOffset ScheduledAtUtc = new(2026, 9, 1, 9, 0, 0, TimeSpan.Zero);

    /// <summary>A provider-shaped identifier, so the seeded evidence is the shape a real send produces.</summary>
    private const string ProviderMessageId = "prov_migration_1";

    private const string Fingerprint = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    private string? adminConnection;
    private string? databaseName;
    private string? databaseConnection;

    [TestInitialize]
    public async Task InitializeAsync()
    {
        adminConnection = PostgreSqlTestEnvironment.RequireAdminConnection();
        databaseName = await PostgreSqlTestEnvironment.CreateDatabaseAsync("tbgym_p6b3bmig");
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

    /// <summary>
    /// Apply, revert, reapply. Every Phase 6B-3A notification fact is asserted individually on each
    /// side, because a migration that quietly lost one would otherwise be indistinguishable from one
    /// that worked.
    /// </summary>
    [TestMethod]
    public async Task ProviderMigrationApplyRevertAndReapplyPreserveEveryExistingNotificationFact()
    {
        await MigrateToAsync(MigrationBeforeProvider);
        await SeedPhase6B3AAsync();

        await MigrateToLatestAsync();
        await AssertPhase6B3AFactsAsync("after the first apply");
        await AssertProviderTablesExistAsync();

        // Provider evidence, in the shape a real accepted send leaves behind: acceptance on the
        // delivery, the durable relationship, one verified event and the suppression it caused.
        await SeedProviderEvidenceAsync();
        await AssertProviderEvidenceAsync();

        await MigrateToAsync(MigrationBeforeProvider);
        await AssertPhase6B3AFactsAsync("after the revert");
        // The delivery's own acceptance columns predate this migration and survive the revert, which
        // is what keeps a rolled-back database honest about what was already sent.
        Assert.AreEqual(
            1L,
            await ScalarAsync(
                """
                SELECT count(*) FROM notifications."ChannelDeliveries"
                WHERE "OutboxItemId" = @id AND "ProviderMessageId" = @provider
                  AND "ProviderAcceptedAtUtc" IS NOT NULL
                """,
                ("id", ProviderIntentId),
                ("provider", ProviderMessageId)));
        Assert.AreEqual(0L, await TableExistsAsync("ProviderMessages"), "The revert drops its own tables.");
        Assert.AreEqual(0L, await TableExistsAsync("ProviderEvents"));
        Assert.AreEqual(0L, await TableExistsAsync("EmailSuppressions"));

        await MigrateToLatestAsync();
        await AssertPhase6B3AFactsAsync("after the reapply");
        await AssertProviderTablesExistAsync();

        // And the reapplied schema accepts the same evidence again, which is the practical shape of
        // recovery: replay the provider's events rather than resurrect a dropped table.
        await SeedProviderEvidenceAsync();
        await AssertProviderEvidenceAsync();
    }

    private async Task AssertPhase6B3AFactsAsync(string stage)
    {
        Assert.AreEqual(
            3L,
            await ScalarAsync("""SELECT count(*) FROM notifications."OutboxItems" """),
            $"An intent went missing {stage}.");

        // In-app: materialized, no transport, no provider, and the inbox row somebody already read.
        Assert.AreEqual(
            1L,
            await ScalarAsync(
                """
                SELECT count(*) FROM notifications."ChannelDeliveries"
                WHERE "OutboxItemId" = @id AND "Channel" = 'InApp' AND "Status" = 'Materialized'
                  AND "AttemptCount" = 1 AND "TransportAdapter" IS NULL
                  AND "ProviderMessageId" IS NULL AND "ProviderAcceptedAtUtc" IS NULL
                """,
                ("id", InAppIntentId)),
            $"The in-app delivery lost a fact {stage}.");
        Assert.AreEqual(
            1L,
            await ScalarAsync(
                """
                SELECT count(*) FROM notifications."Notifications"
                WHERE "SourceOutboxItemId" = @id AND "ReadAtUtc" IS NOT NULL
                """,
                ("id", InAppIntentId)),
            $"The read inbox row was lost {stage}.");

        // Captured email: a transport that contacted nobody, and therefore no provider evidence. This
        // is the row the new constraints are most likely to reject if they were written carelessly.
        Assert.AreEqual(
            1L,
            await ScalarAsync(
                """
                SELECT count(*) FROM notifications."ChannelDeliveries"
                WHERE "OutboxItemId" = @id AND "Channel" = 'Email' AND "Status" = 'Materialized'
                  AND "TransportAdapter" = 'captured'
                  AND "ProviderMessageId" IS NULL AND "ProviderAcceptedAtUtc" IS NULL
                """,
                ("id", CapturedIntentId)),
            $"The captured email delivery lost a fact {stage}.");

        Assert.AreEqual(
            3L,
            await ScalarAsync("""SELECT count(*) FROM notifications."DeliveryAttempts" """),
            $"Attempt history changed {stage}.");
        Assert.AreEqual(
            1L,
            await ScalarAsync(
                """
                SELECT count(*) FROM notifications."ChannelPreferences"
                WHERE "UserId" = @user AND "EmailServiceEnabled" AND "EmailServiceConsentEventId" = @evidence
                """,
                ("user", RecipientUserId),
                ("evidence", ConsentEventId)),
            $"The preference lost its evidence {stage}.");
        Assert.AreEqual(
            1L,
            await ScalarAsync(
                """SELECT count(*) FROM notifications."ConsentEvents" WHERE "Id" = @id""",
                ("id", ConsentEventId)),
            $"Append-only consent evidence was lost {stage}.");
    }

    private async Task AssertProviderTablesExistAsync()
    {
        foreach (var table in new[] { "ProviderMessages", "ProviderEvents", "EmailSuppressions" })
        {
            Assert.AreEqual(1L, await TableExistsAsync(table), $"notifications.\"{table}\" is missing.");
        }
    }

    private async Task AssertProviderEvidenceAsync()
    {
        Assert.AreEqual(
            1L,
            await ScalarAsync(
                """
                SELECT count(*) FROM notifications."ProviderMessages"
                WHERE "ProviderMessageId" = @id AND "Adapter" = 'resend'
                  AND "RecipientAddressFingerprint" = @fingerprint
                  AND "BouncedAtUtc" IS NOT NULL AND "BounceClass" = 'Permanent' AND "EventCount" = 1
                """,
                ("id", ProviderMessageId),
                ("fingerprint", Fingerprint)));
        Assert.AreEqual(
            1L,
            await ScalarAsync("""SELECT count(*) FROM notifications."ProviderEvents" """));
        Assert.AreEqual(
            1L,
            await ScalarAsync(
                """
                SELECT count(*) FROM notifications."EmailSuppressions"
                WHERE "UserId" = @user AND "AddressFingerprint" = @fingerprint
                  AND "Reason" = 'PermanentBounce'
                """,
                ("user", RecipientUserId),
                ("fingerprint", Fingerprint)));
    }

    private Task<long> TableExistsAsync(string table) => ScalarAsync(
        """
        SELECT count(*) FROM information_schema.tables
        WHERE table_schema = 'notifications' AND table_name = @name
        """,
        ("name", table));

    /// <summary>
    /// Seeds the three Phase 6B-3A row shapes the new constraints have to accept, with the
    /// immutability guards off for the seed and restored immediately.
    /// </summary>
    /// <remarks>
    /// The guards exist to stop the application writing history; a fixture reproducing history that
    /// already exists in production has to go around them, and does so for exactly the length of the
    /// seed. The guards themselves are asserted by direct SQL in
    /// <c>Phase6B3BProviderEmailTests.DirectSqlCannotFabricateOrRewriteProviderEvidence</c>.
    /// </remarks>
    private async Task SeedPhase6B3AAsync()
    {
        await ExecuteAsync(
            """
            INSERT INTO tenancy."Tenants"
                ("Id", "Name", "Slug", "TimeZoneId", "DefaultCulture", "DefaultCurrencyCode",
                 "WeekStartsOn", "IsActive")
            VALUES (@tenant, 'Legacy 6B-3A', 'legacy-6b3b', 'Asia/Beirut', 'en-LB', 'USD', 'Monday', TRUE);

            INSERT INTO identity."Users"
                ("Id", "DisplayName", "IsPlatformBlocked", "EmailConfirmed", "PhoneNumberConfirmed",
                 "TwoFactorEnabled", "LockoutEnabled", "AccessFailedCount")
            VALUES (@user, 'Legacy Recipient', FALSE, TRUE, FALSE, FALSE, TRUE, 0);

            INSERT INTO tenancy."Memberships"
                ("Id", "TenantId", "UserId", "Role", "Status", "CreatedAtUtc", "UpdatedAtUtc")
            VALUES (gen_random_uuid(), @tenant, @user, 'Client', 'Active', @at, @at);

            INSERT INTO notifications."OutboxItems"
                ("Id", "TenantId", "RecipientUserId", "AggregateId", "Kind", "Purpose",
                 "DeduplicationKey", "PayloadJson", "ScheduledAtUtc", "TenantTimeZoneId", "Status",
                 "CreatedAtUtc", "UpdatedAtUtc")
            VALUES
                (@inApp, @tenant, @user, gen_random_uuid(), 'PaymentRequired', 'ServiceTransactional',
                 'legacy:6b3b:inapp', '{}'::jsonb, @at, 'Asia/Beirut', 'Scheduled', @at, @at),
                (@captured, @tenant, @user, gen_random_uuid(), 'EnrollmentActivated', 'ServiceTransactional',
                 'legacy:6b3b:captured', '{}'::jsonb, @at, 'Asia/Beirut', 'Scheduled', @at, @at),
                (@provider, @tenant, @user, gen_random_uuid(), 'EnrollmentExpired', 'ServiceTransactional',
                 'legacy:6b3b:provider', '{}'::jsonb, @at, 'Asia/Beirut', 'Scheduled', @at, @at);

            INSERT INTO notifications."ConsentEvents"
                ("Id","TenantId","UserId","Channel","Purpose","Decision","RecordedAtUtc",
                 "PolicyVersion","Source","ActorUserId","CreatedAtUtc","UpdatedAtUtc")
            VALUES (@evidence, @tenant, @user, 'Email', 'ServiceTransactional', 'Granted', @at,
                    1, 'notification-preferences-own-settings', @user, @at, @at);

            INSERT INTO notifications."ChannelPreferences"
                ("Id","TenantId","UserId","EmailServiceEnabled","EmailMarketingEnabled",
                 "QuietHoursEnabled","PolicyVersion","EmailServiceDecidedAtUtc",
                 "EmailServiceConsentEventId","CreatedAtUtc","UpdatedAtUtc")
            VALUES (gen_random_uuid(), @tenant, @user, true, false, false, 1, @at, @evidence, @at, @at);
            """,
            Bind);

        await WithoutHistoryGuardsAsync(
            """
            INSERT INTO notifications."ChannelDeliveries"
                ("Id","TenantId","OutboxItemId","Channel","Purpose","SelectionReason",
                 "SelectionPolicyVersion","Status","AttemptCount","DueAtUtc","NextAttemptAtUtc",
                 "MaterializedAtUtc","CompletedAtUtc","DeferralCount","TransportAdapter",
                 "CreatedAtUtc","UpdatedAtUtc")
            VALUES
                (@inAppDelivery, @tenant, @inApp, 'InApp', 'ServiceTransactional',
                 'notification-channel-inapp-always', 1, 'Materialized', 1, @at, @at, @at, @at, 0,
                 NULL, @at, @at),
                (@capturedDelivery, @tenant, @captured, 'Email', 'ServiceTransactional',
                 'notification-channel-email-service-opt-in', 1, 'Materialized', 1, @at, @at, @at, @at,
                 0, 'captured', @at, @at),
                (@providerDelivery, @tenant, @provider, 'Email', 'ServiceTransactional',
                 'notification-channel-email-service-opt-in', 1, 'Materialized', 1, @at, @at, @at, @at,
                 0, 'captured', @at, @at);

            INSERT INTO notifications."DeliveryAttempts"
                ("Id","TenantId","ChannelDeliveryId","Channel","AttemptNumber","ClaimToken",
                 "IdempotencyKey","StartedAtUtc","CompletedAtUtc","Outcome","CreatedAtUtc","UpdatedAtUtc")
            VALUES
                (gen_random_uuid(), @tenant, @inAppDelivery, 'InApp', 1, gen_random_uuid(),
                 'notification:legacy:inapp:v1', @at, @at, 'Succeeded', @at, @at),
                (gen_random_uuid(), @tenant, @capturedDelivery, 'Email', 1, gen_random_uuid(),
                 'notification:legacy:email:v1', @at, @at, 'Succeeded', @at, @at),
                (gen_random_uuid(), @tenant, @providerDelivery, 'Email', 1, gen_random_uuid(),
                 'notification:legacy:email2:v1', @at, @at, 'Succeeded', @at, @at);

            INSERT INTO notifications."Notifications"
                ("Id","TenantId","RecipientUserId","SourceOutboxItemId","Kind","TemplateKey",
                 "TemplateVersion","Culture","Title","Body","ReadAtUtc","CreatedAtUtc","UpdatedAtUtc")
            VALUES (gen_random_uuid(), @tenant, @user, @inApp, 'PaymentRequired',
                    'commercial.payment-required', 1, 'en', 'Payment required',
                    'Your coaching access starts once payment has been received.', @at, @at, @at);
            """,
            Bind);
    }

    /// <summary>
    /// Turns the third seeded delivery into one a real provider accepted, and adds the relationship,
    /// the event and the suppression that follow from it.
    /// </summary>
    private async Task SeedProviderEvidenceAsync()
    {
        await WithoutHistoryGuardsAsync(
            """
            UPDATE notifications."ChannelDeliveries"
            SET "TransportAdapter" = 'resend', "ProviderMessageId" = @providerMessage,
                "ProviderAcceptedAtUtc" = @at
            WHERE "Id" = @providerDelivery;

            UPDATE notifications."DeliveryAttempts"
            SET "ProviderMessageId" = @providerMessage
            WHERE "ChannelDeliveryId" = @providerDelivery;

            INSERT INTO notifications."ProviderMessages"
                ("Id","TenantId","OutboxItemId","ChannelDeliveryId","Channel","RecipientUserId",
                 "Adapter","ProviderMessageId","ProviderAcceptedAtUtc","RecipientAddressFingerprint",
                 "FingerprintKeyId","BouncedAtUtc","BounceClass","EventCount","LastEventReceivedAtUtc",
                 "CreatedAtUtc","UpdatedAtUtc")
            VALUES (@providerRecord, @tenant, @provider, @providerDelivery, 'Email', @user,
                    'resend', @providerMessage, @at, @fingerprint, 'migration-key', @at, 'Permanent',
                    1, @at, @at, @at);

            INSERT INTO notifications."ProviderEvents"
                ("Id","TenantId","ProviderMessageRecordId","Adapter","ProviderEventId","EventType",
                 "BounceClass","FailureCode","OccurredAtUtc","ReceivedAtUtc","AppliedNewFact",
                 "SignatureScheme","SignatureSchemeVersion","CreatedAtUtc","UpdatedAtUtc")
            VALUES (@eventRecord, @tenant, @providerRecord, 'resend', 'evt_migration_1', 'Bounced',
                    'Permanent', 'notification-email-bounce-permanent', @at, @at, true,
                    'standard-webhooks-hmac-sha256-v1', 1, @at, @at);

            INSERT INTO notifications."EmailSuppressions"
                ("Id","TenantId","UserId","AddressFingerprint","FingerprintKeyId","Reason",
                 "SuppressedAtUtc","SourceProviderEventId","SourceProviderMessageId",
                 "CreatedAtUtc","UpdatedAtUtc")
            VALUES (gen_random_uuid(), @tenant, @user, @fingerprint, 'migration-key', 'PermanentBounce',
                    @at, @eventRecord, @providerRecord, @at, @at);
            """,
            Bind);
    }

    private static void Bind(NpgsqlCommand command)
    {
        command.Parameters.AddWithValue("tenant", TenantId);
        command.Parameters.AddWithValue("user", RecipientUserId);
        command.Parameters.AddWithValue("inApp", InAppIntentId);
        command.Parameters.AddWithValue("captured", CapturedIntentId);
        command.Parameters.AddWithValue("provider", ProviderIntentId);
        command.Parameters.AddWithValue("evidence", ConsentEventId);
        command.Parameters.AddWithValue("at", ScheduledAtUtc);
        command.Parameters.AddWithValue("inAppDelivery", DeterministicId(1));
        command.Parameters.AddWithValue("capturedDelivery", DeterministicId(2));
        command.Parameters.AddWithValue("providerDelivery", DeterministicId(3));
        command.Parameters.AddWithValue("providerRecord", DeterministicId(4));
        command.Parameters.AddWithValue("eventRecord", DeterministicId(5));
        command.Parameters.AddWithValue("providerMessage", ProviderMessageId);
        command.Parameters.AddWithValue("fingerprint", Fingerprint);
    }

    private static Guid DeterministicId(int index) =>
        Guid.Parse($"99999999-9999-9999-9999-9999999999{index:D2}");

    /// <summary>
    /// Runs one fixture write with the delivery, attempt and provider-history guards off, restoring
    /// each afterwards.
    /// </summary>
    /// <remarks>
    /// Each <c>ALTER TABLE</c> is its own transaction: a deferred constraint trigger leaves pending
    /// events until its transaction ends, and PostgreSQL refuses to alter a relation that has any.
    /// The provider guards are only disabled when they exist, so this is usable on both sides of the
    /// migration.
    /// </remarks>
    private async Task WithoutHistoryGuardsAsync(string sql, Action<NpgsqlCommand> bind)
    {
        var guards = new List<(string Table, string Trigger)>
        {
            ("ChannelDeliveries", "protect_channel_delivery"),
            ("DeliveryAttempts", "\"TR_NotificationDeliveryAttempts_Protect\""),
        };
        if (await TableExistsAsync("ProviderMessages") == 1L)
        {
            guards.Add(("ProviderMessages", "protect_provider_message"));
        }

        foreach (var (table, trigger) in guards)
        {
            await ExecuteAsync($"""ALTER TABLE notifications."{table}" DISABLE TRIGGER {trigger}""", _ => { });
        }

        try
        {
            await ExecuteAsync(sql, bind);
        }
        finally
        {
            foreach (var (table, trigger) in guards)
            {
                await ExecuteAsync($"""ALTER TABLE notifications."{table}" ENABLE TRIGGER {trigger}""", _ => { });
            }
        }
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

    private async Task ExecuteAsync(string sql, Action<NpgsqlCommand> bind)
    {
        await using var connection = new NpgsqlConnection(databaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        bind(command);
        await command.ExecuteNonQueryAsync();
    }

    private async Task<long> ScalarAsync(string sql, params (string Name, object Value)[] parameters)
    {
        await using var connection = new NpgsqlConnection(databaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        foreach (var (name, value) in parameters)
        {
            command.Parameters.AddWithValue(name, value);
        }

        return Convert.ToInt64(await command.ExecuteScalarAsync(), System.Globalization.CultureInfo.InvariantCulture);
    }

    private sealed class MigrationUpgradeClock : IClock
    {
        public DateTimeOffset UtcNow => ScheduledAtUtc;
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
