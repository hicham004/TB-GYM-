using System.Globalization;
using TB.Gym.Modules.Training;
using TB.Gym.SharedKernel;
using RtsRpeChart = TB.Gym.Modules.Strength.RtsRpeChart;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// The notes plan's N6a (decisions 20 to 22, 5 and 7 Nov 2026): "Last time + step", the sixth weight choice. A set with
/// it takes a step (more than 0 and at most 50 in its unit, two decimals at most), its unit and its reps, and optionally a
/// starting weight (more than 0 and at most 2,000); no other set takes a step. The week copies (TRN-025) move its starting
/// weight by the weight step and copy its step as it is; Edit weeks (TRN-028) keeps it as stored and counts a changed step
/// or starting weight as an edit; a workout started from it keeps the choice and the step, and a set still logs without
/// reps; it never takes a weight worked out from a max, never anchors one, and a draft keeps it as typed.
/// </summary>
[TestClass]
public sealed partial class LastTimeStepDomainTests
{
    private static readonly Guid TenantId = Guid.Parse("10000000-0000-0000-0000-0000000006a1");
    private static readonly Guid ClientId = Guid.Parse("20000000-0000-0000-0000-0000000006a1");
    private static readonly Guid CurlId = Guid.Parse("30000000-0000-0000-0000-0000000006a1");
    private static readonly Guid SquatId = Guid.Parse("30000000-0000-0000-0000-0000000006a2");

    // The block starts on Monday 9 Nov 2026, so week n's Lower A is on 9 Nov + 7 (n - 1) days.
    private static readonly DateOnly Start = new(2026, 11, 9);
    private static readonly DateTimeOffset Now = new(2026, 11, 9, 9, 0, 0, TimeSpan.Zero);

    private static readonly Dictionary<Guid, string> Names = new()
    {
        [CurlId] = "Seated Leg Curl",
        [SquatId] = "Back squat",
    };

    // A coach reads these word for word in Publish, Edit weeks and the week copies.
    private const string StepWords = "A step must be more than 0 and at most 50 in the set's unit, with at most two decimals.";
    private const string UnitWords = "A last time + step set needs its unit, kg or lb.";
    private const string RepsWords = "A last time + step set needs its reps.";
    private const string StartWords = "A starting weight must be more than 0 and at most 2,000.";
    private const string OnlyStepSetsWords = "Only a last time + step set takes a step.";

    // ----- the rule -----

    [TestMethod]
    public void TheSixthChoiceTakesAStepItsUnitAndItsRepsAndAnOptionalStartingWeight()
    {
        // The step's edges with no starting weight, a usual one, and the heaviest starting weight a typed weight takes.
        (decimal Step, decimal? Start)[] accepted = [(50m, null), (1.25m, null), (0.01m, null), (2m, 21m), (2.5m, 2_000m)];
        foreach (var (step, start) in accepted)
        {
            var label = $"step {step.ToString(CultureInfo.InvariantCulture)}, start {start?.ToString(CultureInfo.InvariantCulture) ?? "none"}";
            var set = StepSet(step, start);
            ProgramEditRules.EnsureValid(Session(set));

            // A program version and an assigned program each store it as typed.
            var typed = Version(set).Weeks.Single().Sessions.Single().Exercises.Single().Sets.Single();
            Assert.AreEqual(
                (TrainingLoadStrategy.LastTimeStep, (decimal?)step, start, (TrainingLoadUnit?)TrainingLoadUnit.Kilogram),
                (typed.LoadStrategy, typed.LoadStep, typed.DirectLoad, typed.LoadUnit),
                label);
            var assigned = Only(Mesocycle(Session(Assigned(set))));
            Assert.AreEqual(
                (TrainingLoadStrategy.LastTimeStep, (decimal?)step, start, (TrainingLoadUnit?)TrainingLoadUnit.Kilogram),
                (assigned.LoadStrategy, assigned.LoadStep, assigned.DirectLoad, assigned.LoadUnit),
                label);
        }
    }

    [TestMethod]
    public void AStepThatIsMissingZeroBelowZeroOverFiftyOrFinerThanTwoDecimalsIsRefused()
    {
        decimal?[] refused = [null, 0m, -1m, 50.01m, 1.255m];
        foreach (var step in refused)
        {
            AssertRefused(StepSet(step), StepWords, $"step {step?.ToString(CultureInfo.InvariantCulture) ?? "none"}");
        }
    }

