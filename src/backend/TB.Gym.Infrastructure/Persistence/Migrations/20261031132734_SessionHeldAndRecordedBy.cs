using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class SessionHeldAndRecordedBy : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "RecordedByUserId",
                schema: "subscriptions",
                table: "SessionLedgerEntries",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_SessionLedgerEntries_TenantId_RecordedByUserId",
                schema: "subscriptions",
                table: "SessionLedgerEntries",
                columns: new[] { "TenantId", "RecordedByUserId" });

            migrationBuilder.AddCheckConstraint(
                name: "CK_SessionLedgerEntries_RecordedBy",
                schema: "subscriptions",
                table: "SessionLedgerEntries",
                sql: "\"RecordedByUserId\" IS NULL OR \"Kind\" = 'Held' OR (\"Kind\" = 'Charged' AND \"RecordedByUserId\" = \"CoachUserId\")");

            migrationBuilder.AddForeignKey(
                name: "FK_SessionLedgerEntries_Memberships_TenantId_RecordedByUserId",
                schema: "subscriptions",
                table: "SessionLedgerEntries",
                columns: new[] { "TenantId", "RecordedByUserId" },
                principalSchema: "tenancy",
                principalTable: "Memberships",
                principalColumns: new[] { "TenantId", "UserId" },
                onDelete: ReferentialAction.Restrict);

            // SES-003, critique B12. The guard runs on insert alone, so a row from before this migration keeps its null
            // and counts who recorded it as who held it, while every new session keeps both people and names active
            // staff of the workspace, whoever writes. The command takes that membership's lock, so the guard never
            // fires in normal use.
            migrationBuilder.Sql("""
                CREATE OR REPLACE FUNCTION subscriptions.guard_session_entry()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $function$
                DECLARE
                    pack RECORD;
                    sessions_left integer;
                BEGIN
                    SELECT "ClientProfileId", "SessionCountSnapshot", "StartDate", "EndDateExclusive", "Status"
                    INTO pack
                    FROM subscriptions."ClientEnrollments"
                    WHERE "TenantId" = NEW."TenantId" AND "Id" = NEW."EnrollmentId"
                    FOR UPDATE;

                    IF NOT FOUND
                       OR pack."SessionCountSnapshot" IS NULL
                       OR pack."ClientProfileId" IS DISTINCT FROM NEW."ClientProfileId" THEN
                        RAISE EXCEPTION 'A session entry belongs to a session pack of its client' USING ERRCODE = '23514';
                    END IF;

                    IF NEW."Kind" = 'Issued' THEN
                        IF NEW."Count" <> pack."SessionCountSnapshot" THEN
                            RAISE EXCEPTION 'A pack issues the sessions it was sold with' USING ERRCODE = '23514';
                        END IF;
                    ELSIF NEW."Kind" = 'Voided' THEN
                        IF NOT EXISTS (
                            SELECT 1 FROM subscriptions."SessionLedgerEntries"
                            WHERE "TenantId" = NEW."TenantId"
                              AND "Id" = NEW."VoidsEntryId"
                              AND "EnrollmentId" = NEW."EnrollmentId"
                              AND "Kind" IN ('Held', 'Charged')) THEN
                            RAISE EXCEPTION 'A correction undoes a session held or charged on the same pack' USING ERRCODE = '23514';
                        END IF;
                    ELSE
                        IF NEW."RecordedByUserId" IS NULL THEN
                            RAISE EXCEPTION 'A session keeps who recorded it' USING ERRCODE = '23514';
                        END IF;

                        IF NOT EXISTS (
                            SELECT 1 FROM tenancy."Memberships"
                            WHERE "TenantId" = NEW."TenantId"
                              AND "UserId" = NEW."CoachUserId"
                              AND "Status" = 'Active'
                              AND "Role" IN ('Owner', 'Coach')) THEN
                            RAISE EXCEPTION 'A session is held by active staff of the workspace' USING ERRCODE = '23514';
                        END IF;

                        IF pack."Status" NOT IN ('Active', 'Expired')
                           OR NEW."Day" < pack."StartDate"
                           OR NEW."Day" >= pack."EndDateExclusive" THEN
                            RAISE EXCEPTION 'A session goes on a paid pack, inside its dates' USING ERRCODE = '23514';
                        END IF;

                        SELECT COALESCE(SUM(CASE WHEN "Kind" IN ('Issued', 'Voided') THEN "Count" ELSE -"Count" END), 0)
                        INTO sessions_left
                        FROM subscriptions."SessionLedgerEntries"
                        WHERE "TenantId" = NEW."TenantId" AND "EnrollmentId" = NEW."EnrollmentId";

                        IF sessions_left < 1 THEN
                            RAISE EXCEPTION 'This pack has no sessions left' USING ERRCODE = '23514';
                        END IF;
                    END IF;

                    RETURN NEW;
                END;
                $function$;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                CREATE OR REPLACE FUNCTION subscriptions.guard_session_entry()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $function$
                DECLARE
                    pack RECORD;
                    sessions_left integer;
                BEGIN
                    SELECT "ClientProfileId", "SessionCountSnapshot", "StartDate", "EndDateExclusive", "Status"
                    INTO pack
                    FROM subscriptions."ClientEnrollments"
                    WHERE "TenantId" = NEW."TenantId" AND "Id" = NEW."EnrollmentId"
                    FOR UPDATE;

                    IF NOT FOUND
                       OR pack."SessionCountSnapshot" IS NULL
                       OR pack."ClientProfileId" IS DISTINCT FROM NEW."ClientProfileId" THEN
                        RAISE EXCEPTION 'A session entry belongs to a session pack of its client' USING ERRCODE = '23514';
                    END IF;

                    IF NEW."Kind" = 'Issued' THEN
                        IF NEW."Count" <> pack."SessionCountSnapshot" THEN
                            RAISE EXCEPTION 'A pack issues the sessions it was sold with' USING ERRCODE = '23514';
                        END IF;
                    ELSIF NEW."Kind" = 'Voided' THEN
                        IF NOT EXISTS (
                            SELECT 1 FROM subscriptions."SessionLedgerEntries"
                            WHERE "TenantId" = NEW."TenantId"
                              AND "Id" = NEW."VoidsEntryId"
                              AND "EnrollmentId" = NEW."EnrollmentId"
                              AND "Kind" IN ('Held', 'Charged')) THEN
                            RAISE EXCEPTION 'A correction undoes a session held or charged on the same pack' USING ERRCODE = '23514';
                        END IF;
                    ELSE
                        IF pack."Status" NOT IN ('Active', 'Expired')
                           OR NEW."Day" < pack."StartDate"
                           OR NEW."Day" >= pack."EndDateExclusive" THEN
                            RAISE EXCEPTION 'A session goes on a paid pack, inside its dates' USING ERRCODE = '23514';
                        END IF;

                        SELECT COALESCE(SUM(CASE WHEN "Kind" IN ('Issued', 'Voided') THEN "Count" ELSE -"Count" END), 0)
                        INTO sessions_left
                        FROM subscriptions."SessionLedgerEntries"
                        WHERE "TenantId" = NEW."TenantId" AND "EnrollmentId" = NEW."EnrollmentId";

                        IF sessions_left < 1 THEN
                            RAISE EXCEPTION 'This pack has no sessions left' USING ERRCODE = '23514';
                        END IF;
                    END IF;

                    RETURN NEW;
                END;
                $function$;
                """);

            migrationBuilder.DropForeignKey(
                name: "FK_SessionLedgerEntries_Memberships_TenantId_RecordedByUserId",
                schema: "subscriptions",
                table: "SessionLedgerEntries");

            migrationBuilder.DropIndex(
                name: "IX_SessionLedgerEntries_TenantId_RecordedByUserId",
                schema: "subscriptions",
                table: "SessionLedgerEntries");

            migrationBuilder.DropCheckConstraint(
                name: "CK_SessionLedgerEntries_RecordedBy",
                schema: "subscriptions",
                table: "SessionLedgerEntries");

            migrationBuilder.DropColumn(
                name: "RecordedByUserId",
                schema: "subscriptions",
                table: "SessionLedgerEntries");
        }
    }
}
