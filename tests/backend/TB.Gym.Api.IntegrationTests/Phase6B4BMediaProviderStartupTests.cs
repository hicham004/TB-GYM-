using Amazon.Runtime;
using Amazon.S3;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Npgsql;
using TB.Gym.Infrastructure;
using TB.Gym.Infrastructure.Application;
using TB.Gym.Modules.Media;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Composing the production media providers: what a deployment gets when it names one, what it gets
/// when it names nothing, and what happens when it names one it cannot use.
/// </summary>
[TestClass]
public sealed class Phase6B4BMediaProviderStartupTests
{
    private const string AccountId = "0123456789abcdef0123456789abcdef";
    private const string AccessKeyId = "0123456789abcdef0123456789abcdef";
    private const string SecretAccessKey = "topsecret0123456789abcdefsecret0";

    private string? adminConnection;
    private string? databaseName;
    private string? databaseConnection;

    [TestInitialize]
    public async Task InitializeAsync()
    {
        adminConnection = PostgreSqlTestEnvironment.RequireAdminConnection();
        databaseName = await PostgreSqlTestEnvironment.CreateDatabaseAsync("tbgym_p6b4b_providers");
        databaseConnection = new NpgsqlConnectionStringBuilder(adminConnection)
        {
            Database = databaseName,
        }.ConnectionString;
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
    public void SelectingR2ComposesTheAdapterThatOwnsTheEuLocation()
    {
        using var factory = CreateFactory("Production", R2Settings());
        using var client = factory.CreateClient();

        var storage = factory.Services.GetRequiredService<IObjectStorage>();
        Assert.IsInstanceOfType<R2ObjectStorage>(storage);
        Assert.IsTrue(storage.IsAvailable);
        Assert.AreEqual("r2-eu-v1", storage.WriteLocation);

        var s3 = factory.Services.GetRequiredService<IAmazonS3>();
        Assert.AreEqual(
            "https://0123456789abcdef0123456789abcdef.eu.r2.cloudflarestorage.com/",
            s3.Config.ServiceURL);
    }

    [TestMethod]
    public void SelectingClamAvComposesTheScannerThatStreamsStoredBytes()
    {
        using var factory = CreateFactory("Production", ClamAvSettings(port: 3310));
        using var client = factory.CreateClient();

        var scanner = factory.Services.GetRequiredService<IMediaScanner>();
        Assert.IsInstanceOfType<ClamAvMediaScanner>(scanner);
        Assert.IsTrue(scanner.IsAvailable);
    }

    [TestMethod]
    [DynamicData(nameof(InvalidProviderConfigurations))]
    public void NamingAProviderItCannotUseRefusesStartupAndNamesTheSettingWithoutQuotingIt(
        Dictionary<string, string?> settings,
        string expectedSetting)
    {
        using var factory = CreateFactory("Production", settings);

        var failure = Assert.ThrowsExactly<InvalidOperationException>(() => factory.CreateClient());

        Assert.Contains(expectedSetting, failure.Message, StringComparison.Ordinal);
        Assert.DoesNotContain(
            SecretAccessKey,
            failure.Message,
            StringComparison.Ordinal,
            "A refused startup quoted a credential into a console and a log aggregator.");
    }

    public static IEnumerable<object[]> InvalidProviderConfigurations()
    {
        yield return [Without(R2Settings(), "Media:R2:BucketName"), "Media:R2:BucketName"];
        yield return [Without(R2Settings(), "Media:R2:AccountId"), "Media:R2:AccountId"];
        yield return [Without(R2Settings(), "Media:R2:AccessKeyId"), "Media:R2:AccessKeyId"];
        yield return [Without(R2Settings(), "Media:R2:SecretAccessKey"), "Media:R2:SecretAccessKey"];
        yield return [With(R2Settings(), "Media:R2:Jurisdiction", "apac"), "Media:R2:Jurisdiction"];
        yield return [Without(ClamAvSettings(3310), "Media:ClamAv:Host"), "Media:ClamAv:Host"];
        yield return [With(ClamAvSettings(3310), "Media:ClamAv:Port", "0"), "Media:ClamAv:Port"];
        yield return
        [
            With(ClamAvSettings(3310), "Media:ClamAv:ScanTimeoutSeconds", "1"),
            "Media:ClamAv:ScanTimeoutSeconds",
        ];
    }

    [TestMethod]
    public void AnUnsupportedAdapterNameIsRefusedRatherThanIgnored()
    {
        using var storageFactory = CreateFactory(
            "Production",
            new Dictionary<string, string?> { ["Media:StorageAdapter"] = "S3" });
        using var scannerFactory = CreateFactory(
            "Production",
            new Dictionary<string, string?> { ["Media:ScannerAdapter"] = "Sophos" });

        Assert.AreEqual(
            "Media:StorageAdapter is not supported.",
            Assert.ThrowsExactly<InvalidOperationException>(() => storageFactory.CreateClient()).Message);
        Assert.AreEqual(
            "Media:ScannerAdapter is not supported.",
            Assert.ThrowsExactly<InvalidOperationException>(() => scannerFactory.CreateClient()).Message);
    }

    /// <summary>
    /// The development scanner allows every file, so composing it outside Development would turn
    /// fail-closed into fail-open with nothing to show that it had.
    /// </summary>
    [TestMethod]
    public void TheDevelopmentScannerIsRefusedOutsideDevelopment()
    {
        using var factory = CreateFactory(
            "Production",
            new Dictionary<string, string?> { ["Media:ScannerAdapter"] = "Development" });

        var failure = Assert.ThrowsExactly<InvalidOperationException>(() => factory.CreateClient());

        Assert.AreEqual(
            "The development media scanner may be selected only in Development.",
            failure.Message);
    }

    /// <summary>
    /// Naming nothing keeps Phase 6B-4A's behaviour exactly, wording included: uploads are refused
    /// and readiness says so without failing the deployment.
    /// </summary>
    [TestMethod]
    public async Task NamingNoProviderKeepsTheFailClosedDegradedStateUnchanged()
    {
        using var factory = CreateFactory("Production", []);
        using var client = factory.CreateClient();

        Assert.IsInstanceOfType<UnavailableObjectStorage>(
            factory.Services.GetRequiredService<IObjectStorage>());
        Assert.IsInstanceOfType<UnavailableMediaScanner>(
            factory.Services.GetRequiredService<IMediaScanner>());

        var readiness = await ReadinessAsync(factory);
        Assert.AreEqual(HealthStatus.Degraded, readiness.Entries["media-storage"].Status);
        Assert.AreEqual(
            "Media object storage is unavailable, so media uploads and object access are refused.",
            readiness.Entries["media-storage"].Description);
        Assert.AreEqual(HealthStatus.Degraded, readiness.Entries["media-scanner"].Status);
        Assert.AreEqual(
            "No upload scanner is configured, so media uploads are refused.",
            readiness.Entries["media-scanner"].Description);
        Assert.AreNotEqual(
            HealthStatus.Unhealthy,
            readiness.Status,
            "One unconfigured adapter must not pull a working API out of its load balancer.");
    }

    /// <summary>
    /// A bucket that answers is healthy; the same bucket unreachable is Degraded, not Unhealthy, and
    /// says so without naming the bucket or the endpoint.
    /// </summary>
    [TestMethod]
    public async Task AConfiguredProviderIsProbedAndAnUnreachableOneIsDegradedRatherThanUnhealthy()
    {
        var bucket = new FakeS3Bucket();
        using var reachable = CreateFactory("Production", R2Settings(), services =>
        {
            services.RemoveAll<IAmazonS3>();
            services.AddSingleton<IAmazonS3>(_ => CreateFakeS3(bucket));
        });
        using var reachableClient = reachable.CreateClient();
        var healthy = await ReadinessAsync(reachable);

        Assert.AreEqual(HealthStatus.Healthy, healthy.Entries["media-storage"].Status);
        Assert.AreEqual(
            "Media object storage is configured.",
            healthy.Entries["media-storage"].Description);

        bucket.Fault = _ => FakeS3Handler.Error(System.Net.HttpStatusCode.Forbidden, "AccessDenied");
        var degraded = await ReadinessAsync(reachable);

        Assert.AreEqual(HealthStatus.Degraded, degraded.Entries["media-storage"].Status);
        Assert.AreEqual(
            "Media object storage is configured but did not respond, so media uploads and object access fail.",
            degraded.Entries["media-storage"].Description);
        Assert.AreNotEqual(HealthStatus.Unhealthy, degraded.Status);
    }

    [TestMethod]
    public async Task AConfiguredScannerThatDoesNotAnswerIsDegradedRatherThanUnhealthy()
    {
        // Port 1 on the loopback interface: reachable to try, and nothing is listening.
        using var factory = CreateFactory("Production", ClamAvSettings(port: 1));
        using var client = factory.CreateClient();

        var readiness = await ReadinessAsync(factory);

        Assert.AreEqual(HealthStatus.Degraded, readiness.Entries["media-scanner"].Status);
        Assert.AreEqual(
            "The upload scanner is configured but did not respond, so media uploads are refused.",
            readiness.Entries["media-scanner"].Description);
        Assert.AreNotEqual(HealthStatus.Unhealthy, readiness.Status);
    }

    [TestMethod]
    public async Task AReachableScannerIsHealthy()
    {
        await using var daemon = FakeClamd.StartAnswering("ClamAV 1.5.4/28115/Sun Sep  6 06:26:06 2026", "stream: OK");
        using var factory = CreateFactory("Production", ClamAvSettings(daemon.Port));
        using var client = factory.CreateClient();

        var readiness = await ReadinessAsync(factory);

        Assert.AreEqual(HealthStatus.Healthy, readiness.Entries["media-scanner"].Status);
    }

    internal static AmazonS3Client CreateFakeS3(FakeS3Bucket bucket)
    {
        var options = new R2StorageOptions
        {
            AccountId = AccountId,
            BucketName = "tb-gym-media",
            AccessKeyId = AccessKeyId,
            SecretAccessKey = SecretAccessKey,
        };
        var config = MediaProviderDependencyInjection.CreateS3Config(options);
        config.HttpClientFactory = new FakeS3HttpClientFactory(bucket);
        config.MaxErrorRetry = 0;
        return new AmazonS3Client(
            new BasicAWSCredentials(options.AccessKeyId, options.SecretAccessKey),
            config);
    }

    internal static Dictionary<string, string?> R2Settings() => new()
    {
        ["Media:StorageAdapter"] = "R2",
        ["Media:R2:AccountId"] = AccountId,
        ["Media:R2:BucketName"] = "tb-gym-media",
        ["Media:R2:AccessKeyId"] = AccessKeyId,
        ["Media:R2:SecretAccessKey"] = SecretAccessKey,
    };

    internal static Dictionary<string, string?> ClamAvSettings(int port) => new()
    {
        ["Media:ScannerAdapter"] = "ClamAv",
        ["Media:ClamAv:Host"] = "127.0.0.1",
        ["Media:ClamAv:Port"] = port.ToString(System.Globalization.CultureInfo.InvariantCulture),
        ["Media:ClamAv:ConnectTimeoutSeconds"] = "2",
        ["Media:ClamAv:ProbeTimeoutSeconds"] = "3",
        ["Media:ClamAv:ScanTimeoutSeconds"] = "15",
    };

    private static Dictionary<string, string?> Without(Dictionary<string, string?> settings, string key)
    {
        settings.Remove(key);
        return settings;
    }

    private static Dictionary<string, string?> With(
        Dictionary<string, string?> settings,
        string key,
        string value)
    {
        settings[key] = value;
        return settings;
    }

    private static Task<HealthReport> ReadinessAsync(WebApplicationFactory<Program> factory) =>
        factory.Services
            .GetRequiredService<HealthCheckService>()
            .CheckHealthAsync(registration => registration.Tags.Contains("ready"));

    private WebApplicationFactory<Program> CreateFactory(
        string environment,
        Dictionary<string, string?> providerSettings,
        Action<IServiceCollection>? configureServices = null)
    {
        var settings = new Dictionary<string, string?>
        {
            ["ConnectionStrings:Database"] = databaseConnection,
            ["Database:ApplyMigrationsOnStartup"] = "false",
            ["Seed:Enabled"] = "false",
            ["Application:PublicBaseUrl"] = "https://app.tbgym.test",
            ["Application:PublicOriginAllowlist:0"] = "https://app.tbgym.test",
            ["DataProtection:KeyPath"] = Path.Combine(Path.GetTempPath(), databaseName!, "keys"),
            ["Media:PurgeEnabled"] = "false",
            ["Notifications:Dispatch:PollIntervalSeconds"] = "300",
            ["Messaging:Realtime:Enabled"] = "false",
            ["Messaging:Realtime:ApiReplicaCount"] = "1",
            ["Messaging:Realtime:AllowedOrigins:0"] = "https://app.tbgym.test",
        };
        foreach (var (key, value) in providerSettings)
        {
            settings[key] = value;
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
            if (configureServices is not null)
            {
                builder.ConfigureServices(configureServices);
            }
        });
    }
}
