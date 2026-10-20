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

    // Generic foods (lab-analysed, legacy reference and survey dishes such as "chicken breast,
    // baked") or US packaged products. Unfiltered, USDA lists branded items first.
    private static readonly string[] BasicDataTypes = ["Foundation", "SR Legacy", "Survey (FNDDS)"];
    private static readonly string[] PackagedDataTypes = ["Branded"];

    public Task<IReadOnlyList<FoodSearchResult>> SearchAsync(string query, FoodSearchKind kind, int skip, int take, CancellationToken cancellationToken)
    {
        EnsureConfigured();
        return ReachAsync<IReadOnlyList<FoodSearchResult>>(async () =>
        {
            var pageNumber = skip / take + 1;
            // The criteria go in a POST body: USDA's edge refused about half the GET searches whose
            // address held "Survey (FNDDS)" (checked 2026-10-07), and none of the POSTs.
            var criteria = new
            {
                query,
                dataType = kind == FoodSearchKind.Packaged ? PackagedDataTypes : BasicDataTypes,
                pageSize = take,
                pageNumber,
            };
            using var response = await httpClient.PostAsJsonAsync($"foods/search?api_key={Uri.EscapeDataString(options.Value.ApiKey)}", criteria, cancellationToken);
            await EnsureSuccessAsync(response, cancellationToken);
            var payload = await response.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: cancellationToken);
            if (payload.ValueKind != JsonValueKind.Object || !payload.TryGetProperty("foods", out var foods) || foods.ValueKind != JsonValueKind.Array)
            {
                throw new NutritionProviderUnavailableException("usda_schema_changed", UnexpectedAnswer);
            }

            return foods.EnumerateArray().Select(ToSearchResult).OfType<FoodSearchResult>().ToArray();
        }, cancellationToken);
    }

    private const string UnexpectedAnswer = "USDA FoodData Central returned an unexpected response. No data was imported.";

    /// <summary>
    /// A USDA outage, a timeout or an answer that is not the JSON USDA documents is one of the designed
    /// failures (NUT-003, BEA-2), as the Anthropic adapter treats the same: the coach is told USDA is
    /// unavailable and nothing is imported. A request its caller cancelled stays cancelled.
    /// </summary>
    private static async Task<T> ReachAsync<T>(Func<Task<T>> call, CancellationToken cancellationToken)
    {
        try
        {
            return await call();
        }
        catch (HttpRequestException)
        {
            throw new NutritionProviderUnavailableException("usda_unreachable", "USDA FoodData Central couldn’t be reached, so nothing was imported. Try again in a minute.");
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new NutritionProviderUnavailableException("usda_timeout", "USDA FoodData Central took too long to answer, so nothing was imported. Try again in a minute.");
        }
        catch (Exception exception) when (exception is JsonException or NotSupportedException or InvalidOperationException or FormatException)
        {
            throw new NutritionProviderUnavailableException("usda_schema_changed", UnexpectedAnswer);
        }
    }

    /// <summary>
    /// One match with its brand and its nutrients per 100 g, so the coach can tell matches apart
    /// before copying one. A match without protein, fat or carbohydrate is left out: importing it
    /// would be refused (NUT-003).
    /// </summary>
    private FoodSearchResult? ToSearchResult(JsonElement item)
    {
        var nutrients = item.TryGetProperty("foodNutrients", out var array) && array.ValueKind == JsonValueKind.Array
            ? array.EnumerateArray().ToArray()
            : [];
        var protein = FindNutrient(nutrients, ["Protein"], "G");
        var carbohydrate = FindNutrient(nutrients, ["Carbohydrate, by difference", "Carbohydrate, by summation"], "G");
        var fat = FindNutrient(nutrients, ["Total lipid (fat)"], "G");
        if (protein is null || carbohydrate is null || fat is null)
        {
            return null;
        }

        return new FoodSearchResult(
            ReadNumberAsString(item, "fdcId"),
            ReadableName(ReadRequiredString(item, "description")),
            ReadOptionalString(item, "dataType") ?? "Unknown",
            ProviderKey,
            ReadOptionalString(item, "brandName") is { Length: > 0 } brand ? brand : ReadOptionalString(item, "brandOwner"),
            StatedEnergy(nutrients),
            protein,
            carbohydrate,
            fat);
    }

    public Task<ProviderFoodRecord?> GetFoodAsync(string externalId, CancellationToken cancellationToken)
    {
        EnsureConfigured();
        return ReachAsync<ProviderFoodRecord?>(async () =>
        {
            using var response = await httpClient.GetAsync($"food/{Uri.EscapeDataString(externalId)}?api_key={Uri.EscapeDataString(options.Value.ApiKey)}", cancellationToken);
            if (response.StatusCode == System.Net.HttpStatusCode.NotFound)
            {
                return null;
            }

            await EnsureSuccessAsync(response, cancellationToken);
            var payload = await response.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: cancellationToken);
            var nutrients = payload.ValueKind == JsonValueKind.Object && payload.TryGetProperty("foodNutrients", out var array) && array.ValueKind == JsonValueKind.Array
                ? array.EnumerateArray().ToArray()
                : throw new NutritionProviderUnavailableException("usda_schema_changed", "USDA FoodData Central returned no structured nutrient array. No data was imported.");
            var unreported = new List<UnreportedNutrient>();

            return new ProviderFoodRecord(
                ReadNumberAsString(payload, "fdcId"),
                ReadableName(ReadRequiredString(payload, "description")),
                ReadOptionalString(payload, "dataType") ?? "Unknown",
                100m,
                PreparationBasis.AsSold,
                StatedEnergy(nutrients),
                RequireNutrient(nutrients, ["Protein"], "G"),
                RequireNutrient(nutrients, ["Carbohydrate, by difference", "Carbohydrate, by summation"], "G"),
                RequireNutrient(nutrients, ["Total lipid (fat)"], "G"),
                OptionalNutrient(nutrients, ["Fiber, total dietary"], "G", UnreportedNutrient.Fibre, unreported),
                OptionalNutrient(nutrients, ["Sugar alcohols", "Polyols, total"], "G", UnreportedNutrient.Polyols, unreported),
                OptionalNutrient(nutrients, ["Alcohol, ethyl"], "G", UnreportedNutrient.Ethanol, unreported),
                [],
                ProviderKey,
                clock.UtcNow,
                unreported);
        }, cancellationToken);
    }

    /// <summary>
    /// USDA writes packaged products' names in capitals ("GREEK YOGURT") and its basic foods in
    /// sentence case ("Chicken, breast, meat and skin, raw"). A name in capitals is put in the same
    /// sentence case, so the two read alike in one list; any other name is kept as USDA wrote it.
    /// </summary>
    internal static string ReadableName(string name)
    {
        if (!name.Any(char.IsUpper) || name.Any(char.IsLower))
        {
            return name;
        }

        var characters = name.ToLowerInvariant().ToCharArray();
        var first = Array.FindIndex(characters, char.IsLetter);
        characters[first] = char.ToUpperInvariant(characters[first]);
        return new string(characters);
    }

    // Foundation foods state energy only under the Atwater names, so a search and an import both
    // fall back to the general factors.
    private static decimal? StatedEnergy(IReadOnlyList<JsonElement> nutrients) =>
        FindNutrient(nutrients, ["Energy"], "KCAL") ?? FindNutrient(nutrients, ["Energy (Atwater General Factors)"], "KCAL");

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
            $"USDA FoodData Central did not report {acceptedNames[0]} for this food, so it was not imported. Choose another result or add the food yourself.");

    // USDA rarely reports fibre, polyols or ethanol. A missing one is stored as zero and recorded as
    // unreported, so the coach can see the zero was not stated by USDA and correct it.
    private static decimal OptionalNutrient(
        IReadOnlyList<JsonElement> nutrients,
        IReadOnlyList<string> acceptedNames,
        string expectedUnit,
        UnreportedNutrient nutrient,
        List<UnreportedNutrient> unreported)
    {
        var value = FindNutrient(nutrients, acceptedNames, expectedUnit);
        if (value is null)
        {
            unreported.Add(nutrient);
        }

        return value ?? 0m;
    }

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

    public bool IsConfigured => false;

    public Task<AiMealDraftProviderResult> GenerateAsync(AiMealDraftProviderRequest request, CancellationToken cancellationToken) =>
        Task.FromResult(new AiMealDraftProviderResult(false, string.Empty, string.Empty, string.Empty, 0m, "USD", "ai_provider_not_configured"));
}
