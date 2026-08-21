using TB.Gym.Modules.Media;
using TB.Gym.Modules.Strength;
using TB.Gym.Modules.Training;
using StrengthLoadUnit = TB.Gym.Modules.Strength.LoadUnit;

namespace TB.Gym.Domain.Tests;

[TestClass]
public sealed class Phase3TrainingDomainTests
{
    private static readonly Guid TenantId = Guid.Parse("10000000-0000-0000-0000-000000000003");
    private static readonly Guid ClientId = Guid.Parse("20000000-0000-0000-0000-000000000003");
    private static readonly Guid ExerciseId = Guid.Parse("30000000-0000-0000-0000-000000000003");
    private static readonly Guid AlternativeId = Guid.Parse("30000000-0000-0000-0000-000000000004");
    private static readonly DateTimeOffset Now = new(2026, 8, 20, 10, 0, 0, TimeSpan.Zero);

    [TestMethod]
    public void AssignmentIsADeepClientSnapshotIndependentFromTemplateVersion()
    {
        var original = Program("Strength Base", "Competition squat");
        var template = ProgramTemplate.Create(TenantId, original.Name);
        var version = ProgramTemplateVersion.Create(
            TenantId,
            template.Id,
            template.CreateNextVersion(original.Name),
            original,
            publish: true,
            Now);
        var mesocycle = CreateMesocycle(original, template.Id, version.Id);
        var sessionId = mesocycle.Weeks.Single().Sessions.Single().Id;

        mesocycle.ReplaceFutureSession(
            sessionId,
            Session("Client-specific squat variation", "Paused squat"));

        Assert.AreEqual(
            "Competition squat",
            version.Weeks.Single().Sessions.Single().Exercises.Single().ExerciseNameSnapshot);
        Assert.AreEqual("Client-specific squat variation", mesocycle.Weeks.Single().Sessions.Single().Name);
        Assert.AreEqual("Paused squat", mesocycle.Weeks.Single().Sessions.Single().Exercises.Single().ExerciseNameSnapshot);
    }

    [TestMethod]
    public void WorkoutPreservesPrescriptionActualsAndApprovedSubstitution()
    {
        var mesocycle = CreateMesocycle(Program("Accessory block", "Chest-supported row"));
        var session = mesocycle.Weeks.Single().Sessions.Single();
        var execution = WorkoutExecution.Start(TenantId, ClientId, mesocycle.Id, session, Now);
        var exercise = execution.Exercises.Single();
        var set = exercise.Sets.Single();

        execution.SelectActuallyPerformedExercise(exercise.Id, AlternativeId, "Cable row");
        execution.RecordSetActual(
            set.Id,
            repetitions: 11,
            load: 42.5m,
            TrainingLoadUnit.Kilogram,
            rpe: 8.5m,
            isCompleted: true,
            clientNote: "Smooth");

        Assert.AreEqual(ExerciseId, exercise.PrescribedExerciseId);
        Assert.AreEqual(AlternativeId, exercise.ActualExerciseId);
        Assert.IsTrue(exercise.WasSubstituted);
        Assert.AreEqual(10, set.PrescribedRepetitionsMaximum);
        Assert.AreEqual(11, set.ActualRepetitions);
        Assert.AreEqual(42.5m, set.ActualLoad);

        execution.Complete(Now.AddHours(1));
        Assert.ThrowsExactly<InvalidOperationException>(() => execution.RecordSetActual(
            set.Id,
            12,
            45m,
            TrainingLoadUnit.Kilogram,
            9m,
            true,
            null));
    }

    [TestMethod]
    public void LockedMainLiftRejectsSubstitution()
    {
        var source = Program("Main lift", "Squat", mainLift: true);
        var mesocycle = CreateMesocycle(source);
        var execution = WorkoutExecution.Start(
            TenantId,
            ClientId,
            mesocycle.Id,
            mesocycle.Weeks.Single().Sessions.Single(),
            Now);
        var exercise = execution.Exercises.Single();

        Assert.AreEqual(PrescriptionModificationPolicy.Locked, exercise.ModificationPolicySnapshot);
        Assert.ThrowsExactly<InvalidOperationException>(() =>
            execution.SelectActuallyPerformedExercise(exercise.Id, AlternativeId, "Alternative squat"));
    }

    [TestMethod]
    public void FutureWeekUnlockUsesMesocycleTimezoneAndRevealStillHonorsPublish()
    {
        var beforeLocalMidnight = new DateTimeOffset(2026, 8, 23, 20, 30, 0, TimeSpan.Zero);
        var afterLocalMidnight = new DateTimeOffset(2026, 8, 23, 21, 30, 0, TimeSpan.Zero);
        var start = new DateOnly(2026, 8, 17);

        Assert.IsFalse(TrainingCalendarPolicy.GetWeekAvailability(
            start, 2, "Asia/Beirut", beforeLocalMidnight, false, true).IsVisible);
        Assert.IsTrue(TrainingCalendarPolicy.GetWeekAvailability(
            start, 2, "Asia/Beirut", afterLocalMidnight, false, true).IsVisible);
        Assert.IsTrue(TrainingCalendarPolicy.GetWeekAvailability(
            start, 2, "Asia/Beirut", beforeLocalMidnight, true, true).IsVisible);
        Assert.IsFalse(TrainingCalendarPolicy.GetWeekAvailability(
            start, 2, "Asia/Beirut", afterLocalMidnight, true, false).IsVisible);
    }

