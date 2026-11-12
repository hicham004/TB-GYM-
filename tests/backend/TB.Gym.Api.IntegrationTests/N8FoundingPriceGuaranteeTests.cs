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
/// The founding price guarantee (notes plan N8, decision 16, 7 Nov 2026), against PostgreSQL: a founding space
/// is billed at the price plan version in force on its founding day until the months of the founding terms in
/// force have passed since its last discount day, the month that day falls inside included; the lower of that
/// version and the latest is billed; an ended status holds its last month and no later one; a reissue keeps its
/// invoice's version; only the owner reads until when, only the platform admin at which version; and the
/// database keeps the months as published. Every figure is made up: the months are the admin's to type.
/// </summary>
/// <remarks>
/// The seeded plan version 1 ($15 a seat) carries the migration's real now() as its publish time, later than
/// every clock here, so a founding day reaches it only as the first version: a space is held at version 1 when
/// it was marked, or its founding day ended, before the test publishes version 2.
/// </remarks>
public sealed partial class Phase3TrainingWorkflowTests
{
    private static readonly DateTimeOffset N8SpaceCreated = new(2026, 6, 1, 9, 0, 0, TimeSpan.Zero);
    private static readonly DateOnly N8FoundingDay = new(2026, 6, 1);
    private static readonly DateOnly N8July = new(2026, 7, 1);
    private static readonly int?[] N8MonthsNewestFirst = [null, 7, 120, 0, null];

    private const string N8RevertRefusal =
        "Founding price guarantee months were published; roll forward instead of reverting this migration.";

    [TestMethod]
    public async Task N8AFoundingSpaceIsBilledAtItsFoundingDaysPlanThroughTheMonthItsGuaranteeEndsInAndAPlainSpaceAtTheLatest()
    {
        RequiredTestClock.Set(N8SpaceCreated);
        using var owner = CreateClient();
        var workspaceId = await RegisterCoachAsync(owner, "n8-run-owner@example.test", "Run Owner", "Run Gym");
        using var plainOwner = CreateClient();
        var plainId = await RegisterCoachAsync(plainOwner, "n8-run-plain@example.test", "Plain Owner", "Plain Gym");
        using var admin = await SignInPlatformAdminAsync("n8-run-admin@example.test");
        RequiredTestClock.Advance(TimeSpan.FromHours(1));

        // Founding since 1 June, a 45-day discount whose last day is 14 August, and terms of 5 months: the
        // guarantee's last day is 14 January, five calendar months after the discount's last day.
        await N8MarkAsync(admin, workspaceId, N8FoundingDay);
        await N7GrantAsync(admin, workspaceId, 35m, N8July, N8July.AddDays(45), "Early coach offer");
        await N8PublishMonthsAsync(admin, 1, 5);
        var held = new N8Hold(1, new DateOnly(2027, 1, 14));
        Assert.AreEqual(held, (await N8DetailAsync(admin, workspaceId)).PriceHold);

        // The day after, a dearer plan: version 2 asks $21 a seat where version 1 asks $15.
        RequiredTestClock.Set(new DateTimeOffset(2026, 6, 2, 9, 0, 0, TimeSpan.Zero));
        await N8PublishPlanAsync(admin, 1, 21m);
        var inTrial = await N8DetailAsync(admin, workspaceId);
        Assert.AreEqual(held, inTrial.PriceHold, "A newer plan never moves the version held.");
        Assert.AreEqual((true, 1, 0m), N8Priced(inTrial.CurrentMonth), "The trial names the version the first bill will use.");
        Assert.AreEqual((true, 2, 0m), N8Priced((await N8DetailAsync(admin, plainId)).CurrentMonth));

        // July so far, the first month after the trial: the founding space at version 1 with its discount off
        // version 1's seat, the plain space at version 2. The owner reads the same estimate and the last day.
        RequiredTestClock.Set(new DateTimeOffset(2026, 7, 10, 9, 0, 0, TimeSpan.Zero));
        var estimate = (await N8DetailAsync(admin, workspaceId)).CurrentMonth;
        Assert.AreEqual((false, 1, 9.75m), N8Priced(estimate));
        Assert.AreEqual((15.00m, 35m, 5.25m), (estimate.Amounts.SeatAmount, estimate.Amounts.DiscountPercent, estimate.Amounts.DiscountAmount));
        Assert.AreEqual((false, 2, 21.00m), N8Priced((await N8DetailAsync(admin, plainId)).CurrentMonth));
        var ownerRead = await N8BillingAsync(owner);
        Assert.AreEqual(estimate, ownerRead.CurrentMonth);
        Assert.AreEqual(held.LastDay, ownerRead.PricesHeldUntil);
        Assert.IsNull((await N8BillingAsync(plainOwner)).PricesHeldUntil);
        Assert.IsNull((await N8DetailAsync(admin, plainId)).PriceHold);

        // July's run bills what the estimate said, each invoice keeping the version it used.
        RequiredTestClock.Set(new DateTimeOffset(2026, 8, 1, 0, 10, 0, TimeSpan.Zero));
        await IssueBillingAsync(new BillingMonth(2026, 7));
        var july = await N8InvoiceAsync(admin, workspaceId, N8July);
        Assert.AreEqual((1, 15m, 9.75m), N8Billed(july));
        Assert.AreEqual((35m, 5.25m), (july.Amounts.DiscountPercent, july.Amounts.DiscountAmount));
        Assert.AreEqual((2, 21m, 21.00m), N8Billed(await N8InvoiceAsync(admin, plainId, N8July)));
        Assert.AreEqual(july, (await N8BillingAsync(owner)).Invoices.Single());

        // 1 February: the last day, 14 January, has passed. December is issued by hand through the API, a
        // month that ended before the last one, and January by the run. Both are held: the discount is long
        // over, and the month the last day falls inside is held whole.
        RequiredTestClock.Set(new DateTimeOffset(2027, 2, 1, 0, 10, 0, TimeSpan.Zero));
        var december = new DateOnly(2026, 12, 1);
        await RefreshCsrfAsync(admin);
        var byHand = await admin.PostAsJsonAsync("/api/platform-admin/invoices/issue", new { periodStart = december });
        await AssertStatusAsync(byHand, HttpStatusCode.OK);
        var ran = await RequiredJsonAsync<BillingRun>(byHand);
        Assert.AreEqual((december, 3, 0, 0), (ran.PeriodStart, ran.Issued, ran.AlreadyIssued, ran.InTrial), "Both spaces and the admin's own.");
        Assert.AreEqual((1, 15m, 15.00m), N8Billed(await N8InvoiceAsync(admin, workspaceId, december)));
        Assert.AreEqual((2, 21m, 21.00m), N8Billed(await N8InvoiceAsync(admin, plainId, december)));
        await IssueBillingAsync(new BillingMonth(2027, 1));
        Assert.AreEqual(
            (1, 15m, 15.00m),
            N8Billed(await N8InvoiceAsync(admin, workspaceId, new DateOnly(2027, 1, 1))),
            "The month the guarantee's last day falls inside is billed at the held version, all of it.");

        // The pages stopped saying so the day after the last one, and February so far is at the latest version.
        var after = await N8DetailAsync(admin, workspaceId);
        Assert.IsNull(after.PriceHold);
        Assert.AreEqual((false, 2, 21.00m), N8Priced(after.CurrentMonth));
        Assert.IsNull((await N8BillingAsync(owner)).PricesHeldUntil);

        // February, the month after: version 2, as for every other space.
        RequiredTestClock.Set(new DateTimeOffset(2027, 3, 1, 0, 10, 0, TimeSpan.Zero));
        await IssueBillingAsync(new BillingMonth(2027, 2));
        var february = new DateOnly(2027, 2, 1);
        Assert.AreEqual((2, 21m, 21.00m), N8Billed(await N8InvoiceAsync(admin, workspaceId, february)));
        Assert.AreEqual((2, 21m, 21.00m), N8Billed(await N8InvoiceAsync(admin, plainId, february)));
    }

