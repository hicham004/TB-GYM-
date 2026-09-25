using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ManualPlatformBilling : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_NoticeMailRequests_Vocabulary",
                schema: "tenancy",
                table: "NoticeMailRequests");

            migrationBuilder.EnsureSchema(
                name: "billing");

            migrationBuilder.CreateTable(
                name: "MembershipStatusChanges",
                schema: "tenancy",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    MembershipId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Role = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    ChangedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MembershipStatusChanges", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "PricePlans",
                schema: "billing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    VersionNumber = table.Column<int>(type: "integer", nullable: false),
                    CurrencyCode = table.Column<string>(type: "character(3)", fixedLength: true, maxLength: 3, nullable: false),
                    SeatPrice = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    IncludedClientsPerSeat = table.Column<int>(type: "integer", nullable: false),
                    ExtraClientPrice = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    GymFee = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    GymFeeMinimumSeats = table.Column<int>(type: "integer", nullable: false),
                    TrialDays = table.Column<int>(type: "integer", nullable: false),
                    PaymentTermDays = table.Column<int>(type: "integer", nullable: false),
                    GraceDays = table.Column<int>(type: "integer", nullable: false),
                    Note = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    PublishedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    PublishedByUserId = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PricePlans", x => x.Id);
                    table.CheckConstraint("CK_PricePlans_Counts", "\"IncludedClientsPerSeat\" >= 0 AND \"GymFeeMinimumSeats\" >= 1 AND \"TrialDays\" >= 0 AND \"PaymentTermDays\" >= 0 AND \"GraceDays\" >= 0");
                    table.CheckConstraint("CK_PricePlans_Currency", "\"CurrencyCode\" = 'USD'");
                    table.CheckConstraint("CK_PricePlans_Prices", "\"SeatPrice\" >= 0 AND \"ExtraClientPrice\" >= 0 AND \"GymFee\" >= 0");
                    table.CheckConstraint("CK_PricePlans_Version", "\"VersionNumber\" >= 1");
                });

            migrationBuilder.CreateTable(
                name: "WorkspaceDiscounts",
                schema: "billing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Percent = table.Column<decimal>(type: "numeric(5,2)", precision: 5, scale: 2, nullable: false),
                    StartsOn = table.Column<DateOnly>(type: "date", nullable: false),
                    EndsOnExclusive = table.Column<DateOnly>(type: "date", nullable: false),
                    Note = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    GrantedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    GrantedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    RevokedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    RevokedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WorkspaceDiscounts", x => x.Id);
                    table.UniqueConstraint("AK_WorkspaceDiscounts_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_WorkspaceDiscounts_Dates", "\"EndsOnExclusive\" > \"StartsOn\"");
                    table.CheckConstraint("CK_WorkspaceDiscounts_Percent", "\"Percent\" > 0 AND \"Percent\" <= 100");
                    table.CheckConstraint("CK_WorkspaceDiscounts_Revocation", "(\"RevokedAtUtc\" IS NULL) = (\"RevokedByUserId\" IS NULL)");
                    table.ForeignKey(
                        name: "FK_WorkspaceDiscounts_Tenants_TenantId",
                        column: x => x.TenantId,
                        principalSchema: "tenancy",
                        principalTable: "Tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Invoices",
                schema: "billing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PricePlanId = table.Column<Guid>(type: "uuid", nullable: false),
                    PricePlanVersion = table.Column<int>(type: "integer", nullable: false),
                    CalculationName = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    CurrencyCode = table.Column<string>(type: "character(3)", fixedLength: true, maxLength: 3, nullable: false),
                    PlanSeatPrice = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    PlanIncludedClientsPerSeat = table.Column<int>(type: "integer", nullable: false),
                    PlanExtraClientPrice = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    PlanGymFee = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    PlanGymFeeMinimumSeats = table.Column<int>(type: "integer", nullable: false),
                    PeriodStart = table.Column<DateOnly>(type: "date", nullable: false),
                    PeriodEndExclusive = table.Column<DateOnly>(type: "date", nullable: false),
                    UsageFromUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Seats = table.Column<int>(type: "integer", nullable: false),
                    BillableClients = table.Column<int>(type: "integer", nullable: false),
                    IncludedClients = table.Column<int>(type: "integer", nullable: false),
                    ExtraClients = table.Column<int>(type: "integer", nullable: false),
                    SeatAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    ExtraClientAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    GymFeeAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    Subtotal = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    DiscountId = table.Column<Guid>(type: "uuid", nullable: true),
                    DiscountPercent = table.Column<decimal>(type: "numeric(5,2)", precision: 5, scale: 2, nullable: false),
                    DiscountAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    Total = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    ReferenceCode = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    IssuedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    DueOn = table.Column<DateOnly>(type: "date", nullable: false),
                    ReadOnlyFrom = table.Column<DateOnly>(type: "date", nullable: false),
                    ReplacesInvoiceId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Invoices", x => x.Id);
                    table.UniqueConstraint("AK_Invoices_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_Invoices_Amounts", "\"SeatAmount\" >= 0 AND \"ExtraClientAmount\" >= 0 AND \"GymFeeAmount\" >= 0 AND \"DiscountAmount\" >= 0 AND \"Subtotal\" = \"SeatAmount\" + \"ExtraClientAmount\" + \"GymFeeAmount\" AND \"Total\" = \"Subtotal\" - \"DiscountAmount\" AND \"Total\" >= 0");
                    table.CheckConstraint("CK_Invoices_Currency", "\"CurrencyCode\" ~ '^[A-Z]{3}$'");
                    table.CheckConstraint("CK_Invoices_Dates", "\"DueOn\" >= (\"IssuedAtUtc\" AT TIME ZONE 'UTC')::date AND \"ReadOnlyFrom\" > \"DueOn\" AND \"IssuedAtUtc\" >= (\"PeriodEndExclusive\"::timestamp AT TIME ZONE 'UTC')");
                    table.CheckConstraint("CK_Invoices_Discount", "\"DiscountPercent\" >= 0 AND \"DiscountPercent\" <= 100");
                    table.CheckConstraint("CK_Invoices_Period", "EXTRACT(DAY FROM \"PeriodStart\") = 1 AND \"PeriodEndExclusive\" = (\"PeriodStart\" + INTERVAL '1 month')::date");
                    table.CheckConstraint("CK_Invoices_Quantities", "\"Seats\" >= 1 AND \"BillableClients\" >= 0 AND \"IncludedClients\" = \"Seats\" * \"PlanIncludedClientsPerSeat\" AND \"ExtraClients\" = GREATEST(0, \"BillableClients\" - \"IncludedClients\")");
                    table.ForeignKey(
                        name: "FK_Invoices_PricePlans_PricePlanId",
                        column: x => x.PricePlanId,
                        principalSchema: "billing",
                        principalTable: "PricePlans",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Invoices_Tenants_TenantId",
                        column: x => x.TenantId,
                        principalSchema: "tenancy",
                        principalTable: "Tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "InvoiceVoids",
                schema: "billing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    InvoiceId = table.Column<Guid>(type: "uuid", nullable: false),
                    Reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    VoidedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    VoidedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InvoiceVoids", x => x.Id);
                    table.UniqueConstraint("AK_InvoiceVoids_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.UniqueConstraint("AK_InvoiceVoids_TenantId_InvoiceId", x => new { x.TenantId, x.InvoiceId });
                    table.ForeignKey(
                        name: "FK_InvoiceVoids_Invoices_TenantId_InvoiceId",
                        columns: x => new { x.TenantId, x.InvoiceId },
                        principalSchema: "billing",
                        principalTable: "Invoices",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Payments",
                schema: "billing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    InvoiceId = table.Column<Guid>(type: "uuid", nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    CurrencyCode = table.Column<string>(type: "character(3)", fixedLength: true, maxLength: 3, nullable: false),
                    Reference = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Note = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    ReceivedOn = table.Column<DateOnly>(type: "date", nullable: false),
                    RecordedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    RecordedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Payments", x => x.Id);
                    table.UniqueConstraint("AK_Payments_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_Payments_Amount", "\"Amount\" > 0");
                    table.ForeignKey(
                        name: "FK_Payments_Invoices_TenantId_InvoiceId",
                        columns: x => new { x.TenantId, x.InvoiceId },
                        principalSchema: "billing",
                        principalTable: "Invoices",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.AddCheckConstraint(
                name: "CK_NoticeMailRequests_Vocabulary",
                schema: "tenancy",
                table: "NoticeMailRequests",
                sql: "\"Kind\" IN ('ClientReleased', 'CoachDeparted', 'InvoiceIssued', 'InvoiceDueSoon', 'InvoiceOverdue') AND \"Status\" IN ('Pending', 'Processing', 'Materialized', 'Suppressed', 'DeadLettered')");

            migrationBuilder.CreateIndex(
                name: "IX_Invoices_PricePlanId",
                schema: "billing",
                table: "Invoices",
                column: "PricePlanId");

            migrationBuilder.CreateIndex(
                name: "IX_Invoices_ReferenceCode",
                schema: "billing",
                table: "Invoices",
                column: "ReferenceCode",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Invoices_TenantId_PeriodStart_Original",
                schema: "billing",
                table: "Invoices",
                columns: new[] { "TenantId", "PeriodStart" },
                unique: true,
                filter: "\"ReplacesInvoiceId\" IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Invoices_TenantId_ReadOnlyFrom",
                schema: "billing",
                table: "Invoices",
                columns: new[] { "TenantId", "ReadOnlyFrom" });

            migrationBuilder.CreateIndex(
                name: "IX_Invoices_TenantId_ReplacesInvoiceId",
                schema: "billing",
                table: "Invoices",
                columns: new[] { "TenantId", "ReplacesInvoiceId" },
                unique: true,
                filter: "\"ReplacesInvoiceId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_MembershipStatusChanges_TenantId_MembershipId_ChangedAtUtc",
                schema: "tenancy",
                table: "MembershipStatusChanges",
                columns: new[] { "TenantId", "MembershipId", "ChangedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_Payments_TenantId_InvoiceId",
                schema: "billing",
                table: "Payments",
                columns: new[] { "TenantId", "InvoiceId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PricePlans_VersionNumber",
                schema: "billing",
                table: "PricePlans",
                column: "VersionNumber",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_WorkspaceDiscounts_TenantId_StartsOn",
                schema: "billing",
                table: "WorkspaceDiscounts",
                columns: new[] { "TenantId", "StartsOn" });

            migrationBuilder.AddForeignKey(
                name: "FK_Invoices_InvoiceVoids_TenantId_ReplacesInvoiceId",
                schema: "billing",
                table: "Invoices",
                columns: new[] { "TenantId", "ReplacesInvoiceId" },
                principalSchema: "billing",
                principalTable: "InvoiceVoids",
                principalColumns: new[] { "TenantId", "InvoiceId" },
                onDelete: ReferentialAction.Restrict);

            // ADR 0028. Membership history: a row per insert and per status change, written here so no
            // code path can forget it. The time is the row's own audit stamp (the application clock), or
            // the transaction time for a raw update that did not touch it. Existing memberships are
            // backfilled from their created and last-updated times, the best record there is.
            migrationBuilder.Sql(
                """
                INSERT INTO tenancy."MembershipStatusChanges"
                    ("Id", "TenantId", "MembershipId", "UserId", "Role", "Status", "ChangedAtUtc")
                SELECT uuidv7(), m."TenantId", m."Id", m."UserId", m."Role", 'Active', m."CreatedAtUtc"
                FROM tenancy."Memberships" m;

                INSERT INTO tenancy."MembershipStatusChanges"
                    ("Id", "TenantId", "MembershipId", "UserId", "Role", "Status", "ChangedAtUtc")
                SELECT uuidv7(), m."TenantId", m."Id", m."UserId", m."Role", m."Status",
                       GREATEST(m."UpdatedAtUtc", m."CreatedAtUtc")
                FROM tenancy."Memberships" m
                WHERE m."Status" <> 'Active';

                CREATE OR REPLACE FUNCTION tenancy.record_membership_status()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $function$
                BEGIN
                    IF TG_OP = 'INSERT' OR NEW."Status" IS DISTINCT FROM OLD."Status" THEN
                        INSERT INTO tenancy."MembershipStatusChanges"
                            ("Id", "TenantId", "MembershipId", "UserId", "Role", "Status", "ChangedAtUtc")
                        VALUES (
                            uuidv7(), NEW."TenantId", NEW."Id", NEW."UserId", NEW."Role", NEW."Status",
                            CASE
                                WHEN TG_OP = 'INSERT' THEN NEW."CreatedAtUtc"
                                WHEN NEW."UpdatedAtUtc" IS DISTINCT FROM OLD."UpdatedAtUtc" THEN NEW."UpdatedAtUtc"
                                ELSE now()
                            END);
                    END IF;
                    RETURN NULL;
                END;
                $function$;

                CREATE TRIGGER "TR_Memberships_RecordStatus"
                AFTER INSERT OR UPDATE OF "Status" ON tenancy."Memberships"
                FOR EACH ROW EXECUTE FUNCTION tenancy.record_membership_status();

                CREATE TRIGGER "TR_MembershipStatusChanges_AppendOnly"
                BEFORE UPDATE OR DELETE ON tenancy."MembershipStatusChanges"
                FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

                CREATE TRIGGER "TR_PricePlans_AppendOnly"
                BEFORE UPDATE OR DELETE ON billing."PricePlans"
                FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

                CREATE TRIGGER "TR_Invoices_AppendOnly"
                BEFORE UPDATE OR DELETE ON billing."Invoices"
                FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

                CREATE TRIGGER "TR_InvoiceVoids_AppendOnly"
                BEFORE UPDATE OR DELETE ON billing."InvoiceVoids"
                FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

                CREATE TRIGGER "TR_Payments_AppendOnly"
                BEFORE UPDATE OR DELETE ON billing."Payments"
                FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

                -- A payment and a void of the same invoice each lock the invoice row first, so one of
                -- them always sees the other: a voided invoice is never paid, a paid one never voided.
                CREATE OR REPLACE FUNCTION billing.guard_payment()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $function$
                DECLARE
                    invoice_total numeric(18, 2);
                    invoice_currency character(3);
                BEGIN
                    SELECT "Total", "CurrencyCode" INTO invoice_total, invoice_currency
                    FROM billing."Invoices"
                    WHERE "TenantId" = NEW."TenantId" AND "Id" = NEW."InvoiceId"
                    FOR UPDATE;
                    IF NOT FOUND THEN
                        RAISE EXCEPTION 'A payment needs an invoice in the same workspace' USING ERRCODE = '23503';
                    END IF;
                    IF EXISTS (
                        SELECT 1 FROM billing."InvoiceVoids"
                        WHERE "TenantId" = NEW."TenantId" AND "InvoiceId" = NEW."InvoiceId") THEN
                        RAISE EXCEPTION 'A voided invoice cannot be paid' USING ERRCODE = '23514';
                    END IF;
                    IF NEW."Amount" <> invoice_total OR NEW."CurrencyCode" <> invoice_currency THEN
                        RAISE EXCEPTION 'A payment must be exactly the invoice total' USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER "TR_Payments_Guard"
                BEFORE INSERT ON billing."Payments"
                FOR EACH ROW EXECUTE FUNCTION billing.guard_payment();

                CREATE OR REPLACE FUNCTION billing.guard_invoice_void()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $function$
                BEGIN
                    PERFORM 1 FROM billing."Invoices"
                    WHERE "TenantId" = NEW."TenantId" AND "Id" = NEW."InvoiceId"
                    FOR UPDATE;
                    IF EXISTS (
                        SELECT 1 FROM billing."Payments"
                        WHERE "TenantId" = NEW."TenantId" AND "InvoiceId" = NEW."InvoiceId") THEN
                        RAISE EXCEPTION 'A paid invoice cannot be voided' USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER "TR_InvoiceVoids_Guard"
                BEFORE INSERT ON billing."InvoiceVoids"
                FOR EACH ROW EXECUTE FUNCTION billing.guard_invoice_void();

                -- A discount is never edited or deleted; it can be revoked once, and the revocation is
                -- what takes it out of the overlap constraint below.
                CREATE OR REPLACE FUNCTION billing.protect_workspace_discount()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $function$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Workspace discounts are never deleted' USING ERRCODE = '55000';
                    END IF;
                    IF OLD."RevokedAtUtc" IS NOT NULL
                        OR NEW."RevokedAtUtc" IS NULL
                        OR NEW."TenantId" IS DISTINCT FROM OLD."TenantId"
                        OR NEW."Percent" IS DISTINCT FROM OLD."Percent"
                        OR NEW."StartsOn" IS DISTINCT FROM OLD."StartsOn"
                        OR NEW."EndsOnExclusive" IS DISTINCT FROM OLD."EndsOnExclusive"
                        OR NEW."Note" IS DISTINCT FROM OLD."Note"
                        OR NEW."GrantedAtUtc" IS DISTINCT FROM OLD."GrantedAtUtc"
                        OR NEW."GrantedByUserId" IS DISTINCT FROM OLD."GrantedByUserId" THEN
                        RAISE EXCEPTION 'A workspace discount can only be revoked, once' USING ERRCODE = '55000';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER "TR_WorkspaceDiscounts_Protect"
                BEFORE UPDATE OR DELETE ON billing."WorkspaceDiscounts"
                FOR EACH ROW EXECUTE FUNCTION billing.protect_workspace_discount();

                ALTER TABLE billing."WorkspaceDiscounts"
                ADD CONSTRAINT "EX_WorkspaceDiscounts_NoOverlap"
                EXCLUDE USING gist
                (
                    "TenantId" WITH =,
                    (daterange("StartsOn", "EndsOnExclusive", '[)')) WITH &&
                )
                WHERE ("RevokedAtUtc" IS NULL);

                -- The first price plan. Every number is a placeholder the product owner has not decided;
                -- the platform admin publishes a new version to change them.
                INSERT INTO billing."PricePlans"
                    ("Id", "VersionNumber", "CurrencyCode", "SeatPrice", "IncludedClientsPerSeat",
                     "ExtraClientPrice", "GymFee", "GymFeeMinimumSeats", "TrialDays", "PaymentTermDays",
                     "GraceDays", "Note", "PublishedAtUtc", "PublishedByUserId")
                VALUES
                    (uuidv7(), 1, 'USD', 15.00, 5, 2.00, 10.00, 2, 30, 7, 7,
                     'Placeholder launch prices (ADR 0028). Publish a new version to change them.', now(), NULL);
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                DROP TRIGGER IF EXISTS "TR_Memberships_RecordStatus" ON tenancy."Memberships";
                DROP FUNCTION IF EXISTS tenancy.record_membership_status();
                DROP FUNCTION IF EXISTS billing.guard_payment() CASCADE;
                DROP FUNCTION IF EXISTS billing.guard_invoice_void() CASCADE;
                DROP FUNCTION IF EXISTS billing.protect_workspace_discount() CASCADE;
                """);

            migrationBuilder.DropForeignKey(
                name: "FK_Invoices_InvoiceVoids_TenantId_ReplacesInvoiceId",
                schema: "billing",
                table: "Invoices");

            migrationBuilder.DropTable(
                name: "MembershipStatusChanges",
                schema: "tenancy");

            migrationBuilder.DropTable(
                name: "Payments",
                schema: "billing");

            migrationBuilder.DropTable(
                name: "WorkspaceDiscounts",
                schema: "billing");

            migrationBuilder.DropTable(
                name: "InvoiceVoids",
                schema: "billing");

            migrationBuilder.DropTable(
                name: "Invoices",
                schema: "billing");

            migrationBuilder.DropTable(
                name: "PricePlans",
                schema: "billing");

            migrationBuilder.DropCheckConstraint(
                name: "CK_NoticeMailRequests_Vocabulary",
                schema: "tenancy",
                table: "NoticeMailRequests");

            migrationBuilder.AddCheckConstraint(
                name: "CK_NoticeMailRequests_Vocabulary",
                schema: "tenancy",
                table: "NoticeMailRequests",
                sql: "\"Kind\" IN ('ClientReleased', 'CoachDeparted') AND \"Status\" IN ('Pending', 'Processing', 'Materialized', 'Suppressed', 'DeadLettered')");
        }
    }
}
