using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Npgsql;
using TB.Gym.Infrastructure.Application;
using TB.Gym.Infrastructure.Initialization;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Website;
using TB.Gym.SharedKernel;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Audit batch A1, an honest test copy: a deployment with email off says so wherever an answer would
/// have promised an email (LOST-1); a Talk-to-us request waits for email instead of being
/// dead-lettered, and the platform admin reads it meanwhile (BEB-1); and the bill names TB Gym's
/// contacts while no Whish number is set (BILL-2).
/// </summary>
/// <remarks>
/// "Email off" is a Production deployment with no provider, which composes no action-mail transport
/// (the Render test copy). A Development host always composes the capture adapter, so these tests
/// remove it, which is exactly the composition such a deployment has.
/// </remarks>
[TestClass]
public sealed class A1HonestTestCopyTests
{
    private const string ContactRequestsPath = "/api/platform-admin/contact-requests";

    private static readonly string Password = $"Aa1!{Guid.NewGuid():N}";

    /// <summary>A Beirut morning, well away from midnight.</summary>
    private static readonly DateTimeOffset StartInstant = new(2026, 10, 19, 6, 0, 0, TimeSpan.Zero);

    private string? adminConnection;
    private string? databaseName;
    private string? databaseConnection;
    private WebApplicationFactory<Program>? factory;
    private MutableClock? clock;
    private CapturedLog? log;

    public TestContext TestContext { get; set; } = null!;

    private enum Mail
    {
        /// <summary>No transport at all: a Production deployment with email off.</summary>
        Off,

        /// <summary>The development capture adapter: email "goes out" into memory.</summary>
        Captured,

        /// <summary>A configured provider with a support inbox, which nothing here ever calls.</summary>
        Provider,
    }

    [TestInitialize]
    public async Task InitializeAsync()
    {
        adminConnection = PostgreSqlTestEnvironment.RequireAdminConnection();
        databaseName = await PostgreSqlTestEnvironment.CreateMigratedDatabaseAsync("tbgym_a1");
        databaseConnection = new NpgsqlConnectionStringBuilder(adminConnection) { Database = databaseName }.ConnectionString;
    }

