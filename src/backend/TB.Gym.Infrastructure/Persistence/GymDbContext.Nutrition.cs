using Microsoft.EntityFrameworkCore;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Media;
using TB.Gym.Modules.Nutrition;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.Modules.Tenancy;

namespace TB.Gym.Infrastructure.Persistence;

public sealed partial class GymDbContext
{
    private void ConfigureNutrition(ModelBuilder builder)
    {
        builder.Entity<NutritionWorkspaceSettings>(entity =>
        {
            entity.ToTable("WorkspaceSettings", "nutrition");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.EnergyPolicyKey).HasMaxLength(100).IsRequired();
            entity.Property(item => item.EnergyPolicyVersion).HasMaxLength(50).IsRequired();
            entity.Property(item => item.ProviderCalorieTolerance).HasPrecision(9, 3);
            entity.Property(item => item.AiMonthlyCostLimit).HasPrecision(12, 2);
            entity.Property(item => item.AiCostCurrency).HasMaxLength(3).IsFixedLength().IsRequired();
            entity.HasIndex(item => item.TenantId).IsUnique();
            entity.HasOne<Tenant>().WithMany().HasForeignKey(item => item.TenantId).OnDelete(DeleteBehavior.Restrict);
            entity.ToTable(table =>
            {
                table.HasCheckConstraint("CK_NutritionWorkspaceSettings_Tolerance", "\"ProviderCalorieTolerance\" >= 0");
                table.HasCheckConstraint("CK_NutritionWorkspaceSettings_AiLimits", "\"AiMonthlyRequestLimit\" >= 0 AND \"AiMonthlyCostLimit\" >= 0");
            });
            ConfigureTenantEntity(entity);
        });

