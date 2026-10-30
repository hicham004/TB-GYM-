namespace TB.Gym.Modules.Nutrition;

public interface INutritionApplicationService
{
    AiMealDraftAvailabilityView GetAiAvailability();
    Task<NutritionWorkspaceSettingsView> GetSettingsAsync(CancellationToken cancellationToken);
    Task<NutritionCommandResult> UpdateSettingsAsync(UpdateNutritionSettingsRequest request, CancellationToken cancellationToken);
    Task<FoodItemPage> ListFoodsAsync(string? query, bool archived, int skip, int take, CancellationToken cancellationToken);
    Task<NutritionCommandResult> CreateFoodAsync(CreateFoodItemRequest request, CancellationToken cancellationToken);
    Task<NutritionCommandResult> AddFoodVersionAsync(Guid foodItemId, AddFoodVersionRequest request, CancellationToken cancellationToken);
    Task<NutritionCommandResult> SetFoodArchivedAsync(Guid foodItemId, SetFoodArchivedRequest request, CancellationToken cancellationToken);
    Task<ProviderFoodSearchPage> SearchUsdaAsync(string query, FoodSearchKind kind, int skip, int take, CancellationToken cancellationToken);
    Task<NutritionCommandResult> ImportUsdaFoodAsync(ImportUsdaFoodRequest request, CancellationToken cancellationToken);

    /// <summary>
    /// The workspace's raw-to-cooked conversions (NUT-001, audit INV-6), each a yield and a retention factor
    /// under one name and source, by name; with <paramref name="query"/>, those whose name or source holds
    /// every word of it.
    /// </summary>
    Task<CookingConversionPage> ListCookingConversionsAsync(string? query, int skip, int take, CancellationToken cancellationToken);

    /// <summary>
    /// A conversion's two factors, saved together. The same name, source and numbers again answer with the
    /// conversion saved first; other numbers under the same name and source are refused, never replaced.
    /// </summary>
    Task<NutritionCommandResult> CreateCookingConversionAsync(CreateCookingConversionRequest request, CancellationToken cancellationToken);
    /// <param name="publishedOnly">
    /// Only recipes with a published version, each summarized at its newest published one: what a
    /// meal plan may hold (the meal-plan builder's recipe panel).
    /// </param>
    /// <param name="status">
    /// The Recipes page's filter (critique B5c2), each recipe still summarized at its newest version: those
    /// with a published version, or the drafts, never published.
    /// </param>
    Task<RecipePage> ListRecipesAsync(string? query, int skip, int take, bool publishedOnly, RecipeListStatus status, CancellationToken cancellationToken);
    Task<RecipeDetail?> GetRecipeAsync(Guid recipeId, CancellationToken cancellationToken);
    Task<NutritionCommandResult> CreateRecipeAsync(CreateRecipeRequest request, CancellationToken cancellationToken);
    Task<NutritionCommandResult> AddRecipeVersionAsync(Guid recipeId, AddRecipeVersionRequest request, CancellationToken cancellationToken);
    Task<NutritionCommandResult> PublishRecipeVersionAsync(Guid recipeVersionId, CancellationToken cancellationToken);

    /// <summary>
    /// The caller's own recipe drafts in this workspace (NUT-014, critique B5d), newest change first; with
    /// <paramref name="query"/>, those whose name holds every word of it.
    /// </summary>
    Task<IReadOnlyList<RecipeDraftSummary>> ListRecipeDraftsAsync(string? query, CancellationToken cancellationToken);

    /// <summary>One of the caller's own recipe drafts with its content; null for anyone else's or none.</summary>
    Task<RecipeDraftView?> GetRecipeDraftAsync(Guid draftId, CancellationToken cancellationToken);

    Task<NutritionCommandResult> CreateRecipeDraftAsync(CreateRecipeDraftRequest request, CancellationToken cancellationToken);
    Task<NutritionCommandResult> SaveRecipeDraftAsync(Guid draftId, SaveRecipeDraftRequest request, CancellationToken cancellationToken);
    Task<NutritionCommandResult> DiscardRecipeDraftAsync(Guid draftId, DiscardRecipeDraftRequest request, CancellationToken cancellationToken);

