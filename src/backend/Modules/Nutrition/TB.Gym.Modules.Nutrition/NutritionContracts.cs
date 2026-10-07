namespace TB.Gym.Modules.Nutrition;

public interface INutritionApplicationService
{
    AiMealDraftAvailabilityView GetAiAvailability();
    Task<NutritionWorkspaceSettingsView> GetSettingsAsync(CancellationToken cancellationToken);
    Task<NutritionCommandResult> UpdateSettingsAsync(UpdateNutritionSettingsRequest request, CancellationToken cancellationToken);
    Task<FoodItemPage> ListFoodsAsync(string? query, int skip, int take, CancellationToken cancellationToken);
    Task<NutritionCommandResult> CreateFoodAsync(CreateFoodItemRequest request, CancellationToken cancellationToken);
    Task<NutritionCommandResult> AddFoodVersionAsync(Guid foodItemId, AddFoodVersionRequest request, CancellationToken cancellationToken);
    Task<ProviderFoodSearchPage> SearchUsdaAsync(string query, int skip, int take, CancellationToken cancellationToken);
    Task<NutritionCommandResult> ImportUsdaFoodAsync(ImportUsdaFoodRequest request, CancellationToken cancellationToken);
    Task<CookingFactorPage> ListCookingFactorsAsync(int skip, int take, CancellationToken cancellationToken);
    Task<NutritionCommandResult> CreateCookingFactorAsync(CreateCookingFactorRequest request, CancellationToken cancellationToken);
    /// <param name="publishedOnly">
    /// Only recipes with a published version, each summarized at its newest published one: what a
    /// meal plan may hold (the meal-plan builder's recipe panel).
    /// </param>
    Task<RecipePage> ListRecipesAsync(string? query, int skip, int take, bool publishedOnly, CancellationToken cancellationToken);
    Task<RecipeDetail?> GetRecipeAsync(Guid recipeId, CancellationToken cancellationToken);
    Task<NutritionCommandResult> CreateRecipeAsync(CreateRecipeRequest request, CancellationToken cancellationToken);
    Task<NutritionCommandResult> AddRecipeVersionAsync(Guid recipeId, AddRecipeVersionRequest request, CancellationToken cancellationToken);
    Task<NutritionCommandResult> PublishRecipeVersionAsync(Guid recipeVersionId, CancellationToken cancellationToken);
    Task<MealPlanTemplatePage> ListMealPlansAsync(int skip, int take, CancellationToken cancellationToken);
    Task<NutritionCommandResult> CreateMealPlanAsync(CreateMealPlanRequest request, CancellationToken cancellationToken);
    Task<NutritionCommandResult> AddMealPlanVersionAsync(Guid mealPlanTemplateId, AddMealPlanVersionRequest request, CancellationToken cancellationToken);
    Task<NutritionCommandResult> PublishMealPlanVersionAsync(Guid mealPlanVersionId, CancellationToken cancellationToken);

    /// <summary>One meal plan with every version, newest first, and the caller's own draft of it.</summary>
    Task<MealPlanTemplateDetail?> GetMealPlanAsync(Guid mealPlanTemplateId, CancellationToken cancellationToken);

    /// <summary>One version's days and meals, with the recipes they name, for the builder.</summary>
    Task<MealPlanVersionView?> GetMealPlanVersionAsync(Guid mealPlanVersionId, CancellationToken cancellationToken);

    /// <summary>The caller's own meal-plan drafts in this workspace (NUT-013), newest change first.</summary>
    Task<IReadOnlyList<MealPlanDraftSummary>> ListMealPlanDraftsAsync(CancellationToken cancellationToken);

    /// <summary>One of the caller's own drafts with its content; null for anyone else's or none.</summary>
    Task<MealPlanDraftView?> GetMealPlanDraftAsync(Guid draftId, CancellationToken cancellationToken);

    Task<NutritionCommandResult> CreateMealPlanDraftAsync(CreateMealPlanDraftRequest request, CancellationToken cancellationToken);
    Task<NutritionCommandResult> SaveMealPlanDraftAsync(Guid draftId, SaveMealPlanDraftRequest request, CancellationToken cancellationToken);
    Task<NutritionCommandResult> DiscardMealPlanDraftAsync(Guid draftId, DiscardMealPlanDraftRequest request, CancellationToken cancellationToken);

