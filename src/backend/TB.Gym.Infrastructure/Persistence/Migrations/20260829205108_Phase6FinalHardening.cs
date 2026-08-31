using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Phase6FinalHardening : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "IngestObjects",
                schema: "media",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    StorageKey = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    AccountedBytes = table.Column<long>(type: "bigint", nullable: false),
                    Purpose = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    ClientProfileId = table.Column<Guid>(type: "uuid", nullable: true),
                    Status = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    PurgeAfterUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    StoredAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    PurgedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    PurgeAttemptCount = table.Column<int>(type: "integer", nullable: false),
                    LastPurgeAttemptAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    PurgeFailureCode = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_IngestObjects", x => x.Id);
                    table.UniqueConstraint("AK_IngestObjects_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_MediaIngestObjects_Bytes", "\"AccountedBytes\" > 0 AND \"AccountedBytes\" <= 524288000");
                    table.CheckConstraint("CK_MediaIngestObjects_Client", "\"Purpose\" <> 'ProgressPhoto' OR \"ClientProfileId\" IS NOT NULL");
                    table.CheckConstraint("CK_MediaIngestObjects_Purged", "(\"Status\" = 'Purged') = (\"PurgedAtUtc\" IS NOT NULL AND \"StorageKey\" IS NULL)");
                });

            migrationBuilder.CreateIndex(
                name: "IX_IngestObjects_Status_PurgeAfterUtc",
                schema: "media",
                table: "IngestObjects",
                columns: new[] { "Status", "PurgeAfterUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_IngestObjects_TenantId_ClientProfileId_Status",
                schema: "media",
                table: "IngestObjects",
                columns: new[] { "TenantId", "ClientProfileId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_IngestObjects_TenantId_StorageKey",
                schema: "media",
                table: "IngestObjects",
                columns: new[] { "TenantId", "StorageKey" },
                unique: true,
                filter: "\"StorageKey\" IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "IngestObjects",
                schema: "media");
        }
    }
}
