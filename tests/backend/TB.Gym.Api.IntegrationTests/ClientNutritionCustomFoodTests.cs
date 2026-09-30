using System.Net;
using System.Net.Http.Json;
using Npgsql;

namespace TB.Gym.Api.IntegrationTests;

public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task Phase4ClientCustomFoodIsTenantScopedVersionedAndFrozenWithTheDay()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "custom-food-coach@example.test", "Nutrition Coach", "Custom Food");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "custom-food-client@example.test", true);
        SetTenant(client, workspaceId);
        await CreateNutritionScenarioAsync(coach, clientId, 1, 7, false, true);
        var day = await client.GetFromJsonAsync<Phase4Day>("/api/nutrition/me/day?localDate=2026-08-22")
            ?? throw new AssertFailedException("Nutrition day was empty.");

        var command = new
        {
            planDayId = day.PlanDayId, name = "Apple", amount = 150m, unit = "Gram",
            calories = 80m, proteinGrams = 0m, carbohydrateGrams = 21m, fatGrams = 0m,
            dailyLogVersion = day.DailyLogVersion,
        };
        using var anonymous = CreateClient();
        SetTenant(anonymous, workspaceId);
        Assert.AreEqual(HttpStatusCode.Unauthorized, (await anonymous.PostAsJsonAsync("/api/nutrition/me/custom-foods", command)).StatusCode);

        await RefreshCsrfAsync(client);
        var addedResponse = await client.PostAsJsonAsync("/api/nutrition/me/custom-foods", command);
        await AssertStatusAsync(addedResponse, HttpStatusCode.OK);
        var added = await RequiredJsonAsync<Phase4Day>(addedResponse);
        Assert.AreEqual(80m, added.SelectedCalories);
        Assert.AreEqual("Apple", added.CustomFoods.Single().Name);
        Assert.AreEqual(150m, added.CustomFoods.Single().Amount);
        Assert.AreEqual("Gram", added.CustomFoods.Single().Unit);
        Assert.AreEqual(80m, added.CustomFoods.Single().Calories);
        Assert.AreEqual(0, added.Slots.Count(item => item.SelectedChoiceId is not null));

        await RefreshCsrfAsync(client);
        Assert.AreEqual(HttpStatusCode.Conflict, (await client.PostAsJsonAsync("/api/nutrition/me/custom-foods", command)).StatusCode);
        await RefreshCsrfAsync(client);
        Assert.AreEqual(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/nutrition/me/custom-foods", new
        {
            planDayId = day.PlanDayId, name = "Invalid", amount = -1m, unit = "Gram",
            calories = 80m, proteinGrams = 0m, carbohydrateGrams = 21m, fatGrams = 0m,
            dailyLogVersion = added.DailyLogVersion,
        })).StatusCode);

        using var otherCoach = CreateClient();
        var otherWorkspaceId = await RegisterCoachAsync(otherCoach, "other-custom-food-coach@example.test", "Other Coach", "Other Food");
        using var otherClient = CreateClient();
        var otherClientId = await InviteAndAcceptAsync(otherCoach, otherClient, "other-custom-food-client@example.test", true);
        SetTenant(otherClient, otherWorkspaceId);
        await CreateNutritionScenarioAsync(otherCoach, otherClientId, 1, 7, false, true);
        await RefreshCsrfAsync(otherClient);
        Assert.AreEqual(HttpStatusCode.NotFound, (await otherClient.PostAsJsonAsync("/api/nutrition/me/custom-foods", command)).StatusCode);

        var foodId = added.CustomFoods.Single().Id;
        var reversePath = $"/api/nutrition/me/custom-foods/{foodId}/reverse";
        var beforeReverse = await client.GetFromJsonAsync<Phase4Day>("/api/nutrition/me/day?localDate=2026-08-22")
            ?? throw new AssertFailedException("Nutrition day was empty before reversal.");
        Assert.AreEqual(added.DailyLogVersion, beforeReverse.DailyLogVersion);
        await RefreshCsrfAsync(otherClient);
        Assert.AreEqual(HttpStatusCode.NotFound,
            (await otherClient.PostAsJsonAsync(reversePath, new { dailyLogVersion = added.DailyLogVersion })).StatusCode);
        await RefreshCsrfAsync(client);
        var reversedResponse = await client.PostAsJsonAsync(reversePath, new { dailyLogVersion = added.DailyLogVersion });
        await AssertStatusAsync(reversedResponse, HttpStatusCode.OK);
        var reversed = await RequiredJsonAsync<Phase4Day>(reversedResponse);
        Assert.AreEqual(0m, reversed.SelectedCalories);
        Assert.IsEmpty(reversed.CustomFoods);
        await RefreshCsrfAsync(client);
        Assert.AreEqual(HttpStatusCode.Conflict,
            (await client.PostAsJsonAsync(reversePath, new { dailyLogVersion = added.DailyLogVersion })).StatusCode);
        await RefreshCsrfAsync(client);
        Assert.AreEqual(HttpStatusCode.Conflict,
            (await client.PostAsJsonAsync(reversePath, new { dailyLogVersion = reversed.DailyLogVersion })).StatusCode);

        await RefreshCsrfAsync(client);
        var replacementResponse = await client.PostAsJsonAsync("/api/nutrition/me/custom-foods", new
        {
            planDayId = day.PlanDayId, name = "Pear", amount = 1m, unit = "Serving",
            calories = 90m, proteinGrams = 0m, carbohydrateGrams = 24m, fatGrams = 0m,
            dailyLogVersion = reversed.DailyLogVersion,
        });
        await AssertStatusAsync(replacementResponse, HttpStatusCode.OK);
        var replacement = await RequiredJsonAsync<Phase4Day>(replacementResponse);

        await RefreshCsrfAsync(client);
        await AssertStatusAsync(await client.PostAsJsonAsync($"/api/nutrition/me/logs/{replacement.DailyLogId}/complete", new { version = replacement.DailyLogVersion }), HttpStatusCode.OK);
        await RefreshCsrfAsync(client);
        Assert.AreEqual(HttpStatusCode.Conflict,
            (await client.PostAsJsonAsync($"/api/nutrition/me/custom-foods/{replacement.CustomFoods.Single().Id}/reverse",
                new { dailyLogVersion = replacement.DailyLogVersion })).StatusCode);
        await RefreshCsrfAsync(client);
        Assert.AreEqual(HttpStatusCode.Conflict, (await client.PostAsJsonAsync("/api/nutrition/me/custom-foods", new
        {
            planDayId = day.PlanDayId, name = "Another", amount = 1m, unit = "Serving",
            calories = 10m, proteinGrams = 0m, carbohydrateGrams = 0m, fatGrams = 0m,
            dailyLogVersion = added.DailyLogVersion,
        })).StatusCode);

        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await AssertDatabaseMutationRejectedAsync(connection,
            "UPDATE nutrition.\"DailyNutritionCustomFoods\" SET \"Name\" = 'Tampered' WHERE \"Id\" = @id", foodId);
        await AssertDatabaseMutationRejectedAsync(connection,
            "DELETE FROM nutrition.\"DailyNutritionCustomFoodReversals\" WHERE \"CustomFoodId\" = @id", foodId);
    }

    [TestMethod]
    public async Task Phase4ConcurrentFirstCustomFoodsReturnOneConflict()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "custom-food-race-coach@example.test", "Nutrition Coach", "Custom Food Race");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "custom-food-race-client@example.test", true);
        SetTenant(client, workspaceId);
        await CreateNutritionScenarioAsync(coach, clientId, 1, 7, false, true);
        var day = await client.GetFromJsonAsync<Phase4Day>("/api/nutrition/me/day?localDate=2026-08-22")
            ?? throw new AssertFailedException("Nutrition day was empty.");
        Assert.IsNull(day.DailyLogId);

        await RefreshCsrfAsync(client);
        var command = new
        {
            planDayId = day.PlanDayId, name = "Apple", amount = 150m, unit = "Gram",
            calories = 80m, proteinGrams = 0m, carbohydrateGrams = 21m, fatGrams = 0m,
            dailyLogVersion = day.DailyLogVersion,
        };
        var responses = await Task.WhenAll(
            client.PostAsJsonAsync("/api/nutrition/me/custom-foods", command),
            client.PostAsJsonAsync("/api/nutrition/me/custom-foods", command));
        Assert.AreEqual(1, responses.Count(response => response.StatusCode == HttpStatusCode.OK));
        Assert.AreEqual(1, responses.Count(response => response.StatusCode == HttpStatusCode.Conflict));

        var after = await client.GetFromJsonAsync<Phase4Day>("/api/nutrition/me/day?localDate=2026-08-22")
            ?? throw new AssertFailedException("Nutrition day was empty after concurrent writes.");
        Assert.HasCount(1, after.CustomFoods);
        Assert.AreEqual(80m, after.SelectedCalories);
    }
}
