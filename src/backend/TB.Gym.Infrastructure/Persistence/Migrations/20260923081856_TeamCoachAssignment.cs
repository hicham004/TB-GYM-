using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Gym team support (ADR 0026): coach invitations, one assigned coach per client with an
    /// append-only history, and the database guards behind "a client's coach is active staff".
    /// </summary>
    /// <remarks>
    /// Existing clients are given to their workspace's owner. A workspace created outside the
    /// application with no active owner falls back to its earliest active coach, and one with clients
    /// but no active staff at all fails the migration rather than inventing an assignment.
    /// </remarks>
    public partial class TeamCoachAssignment : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Nullable until the backfill below has given every existing client a coach.
            migrationBuilder.AddColumn<Guid>(
                name: "AssignedCoachUserId",
                schema: "clients",
                table: "ClientProfiles",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "AssignedCoachUserId",
                schema: "invitations",
                table: "ClientInvitations",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Kind",
                schema: "invitations",
                table: "ClientInvitations",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "Client");

            migrationBuilder.CreateTable(
                name: "ClientCoachAssignments",
                schema: "clients",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientProfileId = table.Column<Guid>(type: "uuid", nullable: false),
                    Sequence = table.Column<int>(type: "integer", nullable: false),
                    CoachUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    PreviousCoachUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    Reason = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Note = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    AssignedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ClientCoachAssignments", x => x.Id);
                    table.CheckConstraint("CK_ClientCoachAssignments_Chain", "(\"Sequence\" = 1 AND \"PreviousCoachUserId\" IS NULL AND \"Reason\" IN ('Invitation', 'Migration')) OR (\"Sequence\" > 1 AND \"PreviousCoachUserId\" IS NOT NULL AND \"PreviousCoachUserId\" <> \"CoachUserId\" AND \"Reason\" IN ('Reassigned', 'CoachRemoved'))");
                    table.ForeignKey(
                        name: "FK_ClientCoachAssignments_ClientProfiles_TenantId_ClientProfil~",
                        columns: x => new { x.TenantId, x.ClientProfileId },
                        principalSchema: "clients",
                        principalTable: "ClientProfiles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ClientCoachAssignments_Memberships_TenantId_CoachUserId",
                        columns: x => new { x.TenantId, x.CoachUserId },
                        principalSchema: "tenancy",
                        principalTable: "Memberships",
                        principalColumns: new[] { "TenantId", "UserId" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ClientCoachAssignments_Memberships_TenantId_PreviousCoachUs~",
                        columns: x => new { x.TenantId, x.PreviousCoachUserId },
                        principalSchema: "tenancy",
                        principalTable: "Memberships",
                        principalColumns: new[] { "TenantId", "UserId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Memberships_TenantId_ActiveOwner",
                schema: "tenancy",
                table: "Memberships",
                column: "TenantId",
                unique: true,
                filter: "\"Role\" = 'Owner' AND \"Status\" = 'Active'");

            migrationBuilder.CreateIndex(
                name: "IX_ClientProfiles_TenantId_AssignedCoachUserId",
                schema: "clients",
                table: "ClientProfiles",
                columns: new[] { "TenantId", "AssignedCoachUserId" });

            migrationBuilder.CreateIndex(
                name: "IX_ClientInvitations_TenantId_AssignedCoachUserId",
                schema: "invitations",
                table: "ClientInvitations",
                columns: new[] { "TenantId", "AssignedCoachUserId" });

            migrationBuilder.CreateIndex(
                name: "IX_ClientCoachAssignments_TenantId_ClientProfileId_Sequence",
                schema: "clients",
                table: "ClientCoachAssignments",
                columns: new[] { "TenantId", "ClientProfileId", "Sequence" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ClientCoachAssignments_TenantId_CoachUserId",
                schema: "clients",
                table: "ClientCoachAssignments",
                columns: new[] { "TenantId", "CoachUserId" });

            migrationBuilder.CreateIndex(
                name: "IX_ClientCoachAssignments_TenantId_PreviousCoachUserId",
                schema: "clients",
                table: "ClientCoachAssignments",
                columns: new[] { "TenantId", "PreviousCoachUserId" });

            // ---------- backfill: existing clients go to the owner ----------
            migrationBuilder.Sql("""
                UPDATE clients."ClientProfiles" AS client
                SET "AssignedCoachUserId" = staff."UserId"
                FROM (
                    SELECT DISTINCT ON (membership."TenantId") membership."TenantId", membership."UserId"
                    FROM tenancy."Memberships" AS membership
                    WHERE membership."Status" = 'Active' AND membership."Role" IN ('Owner', 'Coach')
                    ORDER BY membership."TenantId",
                             CASE membership."Role" WHEN 'Owner' THEN 0 ELSE 1 END,
                             membership."CreatedAtUtc",
                             membership."Id"
                ) AS staff
                WHERE staff."TenantId" = client."TenantId";

                DO $migration$
                BEGIN
                    IF EXISTS (SELECT 1 FROM clients."ClientProfiles" WHERE "AssignedCoachUserId" IS NULL) THEN
                        RAISE EXCEPTION 'A workspace has clients but no active owner or coach to assign them to';
                    END IF;
                END
                $migration$;

                INSERT INTO clients."ClientCoachAssignments"
                    ("Id", "TenantId", "ClientProfileId", "Sequence", "CoachUserId", "PreviousCoachUserId",
                     "Reason", "Note", "AssignedAtUtc", "CreatedAtUtc", "UpdatedAtUtc")
                SELECT gen_random_uuid(), client."TenantId", client."Id", 1, client."AssignedCoachUserId", NULL,
                       'Migration', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                FROM clients."ClientProfiles" AS client;

                -- A client invitation lands with whoever sent it, when that sender is staff here.
                UPDATE invitations."ClientInvitations" AS invitation
                SET "AssignedCoachUserId" = invitation."CreatedByUserId"
                WHERE invitation."CreatedByUserId" IS NOT NULL
                  AND EXISTS (
                      SELECT 1 FROM tenancy."Memberships" AS membership
                      WHERE membership."TenantId" = invitation."TenantId"
                        AND membership."UserId" = invitation."CreatedByUserId"
                        AND membership."Role" IN ('Owner', 'Coach'));
                """);

            migrationBuilder.AlterColumn<Guid>(
                name: "AssignedCoachUserId",
                schema: "clients",
                table: "ClientProfiles",
                type: "uuid",
                nullable: false,
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_ClientInvitations_Kind",
                schema: "invitations",
                table: "ClientInvitations",
                sql: "\"Kind\" = 'Client' OR (\"Kind\" = 'Coach' AND \"AssignedCoachUserId\" IS NULL AND \"PhoneNumber\" IS NULL AND \"BirthDate\" IS NULL)");

            migrationBuilder.AddForeignKey(
                name: "FK_ClientInvitations_Memberships_TenantId_AssignedCoachUserId",
                schema: "invitations",
                table: "ClientInvitations",
                columns: new[] { "TenantId", "AssignedCoachUserId" },
                principalSchema: "tenancy",
                principalTable: "Memberships",
                principalColumns: new[] { "TenantId", "UserId" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_ClientProfiles_Memberships_TenantId_AssignedCoachUserId",
                schema: "clients",
                table: "ClientProfiles",
                columns: new[] { "TenantId", "AssignedCoachUserId" },
                principalSchema: "tenancy",
                principalTable: "Memberships",
                principalColumns: new[] { "TenantId", "UserId" },
                onDelete: ReferentialAction.Restrict);

            // ---------- guards ----------
            migrationBuilder.Sql("""
                -- The history is append-only, like every other audit ledger here.
                CREATE TRIGGER "TR_ClientCoachAssignments_AppendOnly"
                BEFORE UPDATE OR DELETE ON clients."ClientCoachAssignments"
                FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

                -- Every later entry names the coach of the entry before it, so the chain cannot skip.
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

                CREATE TRIGGER "TR_ClientCoachAssignments_Chain"
                BEFORE INSERT ON clients."ClientCoachAssignments"
                FOR EACH ROW EXECUTE FUNCTION clients.assert_coach_assignment_chain();

                -- At commit: a client's coach is active Owner/Coach staff, and is exactly the coach the
                -- newest history entry names, so the coach never changes without history.
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

                CREATE CONSTRAINT TRIGGER "TR_ClientProfiles_AssignedCoach"
                AFTER INSERT OR UPDATE OF "AssignedCoachUserId" ON clients."ClientProfiles"
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION clients.assert_client_coach();

                -- At commit: a member who stops being active staff has no clients left assigned.
                CREATE OR REPLACE FUNCTION tenancy.assert_departing_staff_has_no_clients()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF NOT (NEW."Status" = 'Active' AND NEW."Role" IN ('Owner', 'Coach')) AND EXISTS (
                        SELECT 1 FROM clients."ClientProfiles" AS client
                        WHERE client."TenantId" = NEW."TenantId"
                          AND client."AssignedCoachUserId" = NEW."UserId") THEN
                        RAISE EXCEPTION 'A member who still has assigned clients cannot stop being active staff'
                            USING ERRCODE = '23514';
                    END IF;
                    RETURN NULL;
                END;
                $function$;

                CREATE CONSTRAINT TRIGGER "TR_Memberships_DepartingStaff"
                AFTER UPDATE OF "Status", "Role" ON tenancy."Memberships"
                DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION tenancy.assert_departing_staff_has_no_clients();

                -- An invitation's kind never changes, and it is handed to another coach only while pending.
                CREATE OR REPLACE FUNCTION invitations.protect_invitation_kind_and_coach()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF NEW."Kind" <> OLD."Kind" THEN
                        RAISE EXCEPTION 'An invitation kind is immutable' USING ERRCODE = '23514';
                    END IF;
                    IF NEW."AssignedCoachUserId" IS DISTINCT FROM OLD."AssignedCoachUserId"
                       AND (OLD."Status" <> 'Pending' OR NEW."Status" <> 'Pending') THEN
                        RAISE EXCEPTION 'Only a pending invitation can be handed to another coach'
                            USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER "TR_ClientInvitations_KindAndCoach"
                BEFORE UPDATE ON invitations."ClientInvitations"
                FOR EACH ROW EXECUTE FUNCTION invitations.protect_invitation_kind_and_coach();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP TRIGGER IF EXISTS "TR_ClientInvitations_KindAndCoach" ON invitations."ClientInvitations";
                DROP FUNCTION IF EXISTS invitations.protect_invitation_kind_and_coach();
                DROP TRIGGER IF EXISTS "TR_Memberships_DepartingStaff" ON tenancy."Memberships";
                DROP FUNCTION IF EXISTS tenancy.assert_departing_staff_has_no_clients();
                DROP TRIGGER IF EXISTS "TR_ClientProfiles_AssignedCoach" ON clients."ClientProfiles";
                DROP FUNCTION IF EXISTS clients.assert_client_coach();
                DROP TRIGGER IF EXISTS "TR_ClientCoachAssignments_Chain" ON clients."ClientCoachAssignments";
                DROP FUNCTION IF EXISTS clients.assert_coach_assignment_chain();
                DROP TRIGGER IF EXISTS "TR_ClientCoachAssignments_AppendOnly" ON clients."ClientCoachAssignments";
                """);

            migrationBuilder.DropForeignKey(
                name: "FK_ClientInvitations_Memberships_TenantId_AssignedCoachUserId",
                schema: "invitations",
                table: "ClientInvitations");

            migrationBuilder.DropForeignKey(
                name: "FK_ClientProfiles_Memberships_TenantId_AssignedCoachUserId",
                schema: "clients",
                table: "ClientProfiles");

            migrationBuilder.DropTable(
                name: "ClientCoachAssignments",
                schema: "clients");

            migrationBuilder.DropIndex(
                name: "IX_Memberships_TenantId_ActiveOwner",
                schema: "tenancy",
                table: "Memberships");

            migrationBuilder.DropIndex(
                name: "IX_ClientProfiles_TenantId_AssignedCoachUserId",
                schema: "clients",
                table: "ClientProfiles");

            migrationBuilder.DropIndex(
                name: "IX_ClientInvitations_TenantId_AssignedCoachUserId",
                schema: "invitations",
                table: "ClientInvitations");

            migrationBuilder.DropCheckConstraint(
                name: "CK_ClientInvitations_Kind",
                schema: "invitations",
                table: "ClientInvitations");

            migrationBuilder.DropColumn(
                name: "AssignedCoachUserId",
                schema: "clients",
                table: "ClientProfiles");

            migrationBuilder.DropColumn(
                name: "AssignedCoachUserId",
                schema: "invitations",
                table: "ClientInvitations");

            migrationBuilder.DropColumn(
                name: "Kind",
                schema: "invitations",
                table: "ClientInvitations");
        }
    }
}
