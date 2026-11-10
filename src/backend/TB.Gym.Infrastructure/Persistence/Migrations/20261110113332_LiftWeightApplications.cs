using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class LiftWeightApplications : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "LiftWeightApplications",
                schema: "training",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientProfileId = table.Column<Guid>(type: "uuid", nullable: false),
                    MesocycleId = table.Column<Guid>(type: "uuid", nullable: false),
                    TrainingSessionId = table.Column<Guid>(type: "uuid", nullable: false),
                    SessionName = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    SessionDate = table.Column<DateOnly>(type: "date", nullable: false),
                    ExercisePrescriptionId = table.Column<Guid>(type: "uuid", nullable: false),
                    ExerciseId = table.Column<Guid>(type: "uuid", nullable: false),
                    ExerciseName = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    Occurrence = table.Column<int>(type: "integer", nullable: false),
                    RuleKey = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    RuleVersion = table.Column<int>(type: "integer", nullable: false),
                    Outcome = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    ReasonKind = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    LastTimeWorkoutExecutionId = table.Column<Guid>(type: "uuid", nullable: true),
                    LastTimeDay = table.Column<DateOnly>(type: "date", nullable: true),
                    JudgedOn = table.Column<DateOnly>(type: "date", nullable: false),
                    SetCount = table.Column<int>(type: "integer", nullable: false),
                    IdempotencyKey = table.Column<Guid>(type: "uuid", nullable: false),
                    RequestFingerprint = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    StandingJson = table.Column<string>(type: "jsonb", nullable: false),
                    AppliedSetsJson = table.Column<string>(type: "jsonb", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LiftWeightApplications", x => x.Id);
                    table.UniqueConstraint("AK_LiftWeightApplications_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_LiftWeightApplications_Counts", "\"Occurrence\" >= 1 AND \"SetCount\" >= 1 AND \"SetCount\" <= 20 AND \"RuleVersion\" >= 1");
                    table.CheckConstraint("CK_LiftWeightApplications_Fingerprint", "\"RequestFingerprint\" ~ '^[0-9a-f]{64}$'");
                    table.ForeignKey(
                        name: "FK_LiftWeightApplications_Mesocycles_TenantId_MesocycleId",
                        columns: x => new { x.TenantId, x.MesocycleId },
                        principalSchema: "training",
                        principalTable: "Mesocycles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_LiftWeightApplications_OnePerKeyAndLift",
                schema: "training",
                table: "LiftWeightApplications",
                columns: new[] { "TenantId", "IdempotencyKey", "ExercisePrescriptionId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_LiftWeightApplications_TenantId_ClientProfileId_CreatedAtUtc",
                schema: "training",
                table: "LiftWeightApplications",
                columns: new[] { "TenantId", "ClientProfileId", "CreatedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_LiftWeightApplications_TenantId_ExercisePrescriptionId_Crea~",
                schema: "training",
                table: "LiftWeightApplications",
                columns: new[] { "TenantId", "ExercisePrescriptionId", "CreatedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_LiftWeightApplications_TenantId_MesocycleId",
                schema: "training",
                table: "LiftWeightApplications",
                columns: new[] { "TenantId", "MesocycleId" });

            // One request per idempotency key: two requests reusing a key at once, on different lifts, cannot both land.
            migrationBuilder.Sql(
                """
                ALTER TABLE training."LiftWeightApplications"
                    ADD CONSTRAINT "EX_LiftWeightApplications_OneRequestPerKey"
                    EXCLUDE USING gist
                    (
                        "TenantId" WITH =,
                        "IdempotencyKey" WITH =,
                        "RequestFingerprint" WITH <>
                    );
                """);

            // An applied weight is a fact about what a client was given and why: never rewritten, never deleted.
            migrationBuilder.Sql(
                """
                CREATE TRIGGER "TR_LiftWeightApplications_AppendOnly"
                BEFORE UPDATE OR DELETE ON training."LiftWeightApplications"
                FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Applied weights are history kept append-only, so going back is a forward fix (ADR 0036, ADR 0040): stop
            // with a plain message while any exists instead of dropping them.
            migrationBuilder.Sql(
                """
                DO $migration$
                BEGIN
                    IF EXISTS (SELECT 1 FROM training."LiftWeightApplications") THEN
                        RAISE EXCEPTION 'Some weights were applied from Last time + step; roll forward instead of reverting this migration.'
                            USING ERRCODE = '55000';
                    END IF;
                END;
                $migration$;
                """);

            migrationBuilder.Sql(
                """
                DROP TRIGGER IF EXISTS "TR_LiftWeightApplications_AppendOnly" ON training."LiftWeightApplications";
                """);

            migrationBuilder.DropTable(
                name: "LiftWeightApplications",
                schema: "training");
        }
    }
}
