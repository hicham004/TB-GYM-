using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using TB.Gym.Modules.Nutrition;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// R4.4b: the recipe editor. A coach saves a recipe with a cover photo (MED-014) and publishes it in
/// the same save; edits make new versions without touching a published one, renaming the recipe and
/// keeping or changing its photo; a save made since the editor opened is a conflict, not an
/// overwrite. A photo is the workspace's staff's to read and its uploader's to attach, never a
/// client's or another workspace's. An AI suggestion becomes a recipe from the lines the coach
/// chose, with suggested ones dropped or others added.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string R44bRecipesUrl = "/api/nutrition/recipes";

    private static string R44bRecipeUrl(Guid recipeId) => $"{R44bRecipesUrl}/{recipeId}";

    private static string R44bVersionsUrl(Guid recipeId) => $"{R44bRecipesUrl}/{recipeId}/versions";

    [TestMethod]
    public async Task R44bACoachSavesARecipeWithAPhotoPublishesItAndEditsItAsNewVersions()
    {
        using var owner = CreateClient();
        await RegisterCoachAsync(owner, "r44b-owner@example.test", "Hicham Haddad", "R44b Recipes");
        var oats = await R44bFoodAsync(owner, "Rolled oats", 13m, ["GlutenCereals"]);
        var yogurt = await R44bFoodAsync(owner, "Greek yogurt", 10m, ["Milk"]);

        // A recipe photo is re-encoded with a thumbnail, like a progress photo, and the uploader reads it.
        var photo = await R44bUploadPhotoAsync(owner);
        var access = await R44bGrantAsync(owner, photo);
        Assert.IsNotNull(access.ThumbnailUrl, "A recipe photo keeps a thumbnail for its card.");
        await AssertStatusAsync(await owner.GetAsync(access.ThumbnailUrl), HttpStatusCode.OK);

        // Saved and published in one save: ready for meal plans at once, with its photo.
        var created = await R44bCreateAsync(owner, new CreateRecipeRequest(
            "Overnight oats",
            "Stir everything together and chill overnight.",
            2m,
            [R44bLine(oats, 80m), R44bLine(yogurt, 200m)],
            photo,
            Publish: true));
        Assert.AreEqual(
            (1, PublicationStatus.Published, (Guid?)photo, (Guid?)created.VersionId),
            (created.Revision, created.Status, created.PhotoMediaAssetId, created.PublishedVersionId));
        CollectionAssert.AreEqual(new[] { AllergenCode.GlutenCereals, AllergenCode.Milk }, created.DeclaredAllergens.ToArray());
        var usable = await ReadSliceAsync<RecipePage>(owner, $"{R44bRecipesUrl}?published=true");
        Assert.AreEqual((created.VersionId, (Guid?)photo), (usable.Items.Single().VersionId, usable.Items.Single().PhotoMediaAssetId));

        // The editor's read: the newest version with every line as saved, its food and allergens.
        var detail = await ReadSliceAsync<RecipeDetail>(owner, R44bRecipeUrl(created.Id));
        Assert.AreEqual(("Overnight oats", 1, (Guid?)created.VersionId), (detail.Name, detail.CurrentRevision, detail.PublishedVersionId));
        Assert.AreEqual((2m, (Guid?)photo), (detail.Latest.Servings, detail.Latest.PhotoMediaAssetId));
        CollectionAssert.AreEqual(
            new[] { ("Rolled oats", 80m, oats.FoodId), ("Greek yogurt", 200m, yogurt.FoodId) },
            detail.Latest.Ingredients.Select(line => (line.FoodName, line.Quantity, line.FoodItemId)).ToArray());
        Assert.AreEqual(FoodProvenance.CoachAuthored, detail.Latest.Ingredients[0].FoodProvenance);
        CollectionAssert.AreEqual(new[] { AllergenCode.Milk }, detail.Latest.Ingredients[1].DeclaredAllergens.ToArray());
        Assert.AreEqual(detail.Latest.Calories, detail.Latest.Ingredients.Sum(line => line.Calories));

        // An edit saved as a draft: a new version and a new name; meal plans keep the published one.
        var draft = await R44bAddVersionAsync(owner, created.Id, new AddRecipeVersionRequest(
            "Stir, chill overnight, top with berries.",
            2m,
            [R44bLine(oats, 100m), R44bLine(yogurt, 200m)],
            Name: "  Berry overnight oats ",
            PhotoMediaAssetId: photo,
            BaseRevision: 1));
        Assert.AreEqual(
            (2, PublicationStatus.Draft, "Berry overnight oats", (Guid?)created.VersionId),
            (draft.Revision, draft.Status, draft.Name, draft.PublishedVersionId));
        var listed = (await ReadSliceAsync<RecipePage>(owner, R44bRecipesUrl)).Items.Single();
        Assert.AreEqual((draft.VersionId, (Guid?)created.VersionId), (listed.VersionId, listed.PublishedVersionId));
        Assert.AreEqual(created.VersionId, (await ReadSliceAsync<RecipePage>(owner, $"{R44bRecipesUrl}?published=true")).Items.Single().VersionId);

        // A save from an editor opened before that draft is refused rather than replacing it.
        await R44bAssertConflictAsync(await R44bPostVersionAsync(owner, created.Id, new AddRecipeVersionRequest(
            "An older edit.", 1m, [R44bLine(oats, 50m)], BaseRevision: 1)));

        // Published from the newest, with a new photo: the first version stays exactly as it was.
        var newPhoto = await R44bUploadPhotoAsync(owner);
        var published = await R44bAddVersionAsync(owner, created.Id, new AddRecipeVersionRequest(
            "Stir, chill overnight, top with berries.",
            2m,
            [R44bLine(oats, 100m), R44bLine(yogurt, 200m)],
            PhotoMediaAssetId: newPhoto,
            Publish: true,
            BaseRevision: 2));
        Assert.AreEqual(
            (3, PublicationStatus.Published, (Guid?)newPhoto, (Guid?)published.VersionId),
            (published.Revision, published.Status, published.PhotoMediaAssetId, published.PublishedVersionId));
        Assert.AreEqual(published.VersionId, (await ReadSliceAsync<RecipePage>(owner, $"{R44bRecipesUrl}?published=true")).Items.Single().VersionId);
        Assert.IsGreaterThan(created.Calories, published.Calories);
        await AssertPhotoReadableAsync(owner, photo, true);

        // A photo can be left off, and a version without one says so.
        var plain = await R44bAddVersionAsync(owner, created.Id, new AddRecipeVersionRequest(
            "Stir, chill overnight.", 2m, [R44bLine(oats, 100m)], BaseRevision: 3));
        Assert.IsNull(plain.PhotoMediaAssetId);
        Assert.IsNull((await ReadSliceAsync<RecipeDetail>(owner, R44bRecipeUrl(created.Id))).Latest.PhotoMediaAssetId);
    }

    [TestMethod]
    public async Task R44bRecipePhotosStayWithTheWorkspacesStaffAndTheirUploader()
    {
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "r44b-scope-owner@example.test", "Hicham Haddad", "R44b Scope");
        using var coach = CreateClient();
        await JoinAsCoachAsync(owner, coach, "r44b-scope-coach@example.test", "Lina Saad");
        using var maya = CreateClient();
        await R31InviteAsync(owner, maya, tenant, "r44b-scope-maya@example.test", "Maya", "Rahman");
        var rice = await R44bFoodAsync(owner, "Basmati rice", 3m, []);
        var photo = await R44bUploadPhotoAsync(owner);
        var recipe = await R44bCreateAsync(owner, new CreateRecipeRequest(
            "Rice bowl", "Cook the rice.", 1m, [R44bLine(rice, 150m)], photo, Publish: true));

        // The team reads it; a client never does, and only staff upload one.
        await AssertPhotoReadableAsync(coach, photo, true);
        await AssertPhotoReadableAsync(maya, photo, false);
        await AssertStatusAsync(await R44bPostPhotoAsync(maya), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await maya.GetAsync(R44bRecipeUrl(recipe.Id)), HttpStatusCode.Forbidden);

        // Another coach editing the recipe keeps its photo, but cannot attach someone else's upload
        // that no version has, nor that upload to a new recipe of their own.
        var kept = await R44bAddVersionAsync(coach, recipe.Id, new AddRecipeVersionRequest(
            "Cook the rice, then rest it.", 1m, [R44bLine(rice, 150m)], PhotoMediaAssetId: photo, BaseRevision: 1));
        Assert.AreEqual((Guid?)photo, kept.PhotoMediaAssetId);
        var ownersSpare = await R44bUploadPhotoAsync(owner);
        await R44bAssertPhotoRefusedAsync(await R44bPostVersionAsync(coach, recipe.Id, new AddRecipeVersionRequest(
            "Cook the rice.", 1m, [R44bLine(rice, 150m)], PhotoMediaAssetId: ownersSpare, BaseRevision: 2)));
        await R44bAssertPhotoRefusedAsync(await R44bPostCreateAsync(coach, new CreateRecipeRequest(
            "Borrowed", "Cook it.", 1m, [R44bLine(rice, 100m)], photo)));

        // Only a recipe photo: a logo or an exercise video is not one.
        var logo = await R35aUploadLogoAsync(owner, 300, 300);
        await R44bAssertPhotoRefusedAsync(await R44bPostCreateAsync(owner, new CreateRecipeRequest(
            "Logo meal", "Cook it.", 1m, [R44bLine(rice, 100m)], logo)));
        await R44bAssertPhotoRefusedAsync(await R44bPostCreateAsync(owner, new CreateRecipeRequest(
            "Nothing", "Cook it.", 1m, [R44bLine(rice, 100m)], Guid.NewGuid())));

        // The coach library neither lists nor deletes recipe photos.
        Assert.IsFalse((await owner.GetFromJsonAsync<R35aMediaPage>("/api/media?skip=0&take=50"))!.Items.Any(item => item.Id == photo));
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.SendAsync(new HttpRequestMessage(HttpMethod.Delete, $"/api/media/{photo}")
            {
                Content = JsonContent.Create(new { Version = 0u }),
            }),
            HttpStatusCode.NotFound);
        await AssertPhotoReadableAsync(owner, photo, true);

        // Another workspace reads neither the recipe nor its photo, and cannot attach it.
        using var stranger = CreateClient();
        var strangerTenant = await RegisterCoachAsync(stranger, "r44b-scope-stranger@example.test", "Other Owner", "R44b Elsewhere");
        SetTenant(stranger, tenant);
        await AssertStatusAsync(await stranger.GetAsync(R44bRecipeUrl(recipe.Id)), HttpStatusCode.Forbidden);
        SetTenant(stranger, strangerTenant);
        await AssertStatusAsync(await stranger.GetAsync(R44bRecipeUrl(recipe.Id)), HttpStatusCode.NotFound);
        await AssertPhotoReadableAsync(stranger, photo, false);
        var theirRice = await R44bFoodAsync(stranger, "Their rice", 3m, []);
        await R44bAssertPhotoRefusedAsync(await R44bPostCreateAsync(stranger, new CreateRecipeRequest(
            "Their bowl", "Cook it.", 1m, [R44bLine(theirRice, 100m)], photo)));
        await AssertStatusAsync(
            await R44bPostVersionAsync(stranger, recipe.Id, new AddRecipeVersionRequest("Cook it.", 1m, [R44bLine(theirRice, 100m)])),
            HttpStatusCode.NotFound);
    }

    [TestMethod]
    public async Task R44bAnAiSuggestionBecomesARecipeFromTheLinesTheCoachChose()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "r44b-ai@example.test", "AI Coach", "R44b AI");
        await SetLaunchAiBudgetAsync(coach, 10, 10m);
        var oats = await R44bFoodAsync(coach, "Rolled oats", 13m, []);
        var milk = await R44bFoodAsync(coach, "Whole milk", 3m, ["Milk"]);
        var photo = await R44bUploadPhotoAsync(coach);

        // The suggestion names one ingredient; the coach keeps it and adds milk, so two lines are saved.
        var suggestion = await R44bSuggestAsync(coach);
        await RefreshCsrfAsync(coach);
        var reviewed = await coach.PostAsJsonAsync($"/api/nutrition/ai-drafts/{suggestion}/review", new ReviewAiMealDraftRequest(
            true,
            "Coach matched the foods.",
            "Oat bowl",
            "Warm the milk and stir in the oats.",
            1m,
            [R44bMapping(oats, 80m), R44bMapping(milk, 250m)],
            photo,
            Publish: true), SliceReadJson);
        await AssertStatusAsync(reviewed, HttpStatusCode.OK);
        var view = await ReadSlicePayloadAsync<AiMealDraftView>(reviewed);
        Assert.AreEqual(AiDraftStatus.Approved, view.Status);
        var recipe = (await ReadSliceAsync<RecipePage>(coach, $"{R44bRecipesUrl}?published=true")).Items.Single();
        Assert.AreEqual((view.CreatedRecipeVersionId, (Guid?)photo, PublicationStatus.Published), ((Guid?)recipe.VersionId, recipe.PhotoMediaAssetId, recipe.Status));
        Assert.AreEqual((Guid?)recipe.Id, view.CreatedRecipeId, "The editor opens the recipe the suggestion became.");
        Assert.HasCount(2, (await ReadSliceAsync<RecipeDetail>(coach, R44bRecipeUrl(recipe.Id))).Latest.Ingredients);

        // Dropping every line saves nothing; without Publish the recipe stays a draft.
        var second = await R44bSuggestAsync(coach);
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync($"/api/nutrition/ai-drafts/{second}/review", new ReviewAiMealDraftRequest(
                true, "Coach matched the foods.", "Empty bowl", "Nothing.", 1m, []), SliceReadJson),
            HttpStatusCode.BadRequest);
        await RefreshCsrfAsync(coach);
        var drafted = await coach.PostAsJsonAsync($"/api/nutrition/ai-drafts/{second}/review", new ReviewAiMealDraftRequest(
            true, "Coach matched the foods.", "Plain oats", "Cook the oats.", 1m, [R44bMapping(oats, 60m)]), SliceReadJson);
        await AssertStatusAsync(drafted, HttpStatusCode.OK);
        var plainId = (await ReadSlicePayloadAsync<AiMealDraftView>(drafted)).CreatedRecipeVersionId;
        Assert.AreEqual(
            PublicationStatus.Draft,
            (await ReadSliceAsync<RecipePage>(coach, R44bRecipesUrl)).Items.Single(item => item.VersionId == plainId).Status);
    }

    private sealed record R44bFood(Guid FoodId, Guid VersionId);

    private sealed record R44bAccess(string Url, string? ThumbnailUrl);

    private static RecipeIngredientRequest R44bLine(R44bFood food, decimal grams) =>
        new(food.VersionId, grams, FoodQuantityUnit.Gram, PreparationBasis.Prepared);

    private static AiIngredientMappingRequest R44bMapping(R44bFood food, decimal grams) =>
        new(food.VersionId, grams, FoodQuantityUnit.Gram, PreparationBasis.Prepared);

    private static async Task<R44bFood> R44bFoodAsync(HttpClient coach, string name, decimal protein, string[] allergens)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync("/api/nutrition/foods", new
        {
            name,
            provenance = "CoachAuthored",
            externalId = (string?)null,
            externalDataType = (string?)null,
            labelMediaAssetId = (Guid?)null,
            version = FoodVersion(protein, allergens),
        });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        var food = await RequiredJsonAsync<Phase4Food>(response);
        return new R44bFood(food.Id, food.CurrentVersion.Id);
    }

    private static async Task<HttpResponseMessage> R44bPostPhotoAsync(HttpClient caller)
    {
        await RefreshCsrfAsync(caller);
        using var form = new MultipartFormDataContent();
        var file = new ByteArrayContent(ProgressPhotoImageFactory.PlainJpeg(1_200, 900));
        file.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");
        form.Add(file, "file", "bowl.jpg");
        return await caller.PostAsync("/api/media/recipe-photo", form);
    }

    private static async Task<Guid> R44bUploadPhotoAsync(HttpClient caller)
    {
        var response = await R44bPostPhotoAsync(caller);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        var asset = await RequiredJsonAsync<MediaAsset>(response);
        Assert.AreEqual("Ready", asset.Status);
        return asset.Id;
    }

    private async Task<R44bAccess> R44bGrantAsync(HttpClient caller, Guid assetId)
    {
        RequiredTestClock.Set(DateTimeOffset.UtcNow);
        await RefreshCsrfAsync(caller);
        var access = await caller.PostAsync($"/api/media/{assetId}/access", null);
        await AssertStatusAsync(access, HttpStatusCode.OK);
        return await RequiredJsonAsync<R44bAccess>(access);
    }

    private static async Task<HttpResponseMessage> R44bPostCreateAsync(HttpClient coach, CreateRecipeRequest request)
    {
        await RefreshCsrfAsync(coach);
        return await coach.PostAsJsonAsync(R44bRecipesUrl, request, SliceReadJson);
    }

    private static async Task<RecipeSummary> R44bCreateAsync(HttpClient coach, CreateRecipeRequest request)
    {
        var response = await R44bPostCreateAsync(coach, request);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<RecipeSummary>(response);
    }

    private static async Task<HttpResponseMessage> R44bPostVersionAsync(HttpClient coach, Guid recipeId, AddRecipeVersionRequest request)
    {
        await RefreshCsrfAsync(coach);
        return await coach.PostAsJsonAsync(R44bVersionsUrl(recipeId), request, SliceReadJson);
    }

    private static async Task<RecipeSummary> R44bAddVersionAsync(HttpClient coach, Guid recipeId, AddRecipeVersionRequest request)
    {
        var response = await R44bPostVersionAsync(coach, recipeId, request);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<RecipeSummary>(response);
    }

    private static async Task R44bAssertConflictAsync(HttpResponseMessage response)
    {
        await AssertStatusAsync(response, HttpStatusCode.Conflict);
        StringAssert.Contains(await response.Content.ReadAsStringAsync(), "recipe_changed");
    }

    private static async Task R44bAssertPhotoRefusedAsync(HttpResponseMessage response)
    {
        await AssertStatusAsync(response, HttpStatusCode.BadRequest);
        StringAssert.Contains(await response.Content.ReadAsStringAsync(), "photoMediaAssetId");
    }

    private static async Task<Guid> R44bSuggestAsync(HttpClient coach)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync("/api/nutrition/ai-drafts", new GenerateAiMealDraftRequest("good", "test-v1", "en-LB"));
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return (await ReadSlicePayloadAsync<AiMealDraftView>(response)).Id;
    }
}