    /// <summary>
    /// The draft becomes the plan's next version, published, and is removed, in one transaction; a
    /// new plan is created by its first Publish.
    /// </summary>
    Task<NutritionCommandResult> PublishMealPlanDraftAsync(Guid draftId, PublishMealPlanDraftRequest request, CancellationToken cancellationToken);
    Task<NutritionCommandResult> CalculateTargetsAsync(Guid clientProfileId, CalculateNutritionTargetsRequest request, CancellationToken cancellationToken);
    Task<NutritionCommandResult> OverrideMacrosAsync(Guid clientProfileId, Guid calculationSnapshotId, CreateMacroOverrideRequest request, CancellationToken cancellationToken);
    Task<NutritionCommandResult> ReplaceClientAllergensAsync(Guid clientProfileId, ReplaceClientAllergensRequest request, CancellationToken cancellationToken);
    Task<ClientNutritionPlanSummary[]?> ListClientPlansAsync(Guid clientProfileId, CancellationToken cancellationToken);
    Task<NutritionCommandResult> AssignPlanAsync(Guid clientProfileId, AssignNutritionPlanRequest request, CancellationToken cancellationToken);
    Task<NutritionCommandResult> CancelPlanAsync(Guid clientProfileId, Guid planId, CancelNutritionPlanRequest request, CancellationToken cancellationToken);
    Task<ClientNutritionDayView?> GetOwnDayAsync(DateOnly? localDate, CancellationToken cancellationToken);
    Task<NutritionCommandResult> RecordOwnChoiceAsync(RecordNutritionChoiceRequest request, CancellationToken cancellationToken);
    Task<NutritionCommandResult> AddOwnCustomFoodAsync(AddNutritionCustomFoodRequest request, CancellationToken cancellationToken);
    Task<NutritionCommandResult> ReverseOwnCustomFoodAsync(Guid foodId, ReverseNutritionCustomFoodRequest request, CancellationToken cancellationToken);
    Task<NutritionCommandResult> CompleteOwnLogAsync(Guid dailyLogId, CompleteNutritionLogRequest request, CancellationToken cancellationToken);
    Task<NutritionCommandResult> GenerateAiDraftAsync(GenerateAiMealDraftRequest request, CancellationToken cancellationToken);
    Task<NutritionCommandResult> ReviewAiDraftAsync(Guid operationId, ReviewAiMealDraftRequest request, CancellationToken cancellationToken);
}

public sealed record NutritionWorkspaceSettingsView(
    string EnergyPolicyKey,
    string EnergyPolicyVersion,
    decimal ProviderCalorieTolerance,
    int AiMonthlyRequestLimit,
    decimal AiMonthlyCostLimit,
    string AiCostCurrency,
    uint Version);

public sealed record UpdateNutritionSettingsRequest(
    string EnergyPolicyKey,
    decimal ProviderCalorieTolerance,
    int AiMonthlyRequestLimit,
    decimal AiMonthlyCostLimit,
    string AiCostCurrency,
    uint Version);

public sealed record CreateFoodItemRequest(
    string Name,
    FoodProvenance Provenance,
    string? ExternalId,
    string? ExternalDataType,
    Guid? LabelMediaAssetId,
    AddFoodVersionRequest Version);

public sealed record AddFoodVersionRequest(
    decimal BasisQuantity,
    FoodQuantityUnit BasisUnit,
    PreparationBasis PreparationBasis,
    decimal ProteinGrams,
    decimal CarbohydrateGrams,
    decimal FatGrams,
    decimal FibreGrams,
    decimal PolyolGrams,
    decimal EthanolGrams,
    decimal? ProviderCalories,
    string SourceAttribution,
    string SourceRecordVersion,
    IReadOnlyList<AllergenCode> DeclaredAllergens);

public sealed record FoodItemView(Guid Id, string Name, FoodProvenance Provenance, string? ExternalId, string? ExternalDataType, int CurrentRevision, FoodVersionView CurrentVersion);

