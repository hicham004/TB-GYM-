using System.Net;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Npgsql;
using TB.Gym.Infrastructure;
using TB.Gym.Modules.Notifications;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// What a real host does at startup with each email configuration.
/// </summary>
/// <remarks>
/// A deployment that believes it is emailing people while the messages go into a process's memory is
/// the failure this validation exists for: it looks like working software right up until somebody
/// asks why a client never received a payment reminder. Refusing to start is the only honest
/// response, and this is where that is asserted against a real host rather than against the options
/// object alone.
/// </remarks>
[TestClass]
public sealed class Phase6B3ANotificationEmailStartupTests
{
    private string? adminConnection;
    private string? databaseName;
    private string? databaseConnection;

    [TestInitialize]
    public async Task InitializeAsync()
    {
        adminConnection = PostgreSqlTestEnvironment.RequireAdminConnection();
        databaseName = await PostgreSqlTestEnvironment.CreateDatabaseAsync("tbgym_p6b3_email");
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

    /// <summary>The shipped default: email off, no adapter, and a host that starts and serves.</summary>
    [TestMethod]
    public async Task TheProductionDefaultIsEmailDisabledAndStartsCleanly()
    {
        using var factory = CreateFactory([], environment: "Production");

        using var client = factory.CreateClient();
        var response = await client.GetAsync("/api/system/status");

        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        // Composition contains no transport at all rather than a disabled one somebody could resolve.
        Assert.IsNull(
            factory.Services.GetService<INotificationEmailTransport>(),
            "Production must compose no email transport while no real provider exists.");
    }

    /// <summary>
    /// The captured adapter is a development and test adapter. Production refuses it outright, whether
    /// or not email is switched on, so a configuration mistake cannot become silent non-delivery.
    /// </summary>
    [TestMethod]
    public void ProductionRefusesTheCapturedAdapterEvenWhenEmailIsDisabled()
    {
        using var factory = CreateFactory(
            new Dictionary<string, string?>
            {
                ["Notifications:Email:Enabled"] = "false",
                ["Notifications:Email:Adapter"] = "Captured",
            },
            environment: "Production");

        var failure = Assert.ThrowsExactly<OptionsValidationException>(() => factory.CreateClient());

        Assert.Contains("cannot be 'Captured' in Production", string.Join(" ", failure.Failures));
    }

    /// <summary>
    /// There is no production email provider in this phase, so there is nothing honest for an enabled
    /// channel to mean in Production.
    /// </summary>
    [TestMethod]
    public void ProductionRefusesAnEnabledEmailChannel()
    {
        using var factory = CreateFactory(
            new Dictionary<string, string?>
            {
                ["Notifications:Email:Enabled"] = "true",
                ["Notifications:Email:Adapter"] = "None",
            },
            environment: "Production");

        var failure = Assert.ThrowsExactly<OptionsValidationException>(() => factory.CreateClient());

        Assert.Contains("until a real email provider is configured", string.Join(" ", failure.Failures));
    }

    /// <summary>Enabling a channel that has nothing behind it is a configuration error, not a no-op.</summary>
    [TestMethod]
    public void AnEnabledChannelWithNoAdapterRefusesToStart()
    {
        using var factory = CreateFactory(new Dictionary<string, string?>
        {
            ["Notifications:Email:Enabled"] = "true",
            ["Notifications:Email:Adapter"] = "None",
        });

        var failure = Assert.ThrowsExactly<OptionsValidationException>(() => factory.CreateClient());

        Assert.Contains("requires a configured email adapter", string.Join(" ", failure.Failures));
    }

    /// <summary>
    /// An adapter name this build does not implement fails startup rather than being read as "none",
    /// so a half-finished provider rollout cannot look like a working one.
    /// </summary>
    [TestMethod]
    public void AnUnknownAdapterRefusesToStart()
    {
        using var factory = CreateFactory(new Dictionary<string, string?>
        {
            ["Notifications:Email:Enabled"] = "true",
            ["Notifications:Email:Adapter"] = "Resend",
        });

        var failure = Assert.ThrowsExactly<OptionsValidationException>(() => factory.CreateClient());

        Assert.Contains("must be 'None' or 'Captured'", string.Join(" ", failure.Failures));
    }

    /// <summary>Development with the captured adapter starts, and composes exactly that adapter.</summary>
    [TestMethod]
    public async Task DevelopmentWithTheCapturedAdapterStartsAndComposesIt()
    {
        using var factory = CreateFactory(new Dictionary<string, string?>
        {
            ["Notifications:Email:Enabled"] = "true",
            ["Notifications:Email:Adapter"] = "Captured",
        });

        using var client = factory.CreateClient();
        Assert.AreEqual(HttpStatusCode.OK, (await client.GetAsync("/api/system/status")).StatusCode);

        var transport = factory.Services.GetRequiredService<INotificationEmailTransport>();
        Assert.AreEqual(NotificationEmailAdapters.CapturedAdapterName, transport.AdapterName);
    }

    /// <summary>
    /// The Worker is the process that actually sends, so its composition refuses the same
    /// configurations for the same reasons.
    /// </summary>
    [TestMethod]
    public void TheWorkerCompositionRefusesTheSameProductionConfigurations()
    {
        foreach (var (enabled, adapter) in new[]
                 {
                     ("false", "Captured"),
                     ("true", "None"),
                     ("true", "Captured"),
                 })
        {
            var configuration = new ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["ConnectionStrings:Database"] = databaseConnection,
                    ["Notifications:Email:Enabled"] = enabled,
                    ["Notifications:Email:Adapter"] = adapter,
                })
                .Build();

            var services = new ServiceCollection();
            services.AddTbGymNotificationWorkerInfrastructure(configuration, isProduction: true);
            using var provider = services.BuildServiceProvider(validateScopes: true);

            Assert.ThrowsExactly<OptionsValidationException>(
                () => provider.GetRequiredService<IOptions<NotificationEmailOptions>>().Value,
                $"The Worker accepted Enabled={enabled}, Adapter={adapter} in Production.");
        }
    }

    private WebApplicationFactory<Program> CreateFactory(
        Dictionary<string, string?> email,
        string environment = "Development")
    {
        var settings = new Dictionary<string, string?>(email)
        {
            ["ConnectionStrings:Database"] = databaseConnection,
            ["Database:ApplyMigrationsOnStartup"] = "false",
            ["Seed:Enabled"] = "false",
            ["Application:PublicBaseUrl"] = "http://localhost:4200",
            ["Media:StorageRoot"] = Path.Combine(Path.GetTempPath(), databaseName!, "media"),
            ["Media:PurgeEnabled"] = "false",
            ["Notifications:Dispatch:PollIntervalSeconds"] = "300",
            ["Messaging:Realtime:Enabled"] = "false",
            ["Messaging:Realtime:ApiReplicaCount"] = "1",
            ["Messaging:Realtime:AllowedOrigins:0"] = "http://localhost:4200",
        };

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
