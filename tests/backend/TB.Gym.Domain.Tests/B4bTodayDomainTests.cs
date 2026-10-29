using System.Globalization;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.SharedKernel;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// Critique B4b, Coach Today: money received v1 (SUB-016), what This month counts and for whom, and the rules of the
/// two plan lists (CLI-020). The workspace keeps Beirut's time, three hours ahead of UTC until 25 Oct 2026 and two
/// after; its clocks skipped midnight on 29 Mar 2026 and passed 23:00 to midnight twice on 24 Oct 2026.
/// </summary>
[TestClass]
public sealed class B4bTodayDomainTests
{
    private static readonly TimeZoneInfo Beirut = TimeZoneInfo.FindSystemTimeZoneById("Asia/Beirut");
    private static readonly Guid Owner = new("00000000-0000-0000-0000-00000000000a");
    private static readonly Guid Lea = new("00000000-0000-0000-0000-00000000000b");
    private static readonly Guid Omar = new("00000000-0000-0000-0000-00000000000c");
    private static readonly DateOnly October = new(2026, 10, 1);
    private static readonly DateOnly November = new(2026, 11, 1);

    [TestMethod]
    public void TheRuleIsNamedAndVersioned() =>
        Assert.AreEqual(("MoneyReceived", 1), (MoneyReceivedPolicy.Key, MoneyReceivedPolicy.Version));

    [TestMethod]
    public void TheMonthIsTheWorkspacesCalendarMonthHoldingToday()
    {
        Assert.AreEqual((October, November), MoneyReceivedPolicy.MonthOf(new DateOnly(2026, 10, 29)));
        Assert.AreEqual((October, November), MoneyReceivedPolicy.MonthOf(October), "Its first day.");
        Assert.AreEqual((October, November), MoneyReceivedPolicy.MonthOf(new DateOnly(2026, 10, 31)), "Its last day.");
        Assert.AreEqual((new DateOnly(2026, 12, 1), new DateOnly(2027, 1, 1)), MoneyReceivedPolicy.MonthOf(new DateOnly(2026, 12, 31)));
        Assert.AreEqual((new DateOnly(2028, 2, 1), new DateOnly(2028, 3, 1)), MoneyReceivedPolicy.MonthOf(new DateOnly(2028, 2, 29)));
    }

    [TestMethod]
    public void AWorkspaceDayStartsAtItsMidnightInTheWorkspacesZone()
    {
        // October 2026 starts at UTC+3 and ends at UTC+2: one hour longer than 31 days.
        Assert.AreEqual(Utc(2026, 9, 30, 21, 0), MoneyReceivedPolicy.StartOfDayUtc(October, Beirut));
        Assert.AreEqual(Utc(2026, 10, 31, 22, 0), MoneyReceivedPolicy.StartOfDayUtc(November, Beirut));
        Assert.AreEqual(Utc(2026, 2, 28, 22, 0), MoneyReceivedPolicy.StartOfDayUtc(new DateOnly(2026, 3, 1), Beirut));
        Assert.AreEqual(Utc(2026, 3, 31, 21, 0), MoneyReceivedPolicy.StartOfDayUtc(new DateOnly(2026, 4, 1), Beirut));
        Assert.AreEqual(TimeSpan.Zero, MoneyReceivedPolicy.StartOfDayUtc(October, Beirut).Offset, "Npgsql takes UTC alone.");
    }

