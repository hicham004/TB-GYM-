using System.Net;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Npgsql;
using TB.Gym.Infrastructure.Security;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Whose word this deployment takes for a request's client address and scheme.
/// </summary>
/// <remarks>
/// These run against a real socket rather than <c>TestServer</c>, and they have to. The forwarded
/// headers middleware compares the connection's remote address against the trusted set, and
/// <c>TestServer</c> has no remote address at all — it passes null, which the middleware treats as
/// "a server that cannot report one" and applies the header anyway. A test on <c>TestServer</c>
/// would therefore pass whether the trusted set were configured, empty, or wrong.
/// <para>
/// The framework's own defaults were measured rather than assumed: on this runtime they are
/// <c>KnownProxies = [::1]</c> and <c>KnownIPNetworks = [127.0.0.0/8]</c>. Loopback is therefore
/// trusted before this configuration adds anything, which is why the untrusted case below drives the
/// real middleware with a remote address a loopback socket cannot present. Asserting it over a
/// listener would assert the default, not the configuration.
/// </para>
/// </remarks>
[TestClass]
public sealed class ReverseProxyForwardedHeaderTests
{
    private const string ProbePath = "/probe";
    private const string ForwardedClient = "198.51.100.10";
    private const string SecondForwardedClient = "198.51.100.11";
    private const string SomeOtherProxy = "203.0.113.10";
    private const string UntrustedCaller = "203.0.113.200";

    private readonly List<HttpClient> clients = [];
    private WebApplication? probe;
    private string? adminConnection;
    private string? databaseName;
    private string? databaseConnection;

