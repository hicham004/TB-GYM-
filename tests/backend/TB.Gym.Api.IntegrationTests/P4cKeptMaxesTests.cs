using System.Net;
using System.Net.Http.Json;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Training;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// P4c, P4b's follow-ups: the coach keeps a max over a suggestion (STR-013), and a newer set during review answers
/// with its own code. Coach Today named the lifts whose logged sets suggest a new max (CLI-018 v2) until the notes
/// plan's N10a took maxes to review off it (v7).
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private static string P4cKeepUrl(Guid blockId) => $"/api/training/mesocycles/{blockId}/training-maxes/keep";

    private static async Task<HttpResponseMessage> P4cKeepAsync(HttpClient coach, Guid blockId, Guid exerciseId, Guid loggedSetId)
    {
        await RefreshCsrfAsync(coach);
        return await coach.PostAsJsonAsync(P4cKeepUrl(blockId), new { exerciseId, loggedSetId });
    }

    [TestMethod]
    public async Task P4cKeepingAMaxQuietsItsSuggestionUntilASetLoggedAfterwardsSpeaks()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        // Four weeks, so finishing week 3 leaves the program open.
        var scenario = await P2CustomStartAsync(coach, client, "p4c-keep", exerciseId =>
            [.. P4bWeeks(exerciseId), P2Week("Week 4", exerciseId, P4bSets())]);
        var block = await P2AssignAsync(coach, scenario, [P2SavedMax(scenario)]);
        var squat = scenario.Exercise.Id;

        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        var weekOne = await P4bLogTodayAsync(client, finish: true, new P4bLog(5, 60m, "Kilogram", null), new P4bLog(5, 90m, "Kilogram", 8m));
        Assert.IsNotNull((await ReadSliceAsync<TrainingMaxesView>(coach, P2MaxesUrl(block.Id))).Maxes.Single().Suggestion);
        var version = (await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id))).Version;
        var preview = await P2PreviewOkAsync(coach, block.Id, version, P4bChange(squat, weekOne[1]));

        // Only a set the rule picks can be kept over: never the warm-up, never a set that does not exist.
        await P2RefusedAsync(await P4cKeepAsync(coach, block.Id, squat, weekOne[0]), HttpStatusCode.BadRequest, "cannot suggest");
        await P2RefusedAsync(await P4cKeepAsync(coach, block.Id, squat, Guid.NewGuid()), HttpStatusCode.BadRequest, "cannot suggest");
        await P2RefusedAsync(await P4cKeepAsync(coach, block.Id, Guid.NewGuid(), weekOne[1]), HttpStatusCode.BadRequest, "does not use a training max");

        // Keeping it records what was suggested, changes nothing in the program and quiets the suggestion.
        var keep = await P4cKeepAsync(coach, block.Id, squat, weekOne[1]);
        await AssertStatusAsync(keep, HttpStatusCode.OK);
        var kept = (await ReadSlicePayloadAsync<TrainingMaxesView>(keep)).Maxes.Single();
        Assert.IsNull(kept.Suggestion);
        Assert.AreEqual(100m, kept.Current.Value);
        Assert.AreEqual(new TrainingMaxKeptView(110.974m, TrainingLoadUnit.Kilogram, P4bWorkspaceToday()), kept.Kept);
        Assert.AreEqual(version, (await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id))).Version);
        Assert.AreEqual(1L, await P2CountAsync("""SELECT count(*) FROM strength."WorkingMaxSnapshots" WHERE "MesocycleId" = @id""", block.Id));

        // A retry finds the first keep; both answer the same and one record is kept.
        var retried = await P4cKeepAsync(coach, block.Id, squat, weekOne[1]);
        await AssertStatusAsync(retried, HttpStatusCode.OK);
        Assert.AreEqual(kept.Kept, (await ReadSlicePayloadAsync<TrainingMaxesView>(retried)).Maxes.Single().Kept);
        Assert.AreEqual(
            1L,
            await P2CountAsync(
                """SELECT count(*) FROM strength."WorkingMaxKeeps" WHERE "MesocycleId" = @id AND "SuggestedValue" = 110.974 AND "Unit" = 'Kilogram'""",
                block.Id));

        // The preview from before the keep can no longer be applied, and says why in its own code.
        var stale = await P2ApplyAsync(coach, block.Id, version, [P4bChange(squat, weekOne[1])], null, preview.PreviewHash, Guid.NewGuid());
        await AssertStatusAsync(stale, HttpStatusCode.Conflict);
        StringAssert.Contains(await stale.Content.ReadAsStringAsync(), TrainingMaxSuggestionChangedException.Code);

        // A set logged after the keep speaks again: 95 kg for 5 at RPE 8 is 117.139 kg.
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        var weekTwo = await P4bLogTodayAsync(client, finish: true, new P4bLog(5, 60m, "Kilogram", null), new P4bLog(5, 95m, "Kilogram", 8m));
        var read = (await ReadSliceAsync<TrainingMaxesView>(coach, P2MaxesUrl(block.Id))).Maxes.Single();
        Assert.AreEqual((117.139m, weekTwo[1]), (read.Suggestion?.Value, read.Suggestion?.Basis.LoggedSet?.SetPerformanceId));
        Assert.AreEqual(kept.Kept, read.Kept);

        // Keeping the set the coach already kept answers as the first keep did, and adds nothing.
        await AssertStatusAsync(await P4cKeepAsync(coach, block.Id, squat, weekOne[1]), HttpStatusCode.OK);

        // Week 3 logs a heavier set before the coach acts on week 2's: keeping week 2's is a suggestion that moved on.
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        var weekThree = await P4bLogTodayAsync(client, finish: true, new P4bLog(5, 60m, "Kilogram", null), new P4bLog(5, 100m, "Kilogram", 8m));
        var moved = await P4cKeepAsync(coach, block.Id, squat, weekTwo[1]);
        await AssertStatusAsync(moved, HttpStatusCode.Conflict);
        StringAssert.Contains(await moved.Content.ReadAsStringAsync(), TrainingMaxSuggestionChangedException.Code);
        var latest = (await ReadSlicePayloadAsync<TrainingMaxesView>(await P4cKeepAsync(coach, block.Id, squat, weekThree[1]))).Maxes.Single();
        Assert.AreEqual(new TrainingMaxKeptView(123.305m, TrainingLoadUnit.Kilogram, P4bWorkspaceToday()), latest.Kept);
        Assert.AreEqual(2L, await P2CountAsync("""SELECT count(*) FROM strength."WorkingMaxKeeps" WHERE "MesocycleId" = @id""", block.Id));

        // The database keeps one keep per max and set, never changes or removes one, and keeps a real value.
        const string copy =
            """
            INSERT INTO strength."WorkingMaxKeeps" ("Id", "MesocycleId", "WorkingMaxSnapshotId", "LoggedSetPerformanceId", "SuggestedValue", "Unit", "CreatedAtUtc", "UpdatedAtUtc", "TenantId")
            SELECT gen_random_uuid(), "MesocycleId", "WorkingMaxSnapshotId", SET, VALUE, "Unit", "CreatedAtUtc", "UpdatedAtUtc", "TenantId"
            FROM strength."WorkingMaxKeeps" LIMIT 1
            """;
        await AssertSqlStateAsync("23505", copy.Replace("SET", "\"LoggedSetPerformanceId\"").Replace("VALUE", "\"SuggestedValue\""));
        await AssertSqlStateAsync("23514", copy.Replace("SET", "gen_random_uuid()").Replace("VALUE", "0"));
        await AssertSqlStateAsync("23503", copy.Replace("SET", "gen_random_uuid()").Replace("VALUE", "\"SuggestedValue\""));
        await AssertSqlStateAsync("55000", "UPDATE strength.\"WorkingMaxKeeps\" SET \"SuggestedValue\" = 1");
        await AssertSqlStateAsync("55000", "DELETE FROM strength.\"WorkingMaxKeeps\"");
    }

    [TestMethod]
    public async Task P4cANewerBestSetDuringTheReviewAnswersWithItsOwnCode()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "p4c-newer", P4bWeeks);
        var block = await P2AssignAsync(coach, scenario, [P2SavedMax(scenario)]);

        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        var weekOne = await P4bLogTodayAsync(client, finish: true, new P4bLog(5, 60m, "Kilogram", null), new P4bLog(5, 90m, "Kilogram", 8m));
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        await P4bLogTodayAsync(client, finish: true, new P4bLog(5, 60m, "Kilogram", null), new P4bLog(5, 95m, "Kilogram", 8m));

        // The preview, as well as the update, names what happened instead of "the program changed".
        var version = (await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id))).Version;
        var refused = await P2PreviewAsync(coach, block.Id, version, P4bChange(scenario.Exercise.Id, weekOne[1]));
        await AssertStatusAsync(refused, HttpStatusCode.Conflict);
        var body = await refused.Content.ReadAsStringAsync();
        StringAssert.Contains(body, TrainingMaxSuggestionChangedException.Code);
        StringAssert.Contains(body, "newer logged set");
    }

    [TestMethod]
    public async Task P4cKeepingIsForTheClientsOwnCoachWhileTheClientIsCoachedHere()
    {
        using var owner = CreateClient();
        var workspaceId = await RegisterCoachAsync(owner, "p4c-team-owner@example.test", "P4c Owner", "P4c Team Gym");
        using var coach = CreateClient();
        await JoinAsCoachAsync(owner, coach, "p4c-team-coach@example.test", "Pat Coach");
        using var otherCoach = CreateClient();
        await JoinAsCoachAsync(owner, otherCoach, "p4c-team-other@example.test", "Sam Coach");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "p4c-team-client@example.test", newAccount: true);

        var enrollment = await CreateTrainingEnrollmentAsync(coach, clientId, TenantToday(), 8);
        var exercise = await CreateExerciseAsync(coach, "Competition squat", [], []);
        var max = await RecordWorkingMaxAsync(coach, clientId, exercise.Id, 100m);
        var template = await PublishProgramAsync(coach, new
        {
            name = "p4c-team program",
            description = (string?)null,
            weeks = P4bWeeks(exercise.Id),
        });
        var scenario = new P2Custom(workspaceId, clientId, enrollment, exercise, max, template);
        var block = await P2AssignAsync(coach, scenario, [P2SavedMax(scenario)]);

        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        var logged = await P4bLogTodayAsync(client, finish: true, new P4bLog(5, 60m, "Kilogram", null), new P4bLog(5, 90m, "Kilogram", 8m));

        // Another coach of the team, and a coach of another workspace, cannot keep it (ADR 0026).
        await AssertStatusAsync(await P4cKeepAsync(otherCoach, block.Id, exercise.Id, logged[1]), HttpStatusCode.NotFound);
        using var stranger = CreateClient();
        await RegisterCoachAsync(stranger, "p4c-team-stranger@example.test", "P4c Stranger", "P4c Stranger Gym");
        SetTenant(stranger, workspaceId);
        await AssertStatusAsync(await P4cKeepAsync(stranger, block.Id, exercise.Id, logged[1]), HttpStatusCode.Forbidden);
        Assert.AreEqual(0L, await P2CountAsync("""SELECT count(*) FROM strength."WorkingMaxKeeps" WHERE "MesocycleId" = @id""", block.Id));

        // The client's own coach keeps it.
        await AssertStatusAsync(await P4cKeepAsync(coach, block.Id, exercise.Id, logged[1]), HttpStatusCode.OK);

        // Once the client is released nothing can be kept, not even over a set logged later (ADR 0027).
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        var later = await P4bLogTodayAsync(client, finish: true, new P4bLog(5, 60m, "Kilogram", null), new P4bLog(5, 95m, "Kilogram", 8m));
        await ReleaseAsync(owner, clientId, "Moved away");
        var released = await P4cKeepAsync(owner, block.Id, exercise.Id, later[1]);
        await AssertStatusAsync(released, HttpStatusCode.Conflict);
        StringAssert.Contains(await released.Content.ReadAsStringAsync(), "client_released");
        Assert.IsFalse((await ReadSliceAsync<CoachTodayView>(owner, CoachTodayUrl)).Attention
            .Any(entry => entry.Client.ClientProfileId == clientId));
        Assert.AreEqual(1L, await P2CountAsync("""SELECT count(*) FROM strength."WorkingMaxKeeps" WHERE "MesocycleId" = @id""", block.Id));
    }
}
