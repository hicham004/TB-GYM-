using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ReleaseClient : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_ClientCoachAssignments_Chain",
                schema: "clients",
                table: "ClientCoachAssignments");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "ReleasedAtUtc",
                schema: "clients",
                table: "ClientProfiles",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "NoticeMailRequests",
                schema: "tenancy",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    RecipientUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    SubjectId = table.Column<Guid>(type: "uuid", nullable: false),
                    SchemaVersion = table.Column<int>(type: "integer", nullable: false),
                    RequestedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    RequestedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    AttemptCount = table.Column<int>(type: "integer", nullable: false),
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
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NoticeMailRequests", x => x.Id);
                    table.UniqueConstraint("AK_NoticeMailRequests_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_NoticeMailRequests_CapturedHasNoProvider", "\"TransportAdapter\" <> 'captured' OR (\"ProviderMessageId\" IS NULL AND \"ProviderAcceptedAtUtc\" IS NULL)");
                    table.CheckConstraint("CK_NoticeMailRequests_Claim", "(\"ClaimToken\" IS NULL) = (\"ClaimExpiresAtUtc\" IS NULL) AND ((\"Status\" = 'Processing') = (\"ClaimToken\" IS NOT NULL))");
                    table.CheckConstraint("CK_NoticeMailRequests_Completion", "(\"Status\" IN ('Materialized', 'Suppressed', 'DeadLettered')) = (\"CompletedAtUtc\" IS NOT NULL)");
                    table.CheckConstraint("CK_NoticeMailRequests_Counters", "\"AttemptCount\" >= 0 AND \"SchemaVersion\" >= 1");
                    table.CheckConstraint("CK_NoticeMailRequests_DeadLettered", "(\"Status\" = 'DeadLettered') = (\"DeadLetteredAtUtc\" IS NOT NULL)");
                    table.CheckConstraint("CK_NoticeMailRequests_Failure", "(\"Status\" = 'Materialized' AND \"FailureCode\" IS NULL) OR (\"Status\" IN ('Suppressed', 'DeadLettered') AND \"FailureCode\" IS NOT NULL) OR \"Status\" IN ('Pending', 'Processing')");
                    table.CheckConstraint("CK_NoticeMailRequests_Materialized", "(\"Status\" = 'Materialized') = (\"MaterializedAtUtc\" IS NOT NULL)");
                    table.CheckConstraint("CK_NoticeMailRequests_NextAttempt", "\"NextAttemptAtUtc\" >= \"RequestedAtUtc\"");
                    table.CheckConstraint("CK_NoticeMailRequests_ProviderEvidence", "((\"ProviderMessageId\" IS NULL) = (\"ProviderAcceptedAtUtc\" IS NULL)) AND (\"ProviderMessageId\" IS NULL OR (\"Status\" = 'Materialized' AND \"TransportAdapter\" IN ('resend')))");
                    table.CheckConstraint("CK_NoticeMailRequests_Transport", "\"TransportAdapter\" IS NULL OR \"Status\" = 'Materialized'");
                    table.CheckConstraint("CK_NoticeMailRequests_Vocabulary", "\"Kind\" IN ('ClientReleased') AND \"Status\" IN ('Pending', 'Processing', 'Materialized', 'Suppressed', 'DeadLettered')");
                    table.ForeignKey(
                        name: "FK_NoticeMailRequests_Memberships_TenantId_RecipientUserId",
                        columns: x => new { x.TenantId, x.RecipientUserId },
                        principalSchema: "tenancy",
                        principalTable: "Memberships",
                        principalColumns: new[] { "TenantId", "UserId" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_NoticeMailRequests_Users_RequestedByUserId",
                        column: x => x.RequestedByUserId,
                        principalSchema: "identity",
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "NoticeMailAttempts",
                schema: "tenancy",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RequestId = table.Column<Guid>(type: "uuid", nullable: false),
                    AttemptNumber = table.Column<int>(type: "integer", nullable: false),
                    ClaimToken = table.Column<Guid>(type: "uuid", nullable: false),
                    ProviderIdempotencyKey = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    StartedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CompletedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    Outcome = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    FailureCode = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    ProviderMessageId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NoticeMailAttempts", x => x.Id);
                    table.CheckConstraint("CK_NoticeMailAttempts_AttemptNumber", "\"AttemptNumber\" >= 1");
                    table.CheckConstraint("CK_NoticeMailAttempts_Completion", "(\"Outcome\" = 'Started') = (\"CompletedAtUtc\" IS NULL)");
                    table.CheckConstraint("CK_NoticeMailAttempts_ProviderEvidence", "\"ProviderMessageId\" IS NULL OR \"Outcome\" = 'Succeeded'");
                    table.CheckConstraint("CK_NoticeMailAttempts_ProviderKeyShape", "\"ProviderIdempotencyKey\" = 'workspace-notice:' || replace(\"RequestId\"::text, '-', '') || ':a' || \"AttemptNumber\"::text || ':v1:' || right(\"ProviderIdempotencyKey\", 32) AND right(\"ProviderIdempotencyKey\", 32) ~ '^[0-9a-f]{32}$'");
                    table.CheckConstraint("CK_NoticeMailAttempts_Success", "(\"Outcome\" IN ('Started', 'Succeeded')) = (\"FailureCode\" IS NULL)");
                    table.CheckConstraint("CK_NoticeMailAttempts_Vocabulary", "\"Outcome\" IN ('Started', 'Succeeded', 'TransientFailure', 'PermanentFailure', 'Abandoned', 'Suppressed')");
                    table.ForeignKey(
                        name: "FK_NoticeMailAttempts_NoticeMailRequests_TenantId_RequestId",
                        columns: x => new { x.TenantId, x.RequestId },
                        principalSchema: "tenancy",
                        principalTable: "NoticeMailRequests",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ClientProfiles_TenantId_ReleasedAtUtc",
                schema: "clients",
                table: "ClientProfiles",
                columns: new[] { "TenantId", "ReleasedAtUtc" },
                filter: "\"ReleasedAtUtc\" IS NOT NULL");

            migrationBuilder.AddCheckConstraint(
                name: "CK_ClientCoachAssignments_Chain",
                schema: "clients",
                table: "ClientCoachAssignments",
                sql: "(\"Sequence\" = 1 AND \"PreviousCoachUserId\" IS NULL AND \"Reason\" IN ('Invitation', 'Migration')) OR (\"Sequence\" > 1 AND \"PreviousCoachUserId\" IS NOT NULL AND \"PreviousCoachUserId\" <> \"CoachUserId\" AND \"Reason\" IN ('Reassigned', 'CoachRemoved', 'Released'))");

            migrationBuilder.CreateIndex(
                name: "IX_NoticeMailAttempts_ProviderIdempotencyKey",
                schema: "tenancy",
                table: "NoticeMailAttempts",
                column: "ProviderIdempotencyKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_NoticeMailAttempts_TenantId_RequestId_AttemptNumber",
                schema: "tenancy",
                table: "NoticeMailAttempts",
                columns: new[] { "TenantId", "RequestId", "AttemptNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_NoticeMailAttempts_TenantId_RequestId_ClaimToken",
                schema: "tenancy",
                table: "NoticeMailAttempts",
                columns: new[] { "TenantId", "RequestId", "ClaimToken" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_NoticeMailRequests_RequestedByUserId",
                schema: "tenancy",
                table: "NoticeMailRequests",
                column: "RequestedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_NoticeMailRequests_Status_ClaimExpiresAtUtc",
                schema: "tenancy",
                table: "NoticeMailRequests",
                columns: new[] { "Status", "ClaimExpiresAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_NoticeMailRequests_Status_NextAttemptAtUtc_Id",
                schema: "tenancy",
                table: "NoticeMailRequests",
                columns: new[] { "Status", "NextAttemptAtUtc", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_NoticeMailRequests_TenantId_Kind_SubjectId",
                schema: "tenancy",
                table: "NoticeMailRequests",
                columns: new[] { "TenantId", "Kind", "SubjectId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_NoticeMailRequests_TenantId_RecipientUserId",
                schema: "tenancy",
                table: "NoticeMailRequests",
                columns: new[] { "TenantId", "RecipientUserId" });

            // ---------- guards: a release is permanent and read-only (ADR 0027) ----------
            migrationBuilder.Sql("""
                -- A released client's record is kept exactly as it was released.
                CREATE OR REPLACE FUNCTION clients.freeze_released_client()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF OLD."ReleasedAtUtc" IS NOT NULL THEN
                        RAISE EXCEPTION 'A released client''s record is read-only' USING ERRCODE = '55000';
                    END IF;
                    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
                END;
                $function$;

                CREATE TRIGGER "TR_ClientProfiles_FreezeReleased"
                BEFORE UPDATE OR DELETE ON clients."ClientProfiles"
                FOR EACH ROW EXECUTE FUNCTION clients.freeze_released_client();

                -- No undo: a released client's membership never becomes active, or anything else, again.
                -- Scoped to released clients; a membership removed some other way is not a release.
                CREATE OR REPLACE FUNCTION tenancy.protect_released_client_membership()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF OLD."Role" = 'Client' AND OLD."Status" = 'Removed'
                       AND (NEW."Status" <> 'Removed' OR NEW."Role" <> 'Client')
                       AND EXISTS (
                        SELECT 1 FROM clients."ClientProfiles" AS client
                        WHERE client."TenantId" = OLD."TenantId"
                          AND client."UserId" = OLD."UserId"
                          AND client."ReleasedAtUtc" IS NOT NULL) THEN
                        RAISE EXCEPTION 'A released client cannot rejoin the workspace' USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER "TR_Memberships_ReleasedClient"
                BEFORE UPDATE ON tenancy."Memberships"
                FOR EACH ROW EXECUTE FUNCTION tenancy.protect_released_client_membership();

                -- At commit: a released client has no active membership in that workspace.
                CREATE OR REPLACE FUNCTION clients.assert_released_client_has_no_access()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF NEW."ReleasedAtUtc" IS NOT NULL AND NEW."UserId" IS NOT NULL AND EXISTS (
                        SELECT 1 FROM tenancy."Memberships" AS membership
                        WHERE membership."TenantId" = NEW."TenantId"
                          AND membership."UserId" = NEW."UserId"
                          AND membership."Status" = 'Active') THEN
                        RAISE EXCEPTION 'A released client keeps no active membership' USING ERRCODE = '23514';
                    END IF;
                    RETURN NULL;
                END;
                $function$;

                CREATE CONSTRAINT TRIGGER "TR_ClientProfiles_ReleasedHasNoAccess"
                AFTER INSERT OR UPDATE OF "ReleasedAtUtc" ON clients."ClientProfiles"
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION clients.assert_released_client_has_no_access();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP TRIGGER IF EXISTS "TR_ClientProfiles_ReleasedHasNoAccess" ON clients."ClientProfiles";
                DROP FUNCTION IF EXISTS clients.assert_released_client_has_no_access();
                DROP TRIGGER IF EXISTS "TR_Memberships_ReleasedClient" ON tenancy."Memberships";
                DROP FUNCTION IF EXISTS tenancy.protect_released_client_membership();
                DROP TRIGGER IF EXISTS "TR_ClientProfiles_FreezeReleased" ON clients."ClientProfiles";
                DROP FUNCTION IF EXISTS clients.freeze_released_client();
                """);

            migrationBuilder.DropTable(
                name: "NoticeMailAttempts",
                schema: "tenancy");

            migrationBuilder.DropTable(
                name: "NoticeMailRequests",
                schema: "tenancy");

            migrationBuilder.DropIndex(
                name: "IX_ClientProfiles_TenantId_ReleasedAtUtc",
                schema: "clients",
                table: "ClientProfiles");

            migrationBuilder.DropCheckConstraint(
                name: "CK_ClientCoachAssignments_Chain",
                schema: "clients",
                table: "ClientCoachAssignments");

            migrationBuilder.DropColumn(
                name: "ReleasedAtUtc",
                schema: "clients",
                table: "ClientProfiles");

            migrationBuilder.AddCheckConstraint(
                name: "CK_ClientCoachAssignments_Chain",
                schema: "clients",
                table: "ClientCoachAssignments",
                sql: "(\"Sequence\" = 1 AND \"PreviousCoachUserId\" IS NULL AND \"Reason\" IN ('Invitation', 'Migration')) OR (\"Sequence\" > 1 AND \"PreviousCoachUserId\" IS NOT NULL AND \"PreviousCoachUserId\" <> \"CoachUserId\" AND \"Reason\" IN ('Reassigned', 'CoachRemoved'))");
        }
    }
}
