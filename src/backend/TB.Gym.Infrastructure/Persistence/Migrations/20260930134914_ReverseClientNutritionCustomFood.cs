using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ReverseClientNutritionCustomFood : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddUniqueConstraint(
                name: "AK_DailyNutritionCustomFoods_TenantId_DailyNutritionLogId_Id",
                schema: "nutrition",
                table: "DailyNutritionCustomFoods",
                columns: new[] { "TenantId", "DailyNutritionLogId", "Id" });

            migrationBuilder.CreateTable(
                name: "DailyNutritionCustomFoodReversals",
                schema: "nutrition",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    DailyNutritionLogId = table.Column<Guid>(type: "uuid", nullable: false),
                    CustomFoodId = table.Column<Guid>(type: "uuid", nullable: false),
                    ActorUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    OccurredAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DailyNutritionCustomFoodReversals", x => x.Id);
                    table.UniqueConstraint("AK_DailyNutritionCustomFoodReversals_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_DailyNutritionCustomFoodReversals_DailyNutritionCustomFoods~",
                        columns: x => new { x.TenantId, x.DailyNutritionLogId, x.CustomFoodId },
                        principalSchema: "nutrition",
                        principalTable: "DailyNutritionCustomFoods",
                        principalColumns: new[] { "TenantId", "DailyNutritionLogId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_DailyNutritionCustomFoodReversals_DailyNutritionLogs_Tenant~",
                        columns: x => new { x.TenantId, x.DailyNutritionLogId },
                        principalSchema: "nutrition",
                        principalTable: "DailyNutritionLogs",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_DailyNutritionCustomFoodReversals_TenantId_CustomFoodId",
                schema: "nutrition",
                table: "DailyNutritionCustomFoodReversals",
                columns: new[] { "TenantId", "CustomFoodId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_DailyNutritionCustomFoodReversals_TenantId_DailyNutritionLo~",
                schema: "nutrition",
                table: "DailyNutritionCustomFoodReversals",
                columns: new[] { "TenantId", "DailyNutritionLogId", "CustomFoodId" });

            migrationBuilder.Sql("""
                CREATE FUNCTION nutrition.guard_custom_food_reversal_append()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                DECLARE log_status text;
                BEGIN
                    IF TG_OP <> 'INSERT' THEN
                        RAISE EXCEPTION 'Custom food reversals are append-only' USING ERRCODE = '23514';
                    END IF;
                    SELECT log."Status" INTO log_status
                    FROM nutrition."DailyNutritionLogs" log
                    WHERE log."TenantId" = NEW."TenantId"
                      AND log."Id" = NEW."DailyNutritionLogId"
                    FOR UPDATE;
                    IF log_status = 'Completed' THEN
                        RAISE EXCEPTION 'A completed nutrition day cannot reverse food' USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END;
                $function$;
                CREATE TRIGGER "TR_DailyNutritionCustomFoodReversals_Append"
                    BEFORE INSERT OR UPDATE OR DELETE ON nutrition."DailyNutritionCustomFoodReversals"
                    FOR EACH ROW EXECUTE FUNCTION nutrition.guard_custom_food_reversal_append();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP FUNCTION nutrition.guard_custom_food_reversal_append() CASCADE;");
            migrationBuilder.DropTable(
                name: "DailyNutritionCustomFoodReversals",
                schema: "nutrition");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_DailyNutritionCustomFoods_TenantId_DailyNutritionLogId_Id",
                schema: "nutrition",
                table: "DailyNutritionCustomFoods");
        }
    }
}
