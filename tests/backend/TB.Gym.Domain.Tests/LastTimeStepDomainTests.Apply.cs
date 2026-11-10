using TB.Gym.Modules.Training;
using TB.Gym.SharedKernel;

namespace TB.Gym.Domain.Tests;

// The notes plan's N6c (decision 21 of 5 Nov 2026: the coach applies the new weight, never the app or the client;
// decisions 20 and 22 live in N6b's rule): applying a weight. What an answer writes, how the program stores it, what
// the record keeps and the client's line it gives, each with fixed numbers.
public sealed partial class LastTimeStepDomainTests
{
    private static readonly Guid ApplyKey = Guid.Parse("60000000-0000-0000-0000-0000000006c1");
    private static readonly string Fingerprint = new('a', 64);

    // The warm-up 10 → 12, two sets 15 → 17 by 2 kg and one 15 → 17.5 by its own 2.5 kg.
    private static readonly decimal[] SteppedRises = [2m, 2m, 2.5m, 2m];

    private static readonly decimal[] TwoKgSteps = [2m, 2m];

    // ----- what an answer applies -----

    [TestMethod]
    public void N6cAStepUpAppliesEverySetItMovesToAWeightItDoesNotHaveYet()
    {
        // Last 15 kg × 10, 10, 10, every set done: 17 kg next time. Set 2 already reads 17 kg (the coach typed it),
        // and set 4 is new since last time, so it keeps its own: only sets 1 and 3 are written.
        var answer = Judge(
            Coming(ComingSet(1, 2m, 15m), ComingSet(2, 2m, 17m), ComingSet(3, 2m, null), ComingSet(4, 2m, 20m)),
            Done(WorkoutA, LastWeek, Did(15m, 10, 10, 10)));
        Assert.AreEqual(LiftStandingOutcome.StepUp, answer.Outcome);

        CollectionAssert.AreEqual(
            new[] { Up(1, 17m, 15m, 2m), Up(3, 17m, null, 2m) },
            LastTimeStepRule.SetsToApply(answer).ToArray());
    }

    [TestMethod]
    public void N6cAHoldOfLineAOrCKeepsLastTimesWeightWhereTheComingSetHasAnother()
    {
        // Decision 22's carry-on (line d): a new program starts the lift at 30 kg, or with no weight at all, while last
        // time held at 25 kg; applying keeps 25 kg. A set already at 25 kg has nothing to apply.
        var short3 = Done(WorkoutA, LastWeek, Logged(1, 25m, 10), Logged(2, 25m, 10), Logged(3, 25m, 8));
        var newProgram = Judge(Coming(ComingSet(1, 2.5m, 30m), ComingSet(2, 2.5m, null), ComingSet(3, 2.5m, 25m)), short3);
        Assert.AreEqual(LiftStandingOutcome.Hold, newProgram.Outcome);
        Assert.AreEqual(LiftStandingReason.RepsShort, newProgram.Reason.Kind);

        CollectionAssert.AreEqual(
            new[] { Same(1, 25m, 30m, 2.5m), Same(2, 25m, null, 2.5m) },
            LastTimeStepRule.SetsToApply(newProgram).ToArray());

        var harder = Judge(ThreeSets(own: 15m), Done(WorkoutA, LastWeek, Rated(1, 8m, 8m), Rated(2, 8m, 9m), Rated(3, 8m, 8m)));
        Assert.AreEqual(LiftStandingReason.HarderThanPlanned, harder.Reason.Kind);
        Assert.IsEmpty(LastTimeStepRule.SetsToApply(harder), "every set already holds last time's 15 kg");
    }