    [TestMethod]
    public void AMidnightTheClocksSkipOrPassTwiceNeverThrows()
    {
        // Beirut: 29 Mar 2026 had no 00:00 to 01:00, so the day began when the clocks landed on 01:00 (UTC+3); 24 Oct
        // had 23:00 to midnight twice, and 25 Oct began once, at UTC+2.
        Assert.AreEqual(Utc(2026, 3, 28, 22, 0), MoneyReceivedPolicy.StartOfDayUtc(new DateOnly(2026, 3, 29), Beirut));
        Assert.AreEqual(Utc(2026, 10, 23, 21, 0), MoneyReceivedPolicy.StartOfDayUtc(new DateOnly(2026, 10, 24), Beirut));
        Assert.AreEqual(Utc(2026, 10, 24, 22, 0), MoneyReceivedPolicy.StartOfDayUtc(new DateOnly(2026, 10, 25), Beirut));

        // A zone whose clocks move at midnight on a month's first day: forward on 1 Apr (no 00:00 to 01:00), back on
        // 1 Oct (00:00 to 01:00 twice). April begins when the clocks land, October at its first midnight.
        var zone = MidnightChangesZone();
        Assert.IsTrue(zone.IsInvalidTime(new DateTime(2026, 4, 1, 0, 0, 0)), "The test zone skips April's first midnight.");
        Assert.IsTrue(zone.IsAmbiguousTime(new DateTime(2026, 10, 1, 0, 0, 0)), "The test zone doubles October's.");
        Assert.AreEqual(Utc(2026, 3, 31, 22, 0), MoneyReceivedPolicy.StartOfDayUtc(new DateOnly(2026, 4, 1), zone));
        Assert.AreEqual(Utc(2026, 9, 30, 21, 0), MoneyReceivedPolicy.StartOfDayUtc(October, zone));

        // In that zone a receipt in either pass of October's first hour is October's, and one a second before is
        // September's.
        Assert.IsTrue(MoneyReceivedPolicy.IsReceivedIn(Utc(2026, 9, 30, 21, 30), October, November, zone), "First pass.");
        Assert.IsTrue(MoneyReceivedPolicy.IsReceivedIn(Utc(2026, 9, 30, 22, 30), October, November, zone), "Second pass.");
        Assert.IsFalse(MoneyReceivedPolicy.IsReceivedIn(Utc(2026, 9, 30, 21, 0).AddSeconds(-1), October, November, zone));
    }

    [TestMethod]
    public void TheMonthIsReadADayWiderOnEachSideAndTheRuleAloneDecidesIt()
    {
        // October in Beirut runs from 1 Oct 00:00 (UTC+3) to 1 Nov 00:00 (UTC+2); its receipts are read from 30 Sep
        // 00:00 to 2 Nov 00:00, and a receipt in the extra days counts in no October total.
        Assert.AreEqual((Utc(2026, 9, 29, 21, 0), Utc(2026, 11, 1, 22, 0)), MoneyReceivedPolicy.ReadWindowUtc(October, November, Beirut));
        Assert.IsEmpty(ReadMonth([Paid(1m, "USD", Utc(2026, 9, 30, 9, 0)), Paid(2m, "USD", Utc(2026, 11, 1, 10, 0))], October, November, Beirut));
    }

