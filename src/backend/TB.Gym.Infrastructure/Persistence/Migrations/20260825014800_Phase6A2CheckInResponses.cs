using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Phase6A2CheckInResponses : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddUniqueConstraint(
                name: "AK_CheckInQuestions_TenantId_FormVersionId_Id_QuestionType",
                schema: "checkins",
                table: "CheckInQuestions",
                columns: new[] { "TenantId", "FormVersionId", "Id", "QuestionType" });

            migrationBuilder.AddUniqueConstraint(
                name: "AK_CheckInQuestionOptions_TenantId_QuestionId_Id",
                schema: "checkins",
                table: "CheckInQuestionOptions",
                columns: new[] { "TenantId", "QuestionId", "Id" });

            migrationBuilder.AddUniqueConstraint(
                name: "AK_CheckInAssignments_TenantId_Id_FormVersionId_ClientProfileId",
                schema: "checkins",
                table: "CheckInAssignments",
                columns: new[] { "TenantId", "Id", "FormVersionId", "ClientProfileId" });

            migrationBuilder.CreateTable(
                name: "CheckInResponses",
                schema: "checkins",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AssignmentId = table.Column<Guid>(type: "uuid", nullable: false),
                    FormVersionId = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientProfileId = table.Column<Guid>(type: "uuid", nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    SubmittedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    SubmittedDate = table.Column<DateOnly>(type: "date", nullable: true),
                    ReviewedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ReviewedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CheckInResponses", x => x.Id);
                    table.UniqueConstraint("AK_CheckInResponses_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.UniqueConstraint("AK_CheckInResponses_TenantId_Id_FormVersionId", x => new { x.TenantId, x.Id, x.FormVersionId });
                    table.CheckConstraint("CK_CheckInResponses_Review", "(\"Status\" = 'Reviewed') = (\"ReviewedAtUtc\" IS NOT NULL) AND (\"ReviewedAtUtc\" IS NULL) = (\"ReviewedByUserId\" IS NULL)");
                    table.CheckConstraint("CK_CheckInResponses_Submission", "(\"Status\" = 'Draft') = (\"SubmittedAtUtc\" IS NULL) AND (\"SubmittedAtUtc\" IS NULL) = (\"SubmittedDate\" IS NULL)");
                    table.ForeignKey(
                        name: "FK_CheckInResponses_CheckInAssignments_TenantId_AssignmentId_F~",
                        columns: x => new { x.TenantId, x.AssignmentId, x.FormVersionId, x.ClientProfileId },
                        principalSchema: "checkins",
                        principalTable: "CheckInAssignments",
                        principalColumns: new[] { "TenantId", "Id", "FormVersionId", "ClientProfileId" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "CheckInAnswers",
                schema: "checkins",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ResponseId = table.Column<Guid>(type: "uuid", nullable: false),
                    FormVersionId = table.Column<Guid>(type: "uuid", nullable: false),
                    QuestionId = table.Column<Guid>(type: "uuid", nullable: false),
                    QuestionType = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    TextValue = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    NumericValue = table.Column<decimal>(type: "numeric(10,3)", precision: 10, scale: 3, nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CheckInAnswers", x => x.Id);
                    table.UniqueConstraint("AK_CheckInAnswers_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.UniqueConstraint("AK_CheckInAnswers_TenantId_Id_QuestionId", x => new { x.TenantId, x.Id, x.QuestionId });
                    table.CheckConstraint("CK_CheckInAnswers_ValueShape", "(\"QuestionType\" IN ('ShortText', 'LongText') AND \"NumericValue\" IS NULL) OR (\"QuestionType\" = 'NumericScale' AND \"TextValue\" IS NULL) OR (\"QuestionType\" IN ('SingleChoice', 'MultipleChoice') AND \"TextValue\" IS NULL AND \"NumericValue\" IS NULL)");
                    table.ForeignKey(
                        name: "FK_CheckInAnswers_CheckInQuestions_TenantId_FormVersionId_Ques~",
                        columns: x => new { x.TenantId, x.FormVersionId, x.QuestionId, x.QuestionType },
                        principalSchema: "checkins",
                        principalTable: "CheckInQuestions",
                        principalColumns: new[] { "TenantId", "FormVersionId", "Id", "QuestionType" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CheckInAnswers_CheckInResponses_TenantId_ResponseId_FormVer~",
                        columns: x => new { x.TenantId, x.ResponseId, x.FormVersionId },
                        principalSchema: "checkins",
                        principalTable: "CheckInResponses",
                        principalColumns: new[] { "TenantId", "Id", "FormVersionId" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "CheckInResponseEvents",
                schema: "checkins",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    EventType = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    ResponseId = table.Column<Guid>(type: "uuid", nullable: false),
                    AssignmentId = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientProfileId = table.Column<Guid>(type: "uuid", nullable: false),
                    OccurredAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ActorUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CheckInResponseEvents", x => x.Id);
                    table.UniqueConstraint("AK_CheckInResponseEvents_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_CheckInResponseEvents_CheckInResponses_TenantId_ResponseId",
                        columns: x => new { x.TenantId, x.ResponseId },
                        principalSchema: "checkins",
                        principalTable: "CheckInResponses",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "CheckInAnswerChoices",
                schema: "checkins",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    AnswerId = table.Column<Guid>(type: "uuid", nullable: false),
                    QuestionId = table.Column<Guid>(type: "uuid", nullable: false),
                    QuestionOptionId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CheckInAnswerChoices", x => x.Id);
                    table.UniqueConstraint("AK_CheckInAnswerChoices_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_CheckInAnswerChoices_CheckInAnswers_TenantId_AnswerId_Quest~",
                        columns: x => new { x.TenantId, x.AnswerId, x.QuestionId },
                        principalSchema: "checkins",
                        principalTable: "CheckInAnswers",
                        principalColumns: new[] { "TenantId", "Id", "QuestionId" },
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_CheckInAnswerChoices_CheckInQuestionOptions_TenantId_Questi~",
                        columns: x => new { x.TenantId, x.QuestionId, x.QuestionOptionId },
                        principalSchema: "checkins",
                        principalTable: "CheckInQuestionOptions",
                        principalColumns: new[] { "TenantId", "QuestionId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CheckInAnswerChoices_TenantId_AnswerId_QuestionId",
                schema: "checkins",
                table: "CheckInAnswerChoices",
                columns: new[] { "TenantId", "AnswerId", "QuestionId" });

            migrationBuilder.CreateIndex(
                name: "IX_CheckInAnswerChoices_TenantId_AnswerId_QuestionOptionId",
                schema: "checkins",
                table: "CheckInAnswerChoices",
                columns: new[] { "TenantId", "AnswerId", "QuestionOptionId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CheckInAnswerChoices_TenantId_QuestionId_QuestionOptionId",
                schema: "checkins",
                table: "CheckInAnswerChoices",
                columns: new[] { "TenantId", "QuestionId", "QuestionOptionId" });

            migrationBuilder.CreateIndex(
                name: "IX_CheckInAnswers_TenantId_FormVersionId_QuestionId_QuestionTy~",
                schema: "checkins",
                table: "CheckInAnswers",
                columns: new[] { "TenantId", "FormVersionId", "QuestionId", "QuestionType" });

            migrationBuilder.CreateIndex(
                name: "IX_CheckInAnswers_TenantId_ResponseId_FormVersionId",
                schema: "checkins",
                table: "CheckInAnswers",
                columns: new[] { "TenantId", "ResponseId", "FormVersionId" });

            migrationBuilder.CreateIndex(
                name: "IX_CheckInAnswers_TenantId_ResponseId_QuestionId",
                schema: "checkins",
                table: "CheckInAnswers",
                columns: new[] { "TenantId", "ResponseId", "QuestionId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CheckInResponseEvents_TenantId_ClientProfileId_OccurredAtUtc",
                schema: "checkins",
                table: "CheckInResponseEvents",
                columns: new[] { "TenantId", "ClientProfileId", "OccurredAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_CheckInResponseEvents_TenantId_ResponseId_EventType",
                schema: "checkins",
                table: "CheckInResponseEvents",
                columns: new[] { "TenantId", "ResponseId", "EventType" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CheckInResponseEvents_TenantId_ResponseId_OccurredAtUtc",
                schema: "checkins",
                table: "CheckInResponseEvents",
                columns: new[] { "TenantId", "ResponseId", "OccurredAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_CheckInResponses_TenantId_AssignmentId",
                schema: "checkins",
                table: "CheckInResponses",
                columns: new[] { "TenantId", "AssignmentId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CheckInResponses_TenantId_AssignmentId_FormVersionId_Client~",
                schema: "checkins",
                table: "CheckInResponses",
                columns: new[] { "TenantId", "AssignmentId", "FormVersionId", "ClientProfileId" });

            migrationBuilder.CreateIndex(
                name: "IX_CheckInResponses_TenantId_ClientProfileId_Status",
                schema: "checkins",
                table: "CheckInResponses",
                columns: new[] { "TenantId", "ClientProfileId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_CheckInResponses_TenantId_FormVersionId",
                schema: "checkins",
                table: "CheckInResponses",
                columns: new[] { "TenantId", "FormVersionId" });

            // The response lifecycle is one-way at the database, not only in the domain, for the same
            // reason a published version is: a repair script, a migration or a future background job
            // does not pass through the application's guards. This mirrors the bodyweight void trigger
            // of ADR 0015 — a permitted transition list, frozen identity, and refused deletes.
            migrationBuilder.Sql(
                """
                CREATE TRIGGER "TR_CheckInResponseEvents_AppendOnly"
                    BEFORE UPDATE OR DELETE ON checkins."CheckInResponseEvents"
                    FOR EACH ROW EXECUTE FUNCTION checkins.reject_update_delete();

                CREATE OR REPLACE FUNCTION checkins.protect_check_in_response()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Check-in responses cannot be deleted' USING ERRCODE = '23514';
                    END IF;
                    IF OLD."Id" <> NEW."Id"
                       OR OLD."TenantId" <> NEW."TenantId"
                       OR OLD."AssignmentId" <> NEW."AssignmentId"
                       OR OLD."FormVersionId" <> NEW."FormVersionId"
                       OR OLD."ClientProfileId" <> NEW."ClientProfileId"
                       OR OLD."CreatedAtUtc" <> NEW."CreatedAtUtc"
                       OR OLD."CreatedByUserId" IS DISTINCT FROM NEW."CreatedByUserId" THEN
                        RAISE EXCEPTION 'A check-in response identity is immutable' USING ERRCODE = '23514';
                    END IF;
                    IF OLD."Status" = 'Reviewed' THEN
                        RAISE EXCEPTION 'A reviewed check-in response is immutable' USING ERRCODE = '23514';
                    END IF;
                    IF OLD."Status" = 'Submitted' AND NEW."Status" <> 'Reviewed' THEN
                        RAISE EXCEPTION 'A submitted check-in response may only move to Reviewed' USING ERRCODE = '23514';
                    END IF;
                    IF OLD."Status" = 'Draft' AND NEW."Status" NOT IN ('Draft', 'Submitted') THEN
                        RAISE EXCEPTION 'A check-in response may only move from Draft to Submitted' USING ERRCODE = '23514';
                    END IF;
                    IF OLD."Status" <> 'Draft'
                       AND (OLD."SubmittedAtUtc" IS DISTINCT FROM NEW."SubmittedAtUtc"
                            OR OLD."SubmittedDate" IS DISTINCT FROM NEW."SubmittedDate") THEN
                        RAISE EXCEPTION 'A submitted check-in keeps the moment it was submitted' USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER "TR_CheckInResponses_Protect"
                    BEFORE UPDATE OR DELETE ON checkins."CheckInResponses"
                    FOR EACH ROW EXECUTE FUNCTION checkins.protect_check_in_response();
                """);

            // Submitting freezes every answer row beneath the response. The guard fires on INSERT as
            // well as UPDATE and DELETE, because adding a late answer to a submitted check-in would
            // change the record just as much as editing one.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION checkins.protect_check_in_answer()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                DECLARE
                    parent_status text;
                    owning_response uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD."ResponseId" ELSE NEW."ResponseId" END;
                BEGIN
                    SELECT response."Status" INTO parent_status
                    FROM checkins."CheckInResponses" response
                    WHERE response."Id" = owning_response;
                    IF parent_status IS NOT NULL AND parent_status <> 'Draft' THEN
                        RAISE EXCEPTION 'The answers of a submitted check-in are frozen' USING ERRCODE = '23514';
                    END IF;
                    IF TG_OP = 'DELETE' THEN
                        RETURN OLD;
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER "TR_CheckInAnswers_Protect"
                    BEFORE INSERT OR UPDATE OR DELETE ON checkins."CheckInAnswers"
                    FOR EACH ROW EXECUTE FUNCTION checkins.protect_check_in_answer();

                CREATE OR REPLACE FUNCTION checkins.protect_check_in_answer_choice()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                DECLARE
                    parent_status text;
                    owning_answer uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD."AnswerId" ELSE NEW."AnswerId" END;
                BEGIN
                    -- A null status means the answer row is already gone, which only happens when the
                    -- draft rewrite that removed it cascaded here first. The answer's own trigger is
                    -- what decided that deletion was allowed.
                    SELECT response."Status" INTO parent_status
                    FROM checkins."CheckInAnswers" answer
                    JOIN checkins."CheckInResponses" response ON response."Id" = answer."ResponseId"
                    WHERE answer."Id" = owning_answer;
                    IF parent_status IS NOT NULL AND parent_status <> 'Draft' THEN
                        RAISE EXCEPTION 'The answers of a submitted check-in are frozen' USING ERRCODE = '23514';
                    END IF;
                    IF TG_OP = 'DELETE' THEN
                        RETURN OLD;
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER "TR_CheckInAnswerChoices_Protect"
                    BEFORE INSERT OR UPDATE OR DELETE ON checkins."CheckInAnswerChoices"
                    FOR EACH ROW EXECUTE FUNCTION checkins.protect_check_in_answer_choice();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Rolling back discards every answer a client has recorded and every submission and review
            // of them; there is nowhere else that content lives. Dropping the tables removes their own
            // triggers, so only the functions have to be dropped explicitly afterwards.
            migrationBuilder.DropTable(
                name: "CheckInAnswerChoices",
                schema: "checkins");

            migrationBuilder.DropTable(
                name: "CheckInResponseEvents",
                schema: "checkins");

            migrationBuilder.DropTable(
                name: "CheckInAnswers",
                schema: "checkins");

            migrationBuilder.DropTable(
                name: "CheckInResponses",
                schema: "checkins");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_CheckInQuestions_TenantId_FormVersionId_Id_QuestionType",
                schema: "checkins",
                table: "CheckInQuestions");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_CheckInQuestionOptions_TenantId_QuestionId_Id",
                schema: "checkins",
                table: "CheckInQuestionOptions");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_CheckInAssignments_TenantId_Id_FormVersionId_ClientProfileId",
                schema: "checkins",
                table: "CheckInAssignments");

            migrationBuilder.Sql(
                """
                DROP FUNCTION IF EXISTS checkins.protect_check_in_answer_choice();
                DROP FUNCTION IF EXISTS checkins.protect_check_in_answer();
                DROP FUNCTION IF EXISTS checkins.protect_check_in_response();
                """);
        }
    }
}
