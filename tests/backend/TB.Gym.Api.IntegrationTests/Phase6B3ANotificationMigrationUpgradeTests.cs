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
/// Proves the Phase 6B-3A migration against production-shaped Phase 6B-1 data.
/// </summary>
/// <remarks>
/// The scaffolded version of this migration dropped the outbox lifecycle columns before anything had
/// read them. That would have been silent and total: every attempt count, claim, retry schedule and
/// terminal instant gone, with a green build. This suite exists to make that class of mistake loud, so
/// it seeds every Phase 6B-1 status with real attempt history, a live claim, a delivered notification
/// and a read state, and then asserts each fact individually on the other side.
/// <para>
/// It also drives the full round trip — upgrade, revert, upgrade again — because a revert that loses
/// the in-app lifecycle would leave a rolled-back production database quietly wrong rather than
/// obviously broken.
/// </para>
/// </remarks>
[TestClass]
public sealed class Phase6B3ANotificationMigrationUpgradeTests
{
    private const string MigrationBeforeChannels = "Phase6B2BRealtimeIntegrityHardening";
    private const string FirstChannelMigration = "Phase6B3AIndependentChannelDelivery";
    private static readonly Guid RecipientUserId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid TenantId = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly DateTimeOffset ScheduledAtUtc = new(2026, 8, 30, 9, 0, 0, TimeSpan.Zero);

    /// <summary>The legacy rows that carry attempt history; 4 deliberately has none.</summary>
    private static readonly int[] SeededAttemptNumbers = [1, 2, 3, 5, 6];

    private string? adminConnection;
    private string? databaseName;
    private string? databaseConnection;

