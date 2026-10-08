using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TB.Gym.Modules.Media;
using TB.Gym.Modules.Nutrition;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// R4.4d: recipes for clients. Assigning a plan copies each recipe it names into the client's plan
/// (NUT-006): name, method, servings, prep and cook time, cover photo and ingredient lines, which a
/// later library edit never changes. Only the client whose active plan it is reads a copy or its
/// photo (MED-014); another client, another workspace, staff on the client route, a cancelled plan
/// and a released client do not. The builder is told each recipe's newest published version, and a
/// recipe photo no version names is removed 48 hours after its upload.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private static string R44dRecipeUrl(Guid recipeId) => $"/api/nutrition/me/recipes/{recipeId}";

    private static string R44dDayUrl(DateOnly date) =>
        $"/api/nutrition/me/day?localDate={date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)}";

    [TestMethod]
    public async Task R44dAssigningAPlanGivesTheClientTheirOwnCopyOfEachRecipe()
    {
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "r44d-copy-owner@example.test", "Hicham Haddad", "R44d Copies");
        using var maya = CreateClient();
        var mayaId = await InviteAndAcceptAsync(owner, maya, "r44d-copy-maya@example.test", true);
        SetTenant(maya, tenant);
        var oats = await R44bFoodAsync(owner, "Rolled oats", 13m, []);
        var yogurt = await R44bFoodAsync(owner, "Greek yogurt", 10m, []);
        var photo = await R44bUploadPhotoAsync(owner);
        var overnight = await R44bCreateAsync(owner, new CreateRecipeRequest(
            "Overnight oats", "Stir everything together.\nChill overnight.", 2m, [R44bLine(oats, 80m), R44bLine(yogurt, 150m)],
            photo, Publish: true, PrepMinutes: 10, CookMinutes: 0));
        var bowl = await R44bCreateAsync(owner, new CreateRecipeRequest(
            "Yogurt bowl", "Spoon into a bowl.", 1m, [R44bLine(yogurt, 200m)], Publish: true));
        var (planId, start) = await R44dAssignAsync(owner, mayaId, overnight.VersionId, bowl.VersionId);

        // Each option names the client's copy; a recipe offered in two meals or on two days is one copy.
        var firstDay = await ReadSliceAsync<ClientNutritionDayView>(maya, R44dDayUrl(start));
        var secondDay = await ReadSliceAsync<ClientNutritionDayView>(maya, R44dDayUrl(start.AddDays(1)));
        var dayOneOptions = firstDay.Slots.SelectMany(slot => slot.Choices).ToArray();
        var oatsCopies = dayOneOptions.Where(choice => choice.RecipeName == "Overnight oats").Select(choice => choice.RecipeId).Distinct().ToArray();
        var bowlCopy = dayOneOptions.Single(choice => choice.RecipeName == "Yogurt bowl").RecipeId;
        Assert.HasCount(1, oatsCopies);
        Assert.IsNotNull(oatsCopies[0]);
        Assert.IsNotNull(bowlCopy);
        Assert.AreNotEqual(oatsCopies[0], bowlCopy);
        Assert.AreEqual(bowlCopy, secondDay.Slots.Single().Choices.Single().RecipeId);

        // Each option carries its copy's photo for the meal card; one without a photo carries none.
        CollectionAssert.AreEquivalent(
            new[] { ("Overnight oats", (Guid?)photo), ("Yogurt bowl", (Guid?)null) },
            dayOneOptions.Select(choice => (choice.RecipeName, choice.RecipePhotoMediaAssetId)).Distinct().ToArray());

        var copy = await ReadSliceAsync<ClientPlanRecipeView>(maya, R44dRecipeUrl(oatsCopies[0]!.Value));
        Assert.AreEqual(
            ("Overnight oats", 2m, (int?)10, (int?)0, (Guid?)photo, "Stir everything together.\nChill overnight."),
            (copy.Name, copy.Servings, copy.PrepMinutes, copy.CookMinutes, copy.PhotoMediaAssetId, copy.Instructions));
        CollectionAssert.AreEqual(
            new[] { ("Rolled oats", 80m, FoodQuantityUnit.Gram, PreparationBasis.Prepared), ("Greek yogurt", 150m, FoodQuantityUnit.Gram, PreparationBasis.Prepared) },
            copy.Ingredients.Select(line => (line.FoodName, line.Quantity, line.Unit, line.Basis)).ToArray());
        await AssertPhotoReadableAsync(maya, photo, true);

        // The coach renames the recipe, rewrites it and changes its photo: the client's copy stays.
        var newPhoto = await R44bUploadPhotoAsync(owner);
        await R44bAddVersionAsync(owner, overnight.Id, new AddRecipeVersionRequest(
            "A new method.", 4m, [R44bLine(oats, 160m)], Name: "Berry oats", PhotoMediaAssetId: newPhoto, Publish: true, BaseRevision: 1, PrepMinutes: 5));
        var after = await ReadSliceAsync<ClientPlanRecipeView>(maya, R44dRecipeUrl(copy.Id));
        Assert.AreEqual(
            (copy.Name, copy.Servings, copy.PrepMinutes, copy.Instructions, copy.PhotoMediaAssetId, 2),
            (after.Name, after.Servings, after.PrepMinutes, after.Instructions, after.PhotoMediaAssetId, after.Ingredients.Count));
        await AssertPhotoReadableAsync(maya, newPhoto, false);

        // One copy per recipe in the plan, its lines with it.
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT count(DISTINCT r."Id"), count(l."Id")
            FROM nutrition."ClientNutritionPlanRecipes" r
            JOIN nutrition."ClientNutritionPlanRecipeIngredients" l ON l."TenantId" = r."TenantId" AND l."ClientNutritionPlanRecipeId" = r."Id"
            WHERE r."ClientNutritionPlanId" = @plan
            """;
        command.Parameters.AddWithValue("plan", planId);
        await using var reader = await command.ExecuteReaderAsync();
        Assert.IsTrue(await reader.ReadAsync());
        Assert.AreEqual((2L, 3L), (reader.GetInt64(0), reader.GetInt64(1)));
    }

    [TestMethod]
    public async Task R44dOnlyTheClientWhosePlanItIsReadsARecipeCopyOrItsPhoto()
    {
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "r44d-scope-owner@example.test", "Hicham Haddad", "R44d Scope");
        var yogurt = await R44bFoodAsync(owner, "Greek yogurt", 10m, []);
        var photo = await R44bUploadPhotoAsync(owner);
        var pictured = await R44bCreateAsync(owner, new CreateRecipeRequest(
            "Yogurt parfait", "Layer it.", 1m, [R44bLine(yogurt, 150m)], photo, Publish: true));
        var plain = await R44bCreateAsync(owner, new CreateRecipeRequest(
            "Yogurt bowl", "Spoon it.", 1m, [R44bLine(yogurt, 200m)], Publish: true));
        var other = await R44bCreateAsync(owner, new CreateRecipeRequest(
            "Plain yogurt", "Serve it.", 1m, [R44bLine(yogurt, 170m)], Publish: true));

        using var maya = CreateClient();
        var mayaId = await InviteAndAcceptAsync(owner, maya, "r44d-scope-maya@example.test", true);
        SetTenant(maya, tenant);
        var (mayaPlanId, start) = await R44dAssignAsync(owner, mayaId, pictured.VersionId, plain.VersionId);
        var copyId = await R44dCopyIdAsync(maya, start, "Yogurt parfait");

        // Another client of the same coach, with a plan of their own that has no photo.
        using var sara = CreateClient();
        var saraId = await InviteAndAcceptAsync(owner, sara, "r44d-scope-sara@example.test", true);
        SetTenant(sara, tenant);
        await R44dAssignAsync(owner, saraId, plain.VersionId, other.VersionId);
        await AssertStatusAsync(await sara.GetAsync(R44dRecipeUrl(copyId)), HttpStatusCode.NotFound);
        await AssertPhotoReadableAsync(sara, photo, false);

        // The day's meal cards ask for every photo in one batch: Maya's own comes back, and the same id
        // asked by Sara is left out, as one request at a time would refuse it.
        Assert.AreEqual(photo, await R44dBatchGrantedAsync(maya, photo, Guid.NewGuid()));
        Assert.IsNull(await R44dBatchGrantedAsync(sara, photo));

        // Staff use the coach's routes; the client route is the client's own.
        await AssertStatusAsync(await owner.GetAsync(R44dRecipeUrl(copyId)), HttpStatusCode.Forbidden);
        using var anonymous = CreateClient();
        await AssertStatusAsync(await anonymous.GetAsync(R44dRecipeUrl(copyId)), HttpStatusCode.Unauthorized);

        // Another workspace's client sees nothing, under its own workspace or this one.
        using var strangerCoach = CreateClient();
        var strangerTenant = await RegisterCoachAsync(strangerCoach, "r44d-scope-stranger@example.test", "Other Owner", "R44d Elsewhere");
        using var stranger = CreateClient();
        await InviteAndAcceptAsync(strangerCoach, stranger, "r44d-scope-stranger-client@example.test", true);
        SetTenant(stranger, strangerTenant);
        await AssertStatusAsync(await stranger.GetAsync(R44dRecipeUrl(copyId)), HttpStatusCode.NotFound);
        await AssertPhotoReadableAsync(stranger, photo, false);
        SetTenant(stranger, tenant);
        await AssertStatusAsync(await stranger.GetAsync(R44dRecipeUrl(copyId)), HttpStatusCode.Forbidden);

        // The owner's own client reads it until the plan is cancelled.
        await ReadSliceAsync<ClientPlanRecipeView>(maya, R44dRecipeUrl(copyId));
        await AssertPhotoReadableAsync(maya, photo, true);
        var mayaPlan = (await ReadSliceAsync<ClientNutritionPlanSummary[]>(owner, $"/api/nutrition/clients/{mayaId}/plans")).Single(item => item.Id == mayaPlanId);
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync($"/api/nutrition/clients/{mayaId}/plans/{mayaPlanId}/cancel", new { reason = "Wrong plan.", version = mayaPlan.Version }),
            HttpStatusCode.OK);
        await AssertStatusAsync(await maya.GetAsync(R44dRecipeUrl(copyId)), HttpStatusCode.NotFound);
        await AssertPhotoReadableAsync(maya, photo, false);
        Assert.IsNull(await R44dBatchGrantedAsync(maya, photo));

        // A released client keeps nothing of the workspace's to read.
        using var omar = CreateClient();
        var omarId = await InviteAndAcceptAsync(owner, omar, "r44d-scope-omar@example.test", true);
        SetTenant(omar, tenant);
        var (_, omarStart) = await R44dAssignAsync(owner, omarId, pictured.VersionId, plain.VersionId);
        var omarCopyId = await R44dCopyIdAsync(omar, omarStart, "Yogurt parfait");
        await AssertPhotoReadableAsync(omar, photo, true);
        await ReleaseAsync(owner, omarId, "Moved away.");
        var released = await omar.GetAsync(R44dRecipeUrl(omarCopyId));
        Assert.IsTrue(
            released.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Forbidden,
            $"A released client read a recipe copy: {(int)released.StatusCode}.");
        await AssertPhotoReadableAsync(omar, photo, false);
        Assert.IsNull(await R44dBatchGrantedAsync(omar, photo));
    }

    [TestMethod]
    public async Task R44dPrepAndCookTimeAreKeptWithEachVersionAndChecked()
    {
        using var owner = CreateClient();
        await RegisterCoachAsync(owner, "r44d-times-owner@example.test", "Hicham Haddad", "R44d Times");
        var rice = await R44bFoodAsync(owner, "Basmati rice", 3m, []);
        var recipe = await R44bCreateAsync(owner, new CreateRecipeRequest(
            "Rice bowl", "Cook the rice.", 1m, [R44bLine(rice, 150m)], PrepMinutes: 15, CookMinutes: 20));
        var saved = await ReadSliceAsync<RecipeDetail>(owner, R44bRecipeUrl(recipe.Id));
        Assert.AreEqual(((int?)15, (int?)20), (saved.Latest.PrepMinutes, saved.Latest.CookMinutes));

        // Each version holds its own: a version saved without them has none.
        await R44bAddVersionAsync(owner, recipe.Id, new AddRecipeVersionRequest("Cook the rice.", 1m, [R44bLine(rice, 150m)], BaseRevision: 1));
        var cleared = await ReadSliceAsync<RecipeDetail>(owner, R44bRecipeUrl(recipe.Id));
        Assert.AreEqual(((int?)null, (int?)null), (cleared.Latest.PrepMinutes, cleared.Latest.CookMinutes));

        // Whole minutes from 0 to two days.
        await AssertStatusAsync(
            await R44bPostVersionAsync(owner, recipe.Id, new AddRecipeVersionRequest("Cook it.", 1m, [R44bLine(rice, 150m)], BaseRevision: 2, PrepMinutes: -1)),
            HttpStatusCode.BadRequest);
        await AssertStatusAsync(
            await R44bPostCreateAsync(owner, new CreateRecipeRequest("Slow rice", "Cook it.", 1m, [R44bLine(rice, 150m)], CookMinutes: RecipeVersion.MaximumMinutes + 1)),
            HttpStatusCode.BadRequest);
        Assert.AreEqual(2, (await ReadSliceAsync<RecipeDetail>(owner, R44bRecipeUrl(recipe.Id))).CurrentRevision);
    }

    [TestMethod]
    public async Task R44dRecipePhotosNoVersionNamesAreRemovedFortyEightHoursAfterUpload()
    {
        using var owner = CreateClient();
        await RegisterCoachAsync(owner, "r44d-sweep-owner@example.test", "Hicham Haddad", "R44d Sweep");
        var rice = await R44bFoodAsync(owner, "Basmati rice", 3m, []);
        var uploadedAt = DateTimeOffset.UtcNow;
        RequiredTestClock.Set(uploadedAt);
        var saved = await R44bUploadPhotoAsync(owner);
        var savedLate = await R44bUploadPhotoAsync(owner);
        var abandoned = await R44bUploadPhotoAsync(owner);
        await R44bCreateAsync(owner, new CreateRecipeRequest("Rice bowl", "Cook the rice.", 1m, [R44bLine(rice, 150m)], saved, Publish: true));

        // A save may name an unsaved upload until 47 hours after it, an hour before the sweep.
        RequiredTestClock.Set(uploadedAt.AddHours(46));
        await R44bCreateAsync(owner, new CreateRecipeRequest("Late bowl", "Cook it.", 1m, [R44bLine(rice, 100m)], savedLate));
        RequiredTestClock.Set(uploadedAt.AddHours(47));
        var tooLate = await R44bPostCreateAsync(owner, new CreateRecipeRequest("Too late", "Cook it.", 1m, [R44bLine(rice, 100m)], abandoned));
        await AssertStatusAsync(tooLate, HttpStatusCode.BadRequest);
        StringAssert.Contains(await tooLate.Content.ReadAsStringAsync(), "no longer kept");
        Assert.AreEqual(0, await R44dRetireUnusedRecipePhotosAsync());

        // At 48 hours the unsaved upload goes; the purge then removes its bytes.
        RequiredTestClock.Set(uploadedAt.AddHours(48));
        Assert.AreEqual(1, await R44dRetireUnusedRecipePhotosAsync());
        Assert.AreEqual(0, await R44dRetireUnusedRecipePhotosAsync());
        CollectionAssert.AreEquivalent(
            new[] { (saved, "Ready"), (savedLate, "Ready"), (abandoned, "Tombstoned") },
            await R44dAssetStatusesAsync(saved, savedLate, abandoned));
        await using (var scope = RequiredFactory.Services.CreateAsyncScope())
        {
            var outcome = await scope.ServiceProvider.GetRequiredService<IMediaPurgeService>().PurgeDueAsync(50, CancellationToken.None);
            Assert.AreEqual(1, outcome.Purged);
        }

        CollectionAssert.AreEquivalent(
            new[] { (saved, "Ready"), (savedLate, "Ready"), (abandoned, "Purged") },
            await R44dAssetStatusesAsync(saved, savedLate, abandoned));
    }

    [TestMethod]
    public async Task R44dTheBuilderIsToldEachRecipesNewestPublishedVersion()
    {
        using var owner = CreateClient();
        await RegisterCoachAsync(owner, "r44d-newest-owner@example.test", "Hicham Haddad", "R44d Newest");
        var oats = await R44aRecipeAsync(owner, "Overnight oats", 20m);
        var chicken = await R44aRecipeAsync(owner, "Chicken & rice", 40m);
        var draft = await R44aCreateAsync(owner, new(null, null, null, R44aContent(oats.VersionId, chicken.VersionId)));
        var plan = await R44aPublishAsync(owner, draft.Id, draft.Version, replaceNewer: false);

        // The coach republishes the oats; a draft of it, never published, is not offered.
        var newer = await R44bAddVersionAsync(owner, oats.Id, new AddRecipeVersionRequest(
            "Soak overnight.", 1m, [new RecipeIngredientRequest(oats.FoodVersionId, 120m, FoodQuantityUnit.Gram, PreparationBasis.Prepared)], Publish: true, BaseRevision: 1));
        await R44bAddVersionAsync(owner, oats.Id, new AddRecipeVersionRequest(
            "Not finished.", 1m, [new RecipeIngredientRequest(oats.FoodVersionId, 90m, FoodQuantityUnit.Gram, PreparationBasis.Prepared)], BaseRevision: 2));

        var version = await ReadSliceAsync<MealPlanVersionView>(owner, R44aVersionUrl(plan.VersionId));
        CollectionAssert.AreEquivalent(
            new[] { (oats.VersionId, (Guid?)newer.VersionId), (newer.VersionId, (Guid?)newer.VersionId), (chicken.VersionId, (Guid?)chicken.VersionId) },
            version.Recipes.Select(recipe => (recipe.VersionId, recipe.PublishedVersionId)).ToArray());
        Assert.IsTrue(version.Slots.SelectMany(slot => slot.Choices).All(choice => choice.RecipeVersionId != newer.VersionId), "The published plan keeps its versions.");

        // A draft of the plan is told the same, so the builder can offer the newest version.
        var editing = await R44aCreateAsync(owner, new(plan.Id, plan.VersionId, 1, R44aContent(oats.VersionId, chicken.VersionId)));
        var read = await ReadSliceAsync<MealPlanDraftView>(owner, R44aDraftUrl(editing.Id));
        Assert.AreEqual(
            (Guid?)newer.VersionId,
            read.Recipes.Single(recipe => recipe.VersionId == oats.VersionId).PublishedVersionId);
        Assert.IsTrue(read.Recipes.Any(recipe => recipe.VersionId == newer.VersionId && recipe.Status == PublicationStatus.Published));
    }

    /// <summary>
    /// Publishes R4.4a's two-day plan of the two recipes and assigns it to the client from the
    /// workspace's today, inside a free two-week nutrition plan; returns the plan and its first day.
    /// </summary>
    private static async Task<(Guid PlanId, DateOnly Start)> R44dAssignAsync(HttpClient coach, Guid clientId, Guid firstRecipeVersionId, Guid secondRecipeVersionId)
    {
        var draft = await R44aCreateAsync(coach, new(null, null, null, R44aContent(firstRecipeVersionId, secondRecipeVersionId, name: $"Plan {Guid.NewGuid():N}")));
        var mealPlan = await R44aPublishAsync(coach, draft.Id, draft.Version, replaceNewer: false);
        var start = TenantToday();
        var startText = start.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var enrollment = await CreateFreeNutritionEnrollmentAsync(coach, clientId, 14, startText);
        await RefreshCsrfAsync(coach);
        var calculationResponse = await coach.PostAsJsonAsync($"/api/nutrition/clients/{clientId}/calculations", new
        {
            bmrMethodKey = "MifflinStJeor",
            weightKilograms = 70m,
            heightCentimeters = 168m,
            ageYears = 29,
            sex = "Female",
            bodyFatPercentage = (decimal?)null,
            occupationType = "Seated",
            averageDailySteps = 8000,
            coachGoalAdjustment = 0m,
            calorieTarget = (decimal?)null,
            proteinGrams = 120m,
            fatPercentage = 25m,
            isEnergyDeficit = false,
        });
        await AssertStatusAsync(calculationResponse, HttpStatusCode.OK);
        var calculation = await RequiredJsonAsync<Phase4Calculation>(calculationResponse);
        await RefreshCsrfAsync(coach);
        var assigned = await coach.PostAsJsonAsync($"/api/nutrition/clients/{clientId}/plans", new
        {
            mealPlanTemplateVersionId = mealPlan.VersionId,
            enrollmentId = enrollment.Id,
            calculationSnapshotId = calculation.Id,
            startDate = startText,
            acknowledgeAllergenWarnings = false,
        });
        await AssertStatusAsync(assigned, HttpStatusCode.OK);
        return ((await ReadSlicePayloadAsync<ClientNutritionPlanSummary>(assigned)).Id, start);
    }

    private static async Task<Guid> R44dCopyIdAsync(HttpClient client, DateOnly date, string recipeName) =>
        (await ReadSliceAsync<ClientNutritionDayView>(client, R44dDayUrl(date))).Slots
            .SelectMany(slot => slot.Choices)
            .First(choice => choice.RecipeName == recipeName)
            .RecipeId ?? throw new AssertFailedException($"{recipeName} has no copy.");

    /// <summary>
    /// Asks for these photos in one batch, as the client's day does for its meal cards, and returns the
    /// one granted, or null when none is. The granted address is fetched too, so it really reads.
    /// </summary>
    private async Task<Guid?> R44dBatchGrantedAsync(HttpClient caller, params Guid[] assetIds)
    {
        RequiredTestClock.Set(DateTimeOffset.UtcNow);
        var response = await Phase6GrantBatchAsync(caller, assetIds);
        if (response.StatusCode is HttpStatusCode.Forbidden)
        {
            // Refused at the door (a released client): nothing is granted either.
            return null;
        }

        await AssertStatusAsync(response, HttpStatusCode.OK);
        var batch = await RequiredJsonAsync<Phase6GrantBatch>(response);
        if (batch.Items.Length is 0)
        {
            return null;
        }

        var granted = batch.Items.Single();
        await AssertStatusAsync(await caller.GetAsync(granted.ThumbnailUrl ?? granted.Url), HttpStatusCode.OK);
        return granted.AssetId;
    }

    private async Task<int> R44dRetireUnusedRecipePhotosAsync()
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<IMediaPurgeService>().RetireUnusedRecipePhotosAsync(50, CancellationToken.None);
    }

    private async Task<(Guid, string)[]> R44dAssetStatusesAsync(params Guid[] assetIds)
    {
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT \"Id\", \"Status\" FROM media.\"Assets\" WHERE \"Id\" = ANY(@ids)";
        command.Parameters.AddWithValue("ids", assetIds);
        await using var reader = await command.ExecuteReaderAsync();
        var statuses = new List<(Guid, string)>();
        while (await reader.ReadAsync())
        {
            statuses.Add((reader.GetGuid(0), reader.GetString(1)));
        }

        return [.. statuses];
    }
}
