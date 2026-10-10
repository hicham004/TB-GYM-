using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ProgressPhotoSlotFreedOnRemoval : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_ProgressPhotos_TenantId_ClientProfileId_PhotoDate_Pose",
                schema: "progress",
                table: "ProgressPhotos");

            migrationBuilder.CreateIndex(
                name: "IX_ProgressPhotos_TenantId_ClientProfileId_PhotoDate_Pose",
                schema: "progress",
                table: "ProgressPhotos",
                columns: new[] { "TenantId", "ClientProfileId", "PhotoDate", "Pose" },
                unique: true,
                filter: "\"Status\" = 'Active'");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_ProgressPhotos_TenantId_ClientProfileId_PhotoDate_Pose",
                schema: "progress",
                table: "ProgressPhotos");

            migrationBuilder.CreateIndex(
                name: "IX_ProgressPhotos_TenantId_ClientProfileId_PhotoDate_Pose",
                schema: "progress",
                table: "ProgressPhotos",
                columns: new[] { "TenantId", "ClientProfileId", "PhotoDate", "Pose" },
                unique: true);
        }
    }
}