    /// <summary>
    /// The draft becomes the recipe's next version, checked by every rule a save has, published or kept as
    /// a draft version, and is removed, in one transaction; a new recipe is created by its first version and
    /// approves the AI suggestion it began from.
    /// </summary>
    Task<NutritionCommandResult> PublishRecipeDraftAsync(Guid draftId, PublishRecipeDraftRequest request, CancellationToken cancellationToken);
    Task<MealPlanTemplatePage> ListMealPlansAsync(int skip, int take, CancellationToken cancellationToken);

    /// <summary>
    /// A meal plan with an unpublished version 1, which the demo workspace generator then publishes with
    /// <see cref="PublishMealPlanVersionAsync"/>. No route calls either: people make meal plans by
    /// publishing a draft (NUT-013, audit INV-12).
    /// </summary>
    Task<NutritionCommandResult> CreateMealPlanAsync(CreateMealPlanRequest request, CancellationToken cancellationToken);
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

    /// <summary>What new calculations work energy out with (critique B8a), so the targets sheet asks for what it takes.</summary>
    EnergyModelView GetEnergyModel();

    /// <summary>
    /// The targets sheet's numbers so far, worked out as Work out would and recorded nowhere: the multiplier and the
    /// words beside it, what their steps are worth, and each goal's rate and share (critique B8a). Energy version 2's
    /// alone: while version 1 is in force it is refused.
    /// </summary>
    NutritionCommandResult PreviewEnergy(PreviewEnergyRequest request);

    /// <summary>
    /// The macro split (NUT-008) for a meal plan's daily target, worked out and recorded nowhere: what
    /// "Fill in fat and carbs" writes into the builder's boxes (critique B5c2).
    /// </summary>
    NutritionCommandResult PreviewMacroSplit(decimal? calorieTarget, decimal? proteinGrams, decimal? fatPercentage, decimal? bodyweightKilograms, bool isEnergyDeficit);

    /// <summary>
    /// The caller's current clients whose Nutrition is open, each with their latest targets (critique
    /// B5c2): a coach's own, every client for the owner (ADR 0026).
    /// </summary>
    Task<ClientTargetsList> ListClientTargetsAsync(CancellationToken cancellationToken);
    Task<NutritionCommandResult> OverrideMacrosAsync(Guid clientProfileId, Guid calculationSnapshotId, CreateMacroOverrideRequest request, CancellationToken cancellationToken);
    Task<NutritionCommandResult> ReplaceClientAllergensAsync(Guid clientProfileId, ReplaceClientAllergensRequest request, CancellationToken cancellationToken);

    /// <summary>The allergens declared for the client now (R5.3d).</summary>
    Task<ClientNutritionRead<ClientAllergensView>> GetClientAllergensAsync(Guid clientProfileId, CancellationToken cancellationToken);

    /// <summary>
    /// The targets worked out for the client, newest first, with what each was worked out from (R5.3d)
    /// and, for a coach's own macros, what they changed (INV-2).
    /// </summary>
    Task<ClientNutritionRead<NutritionCalculationRecord[]>> ListCalculationsAsync(Guid clientProfileId, int take, CancellationToken cancellationToken);

    /// <summary>Every meal plan assigned to the client, newest start first, a stopped one with why (NCM-1).</summary>
    Task<ClientNutritionRead<ClientNutritionPlanSummary[]>> ListClientPlansAsync(Guid clientProfileId, CancellationToken cancellationToken);
    Task<NutritionCommandResult> AssignPlanAsync(Guid clientProfileId, AssignNutritionPlanRequest request, CancellationToken cancellationToken);
    Task<NutritionCommandResult> CancelPlanAsync(Guid clientProfileId, Guid planId, CancelNutritionPlanRequest request, CancellationToken cancellationToken);
    Task<ClientNutritionDayView?> GetOwnDayAsync(DateOnly? localDate, CancellationToken cancellationToken);

    /// <summary>A recipe in the caller's own current plan, as it was copied there (R4.4d); null otherwise.</summary>
    Task<ClientPlanRecipeView?> GetOwnRecipeAsync(Guid recipeId, CancellationToken cancellationToken);
    Task<NutritionCommandResult> RecordOwnChoiceAsync(RecordNutritionChoiceRequest request, CancellationToken cancellationToken);
    Task<NutritionCommandResult> AddOwnCustomFoodAsync(AddNutritionCustomFoodRequest request, CancellationToken cancellationToken);
    Task<NutritionCommandResult> ReverseOwnCustomFoodAsync(Guid foodId, ReverseNutritionCustomFoodRequest request, CancellationToken cancellationToken);
    Task<NutritionCommandResult> CompleteOwnLogAsync(Guid dailyLogId, CompleteNutritionLogRequest request, CancellationToken cancellationToken);
    Task<NutritionCommandResult> GenerateAiDraftAsync(GenerateAiMealDraftRequest request, CancellationToken cancellationToken);
    Task<NutritionCommandResult> ReviewAiDraftAsync(Guid operationId, ReviewAiMealDraftRequest request, CancellationToken cancellationToken);
}

