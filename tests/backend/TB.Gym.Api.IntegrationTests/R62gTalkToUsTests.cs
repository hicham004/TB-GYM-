using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Npgsql;
using TB.Gym.Infrastructure.Application;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Notifications;
using TB.Gym.Modules.Website;
using TB.Gym.SharedKernel;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Talk to us for gyms (UI plan R6.2g): a visitor with no account posts the form, the request is
/// stored with no workspace anywhere near it, and the owner is emailed by the action-mail sweep.
/// </summary>
/// <remarks>
/// Every sweep is driven explicitly, as the other action-mail tests do, and the transport is the
/// captured adapter, so what the owner would have received can be read while nothing contacts a
/// network. The clock is the test's own, which is what makes the minimum-time rule testable.
/// </remarks>
[TestClass]
public sealed class R62gTalkToUsTests
{
    private const string Recipient = "owner@example.test";

    private static readonly DateTimeOffset StartInstant = new(2026, 10, 13, 9, 0, 0, TimeSpan.Zero);

    private string? adminConnection;
    private string? databaseName;
    private string? databaseConnection;
    private WebApplicationFactory<Program>? factory;
    private MutableClock? clock;
    private CapturedLog? log;
    private FlakyTransport? flaky;

    public TestContext TestContext { get; set; } = null!;

