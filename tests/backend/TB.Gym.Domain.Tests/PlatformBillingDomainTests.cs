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

    // ---- platform-invoice-v1 reference cases: v2 gives a space neither founding nor granted the same ----

    [TestMethod]
    public void ASoloCoachWithFewerThanFiveClientsPaysOneSeat()
    {
        var amounts = PlatformInvoiceCalculation.Calculate(Placeholder, new InvoiceQuantities(1, 3), IncludedClientSources.None, 0m);

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
        var amounts = PlatformInvoiceCalculation.Calculate(Placeholder, new InvoiceQuantities(1, 8), IncludedClientSources.None, 0m);

        Assert.AreEqual(3, amounts.ExtraClients);
        Assert.AreEqual(6.00m, amounts.ExtraClientAmount);
        Assert.AreEqual(0m, amounts.GymFeeAmount);
        Assert.AreEqual(21.00m, amounts.Total);
    }

    [TestMethod]
    public void AGymWithFourSeatsAndSixtyClientsPoolsIncludedClientsAndPaysTheGymFee()
    {
        var amounts = PlatformInvoiceCalculation.Calculate(Placeholder, new InvoiceQuantities(4, 60), IncludedClientSources.None, 0m);

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
        var founding = PlatformInvoiceCalculation.Calculate(Placeholder, new InvoiceQuantities(4, 60), IncludedClientSources.None, 30m);
        Assert.AreEqual(45.00m, founding.DiscountAmount);
        Assert.AreEqual(105.00m, founding.Total);

        // 33.33% of 21.00 is 6.9993: rounded half away from zero to 7.00.
        var odd = PlatformInvoiceCalculation.Calculate(Placeholder, new InvoiceQuantities(1, 8), IncludedClientSources.None, 33.33m);
        Assert.AreEqual(7.00m, odd.DiscountAmount);
        Assert.AreEqual(14.00m, odd.Total);

        var free = PlatformInvoiceCalculation.Calculate(Placeholder, new InvoiceQuantities(2, 12), IncludedClientSources.None, 100m);
        Assert.AreEqual(0m, free.Total, "Founding coaches' free months still issue an invoice, with nothing to pay.");
    }

    [TestMethod]
    public void EveryNumberComesFromThePlanNotFromCode()
    {
        var other = new PricePlanTerms("USD", 20m, 3, 1.50m, 25m, 3, 14, 10, 5);

        var twoSeats = PlatformInvoiceCalculation.Calculate(other, new InvoiceQuantities(2, 10), IncludedClientSources.None, 0m);
        Assert.AreEqual(6, twoSeats.IncludedClients);
        Assert.AreEqual(4, twoSeats.ExtraClients);
        Assert.AreEqual(40.00m + 6.00m, twoSeats.Total, "Two seats are below this plan's gym-fee threshold of three.");

        var threeSeats = PlatformInvoiceCalculation.Calculate(other, new InvoiceQuantities(3, 9), IncludedClientSources.None, 0m);
        Assert.AreEqual(60.00m + 25.00m, threeSeats.Total);
    }

    [TestMethod]
    public void TheCalculationRefusesImpossibleQuantities()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            PlatformInvoiceCalculation.Calculate(Placeholder, new InvoiceQuantities(0, 1), IncludedClientSources.None, 0m));
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            PlatformInvoiceCalculation.Calculate(Placeholder, new InvoiceQuantities(1, -1), IncludedClientSources.None, 0m));
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            PlatformInvoiceCalculation.Calculate(Placeholder, new InvoiceQuantities(1, 1), IncludedClientSources.None, 101m));
    }

    // ---- platform-invoice-v2 reference cases (notes plan N11a): the founding seat and extra included clients ----
    // Every figure here is made up: the founding number and each grant's clients and months are the admin's.

    [TestMethod]
    public void ASpaceNeitherFoundingNorGrantedGetsTheAmountsV1Gave()
    {
        foreach (var (seats, clients, percent, total) in new[] { (1, 3, 0m, 15.00m), (1, 9, 0m, 23.00m), (4, 60, 30m, 105.00m) })
        {
            var amounts = PlatformInvoiceCalculation.Calculate(Placeholder, new InvoiceQuantities(seats, clients), IncludedClientSources.None, percent);
            Assert.AreEqual(seats * 5, amounts.IncludedClients);
            Assert.AreEqual(seats * 5, amounts.SeatIncludedClients);
            Assert.AreEqual(0, amounts.FoundingIncludedClients);
            Assert.AreEqual(0, amounts.GrantedIncludedClients);
            Assert.AreEqual(total, amounts.Total);
        }
    }

    [TestMethod]
    public void AFoundingNumberAboveThePlansAddsTheDifferenceForTheOwnersSeatAlone()
    {
        var founding = Sources(new FoundingSeat(Guid.NewGuid(), 2, 12));

        var solo = PlatformInvoiceCalculation.Calculate(Placeholder, new InvoiceQuantities(1, 16), founding, 0m);
        Assert.AreEqual(5, solo.SeatIncludedClients);
        Assert.AreEqual(7, solo.FoundingIncludedClients, "12 for the founding seat, 5 of them the plan's.");
        Assert.AreEqual(12, solo.IncludedClients);
        Assert.AreEqual(4, solo.ExtraClients);
        Assert.AreEqual(23.00m, solo.Total);

        // A gym: every other seat includes the plan's number (Open 1).
        var gym = PlatformInvoiceCalculation.Calculate(Placeholder, new InvoiceQuantities(4, 40), founding, 0m);
        Assert.AreEqual(20, gym.SeatIncludedClients);
        Assert.AreEqual(7, gym.FoundingIncludedClients);
        Assert.AreEqual(27, gym.IncludedClients);
        Assert.AreEqual(13, gym.ExtraClients);
        Assert.AreEqual(60.00m + 26.00m + 10.00m, gym.Total);
    }

    [TestMethod]
    public void AFoundingNumberAtOrBelowThePlansAddsNothing()
    {
        foreach (var number in new[] { 5, 4, 0 })
        {
            var amounts = PlatformInvoiceCalculation.Calculate(
                Placeholder,
                new InvoiceQuantities(1, 9),
                Sources(new FoundingSeat(Guid.NewGuid(), 2, number)),
                0m);
            Assert.AreEqual(0, amounts.FoundingIncludedClients, $"A founding number of {number} never includes fewer than the plan's 5.");
            Assert.AreEqual(5, amounts.IncludedClients);
            Assert.AreEqual(23.00m, amounts.Total);
        }

        Assert.IsNull(FoundingSeatPolicy.Raised(new FoundingSeat(Guid.NewGuid(), 2, 5), 5));
        Assert.AreEqual(12, FoundingSeatPolicy.Raised(new FoundingSeat(Guid.NewGuid(), 2, 12), 5));
        Assert.IsNull(FoundingSeatPolicy.Raised(null, 5));
    }

    [TestMethod]
    public void GrantsTouchingAMonthAddTheirClientsAndAddUp()
    {
        var july = Grant(4, new DateOnly(2026, 7, 1), new DateOnly(2026, 10, 1));
        var september = Grant(7, new DateOnly(2026, 9, 1), new DateOnly(2027, 1, 1));
        var sources = IncludedClientSources.For([], [], [july, september], Whole(September), September.EndUtc);

        CollectionAssert.AreEqual(new[] { july.Id, september.Id }, sources.Grants.Select(grant => grant.Id).ToArray());
        Assert.AreEqual(11, sources.GrantedIncludedClients);
        var amounts = PlatformInvoiceCalculation.Calculate(Placeholder, new InvoiceQuantities(1, 20), sources, 0m);
        Assert.AreEqual(11, amounts.GrantedIncludedClients);
        Assert.AreEqual(16, amounts.IncludedClients);
        Assert.AreEqual(4, amounts.ExtraClients);
        Assert.AreEqual(15.00m + 8.00m, amounts.Total);
    }

    [TestMethod]
    public void AGrantCountsInEachWholeMonthItNamesAndNowhereElse()
    {
        var summer = Grant(4, new DateOnly(2026, 6, 1), new DateOnly(2026, 9, 1));
        foreach (var month in new[] { new BillingMonth(2026, 6), new BillingMonth(2026, 7), new BillingMonth(2026, 8) })
        {
            Assert.HasCount(1, IncludedClientGrant.Touching([summer], Whole(month)), $"{month} is one of the grant's months.");
        }

        Assert.IsEmpty(IncludedClientGrant.Touching([summer], Whole(September)), "It ends on September's first day, so September is not its month.");
        Assert.IsEmpty(IncludedClientGrant.Touching([summer], Whole(new BillingMonth(2026, 5))), "It starts after May.");

        var revoked = Grant(7, new DateOnly(2026, 9, 1), new DateOnly(2026, 12, 1));
        revoked.Revoke(AdminUserId, LaunchedAt);
        Assert.IsEmpty(IncludedClientGrant.Touching([revoked], Whole(September)), "A revoked grant counts nowhere.");
        var midJuly = new DateTimeOffset(2026, 7, 15, 0, 0, 0, TimeSpan.Zero);
        Assert.IsEmpty(IncludedClientGrant.Touching([summer], new UsageWindow(midJuly, midJuly)), "An empty window, even inside the grant, counts none.");
        Assert.Throws<InvalidOperationException>(() => revoked.Revoke(AdminUserId, LaunchedAt));
    }

    [TestMethod]
    public void AFoundingStatusTouchingTheWindowGivesItsSeatAndOneEndedBeforeItGivesNone()
    {
        var terms = new[] { Terms(1, null, LaunchedAt.AddMonths(-6)), Terms(2, 12, LaunchedAt.AddMonths(-3)) };

        var foundedMidMonth = Founding(new DateOnly(2026, 9, 15), At(9, 15, 10));
        var seat = FoundingSeatPolicy.For([foundedMidMonth], terms, Whole(September), September.EndUtc);
        Assert.AreEqual(new FoundingSeat(foundedMidMonth.Id, 2, 12), seat, "Founded on the 15th: September has the seat.");
        Assert.IsNull(FoundingSeatPolicy.For([foundedMidMonth], terms, Whole(new BillingMonth(2026, 8)), September.EndUtc));

        var endedMidMonth = Founding(new DateOnly(2026, 7, 1), At(7, 1, 9));
        endedMidMonth.End("The coach asked", AdminUserId, At(9, 20, 12));
        Assert.AreEqual(12, FoundingSeatPolicy.For([endedMidMonth], terms, Whole(September), September.EndUtc)?.IncludedClients,
            "Ended on the 20th: September keeps the seat (Open 3).");
        Assert.IsNull(FoundingSeatPolicy.For([endedMidMonth], terms, Whole(new BillingMonth(2026, 10)), At(11, 1, 0)),
            "From the month after the end, none.");
        Assert.IsNull(FoundingSeatPolicy.Now([endedMidMonth], terms, At(9, 25, 0)), "An ended status has no seat now.");
    }

    [TestMethod]
    public void AFoundingSpaceKeepsTheHighestNumberItHasHadWhileItsStatusStaysOpen()
    {
        var status = Founding(new DateOnly(2026, 8, 1), At(8, 1, 9));
        var raised = Terms(2, 12, At(8, 10, 0));
        var lowered = Terms(3, 9, At(9, 5, 0));
        var none = Terms(4, null, At(9, 10, 0));
        var versions = new[] { Terms(1, null, LaunchedAt.AddMonths(-6)), raised, lowered, none };

        Assert.IsNull(FoundingSeatPolicy.For([status], versions, Whole(new BillingMonth(2026, 8)), At(8, 5, 0)),
            "Read before any number was published: none.");
        Assert.AreEqual(new FoundingSeat(status.Id, 2, 12), FoundingSeatPolicy.For([status], versions, Whole(September), September.EndUtc),
            "A lower number, then none, never take clients from an open status (Open 5).");

        var higher = Terms(5, 17, At(9, 20, 0));
        Assert.AreEqual(new FoundingSeat(status.Id, 5, 17), FoundingSeatPolicy.For([status], [.. versions, higher], Whole(September), September.EndUtc),
            "A higher number applies from the next reading.");
        Assert.AreEqual(12, FoundingSeatPolicy.For([status], [.. versions, higher], Whole(September), At(9, 19, 0))?.IncludedClients,
            "A version published after the reading does not count.");

        // A space marked after the higher number was replaced has only what was in force since its founding day.
        var later = Founding(new DateOnly(2026, 9, 6), At(9, 6, 9));
        Assert.AreEqual(new FoundingSeat(later.Id, 3, 9), FoundingSeatPolicy.For([later], versions, Whole(September), September.EndUtc));
        var ended = Founding(new DateOnly(2026, 8, 1), At(8, 1, 9));
        ended.End("Harm to clients", AdminUserId, At(8, 20, 0));
        Assert.AreEqual(12, FoundingSeatPolicy.For([ended], [.. versions, higher], Whole(new BillingMonth(2026, 8)), September.EndUtc)?.IncludedClients,
            "A version published after the status ended is not one it had.");
    }

    [TestMethod]
    public void TheDiscountStillComesOffTheWholeSubtotalAfterTheIncludedClients()
    {
        var sources = new IncludedClientSources(
            new FoundingSeat(Guid.NewGuid(), 2, 9),
            [Grant(4, new DateOnly(2026, 7, 1), new DateOnly(2026, 10, 1)), Grant(7, new DateOnly(2026, 9, 1), new DateOnly(2027, 1, 1))]);

        var amounts = PlatformInvoiceCalculation.Calculate(Placeholder, new InvoiceQuantities(2, 30), sources, 33.33m);

        Assert.AreEqual(10, amounts.SeatIncludedClients);
        Assert.AreEqual(4, amounts.FoundingIncludedClients);
        Assert.AreEqual(11, amounts.GrantedIncludedClients);
        Assert.AreEqual(25, amounts.IncludedClients);
        Assert.AreEqual(5, amounts.ExtraClients);
        Assert.AreEqual(50.00m, amounts.Subtotal, "$30 of seats, $10 of extra clients, the $10 gym fee.");
        Assert.AreEqual(16.67m, amounts.DiscountAmount, "16.665 rounds half away from zero, never to the even 16.66.");
        Assert.AreEqual(33.33m, amounts.Total);
    }

    [TestMethod]
    public void EveryIncludedClientComesFromThePlanTheTermsOrAGrantNotFromCode()
    {
        var other = new PricePlanTerms("USD", 20m, 3, 1.50m, 25m, 3, 14, 10, 5);
        var grant = Grant(4, new DateOnly(2026, 9, 1), new DateOnly(2026, 12, 1));

        var nine = PlatformInvoiceCalculation.Calculate(other, new InvoiceQuantities(2, 20), new IncludedClientSources(new FoundingSeat(Guid.NewGuid(), 2, 9), [grant]), 0m);
        Assert.AreEqual(6 + 6 + 4, nine.IncludedClients);
        Assert.AreEqual(40.00m + 6.00m, nine.Total);

        var twelve = PlatformInvoiceCalculation.Calculate(other, new InvoiceQuantities(2, 20), new IncludedClientSources(new FoundingSeat(Guid.NewGuid(), 3, 12), [grant]), 0m);
        Assert.AreEqual(9, twelve.FoundingIncludedClients);
        Assert.AreEqual(40.00m + 1.50m, twelve.Total);

        var bigger = Grant(7, new DateOnly(2026, 9, 1), new DateOnly(2026, 12, 1));
        var granted = PlatformInvoiceCalculation.Calculate(other, new InvoiceQuantities(2, 20), Sources(null, bigger), 0m);
        Assert.AreEqual(6 + 7, granted.IncludedClients);
        Assert.AreEqual(40.00m + 10.50m, granted.Total);
    }

    [TestMethod]
    public void AnInvoiceRecordsWhereItsIncludedClientsCameFrom()
    {
        var plan = PlatformPricePlan.Publish(1, Placeholder, null, null, LaunchedAt);
        var status = Founding(new DateOnly(2026, 8, 1), At(8, 1, 9));
        var first = Grant(4, new DateOnly(2026, 7, 1), new DateOnly(2026, 10, 1));
        var second = Grant(7, new DateOnly(2026, 9, 1), new DateOnly(2027, 1, 1));
        var sources = IncludedClientSources.For([status], [Terms(1, null, LaunchedAt.AddMonths(-6)), Terms(2, 12, At(8, 10, 0))], [second, first], Whole(September), September.EndUtc);
        var amounts = PlatformInvoiceCalculation.Calculate(plan.Terms, new InvoiceQuantities(1, 30), sources, 0m);

        var invoice = PlatformInvoice.Issue(TenantId, September, September.StartUtc, plan, amounts, null, sources, "TBG-202609-NKKAAA", September.EndUtc);

        Assert.AreEqual("platform-invoice-v2", invoice.CalculationName);
        Assert.AreEqual(12, invoice.FoundingSeatIncludedClients);
        Assert.AreEqual(2, invoice.FoundingTermsVersion);
        Assert.AreEqual(status.Id, invoice.FoundingStatusId);
        Assert.AreEqual(11, invoice.GrantedIncludedClients);
        CollectionAssert.AreEqual(new[] { first.Id, second.Id }, invoice.IncludedClientGrantIds, "Oldest first.");
        Assert.AreEqual(5 + 7 + 11, invoice.IncludedClients);
        Assert.AreEqual(7, invoice.ExtraClients);

        var plain = PlatformInvoice.Issue(
            TenantId,
            September,
            September.StartUtc,
            plan,
            PlatformInvoiceCalculation.Calculate(plan.Terms, new InvoiceQuantities(1, 30), IncludedClientSources.None, 0m),
            null,
            IncludedClientSources.None,
            "TBG-202609-NKKAAB",
            September.EndUtc);
        Assert.IsNull(plain.FoundingSeatIncludedClients);
        Assert.IsNull(plain.FoundingTermsVersion);
        Assert.IsNull(plain.FoundingStatusId);
        Assert.AreEqual(0, plain.GrantedIncludedClients);
        Assert.IsEmpty(plain.IncludedClientGrantIds);

        // The snapshot must explain the amounts: amounts worked out without the grants are refused with them.
        var withoutGrants = PlatformInvoiceCalculation.Calculate(plan.Terms, new InvoiceQuantities(1, 30), IncludedClientSources.None, 0m);
        Assert.Throws<InvalidOperationException>(() =>
            PlatformInvoice.Issue(TenantId, September, September.StartUtc, plan, withoutGrants, null, sources, "TBG-202609-NKKAAC", September.EndUtc));
    }

    [TestMethod]
    public void AGrantIsWholeClientsForWholeMonthsWithANote()
    {
        var start = new DateOnly(2026, 9, 1);
        var end = new DateOnly(2026, 12, 1);
        Assert.IsEmpty(IncludedClientGrant.Validate(1, start, end, "x"));
        Assert.IsEmpty(IncludedClientGrant.Validate(1_000, start, end, new string('n', 200)));

        Assert.AreEqual("Clients", OnlyRefusal(0, start, end, "Brought a coach"));
        Assert.AreEqual("Clients", OnlyRefusal(1_001, start, end, "Brought a coach"));
        Assert.AreEqual("StartsOn", OnlyRefusal(4, new DateOnly(2026, 9, 2), end, "Brought a coach"));
        Assert.AreEqual("StartsOn", OnlyRefusal(4, default, end, "Brought a coach"), "A day left out reads as 1 January of year 1, which is refused.");
        Assert.AreEqual("EndsOnExclusive", OnlyRefusal(4, start, new DateOnly(2026, 11, 30), "Brought a coach"));
        Assert.AreEqual("EndsOnExclusive", OnlyRefusal(4, start, start, "Brought a coach"));
        Assert.AreEqual("EndsOnExclusive", OnlyRefusal(4, start, new DateOnly(2026, 8, 1), "Brought a coach"));
        Assert.AreEqual("Note", OnlyRefusal(4, start, end, "  "));
        Assert.AreEqual("Note", OnlyRefusal(4, start, end, new string('n', 201)));

        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => IncludedClientGrant.Grant(TenantId, 0, start, end, "x", AdminUserId, LaunchedAt));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => IncludedClientGrant.Grant(TenantId, 4, new DateOnly(2026, 9, 15), end, "x", AdminUserId, LaunchedAt));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => IncludedClientGrant.Grant(TenantId, 4, start, new DateOnly(2026, 12, 31), "x", AdminUserId, LaunchedAt));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => IncludedClientGrant.Grant(TenantId, 4, end, start, "x", AdminUserId, LaunchedAt));
        Assert.ThrowsExactly<ArgumentException>(() => IncludedClientGrant.Grant(TenantId, 4, start, end, " ", AdminUserId, LaunchedAt));
        Assert.ThrowsExactly<ArgumentException>(() => IncludedClientGrant.Grant(TenantId, 4, start, end, new string('n', 201), AdminUserId, LaunchedAt));
        Assert.ThrowsExactly<ArgumentException>(() => IncludedClientGrant.Grant(Guid.Empty, 4, start, end, "x", AdminUserId, LaunchedAt));

        var grant = IncludedClientGrant.Grant(TenantId, 4, start, end, "  Brought a coach  ", AdminUserId, LaunchedAt);
        Assert.AreEqual("Brought a coach", grant.Note);
        Assert.IsTrue(grant.IsSameGrantAs(4, start, end, " Brought a coach "));
        Assert.IsFalse(grant.IsSameGrantAs(7, start, end, "Brought a coach"));
        Assert.ThrowsExactly<ArgumentException>(() => grant.Revoke(Guid.Empty, LaunchedAt));
        grant.Revoke(AdminUserId, LaunchedAt);
        Assert.IsFalse(grant.IsSameGrantAs(4, start, end, "Brought a coach"), "A revoked grant is no longer the one a repeat answers.");
        Assert.ThrowsExactly<InvalidOperationException>(() => grant.Revoke(AdminUserId, LaunchedAt));
    }

    [TestMethod]
    public void AFoundingNumberIsAWholeNumberFromZeroToOneThousandOrNone()
    {
        Assert.IsTrue(FoundingSeatPolicy.IsValidIncludedClients(null));
        Assert.IsTrue(FoundingSeatPolicy.IsValidIncludedClients(0));
        Assert.IsTrue(FoundingSeatPolicy.IsValidIncludedClients(1_000));
        Assert.IsFalse(FoundingSeatPolicy.IsValidIncludedClients(-1));
        Assert.IsFalse(FoundingSeatPolicy.IsValidIncludedClients(1_001));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() =>
            FoundingTerms.Publish(2, new FoundingBadgeTerms(8, 1), -1, null, AdminUserId, LaunchedAt));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() =>
            FoundingTerms.Publish(2, new FoundingBadgeTerms(8, 1), 1_001, null, AdminUserId, LaunchedAt));
        Assert.AreEqual(12, FoundingTerms.Publish(2, new FoundingBadgeTerms(8, 1), 12, null, AdminUserId, LaunchedAt).FoundingSeatIncludedClients);
        Assert.IsNull(FoundingTerms.Publish(2, new FoundingBadgeTerms(8, 1), null, null, AdminUserId, LaunchedAt).FoundingSeatIncludedClients);
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() =>
            PlatformInvoiceCalculation.Calculate(Placeholder, new InvoiceQuantities(1, 1), Sources(new FoundingSeat(Guid.NewGuid(), 2, 1_001)), 0m));
    }

    [TestMethod]
    public void TheOwnerReadsTheGrantsStillRunningOrToComeOldestFirst()
    {
        var today = new DateOnly(2026, 11, 10);
        var ended = Grant(4, new DateOnly(2026, 7, 1), new DateOnly(2026, 11, 1));
        var running = Grant(7, new DateOnly(2026, 11, 1), new DateOnly(2027, 2, 1));
        var coming = Grant(4, new DateOnly(2027, 3, 1), new DateOnly(2027, 6, 1));
        var revoked = Grant(7, new DateOnly(2027, 1, 1), new DateOnly(2027, 4, 1));
        revoked.Revoke(AdminUserId, LaunchedAt);

        CollectionAssert.AreEqual(
            new[] { running.Id, coming.Id },
            IncludedClientGrant.RunningOrToCome([coming, revoked, ended, running], today).Select(grant => grant.Id).ToArray());
    }

    private static string OnlyRefusal(int clients, DateOnly startsOn, DateOnly endsOnExclusive, string note) =>
        IncludedClientGrant.Validate(clients, startsOn, endsOnExclusive, note).Keys.Single();

    private static IncludedClientSources Sources(FoundingSeat? seat, params IncludedClientGrant[] grants) => new(seat, grants);

    private static IncludedClientGrant Grant(int clients, DateOnly startsOn, DateOnly endsOnExclusive) =>
        IncludedClientGrant.Grant(TenantId, clients, startsOn, endsOnExclusive, $"Brought a coach ({clients})", AdminUserId, LaunchedAt);

    private static FoundingTerms Terms(int version, int? seatIncludedClients, DateTimeOffset publishedAt) =>
        FoundingTerms.Publish(version, new FoundingBadgeTerms(8, 1), seatIncludedClients, null, AdminUserId, publishedAt);

    private static FoundingStatus Founding(DateOnly foundingSince, DateTimeOffset markedAt) =>
        FoundingStatus.Mark(TenantId, foundingSince, "One of the first coaches", AdminUserId, markedAt);

    private static UsageWindow Whole(BillingMonth month) => new(month.StartUtc, month.EndUtc);

    private static DateTimeOffset At(int month, int day, int hour) => new(2026, month, day, hour, 0, 0, TimeSpan.Zero);

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
        var amounts = PlatformInvoiceCalculation.Calculate(plan.Terms, new InvoiceQuantities(2, 12), IncludedClientSources.None, 0m);

        var invoice = PlatformInvoice.Issue(TenantId, September, September.StartUtc, plan, amounts, null, IncludedClientSources.None, "TBG-202609-ABCDEF", issuedAt);

        Assert.AreEqual(new DateOnly(2026, 10, 8), invoice.DueOn);
        Assert.AreEqual(new DateOnly(2026, 10, 15), invoice.ReadOnlyFrom);
        Assert.AreEqual(15m, invoice.PlanSeatPrice);
        Assert.AreEqual(1, invoice.PricePlanVersion);
        Assert.AreEqual(44.00m, invoice.Total);
        Assert.Throws<InvalidOperationException>(() =>
            PlatformInvoice.Issue(TenantId, September, September.StartUtc, plan, amounts, null, IncludedClientSources.None, "TBG-202609-ABCDEG", September.EndUtc.AddTicks(-1)));
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
        var amounts = PlatformInvoiceCalculation.Calculate(plan.Terms, new InvoiceQuantities(1, 8), IncludedClientSources.None, 0m);
        var invoice = PlatformInvoice.Issue(TenantId, September, September.StartUtc, plan, amounts, null, IncludedClientSources.None, "TBG-202609-ABCDEF", September.EndUtc);

        Assert.Throws<ArgumentException>(() =>
            PlatformPayment.Record(invoice, 20m, "WH-1", null, new DateOnly(2026, 10, 2), AdminUserId, September.EndUtc));
        var payment = PlatformPayment.Record(invoice, 21m, " WH-1 ", null, new DateOnly(2026, 10, 2), AdminUserId, September.EndUtc);
        Assert.AreEqual("WH-1", payment.Reference);
        Assert.AreEqual("USD", payment.CurrencyCode);
    }

    [TestMethod]
    public void APaymentIsDatedFromTheDayItsInvoiceWasIssuedUpToTheDayItIsRecorded()
    {
        var issued = new DateTimeOffset(2026, 10, 1, 0, 10, 0, TimeSpan.Zero);
        var recorded = new DateTimeOffset(2026, 10, 5, 23, 59, 0, TimeSpan.Zero);

        Assert.IsTrue(PaymentSchedule.IsValidReceivedOn(new DateOnly(2026, 10, 1), issued, recorded), "The day it was issued.");
        Assert.IsTrue(PaymentSchedule.IsValidReceivedOn(new DateOnly(2026, 10, 3), issued, recorded));
        Assert.IsTrue(PaymentSchedule.IsValidReceivedOn(new DateOnly(2026, 10, 5), issued, recorded), "The day it is recorded.");
        Assert.IsFalse(PaymentSchedule.IsValidReceivedOn(new DateOnly(2026, 9, 30), issued, recorded), "Before the invoice existed.");
        Assert.IsFalse(PaymentSchedule.IsValidReceivedOn(new DateOnly(2026, 10, 6), issued, recorded), "Money cannot arrive tomorrow.");

        // Days are UTC days: an invoice issued just before midnight UTC counts from that day.
        var lateIssue = new DateTimeOffset(2026, 10, 1, 23, 50, 0, TimeSpan.FromHours(-3));
        Assert.IsTrue(PaymentSchedule.IsValidReceivedOn(new DateOnly(2026, 10, 2), lateIssue, recorded));
        Assert.IsFalse(PaymentSchedule.IsValidReceivedOn(new DateOnly(2026, 10, 1), lateIssue, recorded));
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
    public void TheOwnersPageNamesTheUnrevokedDiscountsStillRunningOrToComeOldestFirst()
    {
        var today = new DateOnly(2026, 11, 10);
        var endedYesterday = WorkspaceDiscount.Grant(TenantId, 20m, new(2026, 10, 1), today, "Ended", AdminUserId, LaunchedAt);
        var lastDayToday = WorkspaceDiscount.Grant(TenantId, 100m, today, today.AddDays(1), "Free start", AdminUserId, LaunchedAt);
        var next = WorkspaceDiscount.Grant(TenantId, 35m, today.AddDays(1), new(2027, 3, 1), "Next", AdminUserId, LaunchedAt);
        var later = WorkspaceDiscount.Grant(TenantId, 12.5m, new(2027, 3, 1), new(2027, 6, 1), "Later", AdminUserId, LaunchedAt);
        var revoked = WorkspaceDiscount.Grant(TenantId, 10m, new(2027, 6, 1), new(2027, 7, 1), "Revoked", AdminUserId, LaunchedAt);
        revoked.Revoke(AdminUserId, LaunchedAt);

        var shown = WorkspaceDiscount.RunningOrToCome([later, revoked, endedYesterday, next, lastDayToday], today);

        CollectionAssert.AreEqual(new[] { lastDayToday, next, later }, shown.ToArray(), "Oldest first, the one whose last day is today still running.");
        Assert.IsEmpty(WorkspaceDiscount.RunningOrToCome([endedYesterday, revoked], today), "Ended and revoked ones are not named.");
        CollectionAssert.AreEqual(new[] { later }, WorkspaceDiscount.RunningOrToCome([later, next, lastDayToday], new(2027, 3, 1)).ToArray());
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
