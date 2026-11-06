using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using TB.Gym.Modules.PlatformBilling;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Founding status (notes plan N3a, decision 15, 5 Nov 2026), against PostgreSQL: the admin marks a space
/// founding and ends it for cause with the history kept, the check records the badge once under the
/// terms in force, the owner reads and hides it, a client sees it only from that owner, nobody else reads
/// any of it, the switch stays open on a read-only space, and the database refuses the rest.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private static readonly DateTimeOffset N3aSpaceCreated = new(2026, 6, 1, 9, 0, 0, TimeSpan.Zero);

    [TestMethod]
    public async Task N3aTheAdminMarksEndsAndMarksAgainWithTheHistoryKept()
    {
        RequiredTestClock.Set(N3aSpaceCreated);
        using var owner = CreateClient();
        var workspaceId = await RegisterCoachAsync(owner, "n3a-mark-owner@example.test", "Mark Owner", "Mark Gym");
        using var admin = await SignInPlatformAdminAsync("n3a-mark-admin@example.test");
        RequiredTestClock.Advance(TimeSpan.FromHours(2));
        var today = PaymentSchedule.Today(RequiredTestClock.UtcNow);

        // Nothing yet: the owner reads NotFounding and the access read says nothing.
        var before = await RequiredJsonAsync<N3aBadge>(await owner.GetAsync("/api/billing/founding"));
        Assert.AreEqual("NotFounding", before.State);
        Assert.AreEqual(10, before.ClientsNeeded, "Version 1's numbers, seeded by the migration.");
        Assert.AreEqual(2, before.MonthsNeeded);
        Assert.AreEqual(1, before.TermsVersion);
        Assert.IsNull((await RequiredJsonAsync<N3aAccess>(await owner.GetAsync("/api/billing/access"))).FoundingCoach);

        // The refusals, each naming its field.
        await RefreshCsrfAsync(admin);
        await N3aAssertInvalidAsync(
            await admin.PostAsJsonAsync(N3aMarkUrl(workspaceId), new { foundingSince = today.AddDays(1), note = "Tomorrow" }),
            "FoundingSince");
        await N3aAssertInvalidAsync(
            await admin.PostAsJsonAsync(N3aMarkUrl(workspaceId), new { note = "No day" }),
            "FoundingSince");
        var typo = await admin.PostAsJsonAsync(N3aMarkUrl(workspaceId), new { foundingSince = new DateOnly(1999, 12, 31), note = "A typo" });
        await AssertStatusAsync(typo, HttpStatusCode.BadRequest);
        Assert.AreEqual(
            FoundingText.FoundingSinceTooEarly,
            (await RequiredJsonAsync<N3aValidation>(typo)).Errors["FoundingSince"].Single());
        await N3aAssertInvalidAsync(
            await admin.PostAsJsonAsync(N3aMarkUrl(workspaceId), new { foundingSince = today, note = "  " }),
            "Note");
        await N3aAssertInvalidAsync(
            await admin.PostAsJsonAsync(N3aMarkUrl(workspaceId), new { foundingSince = today, note = new string('n', 201) }),
            "Note");
        await AssertStatusAsync(
            await admin.PostAsJsonAsync(N3aMarkUrl(Guid.NewGuid()), new { foundingSince = today, note = "Nobody" }),
            HttpStatusCode.NotFound);

        // Marked, once.
        var marked = await RequiredJsonAsync<N3aAdminFounding>(
            await admin.PostAsJsonAsync(N3aMarkUrl(workspaceId), new { foundingSince = today, note = "On the founding list" }));
        Assert.AreEqual(today, marked.Status.FoundingSince);
        Assert.AreEqual("On the founding list", marked.Status.Note);
        Assert.IsNull(marked.Status.EarnedOn);
        Assert.AreEqual("Waiting", marked.Badge.State);
        Assert.AreEqual(0, marked.Badge.ClientsWithActivePlan);
        Assert.AreEqual(0, marked.Badge.MonthsSinceStart);
        await AssertBillingConflictAsync(
            await admin.PostAsJsonAsync(N3aMarkUrl(workspaceId), new { foundingSince = today, note = "Again" }),
            "founding_exists");

        var detail = await N3aDetailAsync(admin, workspaceId);
        Assert.AreEqual(marked.Status.Id, detail.Founding!.Status.Id);
        Assert.IsEmpty(detail.FoundingHistory);
        Assert.IsTrue(detail.Summary.IsFounding);
        Assert.IsNull(detail.Summary.BadgeEarnedOn);
        var row = await N3aListRowAsync(admin, workspaceId);
        Assert.IsTrue(row.IsFounding);

        // The owner reads the badge's progress, but not the admin's note.
        var ownerRead = await owner.GetAsync("/api/billing/founding");
        var waiting = await RequiredJsonAsync<N3aBadge>(ownerRead);
        Assert.AreEqual("Waiting", waiting.State);
        Assert.AreEqual(today, waiting.FoundingSince);
        Assert.DoesNotContain("founding list", await ownerRead.Content.ReadAsStringAsync());
        Assert.AreEqual("Waiting", (await RequiredJsonAsync<N3aAccess>(await owner.GetAsync("/api/billing/access"))).FoundingCoach);

        // A discount is a separate thing: granting one leaves the status as it was (the end and the second
        // mark below leave the discount as it is, and revoking it leaves the badge).
        await RefreshCsrfAsync(admin);
        await AssertStatusAsync(
            await admin.PostAsJsonAsync(
                $"/api/platform-admin/workspaces/{workspaceId}/discounts",
                new { percent = 50m, startsOn = new DateOnly(2026, 7, 1), endsOnExclusive = new DateOnly(2027, 1, 1), note = "Founding coach offer" }),
            HttpStatusCode.OK);
        var discountId = (await N3aDetailAsync(admin, workspaceId)).Discounts.Single().Id;
        Assert.AreEqual(marked.Status, (await N3aDetailAsync(admin, workspaceId)).Founding!.Status);

        // Without the antiforgery token no founding write goes through, and nothing is stored.
        admin.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
        foreach (var refused in new[]
                 {
                     await admin.PostAsJsonAsync(N3aMarkUrl(workspaceId), new { foundingSince = today, note = "No token" }),
                     await admin.PostAsJsonAsync(N3aEndUrl(marked.Status.Id), new { reason = "No token" }),
                     await admin.PostAsync(N3aCheckUrl, null),
                     await admin.PostAsJsonAsync(N3aTermsUrl, N3aTermsRequest(1, 0, 1)),
                 })
        {
            await AssertStatusAsync(refused, HttpStatusCode.BadRequest);
            Assert.AreEqual("antiforgery_token_invalid", (await RequiredJsonAsync<BillingProblem>(refused)).Code);
        }

        Assert.IsNull((await N3aDetailAsync(admin, workspaceId)).Founding!.Status.EndedAtUtc);
        Assert.HasCount(1, await RequiredJsonAsync<N3aTerms[]>(await admin.GetAsync(N3aTermsUrl)));
        await RefreshCsrfAsync(admin);

        // Ended for cause, with the reason kept, once.
        await N3aAssertInvalidAsync(await admin.PostAsJsonAsync(N3aEndUrl(marked.Status.Id), new { reason = " " }), "Reason");
        await AssertStatusAsync(
            await admin.PostAsJsonAsync(N3aEndUrl(Guid.NewGuid()), new { reason = "Nobody" }),
            HttpStatusCode.NotFound);
        RequiredTestClock.Advance(TimeSpan.FromDays(3));
        var ended = await RequiredJsonAsync<N3aAdminFounding>(
            await admin.PostAsJsonAsync(N3aEndUrl(marked.Status.Id), new { reason = "The coach asked" }));
        Assert.AreEqual("Ended", ended.Badge.State);
        Assert.AreEqual("The coach asked", ended.Status.EndReason);
        Assert.IsNotNull(ended.Status.EndedAtUtc);
        await AssertBillingConflictAsync(
            await admin.PostAsJsonAsync(N3aEndUrl(marked.Status.Id), new { reason = "Again" }),
            "founding_ended");
        Assert.AreEqual(1L, await Phase6CountAsync(
            RequiredDatabaseConnection,
            """SELECT count(*) FROM billing."FoundingStatuses" WHERE "TenantId" = @id AND "EndedByUserId" IS NOT NULL""",
            workspaceId));

        detail = await N3aDetailAsync(admin, workspaceId);
        Assert.IsNull(detail.Founding);
        Assert.AreEqual("The coach asked", detail.FoundingHistory.Single().EndReason);
        Assert.IsFalse(detail.Summary.IsFounding);
        Assert.IsNull(detail.Discounts.Single(item => item.Id == discountId).RevokedAtUtc, "The end left the discount as it was.");

        // The owner learns the day it ended, never the reason; the Settings signal is gone.
        var afterEnd = await owner.GetAsync("/api/billing/founding");
        var endedRead = await RequiredJsonAsync<N3aBadge>(afterEnd);
        Assert.AreEqual("Ended", endedRead.State);
        Assert.AreEqual(today.AddDays(3), endedRead.EndedOn);
        Assert.DoesNotContain("asked", await afterEnd.Content.ReadAsStringAsync());
        Assert.IsNull((await RequiredJsonAsync<N3aAccess>(await owner.GetAsync("/api/billing/access"))).FoundingCoach);
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PutAsJsonAsync(N3aVisibilityUrl, new { hidden = true }),
            HttpStatusCode.NotFound);

        // Marked again: a new row, the ended one kept as history.
        await RefreshCsrfAsync(admin);
        var again = await RequiredJsonAsync<N3aAdminFounding>(
            await admin.PostAsJsonAsync(N3aMarkUrl(workspaceId), new { foundingSince = today.AddDays(3), note = "Back on the list" }));
        Assert.AreNotEqual(marked.Status.Id, again.Status.Id);
        detail = await N3aDetailAsync(admin, workspaceId);
        Assert.AreEqual(again.Status.Id, detail.Founding!.Status.Id);
        Assert.AreEqual(marked.Status.Id, detail.FoundingHistory.Single().Id);
        Assert.IsNull(detail.Discounts.Single(item => item.Id == discountId).RevokedAtUtc, "Marking left the discount as it was.");

        // Revoking the discount while the new status is open leaves the status exactly as it was.
        await AssertStatusAsync(await admin.PostAsync($"/api/platform-admin/discounts/{discountId}/revoke", null), HttpStatusCode.OK);
        detail = await N3aDetailAsync(admin, workspaceId);
        Assert.AreEqual(again.Status, detail.Founding!.Status);
        Assert.AreEqual("Waiting", detail.Founding.Badge.State);
        Assert.IsNotNull(detail.Discounts.Single(item => item.Id == discountId).RevokedAtUtc);

        // The database refuses what the service refuses.
        await AssertSqlStateAsync("55000", """DELETE FROM billing."FoundingStatuses" WHERE "Id" = @id""", ("id", again.Status.Id));
        await AssertSqlStateAsync("55000", """UPDATE billing."FoundingStatuses" SET "Note" = 'x' WHERE "Id" = @id""", ("id", again.Status.Id));
        await AssertSqlStateAsync(
            "55000",
            """UPDATE billing."FoundingStatuses" SET "FoundingSince" = DATE '2026-01-01' WHERE "Id" = @id""",
            ("id", again.Status.Id));
        await AssertSqlStateAsync(
            "55000",
            """UPDATE billing."FoundingStatuses" SET "BadgeHidden" = true WHERE "Id" = @id""",
            ("id", marked.Status.Id));
        await AssertSqlStateAsync(
            "55000",
            """UPDATE billing."FoundingStatuses" SET "EndedAtUtc" = NULL, "EndedByUserId" = NULL, "EndReason" = NULL WHERE "Id" = @id""",
            ("id", marked.Status.Id));
        await AssertSqlStateAsync(
            "23505",
            """
            INSERT INTO billing."FoundingStatuses" ("Id", "TenantId", "FoundingSince", "Note", "MarkedAtUtc", "MarkedByUserId", "BadgeHidden")
            VALUES (gen_random_uuid(), @id, DATE '2026-06-01', 'A second open one', now(), gen_random_uuid(), false)
            """,
            ("id", workspaceId));
        await AssertSqlStateAsync(
            "23514",
            """UPDATE billing."FoundingStatuses" SET "EarnedOn" = DATE '2026-06-10' WHERE "Id" = @id""",
            ("id", again.Status.Id));
        await AssertSqlStateAsync("55000", """UPDATE billing."FoundingTerms" SET "ClientsWithActivePlan" = 1""");
        await AssertSqlStateAsync("55000", """DELETE FROM billing."FoundingTerms" """);
    }

    [TestMethod]
    public async Task N3aTheCheckRecordsTheBadgeOnceUnderTheTermsInForce()
    {
        RequiredTestClock.Set(N3aSpaceCreated);
        using var owner = CreateClient();
        var workspaceId = await RegisterCoachAsync(owner, "n3a-check-owner@example.test", "Check Owner", "Check Gym");
        using var first = CreateClient();
        var firstId = await InviteAndAcceptAsync(owner, first, "n3a-check-client-a@example.test", true);
        using var second = CreateClient();
        var secondId = await InviteAndAcceptAsync(owner, second, "n3a-check-client-b@example.test", true);
        await CreateFreeTrainingEnrollmentAsync(owner, firstId, BillingLocalDate());
        await CreateFreeTrainingEnrollmentAsync(owner, secondId, BillingLocalDate());
        using var admin = await SignInPlatformAdminAsync("n3a-check-admin@example.test");

        // New terms: refused out of range or against a version the admin did not see.
        var terms = await RequiredJsonAsync<N3aTerms[]>(await admin.GetAsync("/api/platform-admin/founding-terms"));
        var current = terms.Single(item => item.IsCurrent);
        Assert.AreEqual(1, current.VersionNumber);
        Assert.AreEqual(10, current.ClientsWithActivePlan);
        Assert.AreEqual(2, current.MonthsSinceStart);
        await RefreshCsrfAsync(admin);
        await N3aAssertInvalidAsync(
            await admin.PostAsJsonAsync(N3aTermsUrl, N3aTermsRequest(0, 25, 1)),
            "ClientsWithActivePlan",
            "MonthsSinceStart");
        // A version can never be changed, so a number left out is refused rather than read as 0.
        await N3aAssertInvalidAsync(
            await admin.PostAsJsonAsync(N3aTermsUrl, new { clientsWithActivePlan = 10, note = "No months", expectedCurrentVersion = 1 }),
            "MonthsSinceStart");
        await N3aAssertInvalidAsync(
            await admin.PostAsJsonAsync(N3aTermsUrl, new { monthsSinceStart = 2, note = "No clients or version" }),
            "ClientsWithActivePlan",
            "ExpectedCurrentVersion");
        Assert.HasCount(1, await RequiredJsonAsync<N3aTerms[]>(await admin.GetAsync("/api/platform-admin/founding-terms")));

        // Marked under version 1.
        RequiredTestClock.Advance(TimeSpan.FromHours(1));
        var marked = await RequiredJsonAsync<N3aAdminFounding>(
            await admin.PostAsJsonAsync(N3aMarkUrl(workspaceId), new { foundingSince = PaymentSchedule.Today(RequiredTestClock.UtcNow), note = "Founding" }));
        Assert.AreEqual(1, marked.Badge.TermsVersion);

        // Ten days in: two clients with a plan, short of version 1's ten and its two months.
        RequiredTestClock.Set(new DateTimeOffset(2026, 6, 11, 9, 0, 0, TimeSpan.Zero));
        var early = await RequiredJsonAsync<N3aCheck>(await admin.PostAsync(N3aCheckUrl, null));
        Assert.AreEqual(0, early.Earned);
        Assert.AreEqual(1, early.Checked);
        var progress = (await N3aDetailAsync(admin, workspaceId)).Founding!.Badge;
        Assert.AreEqual("Waiting", progress.State);
        Assert.AreEqual(2, progress.ClientsWithActivePlan);
        Assert.AreEqual(10, progress.ClientsNeeded);
        Assert.AreEqual(0, progress.MonthsSinceStart);
        Assert.AreEqual(2, progress.MonthsNeeded);

        // Easier terms published while the space waits apply to it at once: the terms in force decide,
        // not the ones of the day it was marked. A second publish against the old version conflicts.
        await AssertStatusAsync(await admin.PostAsJsonAsync(N3aTermsUrl, N3aTermsRequest(2, 1, 1)), HttpStatusCode.OK);
        await AssertBillingConflictAsync(await admin.PostAsJsonAsync(N3aTermsUrl, N3aTermsRequest(3, 1, 1)), "founding_terms_changed");
        terms = await RequiredJsonAsync<N3aTerms[]>(await admin.GetAsync("/api/platform-admin/founding-terms"));
        CollectionAssert.AreEqual(N3aNewestTermsFirst, terms.Select(item => item.VersionNumber).ToArray());
        Assert.IsTrue(terms[0].IsCurrent);
        progress = (await N3aDetailAsync(admin, workspaceId)).Founding!.Badge;
        Assert.AreEqual(2, progress.ClientsNeeded);
        Assert.AreEqual(1, progress.MonthsNeeded);
        Assert.AreEqual(2, progress.TermsVersion);
        Assert.AreEqual(0, (await N3aRunCheckAsync()).Earned, "Still short of a whole month.");

        // 1 July: one whole month since the space started, so both terms hold. Two checks at once, held
        // until both reach the same update, record the badge once.
        RequiredTestClock.Set(new DateTimeOffset(2026, 7, 1, 10, 0, 0, TimeSpan.Zero));
        RequiredInsertBarrier.Arm("UPDATE billing.\"FoundingStatuses\"", 2, "UPDATE");
        FoundingCheckOutcome[] runs;
        try
        {
            runs = await Task.WhenAll(N3aRunCheckAsync(), N3aRunCheckAsync());
            Assert.AreEqual(2, RequiredInsertBarrier.Arrived, "The two checks never raced.");
        }
        finally
        {
            RequiredInsertBarrier.Disarm();
        }

        Assert.AreEqual(1, runs.Sum(run => run.Earned));
        Assert.AreEqual(0, (await N3aRunCheckAsync()).Checked, "Nothing waits any more.");

        var detail = await N3aDetailAsync(admin, workspaceId);
        Assert.AreEqual("Earned", detail.Founding!.Badge.State);
        Assert.AreEqual(new DateOnly(2026, 7, 1), detail.Founding.Status.EarnedOn);
        Assert.AreEqual(2, detail.Founding.Status.EarnedUnderTermsVersion);
        Assert.AreEqual(2, detail.Founding.Status.EarnedClientCount);
        Assert.AreEqual(new DateOnly(2026, 7, 1), detail.Summary.BadgeEarnedOn);
        Assert.AreEqual(new DateOnly(2026, 7, 1), (await N3aListRowAsync(admin, workspaceId)).BadgeEarnedOn);
        Assert.AreEqual(1L, await Phase6CountAsync(
            RequiredDatabaseConnection,
            """SELECT count(*) FROM billing."FoundingStatuses" WHERE "TenantId" = @id AND "EarnedUnderRule" = 'founding-badge-v1'""",
            workspaceId));
        Assert.AreEqual("Earned", (await RequiredJsonAsync<N3aAccess>(await owner.GetAsync("/api/billing/access"))).FoundingCoach);

        // Stricter terms and plans that have ended leave it earned; the earned day never moves.
        await RefreshCsrfAsync(admin);
        await AssertStatusAsync(await admin.PostAsJsonAsync(N3aTermsUrl, N3aTermsRequest(50, 12, 2)), HttpStatusCode.OK);
        RequiredTestClock.Set(new DateTimeOffset(2026, 9, 1, 10, 0, 0, TimeSpan.Zero));
        await N3aRunCheckAsync();
        var later = await RequiredJsonAsync<N3aBadge>(await owner.GetAsync("/api/billing/founding"));
        Assert.AreEqual("Earned", later.State);
        Assert.AreEqual(new DateOnly(2026, 7, 1), later.EarnedOn);
        Assert.AreEqual(3, later.TermsVersion);
        await AssertSqlStateAsync(
            "55000",
            """UPDATE billing."FoundingStatuses" SET "EarnedOn" = DATE '2026-08-01' WHERE "Id" = @id""",
            ("id", marked.Status.Id));
        await AssertSqlStateAsync(
            "55000",
            """UPDATE billing."FoundingStatuses" SET "EarnedOn" = NULL, "EarnedUnderTermsVersion" = NULL, "EarnedClientCount" = NULL, "EarnedUnderRule" = NULL WHERE "Id" = @id""",
            ("id", marked.Status.Id));

        // An end keeps the earned day on the ended row.
        await RefreshCsrfAsync(admin);
        var ended = await RequiredJsonAsync<N3aAdminFounding>(
            await admin.PostAsJsonAsync(N3aEndUrl(marked.Status.Id), new { reason = "Misrepresented qualifications" }));
        Assert.AreEqual(new DateOnly(2026, 7, 1), ended.Status.EarnedOn);
        Assert.AreEqual(new DateOnly(2026, 7, 1), (await RequiredJsonAsync<N3aBadge>(await owner.GetAsync("/api/billing/founding"))).EarnedOn);
    }

    [TestMethod]
    public async Task N3aTwoAdminsMarkingAtOnceLeaveOneOpenStatus()
    {
        RequiredTestClock.Set(N3aSpaceCreated);
        using var owner = CreateClient();
        var workspaceId = await RegisterCoachAsync(owner, "n3a-race-owner@example.test", "Race Owner", "Race Gym");
        using var first = await SignInPlatformAdminAsync("n3a-race-admin-a@example.test");
        using var second = await SignInPlatformAdminAsync("n3a-race-admin-b@example.test");
        var today = PaymentSchedule.Today(RequiredTestClock.UtcNow);

        // Each refreshes its token once, before the race (R42a's lesson). The barrier holds both inserts
        // until both requests are past their check for an open status, so the database's one open status
        // per space is what refuses the second.
        await RefreshCsrfAsync(first);
        await RefreshCsrfAsync(second);
        RequiredInsertBarrier.Arm("billing.\"FoundingStatuses\"", 2);
        HttpResponseMessage[] answers;
        try
        {
            answers = await Task.WhenAll(
                first.PostAsJsonAsync(N3aMarkUrl(workspaceId), new { foundingSince = today, note = "First admin" }),
                second.PostAsJsonAsync(N3aMarkUrl(workspaceId), new { foundingSince = today, note = "Second admin" }));
            Assert.AreEqual(2, RequiredInsertBarrier.Arrived, "The two marks never raced.");
        }
        finally
        {
            RequiredInsertBarrier.Disarm();
        }

        Assert.AreEqual(1, answers.Count(answer => answer.StatusCode == HttpStatusCode.OK));
        await AssertBillingConflictAsync(answers.Single(answer => answer.StatusCode != HttpStatusCode.OK), "founding_exists");
        Assert.AreEqual(1L, await Phase6CountAsync(
            RequiredDatabaseConnection,
            """SELECT count(*) FROM billing."FoundingStatuses" WHERE "TenantId" = @id""",
            workspaceId));
    }

    [TestMethod]
    public async Task N3aOnlyTheOwnerReadsTheBadgeAndOnlyTheirClientsSeeIt()
    {
        RequiredTestClock.Set(N3aSpaceCreated);
        using var owner = CreateClient();
        var workspaceId = await RegisterCoachAsync(owner, "n3a-see-owner@example.test", "See Owner", "See Gym");
        using var coach = CreateClient();
        await JoinAsCoachAsync(owner, coach, "n3a-see-coach@example.test", "Team Coach");
        using var ownersClient = CreateClient();
        var ownersClientId = await InviteAndAcceptAsync(owner, ownersClient, "n3a-see-client-a@example.test", true);
        using var coachesClient = CreateClient();
        await InviteAndAcceptAsync(coach, coachesClient, "n3a-see-client-b@example.test", true);
        await CreateFreeTrainingEnrollmentAsync(owner, ownersClientId, BillingLocalDate());
        using var stranger = CreateClient();
        await RegisterCoachAsync(stranger, "n3a-see-stranger@example.test", "Stranger", "Other Gym");
        using var strangersClient = CreateClient();
        await InviteAndAcceptAsync(stranger, strangersClient, "n3a-see-client-c@example.test", true);
        using var admin = await SignInPlatformAdminAsync("n3a-see-admin@example.test");

        // Terms any space meets at once, so the badge is earned on the first check.
        await RefreshCsrfAsync(admin);
        await AssertStatusAsync(await admin.PostAsJsonAsync(N3aTermsUrl, N3aTermsRequest(1, 0, 1)), HttpStatusCode.OK);
        var marked = await RequiredJsonAsync<N3aAdminFounding>(
            await admin.PostAsJsonAsync(N3aMarkUrl(workspaceId), new { foundingSince = PaymentSchedule.Today(RequiredTestClock.UtcNow), note = "Founding" }));
        Assert.IsFalse((await N3aOwnCoachAsync(ownersClient)).FoundingCoach, "Waiting is not earned.");

        // The clock has not moved since the plan was activated: "right now" still counts that plan, since
        // the window is PostgreSQL's microsecond rather than a tick that rounds away.
        Assert.AreEqual(1, (await N3aRunCheckAsync()).Earned);

        // The owner's client sees it under their coach; a team coach's client and another space's do not.
        var shown = await N3aOwnCoachAsync(ownersClient);
        Assert.AreEqual("See Owner", shown.Name);
        Assert.IsTrue(shown.FoundingCoach);
        Assert.IsFalse((await N3aOwnCoachAsync(coachesClient)).FoundingCoach);
        Assert.AreEqual("Team Coach", (await N3aOwnCoachAsync(coachesClient)).Name);
        Assert.IsFalse((await N3aOwnCoachAsync(strangersClient)).FoundingCoach);

        // Nobody else reads the owner's status or flips the switch.
        using var anonymous = CreateClient();
        await AssertStatusAsync(await anonymous.GetAsync("/api/billing/founding"), HttpStatusCode.Unauthorized);
        await AssertStatusAsync(await anonymous.PutAsJsonAsync(N3aVisibilityUrl, new { hidden = true }), HttpStatusCode.Unauthorized);
        await AssertStatusAsync(await coach.GetAsync("/api/billing/founding"), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await ownersClient.GetAsync("/api/billing/founding"), HttpStatusCode.Forbidden);
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PutAsJsonAsync(N3aVisibilityUrl, new { hidden = true }), HttpStatusCode.Forbidden);
        await RefreshCsrfAsync(ownersClient);
        await AssertStatusAsync(await ownersClient.PutAsJsonAsync(N3aVisibilityUrl, new { hidden = true }), HttpStatusCode.Forbidden);
        Assert.IsTrue((await N3aOwnCoachAsync(ownersClient)).FoundingCoach, "Nobody but the owner changed the switch.");
        Assert.IsNull(
            (await RequiredJsonAsync<N3aAccess>(await coach.GetAsync("/api/billing/access"))).FoundingCoach,
            "A team coach never learns about the founding status.");
        Assert.AreEqual("NotFounding", (await RequiredJsonAsync<N3aBadge>(await stranger.GetAsync("/api/billing/founding"))).State);
        SetTenant(stranger, workspaceId);
        await AssertStatusAsync(await stranger.GetAsync("/api/billing/founding"), HttpStatusCode.Forbidden);
        await RefreshCsrfAsync(stranger);
        await AssertStatusAsync(await stranger.PutAsJsonAsync(N3aVisibilityUrl, new { hidden = true }), HttpStatusCode.Forbidden);

        // The owner's switch: a token is needed, and a choice must be said.
        owner.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
        var noToken = await owner.PutAsJsonAsync(N3aVisibilityUrl, new { hidden = true });
        await AssertStatusAsync(noToken, HttpStatusCode.BadRequest);
        Assert.AreEqual("antiforgery_token_invalid", (await RequiredJsonAsync<BillingProblem>(noToken)).Code);
        await RefreshCsrfAsync(owner);
        await N3aAssertInvalidAsync(await owner.PutAsJsonAsync(N3aVisibilityUrl, new { }), "Hidden");

        var hidden = await RequiredJsonAsync<N3aBadge>(await owner.PutAsJsonAsync(N3aVisibilityUrl, new { hidden = true }));
        Assert.AreEqual("Earned", hidden.State);
        Assert.IsTrue(hidden.Hidden);
        Assert.IsFalse((await N3aOwnCoachAsync(ownersClient)).FoundingCoach, "Hidden from the clients at once.");
        Assert.AreEqual(
            "Earned",
            (await RequiredJsonAsync<N3aAccess>(await owner.GetAsync("/api/billing/access"))).FoundingCoach,
            "The owner keeps the way to show it again.");
        Assert.IsTrue((await N3aDetailAsync(admin, workspaceId)).Founding!.Status.BadgeHidden);
        Assert.IsTrue((await RequiredJsonAsync<N3aBadge>(await owner.PutAsJsonAsync(N3aVisibilityUrl, new { hidden = true }))).Hidden, "The same choice twice is the same choice.");
        Assert.IsFalse((await RequiredJsonAsync<N3aBadge>(await owner.PutAsJsonAsync(N3aVisibilityUrl, new { hidden = false }))).Hidden);
        Assert.IsTrue((await N3aOwnCoachAsync(ownersClient)).FoundingCoach);

        // Ended: gone at once. Marked again, the new status waits, and the old earned day does not count.
        await RefreshCsrfAsync(admin);
        await AssertStatusAsync(await admin.PostAsJsonAsync(N3aEndUrl(marked.Status.Id), new { reason = "Harm to clients" }), HttpStatusCode.OK);
        Assert.IsFalse((await N3aOwnCoachAsync(ownersClient)).FoundingCoach);
        await AssertStatusAsync(
            await admin.PostAsJsonAsync(N3aMarkUrl(workspaceId), new { foundingSince = PaymentSchedule.Today(RequiredTestClock.UtcNow), note = "Second chance" }),
            HttpStatusCode.OK);
        Assert.IsFalse((await N3aOwnCoachAsync(ownersClient)).FoundingCoach);

        // A released client reads their former space as any released client does: not at all.
        var details = await RequiredJsonAsync<N3aClientVersion>(await owner.GetAsync($"/api/clients/{ownersClientId}"));
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync($"/api/clients/{ownersClientId}/release", new { reason = "Moved away", version = details.Version }),
            HttpStatusCode.OK);
        await AssertStatusAsync(await ownersClient.GetAsync("/api/client-profile/me/coach"), HttpStatusCode.Forbidden);
    }

    [TestMethod]
    public async Task N3aTheBadgeSwitchStaysOpenWhileAnUnpaidSpaceIsReadOnly()
    {
        RequiredTestClock.Set(BillingWorkspaceCreated);
        using var owner = CreateClient();
        var workspaceId = await RegisterCoachAsync(owner, "n3a-ro-owner@example.test", "Unpaid Owner", "Unpaid Gym");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(owner, client, "n3a-ro-client@example.test", true);
        await CreateFreeTrainingEnrollmentAsync(owner, clientId, BillingLocalDate());
        RequiredTestClock.Set(new DateTimeOffset(2026, 8, 1, 0, 10, 0, TimeSpan.Zero));
        await IssueBillingAsync(BillingJuly);

        // Seven days after the due date the space is read-only; the admin still marks it.
        RequiredTestClock.Set(new DateTimeOffset(2026, 8, 15, 8, 0, 0, TimeSpan.Zero));
        using var admin = await SignInPlatformAdminAsync("n3a-ro-admin@example.test");
        await RefreshCsrfAsync(admin);
        await AssertStatusAsync(
            await admin.PostAsJsonAsync(N3aMarkUrl(workspaceId), new { foundingSince = new DateOnly(2026, 8, 15), note = "Founding" }),
            HttpStatusCode.OK);
        await AssertReadOnlyAsync(await InviteForBillingAsync(owner, "n3a-ro-try@example.test"));

        // Reading the badge and the owner's own switch stay open.
        Assert.AreEqual("Waiting", (await RequiredJsonAsync<N3aBadge>(await owner.GetAsync("/api/billing/founding"))).State);
        await RefreshCsrfAsync(owner);
        var hidden = await owner.PutAsJsonAsync(N3aVisibilityUrl, new { hidden = true });
        await AssertStatusAsync(hidden, HttpStatusCode.OK);
        Assert.IsTrue((await RequiredJsonAsync<N3aBadge>(hidden)).Hidden);
        Assert.IsTrue((await RequiredJsonAsync<N3aAccess>(await owner.GetAsync("/api/billing/access"))).IsReadOnly);
    }

    [TestMethod]
    public async Task N3aTheWorkersSweepRecordsADueBadgeEvenWhenItsInvoiceStepFails()
    {
        RequiredTestClock.Set(N3aSpaceCreated);
        using var owner = CreateClient();
        var workspaceId = await RegisterCoachAsync(owner, "n3a-sweep-owner@example.test", "Sweep Owner", "Sweep Gym");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(owner, client, "n3a-sweep-client@example.test", true);
        await CreateFreeTrainingEnrollmentAsync(owner, clientId, BillingLocalDate());
        using var admin = await SignInPlatformAdminAsync("n3a-sweep-admin@example.test");
        await RefreshCsrfAsync(admin);
        await AssertStatusAsync(await admin.PostAsJsonAsync(N3aTermsUrl, N3aTermsRequest(1, 0, 1)), HttpStatusCode.OK);
        await AssertStatusAsync(
            await admin.PostAsJsonAsync(N3aMarkUrl(workspaceId), new { foundingSince = PaymentSchedule.Today(RequiredTestClock.UtcNow), note = "Founding" }),
            HttpStatusCode.OK);

        // The Worker as it runs, on the test host's services, except that its invoice step throws: the
        // badge check has a try of its own, so a broken invoice run never keeps a badge waiting.
        using var worker = new TB.Gym.Worker.PlatformBillingWorker(
            new N3aFailingInvoiceRunScopes(RequiredFactory.Services.GetRequiredService<IServiceScopeFactory>()),
            RequiredTestClock,
            Microsoft.Extensions.Options.Options.Create(new TB.Gym.Infrastructure.Application.PlatformBillingOptions { SweepIntervalSeconds = 3_600 }),
            Microsoft.Extensions.Logging.Abstractions.NullLogger<TB.Gym.Worker.PlatformBillingWorker>.Instance);
        await worker.StartAsync(CancellationToken.None);
        try
        {
            var deadline = DateTime.UtcNow.AddSeconds(30);
            while (await N3aEarnedCountAsync(workspaceId) == 0 && DateTime.UtcNow < deadline)
            {
                await Task.Delay(100);
            }
        }
        finally
        {
            await worker.StopAsync(CancellationToken.None);
        }

        Assert.AreEqual(1L, await N3aEarnedCountAsync(workspaceId), "The sweep's own check recorded the badge.");
        Assert.AreEqual("Earned", (await RequiredJsonAsync<N3aBadge>(await owner.GetAsync("/api/billing/founding"))).State);
    }

    // ---------- founding helpers ----------

    private Task<long> N3aEarnedCountAsync(Guid workspaceId) => Phase6CountAsync(
        RequiredDatabaseConnection,
        """SELECT count(*) FROM billing."FoundingStatuses" WHERE "TenantId" = @id AND "EarnedOn" IS NOT NULL""",
        workspaceId);

    /// <summary>The test host's scopes, with an invoice run that always fails.</summary>
    private sealed class N3aFailingInvoiceRunScopes(IServiceScopeFactory inner) : IServiceScopeFactory
    {
        public IServiceScope CreateScope() => new Scope(inner.CreateScope());

        private sealed class Scope(IServiceScope scope) : IServiceScope, IAsyncDisposable
        {
            public IServiceProvider ServiceProvider { get; } = new Provider(scope.ServiceProvider);

            public void Dispose() => scope.Dispose();

            public ValueTask DisposeAsync()
            {
                if (scope is IAsyncDisposable disposable)
                {
                    return disposable.DisposeAsync();
                }

                scope.Dispose();
                return ValueTask.CompletedTask;
            }
        }

        private sealed class Provider(IServiceProvider services) : IServiceProvider
        {
            public object? GetService(Type serviceType) =>
                serviceType == typeof(IPlatformInvoiceRun) ? new FailingRun() : services.GetService(serviceType);
        }

        private sealed class FailingRun : IPlatformInvoiceRun
        {
            public Task<InvoiceRunOutcome> IssueForMonthAsync(BillingMonth month, CancellationToken cancellationToken) =>
                throw new InvalidOperationException("The invoice run is broken for this test.");

            public Task<int> QueueRemindersAsync(CancellationToken cancellationToken) =>
                throw new InvalidOperationException("The invoice run is broken for this test.");
        }
    }

    private static readonly int[] N3aNewestTermsFirst = [2, 1];

    private const string N3aTermsUrl = "/api/platform-admin/founding-terms";

    private const string N3aCheckUrl = "/api/platform-admin/founding/check";

    private const string N3aVisibilityUrl = "/api/billing/founding/visibility";

    private static string N3aMarkUrl(Guid workspaceId) => $"/api/platform-admin/workspaces/{workspaceId}/founding";

    private static string N3aEndUrl(Guid foundingId) => $"/api/platform-admin/founding/{foundingId}/end";

    private static object N3aTermsRequest(int clients, int months, int expectedCurrentVersion) => new
    {
        clientsWithActivePlan = clients,
        monthsSinceStart = months,
        note = "Test terms",
        expectedCurrentVersion,
    };

    /// <summary>The check as the Worker's sweep runs it.</summary>
    private async Task<FoundingCheckOutcome> N3aRunCheckAsync()
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<IFoundingBadgeCheck>().RunAsync(CancellationToken.None);
    }

    private static async Task<N3aAdminDetail> N3aDetailAsync(HttpClient admin, Guid workspaceId) =>
        await RequiredJsonAsync<N3aAdminDetail>(await admin.GetAsync($"/api/platform-admin/workspaces/{workspaceId}"));

    private static async Task<N3aAdminSummary> N3aListRowAsync(HttpClient admin, Guid workspaceId) =>
        (await RequiredJsonAsync<N3aAdminSummary[]>(await admin.GetAsync("/api/platform-admin/workspaces")))
        .Single(item => item.TenantId == workspaceId);

    private static async Task<N3aOwnCoach> N3aOwnCoachAsync(HttpClient client)
    {
        var response = await client.GetAsync("/api/client-profile/me/coach");
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<N3aOwnCoach>(response);
    }

    private static async Task N3aAssertInvalidAsync(HttpResponseMessage response, params string[] fields)
    {
        await AssertStatusAsync(response, HttpStatusCode.BadRequest);
        var problem = await RequiredJsonAsync<N3aValidation>(response);
        CollectionAssert.AreEquivalent(fields, problem.Errors.Keys.ToArray(), string.Join(", ", problem.Errors.Keys));
    }

    private sealed record N3aValidation(Dictionary<string, string[]> Errors);
    private sealed record N3aAccess(bool IsReadOnly, bool HasOverdueInvoice, DateOnly? ReadOnlyFrom, string? FoundingCoach);
    private sealed record N3aBadge(
        string State,
        DateOnly? FoundingSince,
        int? ClientsWithActivePlan,
        int ClientsNeeded,
        int? MonthsSinceStart,
        int MonthsNeeded,
        int TermsVersion,
        DateOnly? EarnedOn,
        DateOnly? EndedOn,
        bool Hidden);
    private sealed record N3aStatus(
        Guid Id,
        DateOnly FoundingSince,
        string Note,
        DateTimeOffset MarkedAtUtc,
        DateOnly? EarnedOn,
        int? EarnedUnderTermsVersion,
        int? EarnedClientCount,
        bool BadgeHidden,
        DateTimeOffset? EndedAtUtc,
        string? EndReason);
    private sealed record N3aAdminFounding(N3aStatus Status, N3aBadge Badge);
    private sealed record N3aAdminSummary(Guid TenantId, bool IsFounding, DateOnly? BadgeEarnedOn);
    private sealed record N3aAdminDetail(
        N3aAdminSummary Summary,
        BillingDiscount[] Discounts,
        N3aAdminFounding? Founding,
        N3aStatus[] FoundingHistory);
    private sealed record N3aTerms(Guid Id, int VersionNumber, int ClientsWithActivePlan, int MonthsSinceStart, string? Note, bool IsCurrent);
    private sealed record N3aCheck(int Checked, int Earned);
    private sealed record N3aOwnCoach(string Name, bool FoundingCoach);
    private sealed record N3aClientVersion(uint Version);
}
