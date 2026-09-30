using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ClientNutritionCustomFoods : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "DailyNutritionCustomFoods",
                schema: "nutrition",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    DailyNutritionLogId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(12,4)", precision: 12, scale: 4, nullable: false),
                    Unit = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Calories = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    ProteinGrams = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    CarbohydrateGrams = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    FatGrams = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DailyNutritionCustomFoods", x => x.Id);
                    table.UniqueConstraint("AK_DailyNutritionCustomFoods_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_DailyNutritionCustomFoods_Values", "\"Amount\" > 0 AND \"Calories\" >= 0 AND \"ProteinGrams\" >= 0 AND \"CarbohydrateGrams\" >= 0 AND \"FatGrams\" >= 0");
                    table.ForeignKey(
                        name: "FK_DailyNutritionCustomFoods_DailyNutritionLogs_TenantId_Daily~",
                        columns: x => new { x.TenantId, x.DailyNutritionLogId },
                        principalSchema: "nutrition",
                        principalTable: "DailyNutritionLogs",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_DailyNutritionCustomFoods_TenantId_DailyNutritionLogId_Crea~",
                schema: "nutrition",
                table: "DailyNutritionCustomFoods",
                columns: new[] { "TenantId", "DailyNutritionLogId", "CreatedAtUtc" });

            migrationBuilder.Sql("""
                CREATE FUNCTION nutrition.guard_custom_food_append()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF TG_OP <> 'INSERT' THEN
                        RAISE EXCEPTION 'Custom food entries are append-only' USING ERRCODE = '23514';
                    END IF;
                    IF EXISTS (
                        SELECT 1 FROM nutrition."DailyNutritionLogs" log
                        WHERE log."TenantId" = NEW."TenantId"
                          AND log."Id" = NEW."DailyNutritionLogId"
                          AND log."Status" = 'Completed') THEN
                        RAISE EXCEPTION 'A completed nutrition day cannot receive food' USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END;
                $function$;
                CREATE TRIGGER "TR_DailyNutritionCustomFoods_Append"
                    BEFORE INSERT OR UPDATE OR DELETE ON nutrition."DailyNutritionCustomFoods"
                    FOR EACH ROW EXECUTE FUNCTION nutrition.guard_custom_food_append();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP FUNCTION nutrition.guard_custom_food_append() CASCADE;");
            migrationBuilder.DropTable(
                name: "DailyNutritionCustomFoods",
                schema: "nutrition");
        }
    }
}
