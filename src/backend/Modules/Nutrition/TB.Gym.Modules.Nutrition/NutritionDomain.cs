using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Nutrition;

public enum FoodProvenance
{
    UsdaFdc = 1,
    CoachAuthored = 2,
    LabelTranscribed = 3,
}

public enum FoodQuantityUnit
{
    Gram = 1,
    Millilitre = 2,
    Serving = 3,
}

public enum PublicationStatus
{
    Draft = 1,
    Published = 2,
}

public enum DailyNutritionLogStatus
{
    InProgress = 1,
    Completed = 2,
}

public enum AiDraftStatus
{
    Pending = 1,
    Failed = 2,
    AwaitingCoachReview = 3,
    Approved = 4,
    Rejected = 5,
}

public sealed class NutritionWorkspaceSettings : TenantEntity
{
    private NutritionWorkspaceSettings()
    {
    }

    private NutritionWorkspaceSettings(Guid tenantId) : base(tenantId)
    {
        EnergyPolicyKey = AtwaterEnergyPolicy.Key;
        EnergyPolicyVersion = EnergyFactorPolicyBase.CurrentVersion;
        ProviderCalorieTolerance = 25m;
        AiMonthlyRequestLimit = 0;
        AiMonthlyCostLimit = 0m;
        AiCostCurrency = "USD";
    }

    public string EnergyPolicyKey { get; private set; } = string.Empty;

    public string EnergyPolicyVersion { get; private set; } = string.Empty;

    public decimal ProviderCalorieTolerance { get; private set; }

    public int AiMonthlyRequestLimit { get; private set; }

    public decimal AiMonthlyCostLimit { get; private set; }

    public string AiCostCurrency { get; private set; } = string.Empty;

    public static NutritionWorkspaceSettings CreateDefault(Guid tenantId) => new(tenantId);

    public void Update(
        string energyPolicyKey,
        decimal providerCalorieTolerance,
        int aiMonthlyRequestLimit,
        decimal aiMonthlyCostLimit,
        string aiCostCurrency)
    {
        if (energyPolicyKey is not AtwaterEnergyPolicy.Key and not Eu1169EnergyPolicy.Key)
        {
            throw new ArgumentException("The energy policy must be Atwater or Eu1169.", nameof(energyPolicyKey));
        }

        if (providerCalorieTolerance is < 0m or > 500m || aiMonthlyRequestLimit is < 0 or > 100_000 || aiMonthlyCostLimit is < 0m or > 1_000_000m)
        {
            throw new ArgumentOutOfRangeException(nameof(providerCalorieTolerance));
        }

        var currency = (aiCostCurrency ?? string.Empty).Trim().ToUpperInvariant();
        if (currency.Length != 3 || currency.Any(character => character is < 'A' or > 'Z'))
        {
            throw new ArgumentException("AI cost currency must be a three-letter ISO code.", nameof(aiCostCurrency));
        }

        EnergyPolicyKey = energyPolicyKey;
        EnergyPolicyVersion = EnergyFactorPolicyBase.CurrentVersion;
        ProviderCalorieTolerance = providerCalorieTolerance;
        AiMonthlyRequestLimit = aiMonthlyRequestLimit;
        AiMonthlyCostLimit = aiMonthlyCostLimit;
        AiCostCurrency = currency;
    }
}

public sealed class FoodItem : TenantEntity
{
    private readonly List<FoodItemVersion> versions = [];

    private FoodItem()
    {
    }

    private FoodItem(Guid tenantId, string name, FoodProvenance provenance, string? externalId, string? externalDataType, Guid? labelMediaAssetId)
        : base(tenantId)
    {
        Name = NutritionRules.RequiredText(name, 300, nameof(name));
        NormalizedName = Name.ToUpperInvariant();
        Provenance = provenance;
        ExternalId = NutritionRules.OptionalText(externalId, 100, nameof(externalId));
        ExternalDataType = NutritionRules.OptionalText(externalDataType, 100, nameof(externalDataType));
        LabelMediaAssetId = labelMediaAssetId;
        ValidateProvenance();
    }

    public string Name { get; private set; } = string.Empty;

    public string NormalizedName { get; private set; } = string.Empty;

    public FoodProvenance Provenance { get; private set; }

    public string? ExternalId { get; private set; }

    public string? ExternalDataType { get; private set; }

    public Guid? LabelMediaAssetId { get; private set; }

    public int CurrentRevision { get; private set; }

    public IReadOnlyCollection<FoodItemVersion> Versions => versions;

    public static FoodItem Create(
        Guid tenantId,
        string name,
        FoodProvenance provenance,
        string? externalId = null,
        string? externalDataType = null,
        Guid? labelMediaAssetId = null) =>
        new(tenantId, name, provenance, externalId, externalDataType, labelMediaAssetId);

    public FoodItemVersion AddVersion(FoodVersionInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        var version = FoodItemVersion.Create(TenantId, Id, ++CurrentRevision, Provenance, input);
        versions.Add(version);
        return version;
    }

    private void ValidateProvenance()
    {
        if (!Enum.IsDefined(Provenance))
        {
            throw new ArgumentOutOfRangeException(nameof(Provenance));
        }

        if (Provenance == FoodProvenance.UsdaFdc && (string.IsNullOrWhiteSpace(ExternalId) || string.IsNullOrWhiteSpace(ExternalDataType)))
        {
            throw new ArgumentException("USDA FoodData Central provenance requires fdcId and data type.");
        }

        if (Provenance == FoodProvenance.LabelTranscribed && LabelMediaAssetId is null)
        {
            throw new ArgumentException("Label-transcribed food requires a label photo/media reference.");
        }

        if (Provenance == FoodProvenance.CoachAuthored && (ExternalId is not null || ExternalDataType is not null))
        {
            throw new ArgumentException("Coach-authored food cannot claim external provider identifiers.");
        }
    }
}

public sealed record FoodVersionInput(
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
    string EnergyPolicyKey,
    decimal CalorieTolerance,
    string SourceAttribution,
    string SourceRecordVersion,
    IReadOnlyList<AllergenCode> DeclaredAllergens);

public sealed class FoodItemVersion : TenantEntity
{
    private readonly List<FoodItemAllergen> allergens = [];

    private FoodItemVersion()
    {
    }

