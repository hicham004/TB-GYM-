using System.Collections.Concurrent;
using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
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
using TB.Gym.Modules.Invitations;
using TB.Gym.Modules.Notifications;
using TB.Gym.SharedKernel;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The provider-facing half of Phase 6B-3C: transport retries, generation stability under retry, and
/// idempotency keys that change with the payload.
/// </summary>
/// <remarks>
/// These need a transport that can fail, so they run against a real HTTP server on a loopback port
/// rather than the captured adapter. That distinction is what makes them worth the setup: the
/// behaviour under a 500, under a timeout and under an ambiguous acceptance are properties of an HTTP
/// exchange, and a stubbed handler returning a canned response proves the switch statement works while
/// proving nothing about the exchange.
/// <para>
/// The double records every request it receives, so the assertions read the actual idempotency key and
/// the actual rendered body the adapter sent — including the link, which is how these tests recover a
/// token without a capture buffer.
/// </para>
/// </remarks>
[TestClass]
public sealed class Phase6B3CActionMailProviderTests
{
    private static readonly string Password = $"Aa1!{Guid.NewGuid():N}";

    private static readonly DateTimeOffset StartInstant = new(2026, 9, 5, 6, 0, 0, TimeSpan.Zero);

    private static readonly byte[] WebhookSecretMaterial = RandomNumberGenerator.GetBytes(24);

    private static readonly byte[] FingerprintKey = RandomNumberGenerator.GetBytes(32);

    private const string FingerprintKeyId = "test-active";

    private const string ApiKey = "re_test_key_never_real";

    private const string FromAddress = "TB Gym <notifications@mail.tbgym.test>";

    private const string PublicOrigin = "http://localhost:4200";

    private const int ProviderTimeoutSeconds = 2;

    private string? adminConnection;
    private string? databaseName;
    private string? databaseConnection;
    private WebApplicationFactory<Program>? factory;
    private MutableClock? testClock;
    private CapturedLog? log;
    private ProviderDouble? providerDouble;

    public TestContext TestContext { get; set; } = null!;