    [TestMethod]
    public void ReceiptsStampedAroundAClockChangeAtMidnightAreEachCountedInOneMonthOnly()
    {
        // A made-up zone whose clocks change at a month's first midnight: forward at 00:00 on 1 Apr (to 01:00), and back
        // at 00:30 summer time on 1 Oct, to 23:30 on 30 Sep. So 30 Sep's last half hour and 1 Oct's first both pass
        // twice, one after the other, and 30 Sep goes on after October's first midnight. Each receipt is stamped as
        // SUB-007 stamps one recorded at that moment for the workspace's today, and its amount is a power of two, so a
        // total names exactly the receipts in it.
        var zone = BackAcrossMidnightZone();
        Assert.IsTrue(zone.IsAmbiguousTime(new DateTime(2026, 9, 30, 23, 45, 0)), "The test zone repeats 30 Sep's last half hour.");
        Assert.IsTrue(zone.IsAmbiguousTime(new DateTime(2026, 10, 1, 0, 15, 0)), "And 1 Oct's first.");
        Assert.IsTrue(zone.IsInvalidTime(new DateTime(2026, 4, 1, 0, 30, 0)), "It skips 1 Apr's first hour.");

        ReceivedPayment[] autumn =
        [
            Stamped(1m, Utc(2026, 9, 30, 20, 15), zone), // 23:15 on 30 Sep, summer time
            Stamped(2m, Utc(2026, 9, 30, 20, 45), zone), // 23:45 on 30 Sep, first pass
            Stamped(4m, Utc(2026, 9, 30, 21, 0), zone), // 00:00 on 1 Oct, first pass
            Stamped(8m, Utc(2026, 9, 30, 21, 15), zone), // 00:15 on 1 Oct, first pass
            Stamped(16m, Utc(2026, 9, 30, 21, 30), zone), // 23:30 on 30 Sep again, standard time
            Stamped(32m, Utc(2026, 9, 30, 21, 59), zone), // 23:59 on 30 Sep, second pass
            Stamped(64m, Utc(2026, 9, 30, 22, 0), zone), // 00:00 on 1 Oct, second pass
            Stamped(128m, Utc(2026, 9, 30, 22, 45), zone), // 00:45 on 1 Oct, once
        ];
        Assert.AreEqual(
            "30 Sep, 30 Sep, 1 Oct, 1 Oct, 30 Sep, 30 Sep, 1 Oct, 1 Oct",
            string.Join(", ", autumn.Select(payment =>
                PaymentDay.Of(payment.ReceivedAtUtc, zone).ToString("d MMM", CultureInfo.InvariantCulture))),
            "Each receipt's workspace day.");

        // 30 Sep's second pass comes after October's first midnight, where a read ending there would have dropped it.
        Assert.IsTrue(autumn[4].ReceivedAtUtc >= MoneyReceivedPolicy.StartOfDayUtc(October, zone));
        var september = ReadMonth(autumn, new DateOnly(2026, 9, 1), October, zone);
        var october = ReadMonth(autumn, October, November, zone);
        Assert.AreEqual("USD 51.00 4", Say(september), "1 + 2 + 16 + 32: both passes of 30 Sep's last half hour.");
        Assert.AreEqual("USD 204.00 4", Say(october), "4 + 8 + 64 + 128: both passes of 1 Oct's first.");
        Assert.AreEqual((255m, 8), (september[0].Amount + october[0].Amount, september[0].PaymentCount + october[0].PaymentCount),
            "Every receipt counted once: none lost, none twice.");

        // In spring the clocks skip 1 Apr's first hour: the last minute before is March's, the moment they land April's.
        ReceivedPayment[] spring =
        [
            Stamped(1m, Utc(2026, 3, 31, 21, 30), zone), // 23:30 on 31 Mar
            Stamped(2m, Utc(2026, 3, 31, 21, 59), zone), // 23:59 on 31 Mar
            Stamped(4m, Utc(2026, 3, 31, 22, 0), zone), // 01:00 on 1 Apr, as the clocks land
            Stamped(8m, Utc(2026, 3, 31, 22, 30), zone), // 01:30 on 1 Apr
        ];
        var march = ReadMonth(spring, new DateOnly(2026, 3, 1), new DateOnly(2026, 4, 1), zone);
        var april = ReadMonth(spring, new DateOnly(2026, 4, 1), new DateOnly(2026, 5, 1), zone);
        Assert.AreEqual(("USD 3.00 2", "USD 12.00 2"), (Say(march), Say(april)));
    }

    [TestMethod]
    public void AReceiptCountsOnTheWorkspaceDayItWasReceivedNotUtcs()
    {
        // 23:30 on 30 Sep and 00:30 on 1 Oct in Beirut are both 30 Sep in UTC: the first is September's, the second
        // October's. October's first and last moments in Beirut count; the moments either side do not.
        var lastOfSeptember = Utc(2026, 9, 30, 20, 30);
        var firstOfOctober = Utc(2026, 9, 30, 21, 30);
        Assert.AreEqual((new DateOnly(2026, 9, 30), October),
            (PaymentDay.Of(lastOfSeptember, Beirut), PaymentDay.Of(firstOfOctober, Beirut)));
        Assert.AreEqual((new DateOnly(2026, 9, 30), new DateOnly(2026, 9, 30)),
            (DateOnly.FromDateTime(lastOfSeptember.UtcDateTime), DateOnly.FromDateTime(firstOfOctober.UtcDateTime)));

        var september = (new DateOnly(2026, 9, 1), October);
        Assert.AreEqual("USD 25.00 1", Say(Totals([Paid(25m, "USD", lastOfSeptember)], september)));
        Assert.AreEqual("USD 40.00 1", Say(Totals([Paid(25m, "USD", lastOfSeptember), Paid(40m, "USD", firstOfOctober)], (October, November))));

        Assert.IsTrue(MoneyReceivedPolicy.IsReceivedIn(Utc(2026, 9, 30, 21, 0), October, November, Beirut), "00:00 on 1 Oct.");
        Assert.IsTrue(MoneyReceivedPolicy.IsReceivedIn(Utc(2026, 10, 31, 21, 59), October, November, Beirut), "23:59 on 31 Oct.");
        Assert.IsFalse(MoneyReceivedPolicy.IsReceivedIn(Utc(2026, 9, 30, 20, 59), October, November, Beirut), "23:59 on 30 Sep.");
        Assert.IsFalse(MoneyReceivedPolicy.IsReceivedIn(Utc(2026, 10, 31, 22, 0), October, November, Beirut), "00:00 on 1 Nov.");
    }