    [TestMethod]
    public void AStepSetNeedsItsUnitAndItsReps()
    {
        AssertRefused(StepSet(2m) with { LoadUnit = null }, UnitWords, "no unit");
        AssertRefused(StepSet(2m) with { RepetitionsMinimum = null, RepetitionsMaximum = null }, RepsWords, "no reps");
    }

    [TestMethod]
    public void AStartingWeightIsMoreThanZeroAndAtMostTwoThousand()
    {
        // 0.0004 is what the database would keep as 0.000: refused as no start above 0, never left to its check.
        foreach (var start in new[] { 0m, -2.5m, 2_000.5m, 0.0004m })
        {
            AssertRefused(StepSet(2m, start), StartWords, $"start {start.ToString(CultureInfo.InvariantCulture)}");
        }

        ProgramEditRules.EnsureValid(Session(StepSet(2m, 0.0005m)));
    }

    [TestMethod]
    public void NoOtherWeightChoiceTakesAStep()
    {
        SetPrescriptionBlueprint[] others =
        [
            Set(TrainingLoadStrategy.Direct, direct: 100m),
            Set(TrainingLoadStrategy.None),
            Set(TrainingLoadStrategy.PercentageWorkingMax, percentage: 70m),
            Set(TrainingLoadStrategy.RpeChart, rpe: 8m),
        ];
        foreach (var set in others)
        {
            ProgramEditRules.EnsureValid(Session(set));
            AssertRefused(set with { LoadStep = 2m }, OnlyStepSetsWords, set.LoadStrategy.ToString());
        }
    }

    // ----- the week copies (TRN-025) -----

    [TestMethod]
    public void EachWeekCopyMovesAStartingWeightByTheWeightStepAndKeepsTheStep()
    {
        var source = CopySource();
        var copies = WeekStepProgressionTransform.Generate(
            source, new WeekProgressionSteps(0m, 0, 0m, LoadStep: 2.5m), 3, Names);

        // 21 kg and 2.5 kg a week: 23.5, 26 and 28.5, off the 2.5 kg grid, so nothing rounds them.
        Assert.HasCount(3, copies);
        CollectionAssert.AreEqual(
            new decimal?[] { 23.5m, 26m, 28.5m },
            copies.Select(week => CopySets(week)[1].DirectLoad).ToArray());
        foreach (var week in copies)
        {
            var sets = CopySets(week);
            Assert.IsTrue(
                sets.All(set => set.LoadStrategy == TrainingLoadStrategy.LastTimeStep && set.LoadStep == 2m &&
                    set.LoadUnit == TrainingLoadUnit.Kilogram),
                "Every set stays a last time + step set with its own 2 kg step and its unit.");
            Assert.AreEqual(20m, sets[0].DirectLoad, "A warm-up never moves.");
            Assert.IsNull(sets[2].DirectLoad, "With no starting weight, there is nothing to move.");
        }

        Assert.AreEqual(21m, CopySets(source)[1].DirectLoad, "The source week keeps its own starting weight.");
    }

    [TestMethod]
    public void TheRepsAndEffortStepsMoveAStepSetAsTheyMoveAnySet()
    {
        var copies = WeekStepProgressionTransform.Generate(
            CopySource(), new WeekProgressionSteps(RpeStep: 0.5m, RepetitionsStep: 1, 0m, 0m), 2, Names);

        for (var copy = 1; copy <= 2; copy++)
        {
            var sets = CopySets(copies[copy - 1]);
            Assert.AreEqual(((int?)10, (decimal?)7m, (decimal?)20m), (sets[0].RepetitionsMaximum, sets[0].TargetRpe, sets[0].DirectLoad), "A warm-up stays as it is.");
            foreach (var set in sets.Skip(1))
            {
                Assert.AreEqual(((int?)(10 + copy), (int?)(10 + copy)), (set.RepetitionsMinimum, set.RepetitionsMaximum), $"copy {copy}");
                Assert.AreEqual(7m + 0.5m * copy, set.TargetRpe, $"copy {copy}");
                Assert.AreEqual(2m, set.LoadStep, $"copy {copy}");
            }

            Assert.AreEqual(21m, sets[1].DirectLoad, "Without a weight step the starting weight stays.");
        }
    }

