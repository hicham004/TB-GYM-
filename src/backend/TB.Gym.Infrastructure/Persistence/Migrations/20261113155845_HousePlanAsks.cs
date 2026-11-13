using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Notes plan N9c1 (SUB-020): a house trainee's asks for a paid plan, their word that its money was sent and how
    /// each ask ended, booked with its receipt or closed; one paid plan of the house at a time; the two staff notices.
    /// Every guard is the database's, whoever writes.
    /// </summary>
    public partial class HousePlanAsks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_NotificationOutboxItems_Vocabulary",
                schema: "notifications",
                table: "OutboxItems");

            migrationBuilder.AddUniqueConstraint(
                name: "AK_PaymentRecords_TenantId_Id",
                schema: "subscriptions",
                table: "PaymentRecords",
                columns: new[] { "TenantId", "Id" });

            migrationBuilder.CreateTable(
                name: "HousePlanAsks",
                schema: "subscriptions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientProfileId = table.Column<Guid>(type: "uuid", nullable: false),
                    ProductId = table.Column<Guid>(type: "uuid", nullable: false),
                    OfferId = table.Column<Guid>(type: "uuid", nullable: false),
                    Tier = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    AskedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    AskedOn = table.Column<DateOnly>(type: "date", nullable: false),
                    AskedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_HousePlanAsks", x => x.Id);
                    table.UniqueConstraint("AK_HousePlanAsks_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_HousePlanAsks_Tier", "\"Tier\" IN ('ProPlus', 'Max')");
                    table.ForeignKey(
                        name: "FK_HousePlanAsks_ClientProfiles_TenantId_ClientProfileId",
                        columns: x => new { x.TenantId, x.ClientProfileId },
                        principalSchema: "clients",
                        principalTable: "ClientProfiles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_HousePlanAsks_CoachingProducts_TenantId_ProductId",
                        columns: x => new { x.TenantId, x.ProductId },
                        principalSchema: "subscriptions",
                        principalTable: "CoachingProducts",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_HousePlanAsks_ProductOffers_TenantId_OfferId",
                        columns: x => new { x.TenantId, x.OfferId },
                        principalSchema: "subscriptions",
                        principalTable: "ProductOffers",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_HousePlanAsks_Users_AskedByUserId",
                        column: x => x.AskedByUserId,
                        principalSchema: "identity",
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "HousePlanAskOutcomes",
                schema: "subscriptions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AskId = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientProfileId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    EnrollmentId = table.Column<Guid>(type: "uuid", nullable: true),
                    PaymentRecordId = table.Column<Guid>(type: "uuid", nullable: true),
                    CommandId = table.Column<Guid>(type: "uuid", nullable: true),
                    Reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    DecidedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    DecidedOn = table.Column<DateOnly>(type: "date", nullable: false),
                    DecidedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_HousePlanAskOutcomes", x => x.Id);
                    table.UniqueConstraint("AK_HousePlanAskOutcomes_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_HousePlanAskOutcomes_Kind", "(\"Kind\" = 'Booked' AND \"EnrollmentId\" IS NOT NULL AND \"PaymentRecordId\" IS NOT NULL AND \"CommandId\" IS NOT NULL AND \"Reason\" IS NULL) OR (\"Kind\" = 'Closed' AND \"EnrollmentId\" IS NULL AND \"PaymentRecordId\" IS NULL AND \"CommandId\" IS NULL AND \"Reason\" IS NOT NULL AND \"Reason\" <> '')");
                    table.ForeignKey(
                        name: "FK_HousePlanAskOutcomes_ClientEnrollments_TenantId_EnrollmentId",
                        columns: x => new { x.TenantId, x.EnrollmentId },
                        principalSchema: "subscriptions",
                        principalTable: "ClientEnrollments",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_HousePlanAskOutcomes_ClientProfiles_TenantId_ClientProfileId",
                        columns: x => new { x.TenantId, x.ClientProfileId },
                        principalSchema: "clients",
                        principalTable: "ClientProfiles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_HousePlanAskOutcomes_HousePlanAsks_TenantId_AskId",
                        columns: x => new { x.TenantId, x.AskId },
                        principalSchema: "subscriptions",
                        principalTable: "HousePlanAsks",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_HousePlanAskOutcomes_PaymentRecords_TenantId_PaymentRecordId",
                        columns: x => new { x.TenantId, x.PaymentRecordId },
                        principalSchema: "subscriptions",
                        principalTable: "PaymentRecords",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_HousePlanAskOutcomes_Users_DecidedByUserId",
                        column: x => x.DecidedByUserId,
                        principalSchema: "identity",
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "HousePlanTransfers",
                schema: "subscriptions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AskId = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientProfileId = table.Column<Guid>(type: "uuid", nullable: false),
                    WhishName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    WhishNumber = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    SentOn = table.Column<DateOnly>(type: "date", nullable: false),
                    SentAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    AnonymisedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_HousePlanTransfers", x => x.Id);
                    table.UniqueConstraint("AK_HousePlanTransfers_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_HousePlanTransfers_Anonymised", "(\"AnonymisedAtUtc\" IS NULL AND \"WhishName\" IS NOT NULL AND \"WhishNumber\" IS NOT NULL) OR (\"AnonymisedAtUtc\" IS NOT NULL AND \"WhishName\" IS NULL AND \"WhishNumber\" IS NULL)");
                    table.ForeignKey(
                        name: "FK_HousePlanTransfers_ClientProfiles_TenantId_ClientProfileId",
                        columns: x => new { x.TenantId, x.ClientProfileId },
                        principalSchema: "clients",
                        principalTable: "ClientProfiles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_HousePlanTransfers_HousePlanAsks_TenantId_AskId",
                        columns: x => new { x.TenantId, x.AskId },
                        principalSchema: "subscriptions",
                        principalTable: "HousePlanAsks",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.AddCheckConstraint(
                name: "CK_NotificationOutboxItems_Vocabulary",
                schema: "notifications",
                table: "OutboxItems",
                sql: "\"Status\" IN ('Scheduled', 'Cancelled') AND \"Purpose\" = 'ServiceTransactional' AND \"Kind\" IN ('PaymentRequired', 'EnrollmentActivated', 'EnrollmentEndingSoon', 'EnrollmentExpired', 'EnrollmentRenewed', 'CoachDeparted', 'ClientLeft', 'CoachResigned', 'RenewalRequested', 'ProgramAssigned', 'WeeksShared', 'WeeksChanged', 'CoachWorkoutNote', 'ClientWorkoutNote', 'HousePlanAsked', 'HousePlanMoneySent')");

            migrationBuilder.CreateIndex(
                name: "IX_HousePlanAskOutcomes_DecidedByUserId",
                schema: "subscriptions",
                table: "HousePlanAskOutcomes",
                column: "DecidedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_HousePlanAskOutcomes_TenantId_ClientProfileId",
                schema: "subscriptions",
                table: "HousePlanAskOutcomes",
                columns: new[] { "TenantId", "ClientProfileId" });

            migrationBuilder.CreateIndex(
                name: "IX_HousePlanAskOutcomes_TenantId_CommandId",
                schema: "subscriptions",
                table: "HousePlanAskOutcomes",
                columns: new[] { "TenantId", "CommandId" },
                unique: true,
                filter: "\"CommandId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_HousePlanAskOutcomes_TenantId_EnrollmentId",
                schema: "subscriptions",
                table: "HousePlanAskOutcomes",
                columns: new[] { "TenantId", "EnrollmentId" },
                unique: true,
                filter: "\"EnrollmentId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_HousePlanAskOutcomes_TenantId_PaymentRecordId",
                schema: "subscriptions",
                table: "HousePlanAskOutcomes",
                columns: new[] { "TenantId", "PaymentRecordId" });

            migrationBuilder.CreateIndex(
                name: "UX_HousePlanAskOutcomes_Ask",
                schema: "subscriptions",
                table: "HousePlanAskOutcomes",
                columns: new[] { "TenantId", "AskId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_HousePlanAsks_AskedByUserId",
                schema: "subscriptions",
                table: "HousePlanAsks",
                column: "AskedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_HousePlanAsks_TenantId_ClientProfileId_AskedAtUtc",
                schema: "subscriptions",
                table: "HousePlanAsks",
                columns: new[] { "TenantId", "ClientProfileId", "AskedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_HousePlanAsks_TenantId_OfferId",
                schema: "subscriptions",
                table: "HousePlanAsks",
                columns: new[] { "TenantId", "OfferId" });

            migrationBuilder.CreateIndex(
                name: "IX_HousePlanAsks_TenantId_ProductId",
                schema: "subscriptions",
                table: "HousePlanAsks",
                columns: new[] { "TenantId", "ProductId" });

            migrationBuilder.CreateIndex(
                name: "IX_HousePlanTransfers_TenantId_ClientProfileId",
                schema: "subscriptions",
                table: "HousePlanTransfers",
                columns: new[] { "TenantId", "ClientProfileId" });

            migrationBuilder.CreateIndex(
                name: "UX_HousePlanTransfers_Ask",
                schema: "subscriptions",
                table: "HousePlanTransfers",
                columns: new[] { "TenantId", "AskId" },
                unique: true);

            // One paid plan of the house at a time per trainee (SUB-020), whatever features its option covers: the
            // GiST exclusion on coverage weighs a feature, this one the plan. A cancelled row frees its days, and Free,
            // which covers Training beside any plan, is not weighed.
            migrationBuilder.Sql(
                """
                ALTER TABLE subscriptions."ClientEnrollments"
                ADD CONSTRAINT "EX_ClientEnrollments_OneHousePaidPlanAtATime"
                EXCLUDE USING gist (
                    "TenantId" WITH =,
                    "ClientProfileId" WITH =,
                    (daterange("StartDate", "EndDateExclusive", '[)')) WITH &&)
                WHERE ("HouseTier" IN ('ProPlus', 'Max') AND "Status" <> 'Cancelled');
                """);

            // An ask is the house's alone, by one of its self-directed trainees, for an option of the plan and tier it
            // names; nothing about it is ever rewritten or deleted.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION subscriptions.guard_house_plan_ask()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $function$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM clients."ClientProfiles"
                        WHERE "TenantId" = NEW."TenantId" AND "Id" = NEW."ClientProfileId" AND "IsSelfDirected") THEN
                        RAISE EXCEPTION 'Only a self-directed trainee of the house asks for its plans' USING ERRCODE = '23514';
                    END IF;
                    IF NOT EXISTS (
                        SELECT 1
                        FROM subscriptions."ProductOffers" offer
                        JOIN subscriptions."CoachingProducts" product
                            ON product."TenantId" = offer."TenantId" AND product."Id" = offer."ProductId"
                        WHERE offer."TenantId" = NEW."TenantId" AND offer."Id" = NEW."OfferId"
                            AND product."Id" = NEW."ProductId" AND product."HouseTier" = NEW."Tier") THEN
                        RAISE EXCEPTION 'An ask names an option of the plan and the tier it asks for' USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER "TR_HousePlanAsks_House"
                BEFORE INSERT ON subscriptions."HousePlanAsks"
                FOR EACH ROW EXECUTE FUNCTION tenancy.assert_house_row();

                CREATE TRIGGER "TR_HousePlanAsks_Guard"
                BEFORE INSERT ON subscriptions."HousePlanAsks"
                FOR EACH ROW EXECUTE FUNCTION subscriptions.guard_house_plan_ask();

                CREATE TRIGGER "TR_HousePlanAsks_AppendOnly"
                BEFORE UPDATE OR DELETE ON subscriptions."HousePlanAsks"
                FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
                """);

            // A booked ask names its own trainee's plan of the option asked for and a receipt of that plan's whole
            // price in its currency (SUB-008: a part books nothing); a closed one its reason. Never rewritten.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION subscriptions.guard_house_plan_ask_outcome()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $function$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM subscriptions."HousePlanAsks"
                        WHERE "TenantId" = NEW."TenantId" AND "Id" = NEW."AskId" AND "ClientProfileId" = NEW."ClientProfileId") THEN
                        RAISE EXCEPTION 'An ask ends for its own trainee' USING ERRCODE = '23514';
                    END IF;
                    IF NEW."Kind" = 'Booked' AND NOT EXISTS (
                        SELECT 1
                        FROM subscriptions."ClientEnrollments" enrollment
                        JOIN subscriptions."HousePlanAsks" ask
                            ON ask."TenantId" = enrollment."TenantId" AND ask."Id" = NEW."AskId"
                        JOIN subscriptions."PaymentRecords" receipt
                            ON receipt."TenantId" = enrollment."TenantId" AND receipt."Id" = NEW."PaymentRecordId"
                            AND receipt."EnrollmentId" = enrollment."Id"
                        WHERE enrollment."TenantId" = NEW."TenantId" AND enrollment."Id" = NEW."EnrollmentId"
                            AND enrollment."ClientProfileId" = NEW."ClientProfileId"
                            AND enrollment."OfferId" = ask."OfferId"
                            AND enrollment."AssignmentCommandId" = NEW."CommandId"
                            AND receipt."IdempotencyKey" = NEW."CommandId"
                            AND receipt."Operation" = 'Receipt'
                            AND receipt."Amount" = enrollment."PriceAmount"
                            AND receipt."CurrencyCode" = enrollment."PriceCurrency") THEN
                        RAISE EXCEPTION 'A booked ask names its own plan and a receipt of that plan''s whole price' USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER "TR_HousePlanAskOutcomes_Guard"
                BEFORE INSERT ON subscriptions."HousePlanAskOutcomes"
                FOR EACH ROW EXECUTE FUNCTION subscriptions.guard_house_plan_ask_outcome();

                CREATE TRIGGER "TR_HousePlanAskOutcomes_AppendOnly"
                BEFORE UPDATE OR DELETE ON subscriptions."HousePlanAskOutcomes"
                FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
                """);

            // The trainee's word on the money belongs to their own ask. Its one change ever is closing the account
            // erasing the Whish details, once, with nothing else moving (CLI-027); it is never deleted.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION subscriptions.protect_house_plan_transfer()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $function$
                BEGIN
                    IF TG_OP = 'INSERT' THEN
                        IF NOT EXISTS (
                            SELECT 1 FROM subscriptions."HousePlanAsks"
                            WHERE "TenantId" = NEW."TenantId" AND "Id" = NEW."AskId" AND "ClientProfileId" = NEW."ClientProfileId") THEN
                            RAISE EXCEPTION 'The word on an ask''s money is its own trainee''s' USING ERRCODE = '23514';
                        END IF;
                        IF NEW."AnonymisedAtUtc" IS NOT NULL THEN
                            RAISE EXCEPTION 'The word on an ask''s money is kept with its details' USING ERRCODE = '23514';
                        END IF;
                        RETURN NEW;
                    END IF;
                    IF TG_OP = 'UPDATE'
                        AND OLD."AnonymisedAtUtc" IS NULL AND NEW."AnonymisedAtUtc" IS NOT NULL
                        AND NEW."WhishName" IS NULL AND NEW."WhishNumber" IS NULL
                        AND NEW."Id" = OLD."Id" AND NEW."TenantId" = OLD."TenantId"
                        AND NEW."AskId" = OLD."AskId" AND NEW."ClientProfileId" = OLD."ClientProfileId"
                        AND NEW."SentOn" = OLD."SentOn" AND NEW."SentAtUtc" = OLD."SentAtUtc"
                        AND NEW."CreatedAtUtc" = OLD."CreatedAtUtc"
                        AND NEW."CreatedByUserId" IS NOT DISTINCT FROM OLD."CreatedByUserId" THEN
                        RETURN NEW;
                    END IF;
                    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
                END;
                $function$;

                CREATE TRIGGER "TR_HousePlanTransfers_Protect"
                BEFORE INSERT OR UPDATE OR DELETE ON subscriptions."HousePlanTransfers"
                FOR EACH ROW EXECUTE FUNCTION subscriptions.protect_house_plan_transfer();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // An ask, a word on its money and a booking are a trainee's money history, and the notices about them are
            // kinds the schema before this cannot hold: stop with a plain message while any exists instead of dropping
            // them.
            migrationBuilder.Sql(
                """
                DO $migration$
                BEGIN
                    IF EXISTS (SELECT 1 FROM subscriptions."HousePlanAsks")
                        OR EXISTS (SELECT 1 FROM notifications."OutboxItems" WHERE "Kind" IN ('HousePlanAsked', 'HousePlanMoneySent')) THEN
                        RAISE EXCEPTION 'Trainees asked for the house''s plans; roll forward instead of reverting this migration.'
                            USING ERRCODE = '55000';
                    END IF;
                END;
                $migration$;
                """);

            migrationBuilder.Sql(
                """
                DROP FUNCTION IF EXISTS subscriptions.protect_house_plan_transfer() CASCADE;
                DROP FUNCTION IF EXISTS subscriptions.guard_house_plan_ask_outcome() CASCADE;
                DROP FUNCTION IF EXISTS subscriptions.guard_house_plan_ask() CASCADE;
                DROP TRIGGER IF EXISTS "TR_HousePlanAsks_House" ON subscriptions."HousePlanAsks";
                DROP TRIGGER IF EXISTS "TR_HousePlanAsks_AppendOnly" ON subscriptions."HousePlanAsks";
                DROP TRIGGER IF EXISTS "TR_HousePlanAskOutcomes_AppendOnly" ON subscriptions."HousePlanAskOutcomes";
                ALTER TABLE subscriptions."ClientEnrollments" DROP CONSTRAINT IF EXISTS "EX_ClientEnrollments_OneHousePaidPlanAtATime";
                """);

            migrationBuilder.DropTable(
                name: "HousePlanAskOutcomes",
                schema: "subscriptions");

            migrationBuilder.DropTable(
                name: "HousePlanTransfers",
                schema: "subscriptions");

            migrationBuilder.DropTable(
                name: "HousePlanAsks",
                schema: "subscriptions");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_PaymentRecords_TenantId_Id",
                schema: "subscriptions",
                table: "PaymentRecords");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NotificationOutboxItems_Vocabulary",
                schema: "notifications",
                table: "OutboxItems");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NotificationOutboxItems_Vocabulary",
                schema: "notifications",
                table: "OutboxItems",
                sql: "\"Status\" IN ('Scheduled', 'Cancelled') AND \"Purpose\" = 'ServiceTransactional' AND \"Kind\" IN ('PaymentRequired', 'EnrollmentActivated', 'EnrollmentEndingSoon', 'EnrollmentExpired', 'EnrollmentRenewed', 'CoachDeparted', 'ClientLeft', 'CoachResigned', 'RenewalRequested', 'ProgramAssigned', 'WeeksShared', 'WeeksChanged', 'CoachWorkoutNote', 'ClientWorkoutNote')");
        }
    }
}
