using System.Net;
using System.Text;
using System.Text.Json;
using Anthropic;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using TB.Gym.Infrastructure.Application;
using TB.Gym.Modules.Nutrition;

namespace TB.Gym.Api.IntegrationTests;

[TestClass]
public sealed class AnthropicAiMealDraftProviderTests
{
    private const string Draft = """
        {"name":"Chicken rice bowl","ingredients":[{"name":"Rice","quantity":100,"unit":"g","uncertain":true}]}
        """;

    [TestMethod]
    public async Task SuccessUsesTheOwnedSchemaAndReturnsTheChargedUsage()
    {
        using var handler = new FakeAnthropicHandler(Response(Draft));
        using var provider = CreateProvider(handler);

        var result = await provider.GenerateAsync(Request(), CancellationToken.None);

        Assert.IsTrue(result.IsSuccess);
        Assert.IsTrue(result.CostIsKnown);
        Assert.AreEqual("anthropic-v1", provider.ProviderKey);
        Assert.AreEqual("claude-sonnet-5-5", result.Model);
        Assert.AreEqual(result.Model, result.ModelVersion);
        Assert.AreEqual(Draft, result.RawOutput);
        Assert.AreEqual(0.000804m, result.CostAmount);
        Assert.AreEqual("USD", result.CostCurrency);
        Assert.AreEqual(1, handler.RequestCount);

        using var request = JsonDocument.Parse(handler.Body!);
        var root = request.RootElement;
        Assert.AreEqual("claude-sonnet-5-5", root.GetProperty("model").GetString());
        Assert.AreEqual(2048, root.GetProperty("max_tokens").GetInt32());
        Assert.AreEqual("global", root.GetProperty("inference_geo").GetString());
        Assert.IsFalse(root.TryGetProperty("temperature", out _));
        Assert.IsFalse(root.TryGetProperty("tools", out _));
        Assert.IsFalse(root.TryGetProperty("metadata", out _));
        var format = root.GetProperty("output_config").GetProperty("format");
        Assert.AreEqual("low", root.GetProperty("output_config").GetProperty("effort").GetString());
        Assert.AreEqual("json_schema", format.GetProperty("type").GetString());
        Assert.IsFalse(format.GetProperty("schema").GetProperty("additionalProperties").GetBoolean());
        var ingredient = format.GetProperty("schema").GetProperty("properties").GetProperty("ingredients").GetProperty("items");
        Assert.IsFalse(ingredient.GetProperty("additionalProperties").GetBoolean());
        Assert.IsFalse(ingredient.GetProperty("properties").TryGetProperty("calories", out _));
        Assert.AreEqual("ephemeral", root.GetProperty("system")[0].GetProperty("cache_control").GetProperty("type").GetString());
        Assert.AreEqual("5m", root.GetProperty("system")[0].GetProperty("cache_control").GetProperty("ttl").GetString());
        using var userPrompt = JsonDocument.Parse(root.GetProperty("messages")[0].GetProperty("content").GetString()!);
        Assert.AreEqual("en-LB", userPrompt.RootElement.GetProperty("language").GetString());
        Assert.AreEqual(Request().Prompt, userPrompt.RootElement.GetProperty("recipeRequest").GetString());
        Assert.AreEqual(2, userPrompt.RootElement.EnumerateObject().Count());
        Assert.DoesNotContain("test-api-secret", handler.Body!, StringComparison.Ordinal);
    }

    [TestMethod]
    public async Task CacheReadsAndBothWriteTtlsAreCountedWithoutDoubleCounting()
    {
        using var handler = new FakeAnthropicHandler(Response(Draft, input: 50, output: 10, created: 30, read: 100, oneHour: 10));
        using var provider = CreateProvider(handler);

        var result = await provider.GenerateAsync(Request(), CancellationToken.None);

        Assert.IsTrue(result.IsSuccess);
        Assert.AreEqual(0.000310m, result.CostAmount);
    }

