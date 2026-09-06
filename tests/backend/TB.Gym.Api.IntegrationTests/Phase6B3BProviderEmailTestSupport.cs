using System.Collections.Concurrent;
using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Npgsql;
using TB.Gym.Infrastructure.Application;
using TB.Gym.Modules.Notifications;
using TB.Gym.SharedKernel;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Fixture and seams for the Phase 6B-3B provider tests.
/// </summary>
/// <remarks>
/// The provider is a real HTTP server on a loopback port, not a mocked handler. That distinction
/// matters: the adapter's behaviour under a rate limit, a slow response, an oversized body and a
/// missing identifier are all properties of an HTTP exchange, and a handler stub replaced with a
/// canned <c>HttpResponseMessage</c> proves the switch statement works while proving nothing about
/// headers, status codes, streaming or timeouts. Nothing here reaches the network: the double binds
/// 127.0.0.1 on a port the operating system chooses, and the endpoint the adapter is configured with
/// is that address.
/// <para>
/// The webhook side is signed for real too, with the same construction the provider uses, from the
/// same secret the host is configured with. A test that posted a hand-written signature would prove
/// the verifier accepts what the test wrote rather than what a provider sends.
/// </para>
/// </remarks>
public sealed partial class Phase6B3BProviderEmailTests
{
    private static readonly string Password = $"Aa1!{Guid.NewGuid():N}";

    /// <summary>A fixed workspace-local morning, so tenant-today calculations never sit on midnight.</summary>
    private static readonly DateTimeOffset StartInstant = new(2026, 9, 5, 6, 0, 0, TimeSpan.Zero);

    /// <summary>
    /// Test-only key material, generated per run. It is not a secret in any meaningful sense and is
    /// deliberately not a constant somebody could mistake for one to copy into a deployment.
    /// </summary>
    private static readonly byte[] WebhookSecretMaterial = RandomNumberGenerator.GetBytes(24);

    private static readonly byte[] ActiveFingerprintKey = RandomNumberGenerator.GetBytes(32);

    private static readonly byte[] RetiredFingerprintKey = RandomNumberGenerator.GetBytes(32);

    private const string ActiveFingerprintKeyId = "test-active";

    private const string RetiredFingerprintKeyId = "test-retired";

    private const string ApiKey = "re_test_key_never_real";

    private const string FromAddress = "TB Gym <notifications@mail.tbgym.test>";

    private const string WebhookPath = "/api/notifications/email/provider-events";

    private const int ProviderTimeoutSeconds = 2;

    private string? adminConnection;
    private string? databaseName;
    private string? databaseConnection;
    private WebApplicationFactory<Program>? factory;
    private MutableClock? testClock;
    private CapturedLog? log;
    private ProviderHttpDouble? providerDouble;
    private DispatchCheckpointBarrier? checkpointBarrier;

    public TestContext TestContext { get; set; } = null!;