    [TestInitialize]
    public async Task InitializeAsync()
    {
        adminConnection = PostgreSqlTestEnvironment.RequireAdminConnection();
        databaseName = await PostgreSqlTestEnvironment.CreateMigratedDatabaseAsync("tbgym_r62g");
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

        // The media folder and the Worker's content root.
        var temporary = Path.Combine(Path.GetTempPath(), databaseName);
        if (Directory.Exists(temporary))
        {
            Directory.Delete(temporary, recursive: true);
        }

        await using var connection = new NpgsqlConnection(adminConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = $"DROP DATABASE IF EXISTS \"{databaseName}\" WITH (FORCE)";
        await command.ExecuteNonQueryAsync();
    }

    [TestMethod]
    public async Task AVisitorWithNoAccountWritesToUsAndTheOwnerIsEmailedByTheSweep()
    {
        Start();
        using var visitor = CreateClient();

        // No sign-in, no workspace header: the stamp, then the form, three seconds and more apart.
        var stamp = await StampAsync(visitor);
        Clock.Advance(TimeSpan.FromSeconds(5));
        await RefreshCsrfAsync(visitor);
        var response = await visitor.PostAsJsonAsync("/api/website/contact-requests", new
        {
            name = "  Rami   Tabet ",
            gymName = "Oakline Strength",
            contact = "+961 70 123 456",
            message = "Six coaches, about 90 clients.\r\nWe start in January.",
            website = "",
            formStamp = stamp,
        }, TestContext.CancellationToken);

        Assert.AreEqual(HttpStatusCode.Accepted, response.StatusCode, await response.Content.ReadAsStringAsync());
        Assert.AreEqual(string.Empty, await response.Content.ReadAsStringAsync(), "The answer carries nothing back.");

        var requests = await RequestsAsync();
        Assert.HasCount(1, requests);
        var request = requests[0];
        Assert.AreEqual("Rami Tabet", request.Name);
        Assert.AreEqual("Oakline Strength", request.GymName);
        Assert.AreEqual("+96170123456", request.Contact);
        Assert.AreEqual(ContactKind.WhatsApp, request.ContactKind);
        Assert.AreEqual("Six coaches, about 90 clients.\nWe start in January.", request.Message);
        Assert.AreEqual(Clock.UtcNow, request.ReceivedAtUtc);
        Assert.AreEqual(ContactRequestMailStatus.Pending, request.Status);
        Assert.AreEqual(0, request.AttemptCount);

        // No workspace: the table has no tenant column to fabricate one in.
        Assert.AreEqual(
            0L,
            await ScalarAsync<long>(
                """
                SELECT count(*) FROM information_schema.columns
                WHERE table_schema = 'website' AND table_name = 'ContactRequests' AND column_name = 'TenantId'
                """),
            "website.ContactRequests must not have a TenantId column.");

        // The sweep emails the owner, through the same transport as every other action mail.
        var outcome = await SweepAsync();
        Assert.AreEqual(1, outcome.Claimed);
        Assert.AreEqual(1, outcome.Materialized);
        var captured = CapturedMail.Captured.Where(capture => capture.Scope == ActionMailScopes.ContactRequest).ToArray();
        Assert.HasCount(1, captured);
        Assert.AreEqual(request.Id, captured[0].RequestId);
        Assert.AreEqual(Recipient, captured[0].RecipientAddress);
        Assert.AreEqual("Talk to us: Oakline Strength (Rami Tabet)", captured[0].Subject);
        StringAssert.Contains(captured[0].TextBody, "WhatsApp: +96170123456");
        StringAssert.Contains(captured[0].TextBody, "We start in January.");
        Assert.AreEqual(ContactRequest.BuildProviderIdempotencyKey(request.Id, 1), captured[0].IdempotencyKey);

        var sent = (await RequestsAsync()).Single();
        Assert.AreEqual(ContactRequestMailStatus.Materialized, sent.Status);
        Assert.AreEqual(1, sent.AttemptCount);
        Assert.AreEqual(CapturedActionEmailTransport.CapturedAdapterName, sent.TransportAdapter);
        Assert.IsNotNull(sent.MaterializedAtUtc);
        Assert.IsNull(sent.ClaimToken);
        Assert.IsNull(sent.FailureCode);

        // A second sweep finds nothing: the request was emailed once.
        Assert.AreEqual(0, (await SweepAsync()).Total);
        Assert.HasCount(1, CapturedMail.Captured.Where(capture => capture.Scope == ActionMailScopes.ContactRequest));

        // Nothing the person wrote reached a log line.
        foreach (var secret in new[] { "Rami", "Tabet", "Oakline", "70123456", "70 123 456", "January" })
        {
            Assert.DoesNotContain(secret, Log.Text, StringComparison.OrdinalIgnoreCase, $"The log holds '{secret}'.");
        }

        StringAssert.Contains(Log.Text, $"Contact request {request.Id} received");
    }

    [TestMethod]
    public async Task AFilledHoneypotIsAnsweredLikeARequestAndKeptNowhere()
    {
        Start();
        using var bot = CreateClient();
        var stamp = await StampAsync(bot);
        Clock.Advance(TimeSpan.FromSeconds(10));
        await RefreshCsrfAsync(bot);

        var response = await bot.PostAsJsonAsync("/api/website/contact-requests", new
        {
            name = "Bot",
            gymName = "Bot Gym",
            contact = "bot@example.test",
            message = "Buy now",
            website = "https://spam.example",
            formStamp = stamp,
        }, TestContext.CancellationToken);

        Assert.AreEqual(HttpStatusCode.Accepted, response.StatusCode);
        Assert.IsEmpty(await RequestsAsync(), "A decoy must not be stored.");
        Assert.AreEqual(0, (await SweepAsync()).Total);
        Assert.IsEmpty(CapturedMail.Captured.Where(capture => capture.Scope == ActionMailScopes.ContactRequest));
        Assert.DoesNotContain("spam.example", Log.Text, StringComparison.Ordinal);
    }

    [TestMethod]
    public async Task AMissingOrMalformedFieldIsRefusedByNameAndNothingIsStored()
    {
        Start();
        using var visitor = CreateClient();
        var stamp = await StampAsync(visitor);
        Clock.Advance(TimeSpan.FromSeconds(10));
        await RefreshCsrfAsync(visitor);

        var response = await visitor.PostAsJsonAsync("/api/website/contact-requests", new
        {
            name = " ",
            gymName = "Oakline Strength",
            contact = "not a contact",
            message = new string('m', ContactRequestRules.MessageMaxLength + 1),
            website = "",
            formStamp = stamp,
        }, TestContext.CancellationToken);

        Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>(TestContext.CancellationToken);
        var errors = problem.GetProperty("errors");
        Assert.AreEqual(
            "contact, message, name",
            string.Join(", ", errors.EnumerateObject().Select(property => property.Name).Order(StringComparer.Ordinal)));
        Assert.IsEmpty(await RequestsAsync());
    }

    [TestMethod]
    public async Task ASubmissionFasterThanAPersonOrWithABadStampIsRefused()
    {
        Start();
        using var visitor = CreateClient();
        await RefreshCsrfAsync(visitor);

        // The same second the form appeared: too fast.
        var stamp = await StampAsync(visitor);
        Clock.Advance(TimeSpan.FromSeconds(1));
        var tooFast = await visitor.PostAsJsonAsync("/api/website/contact-requests", Body(stamp), TestContext.CancellationToken);
        Assert.AreEqual(HttpStatusCode.BadRequest, tooFast.StatusCode);
        Assert.AreEqual("contact_form_too_fast", await CodeAsync(tooFast));

        // The same stamp, two seconds later: a person.
        Clock.Advance(TimeSpan.FromSeconds(2));
        var inTime = await visitor.PostAsJsonAsync("/api/website/contact-requests", Body(stamp), TestContext.CancellationToken);
        Assert.AreEqual(HttpStatusCode.Accepted, inTime.StatusCode);

        // A forged, a missing and a day-old stamp are all refused with the code that asks for a new one.
        // (Five posts in all: the address's own allowance is the next test's subject.)
        foreach (var bad in new[] { "forged", (string?)null })
        {
            var refused = await visitor.PostAsJsonAsync("/api/website/contact-requests", Body(bad), TestContext.CancellationToken);
            Assert.AreEqual(HttpStatusCode.BadRequest, refused.StatusCode, bad ?? "null");
            Assert.AreEqual("contact_form_stamp_invalid", await CodeAsync(refused), bad ?? "null");
        }

        Clock.Advance(TimeSpan.FromHours(25));
        var stale = await visitor.PostAsJsonAsync("/api/website/contact-requests", Body(stamp), TestContext.CancellationToken);
        Assert.AreEqual(HttpStatusCode.BadRequest, stale.StatusCode);
        Assert.AreEqual("contact_form_stamp_invalid", await CodeAsync(stale));

        Assert.HasCount(1, await RequestsAsync(), "Only the request sent in time is stored.");
    }

    [TestMethod]
    public async Task TheFormHasAPerAddressAllowanceBehindNginxs()
    {
        Start();
        using var visitor = CreateClient();
        await RefreshCsrfAsync(visitor);

        // Five attempts an hour from one address, however they end; the sixth is refused outright.
        for (var attempt = 1; attempt <= 5; attempt++)
        {
            var response = await visitor.PostAsJsonAsync("/api/website/contact-requests", Body("forged"), TestContext.CancellationToken);
            Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode, $"attempt {attempt}");
        }

        var sixth = await visitor.PostAsJsonAsync("/api/website/contact-requests", Body("forged"), TestContext.CancellationToken);
        Assert.AreEqual(HttpStatusCode.TooManyRequests, sixth.StatusCode);
        // The stamp and the settings are not behind that allowance.
        Assert.AreEqual(HttpStatusCode.OK, (await visitor.GetAsync("/api/website/contact-form", TestContext.CancellationToken)).StatusCode);
        Assert.AreEqual(HttpStatusCode.OK, (await visitor.GetAsync("/api/website/settings", TestContext.CancellationToken)).StatusCode);
    }