    [TestMethod]
    public void RpeRirAreCanonicalAndLoadCalculationThenRoundingAreSeparated()
    {
        var exertion = ExertionTarget.FromRir(2m);
        Assert.AreEqual(8m, exertion.Rpe);
        Assert.AreEqual(2m, exertion.Rir);
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => ExertionTarget.FromRpe(8.2m));

        var recommendation = new StrengthLoadRecommendationStrategy().Recommend(new LoadRecommendationInput(
            PrescriptionLoadStrategy.RpeBasedEpley,
            null,
            null,
            100m,
            5,
            exertion.Rpe,
            StrengthLoadUnit.Kilogram));
        var rounded = new LoadRoundingPolicy(
            StrengthLoadUnit.Kilogram,
            2.5m,
            LoadRoundingMode.Nearest).Round(recommendation.Value);

        Assert.AreEqual(81.081m, recommendation.Value);
        Assert.AreEqual(80m, rounded);
        StringAssert.Contains(recommendation.Explanation, "estimate");
    }

    [TestMethod]
    public void OneRepMaxEstimatorsMatchVersionedReferenceCasesAndRejectExtrapolation()
    {
        var epley = new EpleyOneRepMaxEstimator();
        var brzycki = new BrzyckiOneRepMaxEstimator();

        Assert.AreEqual(100m, epley.Estimate(100m, 1));
        Assert.AreEqual(116.667m, epley.Estimate(100m, 5));
        Assert.AreEqual(100m, brzycki.Estimate(100m, 1));
        Assert.AreEqual(112.5m, brzycki.Estimate(100m, 5));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => epley.Estimate(100m, 13));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => brzycki.Estimate(100m, 11));
    }

    [TestMethod]
    public void WorkingMaxLoadUsesEffectiveRepetitionBoundaryAndRejectsUnsupportedInputs()
    {
        var strategy = new StrengthLoadRecommendationStrategy();
        var exactBoundary = strategy.Recommend(new LoadRecommendationInput(
            PrescriptionLoadStrategy.RpeBasedEpley,
            null,
            null,
            100m,
            10,
            8m,
            StrengthLoadUnit.Kilogram));

        Assert.AreEqual(71.429m, exactBoundary.Value);
        Assert.AreEqual(StrengthLoadRecommendationStrategy.Key, exactBoundary.StrategyKey);
        Assert.AreEqual(StrengthLoadRecommendationStrategy.CurrentVersion, exactBoundary.StrategyVersion);
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => strategy.Recommend(new LoadRecommendationInput(
            PrescriptionLoadStrategy.RpeBasedEpley,
            null,
            null,
            100m,
            10,
            7.5m,
            StrengthLoadUnit.Kilogram)));
    }

    [TestMethod]
    public void PositiveSubIncrementLoadsRequireAnExplicitPracticalRoundingChoice()
    {
        Assert.ThrowsExactly<InvalidOperationException>(() => new LoadRoundingPolicy(
            StrengthLoadUnit.Kilogram,
            2.5m,
            LoadRoundingMode.Down).Round(1m));
        Assert.ThrowsExactly<InvalidOperationException>(() => new LoadRoundingPolicy(
            StrengthLoadUnit.Kilogram,
            2.5m,
            LoadRoundingMode.Nearest).Round(1m));
        Assert.AreEqual(2.5m, new LoadRoundingPolicy(
            StrengthLoadUnit.Kilogram,
            2.5m,
            LoadRoundingMode.Up).Round(1m));
    }

    [TestMethod]
    public void CoveragePolicyAllowsExactBoundaryAndRejectsWrongClientOrOverflow()
    {
        var enrollmentId = Guid.NewGuid();
        var start = new DateOnly(2026, 8, 17);
        var end = start.AddDays(12 * 7);
        var authorization = new TrainingCoverageAuthorization(
            enrollmentId,
            ClientId,
            start,
            end,
            IncludesTraining: true,
            IsTerminated: false);

        Assert.IsTrue(TrainingCoveragePolicy.Evaluate(ClientId, start, end, authorization).IsAuthorized);
        Assert.IsFalse(TrainingCoveragePolicy.Evaluate(ClientId, start, end.AddDays(1), authorization).IsAuthorized);
        Assert.IsFalse(TrainingCoveragePolicy.Evaluate(Guid.NewGuid(), start, end, authorization).IsAuthorized);
    }

    [TestMethod]
    public void MesocycleStatusIsDateDerivedUntilCancellationMakesItTerminal()
    {
        var mesocycle = TrainingMesocycle.CreateSnapshot(
            TenantId,
            ClientId,
            Guid.NewGuid(),
            Guid.NewGuid(),
            Guid.NewGuid(),
            "Future block",
            new DateOnly(2026, 8, 24),
            "Asia/Beirut",
            MesocycleKind.Primary,
            TrainingLoadUnit.Kilogram,
            2.5m,
            TrainingLoadRoundingMode.Nearest,
            Guid.NewGuid(),
            Program("Future block", "Squat"));

        Assert.AreEqual(MesocycleStatus.Planned, mesocycle.GetEffectiveStatus(Now));
        Assert.AreEqual(MesocycleStatus.Active, mesocycle.GetEffectiveStatus(Now.AddDays(7)));
        Assert.ThrowsExactly<InvalidOperationException>(() => mesocycle.Complete(Now));

        Assert.AreEqual(MesocycleStatus.Planned, mesocycle.Cancel(Now));
        Assert.AreEqual(MesocycleStatus.Cancelled, mesocycle.GetEffectiveStatus(Now.AddYears(1)));
        Assert.IsFalse(mesocycle.BlocksPrimaryOverlap);
        Assert.ThrowsExactly<InvalidOperationException>(() => mesocycle.Cancel(Now));
        Assert.ThrowsExactly<InvalidOperationException>(() => mesocycle.Reschedule(new DateOnly(2026, 9, 1)));
    }

    [TestMethod]
    public void WorkingMaxSnapshotAndProgressionDoNotMutateTheirSources()
    {
        var global = StrengthMaxRecord.Create(
            TenantId,
            ClientId,
            ExerciseId,
            StrengthMaxKind.CoachWorkingMax,
            180m,
            StrengthLoadUnit.Kilogram,
            new DateOnly(2026, 8, 20),
            StrengthMaxSource.Manual,
            "CoachSelection",
            "1.0",
            null,
            null);
        var snapshot = MesocycleWorkingMaxSnapshot.Capture(
            TenantId,
            Guid.NewGuid(),
            ClientId,
            ExerciseId,
            global.Id,
            162.5m,
            StrengthLoadUnit.Kilogram,
            1,
            null,
            "Ninety-percent training max");
        var transform = new RpeStepProgressionTransform();

        Assert.AreEqual(180m, global.Value);
        Assert.AreEqual(162.5m, snapshot.Value);
        Assert.AreEqual(6.5m, transform.TransformRpe(6m, 0.5m, 1));
        Assert.AreEqual(7.5m, transform.TransformRpe(6m, 0.5m, 3));
        Assert.AreEqual(6m, TrainingExertion.ValidateRpe(6m));
    }

    [TestMethod]
    public void MediaPolicyRequiresMatchingExtensionContentTypeSignatureAndLimit()
    {
        var mp4Header = new byte[] { 0, 0, 0, 20, (byte)'f', (byte)'t', (byte)'y', (byte)'p', 0, 0, 0, 0 };
        var valid = MediaUploadPolicy.Validate("demo.mp4", "video/mp4", 1_024, mp4Header);
        Assert.AreEqual(MediaKind.Video, valid.Kind);
        Assert.AreEqual("video/mp4", valid.VerifiedContentType);

        Assert.ThrowsExactly<ArgumentException>(() =>
            MediaUploadPolicy.Validate("demo.jpg", "image/jpeg", 1_024, mp4Header));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() =>
            MediaUploadPolicy.Validate(
                "demo.mp4",
                "video/mp4",
                MediaUploadPolicy.MaximumVideoBytes + 1,
                mp4Header));
    }

    private static TrainingMesocycle CreateMesocycle(
        ProgramBlueprint blueprint,
        Guid? templateId = null,
        Guid? versionId = null) =>
        TrainingMesocycle.CreateSnapshot(
            TenantId,
            ClientId,
            Guid.NewGuid(),
            templateId ?? Guid.NewGuid(),
            versionId ?? Guid.NewGuid(),
            blueprint.Name,
            new DateOnly(2026, 8, 17),
            "Asia/Beirut",
            MesocycleKind.Primary,
            TrainingLoadUnit.Kilogram,
            2.5m,
            TrainingLoadRoundingMode.Nearest,
            Guid.NewGuid(),
            blueprint);

    private static ProgramBlueprint Program(string name, string exerciseName, bool mainLift = false) =>
        new(
            name,
            null,
            [new TrainingWeekBlueprint(null, true, [Session("Day 1", exerciseName, mainLift)])]);

    private static TrainingSessionBlueprint Session(
        string name,
        string exerciseName,
        bool mainLift = false) =>
        new(
            name,
            0,
            "Coach cue",
            [new ExercisePrescriptionBlueprint(
                ExerciseId,
                exerciseName,
                0,
                mainLift,
                PrescriptionModificationPolicy.CoachApprovedSwap,
                null,
                [AlternativeId],
                [],
                [new SetPrescriptionBlueprint(
                    0,
                    TrainingSetType.Normal,
                    8,
                    10,
                    TrainingLoadStrategy.Direct,
                    40m,
                    TrainingLoadUnit.Kilogram,
                    null,
                    8m,
                    ExertionDisplayPreference.Rpe,
                    120,
                    "3-1-1",
                    null,
                    PrescribedLoad: 40m,
                    CalculationStrategyKey: "CoachDirect",
                    CalculationStrategyVersion: "1.0")])]);
}
