using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class CarryTrainingMaxes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_WorkingMaxSnapshots_TenantId_ClientProfileId",
                schema: "strength",
                table: "WorkingMaxSnapshots");

            migrationBuilder.AddColumn<Guid>(
                name: "CarriedFromSnapshotId",
                schema: "strength",
                table: "WorkingMaxSnapshots",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddUniqueConstraint(
                name: "AK_WorkingMaxSnapshots_TenantId_ClientProfileId_Id",
                schema: "strength",
                table: "WorkingMaxSnapshots",
                columns: new[] { "TenantId", "ClientProfileId", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_WorkingMaxSnapshots_TenantId_ClientProfileId_CarriedFromSna~",
                schema: "strength",
                table: "WorkingMaxSnapshots",
                columns: new[] { "TenantId", "ClientProfileId", "CarriedFromSnapshotId" });

            migrationBuilder.AddCheckConstraint(
                name: "CK_WorkingMaxSnapshots_CarriedFrom",
                schema: "strength",
                table: "WorkingMaxSnapshots",
                sql: "\"CarriedFromSnapshotId\" IS NULL OR (\"SourceMaxRecordId\" IS NULL AND \"BasisLoad\" IS NULL AND \"SupersedesSnapshotId\" IS NULL)");

            migrationBuilder.AddForeignKey(
                name: "FK_WorkingMaxSnapshots_WorkingMaxSnapshots_TenantId_ClientProf~",
                schema: "strength",
                table: "WorkingMaxSnapshots",
                columns: new[] { "TenantId", "ClientProfileId", "CarriedFromSnapshotId" },
                principalSchema: "strength",
                principalTable: "WorkingMaxSnapshots",
                principalColumns: new[] { "TenantId", "ClientProfileId", "Id" },
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_WorkingMaxSnapshots_WorkingMaxSnapshots_TenantId_ClientProf~",
                schema: "strength",
                table: "WorkingMaxSnapshots");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_WorkingMaxSnapshots_TenantId_ClientProfileId_Id",
                schema: "strength",
                table: "WorkingMaxSnapshots");

            migrationBuilder.DropIndex(
                name: "IX_WorkingMaxSnapshots_TenantId_ClientProfileId_CarriedFromSna~",
                schema: "strength",
                table: "WorkingMaxSnapshots");

            migrationBuilder.DropCheckConstraint(
                name: "CK_WorkingMaxSnapshots_CarriedFrom",
                schema: "strength",
                table: "WorkingMaxSnapshots");

            migrationBuilder.DropColumn(
                name: "CarriedFromSnapshotId",
                schema: "strength",
                table: "WorkingMaxSnapshots");

            migrationBuilder.CreateIndex(
                name: "IX_WorkingMaxSnapshots_TenantId_ClientProfileId",
                schema: "strength",
                table: "WorkingMaxSnapshots",
                columns: new[] { "TenantId", "ClientProfileId" });
        }
    }
}