    [TestInitialize]
    public async Task InitializeAsync()
    {
        adminConnection = PostgreSqlTestEnvironment.RequireAdminConnection();
        databaseName = await PostgreSqlTestEnvironment.CreateDatabaseAsync("tbgym_p6b3mig");
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
    /// Every representative Phase 6B-1 history gains an in-app delivery carrying its exact state, and
    /// the intent keeps only what is genuinely a fact about the notification rather than about a
    /// channel.
    /// </summary>
    [TestMethod]
    public async Task EveryLegacyStatusBecomesAnInAppDeliveryWithoutLosingAFact()
    {
        await MigrateToAsync(MigrationBeforeChannels);
        await SeedLegacyAsync();
        await MigrateToLatestAsync();

        var deliveries = await ReadDeliveriesAsync();
        var intents = await ReadIntentsAsync();

        // Pending work keeps its retry schedule, its accumulated attempts and its last failure code.
        var pending = deliveries[LegacyId(1)];
        Assert.AreEqual("Pending", pending.Status);
        Assert.AreEqual(2, pending.AttemptCount);
        Assert.AreEqual(ScheduledAtUtc.AddMinutes(5), pending.NextAttemptAtUtc);
        Assert.AreEqual("legacy-transient", pending.FailureCode);
        Assert.IsFalse(pending.HasClaim);
        Assert.IsNull(pending.CompletedAtUtc);
        Assert.AreEqual("Scheduled", intents[LegacyId(1)].Status);
        Assert.IsNull(intents[LegacyId(1)].CancelledAtUtc);

        // A delivered notification becomes a materialized delivery, keeping the instant it happened.
        var materialized = deliveries[LegacyId(2)];
        Assert.AreEqual("Materialized", materialized.Status);
        Assert.AreEqual(1, materialized.AttemptCount);
        Assert.AreEqual(ScheduledAtUtc.AddSeconds(30), materialized.MaterializedAtUtc);
        Assert.AreEqual(ScheduledAtUtc.AddSeconds(30), materialized.CompletedAtUtc);
        Assert.IsNull(materialized.FailureCode);
        // In-app never had a transport or a provider, so the migration must not invent one.
        Assert.IsNull(materialized.TransportAdapter);
        Assert.IsNull(materialized.ProviderMessageId);
        Assert.IsNull(materialized.ProviderAcceptedAtUtc);
        Assert.AreEqual("Scheduled", intents[LegacyId(2)].Status);

        // A business withdrawal cancels the intent and suppresses the channel with the stable code the
        // current model uses for exactly that.
        var withdrawn = deliveries[LegacyId(3)];
        Assert.AreEqual("Suppressed", withdrawn.Status);
        Assert.AreEqual("notification-intent-cancelled", withdrawn.FailureCode);
        Assert.IsNotNull(withdrawn.CompletedAtUtc);
        Assert.AreEqual("Cancelled", intents[LegacyId(3)].Status);
        Assert.IsNotNull(intents[LegacyId(3)].CancelledAtUtc);

        // Dead-lettered work keeps its instant, its exhausted attempt count and its code.
        var deadLettered = deliveries[LegacyId(4)];
        Assert.AreEqual("DeadLettered", deadLettered.Status);
        Assert.AreEqual(6, deadLettered.AttemptCount);
        Assert.AreEqual(ScheduledAtUtc.AddHours(6), deadLettered.DeadLetteredAtUtc);
        Assert.AreEqual("notification-attempts-exhausted", deadLettered.FailureCode);
        Assert.AreEqual("Scheduled", intents[LegacyId(4)].Status);

        // A worker mid-flight when the migration runs still finds its work, with its lease intact.
        var processing = deliveries[LegacyId(5)];
        Assert.AreEqual("Processing", processing.Status);
        Assert.AreEqual(1, processing.AttemptCount);
        Assert.IsTrue(processing.HasClaim, "A live claim must survive, or a worker loses its own work.");
        Assert.IsNull(processing.CompletedAtUtc);

        // Dispatcher suppression is a channel fact: the notification itself was never withdrawn.
        var suppressed = deliveries[LegacyId(6)];
        Assert.AreEqual("Suppressed", suppressed.Status);
        Assert.AreEqual("notification-membership-inactive", suppressed.FailureCode);
        Assert.AreEqual("Scheduled", intents[LegacyId(6)].Status);
        Assert.IsNull(intents[LegacyId(6)].CancelledAtUtc);

        foreach (var (id, delivery) in deliveries)
        {
            Assert.AreEqual("InApp", delivery.Channel, $"{id} must migrate to the in-app channel.");
            Assert.AreEqual("ServiceTransactional", delivery.Purpose);
            Assert.AreEqual("notification-channel-inapp-always", delivery.SelectionReason);
            Assert.AreEqual(1, delivery.SelectionPolicyVersion);
            Assert.AreEqual(0, delivery.DeferralCount);
            Assert.AreEqual(ScheduledAtUtc, delivery.DueAtUtc);
            Assert.AreEqual(TenantId, delivery.TenantId);
        }

        // Exactly one delivery per intent, and no email delivery invented for anybody.
        Assert.AreEqual(6L, await ScalarAsync("""SELECT count(*) FROM notifications."ChannelDeliveries";"""));
        Assert.AreEqual(
            0L,
            await ScalarAsync("""SELECT count(*) FROM notifications."ChannelDeliveries" WHERE "Channel" <> 'InApp';"""),
            "Opting in is a decision nobody has made yet; the migration must not make it for them.");
        // And no preference or consent row conjured for anybody either.
        Assert.AreEqual(0L, await ScalarAsync("""SELECT count(*) FROM notifications."ChannelPreferences";"""));
        Assert.AreEqual(0L, await ScalarAsync("""SELECT count(*) FROM notifications."ConsentEvents";"""));
    }

    /// <summary>
    /// Historical attempts follow their intent onto the delivery that now owns them, with their
    /// outcomes, codes and idempotency keys untouched, and nothing orphaned.
    /// </summary>
    [TestMethod]
    public async Task HistoricalAttemptsAreConnectedToTheMigratedInAppDelivery()
    {
        await MigrateToAsync(MigrationBeforeChannels);
        await SeedLegacyAsync();
        await MigrateToLatestAsync();

        Assert.AreEqual(
            5L,
            await ScalarAsync("""SELECT count(*) FROM notifications."DeliveryAttempts";"""),
            "No completed attempt may be deleted by a schema change.");
        Assert.AreEqual(
            0L,
            await ScalarAsync(
                """
                SELECT count(*) FROM notifications."DeliveryAttempts" a
                WHERE NOT EXISTS (
                    SELECT 1 FROM notifications."ChannelDeliveries" d
                    WHERE d."TenantId" = a."TenantId" AND d."Id" = a."ChannelDeliveryId")
                """),
            "An orphaned attempt is history nobody can read afterwards.");

        var attempts = await ReadAttemptsAsync(LegacyId(1));
        Assert.HasCount(2, attempts);
        Assert.AreEqual(1, attempts[0].AttemptNumber);
        Assert.AreEqual("TransientFailure", attempts[0].Outcome);
        Assert.AreEqual("legacy-transient", attempts[0].FailureCode);
        Assert.AreEqual(2, attempts[1].AttemptNumber);
        Assert.StartsWith("notification:", attempts[0].IdempotencyKey);
        Assert.IsNull(attempts[0].ProviderMessageId);

        var succeeded = await ReadAttemptsAsync(LegacyId(2));
        Assert.HasCount(1, succeeded);
        Assert.AreEqual("Succeeded", succeeded[0].Outcome);

        // The attempt started under the live claim is still open and still owned by that claim.
        var open = await ReadAttemptsAsync(LegacyId(5));
        Assert.HasCount(1, open);
        Assert.AreEqual("Started", open[0].Outcome);
    }

    /// <summary>
    /// The inbox somebody has already read is untouched, including its pagination identity, so a
    /// migration cannot reorder or duplicate what a person is looking at.
    /// </summary>
    [TestMethod]
    public async Task DeliveredNotificationsAndReadStateSurviveUnchanged()
    {
        await MigrateToAsync(MigrationBeforeChannels);
        await SeedLegacyAsync();

        var before = await ReadNotificationIdentitiesAsync();
        await MigrateToLatestAsync();
        var after = await ReadNotificationIdentitiesAsync();

        Assert.HasCount(1, after);
        CollectionAssert.AreEqual(before, after, "Inbox rows and their pagination identity must not move.");
        Assert.AreEqual(
            1L,
            await ScalarAsync("""SELECT count(*) FROM notifications."Notifications" WHERE "ReadAtUtc" IS NOT NULL;"""),
            "Somebody's read state is their own act and is not schema state.");
    }

    /// <summary>
    /// Upgrade, revert, upgrade. The revert restores the in-app lifecycle onto the intent from the
    /// delivery that held it, so a rolled-back production database is obviously correct rather than
    /// quietly wrong, and reapplying afterwards produces the same result again.
    /// </summary>
    [TestMethod]
    public async Task UpgradeRevertAndReapplyPreserveTheSameFacts()
    {
        await MigrateToAsync(MigrationBeforeChannels);
        await SeedLegacyAsync();
        await MigrateToLatestAsync();
        var firstUpgrade = await ReadDeliveriesAsync();

        await MigrateToAsync(MigrationBeforeChannels);

        var reverted = await ReadLegacyOutboxAsync();
        Assert.AreEqual("Pending", reverted[LegacyId(1)].Status);
        Assert.AreEqual(2, reverted[LegacyId(1)].AttemptCount);
        Assert.AreEqual(ScheduledAtUtc.AddMinutes(5), reverted[LegacyId(1)].NextAttemptAtUtc);
        Assert.AreEqual("Dispatched", reverted[LegacyId(2)].Status);
        Assert.AreEqual(ScheduledAtUtc.AddSeconds(30), reverted[LegacyId(2)].DispatchedAtUtc);
        Assert.AreEqual("Cancelled", reverted[LegacyId(3)].Status);
        Assert.IsNull(reverted[LegacyId(3)].FailureCode, "A business withdrawal never carried a code.");
        Assert.AreEqual("DeadLettered", reverted[LegacyId(4)].Status);
        Assert.AreEqual(6, reverted[LegacyId(4)].AttemptCount);
        Assert.AreEqual("Processing", reverted[LegacyId(5)].Status);
        Assert.IsTrue(reverted[LegacyId(5)].HasClaim);
        Assert.AreEqual("Cancelled", reverted[LegacyId(6)].Status);
        Assert.AreEqual("notification-membership-inactive", reverted[LegacyId(6)].FailureCode);
        Assert.AreEqual(
            5L,
            await ScalarAsync("""SELECT count(*) FROM notifications."DeliveryAttempts";"""),
            "Reverting must not delete attempt history either.");

        await MigrateToLatestAsync();
        var secondUpgrade = await ReadDeliveriesAsync();

        foreach (var (id, first) in firstUpgrade)
        {
            var second = secondUpgrade[id];
            Assert.AreEqual(first.Status, second.Status, $"{id} changed status across a round trip.");
            Assert.AreEqual(first.AttemptCount, second.AttemptCount, $"{id} changed attempt count.");
            Assert.AreEqual(first.NextAttemptAtUtc, second.NextAttemptAtUtc, $"{id} changed due instant.");
            Assert.AreEqual(first.FailureCode, second.FailureCode, $"{id} changed failure code.");
            Assert.AreEqual(first.MaterializedAtUtc, second.MaterializedAtUtc, $"{id} changed its artefact instant.");
            Assert.AreEqual(first.DeadLetteredAtUtc, second.DeadLetteredAtUtc, $"{id} changed its dead-letter instant.");
            Assert.AreEqual(first.HasClaim, second.HasClaim, $"{id} changed its claim.");
        }
    }

    /// <summary>
    /// The integrity follow-up upgrades the first channel schema without discarding preferences,
    /// consent evidence or spent command keys. Its exact evidence pointers and replay snapshot also
    /// survive a correction-only revert and reapply.
    /// </summary>
    [TestMethod]
    public async Task IntegrityCorrectionBackfillsAndRoundTripsExistingPreferenceFacts()
    {
        var evidenceId = Guid.Parse("33333333-3333-3333-3333-333333333333");
        var commandId = Guid.Parse("44444444-4444-4444-4444-444444444444");
        var decidedAt = ScheduledAtUtc.AddHours(2);

        await MigrateToAsync(MigrationBeforeChannels);
        await SeedLegacyAsync();
        await MigrateToAsync(FirstChannelMigration);
        await ExecuteAsync(
            """
            INSERT INTO notifications."ConsentEvents"
                ("Id","TenantId","UserId","Channel","Purpose","Decision","RecordedAtUtc",
                 "PolicyVersion","Source","ActorUserId","CreatedAtUtc","UpdatedAtUtc")
            VALUES (@evidence, @tenant, @user, 'Email', 'ServiceTransactional', 'Granted', @decided,
                    1, 'notification-preferences-own-settings', @user, @decided, @decided);

            INSERT INTO notifications."ChannelPreferences"
                ("Id","TenantId","UserId","EmailServiceEnabled","EmailMarketingEnabled",
                 "QuietHoursEnabled","QuietHoursStartLocal","QuietHoursEndLocal","PolicyVersion",
                 "EmailServiceDecidedAtUtc","CreatedAtUtc","UpdatedAtUtc")
            VALUES (uuidv7(), @tenant, @user, true, false, true, '22:00', '07:00', 1,
                    @decided, @decided, @decided);

            INSERT INTO notifications."PreferenceCommandRecords"
                ("Id","TenantId","IdempotencyKey","CommandType","PayloadFingerprint",
                 "ActorUserId","RecordedAtUtc","CreatedAtUtc","UpdatedAtUtc")
            VALUES (@command, @tenant, gen_random_uuid(), 'UpdateOwnPreferences', repeat('0', 64),
                    @user, @decided, @decided, @decided);
            """,
            command =>
            {
                command.Parameters.AddWithValue("evidence", evidenceId);
                command.Parameters.AddWithValue("command", commandId);
                command.Parameters.AddWithValue("tenant", TenantId);
                command.Parameters.AddWithValue("user", RecipientUserId);
                command.Parameters.AddWithValue("decided", decidedAt);
            });

        await MigrateToLatestAsync();
        await AssertPreferenceCorrectionAsync(evidenceId, commandId);

        await MigrateToAsync(FirstChannelMigration);
        Assert.AreEqual(1L, await ScalarAsync(
            """SELECT count(*) FROM notifications."ConsentEvents" WHERE "Id" = @id""",
            ("id", evidenceId)));
        Assert.AreEqual(1L, await ScalarAsync(
            """SELECT count(*) FROM notifications."PreferenceCommandRecords" WHERE "Id" = @id""",
            ("id", commandId)));

        await MigrateToLatestAsync();
        await AssertPreferenceCorrectionAsync(evidenceId, commandId);
    }

    private async Task AssertPreferenceCorrectionAsync(Guid evidenceId, Guid commandId)
    {
        Assert.AreEqual(1L, await ScalarAsync(
            """
            SELECT count(*) FROM notifications."ChannelPreferences"
            WHERE "EmailServiceConsentEventId" = @id
            """,
            ("id", evidenceId)));
        Assert.AreEqual(1L, await ScalarAsync(
            """
            SELECT count(*) FROM notifications."PreferenceCommandRecords"
            WHERE "Id" = @id
              AND "ResultEmailServiceEnabled" = true
              AND "ResultQuietHoursEnabled" = true
              AND "ResultQuietHoursStartLocal" = '22:00'
              AND "ResultQuietHoursEndLocal" = '07:00'
              AND "ResultTimeZoneId" = 'Asia/Beirut'
              AND "ResultPolicyVersion" = 1
              AND "ResultPreferenceVersion" > 0
            """,
            ("id", commandId)));
    }

    // ---------- fixture ----------

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

    /// <summary>
    /// Production-shaped Phase 6B-1 data: every status the old lifecycle could hold, with the attempt
    /// history, the live claim and the delivered notification that make each of them real.
    /// </summary>
    private Task SeedLegacyAsync() => ExecuteAsync(
        """
        INSERT INTO tenancy."Tenants"
            ("Id", "Name", "Slug", "TimeZoneId", "DefaultCulture", "DefaultCurrencyCode",
             "WeekStartsOn", "IsActive")
        VALUES (@tenantId, 'Legacy', 'legacy-6b3a', 'Asia/Beirut', 'en-LB', 'USD', 'Monday', TRUE);

        INSERT INTO identity."Users"
            ("Id", "DisplayName", "IsPlatformBlocked", "EmailConfirmed", "PhoneNumberConfirmed",
             "TwoFactorEnabled", "LockoutEnabled", "AccessFailedCount")
        VALUES (@userId, 'Legacy Recipient', FALSE, TRUE, FALSE, FALSE, TRUE, 0);

        INSERT INTO tenancy."Memberships"
            ("Id", "TenantId", "UserId", "Role", "Status", "CreatedAtUtc", "UpdatedAtUtc")
        VALUES (gen_random_uuid(), @tenantId, @userId, 'Client', 'Active', @scheduled, @scheduled);

        INSERT INTO notifications."OutboxItems"
            ("Id", "TenantId", "RecipientUserId", "AggregateId", "Kind", "DeduplicationKey",
             "PayloadJson", "ScheduledAtUtc", "NextAttemptAtUtc", "TenantTimeZoneId", "Status",
             "AttemptCount", "ClaimToken", "ClaimExpiresAtUtc", "DispatchedAtUtc",
             "DeadLetteredAtUtc", "FailureCode", "CreatedAtUtc", "UpdatedAtUtc")
        VALUES
            (@id1, @tenantId, @userId, @agg1, 'PaymentRequired', 'legacy:pending', '{}'::jsonb,
             @scheduled, @retryAt, 'Asia/Beirut', 'Pending', 2, NULL, NULL, NULL, NULL,
             'legacy-transient', @scheduled, @scheduled),
            (@id2, @tenantId, @userId, @agg2, 'EnrollmentActivated', 'legacy:dispatched', '{}'::jsonb,
             @scheduled, @scheduled, 'Asia/Beirut', 'Dispatched', 1, NULL, NULL, @dispatchedAt, NULL,
             NULL, @scheduled, @dispatchedAt),
            (@id3, @tenantId, @userId, @agg3, 'EnrollmentEndingSoon', 'legacy:withdrawn', '{}'::jsonb,
             @scheduled, @scheduled, 'Asia/Beirut', 'Cancelled', 0, NULL, NULL, NULL, NULL, NULL,
             @scheduled, @withdrawnAt),
            (@id4, @tenantId, @userId, @agg4, 'EnrollmentExpired', 'legacy:deadlettered', '{}'::jsonb,
             @scheduled, @scheduled, 'Asia/Beirut', 'DeadLettered', 6, NULL, NULL, NULL,
             @deadLetteredAt, 'notification-attempts-exhausted', @scheduled, @deadLetteredAt),
            (@id5, @tenantId, @userId, @agg5, 'EnrollmentRenewed', 'legacy:processing', '{}'::jsonb,
             @scheduled, @scheduled, 'Asia/Beirut', 'Processing', 1, @claimToken, @claimExpiresAt,
             NULL, NULL, NULL, @scheduled, @scheduled),
            (@id6, @tenantId, @userId, @agg6, 'PaymentRequired', 'legacy:suppressed', '{}'::jsonb,
             @scheduled, @scheduled, 'Asia/Beirut', 'Cancelled', 1, NULL, NULL, NULL, NULL,
             'notification-membership-inactive', @scheduled, @withdrawnAt);

        INSERT INTO notifications."DeliveryAttempts"
            ("Id", "TenantId", "OutboxItemId", "Channel", "AttemptNumber", "ClaimToken",
             "IdempotencyKey", "StartedAtUtc", "CompletedAtUtc", "Outcome", "FailureCode")
        VALUES
            (@attempt1, @tenantId, @id1, 'InApp', 1, @claim1, 'notification:legacy-1:inapp:v1',
             @scheduled, @scheduled, 'TransientFailure', 'legacy-transient'),
            (@attempt2, @tenantId, @id1, 'InApp', 2, @claim2, 'notification:legacy-1:inapp:v1',
             @scheduled, @scheduled, 'TransientFailure', 'legacy-transient'),
            (@attempt3, @tenantId, @id2, 'InApp', 1, @claim3, 'notification:legacy-2:inapp:v1',
             @scheduled, @dispatchedAt, 'Succeeded', NULL),
            (@attempt5, @tenantId, @id5, 'InApp', 1, @claimToken, 'notification:legacy-5:inapp:v1',
             @scheduled, NULL, 'Started', NULL),
            (@attempt6, @tenantId, @id6, 'InApp', 1, @claim6, 'notification:legacy-6:inapp:v1',
             @scheduled, @withdrawnAt, 'Suppressed', 'notification-membership-inactive');

        INSERT INTO notifications."Notifications"
            ("Id", "TenantId", "RecipientUserId", "SourceOutboxItemId", "Kind", "TemplateKey",
             "TemplateVersion", "Culture", "Title", "Body", "ReadAtUtc", "CreatedAtUtc", "UpdatedAtUtc")
        VALUES
            (@notification, @tenantId, @userId, @id2, 'EnrollmentActivated',
             'commercial.enrollment-activated', 1, 'en', 'Coaching access activated',
             'Your coaching access is now active. Open your workspace to get started.',
             @readAt, @dispatchedAt, @readAt);
        """,
        command =>
        {
            command.Parameters.AddWithValue("tenantId", TenantId);
            command.Parameters.AddWithValue("userId", RecipientUserId);
            for (var index = 1; index <= 6; index++)
            {
                command.Parameters.AddWithValue($"id{index}", LegacyId(index));
                command.Parameters.AddWithValue($"agg{index}", LegacyId(index + 10));
            }

            foreach (var attempt in SeededAttemptNumbers)
            {
                command.Parameters.AddWithValue($"attempt{attempt}", LegacyId(attempt + 20));
                command.Parameters.AddWithValue($"claim{attempt}", LegacyId(attempt + 30));
            }

            command.Parameters.AddWithValue("notification", LegacyId(41));
            command.Parameters.AddWithValue("claimToken", LegacyId(51));
            command.Parameters.AddWithValue("scheduled", ScheduledAtUtc);
            command.Parameters.AddWithValue("retryAt", ScheduledAtUtc.AddMinutes(5));
            command.Parameters.AddWithValue("dispatchedAt", ScheduledAtUtc.AddSeconds(30));
            command.Parameters.AddWithValue("withdrawnAt", ScheduledAtUtc.AddHours(1));
            command.Parameters.AddWithValue("deadLetteredAt", ScheduledAtUtc.AddHours(6));
            command.Parameters.AddWithValue("claimExpiresAt", ScheduledAtUtc.AddMinutes(2));
            command.Parameters.AddWithValue("readAt", ScheduledAtUtc.AddHours(3));
        });

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

        return Convert.ToInt64(await command.ExecuteScalarAsync(), CultureInfo.InvariantCulture);
    }