    [TestMethod]
    public async Task DefaultAdaptiveThinkingIsDiscardedWhileTheFinalJsonRemainsReviewable()
    {
        using var handler = new FakeAnthropicHandler(Response(Draft, includeThinking: true));
        using var provider = CreateProvider(handler);

        var result = await provider.GenerateAsync(Request(), CancellationToken.None);

        Assert.IsTrue(result.IsSuccess);
        Assert.AreEqual(Draft, result.RawOutput);
        Assert.AreEqual(0.000804m, result.CostAmount);
        Assert.DoesNotContain("sensitive reasoning", result.RawOutput, StringComparison.Ordinal);
    }

    [TestMethod]
    [DataRow("refusal", "ai_provider_refused")]
    [DataRow("max_tokens", "ai_provider_incomplete")]
    public async Task RefusalAndTruncationKeepTheirActualCostAndDiscardTheBody(string stopReason, string failureCode)
    {
        using var handler = new FakeAnthropicHandler(Response("Sensitive provider explanation", stopReason));
        using var provider = CreateProvider(handler);

        var result = await provider.GenerateAsync(Request(), CancellationToken.None);

        Assert.IsFalse(result.IsSuccess);
        Assert.IsTrue(result.CostIsKnown);
        Assert.AreEqual(failureCode, result.FailureCode);
        Assert.AreEqual(0.000804m, result.CostAmount);
        Assert.AreEqual(string.Empty, result.RawOutput);
    }

    [TestMethod]
    public async Task AMalformedResponseDoesNotClaimItsCostWasZero()
    {
        using var handler = new FakeAnthropicHandler("not-json");
        using var provider = CreateProvider(handler);

        var result = await provider.GenerateAsync(Request(), CancellationToken.None);

        Assert.IsFalse(result.IsSuccess);
        Assert.IsFalse(result.CostIsKnown);
        Assert.AreEqual("ai_provider_invalid_response", result.FailureCode);
        Assert.AreEqual(string.Empty, result.RawOutput);
    }

    [TestMethod]
    [DataRow(-1L, 50L)]
    [DataRow(long.MaxValue, 50L)]
    [DataRow(100L, long.MaxValue)]
    public async Task InvalidUsagePreservesAnUnknownCharge(long input, long output)
    {
        using var handler = new FakeAnthropicHandler(Response(Draft, input: input, output: output));
        using var provider = CreateProvider(handler);

        var result = await provider.GenerateAsync(Request(), CancellationToken.None);

        Assert.IsFalse(result.IsSuccess);
        Assert.IsFalse(result.CostIsKnown);
        Assert.AreEqual("ai_provider_invalid_usage", result.FailureCode);
    }

    [TestMethod]
    public async Task AnUnexpectedModelCannotUseTheApprovedModelsPrice()
    {
        using var handler = new FakeAnthropicHandler(Response(Draft).Replace("claude-sonnet-5-5", "unapproved-model", StringComparison.Ordinal));
        using var provider = CreateProvider(handler);

        var result = await provider.GenerateAsync(Request(), CancellationToken.None);

        Assert.IsFalse(result.IsSuccess);
        Assert.IsFalse(result.CostIsKnown);
        Assert.AreEqual("ai_provider_model_mismatch", result.FailureCode);
    }

    [TestMethod]
    public async Task CallerCancellationAfterTheRequestStartsCannotEraseAnUnknownCharge()
    {
        using var cancellation = new CancellationTokenSource();
        using var handler = new FakeAnthropicHandler(Response(Draft)) { OnRequest = cancellation.Cancel };
        using var provider = CreateProvider(handler);

        var result = await provider.GenerateAsync(Request(), cancellation.Token);

        Assert.IsFalse(result.IsSuccess);
        Assert.IsFalse(result.CostIsKnown);
        Assert.AreEqual("ai_provider_cancelled", result.FailureCode);
        Assert.AreEqual(1, handler.RequestCount);
    }

