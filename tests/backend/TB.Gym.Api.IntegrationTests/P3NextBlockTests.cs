using System.Net;
using System.Net.Http.Json;
using TB.Gym.Modules.Training;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// P3a: Build next block takes the builder's four steps (WeekStep v1, TRN-025) and the program's own formulas
/// (STR-005, STR-010). The preview copies the chosen weeks of an assigned program, each copy a further step away,
/// works every weight out again from the program's maxes and saves nothing; apply rechecks the preview, the
/// program's version and the training coverage (STR-009, TRN-014) and leaves an append-only record.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private static string P3Url(Guid mesocycleId, string action) =>
        $"/api/training/mesocycles/{mesocycleId}/progression/{action}";

    private static object P3Request(
        uint version,
        Guid[] weekIds,
        int iterations,
        decimal rpe = 0m,
        int reps = 0,
        decimal percentage = 0m,
        decimal load = 0m) => new
        {
            sourceWeekIds = weekIds,
            iterations,
            rpeIncrement = rpe,
            repetitionsStep = reps,
            percentageStep = percentage,
            loadStep = load,
            mesocycleVersion = version,
        };

    private static async Task<HttpResponseMessage> P3PreviewAsync(
        HttpClient coach,
        Guid mesocycleId,
        uint version,
        Guid[] weekIds,
        int iterations,
        decimal rpe = 0m,
        int reps = 0,
        decimal percentage = 0m,
        decimal load = 0m)
    {
        await RefreshCsrfAsync(coach);
        return await coach.PostAsJsonAsync(
            P3Url(mesocycleId, "preview"),
            P3Request(version, weekIds, iterations, rpe, reps, percentage, load));
    }

    private static async Task<ProgressionPreviewView> P3PreviewOkAsync(
        HttpClient coach,
        TrainingMesocycleView block,
        Guid[] weekIds,
        int iterations,
        decimal rpe = 0m,
        int reps = 0,
        decimal percentage = 0m,
        decimal load = 0m)
    {
        var response = await P3PreviewAsync(coach, block.Id, block.Version, weekIds, iterations, rpe, reps, percentage, load);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<ProgressionPreviewView>(response);
    }

    private static async Task<HttpResponseMessage> P3ApplyAsync(
        HttpClient coach,
        Guid mesocycleId,
        uint version,
        Guid[] weekIds,
        int iterations,
        string previewHash,
        decimal rpe = 0m,
        int reps = 0,
        decimal percentage = 0m,
        decimal load = 0m)
    {
        await RefreshCsrfAsync(coach);
        return await coach.PostAsJsonAsync(
            P3Url(mesocycleId, "apply"),
            new
            {
                sourceWeekIds = weekIds,
                iterations,
                rpeIncrement = rpe,
                repetitionsStep = reps,
                percentageStep = percentage,
                loadStep = load,
                previewHash,
                mesocycleVersion = version,
            });
    }

    private static readonly string[] P3RoundLabels =
    [
        "Week 1 - progression 1",
        "Week 2 - progression 1",
        "Week 1 - progression 2",
        "Week 2 - progression 2",
    ];

    private static readonly int[] P3RoundWeekNumbers = [3, 4, 5, 6];

    private static SetPrescriptionView[] P3Sets(TrainingWeekView week) =>
        week.Sessions
            .OrderBy(session => session.Position)
            .SelectMany(session => session.Exercises.OrderBy(exercise => exercise.Position))
            .SelectMany(exercise => exercise.Sets.OrderBy(set => set.Position))
            .ToArray();

    private static async Task P3RefusedAsync(HttpResponseMessage response, HttpStatusCode status, params string[] texts)
    {
        await AssertStatusAsync(response, status);
        var body = await response.Content.ReadAsStringAsync();
        foreach (var text in texts)
        {
            StringAssert.Contains(body, text);
        }
    }

    [TestMethod]
    public async Task P3EffortAndRepsStepsMoveEachCopyAndTheChartAndTheCurveWorkTheWeightsOutAgain()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "p3-steps", exerciseId =>
        [
            P2Week(
                "Week 1",
                exerciseId,
                P1Set(1, "RpeChart", rpe: 7m, reps: 5),
                P1Set(2, "RpeBasedEpley", rpe: 8m, reps: 5),
                P1Set(3, "PercentageWorkingMax", rpe: null, percentage: 70m),
                P1Set(4, "Direct", rpe: 6m, direct: 60m, setType: "WarmUp")),
        ]);
        var block = await P2AssignAsync(coach, scenario, [P2SavedMax(scenario)]);
        var source = block.Weeks.Single();
        CollectionAssert.AreEqual(
            new decimal?[] { 77.5m, 80m, 70m, 60m },
            P3Sets(source).Select(set => set.PrescribedLoad).ToArray());

        // RPE up half a point and a repetition less, a week at a time, for two weeks.
        var preview = await P3PreviewOkAsync(coach, block, [source.Id], 2, rpe: 0.5m, reps: -1);
        Assert.AreEqual(("WeekStep", "1.0", 3, true), (
            preview.TransformKey,
            preview.TransformVersion,
            preview.ResultingWeekCount,
            preview.IsInsideTrainingCoverage));
        Assert.HasCount(2, preview.GeneratedWeeks);
        Assert.AreEqual((2, 3), (preview.GeneratedWeeks[0].WeekNumber, preview.GeneratedWeeks[1].WeekNumber));
        Assert.AreEqual("Week 1 - progression 1", preview.GeneratedWeeks[0].Label);

        var first = P3Sets(preview.GeneratedWeeks[0]);
        var second = P3Sets(preview.GeneratedWeeks[1]);

        // The RTS chart: 4 reps at RPE 7.5 is 82.4% of 100 kg, and 3 reps at RPE 8 is 86.3%.
        Assert.AreEqual((4, 7.5m, 82.5m, "RpeChart"), (first[0].RepetitionsMaximum, first[0].TargetRpe, first[0].PrescribedLoad, first[0].CalculationStrategyKey));
        StringAssert.Contains(first[0].CalculationExplanation, "RTS RPE chart v1: 4 reps at RPE 7.5 is 82.4% of 100 kg = 82.4 kg.");
        StringAssert.Contains(first[0].CalculationExplanation, "Rounded to the nearest 2.5 kg: 82.5 kg.");
        Assert.AreEqual((3, 8m, 87.5m), (second[0].RepetitionsMaximum, second[0].TargetRpe, second[0].PrescribedLoad));

        // The Epley curve: 4 reps with 1.5 in reserve is 100 kg / (1 + 5.5 / 30), which rounds to 85 kg.
        Assert.AreEqual(("RpeBasedEpley", 4, 8.5m, 85m), (first[1].LoadStrategy.ToString(), first[1].RepetitionsMaximum, first[1].TargetRpe, first[1].PrescribedLoad));
        StringAssert.Contains(first[1].CalculationExplanation, "WorkingMaxLoad v2");
        Assert.AreEqual((3, 9m, 87.5m), (second[1].RepetitionsMaximum, second[1].TargetRpe, second[1].PrescribedLoad));

        // A percentage of the max stays put without a percentage step, but its repetitions move.
        Assert.AreEqual((70m, 70m, 4), (first[2].PercentageWorkingMax, first[2].PrescribedLoad, first[2].RepetitionsMaximum));

        // A warm-up is left as it is: no step reaches it.
        Assert.AreEqual((5, 6m, 60m), (first[3].RepetitionsMaximum, first[3].TargetRpe, first[3].PrescribedLoad));
        Assert.AreEqual((5, 6m, 60m), (second[3].RepetitionsMaximum, second[3].TargetRpe, second[3].PrescribedLoad));

        // The preview saved nothing.
        var untouched = await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id));
        Assert.AreEqual((block.Version, 1), (untouched.Version, untouched.Weeks.Count));
    }

    [TestMethod]
    public async Task P3PercentageAndWeightStepsMoveCalculatedAndTypedWeightsAndNeverAWarmUp()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "p3-weights", exerciseId =>
        [
            P2Week(
                "Week 1",
                exerciseId,
                P1Set(1, "PercentageWorkingMax", rpe: null, percentage: 70m),
                P1Set(2, "Direct", rpe: 7m, direct: 100m),
                P1Set(3, "PercentageWorkingMax", rpe: null, percentage: 80m, manual: 102.5m),
                P1Set(4, "Direct", rpe: null, direct: 60m, setType: "WarmUp")),
        ]);
        var block = await P2AssignAsync(coach, scenario, [P2SavedMax(scenario)]);
        var source = block.Weeks.Single();

        var preview = await P3PreviewOkAsync(coach, block, [source.Id], 2, rpe: 0.5m, percentage: 2.5m, load: 5m);
        var first = P3Sets(preview.GeneratedWeeks[0]);
        var second = P3Sets(preview.GeneratedWeeks[1]);

        // 72.5% and then 75% of 100 kg; a typed 100 kg and a manual 102.5 kg go up 5 kg a week.
        CollectionAssert.AreEqual(new decimal?[] { 72.5m, 105m, 107.5m, 60m }, first.Select(set => set.PrescribedLoad).ToArray());
        CollectionAssert.AreEqual(new decimal?[] { 75m, 110m, 112.5m, 60m }, second.Select(set => set.PrescribedLoad).ToArray());
        Assert.AreEqual((72.5m, 75m), (first[0].PercentageWorkingMax, second[0].PercentageWorkingMax));
        Assert.AreEqual(("CoachDirect", false), (first[1].CalculationStrategyKey, first[1].IsManualLoadOverride));
        Assert.AreEqual(("ManualCoachOverride", true), (first[2].CalculationStrategyKey, first[2].IsManualLoadOverride));

        // The effort step moved the typed set's target, and nothing of the warm-up.
        Assert.AreEqual((7.5m, 8m), (first[1].TargetRpe, second[1].TargetRpe));
        Assert.IsNull(first[3].TargetRpe);

        // Applying it adds the weeks with exactly those weights, and the first week keeps its own.
        var applied = await P3ApplyOkAsync(coach, block, [source.Id], 2, preview.PreviewHash, rpe: 0.5m, percentage: 2.5m, load: 5m);
        Assert.HasCount(3, applied.Weeks);
        var weeks = applied.Weeks.OrderBy(week => week.WeekNumber).ToArray();
        CollectionAssert.AreEqual(new decimal?[] { 70m, 100m, 102.5m, 60m }, P3Sets(weeks[0]).Select(set => set.PrescribedLoad).ToArray());
        CollectionAssert.AreEqual(new decimal?[] { 72.5m, 105m, 107.5m, 60m }, P3Sets(weeks[1]).Select(set => set.PrescribedLoad).ToArray());
        CollectionAssert.AreEqual(new decimal?[] { 75m, 110m, 112.5m, 60m }, P3Sets(weeks[2]).Select(set => set.PrescribedLoad).ToArray());
        Assert.IsTrue(P3Sets(weeks[2])[2].IsManualLoadOverride);
        Assert.IsTrue(weeks[1].StartsOn < weeks[2].StartsOn);
    }

    private static async Task<TrainingMesocycleView> P3ApplyOkAsync(
        HttpClient coach,
        TrainingMesocycleView block,
        Guid[] weekIds,
        int iterations,
        string previewHash,
        decimal rpe = 0m,
        int reps = 0,
        decimal percentage = 0m,
        decimal load = 0m)
    {
        var response = await P3ApplyAsync(coach, block.Id, block.Version, weekIds, iterations, previewHash, rpe, reps, percentage, load);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<TrainingMesocycleView>(response);
    }

    [TestMethod]
    public async Task P3SeveralWeeksRunRoundByRoundAndApplyRecordsWhatWasDoneOnce()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "p3-record", exerciseId =>
        [
            P2Week("Week 1", exerciseId, P1Set(1, "RpeChart", rpe: 7m, reps: 5)),
            P2Week("Week 2", exerciseId, P1Set(1, "RpeChart", rpe: 8m, reps: 5)),
        ]);
        var block = await P2AssignAsync(coach, scenario, [P2SavedMax(scenario)]);
        var weeks = block.Weeks.OrderBy(week => week.WeekNumber).ToArray();
        Guid[] both = [weeks[0].Id, weeks[1].Id];

        // Both weeks, twice over: week 1 and 2 one step on, then week 1 and 2 two steps on.
        var preview = await P3PreviewOkAsync(coach, block, both, 2, rpe: 0.5m);
        CollectionAssert.AreEqual(
            new decimal?[] { 7.5m, 8.5m, 8m, 9m },
            preview.GeneratedWeeks.Select(week => P3Sets(week).Single().TargetRpe).ToArray());
        CollectionAssert.AreEqual(P3RoundLabels, preview.GeneratedWeeks.Select(week => week.Label).ToArray());
        CollectionAssert.AreEqual(P3RoundWeekNumbers, preview.GeneratedWeeks.Select(week => week.WeekNumber).ToArray());

        var applied = await P3ApplyOkAsync(coach, block, both, 2, preview.PreviewHash, rpe: 0.5m);
        Assert.HasCount(6, applied.Weeks);
        CollectionAssert.AreEqual(
            preview.GeneratedWeeks.Select(week => P3Sets(week).Single().PrescribedLoad).ToArray(),
            applied.Weeks.OrderBy(week => week.WeekNumber).Skip(2).Select(week => P3Sets(week).Single().PrescribedLoad).ToArray());

        // The record names the rule and the steps, and says how many weeks it read and made.
        Assert.AreEqual(
            1L,
            await P2CountAsync(
                """
                SELECT count(*) FROM training."ProgressionApplications"
                WHERE "MesocycleId" = @id AND "TransformKey" = 'WeekStep' AND "TransformVersion" = '1.0'
                  AND "SourceWeekCount" = 2 AND "GeneratedWeekCount" = 4
                  AND ("RequestJson"->'steps'->>'rpeStep')::numeric = 0.5
                  AND ("RequestJson"->'steps'->>'repetitionsStep')::numeric = 0
                """,
                block.Id));

        // The same request again is refused: the program has moved on, so the preview no longer holds.
        var again = await P3ApplyAsync(coach, block.Id, block.Version, both, 2, preview.PreviewHash, rpe: 0.5m);
        await P3RefusedAsync(again, HttpStatusCode.Conflict, "progression_conflict");
        Assert.AreEqual(
            1L,
            await P2CountAsync("""SELECT count(*) FROM training."ProgressionApplications" WHERE "MesocycleId" = @id""", block.Id));

        // The record is append-only, like the other histories.
        await AssertSqlStateAsync("55000", "UPDATE training.\"ProgressionApplications\" SET \"TransformKey\" = 'edited'");
        await AssertSqlStateAsync("55000", "DELETE FROM training.\"ProgressionApplications\"");
    }

    [TestMethod]
    public async Task P3AStepThatLeavesASetsLimitsRefusesTheWholeBlockAndNamesTheWeekAndTheSet()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "p3-limits", exerciseId =>
        [
            P2Week("Week 1", exerciseId, P1Set(1, "RpeChart", rpe: 7m, reps: 5)),
            P2Week("Week 2", exerciseId, P1Set(1, "RpeChart", rpe: 8m, reps: 5)),
        ]);
        var block = await P2AssignAsync(coach, scenario, [P2SavedMax(scenario)]);
        var weeks = block.Weeks.OrderBy(week => week.WeekNumber).ToArray();
        Guid[] both = [weeks[0].Id, weeks[1].Id];

        // Week 2 is the one that passes RPE 10, on its fifth copy.
        await P3RefusedAsync(
            await P3PreviewAsync(coach, block.Id, block.Version, both, 5, rpe: 0.5m),
            HttpStatusCode.BadRequest,
            "Week 2, copy 5, Week 2 squat, Competition squat, set 1",
            "RPE would be 10.5");

        // The chart stops at 12 repetitions and is never stretched: the set must use a weight or the curve.
        await P3RefusedAsync(
            await P3PreviewAsync(coach, block.Id, block.Version, [weeks[0].Id], 3, reps: 3),
            HttpStatusCode.BadRequest,
            "Week 1, copy 3, Week 1 squat, Competition squat, set 1: 14 reps at RPE 7 is outside the chart",
            "RTS RPE chart covers RPE 6.5 to 10");

        // A step the rule does not allow is refused before anything is copied.
        await P3RefusedAsync(
            await P3PreviewAsync(coach, block.Id, block.Version, [weeks[0].Id], 1, rpe: 0.3m),
            HttpStatusCode.BadRequest,
            "RPE can change by -2 to");
        await P3RefusedAsync(
            await P3PreviewAsync(coach, block.Id, block.Version, [weeks[0].Id], 1, reps: 21),
            HttpStatusCode.BadRequest,
            "Repetitions can change by -20 to");
        await P3RefusedAsync(
            await P3PreviewAsync(coach, block.Id, block.Version, [weeks[0].Id], 1, percentage: 50.5m),
            HttpStatusCode.BadRequest,
            "The percentage can change by -50 to");
        await P3RefusedAsync(
            await P3PreviewAsync(coach, block.Id, block.Version, [weeks[0].Id], 1, load: 500.5m),
            HttpStatusCode.BadRequest,
            "The weight can change by -500 to");

        // One to twelve copies of one to twelve different weeks that belong to this program.
        foreach (var iterations in new[] { 0, 13 })
        {
            await P3RefusedAsync(
                await P3PreviewAsync(coach, block.Id, block.Version, [weeks[0].Id], iterations),
                HttpStatusCode.BadRequest,
                "1 to 12");
        }

        await P3RefusedAsync(
            await P3PreviewAsync(coach, block.Id, block.Version, [], 1),
            HttpStatusCode.BadRequest,
            "1 to 12");
        await P3RefusedAsync(
            await P3PreviewAsync(coach, block.Id, block.Version, [weeks[0].Id, weeks[0].Id], 1),
            HttpStatusCode.BadRequest,
            "unique source weeks");
        await P3RefusedAsync(
            await P3PreviewAsync(coach, block.Id, block.Version, [Guid.NewGuid()], 1),
            HttpStatusCode.BadRequest,
            "must belong to this mesocycle");

        // A copy the program has no room for is refused with the plan, not saved.
        var tooMany = await P3PreviewOkAsync(coach, block, both, 4, rpe: 0m);
        Assert.AreEqual((10, false), (tooMany.ResultingWeekCount, tooMany.IsInsideTrainingCoverage));
        await P3RefusedAsync(
            await P3ApplyAsync(coach, block.Id, block.Version, both, 4, tooMany.PreviewHash),
            HttpStatusCode.BadRequest,
            "entire mesocycle must remain inside");

        // Nothing above changed the program.
        var after = await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id));
        Assert.AreEqual((block.Version, 2), (after.Version, after.Weeks.Count));
        Assert.AreEqual(
            0L,
            await P2CountAsync("""SELECT count(*) FROM training."ProgressionApplications" WHERE "MesocycleId" = @id""", block.Id));
    }

    [TestMethod]
    public async Task P3ARefusalNumbersSetsByTheirOrderWhateverPositionAProgramStoredThemAt()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        // The older demo data stores its sets from position 0; a coach reads them as set 1, set 2.
        var scenario = await P2CustomStartAsync(coach, client, "p3-order", exerciseId =>
        [
            P2Week(
                "Week 1",
                exerciseId,
                P1Set(0, "RpeChart", rpe: 7m, reps: 5),
                P1Set(1, "RpeChart", rpe: 9m, reps: 5)),
        ]);
        var block = await P2AssignAsync(coach, scenario, [P2SavedMax(scenario)]);
        var weekId = block.Weeks.Single().Id;

        // The second set passes RPE 10 on its third copy, whichever way the program numbered it.
        await P3RefusedAsync(
            await P3PreviewAsync(coach, block.Id, block.Version, [weekId], 3, rpe: 0.5m),
            HttpStatusCode.BadRequest,
            "Week 1, copy 3, Week 1 squat, Competition squat, set 2: RPE would be 10.5");
    }

    [TestMethod]
    public async Task P3AStaleVersionOrAnotherPreviewIsRefusedAndSavesNothing()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "p3-stale", exerciseId =>
        [
            P2Week("Week 1", exerciseId, P1Set(1, "RpeChart", rpe: 7m, reps: 5)),
        ]);
        var block = await P2AssignAsync(coach, scenario, [P2SavedMax(scenario)]);
        var weekId = block.Weeks.Single().Id;
        var preview = await P3PreviewOkAsync(coach, block, [weekId], 2, rpe: 0.5m);

        // The version the page holds is not the program's.
        await P3RefusedAsync(
            await P3PreviewAsync(coach, block.Id, block.Version + 1, [weekId], 2, rpe: 0.5m),
            HttpStatusCode.Conflict,
            "progression_conflict");

        // The hash proves what was reviewed: the same hash with other steps, or none, is refused.
        await P3RefusedAsync(
            await P3ApplyAsync(coach, block.Id, block.Version, [weekId], 2, preview.PreviewHash, rpe: 0.5m, reps: -1),
            HttpStatusCode.Conflict,
            "progression_preview_changed");
        await P3RefusedAsync(
            await P3ApplyAsync(coach, block.Id, block.Version, [weekId], 3, preview.PreviewHash, rpe: 0.5m),
            HttpStatusCode.Conflict,
            "progression_preview_changed");
        await P3RefusedAsync(
            await P3ApplyAsync(coach, block.Id, block.Version, [weekId], 2, string.Empty, rpe: 0.5m),
            HttpStatusCode.Conflict,
            "progression_preview_changed");

        // The program changes after the preview (the week is un-shared), so the preview is out of date.
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PutAsJsonAsync(
                $"/api/training/mesocycles/{block.Id}/weeks/{weekId}/publish",
                new { isPublished = false, version = block.Version }),
            HttpStatusCode.OK);
        await P3RefusedAsync(
            await P3ApplyAsync(coach, block.Id, block.Version, [weekId], 2, preview.PreviewHash, rpe: 0.5m),
            HttpStatusCode.Conflict,
            "progression_conflict");

        var after = await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id));
        Assert.HasCount(1, after.Weeks);
        Assert.AreEqual(
            0L,
            await P2CountAsync("""SELECT count(*) FROM training."ProgressionApplications" WHERE "MesocycleId" = @id""", block.Id));
    }

    [TestMethod]
    public async Task P3TwoApplicationsOfTheSamePreviewMakeTheWeeksOnce()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "p3-race", exerciseId =>
        [
            P2Week("Week 1", exerciseId, P1Set(1, "RpeChart", rpe: 7m, reps: 5)),
        ]);
        var block = await P2AssignAsync(coach, scenario, [P2SavedMax(scenario)]);
        var weekId = block.Weeks.Single().Id;
        var preview = await P3PreviewOkAsync(coach, block, [weekId], 2, rpe: 0.5m);

        // The antiforgery token is refreshed once, outside the race, so each request is the same request.
        await RefreshCsrfAsync(coach);
        var attempts = await Task.WhenAll(
            Enumerable.Range(0, 2).Select(_ => coach.PostAsJsonAsync(
                P3Url(block.Id, "apply"),
                new
                {
                    sourceWeekIds = new[] { weekId },
                    iterations = 2,
                    rpeIncrement = 0.5m,
                    repetitionsStep = 0,
                    percentageStep = 0m,
                    loadStep = 0m,
                    previewHash = preview.PreviewHash,
                    mesocycleVersion = block.Version,
                })));
        CollectionAssert.AreEquivalent(
            new[] { HttpStatusCode.OK, HttpStatusCode.Conflict },
            attempts.Select(response => response.StatusCode).ToArray());

        var after = await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id));
        Assert.HasCount(3, after.Weeks);
        Assert.AreEqual(
            1L,
            await P2CountAsync("""SELECT count(*) FROM training."ProgressionApplications" WHERE "MesocycleId" = @id""", block.Id));
    }

    [TestMethod]
    public async Task P3OnlyStaffOfThatWorkspaceWhoCoachTheClientBuildTheirNextBlock()
    {
        using var owner = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(owner, client, "p3-auth", exerciseId =>
        [
            P2Week("Week 1", exerciseId, P1Set(1, "RpeChart", rpe: 7m, reps: 5)),
        ]);
        var block = await P2AssignAsync(owner, scenario, [P2SavedMax(scenario)]);
        var weekId = block.Weeks.Single().Id;
        var hash = new string('a', 64);

        // Nobody signed out, and nobody without the antiforgery token.
        using var anonymous = CreateClient();
        await RefreshCsrfAsync(anonymous);
        await AssertStatusAsync(
            await anonymous.PostAsJsonAsync(P3Url(block.Id, "preview"), P3Request(block.Version, [weekId], 1)),
            HttpStatusCode.Unauthorized);
        await AssertStatusAsync(
            await anonymous.PostAsJsonAsync(P3Url(block.Id, "apply"), P3Request(block.Version, [weekId], 1)),
            HttpStatusCode.Unauthorized);
        using var noToken = CreateClient();
        await RegisterCoachAsync(noToken, "p3-auth-token@example.test", "P3 Token", "P3 Token Gym");
        noToken.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
        await AssertStatusAsync(
            await noToken.PostAsJsonAsync(P3Url(block.Id, "preview"), P3Request(block.Version, [weekId], 1)),
            HttpStatusCode.BadRequest);

        // A coach of another workspace is refused when naming this one, and finds nothing of it in their own.
        using var stranger = CreateClient();
        var strangerWorkspace = await RegisterCoachAsync(stranger, "p3-auth-stranger@example.test", "P3 Stranger", "P3 Stranger Gym");
        SetTenant(stranger, scenario.WorkspaceId);
        await AssertStatusAsync(await P3PreviewAsync(stranger, block.Id, block.Version, [weekId], 1), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await P3ApplyAsync(stranger, block.Id, block.Version, [weekId], 1, hash), HttpStatusCode.Forbidden);
        SetTenant(stranger, strangerWorkspace);
        await AssertStatusAsync(await P3PreviewAsync(stranger, block.Id, block.Version, [weekId], 1), HttpStatusCode.NotFound);
        await AssertStatusAsync(await P3ApplyAsync(stranger, block.Id, block.Version, [weekId], 1, hash), HttpStatusCode.NotFound);

        // The client of the workspace is not staff.
        SetTenant(client, scenario.WorkspaceId);
        await AssertStatusAsync(await P3PreviewAsync(client, block.Id, block.Version, [weekId], 1), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await P3ApplyAsync(client, block.Id, block.Version, [weekId], 1, hash), HttpStatusCode.Forbidden);

        // A coach of the same gym who does not coach this client is told there is no such program (ADR 0026).
        using var colleague = CreateClient();
        await JoinAsCoachAsync(owner, colleague, "p3-auth-colleague@example.test", "Lina Saad");
        await AssertStatusAsync(await P3PreviewAsync(colleague, block.Id, block.Version, [weekId], 1), HttpStatusCode.NotFound);
        await AssertStatusAsync(await P3ApplyAsync(colleague, block.Id, block.Version, [weekId], 1, hash), HttpStatusCode.NotFound);

        // The owner is served.
        var preview = await P3PreviewOkAsync(owner, block, [weekId], 1, rpe: 0.5m);
        var applied = await P3ApplyOkAsync(owner, block, [weekId], 1, preview.PreviewHash, rpe: 0.5m);
        Assert.HasCount(2, applied.Weeks);
        var after = await ReadSliceAsync<TrainingMesocycleView>(owner, P2MesocycleUrl(block.Id));
        Assert.HasCount(2, after.Weeks);
    }
}
