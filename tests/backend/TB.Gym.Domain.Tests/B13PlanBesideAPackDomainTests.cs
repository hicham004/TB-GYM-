using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.SharedKernel;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// A plan that ends beside a pack (critique B13, SES-010): once a coaching plan has run out, what the client's plan reads
/// as leaves Sessions out, so the status, Ended, not renewed and Ask to renew read them as they would with no pack.
/// </summary>
[TestClass]
public sealed class B13PlanBesideAPackDomainTests
{
    private static readonly Guid Plan = Guid.Parse("40000000-0000-0000-0000-0000000000b1");
    private static readonly Guid Renewal = Guid.Parse("40000000-0000-0000-0000-0000000000b2");
    private static readonly Guid Pack = Guid.Parse("40000000-0000-0000-0000-0000000000b3");
    private static readonly DateOnly PlanEnd = new(2026, 10, 15);
    private static readonly DateOnly PackEnd = new(2026, 12, 1);

    [TestMethod]
    public void BesideARunningPackAPlanThatRanOutReadsAsEnded()
    {
        IReadOnlyList<FeatureAccessDecision> decisions =
        [
            Decision(CoachingFeature.Training, FeatureAccessReason.Expired, Plan, PlanEnd),
            Decision(CoachingFeature.Messaging, FeatureAccessReason.Expired, Plan, PlanEnd),
            Decision(CoachingFeature.Nutrition, FeatureAccessReason.NoEntitlement),
            Decision(CoachingFeature.Sessions, FeatureAccessReason.Granted, Pack, PackEnd),
        ];

        var read = CoachingPlanRunOut.PlanDecisions(decisions, coachingPlanRanOut: true);

        Assert.AreEqual(ClientPlanState.Ended, CoachAttentionPolicy.PlanState(read));
        Assert.AreEqual(new EndedPlan(Plan, PlanEnd.AddDays(-1)), RenewalEligibility.EndedPlan(read));
        Assert.IsTrue(CoachAttentionPolicy.IsLapsed(read));
        Assert.AreEqual(ClientPlanStatus.NoActivePlan, CoachAttentionPolicy.PlanStatus([], ClientPlanState.Ended));
        Assert.AreEqual(ClientOverviewStatus.NoActivePlan, CoachAttentionPolicy.Status([], ClientPlanState.Ended));
    }

    [TestMethod]
    [DataRow(FeatureAccessReason.Granted, DisplayName = "a pack running")]
    [DataRow(FeatureAccessReason.Paused, DisplayName = "a pack paused")]
    [DataRow(FeatureAccessReason.PaymentRequired, DisplayName = "a pack waiting for payment")]
    [DataRow(FeatureAccessReason.NotStarted, DisplayName = "a pack still to come")]
    [DataRow(FeatureAccessReason.Cancelled, DisplayName = "a pack cancelled")]
    [DataRow(FeatureAccessReason.Expired, DisplayName = "a pack that ended after the plan")]
    public void WhateverAPackIsDoingThePlanThatRanOutIsThePlanThatEnded(FeatureAccessReason pack)
    {
        IReadOnlyList<FeatureAccessDecision> decisions =
        [
            Decision(CoachingFeature.Training, FeatureAccessReason.Expired, Plan, PlanEnd),
            Decision(CoachingFeature.Sessions, pack, Pack, PackEnd),
        ];

        var read = CoachingPlanRunOut.PlanDecisions(decisions, coachingPlanRanOut: true);

        Assert.AreEqual(ClientPlanState.Ended, CoachAttentionPolicy.PlanState(read));
        Assert.AreEqual(Plan, RenewalEligibility.EndedPlan(read)?.EnrollmentId, "Never the pack, whichever ended last.");
    }

