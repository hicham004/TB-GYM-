using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Phase6B4ARemediationStorageKeyGrammarAndRefusedLifecycle : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_MediaIngestObjects_StorageLocator",
                schema: "media",
                table: "IngestObjects");

            migrationBuilder.DropCheckConstraint(
                name: "CK_MediaAssets_ScanEvidence",
                schema: "media",
                table: "Assets");

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
                name: "CK_MediaAssets_ScanEvidence",
                schema: "media",
                table: "Assets",
                sql: "((\"ScanEvidenceState\" = 'None' AND \"ScanStorageLocation\" IS NULL AND \"ScanStorageKey\" IS NULL AND \"ScanSha256\" IS NULL AND \"ScannedAtUtc\" IS NULL AND \"ScanOutcome\" IS NULL AND \"ScannerKey\" IS NULL AND \"ScannerVersion\" IS NULL AND \"ScanFailureCode\" IS NULL) OR (\"ScanEvidenceState\" = 'LegacyUnavailable' AND \"ScanStorageLocation\" IS NULL AND \"ScanStorageKey\" IS NULL AND \"ScanSha256\" IS NULL AND \"ScannedAtUtc\" IS NULL AND \"ScanOutcome\" IS NULL) OR (\"ScanEvidenceState\" = 'Complete' AND \"ScanStorageLocation\" = \"StorageLocation\" AND \"ScanStorageKey\" IS NOT NULL AND (\"StorageKey\" IS NULL OR \"ScanStorageKey\" = \"StorageKey\") AND \"ScanSha256\" = \"Sha256\" AND \"ScanSha256\" ~ '^[0-9a-f]{64}$' AND \"ScannedAtUtc\" IS NOT NULL AND \"ScannerKey\" IS NOT NULL AND \"ScannerVersion\" IS NOT NULL AND \"ScanOutcome\" IS NOT NULL)) AND (\"Source\" <> 'Upload' OR \"Status\" = 'PendingScan' OR \"ScanEvidenceState\" IN ('Complete', 'LegacyUnavailable')) AND (\"ScanEvidenceState\" <> 'Complete' OR (\"ScanOutcome\" = 'Refused' AND \"Status\" IN ('Rejected', 'Tombstoned', 'Purged')) OR (\"ScanOutcome\" = 'Allowed' AND \"Status\" IN ('Ready', 'Tombstoned', 'Purged')))");

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

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_MediaIngestObjects_StorageLocator",
                schema: "media",
                table: "IngestObjects");

            migrationBuilder.DropCheckConstraint(
                name: "CK_MediaAssets_ScanEvidence",
                schema: "media",
                table: "Assets");

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
                sql: "\"StorageLocation\" ~ '^[a-z0-9][a-z0-9._-]{0,79}$' AND (\"StorageKey\" IS NULL OR \"StorageKey\" LIKE replace(lower(\"TenantId\"::text), '-', '') || '/%')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_MediaAssets_ScanEvidence",
                schema: "media",
                table: "Assets",
                sql: "((\"ScanEvidenceState\" = 'None' AND \"ScanStorageLocation\" IS NULL AND \"ScanStorageKey\" IS NULL AND \"ScanSha256\" IS NULL AND \"ScannedAtUtc\" IS NULL AND \"ScanOutcome\" IS NULL AND \"ScannerKey\" IS NULL AND \"ScannerVersion\" IS NULL AND \"ScanFailureCode\" IS NULL) OR (\"ScanEvidenceState\" = 'LegacyUnavailable' AND \"ScanStorageLocation\" IS NULL AND \"ScanStorageKey\" IS NULL AND \"ScanSha256\" IS NULL AND \"ScannedAtUtc\" IS NULL AND \"ScanOutcome\" IS NULL) OR (\"ScanEvidenceState\" = 'Complete' AND \"ScanStorageLocation\" = \"StorageLocation\" AND \"ScanStorageKey\" IS NOT NULL AND (\"StorageKey\" IS NULL OR \"ScanStorageKey\" = \"StorageKey\") AND \"ScanSha256\" = \"Sha256\" AND \"ScanSha256\" ~ '^[0-9a-f]{64}$' AND \"ScannedAtUtc\" IS NOT NULL AND \"ScannerKey\" IS NOT NULL AND \"ScannerVersion\" IS NOT NULL AND \"ScanOutcome\" IS NOT NULL)) AND (\"Source\" <> 'Upload' OR \"Status\" = 'PendingScan' OR \"ScanEvidenceState\" IN ('Complete', 'LegacyUnavailable')) AND (\"ScanEvidenceState\" <> 'Complete' OR (\"Status\" = 'Rejected' AND \"ScanOutcome\" = 'Refused') OR (\"Status\" IN ('Ready', 'Tombstoned', 'Purged') AND \"ScanOutcome\" = 'Allowed'))");

            migrationBuilder.AddCheckConstraint(
                name: "CK_MediaAssets_StorageLocator",
                schema: "media",
                table: "Assets",
                sql: "\"StorageLocation\" IS NULL OR (\"StorageLocation\" ~ '^[a-z0-9][a-z0-9._-]{0,79}$' AND (\"StorageKey\" IS NULL OR \"StorageKey\" LIKE replace(lower(\"TenantId\"::text), '-', '') || '/%'))");

            migrationBuilder.AddCheckConstraint(
                name: "CK_MediaAssetDerivatives_StorageLocator",
                schema: "media",
                table: "AssetDerivatives",
                sql: "\"StorageLocation\" ~ '^[a-z0-9][a-z0-9._-]{0,79}$' AND (\"StorageKey\" IS NULL OR \"StorageKey\" LIKE replace(lower(\"TenantId\"::text), '-', '') || '/%')");
        }
    }
}
