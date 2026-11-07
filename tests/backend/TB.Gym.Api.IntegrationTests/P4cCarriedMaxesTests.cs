using System.Net;
using System.Net.Http.Json;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Training;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// P4c, between programs (STR-014): a new program starts where the client's latest one ended. Assign program
/// reads the maxes that program uses now and an assignment may carry one over, keeping its source. The suggestion
/// from that program's logged sets went with the notes plan's N10b; Coach Today's No program item names the program
/// that ended, with nothing beside it since N10a.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private static string P4cPreviousMaxesUrl(Guid clientId) => $"/api/training/clients/{clientId}/previous-maxes";

    /// <summary>One week of the P4b sets, so a program ends a week after it starts.</summary>
    private static object[] P4cOneWeek(Guid exerciseId) => [P2Week("Week 1", exerciseId, P4bSets())];

    /// <summary>Assigns the scenario's program again, starting on the workspace's date by the server's clock.</summary>
    private async Task<HttpResponseMessage> P4cAssignNextAsync(HttpClient coach, P2Custom scenario, object max, Guid key)
    {
        await RefreshCsrfAsync(coach);
        return await coach.PostAsJsonAsync($"/api/training/clients/{scenario.ClientId}/mesocycles", new
        {
            enrollmentId = scenario.Enrollment.Id,
            templateVersionId = scenario.Template.Id,
            startDate = P4bWorkspaceToday(),
            kind = "Primary",
            loadUnit = "Kilogram",
            loadIncrement = 2.5m,
            loadRoundingMode = "Nearest",
            workingMaxes = new[] { max },
            idempotencyKey = key,
            name = "Next block",
        });
    }

    private static object P4cCarried(Guid exerciseId, Guid maxId, decimal value, Guid? recordId = null) => new
    {
        exerciseId,
        strengthMaxRecordId = recordId,
        value = (decimal?)value,
        unit = "Kilogram",
        weekOneWeight = (decimal?)null,
        carriedFromMaxId = (Guid?)maxId,
    };

    /// <summary>A new program's max naming a logged set and no number, as Assign program sent one until N10b.</summary>
    private static object P4cFromLoggedSet(Guid exerciseId, Guid loggedSetId) => new
    {
        exerciseId,
        strengthMaxRecordId = (Guid?)null,
        value = (decimal?)null,
        unit = "Kilogram",
        weekOneWeight = (decimal?)null,
        loggedSetId = (Guid?)loggedSetId,
    };

    [TestMethod]
    public async Task P4cANewProgramStartsFromTheMaxTheLastProgramUsesNow()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "p4c-next", P4cOneWeek);
        var squat = scenario.Exercise.Id;
        var first = await P2AssignAsync(coach, scenario, [P2SavedMax(scenario)]);

        // The latest program offers the max it uses, and nothing else.
        var before = await ReadSliceAsync<PreviousProgramMaxesView>(coach, P4cPreviousMaxesUrl(scenario.ClientId));
        Assert.AreEqual((first.Id, first.Name, TrainingLoadUnit.Kilogram), (before.MesocycleId, before.ProgramName, before.LoadUnit));
        Assert.AreEqual((squat, "Competition squat", 100m),
            (before.Maxes.Single().ExerciseId, before.Maxes.Single().ExerciseName, before.Maxes.Single().Value));

        // The client lifts more than the max says, 90 kg for 5 at RPE 8 over 100 kg; the carry reads no logged set.
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        await P4bLogTodayAsync(client, finish: true, new P4bLog(5, 60m, "Kilogram", null), new P4bLog(5, 90m, "Kilogram", 8m));

        // The week ends: the client is between programs, and No program names the program that ended.
        RequiredTestClock.Advance(TimeSpan.FromDays(8));
        var today = (await ReadSliceAsync<CoachTodayView>(coach, CoachTodayUrl)).Attention
            .Where(entry => entry.Client.ClientProfileId == scenario.ClientId)
            .ToArray();
        var none = today.Single(entry => entry.Kind == CoachAttentionKind.NoProgram);
        Assert.AreEqual(first.Id, none.SubjectId);

        // Every session done and its last day past, the program closed itself. It offers the max it uses, 100 kg,
        // and no suggestion from its logged sets (the API writes nulls, so only the text proves the key gone).
        var ended = await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(first.Id));
        Assert.AreEqual(MesocycleStatus.Completed, ended.Status);
        var read = await ReadSliceAsync<PreviousProgramMaxesView>(coach, P4cPreviousMaxesUrl(scenario.ClientId));
        var inUse = read.Maxes.Single();
        Assert.AreEqual((first.Id, 100m), (read.MesocycleId, inUse.Value));
        Assert.DoesNotContain(
            "\"suggestion\"",
            await coach.GetStringAsync(P4cPreviousMaxesUrl(scenario.ClientId)),
            StringComparison.OrdinalIgnoreCase);

        // The next program starts from 100 kg, carried over, and weighs week 1 from it: 81.1% of 100 kg is 81.1 kg,
        // 80 kg to the nearest 2.5 kg.
        var key = Guid.NewGuid();
        var assigned = await P4cAssignNextAsync(coach, scenario, P4cCarried(squat, inUse.MaxId, 100m), key);
        await AssertStatusAsync(assigned, HttpStatusCode.OK);
        var next = await ReadSlicePayloadAsync<TrainingMesocycleView>(assigned);
        var max = (await ReadSliceAsync<TrainingMaxesView>(coach, P2MaxesUrl(next.Id))).Maxes.Single().Current;
        Assert.AreEqual((100m, TrainingMaxSource.PreviousProgram), (max.Value, max.Source));
        Assert.IsNull(max.Basis);
        StringAssert.StartsWith(max.Reason, $"Carried over from the previous program \"{first.Name}\"");
        Assert.AreEqual((decimal?)80m, P2Sets(next)[1].PrescribedLoad);

        // A retry returns the same program; the same key for another max conflicts.
        var retried = await P4cAssignNextAsync(coach, scenario, P4cCarried(squat, inUse.MaxId, 100m), key);
        await AssertStatusAsync(retried, HttpStatusCode.OK);
        Assert.AreEqual(next.Id, (await ReadSlicePayloadAsync<TrainingMesocycleView>(retried)).Id);
        await P2RefusedAsync(
            await P4cAssignNextAsync(coach, scenario, P2SavedMax(scenario), key),
            HttpStatusCode.Conflict,
            "idempotency_conflict");

        // With a program running again the client leaves No program, and the new one is the latest.
        Assert.IsFalse((await ReadSliceAsync<CoachTodayView>(coach, CoachTodayUrl)).Attention
            .Any(entry => entry.Client.ClientProfileId == scenario.ClientId && entry.Kind == CoachAttentionKind.NoProgram));
        Assert.AreEqual(next.Id, (await ReadSliceAsync<PreviousProgramMaxesView>(coach, P4cPreviousMaxesUrl(scenario.ClientId))).MesocycleId);
    }

    [TestMethod]
    public async Task P4cAMaxIsCarriedOverOnlyFromTheSameClientsLatestProgramAsItStandsNow()
    {
        using var owner = CreateClient();
        var workspaceId = await RegisterCoachAsync(owner, "p4c-carry-owner@example.test", "P4c Owner", "P4c Carry Gym");
        using var coach = CreateClient();
        await JoinAsCoachAsync(owner, coach, "p4c-carry-coach@example.test", "Pat Coach");
        using var otherCoach = CreateClient();
        await JoinAsCoachAsync(owner, otherCoach, "p4c-carry-other@example.test", "Sam Coach");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "p4c-carry-client@example.test", newAccount: true);
        using var secondClient = CreateClient();
        var secondClientId = await InviteAndAcceptAsync(coach, secondClient, "p4c-carry-second@example.test", newAccount: true);

        var enrollment = await CreateTrainingEnrollmentAsync(coach, clientId, TenantToday(), 8);
        var exercise = await CreateExerciseAsync(coach, "Competition squat", [], []);
        var bench = await CreateExerciseAsync(coach, "Bench press", [], []);
        var saved = await RecordWorkingMaxAsync(coach, clientId, exercise.Id, 100m);
        var template = await PublishProgramAsync(coach, new
        {
            name = "p4c-carry program",
            description = (string?)null,
            weeks = P4cOneWeek(exercise.Id),
        });
        var scenario = new P2Custom(workspaceId, clientId, enrollment, exercise, saved, template);

        // No program yet: nothing to carry, and the read says so.
        var empty = await ReadSliceAsync<PreviousProgramMaxesView>(coach, P4cPreviousMaxesUrl(clientId));
        Assert.AreEqual(((Guid?)null, 0), (empty.MesocycleId, empty.Maxes.Count));

        var first = await P2AssignAsync(coach, scenario, [P2SavedMax(scenario)]);
        RequiredTestClock.Advance(TimeSpan.FromDays(8));
        var previous = (await ReadSliceAsync<PreviousProgramMaxesView>(coach, P4cPreviousMaxesUrl(clientId))).Maxes.Single();
        Assert.AreEqual(100m, previous.Value);

        // Another coach of the team, and a coach of another workspace, cannot read it (ADR 0026).
        await AssertStatusAsync(await otherCoach.GetAsync(P4cPreviousMaxesUrl(clientId)), HttpStatusCode.NotFound);
        using var stranger = CreateClient();
        await RegisterCoachAsync(stranger, "p4c-carry-stranger@example.test", "P4c Stranger", "P4c Stranger Gym");
        SetTenant(stranger, workspaceId);
        await AssertStatusAsync(await stranger.GetAsync(P4cPreviousMaxesUrl(clientId)), HttpStatusCode.Forbidden);

        // A carried max keeps the lift's value and comes from the latest program's max in use, alone.
        await P2RefusedAsync(
            await P4cAssignNextAsync(coach, scenario, P4cCarried(exercise.Id, previous.MaxId, 105m), Guid.NewGuid()),
            HttpStatusCode.BadRequest,
            "type the number to change it");
        await P2RefusedAsync(
            await P4cAssignNextAsync(coach, scenario, P4cCarried(exercise.Id, Guid.NewGuid(), 100m), Guid.NewGuid()),
            HttpStatusCode.BadRequest,
            "latest program uses now");
        await P2RefusedAsync(
            await P4cAssignNextAsync(coach, scenario, P4cCarried(exercise.Id, previous.MaxId, 100m, saved.Id), Guid.NewGuid()),
            HttpStatusCode.BadRequest,
            "no other source");

        // A max that names only a logged set, as Assign program sent one until the notes plan's N10b, has no number
        // and no week 1's weight now that the server reads no set: refused, and nothing is written.
        await P2RefusedAsync(
            await P4cAssignNextAsync(coach, scenario, P4cFromLoggedSet(exercise.Id, Guid.NewGuid()), Guid.NewGuid()),
            HttpStatusCode.BadRequest,
            "either a number or week 1");
        Assert.AreEqual(1L, await P2CountAsync("""SELECT count(*) FROM training."Mesocycles" WHERE "ClientProfileId" = @id""", clientId));
        Assert.AreEqual(1L, await P2CountAsync("""SELECT count(*) FROM strength."WorkingMaxSnapshots" WHERE "ClientProfileId" = @id""", clientId));

        var assigned = await P4cAssignNextAsync(coach, scenario, P4cCarried(exercise.Id, previous.MaxId, 100m), Guid.NewGuid());
        await AssertStatusAsync(assigned, HttpStatusCode.OK);
        var next = await ReadSlicePayloadAsync<TrainingMesocycleView>(assigned);
        var max = (await ReadSliceAsync<TrainingMaxesView>(coach, P2MaxesUrl(next.Id))).Maxes.Single().Current;
        Assert.AreEqual((100m, TrainingMaxSource.PreviousProgram), (max.Value, max.Source));
        StringAssert.StartsWith(max.Reason, $"Carried over from the previous program \"{first.Name}\"");

        // Once the new program is the latest, the first one's max is history and can no longer be carried.
        RequiredTestClock.Advance(TimeSpan.FromDays(8));
        await P2RefusedAsync(
            await P4cAssignNextAsync(coach, scenario, P4cCarried(exercise.Id, previous.MaxId, 100m), Guid.NewGuid()),
            HttpStatusCode.BadRequest,
            "latest program uses now");

        // The database keeps a carried max to the same client's own, with no other source beside it.
        var carriedId = max.Id;
        const string copy =
            """
            INSERT INTO strength."WorkingMaxSnapshots" ("Id", "MesocycleId", "ClientProfileId", "ExerciseId", "SourceMaxRecordId", "Value", "Unit", "EffectiveFromWeek", "SupersedesSnapshotId", "Reason", "CarriedFromSnapshotId", "CreatedAtUtc", "UpdatedAtUtc", "TenantId")
            SELECT gen_random_uuid(), "MesocycleId", CLIENT, @bench, RECORD, "Value", "Unit", 1, NULL, "Reason", @carried, "CreatedAtUtc", "UpdatedAtUtc", "TenantId"
            FROM strength."WorkingMaxSnapshots" WHERE "Id" = @id
            """;
        (string, object)[] parameters = [("id", carriedId), ("bench", bench.Id), ("carried", previous.MaxId)];
        await AssertSqlStateAsync("23503", copy.Replace("CLIENT", $"'{secondClientId}'").Replace("RECORD", "NULL"), parameters);
        await AssertSqlStateAsync("23514", copy.Replace("CLIENT", "\"ClientProfileId\"").Replace("RECORD", $"'{saved.Id}'"), parameters);
        await AssertSqlStateAsync("55000", "UPDATE strength.\"WorkingMaxSnapshots\" SET \"CarriedFromSnapshotId\" = NULL");
    }
}
