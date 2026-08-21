using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Phase3CommercialHardening : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "DeletedAtUtc",
                schema: "media",
                table: "Assets",
                newName: "TombstonedAtUtc");

            migrationBuilder.Sql(
                """
                UPDATE media."Assets"
                SET "Status" = 'Tombstoned'
                WHERE "Status" = 'Deleted';

                -- Active is now a date-derived API state; only terminal state is persisted.
                UPDATE training."Mesocycles"
                SET "Status" = 'Planned'
                WHERE "Status" = 'Active';
                """);

            migrationBuilder.CreateTable(
                name: "ExercisePrescriptionMediaSnapshots",
                schema: "training",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ExercisePrescriptionId = table.Column<Guid>(type: "uuid", nullable: false),
                    MediaAssetId = table.Column<Guid>(type: "uuid", nullable: false),
                    DisplayOrder = table.Column<int>(type: "integer", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ExercisePrescriptionMediaSnapshots", x => x.Id);
                    table.UniqueConstraint("AK_ExercisePrescriptionMediaSnapshots_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_ExercisePrescriptionMediaSnapshots_DisplayOrder", "\"DisplayOrder\" >= 0");
                    table.ForeignKey(
                        name: "FK_ExercisePrescriptionMediaSnapshots_Assets_TenantId_MediaAss~",
                        columns: x => new { x.TenantId, x.MediaAssetId },
                        principalSchema: "media",
                        principalTable: "Assets",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ExercisePrescriptionMediaSnapshots_ExercisePrescriptions_Te~",
                        columns: x => new { x.TenantId, x.ExercisePrescriptionId },
                        principalSchema: "training",
                        principalTable: "ExercisePrescriptions",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "MesocycleLifecycleEvents",
                schema: "training",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    MesocycleId = table.Column<Guid>(type: "uuid", nullable: false),
                    EventType = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    FromStatus = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: true),
                    ToStatus = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    Reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
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
                    table.PrimaryKey("PK_MesocycleLifecycleEvents", x => x.Id);
                    table.UniqueConstraint("AK_MesocycleLifecycleEvents_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_MesocycleLifecycleEvents_Mesocycles_TenantId_MesocycleId",
                        columns: x => new { x.TenantId, x.MesocycleId },
                        principalSchema: "training",
                        principalTable: "Mesocycles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "WorkoutExerciseMediaSnapshots",
                schema: "training",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    WorkoutExercisePerformanceId = table.Column<Guid>(type: "uuid", nullable: false),
                    MediaAssetId = table.Column<Guid>(type: "uuid", nullable: false),
                    DisplayOrder = table.Column<int>(type: "integer", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WorkoutExerciseMediaSnapshots", x => x.Id);
                    table.UniqueConstraint("AK_WorkoutExerciseMediaSnapshots_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_WorkoutExerciseMediaSnapshots_DisplayOrder", "\"DisplayOrder\" >= 0");
                    table.ForeignKey(
                        name: "FK_WorkoutExerciseMediaSnapshots_Assets_TenantId_MediaAssetId",
                        columns: x => new { x.TenantId, x.MediaAssetId },
                        principalSchema: "media",
                        principalTable: "Assets",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_WorkoutExerciseMediaSnapshots_WorkoutExercisePerformances_T~",
                        columns: x => new { x.TenantId, x.WorkoutExercisePerformanceId },
                        principalSchema: "training",
                        principalTable: "WorkoutExercisePerformances",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.AddCheckConstraint(
                name: "CK_Mesocycles_StoredStatus",
                schema: "training",
                table: "Mesocycles",
                sql: "\"Status\" IN ('Planned', 'Completed', 'Cancelled')");

            migrationBuilder.CreateIndex(
                name: "IX_ExercisePrescriptionMediaSnapshots_TenantId_ExercisePrescri~",
                schema: "training",
                table: "ExercisePrescriptionMediaSnapshots",
                columns: new[] { "TenantId", "ExercisePrescriptionId", "DisplayOrder" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ExercisePrescriptionMediaSnapshots_TenantId_MediaAssetId",
                schema: "training",
                table: "ExercisePrescriptionMediaSnapshots",
                columns: new[] { "TenantId", "MediaAssetId" });

            migrationBuilder.CreateIndex(
                name: "IX_MesocycleLifecycleEvents_TenantId_MesocycleId_OccurredAtUtc",
                schema: "training",
                table: "MesocycleLifecycleEvents",
                columns: new[] { "TenantId", "MesocycleId", "OccurredAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_WorkoutExerciseMediaSnapshots_TenantId_MediaAssetId",
                schema: "training",
                table: "WorkoutExerciseMediaSnapshots",
                columns: new[] { "TenantId", "MediaAssetId" });

            migrationBuilder.CreateIndex(
                name: "IX_WorkoutExerciseMediaSnapshots_TenantId_WorkoutExercisePerfo~",
                schema: "training",
                table: "WorkoutExerciseMediaSnapshots",
                columns: new[] { "TenantId", "WorkoutExercisePerformanceId", "DisplayOrder" },
                unique: true);

            migrationBuilder.Sql(
                """
                INSERT INTO training."ExercisePrescriptionMediaSnapshots"
                    ("Id", "ExercisePrescriptionId", "MediaAssetId", "DisplayOrder",
                     "CreatedAtUtc", "CreatedByUserId", "UpdatedAtUtc", "UpdatedByUserId", "TenantId")
                SELECT md5(p."Id"::text || ':' || link."Id"::text)::uuid,
                       p."Id", link."MediaAssetId", link."DisplayOrder",
                       p."CreatedAtUtc", p."CreatedByUserId", p."UpdatedAtUtc", p."UpdatedByUserId", p."TenantId"
                FROM training."ExercisePrescriptions" p
                JOIN exercise_library."ExerciseMediaLinks" link
                  ON link."TenantId" = p."TenantId" AND link."ExerciseId" = p."ExerciseId"
                JOIN media."Assets" asset
                  ON asset."TenantId" = link."TenantId" AND asset."Id" = link."MediaAssetId"
                WHERE asset."Status" IN ('Ready', 'Tombstoned')
                ON CONFLICT DO NOTHING;

                INSERT INTO training."WorkoutExerciseMediaSnapshots"
                    ("Id", "WorkoutExercisePerformanceId", "MediaAssetId", "DisplayOrder",
                     "CreatedAtUtc", "CreatedByUserId", "UpdatedAtUtc", "UpdatedByUserId", "TenantId")
                SELECT md5(performance."Id"::text || ':' || media."Id"::text)::uuid,
                       performance."Id", media."MediaAssetId", media."DisplayOrder",
                       performance."CreatedAtUtc", performance."CreatedByUserId",
                       performance."UpdatedAtUtc", performance."UpdatedByUserId", performance."TenantId"
                FROM training."WorkoutExercisePerformances" performance
                JOIN training."ExercisePrescriptionMediaSnapshots" media
                  ON media."TenantId" = performance."TenantId"
                 AND media."ExercisePrescriptionId" = performance."ExercisePrescriptionId"
                ON CONFLICT DO NOTHING;

                INSERT INTO training."MesocycleLifecycleEvents"
                    ("Id", "MesocycleId", "EventType", "FromStatus", "ToStatus", "Reason", "OccurredAtUtc",
                     "CreatedAtUtc", "CreatedByUserId", "UpdatedAtUtc", "UpdatedByUserId", "TenantId")
                SELECT md5(m."Id"::text || ':assigned')::uuid,
                       m."Id", 'Assigned', NULL, 'Planned', 'Backfilled assignment lifecycle event.', m."CreatedAtUtc",
                       m."CreatedAtUtc", m."CreatedByUserId", m."UpdatedAtUtc", m."UpdatedByUserId", m."TenantId"
                FROM training."Mesocycles" m
                ON CONFLICT DO NOTHING;

                CREATE TRIGGER "TR_MesocycleLifecycleEvents_AppendOnly"
                BEFORE UPDATE OR DELETE ON training."MesocycleLifecycleEvents"
                FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

                CREATE TRIGGER "TR_ExercisePrescriptionMediaSnapshots_ProtectStarted"
                BEFORE INSERT OR UPDATE OR DELETE ON training."ExercisePrescriptionMediaSnapshots"
                FOR EACH ROW EXECUTE FUNCTION training.protect_set_prescription();

                CREATE TRIGGER "TR_WorkoutExerciseMediaSnapshots_AppendOnly"
                BEFORE UPDATE OR DELETE ON training."WorkoutExerciseMediaSnapshots"
                FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

                CREATE OR REPLACE FUNCTION training.protect_mesocycle_lifecycle()
                RETURNS trigger AS $body$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Assigned mesocycles cannot be deleted' USING ERRCODE = '55000';
                    END IF;
                    IF OLD."Status" IN ('Completed', 'Cancelled') THEN
                        RAISE EXCEPTION 'Terminal mesocycle history is immutable' USING ERRCODE = '55000';
                    END IF;
                    IF NEW."Status" = 'Cancelled' AND NEW."BlocksPrimaryOverlap" THEN
                        RAISE EXCEPTION 'A cancelled mesocycle cannot block primary overlap' USING ERRCODE = '23514';
                    END IF;
                    IF NOT NEW."BlocksPrimaryOverlap" AND NEW."Status" <> 'Cancelled' THEN
                        RAISE EXCEPTION 'Only a cancelled mesocycle can release primary overlap' USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END;
                $body$ LANGUAGE plpgsql;

                CREATE TRIGGER "TR_Mesocycles_ProtectLifecycle"
                BEFORE UPDATE OR DELETE ON training."Mesocycles"
                FOR EACH ROW EXECUTE FUNCTION training.protect_mesocycle_lifecycle();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                DROP TRIGGER IF EXISTS "TR_Mesocycles_ProtectLifecycle" ON training."Mesocycles";
                DROP FUNCTION IF EXISTS training.protect_mesocycle_lifecycle();
                UPDATE media."Assets" SET "Status" = 'Deleted' WHERE "Status" = 'Tombstoned';
                """);

            migrationBuilder.DropTable(
                name: "ExercisePrescriptionMediaSnapshots",
                schema: "training");

            migrationBuilder.DropTable(
                name: "MesocycleLifecycleEvents",
                schema: "training");

            migrationBuilder.DropTable(
                name: "WorkoutExerciseMediaSnapshots",
                schema: "training");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Mesocycles_StoredStatus",
                schema: "training",
                table: "Mesocycles");

            migrationBuilder.RenameColumn(
                name: "TombstonedAtUtc",
                schema: "media",
                table: "Assets",
                newName: "DeletedAtUtc");
        }
    }
}
