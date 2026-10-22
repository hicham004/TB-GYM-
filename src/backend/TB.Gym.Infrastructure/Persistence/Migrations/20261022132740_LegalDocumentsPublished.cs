using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class LegalDocumentsPublished : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_LegalDocumentVersions_Kind_VersionLabel_Culture_Context",
                schema: "identity",
                table: "LegalDocumentVersions");

            migrationBuilder.AddColumn<string>(
                name: "AcceptanceStatement",
                schema: "identity",
                table: "LegalDocumentVersions",
                type: "character varying(300)",
                maxLength: 300,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "Content",
                schema: "identity",
                table: "LegalDocumentVersions",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateIndex(
                name: "IX_LegalDocumentVersions_Kind_VersionLabel_Culture",
                schema: "identity",
                table: "LegalDocumentVersions",
                columns: new[] { "Kind", "VersionLabel", "Culture" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "UX_LegalDocumentVersions_Current",
                schema: "identity",
                table: "LegalDocumentVersions",
                columns: new[] { "Kind", "Culture" },
                unique: true,
                filter: "\"PublishedAtUtc\" IS NOT NULL AND \"RetiredAtUtc\" IS NULL");

            migrationBuilder.AddCheckConstraint(
                name: "CK_LegalDocumentVersions_HashMatchesContent",
                schema: "identity",
                table: "LegalDocumentVersions",
                sql: "\"ContentSha256\" = encode(sha256(convert_to(\"Content\", 'UTF8')), 'hex')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_LegalDocumentVersions_PublishedReviewed",
                schema: "identity",
                table: "LegalDocumentVersions",
                sql: "\"PublishedAtUtc\" IS NULL OR \"ReviewStatus\" = 'Approved'");

            migrationBuilder.AddCheckConstraint(
                name: "CK_LegalDocumentVersions_RetiredAfterPublished",
                schema: "identity",
                table: "LegalDocumentVersions",
                sql: "\"RetiredAtUtc\" IS NULL OR (\"PublishedAtUtc\" IS NOT NULL AND \"RetiredAtUtc\" >= \"PublishedAtUtc\")");

            // A version's words are what people accepted, so they never change; publishing and retiring
            // are each written once; and a published version is never deleted (CLI-010, audit INV-3).
            // The defaults only filled the new columns of rows that existed (there were none); every
            // version names its own text.
            migrationBuilder.Sql(
                """
                ALTER TABLE identity."LegalDocumentVersions" ALTER COLUMN "Content" DROP DEFAULT;
                ALTER TABLE identity."LegalDocumentVersions" ALTER COLUMN "AcceptanceStatement" DROP DEFAULT;

                CREATE OR REPLACE FUNCTION identity.protect_legal_document_version()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $function$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        IF OLD."PublishedAtUtc" IS NOT NULL THEN
                            RAISE EXCEPTION 'A published legal document version is kept for good' USING ERRCODE = '55000';
                        END IF;
                        RETURN OLD;
                    END IF;

                    IF NEW."Kind" IS DISTINCT FROM OLD."Kind"
                       OR NEW."VersionLabel" IS DISTINCT FROM OLD."VersionLabel"
                       OR NEW."Culture" IS DISTINCT FROM OLD."Culture"
                       OR NEW."Context" IS DISTINCT FROM OLD."Context"
                       OR NEW."ContentUri" IS DISTINCT FROM OLD."ContentUri"
                       OR NEW."ContentSha256" IS DISTINCT FROM OLD."ContentSha256"
                       OR NEW."Content" IS DISTINCT FROM OLD."Content"
                       OR NEW."AcceptanceStatement" IS DISTINCT FROM OLD."AcceptanceStatement"
                       OR NEW."CreatedAtUtc" IS DISTINCT FROM OLD."CreatedAtUtc"
                       OR NEW."CreatedByUserId" IS DISTINCT FROM OLD."CreatedByUserId" THEN
                        RAISE EXCEPTION 'The words of a legal document version never change; publish a new version' USING ERRCODE = '55000';
                    END IF;

                    IF (OLD."PublishedAtUtc" IS NOT NULL AND NEW."PublishedAtUtc" IS DISTINCT FROM OLD."PublishedAtUtc")
                       OR (OLD."RetiredAtUtc" IS NOT NULL AND NEW."RetiredAtUtc" IS DISTINCT FROM OLD."RetiredAtUtc")
                       OR (OLD."ReviewStatus" = 'Approved' AND NEW."ReviewStatus" IS DISTINCT FROM OLD."ReviewStatus") THEN
                        RAISE EXCEPTION 'Publishing and retiring a legal document version are written once' USING ERRCODE = '55000';
                    END IF;

                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER "TR_LegalDocumentVersions_Protect"
                BEFORE UPDATE OR DELETE ON identity."LegalDocumentVersions"
                FOR EACH ROW EXECUTE FUNCTION identity.protect_legal_document_version();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                DROP TRIGGER IF EXISTS "TR_LegalDocumentVersions_Protect" ON identity."LegalDocumentVersions";
                DROP FUNCTION IF EXISTS identity.protect_legal_document_version();
                """);

            migrationBuilder.DropIndex(
                name: "IX_LegalDocumentVersions_Kind_VersionLabel_Culture",
                schema: "identity",
                table: "LegalDocumentVersions");

            migrationBuilder.DropIndex(
                name: "UX_LegalDocumentVersions_Current",
                schema: "identity",
                table: "LegalDocumentVersions");

            migrationBuilder.DropCheckConstraint(
                name: "CK_LegalDocumentVersions_HashMatchesContent",
                schema: "identity",
                table: "LegalDocumentVersions");

            migrationBuilder.DropCheckConstraint(
                name: "CK_LegalDocumentVersions_PublishedReviewed",
                schema: "identity",
                table: "LegalDocumentVersions");

            migrationBuilder.DropCheckConstraint(
                name: "CK_LegalDocumentVersions_RetiredAfterPublished",
                schema: "identity",
                table: "LegalDocumentVersions");

            migrationBuilder.DropColumn(
                name: "AcceptanceStatement",
                schema: "identity",
                table: "LegalDocumentVersions");

            migrationBuilder.DropColumn(
                name: "Content",
                schema: "identity",
                table: "LegalDocumentVersions");

            migrationBuilder.CreateIndex(
                name: "IX_LegalDocumentVersions_Kind_VersionLabel_Culture_Context",
                schema: "identity",
                table: "LegalDocumentVersions",
                columns: new[] { "Kind", "VersionLabel", "Culture", "Context" },
                unique: true);
        }
    }
}