/// <param name="AiMaximumMonthlyRequests">TB Gym's ceiling on the workspace's allowance (R4.4c); the
/// allowance in use is the lower of the two.</param>
/// <param name="AiMaximumMonthlyCost">The same ceiling's monthly cost, in USD.</param>
public sealed record NutritionWorkspaceSettingsView(
    string EnergyPolicyKey,
    string EnergyPolicyVersion,
    decimal ProviderCalorieTolerance,
    int AiMonthlyRequestLimit,
    decimal AiMonthlyCostLimit,
    string AiCostCurrency,
    uint Version,
    int AiMaximumMonthlyRequests,
    decimal AiMaximumMonthlyCost);

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

/// <param name="Name">A new version of a food may rename it (R4.4c); recipes keep the name they
/// copied. Creating a food names it on <see cref="CreateFoodItemRequest"/>, so this one is not read
/// there.</param>
/// <param name="BaseRevision">The revision the editor opened; a version saved since then is a
/// conflict (<c>food_changed</c>), not overwritten.</param>
/// <param name="CarbohydrateDeclaration">How <paramref name="CarbohydrateGrams"/> was typed: total, as
/// US labels print it (the default), or without fibre, as EU labels do, in which case the fibre is
/// added back before it is saved (C6, <see cref="LabelCarbohydrateRule"/>).</param>
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
    IReadOnlyList<AllergenCode> DeclaredAllergens,
    string? Name = null,
    int? BaseRevision = null,
    CarbohydrateDeclaration? CarbohydrateDeclaration = null);

/// <param name="ArchivedAtUtc">Set while the food is archived (R4.4c): out of Foods and the ingredient
/// search, still in every recipe and plan that copied it.</param>
public sealed record FoodItemView(Guid Id, string Name, FoodProvenance Provenance, string? ExternalId, string? ExternalDataType, int CurrentRevision, FoodVersionView CurrentVersion, DateTimeOffset? ArchivedAtUtc = null);

/// <summary>Archives a food, or restores an archived one. Doing either twice changes nothing.</summary>
public sealed record SetFoodArchivedRequest(bool IsArchived);

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
    IReadOnlyList<UnreportedNutrient> UnreportedNutrients,
    decimal? ReportedCarbohydrateGrams = null);

public sealed record FoodItemPage(int Total, int Skip, int Take, IReadOnlyList<FoodItemView> Items);

public sealed record ProviderFoodSearchPage(int Skip, int Take, IReadOnlyList<FoodSearchResult> Items, string? FailureCode = null, string? Message = null);

public sealed record ImportUsdaFoodRequest(string FdcId);

public enum CookingFactorKind
{
    Yield = 1,
    Retention = 2,
}

public sealed record CookingFactorView(Guid Id, CookingFactorKind Kind, string SourceKey, string SourceVersion, PreparationBasis FromBasis, PreparationBasis ToBasis, decimal Factor);

/// <summary>
/// A raw-to-cooked conversion (NUT-001, ADR 0008): the yield factor that makes a raw weight a cooked one and
/// the retention factor for the share of protein, carbs and fat that survives, applied in that order. A coach
/// names what it is for, its source key ("White rice, boiled"), and where its numbers come from, its source
/// version ("USDA cooking yields, 2014"); TB Gym seeds none (audit INV-6).
/// </summary>
public sealed record CookingConversionView(string SourceKey, string SourceVersion, CookingFactorView Yield, CookingFactorView Retention);

public sealed record CookingConversionPage(int Total, int Skip, int Take, IReadOnlyList<CookingConversionView> Items);

/// <param name="YieldFactor">Grams cooked per gram raw, above 0 and at most 5 (rice and burghul near 3).</param>
/// <param name="RetentionFactor">The share of protein, carbs and fat kept, above 0 and at most 1.</param>
public sealed record CreateCookingConversionRequest(string SourceKey, string SourceVersion, decimal YieldFactor, decimal RetentionFactor);