    [TestMethod]
    public async Task N8ASpaceWithNoDiscountIsHeldItsMonthsFromItsFoundingDayAndARevokedDiscountIsOutOfTheCount()
    {
        RequiredTestClock.Set(N8SpaceCreated);
        using var owner = CreateClient();
        var workspaceId = await RegisterCoachAsync(owner, "n8-days-owner@example.test", "Days Owner", "Days Gym");
        using var admin = await SignInPlatformAdminAsync("n8-days-admin@example.test");
        RequiredTestClock.Advance(TimeSpan.FromHours(1));

        // Founding since 31 January, a day older than every published plan, and a dearer plan published today.
        // The terms in force name no months, so nothing is held and the trial names the latest version.
        await N8MarkAsync(admin, workspaceId, new DateOnly(2026, 1, 31));
        await N8PublishPlanAsync(admin, 1, 21m);
        await N8AssertHeldAsync(admin, owner, workspaceId, null);
        Assert.AreEqual((true, 2, 0m), N8Priced((await N8DetailAsync(admin, workspaceId)).CurrentMonth));

        // Five months and no discount: held from the founding day, in calendar months, so 31 January runs to
        // 30 June. The version held is the first: no version was published by the founding day.
        await N8PublishMonthsAsync(admin, 1, 5);
        var fromFoundingDay = new N8Hold(1, new DateOnly(2026, 6, 30));
        await N8AssertHeldAsync(admin, owner, workspaceId, fromFoundingDay);
        Assert.AreEqual((true, 1, 0m), N8Priced((await N8DetailAsync(admin, workspaceId)).CurrentMonth));

        // A discount that ended before the founding day changes nothing.
        await N7GrantAsync(admin, workspaceId, 12.5m, new DateOnly(2026, 1, 2), new DateOnly(2026, 1, 21), "Opening weeks");
        await N8AssertHeldAsync(admin, owner, workspaceId, fromFoundingDay);

        // A 45-day one to come moves the count to its last day, 24 July, at once; revoked, it is out of it.
        var toCome = new DateOnly(2026, 6, 10);
        var later = await N7GrantAsync(admin, workspaceId, 35m, toCome, toCome.AddDays(45), "Early coach offer");
        await N8AssertHeldAsync(admin, owner, workspaceId, new N8Hold(1, new DateOnly(2026, 12, 24)));
        await AssertStatusAsync(await admin.PostAsync($"/api/platform-admin/discounts/{later.Id}/revoke", null), HttpStatusCode.OK);
        await N8AssertHeldAsync(admin, owner, workspaceId, fromFoundingDay);

        // On the last day itself both pages still say so; the day after, neither does.
        RequiredTestClock.Set(new DateTimeOffset(2026, 6, 30, 23, 30, 0, TimeSpan.Zero));
        await N8AssertHeldAsync(admin, owner, workspaceId, fromFoundingDay);
        RequiredTestClock.Set(new DateTimeOffset(2026, 7, 1, 0, 30, 0, TimeSpan.Zero));
        await N8AssertHeldAsync(admin, owner, workspaceId, null);

        // July, the first month billed, starts after the last day: the latest version, in the trial's last
        // hours and once it is priced.
        Assert.AreEqual((true, 2, 0m), N8Priced((await N8DetailAsync(admin, workspaceId)).CurrentMonth));
        RequiredTestClock.Set(new DateTimeOffset(2026, 7, 10, 9, 0, 0, TimeSpan.Zero));
        Assert.AreEqual((false, 2, 21.00m), N8Priced((await N8DetailAsync(admin, workspaceId)).CurrentMonth));
    }