    [TestMethod]
    public void AStartingWeightTheWeightStepWouldTakePastTwoThousandRefusesTheCopyAndSaysWhere()
    {
        var source = Week(Exercise(CurlId, StepRequest(1, 2m, 1_999m)));

        var refused = Assert.ThrowsExactly<ArgumentException>(() => WeekStepProgressionTransform.Generate(
            source, new WeekProgressionSteps(0m, 0, 0m, 2.5m), 1, Names));

        Assert.StartsWith("Copy 1, Lower A, Seated Leg Curl, set 1: the weight would be ", refused.Message);
        Assert.Contains("and it must be more than 0 and at most 2,000.", refused.Message);
    }

    // ----- Edit weeks (TRN-028) -----

    [TestMethod]
    public void EditWeeksKeepsAStepSetSentAsStoredAndCountsAChangedStepOrStartingWeightAsAnEdit()
    {
        var block = EditBlock(2);
        Assert.IsFalse(ProgramEditPlanner.Plan(block, Current(block, Start), Start).HasChanges);

        // A step sent beside a typed weight is no part of it (the server drops it), so it changes nothing either.
        Assert.IsFalse(PlanFor(block, squat: set => set with { LoadStep = 5m }).HasChanges);

        // A step of its own, a starting weight changed or taken away, or another weight choice is an edit.
        Func<SetPrescriptionRequest, SetPrescriptionRequest>[] edits =
        [
            set => set with { LoadStep = 2.5m },
            set => set with { DirectLoad = 23.5m },
            set => set with { DirectLoad = null },
            set => set with { LoadStrategy = TrainingLoadStrategy.Direct, LoadStep = null },
        ];
        foreach (var edit in edits)
        {
            var plan = PlanFor(block, curl: edit);
            Assert.AreEqual((0, 1, 0, 0), (plan.SessionsAdded, plan.SessionsEdited, plan.SessionsMoved, plan.SessionsRemoved));
            var planned = plan.Weeks[0].Sessions.Single();
            Assert.AreEqual((ProgramEditDisposition.Replace, true), (planned.Disposition, planned.ContentChanged));
            Assert.IsTrue(plan.Weeks[1].Sessions.All(session => session.Disposition == ProgramEditDisposition.Keep));
        }
    }

    [TestMethod]
    public void AppliedAStepOnlyEditReplacesTheSessionWithTheNewStepAndLeavesTheOtherWeeksAsTheyWere()
    {
        var block = EditBlock(2);
        var weekTwo = Ordered(block)[1].Sessions.Single();
        var plan = PlanFor(block, curl: set => set with { LoadStep = 2.5m });

        var applied = block.ApplyProgramEdit(plan, Blueprints(plan));

        var replaced = applied.ReplacedSessions.Single();
        Assert.AreEqual(Ordered(block)[0].Sessions.Single().Id, replaced.Id);
        var curl = replaced.Exercises.Single(item => item.ExerciseId == CurlId).Sets.Single();
        Assert.AreEqual(
            (TrainingLoadStrategy.LastTimeStep, (decimal?)2.5m, (decimal?)21m, (decimal?)21m, (Guid?)null),
            (curl.LoadStrategy, curl.LoadStep, curl.DirectLoad, curl.PrescribedLoad, curl.WorkingMaxSnapshotId));
        Assert.AreEqual(2m, weekTwo.Exercises.Single(item => item.ExerciseId == CurlId).Sets.Single().LoadStep);

        // Sent again as it is stored now, the grid plans nothing.
        Assert.IsFalse(ProgramEditPlanner.Plan(block, Current(block, Start), Start).HasChanges);
    }

    // ----- the workout's snapshot and a weight from a max -----