public sealed record RecipeIngredientRequest(
    Guid FoodItemVersionId,
    decimal Quantity,
    FoodQuantityUnit Unit,
    PreparationBasis Basis,
    Guid? YieldFactorId = null,
    Guid? RetentionFactorId = null);

/// <param name="PhotoMediaAssetId">A recipe photo of this workspace the caller uploaded (MED-014).</param>
/// <param name="Publish">Publishes the first version in the same save, ready for meal plans.</param>
/// <param name="PrepMinutes">Minutes of preparation (0 to 2,880), or null when not given.</param>
/// <param name="CookMinutes">Minutes of cooking (0 to 2,880), or null when not given.</param>
public sealed record CreateRecipeRequest(
    string Name,
    string Instructions,
    decimal Servings,
    IReadOnlyList<RecipeIngredientRequest> Ingredients,
    Guid? PhotoMediaAssetId = null,
    bool Publish = false,
    int? PrepMinutes = null,
    int? CookMinutes = null);

/// <param name="Name">A new name for the recipe, or null to keep it.</param>
/// <param name="PhotoMediaAssetId">
/// The new version's photo: the caller's own upload or a photo an earlier version of this recipe has.
/// </param>
/// <param name="Publish">Publishes the new version in the same save.</param>
/// <param name="BaseRevision">
/// The newest revision the editor opened; another save since then is a conflict, not overwritten.
/// </param>
/// <param name="PrepMinutes">Minutes of preparation (0 to 2,880), or null when not given.</param>
/// <param name="CookMinutes">Minutes of cooking (0 to 2,880), or null when not given.</param>
public sealed record AddRecipeVersionRequest(
    string Instructions,
    decimal Servings,
    IReadOnlyList<RecipeIngredientRequest> Ingredients,
    string? Name = null,
    Guid? PhotoMediaAssetId = null,
    bool Publish = false,
    int? BaseRevision = null,
    int? PrepMinutes = null,
    int? CookMinutes = null);

/// <summary>A recipe at one of its versions, totals for the whole recipe.</summary>
/// <param name="PublishedVersionId">The newest published version, or null while none is published.</param>
/// <param name="Draft">The caller's own changes to it not made a version yet (NUT-014), on the Recipes page's read only.</param>
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
    Guid? PublishedVersionId = null,
    RecipeDraftSummary? Draft = null);

/// <summary>One recipe for its editor (R4.4b): its newest version in full.</summary>
/// <param name="Draft">The caller's own changes to it not made a version yet (NUT-014), which the editor opens instead.</param>
public sealed record RecipeDetail(
    Guid Id,
    string Name,
    int CurrentRevision,
    Guid? PublishedVersionId,
    RecipeVersionView Latest,
    RecipeDraftSummary? Draft = null);

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
    IReadOnlyList<RecipeIngredientView> Ingredients,
    int? PrepMinutes = null,
    int? CookMinutes = null);

/// <summary>An ingredient line as saved: its food version, amount and what that amount holds.</summary>
/// <param name="NewerFood">The food as it is now when it was edited since the line copied it, so the
/// editor can offer its new numbers (R4.4c); null while the line has the food's current version.</param>
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
    Guid? RetentionFactorId,
    FoodItemView? NewerFood = null,
    CookingFactorView? YieldFactor = null,
    CookingFactorView? RetentionFactor = null);

/// <param name="Total">How many recipes match the search and the status asked for.</param>
/// <param name="Counts">How many match the search in each status, whichever was asked for.</param>
public sealed record RecipePage(int Total, int Skip, int Take, IReadOnlyList<RecipeSummary> Items, RecipeListCounts Counts);

/// <summary>
/// The Recipes page's filter (critique B5c2): every recipe, those with a published version, which meal
/// plans may use, or the drafts, never published.
/// </summary>
public enum RecipeListStatus
{
    All = 1,
    Published = 2,
    Drafts = 3,
}

/// <summary>"All · Published · Drafts (n)": every recipe matching the search, split by whether it has a published version.</summary>
public sealed record RecipeListCounts(int All, int Published, int Drafts);

