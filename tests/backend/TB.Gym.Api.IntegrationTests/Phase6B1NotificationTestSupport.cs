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
using TB.Gym.Infrastructure.Application;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Notifications;
using TB.Gym.SharedKernel;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Fixture and seams for the Phase 6B-1 dispatch tests.
/// </summary>
/// <remarks>
/// A dedicated fixture rather than another partial file on <c>Phase3TrainingWorkflowTests</c>: these
/// tests need per-test dispatch options (lease, batch size, maximum attempts) and three fault seams
/// that nothing else uses, and the Phase 3 class is already a partial spanning many files whose name
/// no longer describes its contents.
/// </remarks>
public sealed partial class Phase6B1NotificationDispatchTests
{
    private static readonly string Password = $"Aa1!{Guid.NewGuid():N}";

    /// <summary>
    /// A fixed workspace-local morning, so the tenant-today calculations in the eligibility matrix
    /// are the same on every machine and never sit on a midnight boundary.
    /// </summary>
    private static readonly DateTimeOffset StartInstant = new(2026, 8, 31, 6, 0, 0, TimeSpan.Zero);

    private string? adminConnection;
    private string? databaseName;
    private string? databaseConnection;
    private WebApplicationFactory<Program>? factory;
    private MutableClock? testClock;
    private CapturedLog? log;
    private CommandBarrier? barrier;
    private DispatchCheckpointBarrier? checkpointBarrier;
    private DispatchFaults? faults;

    public TestContext TestContext { get; set; } = null!;

    /// <summary>
    /// Per-test dispatch parameters. The retry and max-attempt tests need a shorter schedule or a
    /// smaller batch than production, and the batch-cap test needs a cap it can actually reach.
    /// </summary>
    private int MaximumAttempts => TestContext.TestName switch
    {
        { } name when name.Contains("MaximumAttempts", StringComparison.Ordinal) => 3,
        { } name when name.Contains("MaximumAboveSix", StringComparison.Ordinal) => 8,
        _ => NotificationDispatchOptions.DefaultMaximumAttempts,
    };

    private int BatchSize => TestContext.TestName switch
    {
        { } name when name.Contains("Redistribut", StringComparison.Ordinal) => 5,
        { } name when name.Contains("BatchCap", StringComparison.Ordinal) => 2,
        _ => 25,
    };

    private const int ClaimLeaseSeconds = 120;

