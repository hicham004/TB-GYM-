using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class MealPlanTargetSplit : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "TargetFatPercentage",
                schema: "nutrition",
                table: "MealPlanTemplateVersions",
                type: "numeric(7,4)",
                precision: 7,
                scale: 4,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TargetMacroMethodKey",
                schema: "nutrition",
                table: "MealPlanTemplateVersions",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TargetMacroMethodVersion",
                schema: "nutrition",
                table: "MealPlanTemplateVersions",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_MealPlanTemplateVersions_TargetSplit",
                schema: "nutrition",
                table: "MealPlanTemplateVersions",
                sql: "(\"TargetFatPercentage\" IS NULL AND \"TargetMacroMethodKey\" IS NULL AND \"TargetMacroMethodVersion\" IS NULL) OR (\"TargetFatPercentage\" IS NOT NULL AND \"TargetFatPercentage\" >= 0 AND \"TargetFatPercentage\" <= 100 AND \"TargetMacroMethodKey\" IS NOT NULL AND \"TargetMacroMethodVersion\" IS NOT NULL)");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_MealPlanTemplateVersions_TargetSplit",
                schema: "nutrition",
                table: "MealPlanTemplateVersions");

            migrationBuilder.DropColumn(
                name: "TargetFatPercentage",
                schema: "nutrition",
                table: "MealPlanTemplateVersions");

            migrationBuilder.DropColumn(
                name: "TargetMacroMethodKey",
                schema: "nutrition",
                table: "MealPlanTemplateVersions");

            migrationBuilder.DropColumn(
                name: "TargetMacroMethodVersion",
                schema: "nutrition",
                table: "MealPlanTemplateVersions");
        }
    }
}