    private FoodItemVersion(Guid tenantId, Guid foodItemId, int revision, FoodProvenance provenance, FoodVersionInput input)
        : base(tenantId)
    {
        FoodItemId = foodItemId;
        Revision = revision;
        BasisQuantity = NutritionRules.Positive(input.BasisQuantity, 1_000_000m, nameof(input.BasisQuantity));
        BasisUnit = input.BasisUnit;
        PreparationBasis = input.PreparationBasis;
        ProteinGrams = NutritionRules.NonNegative(input.ProteinGrams, nameof(input.ProteinGrams));
        CarbohydrateGrams = NutritionRules.NonNegative(input.CarbohydrateGrams, nameof(input.CarbohydrateGrams));
        FatGrams = NutritionRules.NonNegative(input.FatGrams, nameof(input.FatGrams));
        FibreGrams = NutritionRules.NonNegative(input.FibreGrams, nameof(input.FibreGrams));
        PolyolGrams = NutritionRules.NonNegative(input.PolyolGrams, nameof(input.PolyolGrams));
        EthanolGrams = NutritionRules.NonNegative(input.EthanolGrams, nameof(input.EthanolGrams));
        ProviderCalories = input.ProviderCalories is null ? null : NutritionRules.NonNegative(input.ProviderCalories.Value, nameof(input.ProviderCalories));
        SourceAttribution = NutritionRules.RequiredText(input.SourceAttribution, 500, nameof(input.SourceAttribution));
        SourceRecordVersion = NutritionRules.RequiredText(input.SourceRecordVersion, 100, nameof(input.SourceRecordVersion));

        IEnergyFactorPolicy policy = input.EnergyPolicyKey switch
        {
            AtwaterEnergyPolicy.Key => new AtwaterEnergyPolicy(),
            Eu1169EnergyPolicy.Key => new Eu1169EnergyPolicy(),
            _ => throw new ArgumentException("A supported energy policy is required.", nameof(input)),
        };
        var comparison = EnergyComparisonCalculator.Compare(
            policy,
            new EnergyNutrients(ProteinGrams, CarbohydrateGrams, FatGrams, PolyolGrams: PolyolGrams, EthanolGrams: EthanolGrams, FibreGrams: FibreGrams),
            ProviderCalories,
            input.CalorieTolerance);
        ComputedCalories = comparison.ComputedKilocalories;
        EnergyPolicyKey = comparison.PolicyKey;
        EnergyPolicyVersion = comparison.PolicyVersion;
        CalorieTolerance = comparison.ToleranceKilocalories;
        HasCalorieDiscrepancy = comparison.HasDiscrepancy;

        foreach (var allergen in input.DeclaredAllergens.Distinct())
        {
            if (!Enum.IsDefined(allergen))
            {
                throw new ArgumentException("Allergens must use supported structured codes.", nameof(input));
            }

            allergens.Add(FoodItemAllergen.Create(tenantId, Id, allergen));
        }

        if (!Enum.IsDefined(BasisUnit) || !Enum.IsDefined(PreparationBasis) || !Enum.IsDefined(provenance))
        {
            throw new ArgumentException("Food version metadata is invalid.", nameof(input));
        }
    }

    public Guid FoodItemId { get; private set; }

    public int Revision { get; private set; }

    public decimal BasisQuantity { get; private set; }

    public FoodQuantityUnit BasisUnit { get; private set; }

    public PreparationBasis PreparationBasis { get; private set; }

    public decimal ProteinGrams { get; private set; }

    public decimal CarbohydrateGrams { get; private set; }

    public decimal FatGrams { get; private set; }

    public decimal FibreGrams { get; private set; }

    public decimal PolyolGrams { get; private set; }

    public decimal EthanolGrams { get; private set; }

    public decimal ComputedCalories { get; private set; }

    public decimal? ProviderCalories { get; private set; }

    public string EnergyPolicyKey { get; private set; } = string.Empty;

    public string EnergyPolicyVersion { get; private set; } = string.Empty;

    public decimal CalorieTolerance { get; private set; }

    public bool HasCalorieDiscrepancy { get; private set; }

    public string SourceAttribution { get; private set; } = string.Empty;

    public string SourceRecordVersion { get; private set; } = string.Empty;

    public IReadOnlyCollection<FoodItemAllergen> Allergens => allergens;

    internal static FoodItemVersion Create(Guid tenantId, Guid foodItemId, int revision, FoodProvenance provenance, FoodVersionInput input) =>
        new(tenantId, foodItemId, revision, provenance, input);
}

public sealed class FoodItemAllergen : TenantEntity
{
    private FoodItemAllergen()
    {
    }

    private FoodItemAllergen(Guid tenantId, Guid foodItemVersionId, AllergenCode code) : base(tenantId)
    {
        FoodItemVersionId = foodItemVersionId;
        Code = code;
    }

    public Guid FoodItemVersionId { get; private set; }

    public AllergenCode Code { get; private set; }

    internal static FoodItemAllergen Create(Guid tenantId, Guid foodItemVersionId, AllergenCode code) =>
        new(tenantId, foodItemVersionId, code);
}

public sealed class CookingFactorRecord : TenantEntity
{
    private CookingFactorRecord()
    {
    }

    private CookingFactorRecord(Guid tenantId, string kind, CookingFactor factor) : base(tenantId)
    {
        Kind = NutritionRules.RequiredText(kind, 32, nameof(kind));
        SourceKey = NutritionRules.RequiredText(factor.SourceKey, 200, nameof(factor));
        SourceVersion = NutritionRules.RequiredText(factor.SourceVersion, 100, nameof(factor));
        FromBasis = factor.FromBasis;
        ToBasis = factor.ToBasis;
        Factor = factor.Factor;
        // Yield may exceed 1 because water-absorbing staples gain mass; retention is a surviving
        // fraction and cannot. Bounds match PreparationBasisCalculator so a record that persists
        // can always be applied.
        var maximum = kind == nameof(CookingFactorKind.Retention)
            ? PreparationBasisCalculator.MaximumRetentionFactor
            : PreparationBasisCalculator.MaximumYieldFactor;
        if (factor.Factor <= 0m || factor.Factor > maximum || factor.FromBasis == factor.ToBasis)
        {
            throw new ArgumentOutOfRangeException(nameof(factor));
        }
    }

    public string Kind { get; private set; } = string.Empty;

    public string SourceKey { get; private set; } = string.Empty;

    public string SourceVersion { get; private set; } = string.Empty;

    public PreparationBasis FromBasis { get; private set; }

    public PreparationBasis ToBasis { get; private set; }

    public decimal Factor { get; private set; }

    public static CookingFactorRecord CreateYield(Guid tenantId, CookingFactor factor) => new(tenantId, "Yield", factor);

    public static CookingFactorRecord CreateRetention(Guid tenantId, CookingFactor factor) => new(tenantId, "Retention", factor);
}

public sealed class Recipe : TenantEntity
{
    private readonly List<RecipeVersion> versions = [];

    private Recipe()
    {
    }

    private Recipe(Guid tenantId, string name) : base(tenantId)
    {
        Name = NutritionRules.RequiredText(name, 300, nameof(name));
        NormalizedName = Name.ToUpperInvariant();
    }

    public string Name { get; private set; } = string.Empty;

    public string NormalizedName { get; private set; } = string.Empty;

    public int CurrentRevision { get; private set; }

