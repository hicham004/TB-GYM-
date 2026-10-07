using TB.Gym.Modules.Training;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// P3b, editing a client's weeks in the builder's grid (TRN-028, ADR 0036): which sessions are open, which weeks
/// keep their place, how a requested grid is planned against the stored weeks, and that applying a plan touches
/// nothing that has started, finished or passed.
/// </summary>
[TestClass]
public sealed class ProgramEditDomainTests
{
    private static readonly Guid TenantId = Guid.Parse("10000000-0000-0000-0000-000000000031");
    private static readonly Guid ClientId = Guid.Parse("20000000-0000-0000-0000-000000000031");
    private static readonly Guid SquatId = Guid.Parse("30000000-0000-0000-0000-000000000031");
    private static readonly Guid BenchId = Guid.Parse("30000000-0000-0000-0000-000000000032");

    // The block starts on Monday 12 Oct 2026: week n starts on 12 Oct + 7 (n - 1) days, and its sessions are on
    // days 0, 2 and 4 (Monday, Wednesday, Friday).
    private static readonly DateOnly Start = new(2026, 10, 12);

    private static DateOnly Monday(int week) => Start.AddDays(7 * (week - 1));

    private static readonly int[] FourPlaces = [0, 1, 2, 3];
    private static readonly int[] WeeksThreeToFive = [3, 4, 5];
    private static readonly (int, int)[] MovedUpTwoWeeks = [(3, 4), (4, 5)];

    // ----- what is open -----

    [TestMethod]
    public void ASessionIsOpenUntilItStartsOrItsDayHasPassed()
    {
        var block = Block(2);
        var monday = Session(block, 1, 0);

        Assert.IsTrue(ProgramEditRules.IsOpen(monday, Monday(1)));
        Assert.IsFalse(ProgramEditRules.IsOpen(monday, Monday(1).AddDays(1)));

        block.MarkSessionStarted(Session(block, 2, 0).Id);
        Assert.IsFalse(ProgramEditRules.IsOpen(Session(block, 2, 0), Monday(1)));
    }

    [TestMethod]
    public void WeeksUpToTheLastOneWithASessionThatIsNotOpenKeepTheirPlace()
    {
        var block = Block(4);
        Assert.AreEqual(0, ProgramEditRules.FrozenWeekCount(Ordered(block), Monday(1)));

        // Week 2's Monday has passed: weeks 1 and 2 stay.
        Assert.AreEqual(2, ProgramEditRules.FrozenWeekCount(Ordered(block), Monday(2).AddDays(1)));

        // A session started early, in week 4, freezes weeks 1 to 4 although the others are still ahead.
        block.MarkSessionStarted(Session(block, 4, 2).Id);
        Assert.AreEqual(4, ProgramEditRules.FrozenWeekCount(Ordered(block), Monday(1)));
    }

    // ----- planning -----

    [TestMethod]
    public void AGridThatAsksForWhatIsStoredPlansNothing()
    {
        var block = Block(3);

        var plan = ProgramEditPlanner.Plan(block, Current(block, Monday(1)), Monday(1));

        Assert.IsFalse(plan.HasChanges);
        Assert.IsEmpty(plan.RemovedSessions);
        Assert.IsEmpty(plan.RemovedWeeks);
        Assert.IsTrue(plan.Weeks.SelectMany(week => week.Sessions).All(item => item.Disposition == ProgramEditDisposition.Keep));
        Assert.AreEqual(Start.AddDays(21), plan.ResultingEndDateExclusive(block.StartDate));
    }

    [TestMethod]
    public void ChangingASetReplacesThatSessionInPlaceAndNothingElse()
    {
        var block = Block(3);
        var weeks = Current(block, Monday(1)).ToArray();
        var target = weeks[1].Sessions[0];
        weeks[1] = weeks[1] with
        {
            Sessions = [target with { Session = WithReps(target.Session, 8) }, .. weeks[1].Sessions.Skip(1)],
        };

        var plan = ProgramEditPlanner.Plan(block, weeks, Monday(1));

        var change = plan.SessionChanges.Single();
        Assert.AreEqual((ProgramEditChangeKind.Edited, 2, Monday(2)), (change.Kind, change.WeekNumber, change.Date));
        Assert.AreEqual(target.SessionId!.Value, change.Existing!.Id);
        Assert.IsNull(change.PreviousDate);
        var planned = plan.Weeks[1].Sessions.Single(item => item.Existing!.Id == target.SessionId);
        Assert.AreEqual((ProgramEditDisposition.Replace, true), (planned.Disposition, planned.ContentChanged));
        Assert.AreEqual(change.Existing!.Position, planned.Position);
        Assert.AreEqual(1, plan.SessionsEdited);
        Assert.AreEqual(0, plan.SessionsAdded + plan.SessionsMoved + plan.SessionsRemoved);
        Assert.IsEmpty(plan.RemovedSessions);
    }

