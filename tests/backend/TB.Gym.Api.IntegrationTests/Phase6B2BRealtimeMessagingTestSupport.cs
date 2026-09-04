using System.Data.Common;
using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Npgsql;
using TB.Gym.Infrastructure.Application;
using TB.Gym.Modules.Messaging;
using TB.Gym.SharedKernel;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Fixture and seams for the Phase 6B-2B durable realtime tests.
/// </summary>
/// <remarks>
/// These tests are about the record rather than the socket: what a command commits, what a claim may
/// and may not do, what a suppressed publication does not load, and what catch-up and acknowledgement
/// return. The socket itself, the backplane and the two-replica case are proved separately in
/// <c>Phase6B2BRealtimeSignalRTests</c>, against Kestrel and real Redis.
/// <para>
/// The hosted sweep is removed from this host on purpose, so every sweep is one a test asked for. A
/// background tick racing an assertion about what one sweep did would make the whole suite flaky
/// rather than deterministic, and the timing it would be testing is not the behaviour under test.
/// </para>
/// <para>
/// Every race here is settled by a barrier, never by a sleep. The hub is replaced by a recorder so a
/// test can assert exactly which frames were published, to which groups, and — most importantly —
/// that a suppressed recipient produced none at all.
/// </para>
/// </remarks>
public sealed partial class Phase6B2BRealtimeMessagingTests
{
    private static readonly string Password = $"Aa1!{Guid.NewGuid():N}";

    /// <summary>A fixed workspace-local morning, well clear of a midnight boundary.</summary>
    private static readonly DateTimeOffset StartInstant = new(2026, 9, 4, 6, 0, 0, TimeSpan.Zero);

    private const int ClaimLeaseSeconds = 60;

    private string? adminConnection;
    private string? databaseName;
    private string? databaseConnection;
    private WebApplicationFactory<Program>? factory;
    private MutableClock? testClock;
    private CapturedLog? log;
    private RecordingHubProxy? hub;
    private DispatchCheckpointBarrier? checkpointBarrier;
    private CommandBarrier? barrier;
    private CommandRecorder? recorder;
    private CommitFault? commitFault;

    public TestContext TestContext { get; set; } = null!;

    /// <summary>
    /// Per-test attempt budgets. The exhaustion tests need a schedule they can actually reach, and one
    /// of them deliberately configures a maximum beyond the four-entry backoff table because that is
    /// where an off-by-one produces attempt maximum + 1.
    /// </summary>
    private int MaximumAttempts => TestContext.TestName switch
    {
        { } name when name.Contains("BeyondTheSchedule", StringComparison.Ordinal) => 7,
        { } name when name.Contains("Exhaust", StringComparison.Ordinal) => 2,
        _ => MessagingRealtimeOptions.DefaultMaximumAttempts,
    };

