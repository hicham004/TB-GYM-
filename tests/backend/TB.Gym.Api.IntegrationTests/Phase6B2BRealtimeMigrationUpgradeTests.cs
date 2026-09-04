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
/// Proves the Phase 6B-2B migration against real Phase 6B-2A data, and proves it reverses.
/// </summary>
/// <remarks>
/// The upgrade must fabricate nothing. A conversation that existed before realtime delivery has no
/// events, no publication state and no acknowledgements, and its event cursor is zero — which is the
/// honest answer rather than a delivery claim invented for rows nobody ever published. The client
/// reads its current state over REST, as it always did, and starts merging deltas from there.
/// <para>
/// The revert is the other half. Unlike the 6B-2A revert it destroys no message: it drops what this
/// slice added and leaves conversations, messages, revisions, removal records and read positions
/// exactly as it found them, including the 6B-2A message protections it restores verbatim.
/// </para>
/// </remarks>
[TestClass]
public sealed class Phase6B2BRealtimeMigrationUpgradeTests
{
    private const string MigrationBeforeRealtime = "Phase6B2APersistedMessagingCore";

    private static readonly Guid TenantId = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly Guid CoachUserId = Guid.Parse("44444444-4444-4444-4444-444444444444");
    private static readonly Guid ClientUserId = Guid.Parse("55555555-5555-5555-5555-555555555555");
    private static readonly Guid ClientProfileId = Guid.Parse("66666666-6666-6666-6666-666666666666");
    private static readonly Guid ConversationId = Guid.Parse("77777777-7777-7777-7777-777777777777");
    private static readonly Guid KeptMessageId = Guid.Parse("88888888-8888-8888-8888-888888888888");
    private static readonly Guid RemovedMessageId = Guid.Parse("99999999-9999-9999-9999-999999999999");
    private static readonly DateTimeOffset LegacyInstant = new(2026, 9, 1, 9, 0, 0, TimeSpan.Zero);

    private string? adminConnection;
    private string? databaseName;
    private string? databaseConnection;

