using System.Data.Common;
using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Npgsql;
using TB.Gym.SharedKernel;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Fixture and seams for the Phase 6B-2A persisted-messaging tests.
/// </summary>
/// <remarks>
/// Its own fixture rather than another partial of an existing class: these tests need a deterministic
/// command barrier for the send, create and read-cursor races, a captured log to prove no message
/// content escapes into diagnostics, and direct SQL for the states the HTTP API deliberately cannot
/// produce.
/// <para>
/// Every race here is settled by the barrier, never by a sleep. A race that depends on the scheduler
/// interleaving two tasks is a coin toss that passes on a fast machine and proves nothing.
/// </para>
/// </remarks>
public sealed partial class Phase6B2AMessagingTests
{
    private static readonly string Password = $"Aa1!{Guid.NewGuid():N}";

    /// <summary>A fixed workspace-local morning, well clear of a midnight boundary.</summary>
    private static readonly DateTimeOffset StartInstant = new(2026, 9, 1, 6, 0, 0, TimeSpan.Zero);

    private string? adminConnection;
    private string? databaseName;
    private string? databaseConnection;
    private WebApplicationFactory<Program>? factory;
    private MutableClock? testClock;
    private CapturedLog? log;
    private CommandBarrier? barrier;
    private CommitFault? commitFault;
    private CommandRecorder? recorder;

    public TestContext TestContext { get; set; } = null!;

