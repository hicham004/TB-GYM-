using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Notes plan N9a1 (decisions 24, 25, 33 and 34, and the owner's word of 12 Nov 2026; ADR 0041): one coaching
    /// space may be marked as the house, the house has settings the platform admin enters and sign-ups a person
    /// makes with no invitation, a client profile may be self-directed, and a client's coach history may start
    /// with a sign-up. Nothing is seeded: no space is marked, and every setting starts empty, so sign-up is closed.
    /// </summary>
    /// <remarks>
    /// Both new columns are added with a constant default, so no existing row is rewritten and no trigger fires on
    /// one: a released client's frozen profile is left exactly as it was.
    /// </remarks>
    public partial class HouseAndTraineeSignUp : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_ClientCoachAssignments_Chain",
                schema: "clients",
                table: "ClientCoachAssignments");

            migrationBuilder.AddColumn<bool>(
                name: "IsHouse",
                schema: "tenancy",
                table: "Tenants",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "IsSelfDirected",
                schema: "clients",
                table: "ClientProfiles",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "HouseSettingChanges",
                schema: "tenancy",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Setting = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    Sequence = table.Column<int>(type: "integer", nullable: false),
                    Value = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    ChangedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    ChangedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_HouseSettingChanges", x => x.Id);
                    table.UniqueConstraint("AK_HouseSettingChanges_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_HouseSettingChanges_Sequence", "\"Sequence\" >= 1");
                    table.CheckConstraint("CK_HouseSettingChanges_Value", "\"Value\" IS NULL OR (\"Value\" <> '' AND btrim(\"Value\") = \"Value\")");
                    table.ForeignKey(
                        name: "FK_HouseSettingChanges_Tenants_TenantId",
                        column: x => x.TenantId,
                        principalSchema: "tenancy",
                        principalTable: "Tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_HouseSettingChanges_Users_ChangedByUserId",
                        column: x => x.ChangedByUserId,
                        principalSchema: "identity",
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "TraineeSignUps",
                schema: "tenancy",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    FirstName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    LastName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    BirthDate = table.Column<DateOnly>(type: "date", nullable: true),
                    RequestedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ConfirmedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ClientProfileId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TraineeSignUps", x => x.Id);
                    table.UniqueConstraint("AK_TraineeSignUps_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_TraineeSignUps_State", "(\"ConfirmedAtUtc\" IS NULL AND \"ClientProfileId\" IS NULL AND \"FirstName\" IS NOT NULL AND \"LastName\" IS NOT NULL AND \"BirthDate\" IS NOT NULL) OR (\"ConfirmedAtUtc\" IS NOT NULL AND \"ConfirmedAtUtc\" >= \"RequestedAtUtc\" AND \"ClientProfileId\" IS NOT NULL AND \"FirstName\" IS NULL AND \"LastName\" IS NULL AND \"BirthDate\" IS NULL)");
                    table.ForeignKey(
                        name: "FK_TraineeSignUps_ClientProfiles_TenantId_ClientProfileId",
                        columns: x => new { x.TenantId, x.ClientProfileId },
                        principalSchema: "clients",
                        principalTable: "ClientProfiles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_TraineeSignUps_Tenants_TenantId",
                        column: x => x.TenantId,
                        principalSchema: "tenancy",
                        principalTable: "Tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_TraineeSignUps_Users_UserId",
                        column: x => x.UserId,
                        principalSchema: "identity",
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "UX_Tenants_House",
                schema: "tenancy",
                table: "Tenants",
                column: "IsHouse",
                unique: true,
                filter: "\"IsHouse\"");

            migrationBuilder.AddCheckConstraint(
                name: "CK_ClientCoachAssignments_Chain",
                schema: "clients",
                table: "ClientCoachAssignments",
                sql: "(\"Sequence\" = 1 AND \"PreviousCoachUserId\" IS NULL AND \"Reason\" IN ('Invitation', 'Migration', 'SignUp')) OR (\"Sequence\" > 1 AND \"PreviousCoachUserId\" IS NOT NULL AND \"PreviousCoachUserId\" <> \"CoachUserId\" AND \"Reason\" IN ('Reassigned', 'CoachRemoved', 'Released', 'CoachResigned', 'ClientLeft'))");

            migrationBuilder.CreateIndex(
                name: "IX_HouseSettingChanges_ChangedByUserId",
                schema: "tenancy",
                table: "HouseSettingChanges",
                column: "ChangedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_HouseSettingChanges_TenantId_Setting_Sequence",
                schema: "tenancy",
                table: "HouseSettingChanges",
                columns: new[] { "TenantId", "Setting", "Sequence" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_TraineeSignUps_TenantId_ClientProfileId",
                schema: "tenancy",
                table: "TraineeSignUps",
                columns: new[] { "TenantId", "ClientProfileId" });

            migrationBuilder.CreateIndex(
                name: "IX_TraineeSignUps_TenantId_RequestedAtUtc",
                schema: "tenancy",
                table: "TraineeSignUps",
                columns: new[] { "TenantId", "RequestedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "UX_TraineeSignUps_Waiting",
                schema: "tenancy",
                table: "TraineeSignUps",
                column: "UserId",
                unique: true,
                filter: "\"ConfirmedAtUtc\" IS NULL");

            // The house's rows are the house's alone, whoever writes them. Each guard reads the mark with a
            // share lock on the workspace's row, so taking the mark away waits for a write under way and then
            // sees what it wrote.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION tenancy.assert_house_row()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $function$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM tenancy."Tenants"
                        WHERE "Id" = NEW."TenantId" AND "IsHouse"
                        FOR SHARE) THEN
                        RAISE EXCEPTION '% rows belong to the house alone', TG_TABLE_NAME USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER "TR_HouseSettingChanges_House"
                BEFORE INSERT ON tenancy."HouseSettingChanges"
                FOR EACH ROW EXECUTE FUNCTION tenancy.assert_house_row();

                CREATE TRIGGER "TR_TraineeSignUps_House"
                BEFORE INSERT ON tenancy."TraineeSignUps"
                FOR EACH ROW EXECUTE FUNCTION tenancy.assert_house_row();
                """);

            // A setting's change is never edited or deleted: the next change is a new row.
            migrationBuilder.Sql(
                """
                CREATE TRIGGER "TR_HouseSettingChanges_AppendOnly"
                BEFORE UPDATE OR DELETE ON tenancy."HouseSettingChanges"
                FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
                """);

            // A sign-up is confirmed once and then never changes. Only one still waiting may be deleted, which
            // is the sweep's removal of a sign-up never confirmed.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION tenancy.protect_trainee_sign_up()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $function$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        IF OLD."ConfirmedAtUtc" IS NOT NULL THEN
                            RAISE EXCEPTION 'A confirmed sign-up is never deleted' USING ERRCODE = '55000';
                        END IF;
                        RETURN OLD;
                    END IF;
                    IF OLD."ConfirmedAtUtc" IS NOT NULL
                        OR NEW."ConfirmedAtUtc" IS NULL
                        OR NEW."Id" IS DISTINCT FROM OLD."Id"
                        OR NEW."TenantId" IS DISTINCT FROM OLD."TenantId"
                        OR NEW."UserId" IS DISTINCT FROM OLD."UserId"
                        OR NEW."RequestedAtUtc" IS DISTINCT FROM OLD."RequestedAtUtc"
                        OR NEW."CreatedAtUtc" IS DISTINCT FROM OLD."CreatedAtUtc"
                        OR NEW."CreatedByUserId" IS DISTINCT FROM OLD."CreatedByUserId" THEN
                        RAISE EXCEPTION 'A sign-up can only be confirmed, once' USING ERRCODE = '55000';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER "TR_TraineeSignUps_Protect"
                BEFORE UPDATE OR DELETE ON tenancy."TraineeSignUps"
                FOR EACH ROW EXECUTE FUNCTION tenancy.protect_trainee_sign_up();
                """);

            // Self-directed is the house's alone (CLI-026): a coach's client is never marked so.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION clients.assert_self_directed_in_house()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $function$
                BEGIN
                    IF NEW."IsSelfDirected" AND NOT EXISTS (
                        SELECT 1 FROM tenancy."Tenants"
                        WHERE "Id" = NEW."TenantId" AND "IsHouse"
                        FOR SHARE) THEN
                        RAISE EXCEPTION 'Only the house has self-directed trainees' USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER "TR_ClientProfiles_SelfDirectedInHouse"
                BEFORE INSERT OR UPDATE OF "IsSelfDirected" ON clients."ClientProfiles"
                FOR EACH ROW EXECUTE FUNCTION clients.assert_self_directed_in_house();
                """);

            // The house keeps its mark while it holds a sign-up or a self-directed trainee (CLI-022).
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION tenancy.protect_house_mark()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $function$
                BEGIN
                    IF OLD."IsHouse" AND NOT NEW."IsHouse" AND (
                        EXISTS (SELECT 1 FROM tenancy."TraineeSignUps" WHERE "TenantId" = OLD."Id")
                        OR EXISTS (
                            SELECT 1 FROM clients."ClientProfiles"
                            WHERE "TenantId" = OLD."Id" AND "IsSelfDirected")) THEN
                        RAISE EXCEPTION 'The house holds sign-ups or self-directed trainees and keeps its mark'
                            USING ERRCODE = '55000';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER "TR_Tenants_HouseMark"
                BEFORE UPDATE OF "IsHouse" ON tenancy."Tenants"
                FOR EACH ROW EXECUTE FUNCTION tenancy.protect_house_mark();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // A marked house, its settings and sign-ups, a self-directed trainee, a coach history that starts
            // with a sign-up and a published consumer terms document are facts the schema before this cannot
            // hold, some of them append-only: stop with a plain message while any exists instead of dropping them.
            migrationBuilder.Sql(
                """
                DO $migration$
                BEGIN
                    IF EXISTS (SELECT 1 FROM tenancy."Tenants" WHERE "IsHouse")
                        OR EXISTS (SELECT 1 FROM tenancy."HouseSettingChanges")
                        OR EXISTS (SELECT 1 FROM tenancy."TraineeSignUps")
                        OR EXISTS (SELECT 1 FROM clients."ClientProfiles" WHERE "IsSelfDirected")
                        OR EXISTS (SELECT 1 FROM clients."ClientCoachAssignments" WHERE "Reason" = 'SignUp')
                        OR EXISTS (SELECT 1 FROM clients."ClientProfileChanges" WHERE "Source" = 'SignUp')
                        OR EXISTS (SELECT 1 FROM identity."LegalDocumentVersions" WHERE "Kind" = 'ConsumerTerms') THEN
                        RAISE EXCEPTION 'A coaching space is marked as the house, or it has settings, sign-ups, trainees or consumer terms; roll forward instead of reverting this migration.'
                            USING ERRCODE = '55000';
                    END IF;
                END;
                $migration$;
                """);

            migrationBuilder.Sql(
                """
                DROP FUNCTION IF EXISTS tenancy.protect_house_mark() CASCADE;
                DROP FUNCTION IF EXISTS clients.assert_self_directed_in_house() CASCADE;
                DROP FUNCTION IF EXISTS tenancy.protect_trainee_sign_up() CASCADE;
                DROP TRIGGER IF EXISTS "TR_HouseSettingChanges_AppendOnly" ON tenancy."HouseSettingChanges";
                DROP FUNCTION IF EXISTS tenancy.assert_house_row() CASCADE;
                """);

            migrationBuilder.DropTable(
                name: "HouseSettingChanges",
                schema: "tenancy");

            migrationBuilder.DropTable(
                name: "TraineeSignUps",
                schema: "tenancy");

            migrationBuilder.DropIndex(
                name: "UX_Tenants_House",
                schema: "tenancy",
                table: "Tenants");

            migrationBuilder.DropCheckConstraint(
                name: "CK_ClientCoachAssignments_Chain",
                schema: "clients",
                table: "ClientCoachAssignments");

            migrationBuilder.DropColumn(
                name: "IsHouse",
                schema: "tenancy",
                table: "Tenants");

            migrationBuilder.DropColumn(
                name: "IsSelfDirected",
                schema: "clients",
                table: "ClientProfiles");

            migrationBuilder.AddCheckConstraint(
                name: "CK_ClientCoachAssignments_Chain",
                schema: "clients",
                table: "ClientCoachAssignments",
                sql: "(\"Sequence\" = 1 AND \"PreviousCoachUserId\" IS NULL AND \"Reason\" IN ('Invitation', 'Migration')) OR (\"Sequence\" > 1 AND \"PreviousCoachUserId\" IS NOT NULL AND \"PreviousCoachUserId\" <> \"CoachUserId\" AND \"Reason\" IN ('Reassigned', 'CoachRemoved', 'Released', 'CoachResigned', 'ClientLeft'))");
        }
    }
}
