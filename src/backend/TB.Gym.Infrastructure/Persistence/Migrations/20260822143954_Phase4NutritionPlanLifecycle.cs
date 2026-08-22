using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Phase4NutritionPlanLifecycle : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_CookingFactors_Factor",
                schema: "nutrition",
                table: "CookingFactors");

            migrationBuilder.DropColumn(
                name: "AllergenDisplayRegime",
                schema: "nutrition",
                table: "WorkspaceSettings");

            migrationBuilder.AddColumn<bool>(
                name: "BlocksOverlap",
                schema: "nutrition",
                table: "ClientNutritionPlans",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "Status",
                schema: "nutrition",
                table: "ClientNutritionPlans",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "");

            // Existing rows predate the lifecycle columns and are by definition active
            // reservations. Backfill before the check constraint is added.
            migrationBuilder.Sql(
                """
                UPDATE nutrition."ClientNutritionPlans"
                SET "Status" = 'Active', "BlocksOverlap" = TRUE
                WHERE "Status" IS NULL OR "Status" = '';
                """);

            migrationBuilder.CreateTable(
                name: "PlanLifecycleEvents",
                schema: "nutrition",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientNutritionPlanId = table.Column<Guid>(type: "uuid", nullable: false),
                    EventType = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    FromStatus = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    ToStatus = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    ActorUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    OccurredAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PlanLifecycleEvents", x => x.Id);
                    table.UniqueConstraint("AK_PlanLifecycleEvents_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_PlanLifecycleEvents_ClientNutritionPlans_TenantId_ClientNut~",
                        columns: x => new { x.TenantId, x.ClientNutritionPlanId },
                        principalSchema: "nutrition",
                        principalTable: "ClientNutritionPlans",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.AddCheckConstraint(
                name: "CK_CookingFactors_Factor",
                schema: "nutrition",
                table: "CookingFactors",
                sql: "\"Factor\" > 0 AND \"FromBasis\" <> \"ToBasis\" AND (CASE WHEN \"Kind\" = 'Retention' THEN \"Factor\" <= 1 ELSE \"Factor\" <= 5 END)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_ClientNutritionPlans_BlocksOverlap",
                schema: "nutrition",
                table: "ClientNutritionPlans",
                sql: "(\"Status\" = 'Active') = \"BlocksOverlap\"");

            migrationBuilder.CreateIndex(
                name: "IX_PlanLifecycleEvents_TenantId_ClientNutritionPlanId_Occurred~",
                schema: "nutrition",
                table: "PlanLifecycleEvents",
                columns: new[] { "TenantId", "ClientNutritionPlanId", "OccurredAtUtc" });

            // A cancelled plan keeps its dates for history but must stop reserving the range, so
            // the exclusion constraint becomes partial on the active reservation flag.
            migrationBuilder.Sql(
                """
                ALTER TABLE nutrition."ClientNutritionPlans"
                    DROP CONSTRAINT "EX_ClientNutritionPlans_Client_Period";
                ALTER TABLE nutrition."ClientNutritionPlans"
                    ADD CONSTRAINT "EX_ClientNutritionPlans_Client_Period"
                    EXCLUDE USING gist (
                        "TenantId" WITH =,
                        "ClientProfileId" WITH =,
                        daterange("StartDate", "EndDateExclusive", '[)') WITH &&
                    )
                    WHERE ("BlocksOverlap");

                CREATE TRIGGER "TR_PlanLifecycleEvents_AppendOnly"
                    BEFORE UPDATE OR DELETE ON nutrition."PlanLifecycleEvents"
                    FOR EACH ROW EXECUTE FUNCTION nutrition.reject_update_delete();
                """);

            // The assigned plan was fully append-only, which left a misassignment permanently
            // unfixable. Narrow the guard: the snapshot itself stays immutable, and the only
            // permitted mutation is the one-way audited cancellation that releases the date range.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION nutrition.protect_client_plan()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Assigned nutrition plans cannot be deleted' USING ERRCODE = '23514';
                    END IF;

                    IF NEW."TenantId" <> OLD."TenantId"
                        OR NEW."ClientProfileId" <> OLD."ClientProfileId"
                        OR NEW."EnrollmentId" <> OLD."EnrollmentId"
                        OR NEW."SourceMealPlanTemplateVersionId" <> OLD."SourceMealPlanTemplateVersionId"
                        OR NEW."NutritionCalculationSnapshotId" <> OLD."NutritionCalculationSnapshotId"
                        OR NEW."StartDate" <> OLD."StartDate"
                        OR NEW."EndDateExclusive" <> OLD."EndDateExclusive"
                        OR NEW."CreatedAtUtc" <> OLD."CreatedAtUtc" THEN
                        RAISE EXCEPTION 'Assigned nutrition plan snapshots are immutable' USING ERRCODE = '23514';
                    END IF;

                    IF NEW."Status" <> OLD."Status"
                        AND NOT (OLD."Status" = 'Active' AND NEW."Status" = 'Cancelled') THEN
                        RAISE EXCEPTION 'Only an active nutrition plan may be cancelled' USING ERRCODE = '23514';
                    END IF;

                    RETURN NEW;
                END;
                $function$;

                DROP TRIGGER "TR_ClientNutritionPlans_Immutable" ON nutrition."ClientNutritionPlans";
                CREATE TRIGGER "TR_ClientNutritionPlans_ProtectSnapshot"
                    BEFORE UPDATE OR DELETE ON nutrition."ClientNutritionPlans"
                    FOR EACH ROW EXECUTE FUNCTION nutrition.protect_client_plan();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                ALTER TABLE nutrition."ClientNutritionPlans"
                    DROP CONSTRAINT "EX_ClientNutritionPlans_Client_Period";
                ALTER TABLE nutrition."ClientNutritionPlans"
                    ADD CONSTRAINT "EX_ClientNutritionPlans_Client_Period"
                    EXCLUDE USING gist (
                        "TenantId" WITH =,
                        "ClientProfileId" WITH =,
                        daterange("StartDate", "EndDateExclusive", '[)') WITH &&
                    );

                DROP TRIGGER "TR_ClientNutritionPlans_ProtectSnapshot" ON nutrition."ClientNutritionPlans";
                DROP FUNCTION nutrition.protect_client_plan();
                CREATE TRIGGER "TR_ClientNutritionPlans_Immutable"
                    BEFORE UPDATE OR DELETE ON nutrition."ClientNutritionPlans"
                    FOR EACH ROW EXECUTE FUNCTION nutrition.reject_update_delete();
                """);

            migrationBuilder.DropTable(
                name: "PlanLifecycleEvents",
                schema: "nutrition");

            migrationBuilder.DropCheckConstraint(
                name: "CK_CookingFactors_Factor",
                schema: "nutrition",
                table: "CookingFactors");

            migrationBuilder.DropCheckConstraint(
                name: "CK_ClientNutritionPlans_BlocksOverlap",
                schema: "nutrition",
                table: "ClientNutritionPlans");

            migrationBuilder.DropColumn(
                name: "BlocksOverlap",
                schema: "nutrition",
                table: "ClientNutritionPlans");

            migrationBuilder.DropColumn(
                name: "Status",
                schema: "nutrition",
                table: "ClientNutritionPlans");

            migrationBuilder.AddColumn<string>(
                name: "AllergenDisplayRegime",
                schema: "nutrition",
                table: "WorkspaceSettings",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddCheckConstraint(
                name: "CK_CookingFactors_Factor",
                schema: "nutrition",
                table: "CookingFactors",
                sql: "\"Factor\" > 0 AND \"Factor\" <= 2 AND \"FromBasis\" <> \"ToBasis\"");
        }
    }
}
