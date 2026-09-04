using System.Net;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Npgsql;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// What the API does at startup with each realtime topology.
/// </summary>
/// <remarks>
/// A deployment that declares several replicas without a backplane is the failure this validation
/// exists for: every frame reaches only the replica that published it, which looks like working
/// software until somebody's client never sees a reply. Failing to start is the only honest response,
/// and this is where that is asserted against a real host rather than against the options object.
/// </remarks>
[TestClass]
public sealed class Phase6B2BRealtimeStartupTests
{
    private string? adminConnection;
    private string? databaseName;
    private string? databaseConnection;

    [TestInitialize]
    public async Task InitializeAsync()
    {
        adminConnection = PostgreSqlTestEnvironment.RequireAdminConnection();
        databaseName = await PostgreSqlTestEnvironment.CreateDatabaseAsync("tbgym_p6b2b_start");
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

        var mediaRoot = Path.Combine(Path.GetTempPath(), databaseName);
        if (Directory.Exists(mediaRoot))
        {
            Directory.Delete(mediaRoot, recursive: true);
        }

        await using var connection = new NpgsqlConnection(adminConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = $"DROP DATABASE IF EXISTS \"{databaseName}\" WITH (FORCE)";
        await command.ExecuteNonQueryAsync();
    }

    [TestMethod]
    public async Task ASingleReplicaWithoutABackplaneStartsAndServesRest()
    {
        using var factory = CreateFactory(new Dictionary<string, string?>
        {
            ["Messaging:Realtime:ApiReplicaCount"] = "1",
            ["Messaging:Realtime:ScaleOut"] = "SingleProcess",
        });

        using var client = factory.CreateClient();
        var response = await client.GetAsync("/api/system/status");

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
    }

    [TestMethod]
    public void SeveralDeclaredReplicasWithoutABackplaneRefuseToStart()
    {
        using var factory = CreateFactory(new Dictionary<string, string?>
        {
            ["Messaging:Realtime:ApiReplicaCount"] = "3",
            ["Messaging:Realtime:ScaleOut"] = "SingleProcess",
        });

        var failure = Assert.ThrowsExactly<InvalidOperationException>(() => factory.CreateClient());

        Assert.Contains(
            "ScaleOut must be Redis",
            failure.Message,
            "The message has to say what to change, and must never name the backplane endpoint.");
    }

    [TestMethod]
    public void RedisScaleOutWithoutAnEndpointRefusesToStart()
    {
        using var factory = CreateFactory(new Dictionary<string, string?>
        {
            ["Messaging:Realtime:ApiReplicaCount"] = "2",
            ["Messaging:Realtime:ScaleOut"] = "Redis",
        });

        var failure = Assert.ThrowsExactly<InvalidOperationException>(() => factory.CreateClient());

        Assert.Contains("RedisConnectionString is required", failure.Message);
    }

    [TestMethod]
    public void AnUnknownScaleOutModeRefusesToStart()
    {
        using var factory = CreateFactory(new Dictionary<string, string?>
        {
            ["Messaging:Realtime:ScaleOut"] = "Kafka",
        });

        Assert.ThrowsExactly<InvalidOperationException>(() => factory.CreateClient());
    }

    /// <summary>
    /// Outside Development, an unconfigured hub origin list is a refusal to start rather than an
    /// allowlist that lets any site open an authenticated socket.
    /// </summary>
    [TestMethod]
    public void ProductionWithoutAnAllowedHubOriginRefusesToStart()
    {
        using var factory = CreateFactory(
            new Dictionary<string, string?>
            {
                ["Messaging:Realtime:ApiReplicaCount"] = "1",
            },
            environment: "Production",
            includeDefaultOrigin: false);

        var failure = Assert.ThrowsExactly<InvalidOperationException>(() => factory.CreateClient());

        Assert.Contains("AllowedOrigins", failure.Message);
        Assert.Contains("not protected by CORS", failure.Message);
    }

    /// <summary>
    /// Disabling dispatch leaves REST healthy and says so once, safely.
    /// </summary>
    [TestMethod]
    public async Task DisablingRealtimeDispatchLeavesTheApiHealthyAndLogsOneSafeLine()
    {
        var log = new CapturedStartupLog();
        using var factory = CreateFactory(
            new Dictionary<string, string?>
            {
                ["Messaging:Realtime:Enabled"] = "false",
            },
            configureServices: services => services.AddSingleton<ILoggerProvider>(log));

        using var client = factory.CreateClient();
        var response = await client.GetAsync("/api/system/status");
        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);

        // The hosted service runs on a background thread, so give it a bounded window to say so.
        var deadline = DateTimeOffset.UtcNow.AddSeconds(10);
        while (DateTimeOffset.UtcNow < deadline &&
               !log.Text.Contains("Realtime messaging dispatch is disabled", StringComparison.Ordinal))
        {
            await Task.Delay(50);
        }

        Assert.Contains(
            "Realtime messaging dispatch is disabled by configuration.",
            log.Text,
            "A disabled dispatcher says so once, and says that messages are still persisted.");
        Assert.Contains("clients reconcile through catch-up", log.Text);
    }