    [TestMethod]
    public async Task N8ACheaperLatestPlanBillsAFoundingSpaceAndEqualTotalsKeepTheHeldOne()
    {
        RequiredTestClock.Set(N8SpaceCreated);
        using var owner = CreateClient();
        var workspaceId = await RegisterCoachAsync(owner, "n8-lower-owner@example.test", "Lower Owner", "Lower Gym");
        using var admin = await SignInPlatformAdminAsync("n8-lower-admin@example.test");
        RequiredTestClock.Advance(TimeSpan.FromHours(1));
        await N8MarkAsync(admin, workspaceId, N8FoundingDay);
        await N8PublishMonthsAsync(admin, 1, 7);
        var held = new N8Hold(1, new DateOnly(2027, 1, 1));

        // Version 2, the day after, asks version 1's own prices: equal totals keep the held version.
        RequiredTestClock.Set(new DateTimeOffset(2026, 6, 2, 9, 0, 0, TimeSpan.Zero));
        await N8PublishPlanAsync(admin, 1, 15m);
        RequiredTestClock.Set(new DateTimeOffset(2026, 7, 10, 9, 0, 0, TimeSpan.Zero));
        Assert.AreEqual((false, 1, 15.00m), N8Priced((await N8DetailAsync(admin, workspaceId)).CurrentMonth));
        RequiredTestClock.Set(new DateTimeOffset(2026, 8, 1, 0, 10, 0, TimeSpan.Zero));
        await IssueBillingAsync(new BillingMonth(2026, 7));
        Assert.AreEqual((1, 15m, 15.00m), N8Billed(await N8InvoiceAsync(admin, workspaceId, N8July)));

        // Version 3 is cheaper than the held one: the space pays it while the guarantee runs, and both pages
        // go on naming what is held.
        RequiredTestClock.Advance(TimeSpan.FromMinutes(10));
        await N8PublishPlanAsync(admin, 2, 11.5m);
        Assert.AreEqual((false, 3, 11.50m), N8Priced((await N8DetailAsync(admin, workspaceId)).CurrentMonth));
        await N8AssertHeldAsync(admin, owner, workspaceId, held);
        RequiredTestClock.Set(new DateTimeOffset(2026, 9, 1, 0, 10, 0, TimeSpan.Zero));
        await IssueBillingAsync(new BillingMonth(2026, 8));
        var august = await N8InvoiceAsync(admin, workspaceId, new DateOnly(2026, 8, 1));
        Assert.AreEqual((3, 11.5m, 11.50m), N8Billed(august));

        // Version 4 is dearer than both: back to the held version, not the cheapest there has been.
        RequiredTestClock.Advance(TimeSpan.FromMinutes(10));
        await N8PublishPlanAsync(admin, 3, 19m);
        Assert.AreEqual((false, 1, 15.00m), N8Priced((await N8DetailAsync(admin, workspaceId)).CurrentMonth));

        // A void and reissue of August keeps the version on its invoice: neither the held one, which a first
        // issue would choose today, nor the latest.
        Assert.AreEqual((3, 11.5m, 11.50m), N8Billed(await N8ReissueAsync(admin, august)));

        RequiredTestClock.Set(new DateTimeOffset(2026, 10, 1, 0, 10, 0, TimeSpan.Zero));
        await IssueBillingAsync(new BillingMonth(2026, 9));
        Assert.AreEqual((1, 15m, 15.00m), N8Billed(await N8InvoiceAsync(admin, workspaceId, new DateOnly(2026, 9, 1))));
    }

    [TestMethod]
    public async Task N8AnEndedStatusHoldsTheMonthItEndedInAndNoLaterOneAndAReissueKeepsItsInvoicesPlan()
    {
        RequiredTestClock.Set(N8SpaceCreated);
        using var owner = CreateClient();
        var workspaceId = await RegisterCoachAsync(owner, "n8-end-owner@example.test", "End Owner", "End Gym");
        using var admin = await SignInPlatformAdminAsync("n8-end-admin@example.test");
        RequiredTestClock.Advance(TimeSpan.FromHours(1));
        var marked = await N8MarkAsync(admin, workspaceId, N8FoundingDay);
        await N8PublishMonthsAsync(admin, 1, 11);
        RequiredTestClock.Set(new DateTimeOffset(2026, 6, 2, 9, 0, 0, TimeSpan.Zero));
        await N8PublishPlanAsync(admin, 1, 21m);
        await N8AssertHeldAsync(admin, owner, workspaceId, new N8Hold(1, new DateOnly(2027, 5, 1)));

        RequiredTestClock.Set(new DateTimeOffset(2026, 8, 1, 0, 10, 0, TimeSpan.Zero));
        await IssueBillingAsync(new BillingMonth(2026, 7));
        var july = await N8InvoiceAsync(admin, workspaceId, N8July);
        Assert.AreEqual((1, 15m, 15.00m), N8Billed(july));

        // Ended on 12 August, months before the last day: from then neither page says prices are held, while
        // August so far stays at the held version.
        RequiredTestClock.Set(new DateTimeOffset(2026, 8, 12, 9, 0, 0, TimeSpan.Zero));
        await RefreshCsrfAsync(admin);
        await AssertStatusAsync(await admin.PostAsJsonAsync(N3aEndUrl(marked.Status.Id), new { reason = "The coach asked" }), HttpStatusCode.OK);
        RequiredTestClock.Advance(TimeSpan.FromHours(1));
        await N8AssertHeldAsync(admin, owner, workspaceId, null);
        Assert.AreEqual((false, 1, 15.00m), N8Priced((await N8DetailAsync(admin, workspaceId)).CurrentMonth));

        // August, the month it ended in, is billed held; September, the first month after, at the latest.
        RequiredTestClock.Set(new DateTimeOffset(2026, 9, 1, 0, 10, 0, TimeSpan.Zero));
        await IssueBillingAsync(new BillingMonth(2026, 8));
        Assert.AreEqual((1, 15m, 15.00m), N8Billed(await N8InvoiceAsync(admin, workspaceId, new DateOnly(2026, 8, 1))));
        Assert.AreEqual((false, 2, 21.00m), N8Priced((await N8DetailAsync(admin, workspaceId)).CurrentMonth));
        RequiredTestClock.Set(new DateTimeOffset(2026, 10, 1, 0, 10, 0, TimeSpan.Zero));
        await IssueBillingAsync(new BillingMonth(2026, 9));
        var september = await N8InvoiceAsync(admin, workspaceId, new DateOnly(2026, 9, 1));
        Assert.AreEqual((2, 21m, 21.00m), N8Billed(september));

        // A version cheaper than both is published. A void and reissue keeps each invoice's own version: a
        // first issue would bill July, a held month, at the cheaper latest, and September at the latest.
        await N8PublishPlanAsync(admin, 2, 11.5m);
        var julyAgain = await N8ReissueAsync(admin, july);
        Assert.AreEqual((1, 15m, 15.00m), N8Billed(julyAgain));
        Assert.AreEqual((2, 21m, 21.00m), N8Billed(await N8ReissueAsync(admin, september)));
        var voided = (await N8DetailAsync(admin, workspaceId)).Invoices.Single(item => item.Id == july.Id);
        Assert.AreEqual(("Void", 1, (Guid?)julyAgain.Id), (voided.Status, voided.PricePlanVersion, voided.ReplacedByInvoiceId));
    }

