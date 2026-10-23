using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using TB.Gym.Modules.Nutrition;
using ClientEnrollmentView = TB.Gym.Modules.Subscriptions.ClientEnrollmentView;
using CoachingProductView = TB.Gym.Modules.Subscriptions.CoachingProductView;
using OfferDurationUnit = TB.Gym.Modules.Subscriptions.OfferDurationUnit;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The audit's batch A16b, the owner's extras (docs/FULL-AUDIT-2026-10.md, section 11, Batch 15): a coach weighs a
/// raw food cooked through a raw-to-cooked conversion of their own, its yield and retention factors saved together
/// (INV-6); a plan is sold in days (INV-7); and the workspace's language is English or Arabic (INV-8).
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string A16bConversionsUrl = "/api/nutrition/cooking-conversions";

    private const string A16bRice = "White rice, boiled";

    private const string A16bUsda = "USDA cooking yields, 2014";

    [TestMethod]
    public async Task A16bACoachSavesAConversionOnceAndFindsItByNameOrSource()
    {
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "a16b-convert-coach@example.test", "Hicham Haddad", "A16b Convert");

        // TB Gym seeds no numbers (ADR 0008): a new workspace has no conversion.
        Assert.AreEqual(0, (await ReadSliceAsync<CookingConversionPage>(coach, A16bConversionsUrl)).Total);

        var rice = await A16bConversionAsync(coach, $"  {A16bRice} ", $" {A16bUsda}  ", 2.9m, 1m);
        Assert.AreEqual((A16bRice, A16bUsda), (rice.SourceKey, rice.SourceVersion));
        Assert.AreEqual(
            (CookingFactorKind.Yield, 2.9m, PreparationBasis.Raw, PreparationBasis.Cooked, A16bRice, A16bUsda),
            (rice.Yield.Kind, rice.Yield.Factor, rice.Yield.FromBasis, rice.Yield.ToBasis, rice.Yield.SourceKey, rice.Yield.SourceVersion));
        Assert.AreEqual((CookingFactorKind.Retention, 1m, A16bRice), (rice.Retention.Kind, rice.Retention.Factor, rice.Retention.SourceKey));

        // The same save again, a retry or a double tap, answers with the conversion saved first.
        var again = await A16bConversionAsync(coach, A16bRice, A16bUsda, 2.9m, 1m);
        Assert.AreEqual((rice.Yield.Id, rice.Retention.Id), (again.Yield.Id, again.Retention.Id));

        // Other numbers under the same name and source are refused, never replaced.
        await RefreshCsrfAsync(coach);
        Assert.AreEqual(
            ("cooking_conversion_taken", $"A conversion for “{A16bRice}” from “{A16bUsda}” already has other numbers. Give the new one another name or source."),
            await A7ConflictAsync(await coach.PostAsJsonAsync(A16bConversionsUrl, A16bConversion(A16bRice, A16bUsda, 3.1m, 1m))));
        await RefreshCsrfAsync(coach);
        Assert.AreEqual("cooking_conversion_taken", (await A7ConflictAsync(
            await coach.PostAsJsonAsync(A16bConversionsUrl, A16bConversion(A16bRice, A16bUsda, 2.9m, 0.95m)))).Code);

        // A name and source are read as a coach reads them, without case: other capitals are the same
        // conversion, kept as first written, and its numbers stand.
        var capitals = await A16bConversionAsync(coach, "WHITE RICE, BOILED", "usda cooking yields, 2014", 2.9m, 1m);
        Assert.AreEqual((rice.Yield.Id, rice.Retention.Id, A16bRice), (capitals.Yield.Id, capitals.Retention.Id, capitals.SourceKey));
        await RefreshCsrfAsync(coach);
        Assert.AreEqual(
            ("cooking_conversion_taken", $"A conversion for “{A16bRice}” from “{A16bUsda}” already has other numbers. Give the new one another name or source."),
            await A7ConflictAsync(await coach.PostAsJsonAsync(A16bConversionsUrl, A16bConversion("White Rice, Boiled", A16bUsda, 3.1m, 1m))));
        Assert.AreEqual(2L, await A7ScalarAsync("SELECT count(*) FROM nutrition.\"CookingFactors\""));

        // The coach's own weighing is another source and another conversion; chicken loses weight cooking.
        var weighed = await A16bConversionAsync(coach, A16bRice, "Weighed in my kitchen", 3.1m, 1m);
        var chicken = await A16bConversionAsync(coach, "Chicken breast, grilled", A16bUsda, 0.75m, 0.95m);

        // Listed by name, then source, and paged; found by every word of a search in either, wildcards taken
        // literally.
        var all = await ReadSliceAsync<CookingConversionPage>(coach, A16bConversionsUrl);
        Assert.AreEqual(3, all.Total);
        CollectionAssert.AreEqual(
            new[] { chicken.Yield.Id, rice.Yield.Id, weighed.Yield.Id },
            all.Items.Select(item => item.Yield.Id).ToArray());
        Assert.AreEqual(weighed.Retention.Id, all.Items[2].Retention.Id, "Each yield is listed with its own retention.");
        var second = await ReadSliceAsync<CookingConversionPage>(coach, $"{A16bConversionsUrl}?skip=1&take=1");
        Assert.AreEqual((3, rice.Yield.Id), (second.Total, second.Items.Single().Yield.Id));
        foreach (var (query, expected) in new[]
        {
            ("rice usda", new[] { rice.Yield.Id }),
            ("KITCHEN", new[] { weighed.Yield.Id }),
            ("2014", new[] { chicken.Yield.Id, rice.Yield.Id }),
            ("%", Array.Empty<Guid>()),
            ("_", Array.Empty<Guid>()),
        })
        {
            var found = await ReadSliceAsync<CookingConversionPage>(coach, $"{A16bConversionsUrl}?query={Uri.EscapeDataString(query)}");
            CollectionAssert.AreEqual(expected, found.Items.Select(item => item.Yield.Id).ToArray(), query);
        }

        // A refusal names the field at fault, in words.
        foreach (var (request, field, words) in new (object Request, string Field, string Words)[]
        {
            (A16bConversion(A16bRice, "Weighed again", 0m, 1m), "yieldFactor", "The cooked weight must be above 0 and at most 5 times the raw weight, to six decimals."),
            (A16bConversion(A16bRice, "Weighed again", 5.5m, 1m), "yieldFactor", "The cooked weight must be above 0 and at most 5 times the raw weight, to six decimals."),
            (A16bConversion(A16bRice, "Weighed again", 2.1234567m, 1m), "yieldFactor", "The cooked weight must be above 0 and at most 5 times the raw weight, to six decimals."),
            (A16bConversion(A16bRice, "Weighed again", 3m, 1.2m), "retentionFactor", "The share of protein, carbs and fat kept must be above 0 and at most all of it, to six decimals."),
            (A16bConversion("  ", "Weighed again", 3m, 1m), "sourceKey", "Say what the conversion is for, in up to 200 characters."),
            (A16bConversion(new string('r', 201), "Weighed again", 3m, 1m), "sourceKey", "Say what the conversion is for, in up to 200 characters."),
            (A16bConversion(A16bRice, "", 3m, 1m), "sourceVersion", "Say where its numbers come from, in up to 100 characters."),
        })
        {
            await RefreshCsrfAsync(coach);
            Assert.AreEqual(words, await A7FieldErrorAsync(await coach.PostAsJsonAsync(A16bConversionsUrl, request), field));
        }

        Assert.AreEqual(6L, await A7ScalarAsync("SELECT count(*) FROM nutrition.\"CookingFactors\""), "Nothing refused was kept.");

        // The database keeps a factor as first written.
        await A7RefusedAsync($"UPDATE nutrition.\"CookingFactors\" SET \"Factor\" = 3 WHERE \"Id\" = '{rice.Yield.Id}'");
        await A7RefusedAsync($"DELETE FROM nutrition.\"CookingFactors\" WHERE \"Id\" = '{rice.Retention.Id}'");

        // The single-factor routes no screen called are gone (audit INV-12's rule).
        await AssertStatusAsync(await coach.GetAsync("/api/nutrition/cooking-factors"), HttpStatusCode.NotFound);
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PostAsJsonAsync("/api/nutrition/cooking-factors", new { }), HttpStatusCode.NotFound);

        // Only the workspace's staff reach them: signed out 401, a client 403, and another workspace has its own.
        using var stranger = CreateClient();
        await AssertStatusAsync(await stranger.GetAsync(A16bConversionsUrl), HttpStatusCode.Unauthorized);
        using var maya = CreateClient();
        await R31InviteAsync(coach, maya, tenant, "a16b-convert-maya@example.test", "Maya", "Rahman");
        await AssertStatusAsync(await maya.GetAsync(A16bConversionsUrl), HttpStatusCode.Forbidden);
        await RefreshCsrfAsync(maya);
        await AssertStatusAsync(await maya.PostAsJsonAsync(A16bConversionsUrl, A16bConversion("Lentils", "Weighed", 2.5m, 1m)), HttpStatusCode.Forbidden);
        using var other = CreateClient();
        var otherTenant = await RegisterCoachAsync(other, "a16b-convert-other@example.test", "Lina Saad", "A16b Other");
        Assert.AreEqual(0, (await ReadSliceAsync<CookingConversionPage>(other, A16bConversionsUrl)).Total);
        var theirs = await A16bConversionAsync(other, A16bRice, A16bUsda, 3.1m, 1m);
        Assert.AreNotEqual(rice.Yield.Id, theirs.Yield.Id);
        Assert.AreEqual(2.9m, (await ReadSliceAsync<CookingConversionPage>(coach, $"{A16bConversionsUrl}?query=usda")).Items
            .Single(item => item.SourceKey == A16bRice).Yield.Factor, "The other workspace's numbers do not reach this one.");

        // A coach naming a workspace they are not in is refused there.
        SetTenant(coach, otherTenant);
        await AssertStatusAsync(await coach.GetAsync(A16bConversionsUrl), HttpStatusCode.Forbidden);
        SetTenant(coach, tenant);
    }

    [TestMethod]
    public async Task A16bTwoSavesOfOneConversionAtOnceKeepOne()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "a16b-race-coach@example.test", "Hicham Haddad", "A16b Race");

        // The same conversion twice at once: both answer with the one kept.
        await RefreshCsrfAsync(coach);
        var same = await Task.WhenAll(
            coach.PostAsJsonAsync(A16bConversionsUrl, A16bConversion(A16bRice, A16bUsda, 2.9m, 1m)),
            coach.PostAsJsonAsync(A16bConversionsUrl, A16bConversion(A16bRice, A16bUsda, 2.9m, 1m)));
        foreach (var response in same)
        {
            await AssertStatusAsync(response, HttpStatusCode.OK);
        }

        var kept = await Task.WhenAll(same.Select(ReadSlicePayloadAsync<CookingConversionView>));
        Assert.AreEqual((kept[0].Yield.Id, kept[0].Retention.Id), (kept[1].Yield.Id, kept[1].Retention.Id));
        Assert.AreEqual(2L, await A7ScalarAsync("SELECT count(*) FROM nutrition.\"CookingFactors\""));

        // Two different numbers for one name and source at once: one is kept, the other refused, never a fault.
        await RefreshCsrfAsync(coach);
        var differing = await Task.WhenAll(
            coach.PostAsJsonAsync(A16bConversionsUrl, A16bConversion("Bulgur, boiled", A16bUsda, 2.6m, 1m)),
            coach.PostAsJsonAsync(A16bConversionsUrl, A16bConversion("Bulgur, boiled", A16bUsda, 2.8m, 1m)));
        CollectionAssert.AreEquivalent(
            new[] { HttpStatusCode.OK, HttpStatusCode.Conflict },
            differing.Select(response => response.StatusCode).ToArray());
        var winner = await ReadSlicePayloadAsync<CookingConversionView>(differing.Single(response => response.StatusCode == HttpStatusCode.OK));
        var stored = (await ReadSliceAsync<CookingConversionPage>(coach, $"{A16bConversionsUrl}?query=bulgur")).Items.Single();
        Assert.AreEqual((winner.Yield.Id, winner.Yield.Factor), (stored.Yield.Id, stored.Yield.Factor));
        Assert.AreEqual(4L, await A7ScalarAsync("SELECT count(*) FROM nutrition.\"CookingFactors\""));
    }

    [TestMethod]
    public async Task A16bARawFoodWeighedCookedCountsTheRawShareItCameFrom()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "a16b-cooked-coach@example.test", "Hicham Haddad", "A16b Cooked");
        // 100 g of raw rice holds 7 g protein, 80 g carbs and 0.6 g fat; boiled, it weighs 2.5 times as much and
        // keeps 90% of them.
        var rice = await A16bFoodAsync(coach, "White rice, raw", "Gram", 7m, 80m, 0.6m);
        var conversion = await A16bConversionAsync(coach, A16bRice, "Weighed in my kitchen", 2.5m, 0.9m);

        var made = await R44bCreateAsync(coach, A16bRecipe("Rice bowl", [A16bCooked(rice, 150m, conversion)]));
        var line = (await ReadSliceAsync<RecipeDetail>(coach, $"/api/nutrition/recipes/{made.Id}")).Latest.Ingredients.Single();

        // 150 g cooked is 60 g raw, of which 90% is kept.
        Assert.AreEqual((PreparationBasis.Cooked, FoodQuantityUnit.Gram, 150m), (line.Basis, line.Unit, line.Quantity));
        Assert.AreEqual(7m * 0.54m, line.ProteinGrams, StoredPrecision);
        Assert.AreEqual(80m * 0.54m, line.CarbohydrateGrams, StoredPrecision);
        Assert.AreEqual(0.6m * 0.54m, line.FatGrams, StoredPrecision);
        // The read names the conversion, so the editor can show it and weigh the line raw again.
        Assert.AreEqual((conversion.Yield.Id, conversion.Retention.Id), (line.YieldFactorId, line.RetentionFactorId));
        Assert.AreEqual((A16bRice, 2.5m), (line.YieldFactor?.SourceKey, line.YieldFactor?.Factor));
        Assert.AreEqual(("Weighed in my kitchen", 0.9m), (line.RetentionFactor?.SourceVersion, line.RetentionFactor?.Factor));

        // Weighed raw again, the line is the food's own and names no conversion.
        await R44bAddVersionAsync(coach, made.Id, A16bVersion(made.Revision, [new RecipeIngredientRequest(rice.VersionId, 60m, FoodQuantityUnit.Gram, PreparationBasis.Raw)]));
        var raw = (await ReadSliceAsync<RecipeDetail>(coach, $"/api/nutrition/recipes/{made.Id}")).Latest.Ingredients.Single();
        Assert.AreEqual((PreparationBasis.Raw, 60m, 7m * 0.6m), (raw.Basis, raw.Quantity, raw.ProteinGrams));
        Assert.AreEqual(((Guid?)null, (CookingFactorView?)null), (raw.YieldFactorId, raw.YieldFactor));

        // A conversion this workspace does not hold, one factor where the other kind belongs, or the yield of one
        // conversion with the retention of another is refused rather than left out, which would count the line
        // raw or through neither.
        using var other = CreateClient();
        await RegisterCoachAsync(other, "a16b-cooked-other@example.test", "Lina Saad", "A16b Other Kitchen");
        var theirs = await A16bConversionAsync(other, A16bRice, "Weighed in my kitchen", 2.5m, 0.9m);
        var chicken = await A16bConversionAsync(coach, "Chicken breast, grilled", "Weighed in my kitchen", 0.75m, 0.95m);
        var notFound = "The cooking conversion for “White rice, raw” was not found in this coaching space. Choose it again.";
        foreach (var wrong in new[]
        {
            new RecipeIngredientRequest(rice.VersionId, 150m, FoodQuantityUnit.Gram, PreparationBasis.Cooked, theirs.Yield.Id, theirs.Retention.Id),
            new RecipeIngredientRequest(rice.VersionId, 150m, FoodQuantityUnit.Gram, PreparationBasis.Cooked, conversion.Retention.Id, conversion.Yield.Id),
            new RecipeIngredientRequest(rice.VersionId, 150m, FoodQuantityUnit.Gram, PreparationBasis.Cooked, conversion.Yield.Id, Guid.NewGuid()),
            new RecipeIngredientRequest(rice.VersionId, 150m, FoodQuantityUnit.Gram, PreparationBasis.Cooked, conversion.Yield.Id, chicken.Retention.Id),
        })
        {
            Assert.AreEqual(notFound, await A7FieldErrorAsync(await R44bPostCreateAsync(coach, A16bRecipe("Wrong bowl", [wrong])), "ingredients"));
        }

        // Only an amount in grams is weighed cooked; a cooked weight needs its conversion, and a raw one none.
        var bar = await A16bFoodAsync(coach, "Protein bar", "Serving", 20m, 25m, 8m);
        Assert.AreEqual(
            "Only an amount in grams can be weighed cooked, and “Protein bar” is measured another way.",
            await A7FieldErrorAsync(await R44bPostCreateAsync(coach, A16bRecipe("Bar", [
                new RecipeIngredientRequest(bar.VersionId, 1m, FoodQuantityUnit.Serving, PreparationBasis.Cooked, conversion.Yield.Id, conversion.Retention.Id)])), "ingredients"));
        await AssertStatusAsync(
            await R44bPostCreateAsync(coach, A16bRecipe("Unconverted", [new RecipeIngredientRequest(rice.VersionId, 150m, FoodQuantityUnit.Gram, PreparationBasis.Cooked)])),
            HttpStatusCode.BadRequest);
        await AssertStatusAsync(
            await R44bPostCreateAsync(coach, A16bRecipe("Raw twice", [
                new RecipeIngredientRequest(rice.VersionId, 60m, FoodQuantityUnit.Gram, PreparationBasis.Raw, conversion.Yield.Id, conversion.Retention.Id)])),
            HttpStatusCode.BadRequest);
        Assert.AreEqual(1L, await A7ScalarAsync("SELECT count(*) FROM nutrition.\"Recipes\""), "Nothing refused was kept.");
    }

    [TestMethod]
    public async Task A16bAPlanSoldInDaysEndsAfterThatManyDays()
    {
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "a16b-days-coach@example.test", "Hicham Haddad", "A16b Days");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(coach, maya, tenant, "a16b-days-maya@example.test", "Maya", "Rahman");

        await RefreshCsrfAsync(coach);
        var created = await coach.PostAsJsonAsync(A7ProductsUrl, new
        {
            name = "Monthly coaching",
            description = (string?)null,
            initialOffer = A16bDaysOffer(30, 90m),
        });
        await AssertStatusAsync(created, HttpStatusCode.OK);
        var product = await ReadSlicePayloadAsync<CoachingProductView>(created);
        var month = product.Offers.Single();
        Assert.AreEqual((30, OfferDurationUnit.Day, "30 days"), (month.DurationCount, month.DurationUnit, month.Label));

        // An option is its exact count and unit (ADR 0034): 28 days sells beside 4 weeks, a second 30 days does not.
        foreach (var offer in new[] { A7OfferRequest(4, 100m, "Training"), A16bDaysOffer(28, 95m) })
        {
            await RefreshCsrfAsync(coach);
            await AssertStatusAsync(await coach.PostAsJsonAsync($"{A7ProductsUrl}/{product.Id}/offers", offer), HttpStatusCode.OK);
        }

        await RefreshCsrfAsync(coach);
        Assert.AreEqual("active_offer_slot_conflict", (await A7ConflictAsync(
            await coach.PostAsJsonAsync($"{A7ProductsUrl}/{product.Id}/offers", A16bDaysOffer(30, 80m)))).Code);

        // Sold today, it ends after 30 days: its last day is the 30th.
        var today = TenantToday();
        ClientEnrollmentView plan = await A7EnrollAsync(coach, mayaId, month.Id, today);
        Assert.AreEqual((today, today.AddDays(30)), (plan.StartDate, plan.EndDateExclusive));
    }

    [TestMethod]
    public async Task A16bTheWorkspaceLanguageIsEnglishOrArabic()
    {
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "a16b-language-owner@example.test", "Hicham Haddad", "A16b Language");
        Assert.AreEqual("en-LB", (await A16bWorkspaceAsync(owner)).DefaultCulture);

        var arabic = await A16bSetLanguageAsync(owner, "ar-lb");
        await AssertStatusAsync(arabic, HttpStatusCode.OK);
        Assert.AreEqual("ar-LB", (await A16bWorkspaceAsync(owner)).DefaultCulture, "Stored as the culture's own name.");

        // Any other language is refused in words, and nothing changes.
        foreach (var culture in new[] { "fr-FR", "en-US", "xx" })
        {
            Assert.AreEqual(
                "Choose English or Arabic as the coaching space's language.",
                await A7FieldErrorAsync(await A16bSetLanguageAsync(owner, culture), "workspace"),
                culture);
        }

        Assert.AreEqual("ar-LB", (await A16bWorkspaceAsync(owner)).DefaultCulture);

        // A person who joins the space takes its language for themselves.
        using var maya = CreateClient();
        await R31InviteAsync(owner, maya, tenant, "a16b-language-maya@example.test", "Maya", "Rahman");
        Assert.AreEqual("ar-LB", (await RequiredJsonAsync<A16bMe>(await maya.GetAsync("/api/auth/me"))).PreferredCulture);

        // Registration asks the same.
        using var stranger = CreateClient();
        await RefreshCsrfAsync(stranger);
        Assert.AreEqual("Choose English or Arabic as the coaching space's language.", await A7FieldErrorAsync(
            await stranger.PostAsJsonAsync("/api/auth/register/coach", new
            {
                displayName = "Rita Daher",
                email = "a16b-language-rita@example.test",
                password = Password,
                workspaceName = "Rita Coaching",
                timeZoneId = "Asia/Beirut",
                defaultCulture = "fr-FR",
                defaultCurrencyCode = "USD",
                weekStartsOn = "Monday",
            }),
            "workspace"));
    }

    private static object A16bConversion(string sourceKey, string sourceVersion, decimal yieldFactor, decimal retentionFactor) =>
        new { sourceKey, sourceVersion, yieldFactor, retentionFactor };

    private static async Task<CookingConversionView> A16bConversionAsync(
        HttpClient coach, string sourceKey, string sourceVersion, decimal yieldFactor, decimal retentionFactor)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync(A16bConversionsUrl, A16bConversion(sourceKey, sourceVersion, yieldFactor, retentionFactor));
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<CookingConversionView>(response);
    }

    /// <summary>A coach's own food, raw, whose 100 g (or one serving) hold the macros given.</summary>
    private static async Task<R44bFood> A16bFoodAsync(HttpClient coach, string name, string unit, decimal protein, decimal carbs, decimal fat)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync("/api/nutrition/foods", new
        {
            name,
            provenance = "CoachAuthored",
            externalId = (string?)null,
            externalDataType = (string?)null,
            labelMediaAssetId = (Guid?)null,
            version = new
            {
                basisQuantity = unit == "Gram" ? 100m : 1m,
                basisUnit = unit,
                preparationBasis = "Raw",
                proteinGrams = protein,
                carbohydrateGrams = carbs,
                fatGrams = fat,
                fibreGrams = 0m,
                polyolGrams = 0m,
                ethanolGrams = 0m,
                providerCalories = (decimal?)null,
                sourceAttribution = "Coach authored test record",
                sourceRecordVersion = "a16b",
                declaredAllergens = Array.Empty<string>(),
            },
        });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        var food = await RequiredJsonAsync<Phase4Food>(response);
        return new R44bFood(food.Id, food.CurrentVersion.Id);
    }

    private static RecipeIngredientRequest A16bCooked(R44bFood food, decimal grams, CookingConversionView conversion) =>
        new(food.VersionId, grams, FoodQuantityUnit.Gram, PreparationBasis.Cooked, conversion.Yield.Id, conversion.Retention.Id);

    private static CreateRecipeRequest A16bRecipe(string name, IReadOnlyList<RecipeIngredientRequest> ingredients) =>
        new(name, "Boil, drain and serve.", 1m, ingredients);

    private static AddRecipeVersionRequest A16bVersion(int baseRevision, IReadOnlyList<RecipeIngredientRequest> ingredients) =>
        new("Boil, drain and serve.", 1m, ingredients, BaseRevision: baseRevision);

    private static object A16bDaysOffer(int days, decimal price) => new
    {
        label = $"{days} days",
        durationCount = days,
        durationUnit = "Day",
        priceAmount = price,
        priceCurrency = "USD",
        features = new[] { new { feature = "Training", allowsConcurrentCoverage = false } },
    };

    private static async Task<A8Workspace> A16bWorkspaceAsync(HttpClient owner) =>
        await owner.GetFromJsonAsync<A8Workspace>("/api/workspace") ?? throw new AssertFailedException("Workspace was empty.");

    private static async Task<HttpResponseMessage> A16bSetLanguageAsync(HttpClient owner, string culture)
    {
        var workspace = await A16bWorkspaceAsync(owner);
        await RefreshCsrfAsync(owner);
        return await owner.PutAsJsonAsync("/api/workspace", new
        {
            workspace.Name,
            workspace.TimeZoneId,
            defaultCulture = culture,
            workspace.DefaultCurrencyCode,
            workspace.WeekStartsOn,
            workspace.Version,
        });
    }

    private sealed record A16bMe(string PreferredCulture);
}
