using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using TB.Gym.Modules.Training;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Audit batch A3 (docs/FULL-AUDIT-2026-10.md section 11): the training rules that protect the record. A set logged
/// under a swapped lift stays that lift's (CLIENT-2), a swapped session keeps its day (TRAIN-3), a reschedule after
/// a start is a conflict and not a crash (BEA-3, BEA-11), Build next block names the program in its way (BEA-1,
/// BEA-12), the set save and the finish summary read records by one rule (BEA-4, BEA-14), a long week name and a
/// weight that rounds to nothing are handled before apply (BEA-9, BEA-10), and "How they have done" reads a set
/// with an RPE on the RTS chart and names the formula (TRAIN-4).
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private static async Task<HttpResponseMessage> A3SwapAsync(
        HttpClient client,
        Guid workoutId,
        Guid performanceId,
        Guid exerciseId,
        uint version)
    {
        await RefreshCsrfAsync(client);
        return await client.PutAsJsonAsync(
            $"/api/training/me/workouts/{workoutId}/exercises/{performanceId}/substitution",
            new { exerciseId, version });
    }

    private static async Task<WorkoutSetSaveView> A3LogAsync(
        HttpClient client,
        Guid workoutId,
        Guid setId,
        int repetitions,
        decimal load,
        decimal? rpe,
        uint version)
    {
        await RefreshCsrfAsync(client);
        var saved = await client.PutAsJsonAsync(
            $"/api/training/me/workouts/{workoutId}/sets/{setId}",
            new { repetitions, load, loadUnit = "Kilogram", rpe, isCompleted = true, clientNote = (string?)null, version });
        await AssertStatusAsync(saved, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<WorkoutSetSaveView>(saved);
    }

    private static async Task<(WorkoutExecutionView Workout, ClientWorkoutView Day)> A3StartTodayAsync(HttpClient client)
    {
        var today = await ReadSliceAsync<ClientTrainingDayResult>(client, "/api/training/me/today");
        await RefreshCsrfAsync(client);
        var start = await client.PostAsync($"/api/training/me/sessions/{today.Workouts.Single().SessionId}/start", null);
        await AssertStatusAsync(start, HttpStatusCode.OK);
        var workout = await ReadSlicePayloadAsync<WorkoutExecutionView>(start);
        today = await ReadSliceAsync<ClientTrainingDayResult>(client, "/api/training/me/today");
        return (workout, today.Workouts.Single());
    }

    private static async Task<WorkoutExecutionView> A3FinishAsync(HttpClient client, Guid workoutId, uint version)
    {
        await RefreshCsrfAsync(client);
        var complete = await client.PostAsJsonAsync($"/api/training/me/workouts/{workoutId}/complete", new { version });
        await AssertStatusAsync(complete, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<WorkoutExecutionView>(complete);
    }

    private static string A3Day(DateOnly date) => date.ToString("ddd d MMM yyyy", CultureInfo.InvariantCulture);

    [TestMethod]
    public async Task A3ASetLoggedUnderASwappedLiftStaysThatLiftsSetAndRecord()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        await RegisterCoachAsync(coach, "a3-swap@example.test", "A3 Coach", "A3 Swap Gym");
        var clientId = await InviteAndAcceptAsync(coach, client, "a3-swap-client@example.test", newAccount: true);
        var resources = await CreateTrainingResourcesAsync(coach, clientId, 8, 1, TenantToday());
        await AssignAsync(coach, clientId, resources, TenantToday());
        var (workout, day) = await A3StartTodayAsync(client);
        var exercise = day.Exercises.Single();
        var performanceId = exercise.PerformanceId!.Value;

        // The client swaps to the lift the coach approved and logs a set as it.
        var swapped = await A3SwapAsync(client, workout.Id, performanceId, resources.Alternative.Id, workout.Version);
        await AssertStatusAsync(swapped, HttpStatusCode.OK);
        var afterSwap = await ReadSlicePayloadAsync<WorkoutExecutionView>(swapped);
        var logged = await A3LogAsync(
            client, workout.Id, exercise.Sets.Single().PerformanceId!.Value, 8, 10m, 8m, afterSwap.Version);
        Assert.IsTrue(logged.IsPersonalRecord);

        // Swapping back would make that set the prescribed lift's: refused, in words the player shows.
        var back = await A3SwapAsync(client, workout.Id, performanceId, resources.Exercise.Id, logged.ExecutionVersion);
        await AssertStatusAsync(back, HttpStatusCode.Conflict);
        var refusal = await back.Content.ReadFromJsonAsync<Dictionary<string, string>>()
            ?? throw new AssertFailedException("The refusal was empty.");
        Assert.AreEqual(
            ("substitution_after_logged_set",
                "You logged a set as Scenario alternative, so this exercise stays Scenario alternative for this workout."),
            (refusal["code"], refusal["message"]));
        Assert.AreEqual(
            1L,
            await P2CountAsync(
                $"""
                SELECT count(*) FROM training."WorkoutExercisePerformances"
                WHERE "Id" = @id AND "ActualExerciseId" = '{resources.Alternative.Id}' AND "WasSubstituted"
                """,
                performanceId));

        // Choosing the lift already chosen is no change, so a retry is still answered.
        var same = await A3SwapAsync(client, workout.Id, performanceId, resources.Alternative.Id, logged.ExecutionVersion);
        await AssertStatusAsync(same, HttpStatusCode.OK);
        var current = await ReadSlicePayloadAsync<WorkoutExecutionView>(same);

        // The finished workout's record, and the client's records, are the lift actually done.
        var finished = await A3FinishAsync(client, workout.Id, current.Version);
        Assert.AreEqual("Scenario alternative", finished.FinishSummary!.PersonalRecords.Single().ExerciseName);
        var records = await ReadSliceAsync<ClientPersonalRecordsResult>(client, "/api/training/me/personal-records");
        Assert.AreEqual(resources.Alternative.Id, records.Items.Single().ExerciseId);
    }

    [TestMethod]
    public async Task A3ASwappedSessionKeepsItsOwnDayWhateverDayItsReplacementCameFrom()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        await RegisterCoachAsync(coach, "a3-session@example.test", "A3 Coach", "A3 Session Gym");
        var clientId = await InviteAndAcceptAsync(coach, client, "a3-session-client@example.test", newAccount: true);
        var resources = await CreateTrainingResourcesAsync(coach, clientId, 8, 2, TenantToday());
        var block = await AssignAsync(coach, clientId, resources, TenantToday());
        var program = await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id));
        var target = program.Weeks.Single(week => week.WeekNumber == 2).Sessions.Single();
        var day = TenantToday().AddDays(7);
        Assert.AreEqual((0, (DateOnly?)day), (target.DayOffset, target.ScheduledDate));

        // The saved session the coach picks sat on the fourth day of its own program.
        var replacement = P3bRequest(target) with { Name = "Lower A", DayOffset = 3 };
        await RefreshCsrfAsync(coach);
        var swapped = await coach.PutAsJsonAsync(
            $"/api/training/mesocycles/{block.Id}/sessions/{target.Id}",
            new ReplaceTrainingSessionRequest(replacement, program.Version),
            SliceReadJson);
        await AssertStatusAsync(swapped, HttpStatusCode.OK);

        // The same session, with the new content, on the day it had.
        var after = await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id));
        var kept = after.Weeks.Single(week => week.WeekNumber == 2).Sessions.Single();
        Assert.AreEqual(
            (target.Id, "Lower A", 0, (DateOnly?)day),
            (kept.Id, kept.Name, kept.DayOffset, kept.ScheduledDate));
        Assert.AreEqual((DateOnly?)TenantToday(), after.Weeks.Single(week => week.WeekNumber == 1).Sessions.Single().ScheduledDate);
    }

    [TestMethod]
    public async Task A3AProgramCannotBeRescheduledOnceAWorkoutStartedOrItEnded()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        await RegisterCoachAsync(coach, "a3-reschedule@example.test", "A3 Coach", "A3 Reschedule Gym");
        var clientId = await InviteAndAcceptAsync(coach, client, "a3-reschedule-client@example.test", newAccount: true);
        var resources = await CreateTrainingResourcesAsync(coach, clientId, 8, 1, TenantToday());
        var block = await AssignAsync(coach, clientId, resources, TenantToday());
        var (workout, day) = await A3StartTodayAsync(client);

        async Task<HttpResponseMessage> RescheduleAsync()
        {
            var current = await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id));
            await RefreshCsrfAsync(coach);
            return await coach.PutAsJsonAsync(
                $"/api/training/mesocycles/{block.Id}/schedule",
                new { startDate = TenantToday().AddDays(7), version = current.Version });
        }

        // A workout started: the dates stay, and the answer is a conflict the screen words, never a 500.
        var started = await RescheduleAsync();
        await AssertStatusAsync(started, HttpStatusCode.Conflict);
        var refusal = await started.Content.ReadFromJsonAsync<Dictionary<string, string>>();
        Assert.AreEqual("lifecycle_conflict", refusal?["code"]);
        StringAssert.Contains(refusal!["message"], "cannot be rescheduled after a workout starts");
        var unchanged = await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id));
        Assert.AreEqual(TenantToday(), unchanged.StartDate);

        // The only session done, the program is finished: still a conflict.
        var set = day.Exercises.Single().Sets.Single();
        var logged = await A3LogAsync(client, workout.Id, set.PerformanceId!.Value, 5, 80m, 8m, workout.Version);
        await A3FinishAsync(client, workout.Id, logged.ExecutionVersion);
        var finished = await RescheduleAsync();
        await AssertStatusAsync(finished, HttpStatusCode.Conflict);
        StringAssert.Contains(await finished.Content.ReadAsStringAsync(), "lifecycle_conflict");
    }

    [TestMethod]
    public async Task A3BuildNextBlockNamesTheProgramInItsWayInThePreviewAndTheApply()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        await RegisterCoachAsync(coach, "a3-next@example.test", "A3 Coach", "A3 Next Gym");
        var clientId = await InviteAndAcceptAsync(coach, client, "a3-next-client@example.test", newAccount: true);
        var resources = await CreateTrainingResourcesAsync(coach, clientId, 8, 1, TenantToday());
        var first = await AssignAsync(coach, clientId, resources, TenantToday());
        var nextStart = TenantToday().AddDays(21);
        await AssignAsync(coach, clientId, resources, nextStart);
        var weekId = first.Weeks.Single().Id;
        var inTheWay =
            $"Training already has 1-week scenario from {A3Day(nextStart)} to {A3Day(nextStart.AddDays(6))}";

        // Three copies would run into the next program: the preview says so, and how many weeks fit.
        var tooMany = await P3PreviewAsync(coach, first.Id, first.Version, [weekId], 3);
        await AssertStatusAsync(tooMany, HttpStatusCode.OK);
        var preview = await ReadSlicePayloadAsync<ProgressionPreviewView>(tooMany);
        Assert.IsTrue(preview.IsInsideTrainingCoverage);
        Assert.AreEqual(
            $"{inTheWay}, so 2 new weeks fit before it. Choose fewer copies, or move or cancel that program first.",
            preview.OverlapMessage);

        // Apply refuses it with the same words, and nothing is written.
        var refused = await P3ApplyAsync(coach, first.Id, first.Version, [weekId], 3, preview.PreviewHash);
        await AssertStatusAsync(refused, HttpStatusCode.Conflict);
        var refusal = await refused.Content.ReadFromJsonAsync<Dictionary<string, string>>();
        Assert.AreEqual(("mesocycle_overlap", preview.OverlapMessage), (refusal?["code"], refusal?["message"]));
        Assert.AreEqual(
            0L,
            await P2CountAsync("""SELECT count(*) FROM training."ProgressionApplications" WHERE "MesocycleId" = @id""", first.Id));

        // Two copies fit exactly: the program then ends the day before the next one starts.
        var fits = await ReadSlicePayloadAsync<ProgressionPreviewView>(
            await P3PreviewAsync(coach, first.Id, first.Version, [weekId], 2));
        Assert.IsNull(fits.OverlapMessage);
        var applied = await P3ApplyAsync(coach, first.Id, first.Version, [weekId], 2, fits.PreviewHash);
        await AssertStatusAsync(applied, HttpStatusCode.OK);
        var grown = await ReadSlicePayloadAsync<TrainingMesocycleView>(applied);
        Assert.AreEqual((3, nextStart), (grown.Weeks.Count, grown.EndDateExclusive));

        // Now nothing more fits.
        var full = await ReadSlicePayloadAsync<ProgressionPreviewView>(
            await P3PreviewAsync(coach, first.Id, grown.Version, [grown.Weeks.OrderBy(week => week.WeekNumber).Last().Id], 1));
        Assert.AreEqual(
            $"{inTheWay}, right after this program, so no new week fits. Move or cancel that program first.",
            full.OverlapMessage);
    }

    [TestMethod]
    public async Task A3TheSetSaveAndTheFinishSummaryAgreeOnRecordsWhenALiftIsPrescribedTwice()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        await RegisterCoachAsync(coach, "a3-records@example.test", "A3 Coach", "A3 Records Gym");
        var clientId = await InviteAndAcceptAsync(coach, client, "a3-records-client@example.test", newAccount: true);
        var enrollment = await CreateTrainingEnrollmentAsync(coach, clientId, TenantToday(), 8);
        var lift = await CreateExerciseAsync(coach, "Bulgarian split squat", [], []);
        object Prescription(int position, decimal load) => new
        {
            exerciseId = lift.Id,
            position,
            isMainLift = false,
            modificationPolicy = "CoachApprovedSwap",
            coachNotes = (string?)null,
            approvedAlternativeExerciseIds = Array.Empty<Guid>(),
            sets = new[] { P1Set(1, "Direct", rpe: 8m, reps: 8, direct: load) },
        };

        // A heavy top set, then the same lift again for a lighter back-off set.
        await RefreshCsrfAsync(coach);
        var created = await coach.PostAsJsonAsync("/api/training/templates", new
        {
            name = "Top and back-off",
            description = (string?)null,
            publish = true,
            templateVersion = (uint?)null,
            weeks = new[]
            {
                new
                {
                    label = "Week 1",
                    isPublished = true,
                    sessions = new[]
                    {
                        new
                        {
                            name = "Lower B",
                            dayOffset = 0,
                            coachNotes = (string?)null,
                            exercises = new[] { Prescription(1, 20m), Prescription(2, 15m) },
                        },
                    },
                },
            },
        });
        await AssertStatusAsync(created, HttpStatusCode.OK);
        var template = await RequiredJsonAsync<TemplateVersion>(created);
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync($"/api/training/clients/{clientId}/mesocycles", new
            {
                enrollmentId = enrollment.Id,
                templateVersionId = template.Id,
                startDate = TenantToday(),
                kind = "Primary",
                loadUnit = "Kilogram",
                loadIncrement = 2.5m,
                loadRoundingMode = "Nearest",
                workingMaxes = Array.Empty<object>(),
                idempotencyKey = Guid.NewGuid(),
            }),
            HttpStatusCode.OK);

        // The player lists the session's exercises in their order: the top set's first.
        var (workout, day) = await A3StartTodayAsync(client);
        var topSet = day.Exercises[0].Sets.Single().PerformanceId!.Value;
        var backOffSet = day.Exercises[1].Sets.Single().PerformanceId!.Value;
        Assert.AreEqual((20m, 15m), (day.Exercises[0].Sets.Single().PrescribedLoad, day.Exercises[1].Sets.Single().PrescribedLoad));

        // The top set is the first 8-rep load of the lift: a record. The back-off set is lighter: not one,
        // although nothing under its own prescription came before it.
        var first = await A3LogAsync(client, workout.Id, topSet, 8, 20m, 8m, workout.Version);
        Assert.IsTrue(first.IsPersonalRecord);
        var second = await A3LogAsync(client, workout.Id, backOffSet, 8, 15m, 7m, first.ExecutionVersion);
        Assert.IsFalse(second.IsPersonalRecord);

        // The finish summary and the history say the same, set by set.
        var finished = await A3FinishAsync(client, workout.Id, second.ExecutionVersion);
        Assert.AreEqual(topSet, finished.FinishSummary!.PersonalRecords.Single().SetPerformanceId);
        var history = await ReadSliceAsync<ClientWorkoutHistoryPage>(client, "/api/training/me/history");
        Assert.AreEqual(topSet, history.Items.Single().PersonalRecords.Single().SetPerformanceId);
    }

    [TestMethod]
    public async Task A3AWeightThatRoundsToNothingIsRefusedNamingItsSetInEveryPreviewAndAtAssignment()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "a3-zero", exerciseId =>
        [
            P2Week("Week 1", exerciseId, P1Set(1, "PercentageWorkingMax", rpe: null, percentage: 10m)),
        ]);
        var block = await P2AssignAsync(coach, scenario, [P2SavedMax(scenario)]);
        Assert.AreEqual(10m, P2Sets(block).Single().PrescribedLoad);
        const string Zero = "The weight works out to 1 kg, which rounds to 0 kg at the program's 2.5 kg step.";

        // A max update that leaves 10% at 1 kg: a refusal of that set, not "the program changed".
        StringAssert.Contains(
            await A3RefusalAsync(
                await P2PreviewAsync(coach, block.Id, block.Version, P2Change(scenario.Exercise.Id, value: 10m)),
                HttpStatusCode.BadRequest),
            $"Week 1, Week 1 squat, Competition squat, set 1: {Zero}");

        // A next block stepped down to 1%.
        StringAssert.Contains(
            await A3RefusalAsync(
                await P3PreviewAsync(coach, block.Id, block.Version, [block.Weeks.Single().Id], 1, percentage: -9m),
                HttpStatusCode.BadRequest),
            $"Week 1, copy 1, Week 1 squat, Competition squat, set 1: {Zero}");

        // An edit of the week down to 1%.
        var grid = P3bGrid(block, TenantToday());
        StringAssert.Contains(
            await A3RefusalAsync(
                await P3bPreviewAsync(
                    coach,
                    block.Id,
                    block.Version,
                    [P3bEditFirstSet(grid[0], set => set with { PercentageWorkingMax = 1m })]),
                HttpStatusCode.BadRequest),
            $"Week 1, Week 1 squat: Competition squat, set 1: {Zero}");

        // And a program written at 1%, assigned after this one.
        await RefreshCsrfAsync(coach);
        var tiny = await coach.PostAsJsonAsync("/api/training/templates", new
        {
            name = "Tiny",
            description = (string?)null,
            publish = true,
            templateVersion = (uint?)null,
            weeks = new[] { P2Week("Week 1", scenario.Exercise.Id, P1Set(1, "PercentageWorkingMax", rpe: null, percentage: 1m)) },
        });
        await AssertStatusAsync(tiny, HttpStatusCode.OK);
        var tinyTemplate = await RequiredJsonAsync<TemplateVersion>(tiny);
        await RefreshCsrfAsync(coach);
        var assigned = await coach.PostAsJsonAsync($"/api/training/clients/{scenario.ClientId}/mesocycles", new
        {
            enrollmentId = scenario.Enrollment.Id,
            templateVersionId = tinyTemplate.Id,
            startDate = TenantToday().AddDays(7),
            kind = "Primary",
            loadUnit = "Kilogram",
            loadIncrement = 2.5m,
            loadRoundingMode = "Nearest",
            workingMaxes = new[] { P2SavedMax(scenario) },
            idempotencyKey = Guid.NewGuid(),
        });
        StringAssert.Contains(
            await A3RefusalAsync(assigned, HttpStatusCode.BadRequest),
            $"Week 1, Week 1 squat: Competition squat, set 1: {Zero}");

        // Nothing changed.
        var after = await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id));
        Assert.AreEqual((block.Version, 10m), (after.Version, P2Sets(after).Single().PrescribedLoad));
    }

    [TestMethod]
    public async Task A3ALongWeekNameIsShortenedOnItsCopiesSoApplyTakesWhatThePreviewShowed()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        // 110 characters: within a week's limit of 120, but not once " - progression 1" is added.
        var longLabel = string.Concat(Enumerable.Repeat("Accumulation ", 9))[..110];
        var scenario = await P2CustomStartAsync(coach, client, "a3-label", exerciseId =>
        [
            P2Week(longLabel, exerciseId, P1Set(1, "RpeChart", rpe: 7m, reps: 5)),
        ]);
        var block = await P2AssignAsync(coach, scenario, [P2SavedMax(scenario)]);

        var preview = await P3PreviewOkAsync(coach, block, [block.Weeks.Single().Id], 1);
        var made = preview.GeneratedWeeks.Single().Label!;
        Assert.IsLessThanOrEqualTo(ProgramEditRules.MaximumLabelLength, made.Length);
        Assert.EndsWith("… - progression 1", made);
        Assert.StartsWith(longLabel[..100], made);

        var applied = await P3ApplyOkAsync(coach, block, [block.Weeks.Single().Id], 1, preview.PreviewHash);
        Assert.AreEqual(made, applied.Weeks.Single(week => week.WeekNumber == 2).Label);
    }

    [TestMethod]
    public async Task A3HowTheyHaveDoneReadsASetWithAnRpeOnTheChartAndNamesEachFormula()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "a3-estimate", exerciseId =>
        [
            P2Week(
                "Week 1",
                exerciseId,
                P1Set(1, "Direct", rpe: 8.5m, reps: 7, direct: 62.5m),
                P1Set(2, "Direct", rpe: 6m, reps: 5, direct: 60m),
                P1Set(3, "Direct", rpe: null, reps: 5, direct: 50m),
                P1Set(4, "Direct", rpe: null, reps: 10, direct: 20m)),
        ]);
        await P2AssignAsync(coach, scenario, []);
        var (workout, day) = await A3StartTodayAsync(client);
        var sets = day.Exercises.Single().Sets.OrderBy(set => set.Position).Select(set => set.PerformanceId!.Value).ToArray();

        // As logged: on the chart, below it, without an RPE, and with no weight at all.
        var version = workout.Version;
        version = (await A3LogAsync(client, workout.Id, sets[0], 7, 62.5m, 8.5m, version)).ExecutionVersion;
        version = (await A3LogAsync(client, workout.Id, sets[1], 5, 60m, 6m, version)).ExecutionVersion;
        version = (await A3LogAsync(client, workout.Id, sets[2], 5, 50m, null, version)).ExecutionVersion;
        version = (await A3LogAsync(client, workout.Id, sets[3], 10, 0m, null, version)).ExecutionVersion;
        await A3FinishAsync(client, workout.Id, version);

        var history = await ReadSliceAsync<ExerciseHistoryPage>(
            coach, $"/api/training/clients/{scenario.ClientId}/exercises/{scenario.Exercise.Id}/history");
        var byLoad = history.Items.ToDictionary(item => item.Load!.Value);
        Assert.HasCount(4, byLoad);

        // 62.5 kg x 7 at RPE 8.5 is 77.4% of the max on the chart: the number the maxes panel gives it.
        Assert.AreEqual((80.749m, "RpeChart"), (byLoad[62.5m].EstimatedOneRepMax, byLoad[62.5m].EstimateMethodKey));
        Assert.AreEqual((70m, "Epley"), (byLoad[60m].EstimatedOneRepMax, byLoad[60m].EstimateMethodKey));
        Assert.AreEqual((58.333m, "Epley"), (byLoad[50m].EstimatedOneRepMax, byLoad[50m].EstimateMethodKey));
        Assert.AreEqual(((decimal?)null, (string?)null), (byLoad[0m].EstimatedOneRepMax, byLoad[0m].EstimateMethodKey));
    }

    /// <summary>
    /// Every sentence of a refusal, decoded: a validation problem's errors or a conflict's message. The raw body
    /// escapes an apostrophe, so a sentence is compared only once it is read back.
    /// </summary>
    private static async Task<string> A3RefusalAsync(HttpResponseMessage response, HttpStatusCode status)
    {
        await AssertStatusAsync(response, status);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return string.Join(" | ", Strings(body.RootElement));

        static IEnumerable<string> Strings(JsonElement element) => element.ValueKind switch
        {
            JsonValueKind.String => [element.GetString()!],
            JsonValueKind.Object => element.EnumerateObject().SelectMany(property => Strings(property.Value)),
            JsonValueKind.Array => element.EnumerateArray().SelectMany(Strings),
            _ => [],
        };
    }
}