    [TestMethod]
    [DataRow(400, "ai_provider_request_rejected", true)]
    [DataRow(401, "ai_provider_authentication_failed", true)]
    [DataRow(403, "ai_provider_authentication_failed", true)]
    [DataRow(404, "ai_provider_request_rejected", true)]
    [DataRow(422, "ai_provider_request_rejected", true)]
    [DataRow(429, "ai_provider_rate_limited", true)]
    [DataRow(500, "ai_provider_unavailable", false)]
    [DataRow(529, "ai_provider_unavailable", false)]
    public async Task ProviderErrorsAreSanitizedAndAreNeverRetried(int status, string failureCode, bool costKnown)
    {
        using var handler = new FakeAnthropicHandler("""
            {"type":"error","error":{"type":"provider_error","message":"test-api-secret and sensitive recipe request"}}
            """, (HttpStatusCode)status);
        using var provider = CreateProvider(handler);

        var result = await provider.GenerateAsync(Request(), CancellationToken.None);

        Assert.IsFalse(result.IsSuccess);
        Assert.AreEqual(costKnown, result.CostIsKnown);
        Assert.AreEqual(failureCode, result.FailureCode);
        Assert.AreEqual(string.Empty, result.RawOutput);
        Assert.AreEqual(1, handler.RequestCount);
        Assert.DoesNotContain("test-api-secret", JsonSerializer.Serialize(result), StringComparison.Ordinal);
        Assert.DoesNotContain("sensitive recipe", JsonSerializer.Serialize(result), StringComparison.Ordinal);
    }

    [TestMethod]
    public async Task TimeoutAndAmbiguousTransportKeepTheReservationWithoutRetrying()
    {
        foreach (var exception in new Exception[] { new TaskCanceledException("sensitive timeout details"), new HttpRequestException("test-api-secret") })
        {
            using var handler = new FakeAnthropicHandler(Response(Draft)) { Exception = exception };
            using var provider = CreateProvider(handler);

            var result = await provider.GenerateAsync(Request(), CancellationToken.None);

            Assert.IsFalse(result.IsSuccess);
            Assert.IsFalse(result.CostIsKnown);
            Assert.AreEqual(exception is TaskCanceledException ? "ai_provider_timeout" : "ai_provider_transport_failure", result.FailureCode);
            Assert.AreEqual(string.Empty, result.RawOutput);
            Assert.AreEqual(1, handler.RequestCount);
        }
    }

    [TestMethod]
    public async Task UnsupportedSchemaAndOversizedPromptsNeverReachTheProvider()
    {
        using var handler = new FakeAnthropicHandler(Response(Draft));
        using var provider = CreateProvider(handler);
        foreach (var request in new[] { Request() with { RequiredSchemaVersion = "unknown" }, Request() with { Prompt = new string('x', 6001) } })
        {
            var result = await provider.GenerateAsync(request, CancellationToken.None);
            Assert.IsFalse(result.IsSuccess);
            Assert.IsTrue(result.CostIsKnown);
            Assert.AreEqual(0m, result.CostAmount);
            Assert.AreEqual("ai_provider_invalid_request", result.FailureCode);
        }
        Assert.AreEqual(0, handler.RequestCount);
    }

    [TestMethod]
    public async Task DisabledProviderDoesNotSendARequest()
    {
        using var handler = new FakeAnthropicHandler(Response(Draft));
        using var provider = CreateProvider(handler, new AnthropicAiMealDraftOptions());

        var result = await provider.GenerateAsync(Request(), CancellationToken.None);

        Assert.IsFalse(provider.IsConfigured);
        Assert.AreEqual("ai_provider_not_configured", result.FailureCode);
        Assert.AreEqual(0, handler.RequestCount);
    }

    [TestMethod]
    public void TheReservationAllowsForFullOutputAndUncachedMultilingualInput()
    {
        using var handler = new FakeAnthropicHandler(Response(Draft));
        using var provider = CreateProvider(handler);
        var normal = provider.EstimateMaximumCost(Request());
        var longArabic = provider.EstimateMaximumCost(Request() with { Prompt = new string('\u0637', 6000), Culture = "ar-LB" });

        Assert.AreEqual("USD", normal.Currency);
        Assert.IsGreaterThan(2048m * 10m / 1_000_000m, normal.Amount);
        Assert.IsGreaterThan(normal.Amount, longArabic.Amount);
        var noCacheOptions = ValidOptions();
        noCacheOptions.UsePromptCaching = false;
        using var noCacheProvider = CreateProvider(handler, noCacheOptions);
        Assert.IsLessThan(normal.Amount, noCacheProvider.EstimateMaximumCost(Request()).Amount);
    }

