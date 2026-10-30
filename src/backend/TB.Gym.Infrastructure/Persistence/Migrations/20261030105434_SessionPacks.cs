using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class SessionPacks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_ProductOffers_ActiveDurationCurrency",
                schema: "subscriptions",
                table: "ProductOffers");

            migrationBuilder.AddColumn<int>(
                name: "SessionCount",
                schema: "subscriptions",
                table: "ProductOffers",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Kind",
                schema: "subscriptions",
                table: "CoachingProducts",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                defaultValue: "CoachingPlan");

            migrationBuilder.AddColumn<int>(
                name: "SessionCountSnapshot",
                schema: "subscriptions",
                table: "ClientEnrollments",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "SessionLedgerEntries",
                schema: "subscriptions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    EnrollmentId = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientProfileId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Count = table.Column<int>(type: "integer", nullable: false),
                    Day = table.Column<DateOnly>(type: "date", nullable: false),
                    CoachUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    Note = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    Reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    VoidsEntryId = table.Column<Guid>(type: "uuid", nullable: true),
                    IdempotencyKey = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SessionLedgerEntries", x => x.Id);
                    table.UniqueConstraint("AK_SessionLedgerEntries_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_SessionLedgerEntries_Coach", "(\"Kind\" IN ('Held', 'Charged')) = (\"CoachUserId\" IS NOT NULL)");
                    table.CheckConstraint("CK_SessionLedgerEntries_Count", "(\"Kind\" = 'Issued' AND \"Count\" BETWEEN 1 AND 100) OR (\"Kind\" <> 'Issued' AND \"Count\" = 1)");
                    table.CheckConstraint("CK_SessionLedgerEntries_Note", "\"Kind\" = 'Held' OR \"Note\" IS NULL");
                    table.CheckConstraint("CK_SessionLedgerEntries_Reason", "(\"Kind\" = 'Charged') = (\"Reason\" IS NOT NULL)");
                    table.CheckConstraint("CK_SessionLedgerEntries_Voids", "(\"Kind\" = 'Voided') = (\"VoidsEntryId\" IS NOT NULL)");
                    table.ForeignKey(
                        name: "FK_SessionLedgerEntries_ClientEnrollments_TenantId_EnrollmentId",
                        columns: x => new { x.TenantId, x.EnrollmentId },
                        principalSchema: "subscriptions",
                        principalTable: "ClientEnrollments",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SessionLedgerEntries_ClientProfiles_TenantId_ClientProfileId",
                        columns: x => new { x.TenantId, x.ClientProfileId },
                        principalSchema: "clients",
                        principalTable: "ClientProfiles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SessionLedgerEntries_Memberships_TenantId_CoachUserId",
                        columns: x => new { x.TenantId, x.CoachUserId },
                        principalSchema: "tenancy",
                        principalTable: "Memberships",
                        principalColumns: new[] { "TenantId", "UserId" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SessionLedgerEntries_SessionLedgerEntries_TenantId_VoidsEnt~",
                        columns: x => new { x.TenantId, x.VoidsEntryId },
                        principalSchema: "subscriptions",
                        principalTable: "SessionLedgerEntries",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ProductOffers_ActiveDurationCurrency",
                schema: "subscriptions",
                table: "ProductOffers",
                columns: new[] { "TenantId", "ProductId", "SessionCount", "DurationCount", "DurationUnit", "PriceCurrency" },
                unique: true,
                filter: "\"IsActive\"")
                .Annotation("Npgsql:NullsDistinct", false);

            migrationBuilder.AddCheckConstraint(
                name: "CK_ProductOffers_SessionCount",
                schema: "subscriptions",
                table: "ProductOffers",
                sql: "\"SessionCount\" IS NULL OR \"SessionCount\" BETWEEN 1 AND 100");

            migrationBuilder.AddCheckConstraint(
                name: "CK_ClientEnrollments_SessionCountSnapshot",
                schema: "subscriptions",
                table: "ClientEnrollments",
                sql: "\"SessionCountSnapshot\" IS NULL OR \"SessionCountSnapshot\" BETWEEN 1 AND 100");

            migrationBuilder.CreateIndex(
                name: "IX_SessionLedgerEntries_TenantId_ClientProfileId_Day",
                schema: "subscriptions",
                table: "SessionLedgerEntries",
                columns: new[] { "TenantId", "ClientProfileId", "Day" });

            migrationBuilder.CreateIndex(
                name: "IX_SessionLedgerEntries_TenantId_CoachUserId_Day",
                schema: "subscriptions",
                table: "SessionLedgerEntries",
                columns: new[] { "TenantId", "CoachUserId", "Day" });

            migrationBuilder.CreateIndex(
                name: "IX_SessionLedgerEntries_TenantId_EnrollmentId_Day",
                schema: "subscriptions",
                table: "SessionLedgerEntries",
                columns: new[] { "TenantId", "EnrollmentId", "Day" });

            migrationBuilder.CreateIndex(
                name: "IX_SessionLedgerEntries_TenantId_IdempotencyKey",
                schema: "subscriptions",
                table: "SessionLedgerEntries",
                columns: new[] { "TenantId", "IdempotencyKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "UX_SessionLedgerEntries_OneIssuedPerPack",
                schema: "subscriptions",
                table: "SessionLedgerEntries",
                columns: new[] { "TenantId", "EnrollmentId" },
                unique: true,
                filter: "\"Kind\" = 'Issued'");

            migrationBuilder.CreateIndex(
                name: "UX_SessionLedgerEntries_OneVoidPerEntry",
                schema: "subscriptions",
                table: "SessionLedgerEntries",
                columns: new[] { "TenantId", "VoidsEntryId" },
                unique: true,
                filter: "\"VoidsEntryId\" IS NOT NULL");

            // SES-001, SES-002. An option's count is one of its terms and a pack's is part of its snapshot, as
            // immutable as their price (ADR 0005), and a plan never changes kind.
            //
            // SES-003. The ledger is append-only like PaymentRecords. The guard holds the rules a session must
            // meet past the service, against any writer: it locks the pack, so two last sessions wait for each
            // other, and counts what is left after the first one committed. Its refusals are check violations.
            migrationBuilder.Sql("""
                CREATE OR REPLACE FUNCTION subscriptions.protect_offer_terms()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $function$
                BEGIN
                    IF NEW."ProductId" IS DISTINCT FROM OLD."ProductId"
                       OR NEW."Label" IS DISTINCT FROM OLD."Label"
                       OR NEW."BillingModel" IS DISTINCT FROM OLD."BillingModel"
                       OR NEW."DurationCount" IS DISTINCT FROM OLD."DurationCount"
                       OR NEW."DurationUnit" IS DISTINCT FROM OLD."DurationUnit"
                       OR NEW."PriceAmount" IS DISTINCT FROM OLD."PriceAmount"
                       OR NEW."PriceCurrency" IS DISTINCT FROM OLD."PriceCurrency"
                       OR NEW."SessionCount" IS DISTINCT FROM OLD."SessionCount"
                       OR NEW."TenantId" IS DISTINCT FROM OLD."TenantId" THEN
                        RAISE EXCEPTION 'Published offer terms are immutable; create a new offer' USING ERRCODE = '55000';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE OR REPLACE FUNCTION subscriptions.protect_enrollment_snapshot()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $function$
                BEGIN
                    IF NEW."ClientProfileId" IS DISTINCT FROM OLD."ClientProfileId"
                       OR NEW."ProductId" IS DISTINCT FROM OLD."ProductId"
                       OR NEW."OfferId" IS DISTINCT FROM OLD."OfferId"
                       OR NEW."ProductNameSnapshot" IS DISTINCT FROM OLD."ProductNameSnapshot"
                       OR NEW."OfferLabelSnapshot" IS DISTINCT FROM OLD."OfferLabelSnapshot"
                       OR NEW."PriceAmount" IS DISTINCT FROM OLD."PriceAmount"
                       OR NEW."PriceCurrency" IS DISTINCT FROM OLD."PriceCurrency"
                       OR NEW."SessionCountSnapshot" IS DISTINCT FROM OLD."SessionCountSnapshot"
                       OR NEW."StartDate" IS DISTINCT FROM OLD."StartDate"
                       OR NEW."EndDateExclusive" IS DISTINCT FROM OLD."EndDateExclusive"
                       OR NEW."AssignmentCommandId" IS DISTINCT FROM OLD."AssignmentCommandId"
                       OR NEW."RenewedFromEnrollmentId" IS DISTINCT FROM OLD."RenewedFromEnrollmentId"
                       OR NEW."TenantId" IS DISTINCT FROM OLD."TenantId" THEN
                        RAISE EXCEPTION 'Enrollment commercial snapshots are immutable' USING ERRCODE = '55000';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE OR REPLACE FUNCTION subscriptions.protect_product_kind()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $function$
                BEGIN
                    IF NEW."Kind" IS DISTINCT FROM OLD."Kind" THEN
                        RAISE EXCEPTION 'A plan never changes kind' USING ERRCODE = '55000';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER "TR_CoachingProducts_ProtectKind"
                BEFORE UPDATE OF "Kind" ON subscriptions."CoachingProducts"
                FOR EACH ROW EXECUTE FUNCTION subscriptions.protect_product_kind();

                CREATE TRIGGER "TR_SessionLedgerEntries_AppendOnly"
                BEFORE UPDATE OR DELETE ON subscriptions."SessionLedgerEntries"
                FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

                CREATE OR REPLACE FUNCTION subscriptions.guard_session_entry()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $function$
                DECLARE
                    pack RECORD;
                    sessions_left integer;
                BEGIN
                    SELECT "ClientProfileId", "SessionCountSnapshot", "StartDate", "EndDateExclusive", "Status"
                    INTO pack
                    FROM subscriptions."ClientEnrollments"
                    WHERE "TenantId" = NEW."TenantId" AND "Id" = NEW."EnrollmentId"
                    FOR UPDATE;

                    IF NOT FOUND
                       OR pack."SessionCountSnapshot" IS NULL
                       OR pack."ClientProfileId" IS DISTINCT FROM NEW."ClientProfileId" THEN
                        RAISE EXCEPTION 'A session entry belongs to a session pack of its client' USING ERRCODE = '23514';
                    END IF;

                    IF NEW."Kind" = 'Issued' THEN
                        IF NEW."Count" <> pack."SessionCountSnapshot" THEN
                            RAISE EXCEPTION 'A pack issues the sessions it was sold with' USING ERRCODE = '23514';
                        END IF;
                    ELSIF NEW."Kind" = 'Voided' THEN
                        IF NOT EXISTS (
                            SELECT 1 FROM subscriptions."SessionLedgerEntries"
                            WHERE "TenantId" = NEW."TenantId"
                              AND "Id" = NEW."VoidsEntryId"
                              AND "EnrollmentId" = NEW."EnrollmentId"
                              AND "Kind" IN ('Held', 'Charged')) THEN
                            RAISE EXCEPTION 'A correction undoes a session held or charged on the same pack' USING ERRCODE = '23514';
                        END IF;
                    ELSE
                        IF pack."Status" NOT IN ('Active', 'Expired')
                           OR NEW."Day" < pack."StartDate"
                           OR NEW."Day" >= pack."EndDateExclusive" THEN
                            RAISE EXCEPTION 'A session goes on a paid pack, inside its dates' USING ERRCODE = '23514';
                        END IF;

                        SELECT COALESCE(SUM(CASE WHEN "Kind" IN ('Issued', 'Voided') THEN "Count" ELSE -"Count" END), 0)
                        INTO sessions_left
                        FROM subscriptions."SessionLedgerEntries"
                        WHERE "TenantId" = NEW."TenantId" AND "EnrollmentId" = NEW."EnrollmentId";

                        IF sessions_left < 1 THEN
                            RAISE EXCEPTION 'This pack has no sessions left' USING ERRCODE = '23514';
                        END IF;
                    END IF;

                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER "TR_SessionLedgerEntries_Guard"
                BEFORE INSERT ON subscriptions."SessionLedgerEntries"
                FOR EACH ROW EXECUTE FUNCTION subscriptions.guard_session_entry();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP TRIGGER IF EXISTS "TR_SessionLedgerEntries_Guard" ON subscriptions."SessionLedgerEntries";
                DROP FUNCTION IF EXISTS subscriptions.guard_session_entry();
                DROP TRIGGER IF EXISTS "TR_SessionLedgerEntries_AppendOnly" ON subscriptions."SessionLedgerEntries";
                DROP TRIGGER IF EXISTS "TR_CoachingProducts_ProtectKind" ON subscriptions."CoachingProducts";
                DROP FUNCTION IF EXISTS subscriptions.protect_product_kind();

                CREATE OR REPLACE FUNCTION subscriptions.protect_enrollment_snapshot()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $function$
                BEGIN
                    IF NEW."ClientProfileId" IS DISTINCT FROM OLD."ClientProfileId"
                       OR NEW."ProductId" IS DISTINCT FROM OLD."ProductId"
                       OR NEW."OfferId" IS DISTINCT FROM OLD."OfferId"
                       OR NEW."ProductNameSnapshot" IS DISTINCT FROM OLD."ProductNameSnapshot"
                       OR NEW."OfferLabelSnapshot" IS DISTINCT FROM OLD."OfferLabelSnapshot"
                       OR NEW."PriceAmount" IS DISTINCT FROM OLD."PriceAmount"
                       OR NEW."PriceCurrency" IS DISTINCT FROM OLD."PriceCurrency"
                       OR NEW."StartDate" IS DISTINCT FROM OLD."StartDate"
                       OR NEW."EndDateExclusive" IS DISTINCT FROM OLD."EndDateExclusive"
                       OR NEW."AssignmentCommandId" IS DISTINCT FROM OLD."AssignmentCommandId"
                       OR NEW."RenewedFromEnrollmentId" IS DISTINCT FROM OLD."RenewedFromEnrollmentId"
                       OR NEW."TenantId" IS DISTINCT FROM OLD."TenantId" THEN
                        RAISE EXCEPTION 'Enrollment commercial snapshots are immutable' USING ERRCODE = '55000';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE OR REPLACE FUNCTION subscriptions.protect_offer_terms()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $function$
                BEGIN
                    IF NEW."ProductId" IS DISTINCT FROM OLD."ProductId"
                       OR NEW."Label" IS DISTINCT FROM OLD."Label"
                       OR NEW."BillingModel" IS DISTINCT FROM OLD."BillingModel"
                       OR NEW."DurationCount" IS DISTINCT FROM OLD."DurationCount"
                       OR NEW."DurationUnit" IS DISTINCT FROM OLD."DurationUnit"
                       OR NEW."PriceAmount" IS DISTINCT FROM OLD."PriceAmount"
                       OR NEW."PriceCurrency" IS DISTINCT FROM OLD."PriceCurrency"
                       OR NEW."TenantId" IS DISTINCT FROM OLD."TenantId" THEN
                        RAISE EXCEPTION 'Published offer terms are immutable; create a new offer' USING ERRCODE = '55000';
                    END IF;
                    RETURN NEW;
                END;
                $function$;
                """);

            migrationBuilder.DropTable(
                name: "SessionLedgerEntries",
                schema: "subscriptions");

            migrationBuilder.DropIndex(
                name: "IX_ProductOffers_ActiveDurationCurrency",
                schema: "subscriptions",
                table: "ProductOffers");

            migrationBuilder.DropCheckConstraint(
                name: "CK_ProductOffers_SessionCount",
                schema: "subscriptions",
                table: "ProductOffers");

            migrationBuilder.DropCheckConstraint(
                name: "CK_ClientEnrollments_SessionCountSnapshot",
                schema: "subscriptions",
                table: "ClientEnrollments");

            migrationBuilder.DropColumn(
                name: "SessionCount",
                schema: "subscriptions",
                table: "ProductOffers");

            migrationBuilder.DropColumn(
                name: "Kind",
                schema: "subscriptions",
                table: "CoachingProducts");

            migrationBuilder.DropColumn(
                name: "SessionCountSnapshot",
                schema: "subscriptions",
                table: "ClientEnrollments");

            migrationBuilder.CreateIndex(
                name: "IX_ProductOffers_ActiveDurationCurrency",
                schema: "subscriptions",
                table: "ProductOffers",
                columns: new[] { "TenantId", "ProductId", "DurationCount", "DurationUnit", "PriceCurrency" },
                unique: true,
                filter: "\"IsActive\"");
        }
    }
}