    [TestMethod]
    public void AnotherDayInTheSameWeekIsAnEditThatKeepsTheRow()
    {
        var block = Block(2);
        var weeks = Current(block, Monday(1)).ToArray();
        var wednesday = weeks[0].Sessions[1];
        weeks[0] = weeks[0] with
        {
            Sessions = [weeks[0].Sessions[0], wednesday with { Session = wednesday.Session with { DayOffset = 3 } }, weeks[0].Sessions[2]],
        };

        var plan = ProgramEditPlanner.Plan(block, weeks, Monday(1));

        var change = plan.SessionChanges.Single();
        Assert.AreEqual(ProgramEditChangeKind.Edited, change.Kind);
        Assert.AreEqual((Monday(1).AddDays(3), Monday(1).AddDays(2)), (change.Date, change.PreviousDate!.Value));
        Assert.AreEqual(ProgramEditDisposition.Replace, plan.Weeks[0].Sessions[1].Disposition);
    }

    [TestMethod]
    public void ASessionAddedToAWeekGoesAfterTheOnesThatStay()
    {
        var block = Block(2);
        var weeks = Current(block, Monday(1)).ToArray();
        var added = new ProgramEditSessionRequest(null, NewSession("Mobility", 5));
        weeks[0] = weeks[0] with { Sessions = [.. weeks[0].Sessions, added] };

        var plan = ProgramEditPlanner.Plan(block, weeks, Monday(1));

        var change = plan.SessionChanges.Single();
        Assert.AreEqual((ProgramEditChangeKind.Added, "Mobility", 1, Monday(1).AddDays(5)), (change.Kind, change.Name, change.WeekNumber, change.Date));
        Assert.IsNull(change.Existing);
        var planned = plan.Weeks[0].Sessions[3];
        Assert.AreEqual((ProgramEditDisposition.Create, 3), (planned.Disposition, planned.Position));
    }

    [TestMethod]
    public void ASessionSlottedBetweenTwoThatStayIsNumberedFirstAndTheLaterOnesAreBuiltAgain()
    {
        var block = Block(1);
        var weeks = Current(block, Monday(1)).ToArray();
        var between = new ProgramEditSessionRequest(null, NewSession("Core", 1));
        weeks[0] = weeks[0] with { Sessions = [weeks[0].Sessions[0], between, weeks[0].Sessions[1], weeks[0].Sessions[2]] };

        var plan = ProgramEditPlanner.Plan(block, weeks, Monday(1));

        // Only the new session is a change: the two after it are built again exactly as they were.
        Assert.AreEqual(ProgramEditChangeKind.Added, plan.SessionChanges.Single().Kind);
        var sessions = plan.Weeks[0].Sessions;
        Assert.AreEqual(ProgramEditDisposition.Keep, sessions[0].Disposition);
        CollectionAssert.AreEqual(FourPlaces, sessions.Select(item => item.Position).ToArray());
        Assert.AreEqual(
            (ProgramEditDisposition.Create, ProgramEditDisposition.Create, ProgramEditDisposition.Create),
            (sessions[1].Disposition, sessions[2].Disposition, sessions[3].Disposition));
        Assert.IsFalse(sessions[2].ContentChanged);
        Assert.HasCount(2, plan.RemovedSessions);
    }

    [TestMethod]
    public void ASessionNobodyAsksForGoesAndIsCountedOnce()
    {
        var block = Block(2);
        var weeks = Current(block, Monday(1)).ToArray();
        var removed = weeks[1].Sessions[2];
        weeks[1] = weeks[1] with { Sessions = [.. weeks[1].Sessions.Take(2)] };

        var plan = ProgramEditPlanner.Plan(block, weeks, Monday(1));

        var change = plan.SessionChanges.Single();
        Assert.AreEqual((ProgramEditChangeKind.Removed, 2, Monday(2).AddDays(4)), (change.Kind, change.WeekNumber, change.Date));
        Assert.AreEqual(removed.SessionId!.Value, plan.RemovedSessions.Single().Id);
        Assert.AreEqual(1, plan.SessionsRemoved);
    }

