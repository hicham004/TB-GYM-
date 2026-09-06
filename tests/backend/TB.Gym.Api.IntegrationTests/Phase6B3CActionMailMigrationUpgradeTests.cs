using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.SharedKernel;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Proves the Phase 6B-3C migration against realistic Phase 1 invitation history, in both directions.
/// </summary>
/// <remarks>
/// This migration is the riskiest kind: it moves a live credential. Before it, an invitation's token
/// hash sits on the aggregate; after it, the aggregate has a logical-send generation and the hash
/// lives in an append-only record with a request and an attempt behind it. A migration that dropped
/// the old column before reading it, or that wrote the hash in the wrong case, would invalidate every
/// invitation currently sitting in somebody's mailbox — silently, and only discoverable when a
/// recipient complains.
/// <para>
/// So the seed is deliberately every shape a Phase 1 workspace can hold: a pending invitation that has
/// only ever been sent once, a pending one somebody resent twice, an accepted one, a revoked one and
/// an expired one — each with the delivery rows Phase 1 wrote beside them. Each fact is asserted
/// individually on both sides of the round trip, because a migration that quietly lost one would
/// otherwise be indistinguishable from one that worked.
/// </para>
/// <para>
/// The case matters and is asserted explicitly. Phase 1 wrote the digest with an upper-case hex
/// encoder and this phase reads it with a lower-case one, so the migration normalises it; getting that
/// backwards would break every outstanding link while every count in this test still passed.
/// </para>
/// </remarks>
[TestClass]
public sealed class Phase6B3CActionMailMigrationUpgradeTests
{
    private const string MigrationBeforeActionMail = "Phase6B3BProviderEmailAndEvents";

    private static readonly Guid TenantId = Guid.Parse("41111111-1111-1111-1111-111111111111");
    private static readonly Guid AcceptedByUserId = Guid.Parse("42222222-2222-2222-2222-222222222222");
    private static readonly Guid AccountDeliveryId = Guid.Parse("42222222-2222-2222-2222-222222222223");

    private static readonly Guid PendingOnceId = Guid.Parse("43333333-3333-3333-3333-333333333301");
    private static readonly Guid PendingResentId = Guid.Parse("43333333-3333-3333-3333-333333333302");
    private static readonly Guid AcceptedId = Guid.Parse("43333333-3333-3333-3333-333333333303");
    private static readonly Guid RevokedId = Guid.Parse("43333333-3333-3333-3333-333333333304");
    private static readonly Guid ExpiredId = Guid.Parse("43333333-3333-3333-3333-333333333305");

    private static readonly DateTimeOffset CreatedAtUtc = new(2026, 8, 20, 9, 0, 0, TimeSpan.Zero);

    /// <summary>
    /// The raw tokens the legacy rows were created from, so the assertions can prove the exact link a
    /// recipient is holding still resolves after the migration.
    /// </summary>
    private static readonly Dictionary<Guid, string> RawTokens = new()
    {
        [PendingOnceId] = "legacy-token-pending-once",
        [PendingResentId] = "legacy-token-pending-resent",
        [AcceptedId] = "legacy-token-accepted",
        [RevokedId] = "legacy-token-revoked",
        [ExpiredId] = "legacy-token-expired",
    };

    private string? adminConnection;
    private string? databaseName;
    private string? databaseConnection;
    private readonly List<LegacyInvitationDelivery> legacyDeliveries = [];

    public TestContext TestContext { get; set; } = null!;

