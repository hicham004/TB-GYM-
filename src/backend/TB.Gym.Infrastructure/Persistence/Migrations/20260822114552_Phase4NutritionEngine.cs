using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TB.Gym.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Phase4NutritionEngine : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "nutrition");

            migrationBuilder.CreateTable(
                name: "AiMealDraftOperations",
                schema: "nutrition",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    PromptVersion = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    SchemaVersion = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    ProviderKey = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Model = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    ModelVersion = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    ValidatedDraftJson = table.Column<string>(type: "jsonb", nullable: true),
                    UncertainFieldsJson = table.Column<string>(type: "jsonb", nullable: true),
                    FailureCode = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    CostAmount = table.Column<decimal>(type: "numeric(12,4)", precision: 12, scale: 4, nullable: false),
                    CostCurrency = table.Column<string>(type: "character(3)", fixedLength: true, maxLength: 3, nullable: false),
                    ReviewedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    ReviewedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AiMealDraftOperations", x => x.Id);
                    table.UniqueConstraint("AK_AiMealDraftOperations_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_AiMealDraftOperations_Cost", "\"CostAmount\" >= 0");
                });

            migrationBuilder.CreateTable(
                name: "CalculationSnapshots",
                schema: "nutrition",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientProfileId = table.Column<Guid>(type: "uuid", nullable: false),
                    BmrMethodKey = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    BmrMethodVersion = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    BmrEstimate = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    ActivityModelKey = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    ActivityModelVersion = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    ActivityModelPal = table.Column<decimal>(type: "numeric(6,3)", precision: 6, scale: 3, nullable: false),
                    TdeeMethodKey = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    TdeeMethodVersion = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    TdeeEstimate = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    CoachGoalAdjustment = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    CalorieTarget = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    ProteinGrams = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    FatGrams = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    CarbohydrateGrams = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    MacroMethodKey = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    MacroMethodVersion = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    EnergyPolicyKey = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    EnergyPolicyVersion = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    InputJson = table.Column<string>(type: "jsonb", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CalculationSnapshots", x => x.Id);
                    table.UniqueConstraint("AK_CalculationSnapshots_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_CalculationSnapshots_Valid", "\"BmrEstimate\" > 0 AND \"ActivityModelPal\" >= 1.4 AND \"ActivityModelPal\" <= 2.4 AND \"TdeeEstimate\" > 0 AND \"CalorieTarget\" > 0 AND \"ProteinGrams\" >= 0 AND \"CarbohydrateGrams\" >= 0 AND \"FatGrams\" >= 0");
                    table.ForeignKey(
                        name: "FK_CalculationSnapshots_ClientProfiles_TenantId_ClientProfileId",
                        columns: x => new { x.TenantId, x.ClientProfileId },
                        principalSchema: "clients",
                        principalTable: "ClientProfiles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ClientDeclaredAllergens",
                schema: "nutrition",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientProfileId = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    RecordedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    DeactivatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    DeactivatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ClientDeclaredAllergens", x => x.Id);
                    table.UniqueConstraint("AK_ClientDeclaredAllergens_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_ClientDeclaredAllergens_ClientProfiles_TenantId_ClientProfi~",
                        columns: x => new { x.TenantId, x.ClientProfileId },
                        principalSchema: "clients",
                        principalTable: "ClientProfiles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "CookingFactors",
                schema: "nutrition",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    SourceKey = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    SourceVersion = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    FromBasis = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ToBasis = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Factor = table.Column<decimal>(type: "numeric(12,6)", precision: 12, scale: 6, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CookingFactors", x => x.Id);
                    table.UniqueConstraint("AK_CookingFactors_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_CookingFactors_Factor", "\"Factor\" > 0 AND \"Factor\" <= 2 AND \"FromBasis\" <> \"ToBasis\"");
                });

            migrationBuilder.CreateTable(
                name: "FoodItems",
                schema: "nutrition",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    NormalizedName = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    Provenance = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    ExternalId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    ExternalDataType = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    LabelMediaAssetId = table.Column<Guid>(type: "uuid", nullable: true),
                    CurrentRevision = table.Column<int>(type: "integer", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FoodItems", x => x.Id);
                    table.UniqueConstraint("AK_FoodItems_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_FoodItems_CurrentRevision", "\"CurrentRevision\" >= 0");
                    table.ForeignKey(
                        name: "FK_FoodItems_Assets_TenantId_LabelMediaAssetId",
                        columns: x => new { x.TenantId, x.LabelMediaAssetId },
                        principalSchema: "media",
                        principalTable: "Assets",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "MealPlanTemplates",
                schema: "nutrition",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    NormalizedName = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    CurrentRevision = table.Column<int>(type: "integer", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MealPlanTemplates", x => x.Id);
                    table.UniqueConstraint("AK_MealPlanTemplates_TenantId_Id", x => new { x.TenantId, x.Id });
                });

            migrationBuilder.CreateTable(
                name: "Recipes",
                schema: "nutrition",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    NormalizedName = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    CurrentRevision = table.Column<int>(type: "integer", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Recipes", x => x.Id);
                    table.UniqueConstraint("AK_Recipes_TenantId_Id", x => new { x.TenantId, x.Id });
                });

            migrationBuilder.CreateTable(
                name: "WorkspaceSettings",
                schema: "nutrition",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    EnergyPolicyKey = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    EnergyPolicyVersion = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    ProviderCalorieTolerance = table.Column<decimal>(type: "numeric(9,3)", precision: 9, scale: 3, nullable: false),
                    AllergenDisplayRegime = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    AiMonthlyRequestLimit = table.Column<int>(type: "integer", nullable: false),
                    AiMonthlyCostLimit = table.Column<decimal>(type: "numeric(12,2)", precision: 12, scale: 2, nullable: false),
                    AiCostCurrency = table.Column<string>(type: "character(3)", fixedLength: true, maxLength: 3, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WorkspaceSettings", x => x.Id);
                    table.UniqueConstraint("AK_WorkspaceSettings_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_NutritionWorkspaceSettings_AiLimits", "\"AiMonthlyRequestLimit\" >= 0 AND \"AiMonthlyCostLimit\" >= 0");
                    table.CheckConstraint("CK_NutritionWorkspaceSettings_Tolerance", "\"ProviderCalorieTolerance\" >= 0");
                    table.ForeignKey(
                        name: "FK_WorkspaceSettings_Tenants_TenantId",
                        column: x => x.TenantId,
                        principalSchema: "tenancy",
                        principalTable: "Tenants",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "MacroOverrideAudits",
                schema: "nutrition",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CalculationSnapshotId = table.Column<Guid>(type: "uuid", nullable: false),
                    ProteinGrams = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    FatGrams = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    CarbohydrateGrams = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    Reason = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
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
                    table.PrimaryKey("PK_MacroOverrideAudits", x => x.Id);
                    table.UniqueConstraint("AK_MacroOverrideAudits_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_MacroOverrideAudits_NonNegative", "\"ProteinGrams\" >= 0 AND \"CarbohydrateGrams\" >= 0 AND \"FatGrams\" >= 0");
                    table.ForeignKey(
                        name: "FK_MacroOverrideAudits_CalculationSnapshots_TenantId_Calculati~",
                        columns: x => new { x.TenantId, x.CalculationSnapshotId },
                        principalSchema: "nutrition",
                        principalTable: "CalculationSnapshots",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "FoodItemVersions",
                schema: "nutrition",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    FoodItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false),
                    BasisQuantity = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    BasisUnit = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    PreparationBasis = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ProteinGrams = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    CarbohydrateGrams = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    FatGrams = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    FibreGrams = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    PolyolGrams = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    EthanolGrams = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    ComputedCalories = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    ProviderCalories = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: true),
                    EnergyPolicyKey = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    EnergyPolicyVersion = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    CalorieTolerance = table.Column<decimal>(type: "numeric(9,3)", precision: 9, scale: 3, nullable: false),
                    HasCalorieDiscrepancy = table.Column<bool>(type: "boolean", nullable: false),
                    SourceAttribution = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    SourceRecordVersion = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FoodItemVersions", x => x.Id);
                    table.UniqueConstraint("AK_FoodItemVersions_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_FoodItemVersions_NonNegative", "\"BasisQuantity\" > 0 AND \"ProteinGrams\" >= 0 AND \"CarbohydrateGrams\" >= 0 AND \"FatGrams\" >= 0 AND \"FibreGrams\" >= 0 AND \"PolyolGrams\" >= 0 AND \"EthanolGrams\" >= 0 AND \"ComputedCalories\" >= 0 AND (\"ProviderCalories\" IS NULL OR \"ProviderCalories\" >= 0)");
                    table.ForeignKey(
                        name: "FK_FoodItemVersions_FoodItems_TenantId_FoodItemId",
                        columns: x => new { x.TenantId, x.FoodItemId },
                        principalSchema: "nutrition",
                        principalTable: "FoodItems",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "MealPlanTemplateVersions",
                schema: "nutrition",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    MealPlanTemplateId = table.Column<Guid>(type: "uuid", nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false),
                    DayCount = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    PublishedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    PublishedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    TargetCalories = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    TargetProteinGrams = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    TargetCarbohydrateGrams = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    TargetFatGrams = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MealPlanTemplateVersions", x => x.Id);
                    table.UniqueConstraint("AK_MealPlanTemplateVersions_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_MealPlanTemplateVersions_Valid", "\"DayCount\" >= 1 AND \"DayCount\" <= 365 AND \"TargetCalories\" > 0 AND \"TargetProteinGrams\" >= 0 AND \"TargetCarbohydrateGrams\" >= 0 AND \"TargetFatGrams\" >= 0");
                    table.ForeignKey(
                        name: "FK_MealPlanTemplateVersions_MealPlanTemplates_TenantId_MealPla~",
                        columns: x => new { x.TenantId, x.MealPlanTemplateId },
                        principalSchema: "nutrition",
                        principalTable: "MealPlanTemplates",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "RecipeVersions",
                schema: "nutrition",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RecipeId = table.Column<Guid>(type: "uuid", nullable: false),
                    Revision = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    PublishedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    PublishedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    Instructions = table.Column<string>(type: "character varying(20000)", maxLength: 20000, nullable: false),
                    Servings = table.Column<decimal>(type: "numeric(12,4)", precision: 12, scale: 4, nullable: false),
                    Calories = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    ProteinGrams = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    CarbohydrateGrams = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    FatGrams = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RecipeVersions", x => x.Id);
                    table.UniqueConstraint("AK_RecipeVersions_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_RecipeVersions_Macros", "\"Servings\" > 0 AND \"Calories\" >= 0 AND \"ProteinGrams\" >= 0 AND \"CarbohydrateGrams\" >= 0 AND \"FatGrams\" >= 0");
                    table.ForeignKey(
                        name: "FK_RecipeVersions_Recipes_TenantId_RecipeId",
                        columns: x => new { x.TenantId, x.RecipeId },
                        principalSchema: "nutrition",
                        principalTable: "Recipes",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "FoodItemAllergens",
                schema: "nutrition",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    FoodItemVersionId = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FoodItemAllergens", x => x.Id);
                    table.UniqueConstraint("AK_FoodItemAllergens_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_FoodItemAllergens_FoodItemVersions_TenantId_FoodItemVersion~",
                        columns: x => new { x.TenantId, x.FoodItemVersionId },
                        principalSchema: "nutrition",
                        principalTable: "FoodItemVersions",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ClientNutritionPlans",
                schema: "nutrition",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientProfileId = table.Column<Guid>(type: "uuid", nullable: false),
                    EnrollmentId = table.Column<Guid>(type: "uuid", nullable: false),
                    SourceMealPlanTemplateVersionId = table.Column<Guid>(type: "uuid", nullable: false),
                    NutritionCalculationSnapshotId = table.Column<Guid>(type: "uuid", nullable: false),
                    StartDate = table.Column<DateOnly>(type: "date", nullable: false),
                    EndDateExclusive = table.Column<DateOnly>(type: "date", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ClientNutritionPlans", x => x.Id);
                    table.UniqueConstraint("AK_ClientNutritionPlans_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_ClientNutritionPlans_Period", "\"EndDateExclusive\" > \"StartDate\"");
                    table.ForeignKey(
                        name: "FK_ClientNutritionPlans_CalculationSnapshots_TenantId_Nutritio~",
                        columns: x => new { x.TenantId, x.NutritionCalculationSnapshotId },
                        principalSchema: "nutrition",
                        principalTable: "CalculationSnapshots",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ClientNutritionPlans_ClientEnrollments_TenantId_EnrollmentId",
                        columns: x => new { x.TenantId, x.EnrollmentId },
                        principalSchema: "subscriptions",
                        principalTable: "ClientEnrollments",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ClientNutritionPlans_ClientProfiles_TenantId_ClientProfileId",
                        columns: x => new { x.TenantId, x.ClientProfileId },
                        principalSchema: "clients",
                        principalTable: "ClientProfiles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ClientNutritionPlans_MealPlanTemplateVersions_TenantId_Sour~",
                        columns: x => new { x.TenantId, x.SourceMealPlanTemplateVersionId },
                        principalSchema: "nutrition",
                        principalTable: "MealPlanTemplateVersions",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "MealPlanSlots",
                schema: "nutrition",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    MealPlanTemplateVersionId = table.Column<Guid>(type: "uuid", nullable: false),
                    DayOffset = table.Column<int>(type: "integer", nullable: false),
                    Order = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    AverageCalories = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    AverageProteinGrams = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    AverageCarbohydrateGrams = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    AverageFatGrams = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MealPlanSlots", x => x.Id);
                    table.UniqueConstraint("AK_MealPlanSlots_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_MealPlanSlots_MealPlanTemplateVersions_TenantId_MealPlanTem~",
                        columns: x => new { x.TenantId, x.MealPlanTemplateVersionId },
                        principalSchema: "nutrition",
                        principalTable: "MealPlanTemplateVersions",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "RecipeIngredients",
                schema: "nutrition",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RecipeVersionId = table.Column<Guid>(type: "uuid", nullable: false),
                    Order = table.Column<int>(type: "integer", nullable: false),
                    FoodItemVersionId = table.Column<Guid>(type: "uuid", nullable: false),
                    FoodName = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    Quantity = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    Unit = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Basis = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ProteinGrams = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    CarbohydrateGrams = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    FatGrams = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    Calories = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    Provenance = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    YieldFactorId = table.Column<Guid>(type: "uuid", nullable: true),
                    RetentionFactorId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RecipeIngredients", x => x.Id);
                    table.UniqueConstraint("AK_RecipeIngredients_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_RecipeIngredients_NonNegative", "\"Quantity\" > 0 AND \"Calories\" >= 0 AND \"ProteinGrams\" >= 0 AND \"CarbohydrateGrams\" >= 0 AND \"FatGrams\" >= 0");
                    table.ForeignKey(
                        name: "FK_RecipeIngredients_CookingFactors_TenantId_RetentionFactorId",
                        columns: x => new { x.TenantId, x.RetentionFactorId },
                        principalSchema: "nutrition",
                        principalTable: "CookingFactors",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_RecipeIngredients_CookingFactors_TenantId_YieldFactorId",
                        columns: x => new { x.TenantId, x.YieldFactorId },
                        principalSchema: "nutrition",
                        principalTable: "CookingFactors",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_RecipeIngredients_FoodItemVersions_TenantId_FoodItemVersion~",
                        columns: x => new { x.TenantId, x.FoodItemVersionId },
                        principalSchema: "nutrition",
                        principalTable: "FoodItemVersions",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_RecipeIngredients_RecipeVersions_TenantId_RecipeVersionId",
                        columns: x => new { x.TenantId, x.RecipeVersionId },
                        principalSchema: "nutrition",
                        principalTable: "RecipeVersions",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "RecipeVersionAllergens",
                schema: "nutrition",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RecipeVersionId = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RecipeVersionAllergens", x => x.Id);
                    table.UniqueConstraint("AK_RecipeVersionAllergens_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_RecipeVersionAllergens_RecipeVersions_TenantId_RecipeVersio~",
                        columns: x => new { x.TenantId, x.RecipeVersionId },
                        principalSchema: "nutrition",
                        principalTable: "RecipeVersions",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "AllergenConflictRecords",
                schema: "nutrition",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientProfileId = table.Column<Guid>(type: "uuid", nullable: false),
                    RecipeVersionId = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientNutritionPlanId = table.Column<Guid>(type: "uuid", nullable: true),
                    ConflictCodes = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    WarningLanguage = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    ReviewedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AllergenConflictRecords", x => x.Id);
                    table.UniqueConstraint("AK_AllergenConflictRecords_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_AllergenConflictRecords_ClientNutritionPlans_TenantId_Clien~",
                        columns: x => new { x.TenantId, x.ClientNutritionPlanId },
                        principalSchema: "nutrition",
                        principalTable: "ClientNutritionPlans",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_AllergenConflictRecords_ClientProfiles_TenantId_ClientProfi~",
                        columns: x => new { x.TenantId, x.ClientProfileId },
                        principalSchema: "clients",
                        principalTable: "ClientProfiles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_AllergenConflictRecords_RecipeVersions_TenantId_RecipeVersi~",
                        columns: x => new { x.TenantId, x.RecipeVersionId },
                        principalSchema: "nutrition",
                        principalTable: "RecipeVersions",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ClientNutritionPlanDays",
                schema: "nutrition",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientNutritionPlanId = table.Column<Guid>(type: "uuid", nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ClientNutritionPlanDays", x => x.Id);
                    table.UniqueConstraint("AK_ClientNutritionPlanDays_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_ClientNutritionPlanDays_ClientNutritionPlans_TenantId_Clien~",
                        columns: x => new { x.TenantId, x.ClientNutritionPlanId },
                        principalSchema: "nutrition",
                        principalTable: "ClientNutritionPlans",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "MealPlanChoices",
                schema: "nutrition",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    MealPlanSlotId = table.Column<Guid>(type: "uuid", nullable: false),
                    RecipeVersionId = table.Column<Guid>(type: "uuid", nullable: false),
                    RecipeName = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    Servings = table.Column<decimal>(type: "numeric(12,4)", precision: 12, scale: 4, nullable: false),
                    Calories = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    ProteinGrams = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    CarbohydrateGrams = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    FatGrams = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MealPlanChoices", x => x.Id);
                    table.UniqueConstraint("AK_MealPlanChoices_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_MealPlanChoices_NonNegative", "\"Servings\" > 0 AND \"Calories\" >= 0 AND \"ProteinGrams\" >= 0 AND \"CarbohydrateGrams\" >= 0 AND \"FatGrams\" >= 0");
                    table.ForeignKey(
                        name: "FK_MealPlanChoices_MealPlanSlots_TenantId_MealPlanSlotId",
                        columns: x => new { x.TenantId, x.MealPlanSlotId },
                        principalSchema: "nutrition",
                        principalTable: "MealPlanSlots",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_MealPlanChoices_RecipeVersions_TenantId_RecipeVersionId",
                        columns: x => new { x.TenantId, x.RecipeVersionId },
                        principalSchema: "nutrition",
                        principalTable: "RecipeVersions",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ClientNutritionPlanSlots",
                schema: "nutrition",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientNutritionPlanDayId = table.Column<Guid>(type: "uuid", nullable: false),
                    Order = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ClientNutritionPlanSlots", x => x.Id);
                    table.UniqueConstraint("AK_ClientNutritionPlanSlots_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_ClientNutritionPlanSlots_ClientNutritionPlanDays_TenantId_C~",
                        columns: x => new { x.TenantId, x.ClientNutritionPlanDayId },
                        principalSchema: "nutrition",
                        principalTable: "ClientNutritionPlanDays",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "DailyNutritionLogs",
                schema: "nutrition",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientProfileId = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientNutritionPlanId = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientNutritionPlanDayId = table.Column<Guid>(type: "uuid", nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    CompletedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DailyNutritionLogs", x => x.Id);
                    table.UniqueConstraint("AK_DailyNutritionLogs_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.ForeignKey(
                        name: "FK_DailyNutritionLogs_ClientNutritionPlanDays_TenantId_ClientN~",
                        columns: x => new { x.TenantId, x.ClientNutritionPlanDayId },
                        principalSchema: "nutrition",
                        principalTable: "ClientNutritionPlanDays",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_DailyNutritionLogs_ClientNutritionPlans_TenantId_ClientNutr~",
                        columns: x => new { x.TenantId, x.ClientNutritionPlanId },
                        principalSchema: "nutrition",
                        principalTable: "ClientNutritionPlans",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_DailyNutritionLogs_ClientProfiles_TenantId_ClientProfileId",
                        columns: x => new { x.TenantId, x.ClientProfileId },
                        principalSchema: "clients",
                        principalTable: "ClientProfiles",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ClientNutritionPlanChoices",
                schema: "nutrition",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientNutritionPlanSlotId = table.Column<Guid>(type: "uuid", nullable: false),
                    SourceRecipeVersionId = table.Column<Guid>(type: "uuid", nullable: false),
                    RecipeName = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    Servings = table.Column<decimal>(type: "numeric(12,4)", precision: 12, scale: 4, nullable: false),
                    Calories = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    ProteinGrams = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    CarbohydrateGrams = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    FatGrams = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ClientNutritionPlanChoices", x => x.Id);
                    table.UniqueConstraint("AK_ClientNutritionPlanChoices_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_ClientNutritionPlanChoices_NonNegative", "\"Servings\" > 0 AND \"Calories\" >= 0 AND \"ProteinGrams\" >= 0 AND \"CarbohydrateGrams\" >= 0 AND \"FatGrams\" >= 0");
                    table.ForeignKey(
                        name: "FK_ClientNutritionPlanChoices_ClientNutritionPlanSlots_TenantI~",
                        columns: x => new { x.TenantId, x.ClientNutritionPlanSlotId },
                        principalSchema: "nutrition",
                        principalTable: "ClientNutritionPlanSlots",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ClientNutritionPlanChoices_RecipeVersions_TenantId_SourceRe~",
                        columns: x => new { x.TenantId, x.SourceRecipeVersionId },
                        principalSchema: "nutrition",
                        principalTable: "RecipeVersions",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "DailyNutritionLogEntries",
                schema: "nutrition",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    DailyNutritionLogId = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientNutritionPlanSlotId = table.Column<Guid>(type: "uuid", nullable: false),
                    SelectedClientNutritionPlanChoiceId = table.Column<Guid>(type: "uuid", nullable: false),
                    RecipeName = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    Servings = table.Column<decimal>(type: "numeric(12,4)", precision: 12, scale: 4, nullable: false),
                    Calories = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    ProteinGrams = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    CarbohydrateGrams = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    FatGrams = table.Column<decimal>(type: "numeric(18,6)", precision: 18, scale: 6, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    TenantId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DailyNutritionLogEntries", x => x.Id);
                    table.UniqueConstraint("AK_DailyNutritionLogEntries_TenantId_Id", x => new { x.TenantId, x.Id });
                    table.CheckConstraint("CK_DailyNutritionLogEntries_NonNegative", "\"Servings\" > 0 AND \"Calories\" >= 0 AND \"ProteinGrams\" >= 0 AND \"CarbohydrateGrams\" >= 0 AND \"FatGrams\" >= 0");
                    table.ForeignKey(
                        name: "FK_DailyNutritionLogEntries_ClientNutritionPlanChoices_TenantI~",
                        columns: x => new { x.TenantId, x.SelectedClientNutritionPlanChoiceId },
                        principalSchema: "nutrition",
                        principalTable: "ClientNutritionPlanChoices",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_DailyNutritionLogEntries_ClientNutritionPlanSlots_TenantId_~",
                        columns: x => new { x.TenantId, x.ClientNutritionPlanSlotId },
                        principalSchema: "nutrition",
                        principalTable: "ClientNutritionPlanSlots",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_DailyNutritionLogEntries_DailyNutritionLogs_TenantId_DailyN~",
                        columns: x => new { x.TenantId, x.DailyNutritionLogId },
                        principalSchema: "nutrition",
                        principalTable: "DailyNutritionLogs",
                        principalColumns: new[] { "TenantId", "Id" },
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AiMealDraftOperations_TenantId_CreatedAtUtc",
                schema: "nutrition",
                table: "AiMealDraftOperations",
                columns: new[] { "TenantId", "CreatedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_AllergenConflictRecords_TenantId_ClientNutritionPlanId",
                schema: "nutrition",
                table: "AllergenConflictRecords",
                columns: new[] { "TenantId", "ClientNutritionPlanId" });

            migrationBuilder.CreateIndex(
                name: "IX_AllergenConflictRecords_TenantId_ClientProfileId_CreatedAtU~",
                schema: "nutrition",
                table: "AllergenConflictRecords",
                columns: new[] { "TenantId", "ClientProfileId", "CreatedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_AllergenConflictRecords_TenantId_RecipeVersionId",
                schema: "nutrition",
                table: "AllergenConflictRecords",
                columns: new[] { "TenantId", "RecipeVersionId" });

            migrationBuilder.CreateIndex(
                name: "IX_CalculationSnapshots_TenantId_ClientProfileId_CreatedAtUtc",
                schema: "nutrition",
                table: "CalculationSnapshots",
                columns: new[] { "TenantId", "ClientProfileId", "CreatedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_ClientDeclaredAllergens_TenantId_ClientProfileId_Code",
                schema: "nutrition",
                table: "ClientDeclaredAllergens",
                columns: new[] { "TenantId", "ClientProfileId", "Code" },
                unique: true,
                filter: "\"IsActive\"");

            migrationBuilder.CreateIndex(
                name: "IX_ClientNutritionPlanChoices_TenantId_ClientNutritionPlanSlot~",
                schema: "nutrition",
                table: "ClientNutritionPlanChoices",
                columns: new[] { "TenantId", "ClientNutritionPlanSlotId" });

            migrationBuilder.CreateIndex(
                name: "IX_ClientNutritionPlanChoices_TenantId_SourceRecipeVersionId",
                schema: "nutrition",
                table: "ClientNutritionPlanChoices",
                columns: new[] { "TenantId", "SourceRecipeVersionId" });

            migrationBuilder.CreateIndex(
                name: "IX_ClientNutritionPlanDays_TenantId_ClientNutritionPlanId_Date",
                schema: "nutrition",
                table: "ClientNutritionPlanDays",
                columns: new[] { "TenantId", "ClientNutritionPlanId", "Date" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ClientNutritionPlans_TenantId_ClientProfileId_StartDate_End~",
                schema: "nutrition",
                table: "ClientNutritionPlans",
                columns: new[] { "TenantId", "ClientProfileId", "StartDate", "EndDateExclusive" });

            migrationBuilder.CreateIndex(
                name: "IX_ClientNutritionPlans_TenantId_EnrollmentId",
                schema: "nutrition",
                table: "ClientNutritionPlans",
                columns: new[] { "TenantId", "EnrollmentId" });

            migrationBuilder.CreateIndex(
                name: "IX_ClientNutritionPlans_TenantId_NutritionCalculationSnapshotId",
                schema: "nutrition",
                table: "ClientNutritionPlans",
                columns: new[] { "TenantId", "NutritionCalculationSnapshotId" });

            migrationBuilder.CreateIndex(
                name: "IX_ClientNutritionPlans_TenantId_SourceMealPlanTemplateVersion~",
                schema: "nutrition",
                table: "ClientNutritionPlans",
                columns: new[] { "TenantId", "SourceMealPlanTemplateVersionId" });

            migrationBuilder.CreateIndex(
                name: "IX_ClientNutritionPlanSlots_TenantId_ClientNutritionPlanDayId_~",
                schema: "nutrition",
                table: "ClientNutritionPlanSlots",
                columns: new[] { "TenantId", "ClientNutritionPlanDayId", "Order" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CookingFactors_TenantId_Kind_SourceKey_SourceVersion_FromBa~",
                schema: "nutrition",
                table: "CookingFactors",
                columns: new[] { "TenantId", "Kind", "SourceKey", "SourceVersion", "FromBasis", "ToBasis" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_DailyNutritionLogEntries_TenantId_ClientNutritionPlanSlotId",
                schema: "nutrition",
                table: "DailyNutritionLogEntries",
                columns: new[] { "TenantId", "ClientNutritionPlanSlotId" });

            migrationBuilder.CreateIndex(
                name: "IX_DailyNutritionLogEntries_TenantId_DailyNutritionLogId_Clien~",
                schema: "nutrition",
                table: "DailyNutritionLogEntries",
                columns: new[] { "TenantId", "DailyNutritionLogId", "ClientNutritionPlanSlotId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_DailyNutritionLogEntries_TenantId_SelectedClientNutritionPl~",
                schema: "nutrition",
                table: "DailyNutritionLogEntries",
                columns: new[] { "TenantId", "SelectedClientNutritionPlanChoiceId" });

            migrationBuilder.CreateIndex(
                name: "IX_DailyNutritionLogs_TenantId_ClientNutritionPlanDayId",
                schema: "nutrition",
                table: "DailyNutritionLogs",
                columns: new[] { "TenantId", "ClientNutritionPlanDayId" });

            migrationBuilder.CreateIndex(
                name: "IX_DailyNutritionLogs_TenantId_ClientNutritionPlanId",
                schema: "nutrition",
                table: "DailyNutritionLogs",
                columns: new[] { "TenantId", "ClientNutritionPlanId" });

            migrationBuilder.CreateIndex(
                name: "IX_DailyNutritionLogs_TenantId_ClientProfileId_Date",
                schema: "nutrition",
                table: "DailyNutritionLogs",
                columns: new[] { "TenantId", "ClientProfileId", "Date" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_FoodItemAllergens_TenantId_FoodItemVersionId_Code",
                schema: "nutrition",
                table: "FoodItemAllergens",
                columns: new[] { "TenantId", "FoodItemVersionId", "Code" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_FoodItems_TenantId_LabelMediaAssetId",
                schema: "nutrition",
                table: "FoodItems",
                columns: new[] { "TenantId", "LabelMediaAssetId" });

            migrationBuilder.CreateIndex(
                name: "IX_FoodItems_TenantId_NormalizedName",
                schema: "nutrition",
                table: "FoodItems",
                columns: new[] { "TenantId", "NormalizedName" });

            migrationBuilder.CreateIndex(
                name: "IX_FoodItems_TenantId_Provenance_ExternalId",
                schema: "nutrition",
                table: "FoodItems",
                columns: new[] { "TenantId", "Provenance", "ExternalId" },
                unique: true,
                filter: "\"ExternalId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_FoodItemVersions_TenantId_FoodItemId_Revision",
                schema: "nutrition",
                table: "FoodItemVersions",
                columns: new[] { "TenantId", "FoodItemId", "Revision" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_MacroOverrideAudits_TenantId_CalculationSnapshotId_CreatedA~",
                schema: "nutrition",
                table: "MacroOverrideAudits",
                columns: new[] { "TenantId", "CalculationSnapshotId", "CreatedAtUtc" });

            migrationBuilder.CreateIndex(
                name: "IX_MealPlanChoices_TenantId_MealPlanSlotId",
                schema: "nutrition",
                table: "MealPlanChoices",
                columns: new[] { "TenantId", "MealPlanSlotId" });

            migrationBuilder.CreateIndex(
                name: "IX_MealPlanChoices_TenantId_RecipeVersionId",
                schema: "nutrition",
                table: "MealPlanChoices",
                columns: new[] { "TenantId", "RecipeVersionId" });

            migrationBuilder.CreateIndex(
                name: "IX_MealPlanSlots_TenantId_MealPlanTemplateVersionId_DayOffset_~",
                schema: "nutrition",
                table: "MealPlanSlots",
                columns: new[] { "TenantId", "MealPlanTemplateVersionId", "DayOffset", "Order" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_MealPlanTemplates_TenantId_NormalizedName",
                schema: "nutrition",
                table: "MealPlanTemplates",
                columns: new[] { "TenantId", "NormalizedName" });

            migrationBuilder.CreateIndex(
                name: "IX_MealPlanTemplateVersions_TenantId_MealPlanTemplateId_Revisi~",
                schema: "nutrition",
                table: "MealPlanTemplateVersions",
                columns: new[] { "TenantId", "MealPlanTemplateId", "Revision" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_RecipeIngredients_TenantId_FoodItemVersionId",
                schema: "nutrition",
                table: "RecipeIngredients",
                columns: new[] { "TenantId", "FoodItemVersionId" });

            migrationBuilder.CreateIndex(
                name: "IX_RecipeIngredients_TenantId_RecipeVersionId_Order",
                schema: "nutrition",
                table: "RecipeIngredients",
                columns: new[] { "TenantId", "RecipeVersionId", "Order" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_RecipeIngredients_TenantId_RetentionFactorId",
                schema: "nutrition",
                table: "RecipeIngredients",
                columns: new[] { "TenantId", "RetentionFactorId" });

            migrationBuilder.CreateIndex(
                name: "IX_RecipeIngredients_TenantId_YieldFactorId",
                schema: "nutrition",
                table: "RecipeIngredients",
                columns: new[] { "TenantId", "YieldFactorId" });

            migrationBuilder.CreateIndex(
                name: "IX_Recipes_TenantId_NormalizedName",
                schema: "nutrition",
                table: "Recipes",
                columns: new[] { "TenantId", "NormalizedName" });

            migrationBuilder.CreateIndex(
                name: "IX_RecipeVersionAllergens_TenantId_RecipeVersionId_Code",
                schema: "nutrition",
                table: "RecipeVersionAllergens",
                columns: new[] { "TenantId", "RecipeVersionId", "Code" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_RecipeVersions_TenantId_RecipeId_Revision",
                schema: "nutrition",
                table: "RecipeVersions",
                columns: new[] { "TenantId", "RecipeId", "Revision" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_WorkspaceSettings_TenantId",
                schema: "nutrition",
                table: "WorkspaceSettings",
                column: "TenantId",
                unique: true);

            migrationBuilder.Sql("CREATE EXTENSION IF NOT EXISTS pg_trgm;");
            migrationBuilder.Sql("CREATE EXTENSION IF NOT EXISTS btree_gist;");
            migrationBuilder.Sql("CREATE INDEX IF NOT EXISTS \"IX_FoodItems_Name_Trgm\" ON nutrition.\"FoodItems\" USING gin (\"Name\" gin_trgm_ops);");
            migrationBuilder.Sql("CREATE INDEX IF NOT EXISTS \"IX_Recipes_Name_Trgm\" ON nutrition.\"Recipes\" USING gin (\"Name\" gin_trgm_ops);");
            migrationBuilder.Sql("""
                ALTER TABLE nutrition."ClientNutritionPlans"
                ADD CONSTRAINT "EX_ClientNutritionPlans_Client_Period"
                EXCLUDE USING gist (
                    "TenantId" WITH =,
                    "ClientProfileId" WITH =,
                    daterange("StartDate", "EndDateExclusive", '[)') WITH &&
                );
                """);

            migrationBuilder.Sql("""
                CREATE OR REPLACE FUNCTION nutrition.reject_update_delete()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '23514';
                END;
                $function$;

                CREATE TRIGGER "TR_CalculationSnapshots_AppendOnly"
                    BEFORE UPDATE OR DELETE ON nutrition."CalculationSnapshots"
                    FOR EACH ROW EXECUTE FUNCTION nutrition.reject_update_delete();
                CREATE TRIGGER "TR_MacroOverrideAudits_AppendOnly"
                    BEFORE UPDATE OR DELETE ON nutrition."MacroOverrideAudits"
                    FOR EACH ROW EXECUTE FUNCTION nutrition.reject_update_delete();
                CREATE TRIGGER "TR_CookingFactors_AppendOnly"
                    BEFORE UPDATE OR DELETE ON nutrition."CookingFactors"
                    FOR EACH ROW EXECUTE FUNCTION nutrition.reject_update_delete();
                CREATE TRIGGER "TR_FoodItemVersions_AppendOnly"
                    BEFORE UPDATE OR DELETE ON nutrition."FoodItemVersions"
                    FOR EACH ROW EXECUTE FUNCTION nutrition.reject_update_delete();
                CREATE TRIGGER "TR_FoodItemAllergens_AppendOnly"
                    BEFORE UPDATE OR DELETE ON nutrition."FoodItemAllergens"
                    FOR EACH ROW EXECUTE FUNCTION nutrition.reject_update_delete();
                CREATE TRIGGER "TR_AllergenConflictRecords_AppendOnly"
                    BEFORE UPDATE OR DELETE ON nutrition."AllergenConflictRecords"
                    FOR EACH ROW EXECUTE FUNCTION nutrition.reject_update_delete();
                CREATE TRIGGER "TR_ClientNutritionPlans_Immutable"
                    BEFORE UPDATE OR DELETE ON nutrition."ClientNutritionPlans"
                    FOR EACH ROW EXECUTE FUNCTION nutrition.reject_update_delete();
                CREATE TRIGGER "TR_ClientNutritionPlanDays_Immutable"
                    BEFORE UPDATE OR DELETE ON nutrition."ClientNutritionPlanDays"
                    FOR EACH ROW EXECUTE FUNCTION nutrition.reject_update_delete();
                CREATE TRIGGER "TR_ClientNutritionPlanSlots_Immutable"
                    BEFORE UPDATE OR DELETE ON nutrition."ClientNutritionPlanSlots"
                    FOR EACH ROW EXECUTE FUNCTION nutrition.reject_update_delete();
                CREATE TRIGGER "TR_ClientNutritionPlanChoices_Immutable"
                    BEFORE UPDATE OR DELETE ON nutrition."ClientNutritionPlanChoices"
                    FOR EACH ROW EXECUTE FUNCTION nutrition.reject_update_delete();
                """);

            migrationBuilder.Sql("""
                CREATE OR REPLACE FUNCTION nutrition.reject_published_recipe_version_mutation()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF OLD."Status" = 'Published' THEN
                        RAISE EXCEPTION 'Published recipe versions are immutable' USING ERRCODE = '23514';
                    END IF;
                    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE OR REPLACE FUNCTION nutrition.reject_published_recipe_child_mutation()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF EXISTS (
                        SELECT 1 FROM nutrition."RecipeVersions" version
                        WHERE version."TenantId" = OLD."TenantId"
                          AND version."Id" = OLD."RecipeVersionId"
                          AND version."Status" = 'Published') THEN
                        RAISE EXCEPTION 'Published recipe content is immutable' USING ERRCODE = '23514';
                    END IF;
                    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER "TR_RecipeVersions_PublishedImmutable"
                    BEFORE UPDATE OR DELETE ON nutrition."RecipeVersions"
                    FOR EACH ROW EXECUTE FUNCTION nutrition.reject_published_recipe_version_mutation();
                CREATE TRIGGER "TR_RecipeIngredients_PublishedImmutable"
                    BEFORE UPDATE OR DELETE ON nutrition."RecipeIngredients"
                    FOR EACH ROW EXECUTE FUNCTION nutrition.reject_published_recipe_child_mutation();
                CREATE TRIGGER "TR_RecipeVersionAllergens_PublishedImmutable"
                    BEFORE UPDATE OR DELETE ON nutrition."RecipeVersionAllergens"
                    FOR EACH ROW EXECUTE FUNCTION nutrition.reject_published_recipe_child_mutation();
                """);

            migrationBuilder.Sql("""
                CREATE OR REPLACE FUNCTION nutrition.reject_published_meal_plan_version_mutation()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF OLD."Status" = 'Published' THEN
                        RAISE EXCEPTION 'Published meal-plan versions are immutable' USING ERRCODE = '23514';
                    END IF;
                    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE OR REPLACE FUNCTION nutrition.reject_published_meal_slot_mutation()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF EXISTS (
                        SELECT 1 FROM nutrition."MealPlanTemplateVersions" version
                        WHERE version."TenantId" = OLD."TenantId"
                          AND version."Id" = OLD."MealPlanTemplateVersionId"
                          AND version."Status" = 'Published') THEN
                        RAISE EXCEPTION 'Published meal-plan content is immutable' USING ERRCODE = '23514';
                    END IF;
                    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE OR REPLACE FUNCTION nutrition.reject_published_meal_choice_mutation()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF EXISTS (
                        SELECT 1
                        FROM nutrition."MealPlanSlots" slot
                        JOIN nutrition."MealPlanTemplateVersions" version
                          ON version."TenantId" = slot."TenantId"
                         AND version."Id" = slot."MealPlanTemplateVersionId"
                        WHERE slot."TenantId" = OLD."TenantId"
                          AND slot."Id" = OLD."MealPlanSlotId"
                          AND version."Status" = 'Published') THEN
                        RAISE EXCEPTION 'Published meal-plan choices are immutable' USING ERRCODE = '23514';
                    END IF;
                    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER "TR_MealPlanTemplateVersions_PublishedImmutable"
                    BEFORE UPDATE OR DELETE ON nutrition."MealPlanTemplateVersions"
                    FOR EACH ROW EXECUTE FUNCTION nutrition.reject_published_meal_plan_version_mutation();
                CREATE TRIGGER "TR_MealPlanSlots_PublishedImmutable"
                    BEFORE UPDATE OR DELETE ON nutrition."MealPlanSlots"
                    FOR EACH ROW EXECUTE FUNCTION nutrition.reject_published_meal_slot_mutation();
                CREATE TRIGGER "TR_MealPlanChoices_PublishedImmutable"
                    BEFORE UPDATE OR DELETE ON nutrition."MealPlanChoices"
                    FOR EACH ROW EXECUTE FUNCTION nutrition.reject_published_meal_choice_mutation();
                """);

            migrationBuilder.Sql("""
                CREATE OR REPLACE FUNCTION nutrition.reject_completed_daily_log_mutation()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF OLD."Status" = 'Completed' THEN
                        RAISE EXCEPTION 'Completed daily nutrition logs are immutable' USING ERRCODE = '23514';
                    END IF;
                    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE OR REPLACE FUNCTION nutrition.reject_completed_daily_log_entry_mutation()
                RETURNS trigger LANGUAGE plpgsql AS $function$
                BEGIN
                    IF EXISTS (
                        SELECT 1 FROM nutrition."DailyNutritionLogs" log
                        WHERE log."TenantId" = OLD."TenantId"
                          AND log."Id" = OLD."DailyNutritionLogId"
                          AND log."Status" = 'Completed') THEN
                        RAISE EXCEPTION 'Completed daily nutrition log entries are immutable' USING ERRCODE = '23514';
                    END IF;
                    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
                    RETURN NEW;
                END;
                $function$;

                CREATE TRIGGER "TR_DailyNutritionLogs_CompletedImmutable"
                    BEFORE UPDATE OR DELETE ON nutrition."DailyNutritionLogs"
                    FOR EACH ROW EXECUTE FUNCTION nutrition.reject_completed_daily_log_mutation();
                CREATE TRIGGER "TR_DailyNutritionLogEntries_CompletedImmutable"
                    BEFORE UPDATE OR DELETE ON nutrition."DailyNutritionLogEntries"
                    FOR EACH ROW EXECUTE FUNCTION nutrition.reject_completed_daily_log_entry_mutation();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            throw new NotSupportedException(
                "Phase 4 contains immutable client and calculation history. Restore a tested backup or apply a reviewed forward repair migration instead of destructively migrating down.");
        }
    }
}
