using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Notes plan N8 (decision 16, 7 Nov 2026): the founding terms gain the months of the founding price
    /// guarantee, the time a founding space keeps the price plan version in force on its founding day after
    /// its last discount ends (<c>founding-price-v1</c>, PBL-012). No figure is seeded: version 1 keeps none,
    /// so nothing is held until the admin publishes the months.
    /// </summary>
    /// <remarks>
    /// The column is added nullable with no default, so no published terms version is rewritten and the
    /// table's append-only trigger fires on nothing; each one meets the new check as it is.
    /// </remarks>
    public partial class FoundingPriceGuarantee : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "PriceGuaranteeMonths",
                schema: "billing",
                table: "FoundingTerms",
                type: "integer",
                nullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_FoundingTerms_PriceGuaranteeMonths",
                schema: "billing",
                table: "FoundingTerms",
                sql: "\"PriceGuaranteeMonths\" IS NULL OR (\"PriceGuaranteeMonths\" >= 0 AND \"PriceGuaranteeMonths\" <= 120)");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Published months are a promise founding spaces are billed by, kept append-only with their terms
            // version, so going back is a forward fix (ADR 0040): stop with a plain message while any exists
            // instead of dropping them and silently raising those spaces' next invoices.
            migrationBuilder.Sql(
                """
                DO $migration$
                BEGIN
                    IF EXISTS (SELECT 1 FROM billing."FoundingTerms" WHERE "PriceGuaranteeMonths" IS NOT NULL) THEN
                        RAISE EXCEPTION 'Founding price guarantee months were published; roll forward instead of reverting this migration.'
                            USING ERRCODE = '55000';
                    END IF;
                END;
                $migration$;
                """);

            migrationBuilder.DropCheckConstraint(
                name: "CK_FoundingTerms_PriceGuaranteeMonths",
                schema: "billing",
                table: "FoundingTerms");

            migrationBuilder.DropColumn(
                name: "PriceGuaranteeMonths",
                schema: "billing",
                table: "FoundingTerms");
        }
    }
}