    [TestMethod]
    public void AWorkoutStartedFromAStepSetKeepsTheChoiceTheStepAndTheStartingWeightAndASetLogsWithoutReps()
    {
        var block = Mesocycle(new TrainingSessionBlueprint(
            "Lower A",
            0,
            null,
            [
                Exercise(CurlId, 1, Assigned(StepSet(2m, 21m, position: 1)), Assigned(StepSet(2.5m, position: 2))),
                Exercise(SquatId, 2, Assigned(Set(TrainingLoadStrategy.Direct, direct: 100m))),
            ]));

        var execution = WorkoutExecution.Start(TenantId, ClientId, block.Id, block.Weeks.Single().Sessions.Single(), Now);

        var curl = execution.Exercises.Single(item => item.PrescribedExerciseId == CurlId).Sets.OrderBy(item => item.Position).ToArray();
        Assert.AreEqual(
            ((TrainingLoadStrategy?)TrainingLoadStrategy.LastTimeStep, (decimal?)2m, (decimal?)21m, (TrainingLoadUnit?)TrainingLoadUnit.Kilogram),
            (curl[0].LoadStrategySnapshot, curl[0].PrescribedLoadStep, curl[0].PrescribedLoad, curl[0].PrescribedLoadUnit));
        Assert.AreEqual(
            ((TrainingLoadStrategy?)TrainingLoadStrategy.LastTimeStep, (decimal?)2.5m, (decimal?)null, (TrainingLoadUnit?)TrainingLoadUnit.Kilogram),
            (curl[1].LoadStrategySnapshot, curl[1].PrescribedLoadStep, curl[1].PrescribedLoad, curl[1].PrescribedLoadUnit));
        var squat = execution.Exercises.Single(item => item.PrescribedExerciseId == SquatId).Sets.Single();
        Assert.AreEqual(((TrainingLoadStrategy?)TrainingLoadStrategy.Direct, (decimal?)null), (squat.LoadStrategySnapshot, squat.PrescribedLoadStep));

        // The reps box may be left empty: the set still logs, and what is logged never moves the prescription.
        execution.RecordSetActual(curl[1].Id, repetitions: null, 20m, TrainingLoadUnit.Kilogram, null, isCompleted: true, null);
        execution.RecordSetActual(curl[0].Id, 10, 21m, TrainingLoadUnit.Kilogram, 8m, isCompleted: true, null);
        Assert.AreEqual(((int?)null, (decimal?)20m, true), (curl[1].ActualRepetitions, curl[1].ActualLoad, curl[1].IsCompleted));
        Assert.AreEqual(((int?)10, (decimal?)21m, true), (curl[0].ActualRepetitions, curl[0].ActualLoad, curl[0].IsCompleted));
        Assert.AreEqual(((decimal?)2m, (decimal?)21m), (curl[0].PrescribedLoadStep, curl[0].PrescribedLoad));
    }

    [TestMethod]
    public void AStepSetNeverTakesAWeightWorkedOutFromAMax()
    {
        var block = Mesocycle(Session(Assigned(StepSet(2m, 21m))));
        var set = Only(block);
        var sequence = block.MutationSequence;

        Assert.ThrowsExactly<InvalidOperationException>(() => block.ApplyRecalculatedLoads(
            new Dictionary<Guid, SetLoadCalculation> { [set.Id] = new(Guid.NewGuid(), 80m, 80m, "RpeChart", "1.0", "x") }));

        Assert.AreEqual(
            ((decimal?)21m, (decimal?)21m, (Guid?)null, "CoachStartingWeight", sequence),
            (set.PrescribedLoad, set.UnroundedRecommendedLoad, set.WorkingMaxSnapshotId, set.CalculationStrategyKey, block.MutationSequence));
    }

    [TestMethod]
    public void AStepSetNeverAnchorsAMaxWorkedOutFromWeekOne()
    {
        // The step set comes first and names reps and an RPE the chart covers; the max is read from the set after it.
        var week = new TrainingWeekBlueprint("Week 1", true, [new TrainingSessionBlueprint("Lower A", 0, null,
        [
            Exercise(SquatId, 1,
                StepSet(2.5m, 100m, position: 0, reps: 5, rpe: 7m),
                Set(TrainingLoadStrategy.RpeChart, rpe: 8m, position: 1, reps: 5)),
        ])]);

        var anchor = WeekOneAnchors.Find(week, SquatId, RtsRpeChart.Covers);

        Assert.IsNotNull(anchor);
        Assert.AreEqual((1, 5, 8m), (anchor.SetPosition, anchor.Repetitions, anchor.Rpe));

        // With step sets alone, week 1 has nothing to work a max out from.
        var stepsOnly = week with
        {
            Sessions = [week.Sessions[0] with { Exercises = [Exercise(SquatId, 1, StepSet(2.5m, 100m, position: 0, reps: 5, rpe: 7m))] }],
        };
        Assert.IsNull(WeekOneAnchors.Find(stepsOnly, SquatId, RtsRpeChart.Covers));
    }