    public IReadOnlyCollection<RecipeVersion> Versions => versions;

    public static Recipe Create(Guid tenantId, string name) => new(tenantId, name);

    public RecipeVersion AddDraft(string instructions, decimal servings, IEnumerable<RecipeIngredientInput> ingredients)
    {
        var draft = RecipeVersion.Create(TenantId, Id, ++CurrentRevision, instructions, servings, ingredients);
        versions.Add(draft);
        return draft;
    }
}

public sealed record RecipeIngredientInput(
    Guid FoodItemVersionId,
    string FoodName,
    decimal Quantity,
    FoodQuantityUnit Unit,
    PreparationBasis Basis,
    decimal ProteinGrams,
    decimal CarbohydrateGrams,
    decimal FatGrams,
    decimal Calories,
    string Provenance,
    IReadOnlyList<AllergenCode> Allergens,
    Guid? YieldFactorId = null,
    Guid? RetentionFactorId = null);

public sealed class RecipeVersion : TenantEntity
{
    private readonly List<RecipeIngredient> ingredients = [];
    private readonly List<RecipeVersionAllergen> allergens = [];

    private RecipeVersion()
    {
    }

    private RecipeVersion(Guid tenantId, Guid recipeId, int revision, string instructions, decimal servings, IEnumerable<RecipeIngredientInput> ingredientInputs)
        : base(tenantId)
    {
        RecipeId = recipeId;
        Revision = revision;
        Instructions = NutritionRules.RequiredText(instructions, 20_000, nameof(instructions));
        Servings = NutritionRules.Positive(servings, 10_000m, nameof(servings));
        Status = PublicationStatus.Draft;
        var inputs = ingredientInputs.ToArray();
        if (inputs.Length == 0 || inputs.Length > 500)
        {
            throw new ArgumentException("A recipe requires 1 to 500 ingredient lines.", nameof(ingredientInputs));
        }

        for (var index = 0; index < inputs.Length; index++)
        {
            var line = RecipeIngredient.Create(tenantId, Id, index, inputs[index]);
            ingredients.Add(line);
        }

        ProteinGrams = ingredients.Sum(item => item.ProteinGrams);
        CarbohydrateGrams = ingredients.Sum(item => item.CarbohydrateGrams);
        FatGrams = ingredients.Sum(item => item.FatGrams);
        Calories = ingredients.Sum(item => item.Calories);
        foreach (var code in inputs.SelectMany(item => item.Allergens).Distinct())
        {
            allergens.Add(RecipeVersionAllergen.Create(tenantId, Id, code));
        }
    }

    public Guid RecipeId { get; private set; }

    public int Revision { get; private set; }

    public PublicationStatus Status { get; private set; }

    public DateTimeOffset? PublishedAtUtc { get; private set; }

    public Guid? PublishedByUserId { get; private set; }

    public string Instructions { get; private set; } = string.Empty;

    public decimal Servings { get; private set; }

    public decimal Calories { get; private set; }

    public decimal ProteinGrams { get; private set; }

    public decimal CarbohydrateGrams { get; private set; }

    public decimal FatGrams { get; private set; }

    public IReadOnlyCollection<RecipeIngredient> Ingredients => ingredients;

    public IReadOnlyCollection<RecipeVersionAllergen> Allergens => allergens;

    public void Publish(DateTimeOffset now, Guid userId)
    {
        if (Status == PublicationStatus.Published)
        {
            throw new InvalidOperationException("A recipe version is already published.");
        }

        Status = PublicationStatus.Published;
        PublishedAtUtc = now;
        PublishedByUserId = userId;
    }

    internal static RecipeVersion Create(Guid tenantId, Guid recipeId, int revision, string instructions, decimal servings, IEnumerable<RecipeIngredientInput> ingredients) =>
        new(tenantId, recipeId, revision, instructions, servings, ingredients);
}

public sealed class RecipeIngredient : TenantEntity
{
    private RecipeIngredient()
    {
    }

    private RecipeIngredient(Guid tenantId, Guid recipeVersionId, int order, RecipeIngredientInput input) : base(tenantId)
    {
        RecipeVersionId = recipeVersionId;
        Order = order;
        FoodItemVersionId = input.FoodItemVersionId;
        FoodName = NutritionRules.RequiredText(input.FoodName, 300, nameof(input.FoodName));
        Quantity = NutritionRules.Positive(input.Quantity, 1_000_000m, nameof(input.Quantity));
        Unit = input.Unit;
        Basis = input.Basis;
        ProteinGrams = NutritionRules.NonNegative(input.ProteinGrams, nameof(input.ProteinGrams));
        CarbohydrateGrams = NutritionRules.NonNegative(input.CarbohydrateGrams, nameof(input.CarbohydrateGrams));
        FatGrams = NutritionRules.NonNegative(input.FatGrams, nameof(input.FatGrams));
        Calories = NutritionRules.NonNegative(input.Calories, nameof(input.Calories));
        Provenance = NutritionRules.RequiredText(input.Provenance, 500, nameof(input.Provenance));
        YieldFactorId = input.YieldFactorId;
        RetentionFactorId = input.RetentionFactorId;
        if (!Enum.IsDefined(Unit) || !Enum.IsDefined(Basis))
        {
            throw new ArgumentException("Ingredient unit and preparation basis are required.", nameof(input));
        }
    }

    public Guid RecipeVersionId { get; private set; }
    public int Order { get; private set; }
    public Guid FoodItemVersionId { get; private set; }
    public string FoodName { get; private set; } = string.Empty;
    public decimal Quantity { get; private set; }
    public FoodQuantityUnit Unit { get; private set; }
    public PreparationBasis Basis { get; private set; }
    public decimal ProteinGrams { get; private set; }
    public decimal CarbohydrateGrams { get; private set; }
    public decimal FatGrams { get; private set; }
    public decimal Calories { get; private set; }
    public string Provenance { get; private set; } = string.Empty;
    public Guid? YieldFactorId { get; private set; }
    public Guid? RetentionFactorId { get; private set; }

    internal static RecipeIngredient Create(Guid tenantId, Guid recipeVersionId, int order, RecipeIngredientInput input) =>
        new(tenantId, recipeVersionId, order, input);
}

public sealed class RecipeVersionAllergen : TenantEntity
{
    private RecipeVersionAllergen()
    {
    }

    private RecipeVersionAllergen(Guid tenantId, Guid recipeVersionId, AllergenCode code) : base(tenantId)
    {
        RecipeVersionId = recipeVersionId;
        Code = code;
    }

    public Guid RecipeVersionId { get; private set; }
    public AllergenCode Code { get; private set; }

    internal static RecipeVersionAllergen Create(Guid tenantId, Guid recipeVersionId, AllergenCode code) => new(tenantId, recipeVersionId, code);
}

public sealed class NutritionCalculationSnapshot : TenantEntity
{
    private NutritionCalculationSnapshot()
    {
    }

