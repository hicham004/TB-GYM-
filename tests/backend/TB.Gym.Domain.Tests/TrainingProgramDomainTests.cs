using TB.Gym.Modules.Training;
using TB.Gym.SharedKernel;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// The client's Training page (R2.5b): session state v1 (TRN-020) and the record rule applied to
/// one finished workout in history (TRN-019). Read on Wed 30 Sep 2026.
/// </summary>
[TestClass]
public sealed class TrainingProgramDomainTests
{
    private static readonly DateOnly Today = new(2026, 9, 30);
    private static readonly Guid Squat = Guid.Parse("30000000-0000-0000-0000-000000000101");
    private static readonly Guid Bench = Guid.Parse("30000000-0000-0000-0000-000000000102");

    [TestMethod]
    public void ANeverStartedSessionIsJudgedByItsDateAgainstTheWorkspaceToday()
    {
        Assert.AreEqual(ClientSessionState.Missed,
            ClientSessionStatePolicy.Evaluate(Today.AddDays(-1), Today, null));
        Assert.AreEqual(ClientSessionState.Today, ClientSessionStatePolicy.Evaluate(Today, Today, null));
        Assert.AreEqual(ClientSessionState.Upcoming,
            ClientSessionStatePolicy.Evaluate(Today.AddDays(1), Today, null));
    }

    [TestMethod]
    public void TheWorkoutDecidesBeforeTheDateSoALateFinishIsNeverMissed()
    {
        Assert.AreEqual(ClientSessionState.Completed,
            ClientSessionStatePolicy.Evaluate(Today.AddDays(-6), Today, WorkoutExecutionStatus.Completed));
        Assert.AreEqual(ClientSessionState.InProgress,
            ClientSessionStatePolicy.Evaluate(Today.AddDays(-2), Today, WorkoutExecutionStatus.InProgress));
        Assert.AreEqual(ClientSessionState.Completed,
            ClientSessionStatePolicy.Evaluate(Today, Today, WorkoutExecutionStatus.Completed));
    }

    [TestMethod]
    public void ACoachSeesTheClientsStateWhereTheyCouldTrainAndNoneWhereTheyCouldNot()
    {
        // A shared week of a running block: the client's own rule.
        Assert.AreEqual(ClientSessionState.Missed,
            ClientSessionStatePolicy.EvaluateForCoach(Today.AddDays(-1), Today, null, true, false));
        Assert.AreEqual(ClientSessionState.Today,
            ClientSessionStatePolicy.EvaluateForCoach(Today, Today, null, true, false));
        Assert.AreEqual(ClientSessionState.Upcoming,
            ClientSessionStatePolicy.EvaluateForCoach(Today.AddDays(1), Today, null, true, false));

        // Never started in a week that is not shared, or in a cancelled block: the client could not
        // train it, so it is neither missed nor still to come.
        Assert.IsNull(ClientSessionStatePolicy.EvaluateForCoach(Today.AddDays(-1), Today, null, false, false));
        Assert.IsNull(ClientSessionStatePolicy.EvaluateForCoach(Today.AddDays(3), Today, null, false, false));
        Assert.IsNull(ClientSessionStatePolicy.EvaluateForCoach(Today.AddDays(-1), Today, null, true, true));
        Assert.IsNull(ClientSessionStatePolicy.EvaluateForCoach(Today.AddDays(3), Today, null, true, true));
    }

    [TestMethod]
    public void AWorkoutStillDecidesForTheCoachInAnUnsharedWeekOrACancelledBlock()
    {
        Assert.AreEqual(ClientSessionState.Completed,
            ClientSessionStatePolicy.EvaluateForCoach(Today.AddDays(-4), Today, WorkoutExecutionStatus.Completed, false, true));
        Assert.AreEqual(ClientSessionState.InProgress,
            ClientSessionStatePolicy.EvaluateForCoach(Today, Today, WorkoutExecutionStatus.InProgress, false, false));
        Assert.AreEqual(ClientSessionState.Completed,
            ClientSessionStatePolicy.EvaluateForCoach(Today.AddDays(-4), Today, WorkoutExecutionStatus.Completed, true, false));
    }

