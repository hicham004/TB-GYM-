using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class TalkToUsContactRequests : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "website");

            migrationBuilder.CreateTable(
                name: "ContactRequests",
                schema: "website",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    GymName = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    Contact = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    ContactKind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Message = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    ReceivedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    SchemaVersion = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    AttemptCount = table.Column<int>(type: "integer", nullable: false),
                    NextAttemptAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ClaimToken = table.Column<Guid>(type: "uuid", nullable: true),
                    ClaimExpiresAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ProviderIdempotencyKey = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    MaterializedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CompletedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    DeadLetteredAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    FailureCode = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    TransportAdapter = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    ProviderMessageId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    ProviderAcceptedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ContactRequests", x => x.Id);
                    table.CheckConstraint("CK_ContactRequests_Attempted", "(\"ProviderIdempotencyKey\" IS NULL) = (\"AttemptCount\" = 0)");
                    table.CheckConstraint("CK_ContactRequests_CapturedHasNoProvider", "\"TransportAdapter\" <> 'captured' OR (\"ProviderMessageId\" IS NULL AND \"ProviderAcceptedAtUtc\" IS NULL)");
                    table.CheckConstraint("CK_ContactRequests_Claim", "(\"ClaimToken\" IS NULL) = (\"ClaimExpiresAtUtc\" IS NULL) AND ((\"Status\" = 'Processing') = (\"ClaimToken\" IS NOT NULL))");
                    table.CheckConstraint("CK_ContactRequests_Completion", "(\"Status\" IN ('Materialized', 'DeadLettered')) = (\"CompletedAtUtc\" IS NOT NULL)");
                    table.CheckConstraint("CK_ContactRequests_Counters", "\"AttemptCount\" >= 0 AND \"SchemaVersion\" >= 1");
                    table.CheckConstraint("CK_ContactRequests_DeadLettered", "(\"Status\" = 'DeadLettered') = (\"DeadLetteredAtUtc\" IS NOT NULL)");
                    table.CheckConstraint("CK_ContactRequests_Facts", "length(btrim(\"Name\")) > 0 AND length(btrim(\"GymName\")) > 0 AND length(btrim(\"Contact\")) > 0 AND (\"Message\" IS NULL OR length(btrim(\"Message\")) > 0)");
                    table.CheckConstraint("CK_ContactRequests_Failure", "(\"Status\" = 'Materialized' AND \"FailureCode\" IS NULL) OR (\"Status\" = 'DeadLettered' AND \"FailureCode\" IS NOT NULL) OR \"Status\" IN ('Pending', 'Processing')");
                    table.CheckConstraint("CK_ContactRequests_Materialized", "(\"Status\" = 'Materialized') = (\"MaterializedAtUtc\" IS NOT NULL)");
                    table.CheckConstraint("CK_ContactRequests_NextAttempt", "\"NextAttemptAtUtc\" >= \"ReceivedAtUtc\"");
                    table.CheckConstraint("CK_ContactRequests_ProviderEvidence", "((\"ProviderMessageId\" IS NULL) = (\"ProviderAcceptedAtUtc\" IS NULL)) AND (\"ProviderMessageId\" IS NULL OR (\"Status\" = 'Materialized' AND \"TransportAdapter\" IN ('resend')))");
                    table.CheckConstraint("CK_ContactRequests_Transport", "\"TransportAdapter\" IS NULL OR \"Status\" = 'Materialized'");
                    table.CheckConstraint("CK_ContactRequests_Vocabulary", "\"ContactKind\" IN ('Email', 'WhatsApp') AND \"Status\" IN ('Pending', 'Processing', 'Materialized', 'DeadLettered')");
                });

            migrationBuilder.CreateIndex(
                name: "IX_ContactRequests_ProviderIdempotencyKey",
                schema: "website",
                table: "ContactRequests",
                column: "ProviderIdempotencyKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ContactRequests_ReceivedAtUtc",
                schema: "website",
                table: "ContactRequests",
                column: "ReceivedAtUtc");

            migrationBuilder.CreateIndex(
                name: "IX_ContactRequests_Status_ClaimExpiresAtUtc",
                schema: "website",
                table: "ContactRequests",
                columns: new[] { "Status", "ClaimExpiresAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_ContactRequests_Status_NextAttemptAtUtc_Id",
                schema: "website",
                table: "ContactRequests",
                columns: new[] { "Status", "NextAttemptAtUtc", "Id" });

            // WEB-001: what the person wrote is the fact the owner is told; only the email's own
            // bookkeeping columns change afterwards, and a request is never deleted.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION website.protect_contact_request()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'A contact request is never deleted'
                            USING ERRCODE = '23514', CONSTRAINT = 'CK_ContactRequests_Kept';
                    END IF;
                    IF NEW."Name" IS DISTINCT FROM OLD."Name"
                        OR NEW."GymName" IS DISTINCT FROM OLD."GymName"
                        OR NEW."Contact" IS DISTINCT FROM OLD."Contact"
                        OR NEW."ContactKind" IS DISTINCT FROM OLD."ContactKind"
                        OR NEW."Message" IS DISTINCT FROM OLD."Message"
                        OR NEW."ReceivedAtUtc" IS DISTINCT FROM OLD."ReceivedAtUtc" THEN
                        RAISE EXCEPTION 'A contact request''s facts are immutable'
                            USING ERRCODE = '23514', CONSTRAINT = 'CK_ContactRequests_FactsImmutable';
                    END IF;

                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER "TR_ContactRequests_Facts"
                    BEFORE UPDATE OR DELETE ON website."ContactRequests"
                    FOR EACH ROW EXECUTE FUNCTION website.protect_contact_request();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                DROP TRIGGER "TR_ContactRequests_Facts" ON website."ContactRequests";
                DROP FUNCTION website.protect_contact_request();
                """);

            migrationBuilder.DropTable(
                name: "ContactRequests",
                schema: "website");
        }
    }
}
