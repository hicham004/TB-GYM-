using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddRecipeDrafts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "RecipeDrafts",
                schema: "nutrition",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OwnerUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    RecipeId = table.Column<Guid>(type: "uuid", nullable: true),
                    StartedAtRevision = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    LineCount = table.Column<int>(type: "integer", nullable: false),
                    PhotoMediaAssetId = table.Column<Guid>(type: "uuid", nullable: true),
                    AiMealDraftOperationId = table.Column<Guid>(type: "uuid", nullable: true),
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
                    table.PrimaryKey("PK_RecipeDrafts", x => x.Id);
                    table.UniqueConstraint("AK_RecipeDrafts_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_RecipeDrafts_LineCount", "\"LineCount\" BETWEEN 0 AND 500");
                    table.CheckConstraint("CK_RecipeDrafts_Recipe", "(\"RecipeId\" IS NULL AND \"StartedAtRevision\" = 0) OR (\"RecipeId\" IS NOT NULL AND \"StartedAtRevision\" >= 1)");
                    table.CheckConstraint("CK_RecipeDrafts_Suggestion", "\"AiMealDraftOperationId\" IS NULL OR \"RecipeId\" IS NULL");
                    table.ForeignKey(
                        name: "FK_RecipeDrafts_AiMealDraftOperations_TenantId_AiMealDraftOper~",
                        columns: x => new { x.TenantId, x.AiMealDraftOperationId },
                        principalSchema: "nutrition",
                        principalTable: "AiMealDraftOperations",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_RecipeDrafts_Assets_TenantId_PhotoMediaAssetId",
                        columns: x => new { x.TenantId, x.PhotoMediaAssetId },
                        principalSchema: "media",
                        principalTable: "Assets",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_RecipeDrafts_Memberships_TenantId_OwnerUserId",
                        columns: x => new { x.TenantId, x.OwnerUserId },
                        principalSchema: "tenancy",
                        principalTable: "Memberships",
                        principalColumns: new[] { "TenantId", "UserId" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_RecipeDrafts_Recipes_TenantId_RecipeId",
                        columns: x => new { x.TenantId, x.RecipeId },
                        principalSchema: "nutrition",
                        principalTable: "Recipes",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_RecipeDrafts_Tenants_TenantId",
                        column: x => x.TenantId,
                        principalSchema: "tenancy",
                        principalTable: "Tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_RecipeDrafts_TenantId_AiMealDraftOperationId",
                schema: "nutrition",
                table: "RecipeDrafts",
                columns: new[] { "TenantId", "AiMealDraftOperationId" });

            migrationBuilder.CreateIndex(
                name: "IX_RecipeDrafts_TenantId_OwnerUserId_RecipeId",
                schema: "nutrition",
                table: "RecipeDrafts",
                columns: new[] { "TenantId", "OwnerUserId", "RecipeId" },
                unique: true,
                filter: "\"RecipeId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_RecipeDrafts_TenantId_OwnerUserId_UpdatedAtUtc",
                schema: "nutrition",
                table: "RecipeDrafts",
                columns: new[] { "TenantId", "OwnerUserId", "UpdatedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_RecipeDrafts_TenantId_PhotoMediaAssetId",
                schema: "nutrition",
                table: "RecipeDrafts",
                columns: new[] { "TenantId", "PhotoMediaAssetId" });

            migrationBuilder.CreateIndex(
                name: "IX_RecipeDrafts_TenantId_RecipeId",
                schema: "nutrition",
                table: "RecipeDrafts",
                columns: new[] { "TenantId", "RecipeId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "RecipeDrafts",
                schema: "nutrition");
        }
    }
}
