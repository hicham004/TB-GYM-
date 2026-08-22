using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Options;
using TB.Gym.Modules.Nutrition;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

internal sealed class UsdaFoodDataCentralOptions
{
    public string BaseUrl { get; set; } = "https://api.nal.usda.gov/fdc/v1/";

    public string ApiKey { get; set; } = string.Empty;
}

internal sealed class UsdaFoodDataCentralProvider(
    HttpClient httpClient,
    IOptions<UsdaFoodDataCentralOptions> options,
    IClock clock) : INutritionDataProvider
{
    public string ProviderKey => "UsdaFdc";

    public async Task<IReadOnlyList<FoodSearchResult>> SearchAsync(string query, int skip, int take, CancellationToken cancellationToken)
    {
        EnsureConfigured();
        var pageNumber = skip / take + 1;
        var uri = $"foods/search?api_key={Uri.EscapeDataString(options.Value.ApiKey)}&query={Uri.EscapeDataString(query)}&pageSize={take.ToString(CultureInfo.InvariantCulture)}&pageNumber={pageNumber.ToString(CultureInfo.InvariantCulture)}";
        using var response = await httpClient.GetAsync(uri, cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: cancellationToken);
        if (!payload.TryGetProperty("foods", out var foods) || foods.ValueKind != JsonValueKind.Array)
        {
            throw new NutritionProviderUnavailableException("usda_schema_changed", "USDA FoodData Central returned an unexpected response. No data was imported.");
        }

        return foods.EnumerateArray().Select(item => new FoodSearchResult(
            ReadNumberAsString(item, "fdcId"),
            ReadRequiredString(item, "description"),
            ReadOptionalString(item, "dataType") ?? "Unknown",
            ProviderKey)).ToArray();
    }

    public async Task<ProviderFoodRecord?> GetFoodAsync(string externalId, CancellationToken cancellationToken)
    {
        EnsureConfigured();
        using var response = await httpClient.GetAsync($"food/{Uri.EscapeDataString(externalId)}?api_key={Uri.EscapeDataString(options.Value.ApiKey)}", cancellationToken);
        if (response.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return null;
        }

        await EnsureSuccessAsync(response, cancellationToken);
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: cancellationToken);
        var nutrients = payload.TryGetProperty("foodNutrients", out var array) && array.ValueKind == JsonValueKind.Array
            ? array.EnumerateArray().ToArray()
            : throw new NutritionProviderUnavailableException("usda_schema_changed", "USDA FoodData Central returned no structured nutrient array. No data was imported.");

        return new ProviderFoodRecord(
            ReadNumberAsString(payload, "fdcId"),
            ReadRequiredString(payload, "description"),
            ReadOptionalString(payload, "dataType") ?? "Unknown",
            100m,
            PreparationBasis.AsSold,
            FindNutrient(nutrients, ["Energy"], "KCAL"),
            RequireNutrient(nutrients, ["Protein"], "G"),
            RequireNutrient(nutrients, ["Carbohydrate, by difference", "Carbohydrate, by summation"], "G"),
            RequireNutrient(nutrients, ["Total lipid (fat)"], "G"),
            RequireNutrient(nutrients, ["Fiber, total dietary"], "G"),
            RequireNutrient(nutrients, ["Sugar alcohols", "Polyols, total"], "G"),
            RequireNutrient(nutrients, ["Alcohol, ethyl"], "G"),
            [],
            ProviderKey,
            clock.UtcNow);
    }

    private void EnsureConfigured()
    {
        if (string.IsNullOrWhiteSpace(options.Value.ApiKey))
        {
            throw new NutritionProviderUnavailableException("usda_api_key_missing", "USDA FoodData Central is not configured. Add the data.gov API key to server configuration; do not place it in source control.");
        }
    }

    private static async Task EnsureSuccessAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        if (response.IsSuccessStatusCode)
        {
            return;
        }

        var providerRequestId = response.Headers.TryGetValues("X-Request-Id", out var values) ? values.FirstOrDefault() : null;
        await response.Content.LoadIntoBufferAsync(cancellationToken);
        throw new NutritionProviderUnavailableException(
            $"usda_http_{(int)response.StatusCode}",
            providerRequestId is null
                ? "USDA FoodData Central is temporarily unavailable. No data was imported."
                : $"USDA FoodData Central is temporarily unavailable (request {providerRequestId}). No data was imported.");
    }

    private static decimal? FindNutrient(IReadOnlyList<JsonElement> nutrients, IReadOnlyList<string> acceptedNames, string expectedUnit)
    {
        foreach (var item in nutrients)
        {
            var nutrient = item.TryGetProperty("nutrient", out var nested) ? nested : item;
            var name = ReadOptionalString(nutrient, "name") ?? ReadOptionalString(item, "nutrientName");
            var unit = ReadOptionalString(nutrient, "unitName") ?? ReadOptionalString(item, "unitName");
            if (!acceptedNames.Contains(name, StringComparer.OrdinalIgnoreCase) || !string.Equals(unit, expectedUnit, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (item.TryGetProperty("amount", out var amount) && amount.TryGetDecimal(out var value))
            {
                return value;
            }

            if (item.TryGetProperty("value", out var legacyValue) && legacyValue.TryGetDecimal(out value))
            {
                return value;
            }
        }

        return null;
    }

    private static decimal RequireNutrient(IReadOnlyList<JsonElement> nutrients, IReadOnlyList<string> acceptedNames, string expectedUnit) =>
        FindNutrient(nutrients, acceptedNames, expectedUnit)
        ?? throw new NutritionProviderUnavailableException(
            "usda_nutrient_incomplete",
            $"USDA FoodData Central did not report {acceptedNames[0]} in {expectedUnit}. No zero was inferred and no data was imported.");

    private static string ReadNumberAsString(JsonElement element, string property)
    {
        if (!element.TryGetProperty(property, out var value))
        {
            throw new NutritionProviderUnavailableException("usda_schema_changed", $"USDA FoodData Central omitted {property}. No data was imported.");
        }

        return value.ValueKind == JsonValueKind.Number ? value.GetRawText() : value.GetString() ?? string.Empty;
    }

    private static string ReadRequiredString(JsonElement element, string property) =>
        ReadOptionalString(element, property) is { Length: > 0 } value
            ? value
            : throw new NutritionProviderUnavailableException("usda_schema_changed", $"USDA FoodData Central omitted {property}. No data was imported.");

    private static string? ReadOptionalString(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
}

internal sealed class UnavailableAiMealDraftProvider : IAiMealDraftProvider
{
    public string ProviderKey => "Unavailable";

    public Task<AiMealDraftProviderResult> GenerateAsync(AiMealDraftProviderRequest request, CancellationToken cancellationToken) =>
        Task.FromResult(new AiMealDraftProviderResult(false, string.Empty, string.Empty, string.Empty, 0m, "USD", "ai_provider_not_configured"));
}
