using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Phase5B6BodyweightDateCorrection : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_BodyweightObservations_TenantId_ClientProfileId_Measurement~",
                schema: "progress",
                table: "BodyweightObservations");

            migrationBuilder.AddColumn<bool>(
                name: "IsActive",
                schema: "progress",
                table: "BodyweightObservations",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "Status",
                schema: "progress",
                table: "BodyweightObservations",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "");

            // Every existing observation predates voiding and is by definition current truth.
            // Backfill before the check constraint ties the two columns together, and before the
            // trigger below starts refusing status transitions that are not Active to Voided.
            migrationBuilder.Sql(
                """
                UPDATE progress."BodyweightObservations"
                SET "Status" = 'Active', "IsActive" = TRUE
                WHERE "Status" IS NULL OR "Status" = '';
                """);

            migrationBuilder.CreateTable(
                name: "BodyweightObservationVoids",
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
                    Reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    VoidedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    VoidedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    ReplacementObservationId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BodyweightObservationVoids", x => x.Id);
                    table.CheckConstraint("CK_BodyweightObservationVoids_ValueKilograms", "\"ValueKilograms\" >= 20 AND \"ValueKilograms\" <= 500");
                    table.ForeignKey(
                        name: "FK_BodyweightObservationVoids_BodyweightObservations_TenantId_~",
                        columns: x => new { x.TenantId, x.ObservationId },
                        principalSchema: "progress",
                        principalTable: "BodyweightObservations",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_BodyweightObservationVoids_BodyweightObservations_TenantId~1",
                        columns: x => new { x.TenantId, x.ReplacementObservationId },
                        principalSchema: "progress",
                        principalTable: "BodyweightObservations",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_BodyweightObservationVoids_ClientProfiles_TenantId_ClientPr~",
                        columns: x => new { x.TenantId, x.ClientProfileId },
                        principalSchema: "clients",
                        principalTable: "ClientProfiles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_BodyweightObservations_TenantId_ClientProfileId_Measurement~",
                schema: "progress",
                table: "BodyweightObservations",
                columns: new[] { "TenantId", "ClientProfileId", "MeasurementDate" },
                unique: true,
                filter: "\"IsActive\"");

            migrationBuilder.AddCheckConstraint(
                name: "CK_BodyweightObservations_IsActive",
                schema: "progress",
                table: "BodyweightObservations",
                sql: "(\"Status\" = 'Active') = \"IsActive\"");

            migrationBuilder.CreateIndex(
                name: "IX_BodyweightObservationVoids_TenantId_ClientProfileId_VoidedA~",
                schema: "progress",
                table: "BodyweightObservationVoids",
                columns: new[] { "TenantId", "ClientProfileId", "VoidedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_BodyweightObservationVoids_TenantId_ObservationId",
                schema: "progress",
                table: "BodyweightObservationVoids",
                columns: new[] { "TenantId", "ObservationId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_BodyweightObservationVoids_TenantId_ReplacementObservationId",
                schema: "progress",
                table: "BodyweightObservationVoids",
                columns: new[] { "TenantId", "ReplacementObservationId" });

            // The void record is history and cannot be edited or deleted, exactly like a value
            // correction.
            migrationBuilder.Sql(
                """
                CREATE TRIGGER "TR_BodyweightObservationVoids_AppendOnly"
                    BEFORE UPDATE OR DELETE ON progress."BodyweightObservationVoids"
                    FOR EACH ROW EXECUTE FUNCTION progress.reject_update_delete();
                """);

            // Voiding becomes the only permitted status transition, and it may not smuggle a value
            // change through with it: the void has to preserve the fact it withdraws. Once voided the
            // row is frozen outright, which is what makes voiding one-way at the database rather than
            // only in the application. The measurement date stays immutable as before, so correcting a
            // mis-dated entry can only ever be void-and-replace.
            migrationBuilder.Sql(
                """
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
                    IF OLD."Status" = 'Voided' THEN
                        RAISE EXCEPTION 'A voided bodyweight observation is immutable' USING ERRCODE = '23514';
                    END IF;
                    IF NEW."Status" IS DISTINCT FROM OLD."Status" THEN
                        IF NEW."Status" <> 'Voided' THEN
                            RAISE EXCEPTION 'A bodyweight observation may only move from Active to Voided' USING ERRCODE = '23514';
                        END IF;
                        IF NEW."ValueKilograms" <> OLD."ValueKilograms"
                           OR NEW."EnteredValue" <> OLD."EnteredValue"
                           OR NEW."EnteredUnit" <> OLD."EnteredUnit"
                           OR NEW."Source" <> OLD."Source" THEN
                            RAISE EXCEPTION 'Voiding a bodyweight observation cannot change its recorded value' USING ERRCODE = '23514';
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
            migrationBuilder.Sql(
                """
                DROP TRIGGER "TR_BodyweightObservationVoids_AppendOnly" ON progress."BodyweightObservationVoids";
                """);

            migrationBuilder.DropTable(
                name: "BodyweightObservationVoids",
                schema: "progress");

            // Rolling back reinstates a total unique index, so a date still held by a voided row
            // would collide with its replacement. The voided rows go with the history that explains
            // them, and the trigger has to stand aside to allow it.
            migrationBuilder.Sql(
                """
                DROP TRIGGER "TR_BodyweightObservations_ProtectIdentity" ON progress."BodyweightObservations";

                DELETE FROM progress."BodyweightObservations" WHERE "Status" = 'Voided';

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

                CREATE TRIGGER "TR_BodyweightObservations_ProtectIdentity"
                    BEFORE UPDATE OR DELETE ON progress."BodyweightObservations"
                    FOR EACH ROW EXECUTE FUNCTION progress.protect_bodyweight_observation();
                """);

            migrationBuilder.DropIndex(
                name: "IX_BodyweightObservations_TenantId_ClientProfileId_Measurement~",
                schema: "progress",
                table: "BodyweightObservations");

            migrationBuilder.DropCheckConstraint(
                name: "CK_BodyweightObservations_IsActive",
                schema: "progress",
                table: "BodyweightObservations");

            migrationBuilder.DropColumn(
                name: "IsActive",
                schema: "progress",
                table: "BodyweightObservations");

            migrationBuilder.DropColumn(
                name: "Status",
                schema: "progress",
                table: "BodyweightObservations");

            migrationBuilder.CreateIndex(
                name: "IX_BodyweightObservations_TenantId_ClientProfileId_Measurement~",
                schema: "progress",
                table: "BodyweightObservations",
                columns: new[] { "TenantId", "ClientProfileId", "MeasurementDate" },
                unique: true);
        }
    }
}
