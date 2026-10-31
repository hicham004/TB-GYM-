using TB.Gym.Modules.CheckIns;
using TB.Gym.Modules.Clients;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// Critique B4a, the Clients table: overdue check-ins v1 (CHK-015), which only a missing submission speaks to, and
/// coach attention v4 (CLI-018), which ranks them and gives a plan its own status beside whatever needs attention.
/// Read on Thu 1 Oct 2026.
/// </summary>
[TestClass]
public sealed class B4aClientsTableDomainTests
{
    private static readonly DateOnly Today = new(2026, 10, 1);

    [TestMethod]
    public void AnUnsentCheckInIsOverdueFromTwoToThirteenDaysAfterItsDueDay()
    {
        // The reference cases, in days since the due day: 1 no, 2 yes, 13 yes, 14 no.
        Assert.IsFalse(Overdue(daysLate: -3), "Not due yet.");
        Assert.IsFalse(Overdue(daysLate: 0), "Due today: still on time.");
        Assert.IsFalse(Overdue(daysLate: 1), "A day late does not ask yet.");
        Assert.IsTrue(Overdue(daysLate: 2));
        Assert.IsTrue(Overdue(daysLate: 13));
        Assert.IsFalse(Overdue(daysLate: 14), "Fourteen days on, it stops asking.");
        Assert.AreEqual((Today.AddDays(-13), Today.AddDays(-2)), CheckInAttentionPolicy.OverdueDueDays(Today));
    }

    [TestMethod]
    public void ADraftIsNotSentAndASentCheckInIsNeverOverdue()
    {
        Assert.IsTrue(Overdue(daysLate: 5, response: null), "Not started.");
        Assert.IsTrue(Overdue(daysLate: 5, response: CheckInResponseStatus.Draft), "A draft is the client's own until sent.");
        Assert.IsFalse(Overdue(daysLate: 5, response: CheckInResponseStatus.Submitted), "Sent late is sent.");
        Assert.IsFalse(Overdue(daysLate: 5, response: CheckInResponseStatus.Reviewed));
        Assert.IsFalse(CheckInAttentionPolicy.IsSent(CheckInResponseStatus.Draft));
        Assert.IsFalse(CheckInAttentionPolicy.IsSent(null));
    }

    [TestMethod]
    public void AnOverdueCheckInAsksOnlyWhileCheckInsAreInTodaysPlan()
    {
        Assert.IsFalse(Overdue(daysLate: 5, inPlan: false), "A plan without check-ins today closes them (CHK-011).");
        Assert.IsFalse(Overdue(daysLate: 2, response: CheckInResponseStatus.Draft, inPlan: false));
        Assert.IsTrue(Overdue(daysLate: 5, inPlan: true));
    }

    [TestMethod]
    public void TheRulesAreNamedAndVersioned()
    {
        Assert.AreEqual(("OverdueUnsentCheckIn", 1), (CheckInAttentionPolicy.Key, CheckInAttentionPolicy.Version));
        Assert.AreEqual(("CoachAttention", 6), (CoachAttentionPolicy.Key, CoachAttentionPolicy.Version),
            "Coach attention counts overdue check-ins v1; a change there is a new version here.");
    }

    [TestMethod]
    public void AnOverdueCheckInNeedsAttentionAndRanksAfterMissedSessions()
    {
        var signals = new ClientAttentionSignals(0, 0, null, null, false, 2, true, CheckInsOverdue: 1);
        CollectionAssert.AreEqual(
            new[] { CoachAttentionKind.MissedSessions, CoachAttentionKind.CheckInOverdue, CoachAttentionKind.NoProgram },
            CoachAttentionPolicy.Flags(signals, ClientPlanState.Running, Today).ToArray());

        var alone = CoachAttentionPolicy.Flags(Quiet() with { CheckInsOverdue = 2 }, ClientPlanState.Running, Today);
        CollectionAssert.AreEqual(new[] { CoachAttentionKind.CheckInOverdue }, alone.ToArray());
        Assert.AreEqual(ClientOverviewStatus.NeedsAttention, CoachAttentionPolicy.Status(alone, ClientPlanState.Running));
        Assert.IsEmpty(CoachAttentionPolicy.Flags(Quiet(), ClientPlanState.Running, Today));
    }

