using TB.Gym.Modules.PlatformBilling;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// Manual platform billing (ADR 0028): the named invoice calculation and its fixed reference cases, the
/// trial, how seats and billable clients are counted, invoice status, discounts and immutable records.
/// </summary>
[TestClass]
public sealed class PlatformBillingDomainTests
{
    private static readonly Guid TenantId = Guid.Parse("10000000-0000-0000-0000-000000000028");
    private static readonly Guid AdminUserId = Guid.Parse("20000000-0000-0000-0000-000000000028");
    private static readonly DateTimeOffset LaunchedAt = new(2026, 9, 1, 0, 0, 0, TimeSpan.Zero);
    private static readonly TimeZoneInfo Beirut = TimeZoneInfo.FindSystemTimeZoneById("Asia/Beirut");
    private static readonly BillingMonth September = new(2026, 9);

    /// <summary>The seeded placeholder plan: $15 a seat with 5 clients, $2 an extra client, $10 from 2 seats.</summary>
    private static readonly PricePlanTerms Placeholder = new("USD", 15m, 5, 2m, 10m, 2, 30, 7, 7);

    private static readonly string[] ExpectedPlanErrors =
        ["CurrencyCode", "SeatPrice", "IncludedClientsPerSeat", "ExtraClientPrice", "GymFeeMinimumSeats", "TrialDays"];

    // ---- platform-invoice-v1 reference cases ----

    [TestMethod]
    public void ASoloCoachWithFewerThanFiveClientsPaysOneSeat()
    {
        var amounts = PlatformInvoiceCalculation.Calculate(Placeholder, new InvoiceQuantities(1, 3), 0m);

        Assert.AreEqual(5, amounts.IncludedClients);
        Assert.AreEqual(0, amounts.ExtraClients);
        Assert.AreEqual(15.00m, amounts.SeatAmount);
        Assert.AreEqual(0m, amounts.ExtraClientAmount);
        Assert.AreEqual(0m, amounts.GymFeeAmount);
        Assert.AreEqual(15.00m, amounts.Total);
    }

    [TestMethod]
    public void ASoloCoachWithMoreThanFiveClientsPaysForEachExtraClient()
    {
        var amounts = PlatformInvoiceCalculation.Calculate(Placeholder, new InvoiceQuantities(1, 8), 0m);

        Assert.AreEqual(3, amounts.ExtraClients);
        Assert.AreEqual(6.00m, amounts.ExtraClientAmount);
        Assert.AreEqual(0m, amounts.GymFeeAmount);
        Assert.AreEqual(21.00m, amounts.Total);
    }

    [TestMethod]
    public void AGymWithFourSeatsAndSixtyClientsPoolsIncludedClientsAndPaysTheGymFee()
    {
        var amounts = PlatformInvoiceCalculation.Calculate(Placeholder, new InvoiceQuantities(4, 60), 0m);

        Assert.AreEqual(20, amounts.IncludedClients, "5 included per seat, pooled across the workspace.");
        Assert.AreEqual(40, amounts.ExtraClients);
        Assert.AreEqual(60.00m, amounts.SeatAmount);
        Assert.AreEqual(80.00m, amounts.ExtraClientAmount);
        Assert.AreEqual(10.00m, amounts.GymFeeAmount);
        Assert.AreEqual(150.00m, amounts.Subtotal);
        Assert.AreEqual(150.00m, amounts.Total);
    }

    [TestMethod]
    public void ADiscountComesOffTheSubtotalRoundedToTheCent()
    {
        var founding = PlatformInvoiceCalculation.Calculate(Placeholder, new InvoiceQuantities(4, 60), 30m);
        Assert.AreEqual(45.00m, founding.DiscountAmount);
        Assert.AreEqual(105.00m, founding.Total);

        // 33.33% of 21.00 is 6.9993: rounded half away from zero to 7.00.
        var odd = PlatformInvoiceCalculation.Calculate(Placeholder, new InvoiceQuantities(1, 8), 33.33m);
        Assert.AreEqual(7.00m, odd.DiscountAmount);
        Assert.AreEqual(14.00m, odd.Total);

        var free = PlatformInvoiceCalculation.Calculate(Placeholder, new InvoiceQuantities(2, 12), 100m);
        Assert.AreEqual(0m, free.Total, "Founding coaches' free months still issue an invoice, with nothing to pay.");
    }

