using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Npgsql;
using TB.Gym.Modules.Media;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The reconciliation settings a deployment is allowed to compose.
/// </summary>
/// <remarks>
/// A budget of zero owner probes reads like "do less of the pass" and is in fact "never finish one":
/// the owner half can never reach its completed stage, so the run can never be Completed, so a day
/// later it is abandoned and the next one repeats it. Nothing about that is visible in a log or a
/// metric — the location simply never gets a clean bill of health — which is why it is refused at
/// startup rather than left as a configuration somebody could believe was working.
/// </remarks>
[TestClass]
public sealed class Phase6B4CReconciliationStartupTests
{
    private string? adminConnection;
    private string? databaseName;
    private string? databaseConnection;

    [TestInitialize]
    public async Task InitializeAsync()
    {
        adminConnection = PostgreSqlTestEnvironment.RequireAdminConnection();
        databaseName = await PostgreSqlTestEnvironment.CreateDatabaseAsync("tbgym_p6b4c_startup");
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
    public void AnEnabledPassWithNoOwnerProbeBudgetRefusesStartup()
    {
        using var factory = CreateFactory(enabled: true, ownerProbesPerRun: 0);

        var failure = Assert.ThrowsExactly<OptionsValidationException>(() => factory.CreateClient());

        Assert.Contains("OwnerProbesPerRun", failure.Message, StringComparison.Ordinal);
        Assert.Contains("Media:Reconciliation:Enabled", failure.Message, StringComparison.Ordinal);
    }

    [TestMethod]
    public void ASwitchedOffPassMaySayZeroBecauseNothingIsWaitingToComplete()
    {
        using var factory = CreateFactory(enabled: false, ownerProbesPerRun: 0);
        using var client = factory.CreateClient();

        var options = factory.Services
            .GetRequiredService<IOptions<MediaStorageOptions>>()
            .Value
            .Reconciliation;
        Assert.IsFalse(options.Enabled);
        Assert.AreEqual(0, options.OwnerProbesPerRun);
    }

    [TestMethod]
    public void TheDefaultsAreAComposableDeployment()
    {
        using var factory = CreateFactory(enabled: true, ownerProbesPerRun: null);
        using var client = factory.CreateClient();

        var options = factory.Services
            .GetRequiredService<IOptions<MediaStorageOptions>>()
            .Value
            .Reconciliation;
        Assert.IsGreaterThanOrEqualTo(1, options.OwnerProbesPerRun);
        Assert.IsGreaterThanOrEqualTo(1, options.ObjectsPerRun);
    }

    private WebApplicationFactory<Program> CreateFactory(bool enabled, int? ownerProbesPerRun)
    {
        var settings = new Dictionary<string, string?>
        {
            ["ConnectionStrings:Database"] = databaseConnection,
            ["Database:ApplyMigrationsOnStartup"] = "false",
            ["Seed:Enabled"] = "false",
            ["Application:PublicBaseUrl"] = "http://localhost:4200",
            ["DataProtection:KeyPath"] = Path.Combine(Path.GetTempPath(), databaseName!, "keys"),
            ["Media:StorageRoot"] = Path.Combine(Path.GetTempPath(), databaseName!, "media"),
            ["Media:PurgeEnabled"] = "false",
            ["Media:Reconciliation:Enabled"] = enabled ? "true" : "false",
            ["Notifications:Dispatch:PollIntervalSeconds"] = "300",
            ["Messaging:Realtime:Enabled"] = "false",
            ["Messaging:Realtime:ApiReplicaCount"] = "1",
            ["Messaging:Realtime:AllowedOrigins:0"] = "http://localhost:4200",
        };
        if (ownerProbesPerRun is { } probes)
        {
            settings["Media:Reconciliation:OwnerProbesPerRun"] =
                probes.ToString(System.Globalization.CultureInfo.InvariantCulture);
        }

        return new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Development");
            foreach (var (key, value) in settings)
            {
                builder.UseSetting(key, value);
            }

            builder.ConfigureAppConfiguration((_, configuration) =>
                configuration.AddInMemoryCollection(settings));
        });
    }
}
