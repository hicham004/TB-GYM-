using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Phase5ABodyweightTrend : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                UPDATE progress."BodyweightObservations"
                SET "Source" = CASE
                    WHEN "Source" IN ('Onboarding', 'ClientEntry') THEN 'Client'
                    WHEN "Source" = 'CoachEntry' THEN 'Coach'
                    ELSE "Source"
                END;
                """);

            migrationBuilder.AddUniqueConstraint(
                name: "AK_BodyweightObservations_TenantId_Id",
                schema: "progress",
                table: "BodyweightObservations",
                columns: new[] { "TenantId", "Id" });

            migrationBuilder.CreateTable(
                name: "BodyweightCorrections",
                schema: "progress",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ObservationId = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientProfileId = table.Column<Guid>(type: "uuid", nullable: false),
                    MeasurementDate = table.Column<DateOnly>(type: "date", nullable: false),
                    ValueKilograms = table.Column<decimal>(type: "numeric(7,3)", precision: 7, scale: 3, nullable: false),
                    EnteredValue = table.Column<decimal>(type: "numeric(8,3)", precision: 8, scale: 3, nullable: false),
                    EnteredUnit = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Source = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    RecordedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    RecordedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    Reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    SupersededAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    SupersededByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BodyweightCorrections", x => x.Id);
                    table.CheckConstraint("CK_BodyweightCorrections_ValueKilograms", "\"ValueKilograms\" >= 20 AND \"ValueKilograms\" <= 500");
                    table.ForeignKey(
                        name: "FK_BodyweightCorrections_BodyweightObservations_TenantId_Obser~",
                        columns: x => new { x.TenantId, x.ObservationId },
                        principalSchema: "progress",
                        principalTable: "BodyweightObservations",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_BodyweightCorrections_ClientProfiles_TenantId_ClientProfile~",
                        columns: x => new { x.TenantId, x.ClientProfileId },
                        principalSchema: "clients",
                        principalTable: "ClientProfiles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_BodyweightCorrections_TenantId_ClientProfileId",
                schema: "progress",
                table: "BodyweightCorrections",
                columns: new[] { "TenantId", "ClientProfileId" });

            migrationBuilder.CreateIndex(
                name: "IX_BodyweightCorrections_TenantId_ObservationId_SupersededAtUtc",
                schema: "progress",
                table: "BodyweightCorrections",
                columns: new[] { "TenantId", "ObservationId", "SupersededAtUtc" });

            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION progress.reject_update_delete()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '23514';
                END;
                $function$;

                CREATE OR REPLACE FUNCTION progress.protect_bodyweight_observation()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Bodyweight observations cannot be deleted' USING ERRCODE = '23514';
                    END IF;
                    IF OLD."Id" <> NEW."Id"
                       OR OLD."TenantId" <> NEW."TenantId"
                       OR OLD."ClientProfileId" <> NEW."ClientProfileId"
                       OR OLD."MeasurementDate" <> NEW."MeasurementDate"
                       OR OLD."CreatedAtUtc" <> NEW."CreatedAtUtc"
                       OR OLD."CreatedByUserId" IS DISTINCT FROM NEW."CreatedByUserId" THEN
                        RAISE EXCEPTION 'Bodyweight observation identity and original audit fields are immutable' USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER "TR_BodyweightCorrections_AppendOnly"
                    BEFORE UPDATE OR DELETE ON progress."BodyweightCorrections"
                    FOR EACH ROW EXECUTE FUNCTION progress.reject_update_delete();
                CREATE TRIGGER "TR_BodyweightObservations_ProtectIdentity"
                    BEFORE UPDATE OR DELETE ON progress."BodyweightObservations"
                    FOR EACH ROW EXECUTE FUNCTION progress.protect_bodyweight_observation();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                DROP TRIGGER "TR_BodyweightCorrections_AppendOnly" ON progress."BodyweightCorrections";
                DROP TRIGGER "TR_BodyweightObservations_ProtectIdentity" ON progress."BodyweightObservations";
                DROP FUNCTION progress.reject_update_delete();
                DROP FUNCTION progress.protect_bodyweight_observation();
                """);

            migrationBuilder.DropTable(
                name: "BodyweightCorrections",
                schema: "progress");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_BodyweightObservations_TenantId_Id",
                schema: "progress",
                table: "BodyweightObservations");

            migrationBuilder.Sql(
                """
                UPDATE progress."BodyweightObservations"
                SET "Source" = CASE
                    WHEN "Source" = 'Client' THEN 'ClientEntry'
                    WHEN "Source" = 'Coach' THEN 'CoachEntry'
                    ELSE 'Onboarding'
                END;
                """);
        }
    }
}