    [TestInitialize]
    public async Task InitializeAsync()
    {
        adminConnection = PostgreSqlTestEnvironment.RequireAdminConnection();
        databaseName = await PostgreSqlTestEnvironment.CreateDatabaseAsync("tbgym_p6b2b");
        databaseConnection = new NpgsqlConnectionStringBuilder(adminConnection)
        {
            Database = databaseName,
        }.ConnectionString;

        var clock = new MutableClock(StartInstant);
        testClock = clock;
        var capturedLog = new CapturedLog();
        log = capturedLog;
        var recordingHub = new RecordingHubProxy();
        hub = recordingHub;
        var dispatchCheckpointBarrier = new DispatchCheckpointBarrier();
        checkpointBarrier = dispatchCheckpointBarrier;
        var commandBarrier = new CommandBarrier();
        barrier = commandBarrier;
        var commandRecorder = new CommandRecorder();
        recorder = commandRecorder;
        var fault = new CommitFault();
        commitFault = fault;

        factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Development");
            var settings = new Dictionary<string, string?>
            {
                ["ConnectionStrings:Database"] = databaseConnection,
                ["Database:ApplyMigrationsOnStartup"] = "true",
                ["Seed:Enabled"] = "false",
                ["Application:PublicBaseUrl"] = "http://localhost:4200",
                ["Media:StorageRoot"] = Path.Combine(Path.GetTempPath(), databaseName, "media"),
                ["Media:PurgeEnabled"] = "false",
                ["Notifications:Dispatch:PollIntervalSeconds"] = "300",
                ["Messaging:Realtime:Enabled"] = "true",
                ["Messaging:Realtime:PollIntervalSeconds"] = "300",
                ["Messaging:Realtime:ClaimLeaseSeconds"] =
                    ClaimLeaseSeconds.ToString(CultureInfo.InvariantCulture),
                ["Messaging:Realtime:MaximumAttempts"] =
                    MaximumAttempts.ToString(CultureInfo.InvariantCulture),
            };
            foreach (var (key, value) in settings)
            {
                builder.UseSetting(key, value);
            }

            builder.ConfigureAppConfiguration((_, configuration) =>
                configuration.AddInMemoryCollection(settings));
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<IClock>();
                services.AddSingleton<IClock>(clock);
                services.AddSingleton<ILoggerProvider>(capturedLog);
                services.RemoveAll<IMessagingRealtimeDispatchCheckpoint>();
                services.AddSingleton<IMessagingRealtimeDispatchCheckpoint>(dispatchCheckpointBarrier);
                // The hub, replaced by a recorder. What a test needs to know is which frames a sweep
                // published and to which server-generated groups — and, for the suppression tests,
                // that it published none. A real hub with no connections would swallow all of that.
                services.RemoveAll<IHubContext<ChatHub, IMessagingRealtimeClient>>();
                services.AddSingleton<IHubContext<ChatHub, IMessagingRealtimeClient>>(recordingHub);
                RemoveHostedSweeps(services);
                services.AddSingleton(commandBarrier);
                services.AddSingleton(commandRecorder);
                services.AddSingleton(fault);
                services.AddDbContext<TB.Gym.Infrastructure.Persistence.GymDbContext>(
                    (provider, options) => options.AddInterceptors(
                        provider.GetRequiredService<CommandBarrier>(),
                        provider.GetRequiredService<CommandRecorder>(),
                        provider.GetRequiredService<CommitFault>()));
            });
        });
    }

    /// <summary>
    /// Takes the API's own background sweeps out, so every sweep in these tests is one a test asked
    /// for. Named types rather than a blanket removal: the generic web host is itself an
    /// <c>IHostedService</c>, and removing that would remove the server.
    /// </summary>
    internal static void RemoveHostedSweeps(IServiceCollection services)
    {
        var sweeps = services
            .Where(descriptor =>
                descriptor.ServiceType == typeof(IHostedService) &&
                descriptor.ImplementationType == typeof(MessagingRealtimeWorker))
            .ToList();
        foreach (var descriptor in sweeps)
        {
            services.Remove(descriptor);
        }
    }

    [TestCleanup]
    public async Task CleanupAsync()
    {
        barrier?.Disarm();
        checkpointBarrier?.Disarm();
        commitFault?.Disarm();
        factory?.Dispose();
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

    private WebApplicationFactory<Program> RequiredFactory =>
        factory ?? throw new InvalidOperationException("The test application is not initialized.");

    private string RequiredConnection =>
        databaseConnection ?? throw new InvalidOperationException("The test database is not initialized.");

    private MutableClock Clock =>
        testClock ?? throw new InvalidOperationException("The test clock is not initialized.");

    private CapturedLog Log =>
        log ?? throw new InvalidOperationException("The log capture is not initialized.");

    private RecordingHubProxy Hub =>
        hub ?? throw new InvalidOperationException("The hub recorder is not initialized.");

    private DispatchCheckpointBarrier Checkpoint =>
        checkpointBarrier ?? throw new InvalidOperationException("The dispatch checkpoint is not initialized.");

    private CommandBarrier Barrier =>
        barrier ?? throw new InvalidOperationException("The command barrier is not initialized.");

    private CommandRecorder Recorder =>
        recorder ?? throw new InvalidOperationException("The command recorder is not initialized.");

    private CommitFault Commits =>
        commitFault ?? throw new InvalidOperationException("The commit fault is not initialized.");

    private HttpClient CreateClient() => RequiredFactory.CreateClient(new WebApplicationFactoryClientOptions
    {
        AllowAutoRedirect = false,
        HandleCookies = true,
        BaseAddress = new Uri("http://localhost"),
    });

    /// <summary>One sweep, driven explicitly.</summary>
    private async Task<MessagingRealtimeDispatchOutcome> SweepAsync(CancellationToken cancellationToken = default)
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var service = scope.ServiceProvider.GetRequiredService<IMessagingRealtimeDispatchService>();
        return await service.DispatchDueAsync(cancellationToken);
    }

    // ---------- HTTP helpers ----------

    private static async Task RefreshCsrfAsync(HttpClient client)
    {
        var csrf = await client.GetFromJsonAsync<Csrf>("/api/auth/csrf")
            ?? throw new AssertFailedException("CSRF response was empty.");
        client.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
        client.DefaultRequestHeaders.Add("X-XSRF-TOKEN", csrf.Token);
    }

    private static void SetTenant(HttpClient client, Guid tenantId)
    {
        client.DefaultRequestHeaders.Remove("X-Tenant-Id");
        client.DefaultRequestHeaders.Add("X-Tenant-Id", tenantId.ToString());
    }

    private static async Task<Guid> RegisterCoachAsync(HttpClient client, string email, string workspaceName)
    {
        await RefreshCsrfAsync(client);
        var response = await client.PostAsJsonAsync("/api/auth/register/coach", new
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
        await ConfirmAndSignInAsync(client, email, registration.DevelopmentConfirmationUrl);
        var memberships = await client.GetFromJsonAsync<Membership[]>("/api/tenants")
            ?? throw new AssertFailedException("Workspace membership was empty.");
        SetTenant(client, memberships.Single().TenantId);
        return memberships.Single().TenantId;
    }

    private static async Task ConfirmAndSignInAsync(HttpClient client, string email, string confirmationUrl)
    {
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync("/api/auth/confirm-email", new
            {
                userId = Guid.Parse(QueryValue(confirmationUrl, "userId")),
                code = QueryValue(confirmationUrl, "code"),
            }),
            HttpStatusCode.NoContent);
        await SignInAsync(client, email);
    }

    private static async Task SignInAsync(HttpClient client, string email)
    {
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync("/api/auth/login", new { email, password = Password, rememberMe = false }),
            HttpStatusCode.OK);
    }

    private static async Task<Guid> CurrentUserIdAsync(HttpClient client) =>
        (await client.GetFromJsonAsync<CurrentUser>("/api/auth/me")
         ?? throw new AssertFailedException("The current-user response was empty.")).Id;

    private static async Task<Acceptance> InviteAndAcceptAsync(
        HttpClient coach,
        HttpClient client,
        string email,
        string firstName = "Messaged",
        string lastName = "Client")
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync("/api/invitations", new
        {
            email,
            firstName,
            lastName,
            phoneNumber = "+96170000000",
            birthDate = "1995-04-02",
        });
        await AssertStatusAsync(response, HttpStatusCode.Created);
        var invitation = await RequiredJsonAsync<Invitation>(response);
        await RefreshCsrfAsync(client);
        var acceptance = await client.PostAsJsonAsync("/api/invitations/accept", new
        {
            token = QueryValue(invitation.DevelopmentActionUrl!, "token"),
            displayName = $"{firstName} {lastName}",
            password = Password,
        });
        await AssertStatusAsync(acceptance, HttpStatusCode.OK);
        var accepted = await RequiredJsonAsync<Acceptance>(acceptance);
        SetTenant(client, accepted.TenantId);
        return accepted;
    }

    private static async Task<Guid> CreateOfferAsync(
        HttpClient coach,
        decimal priceAmount,
        int durationWeeks,
        string label,
        string feature = "Messaging")
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync("/api/commercial/products", new
        {
            name = $"Coaching {label} {Guid.NewGuid():N}",
            description = "Phase 6B-2B",
            initialOffer = new
            {
                label,
                durationCount = durationWeeks,
                durationUnit = "Week",
                priceAmount,
                priceCurrency = "USD",
                features = new[] { new { feature, allowsConcurrentCoverage = false } },
            },
        });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return (await RequiredJsonAsync<Product>(response)).Offers[0].Id;
    }

    private static async Task<Enrollment> AssignAsync(
        HttpClient coach,
        Guid clientProfileId,
        Guid offerId,
        DateOnly startDate)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync(
            $"/api/commercial/clients/{clientProfileId}/enrollments",
            new { offerId, startDate, idempotencyKey = Guid.NewGuid() });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<Enrollment>(response);
    }

    private static async Task PayInFullAsync(HttpClient coach, Enrollment enrollment)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync(
            $"/api/commercial/enrollments/{enrollment.Id}/payments",
            new
            {
                amount = enrollment.PriceAmount,
                currencyCode = "USD",
                receivedAtUtc = StartInstant,
                method = "Cash",
                reference = "receipt-1",
                idempotencyKey = Guid.NewGuid(),
            });
        await AssertStatusAsync(response, HttpStatusCode.OK);
    }

    private static async Task ChangeEnrollmentAsync(
        Workspace workspace,
        Guid enrollmentId,
        string action,
        string reason)
    {
        var overview = await workspace.Coach.GetFromJsonAsync<CommercialOverview>(
            $"/api/commercial/clients/{workspace.ClientProfileId}")
            ?? throw new AssertFailedException("The commercial overview response was empty.");
        var current = overview.Enrollments.Single(item => item.Id == enrollmentId);
        await RefreshCsrfAsync(workspace.Coach);
        await AssertStatusAsync(
            await workspace.Coach.PostAsJsonAsync(
                $"/api/commercial/enrollments/{enrollmentId}/{action}",
                new { reason, version = current.Version }),
            HttpStatusCode.OK);
    }

    private static async Task BlockClientAsync(HttpClient coach, Guid clientProfileId)
    {
        var details = await coach.GetFromJsonAsync<ClientDetails>($"/api/clients/{clientProfileId}")
            ?? throw new AssertFailedException("The client details response was empty.");
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync(
                $"/api/clients/{clientProfileId}/relationship/block",
                new { reason = "Phase 6B-2B access test.", version = details.Version }),
            HttpStatusCode.OK);
    }

    // ---------- messaging API ----------

    private static async Task<ConversationDetailResponse> StartConversationAsync(
        HttpClient coach,
        Guid clientProfileId,
        Guid? idempotencyKey = null)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync(
            "/api/messaging/conversations",
            new { clientProfileId, idempotencyKey = idempotencyKey ?? Guid.NewGuid() });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<ConversationDetailResponse>(response);
    }

    private static Task<HttpResponseMessage> PostMessageAsync(
        HttpClient caller,
        Guid conversationId,
        string body,
        Guid? idempotencyKey = null) =>
        caller.PostAsJsonAsync(
            $"/api/messaging/conversations/{conversationId}/messages",
            new { body, idempotencyKey = idempotencyKey ?? Guid.NewGuid() });

    private static async Task<MessageResponse> SendMessageAsync(
        HttpClient caller,
        Guid conversationId,
        string body,
        Guid? idempotencyKey = null)
    {
        await RefreshCsrfAsync(caller);
        var response = await PostMessageAsync(caller, conversationId, body, idempotencyKey);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<MessageResponse>(response);
    }

    private static async Task<MessageResponse> EditMessageAsync(
        HttpClient caller,
        Guid conversationId,
        Guid messageId,
        string body,
        uint expectedVersion,
        Guid? idempotencyKey = null)
    {
        await RefreshCsrfAsync(caller);
        var response = await caller.PostAsJsonAsync(
            $"/api/messaging/conversations/{conversationId}/messages/{messageId}/edit",
            new { body, expectedVersion, idempotencyKey = idempotencyKey ?? Guid.NewGuid() });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<MessageResponse>(response);
    }

    private static async Task<MessageResponse> DeleteMessageAsync(
        HttpClient caller,
        Guid conversationId,
        Guid messageId,
        uint expectedVersion,
        Guid? idempotencyKey = null)
    {
        await RefreshCsrfAsync(caller);
        var response = await caller.PostAsJsonAsync(
            $"/api/messaging/conversations/{conversationId}/messages/{messageId}/delete",
            new { expectedVersion, idempotencyKey = idempotencyKey ?? Guid.NewGuid() });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<MessageResponse>(response);
    }

    private static async Task<MessageResponse> ModerateMessageAsync(
        HttpClient caller,
        Guid conversationId,
        Guid messageId,
        string reason,
        uint expectedVersion,
        Guid? idempotencyKey = null)
    {
        await RefreshCsrfAsync(caller);
        var response = await caller.PostAsJsonAsync(
            $"/api/messaging/conversations/{conversationId}/messages/{messageId}/moderate",
            new { reason, expectedVersion, idempotencyKey = idempotencyKey ?? Guid.NewGuid() });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<MessageResponse>(response);
    }

    private static async Task<MessagePageResponse> GetMessagesAsync(HttpClient caller, Guid conversationId)
    {
        var response = await caller.GetAsync($"/api/messaging/conversations/{conversationId}/messages");
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<MessagePageResponse>(response);
    }

    // ---------- realtime API ----------

    private static Task<HttpResponseMessage> GetRealtimeEventsResponseAsync(
        HttpClient caller,
        Guid conversationId,
        long? afterEventSequence = null,
        int? take = null)
    {
        var query = new List<string>();
        if (afterEventSequence is { } cursor)
        {
            query.Add($"afterEventSequence={cursor.ToString(CultureInfo.InvariantCulture)}");
        }

        if (take is { } size)
        {
            query.Add($"take={size.ToString(CultureInfo.InvariantCulture)}");
        }

        var url = $"/api/messaging/conversations/{conversationId}/realtime-events"
            + (query.Count == 0 ? string.Empty : "?" + string.Join('&', query));
        return caller.GetAsync(url);
    }

    private static async Task<RealtimeEventPageResponse> GetRealtimeEventsAsync(
        HttpClient caller,
        Guid conversationId,
        long? afterEventSequence = null,
        int? take = null)
    {
        var response = await GetRealtimeEventsResponseAsync(caller, conversationId, afterEventSequence, take);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<RealtimeEventPageResponse>(response);
    }

    private static Task<HttpResponseMessage> PostAcknowledgementAsync(
        HttpClient caller,
        Guid conversationId,
        params long[] eventSequences) =>
        caller.PostAsJsonAsync(
            $"/api/messaging/conversations/{conversationId}/realtime-acknowledgements",
            new { eventSequences });

    private static async Task<AcknowledgementResponse> AcknowledgeAsync(
        HttpClient caller,
        Guid conversationId,
        params long[] eventSequences)
    {
        await RefreshCsrfAsync(caller);
        var response = await PostAcknowledgementAsync(caller, conversationId, eventSequences);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<AcknowledgementResponse>(response);
    }

    // ---------- scenarios ----------

    private async Task<Workspace> CreateWorkspaceAsync(string label, bool grantMessaging = true)
    {
        var suffix = Guid.NewGuid().ToString("N")[..10];
        var coachEmail = $"coach-{label}-{suffix}@tbgym.test";
        var clientEmail = $"client-{label}-{suffix}@tbgym.test";
        var coach = CreateClient();
        var tenantId = await RegisterCoachAsync(coach, coachEmail, $"{label} {suffix}");
        var coachUserId = await CurrentUserIdAsync(coach);
        var client = CreateClient();
        var acceptance = await InviteAndAcceptAsync(coach, client, clientEmail);
        var clientUserId = await CurrentUserIdAsync(client);
        var workspace = new Workspace(
            tenantId,
            coach,
            coachUserId,
            coachEmail,
            client,
            acceptance.ClientProfileId,
            clientUserId,
            clientEmail,
            suffix);
        if (grantMessaging)
        {
            workspace = workspace with { Enrollment = await GrantMessagingAsync(workspace) };
        }

        return workspace;
    }

    private async Task<Enrollment> GrantMessagingAsync(Workspace workspace, int durationWeeks = 8)
    {
        var offerId = await CreateOfferAsync(workspace.Coach, 120m, durationWeeks, "Messaging plan");
        var enrollment = await AssignAsync(
            workspace.Coach,
            workspace.ClientProfileId,
            offerId,
            TenantToday());
        await PayInFullAsync(workspace.Coach, enrollment);
        return enrollment;
    }

    /// <summary>A workspace with a conversation already open and its creation event swept.</summary>
    private async Task<Thread> OpenThreadAsync(string label)
    {
        var workspace = await CreateWorkspaceAsync(label);
        var conversation = await StartConversationAsync(workspace.Coach, workspace.ClientProfileId);
        return new Thread(workspace, conversation.Conversation.Id);
    }

    /// <summary>
    /// A second signed-in session for the same person: one user, two tabs, which is what a real
    /// duplicate submit looks like.
    /// </summary>
    private async Task<HttpClient> SecondSessionAsync(string email, Guid tenantId)
    {
        var session = CreateClient();
        await SignInAsync(session, email);
        SetTenant(session, tenantId);
        await RefreshCsrfAsync(session);
        return session;
    }

    /// <summary>
    /// A second Owner/Coach with an active membership of an existing workspace, written directly
    /// because no endpoint adds staff yet. The state is real and reachable once one exists; what is
    /// being tested is that a workspace member who is not a participant is refused.
    /// </summary>
    private async Task<SecondCoach> AddSecondCoachAsync(Workspace workspace, string label)
    {
        var suffix = Guid.NewGuid().ToString("N")[..10];
        var client = CreateClient();
        await RegisterCoachAsync(client, $"other-{label}-{suffix}@tbgym.test", $"Other {label} {suffix}");
        var userId = await CurrentUserIdAsync(client);
        await ExecuteAsync(
            """
            INSERT INTO tenancy."Memberships" ("Id", "TenantId", "UserId", "Role", "Status",
                                               "CreatedAtUtc", "UpdatedAtUtc")
            VALUES (@id, @tenantId, @userId, 'Coach', 'Active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            ("id", Guid.CreateVersion7()),
            ("tenantId", workspace.TenantId),
            ("userId", userId));
        SetTenant(client, workspace.TenantId);
        await RefreshCsrfAsync(client);
        return new SecondCoach(client, userId);
    }

    /// <summary>Revokes a member's workspace membership, as an administrator eventually will.</summary>
    private Task RevokeMembershipAsync(Guid tenantId, Guid userId) => ExecuteAsync(
        """
        UPDATE tenancy."Memberships" SET "Status" = 'Revoked'
        WHERE "TenantId" = @tenantId AND "UserId" = @userId
        """,
        ("tenantId", tenantId),
        ("userId", userId));

    private DateOnly TenantToday()
    {
        var local = TimeZoneInfo.ConvertTime(
            Clock.UtcNow,
            TimeZoneInfo.FindSystemTimeZoneById("Asia/Beirut"));
        return DateOnly.FromDateTime(local.DateTime);
    }

    /// <summary>
    /// Asserts nothing sensitive reached the captured log. A log is where content escapes most
    /// quietly, and a dispatcher that logs what it is carrying is the obvious way to do it.
    /// </summary>
    private void AssertLogIsSafe(Workspace workspace, params string[] forbidden)
    {
        var text = Log.Text;
        foreach (var term in forbidden)
        {
            Assert.DoesNotContain(term, text, $"'{term}' reached the log.");
        }

        Assert.DoesNotContain("@tbgym.test", text, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(workspace.Suffix, text, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("Messaged Client", text, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(
            workspace.TenantId.ToString(),
            text,
            "A workspace identifier in a realtime log line is a workspace an operator can correlate.");
        Assert.DoesNotContain(workspace.ClientUserId.ToString(), text);
        Assert.DoesNotContain(workspace.CoachUserId.ToString(), text);
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

    private static async Task<string> AccessReasonAsync(HttpResponseMessage response)
    {
        await AssertStatusAsync(response, HttpStatusCode.Forbidden);
        var problem = await response.Content.ReadFromJsonAsync<AccessProblem>();
        return problem?.AccessReason ?? string.Empty;
    }

    // ---------- direct SQL ----------

    private async Task<T> ScalarAsync<T>(string sql, params (string Name, object Value)[] parameters)
    {
        await using var connection = new NpgsqlConnection(RequiredConnection);
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

    private async Task ExecuteAsync(string sql, params (string Name, object Value)[] parameters)
    {
        await using var connection = new NpgsqlConnection(RequiredConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        foreach (var (name, value) in parameters)
        {
            command.Parameters.AddWithValue(name, value);
        }

        await command.ExecuteNonQueryAsync();
    }

    /// <summary>Runs raw SQL and returns the PostgreSQL error, so a rejection can be asserted exactly.</summary>
    private async Task<PostgresException> ExpectRejectionAsync(
        string sql,
        params (string Name, object Value)[] parameters)
    {
        try
        {
            await ExecuteAsync(sql, parameters);
        }
        catch (PostgresException exception)
        {
            return exception;
        }

        throw new AssertFailedException($"The database accepted a write it should have refused: {sql}");
    }

    private Task<long> CountAsync(string table, string where, params (string Name, object Value)[] parameters) =>
        ScalarAsync<long>($"SELECT count(*) FROM messaging.\"{table}\" WHERE {where}", parameters);

    private Task<long> EventCountAsync(Guid conversationId) =>
        CountAsync("RealtimeEvents", "\"ConversationId\" = @id", ("id", conversationId));

    private Task<long> RecipientCountAsync(Guid conversationId) =>
        CountAsync("RealtimeRecipients", "\"ConversationId\" = @id", ("id", conversationId));

    private Task<long> AttemptCountAsync(Guid recipientId) =>
        CountAsync("RealtimeAttempts", "\"RecipientId\" = @id", ("id", recipientId));

    private Task<long> AcknowledgementCountAsync(Guid conversationId) =>
        CountAsync("RealtimeAcknowledgements", "\"ConversationId\" = @id", ("id", conversationId));

    private Task<long> ConversationEventTipAsync(Guid conversationId) => ScalarAsync<long>(
        """SELECT "LastEventSequence" FROM messaging."Conversations" WHERE "Id" = @id""",
        ("id", conversationId));

    private async Task<IReadOnlyList<EventRow>> EventsAsync(Guid conversationId)
    {
        await using var connection = new NpgsqlConnection(RequiredConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT "Id", "EventSequence", "Kind", "MessageId", "MessageSequence", "MessageRevisionNumber"
            FROM messaging."RealtimeEvents" WHERE "ConversationId" = @id ORDER BY "EventSequence"
            """;
        command.Parameters.AddWithValue("id", conversationId);
        var rows = new List<EventRow>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(new EventRow(
                reader.GetGuid(0),
                reader.GetInt64(1),
                reader.GetString(2),
                await reader.IsDBNullAsync(3) ? null : reader.GetGuid(3),
                await reader.IsDBNullAsync(4) ? null : reader.GetInt64(4),
                await reader.IsDBNullAsync(5) ? null : reader.GetInt32(5)));
        }

        return rows;
    }

    private async Task<IReadOnlyList<RecipientRow>> RecipientsAsync(Guid conversationId)
    {
        await using var connection = new NpgsqlConnection(RequiredConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT r."Id", r."RealtimeEventId", r."RecipientUserId", r."Status", r."AttemptCount",
                   r."FailureCode", r."PublishedAtUtc", e."EventSequence"
            FROM messaging."RealtimeRecipients" r
            JOIN messaging."RealtimeEvents" e ON e."Id" = r."RealtimeEventId"
            WHERE r."ConversationId" = @id
            ORDER BY e."EventSequence", r."RecipientUserId"
            """;
        command.Parameters.AddWithValue("id", conversationId);
        var rows = new List<RecipientRow>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(new RecipientRow(
                reader.GetGuid(0),
                reader.GetGuid(1),
                reader.GetGuid(2),
                reader.GetString(3),
                reader.GetInt32(4),
                await reader.IsDBNullAsync(5) ? null : reader.GetString(5),
                await reader.IsDBNullAsync(6) ? null : reader.GetFieldValue<DateTimeOffset>(6),
                reader.GetInt64(7)));
        }

        return rows;
    }

    private async Task<IReadOnlyList<AttemptRow>> AttemptsAsync(Guid recipientId)
    {
        await using var connection = new NpgsqlConnection(RequiredConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT "AttemptNumber", "Outcome", "FailureCode", "ClaimToken"
            FROM messaging."RealtimeAttempts" WHERE "RecipientId" = @id ORDER BY "AttemptNumber"
            """;
        command.Parameters.AddWithValue("id", recipientId);
        var rows = new List<AttemptRow>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(new AttemptRow(
                reader.GetInt32(0),
                reader.GetString(1),
                await reader.IsDBNullAsync(2) ? null : reader.GetString(2),
                reader.GetGuid(3)));
        }

        return rows;
    }

    /// <summary>
    /// Read directly rather than through <c>Convert.ChangeType</c>, which cannot produce a nullable
    /// <see cref="DateTimeOffset"/> and would turn "not acknowledged" into a cast failure.
    /// </summary>
    private async Task<DateTimeOffset?> RealtimeAcknowledgedAtAsync(Guid messageId)
    {
        await using var connection = new NpgsqlConnection(RequiredConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            """SELECT "RealtimeAcknowledgedAtUtc" FROM messaging."Messages" WHERE "Id" = @id""";
        command.Parameters.AddWithValue("id", messageId);
        await using var reader = await command.ExecuteReaderAsync();
        return await reader.ReadAsync() && !await reader.IsDBNullAsync(0)
            ? reader.GetFieldValue<DateTimeOffset>(0)
            : null;
    }

    private Task<long> ReadCursorAsync(Guid conversationId, Guid userId) => ScalarAsync<long>(
        """
        SELECT "LastReadSequence" FROM messaging."ConversationParticipants"
        WHERE "ConversationId" = @conversationId AND "UserId" = @userId
        """,
        ("conversationId", conversationId),
        ("userId", userId));

    /// <summary>
    /// A spent command record that produced no event, for the forgery tests.
    /// </summary>
    /// <remarks>
    /// One event per source mutation is a unique index, so a forged event cannot reuse a command that
    /// already has one — the index would refuse it first and the trigger under test would never run.
    /// A repeated removal is the natural way to produce a command record with no event: it satisfies
    /// the caller, changes nothing, and therefore announces nothing.
    /// </remarks>
    private async Task<Guid> UnusedCommandRecordAsync(Thread thread)
    {
        var message = await SendMessageAsync(thread.Coach, thread.ConversationId, "removed twice");
        await DeleteMessageAsync(thread.Coach, thread.ConversationId, message.Id, message.Version);
        var current = (await GetMessagesAsync(thread.Coach, thread.ConversationId))
            .Items.Single(item => item.Id == message.Id);
        await DeleteMessageAsync(thread.Coach, thread.ConversationId, message.Id, current.Version);

        var unused = await ScalarAsync<Guid>(
            """
            SELECT r."Id" FROM messaging."CommandRecords" r
            LEFT JOIN messaging."RealtimeEvents" e ON e."SourceCommandRecordId" = r."Id"
            WHERE r."ConversationId" = @id AND e."Id" IS NULL
            ORDER BY r."RecordedAtUtc" DESC LIMIT 1
            """,
            ("id", thread.ConversationId));
        Assert.AreNotEqual(Guid.Empty, unused, "A repeated removal must spend a key without emitting an event.");
        return unused;
    }

    /// <summary>Expires a lease by rewinding it, without moving the clock every other test reads.</summary>
    private Task ExpireClaimAsync(Guid recipientId) => ExecuteAsync(
        """
        UPDATE messaging."RealtimeRecipients"
        SET "ClaimExpiresAtUtc" = "ClaimExpiresAtUtc" - interval '1 hour'
        WHERE "Id" = @id
        """,
        ("id", recipientId));

    // ---------- response shapes ----------

    private sealed record Workspace(
        Guid TenantId,
        HttpClient Coach,
        Guid CoachUserId,
        string CoachEmail,
        HttpClient Client,
        Guid ClientProfileId,
        Guid ClientUserId,
        string ClientEmail,
        string Suffix,
        Enrollment? Enrollment = null);

    private sealed record SecondCoach(HttpClient Client, Guid UserId);

    private sealed record Thread(Workspace Workspace, Guid ConversationId)
    {
        public HttpClient Coach => Workspace.Coach;

        public HttpClient Client => Workspace.Client;
    }

    private sealed record EventRow(
        Guid Id,
        long EventSequence,
        string Kind,
        Guid? MessageId,
        long? MessageSequence,
        int? MessageRevisionNumber);

    private sealed record RecipientRow(
        Guid Id,
        Guid RealtimeEventId,
        Guid RecipientUserId,
        string Status,
        int AttemptCount,
        string? FailureCode,
        DateTimeOffset? PublishedAtUtc,
        long EventSequence);

    private sealed record AttemptRow(int AttemptNumber, string Outcome, string? FailureCode, Guid ClaimToken);

    private sealed record Csrf(string Token);

    private sealed record Registration(string? DevelopmentConfirmationUrl);

    private sealed record Membership(Guid TenantId);

    private sealed record CurrentUser(Guid Id, string Email, string DisplayName);

    private sealed record Invitation(string? DevelopmentActionUrl);

    private sealed record Acceptance(Guid TenantId, Guid ClientProfileId, bool SignedIn);

    private sealed record Product(Offer[] Offers);

    private sealed record Offer(Guid Id);

    private sealed record Enrollment(Guid Id, string StoredStatus, DateOnly EndDateExclusive, decimal PriceAmount, uint Version);

    private sealed record CommercialOverview(Enrollment[] Enrollments);

    private sealed record ClientDetails(Guid Id, uint Version);

    private sealed record AccessProblem(string? AccessReason);

    private sealed record CounterpartResponse(Guid UserId, string DisplayName, string Role);

    private sealed record ConversationSummaryResponse(Guid Id, Guid ClientProfileId, CounterpartResponse Counterpart);

    private sealed record ReadStateResponse(long LastReadSequence, long UnreadCount, long LatestSequence);

    private sealed record ConversationDetailResponse(
        ConversationSummaryResponse Conversation,
        ReadStateResponse ReadState);

    private sealed record MessageResponse(
        Guid Id,
        Guid ConversationId,
        long Sequence,
        Guid SenderUserId,
        bool IsFromCaller,
        int RevisionNumber,
        string? Body,
        bool IsDeleted,
        string? DeletionKind,
        string DeliveryState,
        bool IsUnreadByCaller,
        uint Version);

    private sealed record MessagePageResponse(
        Guid ConversationId,
        MessageResponse[] Items,
        long LatestSequence,
        long LatestEventSequence,
        ReadStateResponse ReadState);

    private sealed record RealtimeEventResponse(
        Guid TenantId,
        Guid ConversationId,
        Guid EventId,
        long EventSequence,
        string Kind,
        DateTimeOffset OccurredAtUtc,
        MessageResponse? Message);

    private sealed record RealtimeEventPageResponse(
        Guid ConversationId,
        RealtimeEventResponse[] Items,
        bool HasMore,
        long? NextAfterEventSequence,
        long LatestEventSequence);

    private sealed record AcknowledgementResponse(
        Guid ConversationId,
        int Accepted,
        int AlreadyAcknowledged,
        long LatestEventSequence);
}