    // ----- drafts (TRN-024) -----

    [TestMethod]
    public void ADraftKeepsAStepSetAsTypedEvenAStepPublishWouldRefuse()
    {
        var content = new ProgramDraftContent("Hypertrophy", null, [Week(Exercise(CurlId, StepRequest(1, 2.5m, 21m), StepRequest(2, 0m)))]);

        Assert.IsTrue(ProgramDraftShape.TryCreate(content, out var shape, out _, out _));

        Assert.Contains("\"loadStrategy\":\"LastTimeStep\"", shape.Json);
        var sets = ProgramDraftShape.Read(shape.Json).Weeks.Single().Sessions.Single().Exercises.Single().Sets;
        Assert.AreEqual(
            (TrainingLoadStrategy.LastTimeStep, (decimal?)2.5m, (decimal?)21m, (TrainingLoadUnit?)TrainingLoadUnit.Kilogram, (int?)10, (int?)10),
            (sets[0].LoadStrategy, sets[0].LoadStep, sets[0].DirectLoad, sets[0].LoadUnit, sets[0].RepetitionsMinimum, sets[0].RepetitionsMaximum));
        Assert.AreEqual(0m, sets[1].LoadStep, "Mid-edit, a step Publish refuses is kept as typed.");

        // A set without a step writes none, so a draft saved before N6a reads as it was.
        var typed = new ProgramDraftContent("Strength", null, [Week(Exercise(SquatId, Request(Set(TrainingLoadStrategy.Direct, direct: 100m))))]);
        Assert.IsTrue(ProgramDraftShape.TryCreate(typed, out var typedShape, out _, out _));
        Assert.DoesNotContain("loadStep", typedShape.Json);
        Assert.IsNull(ProgramDraftShape.Read(typedShape.Json).Weeks.Single().Sessions.Single().Exercises.Single().Sets.Single().LoadStep);
    }

    // ----- builders -----

    private static void AssertRefused(SetPrescriptionBlueprint set, string words, string label)
    {
        var edit = Assert.ThrowsExactly<ArgumentException>(() => ProgramEditRules.EnsureValid(Session(set)));
        Assert.AreEqual(words, edit.PersonMessage(), label);
        var version = Assert.ThrowsExactly<ArgumentException>(() => Version(set));
        Assert.AreEqual(words, version.PersonMessage(), label);
    }

    private static SetPrescriptionBlueprint StepSet(
        decimal? step,
        decimal? start = null,
        int position = 1,
        int reps = 10,
        decimal? rpe = null,
        TrainingSetType type = TrainingSetType.Normal) =>
        new(position, type, reps, reps, TrainingLoadStrategy.LastTimeStep, start, TrainingLoadUnit.Kilogram, null, step, rpe,
            ExertionDisplayPreference.Rpe, 90, null, null);

    private static SetPrescriptionBlueprint Set(
        TrainingLoadStrategy strategy,
        decimal? direct = null,
        decimal? percentage = null,
        decimal? rpe = null,
        int position = 1,
        int reps = 10) =>
        new(position, TrainingSetType.Normal, reps, reps, strategy, direct,
            strategy == TrainingLoadStrategy.None ? null : TrainingLoadUnit.Kilogram,
            percentage, LoadStep: null, rpe, ExertionDisplayPreference.Rpe, 90, null, null);

    /// <summary>A set as assignment stores it: a typed weight, or a step set's starting weight, is its weight, unrounded.</summary>
    private static SetPrescriptionBlueprint Assigned(SetPrescriptionBlueprint set) =>
        set.LoadStrategy is TrainingLoadStrategy.Direct or TrainingLoadStrategy.LastTimeStep && set.DirectLoad is { } load
            ? set with
            {
                UnroundedRecommendedLoad = load,
                PrescribedLoad = load,
                CalculationStrategyKey = set.LoadStrategy == TrainingLoadStrategy.Direct ? "CoachDirect" : "CoachStartingWeight",
                CalculationStrategyVersion = "1.0",
            }
            : set;