/// <param name="RecipeId">The recipe it changes; null to start a new recipe.</param>
/// <param name="RecipeRevision">The recipe's newest revision as the editor read it; null for a new recipe.</param>
public sealed record CreateRecipeDraftRequest(Guid? RecipeId, int? RecipeRevision, RecipeDraftContent Content);

public sealed record SaveRecipeDraftRequest(RecipeDraftContent Content, uint Version);

public sealed record DiscardRecipeDraftRequest(uint Version);

/// <param name="ReplaceNewer">
/// Make the version even though someone saved one after this draft began; theirs stays in the recipe's
/// history.
/// </param>
/// <param name="KeepAsDraft">
/// Save as draft: the version is complete but not published, the shared Draft the team sees and meal
/// plans do not use (critique B5d keeps it beside the private draft).
/// </param>
public sealed record PublishRecipeDraftRequest(uint Version, bool ReplaceNewer, bool KeepAsDraft = false);

/// <param name="Name">The name as typed, trimmed; it may be empty.</param>
/// <param name="PhotoMediaAssetId">The photo the draft names, for its card's thumbnail.</param>
public sealed record RecipeDraftSummary(
    Guid Id,
    Guid? RecipeId,
    string Name,
    int LineCount,
    Guid? PhotoMediaAssetId,
    DateTimeOffset UpdatedAtUtc);

/// <param name="Foods">
/// The food versions the lines name, from this workspace's foods, each with the food as it is now when it
/// was edited since; an id from anywhere else names nothing.
/// </param>
/// <param name="CookingFactors">The yield and retention factors the lines name, from this workspace.</param>
public sealed record RecipeDraftView(
    Guid Id,
    Guid? RecipeId,
    int StartedAtRevision,
    DateTimeOffset UpdatedAtUtc,
    uint Version,
    RecipeDraftContent Content,
    IReadOnlyList<RecipeDraftFoodView> Foods,
    IReadOnlyList<CookingFactorView> CookingFactors);

/// <summary>A food version a draft's line names, under the food's name now, and the food now when newer.</summary>
public sealed record RecipeDraftFoodView(
    Guid FoodItemId,
    string Name,
    FoodProvenance Provenance,
    FoodVersionView Version,
    FoodItemView? NewerFood);

/// <summary>What a draft save answers: small, since the editor already holds the content.</summary>
public sealed record RecipeDraftSaveView(Guid Id, DateTimeOffset UpdatedAtUtc, uint Version);

public sealed record MealPlanChoiceRequest(Guid RecipeVersionId, decimal Servings);

public sealed record MealPlanSlotRequest(int DayOffset, int Order, string Name, IReadOnlyList<MealPlanChoiceRequest> Choices);

public sealed record CreateMealPlanRequest(string Name, int DayCount, decimal TargetCalories, decimal TargetProteinGrams, decimal TargetCarbohydrateGrams, decimal TargetFatGrams, IReadOnlyList<MealPlanSlotRequest> Slots);

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
/// <param name="TargetFatPercentage">
/// The share of the calories the fat was filled in at, when the fat and carbohydrate are the macro
/// split's (NUT-008, critique B5c2), with the split that worked them out; all three null when typed.
/// </param>
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
    IReadOnlyList<RecipeSummary> Recipes,
    decimal? TargetFatPercentage,
    string? TargetMacroMethodKey,
    string? TargetMacroMethodVersion);

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

/// <param name="OccupationType">The kinds of work the energy model in force takes (<see cref="EnergyModelView.KindsOfWork"/>).</param>
/// <param name="WorkoutsPerWeek">Energy version 2 only, and required there: 0 to 7, as the sheet sent it (critique B8a).</param>
/// <param name="ChosenPal">
/// Energy version 2 only: the coach's own multiplier in place of the table's (<see cref="CoachChosenPal"/>), 1.40 to 2.40.
/// </param>
/// <param name="ChosenPalReason">Why the coach chose it, at most 500 characters; only with <paramref name="ChosenPal"/>.</param>
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
    bool IsEnergyDeficit,
    int? WorkoutsPerWeek = null,
    decimal? ChosenPal = null,
    string? ChosenPalReason = null);