    [TestMethod]
    public async Task N8APlanPublishedAfterASpaceWasMarkedNeverMovesTheVersionItWasToldAndOnePublishedThatDayBeforeTheMarkIsHeld()
    {
        RequiredTestClock.Set(N8SpaceCreated);
        using var owner = CreateClient();
        var workspaceId = await RegisterCoachAsync(owner, "n8-day-owner@example.test", "Day Owner", "Day Gym");
        using var laterOwner = CreateClient();
        var laterId = await RegisterCoachAsync(laterOwner, "n8-day-later@example.test", "Later Owner", "Later Gym");
        using var admin = await SignInPlatformAdminAsync("n8-day-admin@example.test");
        RequiredTestClock.Advance(TimeSpan.FromHours(1));

        // Marked at 10:00 with today's day, under terms of 7 months: both pages say so, the admin's at version 1.
        await N8MarkAsync(admin, workspaceId, N8FoundingDay);
        await N8PublishMonthsAsync(admin, 1, 7);
        var lastDay = new DateOnly(2027, 1, 1);
        var told = new N8Hold(1, lastDay);
        await N8AssertHeldAsync(admin, owner, workspaceId, told);

        // A dearer version 2 comes late that evening: still the founding UTC day, but after the mark. The space
        // keeps the version it was told, on both pages and in what its first bill will use.
        RequiredTestClock.Set(new DateTimeOffset(2026, 6, 1, 23, 30, 0, TimeSpan.Zero));
        await N8PublishPlanAsync(admin, 1, 21m);
        await N8AssertHeldAsync(admin, owner, workspaceId, told);
        Assert.AreEqual((true, 1, 0m), N8Priced((await N8DetailAsync(admin, workspaceId)).CurrentMonth));

        // A second space marked ten minutes later with the same founding day: version 2 was out that day
        // before its mark, so version 2 is the one in force on its founding day. The first space is not moved.
        RequiredTestClock.Advance(TimeSpan.FromMinutes(10));
        await N8MarkAsync(admin, laterId, N8FoundingDay);
        var toldLater = new N8Hold(2, lastDay);
        await N8AssertHeldAsync(admin, laterOwner, laterId, toldLater);
        Assert.AreEqual((true, 2, 0m), N8Priced((await N8DetailAsync(admin, laterId)).CurrentMonth));
        await N8AssertHeldAsync(admin, owner, workspaceId, told);

        // Version 3 comes at midnight, the first instant of the next day: neither space's.
        RequiredTestClock.Set(new DateTimeOffset(2026, 6, 2, 0, 0, 0, TimeSpan.Zero));
        await N8PublishPlanAsync(admin, 2, 25m);
        await N8AssertHeldAsync(admin, owner, workspaceId, told);
        await N8AssertHeldAsync(admin, laterOwner, laterId, toldLater);

        // After the trial each is estimated, then billed, at the version it holds: $15 and $21, never the latest $25.
        RequiredTestClock.Set(new DateTimeOffset(2026, 7, 10, 9, 0, 0, TimeSpan.Zero));
        Assert.AreEqual((false, 1, 15.00m), N8Priced((await N8DetailAsync(admin, workspaceId)).CurrentMonth));
        Assert.AreEqual((false, 1, 15.00m), N8Priced((await N8BillingAsync(owner)).CurrentMonth));
        Assert.AreEqual((false, 2, 21.00m), N8Priced((await N8DetailAsync(admin, laterId)).CurrentMonth));
        RequiredTestClock.Set(new DateTimeOffset(2026, 8, 1, 0, 10, 0, TimeSpan.Zero));
        await IssueBillingAsync(new BillingMonth(2026, 7));
        Assert.AreEqual((1, 15m, 15.00m), N8Billed(await N8InvoiceAsync(admin, workspaceId, N8July)));
        Assert.AreEqual((2, 21m, 21.00m), N8Billed(await N8InvoiceAsync(admin, laterId, N8July)));
    }

    [TestMethod]
    public async Task N8WhatAFoundingOwnersSeatIncludesIsReadAgainstThePlanTheMonthIsPricedAtNotTheLatest()
    {
        RequiredTestClock.Set(N8SpaceCreated);
        using var owner = CreateClient();
        var workspaceId = await RegisterCoachAsync(owner, "n8-seat-owner@example.test", "Seat Owner", "Seat Gym");
        using var admin = await SignInPlatformAdminAsync("n8-seat-admin@example.test");
        RequiredTestClock.Advance(TimeSpan.FromHours(1));

        // Version 1's seat includes 5 clients. The founding terms: an owner's seat of 7, prices held 5 months.
        await RefreshCsrfAsync(admin);
        await AssertStatusAsync(await admin.PostAsJsonAsync(N3aTermsUrl, N3aTermsRequest(10, 2, 1, 7, 5)), HttpStatusCode.OK);

        // The day after, version 2 at version 1's own prices, its seat including 9: more than the founding 7.
        RequiredTestClock.Set(new DateTimeOffset(2026, 6, 2, 9, 0, 0, TimeSpan.Zero));
        await RefreshCsrfAsync(admin);
        await AssertStatusAsync(await admin.PostAsJsonAsync("/api/platform-admin/price-plans", N11aPlanRequest(1, 9)), HttpStatusCode.OK);

        // Marked an hour later, founding since the day before: held at version 1, the one in force on that
        // day, to 1 November. The mark's own answer reads the seat against that version's 5, so it says 7;
        // against the latest version's 9 it would say nothing.
        RequiredTestClock.Advance(TimeSpan.FromHours(1));
        await RefreshCsrfAsync(admin);
        var mark = await admin.PostAsJsonAsync(N3aMarkUrl(workspaceId), new { foundingSince = N8FoundingDay, note = "One of the first coaches" });
        await AssertStatusAsync(mark, HttpStatusCode.OK);
        Assert.AreEqual(7, (await RequiredJsonAsync<N11aFounding>(mark)).FoundingSeatIncludedClients, "The mark's answer.");
        var held = new N8Hold(1, new DateOnly(2026, 11, 1));
        await N8AssertHeldAsync(admin, owner, workspaceId, held);
        Assert.AreEqual(((int?)7, (int?)7, true, 1), await N8SeatAsync(admin, owner, workspaceId), "In the trial, on the admin's page and the owner's.");

        // Out of the trial, with no client to bill: the two versions total the same, so the held one stays in
        // use, and July's invoice counts the seat both pages named: 7, which is 2 over version 1's 5.
        RequiredTestClock.Set(new DateTimeOffset(2026, 7, 10, 9, 0, 0, TimeSpan.Zero));
        Assert.AreEqual(((int?)7, (int?)7, false, 1), await N8SeatAsync(admin, owner, workspaceId));
        RequiredTestClock.Set(new DateTimeOffset(2026, 8, 1, 0, 10, 0, TimeSpan.Zero));
        await IssueBillingAsync(new BillingMonth(2026, 7));
        var july = (await N11aDetailAsync(admin, workspaceId)).Invoices.Single(item => item.PeriodStart == N8July);
        Assert.AreEqual(
            (1, 5, (int?)7, 7, 2, 15.00m),
            (july.PricePlanVersion, july.PlanIncludedClientsPerSeat, july.FoundingSeatIncludedClients, july.Amounts.IncludedClients, july.Amounts.FoundingIncludedClients, july.Amounts.Total));

        // 15 November, after the last day and inside its month: neither page says prices are held any more,
        // but November is still priced at version 1, so the seat is still read against that version.
        RequiredTestClock.Set(new DateTimeOffset(2026, 11, 15, 9, 0, 0, TimeSpan.Zero));
        await N8AssertHeldAsync(admin, owner, workspaceId, null);
        Assert.AreEqual(((int?)7, (int?)7, false, 1), await N8SeatAsync(admin, owner, workspaceId));

        // December, past the guarantee's last month: priced at version 2, whose seat of 9 the founding 7 does
        // not raise. The status is still open, and neither page names a founding seat.
        RequiredTestClock.Set(new DateTimeOffset(2026, 12, 10, 9, 0, 0, TimeSpan.Zero));
        Assert.AreEqual(((int?)null, (int?)null, false, 2), await N8SeatAsync(admin, owner, workspaceId));
        var december = (await N11aDetailAsync(admin, workspaceId)).CurrentMonth.Amounts;
        Assert.AreEqual((9, 9, 0, 15.00m), (december.IncludedClients, december.SeatIncludedClients, december.FoundingIncludedClients, december.Total));
    }

