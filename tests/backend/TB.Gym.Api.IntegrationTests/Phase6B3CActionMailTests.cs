using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.DependencyInjection;
using TB.Gym.Infrastructure.Application;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Invitations;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Phase 6B-3C: account confirmation, password reset and invitation mail on ADR 0021's tokenless
/// materialization.
/// </summary>
/// <remarks>
/// These run against the captured transport, so the whole path is exercised — enqueue, claim,
/// authorization recheck, mint, commit the token hash, render, send, finalize — with no network and
/// with the rendered message available for the privacy assertions to prove was never persisted.
/// The provider-facing half, including transport retries and idempotency keys, is in
/// <see cref="Phase6B3CActionMailProviderTests"/>.
/// </remarks>
[TestClass]
public sealed partial class Phase6B3CActionMailTests
{
    /// <summary>
    /// Requirement 1: nothing a recipient received is anywhere durable.
    /// </summary>
    /// <remarks>
    /// The strongest form of this assertion available: run every flow this phase touches, then take
    /// what the captured adapter actually produced — the address, the raw token, the complete URL and
    /// the rendered body — and prove none of it appears in any text column of the identity or
    /// invitations schemas, or in any log line.
    /// </remarks>
    [TestMethod]
    public async Task NoRawTokenCompleteUrlRecipientOrRenderedBodyReachesPostgreSqlOrLogs()
    {
        var workspace = await CreateWorkspaceAsync("privacy");
        var clientEmail = $"client-privacy-{workspace.Suffix}@tbgym.test";
        var invitation = await CreateInvitationAsync(workspace.Coach, clientEmail);
        await SweepInvitationMailAsync();

        await RefreshCsrfAsync(workspace.Coach);
        await AssertStatusAsync(
            await ResendInvitationAsync(workspace.Coach, invitation.Id, Guid.NewGuid(), invitation.Version),
            HttpStatusCode.OK);
        await SweepInvitationMailAsync();
        await ResetLinkForAsync(CreateClient(), workspace.CoachEmail);

        Assert.IsGreaterThan(
            0,
            CapturedMail.Captured.Count,
            "The captured adapter recorded nothing, so this test would prove nothing.");
        await AssertNoCredentialReachedStorageOrLogsAsync();
    }

    /// <summary>
    /// Requirements 2 and 4: global Identity mail belongs to an account, not to a workspace.
    /// </summary>
    /// <remarks>
    /// The queue is not merely unfiltered by tenant — it has no tenant column at all. That is the
    /// point ADR 0021 makes: a column that does not exist cannot be fabricated, cannot be joined on,
    /// and cannot appear in a tenant-scoped export, which is a stronger guarantee than any rule about
    /// a nullable one. The public contract is checked too, so no route can grow one by accident.
    /// </remarks>
    [TestMethod]
    public async Task GlobalAccountActionMailHasNoWorkspaceAndNoTenantVisibleSurface()
    {
        var workspace = await CreateWorkspaceAsync("global");

        foreach (var table in new[] { "ActionMailRequests", "ActionMailAttempts" })
        {
            var tenantColumns = await ScalarAsync<long>(
                """
                SELECT count(*) FROM information_schema.columns
                WHERE table_schema = 'identity' AND table_name = @table AND column_name = 'TenantId'
                """,
                ("table", table));
            Assert.AreEqual(
                0L,
                tenantColumns,
                $"identity.{table} must not have a TenantId column; global mail is not tenant mail.");
        }

        var requests = await AccountRequestsAsync();
        Assert.IsGreaterThan(0, requests.Count, "Registration must have queued a confirmation request.");

        // No public route describes the global queue, so no workspace operator can read one.
        using var client = CreateClient();
        var contract = await client.GetStringAsync("/openapi/v1.json", TestContext.CancellationToken);
        foreach (var term in new[] { "AccountActionMail", "ActionMailRequest", "ActionMailAttempt" })
        {
            Assert.DoesNotContain(
                term,
                contract,
                StringComparison.Ordinal,
                $"The public contract exposes '{term}', so global action-mail state has a tenant-visible surface.");
        }

        SetTenant(workspace.Coach, workspace.TenantId);
        var deadLetters = await workspace.Coach.GetStringAsync(
            "/api/workspace/notification-dead-letters",
            TestContext.CancellationToken);
        foreach (var request in requests)
        {
            Assert.DoesNotContain(
                request.Id.ToString(),
                deadLetters,
                StringComparison.OrdinalIgnoreCase,
                "A workspace owner's dead-letter view exposed a global account action mail request.");
        }
    }

