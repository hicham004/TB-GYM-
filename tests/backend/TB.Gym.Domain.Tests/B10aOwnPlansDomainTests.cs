using TB.Gym.Modules.Subscriptions;
using TB.Gym.SharedKernel;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// Which plans a client's own page shows and how each reads (SUB-017, critique B10a).
/// </summary>
[TestClass]
public sealed class B10aOwnPlansDomainTests
{
    private static readonly Guid TenantId = Guid.Parse("10000000-0000-0000-0000-000000000001");
    private static readonly Guid ClientId = Guid.Parse("20000000-0000-0000-0000-000000000001");
    private static readonly DateOnly Today = new(2026, 10, 15);
    private static readonly DateTimeOffset Now = new(2026, 10, 15, 9, 0, 0, TimeSpan.Zero);
    private static readonly TimeZoneInfo Beirut = TimeZoneInfo.FindSystemTimeZoneById("Asia/Beirut");

    [TestMethod]
    public void EveryPlanNotOverIsShownInTheOrderTheyStartAndWhatIsOverIsLeftOut()
    {
        var ended = Plan("Ended", Today.AddDays(-28), weeks: 2, free: true);
        var cancelled = Plan("Cancelled", Today.AddDays(-7), weeks: 4, free: true);
        cancelled.Cancel(Now.AddDays(-1), "Changed their mind");
        var waiting = Plan("Waiting", Today.AddDays(30), weeks: 4, free: false);
        var upcoming = Plan("Upcoming", Today.AddDays(5), weeks: 4, free: true);
        var running = Plan("Running", Today.AddDays(-1), weeks: 4, free: true);
        var paused = Plan("Paused", Today.AddDays(-3), weeks: 4, free: true);
        paused.Pause(Now, "Travelling");

        var shown = OwnPlans.Shown([ended, cancelled, waiting, upcoming, running, paused], Today, Beirut);

        Assert.AreEqual("Paused | Running | Upcoming | Waiting", string.Join(" | ", shown.Select(plan => plan.ProductNameSnapshot)));
    }

    [TestMethod]
    public void WithNothingRunningTheOneThatEndedLastIsShownACancelledPlanCountingFromTheDayItWasCancelled()
    {
        var older = Plan("Older", Today.AddDays(-70), weeks: 4, free: true);
        var ended = Plan("Ended", Today.AddDays(-30), weeks: 2, free: true);

        // Booked to run until after today, it was cancelled long before the plan above ran out.
        var cancelledEarly = Plan("Cancelled early", Today.AddDays(-60), weeks: 12, free: true);
        cancelledEarly.Cancel(Now.AddDays(-50), "Changed their mind");
        Assert.AreEqual("Ended", OwnPlans.Shown([older, cancelledEarly, ended], Today, Beirut).Single().ProductNameSnapshot);

        var cancelledLate = Plan("Cancelled late", Today.AddDays(-10), weeks: 2, free: true);
        cancelledLate.Cancel(Now.AddDays(-2), "Moved away");
        Assert.AreEqual(
            "Cancelled late",
            OwnPlans.Shown([older, cancelledEarly, ended, cancelledLate], Today, Beirut).Single().ProductNameSnapshot);
    }

    [TestMethod]
    public void AClientWithNoPlanIsShownNone() =>
        Assert.IsEmpty(OwnPlans.Shown([], Today, Beirut));

    [TestMethod]
    public void APlanThatRanPastItsDatesIsOverEvenBeforeAnythingMarkedItAndEvenIfNeverPaid()
    {
        var lastDayToday = Plan("Last day today", Today.AddDays(-13), weeks: 2, free: true);
        var neverPaid = Plan("Never paid", Today.AddDays(-14), weeks: 2, free: false);

        Assert.AreEqual("Last day today", OwnPlans.Shown([neverPaid, lastDayToday], Today, Beirut).Single().ProductNameSnapshot);
        Assert.AreEqual(EffectiveEnrollmentStatus.Active, OwnPlans.StatusOf(lastDayToday, Today, false));
        Assert.AreEqual(EffectiveEnrollmentStatus.Expired, OwnPlans.StatusOf(neverPaid, Today, false));
    }

    [TestMethod]
    public void ABlockSpeaksOnlyOfWhatStillRuns()
    {
        var running = Plan("Running", Today.AddDays(-1), weeks: 4, free: true);
        var waiting = Plan("Waiting", Today, weeks: 4, free: false);
        var upcoming = Plan("Upcoming", Today.AddDays(5), weeks: 4, free: true);
        var ended = Plan("Ended", Today.AddDays(-28), weeks: 2, free: true);
        var cancelled = Plan("Cancelled", Today.AddDays(-7), weeks: 4, free: true);
        cancelled.Cancel(Now.AddDays(-1), "Changed their mind");

        foreach (var plan in new[] { running, waiting, upcoming })
        {
            Assert.AreEqual(EffectiveEnrollmentStatus.Blocked, OwnPlans.StatusOf(plan, Today, true), plan.ProductNameSnapshot);
        }

        Assert.AreEqual(EffectiveEnrollmentStatus.Expired, OwnPlans.StatusOf(ended, Today, true));
        Assert.AreEqual(EffectiveEnrollmentStatus.Cancelled, OwnPlans.StatusOf(cancelled, Today, true));
        Assert.AreEqual(EffectiveEnrollmentStatus.Active, OwnPlans.StatusOf(running, Today, false));
        Assert.AreEqual(EffectiveEnrollmentStatus.PendingPayment, OwnPlans.StatusOf(waiting, Today, false));
        Assert.AreEqual(EffectiveEnrollmentStatus.Upcoming, OwnPlans.StatusOf(upcoming, Today, false));
    }

    [TestMethod]
    public void TheDayAPlanWasCancelledIsTheWorkspacesNotUtcs()
    {
        var plan = Plan("Cancelled", Today, weeks: 4, free: true);
        Assert.IsNull(plan.CancelledOn(Beirut));

        // 22:30 UTC is 01:30 the next day in Beirut.
        plan.Cancel(new DateTimeOffset(2026, 10, 15, 22, 30, 0, TimeSpan.Zero), "Moved away");

        Assert.AreEqual(new DateOnly(2026, 10, 16), plan.CancelledOn(Beirut));
    }

    private static ClientEnrollment Plan(string name, DateOnly start, int weeks, bool free)
    {
        var product = CoachingProduct.Create(TenantId, name, null);
        var offer = ProductOffer.CreateFixedDuration(
            TenantId,
            product.Id,
            $"{weeks} weeks",
            weeks,
            OfferDurationUnit.Week,
            free ? 0m : 100m,
            "USD",
            [new OfferFeatureDefinition(CoachingFeature.Training)]);
        return ClientEnrollment.Assign(TenantId, ClientId, product, offer, start, Guid.NewGuid(), Now);
    }
}
