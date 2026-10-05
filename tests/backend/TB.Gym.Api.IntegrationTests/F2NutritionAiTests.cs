using System.Net;
using System.Net.Http.Json;
using Npgsql;
using TB.Gym.Modules.Nutrition;

namespace TB.Gym.Api.IntegrationTests;

public sealed partial class Phase3TrainingWorkflowTests
{
    private readonly LaunchMealDraftProvider launchAiProvider = new();

    [TestMethod]
    public async Task F2AiDraftFailuresKeepCostsAndNeverCreateRecipes()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "f2-ai@example.test", "AI Coach", "AI workspace");
        await SetLaunchAiBudgetAsync(coach, 10, 10m);
        var availability = await coach.GetFromJsonAsync<AiMealDraftAvailabilityView>("/api/nutrition/ai-drafts/availability");
        Assert.IsTrue(availability!.IsConfigured);

        await RefreshCsrfAsync(coach);
        var success = await RequiredJsonAsync<LaunchAiDraft>(await coach.PostAsJsonAsync("/api/nutrition/ai-drafts", new GenerateAiMealDraftRequest("good", "test-v1", "en-LB")));
        Assert.AreEqual("AwaitingCoachReview", success.Status);
        Assert.AreEqual(0.1m, success.CostAmount);
        StringAssert.Contains(success.UncertainFieldsJson!, "oats");

        foreach (var (prompt, status) in new[] { ("invalid", HttpStatusCode.BadRequest), ("fail", HttpStatusCode.ServiceUnavailable), ("timeout", HttpStatusCode.ServiceUnavailable) })
        {
            await RefreshCsrfAsync(coach);
            await AssertStatusAsync(await coach.PostAsJsonAsync("/api/nutrition/ai-drafts", new GenerateAiMealDraftRequest(prompt, "test-v1", "en-LB")), status);
        }

        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT count(*), sum(\"CostAmount\"), (SELECT count(*) FROM nutrition.\"Recipes\") FROM nutrition.\"AiMealDraftOperations\"";
        await using var reader = await command.ExecuteReaderAsync();
        Assert.IsTrue(await reader.ReadAsync());
        Assert.AreEqual(4L, reader.GetInt64(0));
        Assert.AreEqual(1.05m, reader.GetDecimal(1));
        Assert.AreEqual(0L, reader.GetInt64(2));
        Assert.AreEqual(4, launchAiProvider.Calls);
    }

    [TestMethod]
    public async Task F2ConcurrentAiRequestsReserveAllowanceBeforeCallingProvider()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "f2-race@example.test", "AI Coach", "AI race");
        await SetLaunchAiBudgetAsync(coach, 10, 0.5m);
        await RefreshCsrfAsync(coach);
        var first = coach.PostAsJsonAsync("/api/nutrition/ai-drafts", new GenerateAiMealDraftRequest("wait", "test-v1", "en-LB"));
        try
        {
            await launchAiProvider.Entered.Task.WaitAsync(TimeSpan.FromSeconds(20));
            await RefreshCsrfAsync(coach);
            var refused = await coach.PostAsJsonAsync("/api/nutrition/ai-drafts", new GenerateAiMealDraftRequest("good", "test-v1", "en-LB"));
            await AssertStatusAsync(refused, HttpStatusCode.Conflict);
            StringAssert.Contains(await refused.Content.ReadAsStringAsync(), "ai_usage_limit");
            Assert.AreEqual(1, launchAiProvider.Calls);
        }
        finally
        {
            launchAiProvider.Release.TrySetResult();
        }

        await AssertStatusAsync(await first, HttpStatusCode.OK);
        // The actual cost replaces the reservation, leaving room for the next request.
        await SetLaunchAiBudgetAsync(coach, 1, 0.5m);
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PostAsJsonAsync("/api/nutrition/ai-drafts", new GenerateAiMealDraftRequest("good", "test-v1", "en-LB")), HttpStatusCode.Conflict);
        Assert.AreEqual(1, launchAiProvider.Calls);
    }

    [TestMethod]
    public async Task F2UnavailableAiIsVisibleAndAvailabilityRemainsTenantAuthorized()
    {
        launchAiProvider.IsConfigured = false;
        using var anonymous = CreateClient();
        await AssertStatusAsync(await anonymous.GetAsync("/api/nutrition/ai-drafts/availability"), HttpStatusCode.Unauthorized);
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "f2-status@example.test", "AI Coach", "AI status");
        var availability = await coach.GetFromJsonAsync<AiMealDraftAvailabilityView>("/api/nutrition/ai-drafts/availability");
        Assert.IsFalse(availability!.IsConfigured);
        await RefreshCsrfAsync(coach);
        var failure = await coach.PostAsJsonAsync("/api/nutrition/ai-drafts", new GenerateAiMealDraftRequest("good", "test-v1", "en-LB"));
        await AssertStatusAsync(failure, HttpStatusCode.ServiceUnavailable);
        StringAssert.Contains(await failure.Content.ReadAsStringAsync(), "ai_provider_not_configured");
        using var other = CreateClient();
        await RegisterCoachAsync(other, "f2-other@example.test", "Other Coach", "Other AI");
        SetTenant(other, workspaceId);
        await AssertStatusAsync(await other.GetAsync("/api/nutrition/ai-drafts/availability"), HttpStatusCode.Forbidden);
        await RefreshCsrfAsync(other);
        await AssertStatusAsync(await other.PostAsJsonAsync("/api/nutrition/ai-drafts", new GenerateAiMealDraftRequest("good", "test-v1", "en-LB")), HttpStatusCode.Forbidden);
        Assert.AreEqual(1, launchAiProvider.Calls);
    }

    private static async Task SetLaunchAiBudgetAsync(HttpClient coach, int requests, decimal amount)
    {
        var settings = await coach.GetFromJsonAsync<NutritionWorkspaceSettingsView>("/api/nutrition/settings") ?? throw new AssertFailedException("No nutrition settings.");
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PutAsJsonAsync("/api/nutrition/settings", new UpdateNutritionSettingsRequest(settings.EnergyPolicyKey, settings.ProviderCalorieTolerance, requests, amount, "USD", settings.Version)), HttpStatusCode.OK);
    }

    private sealed record LaunchAiDraft(string Status, decimal CostAmount, string? UncertainFieldsJson);
}

internal sealed class LaunchMealDraftProvider : IAiMealDraftProvider
{
    public string ProviderKey => "LaunchTestProvider";
    public bool IsConfigured { get; set; } = true;
    public int Calls;
    public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public AiMealDraftCostEstimate EstimateMaximumCost(AiMealDraftProviderRequest request) => new(IsConfigured ? 0.5m : 0m, "USD");

    public async Task<AiMealDraftProviderResult> GenerateAsync(AiMealDraftProviderRequest request, CancellationToken cancellationToken)
    {
        Interlocked.Increment(ref Calls);
        if (!IsConfigured) return new(false, "test", "v1", "", 0m, "USD", "ai_provider_not_configured");
        if (request.Prompt == "wait")
        {
            Entered.TrySetResult();
            await Release.Task.WaitAsync(cancellationToken);
        }

        return request.Prompt switch
        {
            "timeout" => throw new OperationCanceledException(),
            "fail" => new(false, "test", "v1", "", 0.2m, "USD", "ai_provider_unavailable"),
            "invalid" => new(true, "test", "v1", "{\"unexpected\":true}", 0.25m, "USD"),
            _ => new(true, "test", "v1", """{"name":"Oat bowl","ingredients":[{"name":"oats","quantity":100,"unit":"g","uncertain":true}]}""", 0.1m, "USD"),
        };
    }
}
