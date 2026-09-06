using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Npgsql;
using TB.Gym.Infrastructure.Application;
using TB.Gym.SharedKernel;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Fixture for the real-network realtime tests: Kestrel, a real WebSocket, a real cookie and real
/// Redis.
/// </summary>
/// <remarks>
/// Everything here is deliberately the real thing. The hub is reached over a socket rather than
/// through <c>TestServer</c>, the client authenticates with the cookie a browser would send and
/// sends no <c>X-Tenant-Id</c> header — because a browser cannot put one on a WebSocket — and the
/// backplane is a Redis container rather than a fake that always delivers. Each of those is a place
/// where an implementation can be correct in C# and wrong in a browser.
/// </remarks>
public sealed partial class Phase6B2BRealtimeSignalRTests : IDisposable
{
    private const string AllowedOrigin = "http://localhost:4200";
    private const string DisallowedOrigin = "https://evil.example.test";

    private static readonly string Password = $"Aa1!{Guid.NewGuid():N}";
    private static readonly DateTimeOffset StartInstant = new(2026, 9, 4, 6, 0, 0, TimeSpan.Zero);

    private string? adminConnection;
    private string? databaseName;
    private string? databaseConnection;
    private RedisInstance? redis;
    private KestrelApiFactory? replicaA;
    private KestrelApiFactory? replicaB;
    private CapturedLog? logA;
    private CapturedLog? logB;
    private readonly List<HubConnection> connections = [];
    private readonly List<HttpClient> httpClients = [];
    private readonly List<HttpClientHandler> handlers = [];

    public TestContext TestContext { get; set; } = null!;

    /// <summary>
    /// Whether this test needs the second replica and the backplane.
    /// </summary>
    /// <remarks>
    /// Starting a Redis container and a second Kestrel host costs a second or two, and most of these
    /// tests are about one replica's handshake. The scale-out tests name themselves, so the fixture
    /// only pays for it when it is being tested.
    /// </remarks>
    private bool NeedsBackplane => TestContext.TestName?.Contains("Replica", StringComparison.Ordinal) == true
        || TestContext.TestName?.Contains("Redis", StringComparison.Ordinal) == true;

    [TestInitialize]
    public async Task InitializeAsync()
    {
        adminConnection = PostgreSqlTestEnvironment.RequireAdminConnection();
        databaseName = await PostgreSqlTestEnvironment.CreateDatabaseAsync("tbgym_p6b2b_ws");
        databaseConnection = new NpgsqlConnectionStringBuilder(adminConnection)
        {
            Database = databaseName,
        }.ConnectionString;

        if (NeedsBackplane)
        {
            redis = await RedisTestEnvironment.StartAsync("ws");
        }

        // Migrations, once and by nobody who then serves. A Kestrel replica builds its host twice
        // from one builder — the TestServer the factory insists on, and the one that actually listens
        // — so a replica that migrated on startup would migrate twice, and two replicas would be four
        // racing attempts at the same schema.
        MigrateDatabase();

        logA = new CapturedLog();
        replicaA = CreateReplica(logA);
        // Resolving Services is what actually builds and starts the host.
        _ = replicaA.Services;

        if (NeedsBackplane)
        {
            logB = new CapturedLog();
            replicaB = CreateReplica(logB);
            _ = replicaB.Services;
        }
    }