    [TestMethod]
    public void WithNoCoachingPlanToHaveRunOutThePackStandsAsThePlan()
    {
        IReadOnlyList<FeatureAccessDecision> running =
        [
            Decision(CoachingFeature.Training, FeatureAccessReason.NoEntitlement),
            Decision(CoachingFeature.Sessions, FeatureAccessReason.Granted, Pack, PackEnd),
        ];
        IReadOnlyList<FeatureAccessDecision> over =
        [
            Decision(CoachingFeature.Training, FeatureAccessReason.NoEntitlement),
            Decision(CoachingFeature.Sessions, FeatureAccessReason.Expired, Pack, PackEnd),
        ];

        Assert.AreSame(running, CoachingPlanRunOut.PlanDecisions(running, coachingPlanRanOut: false));
        Assert.AreEqual(ClientPlanState.Running, CoachAttentionPolicy.PlanState(running));
        Assert.IsNull(RenewalEligibility.EndedPlan(running));
        Assert.AreEqual(Pack, RenewalEligibility.EndedPlan(over)?.EnrollmentId, "A pack that ran out is a plan that ran out.");
    }

    [TestMethod]
    [DataRow(FeatureAccessReason.PaymentRequired, ClientPlanState.PaymentDue, true, DisplayName = "a renewal waiting for payment")]
    [DataRow(FeatureAccessReason.NotStarted, ClientPlanState.NotStarted, false, DisplayName = "a renewal paid and still to come")]
    public void APlanBookedAfterTheOneThatRanOutReadsAsItWouldWithNoPack(
        FeatureAccessReason next,
        ClientPlanState state,
        bool lapsed)
    {
        // What the access decision says then hides the Expired, which is why the reader asks the plans themselves.
        IReadOnlyList<FeatureAccessDecision> decisions =
        [
            Decision(CoachingFeature.Training, next, Renewal, PackEnd),
            Decision(CoachingFeature.Sessions, FeatureAccessReason.Granted, Pack, PackEnd),
        ];

        var read = CoachingPlanRunOut.PlanDecisions(decisions, coachingPlanRanOut: true);

        Assert.AreEqual(state, CoachAttentionPolicy.PlanState(read));
        Assert.AreEqual(lapsed, CoachAttentionPolicy.IsLapsed(read));
        Assert.IsNull(RenewalEligibility.EndedPlan(read), "A plan is booked: the client has nothing to ask for.");
    }

    [TestMethod]
    public void ACoachingFeatureStillRunningKeepsThePlanRunning()
    {
        // Another plan runs on, or a pack that also ticked this feature: either way the client is coached in it.
        IReadOnlyList<FeatureAccessDecision> decisions =
        [
            Decision(CoachingFeature.Training, FeatureAccessReason.Expired, Plan, PlanEnd),
            Decision(CoachingFeature.Nutrition, FeatureAccessReason.Granted, Renewal, PackEnd),
            Decision(CoachingFeature.Sessions, FeatureAccessReason.Granted, Pack, PackEnd),
        ];

        var read = CoachingPlanRunOut.PlanDecisions(decisions, coachingPlanRanOut: true);

        Assert.AreEqual(ClientPlanState.Running, CoachAttentionPolicy.PlanState(read));
        Assert.IsNull(RenewalEligibility.EndedPlan(read));
        Assert.IsFalse(CoachAttentionPolicy.IsLapsed(read));
    }

    [TestMethod]
    public void ABlockReadsAsABlockWhatever()
    {
        IReadOnlyList<FeatureAccessDecision> decisions =
        [
            Decision(CoachingFeature.Training, FeatureAccessReason.RelationshipBlocked),
            Decision(CoachingFeature.Sessions, FeatureAccessReason.RelationshipBlocked),
        ];

        var read = CoachingPlanRunOut.PlanDecisions(decisions, coachingPlanRanOut: true);

        Assert.AreEqual(ClientPlanState.Blocked, CoachAttentionPolicy.PlanState(read));
        Assert.IsNull(RenewalEligibility.EndedPlan(read));
    }

