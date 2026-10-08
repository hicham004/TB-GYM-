using System.Net;
using System.Net.Http.Json;
using TB.Gym.Modules.Training;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// P4b: the training max a client's logged sets suggest (ADR 0036, STR-007, BestLoggedSet v1). The Training
/// maxes panel shows it; the coach applies it through the P2 preview, and the server works the number out
/// again from the set itself. It never changes a max on its own, reads only finished working sets in the
/// program's unit, and is for the client's own coach while the client is still coached here.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private sealed record P4bLog(int? Reps, decimal? Load, string? Unit, decimal? Rpe, bool Completed = true);

    /// <summary>A warm-up, then two working sets of 5 reps at RPE 8 worked out on the RTS chart, in each of three weeks.</summary>
    private static object[] P4bWeeks(Guid exerciseId) =>
    [
        P2Week("Week 1", exerciseId, P4bSets()),
        P2Week("Week 2", exerciseId, P4bSets()),
        P2Week("Week 3", exerciseId, P4bSets()),
    ];

    private static object[] P4bSets() =>
    [
        P1Set(1, "Direct", rpe: null, direct: 60m, setType: "WarmUp"),
        P1Set(2, "RpeChart", rpe: 8m, reps: 5),
        P1Set(3, "RpeChart", rpe: 8m, reps: 5),
    ];

    private static object P4bChange(Guid exerciseId, Guid loggedSetId) =>
        new { exerciseId, value = (decimal?)null, weekOneWeight = (decimal?)null, loggedSetId };

    /// <summary>The workspace's date now, by the server's clock (Asia/Beirut in these tests).</summary>
    private DateOnly P4bWorkspaceToday() =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(
            RequiredTestClock.UtcNow,
            TimeZoneInfo.FindSystemTimeZoneById("Asia/Beirut")).DateTime);

    /// <summary>
    /// The client starts today's session, logs its sets in order and, unless told not to, finishes it.
    /// Returns the logged sets' ids in order.
    /// </summary>
    private static async Task<Guid[]> P4bLogTodayAsync(HttpClient client, bool finish, params P4bLog[] sets)
    {
        var day = await ReadSliceAsync<ClientTrainingDayResult>(client, "/api/training/me/today");
        await RefreshCsrfAsync(client);
        var start = await client.PostAsync($"/api/training/me/sessions/{day.Workouts.Single().SessionId}/start", null);
        await AssertStatusAsync(start, HttpStatusCode.OK);
        var execution = await ReadSlicePayloadAsync<WorkoutExecutionView>(start);
        day = await ReadSliceAsync<ClientTrainingDayResult>(client, "/api/training/me/today");
        var performed = day.Workouts.Single().Exercises.Single().Sets.OrderBy(set => set.Position).ToArray();
        var version = execution.Version;
        for (var index = 0; index < sets.Length; index++)
        {
            await RefreshCsrfAsync(client);
            var saved = await client.PutAsJsonAsync(
                $"/api/training/me/workouts/{execution.Id}/sets/{performed[index].PerformanceId}",
                new
                {
                    repetitions = sets[index].Reps,
                    load = sets[index].Load,
                    loadUnit = sets[index].Unit,
                    rpe = sets[index].Rpe,
                    isCompleted = sets[index].Completed,
                    clientNote = (string?)null,
                    version,
                });
            await AssertStatusAsync(saved, HttpStatusCode.OK);
            version = (await ReadSlicePayloadAsync<WorkoutSetSaveView>(saved)).ExecutionVersion;
        }

        if (finish)
        {
            await RefreshCsrfAsync(client);
            await AssertStatusAsync(
                await client.PostAsJsonAsync($"/api/training/me/workouts/{execution.Id}/complete", new { version }),
                HttpStatusCode.OK);
        }

        return performed.Select(set => set.PerformanceId!.Value).ToArray();
    }

    [TestMethod]
    public async Task P4bTheWeeksBestLoggedSetSuggestsAMaxThatTheCoachAppliesThroughThePreview()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "p4b-apply", P4bWeeks);
        var block = await P2AssignAsync(coach, scenario, [P2SavedMax(scenario)]);

        // With a 100 kg max, 5 reps at RPE 8 (81.1% on the chart) is 80 kg. Nothing logged, nothing to suggest.
        var before = await ReadSliceAsync<TrainingMaxesView>(coach, P2MaxesUrl(block.Id));
        Assert.IsNull(before.Maxes.Single().Suggestion);

        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        var logged = await P4bLogTodayAsync(
            client,
            finish: true,
            new P4bLog(5, 60m, "Kilogram", null),
            new P4bLog(5, 90m, "Kilogram", 8m),
            new P4bLog(5, 85m, "Kilogram", 8.5m));
        var performedOn = P4bWorkspaceToday();

        // The top set speaks, not the warm-up or the tired back-off set: 90 kg / 81.1% = 110.974 kg.
        var read = await ReadSliceAsync<TrainingMaxesView>(coach, P2MaxesUrl(block.Id));
        var suggestion = read.Maxes.Single().Suggestion;
        Assert.IsNotNull(suggestion);
        Assert.AreEqual((110.974m, TrainingLoadUnit.Kilogram), (suggestion.Value, suggestion.Unit));
        Assert.AreEqual(
            (90m, 5, 8m, "RpeChart", "1.0"),
            (suggestion.Basis.Load, suggestion.Basis.Repetitions, suggestion.Basis.Rpe, suggestion.Basis.MethodKey, suggestion.Basis.MethodVersion));
        var set = suggestion.Basis.LoggedSet;
        Assert.IsNotNull(set);
        Assert.AreEqual(
            (logged[1], 1, performedOn, "Week 1 squat"),
            (set.SetPerformanceId, set.WeekNumber, set.PerformedOn, set.SessionName));
        StringAssert.StartsWith(
            suggestion.Explanation,
            "Best logged set v1: the best set of week 1 was 90 kg for 5 reps at RPE 8 on ");
        StringAssert.EndsWith(suggestion.Explanation, "so 90 kg / 81.1% = 110.974 kg.");

        // Nothing changed on its own: the max in use is still 100 kg.
        Assert.AreEqual(100m, read.Maxes.Single().Current.Value);

        // The coach sees every new weight first. Week 1 has started and keeps its own; weeks 2 and 3 follow.
        var current = await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id));
        var changes = new[] { P4bChange(scenario.Exercise.Id, logged[1]) };
        var preview = await P2PreviewOkAsync(coach, block.Id, current.Version, changes);
        var lift = preview.Lifts.Single();
        Assert.AreEqual((100m, 110.974m, TrainingMaxSource.LoggedSet), (lift.PreviousValue, lift.NewValue, lift.Source));
        Assert.AreEqual(logged[1], lift.Basis?.LoggedSet?.SetPerformanceId);
        Assert.AreEqual((4, 1, 2), (preview.ChangedSetCount, preview.KeptSessionCount, preview.EffectiveFromWeek));
        foreach (var change in preview.Sets)
        {
            Assert.AreEqual(((decimal?)80m, 90m), (change.PreviousLoad, change.NewLoad));
        }

        var applied = await P2ApplyOkAsync(
            coach, block.Id, current.Version, changes, null, preview.PreviewHash, Guid.NewGuid());
        var newest = applied.WorkingMaxes.Single(item => item.SupersedesSnapshotId is not null);
        Assert.AreEqual((110.974m, TrainingMaxSource.LoggedSet, 2), (newest.Value, newest.Source, newest.EffectiveFromWeek));
        StringAssert.StartsWith(newest.Reason, "Estimated from logged sets, week 1: 90 kg for 5 reps at RPE 8 on ");
        CollectionAssert.AreEqual(
            new decimal?[] { 60m, 80m, 80m, 60m, 90m, 90m, 60m, 90m, 90m },
            P2Sets(applied).Select(item => item.PrescribedLoad).ToArray());
        Assert.AreEqual(
            1L,
            await P2CountAsync(
                """SELECT count(*) FROM strength."WorkingMaxSnapshots" WHERE "SourceSetPerformanceId" = @id AND "BasisLoad" = 90 AND "BasisRepetitions" = 5 AND "BasisRpe" = 8""",
                logged[1]));

        // The panel says where the max came from, and the sets it was set from no longer argue with it.
        var after = (await ReadSliceAsync<TrainingMaxesView>(coach, P2MaxesUrl(block.Id))).Maxes.Single();
        Assert.AreEqual((110.974m, TrainingMaxSource.LoggedSet), (after.Current.Value, after.Current.Source));
        Assert.AreEqual(
            (logged[1], 1, performedOn),
            (after.Current.Basis?.LoggedSet?.SetPerformanceId, after.Current.Basis?.LoggedSet?.WeekNumber, after.Current.Basis?.LoggedSet?.PerformedOn));
        Assert.IsNull(after.Suggestion);
        Assert.AreEqual(TrainingMaxSource.SavedMax, after.Earlier.Single().Source);
        await P2RefusedAsync(
            await P2PreviewAsync(coach, block.Id, applied.Version, changes),
            HttpStatusCode.BadRequest,
            "cannot suggest");

        // The database keeps a logged-set max with its numbers, and a set it names must exist.
        await AssertSqlStateAsync(
            "23514",
            P2CopySnapshotSql(
                newest.Id,
                $"r.\"Id\" := gen_random_uuid(); r.\"SupersedesSnapshotId\" := '{newest.Id}'; r.\"BasisLoad\" := NULL; r.\"BasisRepetitions\" := NULL; r.\"BasisRpe\" := NULL; r.\"EstimateMethodKey\" := NULL; r.\"EstimateMethodVersion\" := NULL;"));
        await AssertSqlStateAsync(
            "23503",
            P2CopySnapshotSql(
                newest.Id,
                $"r.\"Id\" := gen_random_uuid(); r.\"SupersedesSnapshotId\" := '{newest.Id}'; r.\"SourceSetPerformanceId\" := gen_random_uuid();"));
    }

    [TestMethod]
    public async Task P4bOnlyFinishedWorkingSetsOfOneToEightRepsAtRpeSevenToTenInTheProgramsUnitCount()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "p4b-counts", exerciseId =>
        [
            P2Week(
                "Week 1",
                exerciseId,
                P1Set(1, "Direct", rpe: null, direct: 60m, setType: "WarmUp"),
                P1Set(2, "RpeChart", rpe: 8m, reps: 5),
                P1Set(3, "RpeChart", rpe: 8m, reps: 5),
                P1Set(4, "RpeChart", rpe: 8m, reps: 5),
                P1Set(5, "RpeChart", rpe: 8m, reps: 5)),
            P2Week("Week 2", exerciseId, P1Set(1, "RpeChart", rpe: 8m, reps: 5)),
        ]);
        var block = await P2AssignAsync(coach, scenario, [P2SavedMax(scenario)]);

        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        var logged = await P4bLogTodayAsync(
            client,
            finish: true,
            // A heavy warm-up, a set in pounds, ten reps, and no RPE: none of them is evidence.
            new P4bLog(3, 120m, "Kilogram", 9m),
            new P4bLog(5, 230m, "Pound", 8m),
            new P4bLog(10, 80m, "Kilogram", 8m),
            new P4bLog(5, 100m, "Kilogram", null),
            // 82.5 kg for 5 at RPE 8 is 101.726 kg: within one 2.5 kg step of 100, so not worth saying.
            new P4bLog(5, 82.5m, "Kilogram", 8m));

        var read = await ReadSliceAsync<TrainingMaxesView>(coach, P2MaxesUrl(block.Id));
        Assert.IsNull(read.Maxes.Single().Suggestion);

        // Naming a set that does not count is refused with the reason, and kg and lb are never mixed.
        var squat = scenario.Exercise.Id;
        var version = (await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id))).Version;
        foreach (var setId in new[] { logged[0], logged[1], logged[2], logged[3], Guid.NewGuid() })
        {
            await P2RefusedAsync(
                await P2PreviewAsync(coach, block.Id, version, P4bChange(squat, setId)),
                HttpStatusCode.BadRequest,
                "cannot suggest");
        }

        // One source per lift: a typed number and a logged set together are refused.
        await P2RefusedAsync(
            await P2PreviewAsync(coach, block.Id, version, new { exerciseId = squat, value = (decimal?)120m, weekOneWeight = (decimal?)null, loggedSetId = (Guid?)logged[4] }),
            HttpStatusCode.BadRequest,
            "one of the three");

        // A workout the client has not finished can still change, so its sets wait until it is finished.
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        await P4bLogTodayAsync(client, finish: false, new P4bLog(5, 95m, "Kilogram", 8m));
        read = await ReadSliceAsync<TrainingMaxesView>(coach, P2MaxesUrl(block.Id));
        Assert.IsNull(read.Maxes.Single().Suggestion);
    }

    [TestMethod]
    public async Task P4bASuggestionIsForTheClientsOwnCoachAndEndsWhenTheClientIsReleased()
    {
        using var owner = CreateClient();
        var workspaceId = await RegisterCoachAsync(owner, "p4b-team-owner@example.test", "P4b Owner", "P4b Team Gym");
        using var coach = CreateClient();
        await JoinAsCoachAsync(owner, coach, "p4b-team-coach@example.test", "Pat Coach");
        using var otherCoach = CreateClient();
        await JoinAsCoachAsync(owner, otherCoach, "p4b-team-other@example.test", "Sam Coach");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "p4b-team-client@example.test", newAccount: true);

        var enrollment = await CreateTrainingEnrollmentAsync(coach, clientId, TenantToday(), 8);
        var exercise = await CreateExerciseAsync(coach, "Competition squat", [], []);
        var max = await RecordWorkingMaxAsync(coach, clientId, exercise.Id, 100m);
        await RefreshCsrfAsync(coach);
        var created = await coach.PostAsJsonAsync("/api/training/templates", new
        {
            name = "p4b-team program",
            description = (string?)null,
            publish = true,
            templateVersion = (uint?)null,
            weeks = P4bWeeks(exercise.Id),
        });
        await AssertStatusAsync(created, HttpStatusCode.OK);
        var scenario = new P2Custom(workspaceId, clientId, enrollment, exercise, max, await RequiredJsonAsync<TemplateVersion>(created));
        var block = await P2AssignAsync(coach, scenario, [P2SavedMax(scenario)]);

        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        var logged = await P4bLogTodayAsync(client, finish: true, new P4bLog(5, 60m, "Kilogram", null), new P4bLog(5, 90m, "Kilogram", 8m));
        var changes = new[] { P4bChange(exercise.Id, logged[1]) };

        // The client's coach and the owner see it.
        Assert.IsNotNull((await ReadSliceAsync<TrainingMaxesView>(coach, P2MaxesUrl(block.Id))).Maxes.Single().Suggestion);
        Assert.IsNotNull((await ReadSliceAsync<TrainingMaxesView>(owner, P2MaxesUrl(block.Id))).Maxes.Single().Suggestion);

        // Another coach of the same team reaches neither the suggestion nor the set (ADR 0026).
        await AssertStatusAsync(await otherCoach.GetAsync(P2MaxesUrl(block.Id)), HttpStatusCode.NotFound);
        await AssertStatusAsync(await P2PreviewAsync(otherCoach, block.Id, block.Version, changes), HttpStatusCode.NotFound);
        await AssertStatusAsync(
            await P2ApplyAsync(otherCoach, block.Id, block.Version, changes, null, new string('a', 64), Guid.NewGuid()),
            HttpStatusCode.NotFound);

        // A coach of another workspace is refused naming this one.
        using var stranger = CreateClient();
        await RegisterCoachAsync(stranger, "p4b-team-stranger@example.test", "P4b Stranger", "P4b Stranger Gym");
        SetTenant(stranger, workspaceId);
        await AssertStatusAsync(await stranger.GetAsync(P2MaxesUrl(block.Id)), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await P2PreviewAsync(stranger, block.Id, block.Version, changes), HttpStatusCode.Forbidden);

        // Once released, the program closes and nothing more is suggested or applied (ADR 0027).
        var current = await ReadSliceAsync<TrainingMesocycleView>(owner, P2MesocycleUrl(block.Id));
        var preview = await P2PreviewOkAsync(owner, block.Id, current.Version, changes);
        await ReleaseAsync(owner, clientId, "Moved away");
        var closed = await ReadSliceAsync<TrainingMaxesView>(owner, P2MaxesUrl(block.Id));
        Assert.IsTrue(closed.IsClosed);
        Assert.IsNull(closed.Maxes.Single().Suggestion);
        var refused = await P2ApplyAsync(owner, block.Id, current.Version, changes, null, preview.PreviewHash, Guid.NewGuid());
        await AssertStatusAsync(refused, HttpStatusCode.Conflict);
        StringAssert.Contains(await refused.Content.ReadAsStringAsync(), "client_released");
        await AssertStatusAsync(await coach.GetAsync(P2MaxesUrl(block.Id)), HttpStatusCode.NotFound);
        Assert.AreEqual(
            0L,
            await P2CountAsync("""SELECT count(*) FROM strength."WorkingMaxSnapshots" WHERE "SourceSetPerformanceId" = @id""", logged[1]));
    }

    [TestMethod]
    public async Task P4bANewerBestSetAfterThePreviewIsRefusedAndTheSuggestionMovesOn()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "p4b-newer", P4bWeeks);
        var block = await P2AssignAsync(coach, scenario, [P2SavedMax(scenario)]);

        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        var weekOne = await P4bLogTodayAsync(client, finish: true, new P4bLog(5, 60m, "Kilogram", null), new P4bLog(5, 90m, "Kilogram", 8m));
        var current = await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id));
        var changes = new[] { P4bChange(scenario.Exercise.Id, weekOne[1]) };
        var preview = await P2PreviewOkAsync(coach, block.Id, current.Version, changes);

        // Before the coach applies it, week 2 is logged: 95 kg for 5 at RPE 8 is 117.139 kg.
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        var weekTwo = await P4bLogTodayAsync(client, finish: true, new P4bLog(5, 60m, "Kilogram", null), new P4bLog(5, 95m, "Kilogram", 8m));

        // Even against the program as it is now, the set the coach reviewed is no longer the one that speaks.
        current = await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id));
        var refused = await P2ApplyAsync(coach, block.Id, current.Version, changes, null, preview.PreviewHash, Guid.NewGuid());
        await AssertStatusAsync(refused, HttpStatusCode.Conflict);
        StringAssert.Contains(await refused.Content.ReadAsStringAsync(), "training_max_suggestion_changed");
        Assert.AreEqual(
            1L,
            await P2CountAsync("""SELECT count(*) FROM strength."WorkingMaxSnapshots" WHERE "MesocycleId" = @id""", block.Id));

        var suggestion = (await ReadSliceAsync<TrainingMaxesView>(coach, P2MaxesUrl(block.Id))).Maxes.Single().Suggestion;
        Assert.IsNotNull(suggestion);
        Assert.AreEqual((117.139m, weekTwo[1], 2), (suggestion.Value, suggestion.Basis.LoggedSet?.SetPerformanceId, suggestion.Basis.LoggedSet?.WeekNumber));
    }
}
