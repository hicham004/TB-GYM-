using TB.Gym.Modules.Training;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// The audit's batch A9, the client's Today, Training and Progress (docs/FULL-AUDIT-2026-10.md, section 11): a
/// client may start a missed session of a running program late ("Do it now", the owner's decision of 2026-10-19,
/// CLIENT-12), it then counts as done rather than missed, and both reads say it was done late (TRN-020 v2).
/// </summary>
[TestClass]
public sealed class A9ClientScreensDomainTests
{
    private static readonly DateOnly Monday = new(2026, 10, 19);

    [TestMethod]
    public void TheSessionStateRuleIsVersionTwo()
    {
        Assert.AreEqual(("WorkoutThenScheduledDate", 2), (ClientSessionStatePolicy.Key, ClientSessionStatePolicy.Version));
    }

    [TestMethod]
    public void AMissedSessionStartedLateIsInProgressThenDoneAndNeverMissed()
    {
        var wednesday = Monday.AddDays(2);
        Assert.AreEqual(ClientSessionState.Missed, ClientSessionStatePolicy.Evaluate(Monday, wednesday, null));
        Assert.AreEqual(ClientSessionState.InProgress,
            ClientSessionStatePolicy.Evaluate(Monday, wednesday, WorkoutExecutionStatus.InProgress));
        Assert.AreEqual(ClientSessionState.Completed,
            ClientSessionStatePolicy.Evaluate(Monday, wednesday, WorkoutExecutionStatus.Completed));
        Assert.AreEqual(ClientSessionState.Completed,
            ClientSessionStatePolicy.EvaluateForCoach(Monday, wednesday, WorkoutExecutionStatus.Completed, true, false));
    }

    [TestMethod]
    public void ASessionIsDoneLateOnlyWhenItsWorkoutStartedOnALaterDay()
    {
        Assert.IsTrue(ClientSessionStatePolicy.IsLate(Monday, Monday.AddDays(2)));
        Assert.IsTrue(ClientSessionStatePolicy.IsLate(Monday, Monday.AddDays(1)));
        Assert.IsFalse(ClientSessionStatePolicy.IsLate(Monday, Monday), "Started on its own day.");
        Assert.IsFalse(ClientSessionStatePolicy.IsLate(Monday, null), "Never started.");
        Assert.IsFalse(ClientSessionStatePolicy.IsLate(Monday, Monday.AddDays(-1)), "Started early is not late.");
    }

    [TestMethod]
    public void TheStartDayIsReadInTheProgramsTimeZone()
    {
        // 22:30 UTC on Monday is already Tuesday 01:30 in Beirut (UTC+3 until 25 Oct).
        var instant = new DateTimeOffset(2026, 10, 19, 22, 30, 0, TimeSpan.Zero);
        Assert.AreEqual(Monday.AddDays(1), ClientSessionStatePolicy.StartedOn(instant, "Asia/Beirut"));
        Assert.AreEqual(Monday, ClientSessionStatePolicy.StartedOn(instant, "UTC"));

        // A workout started at 23:50 on its day and finished after midnight is not late.
        var lateEvening = new DateTimeOffset(2026, 10, 19, 20, 50, 0, TimeSpan.Zero);
        Assert.IsFalse(ClientSessionStatePolicy.IsLate(Monday,
            ClientSessionStatePolicy.StartedOn(lateEvening, "Asia/Beirut")));
    }
}
