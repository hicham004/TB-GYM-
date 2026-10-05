using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddProgramDrafts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ProgramDrafts",
                schema: "training",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OwnerUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    TemplateId = table.Column<Guid>(type: "uuid", nullable: true),
                    SourceVersionId = table.Column<Guid>(type: "uuid", nullable: true),
                    StartedAtVersionNumber = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    WeekCount = table.Column<int>(type: "integer", nullable: false),
                    ContentJson = table.Column<string>(type: "jsonb", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProgramDrafts", x => x.Id);
                    table.UniqueConstraint("AK_ProgramDrafts_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_ProgramDrafts_Program", "(\"TemplateId\" IS NULL AND \"SourceVersionId\" IS NULL AND \"StartedAtVersionNumber\" = 0) OR (\"TemplateId\" IS NOT NULL AND \"SourceVersionId\" IS NOT NULL AND \"StartedAtVersionNumber\" >= 1)");
                    table.CheckConstraint("CK_ProgramDrafts_WeekCount", "\"WeekCount\" BETWEEN 1 AND 52");
                    table.ForeignKey(
                        name: "FK_ProgramDrafts_Memberships_TenantId_OwnerUserId",
                        columns: x => new { x.TenantId, x.OwnerUserId },
                        principalSchema: "tenancy",
                        principalTable: "Memberships",
                        principalColumns: new[] { "TenantId", "UserId" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ProgramDrafts_ProgramTemplateVersions_TenantId_SourceVersio~",
                        columns: x => new { x.TenantId, x.SourceVersionId },
                        principalSchema: "training",
                        principalTable: "ProgramTemplateVersions",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ProgramDrafts_ProgramTemplates_TenantId_TemplateId",
                        columns: x => new { x.TenantId, x.TemplateId },
                        principalSchema: "training",
                        principalTable: "ProgramTemplates",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ProgramDrafts_Tenants_TenantId",
                        column: x => x.TenantId,
                        principalSchema: "tenancy",
                        principalTable: "Tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ProgramDrafts_TenantId_OwnerUserId_TemplateId",
                schema: "training",
                table: "ProgramDrafts",
                columns: new[] { "TenantId", "OwnerUserId", "TemplateId" },
                unique: true,
                filter: "\"TemplateId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_ProgramDrafts_TenantId_OwnerUserId_UpdatedAtUtc",
                schema: "training",
                table: "ProgramDrafts",
                columns: new[] { "TenantId", "OwnerUserId", "UpdatedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_ProgramDrafts_TenantId_SourceVersionId",
                schema: "training",
                table: "ProgramDrafts",
                columns: new[] { "TenantId", "SourceVersionId" });

            migrationBuilder.CreateIndex(
                name: "IX_ProgramDrafts_TenantId_TemplateId",
                schema: "training",
                table: "ProgramDrafts",
                columns: new[] { "TenantId", "TemplateId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ProgramDrafts",
                schema: "training");
        }
    }
}
