using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Phase6B4ACanonicalStorageKeyCaseAndTrailingDot : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_MediaIngestObjects_StorageLocator",
                schema: "media",
                table: "IngestObjects");

            migrationBuilder.DropCheckConstraint(
                name: "CK_MediaAssets_StorageLocator",
                schema: "media",
                table: "Assets");

            migrationBuilder.DropCheckConstraint(
                name: "CK_MediaAssetDerivatives_StorageLocator",
                schema: "media",
                table: "AssetDerivatives");

            migrationBuilder.AddCheckConstraint(
                name: "CK_MediaIngestObjects_StorageLocator",
                schema: "media",
                table: "IngestObjects",
                sql: "\"StorageLocation\" ~ '^[a-z0-9][a-z0-9._-]{0,79}$' AND (\"StorageKey\" IS NULL OR (\"StorageKey\" ~ ('^' || replace(lower(\"TenantId\"::text), '-', '') || '(/[a-z0-9._-]+)+$') AND \"StorageKey\" !~ '(^|/)[.]+(/|$)' AND \"StorageKey\" !~ '[.](/|$)'))");

            migrationBuilder.AddCheckConstraint(
                name: "CK_MediaAssets_StorageLocator",
                schema: "media",
                table: "Assets",
                sql: "\"StorageLocation\" IS NULL OR (\"StorageLocation\" ~ '^[a-z0-9][a-z0-9._-]{0,79}$' AND (\"StorageKey\" IS NULL OR (\"StorageKey\" ~ ('^' || replace(lower(\"TenantId\"::text), '-', '') || '(/[a-z0-9._-]+)+$') AND \"StorageKey\" !~ '(^|/)[.]+(/|$)' AND \"StorageKey\" !~ '[.](/|$)')))");

            migrationBuilder.AddCheckConstraint(
                name: "CK_MediaAssetDerivatives_StorageLocator",
                schema: "media",
                table: "AssetDerivatives",
                sql: "\"StorageLocation\" ~ '^[a-z0-9][a-z0-9._-]{0,79}$' AND (\"StorageKey\" IS NULL OR (\"StorageKey\" ~ ('^' || replace(lower(\"TenantId\"::text), '-', '') || '(/[a-z0-9._-]+)+$') AND \"StorageKey\" !~ '(^|/)[.]+(/|$)' AND \"StorageKey\" !~ '[.](/|$)'))");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_MediaIngestObjects_StorageLocator",
                schema: "media",
                table: "IngestObjects");

            migrationBuilder.DropCheckConstraint(
                name: "CK_MediaAssets_StorageLocator",
                schema: "media",
                table: "Assets");

            migrationBuilder.DropCheckConstraint(
                name: "CK_MediaAssetDerivatives_StorageLocator",
                schema: "media",
                table: "AssetDerivatives");

            migrationBuilder.AddCheckConstraint(
                name: "CK_MediaIngestObjects_StorageLocator",
                schema: "media",
                table: "IngestObjects",
                sql: "\"StorageLocation\" ~ '^[a-z0-9][a-z0-9._-]{0,79}$' AND (\"StorageKey\" IS NULL OR (\"StorageKey\" ~ ('^' || replace(lower(\"TenantId\"::text), '-', '') || '(/[A-Za-z0-9._-]+)+$') AND \"StorageKey\" !~ '(^|/)[.]+(/|$)'))");

            migrationBuilder.AddCheckConstraint(
                name: "CK_MediaAssets_StorageLocator",
                schema: "media",
                table: "Assets",
                sql: "\"StorageLocation\" IS NULL OR (\"StorageLocation\" ~ '^[a-z0-9][a-z0-9._-]{0,79}$' AND (\"StorageKey\" IS NULL OR (\"StorageKey\" ~ ('^' || replace(lower(\"TenantId\"::text), '-', '') || '(/[A-Za-z0-9._-]+)+$') AND \"StorageKey\" !~ '(^|/)[.]+(/|$)')))");

            migrationBuilder.AddCheckConstraint(
                name: "CK_MediaAssetDerivatives_StorageLocator",
                schema: "media",
                table: "AssetDerivatives",
                sql: "\"StorageLocation\" ~ '^[a-z0-9][a-z0-9._-]{0,79}$' AND (\"StorageKey\" IS NULL OR (\"StorageKey\" ~ ('^' || replace(lower(\"TenantId\"::text), '-', '') || '(/[A-Za-z0-9._-]+)+$') AND \"StorageKey\" !~ '(^|/)[.]+(/|$)'))");
        }
    }
}
