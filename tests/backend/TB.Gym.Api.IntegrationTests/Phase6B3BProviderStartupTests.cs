using System.Net;
using System.Security.Cryptography;
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
/// What a real host does at startup with each provider configuration.
/// </summary>
/// <remarks>
/// Asserted against a real host rather than against the options object alone, because the object's
/// rules are only worth anything if composition actually enforces them — and because the two
/// composition roots are separate code paths that have to agree. A deployment that starts with half a
/// provider configured is the failure this exists to prevent: it looks like working software right up
/// until somebody asks why a client never received a payment reminder, or why a bounce never stopped
/// anything.
/// </remarks>
[TestClass]
public sealed class Phase6B3BProviderStartupTests
{
    private static readonly string SigningSecret =
        NotificationWebhookSignature.SecretPrefix + Convert.ToBase64String(RandomNumberGenerator.GetBytes(24));

    private static readonly string FingerprintKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));

    private string? adminConnection;
    private string? databaseName;
    private string? databaseConnection;

    [TestInitialize]
    public async Task InitializeAsync()
    {
        adminConnection = PostgreSqlTestEnvironment.RequireAdminConnection();
        databaseName = await PostgreSqlTestEnvironment.CreateDatabaseAsync("tbgym_p6b3b_start");
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

    /// <summary>
    /// A completely configured provider starts in Production and composes the provider adapter — and
    /// nothing else. This is the configuration an operator is expected to deploy.
    /// </summary>
    [TestMethod]
    public async Task ProductionStartsWithACompletelyConfiguredProvider()
    {
        using var factory = CreateFactory(Provider(), environment: "Production");

        using var client = factory.CreateClient();
        Assert.AreEqual(HttpStatusCode.OK, (await client.GetAsync("/api/system/status")).StatusCode);

        var transport = factory.Services.GetRequiredService<INotificationEmailTransport>();
        Assert.AreEqual(NotificationEmailAdapters.ResendAdapterName, transport.AdapterName);
        Assert.IsTrue(transport.ContactsProvider);
    }

    /// <summary>
    /// Every secret the provider adapter needs, missing one at a time. Each refuses startup, in
    /// Production and outside it: a half-configured provider that one flag flip would activate is the
    /// failure this validation exists for, and "the channel is switched off" is not an excuse for
    /// carrying a configuration that cannot work.
    /// </summary>
    [TestMethod]
    public void ProductionRefusesEveryMissingProviderSecret()
    {
        foreach (var (setting, expected) in new[]
                 {
                     ("Notifications:Email:Provider:ApiKey", "Provider:ApiKey is required"),
                     ("Notifications:Email:Provider:FromAddress", "Provider:FromAddress must be"),
                     ("Notifications:Email:Provider:WebhookSigningSecret", "Provider:WebhookSigningSecret"),
                     ("Notifications:Email:Provider:FingerprintKeyId", "Provider:FingerprintKeyId must be"),
                 })
        {
            var settings = Provider();
            settings[setting] = string.Empty;

            using var factory = CreateFactory(settings, environment: "Production");
            var failure = Assert.ThrowsExactly<OptionsValidationException>(
                () => factory.CreateClient(),
                $"Production accepted a provider with no {setting}.");
            Assert.Contains(expected, string.Join(" ", failure.Failures));
        }

        // An active key id that names no configured key is a rotation somebody half-finished.
        var orphaned = Provider();
        orphaned.Remove($"Notifications:Email:Provider:FingerprintKeys:{ActiveKeyId}");
        using var orphanedFactory = CreateFactory(orphaned, environment: "Production");
        Assert.Contains(
            "must contain the key named by FingerprintKeyId",
            string.Join(" ", Assert.ThrowsExactly<OptionsValidationException>(
                () => orphanedFactory.CreateClient()).Failures));
    }

    /// <summary>
    /// An endpoint is where an API key and a recipient address are sent. A deployment that can point
    /// it anywhere by configuration has a credential-exfiltration switch, so Production accepts only
    /// HTTPS on the provider's own host.
    /// </summary>
    [TestMethod]
    public void ProductionRefusesAnInsecureOrUnapprovedEndpoint()
    {
        foreach (var endpoint in new[]
                 {
                     "http://api.resend.com/emails",
                     "http://127.0.0.1:5099/emails",
                     "https://api.resend.com.attacker.test/emails",
                     "https://collector.attacker.test/emails",
                     "not-a-url",
                 })
        {
            var settings = Provider();
            settings["Notifications:Email:Provider:Endpoint"] = endpoint;

            using var factory = CreateFactory(settings, environment: "Production");
            var failure = Assert.ThrowsExactly<OptionsValidationException>(
                () => factory.CreateClient(),
                $"Production accepted the endpoint '{endpoint}'.");
            Assert.Contains("Provider:Endpoint must be", string.Join(" ", failure.Failures));
        }
    }

    /// <summary>
    /// The captured development adapter beside provider secrets is a contradiction, and so is a
    /// webhook secret with no provider. Neither half can be assumed to be the intended one, so
    /// neither is guessed at.
    /// </summary>
    [TestMethod]
    public void ContradictoryConfigurationRefusesToStart()
    {
        var capturedWithSecrets = Provider();
        capturedWithSecrets["Notifications:Email:Adapter"] = NotificationEmailAdapters.Captured;
        using var capturedFactory = CreateFactory(capturedWithSecrets);
        Assert.Contains(
            "which contacts no provider",
            string.Join(" ", Assert.ThrowsExactly<OptionsValidationException>(
                () => capturedFactory.CreateClient()).Failures));

        using var webhookOnly = CreateFactory(
            new Dictionary<string, string?>
            {
                ["Notifications:Email:Provider:WebhookSigningSecret"] = SigningSecret,
            },
            environment: "Production");
        Assert.Contains(
            "which contacts no provider",
            string.Join(" ", Assert.ThrowsExactly<OptionsValidationException>(
                () => webhookOnly.CreateClient()).Failures));
    }

    /// <summary>
    /// The provider forgets an idempotency key after a bounded window, so a retry schedule longer than
    /// that window would present a key it no longer remembers — and the "duplicate" it was meant to
    /// collapse would become a second real message in somebody's inbox.
    /// </summary>
    /// <remarks>
    /// The two settings live in different configuration sections, which is exactly why this is checked
    /// at startup: nothing else would notice that raising the attempt budget had quietly crossed the
    /// provider's retention window.
    /// </remarks>
    [TestMethod]
    public void ARetryScheduleLongerThanTheProviderRetentionWindowRefusesToStart()
    {
        var tooMany = Provider();
        tooMany["Notifications:Dispatch:MaximumAttempts"] = "9";

        using var factory = CreateFactory(tooMany, environment: "Production");
        var failure = Assert.ThrowsExactly<OptionsValidationException>(() => factory.CreateClient());
        Assert.Contains("provider idempotency retention window", string.Join(" ", failure.Failures));

        // Eight attempts still fit inside the documented 24 hours, so the bound is a real one rather
        // than a blanket refusal to configure anything.
        var acceptable = Provider();
        acceptable["Notifications:Dispatch:MaximumAttempts"] = "8";
        using var accepted = CreateFactory(acceptable, environment: "Production");
        Assert.IsNotNull(accepted.Services.GetRequiredService<IOptions<NotificationEmailOptions>>().Value);
    }

    /// <summary>
    /// The webhook route exists only where a provider does. A deployment with no provider answers as
    /// though the route were not there, so a scan cannot learn which deployments send real mail.
    /// </summary>
    [TestMethod]
    public async Task TheWebhookRouteIsAbsentWithoutAConfiguredProvider()
    {
        using var factory = CreateFactory([], environment: "Production");
        using var client = factory.CreateClient();

        using var content = new StringContent("{}");
        var response = await client.PostAsync("/api/notifications/email/provider-events", content);

        Assert.AreEqual(HttpStatusCode.NotFound, response.StatusCode);
    }

    /// <summary>
    /// The Worker is the process that actually sends, so its composition refuses the same
    /// configurations for the same reasons — and accepts the same complete one.
    /// </summary>
    [TestMethod]
    public void TheWorkerCompositionEnforcesTheSameProviderRules()
    {
        foreach (var broken in new[]
                 {
                     Without("Notifications:Email:Provider:ApiKey"),
                     Without("Notifications:Email:Provider:WebhookSigningSecret"),
                     Without("Notifications:Email:Provider:FingerprintKeyId"),
                     WithEndpoint("http://127.0.0.1:5099/emails"),
                     WithEndpoint("https://collector.attacker.test/emails"),
                 })
        {
            using var provider = BuildWorker(broken, isProduction: true);
            Assert.ThrowsExactly<OptionsValidationException>(
                () => provider.GetRequiredService<IOptions<NotificationEmailOptions>>().Value,
                "The Worker accepted a provider configuration the API refuses.");
        }

        using var healthy = BuildWorker(Provider(), isProduction: true);
        var options = healthy.GetRequiredService<IOptions<NotificationEmailOptions>>().Value;
        Assert.IsTrue(options.UsesProviderAdapter);
        Assert.IsTrue(options.IsAvailable);
        Assert.AreEqual(
            NotificationEmailAdapters.ResendAdapterName,
            healthy.GetRequiredService<INotificationEmailTransport>().AdapterName);

        return;

        static Dictionary<string, string?> Without(string setting)
        {
            var settings = Provider();
            settings[setting] = string.Empty;
            return settings;
        }

        static Dictionary<string, string?> WithEndpoint(string endpoint)
        {
            var settings = Provider();
            settings["Notifications:Email:Provider:Endpoint"] = endpoint;
            return settings;
        }
    }

    private const string ActiveKeyId = "startup-active";

    /// <summary>The complete, valid production provider configuration each test then breaks one part of.</summary>
    private static Dictionary<string, string?> Provider() => new()
    {
        ["Notifications:Email:Enabled"] = "true",
        ["Notifications:Email:Adapter"] = NotificationEmailAdapters.Resend,
        ["Notifications:Email:Provider:Endpoint"] = NotificationEmailProviderEndpoints.ResendSend,
        ["Notifications:Email:Provider:ApiKey"] = "re_startup_test_key",
        ["Notifications:Email:Provider:FromAddress"] = "TB Gym <notifications@mail.tbgym.test>",
        ["Notifications:Email:Provider:WebhookSigningSecret"] = SigningSecret,
        ["Notifications:Email:Provider:FingerprintKeyId"] = ActiveKeyId,
        [$"Notifications:Email:Provider:FingerprintKeys:{ActiveKeyId}"] = FingerprintKey,
    };

    private ServiceProvider BuildWorker(Dictionary<string, string?> email, bool isProduction)
    {
        var settings = new Dictionary<string, string?>(email)
        {
            ["ConnectionStrings:Database"] = databaseConnection,
        };
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(settings).Build();
        var services = new ServiceCollection();
        services.AddTbGymNotificationWorkerInfrastructure(configuration, isProduction);
        return services.BuildServiceProvider(validateScopes: true);
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