    [TestMethod]
    public void TheCoachingPlansThatRanOutAreThoseTheAccessDecisionReadsExpiredAndNoPackOrCancelledPlan()
    {
        var today = new DateOnly(2026, 10, 15);
        var ended = Coaching(today.AddDays(-28), weeks: 4);
        var endsToday = Coaching(today.AddDays(-27), weeks: 4);
        var cancelled = Coaching(today.AddDays(-28), weeks: 4);
        cancelled.Cancel(Now(today.AddDays(-5)), "Stopped");
        var overPack = SessionPack(today.AddDays(-30), days: 10);

        var ranOut = CoachingPlanRunOut
            .Among(new[] { ended, endsToday, cancelled, overPack }.AsQueryable(), today)
            .ToArray();

        CollectionAssert.AreEqual(new[] { ended }, ranOut, "Its last day has passed; the plan ending today still runs.");
    }

    [TestMethod]
    public void OnlyAPackBehindTheSessionsDecisionMakesTheRuleWorthAsking()
    {
        Assert.IsTrue(CoachingPlanRunOut.HasPack([Decision(CoachingFeature.Sessions, FeatureAccessReason.Granted, Pack, PackEnd)]));
        Assert.IsTrue(CoachingPlanRunOut.HasPack([Decision(CoachingFeature.Sessions, FeatureAccessReason.Expired, Pack, PackEnd)]));

        // A coaching plan's own client has none, and neither does a blocked one's decision name any.
        Assert.IsFalse(CoachingPlanRunOut.HasPack([Decision(CoachingFeature.Sessions, FeatureAccessReason.NoEntitlement)]));
        Assert.IsFalse(CoachingPlanRunOut.HasPack([Decision(CoachingFeature.Sessions, FeatureAccessReason.RelationshipBlocked)]));
        Assert.IsFalse(CoachingPlanRunOut.HasPack([Decision(CoachingFeature.Training, FeatureAccessReason.Granted, Plan, PlanEnd)]));
    }

    // B13 moved the rule to its sixth version; the notes plan's N10a, removing maxes to review, to its seventh.
    [TestMethod]
    public void TheAttentionRuleMovedToItsSeventhVersion() =>
        Assert.AreEqual(("CoachAttention", 7), (CoachAttentionPolicy.Key, CoachAttentionPolicy.Version));

    private static readonly Guid TenantId = Guid.Parse("10000000-0000-0000-0000-0000000000b1");
    private static readonly Guid ClientId = Guid.Parse("20000000-0000-0000-0000-0000000000b1");

    private static DateTimeOffset Now(DateOnly day) => new(day.ToDateTime(new TimeOnly(9, 0)), TimeSpan.Zero);

    private static ClientEnrollment Coaching(DateOnly start, int weeks)
    {
        var product = CoachingProduct.Create(TenantId, "Online Coaching", null, ProductKind.CoachingPlan);
        var offer = ProductOffer.CreateFixedDuration(
            TenantId,
            product.Id,
            $"{weeks} weeks",
            weeks,
            OfferDurationUnit.Week,
            0m,
            "USD",
            [new OfferFeatureDefinition(CoachingFeature.Training, AllowsConcurrentCoverage: false)]);
        return ClientEnrollment.Assign(TenantId, ClientId, product, offer, start, Guid.NewGuid(), Now(start));
    }

    private static ClientEnrollment SessionPack(DateOnly start, int days)
    {
        var product = CoachingProduct.Create(TenantId, "Personal training", null, ProductKind.SessionPack);
        var offer = ProductOffer.CreateFixedDuration(
            TenantId,
            product.Id,
            "5 sessions",
            days,
            OfferDurationUnit.Day,
            0m,
            "USD",
            SessionPackRules.PackFeatures([]),
            5);
        return ClientEnrollment.Assign(TenantId, ClientId, product, offer, start, Guid.NewGuid(), Now(start));
    }

    private static FeatureAccessDecision Decision(
        CoachingFeature feature,
        FeatureAccessReason reason,
        Guid? enrollmentId = null,
        DateOnly? untilExclusive = null) =>
        new(feature, reason == FeatureAccessReason.Granted, reason, enrollmentId, null, untilExclusive);
}
