using System.Net;
using System.Net.Http.Json;
using Npgsql;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The audit's batch A16a (INV-3, CLI-010): the platform admin publishes reviewed legal documents, anyone can
/// read a published version, and registration and an invitation's acceptance ask for every document in force
/// for the person, recorded with the account or the membership they join with. Every text here is a test
/// placeholder, not legal wording.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string A16aAdminUrl = "/api/platform-admin/legal-documents";

    private const string A16aText = "Section 1\n\nPlaceholder text written for a test.";

    // The SHA-256 of A16aText in UTF-8, worked out apart from the code under test.
    private const string A16aTextHash = "04b63ff45596250d105ac72aeff8ab5758b24d11645d99ab07dad8d88b9dab78";

    [TestMethod]
    public async Task A16aOnlyThePlatformAdminPublishesAndAVersionKeepsItsWords()
    {
        using var anonymous = CreateClient();
        await AssertStatusAsync(await anonymous.GetAsync(A16aAdminUrl), HttpStatusCode.Unauthorized);
        await RefreshCsrfAsync(anonymous);
        await AssertStatusAsync(
            await anonymous.PostAsJsonAsync(A16aAdminUrl, A16aRequest("TermsOfService", "Platform", "1")),
            HttpStatusCode.Unauthorized);

        // No workspace role publishes or lists, the owner included.
        using var owner = CreateClient();
        await RegisterCoachAsync(owner, "a16a-owner@example.test", "A16a Owner", "A16a Gym");
        using var client = CreateClient();
        await InviteAndAcceptAsync(owner, client, "a16a-client@example.test", true);
        foreach (var caller in new[] { owner, client })
        {
            await AssertStatusAsync(await caller.GetAsync(A16aAdminUrl), HttpStatusCode.Forbidden);
            await RefreshCsrfAsync(caller);
            await AssertStatusAsync(
                await caller.PostAsJsonAsync(A16aAdminUrl, A16aRequest("TermsOfService", "Platform", "1")),
                HttpStatusCode.Forbidden);
        }

        using var admin = await SignInPlatformAdminAsync("a16a-admin@example.test");
        Assert.IsEmpty(await A16aVersionsAsync(admin));

        // Without the antiforgery token nothing is published.
        admin.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
        var noToken = await admin.PostAsJsonAsync(A16aAdminUrl, A16aRequest("TermsOfService", "Platform", "1"));
        Assert.AreEqual("antiforgery_token_invalid", (await A16aAnswerAsync(noToken, HttpStatusCode.BadRequest)).Code);

        // Each refusal names its field, and nothing is stored.
        await RefreshCsrfAsync(admin);
        foreach (var (request, field) in new (object, string)[]
        {
            (A16aRequest("TermsOfService", "Platform", "1", reviewed: false), "reviewed"),
            (A16aRequest("TermsOfService", "Platform", "1", content: " \n "), "content"),
            (A16aRequest("TermsOfService", "Platform", "1", statement: ""), "acceptanceStatement"),
            (A16aRequest("TermsOfService", "Platform", "", content: A16aText), "version"),
            (A16aRequest("TermsOfService", "Platform", "1", culture: "fr"), "culture"),
        })
        {
            var refused = await admin.PostAsJsonAsync(A16aAdminUrl, request);
            await AssertStatusAsync(refused, HttpStatusCode.BadRequest);
            Assert.IsTrue((await RequiredJsonAsync<A16aProblem>(refused)).Errors.ContainsKey(field), field);
        }

        Assert.IsEmpty(await A16aVersionsAsync(admin));

        // Published: hashed by its own words, read on its own page, in force.
        var first = await A16aPublishAsync(admin, "TermsOfService", "Platform", "2026-10", null, content: "\r\n" + A16aText.Replace("\n", "\r\n", StringComparison.Ordinal) + "  ");
        Assert.AreEqual(A16aTextHash, first.ContentSha256);
        Assert.AreEqual($"/legal/{first.Id:D}", first.ContentUri);
        Assert.AreEqual(A16aText.Length, first.CharacterCount);
        Assert.AreEqual("Placeholder sentence to tick.", first.AcceptanceStatement);
        Assert.IsNotNull(first.PublishedAtUtc);
        Assert.IsNull(first.RetiredAtUtc);

        // Text beyond ASCII is hashed by PostgreSQL's own check alike, or it could not be stored; its
        // characters are counted as the list counts them.
        const string accented = "Café — “quotes” and naïve façades, نص, 名前, 𝄞.";
        var privacy = await A16aPublishAsync(admin, "PrivacyPolicy", "Workspace", "2026-10", null, content: accented);
        Assert.AreEqual(accented.EnumerateRunes().Count(), privacy.CharacterCount);

        // A retry of the same publish answers with it, even naming what it then replaced.
        var retried = await A16aPublishAsync(admin, "TermsOfService", "Platform", "2026-10", null, content: A16aText);
        Assert.AreEqual(first.Id, retried.Id);
        // The same name with other words, or for other people, is refused; so is a new version that does not
        // name the one in force.
        var taken = await admin.PostAsJsonAsync(A16aAdminUrl, A16aRequest("TermsOfService", "Platform", "2026-10", replaces: first.Id, content: "Other placeholder words."));
        Assert.AreEqual("legal_version_taken", (await A16aAnswerAsync(taken, HttpStatusCode.Conflict)).Code);
        var takenHere = await admin.PostAsJsonAsync(A16aAdminUrl, A16aRequest("TermsOfService", "Workspace", "2026-10", replaces: first.Id, content: A16aText));
        Assert.AreEqual("legal_version_taken", (await A16aAnswerAsync(takenHere, HttpStatusCode.Conflict)).Code);
        var unseen = await admin.PostAsJsonAsync(A16aAdminUrl, A16aRequest("TermsOfService", "Platform", "2026-11"));
        Assert.AreEqual("legal_document_changed", (await A16aAnswerAsync(unseen, HttpStatusCode.Conflict)).Code);
        var wrongOne = await admin.PostAsJsonAsync(A16aAdminUrl, A16aRequest("TermsOfService", "Platform", "2026-11", replaces: privacy.Id));
        Assert.AreEqual("legal_document_changed", (await A16aAnswerAsync(wrongOne, HttpStatusCode.Conflict)).Code);
        // Arabic waits for versions that carry every language at once.
        var arabic = await admin.PostAsJsonAsync(A16aAdminUrl, A16aRequest("TermsOfService", "Platform", "ar-1", culture: "ar"));
        await AssertStatusAsync(arabic, HttpStatusCode.BadRequest);
        Assert.AreEqual(
            "Only English can be published for now.",
            (await RequiredJsonAsync<A16aProblem>(arabic)).Errors["culture"].Single());

        // The next version replaces the one in force, and only that one.
        RequiredTestClock.Advance(TimeSpan.FromMinutes(5));
        var second = await A16aPublishAsync(admin, "TermsOfService", "Platform", "2026-11", first.Id, content: "Section 1\n\nA second placeholder text.");
        var versions = await A16aVersionsAsync(admin);
        Assert.HasCount(3, versions);
        Assert.AreEqual(
            versions.Single(item => item.Id == second.Id).PublishedAtUtc,
            versions.Single(item => item.Id == first.Id).RetiredAtUtc);
        Assert.IsNull(versions.Single(item => item.Id == second.Id).RetiredAtUtc);
        Assert.IsNull(versions.Single(item => item.Id == privacy.Id).RetiredAtUtc);
        Assert.IsTrue(versions.All(item => item.AcceptanceCount == 0));
        Assert.AreEqual(accented.EnumerateRunes().Count(), versions.Single(item => item.Id == privacy.Id).CharacterCount);
        // A publish replayed after its version was replaced is not told it is published now.
        var stale = await admin.PostAsJsonAsync(A16aAdminUrl, A16aRequest("TermsOfService", "Platform", "2026-10", content: A16aText));
        Assert.AreEqual("legal_document_changed", (await A16aAnswerAsync(stale, HttpStatusCode.Conflict)).Code);

        // Anyone reads a published version, the one replaced too; nothing else answers.
        var read = await RequiredJsonAsync<A16aDocumentText>(await anonymous.GetAsync($"/api/legal/documents/{first.Id}"));
        Assert.AreEqual(A16aText, read.Content);
        Assert.AreEqual(A16aTextHash, read.ContentSha256);
        Assert.AreEqual("TermsOfService", read.Kind);
        Assert.IsNotNull(read.RetiredAtUtc);
        await AssertStatusAsync(await anonymous.GetAsync($"/api/legal/documents/{Guid.NewGuid()}"), HttpStatusCode.NotFound);

        // The database keeps the words and the dates as they were written.
        await AssertSqlStateAsync("55000", """UPDATE identity."LegalDocumentVersions" SET "Content" = 'Changed' WHERE "Id" = @id""", ("id", second.Id));
        await AssertSqlStateAsync("55000", """UPDATE identity."LegalDocumentVersions" SET "AcceptanceStatement" = 'Changed' WHERE "Id" = @id""", ("id", second.Id));
        await AssertSqlStateAsync("55000", """UPDATE identity."LegalDocumentVersions" SET "VersionLabel" = 'Changed' WHERE "Id" = @id""", ("id", second.Id));
        await AssertSqlStateAsync("55000", """UPDATE identity."LegalDocumentVersions" SET "RetiredAtUtc" = NULL WHERE "Id" = @id""", ("id", first.Id));
        await AssertSqlStateAsync("55000", """UPDATE identity."LegalDocumentVersions" SET "PublishedAtUtc" = now() WHERE "Id" = @id""", ("id", second.Id));
        await AssertSqlStateAsync("55000", """DELETE FROM identity."LegalDocumentVersions" WHERE "Id" = @id""", ("id", first.Id));
        // A hash that is not the text's, or a second version in force, cannot be stored either way.
        await AssertSqlStateAsync("23514", A16aInsertSql("2026-12", "'" + new string('0', 64) + "'", "NULL"));
        await AssertSqlStateAsync("23505", A16aInsertSql("2026-12", "encode(sha256(convert_to('Other', 'UTF8')), 'hex')", "NULL"));
        await AssertSqlStateAsync("23514", A16aInsertSql("2026-12", "encode(sha256(convert_to('Other', 'UTF8')), 'hex')", "now() - interval '1 day'"));

        // A document moves to the other people by a new version that replaces it, so one is in force.
        RequiredTestClock.Advance(TimeSpan.FromMinutes(5));
        var moved = await A16aPublishAsync(admin, "TermsOfService", "Workspace", "2026-12", second.Id, content: A16aText);
        Assert.AreEqual("Workspace", moved.Context);
        var inForce = (await A16aVersionsAsync(admin)).Where(item => item.Kind == "TermsOfService" && item.RetiredAtUtc is null).ToArray();
        Assert.AreEqual(moved.Id, inForce.Single().Id);
    }

    [TestMethod]
    public async Task A16aTwoPublishesAtOnceLeaveOneVersionInForce()
    {
        using var admin = await SignInPlatformAdminAsync("a16a-race-admin@example.test");
        var first = await A16aPublishAsync(admin, "TermsOfService", "Platform", "1", null);
        await RefreshCsrfAsync(admin);

        // Two admins replace the version in force with different texts: one wins, the other is told.
        var answers = await Task.WhenAll(
            admin.PostAsJsonAsync(A16aAdminUrl, A16aRequest("TermsOfService", "Platform", "2a", replaces: first.Id, content: "Placeholder A.")),
            admin.PostAsJsonAsync(A16aAdminUrl, A16aRequest("TermsOfService", "Platform", "2b", replaces: first.Id, content: "Placeholder B.")));
        CollectionAssert.AreEquivalent(
            new[] { HttpStatusCode.OK, HttpStatusCode.Conflict },
            answers.Select(answer => answer.StatusCode).ToArray());
        Assert.AreEqual(
            "legal_document_changed",
            (await A16aAnswerAsync(answers.Single(answer => answer.StatusCode == HttpStatusCode.Conflict), HttpStatusCode.Conflict)).Code);
        var winner = await RequiredJsonAsync<A16aVersion>(answers.Single(answer => answer.StatusCode == HttpStatusCode.OK));

        // A retry sent twice at once publishes once and answers both with it.
        var retries = await Task.WhenAll(
            admin.PostAsJsonAsync(A16aAdminUrl, A16aRequest("TermsOfService", "Platform", "3", replaces: winner.Id, content: "Placeholder C.")),
            admin.PostAsJsonAsync(A16aAdminUrl, A16aRequest("TermsOfService", "Platform", "3", replaces: winner.Id, content: "Placeholder C.")));
        foreach (var retry in retries)
        {
            await AssertStatusAsync(retry, HttpStatusCode.OK);
        }

        var third = await RequiredJsonAsync<A16aVersion>(retries[0]);
        Assert.AreEqual(third.Id, (await RequiredJsonAsync<A16aVersion>(retries[1])).Id);

        // A first version, raced: one is in force.
        var firsts = await Task.WhenAll(
            admin.PostAsJsonAsync(A16aAdminUrl, A16aRequest("PrivacyPolicy", "Workspace", "a", content: "Placeholder D.")),
            admin.PostAsJsonAsync(A16aAdminUrl, A16aRequest("PrivacyPolicy", "Workspace", "b", content: "Placeholder E.")));
        CollectionAssert.AreEquivalent(
            new[] { HttpStatusCode.OK, HttpStatusCode.Conflict },
            firsts.Select(answer => answer.StatusCode).ToArray());

        var versions = await A16aVersionsAsync(admin);
        Assert.AreEqual(third.Id, versions.Single(item => item.Kind == "TermsOfService" && item.RetiredAtUtc is null).Id);
        Assert.AreEqual(1, versions.Count(item => item.Kind == "PrivacyPolicy" && item.RetiredAtUtc is null));
        Assert.HasCount(4, versions);
    }

    [TestMethod]
    public async Task A16aANewOwnerAcceptsEveryDocumentInForceWithTheirAccount()
    {
        using var visitor = CreateClient();
        Assert.IsEmpty(await A16aToAcceptAsync(visitor, "Owner"));
        using var admin = await SignInPlatformAdminAsync("a16a-reg-admin@example.test");
        var terms = await A16aPublishAsync(admin, "TermsOfService", "Platform", "1", null);
        var privacy = await A16aPublishAsync(admin, "PrivacyPolicy", "Workspace", "1", null);
        var health = await A16aPublishAsync(admin, "HealthIntakeConsent", "Workspace", "1", null);

        // A new owner is asked for the Terms and the Privacy Policy; the health intake consent is a client's.
        var forOwner = await A16aToAcceptAsync(visitor, "Owner");
        CollectionAssert.AreEqual(new[] { terms.Id, privacy.Id }, forOwner.Select(item => item.Id).ToArray());
        Assert.AreEqual("Placeholder sentence to tick.", forOwner[0].AcceptanceStatement);
        Assert.AreEqual($"/legal/{terms.Id:D}", forOwner[0].ContentUri);
        Assert.AreEqual("Workspace", forOwner[1].Context);
        CollectionAssert.AreEqual(
            new[] { terms.Id, privacy.Id, health.Id },
            (await A16aToAcceptAsync(visitor, "Client")).Select(item => item.Id).ToArray());
        await AssertStatusAsync(await visitor.GetAsync("/api/legal/documents/to-accept?audience=Nobody"), HttpStatusCode.BadRequest);
        await AssertStatusAsync(await visitor.GetAsync("/api/legal/documents/to-accept?audience=7"), HttpStatusCode.BadRequest);

        // Leaving one out, adding one that is not theirs, or naming a stranger is refused, and no account is made.
        foreach (var ids in new[] { null, new[] { terms.Id }, new[] { terms.Id, privacy.Id, health.Id }, new[] { terms.Id, privacy.Id, Guid.NewGuid() } })
        {
            var refused = await A16aRegisterAsync(visitor, "a16a-new-owner@example.test", ids);
            Assert.AreEqual("legal_acceptance_required", (await A16aAnswerAsync(refused, HttpStatusCode.Conflict)).Code);
        }

        Assert.AreEqual(0L, await A16aScalarAsync("""SELECT count(*) FROM identity."Users" WHERE "NormalizedEmail" = 'A16A-NEW-OWNER@EXAMPLE.TEST'"""));

        // Both acceptances are kept with the account: the Terms for the platform, the Privacy Policy for the
        // new coaching space.
        using var newOwner = CreateClient();
        var workspaceId = await RegisterCoachAsync(newOwner, "a16a-new-owner@example.test", "New Owner", "A16a New Gym", [terms.Id, privacy.Id]);
        var kept = await A16aAcceptancesAsync("a16a-new-owner@example.test");
        CollectionAssert.AreEquivalent(
            new[] { (terms.Id, "platform", (Guid?)null), (privacy.Id, workspaceId.ToString("N"), (Guid?)workspaceId) },
            kept);
        Assert.AreEqual(1, (await A16aVersionsAsync(admin)).Single(item => item.Id == privacy.Id).AcceptanceCount);

        // A new owner always registers a new account, so a session in the browser hides nothing from that page;
        // as a client, the Terms this person accepted are not asked again.
        CollectionAssert.AreEqual(
            new[] { terms.Id, privacy.Id },
            (await A16aToAcceptAsync(newOwner, "Owner")).Select(item => item.Id).ToArray());
        CollectionAssert.AreEqual(
            new[] { privacy.Id, health.Id },
            (await A16aToAcceptAsync(newOwner, "Client")).Select(item => item.Id).ToArray());
    }

    [TestMethod]
    public async Task A16aAnInvitationAsksOnlyWhatThePersonHasNotAcceptedThere()
    {
        // Both registered before anything was published, so nothing was asked of them.
        using var ownerA = CreateClient();
        var workspaceA = await RegisterCoachAsync(ownerA, "a16a-inv-owner-a@example.test", "Owner A", "A16a Gym A");
        using var admin = await SignInPlatformAdminAsync("a16a-inv-admin@example.test");
        var terms = await A16aPublishAsync(admin, "TermsOfService", "Platform", "1", null);
        var health = await A16aPublishAsync(admin, "HealthIntakeConsent", "Workspace", "1", null);

        // A client's new account: refused until the Terms and this space's health consent are both named; a
        // refusal leaves no account and the invitation waiting.
        using var client = CreateClient();
        var token = await A16aInviteClientAsync(ownerA, "a16a-inv-client@example.test");
        CollectionAssert.AreEqual(new[] { terms.Id, health.Id }, (await A16aToAcceptAsync(client, "Client")).Select(item => item.Id).ToArray());
        foreach (var ids in new[] { null, new[] { terms.Id } })
        {
            var refused = await A16aAcceptAsync(client, token, newAccount: true, ids);
            Assert.AreEqual("legal_acceptance_required", (await A16aAnswerAsync(refused, HttpStatusCode.Conflict)).Code);
        }

        Assert.AreEqual(0L, await A16aScalarAsync("""SELECT count(*) FROM identity."Users" WHERE "NormalizedEmail" = 'A16A-INV-CLIENT@EXAMPLE.TEST'"""));
        Assert.AreEqual(
            "Pending",
            (await RequiredJsonAsync<A16aPublicInvitation>(await client.GetAsync($"/api/invitations/public/{token}"))).Status);
        await AssertStatusAsync(await A16aAcceptAsync(client, token, newAccount: true, [terms.Id, health.Id]), HttpStatusCode.OK);
        SetTenant(client, workspaceA);
        CollectionAssert.AreEquivalent(
            new[] { (terms.Id, "platform", (Guid?)null), (health.Id, workspaceA.ToString("N"), (Guid?)workspaceA) },
            await A16aAcceptancesAsync("a16a-inv-client@example.test"));

        // A coach joining the team is asked for the Terms alone.
        using var coach = CreateClient();
        CollectionAssert.AreEqual(new[] { terms.Id }, (await A16aToAcceptAsync(coach, "Coach")).Select(item => item.Id).ToArray());
        await JoinAsCoachAsync(ownerA, coach, "a16a-inv-coach@example.test", "Inv Coach", [terms.Id]);
        CollectionAssert.AreEquivalent(
            new[] { (terms.Id, "platform", (Guid?)null) },
            await A16aAcceptancesAsync("a16a-inv-coach@example.test"));

        // Invited by a second space, the signed-in client is asked only for that space's health consent:
        // the Terms they accepted count, their consent to the first space does not.
        using var ownerB = CreateClient();
        var workspaceB = await RegisterCoachAsync(ownerB, "a16a-inv-owner-b@example.test", "Owner B", "A16a Gym B", [terms.Id]);
        var tokenB = await A16aInviteClientAsync(ownerB, "a16a-inv-client@example.test");
        CollectionAssert.AreEqual(new[] { health.Id }, (await A16aToAcceptAsync(client, "Client")).Select(item => item.Id).ToArray());
        var notHere = await A16aAcceptAsync(client, tokenB, newAccount: false, []);
        Assert.AreEqual("legal_acceptance_required", (await A16aAnswerAsync(notHere, HttpStatusCode.Conflict)).Code);
        await AssertStatusAsync(await A16aAcceptAsync(client, tokenB, newAccount: false, [health.Id]), HttpStatusCode.OK);
        CollectionAssert.AreEquivalent(
            new[]
            {
                (terms.Id, "platform", (Guid?)null),
                (health.Id, workspaceA.ToString("N"), (Guid?)workspaceA),
                (health.Id, workspaceB.ToString("N"), (Guid?)workspaceB),
            },
            await A16aAcceptancesAsync("a16a-inv-client@example.test"));

        // A version replaced after the page was read is refused; the one in force is accepted.
        RequiredTestClock.Advance(TimeSpan.FromMinutes(5));
        var newTerms = await A16aPublishAsync(admin, "TermsOfService", "Platform", "2", terms.Id, content: "A second placeholder text.");
        using var late = CreateClient();
        var lateToken = await A16aInviteClientAsync(ownerA, "a16a-inv-late@example.test");
        var stale = await A16aAcceptAsync(late, lateToken, newAccount: true, [terms.Id, health.Id]);
        Assert.AreEqual("legal_acceptance_required", (await A16aAnswerAsync(stale, HttpStatusCode.Conflict)).Code);
        await AssertStatusAsync(await A16aAcceptAsync(late, lateToken, newAccount: true, [newTerms.Id, health.Id]), HttpStatusCode.OK);
    }

    /// <summary>A version published by mistake stops being asked for; its words and acceptances stay.</summary>
    [TestMethod]
    public async Task A16aAWithdrawnVersionIsNoLongerAskedFor()
    {
        using var admin = await SignInPlatformAdminAsync("a16a-withdraw-admin@example.test");
        var health = await A16aPublishAsync(admin, "HealthIntakeConsent", "Platform", "1", null);
        var terms = await A16aPublishAsync(admin, "TermsOfService", "Platform", "1", null);
        using var visitor = CreateClient();
        Assert.HasCount(2, await A16aToAcceptAsync(visitor, "Client"));

        // Nobody but the platform admin withdraws, and not without the antiforgery token.
        using var owner = CreateClient();
        await RegisterCoachAsync(owner, "a16a-withdraw-owner@example.test", "Owner", "A16a Withdraw Gym", [terms.Id]);
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(await owner.PostAsync($"{A16aAdminUrl}/{health.Id}/withdraw", null), HttpStatusCode.Forbidden);
        await RefreshCsrfAsync(visitor);
        await AssertStatusAsync(await visitor.PostAsync($"{A16aAdminUrl}/{health.Id}/withdraw", null), HttpStatusCode.Unauthorized);
        admin.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
        Assert.AreEqual(
            "antiforgery_token_invalid",
            (await A16aAnswerAsync(await admin.PostAsync($"{A16aAdminUrl}/{health.Id}/withdraw", null), HttpStatusCode.BadRequest)).Code);

        await RefreshCsrfAsync(admin);
        var withdrawn = await RequiredJsonAsync<A16aVersion>(await admin.PostAsync($"{A16aAdminUrl}/{health.Id}/withdraw", null));
        Assert.IsNotNull(withdrawn.RetiredAtUtc);
        CollectionAssert.AreEqual(new[] { terms.Id }, (await A16aToAcceptAsync(visitor, "Client")).Select(item => item.Id).ToArray());
        var read = await RequiredJsonAsync<A16aDocumentText>(await visitor.GetAsync($"/api/legal/documents/{health.Id}"));
        Assert.IsNotNull(read.RetiredAtUtc, "A withdrawn version stays readable.");

        // A retry answers the same; a version replaced meanwhile, or none at all, is refused.
        await RefreshCsrfAsync(admin);
        await AssertStatusAsync(await admin.PostAsync($"{A16aAdminUrl}/{health.Id}/withdraw", null), HttpStatusCode.OK);
        RequiredTestClock.Advance(TimeSpan.FromMinutes(5));
        await A16aPublishAsync(admin, "TermsOfService", "Platform", "2", terms.Id, content: "A second placeholder text.");
        await RefreshCsrfAsync(admin);
        Assert.AreEqual(
            "legal_document_changed",
            (await A16aAnswerAsync(await admin.PostAsync($"{A16aAdminUrl}/{terms.Id}/withdraw", null), HttpStatusCode.Conflict)).Code);
        await AssertStatusAsync(await admin.PostAsync($"{A16aAdminUrl}/{Guid.NewGuid()}/withdraw", null), HttpStatusCode.NotFound);
        // The owner's acceptance of the version replaced is kept.
        Assert.AreEqual(1, (await A16aVersionsAsync(admin)).Single(item => item.Id == terms.Id).AcceptanceCount);
    }

    /// <summary>
    /// A join waits for a publish under way and checks what is in force once it commits, so nobody joins
    /// without the first version of a document published in between (the advisory lock both take).
    /// </summary>
    [TestMethod]
    public async Task A16aAJoinWaitsForAPublishUnderWayAndChecksWhatItPublished()
    {
        using var visitor = CreateClient();
        await using var publish = new NpgsqlConnection(RequiredDatabaseConnection);
        await publish.OpenAsync();
        await using var transaction = await publish.BeginTransactionAsync();
        await using (var lockCommand = new NpgsqlCommand("SELECT pg_advisory_xact_lock(6071499108080766001)", publish, transaction))
        {
            await lockCommand.ExecuteNonQueryAsync();
        }

        // Nothing is in force yet, so a registration naming nothing would pass; it has to wait instead.
        var registering = A16aRegisterAsync(visitor, "a16a-waits@example.test", null);
        await Task.Delay(TimeSpan.FromSeconds(2));
        Assert.IsFalse(registering.IsCompleted, "The registration waits for the publish under way.");
        await using (var insert = new NpgsqlCommand(
            A16aInsertSql("1", "encode(sha256(convert_to('Other', 'UTF8')), 'hex')", "NULL"), publish, transaction))
        {
            await insert.ExecuteNonQueryAsync();
        }

        await transaction.CommitAsync();
        var answer = await registering.WaitAsync(TimeSpan.FromSeconds(30));
        Assert.AreEqual("legal_acceptance_required", (await A16aAnswerAsync(answer, HttpStatusCode.Conflict)).Code);
        Assert.AreEqual(0L, await A16aScalarAsync("""SELECT count(*) FROM identity."Users" WHERE "NormalizedEmail" = 'A16A-WAITS@EXAMPLE.TEST'"""));
    }

    private static object A16aRequest(
        string kind,
        string context,
        string version,
        Guid? replaces = null,
        string culture = "en",
        string content = A16aText,
        string statement = "Placeholder sentence to tick.",
        bool reviewed = true) => new
        {
            kind,
            culture,
            context,
            version,
            content,
            acceptanceStatement = statement,
            reviewed,
            replacesVersionId = replaces,
        };

    private static async Task<A16aVersion> A16aPublishAsync(
        HttpClient admin,
        string kind,
        string context,
        string version,
        Guid? replaces,
        string culture = "en",
        string content = A16aText)
    {
        await RefreshCsrfAsync(admin);
        var response = await admin.PostAsJsonAsync(A16aAdminUrl, A16aRequest(kind, context, version, replaces, culture, content));
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<A16aVersion>(response);
    }

    private static async Task<A16aVersion[]> A16aVersionsAsync(HttpClient admin) =>
        await RequiredJsonAsync<A16aVersion[]>(await admin.GetAsync(A16aAdminUrl));

    private static async Task<A16aToAccept[]> A16aToAcceptAsync(HttpClient caller, string audience)
    {
        var response = await caller.GetAsync($"/api/legal/documents/to-accept?audience={audience}");
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<A16aToAccept[]>(response);
    }

    private static async Task<HttpResponseMessage> A16aRegisterAsync(HttpClient visitor, string email, Guid[]? legalDocumentIds)
    {
        await RefreshCsrfAsync(visitor);
        return await visitor.PostAsJsonAsync("/api/auth/register/coach", new
        {
            displayName = "New Owner",
            email,
            password = Password,
            workspaceName = "A16a New Gym",
            timeZoneId = "Asia/Beirut",
            defaultCulture = "en-LB",
            defaultCurrencyCode = "USD",
            weekStartsOn = "Monday",
            legalDocumentIds,
        });
    }

    private static async Task<string> A16aInviteClientAsync(HttpClient staff, string email)
    {
        await RefreshCsrfAsync(staff);
        var response = await staff.PostAsJsonAsync("/api/invitations", new
        {
            email,
            firstName = "Legal",
            lastName = "Client",
            phoneNumber = "+96170000000",
            birthDate = "1995-04-02",
        });
        await AssertStatusAsync(response, HttpStatusCode.Created);
        return QueryValue((await RequiredJsonAsync<Invitation>(response)).DevelopmentActionUrl!, "token");
    }

    private static async Task<HttpResponseMessage> A16aAcceptAsync(
        HttpClient person,
        string token,
        bool newAccount,
        Guid[]? legalDocumentIds)
    {
        await RefreshCsrfAsync(person);
        return await person.PostAsJsonAsync("/api/invitations/accept", new
        {
            token,
            displayName = newAccount ? "Legal Client" : null,
            password = newAccount ? Password : null,
            legalDocumentIds,
        });
    }

    private static async Task<A16aAnswer> A16aAnswerAsync(HttpResponseMessage response, HttpStatusCode status)
    {
        await AssertStatusAsync(response, status);
        return await RequiredJsonAsync<A16aAnswer>(response);
    }

    private async Task<(Guid DocumentVersionId, string ContextKey, Guid? TenantId)[]> A16aAcceptancesAsync(string email)
    {
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT acceptance."DocumentVersionId", acceptance."ContextKey", acceptance."TenantId"
            FROM identity."LegalConsentAcceptances" acceptance
            JOIN identity."Users" person ON person."Id" = acceptance."UserId"
            WHERE person."NormalizedEmail" = upper(@email)
            """;
        command.Parameters.AddWithValue("email", email);
        var rows = new List<(Guid, string, Guid?)>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add((reader.GetGuid(0), reader.GetString(1), reader.IsDBNull(2) ? null : reader.GetGuid(2)));
        }

        return rows.ToArray();
    }

    private async Task<long> A16aScalarAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        return Convert.ToInt64(await command.ExecuteScalarAsync(), System.Globalization.CultureInfo.InvariantCulture);
    }

    /// <summary>A second English Terms of Service in force, written past the application: its hash and retirement given.</summary>
    private static string A16aInsertSql(string version, string hash, string retired) => $"""
        INSERT INTO identity."LegalDocumentVersions"
            ("Id", "Kind", "VersionLabel", "Culture", "Context", "ContentUri", "ContentSha256", "Content",
             "AcceptanceStatement", "ReviewStatus", "PublishedAtUtc", "RetiredAtUtc", "CreatedAtUtc", "UpdatedAtUtc")
        VALUES (gen_random_uuid(), 'TermsOfService', '{version}', 'en', 'Platform', '/legal/x', {hash}, 'Other',
                'Placeholder sentence to tick.', 'Approved', now(), {retired}, now(), now())
        """;

    private sealed record A16aVersion(
        Guid Id,
        string Kind,
        string Version,
        string Culture,
        string Context,
        string AcceptanceStatement,
        string ContentUri,
        string ContentSha256,
        int CharacterCount,
        DateTimeOffset? PublishedAtUtc,
        DateTimeOffset? RetiredAtUtc,
        int AcceptanceCount);

    private sealed record A16aToAccept(Guid Id, string Kind, string Version, string Context, string AcceptanceStatement, string ContentUri);

    private sealed record A16aDocumentText(Guid Id, string Kind, string Content, string ContentSha256, DateTimeOffset? RetiredAtUtc);

    private sealed record A16aPublicInvitation(string Status);

    private sealed record A16aAnswer(string? Code, string? Message);

    private sealed record A16aProblem(Dictionary<string, string[]> Errors);
}
