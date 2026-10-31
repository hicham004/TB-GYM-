using TB.Gym.Modules.Subscriptions;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// Critique B10d, the This month page: month numbers (SUB-018). Plans and packs sold, clients started and ended, and
/// who each counts for, in a workspace that keeps Beirut's time (three hours ahead of UTC until 25 Oct 2026, two after).
/// </summary>
[TestClass]
public sealed class B10dMonthNumbersDomainTests
{
    private static readonly TimeZoneInfo Beirut = TimeZoneInfo.FindSystemTimeZoneById("Asia/Beirut");
    private static readonly Guid Owner = new("00000000-0000-0000-0000-00000000000a");
    private static readonly Guid Lea = new("00000000-0000-0000-0000-00000000000b");
    private static readonly Guid Omar = new("00000000-0000-0000-0000-00000000000c");
    private static readonly Guid Maya = new("00000000-0000-0000-0000-0000000000a1");
    private static readonly Guid Rami = new("00000000-0000-0000-0000-0000000000a2");
    private static readonly DateOnly September = new(2026, 9, 1);
    private static readonly DateOnly October = new(2026, 10, 1);
    private static readonly DateOnly November = new(2026, 11, 1);
    private static readonly DateOnly Today = new(2026, 10, 20);

    [TestMethod]
    public void TheRuleIsNamedAndVersioned() =>
        Assert.AreEqual(("MonthNumbers", 2), (MonthNumbersPolicy.Key, MonthNumbersPolicy.Version));

    // ---------- sold ----------

    [TestMethod]
    public void APlanAtAPriceIsSoldTheDayItWasBookedPaidOrNotARenewalToo()
    {
        var plans = new[]
        {
            Plan(Maya, booked: Utc(2026, 10, 2, 9, 0)),
            Plan(Maya, booked: Utc(2026, 10, 3, 9, 0), paid: false),
            Plan(Rami, booked: Utc(2026, 9, 28, 9, 0)),
        };

        Assert.AreEqual(2, Numbers(plans, October, November).PlansSold);
        Assert.AreEqual(1, Numbers(plans, September, October).PlansSold);
    }

    [TestMethod]
    public void AFreePlanIsNotSoldAndAPlanCancelledWithNoMoneyWasNever()
    {
        var plans = new[]
        {
            Plan(Maya, booked: Utc(2026, 10, 2, 9, 0), price: 0m),
            Plan(Maya, booked: Utc(2026, 10, 3, 9, 0), cancelledOn: new DateOnly(2026, 10, 4)),
            Plan(Maya, booked: Utc(2026, 10, 5, 9, 0), cancelledOn: new DateOnly(2026, 10, 6), moneyReceived: true),
        };

        Assert.AreEqual(1, Numbers(plans, October, November).PlansSold, "Money kept on a cancelled plan keeps its sale.");
    }

    [TestMethod]
    public void PlansAndPacksAreCountedApartASingleSessionAPack()
    {
        var plans = new[]
        {
            Plan(Maya, booked: Utc(2026, 10, 2, 9, 0)),
            Plan(Maya, booked: Utc(2026, 10, 2, 10, 0), pack: true),
            Plan(Rami, booked: Utc(2026, 10, 2, 11, 0), pack: true),
        };

        var numbers = Numbers(plans, October, November);
        Assert.AreEqual((1, 2), (numbers.PlansSold, numbers.PacksSold));
    }

    [TestMethod]
    public void ASaleBelongsToTheWorkspaceDayItWasBooked()
    {
        // 21:30 UTC on 30 Sep is 00:30 on 1 Oct in Beirut.
        var plans = new[] { Plan(Maya, booked: Utc(2026, 9, 30, 21, 30)) };

        Assert.AreEqual(1, Numbers(plans, October, November).PlansSold);
        Assert.AreEqual(0, Numbers(plans, September, October).PlansSold);
    }

    [TestMethod]
    public void ASaleCountsForTheCoachTheClientHadWhenItWasBooked()
    {
        var history = new[]
        {
            new CoachHistoryEntry(1, Lea, Utc(2026, 8, 1, 9, 0)),
            new CoachHistoryEntry(2, Omar, Utc(2026, 10, 10, 9, 0)),
        };
        var plans = new[]
        {
            Plan(Maya, booked: Utc(2026, 10, 5, 9, 0), history: history),
            Plan(Maya, booked: Utc(2026, 10, 12, 9, 0), history: history),
        };

        Assert.AreEqual(1, Numbers(plans, October, November, coach: Lea).PlansSold);
        Assert.AreEqual(1, Numbers(plans, October, November, coach: Omar).PlansSold);
        Assert.AreEqual(0, Numbers(plans, October, November, coach: Owner).PlansSold);
        Assert.AreEqual(2, Numbers(plans, October, November).PlansSold);
    }

