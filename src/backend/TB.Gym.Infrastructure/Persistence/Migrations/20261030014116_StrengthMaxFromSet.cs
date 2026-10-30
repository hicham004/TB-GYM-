using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class StrengthMaxFromSet : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "BasisLoad",
                schema: "strength",
                table: "MaxHistory",
                type: "numeric(8,3)",
                precision: 8,
                scale: 3,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "BasisRepetitions",
                schema: "strength",
                table: "MaxHistory",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "EstimateValue",
                schema: "strength",
                table: "MaxHistory",
                type: "numeric(8,3)",
                precision: 8,
                scale: 3,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "SharePercent",
                schema: "strength",
                table: "MaxHistory",
                type: "numeric(5,2)",
                precision: 5,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "SourceEstimateId",
                schema: "strength",
                table: "MaxHistory",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddUniqueConstraint(
                name: "AK_MaxHistory_TenantId_ClientProfileId_ExerciseId_Unit_Value_Id",
                schema: "strength",
                table: "MaxHistory",
                columns: new[] { "TenantId", "ClientProfileId", "ExerciseId", "Unit", "Value", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_MaxHistory_TenantId_ClientProfileId_ExerciseId_Unit_Estimat~",
                schema: "strength",
                table: "MaxHistory",
                columns: new[] { "TenantId", "ClientProfileId", "ExerciseId", "Unit", "EstimateValue", "SourceEstimateId" });

            migrationBuilder.AddCheckConstraint(
                name: "CK_StrengthMaxHistory_FromEstimate",
                schema: "strength",
                table: "MaxHistory",
                sql: "(\"SourceEstimateId\" IS NULL AND \"EstimateValue\" IS NULL AND \"SharePercent\" IS NULL) OR (\"SourceEstimateId\" IS NOT NULL AND \"EstimateValue\" > 0 AND \"EstimateValue\" <= 2000 AND \"SharePercent\" > 0 AND \"SharePercent\" <= 100 AND \"Kind\" = 'CoachWorkingMax' AND \"Source\" = 'Calculation' AND \"BasisLoad\" IS NULL AND \"Value\" = round(\"EstimateValue\" * \"SharePercent\" / 100, 3))");

            migrationBuilder.AddCheckConstraint(
                name: "CK_StrengthMaxHistory_SetBasis",
                schema: "strength",
                table: "MaxHistory",
                sql: "(\"BasisLoad\" IS NULL AND \"BasisRepetitions\" IS NULL) OR (\"BasisLoad\" > 0 AND \"BasisLoad\" <= 2000 AND \"BasisRepetitions\" >= 1 AND \"BasisRepetitions\" <= 10 AND \"Kind\" = 'EstimatedOneRepMax' AND \"Source\" = 'Calculation' AND \"Value\" >= \"BasisLoad\" AND \"Value\" <= round(\"BasisLoad\" * 40 / 30, 3))");

            migrationBuilder.AddForeignKey(
                name: "FK_MaxHistory_MaxHistory_TenantId_ClientProfileId_ExerciseId_U~",
                schema: "strength",
                table: "MaxHistory",
                columns: new[] { "TenantId", "ClientProfileId", "ExerciseId", "Unit", "EstimateValue", "SourceEstimateId" },
                principalSchema: "strength",
                principalTable: "MaxHistory",
                principalColumns: new[] { "TenantId", "ClientProfileId", "ExerciseId", "Unit", "Value", "Id" },
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_MaxHistory_MaxHistory_TenantId_ClientProfileId_ExerciseId_U~",
                schema: "strength",
                table: "MaxHistory");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_MaxHistory_TenantId_ClientProfileId_ExerciseId_Unit_Value_Id",
                schema: "strength",
                table: "MaxHistory");

            migrationBuilder.DropIndex(
                name: "IX_MaxHistory_TenantId_ClientProfileId_ExerciseId_Unit_Estimat~",
                schema: "strength",
                table: "MaxHistory");

            migrationBuilder.DropCheckConstraint(
                name: "CK_StrengthMaxHistory_FromEstimate",
                schema: "strength",
                table: "MaxHistory");

            migrationBuilder.DropCheckConstraint(
                name: "CK_StrengthMaxHistory_SetBasis",
                schema: "strength",
                table: "MaxHistory");

            migrationBuilder.DropColumn(
                name: "BasisLoad",
                schema: "strength",
                table: "MaxHistory");

            migrationBuilder.DropColumn(
                name: "BasisRepetitions",
                schema: "strength",
                table: "MaxHistory");

            migrationBuilder.DropColumn(
                name: "EstimateValue",
                schema: "strength",
                table: "MaxHistory");

            migrationBuilder.DropColumn(
                name: "SharePercent",
                schema: "strength",
                table: "MaxHistory");

            migrationBuilder.DropColumn(
                name: "SourceEstimateId",
                schema: "strength",
                table: "MaxHistory");
        }
    }
}
