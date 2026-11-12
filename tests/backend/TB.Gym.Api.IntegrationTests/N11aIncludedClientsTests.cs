using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.PlatformBilling;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Included clients (notes plan N11a, decisions 11 and 17, 7 Nov 2026), against PostgreSQL: the founding terms
/// carry the clients a founding space's owner seat includes, the admin grants a founding space extra included
/// clients for whole calendar months and revokes them once, <c>platform-invoice-v2</c> counts both into every
/// invoice and estimate, each invoice keeps where its included clients came from, and nothing reaches another
/// space. Every figure is made up: the founding number and each grant are the admin's to type.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private static readonly DateTimeOffset N11aSpaceCreated = new(2026, 6, 1, 9, 0, 0, TimeSpan.Zero);
    private static readonly DateOnly N11aJuly = new(2026, 7, 1);
    private static readonly int?[] N11aSeatNumbersNewestFirst = [null, 6, null];
    private static readonly HttpStatusCode[] N11aOneRevokeWins = [HttpStatusCode.OK, HttpStatusCode.Conflict];
    private static readonly bool[] N11aRevokedNewestFirst = [true, false, true];

    private const string N11aRevertRefusal =
        "A founding seat number or extra included clients were published, granted or billed; roll forward instead of reverting this migration.";

    [TestMethod]
    public async Task N11aTheRunCountsAFoundingSeatAndAGrantBesideAPlainSpaceAndKeepsThem()
    {
        RequiredTestClock.Set(N11aSpaceCreated);
        using var owner = CreateClient();
        var workspaceId = await RegisterCoachAsync(owner, "n11a-run-owner@example.test", "Run Owner", "Run Gym");
        await N11aBillableClientsAsync(owner, "n11a-run-client", 4);
        using var plainOwner = CreateClient();
        var plainId = await RegisterCoachAsync(plainOwner, "n11a-run-plain@example.test", "Plain Owner", "Plain Gym");
        await N11aBillableClientsAsync(plainOwner, "n11a-run-plain-client", 2);
        using var admin = await SignInPlatformAdminAsync("n11a-run-admin@example.test");
        RequiredTestClock.Advance(TimeSpan.FromHours(1));

        // A plan whose seat includes no client, so each included client shows on the bill; a founding number of 2.
        await RefreshCsrfAsync(admin);
        await AssertStatusAsync(await admin.PostAsJsonAsync("/api/platform-admin/price-plans", N11aPlanRequest(1, 0)), HttpStatusCode.OK);
        await AssertStatusAsync(await admin.PostAsJsonAsync(N3aTermsUrl, N3aTermsRequest(10, 2, 1, 2)), HttpStatusCode.OK);
        var marked = await RequiredJsonAsync<N11aFounding>(
            await admin.PostAsJsonAsync(N3aMarkUrl(workspaceId), new { foundingSince = new DateOnly(2026, 6, 1), note = "One of the first coaches" }));
        Assert.AreEqual(2, marked.FoundingSeatIncludedClients, "The founding view says what the owner's seat includes.");
        var grant = await RequiredJsonAsync<N11aGrant>(
            await admin.PostAsJsonAsync(N11aGrantUrl(workspaceId), N11aGrantRequest(1, N11aJuly, new DateOnly(2026, 10, 1), "Brought a coach to TB Gym")));
        await AssertStatusAsync(
            await admin.PostAsJsonAsync(
                $"/api/platform-admin/workspaces/{workspaceId}/discounts",
                new { percent = 35m, startsOn = N11aJuly, endsOnExclusive = new DateOnly(2026, 8, 1), note = "Early coach offer" }),
            HttpStatusCode.OK);

        RequiredTestClock.Set(new DateTimeOffset(2026, 8, 1, 0, 10, 0, TimeSpan.Zero));
        await IssueBillingAsync(new BillingMonth(2026, 7));

        // The founding space: v2, the plan's per-seat number, the founding number with its version, the grant,
        // and its discount on top of the whole subtotal, exact to the cent in USD.
        var july = (await N11aDetailAsync(admin, workspaceId)).Invoices.Single(item => item.PeriodStart == N11aJuly);
        Assert.AreEqual("platform-invoice-v2", july.CalculationName);
        Assert.AreEqual(2, july.PricePlanVersion);
        Assert.AreEqual(0, july.PlanIncludedClientsPerSeat);
        Assert.AreEqual(((int?)2, (int?)2, 1), (july.FoundingSeatIncludedClients, july.FoundingTermsVersion, july.GrantedIncludedClients));
        Assert.AreEqual(
            new N11aAmounts(1, 4, 3, 1, 15.00m, 2.00m, 0m, 17.00m, 35m, 5.95m, 11.05m, "USD", 0, 2, 1),
            july.Amounts);
        var (statusId, grantIds) = await N11aInvoiceSourcesAsync(july.Id);
        Assert.AreEqual(marked.Status.Id, statusId);
        CollectionAssert.AreEqual(new[] { grant.Id }, grantIds);

        // The plain space in the same run: the amounts v1 gives it, under the same new plan.
        var plain = (await N11aDetailAsync(admin, plainId)).Invoices.Single(item => item.PeriodStart == N11aJuly);
        Assert.AreEqual("platform-invoice-v2", plain.CalculationName);
        Assert.AreEqual(((int?)null, (int?)null, 0), (plain.FoundingSeatIncludedClients, plain.FoundingTermsVersion, plain.GrantedIncludedClients));
        Assert.AreEqual(new N11aAmounts(1, 2, 0, 2, 15.00m, 4.00m, 0m, 19.00m, 0m, 0m, 19.00m, "USD", 0, 0, 0), plain.Amounts);
        var (plainStatus, plainGrants) = await N11aInvoiceSourcesAsync(plain.Id);
        Assert.IsNull(plainStatus);
        Assert.IsEmpty(plainGrants, "A grant on one space never reaches another space's invoice.");

        // The owner reads the same invoice, never a note.
        var ownerRead = await owner.GetAsync("/api/billing");
        Assert.AreEqual(july, (await RequiredJsonAsync<N11aBilling>(ownerRead)).Invoices.Single(item => item.PeriodStart == N11aJuly));
        var ownerBody = await ownerRead.Content.ReadAsStringAsync();
        Assert.DoesNotContain("Brought a coach", ownerBody);
        Assert.DoesNotContain("first coaches", ownerBody);

        // Publishing terms, ending the status and revoking the grant leave every issued invoice as it was.
        RequiredTestClock.Set(new DateTimeOffset(2026, 8, 10, 9, 0, 0, TimeSpan.Zero));
        await RefreshCsrfAsync(admin);
        await AssertStatusAsync(await admin.PostAsJsonAsync(N3aTermsUrl, N3aTermsRequest(10, 2, 2, 7)), HttpStatusCode.OK);
        RequiredTestClock.Set(new DateTimeOffset(2026, 8, 15, 9, 0, 0, TimeSpan.Zero));
        await AssertStatusAsync(await admin.PostAsJsonAsync(N3aEndUrl(marked.Status.Id), new { reason = "The coach asked" }), HttpStatusCode.OK);
        RequiredTestClock.Set(new DateTimeOffset(2026, 8, 20, 9, 0, 0, TimeSpan.Zero));
        await AssertStatusAsync(await admin.PostAsync(N11aRevokeUrl(grant.Id), null), HttpStatusCode.OK);
        // Only its state moved, as every invoice's does with the day: due on Aug 8, it is overdue now.
        Assert.AreEqual(july with { Status = "Overdue" }, (await N11aDetailAsync(admin, workspaceId)).Invoices.Single(item => item.Id == july.Id));
        var kept = await N11aInvoiceSourcesAsync(july.Id);
        Assert.AreEqual(marked.Status.Id, kept.StatusId);
        CollectionAssert.AreEqual(new[] { grant.Id }, kept.GrantIds, "The revoked grant stays on the invoice it was counted in.");

        // The database refuses the rest: the invoice's new columns and a grant are frozen, and an invoice whose
        // included clients do not add up, or a v1 invoice with a founding seat, is never stored.
        await AssertSqlStateAsync("55000", """UPDATE billing."Invoices" SET "GrantedIncludedClients" = 0 WHERE "Id" = @id""", ("id", july.Id));
        await AssertSqlStateAsync("55000", """UPDATE billing."Invoices" SET "FoundingSeatIncludedClients" = 9 WHERE "Id" = @id""", ("id", july.Id));
        await AssertSqlStateAsync("55000", """UPDATE billing."Invoices" SET "IncludedClientGrantIds" = '{}' WHERE "Id" = @id""", ("id", july.Id));
        await AssertSqlStateAsync("55000", """UPDATE billing."IncludedClientGrants" SET "Clients" = 9 WHERE "Id" = @id""", ("id", grant.Id));
        await AssertSqlStateAsync("55000", """UPDATE billing."IncludedClientGrants" SET "RevokedAtUtc" = NULL, "RevokedByUserId" = NULL WHERE "Id" = @id""", ("id", grant.Id));
        await AssertSqlStateAsync("55000", """DELETE FROM billing."IncludedClientGrants" WHERE "Id" = @id""", ("id", grant.Id));
        foreach (var (change, constraint) in new[]
                 {
                     ("""r."IncludedClients" := r."IncludedClients" + 1;""", "CK_Invoices_Quantities"),
                     ("""r."CalculationName" := 'platform-invoice-v1';""", "CK_Invoices_Version1"),
                     ("""r."FoundingTermsVersion" := NULL;""", "CK_Invoices_FoundingSeat"),
                     ("""r."IncludedClientGrantIds" := '{}';""", "CK_Invoices_Grants"),
                 })
        {
            var refused = await A7RefusedAsync(N11aInvoiceCopySql(july.Id, change));
            Assert.AreEqual(("23514", constraint), (refused.SqlState, refused.ConstraintName), change);
        }

        // August: the status ended on the 15th, so August keeps the founding seat, with the highest number the
        // status had (version 3, published while it was open); the revoked grant counts nowhere from now on.
        RequiredTestClock.Set(new DateTimeOffset(2026, 9, 1, 0, 10, 0, TimeSpan.Zero));
        await IssueBillingAsync(new BillingMonth(2026, 8));
        var august = (await N11aDetailAsync(admin, workspaceId)).Invoices.Single(item => item.PeriodStart == new DateOnly(2026, 8, 1));
        Assert.AreEqual(((int?)7, (int?)3, 0), (august.FoundingSeatIncludedClients, august.FoundingTermsVersion, august.GrantedIncludedClients));
        Assert.AreEqual(7, august.Amounts.FoundingIncludedClients);

        // September: from the month after the end, no founding seat; the grant still revoked.
        RequiredTestClock.Set(new DateTimeOffset(2026, 10, 1, 0, 10, 0, TimeSpan.Zero));
        await IssueBillingAsync(new BillingMonth(2026, 9));
        var september = (await N11aDetailAsync(admin, workspaceId)).Invoices.Single(item => item.PeriodStart == new DateOnly(2026, 9, 1));
        Assert.AreEqual(((int?)null, (int?)null, 0), (september.FoundingSeatIncludedClients, september.FoundingTermsVersion, september.GrantedIncludedClients));
        Assert.AreEqual(0, september.Amounts.IncludedClients);

        // A void and reissue keeps July's plan and counts the founding seat and the grants again now: version 3's
        // number, the highest the status had before it ended on Aug 15 (the seat reads the status's whole run up to
        // now, though version 3 came after July), and no grant since it was revoked. A newer plan, whose seat
        // includes 3 clients, is published first, so keeping July's plan (none a seat) is what the amounts prove.
        await RefreshCsrfAsync(admin);
        await AssertStatusAsync(await admin.PostAsJsonAsync("/api/platform-admin/price-plans", N11aPlanRequest(2, 3)), HttpStatusCode.OK);
        var voided = await RequiredJsonAsync<N11aVoid>(
            await admin.PostAsJsonAsync($"/api/platform-admin/invoices/{july.Id}/void", new { reason = "Founding seat raised late", reissue = true }));
        var reissued = voided.Reissued!;
        Assert.AreEqual(july.Id, reissued.ReplacesInvoiceId);
        Assert.AreEqual((2, 0), (reissued.PricePlanVersion, reissued.PlanIncludedClientsPerSeat), "A correction keeps the voided invoice's plan.");
        Assert.AreEqual(((int?)7, (int?)3, 0), (reissued.FoundingSeatIncludedClients, reissued.FoundingTermsVersion, reissued.GrantedIncludedClients));
        Assert.AreEqual(
            new N11aAmounts(1, 4, 7, 0, 15.00m, 0m, 0m, 15.00m, 35m, 5.25m, 9.75m, "USD", 0, 7, 0),
            reissued.Amounts);
        var (reissuedStatus, reissuedGrants) = await N11aInvoiceSourcesAsync(reissued.Id);
        Assert.AreEqual(marked.Status.Id, reissuedStatus);
        Assert.IsEmpty(reissuedGrants);
        Assert.AreEqual(july with { Status = "Void", ReplacedByInvoiceId = reissued.Id }, (await N11aDetailAsync(admin, workspaceId)).Invoices.Single(item => item.Id == july.Id));
    }

    [TestMethod]
    public async Task N11aTermsCarryTheFoundingNumberAndRefuseOneLeftOut()
    {
        RequiredTestClock.Set(N11aSpaceCreated);
        using var owner = CreateClient();
        await RegisterCoachAsync(owner, "n11a-terms-owner@example.test", "Terms Owner", "Terms Gym");
        using var admin = await SignInPlatformAdminAsync("n11a-terms-admin@example.test");
        RequiredTestClock.Advance(TimeSpan.FromHours(1));

        var seeded = (await RequiredJsonAsync<N11aTerms[]>(await admin.GetAsync(N3aTermsUrl))).Single();
        Assert.AreEqual((1, (int?)null), (seeded.VersionNumber, seeded.FoundingSeatIncludedClients), "Version 1 names no founding number.");

        // Left out, the number is refused rather than read as none, and nothing is published.
        await RefreshCsrfAsync(admin);
        var leftOut = await admin.PostAsJsonAsync(
            N3aTermsUrl,
            new { clientsWithActivePlan = 10, monthsSinceStart = 2, note = "No seat key", expectedCurrentVersion = 1, priceGuaranteeMonths = (int?)null });
        await AssertStatusAsync(leftOut, HttpStatusCode.BadRequest);
        var unread = await RequiredJsonAsync<N11aUnreadable>(leftOut);
        Assert.AreEqual(
            ("request_invalid", "foundingSeatIncludedClients", "This request is missing foundingSeatIncludedClients. Reload the page and send it again."),
            (unread.Code, unread.Field, unread.Message));
        await N3aAssertInvalidAsync(await admin.PostAsJsonAsync(N3aTermsUrl, N3aTermsRequest(10, 2, 1, -1)), "FoundingSeatIncludedClients");
        await N3aAssertInvalidAsync(await admin.PostAsJsonAsync(N3aTermsUrl, N3aTermsRequest(10, 2, 1, 1_001)), "FoundingSeatIncludedClients");
        await N3aAssertInvalidAsync(
            await admin.PostAsJsonAsync(N3aTermsUrl, N3aTermsRequest(0, 25, 1, 1_001)),
            "ClientsWithActivePlan",
            "MonthsSinceStart",
            "FoundingSeatIncludedClients");
        Assert.HasCount(1, await RequiredJsonAsync<N11aTerms[]>(await admin.GetAsync(N3aTermsUrl)));

        // A version with the number, then one with none on purpose (the key sent as null); the badge's
        // thresholds stay as they were through both.
        var six = await RequiredJsonAsync<N11aTerms>(await admin.PostAsJsonAsync(N3aTermsUrl, N3aTermsRequest(10, 2, 1, 6)));
        Assert.AreEqual((2, 10, 2, (int?)6, true), (six.VersionNumber, six.ClientsWithActivePlan, six.MonthsSinceStart, six.FoundingSeatIncludedClients, six.IsCurrent));
        var none = await RequiredJsonAsync<N11aTerms>(await admin.PostAsJsonAsync(N3aTermsUrl, N3aTermsRequest(10, 2, 2)));
        Assert.AreEqual((3, (int?)null), (none.VersionNumber, none.FoundingSeatIncludedClients));
        await AssertBillingConflictAsync(await admin.PostAsJsonAsync(N3aTermsUrl, N3aTermsRequest(10, 2, 2, 6)), "founding_terms_changed");
        var versions = await RequiredJsonAsync<N11aTerms[]>(await admin.GetAsync(N3aTermsUrl));
        CollectionAssert.AreEqual(N11aSeatNumbersNewestFirst, versions.Select(item => item.FoundingSeatIncludedClients).ToArray());
        var badge = await RequiredJsonAsync<N3aBadge>(await owner.GetAsync("/api/billing/founding"));
        Assert.AreEqual((10, 2, 3), (badge.ClientsNeeded, badge.MonthsNeeded, badge.TermsVersion));

        // A version is immutable, and the database keeps the number in its range.
        await AssertSqlStateAsync("55000", """UPDATE billing."FoundingTerms" SET "FoundingSeatIncludedClients" = 1""");
        var refused = await A7RefusedAsync(
            """
            INSERT INTO billing."FoundingTerms" ("Id", "VersionNumber", "ClientsWithActivePlan", "MonthsSinceStart", "FoundingSeatIncludedClients", "PublishedAtUtc")
            VALUES (gen_random_uuid(), 9, 10, 2, 1001, now())
            """);
        Assert.AreEqual(("23514", "CK_FoundingTerms_SeatIncludedClients"), (refused.SqlState, refused.ConstraintName));
    }

    [TestMethod]
    public async Task N11aTheAdminGrantsExtraClientsToAFoundingSpaceForWholeMonthsOnceAndRevokesOnce()
    {
        RequiredTestClock.Set(N11aSpaceCreated);
        using var owner = CreateClient();
        var workspaceId = await RegisterCoachAsync(owner, "n11a-grant-owner@example.test", "Grant Owner", "Grant Gym");
        using var other = CreateClient();
        var otherId = await RegisterCoachAsync(other, "n11a-grant-other@example.test", "Other Owner", "Never Founding Gym");
        using var admin = await SignInPlatformAdminAsync("n11a-grant-admin@example.test");
        RequiredTestClock.Advance(TimeSpan.FromHours(1));
        var october = new DateOnly(2026, 10, 1);
        var valid = N11aGrantRequest(4, N11aJuly, october, "Brought a coach");

        // Without the antiforgery token nothing is granted or revoked.
        await RefreshCsrfAsync(admin);
        admin.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
        foreach (var refusedWrite in new[]
                 {
                     await admin.PostAsJsonAsync(N11aGrantUrl(workspaceId), valid),
                     await admin.PostAsync(N11aRevokeUrl(Guid.NewGuid()), null),
                 })
        {
            await AssertStatusAsync(refusedWrite, HttpStatusCode.BadRequest);
            Assert.AreEqual("antiforgery_token_invalid", (await RequiredJsonAsync<BillingProblem>(refusedWrite)).Code);
        }

        await RefreshCsrfAsync(admin);

        // Refused by field, whole calendar months alone; an unknown space is not found.
        await N3aAssertInvalidAsync(await admin.PostAsJsonAsync(N11aGrantUrl(workspaceId), N11aGrantRequest(0, N11aJuly, october, "x")), "Clients");
        await N3aAssertInvalidAsync(await admin.PostAsJsonAsync(N11aGrantUrl(workspaceId), N11aGrantRequest(1_001, N11aJuly, october, "x")), "Clients");
        await N3aAssertInvalidAsync(
            await admin.PostAsJsonAsync(N11aGrantUrl(workspaceId), N11aGrantRequest(4, new DateOnly(2026, 7, 15), october, "x")),
            "StartsOn");
        await N3aAssertInvalidAsync(
            await admin.PostAsJsonAsync(N11aGrantUrl(workspaceId), N11aGrantRequest(4, N11aJuly, new DateOnly(2026, 9, 30), "x")),
            "EndsOnExclusive");
        await N3aAssertInvalidAsync(await admin.PostAsJsonAsync(N11aGrantUrl(workspaceId), N11aGrantRequest(4, N11aJuly, N11aJuly, "x")), "EndsOnExclusive");
        await N3aAssertInvalidAsync(await admin.PostAsJsonAsync(N11aGrantUrl(workspaceId), N11aGrantRequest(4, N11aJuly, october, " ")), "Note");
        await N3aAssertInvalidAsync(
            await admin.PostAsJsonAsync(N11aGrantUrl(workspaceId), N11aGrantRequest(4, N11aJuly, october, new string('n', 201))),
            "Note");
        await N3aAssertInvalidAsync(
            await admin.PostAsJsonAsync(N11aGrantUrl(workspaceId), new { clients = 4, endsOnExclusive = october, note = "No first day" }),
            "StartsOn");
        await N3aAssertInvalidAsync(
            await admin.PostAsJsonAsync(N11aGrantUrl(workspaceId), N11aGrantRequest(0, new DateOnly(2026, 7, 2), new DateOnly(2026, 7, 2), "")),
            "Clients",
            "StartsOn",
            "EndsOnExclusive",
            "Note");
        await AssertStatusAsync(await admin.PostAsJsonAsync(N11aGrantUrl(Guid.NewGuid()), valid), HttpStatusCode.NotFound);

        // Only a space with an open founding status: never marked, then ended, are both refused.
        await AssertBillingConflictAsync(await admin.PostAsJsonAsync(N11aGrantUrl(otherId), valid), "space_not_founding");
        await AssertBillingConflictAsync(await admin.PostAsJsonAsync(N11aGrantUrl(workspaceId), valid), "space_not_founding");
        var first = await RequiredJsonAsync<N11aFounding>(
            await admin.PostAsJsonAsync(N3aMarkUrl(workspaceId), new { foundingSince = new DateOnly(2026, 6, 1), note = "Founding" }));
        RequiredTestClock.Advance(TimeSpan.FromDays(1));
        await AssertStatusAsync(await admin.PostAsJsonAsync(N3aEndUrl(first.Status.Id), new { reason = "Harm to clients" }), HttpStatusCode.OK);
        await AssertBillingConflictAsync(await admin.PostAsJsonAsync(N11aGrantUrl(workspaceId), valid), "space_not_founding");
        Assert.IsEmpty((await N11aDetailAsync(admin, workspaceId)).IncludedClientGrants);
        await AssertStatusAsync(
            await admin.PostAsJsonAsync(N3aMarkUrl(workspaceId), new { foundingSince = new DateOnly(2026, 6, 2), note = "Founding again" }),
            HttpStatusCode.OK);

        // Granted, once: the same request again answers the grant that exists.
        var granted = await RequiredJsonAsync<N11aGrant>(await admin.PostAsJsonAsync(N11aGrantUrl(workspaceId), valid));
        Assert.AreEqual((4, N11aJuly, october, "Brought a coach", (DateTimeOffset?)null), (granted.Clients, granted.StartsOn, granted.EndsOnExclusive, granted.Note, granted.RevokedAtUtc));
        var again = await RequiredJsonAsync<N11aGrant>(
            await admin.PostAsJsonAsync(N11aGrantUrl(workspaceId), N11aGrantRequest(4, N11aJuly, october, "  Brought a coach ")));
        Assert.AreEqual(granted, again, "A double press grants once.");

        // Twice at once, both at the lock together: one grant, both answered with it.
        var second = N11aGrantRequest(7, new DateOnly(2026, 8, 1), new DateOnly(2026, 12, 1), "Brought a second coach");
        RequiredInsertBarrier.Arm("billing.\"FoundingStatuses\"", 2, "FOR UPDATE");
        HttpResponseMessage[] racing;
        try
        {
            racing = await Task.WhenAll(
                admin.PostAsJsonAsync(N11aGrantUrl(workspaceId), second),
                admin.PostAsJsonAsync(N11aGrantUrl(workspaceId), second));
            Assert.AreEqual(2, RequiredInsertBarrier.Arrived, "The two grants never raced.");
        }
        finally
        {
            RequiredInsertBarrier.Disarm();
        }

        var raced = await Task.WhenAll(racing.Select(RequiredJsonAsync<N11aGrant>));
        Assert.AreEqual(raced[0].Id, raced[1].Id);
        Assert.HasCount(2, (await N11aDetailAsync(admin, workspaceId)).IncludedClientGrants);

        // Revoked once, kept; an unknown grant is not found; the same request after a revoke is a new grant.
        var revoked = await RequiredJsonAsync<N11aGrant>(await admin.PostAsync(N11aRevokeUrl(granted.Id), null));
        Assert.IsNotNull(revoked.RevokedAtUtc);
        await AssertBillingConflictAsync(await admin.PostAsync(N11aRevokeUrl(granted.Id), null), "grant_revoked");
        await AssertStatusAsync(await admin.PostAsync(N11aRevokeUrl(Guid.NewGuid()), null), HttpStatusCode.NotFound);
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        var regranted = await RequiredJsonAsync<N11aGrant>(await admin.PostAsJsonAsync(N11aGrantUrl(workspaceId), valid));
        Assert.AreNotEqual(granted.Id, regranted.Id);
        Assert.IsGreaterThan(granted.GrantedAtUtc, regranted.GrantedAtUtc);

        // The database keeps an unrevoked grant as granted too: no edit, no delete.
        await AssertSqlStateAsync("55000", """UPDATE billing."IncludedClientGrants" SET "Clients" = 9 WHERE "Id" = @id""", ("id", regranted.Id));
        await AssertSqlStateAsync("55000", """UPDATE billing."IncludedClientGrants" SET "Note" = 'Edited' WHERE "Id" = @id""", ("id", regranted.Id));
        await AssertSqlStateAsync("55000", """DELETE FROM billing."IncludedClientGrants" WHERE "Id" = @id""", ("id", regranted.Id));

        // Two revokes at once: one answered with the grant, the other refused.
        RequiredInsertBarrier.Arm("UPDATE billing.\"IncludedClientGrants\"", 2, "UPDATE");
        HttpResponseMessage[] revokes;
        try
        {
            revokes = await Task.WhenAll(
                admin.PostAsync(N11aRevokeUrl(raced[0].Id), null),
                admin.PostAsync(N11aRevokeUrl(raced[0].Id), null));
            Assert.AreEqual(2, RequiredInsertBarrier.Arrived, "The two revokes never raced.");
        }
        finally
        {
            RequiredInsertBarrier.Disarm();
        }

        CollectionAssert.AreEquivalent(
            N11aOneRevokeWins,
            revokes.Select(response => response.StatusCode).ToArray());

        // The admin's detail lists every grant newest first, the revoked ones kept.
        var listed = (await N11aDetailAsync(admin, workspaceId)).IncludedClientGrants;
        CollectionAssert.AreEqual(
            new[] { raced[0].Id, regranted.Id, granted.Id },
            listed.Select(item => item.Id).ToArray());
        CollectionAssert.AreEqual(
            N11aRevokedNewestFirst,
            listed.Select(item => item.RevokedAtUtc is not null).ToArray());

        // The trigger lets a revoke through alone: one that also changes the grant is refused, column by column, and
        // the same revoke without the change then goes through.
        foreach (var change in new[]
                 {
                     "\"Clients\" = 9",
                     "\"Note\" = 'Edited'",
                     "\"StartsOn\" = DATE '2026-08-01'",
                     "\"EndsOnExclusive\" = DATE '2026-12-01'",
                     "\"GrantedAtUtc\" = now()",
                     "\"GrantedByUserId\" = gen_random_uuid()",
                     "\"TenantId\" = gen_random_uuid()",
                 })
        {
            await AssertSqlStateAsync(
                "55000",
                $"""UPDATE billing."IncludedClientGrants" SET "RevokedAtUtc" = now(), "RevokedByUserId" = gen_random_uuid(), {change} WHERE "Id" = @id""",
                ("id", regranted.Id));
        }

        await Phase6ExecuteAsync(
            """UPDATE billing."IncludedClientGrants" SET "RevokedAtUtc" = now(), "RevokedByUserId" = gen_random_uuid() WHERE "Id" = @id""",
            ("id", regranted.Id));
        Assert.IsNotNull((await N11aDetailAsync(admin, workspaceId)).IncludedClientGrants.Single(item => item.Id == regranted.Id).RevokedAtUtc);
    }

    [TestMethod]
    public async Task N11aTheOwnerReadsTheirFoundingSeatAndGrantsAndTheEstimateCountsThemAsTheRunWill()
    {
        RequiredTestClock.Set(N11aSpaceCreated);
        using var owner = CreateClient();
        var workspaceId = await RegisterCoachAsync(owner, "n11a-read-owner@example.test", "Read Owner", "Read Gym");
        await N11aBillableClientsAsync(owner, "n11a-read-client", 1);
        using var coach = CreateClient();
        await JoinAsCoachAsync(owner, coach, "n11a-read-coach@example.test", "Read Coach");
        using var stranger = CreateClient();
        await RegisterCoachAsync(stranger, "n11a-read-stranger@example.test", "Stranger", "Stranger Gym");
        using var admin = await SignInPlatformAdminAsync("n11a-read-admin@example.test");
        RequiredTestClock.Advance(TimeSpan.FromHours(1));

        var before = await N11aBillingAsync(owner);
        Assert.IsNull(before.FoundingSeatIncludedClients);
        Assert.IsEmpty(before.IncludedClientGrants);

        // A founding number at or below the plan's 5 includes nothing more, so nobody is told of one.
        await RefreshCsrfAsync(admin);
        await AssertStatusAsync(await admin.PostAsJsonAsync(N3aTermsUrl, N3aTermsRequest(10, 2, 1, 4)), HttpStatusCode.OK);
        var marked = await RequiredJsonAsync<N11aFounding>(
            await admin.PostAsJsonAsync(N3aMarkUrl(workspaceId), new { foundingSince = new DateOnly(2026, 6, 1), note = "Founding" }));
        Assert.IsNull(marked.FoundingSeatIncludedClients);
        Assert.IsNull((await N11aBillingAsync(owner)).FoundingSeatIncludedClients);

        // A higher one applies at once, in the trial too; the admin's founding view says the same.
        await AssertStatusAsync(await admin.PostAsJsonAsync(N3aTermsUrl, N3aTermsRequest(10, 2, 2, 9)), HttpStatusCode.OK);
        var inTrial = await N11aBillingAsync(owner);
        Assert.AreEqual("Trial", inTrial.Status);
        Assert.AreEqual(9, inTrial.FoundingSeatIncludedClients);
        Assert.AreEqual(9, (await N11aDetailAsync(admin, workspaceId)).Founding!.FoundingSeatIncludedClients);

        // Grants: one running, one to come, one ended and one revoked; the owner reads the first two, oldest
        // first, with their clients and days, and never a note.
        await N11aGrantOkAsync(admin, workspaceId, N11aGrantRequest(4, new DateOnly(2026, 6, 1), new DateOnly(2026, 9, 1), "Running grant note"));
        await N11aGrantOkAsync(admin, workspaceId, N11aGrantRequest(7, new DateOnly(2026, 8, 1), new DateOnly(2026, 11, 1), "Coming grant note"));
        await N11aGrantOkAsync(admin, workspaceId, N11aGrantRequest(4, new DateOnly(2026, 3, 1), new DateOnly(2026, 6, 1), "Ended grant note"));
        var toRevoke = await N11aGrantOkAsync(admin, workspaceId, N11aGrantRequest(7, new DateOnly(2026, 9, 1), new DateOnly(2026, 12, 1), "Revoked grant note"));
        await AssertStatusAsync(await admin.PostAsync(N11aRevokeUrl(toRevoke.Id), null), HttpStatusCode.OK);
        var response = await owner.GetAsync("/api/billing");
        var read = await RequiredJsonAsync<N11aBilling>(response);
        CollectionAssert.AreEqual(
            new[]
            {
                new N11aOwnerGrant(4, new DateOnly(2026, 6, 1), new DateOnly(2026, 8, 31), new DateOnly(2026, 9, 1), false),
                new N11aOwnerGrant(7, new DateOnly(2026, 8, 1), new DateOnly(2026, 10, 31), new DateOnly(2026, 11, 1), true),
            },
            read.IncludedClientGrants);
        Assert.DoesNotContain("grant note", await response.Content.ReadAsStringAsync());

        // After the trial: the owner's month so far and the admin's read the same included clients by source.
        // Two seats include 10, the founding seat 4 more (9 over the plan's 5) and the running grant 4.
        RequiredTestClock.Set(new DateTimeOffset(2026, 7, 10, 9, 0, 0, TimeSpan.Zero));
        var month = (await N11aBillingAsync(owner)).CurrentMonth;
        Assert.IsFalse(month.InTrial);
        Assert.AreEqual(3, month.FoundingTermsVersion);
        Assert.AreEqual(new N11aAmounts(2, 1, 18, 0, 30.00m, 0m, 10.00m, 40.00m, 0m, 0m, 40.00m, "USD", 10, 4, 4), month.Amounts);
        Assert.AreEqual(month, (await N11aDetailAsync(admin, workspaceId)).CurrentMonth);

        // A coach never reads the bill; another space's owner reads none of it, here or through this space's id.
        await AssertStatusAsync(await coach.GetAsync("/api/billing"), HttpStatusCode.Forbidden);
        var strangers = await N11aBillingAsync(stranger);
        Assert.IsNull(strangers.FoundingSeatIncludedClients);
        Assert.IsEmpty(strangers.IncludedClientGrants);
        Assert.AreEqual((5, 0, 0), (strangers.CurrentMonth.Amounts.SeatIncludedClients, strangers.CurrentMonth.Amounts.FoundingIncludedClients, strangers.CurrentMonth.Amounts.GrantedIncludedClients));
        SetTenant(stranger, workspaceId);
        await AssertStatusAsync(await stranger.GetAsync("/api/billing"), HttpStatusCode.Forbidden);

        // Ended mid-month: the owner no longer reads a founding seat, while July keeps it on the estimate and
        // on the invoice the run issues, which reads the same sources the estimate read.
        RequiredTestClock.Set(new DateTimeOffset(2026, 7, 15, 9, 0, 0, TimeSpan.Zero));
        await RefreshCsrfAsync(admin);
        await AssertStatusAsync(await admin.PostAsJsonAsync(N3aEndUrl(marked.Status.Id), new { reason = "The coach asked" }), HttpStatusCode.OK);
        RequiredTestClock.Set(new DateTimeOffset(2026, 7, 31, 23, 0, 0, TimeSpan.Zero));
        var ended = await N11aBillingAsync(owner);
        Assert.IsNull(ended.FoundingSeatIncludedClients);
        Assert.IsNull((await N11aDetailAsync(admin, workspaceId)).Founding);
        Assert.AreEqual((10, 4, 4), (ended.CurrentMonth.Amounts.SeatIncludedClients, ended.CurrentMonth.Amounts.FoundingIncludedClients, ended.CurrentMonth.Amounts.GrantedIncludedClients));
        RequiredTestClock.Set(new DateTimeOffset(2026, 8, 1, 0, 10, 0, TimeSpan.Zero));
        await IssueBillingAsync(new BillingMonth(2026, 7));
        var july = (await N11aBillingAsync(owner)).Invoices.Single(item => item.PeriodStart == N11aJuly);
        Assert.AreEqual(ended.CurrentMonth.Amounts, july.Amounts);
        Assert.AreEqual(((int?)9, (int?)3, 4), (july.FoundingSeatIncludedClients, july.FoundingTermsVersion, july.GrantedIncludedClients));
    }

    [TestMethod]
    public async Task N11aTheMigrationRefusesToRevertOverAGrant()
    {
        RequiredTestClock.Set(N11aSpaceCreated);
        using var owner = CreateClient();
        var workspaceId = await RegisterCoachAsync(owner, "n11a-revert-owner@example.test", "Revert Owner", "Revert Gym");
        using var admin = await SignInPlatformAdminAsync("n11a-revert-admin@example.test");
        RequiredTestClock.Advance(TimeSpan.FromHours(1));
        await RefreshCsrfAsync(admin);
        await AssertStatusAsync(
            await admin.PostAsJsonAsync(N3aMarkUrl(workspaceId), new { foundingSince = new DateOnly(2026, 6, 1), note = "Founding" }),
            HttpStatusCode.OK);
        var grant = await N11aGrantOkAsync(admin, workspaceId, N11aGrantRequest(4, N11aJuly, new DateOnly(2026, 10, 1), "Brought a coach"));

        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var migrations = context.Database.GetMigrations().ToArray();
        var migration = migrations.Single(item => item.EndsWith("_IncludedClients", StringComparison.Ordinal));
        var previous = migrations[Array.IndexOf(migrations, migration) - 1];
        var migrator = context.Database.GetInfrastructure().GetRequiredService<IMigrator>();

        // Grants are billing history kept append-only, so going back is a forward fix: the migration stops with a plain
        // message, keeps everything and stays applied (Npgsql retries 55000 first, each time rolled back).
        var thrown = await Assert.ThrowsAsync<Exception>(() => migrator.MigrateAsync(previous));
        var refused = thrown as PostgresException ?? thrown.InnerException as PostgresException
            ?? throw new AssertFailedException($"Expected PostgreSQL's refusal, not {thrown}");
        Assert.AreEqual(("55000", N11aRevertRefusal), (refused.SqlState, refused.MessageText));
        Assert.Contains(migration, await context.Database.GetAppliedMigrationsAsync());

        // The revert had already taken back the migration after this one, in a transaction of its own, before this
        // one refused (the price guarantee's months, notes plan N8, which no terms version here carries). The API
        // reads the newest model, so it goes back on before the API is asked.
        await migrator.MigrateAsync();
        Assert.AreEqual(grant, (await N11aDetailAsync(admin, workspaceId)).IncludedClientGrants.Single());
    }

    private static string N11aGrantUrl(Guid workspaceId) => $"/api/platform-admin/workspaces/{workspaceId}/included-client-grants";

    private static string N11aRevokeUrl(Guid grantId) => $"/api/platform-admin/included-client-grants/{grantId}/revoke";

    private static object N11aGrantRequest(int clients, DateOnly startsOn, DateOnly endsOnExclusive, string note) =>
        new { clients, startsOn, endsOnExclusive, note };

    /// <summary>A price plan like the seeded one, with its own per-seat number: the figure is the test's.</summary>
    private static object N11aPlanRequest(int expectedCurrentVersion, int includedClientsPerSeat) => new
    {
        seatPrice = 15m,
        includedClientsPerSeat,
        extraClientPrice = 2m,
        gymFee = 10m,
        gymFeeMinimumSeats = 2,
        trialDays = 30,
        paymentTermDays = 7,
        graceDays = 7,
        expectedCurrentVersion,
        note = "N11a test plan",
    };

    /// <summary>Clients on a free training plan from today, each billable for the eight weeks it covers.</summary>
    private async Task N11aBillableClientsAsync(HttpClient owner, string emailPrefix, int count)
    {
        for (var index = 1; index <= count; index++)
        {
            using var client = CreateClient();
            var clientId = await InviteAndAcceptAsync(owner, client, $"{emailPrefix}-{index}@example.test", true);
            await CreateFreeTrainingEnrollmentAsync(owner, clientId, BillingLocalDate());
        }
    }

    private static async Task<N11aGrant> N11aGrantOkAsync(HttpClient admin, Guid workspaceId, object request)
    {
        await RefreshCsrfAsync(admin);
        var response = await admin.PostAsJsonAsync(N11aGrantUrl(workspaceId), request);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<N11aGrant>(response);
    }

    private static async Task<N11aDetail> N11aDetailAsync(HttpClient admin, Guid workspaceId) =>
        await RequiredJsonAsync<N11aDetail>(await admin.GetAsync($"/api/platform-admin/workspaces/{workspaceId}"));

    private static async Task<N11aBilling> N11aBillingAsync(HttpClient owner)
    {
        var response = await owner.GetAsync("/api/billing");
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<N11aBilling>(response);
    }

    /// <summary>The founding status and the grants an invoice recorded, which no view sends.</summary>
    private async Task<(Guid? StatusId, Guid[] GrantIds)> N11aInvoiceSourcesAsync(Guid invoiceId)
    {
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """SELECT "FoundingStatusId", "IncludedClientGrantIds" FROM billing."Invoices" WHERE "Id" = @id""";
        command.Parameters.AddWithValue("id", invoiceId);
        await using var reader = await command.ExecuteReaderAsync();
        Assert.IsTrue(await reader.ReadAsync(), "The invoice was not found.");
        return (reader.IsDBNull(0) ? null : reader.GetGuid(0), reader.GetFieldValue<Guid[]>(1));
    }

    /// <summary>A copy of an issued invoice with one change, inserted raw: the checks run before the unique indexes.</summary>
    private static string N11aInvoiceCopySql(Guid invoiceId, string change) => $$"""
        DO $copy$
        DECLARE
            r billing."Invoices"%ROWTYPE;
        BEGIN
            SELECT * INTO STRICT r FROM billing."Invoices" WHERE "Id" = '{{invoiceId}}';
            r."Id" := gen_random_uuid();
            {{change}}
            INSERT INTO billing."Invoices" SELECT r.*;
        END $copy$;
        """;

    private sealed record N11aAmounts(
        int Seats,
        int BillableClients,
        int IncludedClients,
        int ExtraClients,
        decimal SeatAmount,
        decimal ExtraClientAmount,
        decimal GymFeeAmount,
        decimal Subtotal,
        decimal DiscountPercent,
        decimal DiscountAmount,
        decimal Total,
        string CurrencyCode,
        int SeatIncludedClients,
        int FoundingIncludedClients,
        int GrantedIncludedClients);
    private sealed record N11aInvoice(
        Guid Id,
        string ReferenceCode,
        DateOnly PeriodStart,
        int PricePlanVersion,
        string CalculationName,
        int PlanIncludedClientsPerSeat,
        N11aAmounts Amounts,
        string Status,
        Guid? ReplacesInvoiceId,
        Guid? ReplacedByInvoiceId,
        int? FoundingSeatIncludedClients,
        int? FoundingTermsVersion,
        int GrantedIncludedClients);
    private sealed record N11aEstimate(bool InTrial, int PricePlanVersion, N11aAmounts Amounts, int? FoundingTermsVersion);
    private sealed record N11aGrant(Guid Id, int Clients, DateOnly StartsOn, DateOnly EndsOnExclusive, string Note, DateTimeOffset GrantedAtUtc, DateTimeOffset? RevokedAtUtc);
    private sealed record N11aOwnerGrant(int Clients, DateOnly StartsOn, DateOnly LastDay, DateOnly EndsOnExclusive, bool StartsLater);
    private sealed record N11aFounding(N3aStatus Status, N3aBadge Badge, int? FoundingSeatIncludedClients);
    private sealed record N11aDetail(N11aEstimate CurrentMonth, N11aInvoice[] Invoices, N11aFounding? Founding, N11aGrant[] IncludedClientGrants);
    private sealed record N11aBilling(
        string Status,
        N11aEstimate CurrentMonth,
        N11aInvoice[] Invoices,
        int? FoundingSeatIncludedClients,
        N11aOwnerGrant[] IncludedClientGrants);
    private sealed record N11aTerms(Guid Id, int VersionNumber, int ClientsWithActivePlan, int MonthsSinceStart, string? Note, bool IsCurrent, int? FoundingSeatIncludedClients);
    private sealed record N11aVoid(N11aInvoice Voided, N11aInvoice? Reissued);
    private sealed record N11aUnreadable(string Code, string? Field, string Message);
}
