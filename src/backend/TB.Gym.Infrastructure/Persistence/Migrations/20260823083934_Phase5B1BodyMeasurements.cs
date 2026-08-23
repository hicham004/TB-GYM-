using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Phase5B1BodyMeasurements : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "BodyMeasurements",
                schema: "progress",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientProfileId = table.Column<Guid>(type: "uuid", nullable: false),
                    MeasurementDate = table.Column<DateOnly>(type: "date", nullable: false),
                    MeasurementType = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    CanonicalValue = table.Column<decimal>(type: "numeric(7,3)", precision: 7, scale: 3, nullable: false),
                    EnteredValue = table.Column<decimal>(type: "numeric(8,3)", precision: 8, scale: 3, nullable: false),
                    EnteredUnit = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Source = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BodyMeasurements", x => x.Id);
                    table.UniqueConstraint("AK_BodyMeasurements_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_BodyMeasurements_CanonicalValue", "(\"MeasurementType\" = 'BodyFatPercentage' AND \"CanonicalValue\" BETWEEN 1 AND 75) OR (\"MeasurementType\" <> 'BodyFatPercentage' AND \"CanonicalValue\" BETWEEN 10 AND 300)");
                    table.CheckConstraint("CK_BodyMeasurements_EnteredUnit", "(\"MeasurementType\" = 'BodyFatPercentage' AND \"EnteredUnit\" = 'Percent') OR (\"MeasurementType\" <> 'BodyFatPercentage' AND \"EnteredUnit\" IN ('Centimetre', 'Inch'))");
                    table.ForeignKey(
                        name: "FK_BodyMeasurements_ClientProfiles_TenantId_ClientProfileId",
                        columns: x => new { x.TenantId, x.ClientProfileId },
                        principalSchema: "clients",
                        principalTable: "ClientProfiles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "BodyMeasurementCorrections",
                schema: "progress",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    MeasurementId = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientProfileId = table.Column<Guid>(type: "uuid", nullable: false),
                    MeasurementDate = table.Column<DateOnly>(type: "date", nullable: false),
                    MeasurementType = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    CanonicalValue = table.Column<decimal>(type: "numeric(7,3)", precision: 7, scale: 3, nullable: false),
                    EnteredValue = table.Column<decimal>(type: "numeric(8,3)", precision: 8, scale: 3, nullable: false),
                    EnteredUnit = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Source = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
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
                    table.PrimaryKey("PK_BodyMeasurementCorrections", x => x.Id);
                    table.CheckConstraint("CK_BodyMeasurementCorrections_CanonicalValue", "(\"MeasurementType\" = 'BodyFatPercentage' AND \"CanonicalValue\" BETWEEN 1 AND 75) OR (\"MeasurementType\" <> 'BodyFatPercentage' AND \"CanonicalValue\" BETWEEN 10 AND 300)");
                    table.CheckConstraint("CK_BodyMeasurementCorrections_EnteredUnit", "(\"MeasurementType\" = 'BodyFatPercentage' AND \"EnteredUnit\" = 'Percent') OR (\"MeasurementType\" <> 'BodyFatPercentage' AND \"EnteredUnit\" IN ('Centimetre', 'Inch'))");
                    table.ForeignKey(
                        name: "FK_BodyMeasurementCorrections_BodyMeasurements_TenantId_Measur~",
                        columns: x => new { x.TenantId, x.MeasurementId },
                        principalSchema: "progress",
                        principalTable: "BodyMeasurements",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_BodyMeasurementCorrections_ClientProfiles_TenantId_ClientPr~",
                        columns: x => new { x.TenantId, x.ClientProfileId },
                        principalSchema: "clients",
                        principalTable: "ClientProfiles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_BodyMeasurementCorrections_TenantId_ClientProfileId",
                schema: "progress",
                table: "BodyMeasurementCorrections",
                columns: new[] { "TenantId", "ClientProfileId" });

            migrationBuilder.CreateIndex(
                name: "IX_BodyMeasurementCorrections_TenantId_MeasurementId_Supersede~",
                schema: "progress",
                table: "BodyMeasurementCorrections",
                columns: new[] { "TenantId", "MeasurementId", "SupersededAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_BodyMeasurements_TenantId_ClientProfileId_MeasurementDate_M~",
                schema: "progress",
                table: "BodyMeasurements",
                columns: new[] { "TenantId", "ClientProfileId", "MeasurementDate", "MeasurementType" },
                unique: true);

            migrationBuilder.Sql(
                """
                CREATE FUNCTION progress.protect_body_measurement()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Body measurements cannot be deleted' USING ERRCODE = '23514';
                    END IF;
                    IF OLD."Id" <> NEW."Id"
                       OR OLD."TenantId" <> NEW."TenantId"
                       OR OLD."ClientProfileId" <> NEW."ClientProfileId"
                       OR OLD."MeasurementDate" <> NEW."MeasurementDate"
                       OR OLD."MeasurementType" <> NEW."MeasurementType"
                       OR OLD."CreatedAtUtc" <> NEW."CreatedAtUtc"
                       OR OLD."CreatedByUserId" IS DISTINCT FROM NEW."CreatedByUserId" THEN
                        RAISE EXCEPTION 'Body measurement identity, date, type, and original audit fields are immutable' USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER "TR_BodyMeasurementCorrections_AppendOnly"
                    BEFORE UPDATE OR DELETE ON progress."BodyMeasurementCorrections"
                    FOR EACH ROW EXECUTE FUNCTION progress.reject_update_delete();
                CREATE TRIGGER "TR_BodyMeasurements_ProtectIdentity"
                    BEFORE UPDATE OR DELETE ON progress."BodyMeasurements"
                    FOR EACH ROW EXECUTE FUNCTION progress.protect_body_measurement();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                DROP TRIGGER "TR_BodyMeasurementCorrections_AppendOnly" ON progress."BodyMeasurementCorrections";
                DROP TRIGGER "TR_BodyMeasurements_ProtectIdentity" ON progress."BodyMeasurements";
                DROP FUNCTION progress.protect_body_measurement();
                """);

            migrationBuilder.DropTable(
                name: "BodyMeasurementCorrections",
                schema: "progress");

            migrationBuilder.DropTable(
                name: "BodyMeasurements",
                schema: "progress");
        }
    }
}
