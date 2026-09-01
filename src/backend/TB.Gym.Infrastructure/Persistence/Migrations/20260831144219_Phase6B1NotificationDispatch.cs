using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Phase6B1NotificationDispatch : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_OutboxItems_Status_ScheduledAtUtc",
                schema: "notifications",
                table: "OutboxItems");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "ClaimExpiresAtUtc",
                schema: "notifications",
                table: "OutboxItems",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "ClaimToken",
                schema: "notifications",
                table: "OutboxItems",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "DeadLetteredAtUtc",
                schema: "notifications",
                table: "OutboxItems",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "NextAttemptAtUtc",
                schema: "notifications",
                table: "OutboxItems",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTimeOffset(new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified), new TimeSpan(0, 0, 0, 0, 0)));

            // Existing history is preserved rather than reinterpreted. Every Phase 2 row became due
            // at its scheduled instant and nothing has retried it yet, so its next attempt is that
            // same instant; the generated column default of year 1 would otherwise violate the
            // NextAttemptAtUtc >= ScheduledAtUtc check added below.
            migrationBuilder.Sql(
                """
                UPDATE notifications."OutboxItems" SET "NextAttemptAtUtc" = "ScheduledAtUtc";
                """);

            // Phase 2 had a terminal-ish 'Failed' state with no retry schedule behind it, so a failed
            // item simply stopped. There is a dispatcher now, and those items are still owed: they
            // return to Pending, due immediately, with their recorded failure code and attempt count
            // intact. Pending, Cancelled and Dispatched rows are untouched.
            migrationBuilder.Sql(
                """
                UPDATE notifications."OutboxItems"
                SET "Status" = 'Pending'
                WHERE "Status" = 'Failed';
                """);

            migrationBuilder.AddUniqueConstraint(
                name: "AK_OutboxItems_TenantId_Id",
                schema: "notifications",
                table: "OutboxItems",
                columns: new[] { "TenantId", "Id" });

            migrationBuilder.CreateTable(
                name: "DeliveryAttempts",
                schema: "notifications",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OutboxItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    Channel = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    AttemptNumber = table.Column<int>(type: "integer", nullable: false),
                    ClaimToken = table.Column<Guid>(type: "uuid", nullable: false),
                    IdempotencyKey = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    StartedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CompletedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    Outcome = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    FailureCode = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    ProviderMessageId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DeliveryAttempts", x => x.Id);
                    table.CheckConstraint("CK_NotificationDeliveryAttempts_AttemptNumber", "\"AttemptNumber\" >= 1");
                    table.CheckConstraint("CK_NotificationDeliveryAttempts_Completion", "(\"Outcome\" = 'Started') = (\"CompletedAtUtc\" IS NULL)");
                    table.CheckConstraint("CK_NotificationDeliveryAttempts_Success", "\"Outcome\" <> 'Succeeded' OR \"FailureCode\" IS NULL");
                    table.ForeignKey(
                        name: "FK_DeliveryAttempts_OutboxItems_TenantId_OutboxItemId",
                        columns: x => new { x.TenantId, x.OutboxItemId },
                        principalSchema: "notifications",
                        principalTable: "OutboxItems",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Notifications",
                schema: "notifications",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RecipientUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    SourceOutboxItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(48)", maxLength: 48, nullable: false),
                    TemplateKey = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    TemplateVersion = table.Column<int>(type: "integer", nullable: false),
                    Culture = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Body = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    ReadAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Notifications", x => x.Id);
                    table.CheckConstraint("CK_Notifications_TemplateVersion", "\"TemplateVersion\" >= 1");
                    table.ForeignKey(
                        name: "FK_Notifications_OutboxItems_TenantId_SourceOutboxItemId",
                        columns: x => new { x.TenantId, x.SourceOutboxItemId },
                        principalSchema: "notifications",
                        principalTable: "OutboxItems",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Notifications_Tenants_TenantId",
                        column: x => x.TenantId,
                        principalSchema: "tenancy",
                        principalTable: "Tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Notifications_Users_RecipientUserId",
                        column: x => x.RecipientUserId,
                        principalSchema: "identity",
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_OutboxItems_Status_ClaimExpiresAtUtc",
                schema: "notifications",
                table: "OutboxItems",
                columns: new[] { "Status", "ClaimExpiresAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_OutboxItems_Status_NextAttemptAtUtc_Id",
                schema: "notifications",
                table: "OutboxItems",
                columns: new[] { "Status", "NextAttemptAtUtc", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_OutboxItems_TenantId_Status_DeadLetteredAtUtc",
                schema: "notifications",
                table: "OutboxItems",
                columns: new[] { "TenantId", "Status", "DeadLetteredAtUtc" });

            migrationBuilder.AddCheckConstraint(
                name: "CK_NotificationOutboxItems_Claim",
                schema: "notifications",
                table: "OutboxItems",
                sql: "(\"ClaimToken\" IS NULL) = (\"ClaimExpiresAtUtc\" IS NULL) AND (\"ClaimToken\" IS NULL OR \"Status\" = 'Processing')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NotificationOutboxItems_DeadLettered",
                schema: "notifications",
                table: "OutboxItems",
                sql: "(\"Status\" = 'DeadLettered') = (\"DeadLetteredAtUtc\" IS NOT NULL)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NotificationOutboxItems_Dispatched",
                schema: "notifications",
                table: "OutboxItems",
                sql: "(\"Status\" = 'Dispatched') = (\"DispatchedAtUtc\" IS NOT NULL)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NotificationOutboxItems_NextAttempt",
                schema: "notifications",
                table: "OutboxItems",
                sql: "\"NextAttemptAtUtc\" >= \"ScheduledAtUtc\"");

            migrationBuilder.CreateIndex(
                name: "IX_DeliveryAttempts_TenantId_OutboxItemId_Channel_AttemptNumber",
                schema: "notifications",
                table: "DeliveryAttempts",
                columns: new[] { "TenantId", "OutboxItemId", "Channel", "AttemptNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_DeliveryAttempts_TenantId_OutboxItemId_StartedAtUtc",
                schema: "notifications",
                table: "DeliveryAttempts",
                columns: new[] { "TenantId", "OutboxItemId", "StartedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_Notifications_RecipientUserId",
                schema: "notifications",
                table: "Notifications",
                column: "RecipientUserId");

            migrationBuilder.CreateIndex(
                name: "IX_Notifications_TenantId_RecipientUserId_CreatedAtUtc_Id",
                schema: "notifications",
                table: "Notifications",
                columns: new[] { "TenantId", "RecipientUserId", "CreatedAtUtc", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_Notifications_TenantId_RecipientUserId_Unread",
                schema: "notifications",
                table: "Notifications",
                columns: new[] { "TenantId", "RecipientUserId" },
                filter: "\"ReadAtUtc\" IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Notifications_TenantId_SourceOutboxItemId",
                schema: "notifications",
                table: "Notifications",
                columns: new[] { "TenantId", "SourceOutboxItemId" },
                unique: true);

            // Delivery history is the only thing that can explain a dead-lettered notification after
            // the fact, and a rendered notification is a record of what somebody was actually told.
            // The application guards both, but a repair script, a later migration or a future job
            // does not pass through the application, so the database refuses them itself.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION notifications.protect_delivery_attempt()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Notification delivery attempts are never deleted' USING ERRCODE = '23514';
                    END IF;
                    IF OLD."Outcome" <> 'Started' THEN
                        RAISE EXCEPTION 'A completed notification delivery attempt is immutable' USING ERRCODE = '23514';
                    END IF;
                    IF OLD."Id" <> NEW."Id"
                       OR OLD."TenantId" <> NEW."TenantId"
                       OR OLD."OutboxItemId" <> NEW."OutboxItemId"
                       OR OLD."Channel" <> NEW."Channel"
                       OR OLD."AttemptNumber" <> NEW."AttemptNumber"
                       OR OLD."ClaimToken" <> NEW."ClaimToken"
                       OR OLD."IdempotencyKey" <> NEW."IdempotencyKey"
                       OR OLD."StartedAtUtc" <> NEW."StartedAtUtc" THEN
                        RAISE EXCEPTION 'A notification delivery attempt identity is immutable' USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER "TR_NotificationDeliveryAttempts_Protect"
                    BEFORE UPDATE OR DELETE ON notifications."DeliveryAttempts"
                    FOR EACH ROW EXECUTE FUNCTION notifications.protect_delivery_attempt();

                CREATE OR REPLACE FUNCTION notifications.protect_notification()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Notifications are never deleted' USING ERRCODE = '23514';
                    END IF;
                    IF OLD."Id" <> NEW."Id"
                       OR OLD."TenantId" <> NEW."TenantId"
                       OR OLD."RecipientUserId" <> NEW."RecipientUserId"
                       OR OLD."SourceOutboxItemId" <> NEW."SourceOutboxItemId"
                       OR OLD."Kind" <> NEW."Kind"
                       OR OLD."TemplateKey" <> NEW."TemplateKey"
                       OR OLD."TemplateVersion" <> NEW."TemplateVersion"
                       OR OLD."Culture" <> NEW."Culture"
                       OR OLD."Title" <> NEW."Title"
                       OR OLD."Body" <> NEW."Body"
                       OR OLD."CreatedAtUtc" <> NEW."CreatedAtUtc" THEN
                        RAISE EXCEPTION 'A delivered notification is a snapshot; only its read state can change' USING ERRCODE = '23514';
                    END IF;
                    -- Reading is a one-way act. Re-reading does not move the instant it was first
                    -- read, and nothing may quietly mark a notification unread again.
                    IF OLD."ReadAtUtc" IS NOT NULL AND OLD."ReadAtUtc" IS DISTINCT FROM NEW."ReadAtUtc" THEN
                        RAISE EXCEPTION 'A notification read state cannot be changed once set' USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER "TR_Notifications_Protect"
                    BEFORE UPDATE OR DELETE ON notifications."Notifications"
                    FOR EACH ROW EXECUTE FUNCTION notifications.protect_notification();
                """);
        }

        /// <summary>
        /// Reverting this migration is destructive and unrecoverable.
        /// </summary>
        /// <remarks>
        /// Dropping <c>notifications."Notifications"</c> deletes every in-app notification and every
        /// read state anybody has: what was said, when it was delivered and whether it was read are
        /// all gone, and nothing can rebuild them, because the outbox row records the intent rather
        /// than the wording. Dropping <c>notifications."DeliveryAttempts"</c> deletes the entire
        /// delivery history, so no dead-lettered item can be explained afterwards. The retry state on
        /// the outbox itself is lost too: <c>NextAttemptAtUtc</c>, the claim lease and
        /// <c>DeadLetteredAtUtc</c> are dropped, and any row currently Processing or DeadLettered is
        /// left in a status the previous schema had no meaning for.
        /// <para>
        /// This exists so the migration is reversible for a local database that has just been built.
        /// Schema rollback in production means restoring a tested backup or deploying a forward
        /// repair migration, exactly as ARCHITECTURE.md section 7 says; it does not mean running this.
        /// </para>
        /// </remarks>
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                DROP TRIGGER IF EXISTS "TR_Notifications_Protect" ON notifications."Notifications";
                DROP TRIGGER IF EXISTS "TR_NotificationDeliveryAttempts_Protect" ON notifications."DeliveryAttempts";
                DROP FUNCTION IF EXISTS notifications.protect_notification();
                DROP FUNCTION IF EXISTS notifications.protect_delivery_attempt();
                """);

            migrationBuilder.DropTable(
                name: "DeliveryAttempts",
                schema: "notifications");

            migrationBuilder.DropTable(
                name: "Notifications",
                schema: "notifications");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_OutboxItems_TenantId_Id",
                schema: "notifications",
                table: "OutboxItems");

            migrationBuilder.DropIndex(
                name: "IX_OutboxItems_Status_ClaimExpiresAtUtc",
                schema: "notifications",
                table: "OutboxItems");

            migrationBuilder.DropIndex(
                name: "IX_OutboxItems_Status_NextAttemptAtUtc_Id",
                schema: "notifications",
                table: "OutboxItems");

            migrationBuilder.DropIndex(
                name: "IX_OutboxItems_TenantId_Status_DeadLetteredAtUtc",
                schema: "notifications",
                table: "OutboxItems");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NotificationOutboxItems_Claim",
                schema: "notifications",
                table: "OutboxItems");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NotificationOutboxItems_DeadLettered",
                schema: "notifications",
                table: "OutboxItems");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NotificationOutboxItems_Dispatched",
                schema: "notifications",
                table: "OutboxItems");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NotificationOutboxItems_NextAttempt",
                schema: "notifications",
                table: "OutboxItems");

            // Processing and DeadLettered have no meaning in the Phase 2 vocabulary. A held item goes
            // back to Pending so it is not stranded in an unreadable status, and a dead letter becomes
            // Failed, which is the closest thing the previous schema could express. This runs after
            // the check constraints are gone, because the intermediate rows would violate them.
            migrationBuilder.Sql(
                """
                UPDATE notifications."OutboxItems" SET "Status" = 'Pending' WHERE "Status" = 'Processing';
                UPDATE notifications."OutboxItems" SET "Status" = 'Failed' WHERE "Status" = 'DeadLettered';
                """);

            migrationBuilder.DropColumn(
                name: "ClaimExpiresAtUtc",
                schema: "notifications",
                table: "OutboxItems");

            migrationBuilder.DropColumn(
                name: "ClaimToken",
                schema: "notifications",
                table: "OutboxItems");

            migrationBuilder.DropColumn(
                name: "DeadLetteredAtUtc",
                schema: "notifications",
                table: "OutboxItems");

            migrationBuilder.DropColumn(
                name: "NextAttemptAtUtc",
                schema: "notifications",
                table: "OutboxItems");

            migrationBuilder.CreateIndex(
                name: "IX_OutboxItems_Status_ScheduledAtUtc",
                schema: "notifications",
                table: "OutboxItems",
                columns: new[] { "Status", "ScheduledAtUtc" });
        }
    }
}