    [TestMethod]
    public void N6cAHoldThatKeepsEverySetsOwnWeightAppliesNothing()
    {
        // Never done, more than 14 days ago, a forgotten Finish, nothing to match, another unit, a likely typo: each
        // coming set keeps its own weight, so applying writes nothing (decision 21: nothing moves on its own either).
        var holds = new (string Line, LiftStanding Answer)[]
        {
            ("never done", Judge(ThreeSets(own: null))),
            ("(b) 15 days", Judge(ThreeSets(own: null), Done(WorkoutA, FifteenDaysAgo, Did(15m, 10, 10, 10)))),
            ("(g) running", Judge(ThreeSets(own: null), Running(WorkoutA, LastWeek, Did(15m, 10, 10, 10)))),
            ("the unit", Judge(ThreeSets(own: null), Done(WorkoutA, LastWeek,
                Logged(1, 15m, 10, unit: Lb), Logged(2, 15m, 10), Logged(3, 15m, 10)))),
            ("(e) typo", Judge(ThreeSets(own: null),
                Done(WorkoutA, TwoWeeksAgo, Did(5.5m, 10, 10, 10)),
                Done(WorkoutB, LastWeek, Did(55m, 10, 10, 10)))),
        };
        foreach (var (line, answer) in holds)
        {
            Assert.AreEqual(LiftStandingOutcome.Hold, answer.Outcome, line);
            Assert.IsTrue(answer.Sets.All(set => set.Move == SetStandingMove.Unchanged), line);
            Assert.IsEmpty(LastTimeStepRule.SetsToApply(answer), line);
        }
    }

    [TestMethod]
    public void N6cTheSetKeepsWhyItHoldsItsWeightInPlainWords()
    {
        var up = Judge(ThreeSets(own: 15m), Done(WorkoutA, LastWeek, Did(15m, 10, 10, 10)));
        Assert.AreEqual(
            "15 kg logged on 2026-11-03 plus the 2 kg step (LastTimeStep v1), applied by the coach.",
            LastTimeStepRule.Explain(up, up.Sets[0]));

        var kept = Judge(ThreeSets(own: null), Done(WorkoutA, LastWeek, Logged(1, 25m, 10), Logged(2, 25m, 9), Logged(3, 25m, 10)));
        Assert.AreEqual(
            "25 kg logged on 2026-11-03, kept (LastTimeStep v1), applied by the coach.",
            LastTimeStepRule.Explain(kept, kept.Sets[0]));

        var limit = Judge(Coming(ComingSet(1, 2.5m, 1_999m)), Done(WorkoutA, LastWeek, Logged(1, 1_999m, 10)));
        Assert.AreEqual(
            "1999 kg logged on 2026-11-03, kept as a step would pass 2000 kg (LastTimeStep v1), applied by the coach.",
            LastTimeStepRule.Explain(limit, limit.Sets[0]));

        // A set last time left without a weight carries on its latest log that stood (line d).
        var carried = Judge(
            ThreeSets(own: null),
            Done(WorkoutA, TwoWeeksAgo, Did(15m, 10, 10, 10)),
            Done(WorkoutB, LastWeek, Logged(1, 15m, 10), Logged(2, null, null, completed: false), Logged(3, 15m, 10)));
        var set2 = carried.Sets.Single(set => set.SetNumber == 2);
        Assert.AreEqual(SetStandingNote.NoWeightLogged, set2.Note);
        Assert.AreEqual(
            "15 kg, the set's latest log that stood, carried on (LastTimeStep v1), applied by the coach.",
            LastTimeStepRule.Explain(carried, set2));
    }

    // ----- how the program stores it -----