    [TestMethod]
    public async Task N8AStatusEndedBeforeItsTrialEndsHoldsNothingOfTheMonthTheTrialEndsIn()
    {
        RequiredTestClock.Set(N8SpaceCreated);
        using var owner = CreateClient();
        var workspaceId = await RegisterCoachAsync(owner, "n8-trial-owner@example.test", "Trial Owner", "Trial Gym");
        using var admin = await SignInPlatformAdminAsync("n8-trial-admin@example.test");
        RequiredTestClock.Advance(TimeSpan.FromHours(1));

        // Created on 1 June at 09:00, the space's 30-day trial ends on 1 July at 09:00, and July is billed
        // from then. Founding since 1 June under terms of 11 months; a dearer version 2 the day after.
        var marked = await N8MarkAsync(admin, workspaceId, N8FoundingDay);
        await N8PublishMonthsAsync(admin, 1, 11);
        RequiredTestClock.Set(new DateTimeOffset(2026, 6, 2, 9, 0, 0, TimeSpan.Zero));
        await N8PublishPlanAsync(admin, 1, 21m);

        // 1 July, 05:00, four hours of trial left: the hold reaches what July will bill, so the trial names version 1.
        RequiredTestClock.Set(new DateTimeOffset(2026, 7, 1, 5, 0, 0, TimeSpan.Zero));
        await N8AssertHeldAsync(admin, owner, workspaceId, new N8Hold(1, new DateOnly(2027, 5, 1)));
        Assert.AreEqual((true, 1, 0m), N8Priced((await N8DetailAsync(admin, workspaceId)).CurrentMonth));

        // The status ends there: inside July, but before the first moment July bills. This pins a choice
        // written up for the owner: the hold is read over the billed window, not the calendar month, so a hold
        // that ended before the trial's end does not reach that month's bill, as a discount would not.
        await RefreshCsrfAsync(admin);
        await AssertStatusAsync(await admin.PostAsJsonAsync(N3aEndUrl(marked.Status.Id), new { reason = "The coach asked" }), HttpStatusCode.OK);
        RequiredTestClock.Set(new DateTimeOffset(2026, 7, 1, 6, 0, 0, TimeSpan.Zero));
        await N8AssertHeldAsync(admin, owner, workspaceId, null);
        Assert.AreEqual((true, 2, 0m), N8Priced((await N8DetailAsync(admin, workspaceId)).CurrentMonth), "Still in the trial, the first bill is now named at the latest version.");
        Assert.AreEqual((true, 2, 0m), N8Priced((await N8BillingAsync(owner)).CurrentMonth));

        // July so far, then July's invoice: version 2 at $21, though the status ended in July.
        RequiredTestClock.Set(new DateTimeOffset(2026, 7, 10, 9, 0, 0, TimeSpan.Zero));
        Assert.AreEqual((false, 2, 21.00m), N8Priced((await N8DetailAsync(admin, workspaceId)).CurrentMonth));
        RequiredTestClock.Set(new DateTimeOffset(2026, 8, 1, 0, 10, 0, TimeSpan.Zero));
        await IssueBillingAsync(new BillingMonth(2026, 7));
        Assert.AreEqual((2, 21m, 21.00m), N8Billed(await N8InvoiceAsync(admin, workspaceId, N8July)));
    }

    [TestMethod]
    public async Task N8MarkedAgainInTheMonthItsStatusEndedASpaceIsHeldByTheStatusMarkedLast()
    {
        RequiredTestClock.Set(N8SpaceCreated);
        using var owner = CreateClient();
        var workspaceId = await RegisterCoachAsync(owner, "n8-again-owner@example.test", "Again Owner", "Again Gym");
        using var admin = await SignInPlatformAdminAsync("n8-again-admin@example.test");
        RequiredTestClock.Advance(TimeSpan.FromHours(1));
        var first = await N8MarkAsync(admin, workspaceId, N8FoundingDay);
        await N8PublishMonthsAsync(admin, 1, 7);
        RequiredTestClock.Set(new DateTimeOffset(2026, 6, 2, 9, 0, 0, TimeSpan.Zero));
        await N8PublishPlanAsync(admin, 1, 21m);

        // Ended on 12 July: July, the month it ended in, is still at version 1.
        RequiredTestClock.Set(new DateTimeOffset(2026, 7, 12, 9, 0, 0, TimeSpan.Zero));
        await RefreshCsrfAsync(admin);
        await AssertStatusAsync(await admin.PostAsJsonAsync(N3aEndUrl(first.Status.Id), new { reason = "The coach asked" }), HttpStatusCode.OK);
        RequiredTestClock.Set(new DateTimeOffset(2026, 7, 15, 9, 0, 0, TimeSpan.Zero));
        Assert.AreEqual((false, 1, 15.00m), N8Priced((await N8DetailAsync(admin, workspaceId)).CurrentMonth));

        // Marked again on 20 July: version 2 is the one in force on the new founding day, and the status
        // marked last is the one that holds July, though the first still touches it.
        RequiredTestClock.Set(new DateTimeOffset(2026, 7, 20, 9, 0, 0, TimeSpan.Zero));
        await N8MarkAsync(admin, workspaceId, new DateOnly(2026, 7, 20));
        await N8AssertHeldAsync(admin, owner, workspaceId, new N8Hold(2, new DateOnly(2027, 2, 20)));
        Assert.AreEqual((false, 2, 21.00m), N8Priced((await N8DetailAsync(admin, workspaceId)).CurrentMonth));

        // A dearer version 3: July is billed at version 2, $21, neither the first status's $15 nor the latest $25.
        RequiredTestClock.Set(new DateTimeOffset(2026, 7, 25, 9, 0, 0, TimeSpan.Zero));
        await N8PublishPlanAsync(admin, 2, 25m);
        Assert.AreEqual((false, 2, 21.00m), N8Priced((await N8DetailAsync(admin, workspaceId)).CurrentMonth));
        RequiredTestClock.Set(new DateTimeOffset(2026, 8, 1, 0, 10, 0, TimeSpan.Zero));
        await IssueBillingAsync(new BillingMonth(2026, 7));
        Assert.AreEqual((2, 21m, 21.00m), N8Billed(await N8InvoiceAsync(admin, workspaceId, N8July)));
    }

