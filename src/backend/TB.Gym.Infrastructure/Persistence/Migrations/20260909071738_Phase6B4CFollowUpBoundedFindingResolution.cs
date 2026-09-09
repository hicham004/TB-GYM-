using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Phase6B4CFollowUpBoundedFindingResolution : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_MediaInventoryRuns_CompletionEvidence",
                schema: "media",
                table: "InventoryRuns");

            migrationBuilder.AddColumn<bool>(
                name: "ResolutionCompleted",
                schema: "media",
                table: "InventoryRuns",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            // The same shape of upgrade the counter before it needed: the new column defaults to
            // false and the constraint below requires it of every completed run, so a database
            // carrying one would refuse the constraint and stop the upgrade. A run that completed
            // under the previous rule had already closed every finding it was going to before it
            // was allowed to complete, so true is what was true of it. A run still Running keeps
            // false and resolves in bounded batches like any other.
            migrationBuilder.Sql("""
                UPDATE media."InventoryRuns"
                SET "ResolutionCompleted" = TRUE
                WHERE "State" = 'Completed'
                """);

            migrationBuilder.AddCheckConstraint(
                name: "CK_MediaInventoryRuns_CompletionEvidence",
                schema: "media",
                table: "InventoryRuns",
                sql: "\"State\" <> 'Completed' OR (\"InventoryCompleted\" AND \"InventoryCursor\" IS NULL AND \"ProbeStage\" = 'Completed' AND \"PageFailureCount\" = 0 AND \"ResolutionCompleted\")");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_MediaInventoryRuns_CompletionEvidence",
                schema: "media",
                table: "InventoryRuns");

            migrationBuilder.DropColumn(
                name: "ResolutionCompleted",
                schema: "media",
                table: "InventoryRuns");

            migrationBuilder.AddCheckConstraint(
                name: "CK_MediaInventoryRuns_CompletionEvidence",
                schema: "media",
                table: "InventoryRuns",
                sql: "\"State\" <> 'Completed' OR (\"InventoryCompleted\" AND \"InventoryCursor\" IS NULL AND \"ProbeStage\" = 'Completed' AND \"PageFailureCount\" = 0)");
        }
    }
}
