using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class PaymentReceivedOnGuard : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // PBL-007: a payment is dated the day the money arrived, from the day its invoice was issued up
            // to the day it is recorded (both UTC days). The guard already locks the invoice and checks the
            // amount; it now checks the date from the row's own RecordedAtUtc, so it never depends on the
            // clock of whoever inserts. Rows recorded before this are not re-checked.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION billing.guard_payment()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $function$
                DECLARE
                    invoice_total numeric(18, 2);
                    invoice_currency character(3);
                    invoice_issued timestamp with time zone;
                BEGIN
                    SELECT "Total", "CurrencyCode", "IssuedAtUtc" INTO invoice_total, invoice_currency, invoice_issued
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
                    IF NEW."ReceivedOn" < (invoice_issued AT TIME ZONE 'UTC')::date
                        OR NEW."ReceivedOn" > (NEW."RecordedAtUtc" AT TIME ZONE 'UTC')::date THEN
                        RAISE EXCEPTION 'A payment is dated from its invoice''s day up to the day it is recorded' USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END;
                $function$;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
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
                """);
        }
    }
}
