using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class RenewalRequests : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_NotificationOutboxItems_Vocabulary",
                schema: "notifications",
                table: "OutboxItems");

            migrationBuilder.CreateTable(
                name: "RenewalRequests",
                schema: "subscriptions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientProfileId = table.Column<Guid>(type: "uuid", nullable: false),
                    EndedEnrollmentId = table.Column<Guid>(type: "uuid", nullable: false),
                    CoachUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    RequestedOn = table.Column<DateOnly>(type: "date", nullable: false),
                    AskAgainFrom = table.Column<DateOnly>(type: "date", nullable: false),
                    RequestedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RenewalRequests", x => x.Id);
                    table.CheckConstraint("CK_RenewalRequests_Window", "\"AskAgainFrom\" = \"RequestedOn\" + 7");
                    table.ForeignKey(
                        name: "FK_RenewalRequests_ClientEnrollments_TenantId_EndedEnrollmentId",
                        columns: x => new { x.TenantId, x.EndedEnrollmentId },
                        principalSchema: "subscriptions",
                        principalTable: "ClientEnrollments",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_RenewalRequests_ClientProfiles_TenantId_ClientProfileId",
                        columns: x => new { x.TenantId, x.ClientProfileId },
                        principalSchema: "clients",
                        principalTable: "ClientProfiles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_RenewalRequests_Users_CoachUserId",
                        column: x => x.CoachUserId,
                        principalSchema: "identity",
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.AddCheckConstraint(
                name: "CK_NotificationOutboxItems_Vocabulary",
                schema: "notifications",
                table: "OutboxItems",
                sql: "\"Status\" IN ('Scheduled', 'Cancelled') AND \"Purpose\" = 'ServiceTransactional' AND \"Kind\" IN ('PaymentRequired', 'EnrollmentActivated', 'EnrollmentEndingSoon', 'EnrollmentExpired', 'EnrollmentRenewed', 'CoachDeparted', 'ClientLeft', 'CoachResigned', 'RenewalRequested')");

            migrationBuilder.CreateIndex(
                name: "IX_RenewalRequests_CoachUserId",
                schema: "subscriptions",
                table: "RenewalRequests",
                column: "CoachUserId");

            migrationBuilder.CreateIndex(
                name: "IX_RenewalRequests_TenantId_ClientProfileId_RequestedOn",
                schema: "subscriptions",
                table: "RenewalRequests",
                columns: new[] { "TenantId", "ClientProfileId", "RequestedOn" });

            migrationBuilder.CreateIndex(
                name: "IX_RenewalRequests_TenantId_EndedEnrollmentId",
                schema: "subscriptions",
                table: "RenewalRequests",
                columns: new[] { "TenantId", "EndedEnrollmentId" });

            // ADR 0029. At most one request per client in any 7 days: two windows
            // [RequestedOn, AskAgainFrom) of one client may never overlap, so a double tap or two
            // requests at once cannot both commit. Requests are history: never updated or deleted.
            migrationBuilder.Sql(
                """
                ALTER TABLE subscriptions."RenewalRequests"
                ADD CONSTRAINT "EX_RenewalRequests_OnePerWindow"
                EXCLUDE USING gist
                (
                    "TenantId" WITH =,
                    "ClientProfileId" WITH =,
                    (daterange("RequestedOn", "AskAgainFrom", '[)')) WITH &&
                );

                CREATE TRIGGER "TR_RenewalRequests_AppendOnly"
                BEFORE UPDATE OR DELETE ON subscriptions."RenewalRequests"
                FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Rolling back after a renewal notice was queued fails at the vocabulary check below,
            // deliberately: those intents and their deliveries are history. Keep this migration and
            // roll forward instead.
            migrationBuilder.DropTable(
                name: "RenewalRequests",
                schema: "subscriptions");

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
    }
}
