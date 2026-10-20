using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Configuration;
using Npgsql;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Audit batch A11a, sign-up and the signed-out words (docs/FULL-AUDIT-2026-10.md, section 11, Batch 11): the
/// anonymous routes stop telling a caller about an account they cannot sign in to (BEB-4, SEC-9, the lead's
/// call): sign-in reads the password before it says an account waits for its confirmation, and confirm-email
/// judges only the link, whatever the account. Registration still says an email is taken, the accepted
/// trade-off of a registration form, and now says what to do next (AUTH-9).
/// </summary>
[TestClass]
public sealed class A11aSignUpTests
{
    private const string WrongPassword = "Not-The-Password-2026!";

    private static readonly string Password = $"Aa1!{Guid.NewGuid():N}";

    private string? adminConnection;
    private string? databaseName;
    private string? databaseConnection;
    private WebApplicationFactory<Program>? factory;

    public TestContext TestContext { get; set; } = null!;

    [TestInitialize]
    public async Task InitializeAsync()
    {
        adminConnection = PostgreSqlTestEnvironment.RequireAdminConnection();
        databaseName = await PostgreSqlTestEnvironment.CreateMigratedDatabaseAsync("tbgym_a11a");
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
    public async Task ASignInToAnUnconfirmedAccountReadsThePasswordBeforeSayingItWaitsForConfirmation()
    {
        Start();
        await RegisterAsync("a11a-waiting@example.test");
        using var client = CreateClient();

        // Anybody can type the email. Without its password the answer is the one an unknown email gets.
        var unknown = await SignInAsync(client, "a11a-nobody@example.test", WrongPassword);
        var wrong = await SignInAsync(client, "a11a-waiting@example.test", WrongPassword);
        Assert.AreEqual(HttpStatusCode.Unauthorized, unknown.StatusCode);
        Assert.AreEqual(HttpStatusCode.Unauthorized, wrong.StatusCode);
        Assert.AreEqual(await unknown.Content.ReadAsStringAsync(), await wrong.Content.ReadAsStringAsync());
        Assert.AreEqual("invalid_credentials", (await BodyAsync(wrong)).GetProperty("code").GetString());

        // With its password, the account says what it is waiting for.
        var waiting = await SignInAsync(client, "a11a-waiting@example.test", Password);
        Assert.AreEqual(HttpStatusCode.Forbidden, waiting.StatusCode);
        var body = await BodyAsync(waiting);
        Assert.AreEqual("email_not_confirmed", body.GetProperty("code").GetString());
        Assert.AreEqual("Confirm your email before signing in.", body.GetProperty("message").GetString());
        Assert.IsFalse(AuthCookieSet(waiting), "Nobody is signed in.");
    }

    [TestMethod]
    public async Task AnUnconfirmedAccountsWrongPasswordsLockItAsAConfirmedAccountsDo()
    {
        Start();
        await RegisterAsync("a11a-locks@example.test");
        using var client = CreateClient();

        // The right password clears the count, as it does for a confirmed account.
        for (var attempt = 1; attempt <= 3; attempt++)
        {
            Assert.AreEqual(HttpStatusCode.Unauthorized, (await SignInAsync(client, "a11a-locks@example.test", WrongPassword)).StatusCode);
        }

        Assert.AreEqual(HttpStatusCode.Forbidden, (await SignInAsync(client, "a11a-locks@example.test", Password)).StatusCode);
        for (var attempt = 1; attempt <= 4; attempt++)
        {
            var refused = await SignInAsync(client, "a11a-locks@example.test", WrongPassword);
            Assert.AreEqual(HttpStatusCode.Unauthorized, refused.StatusCode, $"Attempt {attempt} after the right password.");
        }

        // The fifth wrong password in a row locks it, and the right one then says so, as for any account.
        await AssertLockedAsync(await SignInAsync(client, "a11a-locks@example.test", WrongPassword));
        await AssertLockedAsync(await SignInAsync(client, "a11a-locks@example.test", Password));
    }

    [TestMethod]
    public async Task ConfirmEmailAnswersABadCodeAlikeForEveryAccountAndTheRealLinkEveryTime()
    {
        Start();
        var waiting = await RegisterAsync("a11a-confirm-waiting@example.test");
        var confirmed = await RegisterAsync("a11a-confirm-done@example.test");
        using var visitor = CreateClient();
        await AssertStatusAsync(await ConfirmAsync(visitor, confirmed.UserId, confirmed.Code), HttpStatusCode.NoContent);

        // A code that is not the link's reads the same for an unknown, a waiting and a confirmed account,
        // where a confirmed account answered 204 to any code at all (SEC-9).
        var badCode = Base64Url("not-the-code");
        var answers = new List<string>();
        foreach (var (userId, code) in new[]
        {
            (Guid.NewGuid(), badCode),
            (waiting.UserId, badCode),
            (confirmed.UserId, badCode),
            (confirmed.UserId, "%%% not base64 %%%"),
        })
        {
            var refused = await ConfirmAsync(visitor, userId, code);
            Assert.AreEqual(HttpStatusCode.BadRequest, refused.StatusCode, $"User {userId}.");
            answers.Add(await refused.Content.ReadAsStringAsync());
        }

        Assert.AreEqual(1, answers.Distinct().Count(), string.Join(Environment.NewLine, answers));
        using (var answer = JsonDocument.Parse(answers[0]))
        {
            Assert.AreEqual("invalid_or_expired_token", answer.RootElement.GetProperty("code").GetString());
            Assert.AreEqual("This confirmation link has expired or was already used.", answer.RootElement.GetProperty("message").GetString());
        }

        // The real link still confirms, and tapped again still answers 204.
        await AssertStatusAsync(await ConfirmAsync(visitor, waiting.UserId, waiting.Code), HttpStatusCode.NoContent);
        await AssertStatusAsync(await ConfirmAsync(visitor, confirmed.UserId, confirmed.Code), HttpStatusCode.NoContent);
        Assert.AreEqual(HttpStatusCode.OK, (await SignInAsync(visitor, "a11a-confirm-waiting@example.test", Password)).StatusCode);
    }

    [TestMethod]
    public async Task ATakenEmailAtRegistrationSaysSoWithTheNextStep()
    {
        Start();
        await RegisterAsync("a11a-taken@example.test");
        using var visitor = CreateClient();

        var again = await PostRegistrationAsync(visitor, "A11a-Taken@Example.test");
        Assert.AreEqual(HttpStatusCode.Conflict, again.StatusCode);
        var body = await BodyAsync(again);
        Assert.AreEqual("email_already_registered", body.GetProperty("code").GetString());
        Assert.AreEqual(
            "An account already uses this email. Sign in with it, or reset its password if you've forgotten it.",
            body.GetProperty("message").GetString());
    }

    // ---------- the host ----------

    private void Start()
    {
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
            };
            foreach (var (key, value) in settings)
            {
                builder.UseSetting(key, value);
            }

            builder.ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(settings));
        });
    }

    private WebApplicationFactory<Program> RequiredFactory =>
        factory ?? throw new InvalidOperationException("The test application is not initialized.");

    private HttpClient CreateClient() => RequiredFactory.CreateClient(new WebApplicationFactoryClientOptions
    {
        AllowAutoRedirect = false,
        HandleCookies = true,
        BaseAddress = new Uri("http://localhost"),
    });

    // ---------- accounts ----------

    private sealed record Registered(Guid UserId, string Code);

    private async Task<HttpResponseMessage> PostRegistrationAsync(HttpClient client, string email)
    {
        await RefreshCsrfAsync(client);
        return await client.PostAsJsonAsync(
            "/api/auth/register/coach",
            new
            {
                displayName = "A11a Coach",
                email,
                password = Password,
                workspaceName = "A11a Gym " + email,
                timeZoneId = "Asia/Beirut",
                defaultCulture = "en-LB",
                defaultCurrencyCode = "USD",
                weekStartsOn = "Monday",
            },
            TestContext.CancellationToken);
    }

    /// <summary>Registers an account, left unconfirmed, and returns its confirmation link's id and code.</summary>
    private async Task<Registered> RegisterAsync(string email)
    {
        using var visitor = CreateClient();
        var registration = await PostRegistrationAsync(visitor, email);
        Assert.AreEqual(HttpStatusCode.Accepted, registration.StatusCode, await registration.Content.ReadAsStringAsync());
        var link = (await BodyAsync(registration)).GetProperty("developmentConfirmationUrl").GetString()
            ?? throw new AssertFailedException("Development registration returns its confirmation link.");
        var query = QueryHelpers.ParseQuery(new Uri(link).Query);
        return new Registered(Guid.Parse(query["userId"].ToString()), query["code"].ToString());
    }

    private async Task<HttpResponseMessage> SignInAsync(HttpClient client, string email, string password)
    {
        await RefreshCsrfAsync(client);
        return await client.PostAsJsonAsync(
            "/api/auth/login",
            new { email, password, rememberMe = false },
            TestContext.CancellationToken);
    }

    private async Task<HttpResponseMessage> ConfirmAsync(HttpClient client, Guid userId, string code)
    {
        await RefreshCsrfAsync(client);
        return await client.PostAsJsonAsync(
            "/api/auth/confirm-email",
            new { userId, code },
            TestContext.CancellationToken);
    }

    private static async Task RefreshCsrfAsync(HttpClient client)
    {
        var csrf = await client.GetFromJsonAsync<JsonElement>("/api/auth/csrf");
        client.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
        client.DefaultRequestHeaders.Add("X-XSRF-TOKEN", csrf.GetProperty("token").GetString());
    }

    private static string Base64Url(string text) =>
        WebEncoders.Base64UrlEncode(System.Text.Encoding.UTF8.GetBytes(text));

    // ---------- answers ----------

    private async Task<JsonElement> BodyAsync(HttpResponseMessage response) =>
        await response.Content.ReadFromJsonAsync<JsonElement>(TestContext.CancellationToken);

    private static async Task AssertStatusAsync(HttpResponseMessage response, HttpStatusCode status) =>
        Assert.AreEqual(status, response.StatusCode, await response.Content.ReadAsStringAsync());

    private async Task AssertLockedAsync(HttpResponseMessage response)
    {
        Assert.AreEqual(HttpStatusCode.TooManyRequests, response.StatusCode);
        Assert.AreEqual("account_locked", (await BodyAsync(response)).GetProperty("code").GetString());
        var retryAfter = response.Headers.RetryAfter?.Delta
            ?? throw new AssertFailedException("A locked account must say when to try again.");
        Assert.IsTrue(
            retryAfter > TimeSpan.FromMinutes(14) && retryAfter <= TimeSpan.FromMinutes(15),
            $"Retry-After was {retryAfter}; the lock lasts fifteen minutes.");
    }

    private static bool AuthCookieSet(HttpResponseMessage response) =>
        response.Headers.TryGetValues("Set-Cookie", out var cookies)
        && cookies.Any(cookie => cookie.StartsWith("tb-gym.auth=", StringComparison.Ordinal));
}
