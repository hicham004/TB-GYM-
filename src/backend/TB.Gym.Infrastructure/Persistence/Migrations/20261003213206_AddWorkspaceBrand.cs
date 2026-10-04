using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddWorkspaceBrand : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AccentColor",
                schema: "tenancy",
                table: "Tenants",
                type: "character varying(7)",
                maxLength: 7,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BrandColor",
                schema: "tenancy",
                table: "Tenants",
                type: "character varying(7)",
                maxLength: 7,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "LogoMediaAssetId",
                schema: "tenancy",
                table: "Tenants",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Tenants_Id_LogoMediaAssetId",
                schema: "tenancy",
                table: "Tenants",
                columns: new[] { "Id", "LogoMediaAssetId" });

            migrationBuilder.AddCheckConstraint(
                name: "CK_Tenants_Brand",
                schema: "tenancy",
                table: "Tenants",
                sql: "(\"BrandColor\" IS NULL) = (\"AccentColor\" IS NULL) AND (\"BrandColor\" IS NULL OR \"BrandColor\" ~ '^#[0-9a-f]{6}$') AND (\"AccentColor\" IS NULL OR \"AccentColor\" ~ '^#[0-9a-f]{6}$')");

            migrationBuilder.AddForeignKey(
                name: "FK_Tenants_Assets_Id_LogoMediaAssetId",
                schema: "tenancy",
                table: "Tenants",
                columns: new[] { "Id", "LogoMediaAssetId" },
                principalSchema: "media",
                principalTable: "Assets",
                principalColumns: new[] { "TenantId", "Id" },
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Tenants_Assets_Id_LogoMediaAssetId",
                schema: "tenancy",
                table: "Tenants");

            migrationBuilder.DropIndex(
                name: "IX_Tenants_Id_LogoMediaAssetId",
                schema: "tenancy",
                table: "Tenants");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Tenants_Brand",
                schema: "tenancy",
                table: "Tenants");

            migrationBuilder.DropColumn(
                name: "AccentColor",
                schema: "tenancy",
                table: "Tenants");

            migrationBuilder.DropColumn(
                name: "BrandColor",
                schema: "tenancy",
                table: "Tenants");

            migrationBuilder.DropColumn(
                name: "LogoMediaAssetId",
                schema: "tenancy",
                table: "Tenants");
        }
    }
}
