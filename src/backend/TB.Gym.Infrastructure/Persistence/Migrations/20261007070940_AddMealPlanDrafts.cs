using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddMealPlanDrafts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "MealPlanDrafts",
                schema: "nutrition",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OwnerUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    MealPlanTemplateId = table.Column<Guid>(type: "uuid", nullable: true),
                    SourceVersionId = table.Column<Guid>(type: "uuid", nullable: true),
                    StartedAtRevision = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    DayCount = table.Column<int>(type: "integer", nullable: false),
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
                    table.PrimaryKey("PK_MealPlanDrafts", x => x.Id);
                    table.UniqueConstraint("AK_MealPlanDrafts_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_MealPlanDrafts_DayCount", "\"DayCount\" BETWEEN 1 AND 365");
                    table.CheckConstraint("CK_MealPlanDrafts_Plan", "(\"MealPlanTemplateId\" IS NULL AND \"SourceVersionId\" IS NULL AND \"StartedAtRevision\" = 0) OR (\"MealPlanTemplateId\" IS NOT NULL AND \"SourceVersionId\" IS NOT NULL AND \"StartedAtRevision\" >= 1)");
                    table.ForeignKey(
                        name: "FK_MealPlanDrafts_MealPlanTemplateVersions_TenantId_SourceVers~",
                        columns: x => new { x.TenantId, x.SourceVersionId },
                        principalSchema: "nutrition",
                        principalTable: "MealPlanTemplateVersions",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_MealPlanDrafts_MealPlanTemplates_TenantId_MealPlanTemplateId",
                        columns: x => new { x.TenantId, x.MealPlanTemplateId },
                        principalSchema: "nutrition",
                        principalTable: "MealPlanTemplates",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_MealPlanDrafts_Memberships_TenantId_OwnerUserId",
                        columns: x => new { x.TenantId, x.OwnerUserId },
                        principalSchema: "tenancy",
                        principalTable: "Memberships",
                        principalColumns: new[] { "TenantId", "UserId" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_MealPlanDrafts_Tenants_TenantId",
                        column: x => x.TenantId,
                        principalSchema: "tenancy",
                        principalTable: "Tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_MealPlanDrafts_TenantId_MealPlanTemplateId",
                schema: "nutrition",
                table: "MealPlanDrafts",
                columns: new[] { "TenantId", "MealPlanTemplateId" });

            migrationBuilder.CreateIndex(
                name: "IX_MealPlanDrafts_TenantId_OwnerUserId_MealPlanTemplateId",
                schema: "nutrition",
                table: "MealPlanDrafts",
                columns: new[] { "TenantId", "OwnerUserId", "MealPlanTemplateId" },
                unique: true,
                filter: "\"MealPlanTemplateId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_MealPlanDrafts_TenantId_OwnerUserId_UpdatedAtUtc",
                schema: "nutrition",
                table: "MealPlanDrafts",
                columns: new[] { "TenantId", "OwnerUserId", "UpdatedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_MealPlanDrafts_TenantId_SourceVersionId",
                schema: "nutrition",
                table: "MealPlanDrafts",
                columns: new[] { "TenantId", "SourceVersionId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "MealPlanDrafts",
                schema: "nutrition");
        }
    }
}
