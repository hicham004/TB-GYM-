using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ActiveOfferPriceOptions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                DO $migration$
                BEGIN
                    IF EXISTS (
                        SELECT 1 FROM subscriptions."ProductOffers"
                        WHERE "IsActive"
                        GROUP BY "TenantId", "ProductId", "DurationCount", "DurationUnit", "PriceCurrency"
                        HAVING count(*) > 1
                    ) THEN
                        RAISE EXCEPTION 'Active price options share a duration and currency within a product. Review duplicates and retire unwanted options through the existing availability operation before retrying this migration.'
                            USING ERRCODE = '23505';
                    END IF;
                END;
                $migration$;
                """);

            migrationBuilder.CreateTable(
                name: "OfferPriceChanges",
                schema: "subscriptions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SourceOfferId = table.Column<Guid>(type: "uuid", nullable: false),
                    ReplacementOfferId = table.Column<Guid>(type: "uuid", nullable: false),
                    SourceVersion = table.Column<long>(type: "bigint", nullable: false),
                    PriceAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
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
                    table.PrimaryKey("PK_OfferPriceChanges", x => x.Id);
                    table.CheckConstraint("CK_OfferPriceChanges_PriceAmount", "\"PriceAmount\" >= 0");
                    table.ForeignKey(
                        name: "FK_OfferPriceChanges_ProductOffers_TenantId_ReplacementOfferId",
                        columns: x => new { x.TenantId, x.ReplacementOfferId },
                        principalSchema: "subscriptions",
                        principalTable: "ProductOffers",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_OfferPriceChanges_ProductOffers_TenantId_SourceOfferId",
                        columns: x => new { x.TenantId, x.SourceOfferId },
                        principalSchema: "subscriptions",
                        principalTable: "ProductOffers",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ProductOffers_ActiveDurationCurrency",
                schema: "subscriptions",
                table: "ProductOffers",
                columns: new[] { "TenantId", "ProductId", "DurationCount", "DurationUnit", "PriceCurrency" },
                unique: true,
                filter: "\"IsActive\"");

            migrationBuilder.CreateIndex(
                name: "IX_OfferPriceChanges_TenantId_IdempotencyKey",
                schema: "subscriptions",
                table: "OfferPriceChanges",
                columns: new[] { "TenantId", "IdempotencyKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_OfferPriceChanges_TenantId_ReplacementOfferId",
                schema: "subscriptions",
                table: "OfferPriceChanges",
                columns: new[] { "TenantId", "ReplacementOfferId" });

            migrationBuilder.CreateIndex(
                name: "IX_OfferPriceChanges_TenantId_SourceOfferId",
                schema: "subscriptions",
                table: "OfferPriceChanges",
                columns: new[] { "TenantId", "SourceOfferId" });

            migrationBuilder.Sql(
                """
                CREATE TRIGGER "TR_OfferPriceChanges_AppendOnly"
                BEFORE UPDATE OR DELETE ON subscriptions."OfferPriceChanges"
                FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "OfferPriceChanges",
                schema: "subscriptions");

            migrationBuilder.DropIndex(
                name: "IX_ProductOffers_ActiveDurationCurrency",
                schema: "subscriptions",
                table: "ProductOffers");
        }
    }
}
