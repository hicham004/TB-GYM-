using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddRecipePhotos : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "PhotoMediaAssetId",
                schema: "nutrition",
                table: "RecipeVersions",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_RecipeVersions_TenantId_PhotoMediaAssetId",
                schema: "nutrition",
                table: "RecipeVersions",
                columns: new[] { "TenantId", "PhotoMediaAssetId" });

            migrationBuilder.AddForeignKey(
                name: "FK_RecipeVersions_Assets_TenantId_PhotoMediaAssetId",
                schema: "nutrition",
                table: "RecipeVersions",
                columns: new[] { "TenantId", "PhotoMediaAssetId" },
                principalSchema: "media",
                principalTable: "Assets",
                principalColumns: new[] { "TenantId", "Id" },
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_RecipeVersions_Assets_TenantId_PhotoMediaAssetId",
                schema: "nutrition",
                table: "RecipeVersions");

            migrationBuilder.DropIndex(
                name: "IX_RecipeVersions_TenantId_PhotoMediaAssetId",
                schema: "nutrition",
                table: "RecipeVersions");

            migrationBuilder.DropColumn(
                name: "PhotoMediaAssetId",
                schema: "nutrition",
                table: "RecipeVersions");
        }
    }
}
