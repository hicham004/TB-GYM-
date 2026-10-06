using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddTrainingMaxes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // A lift's maxes in one program are a single chain from here on (STR-002). Nothing created two
            // first maxes for a lift until now; if a database somehow holds them, stop with a plain message
            // rather than choosing which to keep.
            migrationBuilder.Sql(
                """
                DO $migration$
                BEGIN
                    IF EXISTS (
                        SELECT 1 FROM strength."WorkingMaxSnapshots"
                        WHERE "SupersedesSnapshotId" IS NULL
                        GROUP BY "TenantId", "MesocycleId", "ExerciseId"
                        HAVING count(*) > 1
                    ) THEN
                        RAISE EXCEPTION 'A program has more than one first training max for a lift. Review them before retrying this migration.'
                            USING ERRCODE = '23505';
                    END IF;
                END;
                $migration$;
                """);

            migrationBuilder.DropIndex(
                name: "IX_WorkingMaxSnapshots_TenantId_MesocycleId_ExerciseId_Effecti~",
                schema: "strength",
                table: "WorkingMaxSnapshots");

            migrationBuilder.DropIndex(
                name: "IX_WorkingMaxSnapshots_TenantId_SupersedesSnapshotId",
                schema: "strength",
                table: "WorkingMaxSnapshots");

            migrationBuilder.AddColumn<decimal>(
                name: "BasisLoad",
                schema: "strength",
                table: "WorkingMaxSnapshots",
                type: "numeric(8,3)",
                precision: 8,
                scale: 3,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "BasisRepetitions",
                schema: "strength",
                table: "WorkingMaxSnapshots",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "BasisRpe",
                schema: "strength",
                table: "WorkingMaxSnapshots",
                type: "numeric(3,1)",
                precision: 3,
                scale: 1,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "EstimateMethodKey",
                schema: "strength",
                table: "WorkingMaxSnapshots",
                type: "character varying(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "EstimateMethodVersion",
                schema: "strength",
                table: "WorkingMaxSnapshots",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "WorkingMaxUpdates",
                schema: "strength",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    MesocycleId = table.Column<Guid>(type: "uuid", nullable: false),
                    IdempotencyKey = table.Column<Guid>(type: "uuid", nullable: false),
                    RequestFingerprint = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    PreviewHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    EffectiveFromWeek = table.Column<int>(type: "integer", nullable: false),
                    LiftCount = table.Column<int>(type: "integer", nullable: false),
                    SessionCount = table.Column<int>(type: "integer", nullable: false),
                    SetCount = table.Column<int>(type: "integer", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WorkingMaxUpdates", x => x.Id);
                    table.UniqueConstraint("AK_WorkingMaxUpdates_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_WorkingMaxUpdates_Counts", "\"EffectiveFromWeek\" >= 1 AND \"EffectiveFromWeek\" <= 52 AND \"LiftCount\" >= 1 AND \"SessionCount\" >= 0 AND \"SetCount\" >= 0");
                    table.CheckConstraint("CK_WorkingMaxUpdates_Hashes", "char_length(\"RequestFingerprint\") = 64 AND char_length(\"PreviewHash\") = 64");
                    table.ForeignKey(
                        name: "FK_WorkingMaxUpdates_Mesocycles_TenantId_MesocycleId",
                        columns: x => new { x.TenantId, x.MesocycleId },
                        principalSchema: "training",
                        principalTable: "Mesocycles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_WorkingMaxSnapshots_OneRoot",
                schema: "strength",
                table: "WorkingMaxSnapshots",
                columns: new[] { "TenantId", "MesocycleId", "ExerciseId" },
                unique: true,
                filter: "\"SupersedesSnapshotId\" IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_WorkingMaxSnapshots_OneSuccessor",
                schema: "strength",
                table: "WorkingMaxSnapshots",
                columns: new[] { "TenantId", "SupersedesSnapshotId" },
                unique: true,
                filter: "\"SupersedesSnapshotId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_WorkingMaxSnapshots_TenantId_MesocycleId_ExerciseId_Effecti~",
                schema: "strength",
                table: "WorkingMaxSnapshots",
                columns: new[] { "TenantId", "MesocycleId", "ExerciseId", "EffectiveFromWeek" });

            migrationBuilder.AddCheckConstraint(
                name: "CK_WorkingMaxSnapshots_WeekOneBasis",
                schema: "strength",
                table: "WorkingMaxSnapshots",
                sql: "(\"BasisLoad\" IS NULL AND \"BasisRepetitions\" IS NULL AND \"BasisRpe\" IS NULL AND \"EstimateMethodKey\" IS NULL AND \"EstimateMethodVersion\" IS NULL) OR (\"BasisLoad\" > 0 AND \"BasisLoad\" <= 2000 AND \"BasisRepetitions\" >= 1 AND \"BasisRepetitions\" <= 100 AND \"BasisRpe\" >= 5 AND \"BasisRpe\" <= 10 AND \"EstimateMethodKey\" IS NOT NULL AND \"EstimateMethodVersion\" IS NOT NULL AND \"SourceMaxRecordId\" IS NULL)");

            migrationBuilder.CreateIndex(
                name: "IX_WorkingMaxUpdates_TenantId_IdempotencyKey",
                schema: "strength",
                table: "WorkingMaxUpdates",
                columns: new[] { "TenantId", "IdempotencyKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_WorkingMaxUpdates_TenantId_MesocycleId_CreatedAtUtc",
                schema: "strength",
                table: "WorkingMaxUpdates",
                columns: new[] { "TenantId", "MesocycleId", "CreatedAtUtc" });

            migrationBuilder.Sql(
                """
                CREATE TRIGGER "TR_WorkingMaxUpdates_AppendOnly"
                BEFORE UPDATE OR DELETE ON strength."WorkingMaxUpdates"
                FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "WorkingMaxUpdates",
                schema: "strength");

            migrationBuilder.DropIndex(
                name: "IX_WorkingMaxSnapshots_OneRoot",
                schema: "strength",
                table: "WorkingMaxSnapshots");

            migrationBuilder.DropIndex(
                name: "IX_WorkingMaxSnapshots_OneSuccessor",
                schema: "strength",
                table: "WorkingMaxSnapshots");

            migrationBuilder.DropIndex(
                name: "IX_WorkingMaxSnapshots_TenantId_MesocycleId_ExerciseId_Effecti~",
                schema: "strength",
                table: "WorkingMaxSnapshots");

            migrationBuilder.DropCheckConstraint(
                name: "CK_WorkingMaxSnapshots_WeekOneBasis",
                schema: "strength",
                table: "WorkingMaxSnapshots");

            migrationBuilder.DropColumn(
                name: "BasisLoad",
                schema: "strength",
                table: "WorkingMaxSnapshots");

            migrationBuilder.DropColumn(
                name: "BasisRepetitions",
                schema: "strength",
                table: "WorkingMaxSnapshots");

            migrationBuilder.DropColumn(
                name: "BasisRpe",
                schema: "strength",
                table: "WorkingMaxSnapshots");

            migrationBuilder.DropColumn(
                name: "EstimateMethodKey",
                schema: "strength",
                table: "WorkingMaxSnapshots");

            migrationBuilder.DropColumn(
                name: "EstimateMethodVersion",
                schema: "strength",
                table: "WorkingMaxSnapshots");

            migrationBuilder.CreateIndex(
                name: "IX_WorkingMaxSnapshots_TenantId_MesocycleId_ExerciseId_Effecti~",
                schema: "strength",
                table: "WorkingMaxSnapshots",
                columns: new[] { "TenantId", "MesocycleId", "ExerciseId", "EffectiveFromWeek" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_WorkingMaxSnapshots_TenantId_SupersedesSnapshotId",
                schema: "strength",
                table: "WorkingMaxSnapshots",
                columns: new[] { "TenantId", "SupersedesSnapshotId" });
        }
    }
}
