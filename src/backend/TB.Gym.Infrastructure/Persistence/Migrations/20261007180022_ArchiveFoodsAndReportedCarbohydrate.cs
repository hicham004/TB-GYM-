using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ArchiveFoodsAndReportedCarbohydrate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "ReportedCarbohydrateGrams",
                schema: "nutrition",
                table: "FoodItemVersions",
                type: "numeric(18,6)",
                precision: 18,
                scale: 6,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "ArchivedAtUtc",
                schema: "nutrition",
                table: "FoodItems",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_FoodItemVersions_ReportedCarbohydrate",
                schema: "nutrition",
                table: "FoodItemVersions",
                sql: "\"ReportedCarbohydrateGrams\" IS NULL OR (\"ReportedCarbohydrateGrams\" < 0 AND \"ReportedCarbohydrateGrams\" >= -0.5 AND \"CarbohydrateGrams\" = 0)");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_FoodItemVersions_ReportedCarbohydrate",
                schema: "nutrition",
                table: "FoodItemVersions");

            migrationBuilder.DropColumn(
                name: "ReportedCarbohydrateGrams",
                schema: "nutrition",
                table: "FoodItemVersions");

            migrationBuilder.DropColumn(
                name: "ArchivedAtUtc",
                schema: "nutrition",
                table: "FoodItems");
        }
    }
}