    private NutritionCalculationSnapshot(
        Guid tenantId,
        Guid clientProfileId,
        BmrResult bmr,
        ActivityModelResult activity,
        TdeeResult tdee,
        decimal coachGoalAdjustment,
        MacroTargetResult target,
        string energyPolicyKey,
        string energyPolicyVersion,
        string inputJson) : base(tenantId)
    {
        ClientProfileId = clientProfileId;
        BmrMethodKey = bmr.MethodKey;
        BmrMethodVersion = bmr.MethodVersion;
        BmrEstimate = bmr.KilocaloriesPerDay;
        ActivityModelKey = activity.MethodKey;
        ActivityModelVersion = activity.MethodVersion;
        ActivityModelPal = activity.Pal;
        TdeeMethodKey = tdee.MethodKey;
        TdeeMethodVersion = tdee.MethodVersion;
        TdeeEstimate = tdee.KilocaloriesPerDay;
        CoachGoalAdjustment = coachGoalAdjustment;
        CalorieTarget = target.CalorieTarget;
        ProteinGrams = target.ProteinGrams;
        FatGrams = target.FatGrams;
        CarbohydrateGrams = target.CarbohydrateGrams;
        MacroMethodKey = target.MethodKey;
        MacroMethodVersion = target.MethodVersion;
        EnergyPolicyKey = NutritionRules.RequiredText(energyPolicyKey, 100, nameof(energyPolicyKey));
        EnergyPolicyVersion = NutritionRules.RequiredText(energyPolicyVersion, 50, nameof(energyPolicyVersion));
        InputJson = NutritionRules.RequiredText(inputJson, 20_000, nameof(inputJson));
    }

    public Guid ClientProfileId { get; private set; }
    public string BmrMethodKey { get; private set; } = string.Empty;
    public string BmrMethodVersion { get; private set; } = string.Empty;
    public decimal BmrEstimate { get; private set; }
    public string ActivityModelKey { get; private set; } = string.Empty;
    public string ActivityModelVersion { get; private set; } = string.Empty;
    public decimal ActivityModelPal { get; private set; }
    public string TdeeMethodKey { get; private set; } = string.Empty;
    public string TdeeMethodVersion { get; private set; } = string.Empty;
    public decimal TdeeEstimate { get; private set; }
    public decimal CoachGoalAdjustment { get; private set; }
    public decimal CalorieTarget { get; private set; }
    public decimal ProteinGrams { get; private set; }
    public decimal FatGrams { get; private set; }
    public decimal CarbohydrateGrams { get; private set; }
    public string MacroMethodKey { get; private set; } = string.Empty;
    public string MacroMethodVersion { get; private set; } = string.Empty;
    public string EnergyPolicyKey { get; private set; } = string.Empty;
    public string EnergyPolicyVersion { get; private set; } = string.Empty;
    public string InputJson { get; private set; } = string.Empty;

    public static NutritionCalculationSnapshot Create(
        Guid tenantId,
        Guid clientProfileId,
        BmrResult bmr,
        ActivityModelResult activity,
        TdeeResult tdee,
        decimal coachGoalAdjustment,
        MacroTargetResult target,
        string energyPolicyKey,
        string energyPolicyVersion,
        string inputJson)
    {
        if (target.CalorieTarget != tdee.KilocaloriesPerDay + coachGoalAdjustment)
        {
            throw new ArgumentException("Calorie target must equal the TDEE estimate plus coach goal adjustment.");
        }

        return new NutritionCalculationSnapshot(tenantId, clientProfileId, bmr, activity, tdee, coachGoalAdjustment, target, energyPolicyKey, energyPolicyVersion, inputJson);
    }
}

public sealed class MacroOverrideAudit : TenantEntity
{
    private MacroOverrideAudit()
    {
    }

    private MacroOverrideAudit(Guid tenantId, Guid calculationSnapshotId, decimal protein, decimal fat, decimal carbohydrate, string reason, Guid actorUserId)
        : base(tenantId)
    {
        CalculationSnapshotId = calculationSnapshotId;
        ProteinGrams = NutritionRules.NonNegative(protein, nameof(protein));
        FatGrams = NutritionRules.NonNegative(fat, nameof(fat));
        CarbohydrateGrams = NutritionRules.NonNegative(carbohydrate, nameof(carbohydrate));
        Reason = NutritionRules.RequiredText(reason, 1_000, nameof(reason));
        ActorUserId = actorUserId == Guid.Empty ? throw new ArgumentException("An actor is required.", nameof(actorUserId)) : actorUserId;
    }

    public Guid CalculationSnapshotId { get; private set; }
    public decimal ProteinGrams { get; private set; }
    public decimal FatGrams { get; private set; }
    public decimal CarbohydrateGrams { get; private set; }
    public string Reason { get; private set; } = string.Empty;
    public Guid ActorUserId { get; private set; }

    public static MacroOverrideAudit Create(Guid tenantId, Guid calculationSnapshotId, decimal protein, decimal fat, decimal carbohydrate, string reason, Guid actorUserId) =>
        new(tenantId, calculationSnapshotId, protein, fat, carbohydrate, reason, actorUserId);
}

public sealed class MealPlanTemplate : TenantEntity
{
    private readonly List<MealPlanTemplateVersion> versions = [];

    private MealPlanTemplate()
    {
    }

    private MealPlanTemplate(Guid tenantId, string name) : base(tenantId)
    {
        Name = NutritionRules.RequiredText(name, 300, nameof(name));
        NormalizedName = Name.ToUpperInvariant();
    }

    public string Name { get; private set; } = string.Empty;
    public string NormalizedName { get; private set; } = string.Empty;
    public int CurrentRevision { get; private set; }
    public IReadOnlyCollection<MealPlanTemplateVersion> Versions => versions;

    public static MealPlanTemplate Create(Guid tenantId, string name) => new(tenantId, name);

    public MealPlanTemplateVersion AddDraft(int dayCount, decimal targetCalories, decimal targetProtein, decimal targetCarbohydrate, decimal targetFat, IEnumerable<MealSlotInput> slots)
    {
        var version = MealPlanTemplateVersion.Create(TenantId, Id, ++CurrentRevision, dayCount, targetCalories, targetProtein, targetCarbohydrate, targetFat, slots);
        versions.Add(version);
        return version;
    }
}

public sealed record MealChoiceInput(Guid RecipeVersionId, string RecipeName, decimal Servings, decimal Calories, decimal ProteinGrams, decimal CarbohydrateGrams, decimal FatGrams);

public sealed record MealSlotInput(int DayOffset, int Order, string Name, IReadOnlyList<MealChoiceInput> Choices);

public sealed class MealPlanTemplateVersion : TenantEntity
{
    private readonly List<MealPlanSlot> slots = [];

