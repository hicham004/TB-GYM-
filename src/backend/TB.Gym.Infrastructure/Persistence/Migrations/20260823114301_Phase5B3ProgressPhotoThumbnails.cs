using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Phase5B3ProgressPhotoThumbnails : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "AssetDerivatives",
                schema: "media",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    MediaAssetId = table.Column<Guid>(type: "uuid", nullable: false),
                    Variant = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    VerifiedContentType = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Length = table.Column<long>(type: "bigint", nullable: false),
                    Sha256 = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    StorageKey = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Width = table.Column<int>(type: "integer", nullable: false),
                    Height = table.Column<int>(type: "integer", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AssetDerivatives", x => x.Id);
                    table.UniqueConstraint("AK_AssetDerivatives_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_MediaAssetDerivatives_Dimensions", "\"Width\" > 0 AND \"Height\" > 0 AND (\"Variant\" <> 'Thumbnail' OR (\"Width\" <= 480 AND \"Height\" <= 480))");
                    table.CheckConstraint("CK_MediaAssetDerivatives_Hash", "\"Sha256\" ~ '^[0-9a-f]{64}$'");
                    table.CheckConstraint("CK_MediaAssetDerivatives_Length", "\"Length\" > 0 AND \"Length\" <= 15728640");
                    table.ForeignKey(
                        name: "FK_AssetDerivatives_Assets_TenantId_MediaAssetId",
                        columns: x => new { x.TenantId, x.MediaAssetId },
                        principalSchema: "media",
                        principalTable: "Assets",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AssetDerivatives_TenantId_MediaAssetId_Variant",
                schema: "media",
                table: "AssetDerivatives",
                columns: new[] { "TenantId", "MediaAssetId", "Variant" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_AssetDerivatives_TenantId_StorageKey",
                schema: "media",
                table: "AssetDerivatives",
                columns: new[] { "TenantId", "StorageKey" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AssetDerivatives",
                schema: "media");
        }
    }
}
