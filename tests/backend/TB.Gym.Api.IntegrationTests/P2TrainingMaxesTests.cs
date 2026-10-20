using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using TB.Gym.Modules.Training;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// P2: each assigned program's own training maxes (STR-002, STR-011). A coach reads them, updates them for
/// the coming weeks after a preview (preview, hash and apply, STR-009), works a max out from week 1's weight
/// (TRN-026) and renames the program (TRN-002). History is kept: an update adds a superseding max and
/// changes only sessions that have not started and are not in the past.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private static string P2MaxesUrl(Guid mesocycleId) =>
        $"/api/training/mesocycles/{mesocycleId}/training-maxes";

    private static string P2MesocycleUrl(Guid mesocycleId) => $"/api/training/mesocycles/{mesocycleId}";

    private sealed record P2Scenario(
        Guid WorkspaceId,
        Guid ClientId,
        TrainingResources Resources,
        ScenarioMesocycle Block);

    /// <summary>A coach, a client on an eight-week plan, and a program of N weeks that starts today.</summary>
    private static async Task<P2Scenario> P2StartAsync(HttpClient coach, HttpClient client, string tag, int weeks)
    {
        var workspaceId = await RegisterCoachAsync(coach, $"{tag}@example.test", "P2 Coach", $"{tag} Gym");
        var clientId = await InviteAndAcceptAsync(coach, client, $"{tag}-client@example.test", newAccount: true);
        var resources = await CreateTrainingResourcesAsync(coach, clientId, 8, weeks, TenantToday());
        var block = await AssignAsync(coach, clientId, resources, TenantToday());
        return new P2Scenario(workspaceId, clientId, resources, block);
    }

    private sealed record P2Custom(
        Guid WorkspaceId,
        Guid ClientId,
        CoverageEnrollment Enrollment,
        Exercise Exercise,
        StrengthMax Max,
        TemplateVersion Template);

    private static object P2Week(string label, Guid exerciseId, params object[] sets) => new
    {
        label,
        isPublished = true,
        sessions = new[]
        {
            new
            {
                name = $"{label} squat",
                dayOffset = 0,
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
            },
        },
    };

    /// <summary>A coach and client with a recorded max of 100 kg and a published program built from the given weeks.</summary>
    private static async Task<P2Custom> P2CustomStartAsync(
        HttpClient coach,
        HttpClient client,
        string tag,
        Func<Guid, object[]> weeks)
    {
        var workspaceId = await RegisterCoachAsync(coach, $"{tag}@example.test", "P2 Coach", $"{tag} Gym");
        var clientId = await InviteAndAcceptAsync(coach, client, $"{tag}-client@example.test", newAccount: true);
        var enrollment = await CreateTrainingEnrollmentAsync(coach, clientId, TenantToday(), 8);
        var exercise = await CreateExerciseAsync(coach, "Competition squat", [], []);
        var max = await RecordWorkingMaxAsync(coach, clientId, exercise.Id, 100m);
        var template = await PublishProgramAsync(coach, new
        {
            name = $"{tag} program",
            description = (string?)null,
            weeks = weeks(exercise.Id),
        });
        return new P2Custom(workspaceId, clientId, enrollment, exercise, max, template);
    }

    private static object P2SavedMax(P2Custom scenario) => new
    {
        exerciseId = scenario.Exercise.Id,
        strengthMaxRecordId = (Guid?)scenario.Max.Id,
        value = (decimal?)100m,
        unit = "Kilogram",
        weekOneWeight = (decimal?)null,
    };

    private static object P2WeekOneMax(Guid exerciseId, decimal weight) => new
    {
        exerciseId,
        strengthMaxRecordId = (Guid?)null,
        value = (decimal?)null,
        unit = "Kilogram",
        weekOneWeight = (decimal?)weight,
    };

    private static object P2AssignRequest(P2Custom scenario, object[] workingMaxes, Guid key, string? name = null) => new
    {
        enrollmentId = scenario.Enrollment.Id,
        templateVersionId = scenario.Template.Id,
        startDate = TenantToday(),
        kind = "Primary",
        loadUnit = "Kilogram",
        loadIncrement = 2.5m,
        loadRoundingMode = "Nearest",
        workingMaxes,
        idempotencyKey = key,
        name,
    };

    private static async Task<HttpResponseMessage> P2TryAssignAsync(
        HttpClient coach,
        P2Custom scenario,
        object[] workingMaxes,
        Guid key,
        string? name = null)
    {
        await RefreshCsrfAsync(coach);
        return await coach.PostAsJsonAsync(
            $"/api/training/clients/{scenario.ClientId}/mesocycles",
            P2AssignRequest(scenario, workingMaxes, key, name));
    }

    private static async Task<TrainingMesocycleView> P2AssignAsync(
        HttpClient coach,
        P2Custom scenario,
        object[] workingMaxes,
        string? name = null)
    {
        var response = await P2TryAssignAsync(coach, scenario, workingMaxes, Guid.NewGuid(), name);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<TrainingMesocycleView>(response);
    }

    private static object P2Change(Guid exerciseId, decimal? value = null, decimal? weekOneWeight = null) =>
        new { exerciseId, value, weekOneWeight };

    private static async Task<HttpResponseMessage> P2PreviewAsync(
        HttpClient coach,
        Guid mesocycleId,
        uint version,
        params object[] changes)
    {
        await RefreshCsrfAsync(coach);
        return await coach.PostAsJsonAsync(
            $"{P2MaxesUrl(mesocycleId)}/preview",
            new { mesocycleVersion = version, changes });
    }

    private static async Task<TrainingMaxesPreviewView> P2PreviewOkAsync(
        HttpClient coach,
        Guid mesocycleId,
        uint version,
        params object[] changes)
    {
        var response = await P2PreviewAsync(coach, mesocycleId, version, changes);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<TrainingMaxesPreviewView>(response);
    }

    private static async Task<HttpResponseMessage> P2ApplyAsync(
        HttpClient coach,
        Guid mesocycleId,
        uint version,
        object[] changes,
        string? reason,
        string previewHash,
        Guid key)
    {
        await RefreshCsrfAsync(coach);
        return await coach.PostAsJsonAsync(
            $"{P2MaxesUrl(mesocycleId)}/apply",
            new { mesocycleVersion = version, changes, reason, previewHash, idempotencyKey = key });
    }

    private static async Task<TrainingMesocycleView> P2ApplyOkAsync(
        HttpClient coach,
        Guid mesocycleId,
        uint version,
        object[] changes,
        string? reason,
        string previewHash,
        Guid key)
    {
        var response = await P2ApplyAsync(coach, mesocycleId, version, changes, reason, previewHash, key);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<TrainingMesocycleView>(response);
    }

    private static async Task P2RefusedAsync(HttpResponseMessage response, HttpStatusCode status, string text)
    {
        await AssertStatusAsync(response, status);
        StringAssert.Contains(await response.Content.ReadAsStringAsync(), text);
    }

    private static SetPrescriptionView[] P2Sets(TrainingMesocycleView view) =>
        view.Weeks
            .OrderBy(week => week.WeekNumber)
            .SelectMany(week => week.Sessions.OrderBy(session => session.Position))
            .SelectMany(session => session.Exercises.OrderBy(exercise => exercise.Position))
            .SelectMany(exercise => exercise.Sets.OrderBy(set => set.Position))
            .ToArray();

    private async Task<long> P2CountAsync(string sql, Guid id) =>
        await Phase6CountAsync(RequiredDatabaseConnection, sql, id);

    [TestMethod]
    public async Task P2AProgramListsEachLiftsTrainingMaxWithItsSourceAndTheSetWeekOneWouldUse()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2StartAsync(coach, client, "p2-read", 3);
        var maxes = await ReadSliceAsync<TrainingMaxesView>(coach, P2MaxesUrl(scenario.Block.Id));

        // The program's own rounding step travels with its unit, so a suggestion can be said in it (R5.4c).
        Assert.AreEqual(
            (scenario.Block.Id, scenario.Block.Version, false, TrainingLoadUnit.Kilogram, 2.5m),
            (maxes.MesocycleId, maxes.Version, maxes.IsClosed, maxes.LoadUnit, maxes.LoadIncrement));
        var lift = maxes.Maxes.Single();
        Assert.AreEqual(scenario.Resources.Exercise.Id, lift.ExerciseId);
        Assert.AreEqual(
            (100m, TrainingMaxSource.SavedMax, 1),
            (lift.Current.Value, lift.Current.Source, lift.Current.EffectiveFromWeek));
        Assert.AreEqual(TenantToday(), lift.Current.SetOn);
        Assert.IsNull(lift.Current.Basis);
        Assert.IsEmpty(lift.Earlier);

        // "From week 1's weight" would read the first working set: 5 reps at RPE 8, at the weight it has now.
        Assert.IsNotNull(lift.WeekOneSet);
        Assert.AreEqual((5, 8m, (decimal?)80m), (lift.WeekOneSet.Repetitions, lift.WeekOneSet.Rpe, lift.WeekOneSet.Load));
    }

    [TestMethod]
    public async Task P2UpdatingAMaxShowsEveryChangedWeightFirstThenAddsASupersedingMaxAndKeepsTheOldOne()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2StartAsync(coach, client, "p2-update", 3);
        var block = scenario.Block;
        var changes = new[] { P2Change(scenario.Resources.Exercise.Id, value: 120m) };

        var preview = await P2PreviewOkAsync(coach, block.Id, block.Version, changes);
        var change = preview.Lifts.Single();
        Assert.AreEqual((100m, 120m, TrainingMaxSource.Typed), (change.PreviousValue, change.NewValue, change.Source));
        Assert.IsNull(change.Basis);
        Assert.AreEqual("Typed by the coach: 120 kg.", change.Explanation);
        Assert.AreEqual((3, 0, 3, 0, 1), (
            preview.ChangedSetCount,
            preview.UnchangedSetCount,
            preview.SessionCount,
            preview.KeptSessionCount,
            preview.EffectiveFromWeek));
        Assert.HasCount(3, preview.Sets);
        foreach (var set in preview.Sets)
        {
            Assert.AreEqual(((decimal?)80m, 97.5m), (set.PreviousLoad, set.NewLoad));
        }

        StringAssert.Contains(
            preview.Sets[0].Explanation,
            "WorkingMaxLoad v2: 120 kg / (1 + (5 reps + 2 in reserve) / 30) = 97.297 kg.");
        StringAssert.Contains(preview.Sets[0].Explanation, "Rounded to the nearest 2.5 kg: 97.5 kg.");

        // A preview saves nothing.
        var untouched = await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id));
        Assert.AreEqual(block.Version, untouched.Version);
        Assert.HasCount(1, untouched.WorkingMaxes);

        var applied = await P2ApplyOkAsync(
            coach, block.Id, block.Version, changes, "New test result", preview.PreviewHash, Guid.NewGuid());
        Assert.HasCount(2, applied.WorkingMaxes);
        var first = applied.WorkingMaxes.Single(item => item.SupersedesSnapshotId is null);
        var current = applied.WorkingMaxes.Single(item => item.SupersedesSnapshotId is not null);
        Assert.AreEqual((100m, 1, TrainingMaxSource.SavedMax), (first.Value, first.EffectiveFromWeek, first.Source));
        Assert.AreEqual(
            (120m, 1, TrainingMaxSource.Typed, (Guid?)first.Id, "New test result"),
            (current.Value, current.EffectiveFromWeek, current.Source, current.SupersedesSnapshotId, current.Reason));
        foreach (var set in P2Sets(applied))
        {
            Assert.AreEqual(((decimal?)97.5m, (Guid?)current.Id), (set.PrescribedLoad, set.WorkingMaxSnapshotId));
        }

        Assert.AreNotEqual(block.Version, applied.Version);

        // The old max stays in the program's history, and the page can read both.
        var after = await ReadSliceAsync<TrainingMaxesView>(coach, P2MaxesUrl(block.Id));
        Assert.AreEqual(applied.Version, after.Version);
        var lift = after.Maxes.Single();
        Assert.AreEqual((120m, TrainingMaxSource.Typed), (lift.Current.Value, lift.Current.Source));
        var earlier = lift.Earlier.Single();
        Assert.AreEqual(
            (100m, TrainingMaxSource.SavedMax, 1),
            (earlier.Value, earlier.Source, earlier.EffectiveFromWeek));
        Assert.AreEqual(
            1L,
            await P2CountAsync(
                """SELECT count(*) FROM strength."WorkingMaxUpdates" WHERE "MesocycleId" = @id AND "LiftCount" = 1 AND "SetCount" = 3 AND "SessionCount" = 3""",
                block.Id));
    }

    [TestMethod]
    public async Task P2OnlySessionsNotStartedAndNotInThePastFollowTheNewMax()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2StartAsync(coach, client, "p2-scope", 3);
        var block = scenario.Block;
        var before = await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id));

        // The client starts week 1's workout; week 2's day then goes by without one.
        var weekOne = before.Weeks.OrderBy(week => week.WeekNumber).First().Sessions.Single();
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsync($"/api/training/me/sessions/{weekOne.Id}/start", null),
            HttpStatusCode.OK);
        RequiredTestClock.Advance(TimeSpan.FromDays(8));

        var current = await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id));
        var changes = new[] { P2Change(scenario.Resources.Exercise.Id, value: 120m) };
        var preview = await P2PreviewOkAsync(coach, block.Id, current.Version, changes);

        // Only week 3 follows the new max; the started and the missed session keep what they were given.
        Assert.AreEqual((1, 0, 1, 2, 3), (
            preview.ChangedSetCount,
            preview.UnchangedSetCount,
            preview.SessionCount,
            preview.KeptSessionCount,
            preview.EffectiveFromWeek));

        var applied = await P2ApplyOkAsync(
            coach, block.Id, current.Version, changes, null, preview.PreviewHash, Guid.NewGuid());
        var sets = P2Sets(applied);
        CollectionAssert.AreEqual(new decimal?[] { 80m, 80m, 97.5m }, sets.Select(set => set.PrescribedLoad).ToArray());
        var first = applied.WorkingMaxes.Single(item => item.SupersedesSnapshotId is null);
        var newest = applied.WorkingMaxes.Single(item => item.SupersedesSnapshotId is not null);
        Assert.AreEqual((3, "Training max updated by the coach."), (newest.EffectiveFromWeek, newest.Reason));
        CollectionAssert.AreEqual(
            new Guid?[] { first.Id, first.Id, newest.Id },
            sets.Select(set => set.WorkingMaxSnapshotId).ToArray());
    }

    [TestMethod]
    public async Task P2TypedAndManualWeightsNeverFollowAMaxOnlyCalculatedOnesDo()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "p2-typed", exerciseId =>
        [
            P2Week(
                "Week 1",
                exerciseId,
                P1Set(1, "PercentageWorkingMax", rpe: null, percentage: 70m),
                P1Set(2, "RpeChart", rpe: 7m),
                P1Set(3, "Direct", rpe: null, direct: 100m),
                P1Set(4, "PercentageWorkingMax", rpe: null, percentage: 80m, manual: 102.5m),
                P1Set(5, "Direct", rpe: null, direct: 60m, setType: "WarmUp")),
        ]);
        var block = await P2AssignAsync(coach, scenario, [P2SavedMax(scenario)]);
        CollectionAssert.AreEqual(
            new decimal?[] { 70m, 77.5m, 100m, 102.5m, 60m },
            P2Sets(block).Select(set => set.PrescribedLoad).ToArray());

        var changes = new[] { P2Change(scenario.Exercise.Id, value: 120m) };
        var preview = await P2PreviewOkAsync(coach, block.Id, block.Version, changes);
        Assert.AreEqual((2, 1), (preview.ChangedSetCount, preview.SessionCount));
        Assert.HasCount(2, preview.Sets);
        Assert.AreEqual((1, 2), (preview.Sets[0].SetPosition, preview.Sets[1].SetPosition));

        var applied = await P2ApplyOkAsync(
            coach, block.Id, block.Version, changes, null, preview.PreviewHash, Guid.NewGuid());
        var sets = P2Sets(applied);
        // 70% of 120 is 84, and the chart's 5 reps at RPE 7 is 78.6%, so 94.32; both round to 2.5.
        CollectionAssert.AreEqual(
            new decimal?[] { 85m, 95m, 100m, 102.5m, 60m },
            sets.Select(set => set.PrescribedLoad).ToArray());
        Assert.IsTrue(sets[3].IsManualLoadOverride);
        Assert.AreEqual("ManualCoachOverride", sets[3].CalculationStrategyKey);
        Assert.IsNull(sets[2].WorkingMaxSnapshotId);
    }

    [TestMethod]
    public async Task P2AMaxWorkedOutFromWeekOneWeightKeepsTheSetItCameFromAndFollowsLaterUpdates()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "p2-weekone", exerciseId =>
        [
            P2Week(
                "Week 1",
                exerciseId,
                P1Set(1, "RpeChart", rpe: 7m, reps: 5),
                P1Set(2, "RpeChart", rpe: 8m, reps: 3)),
            P2Week("Week 2", exerciseId, P1Set(1, "RpeChart", rpe: 7m, reps: 5)),
        ]);

        // Assigned from the weight the coach uses for week 1's first set: 110 kg for 5 reps at RPE 7 is 78.6%.
        var block = await P2AssignAsync(coach, scenario, [P2WeekOneMax(scenario.Exercise.Id, 110m)]);
        var snapshot = block.WorkingMaxes.Single();
        Assert.AreEqual((139.949m, TrainingMaxSource.WeekOneWeight), (snapshot.Value, snapshot.Source));
        Assert.IsNull(snapshot.SourceMaxRecordId);
        Assert.AreEqual(
            "Assignment training max worked out from week 1's weight: 110 kg for 5 reps at RPE 7.",
            snapshot.Reason);
        CollectionAssert.AreEqual(
            new decimal?[] { 110m, 120m, 110m },
            P2Sets(block).Select(set => set.PrescribedLoad).ToArray());

        var read = await ReadSliceAsync<TrainingMaxesView>(coach, P2MaxesUrl(block.Id));
        var lift = read.Maxes.Single();
        var basis = lift.Current.Basis;
        Assert.IsNotNull(basis);
        Assert.AreEqual((110m, 5, 7m, "RpeChart", "1.0"), (basis.Load, basis.Repetitions, basis.Rpe, basis.MethodKey, basis.MethodVersion));
        Assert.AreEqual((5, 7m, (decimal?)110m), (lift.WeekOneSet!.Repetitions, lift.WeekOneSet.Rpe, lift.WeekOneSet.Load));

        // Later the coach raises that set to 115 kg: the chart reads it backwards again.
        var changes = new[] { P2Change(scenario.Exercise.Id, weekOneWeight: 115m) };
        var preview = await P2PreviewOkAsync(coach, block.Id, block.Version, changes);
        var change = preview.Lifts.Single();
        Assert.AreEqual((139.949m, 146.31m, TrainingMaxSource.WeekOneWeight), (change.PreviousValue, change.NewValue, change.Source));
        Assert.IsNotNull(change.Basis);
        Assert.AreEqual((115m, 5, 7m), (change.Basis.Load, change.Basis.Repetitions, change.Basis.Rpe));
        Assert.AreEqual(
            "RTS RPE chart v1: 5 reps at RPE 7 is 78.6% of the max, so 115 kg / 78.6% = 146.31 kg.",
            change.Explanation);
        Assert.AreEqual(3, preview.ChangedSetCount);

        var applied = await P2ApplyOkAsync(
            coach, block.Id, block.Version, changes, null, preview.PreviewHash, Guid.NewGuid());
        CollectionAssert.AreEqual(
            new decimal?[] { 115m, 127.5m, 115m },
            P2Sets(applied).Select(set => set.PrescribedLoad).ToArray());
        var newest = applied.WorkingMaxes.Single(item => item.SupersedesSnapshotId is not null);
        Assert.AreEqual((146.31m, TrainingMaxSource.WeekOneWeight), (newest.Value, newest.Source));
        StringAssert.Contains(newest.Reason, "115 kg for 5 reps at RPE 7");

        // The week's own set can say nothing the chart covers, and then there is nothing to read backwards.
        using var otherCoach = CreateClient();
        using var otherClient = CreateClient();
        var uncovered = await P2CustomStartAsync(otherCoach, otherClient, "p2-uncovered", exerciseId =>
        [
            P2Week("Week 1", exerciseId, P1Set(1, "RpeBasedEpley", rpe: 6m, reps: 5)),
        ]);
        await P2RefusedAsync(
            await P2TryAssignAsync(otherCoach, uncovered, [P2WeekOneMax(uncovered.Exercise.Id, 100m)], Guid.NewGuid()),
            HttpStatusCode.BadRequest,
            "the RTS chart covers");

        // A max is a number or week 1's weight, never both and never neither.
        await P2RefusedAsync(
            await P2TryAssignAsync(
                otherCoach,
                uncovered,
                [new { exerciseId = uncovered.Exercise.Id, strengthMaxRecordId = (Guid?)null, value = (decimal?)100m, unit = "Kilogram", weekOneWeight = (decimal?)100m }],
                Guid.NewGuid()),
            HttpStatusCode.BadRequest,
            "either a number or week 1");
    }

    [TestMethod]
    public async Task P2AnUpdateThatChangesNothingOrBreaksALimitIsRefusedWithTheReason()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2StartAsync(coach, client, "p2-refuse", 2);
        var block = scenario.Block;
        var squat = scenario.Resources.Exercise.Id;

        async Task RefusedAsync(string text, params object[] changes) =>
            await P2RefusedAsync(
                await P2PreviewAsync(coach, block.Id, block.Version, changes),
                HttpStatusCode.BadRequest,
                text);

        await RefusedAsync("already in use", P2Change(squat, value: 100m));
        await RefusedAsync("does not use a training max in this program", P2Change(Guid.NewGuid(), value: 120m));
        await RefusedAsync("either a training max or week 1", P2Change(squat, value: 120m, weekOneWeight: 100m));
        await RefusedAsync("either a training max or week 1", P2Change(squat));
        await RefusedAsync("at most 2,000", P2Change(squat, value: 0m));
        await RefusedAsync("at most 2,000", P2Change(squat, value: 2_000.5m));
        await RefusedAsync("once, for 1 to 40 lifts", P2Change(squat, value: 120m), P2Change(squat, value: 125m));
        await RefusedAsync("once, for 1 to 40 lifts");

        // Nothing above saved anything.
        var untouched = await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id));
        Assert.AreEqual(block.Version, untouched.Version);
        Assert.HasCount(1, untouched.WorkingMaxes);
    }

    [TestMethod]
    public async Task P2AStalePreviewOrAProgramChangedSincePreviewIsRefusedAndSavesNothing()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2StartAsync(coach, client, "p2-stale", 3);
        var block = scenario.Block;
        var squat = scenario.Resources.Exercise.Id;
        var changes = new[] { P2Change(squat, value: 120m) };
        var preview = await P2PreviewOkAsync(coach, block.Id, block.Version, changes);

        // The version the page holds is not the program's.
        await P2RefusedAsync(
            await P2PreviewAsync(coach, block.Id, block.Version + 1, changes),
            HttpStatusCode.Conflict,
            "training_maxes_conflict");

        // The hash proves what was reviewed: other numbers with the old hash are refused.
        var other = new[] { P2Change(squat, value: 125m) };
        await P2RefusedAsync(
            await P2ApplyAsync(coach, block.Id, block.Version, other, null, preview.PreviewHash, Guid.NewGuid()),
            HttpStatusCode.Conflict,
            "training_maxes_preview_changed");
        await P2RefusedAsync(
            await P2ApplyAsync(coach, block.Id, block.Version, changes, null, new string('0', 64), Guid.NewGuid()),
            HttpStatusCode.Conflict,
            "training_maxes_preview_changed");

        // The program changes after the preview (a week is un-shared), so the preview is out of date.
        var week = (await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id))).Weeks[0];
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PutAsJsonAsync(
                $"/api/training/mesocycles/{block.Id}/weeks/{week.Id}/publish",
                new { isPublished = false, version = block.Version }),
            HttpStatusCode.OK);
        await P2RefusedAsync(
            await P2ApplyAsync(coach, block.Id, block.Version, changes, null, preview.PreviewHash, Guid.NewGuid()),
            HttpStatusCode.Conflict,
            "training_maxes_conflict");

        var after = await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id));
        Assert.HasCount(1, after.WorkingMaxes);
        Assert.IsTrue(P2Sets(after).All(set => set.PrescribedLoad == 80m));
        Assert.AreEqual(0L, await P2CountAsync("""SELECT count(*) FROM strength."WorkingMaxUpdates" WHERE "MesocycleId" = @id""", block.Id));
    }

    [TestMethod]
    public async Task P2ARetryAnswersWithTheFirstResultAndAReusedKeyForAnotherUpdateConflicts()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2StartAsync(coach, client, "p2-retry", 3);
        var block = scenario.Block;
        var squat = scenario.Resources.Exercise.Id;
        var changes = new[] { P2Change(squat, value: 120m) };
        var preview = await P2PreviewOkAsync(coach, block.Id, block.Version, changes);
        var key = Guid.NewGuid();

        var first = await P2ApplyOkAsync(coach, block.Id, block.Version, changes, "Retest", preview.PreviewHash, key);
        var retry = await P2ApplyOkAsync(coach, block.Id, block.Version, changes, "Retest", preview.PreviewHash, key);
        Assert.AreEqual(first.Version, retry.Version);
        Assert.HasCount(2, retry.WorkingMaxes);
        Assert.AreEqual(
            1L,
            await P2CountAsync("""SELECT count(*) FROM strength."WorkingMaxUpdates" WHERE "MesocycleId" = @id""", block.Id));
        Assert.AreEqual(
            2L,
            await P2CountAsync("""SELECT count(*) FROM strength."WorkingMaxSnapshots" WHERE "MesocycleId" = @id""", block.Id));

        // The same key is bound to the same request: another number, or another reason, is a conflict.
        await P2RefusedAsync(
            await P2ApplyAsync(
                coach, block.Id, first.Version, [P2Change(squat, value: 125m)], "Retest", preview.PreviewHash, key),
            HttpStatusCode.Conflict,
            "idempotency_conflict");
        await P2RefusedAsync(
            await P2ApplyAsync(coach, block.Id, block.Version, changes, "Another reason", preview.PreviewHash, key),
            HttpStatusCode.Conflict,
            "idempotency_conflict");
    }

    [TestMethod]
    public async Task P2TwoUpdatesRacingForTheSameMaxLetExactlyOneWinAndTheSameKeyRacesAgainstItself()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2StartAsync(coach, client, "p2-race", 3);
        var block = scenario.Block;
        var squat = scenario.Resources.Exercise.Id;
        var changes = new[] { P2Change(squat, value: 120m) };
        var preview = await P2PreviewOkAsync(coach, block.Id, block.Version, changes);

        // Two different requests for the same version: one wins, the other is told the program moved on.
        await RefreshCsrfAsync(coach);
        var attempts = await Task.WhenAll(
            Enumerable.Range(0, 2).Select(_ => coach.PostAsJsonAsync(
                $"{P2MaxesUrl(block.Id)}/apply",
                new
                {
                    mesocycleVersion = block.Version,
                    changes,
                    reason = (string?)null,
                    previewHash = preview.PreviewHash,
                    idempotencyKey = Guid.NewGuid(),
                })));
        CollectionAssert.AreEquivalent(
            new[] { HttpStatusCode.OK, HttpStatusCode.Conflict },
            attempts.Select(response => response.StatusCode).ToArray());
        Assert.AreEqual(
            2L,
            await P2CountAsync("""SELECT count(*) FROM strength."WorkingMaxSnapshots" WHERE "MesocycleId" = @id""", block.Id));
        Assert.AreEqual(
            1L,
            await P2CountAsync("""SELECT count(*) FROM strength."WorkingMaxUpdates" WHERE "MesocycleId" = @id""", block.Id));

        // One request sent twice at once with one key: both are answered, and the update is made once.
        var current = await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id));
        var next = new[] { P2Change(squat, value: 125m) };
        var nextPreview = await P2PreviewOkAsync(coach, block.Id, current.Version, next);
        var key = Guid.NewGuid();
        await RefreshCsrfAsync(coach);
        var twins = await Task.WhenAll(
            Enumerable.Range(0, 2).Select(_ => coach.PostAsJsonAsync(
                $"{P2MaxesUrl(block.Id)}/apply",
                new
                {
                    mesocycleVersion = current.Version,
                    changes = next,
                    reason = (string?)null,
                    previewHash = nextPreview.PreviewHash,
                    idempotencyKey = key,
                })));
        foreach (var twin in twins)
        {
            await AssertStatusAsync(twin, HttpStatusCode.OK);
        }

        Assert.AreEqual(
            3L,
            await P2CountAsync("""SELECT count(*) FROM strength."WorkingMaxSnapshots" WHERE "MesocycleId" = @id""", block.Id));
        Assert.AreEqual(
            2L,
            await P2CountAsync("""SELECT count(*) FROM strength."WorkingMaxUpdates" WHERE "MesocycleId" = @id""", block.Id));
    }

    [TestMethod]
    public async Task P2TrainingMaxesAreForSignedInStaffOfThatWorkspaceAndTheDatabaseKeepsEachLiftsMaxesInOneChain()
    {
        using var owner = CreateClient();
        using var client = CreateClient();
        var scenario = await P2StartAsync(owner, client, "p2-auth", 2);
        var block = scenario.Block;
        var squat = scenario.Resources.Exercise.Id;
        var changes = new[] { P2Change(squat, value: 120m) };

        using var anonymous = CreateClient();
        await RefreshCsrfAsync(anonymous);
        await AssertStatusAsync(await anonymous.GetAsync(P2MaxesUrl(block.Id)), HttpStatusCode.Unauthorized);
        await AssertStatusAsync(
            await anonymous.PostAsJsonAsync($"{P2MaxesUrl(block.Id)}/preview", new { mesocycleVersion = block.Version, changes }),
            HttpStatusCode.Unauthorized);

        // Signed in without the antiforgery token a write is refused, even one that saves nothing.
        using var noToken = CreateClient();
        await RegisterCoachAsync(noToken, "p2-auth-token@example.test", "P2 Token", "P2 Token Gym");
        noToken.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
        await AssertStatusAsync(
            await noToken.PostAsJsonAsync($"{P2MaxesUrl(block.Id)}/preview", new { mesocycleVersion = block.Version, changes }),
            HttpStatusCode.BadRequest);

        // A coach of another workspace is refused when naming this one, and cannot see it from their own.
        using var stranger = CreateClient();
        var strangerWorkspace = await RegisterCoachAsync(stranger, "p2-auth-stranger@example.test", "P2 Stranger", "P2 Stranger Gym");
        SetTenant(stranger, scenario.WorkspaceId);
        await AssertStatusAsync(await stranger.GetAsync(P2MaxesUrl(block.Id)), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await P2PreviewAsync(stranger, block.Id, block.Version, changes), HttpStatusCode.Forbidden);
        SetTenant(stranger, strangerWorkspace);
        await AssertStatusAsync(await stranger.GetAsync(P2MaxesUrl(block.Id)), HttpStatusCode.NotFound);
        await AssertStatusAsync(await P2PreviewAsync(stranger, block.Id, block.Version, changes), HttpStatusCode.NotFound);
        await AssertStatusAsync(
            await P2ApplyAsync(stranger, block.Id, block.Version, changes, null, new string('a', 64), Guid.NewGuid()),
            HttpStatusCode.NotFound);

        // The client of the workspace is not staff.
        SetTenant(client, scenario.WorkspaceId);
        await AssertStatusAsync(await client.GetAsync(P2MaxesUrl(block.Id)), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await P2PreviewAsync(client, block.Id, block.Version, changes), HttpStatusCode.Forbidden);

        // The owner is served, and an update the client cannot make is made.
        var preview = await P2PreviewOkAsync(owner, block.Id, block.Version, changes);
        var applied = await P2ApplyOkAsync(owner, block.Id, block.Version, changes, null, preview.PreviewHash, Guid.NewGuid());
        var first = applied.WorkingMaxes.Single(item => item.SupersedesSnapshotId is null);
        var newest = applied.WorkingMaxes.Single(item => item.SupersedesSnapshotId is not null);

        // Whatever reaches the table, a lift's maxes are one chain: one first max, and each superseded once.
        await AssertSqlStateAsync(
            "23505",
            P2CopySnapshotSql(first.Id, "r.\"Id\" := gen_random_uuid();"));
        await AssertSqlStateAsync(
            "23505",
            P2CopySnapshotSql(newest.Id, "r.\"Id\" := gen_random_uuid();"));
        // A max worked out from week 1's weight keeps its whole basis or none of it.
        await AssertSqlStateAsync(
            "23514",
            P2CopySnapshotSql(
                newest.Id,
                $"r.\"Id\" := gen_random_uuid(); r.\"SupersedesSnapshotId\" := '{first.Id}'; r.\"BasisLoad\" := 100;"));

        // The record of an update is append-only, like the maxes it made.
        await AssertSqlStateAsync("55000", "UPDATE strength.\"WorkingMaxUpdates\" SET \"Reason\" = 'edited'");
        await AssertSqlStateAsync("55000", "DELETE FROM strength.\"WorkingMaxUpdates\"");
    }

    private static string P2CopySnapshotSql(Guid snapshotId, string change) =>
        $$"""
        DO $$
        DECLARE r strength."WorkingMaxSnapshots"%ROWTYPE;
        BEGIN
            SELECT * INTO r FROM strength."WorkingMaxSnapshots" WHERE "Id" = '{{snapshotId}}';
            {{change}}
            INSERT INTO strength."WorkingMaxSnapshots" SELECT r.*;
        END $$;
        """;

    [TestMethod]
    public async Task P2RenamingChangesOnlyTheNameAndAProgramCanBeNamedWhenItIsAssigned()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "p2-rename", exerciseId =>
        [
            P2Week("Week 1", exerciseId, P1Set(1, "RpeChart", rpe: 7m, reps: 5)),
        ]);

        // Without a name the program keeps its template's; with one, the client's copy carries it.
        var plain = await P2AssignAsync(coach, scenario, [P2SavedMax(scenario)]);
        Assert.AreEqual("p2-rename program", plain.Name);
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync($"/api/training/mesocycles/{plain.Id}/cancel", new { reason = "Start again", version = plain.Version }),
            HttpStatusCode.OK);

        var key = Guid.NewGuid();
        var firstTry = await P2TryAssignAsync(coach, scenario, [P2SavedMax(scenario)], key, "Peaking block");
        await AssertStatusAsync(firstTry, HttpStatusCode.OK);
        var block = await ReadSlicePayloadAsync<TrainingMesocycleView>(firstTry);
        Assert.AreEqual("Peaking block", block.Name);

        // Sent again with the same key it is the same assignment; with another name it is not.
        var again = await P2TryAssignAsync(coach, scenario, [P2SavedMax(scenario)], key, "Peaking block");
        await AssertStatusAsync(again, HttpStatusCode.OK);
        Assert.AreEqual(block.Id, (await ReadSlicePayloadAsync<TrainingMesocycleView>(again)).Id);
        await P2RefusedAsync(
            await P2TryAssignAsync(coach, scenario, [P2SavedMax(scenario)], key, "Another name"),
            HttpStatusCode.Conflict,
            "idempotency_conflict");

        async Task<HttpResponseMessage> RenameAsync(string name, uint version)
        {
            await RefreshCsrfAsync(coach);
            return await coach.PutAsJsonAsync($"/api/training/mesocycles/{block.Id}/name", new { name, version });
        }

        var renamed = await RenameAsync("  Peaking: weeks 1 to 4  ", block.Version);
        await AssertStatusAsync(renamed, HttpStatusCode.OK);
        var view = await ReadSlicePayloadAsync<TrainingMesocycleView>(renamed);
        Assert.AreEqual("Peaking: weeks 1 to 4", view.Name);
        // Where it came from and when it runs do not change; the change is on the record.
        Assert.AreEqual(
            (block.SourceTemplateId, block.SourceTemplateVersionId, block.StartDate, block.EnrollmentId),
            (view.SourceTemplateId, view.SourceTemplateVersionId, view.StartDate, view.EnrollmentId));
        Assert.AreNotEqual(block.Version, view.Version);
        var renamedEvent = view.Lifecycle.Single(item => item.EventType == MesocycleLifecycleEventType.Renamed);
        Assert.AreEqual("Renamed from \"Peaking block\" to \"Peaking: weeks 1 to 4\".", renamedEvent.Reason);
        Assert.AreEqual(renamedEvent.FromStatus, renamedEvent.ToStatus);

        // The same name again changes nothing, and writes nothing.
        var same = await ReadSlicePayloadAsync<TrainingMesocycleView>(await RenameAsync("Peaking: weeks 1 to 4", view.Version));
        Assert.AreEqual(view.Version, same.Version);
        Assert.AreEqual(1, same.Lifecycle.Count(item => item.EventType == MesocycleLifecycleEventType.Renamed));

        await P2RefusedAsync(await RenameAsync("   ", view.Version), HttpStatusCode.BadRequest, "Give the program a name");
        await P2RefusedAsync(await RenameAsync(new string('x', 161), view.Version), HttpStatusCode.BadRequest, "160 characters");
        await P2RefusedAsync(await RenameAsync("Late name", block.Version), HttpStatusCode.Conflict, "concurrency_conflict");

        // A closed program keeps its name.
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync($"/api/training/mesocycles/{block.Id}/cancel", new { reason = "Changed plan", version = view.Version }),
            HttpStatusCode.OK);
        var cancelled = await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id));
        await P2RefusedAsync(await RenameAsync("Too late", cancelled.Version), HttpStatusCode.Conflict, "program_closed");
        Assert.AreEqual("Peaking: weeks 1 to 4", cancelled.Name);
    }

    [TestMethod]
    public async Task P2TheChartReadBackwardsGivesTheMaxAWeightImpliesAndRefusesWhatItDoesNotCover()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "p2-estimate@example.test", "P2 Coach", "P2 Estimate Gym");

        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync(
            "/api/strength/estimate-max-from-rpe",
            new { load = 110m, repetitions = 5, rpe = 7m, unit = "Kilogram" });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        var estimate = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.AreEqual(139.949m, estimate.GetProperty("value").GetDecimal());
        Assert.AreEqual(78.6m, estimate.GetProperty("percent").GetDecimal());
        Assert.AreEqual("RpeChart", estimate.GetProperty("methodKey").GetString());
        Assert.AreEqual("1.0", estimate.GetProperty("methodVersion").GetString());
        Assert.AreEqual(
            "RTS RPE chart v1: 5 reps at RPE 7 is 78.6% of the max, so 110 kg / 78.6% = 139.949 kg.",
            estimate.GetProperty("explanation").GetString());

        // Pounds stay pounds.
        await RefreshCsrfAsync(coach);
        var pounds = await coach.PostAsJsonAsync(
            "/api/strength/estimate-max-from-rpe",
            new { load = 225m, repetitions = 3, rpe = 8m, unit = "Pound" });
        await AssertStatusAsync(pounds, HttpStatusCode.OK);
        StringAssert.Contains(
            (await pounds.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("explanation").GetString(),
            "225 lb / 86.3%");

        // Outside the chart there is nothing to read: it is never extrapolated.
        foreach (var body in new object[]
        {
            new { load = 100m, repetitions = 5, rpe = 6m, unit = "Kilogram" },
            new { load = 100m, repetitions = 13, rpe = 8m, unit = "Kilogram" },
            new { load = 0m, repetitions = 5, rpe = 8m, unit = "Kilogram" },
        })
        {
            await RefreshCsrfAsync(coach);
            await AssertStatusAsync(
                await coach.PostAsJsonAsync("/api/strength/estimate-max-from-rpe", body),
                HttpStatusCode.BadRequest);
        }

        using var anonymous = CreateClient();
        await RefreshCsrfAsync(anonymous);
        await AssertStatusAsync(
            await anonymous.PostAsJsonAsync(
                "/api/strength/estimate-max-from-rpe",
                new { load = 110m, repetitions = 5, rpe = 7m, unit = "Kilogram" }),
            HttpStatusCode.Unauthorized);
    }
}
