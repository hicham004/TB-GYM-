using TB.Gym.Modules.Subscriptions;

namespace TB.Gym.Domain.Tests;

[TestClass]
public sealed class SubscriptionRulesTests
{
    [TestMethod]
    public void AdjacentPeriodsDoNotOverlap()
    {
        var first = SubscriptionPeriod.ForWeeks(new DateOnly(2026, 8, 1), 4);
        var second = SubscriptionPeriod.ForWeeks(first.EndExclusive, 4);

        Assert.IsFalse(first.Overlaps(second));
        Assert.AreEqual(new DateOnly(2026, 8, 28), first.LastActiveDate);
    }

    [TestMethod]
    public void IntersectingPeriodsOverlap()
    {
        var first = SubscriptionPeriod.ForWeeks(new DateOnly(2026, 8, 1), 4);
        var second = SubscriptionPeriod.ForWeeks(new DateOnly(2026, 8, 15), 4);

        Assert.IsTrue(first.Overlaps(second));
        Assert.IsTrue(second.Overlaps(first));
    }

    [TestMethod]
    public void UnpaidClientHasProfileOnlyAccess()
    {
        var state = new AccountAccessState(
            IsPlatformBlocked: false,
            IsCoachBlocked: false,
            HasActiveMembership: true,
            HasCurrentSubscription: true,
            PaymentStanding.Pending);

        Assert.AreEqual(AccountAccessLevel.ProfileOnly, AccountAccessPolicy.Evaluate(state));
    }

    [TestMethod]
    public void CoachBlockTakesPrecedenceOverPayment()
    {
        var state = new AccountAccessState(
            IsPlatformBlocked: false,
            IsCoachBlocked: true,
            HasActiveMembership: true,
            HasCurrentSubscription: true,
            PaymentStanding.Paid);

        Assert.AreEqual(AccountAccessLevel.Denied, AccountAccessPolicy.Evaluate(state));
    }
}
