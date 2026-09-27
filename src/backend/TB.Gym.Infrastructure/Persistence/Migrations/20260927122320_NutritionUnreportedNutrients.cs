using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class NutritionUnreportedNutrients : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string[]>(
                name: "UnreportedNutrients",
                schema: "nutrition",
                table: "FoodItemVersions",
                type: "text[]",
                nullable: false,
                defaultValueSql: "'{}'::text[]");

            migrationBuilder.AddCheckConstraint(
                name: "CK_FoodItemVersions_UnreportedNutrients",
                schema: "nutrition",
                table: "FoodItemVersions",
                sql: "\"UnreportedNutrients\" <@ ARRAY['Fibre', 'Polyols', 'Ethanol']::text[] AND (NOT ('Fibre' = ANY(\"UnreportedNutrients\")) OR \"FibreGrams\" = 0) AND (NOT ('Polyols' = ANY(\"UnreportedNutrients\")) OR \"PolyolGrams\" = 0) AND (NOT ('Ethanol' = ANY(\"UnreportedNutrients\")) OR \"EthanolGrams\" = 0)");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_FoodItemVersions_UnreportedNutrients",
                schema: "nutrition",
                table: "FoodItemVersions");

            migrationBuilder.DropColumn(
                name: "UnreportedNutrients",
                schema: "nutrition",
                table: "FoodItemVersions");
        }
    }
}
