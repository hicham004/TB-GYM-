using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Subscriptions;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// The notes plan's N9c5a, part B (CLI-026 as N9c5 amends it): a trainee of the house on Max is coached while Max
/// grants, and trains as their own coach again the house's day it stops. Who the house coaches is
/// <see cref="HouseTierRule.CoachesTheTrainee"/> of the tier <see cref="HouseTierRule.TierOn"/> reads, and what that
/// changes on Coach Today is only the bool the reader hands coach attention v9, with no plan end of the house's. Every
/// figure is the tests' own.
/// </summary>
[TestClass]
public sealed class N9c5MaxCoachedDomainTests
{
    private static readonly DateOnly Today = new(2026, 11, 14);

    [TestMethod]
    public void N9c5CTheHouseCoachesATraineeOnMaxAloneAndNobodyOnNoTier()
    {
        (HouseTier? Tier, bool Coached)[] cases =
        [
            (null, false),
            (HouseTier.Free, false),
            (HouseTier.ProPlus, false),
            (HouseTier.Max, true),
        ];
        CollectionAssert.AreEquivalent(
            Enum.GetValues<HouseTier>(),
            cases.Where(item => item.Tier is not null).Select(item => item.Tier!.Value).ToArray(),
            "Every tier there is is a case.");

        foreach (var (tier, coached) in cases)
        {
            Assert.AreEqual(coached, HouseTierRule.CoachesTheTrainee(tier), tier?.ToString() ?? "no tier");
        }
    }

    [TestMethod]
    public void N9c5CMaxCoachesOnlyOnTheDaysItGrantsAndTheTraineeIsTheirOwnCoachAgainTheDayItEnds()
    {
        var free = Candidate(HouseTier.Free, -10, 355, EnrollmentStatus.Active, 0m, 0m);
        var max = Candidate(HouseTier.Max, -3, 25, EnrollmentStatus.Active, 141.17m, 141.17m);

        // Active, covering the day and paid in full: Max over Free, and the house coaches them, its last day included.
        Assert.IsTrue(Coached([free, max], Today));
        Assert.IsTrue(Coached([free, max], Today.AddDays(24)), "Its last day.");
        Assert.IsTrue(Coached([max, free, Candidate(HouseTier.ProPlus, -40, -12, EnrollmentStatus.Active, 47.5m, 47.5m)], Today));

        // The house's day its exclusive end comes, Free alone grants: their own coach again, with nothing written.
        Assert.IsFalse(Coached([free, max], Today.AddDays(25)), "Max ended.");
        Assert.IsFalse(Coached([free, max], Today.AddDays(-4)), "Before Max began.");

        // A Max that grants nothing coaches nobody: the trainee reads Free under it (SUB-019).
        (HouseTierCandidate Max, string Why)[] silent =
        [
            (max with { Status = EnrollmentStatus.Paused }, "Paused."),
            (max with { Status = EnrollmentStatus.Cancelled }, "Cancelled."),
            (max with { Status = EnrollmentStatus.PendingPayment, PaidAmount = 0m }, "Waiting for its money."),
            (max with { PaidAmount = 141.16m }, "A part grants nothing (SUB-008)."),
            (max with { StartDate = Today.AddDays(1) }, "Starting tomorrow."),
        ];
        foreach (var (candidate, why) in silent)
        {
            Assert.AreEqual(HouseTier.Free, HouseTierRule.TierOn([free, candidate], Today, relationshipBlocked: false), why);
            Assert.IsFalse(Coached([free, candidate], Today), why);
        }

        // Pro+ and Free leave the trainee their own coach, and a block grants no tier at all.
        Assert.IsFalse(Coached([free, Candidate(HouseTier.ProPlus, -3, 25, EnrollmentStatus.Active, 47.5m, 47.5m)], Today));
        Assert.IsFalse(Coached([free], Today));
        Assert.IsFalse(HouseTierRule.CoachesTheTrainee(HouseTierRule.TierOn([free, max], Today, relationshipBlocked: true)));
    }

    [TestMethod]
    public void N9c5CATraineeOnMaxRaisesWhatACoachsClientRaisesButNeverAPlanOfTheHouseEnding()
    {
        // What the reader hands the rule for a trainee on Max: not their own coach, and no plan end or renewal ask of
        // the house's, whatever the plan's days. Coach attention stays at version 9: only its input changed.
        Assert.AreEqual(("CoachAttention", 9), (CoachAttentionPolicy.Key, CoachAttentionPolicy.Version));
        var onMax = new ClientAttentionSignals(
            CheckInsToReview: 1,
            UnreadMessages: 2,
            RenewalRequestedOn: null,
            PlanLastDay: null,
            HasWeekToShare: false,
            MissedSinceLastWorkout: 2,
            HasNoProgram: true,
            JoinedOn: Today.AddDays(-30),
            CheckInsOverdue: 1);

        var flags = CoachAttentionPolicy.Flags(onMax, ClientPlanState.Running, Today);
        Assert.AreEqual(
            "CheckInToReview, UnreadMessages, MissedSessions, CheckInOverdue, NoProgram",
            string.Join(", ", flags));
        Assert.AreEqual(ClientOverviewStatus.NeedsAttention, CoachAttentionPolicy.Status(flags, ClientPlanState.Running));

        // The same Max three days from its end, with nothing else to act on: On track, since a plan of the house is
        // asked for by the trainee, never chased on Today (the staff's Renew would book Max outside its places).
        var quiet = new ClientAttentionSignals(0, 0, null, null, false, 0, false, Today.AddDays(-30));
        var quietFlags = CoachAttentionPolicy.Flags(quiet, ClientPlanState.Running, Today);
        Assert.IsEmpty(quietFlags);
        Assert.AreEqual(
            (ClientOverviewStatus.OnTrack, ClientPlanStatus.OnTrack),
            (CoachAttentionPolicy.Status(quietFlags, ClientPlanState.Running), CoachAttentionPolicy.PlanStatus(quietFlags, ClientPlanState.Running)));

        // Once Max ends the reader says self-directed again, and the same signals raise nothing.
        Assert.IsEmpty(CoachAttentionPolicy.Flags(onMax with { SelfDirected = true }, ClientPlanState.Running, Today));
    }

    private static bool Coached(HouseTierCandidate[] candidates, DateOnly day) =>
        HouseTierRule.CoachesTheTrainee(HouseTierRule.TierOn(candidates, day, relationshipBlocked: false));

    private static HouseTierCandidate Candidate(
        HouseTier tier,
        int fromDays,
        int toDaysExclusive,
        EnrollmentStatus status,
        decimal price,
        decimal paid) =>
        new(tier, Today.AddDays(fromDays), Today.AddDays(toDaysExclusive), status, price, paid);
}
