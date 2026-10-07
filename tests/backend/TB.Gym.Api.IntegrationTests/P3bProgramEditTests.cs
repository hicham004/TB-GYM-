using System.Net;
using System.Net.Http.Json;
using Npgsql;
using TB.Gym.Modules.Training;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// P3b: a client's weeks edited in the builder's grid (TRN-028, ADR 0036). The coach sends the open sessions of
/// every week; preview works out what changes, with every weight, and saves nothing; apply rechecks the hash, the
/// program's version, the training coverage and overlap, writes in one save and leaves an append-only record.
/// Started, finished and past sessions are never touched, whatever is sent.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private static readonly string[] P3bClosedGapLabels = ["Alpha", "Gamma", "Delta", "Test week"];
    private static readonly string[] P3bSlottedNames = ["Lower A", "Core", "Upper", "Lower B"];
    private static readonly bool[] P3bSharedThenNot = [true, false];

    private static string P3bUrl(Guid mesocycleId, string action) =>
        $"/api/training/mesocycles/{mesocycleId}/edit/{action}";

    private static object P3bSession(string name, int dayOffset, Guid exerciseId, params object[] sets) => new
    {
        name,
        dayOffset,
        coachNotes = (string?)null,
        exercises = new[]
        {
            new
            {
                exerciseId,
                position = 1,
                isMainLift = false,
                modificationPolicy = "CoachApprovedSwap",
                coachNotes = (string?)null,
                approvedAlternativeExerciseIds = Array.Empty<Guid>(),
                sets,
            },
        },
    };

    private static object P3bWeek(string label, params object[] sessions) => new
    {
        label,
        isPublished = true,
        sessions,
    };

    /// <summary>A session as the grid sends it back: what the server stored, in the coach's own terms.</summary>
    private static TrainingSessionRequest P3bRequest(TrainingSessionView session) =>
        new(
            session.Name,
            session.DayOffset,
            session.CoachNotes,
            [.. session.Exercises.OrderBy(exercise => exercise.Position).Select((exercise, exerciseIndex) =>
                new ExercisePrescriptionRequest(
                    exercise.ExerciseId,
                    exerciseIndex + 1,
                    exercise.IsMainLift,
                    exercise.ModificationPolicy,
                    exercise.CoachNotes,
                    exercise.ApprovedAlternativeExerciseIds,
                    [.. exercise.Sets.OrderBy(set => set.Position).Select((set, setIndex) =>
                        new SetPrescriptionRequest(
                            setIndex + 1,
                            set.SetType,
                            set.RepetitionsMinimum,
                            set.RepetitionsMaximum,
                            set.LoadStrategy,
                            set.LoadStrategy == TrainingLoadStrategy.Direct ? set.DirectLoad : null,
                            set.LoadStrategy == TrainingLoadStrategy.None ? null : set.LoadUnit,
                            set.LoadStrategy == TrainingLoadStrategy.PercentageWorkingMax ? set.PercentageWorkingMax : null,
                            set.ExertionDisplayPreference == ExertionDisplayPreference.Rpe ? set.TargetRpe : null,
                            set.ExertionDisplayPreference == ExertionDisplayPreference.Rir ? set.TargetRir : null,
                            set.ExertionDisplayPreference,
                            set.RestSeconds,
                            set.Tempo,
                            set.CoachNotes,
                            set.IsManualLoadOverride ? set.PrescribedLoad : null))]))]);

    /// <summary>The grid as the page holds it: every session that is still open, in day order, as stored.</summary>
    private static ProgramEditWeekRequest[] P3bGrid(TrainingMesocycleView block, DateOnly today) =>
    [
        .. block.Weeks.OrderBy(week => week.WeekNumber).Select(week => new ProgramEditWeekRequest(
            week.Id,
            week.Label,
            week.IsPublished,
            [.. week.Sessions
                .Where(session => !session.HasStarted && session.ScheduledDate >= today)
                .OrderBy(session => session.DayOffset)
                .ThenBy(session => session.Position)
                .Select(session => new ProgramEditSessionRequest(session.Id, P3bRequest(session)))])),
    ];

    private static ProgramEditWeekRequest P3bEditFirstSet(
        ProgramEditWeekRequest week,
        Func<SetPrescriptionRequest, SetPrescriptionRequest> edit)
    {
        var first = week.Sessions[0];
        var exercise = first.Session.Exercises[0];
        SetPrescriptionRequest[] sets = [edit(exercise.Sets[0]), .. exercise.Sets.Skip(1)];
        return week with
        {
            Sessions =
            [
                first with { Session = first.Session with { Exercises = [exercise with { Sets = sets }, .. first.Session.Exercises.Skip(1)] } },
                .. week.Sessions.Skip(1),
            ],
        };
    }

    private static SetPrescriptionRequest P3bSetOf(ProgramEditWeekRequest week, int session = 0) =>
        week.Sessions[session].Session.Exercises[0].Sets[0];

    private static ProgramEditSessionRequest P3bNewSession(string name, int dayOffset, Guid exerciseId, decimal load = 100m) =>
        new(
            null,
            new TrainingSessionRequest(
                name,
                dayOffset,
                null,
                [new ExercisePrescriptionRequest(
                    exerciseId,
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
                        load,
                        TrainingLoadUnit.Kilogram,
                        null,
                        7m,
                        null,
                        ExertionDisplayPreference.Rpe,
                        null,
                        null,
                        null)])]));

    private static async Task<HttpResponseMessage> P3bPreviewAsync(
        HttpClient coach,
        Guid mesocycleId,
        uint version,
        IReadOnlyList<ProgramEditWeekRequest> weeks)
    {
        await RefreshCsrfAsync(coach);
        return await coach.PostAsJsonAsync(
            P3bUrl(mesocycleId, "preview"),
            new PreviewProgramEditRequest(version, weeks),
            SliceReadJson);
    }

    private static async Task<ProgramEditPreviewView> P3bPreviewOkAsync(
        HttpClient coach,
        TrainingMesocycleView block,
        IReadOnlyList<ProgramEditWeekRequest> weeks)
    {
        var response = await P3bPreviewAsync(coach, block.Id, block.Version, weeks);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<ProgramEditPreviewView>(response);
    }

    private static async Task<HttpResponseMessage> P3bApplyAsync(
        HttpClient coach,
        Guid mesocycleId,
        uint version,
        IReadOnlyList<ProgramEditWeekRequest> weeks,
        string previewHash)
    {
        await RefreshCsrfAsync(coach);
        return await coach.PostAsJsonAsync(
            P3bUrl(mesocycleId, "apply"),
            new ApplyProgramEditRequest(version, weeks, previewHash),
            SliceReadJson);
    }

    private static async Task<TrainingMesocycleView> P3bApplyOkAsync(
        HttpClient coach,
        TrainingMesocycleView block,
        IReadOnlyList<ProgramEditWeekRequest> weeks,
        string previewHash)
    {
        var response = await P3bApplyAsync(coach, block.Id, block.Version, weeks, previewHash);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<TrainingMesocycleView>(response);
    }

    private async Task<long> P3bEditCountAsync(Guid mesocycleId) =>
        await P2CountAsync("""SELECT count(*) FROM training."ProgramEdits" WHERE "MesocycleId" = @id""", mesocycleId);

    private async Task<long> P3bSessionRowsAsync(Guid mesocycleId) =>
        await P2CountAsync(
            """
            SELECT count(*) FROM training."Sessions" AS s
            JOIN training."MesocycleWeeks" AS w ON w."Id" = s."MesocycleWeekId"
            WHERE w."MesocycleId" = @id
            """,
            mesocycleId);

    private static TrainingSessionView P3bOnlySession(TrainingWeekView week) => week.Sessions.Single();

    [TestMethod]
    public async Task P3bAnEditShowsEveryNewWeightFirstSavesNothingAndThenKeepsTheRowsItEdited()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "p3b-edit", exerciseId =>
        [
            P2Week("Week 1", exerciseId, P1Set(1, "RpeChart", rpe: 7m, reps: 5)),
            P2Week("Week 2", exerciseId, P1Set(1, "RpeChart", rpe: 7m, reps: 5)),
        ]);
        var block = await P2AssignAsync(coach, scenario, [P2SavedMax(scenario)]);
        var today = TenantToday();
        var grid = P3bGrid(block, today);
        Assert.AreEqual(77.5m, P3bOnlySession(block.Weeks[1]).Exercises[0].Sets[0].PrescribedLoad);

        // Week 2's set goes from 5 reps at RPE 7 to 3 reps at RPE 8: 86.3% of 100 kg on the chart.
        grid[1] = P3bEditFirstSet(grid[1], set => set with { RepetitionsMinimum = 3, RepetitionsMaximum = 3, TargetRpe = 8m });
        var preview = await P3bPreviewOkAsync(coach, block, grid);

        Assert.AreEqual((ProgramEditRules.Key, ProgramEditRules.CurrentVersion, today, 0), (preview.RuleKey, preview.RuleVersion, preview.Today, preview.FrozenWeekCount));
        Assert.AreEqual((2, true), (preview.ResultingWeekCount, preview.IsInsideTrainingCoverage));
        Assert.IsEmpty(preview.Problems);
        Assert.AreEqual((0, 1, 0, 0), (preview.SessionsAdded, preview.SessionsEdited, preview.SessionsMoved, preview.SessionsRemoved));
        var change = preview.SessionChanges.Single();
        Assert.AreEqual((ProgramEditChangeKind.Edited, 2, today.AddDays(7), true), (change.Kind, change.WeekNumber, change.Date, change.WeekIsShared));
        Assert.AreEqual(P3bOnlySession(block.Weeks[1]).Id, change.SessionId);
        var weight = change.After!.Exercises[0].Sets[0];
        Assert.AreEqual((3, 8m, 87.5m, "RpeChart"), (weight.RepetitionsMaximum, weight.TargetRpe, weight.PrescribedLoad, weight.CalculationStrategyKey));
        StringAssert.Contains(weight.CalculationExplanation, "3 reps at RPE 8 is 86.3% of 100 kg");
        StringAssert.Contains(weight.CalculationExplanation, "87.5 kg");

        // The preview saved nothing.
        var untouched = await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id));
        Assert.AreEqual(block.Version, untouched.Version);
        Assert.AreEqual(77.5m, P3bOnlySession(untouched.Weeks[1]).Exercises[0].Sets[0].PrescribedLoad);
        Assert.AreEqual(0L, await P3bEditCountAsync(block.Id));

        var applied = await P3bApplyOkAsync(coach, block, grid, preview.PreviewHash);

        // The edited session keeps its row and the other week is as it was.
        Assert.AreNotEqual(block.Version, applied.Version);
        CollectionAssert.AreEqual(
            block.Weeks.Select(week => week.Id).ToArray(),
            applied.Weeks.OrderBy(week => week.WeekNumber).Select(week => week.Id).ToArray());
        var edited = P3bOnlySession(applied.Weeks[1]);
        Assert.AreEqual(P3bOnlySession(block.Weeks[1]).Id, edited.Id);
        Assert.AreEqual((3, 8m, 87.5m), (edited.Exercises[0].Sets[0].RepetitionsMaximum, edited.Exercises[0].Sets[0].TargetRpe, edited.Exercises[0].Sets[0].PrescribedLoad));
        Assert.AreEqual(77.5m, P3bOnlySession(applied.Weeks[0]).Exercises[0].Sets[0].PrescribedLoad);
        Assert.AreEqual(P3bOnlySession(block.Weeks[0]).Id, P3bOnlySession(applied.Weeks[0]).Id);

        // One record of the edit, with the session as it was.
        Assert.AreEqual(1L, await P3bEditCountAsync(block.Id));
        Assert.AreEqual(
            1L,
            await P2CountAsync(
                """
                SELECT count(*) FROM training."ProgramEdits"
                WHERE "MesocycleId" = @id AND "RuleKey" = 'GridEdit' AND "SessionsEdited" = 1 AND "SessionsAdded" = 0
                  AND "SessionsRemoved" = 0 AND "ResultingWeekCount" = 2 AND "PreviewHash" = '{HASH}'
                  AND "ChangesJson"::text LIKE '%"repetitionsMaximum": 5%'
                """.Replace("{HASH}", preview.PreviewHash, StringComparison.Ordinal),
                block.Id));
    }

    [TestMethod]
    public async Task P3bWhatHasStartedOrPassedStaysLockedWhileWeeksAfterItCanChange()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "p3b-lock", exerciseId =>
        [
            P2Week("Week 1", exerciseId, P1Set(1, "RpeChart", rpe: 7m, reps: 5)),
            P2Week("Week 2", exerciseId, P1Set(1, "RpeChart", rpe: 7m, reps: 5)),
            P2Week("Week 3", exerciseId, P1Set(1, "RpeChart", rpe: 7m, reps: 5)),
        ]);
        var block = await P2AssignAsync(coach, scenario, [P2SavedMax(scenario)]);

        // The client starts week 1's workout; the day of week 2's goes by without one.
        var started = block.Weeks[0].Sessions.Single();
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(await client.PostAsync($"/api/training/me/sessions/{started.Id}/start", null), HttpStatusCode.OK);
        RequiredTestClock.Advance(TimeSpan.FromDays(8));
        var today = TenantToday().AddDays(8);
        var current = await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id));
        var grid = P3bGrid(current, today);

        // Only week 3 is open, and weeks 1 and 2 are not in the grid.
        Assert.AreEqual((0, 0, 1), (grid[0].Sessions.Count, grid[1].Sessions.Count, grid[2].Sessions.Count));
        grid[2] = P3bEditFirstSet(grid[2], set => set with { RepetitionsMinimum = 3, RepetitionsMaximum = 3, TargetRpe = 8m });
        var preview = await P3bPreviewOkAsync(coach, current, grid);
        Assert.AreEqual((2, 1), (preview.FrozenWeekCount, preview.SessionsEdited));

        // What the coach asks for that the rule forbids is refused, naming the reason.
        var locked = grid.ToArray();
        locked[0] = locked[0] with { Sessions = [new ProgramEditSessionRequest(started.Id, P3bRequest(started))] };
        await P3RefusedAsync(
            await P3bPreviewAsync(coach, current.Id, current.Version, locked),
            HttpStatusCode.BadRequest,
            "has started or passed");
        await P3RefusedAsync(
            await P3bPreviewAsync(coach, current.Id, current.Version, [grid[0], grid[2]]),
            HttpStatusCode.BadRequest,
            "stays where it is");
        var late = grid.ToArray();
        late[1] = late[1] with { Sessions = [P3bNewSession("Late", 0, scenario.Exercise.Id)] };
        await P3RefusedAsync(
            await P3bPreviewAsync(coach, current.Id, current.Version, late),
            HttpStatusCode.BadRequest,
            "Week 2, Late");
        await P3RefusedAsync(
            await P3bApplyAsync(coach, current.Id, current.Version, late, preview.PreviewHash),
            HttpStatusCode.BadRequest,
            "has already passed");

        // The edit that is allowed goes through, and a week joins at the end.
        grid = [.. grid, new ProgramEditWeekRequest(null, "Week 4", true, [P3bNewSession("Week 4 squat", 0, scenario.Exercise.Id)])];
        var longer = await P3bPreviewOkAsync(coach, current, grid);
        Assert.AreEqual((1, 1, 4), (longer.WeeksAdded, longer.SessionsEdited, longer.ResultingWeekCount));
        var applied = await P3bApplyOkAsync(coach, current, grid, longer.PreviewHash);

        Assert.HasCount(4, applied.Weeks);
        var weeks = applied.Weeks.OrderBy(week => week.WeekNumber).ToArray();
        Assert.AreEqual(current.StartDate.AddDays(28), applied.EndDateExclusive);
        Assert.AreEqual(87.5m, P3bOnlySession(weeks[2]).Exercises[0].Sets[0].PrescribedLoad);
        Assert.AreEqual(current.StartDate.AddDays(21), P3bOnlySession(weeks[3]).ScheduledDate);

        // The started session and the missed one are the rows they were.
        var week1 = P3bOnlySession(weeks[0]);
        Assert.AreEqual((started.Id, true), (week1.Id, week1.HasStarted));
        Assert.AreEqual(P3bOnlySession(current.Weeks[1]).Id, P3bOnlySession(weeks[1]).Id);
        Assert.AreEqual(1L, await P2CountAsync("""SELECT count(*) FROM training."WorkoutExecutions" WHERE "MesocycleId" = @id""", block.Id));
        Assert.AreEqual(1L, await P3bEditCountAsync(block.Id));
    }

    [TestMethod]
    public async Task P3bWeeksAfterTheLastStartedOneAreAddedMovedAndRemovedWithTheirRowsTakenOverCleanly()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "p3b-weeks", exerciseId =>
        [
            P2Week("Alpha", exerciseId, P1Set(1, "Direct", rpe: 7m, direct: 100m)),
            P2Week("Beta", exerciseId, P1Set(1, "Direct", rpe: 7m, direct: 100m)),
            P2Week("Gamma", exerciseId, P1Set(1, "Direct", rpe: 7m, direct: 100m)),
            P2Week("Delta", exerciseId, P1Set(1, "Direct", rpe: 7m, direct: 100m)),
        ]);
        var block = await P2AssignAsync(coach, scenario, []);
        var today = TenantToday();
        var grid = P3bGrid(block, today);

        // Beta goes, Gamma and Delta close the gap, and a new week closes the program.
        var added = new ProgramEditWeekRequest(null, "Test week", true, [P3bNewSession("Max day", 0, scenario.Exercise.Id, 150m)]);
        ProgramEditWeekRequest[] edited = [grid[0], grid[2], grid[3], added];
        var preview = await P3bPreviewOkAsync(coach, block, edited);

        Assert.AreEqual((1, 2, 1), (preview.WeeksAdded, preview.WeeksMoved, preview.WeeksRemoved));
        Assert.AreEqual((1, 0, 2, 1), (preview.SessionsAdded, preview.SessionsEdited, preview.SessionsMoved, preview.SessionsRemoved));
        Assert.AreEqual(block.EndDateExclusive, preview.ResultingEndDateExclusive);
        var gamma = preview.SessionChanges.Single(change => change.Name == "Gamma squat");
        Assert.AreEqual((ProgramEditChangeKind.Moved, 2, (int?)3, today.AddDays(7)), (gamma.Kind, gamma.WeekNumber, gamma.PreviousWeekNumber, gamma.Date));
        Assert.AreEqual(today.AddDays(14), gamma.PreviousDate);
        Assert.IsNull(gamma.After);
        var removed = preview.SessionChanges.Single(change => change.Kind == ProgramEditChangeKind.Removed);
        Assert.AreEqual(("Beta squat", 2), (removed.Name, removed.WeekNumber));
        Assert.AreEqual(4L, await P3bSessionRowsAsync(block.Id));

        var applied = await P3bApplyOkAsync(coach, block, edited, preview.PreviewHash);

        var weeks = applied.Weeks.OrderBy(week => week.WeekNumber).ToArray();
        CollectionAssert.AreEqual(P3bClosedGapLabels, weeks.Select(week => week.Label).ToArray());
        for (var index = 0; index < weeks.Length; index++)
        {
            Assert.AreEqual(today.AddDays(7 * index), weeks[index].StartsOn);
            Assert.AreEqual(today.AddDays(7 * index), P3bOnlySession(weeks[index]).ScheduledDate);
        }

        // Alpha kept its row; the others are rows built where they landed, and Beta's sessions went with it.
        Assert.AreEqual(block.Weeks[0].Id, weeks[0].Id);
        Assert.AreEqual(block.Weeks[0].Sessions[0].Id, weeks[0].Sessions[0].Id);
        Assert.IsFalse(block.Weeks.Skip(1).Select(week => week.Id).Intersect(weeks.Skip(1).Select(week => week.Id)).Any());
        Assert.AreEqual(150m, P3bOnlySession(weeks[3]).Exercises[0].Sets[0].PrescribedLoad);
        Assert.AreEqual(4L, await P3bSessionRowsAsync(block.Id));
        Assert.AreEqual(
            1L,
            await P2CountAsync(
                """
                SELECT count(*) FROM training."ProgramEdits"
                WHERE "MesocycleId" = @id AND "WeeksAdded" = 1 AND "WeeksMoved" = 2 AND "WeeksRemoved" = 1
                  AND "SessionsAdded" = 1 AND "SessionsMoved" = 2 AND "SessionsRemoved" = 1
                  AND "ResultingEndDateExclusive" = @end
                """.Replace("@end", $"DATE '{applied.EndDateExclusive:yyyy-MM-dd}'", StringComparison.Ordinal),
                block.Id));
    }

    [TestMethod]
    public async Task P3bASessionSlottedBetweenTwoOthersTakesItsPlaceAndTheLaterOnesFollowInTheirRows()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "p3b-slot", exerciseId =>
        [
            P3bWeek(
                "Week 1",
                P3bSession("Lower A", 0, exerciseId, P1Set(1, "Direct", rpe: 7m, direct: 100m)),
                P3bSession("Upper", 2, exerciseId, P1Set(1, "Direct", rpe: 7m, direct: 90m)),
                P3bSession("Lower B", 4, exerciseId, P1Set(1, "Direct", rpe: 7m, direct: 110m))),
        ]);
        var block = await P2AssignAsync(coach, scenario, []);
        var today = TenantToday();
        var before = block.Weeks.Single().Sessions.OrderBy(session => session.Position).ToArray();
        var grid = P3bGrid(block, today);

        // A new session between Lower A and Upper, and Lower B moved to the day after it.
        var lowerB = grid[0].Sessions[2] with { Session = grid[0].Sessions[2].Session with { DayOffset = 3 } };
        grid[0] = grid[0] with
        {
            Sessions = [grid[0].Sessions[0], P3bNewSession("Core", 1, scenario.Exercise.Id, 40m), grid[0].Sessions[1], lowerB],
        };
        var preview = await P3bPreviewOkAsync(coach, block, grid);

        // Core is new and Lower B changed day; Upper only moves along, and is not called a change.
        Assert.AreEqual((1, 1, 0, 0), (preview.SessionsAdded, preview.SessionsEdited, preview.SessionsMoved, preview.SessionsRemoved));
        var applied = await P3bApplyOkAsync(coach, block, grid, preview.PreviewHash);

        var sessions = applied.Weeks.Single().Sessions.OrderBy(session => session.Position).ToArray();
        CollectionAssert.AreEqual(P3bSlottedNames, sessions.Select(session => session.Name).ToArray());
        CollectionAssert.AreEqual(
            new[] { today, today.AddDays(1), today.AddDays(2), today.AddDays(3) },
            sessions.Select(session => session.ScheduledDate!.Value).ToArray());
        CollectionAssert.AreEqual(
            new decimal?[] { 100m, 40m, 90m, 110m },
            sessions.Select(session => session.Exercises[0].Sets[0].PrescribedLoad).ToArray());
        Assert.AreEqual(before[0].Id, sessions[0].Id, "Lower A was not touched.");
        Assert.AreEqual(4L, await P3bSessionRowsAsync(block.Id));
    }

    [TestMethod]
    public async Task P3bGrowingTheProgramPastThePlanIsRefusedWithTheDatesAndSavesNothing()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "p3b-cover", exerciseId =>
            [.. Enumerable.Range(1, 8).Select(week => P2Week($"Week {week}", exerciseId, P1Set(1, "Direct", rpe: 7m, direct: 100m)))]);
        var block = await P2AssignAsync(coach, scenario, []);
        var grid = P3bGrid(block, TenantToday());

        // Nine weeks do not fit a plan of eight.
        var nine = new ProgramEditWeekRequest(null, "Week 9", true, [P3bNewSession("Week 9 squat", 0, scenario.Exercise.Id)]);
        var preview = await P3bPreviewOkAsync(coach, block, [.. grid, nine]);
        Assert.AreEqual((9, false), (preview.ResultingWeekCount, preview.IsInsideTrainingCoverage));
        var problem = preview.Problems.Single();
        StringAssert.Contains(problem, "the plan it belongs to ends");
        StringAssert.Contains(problem, "Remove a week, or renew the plan first.");
        await P3RefusedAsync(
            await P3bApplyAsync(coach, block.Id, block.Version, [.. grid, nine], preview.PreviewHash),
            HttpStatusCode.BadRequest,
            "renew the plan first");
        var after = await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id));
        Assert.AreEqual((block.Version, 8), (after.Version, after.Weeks.Count));
        Assert.AreEqual(0L, await P3bEditCountAsync(block.Id));

        // The same number of weeks, with one swapped for a new one, does.
        var swapped = await P3bPreviewOkAsync(coach, block, [.. grid.Take(7), nine]);
        Assert.IsEmpty(swapped.Problems);
        Assert.AreEqual((1, 1), (swapped.WeeksAdded, swapped.WeeksRemoved));
    }

    [TestMethod]
    public async Task P3bAnotherProgramOfTheSameClientBlocksGrowingIntoItsDates()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "p3b-overlap", exerciseId =>
        [
            P2Week("Week 1", exerciseId, P1Set(1, "Direct", rpe: 7m, direct: 100m)),
            P2Week("Week 2", exerciseId, P1Set(1, "Direct", rpe: 7m, direct: 100m)),
        ]);
        var first = await P2AssignAsync(coach, scenario, []);

        // A second program of two weeks starts right after the first.
        await RefreshCsrfAsync(coach);
        var secondResponse = await coach.PostAsJsonAsync(
            $"/api/training/clients/{scenario.ClientId}/mesocycles",
            new
            {
                enrollmentId = scenario.Enrollment.Id,
                templateVersionId = scenario.Template.Id,
                startDate = TenantToday().AddDays(14),
                kind = "Primary",
                loadUnit = "Kilogram",
                loadIncrement = 2.5m,
                loadRoundingMode = "Nearest",
                workingMaxes = Array.Empty<object>(),
                idempotencyKey = Guid.NewGuid(),
                name = "Second block",
            });
        await AssertStatusAsync(secondResponse, HttpStatusCode.OK);

        var grid = P3bGrid(first, TenantToday());
        var third = new ProgramEditWeekRequest(null, "Week 3", true, [P3bNewSession("Week 3 squat", 0, scenario.Exercise.Id)]);
        var preview = await P3bPreviewOkAsync(coach, first, [.. grid, third]);

        Assert.IsTrue(preview.IsInsideTrainingCoverage);
        var problem = preview.Problems.Single();
        StringAssert.Contains(problem, "Second block");
        await P3RefusedAsync(
            await P3bApplyAsync(coach, first.Id, first.Version, [.. grid, third], preview.PreviewHash),
            HttpStatusCode.BadRequest,
            "Second block");
        Assert.AreEqual(0L, await P3bEditCountAsync(first.Id));
    }

    [TestMethod]
    public async Task P3bAStaleVersionOrAnotherPreviewIsRefusedAndSavesNothing()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "p3b-stale", exerciseId =>
        [
            P2Week("Week 1", exerciseId, P1Set(1, "Direct", rpe: 7m, direct: 100m)),
            P2Week("Week 2", exerciseId, P1Set(1, "Direct", rpe: 7m, direct: 100m)),
        ]);
        var block = await P2AssignAsync(coach, scenario, []);
        var grid = P3bGrid(block, TenantToday());
        grid[1] = P3bEditFirstSet(grid[1], set => set with { DirectLoad = 105m });
        var preview = await P3bPreviewOkAsync(coach, block, grid);

        // The version the page holds is not the program's.
        await P3RefusedAsync(
            await P3bPreviewAsync(coach, block.Id, block.Version + 1, grid),
            HttpStatusCode.Conflict,
            "program_edit_conflict");

        // The hash proves what was reviewed: other changes, or none, are refused.
        var other = grid.ToArray();
        other[1] = P3bEditFirstSet(other[1], set => set with { DirectLoad = 110m });
        await P3RefusedAsync(
            await P3bApplyAsync(coach, block.Id, block.Version, other, preview.PreviewHash),
            HttpStatusCode.Conflict,
            "program_edit_preview_changed");
        await P3RefusedAsync(
            await P3bApplyAsync(coach, block.Id, block.Version, grid, string.Empty),
            HttpStatusCode.Conflict,
            "program_edit_preview_changed");

        // Nothing changed is not an edit.
        var unchanged = await P3bPreviewOkAsync(coach, block, P3bGrid(block, TenantToday()));
        Assert.AreEqual((0, 0, 0, 0, 0), (unchanged.WeeksAdded + unchanged.WeeksMoved + unchanged.WeeksRemoved, unchanged.SessionsAdded, unchanged.SessionsEdited, unchanged.SessionsMoved, unchanged.SessionsRemoved));
        await P3RefusedAsync(
            await P3bApplyAsync(coach, block.Id, block.Version, P3bGrid(block, TenantToday()), unchanged.PreviewHash),
            HttpStatusCode.BadRequest,
            "nothing to change");

        // The program changes after the preview (week 2 is un-shared), so the preview is out of date.
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PutAsJsonAsync(
                $"/api/training/mesocycles/{block.Id}/weeks/{block.Weeks[1].Id}/publish",
                new { isPublished = false, version = block.Version }),
            HttpStatusCode.OK);
        await P3RefusedAsync(
            await P3bApplyAsync(coach, block.Id, block.Version, grid, preview.PreviewHash),
            HttpStatusCode.Conflict,
            "program_edit_conflict");

        var after = await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id));
        Assert.AreEqual(100m, P3bOnlySession(after.Weeks[1]).Exercises[0].Sets[0].PrescribedLoad);
        Assert.AreEqual(0L, await P3bEditCountAsync(block.Id));
    }

    [TestMethod]
    public async Task P3bTwoApplicationsOfTheSamePreviewMakeTheEditOnce()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "p3b-race", exerciseId =>
        [
            P2Week("Week 1", exerciseId, P1Set(1, "Direct", rpe: 7m, direct: 100m)),
        ]);
        var block = await P2AssignAsync(coach, scenario, []);
        var grid = P3bGrid(block, TenantToday());
        grid[0] = P3bEditFirstSet(grid[0], set => set with { DirectLoad = 105m });
        var preview = await P3bPreviewOkAsync(coach, block, grid);

        // The antiforgery token is refreshed once, outside the race, so each request is the same request.
        await RefreshCsrfAsync(coach);
        var attempts = await Task.WhenAll(
            Enumerable.Range(0, 2).Select(_ => coach.PostAsJsonAsync(
                P3bUrl(block.Id, "apply"),
                new ApplyProgramEditRequest(block.Version, grid, preview.PreviewHash),
                SliceReadJson)));
        CollectionAssert.AreEquivalent(
            new[] { HttpStatusCode.OK, HttpStatusCode.Conflict },
            attempts.Select(response => response.StatusCode).ToArray());

        var after = await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id));
        Assert.AreEqual(105m, P3bOnlySession(after.Weeks[0]).Exercises[0].Sets[0].PrescribedLoad);
        Assert.AreEqual(1L, await P3bEditCountAsync(block.Id));
    }

    [TestMethod]
    public async Task P3bOnlyStaffOfThatWorkspaceWhoCoachTheClientEditTheirWeeks()
    {
        using var owner = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(owner, client, "p3b-auth", exerciseId =>
        [
            P2Week("Week 1", exerciseId, P1Set(1, "Direct", rpe: 7m, direct: 100m)),
        ]);
        var block = await P2AssignAsync(owner, scenario, []);
        var grid = P3bGrid(block, TenantToday());
        var hash = new string('a', 64);

        // Nobody signed out, and nobody without the antiforgery token.
        using var anonymous = CreateClient();
        await RefreshCsrfAsync(anonymous);
        await AssertStatusAsync(await P3bPreviewAsync(anonymous, block.Id, block.Version, grid), HttpStatusCode.Unauthorized);
        await AssertStatusAsync(await P3bApplyAsync(anonymous, block.Id, block.Version, grid, hash), HttpStatusCode.Unauthorized);
        using var noToken = CreateClient();
        await RegisterCoachAsync(noToken, "p3b-auth-token@example.test", "P3b Token", "P3b Token Gym");
        noToken.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
        await AssertStatusAsync(
            await noToken.PostAsJsonAsync(P3bUrl(block.Id, "preview"), new PreviewProgramEditRequest(block.Version, grid), SliceReadJson),
            HttpStatusCode.BadRequest);

        // A coach of another workspace is refused when naming this one, and finds nothing of it in their own.
        using var stranger = CreateClient();
        var strangerWorkspace = await RegisterCoachAsync(stranger, "p3b-auth-stranger@example.test", "P3b Stranger", "P3b Stranger Gym");
        SetTenant(stranger, scenario.WorkspaceId);
        await AssertStatusAsync(await P3bPreviewAsync(stranger, block.Id, block.Version, grid), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await P3bApplyAsync(stranger, block.Id, block.Version, grid, hash), HttpStatusCode.Forbidden);
        SetTenant(stranger, strangerWorkspace);
        await AssertStatusAsync(await P3bPreviewAsync(stranger, block.Id, block.Version, grid), HttpStatusCode.NotFound);
        await AssertStatusAsync(await P3bApplyAsync(stranger, block.Id, block.Version, grid, hash), HttpStatusCode.NotFound);

        // The client of the workspace is not staff.
        SetTenant(client, scenario.WorkspaceId);
        await AssertStatusAsync(await P3bPreviewAsync(client, block.Id, block.Version, grid), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await P3bApplyAsync(client, block.Id, block.Version, grid, hash), HttpStatusCode.Forbidden);

        // A coach of the same gym who does not coach this client is told there is no such program (ADR 0026).
        using var colleague = CreateClient();
        await JoinAsCoachAsync(owner, colleague, "p3b-auth-colleague@example.test", "Lina Saad");
        await AssertStatusAsync(await P3bPreviewAsync(colleague, block.Id, block.Version, grid), HttpStatusCode.NotFound);
        await AssertStatusAsync(await P3bApplyAsync(colleague, block.Id, block.Version, grid, hash), HttpStatusCode.NotFound);

        // The owner is served.
        grid[0] = P3bEditFirstSet(grid[0], set => set with { DirectLoad = 105m });
        var preview = await P3bPreviewOkAsync(owner, block, grid);
        var applied = await P3bApplyOkAsync(owner, block, grid, preview.PreviewHash);
        Assert.AreEqual(105m, P3bOnlySession(applied.Weeks[0]).Exercises[0].Sets[0].PrescribedLoad);
        Assert.AreEqual(1L, await P3bEditCountAsync(block.Id));
    }

    [TestMethod]
    public async Task P3bAnEditThatBreaksARuleIsRefusedNamingTheWeekAndTheSession()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "p3b-rules", exerciseId =>
        [
            P2Week("Week 1", exerciseId, P1Set(1, "Direct", rpe: 7m, direct: 100m)),
            P2Week("Week 2", exerciseId, P1Set(1, "RpeChart", rpe: 7m, reps: 5)),
        ]);
        var block = await P2AssignAsync(coach, scenario, [P2SavedMax(scenario)]);
        var grid = P3bGrid(block, TenantToday());

        // A set outside the limits.
        var tooMany = grid.ToArray();
        tooMany[1] = P3bEditFirstSet(tooMany[1], set => set with { RepetitionsMinimum = 101, RepetitionsMaximum = 101 });
        await P3RefusedAsync(
            await P3bPreviewAsync(coach, block.Id, block.Version, tooMany),
            HttpStatusCode.BadRequest,
            "Week 2, Week 2 squat");

        // A set the chart does not cover is refused, and not guessed.
        var easy = grid.ToArray();
        easy[1] = P3bEditFirstSet(easy[1], set => set with { TargetRpe = 6m });
        await P3RefusedAsync(
            await P3bPreviewAsync(coach, block.Id, block.Version, easy),
            HttpStatusCode.BadRequest,
            "outside the chart");

        // A lift the program has no max for cannot take its weight from one.
        var bench = await CreateExerciseAsync(coach, "Bench press", [], []);
        var calculated = grid.ToArray();
        var newSession = P3bNewSession("Press day", 2, bench.Id);
        calculated[0] = calculated[0] with
        {
            Sessions =
            [
                .. calculated[0].Sessions,
                newSession with
                {
                    Session = newSession.Session with
                    {
                        Exercises = [newSession.Session.Exercises[0] with
                        {
                            Sets = [newSession.Session.Exercises[0].Sets[0] with
                            {
                                LoadStrategy = TrainingLoadStrategy.PercentageWorkingMax,
                                DirectLoad = null,
                                PercentageWorkingMax = 80m,
                            }],
                        }],
                    },
                },
            ],
        };
        await P3RefusedAsync(
            await P3bPreviewAsync(coach, block.Id, block.Version, calculated),
            HttpStatusCode.BadRequest,
            "Bench press has no training max in this program");

        // An archived lift cannot be given to a client, but one already in an untouched session is no obstacle.
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PutAsJsonAsync($"/api/exercises/{scenario.Exercise.Id}/archive", new { isArchived = true, version = scenario.Exercise.Version }),
            HttpStatusCode.OK);
        var untouched = await P3bPreviewOkAsync(coach, block, grid);
        Assert.AreEqual(0, untouched.SessionsEdited + untouched.SessionsAdded + untouched.SessionsRemoved);
        var added = grid.ToArray();
        added[0] = added[0] with { Sessions = [.. added[0].Sessions, P3bNewSession("Again", 2, scenario.Exercise.Id)] };
        await P3RefusedAsync(
            await P3bPreviewAsync(coach, block.Id, block.Version, added),
            HttpStatusCode.BadRequest,
            "archived or no longer in your library");
        Assert.AreEqual(0L, await P3bEditCountAsync(block.Id));
    }

    [TestMethod]
    public async Task P3bAFinishedOrCancelledProgramIsNotEdited()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "p3b-closed", exerciseId =>
        [
            P2Week("Week 1", exerciseId, P1Set(1, "Direct", rpe: 7m, direct: 100m)),
        ]);
        var block = await P2AssignAsync(coach, scenario, []);
        var grid = P3bGrid(block, TenantToday());
        grid[0] = P3bEditFirstSet(grid[0], set => set with { DirectLoad = 105m });
        var preview = await P3bPreviewOkAsync(coach, block, grid);

        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync($"/api/training/mesocycles/{block.Id}/cancel", new { reason = "Client paused", version = block.Version }),
            HttpStatusCode.OK);
        var cancelled = await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id));

        await P3RefusedAsync(
            await P3bPreviewAsync(coach, block.Id, cancelled.Version, grid),
            HttpStatusCode.Conflict,
            "program_edit_conflict");
        await P3RefusedAsync(
            await P3bApplyAsync(coach, block.Id, cancelled.Version, grid, preview.PreviewHash),
            HttpStatusCode.Conflict,
            "program_edit_conflict");
        Assert.AreEqual(0L, await P3bEditCountAsync(block.Id));
    }

    [TestMethod]
    public async Task P3bTheClientSeesAnEditedSharedWeekAndNothingOfAWeekThatIsNotShared()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "p3b-seen", exerciseId =>
        [
            P2Week("Week 1", exerciseId, P1Set(1, "Direct", rpe: 7m, direct: 100m)),
            P2Week("Week 2", exerciseId, P1Set(1, "Direct", rpe: 7m, direct: 100m)),
        ]);
        var block = await P2AssignAsync(coach, scenario, []);
        var grid = P3bGrid(block, TenantToday());

        // Week 1 is renamed in its session; week 2 is taken back from the client and its session renamed too.
        grid[0] = grid[0] with { Sessions = [grid[0].Sessions[0] with { Session = grid[0].Sessions[0].Session with { Name = "Heavy squats" } }] };
        grid[1] = grid[1] with
        {
            IsPublished = false,
            Sessions = [grid[1].Sessions[0] with { Session = grid[1].Sessions[0].Session with { Name = "Secret squats" } }],
        };
        var preview = await P3bPreviewOkAsync(coach, block, grid);
        Assert.AreEqual((2, 1), (preview.SessionsEdited, preview.WeekChanges.Count));
        CollectionAssert.AreEqual(
            P3bSharedThenNot,
            preview.SessionChanges.OrderBy(change => change.WeekNumber).Select(change => change.WeekIsShared).ToArray());
        await P3bApplyOkAsync(coach, block, grid, preview.PreviewHash);

        var program = await ReadSliceAsync<ClientTrainingProgramView>(client, "/api/training/me/program");
        Assert.IsTrue(program.IsAllowed);
        var weeks = program.Program!.Weeks;
        Assert.AreEqual("Heavy squats", weeks[0].Sessions.Single().Name);
        Assert.IsFalse(weeks[1].IsShared);
        Assert.IsEmpty(weeks[1].Sessions);
    }

    [TestMethod]
    public async Task P3bProgramEditRecordsCannotBeChangedOrDeleted()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "p3b-append", exerciseId =>
        [
            P2Week("Week 1", exerciseId, P1Set(1, "Direct", rpe: 7m, direct: 100m)),
        ]);
        var block = await P2AssignAsync(coach, scenario, []);
        var grid = P3bGrid(block, TenantToday());
        grid[0] = P3bEditFirstSet(grid[0], set => set with { DirectLoad = 105m });
        var preview = await P3bPreviewOkAsync(coach, block, grid);
        await P3bApplyOkAsync(coach, block, grid, preview.PreviewHash);

        foreach (var sql in new[]
        {
            """UPDATE training."ProgramEdits" SET "SessionsEdited" = 0 WHERE "MesocycleId" = @id""",
            """DELETE FROM training."ProgramEdits" WHERE "MesocycleId" = @id""",
        })
        {
            await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            command.Parameters.AddWithValue("id", block.Id);
            var exception = await Assert.ThrowsExactlyAsync<PostgresException>(async () => await command.ExecuteNonQueryAsync());
            Assert.AreEqual("55000", exception.SqlState);
        }

        Assert.AreEqual(1L, await P3bEditCountAsync(block.Id));
    }
}