    [TestInitialize]
    public async Task InitializeAsync()
    {
        adminConnection = PostgreSqlTestEnvironment.RequireAdminConnection();
        databaseName = await PostgreSqlTestEnvironment.CreateDatabaseAsync("tbgym_p6b3cp");
        databaseConnection = new NpgsqlConnectionStringBuilder(adminConnection)
        {
            Database = databaseName,
        }.ConnectionString;

        var doubleHost = await ProviderDouble.StartAsync();
        providerDouble = doubleHost;
        var clock = new MutableClock(StartInstant);
        testClock = clock;
        var capturedLog = new CapturedLog();
        log = capturedLog;

        factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            // Development, because the provider endpoint is plain HTTP on loopback and the action
            // origin is plain HTTP too. Production refuses both, and the startup tests assert so.
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
                ["Notifications:Email:Adapter"] = NotificationEmailAdapters.Resend,
                ["Notifications:Email:Provider:Endpoint"] = doubleHost.SendEndpoint,
                ["Notifications:Email:Provider:ApiKey"] = ApiKey,
                ["Notifications:Email:Provider:FromAddress"] = FromAddress,
                ["Notifications:Email:Provider:TimeoutSeconds"] =
                    ProviderTimeoutSeconds.ToString(CultureInfo.InvariantCulture),
                ["Notifications:Email:Provider:WebhookSigningSecret"] =
                    NotificationWebhookSignature.SecretPrefix + Convert.ToBase64String(WebhookSecretMaterial),
                [$"Notifications:Email:Provider:FingerprintKeys:{FingerprintKeyId}"] =
                    Convert.ToBase64String(FingerprintKey),
                ["Notifications:Email:Provider:FingerprintKeyId"] = FingerprintKeyId,
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

    /// <summary>
    /// Requirements 9 and 17: a transport retry keeps the generation and changes the provider key.
    /// </summary>
    /// <remarks>
    /// The first attempt fails with a 500, which is transient; the schedule moves the request forward
    /// and the second attempt succeeds. The invitation's generation is untouched — a retry is the
    /// dispatcher's own act and nobody asked for the old link to die — while the provider sees two
    /// different keys, because the second attempt minted a new token and therefore sent a different
    /// message. One key with two bodies is what a provider answers with a conflict instead of a send.
    /// </remarks>
    [TestMethod]
    public async Task ATransportRetryKeepsTheGenerationAndPresentsANewProviderKey()
    {
        var workspace = await CreateWorkspaceAsync("retry");
        Provider.Responder = attempt => attempt == 1
            ? ProviderResponse.Status(500)
            : ProviderResponse.Accepted($"prov_{Guid.NewGuid():N}");

        var invitation = await CreateInvitationAsync(workspace, $"client-retry-{workspace.Suffix}@tbgym.test");

        var first = await SweepInvitationMailAsync();
        Assert.AreEqual(1, first.Retried, "A 500 must be transient and earn a retry.");
        Assert.AreEqual(1, await GenerationAsync(invitation), "A transport retry rotated the generation.");

        // The schedule's first step is one minute; nothing is due before then.
        Assert.AreEqual(0, (await SweepInvitationMailAsync()).Total, "The retry was due too early.");
        Clock.Advance(TimeSpan.FromMinutes(2));

        var second = await SweepInvitationMailAsync();
        Assert.AreEqual(1, second.Materialized);
        Assert.AreEqual(1, await GenerationAsync(invitation), "A transport retry rotated the generation.");

        var keys = Provider.Requests.Select(request => request.IdempotencyKey).ToArray();
        Assert.HasCount(2, keys);
        Assert.AreNotEqual(
            keys[0],
            keys[1],
            "Two materializations minted two tokens, so they must present two provider keys.");
        Assert.Contains(":a1:", keys[0], StringComparison.Ordinal);
        Assert.Contains(":a2:", keys[1], StringComparison.Ordinal);

        // Both attempts appended a hash for the same generation, and neither revoked the other.
        var issues = await TokenIssuesAsync(invitation);
        Assert.HasCount(2, issues);
        Assert.IsTrue(
            issues.All(issue => issue.Generation == 1),
            "A retry must append to the same generation.");
        Assert.IsTrue(
            issues.All(issue => issue.RevokedAtUtc is null),
            "A transport retry must revoke nothing.");
    }

    /// <summary>
    /// Requirement 10: a link from an ambiguous earlier attempt still works after a retry.
    /// </summary>
    /// <remarks>
    /// The failure this removes is the worst kind, because it is invisible until somebody complains:
    /// the provider accepted the first message and then the acknowledgement was lost, so the recipient
    /// is holding a real invitation email while the dispatcher believes the attempt failed. If the
    /// retry rotated the token, that person gets "this invitation is no longer valid" for an
    /// invitation nobody revoked.
    /// <para>
    /// Here the double accepts the message and <i>then</i> answers 500, which is exactly that
    /// ambiguity. The link from the first attempt is used after the second attempt has completed, and
    /// it works.
    /// </para>
    /// </remarks>
    [TestMethod]
    public async Task ALinkFromAnAmbiguousEarlierAttemptRemainsValidAfterARetry()
    {
        var workspace = await CreateWorkspaceAsync("ambiguous");
        Provider.Responder = attempt => attempt == 1
            // Accepted by the provider, and then an error the caller cannot distinguish from a
            // rejection. The message is out; this deployment does not know it.
            ? ProviderResponse.Status(500)
            : ProviderResponse.Accepted($"prov_{Guid.NewGuid():N}");

        var invitation = await CreateInvitationAsync(
            workspace,
            $"client-ambiguous-{workspace.Suffix}@tbgym.test");

        await SweepInvitationMailAsync();
        var deliveredLink = LinkFrom(Provider.Requests[0].Body);

        Clock.Advance(TimeSpan.FromMinutes(2));
        await SweepInvitationMailAsync();
        var laterLink = LinkFrom(Provider.Requests[1].Body);
        Assert.AreNotEqual(deliveredLink, laterLink, "The retry did not mint a new token.");

        // The link the recipient is actually holding still works.
        using var invitee = CreateClient();
        var details = await invitee.GetAsync(
            $"/api/invitations/public/{Uri.EscapeDataString(TokenOf(deliveredLink))}",
            TestContext.CancellationToken);
        await AssertStatusAsync(details, HttpStatusCode.OK);

        await RefreshCsrfAsync(invitee);
        await AssertStatusAsync(
            await invitee.PostAsJsonAsync(
                "/api/invitations/accept",
                new { token = TokenOf(deliveredLink), displayName = "Invited Client", password = Password },
                TestContext.CancellationToken),
            HttpStatusCode.OK);
    }

    /// <summary>
    /// A dead letter records the failure and leaks nothing about the recipient.
    /// </summary>
    /// <remarks>
    /// The bounded schedule ends somewhere, and where it ends matters: the request carries a stable
    /// code, the attempts are all recorded, and the address, the token, the link and the rendered body
    /// appear in none of it — nor in any log line, even though four failed HTTP exchanges have just
    /// happened.
    /// </remarks>
    [TestMethod]
    public async Task AnExhaustedActionMailRequestDeadLettersWithoutLeakingAnything()
    {
        var workspace = await CreateWorkspaceAsync("exhausted");
        Provider.Responder = _ => ProviderResponse.Status(503);
        var email = $"client-exhausted-{workspace.Suffix}@tbgym.test";
        var invitation = await CreateInvitationAsync(workspace, email);

        await SweepInvitationMailAsync();
        foreach (var wait in new[] { 2, 6, 31 })
        {
            Clock.Advance(TimeSpan.FromMinutes(wait));
            await SweepInvitationMailAsync();
        }

        var status = await ScalarAsync<string>(
            """SELECT "Status" FROM invitations."ActionMailRequests" WHERE "InvitationId" = @id""",
            ("id", invitation));
        Assert.AreEqual(
            nameof(InvitationActionMailStatus.DeadLettered),
            status,
            "Four transient failures must exhaust the configured budget.");
        Assert.AreEqual(
            InvitationActionMailCodes.TransportTransient,
            await ScalarAsync<string>(
                """SELECT "FailureCode" FROM invitations."ActionMailRequests" WHERE "InvitationId" = @id""",
                ("id", invitation)));

        // Four attempts, four tokens, four distinct provider keys, and no leak anywhere.
        var keys = Provider.Requests.Select(request => request.IdempotencyKey).ToArray();
        Assert.HasCount(4, keys);
        Assert.AreEqual(4, keys.Distinct(StringComparer.Ordinal).Count());

        // Two scopes, because they are two different rules. A token, a link and the API key have no
        // legitimate home anywhere, so they are searched for across both schemas. The invited address
        // does have one - invitations.ClientInvitations is the record of who was invited - so it is
        // searched for only in the action-mail rows, which is where copying it for delivery would show.
        var links = Provider.Requests.Select(request => LinkFrom(request.Body)).ToArray();
        var everywhere = await DumpSchemaTextAsync("identity", "invitations");
        foreach (var term in links.Concat(links.Select(TokenOf)).Concat([ApiKey]))
        {
            Assert.DoesNotContain(
                term,
                everywhere,
                StringComparison.OrdinalIgnoreCase,
                $"A token, link or credential reached a database column: '{term}'.");
            Assert.DoesNotContain(
                term,
                Log.Text,
                StringComparison.OrdinalIgnoreCase,
                $"A token, link or credential reached the log: '{term}'.");
        }

        var actionMailRows = await DumpTablesTextAsync(
            ("identity", "ActionMailRequests"),
            ("identity", "ActionMailAttempts"),
            ("invitations", "ActionMailRequests"),
            ("invitations", "ActionMailAttempts"),
            ("invitations", "TokenIssues"));
        Assert.DoesNotContain(
            email,
            actionMailRows,
            StringComparison.OrdinalIgnoreCase,
            "A recipient address was copied into an action-mail row.");
        Assert.DoesNotContain(
            email,
            Log.Text,
            StringComparison.OrdinalIgnoreCase,
            "A recipient address reached the log.");
    }

    /// <summary>
    /// A provider timeout leaks nothing and is classified as retryable.
    /// </summary>
    /// <remarks>
    /// Nothing about the request is on the timeout path, which is the property being asserted: the
    /// stable classification is all an operator gets, and no part of the outbound message can escape
    /// through it.
    /// </remarks>
    [TestMethod]
    public async Task AProviderTimeoutIsClassifiedWithoutLeakingTheOutboundMessage()
    {
        var workspace = await CreateWorkspaceAsync("timeout");
        Provider.Responder = attempt => attempt == 1
            ? ProviderResponse.Slow(TimeSpan.FromSeconds(ProviderTimeoutSeconds + 3))
            : ProviderResponse.Accepted($"prov_{Guid.NewGuid():N}");

        var email = $"client-timeout-{workspace.Suffix}@tbgym.test";
        var invitation = await CreateInvitationAsync(workspace, email);

        var outcome = await SweepInvitationMailAsync();
        Assert.AreEqual(1, outcome.Retried, "A timeout must be transient.");
        Assert.AreEqual(
            InvitationActionMailCodes.TransportTransient,
            await ScalarAsync<string>(
                """SELECT "FailureCode" FROM invitations."ActionMailRequests" WHERE "InvitationId" = @id""",
                ("id", invitation)));

        Assert.DoesNotContain(email, Log.Text, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(ApiKey, Log.Text, StringComparison.Ordinal);
    }

    /// <summary>
    /// Requirement 17, structurally: no two attempts can present one provider key.
    /// </summary>
    /// <remarks>
    /// Asserted against the database rather than against the generator, because the generator is the
    /// thing that could change. A unique index and a shape check together mean a key is tied to
    /// exactly one request and attempt number, so reuse is impossible rather than merely unlikely.
    /// </remarks>
    [TestMethod]
    public async Task ProviderIdempotencyKeysCannotBeReusedAcrossTokenizedPayloads()
    {
        var workspace = await CreateWorkspaceAsync("keys");
        Provider.Responder = attempt => attempt == 1
            ? ProviderResponse.Status(500)
            : ProviderResponse.Accepted($"prov_{Guid.NewGuid():N}");

        var invitation = await CreateInvitationAsync(workspace, $"client-keys-{workspace.Suffix}@tbgym.test");
        await SweepInvitationMailAsync();
        Clock.Advance(TimeSpan.FromMinutes(2));
        await SweepInvitationMailAsync();

        var keys = await ProviderKeysAsync(invitation);
        Assert.HasCount(2, keys);
        Assert.AreEqual(2, keys.Distinct(StringComparer.Ordinal).Count());
        CollectionAssert.AreEquivalent(
            Provider.Requests.Select(request => request.IdempotencyKey).ToArray(),
            keys.ToArray(),
            "The key the provider saw is not the key that was recorded.");

        // The database refuses the second attempt adopting the first one's key.
        await AssertRefusedAsync(
            """
            UPDATE invitations."ActionMailAttempts"
            SET "ProviderIdempotencyKey" = @key
            WHERE "InvitationId" = @id AND "AttemptNumber" = 2
            """,
            "one provider idempotency key shared by two tokenized payloads",
            ("key", keys[0]),
            ("id", invitation));

        // And it refuses a key that does not name its own request and attempt.
        await AssertRefusedAsync(
            """
            UPDATE invitations."ActionMailAttempts"
            SET "ProviderIdempotencyKey" = 'invitation-action:deadbeef:a9:v1:' ||
                left(encode(sha256(convert_to('x', 'UTF8')), 'hex'), 32)
            WHERE "InvitationId" = @id AND "AttemptNumber" = 2
            """,
            "a provider key that does not name its own request and attempt",
            ("id", invitation));
    }

    /// <summary>
    /// Requirement 6: a confirmation is suppressed once the account's credential state has moved.
    /// </summary>
    /// <remarks>
    /// Identity rotates the security stamp on an address change, a password change and an explicit
    /// session revocation, and the request records the stamp it was made against — so the two
    /// comparing unequal <i>is</i> "the world moved since somebody asked". Suppressing rather than
    /// minting means the outcome is a recorded fact instead of a live credential in a mailbox that
    /// fails confusingly when it is clicked.
    /// <para>
    /// This case needs a request that is still pending when the stamp changes, which only exists under
    /// a transport that does not materialize inline. That is why it lives here rather than beside the
    /// captured-adapter cases.
    /// </para>
    /// </remarks>
    [TestMethod]
    public async Task AConfirmationIsSuppressedOnceTheAccountCredentialStateHasMoved()
    {
        var workspace = await CreateWorkspaceAsync("moved");
        var userId = await ScalarAsync<Guid>(
            """SELECT "Id" FROM identity."Users" WHERE "Email" = @email""",
            ("email", workspace.CoachEmail));

        // A second confirmation, queued and left pending. The registration request for the same
        // account is already terminal, and both carry the same RequestedAtUtc because the clock is
        // frozen - so everything below addresses this request by its own id rather than by recency.
        Guid requestId;
        await using (var scope = RequiredFactory.Services.CreateAsyncScope())
        {
            await ExecuteAsync(
                """UPDATE identity."Users" SET "EmailConfirmed" = false WHERE "Id" = @id""",
                ("id", userId));
            var queued = await scope.ServiceProvider
                .GetRequiredService<TB.Gym.Modules.Identity.IAccountActionMailScheduler>()
                .RequestAsync(
                    new TB.Gym.Modules.Identity.AccountActionMailCommand(
                        userId,
                        TB.Gym.Modules.Identity.AccountActionKind.ConfirmEmail,
                        TB.Gym.Modules.Identity.AccountActionMailSources.CoachRegistration,
                        userId),
                    TestContext.CancellationToken);
            requestId = queued.RequestId;
        }

        Assert.AreEqual(
            "Pending",
            await ScalarAsync<string>(
                """SELECT "Status" FROM identity."ActionMailRequests" WHERE "Id" = @id""",
                ("id", requestId)),
            "A provider adapter must not materialize inline.");

        // The address changes, which in Identity rotates the security stamp.
        await ExecuteAsync(
            """UPDATE identity."Users" SET "SecurityStamp" = @stamp WHERE "Id" = @id""",
            ("stamp", Guid.NewGuid().ToString("N").ToUpperInvariant()),
            ("id", userId));

        var before = Provider.Requests.Count;
        await SweepAccountMailAsync();

        Assert.AreEqual(
            nameof(TB.Gym.Modules.Identity.AccountActionMailStatus.Suppressed),
            await ScalarAsync<string>(
                """SELECT "Status" FROM identity."ActionMailRequests" WHERE "Id" = @id""",
                ("id", requestId)));
        Assert.AreEqual(
            TB.Gym.Modules.Identity.AccountActionMailCodes.CredentialChanged,
            await ScalarAsync<string>(
                """SELECT "FailureCode" FROM identity."ActionMailRequests" WHERE "Id" = @id""",
                ("id", requestId)));
        Assert.HasCount(
            before,
            Provider.Requests,
            "A suppressed confirmation must not have contacted the provider.");
    }

    /// <summary>
    /// Requirement 14: a revoked, expired or superseded invitation cannot materialize.
    /// </summary>
    /// <remarks>
    /// Three refusals, each with its own stable code, all evaluated at materialization rather than
    /// trusted from the queue row — because a committed claim is a lease on work and never durable
    /// permission to mail somebody a credential. The superseded case is the one this phase introduces:
    /// a request created for generation 1 must stop the moment a deliberate resend moves the invitation
    /// to generation 2, because the newer request is now carrying the send.
    /// </remarks>
    [TestMethod]
    public async Task ARevokedExpiredOrSupersededInvitationCannotMaterialize()
    {
        var workspace = await CreateWorkspaceAsync("suppress");

        var revoked = await CreateInvitationAsync(workspace, $"client-revoked-{workspace.Suffix}@tbgym.test");
        await RevokeInvitationAsync(workspace, revoked);
        await SweepInvitationMailAsync();
        await AssertSuppressedAsync(revoked, 1, InvitationActionMailCodes.InvitationRevoked);

        var superseded = await CreateInvitationAsync(
            workspace,
            $"client-superseded-{workspace.Suffix}@tbgym.test");
        await ResendInvitationAsync(workspace, superseded);
        await SweepInvitationMailAsync();
        await AssertSuppressedAsync(superseded, 1, InvitationActionMailCodes.GenerationSuperseded);

        var expired = await CreateInvitationAsync(workspace, $"client-expired-{workspace.Suffix}@tbgym.test");
        Clock.Advance(TimeSpan.FromDays(8));
        await SweepInvitationMailAsync();
        await AssertSuppressedAsync(expired, 1, InvitationActionMailCodes.InvitationExpired);
    }

    /// <summary>
    /// Requirement 14: an accepted invitation cannot materialize a retry that is still pending.
    /// </summary>
    /// <remarks>
    /// This is the case that only exists because the token hash is committed before the send. The
    /// first attempt minted a token, recorded it, and then failed at the provider — so the recipient
    /// may be holding a working link while the dispatcher believes the attempt failed, which is
    /// exactly the situation ADR 0021's stability rule exists for. They accept with it, and the
    /// pending retry then has to notice and stop rather than mailing a second link to somebody who is
    /// already a member.
    /// </remarks>
    [TestMethod]
    public async Task AnAcceptedInvitationCannotMaterializeAPendingRetry()
    {
        var workspace = await CreateWorkspaceAsync("accepted");
        Provider.Responder = _ => ProviderResponse.Status(500);

        var invitation = await CreateInvitationAsync(
            workspace,
            $"client-accepted-{workspace.Suffix}@tbgym.test");
        await SweepInvitationMailAsync();

        // The token was recorded before the failed send, so the link the provider may already have
        // delivered still resolves.
        var link = LinkFrom(Provider.Requests[0].Body);
        using var invitee = CreateClient();
        await RefreshCsrfAsync(invitee);
        await AssertStatusAsync(
            await invitee.PostAsJsonAsync(
                "/api/invitations/accept",
                new { token = TokenOf(link), displayName = "Invited Client", password = Password },
                TestContext.CancellationToken),
            HttpStatusCode.OK);

        var before = Provider.Requests.Count;
        Clock.Advance(TimeSpan.FromMinutes(2));
        var outcome = await SweepInvitationMailAsync();

        Assert.AreEqual(1, outcome.Suppressed, "The pending retry must stop once the invitation is accepted.");
        Assert.AreEqual(
            nameof(InvitationActionMailStatus.Suppressed),
            await ScalarAsync<string>(
                """SELECT "Status" FROM invitations."ActionMailRequests" WHERE "InvitationId" = @id""",
                ("id", invitation)));
        Assert.AreEqual(
            InvitationActionMailCodes.InvitationAccepted,
            await ScalarAsync<string>(
                """SELECT "FailureCode" FROM invitations."ActionMailRequests" WHERE "InvitationId" = @id""",
                ("id", invitation)));
        Assert.HasCount(
            before,
            Provider.Requests,
            "A suppressed retry must not have contacted the provider.");
        Assert.AreEqual(
            1L,
            await ScalarAsync<long>(
                """
                SELECT count(*) FROM invitations."TokenIssues"
                WHERE "InvitationId" = @id AND "RedeemedAtUtc" IS NOT NULL
                """,
                ("id", invitation)),
            "The link that was actually used must be recorded as redeemed.");
    }

    /// <summary>
    /// Requirement 16: an expired lease is reclaimed, and its stale claimant cannot finalize.
    /// </summary>
    /// <remarks>
    /// The interrupted attempt is recorded as abandoned rather than left open or quietly removed — an
    /// abandoned attempt is still a started attempt and still costs one slot of the budget, so history
    /// shows an interrupted try instead of an attempt number that went missing. The stale claimant's
    /// own finalization is then refused by the database, which is the guarantee that survives a process
    /// that never learned it had lost the lease.
    /// </remarks>
    [TestMethod]
    public async Task AnExpiredLeaseIsReclaimedAndItsStaleClaimantCannotFinalize()
    {
        var workspace = await CreateWorkspaceAsync("stale");
        var invitation = await CreateInvitationAsync(workspace, $"client-stale-{workspace.Suffix}@tbgym.test");
        var requestId = await ScalarAsync<Guid>(
            """SELECT "Id" FROM invitations."ActionMailRequests" WHERE "InvitationId" = @id""",
            ("id", invitation));

        // A worker that claimed, started its attempt, and then died. The lease is written already
        // expired against the test clock, which is what the sweep reads.
        var staleClaim = Guid.NewGuid();
        var expiredAt = Clock.UtcNow.AddSeconds(-1);
        await ExecuteAsync(
            """
            UPDATE invitations."ActionMailRequests"
            SET "Status" = 'Processing', "ClaimToken" = @claim, "ClaimExpiresAtUtc" = @expiry
            WHERE "Id" = @id
            """,
            ("claim", staleClaim),
            ("expiry", expiredAt),
            ("id", requestId));
        await ExecuteAsync(
            """UPDATE invitations."ActionMailRequests" SET "AttemptCount" = 1 WHERE "Id" = @id""",
            ("id", requestId));
        await ExecuteAsync(
            """
            INSERT INTO invitations."ActionMailAttempts" (
                "Id", "TenantId", "RequestId", "InvitationId", "LogicalSendGeneration",
                "AttemptNumber", "ClaimToken", "ProviderIdempotencyKey", "StartedAtUtc",
                "Outcome", "CreatedAtUtc", "UpdatedAtUtc")
            SELECT gen_random_uuid(), r."TenantId", r."Id", r."InvitationId", r."LogicalSendGeneration",
                   1, @claim,
                   'invitation-action:' || replace(r."Id"::text, '-', '') || ':a1:v1:' ||
                       left(encode(sha256(convert_to('stale', 'UTF8')), 'hex'), 32),
                   @started, 'Started', @started, @started
            FROM invitations."ActionMailRequests" r WHERE r."Id" = @id
            """,
            ("claim", staleClaim),
            ("started", Clock.UtcNow.AddMinutes(-5)),
            ("id", requestId));

        var outcome = await SweepInvitationMailAsync();
        Assert.AreEqual(1, outcome.Reclaimed, "The expired lease was not reclaimed.");

        Assert.AreEqual(
            nameof(InvitationActionMailOutcome.Abandoned),
            await ScalarAsync<string>(
                """
                SELECT "Outcome" FROM invitations."ActionMailAttempts"
                WHERE "RequestId" = @id AND "ClaimToken" = @claim
                """,
                ("id", requestId),
                ("claim", staleClaim)),
            "A reclaimed lease must leave its interrupted attempt recorded as abandoned.");

        // The stale claimant is refused twice over, and the two refusals are different mechanisms.
        // Presenting its own claim token matches no row at all, because the takeover replaced it: the
        // worker's update silently does nothing rather than overwriting a newer result.
        var staleRows = await AffectedRowsAsync(
            """
            UPDATE invitations."ActionMailRequests"
            SET "Status" = 'Materialized', "MaterializedAtUtc" = @now,
                "CompletedAtUtc" = @now, "TransportAdapter" = 'resend',
                "ClaimToken" = NULL, "ClaimExpiresAtUtc" = NULL
            WHERE "Id" = @id AND "ClaimToken" = @claim
            """,
            ("now", Clock.UtcNow),
            ("id", requestId),
            ("claim", staleClaim));
        Assert.AreEqual(0, staleRows, "A stale claim must match no row to finalize.");

        // And forcing it - dropping the claim filter entirely, the way a support script would - is
        // refused by the database, because the request the newer worker completed is terminal.
        await AssertRefusedAsync(
            """
            UPDATE invitations."ActionMailRequests"
            SET "Status" = 'Materialized', "MaterializedAtUtc" = @now,
                "CompletedAtUtc" = @now, "TransportAdapter" = 'resend',
                "ClaimToken" = NULL, "ClaimExpiresAtUtc" = NULL
            WHERE "Id" = @id
            """,
            "a forced finalization of a request another worker already completed",
            ("now", Clock.UtcNow),
            ("id", requestId));
    }

    // ---------- helpers ----------

    private WebApplicationFactory<Program> RequiredFactory =>
        factory ?? throw new InvalidOperationException("The test application is not initialized.");

    private string RequiredConnection =>
        databaseConnection ?? throw new InvalidOperationException("The test database is not initialized.");

    private MutableClock Clock =>
        testClock ?? throw new InvalidOperationException("The test clock is not initialized.");

    private CapturedLog Log =>
        log ?? throw new InvalidOperationException("The log capture is not initialized.");

    private ProviderDouble Provider =>
        providerDouble ?? throw new InvalidOperationException("The provider double is not initialized.");

    private HttpClient CreateClient() => RequiredFactory.CreateClient(new WebApplicationFactoryClientOptions
    {
        AllowAutoRedirect = false,
        HandleCookies = true,
        BaseAddress = new Uri("http://localhost"),
    });

    private async Task<InvitationActionMailDispatchOutcome> SweepInvitationMailAsync()
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        return await scope.ServiceProvider
            .GetRequiredService<IInvitationActionMailDispatchService>()
            .DispatchDueAsync(TestContext.CancellationToken);
    }

    /// <summary>
    /// Registers a coach without the captured adapter's inline link.
    /// </summary>
    /// <remarks>
    /// Under a real provider adapter there is no capture buffer and registration returns no
    /// development link, so the confirmation is completed by minting through the queue and reading the
    /// link out of the request the provider double received. That is closer to what actually happens
    /// in production than the captured path is.
    /// </remarks>
    private async Task<Workspace> CreateWorkspaceAsync(string label)
    {
        var suffix = Guid.NewGuid().ToString("N")[..10];
        var coach = CreateClient();
        var email = $"coach-{label}-{suffix}@tbgym.test";

        Provider.Responder = _ => ProviderResponse.Accepted($"prov_{Guid.NewGuid():N}");
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync(
            "/api/auth/register/coach",
            new
            {
                displayName = $"{label} Coach",
                email,
                password = Password,
                workspaceName = $"{label} {suffix}",
                timeZoneId = "Asia/Beirut",
                defaultCulture = "en-LB",
                defaultCurrencyCode = "USD",
                weekStartsOn = "Monday",
            },
            TestContext.CancellationToken);
        await AssertStatusAsync(response, HttpStatusCode.Accepted);

        await SweepAccountMailAsync();
        var confirmationLink = LinkFrom(Provider.Requests[^1].Body);
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync(
                "/api/auth/confirm-email",
                new
                {
                    userId = Guid.Parse(QueryValue(confirmationLink, "userId")),
                    code = QueryValue(confirmationLink, "code"),
                },
                TestContext.CancellationToken),
            HttpStatusCode.NoContent);

        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync(
                "/api/auth/login",
                new { email, password = Password, rememberMe = false },
                TestContext.CancellationToken),
            HttpStatusCode.OK);
        var memberships = await coach.GetFromJsonAsync<Membership[]>("/api/tenants", TestContext.CancellationToken)
            ?? throw new AssertFailedException("Workspace membership was empty.");
        var tenantId = memberships.Single().TenantId;
        coach.DefaultRequestHeaders.Remove("X-Tenant-Id");
        coach.DefaultRequestHeaders.Add("X-Tenant-Id", tenantId.ToString());