    [TestCleanup]
    public async Task CleanupAsync()
    {
        foreach (var client in clients)
        {
            client.Dispose();
        }

        clients.Clear();

        if (probe is not null)
        {
            await probe.StopAsync();
            await probe.DisposeAsync();
            probe = null;
        }

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
    public async Task SpoofedForwardedHeadersFromAnUntrustedSourceAreIgnored()
    {
        // Forwarding is on and an edge is named, but this request comes from somewhere else
        // entirely: a caller on the public internet reaching the API directly, claiming to be a
        // proxy and claiming a client address. Everything it claims must be discarded.
        var options = new ReverseProxyOptions
        {
            Enabled = true,
            TrustedProxies = { SomeOtherProxy },
        };
        Assert.IsNull(options.Validate());

        var context = await ForwardAsync(options, connectingFrom: UntrustedCaller);

        Assert.AreEqual(
            UntrustedCaller,
            context.Connection.RemoteIpAddress?.ToString(),
            "An untrusted caller rewrote its own address.");
        Assert.AreEqual("http", context.Request.Scheme, "An untrusted caller rewrote the request scheme.");
    }

    [TestMethod]
    public async Task TheSameHeadersFromTheConfiguredProxyAddressAreHonoured()
    {
        // The mirror of the test above, differing only in where the connection came from. Together
        // they say the decision is made by the source address and by nothing in the request.
        var options = new ReverseProxyOptions
        {
            Enabled = true,
            TrustedProxies = { SomeOtherProxy },
        };
        Assert.IsNull(options.Validate());

        var context = await ForwardAsync(options, connectingFrom: SomeOtherProxy);

        Assert.AreEqual(ForwardedClient, context.Connection.RemoteIpAddress?.ToString());
        Assert.AreEqual("https", context.Request.Scheme);
    }

    [TestMethod]
    public async Task ForwardedHeadersFromAConfiguredTrustedProxyUpdateTheClientAddressAndScheme()
    {
        var client = await StartProbeAsync(new Dictionary<string, string?>
        {
            ["ReverseProxy:Enabled"] = "true",
            ["ReverseProxy:TrustedProxies:0"] = "127.0.0.1",
        });

        var observed = await ProbeAsync(client, ForwardedClient, "https");

        Assert.AreEqual(ForwardedClient, observed.RemoteIp);
        Assert.AreEqual("https", observed.Scheme);
    }

    [TestMethod]
    public async Task ATrustedNetworkCoversAProxyWhoseAddressIsNotFixed()
    {
        var client = await StartProbeAsync(new Dictionary<string, string?>
        {
            ["ReverseProxy:Enabled"] = "true",
            ["ReverseProxy:TrustedNetworks:0"] = "127.0.0.0/8",
        });

        var observed = await ProbeAsync(client, ForwardedClient, "https");

        Assert.AreEqual(ForwardedClient, observed.RemoteIp);
        Assert.AreEqual("https", observed.Scheme);
    }

    [TestMethod]
    public async Task DisabledForwardingIgnoresTheHeadersEvenFromAnAddressThatIsConfiguredAsTrusted()
    {
        // The edge is named and would be trusted; the explicit choice not to forward is what decides.
        // This is the direct, non-proxy deployment, and it must see the request that reached it.
        var client = await StartProbeAsync(new Dictionary<string, string?>
        {
            ["ReverseProxy:Enabled"] = "false",
            ["ReverseProxy:TrustedProxies:0"] = "127.0.0.1",
        });

        var observed = await ProbeAsync(client, ForwardedClient, "https");

        Assert.AreEqual("127.0.0.1", observed.RemoteIp);
        Assert.AreEqual("http", observed.Scheme);
    }

    [TestMethod]
    public void EnabledWithoutAnyTrustedProxyOrNetworkIsRefused()
    {
        var options = new ReverseProxyOptions { Enabled = true };

        var failure = options.Validate();

        Assert.IsNotNull(failure, "Forwarding was enabled with no edge named and the configuration was accepted.");
        StringAssert.Contains(failure, "no ReverseProxy:TrustedProxies");
    }

    [TestMethod]
    public void AnEnabledDeploymentWhoseEntriesAreAllUnsetIsStillRefused()
    {
        // A deployment template always passes its variables, so an unset one arrives as an empty
        // entry. Empty is absent rather than malformed — and absent is not permission.
        var options = new ReverseProxyOptions
        {
            Enabled = true,
            TrustedProxies = { "" },
            TrustedNetworks = { "   " },
        };

        var failure = options.Validate();

        Assert.IsNotNull(failure, "An enabled deployment with nothing but empty entries was accepted.");
        StringAssert.Contains(failure, "Forwarded headers would be accepted from nobody");
        Assert.IsEmpty(options.ResolvedProxies);
        Assert.IsEmpty(options.ResolvedNetworks);
    }

    [TestMethod]
    public void AZeroLengthPrefixIsRefusedBecauseItTrustsEveryCaller()
    {
        foreach (var everyone in new[] { "0.0.0.0/0", "::/0" })
        {
            var options = new ReverseProxyOptions
            {
                Enabled = true,
                TrustedNetworks = { everyone },
            };

            var failure = options.Validate();

            Assert.IsNotNull(failure, $"{everyone} was accepted as a trusted proxy network.");
            StringAssert.Contains(failure, "zero-length prefix");
        }
    }

    [TestMethod]
    public void AMalformedEntryIsRefusedEvenWhileForwardingIsDisabled()
    {
        // A typo is a mistake in either state. Finding it only on the day the flag is turned on is
        // finding it during an incident.
        var proxies = new ReverseProxyOptions { Enabled = false, TrustedProxies = { "10.0.0.256" } };
        var networks = new ReverseProxyOptions { Enabled = false, TrustedNetworks = { "10.0.0.0/33" } };
        var unspecified = new ReverseProxyOptions { Enabled = true, TrustedProxies = { "0.0.0.0" } };

        StringAssert.Contains(proxies.Validate(), "is not an IP address");
        StringAssert.Contains(networks.Validate(), "is not CIDR notation");
        StringAssert.Contains(unspecified.Validate(), "unspecified address");
    }

    [TestMethod]
    public async Task TheApiRefusesToStartWhenForwardingIsEnabledWithoutATrustedEdge()
    {
        await PrepareDatabaseNameAsync("tbgym_proxy_startup");
        using var factory = CreateApiFactory(new Dictionary<string, string?>
        {
            ["ReverseProxy:Enabled"] = "true",
        });

        var failure = Assert.ThrowsExactly<OptionsValidationException>(() => factory.CreateClient());

        StringAssert.Contains(
            string.Join(" ", failure.Failures),
            "Forwarded headers would be accepted from nobody");
    }

    [TestMethod]
    public async Task ThePublicAuthenticationLimiterSeparatesTwoForwardedClientsBehindATrustedProxy()
    {
        // The defect this fixes, stated as a test: with the edge untrusted every caller shares one
        // partition, so one client's traffic exhausts the sign-in allowance for everybody. The
        // limiter is 30 requests a minute, so 30 succeed, the 31st from the same forwarded client is
        // refused, and a different forwarded client behind the same proxy is unaffected.
        await PrepareDatabaseNameAsync("tbgym_proxy_limit");
        MigrateDatabase();

        await using var api = new KestrelApiFactory(builder => ConfigureApi(
            builder,
            new Dictionary<string, string?>
            {
                ["ReverseProxy:Enabled"] = "true",
                ["ReverseProxy:TrustedProxies:0"] = "127.0.0.1",
            }));
        _ = api.Services;

        var client = NewClient(api.ServerAddress);
        for (var attempt = 1; attempt <= 30; attempt++)
        {
            var allowed = await InvitationLookupAsync(client, ForwardedClient);
            Assert.AreNotEqual(
                HttpStatusCode429,
                (int)allowed.StatusCode,
                $"The limiter refused attempt {attempt} of the allowance.");
        }

        var refused = await InvitationLookupAsync(client, ForwardedClient);
        Assert.AreEqual(HttpStatusCode429, (int)refused.StatusCode, "The allowance was not enforced at all.");

        var otherClient = await InvitationLookupAsync(client, SecondForwardedClient);
        Assert.AreNotEqual(
            HttpStatusCode429,
            (int)otherClient.StatusCode,
            "Two forwarded clients shared one rate-limit partition, which is the collapse this fixes.");

        await api.StopAsync();
    }

    private const int HttpStatusCode429 = 429;

    /// <summary>
    /// The smallest host that composes this seam for real: the production options contract, the
    /// production extension method, a real listener, and one terminal middleware that reports what
    /// the pipeline decided.
    /// </summary>
    private async Task<HttpClient> StartProbeAsync(Dictionary<string, string?> settings)
    {
        var builder = WebApplication.CreateBuilder();
        builder.Logging.ClearProviders();
        // Added last so it outranks anything ambient; the probe must test the settings it was given.
        builder.Configuration.AddInMemoryCollection(settings);
        builder.WebHost.UseUrls("http://127.0.0.1:0");

        var bound = new ReverseProxyOptions();
        builder.Configuration.GetSection(ReverseProxyOptions.SectionName).Bind(bound);
        builder.Services.AddOptions<ReverseProxyOptions>()
            .Bind(builder.Configuration.GetSection(ReverseProxyOptions.SectionName))
            .Validate(options => options.Validate() is null, bound.Validate() ?? "invalid")
            .ValidateOnStart();

        var app = builder.Build();
        app.UseTbGymForwardedHeaders();
        app.Run(context => context.Response.WriteAsync(
            $"{context.Connection.RemoteIpAddress}|{context.Request.Scheme}"));

        await app.StartAsync();
        probe = app;

        var address = app.Services.GetRequiredService<IServer>().Features
            .Get<IServerAddressesFeature>()?.Addresses.FirstOrDefault()
            ?? throw new InvalidOperationException("The probe host reported no listening address.");
        return NewClient(new Uri(address, UriKind.Absolute));
    }

    /// <summary>
    /// One request through the real forwarded-headers middleware, composed from these options, from
    /// a remote address of the test's choosing.
    /// </summary>
    /// <remarks>
    /// A socket cannot supply an untrusted source here: every address a test machine can bind and
    /// connect to is inside the framework's own default <c>127.0.0.0/8</c>, so a listener-based test
    /// would prove the default rather than the configuration. This drives the middleware the
    /// application composes, with the options the application composes, and sets the one input a
    /// loopback connection cannot vary.
    /// </remarks>
    private static async Task<DefaultHttpContext> ForwardAsync(
        ReverseProxyOptions options,
        string connectingFrom)
    {
        var context = new DefaultHttpContext();
        context.Connection.RemoteIpAddress = IPAddress.Parse(connectingFrom);
        context.Request.Scheme = "http";
        context.Request.Headers["X-Forwarded-For"] = ForwardedClient;
        context.Request.Headers["X-Forwarded-Proto"] = "https";

        var middleware = new ForwardedHeadersMiddleware(
            _ => Task.CompletedTask,
            NullLoggerFactory.Instance,
            Options.Create(ReverseProxyMiddlewareExtensions.BuildForwardedHeaders(options)));
        await middleware.Invoke(context);
        return context;
    }

    private static async Task<(string RemoteIp, string Scheme)> ProbeAsync(
        HttpClient client,
        string forwardedFor,
        string forwardedProto)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, ProbePath);
        request.Headers.Add("X-Forwarded-For", forwardedFor);
        request.Headers.Add("X-Forwarded-Proto", forwardedProto);

