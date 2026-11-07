using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class CoachCertificateLines : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CoachCertificateLines",
                schema: "identity",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CoachUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    What = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    ShownOn = table.Column<DateOnly>(type: "date", nullable: true),
                    RecordedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    ConfirmedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ConfirmedByName = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    CoachShows = table.Column<bool>(type: "boolean", nullable: false),
                    TakenDownAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    TakenDownByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    ErasedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ErasedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    ErasureReason = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    RequestedOn = table.Column<DateOnly>(type: "date", nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CoachCertificateLines", x => x.Id);
                    table.UniqueConstraint("AK_CoachCertificateLines_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_CoachCertificateLines_Confirmed", "(\"ConfirmedAtUtc\" IS NULL) = (\"ConfirmedByName\" IS NULL) AND (\"ConfirmedByName\" IS NULL OR (\"ErasedAtUtc\" IS NULL AND char_length(\"ConfirmedByName\") BETWEEN 1 AND 80 AND \"ConfirmedByName\" = btrim(\"ConfirmedByName\")) OR (\"ErasedAtUtc\" IS NOT NULL AND \"ConfirmedByName\" = '')) AND (\"ConfirmedAtUtc\" IS NULL OR \"ConfirmedAtUtc\" >= \"CreatedAtUtc\")");
                    table.CheckConstraint("CK_CoachCertificateLines_Erased", "(\"ErasedAtUtc\" IS NULL) = (\"ErasureReason\" IS NULL) AND (\"ErasedAtUtc\" IS NULL OR (\"ConfirmedAtUtc\" IS NOT NULL AND \"ErasedAtUtc\" >= \"ConfirmedAtUtc\")) AND (\"ErasureReason\" IS NULL OR \"ErasureReason\" IN ('Request', 'KeepingPeriod')) AND (\"ErasureReason\" IS NOT DISTINCT FROM 'Request') = (\"ErasedByUserId\" IS NOT NULL) AND (\"ErasureReason\" IS NOT DISTINCT FROM 'Request') = (\"RequestedOn\" IS NOT NULL)");
                    table.CheckConstraint("CK_CoachCertificateLines_TakenDown", "(\"TakenDownAtUtc\" IS NULL) = (\"TakenDownByUserId\" IS NULL) AND (\"TakenDownAtUtc\" IS NULL OR (\"ConfirmedAtUtc\" IS NOT NULL AND \"TakenDownAtUtc\" >= \"ConfirmedAtUtc\"))");
                    table.CheckConstraint("CK_CoachCertificateLines_Words", "(\"ErasedAtUtc\" IS NULL AND char_length(\"What\") BETWEEN 1 AND 120 AND \"What\" = btrim(\"What\") AND \"ShownOn\" IS NOT NULL) OR (\"ErasedAtUtc\" IS NOT NULL AND \"What\" = '' AND \"ShownOn\" IS NULL)");
                    table.ForeignKey(
                        name: "FK_CoachCertificateLines_Memberships_TenantId_CoachUserId",
                        columns: x => new { x.TenantId, x.CoachUserId },
                        principalSchema: "tenancy",
                        principalTable: "Memberships",
                        principalColumns: new[] { "TenantId", "UserId" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CoachCertificateLines_Tenants_TenantId",
                        column: x => x.TenantId,
                        principalSchema: "tenancy",
                        principalTable: "Tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CoachCertificateLines_Users_ErasedByUserId",
                        column: x => x.ErasedByUserId,
                        principalSchema: "identity",
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CoachCertificateLines_Users_RecordedByUserId",
                        column: x => x.RecordedByUserId,
                        principalSchema: "identity",
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CoachCertificateLines_Users_TakenDownByUserId",
                        column: x => x.TakenDownByUserId,
                        principalSchema: "identity",
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CoachCertificateLines_ErasedByUserId",
                schema: "identity",
                table: "CoachCertificateLines",
                column: "ErasedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_CoachCertificateLines_RecordedByUserId",
                schema: "identity",
                table: "CoachCertificateLines",
                column: "RecordedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_CoachCertificateLines_TakenDownByUserId",
                schema: "identity",
                table: "CoachCertificateLines",
                column: "TakenDownByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_CoachCertificateLines_TenantId_CoachUserId_CreatedAtUtc",
                schema: "identity",
                table: "CoachCertificateLines",
                columns: new[] { "TenantId", "CoachUserId", "CreatedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "UX_CoachCertificateLines_OneLine",
                schema: "identity",
                table: "CoachCertificateLines",
                columns: new[] { "TenantId", "CoachUserId", "What", "ShownOn" },
                unique: true,
                filter: "\"ErasedAtUtc\" IS NULL");

            // A certificate line (CLI-021, ADR 0039): a waiting line may be deleted, a confirmed one never; once
            // confirmed its words, its day and who confirmed it never change; the erasure blanks them once and an
            // erased line never changes. No message names a value of the row.
            migrationBuilder.Sql("""
                CREATE OR REPLACE FUNCTION identity.protect_coach_certificate_line()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $function$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        IF OLD."ConfirmedAtUtc" IS NOT NULL THEN
                            RAISE EXCEPTION 'A confirmed certificate line is never deleted' USING ERRCODE = '55000';
                        END IF;
                        RETURN OLD;
                    END IF;

                    IF OLD."ErasedAtUtc" IS NOT NULL THEN
                        RAISE EXCEPTION 'An erased certificate line never changes' USING ERRCODE = '55000';
                    END IF;

                    IF NEW."Id" IS DISTINCT FROM OLD."Id"
                       OR NEW."TenantId" IS DISTINCT FROM OLD."TenantId"
                       OR NEW."CoachUserId" IS DISTINCT FROM OLD."CoachUserId"
                       OR NEW."RecordedByUserId" IS DISTINCT FROM OLD."RecordedByUserId"
                       OR NEW."CreatedAtUtc" IS DISTINCT FROM OLD."CreatedAtUtc"
                       OR NEW."CreatedByUserId" IS DISTINCT FROM OLD."CreatedByUserId" THEN
                        RAISE EXCEPTION 'Who a certificate line is about and who recorded it never change' USING ERRCODE = '55000';
                    END IF;

                    IF NEW."ErasedAtUtc" IS NULL THEN
                        IF NEW."What" IS DISTINCT FROM OLD."What"
                           OR NEW."ShownOn" IS DISTINCT FROM OLD."ShownOn"
                           OR NEW."ErasedByUserId" IS DISTINCT FROM OLD."ErasedByUserId"
                           OR NEW."ErasureReason" IS DISTINCT FROM OLD."ErasureReason"
                           OR NEW."RequestedOn" IS DISTINCT FROM OLD."RequestedOn" THEN
                            RAISE EXCEPTION 'A certificate line''s words and day never change; only an erasure blanks them' USING ERRCODE = '55000';
                        END IF;

                        IF OLD."ConfirmedAtUtc" IS NOT NULL
                           AND (NEW."ConfirmedAtUtc" IS DISTINCT FROM OLD."ConfirmedAtUtc"
                                OR NEW."ConfirmedByName" IS DISTINCT FROM OLD."ConfirmedByName") THEN
                            RAISE EXCEPTION 'A certificate line is confirmed once' USING ERRCODE = '55000';
                        END IF;

                        IF OLD."TakenDownAtUtc" IS NOT NULL
                           AND (NEW."TakenDownAtUtc" IS DISTINCT FROM OLD."TakenDownAtUtc"
                                OR NEW."TakenDownByUserId" IS DISTINCT FROM OLD."TakenDownByUserId") THEN
                            RAISE EXCEPTION 'A certificate line is taken down once' USING ERRCODE = '55000';
                        END IF;
                    ELSIF OLD."ConfirmedAtUtc" IS NULL
                       OR NEW."What" <> ''
                       OR NEW."ShownOn" IS NOT NULL
                       OR NEW."ConfirmedByName" IS DISTINCT FROM ''
                       OR NEW."ConfirmedAtUtc" IS DISTINCT FROM OLD."ConfirmedAtUtc"
                       OR NEW."TakenDownAtUtc" IS DISTINCT FROM OLD."TakenDownAtUtc"
                       OR NEW."TakenDownByUserId" IS DISTINCT FROM OLD."TakenDownByUserId"
                       OR NEW."CoachShows" IS DISTINCT FROM OLD."CoachShows" THEN
                        RAISE EXCEPTION 'An erasure blanks a confirmed certificate line''s words and keeps its dates' USING ERRCODE = '55000';
                    END IF;

                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER "TR_CoachCertificateLines_Protect"
                BEFORE UPDATE OR DELETE ON identity."CoachCertificateLines"
                FOR EACH ROW EXECUTE FUNCTION identity.protect_coach_certificate_line();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""DROP FUNCTION IF EXISTS identity.protect_coach_certificate_line() CASCADE;""");

            migrationBuilder.DropTable(
                name: "CoachCertificateLines",
                schema: "identity");
        }
    }
}