    [TestMethod]
    public async Task N8TheTermsCarryTheGuaranteesMonthsRefuseThemLeftOutAndHoldNothingWithNone()
    {
        RequiredTestClock.Set(N8SpaceCreated);
        using var owner = CreateClient();
        var workspaceId = await RegisterCoachAsync(owner, "n8-terms-owner@example.test", "Terms Owner", "Terms Gym");
        using var admin = await SignInPlatformAdminAsync("n8-terms-admin@example.test");
        RequiredTestClock.Advance(TimeSpan.FromHours(1));

        var seeded = (await RequiredJsonAsync<N8Terms[]>(await admin.GetAsync(N3aTermsUrl))).Single();
        Assert.AreEqual((1, true, (int?)null), (seeded.VersionNumber, seeded.IsCurrent, seeded.PriceGuaranteeMonths), "Version 1 names no months.");

        // Left out, the months are refused rather than read as none, which would end every held price.
        await RefreshCsrfAsync(admin);
        var leftOut = await admin.PostAsJsonAsync(
            N3aTermsUrl,
            new { clientsWithActivePlan = 10, monthsSinceStart = 2, note = "No months key", expectedCurrentVersion = 1, foundingSeatIncludedClients = (int?)null });
        await AssertStatusAsync(leftOut, HttpStatusCode.BadRequest);
        var unread = await RequiredJsonAsync<N11aUnreadable>(leftOut);
        Assert.AreEqual(
            ("request_invalid", "priceGuaranteeMonths", "This request is missing priceGuaranteeMonths. Reload the page and send it again."),
            (unread.Code, unread.Field, unread.Message));

        // Out of range, they are refused by field, alone and beside the other numbers; nothing is published.
        foreach (var outOfRange in new[] { -1, 121 })
        {
            var refused = await admin.PostAsJsonAsync(N3aTermsUrl, N3aTermsRequest(10, 2, 1, null, outOfRange));
            await AssertStatusAsync(refused, HttpStatusCode.BadRequest);
            var errors = (await RequiredJsonAsync<N3aValidation>(refused)).Errors;
            Assert.AreEqual("PriceGuaranteeMonths", errors.Keys.Single());
            Assert.AreEqual(FoundingText.TermsPriceGuaranteeMonthsInvalid, errors["PriceGuaranteeMonths"].Single());
        }

        await N3aAssertInvalidAsync(
            await admin.PostAsJsonAsync(N3aTermsUrl, N3aTermsRequest(0, 25, 1, 1_001, 121)),
            "ClientsWithActivePlan",
            "MonthsSinceStart",
            "FoundingSeatIncludedClients",
            "PriceGuaranteeMonths");
        Assert.HasCount(1, await RequiredJsonAsync<N8Terms[]>(await admin.GetAsync(N3aTermsUrl)));

        // A space founding since today: under version 1, which names no months, nothing is held.
        await N8MarkAsync(admin, workspaceId, N8FoundingDay);
        await N8AssertHeldAsync(admin, owner, workspaceId, null);

        // 0 is a number, not none: held through the founding day itself. The range's far end is ten years. Each
        // version published is in force at once.
        var zero = await N8PublishMonthsAsync(admin, 1, 0);
        Assert.AreEqual((2, true, (int?)0), (zero.VersionNumber, zero.IsCurrent, zero.PriceGuaranteeMonths));
        await N8AssertHeldAsync(admin, owner, workspaceId, new N8Hold(1, N8FoundingDay));
        var most = await N8PublishMonthsAsync(admin, 2, 120);
        Assert.AreEqual((3, true, (int?)120), (most.VersionNumber, most.IsCurrent, most.PriceGuaranteeMonths));
        await N8AssertHeldAsync(admin, owner, workspaceId, new N8Hold(1, new DateOnly(2036, 6, 1)));
        var seven = await N8PublishMonthsAsync(admin, 3, 7);
        Assert.AreEqual((4, true, (int?)7), (seven.VersionNumber, seven.IsCurrent, seven.PriceGuaranteeMonths));
        var held = new N8Hold(1, new DateOnly(2027, 1, 1));
        await N8AssertHeldAsync(admin, owner, workspaceId, held);

        // Against a version the admin did not see, a publish conflicts as every terms publish does.
        await AssertBillingConflictAsync(await admin.PostAsJsonAsync(N3aTermsUrl, N3aTermsRequest(10, 2, 3, null, 11)), "founding_terms_changed");
        await N8AssertHeldAsync(admin, owner, workspaceId, held);

        // A dearer plan the day after: in July the space is at version 1, held.
        RequiredTestClock.Set(new DateTimeOffset(2026, 6, 2, 9, 0, 0, TimeSpan.Zero));
        await N8PublishPlanAsync(admin, 1, 21m);
        RequiredTestClock.Set(new DateTimeOffset(2026, 7, 10, 9, 0, 0, TimeSpan.Zero));
        Assert.AreEqual((false, 1, 15.00m), N8Priced((await N8DetailAsync(admin, workspaceId)).CurrentMonth));

        // None on purpose, the key sent as null: the hold ends with that version, and the space is estimated
        // and billed at the latest version like any other.
        var none = await N8PublishMonthsAsync(admin, 4, null);
        Assert.AreEqual((5, true, (int?)null), (none.VersionNumber, none.IsCurrent, none.PriceGuaranteeMonths));
        await N8AssertHeldAsync(admin, owner, workspaceId, null);
        Assert.AreEqual((false, 2, 21.00m), N8Priced((await N8DetailAsync(admin, workspaceId)).CurrentMonth));
        CollectionAssert.AreEqual(
            N8MonthsNewestFirst,
            (await RequiredJsonAsync<N8Terms[]>(await admin.GetAsync(N3aTermsUrl))).Select(item => item.PriceGuaranteeMonths).ToArray());
        RequiredTestClock.Set(new DateTimeOffset(2026, 8, 1, 0, 10, 0, TimeSpan.Zero));
        await IssueBillingAsync(new BillingMonth(2026, 7));
        Assert.AreEqual((2, 21m, 21.00m), N8Billed(await N8InvoiceAsync(admin, workspaceId, N8July)));
    }