public sealed record FoodVersionView(
    Guid Id,
    int Revision,
    decimal BasisQuantity,
    FoodQuantityUnit BasisUnit,
    PreparationBasis PreparationBasis,
    decimal ComputedCalories,
    decimal? ProviderCalories,
    bool HasCalorieDiscrepancy,
    decimal ProteinGrams,
    decimal CarbohydrateGrams,
    decimal FatGrams,
    decimal FibreGrams,
    decimal PolyolGrams,
    decimal EthanolGrams,
    string EnergyPolicyKey,
    string EnergyPolicyVersion,
    string SourceAttribution,
    string SourceRecordVersion,
    IReadOnlyList<AllergenCode> DeclaredAllergens,
    IReadOnlyList<UnreportedNutrient> UnreportedNutrients);

public sealed record FoodItemPage(int Total, int Skip, int Take, IReadOnlyList<FoodItemView> Items);

public sealed record ProviderFoodSearchPage(int Skip, int Take, IReadOnlyList<FoodSearchResult> Items, string? FailureCode = null, string? Message = null);

public sealed record ImportUsdaFoodRequest(string FdcId);

public enum CookingFactorKind
{
    Yield = 1,
    Retention = 2,
}

public sealed record CreateCookingFactorRequest(
    CookingFactorKind Kind,
    string SourceKey,
    string SourceVersion,
    PreparationBasis FromBasis,
    PreparationBasis ToBasis,
    decimal Factor);

public sealed record CookingFactorView(Guid Id, CookingFactorKind Kind, string SourceKey, string SourceVersion, PreparationBasis FromBasis, PreparationBasis ToBasis, decimal Factor);

public sealed record CookingFactorPage(int Total, int Skip, int Take, IReadOnlyList<CookingFactorView> Items);

public sealed record RecipeIngredientRequest(
    Guid FoodItemVersionId,
    decimal Quantity,
    FoodQuantityUnit Unit,
    PreparationBasis Basis,
    Guid? YieldFactorId = null,
    Guid? RetentionFactorId = null);

/// <param name="PhotoMediaAssetId">A recipe photo of this workspace the caller uploaded (MED-014).</param>
/// <param name="Publish">Publishes the first version in the same save, ready for meal plans.</param>
public sealed record CreateRecipeRequest(
    string Name,
    string Instructions,
    decimal Servings,
    IReadOnlyList<RecipeIngredientRequest> Ingredients,
    Guid? PhotoMediaAssetId = null,
    bool Publish = false);

/// <param name="Name">A new name for the recipe, or null to keep it.</param>
/// <param name="PhotoMediaAssetId">
/// The new version's photo: the caller's own upload or a photo an earlier version of this recipe has.
/// </param>
/// <param name="Publish">Publishes the new version in the same save.</param>
/// <param name="BaseRevision">
/// The newest revision the editor opened; another save since then is a conflict, not overwritten.
/// </param>
public sealed record AddRecipeVersionRequest(
    string Instructions,
    decimal Servings,
    IReadOnlyList<RecipeIngredientRequest> Ingredients,
    string? Name = null,
    Guid? PhotoMediaAssetId = null,
    bool Publish = false,
    int? BaseRevision = null);

/// <summary>A recipe at one of its versions, totals for the whole recipe.</summary>
/// <param name="PublishedVersionId">The newest published version, or null while none is published.</param>
public sealed record RecipeSummary(
    Guid Id,
    Guid VersionId,
    int Revision,
    string Name,
    PublicationStatus Status,
    decimal Servings,
    decimal Calories,
    decimal ProteinGrams,
    decimal CarbohydrateGrams,
    decimal FatGrams,
    IReadOnlyList<AllergenCode> DeclaredAllergens,
    Guid? PhotoMediaAssetId = null,
    Guid? PublishedVersionId = null);

/// <summary>One recipe for its editor (R4.4b): its newest version in full.</summary>
public sealed record RecipeDetail(
    Guid Id,
    string Name,
    int CurrentRevision,
    Guid? PublishedVersionId,
    RecipeVersionView Latest);

