using System.Net;
using System.Net.Http.Json;
using Npgsql;
using TB.Gym.Modules.Nutrition;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// R4.4c: Foods and the nutrition Settings page. A USDA search lists basic foods unless packaged
/// products are asked for, each match with its brand and its nutrients per 100 g, and leaves out a
/// match that could not be imported. Only the workspace owner changes the calculation defaults, and a
/// workspace's AI allowance never goes past TB Gym's ceiling: raising it above is refused, and an
/// allowance set before a lower ceiling counts only up to it. A food is archived rather than deleted,
/// a recipe line is offered its food's newer numbers, USDA's names in capitals read in sentence case,
/// and USDA's carbohydrate just below zero counts as 0 g.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string R44cSettingsUrl = "/api/nutrition/settings";

    private static string R44cSearchUrl(string query, string? kind = null) =>
        $"/api/nutrition/providers/usda/search?query={Uri.EscapeDataString(query)}" + (kind is null ? string.Empty : $"&kind={kind}");

    [TestMethod]
    public async Task R44cRealUsdaProviderSearchListsBasicFoodsUnlessPackagedOnesAreAskedFor()
    {
        using var anonymous = CreateClient();
        await AssertStatusAsync(await anonymous.GetAsync(R44cSearchUrl("chicken")), HttpStatusCode.Unauthorized);

        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "r44c-search@example.test", "Hicham Haddad", "R44c Search");

        // Basic foods by default: the Foundation chicken with USDA's stated energy, and no record
        // missing its protein, since importing that one would be refused.
        foreach (var url in new[] { R44cSearchUrl("chicken breast"), R44cSearchUrl("chicken breast", "Basic") })
        {
            var basic = await ReadSliceAsync<ProviderFoodSearchPage>(coach, url);
            Assert.IsNull(basic.FailureCode);
            var chicken = basic.Items.Single();
            Assert.AreEqual(
                (UsdaFoodDataCentralFake.ChickenFdcId, "Foundation", (string?)null),
                (chicken.ExternalId, chicken.DataType, chicken.Brand));
            Assert.AreEqual(
                ((decimal?)106m, (decimal?)22.5m, (decimal?)0m, (decimal?)1.93m),
                (chicken.Calories, chicken.ProteinGrams, chicken.CarbohydrateGrams, chicken.FatGrams));
        }

        // Packaged products are US brands, named by their brand, or by their owner when USDA has no brand.
        // USDA writes their names in capitals; they read in sentence case, like its basic foods.
        var packaged = await ReadSliceAsync<ProviderFoodSearchPage>(coach, R44cSearchUrl("greek yogurt", "Packaged"));
        CollectionAssert.AreEqual(
            new[] { ("Greek yogurt", (string?)"CHOBANI", (decimal?)80m), ("Greek yogurt", (string?)"TRADER JOE'S", (decimal?)132m) },
            packaged.Items.Select(item => (item.Name, item.Brand, item.Calories)).ToArray());
        Assert.AreEqual(((decimal?)8.67m, (decimal?)10.7m, (decimal?)0m), (packaged.Items[0].ProteinGrams, packaged.Items[0].CarbohydrateGrams, packaged.Items[0].FatGrams));
    }

    [TestMethod]
    public async Task R44cOnlyTheOwnerChangesTheNutritionDefaults()
    {
        using var owner = CreateClient();
        var workspaceId = await RegisterCoachAsync(owner, "r44c-owner@example.test", "Hicham Haddad", "R44c Defaults");
        using var coach = CreateClient();
        await JoinAsCoachAsync(owner, coach, "r44c-coach@example.test", "Lina Saad");

        // Every coach reads the defaults, since they explain a food's calories, and TB Gym's AI ceiling.
        var read = await ReadSliceAsync<NutritionWorkspaceSettingsView>(coach, R44cSettingsUrl);
        Assert.AreEqual(("Atwater", 200, 20m), (read.EnergyPolicyKey, read.AiMaximumMonthlyRequests, read.AiMaximumMonthlyCost));

        var change = new UpdateNutritionSettingsRequest("Eu1169", 30m, 5, 1m, "USD", read.Version);
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PutAsJsonAsync(R44cSettingsUrl, change), HttpStatusCode.Forbidden);

        // Another workspace's owner is no owner here.
        using var stranger = CreateClient();
        await RegisterCoachAsync(stranger, "r44c-stranger@example.test", "Other Owner", "R44c Other");
        SetTenant(stranger, workspaceId);
        await RefreshCsrfAsync(stranger);
        await AssertStatusAsync(await stranger.PutAsJsonAsync(R44cSettingsUrl, change), HttpStatusCode.Forbidden);

        await RefreshCsrfAsync(owner);
        var saved = await RequiredJsonAsync<NutritionWorkspaceSettingsView>(await owner.PutAsJsonAsync(R44cSettingsUrl, change));
        Assert.AreEqual(("Eu1169", 30m, 5, 1m), (saved.EnergyPolicyKey, saved.ProviderCalorieTolerance, saved.AiMonthlyRequestLimit, saved.AiMonthlyCostLimit));
        Assert.AreEqual("Eu1169", (await ReadSliceAsync<NutritionWorkspaceSettingsView>(coach, R44cSettingsUrl)).EnergyPolicyKey);
    }

    [TestMethod]
    public async Task R44cAiAllowanceStaysWithinTheTbGymCeiling()
    {
        // This test's host lowers TB Gym's ceiling to two suggestions a month (USD 20 stays).
        using var owner = CreateClient();
        var workspaceId = await RegisterCoachAsync(owner, "r44c-ai@example.test", "Hicham Haddad", "R44c AI");
        var settings = await ReadSliceAsync<NutritionWorkspaceSettingsView>(owner, R44cSettingsUrl);
        Assert.AreEqual((2, 20m), (settings.AiMaximumMonthlyRequests, settings.AiMaximumMonthlyCost));

        var aboveRequests = await R44cPutSettingsAsync(owner, settings with { AiMonthlyRequestLimit = 3, AiMonthlyCostLimit = 10m });
        await AssertStatusAsync(aboveRequests, HttpStatusCode.BadRequest);
        StringAssert.Contains(await aboveRequests.Content.ReadAsStringAsync(), "up to 2 AI suggestions a month");
        var aboveCost = await R44cPutSettingsAsync(owner, settings with { AiMonthlyRequestLimit = 2, AiMonthlyCostLimit = 20.01m });
        await AssertStatusAsync(aboveCost, HttpStatusCode.BadRequest);
        StringAssert.Contains(await aboveCost.Content.ReadAsStringAsync(), "up to USD 20.00");
        await AssertStatusAsync(await R44cPutSettingsAsync(owner, settings with { AiMonthlyRequestLimit = 2, AiMonthlyCostLimit = 10m }), HttpStatusCode.OK);

        // An allowance saved before TB Gym lowered its ceiling: the owner can keep it while changing the
        // other defaults, but not raise it further.
        await using (var connection = new NpgsqlConnection(RequiredDatabaseConnection))
        {
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = "UPDATE nutrition.\"WorkspaceSettings\" SET \"AiMonthlyRequestLimit\" = 10 WHERE \"TenantId\" = @tenant";
            command.Parameters.AddWithValue("tenant", workspaceId);
            Assert.AreEqual(1, await command.ExecuteNonQueryAsync());
        }

        var stored = await ReadSliceAsync<NutritionWorkspaceSettingsView>(owner, R44cSettingsUrl);
        Assert.AreEqual(10, stored.AiMonthlyRequestLimit);
        await AssertStatusAsync(await R44cPutSettingsAsync(owner, stored with { AiMonthlyRequestLimit = 11 }), HttpStatusCode.BadRequest);
        await AssertStatusAsync(await R44cPutSettingsAsync(owner, stored with { EnergyPolicyKey = "Eu1169" }), HttpStatusCode.OK);

        // Generation counts only up to the ceiling: the third suggestion of the month is refused.
        await R44bSuggestAsync(owner);
        await R44bSuggestAsync(owner);
        await RefreshCsrfAsync(owner);
        var refused = await owner.PostAsJsonAsync("/api/nutrition/ai-drafts", new GenerateAiMealDraftRequest("good", "test-v1", "en-LB"));
        await AssertStatusAsync(refused, HttpStatusCode.Conflict);
        StringAssert.Contains(await refused.Content.ReadAsStringAsync(), "ai_usage_limit");
        Assert.AreEqual(2, launchAiProvider.Calls);
    }

    [TestMethod]
    public async Task R44cACoachEditsTheirFoodAsANewVersionWhileRecipesKeepWhatTheyCopied()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "r44c-edit@example.test", "Hicham Haddad", "R44c Edit");
        var yogurt = await R44bFoodAsync(coach, "Greek yoghurt", 10m, ["Milk"]);
        var recipe = await R44bCreateAsync(coach, new CreateRecipeRequest(
            "Yogurt bowl", "Spoon it into a bowl.", 1m, [R44bLine(yogurt, 200m)], Publish: true));

        // A typo and a protein figure fixed: the next revision, under the new name.
        var edit = R44cEdit(protein: 11m, name: "Greek yogurt", baseRevision: 1);
        var edited = await R44cPostFoodVersionAsync(coach, yogurt.FoodId, edit);
        await AssertStatusAsync(edited, HttpStatusCode.OK);
        var food = await ReadSlicePayloadAsync<FoodItemView>(edited);
        Assert.AreEqual(("Greek yogurt", 2, 11m), (food.Name, food.CurrentRevision, food.CurrentVersion.ProteinGrams));
        CollectionAssert.AreEqual(new[] { AllergenCode.Milk }, food.CurrentVersion.DeclaredAllergens.ToArray());
        Assert.AreEqual(1, (await ReadSliceAsync<FoodItemPage>(coach, "/api/nutrition/foods?query=yogurt")).Total);

        // The recipe keeps the food as it copied it (NUT-002).
        var line = (await ReadSliceAsync<RecipeDetail>(coach, R44bRecipeUrl(recipe.Id))).Latest.Ingredients.Single();
        Assert.AreEqual(("Greek yoghurt", yogurt.VersionId, 20m), (line.FoodName, line.FoodItemVersionId, line.ProteinGrams));

        // A sheet opened before that save is told, not allowed to overwrite it; one without a base
        // revision (an older client) still saves, and a name of spaces is refused.
        var stale = await R44cPostFoodVersionAsync(coach, yogurt.FoodId, R44cEdit(protein: 12m, name: null, baseRevision: 1));
        await AssertStatusAsync(stale, HttpStatusCode.Conflict);
        StringAssert.Contains(await stale.Content.ReadAsStringAsync(), "food_changed");
        await AssertStatusAsync(await R44cPostFoodVersionAsync(coach, yogurt.FoodId, R44cEdit(protein: 12m, name: "  ", baseRevision: 2)), HttpStatusCode.BadRequest);
        await AssertStatusAsync(await R44cPostFoodVersionAsync(coach, yogurt.FoodId, R44cEdit(protein: 12m, name: null, baseRevision: null)), HttpStatusCode.OK);

        // Another workspace cannot find it.
        using var stranger = CreateClient();
        await RegisterCoachAsync(stranger, "r44c-edit-other@example.test", "Other Coach", "R44c Edit Other");
        await AssertStatusAsync(await R44cPostFoodVersionAsync(stranger, yogurt.FoodId, R44cEdit(protein: 1m, name: "Mine", baseRevision: 3)), HttpStatusCode.NotFound);
    }

    [TestMethod]
    public async Task R44cRealUsdaProviderCountsCarbohydrateJustBelowZeroAsZeroAndKeepsUsdasFigure()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "r44c-carbs@example.test", "Hicham Haddad", "R44c Carbs");

        // The search shows the carbohydrate an import would count, and leaves out the record too far
        // below zero, since importing it is refused.
        var search = await ReadSliceAsync<ProviderFoodSearchPage>(coach, R44cSearchUrl("chicken with skin"));
        var match = search.Items.Single();
        Assert.AreEqual((UsdaFoodDataCentralFake.ChickenWithSkinFdcId, (decimal?)0m), (match.ExternalId, match.CarbohydrateGrams));

        var imported = await R44cImportAsync(coach, UsdaFoodDataCentralFake.ChickenWithSkinFdcId);
        await AssertStatusAsync(imported, HttpStatusCode.OK);
        var chicken = await ReadSlicePayloadAsync<FoodItemView>(imported);
        Assert.AreEqual(
            ("Chicken, breast, meat and skin, raw", 0m, (decimal?)-0.42825m),
            (chicken.Name, chicken.CurrentVersion.CarbohydrateGrams, chicken.CurrentVersion.ReportedCarbohydrateGrams));
        // Calories count the 0 g (21.40625 * 4 + 4.777 * 9), and USDA's own figure is its Atwater energy.
        Assert.AreEqual(
            (128.618m, (decimal?)126.905m, false),
            (chicken.CurrentVersion.ComputedCalories, chicken.CurrentVersion.ProviderCalories, chicken.CurrentVersion.HasCalorieDiscrepancy));

        var refused = await R44cImportAsync(coach, UsdaFoodDataCentralFake.BrokenCarbohydrateFdcId);
        await AssertStatusAsync(refused, HttpStatusCode.BadRequest);
        StringAssert.Contains(await refused.Content.ReadAsStringAsync(), "add up");

        // A packaged product's name in capitals is copied in sentence case.
        var yogurt = await ReadSlicePayloadAsync<FoodItemView>(await R44cImportAsync(coach, UsdaFoodDataCentralFake.ChobaniFdcId));
        Assert.AreEqual(("Greek yogurt", (decimal?)null), (yogurt.Name, yogurt.CurrentVersion.ReportedCarbohydrateGrams));
        Assert.AreEqual(2, (await ReadSliceAsync<FoodItemPage>(coach, "/api/nutrition/foods")).Total);

        // The database keeps USDA's figure only beside a counted zero.
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            CREATE TEMP TABLE forged AS SELECT * FROM nutrition."FoodItemVersions" WHERE "Id" = @id;
            UPDATE forged SET "Id" = gen_random_uuid(), "Revision" = "Revision" + 1, "ReportedCarbohydrateGrams" = -0.42825;
            INSERT INTO nutrition."FoodItemVersions" SELECT * FROM forged;
            """;
        command.Parameters.AddWithValue("id", yogurt.CurrentVersion.Id);
        var rejected = await Assert.ThrowsAsync<PostgresException>(async () => await command.ExecuteNonQueryAsync());
        Assert.AreEqual(
            ("CK_FoodItemVersions_ReportedCarbohydrate", PostgresErrorCodes.CheckViolation),
            (rejected.ConstraintName, rejected.SqlState));
    }

    [TestMethod]
    public async Task R44cRealUsdaProviderACoachArchivesAFoodRecipesKeepAndAddingItAgainBringsItBack()
    {
        using var anonymous = CreateClient();
        using var owner = CreateClient();
        await RegisterCoachAsync(owner, "r44c-archive@example.test", "Hicham Haddad", "R44c Archive");
        using var coach = CreateClient();
        await JoinAsCoachAsync(owner, coach, "r44c-archive-coach@example.test", "Lina Saad");
        var yogurt = await R44bFoodAsync(owner, "Greek yogurt", 10m, ["Milk"]);
        var recipe = await R44bCreateAsync(owner, new CreateRecipeRequest(
            "Yogurt bowl", "Spoon it into a bowl.", 1m, [R44bLine(yogurt, 200m)], Publish: true));

        await AssertStatusAsync(
            await anonymous.PutAsJsonAsync(R44cArchiveUrl(yogurt.FoodId), new SetFoodArchivedRequest(true)),
            HttpStatusCode.Unauthorized);

        // Any coach of the workspace archives it: it leaves Foods and the ingredient search, and
        // archiving it again keeps the first time.
        var archived = await R44cSetArchivedAsync(coach, yogurt.FoodId, true);
        Assert.IsNotNull(archived.ArchivedAtUtc);
        Assert.AreEqual(archived.ArchivedAtUtc, (await R44cSetArchivedAsync(owner, yogurt.FoodId, true)).ArchivedAtUtc);
        Assert.AreEqual(0, (await ReadSliceAsync<FoodItemPage>(owner, "/api/nutrition/foods?query=yogurt")).Total);
        var shelf = await ReadSliceAsync<FoodItemPage>(owner, "/api/nutrition/foods?archived=true");
        Assert.AreEqual((1, yogurt.FoodId), (shelf.Total, shelf.Items.Single().Id));

        // Recipes keep it: the line still reads, and the recipe saves again with it.
        var line = (await ReadSliceAsync<RecipeDetail>(owner, R44bRecipeUrl(recipe.Id))).Latest.Ingredients.Single();
        Assert.AreEqual((yogurt.VersionId, (FoodItemView?)null), (line.FoodItemVersionId, line.NewerFood));
        await R44bAddVersionAsync(owner, recipe.Id, new AddRecipeVersionRequest(
            "Spoon it into a bowl and top with honey.", 1m, [R44bLine(yogurt, 150m)], Publish: true, BaseRevision: 1));

        // Another workspace cannot find it.
        using var stranger = CreateClient();
        await RegisterCoachAsync(stranger, "r44c-archive-other@example.test", "Other Coach", "R44c Archive Other");
        await RefreshCsrfAsync(stranger);
        await AssertStatusAsync(
            await stranger.PutAsJsonAsync(R44cArchiveUrl(yogurt.FoodId), new SetFoodArchivedRequest(false)),
            HttpStatusCode.NotFound);
        Assert.AreEqual(0, (await ReadSliceAsync<FoodItemPage>(stranger, "/api/nutrition/foods?archived=true")).Total);

        // Two tabs restoring it at once, while a third saves a new version of it: all three land. The
        // token is refreshed once, before all three (R42a).
        await RefreshCsrfAsync(owner);
        var racing = await Task.WhenAll(
            owner.PutAsJsonAsync(R44cArchiveUrl(yogurt.FoodId), new SetFoodArchivedRequest(false), SliceReadJson),
            owner.PutAsJsonAsync(R44cArchiveUrl(yogurt.FoodId), new SetFoodArchivedRequest(false), SliceReadJson),
            owner.PostAsJsonAsync($"/api/nutrition/foods/{yogurt.FoodId}/versions", R44cEdit(protein: 11m, name: null, baseRevision: 1), SliceReadJson));
        CollectionAssert.AreEqual(
            new[] { HttpStatusCode.OK, HttpStatusCode.OK, HttpStatusCode.OK },
            racing.Select(response => response.StatusCode).ToArray());
        var restored = (await ReadSliceAsync<FoodItemPage>(owner, "/api/nutrition/foods?query=yogurt")).Items.Single();
        Assert.AreEqual(((DateTimeOffset?)null, 2), (restored.ArchivedAtUtc, restored.CurrentRevision));

        // A USDA food archived and then added from USDA again comes back as it was.
        var chicken = await ReadSlicePayloadAsync<FoodItemView>(await R44cImportAsync(owner, UsdaFoodDataCentralFake.ChickenFdcId));
        await R44cSetArchivedAsync(owner, chicken.Id, true);
        var again = await ReadSlicePayloadAsync<FoodItemView>(await R44cImportAsync(owner, UsdaFoodDataCentralFake.ChickenFdcId));
        Assert.AreEqual((chicken.Id, (DateTimeOffset?)null), (again.Id, again.ArchivedAtUtc));
    }

    [TestMethod]
    public async Task R44cARecipeLineIsOfferedItsFoodsNewNumbersUntilTheRecipeTakesThem()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "r44c-newer@example.test", "Hicham Haddad", "R44c Newer");
        var yogurt = await R44bFoodAsync(coach, "Greek yoghurt", 10m, ["Milk"]);
        var oats = await R44bFoodAsync(coach, "Rolled oats", 13m, ["GlutenCereals"]);
        var recipe = await R44bCreateAsync(coach, new CreateRecipeRequest(
            "Overnight oats", "Soak overnight.", 2m, [R44bLine(yogurt, 200m), R44bLine(oats, 80m)], Publish: true));

        var edited = await ReadSlicePayloadAsync<FoodItemView>(
            await R44cPostFoodVersionAsync(coach, yogurt.FoodId, R44cEdit(protein: 11m, name: "Greek yogurt", baseRevision: 1)));

        // The edited food's line is offered the food as it is now; the line itself is as it was saved,
        // and the untouched food's line is offered nothing.
        var lines = (await ReadSliceAsync<RecipeDetail>(coach, R44bRecipeUrl(recipe.Id))).Latest.Ingredients;
        var yogurtLine = lines.Single(item => item.FoodItemId == yogurt.FoodId);
        Assert.AreEqual(("Greek yoghurt", yogurt.VersionId, 20m), (yogurtLine.FoodName, yogurtLine.FoodItemVersionId, yogurtLine.ProteinGrams));
        Assert.AreEqual(
            ("Greek yogurt", edited.CurrentVersion.Id, 11m),
            (yogurtLine.NewerFood?.Name, yogurtLine.NewerFood?.CurrentVersion.Id, yogurtLine.NewerFood?.CurrentVersion.ProteinGrams));
        Assert.IsNull(lines.Single(item => item.FoodItemId == oats.FoodId).NewerFood);

        // Saving the recipe with the new version takes its numbers, and nothing is offered after.
        await R44bAddVersionAsync(coach, recipe.Id, new AddRecipeVersionRequest(
            "Soak overnight.",
            2m,
            [new RecipeIngredientRequest(edited.CurrentVersion.Id, 200m, FoodQuantityUnit.Gram, PreparationBasis.Prepared), R44bLine(oats, 80m)],
            Publish: true,
            BaseRevision: 1));
        var taken = (await ReadSliceAsync<RecipeDetail>(coach, R44bRecipeUrl(recipe.Id))).Latest.Ingredients
            .Single(item => item.FoodItemId == yogurt.FoodId);
        Assert.AreEqual(("Greek yogurt", 22m, (FoodItemView?)null), (taken.FoodName, taken.ProteinGrams, taken.NewerFood));
    }

    private static string R44cArchiveUrl(Guid foodId) => $"/api/nutrition/foods/{foodId}/archive";

    private static async Task<FoodItemView> R44cSetArchivedAsync(HttpClient coach, Guid foodId, bool archived)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PutAsJsonAsync(R44cArchiveUrl(foodId), new SetFoodArchivedRequest(archived), SliceReadJson);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<FoodItemView>(response);
    }

    private static async Task<HttpResponseMessage> R44cImportAsync(HttpClient coach, string fdcId)
    {
        await RefreshCsrfAsync(coach);
        return await coach.PostAsJsonAsync("/api/nutrition/providers/usda/import", new ImportUsdaFoodRequest(fdcId), SliceReadJson);
    }

    private static AddFoodVersionRequest R44cEdit(decimal protein, string? name, int? baseRevision) =>
        new(100m, FoodQuantityUnit.Gram, PreparationBasis.Prepared, protein, 30m, 10m, 5m, 0m, 0m, null,
            "Coach-authored food", "coach-entry-v1", [AllergenCode.Milk], name, baseRevision);

    private static async Task<HttpResponseMessage> R44cPostFoodVersionAsync(HttpClient coach, Guid foodId, AddFoodVersionRequest request)
    {
        await RefreshCsrfAsync(coach);
        return await coach.PostAsJsonAsync($"/api/nutrition/foods/{foodId}/versions", request, SliceReadJson);
    }

    private static async Task<HttpResponseMessage> R44cPutSettingsAsync(HttpClient owner, NutritionWorkspaceSettingsView settings)
    {
        await RefreshCsrfAsync(owner);
        return await owner.PutAsJsonAsync(R44cSettingsUrl, new UpdateNutritionSettingsRequest(
            settings.EnergyPolicyKey,
            settings.ProviderCalorieTolerance,
            settings.AiMonthlyRequestLimit,
            settings.AiMonthlyCostLimit,
            settings.AiCostCurrency,
            settings.Version));
    }
}