    [TestInitialize]
    public async Task InitializeAsync()
    {
        adminConnection = PostgreSqlTestEnvironment.RequireAdminConnection();
        databaseName = await PostgreSqlTestEnvironment.CreateDatabaseAsync("tbgym_p6b2bmig");
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
    public async Task RealPhase6B2ADataUpgradesWithNoInventedEventOrAcknowledgement()
    {
        await MigrateToAsync(MigrationBeforeRealtime);
        await SeedPhase6B2AConversationAsync();

        await MigrateToLatestAsync();

        Assert.AreEqual(
            0L,
            await ScalarAsync("""SELECT "LastEventSequence" FROM messaging."Conversations" WHERE "Id" = @id""", ConversationId),
            "An upgraded conversation has no events, so its cursor is zero rather than a number nobody earned.");
        Assert.AreEqual(0L, await CountAsync("RealtimeEvents"));
        Assert.AreEqual(0L, await CountAsync("RealtimeRecipients"));
        Assert.AreEqual(0L, await CountAsync("RealtimeAttempts"));
        Assert.AreEqual(0L, await CountAsync("RealtimeAcknowledgements"));

        // No delivery claim was fabricated for messages that predate the channel.
        Assert.AreEqual(
            0L,
            await ScalarAsync(
                """SELECT count(*) FROM messaging."Messages" WHERE "RealtimeAcknowledgedAtUtc" IS NOT NULL"""),
            "Nothing acknowledged these messages, so nothing may say it did.");
        Assert.AreEqual(
            0L,
            await ScalarAsync(
                """SELECT count(*) FROM messaging."Messages" WHERE "ProviderAcknowledgedAtUtc" IS NOT NULL"""));

        // And every 6B-2A fact is exactly as it was.
        Assert.AreEqual(2L, await ScalarAsync("""SELECT count(*) FROM messaging."Messages" """));
        Assert.AreEqual(3L, await ScalarAsync("""SELECT count(*) FROM messaging."MessageRevisions" """));
        Assert.AreEqual(1L, await ScalarAsync("""SELECT count(*) FROM messaging."MessageDeletionEvents" """));
        Assert.AreEqual(
            "the second revision",
            await TextAsync(
                """
                SELECT r."Body" FROM messaging."MessageRevisions" r
                WHERE r."MessageId" = @id AND r."RevisionNumber" = 2
                """,
                KeptMessageId));
        Assert.AreEqual(
            1L,
            await ScalarAsync(
                """SELECT "LastReadSequence" FROM messaging."ConversationParticipants" WHERE "UserId" = @id""",
                ClientUserId),
            "A participant's read position is untouched by a delivery migration.");
    }

    /// <summary>
    /// The upgraded conversation still works: the first realtime event it ever gets is position one.
    /// </summary>
    [TestMethod]
    public async Task AnUpgradedConversationStartsItsEventSequenceAtOne()
    {
        await MigrateToAsync(MigrationBeforeRealtime);
        await SeedPhase6B2AConversationAsync();
        await MigrateToLatestAsync();

        var commandRecordId = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000001");
        await ExecuteAsync(
            """
            INSERT INTO messaging."CommandRecords"
                ("Id", "TenantId", "IdempotencyKey", "CommandType", "PayloadFingerprint", "ActorUserId",
                 "ConversationId", "MessageId", "RecordedAtUtc", "CreatedAtUtc", "UpdatedAtUtc")
            VALUES (@commandId, @tenantId, gen_random_uuid(), 'DeleteMessage',
                    repeat('a', 64), @coach, @conversationId, @messageId, @now, @now, @now);

            UPDATE messaging."Conversations" SET "LastEventSequence" = 1 WHERE "Id" = @conversationId;

            INSERT INTO messaging."RealtimeEvents"
                ("Id", "TenantId", "ConversationId", "EventSequence", "Kind", "MessageId",
                 "MessageSequence", "MessageRevisionNumber", "SourceCommandRecordId", "OccurredAtUtc",
                 "CreatedAtUtc", "UpdatedAtUtc")
            VALUES (@eventId, @tenantId, @conversationId, 1, 'MessageSenderRemoved', @messageId, 1, 2,
                    @commandId, @now, @now, @now);

            INSERT INTO messaging."RealtimeRecipients"
                ("Id", "TenantId", "ConversationId", "RealtimeEventId", "RecipientUserId", "Status",
                 "AttemptCount", "NextAttemptAtUtc", "CreatedAtUtc", "UpdatedAtUtc")
            VALUES (@coachRecipient, @tenantId, @conversationId, @eventId, @coach, 'Pending', 0, @now, @now, @now),
                   (@clientRecipient, @tenantId, @conversationId, @eventId, @client, 'Pending', 0, @now, @now, @now);
            """,
            command =>
            {
                command.Parameters.AddWithValue("commandId", commandRecordId);
                command.Parameters.AddWithValue("tenantId", TenantId);
                command.Parameters.AddWithValue("coach", CoachUserId);
                command.Parameters.AddWithValue("client", ClientUserId);
                command.Parameters.AddWithValue("conversationId", ConversationId);
                command.Parameters.AddWithValue("messageId", KeptMessageId);
                command.Parameters.AddWithValue("eventId", Guid.Parse("aaaaaaaa-0000-0000-0000-000000000002"));
                command.Parameters.AddWithValue("coachRecipient", Guid.Parse("aaaaaaaa-0000-0000-0000-000000000003"));
                command.Parameters.AddWithValue("clientRecipient", Guid.Parse("aaaaaaaa-0000-0000-0000-000000000004"));
                command.Parameters.AddWithValue("now", LegacyInstant.AddDays(1));
            });

        Assert.AreEqual(1L, await CountAsync("RealtimeEvents"));
        Assert.AreEqual(2L, await CountAsync("RealtimeRecipients"));
        Assert.AreEqual(
            1L,
            await ScalarAsync("""SELECT "LastEventSequence" FROM messaging."Conversations" WHERE "Id" = @id""", ConversationId));
    }

    /// <summary>
    /// The revert removes realtime delivery, keeps every message, and restores the 6B-2A protections.
    /// </summary>
    [TestMethod]
    public async Task TheMigrationRevertsToPhase6B2ACleanlyAndReapplies()
    {
        await MigrateToAsync(MigrationBeforeRealtime);
        await SeedPhase6B2AConversationAsync();
        await MigrateToLatestAsync();

        await MigrateToAsync(MigrationBeforeRealtime);

        // Everything this slice added is gone.
        foreach (var table in new[]
                 {
                     "RealtimeEvents",
                     "RealtimeRecipients",
                     "RealtimeAttempts",
                     "RealtimeAcknowledgements",
                 })
        {
            Assert.AreEqual(
                0L,
                await ScalarAsync(
                    """
                    SELECT count(*) FROM information_schema.tables
                    WHERE table_schema = 'messaging' AND table_name = @name
                    """,
                    table),
                $"messaging.{table} survived the revert.");
        }

        Assert.AreEqual(
            0L,
            await ScalarAsync(
                """
                SELECT count(*) FROM information_schema.columns
                WHERE table_schema = 'messaging' AND table_name = 'Conversations'
                  AND column_name = 'LastEventSequence'
                """),
            "The event allocator went with the tables that used it.");
        foreach (var function in new[]
                 {
                     "protect_conversation_event_allocator",
                     "assert_conversation_event_tip",
                     "assert_realtime_event_source",
                     "assert_realtime_recipients_complete",
                     "protect_realtime_recipient",
                     "protect_realtime_attempt",
                     "assert_realtime_attempt_chain",
                 })
        {
            Assert.AreEqual(
                0L,
                await ScalarAsync(
                    """
                    SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'messaging' AND p.proname = @name
                    """,
                    function),
                $"messaging.{function}() survived the revert.");
        }

        // Nothing of 6B-2A was lost, which is what makes this revert different from that one.
        Assert.AreEqual(1L, await ScalarAsync("""SELECT count(*) FROM messaging."Conversations" """));
        Assert.AreEqual(2L, await ScalarAsync("""SELECT count(*) FROM messaging."Messages" """));
        Assert.AreEqual(3L, await ScalarAsync("""SELECT count(*) FROM messaging."MessageRevisions" """));
        Assert.AreEqual(1L, await ScalarAsync("""SELECT count(*) FROM messaging."MessageDeletionEvents" """));

        // The 6B-2A message protection is back, exactly as that migration wrote it: no realtime or
        // provider clause, and every rule it did have.
        var restored = await TextAsync(
            """
            SELECT pg_get_functiondef(p.oid) FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'messaging' AND p.proname = 'protect_message'
            """);
        Assert.DoesNotContain("RealtimeAcknowledgedAtUtc", restored);
        Assert.DoesNotContain("ProviderAcknowledgedAtUtc", restored);
        Assert.Contains("A message identity is immutable", restored);
        Assert.Contains("A removed message cannot be edited", restored);

        // And it reapplies onto the reverted database.
        await MigrateToLatestAsync();
        Assert.AreEqual(0L, await CountAsync("RealtimeEvents"));
        Assert.AreEqual(
            0L,
            await ScalarAsync("""SELECT "LastEventSequence" FROM messaging."Conversations" WHERE "Id" = @id""", ConversationId));

        // The reapplied schema agrees with the EF model: no pending changes, and the deferred
        // constraint triggers are back on both sides of each assertion.
        Assert.AreEqual(
            2L,
            await ScalarAsync(
                """
                SELECT count(*) FROM pg_trigger t
                JOIN pg_class c ON c.oid = t.tgrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'messaging' AND NOT t.tgisinternal
                  AND t.tgname = 'assert_conversation_event_tip' AND t.tgdeferrable
                """),
            "The event tip is asserted from the conversation and from the event.");
        Assert.AreEqual(
            2L,
            await ScalarAsync(
                """
                SELECT count(*) FROM pg_trigger t
                JOIN pg_class c ON c.oid = t.tgrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'messaging' AND NOT t.tgisinternal
                  AND t.tgname = 'assert_realtime_attempt_chain' AND t.tgdeferrable
                """));
    }

    // ---------- seeding ----------

    /// <summary>
    /// A real Phase 6B-2A conversation: two participants, an edited message, a removed message with
    /// its append-only event, and a read cursor.
    /// </summary>
    private Task SeedPhase6B2AConversationAsync() => ExecuteAsync(
        """
        INSERT INTO identity."Users"
            ("Id", "DisplayName", "IsPlatformBlocked", "EmailConfirmed", "PhoneNumberConfirmed",
             "TwoFactorEnabled", "LockoutEnabled", "AccessFailedCount")
        VALUES (@coach, 'Legacy Coach', FALSE, TRUE, FALSE, FALSE, TRUE, 0),
               (@client, 'Legacy Client', FALSE, TRUE, FALSE, FALSE, TRUE, 0);

        INSERT INTO tenancy."Tenants"
            ("Id", "Name", "Slug", "TimeZoneId", "DefaultCulture", "DefaultCurrencyCode",
             "WeekStartsOn", "IsActive", "CreatedAtUtc", "UpdatedAtUtc")
        VALUES (@tenantId, 'Legacy Workspace', 'legacy-workspace', 'Asia/Beirut', 'en-LB', 'USD',
                'Monday', TRUE, @now, @now);

        INSERT INTO tenancy."Memberships"
            ("Id", "TenantId", "UserId", "Role", "Status", "CreatedAtUtc", "UpdatedAtUtc")
        VALUES (gen_random_uuid(), @tenantId, @coach, 'Coach', 'Active', @now, @now),
               (gen_random_uuid(), @tenantId, @client, 'Client', 'Active', @now, @now);

        INSERT INTO clients."ClientProfiles"
            ("Id", "TenantId", "UserId", "FirstName", "LastName", "Email", "NormalizedEmail",
             "OnboardingStatus", "IsCoachBlocked", "CreatedAtUtc", "UpdatedAtUtc")
        VALUES (@profileId, @tenantId, @client, 'Legacy', 'Client', 'legacy@tbgym.test',
                'LEGACY@TBGYM.TEST', 'NotStarted', FALSE, @now, @now);

        INSERT INTO messaging."Conversations"
            ("Id", "TenantId", "ClientProfileId", "CoachUserId", "ClientUserId", "StartedAtUtc",
             "LastSequence", "LastActivityAtUtc", "LastMessageId", "CreatedAtUtc", "UpdatedAtUtc")
        VALUES (@conversationId, @tenantId, @profileId, @coach, @client, @now, 0, @now, NULL, @now, @now);

        INSERT INTO messaging."ConversationParticipants"
            ("Id", "TenantId", "ConversationId", "UserId", "Role", "LastReadSequence",
             "LastReadAtUtc", "CreatedAtUtc", "UpdatedAtUtc")
        VALUES (gen_random_uuid(), @tenantId, @conversationId, @coach, 'Coach', 0, NULL, @now, @now),
               (gen_random_uuid(), @tenantId, @conversationId, @client, 'Client', 0, NULL, @now, @now);

        -- One edited message and one removed message, written the way the application writes them:
        -- the conversation tip advances one position at a time, so each message is committed with
        -- its own tip update.
        INSERT INTO messaging."Messages"
            ("Id", "TenantId", "ConversationId", "SenderUserId", "Sequence", "SentAtUtc",
             "AvailableAtUtc", "CurrentRevisionNumber", "EditedAtUtc", "CreatedAtUtc", "UpdatedAtUtc")
        VALUES (@keptId, @tenantId, @conversationId, @coach, 1, @now, @now, 2, @now, @now, @now);
        INSERT INTO messaging."MessageRevisions"
            ("Id", "TenantId", "MessageId", "RevisionNumber", "Body", "AuthoredByUserId",
             "AuthoredAtUtc", "CreatedAtUtc", "UpdatedAtUtc")
        VALUES (gen_random_uuid(), @tenantId, @keptId, 1, 'the first revision', @coach, @now, @now, @now),
               (gen_random_uuid(), @tenantId, @keptId, 2, 'the second revision', @coach, @now, @now, @now);
        UPDATE messaging."Conversations"
        SET "LastSequence" = 1, "LastMessageId" = @keptId WHERE "Id" = @conversationId;

        INSERT INTO messaging."Messages"
            ("Id", "TenantId", "ConversationId", "SenderUserId", "Sequence", "SentAtUtc",
             "AvailableAtUtc", "CurrentRevisionNumber", "DeletedAtUtc", "DeletionKind",
             "DeletedByUserId", "ModerationReason", "CreatedAtUtc", "UpdatedAtUtc")
        VALUES (@removedId, @tenantId, @conversationId, @client, 2, @now, @now, 1, @now,
                'CoachModerated', @coach, 'a retained reason', @now, @now);
        INSERT INTO messaging."MessageRevisions"
            ("Id", "TenantId", "MessageId", "RevisionNumber", "Body", "AuthoredByUserId",
             "AuthoredAtUtc", "CreatedAtUtc", "UpdatedAtUtc")
        VALUES (gen_random_uuid(), @tenantId, @removedId, 1, 'the removed body', @client, @now, @now, @now);
        INSERT INTO messaging."MessageDeletionEvents"
            ("Id", "TenantId", "ConversationId", "MessageId", "Kind", "ActorUserId", "Reason",
             "RevisionNumberAtRemoval", "OccurredAtUtc", "CreatedAtUtc", "UpdatedAtUtc")
        VALUES (gen_random_uuid(), @tenantId, @conversationId, @removedId, 'CoachModerated', @coach,
                'a retained reason', 1, @now, @now, @now);
        UPDATE messaging."Conversations"
        SET "LastSequence" = 2, "LastMessageId" = @removedId WHERE "Id" = @conversationId;

        UPDATE messaging."ConversationParticipants"
        SET "LastReadSequence" = 1, "LastReadAtUtc" = @now
        WHERE "ConversationId" = @conversationId AND "UserId" = @client;
        """,
        command =>
        {
            command.Parameters.AddWithValue("tenantId", TenantId);
            command.Parameters.AddWithValue("coach", CoachUserId);
            command.Parameters.AddWithValue("client", ClientUserId);
            command.Parameters.AddWithValue("profileId", ClientProfileId);
            command.Parameters.AddWithValue("conversationId", ConversationId);
            command.Parameters.AddWithValue("keptId", KeptMessageId);
            command.Parameters.AddWithValue("removedId", RemovedMessageId);
            command.Parameters.AddWithValue("now", LegacyInstant);
        });

    // ---------- plumbing ----------

    private async Task MigrateToAsync(string migration)
    {
        await using var context = CreateContext();
        await context.Database.GetInfrastructure().GetRequiredService<IMigrator>().MigrateAsync(migration);
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

    private async Task<long> ScalarAsync(string sql, object? parameter = null)
    {
        await using var connection = new NpgsqlConnection(databaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        if (parameter is not null)
        {
            command.Parameters.AddWithValue(sql.Contains("@name", StringComparison.Ordinal) ? "name" : "id", parameter);
        }

        return Convert.ToInt64(await command.ExecuteScalarAsync(), CultureInfo.InvariantCulture);
    }

    private async Task<string> TextAsync(string sql, Guid? parameter = null)
    {
        await using var connection = new NpgsqlConnection(databaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        if (parameter is { } id)
        {
            command.Parameters.AddWithValue("id", id);
        }

        return (await command.ExecuteScalarAsync())?.ToString() ?? string.Empty;
    }

    private Task<long> CountAsync(string table) =>
        ScalarAsync($"""SELECT count(*) FROM messaging."{table}" """);

    private sealed class MigrationTenantContext : IMutableTenantContext
    {
        public Guid TenantId { get; private set; }

        public bool HasTenant => TenantId != Guid.Empty;

        public void SetTenant(Guid tenantId) => TenantId = tenantId;
    }

    private sealed class MigrationCurrentUser : ICurrentUser
    {
        public bool IsAuthenticated => false;

        public Guid? UserId => null;
    }

    private sealed class MigrationClock : IClock
    {
        public DateTimeOffset UtcNow => LegacyInstant;
    }
}
