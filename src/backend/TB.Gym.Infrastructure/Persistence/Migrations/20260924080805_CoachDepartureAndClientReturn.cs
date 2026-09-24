using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class CoachDepartureAndClientReturn : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_NotificationOutboxItems_Vocabulary",
                schema: "notifications",
                table: "OutboxItems");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NoticeMailRequests_Vocabulary",
                schema: "tenancy",
                table: "NoticeMailRequests");

            migrationBuilder.DropIndex(
                name: "IX_ClientProfiles_TenantId_NormalizedEmail",
                schema: "clients",
                table: "ClientProfiles");

            migrationBuilder.DropIndex(
                name: "IX_ClientProfiles_TenantId_UserId",
                schema: "clients",
                table: "ClientProfiles");

            migrationBuilder.DropCheckConstraint(
                name: "CK_ClientCoachAssignments_Chain",
                schema: "clients",
                table: "ClientCoachAssignments");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NotificationOutboxItems_Vocabulary",
                schema: "notifications",
                table: "OutboxItems",
                sql: "\"Status\" IN ('Scheduled', 'Cancelled') AND \"Purpose\" = 'ServiceTransactional' AND \"Kind\" IN ('PaymentRequired', 'EnrollmentActivated', 'EnrollmentEndingSoon', 'EnrollmentExpired', 'EnrollmentRenewed', 'CoachDeparted', 'ClientLeft')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NoticeMailRequests_Vocabulary",
                schema: "tenancy",
                table: "NoticeMailRequests",
                sql: "\"Kind\" IN ('ClientReleased', 'CoachDeparted') AND \"Status\" IN ('Pending', 'Processing', 'Materialized', 'Suppressed', 'DeadLettered')");

            migrationBuilder.CreateIndex(
                name: "IX_ClientProfiles_TenantId_NormalizedEmail",
                schema: "clients",
                table: "ClientProfiles",
                columns: new[] { "TenantId", "NormalizedEmail" },
                unique: true,
                filter: "\"ReleasedAtUtc\" IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_ClientProfiles_TenantId_UserId",
                schema: "clients",
                table: "ClientProfiles",
                columns: new[] { "TenantId", "UserId" },
                unique: true,
                filter: "\"UserId\" IS NOT NULL AND \"ReleasedAtUtc\" IS NULL");

            migrationBuilder.AddCheckConstraint(
                name: "CK_ClientCoachAssignments_Chain",
                schema: "clients",
                table: "ClientCoachAssignments",
                sql: "(\"Sequence\" = 1 AND \"PreviousCoachUserId\" IS NULL AND \"Reason\" IN ('Invitation', 'Migration')) OR (\"Sequence\" > 1 AND \"PreviousCoachUserId\" IS NOT NULL AND \"PreviousCoachUserId\" <> \"CoachUserId\" AND \"Reason\" IN ('Reassigned', 'CoachRemoved', 'Released', 'CoachResigned', 'ClientLeft'))");

            // ---------- a former client may be invited back (ADR 0027, updated 2026-09-24) ----------
            // "A released client's membership never becomes active again" becomes "a client membership
            // becomes active again only with a current profile": a re-invitation creates that profile
            // in the same transaction, while a bare reactivation of a released client is still refused.
            migrationBuilder.Sql("""
                DROP TRIGGER IF EXISTS "TR_Memberships_ReleasedClient" ON tenancy."Memberships";
                DROP FUNCTION IF EXISTS tenancy.protect_released_client_membership();

                CREATE OR REPLACE FUNCTION tenancy.assert_active_client_has_current_profile()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF NEW."Role" = 'Client' AND NEW."Status" = 'Active' AND OLD."Status" <> 'Active'
                       AND NOT EXISTS (
                        SELECT 1 FROM clients."ClientProfiles" AS client
                        WHERE client."TenantId" = NEW."TenantId"
                          AND client."UserId" = NEW."UserId"
                          AND client."ReleasedAtUtc" IS NULL) THEN
                        RAISE EXCEPTION 'An active client membership needs a current client profile'
                            USING ERRCODE = '23514';
                    END IF;
                    RETURN NULL;
                END;
                $function$;

                CREATE CONSTRAINT TRIGGER "TR_Memberships_ActiveClientHasCurrentProfile"
                AFTER UPDATE OF "Status" ON tenancy."Memberships"
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION tenancy.assert_active_client_has_current_profile();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP TRIGGER IF EXISTS "TR_Memberships_ActiveClientHasCurrentProfile" ON tenancy."Memberships";
                DROP FUNCTION IF EXISTS tenancy.assert_active_client_has_current_profile();

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
                """);

            migrationBuilder.DropCheckConstraint(
                name: "CK_NotificationOutboxItems_Vocabulary",
                schema: "notifications",
                table: "OutboxItems");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NoticeMailRequests_Vocabulary",
                schema: "tenancy",
                table: "NoticeMailRequests");

            migrationBuilder.DropIndex(
                name: "IX_ClientProfiles_TenantId_NormalizedEmail",
                schema: "clients",
                table: "ClientProfiles");

            migrationBuilder.DropIndex(
                name: "IX_ClientProfiles_TenantId_UserId",
                schema: "clients",
                table: "ClientProfiles");

            migrationBuilder.DropCheckConstraint(
                name: "CK_ClientCoachAssignments_Chain",
                schema: "clients",
                table: "ClientCoachAssignments");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NotificationOutboxItems_Vocabulary",
                schema: "notifications",
                table: "OutboxItems",
                sql: "\"Status\" IN ('Scheduled', 'Cancelled') AND \"Purpose\" = 'ServiceTransactional' AND \"Kind\" IN ('PaymentRequired', 'EnrollmentActivated', 'EnrollmentEndingSoon', 'EnrollmentExpired', 'EnrollmentRenewed')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NoticeMailRequests_Vocabulary",
                schema: "tenancy",
                table: "NoticeMailRequests",
                sql: "\"Kind\" IN ('ClientReleased') AND \"Status\" IN ('Pending', 'Processing', 'Materialized', 'Suppressed', 'DeadLettered')");

            migrationBuilder.CreateIndex(
                name: "IX_ClientProfiles_TenantId_NormalizedEmail",
                schema: "clients",
                table: "ClientProfiles",
                columns: new[] { "TenantId", "NormalizedEmail" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ClientProfiles_TenantId_UserId",
                schema: "clients",
                table: "ClientProfiles",
                columns: new[] { "TenantId", "UserId" },
                unique: true,
                filter: "\"UserId\" IS NOT NULL");

            migrationBuilder.AddCheckConstraint(
                name: "CK_ClientCoachAssignments_Chain",
                schema: "clients",
                table: "ClientCoachAssignments",
                sql: "(\"Sequence\" = 1 AND \"PreviousCoachUserId\" IS NULL AND \"Reason\" IN ('Invitation', 'Migration')) OR (\"Sequence\" > 1 AND \"PreviousCoachUserId\" IS NOT NULL AND \"PreviousCoachUserId\" <> \"CoachUserId\" AND \"Reason\" IN ('Reassigned', 'CoachRemoved', 'Released'))");
        }
    }
}
