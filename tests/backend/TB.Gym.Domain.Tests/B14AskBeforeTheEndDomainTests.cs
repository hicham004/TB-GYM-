using TB.Gym.Modules.Notifications;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.SharedKernel;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// Critique B14: a client may ask to renew from the day their plan's ending-soon notice goes out (SUB-014, ADR 0029),
/// and the renewal notices name My plan, the page they open (NOT-006).
/// </summary>
[TestClass]
public sealed class B14AskBeforeTheEndDomainTests
{
    private static readonly Guid Plan = Guid.Parse("40000000-0000-0000-0000-0000000000c1");
    private static readonly Guid Next = Guid.Parse("40000000-0000-0000-0000-0000000000c2");
    private static readonly Guid Pack = Guid.Parse("40000000-0000-0000-0000-0000000000c3");

    // The plan's last day is Saturday 31 October, the row's example.
    private static readonly DateOnly Start = new(2026, 10, 5);
    private static readonly DateOnly End = new(2026, 11, 1);
    private static readonly DateOnly NoticeDay = new(2026, 10, 29);
    private static readonly DateOnly PackEnd = new(2026, 12, 1);

    [TestMethod]
    public void ThePlansEndingSoonDayIsThreeDaysBeforeItsEnd() =>
        Assert.AreEqual(NoticeDay, RenewalEligibility.EndingSoonDay(End));

    [TestMethod]
    public void ItOpensOnTheNoticesDayAndStaysOpenToTheLastDay()
    {
        Assert.IsNull(Ending(NoticeDay.AddDays(-1)), "The day before the notice is too early.");
        foreach (var day in new[] { NoticeDay, NoticeDay.AddDays(1), End.AddDays(-1) })
        {
            Assert.AreEqual(new EndingPlan(Plan, new DateOnly(2026, 10, 31)), Ending(day));
        }
    }

    [TestMethod]
    public void EveryFeatureAPlanCoversCountsAndOnesItLacksDoNot()
    {
        var ending = RenewalEligibility.EndingPlan(
            [
                Decision(CoachingFeature.Training, FeatureAccessReason.Granted, Plan, End),
                Decision(CoachingFeature.Nutrition, FeatureAccessReason.Granted, Plan, End),
                Decision(CoachingFeature.Messaging, FeatureAccessReason.NoEntitlement),
                Decision(CoachingFeature.CheckIns, FeatureAccessReason.Expired, Next, Start),
            ],
            [Running(Plan)],
            NoticeDay);

        Assert.AreEqual(Plan, ending?.EnrollmentId);
    }

    [TestMethod]
    [DataRow(FeatureAccessReason.Paused, DisplayName = "paused by the coach")]
    [DataRow(FeatureAccessReason.Cancelled, DisplayName = "cancelled by the coach")]
    [DataRow(FeatureAccessReason.PaymentRequired, DisplayName = "a part waiting for payment")]
    [DataRow(FeatureAccessReason.NotStarted, DisplayName = "a part starting later")]
    [DataRow(FeatureAccessReason.RelationshipBlocked, DisplayName = "blocked by the coach")]
    [DataRow(FeatureAccessReason.MembershipInactive, DisplayName = "no longer a member")]
    [DataRow(FeatureAccessReason.PlatformBlocked, DisplayName = "blocked by the platform")]
    public void AnythingButRunningOrOverKeepsTheButtonAway(FeatureAccessReason other)
    {
        var ending = RenewalEligibility.EndingPlan(
            [
                Decision(CoachingFeature.Training, FeatureAccessReason.Granted, Plan, End),
                Decision(CoachingFeature.Nutrition, other, Next, PackEnd),
            ],
            [Running(Plan)],
            NoticeDay);

        Assert.IsNull(ending);
    }

    [TestMethod]
    public void AFeatureRunningOnKeepsThePlanOpen()
    {
        var ending = RenewalEligibility.EndingPlan(
            [
                Decision(CoachingFeature.Training, FeatureAccessReason.Granted, Plan, End),
                Decision(CoachingFeature.Nutrition, FeatureAccessReason.Granted, Next, PackEnd),
            ],
            [Running(Plan), new PlanNotOver(Next, false, Start, PackEnd)],
            NoticeDay);

        Assert.IsNull(ending, "Part of the plan runs on, so it is not ending.");
    }

    [TestMethod]
    public void APlanBookedAfterItKeepsTheButtonAwayPaidOrNot()
    {
        var ending = RenewalEligibility.EndingPlan(
            [Decision(CoachingFeature.Training, FeatureAccessReason.Granted, Plan, End)],
            [Running(Plan), new PlanNotOver(Next, false, End, End.AddDays(2))],
            End.AddDays(-1));

        Assert.IsNull(ending, "A next plan of two days is still a next plan, though its own last days have come.");
    }

    [TestMethod]
    public void BesideACoachingPlanAPackNeitherKeepsTheButtonAwayNorIsWhatTheyAskAbout()
    {
        foreach (var reason in new[] { FeatureAccessReason.Granted, FeatureAccessReason.Paused, FeatureAccessReason.PaymentRequired })
        {
            var ending = RenewalEligibility.EndingPlan(
                [
                    Decision(CoachingFeature.Training, FeatureAccessReason.Granted, Plan, End),
                    Decision(CoachingFeature.Sessions, reason, Pack, PackEnd),
                ],
                [Running(Plan), new PlanNotOver(Pack, true, Start, PackEnd)],
                NoticeDay);

            Assert.AreEqual(Plan, ending?.EnrollmentId, reason.ToString());
        }
    }

