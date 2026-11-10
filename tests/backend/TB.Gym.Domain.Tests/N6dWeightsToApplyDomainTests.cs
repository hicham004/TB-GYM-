using TB.Gym.Modules.Clients;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// Coach attention v8 (CLI-018, the notes plan's N6d; decision 21 of 5 Nov 2026: the coach applies each week's weight):
/// a client with lifts whose coming workout has a weight to apply raises weights to apply, ranked last and never Needs
/// attention, the client who trains soonest first. Read on Tue 10 Nov 2026.
/// </summary>
[TestClass]
public sealed class N6dWeightsToApplyDomainTests
{
    private static readonly DateOnly Today = new(2026, 11, 10);

    [TestMethod]
    public void WeightsToApplyAreRaisedWhileALiftHasAWeightToApply()
    {
        Assert.IsEmpty(CoachAttentionPolicy.Flags(Quiet(), ClientPlanState.Running, Today));
        CollectionAssert.AreEqual(
            new[] { CoachAttentionKind.WeightsToApply },
            CoachAttentionPolicy.Flags(Quiet() with { WeightsToApply = 1 }, ClientPlanState.Running, Today).ToArray());
        CollectionAssert.AreEqual(
            new[] { CoachAttentionKind.WeightsToApply },
            CoachAttentionPolicy.Flags(Quiet() with { WeightsToApply = 3 }, ClientPlanState.Running, Today).ToArray());
    }

    [TestMethod]
    public void WeightsToApplyComeLastAfterNoProgram()
    {
        var flags = CoachAttentionPolicy.Flags(
            Quiet() with { MissedSinceLastWorkout = 2, HasNoProgram = true, WeightsToApply = 2, CheckInsToReview = 1 },
            ClientPlanState.Running,
            Today);
        CollectionAssert.AreEqual(
            new[]
            {
                CoachAttentionKind.CheckInToReview,
                CoachAttentionKind.MissedSessions,
                CoachAttentionKind.NoProgram,
                CoachAttentionKind.WeightsToApply,
            },
            flags.ToArray(),
            "The flags keep the queue's order, which the Clients row shows as it is.");
        Assert.AreEqual(Enum.GetValues<CoachAttentionKind>().Length - 1, CoachAttentionPolicy.RankOf(CoachAttentionKind.WeightsToApply));
        Assert.IsGreaterThan(
            CoachAttentionPolicy.RankOf(CoachAttentionKind.NoProgram), CoachAttentionPolicy.RankOf(CoachAttentionKind.WeightsToApply));
    }

    [TestMethod]
    public void WeightsToApplyAloneKeepThePlansOwnStatus()
    {
        // The coach's weekly homework for a client doing the work is no sign of one slipping: alone it leaves the plan's
        // own status, and beside anything that needs attention the client needs attention for that.
        Assert.AreEqual(ClientOverviewStatus.OnTrack,
            CoachAttentionPolicy.Status([CoachAttentionKind.WeightsToApply], ClientPlanState.Running));
        Assert.AreEqual(ClientOverviewStatus.EndingSoon,
            CoachAttentionPolicy.Status(
                [CoachAttentionKind.PlanEndingSoon, CoachAttentionKind.WeightsToApply], ClientPlanState.Running));
        Assert.AreEqual(ClientOverviewStatus.OnTrack,
            CoachAttentionPolicy.Status(
                [CoachAttentionKind.SessionsRunningOut, CoachAttentionKind.WeightsToApply], ClientPlanState.Running));
        Assert.AreEqual(ClientOverviewStatus.NeedsAttention,
            CoachAttentionPolicy.Status(
                [CoachAttentionKind.MissedSessions, CoachAttentionKind.WeightsToApply], ClientPlanState.Running));
        Assert.AreEqual(ClientPlanStatus.OnTrack,
            CoachAttentionPolicy.PlanStatus([CoachAttentionKind.WeightsToApply], ClientPlanState.Running));
    }

    [TestMethod]
    public void TheClientWhoTrainsSoonestComesFirstAmongWeightsToApply()
    {
        var maya = Client("Maya", "Fakhoury");
        var nour = Client("Nour", "Saleh");
        var jad = Client("Jad", "Karam");
        var ranked = CoachAttentionPolicy.Rank(
        [
            Item(CoachAttentionKind.WeightsToApply, maya, date: Today.AddDays(2), count: 3),
            Item(CoachAttentionKind.WeightsToApply, nour, date: Today, count: 1),
            Item(CoachAttentionKind.NoProgram, jad, date: Today.AddDays(-30)),
            Item(CoachAttentionKind.WeightsToApply, jad, date: Today.AddDays(2), count: 1),
        ]);

        Assert.AreEqual(
            "NoProgram Jad, WeightsToApply Nour, WeightsToApply Maya, WeightsToApply Jad",
            string.Join(", ", ranked.Select(item => $"{item.Kind} {item.Client.FirstName}")),
            "Within the kind the soonest workout first, then by last name; never by how many lifts.");
    }

    private static ClientAttentionSignals Quiet() => new(0, 0, null, null, false, 0, false);

    private static CoachClientRef Client(string firstName, string lastName) =>
        new(Guid.NewGuid(), firstName, lastName, Guid.Empty, "Coach");

    private static CoachAttentionItemView Item(
        CoachAttentionKind kind,
        CoachClientRef client,
        DateOnly? date = null,
        int? count = null) =>
        new(kind, client, null, date, count, null, null);
}