    /// <summary>
    /// Requirement 3: password reset works for an account with no workspace membership at all.
    /// </summary>
    /// <remarks>
    /// The account is created through an invitation and then has its membership removed, which leaves
    /// a real Identity account belonging to no workspace. Under the old tenant-shaped assumption there
    /// would be nothing to key the mail on; here it simply works, because the queue never needed one.
    /// </remarks>
    [TestMethod]
    public async Task PasswordResetWorksForAnAccountWithNoWorkspaceMembership()
    {
        var workspace = await CreateWorkspaceAsync("membershipless");
        var email = $"client-nomember-{workspace.Suffix}@tbgym.test";
        var invitation = await CreateInvitationAsync(workspace.Coach, email);
        await SweepInvitationMailAsync();

        using var invitee = CreateClient();
        await AssertStatusAsync(
            await AcceptInvitationAsync(invitee, TokenOf(RequiredInvitationLink())),
            HttpStatusCode.OK);

        var userId = await ScalarAsync<Guid>(
            """SELECT "Id" FROM identity."Users" WHERE "Email" = @email""",
            ("email", email));
        await ExecuteAsync(
            """DELETE FROM tenancy."Memberships" WHERE "UserId" = @id""",
            ("id", userId));
        Assert.AreEqual(
            0L,
            await ScalarAsync<long>(
                """SELECT count(*) FROM tenancy."Memberships" WHERE "UserId" = @id""",
                ("id", userId)),
            "The account still has a membership, so this proves nothing about tenantless mail.");

        using var recovering = CreateClient();
        var link = await ResetLinkForAsync(recovering, email);
        Assert.IsNotNull(link, "A tenantless account must still be able to receive a reset link.");

        var newPassword = $"Bb2@{Guid.NewGuid():N}";
        await AssertStatusAsync(await ResetPasswordAsync(recovering, link!, newPassword), HttpStatusCode.NoContent);
        await SignInAsync(recovering, email, newPassword);

        Assert.AreEqual(invitation.Id, invitation.Id);
    }

    [TestMethod]
    public async Task SuccessfulAccountActionMailRecordsTokenMintBeforeCompletion()
    {
        var workspace = await CreateWorkspaceAsync("account-mint-evidence");
        using var caller = CreateClient();
        Assert.IsNotNull(await ResetLinkForAsync(caller, workspace.CoachEmail));

        Assert.IsGreaterThanOrEqualTo(
            2L,
            await ScalarAsync<long>(
                """
                SELECT count(*) FROM identity."ActionMailAttempts"
                WHERE "Outcome" = 'Succeeded' AND "TokenMintedAtUtc" IS NOT NULL
                """),
            "Confirmation and reset should both have durable token-mint evidence.");
        Assert.AreEqual(
            0L,
            await ScalarAsync<long>(
                """
                SELECT count(*) FROM identity."ActionMailAttempts"
                WHERE "Outcome" = 'Succeeded' AND "TokenMintedAtUtc" IS NULL
                """));
    }

    /// <summary>
    /// Requirement 5: a known and an unknown address are indistinguishable from outside.
    /// </summary>
    /// <remarks>
    /// Three things are asserted, and all three matter. The status and the body are identical, so
    /// there is nothing to read. Each path writes exactly one durable request, so there is no
    /// difference in what the system does. And the unknown-address request carries no subject and no
    /// credential-state digest, so the row itself holds nothing an address could be recovered from.
    /// <para>
    /// Timing is asserted separately in
    /// <see cref="KnownAndUnknownPasswordResetRequestsCostEquivalentBoundedWork"/>, because a latency
    /// assertion needs a different shape to stay non-flaky.
    /// </para>
    /// </remarks>
    [TestMethod]
    public async Task KnownAndUnknownPasswordResetRequestsAreIndistinguishableToTheCaller()
    {
        var workspace = await CreateWorkspaceAsync("uniform");
        using var caller = CreateClient();

        var known = await RequestPasswordResetAsync(caller, workspace.CoachEmail);
        var knownBody = await known.Content.ReadAsStringAsync(TestContext.CancellationToken);
        var unknown = await RequestPasswordResetAsync(caller, $"nobody-{Guid.NewGuid():N}@tbgym.test");
        var unknownBody = await unknown.Content.ReadAsStringAsync(TestContext.CancellationToken);

        Assert.AreEqual(known.StatusCode, unknown.StatusCode);
        Assert.AreEqual(HttpStatusCode.Accepted, known.StatusCode);
        Assert.AreEqual(knownBody, unknownBody, "The two answers differ, which is an enumeration oracle.");

        var resets = (await AccountRequestsAsync())
            .Where(request => request.ActionKind == nameof(AccountActionKind.ResetPassword))
            .ToArray();
        Assert.HasCount(2, resets, "Both paths must write exactly one durable request.");
        Assert.AreEqual(1, resets.Count(request => request.SubjectUserId is not null));

        var unresolved = resets.Single(request => request.SubjectUserId is null);
        Assert.IsNull(
            unresolved.SubjectSecurityStampHash,
            "An unresolved request must carry nothing that could identify an account.");
        Assert.AreEqual(AccountActionMailSources.PublicPasswordRecovery, unresolved.RequestSource);

        // And it terminates safely rather than sitting in the queue forever.
        await SweepAccountMailAsync();
        var swept = (await AccountRequestsAsync()).Single(request => request.Id == unresolved.Id);
        Assert.AreEqual(nameof(AccountActionMailStatus.Suppressed), swept.Status);
        Assert.AreEqual(AccountActionMailCodes.SubjectUnresolved, swept.FailureCode);
        Assert.AreEqual(0, swept.AttemptCount, "A request that contacts nobody must spend no attempt.");
    }

