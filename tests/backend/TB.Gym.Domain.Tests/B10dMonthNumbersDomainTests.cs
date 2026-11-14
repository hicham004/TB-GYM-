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
    private static readonly Guid Sami = new("00000000-0000-0000-0000-0000000000a3");
    private static readonly Guid Nour = new("00000000-0000-0000-0000-0000000000a4");
    private static readonly DateOnly September = new(2026, 9, 1);
    private static readonly DateOnly October = new(2026, 10, 1);
    private static readonly DateOnly November = new(2026, 11, 1);
    private static readonly DateOnly Today = new(2026, 10, 20);

    [TestMethod]
    public void TheRuleIsNamedAndVersioned() =>
        Assert.AreEqual(("MonthNumbers", 3), (MonthNumbersPolicy.Key, MonthNumbersPolicy.Version));

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

    // ---------- while a client waits for a coach (v3, notes plan N9d1b) ----------

    [TestMethod]
    public void ASaleAStartAndAnEndWhileTheClientWaitsCountForNobody()
    {
        // The owner removed Lea at 09:00 UTC on 8 Oct (12:00 in Beirut), so Maya waited, and gave her Omar at 09:00 UTC
        // on 16 Oct. While she waited she was sold a plan that ran 10 to 13 Oct, and a pack still waiting for payment.
        var history = Waited();
        var plans = new[]
        {
            Plan(Maya, booked: Utc(2026, 10, 10, 9, 0), start: new DateOnly(2026, 10, 10), end: new DateOnly(2026, 10, 14), history: history),
            Plan(Maya, booked: Utc(2026, 10, 12, 9, 0), start: new DateOnly(2026, 10, 25), end: new DateOnly(2026, 11, 1), paid: false, pack: true, history: history),
        };

        Assert.AreEqual(
            new PlanStint(new DateOnly(2026, 10, 10), new DateOnly(2026, 10, 13)),
            MonthNumbersPolicy.Stints(plans, Today).Single());
        var nobody = Nobody(Facts(plans), October, November);
        Assert.AreEqual((0, 1, 1, 1, 1), (nobody.SessionsHeld, nobody.PlansSold, nobody.PacksSold, nobody.ClientsStarted, nobody.ClientsEnded));
        Assert.IsEmpty(nobody.MoneyReceived);
        foreach (var coach in new[] { Lea, Omar, Owner })
        {
            Assert.IsTrue(Numbers(plans, October, November, coach).IsEmpty, "Nothing of the wait counts for any coach.");
        }

        var total = Numbers(plans, October, November);
        Assert.AreEqual((1, 1, 1, 1), (total.PlansSold, total.PacksSold, total.ClientsStarted, total.ClientsEnded));
    }

    [TestMethod]
    public void AClientWhoseLastDayWasTheDayTheirCoachLeftEndsForThatCoach()
    {
        // As the day began (SUB-018): Lea left at 12:00 in Beirut on 8 Oct, so Rami, whose last day was 8 Oct, ends for
        // her; Sami's last day was 9 Oct and Nour's 16 Oct, the day Omar came at 12:00, and both began it waiting.
        var history = Waited();
        var plans = new[]
        {
            Plan(Rami, start: new DateOnly(2026, 9, 1), end: new DateOnly(2026, 10, 9), history: history),
            Plan(Sami, start: new DateOnly(2026, 9, 1), end: new DateOnly(2026, 10, 10), history: history),
            Plan(Nour, start: new DateOnly(2026, 9, 1), end: new DateOnly(2026, 10, 17), history: history),
        };

        Assert.AreEqual(1, Numbers(plans, October, November, coach: Lea).ClientsEnded);
        Assert.AreEqual(2, Nobody(Facts(plans), October, November).ClientsEnded);
        Assert.AreEqual(0, Numbers(plans, October, November, coach: Omar).ClientsEnded);
        Assert.AreEqual(0, Numbers(plans, October, November, coach: Owner).ClientsEnded);
        Assert.AreEqual(3, Numbers(plans, October, November).ClientsEnded);

        // All three started on 1 Sep with Lea, before anyone waited.
        Assert.AreEqual(3, Numbers(plans, September, October, coach: Lea).ClientsStarted);
        Assert.IsTrue(Nobody(Facts(plans), September, October).IsEmpty);
    }

    [TestMethod]
    public void AReleaseFromWaitingEndsTheClientForNobody()
    {
        // Maya waited from Lea's removal on 8 Oct; the owner released her at 09:00 UTC on 15 Oct, which wrote the owner
        // as the record's keeper and cancelled her plan that day. She began 15 Oct waiting, so she ends for nobody, not
        // for the owner who keeps her record nor for Lea, who had left.
        CoachHistoryEntry[] history =
        [
            new(1, Lea, Utc(2026, 8, 1, 9, 0)),
            new(2, null, Utc(2026, 10, 8, 9, 0)),
            new(3, Owner, Utc(2026, 10, 15, 9, 0)),
        ];
        var plans = new[]
        {
            Plan(Maya, start: new DateOnly(2026, 9, 1), end: new DateOnly(2026, 12, 1), cancelledOn: new DateOnly(2026, 10, 15), history: history),
        };

        Assert.AreEqual(
            new PlanStint(new DateOnly(2026, 9, 1), new DateOnly(2026, 10, 15)),
            MonthNumbersPolicy.Stints(plans, Today).Single());
        Assert.AreEqual(1, Nobody(Facts(plans), October, November).ClientsEnded);
        Assert.AreEqual(0, Numbers(plans, October, November, coach: Owner).ClientsEnded);
        Assert.AreEqual(0, Numbers(plans, October, November, coach: Lea).ClientsEnded);
        Assert.AreEqual(1, Numbers(plans, October, November).ClientsEnded);
    }

    [TestMethod]
    public void CoachesInNamesNobodyForAWaitingStretch()
    {
        var facts = new MonthFacts(
            [Payment(10m, "USD", Utc(2026, 10, 9, 9, 0), Waited())],
            [new HeldSession(new DateOnly(2026, 10, 9), Owner)],
            [Plan(Sami, history: [new CoachHistoryEntry(1, null, Utc(2026, 10, 5, 9, 0))])]);

        CollectionAssert.AreEquivalent(new[] { Lea, Omar, Owner }, MonthNumbersPolicy.CoachesIn(facts).ToArray());
        Assert.DoesNotContain(Guid.Empty, MonthNumbersPolicy.CoachesIn(facts));

        // A workspace whose every entry names nobody has no coach to show a row for.
        var waitingOnly = new MonthFacts([], [], [Plan(Sami, history: [new CoachHistoryEntry(1, null, Utc(2026, 10, 5, 9, 0))])]);
        Assert.IsEmpty(MonthNumbersPolicy.CoachesIn(waitingOnly));
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
    public void EveryRowAndTheNoCoachLineAddUpToTheTotalInEveryNumberAndCurrency()
    {
        // Maya: Lea's from 1 Aug, waiting from Lea's removal at 09:00 UTC on 8 Oct, Omar's from 09:00 UTC on 16 Oct.
        // Sami: joined waiting at 09:00 UTC on 5 Oct, from an invitation whose coach had left, and waits still.
        var maya = Waited();
        var omars = new[] { new CoachHistoryEntry(1, Omar, Utc(2026, 8, 1, 9, 0)) };
        var leas = new[] { new CoachHistoryEntry(1, Lea, Utc(2026, 8, 1, 9, 0)) };
        CoachHistoryEntry[] sami = [new(1, null, Utc(2026, 10, 5, 9, 0))];
        var facts = new MonthFacts(
            [
                Payment(100m, "USD", Utc(2026, 10, 2, 9, 0), maya), // Lea's
                Payment(40m, "USD", Utc(2026, 10, 10, 9, 0), maya), // nobody's
                Payment(2_000_000m, "LBP", Utc(2026, 10, 12, 9, 0), maya), // nobody's
                Payment(60.25m, "USD", Utc(2026, 10, 18, 9, 0), maya), // Omar's
                Payment(15m, "EUR", Utc(2026, 10, 3, 9, 0), sami), // nobody's: before Sami's first entry, which names nobody
                Payment(25.75m, "EUR", Utc(2026, 10, 6, 9, 0), sami), // nobody's
                Payment(1_500_000m, "LBP", Utc(2026, 10, 4, 9, 0), omars), // Omar's
                Payment(80m, "USD", Utc(2026, 9, 4, 9, 0), leas), // Lea's, in September
            ],
            [
                new HeldSession(new DateOnly(2026, 10, 2), Lea),
                new HeldSession(new DateOnly(2026, 10, 3), Owner),
                new HeldSession(new DateOnly(2026, 10, 12), Owner), // held for Maya while she waited: the owner's
                new HeldSession(new DateOnly(2026, 9, 30), Lea),
            ],
            [
                // Maya's stints: 2 to 9 Oct (started with Lea, ended waiting), 12 to 16 Oct (started and ended waiting),
                // and from 18 Oct on a pack still running (started with Omar).
                Plan(Maya, booked: Utc(2026, 10, 2, 9, 0), start: new DateOnly(2026, 10, 2), end: new DateOnly(2026, 10, 10), history: maya),
                Plan(Maya, booked: Utc(2026, 10, 11, 9, 0), start: new DateOnly(2026, 10, 12), end: new DateOnly(2026, 10, 17), history: maya),
                Plan(Maya, booked: Utc(2026, 10, 18, 9, 0), start: new DateOnly(2026, 10, 18), end: new DateOnly(2026, 10, 25), history: maya, pack: true),
                Plan(Rami, booked: Utc(2026, 10, 2, 9, 0), start: new DateOnly(2026, 10, 2), end: new DateOnly(2026, 12, 10), history: omars, pack: true),
                Plan(Sami, booked: Utc(2026, 10, 5, 10, 0), start: new DateOnly(2026, 10, 5), end: new DateOnly(2026, 11, 2), history: sami),
            ]);

        var total = MonthNumbersPolicy.Count(facts, October, November, Today, Beirut, null);
        var lea = MonthNumbersPolicy.Count(facts, October, November, Today, Beirut, Lea);
        var omar = MonthNumbersPolicy.Count(facts, October, November, Today, Beirut, Omar);
        var owner = MonthNumbersPolicy.Count(facts, October, November, Today, Beirut, Owner);
        var nobody = MonthNumbersPolicy.CountForNobody(facts, October, November, Today, Beirut);

        // Worked out by hand from the rule: (sessions, plans sold, packs sold, started, ended), and money per currency.
        CollectionAssert.AreEqual(
            new[]
            {
                new MoneyReceivedTotal("EUR", 40.75m, 2),
                new MoneyReceivedTotal("LBP", 3_500_000m, 2),
                new MoneyReceivedTotal("USD", 200.25m, 3),
            },
            total.MoneyReceived.ToArray());
        Assert.AreEqual((3, 3, 2, 5, 2), (total.SessionsHeld, total.PlansSold, total.PacksSold, total.ClientsStarted, total.ClientsEnded));

        CollectionAssert.AreEqual(new[] { new MoneyReceivedTotal("USD", 100m, 1) }, lea.MoneyReceived.ToArray());
        Assert.AreEqual((1, 1, 0, 1, 0), (lea.SessionsHeld, lea.PlansSold, lea.PacksSold, lea.ClientsStarted, lea.ClientsEnded));

        CollectionAssert.AreEqual(
            new[] { new MoneyReceivedTotal("LBP", 1_500_000m, 1), new MoneyReceivedTotal("USD", 60.25m, 1) },
            omar.MoneyReceived.ToArray());
        Assert.AreEqual((0, 0, 2, 2, 0), (omar.SessionsHeld, omar.PlansSold, omar.PacksSold, omar.ClientsStarted, omar.ClientsEnded));

        Assert.IsEmpty(owner.MoneyReceived);
        Assert.AreEqual((2, 0, 0, 0, 0), (owner.SessionsHeld, owner.PlansSold, owner.PacksSold, owner.ClientsStarted, owner.ClientsEnded));

        CollectionAssert.AreEqual(
            new[]
            {
                new MoneyReceivedTotal("EUR", 40.75m, 2),
                new MoneyReceivedTotal("LBP", 2_000_000m, 1),
                new MoneyReceivedTotal("USD", 40m, 1),
            },
            nobody.MoneyReceived.ToArray(),
            "What came while a client waited, each currency on its own line, exact.");
        Assert.AreEqual(
            (0, 2, 0, 2, 2),
            (nobody.SessionsHeld, nobody.PlansSold, nobody.PacksSold, nobody.ClientsStarted, nobody.ClientsEnded),
            "A session always counts for who held it, never for nobody.");

        // The coaches' rows (CoachesIn) and the no-coach line add up to the workspace, number by number and per currency.
        CollectionAssert.AreEquivalent(new[] { Lea, Omar, Owner }, MonthNumbersPolicy.CoachesIn(facts).ToArray());
        var lines = MonthNumbersPolicy.CoachesIn(facts)
            .Select(coach => MonthNumbersPolicy.Count(facts, October, November, Today, Beirut, coach))
            .Append(nobody)
            .ToArray();
        Assert.AreEqual(
            (total.SessionsHeld, total.PlansSold, total.PacksSold, total.ClientsStarted, total.ClientsEnded),
            (lines.Sum(line => line.SessionsHeld), lines.Sum(line => line.PlansSold), lines.Sum(line => line.PacksSold),
                lines.Sum(line => line.ClientsStarted), lines.Sum(line => line.ClientsEnded)));
        CollectionAssert.AreEqual(
            total.MoneyReceived.ToArray(),
            lines.SelectMany(line => line.MoneyReceived)
                .GroupBy(money => money.CurrencyCode, StringComparer.Ordinal)
                .OrderBy(group => group.Key, StringComparer.Ordinal)
                .Select(group => new MoneyReceivedTotal(group.Key, group.Sum(money => money.Amount), group.Sum(money => money.PaymentCount)))
                .ToArray());

        // September holds only Lea's: nothing counted for nobody, so the owner's page shows no line for it.
        var september = MonthNumbersPolicy.Count(facts, September, October, Today, Beirut, null);
        CollectionAssert.AreEqual(new[] { new MoneyReceivedTotal("USD", 80m, 1) }, september.MoneyReceived.ToArray());
        Assert.AreEqual(1, september.SessionsHeld);
        Assert.IsTrue(MonthNumbersPolicy.CountForNobody(facts, September, October, Today, Beirut).IsEmpty);
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

    private static MonthNumbers Nobody(MonthFacts facts, DateOnly from, DateOnly toExclusive) =>
        MonthNumbersPolicy.CountForNobody(facts, from, toExclusive, Today, Beirut);

    /// <summary>
    /// Lea's client from 1 Aug; the owner removed Lea at 09:00 UTC on 8 Oct (12:00 in Beirut), so the client waited for a
    /// coach, and gave them Omar at 09:00 UTC on 16 Oct.
    /// </summary>
    private static CoachHistoryEntry[] Waited() =>
    [
        new(1, Lea, Utc(2026, 8, 1, 9, 0)),
        new(2, null, Utc(2026, 10, 8, 9, 0)),
        new(3, Omar, Utc(2026, 10, 16, 9, 0)),
    ];

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