    [TestMethod]
    public void EveryNumberComesFromThePlanNotFromCode()
    {
        var other = new PricePlanTerms("USD", 20m, 3, 1.50m, 25m, 3, 14, 10, 5);

        var twoSeats = PlatformInvoiceCalculation.Calculate(other, new InvoiceQuantities(2, 10), 0m);
        Assert.AreEqual(6, twoSeats.IncludedClients);
        Assert.AreEqual(4, twoSeats.ExtraClients);
        Assert.AreEqual(40.00m + 6.00m, twoSeats.Total, "Two seats are below this plan's gym-fee threshold of three.");

        var threeSeats = PlatformInvoiceCalculation.Calculate(other, new InvoiceQuantities(3, 9), 0m);
        Assert.AreEqual(60.00m + 25.00m, threeSeats.Total);
    }

    [TestMethod]
    public void TheCalculationRefusesImpossibleQuantities()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            PlatformInvoiceCalculation.Calculate(Placeholder, new InvoiceQuantities(0, 1), 0m));
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            PlatformInvoiceCalculation.Calculate(Placeholder, new InvoiceQuantities(1, -1), 0m));
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            PlatformInvoiceCalculation.Calculate(Placeholder, new InvoiceQuantities(1, 1), 101m));
    }

    // ---- trial ----

    [TestMethod]
    public void AMonthInsideTheTrialHasNothingToBillAndTheMonthItEndsCountsOnlyWhatFollows()
    {
        var created = new DateTimeOffset(2026, 9, 10, 10, 0, 0, TimeSpan.Zero);
        var trialEnds = TrialPolicy.EndsAt(created, Placeholder.TrialDays);
        Assert.AreEqual(new DateTimeOffset(2026, 10, 10, 10, 0, 0, TimeSpan.Zero), trialEnds);

        Assert.IsTrue(TrialPolicy.BillableWindow(September, trialEnds).IsEmpty);
        var october = TrialPolicy.BillableWindow(new BillingMonth(2026, 10), trialEnds);
        Assert.AreEqual(trialEnds, october.Start);
        Assert.AreEqual(new DateTimeOffset(2026, 11, 1, 0, 0, 0, TimeSpan.Zero), october.End);
        var november = TrialPolicy.BillableWindow(new BillingMonth(2026, 11), trialEnds);
        Assert.AreEqual(new DateTimeOffset(2026, 11, 1, 0, 0, 0, TimeSpan.Zero), november.Start);
    }

    [TestMethod]
    public void APlanPublishedLaterNeverShortensATrialAlreadyGiven()
    {
        var first = PlatformPricePlan.Publish(1, Placeholder, null, null, LaunchedAt);
        var shorter = PlatformPricePlan.Publish(2, Placeholder with { TrialDays = 7 }, null, AdminUserId, LaunchedAt.AddDays(20));
        var plans = new[] { first, shorter };

        Assert.AreEqual(30, TrialPolicy.PlanAt(plans, LaunchedAt.AddDays(10)).TrialDays);
        Assert.AreEqual(7, TrialPolicy.PlanAt(plans, LaunchedAt.AddDays(21)).TrialDays);
        Assert.AreEqual(1, TrialPolicy.PlanAt(plans, LaunchedAt.AddYears(-1)).VersionNumber, "Older workspaces get the first plan.");
    }

    // ---- seats ----

    [TestMethod]
    public void SeatsAreTheOwnerAndEveryCoachActiveAtAnyMomentOfTheMonth()
    {
        var owner = Guid.NewGuid();
        var leftMidMonth = Guid.NewGuid();
        var leftLastMonth = Guid.NewGuid();
        var joinsNextMonth = Guid.NewGuid();
        var cameBack = Guid.NewGuid();
        var comeBackMembership = Guid.NewGuid();
        StaffStatusChange[] changes =
        [
            Change(Guid.NewGuid(), owner, true, 2026, 6, 1),
            .. Membership(leftMidMonth, (true, 9, 5), (false, 9, 20)),
            .. Membership(leftLastMonth, (true, 7, 1), (false, 8, 31)),
            .. Membership(joinsNextMonth, (true, 10, 2)),
            Change(comeBackMembership, cameBack, true, 2026, 9, 2),
            Change(comeBackMembership, cameBack, false, 2026, 9, 3),
            Change(comeBackMembership, cameBack, true, 2026, 9, 25),
        ];
        var month = new UsageWindow(September.StartUtc, September.EndUtc);

        Assert.AreEqual(3, SeatCounter.Count(changes, month), "Owner, the coach who left mid-month, and the one who came back, once.");
    }

    [TestMethod]
    public void ACoachRemovedExactlyAtTheMonthStartDoesNotCount()
    {
        var coach = Guid.NewGuid();
        var membership = Guid.NewGuid();
        var changes = new[]
        {
            Change(membership, coach, true, 2026, 8, 1),
            new StaffStatusChange(membership, coach, false, September.StartUtc),
        };

        Assert.AreEqual(0, SeatCounter.Count(changes, new UsageWindow(September.StartUtc, September.EndUtc)));
    }

    // ---- billable clients ----

    [TestMethod]
    public void AClientCountsForAnyMomentOfPaidOrFreeCoverageInTheMonth()
    {
        var month = new UsageWindow(September.StartUtc, September.EndUtc);
        var paidAugust = new DateTimeOffset(2026, 8, 20, 9, 0, 0, TimeSpan.Zero);

        Assert.IsTrue(Covered(new(2026, 8, 20), new(2026, 9, 3), paidAugust, null, month), "Coverage ending early in the month counts.");
        Assert.IsTrue(Covered(new(2026, 9, 29), new(2026, 10, 27), new DateTimeOffset(2026, 9, 29, 8, 0, 0, TimeSpan.Zero), null, month));
        Assert.IsFalse(Covered(new(2026, 9, 1), new(2026, 9, 29), null, null, month), "A plan never paid covers nothing.");
        Assert.IsFalse(Covered(new(2026, 7, 1), new(2026, 8, 31), paidAugust.AddMonths(-2), null, month), "Ended in August.");
        Assert.IsFalse(
            Covered(new(2026, 9, 1), new(2026, 9, 29), paidAugust, new DateTimeOffset(2026, 8, 25, 0, 0, 0, TimeSpan.Zero), month),
            "Cancelled before it started.");
        Assert.IsFalse(
            Covered(new(2026, 9, 1), new(2026, 9, 15), new DateTimeOffset(2026, 10, 2, 0, 0, 0, TimeSpan.Zero), null, month),
            "Paid only after its dates had passed.");
    }

    [TestMethod]
    public void CoverageStartsAtWorkspaceMidnightSoAPlanStartingOnTheFirstOfOctoberInBeirutTouchesSeptember()
    {
        var month = new UsageWindow(September.StartUtc, September.EndUtc);

        // Beirut is UTC+3 on 1 October, so the plan's first day starts at 30 September 21:00Z.
        Assert.AreEqual(
            new DateTimeOffset(2026, 9, 30, 21, 0, 0, TimeSpan.Zero),
            BillableClientCounter.WorkspaceMidnightUtc(new DateOnly(2026, 10, 1), Beirut));
        Assert.IsTrue(Covered(new(2026, 10, 1), new(2026, 10, 29), LaunchedAt, null, month));
        Assert.IsFalse(Covered(new(2026, 10, 1), new(2026, 10, 29), LaunchedAt, null, month, TimeZoneInfo.Utc));
    }

    [TestMethod]
    public void AClientWhoLeftAndCameBackIsOneBillableClient()
    {
        var person = Guid.NewGuid();
        var spans = new[]
        {
            new CoverageSpan(person, new(2026, 9, 1), new(2026, 9, 10), LaunchedAt, new DateTimeOffset(2026, 9, 8, 0, 0, 0, TimeSpan.Zero)),
            new CoverageSpan(person, new(2026, 9, 20), new(2026, 10, 18), LaunchedAt.AddDays(19), null),
            new CoverageSpan(Guid.NewGuid(), new(2026, 9, 1), new(2026, 9, 29), LaunchedAt, null),
        };

        Assert.AreEqual(2, BillableClientCounter.Count(spans, new UsageWindow(September.StartUtc, September.EndUtc), Beirut));
    }

    [TestMethod]
    public void AClientPausedForTheWholeMonthIsNotBillableButOnePausedForPartOfItIs()
    {
        var month = new UsageWindow(September.StartUtc, September.EndUtc);
        var paidAugust = new DateTimeOffset(2026, 8, 1, 9, 0, 0, TimeSpan.Zero);
        var augustTwentieth = new DateTimeOffset(2026, 8, 20, 9, 0, 0, TimeSpan.Zero);
        var septemberTenth = new DateTimeOffset(2026, 9, 10, 9, 0, 0, TimeSpan.Zero);
        var octoberSecond = new DateTimeOffset(2026, 10, 2, 9, 0, 0, TimeSpan.Zero);

        Assert.IsFalse(
            Covered(new(2026, 8, 1), new(2026, 11, 1), paidAugust, null, month, pauses: [new(augustTwentieth, DateTimeOffset.MaxValue)]),
            "Paused since August and still paused.");
        Assert.IsFalse(
            Covered(new(2026, 8, 1), new(2026, 11, 1), paidAugust, null, month, pauses: [new(augustTwentieth, octoberSecond)]),
            "Resumed only in October: September had no access.");
        Assert.IsFalse(
            Covered(new(2026, 8, 1), new(2026, 11, 1), paidAugust, null, month, pauses: [new(augustTwentieth, September.EndUtc)]),
            "Resumed exactly as October began.");
        Assert.IsFalse(
            Covered(new(2026, 8, 1), new(2026, 11, 1), paidAugust, null, month, pauses: [new(augustTwentieth, septemberTenth), new(septemberTenth, octoberSecond)]),
            "Back-to-back pauses leave no gap.");
        Assert.IsFalse(
            Covered(new(2026, 8, 1), new(2026, 11, 1), paidAugust, septemberTenth, month, pauses: [new(augustTwentieth, septemberTenth)]),
            "Cancelled while paused.");
        Assert.IsTrue(
            Covered(new(2026, 8, 1), new(2026, 11, 1), paidAugust, null, month, pauses: [new(augustTwentieth, septemberTenth)]),
            "Resumed on 10 September.");
        Assert.IsTrue(
            Covered(new(2026, 8, 1), new(2026, 11, 1), paidAugust, null, month, pauses: [new(septemberTenth, DateTimeOffset.MaxValue)]),
            "Paused on 10 September.");
        Assert.IsTrue(
            Covered(new(2026, 8, 1), new(2026, 11, 1), paidAugust, null, month, pauses: [new(augustTwentieth, septemberTenth), new(septemberTenth.AddMinutes(1), octoberSecond)]),
            "A minute of access between two pauses.");
    }

    [TestMethod]
    public void APausedPlanDoesNotHideAnotherPlanTheClientCouldUse()
    {
        var person = Guid.NewGuid();
        var spans = new[]
        {
            new CoverageSpan(person, new(2026, 8, 1), new(2026, 11, 1), LaunchedAt.AddMonths(-1), null, [new(LaunchedAt.AddDays(-5), DateTimeOffset.MaxValue)]),
            new CoverageSpan(person, new(2026, 9, 1), new(2026, 9, 29), LaunchedAt, null),
            new CoverageSpan(Guid.NewGuid(), new(2026, 8, 1), new(2026, 11, 1), LaunchedAt.AddMonths(-1), null, [new(LaunchedAt.AddDays(-5), DateTimeOffset.MaxValue)]),
        };

        Assert.AreEqual(1, BillableClientCounter.Count(spans, new UsageWindow(September.StartUtc, September.EndUtc), Beirut));
    }

    [TestMethod]
    public void EachPauseRunsFromEnteringPausedToTheNextRecordedStatus()
    {
        var enrollment = Guid.NewGuid();
        var neverPaused = Guid.NewGuid();
        DateTimeOffset On(int month, int day) => new(2026, month, day, 9, 0, 0, TimeSpan.Zero);

        var pauses = PausePeriod.FromHistory(
        [
            new(enrollment, true, On(9, 20)),
            new(enrollment, false, On(8, 1)),
            new(enrollment, true, On(8, 10)),
            new(enrollment, false, On(9, 1)),
            new(neverPaused, false, On(8, 1)),
        ]);

        CollectionAssert.AreEqual(
            new PausePeriod[] { new(On(8, 10), On(9, 1)), new(On(9, 20), DateTimeOffset.MaxValue) },
            pauses[enrollment].ToArray());
        Assert.IsEmpty(pauses[neverPaused]);
    }

    // ---- invoices, status and schedule ----

    [TestMethod]
    public void AnInvoiceSnapshotsItsPlanAndFallsDueAfterThePlansPaymentDays()
    {
        var plan = PlatformPricePlan.Publish(1, Placeholder, null, null, LaunchedAt);
        var issuedAt = new DateTimeOffset(2026, 10, 1, 0, 5, 0, TimeSpan.Zero);
        var amounts = PlatformInvoiceCalculation.Calculate(plan.Terms, new InvoiceQuantities(2, 12), 0m);

        var invoice = PlatformInvoice.Issue(TenantId, September, September.StartUtc, plan, amounts, null, "TBG-202609-ABCDEF", issuedAt);

        Assert.AreEqual(new DateOnly(2026, 10, 8), invoice.DueOn);
        Assert.AreEqual(new DateOnly(2026, 10, 15), invoice.ReadOnlyFrom);
        Assert.AreEqual(15m, invoice.PlanSeatPrice);
        Assert.AreEqual(1, invoice.PricePlanVersion);
        Assert.AreEqual(44.00m, invoice.Total);
        Assert.Throws<InvalidOperationException>(() =>
            PlatformInvoice.Issue(TenantId, September, September.StartUtc, plan, amounts, null, "TBG-202609-ABCDEG", September.EndUtc.AddTicks(-1)));
    }

    [TestMethod]
    public void AnInvoiceIsOpenUntilDueThenOverdueAndLocksTheWorkspaceAfterTheGraceDays()
    {
        var due = new DateOnly(2026, 10, 8);
        var readOnlyFrom = PaymentSchedule.ReadOnlyFrom(due, 7);

        Assert.AreEqual(PlatformInvoiceStatus.Open, PlatformInvoiceStatusPolicy.Evaluate(15m, due, false, false, due));
        Assert.AreEqual(PlatformInvoiceStatus.Overdue, PlatformInvoiceStatusPolicy.Evaluate(15m, due, false, false, due.AddDays(1)));
        Assert.IsFalse(PlatformInvoiceStatusPolicy.LocksWorkspace(15m, readOnlyFrom, false, false, due.AddDays(6)));
        Assert.IsTrue(PlatformInvoiceStatusPolicy.LocksWorkspace(15m, readOnlyFrom, false, false, due.AddDays(7)));
        Assert.IsFalse(PlatformInvoiceStatusPolicy.LocksWorkspace(15m, readOnlyFrom, false, true, due.AddDays(30)), "Paying restores access.");
        Assert.IsFalse(PlatformInvoiceStatusPolicy.LocksWorkspace(15m, readOnlyFrom, true, false, due.AddDays(30)), "A void locks nothing.");
        Assert.IsFalse(PlatformInvoiceStatusPolicy.LocksWorkspace(0m, readOnlyFrom, false, false, due.AddDays(30)));
        Assert.AreEqual(PlatformInvoiceStatus.NothingToPay, PlatformInvoiceStatusPolicy.Evaluate(0m, due, false, false, due.AddDays(30)));
        Assert.AreEqual(due.AddDays(1), PaymentSchedule.ReadOnlyFrom(due, 0), "Never read-only on the due date itself.");
    }

    [TestMethod]
    public void TheWorkspaceStatusIsTheWorstOfItsInvoicesThenTheTrial()
    {
        Assert.AreEqual(WorkspaceBillingStatus.ReadOnly, PlatformInvoiceStatusPolicy.Workspace(true, true, false));
        Assert.AreEqual(WorkspaceBillingStatus.Overdue, PlatformInvoiceStatusPolicy.Workspace(false, true, true));
        Assert.AreEqual(WorkspaceBillingStatus.Trial, PlatformInvoiceStatusPolicy.Workspace(false, false, true));
        Assert.AreEqual(WorkspaceBillingStatus.Active, PlatformInvoiceStatusPolicy.Workspace(false, false, false));
    }

    [TestMethod]
    public void APaymentMustBeExactlyTheInvoiceTotal()
    {
        var plan = PlatformPricePlan.Publish(1, Placeholder, null, null, LaunchedAt);
        var amounts = PlatformInvoiceCalculation.Calculate(plan.Terms, new InvoiceQuantities(1, 8), 0m);
        var invoice = PlatformInvoice.Issue(TenantId, September, September.StartUtc, plan, amounts, null, "TBG-202609-ABCDEF", September.EndUtc);

        Assert.Throws<ArgumentException>(() =>
            PlatformPayment.Record(invoice, 20m, "WH-1", null, new DateOnly(2026, 10, 2), AdminUserId, September.EndUtc));
        var payment = PlatformPayment.Record(invoice, 21m, " WH-1 ", null, new DateOnly(2026, 10, 2), AdminUserId, September.EndUtc);
        Assert.AreEqual("WH-1", payment.Reference);
        Assert.AreEqual("USD", payment.CurrencyCode);
    }

    // ---- discounts and plans ----

    [TestMethod]
    public void TheLargestUnrevokedDiscountTouchingTheMonthApplies()
    {
        var threeMonthsFree = WorkspaceDiscount.Grant(TenantId, 100m, new(2026, 7, 1), new(2026, 9, 15), "Founding coach", AdminUserId, LaunchedAt);
        var thirtyOff = WorkspaceDiscount.Grant(TenantId, 30m, new(2026, 9, 15), new(2027, 9, 15), "Founding coach", AdminUserId, LaunchedAt);
        var month = new UsageWindow(September.StartUtc, September.EndUtc);

        Assert.AreSame(threeMonthsFree, WorkspaceDiscount.ApplicableTo([threeMonthsFree, thirtyOff], month));
        Assert.AreSame(thirtyOff, WorkspaceDiscount.ApplicableTo(
            [threeMonthsFree, thirtyOff],
            new UsageWindow(new BillingMonth(2026, 10).StartUtc, new BillingMonth(2026, 10).EndUtc)));

        threeMonthsFree.Revoke(AdminUserId, LaunchedAt);
        Assert.AreSame(thirtyOff, WorkspaceDiscount.ApplicableTo([threeMonthsFree, thirtyOff], month));
        Assert.Throws<InvalidOperationException>(() => threeMonthsFree.Revoke(AdminUserId, LaunchedAt));
        Assert.IsNull(WorkspaceDiscount.ApplicableTo([thirtyOff], new UsageWindow(new BillingMonth(2026, 8).StartUtc, new BillingMonth(2026, 8).EndUtc)));
    }

    [TestMethod]
    public void ADiscountNeedsAPercentageAndDatesThatMakeSense()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => WorkspaceDiscount.Grant(TenantId, 0m, new(2026, 9, 1), new(2026, 10, 1), "x", AdminUserId, LaunchedAt));
        Assert.Throws<ArgumentOutOfRangeException>(() => WorkspaceDiscount.Grant(TenantId, 100.5m, new(2026, 9, 1), new(2026, 10, 1), "x", AdminUserId, LaunchedAt));
        Assert.Throws<ArgumentOutOfRangeException>(() => WorkspaceDiscount.Grant(TenantId, 12.345m, new(2026, 9, 1), new(2026, 10, 1), "x", AdminUserId, LaunchedAt));
        Assert.Throws<ArgumentOutOfRangeException>(() => WorkspaceDiscount.Grant(TenantId, 30m, new(2026, 9, 1), new(2026, 9, 1), "x", AdminUserId, LaunchedAt));
    }

    [TestMethod]
    public void APlanIsPublishableOnlyInUsdWithSensibleNumbers()
    {
        Assert.IsEmpty(Placeholder.Validate());

        var errors = new PricePlanTerms("EUR", -1m, -1, 2.005m, 10m, 0, 400, 7, 7).Validate();
        CollectionAssert.AreEquivalent(ExpectedPlanErrors, errors.Keys.ToArray());
        Assert.Throws<ArgumentException>(() => PlatformPricePlan.Publish(2, Placeholder with { SeatPrice = -5m }, null, AdminUserId, LaunchedAt));
    }

    [TestMethod]
    public void AReferenceCodeCarriesThePrefixAndTheMonth()
    {
        var code = InvoiceReference.Create("TBG", September);

        StringAssert.Matches(code, new System.Text.RegularExpressions.Regex("^TBG-202609-[2-9A-Z]{6}$"));
        Assert.IsFalse(InvoiceReference.IsValidPrefix("tbg"));
        Assert.IsFalse(InvoiceReference.IsValidPrefix("T"));
        Assert.Throws<ArgumentException>(() => InvoiceReference.Create("bad prefix", September));
    }

    [TestMethod]
    public void ABillingMonthIsAHalfOpenUtcMonth()
    {
        Assert.AreEqual(new DateTimeOffset(2026, 9, 1, 0, 0, 0, TimeSpan.Zero), September.StartUtc);
        Assert.AreEqual(new DateTimeOffset(2026, 10, 1, 0, 0, 0, TimeSpan.Zero), September.EndUtc);
        Assert.AreEqual(new BillingMonth(2026, 12), new BillingMonth(2027, 1).Previous());
        Assert.AreEqual(September, BillingMonth.Containing(new DateTimeOffset(2026, 9, 30, 23, 59, 59, TimeSpan.Zero)));
        // 1 October 01:00 in Beirut is still 30 September in UTC.
        Assert.AreEqual(September, BillingMonth.Containing(new DateTimeOffset(2026, 10, 1, 1, 0, 0, TimeSpan.FromHours(3))));
        Assert.Throws<ArgumentException>(() => BillingMonth.StartingOn(new DateOnly(2026, 9, 2)));
    }

    private static bool Covered(
        DateOnly start,
        DateOnly endExclusive,
        DateTimeOffset? activated,
        DateTimeOffset? cancelled,
        UsageWindow window,
        TimeZoneInfo? timeZone = null,
        PausePeriod[]? pauses = null) =>
        BillableClientCounter.HadCoverage(
            new CoverageSpan(Guid.NewGuid(), start, endExclusive, activated, cancelled, pauses),
            window,
            timeZone ?? Beirut);

    private static StaffStatusChange Change(Guid membershipId, Guid userId, bool active, int year, int month, int day) =>
        new(membershipId, userId, active, new DateTimeOffset(year, month, day, 12, 0, 0, TimeSpan.Zero));

    private static StaffStatusChange[] Membership(Guid userId, params (bool Active, int Month, int Day)[] changes)
    {
        var membershipId = Guid.NewGuid();
        return changes
            .Select(change => Change(membershipId, userId, change.Active, 2026, change.Month, change.Day))
            .ToArray();
    }
}
