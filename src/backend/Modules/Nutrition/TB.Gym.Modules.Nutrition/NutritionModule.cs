using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Nutrition;

public interface INutritionDataProvider
{
    string ProviderKey { get; }

    Task<IReadOnlyList<FoodSearchResult>> SearchAsync(
        string query,
        FoodSearchKind kind,
        int skip,
        int take,
        CancellationToken cancellationToken);

    Task<ProviderFoodRecord?> GetFoodAsync(string externalId, CancellationToken cancellationToken);
}

/// <summary>
/// Which provider foods a search lists (R4.4c). USDA's branded list is US packaged products and
/// outnumbers its generic foods, so basic foods come first and packaged products are asked for.
/// </summary>
public enum FoodSearchKind
{
    Basic = 1,
    Packaged = 2,
}

/// <param name="Calories">The provider's stated energy, per 100 g or ml like the other nutrients;
/// a food copied into the workspace has its calories worked out again by the energy policy.</param>
/// <param name="CarbohydrateGrams">Total carbohydrate, as on <see cref="ProviderFoodRecord"/>.</param>
public sealed record FoodSearchResult(
    string ExternalId,
    string Name,
    string DataType,
    string Provider,
    string? Brand = null,
    decimal? Calories = null,
    decimal? ProteinGrams = null,
    decimal? CarbohydrateGrams = null,
    decimal? FatGrams = null);

/// <param name="CarbohydrateGrams">
/// TOTAL carbohydrate including fibre and polyols, matching USDA "Carbohydrate, by difference".
/// Adapters must not pre-subtract; <see cref="EnergyNutrients"/> uses the same convention and each
/// energy policy derives what it needs.
/// </param>
public sealed record ProviderFoodRecord(
    string ExternalId,
    string Name,
    string DataType,
    decimal BasisGrams,
    PreparationBasis PreparationBasis,
    decimal? ProviderCalories,
    decimal ProteinGrams,
    decimal CarbohydrateGrams,
    decimal FatGrams,
    decimal FibreGrams,
    decimal PolyolGrams,
    decimal EthanolGrams,
    IReadOnlyList<AllergenCode> DeclaredAllergens,
    string Provider,
    DateTimeOffset RetrievedAtUtc,
    IReadOnlyList<UnreportedNutrient>? UnreportedNutrients = null);

public interface IAiMealDraftProvider
{
    string ProviderKey { get; }

    bool IsConfigured => true;

    AiMealDraftCostEstimate EstimateMaximumCost(AiMealDraftProviderRequest request) => new(0m, "USD");

    Task<AiMealDraftProviderResult> GenerateAsync(
        AiMealDraftProviderRequest request,
        CancellationToken cancellationToken);
}

public sealed record AiMealDraftCostEstimate(decimal Amount, string Currency);

public sealed record AiMealDraftProviderRequest(
    string Prompt,
    string PromptVersion,
    string RequiredSchemaVersion,
    string Culture);

public sealed record AiMealDraftProviderResult(
    bool IsSuccess,
    string Model,
    string ModelVersion,
    string RawOutput,
    decimal CostAmount,
    string CostCurrency,
    string? FailureCode = null,
    bool CostIsKnown = true);

public sealed class NutritionModule : IModuleMarker
{
    public const string Name = "Nutrition";
}