    // ---------- started and ended ----------

    [TestMethod]
    public void AClientStartsOnTheirFirstCoveredDayAndNotBefore()
    {
        var plans = new[]
        {
            Plan(Maya, start: new DateOnly(2026, 10, 5), end: new DateOnly(2026, 11, 2)),
            Plan(Rami, start: new DateOnly(2026, 10, 20), end: new DateOnly(2026, 11, 17)),
            Plan(Rami, start: new DateOnly(2026, 10, 21), end: new DateOnly(2026, 11, 18), pack: true),
        };

        Assert.AreEqual(2, Numbers(plans, October, November).ClientsStarted, "Today counts; a client counts once.");
        Assert.AreEqual(
            1,
            MonthNumbersPolicy.Count(Facts(plans), October, November, new DateOnly(2026, 10, 19), Beirut, null).ClientsStarted,
            "A plan starting later this month has not started.");
    }

    [TestMethod]
    public void APlanNeverPaidStartsNobodyAndEndsNobody()
    {
        var plans = new[] { Plan(Maya, start: new DateOnly(2026, 9, 5), end: new DateOnly(2026, 10, 3), paid: false) };

        Assert.IsEmpty(MonthNumbersPolicy.Stints(plans, Today));
        Assert.AreEqual((0, 0), (Numbers(plans, October, November).ClientsStarted, Numbers(plans, October, November).ClientsEnded));
    }

    [TestMethod]
    public void AClientEndsOnTheirLastCoveredDayOnceItHasPassed()
    {
        var plans = new[] { Plan(Maya, start: new DateOnly(2026, 9, 21), end: new DateOnly(2026, 10, 20)) };

        Assert.AreEqual(
            new PlanStint(new DateOnly(2026, 9, 21), new DateOnly(2026, 10, 19)),
            MonthNumbersPolicy.Stints(plans, Today).Single());
        Assert.AreEqual(1, Numbers(plans, October, November).ClientsEnded);
        Assert.AreEqual(1, Numbers(plans, September, October).ClientsStarted);

        // On its last day the plan still runs.
        var stillRunning = MonthNumbersPolicy.Stints(plans, new DateOnly(2026, 10, 19)).Single();
        Assert.IsNull(stillRunning.EndedOn);
        Assert.AreEqual(0, MonthNumbersPolicy.Count(Facts(plans), October, November, new DateOnly(2026, 10, 19), Beirut, null).ClientsEnded);
    }

    [TestMethod]
    public void AMonthEndingPlanEndsInThatMonth()
    {
        var plans = new[] { Plan(Maya, start: new DateOnly(2026, 9, 1), end: October) };

        Assert.AreEqual(1, Numbers(plans, September, October).ClientsEnded, "Its last day is 30 Sep.");
        Assert.AreEqual(0, Numbers(plans, October, November).ClientsEnded);
    }

    [TestMethod]
    public void ARenewalThatFollowsOnKeepsTheClientPaidLateIncluded()
    {
        var plans = new[]
        {
            Plan(Maya, start: new DateOnly(2026, 9, 1), end: new DateOnly(2026, 10, 1)),
            Plan(Maya, start: new DateOnly(2026, 10, 1), end: new DateOnly(2026, 10, 29)),
        };

        Assert.AreEqual(new PlanStint(new DateOnly(2026, 9, 1), null), MonthNumbersPolicy.Stints(plans, Today).Single());
        var numbers = Numbers(plans, September, October);
        Assert.AreEqual((1, 0), (numbers.ClientsStarted, numbers.ClientsEnded));
        Assert.AreEqual((0, 0), (Numbers(plans, October, November).ClientsStarted, Numbers(plans, October, November).ClientsEnded));
    }

    [TestMethod]
    public void ARenewalNotPaidYetCoversNothingSoTheClientHasEnded()
    {
        var plans = new[]
        {
            Plan(Maya, start: new DateOnly(2026, 9, 1), end: new DateOnly(2026, 10, 1)),
            Plan(Maya, start: new DateOnly(2026, 10, 1), end: new DateOnly(2026, 10, 29), paid: false),
        };

        Assert.AreEqual(1, Numbers(plans, September, October).ClientsEnded);
    }

