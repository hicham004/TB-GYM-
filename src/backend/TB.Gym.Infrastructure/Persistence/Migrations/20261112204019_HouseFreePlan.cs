using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Notes plan N9b1 (SUB-019): the house's tiers on its plans and on each enrollment of them, one Free plan in the
    /// house, and a trainee's Free rows that never overlap. Every guard is the database's, whoever writes.
    /// </summary>
    public partial class HouseFreePlan : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "HouseTier",
                schema: "subscriptions",
                table: "CoachingProducts",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "HouseTier",
                schema: "subscriptions",
                table: "ClientEnrollments",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "UX_CoachingProducts_OneHouseFree",
                schema: "subscriptions",
                table: "CoachingProducts",
                column: "TenantId",
                unique: true,
                filter: "\"HouseTier\" = 'Free'");

            migrationBuilder.AddCheckConstraint(
                name: "CK_CoachingProducts_HouseTier",
                schema: "subscriptions",
                table: "CoachingProducts",
                sql: "\"HouseTier\" IS NULL OR (\"HouseTier\" IN ('Free', 'ProPlus', 'Max') AND \"Kind\" = 'CoachingPlan')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_ClientEnrollments_HouseTier",
                schema: "subscriptions",
                table: "ClientEnrollments",
                sql: "\"HouseTier\" IS NULL OR \"HouseTier\" IN ('Free', 'ProPlus', 'Max')");

            // A trainee's Free rows follow one another and never overlap (SUB-019). The GiST exclusion on coverage
            // cannot say it, since Free covers Training beside any plan, so two starts or two renewals of one row
            // that race leave one. A row cancelled when the relationship ended frees its days.
            migrationBuilder.Sql(
                """
                ALTER TABLE subscriptions."ClientEnrollments"
                ADD CONSTRAINT "EX_ClientEnrollments_OneHouseFreeAtATime"
                EXCLUDE USING gist (
                    "TenantId" WITH =,
                    "ClientProfileId" WITH =,
                    (daterange("StartDate", "EndDateExclusive", '[)')) WITH &&)
                WHERE ("HouseTier" = 'Free' AND "Status" <> 'Cancelled');
                """);

            // A tier is the house's alone and never changes: a plan's is named when it is made, in the house; an
            // enrollment's is its plan's, copied when it is booked. Each guard reads the mark with a share lock on the
            // workspace's row, as the house's own guards do (ADR 0041).
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION subscriptions.guard_product_house_tier()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $function$
                BEGIN
                    IF TG_OP = 'UPDATE' THEN
                        IF NEW."HouseTier" IS DISTINCT FROM OLD."HouseTier" THEN
                            RAISE EXCEPTION 'A plan''s tier never changes' USING ERRCODE = '55000';
                        END IF;
                        RETURN NEW;
                    END IF;
                    IF NEW."HouseTier" IS NOT NULL AND NOT EXISTS (
                        SELECT 1 FROM tenancy."Tenants"
                        WHERE "Id" = NEW."TenantId" AND "IsHouse"
                        FOR SHARE) THEN
                        RAISE EXCEPTION 'Only the house sells plans with a tier' USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER "TR_CoachingProducts_HouseTier"
                BEFORE INSERT OR UPDATE OF "HouseTier" ON subscriptions."CoachingProducts"
                FOR EACH ROW EXECUTE FUNCTION subscriptions.guard_product_house_tier();

                CREATE OR REPLACE FUNCTION subscriptions.guard_enrollment_house_tier()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $function$
                BEGIN
                    IF TG_OP = 'UPDATE' THEN
                        IF NEW."HouseTier" IS DISTINCT FROM OLD."HouseTier" THEN
                            RAISE EXCEPTION 'Enrollment commercial snapshots are immutable' USING ERRCODE = '55000';
                        END IF;
                        RETURN NEW;
                    END IF;
                    IF NEW."HouseTier" IS DISTINCT FROM (
                        SELECT "HouseTier" FROM subscriptions."CoachingProducts"
                        WHERE "TenantId" = NEW."TenantId" AND "Id" = NEW."ProductId") THEN
                        RAISE EXCEPTION 'An enrollment carries its plan''s tier' USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER "TR_ClientEnrollments_HouseTier"
                BEFORE INSERT OR UPDATE OF "HouseTier" ON subscriptions."ClientEnrollments"
                FOR EACH ROW EXECUTE FUNCTION subscriptions.guard_enrollment_house_tier();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // A plan with a tier, or an enrollment of one, is a fact the schema before this cannot hold, and Free's
            // rows are a trainee's history: stop with a plain message while any exists instead of dropping them.
            migrationBuilder.Sql(
                """
                DO $migration$
                BEGIN
                    IF EXISTS (SELECT 1 FROM subscriptions."CoachingProducts" WHERE "HouseTier" IS NOT NULL)
                        OR EXISTS (SELECT 1 FROM subscriptions."ClientEnrollments" WHERE "HouseTier" IS NOT NULL) THEN
                        RAISE EXCEPTION 'The house sells plans with a tier, Free among them; roll forward instead of reverting this migration.'
                            USING ERRCODE = '55000';
                    END IF;
                END;
                $migration$;
                """);

            migrationBuilder.Sql(
                """
                DROP FUNCTION IF EXISTS subscriptions.guard_enrollment_house_tier() CASCADE;
                DROP FUNCTION IF EXISTS subscriptions.guard_product_house_tier() CASCADE;
                ALTER TABLE subscriptions."ClientEnrollments" DROP CONSTRAINT IF EXISTS "EX_ClientEnrollments_OneHouseFreeAtATime";
                """);

            migrationBuilder.DropIndex(
                name: "UX_CoachingProducts_OneHouseFree",
                schema: "subscriptions",
                table: "CoachingProducts");

            migrationBuilder.DropCheckConstraint(
                name: "CK_CoachingProducts_HouseTier",
                schema: "subscriptions",
                table: "CoachingProducts");

            migrationBuilder.DropCheckConstraint(
                name: "CK_ClientEnrollments_HouseTier",
                schema: "subscriptions",
                table: "ClientEnrollments");

            migrationBuilder.DropColumn(
                name: "HouseTier",
                schema: "subscriptions",
                table: "CoachingProducts");

            migrationBuilder.DropColumn(
                name: "HouseTier",
                schema: "subscriptions",
                table: "ClientEnrollments");
        }
    }
}