    [TestCleanup]
    public async Task CleanupAsync()
    {
        factory?.Dispose();
        NpgsqlConnection.ClearAllPools();
        if (databaseName is null || adminConnection is null)
        {
            return;
        }

        await using var connection = new NpgsqlConnection(adminConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = $"DROP DATABASE IF EXISTS \"{databaseName}\" WITH (FORCE)";
        await command.ExecuteNonQueryAsync();
    }

    [TestMethod]
    public async Task AnEmailOffDeploymentSaysSoWhereverItWouldHavePromisedAnEmail()
    {
        Start(Mail.Off);
        using var visitor = CreateClient();

        // Before anyone acts: the status every signed-in screen reads.
        var status = await visitor.GetFromJsonAsync<JsonElement>("/api/system/status", TestContext.CancellationToken);
        Assert.IsFalse(status.GetProperty("emailAvailable").GetBoolean());

        // Registration still creates the account, and its answer says no confirmation link is coming.
        var registration = await RegisterAsync(visitor, "a1-off@example.test", "A1 Off Gym");
        Assert.AreEqual(HttpStatusCode.Accepted, registration.StatusCode, await registration.Content.ReadAsStringAsync());
        var registered = await registration.Content.ReadFromJsonAsync<JsonElement>(TestContext.CancellationToken);
        Assert.AreEqual("a1-off@example.test", registered.GetProperty("email").GetString());
        Assert.AreEqual(JsonValueKind.Null, registered.GetProperty("developmentConfirmationUrl").ValueKind);
        Assert.IsFalse(registered.GetProperty("emailAvailable").GetBoolean());

        // Password recovery answers alike for an unknown, an unconfirmed and a confirmed address: that
        // email is off describes the deployment, never the account.
        using var confirmedClient = CreateClient();
        Assert.AreEqual(HttpStatusCode.Accepted, (await RegisterAsync(confirmedClient, "a1-confirmed@example.test", "A1 Confirmed Gym")).StatusCode);
        await ConfirmAsync("a1-confirmed@example.test");

        var answers = new List<string>();
        foreach (var email in new[] { "nobody@example.test", "a1-off@example.test", "a1-confirmed@example.test" })
        {
            var response = await ForgotPasswordAsync(visitor, email);
            Assert.AreEqual(HttpStatusCode.Accepted, response.StatusCode);
            answers.Add(await response.Content.ReadAsStringAsync(TestContext.CancellationToken));
        }

        Assert.HasCount(1, answers.Distinct(), "Every address must get the same answer.");
        var answer = JsonDocument.Parse(answers[0]).RootElement;
        Assert.IsFalse(answer.GetProperty("emailAvailable").GetBoolean());
        Assert.AreEqual(
            "Email is off on this server, so no reset instructions can be sent.",
            answer.GetProperty("message").GetString());
        Assert.AreEqual(JsonValueKind.Null, answer.GetProperty("developmentActionUrl").ValueKind);
    }

    [TestMethod]
    public async Task ADeploymentThatSendsEmailSaysSoInTheSameAnswers()
    {
        Start(Mail.Captured);
        using var visitor = CreateClient();

        var status = await visitor.GetFromJsonAsync<JsonElement>("/api/system/status", TestContext.CancellationToken);
        Assert.IsTrue(status.GetProperty("emailAvailable").GetBoolean());

        var registration = await RegisterAsync(visitor, "a1-on@example.test", "A1 On Gym");
        Assert.AreEqual(HttpStatusCode.Accepted, registration.StatusCode);
        var registered = await registration.Content.ReadFromJsonAsync<JsonElement>(TestContext.CancellationToken);
        Assert.IsTrue(registered.GetProperty("emailAvailable").GetBoolean());
        Assert.IsFalse(string.IsNullOrEmpty(registered.GetProperty("developmentConfirmationUrl").GetString()));

        var recovery = await (await ForgotPasswordAsync(visitor, "nobody@example.test"))
            .Content.ReadFromJsonAsync<JsonElement>(TestContext.CancellationToken);
        Assert.IsTrue(recovery.GetProperty("emailAvailable").GetBoolean());
        Assert.AreEqual(
            "If the account is eligible, password reset instructions have been queued.",
            recovery.GetProperty("message").GetString());
    }

    [TestMethod]
    public async Task AContactRequestWaitsWhileEmailIsOffAndThePlatformAdminReadsItUntilItGoesOut()
    {
        Start(Mail.Off);
        using var visitor = CreateClient();
        await SubmitContactRequestAsync(visitor, "Oakline Strength");

        // No transport is not a failed attempt: hours of sweeps claim nothing and spend nothing.
        foreach (var step in new[] { TimeSpan.Zero, TimeSpan.FromMinutes(2), TimeSpan.FromMinutes(10), TimeSpan.FromHours(2) })
        {
            Clock.Advance(step);
            Assert.AreEqual(0, (await SweepContactRequestsAsync()).Total);
        }

        var waiting = (await ContactRequestsAsync()).Single();
        Assert.AreEqual(ContactRequestMailStatus.Pending, waiting.Status);
        Assert.AreEqual(0, waiting.AttemptCount);
        Assert.IsNull(waiting.FailureCode);
        StringAssert.Contains(Log.Text, "email is off on this deployment");

        // A request dead-lettered before this change (four attempts, then given up) is listed as well.
        Clock.Advance(TimeSpan.FromMinutes(1));
        await SubmitContactRequestAsync(visitor, "Cedar Gym");
        var cedar = (await ContactRequestsAsync()).Single(item => item.GymName == "Cedar Gym");
        await ExecuteAsync(
            """
            UPDATE website."ContactRequests"
            SET "Status" = 'DeadLettered', "AttemptCount" = 4, "ProviderIdempotencyKey" = @key,
                "FailureCode" = 'contact-request-attempts-exhausted', "DeadLetteredAtUtc" = @now, "CompletedAtUtc" = @now
            WHERE "Id" = @id
            """,
            ("key", ContactRequest.BuildProviderIdempotencyKey(cedar.Id, 4)),
            ("now", Clock.UtcNow),
            ("id", cedar.Id));

        // Only the platform admin reads them: not a visitor, not a workspace owner with a header.
        using var anonymous = CreateClient();
        Assert.AreEqual(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(ContactRequestsPath, TestContext.CancellationToken)).StatusCode);
        using var owner = CreateClient();
        await RegisterConfirmedAndSignInAsync(owner, "a1-owner@example.test", "A1 Owner Gym");
        Assert.AreEqual(HttpStatusCode.Forbidden, (await owner.GetAsync(ContactRequestsPath, TestContext.CancellationToken)).StatusCode);

        using var admin = CreateClient();
        await RegisterConfirmedAndSignInAsync(admin, "a1-admin@example.test", "A1 Admin Gym");
        Assert.AreEqual(
            0,
            await PlatformAdminCommand.RunAsync(
                RequiredFactory.Services,
                [PlatformAdminCommand.Name, "grant", "a1-admin@example.test"],
                new StringWriter()));

        var listed = await admin.GetFromJsonAsync<JsonElement[]>(ContactRequestsPath, TestContext.CancellationToken);
        Assert.IsNotNull(listed);
        Assert.HasCount(2, listed);
        Assert.AreEqual("Cedar Gym", listed[0].GetProperty("gymName").GetString(), "Newest first.");
        Assert.IsTrue(listed[0].GetProperty("deadLettered").GetBoolean());
        Assert.AreEqual(4, listed[0].GetProperty("attemptCount").GetInt32());
        var oakline = listed[1];
        Assert.AreEqual(waiting.Id, oakline.GetProperty("id").GetGuid());
        Assert.AreEqual("Rami Tabet", oakline.GetProperty("name").GetString());
        Assert.AreEqual("Oakline Strength", oakline.GetProperty("gymName").GetString());
        Assert.AreEqual("rami@example.test", oakline.GetProperty("contact").GetString());
        Assert.AreEqual("Email", oakline.GetProperty("contactKind").GetString());
        Assert.AreEqual("Six coaches.", oakline.GetProperty("message").GetString());
        Assert.AreEqual(waiting.ReceivedAtUtc, oakline.GetProperty("receivedAtUtc").GetDateTimeOffset());
        Assert.IsFalse(oakline.GetProperty("deadLettered").GetBoolean());
        Assert.IsFalse(oakline.GetProperty("sending").GetBoolean());
        Assert.AreEqual(0, oakline.GetProperty("attemptCount").GetInt32());

        // Email turned on: the waiting request goes out on its first attempt; the dead letter stays listed.
        factory!.Dispose();
        Start(Mail.Captured);
        Assert.AreEqual(1, (await SweepContactRequestsAsync()).Materialized);
        var sent = (await ContactRequestsAsync()).Single(item => item.Id == waiting.Id);
        Assert.AreEqual(ContactRequestMailStatus.Materialized, sent.Status);
        Assert.AreEqual(1, sent.AttemptCount);

        using var adminAgain = CreateClient();
        await SignInAsync(adminAgain, "a1-admin@example.test");
        var remaining = await adminAgain.GetFromJsonAsync<JsonElement[]>(ContactRequestsPath, TestContext.CancellationToken);
        Assert.IsNotNull(remaining);
        Assert.AreEqual(cedar.Id, remaining.Single().GetProperty("id").GetGuid());
    }