    private static ExercisePrescriptionBlueprint Exercise(Guid id, int position, params SetPrescriptionBlueprint[] sets) =>
        new(id, Names[id], position, false, PrescriptionModificationPolicy.CoachApprovedSwap, null, [], [], sets);

    private static TrainingSessionBlueprint Session(params SetPrescriptionBlueprint[] sets) =>
        new("Lower A", 0, null, [Exercise(CurlId, 1, sets)]);

    private static ProgramTemplateVersion Version(params SetPrescriptionBlueprint[] sets) =>
        ProgramTemplateVersion.Create(
            TenantId,
            Guid.NewGuid(),
            1,
            new ProgramBlueprint("Hypertrophy", null, [new TrainingWeekBlueprint("Week 1", true, [Session(sets)])]),
            publish: true,
            Now);

    private static TrainingMesocycle Mesocycle(params TrainingSessionBlueprint[] weekly) => Mesocycle(1, weekly);

    private static TrainingMesocycle Mesocycle(int weeks, params TrainingSessionBlueprint[] weekly) =>
        TrainingMesocycle.CreateSnapshot(
            TenantId,
            ClientId,
            Guid.NewGuid(),
            Guid.NewGuid(),
            Guid.NewGuid(),
            "Hypertrophy",
            Start,
            "Asia/Beirut",
            MesocycleKind.Primary,
            TrainingLoadUnit.Kilogram,
            2.5m,
            TrainingLoadRoundingMode.Nearest,
            Guid.NewGuid(),
            new ProgramBlueprint(
                "Hypertrophy",
                null,
                [.. Enumerable.Range(1, weeks).Select(week => new TrainingWeekBlueprint($"Week {week}", true, weekly))]));

    private static SetPrescription Only(TrainingMesocycle block) =>
        block.Weeks.Single().Sessions.Single().Exercises.Single().Sets.Single();

    /// <summary>Each week's Lower A: the leg curl's step set, 21 kg and 2 kg, and the squat's typed 100 kg.</summary>
    private static TrainingMesocycle EditBlock(int weeks) =>
        Mesocycle(
            weeks,
            new TrainingSessionBlueprint("Lower A", 0, null,
            [
                Exercise(CurlId, 1, Assigned(StepSet(2m, 21m))),
                Exercise(SquatId, 2, Assigned(Set(TrainingLoadStrategy.Direct, direct: 100m))),
            ]));

    private static IReadOnlyList<MesocycleWeek> Ordered(TrainingMesocycle block) =>
        [.. block.Weeks.OrderBy(week => week.WeekNumber)];

    /// <summary>The grid as the web sends it, with week 1's Lower A changed by the given edits.</summary>
    private static ProgramEditPlan PlanFor(
        TrainingMesocycle block,
        Func<SetPrescriptionRequest, SetPrescriptionRequest>? curl = null,
        Func<SetPrescriptionRequest, SetPrescriptionRequest>? squat = null)
    {
        var weeks = Current(block, Start);
        var first = weeks[0].Sessions.Single();
        var session = first.Session with
        {
            Exercises = [.. first.Session.Exercises.Select(exercise => exercise with
            {
                Sets = [.. exercise.Sets.Select(set => (exercise.ExerciseId == CurlId ? curl : squat)?.Invoke(set) ?? set)],
            })],
        };
        weeks[0] = weeks[0] with { Sessions = [first with { Session = session }] };
        return ProgramEditPlanner.Plan(block, weeks, Start);
    }

    /// <summary>The grid as the web sends it: every open session, in day order, as stored.</summary>
    private static ProgramEditWeekRequest[] Current(TrainingMesocycle block, DateOnly today) =>
    [
        .. Ordered(block).Select(week => new ProgramEditWeekRequest(
            week.Id,
            week.Label,
            week.IsPublished,
            [.. week.Sessions
                .Where(session => ProgramEditRules.IsOpen(session, today))
                .OrderBy(session => session.DayOffset)
                .ThenBy(session => session.Position)
                .Select(session => new ProgramEditSessionRequest(session.Id, Request(session)))])),
    ];