/// <param name="Activity">
/// The words beside the multiplier and their parts, for a multiplier energy version 2 made (its table, or the coach's
/// own); null for version 1's.
/// </param>
/// <param name="Walking">What their steps are worth, inside the multiplier (<see cref="WalkingCost"/>), while energy version 2 is in force.</param>
/// <param name="Goal">The goal's rate and share (<see cref="WeeklyWeightChange"/>), while energy version 2 is in force.</param>
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
    IReadOnlyList<string> Warnings,
    ActivityWords? Activity = null,
    WalkingWords? Walking = null,
    GoalRate? Goal = null);

/// <summary>
/// What new calculations work energy out with (critique B8a, NUT-015), so the targets sheet asks for what that model
/// takes: version 1 until B8c switches version 2 on.
/// </summary>
/// <param name="MaximumWorkoutsPerWeek">Version 2's: workouts a week go from 0 to this; null for version 1, which takes none.</param>
/// <param name="CoachChosen">Version 2's "Or choose the multiplier yourself"; null for version 1.</param>
public sealed record EnergyModelView(
    int Version,
    string ActivityModelKey,
    string ActivityModelVersion,
    IReadOnlyList<OccupationActivityType> KindsOfWork,
    int? MaximumWorkoutsPerWeek,
    CoachChosenPalView? CoachChosen);

/// <summary>The coach's own multiplier (<see cref="CoachChosenPal"/>): the picks in plain words, and the range a typed one keeps to.</summary>
public sealed record CoachChosenPalView(string MethodKey, string MethodVersion, decimal Minimum, decimal Maximum, IReadOnlyList<CoachPalPick> Picks);

/// <summary>
/// What the targets sheet has so far (critique B8a): every number optional, since the coach is still typing. The
/// preview works out what it can from what is there, as Work out would, and records nothing.
/// </summary>
/// <param name="GoalAdjustments">The goals to give a rate and share for, the sheet's picks and the one typed: at most 10.</param>
public sealed record PreviewEnergyRequest(
    string? BmrMethodKey = null,
    decimal? WeightKilograms = null,
    decimal? HeightCentimeters = null,
    int? AgeYears = null,
    FormulaSex? Sex = null,
    decimal? BodyFatPercentage = null,
    OccupationActivityType? OccupationType = null,
    int? AverageDailySteps = null,
    int? WorkoutsPerWeek = null,
    decimal? ChosenPal = null,
    IReadOnlyList<decimal>? GoalAdjustments = null);

/// <summary>What the targets sheet's numbers come to so far, worked out and recorded nowhere (critique B8a).</summary>
/// <param name="Activity">The multiplier and the words beside it, once the kind of work, the steps and the workouts are in.</param>
/// <param name="Walking">What their steps are worth, once the steps and the weight are in.</param>
/// <param name="BmrEstimate">What their body burns at rest, once the formula has what it needs.</param>
/// <param name="TdeeEstimate">What they burn, the resting estimate times the multiplier, once both are known.</param>
/// <param name="Goals">Each goal asked about with its rate, and its share once what they burn is known.</param>
public sealed record EnergyPreviewView(
    ActivityWords? Activity,
    WalkingWords? Walking,
    decimal? BmrEstimate,
    decimal? TdeeEstimate,
    IReadOnlyList<GoalRate> Goals);

/// <summary>
/// The coach's own grams a day for a client, and why (NUT-008, INV-2). The calorie target is what the
/// grams make (<see cref="CoachMacroOverride"/>); the answer is the new targets it records.
/// </summary>
public sealed record CreateMacroOverrideRequest(decimal ProteinGrams, decimal FatGrams, decimal CarbohydrateGrams, string Reason);

public sealed record ReplaceClientAllergensRequest(IReadOnlyList<AllergenCode> Codes);

/// <param name="Codes">The allergens declared for the client now, in the order the list names them.</param>
public sealed record ClientAllergensView(IReadOnlyList<AllergenCode> Codes);

/// <param name="Inputs">
/// What the result was worked out from, as it was sent; null when an older row's numbers cannot be read back.
/// </param>
/// <param name="Adjustment">Set when these are a coach's own macros: why, when, and the targets they changed.</param>
public sealed record NutritionCalculationRecord(NutritionCalculationView Result, CalculateNutritionTargetsRequest? Inputs, DateTimeOffset CalculatedAtUtc, MacroAdjustmentView? Adjustment = null);