        builder.Entity<FoodItem>(entity =>
        {
            entity.ToTable("FoodItems", "nutrition");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Name).HasMaxLength(300).IsRequired();
            entity.Property(item => item.NormalizedName).HasMaxLength(300).IsRequired();
            entity.Property(item => item.Provenance).HasConversion<string>().HasMaxLength(32);
            entity.Property(item => item.ExternalId).HasMaxLength(100);
            entity.Property(item => item.ExternalDataType).HasMaxLength(100);
            entity.HasIndex(item => new { item.TenantId, item.NormalizedName });
            entity.HasIndex(item => new { item.TenantId, item.Provenance, item.ExternalId }).IsUnique().HasFilter("\"ExternalId\" IS NOT NULL");
            entity.HasMany(item => item.Versions).WithOne().HasForeignKey(item => new { item.TenantId, item.FoodItemId }).HasPrincipalKey(item => new { item.TenantId, item.Id }).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<MediaAsset>().WithMany().HasForeignKey(item => new { item.TenantId, item.LabelMediaAssetId }).HasPrincipalKey(item => new { item.TenantId, item.Id }).OnDelete(DeleteBehavior.Restrict);
            entity.ToTable(table => table.HasCheckConstraint("CK_FoodItems_CurrentRevision", "\"CurrentRevision\" >= 0"));
            ConfigureTenantEntity(entity);
        });

        builder.Entity<FoodItemVersion>(entity =>
        {
            entity.ToTable("FoodItemVersions", "nutrition");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.BasisUnit).HasConversion<string>().HasMaxLength(20);
            entity.Property(item => item.PreparationBasis).HasConversion<string>().HasMaxLength(20);
            entity.Property(item => item.EnergyPolicyKey).HasMaxLength(100).IsRequired();
            entity.Property(item => item.EnergyPolicyVersion).HasMaxLength(50).IsRequired();
            entity.Property(item => item.SourceAttribution).HasMaxLength(500).IsRequired();
            entity.Property(item => item.SourceRecordVersion).HasMaxLength(100).IsRequired();
            ConfigureMacroPrecision(entity);
            entity.Property(item => item.BasisQuantity).HasPrecision(18, 6);
            entity.Property(item => item.FibreGrams).HasPrecision(18, 6);
            entity.Property(item => item.PolyolGrams).HasPrecision(18, 6);
            entity.Property(item => item.EthanolGrams).HasPrecision(18, 6);
            entity.Property(item => item.ComputedCalories).HasPrecision(18, 6);
            entity.Property(item => item.ProviderCalories).HasPrecision(18, 6);
            entity.Property(item => item.CalorieTolerance).HasPrecision(9, 3);
            entity.HasIndex(item => new { item.TenantId, item.FoodItemId, item.Revision }).IsUnique();
            entity.HasMany(item => item.Allergens).WithOne().HasForeignKey(item => new { item.TenantId, item.FoodItemVersionId }).HasPrincipalKey(item => new { item.TenantId, item.Id }).OnDelete(DeleteBehavior.Restrict);
            entity.ToTable(table => table.HasCheckConstraint("CK_FoodItemVersions_NonNegative", "\"BasisQuantity\" > 0 AND \"ProteinGrams\" >= 0 AND \"CarbohydrateGrams\" >= 0 AND \"FatGrams\" >= 0 AND \"FibreGrams\" >= 0 AND \"PolyolGrams\" >= 0 AND \"EthanolGrams\" >= 0 AND \"ComputedCalories\" >= 0 AND (\"ProviderCalories\" IS NULL OR \"ProviderCalories\" >= 0)"));
            ConfigureTenantEntity(entity);
        });

        builder.Entity<FoodItemAllergen>(entity =>
        {
            entity.ToTable("FoodItemAllergens", "nutrition");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Code).HasConversion<string>().HasMaxLength(40);
            entity.HasIndex(item => new { item.TenantId, item.FoodItemVersionId, item.Code }).IsUnique();
            ConfigureTenantEntity(entity);
        });

        builder.Entity<CookingFactorRecord>(entity =>
        {
            entity.ToTable("CookingFactors", "nutrition");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Kind).HasMaxLength(32).IsRequired();
            entity.Property(item => item.SourceKey).HasMaxLength(200).IsRequired();
            entity.Property(item => item.SourceVersion).HasMaxLength(100).IsRequired();
            entity.Property(item => item.FromBasis).HasConversion<string>().HasMaxLength(20);
            entity.Property(item => item.ToBasis).HasConversion<string>().HasMaxLength(20);
            entity.Property(item => item.Factor).HasPrecision(12, 6);
            entity.HasIndex(item => new { item.TenantId, item.Kind, item.SourceKey, item.SourceVersion, item.FromBasis, item.ToBasis }).IsUnique();
            entity.ToTable(table => table.HasCheckConstraint(
                "CK_CookingFactors_Factor",
                "\"Factor\" > 0 AND \"FromBasis\" <> \"ToBasis\" AND (CASE WHEN \"Kind\" = 'Retention' THEN \"Factor\" <= 1 ELSE \"Factor\" <= 5 END)"));
            ConfigureTenantEntity(entity);
        });

        ConfigureRecipes(builder);
        ConfigureCalculationSnapshots(builder);
        ConfigureMealPlans(builder);
        ConfigureAssignedPlansAndLogs(builder);
        ConfigureNutritionSafetyAndAi(builder);
    }

    private void ConfigureRecipes(ModelBuilder builder)
    {
        builder.Entity<Recipe>(entity =>
        {
            entity.ToTable("Recipes", "nutrition");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Name).HasMaxLength(300).IsRequired();
            entity.Property(item => item.NormalizedName).HasMaxLength(300).IsRequired();
            entity.HasIndex(item => new { item.TenantId, item.NormalizedName });
            entity.HasMany(item => item.Versions).WithOne().HasForeignKey(item => new { item.TenantId, item.RecipeId }).HasPrincipalKey(item => new { item.TenantId, item.Id }).OnDelete(DeleteBehavior.Restrict);
            ConfigureTenantEntity(entity);
        });

        builder.Entity<RecipeVersion>(entity =>
        {
            entity.ToTable("RecipeVersions", "nutrition");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Status).HasConversion<string>().HasMaxLength(20);
            entity.Property(item => item.Instructions).HasMaxLength(20_000).IsRequired();
            entity.Property(item => item.Servings).HasPrecision(12, 4);
            ConfigureMacroPrecision(entity);
            entity.Property(item => item.Calories).HasPrecision(18, 6);
            entity.HasIndex(item => new { item.TenantId, item.RecipeId, item.Revision }).IsUnique();
            entity.HasMany(item => item.Ingredients).WithOne().HasForeignKey(item => new { item.TenantId, item.RecipeVersionId }).HasPrincipalKey(item => new { item.TenantId, item.Id }).OnDelete(DeleteBehavior.Restrict);
            entity.HasMany(item => item.Allergens).WithOne().HasForeignKey(item => new { item.TenantId, item.RecipeVersionId }).HasPrincipalKey(item => new { item.TenantId, item.Id }).OnDelete(DeleteBehavior.Restrict);
            entity.ToTable(table => table.HasCheckConstraint("CK_RecipeVersions_Macros", "\"Servings\" > 0 AND \"Calories\" >= 0 AND \"ProteinGrams\" >= 0 AND \"CarbohydrateGrams\" >= 0 AND \"FatGrams\" >= 0"));
            ConfigureTenantEntity(entity);
        });

        builder.Entity<RecipeIngredient>(entity =>
        {
            entity.ToTable("RecipeIngredients", "nutrition");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.FoodName).HasMaxLength(300).IsRequired();
            entity.Property(item => item.Unit).HasConversion<string>().HasMaxLength(20);
            entity.Property(item => item.Basis).HasConversion<string>().HasMaxLength(20);
            entity.Property(item => item.Provenance).HasMaxLength(500).IsRequired();
            entity.Property(item => item.Quantity).HasPrecision(18, 6);
            ConfigureMacroPrecision(entity);
            entity.Property(item => item.Calories).HasPrecision(18, 6);
            entity.HasIndex(item => new { item.TenantId, item.RecipeVersionId, item.Order }).IsUnique();
            entity.HasOne<FoodItemVersion>().WithMany().HasForeignKey(item => new { item.TenantId, item.FoodItemVersionId }).HasPrincipalKey(item => new { item.TenantId, item.Id }).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<CookingFactorRecord>().WithMany().HasForeignKey(item => new { item.TenantId, item.YieldFactorId }).HasPrincipalKey(item => new { item.TenantId, item.Id }).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<CookingFactorRecord>().WithMany().HasForeignKey(item => new { item.TenantId, item.RetentionFactorId }).HasPrincipalKey(item => new { item.TenantId, item.Id }).OnDelete(DeleteBehavior.Restrict);
            entity.ToTable(table => table.HasCheckConstraint("CK_RecipeIngredients_NonNegative", "\"Quantity\" > 0 AND \"Calories\" >= 0 AND \"ProteinGrams\" >= 0 AND \"CarbohydrateGrams\" >= 0 AND \"FatGrams\" >= 0"));
            ConfigureTenantEntity(entity);
        });

        builder.Entity<RecipeVersionAllergen>(entity =>
        {
            entity.ToTable("RecipeVersionAllergens", "nutrition");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Code).HasConversion<string>().HasMaxLength(40);
            entity.HasIndex(item => new { item.TenantId, item.RecipeVersionId, item.Code }).IsUnique();
            ConfigureTenantEntity(entity);
        });
    }

    private void ConfigureCalculationSnapshots(ModelBuilder builder)
    {
        builder.Entity<NutritionCalculationSnapshot>(entity =>
        {
            entity.ToTable("CalculationSnapshots", "nutrition");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.BmrMethodKey).HasMaxLength(100).IsRequired();
            entity.Property(item => item.BmrMethodVersion).HasMaxLength(50).IsRequired();
            entity.Property(item => item.ActivityModelKey).HasMaxLength(100).IsRequired();
            entity.Property(item => item.ActivityModelVersion).HasMaxLength(50).IsRequired();
            entity.Property(item => item.TdeeMethodKey).HasMaxLength(100).IsRequired();
            entity.Property(item => item.TdeeMethodVersion).HasMaxLength(50).IsRequired();
            entity.Property(item => item.MacroMethodKey).HasMaxLength(100).IsRequired();
            entity.Property(item => item.MacroMethodVersion).HasMaxLength(50).IsRequired();
            entity.Property(item => item.EnergyPolicyKey).HasMaxLength(100).IsRequired();
            entity.Property(item => item.EnergyPolicyVersion).HasMaxLength(50).IsRequired();
            entity.Property(item => item.InputJson).HasColumnType("jsonb").IsRequired();
            ConfigureMacroPrecision(entity);
            entity.Property(item => item.BmrEstimate).HasPrecision(18, 6);
            entity.Property(item => item.ActivityModelPal).HasPrecision(6, 3);
            entity.Property(item => item.TdeeEstimate).HasPrecision(18, 6);
            entity.Property(item => item.CoachGoalAdjustment).HasPrecision(18, 6);
            entity.Property(item => item.CalorieTarget).HasPrecision(18, 6);
            entity.HasIndex(item => new { item.TenantId, item.ClientProfileId, item.CreatedAtUtc });
            entity.HasOne<ClientProfile>().WithMany().HasForeignKey(item => new { item.TenantId, item.ClientProfileId }).HasPrincipalKey(item => new { item.TenantId, item.Id }).OnDelete(DeleteBehavior.Restrict);
            entity.ToTable(table => table.HasCheckConstraint("CK_CalculationSnapshots_Valid", "\"BmrEstimate\" > 0 AND \"ActivityModelPal\" >= 1.4 AND \"ActivityModelPal\" <= 2.4 AND \"TdeeEstimate\" > 0 AND \"CalorieTarget\" > 0 AND \"ProteinGrams\" >= 0 AND \"CarbohydrateGrams\" >= 0 AND \"FatGrams\" >= 0"));
            ConfigureTenantEntity(entity);
        });

        builder.Entity<MacroOverrideAudit>(entity =>
        {
            entity.ToTable("MacroOverrideAudits", "nutrition");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Reason).HasMaxLength(1_000).IsRequired();
            ConfigureMacroPrecision(entity);
            entity.HasIndex(item => new { item.TenantId, item.CalculationSnapshotId, item.CreatedAtUtc });
            entity.HasOne<NutritionCalculationSnapshot>().WithMany().HasForeignKey(item => new { item.TenantId, item.CalculationSnapshotId }).HasPrincipalKey(item => new { item.TenantId, item.Id }).OnDelete(DeleteBehavior.Restrict);
            entity.ToTable(table => table.HasCheckConstraint("CK_MacroOverrideAudits_NonNegative", "\"ProteinGrams\" >= 0 AND \"CarbohydrateGrams\" >= 0 AND \"FatGrams\" >= 0"));
            ConfigureTenantEntity(entity);
        });
    }

    private void ConfigureMealPlans(ModelBuilder builder)
    {
        builder.Entity<MealPlanTemplate>(entity =>
        {
            entity.ToTable("MealPlanTemplates", "nutrition");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Name).HasMaxLength(300).IsRequired();
            entity.Property(item => item.NormalizedName).HasMaxLength(300).IsRequired();
            entity.HasIndex(item => new { item.TenantId, item.NormalizedName });
            entity.HasMany(item => item.Versions).WithOne().HasForeignKey(item => new { item.TenantId, item.MealPlanTemplateId }).HasPrincipalKey(item => new { item.TenantId, item.Id }).OnDelete(DeleteBehavior.Restrict);
            ConfigureTenantEntity(entity);
        });

        builder.Entity<MealPlanTemplateVersion>(entity =>
        {
            entity.ToTable("MealPlanTemplateVersions", "nutrition");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Status).HasConversion<string>().HasMaxLength(20);
            entity.Property(item => item.TargetCalories).HasPrecision(18, 6);
            entity.Property(item => item.TargetProteinGrams).HasPrecision(18, 6);
            entity.Property(item => item.TargetCarbohydrateGrams).HasPrecision(18, 6);
            entity.Property(item => item.TargetFatGrams).HasPrecision(18, 6);
            entity.HasIndex(item => new { item.TenantId, item.MealPlanTemplateId, item.Revision }).IsUnique();
            entity.HasMany(item => item.Slots).WithOne().HasForeignKey(item => new { item.TenantId, item.MealPlanTemplateVersionId }).HasPrincipalKey(item => new { item.TenantId, item.Id }).OnDelete(DeleteBehavior.Restrict);
            entity.ToTable(table => table.HasCheckConstraint("CK_MealPlanTemplateVersions_Valid", "\"DayCount\" >= 1 AND \"DayCount\" <= 365 AND \"TargetCalories\" > 0 AND \"TargetProteinGrams\" >= 0 AND \"TargetCarbohydrateGrams\" >= 0 AND \"TargetFatGrams\" >= 0"));
            ConfigureTenantEntity(entity);
        });

        builder.Entity<MealPlanSlot>(entity =>
        {
            entity.ToTable("MealPlanSlots", "nutrition");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Name).HasMaxLength(200).IsRequired();
            entity.Property(item => item.AverageCalories).HasPrecision(18, 6);
            entity.Property(item => item.AverageProteinGrams).HasPrecision(18, 6);
            entity.Property(item => item.AverageCarbohydrateGrams).HasPrecision(18, 6);
            entity.Property(item => item.AverageFatGrams).HasPrecision(18, 6);
            entity.HasIndex(item => new { item.TenantId, item.MealPlanTemplateVersionId, item.DayOffset, item.Order }).IsUnique();
            entity.HasMany(item => item.Choices).WithOne().HasForeignKey(item => new { item.TenantId, item.MealPlanSlotId }).HasPrincipalKey(item => new { item.TenantId, item.Id }).OnDelete(DeleteBehavior.Restrict);
            ConfigureTenantEntity(entity);
        });

        builder.Entity<MealPlanChoice>(entity =>
        {
            entity.ToTable("MealPlanChoices", "nutrition");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.RecipeName).HasMaxLength(300).IsRequired();
            entity.Property(item => item.Servings).HasPrecision(12, 4);
            ConfigureMacroPrecision(entity);
            entity.Property(item => item.Calories).HasPrecision(18, 6);
            entity.HasOne<RecipeVersion>().WithMany().HasForeignKey(item => new { item.TenantId, item.RecipeVersionId }).HasPrincipalKey(item => new { item.TenantId, item.Id }).OnDelete(DeleteBehavior.Restrict);
            entity.ToTable(table => table.HasCheckConstraint("CK_MealPlanChoices_NonNegative", "\"Servings\" > 0 AND \"Calories\" >= 0 AND \"ProteinGrams\" >= 0 AND \"CarbohydrateGrams\" >= 0 AND \"FatGrams\" >= 0"));
            ConfigureTenantEntity(entity);
        });
    }

    private void ConfigureAssignedPlansAndLogs(ModelBuilder builder)
    {
        builder.Entity<ClientNutritionPlan>(entity =>
        {
            entity.ToTable("ClientNutritionPlans", "nutrition");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.StartDate).HasColumnType("date");
            entity.Property(item => item.EndDateExclusive).HasColumnType("date");
            entity.Property(item => item.Status).HasConversion<string>().HasMaxLength(20);
            entity.HasIndex(item => new { item.TenantId, item.ClientProfileId, item.StartDate, item.EndDateExclusive });
            entity.HasOne<ClientProfile>().WithMany().HasForeignKey(item => new { item.TenantId, item.ClientProfileId }).HasPrincipalKey(item => new { item.TenantId, item.Id }).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ClientEnrollment>().WithMany().HasForeignKey(item => new { item.TenantId, item.EnrollmentId }).HasPrincipalKey(item => new { item.TenantId, item.Id }).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<MealPlanTemplateVersion>().WithMany().HasForeignKey(item => new { item.TenantId, item.SourceMealPlanTemplateVersionId }).HasPrincipalKey(item => new { item.TenantId, item.Id }).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<NutritionCalculationSnapshot>().WithMany().HasForeignKey(item => new { item.TenantId, item.NutritionCalculationSnapshotId }).HasPrincipalKey(item => new { item.TenantId, item.Id }).OnDelete(DeleteBehavior.Restrict);
            entity.HasMany(item => item.Days).WithOne().HasForeignKey(item => new { item.TenantId, item.ClientNutritionPlanId }).HasPrincipalKey(item => new { item.TenantId, item.Id }).OnDelete(DeleteBehavior.Restrict);
            entity.ToTable(table =>
            {
                table.HasCheckConstraint("CK_ClientNutritionPlans_Period", "\"EndDateExclusive\" > \"StartDate\"");
                // Only an active plan may reserve its date range; cancelling must release it.
                table.HasCheckConstraint("CK_ClientNutritionPlans_BlocksOverlap", "(\"Status\" = 'Active') = \"BlocksOverlap\"");
            });
            ConfigureTenantEntity(entity);
        });

        builder.Entity<NutritionPlanLifecycleEvent>(entity =>
        {
            entity.ToTable("PlanLifecycleEvents", "nutrition");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.EventType).HasConversion<string>().HasMaxLength(20);
            entity.Property(item => item.FromStatus).HasConversion<string>().HasMaxLength(20);
            entity.Property(item => item.ToStatus).HasConversion<string>().HasMaxLength(20);
            entity.Property(item => item.Reason).HasMaxLength(500).IsRequired();
            entity.HasIndex(item => new { item.TenantId, item.ClientNutritionPlanId, item.OccurredAtUtc });
            entity.HasOne<ClientNutritionPlan>().WithMany().HasForeignKey(item => new { item.TenantId, item.ClientNutritionPlanId }).HasPrincipalKey(item => new { item.TenantId, item.Id }).OnDelete(DeleteBehavior.Restrict);
            ConfigureTenantEntity(entity);
        });

        builder.Entity<ClientNutritionPlanDay>(entity =>
        {
            entity.ToTable("ClientNutritionPlanDays", "nutrition");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Date).HasColumnType("date");
            entity.HasIndex(item => new { item.TenantId, item.ClientNutritionPlanId, item.Date }).IsUnique();
            entity.HasMany(item => item.Slots).WithOne().HasForeignKey(item => new { item.TenantId, item.ClientNutritionPlanDayId }).HasPrincipalKey(item => new { item.TenantId, item.Id }).OnDelete(DeleteBehavior.Restrict);
            ConfigureTenantEntity(entity);
        });

        builder.Entity<ClientNutritionPlanSlot>(entity =>
        {
            entity.ToTable("ClientNutritionPlanSlots", "nutrition");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Name).HasMaxLength(200).IsRequired();
            entity.HasIndex(item => new { item.TenantId, item.ClientNutritionPlanDayId, item.Order }).IsUnique();
            entity.HasMany(item => item.Choices).WithOne().HasForeignKey(item => new { item.TenantId, item.ClientNutritionPlanSlotId }).HasPrincipalKey(item => new { item.TenantId, item.Id }).OnDelete(DeleteBehavior.Restrict);
            ConfigureTenantEntity(entity);
        });

        builder.Entity<ClientNutritionPlanChoice>(entity =>
        {
            entity.ToTable("ClientNutritionPlanChoices", "nutrition");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.RecipeName).HasMaxLength(300).IsRequired();
            entity.Property(item => item.Servings).HasPrecision(12, 4);
            ConfigureMacroPrecision(entity);
            entity.Property(item => item.Calories).HasPrecision(18, 6);
            entity.HasOne<RecipeVersion>().WithMany().HasForeignKey(item => new { item.TenantId, item.SourceRecipeVersionId }).HasPrincipalKey(item => new { item.TenantId, item.Id }).OnDelete(DeleteBehavior.Restrict);
            entity.ToTable(table => table.HasCheckConstraint("CK_ClientNutritionPlanChoices_NonNegative", "\"Servings\" > 0 AND \"Calories\" >= 0 AND \"ProteinGrams\" >= 0 AND \"CarbohydrateGrams\" >= 0 AND \"FatGrams\" >= 0"));
            ConfigureTenantEntity(entity);
        });

        builder.Entity<DailyNutritionLog>(entity =>
        {
            entity.ToTable("DailyNutritionLogs", "nutrition");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Date).HasColumnType("date");
            entity.Property(item => item.Status).HasConversion<string>().HasMaxLength(20);
            entity.Ignore(item => item.SelectedCalories);
            entity.Ignore(item => item.SelectedProteinGrams);
            entity.Ignore(item => item.SelectedCarbohydrateGrams);
            entity.Ignore(item => item.SelectedFatGrams);
            entity.HasIndex(item => new { item.TenantId, item.ClientProfileId, item.Date }).IsUnique();
            entity.HasOne<ClientProfile>().WithMany().HasForeignKey(item => new { item.TenantId, item.ClientProfileId }).HasPrincipalKey(item => new { item.TenantId, item.Id }).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ClientNutritionPlan>().WithMany().HasForeignKey(item => new { item.TenantId, item.ClientNutritionPlanId }).HasPrincipalKey(item => new { item.TenantId, item.Id }).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ClientNutritionPlanDay>().WithMany().HasForeignKey(item => new { item.TenantId, item.ClientNutritionPlanDayId }).HasPrincipalKey(item => new { item.TenantId, item.Id }).OnDelete(DeleteBehavior.Restrict);
            entity.HasMany(item => item.Entries).WithOne().HasForeignKey(item => new { item.TenantId, item.DailyNutritionLogId }).HasPrincipalKey(item => new { item.TenantId, item.Id }).OnDelete(DeleteBehavior.Restrict);
            ConfigureTenantEntity(entity);
        });

        builder.Entity<DailyNutritionLogEntry>(entity =>
        {
            entity.ToTable("DailyNutritionLogEntries", "nutrition");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.RecipeName).HasMaxLength(300).IsRequired();
            entity.Property(item => item.Servings).HasPrecision(12, 4);
            ConfigureMacroPrecision(entity);
            entity.Property(item => item.Calories).HasPrecision(18, 6);
            entity.HasIndex(item => new { item.TenantId, item.DailyNutritionLogId, item.ClientNutritionPlanSlotId }).IsUnique();
            entity.HasOne<ClientNutritionPlanSlot>().WithMany().HasForeignKey(item => new { item.TenantId, item.ClientNutritionPlanSlotId }).HasPrincipalKey(item => new { item.TenantId, item.Id }).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ClientNutritionPlanChoice>().WithMany().HasForeignKey(item => new { item.TenantId, item.SelectedClientNutritionPlanChoiceId }).HasPrincipalKey(item => new { item.TenantId, item.Id }).OnDelete(DeleteBehavior.Restrict);
            entity.ToTable(table => table.HasCheckConstraint("CK_DailyNutritionLogEntries_NonNegative", "\"Servings\" > 0 AND \"Calories\" >= 0 AND \"ProteinGrams\" >= 0 AND \"CarbohydrateGrams\" >= 0 AND \"FatGrams\" >= 0"));
            ConfigureTenantEntity(entity);
        });
    }

    private void ConfigureNutritionSafetyAndAi(ModelBuilder builder)
    {
        builder.Entity<ClientDeclaredAllergen>(entity =>
        {
            entity.ToTable("ClientDeclaredAllergens", "nutrition");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Code).HasConversion<string>().HasMaxLength(40);
            entity.HasIndex(item => new { item.TenantId, item.ClientProfileId, item.Code }).IsUnique().HasFilter("\"IsActive\"");
            entity.HasOne<ClientProfile>().WithMany().HasForeignKey(item => new { item.TenantId, item.ClientProfileId }).HasPrincipalKey(item => new { item.TenantId, item.Id }).OnDelete(DeleteBehavior.Restrict);
            ConfigureTenantEntity(entity);
        });

        builder.Entity<AllergenConflictRecord>(entity =>
        {
            entity.ToTable("AllergenConflictRecords", "nutrition");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.ConflictCodes).HasMaxLength(500).IsRequired();
            entity.Property(item => item.WarningLanguage).HasMaxLength(1_000).IsRequired();
            entity.HasIndex(item => new { item.TenantId, item.ClientProfileId, item.CreatedAtUtc });
            entity.HasOne<ClientProfile>().WithMany().HasForeignKey(item => new { item.TenantId, item.ClientProfileId }).HasPrincipalKey(item => new { item.TenantId, item.Id }).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<RecipeVersion>().WithMany().HasForeignKey(item => new { item.TenantId, item.RecipeVersionId }).HasPrincipalKey(item => new { item.TenantId, item.Id }).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne<ClientNutritionPlan>().WithMany().HasForeignKey(item => new { item.TenantId, item.ClientNutritionPlanId }).HasPrincipalKey(item => new { item.TenantId, item.Id }).OnDelete(DeleteBehavior.Restrict);
            ConfigureTenantEntity(entity);
        });

        builder.Entity<AiMealDraftOperation>(entity =>
        {
            entity.ToTable("AiMealDraftOperations", "nutrition");
            entity.HasKey(item => item.Id);
            entity.Property(item => item.Status).HasConversion<string>().HasMaxLength(32);
            entity.Property(item => item.PromptVersion).HasMaxLength(100).IsRequired();
            entity.Property(item => item.SchemaVersion).HasMaxLength(100).IsRequired();
            entity.Property(item => item.ProviderKey).HasMaxLength(100).IsRequired();
            entity.Property(item => item.Model).HasMaxLength(100);
            entity.Property(item => item.ModelVersion).HasMaxLength(100);
            entity.Property(item => item.ValidatedDraftJson).HasColumnType("jsonb");
            entity.Property(item => item.UncertainFieldsJson).HasColumnType("jsonb");
            entity.Property(item => item.FailureCode).HasMaxLength(100);
            entity.Property(item => item.CostAmount).HasPrecision(12, 4);
            entity.Property(item => item.CostCurrency).HasMaxLength(3).IsFixedLength().IsRequired();
            entity.HasIndex(item => new { item.TenantId, item.CreatedAtUtc });
            entity.ToTable(table => table.HasCheckConstraint("CK_AiMealDraftOperations_Cost", "\"CostAmount\" >= 0"));
            ConfigureTenantEntity(entity);
        });
    }

    private static void ConfigureMacroPrecision<TEntity>(Microsoft.EntityFrameworkCore.Metadata.Builders.EntityTypeBuilder<TEntity> entity)
        where TEntity : class
    {
        foreach (var propertyName in new[] { "ProteinGrams", "CarbohydrateGrams", "FatGrams" })
        {
            if (typeof(TEntity).GetProperty(propertyName) is not null)
            {
                entity.Property<decimal>(propertyName).HasPrecision(18, 6);
            }
        }
    }
}
