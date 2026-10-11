using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Phase5ReviewNotificationTargets : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int[]>(
                name: "TargetWeeks",
                schema: "notifications",
                table: "Notifications",
                type: "integer[]",
                nullable: true);
            migrationBuilder.Sql("""
                CREATE FUNCTION notifications.protect_notification_targets()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF OLD."TargetWeeks" IS DISTINCT FROM NEW."TargetWeeks" THEN
                        RAISE EXCEPTION 'Delivered notification targets are immutable' USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END;
                $function$;
                CREATE TRIGGER "TR_Notifications_TargetsProtect"
                    BEFORE UPDATE ON notifications."Notifications"
                    FOR EACH ROW EXECUTE FUNCTION notifications.protect_notification_targets();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP TRIGGER "TR_Notifications_TargetsProtect" ON notifications."Notifications";
                DROP FUNCTION notifications.protect_notification_targets();
                """);
            migrationBuilder.DropColumn(
                name: "TargetWeeks",
                schema: "notifications",
                table: "Notifications");
        }
    }
}