    [TestInitialize]
    public async Task InitializeAsync()
    {
        adminConnection = PostgreSqlTestEnvironment.RequireAdminConnection();
        databaseName = await PostgreSqlTestEnvironment.CreateDatabaseAsync("tbgym_p6b2a");
        databaseConnection = new NpgsqlConnectionStringBuilder(adminConnection)
        {
            Database = databaseName,
        }.ConnectionString;

        var clock = new MutableClock(StartInstant);
        testClock = clock;
        var capturedLog = new CapturedLog();
        log = capturedLog;
        var commandBarrier = new CommandBarrier();
        barrier = commandBarrier;
        var fault = new CommitFault();
        commitFault = fault;
        var commandRecorder = new CommandRecorder();
        recorder = commandRecorder;

        factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Development");
            var settings = new Dictionary<string, string?>
            {
                ["ConnectionStrings:Database"] = databaseConnection,
                ["Database:ApplyMigrationsOnStartup"] = "true",
                ["Seed:Enabled"] = "false",
                // Phase 6B-2B added an API-hosted realtime sweep. It is switched off here for the same
                // reason the media purge is: a background tick must not race an assertion about what one
                // request did. The realtime rows these commands write are still written.
                ["Messaging:Realtime:Enabled"] = "false",
                ["Application:PublicBaseUrl"] = "http://localhost:4200",
                ["Media:StorageRoot"] = Path.Combine(Path.GetTempPath(), databaseName, "media"),
                // Nothing in this slice runs in the background, and a media tick must not race an
                // assertion about what a request did.
                ["Media:PurgeEnabled"] = "false",
                ["Notifications:Dispatch:PollIntervalSeconds"] = "300",
            };
            // UseSetting as well as the in-memory source: the minimal host reads its configuration
            // while building, before ConfigureAppConfiguration has been applied.
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
                services.AddSingleton(commandBarrier);
                services.AddSingleton(fault);
                services.AddSingleton(commandRecorder);
                services.AddDbContext<TB.Gym.Infrastructure.Persistence.GymDbContext>(
                    (provider, options) => options.AddInterceptors(
                        provider.GetRequiredService<CommandBarrier>(),
                        provider.GetRequiredService<CommitFault>(),
                        provider.GetRequiredService<CommandRecorder>()));
            });
        });
    }

    [TestCleanup]
    public async Task CleanupAsync()
    {
        barrier?.Disarm();
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

    private CommandBarrier Barrier =>
        barrier ?? throw new InvalidOperationException("The command barrier is not initialized.");

    private CommitFault Commits =>
        commitFault ?? throw new InvalidOperationException("The commit fault is not initialized.");

    private CommandRecorder Recorder =>
        recorder ?? throw new InvalidOperationException("The command recorder is not initialized.");

    private HttpClient CreateClient() => RequiredFactory.CreateClient(new WebApplicationFactoryClientOptions
    {
        AllowAutoRedirect = false,
        HandleCookies = true,
        BaseAddress = new Uri("http://localhost"),
    });

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

    /// <summary>Creates a product whose offer includes one coaching feature.</summary>
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
            description = "Phase 6B-2A",
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

    /// <summary>
    /// Pauses or cancels an enrollment, reading its current concurrency token first. Paying in full
    /// activated it, so the token the assignment returned is already stale by the time a test wants
    /// to change its lifecycle.
    /// </summary>
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
                new { reason = "Phase 6B-2A access test.", version = details.Version }),
            HttpStatusCode.OK);
    }

    // ---------- messaging API ----------

    private static Task<HttpResponseMessage> CreateConversationAsync(
        HttpClient coach,
        Guid clientProfileId,
        Guid? idempotencyKey = null) =>
        coach.PostAsJsonAsync(
            "/api/messaging/conversations",
            new { clientProfileId, idempotencyKey = idempotencyKey ?? Guid.NewGuid() });

    private static async Task<ConversationDetailResponse> StartConversationAsync(
        HttpClient coach,
        Guid clientProfileId,
        Guid? idempotencyKey = null)
    {
        await RefreshCsrfAsync(coach);
        var response = await CreateConversationAsync(coach, clientProfileId, idempotencyKey);
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

    private static Task<HttpResponseMessage> PostEditAsync(
        HttpClient caller,
        Guid conversationId,
        Guid messageId,
        string body,
        uint expectedVersion,
        Guid? idempotencyKey = null) =>
        caller.PostAsJsonAsync(
            $"/api/messaging/conversations/{conversationId}/messages/{messageId}/edit",
            new { body, expectedVersion, idempotencyKey = idempotencyKey ?? Guid.NewGuid() });

    private static Task<HttpResponseMessage> PostDeleteAsync(
        HttpClient caller,
        Guid conversationId,
        Guid messageId,
        uint expectedVersion,
        Guid? idempotencyKey = null) =>
        caller.PostAsJsonAsync(
            $"/api/messaging/conversations/{conversationId}/messages/{messageId}/delete",
            new { expectedVersion, idempotencyKey = idempotencyKey ?? Guid.NewGuid() });

    private static Task<HttpResponseMessage> PostModerateAsync(
        HttpClient caller,
        Guid conversationId,
        Guid messageId,
        string reason,
        uint expectedVersion,
        Guid? idempotencyKey = null) =>
        caller.PostAsJsonAsync(
            $"/api/messaging/conversations/{conversationId}/messages/{messageId}/moderate",
            new { reason, expectedVersion, idempotencyKey = idempotencyKey ?? Guid.NewGuid() });

    private static Task<HttpResponseMessage> PostReadAsync(
        HttpClient caller,
        Guid conversationId,
        long throughSequence) =>
        caller.PostAsJsonAsync(
            $"/api/messaging/conversations/{conversationId}/read",
            new { throughSequence });

    private static async Task<ReadStateResponse> AdvanceReadAsync(
        HttpClient caller,
        Guid conversationId,
        long throughSequence)
    {
        await RefreshCsrfAsync(caller);
        var response = await PostReadAsync(caller, conversationId, throughSequence);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<ReadStateResponse>(response);
    }

    private static async Task<ConversationPageResponse> ListConversationsAsync(
        HttpClient caller,
        DateTimeOffset? beforeActivityAtUtc = null,
        Guid? beforeConversationId = null,
        int? take = null)
    {
        var query = new List<string>();
        if (beforeActivityAtUtc is { } activity)
        {
            query.Add($"beforeActivityAtUtc={Uri.EscapeDataString(activity.ToString("O", CultureInfo.InvariantCulture))}");
        }

        if (beforeConversationId is { } cursor)
        {
            query.Add($"beforeConversationId={cursor}");
        }

        if (take is { } size)
        {
            query.Add($"take={size.ToString(CultureInfo.InvariantCulture)}");
        }

        var url = "/api/messaging/conversations" + (query.Count == 0 ? string.Empty : "?" + string.Join('&', query));
        var response = await caller.GetAsync(url);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<ConversationPageResponse>(response);
    }

    private static Task<HttpResponseMessage> GetMessagesResponseAsync(
        HttpClient caller,
        Guid conversationId,
        long? beforeSequence = null,
        int? take = null)
    {
        var query = new List<string>();
        if (beforeSequence is { } cursor)
        {
            query.Add($"beforeSequence={cursor.ToString(CultureInfo.InvariantCulture)}");
        }

        if (take is { } size)
        {
            query.Add($"take={size.ToString(CultureInfo.InvariantCulture)}");
        }

        var url = $"/api/messaging/conversations/{conversationId}/messages"
            + (query.Count == 0 ? string.Empty : "?" + string.Join('&', query));
        return caller.GetAsync(url);
    }

    private static async Task<MessagePageResponse> GetMessagesAsync(
        HttpClient caller,
        Guid conversationId,
        long? beforeSequence = null,
        int? take = null)
    {
        var response = await GetMessagesResponseAsync(caller, conversationId, beforeSequence, take);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<MessagePageResponse>(response);
    }

    private static async Task<long> UnreadCountAsync(HttpClient caller)
    {
        var response = await caller.GetAsync("/api/messaging/unread-count");
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return (await RequiredJsonAsync<UnreadCountResponse>(response)).Unread;
    }

    // ---------- scenarios ----------

    /// <summary>A workspace with a coach, one linked client and a paid Messaging entitlement.</summary>
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

    /// <summary>Assigns and fully pays a Messaging offer starting today, so access is Granted.</summary>
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

    /// <summary>
    /// Registers a second Owner/Coach and gives them an active membership of an existing workspace.
    /// </summary>
    /// <remarks>
    /// The membership row is written directly because Phase 6B-2A ships no endpoint for adding staff
    /// to a workspace. The state is real and reachable in production once such an endpoint exists;
    /// what is being tested is that a second coach who is not a participant is refused, and that
    /// needs a second coach to exist.
    /// </remarks>
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

    /// <summary>
    /// A second signed-in session for the same person, which is what a real duplicate submit looks
    /// like: one user, two tabs or a retried request, not two different accounts.
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
    /// A second client in the same workspace with their own paid Messaging entitlement, so a coach
    /// can hold two reachable conversations at once.
    /// </summary>
    private async Task<ExtraClient> AddEntitledClientAsync(Workspace workspace, string label)
    {
        var extra = await AddClientAsync(workspace, label);
        var offerId = await CreateOfferAsync(workspace.Coach, 120m, 8, $"Messaging {label}");
        var enrollment = await AssignAsync(
            workspace.Coach,
            extra.ClientProfileId,
            offerId,
            TenantToday());
        await PayInFullAsync(workspace.Coach, enrollment);
        return extra;
    }

    /// <summary>Invites and accepts a second client into an existing workspace.</summary>
    private async Task<ExtraClient> AddClientAsync(Workspace workspace, string label)
    {
        var email = $"extra-{label}-{Guid.NewGuid():N}@tbgym.test";
        var session = CreateClient();
        var acceptance = await InviteAndAcceptAsync(workspace.Coach, session, email, "Second", "Client");
        var userId = await CurrentUserIdAsync(session);
        return new ExtraClient(session, acceptance.ClientProfileId, userId, email);
    }

    private DateOnly TenantToday()
    {
        var local = TimeZoneInfo.ConvertTime(
            Clock.UtcNow,
            TimeZoneInfo.FindSystemTimeZoneById("Asia/Beirut"));
        return DateOnly.FromDateTime(local.DateTime);
    }

    /// <summary>
    /// Asserts the captured log carries no message content, no reason, no name and no address. A log
    /// is where sensitive data escapes most quietly.
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

    /// <summary>The stable feature-access reason a 403 carries, so a denial can be asserted exactly.</summary>
    private static async Task<string> AccessReasonAsync(HttpResponseMessage response)
    {
        await AssertStatusAsync(response, HttpStatusCode.Forbidden);
        var problem = await response.Content.ReadFromJsonAsync<AccessProblem>();
        return problem?.AccessReason ?? string.Empty;
    }

    private static async Task<string> ConflictCodeAsync(HttpResponseMessage response)
    {
        await AssertStatusAsync(response, HttpStatusCode.Conflict);
        var problem = await response.Content.ReadFromJsonAsync<ConflictProblem>();
        return problem?.Code ?? string.Empty;
    }

    // ---------- direct SQL, for state the API deliberately does not expose ----------

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

    private Task<long> CountAsync(string table, string where, params (string Name, object Value)[] parameters) =>
        ScalarAsync<long>($"SELECT count(*) FROM messaging.\"{table}\" WHERE {where}", parameters);

    private Task<long> MessageCountAsync(Guid conversationId) =>
        CountAsync("Messages", "\"ConversationId\" = @id", ("id", conversationId));

    private Task<long> RevisionCountAsync(Guid messageId) =>
        CountAsync("MessageRevisions", "\"MessageId\" = @id", ("id", messageId));

    private async Task<IReadOnlyList<long>> CommittedSequencesAsync(Guid conversationId)
    {
        await using var connection = new NpgsqlConnection(RequiredConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT "Sequence" FROM messaging."Messages" WHERE "ConversationId" = @id ORDER BY "Sequence"
            """;
        command.Parameters.AddWithValue("id", conversationId);
        var sequences = new List<long>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            sequences.Add(reader.GetInt64(0));
        }

        return sequences;
    }

    private async Task<IReadOnlyList<string>> RevisionBodiesAsync(Guid messageId)
    {
        await using var connection = new NpgsqlConnection(RequiredConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT "Body" FROM messaging."MessageRevisions" WHERE "MessageId" = @id ORDER BY "RevisionNumber"
            """;
        command.Parameters.AddWithValue("id", messageId);
        var bodies = new List<string>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            bodies.Add(reader.GetString(0));
        }

        return bodies;
    }

    private Task<long> ConversationLastSequenceAsync(Guid conversationId) => ScalarAsync<long>(
        """SELECT "LastSequence" FROM messaging."Conversations" WHERE "Id" = @id""",
        ("id", conversationId));

    private Task<long> ReadCursorAsync(Guid conversationId, Guid userId) => ScalarAsync<long>(
        """
        SELECT "LastReadSequence" FROM messaging."ConversationParticipants"
        WHERE "ConversationId" = @conversationId AND "UserId" = @userId
        """,
        ("conversationId", conversationId),
        ("userId", userId));

    private Task<Guid> AnyMessageIdAsync(Guid conversationId) => ScalarAsync<Guid>(
        """SELECT "Id" FROM messaging."Messages" WHERE "ConversationId" = @id ORDER BY "Sequence" LIMIT 1""",
        ("id", conversationId));

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

    private sealed record ExtraClient(HttpClient Session, Guid ClientProfileId, Guid UserId, string Email);

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

    private sealed record ConflictProblem(string? Code);

    private sealed record CounterpartResponse(Guid UserId, string DisplayName, string Role);

    private sealed record PreviewResponse(
        Guid MessageId,
        long Sequence,
        Guid SenderUserId,
        bool IsFromCaller,
        DateTimeOffset SentAtUtc,
        string? Body,
        bool IsDeleted,
        string? DeletionKind);

    private sealed record ConversationSummaryResponse(
        Guid Id,
        Guid ClientProfileId,
        CounterpartResponse Counterpart,
        string CallerRole,
        bool CanModerate,
        DateTimeOffset StartedAtUtc,
        DateTimeOffset LastActivityAtUtc,
        long LastSequence,
        long UnreadCount,
        long LastReadSequence,
        DateTimeOffset? LastReadAtUtc,
        bool IsAvailable,
        string AccessReason,
        PreviewResponse? LastMessage);

    private sealed record ConversationPageResponse(
        ConversationSummaryResponse[] Items,
        bool HasMore,
        DateTimeOffset? NextBeforeActivityAtUtc,
        Guid? NextBeforeConversationId);

    private sealed record ReadStateResponse(
        Guid ConversationId,
        Guid UserId,
        string Role,
        long LastReadSequence,
        DateTimeOffset? LastReadAtUtc,
        long UnreadCount,
        long LatestSequence);

    private sealed record ConversationDetailResponse(
        ConversationSummaryResponse Conversation,
        ReadStateResponse ReadState);

    private sealed record MessageResponse(
        Guid Id,
        Guid ConversationId,
        long Sequence,
        Guid SenderUserId,
        bool IsFromCaller,
        DateTimeOffset SentAtUtc,
        DateTimeOffset AvailableAtUtc,
        DateTimeOffset? EditedAtUtc,
        int RevisionNumber,
        string? Body,
        bool IsDeleted,
        string? DeletionKind,
        DateTimeOffset? DeletedAtUtc,
        string DeliveryState,
        bool CanEdit,
        bool CanDelete,
        bool CanModerate,
        bool IsUnreadByCaller,
        uint Version);

    private sealed record MessagePageResponse(
        Guid ConversationId,
        MessageResponse[] Items,
        bool HasOlder,
        long? OldestSequence,
        long LatestSequence,
        ReadStateResponse ReadState);

    private sealed record UnreadCountResponse(long Unread);

    // ---------- deterministic seams ----------

    /// <summary>A clock the test moves, so dated access boundaries are asserted without waiting.</summary>
    internal sealed class MutableClock(DateTimeOffset utcNow) : IClock
    {
        private long ticks = utcNow.UtcTicks;

        public DateTimeOffset UtcNow => new(Interlocked.Read(ref ticks), TimeSpan.Zero);

        public void Advance(TimeSpan duration) => Interlocked.Add(ref ticks, duration.Ticks);
    }

    internal sealed class CapturedLog : ILoggerProvider
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

    /// <summary>
    /// Records which tables the application actually asked the database about.
    /// </summary>
    /// <remarks>
    /// Reading a body and then removing it from the response is not the same as never reading it,
    /// and only the wire between the application and PostgreSQL can tell the two apart. This is how
    /// the listing tests prove that an unavailable conversation is refused before its content is
    /// fetched rather than afterwards.
    /// </remarks>
    internal sealed class CommandRecorder : DbCommandInterceptor
    {
        private readonly System.Collections.Concurrent.ConcurrentQueue<string> statements = new();

        public void Clear() => statements.Clear();

        public bool Touched(string fragment) =>
            statements.Any(statement => statement.Contains(fragment, StringComparison.Ordinal));

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command,
            CommandEventData eventData,
            InterceptionResult<DbDataReader> result,
            CancellationToken cancellationToken = default)
        {
            statements.Enqueue(command.CommandText);
            return ValueTask.FromResult(result);
        }

        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
            DbCommand command,
            CommandEventData eventData,
            InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            statements.Enqueue(command.CommandText);
            return ValueTask.FromResult(result);
        }
    }

    /// <summary>
    /// Fails the commit of the next transaction, after every statement inside it has run.
    /// </summary>
    /// <remarks>
    /// Failing an individual statement would prove nothing about atomicity: the later statements
    /// would never have run. Failing the commit is the only way to reach the state where the message,
    /// its first revision, the conversation activity update and the idempotency record have all been
    /// written and the transaction still has to leave none of them behind.
    /// </remarks>
    internal sealed class CommitFault : DbTransactionInterceptor
    {
        private int armed;

        public bool Fired { get; private set; }

        public void ArmOnce() => Interlocked.Exchange(ref armed, 1);

        public void Disarm() => Interlocked.Exchange(ref armed, 0);

        public override ValueTask<InterceptionResult> TransactionCommittingAsync(
            DbTransaction transaction,
            TransactionEventData eventData,
            InterceptionResult result,
            CancellationToken cancellationToken = default)
        {
            if (Interlocked.CompareExchange(ref armed, 0, 1) == 1)
            {
                Fired = true;
                throw new InvalidOperationException("Injected commit failure.");
            }

            return ValueTask.FromResult(result);
        }
    }

    /// <summary>
    /// Holds every command matching a text fragment until a given number of them have arrived, then
    /// releases them together.
    /// </summary>
    /// <remarks>
    /// A race is only a race if both participants reach the contended point before either gets past
    /// it. Starting two requests and hoping the scheduler interleaves them is a coin toss that passes
    /// on a fast machine and proves nothing; this makes the interleaving the test asserts on the one
    /// that actually happens. <see cref="Arrived"/> is asserted by every race test, so a barrier that
    /// silently matched nothing — a renamed table, a changed statement — fails loudly instead of
    /// letting a race test pass without having raced.
    /// </remarks>
    internal sealed class CommandBarrier : DbCommandInterceptor
    {
        private readonly Lock sync = new();
        private readonly List<TaskCompletionSource> arrivals = [];
        private string? fragment;
        private int participants;
        private int arrived;
        private TaskCompletionSource? release;

        public void Arm(string commandFragment, int participantCount)
        {
            lock (sync)
            {
                fragment = commandFragment;
                participants = participantCount;
                arrived = 0;
                arrivals.Clear();
                release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            }
        }

        public int Arrived
        {
            get
            {
                lock (sync)
                {
                    return arrived;
                }
            }
        }

        public void Disarm()
        {
            lock (sync)
            {
                fragment = null;
                release?.TrySetResult();
                release = null;
            }
        }

        /// <summary>Completes once <paramref name="count"/> commands are waiting at the barrier.</summary>
        public Task ArrivedAsync(int count)
        {
            lock (sync)
            {
                while (arrivals.Count < count)
                {
                    arrivals.Add(new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously));
                }

                if (arrived >= count)
                {
                    arrivals[count - 1].TrySetResult();
                }

                return arrivals[count - 1].Task;
            }
        }

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command,
            CommandEventData eventData,
            InterceptionResult<DbDataReader> result,
            CancellationToken cancellationToken = default) =>
            HoldAsync(command, result, cancellationToken);

        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
            DbCommand command,
            CommandEventData eventData,
            InterceptionResult<int> result,
            CancellationToken cancellationToken = default) =>
            HoldAsync(command, result, cancellationToken);

        private async ValueTask<TResult> HoldAsync<TResult>(
            DbCommand command,
            TResult result,
            CancellationToken cancellationToken)
        {
            TaskCompletionSource? gate;
            lock (sync)
            {
                if (fragment is null || !command.CommandText.Contains(fragment, StringComparison.Ordinal))
                {
                    return result;
                }

                arrived++;
                if (arrived <= arrivals.Count)
                {
                    arrivals[arrived - 1].TrySetResult();
                }

                if (arrived >= participants)
                {
                    release!.TrySetResult();
                }

                gate = release;
            }

            if (gate is not null)
            {
                await gate.Task.WaitAsync(cancellationToken);
            }

            return result;
        }
    }
}
