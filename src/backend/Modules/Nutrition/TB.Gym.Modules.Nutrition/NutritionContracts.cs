namespace TB.Gym.Modules.Nutrition;

public interface INutritionApplicationService
{
    Task<NutritionWorkspaceSettingsView> GetSettingsAsync(CancellationToken cancellationToken);
    Task<NutritionCommandResult> UpdateSettingsAsync(UpdateNutritionSettingsRequest request, CancellationToken cancellationToken);
    Task<FoodItemPage> ListFoodsAsync(string? query, int skip, int take, CancellationToken cancellationToken);
    Task<NutritionCommandResult> CreateFoodAsync(CreateFoodItemRequest request, CancellationToken cancellationToken);
    Task<NutritionCommandResult> AddFoodVersionAsync(Guid foodItemId, AddFoodVersionRequest request, CancellationToken cancellationToken);
    Task<ProviderFoodSearchPage> SearchUsdaAsync(string query, int skip, int take, CancellationToken cancellationToken);
    Task<NutritionCommandResult> ImportUsdaFoodAsync(ImportUsdaFoodRequest request, CancellationToken cancellationToken);
    Task<CookingFactorPage> ListCookingFactorsAsync(int skip, int take, CancellationToken cancellationToken);
    Task<NutritionCommandResult> CreateCookingFactorAsync(CreateCookingFactorRequest request, CancellationToken cancellationToken);
    Task<RecipePage> ListRecipesAsync(string? query, int skip, int take, CancellationToken cancellationToken);
    Task<NutritionCommandResult> CreateRecipeAsync(CreateRecipeRequest request, CancellationToken cancellationToken);
    Task<NutritionCommandResult> AddRecipeVersionAsync(Guid recipeId, AddRecipeVersionRequest request, CancellationToken cancellationToken);
    Task<NutritionCommandResult> PublishRecipeVersionAsync(Guid recipeVersionId, CancellationToken cancellationToken);
    Task<MealPlanTemplatePage> ListMealPlansAsync(int skip, int take, CancellationToken cancellationToken);
    Task<NutritionCommandResult> CreateMealPlanAsync(CreateMealPlanRequest request, CancellationToken cancellationToken);
    Task<NutritionCommandResult> AddMealPlanVersionAsync(Guid mealPlanTemplateId, AddMealPlanVersionRequest request, CancellationToken cancellationToken);
    Task<NutritionCommandResult> PublishMealPlanVersionAsync(Guid mealPlanVersionId, CancellationToken cancellationToken);
    Task<NutritionCommandResult> CalculateTargetsAsync(Guid clientProfileId, CalculateNutritionTargetsRequest request, CancellationToken cancellationToken);
    Task<NutritionCommandResult> OverrideMacrosAsync(Guid clientProfileId, Guid calculationSnapshotId, CreateMacroOverrideRequest request, CancellationToken cancellationToken);
    Task<NutritionCommandResult> ReplaceClientAllergensAsync(Guid clientProfileId, ReplaceClientAllergensRequest request, CancellationToken cancellationToken);
    Task<ClientNutritionPlanSummary[]?> ListClientPlansAsync(Guid clientProfileId, CancellationToken cancellationToken);
    Task<NutritionCommandResult> AssignPlanAsync(Guid clientProfileId, AssignNutritionPlanRequest request, CancellationToken cancellationToken);
    Task<NutritionCommandResult> CancelPlanAsync(Guid clientProfileId, Guid planId, CancelNutritionPlanRequest request, CancellationToken cancellationToken);
    Task<ClientNutritionDayView?> GetOwnDayAsync(DateOnly? localDate, CancellationToken cancellationToken);
    Task<NutritionCommandResult> RecordOwnChoiceAsync(RecordNutritionChoiceRequest request, CancellationToken cancellationToken);
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
    IReadOnlyList<AllergenCode> DeclaredAllergens);

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

public sealed record CreateRecipeRequest(string Name, string Instructions, decimal Servings, IReadOnlyList<RecipeIngredientRequest> Ingredients);

public sealed record AddRecipeVersionRequest(string Instructions, decimal Servings, IReadOnlyList<RecipeIngredientRequest> Ingredients);

public sealed record RecipeSummary(Guid Id, Guid VersionId, int Revision, string Name, PublicationStatus Status, decimal Servings, decimal Calories, decimal ProteinGrams, decimal CarbohydrateGrams, decimal FatGrams, IReadOnlyList<AllergenCode> DeclaredAllergens);

public sealed record RecipePage(int Total, int Skip, int Take, IReadOnlyList<RecipeSummary> Items);

public sealed record MealPlanChoiceRequest(Guid RecipeVersionId, decimal Servings);

public sealed record MealPlanSlotRequest(int DayOffset, int Order, string Name, IReadOnlyList<MealPlanChoiceRequest> Choices);

public sealed record CreateMealPlanRequest(string Name, int DayCount, decimal TargetCalories, decimal TargetProteinGrams, decimal TargetCarbohydrateGrams, decimal TargetFatGrams, IReadOnlyList<MealPlanSlotRequest> Slots);

public sealed record AddMealPlanVersionRequest(int DayCount, decimal TargetCalories, decimal TargetProteinGrams, decimal TargetCarbohydrateGrams, decimal TargetFatGrams, IReadOnlyList<MealPlanSlotRequest> Slots);

public sealed record MealPlanTemplateSummary(Guid Id, Guid VersionId, int Revision, string Name, int DayCount, PublicationStatus Status, decimal TargetCalories, int SlotCount);

public sealed record MealPlanTemplatePage(int Total, int Skip, int Take, IReadOnlyList<MealPlanTemplateSummary> Items);

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
    string SafetyNotice);

public sealed record RecordNutritionChoiceRequest(Guid PlanDayId, Guid PlanSlotId, Guid ChoiceId, decimal ActualServings, uint? DailyLogVersion);

public sealed record CompleteNutritionLogRequest(uint Version);

public sealed record GenerateAiMealDraftRequest(string Prompt, string PromptVersion, string Culture);

public sealed record AiIngredientMappingRequest(Guid FoodItemVersionId, decimal Quantity, FoodQuantityUnit Unit, PreparationBasis Basis, Guid? YieldFactorId = null, Guid? RetentionFactorId = null);

public sealed record ReviewAiMealDraftRequest(bool Approved, string Reason, string? RecipeName, string? Instructions, decimal? Servings, IReadOnlyList<AiIngredientMappingRequest> IngredientMappings);

public sealed record AiMealDraftView(Guid Id, AiDraftStatus Status, string PromptVersion, string SchemaVersion, string ProviderKey, string? Model, string? ModelVersion, string? ValidatedDraftJson, string? UncertainFieldsJson, string? FailureCode, decimal CostAmount, string CostCurrency, Guid? CreatedRecipeVersionId);

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