    [TestMethod]
    public void ASessionDraggedToAnotherWeekIsBuiltThereAndTakenOutOfTheOldOne()
    {
        var block = Block(3);
        var weeks = Current(block, Monday(1)).ToArray();
        var moved = weeks[0].Sessions[2];
        weeks[0] = weeks[0] with { Sessions = [.. weeks[0].Sessions.Take(2)] };
        weeks[2] = weeks[2] with { Sessions = [.. weeks[2].Sessions, moved] };

        var plan = ProgramEditPlanner.Plan(block, weeks, Monday(1));

        var change = plan.SessionChanges.Single();
        Assert.AreEqual((ProgramEditChangeKind.Moved, 3, 1), (change.Kind, change.WeekNumber, change.PreviousWeekNumber!.Value));
        Assert.AreEqual((Monday(3).AddDays(4), Monday(1).AddDays(4)), (change.Date, change.PreviousDate!.Value));
        Assert.AreEqual(moved.SessionId!.Value, plan.RemovedSessions.Single().Id);
        var planned = plan.Weeks[2].Sessions[3];
        Assert.AreEqual((ProgramEditDisposition.Create, moved.SessionId!.Value), (planned.Disposition, planned.Existing!.Id));
        Assert.AreEqual(0, plan.SessionsRemoved);
    }

    [TestMethod]
    public void WhatHasStartedOrPassedIsNeverInARequestAndNeverTouched()
    {
        var block = Block(3);
        var today = Monday(2).AddDays(1);

        // Week 1 is over and week 2's Monday has passed, so neither is in the request.
        var weeks = Current(block, today).ToArray();
        Assert.HasCount(2, weeks[1].Sessions);
        var plan = ProgramEditPlanner.Plan(block, weeks, today);

        Assert.IsFalse(plan.HasChanges);
        Assert.AreEqual(2, plan.FrozenWeekCount);
        Assert.IsTrue(plan.RemovedSessions.All(session => session.ScheduledDate >= today));

        // Asking for a session that has passed is refused.
        var mondayOfWeekTwo = Session(block, 2, 0);
        var request = weeks.ToArray();
        request[1] = request[1] with
        {
            Sessions = [new ProgramEditSessionRequest(mondayOfWeekTwo.Id, Request(mondayOfWeekTwo)), .. request[1].Sessions],
        };
        var refused = Assert.ThrowsExactly<ArgumentException>(() => ProgramEditPlanner.Plan(block, request, today));
        StringAssert.Contains(refused.Message, "has started or passed");
    }

    [TestMethod]
    public void AStartedSessionCannotBeEditedAndTheOthersOfItsWeekStillCan()
    {
        var block = Block(2);
        var started = Session(block, 1, 2);
        block.MarkSessionStarted(started.Id);
        var weeks = Current(block, Monday(1)).ToArray();

        // The started Wednesday is not asked for, and nothing else of the week changes.
        Assert.HasCount(2, weeks[0].Sessions);
        var untouched = ProgramEditPlanner.Plan(block, weeks, Monday(1));
        Assert.IsFalse(untouched.HasChanges);
        Assert.AreEqual(1, untouched.FrozenWeekCount);

        // The two that remain can be changed, and the started one is not in the way of their places.
        var friday = weeks[0].Sessions[1];
        weeks[0] = weeks[0] with { Sessions = [weeks[0].Sessions[0], friday with { Session = WithReps(friday.Session, 3) }] };
        var plan = ProgramEditPlanner.Plan(block, weeks, Monday(1));
        Assert.AreEqual(1, plan.SessionsEdited);

        // A new session goes after the started one, whatever day the coach gave it.
        weeks[0] = weeks[0] with { Sessions = [.. weeks[0].Sessions, new ProgramEditSessionRequest(null, NewSession("Extra", 1))] };
        var withExtra = ProgramEditPlanner.Plan(block, weeks, Monday(1));
        Assert.IsGreaterThan(started.Position, withExtra.Weeks[0].Sessions[2].Position);
    }

