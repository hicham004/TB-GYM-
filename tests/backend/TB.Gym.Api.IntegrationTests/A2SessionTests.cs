using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TB.Gym.Modules.Identity;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Audit batch A2, the session: a locked account and a rate-limited sign-in each say what happened and
/// when to try again (AUTH-2, AUTH-15), and "Keep me signed in" keeps the sign-in for 30 days, renewed
/// while it is used, while an unticked sign-in stays an 8-hour browser session (AUTH-3, the owner's
/// decision of 2026-10-19), with Sign out everywhere and a password change still ending either at once.
/// </summary>
[TestClass]
public sealed class A2SessionTests
{
    private const string AuthCookieName = "tb-gym.auth";

    private static readonly string Password = $"Aa1!{Guid.NewGuid():N}";

    private string? adminConnection;
    private string? databaseName;
    private string? databaseConnection;
    private WebApplicationFactory<Program>? factory;
    private SteppedTime? time;

    public TestContext TestContext { get; set; } = null!;

    [TestInitialize]
    public async Task InitializeAsync()
    {
        adminConnection = PostgreSqlTestEnvironment.RequireAdminConnection();
        databaseName = await PostgreSqlTestEnvironment.CreateMigratedDatabaseAsync("tbgym_a2");
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
    public async Task ALockedAccountSaysSoWithTheTimeLeftWhicheverPasswordIsTyped()
    {
        Start();
        await RegisterConfirmedAsync("a2-locked@example.test");
        await RegisterConfirmedAsync("a2-other@example.test");
        using var client = CreateClient();

        for (var attempt = 1; attempt <= 4; attempt++)
        {
            var wrong = await SignInAsync(client, "a2-locked@example.test", "Not-The-Password-2026!");
            Assert.AreEqual(HttpStatusCode.Unauthorized, wrong.StatusCode, $"Attempt {attempt}.");
            Assert.AreEqual("invalid_credentials", (await BodyAsync(wrong)).GetProperty("code").GetString());
        }

        // The fifth wrong password locks the account for Identity's fifteen minutes, and says so.
        var locking = await SignInAsync(client, "a2-locked@example.test", "Not-The-Password-2026!");
        await AssertLockedAsync(locking);

        // The right password changes nothing until the lock runs out, and is not called wrong.
        var body = await AssertLockedAsync(await SignInAsync(client, "a2-locked@example.test", Password));
        Assert.AreEqual(
            "This account is locked after too many wrong passwords. Try again in 15 minutes.",
            body.GetProperty("message").GetString());

        // The lock is the account's alone.
        using var other = CreateClient();
        Assert.AreEqual(HttpStatusCode.OK, (await SignInAsync(other, "a2-other@example.test", Password)).StatusCode);
    }

    [TestMethod]
    public async Task ARateLimitedSignInOrRegistrationSaysTooManyAttemptsWithRetryAfter()
    {
        Start();
        using var client = CreateClient();
        for (var attempt = 1; attempt <= 30; attempt++)
        {
            var response = await SignInAsync(client, $"missing-{attempt}@example.test", Password);
            Assert.AreEqual(HttpStatusCode.Unauthorized, response.StatusCode, $"Attempt {attempt}.");
        }

        var refused = await AssertTooManyAttemptsAsync(await SignInAsync(client, "still-missing@example.test", Password));
        Assert.AreEqual(
            "Too many attempts from this network. Try again in a minute.",
            refused.GetProperty("message").GetString());

        // Registration counts against the same allowance and is refused in the same words.
        await AssertTooManyAttemptsAsync(await RegisterAsync(client, "a2-limited@example.test"));
    }

    [TestMethod]
    public async Task KeepMeSignedInLastsThirtyDaysRenewedWhileUsedAndAnUntickedSignInStaysAnEightHourBrowserSession()
    {
        Start();
        await RegisterConfirmedAsync("a2-kept@example.test");
        await RegisterConfirmedAsync("a2-session@example.test");
        using var kept = CreateClient();
        using var session = CreateClient();

        var keptSignIn = await SignInAsync(kept, "a2-kept@example.test", Password, rememberMe: true);
        Assert.AreEqual(HttpStatusCode.OK, keptSignIn.StatusCode);
        AssertExpiresAbout(keptSignIn, Time.GetUtcNow().AddDays(30));

        // Unticked: a cookie the browser drops when it closes, with no date of its own.
        var sessionSignIn = await SignInAsync(session, "a2-session@example.test", Password);
        Assert.AreEqual(HttpStatusCode.OK, sessionSignIn.StatusCode);
        Assert.IsFalse(
            AuthCookie(sessionSignIn).Contains("expires=", StringComparison.OrdinalIgnoreCase),
            "An unticked sign-in must stay a browser session.");

        // The 8 hours slide with use, as they always did.
        Time.Advance(TimeSpan.FromHours(7));
        Assert.IsTrue(await SignedInAsync(session));
        Time.Advance(TimeSpan.FromHours(7));
        Assert.IsTrue(await SignedInAsync(session));

        // Nine hours without use end the unticked sign-in; the kept one is still there and renewed.
        Time.Advance(TimeSpan.FromHours(9));
        Assert.IsFalse(await SignedInAsync(session));
        var keptAfterNight = await MeAsync(kept);
        Assert.IsTrue(await NamesAnAccountAsync(keptAfterNight));
        AssertExpiresAbout(keptAfterNight, Time.GetUtcNow().AddDays(30));

        // Used within its 30 days it keeps going; 30 days without use end it.
        Time.Advance(TimeSpan.FromDays(29));
        Assert.IsTrue(await SignedInAsync(kept));
        Time.Advance(TimeSpan.FromDays(29));
        Assert.IsTrue(await SignedInAsync(kept));
        Time.Advance(TimeSpan.FromDays(31));
        Assert.IsFalse(await SignedInAsync(kept));
    }

    [TestMethod]
    public async Task SignOutEverywhereAndAPasswordChangeStillEndAThirtyDaySignInAtOnce()
    {
        Start();
        await RegisterConfirmedAsync("a2-revoked@example.test");
        using var phone = CreateClient();
        using var laptop = CreateClient();
        Assert.AreEqual(HttpStatusCode.OK, (await SignInAsync(phone, "a2-revoked@example.test", Password, rememberMe: true)).StatusCode);
        Assert.AreEqual(HttpStatusCode.OK, (await SignInAsync(laptop, "a2-revoked@example.test", Password, rememberMe: true)).StatusCode);

        // A password changed on the phone ends the laptop's 30-day sign-in and keeps the phone's.
        Time.Advance(TimeSpan.FromSeconds(1));
        const string newPassword = "Bb2@new-password-2026";
        await RefreshCsrfAsync(phone);
        var changed = await phone.PostAsJsonAsync(
            "/api/auth/change-password",
            new { currentPassword = Password, newPassword },
            TestContext.CancellationToken);
        Assert.AreEqual(HttpStatusCode.NoContent, changed.StatusCode, await changed.Content.ReadAsStringAsync());
        Time.Advance(TimeSpan.FromSeconds(1));
        Assert.IsFalse(await SignedInAsync(laptop));
        Assert.IsTrue(await SignedInAsync(phone));

        // Sign out everywhere, from the laptop signed in again, ends both.
        Assert.AreEqual(HttpStatusCode.OK, (await SignInAsync(laptop, "a2-revoked@example.test", newPassword, rememberMe: true)).StatusCode);
        Time.Advance(TimeSpan.FromSeconds(1));
        await RefreshCsrfAsync(laptop);
        var revoked = await laptop.PostAsync("/api/auth/sessions/revoke-all", content: null, TestContext.CancellationToken);
        Assert.AreEqual(HttpStatusCode.NoContent, revoked.StatusCode);
        Time.Advance(TimeSpan.FromSeconds(1));
        Assert.IsFalse(await SignedInAsync(phone));
        Assert.IsFalse(await SignedInAsync(laptop));
    }

    // ---------- the host ----------

    /// <summary>
    /// The sign-in cookie and the security stamp check run on one stepped clock, which starts at the real
    /// time: the test client's cookie jar judges a cookie's date by the real clock.
    /// </summary>
    private void Start()
    {
        var steppedTime = time = new SteppedTime(DateTimeOffset.UtcNow);
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
            builder.ConfigureServices(services =>
            {
                services.PostConfigure<CookieAuthenticationOptions>(
                    IdentityConstants.ApplicationScheme,
                    options => options.TimeProvider = steppedTime);
                services.PostConfigure<SecurityStampValidatorOptions>(options => options.TimeProvider = steppedTime);
            });
        });
    }

    private WebApplicationFactory<Program> RequiredFactory =>
        factory ?? throw new InvalidOperationException("The test application is not initialized.");

    private SteppedTime Time => time ?? throw new InvalidOperationException("The test clock is not initialized.");

    private HttpClient CreateClient() => RequiredFactory.CreateClient(new WebApplicationFactoryClientOptions
    {
        AllowAutoRedirect = false,
        HandleCookies = true,
        BaseAddress = new Uri("http://localhost"),
    });

    // ---------- accounts ----------

    private async Task<HttpResponseMessage> RegisterAsync(HttpClient client, string email)
    {
        await RefreshCsrfAsync(client);
        return await client.PostAsJsonAsync(
            "/api/auth/register/coach",
            new
            {
                displayName = "A2 Coach",
                email,
                password = Password,
                workspaceName = "A2 Gym " + email,
                timeZoneId = "Asia/Beirut",
                defaultCulture = "en-LB",
                defaultCurrencyCode = "USD",
                weekStartsOn = "Monday",
            },
            TestContext.CancellationToken);
    }

    /// <summary>Registers an account and marks it confirmed directly, as the emailed link would.</summary>
    private async Task RegisterConfirmedAsync(string email)
    {
        using var visitor = CreateClient();
        var registration = await RegisterAsync(visitor, email);
        Assert.AreEqual(HttpStatusCode.Accepted, registration.StatusCode, await registration.Content.ReadAsStringAsync());
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var user = await users.FindByEmailAsync(email) ?? throw new AssertFailedException($"{email} was not registered.");
        user.EmailConfirmed = true;
        Assert.IsTrue((await users.UpdateAsync(user)).Succeeded);
    }

    private async Task<HttpResponseMessage> SignInAsync(
        HttpClient client,
        string email,
        string password,
        bool rememberMe = false)
    {
        await RefreshCsrfAsync(client);
        return await client.PostAsJsonAsync(
            "/api/auth/login",
            new { email, password, rememberMe },
            TestContext.CancellationToken);
    }

    private Task<HttpResponseMessage> MeAsync(HttpClient client) =>
        client.GetAsync("/api/auth/me", TestContext.CancellationToken);

    /// <summary>Whether the session check names an account for this client's cookie.</summary>
    private async Task<bool> SignedInAsync(HttpClient client) => await NamesAnAccountAsync(await MeAsync(client));

    /// <summary>
    /// The session check answers 200 either way: the account, or JSON null for nobody (audit AUTH-12), which
    /// is how an ended session reads now that a 401 no longer says it.
    /// </summary>
    private async Task<bool> NamesAnAccountAsync(HttpResponseMessage response)
    {
        Assert.AreEqual(HttpStatusCode.OK, response.StatusCode, "The session check answers 200, somebody or nobody.");
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(TestContext.CancellationToken);
        return body.ValueKind == JsonValueKind.Object;
    }

    private static async Task RefreshCsrfAsync(HttpClient client)
    {
        var csrf = await client.GetFromJsonAsync<JsonElement>("/api/auth/csrf");
        client.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
        client.DefaultRequestHeaders.Add("X-XSRF-TOKEN", csrf.GetProperty("token").GetString());
    }

    // ---------- answers ----------

    private async Task<JsonElement> BodyAsync(HttpResponseMessage response) =>
        await response.Content.ReadFromJsonAsync<JsonElement>(TestContext.CancellationToken);

    private async Task<JsonElement> AssertLockedAsync(HttpResponseMessage response)
    {
        Assert.AreEqual(HttpStatusCode.TooManyRequests, response.StatusCode);
        var body = await BodyAsync(response);
        Assert.AreEqual("account_locked", body.GetProperty("code").GetString());
        var retryAfter = response.Headers.RetryAfter?.Delta
            ?? throw new AssertFailedException("A locked account must say when to try again.");
        Assert.IsTrue(
            retryAfter > TimeSpan.FromMinutes(14) && retryAfter <= TimeSpan.FromMinutes(15),
            $"Retry-After was {retryAfter}; the lock lasts fifteen minutes.");
        return body;
    }

    private async Task<JsonElement> AssertTooManyAttemptsAsync(HttpResponseMessage response)
    {
        Assert.AreEqual(HttpStatusCode.TooManyRequests, response.StatusCode);
        var body = await BodyAsync(response);
        Assert.AreEqual("too_many_attempts", body.GetProperty("code").GetString());
        var retryAfter = response.Headers.RetryAfter?.Delta
            ?? throw new AssertFailedException("A refused attempt must say when to try again.");
        Assert.IsTrue(
            retryAfter > TimeSpan.Zero && retryAfter <= TimeSpan.FromMinutes(1),
            $"Retry-After was {retryAfter}; the window is a minute.");
        return body;
    }

    private static string AuthCookie(HttpResponseMessage response) =>
        response.Headers.TryGetValues("Set-Cookie", out var cookies)
            ? cookies.FirstOrDefault(cookie => cookie.StartsWith(AuthCookieName + "=", StringComparison.Ordinal))
                ?? throw new AssertFailedException("The answer did not set the sign-in cookie.")
            : throw new AssertFailedException("The answer set no cookie.");

    private static void AssertExpiresAbout(HttpResponseMessage response, DateTimeOffset expected)
    {
        var expires = AuthCookie(response)
            .Split(';', StringSplitOptions.TrimEntries)
            .FirstOrDefault(part => part.StartsWith("expires=", StringComparison.OrdinalIgnoreCase))
            ?? throw new AssertFailedException("A kept sign-in must carry its own date.");
        var date = DateTimeOffset.Parse(expires["expires=".Length..], CultureInfo.InvariantCulture);
        Assert.IsTrue(
            (date - expected).Duration() < TimeSpan.FromMinutes(1),
            $"The cookie ends {date:u}; expected about {expected:u}.");
    }

    /// <summary>A clock that moves only when the test says so.</summary>
    private sealed class SteppedTime(DateTimeOffset start) : TimeProvider
    {
        private DateTimeOffset now = start;

        public override DateTimeOffset GetUtcNow() => now;

        public void Advance(TimeSpan by) => now += by;
    }
}