    [TestMethod]
    public void N6cApplyingWritesTheWeightAsTheSetsOwnAndKeepsItsStep()
    {
        var block = Mesocycle(Session(Assigned(StepSet(2m, 15m)), Assigned(StepSet(2m, position: 2))));
        var sets = block.Weeks.Single().Sessions.Single().Exercises.Single().Sets.OrderBy(set => set.Position).ToArray();
        var before = block.MutationSequence;

        var changed = block.ApplyLiftWeights(
            new Dictionary<Guid, AppliedLiftWeight>
            {
                [sets[0].Id] = new(15m, 17m, Kg, "15 kg plus the 2 kg step."),
                [sets[1].Id] = new(null, 17.125m, Kg, "Kept."),
            },
            Start);

        Assert.AreEqual((1, 2), changed);
        Assert.AreEqual(before + 1, block.MutationSequence, "the program's version moves on, as Edit weeks' does");
        foreach (var (set, weight, why) in new[] { (sets[0], 17m, "15 kg plus the 2 kg step."), (sets[1], 17.125m, "Kept.") })
        {
            // A typed weight's place (TRN-032): Edit weeks, Build next block and the snapshot read it there.
            Assert.AreEqual((TrainingLoadStrategy.LastTimeStep, 2m, (TrainingLoadUnit?)Kg),
                (set.LoadStrategy, set.LoadStep!.Value, set.LoadUnit));
            Assert.AreEqual(((decimal?)weight, (decimal?)weight, (decimal?)weight),
                (set.DirectLoad, set.PrescribedLoad, set.UnroundedRecommendedLoad));
            Assert.AreEqual(("LastTimeStep", "1", why), (set.CalculationStrategyKey, set.CalculationStrategyVersion, set.CalculationExplanation));
            Assert.IsNull(set.WorkingMaxSnapshotId);
            Assert.IsFalse(set.IsManualLoadOverride);
        }
    }

    [TestMethod]
    public void N6cApplyingRefusesAWorkoutStartedOrPastAnotherChoiceAnotherUnitAndAWeightOutOfRange()
    {
        // Every set here starts at 15 kg, the weight the coach read.
        AppliedLiftWeight Weight(decimal weight, TrainingLoadUnit unit = Kg) => new(15m, weight, unit, "Why.");

        // Two weeks of Lower A: week 1's on Mon 9 Nov is the day before "today" (Tue 10 Nov) or started.
        var past = Mesocycle(2, Session(Assigned(StepSet(2m, 15m))));
        var weekOne = past.Weeks.Single(week => week.WeekNumber == 1).Sessions.Single().Exercises.Single().Sets.Single();
        Assert.ThrowsExactly<InvalidOperationException>(
            () => past.ApplyLiftWeights(new Dictionary<Guid, AppliedLiftWeight> { [weekOne.Id] = Weight(17m) }, Today));

        var started = Mesocycle(Session(Assigned(StepSet(2m, 15m))));
        started.MarkSessionStarted(started.Weeks.Single().Sessions.Single().Id);
        Assert.ThrowsExactly<InvalidOperationException>(() => started.ApplyLiftWeights(
            new Dictionary<Guid, AppliedLiftWeight> { [Only(started).Id] = Weight(17m) }, Start));

        var typed = Mesocycle(Session(Assigned(Set(TrainingLoadStrategy.Direct, direct: 15m))));
        var onlyStep = Assert.ThrowsExactly<InvalidOperationException>(() => typed.ApplyLiftWeights(
            new Dictionary<Guid, AppliedLiftWeight> { [Only(typed).Id] = Weight(17m) }, Start));
        Assert.AreEqual("Only a last time + step set takes an applied weight.", onlyStep.Message);

        foreach (var (weight, unit, label) in new[]
                 {
                     (17m, Lb, "pounds on a kilogram set: never converted"),
                     (0m, Kg, "nothing"),
                     (2_000.001m, Kg, "past 2,000"),
                     (17.0004m, Kg, "finer than a gram, which the database would round to 17"),
                 })
        {
            var block = Mesocycle(Session(Assigned(StepSet(2m, 15m))));
            Assert.ThrowsExactly<ArgumentException>(
                () => block.ApplyLiftWeights(new Dictionary<Guid, AppliedLiftWeight> { [Only(block).Id] = Weight(weight, unit) }, Start),
                label);
            Assert.AreEqual(15m, Only(block).DirectLoad, label);
        }

        var other = Mesocycle(Session(Assigned(StepSet(2m, 15m))));
        Assert.ThrowsExactly<ArgumentException>(() => other.ApplyLiftWeights(
            new Dictionary<Guid, AppliedLiftWeight> { [Guid.NewGuid()] = Weight(17m) }, Start), "a set of another program");
        Assert.ThrowsExactly<ArgumentException>(() => other.ApplyLiftWeights(new Dictionary<Guid, AppliedLiftWeight>(), Start));

        other.Cancel(Now);
        Assert.ThrowsExactly<InvalidOperationException>(() => other.ApplyLiftWeights(
            new Dictionary<Guid, AppliedLiftWeight> { [Only(other).Id] = Weight(17m) }, Start), "a cancelled program");
    }