    [TestMethod]
    public void WeeksThatHaveStartedCannotBeMovedRemovedOrSquashedUp()
    {
        var block = Block(4);
        var today = Monday(2).AddDays(1);
        var weeks = Current(block, today);

        // Dropping week 2: week 3 would take its place.
        var dropped = Assert.ThrowsExactly<ArgumentException>(
            () => ProgramEditPlanner.Plan(block, [weeks[0], weeks[2], weeks[3]], today));
        StringAssert.Contains(dropped.Message, "stays where it is");

        // Dropping every week from week 2 on.
        var cut = Assert.ThrowsExactly<ArgumentException>(
            () => ProgramEditPlanner.Plan(block, [weeks[0]], today));
        StringAssert.Contains(cut.Message, "stay in the program");

        // Swapping week 2 with week 3.
        var swapped = Assert.ThrowsExactly<ArgumentException>(
            () => ProgramEditPlanner.Plan(block, [weeks[0], weeks[2], weeks[1], weeks[3]], today));
        StringAssert.Contains(swapped.Message, "stays where it is");

        // A new week before week 3.
        var blank = new ProgramEditWeekRequest(null, "Extra", true, []);
        var inserted = Assert.ThrowsExactly<ArgumentException>(
            () => ProgramEditPlanner.Plan(block, [weeks[0], blank, weeks[1], weeks[2], weeks[3]], today));
        StringAssert.Contains(inserted.Message, "can't go before week 3");
    }

    [TestMethod]
    public void WeeksAfterTheLastOneThatHasStartedCanBeAddedRemovedAndMoved()
    {
        var block = Block(5);
        var today = Monday(2).AddDays(1);
        var weeks = Current(block, today);

        // Keep weeks 1 and 2, drop week 3, let weeks 4 and 5 move up, and add a week at the end.
        var added = new ProgramEditWeekRequest(null, "Deload", true, [new ProgramEditSessionRequest(null, NewSession("Easy day", 0))]);
        var plan = ProgramEditPlanner.Plan(block, [weeks[0], weeks[1], weeks[3], weeks[4], added], today);

        Assert.AreEqual((1, 2, 1), (plan.WeeksAdded, plan.WeeksMoved, plan.WeeksRemoved));
        Assert.AreEqual(3, plan.WeekChanges.Single(change => change.Kind == ProgramEditChangeKind.Removed).WeekNumber);
        CollectionAssert.AreEqual(
            MovedUpTwoWeeks,
            plan.WeekChanges
                .Where(change => change.Kind == ProgramEditChangeKind.Moved)
                .Select(change => (change.WeekNumber, change.PreviousWeekNumber!.Value))
                .Order()
                .ToArray());

        // The rows of the dropped and moved weeks go; those that stay keep their row, the rest are built where they land.
        CollectionAssert.AreEqual(WeeksThreeToFive, plan.RemovedWeeks.Select(week => week.WeekNumber).Order().ToArray());
        Assert.IsTrue(plan.Weeks[0].KeepsRow && plan.Weeks[1].KeepsRow);
        Assert.IsFalse(plan.Weeks[2].KeepsRow);
        Assert.AreEqual(Monday(3), plan.Weeks[2].StartsOn);
        Assert.HasCount(5, plan.Weeks);

        // A moved week's sessions are taken a week earlier, and nothing of them was edited.
        var shifted = plan.SessionChanges.Where(change => change.Kind == ProgramEditChangeKind.Moved).ToArray();
        Assert.HasCount(6, shifted);
        Assert.IsTrue(shifted.All(change => change.PreviousDate!.Value == change.Date.AddDays(7)));
        Assert.AreEqual(3, plan.SessionsRemoved);
        Assert.AreEqual(1, plan.SessionsAdded);
        Assert.AreEqual(Start.AddDays(35), plan.ResultingEndDateExclusive(block.StartDate));
    }

    [TestMethod]
    public void ASessionCannotBeNewOrMoveOntoAPastDay()
    {
        var block = Block(3);
        var today = Monday(2).AddDays(1);
        var weeks = Current(block, today).ToArray();

        var onMondayOfWeekTwo = new ProgramEditSessionRequest(null, NewSession("Late", 0));
        weeks[1] = weeks[1] with { Sessions = [onMondayOfWeekTwo, .. weeks[1].Sessions] };

        var refused = Assert.ThrowsExactly<ArgumentException>(() => ProgramEditPlanner.Plan(block, weeks, today));
        StringAssert.Contains(refused.Message, "Week 2, Late");
        StringAssert.Contains(refused.Message, "has already passed");
    }