    [TestMethod]
    public async Task N8OnlyTheOwnerReadsUntilWhenTheirPricesAreHeldAndOnlyThePlatformAdminTheVersion()
    {
        RequiredTestClock.Set(N8SpaceCreated);
        using var owner = CreateClient();
        var workspaceId = await RegisterCoachAsync(owner, "n8-read-owner@example.test", "Read Owner", "Read Gym");
        using var coach = CreateClient();
        await JoinAsCoachAsync(owner, coach, "n8-read-coach@example.test", "Read Coach");
        using var client = CreateClient();
        await InviteAndAcceptAsync(owner, client, "n8-read-client@example.test", true);
        using var stranger = CreateClient();
        var strangerId = await RegisterCoachAsync(stranger, "n8-read-stranger@example.test", "Stranger", "Stranger Gym");
        using var admin = await SignInPlatformAdminAsync("n8-read-admin@example.test");
        RequiredTestClock.Advance(TimeSpan.FromHours(1));
        await N8MarkAsync(admin, workspaceId, N8FoundingDay);
        await N8PublishMonthsAsync(admin, 1, 11);
        var lastDay = new DateOnly(2027, 5, 1);

        // The owner reads the day: never the version held, which is the admin's, nor the admin's note.
        var ownerRead = await owner.GetAsync("/api/billing");
        await AssertStatusAsync(ownerRead, HttpStatusCode.OK);
        Assert.AreEqual(lastDay, (await RequiredJsonAsync<N8Billing>(ownerRead)).PricesHeldUntil);
        var ownerBody = await ownerRead.Content.ReadAsStringAsync();
        Assert.DoesNotContain("priceHold", ownerBody);
        Assert.DoesNotContain("first coaches", ownerBody);

        // A coach and a client of the space never read the bill, and what a coach does read says nothing of it.
        await AssertStatusAsync(await coach.GetAsync("/api/billing"), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await client.GetAsync("/api/billing"), HttpStatusCode.Forbidden);
        var coachAccess = await coach.GetAsync("/api/billing/access");
        await AssertStatusAsync(coachAccess, HttpStatusCode.OK);
        Assert.DoesNotContain("2027-05-01", await coachAccess.Content.ReadAsStringAsync());

        // Another space's owner reads nothing held for their own space, and nothing of this one by its id.
        Assert.IsNull((await N8BillingAsync(stranger)).PricesHeldUntil);
        SetTenant(stranger, workspaceId);
        await AssertStatusAsync(await stranger.GetAsync("/api/billing"), HttpStatusCode.Forbidden);

        // The admin's page and the terms stay the platform admin's: nobody of a space reads them, and a
        // founding owner cannot publish months for their own guarantee.
        using var anonymous = CreateClient();
        await AssertStatusAsync(await anonymous.GetAsync("/api/billing"), HttpStatusCode.Unauthorized);
        await AssertStatusAsync(await anonymous.GetAsync($"/api/platform-admin/workspaces/{workspaceId}"), HttpStatusCode.Unauthorized);
        foreach (var caller in new[] { owner, coach, client, stranger })
        {
            await AssertStatusAsync(await caller.GetAsync($"/api/platform-admin/workspaces/{workspaceId}"), HttpStatusCode.Forbidden);
            await AssertStatusAsync(await caller.GetAsync(N3aTermsUrl), HttpStatusCode.Forbidden);
        }

        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(await owner.PostAsJsonAsync(N3aTermsUrl, N3aTermsRequest(10, 2, 2, null, 120)), HttpStatusCode.Forbidden);

        // The admin reads the version and the day for this space and nothing for the other, under the months
        // the admin published; and the admin is not the space's owner.
        Assert.AreEqual(new N8Hold(1, lastDay), (await N8DetailAsync(admin, workspaceId)).PriceHold);
        Assert.IsNull((await N8DetailAsync(admin, strangerId)).PriceHold);
        var terms = await RequiredJsonAsync<N8Terms[]>(await admin.GetAsync(N3aTermsUrl));
        Assert.AreEqual((2, (int?)11), (terms[0].VersionNumber, terms[0].PriceGuaranteeMonths));
        SetTenant(admin, workspaceId);
        await AssertStatusAsync(await admin.GetAsync("/api/billing"), HttpStatusCode.Forbidden);
    }

    [TestMethod]
    public async Task N8TheDatabaseKeepsTheMonthsInRangeAndAsPublishedAndTheMigrationRefusesToRevertOverThem()
    {
        RequiredTestClock.Set(N8SpaceCreated);
        using var owner = CreateClient();
        var workspaceId = await RegisterCoachAsync(owner, "n8-revert-owner@example.test", "Revert Owner", "Revert Gym");
        using var admin = await SignInPlatformAdminAsync("n8-revert-admin@example.test");
        RequiredTestClock.Advance(TimeSpan.FromHours(1));
        await N8MarkAsync(admin, workspaceId, N8FoundingDay);
        await N8PublishMonthsAsync(admin, 1, 7);
        var held = new N8Hold(1, new DateOnly(2027, 1, 1));

        // The database keeps the months in their range whoever writes them.
        foreach (var months in new[] { "-1", "121" })
        {
            var outOfRange = await A7RefusedAsync(
                $"""
                INSERT INTO billing."FoundingTerms" ("Id", "VersionNumber", "ClientsWithActivePlan", "MonthsSinceStart", "PriceGuaranteeMonths", "PublishedAtUtc")
                VALUES (gen_random_uuid(), 9, 10, 2, {months}, now())
                """);
            Assert.AreEqual(("23514", "CK_FoundingTerms_PriceGuaranteeMonths"), (outOfRange.SqlState, outOfRange.ConstraintName), months);
        }

        // A version stays as it was published: its months are never changed, taken away or added, and it is
        // never deleted.
        await AssertSqlStateAsync("55000", """UPDATE billing."FoundingTerms" SET "PriceGuaranteeMonths" = 11 WHERE "VersionNumber" = 2""");
        await AssertSqlStateAsync("55000", """UPDATE billing."FoundingTerms" SET "PriceGuaranteeMonths" = NULL WHERE "VersionNumber" = 2""");
        await AssertSqlStateAsync("55000", """UPDATE billing."FoundingTerms" SET "PriceGuaranteeMonths" = 5 WHERE "VersionNumber" = 1""");
        await AssertSqlStateAsync("55000", """DELETE FROM billing."FoundingTerms" WHERE "VersionNumber" = 2""");
        await N8AssertHeldAsync(admin, owner, workspaceId, held);

        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var migrations = context.Database.GetMigrations().ToArray();
        var migration = migrations.Single(item => item.EndsWith("_FoundingPriceGuarantee", StringComparison.Ordinal));
        var previous = migrations[Array.IndexOf(migrations, migration) - 1];
        var migrator = context.Database.GetInfrastructure().GetRequiredService<IMigrator>();

        // Published months are a promise founding spaces are billed by, so going back is a forward fix: the
        // migration stops with a plain message, drops nothing and stays applied.
        var thrown = await Assert.ThrowsAsync<Exception>(() => migrator.MigrateAsync(previous));
        var refused = thrown as PostgresException ?? thrown.InnerException as PostgresException
            ?? throw new AssertFailedException($"Expected PostgreSQL's refusal, not {thrown}");
        Assert.AreEqual(("55000", N8RevertRefusal), (refused.SqlState, refused.MessageText));
        Assert.Contains(migration, await context.Database.GetAppliedMigrationsAsync());

        // A later migration would have been taken back before this one refused: it goes back on before the API, which reads the newest model, is asked.
        await migrator.MigrateAsync();
        var current = (await RequiredJsonAsync<N8Terms[]>(await admin.GetAsync(N3aTermsUrl)))[0];
        Assert.AreEqual((2, (int?)7), (current.VersionNumber, current.PriceGuaranteeMonths));
        await N8AssertHeldAsync(admin, owner, workspaceId, held);
    }

