using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Configuration;
using Npgsql;

namespace TB.Gym.Api.IntegrationTests;

[TestClass]
public sealed class Phase1WorkflowTests
{
    private static readonly string Password = $"Aa1!{Guid.NewGuid():N}";

    private string? adminConnection;
    private string? databaseName;
    private string? databaseConnection;
    private WebApplicationFactory<Program>? factory;

    [TestInitialize]
    public async Task InitializeAsync()
    {
        adminConnection = PostgreSqlTestEnvironment.RequireAdminConnection();
        databaseName = await PostgreSqlTestEnvironment.CreateDatabaseAsync("tbgym_p1");

        databaseConnection = new NpgsqlConnectionStringBuilder(adminConnection)
        {
            Database = databaseName,
        }.ConnectionString;

        factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                builder.UseEnvironment("Development");
                builder.UseSetting("ConnectionStrings:Database", databaseConnection);
                builder.UseSetting("Database:ApplyMigrationsOnStartup", "true");
                builder.UseSetting("Seed:Enabled", "false");
                builder.UseSetting("Messaging:Realtime:Enabled", "false");
                builder.ConfigureAppConfiguration((_, configuration) =>
                    configuration.AddInMemoryCollection(new Dictionary<string, string?>
                    {
                        ["ConnectionStrings:Database"] = databaseConnection,
                        ["Database:ApplyMigrationsOnStartup"] = "true",
                        ["Seed:Enabled"] = "false",
                        // Phase 6B-2B added an API-hosted realtime sweep. It is switched off here for the same
                        // reason the media purge is: a background tick must not race an assertion about what one
                        // request did. The realtime rows these commands write are still written.
                        ["Messaging:Realtime:Enabled"] = "false",
                        ["Application:PublicBaseUrl"] = "http://localhost:4200",
                    }));
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

        await using var connection = new NpgsqlConnection(adminConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = $"DROP DATABASE IF EXISTS \"{databaseName}\" WITH (FORCE)";
        await command.ExecuteNonQueryAsync();
    }

    [TestMethod]
    public async Task CoachInvitationAcceptanceOnboardingAndTenantIsolationWorkEndToEnd()
    {
        using var coachA = CreateClient();
        var workspaceA = await RegisterConfirmAndLoginCoachAsync(
            coachA,
            "coach-a@example.test",
            "Coach A",
            "Coach A Workspace");

        var invitationA = await CreateInvitationAsync(coachA, "client@example.test");
        Assert.IsNotNull(invitationA.DevelopmentActionUrl);
        var tokenA = QueryValue(invitationA.DevelopmentActionUrl, "token");
        await AssertTokenIsStoredOnlyAsHashAsync(tokenA);

        using var client = CreateClient();
        var publicInvitation = await client.GetFromJsonAsync<PublicInvitation>(
            $"/api/invitations/public/{Uri.EscapeDataString(tokenA)}");
        Assert.IsNotNull(publicInvitation);
        Assert.IsFalse(publicInvitation.RequiresExistingAccountSignIn);

        await RefreshCsrfAsync(client);
        var acceptedAResponse = await client.PostAsJsonAsync(
            "/api/invitations/accept",
            new { token = tokenA, displayName = "Client One", password = Password });
        await AssertStatusAsync(acceptedAResponse, HttpStatusCode.OK);
        var acceptedA = await acceptedAResponse.Content.ReadFromJsonAsync<InvitationAcceptance>();
        Assert.IsNotNull(acceptedA);
        Assert.AreEqual(workspaceA, acceptedA.TenantId);
        Assert.IsTrue(acceptedA.SignedIn);

        client.DefaultRequestHeaders.Add("X-Tenant-Id", workspaceA.ToString());
        var selfProfile = await client.GetFromJsonAsync<ClientProfile>("/api/client-profile/me");
        Assert.IsNotNull(selfProfile);

        await RefreshCsrfAsync(client);
        var completeResponse = await client.PostAsJsonAsync(
            "/api/client-profile/me/complete-onboarding",
            CompleteOnboardingRequest(selfProfile.Version));
        await AssertStatusAsync(completeResponse, HttpStatusCode.OK);
        var completedProfile = await completeResponse.Content.ReadFromJsonAsync<ClientProfile>();
        Assert.IsNotNull(completedProfile);
        Assert.AreEqual("Completed", completedProfile.OnboardingStatus);

        var clientsA = await coachA.GetFromJsonAsync<ClientSummary[]>("/api/clients");
        Assert.IsNotNull(clientsA);
        Assert.HasCount(1, clientsA);
        Assert.AreEqual(completedProfile.Id, clientsA[0].Id);

        using var coachB = CreateClient();
        var workspaceB = await RegisterConfirmAndLoginCoachAsync(
            coachB,
            "coach-b@example.test",
            "Coach B",
            "Coach B Workspace");
        var invitationB = await CreateInvitationAsync(coachB, "client@example.test");
        Assert.IsNotNull(invitationB.DevelopmentActionUrl);
        var tokenB = QueryValue(invitationB.DevelopmentActionUrl, "token");

        using var anonymous = CreateClient();
        var existingAccountInvitation = await anonymous.GetFromJsonAsync<PublicInvitation>(
            $"/api/invitations/public/{Uri.EscapeDataString(tokenB)}");
        Assert.IsNotNull(existingAccountInvitation);
        Assert.IsTrue(existingAccountInvitation.RequiresExistingAccountSignIn);

        await RefreshCsrfAsync(client);
        var acceptedBResponse = await client.PostAsJsonAsync(
            "/api/invitations/accept",
            new { token = tokenB, displayName = (string?)null, password = (string?)null });
        await AssertStatusAsync(acceptedBResponse, HttpStatusCode.OK);

        var memberships = await client.GetFromJsonAsync<TenantMembership[]>("/api/tenants");
        Assert.IsNotNull(memberships);
        Assert.HasCount(2, memberships);
        Assert.IsTrue(memberships.Any(membership => membership.TenantId == workspaceA));
        Assert.IsTrue(memberships.Any(membership => membership.TenantId == workspaceB));

        var crossTenantRead = await coachB.GetAsync($"/api/clients/{completedProfile.Id}");
        Assert.AreEqual(HttpStatusCode.NotFound, crossTenantRead.StatusCode);

        var clientsB = await coachB.GetFromJsonAsync<ClientSummary[]>("/api/clients");
        Assert.IsNotNull(clientsB);
        Assert.HasCount(1, clientsB);
        Assert.AreNotEqual(completedProfile.Id, clientsB[0].Id);
    }

    private HttpClient CreateClient() =>
        RequiredFactory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
            BaseAddress = new Uri("http://localhost"),
        });

    private static async Task<Guid> RegisterConfirmAndLoginCoachAsync(
        HttpClient client,
        string email,
        string displayName,
        string workspaceName)
    {
        await RefreshCsrfAsync(client);
        var registrationResponse = await client.PostAsJsonAsync(
            "/api/auth/register/coach",
            new
            {
                displayName,
                email,
                password = Password,
                workspaceName,
                timeZoneId = "Asia/Beirut",
                defaultCulture = "en-LB",
                defaultCurrencyCode = "USD",
                weekStartsOn = "Monday",
            });
        await AssertStatusAsync(registrationResponse, HttpStatusCode.Accepted);
        var registration = await registrationResponse.Content.ReadFromJsonAsync<Registration>();
        Assert.IsNotNull(registration?.DevelopmentConfirmationUrl);

        await RefreshCsrfAsync(client);
        var confirmationResponse = await client.PostAsJsonAsync(
            "/api/auth/confirm-email",
            new
            {
                userId = Guid.Parse(QueryValue(registration.DevelopmentConfirmationUrl, "userId")),
                code = QueryValue(registration.DevelopmentConfirmationUrl, "code"),
            });
        await AssertStatusAsync(confirmationResponse, HttpStatusCode.NoContent);

        await RefreshCsrfAsync(client);
        var loginResponse = await client.PostAsJsonAsync(
            "/api/auth/login",
            new { email, password = Password, rememberMe = false });
        await AssertStatusAsync(loginResponse, HttpStatusCode.OK);

        var memberships = await client.GetFromJsonAsync<TenantMembership[]>("/api/tenants");
        Assert.IsNotNull(memberships);
        Assert.HasCount(1, memberships);
        Assert.AreEqual("Owner", memberships[0].Role);
        client.DefaultRequestHeaders.Add("X-Tenant-Id", memberships[0].TenantId.ToString());
        return memberships[0].TenantId;
    }

    private static async Task<Invitation> CreateInvitationAsync(HttpClient coach, string clientEmail)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync(
            "/api/invitations",
            new
            {
                email = clientEmail,
                firstName = "Client",
                lastName = "One",
                phoneNumber = "+96170000000",
                birthDate = "1995-04-02",
            });
        await AssertStatusAsync(response, HttpStatusCode.Created);
        return await response.Content.ReadFromJsonAsync<Invitation>()
            ?? throw new AssertFailedException("Invitation response was empty.");
    }

    private static object CompleteOnboardingRequest(uint version) => new
    {
        intake = new
        {
            firstName = "Client",
            lastName = "One",
            phoneNumber = "+96170000000",
            birthDate = "1995-04-02",
            heightValue = 175.5m,
            heightUnit = "Centimeter",
            workType = "Office",
            averageDailySteps = 8000,
            trainingBackground = "Two years",
            foodPreferences = "Mediterranean",
            foodAversions = (string?)null,
            goals = "Build strength",
            allergies = (string?)null,
            medications = (string?)null,
            previousInjuries = (string?)null,
            version,
        },
        initialBodyweightValue = 78.2m,
        initialBodyweightUnit = "Kilogram",
        measurementDate = "2026-08-20",
    };

    /// <summary>
    /// The invitation token exists durably only as a one-way hash.
    /// </summary>
    /// <remarks>
    /// Phase 6B-3C moved that hash off the invitation and into the append-only
    /// <c>invitations.TokenIssues</c> record, because an invitation now has a logical-send generation
    /// and one generation may have more than one live token - a transport retry mints a second without
    /// invalidating the first. The property asserted here is unchanged: what is stored is a digest,
    /// never the credential, and the aggregate itself no longer carries one at all.
    /// </remarks>
    private async Task AssertTokenIsStoredOnlyAsHashAsync(string rawToken)
    {
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT \"TokenHash\" FROM invitations.\"TokenIssues\" LIMIT 1";
        var storedHash = (string?)await command.ExecuteScalarAsync();

        Assert.IsNotNull(storedHash);
        Assert.AreEqual(64, storedHash.Length);
        Assert.AreNotEqual(rawToken, storedHash);
        Assert.IsTrue(storedHash.All(Uri.IsHexDigit));

        await using var legacy = connection.CreateCommand();
        legacy.CommandText =
            "SELECT count(*) FROM information_schema.columns WHERE table_schema = \'invitations\'" +
            " AND table_name = \'ClientInvitations\' AND column_name = \'TokenHash\'";
        Assert.AreEqual(
            0L,
            (long)(await legacy.ExecuteScalarAsync())!,
            "The invitation aggregate must no longer carry a token hash of its own.");
    }

    private static async Task RefreshCsrfAsync(HttpClient client)
    {
        var csrf = await client.GetFromJsonAsync<Csrf>("/api/auth/csrf");
        Assert.IsNotNull(csrf);
        client.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
        client.DefaultRequestHeaders.Add("X-XSRF-TOKEN", csrf.Token);
    }

    private static string QueryValue(string url, string key)
    {
        var query = QueryHelpers.ParseQuery(new Uri(url).Query);
        return query.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value)
            ? value.ToString()
            : throw new AssertFailedException($"The URL does not contain query value '{key}'.");
    }

    private static async Task AssertStatusAsync(HttpResponseMessage response, HttpStatusCode expected)
    {
        if (response.StatusCode == expected)
        {
            return;
        }

        var body = await response.Content.ReadAsStringAsync();
        Assert.Fail($"Expected {(int)expected}, received {(int)response.StatusCode}: {body}");
    }

    private WebApplicationFactory<Program> RequiredFactory =>
        factory ?? throw new InvalidOperationException("The test application is not initialized.");

    private string RequiredDatabaseConnection =>
        databaseConnection ?? throw new InvalidOperationException("The test database is not initialized.");

    private sealed record Csrf(string Token);

    private sealed record Registration(string Email, string? DevelopmentConfirmationUrl);

    private sealed record TenantMembership(Guid TenantId, string TenantName, string TenantSlug, string Role);

    private sealed record Invitation(Guid Id, string Email, string Status, string? DevelopmentActionUrl);

    private sealed record PublicInvitation(
        string WorkspaceName,
        string Email,
        string Status,
        bool RequiresExistingAccountSignIn);

    private sealed record InvitationAcceptance(Guid TenantId, Guid ClientProfileId, bool SignedIn);

    private sealed record ClientSummary(Guid Id, string Email, string OnboardingStatus);

    private sealed record ClientProfile(Guid Id, string Email, string OnboardingStatus, uint Version);
}