        Provider.Clear();
        return new Workspace(tenantId, coach, email, suffix);
    }

    private async Task SweepAccountMailAsync()
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        await scope.ServiceProvider
            .GetRequiredService<TB.Gym.Modules.Identity.IAccountActionMailDispatchService>()
            .DispatchDueAsync(TestContext.CancellationToken);
    }

    private async Task<Guid> CreateInvitationAsync(Workspace workspace, string email)
    {
        await RefreshCsrfAsync(workspace.Coach);
        var response = await workspace.Coach.PostAsJsonAsync(
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
        var created = await response.Content.ReadFromJsonAsync<InvitationView>(TestContext.CancellationToken)
            ?? throw new AssertFailedException("The invitation response was empty.");
        return created.Id;
    }

    /// <summary>The action link the adapter actually put in the message body it sent.</summary>
    private static string LinkFrom(string providerRequestBody)
    {
        using var document = JsonDocument.Parse(providerRequestBody);
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

    private static string TokenOf(string invitationUrl) => QueryValue(invitationUrl, "token");

    private static string QueryValue(string url, string key)
    {
        var query = QueryHelpers.ParseQuery(new Uri(url).Query);
        return query.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value)
            ? value.ToString()
            : throw new AssertFailedException($"The URL does not contain query value '{key}'.");
    }

    private static async Task RefreshCsrfAsync(HttpClient client)
    {
        var csrf = await client.GetFromJsonAsync<Csrf>("/api/auth/csrf")
            ?? throw new AssertFailedException("CSRF response was empty.");
        client.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
        client.DefaultRequestHeaders.Add("X-XSRF-TOKEN", csrf.Token);
    }

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

    private Task<int> GenerationAsync(Guid invitationId) => ScalarAsync<int>(
        """SELECT "LogicalSendGeneration" FROM invitations."ClientInvitations" WHERE "Id" = @id""",
        ("id", invitationId));

    private async Task<IReadOnlyList<IssueRow>> TokenIssuesAsync(Guid invitationId)
    {
        await using var connection = new NpgsqlConnection(RequiredConnection);
        await connection.OpenAsync(TestContext.CancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT "TokenHash", "LogicalSendGeneration", "RevokedAtUtc"
            FROM invitations."TokenIssues" WHERE "InvitationId" = @id ORDER BY "IssuedAtUtc"
            """;
        command.Parameters.AddWithValue("id", invitationId);
        var rows = new List<IssueRow>();
        await using var reader = await command.ExecuteReaderAsync(TestContext.CancellationToken);
        while (await reader.ReadAsync(TestContext.CancellationToken))
        {
            rows.Add(new IssueRow(
                reader.GetString(0),
                reader.GetInt32(1),
                reader.IsDBNull(2) ? null : reader.GetFieldValue<DateTimeOffset>(2)));
        }

        return rows;
    }

    private async Task<IReadOnlyList<string>> ProviderKeysAsync(Guid invitationId)
    {
        await using var connection = new NpgsqlConnection(RequiredConnection);
        await connection.OpenAsync(TestContext.CancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT "ProviderIdempotencyKey" FROM invitations."ActionMailAttempts"
            WHERE "InvitationId" = @id ORDER BY "AttemptNumber"
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

    private async Task RevokeInvitationAsync(Workspace workspace, Guid invitationId)
    {
        await RefreshCsrfAsync(workspace.Coach);
        var version = await ScalarAsync<long>(
            """SELECT xmin::text::bigint FROM invitations."ClientInvitations" WHERE "Id" = @id""",
            ("id", invitationId));
        await AssertStatusAsync(
            await workspace.Coach.PostAsJsonAsync(
                $"/api/invitations/{invitationId}/revoke",
                new { version },
                TestContext.CancellationToken),
            HttpStatusCode.OK);
    }

    private async Task ResendInvitationAsync(Workspace workspace, Guid invitationId)
    {
        await RefreshCsrfAsync(workspace.Coach);
        var version = await ScalarAsync<long>(
            """SELECT xmin::text::bigint FROM invitations."ClientInvitations" WHERE "Id" = @id""",
            ("id", invitationId));
        await AssertStatusAsync(
            await workspace.Coach.PostAsJsonAsync(
                $"/api/invitations/{invitationId}/resend",
                new { idempotencyKey = Guid.NewGuid(), version },
                TestContext.CancellationToken),
            HttpStatusCode.OK);
    }

    private async Task AssertSuppressedAsync(Guid invitationId, int generation, string expectedCode)
    {
        Assert.AreEqual(
            nameof(InvitationActionMailStatus.Suppressed),
            await ScalarAsync<string>(
                """
                SELECT "Status" FROM invitations."ActionMailRequests"
                WHERE "InvitationId" = @id AND "LogicalSendGeneration" = @generation
                """,
                ("id", invitationId),
                ("generation", generation)),
            $"Generation {generation} of invitation {invitationId} was not suppressed.");
        Assert.AreEqual(
            expectedCode,
            await ScalarAsync<string>(
                """
                SELECT "FailureCode" FROM invitations."ActionMailRequests"
                WHERE "InvitationId" = @id AND "LogicalSendGeneration" = @generation
                """,
                ("id", invitationId),
                ("generation", generation)));
        Assert.AreEqual(
            0L,
            await ScalarAsync<long>(
                """
                SELECT count(*) FROM invitations."TokenIssues"
                WHERE "InvitationId" = @id AND "LogicalSendGeneration" = @generation
                """,
                ("id", invitationId),
                ("generation", generation)),
            "A suppressed generation must not have minted a token.");
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

    /// <summary>Runs one statement and reports how many rows it changed.</summary>
    private async Task<int> AffectedRowsAsync(string sql, params (string Name, object Value)[] parameters)
    {
        await using var connection = new NpgsqlConnection(RequiredConnection);
        await connection.OpenAsync(TestContext.CancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        foreach (var (name, value) in parameters)
        {
            command.Parameters.AddWithValue(name, value);
        }

        return await command.ExecuteNonQueryAsync(TestContext.CancellationToken);
    }

    /// <summary>Every text value in the named tables, as one string.</summary>
    private async Task<string> DumpTablesTextAsync(params (string Schema, string Table)[] tables)
    {
        await using var connection = new NpgsqlConnection(RequiredConnection);
        await connection.OpenAsync(TestContext.CancellationToken);
        var dump = new StringBuilder();
        foreach (var (schema, table) in tables)
        {
            await using var columnQuery = connection.CreateCommand();
            columnQuery.CommandText = """
                SELECT column_name FROM information_schema.columns
                WHERE table_schema = @schema AND table_name = @table ORDER BY ordinal_position
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

    private async Task AssertRefusedAsync(
        string sql,
        string description,
        params (string Name, object Value)[] parameters)
    {
        try
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
        catch (PostgresException)
        {
            return;
        }

        Assert.Fail($"The database accepted {description}, which it must refuse.");
    }

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

    // ---------- records and doubles ----------

    private sealed record Workspace(Guid TenantId, HttpClient Coach, string CoachEmail, string Suffix);

    private sealed record Csrf(string Token);

    private sealed record Membership(Guid TenantId);

    private sealed record InvitationView(Guid Id, int LogicalSendGeneration, long Version);

    private sealed record IssueRow(string TokenHash, int Generation, DateTimeOffset? RevokedAtUtc);

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

    /// <summary>
    /// A real HTTP server on a loopback port, standing in for the provider.
    /// </summary>
    /// <remarks>
    /// Nothing here reaches the network: it binds 127.0.0.1 on a port the operating system chooses,
    /// and that address is what the adapter is configured with. It records every request so the
    /// assertions can read the idempotency key and the rendered body the adapter really sent.
    /// </remarks>
    internal sealed class ProviderDouble : IAsyncDisposable
    {
        private readonly WebApplication app;
        private readonly ConcurrentQueue<ProviderRequest> requests = new();

        private ProviderDouble(WebApplication app, string origin)
        {
            this.app = app;
            SendEndpoint = $"{origin}/emails";
        }

        public string SendEndpoint { get; }

        public IReadOnlyList<ProviderRequest> Requests => [.. requests];

        public Func<int, ProviderResponse> Responder { get; set; } =
            _ => ProviderResponse.Accepted(Guid.NewGuid().ToString());

        public static async Task<ProviderDouble> StartAsync()
        {
            var builder = WebApplication.CreateSlimBuilder();
            builder.Logging.ClearProviders();
            builder.WebHost.ConfigureKestrel(kestrel =>
                kestrel.Listen(System.Net.IPAddress.Loopback, 0, listen => listen.Protocols = HttpProtocols.Http1));

            var app = builder.Build();
            ProviderDouble? instance = null;
            app.MapPost("/emails", async (HttpContext context) =>
            {
                using var reader = new StreamReader(context.Request.Body, Encoding.UTF8);
                var body = await reader.ReadToEndAsync();
                var response = instance!.Record(new ProviderRequest(
                    context.Request.Headers["Idempotency-Key"].ToString(),
                    body));
                if (response.Delay > TimeSpan.Zero)
                {
                    await Task.Delay(response.Delay, context.RequestAborted);
                }

                context.Response.StatusCode = response.StatusCode;
                context.Response.ContentType = "application/json";
                await context.Response.WriteAsync(response.Body);
            });

            await app.StartAsync();
            instance = new ProviderDouble(app, app.Urls.First());
            return instance;
        }

        /// <summary>Forgets everything recorded so far, so a test's setup does not pollute its assertions.</summary>
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

    internal sealed record ProviderRequest(string IdempotencyKey, string Body);

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
