using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class MealOptionOrder : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_MealPlanChoices_TenantId_MealPlanSlotId",
                schema: "nutrition",
                table: "MealPlanChoices");

            migrationBuilder.DropIndex(
                name: "IX_ClientNutritionPlanChoices_TenantId_ClientNutritionPlanSlot~",
                schema: "nutrition",
                table: "ClientNutritionPlanChoices");

            migrationBuilder.AddColumn<int>(
                name: "Order",
                schema: "nutrition",
                table: "MealPlanChoices",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "Order",
                schema: "nutrition",
                table: "ClientNutritionPlanChoices",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            // B5a: a meal's options get the order they are read in today, so neither a coach nor a
            // client sees them move. Without an order column the reads return a meal's options in the
            // order the rows are stored (EF wrote them in key order, so it is also their id order),
            // which ctid gives back. Published versions and clients' plans refuse updates, so their
            // guards step aside for this one statement, inside the migration's transaction. Every
            // choice written from now on names its place, so the columns keep no default.
            migrationBuilder.Sql("""
                ALTER TABLE nutrition."MealPlanChoices" DISABLE TRIGGER "TR_MealPlanChoices_PublishedImmutable";
                UPDATE nutrition."MealPlanChoices" AS choice
                SET "Order" = placed.position
                FROM (
                    SELECT "Id", ROW_NUMBER() OVER (PARTITION BY "TenantId", "MealPlanSlotId" ORDER BY ctid) - 1 AS position
                    FROM nutrition."MealPlanChoices") AS placed
                WHERE choice."Id" = placed."Id" AND placed.position <> 0;
                ALTER TABLE nutrition."MealPlanChoices" ENABLE TRIGGER "TR_MealPlanChoices_PublishedImmutable";
                ALTER TABLE nutrition."MealPlanChoices" ALTER COLUMN "Order" DROP DEFAULT;

                ALTER TABLE nutrition."ClientNutritionPlanChoices" DISABLE TRIGGER "TR_ClientNutritionPlanChoices_Immutable";
                UPDATE nutrition."ClientNutritionPlanChoices" AS choice
                SET "Order" = placed.position
                FROM (
                    SELECT "Id", ROW_NUMBER() OVER (PARTITION BY "TenantId", "ClientNutritionPlanSlotId" ORDER BY ctid) - 1 AS position
                    FROM nutrition."ClientNutritionPlanChoices") AS placed
                WHERE choice."Id" = placed."Id" AND placed.position <> 0;
                ALTER TABLE nutrition."ClientNutritionPlanChoices" ENABLE TRIGGER "TR_ClientNutritionPlanChoices_Immutable";
                ALTER TABLE nutrition."ClientNutritionPlanChoices" ALTER COLUMN "Order" DROP DEFAULT;
                """);

            migrationBuilder.CreateIndex(
                name: "IX_MealPlanChoices_OnePerPlace",
                schema: "nutrition",
                table: "MealPlanChoices",
                columns: new[] { "TenantId", "MealPlanSlotId", "Order" },
                unique: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_MealPlanChoices_Order",
                schema: "nutrition",
                table: "MealPlanChoices",
                sql: "\"Order\" >= 0");

            migrationBuilder.CreateIndex(
                name: "IX_ClientNutritionPlanChoices_OnePerPlace",
                schema: "nutrition",
                table: "ClientNutritionPlanChoices",
                columns: new[] { "TenantId", "ClientNutritionPlanSlotId", "Order" },
                unique: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_ClientNutritionPlanChoices_Order",
                schema: "nutrition",
                table: "ClientNutritionPlanChoices",
                sql: "\"Order\" >= 0");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_MealPlanChoices_OnePerPlace",
                schema: "nutrition",
                table: "MealPlanChoices");

            migrationBuilder.DropCheckConstraint(
                name: "CK_MealPlanChoices_Order",
                schema: "nutrition",
                table: "MealPlanChoices");

            migrationBuilder.DropIndex(
                name: "IX_ClientNutritionPlanChoices_OnePerPlace",
                schema: "nutrition",
                table: "ClientNutritionPlanChoices");

            migrationBuilder.DropCheckConstraint(
                name: "CK_ClientNutritionPlanChoices_Order",
                schema: "nutrition",
                table: "ClientNutritionPlanChoices");

            migrationBuilder.DropColumn(
                name: "Order",
                schema: "nutrition",
                table: "MealPlanChoices");

            migrationBuilder.DropColumn(
                name: "Order",
                schema: "nutrition",
                table: "ClientNutritionPlanChoices");

            migrationBuilder.CreateIndex(
                name: "IX_MealPlanChoices_TenantId_MealPlanSlotId",
                schema: "nutrition",
                table: "MealPlanChoices",
                columns: new[] { "TenantId", "MealPlanSlotId" });

            migrationBuilder.CreateIndex(
                name: "IX_ClientNutritionPlanChoices_TenantId_ClientNutritionPlanSlot~",
                schema: "nutrition",
                table: "ClientNutritionPlanChoices",
                columns: new[] { "TenantId", "ClientNutritionPlanSlotId" });
        }
    }
}