    [TestMethod]
    public async Task WithoutAWhishNumberTheBillNamesTheSupportInboxAndWhatsApp()
    {
        Start(Mail.Provider, new Dictionary<string, string?> { ["Website:WhatsAppNumber"] = "+96170123456" });
        using var owner = CreateClient();
        await RegisterConfirmedAndSignInAsync(owner, "a1-bill@example.test", "A1 Bill Gym");

        var pay = (await owner.GetFromJsonAsync<JsonElement>("/api/billing", TestContext.CancellationToken))
            .GetProperty("paymentInstructions");
        Assert.AreEqual(JsonValueKind.Null, pay.GetProperty("whishNumber").ValueKind);
        Assert.AreEqual("support@tbgym.test", pay.GetProperty("supportEmail").GetString());
        Assert.AreEqual("+96170123456", pay.GetProperty("whatsAppNumber").GetString());

        // A Whish number, once configured, is there; with no provider there is no support inbox to name.
        factory!.Dispose();
        Start(Mail.Captured, new Dictionary<string, string?> { ["PlatformBilling:WhishNumber"] = " +961 70 111 222 " });
        using var again = CreateClient();
        await SignInAsync(again, "a1-bill@example.test");
        await UseOnlyWorkspaceAsync(again);
        var configured = (await again.GetFromJsonAsync<JsonElement>("/api/billing", TestContext.CancellationToken))
            .GetProperty("paymentInstructions");
        Assert.AreEqual("+961 70 111 222", configured.GetProperty("whishNumber").GetString());
        Assert.AreEqual(JsonValueKind.Null, configured.GetProperty("supportEmail").ValueKind);
        Assert.AreEqual(JsonValueKind.Null, configured.GetProperty("whatsAppNumber").ValueKind);
    }

