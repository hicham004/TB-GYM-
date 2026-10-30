using System.Net;
using System.Net.Http.Json;
using TB.Gym.Modules.Nutrition;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Critique B8a (NUT-015): energy model version 2 on the server, built switched off. While version 1 is in force a new
/// calculation is worked out as it always was and version 2's inputs are refused in words. Switched on (the tests
/// named B8aV2), a calculation uses the new table or the coach's own multiplier and says beside the multiplier how it
/// came about, with what the steps are worth, the goal's rate and the energy floors; the coach's choice is kept
/// append-only with their reason; and the targets sheet's numbers are worked out as the coach types, recorded nowhere,
/// for the workspace's staff alone.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string B8aEnergyModelUrl = "/api/nutrition/energy-model";
    private const string B8aPreviewUrl = "/api/nutrition/energy-preview";

    private static readonly OccupationActivityType[] B8aVersionOneKinds =
        [OccupationActivityType.Seated, OccupationActivityType.Mixed, OccupationActivityType.Physical];

    private static readonly OccupationActivityType[] B8aVersionTwoKinds =
        [OccupationActivityType.Seated, OccupationActivityType.Mixed, OccupationActivityType.OnTheirFeet, OccupationActivityType.HeavyManual];

    /// <summary>A 50 kg woman of 60 on a 500 kcal cut under version 2: 961 a day, under both floors.</summary>
    private static readonly string[] B8aSmallWomansFloors =
    [
        "The target, 961 calories a day, is under what their body burns at rest (1,008). This is a warning, not a clinical determination.",
        "The target, 961 calories a day, is under 1,200, the floor most calculators keep for women. This is a warning, not a clinical determination.",
    ];

    /// <summary>The targets sheet's five goal picks for Toufic's Elie, who burns 3,160.92 a day under version 2.</summary>
    private static readonly string[] B8aElieGoals =
    [
        "−500 a day ≈ 0.5 kg a week, 84% of what they burn",
        "−300 a day ≈ 0.3 kg a week, 91% of what they burn",
        "0 a day ≈ no change in weight, 100% of what they burn",
        "+250 a day ≈ 0.2 kg a week, 108% of what they burn",
        "+400 a day ≈ 0.4 kg a week, 113% of what they burn",
    ];

    private static readonly decimal[] B8aGoalPicks = [-500m, -300m, 0m, 250m, 400m];

    private const string B8aPhysicalRefusal =
        "Physical work is split in two now: choose on their feet (teaching, retail, nursing, serving) or heavy manual work (building, farm, moving loads).";

    private const string B8aWorkoutsRefusal = "Say how many workouts a week they do, from 0 to 7.";

    [TestMethod]
    public async Task B8aVersionOneStaysInForceUntilVersionTwoIsSwitchedOn()
    {
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "b8a-one-coach@example.test", "Hicham Haddad", "B8a One");
        using var nour = CreateClient();
        var nourId = await R31InviteAsync(coach, nour, tenant, "b8a-one-nour@example.test", "Nour", "Fares");
        await R53dStartNutritionAsync(coach, nourId);

        // The sheet is told what version 1 takes: its three kinds of work, no workouts, no multiplier of the coach's own.
        var model = await ReadSliceAsync<EnergyModelView>(coach, B8aEnergyModelUrl);
        Assert.AreEqual(
            (1, OccupationStepsActivityModel.Key, "1.0", (int?)null, (CoachChosenPalView?)null),
            (model.Version, model.ActivityModelKey, model.ActivityModelVersion, model.MaximumWorkoutsPerWeek, model.CoachChosen));
        CollectionAssert.AreEqual(B8aVersionOneKinds, model.KindsOfWork.ToArray());

        // A calculation is version 1's as it always was: no words, walking line or goal rate, and no floor under a target
        // below 1,200 for a woman, since the floors are version 2's.
        var made = await B8aCalculateAsync(coach, nourId, B8aSmallWoman(occupation: "Seated", workouts: null));
        await AssertStatusAsync(made, HttpStatusCode.OK);
        var view = await ReadSlicePayloadAsync<NutritionCalculationView>(made);
        Assert.AreEqual((OccupationStepsActivityModel.Key, "1.0", 1.50m, 1_011.625m), (view.ActivityModelKey, view.ActivityModelVersion, view.ActivityModelPal, view.CalorieTarget));
        Assert.IsNull(view.Activity);
        Assert.IsNull(view.Walking);
        Assert.IsNull(view.Goal);
        Assert.IsEmpty(view.Warnings);
        var listed = (await ReadSliceAsync<NutritionCalculationRecord[]>(coach, R53dCalculationsUrl(nourId))).Single();
        Assert.IsNull(listed.Result.Activity);
        Assert.IsNull(listed.Result.Walking);
        Assert.IsNull(listed.Result.Goal);
        Assert.IsEmpty(listed.Result.Warnings);
        Assert.AreEqual(((int?)null, (decimal?)null, (string?)null), (listed.Inputs!.WorkoutsPerWeek, listed.Inputs.ChosenPal, listed.Inputs.ChosenPalReason));

        // Version 2's inputs are refused in words, each on the box it is about, and a refusal records nothing.
        await B8aAssertRefusedAsync(
            await B8aCalculateAsync(coach, nourId, B8aSmallWoman(occupation: "Seated", workouts: 3)),
            "workoutsPerWeek",
            "Workouts a week are part of energy version 2, which this server does not use yet.");
        await B8aAssertRefusedAsync(
            await B8aCalculateAsync(coach, nourId, B8aSmallWoman(occupation: "Seated", workouts: null, chosenPal: 1.55m)),
            "chosenPal",
            "Choosing the multiplier yourself is part of energy version 2, which this server does not use yet.");
        await B8aAssertRefusedAsync(
            await B8aCalculateAsync(coach, nourId, B8aSmallWoman(occupation: "OnTheirFeet", workouts: null)),
            "occupationType",
            "Work on their feet and heavy manual work are energy version 2's, which this server does not use yet. Choose seated, mixed or physical.");
        Assert.HasCount(1, await ReadSliceAsync<NutritionCalculationRecord[]>(coach, R53dCalculationsUrl(nourId)));

        // The preview is version 2's alone.
        var preview = await B8aPostPreviewAsync(coach, new PreviewEnergyRequest(OccupationType: OccupationActivityType.Seated, AverageDailySteps: 2_000, WorkoutsPerWeek: 0));
        await AssertStatusAsync(preview, HttpStatusCode.Conflict);
        Assert.AreEqual("energy_version_2_off", (await preview.Content.ReadFromJsonAsync<B8aRefusal>())?.Code);
    }

    [TestMethod]
    public async Task B8aV2NewCalculationsUseTheNewTableAndSayHowTheMultiplierCameAbout()
    {
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "b8a-two-coach@example.test", "Hicham Haddad", "B8a Two");
        using var elie = CreateClient();
        var elieId = await R31InviteAsync(coach, elie, tenant, "b8a-two-elie@example.test", "Elie", "Haddad");
        await R53dStartNutritionAsync(coach, elieId);

        // The sheet is told what version 2 takes: four kinds of work, 0 to 7 workouts, and the coach's own multiplier.
        var model = await ReadSliceAsync<EnergyModelView>(coach, B8aEnergyModelUrl);
        Assert.AreEqual((2, OccupationStepsActivityModel.Key, "2.0", (int?)7), (model.Version, model.ActivityModelKey, model.ActivityModelVersion, model.MaximumWorkoutsPerWeek));
        CollectionAssert.AreEqual(B8aVersionTwoKinds, model.KindsOfWork.ToArray());
        Assert.AreEqual(
            (CoachChosenPal.Key, "1.0", 1.40m, 2.40m, CoachChosenPal.Picks.Count),
            (model.CoachChosen!.MethodKey, model.CoachChosen.MethodVersion, model.CoachChosen.Minimum, model.CoachChosen.Maximum, model.CoachChosen.Picks.Count));
        Assert.AreEqual((1.40m, "little movement, no exercise"), (model.CoachChosen.Picks[0].Pal, model.CoachChosen.Picks[0].Words));

        // Toufic's Elie, mixed work with 5,000 steps and four workouts: the critique's numbers and words.
        var made = await B8aCalculateAsync(coach, elieId, B8aElie());
        await AssertStatusAsync(made, HttpStatusCode.OK);
        var view = await ReadSlicePayloadAsync<NutritionCalculationView>(made);
        Assert.AreEqual(
            (OccupationStepsActivityModel.Key, "2.0", 1.68m, 1_881.5m, 3_160.92m, 2_660.92m),
            (view.ActivityModelKey, view.ActivityModelVersion, view.ActivityModelPal, view.BmrEstimate, view.TdeeEstimate, view.CalorieTarget));
        Assert.AreEqual("Counts as low active: × 1.68 (mixed work with 5,000 steps a day × 1.60, plus 4 workouts a week + 0.08)", view.Activity!.Words);
        Assert.AreEqual((1.60m, 4, 0.08m, StepsBand.LowActive), (view.Activity.TableValue, view.Activity.WorkoutsPerWeek, view.Activity.WorkoutTerm, view.Activity.StepsBand));
        Assert.AreEqual("Their 5,000 steps are inside that, worth about 180 calories a day at 97 kg.", view.Walking!.Words);
        Assert.AreEqual("−500 a day ≈ 0.5 kg a week, 84% of what they burn", view.Goal!.Words);
        Assert.AreEqual(2_660.92m, view.CalorieTarget, "The steps are inside the multiplier, never added to the target.");
        Assert.IsEmpty(view.Warnings);

        // The read says the same from what was kept, the workouts sent among the inputs.
        var record = (await ReadSliceAsync<NutritionCalculationRecord[]>(coach, R53dCalculationsUrl(elieId))).Single();
        Assert.AreEqual(view.Activity, record.Result.Activity);
        Assert.AreEqual(view.Walking, record.Result.Walking);
        Assert.AreEqual(view.Goal, record.Result.Goal);
        Assert.AreEqual((OccupationActivityType.Mixed, (int?)4), (record.Inputs!.OccupationType, record.Inputs.WorkoutsPerWeek));

        // Version 1's Physical is split in two, the workouts are asked for, and a refusal records nothing.
        await B8aAssertRefusedAsync(await B8aCalculateAsync(coach, elieId, B8aElie(occupation: "Physical")), "occupationType", B8aPhysicalRefusal);
        await B8aAssertRefusedAsync(await B8aCalculateAsync(coach, elieId, B8aElie(workouts: null)), "workoutsPerWeek", B8aWorkoutsRefusal);
        await B8aAssertRefusedAsync(await B8aCalculateAsync(coach, elieId, B8aElie(workouts: 8)), "workoutsPerWeek", B8aWorkoutsRefusal);
        Assert.HasCount(1, await ReadSliceAsync<NutritionCalculationRecord[]>(coach, R53dCalculationsUrl(elieId)));

        // The energy floors warn and never refuse, in the answer and in the read alike.
        using var nour = CreateClient();
        var nourId = await R31InviteAsync(coach, nour, tenant, "b8a-two-nour@example.test", "Nour", "Fares");
        await R53dStartNutritionAsync(coach, nourId);
        var low = await B8aCalculateAsync(coach, nourId, B8aSmallWoman(occupation: "Seated", workouts: 0));
        await AssertStatusAsync(low, HttpStatusCode.OK);
        var lowView = await ReadSlicePayloadAsync<NutritionCalculationView>(low);
        Assert.AreEqual((1.45m, 961.238m), (lowView.ActivityModelPal, lowView.CalorieTarget));
        CollectionAssert.AreEqual(B8aSmallWomansFloors, lowView.Warnings.ToArray());
        CollectionAssert.AreEqual(
            B8aSmallWomansFloors,
            (await ReadSliceAsync<NutritionCalculationRecord[]>(coach, R53dCalculationsUrl(nourId))).Single().Result.Warnings.ToArray());
    }

    [TestMethod]
    public async Task B8aV2TheCoachsOwnMultiplierIsItsOwnModelKeptAppendOnlyWithTheirReason()
    {
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "b8a-chosen-coach@example.test", "Hicham Haddad", "B8a Chosen");
        using var elie = CreateClient();
        var elieId = await R31InviteAsync(coach, elie, tenant, "b8a-chosen-elie@example.test", "Elie", "Haddad");
        await R53dStartNutritionAsync(coach, elieId);

        // A pick from the plain words, with a reason kept as the coach meant it.
        var made = await B8aCalculateAsync(coach, elieId, B8aElie(chosenPal: 1.55m, reason: "  Marathon block: runs every morning.  "));
        await AssertStatusAsync(made, HttpStatusCode.OK);
        var view = await ReadSlicePayloadAsync<NutritionCalculationView>(made);
        Assert.AreEqual((CoachChosenPal.Key, "1.0", 1.55m, 2_916.325m), (view.ActivityModelKey, view.ActivityModelVersion, view.ActivityModelPal, view.TdeeEstimate));
        Assert.AreEqual("Chosen by the coach: × 1.55 (moderate exercise 3 to 5 days a week)", view.Activity!.Words);
        Assert.AreEqual(
            ("moderate exercise 3 to 5 days a week", "Marathon block: runs every morning.", (decimal?)null, (decimal?)null),
            (view.Activity.ChosenWords, view.Activity.Reason, view.Activity.TableValue, view.Activity.WorkoutTerm));
        var record = (await ReadSliceAsync<NutritionCalculationRecord[]>(coach, R53dCalculationsUrl(elieId))).Single();
        Assert.AreEqual(view.Activity, record.Result.Activity);
        Assert.AreEqual(((decimal?)1.55m, "Marathon block: runs every morning."), (record.Inputs!.ChosenPal, record.Inputs.ChosenPalReason));

        // The ladder's 1.375 is refused in words, and a reason needs a multiplier of the coach's own.
        await B8aAssertRefusedAsync(
            await B8aCalculateAsync(coach, elieId, B8aElie(chosenPal: 1.375m)),
            "chosenPal",
            "A multiplier of 1.375 is under 1.40, the lowest FAO/WHO/UNU's scale gives a healthy adult's whole day. Choose one from 1.40 to 2.40.");
        await B8aAssertRefusedAsync(await B8aCalculateAsync(coach, elieId, B8aElie(reason: "Because")), "chosenPalReason", "A reason goes with a multiplier you choose yourself.");
        await B8aAssertRefusedAsync(await B8aCalculateAsync(coach, elieId, B8aElie(chosenPal: 1.55m, reason: new string('a', 501))), "chosenPalReason", "Keep the reason to 500 characters.");
        Assert.HasCount(1, await ReadSliceAsync<NutritionCalculationRecord[]>(coach, R53dCalculationsUrl(elieId)));

        // The coach's own macros over it keep where the multiplier came from.
        await RefreshCsrfAsync(coach);
        var adjusted = await coach.PostAsJsonAsync(
            $"/api/nutrition/clients/{elieId}/calculations/{view.Id}/macro-overrides",
            new { proteinGrams = 180m, fatGrams = 70m, carbohydrateGrams = 250m, reason = "Fewer carbs on rest days" });
        await AssertStatusAsync(adjusted, HttpStatusCode.OK);
        var adjustedRecord = await ReadSlicePayloadAsync<NutritionCalculationRecord>(adjusted);
        Assert.AreEqual((CoachChosenPal.Key, 1.55m, view.Activity.Words), (adjustedRecord.Result.ActivityModelKey, adjustedRecord.Result.ActivityModelPal, adjustedRecord.Result.Activity!.Words));

        // The choice is never edited or removed.
        await AssertSqlStateAsync("23514", $"""UPDATE nutrition."CalculationSnapshots" SET "ActivityModelPal" = 1.80 WHERE "Id" = '{view.Id}'""");
        await AssertSqlStateAsync("23514", $$"""UPDATE nutrition."CalculationSnapshots" SET "InputJson" = '{}'::jsonb WHERE "Id" = '{{view.Id}}'""");
        await AssertSqlStateAsync("23514", $"""DELETE FROM nutrition."CalculationSnapshots" WHERE "Id" = '{view.Id}'""");
    }

    [TestMethod]
    public async Task B8aV2TheTargetsSheetsNumbersAreWorkedOutAsTheCoachTypesAndRecordedNowhere()
    {
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "b8a-preview-coach@example.test", "Hicham Haddad", "B8a Preview");

        // The activity alone gives the line under "How active they are"; a goal has its rate and no share yet.
        var early = await B8aPreviewAsync(coach, new PreviewEnergyRequest(OccupationType: OccupationActivityType.Mixed, AverageDailySteps: 5_000, WorkoutsPerWeek: 4, GoalAdjustments: [-500m]));
        Assert.AreEqual("Counts as low active: × 1.68 (mixed work with 5,000 steps a day × 1.60, plus 4 workouts a week + 0.08)", early.Activity!.Words);
        Assert.IsNull(early.BmrEstimate);
        Assert.IsNull(early.TdeeEstimate);
        Assert.IsNull(early.Walking);
        Assert.AreEqual("−500 a day ≈ 0.5 kg a week", early.Goals.Single().Words);

        // With the body in, what they burn, what the steps are worth and each goal pick's rate and share.
        var whole = await B8aPreviewAsync(coach, B8aElieSoFar(B8aGoalPicks));
        Assert.AreEqual((1_881.5m, 3_160.92m), (whole.BmrEstimate, whole.TdeeEstimate));
        Assert.AreEqual("Their 5,000 steps are inside that, worth about 180 calories a day at 97 kg.", whole.Walking!.Words);
        CollectionAssert.AreEqual(B8aElieGoals, whole.Goals.Select(goal => goal.Words).ToArray());

        // The coach's own multiplier takes the table's place.
        var chosen = await B8aPreviewAsync(coach, B8aElieSoFar([], chosenPal: 1.725m));
        Assert.AreEqual(("Chosen by the coach: × 1.725 (hard exercise 6 to 7 days a week)", (decimal?)3_245.588m), (chosen.Activity!.Words, chosen.TdeeEstimate));

        // A wrong number is refused on its box, in words.
        await B8aAssertRefusedAsync(await B8aPostPreviewAsync(coach, new PreviewEnergyRequest(WorkoutsPerWeek: 8)), "workoutsPerWeek", B8aWorkoutsRefusal);
        await B8aAssertRefusedAsync(await B8aPostPreviewAsync(coach, new PreviewEnergyRequest(OccupationType: OccupationActivityType.Physical)), "occupationType", B8aPhysicalRefusal);
        await B8aAssertRefusedAsync(
            await B8aPostPreviewAsync(coach, new PreviewEnergyRequest(ChosenPal: 1.2m)),
            "chosenPal",
            "A multiplier of 1.2 is under 1.40, the lowest FAO/WHO/UNU's scale gives a healthy adult's whole day. Choose one from 1.40 to 2.40.");
        await B8aAssertRefusedAsync(
            await B8aPostPreviewAsync(coach, new PreviewEnergyRequest(MifflinStJeorBmrStrategy.Key, 97.4m, 178m, 17, FormulaSex.Male)),
            "calculation",
            "Adult BMR strategies support ages 18 through 120.");
        await B8aAssertRefusedAsync(
            await B8aPostPreviewAsync(coach, new PreviewEnergyRequest(GoalAdjustments: [.. Enumerable.Repeat(0m, 11)])),
            "goalAdjustments",
            "Ask about 10 goals at most.");

        // Nothing was recorded, whatever was asked.
        Assert.AreEqual(0L, await P2CountAsync("""SELECT count(*) FROM nutrition."CalculationSnapshots" WHERE "TenantId" = @id""", tenant));
    }

    [TestMethod]
    public async Task B8aV2TheEnergyRoutesAnswerOnlyTheWorkspacesStaff()
    {
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b8a-scope-owner@example.test", "Hicham Haddad", "B8a Scope");
        using var coach = CreateClient();
        await JoinAsCoachAsync(owner, coach, "b8a-scope-coach@example.test", "Lina Saad");
        using var rami = CreateClient();
        var ramiId = await R31InviteAsync(owner, rami, tenant, "b8a-scope-rami@example.test", "Rami", "Khoury");
        await R53dStartNutritionAsync(owner, ramiId);

        // A team coach reads the model and previews as the owner does.
        Assert.AreEqual(2, (await ReadSliceAsync<EnergyModelView>(coach, B8aEnergyModelUrl)).Version);
        Assert.IsNotNull((await B8aPreviewAsync(coach, new PreviewEnergyRequest(OccupationType: OccupationActivityType.OnTheirFeet, AverageDailySteps: 9_000, WorkoutsPerWeek: 2))).Activity);

        // Another coach's client is not theirs to work out (ADR 0026): 404, and nothing is recorded.
        await AssertStatusAsync(await B8aCalculateAsync(coach, ramiId, B8aElie()), HttpStatusCode.NotFound);
        Assert.IsEmpty(await ReadSliceAsync<NutritionCalculationRecord[]>(owner, R53dCalculationsUrl(ramiId)));

        // A client, someone signed out and another workspace's owner are refused both routes.
        await AssertStatusAsync(await rami.GetAsync(B8aEnergyModelUrl), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await B8aPostPreviewAsync(rami, new PreviewEnergyRequest()), HttpStatusCode.Forbidden);
        using var anonymous = CreateClient();
        SetTenant(anonymous, tenant);
        await AssertStatusAsync(await anonymous.GetAsync(B8aEnergyModelUrl), HttpStatusCode.Unauthorized);
        await AssertStatusAsync(await anonymous.PostAsJsonAsync(B8aPreviewUrl, new PreviewEnergyRequest(), SliceReadJson), HttpStatusCode.Unauthorized);
        using var stranger = CreateClient();
        await RegisterCoachAsync(stranger, "b8a-scope-stranger@example.test", "Other Owner", "B8a Elsewhere");
        SetTenant(stranger, tenant);
        await AssertStatusAsync(await stranger.GetAsync(B8aEnergyModelUrl), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await B8aPostPreviewAsync(stranger, new PreviewEnergyRequest()), HttpStatusCode.Forbidden);
    }

    private sealed record B8aRefusal(string Code, string Message);

    private static async Task<HttpResponseMessage> B8aCalculateAsync(HttpClient coach, Guid clientId, object body)
    {
        await RefreshCsrfAsync(coach);
        return await coach.PostAsJsonAsync(R53dCalculationsUrl(clientId), body);
    }

    private static async Task<HttpResponseMessage> B8aPostPreviewAsync(HttpClient caller, PreviewEnergyRequest request)
    {
        await RefreshCsrfAsync(caller);
        return await caller.PostAsJsonAsync(B8aPreviewUrl, request, SliceReadJson);
    }

    private static async Task<EnergyPreviewView> B8aPreviewAsync(HttpClient coach, PreviewEnergyRequest request)
    {
        var response = await B8aPostPreviewAsync(coach, request);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<EnergyPreviewView>(response);
    }

    private static async Task B8aAssertRefusedAsync(HttpResponseMessage response, string field, string words)
    {
        await AssertStatusAsync(response, HttpStatusCode.BadRequest);
        var problem = await RequiredJsonAsync<R42aValidationProblem>(response);
        Assert.IsTrue(problem.Errors.TryGetValue(field, out var messages), $"Expected an error on '{field}': {string.Join(", ", problem.Errors.Keys)}");
        Assert.AreEqual(words, messages.Single());
    }

    /// <summary>Toufic's Elie: 97.4 kg, 178 cm, 42, male, 5,000 steps, a 500 kcal cut.</summary>
    private static object B8aElie(string occupation = "Mixed", int? workouts = 4, decimal? chosenPal = null, string? reason = null) => new
    {
        bmrMethodKey = MifflinStJeorBmrStrategy.Key,
        weightKilograms = 97.4m,
        heightCentimeters = 178m,
        ageYears = 42,
        sex = "Male",
        bodyFatPercentage = (decimal?)null,
        occupationType = occupation,
        averageDailySteps = 5_000,
        coachGoalAdjustment = -500m,
        calorieTarget = (decimal?)null,
        proteinGrams = 175m,
        fatPercentage = 25m,
        isEnergyDeficit = true,
        workoutsPerWeek = workouts,
        chosenPal,
        chosenPalReason = reason,
    };

    private static PreviewEnergyRequest B8aElieSoFar(IReadOnlyList<decimal> goals, decimal? chosenPal = null) =>
        new(MifflinStJeorBmrStrategy.Key, 97.4m, 178m, 42, FormulaSex.Male, null, OccupationActivityType.Mixed, 5_000, 4, chosenPal, goals);

    /// <summary>A 50 kg woman of 60, 155 cm, 2,000 steps, on a 500 kcal cut.</summary>
    private static object B8aSmallWoman(string occupation, int? workouts, decimal? chosenPal = null) => new
    {
        bmrMethodKey = MifflinStJeorBmrStrategy.Key,
        weightKilograms = 50m,
        heightCentimeters = 155m,
        ageYears = 60,
        sex = "Female",
        bodyFatPercentage = (decimal?)null,
        occupationType = occupation,
        averageDailySteps = 2_000,
        coachGoalAdjustment = -500m,
        calorieTarget = (decimal?)null,
        proteinGrams = 80m,
        fatPercentage = 25m,
        isEnergyDeficit = true,
        workoutsPerWeek = workouts,
        chosenPal,
    };
}