    /// <summary>
    /// Requirement 5, timing: the two paths cost equivalent bounded work.
    /// </summary>
    /// <remarks>
    /// Deliberately a coarse assertion, and deliberately on the median rather than the mean. The
    /// defect worth catching is a gross regression — somebody reintroducing a synchronous token mint,
    /// a password-hash comparison or an extra round trip on the known path — and that shows up as a
    /// multiple, not as a few milliseconds. A tighter bound would fail on a loaded CI machine for
    /// reasons that have nothing to do with enumeration, which is worse than no test because somebody
    /// would eventually delete it.
    /// </remarks>
    [TestMethod]
    public async Task KnownAndUnknownPasswordResetRequestsCostEquivalentBoundedWork()
    {
        const int samples = 9;
        var workspace = await CreateWorkspaceAsync("timing");
        using var caller = CreateClient();

        // One of each first, so neither measurement pays for a cold connection pool or a first-call
        // query plan that the other one then benefits from.
        await RequestPasswordResetAsync(caller, workspace.CoachEmail);
        await RequestPasswordResetAsync(caller, $"warm-{Guid.NewGuid():N}@tbgym.test");

        var knownTimings = new List<double>(samples);
        var unknownTimings = new List<double>(samples);
        for (var index = 0; index < samples; index++)
        {
            // Interleaved, so a machine that gets busier partway through affects both equally.
            knownTimings.Add(await MeasureAsync(caller, workspace.CoachEmail));
            unknownTimings.Add(await MeasureAsync(caller, $"nobody-{Guid.NewGuid():N}@tbgym.test"));
        }

        var known = Median(knownTimings);
        var unknown = Median(unknownTimings);
        var slower = Math.Max(known, unknown);
        var faster = Math.Min(known, unknown);

        Assert.IsLessThan(
            3.0,
            slower / Math.Max(faster, 0.001),
            $"Known ({known:0.0} ms) and unknown ({unknown:0.0} ms) recovery requests differ by more " +
            "than a factor of three, which is the shape of an enumeration oracle.");
        Assert.IsLessThan(
            250.0,
            Math.Abs(known - unknown),
            $"Known ({known:0.0} ms) and unknown ({unknown:0.0} ms) recovery requests differ by more " +
            "than 250 ms.");

        async Task<double> MeasureAsync(HttpClient client, string email)
        {
            var stopwatch = Stopwatch.StartNew();
            var response = await RequestPasswordResetAsync(client, email);
            stopwatch.Stop();
            await AssertStatusAsync(response, HttpStatusCode.Accepted);
            return stopwatch.Elapsed.TotalMilliseconds;
        }

        static double Median(List<double> values)
        {
            var ordered = values.Order().ToArray();
            return ordered.Length % 2 == 1
                ? ordered[ordered.Length / 2]
                : (ordered[(ordered.Length / 2) - 1] + ordered[ordered.Length / 2]) / 2;
        }
    }

    /// <summary>
    /// Requirement 6: confirmation is suppressed once the address is confirmed.
    /// </summary>
    /// <remarks>
    /// The recheck happens after the claim commits and before anything is minted, so a confirmation
    /// that has already been completed by another route never becomes a second live credential in a
    /// mailbox.
    /// </remarks>
    [TestMethod]
    public async Task ConfirmationIsSuppressedOnceTheAddressIsAlreadyConfirmed()
    {
        var workspace = await CreateWorkspaceAsync("confirmed");
        var userId = await ScalarAsync<Guid>(
            """SELECT "Id" FROM identity."Users" WHERE "Email" = @email""",
            ("email", workspace.CoachEmail));

        // A second confirmation request for an address that is already confirmed.
        var requestId = await EnqueueConfirmationAsync(userId);
        await SweepAccountMailAsync();

        var request = (await AccountRequestsAsync()).Single(item => item.Id == requestId);
        Assert.AreEqual(nameof(AccountActionMailStatus.Suppressed), request.Status);
        Assert.AreEqual(AccountActionMailCodes.AlreadyConfirmed, request.FailureCode);
    }

    /// <summary>
    /// Requirement 7: a reset is suppressed after the password or security stamp changes.
    /// </summary>
    /// <remarks>
    /// The token would be refused at redemption anyway, because Identity's own provider binds it to
    /// the stamp. Suppressing instead of minting means the outcome is a recorded fact rather than a
    /// live credential in a mailbox that fails confusingly when somebody clicks it.
    /// </remarks>
    [TestMethod]
    public async Task ResetIsSuppressedAfterTheCredentialStateChanges()
    {
        var workspace = await CreateWorkspaceAsync("stale-reset");
        using var caller = CreateClient();
        await AssertStatusAsync(
            await RequestPasswordResetAsync(caller, workspace.CoachEmail),
            HttpStatusCode.Accepted);

        var userId = await ScalarAsync<Guid>(
            """SELECT "Id" FROM identity."Users" WHERE "Email" = @email""",
            ("email", workspace.CoachEmail));
        await ExecuteAsync(
            """UPDATE identity."Users" SET "SecurityStamp" = @stamp WHERE "Id" = @id""",
            ("stamp", Guid.NewGuid().ToString("N").ToUpperInvariant()),
            ("id", userId));

        await SweepAccountMailAsync();

        var reset = (await AccountRequestsAsync())
            .Single(request => request.ActionKind == nameof(AccountActionKind.ResetPassword));
        Assert.AreEqual(nameof(AccountActionMailStatus.Suppressed), reset.Status);
        Assert.AreEqual(AccountActionMailCodes.CredentialChanged, reset.FailureCode);
        Assert.IsEmpty(
            CapturedMail.Captured.Where(capture => capture.Scope == ActionMailScopes.Account
                && capture.RequestId == reset.Id),
            "A suppressed reset must not have produced a message.");
    }

