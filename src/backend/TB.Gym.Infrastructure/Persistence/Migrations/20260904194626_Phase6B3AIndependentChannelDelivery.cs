using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Splits the single Phase 6B-1 dispatch lifecycle into one durable delivery per channel, and adds
    /// user-owned email preferences, append-only consent evidence and tenant-local quiet hours.
    /// </summary>
    /// <remarks>
    /// The scaffolded version of this migration dropped the outbox lifecycle columns before anything
    /// had read them, which would have silently destroyed every attempt count, claim, retry schedule
    /// and terminal instant in a production database. This version is written in the order the data
    /// requires: the new tables are created, every existing intent is given an in-app delivery carrying
    /// its exact state, the historical attempts are repointed at it, and only then are the old columns
    /// removed. Nothing is deleted, rewritten or invented.
    /// <para>
    /// The legacy statuses map as follows, and every one of them keeps its instants, its attempt count
    /// and its failure code on the migrated delivery:
    /// <list type="bullet">
    /// <item><description><c>Pending</c> and <c>Processing</c> keep their names, their due instant and
    /// their live claim, so a worker mid-flight when the migration runs still finds its work.</description></item>
    /// <item><description><c>Dispatched</c> becomes <c>Materialized</c>, which is what actually
    /// happened: an inbox row was written.</description></item>
    /// <item><description><c>DeadLettered</c> keeps its name, instant and failure code.</description></item>
    /// <item><description><c>Cancelled</c> becomes a <c>Suppressed</c> delivery. A cancelled row with no
    /// failure code was a business withdrawal, so its intent is also marked cancelled; one with a code
    /// was dispatcher suppression, which is a channel fact and leaves the intent scheduled.</description></item>
    /// </list>
    /// </para>
    /// <para>
    /// Reverting is destructive in one specific way and safe in every other: the four new tables are
    /// dropped, so email preferences, consent evidence, spent preference keys and any email delivery
    /// row are lost. The in-app lifecycle is restored onto the outbox rows from the migrated deliveries
    /// before they are dropped, and the notification and attempt history survives intact. Rolling back
    /// in production still means restoring a tested backup or deploying a forward repair.
    /// </para>
    /// </remarks>
    public partial class Phase6B3AIndependentChannelDelivery : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ---------- 1. Make room on the intent, without losing anything yet ----------

            // The old checks name columns that are about to change meaning or disappear, so they come
            // off first. The new check is added after the status values have been rewritten.
            migrationBuilder.DropCheckConstraint(
                name: "CK_NotificationOutboxItems_AttemptCount",
                schema: "notifications",
                table: "OutboxItems");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NotificationOutboxItems_Claim",
                schema: "notifications",
                table: "OutboxItems");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NotificationOutboxItems_DeadLettered",
                schema: "notifications",
                table: "OutboxItems");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NotificationOutboxItems_Dispatched",
                schema: "notifications",
                table: "OutboxItems");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NotificationOutboxItems_NextAttempt",
                schema: "notifications",
                table: "OutboxItems");

            migrationBuilder.DropIndex(
                name: "IX_OutboxItems_Status_ClaimExpiresAtUtc",
                schema: "notifications",
                table: "OutboxItems");

            migrationBuilder.DropIndex(
                name: "IX_OutboxItems_Status_NextAttemptAtUtc_Id",
                schema: "notifications",
                table: "OutboxItems");

            migrationBuilder.DropIndex(
                name: "IX_OutboxItems_TenantId_Status_DeadLetteredAtUtc",
                schema: "notifications",
                table: "OutboxItems");

            // Nullable first, backfilled, then made required. Adding it as NOT NULL with an empty
            // default would write a value that is not a valid purpose into every historical row.
            migrationBuilder.AddColumn<string>(
                name: "Purpose",
                schema: "notifications",
                table: "OutboxItems",
                type: "character varying(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "CancelledAtUtc",
                schema: "notifications",
                table: "OutboxItems",
                type: "timestamp with time zone",
                nullable: true);

            // ---------- 2. The new tables ----------

            migrationBuilder.CreateTable(
                name: "ChannelDeliveries",
                schema: "notifications",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OutboxItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    Channel = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    Purpose = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    SelectionReason = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    SelectionPolicyVersion = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    AttemptCount = table.Column<int>(type: "integer", nullable: false),
                    DueAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    NextAttemptAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ClaimToken = table.Column<Guid>(type: "uuid", nullable: true),
                    ClaimExpiresAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    MaterializedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CompletedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    DeadLetteredAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    FailureCode = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    TransportAdapter = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    ProviderMessageId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    ProviderAcceptedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    DeferralCount = table.Column<int>(type: "integer", nullable: false),
                    DeferredUntilUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    DeferralCode = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ChannelDeliveries", x => x.Id);
                    // Including Channel is what makes an attempt whose channel disagrees with its
                    // delivery structurally impossible rather than merely unlikely.
                    table.UniqueConstraint("AK_ChannelDeliveries_TenantId_Id_Channel", x => new { x.TenantId, x.Id, x.Channel });
                    table.CheckConstraint("CK_NotificationChannelDeliveries_AttemptCount", "\"AttemptCount\" >= 0 AND \"DeferralCount\" >= 0 AND \"SelectionPolicyVersion\" >= 1");
                    table.CheckConstraint("CK_NotificationChannelDeliveries_Claim", "(\"ClaimToken\" IS NULL) = (\"ClaimExpiresAtUtc\" IS NULL) AND (\"ClaimToken\" IS NULL OR \"Status\" = 'Processing')");
                    table.CheckConstraint("CK_NotificationChannelDeliveries_Completion", "(\"Status\" IN ('Materialized', 'Suppressed', 'DeadLettered')) = (\"CompletedAtUtc\" IS NOT NULL)");
                    table.CheckConstraint("CK_NotificationChannelDeliveries_DeadLettered", "(\"Status\" = 'DeadLettered') = (\"DeadLetteredAtUtc\" IS NOT NULL)");
                    table.CheckConstraint("CK_NotificationChannelDeliveries_Deferral", "(\"DeferredUntilUtc\" IS NULL) = (\"DeferralCode\" IS NULL)");
                    table.CheckConstraint("CK_NotificationChannelDeliveries_InAppHasNoProvider", "\"Channel\" <> 'InApp' OR (\"TransportAdapter\" IS NULL AND \"ProviderMessageId\" IS NULL AND \"ProviderAcceptedAtUtc\" IS NULL)");
                    table.CheckConstraint("CK_NotificationChannelDeliveries_Materialized", "(\"Status\" = 'Materialized') = (\"MaterializedAtUtc\" IS NOT NULL)");
                    table.CheckConstraint("CK_NotificationChannelDeliveries_NextAttempt", "\"NextAttemptAtUtc\" >= \"DueAtUtc\"");
                    table.CheckConstraint("CK_NotificationChannelDeliveries_ProviderEvidence", "(\"ProviderMessageId\" IS NULL AND \"ProviderAcceptedAtUtc\" IS NULL) OR (\"TransportAdapter\" IS NOT NULL AND \"Status\" = 'Materialized')");
                    table.ForeignKey(
                        name: "FK_ChannelDeliveries_OutboxItems_TenantId_OutboxItemId",
                        columns: x => new { x.TenantId, x.OutboxItemId },
                        principalSchema: "notifications",
                        principalTable: "OutboxItems",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ChannelPreferences",
                schema: "notifications",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    EmailServiceEnabled = table.Column<bool>(type: "boolean", nullable: false),
                    EmailMarketingEnabled = table.Column<bool>(type: "boolean", nullable: false),
                    QuietHoursEnabled = table.Column<bool>(type: "boolean", nullable: false),
                    QuietHoursStartLocal = table.Column<TimeOnly>(type: "time without time zone", nullable: true),
                    QuietHoursEndLocal = table.Column<TimeOnly>(type: "time without time zone", nullable: true),
                    PolicyVersion = table.Column<int>(type: "integer", nullable: false),
                    EmailServiceDecidedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    EmailMarketingDecidedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ChannelPreferences", x => x.Id);
                    table.CheckConstraint("CK_NotificationChannelPreferences_Decisions", "(\"EmailServiceEnabled\" = false OR \"EmailServiceDecidedAtUtc\" IS NOT NULL) AND (\"EmailMarketingEnabled\" = false OR \"EmailMarketingDecidedAtUtc\" IS NOT NULL)");
                    table.CheckConstraint("CK_NotificationChannelPreferences_PolicyVersion", "\"PolicyVersion\" >= 1");
                    table.CheckConstraint("CK_NotificationChannelPreferences_QuietHours", "(\"QuietHoursEnabled\" = (\"QuietHoursStartLocal\" IS NOT NULL)) AND (\"QuietHoursEnabled\" = (\"QuietHoursEndLocal\" IS NOT NULL)) AND (\"QuietHoursEnabled\" = false OR \"QuietHoursStartLocal\" <> \"QuietHoursEndLocal\")");
                    table.ForeignKey(
                        name: "FK_ChannelPreferences_Tenants_TenantId",
                        column: x => x.TenantId,
                        principalSchema: "tenancy",
                        principalTable: "Tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ChannelPreferences_Users_UserId",
                        column: x => x.UserId,
                        principalSchema: "identity",
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ConsentEvents",
                schema: "notifications",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Channel = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    Purpose = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Decision = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    RecordedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    PolicyVersion = table.Column<int>(type: "integer", nullable: false),
                    Source = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    ActorUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ConsentEvents", x => x.Id);
                    table.CheckConstraint("CK_NotificationConsentEvents_OwnActor", "\"ActorUserId\" = \"UserId\" AND \"PolicyVersion\" >= 1");
                    table.ForeignKey(
                        name: "FK_ConsentEvents_Tenants_TenantId",
                        column: x => x.TenantId,
                        principalSchema: "tenancy",
                        principalTable: "Tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ConsentEvents_Users_UserId",
                        column: x => x.UserId,
                        principalSchema: "identity",
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PreferenceCommandRecords",
                schema: "notifications",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    IdempotencyKey = table.Column<Guid>(type: "uuid", nullable: false),
                    CommandType = table.Column<string>(type: "character varying(48)", maxLength: 48, nullable: false),
                    PayloadFingerprint = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ActorUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    RecordedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PreferenceCommandRecords", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PreferenceCommandRecords_Tenants_TenantId",
                        column: x => x.TenantId,
                        principalSchema: "tenancy",
                        principalTable: "Tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_PreferenceCommandRecords_Users_ActorUserId",
                        column: x => x.ActorUserId,
                        principalSchema: "identity",
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            // ---------- 3. Give every existing intent its in-app delivery ----------

            // One row per existing intent, carrying its exact lifecycle. Ids are UUIDv7 so the new
            // rows keep the repository's time-ordered identifier property, which the dead-letter
            // listing's tiebreaker paging depends on. Audit stamps are copied from the intent rather
            // than set to now, so migrated history does not claim to have been created by this
            // deployment.
            migrationBuilder.Sql(
                """
                INSERT INTO notifications."ChannelDeliveries" (
                    "Id", "TenantId", "OutboxItemId", "Channel", "Purpose",
                    "SelectionReason", "SelectionPolicyVersion", "Status", "AttemptCount",
                    "DueAtUtc", "NextAttemptAtUtc", "ClaimToken", "ClaimExpiresAtUtc",
                    "MaterializedAtUtc", "CompletedAtUtc", "DeadLetteredAtUtc", "FailureCode",
                    "TransportAdapter", "ProviderMessageId", "ProviderAcceptedAtUtc",
                    "DeferralCount", "DeferredUntilUtc", "DeferralCode",
                    "CreatedAtUtc", "CreatedByUserId", "UpdatedAtUtc", "UpdatedByUserId")
                SELECT
                    uuidv7(),
                    o."TenantId",
                    o."Id",
                    'InApp',
                    'ServiceTransactional',
                    'notification-channel-inapp-always',
                    1,
                    CASE o."Status"
                        WHEN 'Pending' THEN 'Pending'
                        WHEN 'Processing' THEN 'Processing'
                        WHEN 'Dispatched' THEN 'Materialized'
                        WHEN 'DeadLettered' THEN 'DeadLettered'
                        WHEN 'Cancelled' THEN 'Suppressed'
                        ELSE 'Pending'
                    END,
                    o."AttemptCount",
                    o."ScheduledAtUtc",
                    o."NextAttemptAtUtc",
                    o."ClaimToken",
                    o."ClaimExpiresAtUtc",
                    CASE WHEN o."Status" = 'Dispatched' THEN o."DispatchedAtUtc" END,
                    -- Every terminal state needs a completion instant. Dispatched and DeadLettered
                    -- have their own; a cancelled row never recorded one, so its last update is the
                    -- closest true instant rather than an invented one.
                    CASE o."Status"
                        WHEN 'Dispatched' THEN o."DispatchedAtUtc"
                        WHEN 'DeadLettered' THEN o."DeadLetteredAtUtc"
                        WHEN 'Cancelled' THEN o."UpdatedAtUtc"
                    END,
                    o."DeadLetteredAtUtc",
                    -- A cancelled row with no code was a business withdrawal; it gets the stable code
                    -- the current model uses for exactly that. One with a code was dispatcher
                    -- suppression, and keeps it.
                    CASE
                        WHEN o."Status" = 'Cancelled' AND o."FailureCode" IS NULL
                            THEN 'notification-intent-cancelled'
                        ELSE o."FailureCode"
                    END,
                    NULL, NULL, NULL,
                    0, NULL, NULL,
                    o."CreatedAtUtc", o."CreatedByUserId", o."UpdatedAtUtc", o."UpdatedByUserId"
                FROM notifications."OutboxItems" o
                """);

            // ---------- 4. Rewrite the intent's own status vocabulary ----------

            migrationBuilder.Sql(
                """
                UPDATE notifications."OutboxItems"
                SET "Purpose" = 'ServiceTransactional',
                    -- Only a business withdrawal cancels the intent. Dispatcher suppression is a
                    -- channel fact and leaves the notification scheduled, which is what the new model
                    -- means by these two words.
                    "Status" = CASE
                        WHEN "Status" = 'Cancelled' AND "FailureCode" IS NULL THEN 'Cancelled'
                        ELSE 'Scheduled'
                    END,
                    "CancelledAtUtc" = CASE
                        WHEN "Status" = 'Cancelled' AND "FailureCode" IS NULL THEN "UpdatedAtUtc"
                    END
                """);

            migrationBuilder.AlterColumn<string>(
                name: "Purpose",
                schema: "notifications",
                table: "OutboxItems",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(32)",
                oldMaxLength: 32,
                oldNullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_NotificationOutboxItems_Cancellation",
                schema: "notifications",
                table: "OutboxItems",
                sql: "(\"Status\" = 'Cancelled') = (\"CancelledAtUtc\" IS NOT NULL)");

            // ---------- 5. Repoint the historical attempts at their channel delivery ----------

            // The Phase 6B-1 attempt guard comes off first. Its body names the column about to be
            // renamed, and it refuses exactly the identity change this repointing has to make; it is
            // recreated at the end of this migration with a body that names the new column and a rule
            // that also covers inserts.
            migrationBuilder.Sql(
                """DROP TRIGGER "TR_NotificationDeliveryAttempts_Protect" ON notifications."DeliveryAttempts";""");

            migrationBuilder.DropForeignKey(
                name: "FK_DeliveryAttempts_OutboxItems_TenantId_OutboxItemId",
                schema: "notifications",
                table: "DeliveryAttempts");

            migrationBuilder.DropIndex(
                name: "IX_DeliveryAttempts_TenantId_OutboxItemId_Channel_AttemptNumber",
                schema: "notifications",
                table: "DeliveryAttempts");

            migrationBuilder.RenameColumn(
                name: "OutboxItemId",
                schema: "notifications",
                table: "DeliveryAttempts",
                newName: "ChannelDeliveryId");

            migrationBuilder.RenameIndex(
                name: "IX_DeliveryAttempts_TenantId_OutboxItemId_StartedAtUtc",
                schema: "notifications",
                table: "DeliveryAttempts",
                newName: "IX_DeliveryAttempts_TenantId_ChannelDeliveryId_StartedAtUtc");

            // The column still holds intent identifiers at this point; the join reads them and
            // replaces each with the delivery that intent's channel now owns. Every historical attempt
            // is in-app, and every intent has exactly one in-app delivery, so every row matches.
            migrationBuilder.Sql(
                """
                UPDATE notifications."DeliveryAttempts" a
                SET "ChannelDeliveryId" = d."Id"
                FROM notifications."ChannelDeliveries" d
                WHERE d."TenantId" = a."TenantId"
                  AND d."OutboxItemId" = a."ChannelDeliveryId"
                  AND d."Channel" = a."Channel"
                """);

            // If any attempt failed to find its delivery, the repointing lost history and the
            // migration must not commit. Better a refused deployment than a silently orphaned audit
            // trail nobody discovers until they need it.
            migrationBuilder.Sql(
                """
                DO $do$
                DECLARE orphaned bigint;
                BEGIN
                    SELECT count(*) INTO orphaned
                    FROM notifications."DeliveryAttempts" a
                    WHERE NOT EXISTS (
                        SELECT 1 FROM notifications."ChannelDeliveries" d
                        WHERE d."TenantId" = a."TenantId" AND d."Id" = a."ChannelDeliveryId");
                    IF orphaned > 0 THEN
                        RAISE EXCEPTION
                            'Phase 6B-3A migration would orphan % delivery attempts; aborting rather than losing history',
                            orphaned;
                    END IF;
                END
                $do$;
                """);

            migrationBuilder.CreateIndex(
                name: "IX_DeliveryAttempts_TenantId_ChannelDeliveryId_AttemptNumber",
                schema: "notifications",
                table: "DeliveryAttempts",
                columns: new[] { "TenantId", "ChannelDeliveryId", "AttemptNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_DeliveryAttempts_TenantId_ChannelDeliveryId_Channel",
                schema: "notifications",
                table: "DeliveryAttempts",
                columns: new[] { "TenantId", "ChannelDeliveryId", "Channel" });

            migrationBuilder.AddForeignKey(
                name: "FK_DeliveryAttempts_ChannelDeliveries_TenantId_ChannelDelivery~",
                schema: "notifications",
                table: "DeliveryAttempts",
                columns: new[] { "TenantId", "ChannelDeliveryId", "Channel" },
                principalSchema: "notifications",
                principalTable: "ChannelDeliveries",
                principalColumns: new[] { "TenantId", "Id", "Channel" },
                onDelete: ReferentialAction.Restrict);

            // ---------- 6. Only now are the old intent columns unused ----------

            migrationBuilder.DropColumn(
                name: "AttemptCount",
                schema: "notifications",
                table: "OutboxItems");

            migrationBuilder.DropColumn(
                name: "ClaimExpiresAtUtc",
                schema: "notifications",
                table: "OutboxItems");

            migrationBuilder.DropColumn(
                name: "ClaimToken",
                schema: "notifications",
                table: "OutboxItems");

            migrationBuilder.DropColumn(
                name: "DeadLetteredAtUtc",
                schema: "notifications",
                table: "OutboxItems");

            migrationBuilder.DropColumn(
                name: "DispatchedAtUtc",
                schema: "notifications",
                table: "OutboxItems");

            migrationBuilder.DropColumn(
                name: "FailureCode",
                schema: "notifications",
                table: "OutboxItems");

            migrationBuilder.DropColumn(
                name: "NextAttemptAtUtc",
                schema: "notifications",
                table: "OutboxItems");

            // ---------- 7. Indexes on the new tables ----------

            migrationBuilder.CreateIndex(
                name: "IX_ChannelDeliveries_Status_ClaimExpiresAtUtc",
                schema: "notifications",
                table: "ChannelDeliveries",
                columns: new[] { "Status", "ClaimExpiresAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_ChannelDeliveries_Status_NextAttemptAtUtc_Id",
                schema: "notifications",
                table: "ChannelDeliveries",
                columns: new[] { "Status", "NextAttemptAtUtc", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_ChannelDeliveries_TenantId_OutboxItemId_Channel",
                schema: "notifications",
                table: "ChannelDeliveries",
                columns: new[] { "TenantId", "OutboxItemId", "Channel" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ChannelDeliveries_TenantId_Status_DeadLetteredAtUtc",
                schema: "notifications",
                table: "ChannelDeliveries",
                columns: new[] { "TenantId", "Status", "DeadLetteredAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_ChannelPreferences_TenantId_UserId",
                schema: "notifications",
                table: "ChannelPreferences",
                columns: new[] { "TenantId", "UserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ChannelPreferences_UserId",
                schema: "notifications",
                table: "ChannelPreferences",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_ConsentEvents_UserId",
                schema: "notifications",
                table: "ConsentEvents",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_NotificationConsentEvents_Subject_RecordedAtUtc",
                schema: "notifications",
                table: "ConsentEvents",
                columns: new[] { "TenantId", "UserId", "Channel", "Purpose", "RecordedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_PreferenceCommandRecords_ActorUserId",
                schema: "notifications",
                table: "PreferenceCommandRecords",
                column: "ActorUserId");

            migrationBuilder.CreateIndex(
                name: "IX_PreferenceCommandRecords_TenantId_IdempotencyKey",
                schema: "notifications",
                table: "PreferenceCommandRecords",
                columns: new[] { "TenantId", "IdempotencyKey" },
                unique: true);

            CreateProtections(migrationBuilder);
        }

        /// <summary>
        /// The database-level protections, created after the backfill so that migrating true historical
        /// terminal state is not refused by rules that describe how new rows may be written.
        /// </summary>
        private static void CreateProtections(MigrationBuilder migrationBuilder)
        {
            // A delivery is born pending, advances one attempt at a time, and is immutable once
            // terminal. The last of those is the one that matters most: it is what stops a worker whose
            // lease expired — and whose delivery a newer worker has since completed — from overwriting
            // that newer result, no matter what the application believed about its own claim.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION notifications.protect_channel_delivery()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Channel deliveries are never deleted; a terminal outcome is recorded state' USING ERRCODE = '23514';
                    END IF;

                    IF TG_OP = 'INSERT' THEN
                        IF NEW."Status" <> 'Pending'
                           OR NEW."AttemptCount" <> 0
                           OR NEW."DeferralCount" <> 0
                           OR NEW."ClaimToken" IS NOT NULL
                           OR NEW."MaterializedAtUtc" IS NOT NULL
                           OR NEW."CompletedAtUtc" IS NOT NULL
                           OR NEW."DeadLetteredAtUtc" IS NOT NULL THEN
                            RAISE EXCEPTION 'A channel delivery must be created pending, unclaimed and unattempted' USING ERRCODE = '23514';
                        END IF;
                        IF NEW."TransportAdapter" IS NOT NULL
                           OR NEW."ProviderMessageId" IS NOT NULL
                           OR NEW."ProviderAcceptedAtUtc" IS NOT NULL THEN
                            RAISE EXCEPTION 'A channel delivery cannot be created with transport or provider evidence' USING ERRCODE = '23514';
                        END IF;
                        RETURN NEW;
                    END IF;

                    IF OLD."Id" <> NEW."Id"
                       OR OLD."TenantId" <> NEW."TenantId"
                       OR OLD."OutboxItemId" <> NEW."OutboxItemId"
                       OR OLD."Channel" <> NEW."Channel"
                       OR OLD."Purpose" <> NEW."Purpose"
                       OR OLD."SelectionReason" <> NEW."SelectionReason"
                       OR OLD."SelectionPolicyVersion" <> NEW."SelectionPolicyVersion"
                       OR OLD."DueAtUtc" <> NEW."DueAtUtc" THEN
                        RAISE EXCEPTION 'A channel delivery identity and selection provenance are immutable' USING ERRCODE = '23514';
                    END IF;

                    IF OLD."Status" IN ('Materialized', 'Suppressed', 'DeadLettered') THEN
                        RAISE EXCEPTION 'A terminal channel delivery is immutable' USING ERRCODE = '23514';
                    END IF;

                    -- Taking over an expired lease is legitimate and is how a crashed worker's delivery
                    -- becomes visible again. What is not legitimate is swapping one claim token for
                    -- another in place: a takeover always starts a new attempt and always extends the
                    -- lease past the one it replaced, so a change that does neither is somebody
                    -- appropriating a claim they never earned.
                    IF OLD."Status" = 'Processing' AND NEW."Status" = 'Processing'
                       AND OLD."ClaimToken" IS DISTINCT FROM NEW."ClaimToken"
                       AND (NEW."AttemptCount" <> OLD."AttemptCount" + 1
                            OR NEW."ClaimExpiresAtUtc" <= OLD."ClaimExpiresAtUtc") THEN
                        RAISE EXCEPTION 'A channel delivery claim changes only by taking over an expired lease with a new attempt' USING ERRCODE = '23514';
                    END IF;

                    IF NEW."AttemptCount" < OLD."AttemptCount" OR NEW."AttemptCount" > OLD."AttemptCount" + 1 THEN
                        RAISE EXCEPTION 'A channel delivery advances at most one attempt at a time and never backwards' USING ERRCODE = '23514';
                    END IF;

                    IF NEW."DeferralCount" < OLD."DeferralCount" THEN
                        RAISE EXCEPTION 'A channel delivery deferral count never decreases' USING ERRCODE = '23514';
                    END IF;

                    IF NEW."ProviderMessageId" IS NOT NULL OR NEW."ProviderAcceptedAtUtc" IS NOT NULL THEN
                        RAISE EXCEPTION 'No email provider exists yet; provider acknowledgement cannot be recorded' USING ERRCODE = '23514';
                    END IF;

                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER protect_channel_delivery
                BEFORE INSERT OR UPDATE OR DELETE ON notifications."ChannelDeliveries"
                FOR EACH ROW EXECUTE FUNCTION notifications.protect_channel_delivery();
                """);

            // The Phase 6B-1 attempt guard, repaired and strengthened in place. Repaired because its
            // body still names the column this migration renamed, so leaving it alone would break
            // every attempt update with an undefined-column error at runtime. Strengthened because an
            // attempt must now also be born Started: a completed INSERT would fabricate history
            // without a dispatcher ever having held the claim. The existing trigger is replaced rather
            // than joined by a second one, so the table keeps exactly one guard with one name.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION notifications.protect_delivery_attempt()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Notification delivery attempts are never deleted' USING ERRCODE = '23514';
                    END IF;
                    IF TG_OP = 'INSERT' THEN
                        IF NEW."Outcome" <> 'Started'
                           OR NEW."CompletedAtUtc" IS NOT NULL
                           OR NEW."FailureCode" IS NOT NULL
                           OR NEW."ProviderMessageId" IS NOT NULL THEN
                            RAISE EXCEPTION 'A notification delivery attempt must start with outcome Started' USING ERRCODE = '23514';
                        END IF;
                        RETURN NEW;
                    END IF;
                    IF OLD."Id" <> NEW."Id"
                       OR OLD."TenantId" <> NEW."TenantId"
                       OR OLD."ChannelDeliveryId" <> NEW."ChannelDeliveryId"
                       OR OLD."Channel" <> NEW."Channel"
                       OR OLD."AttemptNumber" <> NEW."AttemptNumber"
                       OR OLD."ClaimToken" <> NEW."ClaimToken"
                       OR OLD."IdempotencyKey" <> NEW."IdempotencyKey"
                       OR OLD."StartedAtUtc" <> NEW."StartedAtUtc" THEN
                        RAISE EXCEPTION 'A notification delivery attempt identity is immutable' USING ERRCODE = '23514';
                    END IF;
                    IF OLD."Outcome" <> 'Started' THEN
                        RAISE EXCEPTION 'A completed notification delivery attempt is immutable' USING ERRCODE = '23514';
                    END IF;
                    IF NEW."ProviderMessageId" IS NOT NULL THEN
                        RAISE EXCEPTION 'No email provider exists yet; a provider message id cannot be recorded' USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER "TR_NotificationDeliveryAttempts_Protect"
                    BEFORE INSERT OR UPDATE OR DELETE ON notifications."DeliveryAttempts"
                    FOR EACH ROW EXECUTE FUNCTION notifications.protect_delivery_attempt();
                """);

            // The attempt count is the number of durably started attempts, and they are numbered
            // 1..AttemptCount with no gaps. Deferred, because the claim transaction increments the
            // counter and inserts the attempt in either statement order.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION notifications.assert_delivery_attempt_chain()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                DECLARE
                    delivery_id uuid;
                    tenant_id uuid;
                    expected integer;
                    actual integer;
                    highest integer;
                BEGIN
                    IF TG_TABLE_NAME = 'ChannelDeliveries' THEN
                        delivery_id := NEW."Id";
                        tenant_id := NEW."TenantId";
                        expected := NEW."AttemptCount";
                    ELSE
                        delivery_id := NEW."ChannelDeliveryId";
                        tenant_id := NEW."TenantId";
                        SELECT d."AttemptCount" INTO expected
                        FROM notifications."ChannelDeliveries" d
                        WHERE d."TenantId" = tenant_id AND d."Id" = delivery_id;
                        IF NOT FOUND THEN
                            RETURN NULL;
                        END IF;
                    END IF;

                    SELECT count(*), coalesce(max(a."AttemptNumber"), 0) INTO actual, highest
                    FROM notifications."DeliveryAttempts" a
                    WHERE a."TenantId" = tenant_id AND a."ChannelDeliveryId" = delivery_id;

                    IF actual <> expected OR highest <> expected THEN
                        RAISE EXCEPTION
                            'Channel delivery % must have exactly the contiguous attempts 1..% but has % attempts numbered up to %',
                            delivery_id, expected, actual, highest
                            USING ERRCODE = '23514';
                    END IF;
                    RETURN NULL;
                END;
                $function$;

                CREATE CONSTRAINT TRIGGER assert_delivery_attempt_chain
                AFTER INSERT OR UPDATE ON notifications."ChannelDeliveries"
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION notifications.assert_delivery_attempt_chain();

                CREATE CONSTRAINT TRIGGER assert_delivery_attempt_chain
                AFTER INSERT ON notifications."DeliveryAttempts"
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION notifications.assert_delivery_attempt_chain();
                """);

            // Consent evidence and spent command keys are written once. A withdrawal appends a row; it
            // never rewrites the grant it withdraws, because the question a consent record has to answer
            // afterwards is what was true at a given moment and not what is true now.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION notifications.protect_append_only()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    RAISE EXCEPTION 'Notification consent evidence and spent preference keys are append-only' USING ERRCODE = '23514';
                END;
                $function$;

                CREATE TRIGGER protect_consent_event
                BEFORE UPDATE OR DELETE ON notifications."ConsentEvents"
                FOR EACH ROW EXECUTE FUNCTION notifications.protect_append_only();

                CREATE TRIGGER protect_preference_command
                BEFORE UPDATE OR DELETE ON notifications."PreferenceCommandRecords"
                FOR EACH ROW EXECUTE FUNCTION notifications.protect_append_only();
                """);

            // The mutable preference is a read optimisation over the append-only evidence, so the two
            // must agree: an email decision instant on the preference has to name a real consent event
            // with the matching decision. Deferred, so the preference and its evidence may be written
            // in either statement order within one transaction.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION notifications.assert_preference_evidence()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF NEW."TenantId" IS NULL OR NEW."UserId" IS NULL THEN
                        RETURN NULL;
                    END IF;

                    IF NEW."EmailServiceDecidedAtUtc" IS NOT NULL AND NOT EXISTS (
                        SELECT 1 FROM notifications."ConsentEvents" c
                        WHERE c."TenantId" = NEW."TenantId"
                          AND c."UserId" = NEW."UserId"
                          AND c."Channel" = 'Email'
                          AND c."Purpose" = 'ServiceTransactional'
                          AND c."RecordedAtUtc" = NEW."EmailServiceDecidedAtUtc"
                          AND c."Decision" = CASE WHEN NEW."EmailServiceEnabled" THEN 'Granted' ELSE 'Withdrawn' END)
                    THEN
                        RAISE EXCEPTION 'A service-email preference must match its append-only consent evidence' USING ERRCODE = '23514';
                    END IF;

                    IF NEW."EmailMarketingDecidedAtUtc" IS NOT NULL AND NOT EXISTS (
                        SELECT 1 FROM notifications."ConsentEvents" c
                        WHERE c."TenantId" = NEW."TenantId"
                          AND c."UserId" = NEW."UserId"
                          AND c."Channel" = 'Email'
                          AND c."Purpose" = 'Marketing'
                          AND c."RecordedAtUtc" = NEW."EmailMarketingDecidedAtUtc"
                          AND c."Decision" = CASE WHEN NEW."EmailMarketingEnabled" THEN 'Granted' ELSE 'Withdrawn' END)
                    THEN
                        RAISE EXCEPTION 'A marketing-email preference must match its append-only consent evidence' USING ERRCODE = '23514';
                    END IF;

                    RETURN NULL;
                END;
                $function$;

                CREATE CONSTRAINT TRIGGER assert_preference_evidence
                AFTER INSERT OR UPDATE ON notifications."ChannelPreferences"
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION notifications.assert_preference_evidence();
                """);

            // A preference belongs to one member in one workspace for its whole life. Deleting one
            // would leave consent evidence describing a decision with nothing to explain, and moving
            // one would attribute somebody's decision to a different person.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION notifications.protect_channel_preference()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Notification preferences are never deleted; they hold consent state' USING ERRCODE = '23514';
                    END IF;
                    IF OLD."Id" <> NEW."Id"
                       OR OLD."TenantId" <> NEW."TenantId"
                       OR OLD."UserId" <> NEW."UserId" THEN
                        RAISE EXCEPTION 'A notification preference belongs to one member in one workspace' USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER protect_channel_preference
                BEFORE UPDATE OR DELETE ON notifications."ChannelPreferences"
                FOR EACH ROW EXECUTE FUNCTION notifications.protect_channel_preference();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Triggers first, then the functions they depend on, in two separate commands: PostgreSQL
            // refuses to drop a function whose dependent trigger was removed earlier in the same
            // multi-statement command string.
            // Triggers first, then the functions they depend on, in two separate commands: PostgreSQL
            // refuses to drop a function whose dependent trigger was removed earlier in the same
            // multi-statement command string. The Phase 6B-1 attempt guard comes off too, because this
            // revert has to move the very identity column it protects; it is restored at the end.
            migrationBuilder.Sql(
                """
                DROP TRIGGER IF EXISTS protect_channel_preference ON notifications."ChannelPreferences";
                DROP TRIGGER IF EXISTS assert_preference_evidence ON notifications."ChannelPreferences";
                DROP TRIGGER IF EXISTS protect_preference_command ON notifications."PreferenceCommandRecords";
                DROP TRIGGER IF EXISTS protect_consent_event ON notifications."ConsentEvents";
                DROP TRIGGER IF EXISTS assert_delivery_attempt_chain ON notifications."DeliveryAttempts";
                DROP TRIGGER IF EXISTS assert_delivery_attempt_chain ON notifications."ChannelDeliveries";
                DROP TRIGGER IF EXISTS protect_channel_delivery ON notifications."ChannelDeliveries";
                DROP TRIGGER IF EXISTS "TR_NotificationDeliveryAttempts_Protect" ON notifications."DeliveryAttempts";
                """);

            migrationBuilder.Sql(
                """
                DROP FUNCTION IF EXISTS notifications.protect_channel_preference();
                DROP FUNCTION IF EXISTS notifications.assert_preference_evidence();
                DROP FUNCTION IF EXISTS notifications.protect_append_only();
                DROP FUNCTION IF EXISTS notifications.assert_delivery_attempt_chain();
                DROP FUNCTION IF EXISTS notifications.protect_channel_delivery();
                """);

            // The old lifecycle columns come back before the deliveries that hold their values are
            // dropped, so a revert restores the in-app history rather than resetting it.
            migrationBuilder.AddColumn<int>(
                name: "AttemptCount",
                schema: "notifications",
                table: "OutboxItems",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "ClaimExpiresAtUtc",
                schema: "notifications",
                table: "OutboxItems",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "ClaimToken",
                schema: "notifications",
                table: "OutboxItems",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "DeadLetteredAtUtc",
                schema: "notifications",
                table: "OutboxItems",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "DispatchedAtUtc",
                schema: "notifications",
                table: "OutboxItems",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "FailureCode",
                schema: "notifications",
                table: "OutboxItems",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "NextAttemptAtUtc",
                schema: "notifications",
                table: "OutboxItems",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTimeOffset(new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)));

            migrationBuilder.DropCheckConstraint(
                name: "CK_NotificationOutboxItems_Cancellation",
                schema: "notifications",
                table: "OutboxItems");

            // The in-app delivery is the authority for the restored lifecycle. An intent that gained an
            // email delivery keeps only its in-app history, which is the honest limit of a schema that
            // cannot represent a second channel.
            migrationBuilder.Sql(
                """
                UPDATE notifications."OutboxItems" o
                SET "AttemptCount" = d."AttemptCount",
                    "NextAttemptAtUtc" = d."NextAttemptAtUtc",
                    "ClaimToken" = d."ClaimToken",
                    "ClaimExpiresAtUtc" = d."ClaimExpiresAtUtc",
                    "DispatchedAtUtc" = d."MaterializedAtUtc",
                    "DeadLetteredAtUtc" = d."DeadLetteredAtUtc",
                    "FailureCode" = CASE
                        WHEN d."FailureCode" = 'notification-intent-cancelled' THEN NULL
                        ELSE d."FailureCode"
                    END,
                    "Status" = CASE d."Status"
                        WHEN 'Pending' THEN 'Pending'
                        WHEN 'Processing' THEN 'Processing'
                        WHEN 'Materialized' THEN 'Dispatched'
                        WHEN 'DeadLettered' THEN 'DeadLettered'
                        WHEN 'Suppressed' THEN 'Cancelled'
                        ELSE 'Pending'
                    END
                FROM notifications."ChannelDeliveries" d
                WHERE d."TenantId" = o."TenantId"
                  AND d."OutboxItemId" = o."Id"
                  AND d."Channel" = 'InApp'
                """);

            // An intent with no in-app delivery cannot exist, but a defensive floor keeps the restored
            // NextAttemptAtUtc valid against the check that is about to be recreated.
            migrationBuilder.Sql(
                """
                UPDATE notifications."OutboxItems"
                SET "NextAttemptAtUtc" = "ScheduledAtUtc"
                WHERE "NextAttemptAtUtc" < "ScheduledAtUtc"
                """);

            migrationBuilder.DropForeignKey(
                name: "FK_DeliveryAttempts_ChannelDeliveries_TenantId_ChannelDelivery~",
                schema: "notifications",
                table: "DeliveryAttempts");

            migrationBuilder.DropIndex(
                name: "IX_DeliveryAttempts_TenantId_ChannelDeliveryId_AttemptNumber",
                schema: "notifications",
                table: "DeliveryAttempts");

            migrationBuilder.DropIndex(
                name: "IX_DeliveryAttempts_TenantId_ChannelDeliveryId_Channel",
                schema: "notifications",
                table: "DeliveryAttempts");

            // Attempts point back at their intent before the deliveries that name it are dropped.
            migrationBuilder.Sql(
                """
                UPDATE notifications."DeliveryAttempts" a
                SET "ChannelDeliveryId" = d."OutboxItemId"
                FROM notifications."ChannelDeliveries" d
                WHERE d."TenantId" = a."TenantId" AND d."Id" = a."ChannelDeliveryId"
                """);

            migrationBuilder.RenameColumn(
                name: "ChannelDeliveryId",
                schema: "notifications",
                table: "DeliveryAttempts",
                newName: "OutboxItemId");

            migrationBuilder.RenameIndex(
                name: "IX_DeliveryAttempts_TenantId_ChannelDeliveryId_StartedAtUtc",
                schema: "notifications",
                table: "DeliveryAttempts",
                newName: "IX_DeliveryAttempts_TenantId_OutboxItemId_StartedAtUtc");

            // An email attempt has no place in a single-channel schema and would collide with the
            // in-app attempt numbering it is about to share an index with.
            migrationBuilder.Sql(
                """DELETE FROM notifications."DeliveryAttempts" WHERE "Channel" <> 'InApp'""");

            migrationBuilder.DropTable(
                name: "ChannelDeliveries",
                schema: "notifications");

            migrationBuilder.DropTable(
                name: "ChannelPreferences",
                schema: "notifications");

            migrationBuilder.DropTable(
                name: "ConsentEvents",
                schema: "notifications");

            migrationBuilder.DropTable(
                name: "PreferenceCommandRecords",
                schema: "notifications");

            migrationBuilder.DropColumn(
                name: "CancelledAtUtc",
                schema: "notifications",
                table: "OutboxItems");

            migrationBuilder.DropColumn(
                name: "Purpose",
                schema: "notifications",
                table: "OutboxItems");

            migrationBuilder.CreateIndex(
                name: "IX_OutboxItems_Status_ClaimExpiresAtUtc",
                schema: "notifications",
                table: "OutboxItems",
                columns: new[] { "Status", "ClaimExpiresAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_OutboxItems_Status_NextAttemptAtUtc_Id",
                schema: "notifications",
                table: "OutboxItems",
                columns: new[] { "Status", "NextAttemptAtUtc", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_OutboxItems_TenantId_Status_DeadLetteredAtUtc",
                schema: "notifications",
                table: "OutboxItems",
                columns: new[] { "TenantId", "Status", "DeadLetteredAtUtc" });

            migrationBuilder.AddCheckConstraint(
                name: "CK_NotificationOutboxItems_AttemptCount",
                schema: "notifications",
                table: "OutboxItems",
                sql: "\"AttemptCount\" >= 0");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NotificationOutboxItems_Claim",
                schema: "notifications",
                table: "OutboxItems",
                sql: "(\"ClaimToken\" IS NULL) = (\"ClaimExpiresAtUtc\" IS NULL) AND (\"ClaimToken\" IS NULL OR \"Status\" = 'Processing')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NotificationOutboxItems_DeadLettered",
                schema: "notifications",
                table: "OutboxItems",
                sql: "(\"Status\" = 'DeadLettered') = (\"DeadLetteredAtUtc\" IS NOT NULL)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NotificationOutboxItems_Dispatched",
                schema: "notifications",
                table: "OutboxItems",
                sql: "(\"Status\" = 'Dispatched') = (\"DispatchedAtUtc\" IS NOT NULL)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NotificationOutboxItems_NextAttempt",
                schema: "notifications",
                table: "OutboxItems",
                sql: "\"NextAttemptAtUtc\" >= \"ScheduledAtUtc\"");

            migrationBuilder.CreateIndex(
                name: "IX_DeliveryAttempts_TenantId_OutboxItemId_Channel_AttemptNumber",
                schema: "notifications",
                table: "DeliveryAttempts",
                columns: new[] { "TenantId", "OutboxItemId", "Channel", "AttemptNumber" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_DeliveryAttempts_OutboxItems_TenantId_OutboxItemId",
                schema: "notifications",
                table: "DeliveryAttempts",
                columns: new[] { "TenantId", "OutboxItemId" },
                principalSchema: "notifications",
                principalTable: "OutboxItems",
                principalColumns: new[] { "TenantId", "Id" },
                onDelete: ReferentialAction.Restrict);

            // The Phase 6B-1 attempt guard belongs to that migration and must survive this revert. Its
            // body is restored to the one naming the column this revert restored, and its trigger to
            // the update-and-delete form it had before insert-time protection was added. Last, because
            // it refuses precisely the identity movement the steps above had to perform.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION notifications.protect_delivery_attempt()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Notification delivery attempts are never deleted' USING ERRCODE = '23514';
                    END IF;
                    IF OLD."Outcome" <> 'Started' THEN
                        RAISE EXCEPTION 'A completed notification delivery attempt is immutable' USING ERRCODE = '23514';
                    END IF;
                    IF OLD."Id" <> NEW."Id"
                       OR OLD."TenantId" <> NEW."TenantId"
                       OR OLD."OutboxItemId" <> NEW."OutboxItemId"
                       OR OLD."Channel" <> NEW."Channel"
                       OR OLD."AttemptNumber" <> NEW."AttemptNumber"
                       OR OLD."ClaimToken" <> NEW."ClaimToken"
                       OR OLD."IdempotencyKey" <> NEW."IdempotencyKey"
                       OR OLD."StartedAtUtc" <> NEW."StartedAtUtc" THEN
                        RAISE EXCEPTION 'A notification delivery attempt identity is immutable' USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER "TR_NotificationDeliveryAttempts_Protect"
                    BEFORE UPDATE OR DELETE ON notifications."DeliveryAttempts"
                    FOR EACH ROW EXECUTE FUNCTION notifications.protect_delivery_attempt();
                """);
        }
    }
}