    [TestMethod]
    public void MoneyIsTotalledPerCurrencyAndNeverAddedAcrossCurrencies()
    {
        // Two part payments of one plan in USD, a whole price in LBP and one in EUR: three totals in currency order,
        // each exact to the cent, each with how many payments made it up.
        var totals = Totals(
        [
            Paid(40m, "USD", Utc(2026, 10, 3, 9, 0)),
            Paid(4_500_000m, "LBP", Utc(2026, 10, 4, 9, 0)),
            Paid(60.50m, "USD", Utc(2026, 10, 12, 9, 0)),
            Paid(99.99m, "EUR", Utc(2026, 10, 20, 9, 0)),
        ]);
        Assert.AreEqual("EUR 99.99 1, LBP 4500000.00 1, USD 100.50 2", Say(totals));
        Assert.IsEmpty(Totals([]), "Nothing received: no total, in no currency.");
    }

    [TestMethod]
    public void OnlyReceiptsAreMoneyReceived()
    {
        var totals = Totals(
        [
            Paid(100m, "USD", Utc(2026, 10, 3, 9, 0)),
            Paid(30m, "USD", Utc(2026, 10, 4, 9, 0)) with { Operation = PaymentOperation.Refund },
            Paid(20m, "USD", Utc(2026, 10, 5, 9, 0)) with { Operation = PaymentOperation.Reversal },
        ]);
        Assert.AreEqual("USD 100.00 1", Say(totals), "A refund or reversal is not netted into money received.");
    }

    [TestMethod]
    public void AReceiptCountsForTheCoachTheClientHadWhenItWasReceived()
    {
        // Lea invited the client on 1 Sep; the owner moved them to Omar at 10:00 UTC on 15 Oct.
        CoachHistoryEntry[] history = [Entry(1, Lea, Utc(2026, 9, 1, 9, 0)), Entry(2, Omar, Utc(2026, 10, 15, 10, 0))];
        Assert.AreEqual(Lea, MoneyReceivedPolicy.CoachAt(Utc(2026, 10, 10, 9, 0), history));
        Assert.AreEqual(Lea, MoneyReceivedPolicy.CoachAt(Utc(2026, 10, 15, 9, 59), history), "A minute before the move.");
        Assert.AreEqual(Omar, MoneyReceivedPolicy.CoachAt(Utc(2026, 10, 15, 10, 0), history), "At the move: the new coach.");
        Assert.AreEqual(Omar, MoneyReceivedPolicy.CoachAt(Utc(2026, 10, 20, 9, 0), history));

        // So the client's October splits between them, and the owner's total holds both.
        ReceivedPayment[] october =
        [
            Paid(50m, "USD", Utc(2026, 10, 10, 9, 0), history),
            Paid(70m, "USD", Utc(2026, 10, 20, 9, 0), history),
        ];
        Assert.AreEqual("USD 50.00 1", Say(Totals(october, coach: Lea)));
        Assert.AreEqual("USD 70.00 1", Say(Totals(october, coach: Omar)));
        Assert.AreEqual("USD 120.00 2", Say(Totals(october)));
        Assert.IsEmpty(Totals(october, coach: Owner), "None of it counts for the owner as a coach.");
    }

    [TestMethod]
    public void AReceiptDatedBeforeTheClientsFirstEntryCountsForThatEntrysCoach()
    {
        // Paid on 2 Oct, the client accepted Lea's invitation on 5 Oct; one moved to the owner when assignment shipped
        // had every receipt before that dated before its first entry.
        CoachHistoryEntry[] invited = [Entry(1, Lea, Utc(2026, 10, 5, 9, 0)), Entry(2, Omar, Utc(2026, 10, 9, 9, 0))];
        Assert.AreEqual(Lea, MoneyReceivedPolicy.CoachAt(Utc(2026, 10, 2, 9, 0), invited));
        Assert.AreEqual(Owner, MoneyReceivedPolicy.CoachAt(Utc(2026, 9, 1, 9, 0), [Entry(1, Owner, Utc(2026, 9, 23, 6, 0))]));

        // The entries are read in their numbered order, whatever order they come in.
        Assert.AreEqual(Omar, MoneyReceivedPolicy.CoachAt(Utc(2026, 10, 12, 9, 0), [.. invited.Reverse()]));
    }

