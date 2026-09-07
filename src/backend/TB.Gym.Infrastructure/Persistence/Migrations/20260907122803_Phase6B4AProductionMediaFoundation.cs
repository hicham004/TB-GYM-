using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Phase6B4AProductionMediaFoundation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_IngestObjects_Status_PurgeAfterUtc",
                schema: "media",
                table: "IngestObjects");

            migrationBuilder.DropIndex(
                name: "IX_IngestObjects_TenantId_StorageKey",
                schema: "media",
                table: "IngestObjects");

            migrationBuilder.DropIndex(
                name: "IX_Assets_Status_PurgeAfterUtc",
                schema: "media",
                table: "Assets");

            migrationBuilder.DropIndex(
                name: "IX_Assets_TenantId_StorageKey",
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

            migrationBuilder.RenameColumn(
                name: "FailureCode",
                schema: "media",
                table: "Assets",
                newName: "ScanFailureCode");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "PurgeClaimExpiresAtUtc",
                schema: "media",
                table: "IngestObjects",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "PurgeClaimToken",
                schema: "media",
                table: "IngestObjects",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ScanEvidenceState",
                schema: "media",
                table: "IngestObjects",
                type: "character varying(24)",
                maxLength: 24,
                nullable: false,
                defaultValue: "None");

            migrationBuilder.AddColumn<string>(
                name: "ScanFailureCode",
                schema: "media",
                table: "IngestObjects",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ScanOutcome",
                schema: "media",
                table: "IngestObjects",
                type: "character varying(24)",
                maxLength: 24,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ScanSha256",
                schema: "media",
                table: "IngestObjects",
                type: "character(64)",
                fixedLength: true,
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ScanStorageKey",
                schema: "media",
                table: "IngestObjects",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ScanStorageLocation",
                schema: "media",
                table: "IngestObjects",
                type: "character varying(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "ScannedAtUtc",
                schema: "media",
                table: "IngestObjects",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ScannerKey",
                schema: "media",
                table: "IngestObjects",
                type: "character varying(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ScannerVersion",
                schema: "media",
                table: "IngestObjects",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "StorageLocation",
                schema: "media",
                table: "IngestObjects",
                type: "character varying(80)",
                maxLength: 80,
                nullable: false,
                defaultValue: "local-v1");

            migrationBuilder.AddColumn<string>(
                name: "StoredSha256",
                schema: "media",
                table: "IngestObjects",
                type: "character(64)",
                fixedLength: true,
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "PurgeClaimExpiresAtUtc",
                schema: "media",
                table: "Assets",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "PurgeClaimToken",
                schema: "media",
                table: "Assets",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ScanEvidenceState",
                schema: "media",
                table: "Assets",
                type: "character varying(24)",
                maxLength: 24,
                nullable: false,
                defaultValue: "None");

            migrationBuilder.AddColumn<string>(
                name: "ScanOutcome",
                schema: "media",
                table: "Assets",
                type: "character varying(24)",
                maxLength: 24,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ScanSha256",
                schema: "media",
                table: "Assets",
                type: "character(64)",
                fixedLength: true,
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ScanStorageKey",
                schema: "media",
                table: "Assets",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ScanStorageLocation",
                schema: "media",
                table: "Assets",
                type: "character varying(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "ScannedAtUtc",
                schema: "media",
                table: "Assets",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "StorageLocation",
                schema: "media",
                table: "Assets",
                type: "character varying(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ScanEvidenceState",
                schema: "media",
                table: "AssetDerivatives",
                type: "character varying(24)",
                maxLength: 24,
                nullable: false,
                defaultValue: "LegacyUnavailable");

            migrationBuilder.AddColumn<string>(
                name: "ScanFailureCode",
                schema: "media",
                table: "AssetDerivatives",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ScanOutcome",
                schema: "media",
                table: "AssetDerivatives",
                type: "character varying(24)",
                maxLength: 24,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ScanSha256",
                schema: "media",
                table: "AssetDerivatives",
                type: "character(64)",
                fixedLength: true,
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ScanStorageKey",
                schema: "media",
                table: "AssetDerivatives",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ScanStorageLocation",
                schema: "media",
                table: "AssetDerivatives",
                type: "character varying(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "ScannedAtUtc",
                schema: "media",
                table: "AssetDerivatives",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ScannerKey",
                schema: "media",
                table: "AssetDerivatives",
                type: "character varying(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ScannerVersion",
                schema: "media",
                table: "AssetDerivatives",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "StorageLocation",
                schema: "media",
                table: "AssetDerivatives",
                type: "character varying(80)",
                maxLength: 80,
                nullable: false,
                defaultValue: "local-v1");

            migrationBuilder.Sql(
                """
                UPDATE media."Assets"
                SET "StorageLocation" = CASE WHEN "Source" = 'Upload' THEN 'local-v1' ELSE NULL END,
                    "ScanEvidenceState" = CASE WHEN "Source" = 'Upload' THEN 'LegacyUnavailable' ELSE 'None' END;

                UPDATE media."AssetDerivatives"
                SET "StorageLocation" = 'local-v1',
                    "ScanEvidenceState" = 'LegacyUnavailable';

                UPDATE media."IngestObjects"
                SET "StorageLocation" = 'local-v1',
                    "ScanEvidenceState" = CASE
                        WHEN "StoredAtUtc" IS NULL THEN 'None'
                        ELSE 'LegacyUnavailable'
                    END;

                ALTER TABLE media."AssetDerivatives" ALTER COLUMN "StorageLocation" DROP DEFAULT;
                ALTER TABLE media."AssetDerivatives" ALTER COLUMN "ScanEvidenceState" DROP DEFAULT;
                ALTER TABLE media."IngestObjects" ALTER COLUMN "StorageLocation" DROP DEFAULT;
                """);

            migrationBuilder.CreateIndex(
                name: "IX_IngestObjects_Status_PurgeAfterUtc_PurgeClaimExpiresAtUtc",
                schema: "media",
                table: "IngestObjects",
                columns: new[] { "Status", "PurgeAfterUtc", "PurgeClaimExpiresAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_IngestObjects_TenantId_StorageLocation_StorageKey",
                schema: "media",
                table: "IngestObjects",
                columns: new[] { "TenantId", "StorageLocation", "StorageKey" },
                unique: true,
                filter: "\"StorageKey\" IS NOT NULL");

            migrationBuilder.AddCheckConstraint(
                name: "CK_MediaIngestObjects_PurgeClaim",
                schema: "media",
                table: "IngestObjects",
                sql: "(\"PurgeClaimToken\" IS NULL) = (\"PurgeClaimExpiresAtUtc\" IS NULL) AND (\"Status\" <> 'Purged' OR \"PurgeClaimToken\" IS NULL)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_MediaIngestObjects_ScanEvidence",
                schema: "media",
                table: "IngestObjects",
                sql: "((\"StoredSha256\" IS NULL AND \"StoredAtUtc\" IS NULL) OR (\"StoredSha256\" ~ '^[0-9a-f]{64}$' AND \"StoredAtUtc\" IS NOT NULL) OR \"ScanEvidenceState\" = 'LegacyUnavailable') AND ((\"ScanEvidenceState\" = 'None' AND \"ScanStorageLocation\" IS NULL AND \"ScanStorageKey\" IS NULL AND \"ScanSha256\" IS NULL AND \"ScannedAtUtc\" IS NULL AND \"ScanOutcome\" IS NULL AND \"ScannerKey\" IS NULL AND \"ScannerVersion\" IS NULL AND \"ScanFailureCode\" IS NULL) OR (\"ScanEvidenceState\" = 'LegacyUnavailable' AND \"ScanStorageLocation\" IS NULL AND \"ScanStorageKey\" IS NULL AND \"ScanSha256\" IS NULL AND \"ScannedAtUtc\" IS NULL AND \"ScanOutcome\" IS NULL) OR (\"ScanEvidenceState\" = 'Complete' AND \"ScanStorageLocation\" = \"StorageLocation\" AND \"ScanStorageKey\" IS NOT NULL AND (\"StorageKey\" IS NULL OR \"ScanStorageKey\" = \"StorageKey\") AND \"ScanSha256\" = \"StoredSha256\" AND \"ScannedAtUtc\" IS NOT NULL AND \"ScannerKey\" IS NOT NULL AND \"ScannerVersion\" IS NOT NULL AND \"ScanOutcome\" IS NOT NULL))");

            migrationBuilder.AddCheckConstraint(
                name: "CK_MediaIngestObjects_StorageLocator",
                schema: "media",
                table: "IngestObjects",
                sql: "\"StorageLocation\" ~ '^[a-z0-9][a-z0-9._-]{0,79}$' AND (\"StorageKey\" IS NULL OR \"StorageKey\" LIKE replace(lower(\"TenantId\"::text), '-', '') || '/%')");

            migrationBuilder.CreateIndex(
                name: "IX_Assets_Status_PurgeAfterUtc_PurgeClaimExpiresAtUtc",
                schema: "media",
                table: "Assets",
                columns: new[] { "Status", "PurgeAfterUtc", "PurgeClaimExpiresAtUtc" },
                filter: "\"PurgeAfterUtc\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Assets_TenantId_StorageLocation_StorageKey",
                schema: "media",
                table: "Assets",
                columns: new[] { "TenantId", "StorageLocation", "StorageKey" },
                unique: true,
                filter: "\"StorageKey\" IS NOT NULL");

            migrationBuilder.AddCheckConstraint(
                name: "CK_MediaAssets_PurgeClaim",
                schema: "media",
                table: "Assets",
                sql: "(\"PurgeClaimToken\" IS NULL) = (\"PurgeClaimExpiresAtUtc\" IS NULL) AND (\"Status\" <> 'Purged' OR \"PurgeClaimToken\" IS NULL)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_MediaAssets_ScanEvidence",
                schema: "media",
                table: "Assets",
                sql: "((\"ScanEvidenceState\" = 'None' AND \"ScanStorageLocation\" IS NULL AND \"ScanStorageKey\" IS NULL AND \"ScanSha256\" IS NULL AND \"ScannedAtUtc\" IS NULL AND \"ScanOutcome\" IS NULL AND \"ScannerKey\" IS NULL AND \"ScannerVersion\" IS NULL AND \"ScanFailureCode\" IS NULL) OR (\"ScanEvidenceState\" = 'LegacyUnavailable' AND \"ScanStorageLocation\" IS NULL AND \"ScanStorageKey\" IS NULL AND \"ScanSha256\" IS NULL AND \"ScannedAtUtc\" IS NULL AND \"ScanOutcome\" IS NULL) OR (\"ScanEvidenceState\" = 'Complete' AND \"ScanStorageLocation\" = \"StorageLocation\" AND \"ScanStorageKey\" IS NOT NULL AND (\"StorageKey\" IS NULL OR \"ScanStorageKey\" = \"StorageKey\") AND \"ScanSha256\" = \"Sha256\" AND \"ScanSha256\" ~ '^[0-9a-f]{64}$' AND \"ScannedAtUtc\" IS NOT NULL AND \"ScannerKey\" IS NOT NULL AND \"ScannerVersion\" IS NOT NULL AND \"ScanOutcome\" IS NOT NULL)) AND (\"Source\" <> 'Upload' OR \"Status\" = 'PendingScan' OR \"ScanEvidenceState\" IN ('Complete', 'LegacyUnavailable')) AND (\"ScanEvidenceState\" <> 'Complete' OR (\"Status\" = 'Rejected' AND \"ScanOutcome\" = 'Refused') OR (\"Status\" IN ('Ready', 'Tombstoned', 'Purged') AND \"ScanOutcome\" = 'Allowed'))");

            migrationBuilder.AddCheckConstraint(
                name: "CK_MediaAssets_Source",
                schema: "media",
                table: "Assets",
                sql: "(\"Source\" = 'Upload' AND \"StorageLocation\" IS NOT NULL AND (\"StorageKey\" IS NOT NULL OR \"Status\" = 'Purged') AND \"ExternalMediaId\" IS NULL) OR (\"Source\" = 'ExternalEmbed' AND \"StorageLocation\" IS NULL AND \"StorageKey\" IS NULL AND \"ExternalMediaId\" IS NOT NULL)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_MediaAssets_StorageLocator",
                schema: "media",
                table: "Assets",
                sql: "\"StorageLocation\" IS NULL OR (\"StorageLocation\" ~ '^[a-z0-9][a-z0-9._-]{0,79}$' AND (\"StorageKey\" IS NULL OR \"StorageKey\" LIKE replace(lower(\"TenantId\"::text), '-', '') || '/%'))");

            migrationBuilder.CreateIndex(
                name: "IX_AssetDerivatives_TenantId_StorageLocation_StorageKey",
                schema: "media",
                table: "AssetDerivatives",
                columns: new[] { "TenantId", "StorageLocation", "StorageKey" },
                unique: true,
                filter: "\"StorageKey\" IS NOT NULL");

            migrationBuilder.AddCheckConstraint(
                name: "CK_MediaAssetDerivatives_ScanEvidence",
                schema: "media",
                table: "AssetDerivatives",
                sql: "(\"ScanEvidenceState\" = 'LegacyUnavailable' AND \"ScanStorageLocation\" IS NULL AND \"ScanStorageKey\" IS NULL AND \"ScanSha256\" IS NULL AND \"ScannedAtUtc\" IS NULL AND \"ScanOutcome\" IS NULL) OR (\"ScanEvidenceState\" = 'Complete' AND \"ScanStorageLocation\" = \"StorageLocation\" AND \"ScanStorageKey\" IS NOT NULL AND (\"StorageKey\" IS NULL OR \"ScanStorageKey\" = \"StorageKey\") AND \"ScanSha256\" = \"Sha256\" AND \"ScanSha256\" ~ '^[0-9a-f]{64}$' AND \"ScannedAtUtc\" IS NOT NULL AND \"ScannerKey\" IS NOT NULL AND \"ScannerVersion\" IS NOT NULL AND \"ScanOutcome\" = 'Allowed')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_MediaAssetDerivatives_StorageLocator",
                schema: "media",
                table: "AssetDerivatives",
                sql: "\"StorageLocation\" ~ '^[a-z0-9][a-z0-9._-]{0,79}$' AND (\"StorageKey\" IS NULL OR \"StorageKey\" LIKE replace(lower(\"TenantId\"::text), '-', '') || '/%')");

            migrationBuilder.Sql(
                """
                CREATE FUNCTION media.reject_new_legacy_scan_evidence()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $function$
                BEGIN
                    IF NEW."ScanEvidenceState" = 'LegacyUnavailable'
                       AND (TG_OP = 'INSERT' OR OLD."ScanEvidenceState" IS DISTINCT FROM NEW."ScanEvidenceState") THEN
                        RAISE EXCEPTION USING
                            ERRCODE = '23514',
                            CONSTRAINT = 'CK_MediaScanEvidence_LegacyWrite',
                            MESSAGE = 'Legacy scan-evidence state is reserved for migration backfill.';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER "TR_MediaAssets_RejectNewLegacyScanEvidence"
                BEFORE INSERT OR UPDATE ON media."Assets"
                FOR EACH ROW EXECUTE FUNCTION media.reject_new_legacy_scan_evidence();

                CREATE TRIGGER "TR_MediaAssetDerivatives_RejectNewLegacyScanEvidence"
                BEFORE INSERT OR UPDATE ON media."AssetDerivatives"
                FOR EACH ROW EXECUTE FUNCTION media.reject_new_legacy_scan_evidence();

                CREATE TRIGGER "TR_MediaIngestObjects_RejectNewLegacyScanEvidence"
                BEFORE INSERT OR UPDATE ON media."IngestObjects"
                FOR EACH ROW EXECUTE FUNCTION media.reject_new_legacy_scan_evidence();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                DROP TRIGGER IF EXISTS "TR_MediaAssets_RejectNewLegacyScanEvidence" ON media."Assets";
                DROP TRIGGER IF EXISTS "TR_MediaAssetDerivatives_RejectNewLegacyScanEvidence" ON media."AssetDerivatives";
                DROP TRIGGER IF EXISTS "TR_MediaIngestObjects_RejectNewLegacyScanEvidence" ON media."IngestObjects";
                DROP FUNCTION IF EXISTS media.reject_new_legacy_scan_evidence();
                """);

            migrationBuilder.DropIndex(
                name: "IX_IngestObjects_Status_PurgeAfterUtc_PurgeClaimExpiresAtUtc",
                schema: "media",
                table: "IngestObjects");

            migrationBuilder.DropIndex(
                name: "IX_IngestObjects_TenantId_StorageLocation_StorageKey",
                schema: "media",
                table: "IngestObjects");

            migrationBuilder.DropCheckConstraint(
                name: "CK_MediaIngestObjects_PurgeClaim",
                schema: "media",
                table: "IngestObjects");

            migrationBuilder.DropCheckConstraint(
                name: "CK_MediaIngestObjects_ScanEvidence",
                schema: "media",
                table: "IngestObjects");

            migrationBuilder.DropCheckConstraint(
                name: "CK_MediaIngestObjects_StorageLocator",
                schema: "media",
                table: "IngestObjects");

            migrationBuilder.DropIndex(
                name: "IX_Assets_Status_PurgeAfterUtc_PurgeClaimExpiresAtUtc",
                schema: "media",
                table: "Assets");

            migrationBuilder.DropIndex(
                name: "IX_Assets_TenantId_StorageLocation_StorageKey",
                schema: "media",
                table: "Assets");

            migrationBuilder.DropCheckConstraint(
                name: "CK_MediaAssets_PurgeClaim",
                schema: "media",
                table: "Assets");

            migrationBuilder.DropCheckConstraint(
                name: "CK_MediaAssets_ScanEvidence",
                schema: "media",
                table: "Assets");

            migrationBuilder.DropCheckConstraint(
                name: "CK_MediaAssets_Source",
                schema: "media",
                table: "Assets");

            migrationBuilder.DropCheckConstraint(
                name: "CK_MediaAssets_StorageLocator",
                schema: "media",
                table: "Assets");

            migrationBuilder.DropIndex(
                name: "IX_AssetDerivatives_TenantId_StorageLocation_StorageKey",
                schema: "media",
                table: "AssetDerivatives");

            migrationBuilder.DropCheckConstraint(
                name: "CK_MediaAssetDerivatives_ScanEvidence",
                schema: "media",
                table: "AssetDerivatives");

            migrationBuilder.DropCheckConstraint(
                name: "CK_MediaAssetDerivatives_StorageLocator",
                schema: "media",
                table: "AssetDerivatives");

            migrationBuilder.DropColumn(
                name: "PurgeClaimExpiresAtUtc",
                schema: "media",
                table: "IngestObjects");

            migrationBuilder.DropColumn(
                name: "PurgeClaimToken",
                schema: "media",
                table: "IngestObjects");

            migrationBuilder.DropColumn(
                name: "ScanEvidenceState",
                schema: "media",
                table: "IngestObjects");

            migrationBuilder.DropColumn(
                name: "ScanFailureCode",
                schema: "media",
                table: "IngestObjects");

            migrationBuilder.DropColumn(
                name: "ScanOutcome",
                schema: "media",
                table: "IngestObjects");

            migrationBuilder.DropColumn(
                name: "ScanSha256",
                schema: "media",
                table: "IngestObjects");

            migrationBuilder.DropColumn(
                name: "ScanStorageKey",
                schema: "media",
                table: "IngestObjects");

            migrationBuilder.DropColumn(
                name: "ScanStorageLocation",
                schema: "media",
                table: "IngestObjects");

            migrationBuilder.DropColumn(
                name: "ScannedAtUtc",
                schema: "media",
                table: "IngestObjects");

            migrationBuilder.DropColumn(
                name: "ScannerKey",
                schema: "media",
                table: "IngestObjects");

            migrationBuilder.DropColumn(
                name: "ScannerVersion",
                schema: "media",
                table: "IngestObjects");

            migrationBuilder.DropColumn(
                name: "StorageLocation",
                schema: "media",
                table: "IngestObjects");

            migrationBuilder.DropColumn(
                name: "StoredSha256",
                schema: "media",
                table: "IngestObjects");

            migrationBuilder.DropColumn(
                name: "PurgeClaimExpiresAtUtc",
                schema: "media",
                table: "Assets");

            migrationBuilder.DropColumn(
                name: "PurgeClaimToken",
                schema: "media",
                table: "Assets");

            migrationBuilder.DropColumn(
                name: "ScanEvidenceState",
                schema: "media",
                table: "Assets");

            migrationBuilder.DropColumn(
                name: "ScanOutcome",
                schema: "media",
                table: "Assets");

            migrationBuilder.DropColumn(
                name: "ScanSha256",
                schema: "media",
                table: "Assets");

            migrationBuilder.DropColumn(
                name: "ScanStorageKey",
                schema: "media",
                table: "Assets");

            migrationBuilder.DropColumn(
                name: "ScanStorageLocation",
                schema: "media",
                table: "Assets");

            migrationBuilder.DropColumn(
                name: "ScannedAtUtc",
                schema: "media",
                table: "Assets");

            migrationBuilder.DropColumn(
                name: "StorageLocation",
                schema: "media",
                table: "Assets");

            migrationBuilder.DropColumn(
                name: "ScanEvidenceState",
                schema: "media",
                table: "AssetDerivatives");

            migrationBuilder.DropColumn(
                name: "ScanFailureCode",
                schema: "media",
                table: "AssetDerivatives");

            migrationBuilder.DropColumn(
                name: "ScanOutcome",
                schema: "media",
                table: "AssetDerivatives");

            migrationBuilder.DropColumn(
                name: "ScanSha256",
                schema: "media",
                table: "AssetDerivatives");

            migrationBuilder.DropColumn(
                name: "ScanStorageKey",
                schema: "media",
                table: "AssetDerivatives");

            migrationBuilder.DropColumn(
                name: "ScanStorageLocation",
                schema: "media",
                table: "AssetDerivatives");

            migrationBuilder.DropColumn(
                name: "ScannedAtUtc",
                schema: "media",
                table: "AssetDerivatives");

            migrationBuilder.DropColumn(
                name: "ScannerKey",
                schema: "media",
                table: "AssetDerivatives");

            migrationBuilder.DropColumn(
                name: "ScannerVersion",
                schema: "media",
                table: "AssetDerivatives");

            migrationBuilder.DropColumn(
                name: "StorageLocation",
                schema: "media",
                table: "AssetDerivatives");

            migrationBuilder.RenameColumn(
                name: "ScanFailureCode",
                schema: "media",
                table: "Assets",
                newName: "FailureCode");

            migrationBuilder.CreateIndex(
                name: "IX_IngestObjects_Status_PurgeAfterUtc",
                schema: "media",
                table: "IngestObjects",
                columns: new[] { "Status", "PurgeAfterUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_IngestObjects_TenantId_StorageKey",
                schema: "media",
                table: "IngestObjects",
                columns: new[] { "TenantId", "StorageKey" },
                unique: true,
                filter: "\"StorageKey\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Assets_Status_PurgeAfterUtc",
                schema: "media",
                table: "Assets",
                columns: new[] { "Status", "PurgeAfterUtc" },
                filter: "\"PurgeAfterUtc\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Assets_TenantId_StorageKey",
                schema: "media",
                table: "Assets",
                columns: new[] { "TenantId", "StorageKey" },
                unique: true,
                filter: "\"StorageKey\" IS NOT NULL");

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
        }
    }
}