    [TestMethod]
    public void AGapEndsOneStintAndStartsAnotherHoweverShort()
    {
        var plans = new[]
        {
            Plan(Maya, start: new DateOnly(2026, 9, 1), end: new DateOnly(2026, 10, 10)),
            Plan(Maya, start: new DateOnly(2026, 10, 12), end: new DateOnly(2026, 11, 9)),
        };

        CollectionAssert.AreEqual(
            new[]
            {
                new PlanStint(new DateOnly(2026, 9, 1), new DateOnly(2026, 10, 9)),
                new PlanStint(new DateOnly(2026, 10, 12), null),
            },
            MonthNumbersPolicy.Stints(plans, Today).ToArray());
        var numbers = Numbers(plans, October, November);
        Assert.AreEqual((1, 1), (numbers.ClientsStarted, numbers.ClientsEnded));
    }

    [TestMethod]
    public void AGapStillToComeEndsNothingYet()
    {
        var plans = new[]
        {
            Plan(Maya, start: new DateOnly(2026, 10, 1), end: new DateOnly(2026, 10, 29)),
            Plan(Maya, start: new DateOnly(2026, 11, 5), end: new DateOnly(2026, 12, 3)),
        };

        Assert.AreEqual(0, Numbers(plans, October, November).ClientsEnded);
    }

    [TestMethod]
    public void PlansSideBySideMakeOneStintEndingWithTheLast()
    {
        var plans = new[]
        {
            Plan(Maya, start: new DateOnly(2026, 9, 1), end: new DateOnly(2026, 10, 15)),
            Plan(Maya, start: new DateOnly(2026, 9, 10), end: new DateOnly(2026, 10, 1), pack: true),
            Plan(Maya, start: new DateOnly(2026, 10, 2), end: new DateOnly(2026, 10, 18), pack: true),
        };

        Assert.AreEqual(
            new PlanStint(new DateOnly(2026, 9, 1), new DateOnly(2026, 10, 17)),
            MonthNumbersPolicy.Stints(plans, Today).Single());
    }

    [TestMethod]
    public void ACancelledPlanEndsTheClientOnTheDayItWasCancelled()
    {
        var plans = new[]
        {
            Plan(Maya, start: new DateOnly(2026, 9, 1), end: new DateOnly(2026, 12, 1), cancelledOn: new DateOnly(2026, 10, 7)),
        };

        Assert.AreEqual(
            new PlanStint(new DateOnly(2026, 9, 1), new DateOnly(2026, 10, 7)),
            MonthNumbersPolicy.Stints(plans, Today).Single());
        Assert.AreEqual(1, Numbers(plans, October, November).ClientsEnded);
    }

    [TestMethod]
    public void APlanCancelledBeforeItStartedCoveredNothing()
    {
        var plans = new[]
        {
            Plan(Maya, start: new DateOnly(2026, 10, 10), end: new DateOnly(2026, 11, 7), cancelledOn: new DateOnly(2026, 10, 5)),
            Plan(Rami, start: new DateOnly(2026, 10, 10), end: new DateOnly(2026, 11, 7), cancelledOn: new DateOnly(2026, 10, 10)),
        };

        Assert.IsEmpty(MonthNumbersPolicy.Stints(plans, Today));
    }

    [TestMethod]
    public void APlanSwappedForAnotherOnTheDayItWasCancelledIsNoGap()
    {
        var plans = new[]
        {
            Plan(Maya, start: new DateOnly(2026, 9, 1), end: new DateOnly(2026, 12, 1), cancelledOn: new DateOnly(2026, 10, 7)),
            Plan(Maya, start: new DateOnly(2026, 10, 7), end: new DateOnly(2026, 11, 4)),
        };

        Assert.AreEqual(new PlanStint(new DateOnly(2026, 9, 1), null), MonthNumbersPolicy.Stints(plans, Today).Single());
    }