/// <summary>A coach's override of a calculation's macros (NUT-008), as the targets that came of it name it.</summary>
/// <param name="AdjustedFromCalculationId">The targets the coach changed, with their own calories and grams.</param>
public sealed record MacroAdjustmentView(
    Guid OverrideId,
    string Reason,
    DateTimeOffset AdjustedAtUtc,
    Guid AdjustedFromCalculationId,
    decimal FromCalorieTarget,
    decimal FromProteinGrams,
    decimal FromCarbohydrateGrams,
    decimal FromFatGrams);

/// <summary>
/// The macro split (NUT-008) for a meal plan's daily target: what "Fill in fat and carbs" writes into
/// the builder's boxes (critique B5c2). The grams are unrounded; rounding is only for display. Nothing is
/// recorded: the builder keeps the share in its draft, and Publish works the split out again.
/// </summary>
public sealed record MacroSplitView(
    decimal CalorieTarget,
    decimal ProteinGrams,
    decimal FatPercentage,
    decimal FatGrams,
    decimal CarbohydrateGrams,
    string MethodKey,
    string MethodVersion,
    IReadOnlyList<string> Warnings);

/// <summary>
/// "Start from a client's targets" (critique B5c2): the caller's current clients (ADR 0026: a coach's
/// own, every client for the owner) whose Nutrition is open, each with their latest targets, by name.
/// At most <paramref name="Limit"/> are listed; <paramref name="Total"/> counts them all.
/// </summary>
public sealed record ClientTargetsList(IReadOnlyList<ClientTargetsItem> Items, int Total, int Limit);

/// <param name="CoachUserId">The client's coach, so the owner's list can say "Coached by …" on a team coach's client.</param>
/// <param name="FatPercentage">
/// The share of the calories the fat was worked out at when the macro split made these targets; null when
/// they are a coach's own macros (<see cref="CoachMacroOverride"/>).
/// </param>
/// <param name="BodyweightKilograms">The weight they were worked out with; null when an older row's numbers cannot be read back.</param>
/// <param name="IsEnergyDeficit">Whether they eat below what they burn, which widens the protein range (NUT-008).</param>
/// <param name="Warnings">The targets' warnings, worked out again from the stored numbers, as the calculations read does.</param>
public sealed record ClientTargetsItem(
    Guid ClientProfileId,
    string FirstName,
    string LastName,
    Guid CoachUserId,
    string CoachName,
    Guid CalculationId,
    DateTimeOffset CalculatedAtUtc,
    decimal CalorieTarget,
    decimal ProteinGrams,
    decimal CarbohydrateGrams,
    decimal FatGrams,
    decimal? FatPercentage,
    decimal? BodyweightKilograms,
    bool IsEnergyDeficit,
    IReadOnlyList<string> Warnings);

/// <summary>
/// A coach's read about one client: answered, or refused as 404 when the client is not in the
/// workspace (SEC-8) or 403 when their Nutrition is closed.
/// </summary>
public sealed record ClientNutritionRead<T>(ClientNutritionReach Reach, T? Value = null) where T : class;

public enum ClientNutritionReach
{
    Allowed = 1,
    NotFound = 2,
    Forbidden = 3,
}

public sealed record AssignNutritionPlanRequest(Guid MealPlanTemplateVersionId, Guid EnrollmentId, Guid CalculationSnapshotId, DateOnly StartDate, bool AcknowledgeAllergenWarnings);

public sealed record CancelNutritionPlanRequest(string Reason, uint Version);

/// <param name="MealPlanName">The meal plan it was assigned from, named as it is now (R5.3d).</param>
/// <param name="ProteinGrams">With the carbohydrate and fat grams and the calorie target: the targets the client
/// sees, from the calculation the plan was assigned with.</param>
/// <param name="CalculationSnapshotId">That calculation (R5.3d).</param>
/// <param name="StoppedAtUtc">When a coach stopped the plan (NUT-011); null while it was never stopped.</param>
/// <param name="StopReason">Why, as the coach wrote it (NCM-1).</param>
public sealed record ClientNutritionPlanSummary(Guid Id, Guid SourceMealPlanTemplateVersionId, Guid EnrollmentId, DateOnly StartDate, DateOnly EndDateExclusive, decimal CalorieTarget, ClientNutritionPlanStatus Status, uint Version, string MealPlanName, decimal ProteinGrams, decimal CarbohydrateGrams, decimal FatGrams, Guid CalculationSnapshotId, DateTimeOffset? StoppedAtUtc = null, string? StopReason = null);