    [TestMethod]
    public void AWorkoutSetsARecordOnlyByBeatingEveryEarlierWorkoutAndItsOwnEarlierSets()
    {
        var earlier = new[]
        {
            Set(Squat, 5, 100m),
            Set(Squat, 5, 102.5m),
            Set(Squat, 3, 110m),
        };
        var first = Set(Squat, 5, 102.5m); // a tie with the best is not a record
        var second = Set(Squat, 5, 105m);
        var third = Set(Squat, 5, 105m); // ties the set just logged in the same workout
        var fourth = Set(Squat, 3, 112.5m);

        var records = WorkoutPersonalRecordRule.RecordSetIds([first, second, third, fourth], earlier);

        CollectionAssert.AreEqual(new[] { second.SetId, fourth.SetId }, records.ToArray());
    }

    [TestMethod]
    public void RecordsAreKeptApartByExerciseRepsAndUnitAndIgnoreUnfinishedSets()
    {
        var earlier = new[] { Set(Squat, 5, 100m) };
        var otherExercise = Set(Bench, 5, 60m);
        var pounds = Set(Squat, 5, 90m, TrainingLoadUnit.Pound);
        var notDone = Set(Squat, 5, 120m, completed: false);
        var noLoad = new PerformedSet(Guid.NewGuid(), Squat, 5, null, TrainingLoadUnit.Kilogram, true);

        var records = WorkoutPersonalRecordRule.RecordSetIds([otherExercise, pounds, notDone, noLoad], earlier);

        // A first bench set and a first set in pounds are records; kg and lb are never compared.
        CollectionAssert.AreEqual(new[] { otherExercise.SetId, pounds.SetId }, records.ToArray());
    }

    [TestMethod]
    public void ACoachReadsTrainingWhileThePlanRunsAndBeforeABookedPlanBegins()
    {
        var training = CoachingFeature.Training;
        var later = Today.AddDays(5);

        Assert.IsTrue(CoachTrainingReadPolicy.Opens(
            new FeatureAccessDecision(training, true, FeatureAccessReason.Granted), Today));
        Assert.IsTrue(CoachTrainingReadPolicy.Opens(
            new FeatureAccessDecision(training, false, FeatureAccessReason.NotStarted, Guid.NewGuid(), later), Today));
        // A booked plan still waiting for its payment opens too; one already running unpaid does not.
        Assert.IsTrue(CoachTrainingReadPolicy.Opens(
            new FeatureAccessDecision(training, false, FeatureAccessReason.PaymentRequired, Guid.NewGuid(), later), Today));
        Assert.IsFalse(CoachTrainingReadPolicy.Opens(
            new FeatureAccessDecision(training, false, FeatureAccessReason.PaymentRequired, Guid.NewGuid(), Today), Today));

        foreach (var closed in new[]
                 {
                     FeatureAccessReason.Expired, FeatureAccessReason.Paused, FeatureAccessReason.Cancelled,
                     FeatureAccessReason.NoEntitlement, FeatureAccessReason.RelationshipBlocked,
                     FeatureAccessReason.MembershipInactive, FeatureAccessReason.PlatformBlocked,
                 })
        {
            Assert.IsFalse(
                CoachTrainingReadPolicy.Opens(new FeatureAccessDecision(training, false, closed, Guid.NewGuid(), later), Today),
                closed.ToString());
        }
    }

    private static PerformedSet Set(
        Guid exerciseId,
        int reps,
        decimal load,
        TrainingLoadUnit unit = TrainingLoadUnit.Kilogram,
        bool completed = true) =>
        new(Guid.NewGuid(), exerciseId, reps, load, unit, completed);
}
