using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Training;
using TB.Gym.SharedKernel;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// Coach Today and the client list (R3.1): the training signals (TRN-021) and the attention rule
/// with the status it gives each client (CLI-018). Read on Thu 1 Oct 2026.
/// </summary>
[TestClass]
public sealed class CoachAttentionDomainTests
{
    private static readonly DateOnly Today = new(2026, 10, 1);
    private static readonly Guid Block = Guid.Parse("31000000-0000-0000-0000-000000000001");

    [TestMethod]
    public void OnlySessionsMissedAfterTheLatestWorkoutCount()
    {
        var sessions = new[]
        {
            Session(-10),
            Session(-8),
            Session(-5, WorkoutExecutionStatus.Completed),
            Session(-3),
            Session(-1),
        };

        Assert.AreEqual(2, TrainingAttentionPolicy.MissedSinceLastWorkout(sessions, Today.AddDays(-5), Today));
        // Training again, even on a day with no session, puts the client back on track.
        Assert.AreEqual(0, TrainingAttentionPolicy.MissedSinceLastWorkout(sessions, Today, Today));
    }

    [TestMethod]
    public void AClientWhoNeverTrainedIsCountedBackFourteenDays()
    {
        var sessions = new[] { Session(-15), Session(-14), Session(-7) };

        Assert.AreEqual(2, TrainingAttentionPolicy.MissedSinceLastWorkout(sessions, null, Today));
        // A workout older than the window changes nothing.
        Assert.AreEqual(2, TrainingAttentionPolicy.MissedSinceLastWorkout(sessions, Today.AddDays(-30), Today));
    }

    [TestMethod]
    public void TodayAFutureSessionAndAStartedWorkoutAreNeverMissed()
    {
        var sessions = new[]
        {
            Session(-2, WorkoutExecutionStatus.InProgress),
            Session(0),
            Session(1),
        };

        Assert.AreEqual(0, TrainingAttentionPolicy.MissedSinceLastWorkout(sessions, null, Today));
    }

    [TestMethod]
    public void AnUnsharedWeekIsFlaggedWhileItRunsOrOnceItStartsWithinTwoDays()
    {
        Assert.AreEqual(1, TrainingAttentionPolicy.WeekToShare([Week(1, -6, false)], Today)?.WeekNumber);
        Assert.AreEqual(2, TrainingAttentionPolicy.WeekToShare([Week(2, 2, false)], Today)?.WeekNumber);
        Assert.IsNull(TrainingAttentionPolicy.WeekToShare([Week(3, 3, false)], Today), "Too early to ask.");
        Assert.IsNull(TrainingAttentionPolicy.WeekToShare([Week(0, -7, false)], Today), "That week is over.");
        Assert.IsNull(TrainingAttentionPolicy.WeekToShare([Week(1, -3, true)], Today), "Already shared.");

        var earliest = TrainingAttentionPolicy.WeekToShare([Week(2, 1, false), Week(1, -6, false)], Today);
        Assert.AreEqual((Block, 1, Today.AddDays(-6)), (earliest?.MesocycleId, earliest?.WeekNumber, earliest?.StartsOn));
    }

    [TestMethod]
    public void EachSignalRaisesItsKindInRankOrder()
    {
        var everything = new ClientAttentionSignals(1, 3, null, Today, true, 2, true);

        CollectionAssert.AreEqual(
            new[]
            {
                CoachAttentionKind.CheckInToReview,
                CoachAttentionKind.UnreadMessages,
                CoachAttentionKind.PlanEndingSoon,
                CoachAttentionKind.WeekNotShared,
                CoachAttentionKind.MissedSessions,
                CoachAttentionKind.NoProgram,
            },
            CoachAttentionPolicy.Flags(everything, ClientPlanState.Running, Today).ToArray());
        Assert.IsEmpty(CoachAttentionPolicy.Flags(Quiet(), ClientPlanState.Running, Today));
        Assert.IsEmpty(CoachAttentionPolicy.Flags(Quiet() with { MissedSinceLastWorkout = 1 }, ClientPlanState.Running, Today),
            "One missed session is not yet a pattern.");
    }

    [TestMethod]
    public void APlanEndsSoonOnlyWhileItRunsAndWithinFourteenDays()
    {
        Assert.Contains(CoachAttentionKind.PlanEndingSoon, CoachAttentionPolicy.Flags(
            Quiet() with { PlanLastDay = Today.AddDays(13) }, ClientPlanState.Running, Today));
        Assert.IsEmpty(CoachAttentionPolicy.Flags(
            Quiet() with { PlanLastDay = Today.AddDays(14) }, ClientPlanState.Running, Today));
        Assert.IsEmpty(CoachAttentionPolicy.Flags(
            Quiet() with { PlanLastDay = Today.AddDays(3) }, ClientPlanState.Paused, Today),
            "A paused plan shows as paused, not as ending.");
    }

    [TestMethod]
    public void ARenewalRequestCountsForThirtyDaysWhileThePlanIsStillEnded()
    {
        Assert.Contains(CoachAttentionKind.RenewalRequested, CoachAttentionPolicy.Flags(
            Quiet() with { RenewalRequestedOn = Today.AddDays(-29) }, ClientPlanState.Ended, Today));
        Assert.IsEmpty(CoachAttentionPolicy.Flags(
            Quiet() with { RenewalRequestedOn = Today.AddDays(-30) }, ClientPlanState.Ended, Today));
        Assert.IsEmpty(CoachAttentionPolicy.Flags(
            Quiet() with { RenewalRequestedOn = Today }, ClientPlanState.NotStarted, Today),
            "Once a renewal is waiting to start, the request has been answered.");
    }