    /// <summary>
    /// The topology line an operator reads, and what it must never contain.
    /// </summary>
    [TestMethod]
    public async Task TheStartupTopologyLineNamesTheModeAndNeverTheBackplaneEndpoint()
    {
        const string endpoint = "redis-host.internal:6379,password=hunter2";
        var log = new CapturedStartupLog();
        using var factory = CreateFactory(
            new Dictionary<string, string?>
            {
                ["Messaging:Realtime:ApiReplicaCount"] = "2",
                ["Messaging:Realtime:ScaleOut"] = "Redis",
                ["Messaging:Realtime:RedisConnectionString"] = endpoint,
                // Nothing may actually try to reach it, so the sweep is off.
                ["Messaging:Realtime:Enabled"] = "false",
            },
            configureServices: services => services.AddSingleton<ILoggerProvider>(log));

        using var client = factory.CreateClient();
        Assert.AreEqual(HttpStatusCode.OK, (await client.GetAsync("/api/system/status")).StatusCode);

        Assert.Contains("Realtime messaging is configured for Redis", log.Text);
        Assert.Contains("2 declared API replicas", log.Text);
        Assert.DoesNotContain(endpoint, log.Text, "A backplane credential in a log is a credential in a log.");
        Assert.DoesNotContain("hunter2", log.Text);
        Assert.DoesNotContain("redis-host.internal", log.Text);
    }

    private WebApplicationFactory<Program> CreateFactory(
        Dictionary<string, string?> realtime,
        string environment = "Development",
        bool includeDefaultOrigin = true,
        Action<IServiceCollection>? configureServices = null)
    {
        var settings = new Dictionary<string, string?>(realtime)
        {
            ["ConnectionStrings:Database"] = databaseConnection,
            ["Database:ApplyMigrationsOnStartup"] = "false",
            ["Seed:Enabled"] = "false",
            ["Application:PublicBaseUrl"] = "http://localhost:4200",
            ["Media:StorageRoot"] = Path.Combine(Path.GetTempPath(), databaseName!, "media"),
            ["Media:PurgeEnabled"] = "false",
            ["Notifications:Dispatch:PollIntervalSeconds"] = "300",
            ["Messaging:Realtime:PollIntervalSeconds"] = "300",
        };
        if (includeDefaultOrigin)
        {
            settings["Messaging:Realtime:AllowedOrigins:0"] = "http://localhost:4200";
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

    private sealed class CapturedStartupLog : ILoggerProvider
    {
        private readonly System.Collections.Concurrent.ConcurrentQueue<string> messages = new();

        public string Text => string.Join(Environment.NewLine, messages);

        public ILogger CreateLogger(string categoryName) => new QueueLogger(messages);

        public void Dispose()
        {
        }

        private sealed class QueueLogger(System.Collections.Concurrent.ConcurrentQueue<string> messages) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

            public bool IsEnabled(LogLevel logLevel) => true;

            public void Log<TState>(
                LogLevel logLevel,
                EventId eventId,
                TState state,
                Exception? exception,
                Func<TState, Exception?, string> formatter) =>
                messages.Enqueue(formatter(state, exception));
        }
    }
}