    [TestMethod]
    public void AWeekHoldsUpToFourteenSessionsCountingTheOnesThatAreNotOpen()
    {
        var block = Block(2);
        var today = Monday(1).AddDays(1);
        var weeks = Current(block, today).ToArray();
        var original = weeks[0];

        // Week 1's Monday has passed (1), and its Wednesday and Friday are asked for (2): 11 more make 14.
        ProgramEditSessionRequest[] Extra(int count) =>
            [.. Enumerable.Range(0, count).Select(_ => new ProgramEditSessionRequest(null, NewSession("Extra", 5)))];
        weeks[0] = original with { Sessions = [.. original.Sessions, .. Extra(12)] };
        var refused = Assert.ThrowsExactly<ArgumentException>(() => ProgramEditPlanner.Plan(block, weeks, today));
        StringAssert.Contains(refused.Message, "Week 1 holds up to 14 sessions");

        weeks[0] = original with { Sessions = [.. original.Sessions, .. Extra(11)] };
        Assert.AreEqual(11, ProgramEditPlanner.Plan(block, weeks, today).SessionsAdded);
    }

    [TestMethod]
    public void AProgramHasOneToFiftyTwoWeeks()
    {
        var block = Block(2);
        var weeks = Current(block, Monday(1));
        var blank = Enumerable.Range(0, 51).Select(_ => new ProgramEditWeekRequest(null, null, true, [])).ToArray();

        Assert.ThrowsExactly<ArgumentException>(() => ProgramEditPlanner.Plan(block, [], Monday(1)));
        var tooMany = Assert.ThrowsExactly<ArgumentException>(
            () => ProgramEditPlanner.Plan(block, [.. weeks, .. blank], Monday(1)));
        StringAssert.Contains(tooMany.Message, "1 to 52 weeks");

        var fifty = ProgramEditPlanner.Plan(block, [.. weeks, .. blank.Take(50)], Monday(1));
        Assert.HasCount(52, fifty.Weeks);
        Assert.AreEqual(50, fifty.WeeksAdded);
    }

    [TestMethod]
    public void AnIdTheProgramDoesNotHaveOrOneUsedTwiceIsRefused()
    {
        var block = Block(2);
        var weeks = Current(block, Monday(1)).ToArray();

        var unknownWeek = weeks.ToArray();
        unknownWeek[1] = unknownWeek[1] with { WeekId = Guid.NewGuid() };
        Assert.ThrowsExactly<ArgumentException>(() => ProgramEditPlanner.Plan(block, unknownWeek, Monday(1)));

        var sameWeekTwice = new[] { weeks[0], weeks[0] };
        Assert.ThrowsExactly<ArgumentException>(() => ProgramEditPlanner.Plan(block, sameWeekTwice, Monday(1)));

        var unknownSession = weeks.ToArray();
        unknownSession[0] = unknownSession[0] with
        {
            Sessions = [new ProgramEditSessionRequest(Guid.NewGuid(), NewSession("Ghost", 0))],
        };
        Assert.ThrowsExactly<ArgumentException>(() => ProgramEditPlanner.Plan(block, unknownSession, Monday(1)));

        var sameSessionTwice = weeks.ToArray();
        sameSessionTwice[0] = sameSessionTwice[0] with { Sessions = [weeks[0].Sessions[0], weeks[0].Sessions[0]] };
        Assert.ThrowsExactly<ArgumentException>(() => ProgramEditPlanner.Plan(block, sameSessionTwice, Monday(1)));
    }

    [TestMethod]
    public void ANameOrSharingChangeIsAWeekEditAndALongNameIsRefused()
    {
        var block = Block(2);
        var weeks = Current(block, Monday(1)).ToArray();
        weeks[1] = weeks[1] with { Label = "  Deload  ", IsPublished = false };

        var plan = ProgramEditPlanner.Plan(block, weeks, Monday(1));

        var change = plan.WeekChanges.Single();
        Assert.AreEqual((ProgramEditChangeKind.Edited, 2, "Deload", false), (change.Kind, change.WeekNumber, change.Label, change.IsShared));
        Assert.IsEmpty(plan.SessionChanges);

        weeks[1] = weeks[1] with { Label = new string('x', 121) };
        Assert.ThrowsExactly<ArgumentException>(() => ProgramEditPlanner.Plan(block, weeks, Monday(1)));
    }