    [TestInitialize]
    public async Task InitializeAsync()
    {
        adminConnection = PostgreSqlTestEnvironment.RequireAdminConnection();
        databaseName = await PostgreSqlTestEnvironment.CreateDatabaseAsync("tbgym_p6b1");
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
        var dispatchCheckpointBarrier = new DispatchCheckpointBarrier();
        checkpointBarrier = dispatchCheckpointBarrier;
        var dispatchFaults = new DispatchFaults();
        faults = dispatchFaults;

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
                // The media sweep is irrelevant here and a background tick must not race an
                // assertion about what the notification sweep did.
                ["Media:PurgeEnabled"] = "false",
                // The API composes the dispatcher but hosts no sweep of its own, so every sweep in
                // these tests is one the test asked for.
                ["Notifications:Dispatch:PollIntervalSeconds"] = "1",
                ["Notifications:Dispatch:BatchSize"] =
                    BatchSize.ToString(CultureInfo.InvariantCulture),
                ["Notifications:Dispatch:ClaimLeaseSeconds"] =
                    ClaimLeaseSeconds.ToString(CultureInfo.InvariantCulture),
                ["Notifications:Dispatch:MaximumAttempts"] =
                    MaximumAttempts.ToString(CultureInfo.InvariantCulture),
                // The captured development adapter, which contacts nothing. Enabled for the whole
                // fixture because email is opt-in per member: a test that never opts anybody in gets
                // no email delivery, so this changes nothing for the Phase 6B-1 assertions. Production
                // refuses both of these settings at startup, which its own test asserts.
                ["Notifications:Email:Enabled"] = "true",
                ["Notifications:Email:Adapter"] = "Captured",
            };
            // UseSetting as well as the in-memory source: the minimal host reads its configuration
            // while building, before ConfigureAppConfiguration has been applied, so the connection
            // string has to be there through host settings or the API refuses to start.
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
                services.RemoveAll<INotificationDispatchCheckpoint>();
                services.AddSingleton<INotificationDispatchCheckpoint>(dispatchCheckpointBarrier);
                services.AddSingleton(dispatchFaults);
                // The captured adapter, behind a switch the tests can throw. The wrapper is a test
                // seam only: production composes the captured adapter directly, and outside
                // Development it composes no transport at all.
                services.RemoveAll<INotificationEmailTransport>();
                services.AddSingleton<INotificationEmailTransport>(provider =>
                    new SwitchableEmailTransport(
                        provider.GetRequiredService<CapturedNotificationEmailTransport>(),
                        provider.GetRequiredService<DispatchFaults>()));
                services.AddDbContext<GymDbContext>((provider, options) => options.AddInterceptors(
                    provider.GetRequiredService<CommandBarrier>(),
                    provider.GetRequiredService<DispatchFaults>().Commands,
                    provider.GetRequiredService<DispatchFaults>().Transactions,
                    provider.GetRequiredService<DispatchFaults>().Connections));
            });
        });
    }

    [TestCleanup]
    public async Task CleanupAsync()
    {
        barrier?.Disarm();
        checkpointBarrier?.Disarm();
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

    private DispatchCheckpointBarrier CheckpointBarrier =>
        checkpointBarrier ?? throw new InvalidOperationException("The dispatch checkpoint barrier is not initialized.");

    private DispatchFaults Faults =>
        faults ?? throw new InvalidOperationException("The fault switch is not initialized.");

    private HttpClient CreateClient() => RequiredFactory.CreateClient(new WebApplicationFactoryClientOptions
    {
        AllowAutoRedirect = false,
        HandleCookies = true,
        BaseAddress = new Uri("http://localhost"),
    });

    /// <summary>
    /// Runs one sweep the way a Worker replica would: a fresh scope over the shared container, which
    /// is a separate <c>DbContext</c> and therefore a separate PostgreSQL session.
    /// </summary>
    private async Task<NotificationDispatchOutcome> SweepAsync(CancellationToken cancellationToken = default)
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var service = scope.ServiceProvider.GetRequiredService<INotificationDispatchService>();
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

    private static async Task<Guid> RegisterCoachAsync(
        HttpClient client,
        string email,
        string workspaceName)
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

    // ---------- notification preferences ----------

    private static async Task<PreferenceView> PreferencesAsync(HttpClient client)
    {
        var response = await client.GetAsync("/api/notifications/preferences");
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<PreferenceView>(response);
    }

    private static async Task<HttpResponseMessage> SavePreferencesAsync(
        HttpClient client,
        object body)
    {
        await RefreshCsrfAsync(client);
        return await client.PutAsJsonAsync("/api/notifications/preferences", body);
    }

    /// <summary>Turns service email on for one member, from their own session.</summary>
    private static async Task<PreferenceView> EnableServiceEmailAsync(HttpClient client)
    {
        var current = await PreferencesAsync(client);
        var response = await SavePreferencesAsync(client, new
        {
            emailServiceEnabled = true,
            quietHoursEnabled = current.QuietHoursEnabled,
            quietHoursStartLocal = current.QuietHoursStartLocal,
            quietHoursEndLocal = current.QuietHoursEndLocal,
            idempotencyKey = Guid.NewGuid(),
            version = current.Version,
        });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<PreferenceView>(response);
    }

    /// <summary>Sets a quiet-hours window for one member, from their own session.</summary>
    private static async Task<PreferenceView> SetQuietHoursAsync(
        HttpClient client,
        string startLocal,
        string endLocal)
    {
        var current = await PreferencesAsync(client);
        var response = await SavePreferencesAsync(client, new
        {
            emailServiceEnabled = current.EmailServiceEnabled,
            quietHoursEnabled = true,
            quietHoursStartLocal = startLocal,
            quietHoursEndLocal = endLocal,
            idempotencyKey = Guid.NewGuid(),
            version = current.Version,
        });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<PreferenceView>(response);
    }

    /// <summary>
    /// The in-memory captured adapter. It is the only place a recipient address or a rendered body
    /// exists at all, which is exactly what the persistence and log assertions rely on.
    /// </summary>
    private CapturedNotificationEmailTransport CapturedEmail =>
        RequiredFactory.Services.GetRequiredService<CapturedNotificationEmailTransport>();

    /// <summary>
    /// Invites <paramref name="email"/> and accepts it. Pass <paramref name="newAccount"/> false when
    /// the client is already signed in, which is how the same person joins a second workspace: the
    /// acceptance links the existing account instead of registering another one.
    /// </summary>
    private static async Task<Acceptance> InviteAndAcceptAsync(
        HttpClient coach,
        HttpClient client,
        string email,
        bool newAccount = true)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync("/api/invitations", new
        {
            email,
            firstName = "Notified",
            lastName = "Client",
            phoneNumber = "+96170000000",
            birthDate = "1995-04-02",
        });
        await AssertStatusAsync(response, HttpStatusCode.Created);
        var invitation = await RequiredJsonAsync<Invitation>(response);
        await RefreshCsrfAsync(client);
        var acceptance = await client.PostAsJsonAsync("/api/invitations/accept", new
        {
            token = QueryValue(invitation.DevelopmentActionUrl!, "token"),
            displayName = newAccount ? "Notified Client" : null,
            password = newAccount ? Password : null,
        });
        await AssertStatusAsync(acceptance, HttpStatusCode.OK);
        var accepted = await RequiredJsonAsync<Acceptance>(acceptance);
        SetTenant(client, accepted.TenantId);
        return accepted;
    }

    /// <summary>Creates a product with one offer at the requested price and duration.</summary>
    private static async Task<Guid> CreateOfferAsync(
        HttpClient coach,
        decimal priceAmount,
        int durationWeeks,
        string label,
        string feature = "Training")
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync("/api/commercial/products", new
        {
            name = $"Coaching {label} {Guid.NewGuid():N}",
            description = "Phase 6B-1",
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
        DateOnly startDate,
        Guid? idempotencyKey = null)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync(
            $"/api/commercial/clients/{clientProfileId}/enrollments",
            new { offerId, startDate, idempotencyKey = idempotencyKey ?? Guid.NewGuid() });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<Enrollment>(response);
    }

    private static async Task<Enrollment> RenewAsync(
        HttpClient coach,
        Guid enrollmentId,
        Guid offerId,
        DateOnly startDate)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync(
            $"/api/commercial/enrollments/{enrollmentId}/renew",
            new { offerId, startDate, idempotencyKey = Guid.NewGuid() });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<Enrollment>(response);
    }

    private static async Task PayInFullAsync(HttpClient coach, Enrollment enrollment, decimal amount)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync(
            $"/api/commercial/enrollments/{enrollment.Id}/payments",
            new
            {
                amount,
                currencyCode = "USD",
                receivedAtUtc = StartInstant,
                method = "Cash",
                reference = "receipt-1",
                idempotencyKey = Guid.NewGuid(),
            });
        await AssertStatusAsync(response, HttpStatusCode.OK);
    }

    private static async Task ChangeStatusAsync(
        HttpClient coach,
        Enrollment enrollment,
        string action,
        object body)
    {
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync($"/api/commercial/enrollments/{enrollment.Id}/{action}", body),
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
                new { reason = "Phase 6B-1 eligibility test.", version = details.Version }),
            HttpStatusCode.OK);
    }

    // ---------- Scenario helpers ----------

    /// <summary>
    /// A coach, a workspace and one linked client, all signed in and ready to be notified.
    /// </summary>
    private async Task<Workspace> CreateWorkspaceAsync(string label)
    {
        var suffix = Guid.NewGuid().ToString("N")[..10];
        var coach = CreateClient();
        var tenantId = await RegisterCoachAsync(coach, $"coach-{label}-{suffix}@tbgym.test", $"{label} {suffix}");
        var client = CreateClient();
        var acceptance = await InviteAndAcceptAsync(coach, client, $"client-{label}-{suffix}@tbgym.test");
        var clientUserId = await ScalarAsync<Guid>(
            """SELECT "UserId" FROM clients."ClientProfiles" WHERE "Id" = @id""",
            ("id", acceptance.ClientProfileId));
        return new Workspace(tenantId, coach, client, acceptance.ClientProfileId, clientUserId, suffix);
    }

    /// <summary>Invites and accepts a second client into an existing workspace.</summary>
    private async Task<Guid> AddClientAsync(Workspace workspace, string label)
    {
        var extra = CreateClient();
        var acceptance = await InviteAndAcceptAsync(
            workspace.Coach,
            extra,
            $"extra-{label}-{Guid.NewGuid():N}@tbgym.test");
        extra.Dispose();
        return acceptance.ClientProfileId;
    }

    /// <summary>
    /// Assigns a priced enrollment starting today, so it is PendingPayment and its
    /// <c>PaymentRequired</c> intent is due immediately.
    /// </summary>
    private async Task<Enrollment> AssignPaidLaterAsync(
        Workspace workspace,
        decimal price,
        string feature = "Training")
    {
        var offerId = await CreateOfferAsync(workspace.Coach, price, 8, "8 weeks", feature);
        return await AssignAsync(workspace.Coach, workspace.ClientProfileId, offerId, TenantToday());
    }

    /// <summary>Today in the workspace's own calendar, which is what the commercial API validates against.</summary>
    private DateOnly TenantToday()
    {
        var local = TimeZoneInfo.ConvertTime(
            Clock.UtcNow,
            TimeZoneInfo.FindSystemTimeZoneById("Asia/Beirut"));
        return DateOnly.FromDateTime(local.DateTime);
    }

    private static async Task SetWorkspaceTimeZoneAsync(HttpClient coach, string timeZoneId)
    {
        var workspace = await coach.GetFromJsonAsync<WorkspaceDetails>("/api/workspace")
            ?? throw new AssertFailedException("The workspace response was empty.");
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PutAsJsonAsync("/api/workspace", new
            {
                name = workspace.Name,
                timeZoneId,
                defaultCulture = workspace.DefaultCulture,
                defaultCurrencyCode = workspace.DefaultCurrencyCode,
                weekStartsOn = workspace.WeekStartsOn,
                version = workspace.Version,
            }),
            HttpStatusCode.OK);
    }

    /// <summary>
    /// Returns a terminal in-app delivery, and its intent, to a schedulable state.
    /// </summary>
    /// <remarks>
    /// Used only to reproduce an interleaving the HTTP API cannot produce on its own: a due item whose
    /// underlying commercial state has already moved, so the dispatcher's own recheck is what the test
    /// is about. The Phase 6B-3A guard refuses to mutate a terminal delivery — which is the point of
    /// the guard — so the fixture disables it for the duration of this one write and restores it
    /// immediately. The protection itself is asserted separately, by direct SQL, in
    /// <c>Phase6B3ANotificationChannelTests</c>.
    /// </remarks>
    private Task RestoreToPendingAsync(Guid outboxItemId) => WithoutNotificationGuardsAsync(
        """
        UPDATE notifications."ChannelDeliveries"
        SET "Status" = 'Pending', "FailureCode" = NULL, "CompletedAtUtc" = NULL,
            "MaterializedAtUtc" = NULL, "DeadLetteredAtUtc" = NULL
        WHERE "OutboxItemId" = @id;
        UPDATE notifications."OutboxItems"
        SET "Status" = 'Scheduled', "CancelledAtUtc" = NULL
        WHERE "Id" = @id;
        """,
        ("id", outboxItemId));

    /// <summary>
    /// Runs one fixture write with the immutable intent and terminal-delivery guards off, restoring
    /// both afterwards.
    /// </summary>
    /// <remarks>
    /// Three separate statements rather than one: a deferred constraint trigger leaves pending events
    /// until its transaction ends, and PostgreSQL refuses to <c>ALTER TABLE</c> a relation that has
    /// any. Each call is therefore its own transaction, and the guard is back on before anything the
    /// test asserts runs.
    /// </remarks>
    private async Task WithoutNotificationGuardsAsync(string sql, params (string Name, object Value)[] parameters)
    {
        await ExecuteAsync(
            """ALTER TABLE notifications."ChannelDeliveries" DISABLE TRIGGER protect_channel_delivery""");
        try
        {
            await ExecuteAsync(
                """ALTER TABLE notifications."OutboxItems" DISABLE TRIGGER protect_notification_intent""");
            try
            {
                await ExecuteAsync(sql, parameters);
            }
            finally
            {
                await ExecuteAsync(
                    """ALTER TABLE notifications."OutboxItems" ENABLE TRIGGER protect_notification_intent""");
            }
        }
        finally
        {
            await ExecuteAsync(
                """ALTER TABLE notifications."ChannelDeliveries" ENABLE TRIGGER protect_channel_delivery""");
        }
    }

    /// <summary>
    /// Corrupts an immutable payload for the unreadable-payload fixture, then immediately restores the
    /// production immutability trigger. The trigger itself is covered by direct-SQL tests.
    /// </summary>
    private async Task WithoutIntentGuardAsync(string sql, params (string Name, object Value)[] parameters)
    {
        await ExecuteAsync(
            """ALTER TABLE notifications."OutboxItems" DISABLE TRIGGER protect_notification_intent""");
        try
        {
            await ExecuteAsync(sql, parameters);
        }
        finally
        {
            await ExecuteAsync(
                """ALTER TABLE notifications."OutboxItems" ENABLE TRIGGER protect_notification_intent""");
        }
    }

    /// <summary>
    /// Builds a fresh workspace with one due intent, applies <paramref name="breakEligibility"/>, and
    /// asserts the sweep suppressed the item with <paramref name="expectedCode"/> at no cost in
    /// delivery attempts.
    /// </summary>
    private async Task AssertSuppressedAsync(
        string label,
        string expectedCode,
        Func<Enrollment, Workspace, Task> breakEligibility)
    {
        var workspace = await CreateWorkspaceAsync(label);
        var enrollment = await AssignPaidLaterAsync(workspace, 120m);
        var intent = await IntentIdAsync(enrollment.Id, CommercialNotificationKind.PaymentRequired);

        await breakEligibility(enrollment, workspace);

        var outcome = await SweepAsync();
        Assert.AreEqual(1, outcome.Suppressed, $"{label}: the item should have been suppressed.");
        Assert.AreEqual(0, outcome.Materialized, $"{label}: nothing should have been delivered.");
        await AssertSuppressedWithAsync(intent, expectedCode);
        Assert.AreEqual(0L, await AttemptCountAsync(intent), $"{label}: suppression costs no delivery attempt.");
    }

    /// <summary>
    /// Holds a real committed claim, changes authoritative state on another connection, then proves
    /// the materialization transaction rechecks before it durably starts an attempt.
    /// </summary>
    private async Task AssertPostClaimSuppressedAsync(
        string label,
        string expectedCode,
        Func<Enrollment, Workspace, Task> changeAuthoritativeState)
    {
        var workspace = await CreateWorkspaceAsync(label);
        var enrollment = await AssignPaidLaterAsync(workspace, 120m);
        var intent = await IntentIdAsync(enrollment.Id, CommercialNotificationKind.PaymentRequired);

        CheckpointBarrier.Arm(intent);
        var sweep = SweepAsync();
        await CheckpointBarrier.ArrivedAsync().WaitAsync(TimeSpan.FromSeconds(30));
        try
        {
            var held = await OutboxAsync(intent);
            Assert.AreEqual("Processing", held.Status, $"{label}: the barrier must be after claim commit.");
            Assert.AreEqual(0, held.AttemptCount, $"{label}: a claim reservation is not an attempt.");
            Assert.IsEmpty(await AttemptsAsync(intent));

            await changeAuthoritativeState(enrollment, workspace);
        }
        finally
        {
            CheckpointBarrier.Release();
        }

        var outcome = await sweep.WaitAsync(TimeSpan.FromSeconds(30));
        CheckpointBarrier.Disarm();

        Assert.AreEqual(1, outcome.Claimed);
        Assert.AreEqual(1, outcome.Suppressed);
        Assert.AreEqual(0, outcome.Materialized);
        await AssertSuppressedWithAsync(intent, expectedCode);
        var attempts = await AttemptsAsync(intent);
        Assert.HasCount(1, attempts);
        Assert.AreEqual("Suppressed", attempts[0].Outcome);
        Assert.AreEqual(expectedCode, attempts[0].FailureCode);
    }

    private async Task AssertSuppressedWithAsync(Guid outboxItemId, string expectedCode)
    {
        var row = await OutboxAsync(outboxItemId);
        Assert.AreEqual("Suppressed", row.Status);
        Assert.AreEqual(expectedCode, row.FailureCode);
        Assert.IsNull(row.DeadLetteredAtUtc, "Suppression is not a dead letter.");
        Assert.IsFalse(row.HasClaim);
        Assert.AreEqual(0L, await NotificationCountAsync(outboxItemId));
    }

    /// <summary>
    /// Asserts the captured log carries identifiers and codes only. A log is where sensitive data
    /// escapes most quietly, so this checks for the recipient, the rendered wording and the payload.
    /// </summary>
    private void AssertLogIsSafe(Workspace workspace, params string[] extraForbidden)
    {
        var text = Log.Text;
        foreach (var term in extraForbidden)
        {
            Assert.DoesNotContain(term, text, $"'{term}' reached the log.");
        }

        Assert.DoesNotContain($"client-", text, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("@tbgym.test", text, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(workspace.Suffix, text, StringComparison.OrdinalIgnoreCase);
        foreach (var template in NotificationTemplateCatalog.Published)
        {
            Assert.DoesNotContain(template.Body, text);
        }

        Assert.DoesNotContain("PayloadJson", text, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Waits for a condition a background timer will eventually satisfy, with a bounded timeout so a
    /// worker that never recovers fails the test instead of hanging the run. Used only where the
    /// thing under test is a real timer loop; every race assertion uses the deterministic barrier.
    /// </summary>
    private static async Task WaitForAsync(Func<Task<bool>> condition, string description)
    {
        var deadline = DateTime.UtcNow.AddSeconds(30);
        while (DateTime.UtcNow < deadline)
        {
            if (await condition())
            {
                return;
            }

            await Task.Delay(100);
        }

        Assert.Fail($"Timed out waiting for {description}.");
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

    // ---------- Direct SQL, for state the API deliberately does not expose ----------

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

    /// <summary>
    /// The in-app delivery's status for an intent.
    /// </summary>
    /// <remarks>
    /// Phase 6B-3A moved the dispatch lifecycle from the intent onto one row per channel, so every
    /// helper here reads the in-app delivery by default. The vocabulary moved with it: what the outbox
    /// once called <c>Dispatched</c> is now the delivery being <c>Materialized</c>, and what it called
    /// <c>Cancelled</c> is the delivery being <c>Suppressed</c>.
    /// </remarks>
    private Task<string> OutboxStatusAsync(Guid outboxItemId) => DeliveryStatusAsync(outboxItemId);

    private Task<string> DeliveryStatusAsync(
        Guid outboxItemId,
        NotificationChannel channel = NotificationChannel.InApp) => ScalarAsync<string>(
        """
        SELECT "Status" FROM notifications."ChannelDeliveries"
        WHERE "OutboxItemId" = @id AND "Channel" = @channel
        """,
        ("id", outboxItemId),
        ("channel", channel.ToString()));

    private Task<string> IntentStatusAsync(Guid outboxItemId) => ScalarAsync<string>(
        """SELECT "Status" FROM notifications."OutboxItems" WHERE "Id" = @id""",
        ("id", outboxItemId));

    private Task<long> NotificationCountAsync(Guid outboxItemId) => ScalarAsync<long>(
        """SELECT count(*) FROM notifications."Notifications" WHERE "SourceOutboxItemId" = @id""",
        ("id", outboxItemId));

    private Task<long> AttemptCountAsync(
        Guid outboxItemId,
        NotificationChannel channel = NotificationChannel.InApp) => ScalarAsync<long>(
        """
        SELECT count(*) FROM notifications."DeliveryAttempts" a
        JOIN notifications."ChannelDeliveries" d ON d."Id" = a."ChannelDeliveryId"
        WHERE d."OutboxItemId" = @id AND d."Channel" = @channel
        """,
        ("id", outboxItemId),
        ("channel", channel.ToString()));

    private Task<long> ChannelDeliveryCountAsync(Guid outboxItemId) => ScalarAsync<long>(
        """SELECT count(*) FROM notifications."ChannelDeliveries" WHERE "OutboxItemId" = @id""",
        ("id", outboxItemId));

    private async Task<IReadOnlyList<AttemptRow>> AttemptsAsync(
        Guid outboxItemId,
        NotificationChannel channel = NotificationChannel.InApp)
    {
        await using var connection = new NpgsqlConnection(RequiredConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT a."AttemptNumber", a."Outcome", a."FailureCode", a."IdempotencyKey", a."ProviderMessageId"
            FROM notifications."DeliveryAttempts" a
            JOIN notifications."ChannelDeliveries" d ON d."Id" = a."ChannelDeliveryId"
            WHERE d."OutboxItemId" = @id AND d."Channel" = @channel
            ORDER BY a."AttemptNumber"
            """;
        command.Parameters.AddWithValue("id", outboxItemId);
        command.Parameters.AddWithValue("channel", channel.ToString());
        var rows = new List<AttemptRow>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(new AttemptRow(
                reader.GetInt32(0),
                reader.GetString(1),
                reader.IsDBNull(2) ? null : reader.GetString(2),
                reader.GetString(3),
                reader.IsDBNull(4) ? null : reader.GetString(4)));
        }

        return rows;
    }

    private Task<OutboxRow> OutboxAsync(Guid outboxItemId) => DeliveryAsync(outboxItemId);

    private async Task<OutboxRow> DeliveryAsync(
        Guid outboxItemId,
        NotificationChannel channel = NotificationChannel.InApp)
    {
        await using var connection = new NpgsqlConnection(RequiredConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT d."Status", d."AttemptCount", d."NextAttemptAtUtc", o."ScheduledAtUtc", d."FailureCode",
                   d."ClaimToken" IS NOT NULL, d."MaterializedAtUtc", d."DeadLetteredAtUtc",
                   d."DeferralCount", d."DeferredUntilUtc", d."DeferralCode", d."TransportAdapter",
                   d."ProviderMessageId", d."ProviderAcceptedAtUtc", d."SelectionReason", d."Purpose"
            FROM notifications."ChannelDeliveries" d
            JOIN notifications."OutboxItems" o ON o."Id" = d."OutboxItemId"
            WHERE d."OutboxItemId" = @id AND d."Channel" = @channel
            """;
        command.Parameters.AddWithValue("id", outboxItemId);
        command.Parameters.AddWithValue("channel", channel.ToString());
        await using var reader = await command.ExecuteReaderAsync();
        Assert.IsTrue(await reader.ReadAsync(), $"The {channel} delivery was not found.");
        return new OutboxRow(
            reader.GetString(0),
            reader.GetInt32(1),
            reader.GetFieldValue<DateTimeOffset>(2),
            reader.GetFieldValue<DateTimeOffset>(3),
            reader.IsDBNull(4) ? null : reader.GetString(4),
            reader.GetBoolean(5),
            reader.IsDBNull(6) ? null : reader.GetFieldValue<DateTimeOffset>(6),
            reader.IsDBNull(7) ? null : reader.GetFieldValue<DateTimeOffset>(7),
            reader.GetInt32(8),
            reader.IsDBNull(9) ? null : reader.GetFieldValue<DateTimeOffset>(9),
            reader.IsDBNull(10) ? null : reader.GetString(10),
            reader.IsDBNull(11) ? null : reader.GetString(11),
            reader.IsDBNull(12) ? null : reader.GetString(12),
            reader.IsDBNull(13) ? null : reader.GetFieldValue<DateTimeOffset>(13),
            reader.GetString(14),
            reader.GetString(15));
    }

    /// <summary>The outbox intents an enrollment produced, oldest first.</summary>
    private async Task<IReadOnlyList<IntentRow>> IntentsAsync(Guid enrollmentId)
    {
        await using var connection = new NpgsqlConnection(RequiredConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT "Id", "Kind", "Status", "DeduplicationKey", "ScheduledAtUtc"
            FROM notifications."OutboxItems"
            WHERE "AggregateId" = @id
            ORDER BY "ScheduledAtUtc", "Id"
            """;
        command.Parameters.AddWithValue("id", enrollmentId);
        var rows = new List<IntentRow>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(new IntentRow(
                reader.GetGuid(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetString(3),
                reader.GetFieldValue<DateTimeOffset>(4)));
        }

        return rows;
    }

    private async Task<Guid> IntentIdAsync(Guid enrollmentId, CommercialNotificationKind kind)
    {
        var intents = await IntentsAsync(enrollmentId);
        var match = intents.SingleOrDefault(intent => intent.Kind == kind.ToString());
        Assert.IsNotNull(match, $"No {kind} intent exists for enrollment {enrollmentId}.");
        return match.Id;
    }

    /// <summary>One workspace under test: its coach, its client, and the identifiers behind them.</summary>
    private sealed record Workspace(
        Guid TenantId,
        HttpClient Coach,
        HttpClient Client,
        Guid ClientProfileId,
        Guid ClientUserId,
        string Suffix);

    private sealed record ClientDetails(Guid Id, uint Version);

    private sealed record WorkspaceDetails(
        Guid Id,
        string Name,
        string TimeZoneId,
        string DefaultCulture,
        string DefaultCurrencyCode,
        string WeekStartsOn,
        uint Version);

    private sealed record Csrf(string Token);

    private sealed record Registration(string? DevelopmentConfirmationUrl);

    private sealed record Membership(Guid TenantId);

    private sealed record Invitation(string? DevelopmentActionUrl);

    private sealed record Acceptance(Guid TenantId, Guid ClientProfileId, bool SignedIn);

    private sealed record Product(Offer[] Offers);

    private sealed record Offer(Guid Id);

    private sealed record Enrollment(Guid Id, string StoredStatus, DateOnly EndDateExclusive, decimal PriceAmount, uint Version);

    private sealed record NotificationItem(
        Guid Id,
        string Kind,
        string Title,
        string Body,
        DateTimeOffset CreatedAtUtc,
        DateTimeOffset? ReadAtUtc,
        bool IsRead,
        uint Version);

    private sealed record NotificationPageResponse(long Total, long UnreadTotal, NotificationItem[] Items);

    private sealed record UnreadCount(long Unread);

    private sealed record DeadLetterItem(
        Guid OutboxItemId,
        string Kind,
        DateTimeOffset ScheduledAtUtc,
        int AttemptCount,
        DateTimeOffset? DeadLetteredAtUtc,
        string? FailureCode);

    private sealed record DeadLetterPageResponse(long Total, DeadLetterItem[] Items);

    private sealed record AttemptRow(
        int AttemptNumber,
        string Outcome,
        string? FailureCode,
        string IdempotencyKey,
        string? ProviderMessageId);

    /// <summary>
    /// One channel delivery, in the shape the Phase 6B-1 assertions were written against plus the
    /// deferral, transport and selection facts Phase 6B-3A added.
    /// </summary>
    private sealed record OutboxRow(
        string Status,
        int AttemptCount,
        DateTimeOffset NextAttemptAtUtc,
        DateTimeOffset ScheduledAtUtc,
        string? FailureCode,
        bool HasClaim,
        DateTimeOffset? MaterializedAtUtc,
        DateTimeOffset? DeadLetteredAtUtc,
        int DeferralCount = 0,
        DateTimeOffset? DeferredUntilUtc = null,
        string? DeferralCode = null,
        string? TransportAdapter = null,
        string? ProviderMessageId = null,
        DateTimeOffset? ProviderAcceptedAtUtc = null,
        string SelectionReason = "",
        string Purpose = "");

    private sealed record IntentRow(
        Guid Id,
        string Kind,
        string Status,
        string DeduplicationKey,
        DateTimeOffset ScheduledAtUtc);

    private sealed record PreferenceView(
        bool InAppEnabled,
        bool EmailServiceEnabled,
        bool EmailMarketingEnabled,
        bool EmailChannelAvailable,
        bool QuietHoursEnabled,
        string? QuietHoursStartLocal,
        string? QuietHoursEndLocal,
        string TenantTimeZoneId,
        int PolicyVersion,
        uint Version);

    /// <summary>
    /// The captured adapter with a refusal switch in front of it.
    /// </summary>
    /// <remarks>
    /// A transport that never fails proves nothing about a channel whose whole point is that it fails
    /// independently, and there is no real provider to fail. This wraps the real captured adapter
    /// rather than replacing it, so a test can prove that a refused send captured nothing.
    /// </remarks>
    internal sealed class SwitchableEmailTransport(
        CapturedNotificationEmailTransport captured,
        DispatchFaults faults)
        : INotificationEmailTransport
    {
        public string AdapterName => captured.AdapterName;

        public Task<NotificationEmailTransportResult> SendAsync(
            NotificationEmailMessage message,
            CancellationToken cancellationToken) =>
            faults.FailEmailTransport
                ? Task.FromResult(NotificationEmailTransportResult.TransientFailure(
                    NotificationFailureCodes.EmailTransportTransient))
                : captured.SendAsync(message, cancellationToken);
    }

    /// <summary>A clock the test moves, so the retry schedule is asserted without waiting for it.</summary>
    internal sealed class MutableClock(DateTimeOffset utcNow) : IClock
    {
        private long ticks = utcNow.UtcTicks;

        public DateTimeOffset UtcNow => new(Interlocked.Read(ref ticks), TimeSpan.Zero);

        public void Advance(TimeSpan duration) =>
            Interlocked.Add(ref ticks, duration.Ticks);

        public void Set(DateTimeOffset value) =>
            Interlocked.Exchange(ref ticks, value.UtcTicks);
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
    /// Holds every command matching a text fragment until a given number of them have arrived, then
    /// releases them together.
    /// </summary>
    /// <remarks>
    /// A race is only a race if both participants reach the contended point before either one gets
    /// past it. Starting two sweeps and hoping the scheduler interleaves them is a coin toss that
    /// passes on a fast machine and proves nothing; this makes the interleaving the test asserts on
    /// the one that actually happens.
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

        /// <summary>
        /// How many commands the barrier actually held. Asserted by the race tests, so a barrier that
        /// silently matched nothing — a renamed table, a changed statement shape — fails loudly
        /// instead of letting a race test pass without ever having raced.
        /// </summary>
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

        public void Release()
        {
            lock (sync)
            {
                release?.TrySetResult();
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

            // Bounded, so a barrier that is never satisfied fails the test instead of hanging the run
            // on a held database connection.
            await gate!.Task.WaitAsync(TimeSpan.FromSeconds(30), cancellationToken);
            return result;
        }
    }

    /// <summary>
    /// Holds one exact outbox item after its claim transaction committed and before materialization.
    /// A second claimant for the same item deliberately passes through, which lets the stale-worker
    /// test prove the newer worker can reclaim and complete while the original is still paused.
    /// </summary>
    internal sealed class DispatchCheckpointBarrier : INotificationDispatchCheckpoint
    {
        private readonly Lock sync = new();
        private Guid? outboxItemId;
        private bool held;
        private TaskCompletionSource? arrived;
        private TaskCompletionSource? release;

        public void Arm(Guid targetOutboxItemId)
        {
            lock (sync)
            {
                outboxItemId = targetOutboxItemId;
                held = false;
                arrived = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
                release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            }
        }

        public Task ArrivedAsync()
        {
            lock (sync)
            {
                return arrived?.Task
                    ?? throw new InvalidOperationException("The dispatch checkpoint barrier is not armed.");
            }
        }

        public void Release()
        {
            lock (sync)
            {
                release?.TrySetResult();
            }
        }

        public void Disarm()
        {
            lock (sync)
            {
                outboxItemId = null;
                release?.TrySetResult();
                arrived = null;
                release = null;
                held = false;
            }
        }

        public async Task AfterClaimCommittedAsync(
            Guid tenantId,
            Guid candidateOutboxItemId,
            Guid claimToken,
            CancellationToken cancellationToken)
        {
            Task? gate = null;
            lock (sync)
            {
                if (!held && outboxItemId == candidateOutboxItemId)
                {
                    held = true;
                    arrived!.TrySetResult();
                    gate = release!.Task;
                }
            }

            if (gate is not null)
            {
                await gate.WaitAsync(TimeSpan.FromSeconds(30), cancellationToken);
            }
        }
    }

    /// <summary>
    /// Three fault seams, all outside production code: a commit that fails after the notification was
    /// written, and a connection that cannot be opened at all.
    /// </summary>
    internal sealed class DispatchFaults
    {
        public DispatchFaults()
        {
            Commands = new CommandWatcher(this);
            Transactions = new TransactionFault(this);
            Connections = new ConnectionFault(this);
        }

        public CommandWatcher Commands { get; }

        public TransactionFault Transactions { get; }

        public ConnectionFault Connections { get; }

        /// <summary>
        /// Fails the commit of the transaction that just inserted a notification row, the way a lost
        /// connection would: recoverable, so the dispatcher records it as a transient failure.
        /// </summary>
        public bool FailMaterializationCommit { get; set; }

        /// <summary>
        /// Kills the same commit the way host shutdown would: cancellation, which the dispatcher
        /// deliberately does not classify as a delivery failure. The sweep unwinds with the claim
        /// still held and the attempt still Started, which is exactly what a killed process leaves.
        /// </summary>
        public bool CrashDuringMaterialization { get; set; }

        /// <summary>Refuses every connection, standing in for a database that is not there.</summary>
        public bool DatabaseUnavailable { get; set; }

        /// <summary>
        /// Makes the email transport refuse in a way that may work later. The only fault seam that
        /// reaches the email channel, and it deliberately cannot touch in-app: an email failure that
        /// took the inbox row with it is exactly the coupling this phase removed.
        /// </summary>
        public bool FailEmailTransport { get; set; }

        public int RefusedConnections => Volatile.Read(ref refusedConnections);

        private readonly System.Collections.Concurrent.ConcurrentDictionary<DbTransaction, byte> armedTransactions = new();
        private int refusedConnections;

        internal void ArmTransaction(DbTransaction? transaction)
        {
            if ((FailMaterializationCommit || CrashDuringMaterialization) && transaction is not null)
            {
                armedTransactions[transaction] = 0;
            }
        }

        internal Exception? CommitFault(DbTransaction transaction) =>
            armedTransactions.TryRemove(transaction, out _)
                ? CrashDuringMaterialization
                    ? new OperationCanceledException("The host stopped while the notification was committing.")
                    : new NpgsqlException("The connection was lost while committing.")
                : null;

        internal void RecordRefusedConnection() => Interlocked.Increment(ref refusedConnections);

        internal sealed class CommandWatcher(DispatchFaults owner) : DbCommandInterceptor
        {
            public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
                DbCommand command,
                CommandEventData eventData,
                InterceptionResult<int> result,
                CancellationToken cancellationToken = default)
            {
                Watch(command);
                return ValueTask.FromResult(result);
            }

            public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
                DbCommand command,
                CommandEventData eventData,
                InterceptionResult<DbDataReader> result,
                CancellationToken cancellationToken = default)
            {
                Watch(command);
                return ValueTask.FromResult(result);
            }

            private void Watch(DbCommand command)
            {
                if (command.CommandText.Contains(
                        "INSERT INTO notifications.\"Notifications\"",
                        StringComparison.Ordinal))
                {
                    owner.ArmTransaction(command.Transaction);
                }
            }
        }

        internal sealed class TransactionFault(DispatchFaults owner) : DbTransactionInterceptor
        {
            public override ValueTask<InterceptionResult> TransactionCommittingAsync(
                DbTransaction transaction,
                TransactionEventData eventData,
                InterceptionResult result,
                CancellationToken cancellationToken = default)
            {
                // Failing at the commit rather than at a statement is what makes the assertion mean
                // something: the insert and both updates have already run inside the transaction, so
                // if any of the three survives, they were not atomic.
                var fault = owner.CommitFault(transaction);
                return fault is null ? ValueTask.FromResult(result) : throw fault;
            }
        }

        internal sealed class ConnectionFault(DispatchFaults owner) : DbConnectionInterceptor
        {
            public override ValueTask<InterceptionResult> ConnectionOpeningAsync(
                DbConnection connection,
                ConnectionEventData eventData,
                InterceptionResult result,
                CancellationToken cancellationToken = default)
            {
                if (owner.DatabaseUnavailable)
                {
                    owner.RecordRefusedConnection();
                    throw new NpgsqlException("The database is not available.");
                }

                return ValueTask.FromResult(result);
            }
        }
    }
}
