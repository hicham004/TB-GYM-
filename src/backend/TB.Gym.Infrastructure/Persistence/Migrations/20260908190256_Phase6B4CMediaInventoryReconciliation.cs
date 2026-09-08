using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Phase6B4CMediaInventoryReconciliation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "InventoryRuns",
                schema: "media",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Location = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    State = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    StartedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    LastProgressAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    LeaseToken = table.Column<Guid>(type: "uuid", nullable: true),
                    LeaseExpiresAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    InventoryCursor = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: true),
                    InventoryCompleted = table.Column<bool>(type: "boolean", nullable: false),
                    ProbeStage = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    ProbeCursorId = table.Column<Guid>(type: "uuid", nullable: true),
                    ObjectsScanned = table.Column<int>(type: "integer", nullable: false),
                    ObjectsSkippedRecent = table.Column<int>(type: "integer", nullable: false),
                    ObjectsSkippedOwnedByPurge = table.Column<int>(type: "integer", nullable: false),
                    UnattributableKeyCount = table.Column<int>(type: "integer", nullable: false),
                    OwnersProbed = table.Column<int>(type: "integer", nullable: false),
                    OwnersSkippedNotReconciled = table.Column<int>(type: "integer", nullable: false),
                    OwnersSkippedOwnedByPurge = table.Column<int>(type: "integer", nullable: false),
                    FindingsOpened = table.Column<int>(type: "integer", nullable: false),
                    FindingsResolved = table.Column<int>(type: "integer", nullable: false),
                    PageFailureCount = table.Column<int>(type: "integer", nullable: false),
                    LastFailureCode = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    CompletedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InventoryRuns", x => x.Id);
                    table.CheckConstraint("CK_MediaInventoryRuns_Completed", "(\"State\" = 'Completed') = (\"CompletedAtUtc\" IS NOT NULL)");
                    table.CheckConstraint("CK_MediaInventoryRuns_CompletionEvidence", "\"State\" <> 'Completed' OR (\"InventoryCompleted\" AND \"InventoryCursor\" IS NULL AND \"ProbeStage\" = 'Completed' AND \"PageFailureCount\" = 0)");
                    table.CheckConstraint("CK_MediaInventoryRuns_Counters", "\"ObjectsScanned\" >= 0 AND \"ObjectsSkippedRecent\" >= 0 AND \"ObjectsSkippedOwnedByPurge\" >= 0 AND \"UnattributableKeyCount\" >= 0 AND \"OwnersProbed\" >= 0 AND \"OwnersSkippedNotReconciled\" >= 0 AND \"OwnersSkippedOwnedByPurge\" >= 0 AND \"FindingsOpened\" >= 0 AND \"FindingsResolved\" >= 0 AND \"PageFailureCount\" >= 0");
                    table.CheckConstraint("CK_MediaInventoryRuns_Lease", "(\"LeaseToken\" IS NULL) = (\"LeaseExpiresAtUtc\" IS NULL) AND (\"State\" = 'Running' OR \"LeaseToken\" IS NULL)");
                });

            migrationBuilder.CreateTable(
                name: "InventoryFindings",
                schema: "media",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    StorageLocation = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    StorageKey = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    OwnerKind = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    OwnerId = table.Column<Guid>(type: "uuid", nullable: true),
                    FirstObservedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    LastObservedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ConsecutiveObservations = table.Column<int>(type: "integer", nullable: false),
                    FirstRunId = table.Column<Guid>(type: "uuid", nullable: false),
                    LastRunId = table.Column<Guid>(type: "uuid", nullable: false),
                    ResolvedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ResolutionCode = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InventoryFindings", x => x.Id);
                    table.UniqueConstraint("AK_InventoryFindings_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_MediaInventoryFindings_Observations", "\"ConsecutiveObservations\" >= 1 AND \"LastObservedAtUtc\" >= \"FirstObservedAtUtc\"");
                    table.CheckConstraint("CK_MediaInventoryFindings_Owner", "(\"OwnerKind\" = 'None') = (\"OwnerId\" IS NULL)");
                    table.CheckConstraint("CK_MediaInventoryFindings_Resolution", "(\"ResolvedAtUtc\" IS NULL) = (\"ResolutionCode\" IS NULL)");
                    table.CheckConstraint("CK_MediaInventoryFindings_StorageLocator", "\"StorageLocation\" ~ '^[a-z0-9][a-z0-9._-]{0,79}$' AND (\"StorageKey\" ~ ('^' || replace(lower(\"TenantId\"::text), '-', '') || '(/[a-z0-9._-]+)+$') AND \"StorageKey\" !~ '(^|/)[.]+(/|$)' AND \"StorageKey\" !~ '[.](/|$)')");
                    table.ForeignKey(
                        name: "FK_InventoryFindings_InventoryRuns_FirstRunId",
                        column: x => x.FirstRunId,
                        principalSchema: "media",
                        principalTable: "InventoryRuns",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_InventoryFindings_InventoryRuns_LastRunId",
                        column: x => x.LastRunId,
                        principalSchema: "media",
                        principalTable: "InventoryRuns",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Assets_TenantId_ScanStorageLocation_ScanStorageKey",
                schema: "media",
                table: "Assets",
                columns: new[] { "TenantId", "ScanStorageLocation", "ScanStorageKey" },
                filter: "\"StorageKey\" IS NULL AND \"ScanStorageKey\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_AssetDerivatives_TenantId_ScanStorageLocation_ScanStorageKey",
                schema: "media",
                table: "AssetDerivatives",
                columns: new[] { "TenantId", "ScanStorageLocation", "ScanStorageKey" },
                filter: "\"StorageKey\" IS NULL AND \"ScanStorageKey\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_InventoryFindings_FirstRunId",
                schema: "media",
                table: "InventoryFindings",
                column: "FirstRunId");

            migrationBuilder.CreateIndex(
                name: "IX_InventoryFindings_LastRunId",
                schema: "media",
                table: "InventoryFindings",
                column: "LastRunId");

            migrationBuilder.CreateIndex(
                name: "IX_InventoryFindings_TenantId_Kind_StorageLocation_StorageKey",
                schema: "media",
                table: "InventoryFindings",
                columns: new[] { "TenantId", "Kind", "StorageLocation", "StorageKey" },
                unique: true,
                filter: "\"ResolvedAtUtc\" IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_InventoryFindings_TenantId_ResolvedAtUtc_Kind",
                schema: "media",
                table: "InventoryFindings",
                columns: new[] { "TenantId", "ResolvedAtUtc", "Kind" });

            migrationBuilder.CreateIndex(
                name: "IX_InventoryRuns_Location",
                schema: "media",
                table: "InventoryRuns",
                column: "Location",
                unique: true,
                filter: "\"State\" = 'Running'");

            migrationBuilder.CreateIndex(
                name: "IX_InventoryRuns_Location_StartedAtUtc",
                schema: "media",
                table: "InventoryRuns",
                columns: new[] { "Location", "StartedAtUtc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "InventoryFindings",
                schema: "media");

            migrationBuilder.DropTable(
                name: "InventoryRuns",
                schema: "media");

            migrationBuilder.DropIndex(
                name: "IX_Assets_TenantId_ScanStorageLocation_ScanStorageKey",
                schema: "media",
                table: "Assets");

            migrationBuilder.DropIndex(
                name: "IX_AssetDerivatives_TenantId_ScanStorageLocation_ScanStorageKey",
                schema: "media",
                table: "AssetDerivatives");
        }
    }
}