    [TestMethod]
    public async Task AWorkspaceHeaderAndAMissingAntiforgeryTokenChangeNothingAboutTheRequest()
    {
        Start();
        using var visitor = CreateClient();
        var stamp = await StampAsync(visitor);
        Clock.Advance(TimeSpan.FromSeconds(10));

        // Without the antiforgery token the post is refused like every other state change.
        var noToken = await visitor.PostAsJsonAsync("/api/website/contact-requests", Body(stamp), TestContext.CancellationToken);
        Assert.AreEqual(HttpStatusCode.BadRequest, noToken.StatusCode);
        Assert.AreEqual("antiforgery_token_invalid", await CodeAsync(noToken));
        Assert.IsEmpty(await RequestsAsync());

        // A workspace header is ignored: the request is TB Gym's, not any coaching space's.
        await RefreshCsrfAsync(visitor);
        visitor.DefaultRequestHeaders.Add(TenantHeaders.TenantId, Guid.NewGuid().ToString());
        var response = await visitor.PostAsJsonAsync("/api/website/contact-requests", Body(stamp), TestContext.CancellationToken);
        Assert.AreEqual(HttpStatusCode.Accepted, response.StatusCode, await response.Content.ReadAsStringAsync());
        Assert.HasCount(1, await RequestsAsync());

        // And no route of the public contract describes the requests to anyone.
        var contract = await visitor.GetStringAsync("/openapi/v1.json", TestContext.CancellationToken);
        Assert.DoesNotContain("/api/website/contact-requests/{", contract, StringComparison.Ordinal);
        foreach (var term in new[] { "ContactRequestMailStatus", "ProviderIdempotencyKey", "ClaimToken" })
        {
            Assert.DoesNotContain(term, contract, StringComparison.Ordinal, $"The public contract exposes '{term}'.");
        }
    }

