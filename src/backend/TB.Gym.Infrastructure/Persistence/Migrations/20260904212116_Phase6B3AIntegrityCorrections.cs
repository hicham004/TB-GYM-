using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Phase6B3AIntegrityCorrections : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_ChannelDeliveries_OutboxItems_TenantId_OutboxItemId",
                schema: "notifications",
                table: "ChannelDeliveries");

            migrationBuilder.DropIndex(
                name: "IX_Memberships_TenantId_UserId",
                schema: "tenancy",
                table: "Memberships");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NotificationDeliveryAttempts_Success",
                schema: "notifications",
                table: "DeliveryAttempts");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NotificationChannelPreferences_Decisions",
                schema: "notifications",
                table: "ChannelPreferences");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NotificationChannelDeliveries_Claim",
                schema: "notifications",
                table: "ChannelDeliveries");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NotificationChannelDeliveries_Deferral",
                schema: "notifications",
                table: "ChannelDeliveries");

            migrationBuilder.AddColumn<bool>(
                name: "ResultEmailChannelAvailable",
                schema: "notifications",
                table: "PreferenceCommandRecords",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "ResultEmailMarketingEnabled",
                schema: "notifications",
                table: "PreferenceCommandRecords",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "ResultEmailServiceEnabled",
                schema: "notifications",
                table: "PreferenceCommandRecords",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "ResultPolicyVersion",
                schema: "notifications",
                table: "PreferenceCommandRecords",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<long>(
                name: "ResultPreferenceVersion",
                schema: "notifications",
                table: "PreferenceCommandRecords",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<bool>(
                name: "ResultQuietHoursEnabled",
                schema: "notifications",
                table: "PreferenceCommandRecords",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<TimeOnly>(
                name: "ResultQuietHoursEndLocal",
                schema: "notifications",
                table: "PreferenceCommandRecords",
                type: "time without time zone",
                nullable: true);

            migrationBuilder.AddColumn<TimeOnly>(
                name: "ResultQuietHoursStartLocal",
                schema: "notifications",
                table: "PreferenceCommandRecords",
                type: "time without time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ResultTimeZoneId",
                schema: "notifications",
                table: "PreferenceCommandRecords",
                type: "character varying(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<Guid>(
                name: "EmailMarketingConsentEventId",
                schema: "notifications",
                table: "ChannelPreferences",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "EmailServiceConsentEventId",
                schema: "notifications",
                table: "ChannelPreferences",
                type: "uuid",
                nullable: true);

            // The preceding Phase 6B-3A migration may already have served local/dev traffic. Recover
            // the exact consent row behind its timestamp-based pointer before replacing that weaker
            // association with an id. The old deferred trigger guarantees at least one match.
            migrationBuilder.Sql(
                """
                UPDATE notifications."ChannelPreferences" p
                SET "EmailServiceConsentEventId" = (
                    SELECT c."Id"
                    FROM notifications."ConsentEvents" c
                    WHERE c."TenantId" = p."TenantId"
                      AND c."UserId" = p."UserId"
                      AND c."Channel" = 'Email'
                      AND c."Purpose" = 'ServiceTransactional'
                      AND c."RecordedAtUtc" = p."EmailServiceDecidedAtUtc"
                      AND c."Decision" = CASE WHEN p."EmailServiceEnabled" THEN 'Granted' ELSE 'Withdrawn' END
                    ORDER BY c."Id" DESC
                    LIMIT 1)
                WHERE p."EmailServiceDecidedAtUtc" IS NOT NULL;

                UPDATE notifications."ChannelPreferences" p
                SET "EmailMarketingConsentEventId" = (
                    SELECT c."Id"
                    FROM notifications."ConsentEvents" c
                    WHERE c."TenantId" = p."TenantId"
                      AND c."UserId" = p."UserId"
                      AND c."Channel" = 'Email'
                      AND c."Purpose" = 'Marketing'
                      AND c."RecordedAtUtc" = p."EmailMarketingDecidedAtUtc"
                      AND c."Decision" = CASE WHEN p."EmailMarketingEnabled" THEN 'Granted' ELSE 'Withdrawn' END
                    ORDER BY c."Id" DESC
                    LIMIT 1)
                WHERE p."EmailMarketingDecidedAtUtc" IS NOT NULL;

                -- The legacy preference-evidence guard is a deferred constraint trigger. Flush
                -- the events raised by the two backfills before this migration changes indexes
                -- and constraints on ChannelPreferences; PostgreSQL rejects that DDL while the
                -- table has pending trigger events.
                SET CONSTRAINTS ALL IMMEDIATE;

                -- Older command rows did not snapshot their response. The current preference is the
                -- only recoverable non-sensitive approximation; every command written after this
                -- migration stores its exact response and therefore replays exactly.
                ALTER TABLE notifications."PreferenceCommandRecords"
                    DISABLE TRIGGER protect_preference_command;
                UPDATE notifications."PreferenceCommandRecords" r
                SET "ResultEmailServiceEnabled" = coalesce((
                        SELECT p."EmailServiceEnabled" FROM notifications."ChannelPreferences" p
                        WHERE p."TenantId" = r."TenantId" AND p."UserId" = r."ActorUserId"), false),
                    "ResultEmailMarketingEnabled" = coalesce((
                        SELECT p."EmailMarketingEnabled" FROM notifications."ChannelPreferences" p
                        WHERE p."TenantId" = r."TenantId" AND p."UserId" = r."ActorUserId"), false),
                    "ResultQuietHoursEnabled" = coalesce((
                        SELECT p."QuietHoursEnabled" FROM notifications."ChannelPreferences" p
                        WHERE p."TenantId" = r."TenantId" AND p."UserId" = r."ActorUserId"), false),
                    "ResultQuietHoursStartLocal" = (
                        SELECT p."QuietHoursStartLocal" FROM notifications."ChannelPreferences" p
                        WHERE p."TenantId" = r."TenantId" AND p."UserId" = r."ActorUserId"),
                    "ResultQuietHoursEndLocal" = (
                        SELECT p."QuietHoursEndLocal" FROM notifications."ChannelPreferences" p
                        WHERE p."TenantId" = r."TenantId" AND p."UserId" = r."ActorUserId"),
                    "ResultTimeZoneId" = coalesce((
                        SELECT t."TimeZoneId" FROM tenancy."Tenants" t WHERE t."Id" = r."TenantId"), 'Etc/UTC'),
                    "ResultPolicyVersion" = coalesce((
                        SELECT p."PolicyVersion" FROM notifications."ChannelPreferences" p
                        WHERE p."TenantId" = r."TenantId" AND p."UserId" = r."ActorUserId"), 1),
                    "ResultPreferenceVersion" = coalesce((
                        SELECT p.xmin::text::bigint FROM notifications."ChannelPreferences" p
                        WHERE p."TenantId" = r."TenantId" AND p."UserId" = r."ActorUserId"), 0);
                ALTER TABLE notifications."PreferenceCommandRecords"
                    ENABLE TRIGGER protect_preference_command;
                """);

            migrationBuilder.AddUniqueConstraint(
                name: "AK_OutboxItems_TenantId_Id_Purpose",
                schema: "notifications",
                table: "OutboxItems",
                columns: new[] { "TenantId", "Id", "Purpose" });

            migrationBuilder.AddUniqueConstraint(
                name: "AK_Memberships_TenantId_UserId",
                schema: "tenancy",
                table: "Memberships",
                columns: new[] { "TenantId", "UserId" });

            migrationBuilder.AddUniqueConstraint(
                name: "AK_ConsentEvents_TenantId_UserId_Id",
                schema: "notifications",
                table: "ConsentEvents",
                columns: new[] { "TenantId", "UserId", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_PreferenceCommandRecords_TenantId_ActorUserId",
                schema: "notifications",
                table: "PreferenceCommandRecords",
                columns: new[] { "TenantId", "ActorUserId" });

            migrationBuilder.AddCheckConstraint(
                name: "CK_NotificationPreferenceCommands_QuietHours",
                schema: "notifications",
                table: "PreferenceCommandRecords",
                sql: "(\"ResultQuietHoursEnabled\" = (\"ResultQuietHoursStartLocal\" IS NOT NULL)) AND (\"ResultQuietHoursEnabled\" = (\"ResultQuietHoursEndLocal\" IS NOT NULL)) AND (\"ResultQuietHoursEnabled\" = false OR \"ResultQuietHoursStartLocal\" <> \"ResultQuietHoursEndLocal\")");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NotificationPreferenceCommands_Vocabulary",
                schema: "notifications",
                table: "PreferenceCommandRecords",
                sql: "\"CommandType\" = 'UpdateOwnPreferences' AND \"ResultPolicyVersion\" >= 1 AND \"ResultPreferenceVersion\" BETWEEN 0 AND 4294967295 AND btrim(\"ResultTimeZoneId\") <> '' AND \"PayloadFingerprint\" ~ '^[0-9a-f]{64}$'");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NotificationOutboxItems_Vocabulary",
                schema: "notifications",
                table: "OutboxItems",
                sql: "\"Status\" IN ('Scheduled', 'Cancelled') AND \"Purpose\" = 'ServiceTransactional' AND \"Kind\" IN ('PaymentRequired', 'EnrollmentActivated', 'EnrollmentEndingSoon', 'EnrollmentExpired', 'EnrollmentRenewed')");

            migrationBuilder.CreateIndex(
                name: "IX_DeliveryAttempts_TenantId_ChannelDeliveryId_ClaimToken",
                schema: "notifications",
                table: "DeliveryAttempts",
                columns: new[] { "TenantId", "ChannelDeliveryId", "ClaimToken" },
                unique: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_NotificationDeliveryAttempts_Success",
                schema: "notifications",
                table: "DeliveryAttempts",
                sql: "(\"Outcome\" IN ('Started', 'Succeeded')) = (\"FailureCode\" IS NULL)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NotificationDeliveryAttempts_Vocabulary",
                schema: "notifications",
                table: "DeliveryAttempts",
                sql: "\"Channel\" IN ('InApp', 'Email') AND \"Outcome\" IN ('Started', 'Succeeded', 'TransientFailure', 'PermanentFailure', 'Abandoned', 'Suppressed')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NotificationConsentEvents_Vocabulary",
                schema: "notifications",
                table: "ConsentEvents",
                sql: "\"Channel\" = 'Email' AND \"Purpose\" IN ('ServiceTransactional', 'Marketing') AND \"Decision\" IN ('Granted', 'Withdrawn')");

            migrationBuilder.CreateIndex(
                name: "IX_ChannelPreferences_TenantId_UserId_EmailMarketingConsentEve~",
                schema: "notifications",
                table: "ChannelPreferences",
                columns: new[] { "TenantId", "UserId", "EmailMarketingConsentEventId" });

            migrationBuilder.CreateIndex(
                name: "IX_ChannelPreferences_TenantId_UserId_EmailServiceConsentEvent~",
                schema: "notifications",
                table: "ChannelPreferences",
                columns: new[] { "TenantId", "UserId", "EmailServiceConsentEventId" });

            migrationBuilder.AddCheckConstraint(
                name: "CK_NotificationChannelPreferences_Decisions",
                schema: "notifications",
                table: "ChannelPreferences",
                sql: "(\"EmailServiceDecidedAtUtc\" IS NULL) = (\"EmailServiceConsentEventId\" IS NULL) AND (\"EmailMarketingDecidedAtUtc\" IS NULL) = (\"EmailMarketingConsentEventId\" IS NULL) AND (\"EmailServiceEnabled\" = false OR \"EmailServiceConsentEventId\" IS NOT NULL) AND (\"EmailMarketingEnabled\" = false OR \"EmailMarketingConsentEventId\" IS NOT NULL)");

            migrationBuilder.CreateIndex(
                name: "IX_ChannelDeliveries_TenantId_OutboxItemId_Purpose",
                schema: "notifications",
                table: "ChannelDeliveries",
                columns: new[] { "TenantId", "OutboxItemId", "Purpose" });

            migrationBuilder.AddCheckConstraint(
                name: "CK_NotificationChannelDeliveries_Claim",
                schema: "notifications",
                table: "ChannelDeliveries",
                sql: "(\"ClaimToken\" IS NULL) = (\"ClaimExpiresAtUtc\" IS NULL) AND ((\"Status\" = 'Processing') = (\"ClaimToken\" IS NOT NULL))");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NotificationChannelDeliveries_Deferral",
                schema: "notifications",
                table: "ChannelDeliveries",
                sql: "(\"DeferredUntilUtc\" IS NULL) = (\"DeferralCode\" IS NULL) AND ((\"DeferralCount\" = 0) = (\"DeferredUntilUtc\" IS NULL))");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NotificationChannelDeliveries_Failure",
                schema: "notifications",
                table: "ChannelDeliveries",
                sql: "(\"Status\" = 'Materialized' AND \"FailureCode\" IS NULL) OR (\"Status\" IN ('Suppressed', 'DeadLettered') AND \"FailureCode\" IS NOT NULL) OR \"Status\" IN ('Pending', 'Processing')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NotificationChannelDeliveries_Transport",
                schema: "notifications",
                table: "ChannelDeliveries",
                sql: "\"TransportAdapter\" IS NULL OR (\"Channel\" = 'Email' AND \"Status\" = 'Materialized')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NotificationChannelDeliveries_Vocabulary",
                schema: "notifications",
                table: "ChannelDeliveries",
                sql: "\"Channel\" IN ('InApp', 'Email') AND \"Purpose\" IN ('ServiceTransactional', 'Marketing') AND \"Status\" IN ('Pending', 'Processing', 'Materialized', 'Suppressed', 'DeadLettered')");

            migrationBuilder.AddForeignKey(
                name: "FK_ChannelDeliveries_OutboxItems_TenantId_OutboxItemId_Purpose",
                schema: "notifications",
                table: "ChannelDeliveries",
                columns: new[] { "TenantId", "OutboxItemId", "Purpose" },
                principalSchema: "notifications",
                principalTable: "OutboxItems",
                principalColumns: new[] { "TenantId", "Id", "Purpose" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_ChannelPreferences_ConsentEvents_TenantId_UserId_EmailMarke~",
                schema: "notifications",
                table: "ChannelPreferences",
                columns: new[] { "TenantId", "UserId", "EmailMarketingConsentEventId" },
                principalSchema: "notifications",
                principalTable: "ConsentEvents",
                principalColumns: new[] { "TenantId", "UserId", "Id" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_ChannelPreferences_ConsentEvents_TenantId_UserId_EmailServi~",
                schema: "notifications",
                table: "ChannelPreferences",
                columns: new[] { "TenantId", "UserId", "EmailServiceConsentEventId" },
                principalSchema: "notifications",
                principalTable: "ConsentEvents",
                principalColumns: new[] { "TenantId", "UserId", "Id" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_ChannelPreferences_Memberships_TenantId_UserId",
                schema: "notifications",
                table: "ChannelPreferences",
                columns: new[] { "TenantId", "UserId" },
                principalSchema: "tenancy",
                principalTable: "Memberships",
                principalColumns: new[] { "TenantId", "UserId" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_ConsentEvents_Memberships_TenantId_UserId",
                schema: "notifications",
                table: "ConsentEvents",
                columns: new[] { "TenantId", "UserId" },
                principalSchema: "tenancy",
                principalTable: "Memberships",
                principalColumns: new[] { "TenantId", "UserId" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_PreferenceCommandRecords_Memberships_TenantId_ActorUserId",
                schema: "notifications",
                table: "PreferenceCommandRecords",
                columns: new[] { "TenantId", "ActorUserId" },
                principalSchema: "tenancy",
                principalTable: "Memberships",
                principalColumns: new[] { "TenantId", "UserId" },
                onDelete: ReferentialAction.Restrict);

            CreateIntegrityProtections(migrationBuilder);
        }

        private static void CreateIntegrityProtections(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION notifications.protect_notification_intent()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Notification intents are never deleted' USING ERRCODE = '23514';
                    END IF;
                    IF TG_OP = 'INSERT' THEN
                        IF NEW."Status" <> 'Scheduled' OR NEW."CancelledAtUtc" IS NOT NULL THEN
                            RAISE EXCEPTION 'A notification intent must be created scheduled' USING ERRCODE = '23514';
                        END IF;
                        RETURN NEW;
                    END IF;
                    IF OLD."Id" <> NEW."Id"
                       OR OLD."TenantId" <> NEW."TenantId"
                       OR OLD."RecipientUserId" <> NEW."RecipientUserId"
                       OR OLD."AggregateId" <> NEW."AggregateId"
                       OR OLD."Kind" <> NEW."Kind"
                       OR OLD."Purpose" <> NEW."Purpose"
                       OR OLD."DeduplicationKey" <> NEW."DeduplicationKey"
                       OR OLD."PayloadJson" <> NEW."PayloadJson"
                       OR OLD."ScheduledAtUtc" <> NEW."ScheduledAtUtc"
                       OR OLD."TenantTimeZoneId" <> NEW."TenantTimeZoneId" THEN
                        RAISE EXCEPTION 'A notification intent is immutable after scheduling' USING ERRCODE = '23514';
                    END IF;
                    IF OLD."Status" = 'Cancelled' THEN
                        RAISE EXCEPTION 'A cancelled notification intent is immutable' USING ERRCODE = '23514';
                    END IF;
                    IF NEW."Status" NOT IN ('Scheduled', 'Cancelled') THEN
                        RAISE EXCEPTION 'A notification intent only transitions from scheduled to cancelled' USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER protect_notification_intent
                BEFORE INSERT OR UPDATE OR DELETE ON notifications."OutboxItems"
                FOR EACH ROW EXECUTE FUNCTION notifications.protect_notification_intent();

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
                           OR NEW."DeadLetteredAtUtc" IS NOT NULL
                           OR NEW."TransportAdapter" IS NOT NULL
                           OR NEW."ProviderMessageId" IS NOT NULL
                           OR NEW."ProviderAcceptedAtUtc" IS NOT NULL THEN
                            RAISE EXCEPTION 'A channel delivery must be created pending, unclaimed and unattempted' USING ERRCODE = '23514';
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

                    IF OLD."Status" = 'Pending' AND NEW."Status" = 'Processing' THEN
                        IF OLD."ClaimToken" IS NOT NULL OR NEW."ClaimToken" IS NULL
                           OR NEW."AttemptCount" <> OLD."AttemptCount" THEN
                            RAISE EXCEPTION 'A pending delivery is reserved without spending an attempt' USING ERRCODE = '23514';
                        END IF;
                    ELSIF OLD."Status" = 'Pending' AND NEW."Status" = 'Pending' THEN
                        IF NEW."AttemptCount" <> OLD."AttemptCount"
                           OR NEW."DeferralCount" <> OLD."DeferralCount" + 1
                           OR NEW."NextAttemptAtUtc" <= OLD."NextAttemptAtUtc" THEN
                            RAISE EXCEPTION 'A pending delivery only changes by a forward deferral' USING ERRCODE = '23514';
                        END IF;
                    ELSIF OLD."Status" = 'Pending' AND NEW."Status" IN ('Suppressed', 'DeadLettered') THEN
                        IF NEW."AttemptCount" <> OLD."AttemptCount" THEN
                            RAISE EXCEPTION 'A pre-claim terminal decision cannot spend an attempt' USING ERRCODE = '23514';
                        END IF;
                    ELSIF OLD."Status" = 'Processing' AND NEW."Status" = 'Processing' THEN
                        IF OLD."ClaimToken" = NEW."ClaimToken" THEN
                            IF NEW."AttemptCount" <> OLD."AttemptCount" + 1
                               OR NEW."ClaimExpiresAtUtc" <> OLD."ClaimExpiresAtUtc" THEN
                                RAISE EXCEPTION 'A held claim starts exactly one attempt without changing its lease' USING ERRCODE = '23514';
                            END IF;
                        ELSE
                            IF OLD."ClaimExpiresAtUtc" > CURRENT_TIMESTAMP
                               OR NEW."AttemptCount" <> OLD."AttemptCount"
                               OR NEW."ClaimExpiresAtUtc" <= OLD."ClaimExpiresAtUtc" THEN
                                RAISE EXCEPTION 'Only an expired reservation may be taken over without spending an attempt' USING ERRCODE = '23514';
                            END IF;
                        END IF;
                    ELSIF OLD."Status" = 'Processing' AND NEW."Status" = 'Pending' THEN
                        IF NEW."AttemptCount" <> OLD."AttemptCount"
                           OR NEW."NextAttemptAtUtc" <= OLD."NextAttemptAtUtc"
                           OR NEW."DeferralCount" NOT IN (OLD."DeferralCount", OLD."DeferralCount" + 1) THEN
                            RAISE EXCEPTION 'A claimed delivery returns pending only for a retry or forward deferral' USING ERRCODE = '23514';
                        END IF;
                        IF NEW."DeferralCount" = OLD."DeferralCount" + 1 AND EXISTS (
                            SELECT 1 FROM notifications."DeliveryAttempts" a
                            WHERE a."TenantId" = OLD."TenantId"
                              AND a."ChannelDeliveryId" = OLD."Id"
                              AND a."ClaimToken" = OLD."ClaimToken") THEN
                            RAISE EXCEPTION 'Quiet-hours deferral cannot discard a started attempt' USING ERRCODE = '23514';
                        END IF;
                        IF NEW."DeferralCount" = OLD."DeferralCount" AND NOT EXISTS (
                            SELECT 1 FROM notifications."DeliveryAttempts" a
                            WHERE a."TenantId" = OLD."TenantId"
                              AND a."ChannelDeliveryId" = OLD."Id"
                              AND a."ClaimToken" = OLD."ClaimToken"
                              AND a."AttemptNumber" = NEW."AttemptCount") THEN
                            RAISE EXCEPTION 'A retry must complete the attempt started by its claim' USING ERRCODE = '23514';
                        END IF;
                    ELSIF OLD."Status" = 'Processing' AND NEW."Status" IN ('Materialized', 'Suppressed', 'DeadLettered') THEN
                        IF NEW."AttemptCount" <> OLD."AttemptCount" THEN
                            RAISE EXCEPTION 'Finalizing a delivery cannot rewrite its attempt count' USING ERRCODE = '23514';
                        END IF;
                        IF NOT EXISTS (
                            SELECT 1 FROM notifications."DeliveryAttempts" a
                            WHERE a."TenantId" = OLD."TenantId"
                              AND a."ChannelDeliveryId" = OLD."Id"
                              AND a."ClaimToken" = OLD."ClaimToken"
                              AND a."AttemptNumber" = NEW."AttemptCount")
                           AND NOT (
                               OLD."ClaimExpiresAtUtc" <= CURRENT_TIMESTAMP
                               AND NEW."Status" = 'Suppressed') THEN
                            RAISE EXCEPTION 'An active claim cannot finalize without its started attempt' USING ERRCODE = '23514';
                        END IF;
                    ELSE
                        RAISE EXCEPTION 'Invalid notification channel delivery transition' USING ERRCODE = '23514';
                    END IF;

                    IF NEW."ProviderMessageId" IS NOT NULL OR NEW."ProviderAcceptedAtUtc" IS NOT NULL THEN
                        RAISE EXCEPTION 'No email provider exists yet; provider acknowledgement cannot be recorded' USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                -- Always validate the transaction's final delivery row. The original function used
                -- NEW.AttemptCount for each queued deferred event, so two legitimate updates to the
                -- same delivery in one transaction could compare an obsolete count with final history.
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
                    ELSE
                        delivery_id := NEW."ChannelDeliveryId";
                        tenant_id := NEW."TenantId";
                    END IF;

                    SELECT d."AttemptCount" INTO expected
                    FROM notifications."ChannelDeliveries" d
                    WHERE d."TenantId" = tenant_id AND d."Id" = delivery_id;
                    IF NOT FOUND THEN
                        RETURN NULL;
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
                """);

            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION notifications.assert_preference_evidence()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF NEW."EmailServiceConsentEventId" IS NOT NULL AND NOT EXISTS (
                        SELECT 1 FROM notifications."ConsentEvents" c
                        WHERE c."TenantId" = NEW."TenantId"
                          AND c."UserId" = NEW."UserId"
                          AND c."Id" = NEW."EmailServiceConsentEventId"
                          AND c."Channel" = 'Email'
                          AND c."Purpose" = 'ServiceTransactional'
                          AND c."RecordedAtUtc" = NEW."EmailServiceDecidedAtUtc"
                          AND c."Decision" = CASE WHEN NEW."EmailServiceEnabled" THEN 'Granted' ELSE 'Withdrawn' END)
                    THEN
                        RAISE EXCEPTION 'A service-email preference must point at matching append-only consent evidence' USING ERRCODE = '23514';
                    END IF;

                    IF NEW."EmailMarketingConsentEventId" IS NOT NULL AND NOT EXISTS (
                        SELECT 1 FROM notifications."ConsentEvents" c
                        WHERE c."TenantId" = NEW."TenantId"
                          AND c."UserId" = NEW."UserId"
                          AND c."Id" = NEW."EmailMarketingConsentEventId"
                          AND c."Channel" = 'Email'
                          AND c."Purpose" = 'Marketing'
                          AND c."RecordedAtUtc" = NEW."EmailMarketingDecidedAtUtc"
                          AND c."Decision" = CASE WHEN NEW."EmailMarketingEnabled" THEN 'Granted' ELSE 'Withdrawn' END)
                    THEN
                        RAISE EXCEPTION 'A marketing-email preference must point at matching append-only consent evidence' USING ERRCODE = '23514';
                    END IF;
                    RETURN NULL;
                END;
                $function$;

                CREATE OR REPLACE FUNCTION notifications.assert_consent_event_referenced()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF NEW."Purpose" = 'ServiceTransactional' AND NOT EXISTS (
                        SELECT 1 FROM notifications."ChannelPreferences" p
                        WHERE p."TenantId" = NEW."TenantId"
                          AND p."UserId" = NEW."UserId"
                          AND p."EmailServiceConsentEventId" = NEW."Id"
                          AND p."EmailServiceDecidedAtUtc" = NEW."RecordedAtUtc"
                          AND p."EmailServiceEnabled" = (NEW."Decision" = 'Granted')) THEN
                        RAISE EXCEPTION 'Service-email consent evidence must be the preference decision it explains' USING ERRCODE = '23514';
                    END IF;
                    IF NEW."Purpose" = 'Marketing' AND NOT EXISTS (
                        SELECT 1 FROM notifications."ChannelPreferences" p
                        WHERE p."TenantId" = NEW."TenantId"
                          AND p."UserId" = NEW."UserId"
                          AND p."EmailMarketingConsentEventId" = NEW."Id"
                          AND p."EmailMarketingDecidedAtUtc" = NEW."RecordedAtUtc"
                          AND p."EmailMarketingEnabled" = (NEW."Decision" = 'Granted')) THEN
                        RAISE EXCEPTION 'Marketing-email consent evidence must be the preference decision it explains' USING ERRCODE = '23514';
                    END IF;
                    RETURN NULL;
                END;
                $function$;

                CREATE CONSTRAINT TRIGGER assert_consent_event_referenced
                AFTER INSERT ON notifications."ConsentEvents"
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION notifications.assert_consent_event_referenced();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            RemoveIntegrityProtections(migrationBuilder);

            migrationBuilder.DropForeignKey(
                name: "FK_ChannelDeliveries_OutboxItems_TenantId_OutboxItemId_Purpose",
                schema: "notifications",
                table: "ChannelDeliveries");

            migrationBuilder.DropForeignKey(
                name: "FK_ChannelPreferences_ConsentEvents_TenantId_UserId_EmailMarke~",
                schema: "notifications",
                table: "ChannelPreferences");

            migrationBuilder.DropForeignKey(
                name: "FK_ChannelPreferences_ConsentEvents_TenantId_UserId_EmailServi~",
                schema: "notifications",
                table: "ChannelPreferences");

            migrationBuilder.DropForeignKey(
                name: "FK_ChannelPreferences_Memberships_TenantId_UserId",
                schema: "notifications",
                table: "ChannelPreferences");

            migrationBuilder.DropForeignKey(
                name: "FK_ConsentEvents_Memberships_TenantId_UserId",
                schema: "notifications",
                table: "ConsentEvents");

            migrationBuilder.DropForeignKey(
                name: "FK_PreferenceCommandRecords_Memberships_TenantId_ActorUserId",
                schema: "notifications",
                table: "PreferenceCommandRecords");

            migrationBuilder.DropIndex(
                name: "IX_PreferenceCommandRecords_TenantId_ActorUserId",
                schema: "notifications",
                table: "PreferenceCommandRecords");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NotificationPreferenceCommands_QuietHours",
                schema: "notifications",
                table: "PreferenceCommandRecords");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NotificationPreferenceCommands_Vocabulary",
                schema: "notifications",
                table: "PreferenceCommandRecords");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_OutboxItems_TenantId_Id_Purpose",
                schema: "notifications",
                table: "OutboxItems");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NotificationOutboxItems_Vocabulary",
                schema: "notifications",
                table: "OutboxItems");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_Memberships_TenantId_UserId",
                schema: "tenancy",
                table: "Memberships");

            migrationBuilder.DropIndex(
                name: "IX_DeliveryAttempts_TenantId_ChannelDeliveryId_ClaimToken",
                schema: "notifications",
                table: "DeliveryAttempts");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NotificationDeliveryAttempts_Success",
                schema: "notifications",
                table: "DeliveryAttempts");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NotificationDeliveryAttempts_Vocabulary",
                schema: "notifications",
                table: "DeliveryAttempts");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_ConsentEvents_TenantId_UserId_Id",
                schema: "notifications",
                table: "ConsentEvents");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NotificationConsentEvents_Vocabulary",
                schema: "notifications",
                table: "ConsentEvents");

            migrationBuilder.DropIndex(
                name: "IX_ChannelPreferences_TenantId_UserId_EmailMarketingConsentEve~",
                schema: "notifications",
                table: "ChannelPreferences");

            migrationBuilder.DropIndex(
                name: "IX_ChannelPreferences_TenantId_UserId_EmailServiceConsentEvent~",
                schema: "notifications",
                table: "ChannelPreferences");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NotificationChannelPreferences_Decisions",
                schema: "notifications",
                table: "ChannelPreferences");

            migrationBuilder.DropIndex(
                name: "IX_ChannelDeliveries_TenantId_OutboxItemId_Purpose",
                schema: "notifications",
                table: "ChannelDeliveries");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NotificationChannelDeliveries_Claim",
                schema: "notifications",
                table: "ChannelDeliveries");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NotificationChannelDeliveries_Deferral",
                schema: "notifications",
                table: "ChannelDeliveries");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NotificationChannelDeliveries_Failure",
                schema: "notifications",
                table: "ChannelDeliveries");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NotificationChannelDeliveries_Transport",
                schema: "notifications",
                table: "ChannelDeliveries");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NotificationChannelDeliveries_Vocabulary",
                schema: "notifications",
                table: "ChannelDeliveries");

            migrationBuilder.DropColumn(
                name: "ResultEmailChannelAvailable",
                schema: "notifications",
                table: "PreferenceCommandRecords");

            migrationBuilder.DropColumn(
                name: "ResultEmailMarketingEnabled",
                schema: "notifications",
                table: "PreferenceCommandRecords");

            migrationBuilder.DropColumn(
                name: "ResultEmailServiceEnabled",
                schema: "notifications",
                table: "PreferenceCommandRecords");

            migrationBuilder.DropColumn(
                name: "ResultPolicyVersion",
                schema: "notifications",
                table: "PreferenceCommandRecords");

            migrationBuilder.DropColumn(
                name: "ResultPreferenceVersion",
                schema: "notifications",
                table: "PreferenceCommandRecords");

            migrationBuilder.DropColumn(
                name: "ResultQuietHoursEnabled",
                schema: "notifications",
                table: "PreferenceCommandRecords");

            migrationBuilder.DropColumn(
                name: "ResultQuietHoursEndLocal",
                schema: "notifications",
                table: "PreferenceCommandRecords");

            migrationBuilder.DropColumn(
                name: "ResultQuietHoursStartLocal",
                schema: "notifications",
                table: "PreferenceCommandRecords");

            migrationBuilder.DropColumn(
                name: "ResultTimeZoneId",
                schema: "notifications",
                table: "PreferenceCommandRecords");

            migrationBuilder.DropColumn(
                name: "EmailMarketingConsentEventId",
                schema: "notifications",
                table: "ChannelPreferences");

            migrationBuilder.DropColumn(
                name: "EmailServiceConsentEventId",
                schema: "notifications",
                table: "ChannelPreferences");

            migrationBuilder.CreateIndex(
                name: "IX_Memberships_TenantId_UserId",
                schema: "tenancy",
                table: "Memberships",
                columns: new[] { "TenantId", "UserId" },
                unique: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_NotificationDeliveryAttempts_Success",
                schema: "notifications",
                table: "DeliveryAttempts",
                sql: "\"Outcome\" <> 'Succeeded' OR \"FailureCode\" IS NULL");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NotificationChannelPreferences_Decisions",
                schema: "notifications",
                table: "ChannelPreferences",
                sql: "(\"EmailServiceEnabled\" = false OR \"EmailServiceDecidedAtUtc\" IS NOT NULL) AND (\"EmailMarketingEnabled\" = false OR \"EmailMarketingDecidedAtUtc\" IS NOT NULL)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NotificationChannelDeliveries_Claim",
                schema: "notifications",
                table: "ChannelDeliveries",
                sql: "(\"ClaimToken\" IS NULL) = (\"ClaimExpiresAtUtc\" IS NULL) AND (\"ClaimToken\" IS NULL OR \"Status\" = 'Processing')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NotificationChannelDeliveries_Deferral",
                schema: "notifications",
                table: "ChannelDeliveries",
                sql: "(\"DeferredUntilUtc\" IS NULL) = (\"DeferralCode\" IS NULL)");

            migrationBuilder.AddForeignKey(
                name: "FK_ChannelDeliveries_OutboxItems_TenantId_OutboxItemId",
                schema: "notifications",
                table: "ChannelDeliveries",
                columns: new[] { "TenantId", "OutboxItemId" },
                principalSchema: "notifications",
                principalTable: "OutboxItems",
                principalColumns: new[] { "TenantId", "Id" },
                onDelete: ReferentialAction.Restrict);
        }

        private static void RemoveIntegrityProtections(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                DROP TRIGGER IF EXISTS protect_notification_intent ON notifications."OutboxItems";
                DROP FUNCTION IF EXISTS notifications.protect_notification_intent();
                DROP TRIGGER IF EXISTS assert_consent_event_referenced ON notifications."ConsentEvents";
                DROP FUNCTION IF EXISTS notifications.assert_consent_event_referenced();

                CREATE OR REPLACE FUNCTION notifications.assert_preference_evidence()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF NEW."TenantId" IS NULL OR NEW."UserId" IS NULL THEN
                        RETURN NULL;
                    END IF;
                    IF NEW."EmailServiceDecidedAtUtc" IS NOT NULL AND NOT EXISTS (
                        SELECT 1 FROM notifications."ConsentEvents" c
                        WHERE c."TenantId" = NEW."TenantId" AND c."UserId" = NEW."UserId"
                          AND c."Channel" = 'Email' AND c."Purpose" = 'ServiceTransactional'
                          AND c."RecordedAtUtc" = NEW."EmailServiceDecidedAtUtc"
                          AND c."Decision" = CASE WHEN NEW."EmailServiceEnabled" THEN 'Granted' ELSE 'Withdrawn' END) THEN
                        RAISE EXCEPTION 'A service-email preference must match its append-only consent evidence' USING ERRCODE = '23514';
                    END IF;
                    IF NEW."EmailMarketingDecidedAtUtc" IS NOT NULL AND NOT EXISTS (
                        SELECT 1 FROM notifications."ConsentEvents" c
                        WHERE c."TenantId" = NEW."TenantId" AND c."UserId" = NEW."UserId"
                          AND c."Channel" = 'Email' AND c."Purpose" = 'Marketing'
                          AND c."RecordedAtUtc" = NEW."EmailMarketingDecidedAtUtc"
                          AND c."Decision" = CASE WHEN NEW."EmailMarketingEnabled" THEN 'Granted' ELSE 'Withdrawn' END) THEN
                        RAISE EXCEPTION 'A marketing-email preference must match its append-only consent evidence' USING ERRCODE = '23514';
                    END IF;
                    RETURN NULL;
                END;
                $function$;

                CREATE OR REPLACE FUNCTION notifications.protect_channel_delivery()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Channel deliveries are never deleted; a terminal outcome is recorded state' USING ERRCODE = '23514';
                    END IF;
                    IF TG_OP = 'INSERT' THEN
                        IF NEW."Status" <> 'Pending' OR NEW."AttemptCount" <> 0 OR NEW."DeferralCount" <> 0
                           OR NEW."ClaimToken" IS NOT NULL OR NEW."MaterializedAtUtc" IS NOT NULL
                           OR NEW."CompletedAtUtc" IS NOT NULL OR NEW."DeadLetteredAtUtc" IS NOT NULL THEN
                            RAISE EXCEPTION 'A channel delivery must be created pending, unclaimed and unattempted' USING ERRCODE = '23514';
                        END IF;
                        IF NEW."TransportAdapter" IS NOT NULL OR NEW."ProviderMessageId" IS NOT NULL
                           OR NEW."ProviderAcceptedAtUtc" IS NOT NULL THEN
                            RAISE EXCEPTION 'A channel delivery cannot be created with transport or provider evidence' USING ERRCODE = '23514';
                        END IF;
                        RETURN NEW;
                    END IF;
                    IF OLD."Id" <> NEW."Id" OR OLD."TenantId" <> NEW."TenantId"
                       OR OLD."OutboxItemId" <> NEW."OutboxItemId" OR OLD."Channel" <> NEW."Channel"
                       OR OLD."Purpose" <> NEW."Purpose" OR OLD."SelectionReason" <> NEW."SelectionReason"
                       OR OLD."SelectionPolicyVersion" <> NEW."SelectionPolicyVersion"
                       OR OLD."DueAtUtc" <> NEW."DueAtUtc" THEN
                        RAISE EXCEPTION 'A channel delivery identity and selection provenance are immutable' USING ERRCODE = '23514';
                    END IF;
                    IF OLD."Status" IN ('Materialized', 'Suppressed', 'DeadLettered') THEN
                        RAISE EXCEPTION 'A terminal channel delivery is immutable' USING ERRCODE = '23514';
                    END IF;
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
                """);
        }
    }
}