    [TestInitialize]
    public async Task InitializeAsync()
    {
        adminConnection = PostgreSqlTestEnvironment.RequireAdminConnection();
        databaseName = await PostgreSqlTestEnvironment.CreateDatabaseAsync("tbgym_p6b3b");
        databaseConnection = new NpgsqlConnectionStringBuilder(adminConnection)
        {
            Database = databaseName,
        }.ConnectionString;

        var doubleHost = await ProviderHttpDouble.StartAsync();
        providerDouble = doubleHost;
        var clock = new MutableClock(StartInstant);
        testClock = clock;
        var capturedLog = new CapturedLog();
        log = capturedLog;
        var barrier = new DispatchCheckpointBarrier();
        checkpointBarrier = barrier;

        factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            // Development, because the provider endpoint is plain HTTP on loopback. Production
            // deliberately refuses that, and its own startup tests assert so.
            builder.UseEnvironment("Development");
            var settings = new Dictionary<string, string?>
            {
                ["ConnectionStrings:Database"] = databaseConnection,
                ["Database:ApplyMigrationsOnStartup"] = "true",
                ["Seed:Enabled"] = "false",
                ["Messaging:Realtime:Enabled"] = "false",
                ["Application:PublicBaseUrl"] = "http://localhost:4200",
                ["Media:StorageRoot"] = Path.Combine(Path.GetTempPath(), databaseName, "media"),
                ["Media:PurgeEnabled"] = "false",
                ["Notifications:Dispatch:PollIntervalSeconds"] = "1",
                ["Notifications:Dispatch:BatchSize"] = "25",
                ["Notifications:Dispatch:ClaimLeaseSeconds"] = "120",
                ["Notifications:Dispatch:MaximumAttempts"] = "6",
                ["Notifications:Email:Enabled"] = "true",
                ["Notifications:Email:Adapter"] = NotificationEmailAdapters.Resend,
                ["Notifications:Email:Provider:Endpoint"] = doubleHost.SendEndpoint,
                ["Notifications:Email:Provider:ApiKey"] = ApiKey,
                ["Notifications:Email:Provider:FromAddress"] = FromAddress,
                ["Notifications:Email:Provider:TimeoutSeconds"] =
                    ProviderTimeoutSeconds.ToString(CultureInfo.InvariantCulture),
                ["Notifications:Email:Provider:WebhookSigningSecret"] = WebhookSecret,
                ["Notifications:Email:Provider:WebhookToleranceSeconds"] = "300",
                [$"Notifications:Email:Provider:FingerprintKeys:{ActiveFingerprintKeyId}"] =
                    Convert.ToBase64String(ActiveFingerprintKey),
                [$"Notifications:Email:Provider:FingerprintKeys:{RetiredFingerprintKeyId}"] =
                    Convert.ToBase64String(RetiredFingerprintKey),
                ["Notifications:Email:Provider:FingerprintKeyId"] = ActiveFingerprintKeyId,
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
                services.RemoveAll<INotificationDispatchCheckpoint>();
                services.AddSingleton<INotificationDispatchCheckpoint>(barrier);
            });
        });
    }

    [TestCleanup]
    public async Task CleanupAsync()
    {
        checkpointBarrier?.Disarm();
        factory?.Dispose();
        if (providerDouble is not null)
        {
            await providerDouble.DisposeAsync();
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

        await using var connection = new NpgsqlConnection(adminConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = $"DROP DATABASE IF EXISTS \"{databaseName}\" WITH (FORCE)";
        await command.ExecuteNonQueryAsync();
    }

    private static string WebhookSecret =>
        NotificationWebhookSignature.SecretPrefix + Convert.ToBase64String(WebhookSecretMaterial);

    private WebApplicationFactory<Program> RequiredFactory =>
        factory ?? throw new InvalidOperationException("The test application is not initialized.");

    private string RequiredConnection =>
        databaseConnection ?? throw new InvalidOperationException("The test database is not initialized.");

    private MutableClock Clock =>
        testClock ?? throw new InvalidOperationException("The test clock is not initialized.");

    private CapturedLog Log =>
        log ?? throw new InvalidOperationException("The log capture is not initialized.");

    private ProviderHttpDouble Provider =>
        providerDouble ?? throw new InvalidOperationException("The provider double is not initialized.");

    private DispatchCheckpointBarrier CheckpointBarrier =>
        checkpointBarrier ?? throw new InvalidOperationException("The checkpoint barrier is not initialized.");

    private HttpClient CreateClient() => RequiredFactory.CreateClient(new WebApplicationFactoryClientOptions
    {
        AllowAutoRedirect = false,
        HandleCookies = true,
        BaseAddress = new Uri("http://localhost"),
    });

    private async Task<NotificationDispatchOutcome> SweepAsync(CancellationToken cancellationToken = default)
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var service = scope.ServiceProvider.GetRequiredService<INotificationDispatchService>();
        return await service.DispatchDueAsync(cancellationToken);
    }

    // ---------- provider webhooks ----------

    /// <summary>
    /// Posts one webhook, signed the way the provider signs it: over the exact bytes, with the event
    /// identifier and timestamp included in the signed content.
    /// </summary>
    private async Task<HttpResponseMessage> PostWebhookAsync(
        string eventId,
        string json,
        DateTimeOffset? signedAt = null,
        string? overrideSignature = null,
        byte[]? key = null,
        byte[]? bodyOverride = null)
    {
        var body = Encoding.UTF8.GetBytes(json);
        var timestamp = (signedAt ?? Clock.UtcNow).ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture);
        var signature = overrideSignature
            ?? NotificationWebhookSignature.Sign(key ?? WebhookSecretMaterial, eventId, timestamp, body);

        using var client = RequiredFactory.CreateClient();
        using var content = new ByteArrayContent(bodyOverride ?? body);
        content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        using var request = new HttpRequestMessage(HttpMethod.Post, WebhookPath) { Content = content };
        request.Headers.TryAddWithoutValidation(NotificationWebhookSignature.IdHeader, eventId);
        request.Headers.TryAddWithoutValidation(NotificationWebhookSignature.TimestampHeader, timestamp);
        request.Headers.TryAddWithoutValidation(NotificationWebhookSignature.SignatureHeader, signature);
        return await client.SendAsync(request);
    }

    /// <summary>One provider event body, assembled by concatenation because JSON is mostly braces.</summary>
    private string EventBody(
        string providerType,
        string providerMessageId,
        string? bounce = null,
        DateTimeOffset? occurredAt = null,
        string? recipient = null)
    {
        var data = new StringBuilder("{\"email_id\":\"").Append(providerMessageId).Append('"');
        // The provider does echo the recipient. It is included here precisely so the persistence and
        // log assertions have something real to prove was never stored.
        data.Append(",\"to\":[\"").Append(recipient ?? "echoed@tbgym.test").Append("\"]");
        data.Append(",\"from\":\"").Append(FromAddress).Append('"');
        data.Append(",\"subject\":\"You have a new TB Gym notification\"");
        if (bounce is not null)
        {
            data.Append(",\"bounce\":").Append(bounce);
        }

        data.Append('}');

        return new StringBuilder("{\"type\":\"").Append(providerType)
            .Append("\",\"created_at\":\"")
            .Append((occurredAt ?? Clock.UtcNow).ToUniversalTime().ToString("O", CultureInfo.InvariantCulture))
            .Append("\",\"data\":")
            .Append(data)
            .Append('}')
            .ToString();
    }

    private Task<HttpResponseMessage> PostEventAsync(
        string eventId,
        string providerType,
        string providerMessageId,
        string? bounce = null,
        DateTimeOffset? occurredAt = null) =>
        PostWebhookAsync(eventId, EventBody(providerType, providerMessageId, bounce, occurredAt));

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

    /// <summary>
    /// Registers a coach and confirms the address through the action-mail queue.
    /// </summary>
    /// <remarks>
    /// Since Phase 6B-3C the confirmation link is not in the registration response here, and that is
    /// the correct behaviour rather than a gap: these tests configure a real provider adapter, so
    /// there is no development capture to read a link out of and nothing is materialized inline. The
    /// link is where it would be in production — inside the message the adapter actually sent, which
    /// this suite's provider double recorded.
    /// <para>
    /// The double is set to accept for the duration of registration and then restored, so a test that
    /// scripts a refusal is scripting it for the message it is about rather than for the account
    /// confirmation that happens to precede it.
    /// </para>
    /// </remarks>
    private async Task<Guid> RegisterCoachAsync(HttpClient client, string email, string workspaceName)
    {
        var responder = Provider.Responder;
        Provider.Responder = _ => ProviderResponse.Accepted($"prov_{Guid.NewGuid():N}");
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
        Assert.IsNull(
            registration.DevelopmentConfirmationUrl,
            "A deployment with a real provider must not hand a confirmation link back over HTTP.");

        var sent = Provider.Requests.Count;
        await SweepAccountMailAsync();
        Assert.IsGreaterThan(sent, Provider.Requests.Count, "The confirmation mail was never submitted.");
        var confirmationUrl = ActionLinkFrom(Provider.Requests[^1].Body);
        Provider.Responder = responder;

        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync("/api/auth/confirm-email", new
            {
                userId = Guid.Parse(QueryValue(confirmationUrl, "userId")),
                code = QueryValue(confirmationUrl, "code"),
            }),
            HttpStatusCode.NoContent);
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync("/api/auth/login", new { email, password = Password, rememberMe = false }),
            HttpStatusCode.OK);
        var memberships = await client.GetFromJsonAsync<Membership[]>("/api/tenants")
            ?? throw new AssertFailedException("Workspace membership was empty.");
        SetTenant(client, memberships.Single().TenantId);
        return memberships.Single().TenantId;
    }

    /// <summary>
    /// Invites a client and accepts with the link the provider was actually sent.
    /// </summary>
    /// <remarks>
    /// Same reason as registration: with a real provider adapter there is no development capture and
    /// nothing is materialized inline, so the token comes from the message rather than from the REST
    /// response. That is also closer to what happens in production than the captured path is.
    /// </remarks>
    private async Task<Acceptance> InviteAndAcceptAsync(HttpClient coach, HttpClient client, string email)
    {
        var responder = Provider.Responder;
        Provider.Responder = _ => ProviderResponse.Accepted($"prov_{Guid.NewGuid():N}");
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
        var invitationUrl = await SweepInvitationMailAndReadLinkAsync();
        Provider.Responder = responder;

        await RefreshCsrfAsync(client);
        var acceptance = await client.PostAsJsonAsync("/api/invitations/accept", new
        {
            token = QueryValue(invitationUrl, "token"),
            displayName = "Notified Client",
            password = Password,
        });
        await AssertStatusAsync(acceptance, HttpStatusCode.OK);
        var accepted = await RequiredJsonAsync<Acceptance>(acceptance);
        SetTenant(client, accepted.TenantId);
        return accepted;
    }

    private static async Task<PreferenceView> EnableServiceEmailAsync(HttpClient client)
    {
        var current = await client.GetFromJsonAsync<PreferenceView>("/api/notifications/preferences")
            ?? throw new AssertFailedException("Preferences were empty.");
        await RefreshCsrfAsync(client);
        var response = await client.PutAsJsonAsync("/api/notifications/preferences", new
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

    private static async Task DisableServiceEmailAsync(HttpClient client)
    {
        var current = await client.GetFromJsonAsync<PreferenceView>("/api/notifications/preferences")
            ?? throw new AssertFailedException("Preferences were empty.");
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PutAsJsonAsync("/api/notifications/preferences", new
            {
                emailServiceEnabled = false,
                quietHoursEnabled = current.QuietHoursEnabled,
                quietHoursStartLocal = current.QuietHoursStartLocal,
                quietHoursEndLocal = current.QuietHoursEndLocal,
                idempotencyKey = Guid.NewGuid(),
                version = current.Version,
            }),
            HttpStatusCode.OK);
    }

    private static async Task<Guid> CreateOfferAsync(HttpClient coach, decimal priceAmount, string label)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync("/api/commercial/products", new
        {
            name = $"Coaching {label} {Guid.NewGuid():N}",
            description = "Phase 6B-3B",
            initialOffer = new
            {
                label,
                durationCount = 8,
                durationUnit = "Week",
                priceAmount,
                priceCurrency = "USD",
                features = new[] { new { feature = "Training", allowsConcurrentCoverage = false } },
            },
        });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return (await RequiredJsonAsync<Product>(response)).Offers[0].Id;
    }

    private Task<Enrollment> AssignPaidLaterAsync(Workspace workspace, decimal price) =>
        AssignPaidLaterAsync(workspace, workspace.ClientProfileId, price);

    private async Task<Enrollment> AssignPaidLaterAsync(
        Workspace workspace,
        Guid clientProfileId,
        decimal price)
    {
        var offerId = await CreateOfferAsync(workspace.Coach, price, "8 weeks");
        await RefreshCsrfAsync(workspace.Coach);
        var response = await workspace.Coach.PostAsJsonAsync(
            $"/api/commercial/clients/{clientProfileId}/enrollments",
            new { offerId, startDate = TenantToday(), idempotencyKey = Guid.NewGuid() });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<Enrollment>(response);
    }

    /// <summary>
    /// Pays an enrollment in full, which activates it and schedules a second notification for the same
    /// member.
    /// </summary>
    /// <remarks>
    /// A second notification to the same mailbox has to come from a second business event rather than
    /// a second enrollment: entitlement coverage for one feature may not overlap for one client, and
    /// the exclusion constraint that enforces it is one of the invariants this repository most wants
    /// to keep. Activation is the natural second event and needs no new coverage.
    /// </remarks>
    private async Task<Guid> PayInFullAsync(Workspace workspace, Enrollment enrollment)
    {
        await RefreshCsrfAsync(workspace.Coach);
        await AssertStatusAsync(
            await workspace.Coach.PostAsJsonAsync(
                $"/api/commercial/enrollments/{enrollment.Id}/payments",
                new
                {
                    amount = enrollment.PriceAmount,
                    currencyCode = "USD",
                    receivedAtUtc = Clock.UtcNow,
                    method = "Cash",
                    reference = "receipt-1",
                    idempotencyKey = Guid.NewGuid(),
                }),
            HttpStatusCode.OK);
        return await IntentIdAsync(enrollment.Id, CommercialNotificationKind.EnrollmentActivated);
    }

    /// <summary>
    /// Invites and accepts one more client into an existing workspace, opted into service email.
    /// </summary>
    /// <remarks>
    /// Used where a test needs several independent deliveries. Adding members to one workspace rather
    /// than creating a workspace each is deliberate: registering a coach costs several calls against
    /// the public authentication rate limit, and a test that trips that limit fails for a reason that
    /// has nothing to do with what it is testing.
    /// </remarks>
    private async Task<Member> AddMemberAsync(Workspace workspace, string label)
    {
        var client = CreateClient();
        var email = $"member-{label}-{Guid.NewGuid().ToString("N")[..8]}@tbgym.test";
        var acceptance = await InviteAndAcceptAsync(workspace.Coach, client, email);
        await EnableServiceEmailAsync(client);
        var userId = await ScalarAsync<Guid>(
            """SELECT "UserId" FROM clients."ClientProfiles" WHERE "Id" = @id""",
            ("id", acceptance.ClientProfileId));

        // The invitation mail this member needed is a fixture too.
        Provider.Clear();
        return new Member(client, acceptance.ClientProfileId, userId, email);
    }

    private DateOnly TenantToday()
    {
        var local = TimeZoneInfo.ConvertTime(Clock.UtcNow, TimeZoneInfo.FindSystemTimeZoneById("Asia/Beirut"));
        return DateOnly.FromDateTime(local.DateTime);
    }

    /// <summary>A coach, a workspace, one linked client, and that client opted into service email.</summary>
    private async Task<Workspace> CreateWorkspaceAsync(string label, bool enableEmail = true)
    {
        var suffix = Guid.NewGuid().ToString("N")[..10];
        var coach = CreateClient();
        var tenantId = await RegisterCoachAsync(coach, $"coach-{label}-{suffix}@tbgym.test", $"{label} {suffix}");
        var client = CreateClient();
        var clientEmail = $"client-{label}-{suffix}@tbgym.test";
        var acceptance = await InviteAndAcceptAsync(coach, client, clientEmail);
        if (enableEmail)
        {
            await EnableServiceEmailAsync(client);
        }

        var clientUserId = await ScalarAsync<Guid>(
            """SELECT "UserId" FROM clients."ClientProfiles" WHERE "Id" = @id""",
            ("id", acceptance.ClientProfileId));

        // Registration and the invitation have each sent one real message through the double. They are
        // fixtures, not the subject of any test here, so the recording starts from now.
        Provider.Clear();
        return new Workspace(
            tenantId,
            coach,
            client,
            acceptance.ClientProfileId,
            clientUserId,
            clientEmail,
            suffix);
    }

    /// <summary>
    /// The fingerprint this deployment would compute for one mailbox, under the active key. Tests use
    /// it to prove that a suppression is about a mailbox rather than about a member.
    /// </summary>
    private static string Fingerprint(string address) =>
        NotificationAddressFingerprint.Compute(ActiveFingerprintKey, address);

    private static string RetiredFingerprint(string address) =>
        NotificationAddressFingerprint.Compute(RetiredFingerprintKey, address);

    // ---------- assertions ----------

    /// <summary>
    /// Dumps every text column of every notification table and every captured log line, and asserts
    /// none of them holds a recipient address, a rendered body, an API key, a signature or a raw
    /// provider payload.
    /// </summary>
    /// <remarks>
    /// Written as a scan over the live schema rather than a list of columns, so a column added later
    /// is covered by it automatically. That is the point: a privacy rule asserted against a hand-kept
    /// list stops being true the first time somebody adds a field and forgets the list.
    /// </remarks>
    private async Task AssertNothingSensitiveIsPersistedOrLoggedAsync(Workspace workspace, params string[] extra)
    {
        var forbidden = new List<string>
        {
            workspace.ClientEmail,
            "@tbgym.test",
            ApiKey,
            WebhookSecret,
            NotificationTemplateCatalog.ServiceEmailV1.Body,
            NotificationTemplateCatalog.ServiceEmailV1.Title,
            "email_id",
            "svix",
            "echoed@tbgym.test",
        };
        forbidden.AddRange(extra);

        var dumped = await DumpNotificationTextAsync();
        foreach (var term in forbidden)
        {
            Assert.DoesNotContain(
                term,
                dumped,
                StringComparison.OrdinalIgnoreCase,
                $"'{term}' reached a notifications column.");
            Assert.DoesNotContain(
                term,
                Log.Text,
                StringComparison.OrdinalIgnoreCase,
                $"'{term}' reached the log.");
        }
    }

    /// <summary>Every text value in every table of the notifications schema, as one string.</summary>
    private async Task<string> DumpNotificationTextAsync()
    {
        await using var connection = new NpgsqlConnection(RequiredConnection);
        await connection.OpenAsync();
        await using var tables = connection.CreateCommand();
        tables.CommandText = """
            SELECT c.table_name, c.column_name
            FROM information_schema.columns c
            JOIN information_schema.tables t
              ON t.table_schema = c.table_schema AND t.table_name = c.table_name
            WHERE c.table_schema = 'notifications' AND t.table_type = 'BASE TABLE'
            ORDER BY c.table_name, c.ordinal_position
            """;
        var columns = new List<(string Table, string Column)>();
        await using (var reader = await tables.ExecuteReaderAsync())
        {
            while (await reader.ReadAsync())
            {
                columns.Add((reader.GetString(0), reader.GetString(1)));
            }
        }

        var dump = new StringBuilder();
        foreach (var group in columns.GroupBy(column => column.Table))
        {
            var projection = string.Join(
                ", ",
                group.Select(column => $"coalesce(\"{column.Column}\"::text, '')"));
            await using var command = connection.CreateCommand();
            command.CommandText = $"SELECT concat_ws(' | ', {projection}) FROM notifications.\"{group.Key}\"";
            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                dump.AppendLine(reader.GetString(0));
            }
        }

        return dump.ToString();
    }

    /// <summary>Drains the global action-mail queue, which is what materializes account mail.</summary>
    private async Task SweepAccountMailAsync()
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        await scope.ServiceProvider
            .GetRequiredService<TB.Gym.Modules.Identity.IAccountActionMailDispatchService>()
            .DispatchDueAsync(default);
    }

    /// <summary>
    /// Drains the invitation action-mail queue and returns the link the provider was actually sent.
    /// </summary>
    private async Task<string> SweepInvitationMailAndReadLinkAsync()
    {
        var sent = Provider.Requests.Count;
        await using (var scope = RequiredFactory.Services.CreateAsyncScope())
        {
            await scope.ServiceProvider
                .GetRequiredService<TB.Gym.Modules.Invitations.IInvitationActionMailDispatchService>()
                .DispatchDueAsync(default);
        }

        Assert.IsGreaterThan(sent, Provider.Requests.Count, "The invitation mail was never submitted.");
        return ActionLinkFrom(Provider.Requests[^1].Body);
    }

    /// <summary>The action link inside the message body the adapter submitted to the provider.</summary>
    private static string ActionLinkFrom(string providerRequestBody)
    {
        using var document = System.Text.Json.JsonDocument.Parse(providerRequestBody);
        var text = document.RootElement.GetProperty("text").GetString()
            ?? throw new AssertFailedException("The provider request carried no text body.");
        var link = text
            .Split('\n', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
            .FirstOrDefault(line =>
                line.StartsWith("http", StringComparison.Ordinal) &&
                Uri.TryCreate(line, UriKind.Absolute, out _));
        Assert.IsNotNull(link, "The provider request carried no action link.");
        return link!;
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

    private static string QueryValue(string url, string key)
    {
        var query = QueryHelpers.ParseQuery(new Uri(url).Query);
        return query.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value)
            ? value.ToString()
            : throw new AssertFailedException($"The URL does not contain query value '{key}'.");
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
        return result is null or DBNull
            ? default!
            : (T)Convert.ChangeType(result, typeof(T), CultureInfo.InvariantCulture);
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

    /// <summary>Asserts one direct-SQL statement is refused by a constraint or a trigger.</summary>
    private async Task AssertRefusedAsync(
        string sql,
        string description,
        params (string Name, object Value)[] parameters)
    {
        try
        {
            await ExecuteAsync(sql, parameters);
        }
        catch (PostgresException)
        {
            return;
        }

        Assert.Fail($"The database accepted {description}, which it must refuse.");
    }

    private Task<Guid> IntentIdAsync(Guid enrollmentId, CommercialNotificationKind kind) => ScalarAsync<Guid>(
        """
        SELECT "Id" FROM notifications."OutboxItems"
        WHERE "AggregateId" = @id AND "Kind" = @kind
        """,
        ("id", enrollmentId),
        ("kind", kind.ToString()));

    private async Task<DeliveryRow> DeliveryAsync(Guid outboxItemId, NotificationChannel channel)
    {
        await using var connection = new NpgsqlConnection(RequiredConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT "Id", "Status", "AttemptCount", "FailureCode", "TransportAdapter",
                   "ProviderMessageId", "ProviderAcceptedAtUtc"
            FROM notifications."ChannelDeliveries"
            WHERE "OutboxItemId" = @id AND "Channel" = @channel
            """;
        command.Parameters.AddWithValue("id", outboxItemId);
        command.Parameters.AddWithValue("channel", channel.ToString());
        await using var reader = await command.ExecuteReaderAsync();
        Assert.IsTrue(await reader.ReadAsync(), $"The {channel} delivery was not found.");
        return new DeliveryRow(
            reader.GetGuid(0),
            reader.GetString(1),
            reader.GetInt32(2),
            reader.IsDBNull(3) ? null : reader.GetString(3),
            reader.IsDBNull(4) ? null : reader.GetString(4),
            reader.IsDBNull(5) ? null : reader.GetString(5),
            reader.IsDBNull(6) ? null : reader.GetFieldValue<DateTimeOffset>(6));
    }

    private async Task<ProviderMessageRow> ProviderMessageAsync(string providerMessageId)
    {
        await using var connection = new NpgsqlConnection(RequiredConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT "Id", "TenantId", "ChannelDeliveryId", "RecipientUserId", "Adapter",
                   "RecipientAddressFingerprint", "FingerprintKeyId", "ProviderAcceptedAtUtc",
                   "RecipientServerAcceptedAtUtc", "BouncedAtUtc", "BounceClass", "ComplainedAtUtc",
                   "DelayedAtUtc", "FailedAtUtc", "FailureCode", "ProviderSuppressedAtUtc",
                   "EventCount", "LastEventReceivedAtUtc"
            FROM notifications."ProviderMessages"
            WHERE "ProviderMessageId" = @id
            """;
        command.Parameters.AddWithValue("id", providerMessageId);
        await using var reader = await command.ExecuteReaderAsync();
        Assert.IsTrue(await reader.ReadAsync(), $"No provider message exists for '{providerMessageId}'.");
        return new ProviderMessageRow(
            reader.GetGuid(0),
            reader.GetGuid(1),
            reader.GetGuid(2),
            reader.GetGuid(3),
            reader.GetString(4),
            reader.GetString(5),
            reader.GetString(6),
            reader.GetFieldValue<DateTimeOffset>(7),
            reader.IsDBNull(8) ? null : reader.GetFieldValue<DateTimeOffset>(8),
            reader.IsDBNull(9) ? null : reader.GetFieldValue<DateTimeOffset>(9),
            reader.IsDBNull(10) ? null : reader.GetString(10),
            reader.IsDBNull(11) ? null : reader.GetFieldValue<DateTimeOffset>(11),
            reader.IsDBNull(12) ? null : reader.GetFieldValue<DateTimeOffset>(12),
            reader.IsDBNull(13) ? null : reader.GetFieldValue<DateTimeOffset>(13),
            reader.IsDBNull(14) ? null : reader.GetString(14),
            reader.IsDBNull(15) ? null : reader.GetFieldValue<DateTimeOffset>(15),
            reader.GetInt32(16),
            reader.IsDBNull(17) ? null : reader.GetFieldValue<DateTimeOffset>(17));
    }

    private async Task<IReadOnlyList<ProviderEventRow>> ProviderEventsAsync(Guid providerMessageRecordId)
    {
        await using var connection = new NpgsqlConnection(RequiredConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT "ProviderEventId", "EventType", "BounceClass", "FailureCode", "OccurredAtUtc",
                   "ReceivedAtUtc", "AppliedNewFact"
            FROM notifications."ProviderEvents"
            WHERE "ProviderMessageRecordId" = @id
            ORDER BY "ReceivedAtUtc", "ProviderEventId"
            """;
        command.Parameters.AddWithValue("id", providerMessageRecordId);
        var rows = new List<ProviderEventRow>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(new ProviderEventRow(
                reader.GetString(0),
                reader.GetString(1),
                reader.IsDBNull(2) ? null : reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetString(3),
                reader.GetFieldValue<DateTimeOffset>(4),
                reader.GetFieldValue<DateTimeOffset>(5),
                reader.GetBoolean(6)));
        }

        return rows;
    }

    private Task<long> SuppressionCountAsync(Guid userId) => ScalarAsync<long>(
        """SELECT count(*) FROM notifications."EmailSuppressions" WHERE "UserId" = @id""",
        ("id", userId));

    private Task<string> SuppressionReasonAsync(Guid userId) => ScalarAsync<string>(
        """SELECT "Reason" FROM notifications."EmailSuppressions" WHERE "UserId" = @id""",
        ("id", userId));

    private Task<long> NotificationCountAsync(Guid outboxItemId) => ScalarAsync<long>(
        """SELECT count(*) FROM notifications."Notifications" WHERE "SourceOutboxItemId" = @id""",
        ("id", outboxItemId));

    private async Task<IReadOnlyList<AttemptRow>> AttemptsAsync(Guid outboxItemId, NotificationChannel channel)
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

    // ---------- records ----------

    private sealed record Workspace(
        Guid TenantId,
        HttpClient Coach,
        HttpClient Client,
        Guid ClientProfileId,
        Guid ClientUserId,
        string ClientEmail,
        string Suffix);

    /// <summary>One additional client of an existing workspace, with their own mailbox and session.</summary>
    private sealed record Member(HttpClient Client, Guid ClientProfileId, Guid UserId, string Email);

    private sealed record Csrf(string Token);

    private sealed record Registration(string? DevelopmentConfirmationUrl);

    private sealed record Membership(Guid TenantId);

    private sealed record Invitation(string? DevelopmentActionUrl);

    private sealed record Acceptance(Guid TenantId, Guid ClientProfileId, bool SignedIn);

    private sealed record Product(Offer[] Offers);

    private sealed record Offer(Guid Id);

    private sealed record Enrollment(Guid Id, string StoredStatus, DateOnly EndDateExclusive, decimal PriceAmount, uint Version);

    private sealed record PreferenceView(
        bool InAppEnabled,
        bool EmailServiceEnabled,
        bool EmailMarketingEnabled,
        bool EmailChannelAvailable,
        bool EmailSuppressed,
        string? EmailSuppressionReason,
        bool QuietHoursEnabled,
        string? QuietHoursStartLocal,
        string? QuietHoursEndLocal,
        string TenantTimeZoneId,
        int PolicyVersion,
        uint Version);

    private sealed record DeliveryRow(
        Guid Id,
        string Status,
        int AttemptCount,
        string? FailureCode,
        string? TransportAdapter,
        string? ProviderMessageId,
        DateTimeOffset? ProviderAcceptedAtUtc);

    private sealed record ProviderMessageRow(
        Guid Id,
        Guid TenantId,
        Guid ChannelDeliveryId,
        Guid RecipientUserId,
        string Adapter,
        string RecipientAddressFingerprint,
        string FingerprintKeyId,
        DateTimeOffset ProviderAcceptedAtUtc,
        DateTimeOffset? RecipientServerAcceptedAtUtc,
        DateTimeOffset? BouncedAtUtc,
        string? BounceClass,
        DateTimeOffset? ComplainedAtUtc,
        DateTimeOffset? DelayedAtUtc,
        DateTimeOffset? FailedAtUtc,
        string? FailureCode,
        DateTimeOffset? ProviderSuppressedAtUtc,
        int EventCount,
        DateTimeOffset? LastEventReceivedAtUtc);

    private sealed record ProviderEventRow(
        string ProviderEventId,
        string EventType,
        string? BounceClass,
        string? FailureCode,
        DateTimeOffset OccurredAtUtc,
        DateTimeOffset ReceivedAtUtc,
        bool AppliedNewFact);

    private sealed record AttemptRow(
        int AttemptNumber,
        string Outcome,
        string? FailureCode,
        string IdempotencyKey,
        string? ProviderMessageId);

    /// <summary>A clock the test moves, so the retry schedule is asserted without waiting for it.</summary>
    internal sealed class MutableClock(DateTimeOffset utcNow) : IClock
    {
        private long ticks = utcNow.UtcTicks;

        public DateTimeOffset UtcNow => new(Interlocked.Read(ref ticks), TimeSpan.Zero);

        public void Advance(TimeSpan duration) => Interlocked.Add(ref ticks, duration.Ticks);
    }

    /// <summary>
    /// Holds one intent after its claim transaction committed and before materialization, so a test
    /// can change authoritative state in the gap the dispatcher must recheck across.
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
    /// A real HTTP server standing in for the provider, on a loopback port the operating system picks.
    /// </summary>
    /// <remarks>
    /// It is a server rather than a message handler on purpose. Everything worth asserting about this
    /// adapter is a property of an HTTP exchange — that the credential travels as a bearer header on
    /// the request rather than as a default on a shared client, that the idempotency key is sent and
    /// is the same on a retry, that a 429 is transient and a 422 is not, that a slow response is
    /// abandoned at the configured timeout, that an oversized or unparsable body is refused rather
    /// than half-read. A stub handler returning a canned response would prove none of it.
    /// </remarks>
    internal sealed class ProviderHttpDouble : IAsyncDisposable
    {
        private readonly WebApplication app;
        private readonly ConcurrentQueue<ProviderRequest> requests = new();

        private ProviderHttpDouble(WebApplication app, string origin)
        {
            this.app = app;
            SendEndpoint = $"{origin}/emails";
        }

        /// <summary>The absolute endpoint the adapter is configured with.</summary>
        public string SendEndpoint { get; }

        /// <summary>Every request the adapter made, in order.</summary>
        public IReadOnlyList<ProviderRequest> Requests => [.. requests];

        /// <summary>
        /// What the double answers next. Replaced per test; the default accepts and returns a
        /// provider-shaped identifier.
        /// </summary>
        public Func<int, ProviderResponse> Responder { get; set; } =
            _ => ProviderResponse.Accepted(Guid.NewGuid().ToString());

        public static async Task<ProviderHttpDouble> StartAsync()
        {
            var builder = WebApplication.CreateSlimBuilder();
            builder.Logging.ClearProviders();
            builder.WebHost.ConfigureKestrel(kestrel =>
                kestrel.Listen(IPAddress.Loopback, 0, listen => listen.Protocols = HttpProtocols.Http1));

            var app = builder.Build();
            ProviderHttpDouble? instance = null;
            app.MapPost("/emails", async (HttpContext context) =>
            {
                using var reader = new StreamReader(context.Request.Body, Encoding.UTF8);
                var body = await reader.ReadToEndAsync();
                var recorded = new ProviderRequest(
                    context.Request.Headers.Authorization.ToString(),
                    context.Request.Headers["Idempotency-Key"].ToString(),
                    context.Request.Headers.UserAgent.ToString(),
                    body);
                var response = instance!.Record(recorded);
                if (response.Delay > TimeSpan.Zero)
                {
                    await Task.Delay(response.Delay, context.RequestAborted);
                }

                context.Response.StatusCode = response.StatusCode;
                context.Response.ContentType = "application/json";
                await context.Response.WriteAsync(response.Body);
            });

            await app.StartAsync();
            var origin = app.Urls.First();
            instance = new ProviderHttpDouble(app, origin);
            return instance;
        }

        /// <summary>
        /// Forgets everything recorded so far.
        /// </summary>
        /// <remarks>
        /// Called once a test's fixtures are in place. Since Phase 6B-3C the account confirmation and
        /// invitation mail that building a workspace produces go to this same provider, so without
        /// this every assertion about "the requests this test caused" would be counting setup traffic
        /// as well.
        /// </remarks>
        public void Clear()
        {
            while (requests.TryDequeue(out _))
            {
                // Drain.
            }
        }

        public async ValueTask DisposeAsync()
        {
            await app.StopAsync();
            await app.DisposeAsync();
        }

        private ProviderResponse Record(ProviderRequest request)
        {
            requests.Enqueue(request);
            return Responder(requests.Count);
        }
    }

    internal sealed record ProviderRequest(
        string Authorization,
        string IdempotencyKey,
        string UserAgent,
        string Body);

    internal sealed record ProviderResponse(int StatusCode, string Body, TimeSpan Delay = default)
    {
        public static ProviderResponse Accepted(string providerMessageId) =>
            new(200, $"{{\"id\":\"{providerMessageId}\"}}");

        public static ProviderResponse Status(int statusCode, string body = "{\"message\":\"refused\"}") =>
            new(statusCode, body);

        public static ProviderResponse Slow(TimeSpan delay) =>
            new(200, "{\"id\":\"never-read\"}", delay);
    }
}