    [TestMethod]
    public async Task TheSettingsSayWhatTheOwnerConfiguredAndNothingElse()
    {
        Start();
        using var visitor = CreateClient();

        var configured = await visitor.GetFromJsonAsync<JsonElement>("/api/website/settings", TestContext.CancellationToken);
        Assert.AreEqual("+96170123456", configured.GetProperty("whatsAppNumber").GetString());
        Assert.AreEqual("pa-test1.js", configured.GetProperty("analytics").GetProperty("script").GetString());
        Assert.AreEqual(2, configured.EnumerateObject().Count(), "The settings carry nothing but the two the homepage needs.");
    }

    [TestMethod]
    public async Task WithNothingConfiguredTheSettingsAreEmptyAndRequestsWaitWithoutBurningAttempts()
    {
        Start(recipient: "", whatsApp: "", script: "");
        using var visitor = CreateClient();

        var settings = await visitor.GetFromJsonAsync<JsonElement>("/api/website/settings", TestContext.CancellationToken);
        Assert.AreEqual(JsonValueKind.Null, settings.GetProperty("whatsAppNumber").ValueKind);
        Assert.AreEqual(JsonValueKind.Null, settings.GetProperty("analytics").GetProperty("script").ValueKind);

        var stamp = await StampAsync(visitor);
        Clock.Advance(TimeSpan.FromSeconds(10));
        await RefreshCsrfAsync(visitor);
        var response = await visitor.PostAsJsonAsync("/api/website/contact-requests", Body(stamp), TestContext.CancellationToken);
        Assert.AreEqual(HttpStatusCode.Accepted, response.StatusCode);

        // No recipient: the sweep claims nothing, so the request keeps every attempt for the day one is set.
        Assert.AreEqual(0, (await SweepAsync()).Total);
        var waiting = (await RequestsAsync()).Single();
        Assert.AreEqual(ContactRequestMailStatus.Pending, waiting.Status);
        Assert.AreEqual(0, waiting.AttemptCount);
        Assert.IsEmpty(CapturedMail.Captured.Where(capture => capture.Scope == ActionMailScopes.ContactRequest));
        StringAssert.Contains(Log.Text, "Website:ContactRecipient is not set");
    }