    private MealPlanTemplateVersion()
    {
    }

    private MealPlanTemplateVersion(Guid tenantId, Guid templateId, int revision, int dayCount, decimal targetCalories, decimal targetProtein, decimal targetCarbohydrate, decimal targetFat, IEnumerable<MealSlotInput> slotInputs)
        : base(tenantId)
    {
        MealPlanTemplateId = templateId;
        Revision = revision;
        DayCount = dayCount is >= 1 and <= 365 ? dayCount : throw new ArgumentOutOfRangeException(nameof(dayCount));
        TargetCalories = NutritionRules.Positive(targetCalories, 100_000m, nameof(targetCalories));
        TargetProteinGrams = NutritionRules.NonNegative(targetProtein, nameof(targetProtein));
        TargetCarbohydrateGrams = NutritionRules.NonNegative(targetCarbohydrate, nameof(targetCarbohydrate));
        TargetFatGrams = NutritionRules.NonNegative(targetFat, nameof(targetFat));
        Status = PublicationStatus.Draft;
        var inputs = slotInputs.OrderBy(item => item.DayOffset).ThenBy(item => item.Order).ToArray();
        if (inputs.Length == 0 || inputs.Any(item => item.DayOffset < 0 || item.DayOffset >= DayCount))
        {
            throw new ArgumentException("Meal slots must fall within the template day range.", nameof(slotInputs));
        }

        if (inputs.Select(item => item.DayOffset).Distinct().Count() != DayCount)
        {
            throw new ArgumentException("Each template day requires at least one meal slot.", nameof(slotInputs));
        }

        foreach (var input in inputs)
        {
            slots.Add(MealPlanSlot.Create(tenantId, Id, input));
        }
    }

    public Guid MealPlanTemplateId { get; private set; }
    public int Revision { get; private set; }
    public int DayCount { get; private set; }
    public PublicationStatus Status { get; private set; }
    public DateTimeOffset? PublishedAtUtc { get; private set; }
    public Guid? PublishedByUserId { get; private set; }
    public decimal TargetCalories { get; private set; }
    public decimal TargetProteinGrams { get; private set; }
    public decimal TargetCarbohydrateGrams { get; private set; }
    public decimal TargetFatGrams { get; private set; }
    public IReadOnlyCollection<MealPlanSlot> Slots => slots;

    public void Publish(DateTimeOffset now, Guid userId)
    {
        if (Status == PublicationStatus.Published)
        {
            throw new InvalidOperationException("A meal-plan version is already published.");
        }

        Status = PublicationStatus.Published;
        PublishedAtUtc = now;
        PublishedByUserId = userId;
    }

    internal static MealPlanTemplateVersion Create(Guid tenantId, Guid templateId, int revision, int dayCount, decimal targetCalories, decimal targetProtein, decimal targetCarbohydrate, decimal targetFat, IEnumerable<MealSlotInput> slots) =>
        new(tenantId, templateId, revision, dayCount, targetCalories, targetProtein, targetCarbohydrate, targetFat, slots);
}

public sealed class MealPlanSlot : TenantEntity
{
    private readonly List<MealPlanChoice> choices = [];

    private MealPlanSlot()
    {
    }

    private MealPlanSlot(Guid tenantId, Guid versionId, MealSlotInput input) : base(tenantId)
    {
        MealPlanTemplateVersionId = versionId;
        DayOffset = input.DayOffset;
        Order = input.Order;
        Name = NutritionRules.RequiredText(input.Name, 200, nameof(input.Name));
        if (input.Choices.Count == 0 || input.Choices.Count > 100)
        {
            throw new ArgumentException("Each meal slot requires 1 to 100 choices.", nameof(input));
        }

        foreach (var choice in input.Choices)
        {
            choices.Add(MealPlanChoice.Create(tenantId, Id, choice));
        }

        AverageCalories = choices.Average(item => item.Calories);
        AverageProteinGrams = choices.Average(item => item.ProteinGrams);
        AverageCarbohydrateGrams = choices.Average(item => item.CarbohydrateGrams);
        AverageFatGrams = choices.Average(item => item.FatGrams);
    }

    public Guid MealPlanTemplateVersionId { get; private set; }
    public int DayOffset { get; private set; }
    public int Order { get; private set; }
    public string Name { get; private set; } = string.Empty;
    public decimal AverageCalories { get; private set; }
    public decimal AverageProteinGrams { get; private set; }
    public decimal AverageCarbohydrateGrams { get; private set; }
    public decimal AverageFatGrams { get; private set; }
    public IReadOnlyCollection<MealPlanChoice> Choices => choices;

    internal static MealPlanSlot Create(Guid tenantId, Guid versionId, MealSlotInput input) => new(tenantId, versionId, input);
}

public sealed class MealPlanChoice : TenantEntity
{
    private MealPlanChoice()
    {
    }

    private MealPlanChoice(Guid tenantId, Guid slotId, MealChoiceInput input) : base(tenantId)
    {
        MealPlanSlotId = slotId;
        RecipeVersionId = input.RecipeVersionId;
        RecipeName = NutritionRules.RequiredText(input.RecipeName, 300, nameof(input.RecipeName));
        Servings = NutritionRules.Positive(input.Servings, 1_000m, nameof(input.Servings));
        Calories = NutritionRules.NonNegative(input.Calories, nameof(input.Calories));
        ProteinGrams = NutritionRules.NonNegative(input.ProteinGrams, nameof(input.ProteinGrams));
        CarbohydrateGrams = NutritionRules.NonNegative(input.CarbohydrateGrams, nameof(input.CarbohydrateGrams));
        FatGrams = NutritionRules.NonNegative(input.FatGrams, nameof(input.FatGrams));
    }

    public Guid MealPlanSlotId { get; private set; }
    public Guid RecipeVersionId { get; private set; }
    public string RecipeName { get; private set; } = string.Empty;
    public decimal Servings { get; private set; }
    public decimal Calories { get; private set; }
    public decimal ProteinGrams { get; private set; }
    public decimal CarbohydrateGrams { get; private set; }
    public decimal FatGrams { get; private set; }

    internal static MealPlanChoice Create(Guid tenantId, Guid slotId, MealChoiceInput input) => new(tenantId, slotId, input);
}

public sealed class ClientNutritionPlan : TenantEntity
{
    private readonly List<ClientNutritionPlanDay> days = [];

    private ClientNutritionPlan()
    {
    }

