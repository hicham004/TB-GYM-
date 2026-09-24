using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class CoachResignedOwnerNotice : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_NotificationOutboxItems_Vocabulary",
                schema: "notifications",
                table: "OutboxItems");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NotificationOutboxItems_Vocabulary",
                schema: "notifications",
                table: "OutboxItems",
                sql: "\"Status\" IN ('Scheduled', 'Cancelled') AND \"Purpose\" = 'ServiceTransactional' AND \"Kind\" IN ('PaymentRequired', 'EnrollmentActivated', 'EnrollmentEndingSoon', 'EnrollmentExpired', 'EnrollmentRenewed', 'CoachDeparted', 'ClientLeft', 'CoachResigned')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_NotificationOutboxItems_Vocabulary",
                schema: "notifications",
                table: "OutboxItems");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NotificationOutboxItems_Vocabulary",
                schema: "notifications",
                table: "OutboxItems",
                sql: "\"Status\" IN ('Scheduled', 'Cancelled') AND \"Purpose\" = 'ServiceTransactional' AND \"Kind\" IN ('PaymentRequired', 'EnrollmentActivated', 'EnrollmentEndingSoon', 'EnrollmentExpired', 'EnrollmentRenewed', 'CoachDeparted', 'ClientLeft')");
        }
    }
}
