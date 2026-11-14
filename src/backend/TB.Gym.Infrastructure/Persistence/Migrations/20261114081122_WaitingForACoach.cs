using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Notes plan N9d1b (C8's decision of 14 Oct 2026; ADR 0026 amended, CLI-012): a client's coach may be empty, the
    /// client waiting for a coach. The coach history may name nobody, its chain check and trigger read a waiting entry,
    /// a coach leaving from now on leaves their clients waiting (never handing them to anyone), the client-coach trigger
    /// accepts an empty coach only with a matching newest entry, a released record always keeps a keeper, and the
    /// outbox learns the notice that tells a client they have a new coach. The departing-staff, append-only and
    /// invitation guards stay as they are.
    /// </summary>
    /// <remarks>
    /// Only constraints change: DROP NOT NULL rewrites no row and fires no trigger, so a released client's frozen profile
    /// is left exactly as it was, and every existing row passes the new checks.
    /// </remarks>
    public partial class WaitingForACoach : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_NotificationOutboxItems_Vocabulary",
                schema: "notifications",
                table: "OutboxItems");

            migrationBuilder.DropCheckConstraint(
                name: "CK_ClientCoachAssignments_Chain",
                schema: "clients",
                table: "ClientCoachAssignments");

            migrationBuilder.AlterColumn<Guid>(
                name: "AssignedCoachUserId",
                schema: "clients",
                table: "ClientProfiles",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.AlterColumn<Guid>(
                name: "CoachUserId",
                schema: "clients",
                table: "ClientCoachAssignments",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NotificationOutboxItems_Vocabulary",
                schema: "notifications",
                table: "OutboxItems",
                sql: "\"Status\" IN ('Scheduled', 'Cancelled') AND \"Purpose\" = 'ServiceTransactional' AND \"Kind\" IN ('PaymentRequired', 'EnrollmentActivated', 'EnrollmentEndingSoon', 'EnrollmentExpired', 'EnrollmentRenewed', 'CoachDeparted', 'ClientLeft', 'CoachResigned', 'RenewalRequested', 'ProgramAssigned', 'WeeksShared', 'WeeksChanged', 'CoachWorkoutNote', 'ClientWorkoutNote', 'HousePlanAsked', 'HousePlanMoneySent', 'CoachAssigned', 'TraineeStaffChanged')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_ClientProfiles_ReleasedHasKeeper",
                schema: "clients",
                table: "ClientProfiles",
                sql: "\"ReleasedAtUtc\" IS NULL OR \"AssignedCoachUserId\" IS NOT NULL");

            migrationBuilder.AddCheckConstraint(
                name: "CK_ClientCoachAssignments_Chain",
                schema: "clients",
                table: "ClientCoachAssignments",
                sql: "(\"Sequence\" = 1 AND \"PreviousCoachUserId\" IS NULL AND (\"Reason\" IN ('Invitation', 'SignUp') OR (\"Reason\" = 'Migration' AND \"CoachUserId\" IS NOT NULL))) OR (\"Sequence\" > 1 AND \"PreviousCoachUserId\" IS DISTINCT FROM \"CoachUserId\" AND ((\"Reason\" IN ('CoachRemoved', 'CoachResigned') AND \"PreviousCoachUserId\" IS NOT NULL) OR (\"Reason\" IN ('Reassigned', 'Released', 'ClientLeft') AND \"CoachUserId\" IS NOT NULL)))");

            migrationBuilder.Sql(
                """
                -- Every later entry names the coach of the entry before it, nobody included, so the chain cannot skip
                -- and a client leaves a wait only from the entry that began it. A coach leaving from now on leaves the
                -- client waiting: the Owner never gets a departing coach's clients automatically (C8). The departures
                -- that named the Owner before this migration stay as they are; a BEFORE INSERT trigger never reads them.
                CREATE OR REPLACE FUNCTION clients.assert_coach_assignment_chain()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF NEW."Sequence" > 1 AND NOT EXISTS (
                        SELECT 1 FROM clients."ClientCoachAssignments" AS previous
                        WHERE previous."TenantId" = NEW."TenantId"
                          AND previous."ClientProfileId" = NEW."ClientProfileId"
                          AND previous."Sequence" = NEW."Sequence" - 1
                          AND previous."CoachUserId" IS NOT DISTINCT FROM NEW."PreviousCoachUserId") THEN
                        RAISE EXCEPTION 'A coach assignment must follow the previous assignment of the same client'
                            USING ERRCODE = '23514';
                    END IF;
                    IF NEW."Reason" IN ('CoachRemoved', 'CoachResigned') AND NEW."CoachUserId" IS NOT NULL THEN
                        RAISE EXCEPTION 'A coach leaving leaves their clients waiting for a coach'
                            USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                -- At commit: a client's coach, when they have one, is active Owner/Coach staff; named or empty, it is
                -- exactly the coach the newest history entry names, so the coach never changes, or empties, without
                -- history.
                CREATE OR REPLACE FUNCTION clients.assert_client_coach()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF NEW."AssignedCoachUserId" IS NOT NULL AND NOT EXISTS (
                        SELECT 1 FROM tenancy."Memberships" AS membership
                        WHERE membership."TenantId" = NEW."TenantId"
                          AND membership."UserId" = NEW."AssignedCoachUserId"
                          AND membership."Status" = 'Active'
                          AND membership."Role" IN ('Owner', 'Coach')) THEN
                        RAISE EXCEPTION 'A client is assigned only to an active owner or coach of the workspace'
                            USING ERRCODE = '23514';
                    END IF;

                    IF NOT EXISTS (
                        SELECT 1 FROM clients."ClientCoachAssignments" AS entry
                        WHERE entry."TenantId" = NEW."TenantId"
                          AND entry."ClientProfileId" = NEW."Id"
                          AND entry."CoachUserId" IS NOT DISTINCT FROM NEW."AssignedCoachUserId"
                          AND entry."Sequence" = (
                              SELECT max(latest."Sequence") FROM clients."ClientCoachAssignments" AS latest
                              WHERE latest."TenantId" = NEW."TenantId"
                                AND latest."ClientProfileId" = NEW."Id")) THEN
                        RAISE EXCEPTION 'A client coach change must be recorded in the assignment history'
                            USING ERRCODE = '23514';
                    END IF;
                    RETURN NULL;
                END;
                $function$;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // A client waiting for a coach, a history entry that names nobody and a notice of a new coach are facts the
            // schema before this cannot hold, and the history is append-only: stop with a plain message while any
            // exists instead of rewriting them. An entry after the first with no previous coach exists only after one
            // that names nobody, as the chain trigger guarantees.
            migrationBuilder.Sql(
                """
                DO $migration$
                BEGIN
                    IF EXISTS (SELECT 1 FROM clients."ClientProfiles" WHERE "AssignedCoachUserId" IS NULL)
                        OR EXISTS (SELECT 1 FROM clients."ClientCoachAssignments" WHERE "CoachUserId" IS NULL)
                        OR EXISTS (SELECT 1 FROM notifications."OutboxItems" WHERE "Kind" IN ('CoachAssigned', 'TraineeStaffChanged')) THEN
                        RAISE EXCEPTION 'Clients waited for a coach; roll forward instead of reverting this migration.'
                            USING ERRCODE = '55000';
                    END IF;
                END;
                $migration$;
                """);

            // The two functions as TeamCoachAssignment wrote them.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION clients.assert_coach_assignment_chain()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF NEW."Sequence" > 1 AND NOT EXISTS (
                        SELECT 1 FROM clients."ClientCoachAssignments" AS previous
                        WHERE previous."TenantId" = NEW."TenantId"
                          AND previous."ClientProfileId" = NEW."ClientProfileId"
                          AND previous."Sequence" = NEW."Sequence" - 1
                          AND previous."CoachUserId" = NEW."PreviousCoachUserId") THEN
                        RAISE EXCEPTION 'A coach assignment must follow the previous assignment of the same client'
                            USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE OR REPLACE FUNCTION clients.assert_client_coach()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM tenancy."Memberships" AS membership
                        WHERE membership."TenantId" = NEW."TenantId"
                          AND membership."UserId" = NEW."AssignedCoachUserId"
                          AND membership."Status" = 'Active'
                          AND membership."Role" IN ('Owner', 'Coach')) THEN
                        RAISE EXCEPTION 'A client is assigned only to an active owner or coach of the workspace'
                            USING ERRCODE = '23514';
                    END IF;

                    IF NOT EXISTS (
                        SELECT 1 FROM clients."ClientCoachAssignments" AS entry
                        WHERE entry."TenantId" = NEW."TenantId"
                          AND entry."ClientProfileId" = NEW."Id"
                          AND entry."CoachUserId" = NEW."AssignedCoachUserId"
                          AND entry."Sequence" = (
                              SELECT max(latest."Sequence") FROM clients."ClientCoachAssignments" AS latest
                              WHERE latest."TenantId" = NEW."TenantId"
                                AND latest."ClientProfileId" = NEW."Id")) THEN
                        RAISE EXCEPTION 'A client coach change must be recorded in the assignment history'
                            USING ERRCODE = '23514';
                    END IF;
                    RETURN NULL;
                END;
                $function$;
                """);

            migrationBuilder.DropCheckConstraint(
                name: "CK_NotificationOutboxItems_Vocabulary",
                schema: "notifications",
                table: "OutboxItems");

            migrationBuilder.DropCheckConstraint(
                name: "CK_ClientProfiles_ReleasedHasKeeper",
                schema: "clients",
                table: "ClientProfiles");

            migrationBuilder.DropCheckConstraint(
                name: "CK_ClientCoachAssignments_Chain",
                schema: "clients",
                table: "ClientCoachAssignments");

            // No default: the columns never had one, and every row holds a value once the check above has passed.
            migrationBuilder.AlterColumn<Guid>(
                name: "AssignedCoachUserId",
                schema: "clients",
                table: "ClientProfiles",
                type: "uuid",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.AlterColumn<Guid>(
                name: "CoachUserId",
                schema: "clients",
                table: "ClientCoachAssignments",
                type: "uuid",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_NotificationOutboxItems_Vocabulary",
                schema: "notifications",
                table: "OutboxItems",
                sql: "\"Status\" IN ('Scheduled', 'Cancelled') AND \"Purpose\" = 'ServiceTransactional' AND \"Kind\" IN ('PaymentRequired', 'EnrollmentActivated', 'EnrollmentEndingSoon', 'EnrollmentExpired', 'EnrollmentRenewed', 'CoachDeparted', 'ClientLeft', 'CoachResigned', 'RenewalRequested', 'ProgramAssigned', 'WeeksShared', 'WeeksChanged', 'CoachWorkoutNote', 'ClientWorkoutNote', 'HousePlanAsked', 'HousePlanMoneySent')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_ClientCoachAssignments_Chain",
                schema: "clients",
                table: "ClientCoachAssignments",
                sql: "(\"Sequence\" = 1 AND \"PreviousCoachUserId\" IS NULL AND \"Reason\" IN ('Invitation', 'Migration', 'SignUp')) OR (\"Sequence\" > 1 AND \"PreviousCoachUserId\" IS NOT NULL AND \"PreviousCoachUserId\" <> \"CoachUserId\" AND \"Reason\" IN ('Reassigned', 'CoachRemoved', 'Released', 'CoachResigned', 'ClientLeft'))");
        }
    }
}