    [TestMethod]
    public async Task AProviderOutageRetriesOnTheScheduleAndTheRequestsFactsStayFrozen()
    {
        Start(flakyTransport: true);
        using var visitor = CreateClient();
        var stamp = await StampAsync(visitor);
        Clock.Advance(TimeSpan.FromSeconds(10));
        await RefreshCsrfAsync(visitor);
        Assert.AreEqual(
            HttpStatusCode.Accepted,
            (await visitor.PostAsJsonAsync("/api/website/contact-requests", Body(stamp), TestContext.CancellationToken)).StatusCode);

        // The provider is down: one counted attempt, then a retry a minute later.
        Flaky.Refuse = true;
        var first = await SweepAsync();
        Assert.AreEqual(1, first.Claimed);
        Assert.AreEqual(1, first.Retried);
        var retrying = (await RequestsAsync()).Single();
        Assert.AreEqual(ContactRequestMailStatus.Pending, retrying.Status);
        Assert.AreEqual(1, retrying.AttemptCount);
        Assert.AreEqual(ContactRequestMailCodes.TransportTransient, retrying.FailureCode);
        Assert.AreEqual(Clock.UtcNow.AddMinutes(1), retrying.NextAttemptAtUtc);
        Assert.AreEqual(0, (await SweepAsync()).Total, "Not due yet.");

        // The provider is back: the second attempt presents a new key and the owner is emailed once.
        Clock.Advance(TimeSpan.FromSeconds(61));
        Flaky.Refuse = false;
        var second = await SweepAsync();
        Assert.AreEqual(1, second.Materialized);
        var sent = (await RequestsAsync()).Single();
        Assert.AreEqual(ContactRequestMailStatus.Materialized, sent.Status);
        Assert.AreEqual(2, sent.AttemptCount);
        Assert.AreEqual("resend", sent.TransportAdapter);
        Assert.AreEqual("msg_r62g", sent.ProviderMessageId);
        Assert.IsNotNull(sent.ProviderAcceptedAtUtc);
        CollectionAssert.AreEqual(
            new[] { ContactRequest.BuildProviderIdempotencyKey(sent.Id, 1), ContactRequest.BuildProviderIdempotencyKey(sent.Id, 2) },
            Flaky.Keys.ToArray());

        // The facts are frozen in the database and in the model; only the email's bookkeeping moved.
        var trigger = await Assert.ThrowsAsync<PostgresException>(() => ExecuteAsync(
            """UPDATE website."ContactRequests" SET "Name" = 'Somebody Else'"""));
        Assert.AreEqual("23514", trigger.SqlState);
        var deletion = await Assert.ThrowsAsync<PostgresException>(() => ExecuteAsync(
            """DELETE FROM website."ContactRequests" """));
        Assert.AreEqual("23514", deletion.SqlState);

        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var tracked = await context.ContactRequests.SingleAsync(TestContext.CancellationToken);
        context.Entry(tracked).Property(nameof(ContactRequest.GymName)).CurrentValue = "Another Gym";
        await Assert.ThrowsAsync<InvalidOperationException>(() => context.SaveChangesAsync(TestContext.CancellationToken));
        Assert.AreEqual("Oakline Strength", (await RequestsAsync()).Single().GymName);
    }

    [TestMethod]
    public async Task AClaimLeftByACrashedSweepIsTakenOverOnceItsLeaseExpires()
    {
        Start();
        using var visitor = CreateClient();
        var stamp = await StampAsync(visitor);
        Clock.Advance(TimeSpan.FromSeconds(10));
        await RefreshCsrfAsync(visitor);
        Assert.AreEqual(
            HttpStatusCode.Accepted,
            (await visitor.PostAsJsonAsync("/api/website/contact-requests", Body(stamp), TestContext.CancellationToken)).StatusCode);

        // A sweep that died after claiming: the row holds a lease that has since run out.
        await ExecuteAsync(
            """
            UPDATE website."ContactRequests"
            SET "Status" = 'Processing', "ClaimToken" = gen_random_uuid(), "ClaimExpiresAtUtc" = @expired
            """,
            ("expired", Clock.UtcNow.AddMinutes(-1)));

        var outcome = await SweepAsync();
        Assert.AreEqual(1, outcome.Reclaimed);
        Assert.AreEqual(1, outcome.Materialized);
        Assert.AreEqual(ContactRequestMailStatus.Materialized, (await RequestsAsync()).Single().Status);
        Assert.HasCount(1, CapturedMail.Captured.Where(capture => capture.Scope == ActionMailScopes.ContactRequest));
    }