    [TestMethod]
    public void OnlyTheCoachsInputsDecideWhetherASessionChanged()
    {
        var block = Block(1);
        var session = Session(block, 1, 0);
        var request = Request(session);

        // The whole week is sent, with the first session as the coach left it.
        ProgramEditPlan PlanFor(TrainingSessionRequest sent)
        {
            var weeks = Current(block, Monday(1));
            weeks[0] = weeks[0] with { Sessions = [new ProgramEditSessionRequest(session.Id, sent), .. weeks[0].Sessions.Skip(1)] };
            return ProgramEditPlanner.Plan(block, weeks, Monday(1));
        }

        // Numbering from 0 or 1, a target given as reserve, a blank tempo and spaces are not changes.
        var asSent = request with
        {
            Name = "  " + request.Name + " ",
            Exercises = [.. request.Exercises.Select(exercise => exercise with
            {
                Position = exercise.Position + 5,
                Sets = [.. exercise.Sets.Select(set => set with
                {
                    Position = set.Position + 7,
                    TargetRpe = null,
                    TargetRir = 10m - set.TargetRpe!.Value,
                    Tempo = "   ",
                })],
            })],
        };
        Assert.IsFalse(PlanFor(asSent).HasChanges);

        // Another lift, a set more, another weight, another effort or a note is.
        var squat = request.Exercises[0];
        TrainingSessionRequest[] edits =
        [
            request with { Exercises = [squat with { ExerciseId = BenchId }] },
            request with { Exercises = [squat with { Sets = [.. squat.Sets, squat.Sets[0]] }] },
            request with { Exercises = [squat with { Sets = [squat.Sets[0] with { DirectLoad = 102.5m }] }] },
            request with { Exercises = [squat with { Sets = [squat.Sets[0] with { TargetRpe = 8m }] }] },
            request with { CoachNotes = "Slow eccentric" },
        ];
        foreach (var edited in edits)
        {
            Assert.AreEqual(1, PlanFor(edited).SessionsEdited);
        }
    }

    [TestMethod]
    public void AFinishedOrCancelledProgramCannotBePlannedAgainst()
    {
        var block = Block(1);
        block.Cancel(new DateTimeOffset(2026, 10, 10, 0, 0, 0, TimeSpan.Zero));

        Assert.ThrowsExactly<InvalidOperationException>(
            () => ProgramEditPlanner.Plan(block, Current(block, Monday(1)), Monday(1)));
    }

    // ----- applying -----

    [TestMethod]
    public void ApplyingAPlanTouchesOnlyWhatItNamesAndNeverWhatHasStarted()
    {
        var block = Block(4);
        var today = Monday(2).AddDays(1);
        var started = Session(block, 2, 2);
        block.MarkSessionStarted(started.Id);
        var oldMondayOfWeekFour = Session(block, 4, 0).Id;
        var weeks = Current(block, today).ToArray();
        var sequence = block.MutationSequence;

        // Edit week 2's Friday, drop week 3, add a session to the old week 4, and add a week at the end.
        var friday = weeks[1].Sessions[0];
        weeks[1] = weeks[1] with { Sessions = [friday with { Session = WithReps(friday.Session, 12) }] };
        weeks[3] = weeks[3] with { Sessions = [.. weeks[3].Sessions, new ProgramEditSessionRequest(null, NewSession("Core", 5))] };
        var added = new ProgramEditWeekRequest(null, "Test week", true, [new ProgramEditSessionRequest(null, NewSession("Max day", 0))]);
        var plan = ProgramEditPlanner.Plan(block, [weeks[0], weeks[1], weeks[3], added], today);

        var applied = block.ApplyProgramEdit(plan, Blueprints(plan));

        Assert.AreEqual(sequence + 1, block.MutationSequence);
        Assert.AreEqual(Start.AddDays(28), block.EndDateExclusive);
        CollectionAssert.AreEqual(FourPlaces.Select(number => number + 1).ToArray(), Ordered(block).Select(week => week.WeekNumber).ToArray());

        // The started session is as it was, and the edited Friday has its new reps.
        var week2 = Ordered(block)[1];
        var kept = week2.Sessions.Single(session => session.Id == started.Id);
        Assert.IsTrue(kept.HasStarted);
        Assert.AreEqual(8, kept.Exercises.Single().Sets.Single().RepetitionsMaximum);
        Assert.HasCount(1, applied.ReplacedSessions);
        Assert.AreEqual(12, applied.ReplacedSessions.Single().Exercises.Single().Sets.Single().RepetitionsMaximum);

        // The old weeks 3 and 4 went; old week 4 was built again as week 3 with its new session; the new week is last.
        Assert.HasCount(2, applied.RemovedWeeks);
        Assert.HasCount(2, applied.AddedWeeks);
        var week3 = Ordered(block)[2];
        Assert.AreEqual(Monday(3), week3.StartsOn);
        Assert.HasCount(4, week3.Sessions);
        Assert.AreEqual(Monday(3).AddDays(5), week3.Sessions.Single(session => session.Name == "Core").ScheduledDate);
        Assert.AreNotEqual(oldMondayOfWeekFour, week3.Sessions.Single(session => session.DayOffset == 0).Id);
        var last = Ordered(block)[3];
        Assert.AreEqual(("Test week", Monday(4)), (last.Label, last.StartsOn));
        Assert.AreEqual(Monday(4), last.Sessions.Single().ScheduledDate);
    }

