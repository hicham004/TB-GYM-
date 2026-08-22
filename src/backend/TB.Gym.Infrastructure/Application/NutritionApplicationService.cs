using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Nutrition;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.Modules.Tenancy;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

internal sealed class NutritionApplicationService(
    GymDbContext dbContext,
    IClock clock,
    ICurrentUser currentUser,
    ITenantContext tenantContext,
    ICoachingFeatureAccessService featureAccessService,
    INutritionDataProvider nutritionDataProvider,
    IAiMealDraftProvider aiMealDraftProvider) : INutritionApplicationService
{
    private const string AiSchemaVersion = "meal-draft-v1";
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<NutritionWorkspaceSettingsView> GetSettingsAsync(CancellationToken cancellationToken)
    {
        var settings = await dbContext.NutritionWorkspaceSettings.SingleOrDefaultAsync(cancellationToken);
        if (settings is null)
        {
            settings = NutritionWorkspaceSettings.CreateDefault(tenantContext.TenantId);
            dbContext.NutritionWorkspaceSettings.Add(settings);
            await dbContext.SaveChangesAsync(cancellationToken);
        }

        return ToSettingsView(settings);
    }

    public async Task<NutritionCommandResult> UpdateSettingsAsync(UpdateNutritionSettingsRequest request, CancellationToken cancellationToken)
    {
        var settings = await dbContext.NutritionWorkspaceSettings.SingleOrDefaultAsync(cancellationToken);
        if (settings is null)
        {
            if (request.Version != 0)
            {
                return Conflict("nutrition_settings_conflict", "Nutrition settings were initialized by another request.");
            }

            settings = NutritionWorkspaceSettings.CreateDefault(tenantContext.TenantId);
            dbContext.NutritionWorkspaceSettings.Add(settings);
        }
        else
        {
            dbContext.Entry(settings).Property(item => item.Version).OriginalValue = request.Version;
        }

        try
        {
            settings.Update(request.EnergyPolicyKey, request.ProviderCalorieTolerance, request.AiMonthlyRequestLimit, request.AiMonthlyCostLimit, request.AiCostCurrency);
            await dbContext.SaveChangesAsync(cancellationToken);
            return new NutritionCommandResult(NutritionCommandStatus.Success, Settings: ToSettingsView(settings));
        }
        catch (ArgumentException exception)
        {
            return Invalid("settings", exception.Message);
        }
        catch (DbUpdateConcurrencyException)
        {
            return Conflict("nutrition_settings_conflict", "Nutrition settings changed while this request was being saved.");
        }
    }

    public async Task<FoodItemPage> ListFoodsAsync(string? query, int skip, int take, CancellationToken cancellationToken)
    {
        var source = dbContext.FoodItems.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(query))
        {
            var pattern = $"%{query.Trim()}%";
            source = source.Where(item => EF.Functions.ILike(item.Name, pattern));
        }

        var total = await source.CountAsync(cancellationToken);
        var foods = await source.OrderBy(item => item.Name).Skip(skip).Take(take)
            .Include(item => item.Versions).ThenInclude(item => item.Allergens)
            .AsSplitQuery()
            .ToListAsync(cancellationToken);
        return new FoodItemPage(total, skip, take, foods.Select(ToFoodView).ToArray());
    }

    public async Task<NutritionCommandResult> CreateFoodAsync(CreateFoodItemRequest request, CancellationToken cancellationToken)
    {
        try
        {
            var settings = await GetOrCreateSettingsEntityAsync(cancellationToken);
            var food = FoodItem.Create(tenantContext.TenantId, request.Name, request.Provenance, request.ExternalId, request.ExternalDataType, request.LabelMediaAssetId);
            food.AddVersion(ToFoodVersionInput(request.Version, settings));
            dbContext.FoodItems.Add(food);
            await dbContext.SaveChangesAsync(cancellationToken);
            return new NutritionCommandResult(NutritionCommandStatus.Success, Food: ToFoodView(food));
        }
        catch (ArgumentException exception)
        {
            return Invalid("food", exception.Message);
        }
        catch (DbUpdateException)
        {
            return Conflict("food_conflict", "A food with the same tenant/provider identity already exists.");
        }
    }

    public async Task<NutritionCommandResult> AddFoodVersionAsync(Guid foodItemId, AddFoodVersionRequest request, CancellationToken cancellationToken)
    {
        var food = await dbContext.FoodItems.SingleOrDefaultAsync(item => item.Id == foodItemId, cancellationToken);
        if (food is null)
        {
            return NotFound();
        }

        try
        {
            var settings = await GetOrCreateSettingsEntityAsync(cancellationToken);
            var version = food.AddVersion(ToFoodVersionInput(request, settings));
            dbContext.FoodItemVersions.Add(version);
            await dbContext.SaveChangesAsync(cancellationToken);
            var reloaded = await dbContext.FoodItems.AsNoTracking().Include(item => item.Versions).ThenInclude(item => item.Allergens)
                .AsSplitQuery().SingleAsync(item => item.Id == foodItemId, cancellationToken);
            return new NutritionCommandResult(NutritionCommandStatus.Success, Food: ToFoodView(reloaded));
        }
        catch (ArgumentException exception)
        {
            return Invalid("version", exception.Message);
        }
        catch (DbUpdateConcurrencyException)
        {
            return Conflict("food_version_conflict", "The food was versioned by another request.");
        }
    }

    public async Task<ProviderFoodSearchPage> SearchUsdaAsync(string query, int skip, int take, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(query))
        {
            return new ProviderFoodSearchPage(skip, take, [], "query_required", "Enter a USDA FoodData Central search term.");
        }

        try
        {
            var items = await nutritionDataProvider.SearchAsync(query.Trim(), skip, take, cancellationToken);
            return new ProviderFoodSearchPage(skip, take, items);
        }
        catch (NutritionProviderUnavailableException exception)
        {
            return new ProviderFoodSearchPage(skip, take, [], exception.Code, exception.Message);
        }
    }

    public async Task<NutritionCommandResult> ImportUsdaFoodAsync(ImportUsdaFoodRequest request, CancellationToken cancellationToken)
    {
        var externalId = request.FdcId?.Trim();
        if (string.IsNullOrWhiteSpace(externalId))
        {
            return Invalid("fdcId", "A FoodData Central id is required.");
        }

        var existing = await dbContext.FoodItems.Include(item => item.Versions).ThenInclude(item => item.Allergens)
            .SingleOrDefaultAsync(item => item.Provenance == FoodProvenance.UsdaFdc && item.ExternalId == externalId, cancellationToken);
        if (existing is not null)
        {
            return new NutritionCommandResult(NutritionCommandStatus.Success, Food: ToFoodView(existing));
        }

        try
        {
            var providerFood = await nutritionDataProvider.GetFoodAsync(externalId, cancellationToken);
            if (providerFood is null)
            {
                return NotFound();
            }

            var settings = await GetOrCreateSettingsEntityAsync(cancellationToken);
            var food = FoodItem.Create(tenantContext.TenantId, providerFood.Name, FoodProvenance.UsdaFdc, providerFood.ExternalId, providerFood.DataType);
            food.AddVersion(new FoodVersionInput(
                providerFood.BasisGrams,
                FoodQuantityUnit.Gram,
                providerFood.PreparationBasis,
                providerFood.ProteinGrams,
                providerFood.CarbohydrateGrams,
                providerFood.FatGrams,
                providerFood.FibreGrams,
                providerFood.PolyolGrams,
                providerFood.EthanolGrams,
                providerFood.ProviderCalories,
                settings.EnergyPolicyKey,
                settings.ProviderCalorieTolerance,
                "USDA FoodData Central (CC0 1.0)",
                $"{providerFood.DataType}:{providerFood.RetrievedAtUtc:O}",
                providerFood.DeclaredAllergens));
            dbContext.FoodItems.Add(food);
            await dbContext.SaveChangesAsync(cancellationToken);
            return new NutritionCommandResult(NutritionCommandStatus.Success, Food: ToFoodView(food));
        }
        catch (NutritionProviderUnavailableException exception)
        {
            return new NutritionCommandResult(NutritionCommandStatus.ProviderUnavailable, Code: exception.Code, Message: exception.Message);
        }
        catch (ArgumentException exception)
        {
            return Invalid("providerFood", exception.Message);
        }
        catch (DbUpdateException)
        {
            dbContext.ChangeTracker.Clear();
            var concurrent = await dbContext.FoodItems.AsNoTracking().Include(item => item.Versions).ThenInclude(item => item.Allergens)
                .SingleOrDefaultAsync(item => item.Provenance == FoodProvenance.UsdaFdc && item.ExternalId == externalId, cancellationToken);
            return concurrent is null
                ? Conflict("usda_import_conflict", "The USDA food import conflicted with another request.")
                : new NutritionCommandResult(NutritionCommandStatus.Success, Food: ToFoodView(concurrent));
        }
    }

    public async Task<CookingFactorPage> ListCookingFactorsAsync(int skip, int take, CancellationToken cancellationToken)
    {
        var source = dbContext.CookingFactorRecords.AsNoTracking();
        var total = await source.CountAsync(cancellationToken);
        var items = await source.OrderBy(item => item.Kind).ThenBy(item => item.SourceKey).ThenBy(item => item.SourceVersion)
            .Skip(skip).Take(take).ToArrayAsync(cancellationToken);
        return new CookingFactorPage(total, skip, take, items.Select(ToCookingFactorView).ToArray());
    }

    public async Task<NutritionCommandResult> CreateCookingFactorAsync(CreateCookingFactorRequest request, CancellationToken cancellationToken)
    {
        try
        {
            var factor = new CookingFactor(request.SourceKey, request.SourceVersion, request.FromBasis, request.ToBasis, request.Factor);
            var record = request.Kind switch
            {
                CookingFactorKind.Yield => CookingFactorRecord.CreateYield(tenantContext.TenantId, factor),
                CookingFactorKind.Retention => CookingFactorRecord.CreateRetention(tenantContext.TenantId, factor),
                _ => throw new ArgumentException("A supported cooking factor kind is required."),
            };
            dbContext.CookingFactorRecords.Add(record);
            await dbContext.SaveChangesAsync(cancellationToken);
            return new NutritionCommandResult(NutritionCommandStatus.Success, CookingFactor: ToCookingFactorView(record));
        }
        catch (ArgumentException exception)
        {
            return Invalid("cookingFactor", exception.Message);
        }
    }

    public async Task<RecipePage> ListRecipesAsync(string? query, int skip, int take, CancellationToken cancellationToken)
    {
        var source = dbContext.Recipes.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(query))
        {
            var pattern = $"%{query.Trim()}%";
            source = source.Where(item => EF.Functions.ILike(item.Name, pattern));
        }

        var total = await source.CountAsync(cancellationToken);
        var recipes = await source.OrderBy(item => item.Name).Skip(skip).Take(take)
            .Include(item => item.Versions).ThenInclude(item => item.Allergens)
            .AsSplitQuery().ToListAsync(cancellationToken);
        return new RecipePage(total, skip, take, recipes.Select(ToRecipeSummary).ToArray());
    }

    public async Task<NutritionCommandResult> CreateRecipeAsync(CreateRecipeRequest request, CancellationToken cancellationToken)
    {
        try
        {
            var ingredientInputs = await BuildRecipeIngredientsAsync(request.Ingredients, cancellationToken);
            var recipe = Recipe.Create(tenantContext.TenantId, request.Name);
            var version = recipe.AddDraft(request.Instructions, request.Servings, ingredientInputs);
            dbContext.Recipes.Add(recipe);
            await dbContext.SaveChangesAsync(cancellationToken);
            return new NutritionCommandResult(NutritionCommandStatus.Success, Recipe: ToRecipeSummary(recipe, version));
        }
        catch (NutritionInputException exception)
        {
            return Invalid(exception.Field, exception.Message);
        }
        catch (ArgumentException exception)
        {
            return Invalid("recipe", exception.Message);
        }
    }

    public async Task<NutritionCommandResult> AddRecipeVersionAsync(Guid recipeId, AddRecipeVersionRequest request, CancellationToken cancellationToken)
    {
        var recipe = await dbContext.Recipes.SingleOrDefaultAsync(item => item.Id == recipeId, cancellationToken);
        if (recipe is null)
        {
            return NotFound();
        }

        try
        {
            var ingredientInputs = await BuildRecipeIngredientsAsync(request.Ingredients, cancellationToken);
            var version = recipe.AddDraft(request.Instructions, request.Servings, ingredientInputs);
            dbContext.RecipeVersions.Add(version);
            await dbContext.SaveChangesAsync(cancellationToken);
            return new NutritionCommandResult(NutritionCommandStatus.Success, Recipe: ToRecipeSummary(recipe, version));
        }
        catch (NutritionInputException exception)
        {
            return Invalid(exception.Field, exception.Message);
        }
        catch (ArgumentException exception)
        {
            return Invalid("recipe", exception.Message);
        }
        catch (DbUpdateConcurrencyException)
        {
            return Conflict("recipe_version_conflict", "The recipe was versioned by another request.");
        }
    }

    public async Task<NutritionCommandResult> PublishRecipeVersionAsync(Guid recipeVersionId, CancellationToken cancellationToken)
    {
        var version = await dbContext.RecipeVersions.Include(item => item.Allergens).SingleOrDefaultAsync(item => item.Id == recipeVersionId, cancellationToken);
        if (version is null)
        {
            return NotFound();
        }

        try
        {
            version.Publish(clock.UtcNow, RequireUserId());
            await dbContext.SaveChangesAsync(cancellationToken);
            var recipe = await dbContext.Recipes.AsNoTracking().SingleAsync(item => item.Id == version.RecipeId, cancellationToken);
            return new NutritionCommandResult(NutritionCommandStatus.Success, Recipe: ToRecipeSummary(recipe, version));
        }
        catch (InvalidOperationException exception)
        {
            return Conflict("recipe_publication_conflict", exception.Message);
        }
    }

    public async Task<MealPlanTemplatePage> ListMealPlansAsync(int skip, int take, CancellationToken cancellationToken)
    {
        var total = await dbContext.MealPlanTemplates.CountAsync(cancellationToken);
        var templates = await dbContext.MealPlanTemplates.AsNoTracking().OrderBy(item => item.Name).Skip(skip).Take(take)
            .Include(item => item.Versions).ThenInclude(item => item.Slots)
            .AsSplitQuery().ToListAsync(cancellationToken);
        return new MealPlanTemplatePage(total, skip, take, templates.Select(ToMealPlanSummary).ToArray());
    }

    public async Task<NutritionCommandResult> CreateMealPlanAsync(CreateMealPlanRequest request, CancellationToken cancellationToken)
    {
        try
        {
            var slots = await BuildMealSlotsAsync(request.Slots, cancellationToken);
            var template = MealPlanTemplate.Create(tenantContext.TenantId, request.Name);
            var version = template.AddDraft(request.DayCount, request.TargetCalories, request.TargetProteinGrams, request.TargetCarbohydrateGrams, request.TargetFatGrams, slots);
            dbContext.MealPlanTemplates.Add(template);
            await dbContext.SaveChangesAsync(cancellationToken);
            return new NutritionCommandResult(NutritionCommandStatus.Success, MealPlan: ToMealPlanSummary(template, version));
        }
        catch (NutritionInputException exception)
        {
            return Invalid(exception.Field, exception.Message);
        }
        catch (ArgumentException exception)
        {
            return Invalid("mealPlan", exception.Message);
        }
    }

    public async Task<NutritionCommandResult> AddMealPlanVersionAsync(Guid mealPlanTemplateId, AddMealPlanVersionRequest request, CancellationToken cancellationToken)
    {
        var template = await dbContext.MealPlanTemplates.SingleOrDefaultAsync(item => item.Id == mealPlanTemplateId, cancellationToken);
        if (template is null)
        {
            return NotFound();
        }

        try
        {
            var slots = await BuildMealSlotsAsync(request.Slots, cancellationToken);
            var version = template.AddDraft(request.DayCount, request.TargetCalories, request.TargetProteinGrams, request.TargetCarbohydrateGrams, request.TargetFatGrams, slots);
            dbContext.MealPlanTemplateVersions.Add(version);
            await dbContext.SaveChangesAsync(cancellationToken);
            return new NutritionCommandResult(NutritionCommandStatus.Success, MealPlan: ToMealPlanSummary(template, version));
        }
        catch (NutritionInputException exception)
        {
            return Invalid(exception.Field, exception.Message);
        }
        catch (ArgumentException exception)
        {
            return Invalid("mealPlan", exception.Message);
        }
        catch (DbUpdateConcurrencyException)
        {
            return Conflict("meal_plan_version_conflict", "The meal plan was versioned by another request.");
        }
    }

    public async Task<NutritionCommandResult> PublishMealPlanVersionAsync(Guid mealPlanVersionId, CancellationToken cancellationToken)
    {
        var version = await dbContext.MealPlanTemplateVersions.Include(item => item.Slots).SingleOrDefaultAsync(item => item.Id == mealPlanVersionId, cancellationToken);
        if (version is null)
        {
            return NotFound();
        }

        try
        {
            version.Publish(clock.UtcNow, RequireUserId());
            await dbContext.SaveChangesAsync(cancellationToken);
            var template = await dbContext.MealPlanTemplates.AsNoTracking().SingleAsync(item => item.Id == version.MealPlanTemplateId, cancellationToken);
            return new NutritionCommandResult(NutritionCommandStatus.Success, MealPlan: ToMealPlanSummary(template, version));
        }
        catch (InvalidOperationException exception)
        {
            return Conflict("meal_plan_publication_conflict", exception.Message);
        }
    }

    public async Task<NutritionCommandResult> CalculateTargetsAsync(Guid clientProfileId, CalculateNutritionTargetsRequest request, CancellationToken cancellationToken)
    {
        if (!await ClientExistsAndHasAccessAsync(clientProfileId, cancellationToken))
        {
            return new NutritionCommandResult(NutritionCommandStatus.Forbidden);
        }

        try
        {
            IBmrStrategy bmrStrategy = request.BmrMethodKey switch
            {
                MifflinStJeorBmrStrategy.Key => new MifflinStJeorBmrStrategy(),
                KatchMcArdleBmrStrategy.Key => new KatchMcArdleBmrStrategy(),
                HarrisBenedictRevisedBmrStrategy.Key => new HarrisBenedictRevisedBmrStrategy(),
                _ => throw new ArgumentException("A supported BMR strategy is required."),
            };
            var bmr = bmrStrategy.Estimate(new BmrInput(request.WeightKilograms, request.HeightCentimeters, request.AgeYears, request.Sex, request.BodyFatPercentage));
            var activity = OccupationStepsActivityModel.Calculate(new ActivityModelInput(request.OccupationType, request.AverageDailySteps));
            var tdee = TdeeEstimator.Estimate(bmr, activity);
            var calculatedTarget = tdee.KilocaloriesPerDay + request.CoachGoalAdjustment;
            var calorieTarget = request.CalorieTarget ?? calculatedTarget;
            if (calorieTarget != calculatedTarget)
            {
                return Invalid("calorieTarget", "Calorie target must equal TDEE estimate plus the explicit coach goal adjustment.");
            }

            var macro = MacroTargetCalculator.Calculate(new MacroTargetInput(calorieTarget, request.ProteinGrams, request.FatPercentage, request.WeightKilograms, request.IsEnergyDeficit));
            var settings = await GetOrCreateSettingsEntityAsync(cancellationToken);
            var snapshot = NutritionCalculationSnapshot.Create(
                tenantContext.TenantId,
                clientProfileId,
                bmr,
                activity,
                tdee,
                request.CoachGoalAdjustment,
                macro,
                settings.EnergyPolicyKey,
                settings.EnergyPolicyVersion,
                JsonSerializer.Serialize(request, JsonOptions));
            dbContext.NutritionCalculationSnapshots.Add(snapshot);
            await dbContext.SaveChangesAsync(cancellationToken);
            return new NutritionCommandResult(NutritionCommandStatus.Success, Calculation: ToCalculationView(snapshot, macro.Warnings));
        }
        catch (ArgumentException exception)
        {
            return Invalid("calculation", exception.Message);
        }
    }

    public async Task<NutritionCommandResult> OverrideMacrosAsync(Guid clientProfileId, Guid calculationSnapshotId, CreateMacroOverrideRequest request, CancellationToken cancellationToken)
    {
        if (!await ClientExistsAndHasAccessAsync(clientProfileId, cancellationToken))
        {
            return new NutritionCommandResult(NutritionCommandStatus.Forbidden);
        }

        var calculationExists = await dbContext.NutritionCalculationSnapshots.AsNoTracking()
            .AnyAsync(item => item.Id == calculationSnapshotId && item.ClientProfileId == clientProfileId, cancellationToken);
        if (!calculationExists)
        {
            return NotFound();
        }

        try
        {
            var audit = MacroOverrideAudit.Create(tenantContext.TenantId, calculationSnapshotId, request.ProteinGrams, request.FatGrams, request.CarbohydrateGrams, request.Reason, RequireUserId());
            dbContext.MacroOverrideAudits.Add(audit);
            await dbContext.SaveChangesAsync(cancellationToken);
            return new NutritionCommandResult(NutritionCommandStatus.Success, MacroOverride: ToMacroOverrideView(audit));
        }
        catch (ArgumentException exception)
        {
            return Invalid("macroOverride", exception.Message);
        }
    }

    public async Task<NutritionCommandResult> ReplaceClientAllergensAsync(Guid clientProfileId, ReplaceClientAllergensRequest request, CancellationToken cancellationToken)
    {
        if (!await ClientExistsAndHasAccessAsync(clientProfileId, cancellationToken))
        {
            return new NutritionCommandResult(NutritionCommandStatus.Forbidden);
        }

        if (request.Codes.Any(code => !Enum.IsDefined(code)))
        {
            return Invalid("codes", "Allergens must use supported structured codes.");
        }

        var requested = request.Codes.Distinct().ToHashSet();
        var existing = await dbContext.ClientDeclaredAllergens.Where(item => item.ClientProfileId == clientProfileId && item.IsActive).ToListAsync(cancellationToken);
        var actor = RequireUserId();
        foreach (var item in existing.Where(item => !requested.Contains(item.Code)))
        {
            item.Deactivate(actor, clock.UtcNow);
        }

        var activeCodes = existing.Select(item => item.Code).ToHashSet();
        foreach (var code in requested.Where(code => !activeCodes.Contains(code)))
        {
            dbContext.ClientDeclaredAllergens.Add(ClientDeclaredAllergen.Create(tenantContext.TenantId, clientProfileId, code, actor));
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        return new NutritionCommandResult(NutritionCommandStatus.Success);
    }

    public async Task<ClientNutritionPlanSummary[]?> ListClientPlansAsync(Guid clientProfileId, CancellationToken cancellationToken)
    {
        if (!await ClientExistsAndHasAccessAsync(clientProfileId, cancellationToken))
        {
            return null;
        }

        return await (from plan in dbContext.ClientNutritionPlans.AsNoTracking()
                      join calculation in dbContext.NutritionCalculationSnapshots.AsNoTracking()
                          on new { plan.TenantId, Id = plan.NutritionCalculationSnapshotId } equals new { calculation.TenantId, calculation.Id }
                      where plan.ClientProfileId == clientProfileId
                      orderby plan.StartDate descending
                      select new ClientNutritionPlanSummary(plan.Id, plan.SourceMealPlanTemplateVersionId, plan.EnrollmentId, plan.StartDate, plan.EndDateExclusive, calculation.CalorieTarget, plan.Status, plan.Version))
            .ToArrayAsync(cancellationToken);
    }

    public async Task<NutritionCommandResult> AssignPlanAsync(Guid clientProfileId, AssignNutritionPlanRequest request, CancellationToken cancellationToken)
    {
        if (!await ClientExistsAndHasAccessAsync(clientProfileId, cancellationToken))
        {
            return new NutritionCommandResult(NutritionCommandStatus.Forbidden);
        }

        var template = await dbContext.MealPlanTemplateVersions.AsNoTracking()
            .Include(item => item.Slots).ThenInclude(item => item.Choices)
            .AsSplitQuery().SingleOrDefaultAsync(item => item.Id == request.MealPlanTemplateVersionId, cancellationToken);
        var calculation = await dbContext.NutritionCalculationSnapshots.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == request.CalculationSnapshotId && item.ClientProfileId == clientProfileId, cancellationToken);
        if (template is null || calculation is null)
        {
            return NotFound();
        }

        if (template.Status != PublicationStatus.Published)
        {
            return Invalid("mealPlanTemplateVersionId", "Only a published meal-plan version can be assigned.");
        }

        var endDate = request.StartDate.AddDays(template.DayCount);
        var coverage = await EvaluateCoverageAsync(clientProfileId, request.EnrollmentId, request.StartDate, endDate, cancellationToken);
        if (!coverage.Found)
        {
            return NotFound();
        }

        if (!coverage.Decision.IsAuthorized)
        {
            return Invalid("enrollmentId", coverage.Decision.Reason ?? "The nutrition entitlement does not cover this plan.");
        }

        var recipeVersionIds = template.Slots.SelectMany(item => item.Choices).Select(item => item.RecipeVersionId).Distinct().ToArray();
        var recipeAllergens = await dbContext.RecipeVersionAllergens.AsNoTracking().Where(item => recipeVersionIds.Contains(item.RecipeVersionId)).ToListAsync(cancellationToken);
        var clientAllergens = await dbContext.ClientDeclaredAllergens.AsNoTracking().Where(item => item.ClientProfileId == clientProfileId && item.IsActive).Select(item => item.Code).ToArrayAsync(cancellationToken);
        var conflicts = recipeAllergens.Where(item => clientAllergens.Contains(item.Code)).GroupBy(item => item.RecipeVersionId).ToArray();
        if (conflicts.Length > 0 && !request.AcknowledgeAllergenWarnings)
        {
            return Conflict("allergen_review_required", "One or more declared recipe allergens conflict with the client's structured declarations. Review and explicitly acknowledge the warning. TB Gym does not assert any recipe is safe.");
        }

        var slotInputs = template.Slots.Select(slot => new MealSlotInput(
            slot.DayOffset,
            slot.Order,
            slot.Name,
            slot.Choices.Select(choice => new MealChoiceInput(choice.RecipeVersionId, choice.RecipeName, choice.Servings, choice.Calories, choice.ProteinGrams, choice.CarbohydrateGrams, choice.FatGrams)).ToArray())).ToArray();
        try
        {
            var plan = ClientNutritionPlan.Assign(tenantContext.TenantId, clientProfileId, request.EnrollmentId, template.Id, calculation.Id, request.StartDate, endDate, slotInputs, coverage.Authorization!);
            dbContext.ClientNutritionPlans.Add(plan);
            dbContext.NutritionPlanLifecycleEvents.Add(NutritionPlanLifecycleEvent.Record(
                tenantContext.TenantId,
                plan.Id,
                NutritionPlanLifecycleEventType.Assigned,
                null,
                plan.Status,
                "Nutrition plan assigned.",
                RequireUserId(),
                clock.UtcNow));
            foreach (var conflict in conflicts)
            {
                var warning = AllergenRegimes.EvaluateConflict(clientAllergens, conflict.Select(item => item.Code));
                dbContext.AllergenConflictRecords.Add(AllergenConflictRecord.Create(tenantContext.TenantId, clientProfileId, conflict.Key, plan.Id, warning.ConflictingCodes, warning.Message, RequireUserId()));
            }

            await dbContext.SaveChangesAsync(cancellationToken);
            return new NutritionCommandResult(NutritionCommandStatus.Success, ClientPlan: new ClientNutritionPlanSummary(plan.Id, plan.SourceMealPlanTemplateVersionId, plan.EnrollmentId, plan.StartDate, plan.EndDateExclusive, calculation.CalorieTarget, plan.Status, plan.Version));
        }
        catch (ArgumentException exception)
        {
            return Invalid("plan", exception.Message);
        }
        catch (DbUpdateException)
        {
            return Conflict("nutrition_plan_conflict", "The plan conflicts with current nutrition state.");
        }
    }

    public async Task<NutritionCommandResult> CancelPlanAsync(
        Guid clientProfileId,
        Guid planId,
        CancelNutritionPlanRequest request,
        CancellationToken cancellationToken)
    {
        if (!await ClientExistsAndHasAccessAsync(clientProfileId, cancellationToken))
        {
            return new NutritionCommandResult(NutritionCommandStatus.Forbidden);
        }

        if (string.IsNullOrWhiteSpace(request.Reason))
        {
            return Invalid("reason", "A cancellation reason is required so the change stays auditable.");
        }

        var plan = await dbContext.ClientNutritionPlans.SingleOrDefaultAsync(
            item => item.Id == planId && item.ClientProfileId == clientProfileId,
            cancellationToken);
        if (plan is null)
        {
            return NotFound();
        }

        var calorieTarget = await dbContext.NutritionCalculationSnapshots.AsNoTracking()
            .Where(item => item.Id == plan.NutritionCalculationSnapshotId)
            .Select(item => item.CalorieTarget)
            .SingleAsync(cancellationToken);
        var previousStatus = plan.Status;
        dbContext.Entry(plan).Property(item => item.Version).OriginalValue = request.Version;
        try
        {
            plan.Cancel();
            dbContext.NutritionPlanLifecycleEvents.Add(NutritionPlanLifecycleEvent.Record(
                tenantContext.TenantId,
                plan.Id,
                NutritionPlanLifecycleEventType.Cancelled,
                previousStatus,
                plan.Status,
                request.Reason,
                RequireUserId(),
                clock.UtcNow));
            await dbContext.SaveChangesAsync(cancellationToken);
            return new NutritionCommandResult(
                NutritionCommandStatus.Success,
                ClientPlan: new ClientNutritionPlanSummary(plan.Id, plan.SourceMealPlanTemplateVersionId, plan.EnrollmentId, plan.StartDate, plan.EndDateExclusive, calorieTarget, plan.Status, plan.Version));
        }
        catch (ArgumentException exception)
        {
            return Invalid("reason", exception.Message);
        }
        catch (InvalidOperationException exception)
        {
            return Conflict("nutrition_plan_already_cancelled", exception.Message);
        }
        catch (DbUpdateConcurrencyException)
        {
            return Conflict("nutrition_plan_conflict", "The nutrition plan changed before it was cancelled.");
        }
    }

    public async Task<ClientNutritionDayView?> GetOwnDayAsync(DateOnly? localDate, CancellationToken cancellationToken)
    {
        var client = await FindSelfClientAsync(cancellationToken);
        if (client is null || !(await GetNutritionAccessAsync(client.Id, cancellationToken)).IsAllowed)
        {
            return null;
        }

        var targetDate = localDate ?? await GetTenantTodayAsync(cancellationToken);
        var row = await (from day in dbContext.ClientNutritionPlanDays.AsNoTracking()
                         join plan in dbContext.ClientNutritionPlans.AsNoTracking()
                             on new { day.TenantId, Id = day.ClientNutritionPlanId } equals new { plan.TenantId, plan.Id }
                         join calculation in dbContext.NutritionCalculationSnapshots.AsNoTracking()
                             on new { plan.TenantId, Id = plan.NutritionCalculationSnapshotId } equals new { calculation.TenantId, calculation.Id }
                         where plan.ClientProfileId == client.Id && plan.Status == ClientNutritionPlanStatus.Active && day.Date == targetDate
                         select new DayQueryRow(plan.Id, day.Id, day.Date, calculation.CalorieTarget, calculation.ProteinGrams, calculation.CarbohydrateGrams, calculation.FatGrams))
            .SingleOrDefaultAsync(cancellationToken);
        if (row is null)
        {
            return null;
        }

        var slots = await dbContext.ClientNutritionPlanSlots.AsNoTracking().Where(item => item.ClientNutritionPlanDayId == row.DayId)
            .Include(item => item.Choices).OrderBy(item => item.Order).AsSplitQuery().ToListAsync(cancellationToken);
        var log = await dbContext.DailyNutritionLogs.AsNoTracking().Where(item => item.ClientNutritionPlanDayId == row.DayId)
            .Include(item => item.Entries).SingleOrDefaultAsync(cancellationToken);
        return ToDayView(row, slots, log);
    }

    public async Task<NutritionCommandResult> RecordOwnChoiceAsync(RecordNutritionChoiceRequest request, CancellationToken cancellationToken)
    {
        var client = await FindSelfClientAsync(cancellationToken);
        if (client is null || !(await GetNutritionAccessAsync(client.Id, cancellationToken)).IsAllowed)
        {
            return new NutritionCommandResult(NutritionCommandStatus.Forbidden);
        }

        var day = await dbContext.ClientNutritionPlanDays.AsNoTracking().SingleOrDefaultAsync(item => item.Id == request.PlanDayId, cancellationToken);
        if (day is null)
        {
            return NotFound();
        }

        var ownsDay = await dbContext.ClientNutritionPlans.AsNoTracking().AnyAsync(item => item.Id == day.ClientNutritionPlanId && item.ClientProfileId == client.Id && item.Status == ClientNutritionPlanStatus.Active, cancellationToken);
        // The slot must belong to this day, not merely to the same tenant: without this a client
        // could log against another client's slot/choice ids and read back their contents.
        var ownsSlot = await dbContext.ClientNutritionPlanSlots.AsNoTracking().AnyAsync(item => item.Id == request.PlanSlotId && item.ClientNutritionPlanDayId == day.Id, cancellationToken);
        var choice = await dbContext.ClientNutritionPlanChoices.AsNoTracking().SingleOrDefaultAsync(item => item.Id == request.ChoiceId && item.ClientNutritionPlanSlotId == request.PlanSlotId, cancellationToken);
        if (!ownsDay || !ownsSlot || choice is null || request.ActualServings <= 0m)
        {
            return Invalid("choice", "The selected choice is not available to this client/day or servings are invalid.");
        }

        var log = await dbContext.DailyNutritionLogs.Include(item => item.Entries).SingleOrDefaultAsync(item => item.ClientNutritionPlanDayId == day.Id, cancellationToken);
        if (log is null)
        {
            if (request.DailyLogVersion is not null)
            {
                return Conflict("nutrition_log_conflict", "The nutrition log changed before this choice was saved.");
            }

            log = DailyNutritionLog.Start(tenantContext.TenantId, client.Id, day.ClientNutritionPlanId, day.Id, day.Date);
            dbContext.DailyNutritionLogs.Add(log);
        }
        else if (request.DailyLogVersion is null)
        {
            return Conflict("nutrition_log_version_required", "Refresh the nutrition log before changing a saved choice.");
        }
        else
        {
            dbContext.Entry(log).Property(item => item.Version).OriginalValue = request.DailyLogVersion.Value;
        }

        try
        {
            var multiplier = request.ActualServings / choice.Servings;
            log.Record(request.PlanSlotId, choice.Id, choice.RecipeName, request.ActualServings, choice.Calories * multiplier, choice.ProteinGrams * multiplier, choice.CarbohydrateGrams * multiplier, choice.FatGrams * multiplier);
            await dbContext.SaveChangesAsync(cancellationToken);
            var row = await LoadDayRowAsync(day.Id, cancellationToken);
            var slots = await dbContext.ClientNutritionPlanSlots.AsNoTracking().Where(item => item.ClientNutritionPlanDayId == day.Id).Include(item => item.Choices).OrderBy(item => item.Order).AsSplitQuery().ToListAsync(cancellationToken);
            return new NutritionCommandResult(NutritionCommandStatus.Success, Day: ToDayView(row!, slots, log));
        }
        catch (InvalidOperationException exception)
        {
            return Conflict("nutrition_log_completed", exception.Message);
        }
        catch (DbUpdateConcurrencyException)
        {
            return Conflict("nutrition_log_conflict", "The nutrition log changed while this choice was being saved.");
        }
    }

    public async Task<NutritionCommandResult> CompleteOwnLogAsync(Guid dailyLogId, CompleteNutritionLogRequest request, CancellationToken cancellationToken)
    {
        var client = await FindSelfClientAsync(cancellationToken);
        if (client is null || !(await GetNutritionAccessAsync(client.Id, cancellationToken)).IsAllowed)
        {
            return new NutritionCommandResult(NutritionCommandStatus.Forbidden);
        }

        var log = await dbContext.DailyNutritionLogs.Include(item => item.Entries).SingleOrDefaultAsync(item => item.Id == dailyLogId && item.ClientProfileId == client.Id, cancellationToken);
        if (log is null)
        {
            return NotFound();
        }

        try
        {
            dbContext.Entry(log).Property(item => item.Version).OriginalValue = request.Version;
            log.Complete(clock.UtcNow);
            await dbContext.SaveChangesAsync(cancellationToken);
            var row = await LoadDayRowAsync(log.ClientNutritionPlanDayId, cancellationToken);
            var slots = await dbContext.ClientNutritionPlanSlots.AsNoTracking().Where(item => item.ClientNutritionPlanDayId == log.ClientNutritionPlanDayId).Include(item => item.Choices).OrderBy(item => item.Order).AsSplitQuery().ToListAsync(cancellationToken);
            return new NutritionCommandResult(NutritionCommandStatus.Success, Day: ToDayView(row!, slots, log));
        }
        catch (InvalidOperationException exception)
        {
            return Conflict("nutrition_log_completion_conflict", exception.Message);
        }
        catch (DbUpdateConcurrencyException)
        {
            return Conflict("nutrition_log_conflict", "The nutrition log changed while it was being completed.");
        }
    }

    public async Task<NutritionCommandResult> GenerateAiDraftAsync(GenerateAiMealDraftRequest request, CancellationToken cancellationToken)
    {
        var settings = await GetOrCreateSettingsEntityAsync(cancellationToken);
        var usage = await GetCurrentAiUsageAsync(cancellationToken);
        if (settings.AiMonthlyRequestLimit == 0 || usage.Count >= settings.AiMonthlyRequestLimit || usage.Cost >= settings.AiMonthlyCostLimit)
        {
            return Conflict("ai_usage_limit", "This workspace's configured AI meal-draft usage or cost limit has been reached.");
        }

        AiMealDraftOperation operation;
        try
        {
            operation = AiMealDraftOperation.Start(tenantContext.TenantId, request.PromptVersion, AiSchemaVersion, aiMealDraftProvider.ProviderKey);
            dbContext.AiMealDraftOperations.Add(operation);
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (ArgumentException exception)
        {
            return Invalid("aiDraft", exception.Message);
        }

        AiMealDraftProviderResult providerResult;
        try
        {
            providerResult = await aiMealDraftProvider.GenerateAsync(new AiMealDraftProviderRequest(request.Prompt, request.PromptVersion, AiSchemaVersion, request.Culture), cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            operation.Fail("provider_failure");
            await dbContext.SaveChangesAsync(cancellationToken);
            return new NutritionCommandResult(NutritionCommandStatus.ProviderUnavailable, AiDraft: ToAiDraftView(operation), Code: "ai_provider_failure", Message: "The AI provider failed. The operation was recorded and no recipe was created.");
        }

        if (!providerResult.IsSuccess)
        {
            operation.Fail(providerResult.FailureCode ?? "provider_failure");
            await dbContext.SaveChangesAsync(cancellationToken);
            return new NutritionCommandResult(NutritionCommandStatus.ProviderUnavailable, AiDraft: ToAiDraftView(operation), Code: providerResult.FailureCode, Message: "The AI provider did not produce a meal draft. The failure was recorded.");
        }

        if (!string.Equals(providerResult.CostCurrency, settings.AiCostCurrency, StringComparison.OrdinalIgnoreCase) || usage.Cost + providerResult.CostAmount > settings.AiMonthlyCostLimit)
        {
            operation.Fail("cost_limit");
            await dbContext.SaveChangesAsync(cancellationToken);
            return Conflict("ai_cost_limit", "The provider result would exceed the workspace AI cost policy; no draft was accepted.");
        }

        if (!TryValidateAiSchema(providerResult.RawOutput, out var validatedJson, out var uncertainJson))
        {
            operation.Fail("schema_invalid");
            await dbContext.SaveChangesAsync(cancellationToken);
            return Invalid("aiDraft", "The AI response failed the enforced meal-draft schema and was not persisted as a draft or nutrition fact.");
        }

        operation.AcceptValidatedDraft(providerResult.Model, providerResult.ModelVersion, validatedJson!, uncertainJson!, providerResult.CostAmount, providerResult.CostCurrency);
        await dbContext.SaveChangesAsync(cancellationToken);
        return new NutritionCommandResult(NutritionCommandStatus.Success, AiDraft: ToAiDraftView(operation));
    }

    public async Task<NutritionCommandResult> ReviewAiDraftAsync(Guid operationId, ReviewAiMealDraftRequest request, CancellationToken cancellationToken)
    {
        var operation = await dbContext.AiMealDraftOperations.SingleOrDefaultAsync(item => item.Id == operationId, cancellationToken);
        if (operation is null)
        {
            return NotFound();
        }

        if (!request.Approved)
        {
            try
            {
                operation.Review(false, RequireUserId(), clock.UtcNow);
                await dbContext.SaveChangesAsync(cancellationToken);
                return new NutritionCommandResult(NutritionCommandStatus.Success, AiDraft: ToAiDraftView(operation));
            }
            catch (InvalidOperationException exception)
            {
                return Conflict("ai_review_conflict", exception.Message);
            }
        }

        if (operation.Status != AiDraftStatus.AwaitingCoachReview || operation.ValidatedDraftJson is null || string.IsNullOrWhiteSpace(request.RecipeName) || string.IsNullOrWhiteSpace(request.Instructions) || request.Servings is null)
        {
            return Invalid("review", "Approval requires an awaiting-review draft plus coach-confirmed recipe name, instructions, servings, and ingredient mappings.");
        }

        var expectedIngredientCount = JsonSerializer.Deserialize<ValidatedAiDraft>(operation.ValidatedDraftJson, JsonOptions)?.Ingredients.Count ?? 0;
        if (expectedIngredientCount == 0 || request.IngredientMappings.Count != expectedIngredientCount)
        {
            return Invalid("ingredientMappings", "Map every AI-suggested ingredient to one reviewed canonical food version before approval.");
        }

        try
        {
            var ingredientRequests = request.IngredientMappings.Select(item => new RecipeIngredientRequest(item.FoodItemVersionId, item.Quantity, item.Unit, item.Basis, item.YieldFactorId, item.RetentionFactorId)).ToArray();
            var inputs = await BuildRecipeIngredientsAsync(ingredientRequests, cancellationToken);
            var recipe = Recipe.Create(tenantContext.TenantId, request.RecipeName);
            var version = recipe.AddDraft(request.Instructions, request.Servings.Value, inputs);
            dbContext.Recipes.Add(recipe);
            operation.Review(true, RequireUserId(), clock.UtcNow);
            await dbContext.SaveChangesAsync(cancellationToken);
            return new NutritionCommandResult(NutritionCommandStatus.Success, AiDraft: ToAiDraftView(operation, version.Id));
        }
        catch (NutritionInputException exception)
        {
            return Invalid(exception.Field, exception.Message);
        }
        catch (ArgumentException exception)
        {
            return Invalid("review", exception.Message);
        }
    }

    private async Task<RecipeIngredientInput[]> BuildRecipeIngredientsAsync(IReadOnlyList<RecipeIngredientRequest> requests, CancellationToken cancellationToken)
    {
        if (requests.Count == 0)
        {
            throw new NutritionInputException("ingredients", "At least one ingredient is required.");
        }

        var ids = requests.Select(item => item.FoodItemVersionId).Distinct().ToArray();
        var versions = await dbContext.FoodItemVersions.AsNoTracking().Where(item => ids.Contains(item.Id)).Include(item => item.Allergens).ToDictionaryAsync(item => item.Id, cancellationToken);
        var foods = await dbContext.FoodItems.AsNoTracking().Where(item => versions.Values.Select(version => version.FoodItemId).Contains(item.Id)).ToDictionaryAsync(item => item.Id, cancellationToken);
        var factorIds = requests.SelectMany(item => new[] { item.YieldFactorId, item.RetentionFactorId }).Where(item => item.HasValue).Select(item => item!.Value).Distinct().ToArray();
        var factors = await dbContext.CookingFactorRecords.AsNoTracking().Where(item => factorIds.Contains(item.Id)).ToDictionaryAsync(item => item.Id, cancellationToken);
        var settings = await GetOrCreateSettingsEntityAsync(cancellationToken);
        IEnergyFactorPolicy energyPolicy = settings.EnergyPolicyKey == Eu1169EnergyPolicy.Key ? new Eu1169EnergyPolicy() : new AtwaterEnergyPolicy();
        var results = new List<RecipeIngredientInput>(requests.Count);
        foreach (var request in requests)
        {
            if (!versions.TryGetValue(request.FoodItemVersionId, out var version) || !foods.TryGetValue(version.FoodItemId, out var food))
            {
                throw new NutritionInputException("ingredients", "An ingredient food version was not found in this workspace.");
            }

            if (request.Unit != version.BasisUnit)
            {
                throw new NutritionInputException("ingredients", "Ingredient unit must match the canonical food basis unit; implicit unit conversion is not supported.");
            }

            var source = new NutrientQuantity(version.BasisQuantity, version.PreparationBasis, new EnergyNutrients(version.ProteinGrams, version.CarbohydrateGrams, version.FatGrams, PolyolGrams: version.PolyolGrams, EthanolGrams: version.EthanolGrams, FibreGrams: version.FibreGrams));
            CookingFactor? yield = null;
            CookingFactor? retention = null;
            if (request.YieldFactorId is { } yieldId && factors.TryGetValue(yieldId, out var yieldRecord))
            {
                yield = new CookingFactor(yieldRecord.SourceKey, yieldRecord.SourceVersion, yieldRecord.FromBasis, yieldRecord.ToBasis, yieldRecord.Factor);
            }

            if (request.RetentionFactorId is { } retentionId && factors.TryGetValue(retentionId, out var retentionRecord))
            {
                retention = new CookingFactor(retentionRecord.SourceKey, retentionRecord.SourceVersion, retentionRecord.FromBasis, retentionRecord.ToBasis, retentionRecord.Factor);
            }

            var resolved = PreparationBasisCalculator.Resolve(source, request.Quantity, request.Basis, yield, retention);
            var energy = energyPolicy.Calculate(resolved.Nutrients).Kilocalories;
            results.Add(new RecipeIngredientInput(version.Id, food.Name, request.Quantity, request.Unit, request.Basis, resolved.Nutrients.ProteinGrams, resolved.Nutrients.CarbohydrateGrams, resolved.Nutrients.FatGrams, energy, BuildProvenance(food, version), version.Allergens.Select(item => item.Code).ToArray(), request.YieldFactorId, request.RetentionFactorId));
        }

        return results.ToArray();
    }

    private async Task<MealSlotInput[]> BuildMealSlotsAsync(IReadOnlyList<MealPlanSlotRequest> requests, CancellationToken cancellationToken)
    {
        var versionIds = requests.SelectMany(item => item.Choices).Select(item => item.RecipeVersionId).Distinct().ToArray();
        var versions = await dbContext.RecipeVersions.AsNoTracking().Where(item => versionIds.Contains(item.Id) && item.Status == PublicationStatus.Published).ToDictionaryAsync(item => item.Id, cancellationToken);
        var recipeIds = versions.Values.Select(item => item.RecipeId).Distinct().ToArray();
        var names = await dbContext.Recipes.AsNoTracking().Where(item => recipeIds.Contains(item.Id)).ToDictionaryAsync(item => item.Id, item => item.Name, cancellationToken);
        return requests.Select(slot => new MealSlotInput(slot.DayOffset, slot.Order, slot.Name, slot.Choices.Select(choice =>
        {
            if (!versions.TryGetValue(choice.RecipeVersionId, out var version))
            {
                throw new NutritionInputException("choices", "Every meal choice must reference a published recipe version in this workspace.");
            }

            if (choice.Servings <= 0m)
            {
                throw new NutritionInputException("choices", "Meal-choice servings must be positive.");
            }

            var multiplier = choice.Servings / version.Servings;
            return new MealChoiceInput(version.Id, names[version.RecipeId], choice.Servings, version.Calories * multiplier, version.ProteinGrams * multiplier, version.CarbohydrateGrams * multiplier, version.FatGrams * multiplier);
        }).ToArray())).ToArray();
    }

    private async Task<NutritionWorkspaceSettings> GetOrCreateSettingsEntityAsync(CancellationToken cancellationToken)
    {
        var settings = await dbContext.NutritionWorkspaceSettings.SingleOrDefaultAsync(cancellationToken);
        if (settings is not null)
        {
            return settings;
        }

        settings = NutritionWorkspaceSettings.CreateDefault(tenantContext.TenantId);
        dbContext.NutritionWorkspaceSettings.Add(settings);
        return settings;
    }

    private async Task<bool> ClientExistsAndHasAccessAsync(Guid clientProfileId, CancellationToken cancellationToken)
    {
        if (!await dbContext.ClientProfiles.AsNoTracking().AnyAsync(item => item.Id == clientProfileId, cancellationToken))
        {
            return false;
        }

        return (await GetNutritionAccessAsync(clientProfileId, cancellationToken)).IsAllowed;
    }

    private Task<FeatureAccessDecision> GetNutritionAccessAsync(Guid clientProfileId, CancellationToken cancellationToken) =>
        featureAccessService.EvaluateAsync(tenantContext.TenantId, clientProfileId, CoachingFeature.Nutrition, cancellationToken);

    private async Task<ClientProfile?> FindSelfClientAsync(CancellationToken cancellationToken) =>
        currentUser.UserId is not { } userId ? null : await dbContext.ClientProfiles.SingleOrDefaultAsync(item => item.UserId == userId, cancellationToken);

    private async Task<CoverageLookup> EvaluateCoverageAsync(Guid clientProfileId, Guid enrollmentId, DateOnly startDate, DateOnly endDateExclusive, CancellationToken cancellationToken)
    {
        var enrollment = await dbContext.ClientEnrollments.AsNoTracking().Where(item => item.Id == enrollmentId && item.ClientProfileId == clientProfileId)
            .Select(item => new
            {
                item.Id,
                item.ClientProfileId,
                item.StartDate,
                item.EndDateExclusive,
                item.Status,
                IncludesNutrition = item.Entitlements.Any(entitlement => entitlement.Feature == CoachingFeature.Nutrition),
            }).SingleOrDefaultAsync(cancellationToken);
        if (enrollment is null)
        {
            return new CoverageLookup(false, new NutritionCoverageDecision(false, "The enrollment was not found."), null);
        }

        var authorization = new NutritionCoverageAuthorization(enrollment.Id, enrollment.ClientProfileId, enrollment.StartDate, enrollment.EndDateExclusive, enrollment.IncludesNutrition, enrollment.Status is EnrollmentStatus.Cancelled or EnrollmentStatus.Expired);
        return new CoverageLookup(true, NutritionCoveragePolicy.Evaluate(clientProfileId, startDate, endDateExclusive, authorization), authorization);
    }

    private async Task<DateOnly> GetTenantTodayAsync(CancellationToken cancellationToken)
    {
        var timeZone = await dbContext.Tenants.AsNoTracking().Where(item => item.Id == tenantContext.TenantId).Select(item => item.TimeZoneId).SingleAsync(cancellationToken);
        return DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.UtcNow, TimeZoneInfo.FindSystemTimeZoneById(timeZone)).DateTime);
    }

    private async Task<(int Count, decimal Cost)> GetCurrentAiUsageAsync(CancellationToken cancellationToken)
    {
        var tenant = await dbContext.Tenants.AsNoTracking().Where(item => item.Id == tenantContext.TenantId).Select(item => item.TimeZoneId).SingleAsync(cancellationToken);
        var zone = TimeZoneInfo.FindSystemTimeZoneById(tenant);
        var local = TimeZoneInfo.ConvertTime(clock.UtcNow, zone);
        var monthStartLocal = new DateTime(local.Year, local.Month, 1, 0, 0, 0, DateTimeKind.Unspecified);
        var monthEndLocal = monthStartLocal.AddMonths(1);
        var startUtc = new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(monthStartLocal, zone));
        var endUtc = new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(monthEndLocal, zone));
        var rows = await dbContext.AiMealDraftOperations.AsNoTracking().Where(item => item.CreatedAtUtc >= startUtc && item.CreatedAtUtc < endUtc).Select(item => item.CostAmount).ToArrayAsync(cancellationToken);
        return (rows.Length, rows.Sum());
    }

    private async Task<DayQueryRow?> LoadDayRowAsync(Guid dayId, CancellationToken cancellationToken) =>
        await (from day in dbContext.ClientNutritionPlanDays.AsNoTracking()
               join plan in dbContext.ClientNutritionPlans.AsNoTracking() on new { day.TenantId, Id = day.ClientNutritionPlanId } equals new { plan.TenantId, plan.Id }
               join calculation in dbContext.NutritionCalculationSnapshots.AsNoTracking() on new { plan.TenantId, Id = plan.NutritionCalculationSnapshotId } equals new { calculation.TenantId, calculation.Id }
               where day.Id == dayId
               select new DayQueryRow(plan.Id, day.Id, day.Date, calculation.CalorieTarget, calculation.ProteinGrams, calculation.CarbohydrateGrams, calculation.FatGrams)).SingleOrDefaultAsync(cancellationToken);

    private static ClientNutritionDayView ToDayView(DayQueryRow row, IReadOnlyList<ClientNutritionPlanSlot> slots, DailyNutritionLog? log)
    {
        var entries = log?.Entries.ToDictionary(item => item.ClientNutritionPlanSlotId) ?? new Dictionary<Guid, DailyNutritionLogEntry>();
        return new ClientNutritionDayView(
            row.PlanId,
            row.DayId,
            row.Date,
            row.TargetCalories,
            row.TargetProtein,
            row.TargetCarbohydrate,
            row.TargetFat,
            log?.Id,
            log?.Version,
            log?.Status,
            log?.SelectedCalories ?? 0m,
            log?.SelectedProteinGrams ?? 0m,
            log?.SelectedCarbohydrateGrams ?? 0m,
            log?.SelectedFatGrams ?? 0m,
            slots.Select(slot =>
            {
                entries.TryGetValue(slot.Id, out var entry);
                return new NutritionSlotView(slot.Id, slot.Name, slot.Order, slot.Choices.Select(choice => new NutritionChoiceView(choice.Id, choice.RecipeName, choice.Servings, choice.Calories, choice.ProteinGrams, choice.CarbohydrateGrams, choice.FatGrams)).ToArray(), entry?.SelectedClientNutritionPlanChoiceId, entry?.Servings);
            }).ToArray(),
            "Allergen declarations may be incomplete. Absence of a declared conflict is not evidence of absence; TB Gym does not assert any meal is safe.");
    }

    private static FoodVersionInput ToFoodVersionInput(AddFoodVersionRequest request, NutritionWorkspaceSettings settings) =>
        new(request.BasisQuantity, request.BasisUnit, request.PreparationBasis, request.ProteinGrams, request.CarbohydrateGrams, request.FatGrams, request.FibreGrams, request.PolyolGrams, request.EthanolGrams, request.ProviderCalories, settings.EnergyPolicyKey, settings.ProviderCalorieTolerance, request.SourceAttribution, request.SourceRecordVersion, request.DeclaredAllergens);

    private static NutritionWorkspaceSettingsView ToSettingsView(NutritionWorkspaceSettings settings) =>
        new(settings.EnergyPolicyKey, settings.EnergyPolicyVersion, settings.ProviderCalorieTolerance, settings.AiMonthlyRequestLimit, settings.AiMonthlyCostLimit, settings.AiCostCurrency, settings.Version);

    private static FoodItemView ToFoodView(FoodItem item)
    {
        var version = item.Versions.OrderByDescending(candidate => candidate.Revision).First();
        return new FoodItemView(item.Id, item.Name, item.Provenance, item.ExternalId, item.ExternalDataType, item.CurrentRevision, ToFoodVersionView(version));
    }

    private static FoodVersionView ToFoodVersionView(FoodItemVersion item) =>
        new(item.Id, item.Revision, item.BasisQuantity, item.BasisUnit, item.PreparationBasis, item.ComputedCalories, item.ProviderCalories, item.HasCalorieDiscrepancy, item.ProteinGrams, item.CarbohydrateGrams, item.FatGrams, item.FibreGrams, item.PolyolGrams, item.EthanolGrams, item.EnergyPolicyKey, item.EnergyPolicyVersion, item.SourceAttribution, item.SourceRecordVersion, item.Allergens.Select(allergen => allergen.Code).Order().ToArray());

    private static CookingFactorView ToCookingFactorView(CookingFactorRecord item) =>
        new(item.Id, Enum.Parse<CookingFactorKind>(item.Kind), item.SourceKey, item.SourceVersion, item.FromBasis, item.ToBasis, item.Factor);

    private static MacroOverrideView ToMacroOverrideView(MacroOverrideAudit item) =>
        new(item.Id, item.CalculationSnapshotId, item.ProteinGrams, item.FatGrams, item.CarbohydrateGrams, item.Reason, item.ActorUserId);

    private static RecipeSummary ToRecipeSummary(Recipe item) => ToRecipeSummary(item, item.Versions.OrderByDescending(version => version.Revision).First());

    private static RecipeSummary ToRecipeSummary(Recipe item, RecipeVersion version) =>
        new(item.Id, version.Id, version.Revision, item.Name, version.Status, version.Servings, version.Calories, version.ProteinGrams, version.CarbohydrateGrams, version.FatGrams, version.Allergens.Select(allergen => allergen.Code).Order().ToArray());

    private static MealPlanTemplateSummary ToMealPlanSummary(MealPlanTemplate item) => ToMealPlanSummary(item, item.Versions.OrderByDescending(version => version.Revision).First());

    private static MealPlanTemplateSummary ToMealPlanSummary(MealPlanTemplate item, MealPlanTemplateVersion version) =>
        new(item.Id, version.Id, version.Revision, item.Name, version.DayCount, version.Status, version.TargetCalories, version.Slots.Count);

    private static NutritionCalculationView ToCalculationView(NutritionCalculationSnapshot item, IReadOnlyList<string> warnings) =>
        new(item.Id, item.BmrMethodKey, item.BmrMethodVersion, item.BmrEstimate, item.ActivityModelKey, item.ActivityModelVersion, item.ActivityModelPal, item.TdeeMethodKey, item.TdeeMethodVersion, item.TdeeEstimate, item.CoachGoalAdjustment, item.CalorieTarget, item.ProteinGrams, item.CarbohydrateGrams, item.FatGrams, item.EnergyPolicyKey, item.EnergyPolicyVersion, warnings);

    private static AiMealDraftView ToAiDraftView(AiMealDraftOperation item, Guid? recipeVersionId = null) =>
        new(item.Id, item.Status, item.PromptVersion, item.SchemaVersion, item.ProviderKey, item.Model, item.ModelVersion, item.ValidatedDraftJson, item.UncertainFieldsJson, item.FailureCode, item.CostAmount, item.CostCurrency, recipeVersionId);

    private static string BuildProvenance(FoodItem food, FoodItemVersion version) =>
        $"{food.Provenance}; {version.SourceAttribution}; record version {version.SourceRecordVersion}";

    private static bool TryValidateAiSchema(string rawOutput, out string? validatedJson, out string? uncertainJson)
    {
        validatedJson = null;
        uncertainJson = null;
        try
        {
            using var document = JsonDocument.Parse(rawOutput);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("name", out var nameElement) || nameElement.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(nameElement.GetString()) || !root.TryGetProperty("ingredients", out var ingredientsElement) || ingredientsElement.ValueKind != JsonValueKind.Array)
            {
                return false;
            }

            var ingredients = new List<ValidatedAiIngredient>();
            foreach (var element in ingredientsElement.EnumerateArray())
            {
                if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty("name", out var ingredientName) || ingredientName.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(ingredientName.GetString()) || !element.TryGetProperty("quantity", out var quantity) || quantity.ValueKind != JsonValueKind.Number || !quantity.TryGetDecimal(out var value) || value <= 0m || !element.TryGetProperty("unit", out var unit) || unit.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(unit.GetString()) || !element.TryGetProperty("uncertain", out var uncertain) || uncertain.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                {
                    return false;
                }

                ingredients.Add(new ValidatedAiIngredient(ingredientName.GetString()!.Trim(), value, unit.GetString()!.Trim(), uncertain.GetBoolean()));
            }

            if (ingredients.Count == 0 || ingredients.Count > 100)
            {
                return false;
            }

            var validated = new ValidatedAiDraft(nameElement.GetString()!.Trim(), ingredients);
            validatedJson = JsonSerializer.Serialize(validated, JsonOptions);
            uncertainJson = JsonSerializer.Serialize(ingredients.Where(item => item.Uncertain).Select(item => item.Name).ToArray(), JsonOptions);
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private Guid RequireUserId() => currentUser.UserId ?? throw new InvalidOperationException("An authenticated user is required.");

    private static NutritionCommandResult NotFound() => new(NutritionCommandStatus.NotFound);
    private static NutritionCommandResult Invalid(string field, string message) => new(NutritionCommandStatus.Invalid, Errors: new Dictionary<string, string[]> { [field] = [message] });
    private static NutritionCommandResult Conflict(string code, string message) => new(NutritionCommandStatus.Conflict, Code: code, Message: message);

    private sealed record CoverageLookup(bool Found, NutritionCoverageDecision Decision, NutritionCoverageAuthorization? Authorization);
    private sealed record DayQueryRow(Guid PlanId, Guid DayId, DateOnly Date, decimal TargetCalories, decimal TargetProtein, decimal TargetCarbohydrate, decimal TargetFat);
    private sealed record ValidatedAiDraft(string Name, IReadOnlyList<ValidatedAiIngredient> Ingredients);
    private sealed record ValidatedAiIngredient(string Name, decimal Quantity, string Unit, bool Uncertain);

    private sealed class NutritionInputException(string field, string message) : Exception(message)
    {
        public string Field { get; } = field;
    }
}

public sealed class NutritionProviderUnavailableException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}
