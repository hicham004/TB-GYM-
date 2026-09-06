using System.Collections.Concurrent;
using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Npgsql;
using TB.Gym.Infrastructure.Application;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Invitations;
using TB.Gym.SharedKernel;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Fixture and helpers for the Phase 6B-3C tokenless action-mail tests.
/// </summary>
/// <remarks>
/// The transport is the captured adapter, so nothing here contacts a network, and the captured
/// message is the only place a token, a link or a recipient address exists at all. That is exactly
/// what makes it useful for these tests: the assertions can read what a recipient would have received
/// and then prove that none of it reached a database column or a log line.
/// <para>
/// Every sweep is driven explicitly. The API composes both dispatchers but hosts no timer for either,
/// so a test decides when materialization happens and can commit authoritative changes in the gap
/// between a claim and a send.
/// </para>
/// </remarks>
public sealed partial class Phase6B3CActionMailTests
{
    private static readonly string Password = $"Aa1!{Guid.NewGuid():N}";

    /// <summary>A fixed workspace-local morning, so tenant-today calculations never sit on midnight.</summary>
    private static readonly DateTimeOffset StartInstant = new(2026, 9, 5, 6, 0, 0, TimeSpan.Zero);

    private const string PublicOrigin = "http://localhost:4200";

    private string? adminConnection;
    private string? databaseName;
    private string? databaseConnection;
    private WebApplicationFactory<Program>? factory;
    private MutableClock? testClock;
    private CapturedLog? log;

    public TestContext TestContext { get; set; } = null!;