    private ClientNutritionPlan(Guid tenantId, Guid clientProfileId, Guid enrollmentId, Guid sourceVersionId, Guid calculationSnapshotId, DateOnly startDate, DateOnly endDateExclusive, IEnumerable<MealSlotInput> slots)
        : base(tenantId)
    {
        ClientProfileId = clientProfileId;
        EnrollmentId = enrollmentId;
        SourceMealPlanTemplateVersionId = sourceVersionId;
        NutritionCalculationSnapshotId = calculationSnapshotId;
        StartDate = startDate;
        EndDateExclusive = endDateExclusive;
        Status = ClientNutritionPlanStatus.Active;
        BlocksOverlap = true;
        var grouped = slots.GroupBy(slot => slot.DayOffset).ToDictionary(group => group.Key, group => group.ToArray());
        for (var offset = 0; offset < endDateExclusive.DayNumber - startDate.DayNumber; offset++)
        {
            if (!grouped.TryGetValue(offset, out var daySlots))
            {
                throw new ArgumentException("Every assigned day requires at least one meal slot.", nameof(slots));
            }

            days.Add(ClientNutritionPlanDay.Create(tenantId, Id, startDate.AddDays(offset), daySlots));
        }
    }

    public Guid ClientProfileId { get; private set; }
    public Guid EnrollmentId { get; private set; }
    public Guid SourceMealPlanTemplateVersionId { get; private set; }
    public Guid NutritionCalculationSnapshotId { get; private set; }
    public DateOnly StartDate { get; private set; }
    public DateOnly EndDateExclusive { get; private set; }
    public ClientNutritionPlanStatus Status { get; private set; }

    // Drives the PostgreSQL exclusion constraint's partial predicate. A cancelled plan keeps its
    // dates as history but must release the range so a corrected plan can occupy it.
    public bool BlocksOverlap { get; private set; }
    public IReadOnlyCollection<ClientNutritionPlanDay> Days => days;

    public static ClientNutritionPlan Assign(Guid tenantId, Guid clientProfileId, Guid enrollmentId, Guid sourceVersionId, Guid calculationSnapshotId, DateOnly startDate, DateOnly endDateExclusive, IEnumerable<MealSlotInput> slots, NutritionCoverageAuthorization coverage)
    {
        var decision = NutritionCoveragePolicy.Evaluate(clientProfileId, startDate, endDateExclusive, coverage);
        if (!decision.IsAuthorized)
        {
            throw new InvalidOperationException(decision.Reason);
        }

        return new ClientNutritionPlan(tenantId, clientProfileId, enrollmentId, sourceVersionId, calculationSnapshotId, startDate, endDateExclusive, slots);
    }

    /// <summary>
    /// Cancels a misassigned plan. Days, slots, choices, and any completed daily logs are retained
    /// as history; only future visibility and the overlap reservation are withdrawn.
    /// </summary>
    public void Cancel()
    {
        if (Status == ClientNutritionPlanStatus.Cancelled)
        {
            throw new InvalidOperationException("The nutrition plan is already cancelled.");
        }

        Status = ClientNutritionPlanStatus.Cancelled;
        BlocksOverlap = false;
    }
}

public enum ClientNutritionPlanStatus
{
    Active = 1,
    Cancelled = 2,
}

public enum NutritionPlanLifecycleEventType
{
    Assigned = 1,
    Cancelled = 2,
}

/// <summary>
/// Append-only audit of client nutrition plan lifecycle transitions (DOMAIN-RULES SYS-003).
/// </summary>
public sealed class NutritionPlanLifecycleEvent : TenantEntity
{
    private NutritionPlanLifecycleEvent()
    {
    }

    private NutritionPlanLifecycleEvent(
        Guid tenantId,
        Guid clientNutritionPlanId,
        NutritionPlanLifecycleEventType eventType,
        ClientNutritionPlanStatus? fromStatus,
        ClientNutritionPlanStatus toStatus,
        string reason,
        Guid actorUserId,
        DateTimeOffset occurredAtUtc)
        : base(tenantId)
    {
        if (clientNutritionPlanId == Guid.Empty || actorUserId == Guid.Empty ||
            !Enum.IsDefined(eventType) || !Enum.IsDefined(toStatus) ||
            (fromStatus is { } source && !Enum.IsDefined(source)))
        {
            throw new ArgumentException("Nutrition plan lifecycle metadata is invalid.");
        }

        ClientNutritionPlanId = clientNutritionPlanId;
        EventType = eventType;
        FromStatus = fromStatus;
        ToStatus = toStatus;
        Reason = NutritionRules.RequiredText(reason, 500, nameof(reason));
        ActorUserId = actorUserId;
        OccurredAtUtc = occurredAtUtc;
    }

    public Guid ClientNutritionPlanId { get; private set; }
    public NutritionPlanLifecycleEventType EventType { get; private set; }
    public ClientNutritionPlanStatus? FromStatus { get; private set; }
    public ClientNutritionPlanStatus ToStatus { get; private set; }
    public string Reason { get; private set; } = string.Empty;
    public Guid ActorUserId { get; private set; }
    public DateTimeOffset OccurredAtUtc { get; private set; }

    public static NutritionPlanLifecycleEvent Record(
        Guid tenantId,
        Guid clientNutritionPlanId,
        NutritionPlanLifecycleEventType eventType,
        ClientNutritionPlanStatus? fromStatus,
        ClientNutritionPlanStatus toStatus,
        string reason,
        Guid actorUserId,
        DateTimeOffset occurredAtUtc) =>
        new(tenantId, clientNutritionPlanId, eventType, fromStatus, toStatus, reason, actorUserId, occurredAtUtc);
}

public sealed class ClientNutritionPlanDay : TenantEntity
{
    private readonly List<ClientNutritionPlanSlot> slots = [];

    private ClientNutritionPlanDay()
    {
    }

    private ClientNutritionPlanDay(Guid tenantId, Guid planId, DateOnly date, IEnumerable<MealSlotInput> slotInputs) : base(tenantId)
    {
        ClientNutritionPlanId = planId;
        Date = date;
        foreach (var input in slotInputs)
        {
            slots.Add(ClientNutritionPlanSlot.Create(tenantId, Id, input));
        }
    }

    public Guid ClientNutritionPlanId { get; private set; }
    public DateOnly Date { get; private set; }
    public IReadOnlyCollection<ClientNutritionPlanSlot> Slots => slots;

    internal static ClientNutritionPlanDay Create(Guid tenantId, Guid planId, DateOnly date, IEnumerable<MealSlotInput> slots) => new(tenantId, planId, date, slots);
}

public sealed class ClientNutritionPlanSlot : TenantEntity
{
    private readonly List<ClientNutritionPlanChoice> choices = [];

    private ClientNutritionPlanSlot()
    {
    }

    private ClientNutritionPlanSlot(Guid tenantId, Guid dayId, MealSlotInput input) : base(tenantId)
    {
        ClientNutritionPlanDayId = dayId;
        Order = input.Order;
        Name = NutritionRules.RequiredText(input.Name, 200, nameof(input.Name));
        foreach (var choice in input.Choices)
        {
            choices.Add(ClientNutritionPlanChoice.Create(tenantId, Id, choice));
        }
    }