    /// <summary>
    /// Requirement 8: invalid, expired and reused reset tokens fail safely and identically.
    /// </summary>
    [TestMethod]
    public async Task InvalidAndReusedResetTokensFailSafely()
    {
        var workspace = await CreateWorkspaceAsync("reset-reuse");
        using var caller = CreateClient();
        var link = await ResetLinkForAsync(caller, workspace.CoachEmail);
        Assert.IsNotNull(link);

        var newPassword = $"Cc3#{Guid.NewGuid():N}";
        await AssertStatusAsync(
            await ResetPasswordAsync(caller, link!, newPassword),
            HttpStatusCode.NoContent);

        // Reused: the successful reset rotated the security stamp, which invalidates the token.
        await AssertStatusAsync(
            await ResetPasswordAsync(caller, link!, $"Dd4${Guid.NewGuid():N}"),
            HttpStatusCode.BadRequest);

        // Malformed, and an unknown subject: both answer the same way.
        var garbled = QueryHelpers.AddQueryString(
            $"{PublicOrigin}/auth/reset-password",
            new Dictionary<string, string?>
            {
                ["userId"] = QueryValue(link!, "userId"),
                ["code"] = "not-a-valid-token",
            });
        await AssertStatusAsync(
            await ResetPasswordAsync(caller, garbled, $"Ee5%{Guid.NewGuid():N}"),
            HttpStatusCode.BadRequest);

        // The original password no longer works and the new one does, so the first reset really landed.
        await SignInAsync(caller, workspace.CoachEmail, newPassword);
    }

    /// <summary>
    /// Requirement 11: a deliberate resend creates a new generation and kills the old one.
    /// </summary>
    /// <remarks>
    /// The whole substance of ADR 0021's invitation section. The old link stops working immediately,
    /// the new one works, and the record shows exactly which generation each token belonged to and why
    /// the earlier one was revoked.
    /// </remarks>
    [TestMethod]
    public async Task ADeliberateResendCreatesANewGenerationAndRevokesTheOldOne()
    {
        var workspace = await CreateWorkspaceAsync("resend");
        var email = $"client-resend-{workspace.Suffix}@tbgym.test";
        var invitation = await CreateInvitationAsync(workspace.Coach, email);
        await SweepInvitationMailAsync();
        var firstLink = RequiredInvitationLink();

        await RefreshCsrfAsync(workspace.Coach);
        var resend = await ResendInvitationAsync(
            workspace.Coach,
            invitation.Id,
            Guid.NewGuid(),
            invitation.Version);
        await AssertStatusAsync(resend, HttpStatusCode.OK);
        var resent = await RequiredJsonAsync<InvitationView>(resend);
        await SweepInvitationMailAsync();
        var secondLink = RequiredInvitationLink();

        Assert.AreNotEqual(firstLink, secondLink, "A resend must produce a different link.");
        Assert.AreEqual(2, resent.LogicalSendGeneration);
        Assert.AreEqual(2, resent.SendCount);
        Assert.AreEqual(2, await GenerationAsync(invitation.Id));

        var issues = await TokenIssuesAsync(invitation.Id);
        Assert.HasCount(2, issues);
        var superseded = issues.Single(issue => issue.LogicalSendGeneration == 1);
        Assert.IsNotNull(superseded.RevokedAtUtc, "The previous generation's token must be revoked.");
        Assert.AreEqual(
            InvitationActionMailCodes.TokenSupersededByResend,
            superseded.RevocationReason);
        var current = issues.Single(issue => issue.LogicalSendGeneration == 2);
        Assert.IsNull(current.RevokedAtUtc);

        // Decisive: the old link is dead, and answers exactly like an unknown token.
        using var invitee = CreateClient();
        await AssertStatusAsync(
            await invitee.GetAsync(
                $"/api/invitations/public/{Uri.EscapeDataString(TokenOf(firstLink))}",
                TestContext.CancellationToken),
            HttpStatusCode.NotFound);
        await AssertStatusAsync(
            await AcceptInvitationAsync(invitee, TokenOf(firstLink)),
            HttpStatusCode.Gone);

        // And the new one works.
        await AssertStatusAsync(
            await AcceptInvitationAsync(invitee, TokenOf(secondLink)),
            HttpStatusCode.OK);
    }

    /// <summary>
    /// Requirement 12: concurrent acceptance of one invitation succeeds exactly once.
    /// </summary>
    /// <remarks>
    /// Two independent callers present the same link at the same moment. Exactly one creates the
    /// membership and the client profile; the other either loses the race outright or converges on
    /// the winner's result, and in neither case is a second profile created.
    /// </remarks>
    [TestMethod]
    public async Task ConcurrentInvitationAcceptanceSucceedsExactlyOnce()
    {
        var workspace = await CreateWorkspaceAsync("accept-race");
        var email = $"client-race-{workspace.Suffix}@tbgym.test";
        var invitation = await CreateInvitationAsync(workspace.Coach, email);
        await SweepInvitationMailAsync();
        var token = TokenOf(RequiredInvitationLink());

        using var first = CreateClient();
        using var second = CreateClient();
        await RefreshCsrfAsync(first);
        await RefreshCsrfAsync(second);

        var responses = await Task.WhenAll(
            AcceptInvitationAsync(first, token),
            AcceptInvitationAsync(second, token));

        // Both callers hold the same valid token, so both may be told the invitation is accepted;
        // what may not happen twice is the acceptance itself. Anything other than success or a
        // convergent conflict would mean one of them saw a state that never existed.
        foreach (var response in responses)
        {
            Assert.IsTrue(
                response.StatusCode is HttpStatusCode.OK or HttpStatusCode.Conflict,
                $"A concurrent acceptance answered {(int)response.StatusCode}.");
        }

        Assert.AreEqual(
            1L,
            await ScalarAsync<long>(
                """SELECT count(*) FROM identity."Users" WHERE "Email" = @email""",
                ("email", email)),
            "Concurrent acceptance created more than one account.");

        Assert.AreEqual(
            1L,
            await ScalarAsync<long>(
                """SELECT count(*) FROM clients."ClientProfiles" WHERE "NormalizedEmail" = @email""",
                ("email", email.ToUpperInvariant())),
            "Concurrent acceptance created more than one client profile.");
        Assert.AreEqual(
            1L,
            await ScalarAsync<long>(
                """
                SELECT count(*) FROM tenancy."Memberships" m
                JOIN identity."Users" u ON u."Id" = m."UserId"
                WHERE u."Email" = @email
                """,
                ("email", email)),
            "Concurrent acceptance created more than one membership.");

        var issues = await TokenIssuesAsync(invitation.Id);
        Assert.AreEqual(
            1,
            issues.Count(issue => issue.RedeemedAtUtc is not null),
            "An invitation token is single-use.");
    }