    [TestInitialize]
    public async Task InitializeAsync()
    {
        adminConnection = PostgreSqlTestEnvironment.RequireAdminConnection();
        databaseName = await PostgreSqlTestEnvironment.CreateDatabaseAsync("tbgym_p6b3c");
        databaseConnection = new NpgsqlConnectionStringBuilder(adminConnection)
        {
            Database = databaseName,
        }.ConnectionString;

        var clock = new MutableClock(StartInstant);
        testClock = clock;
        var capturedLog = new CapturedLog();
        log = capturedLog;

        factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Development");
            var settings = new Dictionary<string, string?>
            {
                ["ConnectionStrings:Database"] = databaseConnection,
                ["Database:ApplyMigrationsOnStartup"] = "true",
                ["Seed:Enabled"] = "false",
                ["Messaging:Realtime:Enabled"] = "false",
                ["Application:PublicBaseUrl"] = PublicOrigin,
                ["Media:StorageRoot"] = Path.Combine(Path.GetTempPath(), databaseName, "media"),
                ["Media:PurgeEnabled"] = "false",
                ["Notifications:Dispatch:PollIntervalSeconds"] = "1",
                ["Notifications:Email:Enabled"] = "false",
                ["Notifications:Email:Adapter"] = "Captured",
                ["Application:ActionMail:PollIntervalSeconds"] = "1",
                ["Application:ActionMail:BatchSize"] = "25",
                ["Application:ActionMail:ClaimLeaseSeconds"] = "120",
                ["Application:ActionMail:MaximumAttempts"] = "4",
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
            });
        });
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

    private CapturedActionEmailTransport CapturedMail =>
        RequiredFactory.Services.GetRequiredService<CapturedActionEmailTransport>();

    private HttpClient CreateClient() => RequiredFactory.CreateClient(new WebApplicationFactoryClientOptions
    {
        AllowAutoRedirect = false,
        HandleCookies = true,
        BaseAddress = new Uri("http://localhost"),
    });

    // ---------- sweeps ----------

    private async Task<AccountActionMailDispatchOutcome> SweepAccountMailAsync()
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        return await scope.ServiceProvider
            .GetRequiredService<IAccountActionMailDispatchService>()
            .DispatchDueAsync(TestContext.CancellationToken);
    }

    private async Task<InvitationActionMailDispatchOutcome> SweepInvitationMailAsync()
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        return await scope.ServiceProvider
            .GetRequiredService<IInvitationActionMailDispatchService>()
            .DispatchDueAsync(TestContext.CancellationToken);
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

    /// <summary>
    /// Registers a coach and confirms their address through the queue.
    /// </summary>
    /// <remarks>
    /// Registration returns a development confirmation link because the caller supplied the address
    /// and the captured adapter materialized the request inline. That is deliberately not true of
    /// password recovery, which is what
    /// <see cref="ResetLinkForAsync"/> exists to work around.
    /// </remarks>
    private async Task<Guid> RegisterCoachAsync(HttpClient client, string email, string workspaceName)
    {
        await RefreshCsrfAsync(client);
        var response = await client.PostAsJsonAsync(
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
        await AssertStatusAsync(response, HttpStatusCode.Accepted);
        var registration = await RequiredJsonAsync<Registration>(response);
        Assert.IsNotNull(
            registration.DevelopmentConfirmationUrl,
            "Registration must materialize its confirmation mail inline under the captured adapter.");

        await ConfirmEmailAsync(client, registration.DevelopmentConfirmationUrl!);
        await SignInAsync(client, email);
        var memberships = await client.GetFromJsonAsync<Membership[]>("/api/tenants", TestContext.CancellationToken)
            ?? throw new AssertFailedException("Workspace membership was empty.");
        SetTenant(client, memberships.Single().TenantId);
        return memberships.Single().TenantId;
    }

    private async Task ConfirmEmailAsync(HttpClient client, string confirmationUrl)
    {
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync(
                "/api/auth/confirm-email",
                new
                {
                    userId = Guid.Parse(QueryValue(confirmationUrl, "userId")),
                    code = QueryValue(confirmationUrl, "code"),
                },
                TestContext.CancellationToken),
            HttpStatusCode.NoContent);
    }

    private async Task SignInAsync(HttpClient client, string email, string? password = null)
    {
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync(
                "/api/auth/login",
                new { email, password = password ?? Password, rememberMe = false },
                TestContext.CancellationToken),
            HttpStatusCode.OK);
    }

    /// <summary>Requests a password reset and returns the public response, without sweeping.</summary>
    private async Task<HttpResponseMessage> RequestPasswordResetAsync(HttpClient client, string email)
    {
        await RefreshCsrfAsync(client);
        return await client.PostAsJsonAsync(
            "/api/auth/forgot-password",
            new { email },
            TestContext.CancellationToken);
    }

    /// <summary>
    /// Requests a password reset, drains the queue, and returns the link the recipient would have got.
    /// </summary>
    /// <remarks>
    /// The link comes from the captured transport rather than from the HTTP response, and that is the
    /// point: the response deliberately carries no link for any address, so a test that could read one
    /// from it would be testing an enumeration oracle rather than a reset flow.
    /// </remarks>
    private async Task<string?> ResetLinkForAsync(HttpClient client, string email)
    {
        var before = CapturedMail.Captured.Count;
        await AssertStatusAsync(
            await RequestPasswordResetAsync(client, email),
            HttpStatusCode.Accepted);
        await SweepAccountMailAsync();
        return CapturedMail.Captured
            .Skip(before)
            .LastOrDefault(capture => capture.Scope == ActionMailScopes.Account)
            ?.ActionUrl;
    }

    private async Task<InvitationView> CreateInvitationAsync(HttpClient coach, string email)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync(
            "/api/invitations",
            new
            {
                email,
                firstName = "Invited",
                lastName = "Client",
                phoneNumber = "+96170000000",
                birthDate = "1995-04-02",
            },
            TestContext.CancellationToken);
        await AssertStatusAsync(response, HttpStatusCode.Created);
        return await RequiredJsonAsync<InvitationView>(response);
    }

    /// <summary>
    /// Posts one deliberate resend.
    /// </summary>
    /// <remarks>
    /// It deliberately does not refresh the CSRF token. Two of these start concurrently in the race
    /// tests, and a refresh inside would have them mutating one client's default headers and
    /// antiforgery cookie while the other's request is in flight - producing 403s that say nothing
    /// about the concurrency under test. Callers refresh once, before racing.
    /// </remarks>
    private async Task<HttpResponseMessage> ResendInvitationAsync(
        HttpClient coach,
        Guid invitationId,
        Guid idempotencyKey,
        long version)
    {
        return await coach.PostAsJsonAsync(
            $"/api/invitations/{invitationId}/resend",
            new { idempotencyKey, version },
            TestContext.CancellationToken);
    }

    private async Task<HttpResponseMessage> AcceptInvitationAsync(HttpClient client, string token)
    {
        await RefreshCsrfAsync(client);
        return await client.PostAsJsonAsync(
            "/api/invitations/accept",
            new { token, displayName = "Invited Client", password = Password },
            TestContext.CancellationToken);
    }

    /// <summary>A coach with a confirmed account and an active workspace.</summary>
    private async Task<Workspace> CreateWorkspaceAsync(string label)
    {
        var suffix = Guid.NewGuid().ToString("N")[..10];
        var coach = CreateClient();
        var email = $"coach-{label}-{suffix}@tbgym.test";
        var tenantId = await RegisterCoachAsync(coach, email, $"{label} {suffix}");
        return new Workspace(tenantId, coach, email, suffix);
    }

    /// <summary>The most recent captured invitation link for one workspace's newest request.</summary>
    private string RequiredInvitationLink(int skip = 0)
    {
        var capture = CapturedMail.Captured
            .Where(item => item.Scope == ActionMailScopes.Invitation)
            .Skip(skip)
            .LastOrDefault();
        Assert.IsNotNull(capture, "No invitation mail was captured.");
        Assert.IsNotNull(capture.ActionUrl, "The captured invitation mail carried no action link.");
        return capture.ActionUrl!;
    }

    private static string TokenOf(string invitationUrl) => QueryValue(invitationUrl, "token");

    // ---------- assertions ----------

    private static async Task<T> RequiredJsonAsync<T>(HttpResponseMessage response) =>
        await response.Content.ReadFromJsonAsync<T>()
        ?? throw new AssertFailedException($"{typeof(T).Name} response was empty.");

    private static async Task AssertStatusAsync(HttpResponseMessage response, HttpStatusCode expected)
    {
        if (response.StatusCode == expected)
        {
            return;
        }

        Assert.Fail(
            $"Expected {(int)expected}, received {(int)response.StatusCode}: " +
            await response.Content.ReadAsStringAsync());
    }

    private static string QueryValue(string url, string key)
    {
        var query = QueryHelpers.ParseQuery(new Uri(url).Query);
        return query.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value)
            ? value.ToString()
            : throw new AssertFailedException($"The URL does not contain query value '{key}'.");
    }

    /// <summary>Every table the action-mail design owns, and the only place its rows can be.</summary>
    private static readonly (string Schema, string Table)[] ActionMailTables =
    [
        ("identity", "ActionMailRequests"),
        ("identity", "ActionMailAttempts"),
        ("invitations", "ActionMailRequests"),
        ("invitations", "ActionMailAttempts"),
        ("invitations", "TokenIssues"),
    ];

    /// <summary>
    /// Asserts that nothing the recipient actually received became durable or reached a log.
    /// </summary>
    /// <remarks>
    /// Two rules, because they are two different rules and merging them would make one of them false.
    /// <list type="number">
    /// <item><description>A <b>raw token, a complete action URL and a rendered body</b> may not appear
    /// <i>anywhere</i> in the identity or invitations schemas. There is no legitimate place for any of
    /// them, so the scan is over every text column of both schemas, read from the live catalogue rather
    /// than a hand-kept list — a column added later is covered automatically.</description></item>
    /// <item><description>A <b>recipient address</b> may not appear in any action-mail row. It is
    /// deliberately not forbidden everywhere: <c>identity.Users</c> is the account and
    /// <c>invitations.ClientInvitations</c> is the record of who was invited, and both are supposed to
    /// hold it. What this design refuses is copying it into a queue for delivery.</description></item>
    /// </list>
    /// The token <i>hash</i> is not forbidden at all: recording it is the whole design, and a digest
    /// cannot be presented as a credential.
    /// </remarks>
    private async Task AssertNoCredentialReachedStorageOrLogsAsync(params string[] extra)
    {
        var credentials = new List<string>(extra);
        var addresses = new List<string>();
        foreach (var capture in CapturedMail.Captured)
        {
            addresses.Add(capture.RecipientAddress);
            credentials.Add(capture.TextBody);
            if (capture.ActionUrl is not { } url)
            {
                continue;
            }

            credentials.Add(url);
            var query = QueryHelpers.ParseQuery(new Uri(url).Query);
            foreach (var key in new[] { "code", "token" })
            {
                if (query.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value))
                {
                    credentials.Add(value.ToString());
                }
            }
        }

        var everywhere = await DumpSchemaTextAsync("identity", "invitations");
        foreach (var term in Distinct(credentials))
        {
            Assert.DoesNotContain(
                term,
                everywhere,
                StringComparison.OrdinalIgnoreCase,
                $"A token, link or rendered body reached a database column: '{Abbreviate(term)}'.");
        }

        var actionMailRows = await DumpTablesTextAsync(ActionMailTables);
        foreach (var term in Distinct(addresses))
        {
            Assert.DoesNotContain(
                term,
                actionMailRows,
                StringComparison.OrdinalIgnoreCase,
                $"A recipient address was copied into an action-mail row: '{Abbreviate(term)}'.");
        }

        foreach (var term in Distinct(credentials.Concat(addresses)))
        {
            Assert.DoesNotContain(
                term,
                Log.Text,
                StringComparison.OrdinalIgnoreCase,
                $"A credential or address reached the log: '{Abbreviate(term)}'.");
        }

        static IEnumerable<string> Distinct(IEnumerable<string> values) =>
            values.Where(value => !string.IsNullOrWhiteSpace(value)).Distinct(StringComparer.Ordinal);
    }

    /// <summary>Every text value in the named tables, as one string.</summary>
    private async Task<string> DumpTablesTextAsync((string Schema, string Table)[] tables)
    {
        await using var connection = new NpgsqlConnection(RequiredConnection);
        await connection.OpenAsync(TestContext.CancellationToken);
        var dump = new StringBuilder();
        foreach (var (schema, table) in tables)
        {
            await using var columnQuery = connection.CreateCommand();
            columnQuery.CommandText = """
                SELECT column_name FROM information_schema.columns
                WHERE table_schema = @schema AND table_name = @table
                ORDER BY ordinal_position
                """;
            columnQuery.Parameters.AddWithValue("schema", schema);
            columnQuery.Parameters.AddWithValue("table", table);
            var columns = new List<string>();
            await using (var reader = await columnQuery.ExecuteReaderAsync(TestContext.CancellationToken))
            {
                while (await reader.ReadAsync(TestContext.CancellationToken))
                {
                    columns.Add(reader.GetString(0));
                }
            }

            Assert.IsNotEmpty(columns, $"{schema}.{table} does not exist, so this scan proves nothing.");
            var projection = string.Join(", ", columns.Select(column => $"coalesce(\"{column}\"::text, '')"));
            await using var rows = connection.CreateCommand();
            rows.CommandText = $"SELECT concat_ws(' | ', {projection}) FROM {schema}.\"{table}\"";
            await using var rowReader = await rows.ExecuteReaderAsync(TestContext.CancellationToken);
            while (await rowReader.ReadAsync(TestContext.CancellationToken))
            {
                dump.AppendLine(rowReader.GetString(0));
            }
        }

        return dump.ToString();
    }

    private static string Abbreviate(string value) =>
        value.Length <= 40 ? value : value[..40] + "...";

    /// <summary>Every text value in every table of the named schemas, as one string.</summary>
    private async Task<string> DumpSchemaTextAsync(params string[] schemas)
    {
        await using var connection = new NpgsqlConnection(RequiredConnection);
        await connection.OpenAsync(TestContext.CancellationToken);
        await using var tables = connection.CreateCommand();
        tables.CommandText = """
            SELECT c.table_schema, c.table_name, c.column_name
            FROM information_schema.columns c
            JOIN information_schema.tables t
              ON t.table_schema = c.table_schema AND t.table_name = c.table_name
            WHERE c.table_schema = ANY(@schemas) AND t.table_type = 'BASE TABLE'
            ORDER BY c.table_schema, c.table_name, c.ordinal_position
            """;
        tables.Parameters.AddWithValue("schemas", schemas);
        var columns = new List<(string Schema, string Table, string Column)>();
        await using (var reader = await tables.ExecuteReaderAsync(TestContext.CancellationToken))
        {
            while (await reader.ReadAsync(TestContext.CancellationToken))
            {
                columns.Add((reader.GetString(0), reader.GetString(1), reader.GetString(2)));
            }
        }

        var dump = new StringBuilder();
        foreach (var group in columns.GroupBy(column => (column.Schema, column.Table)))
        {
            var projection = string.Join(
                ", ",
                group.Select(column => $"coalesce(\"{column.Column}\"::text, '')"));
            await using var command = connection.CreateCommand();
            command.CommandText =
                $"SELECT concat_ws(' | ', {projection}) FROM {group.Key.Schema}.\"{group.Key.Table}\"";
            await using var reader = await command.ExecuteReaderAsync(TestContext.CancellationToken);
            while (await reader.ReadAsync(TestContext.CancellationToken))
            {
                dump.AppendLine(reader.GetString(0));
            }
        }

        return dump.ToString();
    }

    // ---------- direct SQL ----------

    private async Task<T> ScalarAsync<T>(string sql, params (string Name, object Value)[] parameters)
    {
        await using var connection = new NpgsqlConnection(RequiredConnection);
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
        await using var connection = new NpgsqlConnection(RequiredConnection);
        await connection.OpenAsync(TestContext.CancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        foreach (var (name, value) in parameters)
        {
            command.Parameters.AddWithValue(name, value);
        }

        await command.ExecuteNonQueryAsync(TestContext.CancellationToken);
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

    private Task<long> TokenIssueCountAsync(Guid invitationId) => ScalarAsync<long>(
        """SELECT count(*) FROM invitations."TokenIssues" WHERE "InvitationId" = @id""",
        ("id", invitationId));

    private Task<int> GenerationAsync(Guid invitationId) => ScalarAsync<int>(
        """SELECT "LogicalSendGeneration" FROM invitations."ClientInvitations" WHERE "Id" = @id""",
        ("id", invitationId));

    private async Task<IReadOnlyList<TokenIssueRow>> TokenIssuesAsync(Guid invitationId)
    {
        await using var connection = new NpgsqlConnection(RequiredConnection);
        await connection.OpenAsync(TestContext.CancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT "TokenHash", "LogicalSendGeneration", "AttemptNumber", "RevokedAtUtc",
                   "RevocationReason", "RedeemedAtUtc", "IssuedAtUtc"
            FROM invitations."TokenIssues"
            WHERE "InvitationId" = @id
            ORDER BY "IssuedAtUtc", "TokenHash"
            """;
        command.Parameters.AddWithValue("id", invitationId);
        var rows = new List<TokenIssueRow>();
        await using var reader = await command.ExecuteReaderAsync(TestContext.CancellationToken);
        while (await reader.ReadAsync(TestContext.CancellationToken))
        {
            rows.Add(new TokenIssueRow(
                reader.GetString(0),
                reader.GetInt32(1),
                reader.GetInt32(2),
                reader.IsDBNull(3) ? null : reader.GetFieldValue<DateTimeOffset>(3),
                reader.IsDBNull(4) ? null : reader.GetString(4),
                reader.IsDBNull(5) ? null : reader.GetFieldValue<DateTimeOffset>(5),
                reader.GetFieldValue<DateTimeOffset>(6)));
        }

        return rows;
    }

    private async Task<IReadOnlyList<AccountRequestRow>> AccountRequestsAsync()
    {
        await using var connection = new NpgsqlConnection(RequiredConnection);
        await connection.OpenAsync(TestContext.CancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT "Id", "ActionKind", "Status", "AttemptCount", "FailureCode",
                   "SubjectUserId", "SubjectSecurityStampHash", "TransportAdapter", "RequestSource"
            FROM identity."ActionMailRequests"
            ORDER BY "RequestedAtUtc", "Id"
            """;
        var rows = new List<AccountRequestRow>();
        await using var reader = await command.ExecuteReaderAsync(TestContext.CancellationToken);
        while (await reader.ReadAsync(TestContext.CancellationToken))
        {
            rows.Add(new AccountRequestRow(
                reader.GetGuid(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetInt32(3),
                reader.IsDBNull(4) ? null : reader.GetString(4),
                reader.IsDBNull(5) ? null : reader.GetGuid(5),
                reader.IsDBNull(6) ? null : reader.GetString(6),
                reader.IsDBNull(7) ? null : reader.GetString(7),
                reader.GetString(8)));
        }

        return rows;
    }

    private async Task<IReadOnlyList<InvitationRequestRow>> InvitationRequestsAsync(Guid invitationId)
    {
        await using var connection = new NpgsqlConnection(RequiredConnection);
        await connection.OpenAsync(TestContext.CancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT "Id", "LogicalSendGeneration", "Status", "AttemptCount", "FailureCode", "RequestSource"
            FROM invitations."ActionMailRequests"
            WHERE "InvitationId" = @id
            ORDER BY "LogicalSendGeneration"
            """;
        command.Parameters.AddWithValue("id", invitationId);
        var rows = new List<InvitationRequestRow>();
        await using var reader = await command.ExecuteReaderAsync(TestContext.CancellationToken);
        while (await reader.ReadAsync(TestContext.CancellationToken))
        {
            rows.Add(new InvitationRequestRow(
                reader.GetGuid(0),
                reader.GetInt32(1),
                reader.GetString(2),
                reader.GetInt32(3),
                reader.IsDBNull(4) ? null : reader.GetString(4),
                reader.GetString(5)));
        }

        return rows;
    }

    private async Task<IReadOnlyList<string>> InvitationProviderKeysAsync(Guid invitationId)
    {
        await using var connection = new NpgsqlConnection(RequiredConnection);
        await connection.OpenAsync(TestContext.CancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT a."ProviderIdempotencyKey"
            FROM invitations."ActionMailAttempts" a
            WHERE a."InvitationId" = @id
            ORDER BY a."StartedAtUtc", a."AttemptNumber"
            """;
        command.Parameters.AddWithValue("id", invitationId);
        var keys = new List<string>();
        await using var reader = await command.ExecuteReaderAsync(TestContext.CancellationToken);
        while (await reader.ReadAsync(TestContext.CancellationToken))
        {
            keys.Add(reader.GetString(0));
        }

        return keys;
    }

    // ---------- records ----------

    private sealed record Workspace(Guid TenantId, HttpClient Coach, string CoachEmail, string Suffix);

    private sealed record Csrf(string Token);

    private sealed record Registration(string? DevelopmentConfirmationUrl);

    private sealed record Membership(Guid TenantId);

    private sealed record InvitationView(
        Guid Id,
        string Email,
        string Status,
        DateTimeOffset ExpiresAtUtc,
        int SendCount,
        int LogicalSendGeneration,
        long Version,
        string? DevelopmentActionUrl);

    private sealed record TokenIssueRow(
        string TokenHash,
        int LogicalSendGeneration,
        int AttemptNumber,
        DateTimeOffset? RevokedAtUtc,
        string? RevocationReason,
        DateTimeOffset? RedeemedAtUtc,
        DateTimeOffset IssuedAtUtc);

    private sealed record AccountRequestRow(
        Guid Id,
        string ActionKind,
        string Status,
        int AttemptCount,
        string? FailureCode,
        Guid? SubjectUserId,
        string? SubjectSecurityStampHash,
        string? TransportAdapter,
        string RequestSource);

    private sealed record InvitationRequestRow(
        Guid Id,
        int LogicalSendGeneration,
        string Status,
        int AttemptCount,
        string? FailureCode,
        string RequestSource);

    // ---------- test doubles ----------

    internal sealed class MutableClock(DateTimeOffset utcNow) : IClock
    {
        private long ticks = utcNow.UtcTicks;

        public DateTimeOffset UtcNow => new(Interlocked.Read(ref ticks), TimeSpan.Zero);

        public void Advance(TimeSpan duration) => Interlocked.Add(ref ticks, duration.Ticks);
    }

    internal sealed class CapturedLog : ILoggerProvider
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