    [TestMethod]
    public void N6cApplyingRefusesASetWhoseWeightChangedSinceTheCoachReadIt()
    {
        // Two coaches read 15 kg; the first applies 17. The second's apply, read at 15, is refused and asked to read
        // again rather than recording a change from 15 that never happened (decision 21's coach, STR-020).
        var block = Mesocycle(Session(Assigned(StepSet(2m, 15m))));
        var set = Only(block);
        block.ApplyLiftWeights(new Dictionary<Guid, AppliedLiftWeight> { [set.Id] = new(15m, 17m, Kg, "First.") }, Start);
        var refused = Assert.ThrowsExactly<InvalidOperationException>(() => block.ApplyLiftWeights(
            new Dictionary<Guid, AppliedLiftWeight> { [set.Id] = new(15m, 17m, Kg, "Second.") }, Start));
        Assert.AreEqual("This set's weight changed since it was read. Read it again, then apply.", refused.Message);
        Assert.AreEqual(("First.", 17m), (set.CalculationExplanation, set.DirectLoad!.Value));

        // A set the client picks for (no weight yet) is read as none.
        var picked = Mesocycle(Session(Assigned(StepSet(2m))));
        Assert.ThrowsExactly<InvalidOperationException>(() => picked.ApplyLiftWeights(
            new Dictionary<Guid, AppliedLiftWeight> { [Only(picked).Id] = new(15m, 17m, Kg, "Read as 15.") }, Start));
        picked.ApplyLiftWeights(new Dictionary<Guid, AppliedLiftWeight> { [Only(picked).Id] = new(null, 17m, Kg, "Read as none.") }, Start);
        Assert.AreEqual(17m, Only(picked).PrescribedLoad);
    }

    [TestMethod]
    public void N6cACarriedOnWeightOfNothingIsNoWeightToApply()
    {
        // The client logged 0 kg x 8 of 10 on a dip with no starting weight: the hold keeps 0 kg (line d), which no
        // set can take, so the set keeps its own and nothing is offered.
        var answer = Judge(Coming(ComingSet(1, 2.5m, null)), Done(WorkoutA, LastWeek, Logged(1, 0m, 8)));
        Assert.AreEqual((LiftStandingOutcome.Hold, LiftStandingReason.RepsShort), (answer.Outcome, answer.Reason.Kind));
        Assert.AreEqual((decimal?)0m, answer.Sets.Single().Weight);
        Assert.IsEmpty(LastTimeStepRule.SetsToApply(answer));
    }

    [TestMethod]
    public void N6cEditWeeksKeepsAnAppliedWeightAndItsStep()
    {
        // Sent as stored, the session keeps its rows, its applied weight and why; changed, it is rebuilt from the
        // grid, which sends the set's weight back (TRN-028), so the weight and the step stay and only the record of
        // why goes back to the coach's own weight.
        var block = EditBlock(2);
        var curl = Ordered(block)[0].Sessions.Single().Exercises.Single(item => item.ExerciseId == CurlId).Sets.Single();
        block.ApplyLiftWeights(
            new Dictionary<Guid, AppliedLiftWeight> { [curl.Id] = new(21m, 23m, Kg, "21 kg plus the 2 kg step.") }, Start);

        var kept = PlanFor(block);
        Assert.IsFalse(kept.HasChanges, "the grid as stored changes nothing");

        var rested = PlanFor(block, curl: set => set with { RestSeconds = 120 });
        block.ApplyProgramEdit(rested, Blueprints(rested));
        var after = Ordered(block)[0].Sessions.Single().Exercises.Single(item => item.ExerciseId == CurlId).Sets.Single();
        Assert.AreEqual((TrainingLoadStrategy.LastTimeStep, 2m, 23m, 23m, 120),
            (after.LoadStrategy, after.LoadStep!.Value, after.DirectLoad!.Value, after.PrescribedLoad!.Value, after.RestSeconds!.Value));
    }