    // ---------- the host ----------

    /// <summary>Starts a host on this test's database; the clock carries over from an earlier host.</summary>
    private void Start(Mail mail, IReadOnlyDictionary<string, string?>? extra = null)
    {
        var testClock = clock ??= new MutableClock(StartInstant);
        var capturedLog = log ??= new CapturedLog();
        factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Development");
            var settings = new Dictionary<string, string?>
            {
                ["ConnectionStrings:Database"] = databaseConnection,
                ["Database:ApplyMigrationsOnStartup"] = "true",
                ["Seed:Enabled"] = "false",
                ["Messaging:Realtime:Enabled"] = "false",
                ["Application:PublicBaseUrl"] = "http://localhost:4200",
                ["Media:StorageRoot"] = Path.Combine(Path.GetTempPath(), databaseName!, "media"),
                ["Media:PurgeEnabled"] = "false",
                ["Notifications:Email:Enabled"] = "false",
                ["Notifications:Email:Adapter"] = mail == Mail.Provider ? "Resend" : "Captured",
                ["Application:ActionMail:PollIntervalSeconds"] = "1",
                ["Application:ActionMail:MaximumAttempts"] = "4",
                ["Website:ContactRecipient"] = "owner@example.test",
            };
            if (mail == Mail.Provider)
            {
                // Shape-valid placeholders: nothing in these tests sends, so nothing reaches Resend.
                settings["Notifications:Email:Provider:ApiKey"] = "re_not_a_real_key";
                settings["Notifications:Email:Provider:FromAddress"] = "TB Gym <notifications@mail.example.test>";
                settings["Notifications:Email:Provider:ReplyToAddress"] = "support@tbgym.test";
                settings["Notifications:Email:Provider:WebhookSigningSecret"] = "whsec_bm90LWEtcmVhbC13ZWJob29rLXNlY3JldA==";
                settings["Notifications:Email:Provider:FingerprintKeyId"] = "a1";
                settings["Notifications:Email:Provider:FingerprintKeys:a1"] = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
            }

            foreach (var (key, value) in extra ?? new Dictionary<string, string?>())
            {
                settings[key] = value;
            }

            foreach (var (key, value) in settings)
            {
                builder.UseSetting(key, value);
            }

            builder.ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(settings));
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<IClock>();
                services.AddSingleton<IClock>(testClock);
                services.AddSingleton<ILoggerProvider>(capturedLog);
                if (mail == Mail.Off)
                {
                    services.RemoveAll<IActionEmailTransport>();
                }
            });
        });
    }

    private WebApplicationFactory<Program> RequiredFactory =>
        factory ?? throw new InvalidOperationException("The test application is not initialized.");

    private MutableClock Clock => clock ?? throw new InvalidOperationException("The test clock is not initialized.");

    private CapturedLog Log => log ?? throw new InvalidOperationException("The log capture is not initialized.");

    private HttpClient CreateClient() => RequiredFactory.CreateClient(new WebApplicationFactoryClientOptions
    {
        AllowAutoRedirect = false,
        HandleCookies = true,
        BaseAddress = new Uri("http://localhost"),
    });

    // ---------- accounts ----------

    private async Task<HttpResponseMessage> RegisterAsync(HttpClient client, string email, string workspaceName)
    {
        await RefreshCsrfAsync(client);
        return await client.PostAsJsonAsync(
            "/api/auth/register/coach",
            new
            {
                displayName = workspaceName + " Coach",
                email,
                password = Password,
                workspaceName,
                timeZoneId = "Asia/Beirut",
                defaultCulture = "en-LB",
                defaultCurrencyCode = "USD",
                weekStartsOn = "Monday",
            },
            TestContext.CancellationToken);
    }

    /// <summary>Marks an address confirmed directly: with email off there is no link to follow.</summary>
    private async Task ConfirmAsync(string email)
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var user = await users.FindByEmailAsync(email) ?? throw new AssertFailedException($"{email} was not registered.");
        user.EmailConfirmed = true;
        Assert.IsTrue((await users.UpdateAsync(user)).Succeeded);
    }

    private async Task RegisterConfirmedAndSignInAsync(HttpClient client, string email, string workspaceName)
    {
        Assert.AreEqual(HttpStatusCode.Accepted, (await RegisterAsync(client, email, workspaceName)).StatusCode);
        await ConfirmAsync(email);
        await SignInAsync(client, email);
        await UseOnlyWorkspaceAsync(client);
    }

    private async Task SignInAsync(HttpClient client, string email)
    {
        await RefreshCsrfAsync(client);
        var response = await client.PostAsJsonAsync(
            "/api/auth/login",
            new { email, password = Password, rememberMe = false },
            TestContext.CancellationToken);
        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode, await response.Content.ReadAsStringAsync());
        await RefreshCsrfAsync(client);
    }

    private async Task UseOnlyWorkspaceAsync(HttpClient client)
    {
        var memberships = await client.GetFromJsonAsync<JsonElement[]>("/api/tenants", TestContext.CancellationToken);
        Assert.IsNotNull(memberships);
        client.DefaultRequestHeaders.Remove("X-Tenant-Id");
        client.DefaultRequestHeaders.Add("X-Tenant-Id", memberships.Single().GetProperty("tenantId").GetString());
    }

    private async Task<HttpResponseMessage> ForgotPasswordAsync(HttpClient client, string email)
    {
        await RefreshCsrfAsync(client);
        return await client.PostAsJsonAsync("/api/auth/forgot-password", new { email }, TestContext.CancellationToken);
    }

    private static async Task RefreshCsrfAsync(HttpClient client)
    {
        var csrf = await client.GetFromJsonAsync<JsonElement>("/api/auth/csrf");
        client.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
        client.DefaultRequestHeaders.Add("X-XSRF-TOKEN", csrf.GetProperty("token").GetString());
    }

    // ---------- Talk to us ----------

    private async Task SubmitContactRequestAsync(HttpClient visitor, string gymName)
    {
        var stamp = await visitor.GetFromJsonAsync<JsonElement>("/api/website/contact-form", TestContext.CancellationToken);
        Clock.Advance(TimeSpan.FromSeconds(10));
        await RefreshCsrfAsync(visitor);
        var response = await visitor.PostAsJsonAsync(
            "/api/website/contact-requests",
            new
            {
                name = "Rami Tabet",
                gymName,
                contact = "rami@example.test",
                message = "Six coaches.",
                website = "",
                formStamp = stamp.GetProperty("stamp").GetString(),
            },
            TestContext.CancellationToken);
        Assert.AreEqual(HttpStatusCode.Accepted, response.StatusCode, await response.Content.ReadAsStringAsync());
    }

    private async Task<ContactRequestMailDispatchOutcome> SweepContactRequestsAsync()
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        return await scope.ServiceProvider
            .GetRequiredService<IContactRequestMailDispatchService>()
            .DispatchDueAsync(TestContext.CancellationToken);
    }

    private async Task<List<ContactRequest>> ContactRequestsAsync()
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<GymDbContext>().ContactRequests
            .AsNoTracking()
            .OrderBy(item => item.ReceivedAtUtc)
            .ToListAsync(TestContext.CancellationToken);
    }

    private async Task ExecuteAsync(string sql, params (string Name, object Value)[] parameters)
    {
        await using var connection = new NpgsqlConnection(databaseConnection);
        await connection.OpenAsync(TestContext.CancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        foreach (var (name, value) in parameters)
        {
            command.Parameters.AddWithValue(name, value);
        }

        Assert.AreEqual(1, await command.ExecuteNonQueryAsync(TestContext.CancellationToken));
    }

    // ---------- test doubles ----------

    private sealed class MutableClock(DateTimeOffset utcNow) : IClock
    {
        private long ticks = utcNow.UtcTicks;

        public DateTimeOffset UtcNow => new(Interlocked.Read(ref ticks), TimeSpan.Zero);

        public void Advance(TimeSpan duration) => Interlocked.Add(ref ticks, duration.Ticks);
    }

    private sealed class CapturedLog : ILoggerProvider
    {
        private readonly ConcurrentQueue<string> messages = new();

        public string Text => string.Join(Environment.NewLine, messages);

        public ILogger CreateLogger(string categoryName) => new QueueLogger(messages);

        public void Dispose()
        {
        }

        private sealed class QueueLogger(ConcurrentQueue<string> messages) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state)
                where TState : notnull => null;

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