    private static async Task<N3aAdminFounding> N8MarkAsync(HttpClient admin, Guid workspaceId, DateOnly foundingSince)
    {
        await RefreshCsrfAsync(admin);
        var response = await admin.PostAsJsonAsync(N3aMarkUrl(workspaceId), new { foundingSince, note = "One of the first coaches" });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<N3aAdminFounding>(response);
    }

    /// <summary>Publishes the next founding terms version with these months, the badge's numbers as seeded and no seat number.</summary>
    private static async Task<N8Terms> N8PublishMonthsAsync(HttpClient admin, int expectedCurrentVersion, int? months)
    {
        await RefreshCsrfAsync(admin);
        var response = await admin.PostAsJsonAsync(N3aTermsUrl, N3aTermsRequest(10, 2, expectedCurrentVersion, null, months));
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<N8Terms>(response);
    }

    /// <summary>Publishes the next price plan version: the seeded plan's terms with this seat price.</summary>
    private static async Task N8PublishPlanAsync(HttpClient admin, int expectedCurrentVersion, decimal seatPrice)
    {
        await RefreshCsrfAsync(admin);
        await AssertStatusAsync(
            await admin.PostAsJsonAsync("/api/platform-admin/price-plans", BillingPlanRequest(expectedCurrentVersion, seatPrice)),
            HttpStatusCode.OK);
    }

    /// <summary>Voids an invoice with a reissue and answers the reissued one.</summary>
    private static async Task<BillingInvoice> N8ReissueAsync(HttpClient admin, BillingInvoice invoice)
    {
        await RefreshCsrfAsync(admin);
        var response = await admin.PostAsJsonAsync($"/api/platform-admin/invoices/{invoice.Id}/void", new { reason = "Counted again", reissue = true });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        var voided = await RequiredJsonAsync<BillingVoid>(response);
        Assert.AreEqual(("Void", (Guid?)invoice.Id), (voided.Voided.Status, voided.Reissued?.ReplacesInvoiceId));
        return voided.Reissued!;
    }

    private static async Task<N8Detail> N8DetailAsync(HttpClient admin, Guid workspaceId)
    {
        var response = await admin.GetAsync($"/api/platform-admin/workspaces/{workspaceId}");
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<N8Detail>(response);
    }

    private static async Task<N8Billing> N8BillingAsync(HttpClient owner)
    {
        var response = await owner.GetAsync("/api/billing");
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<N8Billing>(response);
    }

    /// <summary>A month's first invoice for a space, as the admin reads it.</summary>
    private static async Task<BillingInvoice> N8InvoiceAsync(HttpClient admin, Guid workspaceId, DateOnly periodStart) =>
        (await N8DetailAsync(admin, workspaceId)).Invoices.Single(item => item.PeriodStart == periodStart && item.ReplacesInvoiceId is null);

    /// <summary>
    /// Both pages on the hold running today: the version and the last day to the admin, the day alone to the
    /// owner; null for neither page saying anything.
    /// </summary>
    private static async Task N8AssertHeldAsync(HttpClient admin, HttpClient owner, Guid workspaceId, N8Hold? expected)
    {
        Assert.AreEqual(expected, (await N8DetailAsync(admin, workspaceId)).PriceHold);
        Assert.AreEqual(expected?.LastDay, (await N8BillingAsync(owner)).PricesHeldUntil);
    }

    /// <summary>
    /// What an open founding status's owner seat includes now, as the admin's page and the owner's each say it,
    /// beside the version this month is priced at, which both pages must agree on.
    /// </summary>
    private static async Task<(int? Admin, int? Owner, bool InTrial, int Version)> N8SeatAsync(HttpClient admin, HttpClient owner, Guid workspaceId)
    {
        var detail = await N8DetailAsync(admin, workspaceId);
        var billing = await N8BillingAsync(owner);
        Assert.IsNotNull(detail.Founding, "The space's founding status is open.");
        Assert.AreEqual(detail.CurrentMonth, billing.CurrentMonth);
        return (detail.Founding.FoundingSeatIncludedClients, billing.FoundingSeatIncludedClients, detail.CurrentMonth.InTrial, detail.CurrentMonth.PricePlanVersion);
    }

    private static (bool InTrial, int Version, decimal Total) N8Priced(BillingEstimate estimate) =>
        (estimate.InTrial, estimate.PricePlanVersion, estimate.Amounts.Total);

    private static (int Version, decimal SeatPrice, decimal Total) N8Billed(BillingInvoice invoice) =>
        (invoice.PricePlanVersion, invoice.PlanSeatPrice, invoice.Amounts.Total);

    private sealed record N8Hold(int PricePlanVersion, DateOnly LastDay);
    private sealed record N8Detail(BillingEstimate CurrentMonth, BillingInvoice[] Invoices, N8Hold? PriceHold, N11aFounding? Founding);
    private sealed record N8Billing(BillingEstimate CurrentMonth, BillingInvoice[] Invoices, DateOnly? PricesHeldUntil, int? FoundingSeatIncludedClients);
    private sealed record N8Terms(int VersionNumber, bool IsCurrent, int? PriceGuaranteeMonths);
}