    [TestInitialize]
    public async Task InitializeAsync()
    {
        adminConnection = PostgreSqlTestEnvironment.RequireAdminConnection();
        databaseName = await PostgreSqlTestEnvironment.CreateDatabaseAsync("tbgym_p6b3cmig");
        databaseConnection = new NpgsqlConnectionStringBuilder(adminConnection)
        {
            Database = databaseName,
        }.ConnectionString;
        legacyDeliveries.Clear();
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

    /// <summary>Apply, revert, reapply, with every legacy invitation fact asserted at each stage.</summary>
    [TestMethod]
    public async Task ActionMailMigrationApplyRevertAndReapplyPreserveEveryLegacyInvitationFact()
    {
        await MigrateToAsync(MigrationBeforeActionMail);
        await SeedLegacyInvitationsAsync();

        await MigrateToLatestAsync();
        await AssertLegacyInvitationFactsAsync("after the first apply");
        await AssertReconstructedSendHistoryAsync("after the first apply");
        await AssertLegacyDeliveryHistoryMappedAsync("after the first apply");
        await AssertLegacyLinksStillResolveAsync("after the first apply");
        await AssertLegacyDeliveryTablesAreGoneAsync();

        await MigrateToAsync(MigrationBeforeActionMail);
        await AssertLegacyInvitationFactsAsync("after the revert");
        await AssertLegacyTokenHashRestoredAsync();
        await AssertLegacyDeliveryRowsRestoredAsync();

        await MigrateToLatestAsync();
        await AssertLegacyInvitationFactsAsync("after the reapply");
        await AssertReconstructedSendHistoryAsync("after the reapply");
        await AssertLegacyDeliveryHistoryMappedAsync("after the reapply");
        await AssertLegacyLinksStillResolveAsync("after the reapply");
        await AssertLegacyDeliveryTablesAreGoneAsync();
    }

    /// <summary>
    /// The facts on the aggregate itself: identity, send count, expiry, revocation, acceptance, audit.
    /// </summary>
    /// <remarks>
    /// Every one of these predates the migration and none of them is allowed to move. The generation
    /// is the single column that appears, and it must equal the send count — an invitation that was
    /// deliberately sent three times has had three logical sends, and any other backfill would either
    /// orphan the live token or claim resends that never happened.
    /// </remarks>
    private async Task AssertLegacyInvitationFactsAsync(string stage)
    {
        Assert.AreEqual(
            5L,
            await ScalarAsync("""SELECT count(*) FROM invitations."ClientInvitations" """),
            $"An invitation went missing {stage}.");

        await AssertInvitationAsync(PendingOnceId, "Pending", sendCount: 1, stage);
        await AssertInvitationAsync(PendingResentId, "Pending", sendCount: 3, stage);
        await AssertInvitationAsync(AcceptedId, "Accepted", sendCount: 1, stage);
        await AssertInvitationAsync(RevokedId, "Revoked", sendCount: 2, stage);
        await AssertInvitationAsync(ExpiredId, "Expired", sendCount: 1, stage);

        Assert.AreEqual(
            1L,
            await ScalarAsync(
                """
                SELECT count(*) FROM invitations."ClientInvitations"
                WHERE "Id" = @id AND "AcceptedByUserId" = @user AND "AcceptedAtUtc" IS NOT NULL
                """,
                ("id", AcceptedId),
                ("user", AcceptedByUserId)),
            $"The acceptance fact was lost {stage}.");
        Assert.AreEqual(
            1L,
            await ScalarAsync(
                """
                SELECT count(*) FROM invitations."ClientInvitations"
                WHERE "Id" = @id AND "RevokedAtUtc" IS NOT NULL
                """,
                ("id", RevokedId)),
            $"The revocation fact was lost {stage}.");
        Assert.AreEqual(
            5L,
            await ScalarAsync(
                """
                SELECT count(*) FROM invitations."ClientInvitations"
                WHERE "CreatedAtUtc" = @created AND "Email" <> '' AND "FirstName" <> ''
                """,
                ("created", CreatedAtUtc)),
            $"Audit stamps or invited details changed {stage}.");
    }

    private async Task AssertInvitationAsync(Guid id, string status, int sendCount, string stage)
    {
        Assert.AreEqual(
            1L,
            await ScalarAsync(
                """
                SELECT count(*) FROM invitations."ClientInvitations"
                WHERE "Id" = @id AND "Status" = @status AND "SendCount" = @sendCount
                """,
                ("id", id),
                ("status", status),
                ("sendCount", sendCount)),
            $"Invitation {id} lost its status or send count {stage}.");

        var generationColumn = await ScalarAsync(
            """
            SELECT count(*) FROM information_schema.columns
            WHERE table_schema = 'invitations' AND table_name = 'ClientInvitations'
              AND column_name = 'LogicalSendGeneration'
            """);
        if (generationColumn == 0)
        {
            // Reverted schema: the column is gone, which is the whole point of the revert.
            return;
        }

        Assert.AreEqual(
            1L,
            await ScalarAsync(
                """
                SELECT count(*) FROM invitations."ClientInvitations"
                WHERE "Id" = @id AND "LogicalSendGeneration" = @generation
                """,
                ("id", id),
                ("generation", sendCount)),
            $"Invitation {id} did not carry its send count forward as its generation {stage}.");
    }

    /// <summary>
    /// One request and one attempt per real legacy delivery, after first proving that the rows form
    /// the exact contiguous generation history recorded by the invitation aggregate.
    /// </summary>
    /// <remarks>
    /// The migration fails closed if the delivery rows and send count disagree. That lets it preserve
    /// real identifiers, outcomes, timestamps, failures and provider evidence without inventing a
    /// generation or leaving the current token dangling.
    /// </remarks>
    private async Task AssertReconstructedSendHistoryAsync(string stage)
    {
        Assert.AreEqual(
            8L,
            await ScalarAsync("""SELECT count(*) FROM invitations."ActionMailRequests" """),
            $"The migrated send history is not one request per legacy delivery {stage}.");
        Assert.AreEqual(
            8L,
            await ScalarAsync("""SELECT count(*) FROM invitations."ActionMailAttempts" """),
            $"The migrated send history is not one attempt per request {stage}.");

        Assert.AreEqual(
            3L,
            await ScalarAsync(
                """
                SELECT count(*) FROM invitations."ActionMailRequests"
                WHERE "InvitationId" = @id
                """,
                ("id", PendingResentId)),
            $"A twice-resent invitation did not get three generations {stage}.");
        Assert.AreEqual(
            1L,
            await ScalarAsync(
                """
                SELECT count(*) FROM invitations."ActionMailRequests"
                WHERE "InvitationId" = @id AND "LogicalSendGeneration" = 1
                  AND "RequestSource" = 'invitation-created'
                """,
                ("id", PendingResentId)),
            $"The first generation is not recorded as the creation send {stage}.");
        Assert.AreEqual(
            2L,
            await ScalarAsync(
                """
                SELECT count(*) FROM invitations."ActionMailRequests"
                WHERE "InvitationId" = @id AND "LogicalSendGeneration" > 1
                  AND "RequestSource" = 'invitation-resend'
                """,
                ("id", PendingResentId)),
            $"Later generations are not recorded as resends {stage}.");

        Assert.AreEqual(5L, await ScalarAsync(
            """SELECT count(*) FROM invitations."ActionMailRequests" WHERE "Status" = 'Materialized' AND "TransportAdapter" = 'captured'"""));
        Assert.AreEqual(1L, await ScalarAsync(
            """SELECT count(*) FROM invitations."ActionMailRequests" WHERE "Status" = 'Materialized' AND "TransportAdapter" = 'resend'"""));
        Assert.AreEqual(1L, await ScalarAsync(
            """SELECT count(*) FROM invitations."ActionMailRequests" WHERE "Status" = 'Processing'"""));
        Assert.AreEqual(1L, await ScalarAsync(
            """SELECT count(*) FROM invitations."ActionMailRequests" WHERE "Status" = 'DeadLettered'"""));
    }

    private async Task AssertLegacyDeliveryHistoryMappedAsync(string stage)
    {
        foreach (var delivery in legacyDeliveries)
        {
            var requestStatus = delivery.Status switch
            {
                "Queued" => "Processing",
                "Failed" => "DeadLettered",
                _ => "Materialized",
            };
            var transport = delivery.Status switch
            {
                "CapturedForDevelopment" => "captured",
                "Delivered" when delivery.ProviderMessageId is not null => "resend",
                "Delivered" => "legacy-email",
                _ => null,
            };
            var outcome = delivery.Status switch
            {
                "Queued" => "Started",
                "Failed" => "PermanentFailure",
                _ => "Succeeded",
            };
            DateTimeOffset? completedAt = delivery.Status == "Queued" ? null : delivery.UpdatedAtUtc;
            DateTimeOffset? providerAcceptedAt = delivery.ProviderMessageId is null ? null : delivery.UpdatedAtUtc;
            Assert.AreEqual(
                1L,
                await ScalarAsync(
                    """
                    SELECT count(*) FROM invitations."ActionMailRequests" r
                    JOIN invitations."ActionMailAttempts" a ON a."TenantId" = r."TenantId" AND a."RequestId" = r."Id"
                    WHERE r."Id" = @id AND r."LogicalSendGeneration" = @attempt
                      AND r."Status" = @requestStatus
                      AND r."TransportAdapter" IS NOT DISTINCT FROM @transport
                      AND r."ProviderMessageId" IS NOT DISTINCT FROM @provider
                      AND r."ProviderAcceptedAtUtc" IS NOT DISTINCT FROM @providerAccepted
                      AND r."FailureCode" IS NOT DISTINCT FROM @failure
                      AND r."CreatedAtUtc" = @created AND r."UpdatedAtUtc" = @updated
                      AND a."StartedAtUtc" = @created
                      AND a."CompletedAtUtc" IS NOT DISTINCT FROM @completed
                      AND a."Outcome" = @outcome
                      AND a."ProviderMessageId" IS NOT DISTINCT FROM @provider
                      AND a."FailureCode" IS NOT DISTINCT FROM @failure
                    """,
                    ("id", delivery.Id),
                    ("attempt", delivery.AttemptNumber),
                    ("requestStatus", requestStatus),
                    ("transport", transport ?? (object)DBNull.Value),
                    ("provider", delivery.ProviderMessageId ?? (object)DBNull.Value),
                    ("providerAccepted", providerAcceptedAt ?? (object)DBNull.Value),
                    ("failure", delivery.FailureCode ?? (object)DBNull.Value),
                    ("created", delivery.CreatedAtUtc),
                    ("updated", delivery.UpdatedAtUtc),
                    ("completed", completedAt ?? (object)DBNull.Value),
                    ("outcome", outcome)),
                $"Legacy invitation delivery {delivery.Id} was changed {stage}.");
        }

        Assert.AreEqual(
            1L,
            await ScalarAsync(
                """
                SELECT count(*) FROM identity."ActionMailRequests" r
                JOIN identity."ActionMailAttempts" a ON a."RequestId" = r."Id"
                WHERE r."Id" = @id AND r."ActionKind" = 'ConfirmEmail'
                  AND r."Status" = 'Materialized' AND r."TransportAdapter" = 'captured'
                  AND r."CreatedAtUtc" = @created AND r."UpdatedAtUtc" = @updated
                  AND a."TokenMintedAtUtc" IS NOT NULL AND a."Outcome" = 'Succeeded'
                """,
                ("id", AccountDeliveryId),
                ("created", CreatedAtUtc.AddHours(2)),
                ("updated", CreatedAtUtc.AddHours(2).AddMinutes(1))),
            $"Legacy account delivery was changed {stage}.");
    }

    private async Task AssertLegacyDeliveryRowsRestoredAsync()
    {
        foreach (var delivery in legacyDeliveries)
        {
            Assert.AreEqual(
                1L,
                await ScalarAsync(
                    """
                    SELECT count(*) FROM invitations."InvitationDeliveries"
                    WHERE "Id" = @id AND "InvitationId" = @invitation
                      AND "AttemptNumber" = @attempt AND "Status" = @status
                      AND "ProviderMessageId" IS NOT DISTINCT FROM @provider
                      AND "FailureCode" IS NOT DISTINCT FROM @failure
                      AND "CreatedAtUtc" = @created AND "UpdatedAtUtc" = @updated
                    """,
                    ("id", delivery.Id),
                    ("invitation", delivery.InvitationId),
                    ("attempt", delivery.AttemptNumber),
                    ("status", delivery.Status),
                    ("provider", delivery.ProviderMessageId ?? (object)DBNull.Value),
                    ("failure", delivery.FailureCode ?? (object)DBNull.Value),
                    ("created", delivery.CreatedAtUtc),
                    ("updated", delivery.UpdatedAtUtc)),
                $"Legacy invitation delivery {delivery.Id} was not restored exactly.");
        }

        Assert.AreEqual(
            1L,
            await ScalarAsync(
                """
                SELECT count(*) FROM identity."AccountEmailDeliveries"
                WHERE "Id" = @id AND "UserId" = @user AND "Recipient" = 'accepted@legacy.test'
                  AND "Purpose" = 'ConfirmEmail' AND "Status" = 'CapturedForDevelopment'
                  AND "CreatedAtUtc" = @created AND "UpdatedAtUtc" = @updated
                """,
                ("id", AccountDeliveryId),
                ("user", AcceptedByUserId),
                ("created", CreatedAtUtc.AddHours(2)),
                ("updated", CreatedAtUtc.AddHours(2).AddMinutes(1))),
            "Legacy account delivery was not restored exactly.");
    }

    /// <summary>
    /// The link a recipient is holding still resolves, for exactly the invitations where it should.
    /// </summary>
    /// <remarks>
    /// The token record is written for the current generation only, because Phase 1's resend rotated
    /// the token and earlier ones no longer exist to record. An accepted invitation's token is
    /// recorded as redeemed and a revoked one's as revoked, so the state a recipient meets when they
    /// click is the state the invitation is actually in.
    /// </remarks>
    private async Task AssertLegacyLinksStillResolveAsync(string stage)
    {
        Assert.AreEqual(
            5L,
            await ScalarAsync("""SELECT count(*) FROM invitations."TokenIssues" """),
            $"One live token per invitation was not carried forward {stage}.");

        foreach (var (invitationId, rawToken) in RawTokens)
        {
            Assert.AreEqual(
                1L,
                await ScalarAsync(
                    """
                    SELECT count(*) FROM invitations."TokenIssues"
                    WHERE "InvitationId" = @id AND "TokenHash" = @hash
                    """,
                    ("id", invitationId),
                    ("hash", LowerCaseHash(rawToken))),
                $"The link held for invitation {invitationId} no longer resolves {stage}. " +
                "The migration must normalise the Phase 1 upper-case digest to lower case.");
        }

        Assert.AreEqual(
            1L,
            await ScalarAsync(
                """
                SELECT count(*) FROM invitations."TokenIssues"
                WHERE "InvitationId" = @id AND "RedeemedAtUtc" IS NOT NULL
                  AND "RedeemedByUserId" = @user
                """,
                ("id", AcceptedId),
                ("user", AcceptedByUserId)),
            $"An accepted invitation's token is not recorded as redeemed {stage}.");
        Assert.AreEqual(
            1L,
            await ScalarAsync(
                """
                SELECT count(*) FROM invitations."TokenIssues"
                WHERE "InvitationId" = @id AND "RevokedAtUtc" IS NOT NULL
                  AND "RevocationReason" = 'invitation-token-invitation-revoked'
                """,
                ("id", RevokedId)),
            $"A revoked invitation's token is not recorded as revoked {stage}.");

        // A pending invitation's token is live: neither revoked nor redeemed.
        Assert.AreEqual(
            2L,
            await ScalarAsync(
                """
                SELECT count(*) FROM invitations."TokenIssues"
                WHERE "RevokedAtUtc" IS NULL AND "RedeemedAtUtc" IS NULL
                  AND "InvitationId" IN (@pendingOnce, @pendingResent)
                """,
                ("pendingOnce", PendingOnceId),
                ("pendingResent", PendingResentId)),
            $"A pending invitation's link is not live {stage}.");
    }

    /// <summary>
    /// Reverting puts the live token back on the aggregate, upper-cased the way Phase 1 wrote it.
    /// </summary>
    /// <remarks>
    /// This is what keeps a rollback from being a silent outage. The reverted schema compares the
    /// stored digest for equality against an upper-case encoder, so restoring it in lower case would
    /// leave every outstanding invitation unusable while the column looked perfectly populated.
    /// </remarks>
    private async Task AssertLegacyTokenHashRestoredAsync()
    {
        foreach (var (invitationId, rawToken) in RawTokens)
        {
            Assert.AreEqual(
                1L,
                await ScalarAsync(
                    """
                    SELECT count(*) FROM invitations."ClientInvitations"
                    WHERE "Id" = @id AND "TokenHash" = @hash
                    """,
                    ("id", invitationId),
                    ("hash", LowerCaseHash(rawToken).ToUpperInvariant())),
                $"Reverting lost the live link for invitation {invitationId}.");
        }

        Assert.AreEqual(
            0L,
            await TableExistsAsync("invitations", "TokenIssues"),
            "The revert drops the token record, which is why a production rollback is a forward repair.");
        Assert.AreEqual(0L, await TableExistsAsync("invitations", "ActionMailRequests"));
        Assert.AreEqual(0L, await TableExistsAsync("identity", "ActionMailRequests"));
    }

    /// <summary>
    /// The two legacy delivery tables are gone after their non-address facts have been mapped exactly.
    /// </summary>
    /// <remarks>
    /// Both held a <c>Recipient</c> column containing a plain email address copied for delivery, which
    /// the tokenless design refuses to persist. The migration derives that address from its owner,
    /// validates it first, and retains every other delivery fact in the new request and attempt roots.
    /// </remarks>
    private async Task AssertLegacyDeliveryTablesAreGoneAsync()
    {
        Assert.AreEqual(
            0L,
            await TableExistsAsync("invitations", "InvitationDeliveries"),
            "The legacy invitation delivery table still exists, and it stores recipient addresses.");
        Assert.AreEqual(
            0L,
            await TableExistsAsync("identity", "AccountEmailDeliveries"),
            "The legacy account email delivery table still exists, and it stores recipient addresses.");
        Assert.AreEqual(
            0L,
            await ScalarAsync(
                """
                SELECT count(*) FROM information_schema.columns
                WHERE table_schema = 'invitations' AND table_name = 'ClientInvitations'
                  AND column_name = 'TokenHash'
                """),
            "The invitation aggregate still carries a token hash of its own.");
    }

    /// <summary>
    /// Phase 1 invitation history, in every shape a real workspace can hold.
    /// </summary>
    /// <remarks>
    /// Written as raw SQL against the pre-migration schema on purpose: using the current entity model
    /// would seed rows shaped by the code being tested, which proves nothing about data that already
    /// exists in a database somebody is about to upgrade.
    /// </remarks>
    private async Task SeedLegacyInvitationsAsync()
    {
        await ExecuteAsync(
            """
            INSERT INTO tenancy."Tenants" ("Id", "Name", "Slug", "IsActive", "TimeZoneId",
                "DefaultCulture", "DefaultCurrencyCode", "WeekStartsOn", "CreatedAtUtc", "UpdatedAtUtc")
            VALUES (@tenant, 'Legacy Workspace', 'legacy-workspace', true, 'Asia/Beirut',
                'en-LB', 'USD', 'Monday', @created, @created)
            """,
            ("tenant", TenantId),
            ("created", CreatedAtUtc));

        await ExecuteAsync(
            """
            INSERT INTO identity."Users" ("Id", "UserName", "NormalizedUserName", "Email",
                "NormalizedEmail", "EmailConfirmed", "PasswordHash", "SecurityStamp", "ConcurrencyStamp",
                "PhoneNumberConfirmed", "TwoFactorEnabled", "LockoutEnabled", "AccessFailedCount",
                "DisplayName", "PreferredCulture", "IsPlatformBlocked", "CreatedAtUtc", "UpdatedAtUtc")
            VALUES (@user, 'accepted@legacy.test', 'ACCEPTED@LEGACY.TEST', 'accepted@legacy.test',
                'ACCEPTED@LEGACY.TEST', true, 'hash', 'STAMP', 'concurrency',
                false, false, true, 0, 'Accepted Client', 'en-LB', false, @created, @created)
            """,
            ("user", AcceptedByUserId),
            ("created", CreatedAtUtc));

        await ExecuteAsync(
            """
            INSERT INTO identity."AccountEmailDeliveries" (
                "Id", "UserId", "Recipient", "Purpose", "Status", "ProviderMessageId",
                "FailureCode", "CreatedAtUtc", "UpdatedAtUtc")
            VALUES (@id, @user, 'accepted@legacy.test', 'ConfirmEmail', 'CapturedForDevelopment',
                NULL, NULL, @created, @updated)
            """,
            ("id", AccountDeliveryId),
            ("user", AcceptedByUserId),
            ("created", CreatedAtUtc.AddHours(2)),
            ("updated", CreatedAtUtc.AddHours(2).AddMinutes(1)));

        await SeedInvitationAsync(PendingOnceId, "pending-once@legacy.test", "Pending", 1, expiresInDays: 6);
        await SeedInvitationAsync(PendingResentId, "pending-resent@legacy.test", "Pending", 3, expiresInDays: 7);
        await SeedInvitationAsync(AcceptedId, "accepted@legacy.test", "Accepted", 1, expiresInDays: 5);
        await SeedInvitationAsync(RevokedId, "revoked@legacy.test", "Revoked", 2, expiresInDays: 4);
        await SeedInvitationAsync(ExpiredId, "expired@legacy.test", "Expired", 1, expiresInDays: 3);
    }

    private async Task SeedInvitationAsync(
        Guid id,
        string email,
        string status,
        int sendCount,
        int expiresInDays)
    {
        await ExecuteAsync(
            """
            INSERT INTO invitations."ClientInvitations" ("Id", "TenantId", "Email", "NormalizedEmail",
                "FirstName", "LastName", "PhoneNumber", "BirthDate", "TokenHash", "Status",
                "ExpiresAtUtc", "AcceptedAtUtc", "AcceptedByUserId", "RevokedAtUtc", "SendCount",
                "CreatedAtUtc", "UpdatedAtUtc")
            VALUES (@id, @tenant, @email, upper(@email), 'Legacy', 'Client', NULL, NULL,
                @tokenHash, @status, @expires,
                CASE WHEN @status = 'Accepted' THEN @created END,
                CASE WHEN @status = 'Accepted' THEN @acceptedBy END,
                CASE WHEN @status = 'Revoked' THEN @created END,
                @sendCount, @created, @created)
            """,
            ("id", id),
            ("tenant", TenantId),
            ("email", email),
            // Phase 1 wrote the digest with an upper-case hex encoder. Seeding it any other way would
            // make this test pass against a migration that forgot to normalise the case.
            ("tokenHash", LowerCaseHash(RawTokens[id]).ToUpperInvariant()),
            ("status", status),
            ("expires", CreatedAtUtc.AddDays(expiresInDays)),
            ("acceptedBy", AcceptedByUserId),
            ("created", CreatedAtUtc),
            ("sendCount", sendCount));

        // The Phase 1 rows cover every legacy state and include failure and provider evidence.
        for (var attempt = 1; attempt <= sendCount; attempt++)
        {
            var deliveryStatus = id == PendingResentId && attempt == 2
                ? "Failed"
                : id == PendingResentId && attempt == 3
                    ? "Queued"
                    : id == AcceptedId
                        ? "Delivered"
                        : "CapturedForDevelopment";
            var providerMessageId = deliveryStatus == "Delivered" ? "legacy-provider-accepted-001" : null;
            var failureCode = deliveryStatus == "Failed" ? "legacy-mailbox-refused" : null;
            var delivery = new LegacyInvitationDelivery(
                Guid.NewGuid(),
                id,
                attempt,
                deliveryStatus,
                providerMessageId,
                failureCode,
                CreatedAtUtc.AddMinutes(attempt),
                CreatedAtUtc.AddMinutes(attempt + 1));
            legacyDeliveries.Add(delivery);
            await ExecuteAsync(
                """
                INSERT INTO invitations."InvitationDeliveries" ("Id", "TenantId", "InvitationId",
                    "Recipient", "Channel", "AttemptNumber", "Status", "ProviderMessageId",
                    "FailureCode", "CreatedAtUtc", "UpdatedAtUtc")
                VALUES (@delivery, @tenant, @invitation, @email, 'Email', @attempt,
                    @status, @provider, @failure, @created, @updated)
                """,
                ("tenant", TenantId),
                ("delivery", delivery.Id),
                ("invitation", id),
                ("email", email),
                ("attempt", attempt),
                ("status", delivery.Status),
                ("provider", delivery.ProviderMessageId ?? (object)DBNull.Value),
                ("failure", delivery.FailureCode ?? (object)DBNull.Value),
                ("created", delivery.CreatedAtUtc),
                ("updated", delivery.UpdatedAtUtc));
        }
    }

    /// <summary>SHA-256 of a raw token, lower-case hex: the form this phase stores.</summary>
    private static string LowerCaseHash(string rawToken) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(rawToken)));

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

    private Task<long> TableExistsAsync(string schema, string table) => ScalarAsync(
        """
        SELECT count(*) FROM information_schema.tables
        WHERE table_schema = @schema AND table_name = @table
        """,
        ("schema", schema),
        ("table", table));

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
        public DateTimeOffset UtcNow => CreatedAtUtc;
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

    private sealed record LegacyInvitationDelivery(
        Guid Id,
        Guid InvitationId,
        int AttemptNumber,
        string Status,
        string? ProviderMessageId,
        string? FailureCode,
        DateTimeOffset CreatedAtUtc,
        DateTimeOffset UpdatedAtUtc);
}