    /// <summary>
    /// Audit BEB-5: the Worker's own loop drains this queue. The tests above call the service directly;
    /// this one builds the Worker's host as its entry point does and lets its timer run, so a queue the
    /// Worker stopped sweeping, or a setting it cannot read, fails here. With no inbox set its sweeps
    /// leave the request waiting with every attempt kept (audit BEB-1); once one is set and the Worker
    /// restarts, its own sweep emails the owner, once.
    /// <para>
    /// Run apart, after the parallel tests: the no-inbox warning is said once per process, which the test
    /// with nothing configured asserts, and this test's idle Worker would otherwise say it first.
    /// </para>
    /// </summary>
    [TestMethod]
    [DoNotParallelize]
    public async Task TheWorkersOwnSweepWaitsForAnInboxAndThenEmailsTheRequestOnce()
    {
        Start(recipient: "");
        using var visitor = CreateClient();
        var stamp = await StampAsync(visitor);
        Clock.Advance(TimeSpan.FromSeconds(10));
        await RefreshCsrfAsync(visitor);
        Assert.AreEqual(
            HttpStatusCode.Accepted,
            (await visitor.PostAsJsonAsync("/api/website/contact-requests", Body(stamp), TestContext.CancellationToken)).StatusCode);

        // Two sweeps of the queue by the Worker's own loop, with no inbox to send to. (Its warning is said
        // once per process, so another test may have said it already: the sweeps are counted instead.)
        var idleSweeps = new SweepCounter();
        using (var idle = await StartWorkerAsync(recipient: "", new CapturedLog(), idleSweeps))
        {
            await WaitForAsync(
                () => Task.FromResult(idleSweeps.Count >= 2),
                "the Worker to sweep the contact queue twice");
            await idle.StopAsync(TestContext.CancellationToken);
            Assert.IsEmpty(
                idle.Services.GetRequiredService<CapturedActionEmailTransport>().Captured
                    .Where(capture => capture.Scope == ActionMailScopes.ContactRequest));
        }

        var waiting = (await RequestsAsync()).Single();
        Assert.AreEqual(ContactRequestMailStatus.Pending, waiting.Status);
        Assert.AreEqual(0, waiting.AttemptCount, "A sweep with no inbox must not spend an attempt.");

        var workerLog = new CapturedLog();
        using var worker = await StartWorkerAsync(Recipient, workerLog, new SweepCounter());
        try
        {
            await WaitForAsync(
                async () => (await RequestsAsync()).Single().Status == ContactRequestMailStatus.Materialized,
                "the Worker's sweep to email the request");

            // Nothing is left for the next sweep: the request was emailed once.
            await using var scope = worker.Services.CreateAsyncScope();
            var next = await scope.ServiceProvider
                .GetRequiredService<IContactRequestMailDispatchService>()
                .DispatchDueAsync(TestContext.CancellationToken);
            Assert.AreEqual(0, next.Total);
        }
        finally
        {
            await worker.StopAsync(TestContext.CancellationToken);
        }

        var captured = worker.Services.GetRequiredService<CapturedActionEmailTransport>().Captured
            .Where(capture => capture.Scope == ActionMailScopes.ContactRequest)
            .ToArray();
        Assert.HasCount(1, captured);
        Assert.AreEqual(Recipient, captured[0].RecipientAddress);
        Assert.AreEqual("Talk to us: Oakline Strength (Rami Tabet)", captured[0].Subject);
        var sent = (await RequestsAsync()).Single();
        Assert.AreEqual(waiting.Id, sent.Id);
        Assert.AreEqual(1, sent.AttemptCount);
        Assert.AreEqual(CapturedActionEmailTransport.CapturedAdapterName, sent.TransportAdapter);
        StringAssert.Contains(
            workerLog.Text,
            $"Action mail sweep of the {ActionMailScopes.ContactRequest} queue claimed 1 requests: 1 materialized");
    }

    // ---------- the host ----------