    public Guid ClientNutritionPlanDayId { get; private set; }
    public int Order { get; private set; }
    public string Name { get; private set; } = string.Empty;
    public IReadOnlyCollection<ClientNutritionPlanChoice> Choices => choices;

    internal static ClientNutritionPlanSlot Create(Guid tenantId, Guid dayId, MealSlotInput input) => new(tenantId, dayId, input);
}

public sealed class ClientNutritionPlanChoice : TenantEntity
{
    private ClientNutritionPlanChoice()
    {
    }

    private ClientNutritionPlanChoice(Guid tenantId, Guid slotId, MealChoiceInput input) : base(tenantId)
    {
        ClientNutritionPlanSlotId = slotId;
        SourceRecipeVersionId = input.RecipeVersionId;
        RecipeName = input.RecipeName;
        Servings = input.Servings;
        Calories = input.Calories;
        ProteinGrams = input.ProteinGrams;
        CarbohydrateGrams = input.CarbohydrateGrams;
        FatGrams = input.FatGrams;
    }

    public Guid ClientNutritionPlanSlotId { get; private set; }
    public Guid SourceRecipeVersionId { get; private set; }
    public string RecipeName { get; private set; } = string.Empty;
    public decimal Servings { get; private set; }
    public decimal Calories { get; private set; }
    public decimal ProteinGrams { get; private set; }
    public decimal CarbohydrateGrams { get; private set; }
    public decimal FatGrams { get; private set; }

    internal static ClientNutritionPlanChoice Create(Guid tenantId, Guid slotId, MealChoiceInput input) => new(tenantId, slotId, input);
}

public sealed class DailyNutritionLog : TenantEntity
{
    private readonly List<DailyNutritionLogEntry> entries = [];

    private DailyNutritionLog()
    {
    }

    private DailyNutritionLog(Guid tenantId, Guid clientProfileId, Guid clientNutritionPlanId, Guid clientNutritionPlanDayId, DateOnly date) : base(tenantId)
    {
        ClientProfileId = clientProfileId;
        ClientNutritionPlanId = clientNutritionPlanId;
        ClientNutritionPlanDayId = clientNutritionPlanDayId;
        Date = date;
        Status = DailyNutritionLogStatus.InProgress;
    }

    public Guid ClientProfileId { get; private set; }
    public Guid ClientNutritionPlanId { get; private set; }
    public Guid ClientNutritionPlanDayId { get; private set; }
    public DateOnly Date { get; private set; }
    public DailyNutritionLogStatus Status { get; private set; }
    public DateTimeOffset? CompletedAtUtc { get; private set; }
    public IReadOnlyCollection<DailyNutritionLogEntry> Entries => entries;
    public decimal SelectedCalories => entries.Sum(item => item.Calories);
    public decimal SelectedProteinGrams => entries.Sum(item => item.ProteinGrams);
    public decimal SelectedCarbohydrateGrams => entries.Sum(item => item.CarbohydrateGrams);
    public decimal SelectedFatGrams => entries.Sum(item => item.FatGrams);

    public static DailyNutritionLog Start(Guid tenantId, Guid clientProfileId, Guid clientNutritionPlanId, Guid clientNutritionPlanDayId, DateOnly date) =>
        new(tenantId, clientProfileId, clientNutritionPlanId, clientNutritionPlanDayId, date);

    public DailyNutritionLogEntry Record(Guid planSlotId, Guid selectedPlanChoiceId, string recipeName, decimal servings, decimal calories, decimal protein, decimal carbohydrate, decimal fat)
    {
        if (Status == DailyNutritionLogStatus.Completed)
        {
            throw new InvalidOperationException("A completed daily nutrition log is immutable.");
        }

        var existing = entries.SingleOrDefault(item => item.ClientNutritionPlanSlotId == planSlotId);
        if (existing is not null)
        {
            entries.Remove(existing);
        }

        var entry = DailyNutritionLogEntry.Create(TenantId, Id, planSlotId, selectedPlanChoiceId, recipeName, servings, calories, protein, carbohydrate, fat);
        entries.Add(entry);
        return entry;
    }

    public void Complete(DateTimeOffset now)
    {
        if (Status == DailyNutritionLogStatus.Completed || entries.Count == 0)
        {
            throw new InvalidOperationException("Only a non-empty in-progress log can be completed.");
        }

        Status = DailyNutritionLogStatus.Completed;
        CompletedAtUtc = now;
    }
}

public sealed class DailyNutritionLogEntry : TenantEntity
{
    private DailyNutritionLogEntry()
    {
    }

    private DailyNutritionLogEntry(Guid tenantId, Guid logId, Guid slotId, Guid selectedChoiceId, string recipeName, decimal servings, decimal calories, decimal protein, decimal carbohydrate, decimal fat) : base(tenantId)
    {
        DailyNutritionLogId = logId;
        ClientNutritionPlanSlotId = slotId;
        SelectedClientNutritionPlanChoiceId = selectedChoiceId;
        RecipeName = NutritionRules.RequiredText(recipeName, 300, nameof(recipeName));
        Servings = NutritionRules.Positive(servings, 1_000m, nameof(servings));
        Calories = NutritionRules.NonNegative(calories, nameof(calories));
        ProteinGrams = NutritionRules.NonNegative(protein, nameof(protein));
        CarbohydrateGrams = NutritionRules.NonNegative(carbohydrate, nameof(carbohydrate));
        FatGrams = NutritionRules.NonNegative(fat, nameof(fat));
    }

    public Guid DailyNutritionLogId { get; private set; }
    public Guid ClientNutritionPlanSlotId { get; private set; }
    public Guid SelectedClientNutritionPlanChoiceId { get; private set; }
    public string RecipeName { get; private set; } = string.Empty;
    public decimal Servings { get; private set; }
    public decimal Calories { get; private set; }
    public decimal ProteinGrams { get; private set; }
    public decimal CarbohydrateGrams { get; private set; }
    public decimal FatGrams { get; private set; }

    internal static DailyNutritionLogEntry Create(Guid tenantId, Guid logId, Guid slotId, Guid selectedChoiceId, string recipeName, decimal servings, decimal calories, decimal protein, decimal carbohydrate, decimal fat) =>
        new(tenantId, logId, slotId, selectedChoiceId, recipeName, servings, calories, protein, carbohydrate, fat);
}

public sealed class AllergenConflictRecord : TenantEntity
{
    private AllergenConflictRecord()
    {
    }

    private AllergenConflictRecord(Guid tenantId, Guid clientProfileId, Guid recipeVersionId, Guid? clientNutritionPlanId, string conflictCodes, string warningLanguage, Guid reviewedByUserId)
        : base(tenantId)
    {
        ClientProfileId = clientProfileId;
        RecipeVersionId = recipeVersionId;
        ClientNutritionPlanId = clientNutritionPlanId;
        ConflictCodes = NutritionRules.RequiredText(conflictCodes, 500, nameof(conflictCodes));
        WarningLanguage = NutritionRules.RequiredText(warningLanguage, 1_000, nameof(warningLanguage));
        ReviewedByUserId = reviewedByUserId;
    }