    [TestMethod]
    public void TheDayAPlanIsCancelledIsNotCoveredSoAReplacementTheNextDayFollowsAGap()
    {
        var plans = new[]
        {
            Plan(Maya, start: new DateOnly(2026, 9, 1), end: new DateOnly(2026, 12, 1), cancelledOn: new DateOnly(2026, 10, 7)),
            Plan(Maya, start: new DateOnly(2026, 10, 8), end: new DateOnly(2026, 11, 5)),
        };

        CollectionAssert.AreEqual(
            new[]
            {
                new PlanStint(new DateOnly(2026, 9, 1), new DateOnly(2026, 10, 7)),
                new PlanStint(new DateOnly(2026, 10, 8), null),
            },
            MonthNumbersPolicy.Stints(plans, Today).ToArray());
    }

    [TestMethod]
    public void AFreePlanCoversDaysThoughItIsNotSold()
    {
        // A goodwill pack right after a paid plan keeps the client on; a client on a free plan alone has started.
        var plans = new[]
        {
            Plan(Maya, start: new DateOnly(2026, 9, 12), end: new DateOnly(2026, 10, 10)),
            Plan(Maya, booked: Utc(2026, 10, 9, 9, 0), start: new DateOnly(2026, 10, 10), end: new DateOnly(2026, 11, 9), pack: true, price: 0m),
            Plan(Rami, booked: Utc(2026, 10, 9, 9, 0), start: new DateOnly(2026, 10, 9), end: new DateOnly(2026, 11, 8), price: 0m),
        };

        var numbers = Numbers(plans, October, November);
        Assert.AreEqual((0, 0, 1, 0), (numbers.PlansSold, numbers.PacksSold, numbers.ClientsStarted, numbers.ClientsEnded));
    }

    [TestMethod]
    public void AnEndedClientCountsForTheCoachTheyHadAsTheDayBegan()
    {
        // Ending coaching moves the client to the owner first, at 11:00 on the day their plan is cancelled.
        var history = new[]
        {
            new CoachHistoryEntry(1, Lea, Utc(2026, 8, 1, 9, 0)),
            new CoachHistoryEntry(2, Owner, Utc(2026, 10, 7, 8, 0)),
        };
        var plans = new[]
        {
            Plan(Maya, start: new DateOnly(2026, 9, 1), end: new DateOnly(2026, 12, 1), cancelledOn: new DateOnly(2026, 10, 7), history: history),
        };

        Assert.AreEqual(1, Numbers(plans, October, November, coach: Lea).ClientsEnded);
        Assert.AreEqual(0, Numbers(plans, October, November, coach: Owner).ClientsEnded);
    }

    [TestMethod]
    public void AClientStartedBeforeTheirFirstCoachCountsForThatCoach()
    {
        // The plan starts on the day they join, hours before their first history entry.
        var history = new[] { new CoachHistoryEntry(1, Lea, Utc(2026, 10, 5, 12, 0)) };
        var plans = new[] { Plan(Maya, start: new DateOnly(2026, 10, 5), end: new DateOnly(2026, 11, 2), history: history) };

        Assert.AreEqual(1, Numbers(plans, October, November, coach: Lea).ClientsStarted);
    }

    // ---------- the page's numbers together ----------

