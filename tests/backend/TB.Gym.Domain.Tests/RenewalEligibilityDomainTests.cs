using TB.Gym.Modules.Subscriptions;
using TB.Gym.SharedKernel;

namespace TB.Gym.Domain.Tests;

/// <summary>ADR 0029: a client may ask to renew only once their whole plan has run out.</summary>
[TestClass]
public sealed class RenewalEligibilityDomainTests
{
    private static readonly Guid Earlier = Guid.Parse("40000000-0000-0000-0000-000000000001");
    private static readonly Guid Later = Guid.Parse("40000000-0000-0000-0000-000000000002");

    [TestMethod]
    public void EveryFeatureRunOutEndsThePlanOnTheLatestLastDay()
    {
        var ended = RenewalEligibility.EndedPlan(
        [
            Decision(CoachingFeature.Training, FeatureAccessReason.Expired, Earlier, new DateOnly(2026, 9, 28)),
            Decision(CoachingFeature.Nutrition, FeatureAccessReason.Expired, Later, new DateOnly(2026, 10, 5)),
            Decision(CoachingFeature.CheckIns, FeatureAccessReason.NoEntitlement),
        ]);

        Assert.IsNotNull(ended);
        Assert.AreEqual(Later, ended.EnrollmentId);
        Assert.AreEqual(new DateOnly(2026, 10, 4), ended.LastDay, "The last covered day, not the exclusive end.");
    }

    [TestMethod]
    [DataRow(FeatureAccessReason.Granted, DisplayName = "one feature still running")]
    [DataRow(FeatureAccessReason.Paused, DisplayName = "paused by the coach")]
    [DataRow(FeatureAccessReason.Cancelled, DisplayName = "cancelled by the coach")]
    [DataRow(FeatureAccessReason.PaymentRequired, DisplayName = "a renewal awaiting payment")]
    [DataRow(FeatureAccessReason.NotStarted, DisplayName = "a plan starting later")]
    [DataRow(FeatureAccessReason.RelationshipBlocked, DisplayName = "blocked by the coach")]
    [DataRow(FeatureAccessReason.MembershipInactive, DisplayName = "no longer a member")]
    [DataRow(FeatureAccessReason.PlatformBlocked, DisplayName = "blocked by the platform")]
    public void AnythingButRunOutOrNotInThePlanKeepsThePlanOpen(FeatureAccessReason other)
    {
        var ended = RenewalEligibility.EndedPlan(
        [
            Decision(CoachingFeature.Training, FeatureAccessReason.Expired, Earlier, new DateOnly(2026, 9, 28)),
            Decision(CoachingFeature.Nutrition, other, Later, new DateOnly(2026, 12, 1)),
        ]);

        Assert.IsNull(ended);
    }

    [TestMethod]
    public void AClientWhoNeverHadAPlanHasNothingToRenew()
    {
        Assert.IsNull(RenewalEligibility.EndedPlan(
        [
            Decision(CoachingFeature.Training, FeatureAccessReason.NoEntitlement),
            Decision(CoachingFeature.Messaging, FeatureAccessReason.NoEntitlement),
        ]));
        Assert.IsNull(RenewalEligibility.EndedPlan([]));
    }

    [TestMethod]
    public void ARequestOpensASevenDayWindowFromTheDayItWasMade()
    {
        var request = RenewalRequest.Create(
            Guid.NewGuid(),
            Guid.NewGuid(),
            Later,
            Guid.NewGuid(),
            new DateOnly(2026, 10, 5),
            new DateTimeOffset(2026, 10, 5, 15, 0, 0, TimeSpan.Zero));

        Assert.AreEqual(new DateOnly(2026, 10, 12), request.AskAgainFrom);
        Assert.ThrowsExactly<ArgumentException>(() => RenewalRequest.Create(
            Guid.NewGuid(), Guid.NewGuid(), Guid.Empty, Guid.NewGuid(), new DateOnly(2026, 10, 5), DateTimeOffset.UtcNow));
    }

    private static FeatureAccessDecision Decision(
        CoachingFeature feature,
        FeatureAccessReason reason,
        Guid? enrollmentId = null,
        DateOnly? untilExclusive = null) =>
        new(feature, reason == FeatureAccessReason.Granted, reason, enrollmentId, null, untilExclusive);
}
