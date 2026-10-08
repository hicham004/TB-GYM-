using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class CopyRecipesIntoClientPlans : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "CookMinutes",
                schema: "nutrition",
                table: "RecipeVersions",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "PrepMinutes",
                schema: "nutrition",
                table: "RecipeVersions",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ClientNutritionPlanRecipes",
                schema: "nutrition",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientNutritionPlanId = table.Column<Guid>(type: "uuid", nullable: false),
                    SourceRecipeVersionId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    Instructions = table.Column<string>(type: "character varying(20000)", maxLength: 20000, nullable: false),
                    Servings = table.Column<decimal>(type: "numeric(12,4)", precision: 12, scale: 4, nullable: false),
                    PrepMinutes = table.Column<int>(type: "integer", nullable: true),
                    CookMinutes = table.Column<int>(type: "integer", nullable: true),
                    PhotoMediaAssetId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ClientNutritionPlanRecipes", x => x.Id);
                    table.UniqueConstraint("AK_ClientNutritionPlanRecipes_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_ClientNutritionPlanRecipes_Values", "\"Servings\" > 0 AND (\"PrepMinutes\" IS NULL OR \"PrepMinutes\" BETWEEN 0 AND 2880) AND (\"CookMinutes\" IS NULL OR \"CookMinutes\" BETWEEN 0 AND 2880)");
                    table.ForeignKey(
                        name: "FK_ClientNutritionPlanRecipes_Assets_TenantId_PhotoMediaAssetId",
                        columns: x => new { x.TenantId, x.PhotoMediaAssetId },
                        principalSchema: "media",
                        principalTable: "Assets",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ClientNutritionPlanRecipes_ClientNutritionPlans_TenantId_Cl~",
                        columns: x => new { x.TenantId, x.ClientNutritionPlanId },
                        principalSchema: "nutrition",
                        principalTable: "ClientNutritionPlans",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ClientNutritionPlanRecipes_RecipeVersions_TenantId_SourceRe~",
                        columns: x => new { x.TenantId, x.SourceRecipeVersionId },
                        principalSchema: "nutrition",
                        principalTable: "RecipeVersions",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ClientNutritionPlanRecipeIngredients",
                schema: "nutrition",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientNutritionPlanRecipeId = table.Column<Guid>(type: "uuid", nullable: false),
                    Order = table.Column<int>(type: "integer", nullable: false),
                    FoodName = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    Quantity = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    Unit = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Basis = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ClientNutritionPlanRecipeIngredients", x => x.Id);
                    table.UniqueConstraint("AK_ClientNutritionPlanRecipeIngredients_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_ClientNutritionPlanRecipeIngredients_Quantity", "\"Quantity\" > 0");
                    table.ForeignKey(
                        name: "FK_ClientNutritionPlanRecipeIngredients_ClientNutritionPlanRec~",
                        columns: x => new { x.TenantId, x.ClientNutritionPlanRecipeId },
                        principalSchema: "nutrition",
                        principalTable: "ClientNutritionPlanRecipes",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.AddCheckConstraint(
                name: "CK_RecipeVersions_Minutes",
                schema: "nutrition",
                table: "RecipeVersions",
                sql: "(\"PrepMinutes\" IS NULL OR \"PrepMinutes\" BETWEEN 0 AND 2880) AND (\"CookMinutes\" IS NULL OR \"CookMinutes\" BETWEEN 0 AND 2880)");

            migrationBuilder.CreateIndex(
                name: "IX_ClientNutritionPlanRecipeIngredients_TenantId_ClientNutriti~",
                schema: "nutrition",
                table: "ClientNutritionPlanRecipeIngredients",
                columns: new[] { "TenantId", "ClientNutritionPlanRecipeId", "Order" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ClientNutritionPlanRecipes_TenantId_ClientNutritionPlanId_S~",
                schema: "nutrition",
                table: "ClientNutritionPlanRecipes",
                columns: new[] { "TenantId", "ClientNutritionPlanId", "SourceRecipeVersionId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ClientNutritionPlanRecipes_TenantId_PhotoMediaAssetId",
                schema: "nutrition",
                table: "ClientNutritionPlanRecipes",
                columns: new[] { "TenantId", "PhotoMediaAssetId" });

            migrationBuilder.CreateIndex(
                name: "IX_ClientNutritionPlanRecipes_TenantId_SourceRecipeVersionId",
                schema: "nutrition",
                table: "ClientNutritionPlanRecipes",
                columns: new[] { "TenantId", "SourceRecipeVersionId" });

            // Plans assigned before R4.4d get the copy assignment now makes (NUT-006). Recipe versions
            // never change, so copying them today gives what assignment would have copied; the name is
            // the one the plan already shows, from its first day and meal that offers the recipe.
            migrationBuilder.Sql("""
                INSERT INTO nutrition."ClientNutritionPlanRecipes"
                    ("Id", "TenantId", "ClientNutritionPlanId", "SourceRecipeVersionId", "Name", "Instructions", "Servings", "PrepMinutes", "CookMinutes", "PhotoMediaAssetId")
                SELECT gen_random_uuid(), n."TenantId", n."ClientNutritionPlanId", n."SourceRecipeVersionId",
                       n."RecipeName", v."Instructions", v."Servings", v."PrepMinutes", v."CookMinutes", v."PhotoMediaAssetId"
                FROM (
                    SELECT DISTINCT ON (d."TenantId", d."ClientNutritionPlanId", c."SourceRecipeVersionId")
                           d."TenantId", d."ClientNutritionPlanId", c."SourceRecipeVersionId", c."RecipeName"
                    FROM nutrition."ClientNutritionPlanChoices" c
                    JOIN nutrition."ClientNutritionPlanSlots" s ON s."TenantId" = c."TenantId" AND s."Id" = c."ClientNutritionPlanSlotId"
                    JOIN nutrition."ClientNutritionPlanDays" d ON d."TenantId" = s."TenantId" AND d."Id" = s."ClientNutritionPlanDayId"
                    ORDER BY d."TenantId", d."ClientNutritionPlanId", c."SourceRecipeVersionId", d."Date", s."Order"
                ) n
                JOIN nutrition."RecipeVersions" v ON v."TenantId" = n."TenantId" AND v."Id" = n."SourceRecipeVersionId";

                INSERT INTO nutrition."ClientNutritionPlanRecipeIngredients"
                    ("Id", "TenantId", "ClientNutritionPlanRecipeId", "Order", "FoodName", "Quantity", "Unit", "Basis")
                SELECT gen_random_uuid(), r."TenantId", r."Id", l."Order", l."FoodName", l."Quantity", l."Unit", l."Basis"
                FROM nutrition."ClientNutritionPlanRecipes" r
                JOIN nutrition."RecipeIngredients" l ON l."TenantId" = r."TenantId" AND l."RecipeVersionId" = r."SourceRecipeVersionId";
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ClientNutritionPlanRecipeIngredients",
                schema: "nutrition");

            migrationBuilder.DropTable(
                name: "ClientNutritionPlanRecipes",
                schema: "nutrition");

            migrationBuilder.DropCheckConstraint(
                name: "CK_RecipeVersions_Minutes",
                schema: "nutrition",
                table: "RecipeVersions");

            migrationBuilder.DropColumn(
                name: "CookMinutes",
                schema: "nutrition",
                table: "RecipeVersions");

            migrationBuilder.DropColumn(
                name: "PrepMinutes",
                schema: "nutrition",
                table: "RecipeVersions");
        }
    }
}
