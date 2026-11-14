using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class HousePrograms : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "HouseProgramListings",
                schema: "training",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TemplateId = table.Column<Guid>(type: "uuid", nullable: false),
                    Suits = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    RunName = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    RunKey = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    RunPosition = table.Column<int>(type: "integer", nullable: true),
                    LoadIncrement = table.Column<decimal>(type: "numeric(8,3)", precision: 8, scale: 3, nullable: false),
                    LoadRoundingMode = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    IsOffered = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_HouseProgramListings", x => x.Id);
                    table.UniqueConstraint("AK_HouseProgramListings_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_HouseProgramListings_LoadIncrement", "\"LoadIncrement\" > 0 AND \"LoadIncrement\" <= 50");
                    table.CheckConstraint("CK_HouseProgramListings_Run", "(\"RunName\" IS NULL AND \"RunKey\" IS NULL AND \"RunPosition\" IS NULL) OR (\"RunName\" IS NOT NULL AND \"RunKey\" IS NOT NULL AND \"RunPosition\" IS NOT NULL AND \"RunPosition\" BETWEEN 1 AND 52)");
                    table.CheckConstraint("CK_HouseProgramListings_Suits", "length(btrim(\"Suits\")) > 0");
                    table.ForeignKey(
                        name: "FK_HouseProgramListings_ProgramTemplates_TenantId_TemplateId",
                        columns: x => new { x.TenantId, x.TemplateId },
                        principalSchema: "training",
                        principalTable: "ProgramTemplates",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "HouseProgramStarts",
                schema: "training",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientProfileId = table.Column<Guid>(type: "uuid", nullable: false),
                    MesocycleId = table.Column<Guid>(type: "uuid", nullable: false),
                    ListingId = table.Column<Guid>(type: "uuid", nullable: false),
                    TemplateId = table.Column<Guid>(type: "uuid", nullable: false),
                    TemplateVersionId = table.Column<Guid>(type: "uuid", nullable: false),
                    EnrollmentId = table.Column<Guid>(type: "uuid", nullable: false),
                    RunName = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    RunKey = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    RunPosition = table.Column<int>(type: "integer", nullable: true),
                    StartDate = table.Column<DateOnly>(type: "date", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_HouseProgramStarts", x => x.Id);
                    table.UniqueConstraint("AK_HouseProgramStarts_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_HouseProgramStarts_Run", "(\"RunName\" IS NULL AND \"RunKey\" IS NULL AND \"RunPosition\" IS NULL) OR (\"RunName\" IS NOT NULL AND \"RunKey\" IS NOT NULL AND \"RunPosition\" IS NOT NULL AND \"RunPosition\" BETWEEN 1 AND 52)");
                    table.ForeignKey(
                        name: "FK_HouseProgramStarts_ClientEnrollments_TenantId_EnrollmentId",
                        columns: x => new { x.TenantId, x.EnrollmentId },
                        principalSchema: "subscriptions",
                        principalTable: "ClientEnrollments",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_HouseProgramStarts_ClientProfiles_TenantId_ClientProfileId",
                        columns: x => new { x.TenantId, x.ClientProfileId },
                        principalSchema: "clients",
                        principalTable: "ClientProfiles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_HouseProgramStarts_HouseProgramListings_TenantId_ListingId",
                        columns: x => new { x.TenantId, x.ListingId },
                        principalSchema: "training",
                        principalTable: "HouseProgramListings",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_HouseProgramStarts_Mesocycles_TenantId_MesocycleId",
                        columns: x => new { x.TenantId, x.MesocycleId },
                        principalSchema: "training",
                        principalTable: "Mesocycles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_HouseProgramStarts_ProgramTemplateVersions_TenantId_Templat~",
                        columns: x => new { x.TenantId, x.TemplateVersionId },
                        principalSchema: "training",
                        principalTable: "ProgramTemplateVersions",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "UX_HouseProgramListings_OfferedRunPlace",
                schema: "training",
                table: "HouseProgramListings",
                columns: new[] { "TenantId", "RunKey", "RunPosition" },
                unique: true,
                filter: "\"IsOffered\" AND \"RunKey\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "UX_HouseProgramListings_Template",
                schema: "training",
                table: "HouseProgramListings",
                columns: new[] { "TenantId", "TemplateId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_HouseProgramStarts_TenantId_ClientProfileId_RunKey_RunPosit~",
                schema: "training",
                table: "HouseProgramStarts",
                columns: new[] { "TenantId", "ClientProfileId", "RunKey", "RunPosition" });

            migrationBuilder.CreateIndex(
                name: "IX_HouseProgramStarts_TenantId_EnrollmentId",
                schema: "training",
                table: "HouseProgramStarts",
                columns: new[] { "TenantId", "EnrollmentId" });

            migrationBuilder.CreateIndex(
                name: "IX_HouseProgramStarts_TenantId_ListingId",
                schema: "training",
                table: "HouseProgramStarts",
                columns: new[] { "TenantId", "ListingId" });

            migrationBuilder.CreateIndex(
                name: "IX_HouseProgramStarts_TenantId_TemplateVersionId",
                schema: "training",
                table: "HouseProgramStarts",
                columns: new[] { "TenantId", "TemplateVersionId" });

            migrationBuilder.CreateIndex(
                name: "UX_HouseProgramStarts_Mesocycle",
                schema: "training",
                table: "HouseProgramStarts",
                columns: new[] { "TenantId", "MesocycleId" },
                unique: true);

            // The house's alone (TRN-034); a start names the trainee's own program of the version it says, under their
            // own Pro+ plan, from the list entry of its program; and a start is never rewritten.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION training.guard_house_program_start()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $function$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM training."Mesocycles" block
                        WHERE block."TenantId" = NEW."TenantId" AND block."Id" = NEW."MesocycleId"
                            AND block."ClientProfileId" = NEW."ClientProfileId"
                            AND block."EnrollmentId" = NEW."EnrollmentId"
                            AND block."SourceTemplateId" = NEW."TemplateId"
                            AND block."SourceTemplateVersionId" = NEW."TemplateVersionId"
                            AND block."StartDate" = NEW."StartDate") THEN
                        RAISE EXCEPTION 'A started program is the trainee''s own program of that version under that plan' USING ERRCODE = '23514';
                    END IF;
                    IF NOT EXISTS (
                        SELECT 1
                        FROM subscriptions."ClientEnrollments" enrollment
                        JOIN clients."ClientProfiles" profile
                            ON profile."TenantId" = enrollment."TenantId" AND profile."Id" = enrollment."ClientProfileId"
                        WHERE enrollment."TenantId" = NEW."TenantId" AND enrollment."Id" = NEW."EnrollmentId"
                            AND enrollment."ClientProfileId" = NEW."ClientProfileId"
                            AND enrollment."HouseTier" = 'ProPlus'
                            AND profile."IsSelfDirected") THEN
                        RAISE EXCEPTION 'A self-directed trainee starts a program under their own Pro+ plan' USING ERRCODE = '23514';
                    END IF;
                    IF NOT EXISTS (
                        SELECT 1 FROM training."HouseProgramListings" listing
                        WHERE listing."TenantId" = NEW."TenantId" AND listing."Id" = NEW."ListingId"
                            AND listing."TemplateId" = NEW."TemplateId") THEN
                        RAISE EXCEPTION 'A started program names the list entry of its program' USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER "TR_HouseProgramListings_House"
                BEFORE INSERT ON training."HouseProgramListings"
                FOR EACH ROW EXECUTE FUNCTION tenancy.assert_house_row();

                CREATE TRIGGER "TR_HouseProgramStarts_House"
                BEFORE INSERT ON training."HouseProgramStarts"
                FOR EACH ROW EXECUTE FUNCTION tenancy.assert_house_row();

                CREATE TRIGGER "TR_HouseProgramStarts_Guard"
                BEFORE INSERT ON training."HouseProgramStarts"
                FOR EACH ROW EXECUTE FUNCTION training.guard_house_program_start();

                CREATE TRIGGER "TR_HouseProgramStarts_AppendOnly"
                BEFORE UPDATE OR DELETE ON training."HouseProgramStarts"
                FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // A program a trainee started is a fact the schema before this cannot hold: stop with a plain message while
            // any exists instead of dropping it. The tables take their triggers with them; the guard goes after them.
            migrationBuilder.Sql(
                """
                DO $migration$
                BEGIN
                    IF EXISTS (SELECT 1 FROM training."HouseProgramStarts") THEN
                        RAISE EXCEPTION 'Trainees started the house''s programs; roll forward instead of reverting this migration.'
                            USING ERRCODE = '55000';
                    END IF;
                END;
                $migration$;
                """);

            migrationBuilder.DropTable(
                name: "HouseProgramStarts",
                schema: "training");

            migrationBuilder.DropTable(
                name: "HouseProgramListings",
                schema: "training");

            migrationBuilder.Sql("DROP FUNCTION IF EXISTS training.guard_house_program_start();");
        }
    }
}
