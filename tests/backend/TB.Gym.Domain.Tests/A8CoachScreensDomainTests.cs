using TB.Gym.Modules.Clients;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// The audit's batch A8, coach screens and sheets (docs/FULL-AUDIT-2026-10.md, section 11): Coach Today asks a
/// coach to start a plan for a new client who has none (COACH-9, the owner's decision of 2026-10-19), ranked after
/// a renewal request, and the attention rule says so as version 3 (CLI-018). Read on Thu 1 Oct 2026.
/// </summary>
[TestClass]
public sealed class A8CoachScreensDomainTests
{
    private static readonly DateOnly Today = new(2026, 10, 1);

    [TestMethod]
    public void ANewClientWithNoPlanAsksForOneForFourteenDays()
    {
        CollectionAssert.AreEqual(
            new[] { CoachAttentionKind.NoPlan },
            CoachAttentionPolicy.Flags(Joined(Today), ClientPlanState.None, Today).ToArray());
        Assert.Contains(CoachAttentionKind.NoPlan,
            CoachAttentionPolicy.Flags(Joined(Today.AddDays(-13)), ClientPlanState.None, Today));
        Assert.IsEmpty(CoachAttentionPolicy.Flags(Joined(Today.AddDays(-14)), ClientPlanState.None, Today),
            "After fourteen days the client is no longer new; the list still says No plan yet.");
        Assert.IsEmpty(CoachAttentionPolicy.Flags(Quiet(), ClientPlanState.None, Today),
            "Without the day they joined there is nothing to weigh.");
    }

    [TestMethod]
    public void OnlyNoPlanAtAllIsNoPlan()
    {
        foreach (var state in new[]
        {
            ClientPlanState.Running, ClientPlanState.Paused, ClientPlanState.PaymentDue,
            ClientPlanState.NotStarted, ClientPlanState.Ended, ClientPlanState.Blocked,
        })
        {
            Assert.DoesNotContain(CoachAttentionKind.NoPlan,
                CoachAttentionPolicy.Flags(Joined(Today), state, Today), state.ToString());
        }
    }

    [TestMethod]
    public void ANewClientWithNoPlanNeedsAttention()
    {
        Assert.AreEqual(ClientOverviewStatus.NeedsAttention,
            CoachAttentionPolicy.Status([CoachAttentionKind.NoPlan], ClientPlanState.None));
        Assert.AreEqual(ClientOverviewStatus.NoActivePlan,
            CoachAttentionPolicy.Status([], ClientPlanState.None), "Once no longer new, no plan is just no plan.");
    }

    [TestMethod]
    public void NoPlanRanksAfterARenewalRequestAndBeforeAPlanEndingSoon()
    {
        CollectionAssert.AreEqual(
            new[]
            {
                CoachAttentionKind.CheckInToReview,
                CoachAttentionKind.UnreadMessages,
                CoachAttentionKind.RenewalRequested,
                CoachAttentionKind.NoPlan,
                CoachAttentionKind.PlanEndingSoon,
                CoachAttentionKind.WeekNotShared,
                CoachAttentionKind.MissedSessions,
                CoachAttentionKind.NoProgram,
                CoachAttentionKind.MaxesToReview,
            },
            Enum.GetValues<CoachAttentionKind>().OrderBy(CoachAttentionPolicy.RankOf).ToArray());

        var rita = Client("Rita", "Daher");
        var omar = Client("Omar", "Nasser");
        var sara = Client("Sara", "Haddad");
        var ranked = CoachAttentionPolicy.Rank(
        [
            Item(CoachAttentionKind.PlanEndingSoon, sara, date: Today.AddDays(3)),
            Item(CoachAttentionKind.NoPlan, rita, date: Today.AddDays(-2)),
            Item(CoachAttentionKind.MaxesToReview, omar),
            Item(CoachAttentionKind.RenewalRequested, omar, date: Today.AddDays(-1)),
            Item(CoachAttentionKind.NoPlan, sara, date: Today),
        ]);

        Assert.AreEqual(
            "RenewalRequested Omar, NoPlan Rita, NoPlan Sara, PlanEndingSoon Sara, MaxesToReview Omar",
            string.Join(", ", ranked.Select(item => $"{item.Kind} {item.Client.FirstName}")),
            "Within the kind, the client who joined first waits longest.");
    }

    [TestMethod]
    public void TheAttentionRuleIsVersionThree()
    {
        Assert.AreEqual(("CoachAttention", 3), (CoachAttentionPolicy.Key, CoachAttentionPolicy.Version));
    }

    private static ClientAttentionSignals Quiet() => new(0, 0, null, null, false, 0, false);

    private static ClientAttentionSignals Joined(DateOnly day) => Quiet() with { JoinedOn = day };

    private static CoachClientRef Client(string firstName, string lastName) =>
        new(Guid.NewGuid(), firstName, lastName, Guid.Empty, "Coach");

    private static CoachAttentionItemView Item(CoachAttentionKind kind, CoachClientRef client, DateOnly? date = null) =>
        new(kind, client, null, date, null, null, null);
}