    private async Task<Dictionary<Guid, DeliveryRow>> ReadDeliveriesAsync()
    {
        await using var connection = new NpgsqlConnection(databaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            """
            SELECT "OutboxItemId", "TenantId", "Channel", "Purpose", "SelectionReason",
                   "SelectionPolicyVersion", "Status", "AttemptCount", "DueAtUtc", "NextAttemptAtUtc",
                   "ClaimToken" IS NOT NULL, "MaterializedAtUtc", "CompletedAtUtc", "DeadLetteredAtUtc",
                   "FailureCode", "TransportAdapter", "ProviderMessageId", "ProviderAcceptedAtUtc",
                   "DeferralCount"
            FROM notifications."ChannelDeliveries"
            """;
        var rows = new Dictionary<Guid, DeliveryRow>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(
                reader.GetGuid(0),
                new DeliveryRow(
                    reader.GetGuid(1),
                    reader.GetString(2),
                    reader.GetString(3),
                    reader.GetString(4),
                    reader.GetInt32(5),
                    reader.GetString(6),
                    reader.GetInt32(7),
                    reader.GetFieldValue<DateTimeOffset>(8),
                    reader.GetFieldValue<DateTimeOffset>(9),
                    reader.GetBoolean(10),
                    reader.IsDBNull(11) ? null : reader.GetFieldValue<DateTimeOffset>(11),
                    reader.IsDBNull(12) ? null : reader.GetFieldValue<DateTimeOffset>(12),
                    reader.IsDBNull(13) ? null : reader.GetFieldValue<DateTimeOffset>(13),
                    reader.IsDBNull(14) ? null : reader.GetString(14),
                    reader.IsDBNull(15) ? null : reader.GetString(15),
                    reader.IsDBNull(16) ? null : reader.GetString(16),
                    reader.IsDBNull(17) ? null : reader.GetFieldValue<DateTimeOffset>(17),
                    reader.GetInt32(18)));
        }

        return rows;
    }