    public Guid ClientProfileId { get; private set; }
    public Guid RecipeVersionId { get; private set; }
    public Guid? ClientNutritionPlanId { get; private set; }
    public string ConflictCodes { get; private set; } = string.Empty;
    public string WarningLanguage { get; private set; } = string.Empty;
    public Guid ReviewedByUserId { get; private set; }

    public static AllergenConflictRecord Create(Guid tenantId, Guid clientProfileId, Guid recipeVersionId, Guid? planId, IEnumerable<AllergenCode> codes, string warningLanguage, Guid reviewedByUserId) =>
        new(tenantId, clientProfileId, recipeVersionId, planId, string.Join(',', codes.Distinct().Order()), warningLanguage, reviewedByUserId);
}

public sealed class ClientDeclaredAllergen : TenantEntity
{
    private ClientDeclaredAllergen()
    {
    }

    private ClientDeclaredAllergen(Guid tenantId, Guid clientProfileId, AllergenCode code, Guid recordedByUserId) : base(tenantId)
    {
        ClientProfileId = clientProfileId;
        Code = Enum.IsDefined(code) ? code : throw new ArgumentOutOfRangeException(nameof(code));
        RecordedByUserId = recordedByUserId == Guid.Empty ? throw new ArgumentException("An actor is required.", nameof(recordedByUserId)) : recordedByUserId;
        IsActive = true;
    }

    public Guid ClientProfileId { get; private set; }
    public AllergenCode Code { get; private set; }
    public Guid RecordedByUserId { get; private set; }
    public bool IsActive { get; private set; }
    public Guid? DeactivatedByUserId { get; private set; }
    public DateTimeOffset? DeactivatedAtUtc { get; private set; }

    public static ClientDeclaredAllergen Create(Guid tenantId, Guid clientProfileId, AllergenCode code, Guid recordedByUserId) =>
        new(tenantId, clientProfileId, code, recordedByUserId);

    public void Deactivate(Guid actorUserId, DateTimeOffset now)
    {
        if (!IsActive)
        {
            return;
        }

        IsActive = false;
        DeactivatedByUserId = actorUserId;
        DeactivatedAtUtc = now;
    }
}

public sealed class AiMealDraftOperation : TenantEntity
{
    private AiMealDraftOperation()
    {
    }

    private AiMealDraftOperation(Guid tenantId, string promptVersion, string schemaVersion, string providerKey) : base(tenantId)
    {
        PromptVersion = NutritionRules.RequiredText(promptVersion, 100, nameof(promptVersion));
        SchemaVersion = NutritionRules.RequiredText(schemaVersion, 100, nameof(schemaVersion));
        ProviderKey = NutritionRules.RequiredText(providerKey, 100, nameof(providerKey));
        Status = AiDraftStatus.Pending;
    }

    public AiDraftStatus Status { get; private set; }
    public string PromptVersion { get; private set; } = string.Empty;
    public string SchemaVersion { get; private set; } = string.Empty;
    public string ProviderKey { get; private set; } = string.Empty;
    public string? Model { get; private set; }
    public string? ModelVersion { get; private set; }
    public string? ValidatedDraftJson { get; private set; }
    public string? UncertainFieldsJson { get; private set; }
    public string? FailureCode { get; private set; }
    public decimal CostAmount { get; private set; }
    public string CostCurrency { get; private set; } = "USD";
    public Guid? ReviewedByUserId { get; private set; }
    public DateTimeOffset? ReviewedAtUtc { get; private set; }

    public static AiMealDraftOperation Start(Guid tenantId, string promptVersion, string schemaVersion, string providerKey) =>
        new(tenantId, promptVersion, schemaVersion, providerKey);

    public void Fail(string failureCode)
    {
        if (Status != AiDraftStatus.Pending)
        {
            throw new InvalidOperationException("Only a pending AI operation can fail.");
        }

        FailureCode = NutritionRules.RequiredText(failureCode, 100, nameof(failureCode));
        Status = AiDraftStatus.Failed;
    }

    public void AcceptValidatedDraft(string model, string modelVersion, string validatedDraftJson, string uncertainFieldsJson, decimal costAmount, string costCurrency)
    {
        if (Status != AiDraftStatus.Pending)
        {
            throw new InvalidOperationException("Only a pending AI operation can accept provider output.");
        }

        Model = NutritionRules.RequiredText(model, 100, nameof(model));
        ModelVersion = NutritionRules.RequiredText(modelVersion, 100, nameof(modelVersion));
        ValidatedDraftJson = NutritionRules.RequiredText(validatedDraftJson, 100_000, nameof(validatedDraftJson));
        UncertainFieldsJson = NutritionRules.RequiredText(uncertainFieldsJson, 20_000, nameof(uncertainFieldsJson));
        CostAmount = NutritionRules.NonNegative(costAmount, nameof(costAmount));
        CostCurrency = NutritionRules.RequiredText(costCurrency, 3, nameof(costCurrency)).ToUpperInvariant();
        Status = AiDraftStatus.AwaitingCoachReview;
    }

    public void Review(bool approved, Guid reviewerUserId, DateTimeOffset now)
    {
        if (Status != AiDraftStatus.AwaitingCoachReview || reviewerUserId == Guid.Empty)
        {
            throw new InvalidOperationException("Only a validated AI draft can be reviewed by a coach.");
        }

        Status = approved ? AiDraftStatus.Approved : AiDraftStatus.Rejected;
        ReviewedByUserId = reviewerUserId;
        ReviewedAtUtc = now;
    }
}

internal static class NutritionRules
{
    public static string RequiredText(string? value, int maxLength, string field)
    {
        var normalized = (value ?? string.Empty).Trim();
        if (normalized.Length is 0 || normalized.Length > maxLength)
        {
            throw new ArgumentException($"{field} is required and must be at most {maxLength} characters.", field);
        }

        return normalized;
    }

    public static string? OptionalText(string? value, int maxLength, string field)
    {
        var normalized = value?.Trim();
        if (normalized?.Length > maxLength)
        {
            throw new ArgumentException($"{field} must be at most {maxLength} characters.", field);
        }

        return string.IsNullOrEmpty(normalized) ? null : normalized;
    }

    public static decimal NonNegative(decimal value, string field) =>
        value is >= 0m and <= 1_000_000m ? value : throw new ArgumentOutOfRangeException(field, $"{field} must be non-negative.");

    public static decimal Positive(decimal value, decimal maximum, string field) =>
        value is > 0m && value <= maximum ? value : throw new ArgumentOutOfRangeException(field, $"{field} must be positive and no more than {maximum}.");
}