    /// <summary>Brings the test database up to the current schema, using an ordinary host.</summary>
    private void MigrateDatabase()
    {
        using var migrator = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Development");
            var settings = new Dictionary<string, string?>
            {
                ["ConnectionStrings:Database"] = databaseConnection,
                ["Database:ApplyMigrationsOnStartup"] = "true",
                ["Seed:Enabled"] = "false",
                ["Application:PublicBaseUrl"] = AllowedOrigin,
                ["Media:StorageRoot"] = Path.Combine(Path.GetTempPath(), databaseName!, "media"),
                ["Media:PurgeEnabled"] = "false",
                ["Notifications:Dispatch:PollIntervalSeconds"] = "300",
                ["Messaging:Realtime:Enabled"] = "false",
                ["Messaging:Realtime:AllowedOrigins:0"] = AllowedOrigin,
            };
            foreach (var (key, value) in settings)
            {
                builder.UseSetting(key, value);
            }

            builder.ConfigureAppConfiguration((_, configuration) =>
                configuration.AddInMemoryCollection(settings));
        });

        _ = migrator.Services;
    }

    /// <summary>
    /// One API replica. Two of these share nothing but PostgreSQL and Redis: separate service
    /// providers, separate SignalR lifetime managers, separate everything else.
    /// </summary>
    private KestrelApiFactory CreateReplica(CapturedLog capturedLog)
    {
        var settings = new Dictionary<string, string?>
        {
            ["ConnectionStrings:Database"] = databaseConnection,
            ["Database:ApplyMigrationsOnStartup"] = "false",
            ["Seed:Enabled"] = "false",
            ["Application:PublicBaseUrl"] = AllowedOrigin,
            ["Media:StorageRoot"] = Path.Combine(Path.GetTempPath(), databaseName!, "media"),
            ["Media:PurgeEnabled"] = "false",
            ["Notifications:Dispatch:PollIntervalSeconds"] = "300",
            ["Messaging:Realtime:Enabled"] = "true",
            ["Messaging:Realtime:PollIntervalSeconds"] = "300",
            // The origin allowlist is configured even in Development here, because the point of
            // several of these tests is that it is enforced.
            ["Messaging:Realtime:AllowedOrigins:0"] = AllowedOrigin,
        };

        if (redis is not null)
        {
            settings["Messaging:Realtime:ScaleOut"] = "Redis";
            settings["Messaging:Realtime:ApiReplicaCount"] = "2";
            settings["Messaging:Realtime:RedisConnectionString"] = redis.ConnectionString;
            // Namespaced per test database, so parallel tests cannot see each other's frames even if
            // they somehow shared an instance.
            settings["Messaging:Realtime:RedisChannelPrefix"] = databaseName!;
        }

        return new KestrelApiFactory(builder =>
        {
            builder.UseEnvironment("Development");
            foreach (var (key, value) in settings)
            {
                builder.UseSetting(key, value);
            }

            builder.ConfigureAppConfiguration((_, configuration) =>
                configuration.AddInMemoryCollection(settings));
            builder.ConfigureServices(services =>
            {
                services.AddSingleton<ILoggerProvider>(capturedLog);
                // Every sweep in these tests is one the test asked for, so a background tick cannot
                // publish an event a test is about to assert has not been published yet.
                Phase6B2BRealtimeMessagingTests.RemoveHostedSweeps(services);
            });
        });
    }

    [TestCleanup]
    public async Task CleanupAsync()
    {
        foreach (var connection in connections)
        {
            try
            {
                await connection.DisposeAsync();
            }
            catch (Exception exception) when (exception is InvalidOperationException or ObjectDisposedException)
            {
                // A connection the test already aborted.
            }
        }

        foreach (var client in httpClients)
        {
            client.Dispose();
        }

        foreach (var handler in handlers)
        {
            handler.Dispose();
        }

        // Stopped asynchronously first, then disposed. Blocking on host shutdown from a synchronous
        // Dispose deadlocks the run once several test methods tear their hosts down at once.
        if (replicaB is not null)
        {
            await replicaB.StopAsync();
            replicaB.Dispose();
        }

        if (replicaA is not null)
        {
            await replicaA.StopAsync();
            replicaA.Dispose();
        }

        if (redis is not null)
        {
            await redis.DisposeAsync();
        }

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

        await using var connection2 = new NpgsqlConnection(adminConnection);
        await connection2.OpenAsync();
        await using var command = connection2.CreateCommand();
        command.CommandText = $"DROP DATABASE IF EXISTS \"{databaseName}\" WITH (FORCE)";
        await command.ExecuteNonQueryAsync();
    }

    /// <summary>
    /// The captured logs are the only disposables this fixture owns outright; everything else is torn
    /// down in cleanup, where the awaits belong.
    /// </summary>
    public void Dispose()
    {
        logA?.Dispose();
        logB?.Dispose();
    }

    private KestrelApiFactory ReplicaA =>
        replicaA ?? throw new InvalidOperationException("Replica A is not initialized.");

    private KestrelApiFactory ReplicaB =>
        replicaB ?? throw new InvalidOperationException("Replica B is not initialized.");

    private RedisInstance Redis =>
        redis ?? throw new InvalidOperationException("Redis is not initialized.");

    private CapturedLog LogA =>
        logA ?? throw new InvalidOperationException("Replica A's log is not initialized.");

    /// <summary>Drives one sweep on a named replica, so a test can say which process published.</summary>
    private static async Task<MessagingRealtimeDispatchOutcome> SweepAsync(KestrelApiFactory replica)
    {
        await using var scope = replica.ReplicaServices.CreateAsyncScope();
        var service = scope.ServiceProvider.GetRequiredService<IMessagingRealtimeDispatchService>();
        return await service.DispatchDueAsync(CancellationToken.None);
    }

    // ---------- a real browser-shaped session ----------

    /// <summary>
    /// A real HTTP client with its own cookie jar, pointed at a replica's actual socket.
    /// </summary>
    /// <remarks>
    /// The jar is the point: the same container is handed to the hub connection, so the socket
    /// authenticates with exactly the cookie the REST session established, the way a browser does.
    /// </remarks>
    private BrowserSession NewSession(KestrelApiFactory replica)
    {
        var jar = new CookieContainer();
        var handler = new HttpClientHandler { CookieContainer = jar, UseCookies = true, AllowAutoRedirect = false };
        handlers.Add(handler);
        var client = new HttpClient(handler) { BaseAddress = replica.ServerAddress };
        httpClients.Add(client);
        return new BrowserSession(client, jar, replica);
    }

    /// <summary>
    /// Opens the hub the way the browser does: relative path, cookie, tenant in the query string, and
    /// no <c>X-Tenant-Id</c> header, because a browser cannot put one on a WebSocket.
    /// </summary>
    private async Task<RecordingHubClient> ConnectAsync(
        BrowserSession session,
        Guid? tenantId,
        string? origin = AllowedOrigin,
        string? rawQuery = null)
    {
        var query = rawQuery ?? (tenantId is { } id ? $"?tenantId={id}" : string.Empty);
        var builder = new HubConnectionBuilder()
            .WithUrl(new Uri(session.Replica.ServerAddress, $"/hubs/chat{query}"), options =>
            {
                options.Cookies = session.Cookies;
                // WebSockets only, so the test is exercising the handshake it claims to be and not
                // silently falling back to long polling when the upgrade is refused.
                options.Transports = HttpTransportType.WebSockets;
                options.SkipNegotiation = false;
                if (origin is not null)
                {
                    options.Headers["Origin"] = origin;
                }

                // Deliberately absent. If the hub ever needed this, the browser could not send it.
                Assert.IsFalse(
                    options.Headers.ContainsKey(TenantHeaders.TenantId),
                    "A browser cannot put a custom header on a WebSocket, so the hub must not need one.");
            });

        var connection = builder.Build();
        connections.Add(connection);
        var client = new RecordingHubClient(connection);

        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        await connection.StartAsync(timeout.Token);
        return client;
    }

    /// <summary>Attempts a connection and returns whether it was refused.</summary>
    private async Task<bool> ConnectionIsRefusedAsync(
        BrowserSession session,
        Guid? tenantId,
        string? origin = AllowedOrigin,
        string? rawQuery = null)
    {
        var query = rawQuery ?? (tenantId is { } id ? $"?tenantId={id}" : string.Empty);
        var connection = new HubConnectionBuilder()
            .WithUrl(new Uri(session.Replica.ServerAddress, $"/hubs/chat{query}"), options =>
            {
                options.Cookies = session.Cookies;
                options.Transports = HttpTransportType.WebSockets;
                if (origin is not null)
                {
                    options.Headers["Origin"] = origin;
                }
            })
            .Build();
        connections.Add(connection);

        try
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));
            await connection.StartAsync(timeout.Token);
        }
        catch (Exception exception) when (exception is not AssertFailedException)
        {
            return true;
        }

        // A hub that aborts the connection in OnConnectedAsync may complete the handshake first and
        // close immediately after, so a start that succeeded is only proof of acceptance if the
        // connection is still up a moment later.
        for (var attempt = 0; attempt < 40; attempt++)
        {
            if (connection.State != HubConnectionState.Connected)
            {
                return true;
            }

            await Task.Delay(50);
        }

        return false;
    }

    // ---------- seeding ----------

    private static async Task RefreshCsrfAsync(HttpClient client)
    {
        var csrf = await client.GetFromJsonAsync<Csrf>("/api/auth/csrf")
            ?? throw new AssertFailedException("CSRF response was empty.");
        client.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
        client.DefaultRequestHeaders.Add("X-XSRF-TOKEN", csrf.Token);
    }

    private static void SetTenant(HttpClient client, Guid tenantId)
    {
        client.DefaultRequestHeaders.Remove(TenantHeaders.TenantId);
        client.DefaultRequestHeaders.Add(TenantHeaders.TenantId, tenantId.ToString());
    }

    private static async Task<Guid> RegisterCoachAsync(BrowserSession session, string email, string workspaceName)
    {
        await RefreshCsrfAsync(session.Client);
        var response = await session.Client.PostAsJsonAsync("/api/auth/register/coach", new
        {
            displayName = workspaceName + " Coach",
            email,
            password = Password,
            workspaceName,
            timeZoneId = "Asia/Beirut",
            defaultCulture = "en-LB",
            defaultCurrencyCode = "USD",
            weekStartsOn = "Monday",
        });
        await AssertStatusAsync(response, HttpStatusCode.Accepted);
        var registration = await RequiredJsonAsync<Registration>(response);
        Assert.IsNotNull(registration.DevelopmentConfirmationUrl);
        await RefreshCsrfAsync(session.Client);
        await AssertStatusAsync(
            await session.Client.PostAsJsonAsync("/api/auth/confirm-email", new
            {
                userId = Guid.Parse(QueryValue(registration.DevelopmentConfirmationUrl, "userId")),
                code = QueryValue(registration.DevelopmentConfirmationUrl, "code"),
            }),
            HttpStatusCode.NoContent);
        await SignInAsync(session, email);
        var memberships = await session.Client.GetFromJsonAsync<Membership[]>("/api/tenants")
            ?? throw new AssertFailedException("Workspace membership was empty.");
        SetTenant(session.Client, memberships.Single().TenantId);
        return memberships.Single().TenantId;
    }

    private static async Task SignInAsync(BrowserSession session, string email)
    {
        await RefreshCsrfAsync(session.Client);
        await AssertStatusAsync(
            await session.Client.PostAsJsonAsync(
                "/api/auth/login",
                new { email, password = Password, rememberMe = false }),
            HttpStatusCode.OK);
    }

    private static async Task<Guid> CurrentUserIdAsync(HttpClient client) =>
        (await client.GetFromJsonAsync<CurrentUser>("/api/auth/me")
         ?? throw new AssertFailedException("The current-user response was empty.")).Id;

    /// <summary>A workspace, a linked client, a paid Messaging plan and an open conversation.</summary>
    private async Task<LiveWorkspace> CreateLiveWorkspaceAsync(string label)
    {
        var suffix = Guid.NewGuid().ToString("N")[..10];
        var coach = NewSession(ReplicaA);
        var tenantId = await RegisterCoachAsync(coach, $"coach-{label}-{suffix}@tbgym.test", $"{label} {suffix}");
        var coachUserId = await CurrentUserIdAsync(coach.Client);

        var clientSession = NewSession(ReplicaA);
        await RefreshCsrfAsync(coach.Client);
        var invitation = await coach.Client.PostAsJsonAsync("/api/invitations", new
        {
            email = $"client-{label}-{suffix}@tbgym.test",
            firstName = "Realtime",
            lastName = "Client",
            phoneNumber = "+96170000000",
            birthDate = "1995-04-02",
        });
        await AssertStatusAsync(invitation, HttpStatusCode.Created);
        var invited = await RequiredJsonAsync<Invitation>(invitation);
        await RefreshCsrfAsync(clientSession.Client);
        var acceptance = await clientSession.Client.PostAsJsonAsync("/api/invitations/accept", new
        {
            token = QueryValue(invited.DevelopmentActionUrl!, "token"),
            displayName = "Realtime Client",
            password = Password,
        });
        await AssertStatusAsync(acceptance, HttpStatusCode.OK);
        var accepted = await RequiredJsonAsync<Acceptance>(acceptance);
        SetTenant(clientSession.Client, accepted.TenantId);
        var clientUserId = await CurrentUserIdAsync(clientSession.Client);

        // A paid Messaging plan, so both sides currently pass the entitlement decision.
        await RefreshCsrfAsync(coach.Client);
        var product = await coach.Client.PostAsJsonAsync("/api/commercial/products", new
        {
            name = $"Coaching {label} {suffix}",
            description = "Phase 6B-2B",
            initialOffer = new
            {
                label = "Messaging plan",
                durationCount = 8,
                durationUnit = "Week",
                priceAmount = 120m,
                priceCurrency = "USD",
                features = new[] { new { feature = "Messaging", allowsConcurrentCoverage = false } },
            },
        });
        await AssertStatusAsync(product, HttpStatusCode.OK);
        var offerId = (await RequiredJsonAsync<Product>(product)).Offers[0].Id;

        var localNow = TimeZoneInfo.ConvertTime(StartInstant, TimeZoneInfo.FindSystemTimeZoneById("Asia/Beirut"));
        await RefreshCsrfAsync(coach.Client);
        var enrollmentResponse = await coach.Client.PostAsJsonAsync(
            $"/api/commercial/clients/{accepted.ClientProfileId}/enrollments",
            new
            {
                offerId,
                startDate = DateOnly.FromDateTime(localNow.DateTime),
                idempotencyKey = Guid.NewGuid(),
            });
        await AssertStatusAsync(enrollmentResponse, HttpStatusCode.OK);
        var enrollment = await RequiredJsonAsync<Enrollment>(enrollmentResponse);
        await RefreshCsrfAsync(coach.Client);
        await AssertStatusAsync(
            await coach.Client.PostAsJsonAsync(
                $"/api/commercial/enrollments/{enrollment.Id}/payments",
                new
                {
                    amount = enrollment.PriceAmount,
                    currencyCode = "USD",
                    receivedAtUtc = DateTimeOffset.UtcNow,
                    method = "Cash",
                    reference = "receipt-1",
                    idempotencyKey = Guid.NewGuid(),
                }),
            HttpStatusCode.OK);

        await RefreshCsrfAsync(coach.Client);
        var conversation = await coach.Client.PostAsJsonAsync(
            "/api/messaging/conversations",
            new { clientProfileId = accepted.ClientProfileId, idempotencyKey = Guid.NewGuid() });
        await AssertStatusAsync(conversation, HttpStatusCode.OK);
        var detail = await RequiredJsonAsync<ConversationDetailResponse>(conversation);

        return new LiveWorkspace(
            tenantId,
            coach,
            coachUserId,
            clientSession,
            accepted.ClientProfileId,
            clientUserId,
            detail.Conversation.Id,
            enrollment.Id,
            suffix);
    }

    private static async Task<MessageResponse> SendAsync(BrowserSession session, Guid conversationId, string body)
    {
        await RefreshCsrfAsync(session.Client);
        var response = await session.Client.PostAsJsonAsync(
            $"/api/messaging/conversations/{conversationId}/messages",
            new { body, idempotencyKey = Guid.NewGuid() });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<MessageResponse>(response);
    }

    private static async Task<RealtimeEventPageResponse> CatchUpAsync(
        BrowserSession session,
        Guid conversationId,
        long afterEventSequence)
    {
        var response = await session.Client.GetAsync(
            $"/api/messaging/conversations/{conversationId}/realtime-events"
            + $"?afterEventSequence={afterEventSequence.ToString(CultureInfo.InvariantCulture)}&take=100");
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<RealtimeEventPageResponse>(response);
    }

    private async Task ExecuteAsync(string sql, params (string Name, object Value)[] parameters)
    {
        await using var connection = new NpgsqlConnection(databaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        foreach (var (name, value) in parameters)
        {
            command.Parameters.AddWithValue(name, value);
        }

        await command.ExecuteNonQueryAsync();
    }

    private async Task<T> ScalarAsync<T>(string sql, params (string Name, object Value)[] parameters)
    {
        await using var connection = new NpgsqlConnection(databaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        foreach (var (name, value) in parameters)
        {
            command.Parameters.AddWithValue(name, value);
        }

        var result = await command.ExecuteScalarAsync();
        return result is null or DBNull ? default! : (T)Convert.ChangeType(result, typeof(T), CultureInfo.InvariantCulture);
    }

    private static string QueryValue(string url, string key)
    {
        var query = QueryHelpers.ParseQuery(new Uri(url).Query);
        return query.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value)
            ? value.ToString()
            : throw new AssertFailedException($"The URL does not contain query value '{key}'.");
    }

    private static async Task<T> RequiredJsonAsync<T>(HttpResponseMessage response) =>
        await response.Content.ReadFromJsonAsync<T>()
        ?? throw new AssertFailedException($"{typeof(T).Name} response was empty.");

    private static async Task AssertStatusAsync(HttpResponseMessage response, HttpStatusCode expected)
    {
        if (response.StatusCode == expected)
        {
            return;
        }

        Assert.Fail($"Expected {(int)expected}, received {(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
    }

    private sealed record BrowserSession(HttpClient Client, CookieContainer Cookies, KestrelApiFactory Replica);

    private sealed record LiveWorkspace(
        Guid TenantId,
        BrowserSession Coach,
        Guid CoachUserId,
        BrowserSession Client,
        Guid ClientProfileId,
        Guid ClientUserId,
        Guid ConversationId,
        Guid EnrollmentId,
        string Suffix);

    private sealed record Csrf(string Token);

    private sealed record Registration(string? DevelopmentConfirmationUrl);

    private sealed record Membership(Guid TenantId);

    private sealed record CurrentUser(Guid Id);

    private sealed record Invitation(string? DevelopmentActionUrl);

    private sealed record Acceptance(Guid TenantId, Guid ClientProfileId, bool SignedIn);

    private sealed record Product(Offer[] Offers);

    private sealed record Offer(Guid Id);

    private sealed record Enrollment(Guid Id, decimal PriceAmount, uint Version);

    private sealed record ConversationSummaryResponse(Guid Id);

    private sealed record ConversationDetailResponse(ConversationSummaryResponse Conversation);

    private sealed record MessageResponse(Guid Id, long Sequence, string? Body);

    internal sealed record RealtimeMessage(Guid Id, long Sequence, string? Body, bool IsDeleted);

    internal sealed record RealtimeEventResponse(
        Guid TenantId,
        Guid ConversationId,
        Guid EventId,
        long EventSequence,
        string Kind,
        DateTimeOffset OccurredAtUtc,
        RealtimeMessage? Message);

    private sealed record RealtimeEventPageResponse(
        Guid ConversationId,
        RealtimeEventResponse[] Items,
        bool HasMore,
        long? NextAfterEventSequence,
        long LatestEventSequence);

    internal sealed record InvalidationResponse(
        Guid TenantId,
        Guid ConversationId,
        long EventSequence,
        DateTimeOffset OccurredAtUtc);

    /// <summary>Collects what a real connected client actually received.</summary>
    internal sealed class RecordingHubClient
    {
        private readonly List<RealtimeEventResponse> events = [];
        private readonly List<InvalidationResponse> invalidations = [];
        private readonly Lock sync = new();

        public RecordingHubClient(HubConnection connection)
        {
            Connection = connection;
            connection.On<RealtimeEventResponse>("RealtimeEvent", item =>
            {
                lock (sync)
                {
                    events.Add(item);
                }
            });
            connection.On<InvalidationResponse>("ConversationChanged", item =>
            {
                lock (sync)
                {
                    invalidations.Add(item);
                }
            });
        }

        public HubConnection Connection { get; }

        public IReadOnlyList<RealtimeEventResponse> Events
        {
            get
            {
                lock (sync)
                {
                    return [.. events];
                }
            }
        }

        public IReadOnlyList<InvalidationResponse> Invalidations
        {
            get
            {
                lock (sync)
                {
                    return [.. invalidations];
                }
            }
        }

        public void Clear()
        {
            lock (sync)
            {
                events.Clear();
                invalidations.Clear();
            }
        }

        /// <summary>Whether the live socket has received the named durable message.</summary>
        public bool HasMessage(Guid messageId)
        {
            lock (sync)
            {
                return events.Any(item => item.Message?.Id == messageId);
            }
        }

        /// <summary>
        /// Waits for a frame to arrive, polling rather than sleeping a guess.
        /// </summary>
        /// <remarks>
        /// A socket is genuinely asynchronous, so something has to wait. What matters is that the wait
        /// is on a condition with a deadline rather than a fixed sleep that would pass on a fast
        /// machine and fail on a loaded one.
        /// </remarks>
        public async Task<bool> WaitForEventsAsync(int count, TimeSpan? timeout = null)
        {
            var deadline = DateTimeOffset.UtcNow.Add(timeout ?? TimeSpan.FromSeconds(20));
            while (DateTimeOffset.UtcNow < deadline)
            {
                if (Events.Count >= count)
                {
                    return true;
                }

                await Task.Delay(25);
            }

            return Events.Count >= count;
        }

        public async Task<bool> WaitForInvalidationsAsync(int count, TimeSpan? timeout = null)
        {
            var deadline = DateTimeOffset.UtcNow.Add(timeout ?? TimeSpan.FromSeconds(20));
            while (DateTimeOffset.UtcNow < deadline)
            {
                if (Invalidations.Count >= count)
                {
                    return true;
                }

                await Task.Delay(25);
            }

            return Invalidations.Count >= count;
        }

        /// <summary>Waits for one named message, ignoring unrelated frames that arrive first.</summary>
        public async Task<bool> WaitForMessageAsync(Guid messageId, TimeSpan? timeout = null)
        {
            var deadline = DateTimeOffset.UtcNow.Add(timeout ?? TimeSpan.FromSeconds(20));
            while (DateTimeOffset.UtcNow < deadline)
            {
                if (HasMessage(messageId))
                {
                    return true;
                }

                await Task.Delay(25);
            }

            return HasMessage(messageId);
        }

        /// <summary>
        /// Confirms nothing arrives. A negative assertion needs a bounded window, because "it has not
        /// arrived yet" and "it will never arrive" look identical at any single instant.
        /// </summary>
        public async Task AssertNothingArrivesAsync(TimeSpan window, string because)
        {
            var deadline = DateTimeOffset.UtcNow.Add(window);
            while (DateTimeOffset.UtcNow < deadline)
            {
                Assert.IsEmpty(Events, because);
                await Task.Delay(50);
            }
        }
    }
}
