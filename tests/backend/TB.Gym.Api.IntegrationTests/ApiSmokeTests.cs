using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

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
    }

    [TestMethod]
    public async Task SystemStatusExposesTheNewArchitecture()
    {
        var response = await RequiredClient.GetFromJsonAsync<SystemStatus>("/api/system/status");

        Assert.IsNotNull(response);
        Assert.AreEqual("TB Gym API", response.Name);
        Assert.AreEqual("Modular Monolith", response.Architecture);
    }

    private HttpClient RequiredClient => client ?? throw new InvalidOperationException("The test client is not initialized.");

    private sealed record SystemStatus(string Name, string Architecture, string Framework, DateTimeOffset UtcTime);
}
