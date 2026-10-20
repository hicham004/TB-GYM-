using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class MoneyAndPlanGuards : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // BILL-4. Every version published from now on has at least one grace day. NOT VALID because
            // published versions are immutable: one published with 0 before keeps it, and the rule still
            // applies 1 for it (PaymentSchedule.ReadOnlyFrom).
            migrationBuilder.Sql("""
                ALTER TABLE billing."PricePlans"
                    ADD CONSTRAINT "CK_PricePlans_GraceDays" CHECK ("GraceDays" >= 1) NOT VALID;
                """);

            // SEC-5. A client's paid coverage rows were the one sibling of the enrollment snapshot without a
            // guard: deleting one freed dates the GiST constraint protects, re-dating one extended access with
            // no payment. They are never deleted, and the one change they take is cancelling their plan, which
            // releases the overlap lock (BlocksOverlap true to false) and stamps who and when.
            //
            // SEC-6. The intake change history (SYS-003) becomes append-only like every other history table.
            //
            // BILL-7. A new, renamed or restored plan for sale cannot take the name of another plan for sale in
            // the workspace, compared without case; plans that already share a name keep it until one is
            // renamed, so this is a trigger rather than a unique index. The advisory lock makes two saves of
            // one name wait for each other, and the check after it reads what the first one committed.
            migrationBuilder.Sql("""
                CREATE OR REPLACE FUNCTION subscriptions.protect_enrollment_entitlement()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $function$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Enrollment coverage is append-only' USING ERRCODE = '55000';
                    END IF;
                    IF NEW."Id" IS DISTINCT FROM OLD."Id"
                       OR NEW."TenantId" IS DISTINCT FROM OLD."TenantId"
                       OR NEW."EnrollmentId" IS DISTINCT FROM OLD."EnrollmentId"
                       OR NEW."ClientProfileId" IS DISTINCT FROM OLD."ClientProfileId"
                       OR NEW."StartDate" IS DISTINCT FROM OLD."StartDate"
                       OR NEW."EndDateExclusive" IS DISTINCT FROM OLD."EndDateExclusive"
                       OR NEW."Feature" IS DISTINCT FROM OLD."Feature"
                       OR NEW."CreatedAtUtc" IS DISTINCT FROM OLD."CreatedAtUtc"
                       OR NEW."CreatedByUserId" IS DISTINCT FROM OLD."CreatedByUserId"
                       OR (NEW."BlocksOverlap" AND NOT OLD."BlocksOverlap") THEN
                        RAISE EXCEPTION 'Enrollment coverage is append-only; cancelling its plan only releases the overlap lock' USING ERRCODE = '55000';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER "TR_EnrollmentEntitlements_Protect"
                BEFORE UPDATE OR DELETE ON subscriptions."EnrollmentEntitlements"
                FOR EACH ROW EXECUTE FUNCTION subscriptions.protect_enrollment_entitlement();

                CREATE TRIGGER "TR_ClientProfileChanges_AppendOnly"
                BEFORE UPDATE OR DELETE ON clients."ClientProfileChanges"
                FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

                CREATE OR REPLACE FUNCTION subscriptions.guard_product_name()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $function$
                BEGIN
                    IF NEW."IsActive" AND (
                        TG_OP = 'INSERT'
                        OR NOT OLD."IsActive"
                        OR NEW."Name" IS DISTINCT FROM OLD."Name") THEN
                        PERFORM pg_advisory_xact_lock(
                            hashtextextended('subscriptions.product-name:' || NEW."TenantId"::text || ':' || lower(NEW."Name"), 0));
                        IF EXISTS (
                            SELECT 1 FROM subscriptions."CoachingProducts"
                            WHERE "TenantId" = NEW."TenantId"
                              AND "Id" <> NEW."Id"
                              AND "IsActive"
                              AND lower("Name") = lower(NEW."Name")) THEN
                            RAISE EXCEPTION 'Another plan for sale in this workspace already has this name'
                                USING ERRCODE = '23505', CONSTRAINT = 'UX_CoachingProducts_ActiveName';
                        END IF;
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER "TR_CoachingProducts_ActiveName"
                BEFORE INSERT OR UPDATE OF "Name", "IsActive" ON subscriptions."CoachingProducts"
                FOR EACH ROW EXECUTE FUNCTION subscriptions.guard_product_name();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP TRIGGER IF EXISTS "TR_CoachingProducts_ActiveName" ON subscriptions."CoachingProducts";
                DROP FUNCTION IF EXISTS subscriptions.guard_product_name();
                DROP TRIGGER IF EXISTS "TR_ClientProfileChanges_AppendOnly" ON clients."ClientProfileChanges";
                DROP TRIGGER IF EXISTS "TR_EnrollmentEntitlements_Protect" ON subscriptions."EnrollmentEntitlements";
                DROP FUNCTION IF EXISTS subscriptions.protect_enrollment_entitlement();
                """);

            migrationBuilder.DropCheckConstraint(
                name: "CK_PricePlans_GraceDays",
                schema: "billing",
                table: "PricePlans");
        }
    }
}