    private void Start(
        string recipient = Recipient,
        string whatsApp = "+96170123456",
        string script = "pa-test1.js",
        bool flakyTransport = false)
    {
        var testClock = new MutableClock(StartInstant);
        clock = testClock;
        var capturedLog = new CapturedLog();
        log = capturedLog;
        var transport = flakyTransport ? new FlakyTransport() : null;
        flaky = transport;

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
                ["Notifications:Email:Adapter"] = "Captured",
                ["Application:ActionMail:PollIntervalSeconds"] = "1",
                ["Application:ActionMail:MaximumAttempts"] = "4",
                ["Website:ContactRecipient"] = recipient,
                ["Website:WhatsAppNumber"] = whatsApp,
                ["Website:Analytics:Script"] = script,
            };
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
                if (transport is not null)
                {
                    services.RemoveAll<IActionEmailTransport>();
                    services.AddSingleton<IActionEmailTransport>(transport);
                }
            });
        });
    }

    private WebApplicationFactory<Program> RequiredFactory =>
        factory ?? throw new InvalidOperationException("The test application is not initialized.");

    private MutableClock Clock => clock ?? throw new InvalidOperationException("The test clock is not initialized.");

    private CapturedLog Log => log ?? throw new InvalidOperationException("The log capture is not initialized.");

    private FlakyTransport Flaky => flaky ?? throw new InvalidOperationException("No flaky transport was registered.");

    private CapturedActionEmailTransport CapturedMail =>
        RequiredFactory.Services.GetRequiredService<CapturedActionEmailTransport>();

    private HttpClient CreateClient() => RequiredFactory.CreateClient(new WebApplicationFactoryClientOptions
    {
        AllowAutoRedirect = false,
        HandleCookies = true,
        BaseAddress = new Uri("http://localhost"),
    });

    private async Task<ContactRequestMailDispatchOutcome> SweepAsync()
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        return await scope.ServiceProvider
            .GetRequiredService<IContactRequestMailDispatchService>()
            .DispatchDueAsync(TestContext.CancellationToken);
    }

    /// <summary>
    /// The Worker's own host (its entry point's composition) on this test's database, started. Its
    /// settings arrive as a deployment's do, as configuration it reads while it composes; the content
    /// root is an empty folder, so no appsettings file in the test output speaks for it. The
    /// notification and billing sweeps are switched off by their own settings, so only the action-mail
    /// sweep runs, every second. The one change to its services counts each sweep of the contact queue
    /// on its way to the real one.
    /// </summary>
    private async Task<IHost> StartWorkerAsync(string recipient, CapturedLog workerLog, SweepCounter sweeps)
    {
        var contentRoot = Directory.CreateDirectory(Path.Combine(Path.GetTempPath(), databaseName!, "worker")).FullName;
        var builder = TB.Gym.Worker.WorkerProgram.CreateBuilder(
        [
            "--environment", "Development",
            "--contentRoot", contentRoot,
            $"--ConnectionStrings:Database={databaseConnection}",
            "--Application:PublicBaseUrl=http://localhost:4200",
            "--Application:ActionMail:PollIntervalSeconds=1",
            "--Notifications:Dispatch:Enabled=false",
            "--Notifications:Email:Enabled=false",
            "--Notifications:Email:Adapter=Captured",
            "--PlatformBilling:SweepEnabled=false",
            $"--Website:ContactRecipient={recipient}",
        ]);
        builder.Logging.ClearProviders();
        builder.Logging.AddProvider(workerLog);
        var registered = builder.Services.Single(
            descriptor => descriptor.ServiceType == typeof(IContactRequestMailDispatchService));
        var implementation = registered.ImplementationType
            ?? throw new InvalidOperationException("The Worker composes the contact sweep by type.");
        builder.Services.Remove(registered);
        builder.Services.AddScoped<IContactRequestMailDispatchService>(provider => new CountedContactSweep(
            (IContactRequestMailDispatchService)ActivatorUtilities.CreateInstance(provider, implementation),
            sweeps));
        var host = builder.Build();
        try
        {
            await host.StartAsync(TestContext.CancellationToken);
        }
        catch
        {
            host.Dispose();
            throw;
        }

        return host;
    }

    private async Task WaitForAsync(Func<Task<bool>> condition, string what)
    {
        var deadline = DateTimeOffset.UtcNow.AddSeconds(30);
        while (DateTimeOffset.UtcNow < deadline)
        {
            if (await condition())
            {
                return;
            }

            await Task.Delay(TimeSpan.FromMilliseconds(100), TestContext.CancellationToken);
        }

        Assert.Fail($"Timed out waiting for {what}.");
    }

    // ---------- HTTP helpers ----------

    private static async Task RefreshCsrfAsync(HttpClient client)
    {
        var csrf = await client.GetFromJsonAsync<JsonElement>("/api/auth/csrf");
        client.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
        client.DefaultRequestHeaders.Add("X-XSRF-TOKEN", csrf.GetProperty("token").GetString());
    }

    private async Task<string> StampAsync(HttpClient client)
    {
        var response = await client.GetAsync("/api/website/contact-form", TestContext.CancellationToken);
        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode);
        Assert.IsTrue(response.Headers.CacheControl is { NoStore: true }, "A stamp must never be cached.");
        var view = await response.Content.ReadFromJsonAsync<JsonElement>(TestContext.CancellationToken);
        var stamp = view.GetProperty("stamp").GetString();
        Assert.IsFalse(string.IsNullOrWhiteSpace(stamp));
        return stamp!;
    }

    private static object Body(string? stamp) => new
    {
        name = "Rami Tabet",
        gymName = "Oakline Strength",
        contact = "rami@example.test",
        message = "Six coaches.",
        website = "",
        formStamp = stamp,
    };

    private static async Task<string?> CodeAsync(HttpResponseMessage response)
    {
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        return body.TryGetProperty("code", out var code) ? code.GetString() : null;
    }

    // ---------- the database ----------

    private async Task<List<ContactRequest>> RequestsAsync()
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        return await context.ContactRequests
            .AsNoTracking()
            .OrderBy(item => item.ReceivedAtUtc)
            .ToListAsync(TestContext.CancellationToken);
    }

    private async Task<T> ScalarAsync<T>(string sql, params (string Name, object Value)[] parameters)
    {
        await using var connection = new NpgsqlConnection(databaseConnection);
        await connection.OpenAsync(TestContext.CancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        foreach (var (name, value) in parameters)
        {
            command.Parameters.AddWithValue(name, value);
        }

        var result = await command.ExecuteScalarAsync(TestContext.CancellationToken);
        return result is null or DBNull
            ? default!
            : (T)Convert.ChangeType(result, typeof(T), CultureInfo.InvariantCulture);
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

        await command.ExecuteNonQueryAsync(TestContext.CancellationToken);
    }

    // ---------- doubles ----------

    /// <summary>A provider that is down until told otherwise, and remembers every key it was shown.</summary>
    private sealed class FlakyTransport : IActionEmailTransport
    {
        public bool Refuse { get; set; }

        public List<string> Keys { get; } = [];

        public string AdapterName => "resend";

        public bool ContactsProvider => true;

        public Task<ActionEmailTransportResult> SendAsync(ActionEmailMessage message, CancellationToken cancellationToken)
        {
            Keys.Add(message.IdempotencyKey);
            return Task.FromResult(Refuse
                ? ActionEmailTransportResult.Refused(ResendFailureKind.Unavailable)
                : ActionEmailTransportResult.ProviderAccepted("msg_r62g"));
        }
    }

    /// <summary>How many sweeps of the contact queue a Worker made.</summary>
    private sealed class SweepCounter
    {
        private int count;

        public int Count => Volatile.Read(ref count);

        public void Add() => Interlocked.Increment(ref count);
    }

    /// <summary>The Worker's own contact sweep, counted once it has run.</summary>
    private sealed class CountedContactSweep(IContactRequestMailDispatchService sweep, SweepCounter sweeps)
        : IContactRequestMailDispatchService
    {
        public async Task<ContactRequestMailDispatchOutcome> DispatchDueAsync(CancellationToken cancellationToken)
        {
            var outcome = await sweep.DispatchDueAsync(cancellationToken);
            sweeps.Add();
            return outcome;
        }
    }

    private sealed class MutableClock(DateTimeOffset utcNow) : IClock
    {
        private long ticks = utcNow.UtcTicks;

        public DateTimeOffset UtcNow => new(Interlocked.Read(ref ticks), TimeSpan.Zero);

        public void Advance(TimeSpan duration) => Interlocked.Add(ref ticks, duration.Ticks);
    }

    private sealed class CapturedLog : ILoggerProvider
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