    [TestMethod]
    public void ApplyingRefusesWhateverThePlanSaysAboutAStartedSession()
    {
        var block = Block(2);
        var started = Session(block, 1, 0);
        block.MarkSessionStarted(started.Id);
        var plan = new ProgramEditPlan(
            Monday(1),
            0,
            [new PlannedWeek(1, Monday(1), Ordered(block)[0], null, true, [])],
            [],
            [started],
            [],
            []);

        Assert.ThrowsExactly<InvalidOperationException>(
            () => block.ApplyProgramEdit(plan, new Dictionary<int, TrainingSessionBlueprint>()));
        Assert.HasCount(3, Ordered(block)[0].Sessions);
    }

    [TestMethod]
    public void ApplyingKeepsEverySessionOfAWeekThatTheCoachOnlyRenamed()
    {
        var block = Block(2);
        var weeks = Current(block, Monday(1)).ToArray();
        weeks[0] = weeks[0] with { Label = "Heavy", IsPublished = false };
        var before = Ordered(block)[0].Sessions.Select(session => session.Id).ToArray();

        var plan = ProgramEditPlanner.Plan(block, weeks, Monday(1));
        var applied = block.ApplyProgramEdit(plan, Blueprints(plan));

        Assert.AreEqual(("Heavy", false), (Ordered(block)[0].Label, Ordered(block)[0].IsPublished));
        CollectionAssert.AreEqual(before, Ordered(block)[0].Sessions.Select(session => session.Id).ToArray());
        Assert.IsEmpty(applied.AddedSessions);
        Assert.IsEmpty(applied.RemovedSessions);
        Assert.IsEmpty(applied.ReplacedSessions);
    }

    [TestMethod]
    public void ARecordedEditKeepsTheCountsAndRefusesABadHash()
    {
        var block = Block(2);
        var weeks = Current(block, Monday(1)).ToArray();
        weeks[1] = weeks[1] with { Sessions = [.. weeks[1].Sessions.Take(1)] };
        var plan = ProgramEditPlanner.Plan(block, weeks, Monday(1));
        var hash = new string('a', 64);

        var edit = ProgramEdit.Record(TenantId, block.Id, hash, plan, Monday(1).AddDays(14), "{}");

        Assert.AreEqual((ProgramEditRules.Key, "1.0", 2, 2), (edit.RuleKey, edit.RuleVersion, edit.SessionsRemoved, edit.ResultingWeekCount));
        Assert.AreEqual((0, 0, 0, 0, 0), (edit.WeeksAdded, edit.WeeksMoved, edit.WeeksRemoved, edit.SessionsAdded, edit.SessionsEdited));
        Assert.ThrowsExactly<ArgumentException>(() => ProgramEdit.Record(TenantId, block.Id, "XYZ", plan, Monday(1), "{}"));
        Assert.ThrowsExactly<ArgumentException>(() => ProgramEdit.Record(TenantId, Guid.Empty, hash, plan, Monday(1), "{}"));
        Assert.ThrowsExactly<ArgumentException>(() => ProgramEdit.Record(TenantId, block.Id, hash, plan, Monday(1), " "));
    }