    [TestMethod]
    public void TheStatusPutsAnythingToActOnFirstAndAPlanEndingAloneAsEndingSoon()
    {
        Assert.AreEqual(ClientOverviewStatus.NeedsAttention, CoachAttentionPolicy.Status(
            [CoachAttentionKind.PlanEndingSoon, CoachAttentionKind.UnreadMessages], ClientPlanState.Running));
        Assert.AreEqual(ClientOverviewStatus.NeedsAttention, CoachAttentionPolicy.Status(
            [CoachAttentionKind.RenewalRequested], ClientPlanState.Ended));
        Assert.AreEqual(ClientOverviewStatus.EndingSoon, CoachAttentionPolicy.Status(
            [CoachAttentionKind.PlanEndingSoon], ClientPlanState.Running));
        Assert.AreEqual(ClientOverviewStatus.Paused, CoachAttentionPolicy.Status([], ClientPlanState.Paused));
        Assert.AreEqual(ClientOverviewStatus.OnTrack, CoachAttentionPolicy.Status([], ClientPlanState.Running));
        foreach (var state in new[]
        {
            ClientPlanState.PaymentDue, ClientPlanState.NotStarted, ClientPlanState.Ended,
            ClientPlanState.None, ClientPlanState.Blocked,
        })
        {
            Assert.AreEqual(ClientOverviewStatus.NoActivePlan, CoachAttentionPolicy.Status([], state), state.ToString());
        }
    }

    [TestMethod]
    public void ThePlanStateIsReadFromTheFeatureDecisions()
    {
        Assert.AreEqual(ClientPlanState.Running, CoachAttentionPolicy.PlanState(
            [Decision(CoachingFeature.Training, FeatureAccessReason.Granted),
             Decision(CoachingFeature.Nutrition, FeatureAccessReason.Paused)]));
        Assert.AreEqual(ClientPlanState.Paused, CoachAttentionPolicy.PlanState(
            [Decision(CoachingFeature.Training, FeatureAccessReason.Paused),
             Decision(CoachingFeature.Nutrition, FeatureAccessReason.PaymentRequired)]));
        Assert.AreEqual(ClientPlanState.PaymentDue, CoachAttentionPolicy.PlanState(
            [Decision(CoachingFeature.Training, FeatureAccessReason.Expired),
             Decision(CoachingFeature.Nutrition, FeatureAccessReason.PaymentRequired)]));
        Assert.AreEqual(ClientPlanState.NotStarted, CoachAttentionPolicy.PlanState(
            [Decision(CoachingFeature.Training, FeatureAccessReason.NotStarted)]));
        Assert.AreEqual(ClientPlanState.Ended, CoachAttentionPolicy.PlanState(
            [Decision(CoachingFeature.Training, FeatureAccessReason.Cancelled),
             Decision(CoachingFeature.Nutrition, FeatureAccessReason.NoEntitlement)]));
        Assert.AreEqual(ClientPlanState.Blocked, CoachAttentionPolicy.PlanState(
            [Decision(CoachingFeature.Training, FeatureAccessReason.RelationshipBlocked)]));
        Assert.AreEqual(ClientPlanState.None, CoachAttentionPolicy.PlanState(
            [Decision(CoachingFeature.Training, FeatureAccessReason.NoEntitlement)]));
    }

    [TestMethod]
    public void AClientIsNewForFourteenDays()
    {
        Assert.IsTrue(CoachAttentionPolicy.IsNew(Today.AddDays(-13), Today));
        Assert.IsFalse(CoachAttentionPolicy.IsNew(Today.AddDays(-14), Today));
    }

    [TestMethod]
    public void TheQueueRanksByKindThenMoreMissedThenLongestWaiting()
    {
        var maya = Client("Maya", "Rahman");
        var omar = Client("Omar", "Nasser");
        var sara = Client("Sara", "Haddad");
        var ranked = CoachAttentionPolicy.Rank(
        [
            Item(CoachAttentionKind.MissedSessions, maya, count: 2),
            Item(CoachAttentionKind.MissedSessions, omar, count: 4),
            Item(CoachAttentionKind.CheckInToReview, sara, since: At(-1)),
            Item(CoachAttentionKind.CheckInToReview, maya, since: At(-5)),
            Item(CoachAttentionKind.NoProgram, omar, date: Today.AddDays(-2)),
            Item(CoachAttentionKind.UnreadMessages, omar, since: At(-9)),
        ]);

        Assert.AreEqual(
            "CheckInToReview Maya, CheckInToReview Sara, UnreadMessages Omar, MissedSessions Omar, " +
            "MissedSessions Maya, NoProgram Omar",
            string.Join(", ", ranked.Select(item => $"{item.Kind} {item.Client.FirstName}")));
    }

    private static AttentionSession Session(int dayOffset, WorkoutExecutionStatus? workout = null) =>
        new(Today.AddDays(dayOffset), workout);

    private static AttentionWeek Week(int number, int startOffset, bool isPublished) =>
        new(Block, number, Today.AddDays(startOffset), isPublished);

    private static ClientAttentionSignals Quiet() => new(0, 0, null, null, false, 0, false);

    private static FeatureAccessDecision Decision(CoachingFeature feature, FeatureAccessReason reason) =>
        new(feature, reason == FeatureAccessReason.Granted, reason);

    private static CoachClientRef Client(string firstName, string lastName) =>
        new(Guid.NewGuid(), firstName, lastName, Guid.Empty, "Coach");

    private static DateTimeOffset At(int hours) =>
        new DateTimeOffset(2026, 10, 1, 12, 0, 0, TimeSpan.Zero).AddHours(hours);

    private static CoachAttentionItemView Item(
        CoachAttentionKind kind,
        CoachClientRef client,
        DateTimeOffset? since = null,
        DateOnly? date = null,
        int? count = null) =>
        new(kind, client, since, date, count, null, null);
}