/// <param name="RecipeId">The client's copy of the recipe (R4.4d), which the client opens; null for none.</param>
/// <param name="RecipePhotoMediaAssetId">
/// That copy's cover photo, which the meal card shows; null for none. It is an id, not an address:
/// reading it still needs a grant, given only through the client's own active plan (MED-014).
/// </param>
public sealed record NutritionChoiceView(Guid Id, string RecipeName, decimal Servings, decimal Calories, decimal ProteinGrams, decimal CarbohydrateGrams, decimal FatGrams, Guid? RecipeId = null, Guid? RecipePhotoMediaAssetId = null);

/// <param name="LoggedCalories">The calories of the amount the client logged (CLIENT-10), the same the
/// day's totals count; null while the meal is not logged.</param>
public sealed record NutritionSlotView(Guid Id, string Name, int Order, IReadOnlyList<NutritionChoiceView> Choices, Guid? SelectedChoiceId, decimal? ActualServings, decimal? LoggedCalories = null);

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

/// <summary>
/// A recipe as the client's plan copied it (NUT-006, R4.4d): what the coach wrote for the whole
/// recipe, its servings, and its ingredient lines in the foods' own units.
/// </summary>
public sealed record ClientPlanRecipeView(
    Guid Id,
    string Name,
    decimal Servings,
    int? PrepMinutes,
    int? CookMinutes,
    string Instructions,
    Guid? PhotoMediaAssetId,
    IReadOnlyList<ClientPlanRecipeIngredientView> Ingredients);

public sealed record ClientPlanRecipeIngredientView(string FoodName, decimal Quantity, FoodQuantityUnit Unit, PreparationBasis Basis);

public sealed record RecordNutritionChoiceRequest(Guid PlanDayId, Guid PlanSlotId, Guid ChoiceId, decimal ActualServings, uint? DailyLogVersion);

public sealed record AddNutritionCustomFoodRequest(Guid PlanDayId, string Name, decimal Amount, FoodQuantityUnit Unit, decimal Calories, decimal ProteinGrams, decimal CarbohydrateGrams, decimal FatGrams, uint? DailyLogVersion);

public sealed record ReverseNutritionCustomFoodRequest(uint DailyLogVersion);

public sealed record CompleteNutritionLogRequest(uint Version);

public sealed record GenerateAiMealDraftRequest(string Prompt, string PromptVersion, string Culture);

/// <param name="IsConfigured">Whether a coach can ask for a suggestion here: the provider is set up and
/// TB Gym's ceiling (<c>Nutrition:AiAllowance</c>) is above zero. Settings and the recipe editor both
/// read it (LOST-4).</param>
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
    bool Publish = false,
    int? PrepMinutes = null,
    int? CookMinutes = null);

/// <param name="CreatedRecipeId">The recipe an approval saved, so the editor can open it.</param>
public sealed record AiMealDraftView(Guid Id, AiDraftStatus Status, string PromptVersion, string SchemaVersion, string ProviderKey, string? Model, string? ModelVersion, string? ValidatedDraftJson, string? UncertainFieldsJson, string? FailureCode, decimal CostAmount, string CostCurrency, Guid? CreatedRecipeVersionId, Guid? CreatedRecipeId = null);

public sealed record NutritionCommandResult(
    NutritionCommandStatus Status,
    NutritionWorkspaceSettingsView? Settings = null,
    FoodItemView? Food = null,
    RecipeSummary? Recipe = null,
    MealPlanTemplateSummary? MealPlan = null,
    NutritionCalculationView? Calculation = null,
    CookingConversionView? CookingConversion = null,
    NutritionCalculationRecord? CalculationRecord = null,
    ClientNutritionPlanSummary? ClientPlan = null,
    ClientNutritionDayView? Day = null,
    AiMealDraftView? AiDraft = null,
    MealPlanDraftSaveView? MealPlanDraft = null,
    IReadOnlyDictionary<string, string[]>? Errors = null,
    string? Code = null,
    string? Message = null,
    MacroSplitView? MacroSplit = null,
    RecipeDraftSaveView? RecipeDraft = null,
    EnergyPreviewView? EnergyPreview = null);

public enum NutritionCommandStatus
{
    Success = 1,
    NotFound = 2,
    Forbidden = 3,
    Invalid = 4,
    Conflict = 5,
    ProviderUnavailable = 6,
}
