using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class EstimateMaxesFromLoggedSets : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "SourceSetPerformanceId",
                schema: "strength",
                table: "WorkingMaxSnapshots",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_WorkingMaxSnapshots_TenantId_SourceSetPerformanceId",
                schema: "strength",
                table: "WorkingMaxSnapshots",
                columns: new[] { "TenantId", "SourceSetPerformanceId" });

            migrationBuilder.AddCheckConstraint(
                name: "CK_WorkingMaxSnapshots_LoggedSetBasis",
                schema: "strength",
                table: "WorkingMaxSnapshots",
                sql: "\"SourceSetPerformanceId\" IS NULL OR \"BasisLoad\" IS NOT NULL");

            migrationBuilder.AddForeignKey(
                name: "FK_WorkingMaxSnapshots_WorkoutSetPerformances_TenantId_SourceS~",
                schema: "strength",
                table: "WorkingMaxSnapshots",
                columns: new[] { "TenantId", "SourceSetPerformanceId" },
                principalSchema: "training",
                principalTable: "WorkoutSetPerformances",
                principalColumns: new[] { "TenantId", "Id" },
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_WorkingMaxSnapshots_WorkoutSetPerformances_TenantId_SourceS~",
                schema: "strength",
                table: "WorkingMaxSnapshots");

            migrationBuilder.DropIndex(
                name: "IX_WorkingMaxSnapshots_TenantId_SourceSetPerformanceId",
                schema: "strength",
                table: "WorkingMaxSnapshots");

            migrationBuilder.DropCheckConstraint(
                name: "CK_WorkingMaxSnapshots_LoggedSetBasis",
                schema: "strength",
                table: "WorkingMaxSnapshots");

            migrationBuilder.DropColumn(
                name: "SourceSetPerformanceId",
                schema: "strength",
                table: "WorkingMaxSnapshots");
        }
    }
}