    [TestMethod]
    public void OverdueCheckInsQueueAfterMissedSessionsTheLongestOverdueFirst()
    {
        var recent = Item(CoachAttentionKind.CheckInOverdue, "Rami", date: Today.AddDays(-3));
        var oldest = Item(CoachAttentionKind.CheckInOverdue, "Maya", date: Today.AddDays(-10));
        var missed = Item(CoachAttentionKind.MissedSessions, "Zeina", count: 2);
        var program = Item(CoachAttentionKind.NoProgram, "Adam", date: Today.AddDays(-1));

        Assert.AreEqual(
            "Zeina, Maya, Rami, Adam",
            string.Join(", ", CoachAttentionPolicy.Rank([program, recent, oldest, missed]).Select(item => item.Client.FirstName)));
    }

    [TestMethod]
    public void APlansEndKeepsItsOwnStatusBesideWhateverNeedsAttention()
    {
        // The plan ends soon and the client needs attention: the status says the second, the plan's status the first.
        var ending = CoachAttentionPolicy.Flags(
            Quiet() with { CheckInsOverdue = 1, UnreadMessages = 2, PlanLastDay = Today.AddDays(5) },
            ClientPlanState.Running,
            Today);
        Assert.AreEqual(ClientOverviewStatus.NeedsAttention, CoachAttentionPolicy.Status(ending, ClientPlanState.Running));
        Assert.AreEqual(ClientPlanStatus.EndingSoon, CoachAttentionPolicy.PlanStatus(ending, ClientPlanState.Running));

        Assert.AreEqual(ClientPlanStatus.OnTrack,
            CoachAttentionPolicy.PlanStatus([CoachAttentionKind.CheckInToReview], ClientPlanState.Running));
        Assert.AreEqual(ClientPlanStatus.Paused,
            CoachAttentionPolicy.PlanStatus([CoachAttentionKind.UnreadMessages], ClientPlanState.Paused));
        foreach (var state in new[]
        {
            ClientPlanState.PaymentDue, ClientPlanState.NotStarted, ClientPlanState.Ended,
            ClientPlanState.None,
        })
        {
            Assert.AreEqual(ClientPlanStatus.NoActivePlan,
                CoachAttentionPolicy.PlanStatus([CoachAttentionKind.NoPlan, CoachAttentionKind.RenewalRequested], state),
                state.ToString());
        }

        // A block changes no plan (SUB-010), so the row says it is blocked, never that there is no plan (critique
        // B11). The one status the chat's panel reads keeps to the plan.
        Assert.AreEqual(ClientPlanStatus.AccessBlocked,
            CoachAttentionPolicy.PlanStatus([CoachAttentionKind.RenewalRequested], ClientPlanState.Blocked));
        Assert.AreEqual(ClientOverviewStatus.NoActivePlan, CoachAttentionPolicy.Status([], ClientPlanState.Blocked));

        // With nothing else waiting, the status is the plan's.
        Assert.AreEqual(ClientOverviewStatus.EndingSoon,
            CoachAttentionPolicy.Status([CoachAttentionKind.PlanEndingSoon], ClientPlanState.Running));
        Assert.AreEqual(ClientOverviewStatus.Paused, CoachAttentionPolicy.Status([], ClientPlanState.Paused));
    }

    [TestMethod]
    public void ThePlanEndsSoonFlagCountsTodayAmongItsFourteenDays()
    {
        // The screens show this flag rather than counting days of their own (critique B4a): 13 days left is soon.
        Assert.Contains(CoachAttentionKind.PlanEndingSoon, CoachAttentionPolicy.Flags(
            Quiet() with { PlanLastDay = Today }, ClientPlanState.Running, Today));
        Assert.Contains(CoachAttentionKind.PlanEndingSoon, CoachAttentionPolicy.Flags(
            Quiet() with { PlanLastDay = Today.AddDays(CoachAttentionPolicy.PlanEndingWithinDays - 1) },
            ClientPlanState.Running,
            Today));
        Assert.IsEmpty(CoachAttentionPolicy.Flags(
            Quiet() with { PlanLastDay = Today.AddDays(CoachAttentionPolicy.PlanEndingWithinDays) },
            ClientPlanState.Running,
            Today));
    }

    private static bool Overdue(int daysLate, CheckInResponseStatus? response = null, bool inPlan = true) =>
        CheckInAttentionPolicy.IsOverdue(Today.AddDays(-daysLate), response, inPlan, Today);

    private static ClientAttentionSignals Quiet() => new(0, 0, null, null, false, 0, false);

    private static CoachAttentionItemView Item(
        CoachAttentionKind kind,
        string firstName,
        DateOnly? date = null,
        int? count = null) =>
        new(kind, new CoachClientRef(Guid.NewGuid(), firstName, "Client", Guid.Empty, null), null, date, count, null, null);
}