    [TestMethod]
    public void EveryRowAddsUpToTheTotalAndEachCurrencyStaysOnItsOwn()
    {
        var leas = new[] { new CoachHistoryEntry(1, Lea, Utc(2026, 8, 1, 9, 0)) };
        var omars = new[] { new CoachHistoryEntry(1, Omar, Utc(2026, 8, 1, 9, 0)) };
        var facts = new MonthFacts(
            [
                Payment(100m, "USD", Utc(2026, 10, 2, 9, 0), leas),
                Payment(50.50m, "USD", Utc(2026, 10, 3, 9, 0), omars),
                Payment(1_500_000m, "LBP", Utc(2026, 10, 4, 9, 0), omars),
                Payment(80m, "USD", Utc(2026, 9, 4, 9, 0), leas),
            ],
            [
                new HeldSession(new DateOnly(2026, 10, 2), Lea),
                new HeldSession(new DateOnly(2026, 10, 3), Owner),
                new HeldSession(new DateOnly(2026, 9, 30), Lea),
            ],
            [
                Plan(Maya, booked: Utc(2026, 10, 2, 9, 0), start: new DateOnly(2026, 10, 2), end: new DateOnly(2026, 10, 10), history: leas),
                Plan(Rami, booked: Utc(2026, 10, 2, 9, 0), start: new DateOnly(2026, 10, 2), end: new DateOnly(2026, 12, 10), history: omars, pack: true),
            ]);

        var total = MonthNumbersPolicy.Count(facts, October, November, Today, Beirut, null);
        var lea = MonthNumbersPolicy.Count(facts, October, November, Today, Beirut, Lea);
        var omar = MonthNumbersPolicy.Count(facts, October, November, Today, Beirut, Omar);
        var owner = MonthNumbersPolicy.Count(facts, October, November, Today, Beirut, Owner);

        CollectionAssert.AreEqual(
            new[] { new MoneyReceivedTotal("LBP", 1_500_000m, 1), new MoneyReceivedTotal("USD", 150.50m, 2) },
            total.MoneyReceived.ToArray(),
            "Each currency on its own line, in currency order, exact.");
        Assert.AreEqual((2, 1, 1, 2, 1), (total.SessionsHeld, total.PlansSold, total.PacksSold, total.ClientsStarted, total.ClientsEnded));
        CollectionAssert.AreEqual(new[] { new MoneyReceivedTotal("USD", 100m, 1) }, lea.MoneyReceived.ToArray());
        Assert.AreEqual((1, 1, 0, 1, 1), (lea.SessionsHeld, lea.PlansSold, lea.PacksSold, lea.ClientsStarted, lea.ClientsEnded));
        CollectionAssert.AreEqual(
            new[] { new MoneyReceivedTotal("LBP", 1_500_000m, 1), new MoneyReceivedTotal("USD", 50.50m, 1) },
            omar.MoneyReceived.ToArray());
        Assert.AreEqual((0, 0, 1, 1, 0), (omar.SessionsHeld, omar.PlansSold, omar.PacksSold, omar.ClientsStarted, omar.ClientsEnded));
        Assert.AreEqual((1, 0, 0, 0, 0), (owner.SessionsHeld, owner.PlansSold, owner.PacksSold, owner.ClientsStarted, owner.ClientsEnded));
        Assert.IsEmpty(owner.MoneyReceived);

        Assert.AreEqual(
            total.SessionsHeld,
            new[] { lea, omar, owner }.Sum(numbers => numbers.SessionsHeld),
            "Whoever recorded a session, it counts once.");
        CollectionAssert.AreEquivalent(new[] { Lea, Omar, Owner }, MonthNumbersPolicy.CoachesIn(facts).ToArray());

        var september = MonthNumbersPolicy.Count(facts, September, October, Today, Beirut, null);
        CollectionAssert.AreEqual(new[] { new MoneyReceivedTotal("USD", 80m, 1) }, september.MoneyReceived.ToArray());
        Assert.AreEqual(1, september.SessionsHeld);
    }

    [TestMethod]
    public void AMonthWithNothingInItSaysSo()
    {
        Assert.IsTrue(Numbers([], October, November).IsEmpty);
        Assert.IsFalse(new MonthNumbers([], 0, 0, 0, 0, 1).IsEmpty);
        Assert.IsFalse(new MonthNumbers([new MoneyReceivedTotal("USD", 1m, 1)], 0, 0, 0, 0, 0).IsEmpty);
    }

    private static MonthNumbers Numbers(IReadOnlyList<MonthPlan> plans, DateOnly from, DateOnly toExclusive, Guid? coach = null) =>
        MonthNumbersPolicy.Count(Facts(plans), from, toExclusive, Today, Beirut, coach);

    private static MonthFacts Facts(IReadOnlyList<MonthPlan> plans) => new([], [], plans);

    private static ReceivedPayment Payment(decimal amount, string currency, DateTimeOffset at, IReadOnlyList<CoachHistoryEntry> history) =>
        new(amount, currency, at, PaymentOperation.Receipt, history);

    private static MonthPlan Plan(
        Guid client,
        DateTimeOffset? booked = null,
        decimal price = 100m,
        DateOnly? start = null,
        DateOnly? end = null,
        bool paid = true,
        bool pack = false,
        DateOnly? cancelledOn = null,
        bool moneyReceived = false,
        IReadOnlyList<CoachHistoryEntry>? history = null) =>
        new(
            client,
            booked ?? Utc(2026, 1, 1, 9, 0),
            pack,
            price,
            start ?? new DateOnly(2026, 1, 1),
            end ?? new DateOnly(2026, 1, 29),
            paid,
            cancelledOn,
            moneyReceived,
            history ?? [new CoachHistoryEntry(1, Lea, Utc(2026, 1, 1, 8, 0))]);

    private static DateTimeOffset Utc(int year, int month, int day, int hour, int minute) =>
        new(year, month, day, hour, minute, 0, TimeSpan.Zero);
}