/// <summary>A recipe version with its ingredient lines; totals are for the whole recipe.</summary>
public sealed record RecipeVersionView(
    Guid Id,
    int Revision,
    PublicationStatus Status,
    DateTimeOffset? PublishedAtUtc,
    string Instructions,
    decimal Servings,
    decimal Calories,
    decimal ProteinGrams,
    decimal CarbohydrateGrams,
    decimal FatGrams,
    Guid? PhotoMediaAssetId,
    IReadOnlyList<AllergenCode> DeclaredAllergens,
    IReadOnlyList<RecipeIngredientView> Ingredients);

/// <summary>An ingredient line as saved: its food version, amount and what that amount holds.</summary>
public sealed record RecipeIngredientView(
    Guid FoodItemId,
    Guid FoodItemVersionId,
    string FoodName,
    FoodProvenance FoodProvenance,
    decimal Quantity,
    FoodQuantityUnit Unit,
    PreparationBasis Basis,
    decimal Calories,
    decimal ProteinGrams,
    decimal CarbohydrateGrams,
    decimal FatGrams,
    IReadOnlyList<AllergenCode> DeclaredAllergens,
    Guid? YieldFactorId,
    Guid? RetentionFactorId);

public sealed record RecipePage(int Total, int Skip, int Take, IReadOnlyList<RecipeSummary> Items);

public sealed record MealPlanChoiceRequest(Guid RecipeVersionId, decimal Servings);

public sealed record MealPlanSlotRequest(int DayOffset, int Order, string Name, IReadOnlyList<MealPlanChoiceRequest> Choices);

public sealed record CreateMealPlanRequest(string Name, int DayCount, decimal TargetCalories, decimal TargetProteinGrams, decimal TargetCarbohydrateGrams, decimal TargetFatGrams, IReadOnlyList<MealPlanSlotRequest> Slots);

public sealed record AddMealPlanVersionRequest(int DayCount, decimal TargetCalories, decimal TargetProteinGrams, decimal TargetCarbohydrateGrams, decimal TargetFatGrams, IReadOnlyList<MealPlanSlotRequest> Slots);

/// <summary>
/// A meal plan at its newest version. <paramref name="Draft"/> is the caller's own unpublished
/// changes to it (NUT-013), and only on the list and detail reads.
/// </summary>
public sealed record MealPlanTemplateSummary(
    Guid Id,
    Guid VersionId,
    int Revision,
    string Name,
    int DayCount,
    PublicationStatus Status,
    decimal TargetCalories,
    int SlotCount,
    decimal TargetProteinGrams = 0m,
    decimal TargetCarbohydrateGrams = 0m,
    decimal TargetFatGrams = 0m,
    DateTimeOffset? ChangedAtUtc = null,
    MealPlanDraftSummary? Draft = null);

public sealed record MealPlanTemplatePage(int Total, int Skip, int Take, IReadOnlyList<MealPlanTemplateSummary> Items);

public sealed record MealPlanTemplateDetail(
    Guid Id,
    string Name,
    int CurrentRevision,
    IReadOnlyList<MealPlanVersionSummary> Versions,
    MealPlanDraftSummary? Draft);

public sealed record MealPlanVersionSummary(
    Guid Id,
    int Revision,
    PublicationStatus Status,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset? PublishedAtUtc,
    int DayCount,
    decimal TargetCalories,
    int SlotCount);

/// <summary>
/// A version as the builder opens it: the daily targets and every day's meals in order, each choice
/// with the macros it was saved with, plus the recipes those choices name.
/// </summary>
public sealed record MealPlanVersionView(
    Guid Id,
    Guid MealPlanTemplateId,
    int Revision,
    PublicationStatus Status,
    int DayCount,
    decimal TargetCalories,
    decimal TargetProteinGrams,
    decimal TargetCarbohydrateGrams,
    decimal TargetFatGrams,
    IReadOnlyList<MealPlanVersionSlotView> Slots,
    IReadOnlyList<RecipeSummary> Recipes);

public sealed record MealPlanVersionSlotView(int DayOffset, int Order, string Name, IReadOnlyList<MealPlanVersionChoiceView> Choices);

public sealed record MealPlanVersionChoiceView(
    Guid RecipeVersionId,
    string RecipeName,
    decimal Servings,
    decimal Calories,
    decimal ProteinGrams,
    decimal CarbohydrateGrams,
    decimal FatGrams);