    private async Task<Dictionary<Guid, IntentRow>> ReadIntentsAsync()
    {
        await using var connection = new NpgsqlConnection(databaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            """SELECT "Id", "Status", "Purpose", "CancelledAtUtc" FROM notifications."OutboxItems" """;
        var rows = new Dictionary<Guid, IntentRow>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(
                reader.GetGuid(0),
                new IntentRow(
                    reader.GetString(1),
                    reader.GetString(2),
                    reader.IsDBNull(3) ? null : reader.GetFieldValue<DateTimeOffset>(3)));
        }

        return rows;
    }

    private async Task<Dictionary<Guid, LegacyRow>> ReadLegacyOutboxAsync()
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
        var rows = new Dictionary<Guid, LegacyRow>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(
                reader.GetGuid(0),
                new LegacyRow(
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

    private async Task<IReadOnlyList<AttemptRow>> ReadAttemptsAsync(Guid outboxItemId)
    {
        await using var connection = new NpgsqlConnection(databaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            """
            SELECT a."AttemptNumber", a."Outcome", a."FailureCode", a."IdempotencyKey", a."ProviderMessageId"
            FROM notifications."DeliveryAttempts" a
            JOIN notifications."ChannelDeliveries" d ON d."Id" = a."ChannelDeliveryId"
            WHERE d."OutboxItemId" = @id
            ORDER BY a."AttemptNumber"
            """;
        command.Parameters.AddWithValue("id", outboxItemId);
        var rows = new List<AttemptRow>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(new AttemptRow(
                reader.GetInt32(0),
                reader.GetString(1),
                reader.IsDBNull(2) ? null : reader.GetString(2),
                reader.GetString(3),
                reader.IsDBNull(4) ? null : reader.GetString(4)));
        }

        return rows;
    }

    private async Task<List<string>> ReadNotificationIdentitiesAsync()
    {
        await using var connection = new NpgsqlConnection(databaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        // Ordered exactly as the inbox pages: newest first, identifier as the tiebreaker.
        command.CommandText =
            """
            SELECT "Id"::text || '|' || "SourceOutboxItemId"::text || '|' || "Title" || '|' ||
                   coalesce("ReadAtUtc"::text, '')
            FROM notifications."Notifications"
            ORDER BY "CreatedAtUtc" DESC, "Id" DESC
            """;
        var rows = new List<string>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(reader.GetString(0));
        }

        return rows;
    }

    private static Guid LegacyId(int value) => Guid.Parse($"00000000-0000-0000-0000-{value:000000000000}");

    private sealed record DeliveryRow(
        Guid TenantId,
        string Channel,
        string Purpose,
        string SelectionReason,
        int SelectionPolicyVersion,
        string Status,
        int AttemptCount,
        DateTimeOffset DueAtUtc,
        DateTimeOffset NextAttemptAtUtc,
        bool HasClaim,
        DateTimeOffset? MaterializedAtUtc,
        DateTimeOffset? CompletedAtUtc,
        DateTimeOffset? DeadLetteredAtUtc,
        string? FailureCode,
        string? TransportAdapter,
        string? ProviderMessageId,
        DateTimeOffset? ProviderAcceptedAtUtc,
        int DeferralCount);

    private sealed record IntentRow(string Status, string Purpose, DateTimeOffset? CancelledAtUtc);

    private sealed record LegacyRow(
        string Status,
        int AttemptCount,
        DateTimeOffset NextAttemptAtUtc,
        string? FailureCode,
        bool HasClaim,
        DateTimeOffset? DispatchedAtUtc,
        DateTimeOffset? DeadLetteredAtUtc);

    private sealed record AttemptRow(
        int AttemptNumber,
        string Outcome,
        string? FailureCode,
        string IdempotencyKey,
        string? ProviderMessageId);

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