    // ----- what the record keeps -----

    [TestMethod]
    public void N6cTheRecordKeepsTheRuleWhatItReadAndRefusesWhatIsNotAnApply()
    {
        var answer = Judge(ThreeSets(own: 15m), Done(WorkoutA, LastWeek, Did(15m, 10, 10, 10)));
        var sets = Applied(answer);
        var record = LiftWeightApplication.Record(TenantId, ClientId, Target(), answer, sets, ApplyKey, Fingerprint, "{}", "[]");

        Assert.AreEqual(("LastTimeStep", 1), (record.RuleKey, record.RuleVersion));
        Assert.AreEqual((LiftStandingOutcome.StepUp, LiftStandingReason.EverySetDone), (record.Outcome, record.ReasonKind));
        Assert.AreEqual(((Guid?)WorkoutA, (DateOnly?)LastWeek, Today), (record.LastTimeWorkoutExecutionId, record.LastTimeDay, record.JudgedOn));
        Assert.AreEqual((ClientId, 3, ApplyKey, Fingerprint), (record.ClientProfileId, record.SetCount, record.IdempotencyKey, record.RequestFingerprint));
        Assert.AreEqual(("Lower A", Today, CurlId, "Seated Leg Curl", 1),
            (record.SessionName, record.SessionDate, record.ExerciseId, record.ExerciseName, record.Occurrence));

        var refused = new (string Label, Func<LiftWeightApplication> Record)[]
        {
            ("no key", () => LiftWeightApplication.Record(TenantId, ClientId, Target(), answer, sets, Guid.Empty, Fingerprint, "{}", "[]")),
            ("a fingerprint not in lowercase hex", () => LiftWeightApplication.Record(
                TenantId, ClientId, Target(), answer, sets, ApplyKey, new string('A', 64), "{}", "[]")),
            ("no set", () => LiftWeightApplication.Record(TenantId, ClientId, Target(), answer, [], ApplyKey, Fingerprint, "{}", "[]")),
            ("a set that keeps its own weight", () => LiftWeightApplication.Record(TenantId, ClientId, Target(), answer,
                [sets[0] with { Move = SetStandingMove.Unchanged }], ApplyKey, Fingerprint, "{}", "[]")),
            ("a weight that stays", () => LiftWeightApplication.Record(TenantId, ClientId, Target(), answer,
                [sets[0] with { WeightBefore = 17m }], ApplyKey, Fingerprint, "{}", "[]")),
            ("past 2,000", () => LiftWeightApplication.Record(TenantId, ClientId, Target(), answer,
                [sets[0] with { WeightAfter = 2_000.5m }], ApplyKey, Fingerprint, "{}", "[]")),
            ("one set twice", () => LiftWeightApplication.Record(TenantId, ClientId, Target(), answer,
                [sets[0], sets[0]], ApplyKey, Fingerprint, "{}", "[]")),
            ("no client", () => LiftWeightApplication.Record(TenantId, Guid.Empty, Target(), answer, sets, ApplyKey, Fingerprint, "{}", "[]")),
        };
        foreach (var (label, make) in refused)
        {
            Assert.ThrowsExactly<ArgumentException>(() => make(), label);
        }
    }

    // ----- the client's line -----

