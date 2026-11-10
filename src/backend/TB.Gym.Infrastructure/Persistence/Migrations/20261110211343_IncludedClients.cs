using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Notes plan N11a (decisions 11 and 17, 7 Nov 2026): the founding terms gain the clients a founding space's
    /// owner seat includes, extra included clients are granted to founding spaces for whole UTC calendar months,
    /// and invoices are worked out by <c>platform-invoice-v2</c> and record where their included clients came
    /// from. No figure is seeded: version 1 keeps none, and the admin publishes the number.
    /// </summary>
    /// <remarks>
    /// Every column is added with a constant default, so no issued invoice or terms version is rewritten and
    /// their append-only triggers fire on nothing; each one meets the new checks as it is.
    /// </remarks>
    public partial class IncludedClients : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Invoices_Quantities",
                schema: "billing",
                table: "Invoices");

            migrationBuilder.AddColumn<int>(
                name: "FoundingSeatIncludedClients",
                schema: "billing",
                table: "Invoices",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "FoundingStatusId",
                schema: "billing",
                table: "Invoices",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "FoundingTermsVersion",
                schema: "billing",
                table: "Invoices",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "GrantedIncludedClients",
                schema: "billing",
                table: "Invoices",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<Guid[]>(
                name: "IncludedClientGrantIds",
                schema: "billing",
                table: "Invoices",
                type: "uuid[]",
                nullable: false,
                defaultValueSql: "'{}'::uuid[]");

            migrationBuilder.AddColumn<int>(
                name: "FoundingSeatIncludedClients",
                schema: "billing",
                table: "FoundingTerms",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "IncludedClientGrants",
                schema: "billing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Clients = table.Column<int>(type: "integer", nullable: false),
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
                    table.PrimaryKey("PK_IncludedClientGrants", x => x.Id);
                    table.UniqueConstraint("AK_IncludedClientGrants_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_IncludedClientGrants_Clients", "\"Clients\" >= 1 AND \"Clients\" <= 1000");
                    table.CheckConstraint("CK_IncludedClientGrants_Months", "EXTRACT(DAY FROM \"StartsOn\") = 1 AND EXTRACT(DAY FROM \"EndsOnExclusive\") = 1 AND \"EndsOnExclusive\" > \"StartsOn\" AND \"StartsOn\" >= DATE '2000-01-01'");
                    table.CheckConstraint("CK_IncludedClientGrants_Note", "btrim(\"Note\") <> ''");
                    table.CheckConstraint("CK_IncludedClientGrants_Revocation", "(\"RevokedAtUtc\" IS NULL) = (\"RevokedByUserId\" IS NULL)");
                    table.ForeignKey(
                        name: "FK_IncludedClientGrants_Tenants_TenantId",
                        column: x => x.TenantId,
                        principalSchema: "tenancy",
                        principalTable: "Tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Invoices_FoundingTermsVersion",
                schema: "billing",
                table: "Invoices",
                column: "FoundingTermsVersion");

            migrationBuilder.CreateIndex(
                name: "IX_Invoices_TenantId_FoundingStatusId",
                schema: "billing",
                table: "Invoices",
                columns: new[] { "TenantId", "FoundingStatusId" });

            migrationBuilder.AddCheckConstraint(
                name: "CK_Invoices_FoundingSeat",
                schema: "billing",
                table: "Invoices",
                sql: "(\"FoundingSeatIncludedClients\" IS NULL) = (\"FoundingTermsVersion\" IS NULL) AND (\"FoundingSeatIncludedClients\" IS NULL) = (\"FoundingStatusId\" IS NULL) AND (\"FoundingSeatIncludedClients\" IS NULL OR (\"FoundingSeatIncludedClients\" >= 0 AND \"FoundingSeatIncludedClients\" <= 1000))");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Invoices_Grants",
                schema: "billing",
                table: "Invoices",
                sql: "\"GrantedIncludedClients\" >= cardinality(\"IncludedClientGrantIds\") AND (\"GrantedIncludedClients\" = 0) = (cardinality(\"IncludedClientGrantIds\") = 0)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Invoices_Quantities",
                schema: "billing",
                table: "Invoices",
                sql: "\"Seats\" >= 1 AND \"BillableClients\" >= 0 AND \"IncludedClients\" = \"Seats\" * \"PlanIncludedClientsPerSeat\" + GREATEST(0, COALESCE(\"FoundingSeatIncludedClients\", 0) - \"PlanIncludedClientsPerSeat\") + \"GrantedIncludedClients\" AND \"ExtraClients\" = GREATEST(0, \"BillableClients\" - \"IncludedClients\")");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Invoices_Version1",
                schema: "billing",
                table: "Invoices",
                sql: "\"CalculationName\" <> 'platform-invoice-v1' OR (\"FoundingSeatIncludedClients\" IS NULL AND \"GrantedIncludedClients\" = 0)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_FoundingTerms_SeatIncludedClients",
                schema: "billing",
                table: "FoundingTerms",
                sql: "\"FoundingSeatIncludedClients\" IS NULL OR (\"FoundingSeatIncludedClients\" >= 0 AND \"FoundingSeatIncludedClients\" <= 1000)");

            migrationBuilder.CreateIndex(
                name: "IX_IncludedClientGrants_Same_Unrevoked",
                schema: "billing",
                table: "IncludedClientGrants",
                columns: new[] { "TenantId", "Clients", "StartsOn", "EndsOnExclusive", "Note" },
                unique: true,
                filter: "\"RevokedAtUtc\" IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_IncludedClientGrants_TenantId_StartsOn",
                schema: "billing",
                table: "IncludedClientGrants",
                columns: new[] { "TenantId", "StartsOn" });

            // A grant is never edited or deleted: it is revoked once, and the revocation is kept. Grants that
            // touch one month add up, so unlike a discount there is no overlap constraint.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION billing.protect_included_client_grant()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $function$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Extra included client grants are never deleted' USING ERRCODE = '55000';
                    END IF;
                    IF OLD."RevokedAtUtc" IS NOT NULL
                        OR NEW."RevokedAtUtc" IS NULL
                        OR NEW."Id" IS DISTINCT FROM OLD."Id"
                        OR NEW."TenantId" IS DISTINCT FROM OLD."TenantId"
                        OR NEW."Clients" IS DISTINCT FROM OLD."Clients"
                        OR NEW."StartsOn" IS DISTINCT FROM OLD."StartsOn"
                        OR NEW."EndsOnExclusive" IS DISTINCT FROM OLD."EndsOnExclusive"
                        OR NEW."Note" IS DISTINCT FROM OLD."Note"
                        OR NEW."GrantedAtUtc" IS DISTINCT FROM OLD."GrantedAtUtc"
                        OR NEW."GrantedByUserId" IS DISTINCT FROM OLD."GrantedByUserId"
                        OR NEW."CreatedAtUtc" IS DISTINCT FROM OLD."CreatedAtUtc"
                        OR NEW."CreatedByUserId" IS DISTINCT FROM OLD."CreatedByUserId" THEN
                        RAISE EXCEPTION 'A grant of extra included clients can only be revoked, once' USING ERRCODE = '55000';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER "TR_IncludedClientGrants_Protect"
                BEFORE UPDATE OR DELETE ON billing."IncludedClientGrants"
                FOR EACH ROW EXECUTE FUNCTION billing.protect_included_client_grant();
                """);

            migrationBuilder.AddForeignKey(
                name: "FK_Invoices_FoundingStatuses_TenantId_FoundingStatusId",
                schema: "billing",
                table: "Invoices",
                columns: new[] { "TenantId", "FoundingStatusId" },
                principalSchema: "billing",
                principalTable: "FoundingStatuses",
                principalColumns: new[] { "TenantId", "Id" },
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Invoices_FoundingTerms_FoundingTermsVersion",
                schema: "billing",
                table: "Invoices",
                column: "FoundingTermsVersion",
                principalSchema: "billing",
                principalTable: "FoundingTerms",
                principalColumn: "VersionNumber",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Grants, a published founding number and the invoices that counted them are billing history kept
            // append-only, so going back is a forward fix (ADR 0040): stop with a plain message while any exists
            // instead of dropping them. The v1 check restored below would refuse such an invoice too.
            migrationBuilder.Sql(
                """
                DO $migration$
                BEGIN
                    IF EXISTS (SELECT 1 FROM billing."IncludedClientGrants")
                        OR EXISTS (SELECT 1 FROM billing."FoundingTerms" WHERE "FoundingSeatIncludedClients" IS NOT NULL)
                        OR EXISTS (
                            SELECT 1 FROM billing."Invoices"
                            WHERE "FoundingSeatIncludedClients" IS NOT NULL OR "GrantedIncludedClients" <> 0) THEN
                        RAISE EXCEPTION 'A founding seat number or extra included clients were published, granted or billed; roll forward instead of reverting this migration.'
                            USING ERRCODE = '55000';
                    END IF;
                END;
                $migration$;
                """);

            migrationBuilder.DropForeignKey(
                name: "FK_Invoices_FoundingStatuses_TenantId_FoundingStatusId",
                schema: "billing",
                table: "Invoices");

            migrationBuilder.DropForeignKey(
                name: "FK_Invoices_FoundingTerms_FoundingTermsVersion",
                schema: "billing",
                table: "Invoices");

            migrationBuilder.Sql(
                """
                DROP FUNCTION IF EXISTS billing.protect_included_client_grant() CASCADE;
                """);

            migrationBuilder.DropTable(
                name: "IncludedClientGrants",
                schema: "billing");

            migrationBuilder.DropIndex(
                name: "IX_Invoices_FoundingTermsVersion",
                schema: "billing",
                table: "Invoices");

            migrationBuilder.DropIndex(
                name: "IX_Invoices_TenantId_FoundingStatusId",
                schema: "billing",
                table: "Invoices");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Invoices_FoundingSeat",
                schema: "billing",
                table: "Invoices");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Invoices_Grants",
                schema: "billing",
                table: "Invoices");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Invoices_Quantities",
                schema: "billing",
                table: "Invoices");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Invoices_Version1",
                schema: "billing",
                table: "Invoices");

            migrationBuilder.DropCheckConstraint(
                name: "CK_FoundingTerms_SeatIncludedClients",
                schema: "billing",
                table: "FoundingTerms");

            migrationBuilder.DropColumn(
                name: "FoundingSeatIncludedClients",
                schema: "billing",
                table: "Invoices");

            migrationBuilder.DropColumn(
                name: "FoundingStatusId",
                schema: "billing",
                table: "Invoices");

            migrationBuilder.DropColumn(
                name: "FoundingTermsVersion",
                schema: "billing",
                table: "Invoices");

            migrationBuilder.DropColumn(
                name: "GrantedIncludedClients",
                schema: "billing",
                table: "Invoices");

            migrationBuilder.DropColumn(
                name: "IncludedClientGrantIds",
                schema: "billing",
                table: "Invoices");

            migrationBuilder.DropColumn(
                name: "FoundingSeatIncludedClients",
                schema: "billing",
                table: "FoundingTerms");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Invoices_Quantities",
                schema: "billing",
                table: "Invoices",
                sql: "\"Seats\" >= 1 AND \"BillableClients\" >= 0 AND \"IncludedClients\" = \"Seats\" * \"PlanIncludedClientsPerSeat\" AND \"ExtraClients\" = GREATEST(0, \"BillableClients\" - \"IncludedClients\")");
        }
    }
}