    [TestMethod]
    public void StartupKeepsUnconfiguredDeploymentsClosedAndRefusesUnpricedModels()
    {
        using var disabled = BuildServices([]);
        Assert.IsFalse(disabled.GetRequiredService<IAiMealDraftProvider>().IsConfigured);

        foreach (var settings in new Dictionary<string, string?>[]
                 {
                     new() { ["Nutrition:Anthropic:Enabled"] = "true" },
                     new() { ["Nutrition:Anthropic:Model"] = "unpriced-model" },
                     new() { ["Nutrition:Anthropic:MaxOutputTokens"] = "100000" },
                     new() { ["Nutrition:Anthropic:TimeoutSeconds"] = "0" },
                 })
        {
            using var services = BuildServices(settings);
            var failure = Assert.ThrowsExactly<OptionsValidationException>(() => services.GetRequiredService<IOptions<AnthropicAiMealDraftOptions>>().Value);
            Assert.DoesNotContain("test-api-secret", failure.Message, StringComparison.Ordinal);
        }
    }

    private static ServiceProvider BuildServices(Dictionary<string, string?> settings)
    {
        var services = new ServiceCollection();
        services.AddTbGymAnthropicMealDrafts(new ConfigurationBuilder().AddInMemoryCollection(settings).Build());
        return services.BuildServiceProvider();
    }

    private static AnthropicAiMealDraftOptions ValidOptions() => new() { Enabled = true, ApiKey = "test-api-secret" };

    private static AnthropicAiMealDraftProvider CreateProvider(FakeAnthropicHandler handler, AnthropicAiMealDraftOptions? options = null) => new(new AnthropicClient
    {
        ApiKey = "test-api-secret",
        BaseUrl = "https://api.anthropic.com",
        HttpClient = new HttpClient(handler, disposeHandler: false),
        MaxRetries = 0,
        Timeout = TimeSpan.FromSeconds(5),
    }, Options.Create(options ?? ValidOptions()));

    private static AiMealDraftProviderRequest Request() => new("A chicken and rice bowl", "meal-prompt-v1", "meal-draft-v1", "en-LB");

    private static string Response(string text, string stopReason = "end_turn", long input = 100, long output = 50, long created = 40, long read = 20, long oneHour = 0, bool includeThinking = false) => JsonSerializer.Serialize(new
    {
        id = "msg_fake",
        type = "message",
        role = "assistant",
        model = "claude-sonnet-5-5",
        content = includeThinking
            ? new object[] { new { type = "thinking", thinking = "sensitive reasoning", signature = "fake-signature" }, new { type = "text", text } }
            : new object[] { new { type = "text", text } },
        stop_reason = stopReason,
        stop_sequence = (string?)null,
        usage = new
        {
            input_tokens = input,
            output_tokens = output,
            cache_creation_input_tokens = created,
            cache_read_input_tokens = read,
            cache_creation = new { ephemeral_5m_input_tokens = created - oneHour, ephemeral_1h_input_tokens = oneHour },
        },
    });

    private sealed class FakeAnthropicHandler(string response, HttpStatusCode status = HttpStatusCode.OK) : HttpMessageHandler
    {
        public int RequestCount { get; private set; }
        public string? Body { get; private set; }
        public Exception? Exception { get; init; }
        public Action? OnRequest { get; init; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            RequestCount++;
            Body = await request.Content!.ReadAsStringAsync(cancellationToken);
            OnRequest?.Invoke();
            cancellationToken.ThrowIfCancellationRequested();
            if (Exception is not null) throw Exception;
            return new HttpResponseMessage(status) { Content = new StringContent(response, Encoding.UTF8, "application/json") };
        }
    }
}
