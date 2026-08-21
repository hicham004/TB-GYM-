using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Phase3TrainingEngine : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "media");

            migrationBuilder.EnsureSchema(
                name: "exercise_library");

            migrationBuilder.EnsureSchema(
                name: "training");

            migrationBuilder.EnsureSchema(
                name: "strength");

            migrationBuilder.Sql("CREATE EXTENSION IF NOT EXISTS btree_gist;");
            migrationBuilder.Sql("CREATE EXTENSION IF NOT EXISTS pg_trgm;");

            migrationBuilder.CreateTable(
                name: "Assets",
                schema: "media",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OwnerUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Kind = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    Source = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    Status = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    OriginalFileName = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    DeclaredContentType = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    VerifiedContentType = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Length = table.Column<long>(type: "bigint", nullable: true),
                    Sha256 = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: true),
                    StorageKey = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    ExternalProvider = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: true),
                    ExternalMediaId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    ScannerKey = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    ScannerVersion = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    FailureCode = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    IsCoachProtected = table.Column<bool>(type: "boolean", nullable: false),
                    DeletedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    PurgeAfterUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Assets", x => x.Id);
                    table.UniqueConstraint("AK_Assets_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_MediaAssets_Hash", "\"Sha256\" IS NULL OR \"Sha256\" ~ '^[0-9a-f]{64}$'");
                    table.CheckConstraint("CK_MediaAssets_Length", "\"Length\" IS NULL OR (\"Length\" > 0 AND \"Length\" <= 524288000)");
                    table.CheckConstraint("CK_MediaAssets_Source", "(\"Source\" = 'Upload' AND \"StorageKey\" IS NOT NULL AND \"ExternalMediaId\" IS NULL) OR (\"Source\" = 'ExternalEmbed' AND \"StorageKey\" IS NULL AND \"ExternalMediaId\" IS NOT NULL)");
                    table.ForeignKey(
                        name: "FK_Assets_Users_OwnerUserId",
                        column: x => x.OwnerUserId,
                        principalSchema: "identity",
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Exercises",
                schema: "exercise_library",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    NormalizedName = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    Instructions = table.Column<string>(type: "character varying(8000)", maxLength: 8000, nullable: true),
                    Equipment = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    MovementPattern = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    Classification = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    IsArchived = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Exercises", x => x.Id);
                    table.UniqueConstraint("AK_Exercises_TenantId_Id", x => new { x.TenantId, x.Id });
                });

            migrationBuilder.CreateTable(
                name: "ProgramTemplates",
                schema: "training",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    CurrentVersionNumber = table.Column<int>(type: "integer", nullable: false),
                    IsArchived = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProgramTemplates", x => x.Id);
                    table.UniqueConstraint("AK_ProgramTemplates_TenantId_Id", x => new { x.TenantId, x.Id });
                });

            migrationBuilder.CreateTable(
                name: "ExerciseAlternatives",
                schema: "exercise_library",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ExerciseId = table.Column<Guid>(type: "uuid", nullable: false),
                    AlternativeExerciseId = table.Column<Guid>(type: "uuid", nullable: false),
                    Note = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ExerciseAlternatives", x => x.Id);
                    table.UniqueConstraint("AK_ExerciseAlternatives_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_ExerciseAlternatives_DifferentExercise", "\"ExerciseId\" <> \"AlternativeExerciseId\"");
                    table.ForeignKey(
                        name: "FK_ExerciseAlternatives_Exercises_TenantId_AlternativeExercise~",
                        columns: x => new { x.TenantId, x.AlternativeExerciseId },
                        principalSchema: "exercise_library",
                        principalTable: "Exercises",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ExerciseAlternatives_Exercises_TenantId_ExerciseId",
                        columns: x => new { x.TenantId, x.ExerciseId },
                        principalSchema: "exercise_library",
                        principalTable: "Exercises",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ExerciseMediaLinks",
                schema: "exercise_library",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ExerciseId = table.Column<Guid>(type: "uuid", nullable: false),
                    MediaAssetId = table.Column<Guid>(type: "uuid", nullable: false),
                    DisplayOrder = table.Column<int>(type: "integer", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ExerciseMediaLinks", x => x.Id);
                    table.UniqueConstraint("AK_ExerciseMediaLinks_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_ExerciseMediaLinks_DisplayOrder", "\"DisplayOrder\" >= 0");
                    table.ForeignKey(
                        name: "FK_ExerciseMediaLinks_Assets_TenantId_MediaAssetId",
                        columns: x => new { x.TenantId, x.MediaAssetId },
                        principalSchema: "media",
                        principalTable: "Assets",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ExerciseMediaLinks_Exercises_TenantId_ExerciseId",
                        columns: x => new { x.TenantId, x.ExerciseId },
                        principalSchema: "exercise_library",
                        principalTable: "Exercises",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ExerciseMuscles",
                schema: "exercise_library",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ExerciseId = table.Column<Guid>(type: "uuid", nullable: false),
                    Muscle = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Role = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ExerciseMuscles", x => x.Id);
                    table.UniqueConstraint("AK_ExerciseMuscles_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_ExerciseMuscles_Exercises_TenantId_ExerciseId",
                        columns: x => new { x.TenantId, x.ExerciseId },
                        principalSchema: "exercise_library",
                        principalTable: "Exercises",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ExerciseTags",
                schema: "exercise_library",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ExerciseId = table.Column<Guid>(type: "uuid", nullable: false),
                    Value = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    NormalizedValue = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ExerciseTags", x => x.Id);
                    table.UniqueConstraint("AK_ExerciseTags_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_ExerciseTags_Exercises_TenantId_ExerciseId",
                        columns: x => new { x.TenantId, x.ExerciseId },
                        principalSchema: "exercise_library",
                        principalTable: "Exercises",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ProgramTemplateVersions",
                schema: "training",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TemplateId = table.Column<Guid>(type: "uuid", nullable: false),
                    VersionNumber = table.Column<int>(type: "integer", nullable: false),
                    NameSnapshot = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    DescriptionSnapshot = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    IsPublished = table.Column<bool>(type: "boolean", nullable: false),
                    PublishedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProgramTemplateVersions", x => x.Id);
                    table.UniqueConstraint("AK_ProgramTemplateVersions_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_ProgramTemplateVersions_Number", "\"VersionNumber\" >= 1");
                    table.ForeignKey(
                        name: "FK_ProgramTemplateVersions_ProgramTemplates_TenantId_TemplateId",
                        columns: x => new { x.TenantId, x.TemplateId },
                        principalSchema: "training",
                        principalTable: "ProgramTemplates",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Mesocycles",
                schema: "training",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientProfileId = table.Column<Guid>(type: "uuid", nullable: false),
                    EnrollmentId = table.Column<Guid>(type: "uuid", nullable: false),
                    SourceTemplateId = table.Column<Guid>(type: "uuid", nullable: false),
                    SourceTemplateVersionId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    StartDate = table.Column<DateOnly>(type: "date", nullable: false),
                    EndDateExclusive = table.Column<DateOnly>(type: "date", nullable: false),
                    TimeZoneId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Kind = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    Status = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    BlocksPrimaryOverlap = table.Column<bool>(type: "boolean", nullable: false),
                    RevealAllWeeks = table.Column<bool>(type: "boolean", nullable: false),
                    LoadUnit = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    LoadIncrement = table.Column<decimal>(type: "numeric(8,3)", precision: 8, scale: 3, nullable: false),
                    LoadRoundingMode = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    AssignmentCommandId = table.Column<Guid>(type: "uuid", nullable: false),
                    MutationSequence = table.Column<int>(type: "integer", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Mesocycles", x => x.Id);
                    table.UniqueConstraint("AK_Mesocycles_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_Mesocycles_LoadIncrement", "\"LoadIncrement\" > 0 AND \"LoadIncrement\" <= 50");
                    table.CheckConstraint("CK_Mesocycles_MutationSequence", "\"MutationSequence\" >= 0");
                    table.CheckConstraint("CK_Mesocycles_Period", "\"EndDateExclusive\" > \"StartDate\"");
                    table.CheckConstraint("CK_Mesocycles_Phase3Kind", "\"Kind\" = 'Primary'");
                    table.ForeignKey(
                        name: "FK_Mesocycles_ClientEnrollments_TenantId_EnrollmentId",
                        columns: x => new { x.TenantId, x.EnrollmentId },
                        principalSchema: "subscriptions",
                        principalTable: "ClientEnrollments",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Mesocycles_ClientProfiles_TenantId_ClientProfileId",
                        columns: x => new { x.TenantId, x.ClientProfileId },
                        principalSchema: "clients",
                        principalTable: "ClientProfiles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Mesocycles_ProgramTemplateVersions_TenantId_SourceTemplateV~",
                        columns: x => new { x.TenantId, x.SourceTemplateVersionId },
                        principalSchema: "training",
                        principalTable: "ProgramTemplateVersions",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Mesocycles_ProgramTemplates_TenantId_SourceTemplateId",
                        columns: x => new { x.TenantId, x.SourceTemplateId },
                        principalSchema: "training",
                        principalTable: "ProgramTemplates",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ProgramTemplateWeeks",
                schema: "training",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TemplateVersionId = table.Column<Guid>(type: "uuid", nullable: false),
                    WeekNumber = table.Column<int>(type: "integer", nullable: false),
                    Label = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    IsPublishedByDefault = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProgramTemplateWeeks", x => x.Id);
                    table.UniqueConstraint("AK_ProgramTemplateWeeks_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_ProgramTemplateWeeks_Number", "\"WeekNumber\" >= 1 AND \"WeekNumber\" <= 52");
                    table.ForeignKey(
                        name: "FK_ProgramTemplateWeeks_ProgramTemplateVersions_TenantId_Templ~",
                        columns: x => new { x.TenantId, x.TemplateVersionId },
                        principalSchema: "training",
                        principalTable: "ProgramTemplateVersions",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "MesocycleWeeks",
                schema: "training",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    MesocycleId = table.Column<Guid>(type: "uuid", nullable: false),
                    WeekNumber = table.Column<int>(type: "integer", nullable: false),
                    StartsOn = table.Column<DateOnly>(type: "date", nullable: false),
                    Label = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    IsPublished = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MesocycleWeeks", x => x.Id);
                    table.UniqueConstraint("AK_MesocycleWeeks_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_MesocycleWeeks_Number", "\"WeekNumber\" >= 1 AND \"WeekNumber\" <= 52");
                    table.ForeignKey(
                        name: "FK_MesocycleWeeks_Mesocycles_TenantId_MesocycleId",
                        columns: x => new { x.TenantId, x.MesocycleId },
                        principalSchema: "training",
                        principalTable: "Mesocycles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ProgressionApplications",
                schema: "training",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    MesocycleId = table.Column<Guid>(type: "uuid", nullable: false),
                    TransformKey = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    TransformVersion = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    PreviewHash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    RequestJson = table.Column<string>(type: "jsonb", nullable: false),
                    SourceWeekCount = table.Column<int>(type: "integer", nullable: false),
                    GeneratedWeekCount = table.Column<int>(type: "integer", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProgressionApplications", x => x.Id);
                    table.UniqueConstraint("AK_ProgressionApplications_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_ProgressionApplications_Hash", "\"PreviewHash\" ~ '^[0-9a-f]{64}$'");
                    table.ForeignKey(
                        name: "FK_ProgressionApplications_Mesocycles_TenantId_MesocycleId",
                        columns: x => new { x.TenantId, x.MesocycleId },
                        principalSchema: "training",
                        principalTable: "Mesocycles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ProgramTemplateSessions",
                schema: "training",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TemplateWeekId = table.Column<Guid>(type: "uuid", nullable: false),
                    Position = table.Column<int>(type: "integer", nullable: false),
                    DayOffset = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    CoachNotes = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProgramTemplateSessions", x => x.Id);
                    table.UniqueConstraint("AK_ProgramTemplateSessions_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_ProgramTemplateSessions_DayOffset", "\"DayOffset\" >= 0 AND \"DayOffset\" <= 6");
                    table.CheckConstraint("CK_ProgramTemplateSessions_Position", "\"Position\" >= 0");
                    table.ForeignKey(
                        name: "FK_ProgramTemplateSessions_ProgramTemplateWeeks_TenantId_Templ~",
                        columns: x => new { x.TenantId, x.TemplateWeekId },
                        principalSchema: "training",
                        principalTable: "ProgramTemplateWeeks",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Sessions",
                schema: "training",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    MesocycleWeekId = table.Column<Guid>(type: "uuid", nullable: false),
                    Position = table.Column<int>(type: "integer", nullable: false),
                    DayOffset = table.Column<int>(type: "integer", nullable: false),
                    ScheduledDate = table.Column<DateOnly>(type: "date", nullable: false),
                    Name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    CoachNotes = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    HasStarted = table.Column<bool>(type: "boolean", nullable: false),
                    IsCompleted = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Sessions", x => x.Id);
                    table.UniqueConstraint("AK_Sessions_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_TrainingSessions_DayOffset", "\"DayOffset\" >= 0 AND \"DayOffset\" <= 6");
                    table.CheckConstraint("CK_TrainingSessions_ExecutionState", "NOT \"IsCompleted\" OR \"HasStarted\"");
                    table.CheckConstraint("CK_TrainingSessions_Position", "\"Position\" >= 0");
                    table.ForeignKey(
                        name: "FK_Sessions_MesocycleWeeks_TenantId_MesocycleWeekId",
                        columns: x => new { x.TenantId, x.MesocycleWeekId },
                        principalSchema: "training",
                        principalTable: "MesocycleWeeks",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ProgramTemplateExercises",
                schema: "training",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TemplateSessionId = table.Column<Guid>(type: "uuid", nullable: false),
                    ExerciseId = table.Column<Guid>(type: "uuid", nullable: false),
                    ExerciseNameSnapshot = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    Position = table.Column<int>(type: "integer", nullable: false),
                    IsMainLift = table.Column<bool>(type: "boolean", nullable: false),
                    ModificationPolicy = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    CoachNotes = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProgramTemplateExercises", x => x.Id);
                    table.UniqueConstraint("AK_ProgramTemplateExercises_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_ProgramTemplateExercises_MainLiftPolicy", "NOT \"IsMainLift\" OR \"ModificationPolicy\" = 'Locked'");
                    table.ForeignKey(
                        name: "FK_ProgramTemplateExercises_Exercises_TenantId_ExerciseId",
                        columns: x => new { x.TenantId, x.ExerciseId },
                        principalSchema: "exercise_library",
                        principalTable: "Exercises",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ProgramTemplateExercises_ProgramTemplateSessions_TenantId_T~",
                        columns: x => new { x.TenantId, x.TemplateSessionId },
                        principalSchema: "training",
                        principalTable: "ProgramTemplateSessions",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "SavedSessionTemplates",
                schema: "training",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    SourceTemplateVersionId = table.Column<Guid>(type: "uuid", nullable: false),
                    SourceTemplateSessionId = table.Column<Guid>(type: "uuid", nullable: false),
                    IsArchived = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SavedSessionTemplates", x => x.Id);
                    table.UniqueConstraint("AK_SavedSessionTemplates_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_SavedSessionTemplates_ProgramTemplateSessions_TenantId_Sour~",
                        columns: x => new { x.TenantId, x.SourceTemplateSessionId },
                        principalSchema: "training",
                        principalTable: "ProgramTemplateSessions",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SavedSessionTemplates_ProgramTemplateVersions_TenantId_Sour~",
                        columns: x => new { x.TenantId, x.SourceTemplateVersionId },
                        principalSchema: "training",
                        principalTable: "ProgramTemplateVersions",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ExercisePrescriptions",
                schema: "training",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TrainingSessionId = table.Column<Guid>(type: "uuid", nullable: false),
                    ExerciseId = table.Column<Guid>(type: "uuid", nullable: false),
                    ExerciseNameSnapshot = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    Position = table.Column<int>(type: "integer", nullable: false),
                    IsMainLift = table.Column<bool>(type: "boolean", nullable: false),
                    ModificationPolicy = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    CoachNotes = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ExercisePrescriptions", x => x.Id);
                    table.UniqueConstraint("AK_ExercisePrescriptions_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_ExercisePrescriptions_MainLiftPolicy", "NOT \"IsMainLift\" OR \"ModificationPolicy\" = 'Locked'");
                    table.ForeignKey(
                        name: "FK_ExercisePrescriptions_Exercises_TenantId_ExerciseId",
                        columns: x => new { x.TenantId, x.ExerciseId },
                        principalSchema: "exercise_library",
                        principalTable: "Exercises",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ExercisePrescriptions_Sessions_TenantId_TrainingSessionId",
                        columns: x => new { x.TenantId, x.TrainingSessionId },
                        principalSchema: "training",
                        principalTable: "Sessions",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "WorkoutExecutions",
                schema: "training",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientProfileId = table.Column<Guid>(type: "uuid", nullable: false),
                    MesocycleId = table.Column<Guid>(type: "uuid", nullable: false),
                    TrainingSessionId = table.Column<Guid>(type: "uuid", nullable: false),
                    ScheduledDateSnapshot = table.Column<DateOnly>(type: "date", nullable: false),
                    SessionNameSnapshot = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    SessionCoachNotesSnapshot = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    PrescriptionVersionSnapshot = table.Column<long>(type: "bigint", nullable: false),
                    Status = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    StartedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CompletedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    MutationSequence = table.Column<int>(type: "integer", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WorkoutExecutions", x => x.Id);
                    table.UniqueConstraint("AK_WorkoutExecutions_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_WorkoutExecutions_CompletedState", "\"Status\" <> 'Completed' OR \"CompletedAtUtc\" IS NOT NULL");
                    table.CheckConstraint("CK_WorkoutExecutions_MutationSequence", "\"MutationSequence\" >= 0");
                    table.ForeignKey(
                        name: "FK_WorkoutExecutions_ClientProfiles_TenantId_ClientProfileId",
                        columns: x => new { x.TenantId, x.ClientProfileId },
                        principalSchema: "clients",
                        principalTable: "ClientProfiles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_WorkoutExecutions_Mesocycles_TenantId_MesocycleId",
                        columns: x => new { x.TenantId, x.MesocycleId },
                        principalSchema: "training",
                        principalTable: "Mesocycles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_WorkoutExecutions_Sessions_TenantId_TrainingSessionId",
                        columns: x => new { x.TenantId, x.TrainingSessionId },
                        principalSchema: "training",
                        principalTable: "Sessions",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ProgramTemplateExerciseAlternatives",
                schema: "training",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TemplateExerciseId = table.Column<Guid>(type: "uuid", nullable: false),
                    ExerciseId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProgramTemplateExerciseAlternatives", x => x.Id);
                    table.UniqueConstraint("AK_ProgramTemplateExerciseAlternatives_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_ProgramTemplateExerciseAlternatives_Exercises_TenantId_Exer~",
                        columns: x => new { x.TenantId, x.ExerciseId },
                        principalSchema: "exercise_library",
                        principalTable: "Exercises",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ProgramTemplateExerciseAlternatives_ProgramTemplateExercise~",
                        columns: x => new { x.TenantId, x.TemplateExerciseId },
                        principalSchema: "training",
                        principalTable: "ProgramTemplateExercises",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ProgramTemplateSets",
                schema: "training",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TemplateExerciseId = table.Column<Guid>(type: "uuid", nullable: false),
                    Position = table.Column<int>(type: "integer", nullable: false),
                    SetType = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    RepetitionsMinimum = table.Column<int>(type: "integer", nullable: true),
                    RepetitionsMaximum = table.Column<int>(type: "integer", nullable: true),
                    LoadStrategy = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    DirectLoad = table.Column<decimal>(type: "numeric(8,3)", precision: 8, scale: 3, nullable: true),
                    LoadUnit = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    PercentageWorkingMax = table.Column<decimal>(type: "numeric(6,3)", precision: 6, scale: 3, nullable: true),
                    TargetRpe = table.Column<decimal>(type: "numeric(3,1)", precision: 3, scale: 1, nullable: true),
                    ExertionDisplayPreference = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    RestSeconds = table.Column<int>(type: "integer", nullable: true),
                    Tempo = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    CoachNotes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    IsManualLoadOverride = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProgramTemplateSets", x => x.Id);
                    table.UniqueConstraint("AK_ProgramTemplateSets_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_ProgramTemplateSets_LoadStrategy", "(\"LoadStrategy\" = 'None') OR (\"LoadStrategy\" = 'Direct' AND \"DirectLoad\" > 0 AND \"LoadUnit\" IS NOT NULL) OR (\"LoadStrategy\" = 'PercentageWorkingMax' AND \"PercentageWorkingMax\" > 0 AND \"PercentageWorkingMax\" <= 150 AND \"LoadUnit\" IS NOT NULL) OR (\"LoadStrategy\" = 'RpeBasedEpley' AND \"TargetRpe\" IS NOT NULL AND \"RepetitionsMaximum\" IS NOT NULL AND \"LoadUnit\" IS NOT NULL)");
                    table.CheckConstraint("CK_ProgramTemplateSets_Position", "\"Position\" >= 0");
                    table.CheckConstraint("CK_ProgramTemplateSets_Repetitions", "(\"RepetitionsMinimum\" IS NULL OR (\"RepetitionsMinimum\" >= 1 AND \"RepetitionsMinimum\" <= 100)) AND (\"RepetitionsMaximum\" IS NULL OR (\"RepetitionsMaximum\" >= 1 AND \"RepetitionsMaximum\" <= 100)) AND (\"RepetitionsMinimum\" IS NULL OR \"RepetitionsMaximum\" IS NULL OR \"RepetitionsMinimum\" <= \"RepetitionsMaximum\")");
                    table.CheckConstraint("CK_ProgramTemplateSets_Rest", "\"RestSeconds\" IS NULL OR (\"RestSeconds\" >= 0 AND \"RestSeconds\" <= 3600)");
                    table.CheckConstraint("CK_ProgramTemplateSets_TargetRpe", "\"TargetRpe\" IS NULL OR (\"TargetRpe\" >= 5 AND \"TargetRpe\" <= 10 AND mod(\"TargetRpe\" * 2, 1) = 0)");
                    table.ForeignKey(
                        name: "FK_ProgramTemplateSets_ProgramTemplateExercises_TenantId_Templ~",
                        columns: x => new { x.TenantId, x.TemplateExerciseId },
                        principalSchema: "training",
                        principalTable: "ProgramTemplateExercises",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ExercisePrescriptionAlternatives",
                schema: "training",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ExercisePrescriptionId = table.Column<Guid>(type: "uuid", nullable: false),
                    ExerciseId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ExercisePrescriptionAlternatives", x => x.Id);
                    table.UniqueConstraint("AK_ExercisePrescriptionAlternatives_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_ExercisePrescriptionAlternatives_ExercisePrescriptions_Tena~",
                        columns: x => new { x.TenantId, x.ExercisePrescriptionId },
                        principalSchema: "training",
                        principalTable: "ExercisePrescriptions",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ExercisePrescriptionAlternatives_Exercises_TenantId_Exercis~",
                        columns: x => new { x.TenantId, x.ExerciseId },
                        principalSchema: "exercise_library",
                        principalTable: "Exercises",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "MaxHistory",
                schema: "strength",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientProfileId = table.Column<Guid>(type: "uuid", nullable: false),
                    ExerciseId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Value = table.Column<decimal>(type: "numeric(8,3)", precision: 8, scale: 3, nullable: false),
                    Unit = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    EffectiveDate = table.Column<DateOnly>(type: "date", nullable: false),
                    Source = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    MethodKey = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    MethodVersion = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    SourceWorkoutExecutionId = table.Column<Guid>(type: "uuid", nullable: true),
                    Note = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MaxHistory", x => x.Id);
                    table.UniqueConstraint("AK_MaxHistory_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_StrengthMaxHistory_Value", "\"Value\" > 0 AND \"Value\" <= 2000");
                    table.ForeignKey(
                        name: "FK_MaxHistory_ClientProfiles_TenantId_ClientProfileId",
                        columns: x => new { x.TenantId, x.ClientProfileId },
                        principalSchema: "clients",
                        principalTable: "ClientProfiles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_MaxHistory_Exercises_TenantId_ExerciseId",
                        columns: x => new { x.TenantId, x.ExerciseId },
                        principalSchema: "exercise_library",
                        principalTable: "Exercises",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_MaxHistory_WorkoutExecutions_TenantId_SourceWorkoutExecutio~",
                        columns: x => new { x.TenantId, x.SourceWorkoutExecutionId },
                        principalSchema: "training",
                        principalTable: "WorkoutExecutions",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "WorkoutExercisePerformances",
                schema: "training",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    WorkoutExecutionId = table.Column<Guid>(type: "uuid", nullable: false),
                    ExercisePrescriptionId = table.Column<Guid>(type: "uuid", nullable: false),
                    PrescribedExerciseId = table.Column<Guid>(type: "uuid", nullable: false),
                    PrescribedExerciseName = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    ActualExerciseId = table.Column<Guid>(type: "uuid", nullable: false),
                    ActualExerciseName = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    WasSubstituted = table.Column<bool>(type: "boolean", nullable: false),
                    Position = table.Column<int>(type: "integer", nullable: false),
                    ModificationPolicySnapshot = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    IsMainLiftSnapshot = table.Column<bool>(type: "boolean", nullable: false),
                    CoachNotesSnapshot = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WorkoutExercisePerformances", x => x.Id);
                    table.UniqueConstraint("AK_WorkoutExercisePerformances_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_WorkoutExercisePerformances_Substitution", "(NOT \"WasSubstituted\" AND \"ActualExerciseId\" = \"PrescribedExerciseId\") OR (\"WasSubstituted\" AND \"ActualExerciseId\" <> \"PrescribedExerciseId\" AND \"ModificationPolicySnapshot\" = 'CoachApprovedSwap')");
                    table.ForeignKey(
                        name: "FK_WorkoutExercisePerformances_WorkoutExecutions_TenantId_Work~",
                        columns: x => new { x.TenantId, x.WorkoutExecutionId },
                        principalSchema: "training",
                        principalTable: "WorkoutExecutions",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "WorkingMaxSnapshots",
                schema: "strength",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    MesocycleId = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientProfileId = table.Column<Guid>(type: "uuid", nullable: false),
                    ExerciseId = table.Column<Guid>(type: "uuid", nullable: false),
                    SourceMaxRecordId = table.Column<Guid>(type: "uuid", nullable: true),
                    Value = table.Column<decimal>(type: "numeric(8,3)", precision: 8, scale: 3, nullable: false),
                    Unit = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    EffectiveFromWeek = table.Column<int>(type: "integer", nullable: false),
                    SupersedesSnapshotId = table.Column<Guid>(type: "uuid", nullable: true),
                    Reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WorkingMaxSnapshots", x => x.Id);
                    table.UniqueConstraint("AK_WorkingMaxSnapshots_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_WorkingMaxSnapshots_EffectiveWeek", "\"EffectiveFromWeek\" >= 1 AND \"EffectiveFromWeek\" <= 52");
                    table.CheckConstraint("CK_WorkingMaxSnapshots_Value", "\"Value\" > 0 AND \"Value\" <= 2000");
                    table.ForeignKey(
                        name: "FK_WorkingMaxSnapshots_ClientProfiles_TenantId_ClientProfileId",
                        columns: x => new { x.TenantId, x.ClientProfileId },
                        principalSchema: "clients",
                        principalTable: "ClientProfiles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_WorkingMaxSnapshots_Exercises_TenantId_ExerciseId",
                        columns: x => new { x.TenantId, x.ExerciseId },
                        principalSchema: "exercise_library",
                        principalTable: "Exercises",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_WorkingMaxSnapshots_MaxHistory_TenantId_SourceMaxRecordId",
                        columns: x => new { x.TenantId, x.SourceMaxRecordId },
                        principalSchema: "strength",
                        principalTable: "MaxHistory",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_WorkingMaxSnapshots_Mesocycles_TenantId_MesocycleId",
                        columns: x => new { x.TenantId, x.MesocycleId },
                        principalSchema: "training",
                        principalTable: "Mesocycles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_WorkingMaxSnapshots_WorkingMaxSnapshots_TenantId_Supersedes~",
                        columns: x => new { x.TenantId, x.SupersedesSnapshotId },
                        principalSchema: "strength",
                        principalTable: "WorkingMaxSnapshots",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "WorkoutExerciseAlternativeSnapshots",
                schema: "training",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    WorkoutExercisePerformanceId = table.Column<Guid>(type: "uuid", nullable: false),
                    ExerciseId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WorkoutExerciseAlternativeSnapshots", x => x.Id);
                    table.UniqueConstraint("AK_WorkoutExerciseAlternativeSnapshots_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_WorkoutExerciseAlternativeSnapshots_WorkoutExercisePerforma~",
                        columns: x => new { x.TenantId, x.WorkoutExercisePerformanceId },
                        principalSchema: "training",
                        principalTable: "WorkoutExercisePerformances",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "WorkoutNotes",
                schema: "training",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    WorkoutExecutionId = table.Column<Guid>(type: "uuid", nullable: false),
                    WorkoutExercisePerformanceId = table.Column<Guid>(type: "uuid", nullable: true),
                    AuthorUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    AuthorRole = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Text = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WorkoutNotes", x => x.Id);
                    table.UniqueConstraint("AK_WorkoutNotes_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_WorkoutNotes_Users_AuthorUserId",
                        column: x => x.AuthorUserId,
                        principalSchema: "identity",
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_WorkoutNotes_WorkoutExecutions_TenantId_WorkoutExecutionId",
                        columns: x => new { x.TenantId, x.WorkoutExecutionId },
                        principalSchema: "training",
                        principalTable: "WorkoutExecutions",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_WorkoutNotes_WorkoutExercisePerformances_TenantId_WorkoutEx~",
                        columns: x => new { x.TenantId, x.WorkoutExercisePerformanceId },
                        principalSchema: "training",
                        principalTable: "WorkoutExercisePerformances",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "WorkoutSetPerformances",
                schema: "training",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    WorkoutExercisePerformanceId = table.Column<Guid>(type: "uuid", nullable: false),
                    SetPrescriptionId = table.Column<Guid>(type: "uuid", nullable: false),
                    Position = table.Column<int>(type: "integer", nullable: false),
                    SetTypeSnapshot = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    PrescribedRepetitionsMinimum = table.Column<int>(type: "integer", nullable: true),
                    PrescribedRepetitionsMaximum = table.Column<int>(type: "integer", nullable: true),
                    PrescribedLoad = table.Column<decimal>(type: "numeric(8,3)", precision: 8, scale: 3, nullable: true),
                    PrescribedLoadUnit = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    PrescribedTargetRpe = table.Column<decimal>(type: "numeric(3,1)", precision: 3, scale: 1, nullable: true),
                    PrescribedRestSeconds = table.Column<int>(type: "integer", nullable: true),
                    PrescribedTempo = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    CoachNotesSnapshot = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    CalculationStrategyKeySnapshot = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    CalculationStrategyVersionSnapshot = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    UnroundedRecommendedLoadSnapshot = table.Column<decimal>(type: "numeric(8,3)", precision: 8, scale: 3, nullable: true),
                    ActualRepetitions = table.Column<int>(type: "integer", nullable: true),
                    ActualLoad = table.Column<decimal>(type: "numeric(8,3)", precision: 8, scale: 3, nullable: true),
                    ActualLoadUnit = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    ActualRpe = table.Column<decimal>(type: "numeric(3,1)", precision: 3, scale: 1, nullable: true),
                    IsCompleted = table.Column<bool>(type: "boolean", nullable: false),
                    ClientNote = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WorkoutSetPerformances", x => x.Id);
                    table.UniqueConstraint("AK_WorkoutSetPerformances_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_WorkoutSetPerformances_ActualLoad", "\"ActualLoad\" IS NULL OR (\"ActualLoad\" >= 0 AND \"ActualLoad\" <= 2000)");
                    table.CheckConstraint("CK_WorkoutSetPerformances_ActualReps", "\"ActualRepetitions\" IS NULL OR (\"ActualRepetitions\" >= 0 AND \"ActualRepetitions\" <= 200)");
                    table.CheckConstraint("CK_WorkoutSetPerformances_ActualRpe", "\"ActualRpe\" IS NULL OR (\"ActualRpe\" >= 5 AND \"ActualRpe\" <= 10 AND mod(\"ActualRpe\" * 2, 1) = 0)");
                    table.ForeignKey(
                        name: "FK_WorkoutSetPerformances_WorkoutExercisePerformances_TenantId~",
                        columns: x => new { x.TenantId, x.WorkoutExercisePerformanceId },
                        principalSchema: "training",
                        principalTable: "WorkoutExercisePerformances",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "SetPrescriptions",
                schema: "training",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ExercisePrescriptionId = table.Column<Guid>(type: "uuid", nullable: false),
                    Position = table.Column<int>(type: "integer", nullable: false),
                    SetType = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    RepetitionsMinimum = table.Column<int>(type: "integer", nullable: true),
                    RepetitionsMaximum = table.Column<int>(type: "integer", nullable: true),
                    LoadStrategy = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    DirectLoad = table.Column<decimal>(type: "numeric(8,3)", precision: 8, scale: 3, nullable: true),
                    LoadUnit = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    PercentageWorkingMax = table.Column<decimal>(type: "numeric(6,3)", precision: 6, scale: 3, nullable: true),
                    TargetRpe = table.Column<decimal>(type: "numeric(3,1)", precision: 3, scale: 1, nullable: true),
                    ExertionDisplayPreference = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    RestSeconds = table.Column<int>(type: "integer", nullable: true),
                    Tempo = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    CoachNotes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    WorkingMaxSnapshotId = table.Column<Guid>(type: "uuid", nullable: true),
                    UnroundedRecommendedLoad = table.Column<decimal>(type: "numeric(8,3)", precision: 8, scale: 3, nullable: true),
                    PrescribedLoad = table.Column<decimal>(type: "numeric(8,3)", precision: 8, scale: 3, nullable: true),
                    CalculationStrategyKey = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    CalculationStrategyVersion = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    CalculationExplanation = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    IsManualLoadOverride = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SetPrescriptions", x => x.Id);
                    table.UniqueConstraint("AK_SetPrescriptions_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_SetPrescriptions_LoadStrategy", "(\"LoadStrategy\" = 'None') OR (\"LoadStrategy\" = 'Direct' AND \"DirectLoad\" > 0 AND \"LoadUnit\" IS NOT NULL) OR (\"LoadStrategy\" = 'PercentageWorkingMax' AND \"PercentageWorkingMax\" > 0 AND \"PercentageWorkingMax\" <= 150 AND \"LoadUnit\" IS NOT NULL) OR (\"LoadStrategy\" = 'RpeBasedEpley' AND \"TargetRpe\" IS NOT NULL AND \"RepetitionsMaximum\" IS NOT NULL AND \"LoadUnit\" IS NOT NULL)");
                    table.CheckConstraint("CK_SetPrescriptions_Position", "\"Position\" >= 0");
                    table.CheckConstraint("CK_SetPrescriptions_Repetitions", "(\"RepetitionsMinimum\" IS NULL OR (\"RepetitionsMinimum\" >= 1 AND \"RepetitionsMinimum\" <= 100)) AND (\"RepetitionsMaximum\" IS NULL OR (\"RepetitionsMaximum\" >= 1 AND \"RepetitionsMaximum\" <= 100)) AND (\"RepetitionsMinimum\" IS NULL OR \"RepetitionsMaximum\" IS NULL OR \"RepetitionsMinimum\" <= \"RepetitionsMaximum\")");
                    table.CheckConstraint("CK_SetPrescriptions_Rest", "\"RestSeconds\" IS NULL OR (\"RestSeconds\" >= 0 AND \"RestSeconds\" <= 3600)");
                    table.CheckConstraint("CK_SetPrescriptions_TargetRpe", "\"TargetRpe\" IS NULL OR (\"TargetRpe\" >= 5 AND \"TargetRpe\" <= 10 AND mod(\"TargetRpe\" * 2, 1) = 0)");
                    table.ForeignKey(
                        name: "FK_SetPrescriptions_ExercisePrescriptions_TenantId_ExercisePre~",
                        columns: x => new { x.TenantId, x.ExercisePrescriptionId },
                        principalSchema: "training",
                        principalTable: "ExercisePrescriptions",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_SetPrescriptions_WorkingMaxSnapshots_TenantId_WorkingMaxSna~",
                        columns: x => new { x.TenantId, x.WorkingMaxSnapshotId },
                        principalSchema: "strength",
                        principalTable: "WorkingMaxSnapshots",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Assets_OwnerUserId",
                schema: "media",
                table: "Assets",
                column: "OwnerUserId");

            migrationBuilder.CreateIndex(
                name: "IX_Assets_TenantId_ExternalProvider_ExternalMediaId",
                schema: "media",
                table: "Assets",
                columns: new[] { "TenantId", "ExternalProvider", "ExternalMediaId" },
                unique: true,
                filter: "\"ExternalMediaId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Assets_TenantId_Status_CreatedAtUtc",
                schema: "media",
                table: "Assets",
                columns: new[] { "TenantId", "Status", "CreatedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_Assets_TenantId_StorageKey",
                schema: "media",
                table: "Assets",
                columns: new[] { "TenantId", "StorageKey" },
                unique: true,
                filter: "\"StorageKey\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_ExerciseAlternatives_TenantId_AlternativeExerciseId",
                schema: "exercise_library",
                table: "ExerciseAlternatives",
                columns: new[] { "TenantId", "AlternativeExerciseId" });

            migrationBuilder.CreateIndex(
                name: "IX_ExerciseAlternatives_TenantId_ExerciseId_AlternativeExercis~",
                schema: "exercise_library",
                table: "ExerciseAlternatives",
                columns: new[] { "TenantId", "ExerciseId", "AlternativeExerciseId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ExerciseMediaLinks_TenantId_ExerciseId_MediaAssetId",
                schema: "exercise_library",
                table: "ExerciseMediaLinks",
                columns: new[] { "TenantId", "ExerciseId", "MediaAssetId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ExerciseMediaLinks_TenantId_MediaAssetId",
                schema: "exercise_library",
                table: "ExerciseMediaLinks",
                columns: new[] { "TenantId", "MediaAssetId" });

            migrationBuilder.CreateIndex(
                name: "IX_ExerciseMuscles_TenantId_ExerciseId_Muscle_Role",
                schema: "exercise_library",
                table: "ExerciseMuscles",
                columns: new[] { "TenantId", "ExerciseId", "Muscle", "Role" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ExerciseMuscles_TenantId_Muscle_Role",
                schema: "exercise_library",
                table: "ExerciseMuscles",
                columns: new[] { "TenantId", "Muscle", "Role" });

            migrationBuilder.CreateIndex(
                name: "IX_ExercisePrescriptionAlternatives_TenantId_ExerciseId",
                schema: "training",
                table: "ExercisePrescriptionAlternatives",
                columns: new[] { "TenantId", "ExerciseId" });

            migrationBuilder.CreateIndex(
                name: "IX_ExercisePrescriptionAlternatives_TenantId_ExercisePrescript~",
                schema: "training",
                table: "ExercisePrescriptionAlternatives",
                columns: new[] { "TenantId", "ExercisePrescriptionId", "ExerciseId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ExercisePrescriptions_TenantId_ExerciseId",
                schema: "training",
                table: "ExercisePrescriptions",
                columns: new[] { "TenantId", "ExerciseId" });

            migrationBuilder.CreateIndex(
                name: "IX_ExercisePrescriptions_TenantId_TrainingSessionId_Position",
                schema: "training",
                table: "ExercisePrescriptions",
                columns: new[] { "TenantId", "TrainingSessionId", "Position" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Exercises_TenantId_IsArchived_Classification_Equipment_Move~",
                schema: "exercise_library",
                table: "Exercises",
                columns: new[] { "TenantId", "IsArchived", "Classification", "Equipment", "MovementPattern" });

            migrationBuilder.CreateIndex(
                name: "IX_Exercises_TenantId_NormalizedName",
                schema: "exercise_library",
                table: "Exercises",
                columns: new[] { "TenantId", "NormalizedName" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ExerciseTags_TenantId_ExerciseId_NormalizedValue",
                schema: "exercise_library",
                table: "ExerciseTags",
                columns: new[] { "TenantId", "ExerciseId", "NormalizedValue" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ExerciseTags_TenantId_NormalizedValue",
                schema: "exercise_library",
                table: "ExerciseTags",
                columns: new[] { "TenantId", "NormalizedValue" });

            migrationBuilder.CreateIndex(
                name: "IX_MaxHistory_TenantId_ClientProfileId_ExerciseId_EffectiveDat~",
                schema: "strength",
                table: "MaxHistory",
                columns: new[] { "TenantId", "ClientProfileId", "ExerciseId", "EffectiveDate", "CreatedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_MaxHistory_TenantId_ExerciseId",
                schema: "strength",
                table: "MaxHistory",
                columns: new[] { "TenantId", "ExerciseId" });

            migrationBuilder.CreateIndex(
                name: "IX_MaxHistory_TenantId_SourceWorkoutExecutionId",
                schema: "strength",
                table: "MaxHistory",
                columns: new[] { "TenantId", "SourceWorkoutExecutionId" });

            migrationBuilder.CreateIndex(
                name: "IX_Mesocycles_TenantId_AssignmentCommandId",
                schema: "training",
                table: "Mesocycles",
                columns: new[] { "TenantId", "AssignmentCommandId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Mesocycles_TenantId_ClientProfileId_StartDate_EndDateExclus~",
                schema: "training",
                table: "Mesocycles",
                columns: new[] { "TenantId", "ClientProfileId", "StartDate", "EndDateExclusive" });

            migrationBuilder.CreateIndex(
                name: "IX_Mesocycles_TenantId_EnrollmentId",
                schema: "training",
                table: "Mesocycles",
                columns: new[] { "TenantId", "EnrollmentId" });

            migrationBuilder.CreateIndex(
                name: "IX_Mesocycles_TenantId_SourceTemplateId",
                schema: "training",
                table: "Mesocycles",
                columns: new[] { "TenantId", "SourceTemplateId" });

            migrationBuilder.CreateIndex(
                name: "IX_Mesocycles_TenantId_SourceTemplateVersionId",
                schema: "training",
                table: "Mesocycles",
                columns: new[] { "TenantId", "SourceTemplateVersionId" });

            migrationBuilder.CreateIndex(
                name: "IX_MesocycleWeeks_TenantId_MesocycleId_WeekNumber",
                schema: "training",
                table: "MesocycleWeeks",
                columns: new[] { "TenantId", "MesocycleId", "WeekNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ProgramTemplateExerciseAlternatives_TenantId_ExerciseId",
                schema: "training",
                table: "ProgramTemplateExerciseAlternatives",
                columns: new[] { "TenantId", "ExerciseId" });

            migrationBuilder.CreateIndex(
                name: "IX_ProgramTemplateExerciseAlternatives_TenantId_TemplateExerci~",
                schema: "training",
                table: "ProgramTemplateExerciseAlternatives",
                columns: new[] { "TenantId", "TemplateExerciseId", "ExerciseId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ProgramTemplateExercises_TenantId_ExerciseId",
                schema: "training",
                table: "ProgramTemplateExercises",
                columns: new[] { "TenantId", "ExerciseId" });

            migrationBuilder.CreateIndex(
                name: "IX_ProgramTemplateExercises_TenantId_TemplateSessionId_Position",
                schema: "training",
                table: "ProgramTemplateExercises",
                columns: new[] { "TenantId", "TemplateSessionId", "Position" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ProgramTemplates_TenantId_IsArchived_Name",
                schema: "training",
                table: "ProgramTemplates",
                columns: new[] { "TenantId", "IsArchived", "Name" });

            migrationBuilder.CreateIndex(
                name: "IX_ProgramTemplateSessions_TenantId_TemplateWeekId_Position",
                schema: "training",
                table: "ProgramTemplateSessions",
                columns: new[] { "TenantId", "TemplateWeekId", "Position" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ProgramTemplateSets_TenantId_TemplateExerciseId_Position",
                schema: "training",
                table: "ProgramTemplateSets",
                columns: new[] { "TenantId", "TemplateExerciseId", "Position" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ProgramTemplateVersions_TenantId_TemplateId_VersionNumber",
                schema: "training",
                table: "ProgramTemplateVersions",
                columns: new[] { "TenantId", "TemplateId", "VersionNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ProgramTemplateWeeks_TenantId_TemplateVersionId_WeekNumber",
                schema: "training",
                table: "ProgramTemplateWeeks",
                columns: new[] { "TenantId", "TemplateVersionId", "WeekNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ProgressionApplications_TenantId_MesocycleId_PreviewHash",
                schema: "training",
                table: "ProgressionApplications",
                columns: new[] { "TenantId", "MesocycleId", "PreviewHash" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SavedSessionTemplates_TenantId_IsArchived_Name",
                schema: "training",
                table: "SavedSessionTemplates",
                columns: new[] { "TenantId", "IsArchived", "Name" });

            migrationBuilder.CreateIndex(
                name: "IX_SavedSessionTemplates_TenantId_SourceTemplateSessionId",
                schema: "training",
                table: "SavedSessionTemplates",
                columns: new[] { "TenantId", "SourceTemplateSessionId" });

            migrationBuilder.CreateIndex(
                name: "IX_SavedSessionTemplates_TenantId_SourceTemplateVersionId_Sour~",
                schema: "training",
                table: "SavedSessionTemplates",
                columns: new[] { "TenantId", "SourceTemplateVersionId", "SourceTemplateSessionId" });

            migrationBuilder.CreateIndex(
                name: "IX_Sessions_TenantId_MesocycleWeekId_Position",
                schema: "training",
                table: "Sessions",
                columns: new[] { "TenantId", "MesocycleWeekId", "Position" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Sessions_TenantId_ScheduledDate",
                schema: "training",
                table: "Sessions",
                columns: new[] { "TenantId", "ScheduledDate" });

            migrationBuilder.CreateIndex(
                name: "IX_SetPrescriptions_TenantId_ExercisePrescriptionId_Position",
                schema: "training",
                table: "SetPrescriptions",
                columns: new[] { "TenantId", "ExercisePrescriptionId", "Position" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SetPrescriptions_TenantId_WorkingMaxSnapshotId",
                schema: "training",
                table: "SetPrescriptions",
                columns: new[] { "TenantId", "WorkingMaxSnapshotId" });

            migrationBuilder.CreateIndex(
                name: "IX_WorkingMaxSnapshots_TenantId_ClientProfileId",
                schema: "strength",
                table: "WorkingMaxSnapshots",
                columns: new[] { "TenantId", "ClientProfileId" });

            migrationBuilder.CreateIndex(
                name: "IX_WorkingMaxSnapshots_TenantId_ExerciseId",
                schema: "strength",
                table: "WorkingMaxSnapshots",
                columns: new[] { "TenantId", "ExerciseId" });

            migrationBuilder.CreateIndex(
                name: "IX_WorkingMaxSnapshots_TenantId_MesocycleId_ExerciseId_Effecti~",
                schema: "strength",
                table: "WorkingMaxSnapshots",
                columns: new[] { "TenantId", "MesocycleId", "ExerciseId", "EffectiveFromWeek" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_WorkingMaxSnapshots_TenantId_SourceMaxRecordId",
                schema: "strength",
                table: "WorkingMaxSnapshots",
                columns: new[] { "TenantId", "SourceMaxRecordId" });

            migrationBuilder.CreateIndex(
                name: "IX_WorkingMaxSnapshots_TenantId_SupersedesSnapshotId",
                schema: "strength",
                table: "WorkingMaxSnapshots",
                columns: new[] { "TenantId", "SupersedesSnapshotId" });

            migrationBuilder.CreateIndex(
                name: "IX_WorkoutExecutions_TenantId_ClientProfileId_ScheduledDateSna~",
                schema: "training",
                table: "WorkoutExecutions",
                columns: new[] { "TenantId", "ClientProfileId", "ScheduledDateSnapshot" });

            migrationBuilder.CreateIndex(
                name: "IX_WorkoutExecutions_TenantId_MesocycleId",
                schema: "training",
                table: "WorkoutExecutions",
                columns: new[] { "TenantId", "MesocycleId" });

            migrationBuilder.CreateIndex(
                name: "IX_WorkoutExecutions_TenantId_TrainingSessionId",
                schema: "training",
                table: "WorkoutExecutions",
                columns: new[] { "TenantId", "TrainingSessionId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_WorkoutExerciseAlternativeSnapshots_TenantId_WorkoutExercis~",
                schema: "training",
                table: "WorkoutExerciseAlternativeSnapshots",
                columns: new[] { "TenantId", "WorkoutExercisePerformanceId", "ExerciseId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_WorkoutExercisePerformances_TenantId_ActualExerciseId_Worko~",
                schema: "training",
                table: "WorkoutExercisePerformances",
                columns: new[] { "TenantId", "ActualExerciseId", "WorkoutExecutionId" });

            migrationBuilder.CreateIndex(
                name: "IX_WorkoutExercisePerformances_TenantId_WorkoutExecutionId_Pos~",
                schema: "training",
                table: "WorkoutExercisePerformances",
                columns: new[] { "TenantId", "WorkoutExecutionId", "Position" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_WorkoutNotes_AuthorUserId",
                schema: "training",
                table: "WorkoutNotes",
                column: "AuthorUserId");

            migrationBuilder.CreateIndex(
                name: "IX_WorkoutNotes_TenantId_WorkoutExecutionId_CreatedAtUtc",
                schema: "training",
                table: "WorkoutNotes",
                columns: new[] { "TenantId", "WorkoutExecutionId", "CreatedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_WorkoutNotes_TenantId_WorkoutExercisePerformanceId",
                schema: "training",
                table: "WorkoutNotes",
                columns: new[] { "TenantId", "WorkoutExercisePerformanceId" });

            migrationBuilder.CreateIndex(
                name: "IX_WorkoutSetPerformances_TenantId_WorkoutExercisePerformanceI~",
                schema: "training",
                table: "WorkoutSetPerformances",
                columns: new[] { "TenantId", "WorkoutExercisePerformanceId", "Position" },
                unique: true);

            migrationBuilder.Sql(
                """
                CREATE INDEX "IX_Exercises_Name_Trgm"
                    ON exercise_library."Exercises" USING gin ("Name" gin_trgm_ops);
                CREATE INDEX "IX_ExerciseTags_Value_Trgm"
                    ON exercise_library."ExerciseTags" USING gin ("Value" gin_trgm_ops);

                ALTER TABLE training."Mesocycles"
                    ADD CONSTRAINT "EX_Mesocycles_NoPrimaryOverlap"
                    EXCLUDE USING gist
                    (
                        "TenantId" WITH =,
                        "ClientProfileId" WITH =,
                        daterange("StartDate", "EndDateExclusive", '[)') WITH &&
                    )
                    WHERE ("Kind" = 'Primary' AND "BlocksPrimaryOverlap");

                CREATE TRIGGER "TR_MaxHistory_AppendOnly"
                BEFORE UPDATE OR DELETE ON strength."MaxHistory"
                FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

                CREATE TRIGGER "TR_WorkingMaxSnapshots_AppendOnly"
                BEFORE UPDATE OR DELETE ON strength."WorkingMaxSnapshots"
                FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

                CREATE TRIGGER "TR_WorkoutNotes_AppendOnly"
                BEFORE UPDATE OR DELETE ON training."WorkoutNotes"
                FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

                CREATE TRIGGER "TR_ProgressionApplications_AppendOnly"
                BEFORE UPDATE OR DELETE ON training."ProgressionApplications"
                FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

                CREATE TRIGGER "TR_ProgramTemplateWeeks_AppendOnly"
                BEFORE UPDATE OR DELETE ON training."ProgramTemplateWeeks"
                FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

                CREATE TRIGGER "TR_ProgramTemplateSessions_AppendOnly"
                BEFORE UPDATE OR DELETE ON training."ProgramTemplateSessions"
                FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

                CREATE TRIGGER "TR_ProgramTemplateExercises_AppendOnly"
                BEFORE UPDATE OR DELETE ON training."ProgramTemplateExercises"
                FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

                CREATE TRIGGER "TR_ProgramTemplateExerciseAlternatives_AppendOnly"
                BEFORE UPDATE OR DELETE ON training."ProgramTemplateExerciseAlternatives"
                FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

                CREATE TRIGGER "TR_ProgramTemplateSets_AppendOnly"
                BEFORE UPDATE OR DELETE ON training."ProgramTemplateSets"
                FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

                CREATE OR REPLACE FUNCTION training.protect_template_version()
                RETURNS trigger AS $body$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Program template versions are immutable' USING ERRCODE = '55000';
                    END IF;

                    IF OLD."TenantId" IS DISTINCT FROM NEW."TenantId"
                       OR OLD."TemplateId" IS DISTINCT FROM NEW."TemplateId"
                       OR OLD."VersionNumber" IS DISTINCT FROM NEW."VersionNumber"
                       OR OLD."NameSnapshot" IS DISTINCT FROM NEW."NameSnapshot"
                       OR OLD."DescriptionSnapshot" IS DISTINCT FROM NEW."DescriptionSnapshot"
                       OR OLD."CreatedAtUtc" IS DISTINCT FROM NEW."CreatedAtUtc"
                       OR OLD."CreatedByUserId" IS DISTINCT FROM NEW."CreatedByUserId" THEN
                        RAISE EXCEPTION 'Program template version content is immutable' USING ERRCODE = '55000';
                    END IF;

                    IF OLD."IsPublished" THEN
                        IF NEW."IsPublished" IS DISTINCT FROM OLD."IsPublished"
                           OR NEW."PublishedAtUtc" IS DISTINCT FROM OLD."PublishedAtUtc" THEN
                            RAISE EXCEPTION 'Published template metadata is immutable' USING ERRCODE = '55000';
                        END IF;
                    ELSIF NEW."IsPublished" THEN
                        IF NEW."PublishedAtUtc" IS NULL THEN
                            RAISE EXCEPTION 'Publishing requires a publication timestamp' USING ERRCODE = '55000';
                        END IF;
                    ELSIF NEW."PublishedAtUtc" IS DISTINCT FROM OLD."PublishedAtUtc" THEN
                        RAISE EXCEPTION 'Draft publication metadata cannot change independently' USING ERRCODE = '55000';
                    END IF;

                    RETURN NEW;
                END;
                $body$ LANGUAGE plpgsql;

                CREATE TRIGGER "TR_ProgramTemplateVersions_Immutable"
                BEFORE UPDATE OR DELETE ON training."ProgramTemplateVersions"
                FOR EACH ROW EXECUTE FUNCTION training.protect_template_version();

                CREATE OR REPLACE FUNCTION training.protect_session_history()
                RETURNS trigger AS $body$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        IF OLD."HasStarted" THEN
                            RAISE EXCEPTION 'Started training sessions cannot be deleted' USING ERRCODE = '55000';
                        END IF;
                        RETURN OLD;
                    END IF;

                    IF OLD."IsCompleted" THEN
                        RAISE EXCEPTION 'Completed training sessions are immutable' USING ERRCODE = '55000';
                    END IF;

                    IF (OLD."HasStarted" OR NEW."HasStarted") AND
                       (OLD."TenantId" IS DISTINCT FROM NEW."TenantId"
                        OR OLD."MesocycleWeekId" IS DISTINCT FROM NEW."MesocycleWeekId"
                        OR OLD."Position" IS DISTINCT FROM NEW."Position"
                        OR OLD."DayOffset" IS DISTINCT FROM NEW."DayOffset"
                        OR OLD."ScheduledDate" IS DISTINCT FROM NEW."ScheduledDate"
                        OR OLD."Name" IS DISTINCT FROM NEW."Name"
                        OR OLD."CoachNotes" IS DISTINCT FROM NEW."CoachNotes") THEN
                        RAISE EXCEPTION 'Started session prescriptions and schedules are immutable' USING ERRCODE = '55000';
                    END IF;

                    IF OLD."HasStarted" AND NOT NEW."HasStarted" THEN
                        RAISE EXCEPTION 'A started session cannot return to planned state' USING ERRCODE = '55000';
                    END IF;
                    RETURN NEW;
                END;
                $body$ LANGUAGE plpgsql;

                CREATE TRIGGER "TR_Sessions_ProtectHistory"
                BEFORE UPDATE OR DELETE ON training."Sessions"
                FOR EACH ROW EXECUTE FUNCTION training.protect_session_history();

                CREATE OR REPLACE FUNCTION training.protect_exercise_prescription()
                RETURNS trigger AS $body$
                DECLARE started boolean;
                BEGIN
                    SELECT s."HasStarted" INTO started
                    FROM training."Sessions" s
                    WHERE s."TenantId" = COALESCE(NEW."TenantId", OLD."TenantId")
                      AND s."Id" = COALESCE(NEW."TrainingSessionId", OLD."TrainingSessionId");
                    IF started THEN
                        RAISE EXCEPTION 'Started exercise prescriptions are immutable' USING ERRCODE = '55000';
                    END IF;
                    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
                    RETURN NEW;
                END;
                $body$ LANGUAGE plpgsql;

                CREATE TRIGGER "TR_ExercisePrescriptions_ProtectStarted"
                BEFORE INSERT OR UPDATE OR DELETE ON training."ExercisePrescriptions"
                FOR EACH ROW EXECUTE FUNCTION training.protect_exercise_prescription();

                CREATE OR REPLACE FUNCTION training.protect_set_prescription()
                RETURNS trigger AS $body$
                DECLARE started boolean;
                BEGIN
                    SELECT s."HasStarted" INTO started
                    FROM training."ExercisePrescriptions" e
                    JOIN training."Sessions" s
                      ON s."TenantId" = e."TenantId" AND s."Id" = e."TrainingSessionId"
                    WHERE e."TenantId" = COALESCE(NEW."TenantId", OLD."TenantId")
                      AND e."Id" = COALESCE(NEW."ExercisePrescriptionId", OLD."ExercisePrescriptionId");
                    IF started THEN
                        RAISE EXCEPTION 'Started set prescriptions are immutable' USING ERRCODE = '55000';
                    END IF;
                    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
                    RETURN NEW;
                END;
                $body$ LANGUAGE plpgsql;

                CREATE TRIGGER "TR_SetPrescriptions_ProtectStarted"
                BEFORE INSERT OR UPDATE OR DELETE ON training."SetPrescriptions"
                FOR EACH ROW EXECUTE FUNCTION training.protect_set_prescription();

                CREATE TRIGGER "TR_ExercisePrescriptionAlternatives_ProtectStarted"
                BEFORE INSERT OR UPDATE OR DELETE ON training."ExercisePrescriptionAlternatives"
                FOR EACH ROW EXECUTE FUNCTION training.protect_set_prescription();

                CREATE OR REPLACE FUNCTION training.protect_workout_execution()
                RETURNS trigger AS $body$
                BEGIN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Workout executions cannot be deleted' USING ERRCODE = '55000';
                    END IF;
                    IF OLD."Status" = 'Completed' THEN
                        RAISE EXCEPTION 'Completed workout history is immutable' USING ERRCODE = '55000';
                    END IF;
                    IF OLD."TenantId" IS DISTINCT FROM NEW."TenantId"
                       OR OLD."ClientProfileId" IS DISTINCT FROM NEW."ClientProfileId"
                       OR OLD."MesocycleId" IS DISTINCT FROM NEW."MesocycleId"
                       OR OLD."TrainingSessionId" IS DISTINCT FROM NEW."TrainingSessionId"
                       OR OLD."ScheduledDateSnapshot" IS DISTINCT FROM NEW."ScheduledDateSnapshot"
                       OR OLD."SessionNameSnapshot" IS DISTINCT FROM NEW."SessionNameSnapshot"
                       OR OLD."SessionCoachNotesSnapshot" IS DISTINCT FROM NEW."SessionCoachNotesSnapshot"
                       OR OLD."PrescriptionVersionSnapshot" IS DISTINCT FROM NEW."PrescriptionVersionSnapshot"
                       OR OLD."StartedAtUtc" IS DISTINCT FROM NEW."StartedAtUtc" THEN
                        RAISE EXCEPTION 'Workout prescription snapshots are immutable' USING ERRCODE = '55000';
                    END IF;
                    RETURN NEW;
                END;
                $body$ LANGUAGE plpgsql;

                CREATE TRIGGER "TR_WorkoutExecutions_ProtectHistory"
                BEFORE UPDATE OR DELETE ON training."WorkoutExecutions"
                FOR EACH ROW EXECUTE FUNCTION training.protect_workout_execution();

                CREATE OR REPLACE FUNCTION training.protect_workout_exercise()
                RETURNS trigger AS $body$
                DECLARE execution_status text;
                BEGIN
                    SELECT w."Status" INTO execution_status
                    FROM training."WorkoutExecutions" w
                    WHERE w."TenantId" = COALESCE(NEW."TenantId", OLD."TenantId")
                      AND w."Id" = COALESCE(NEW."WorkoutExecutionId", OLD."WorkoutExecutionId");
                    IF TG_OP = 'DELETE' OR execution_status = 'Completed' THEN
                        RAISE EXCEPTION 'Workout exercise history is immutable' USING ERRCODE = '55000';
                    END IF;
                    IF TG_OP = 'UPDATE' AND
                       (OLD."TenantId" IS DISTINCT FROM NEW."TenantId"
                        OR OLD."WorkoutExecutionId" IS DISTINCT FROM NEW."WorkoutExecutionId"
                        OR OLD."ExercisePrescriptionId" IS DISTINCT FROM NEW."ExercisePrescriptionId"
                        OR OLD."PrescribedExerciseId" IS DISTINCT FROM NEW."PrescribedExerciseId"
                        OR OLD."PrescribedExerciseName" IS DISTINCT FROM NEW."PrescribedExerciseName"
                        OR OLD."Position" IS DISTINCT FROM NEW."Position"
                        OR OLD."ModificationPolicySnapshot" IS DISTINCT FROM NEW."ModificationPolicySnapshot"
                        OR OLD."IsMainLiftSnapshot" IS DISTINCT FROM NEW."IsMainLiftSnapshot"
                        OR OLD."CoachNotesSnapshot" IS DISTINCT FROM NEW."CoachNotesSnapshot") THEN
                        RAISE EXCEPTION 'Workout exercise prescription snapshots are immutable' USING ERRCODE = '55000';
                    END IF;
                    RETURN NEW;
                END;
                $body$ LANGUAGE plpgsql;

                CREATE TRIGGER "TR_WorkoutExercisePerformances_ProtectHistory"
                BEFORE INSERT OR UPDATE OR DELETE ON training."WorkoutExercisePerformances"
                FOR EACH ROW EXECUTE FUNCTION training.protect_workout_exercise();

                CREATE TRIGGER "TR_WorkoutExerciseAlternatives_AppendOnly"
                BEFORE UPDATE OR DELETE ON training."WorkoutExerciseAlternativeSnapshots"
                FOR EACH ROW EXECUTE FUNCTION platform.reject_append_only_mutation();

                CREATE OR REPLACE FUNCTION training.protect_workout_set()
                RETURNS trigger AS $body$
                DECLARE execution_status text;
                BEGIN
                    SELECT w."Status" INTO execution_status
                    FROM training."WorkoutExercisePerformances" e
                    JOIN training."WorkoutExecutions" w
                      ON w."TenantId" = e."TenantId" AND w."Id" = e."WorkoutExecutionId"
                    WHERE e."TenantId" = COALESCE(NEW."TenantId", OLD."TenantId")
                      AND e."Id" = COALESCE(NEW."WorkoutExercisePerformanceId", OLD."WorkoutExercisePerformanceId");
                    IF TG_OP = 'DELETE' OR execution_status = 'Completed' THEN
                        RAISE EXCEPTION 'Workout set history is immutable' USING ERRCODE = '55000';
                    END IF;
                    IF TG_OP = 'UPDATE' AND
                       (OLD."TenantId" IS DISTINCT FROM NEW."TenantId"
                        OR OLD."WorkoutExercisePerformanceId" IS DISTINCT FROM NEW."WorkoutExercisePerformanceId"
                        OR OLD."SetPrescriptionId" IS DISTINCT FROM NEW."SetPrescriptionId"
                        OR OLD."Position" IS DISTINCT FROM NEW."Position"
                        OR OLD."SetTypeSnapshot" IS DISTINCT FROM NEW."SetTypeSnapshot"
                        OR OLD."PrescribedRepetitionsMinimum" IS DISTINCT FROM NEW."PrescribedRepetitionsMinimum"
                        OR OLD."PrescribedRepetitionsMaximum" IS DISTINCT FROM NEW."PrescribedRepetitionsMaximum"
                        OR OLD."PrescribedLoad" IS DISTINCT FROM NEW."PrescribedLoad"
                        OR OLD."PrescribedLoadUnit" IS DISTINCT FROM NEW."PrescribedLoadUnit"
                        OR OLD."PrescribedTargetRpe" IS DISTINCT FROM NEW."PrescribedTargetRpe"
                        OR OLD."PrescribedRestSeconds" IS DISTINCT FROM NEW."PrescribedRestSeconds"
                        OR OLD."PrescribedTempo" IS DISTINCT FROM NEW."PrescribedTempo"
                        OR OLD."CoachNotesSnapshot" IS DISTINCT FROM NEW."CoachNotesSnapshot"
                        OR OLD."CalculationStrategyKeySnapshot" IS DISTINCT FROM NEW."CalculationStrategyKeySnapshot"
                        OR OLD."CalculationStrategyVersionSnapshot" IS DISTINCT FROM NEW."CalculationStrategyVersionSnapshot"
                        OR OLD."UnroundedRecommendedLoadSnapshot" IS DISTINCT FROM NEW."UnroundedRecommendedLoadSnapshot") THEN
                        RAISE EXCEPTION 'Workout set prescription snapshots are immutable' USING ERRCODE = '55000';
                    END IF;
                    RETURN NEW;
                END;
                $body$ LANGUAGE plpgsql;

                CREATE TRIGGER "TR_WorkoutSetPerformances_ProtectHistory"
                BEFORE INSERT OR UPDATE OR DELETE ON training."WorkoutSetPerformances"
                FOR EACH ROW EXECUTE FUNCTION training.protect_workout_set();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ExerciseAlternatives",
                schema: "exercise_library");

            migrationBuilder.DropTable(
                name: "ExerciseMediaLinks",
                schema: "exercise_library");

            migrationBuilder.DropTable(
                name: "ExerciseMuscles",
                schema: "exercise_library");

            migrationBuilder.DropTable(
                name: "ExercisePrescriptionAlternatives",
                schema: "training");

            migrationBuilder.DropTable(
                name: "ExerciseTags",
                schema: "exercise_library");

            migrationBuilder.DropTable(
                name: "ProgramTemplateExerciseAlternatives",
                schema: "training");

            migrationBuilder.DropTable(
                name: "ProgramTemplateSets",
                schema: "training");

            migrationBuilder.DropTable(
                name: "ProgressionApplications",
                schema: "training");

            migrationBuilder.DropTable(
                name: "SavedSessionTemplates",
                schema: "training");

            migrationBuilder.DropTable(
                name: "SetPrescriptions",
                schema: "training");

            migrationBuilder.DropTable(
                name: "WorkoutExerciseAlternativeSnapshots",
                schema: "training");

            migrationBuilder.DropTable(
                name: "WorkoutNotes",
                schema: "training");

            migrationBuilder.DropTable(
                name: "WorkoutSetPerformances",
                schema: "training");

            migrationBuilder.DropTable(
                name: "Assets",
                schema: "media");

            migrationBuilder.DropTable(
                name: "ProgramTemplateExercises",
                schema: "training");

            migrationBuilder.DropTable(
                name: "ExercisePrescriptions",
                schema: "training");

            migrationBuilder.DropTable(
                name: "WorkingMaxSnapshots",
                schema: "strength");

            migrationBuilder.DropTable(
                name: "WorkoutExercisePerformances",
                schema: "training");

            migrationBuilder.DropTable(
                name: "ProgramTemplateSessions",
                schema: "training");

            migrationBuilder.DropTable(
                name: "MaxHistory",
                schema: "strength");

            migrationBuilder.DropTable(
                name: "ProgramTemplateWeeks",
                schema: "training");

            migrationBuilder.DropTable(
                name: "Exercises",
                schema: "exercise_library");

            migrationBuilder.DropTable(
                name: "WorkoutExecutions",
                schema: "training");

            migrationBuilder.DropTable(
                name: "Sessions",
                schema: "training");

            migrationBuilder.DropTable(
                name: "MesocycleWeeks",
                schema: "training");

            migrationBuilder.DropTable(
                name: "Mesocycles",
                schema: "training");

            migrationBuilder.DropTable(
                name: "ProgramTemplateVersions",
                schema: "training");

            migrationBuilder.DropTable(
                name: "ProgramTemplates",
                schema: "training");

            migrationBuilder.Sql(
                """
                DROP FUNCTION IF EXISTS training.protect_workout_set();
                DROP FUNCTION IF EXISTS training.protect_workout_exercise();
                DROP FUNCTION IF EXISTS training.protect_workout_execution();
                DROP FUNCTION IF EXISTS training.protect_set_prescription();
                DROP FUNCTION IF EXISTS training.protect_exercise_prescription();
                DROP FUNCTION IF EXISTS training.protect_session_history();
                DROP FUNCTION IF EXISTS training.protect_template_version();
                """);
        }
    }
}