    [TestMethod]
    public void ABuiltPrescriptionThatBreaksALimitIsRefusedBeforeAnythingIsStored()
    {
        var good = Blueprint("Lower", 0, 5);
        ProgramEditRules.EnsureValid(good);

        Assert.ThrowsExactly<ArgumentException>(() => ProgramEditRules.EnsureValid(good with { Name = " " }));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => ProgramEditRules.EnsureValid(good with { DayOffset = 7 }));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => ProgramEditRules.EnsureValid(Blueprint("Lower", 0, 101)));
        Assert.ThrowsExactly<ArgumentException>(() => ProgramEditRules.EnsureValid(
            good with { Exercises = [good.Exercises[0] with { Sets = [] }] }));
    }

    // ----- builders -----

    private static TrainingMesocycle Block(int weeks) =>
        TrainingMesocycle.CreateSnapshot(
            TenantId,
            ClientId,
            Guid.NewGuid(),
            Guid.NewGuid(),
            Guid.NewGuid(),
            "Powerlifting block",
            Start,
            "Asia/Beirut",
            MesocycleKind.Primary,
            TrainingLoadUnit.Kilogram,
            2.5m,
            TrainingLoadRoundingMode.Nearest,
            Guid.NewGuid(),
            new ProgramBlueprint(
                "Powerlifting block",
                null,
                [.. Enumerable.Range(1, weeks).Select(week => new TrainingWeekBlueprint(
                    $"Week {week}",
                    true,
                    [Blueprint("Lower A", 0, 5), Blueprint("Upper", 2, 8), Blueprint("Lower B", 4, 5)]))]));

    private static IReadOnlyList<MesocycleWeek> Ordered(TrainingMesocycle block) =>
        [.. block.Weeks.OrderBy(week => week.WeekNumber)];

    private static TrainingSession Session(TrainingMesocycle block, int week, int dayOffset) =>
        Ordered(block)[week - 1].Sessions.Single(session => session.DayOffset == dayOffset);

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
                            set.TargetRpe,
                            null,
                            set.ExertionDisplayPreference,
                            set.RestSeconds,
                            set.Tempo,
                            set.CoachNotes,
                            set.IsManualLoadOverride ? set.PrescribedLoad : null))]))]);

    private static TrainingSessionRequest WithReps(TrainingSessionRequest session, int reps) =>
        session with
        {
            Exercises = [.. session.Exercises.Select(exercise => exercise with
            {
                Sets = [.. exercise.Sets.Select(set => set with { RepetitionsMinimum = reps, RepetitionsMaximum = reps })],
            })],
        };

    private static TrainingSessionRequest NewSession(string name, int dayOffset) =>
        new(
            name,
            dayOffset,
            null,
            [new ExercisePrescriptionRequest(
                BenchId,
                1,
                false,
                PrescriptionModificationPolicy.CoachApprovedSwap,
                null,
                [],
                [new SetPrescriptionRequest(
                    1,
                    TrainingSetType.Normal,
                    5,
                    5,
                    TrainingLoadStrategy.Direct,
                    80m,
                    TrainingLoadUnit.Kilogram,
                    null,
                    7m,
                    null,
                    ExertionDisplayPreference.Rpe,
                    120,
                    null,
                    null)])]);

    /// <summary>What the service would build for every session the plan does not keep: the request, as it stands.</summary>
    private static Dictionary<int, TrainingSessionBlueprint> Blueprints(ProgramEditPlan plan) =>
        plan.Weeks
            .SelectMany(week => week.Sessions)
            .Where(session => session.NeedsBlueprint)
            .ToDictionary(
                session => session.Key,
                session => Blueprint(
                    session.Request.Name,
                    session.Request.DayOffset,
                    session.Request.Exercises[0].Sets[0].RepetitionsMaximum ?? 5));

    private static TrainingSessionBlueprint Blueprint(string name, int dayOffset, int reps) =>
        new(
            name,
            dayOffset,
            null,
            [new ExercisePrescriptionBlueprint(
                SquatId,
                "Back squat",
                1,
                false,
                PrescriptionModificationPolicy.CoachApprovedSwap,
                null,
                [],
                [],
                [new SetPrescriptionBlueprint(
                    1,
                    TrainingSetType.Normal,
                    reps,
                    reps,
                    TrainingLoadStrategy.Direct,
                    100m,
                    TrainingLoadUnit.Kilogram,
                    null,
                    7m,
                    ExertionDisplayPreference.Rpe,
                    120,
                    null,
                    null)])]);
}