    private static TrainingSessionRequest Request(TrainingSession session) =>
        new(
            session.Name,
            session.DayOffset,
            session.CoachNotes,
            [.. session.Exercises.OrderBy(item => item.Position).Select((exercise, exerciseIndex) =>
                new ExercisePrescriptionRequest(
                    exercise.ExerciseId,
                    exerciseIndex + 1,
                    exercise.IsMainLift,
                    exercise.ModificationPolicy,
                    exercise.CoachNotes,
                    [.. exercise.Alternatives.Select(item => item.ExerciseId)],
                    [.. exercise.Sets.OrderBy(item => item.Position).Select((set, setIndex) =>
                        new SetPrescriptionRequest(
                            setIndex + 1,
                            set.SetType,
                            set.RepetitionsMinimum,
                            set.RepetitionsMaximum,
                            set.LoadStrategy,
                            set.DirectLoad,
                            set.LoadUnit,
                            set.PercentageWorkingMax,
                            set.LoadStep,
                            set.TargetRpe,
                            null,
                            set.ExertionDisplayPreference,
                            set.RestSeconds,
                            set.Tempo,
                            set.CoachNotes,
                            set.IsManualLoadOverride ? set.PrescribedLoad : null))]))]);

    /// <summary>What the service builds for every session the plan does not keep: the request as it stands, weighed.</summary>
    private static Dictionary<int, TrainingSessionBlueprint> Blueprints(ProgramEditPlan plan) =>
        plan.Weeks
            .SelectMany(week => week.Sessions)
            .Where(session => session.NeedsBlueprint)
            .ToDictionary(session => session.Key, session => new TrainingSessionBlueprint(
                session.Request.Name,
                session.Request.DayOffset,
                session.Request.CoachNotes,
                [.. session.Request.Exercises.Select(exercise => new ExercisePrescriptionBlueprint(
                    exercise.ExerciseId,
                    Names[exercise.ExerciseId],
                    exercise.Position,
                    exercise.IsMainLift,
                    exercise.ModificationPolicy,
                    exercise.CoachNotes,
                    exercise.ApprovedAlternativeExerciseIds,
                    [],
                    [.. exercise.Sets.Select(set => Assigned(new SetPrescriptionBlueprint(
                        set.Position,
                        set.SetType,
                        set.RepetitionsMinimum,
                        set.RepetitionsMaximum,
                        set.LoadStrategy,
                        set.DirectLoad,
                        set.LoadUnit,
                        set.PercentageWorkingMax,
                        set.LoadStep,
                        set.TargetRpe,
                        set.ExertionDisplayPreference,
                        set.RestSeconds,
                        set.Tempo,
                        set.CoachNotes)))]))]));

    private static SetPrescriptionRequest StepRequest(
        int position,
        decimal? step,
        decimal? start = null,
        TrainingSetType type = TrainingSetType.Normal) =>
        new(position, type, 10, 10, TrainingLoadStrategy.LastTimeStep, start, TrainingLoadUnit.Kilogram, null, step, 7m, null,
            ExertionDisplayPreference.Rpe, 90, null, null);

    private static SetPrescriptionRequest Request(SetPrescriptionBlueprint set) =>
        new(set.Position, set.SetType, set.RepetitionsMinimum, set.RepetitionsMaximum, set.LoadStrategy, set.DirectLoad, set.LoadUnit,
            set.PercentageWorkingMax, set.LoadStep, set.TargetRpe, null, set.ExertionDisplayPreference, set.RestSeconds, set.Tempo,
            set.CoachNotes);

    private static ExercisePrescriptionRequest Exercise(Guid id, params SetPrescriptionRequest[] sets) =>
        new(id, 1, false, PrescriptionModificationPolicy.CoachApprovedSwap, null, [], sets);

    private static TrainingWeekRequest Week(params ExercisePrescriptionRequest[] exercises) =>
        new("Week 1", true, [new TrainingSessionRequest("Lower A", 0, null, exercises)]);

    /// <summary>A warm-up of 20 kg, then a step set from 21 kg and one with no starting weight, each stepping 2 kg, at RPE 7.</summary>
    private static TrainingWeekRequest CopySource() =>
        Week(Exercise(
            CurlId,
            StepRequest(1, 2m, 20m, TrainingSetType.WarmUp),
            StepRequest(2, 2m, 21m),
            StepRequest(3, 2m)));

    private static SetPrescriptionRequest[] CopySets(TrainingWeekRequest week) =>
        [.. week.Sessions.Single().Exercises.Single().Sets];
}