/// <param name="MealPlanTemplateId">The plan it changes; null to start a new plan.</param>
/// <param name="SourceVersionId">The version the builder opened; null for a new plan.</param>
/// <param name="TemplateRevision">The plan's newest revision as the builder read it; null for a new plan.</param>
public sealed record CreateMealPlanDraftRequest(
    Guid? MealPlanTemplateId,
    Guid? SourceVersionId,
    int? TemplateRevision,
    MealPlanDraftContent Content);

public sealed record SaveMealPlanDraftRequest(MealPlanDraftContent Content, uint Version);

public sealed record DiscardMealPlanDraftRequest(uint Version);

/// <param name="ReplaceNewer">
/// Publish even though someone published a version after this draft began; theirs stays in the
/// plan's versions.
/// </param>
public sealed record PublishMealPlanDraftRequest(uint Version, bool ReplaceNewer);

public sealed record MealPlanDraftSummary(
    Guid Id,
    Guid? MealPlanTemplateId,
    string Name,
    int DayCount,
    DateTimeOffset UpdatedAtUtc);

/// <param name="Recipes">
/// The recipes the content names, from this workspace's library, in whatever state they are now; an
/// id from anywhere else names nothing.
/// </param>
public sealed record MealPlanDraftView(
    Guid Id,
    Guid? MealPlanTemplateId,
    Guid? SourceVersionId,
    int StartedAtRevision,
    DateTimeOffset UpdatedAtUtc,
    uint Version,
    MealPlanDraftContent Content,
    IReadOnlyList<RecipeSummary> Recipes);

/// <summary>What a draft save answers: small, since the builder already holds the content.</summary>
public sealed record MealPlanDraftSaveView(Guid Id, DateTimeOffset UpdatedAtUtc, uint Version);

public sealed record CalculateNutritionTargetsRequest(
    string BmrMethodKey,
    decimal WeightKilograms,
    decimal HeightCentimeters,
    int AgeYears,
    FormulaSex Sex,
    decimal? BodyFatPercentage,
    OccupationActivityType OccupationType,
    int AverageDailySteps,
    decimal CoachGoalAdjustment,
    decimal? CalorieTarget,
    decimal ProteinGrams,
    decimal FatPercentage,
    bool IsEnergyDeficit);

public sealed record NutritionCalculationView(
    Guid Id,
    string BmrMethodKey,
    string BmrMethodVersion,
    decimal BmrEstimate,
    string ActivityModelKey,
    string ActivityModelVersion,
    decimal ActivityModelPal,
    string TdeeMethodKey,
    string TdeeMethodVersion,
    decimal TdeeEstimate,
    decimal CoachGoalAdjustment,
    decimal CalorieTarget,
    decimal ProteinGrams,
    decimal CarbohydrateGrams,
    decimal FatGrams,
    string EnergyPolicyKey,
    string EnergyPolicyVersion,
    IReadOnlyList<string> Warnings);

public sealed record CreateMacroOverrideRequest(decimal ProteinGrams, decimal FatGrams, decimal CarbohydrateGrams, string Reason);

public sealed record MacroOverrideView(Guid Id, Guid CalculationSnapshotId, decimal ProteinGrams, decimal FatGrams, decimal CarbohydrateGrams, string Reason, Guid ActorUserId);

public sealed record ReplaceClientAllergensRequest(IReadOnlyList<AllergenCode> Codes);

public sealed record AssignNutritionPlanRequest(Guid MealPlanTemplateVersionId, Guid EnrollmentId, Guid CalculationSnapshotId, DateOnly StartDate, bool AcknowledgeAllergenWarnings);

public sealed record CancelNutritionPlanRequest(string Reason, uint Version);

public sealed record ClientNutritionPlanSummary(Guid Id, Guid SourceMealPlanTemplateVersionId, Guid EnrollmentId, DateOnly StartDate, DateOnly EndDateExclusive, decimal CalorieTarget, ClientNutritionPlanStatus Status, uint Version);

public sealed record NutritionChoiceView(Guid Id, string RecipeName, decimal Servings, decimal Calories, decimal ProteinGrams, decimal CarbohydrateGrams, decimal FatGrams);

