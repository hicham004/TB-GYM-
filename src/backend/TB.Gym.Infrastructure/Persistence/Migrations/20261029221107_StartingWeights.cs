using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class StartingWeights : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "StartingWeights",
                schema: "progress",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientProfileId = table.Column<Guid>(type: "uuid", nullable: false),
                    MeasurementDate = table.Column<DateOnly>(type: "date", nullable: false),
                    ValueKilograms = table.Column<decimal>(type: "numeric(7,3)", precision: 7, scale: 3, nullable: false),
                    EnteredValue = table.Column<decimal>(type: "numeric(8,3)", precision: 8, scale: 3, nullable: false),
                    EnteredUnit = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Origin = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StartingWeights", x => x.Id);
                    table.UniqueConstraint("AK_StartingWeights_TenantId_ClientProfileId_Id", x => new { x.TenantId, x.ClientProfileId, x.Id });
                    table.CheckConstraint("CK_StartingWeights_EnteredUnit", "\"EnteredUnit\" IN ('Kilogram', 'Pound')");
                    table.CheckConstraint("CK_StartingWeights_Origin", "\"Origin\" IN ('Intake', 'FirstWeighIn')");
                    table.CheckConstraint("CK_StartingWeights_ValueKilograms", "\"ValueKilograms\" >= 20 AND \"ValueKilograms\" <= 500");
                    table.ForeignKey(
                        name: "FK_StartingWeights_ClientProfiles_TenantId_ClientProfileId",
                        columns: x => new { x.TenantId, x.ClientProfileId },
                        principalSchema: "clients",
                        principalTable: "ClientProfiles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "StartingWeightCorrections",
                schema: "progress",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    StartingWeightId = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientProfileId = table.Column<Guid>(type: "uuid", nullable: false),
                    MeasurementDate = table.Column<DateOnly>(type: "date", nullable: false),
                    ValueKilograms = table.Column<decimal>(type: "numeric(7,3)", precision: 7, scale: 3, nullable: false),
                    EnteredValue = table.Column<decimal>(type: "numeric(8,3)", precision: 8, scale: 3, nullable: false),
                    EnteredUnit = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
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
                    table.PrimaryKey("PK_StartingWeightCorrections", x => x.Id);
                    table.CheckConstraint("CK_StartingWeightCorrections_ValueKilograms", "\"ValueKilograms\" >= 20 AND \"ValueKilograms\" <= 500");
                    table.ForeignKey(
                        name: "FK_StartingWeightCorrections_ClientProfiles_TenantId_ClientPro~",
                        columns: x => new { x.TenantId, x.ClientProfileId },
                        principalSchema: "clients",
                        principalTable: "ClientProfiles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_StartingWeightCorrections_StartingWeights_TenantId_ClientPr~",
                        columns: x => new { x.TenantId, x.ClientProfileId, x.StartingWeightId },
                        principalSchema: "progress",
                        principalTable: "StartingWeights",
                        principalColumns: new[] { "TenantId", "ClientProfileId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_StartingWeightCorrections_TenantId_ClientProfileId_Starting~",
                schema: "progress",
                table: "StartingWeightCorrections",
                columns: new[] { "TenantId", "ClientProfileId", "StartingWeightId" });

            migrationBuilder.CreateIndex(
                name: "IX_StartingWeightCorrections_TenantId_StartingWeightId_Superse~",
                schema: "progress",
                table: "StartingWeightCorrections",
                columns: new[] { "TenantId", "StartingWeightId", "SupersededAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_StartingWeights_TenantId_ClientProfileId",
                schema: "progress",
                table: "StartingWeights",
                columns: new[] { "TenantId", "ClientProfileId" },
                unique: true);

            // A start is corrected, never deleted, and keeps what it is and where it came from; its
            // corrections are history (critique B6, PRG-014).
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION progress.protect_starting_weight()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Starting weights cannot be deleted' USING ERRCODE = '23514';
                    END IF;
                    IF OLD."Id" <> NEW."Id"
                       OR OLD."TenantId" <> NEW."TenantId"
                       OR OLD."ClientProfileId" <> NEW."ClientProfileId"
                       OR OLD."Origin" <> NEW."Origin"
                       OR OLD."CreatedAtUtc" <> NEW."CreatedAtUtc"
                       OR OLD."CreatedByUserId" IS DISTINCT FROM NEW."CreatedByUserId" THEN
                        RAISE EXCEPTION 'A starting weight''s identity, origin and original audit fields are immutable' USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER "TR_StartingWeights_Protect"
                    BEFORE UPDATE OR DELETE ON progress."StartingWeights"
                    FOR EACH ROW EXECUTE FUNCTION progress.protect_starting_weight();
                CREATE TRIGGER "TR_StartingWeightCorrections_AppendOnly"
                    BEFORE UPDATE OR DELETE ON progress."StartingWeightCorrections"
                    FOR EACH ROW EXECUTE FUNCTION progress.reject_update_delete();
                """);

            // Profiles set up before starts existed begin where their first weigh-in did: the earliest
            // active one by day, then by when it was recorded. A voided entry is not current truth, and a
            // released profile is filled in too, as a returning client's first start.
            migrationBuilder.Sql(
                """
                INSERT INTO progress."StartingWeights"
                    ("Id", "TenantId", "ClientProfileId", "MeasurementDate", "ValueKilograms", "EnteredValue",
                     "EnteredUnit", "Origin", "CreatedAtUtc", "CreatedByUserId", "UpdatedAtUtc", "UpdatedByUserId")
                SELECT DISTINCT ON (observation."TenantId", observation."ClientProfileId")
                    gen_random_uuid(), observation."TenantId", observation."ClientProfileId",
                    observation."MeasurementDate", observation."ValueKilograms", observation."EnteredValue",
                    observation."EnteredUnit", 'FirstWeighIn', observation."CreatedAtUtc",
                    observation."CreatedByUserId", observation."UpdatedAtUtc", observation."UpdatedByUserId"
                FROM progress."BodyweightObservations" AS observation
                WHERE observation."IsActive"
                ORDER BY observation."TenantId", observation."ClientProfileId", observation."MeasurementDate",
                    observation."CreatedAtUtc", observation."Id";
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                DROP TRIGGER "TR_StartingWeightCorrections_AppendOnly" ON progress."StartingWeightCorrections";
                DROP TRIGGER "TR_StartingWeights_Protect" ON progress."StartingWeights";
                DROP FUNCTION progress.protect_starting_weight();
                """);

            migrationBuilder.DropTable(
                name: "StartingWeightCorrections",
                schema: "progress");

            migrationBuilder.DropTable(
                name: "StartingWeights",
                schema: "progress");
        }
    }
}
