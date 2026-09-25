using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class EnrollmentPauseHistory : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "EnrollmentStatusChanges",
                schema: "subscriptions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false),
                    EnrollmentId = table.Column<Guid>(type: "uuid", nullable: false),
                    Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    ChangedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EnrollmentStatusChanges", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_EnrollmentStatusChanges_TenantId_EnrollmentId_ChangedAtUtc",
                schema: "subscriptions",
                table: "EnrollmentStatusChanges",
                columns: new[] { "TenantId", "EnrollmentId", "ChangedAtUtc" });

            // ADR 0028. Enrollment history: a row per insert and per status change, so billing can tell
            // how long a plan was paused after it has been resumed. The time is the row's own audit
            // stamp (the application clock), or the transaction time for a raw update that did not touch
            // it. Existing enrollments are backfilled with their current status at the best time on
            // record; a pause that already ended before this migration is unknown and still counts.
            migrationBuilder.Sql(
                """
                INSERT INTO subscriptions."EnrollmentStatusChanges"
                    ("Id", "TenantId", "EnrollmentId", "Status", "ChangedAtUtc")
                SELECT uuidv7(), e."TenantId", e."Id", e."Status",
                       CASE e."Status"
                           WHEN 'Paused' THEN COALESCE(e."PausedAtUtc", e."UpdatedAtUtc")
                           WHEN 'Cancelled' THEN COALESCE(e."CancelledAtUtc", e."UpdatedAtUtc")
                           WHEN 'Expired' THEN COALESCE(e."ExpiredAtUtc", e."UpdatedAtUtc")
                           ELSE e."CreatedAtUtc"
                       END
                FROM subscriptions."ClientEnrollments" e;

                CREATE OR REPLACE FUNCTION subscriptions.record_enrollment_status()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $function$
                BEGIN
                    IF TG_OP = 'INSERT' OR NEW."Status" IS DISTINCT FROM OLD."Status" THEN
                        INSERT INTO subscriptions."EnrollmentStatusChanges"
                            ("Id", "TenantId", "EnrollmentId", "Status", "ChangedAtUtc")
                        VALUES (
                            uuidv7(), NEW."TenantId", NEW."Id", NEW."Status",
                            CASE
                                WHEN TG_OP = 'INSERT' THEN NEW."CreatedAtUtc"
                                WHEN NEW."UpdatedAtUtc" IS DISTINCT FROM OLD."UpdatedAtUtc" THEN NEW."UpdatedAtUtc"
                                ELSE now()
                            END);
                    END IF;
                    RETURN NULL;
                END;
                $function$;

                CREATE TRIGGER "TR_ClientEnrollments_RecordStatus"
                AFTER INSERT OR UPDATE OF "Status" ON subscriptions."ClientEnrollments"
                FOR EACH ROW EXECUTE FUNCTION subscriptions.record_enrollment_status();

                CREATE TRIGGER "TR_EnrollmentStatusChanges_AppendOnly"
                BEFORE UPDATE OR DELETE ON subscriptions."EnrollmentStatusChanges"
                FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                DROP TRIGGER IF EXISTS "TR_ClientEnrollments_RecordStatus" ON subscriptions."ClientEnrollments";
                DROP FUNCTION IF EXISTS subscriptions.record_enrollment_status();
                """);

            migrationBuilder.DropTable(
                name: "EnrollmentStatusChanges",
                schema: "subscriptions");
        }
    }
}
