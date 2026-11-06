using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class FoundingStatus : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "FoundingTerms",
                schema: "billing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    VersionNumber = table.Column<int>(type: "integer", nullable: false),
                    ClientsWithActivePlan = table.Column<int>(type: "integer", nullable: false),
                    MonthsSinceStart = table.Column<int>(type: "integer", nullable: false),
                    Note = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    PublishedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    PublishedByUserId = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FoundingTerms", x => x.Id);
                    table.UniqueConstraint("AK_FoundingTerms_VersionNumber", x => x.VersionNumber);
                    table.CheckConstraint("CK_FoundingTerms_Clients", "\"ClientsWithActivePlan\" >= 1 AND \"ClientsWithActivePlan\" <= 1000");
                    table.CheckConstraint("CK_FoundingTerms_Months", "\"MonthsSinceStart\" >= 0 AND \"MonthsSinceStart\" <= 24");
                    table.CheckConstraint("CK_FoundingTerms_Version", "\"VersionNumber\" >= 1");
                });

            migrationBuilder.CreateTable(
                name: "FoundingStatuses",
                schema: "billing",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    FoundingSince = table.Column<DateOnly>(type: "date", nullable: false),
                    Note = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    MarkedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    MarkedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    EarnedOn = table.Column<DateOnly>(type: "date", nullable: true),
                    EarnedUnderTermsVersion = table.Column<int>(type: "integer", nullable: true),
                    EarnedClientCount = table.Column<int>(type: "integer", nullable: true),
                    EarnedUnderRule = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    BadgeHidden = table.Column<bool>(type: "boolean", nullable: false),
                    EndedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    EndedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    EndReason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FoundingStatuses", x => x.Id);
                    table.UniqueConstraint("AK_FoundingStatuses_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_FoundingStatuses_Earned", "(\"EarnedOn\" IS NULL) = (\"EarnedUnderTermsVersion\" IS NULL) AND (\"EarnedOn\" IS NULL) = (\"EarnedClientCount\" IS NULL) AND (\"EarnedOn\" IS NULL) = (\"EarnedUnderRule\" IS NULL)");
                    table.CheckConstraint("CK_FoundingStatuses_EarnedFacts", "\"EarnedOn\" IS NULL OR (\"EarnedOn\" >= \"FoundingSince\" AND \"EarnedClientCount\" >= 0)");
                    table.CheckConstraint("CK_FoundingStatuses_End", "(\"EndedAtUtc\" IS NULL) = (\"EndedByUserId\" IS NULL) AND (\"EndedAtUtc\" IS NULL) = (\"EndReason\" IS NULL)");
                    table.CheckConstraint("CK_FoundingStatuses_EndReason", "\"EndReason\" IS NULL OR btrim(\"EndReason\") <> ''");
                    table.CheckConstraint("CK_FoundingStatuses_Note", "btrim(\"Note\") <> ''");
                    table.ForeignKey(
                        name: "FK_FoundingStatuses_FoundingTerms_EarnedUnderTermsVersion",
                        column: x => x.EarnedUnderTermsVersion,
                        principalSchema: "billing",
                        principalTable: "FoundingTerms",
                        principalColumn: "VersionNumber",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_FoundingStatuses_Tenants_TenantId",
                        column: x => x.TenantId,
                        principalSchema: "tenancy",
                        principalTable: "Tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_FoundingStatuses_EarnedUnderTermsVersion",
                schema: "billing",
                table: "FoundingStatuses",
                column: "EarnedUnderTermsVersion");

            migrationBuilder.CreateIndex(
                name: "IX_FoundingStatuses_TenantId_MarkedAtUtc",
                schema: "billing",
                table: "FoundingStatuses",
                columns: new[] { "TenantId", "MarkedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_FoundingStatuses_TenantId_Open",
                schema: "billing",
                table: "FoundingStatuses",
                column: "TenantId",
                unique: true,
                filter: "\"EndedAtUtc\" IS NULL");

            // Notes plan N3a (decision 15, 5 Nov 2026): terms versions are immutable, and a founding status
            // is history: never deleted, its mark never changed, its badge recorded once, ended once and
            // then left as it is. The owner's switch and the update stamps are the only other changes.
            migrationBuilder.Sql(
                """
                CREATE TRIGGER "TR_FoundingTerms_AppendOnly"
                BEFORE UPDATE OR DELETE ON billing."FoundingTerms"
                FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

                CREATE OR REPLACE FUNCTION billing.protect_founding_status()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $function$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Founding statuses are never deleted' USING ERRCODE = '55000';
                    END IF;
                    IF OLD."EndedAtUtc" IS NOT NULL THEN
                        RAISE EXCEPTION 'An ended founding status is never changed' USING ERRCODE = '55000';
                    END IF;
                    IF NEW."Id" IS DISTINCT FROM OLD."Id"
                        OR NEW."TenantId" IS DISTINCT FROM OLD."TenantId"
                        OR NEW."FoundingSince" IS DISTINCT FROM OLD."FoundingSince"
                        OR NEW."Note" IS DISTINCT FROM OLD."Note"
                        OR NEW."MarkedAtUtc" IS DISTINCT FROM OLD."MarkedAtUtc"
                        OR NEW."MarkedByUserId" IS DISTINCT FROM OLD."MarkedByUserId"
                        OR NEW."CreatedAtUtc" IS DISTINCT FROM OLD."CreatedAtUtc"
                        OR NEW."CreatedByUserId" IS DISTINCT FROM OLD."CreatedByUserId" THEN
                        RAISE EXCEPTION 'A founding status mark is never changed' USING ERRCODE = '55000';
                    END IF;
                    IF OLD."EarnedOn" IS NOT NULL AND (
                        NEW."EarnedOn" IS DISTINCT FROM OLD."EarnedOn"
                        OR NEW."EarnedUnderTermsVersion" IS DISTINCT FROM OLD."EarnedUnderTermsVersion"
                        OR NEW."EarnedClientCount" IS DISTINCT FROM OLD."EarnedClientCount"
                        OR NEW."EarnedUnderRule" IS DISTINCT FROM OLD."EarnedUnderRule") THEN
                        RAISE EXCEPTION 'A founding badge is recorded once' USING ERRCODE = '55000';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER "TR_FoundingStatuses_Protect"
                BEFORE UPDATE OR DELETE ON billing."FoundingStatuses"
                FOR EACH ROW EXECUTE FUNCTION billing.protect_founding_status();

                -- The badge's first terms (decision 15, 5 Nov 2026). Whether the wait is 2 or 3 months was
                -- left open; the platform admin publishes a new version to change either number.
                INSERT INTO billing."FoundingTerms"
                    ("Id", "VersionNumber", "ClientsWithActivePlan", "MonthsSinceStart", "Note", "PublishedAtUtc", "PublishedByUserId")
                VALUES
                    (uuidv7(), 1, 10, 2,
                     'Decision 15 (5 Nov 2026): 10 clients with an active plan, and 2 months since the space started. Publish a new version to change them.',
                     now(), NULL);
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""DROP FUNCTION IF EXISTS billing.protect_founding_status() CASCADE;""");

            migrationBuilder.DropTable(
                name: "FoundingStatuses",
                schema: "billing");

            migrationBuilder.DropTable(
                name: "FoundingTerms",
                schema: "billing");
        }
    }
}
