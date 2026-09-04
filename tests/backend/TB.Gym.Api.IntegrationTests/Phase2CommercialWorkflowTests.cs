using System.Net;
using System.Net.Http.Json;
using System.Globalization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Configuration;
using Npgsql;

namespace TB.Gym.Api.IntegrationTests;

[TestClass]
public sealed class Phase2CommercialWorkflowTests
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
        databaseName = await PostgreSqlTestEnvironment.CreateDatabaseAsync("tbgym_p2");

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
    public async Task CommercialLifecycleAccessHistoryAndIdempotencyWorkEndToEnd()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(
            coach,
            "phase2-coach@example.test",
            "Phase Two Coach",
            "Phase Two Workspace");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(
            coach,
            client,
            "phase2-client@example.test",
            newAccount: true);

        var training = await CreateProductAsync(
            coach,
            "Premium Training",
            250m,
            "USD",
            "Training",
            "CheckIns");
        var nutrition = await CreateProductAsync(
            coach,
            "Nutrition Add-on",
            100m,
            "USD",
            "Nutrition");
        var today = TenantToday();
        var assignmentKey = Guid.NewGuid();
        var assignmentRequest = new
        {
            offerId = training.Offers[0].Id,
            startDate = today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            idempotencyKey = assignmentKey,
        };
        await RefreshCsrfAsync(coach);
        var assignmentResponses = await Task.WhenAll(
            coach.PostAsJsonAsync($"/api/commercial/clients/{clientId}/enrollments", assignmentRequest),
            coach.PostAsJsonAsync($"/api/commercial/clients/{clientId}/enrollments", assignmentRequest));
        var assignmentResults = new List<Enrollment>();
        foreach (var response in assignmentResponses)
        {
            await AssertStatusAsync(response, HttpStatusCode.OK);
            assignmentResults.Add(await response.Content.ReadFromJsonAsync<Enrollment>()
                ?? throw new AssertFailedException("Concurrent assignment response was empty."));
            response.Dispose();
        }

        var trainingEnrollment = assignmentResults[0];
        Assert.AreEqual("PendingPayment", trainingEnrollment.EffectiveStatus);
        Assert.AreEqual(250m, trainingEnrollment.PriceAmount);
        Assert.AreEqual("USD", trainingEnrollment.PriceCurrency);
        Assert.IsTrue(assignmentResults.All(item => item.Id == trainingEnrollment.Id));

        var pendingOverview = await GetOverviewAsync(coach, clientId);
        AssertAccess(pendingOverview, "Training", allowed: false, "PaymentRequired");
        AssertAccess(pendingOverview, "Nutrition", allowed: false, "NoEntitlement");

        var firstPaymentKey = Guid.NewGuid();
        var firstPaymentRequest = PaymentRequest(100m, "USD", firstPaymentKey);
        await RefreshCsrfAsync(coach);
        var paymentResponses = await Task.WhenAll(
            coach.PostAsJsonAsync(
                $"/api/commercial/enrollments/{trainingEnrollment.Id}/payments",
                firstPaymentRequest),
            coach.PostAsJsonAsync(
                $"/api/commercial/enrollments/{trainingEnrollment.Id}/payments",
                firstPaymentRequest));
        var paymentResults = new List<Enrollment>();
        foreach (var response in paymentResponses)
        {
            await AssertStatusAsync(response, HttpStatusCode.OK);
            paymentResults.Add(await response.Content.ReadFromJsonAsync<Enrollment>()
                ?? throw new AssertFailedException("Concurrent payment response was empty."));
            response.Dispose();
        }

        var partial = paymentResults[0];
        Assert.AreEqual("PendingPayment", partial.StoredStatus);
        Assert.AreEqual(150m, partial.BalanceAmount);
        Assert.HasCount(1, partial.Payments);
        Assert.IsTrue(paymentResults.All(item => item.Payments.Length == 1));

        await RefreshCsrfAsync(coach);
        var retriedPaymentResponse = await coach.PostAsJsonAsync(
            $"/api/commercial/enrollments/{trainingEnrollment.Id}/payments",
            firstPaymentRequest with { CurrencyCode = "usd" });
        await AssertStatusAsync(retriedPaymentResponse, HttpStatusCode.OK);
        var retriedPayment = await retriedPaymentResponse.Content.ReadFromJsonAsync<Enrollment>();
        Assert.IsNotNull(retriedPayment);
        Assert.HasCount(1, retriedPayment.Payments);

        await RefreshCsrfAsync(coach);
        var reusedPaymentKey = await coach.PostAsJsonAsync(
            $"/api/commercial/enrollments/{trainingEnrollment.Id}/payments",
            firstPaymentRequest with { Amount = 99m });
        Assert.AreEqual(HttpStatusCode.Conflict, reusedPaymentKey.StatusCode);

        await RefreshCsrfAsync(coach);
        var wrongCurrency = await coach.PostAsJsonAsync(
            $"/api/commercial/enrollments/{trainingEnrollment.Id}/payments",
            PaymentRequest(150m, "LBP", Guid.NewGuid()));
        Assert.AreEqual(HttpStatusCode.BadRequest, wrongCurrency.StatusCode);

        var active = await RecordPaymentAsync(
            coach,
            trainingEnrollment.Id,
            150m,
            "USD",
            Guid.NewGuid());
        Assert.AreEqual("Active", active.StoredStatus);
        Assert.AreEqual(0m, active.BalanceAmount);
        Assert.HasCount(2, active.Payments);

        SetTenant(client, workspaceId);
        var access = await client.GetFromJsonAsync<AccessDecision[]>("/api/client-access/me");
        Assert.IsNotNull(access);
        AssertDecision(access, "Training", allowed: true, "Granted");
        AssertDecision(access, "CheckIns", allowed: true, "Granted");
        AssertDecision(access, "Nutrition", allowed: false, "NoEntitlement");

        var nutritionEnrollment = await AssignAsync(
            coach,
            clientId,
            nutrition.Offers[0].Id,
            today,
            Guid.NewGuid());
        Assert.AreEqual("PendingPayment", nutritionEnrollment.StoredStatus);

        await RefreshCsrfAsync(coach);
        var contradictory = await coach.PostAsJsonAsync(
            $"/api/commercial/clients/{clientId}/enrollments",
            new
            {
                offerId = training.Offers[0].Id,
                startDate = today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                idempotencyKey = Guid.NewGuid(),
            });
        Assert.AreEqual(HttpStatusCode.Conflict, contradictory.StatusCode);

        await RefreshCsrfAsync(coach);
        var renewalResponse = await coach.PostAsJsonAsync(
            $"/api/commercial/enrollments/{active.Id}/renew",
            new
            {
                offerId = training.Offers[0].Id,
                startDate = active.EndDateExclusive,
                idempotencyKey = Guid.NewGuid(),
            });
        await AssertStatusAsync(renewalResponse, HttpStatusCode.OK);
        var renewal = await renewalResponse.Content.ReadFromJsonAsync<Enrollment>();
        Assert.IsNotNull(renewal);
        Assert.AreEqual(active.Id, renewal.RenewedFromEnrollmentId);
        Assert.AreEqual("PendingPayment", renewal.StoredStatus);

        var history = await GetOverviewAsync(coach, clientId);
        Assert.HasCount(3, history.Enrollments);
        var historicalTraining = history.Enrollments.Single(item => item.Id == active.Id);
        Assert.HasCount(2, historicalTraining.Payments);
        Assert.AreEqual(250m, historicalTraining.PaidAmount);
        Assert.AreEqual("USD", historicalTraining.PriceCurrency);

        var workspace = await coach.GetFromJsonAsync<Workspace>("/api/workspace");
        Assert.IsNotNull(workspace);
        await RefreshCsrfAsync(coach);
        var workspaceUpdate = await coach.PutAsJsonAsync("/api/workspace", new
        {
            workspace.Name,
            workspace.TimeZoneId,
            workspace.DefaultCulture,
            defaultCurrencyCode = "LBP",
            workspace.WeekStartsOn,
            workspace.Version,
        });
        await AssertStatusAsync(workspaceUpdate, HttpStatusCode.OK);
        var afterCurrencyChange = await GetOverviewAsync(coach, clientId);
        Assert.IsTrue(afterCurrencyChange.Enrollments.All(item => item.PriceCurrency == "USD"));

        await RefreshCsrfAsync(coach);
        var stalePause = await coach.PostAsJsonAsync(
            $"/api/commercial/enrollments/{active.Id}/pause",
            new { reason = "Stale request", version = active.Version - 1 });
        Assert.AreEqual(HttpStatusCode.Conflict, stalePause.StatusCode);

        var currentActive = (await GetOverviewAsync(coach, clientId)).Enrollments.Single(item => item.Id == active.Id);
        await RefreshCsrfAsync(coach);
        var pauseResponse = await coach.PostAsJsonAsync(
            $"/api/commercial/enrollments/{active.Id}/pause",
            new { reason = "Planned travel", version = currentActive.Version });
        await AssertStatusAsync(pauseResponse, HttpStatusCode.OK);
        var paused = await pauseResponse.Content.ReadFromJsonAsync<Enrollment>();
        Assert.IsNotNull(paused);
        Assert.AreEqual("Paused", paused.StoredStatus);

        access = await client.GetFromJsonAsync<AccessDecision[]>("/api/client-access/me");
        Assert.IsNotNull(access);
        AssertDecision(access, "Training", allowed: false, "Paused");

        await RefreshCsrfAsync(coach);
        var resumeResponse = await coach.PostAsJsonAsync(
            $"/api/commercial/enrollments/{active.Id}/resume",
            new { paused.Version });
        await AssertStatusAsync(resumeResponse, HttpStatusCode.OK);

        var profile = await coach.GetFromJsonAsync<ClientDetails>($"/api/clients/{clientId}");
        Assert.IsNotNull(profile);
        await RefreshCsrfAsync(coach);
        var blockResponse = await coach.PostAsJsonAsync(
            $"/api/clients/{clientId}/relationship/block",
            new { reason = "Coach review", profile.Version });
        await AssertStatusAsync(blockResponse, HttpStatusCode.OK);

        access = await client.GetFromJsonAsync<AccessDecision[]>("/api/client-access/me");
        Assert.IsNotNull(access);
        Assert.IsTrue(access.All(item => !item.IsAllowed && item.Reason == "RelationshipBlocked"));

        var blockedProfile = await blockResponse.Content.ReadFromJsonAsync<ClientDetails>();
        Assert.IsNotNull(blockedProfile);
        await RefreshCsrfAsync(coach);
        var unblockResponse = await coach.PostAsJsonAsync(
            $"/api/clients/{clientId}/relationship/unblock",
            new { reason = "Review completed", blockedProfile.Version });
        await AssertStatusAsync(unblockResponse, HttpStatusCode.OK);

        Assert.AreEqual(2L, await ScalarAsync(
            "SELECT count(*) FROM subscriptions.\"PaymentRecords\""));
        Assert.AreEqual(0L, await ScalarAsync(
            "SELECT count(*) FROM (SELECT \"TenantId\", \"DeduplicationKey\", count(*) FROM notifications.\"OutboxItems\" GROUP BY 1, 2 HAVING count(*) > 1) duplicate"));
        Assert.AreEqual(1L, await ScalarAsync(
            "SELECT count(*) FROM notifications.\"OutboxItems\" WHERE \"Kind\" = 'PaymentRequired' AND \"Status\" = 'Cancelled'"));

        await AssertPaymentLedgerRejectsMutationAsync(historicalTraining.Payments[0].Id);
    }

    [TestMethod]
    public async Task ConcurrentOverlapAndWorkspaceScopedBlockingRemainTenantSafe()
    {
        using var coachA = CreateClient();
        var workspaceA = await RegisterCoachAsync(
            coachA,
            "scope-coach-a@example.test",
            "Coach A",
            "Workspace A");
        using var client = CreateClient();
        var clientA = await InviteAndAcceptAsync(
            coachA,
            client,
            "shared-client@example.test",
            newAccount: true);
        var offerA1 = await CreateProductAsync(coachA, "Training A", 0m, "USD", "Training");
        var offerA2 = await CreateProductAsync(coachA, "Training B", 0m, "USD", "Training");
        var today = TenantToday();

        await RefreshCsrfAsync(coachA);
        var firstTask = coachA.PostAsJsonAsync(
            $"/api/commercial/clients/{clientA}/enrollments",
            new
            {
                offerId = offerA1.Offers[0].Id,
                startDate = today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                idempotencyKey = Guid.NewGuid(),
            });
        var secondTask = coachA.PostAsJsonAsync(
            $"/api/commercial/clients/{clientA}/enrollments",
            new
            {
                offerId = offerA2.Offers[0].Id,
                startDate = today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                idempotencyKey = Guid.NewGuid(),
            });
        var responses = await Task.WhenAll(firstTask, secondTask);
        Assert.AreEqual(1, responses.Count(item => item.StatusCode == HttpStatusCode.OK));
        Assert.AreEqual(1, responses.Count(item => item.StatusCode == HttpStatusCode.Conflict));

        using var coachB = CreateClient();
        var workspaceB = await RegisterCoachAsync(
            coachB,
            "scope-coach-b@example.test",
            "Coach B",
            "Workspace B");
        var clientB = await InviteAndAcceptAsync(
            coachB,
            client,
            "shared-client@example.test",
            newAccount: false);
        var productB = await CreateProductAsync(coachB, "Workspace B Training", 0m, "USD", "Training");
        await AssignAsync(coachB, clientB, productB.Offers[0].Id, today, Guid.NewGuid());

        var crossTenantRead = await coachB.GetAsync($"/api/commercial/clients/{clientA}");
        Assert.AreEqual(HttpStatusCode.NotFound, crossTenantRead.StatusCode);

        await RefreshCsrfAsync(coachB);
        var crossTenantOffer = await coachB.PostAsJsonAsync(
            $"/api/commercial/clients/{clientB}/enrollments",
            new
            {
                offerId = offerA1.Offers[0].Id,
                startDate = today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                idempotencyKey = Guid.NewGuid(),
            });
        Assert.AreEqual(HttpStatusCode.NotFound, crossTenantOffer.StatusCode);

        var profileA = await coachA.GetFromJsonAsync<ClientDetails>($"/api/clients/{clientA}");
        Assert.IsNotNull(profileA);
        await RefreshCsrfAsync(coachA);
        var block = await coachA.PostAsJsonAsync(
            $"/api/clients/{clientA}/relationship/block",
            new { reason = "Workspace A only", profileA.Version });
        await AssertStatusAsync(block, HttpStatusCode.OK);

        SetTenant(client, workspaceA);
        var accessA = await client.GetFromJsonAsync<AccessDecision[]>("/api/client-access/me");
        Assert.IsNotNull(accessA);
        AssertDecision(accessA, "Training", allowed: false, "RelationshipBlocked");

        SetTenant(client, workspaceB);
        var accessB = await client.GetFromJsonAsync<AccessDecision[]>("/api/client-access/me");
        Assert.IsNotNull(accessB);
        AssertDecision(accessB, "Training", allowed: true, "Granted");
    }

    private HttpClient CreateClient() =>
        RequiredFactory.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
            BaseAddress = new Uri("http://localhost"),
        });

    private static async Task<Guid> RegisterCoachAsync(
        HttpClient client,
        string email,
        string displayName,
        string workspaceName)
    {
        await RefreshCsrfAsync(client);
        var response = await client.PostAsJsonAsync("/api/auth/register/coach", new
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
        await AssertStatusAsync(response, HttpStatusCode.Accepted);
        var registration = await response.Content.ReadFromJsonAsync<Registration>();
        Assert.IsNotNull(registration?.DevelopmentConfirmationUrl);

        await RefreshCsrfAsync(client);
        var confirmation = await client.PostAsJsonAsync("/api/auth/confirm-email", new
        {
            userId = Guid.Parse(QueryValue(registration.DevelopmentConfirmationUrl, "userId")),
            code = QueryValue(registration.DevelopmentConfirmationUrl, "code"),
        });
        await AssertStatusAsync(confirmation, HttpStatusCode.NoContent);

        await RefreshCsrfAsync(client);
        var login = await client.PostAsJsonAsync(
            "/api/auth/login",
            new { email, password = Password, rememberMe = false });
        await AssertStatusAsync(login, HttpStatusCode.OK);

        var memberships = await client.GetFromJsonAsync<TenantMembership[]>("/api/tenants");
        Assert.IsNotNull(memberships);
        var workspaceId = memberships.Single().TenantId;
        SetTenant(client, workspaceId);
        return workspaceId;
    }

    private static async Task<Guid> InviteAndAcceptAsync(
        HttpClient coach,
        HttpClient client,
        string email,
        bool newAccount)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync("/api/invitations", new
        {
            email,
            firstName = "Commercial",
            lastName = "Client",
            phoneNumber = "+96170000000",
            birthDate = "1995-04-02",
        });
        await AssertStatusAsync(response, HttpStatusCode.Created);
        var invitation = await response.Content.ReadFromJsonAsync<Invitation>();
        Assert.IsNotNull(invitation?.DevelopmentActionUrl);
        var token = QueryValue(invitation.DevelopmentActionUrl, "token");

        await RefreshCsrfAsync(client);
        var acceptance = await client.PostAsJsonAsync("/api/invitations/accept", new
        {
            token,
            displayName = newAccount ? "Commercial Client" : null,
            password = newAccount ? Password : null,
        });
        await AssertStatusAsync(acceptance, HttpStatusCode.OK);
        var accepted = await acceptance.Content.ReadFromJsonAsync<InvitationAcceptance>();
        Assert.IsNotNull(accepted);
        SetTenant(client, accepted.TenantId);
        return accepted.ClientProfileId;
    }

    private static async Task<Product> CreateProductAsync(
        HttpClient coach,
        string name,
        decimal amount,
        string currency,
        params string[] features)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync("/api/commercial/products", new
        {
            name,
            description = $"{name} description",
            initialOffer = new
            {
                label = "8 weeks",
                durationCount = 8,
                durationUnit = "Week",
                priceAmount = amount,
                priceCurrency = currency,
                features = features.Select(feature => new
                {
                    feature,
                    allowsConcurrentCoverage = false,
                }),
            },
        });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await response.Content.ReadFromJsonAsync<Product>()
            ?? throw new AssertFailedException("Product response was empty.");
    }

    private static async Task<Enrollment> AssignAsync(
        HttpClient coach,
        Guid clientId,
        Guid offerId,
        DateOnly startDate,
        Guid idempotencyKey)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync(
            $"/api/commercial/clients/{clientId}/enrollments",
            new
            {
                offerId,
                startDate = startDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                idempotencyKey,
            });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await response.Content.ReadFromJsonAsync<Enrollment>()
            ?? throw new AssertFailedException("Enrollment response was empty.");
    }

    private static async Task<Enrollment> RecordPaymentAsync(
        HttpClient coach,
        Guid enrollmentId,
        decimal amount,
        string currency,
        Guid idempotencyKey)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync(
            $"/api/commercial/enrollments/{enrollmentId}/payments",
            PaymentRequest(amount, currency, idempotencyKey));
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await response.Content.ReadFromJsonAsync<Enrollment>()
            ?? throw new AssertFailedException("Payment response was empty.");
    }

    private static ManualPaymentRequest PaymentRequest(
        decimal amount,
        string currency,
        Guid idempotencyKey) =>
        new(
            amount,
            currency,
            DateTimeOffset.UtcNow,
            "Cash",
            $"REF-{idempotencyKey:N}",
            "Integration test payment",
            idempotencyKey);

    private static async Task<CommercialOverview> GetOverviewAsync(HttpClient coach, Guid clientId) =>
        await coach.GetFromJsonAsync<CommercialOverview>($"/api/commercial/clients/{clientId}")
        ?? throw new AssertFailedException("Commercial overview was empty.");

    private async Task<long> ScalarAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        return Convert.ToInt64(await command.ExecuteScalarAsync(), System.Globalization.CultureInfo.InvariantCulture);
    }

    private async Task AssertPaymentLedgerRejectsMutationAsync(Guid paymentId)
    {
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            "UPDATE subscriptions.\"PaymentRecords\" SET \"Note\" = 'tampered' WHERE \"Id\" = @id";
        command.Parameters.AddWithValue("id", paymentId);
        var exception = await Assert.ThrowsExactlyAsync<PostgresException>(
            async () => await command.ExecuteNonQueryAsync());
        Assert.AreEqual("55000", exception.SqlState);
    }

    private static void AssertAccess(
        CommercialOverview overview,
        string feature,
        bool allowed,
        string reason) =>
        AssertDecision(overview.FeatureAccess, feature, allowed, reason);

    private static void AssertDecision(
        IEnumerable<AccessDecision> decisions,
        string feature,
        bool allowed,
        string reason)
    {
        var decision = decisions.Single(item => item.Feature == feature);
        Assert.AreEqual(allowed, decision.IsAllowed);
        Assert.AreEqual(reason, decision.Reason);
    }

    private static async Task RefreshCsrfAsync(HttpClient client)
    {
        var csrf = await client.GetFromJsonAsync<Csrf>("/api/auth/csrf");
        Assert.IsNotNull(csrf);
        client.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
        client.DefaultRequestHeaders.Add("X-XSRF-TOKEN", csrf.Token);
    }

    private static void SetTenant(HttpClient client, Guid tenantId)
    {
        client.DefaultRequestHeaders.Remove("X-Tenant-Id");
        client.DefaultRequestHeaders.Add("X-Tenant-Id", tenantId.ToString());
    }

    private static DateOnly TenantToday()
    {
        var local = TimeZoneInfo.ConvertTime(
            DateTimeOffset.UtcNow,
            TimeZoneInfo.FindSystemTimeZoneById("Asia/Beirut"));
        return DateOnly.FromDateTime(local.DateTime);
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

    private sealed record TenantMembership(Guid TenantId, string Role);

    private sealed record Invitation(string? DevelopmentActionUrl);

    private sealed record InvitationAcceptance(Guid TenantId, Guid ClientProfileId);

    private sealed record Product(Guid Id, ProductOffer[] Offers, uint Version);

    private sealed record ProductOffer(Guid Id, decimal PriceAmount, string PriceCurrency, uint Version);

    private sealed record CommercialOverview(
        bool IsRelationshipBlocked,
        AccessDecision[] FeatureAccess,
        Enrollment[] Enrollments);

    private sealed record AccessDecision(string Feature, bool IsAllowed, string Reason);

    private sealed record Enrollment(
        Guid Id,
        Guid ProductId,
        Guid OfferId,
        Guid? RenewedFromEnrollmentId,
        decimal PriceAmount,
        string PriceCurrency,
        decimal PaidAmount,
        decimal BalanceAmount,
        string StartDate,
        string EndDateExclusive,
        string StoredStatus,
        string EffectiveStatus,
        Payment[] Payments,
        uint Version);

    private sealed record Payment(Guid Id, decimal Amount, string CurrencyCode);

    private sealed record ManualPaymentRequest(
        decimal Amount,
        string CurrencyCode,
        DateTimeOffset ReceivedAtUtc,
        string Method,
        string Reference,
        string Note,
        Guid IdempotencyKey);

    private sealed record ClientDetails(Guid Id, bool IsCoachBlocked, uint Version);

    private sealed record Workspace(
        string Name,
        string TimeZoneId,
        string DefaultCulture,
        string DefaultCurrencyCode,
        string WeekStartsOn,
        uint Version);
}
