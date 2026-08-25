using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Phase6A1CheckInFormLibrary : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "checkins");

            migrationBuilder.CreateTable(
                name: "CheckInForms",
                schema: "checkins",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Title = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    Description = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    IsArchived = table.Column<bool>(type: "boolean", nullable: false),
                    CurrentVersionNumber = table.Column<int>(type: "integer", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CheckInForms", x => x.Id);
                    table.UniqueConstraint("AK_CheckInForms_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_CheckInForms_CurrentVersionNumber", "\"CurrentVersionNumber\" >= 0");
                });

            migrationBuilder.CreateTable(
                name: "CheckInFormVersions",
                schema: "checkins",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    FormId = table.Column<Guid>(type: "uuid", nullable: false),
                    VersionNumber = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    IsDraft = table.Column<bool>(type: "boolean", nullable: false),
                    DerivedFromVersionId = table.Column<Guid>(type: "uuid", nullable: true),
                    PublishedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    PublishedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CheckInFormVersions", x => x.Id);
                    table.UniqueConstraint("AK_CheckInFormVersions_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_CheckInFormVersions_IsDraft", "(\"Status\" = 'Draft') = \"IsDraft\"");
                    table.CheckConstraint("CK_CheckInFormVersions_Published", "\"Status\" <> 'Published' OR (\"PublishedAtUtc\" IS NOT NULL AND \"PublishedByUserId\" IS NOT NULL)");
                    table.CheckConstraint("CK_CheckInFormVersions_VersionNumber", "\"VersionNumber\" >= 1");
                    table.ForeignKey(
                        name: "FK_CheckInFormVersions_CheckInFormVersions_TenantId_DerivedFro~",
                        columns: x => new { x.TenantId, x.DerivedFromVersionId },
                        principalSchema: "checkins",
                        principalTable: "CheckInFormVersions",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CheckInFormVersions_CheckInForms_TenantId_FormId",
                        columns: x => new { x.TenantId, x.FormId },
                        principalSchema: "checkins",
                        principalTable: "CheckInForms",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "CheckInAssignments",
                schema: "checkins",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    FormId = table.Column<Guid>(type: "uuid", nullable: false),
                    FormVersionId = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientProfileId = table.Column<Guid>(type: "uuid", nullable: false),
                    DueDate = table.Column<DateOnly>(type: "date", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CheckInAssignments", x => x.Id);
                    table.UniqueConstraint("AK_CheckInAssignments_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_CheckInAssignments_CheckInFormVersions_TenantId_FormVersion~",
                        columns: x => new { x.TenantId, x.FormVersionId },
                        principalSchema: "checkins",
                        principalTable: "CheckInFormVersions",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CheckInAssignments_CheckInForms_TenantId_FormId",
                        columns: x => new { x.TenantId, x.FormId },
                        principalSchema: "checkins",
                        principalTable: "CheckInForms",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CheckInAssignments_ClientProfiles_TenantId_ClientProfileId",
                        columns: x => new { x.TenantId, x.ClientProfileId },
                        principalSchema: "clients",
                        principalTable: "ClientProfiles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "CheckInQuestions",
                schema: "checkins",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    FormVersionId = table.Column<Guid>(type: "uuid", nullable: false),
                    QuestionKey = table.Column<string>(type: "character(32)", fixedLength: true, maxLength: 32, nullable: false),
                    Order = table.Column<int>(type: "integer", nullable: false),
                    QuestionType = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    Prompt = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    HelpText = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    IsRequired = table.Column<bool>(type: "boolean", nullable: false),
                    ScaleMinimum = table.Column<decimal>(type: "numeric(10,3)", precision: 10, scale: 3, nullable: true),
                    ScaleMaximum = table.Column<decimal>(type: "numeric(10,3)", precision: 10, scale: 3, nullable: true),
                    ScaleStep = table.Column<decimal>(type: "numeric(10,3)", precision: 10, scale: 3, nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CheckInQuestions", x => x.Id);
                    table.UniqueConstraint("AK_CheckInQuestions_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_CheckInQuestions_Order", "\"Order\" >= 1");
                    table.CheckConstraint("CK_CheckInQuestions_QuestionKey", "\"QuestionKey\" ~ '^[0-9a-f]{32}$'");
                    table.CheckConstraint("CK_CheckInQuestions_Scale", "(\"QuestionType\" = 'NumericScale' AND \"ScaleMinimum\" IS NOT NULL AND \"ScaleMaximum\" IS NOT NULL AND \"ScaleStep\" IS NOT NULL AND \"ScaleMinimum\" < \"ScaleMaximum\" AND \"ScaleStep\" > 0 AND (\"ScaleMaximum\" - \"ScaleMinimum\") % \"ScaleStep\" = 0) OR (\"QuestionType\" <> 'NumericScale' AND \"ScaleMinimum\" IS NULL AND \"ScaleMaximum\" IS NULL AND \"ScaleStep\" IS NULL)");
                    table.ForeignKey(
                        name: "FK_CheckInQuestions_CheckInFormVersions_TenantId_FormVersionId",
                        columns: x => new { x.TenantId, x.FormVersionId },
                        principalSchema: "checkins",
                        principalTable: "CheckInFormVersions",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "CheckInLifecycleEvents",
                schema: "checkins",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    EventType = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    FormId = table.Column<Guid>(type: "uuid", nullable: false),
                    FormVersionId = table.Column<Guid>(type: "uuid", nullable: false),
                    AssignmentId = table.Column<Guid>(type: "uuid", nullable: true),
                    ClientProfileId = table.Column<Guid>(type: "uuid", nullable: true),
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
                    table.PrimaryKey("PK_CheckInLifecycleEvents", x => x.Id);
                    table.UniqueConstraint("AK_CheckInLifecycleEvents_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_CheckInLifecycleEvents_Assignment", "(\"EventType\" = 'AssignmentCreated') = (\"AssignmentId\" IS NOT NULL) AND (\"EventType\" = 'AssignmentCreated') = (\"ClientProfileId\" IS NOT NULL)");
                    table.ForeignKey(
                        name: "FK_CheckInLifecycleEvents_CheckInAssignments_TenantId_Assignme~",
                        columns: x => new { x.TenantId, x.AssignmentId },
                        principalSchema: "checkins",
                        principalTable: "CheckInAssignments",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CheckInLifecycleEvents_CheckInFormVersions_TenantId_FormVer~",
                        columns: x => new { x.TenantId, x.FormVersionId },
                        principalSchema: "checkins",
                        principalTable: "CheckInFormVersions",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CheckInLifecycleEvents_CheckInForms_TenantId_FormId",
                        columns: x => new { x.TenantId, x.FormId },
                        principalSchema: "checkins",
                        principalTable: "CheckInForms",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "CheckInQuestionOptions",
                schema: "checkins",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    QuestionId = table.Column<Guid>(type: "uuid", nullable: false),
                    Order = table.Column<int>(type: "integer", nullable: false),
                    Label = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CheckInQuestionOptions", x => x.Id);
                    table.UniqueConstraint("AK_CheckInQuestionOptions_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_CheckInQuestionOptions_Order", "\"Order\" >= 1");
                    table.ForeignKey(
                        name: "FK_CheckInQuestionOptions_CheckInQuestions_TenantId_QuestionId",
                        columns: x => new { x.TenantId, x.QuestionId },
                        principalSchema: "checkins",
                        principalTable: "CheckInQuestions",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CheckInAssignments_TenantId_ClientProfileId_DueDate",
                schema: "checkins",
                table: "CheckInAssignments",
                columns: new[] { "TenantId", "ClientProfileId", "DueDate" });

            migrationBuilder.CreateIndex(
                name: "IX_CheckInAssignments_TenantId_ClientProfileId_FormId_DueDate",
                schema: "checkins",
                table: "CheckInAssignments",
                columns: new[] { "TenantId", "ClientProfileId", "FormId", "DueDate" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CheckInAssignments_TenantId_FormId",
                schema: "checkins",
                table: "CheckInAssignments",
                columns: new[] { "TenantId", "FormId" });

            migrationBuilder.CreateIndex(
                name: "IX_CheckInAssignments_TenantId_FormVersionId",
                schema: "checkins",
                table: "CheckInAssignments",
                columns: new[] { "TenantId", "FormVersionId" });

            migrationBuilder.CreateIndex(
                name: "IX_CheckInForms_TenantId_IsArchived_Title",
                schema: "checkins",
                table: "CheckInForms",
                columns: new[] { "TenantId", "IsArchived", "Title" });

            migrationBuilder.CreateIndex(
                name: "IX_CheckInFormVersions_TenantId_DerivedFromVersionId",
                schema: "checkins",
                table: "CheckInFormVersions",
                columns: new[] { "TenantId", "DerivedFromVersionId" });

            migrationBuilder.CreateIndex(
                name: "IX_CheckInFormVersions_TenantId_FormId",
                schema: "checkins",
                table: "CheckInFormVersions",
                columns: new[] { "TenantId", "FormId" },
                unique: true,
                filter: "\"IsDraft\"");

            migrationBuilder.CreateIndex(
                name: "IX_CheckInFormVersions_TenantId_FormId_VersionNumber",
                schema: "checkins",
                table: "CheckInFormVersions",
                columns: new[] { "TenantId", "FormId", "VersionNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CheckInLifecycleEvents_TenantId_AssignmentId",
                schema: "checkins",
                table: "CheckInLifecycleEvents",
                columns: new[] { "TenantId", "AssignmentId" });

            migrationBuilder.CreateIndex(
                name: "IX_CheckInLifecycleEvents_TenantId_FormId_OccurredAtUtc",
                schema: "checkins",
                table: "CheckInLifecycleEvents",
                columns: new[] { "TenantId", "FormId", "OccurredAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_CheckInLifecycleEvents_TenantId_FormVersionId",
                schema: "checkins",
                table: "CheckInLifecycleEvents",
                columns: new[] { "TenantId", "FormVersionId" });

            migrationBuilder.CreateIndex(
                name: "IX_CheckInQuestionOptions_TenantId_QuestionId_Order",
                schema: "checkins",
                table: "CheckInQuestionOptions",
                columns: new[] { "TenantId", "QuestionId", "Order" });

            migrationBuilder.CreateIndex(
                name: "IX_CheckInQuestions_TenantId_FormVersionId_Order",
                schema: "checkins",
                table: "CheckInQuestions",
                columns: new[] { "TenantId", "FormVersionId", "Order" });

            migrationBuilder.CreateIndex(
                name: "IX_CheckInQuestions_TenantId_QuestionKey",
                schema: "checkins",
                table: "CheckInQuestions",
                columns: new[] { "TenantId", "QuestionKey" });

            // A published version is the unit of truth an assignment resolves, so it is frozen at the
            // database rather than only in the domain: a migration, a repair script, or a future
            // background job would not pass through the application's guards.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION checkins.reject_update_delete()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '23514';
                END;
                $function$;

                CREATE TRIGGER "TR_CheckInLifecycleEvents_AppendOnly"
                    BEFORE UPDATE OR DELETE ON checkins."CheckInLifecycleEvents"
                    FOR EACH ROW EXECUTE FUNCTION checkins.reject_update_delete();

                CREATE OR REPLACE FUNCTION checkins.protect_check_in_form_version()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Check-in form versions cannot be deleted' USING ERRCODE = '23514';
                    END IF;
                    IF OLD."Id" <> NEW."Id"
                       OR OLD."TenantId" <> NEW."TenantId"
                       OR OLD."FormId" <> NEW."FormId"
                       OR OLD."VersionNumber" <> NEW."VersionNumber"
                       OR OLD."DerivedFromVersionId" IS DISTINCT FROM NEW."DerivedFromVersionId"
                       OR OLD."CreatedAtUtc" <> NEW."CreatedAtUtc"
                       OR OLD."CreatedByUserId" IS DISTINCT FROM NEW."CreatedByUserId" THEN
                        RAISE EXCEPTION 'Check-in form version identity and original audit fields are immutable' USING ERRCODE = '23514';
                    END IF;
                    IF OLD."Status" = 'Published' THEN
                        RAISE EXCEPTION 'A published check-in form version is immutable' USING ERRCODE = '23514';
                    END IF;
                    IF NEW."Status" <> OLD."Status" AND NEW."Status" <> 'Published' THEN
                        RAISE EXCEPTION 'A check-in form version may only move from Draft to Published' USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER "TR_CheckInFormVersions_Protect"
                    BEFORE UPDATE OR DELETE ON checkins."CheckInFormVersions"
                    FOR EACH ROW EXECUTE FUNCTION checkins.protect_check_in_form_version();

                CREATE OR REPLACE FUNCTION checkins.protect_check_in_question()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                DECLARE
                    parent_status text;
                BEGIN
                    SELECT version."Status" INTO parent_status
                    FROM checkins."CheckInFormVersions" version
                    WHERE version."Id" = CASE WHEN TG_OP = 'DELETE' THEN OLD."FormVersionId" ELSE NEW."FormVersionId" END;
                    IF parent_status = 'Published' THEN
                        RAISE EXCEPTION 'The questions of a published check-in form version are immutable' USING ERRCODE = '23514';
                    END IF;
                    IF TG_OP = 'DELETE' THEN
                        RETURN OLD;
                    END IF;
                    IF OLD."Id" <> NEW."Id"
                       OR OLD."TenantId" <> NEW."TenantId"
                       OR OLD."FormVersionId" <> NEW."FormVersionId"
                       OR OLD."QuestionKey" <> NEW."QuestionKey" THEN
                        RAISE EXCEPTION 'A check-in question key and its owning version are immutable' USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER "TR_CheckInQuestions_Protect"
                    BEFORE UPDATE OR DELETE ON checkins."CheckInQuestions"
                    FOR EACH ROW EXECUTE FUNCTION checkins.protect_check_in_question();

                CREATE OR REPLACE FUNCTION checkins.protect_check_in_question_option()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                DECLARE
                    parent_status text;
                BEGIN
                    SELECT version."Status" INTO parent_status
                    FROM checkins."CheckInQuestions" question
                    JOIN checkins."CheckInFormVersions" version ON version."Id" = question."FormVersionId"
                    WHERE question."Id" = CASE WHEN TG_OP = 'DELETE' THEN OLD."QuestionId" ELSE NEW."QuestionId" END;
                    IF parent_status = 'Published' THEN
                        RAISE EXCEPTION 'The options of a published check-in form version are immutable' USING ERRCODE = '23514';
                    END IF;
                    IF TG_OP = 'DELETE' THEN
                        RETURN OLD;
                    END IF;
                    IF OLD."Id" <> NEW."Id"
                       OR OLD."TenantId" <> NEW."TenantId"
                       OR OLD."QuestionId" <> NEW."QuestionId" THEN
                        RAISE EXCEPTION 'A check-in option identity is immutable' USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER "TR_CheckInQuestionOptions_Protect"
                    BEFORE UPDATE OR DELETE ON checkins."CheckInQuestionOptions"
                    FOR EACH ROW EXECUTE FUNCTION checkins.protect_check_in_question_option();

                CREATE OR REPLACE FUNCTION checkins.protect_check_in_assignment()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Check-in assignments cannot be deleted' USING ERRCODE = '23514';
                    END IF;
                    IF OLD."Id" <> NEW."Id"
                       OR OLD."TenantId" <> NEW."TenantId"
                       OR OLD."FormId" <> NEW."FormId"
                       OR OLD."FormVersionId" <> NEW."FormVersionId"
                       OR OLD."ClientProfileId" <> NEW."ClientProfileId"
                       OR OLD."DueDate" <> NEW."DueDate"
                       OR OLD."CreatedAtUtc" <> NEW."CreatedAtUtc"
                       OR OLD."CreatedByUserId" IS DISTINCT FROM NEW."CreatedByUserId" THEN
                        RAISE EXCEPTION 'A check-in assignment records what a client was asked and is immutable' USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER "TR_CheckInAssignments_Protect"
                    BEFORE UPDATE OR DELETE ON checkins."CheckInAssignments"
                    FOR EACH ROW EXECUTE FUNCTION checkins.protect_check_in_assignment();
                """);

            // Ordering contiguity and per-version key uniqueness are deferred constraint triggers
            // rather than unique indexes on purpose: editing a draft replaces its whole question set,
            // and a plain unique index would reject the intermediate state of that one transaction
            // even though the committed state is correct. Deferring moves the check to commit, where
            // the answer is the one that matters.
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE FUNCTION checkins.assert_question_set()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                DECLARE
                    version_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD."FormVersionId" ELSE NEW."FormVersionId" END;
                    total integer;
                    distinct_orders integer;
                    lowest integer;
                    highest integer;
                    distinct_keys integer;
                BEGIN
                    IF NOT EXISTS (SELECT 1 FROM checkins."CheckInFormVersions" WHERE "Id" = version_id) THEN
                        RETURN NULL;
                    END IF;

                    SELECT count(*), count(DISTINCT "Order"), min("Order"), max("Order"), count(DISTINCT "QuestionKey")
                    INTO total, distinct_orders, lowest, highest, distinct_keys
                    FROM checkins."CheckInQuestions"
                    WHERE "FormVersionId" = version_id;

                    IF total = 0 THEN
                        RAISE EXCEPTION 'A check-in form version requires at least one question' USING ERRCODE = '23514';
                    END IF;
                    IF distinct_orders <> total OR lowest <> 1 OR highest <> total THEN
                        RAISE EXCEPTION 'Check-in question order must be contiguous from 1' USING ERRCODE = '23514';
                    END IF;
                    IF distinct_keys <> total THEN
                        RAISE EXCEPTION 'A check-in question key may appear only once per version' USING ERRCODE = '23514';
                    END IF;
                    IF EXISTS (
                        SELECT 1 FROM checkins."CheckInQuestions" question
                        WHERE question."FormVersionId" = version_id
                          AND question."QuestionType" IN ('SingleChoice', 'MultipleChoice')
                          AND (SELECT count(*) FROM checkins."CheckInQuestionOptions" option_row
                               WHERE option_row."QuestionId" = question."Id") < 2) THEN
                        RAISE EXCEPTION 'A choice question requires at least two options' USING ERRCODE = '23514';
                    END IF;
                    IF EXISTS (
                        SELECT 1 FROM checkins."CheckInQuestions" question
                        WHERE question."FormVersionId" = version_id
                          AND question."QuestionType" NOT IN ('SingleChoice', 'MultipleChoice')
                          AND EXISTS (SELECT 1 FROM checkins."CheckInQuestionOptions" option_row
                                      WHERE option_row."QuestionId" = question."Id")) THEN
                        RAISE EXCEPTION 'Only a choice question may carry options' USING ERRCODE = '23514';
                    END IF;
                    RETURN NULL;
                END;
                $function$;

                CREATE CONSTRAINT TRIGGER "TR_CheckInQuestions_AssertSet"
                    AFTER INSERT OR UPDATE OR DELETE ON checkins."CheckInQuestions"
                    DEFERRABLE INITIALLY DEFERRED
                    FOR EACH ROW EXECUTE FUNCTION checkins.assert_question_set();

                CREATE OR REPLACE FUNCTION checkins.assert_option_set()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                DECLARE
                    owning_question uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD."QuestionId" ELSE NEW."QuestionId" END;
                    total integer;
                    distinct_orders integer;
                    lowest integer;
                    highest integer;
                    distinct_labels integer;
                BEGIN
                    IF NOT EXISTS (SELECT 1 FROM checkins."CheckInQuestions" WHERE "Id" = owning_question) THEN
                        RETURN NULL;
                    END IF;

                    SELECT count(*), count(DISTINCT "Order"), min("Order"), max("Order"),
                           count(DISTINCT lower(btrim("Label")))
                    INTO total, distinct_orders, lowest, highest, distinct_labels
                    FROM checkins."CheckInQuestionOptions"
                    WHERE "QuestionId" = owning_question;

                    IF total = 0 THEN
                        RETURN NULL;
                    END IF;
                    IF distinct_orders <> total OR lowest <> 1 OR highest <> total THEN
                        RAISE EXCEPTION 'Check-in option order must be contiguous from 1' USING ERRCODE = '23514';
                    END IF;
                    IF distinct_labels <> total THEN
                        RAISE EXCEPTION 'Check-in option labels must be distinct within a question' USING ERRCODE = '23514';
                    END IF;
                    RETURN NULL;
                END;
                $function$;

                CREATE CONSTRAINT TRIGGER "TR_CheckInQuestionOptions_AssertSet"
                    AFTER INSERT OR UPDATE OR DELETE ON checkins."CheckInQuestionOptions"
                    DEFERRABLE INITIALLY DEFERRED
                    FOR EACH ROW EXECUTE FUNCTION checkins.assert_option_set();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Rolling back discards every authored form, published version and assignment in the
            // workspace; there is nowhere else that content lives. Dropping the tables removes their
            // triggers, so only the functions have to be dropped explicitly afterwards.
            migrationBuilder.DropTable(
                name: "CheckInLifecycleEvents",
                schema: "checkins");

            migrationBuilder.DropTable(
                name: "CheckInQuestionOptions",
                schema: "checkins");

            migrationBuilder.DropTable(
                name: "CheckInAssignments",
                schema: "checkins");

            migrationBuilder.DropTable(
                name: "CheckInQuestions",
                schema: "checkins");

            migrationBuilder.DropTable(
                name: "CheckInFormVersions",
                schema: "checkins");

            migrationBuilder.DropTable(
                name: "CheckInForms",
                schema: "checkins");

            migrationBuilder.Sql(
                """
                DROP FUNCTION IF EXISTS checkins.assert_option_set();
                DROP FUNCTION IF EXISTS checkins.assert_question_set();
                DROP FUNCTION IF EXISTS checkins.protect_check_in_assignment();
                DROP FUNCTION IF EXISTS checkins.protect_check_in_question_option();
                DROP FUNCTION IF EXISTS checkins.protect_check_in_question();
                DROP FUNCTION IF EXISTS checkins.protect_check_in_form_version();
                DROP FUNCTION IF EXISTS checkins.reject_update_delete();
                """);
        }
    }
}