        using var response = await client.SendAsync(request);
        var body = await response.Content.ReadAsStringAsync();
        var parts = body.Split('|');
        return (parts[0], parts[1]);
    }

    private static Task<HttpResponseMessage> InvitationLookupAsync(HttpClient client, string forwardedFor)
    {
        // Anonymous, GET, no antiforgery, one indexed lookup that misses: the cheapest endpoint
        // carrying the public authentication limiter. What is asserted is 429 or not, and the
        // limiter runs before the endpoint either way.
        var request = new HttpRequestMessage(
            HttpMethod.Get,
            $"/api/invitations/public/{Guid.NewGuid():N}");
        request.Headers.Add("X-Forwarded-For", forwardedFor);
        return client.SendAsync(request);
    }

    private HttpClient NewClient(Uri baseAddress)
    {
        var client = new HttpClient { BaseAddress = baseAddress };
        clients.Add(client);
        return client;
    }

    private async Task PrepareDatabaseNameAsync(string prefix)
    {
        adminConnection = PostgreSqlTestEnvironment.RequireAdminConnection();
        databaseName = await PostgreSqlTestEnvironment.CreateDatabaseAsync(prefix);
        databaseConnection = new NpgsqlConnectionStringBuilder(adminConnection)
        {
            Database = databaseName,
        }.ConnectionString;
    }

    /// <summary>Brings the test database up to the current schema, using an ordinary host.</summary>
    private void MigrateDatabase()
    {
        using var migrator = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            ConfigureApi(
                builder,
                new Dictionary<string, string?> { ["Database:ApplyMigrationsOnStartup"] = "true" }));

        _ = migrator.Services;
    }

    private WebApplicationFactory<Program> CreateApiFactory(Dictionary<string, string?> overrides) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder => ConfigureApi(builder, overrides));

    private void ConfigureApi(IWebHostBuilder builder, Dictionary<string, string?> overrides)
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
            ["Media:Reconciliation:Enabled"] = "false",
            ["Notifications:Dispatch:PollIntervalSeconds"] = "300",
            ["Messaging:Realtime:Enabled"] = "false",
            ["Messaging:Realtime:ApiReplicaCount"] = "1",
            ["Messaging:Realtime:AllowedOrigins:0"] = "http://localhost:4200",
        };

        foreach (var (key, value) in overrides)
        {
            settings[key] = value;
        }

        builder.UseEnvironment("Development");
        foreach (var (key, value) in settings)
        {
            builder.UseSetting(key, value);
        }

        builder.ConfigureAppConfiguration((_, configuration) =>
            configuration.AddInMemoryCollection(settings));
    }
}