    [TestMethod]
    public void AReleasedClientsReceiptsStillCountForTheCoachTheyHadThen()
    {
        // Lea's client paid on 6 Oct and was released on 20 Oct, which gave them to the owner as the record's keeper.
        CoachHistoryEntry[] released = [Entry(1, Lea, Utc(2026, 9, 1, 9, 0)), Entry(2, Owner, Utc(2026, 10, 20, 9, 0))];
        ReceivedPayment[] october = [Paid(80m, "USD", Utc(2026, 10, 6, 9, 0), released)];
        Assert.AreEqual("USD 80.00 1", Say(Totals(october, coach: Lea)));
        Assert.AreEqual("USD 80.00 1", Say(Totals(october)), "The workspace's total keeps it: the money arrived.");
        Assert.IsEmpty(Totals(october, coach: Owner));
    }

    [TestMethod]
    public void AReceiptWithNoHistoryCountsOnlyInTheWorkspacesTotal()
    {
        // The database gives every client a first entry; were one missing, no coach would be credited by guess.
        ReceivedPayment[] october = [Paid(10m, "USD", Utc(2026, 10, 6, 9, 0), [])];
        Assert.IsNull(MoneyReceivedPolicy.CoachAt(Utc(2026, 10, 6, 9, 0), []));
        Assert.IsEmpty(Totals(october, coach: Lea));
        Assert.AreEqual("USD 10.00 1", Say(Totals(october)));
    }

    [TestMethod]
    public void APlanThatRanOutInTheLastThirtyDaysIsListed()
    {
        // The reference cases, in days since the plan's last day: 0 (still running) no, 1 yes, 29 yes, 30 no.
        var today = new DateOnly(2026, 10, 29);
        Assert.IsFalse(CoachAttentionPolicy.EndedLately(today, today), "A plan whose last day is today still runs.");
        Assert.IsTrue(CoachAttentionPolicy.EndedLately(today.AddDays(-1), today));
        Assert.IsTrue(CoachAttentionPolicy.EndedLately(today.AddDays(-29), today));
        Assert.IsFalse(CoachAttentionPolicy.EndedLately(today.AddDays(-30), today));
        Assert.AreEqual(today.AddDays(-29), CoachAttentionPolicy.EndedLatelyFrom(today));
    }

    [TestMethod]
    public void AClientHasLapsedWhenNothingRunsIsPausedIsPaidAndComingWasCancelledOrIsBlocked()
    {
        // SUB-014's ended plan, and one whose next plan waits for payment, which covers nothing until paid (SUB-008).
        Assert.IsTrue(CoachAttentionPolicy.IsLapsed(Decisions(FeatureAccessReason.Expired, FeatureAccessReason.NoEntitlement)));
        Assert.IsTrue(CoachAttentionPolicy.IsLapsed(Decisions(FeatureAccessReason.PaymentRequired, FeatureAccessReason.NoEntitlement)));
        Assert.IsTrue(CoachAttentionPolicy.IsLapsed(Decisions(FeatureAccessReason.Expired, FeatureAccessReason.PaymentRequired)));

        foreach (var reason in new[]
        {
            FeatureAccessReason.Granted, FeatureAccessReason.Paused, FeatureAccessReason.NotStarted,
            FeatureAccessReason.Cancelled, FeatureAccessReason.RelationshipBlocked,
        })
        {
            Assert.IsFalse(CoachAttentionPolicy.IsLapsed(Decisions(FeatureAccessReason.Expired, reason)), reason.ToString());
        }

        Assert.IsFalse(CoachAttentionPolicy.IsLapsed(Decisions(FeatureAccessReason.NoEntitlement)), "No plan ever.");
        Assert.IsFalse(CoachAttentionPolicy.IsLapsed(Decisions(FeatureAccessReason.MembershipInactive)), "A former client.");
    }

    private static IReadOnlyList<MoneyReceivedTotal> Totals(
        IEnumerable<ReceivedPayment> payments,
        (DateOnly From, DateOnly ToExclusive)? month = null,
        Guid? coach = null)
    {
        var (from, toExclusive) = month ?? (October, November);
        return MoneyReceivedPolicy.Totals(payments, from, toExclusive, Beirut, coach);
    }