    /// <summary>
    /// An acceptance whose account insert loses to Identity's uniqueness converges, and never
    /// answers with the invited address.
    /// </summary>
    /// <remarks>
    /// This is the deterministic stand-in for the losing half of the race above. Two callers
    /// presenting one link both pass the "no account for this address yet" check before either
    /// commits, so the loser's insert fails on Identity's uniqueness rather than on anything the
    /// caller sent. That interleaving cannot be scheduled reliably, so it is reproduced here by an
    /// account whose user name is the invited address while its own address is different: the
    /// pre-check misses it and the insert still refuses it, which is exactly the loser's position.
    /// <para>
    /// Two things must hold. The answer is the same convergent conflict a caller gets when the
    /// account was already there, because losing a race did not make the request malformed. And the
    /// body does not repeat Identity's "is already taken" text, which on an anonymous public
    /// endpoint would disclose that an account exists for an address this flow otherwise never
    /// confirms.
    /// </para>
    /// </remarks>
    [TestMethod]
    public async Task AnAcceptanceLosingTheAccountInsertConvergesWithoutNamingTheAddress()
    {
        var workspace = await CreateWorkspaceAsync("accept-collide");
        var email = $"client-collide-{workspace.Suffix}@tbgym.test";
        await CreateInvitationAsync(workspace.Coach, email);
        await SweepInvitationMailAsync();
        var token = TokenOf(RequiredInvitationLink());

        await using (var scope = RequiredFactory.Services.CreateAsyncScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var collision = new ApplicationUser
            {
                Id = Guid.CreateVersion7(),
                UserName = email,
                Email = $"other-{workspace.Suffix}@tbgym.test",
                EmailConfirmed = true,
                DisplayName = "Name Collision",
                CreatedAtUtc = Clock.UtcNow,
                UpdatedAtUtc = Clock.UtcNow,
            };
            Assert.IsTrue(
                (await users.CreateAsync(collision, Password)).Succeeded,
                "The colliding account could not be seeded.");
        }

        using var invitee = CreateClient();
        var response = await AcceptInvitationAsync(invitee, token);
        var body = await response.Content.ReadAsStringAsync(TestContext.CancellationToken);

        Assert.AreEqual(
            HttpStatusCode.Conflict,
            response.StatusCode,
            $"A lost account insert answered {(int)response.StatusCode}.");
        Assert.DoesNotContain(email, body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("already taken", body, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Requirement 13: concurrent resends converge through idempotency and concurrency control.
    /// </summary>
    /// <remarks>
    /// Two cases, because they are two different mistakes. The same key twice is one command retried
    /// and must replay the winner's result rather than burning a second generation. Two different
    /// keys against the same version is two commands racing, and exactly one may win — the loser must
    /// conflict rather than silently killing the link the winner just created.
    /// </remarks>
    [TestMethod]
    public async Task ConcurrentResendCommandsConvergeThroughIdempotencyAndConcurrencyControl()
    {
        var workspace = await CreateWorkspaceAsync("resend-race");
        var email = $"client-resendrace-{workspace.Suffix}@tbgym.test";
        var invitation = await CreateInvitationAsync(workspace.Coach, email);
        await SweepInvitationMailAsync();

        // One command, retried: both answers succeed and only one new generation exists.
        var sharedKey = Guid.NewGuid();
        await RefreshCsrfAsync(workspace.Coach);
        var retried = await Task.WhenAll(
            ResendInvitationAsync(workspace.Coach, invitation.Id, sharedKey, invitation.Version),
            ResendInvitationAsync(workspace.Coach, invitation.Id, sharedKey, invitation.Version));
        foreach (var response in retried)
        {
            await AssertStatusAsync(response, HttpStatusCode.OK);
        }

        Assert.AreEqual(2, await GenerationAsync(invitation.Id), "An idempotent retry created a second generation.");
        Assert.HasCount(
            2,
            await InvitationRequestsAsync(invitation.Id),
            "An idempotent retry created a second durable request.");

        // Two commands, racing: exactly one wins on the version. The version comes from the row itself
        // rather than from a list read, so the test is about the race and not about how fresh a
        // caller's view happened to be.
        var current = await CurrentVersionAsync(invitation.Id);
        await RefreshCsrfAsync(workspace.Coach);
        var raced = await Task.WhenAll(
            ResendInvitationAsync(workspace.Coach, invitation.Id, Guid.NewGuid(), current),
            ResendInvitationAsync(workspace.Coach, invitation.Id, Guid.NewGuid(), current));

        // The statuses are in the message because the interesting failure of a race is which
        // answers came back, and a bare count tells you nothing about that.
        var statuses = string.Join(", ", raced.Select(response => (int)response.StatusCode));
        Assert.AreEqual(
            1,
            raced.Count(response => response.StatusCode == HttpStatusCode.OK),
            $"Exactly one of two racing resends may win. Statuses: {statuses}.");
        Assert.AreEqual(
            1,
            raced.Count(response => response.StatusCode == HttpStatusCode.Conflict),
            $"The losing resend must conflict rather than silently proceed. Statuses: {statuses}.");
        Assert.AreEqual(3, await GenerationAsync(invitation.Id));
    }

    /// <summary>
    /// Requirement 15: the token hash is durable before the provider is ever invoked.
    /// </summary>
    /// <remarks>
    /// Asserted twice over, because it is the property that keeps a link a provider accepted from
    /// becoming one this system refuses. First behaviourally: after one materialization the hash of
    /// the link the recipient received is already in the record. Then structurally: the database
    /// refuses to mark a request materialized when no token was minted for the attempt that finalized
    /// it, so the ordering cannot be reversed by a later edit to one method.
    /// </remarks>
    [TestMethod]
    public async Task TheTokenHashIsRecordedBeforeTheMessageIsSubmitted()
    {
        var workspace = await CreateWorkspaceAsync("hash-first");
        var invitation = await CreateInvitationAsync(
            workspace.Coach,
            $"client-hashfirst-{workspace.Suffix}@tbgym.test");
        await SweepInvitationMailAsync();

        var link = RequiredInvitationLink();
        var expected = Convert.ToHexStringLower(
            SHA256.HashData(Encoding.UTF8.GetBytes(TokenOf(link))));
        var issues = await TokenIssuesAsync(invitation.Id);
        Assert.HasCount(1, issues);
        Assert.AreEqual(expected, issues[0].TokenHash, "The recipient's link is not the recorded hash.");
        Assert.AreEqual(1, issues[0].LogicalSendGeneration);
        Assert.AreEqual(1, issues[0].AttemptNumber);

        // Structurally: a materialization with no minted token is refused by the database.
        var second = await CreateInvitationAsync(
            workspace.Coach,
            $"client-nomint-{workspace.Suffix}@tbgym.test");
        var request = (await InvitationRequestsAsync(second.Id)).Single();
        await AssertRefusedAsync(
            """
            UPDATE invitations."ActionMailRequests"
            SET "Status" = 'Materialized',
                "MaterializedAtUtc" = CURRENT_TIMESTAMP,
                "CompletedAtUtc" = CURRENT_TIMESTAMP,
                "TransportAdapter" = 'captured',
                "ClaimToken" = NULL,
                "ClaimExpiresAtUtc" = NULL
            WHERE "Id" = @id
            """,
            "a materialization with no recorded token hash",
            ("id", request.Id));
    }

    /// <summary>
    /// Requirements 18 and 19: links come from configuration, never from a request header.
    /// </summary>
    /// <remarks>
    /// The hostile headers are the real ones an attacker would use — <c>Host</c> is the classic
    /// vector, and <c>X-Forwarded-Host</c> is the one that survives a reverse proxy. Both are sent on
    /// the request that <i>causes</i> the mail, which is the only moment at which they could possibly
    /// influence a link, and neither reaches it.
    /// </remarks>
    [TestMethod]
    public async Task ActionLinksAlwaysUseTheConfiguredOriginEvenUnderHostileHeaders()
    {
        var workspace = await CreateWorkspaceAsync("origin");
        using var attacker = CreateClient();
        attacker.DefaultRequestHeaders.Add("X-Forwarded-Host", "attacker.test");
        attacker.DefaultRequestHeaders.Add("Origin", "https://attacker.test");
        attacker.DefaultRequestHeaders.Host = "attacker.test";

        var resetLink = await ResetLinkForAsync(attacker, workspace.CoachEmail);
        Assert.IsNotNull(resetLink);
        AssertConfiguredOrigin(resetLink!);

        var invitation = await CreateInvitationAsync(
            workspace.Coach,
            $"client-origin-{workspace.Suffix}@tbgym.test");
        await SweepInvitationMailAsync();
        AssertConfiguredOrigin(RequiredInvitationLink());
        Assert.AreEqual(invitation.Id, invitation.Id);

        // Registration's own confirmation link, produced by a request carrying the same headers.
        using var registrant = CreateClient();
        registrant.DefaultRequestHeaders.Add("X-Forwarded-Host", "attacker.test");
        registrant.DefaultRequestHeaders.Host = "attacker.test";
        await RefreshCsrfAsync(registrant);
        var response = await registrant.PostAsJsonAsync(
            "/api/auth/register/coach",
            new
            {
                displayName = "Hostile Coach",
                email = $"hostile-{workspace.Suffix}@tbgym.test",
                password = Password,
                workspaceName = $"Hostile {workspace.Suffix}",
                timeZoneId = "Asia/Beirut",
                defaultCulture = "en-LB",
                defaultCurrencyCode = "USD",
                weekStartsOn = "Monday",
            },
            TestContext.CancellationToken);
        await AssertStatusAsync(response, HttpStatusCode.Accepted);
        var registration = await RequiredJsonAsync<Registration>(response);
        Assert.IsNotNull(registration.DevelopmentConfirmationUrl);
        AssertConfiguredOrigin(registration.DevelopmentConfirmationUrl!);

        static void AssertConfiguredOrigin(string url)
        {
            var uri = new Uri(url);
            Assert.AreEqual(
                new Uri(PublicOrigin).GetLeftPart(UriPartial.Authority),
                uri.GetLeftPart(UriPartial.Authority),
                $"An action link was built from something other than the configured origin: {url}");
            Assert.DoesNotContain("attacker.test", url, StringComparison.OrdinalIgnoreCase);
        }
    }

    /// <summary>
    /// Requirement 23: direct SQL cannot violate the generation, token, tenant or attempt invariants.
    /// </summary>
    /// <remarks>
    /// Everything here is attempted with a database connection and no application code in the way,
    /// because that is the only threat model in which these guarantees mean anything. A rule enforced
    /// solely by a C# method is a rule a migration, a support script or a future background job walks
    /// straight past.
    /// </remarks>
    [TestMethod]
    public async Task DirectSqlCannotViolateGenerationTokenTenantOrAttemptInvariants()
    {
        var workspace = await CreateWorkspaceAsync("sql");
        var other = await CreateWorkspaceAsync("sql-other");
        var invitation = await CreateInvitationAsync(
            workspace.Coach,
            $"client-sql-{workspace.Suffix}@tbgym.test");
        await SweepInvitationMailAsync();
        var request = (await InvitationRequestsAsync(invitation.Id)).Single();
        var issue = (await TokenIssuesAsync(invitation.Id)).Single();

        await AssertRefusedAsync(
            """
            UPDATE invitations."ClientInvitations" SET "LogicalSendGeneration" = "LogicalSendGeneration" + 2
            WHERE "Id" = @id
            """,
            "a skipped logical-send generation",
            ("id", invitation.Id));

        await AssertRefusedAsync(
            """
            UPDATE invitations."ClientInvitations" SET "LogicalSendGeneration" = "LogicalSendGeneration" - 1
            WHERE "Id" = @id
            """,
            "a logical-send generation moving backwards",
            ("id", invitation.Id));

        await AssertRefusedAsync(
            """UPDATE invitations."ClientInvitations" SET "Email" = @email WHERE "Id" = @id""",
            "an invitation target address being changed",
            ("email", "someone-else@tbgym.test"),
            ("id", invitation.Id));

        await AssertRefusedAsync(
            """DELETE FROM invitations."TokenIssues" WHERE "Id" = @id""",
            "the deletion of issued token evidence",
            ("id", await TokenIssueIdAsync(invitation.Id)));

        await AssertRefusedAsync(
            """UPDATE invitations."TokenIssues" SET "TokenHash" = @hash WHERE "InvitationId" = @id""",
            "the mutation of an issued token hash",
            ("hash", new string('a', 64)),
            ("id", invitation.Id));

        await AssertRefusedAsync(
            """UPDATE invitations."TokenIssues" SET "LogicalSendGeneration" = 9 WHERE "InvitationId" = @id""",
            "a token hash being moved to another generation",
            ("id", invitation.Id));

        await AssertRefusedAsync(
            """UPDATE invitations."TokenIssues" SET "TenantId" = @tenant WHERE "InvitationId" = @id""",
            "a token hash being moved to another workspace",
            ("tenant", other.TenantId),
            ("id", invitation.Id));

        await AssertRefusedAsync(
            """UPDATE invitations."ActionMailRequests" SET "TenantId" = @tenant WHERE "Id" = @id""",
            "a cross-tenant invitation logical send",
            ("tenant", other.TenantId),
            ("id", request.Id));

        // A token row without a real started materialization attempt.
        await AssertRefusedAsync(
            """
            INSERT INTO invitations."TokenIssues" (
                "Id", "TenantId", "InvitationId", "LogicalSendGeneration", "ActionMailRequestId",
                "ActionMailAttemptId", "AttemptNumber", "TokenHash", "IssuedAtUtc", "ExpiresAtUtc",
                "CreatedAtUtc", "UpdatedAtUtc")
            VALUES (gen_random_uuid(), @tenant, @invitation, 1, @request, gen_random_uuid(), 1,
                    @hash, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + interval '1 day',
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            "a token row with no started materialization attempt",
            ("tenant", workspace.TenantId),
            ("invitation", invitation.Id),
            ("request", request.Id),
            ("hash", new string('b', 64)));

        // Provider evidence for an adapter that contacted nobody.
        await AssertRefusedAsync(
            """
            UPDATE invitations."ActionMailRequests"
            SET "ProviderMessageId" = 'forged', "ProviderAcceptedAtUtc" = CURRENT_TIMESTAMP
            WHERE "Id" = @id
            """,
            "fabricated provider acceptance on a captured materialization",
            ("id", request.Id));

        // Redemption of a token whose generation is no longer current.
        await RefreshCsrfAsync(workspace.Coach);
        await AssertStatusAsync(
            await ResendInvitationAsync(
                workspace.Coach,
                invitation.Id,
                Guid.NewGuid(),
                await CurrentVersionAsync(invitation.Id)),
            HttpStatusCode.OK);
        await AssertRefusedAsync(
            """
            UPDATE invitations."TokenIssues"
            SET "RedeemedAtUtc" = CURRENT_TIMESTAMP, "RedeemedByUserId" = @user
            WHERE "TokenHash" = @hash
            """,
            "the redemption of a superseded token",
            ("user", await ScalarAsync<Guid>(
                """SELECT "Id" FROM identity."Users" WHERE "Email" = @email""",
                ("email", workspace.CoachEmail))),
            ("hash", issue.TokenHash));

        // Deleting or rewriting completed attempt history.
        await AssertRefusedAsync(
            """DELETE FROM invitations."ActionMailAttempts" WHERE "RequestId" = @id""",
            "the deletion of action mail attempt history",
            ("id", request.Id));

        await AssertRefusedAsync(
            """
            UPDATE invitations."ActionMailAttempts"
            SET "Outcome" = 'TransientFailure', "FailureCode" = 'rewritten'
            WHERE "RequestId" = @id
            """,
            "the rewriting of a completed attempt",
            ("id", request.Id));

        // Two attempts presenting one provider idempotency key.
        await AssertRefusedAsync(
            """
            UPDATE invitations."ActionMailAttempts" a
            SET "ProviderIdempotencyKey" = (
                SELECT b."ProviderIdempotencyKey" FROM invitations."ActionMailAttempts" b
                WHERE b."Id" <> a."Id" LIMIT 1)
            WHERE a."RequestId" = @id
            """,
            "one provider idempotency key reused by two attempts",
            ("id", request.Id));

        // And the global queue refuses a fabricated subject shape.
        await AssertRefusedAsync(
            """
            UPDATE identity."ActionMailRequests"
            SET "SubjectSecurityStampHash" = NULL
            WHERE "SubjectUserId" IS NOT NULL
            """,
            "a subject with no recorded credential state");

        await RequestPasswordResetAsync(workspace.Coach, workspace.CoachEmail);
        var reset = (await AccountRequestsAsync())
            .Last(item => item.ActionKind == nameof(AccountActionKind.ResetPassword));
        var claim = Guid.NewGuid();
        await AssertRefusedAsync(
            """
            UPDATE identity."ActionMailRequests"
            SET "Status" = 'Processing', "ClaimToken" = @claim,
                "ClaimExpiresAtUtc" = CURRENT_TIMESTAMP + interval '2 minutes'
            WHERE "Id" = @request;
            UPDATE identity."ActionMailRequests"
            SET "AttemptCount" = 1
            WHERE "Id" = @request;
            INSERT INTO identity."ActionMailAttempts" (
                "Id", "RequestId", "ActionKind", "AttemptNumber", "ClaimToken",
                "ProviderIdempotencyKey", "StartedAtUtc", "Outcome", "CreatedAtUtc", "UpdatedAtUtc")
            VALUES (
                uuidv7(), @request, 'ResetPassword', 1, @claim,
                'account-action:' || replace(CAST(@request AS text), '-', '') || ':a1:v1:' || repeat('a', 32),
                CURRENT_TIMESTAMP, 'Started', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
            UPDATE identity."ActionMailAttempts"
            SET "Outcome" = 'Succeeded', "CompletedAtUtc" = CURRENT_TIMESTAMP
            WHERE "RequestId" = @request;
            """,
            "a successful account materialization with no recorded token mint",
            ("claim", claim),
            ("request", reset.Id));
    }

    // Three groups of cases live in Phase6B3CActionMailProviderTests instead of here, for one
    // structural reason: under the captured adapter a confirmation and an invitation are materialized
    // inline, in the same call that queues them, so there is no window in which a request is pending
    // and the world can move underneath it. Those cases need a transport that does not inline —
    // which is what a real provider adapter is — and they are:
    //
    //   * a confirmation suppressed once the account's credential state moves (requirement 6);
    //   * an invitation that cannot materialize once it is revoked, expired or superseded (14);
    //   * an expired lease reclaimed, and its stale claimant refused (16).

    // ---------- helpers used only by these tests ----------

    private async Task<Guid> EnqueueConfirmationAsync(Guid userId)
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var result = await scope.ServiceProvider
            .GetRequiredService<IAccountActionMailScheduler>()
            .RequestAsync(
                new AccountActionMailCommand(
                    userId,
                    AccountActionKind.ConfirmEmail,
                    AccountActionMailSources.CoachRegistration,
                    userId),
                TestContext.CancellationToken);
        return result.RequestId;
    }

    private async Task<HttpResponseMessage> ResetPasswordAsync(
        HttpClient client,
        string resetLink,
        string newPassword)
    {
        await RefreshCsrfAsync(client);
        return await client.PostAsJsonAsync(
            "/api/auth/reset-password",
            new
            {
                userId = Guid.Parse(QueryValue(resetLink, "userId")),
                code = QueryValue(resetLink, "code"),
                newPassword,
            },
            TestContext.CancellationToken);
    }

    private Task<long> CurrentVersionAsync(Guid invitationId) => ScalarAsync<long>(
        """SELECT xmin::text::bigint FROM invitations."ClientInvitations" WHERE "Id" = @id""",
        ("id", invitationId));

    private Task<Guid> TokenIssueIdAsync(Guid invitationId) => ScalarAsync<Guid>(
        """SELECT "Id" FROM invitations."TokenIssues" WHERE "InvitationId" = @id LIMIT 1""",
        ("id", invitationId));
}
