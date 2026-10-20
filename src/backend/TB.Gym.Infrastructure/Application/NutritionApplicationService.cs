using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Nutrition;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.Modules.Tenancy;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

internal sealed partial class NutritionApplicationService(
    GymDbContext dbContext,
    IClock clock,
    ICurrentUser currentUser,
    ITenantContext tenantContext,
    ICoachingFeatureAccessService featureAccessService,
    INutritionDataProvider nutritionDataProvider,
    IAiMealDraftProvider aiMealDraftProvider,
    IOptions<NutritionAiAllowanceOptions> aiAllowance) : INutritionApplicationService
{
    private const string AiSchemaVersion = "meal-draft-v1";
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    // One answer for Settings and the recipe editor (LOST-4): a ceiling of zero keeps AI off (R4.4c).
    public AiMealDraftAvailabilityView GetAiAvailability() => new(
        aiMealDraftProvider.IsConfigured &&
        aiAllowance.Value.MaximumMonthlyRequests > 0 &&
        aiAllowance.Value.MaximumMonthlyCostUsd > 0m);

    private static bool IsDailyLogStartRace(DbUpdateException exception) =>
        exception.InnerException is PostgresException
        {
            SqlState: PostgresErrorCodes.UniqueViolation,
            ConstraintName: "IX_DailyNutritionLogs_TenantId_ClientProfileId_Date",
        };

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
        return await dbContext.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
            await LockAiBudgetAsync(cancellationToken);
            var result = await UpdateSettingsCoreAsync(request, cancellationToken);
            if (result.Status == NutritionCommandStatus.Success)
            {
                await transaction.CommitAsync(cancellationToken);
            }

            return result;
        });
    }

    private async Task<NutritionCommandResult> UpdateSettingsCoreAsync(UpdateNutritionSettingsRequest request, CancellationToken cancellationToken)
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

        // Raising an allowance above TB Gym's ceiling is refused; keeping or lowering one set before a
        // lower ceiling is not, so the owner can still save the other defaults.
        var ceiling = aiAllowance.Value;
        if (request.AiMonthlyRequestLimit > ceiling.MaximumMonthlyRequests && request.AiMonthlyRequestLimit > settings.AiMonthlyRequestLimit)
        {
            return Invalid("aiMonthlyRequestLimit", string.Create(CultureInfo.InvariantCulture, $"TB Gym allows each workspace up to {ceiling.MaximumMonthlyRequests} AI suggestions a month."));
        }

        if (request.AiMonthlyCostLimit > ceiling.MaximumMonthlyCostUsd && request.AiMonthlyCostLimit > settings.AiMonthlyCostLimit)
        {
            return Invalid("aiMonthlyCostLimit", string.Create(CultureInfo.InvariantCulture, $"TB Gym allows each workspace up to USD {ceiling.MaximumMonthlyCostUsd:0.00} of AI suggestions a month."));
        }

        try
        {
            settings.Update(request.EnergyPolicyKey, request.ProviderCalorieTolerance, request.AiMonthlyRequestLimit, request.AiMonthlyCostLimit, request.AiCostCurrency);
            await dbContext.SaveChangesAsync(cancellationToken);
            return new NutritionCommandResult(NutritionCommandStatus.Success, Settings: ToSettingsView(settings));
        }
        catch (ArgumentException exception)
        {
            return Invalid("settings", exception.PersonMessage());
        }
        catch (DbUpdateConcurrencyException)
        {
            return Conflict("nutrition_settings_conflict", "Nutrition settings changed while this request was being saved.");
        }
    }

    public async Task<FoodItemPage> ListFoodsAsync(string? query, bool archived, int skip, int take, CancellationToken cancellationToken)
    {
        var source = dbContext.FoodItems.AsNoTracking().Where(item => (item.ArchivedAtUtc != null) == archived);
        if (!string.IsNullOrWhiteSpace(query))
        {
            var pattern = LikePattern.Containing(query);
            source = source.Where(item => EF.Functions.ILike(item.Name, pattern, LikePattern.EscapeCharacter));
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
            return Invalid("food", exception.PersonMessage());
        }
        catch (DbUpdateException)
        {
            return Conflict("food_conflict", "A food with the same tenant/provider identity already exists.");
        }
    }

    public async Task<NutritionCommandResult> AddFoodVersionAsync(Guid foodItemId, AddFoodVersionRequest request, CancellationToken cancellationToken)
    {
        int? firstRevision = null;
        for (var attempt = 0; ; attempt++)
        {
            var food = await dbContext.FoodItems.SingleOrDefaultAsync(item => item.Id == foodItemId, cancellationToken);
            if (food is null)
            {
                return NotFound();
            }

            firstRevision ??= food.CurrentRevision;
            if (request.BaseRevision is { } baseRevision && baseRevision != food.CurrentRevision)
            {
                return Conflict("food_changed", "This food was changed since it was opened. Reload it and make your change again.");
            }

            try
            {
                var settings = await GetOrCreateSettingsEntityAsync(cancellationToken);
                if (request.Name is not null)
                {
                    food.Rename(request.Name);
                }

                var version = food.AddVersion(ToFoodVersionInput(request, settings));
                dbContext.FoodItemVersions.Add(version);
                await dbContext.SaveChangesAsync(cancellationToken);
                var reloaded = await dbContext.FoodItems.AsNoTracking().Include(item => item.Versions).ThenInclude(item => item.Allergens)
                    .AsSplitQuery().SingleAsync(item => item.Id == foodItemId, cancellationToken);
                return new NutritionCommandResult(NutritionCommandStatus.Success, Food: ToFoodView(reloaded));
            }
            catch (ArgumentException exception)
            {
                return Invalid("version", exception.PersonMessage());
            }
            catch (DbUpdateException exception) when (exception is DbUpdateConcurrencyException || IsFoodRevisionRace(exception))
            {
                dbContext.ChangeTracker.Clear();
                // The save goes again: after an archive or a restore it lands, and after another
                // version the base revision check says the food changed. Two saves at the same moment
                // meet on the revision's unique index rather than the food's version (BEA-6).
                var versioned = await CurrentRevisionAsync(foodItemId, cancellationToken) != firstRevision;
                if (attempt >= 2 || (versioned && request.BaseRevision is null))
                {
                    return Conflict("food_version_conflict", "The food was versioned by another request.");
                }
            }
        }
    }

    private static bool IsFoodRevisionRace(DbUpdateException exception) =>
        exception.InnerException is PostgresException
        {
            SqlState: PostgresErrorCodes.UniqueViolation,
            ConstraintName: "IX_FoodItemVersions_TenantId_FoodItemId_Revision",
        };

    private Task<int> CurrentRevisionAsync(Guid foodItemId, CancellationToken cancellationToken) =>
        dbContext.FoodItems.AsNoTracking().Where(item => item.Id == foodItemId).Select(item => item.CurrentRevision).SingleAsync(cancellationToken);

    public async Task<NutritionCommandResult> SetFoodArchivedAsync(Guid foodItemId, SetFoodArchivedRequest request, CancellationToken cancellationToken)
    {
        // Archiving changes only the flag, so a save that raced another (a new version, say) is
        // applied again to the food as it now is, rather than refused.
        for (var attempt = 0; ; attempt++)
        {
            var food = await dbContext.FoodItems.SingleOrDefaultAsync(item => item.Id == foodItemId, cancellationToken);
            if (food is null)
            {
                return NotFound();
            }

            if (request.IsArchived)
            {
                food.Archive(clock.UtcNow);
            }
            else
            {
                food.Restore();
            }

            try
            {
                await dbContext.SaveChangesAsync(cancellationToken);
                var saved = await dbContext.FoodItems.AsNoTracking().Include(item => item.Versions).ThenInclude(item => item.Allergens)
                    .AsSplitQuery().SingleAsync(item => item.Id == foodItemId, cancellationToken);
                return new NutritionCommandResult(NutritionCommandStatus.Success, Food: ToFoodView(saved));
            }
            catch (DbUpdateConcurrencyException) when (attempt < 2)
            {
                dbContext.ChangeTracker.Clear();
            }
            catch (DbUpdateConcurrencyException)
            {
                return Conflict("food_changed", "This food was changed while it was being archived. Try again.");
            }
        }
    }

    public async Task<ProviderFoodSearchPage> SearchUsdaAsync(string query, FoodSearchKind kind, int skip, int take, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(query))
        {
            return new ProviderFoodSearchPage(skip, take, [], "query_required", "Enter a USDA FoodData Central search term.");
        }

        try
        {
            var items = await nutritionDataProvider.SearchAsync(query.Trim(), kind, skip, take, cancellationToken);
            // Carbohydrate as an import counts it; a match that could not be imported is left out.
            var counted = items
                .Select(item => item.CarbohydrateGrams is not { } carbohydrate
                    ? item
                    : ProviderCarbohydrateRule.Count(carbohydrate) is { } count ? item with { CarbohydrateGrams = count } : null)
                .OfType<FoodSearchResult>()
                .ToArray();
            return new ProviderFoodSearchPage(skip, take, counted);
        }
        catch (NutritionProviderUnavailableException exception)
        {
            return new ProviderFoodSearchPage(skip, take, [], exception.Code, exception.PersonMessage());
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
            // Adding an archived USDA food again brings it back.
            if (existing.ArchivedAtUtc is not null)
            {
                existing.Restore();
                try
                {
                    await dbContext.SaveChangesAsync(cancellationToken);
                }
                catch (DbUpdateConcurrencyException)
                {
                    return Conflict("food_changed", "This food was changed while it was being added. Try again.");
                }
            }

            return new NutritionCommandResult(NutritionCommandStatus.Success, Food: ToFoodView(existing));
        }

        try
        {
            var providerFood = await nutritionDataProvider.GetFoodAsync(externalId, cancellationToken);
            if (providerFood is null)
            {
                return NotFound();
            }

            var carbohydrate = ProviderCarbohydrateRule.Count(providerFood.CarbohydrateGrams);
            if (carbohydrate is null)
            {
                return Invalid("providerFood", "USDA’s numbers for this food don’t add up (its carbohydrate is below zero), so it was not added. Choose another match or add the food yourself.");
            }

            var settings = await GetOrCreateSettingsEntityAsync(cancellationToken);
            var food = FoodItem.Create(tenantContext.TenantId, providerFood.Name, FoodProvenance.UsdaFdc, providerFood.ExternalId, providerFood.DataType);
            food.AddVersion(new FoodVersionInput(
                providerFood.BasisGrams,
                FoodQuantityUnit.Gram,
                providerFood.PreparationBasis,
                providerFood.ProteinGrams,
                carbohydrate.Value,
                providerFood.FatGrams,
                providerFood.FibreGrams,
                providerFood.PolyolGrams,
                providerFood.EthanolGrams,
                providerFood.ProviderCalories,
                settings.EnergyPolicyKey,
                settings.ProviderCalorieTolerance,
                "USDA FoodData Central (CC0 1.0)",
                $"{providerFood.DataType}:{providerFood.RetrievedAtUtc:O}",
                providerFood.DeclaredAllergens,
                providerFood.UnreportedNutrients,
                providerFood.CarbohydrateGrams < 0m ? providerFood.CarbohydrateGrams : null));
            dbContext.FoodItems.Add(food);
            await dbContext.SaveChangesAsync(cancellationToken);
            return new NutritionCommandResult(NutritionCommandStatus.Success, Food: ToFoodView(food));
        }
        catch (NutritionProviderUnavailableException exception)
        {
            return new NutritionCommandResult(NutritionCommandStatus.ProviderUnavailable, Code: exception.Code, Message: exception.PersonMessage());
        }
        catch (ArgumentException exception)
        {
            return Invalid("providerFood", exception.PersonMessage());
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
            return Invalid("cookingFactor", exception.PersonMessage());
        }
    }

    public async Task<RecipePage> ListRecipesAsync(string? query, int skip, int take, bool publishedOnly, CancellationToken cancellationToken)
    {
        var source = dbContext.Recipes.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(query))
        {
            var pattern = LikePattern.Containing(query);
            source = source.Where(item => EF.Functions.ILike(item.Name, pattern, LikePattern.EscapeCharacter));
        }

        if (publishedOnly)
        {
            source = source.Where(item => item.Versions.Any(version => version.Status == PublicationStatus.Published));
        }

        var total = await source.CountAsync(cancellationToken);
        var recipes = await source.OrderBy(item => item.Name).Skip(skip).Take(take)
            .Include(item => item.Versions).ThenInclude(item => item.Allergens)
            .AsSplitQuery().ToListAsync(cancellationToken);
        return new RecipePage(total, skip, take, recipes.Select(recipe =>
        {
            var published = recipe.Versions.Where(version => version.Status == PublicationStatus.Published).MaxBy(version => version.Revision);
            return ToRecipeSummary(recipe, publishedOnly ? published! : recipe.Versions.MaxBy(version => version.Revision)!, published?.Id);
        }).ToArray());
    }

    public async Task<NutritionCommandResult> CreateRecipeAsync(CreateRecipeRequest request, CancellationToken cancellationToken)
    {
        try
        {
            await EnsureRecipePhotoAsync(request.PhotoMediaAssetId, null, cancellationToken);
            var ingredientInputs = await BuildRecipeIngredientsAsync(request.Ingredients, cancellationToken);
            var recipe = Recipe.Create(tenantContext.TenantId, request.Name);
            var version = recipe.AddDraft(request.Instructions, request.Servings, ingredientInputs, request.PhotoMediaAssetId, request.PrepMinutes, request.CookMinutes);
            if (request.Publish)
            {
                version.Publish(clock.UtcNow, RequireUserId());
            }

            dbContext.Recipes.Add(recipe);
            await dbContext.SaveChangesAsync(cancellationToken);
            return new NutritionCommandResult(NutritionCommandStatus.Success, Recipe: ToRecipeSummary(recipe, version, request.Publish ? version.Id : null));
        }
        catch (NutritionInputException exception)
        {
            return Invalid(exception.Field, exception.PersonMessage());
        }
        catch (ArgumentException exception)
        {
            return Invalid("recipe", exception.PersonMessage());
        }
    }

    public async Task<NutritionCommandResult> AddRecipeVersionAsync(Guid recipeId, AddRecipeVersionRequest request, CancellationToken cancellationToken)
    {
        var recipe = await dbContext.Recipes.SingleOrDefaultAsync(item => item.Id == recipeId, cancellationToken);
        if (recipe is null)
        {
            return NotFound();
        }

        // The editor names the revision it opened, so a save made since then in another tab or by
        // another coach is reported rather than silently replaced as the newest version.
        if (request.BaseRevision is { } baseRevision && baseRevision != recipe.CurrentRevision)
        {
            return RecipeChanged();
        }

        try
        {
            await EnsureRecipePhotoAsync(request.PhotoMediaAssetId, recipe.Id, cancellationToken);
            var ingredientInputs = await BuildRecipeIngredientsAsync(request.Ingredients, cancellationToken);
            if (request.Name is not null)
            {
                recipe.Rename(request.Name);
            }

            var version = recipe.AddDraft(request.Instructions, request.Servings, ingredientInputs, request.PhotoMediaAssetId, request.PrepMinutes, request.CookMinutes);
            if (request.Publish)
            {
                version.Publish(clock.UtcNow, RequireUserId());
            }

            dbContext.RecipeVersions.Add(version);
            await dbContext.SaveChangesAsync(cancellationToken);
            var publishedVersionId = request.Publish
                ? version.Id
                : await dbContext.RecipeVersions.AsNoTracking()
                    .Where(item => item.RecipeId == recipe.Id && item.Status == PublicationStatus.Published)
                    .OrderByDescending(item => item.Revision)
                    .Select(item => (Guid?)item.Id)
                    .FirstOrDefaultAsync(cancellationToken);
            return new NutritionCommandResult(NutritionCommandStatus.Success, Recipe: ToRecipeSummary(recipe, version, publishedVersionId));
        }
        catch (NutritionInputException exception)
        {
            return Invalid(exception.Field, exception.PersonMessage());
        }
        catch (ArgumentException exception)
        {
            return Invalid("recipe", exception.PersonMessage());
        }
        catch (DbUpdateConcurrencyException)
        {
            return Conflict("recipe_version_conflict", "The recipe was versioned by another request.");
        }
        catch (DbUpdateException exception) when (IsRecipeRevisionRace(exception))
        {
            return RecipeChanged();
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
            return new NutritionCommandResult(NutritionCommandStatus.Success, Recipe: ToRecipeSummary(recipe, version, version.Id));
        }
        catch (InvalidOperationException exception)
        {
            return Conflict("recipe_publication_conflict", exception.PersonMessage());
        }
    }

    public async Task<MealPlanTemplatePage> ListMealPlansAsync(int skip, int take, CancellationToken cancellationToken)
    {
        var total = await dbContext.MealPlanTemplates.CountAsync(cancellationToken);
        var templates = await dbContext.MealPlanTemplates.AsNoTracking().OrderBy(item => item.Name).Skip(skip).Take(take)
            .Include(item => item.Versions).ThenInclude(item => item.Slots)
            .AsSplitQuery().ToListAsync(cancellationToken);
        var drafts = await OwnDraftsByPlanAsync(templates.Select(item => item.Id).ToArray(), cancellationToken);
        return new MealPlanTemplatePage(total, skip, take, templates.Select(template => ToMealPlanSummary(
            template,
            template.Versions.MaxBy(version => version.Revision)!,
            drafts.GetValueOrDefault(template.Id))).ToArray());
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
            return Invalid(exception.Field, exception.PersonMessage());
        }
        catch (ArgumentException exception)
        {
            return Invalid("mealPlan", exception.PersonMessage());
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
            return Conflict("meal_plan_publication_conflict", exception.PersonMessage());
        }
    }

    public async Task<NutritionCommandResult> CalculateTargetsAsync(Guid clientProfileId, CalculateNutritionTargetsRequest request, CancellationToken cancellationToken)
    {
        var reach = await ReachClientAsync(clientProfileId, cancellationToken);
        if (reach != ClientNutritionReach.Allowed)
        {
            return Refused(reach);
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
            return Invalid("calculation", exception.PersonMessage());
        }
    }

    /// <summary>
    /// The coach's own macros win (NUT-008, INV-2): the override is kept as its append-only audit, and the
    /// targets it makes are a new calculation that names it, so the next meal plan assigned carries them
    /// and every plan assigned before keeps the targets it had (NUT-009).
    /// </summary>
    public async Task<NutritionCommandResult> OverrideMacrosAsync(Guid clientProfileId, Guid calculationSnapshotId, CreateMacroOverrideRequest request, CancellationToken cancellationToken)
    {
        var reach = await ReachClientAsync(clientProfileId, cancellationToken);
        if (reach != ClientNutritionReach.Allowed)
        {
            return Refused(reach);
        }

        var source = await dbContext.NutritionCalculationSnapshots.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == calculationSnapshotId && item.ClientProfileId == clientProfileId, cancellationToken);
        if (source is null)
        {
            return NotFound();
        }

        try
        {
            var audit = MacroOverrideAudit.Create(tenantContext.TenantId, source.Id, request.ProteinGrams, request.FatGrams, request.CarbohydrateGrams, request.Reason, RequireUserId());
            var adjusted = source.WithCoachMacros(audit);
            dbContext.MacroOverrideAudits.Add(audit);
            dbContext.NutritionCalculationSnapshots.Add(adjusted);
            await dbContext.SaveChangesAsync(cancellationToken);
            var record = (await CalculationRecordsAsync(clientProfileId, [adjusted.Id], int.MaxValue, cancellationToken)).Single();
            return new NutritionCommandResult(NutritionCommandStatus.Success, CalculationRecord: record);
        }
        catch (ArgumentException exception)
        {
            return Invalid("macroOverride", exception.PersonMessage());
        }
    }

    public async Task<NutritionCommandResult> ReplaceClientAllergensAsync(Guid clientProfileId, ReplaceClientAllergensRequest request, CancellationToken cancellationToken)
    {
        var reach = await ReachClientAsync(clientProfileId, cancellationToken);
        if (reach != ClientNutritionReach.Allowed)
        {
            return Refused(reach);
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

    public async Task<ClientNutritionRead<ClientAllergensView>> GetClientAllergensAsync(Guid clientProfileId, CancellationToken cancellationToken)
    {
        var reach = await ReachClientAsync(clientProfileId, cancellationToken);
        if (reach != ClientNutritionReach.Allowed)
        {
            return new(reach);
        }

        var codes = await dbContext.ClientDeclaredAllergens.AsNoTracking()
            .Where(item => item.ClientProfileId == clientProfileId && item.IsActive)
            .Select(item => item.Code)
            .ToArrayAsync(cancellationToken);
        return new(reach, new ClientAllergensView(codes.Order().ToArray()));
    }

    public async Task<ClientNutritionRead<NutritionCalculationRecord[]>> ListCalculationsAsync(Guid clientProfileId, int take, CancellationToken cancellationToken)
    {
        var reach = await ReachClientAsync(clientProfileId, cancellationToken);
        return reach != ClientNutritionReach.Allowed
            ? new(reach)
            : new(reach, await CalculationRecordsAsync(clientProfileId, null, Math.Clamp(take, 1, 20), cancellationToken));
    }

    /// <summary>The client's calculations, newest first, each a coach's override says what it changed.</summary>
    private async Task<NutritionCalculationRecord[]> CalculationRecordsAsync(Guid clientProfileId, Guid[]? ids, int take, CancellationToken cancellationToken)
    {
        var source = dbContext.NutritionCalculationSnapshots.AsNoTracking().Where(item => item.ClientProfileId == clientProfileId);
        if (ids is not null)
        {
            source = source.Where(item => ids.Contains(item.Id));
        }

        var rows = await source
            .OrderByDescending(item => item.CreatedAtUtc)
            .ThenByDescending(item => item.Id)
            .Take(take)
            .ToListAsync(cancellationToken);
        var overrideIds = rows.Where(item => item.MacroOverrideAuditId is not null).Select(item => item.MacroOverrideAuditId!.Value).ToArray();
        var adjustments = overrideIds.Length == 0
            ? new Dictionary<Guid, MacroAdjustmentView>()
            : await (from audit in dbContext.MacroOverrideAudits.AsNoTracking()
                     join adjusted in dbContext.NutritionCalculationSnapshots.AsNoTracking()
                         on new { audit.TenantId, Id = audit.CalculationSnapshotId } equals new { adjusted.TenantId, adjusted.Id }
                     where overrideIds.Contains(audit.Id)
                     select new MacroAdjustmentView(audit.Id, audit.Reason, audit.CreatedAtUtc, adjusted.Id, adjusted.CalorieTarget, adjusted.ProteinGrams, adjusted.CarbohydrateGrams, adjusted.FatGrams))
                .ToDictionaryAsync(item => item.OverrideId, cancellationToken);
        return rows.Select(item => ToCalculationRecord(item, item.MacroOverrideAuditId is { } overrideId ? adjustments.GetValueOrDefault(overrideId) : null)).ToArray();
    }

    public async Task<ClientNutritionRead<ClientNutritionPlanSummary[]>> ListClientPlansAsync(Guid clientProfileId, CancellationToken cancellationToken)
    {
        var reach = await ReachClientAsync(clientProfileId, cancellationToken);
        return reach != ClientNutritionReach.Allowed
            ? new(reach)
            : new(reach, await PlanSummariesAsync(clientProfileId, null, cancellationToken));
    }

    /// <summary>The client's plans, newest start first, each with the targets it carries and, once stopped, why.</summary>
    private async Task<ClientNutritionPlanSummary[]> PlanSummariesAsync(Guid clientProfileId, Guid? planId, CancellationToken cancellationToken)
    {
        var plans = await (from plan in dbContext.ClientNutritionPlans.AsNoTracking()
                           join calculation in dbContext.NutritionCalculationSnapshots.AsNoTracking()
                               on new { plan.TenantId, Id = plan.NutritionCalculationSnapshotId } equals new { calculation.TenantId, calculation.Id }
                           join version in dbContext.MealPlanTemplateVersions.AsNoTracking()
                               on new { plan.TenantId, Id = plan.SourceMealPlanTemplateVersionId } equals new { version.TenantId, version.Id }
                           join template in dbContext.MealPlanTemplates.AsNoTracking()
                               on new { version.TenantId, Id = version.MealPlanTemplateId } equals new { template.TenantId, template.Id }
                           where plan.ClientProfileId == clientProfileId && (planId == null || plan.Id == planId)
                           orderby plan.StartDate descending
                           select new ClientNutritionPlanSummary(plan.Id, plan.SourceMealPlanTemplateVersionId, plan.EnrollmentId, plan.StartDate, plan.EndDateExclusive, calculation.CalorieTarget, plan.Status, plan.Version, template.Name, calculation.ProteinGrams, calculation.CarbohydrateGrams, calculation.FatGrams, calculation.Id, null, null))
            .ToArrayAsync(cancellationToken);
        var stoppedIds = plans.Where(item => item.Status == ClientNutritionPlanStatus.Cancelled).Select(item => item.Id).ToArray();
        if (stoppedIds.Length == 0)
        {
            return plans;
        }

        // Stopping is one way (NUT-011), so a stopped plan has one such event; the newest is taken.
        var stops = (await dbContext.NutritionPlanLifecycleEvents.AsNoTracking()
                .Where(item => stoppedIds.Contains(item.ClientNutritionPlanId) && item.EventType == NutritionPlanLifecycleEventType.Cancelled)
                .ToListAsync(cancellationToken))
            .GroupBy(item => item.ClientNutritionPlanId)
            .ToDictionary(group => group.Key, group => group.MaxBy(item => item.OccurredAtUtc)!);
        return plans.Select(item => stops.TryGetValue(item.Id, out var stop)
            ? item with { StoppedAtUtc = stop.OccurredAtUtc, StopReason = stop.Reason }
            : item).ToArray();
    }

    public async Task<NutritionCommandResult> AssignPlanAsync(Guid clientProfileId, AssignNutritionPlanRequest request, CancellationToken cancellationToken)
    {
        var reach = await ReachClientAsync(clientProfileId, cancellationToken);
        if (reach != ClientNutritionReach.Allowed)
        {
            return Refused(reach);
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

        // The client gets their own copy of each recipe (NUT-006), named as the meal plan names it.
        var planNames = template.Slots.OrderBy(slot => slot.DayOffset).ThenBy(slot => slot.Order).SelectMany(slot => slot.Choices)
            .GroupBy(choice => choice.RecipeVersionId).ToDictionary(group => group.Key, group => group.First().RecipeName);
        var recipeVersions = await dbContext.RecipeVersions.AsNoTracking().Include(item => item.Ingredients)
            .Where(item => recipeVersionIds.Contains(item.Id)).AsSplitQuery().ToListAsync(cancellationToken);
        var recipeInputs = recipeVersions.Select(version => new PlanRecipeInput(
            version.Id,
            planNames[version.Id],
            version.Instructions,
            version.Servings,
            version.PrepMinutes,
            version.CookMinutes,
            version.PhotoMediaAssetId,
            version.Ingredients.OrderBy(line => line.Order).Select(line => new PlanRecipeIngredientInput(line.FoodName, line.Quantity, line.Unit, line.Basis)).ToArray())).ToArray();
        try
        {
            var plan = ClientNutritionPlan.Assign(tenantContext.TenantId, clientProfileId, request.EnrollmentId, template.Id, calculation.Id, request.StartDate, endDate, slotInputs, recipeInputs, coverage.Authorization!);
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
            return new NutritionCommandResult(NutritionCommandStatus.Success, ClientPlan: new ClientNutritionPlanSummary(plan.Id, plan.SourceMealPlanTemplateVersionId, plan.EnrollmentId, plan.StartDate, plan.EndDateExclusive, calculation.CalorieTarget, plan.Status, plan.Version, await MealPlanNameAsync(template.Id, cancellationToken), calculation.ProteinGrams, calculation.CarbohydrateGrams, calculation.FatGrams, calculation.Id));
        }
        catch (ArgumentException exception)
        {
            return Invalid("plan", exception.PersonMessage());
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
        var reach = await ReachClientAsync(clientProfileId, cancellationToken);
        if (reach != ClientNutritionReach.Allowed)
        {
            return Refused(reach);
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
            // Read back as the plan list reads it, so the answer and the list say the same (NCM-1).
            return new NutritionCommandResult(
                NutritionCommandStatus.Success,
                ClientPlan: (await PlanSummariesAsync(clientProfileId, plan.Id, cancellationToken)).Single());
        }
        catch (ArgumentException exception)
        {
            return Invalid("reason", exception.PersonMessage());
        }
        catch (InvalidOperationException exception)
        {
            return Conflict("nutrition_plan_already_cancelled", exception.PersonMessage());
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
            .Include(item => item.Entries).Include(item => item.CustomFoods).Include(item => item.CustomFoodReversals).AsSplitQuery().SingleOrDefaultAsync(cancellationToken);
        return ToDayView(row, slots, log, await LoadPlanRecipesAsync(row.PlanId, cancellationToken));
    }

    public async Task<ClientPlanRecipeView?> GetOwnRecipeAsync(Guid recipeId, CancellationToken cancellationToken)
    {
        // The same reach as the day: the caller's current profile, nutrition access and an active plan.
        var client = await FindSelfClientAsync(cancellationToken);
        if (client is null || !(await GetNutritionAccessAsync(client.Id, cancellationToken)).IsAllowed)
        {
            return null;
        }

        var recipe = await (from copy in dbContext.ClientNutritionPlanRecipes.AsNoTracking().Include(item => item.Ingredients)
                            join plan in dbContext.ClientNutritionPlans.AsNoTracking()
                                on new { copy.TenantId, Id = copy.ClientNutritionPlanId } equals new { plan.TenantId, plan.Id }
                            where copy.Id == recipeId && plan.ClientProfileId == client.Id && plan.Status == ClientNutritionPlanStatus.Active
                            select copy).AsSplitQuery().SingleOrDefaultAsync(cancellationToken);
        return recipe is null
            ? null
            : new ClientPlanRecipeView(
                recipe.Id,
                recipe.Name,
                recipe.Servings,
                recipe.PrepMinutes,
                recipe.CookMinutes,
                recipe.Instructions,
                recipe.PhotoMediaAssetId,
                recipe.Ingredients.OrderBy(line => line.Order).Select(line => new ClientPlanRecipeIngredientView(line.FoodName, line.Quantity, line.Unit, line.Basis)).ToArray());
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

        var log = await dbContext.DailyNutritionLogs.Include(item => item.Entries).Include(item => item.CustomFoods).Include(item => item.CustomFoodReversals).AsSplitQuery().SingleOrDefaultAsync(item => item.ClientNutritionPlanDayId == day.Id, cancellationToken);
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
            var entry = log.Record(request.PlanSlotId, choice.Id, choice.RecipeName, request.ActualServings, choice.Calories * multiplier, choice.ProteinGrams * multiplier, choice.CarbohydrateGrams * multiplier, choice.FatGrams * multiplier);
            dbContext.DailyNutritionLogEntries.Add(entry);
            log.StampUpdate(clock.UtcNow, currentUser.UserId);
            await dbContext.SaveChangesAsync(cancellationToken);
            var row = await LoadDayRowAsync(day.Id, cancellationToken);
            var slots = await dbContext.ClientNutritionPlanSlots.AsNoTracking().Where(item => item.ClientNutritionPlanDayId == day.Id).Include(item => item.Choices).OrderBy(item => item.Order).AsSplitQuery().ToListAsync(cancellationToken);
            return new NutritionCommandResult(NutritionCommandStatus.Success, Day: ToDayView(row!, slots, log, await LoadPlanRecipesAsync(row!.PlanId, cancellationToken)));
        }
        catch (InvalidOperationException exception)
        {
            return Conflict("nutrition_log_completed", exception.PersonMessage());
        }
        catch (DbUpdateConcurrencyException)
        {
            return Conflict("nutrition_log_conflict", "The nutrition log changed while this choice was being saved.");
        }
        catch (DbUpdateException exception) when (IsDailyLogStartRace(exception))
        {
            return Conflict("nutrition_log_conflict", "The nutrition log was started by another request. Refresh this day and try again.");
        }
    }

    public async Task<NutritionCommandResult> AddOwnCustomFoodAsync(AddNutritionCustomFoodRequest request, CancellationToken cancellationToken)
    {
        var client = await FindSelfClientAsync(cancellationToken);
        if (client is null || !(await GetNutritionAccessAsync(client.Id, cancellationToken)).IsAllowed)
        {
            return new NutritionCommandResult(NutritionCommandStatus.Forbidden);
        }

        var day = await (from item in dbContext.ClientNutritionPlanDays.AsNoTracking()
                         join plan in dbContext.ClientNutritionPlans.AsNoTracking()
                             on new { item.TenantId, Id = item.ClientNutritionPlanId } equals new { plan.TenantId, plan.Id }
                         where item.Id == request.PlanDayId && plan.ClientProfileId == client.Id && plan.Status == ClientNutritionPlanStatus.Active
                         select new { item.Id, item.ClientNutritionPlanId, item.Date }).SingleOrDefaultAsync(cancellationToken);
        if (day is null) return NotFound();

        var log = await dbContext.DailyNutritionLogs.Include(item => item.Entries).Include(item => item.CustomFoods).Include(item => item.CustomFoodReversals).AsSplitQuery()
            .SingleOrDefaultAsync(item => item.ClientNutritionPlanDayId == day.Id && item.ClientProfileId == client.Id, cancellationToken);
        if (log is null)
        {
            if (request.DailyLogVersion is not null) return Conflict("nutrition_log_conflict", "The nutrition log changed before this food was added.");
            log = DailyNutritionLog.Start(tenantContext.TenantId, client.Id, day.ClientNutritionPlanId, day.Id, day.Date);
            dbContext.DailyNutritionLogs.Add(log);
        }
        else if (request.DailyLogVersion is null)
        {
            return Conflict("nutrition_log_version_required", "Refresh the nutrition log before adding food.");
        }
        else
        {
            dbContext.Entry(log).Property(item => item.Version).OriginalValue = request.DailyLogVersion.Value;
        }

        try
        {
            var food = log.AddCustomFood(request.Name, request.Amount, request.Unit, request.Calories, request.ProteinGrams, request.CarbohydrateGrams, request.FatGrams);
            dbContext.DailyNutritionCustomFoods.Add(food);
            log.StampUpdate(clock.UtcNow, currentUser.UserId);
            await dbContext.SaveChangesAsync(cancellationToken);
            var row = await LoadDayRowAsync(day.Id, cancellationToken);
            var slots = await dbContext.ClientNutritionPlanSlots.AsNoTracking().Where(item => item.ClientNutritionPlanDayId == day.Id)
                .Include(item => item.Choices).OrderBy(item => item.Order).AsSplitQuery().ToListAsync(cancellationToken);
            return new NutritionCommandResult(NutritionCommandStatus.Success, Day: ToDayView(row!, slots, log, await LoadPlanRecipesAsync(row!.PlanId, cancellationToken)));
        }
        catch (ArgumentException exception)
        {
            return Invalid("food", exception.PersonMessage());
        }
        catch (InvalidOperationException exception)
        {
            return Conflict("nutrition_log_completed", exception.PersonMessage());
        }
        catch (DbUpdateConcurrencyException)
        {
            return Conflict("nutrition_log_conflict", "The nutrition log changed while this food was being added.");
        }
        catch (DbUpdateException exception) when (IsDailyLogStartRace(exception))
        {
            return Conflict("nutrition_log_conflict", "The nutrition log was started by another request. Refresh this day and try again.");
        }
    }

    public async Task<NutritionCommandResult> ReverseOwnCustomFoodAsync(Guid foodId, ReverseNutritionCustomFoodRequest request, CancellationToken cancellationToken)
    {
        var client = await FindSelfClientAsync(cancellationToken);
        if (client is null || !(await GetNutritionAccessAsync(client.Id, cancellationToken)).IsAllowed)
            return new NutritionCommandResult(NutritionCommandStatus.Forbidden);

        var log = await dbContext.DailyNutritionLogs
            .Include(item => item.Entries).Include(item => item.CustomFoods).Include(item => item.CustomFoodReversals).AsSplitQuery()
            .SingleOrDefaultAsync(item => item.ClientProfileId == client.Id && item.CustomFoods.Any(food => food.Id == foodId), cancellationToken);
        if (log is null || !await dbContext.ClientNutritionPlans.AsNoTracking()
                .AnyAsync(plan => plan.Id == log.ClientNutritionPlanId && plan.ClientProfileId == client.Id && plan.Status == ClientNutritionPlanStatus.Active, cancellationToken))
            return NotFound();

        try
        {
            dbContext.Entry(log).Property(item => item.Version).OriginalValue = request.DailyLogVersion;
            var reversal = log.ReverseCustomFood(foodId, RequireUserId(), clock.UtcNow);
            dbContext.DailyNutritionCustomFoodReversals.Add(reversal);
            log.StampUpdate(clock.UtcNow, currentUser.UserId);
            await dbContext.SaveChangesAsync(cancellationToken);
            var row = await LoadDayRowAsync(log.ClientNutritionPlanDayId, cancellationToken);
            var slots = await dbContext.ClientNutritionPlanSlots.AsNoTracking().Where(item => item.ClientNutritionPlanDayId == log.ClientNutritionPlanDayId)
                .Include(item => item.Choices).OrderBy(item => item.Order).AsSplitQuery().ToListAsync(cancellationToken);
            return new NutritionCommandResult(NutritionCommandStatus.Success, Day: ToDayView(row!, slots, log, await LoadPlanRecipesAsync(row!.PlanId, cancellationToken)));
        }
        catch (InvalidOperationException exception)
        {
            return Conflict("nutrition_food_reversal_conflict", exception.PersonMessage());
        }
        catch (DbUpdateConcurrencyException)
        {
            return Conflict("nutrition_log_conflict", "The nutrition log changed while this food was being removed.");
        }
        catch (DbUpdateException)
        {
            return Conflict("nutrition_food_reversal_conflict", "This food could not be removed from the current day. Refresh and try again.");
        }
    }

    public async Task<NutritionCommandResult> CompleteOwnLogAsync(Guid dailyLogId, CompleteNutritionLogRequest request, CancellationToken cancellationToken)
    {
        var client = await FindSelfClientAsync(cancellationToken);
        if (client is null || !(await GetNutritionAccessAsync(client.Id, cancellationToken)).IsAllowed)
        {
            return new NutritionCommandResult(NutritionCommandStatus.Forbidden);
        }

        var log = await dbContext.DailyNutritionLogs.Include(item => item.Entries).Include(item => item.CustomFoods).Include(item => item.CustomFoodReversals).AsSplitQuery().SingleOrDefaultAsync(item => item.Id == dailyLogId && item.ClientProfileId == client.Id, cancellationToken);
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
            return new NutritionCommandResult(NutritionCommandStatus.Success, Day: ToDayView(row!, slots, log, await LoadPlanRecipesAsync(row!.PlanId, cancellationToken)));
        }
        catch (InvalidOperationException exception)
        {
            return Conflict("nutrition_log_completion_conflict", exception.PersonMessage());
        }
        catch (DbUpdateConcurrencyException)
        {
            return Conflict("nutrition_log_conflict", "The nutrition log changed while it was being completed.");
        }
    }

    public async Task<NutritionCommandResult> GenerateAiDraftAsync(GenerateAiMealDraftRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Prompt) || request.Prompt.Length > 6_000 || string.IsNullOrWhiteSpace(request.Culture) || request.Culture.Length > 100)
        {
            return Invalid("prompt", "Describe a meal in 1–6,000 characters and choose a valid language. Leave out personal and health information.");
        }

        var providerRequest = new AiMealDraftProviderRequest(request.Prompt.Trim(), request.PromptVersion, AiSchemaVersion, request.Culture.Trim());
        var estimate = aiMealDraftProvider.EstimateMaximumCost(providerRequest);
        AiMealDraftOperation? operation = null;
        NutritionCommandResult? refusal = null;
        try
        {
            await dbContext.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
            {
                dbContext.ChangeTracker.Clear();
                await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
                await LockAiBudgetAsync(cancellationToken);
                var settings = await GetOrCreateSettingsEntityAsync(cancellationToken);
                var usage = await GetCurrentAiUsageAsync(cancellationToken);
                var reservedCost = decimal.Round(estimate.Amount, 4, MidpointRounding.ToPositiveInfinity);
                if (reservedCost < 0m || !string.Equals(estimate.Currency, settings.AiCostCurrency, StringComparison.OrdinalIgnoreCase))
                {
                    refusal = Conflict("ai_cost_currency", "AI suggestions are billed in USD. Set the AI budget currency to USD before generating a draft.");
                    return;
                }

                // The workspace's allowance, never more than TB Gym's ceiling.
                var requestLimit = Math.Min(settings.AiMonthlyRequestLimit, aiAllowance.Value.MaximumMonthlyRequests);
                var costLimit = Math.Min(settings.AiMonthlyCostLimit, aiAllowance.Value.MaximumMonthlyCostUsd);
                if (aiMealDraftProvider.IsConfigured && (requestLimit == 0 || usage.Count >= requestLimit || usage.Cost >= costLimit || usage.Cost + reservedCost > costLimit))
                {
                    refusal = Conflict("ai_usage_limit", "This workspace has reached its AI allowance, or the remaining budget cannot cover this suggestion. Ask the workspace owner to check AI limits.");
                    return;
                }

                operation = AiMealDraftOperation.Start(tenantContext.TenantId, request.PromptVersion, AiSchemaVersion, aiMealDraftProvider.ProviderKey);
                // Commit a conservative reservation before making a billed call. Concurrent requests
                // count pending operations; an ambiguous timeout keeps the reservation.
                operation.RecordCost(reservedCost, estimate.Currency);
                dbContext.AiMealDraftOperations.Add(operation);
                await dbContext.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
            });
        }
        catch (ArgumentException exception)
        {
            return Invalid("aiDraft", exception.PersonMessage());
        }

        if (refusal is not null)
        {
            return refusal;
        }

        var recordedOperation = operation ?? throw new InvalidOperationException("AI budget reservation was not recorded.");
        AiMealDraftProviderResult providerResult;
        try
        {
            providerResult = await aiMealDraftProvider.GenerateAsync(providerRequest, cancellationToken);
        }
        catch (OperationCanceledException)
        {
            recordedOperation.Fail("ai_provider_timeout");
            await dbContext.SaveChangesAsync(CancellationToken.None);
            return new NutritionCommandResult(NutritionCommandStatus.ProviderUnavailable, AiDraft: ToAiDraftView(recordedOperation), Code: "ai_provider_timeout", Message: "AI suggestions took too long. No recipe was created. Try again later.");
        }
        catch (Exception)
        {
            recordedOperation.Fail("provider_failure");
            await dbContext.SaveChangesAsync(CancellationToken.None);
            return new NutritionCommandResult(NutritionCommandStatus.ProviderUnavailable, AiDraft: ToAiDraftView(recordedOperation), Code: "ai_provider_failure", Message: "AI suggestions are temporarily unavailable. No recipe was created. Try again later.");
        }

        if (providerResult.CostIsKnown)
        {
            if (providerResult.CostAmount < 0m || !string.Equals(providerResult.CostCurrency, estimate.Currency, StringComparison.OrdinalIgnoreCase))
            {
                recordedOperation.Fail("provider_cost_invalid");
                await dbContext.SaveChangesAsync(CancellationToken.None);
                return Conflict("ai_cost_limit", "AI suggestions returned an invalid cost. No recipe was created.");
            }

            recordedOperation.RecordCost(providerResult.CostAmount, providerResult.CostCurrency);
        }

        if (!providerResult.IsSuccess)
        {
            recordedOperation.Fail(providerResult.FailureCode ?? "provider_failure");
            await dbContext.SaveChangesAsync(CancellationToken.None);
            var code = providerResult.FailureCode ?? "ai_provider_failure";
            var message = code == "ai_provider_not_configured"
                ? "AI meal suggestions aren't set up yet. You can still create recipes yourself."
                : "AI suggestions could not produce a draft. No recipe was created. Try again later or create the recipe yourself.";
            return new NutritionCommandResult(NutritionCommandStatus.ProviderUnavailable, AiDraft: ToAiDraftView(recordedOperation), Code: code, Message: message);
        }

        if (estimate.Amount > 0m && recordedOperation.CostAmount > decimal.Round(estimate.Amount, 4, MidpointRounding.ToPositiveInfinity))
        {
            recordedOperation.Fail("cost_limit");
            await dbContext.SaveChangesAsync(CancellationToken.None);
            return Conflict("ai_cost_limit", "The provider result would exceed the workspace AI cost policy; no draft was accepted.");
        }

        if (!TryValidateAiSchema(providerResult.RawOutput, out var validatedJson, out var uncertainJson))
        {
            recordedOperation.Fail("schema_invalid");
            await dbContext.SaveChangesAsync(CancellationToken.None);
            return Invalid("aiDraft", "The AI response failed the enforced meal-draft schema and was not persisted as a draft or nutrition fact.");
        }

        recordedOperation.AcceptValidatedDraft(providerResult.Model, providerResult.ModelVersion, validatedJson!, uncertainJson!, recordedOperation.CostAmount, recordedOperation.CostCurrency);
        await dbContext.SaveChangesAsync(CancellationToken.None);
        return new NutritionCommandResult(NutritionCommandStatus.Success, AiDraft: ToAiDraftView(recordedOperation));
    }

    private Task<int> LockAiBudgetAsync(CancellationToken cancellationToken)
    {
        var lockScope = "nutrition-ai-budget:" + tenantContext.TenantId;
        return dbContext.Database.ExecuteSqlAsync(
            $"SELECT pg_advisory_xact_lock(hashtextextended({lockScope}, 0))",
            cancellationToken);
    }

    public async Task<NutritionCommandResult> ReviewAiDraftAsync(Guid operationId, ReviewAiMealDraftRequest request, CancellationToken cancellationToken)
    {
        var operation = await dbContext.AiMealDraftOperations.SingleOrDefaultAsync(item => item.Id == operationId, cancellationToken);
        if (operation is null)
        {
            return NotFound();
        }

        // A second review answers as one made at the same moment does, whichever comes first (BEA-7).
        if (operation.Status is AiDraftStatus.Approved or AiDraftStatus.Rejected)
        {
            return AiReviewedElsewhere();
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
                return Conflict("ai_review_conflict", exception.PersonMessage());
            }
            catch (DbUpdateConcurrencyException)
            {
                return AiReviewedElsewhere();
            }
        }

        if (operation.Status != AiDraftStatus.AwaitingCoachReview || operation.ValidatedDraftJson is null || string.IsNullOrWhiteSpace(request.RecipeName) || string.IsNullOrWhiteSpace(request.Instructions) || request.Servings is null)
        {
            return Invalid("review", "Approval requires an awaiting-review draft plus coach-confirmed recipe name, instructions, servings, and ingredient mappings.");
        }

        // Every saved line is a food the coach chose (NUT-004). The coach may drop a suggested
        // ingredient or add one, as when matching any imported recipe; the operation keeps the
        // suggestion it was given beside the recipe version it became.
        if (request.IngredientMappings.Count == 0)
        {
            return Invalid("ingredientMappings", "Choose a food for at least one ingredient before saving the recipe.");
        }

        try
        {
            await EnsureRecipePhotoAsync(request.PhotoMediaAssetId, null, cancellationToken);
            var ingredientRequests = request.IngredientMappings.Select(item => new RecipeIngredientRequest(item.FoodItemVersionId, item.Quantity, item.Unit, item.Basis, item.YieldFactorId, item.RetentionFactorId)).ToArray();
            var inputs = await BuildRecipeIngredientsAsync(ingredientRequests, cancellationToken);
            var recipe = Recipe.Create(tenantContext.TenantId, request.RecipeName);
            var version = recipe.AddDraft(request.Instructions, request.Servings.Value, inputs, request.PhotoMediaAssetId, request.PrepMinutes, request.CookMinutes);
            if (request.Publish)
            {
                version.Publish(clock.UtcNow, RequireUserId());
            }

            dbContext.Recipes.Add(recipe);
            operation.Review(true, RequireUserId(), clock.UtcNow);
            await dbContext.SaveChangesAsync(cancellationToken);
            return new NutritionCommandResult(NutritionCommandStatus.Success, AiDraft: ToAiDraftView(operation, version.Id, recipe.Id));
        }
        catch (NutritionInputException exception)
        {
            return Invalid(exception.Field, exception.PersonMessage());
        }
        catch (ArgumentException exception)
        {
            return Invalid("review", exception.PersonMessage());
        }
        catch (DbUpdateConcurrencyException)
        {
            // Another approval or rejection saved first; its whole save, recipe included, is the one
            // kept, so no second recipe is made (BEA-7).
            return AiReviewedElsewhere();
        }
    }

    private static NutritionCommandResult AiReviewedElsewhere() =>
        Conflict("ai_review_conflict", "This suggestion was already reviewed in another tab or by another coach, so nothing was saved here.");

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
        var energyPolicy = EnergyFactorPolicies.For(settings.EnergyPolicyKey);
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

    /// <summary>
    /// A client that is not in this workspace is not found (SEC-8), exactly as another coach's client is
    /// answered by the tenant handler; a client whose Nutrition is closed is refused.
    /// </summary>
    private async Task<ClientNutritionReach> ReachClientAsync(Guid clientProfileId, CancellationToken cancellationToken)
    {
        if (!await dbContext.ClientProfiles.AsNoTracking().AnyAsync(item => item.Id == clientProfileId, cancellationToken))
        {
            return ClientNutritionReach.NotFound;
        }

        return (await GetNutritionAccessAsync(clientProfileId, cancellationToken)).IsAllowed
            ? ClientNutritionReach.Allowed
            : ClientNutritionReach.Forbidden;
    }

    private static NutritionCommandResult Refused(ClientNutritionReach reach) =>
        new(reach == ClientNutritionReach.NotFound ? NutritionCommandStatus.NotFound : NutritionCommandStatus.Forbidden);

    private Task<FeatureAccessDecision> GetNutritionAccessAsync(Guid clientProfileId, CancellationToken cancellationToken) =>
        featureAccessService.EvaluateAsync(tenantContext.TenantId, clientProfileId, CoachingFeature.Nutrition, cancellationToken);

    private async Task<ClientProfile?> FindSelfClientAsync(CancellationToken cancellationToken) =>
        currentUser.UserId is not { } userId ? null : await dbContext.ClientProfiles.CurrentFor(userId).SingleOrDefaultAsync(cancellationToken);

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

    private Task<string> MealPlanNameAsync(Guid mealPlanVersionId, CancellationToken cancellationToken) =>
        (from version in dbContext.MealPlanTemplateVersions.AsNoTracking()
         join template in dbContext.MealPlanTemplates.AsNoTracking()
             on new { version.TenantId, Id = version.MealPlanTemplateId } equals new { template.TenantId, template.Id }
         where version.Id == mealPlanVersionId
         select template.Name).SingleAsync(cancellationToken);

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

    /// <summary>The plan's recipe copies and their photos, by the recipe version each was copied from (R4.4d).</summary>
    private async Task<Dictionary<Guid, PlanRecipeRow>> LoadPlanRecipesAsync(Guid planId, CancellationToken cancellationToken) =>
        await dbContext.ClientNutritionPlanRecipes.AsNoTracking()
            .Where(item => item.ClientNutritionPlanId == planId)
            .Select(item => new { item.SourceRecipeVersionId, Row = new PlanRecipeRow(item.Id, item.PhotoMediaAssetId) })
            .ToDictionaryAsync(item => item.SourceRecipeVersionId, item => item.Row, cancellationToken);

    private sealed record PlanRecipeRow(Guid Id, Guid? PhotoMediaAssetId);

    private static ClientNutritionDayView ToDayView(DayQueryRow row, IReadOnlyList<ClientNutritionPlanSlot> slots, DailyNutritionLog? log, Dictionary<Guid, PlanRecipeRow> recipes)
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
                return new NutritionSlotView(slot.Id, slot.Name, slot.Order, slot.Choices.Select(choice => new NutritionChoiceView(choice.Id, choice.RecipeName, choice.Servings, choice.Calories, choice.ProteinGrams, choice.CarbohydrateGrams, choice.FatGrams, recipes.GetValueOrDefault(choice.SourceRecipeVersionId)?.Id, recipes.GetValueOrDefault(choice.SourceRecipeVersionId)?.PhotoMediaAssetId)).ToArray(), entry?.SelectedClientNutritionPlanChoiceId, entry?.Servings, entry?.Calories);
            }).ToArray(),
            log?.CustomFoods.Where(item => log.CustomFoodReversals.All(reversal => reversal.CustomFoodId != item.Id)).OrderBy(item => item.CreatedAtUtc).Select(item => new NutritionCustomFoodView(item.Id, item.Name, item.Amount, item.Unit, item.Calories, item.ProteinGrams, item.CarbohydrateGrams, item.FatGrams)).ToArray() ?? [],
            "Allergen declarations may be incomplete. Absence of a declared conflict is not evidence of absence; TB Gym does not assert any meal is safe.");
    }

    // Carbohydrate typed as an EU label prints it gets its fibre back, since total is what is kept (C6).
    private static FoodVersionInput ToFoodVersionInput(AddFoodVersionRequest request, NutritionWorkspaceSettings settings) =>
        new(request.BasisQuantity, request.BasisUnit, request.PreparationBasis, request.ProteinGrams,
            LabelCarbohydrateRule.TotalCarbohydrate(request.CarbohydrateGrams, request.FibreGrams, request.CarbohydrateDeclaration ?? CarbohydrateDeclaration.TotalWithFibre),
            request.FatGrams, request.FibreGrams, request.PolyolGrams, request.EthanolGrams, request.ProviderCalories, settings.EnergyPolicyKey, settings.ProviderCalorieTolerance, request.SourceAttribution, request.SourceRecordVersion, request.DeclaredAllergens);

    private NutritionWorkspaceSettingsView ToSettingsView(NutritionWorkspaceSettings settings) =>
        new(settings.EnergyPolicyKey, settings.EnergyPolicyVersion, settings.ProviderCalorieTolerance, settings.AiMonthlyRequestLimit, settings.AiMonthlyCostLimit, settings.AiCostCurrency, settings.Version,
            aiAllowance.Value.MaximumMonthlyRequests, aiAllowance.Value.MaximumMonthlyCostUsd);

    private static FoodItemView ToFoodView(FoodItem item)
    {
        var version = item.Versions.OrderByDescending(candidate => candidate.Revision).First();
        return new FoodItemView(item.Id, item.Name, item.Provenance, item.ExternalId, item.ExternalDataType, item.CurrentRevision, ToFoodVersionView(version), item.ArchivedAtUtc);
    }

    private static FoodVersionView ToFoodVersionView(FoodItemVersion item) =>
        new(item.Id, item.Revision, item.BasisQuantity, item.BasisUnit, item.PreparationBasis, item.ComputedCalories, item.ProviderCalories, item.HasCalorieDiscrepancy, item.ProteinGrams, item.CarbohydrateGrams, item.FatGrams, item.FibreGrams, item.PolyolGrams, item.EthanolGrams, item.EnergyPolicyKey, item.EnergyPolicyVersion, item.SourceAttribution, item.SourceRecordVersion, item.Allergens.Select(allergen => allergen.Code).Order().ToArray(), item.UnreportedNutrients, item.ReportedCarbohydrateGrams);

    private static CookingFactorView ToCookingFactorView(CookingFactorRecord item) =>
        new(item.Id, Enum.Parse<CookingFactorKind>(item.Kind), item.SourceKey, item.SourceVersion, item.FromBasis, item.ToBasis, item.Factor);

    private static RecipeSummary ToRecipeSummary(Recipe item, RecipeVersion version, Guid? publishedVersionId) =>
        new(item.Id, version.Id, version.Revision, item.Name, version.Status, version.Servings, version.Calories, version.ProteinGrams, version.CarbohydrateGrams, version.FatGrams, version.Allergens.Select(allergen => allergen.Code).Order().ToArray(), version.PhotoMediaAssetId, publishedVersionId);

    private static NutritionCommandResult RecipeChanged() =>
        Conflict("recipe_changed", "This recipe was saved again after you opened it. Reload it to see the newer version.");

    private static MealPlanTemplateSummary ToMealPlanSummary(MealPlanTemplate item, MealPlanTemplateVersion version, MealPlanDraftSummary? draft = null) =>
        new(
            item.Id,
            version.Id,
            version.Revision,
            item.Name,
            version.DayCount,
            version.Status,
            version.TargetCalories,
            version.Slots.Count,
            version.TargetProteinGrams,
            version.TargetCarbohydrateGrams,
            version.TargetFatGrams,
            version.PublishedAtUtc ?? version.CreatedAtUtc,
            draft);

    private static NutritionCalculationView ToCalculationView(NutritionCalculationSnapshot item, IReadOnlyList<string> warnings) =>
        new(item.Id, item.BmrMethodKey, item.BmrMethodVersion, item.BmrEstimate, item.ActivityModelKey, item.ActivityModelVersion, item.ActivityModelPal, item.TdeeMethodKey, item.TdeeMethodVersion, item.TdeeEstimate, item.CoachGoalAdjustment, item.CalorieTarget, item.ProteinGrams, item.CarbohydrateGrams, item.FatGrams, item.EnergyPolicyKey, item.EnergyPolicyVersion, warnings);

    private static NutritionCalculationRecord ToCalculationRecord(NutritionCalculationSnapshot item, MacroAdjustmentView? adjustment)
    {
        CalculateNutritionTargetsRequest? inputs = null;
        try
        {
            inputs = JsonSerializer.Deserialize<CalculateNutritionTargetsRequest>(item.InputJson, JsonOptions);
        }
        catch (JsonException)
        {
            // An older row whose numbers cannot be read back still lists its result.
        }

        // The warning depends only on numbers that were stored, so it is worked out again, never kept.
        // A coach's own macros are flagged on the same protein range, eating below what they burn when
        // the target is under the TDEE estimate.
        IReadOnlyList<string> warnings = [];
        if (inputs is not null)
        {
            try
            {
                warnings = item.MacroOverrideAuditId is null
                    ? MacroTargetCalculator.Calculate(new MacroTargetInput(item.CalorieTarget, item.ProteinGrams, inputs.FatPercentage, inputs.WeightKilograms, inputs.IsEnergyDeficit)).Warnings
                    : MacroTargetCalculator.ProteinWarnings(item.ProteinGrams, inputs.WeightKilograms, item.CalorieTarget < item.TdeeEstimate);
            }
            catch (ArgumentException)
            {
                // The result stays; only its warning is left out.
            }
        }

        return new NutritionCalculationRecord(ToCalculationView(item, warnings), inputs, item.CreatedAtUtc, adjustment);
    }

    private static AiMealDraftView ToAiDraftView(AiMealDraftOperation item, Guid? recipeVersionId = null, Guid? recipeId = null) =>
        new(item.Id, item.Status, item.PromptVersion, item.SchemaVersion, item.ProviderKey, item.Model, item.ModelVersion, item.ValidatedDraftJson, item.UncertainFieldsJson, item.FailureCode, item.CostAmount, item.CostCurrency, recipeVersionId, recipeId);

    private static string BuildProvenance(FoodItem food, FoodItemVersion version) =>
        $"{food.Provenance}; {version.SourceAttribution}; record version {version.SourceRecordVersion}";

    private static bool TryValidateAiSchema(string rawOutput, out string? validatedJson, out string? uncertainJson)
    {
        validatedJson = null;
        uncertainJson = null;
        if (rawOutput.Length > 100_000)
        {
            return false;
        }

        try
        {
            using var document = JsonDocument.Parse(rawOutput);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("name", out var nameElement) || nameElement.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(nameElement.GetString()) || nameElement.GetString()!.Length > 200 || !root.TryGetProperty("ingredients", out var ingredientsElement) || ingredientsElement.ValueKind != JsonValueKind.Array)
            {
                return false;
            }

            var ingredients = new List<ValidatedAiIngredient>();
            foreach (var element in ingredientsElement.EnumerateArray())
            {
                if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty("name", out var ingredientName) || ingredientName.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(ingredientName.GetString()) || ingredientName.GetString()!.Length > 200 || !element.TryGetProperty("quantity", out var quantity) || quantity.ValueKind != JsonValueKind.Number || !quantity.TryGetDecimal(out var value) || value is <= 0m or > 100_000m || !element.TryGetProperty("unit", out var unit) || unit.ValueKind != JsonValueKind.String || unit.GetString() is not ("g" or "ml" or "serving") || !element.TryGetProperty("uncertain", out var uncertain) || uncertain.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
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
