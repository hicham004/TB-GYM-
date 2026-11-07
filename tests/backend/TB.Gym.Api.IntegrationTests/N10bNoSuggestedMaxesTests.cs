using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Npgsql;
using TB.Gym.Modules.Training;
using StrengthMaxKind = TB.Gym.Modules.Strength.StrengthMaxKind;
using StrengthMaxPage = TB.Gym.Modules.Strength.StrengthMaxPage;
using StrengthMaxProgramView = TB.Gym.Modules.Strength.StrengthMaxProgramView;
using StrengthMaxSource = TB.Gym.Modules.Strength.StrengthMaxSource;
using WorkingMaxSource = TB.Gym.Modules.Strength.WorkingMaxSource;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The notes plan's N10b (decision 19's note, 7 Nov 2026): the max a client's logged sets suggested (P4b, BestLoggedSet
/// v1, STR-012) and the coach's keep of a max over it (P4c, STR-013) are gone from the Training maxes panel, Assign
/// program's previous maxes and the API. The P4b sets (90 kg for 5 at RPE 8 over a 100 kg max, which suggested
/// 110.974 kg) leave nothing of a suggestion or a keep in what the reads send; a request that still names a logged set
/// has no number and no week 1's weight, so it is refused and writes nothing; what was stored before reads and holds as
/// it did: a max applied from a suggestion names its set and keeps its guards, a keep keeps its own, and an update
/// recorded before answers its retry by the fingerprint it was given: a typed one finds its first result, an applied
/// suggestion's names a set the server no longer reads and conflicts, as an assignment that started from a set does.
/// Each test with a client starts at midday in the workspace's zone, so each whole day it steps lands on the next
/// calendar day.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    /// <summary>The schemas N10b changed: the properties each keeps, then the ones it lost.</summary>
    private static readonly (string Schema, string[] Kept, string[] Gone)[] N10bSchemas =
    [
        ("TrainingMaxChangeRequest", ["exerciseId", "value", "weekOneWeight"], ["loggedSetId"]),
        ("WorkingMaxSelectionRequest", ["exerciseId", "value", "weekOneWeight", "carriedFromMaxId"], ["loggedSetId"]),
        ("TrainingMaxView", ["current", "weekOneSet", "earlier"], ["suggestion", "kept"]),
        ("PreviousProgramMaxView", ["maxId", "value", "setOn"], ["suggestion"]),
        ("TrainingMaxBasisView", ["load", "repetitions", "rpe", "loggedSet"], []),
    ];

    [TestMethod]
    public async Task N10bThePanelAndPreviousMaxesSendNoSuggestionAndNoKeep()
    {
        R61aStartAtMidday();
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "n10b-reads", P4bWeeks);
        var block = await P2AssignAsync(coach, scenario, [P2SavedMax(scenario)]);

        // A minute on, so the sets come after the max was set: until N10b, 90 kg for 5 at RPE 8 suggested 110.974 kg.
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        await N10bLogTodaysSetsAsync(client);
        await N10bAssertNoSuggestionAsync(coach, block.Id, scenario.ClientId);

        // The lift keeps its number and where it came from, and nothing changed on its own.
        var lift = (await ReadSliceAsync<TrainingMaxesView>(coach, P2MaxesUrl(block.Id))).Maxes.Single();
        Assert.AreEqual((100m, TrainingMaxSource.SavedMax), (lift.Current.Value, lift.Current.Source));
        Assert.IsEmpty(lift.Earlier);
        var previous = await ReadSliceAsync<PreviousProgramMaxesView>(coach, P4cPreviousMaxesUrl(scenario.ClientId));
        Assert.AreEqual(
            (block.Id, lift.Current.Id, 100m),
            (previous.MesocycleId, previous.Maxes.Single().MaxId, previous.Maxes.Single().Value));
        Assert.AreEqual(1L, await P2CountAsync("""SELECT count(*) FROM strength."WorkingMaxSnapshots" WHERE "MesocycleId" = @id""", block.Id));
    }

    [TestMethod]
    public async Task N10bAChangeOrAnAssignmentThatNamesOnlyALoggedSetIsRefusedAndWritesNothing()
    {
        R61aStartAtMidday();
        using var coach = CreateClient();
        using var client = CreateClient();
        // Three weeks, so finishing week 1 leaves the program open (finishing its last session closes it at once).
        var scenario = await P2CustomStartAsync(coach, client, "n10b-refused", P4bWeeks);
        var squat = scenario.Exercise.Id;
        var block = await P2AssignAsync(coach, scenario, [P2SavedMax(scenario)]);
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        var weekOne = await N10bLogTodaysSetsAsync(client);

        // Until N10b these bodies previewed and applied the 90 kg set's 110.974 kg. The server reads no logged set now,
        // so the lift has neither a number nor week 1's weight: refused for the maxes, with a fresh key and the
        // program's version, and nothing written.
        var version = (await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id))).Version;
        Assert.AreEqual(
            "Give Competition squat either a training max or week 1's weight.",
            await A7FieldErrorAsync(await P2PreviewAsync(coach, block.Id, version, P4bChange(squat, weekOne[1])), "maxes"));
        Assert.AreEqual(
            "Give Competition squat either a training max or week 1's weight.",
            await A7FieldErrorAsync(
                await P2ApplyAsync(coach, block.Id, version, [P4bChange(squat, weekOne[1])], null, new string('a', 64), Guid.NewGuid()),
                "maxes"));
        Assert.AreEqual(version, (await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id))).Version);
        Assert.AreEqual(1L, await P2CountAsync("""SELECT count(*) FROM strength."WorkingMaxSnapshots" WHERE "MesocycleId" = @id""", block.Id));
        Assert.AreEqual(0L, await P2CountAsync("""SELECT count(*) FROM strength."WorkingMaxUpdates" WHERE "MesocycleId" = @id""", block.Id));

        // Weeks 2 and 3 the same way; the last session closes the program on day 14. It keeps its dates, so the next
        // program starts when it ends, on day 21 (P4cAssignNextAsync starts on the test clock's day).
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        await N10bLogTodaysSetsAsync(client);
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        var weekThree = await N10bLogTodaysSetsAsync(client);
        Assert.AreEqual(MesocycleStatus.Completed, (await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id))).Status);
        Assert.IsTrue((await ReadSliceAsync<TrainingMaxesView>(coach, P2MaxesUrl(block.Id))).IsClosed, "A finished program's maxes are history.");
        RequiredTestClock.Advance(TimeSpan.FromDays(7));

        // Until N10b Assign program could start the next program from the last week's best set; now that max has
        // neither a number nor week 1's weight, and no program is made.
        Assert.AreEqual(
            "Give each training max either a number or week 1's weight.",
            await A7FieldErrorAsync(
                await P4cAssignNextAsync(coach, scenario, P4cFromLoggedSet(squat, weekThree[1]), Guid.NewGuid()),
                "assignment"));
        Assert.AreEqual(1L, await P2CountAsync("""SELECT count(*) FROM training."Mesocycles" WHERE "ClientProfileId" = @id""", scenario.ClientId));
        Assert.AreEqual(1L, await P2CountAsync("""SELECT count(*) FROM strength."WorkingMaxSnapshots" WHERE "ClientProfileId" = @id""", scenario.ClientId));
    }

    [TestMethod]
    public async Task N10bWhatWasStoredFromLoggedSetsReadsAsItDidAndKeepsItsGuards()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "n10b-stored", P4bWeeks);
        var squat = scenario.Exercise.Id;
        var block = await P2AssignAsync(coach, scenario, [P2SavedMax(scenario)]);
        var firstMaxId = block.WorkingMaxes.Single().Id;
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        var weekOne = await N10bLogTodaysSetsAsync(client);

        // A keep as P4c stored one, which nothing writes now: the coach kept 100 kg over week 1's best set, which
        // suggested 110.974 kg.
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        var keepId = Guid.NewGuid();
        await Phase6ExecuteAsync(
            """
            INSERT INTO strength."WorkingMaxKeeps" (
                "Id", "TenantId", "MesocycleId", "WorkingMaxSnapshotId", "LoggedSetPerformanceId",
                "SuggestedValue", "Unit", "CreatedAtUtc", "UpdatedAtUtc")
            SELECT @keep, "TenantId", "MesocycleId", "Id", @set, 110.974, "Unit", @at, @at
            FROM strength."WorkingMaxSnapshots" WHERE "Id" = @max
            """,
            ("keep", keepId),
            ("set", weekOne[1]),
            ("max", firstMaxId),
            ("at", RequiredTestClock.UtcNow));
        Assert.AreEqual(1L, await P2CountAsync("""SELECT count(*) FROM strength."WorkingMaxKeeps" WHERE "Id" = @id""", keepId));

        // The keeps keep their guards: one keep per max and set, a real value, a set that exists, and a keep is never
        // changed or removed. Each copy is of that one row.
        const string copy =
            """
            INSERT INTO strength."WorkingMaxKeeps" ("Id", "MesocycleId", "WorkingMaxSnapshotId", "LoggedSetPerformanceId", "SuggestedValue", "Unit", "CreatedAtUtc", "UpdatedAtUtc", "TenantId")
            SELECT gen_random_uuid(), "MesocycleId", "WorkingMaxSnapshotId", SET, VALUE, "Unit", "CreatedAtUtc", "UpdatedAtUtc", "TenantId"
            FROM strength."WorkingMaxKeeps" WHERE "Id" = @id
            """;
        (string, object)[] keep = [("id", keepId)];
        await N10bAssertRefusedByAsync(
            "23505",
            "IX_WorkingMaxKeeps_OneKeepPerMaxAndSet",
            copy.Replace("SET", "\"LoggedSetPerformanceId\"").Replace("VALUE", "\"SuggestedValue\""),
            keep);
        await N10bAssertRefusedByAsync(
            "23514",
            "CK_WorkingMaxKeeps_SuggestedValue",
            copy.Replace("SET", "gen_random_uuid()").Replace("VALUE", "0"),
            keep);
        await N10bAssertRefusedByAsync(
            "23503",
            "FK_WorkingMaxKeeps_WorkoutSetPerformances_TenantId_LoggedSetPe~",
            copy.Replace("SET", "gen_random_uuid()").Replace("VALUE", "\"SuggestedValue\""),
            keep);
        await AssertSqlStateAsync("55000", "UPDATE strength.\"WorkingMaxKeeps\" SET \"SuggestedValue\" = 1 WHERE \"Id\" = @id", keep);
        await AssertSqlStateAsync("55000", "DELETE FROM strength.\"WorkingMaxKeeps\" WHERE \"Id\" = @id", keep);

        // A week on, week 2's best set, logged after the keep, suggested 110.974 kg again and the coach applied it from
        // week 3: the max stored as P4b's apply stored it, the successor of the max in use naming that finished set.
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        var weekTwo = await N10bLogTodaysSetsAsync(client);
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        const string reason = "Estimated from logged sets, week 2: 90 kg for 5 reps at RPE 8.";
        var storedId = Guid.NewGuid();
        await N10bStoreLoggedSetMaxAsync(storedId, firstMaxId, block.Id, supersedes: true, weekTwo[1], 3, reason);

        // The panel reads it as before: from logged sets, with its set's week, day and session, the max it replaced
        // under Earlier.
        var lift = (await ReadSliceAsync<TrainingMaxesView>(coach, P2MaxesUrl(block.Id))).Maxes.Single();
        var stored = lift.Current;
        Assert.AreEqual(
            (storedId, 110.974m, TrainingMaxSource.LoggedSet, 3, today.AddDays(7), reason),
            (stored.Id, stored.Value, stored.Source, stored.EffectiveFromWeek, stored.SetOn, stored.Reason));
        Assert.IsNotNull(stored.Basis);
        Assert.AreEqual(
            (90m, 5, 8m, "RpeChart", "1.0"),
            (stored.Basis.Load, stored.Basis.Repetitions, stored.Basis.Rpe, stored.Basis.MethodKey, stored.Basis.MethodVersion));
        Assert.AreEqual(new TrainingMaxLoggedSetView(weekTwo[1], 2, today.AddDays(7), "Week 2 squat"), stored.Basis.LoggedSet);
        Assert.AreEqual((firstMaxId, TrainingMaxSource.SavedMax), (lift.Earlier.Single().Id, lift.Earlier.Single().Source));

        // The max history names it as the program's max from logged sets (STR-015).
        var history = await ReadSliceAsync<StrengthMaxPage>(coach, P4dHistoryUrl(scenario.ClientId, "?includeProgramMaxes=true"));
        var row = history.Items.Single(item => item.Id == storedId);
        Assert.AreEqual(
            (StrengthMaxKind.CoachWorkingMax, 110.974m, StrengthMaxSource.WorkoutSet, "RpeChart", "1.0", today.AddDays(7), reason),
            (row.Kind, row.Value, row.Source, row.MethodKey, row.MethodVersion, row.EffectiveDate, row.Note));
        Assert.AreEqual(new StrengthMaxProgramView(block.Id, block.Name, 3, WorkingMaxSource.LoggedSet), row.Program);

        // Its own guards stay: a max from a set keeps the set's numbers, the set it names must exist, and the set is
        // never taken off it.
        await N10bAssertRefusedByAsync(
            "23514",
            "CK_WorkingMaxSnapshots_LoggedSetBasis",
            P2CopySnapshotSql(
                storedId,
                $"r.\"Id\" := gen_random_uuid(); r.\"SupersedesSnapshotId\" := '{storedId}'; r.\"BasisLoad\" := NULL; r.\"BasisRepetitions\" := NULL; r.\"BasisRpe\" := NULL; r.\"EstimateMethodKey\" := NULL; r.\"EstimateMethodVersion\" := NULL;"));
        await N10bAssertRefusedByAsync(
            "23503",
            "FK_WorkingMaxSnapshots_WorkoutSetPerformances_TenantId_SourceS~",
            P2CopySnapshotSql(
                storedId,
                $"r.\"Id\" := gen_random_uuid(); r.\"SupersedesSnapshotId\" := '{storedId}'; r.\"SourceSetPerformanceId\" := gen_random_uuid();"));
        await AssertSqlStateAsync(
            "55000",
            "UPDATE strength.\"WorkingMaxSnapshots\" SET \"SourceSetPerformanceId\" = NULL WHERE \"Id\" = @id",
            ("id", storedId));

        // Assign program could start a next program's lift from the last program's set (STR-014, until N10b): the new
        // program's first max named a set no finished workout of that program holds, so the panel names no set and the
        // screen says it was logged in the last program. The next program here loads squat by hand, so assigning it
        // makes no max of its own and the stored one is its first.
        RequiredTestClock.Advance(TimeSpan.FromDays(14));
        var byHand = await PublishProgramAsync(coach, new
        {
            name = "n10b-stored by hand",
            description = (string?)null,
            weeks = new[] { P2Week("Week 1", squat, P1Set(1, "Direct", rpe: null, direct: 60m)) },
        });
        var nextKey = Guid.NewGuid();
        var nextUrl = $"/api/training/clients/{scenario.ClientId}/mesocycles";
        object NextBlock(params object[] workingMaxes) => new
        {
            enrollmentId = scenario.Enrollment.Id,
            templateVersionId = byHand.Id,
            startDate = P4bWorkspaceToday(),
            kind = "Primary",
            loadUnit = "Kilogram",
            loadIncrement = 2.5m,
            loadRoundingMode = "Nearest",
            workingMaxes,
            idempotencyKey = nextKey,
            name = "Next block",
        };
        await RefreshCsrfAsync(coach);
        var assigned = await coach.PostAsJsonAsync(nextUrl, NextBlock());
        await AssertStatusAsync(assigned, HttpStatusCode.OK);
        var next = await ReadSlicePayloadAsync<TrainingMesocycleView>(assigned);
        Assert.IsEmpty(next.WorkingMaxes);

        // The same body with its key replays the assignment, so the conflicts below come from the max alone.
        await RefreshCsrfAsync(coach);
        var replayed = await coach.PostAsJsonAsync(nextUrl, NextBlock());
        await AssertStatusAsync(replayed, HttpStatusCode.OK);
        Assert.AreEqual(next.Id, (await ReadSlicePayloadAsync<TrainingMesocycleView>(replayed)).Id);

        var startedId = Guid.NewGuid();
        await N10bStoreLoggedSetMaxAsync(
            startedId, firstMaxId, next.Id, supersedes: false, weekTwo[1], 1, $"From the previous program \"{block.Name}\". {reason}");

        // That assignment, recorded before N10b with its first max from the set, retried with its key now: Assign program's
        // body naming the set has no number (the server skips the set), and a typed number never replays onto a first max
        // from a set, so each is another request, a conflict, and no program is made.
        foreach (var max in new object[]
                 {
                     P4cFromLoggedSet(squat, weekTwo[1]),
                     new { exerciseId = squat, strengthMaxRecordId = (Guid?)null, value = (decimal?)110.974m, unit = "Kilogram", weekOneWeight = (decimal?)null },
                 })
        {
            await RefreshCsrfAsync(coach);
            await P2RefusedAsync(await coach.PostAsJsonAsync(nextUrl, NextBlock(max)), HttpStatusCode.Conflict, "idempotency_conflict");
        }

        Assert.AreEqual(2L, await P2CountAsync("""SELECT count(*) FROM training."Mesocycles" WHERE "ClientProfileId" = @id""", scenario.ClientId));
        var started = (await ReadSliceAsync<TrainingMaxesView>(coach, P2MaxesUrl(next.Id))).Maxes.Single().Current;
        Assert.AreEqual((startedId, 110.974m, TrainingMaxSource.LoggedSet), (started.Id, started.Value, started.Source));
        Assert.IsNotNull(started.Basis);
        Assert.AreEqual((90m, 5, 8m), (started.Basis.Load, started.Basis.Repetitions, started.Basis.Rpe));
        Assert.IsNull(started.Basis.LoggedSet, "A set of another program is never read as this program's.");
        history = await ReadSliceAsync<StrengthMaxPage>(coach, P4dHistoryUrl(scenario.ClientId, "?includeProgramMaxes=true"));
        Assert.AreEqual(
            new StrengthMaxProgramView(next.Id, next.Name, 1, WorkingMaxSource.LoggedSet),
            history.Items.Single(item => item.Id == startedId).Program);

        // With a keep and maxes from logged sets stored, no read sends a suggestion or a keep.
        await N10bAssertNoSuggestionAsync(coach, block.Id, scenario.ClientId);
        await N10bAssertNoSuggestionAsync(coach, next.Id, scenario.ClientId);
    }

    [TestMethod]
    public async Task N10bAnUpdatesRetryIsAnsweredByTheFingerprintItWasGiven()
    {
        R61aStartAtMidday();
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "n10b-retry", P4bWeeks);
        var squat = scenario.Exercise.Id;
        var block = await P2AssignAsync(coach, scenario, [P2SavedMax(scenario)]);
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        var logged = await N10bLogTodaysSetsAsync(client);
        var version = (await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id))).Version;

        // The web's body until N10b named no set with a null, which the server skips now; the retry sends the body the
        // web sends since, without it, and answers the first result.
        var sent = new { exerciseId = squat, value = (decimal?)120m, weekOneWeight = (decimal?)null, loggedSetId = (Guid?)null };
        var preview = await P2PreviewOkAsync(coach, block.Id, version, sent);
        var key = Guid.NewGuid();
        var first = await P2ApplyOkAsync(coach, block.Id, version, [sent], null, preview.PreviewHash, key);
        var retry = await P2ApplyOkAsync(coach, block.Id, version, [P2Change(squat, value: 120m)], null, preview.PreviewHash, key);
        Assert.AreEqual(first.Version, retry.Version);
        Assert.HasCount(2, retry.WorkingMaxes);
        Assert.AreEqual(1L, await P2CountAsync("""SELECT count(*) FROM strength."WorkingMaxUpdates" WHERE "MesocycleId" = @id""", block.Id));

        // The key stays bound to its payload: another number, or a body naming a set (no number now), is another
        // request. The key is looked up before the change is checked, so each is a conflict, not a refusal.
        await P2RefusedAsync(
            await P2ApplyAsync(coach, block.Id, version, [P2Change(squat, value: 125m)], null, preview.PreviewHash, key),
            HttpStatusCode.Conflict,
            "idempotency_conflict");
        await P2RefusedAsync(
            await P2ApplyAsync(coach, block.Id, version, [P4bChange(squat, logged[1])], null, preview.PreviewHash, key),
            HttpStatusCode.Conflict,
            "idempotency_conflict");

        // The fingerprint keeps the bytes code before N10b stored for this request, its logged set null, so an update
        // sent before the change and retried after it finds its first result.
        Assert.AreEqual(
            N10bFingerprintBeforeN10b(block.Id, version, squat, "120", null, preview.PreviewHash),
            await Phase6ScalarAsync<string>("""SELECT "RequestFingerprint" FROM strength."WorkingMaxUpdates" WHERE "IdempotencyKey" = @id""", key));

        // An applied suggestion recorded before N10b bound its key to the set it named. Its retry names a set the
        // server no longer reads, so it is another request: a conflict, and nothing is written.
        var suggestionKey = Guid.NewGuid();
        var suggestionFingerprint = N10bFingerprintBeforeN10b(block.Id, version, squat, null, logged[1], preview.PreviewHash);
        await Phase6ExecuteAsync(
            $$"""
            DO $$
            DECLARE r strength."WorkingMaxUpdates"%ROWTYPE;
            BEGIN
                SELECT * INTO r FROM strength."WorkingMaxUpdates" WHERE "IdempotencyKey" = '{{key}}';
                r."Id" := gen_random_uuid();
                r."IdempotencyKey" := '{{suggestionKey}}';
                r."RequestFingerprint" := '{{suggestionFingerprint}}';
                INSERT INTO strength."WorkingMaxUpdates" SELECT r.*;
            END $$;
            """);
        await P2RefusedAsync(
            await P2ApplyAsync(coach, block.Id, version, [P4bChange(squat, logged[1])], null, preview.PreviewHash, suggestionKey),
            HttpStatusCode.Conflict,
            "idempotency_conflict");
        Assert.AreEqual(2L, await P2CountAsync("""SELECT count(*) FROM strength."WorkingMaxUpdates" WHERE "MesocycleId" = @id""", block.Id));
        Assert.AreEqual(2L, await P2CountAsync("""SELECT count(*) FROM strength."WorkingMaxSnapshots" WHERE "MesocycleId" = @id""", block.Id));
    }

    [TestMethod]
    public async Task N10bTheApiDocumentDescribesNoSuggestionNoKeepAndNoLoggedSetOnAChange()
    {
        using var visitor = CreateClient();
        using var document = JsonDocument.Parse(await visitor.GetStringAsync("/openapi/v1.json", TestContext.CancellationToken));
        var paths = document.RootElement.GetProperty("paths");
        var schemas = document.RootElement.GetProperty("components").GetProperty("schemas");
        var operations = paths.EnumerateObject()
            .SelectMany(path => path.Value.EnumerateObject())
            .Where(operation => operation.Value.ValueKind == JsonValueKind.Object &&
                                operation.Value.TryGetProperty("operationId", out _))
            .Select(operation => operation.Value.GetProperty("operationId").GetString())
            .ToHashSet(StringComparer.Ordinal);

        // What stays is described, so each absence below is looked for where it would be.
        foreach (var name in new[] { "GetTrainingMaxes", "PreviewTrainingMaxes", "ApplyTrainingMaxes", "GetPreviousProgramMaxes" })
        {
            Assert.Contains(name, operations, $"The document lost {name}.");
        }

        Assert.IsTrue(paths.TryGetProperty("/api/training/mesocycles/{mesocycleId}/training-maxes/apply", out _));

        // No keep, as an operation, a path or a request, and no suggestion or kept line as a schema.
        Assert.DoesNotContain("KeepTrainingMax", operations, "The document still describes the keep.");
        Assert.IsFalse(
            paths.EnumerateObject().Any(path => path.Name.EndsWith("/training-maxes/keep", StringComparison.Ordinal)),
            "The document still has the keep's path.");
        foreach (var name in new[] { "TrainingMaxSuggestionView", "TrainingMaxKeptView", "KeepTrainingMaxRequest" })
        {
            Assert.IsFalse(schemas.TryGetProperty(name, out _), $"The document still describes {name}.");
        }

        // A change and an assignment's max name no logged set, a lift and a previous program's max carry no suggestion,
        // and a stored max's basis still names its set.
        foreach (var (name, kept, gone) in N10bSchemas)
        {
            Assert.IsTrue(schemas.TryGetProperty(name, out var schema), $"The document lost {name}.");
            var properties = schema.GetProperty("properties");
            foreach (var property in kept)
            {
                Assert.IsTrue(properties.TryGetProperty(property, out _), $"{name} lost {property}.");
            }

            var required = schema.TryGetProperty("required", out var list)
                ? list.EnumerateArray().Select(item => item.GetString()).ToArray()
                : Array.Empty<string?>();
            foreach (var property in gone)
            {
                Assert.IsFalse(properties.TryGetProperty(property, out _), $"{name} still has {property}.");
                Assert.DoesNotContain(property, required, $"{name} still requires {property}.");
            }
        }
    }

    // ---------- N10b helpers ----------

    /// <summary>Today's session of the P4b sets, finished: the warm-up, 90 kg for 5 at RPE 8, then 85 kg for 5 at RPE 8.5.</summary>
    private static Task<Guid[]> N10bLogTodaysSetsAsync(HttpClient client) =>
        P4bLogTodayAsync(
            client,
            finish: true,
            new P4bLog(5, 60m, "Kilogram", null),
            new P4bLog(5, 90m, "Kilogram", 8m),
            new P4bLog(5, 85m, "Kilogram", 8.5m));

    /// <summary>
    /// Asserts that a program's Training maxes send no "suggestion" and no "kept" key, and the client's previous maxes
    /// no "suggestion". Typed reads skip a member they do not know and the API writes nulls, so before N10b every lift
    /// carried both keys, null or not, and only the text proves them gone.
    /// </summary>
    private static async Task N10bAssertNoSuggestionAsync(HttpClient coach, Guid mesocycleId, Guid clientId)
    {
        var panel = await coach.GetStringAsync(P2MaxesUrl(mesocycleId));
        StringAssert.Contains(panel, "\"earlier\"");
        Assert.DoesNotContain("\"suggestion\"", panel, StringComparison.OrdinalIgnoreCase, "The Training maxes send a suggestion.");
        Assert.DoesNotContain("\"kept\"", panel, StringComparison.OrdinalIgnoreCase, "The Training maxes send a keep.");
        var previous = await coach.GetStringAsync(P4cPreviousMaxesUrl(clientId));
        StringAssert.Contains(previous, "\"maxId\"");
        Assert.DoesNotContain("\"suggestion\"", previous, StringComparison.OrdinalIgnoreCase, "Previous maxes send a suggestion.");
    }

    /// <summary>
    /// Stores a max as code before N10b stored one from a logged set: 110.974 kg from 90 kg for 5 at RPE 8 on the RTS
    /// chart, naming <paramref name="setId"/>, with no saved or carried max behind it. It supersedes
    /// <paramref name="fromMaxId"/> (an applied suggestion, P4b) or starts <paramref name="mesocycleId"/>'s chain (Assign
    /// program's start from the last program's set, P4c); the tenant, client, lift and unit are that max's.
    /// </summary>
    private async Task N10bStoreLoggedSetMaxAsync(
        Guid id,
        Guid fromMaxId,
        Guid mesocycleId,
        bool supersedes,
        Guid setId,
        int fromWeek,
        string reason)
    {
        var supersedesColumn = supersedes ? "\"Id\"" : "NULL";
        await Phase6ExecuteAsync(
            $$"""
            INSERT INTO strength."WorkingMaxSnapshots" (
                "Id", "TenantId", "MesocycleId", "ClientProfileId", "ExerciseId",
                "SupersedesSnapshotId", "SourceMaxRecordId", "SourceSetPerformanceId", "CarriedFromSnapshotId",
                "Value", "Unit", "EffectiveFromWeek", "Reason",
                "BasisLoad", "BasisRepetitions", "BasisRpe", "EstimateMethodKey", "EstimateMethodVersion",
                "CreatedAtUtc", "UpdatedAtUtc")
            SELECT @id, "TenantId", @program, "ClientProfileId", "ExerciseId",
                {{supersedesColumn}}, NULL, @set, NULL,
                110.974, "Unit", @week, @reason,
                90, 5, 8, 'RpeChart', '1.0',
                @at, @at
            FROM strength."WorkingMaxSnapshots" WHERE "Id" = @from
            """,
            ("id", id),
            ("from", fromMaxId),
            ("program", mesocycleId),
            ("set", setId),
            ("week", fromWeek),
            ("reason", reason),
            ("at", RequiredTestClock.UtcNow));

        // An INSERT that selects nothing raises nothing, so the row is counted.
        Assert.AreEqual(
            1L,
            await P2CountAsync("""SELECT count(*) FROM strength."WorkingMaxSnapshots" WHERE "Id" = @id AND "SourceSetPerformanceId" IS NOT NULL""", id));
    }

    /// <summary>Asserts that the statement is refused with <paramref name="sqlState"/> by <paramref name="constraint"/>.</summary>
    private async Task N10bAssertRefusedByAsync(
        string sqlState,
        string constraint,
        string sql,
        params (string Name, object Value)[] parameters)
    {
        var failure = await Assert.ThrowsExactlyAsync<PostgresException>(() => Phase6ExecuteAsync(sql, parameters));
        Assert.AreEqual(sqlState, failure.SqlState, failure.MessageText);
        Assert.AreEqual(constraint, failure.ConstraintName, failure.MessageText);
    }

    /// <summary>
    /// The fingerprint that bound a max update's idempotency key before N10b (MaxRequestFingerprint since P4b): these
    /// bytes, SHA-256, lowercase hex. One change and no reason, which the server writes as "".
    /// </summary>
    private static string N10bFingerprintBeforeN10b(
        Guid mesocycleId,
        uint version,
        Guid exerciseId,
        string? value,
        Guid? loggedSetId,
        string previewHash)
    {
        var json =
            $$"""{"mesocycleId":"{{mesocycleId}}","mesocycleVersion":{{version}},"changes":[{"exerciseId":"{{exerciseId}}","value":{{N10bJsonText(value)}},"weekOneWeight":null,"loggedSetId":{{N10bJsonText(loggedSetId)}}}],"reason":"","previewHash":"{{previewHash}}"}""";
        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(json)));
    }

    /// <summary>A JSON string of the value's text, or null.</summary>
    private static string N10bJsonText(object? value) => value is null ? "null" : $"\"{value}\"";
}