    /// <summary>
    /// A month's totals as Coach Today reads them: the database keeps the receipts whose instants fall in the read
    /// window, then the rule decides which are the month's.
    /// </summary>
    private static IReadOnlyList<MoneyReceivedTotal> ReadMonth(
        IEnumerable<ReceivedPayment> payments,
        DateOnly from,
        DateOnly toExclusive,
        TimeZoneInfo zone)
    {
        var (fromUtc, toUtc) = MoneyReceivedPolicy.ReadWindowUtc(from, toExclusive, zone);
        return MoneyReceivedPolicy.Totals(
            payments.Where(payment => payment.ReceivedAtUtc >= fromUtc && payment.ReceivedAtUtc < toUtc),
            from,
            toExclusive,
            zone,
            coachUserId: null);
    }

    /// <summary>A USD receipt recorded at <paramref name="now"/> for the workspace's today, stamped as SUB-007 stamps it.</summary>
    private static ReceivedPayment Stamped(decimal amount, DateTimeOffset now, TimeZoneInfo zone)
    {
        var receivedAtUtc = PaymentDay.ReceivedAtUtc(PaymentDay.Of(now, zone), zone, now)
            ?? throw new AssertFailedException("Today is never a day still to come.");
        Assert.AreEqual(now, receivedAtUtc, "A receipt of today is stamped with the moment it is recorded.");
        return Paid(amount, "USD", receivedAtUtc);
    }

    private static string Say(IEnumerable<MoneyReceivedTotal> totals) =>
        string.Join(", ", totals.Select(total =>
            string.Create(CultureInfo.InvariantCulture, $"{total.CurrencyCode} {total.Amount:0.00} {total.PaymentCount}")));

    private static ReceivedPayment Paid(
        decimal amount,
        string currency,
        DateTimeOffset receivedAtUtc,
        IReadOnlyList<CoachHistoryEntry>? history = null) =>
        new(amount, currency, receivedAtUtc, PaymentOperation.Receipt, history ?? [Entry(1, Owner, Utc(2026, 1, 1, 9, 0))]);

    private static CoachHistoryEntry Entry(int sequence, Guid coach, DateTimeOffset assignedAtUtc) =>
        new(sequence, coach, assignedAtUtc);

    private static FeatureAccessDecision[] Decisions(params FeatureAccessReason[] reasons) =>
        [.. reasons.Select((reason, index) => new FeatureAccessDecision(
            (CoachingFeature)(index + 1), reason == FeatureAccessReason.Granted, reason))];

    private static DateTimeOffset Utc(int year, int month, int day, int hour, int minute) =>
        new(year, month, day, hour, minute, 0, TimeSpan.Zero);

    /// <summary>
    /// UTC+2, and +3 from 00:00 on 1 Apr (clocks to 01:00) until 01:00 summer time on 1 Oct (clocks back to 00:00):
    /// a month's first midnight that does not exist, and one that comes twice.
    /// </summary>
    private static TimeZoneInfo MidnightChangesZone()
    {
        var rule = TimeZoneInfo.AdjustmentRule.CreateAdjustmentRule(
            new DateTime(2000, 1, 1),
            new DateTime(2099, 12, 31),
            TimeSpan.FromHours(1),
            TimeZoneInfo.TransitionTime.CreateFixedDateRule(new DateTime(1, 1, 1, 0, 0, 0), 4, 1),
            TimeZoneInfo.TransitionTime.CreateFixedDateRule(new DateTime(1, 1, 1, 1, 0, 0), 10, 1));
        return TimeZoneInfo.CreateCustomTimeZone(
            "B4b/MidnightChanges", TimeSpan.FromHours(2), "Midnight changes", "Standard", "Summer", [rule]);
    }

    /// <summary>
    /// UTC+2, and +3 from 00:00 on 1 Apr (clocks to 01:00) until 00:30 summer time on 1 Oct (clocks back to 23:30 on
    /// 30 Sep): the clocks go back across a month's first midnight.
    /// </summary>
    private static TimeZoneInfo BackAcrossMidnightZone()
    {
        var rule = TimeZoneInfo.AdjustmentRule.CreateAdjustmentRule(
            new DateTime(2000, 1, 1),
            new DateTime(2099, 12, 31),
            TimeSpan.FromHours(1),
            TimeZoneInfo.TransitionTime.CreateFixedDateRule(new DateTime(1, 1, 1, 0, 0, 0), 4, 1),
            TimeZoneInfo.TransitionTime.CreateFixedDateRule(new DateTime(1, 1, 1, 0, 30, 0), 10, 1));
        return TimeZoneInfo.CreateCustomTimeZone(
            "B4b/BackAcrossMidnight", TimeSpan.FromHours(2), "Back across midnight", "Standard", "Summer", [rule]);
    }
}