    [TestMethod]
    public void N6cTheClientsLineNamesTheStepAndLastTimesSetsOrWhyTheWeightHeld()
    {
        // "Up 2 kg · all 3 × 10 done on Tue": each stepped set's rise, last time's working sets and the reps each asked.
        var warmUp = Logged(1, 10m, 10, type: TrainingSetType.WarmUp);
        var up = Judge(
            Coming(ComingSet(1, 2m, 10m), ComingSet(2, 2m, 15m), ComingSet(3, 2.5m, 15m), ComingSet(4, 2m, 15m)),
            Done(WorkoutA, LastWeek, warmUp, Logged(2, 15m, 10), Logged(3, 15m, 10), Logged(4, 15m, 12, asked: 12)));
        var note = LiftWeightNotes.For(View(up), Applied(up));
        Assert.IsNotNull(note);
        Assert.AreEqual((SetStandingMove.StepUp, Kg, LastWeek, 3, (int?)null, (LiftStandingReasonDetail?)null),
            (note.Move, note.Unit, note.LastTimeDay, note.WorkingSets, note.RepetitionsAsked, note.Reason),
            "the warm-up is not a working set, and the reps asked differ");
        CollectionAssert.AreEqual(SteppedRises, note.Increases.ToArray());

        var same = Judge(ThreeSets(own: 30m), Done(WorkoutA, LastWeek, Logged(1, 25m, 12, asked: 12), Logged(2, 25m, 11, asked: 12),
            Logged(3, 25m, 12, asked: 12)));
        var kept = LiftWeightNotes.For(View(same), Applied(same));
        Assert.IsNotNull(kept);
        Assert.AreEqual((SetStandingMove.SameAsLastTime, 3, (int?)12), (kept.Move, kept.WorkingSets, kept.RepetitionsAsked));
        Assert.IsEmpty(kept.Increases);
        Assert.AreEqual(Why(LiftStandingReason.RepsShort, LastWeek, set: 2, reps: 11, asked: 12), kept.Reason);
        Assert.AreEqual(ExertionDisplayPreference.Rir, LiftWeightNotes.For(View(same) with { ExertionDisplay = ExertionDisplayPreference.Rir },
            Applied(same))!.ExertionDisplay);

        Assert.IsNull(LiftWeightNotes.For(View(Judge(ThreeSets(own: null))), Applied(up)), "nothing read, nothing to say");

        // A step up whose stepped sets already held their new weight, the apply writing only a set carried on: the
        // line is the step, and it holds while the stepped sets keep theirs too.
        var carriedOnly = Judge(
            Coming(ComingSet(1, 2m, 17m), ComingSet(2, 2m, 17m), ComingSet(3, 2m, null)),
            Done(WorkoutA, TwoWeeksAgo, Did(15m, 10, 10, 10)),
            Done(WorkoutB, LastWeek, Logged(1, 15m, 10), Logged(2, 15m, 10), Logged(3, null, 10)));
        Assert.AreEqual(LiftStandingOutcome.StepUp, carriedOnly.Outcome);
        var written = Applied(carriedOnly);
        Assert.AreEqual(3, written.Single().SetNumber, "only the carried set moves");
        var stepNote = LiftWeightNotes.For(View(carriedOnly), written);
        Assert.AreEqual(SetStandingMove.StepUp, stepNote!.Move);
        CollectionAssert.AreEqual(TwoKgSteps, stepNote.Increases.ToArray());
        CollectionAssert.AreEquivalent(
            new[] { (SetId(1), 17m), (SetId(2), 17m), (SetId(3), 15m) },
            LiftWeightNotes.HeldWeights(View(carriedOnly), written).Select(item => (item.Key, item.Value)).ToArray());
    }

    // ----- builders for applying -----

    private static AppliedLiftSet[] Applied(LiftStanding answer) =>
    [
        .. LastTimeStepRule.SetsToApply(answer).Select(set => new AppliedLiftSet(
            set.SetPrescriptionId, set.SetNumber, set.Move, set.CurrentWeight, set.Weight!.Value, set.Unit, set.Step)),
    ];

    private static LiftWeightTarget Target() =>
        new(Guid.NewGuid(), Guid.NewGuid(), "Lower A", Today, Guid.NewGuid(), CurlId, "Seated Leg Curl", 1);

    private static LiftStandingView View(LiftStanding answer) =>
        new(LastTimeStepRule.Key, LastTimeStepRule.Version, Guid.NewGuid(), Guid.NewGuid(), "Lower A", Today, Guid.NewGuid(),
            CurlId, "Seated Leg Curl", 1, ExertionDisplayPreference.Rpe, answer);
}
