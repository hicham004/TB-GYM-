using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Nutrition;

public interface INutritionDataProvider
{
    string ProviderKey { get; }

    Task<IReadOnlyList<FoodSearchResult>> SearchAsync(
        string query,
        int skip,
        int take,
        CancellationToken cancellationToken);

    Task<ProviderFoodRecord?> GetFoodAsync(string externalId, CancellationToken cancellationToken);
}

public sealed record FoodSearchResult(
    string ExternalId,
    string Name,
    string DataType,
    string Provider);

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
    DateTimeOffset RetrievedAtUtc);

public interface IAiMealDraftProvider
{
    string ProviderKey { get; }

    Task<AiMealDraftProviderResult> GenerateAsync(
        AiMealDraftProviderRequest request,
        CancellationToken cancellationToken);
}

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
    string? FailureCode = null);

public sealed class NutritionModule : IModuleMarker
{
    public const string Name = "Nutrition";
}
