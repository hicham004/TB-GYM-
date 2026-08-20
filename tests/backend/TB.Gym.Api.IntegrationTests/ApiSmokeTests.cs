using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;
using TB.Gym.Modules.Tenancy;

namespace TB.Gym.Api.IntegrationTests;

[TestClass]
public sealed class ApiSmokeTests
{
    private WebApplicationFactory<Program>? factory;
    private HttpClient? client;

    [TestInitialize]
    public void Initialize()
    {
        factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder => builder.UseEnvironment("Development"));
        client = factory.CreateClient();
    }

    [TestCleanup]
    public void Cleanup()
    {
        client?.Dispose();
        factory?.Dispose();
    }

    [TestMethod]
    public async Task LiveHealthEndpointIsPublicAndHealthy()
    {
        var response = await RequiredClient.GetAsync("/health/live");

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        Assert.IsTrue(response.Headers.TryGetValues("X-Content-Type-Options", out var values));
        Assert.AreEqual("nosniff", values.Single());
    }

    [TestMethod]
    public async Task SystemStatusExposesTheNewArchitecture()
    {
        var response = await RequiredClient.GetAsync("/api/system/status");
        var status = await response.Content.ReadFromJsonAsync<SystemStatus>();

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        Assert.IsTrue(response.Headers.CacheControl is { NoStore: true });
        Assert.IsNotNull(status);
        Assert.AreEqual("TB Gym API", status.Name);
        Assert.AreEqual("Modular Monolith", status.Architecture);
    }

    [TestMethod]
    public void TenantRolesUseTheDocumentedStringContract()
    {
        var options = RequiredFactory.Services
            .GetRequiredService<IOptions<JsonOptions>>()
            .Value
            .SerializerOptions;

        var json = JsonSerializer.Serialize(TenantRole.Owner, options);

        Assert.AreEqual("\"Owner\"", json);
    }

    [TestMethod]
    public void ProductionEnvironmentRefusesDevelopmentSeedingBeforeDatabaseAccess()
    {
        var generatedTestPassword = $"Aa1!{Guid.NewGuid():N}";
        using var productionFactory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                builder.UseEnvironment("Production");
                builder.UseSetting(
                    "ConnectionStrings:Database",
                    "Host=invalid;Database=invalid;Username=invalid");
                builder.UseSetting("Database:ApplyMigrationsOnStartup", "false");
                builder.UseSetting("Seed:Enabled", "true");
                builder.UseSetting("Seed:AdminEmail", "admin@example.test");
                builder.UseSetting("Seed:AdminPassword", generatedTestPassword);
                builder.ConfigureAppConfiguration((_, configuration) =>
                    configuration.AddInMemoryCollection(new Dictionary<string, string?>
                    {
                        ["ConnectionStrings:Database"] = "Host=invalid;Database=invalid;Username=invalid",
                        ["Database:ApplyMigrationsOnStartup"] = "false",
                        ["Seed:Enabled"] = "true",
                        ["Seed:AdminEmail"] = "admin@example.test",
                        ["Seed:AdminPassword"] = generatedTestPassword,
                    }));
            });

        var exception = Assert.ThrowsExactly<InvalidOperationException>(() =>
            productionFactory.CreateClient());

        StringAssert.Contains(exception.Message, "development-only");
    }

    private HttpClient RequiredClient => client ?? throw new InvalidOperationException("The test client is not initialized.");

    private WebApplicationFactory<Program> RequiredFactory =>
        factory ?? throw new InvalidOperationException("The test factory is not initialized.");

    private sealed record SystemStatus(string Name, string Architecture, string Framework, DateTimeOffset UtcTime);
}