    [TestMethod]
    public void WithNoCoachingPlanLeftThePackIsThePlanAndAnotherAfterItIsItsRenewal()
    {
        IReadOnlyList<FeatureAccessDecision> running = [Decision(CoachingFeature.Sessions, FeatureAccessReason.Granted, Pack, End)];
        var pack = new PlanNotOver(Pack, true, Start, End);

        Assert.AreEqual(new EndingPlan(Pack, End.AddDays(-1)), RenewalEligibility.EndingPlan(running, [pack], NoticeDay));
        Assert.IsNull(RenewalEligibility.EndingPlan(running, [pack], NoticeDay.AddDays(-1)));
        Assert.IsNull(RenewalEligibility.EndingPlan(running, [pack, new PlanNotOver(Next, true, End, PackEnd)], NoticeDay));
    }

    [TestMethod]
    public void APackThatStillCoversAFeatureOfItsOwnKeepsThePlanOpen()
    {
        var ending = RenewalEligibility.EndingPlan(
            [
                Decision(CoachingFeature.Training, FeatureAccessReason.Granted, Plan, End),
                Decision(CoachingFeature.Sessions, FeatureAccessReason.Granted, Pack, PackEnd),
                Decision(CoachingFeature.Messaging, FeatureAccessReason.Granted, Pack, PackEnd),
            ],
            [Running(Plan), new PlanNotOver(Pack, true, Start, PackEnd)],
            NoticeDay);

        Assert.IsNull(ending, "Only Sessions leaves the reading, as in SES-010.");
    }

    [TestMethod]
    public void APlanOfTwoDaysMayAskFromItsFirstDayThoughItHearsNoNotice()
    {
        var shortStart = End.AddDays(-2);
        var ending = RenewalEligibility.EndingPlan(
            [Decision(CoachingFeature.Training, FeatureAccessReason.Granted, Plan, End)],
            [new PlanNotOver(Plan, false, shortStart, End)],
            shortStart);

        Assert.AreEqual(Plan, ending?.EnrollmentId);
    }

    [TestMethod]
    public void NothingRunningIsNothingEnding()
    {
        Assert.IsNull(RenewalEligibility.EndingPlan([], [], NoticeDay));
        Assert.IsNull(RenewalEligibility.EndingPlan(
            [Decision(CoachingFeature.Training, FeatureAccessReason.Expired, Plan, End)],
            [],
            End));
    }

    [TestMethod]
    public void ARequestCountsForAPlanFromTheDayItCouldBeAskedAbout() =>
        Assert.AreEqual(NoticeDay, new EndedPlan(Plan, End.AddDays(-1)).AskOpenedOn);

    [TestMethod]
    public void TheRenewalNoticesNameMyPlanAndTheOneThatStartedStaysOnToday()
    {
        Assert.IsTrue(NotificationTemplateCatalog.TryResolve(CommercialNotificationKind.EnrollmentRenewed, "en", out var renewed));
        Assert.AreEqual(
            (3, "Your coach set up your next plan", "It follows on from this one. Open My plan to see where your plan stands."),
            (renewed.Version, renewed.Title, renewed.Body));

        Assert.IsTrue(NotificationTemplateCatalog.TryResolveForEnrollment(CommercialNotificationKind.EnrollmentRenewed, "en", true, out var more));
        Assert.AreEqual(
            (2, "commercial.pack-renewed", "Open My plan to see where your sessions stand."),
            (more.Version, more.Key, more.Body));

        Assert.IsTrue(NotificationTemplateCatalog.TryResolve(CommercialNotificationKind.EnrollmentActivated, "en", out var started));
        Assert.AreEqual((2, "Open Today to see what your coach has set up for you."), (started.Version, started.Body));
        Assert.IsTrue(NotificationTemplateCatalog.TryResolveForEnrollment(CommercialNotificationKind.EnrollmentActivated, "en", true, out var ready));
        Assert.AreEqual((1, "Open Today to see how many you have."), (ready.Version, ready.Body));
    }

    [TestMethod]
    public void TheCoachsNoticeIsTrueBeforeTheEndToo()
    {
        Assert.IsTrue(NotificationTemplateCatalog.TryResolve(CommercialNotificationKind.RenewalRequested, "en", out var asked));

        Assert.AreEqual(
            (2, "Maya Rahman asked to renew", "Open the client's page to set up a renewal."),
            (asked.Version, NotificationTemplateCatalog.NameClient(asked, "Maya Rahman").Title, asked.Body));
    }

    private static EndingPlan? Ending(DateOnly today) =>
        RenewalEligibility.EndingPlan([Decision(CoachingFeature.Training, FeatureAccessReason.Granted, Plan, End)], [Running(Plan)], today);

    private static PlanNotOver Running(Guid id) => new(id, false, Start, End);

    private static FeatureAccessDecision Decision(
        CoachingFeature feature,
        FeatureAccessReason reason,
        Guid? enrollmentId = null,
        DateOnly? untilExclusive = null) =>
        new(feature, reason == FeatureAccessReason.Granted, reason, enrollmentId, null, untilExclusive);
}
