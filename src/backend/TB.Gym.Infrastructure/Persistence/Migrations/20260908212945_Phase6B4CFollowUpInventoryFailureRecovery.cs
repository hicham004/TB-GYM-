using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Phase6B4CFollowUpInventoryFailureRecovery : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_MediaInventoryRuns_Counters",
                schema: "media",
                table: "InventoryRuns");

            migrationBuilder.AddColumn<int>(
                name: "TotalPageFailureCount",
                schema: "media",
                table: "InventoryRuns",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddCheckConstraint(
                name: "CK_MediaInventoryRuns_Counters",
                schema: "media",
                table: "InventoryRuns",
                sql: "\"ObjectsScanned\" >= 0 AND \"ObjectsSkippedRecent\" >= 0 AND \"ObjectsSkippedOwnedByPurge\" >= 0 AND \"UnattributableKeyCount\" >= 0 AND \"OwnersProbed\" >= 0 AND \"OwnersSkippedNotReconciled\" >= 0 AND \"OwnersSkippedOwnedByPurge\" >= 0 AND \"FindingsOpened\" >= 0 AND \"FindingsResolved\" >= 0 AND \"PageFailureCount\" >= 0 AND \"TotalPageFailureCount\" >= \"PageFailureCount\"");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_MediaInventoryRuns_Counters",
                schema: "media",
                table: "InventoryRuns");

            migrationBuilder.DropColumn(
                name: "TotalPageFailureCount",
                schema: "media",
                table: "InventoryRuns");

            migrationBuilder.AddCheckConstraint(
                name: "CK_MediaInventoryRuns_Counters",
                schema: "media",
                table: "InventoryRuns",
                sql: "\"ObjectsScanned\" >= 0 AND \"ObjectsSkippedRecent\" >= 0 AND \"ObjectsSkippedOwnedByPurge\" >= 0 AND \"UnattributableKeyCount\" >= 0 AND \"OwnersProbed\" >= 0 AND \"OwnersSkippedNotReconciled\" >= 0 AND \"OwnersSkippedOwnedByPurge\" >= 0 AND \"FindingsOpened\" >= 0 AND \"FindingsResolved\" >= 0 AND \"PageFailureCount\" >= 0");
        }
    }
}
