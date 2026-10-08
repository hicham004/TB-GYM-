using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class KeepTrainingMaxes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "WorkingMaxKeeps",
                schema: "strength",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    MesocycleId = table.Column<Guid>(type: "uuid", nullable: false),
                    WorkingMaxSnapshotId = table.Column<Guid>(type: "uuid", nullable: false),
                    LoggedSetPerformanceId = table.Column<Guid>(type: "uuid", nullable: false),
                    SuggestedValue = table.Column<decimal>(type: "numeric(8,3)", precision: 8, scale: 3, nullable: false),
                    Unit = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WorkingMaxKeeps", x => x.Id);
                    table.UniqueConstraint("AK_WorkingMaxKeeps_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_WorkingMaxKeeps_SuggestedValue", "\"SuggestedValue\" > 0 AND \"SuggestedValue\" <= 2000");
                    table.ForeignKey(
                        name: "FK_WorkingMaxKeeps_Mesocycles_TenantId_MesocycleId",
                        columns: x => new { x.TenantId, x.MesocycleId },
                        principalSchema: "training",
                        principalTable: "Mesocycles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_WorkingMaxKeeps_WorkingMaxSnapshots_TenantId_WorkingMaxSnap~",
                        columns: x => new { x.TenantId, x.WorkingMaxSnapshotId },
                        principalSchema: "strength",
                        principalTable: "WorkingMaxSnapshots",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_WorkingMaxKeeps_WorkoutSetPerformances_TenantId_LoggedSetPe~",
                        columns: x => new { x.TenantId, x.LoggedSetPerformanceId },
                        principalSchema: "training",
                        principalTable: "WorkoutSetPerformances",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_WorkingMaxKeeps_OneKeepPerMaxAndSet",
                schema: "strength",
                table: "WorkingMaxKeeps",
                columns: new[] { "TenantId", "WorkingMaxSnapshotId", "LoggedSetPerformanceId" },
                unique: true);

            // A keep is the record that the coach weighed a suggestion (STR-013); it is never changed or removed.
            migrationBuilder.Sql(
                """
                CREATE TRIGGER "TR_WorkingMaxKeeps_AppendOnly"
                BEFORE UPDATE OR DELETE ON strength."WorkingMaxKeeps"
                FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
                """);

            migrationBuilder.CreateIndex(
                name: "IX_WorkingMaxKeeps_TenantId_LoggedSetPerformanceId",
                schema: "strength",
                table: "WorkingMaxKeeps",
                columns: new[] { "TenantId", "LoggedSetPerformanceId" });

            migrationBuilder.CreateIndex(
                name: "IX_WorkingMaxKeeps_TenantId_MesocycleId_CreatedAtUtc",
                schema: "strength",
                table: "WorkingMaxKeeps",
                columns: new[] { "TenantId", "MesocycleId", "CreatedAtUtc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "WorkingMaxKeeps",
                schema: "strength");
        }
    }
}
