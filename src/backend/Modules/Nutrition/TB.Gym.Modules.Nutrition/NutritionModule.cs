using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Nutrition;

public interface INutritionDataProvider
{
    Task<IReadOnlyList<FoodSearchResult>> SearchAsync(string query, CancellationToken cancellationToken);

    Task<FoodNutrients?> GetNutrientsAsync(string externalId, CancellationToken cancellationToken);
}

public sealed record FoodSearchResult(string ExternalId, string Name, string Provider);

public sealed record FoodNutrients(
    decimal BasisGrams,
    decimal Calories,
    decimal ProteinGrams,
    decimal CarbohydrateGrams,
    decimal FatGrams,
    string PreparationState,
    string Provider,
    DateTimeOffset RetrievedAtUtc);

public sealed class NutritionModule : IModuleMarker
{
    public const string Name = "Nutrition";
}
