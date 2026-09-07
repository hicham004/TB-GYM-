using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Npgsql;
using TB.Gym.Infrastructure.Application;
using TB.Gym.Modules.Media;

namespace TB.Gym.Api.IntegrationTests;

[TestClass]
public sealed class Phase6B4AMediaStorageStartupTests
{
    private string? adminConnection;
    private string? databaseName;
    private string? databaseConnection;
    private string? mediaRoot;

    [TestInitialize]
    public async Task InitializeAsync()
    {
        adminConnection = PostgreSqlTestEnvironment.RequireAdminConnection();
        databaseName = await PostgreSqlTestEnvironment.CreateDatabaseAsync("tbgym_p6b4_storage");
        databaseConnection = new NpgsqlConnectionStringBuilder(adminConnection)
        {
            Database = databaseName,
        }.ConnectionString;
        mediaRoot = Path.Combine(Path.GetTempPath(), databaseName, "production-media");
    }

    [TestCleanup]
    public async Task CleanupAsync()
    {
        NpgsqlConnection.ClearAllPools();
        if (databaseName is null || adminConnection is null)
        {
            return;
        }

        var testRoot = Path.Combine(Path.GetTempPath(), databaseName);
        if (Directory.Exists(testRoot))
        {
            Directory.Delete(testRoot, recursive: true);
        }

        await using var connection = new NpgsqlConnection(adminConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = $"DROP DATABASE IF EXISTS \"{databaseName}\" WITH (FORCE)";
        await command.ExecuteNonQueryAsync();
    }

    [TestMethod]
    public async Task ProductionWithoutAnAdapterComposesUnavailableStorageAndReportsItAtReadiness()
    {
        using var factory = CreateFactory("Production", storageAdapter: null);
        using var client = factory.CreateClient();

        var storage = factory.Services.GetRequiredService<IObjectStorage>();
        Assert.IsInstanceOfType<UnavailableObjectStorage>(storage);
        Assert.IsFalse(storage.IsAvailable);
        Assert.AreEqual(MediaStorageLocations.Unavailable, storage.WriteLocation);
        Assert.IsFalse(Directory.Exists(mediaRoot), "Unavailable storage touched the configured local path.");

        var readiness = await factory.Services
            .GetRequiredService<HealthCheckService>()
            .CheckHealthAsync(registration => registration.Tags.Contains("ready"));
        Assert.AreEqual(HealthStatus.Degraded, readiness.Entries["media-storage"].Status);
        Assert.AreEqual(
            "Media object storage is unavailable, so media uploads and object access are refused.",
            readiness.Entries["media-storage"].Description);
    }

    [TestMethod]
    public void ProductionExplicitlyRefusesLocalStorageBeforeCreatingItsDirectory()
    {
        using var factory = CreateFactory("Production", "Local");

        var failure = Assert.ThrowsExactly<InvalidOperationException>(() => factory.CreateClient());

        Assert.AreEqual("Local media storage may be selected only in Development.", failure.Message);
        Assert.IsFalse(Directory.Exists(mediaRoot), "Rejected production storage created its local directory.");
    }

    [TestMethod]
    public void DevelopmentMaySelectLocalImplicitlyButConstructionStillDoesNotTouchDisk()
    {
        using var factory = CreateFactory("Development", storageAdapter: null);
        using var client = factory.CreateClient();

        var storage = factory.Services.GetRequiredService<IObjectStorage>();
        Assert.IsInstanceOfType<LocalObjectStorage>(storage);
        Assert.IsTrue(storage.IsAvailable);
        Assert.AreEqual(MediaStorageLocations.LocalV1, storage.WriteLocation);
        Assert.IsFalse(Directory.Exists(mediaRoot), "Local storage created its root before the first accepted upload.");
    }

    private WebApplicationFactory<Program> CreateFactory(string environment, string? storageAdapter)
    {
        var settings = new Dictionary<string, string?>
        {
            ["ConnectionStrings:Database"] = databaseConnection,
            ["Database:ApplyMigrationsOnStartup"] = "false",
            ["Seed:Enabled"] = "false",
            ["Application:PublicBaseUrl"] =
                environment == "Development" ? "http://localhost:4200" : "https://app.tbgym.test",
            ["Application:PublicOriginAllowlist:0"] = "https://app.tbgym.test",
            ["DataProtection:KeyPath"] = Path.Combine(Path.GetTempPath(), databaseName!, "keys"),
            ["Media:StorageRoot"] = mediaRoot,
            ["Media:PurgeEnabled"] = "false",
            ["Notifications:Dispatch:PollIntervalSeconds"] = "300",
            ["Messaging:Realtime:Enabled"] = "false",
            ["Messaging:Realtime:ApiReplicaCount"] = "1",
            ["Messaging:Realtime:AllowedOrigins:0"] = "http://localhost:4200",
        };
        if (storageAdapter is not null)
        {
            settings["Media:StorageAdapter"] = storageAdapter;
        }

        return new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment(environment);
            foreach (var (key, value) in settings)
            {
                builder.UseSetting(key, value);
            }

            builder.ConfigureAppConfiguration((_, configuration) =>
                configuration.AddInMemoryCollection(settings));
        });
    }
}