public sealed record NutritionSlotView(Guid Id, string Name, int Order, IReadOnlyList<NutritionChoiceView> Choices, Guid? SelectedChoiceId, decimal? ActualServings);

public sealed record NutritionCustomFoodView(Guid Id, string Name, decimal Amount, FoodQuantityUnit Unit, decimal Calories, decimal ProteinGrams, decimal CarbohydrateGrams, decimal FatGrams);

public sealed record ClientNutritionDayView(
    Guid PlanId,
    Guid PlanDayId,
    DateOnly Date,
    decimal TargetCalories,
    decimal TargetProteinGrams,
    decimal TargetCarbohydrateGrams,
    decimal TargetFatGrams,
    Guid? DailyLogId,
    uint? DailyLogVersion,
    DailyNutritionLogStatus? LogStatus,
    decimal SelectedCalories,
    decimal SelectedProteinGrams,
    decimal SelectedCarbohydrateGrams,
    decimal SelectedFatGrams,
    IReadOnlyList<NutritionSlotView> Slots,
    IReadOnlyList<NutritionCustomFoodView> CustomFoods,
    string SafetyNotice);

public sealed record RecordNutritionChoiceRequest(Guid PlanDayId, Guid PlanSlotId, Guid ChoiceId, decimal ActualServings, uint? DailyLogVersion);

public sealed record AddNutritionCustomFoodRequest(Guid PlanDayId, string Name, decimal Amount, FoodQuantityUnit Unit, decimal Calories, decimal ProteinGrams, decimal CarbohydrateGrams, decimal FatGrams, uint? DailyLogVersion);

public sealed record ReverseNutritionCustomFoodRequest(uint DailyLogVersion);

public sealed record CompleteNutritionLogRequest(uint Version);

public sealed record GenerateAiMealDraftRequest(string Prompt, string PromptVersion, string Culture);

public sealed record AiMealDraftAvailabilityView(bool IsConfigured);

public sealed record AiIngredientMappingRequest(Guid FoodItemVersionId, decimal Quantity, FoodQuantityUnit Unit, PreparationBasis Basis, Guid? YieldFactorId = null, Guid? RetentionFactorId = null);

/// <param name="IngredientMappings">
/// The recipe's lines as the coach saves them, each a food the coach chose; the coach may drop a
/// suggested ingredient or add one (NUT-004).
/// </param>
public sealed record ReviewAiMealDraftRequest(
    bool Approved,
    string Reason,
    string? RecipeName,
    string? Instructions,
    decimal? Servings,
    IReadOnlyList<AiIngredientMappingRequest> IngredientMappings,
    Guid? PhotoMediaAssetId = null,
    bool Publish = false);

/// <param name="CreatedRecipeId">The recipe an approval saved, so the editor can open it.</param>
public sealed record AiMealDraftView(Guid Id, AiDraftStatus Status, string PromptVersion, string SchemaVersion, string ProviderKey, string? Model, string? ModelVersion, string? ValidatedDraftJson, string? UncertainFieldsJson, string? FailureCode, decimal CostAmount, string CostCurrency, Guid? CreatedRecipeVersionId, Guid? CreatedRecipeId = null);

public sealed record NutritionCommandResult(
    NutritionCommandStatus Status,
    NutritionWorkspaceSettingsView? Settings = null,
    FoodItemView? Food = null,
    RecipeSummary? Recipe = null,
    MealPlanTemplateSummary? MealPlan = null,
    NutritionCalculationView? Calculation = null,
    CookingFactorView? CookingFactor = null,
    MacroOverrideView? MacroOverride = null,
    ClientNutritionPlanSummary? ClientPlan = null,
    ClientNutritionDayView? Day = null,
    AiMealDraftView? AiDraft = null,
    MealPlanDraftSaveView? MealPlanDraft = null,
    IReadOnlyDictionary<string, string[]>? Errors = null,
    string? Code = null,
    string? Message = null);

public enum NutritionCommandStatus
{
    Success = 1,
    NotFound = 2,
    Forbidden = 3,
    Invalid = 4,
    Conflict = 5,
    ProviderUnavailable = 6,
}
