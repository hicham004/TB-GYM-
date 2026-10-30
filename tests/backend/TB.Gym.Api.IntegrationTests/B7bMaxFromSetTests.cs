using System.Net;
using System.Net.Http.Json;
using Npgsql;
using MaxFromSetView = TB.Gym.Modules.Strength.MaxFromSetView;
using OneRepMaxEstimateView = TB.Gym.Modules.Strength.OneRepMaxEstimateView;
using StrengthLoadUnit = TB.Gym.Modules.Strength.LoadUnit;
using StrengthMaxKind = TB.Gym.Modules.Strength.StrengthMaxKind;
using StrengthMaxPage = TB.Gym.Modules.Strength.StrengthMaxPage;
using StrengthMaxSource = TB.Gym.Modules.Strength.StrengthMaxSource;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Critique B7b (STR-017): a coach records a max from a set the client did, weight × reps, 1 to 10 reps. The
/// server works the Estimated 1RM out by Epley v1 and, when asked, a training max at 90 % of it by
/// TrainingMaxShare v1, in one save; each keeps the numbers it came from, and the database checks them. The
/// typed route never takes an estimate (STR-001).
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    /// <summary>100 kg × 5 and 110 kg × 3 by Epley v1.</summary>
    private static readonly decimal[] B7bRacedEstimates = [116.667m, 121m];

    private static string B7bFromSetUrl(Guid clientId) => $"/api/strength/clients/{clientId}/maxes/from-set";

    private static object B7bSet(
        Guid exerciseId,
        decimal load,
        int repetitions,
        DateOnly day,
        bool alsoSetTrainingMax = true,
        string unit = "Kilogram",
        string? note = null) =>
        new { exerciseId, load, repetitions, unit, effectiveDate = day, alsoSetTrainingMax, note };

    [TestMethod]
    public async Task B7bASetTheyDidRecordsItsEstimateAndATrainingMaxAtNinetyPercentOfIt()
    {
        var today = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b7b-set-owner@example.test", "Karim Haddad", "B7b From A Set");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(owner, maya, tenant, "b7b-set-maya@example.test", "Maya", "Fakhoury");
        var squat = await CreateExerciseAsync(owner, "Back squat", [], []);

        await RefreshCsrfAsync(owner);
        var saved = await ReadSlicePayloadAsync<MaxFromSetView>(await owner.PostAsJsonAsync(
            B7bFromSetUrl(mayaId), B7bSet(squat.Id, 100m, 5, today.AddDays(-3), note: "Belt, after the deload.")));

        var estimate = saved.Estimate;
        Assert.AreEqual(
            (StrengthMaxKind.EstimatedOneRepMax, 116.667m, StrengthLoadUnit.Kilogram, StrengthMaxSource.Calculation, "Epley", "1.0", today.AddDays(-3)),
            (estimate.Kind, estimate.Value, estimate.Unit, estimate.Source, estimate.MethodKey, estimate.MethodVersion, estimate.EffectiveDate));
        Assert.AreEqual(new TB.Gym.Modules.Strength.StrengthMaxSetView(100m, 5), estimate.Basis);
        Assert.IsNull(estimate.FromEstimate);
        Assert.AreEqual(("Belt, after the deload.", "Back squat", mayaId), (estimate.Note, estimate.ExerciseName, estimate.ClientProfileId));

        var trainingMax = saved.TrainingMax ?? throw new AssertFailedException("The training max was not recorded.");
        Assert.AreEqual(
            (StrengthMaxKind.CoachWorkingMax, 105m, StrengthLoadUnit.Kilogram, StrengthMaxSource.Calculation, "TrainingMaxShare", "1.0", today.AddDays(-3)),
            (trainingMax.Kind, trainingMax.Value, trainingMax.Unit, trainingMax.Source, trainingMax.MethodKey, trainingMax.MethodVersion, trainingMax.EffectiveDate));
        Assert.AreEqual(new TB.Gym.Modules.Strength.StrengthMaxFromEstimateView(estimate.Id, 116.667m, 90m), trainingMax.FromEstimate);
        Assert.IsNull(trainingMax.Basis);
        Assert.IsNull(trainingMax.Note);

        // Both are in the client's history, as recorded maxes: Assign program offers the training max as a saved max.
        var history = await ReadSliceAsync<StrengthMaxPage>(owner, $"/api/strength/clients/{mayaId}/maxes");
        Assert.AreEqual(2, history.Total);
        CollectionAssert.AreEquivalent(new[] { estimate.Id, trainingMax.Id }, history.Items.Select(item => item.Id).ToArray());
        var listed = history.Items.Single(item => item.Id == trainingMax.Id);
        Assert.AreEqual((estimate.Id, 116.667m, 90m), (listed.FromEstimate!.EstimateId, listed.FromEstimate.Estimate, listed.FromEstimate.Percent));
        Assert.AreEqual((100m, 5), (history.Items.Single(item => item.Id == estimate.Id).Basis!.Load, history.Items.Single(item => item.Id == estimate.Id).Basis!.Repetitions));

        // The calculator the sheet shows its figures from gives the same numbers before anything is saved (INV-9).
        await RefreshCsrfAsync(owner);
        var preview = await ReadSlicePayloadAsync<OneRepMaxEstimateView>(await owner.PostAsJsonAsync(
            "/api/strength/estimate-one-rep-max", new { load = 100m, repetitions = 5, unit = "Kilogram", methodKey = "Epley" }));
        Assert.AreEqual((116.667m, "Epley v1: 100 kg × (1 + 5 / 30) = 116.667 kg."), (preview.Estimate, preview.Explanation));
        Assert.AreEqual(
            (105m, 90m, "TrainingMaxShare", "1.0", "TrainingMaxShare v1: 90% of 116.667 kg = 105 kg."),
            (preview.TrainingMax!.Value, preview.TrainingMax.Percent, preview.TrainingMax.MethodKey, preview.TrainingMax.MethodVersion, preview.TrainingMax.Explanation));
    }

    [TestMethod]
    public async Task B7bWithoutTheBoxOnlyTheEstimateIsRecordedAndPoundsStayPounds()
    {
        var today = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b7b-alone-owner@example.test", "Karim Haddad", "B7b Estimate Alone");
        using var sami = CreateClient();
        var samiId = await R31InviteAsync(owner, sami, tenant, "b7b-alone-sami@example.test", "Sami", "Aoun");
        var bench = await CreateExerciseAsync(owner, "Bench press", [], []);

        await RefreshCsrfAsync(owner);
        var saved = await ReadSlicePayloadAsync<MaxFromSetView>(await owner.PostAsJsonAsync(
            B7bFromSetUrl(samiId), B7bSet(bench.Id, 195m, 4, today, alsoSetTrainingMax: false, unit: "Pound")));

        Assert.AreEqual((221m, StrengthLoadUnit.Pound, StrengthMaxKind.EstimatedOneRepMax), (saved.Estimate.Value, saved.Estimate.Unit, saved.Estimate.Kind));
        Assert.IsNull(saved.TrainingMax);
        Assert.AreEqual(1, (await ReadSliceAsync<StrengthMaxPage>(owner, $"/api/strength/clients/{samiId}/maxes")).Total);

        // A single is the max itself.
        await RefreshCsrfAsync(owner);
        var single = await ReadSlicePayloadAsync<MaxFromSetView>(await owner.PostAsJsonAsync(
            B7bFromSetUrl(samiId), B7bSet(bench.Id, 102.5m, 1, today)));
        Assert.AreEqual((102.5m, 92.25m), (single.Estimate.Value, single.TrainingMax!.Value));
    }

    [TestMethod]
    public async Task B7bASetPastTenRepsAFutureDayOrALiftNoLongerInTheLibraryIsRefusedInWords()
    {
        var today = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b7b-refuse-owner@example.test", "Karim Haddad", "B7b Refusals");
        using var lynn = CreateClient();
        var lynnId = await R31InviteAsync(owner, lynn, tenant, "b7b-refuse-lynn@example.test", "Lynn", "Bou Khalil");
        var squat = await CreateExerciseAsync(owner, "Back squat", [], []);
        var lunge = await CreateExerciseAsync(owner, "Walking lunge", [], []);

        foreach (var (body, field, words) in new (object, string, string)[]
        {
            (B7bSet(squat.Id, 80m, 11, today), "repetitions", "1 to 10 reps"),
            (B7bSet(squat.Id, 80m, 0, today), "repetitions", "1 to 10 reps"),
            (B7bSet(squat.Id, 0m, 5, today), "load", "The weight must be more than 0 and at most 2,000."),
            (B7bSet(squat.Id, 1_600m, 10, today), "load", "That set works out to a max of more than 2,000."),
            (B7bSet(squat.Id, 100m, 5, today.AddDays(1)), "effectiveDate", "A max from a set is for today or a day that has passed."),
            (B7bSet(squat.Id, 100m, 5, today, note: new string('n', 1_001)), "note", "1000 characters"),
        })
        {
            await RefreshCsrfAsync(owner);
            var refused = await owner.PostAsJsonAsync(B7bFromSetUrl(lynnId), body);
            var errors = await B7bErrorsAsync(refused);
            Assert.IsTrue(errors.ContainsKey(field), $"{field}: {string.Join(", ", errors.Keys)}");
            StringAssert.Contains(string.Join(" ", errors[field]), words);
        }

        // An archived lift and a lift of no library are not found, as Record a max answers them.
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PutAsJsonAsync($"/api/exercises/{lunge.Id}/archive", new { isArchived = true, version = lunge.Version }),
            HttpStatusCode.OK);
        foreach (var exerciseId in new[] { lunge.Id, Guid.NewGuid() })
        {
            await RefreshCsrfAsync(owner);
            await AssertStatusAsync(
                await owner.PostAsJsonAsync(B7bFromSetUrl(lynnId), B7bSet(exerciseId, 60m, 8, today)),
                HttpStatusCode.NotFound);
        }

        Assert.AreEqual(0, (await ReadSliceAsync<StrengthMaxPage>(owner, $"/api/strength/clients/{lynnId}/maxes")).Total);
    }

    [TestMethod]
    public async Task B7bTheTypedRouteNeverTakesAnEstimateNorCallsATypedMaxACalculation()
    {
        var today = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b7b-typed-owner@example.test", "Karim Haddad", "B7b Typed");
        using var rami = CreateClient();
        var ramiId = await R31InviteAsync(owner, rami, tenant, "b7b-typed-rami@example.test", "Rami", "Nasser");
        var squat = await CreateExerciseAsync(owner, "Back squat", [], []);
        object Typed(string kind, string source, string? methodKey) => new
        {
            exerciseId = squat.Id,
            kind,
            value = 116.667m,
            unit = "Kilogram",
            effectiveDate = today,
            source,
            methodKey,
            methodVersion = methodKey is null ? null : "1.0",
            sourceWorkoutExecutionId = (Guid?)null,
            note = (string?)null,
        };

        foreach (var (body, words) in new (object, string)[]
        {
            (Typed("EstimatedOneRepMax", "Calculation", "Epley"), "never typed"),
            (Typed("EstimatedOneRepMax", "WorkoutSet", "Epley"), "never typed"),
            (Typed("CoachWorkingMax", "Calculation", null), "from a set they did"),
            (Typed("TestedOneRepMax", "Calculation", null), "from a set they did"),
        })
        {
            await RefreshCsrfAsync(owner);
            StringAssert.Contains(await A3RefusalAsync(
                await owner.PostAsJsonAsync($"/api/strength/clients/{ramiId}/maxes", body),
                HttpStatusCode.BadRequest), words);
        }

        // A training max or a tested max typed by hand is recorded as before.
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync($"/api/strength/clients/{ramiId}/maxes", Typed("TestedOneRepMax", "Manual", null)),
            HttpStatusCode.OK);
        Assert.AreEqual(1, (await ReadSliceAsync<StrengthMaxPage>(owner, $"/api/strength/clients/{ramiId}/maxes")).Total);
    }

    [TestMethod]
    public async Task B7bAnotherCoachAnotherWorkspaceSignedOutOrAReleasedClientRecordsNothing()
    {
        var today = R61aStartAtMidday();
        using var owner = CreateClient();
        var workspaceId = await RegisterCoachAsync(owner, "b7b-scope-owner@example.test", "B7b Owner", "B7b Scope Gym");
        using var coach = CreateClient();
        await JoinAsCoachAsync(owner, coach, "b7b-scope-coach@example.test", "Pat Coach");
        using var otherCoach = CreateClient();
        await JoinAsCoachAsync(owner, otherCoach, "b7b-scope-other@example.test", "Sam Coach");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "b7b-scope-client@example.test", newAccount: true);
        var squat = await CreateExerciseAsync(coach, "Competition squat", [], []);
        var url = B7bFromSetUrl(clientId);
        var set = B7bSet(squat.Id, 100m, 5, today);

        // Another coach of the team (ADR 0026) is answered as if the client did not exist.
        await RefreshCsrfAsync(otherCoach);
        await AssertStatusAsync(await otherCoach.PostAsJsonAsync(url, set), HttpStatusCode.NotFound);

        // A coach of another workspace: not found in their own, forbidden naming this one.
        using var stranger = CreateClient();
        await RegisterCoachAsync(stranger, "b7b-scope-stranger@example.test", "B7b Stranger", "B7b Stranger Gym");
        await RefreshCsrfAsync(stranger);
        await AssertStatusAsync(await stranger.PostAsJsonAsync(url, set), HttpStatusCode.NotFound);
        SetTenant(stranger, workspaceId);
        await RefreshCsrfAsync(stranger);
        await AssertStatusAsync(await stranger.PostAsJsonAsync(url, set), HttpStatusCode.Forbidden);

        // Signed out, and the client themselves, are refused.
        using var anonymous = CreateClient();
        SetTenant(anonymous, workspaceId);
        await AssertStatusAsync(await anonymous.PostAsJsonAsync(url, set), HttpStatusCode.Unauthorized);
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(await client.PostAsJsonAsync(url, set), HttpStatusCode.Forbidden);

        // Without the token the write is refused before anything is worked out.
        coach.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
        Assert.AreEqual("antiforgery_token_invalid", (await A10AnswerAsync(await coach.PostAsJsonAsync(url, set), HttpStatusCode.BadRequest)).Code);

        // A released client is read-only for everyone (ADR 0027): the owner is told so, and their coach no longer
        // reaches them at all.
        await ReleaseAsync(owner, clientId, "Moved away");
        await RefreshCsrfAsync(owner);
        Assert.AreEqual("client_released", (await A10AnswerAsync(await owner.PostAsJsonAsync(url, set), HttpStatusCode.Conflict)).Code);
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PostAsJsonAsync(url, set), HttpStatusCode.NotFound);

        Assert.AreEqual(0, (await ReadSliceAsync<StrengthMaxPage>(owner, $"/api/strength/clients/{clientId}/maxes")).Total);
    }

    [TestMethod]
    public async Task B7bTwoSavesAtOnceAreBothKeptEachTrainingMaxNamingItsOwnEstimate()
    {
        var today = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b7b-race-owner@example.test", "Karim Haddad", "B7b Race");
        using var nour = CreateClient();
        var nourId = await R31InviteAsync(owner, nour, tenant, "b7b-race-nour@example.test", "Nour", "Khalil");
        var squat = await CreateExerciseAsync(owner, "Back squat", [], []);

        // The token is refreshed once, before both requests go out together.
        await RefreshCsrfAsync(owner);
        var answers = await Task.WhenAll(
            owner.PostAsJsonAsync(B7bFromSetUrl(nourId), B7bSet(squat.Id, 100m, 5, today)),
            owner.PostAsJsonAsync(B7bFromSetUrl(nourId), B7bSet(squat.Id, 110m, 3, today)));
        var saved = new List<MaxFromSetView>();
        foreach (var answer in answers)
        {
            saved.Add(await ReadSlicePayloadAsync<MaxFromSetView>(answer));
        }

        CollectionAssert.AreEquivalent(B7bRacedEstimates, saved.Select(item => item.Estimate.Value).ToArray());
        foreach (var item in saved)
        {
            Assert.AreEqual(item.Estimate.Id, item.TrainingMax!.FromEstimate!.EstimateId);
            Assert.AreEqual(TB.Gym.Modules.Strength.TrainingMaxShare.Apply(item.Estimate.Value), item.TrainingMax.Value);
        }

        Assert.AreEqual(4, (await ReadSliceAsync<StrengthMaxPage>(owner, $"/api/strength/clients/{nourId}/maxes")).Total);
    }

    [TestMethod]
    public async Task B7bTheDatabaseKeepsATrainingMaxToItsEstimateAndNeverChangesEither()
    {
        var today = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b7b-guard-owner@example.test", "Karim Haddad", "B7b Guards");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(owner, maya, tenant, "b7b-guard-maya@example.test", "Maya", "Fakhoury");
        using var omar = CreateClient();
        var omarId = await R31InviteAsync(owner, omar, tenant, "b7b-guard-omar@example.test", "Omar", "Nasser");
        var squat = await CreateExerciseAsync(owner, "Back squat", [], []);
        await RefreshCsrfAsync(owner);
        var saved = await ReadSlicePayloadAsync<MaxFromSetView>(await owner.PostAsJsonAsync(
            B7bFromSetUrl(mayaId), B7bSet(squat.Id, 100m, 5, today)));
        var estimateId = saved.Estimate.Id;
        var trainingMaxId = saved.TrainingMax!.Id;

        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();

        // Append-only, as every max is (STR-001).
        await A6AssertSqlRefusedAsync(connection, "UPDATE strength.\"MaxHistory\" SET \"Value\" = 110 WHERE \"Id\" = @id", trainingMaxId, PostgresErrorCodes.ObjectNotInPrerequisiteState);
        await A6AssertSqlRefusedAsync(connection, "DELETE FROM strength.\"MaxHistory\" WHERE \"Id\" = @id", estimateId, PostgresErrorCodes.ObjectNotInPrerequisiteState);

        string TrainingMaxRow(Guid clientId, decimal value, decimal estimate, decimal share) => $"""
            INSERT INTO strength."MaxHistory" ("Id", "TenantId", "ClientProfileId", "ExerciseId", "Kind", "Value", "Unit",
                "EffectiveDate", "Source", "MethodKey", "MethodVersion", "SourceEstimateId", "EstimateValue", "SharePercent")
            VALUES (gen_random_uuid(), '{tenant}', '{clientId}', '{squat.Id}', 'CoachWorkingMax', {value}, 'Kilogram',
                CURRENT_DATE, 'Calculation', 'TrainingMaxShare', '1.0', @id, {estimate}, {share})
            """;

        // The training max is exactly its share of the estimate, and the estimate it names is this client's, this
        // lift's and of the value it kept.
        await A6AssertSqlRefusedAsync(connection, TrainingMaxRow(mayaId, 110m, 116.667m, 90m), estimateId, PostgresErrorCodes.CheckViolation);
        await A6AssertSqlRefusedAsync(connection, TrainingMaxRow(mayaId, 135m, 150m, 90m), estimateId, PostgresErrorCodes.ForeignKeyViolation);
        await A6AssertSqlRefusedAsync(connection, TrainingMaxRow(omarId, 105m, 116.667m, 90m), estimateId, PostgresErrorCodes.ForeignKeyViolation);
        await A6AssertSqlRefusedAsync(connection, TrainingMaxRow(mayaId, 105m, 116.667m, 90m).Replace("'CoachWorkingMax'", "'TestedOneRepMax'", StringComparison.Ordinal), estimateId, PostgresErrorCodes.CheckViolation);

        string EstimateRow(decimal value, decimal load, int repetitions) => $"""
            INSERT INTO strength."MaxHistory" ("Id", "TenantId", "ClientProfileId", "ExerciseId", "Kind", "Value", "Unit",
                "EffectiveDate", "Source", "MethodKey", "MethodVersion", "BasisLoad", "BasisRepetitions")
            VALUES (gen_random_uuid(), '{tenant}', '{mayaId}', '{squat.Id}', 'EstimatedOneRepMax', {value}, 'Kilogram',
                CURRENT_DATE, 'Calculation', 'Epley', '1.0', {load}, {repetitions})
            """;

        // An estimate keeps a set of 1 to 10 reps and never falls below the weight lifted or past 4/3 of it.
        await A6AssertSqlRefusedAsync(connection, EstimateRow(106.667m, 80m, 11), null, PostgresErrorCodes.CheckViolation);
        await A6AssertSqlRefusedAsync(connection, EstimateRow(95m, 100m, 5), null, PostgresErrorCodes.CheckViolation);
        await A6AssertSqlRefusedAsync(connection, EstimateRow(140m, 100m, 5), null, PostgresErrorCodes.CheckViolation);
        await A6AssertSqlRefusedAsync(connection, EstimateRow(116.667m, 100m, 5).Replace("'Calculation'", "'Manual'", StringComparison.Ordinal), null, PostgresErrorCodes.CheckViolation);

        Assert.AreEqual(2, (await ReadSliceAsync<StrengthMaxPage>(owner, $"/api/strength/clients/{mayaId}/maxes")).Total);
    }

    private static async Task<Dictionary<string, string[]>> B7bErrorsAsync(HttpResponseMessage response)
    {
        await AssertStatusAsync(response, HttpStatusCode.BadRequest);
        var problem = await response.Content.ReadFromJsonAsync<B7bProblem>(SliceReadJson)
            ?? throw new AssertFailedException("The refusal had no body.");
        return problem.Errors ?? [];
    }

    private sealed record B7bProblem(Dictionary<string, string[]>? Errors);
}
