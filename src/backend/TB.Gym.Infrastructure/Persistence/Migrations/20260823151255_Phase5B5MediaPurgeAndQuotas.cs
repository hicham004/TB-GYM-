using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Phase5B5MediaPurgeAndQuotas : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_MediaAssets_Source",
                schema: "media",
                table: "Assets");

            migrationBuilder.DropIndex(
                name: "IX_AssetDerivatives_TenantId_StorageKey",
                schema: "media",
                table: "AssetDerivatives");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "LastPurgeAttemptAtUtc",
                schema: "media",
                table: "Assets",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "PurgeAttemptCount",
                schema: "media",
                table: "Assets",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "PurgeFailureCode",
                schema: "media",
                table: "Assets",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "PurgedAtUtc",
                schema: "media",
                table: "Assets",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "StorageKey",
                schema: "media",
                table: "AssetDerivatives",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(500)",
                oldMaxLength: 500);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "PurgedAtUtc",
                schema: "media",
                table: "AssetDerivatives",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Assets_Status_PurgeAfterUtc",
                schema: "media",
                table: "Assets",
                columns: new[] { "Status", "PurgeAfterUtc" },
                filter: "\"PurgeAfterUtc\" IS NOT NULL");

            migrationBuilder.AddCheckConstraint(
                name: "CK_MediaAssets_Purged",
                schema: "media",
                table: "Assets",
                sql: "(\"Status\" = 'Purged') = (\"PurgedAtUtc\" IS NOT NULL)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_MediaAssets_Source",
                schema: "media",
                table: "Assets",
                sql: "(\"Source\" = 'Upload' AND (\"StorageKey\" IS NOT NULL OR \"Status\" = 'Purged') AND \"ExternalMediaId\" IS NULL) OR (\"Source\" = 'ExternalEmbed' AND \"StorageKey\" IS NULL AND \"ExternalMediaId\" IS NOT NULL)");

            migrationBuilder.CreateIndex(
                name: "IX_AssetDerivatives_TenantId_StorageKey",
                schema: "media",
                table: "AssetDerivatives",
                columns: new[] { "TenantId", "StorageKey" },
                unique: true,
                filter: "\"StorageKey\" IS NOT NULL");

            migrationBuilder.AddCheckConstraint(
                name: "CK_MediaAssetDerivatives_Purged",
                schema: "media",
                table: "AssetDerivatives",
                sql: "(\"PurgedAtUtc\" IS NULL) = (\"StorageKey\" IS NOT NULL)");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Assets_Status_PurgeAfterUtc",
                schema: "media",
                table: "Assets");

            migrationBuilder.DropCheckConstraint(
                name: "CK_MediaAssets_Purged",
                schema: "media",
                table: "Assets");

            migrationBuilder.DropCheckConstraint(
                name: "CK_MediaAssets_Source",
                schema: "media",
                table: "Assets");

            migrationBuilder.DropIndex(
                name: "IX_AssetDerivatives_TenantId_StorageKey",
                schema: "media",
                table: "AssetDerivatives");

            migrationBuilder.DropCheckConstraint(
                name: "CK_MediaAssetDerivatives_Purged",
                schema: "media",
                table: "AssetDerivatives");

            migrationBuilder.DropColumn(
                name: "LastPurgeAttemptAtUtc",
                schema: "media",
                table: "Assets");

            migrationBuilder.DropColumn(
                name: "PurgeAttemptCount",
                schema: "media",
                table: "Assets");

            migrationBuilder.DropColumn(
                name: "PurgeFailureCode",
                schema: "media",
                table: "Assets");

            migrationBuilder.DropColumn(
                name: "PurgedAtUtc",
                schema: "media",
                table: "Assets");

            migrationBuilder.DropColumn(
                name: "PurgedAtUtc",
                schema: "media",
                table: "AssetDerivatives");

            migrationBuilder.AlterColumn<string>(
                name: "StorageKey",
                schema: "media",
                table: "AssetDerivatives",
                type: "character varying(500)",
                maxLength: 500,
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "character varying(500)",
                oldMaxLength: 500,
                oldNullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_MediaAssets_Source",
                schema: "media",
                table: "Assets",
                sql: "(\"Source\" = 'Upload' AND \"StorageKey\" IS NOT NULL AND \"ExternalMediaId\" IS NULL) OR (\"Source\" = 'ExternalEmbed' AND \"StorageKey\" IS NULL AND \"ExternalMediaId\" IS NOT NULL)");

            migrationBuilder.CreateIndex(
                name: "IX_AssetDerivatives_TenantId_StorageKey",
                schema: "media",
                table: "AssetDerivatives",
                columns: new[] { "TenantId", "StorageKey" },
                unique: true);
        }
    }
}
