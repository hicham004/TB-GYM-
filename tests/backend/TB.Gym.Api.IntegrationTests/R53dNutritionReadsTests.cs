using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using TB.Gym.Modules.Nutrition;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// R5.3d: what the coach's Nutrition tab reads for a client. The allergens declared now (a replace-only
/// write had no read, so the tab could not show what a Save would replace), the targets already worked
/// out with the numbers they came from, and a plan list that names its meal plan and carries the
/// targets the client sees. Every read answers alike: another coach's client, another workspace's and an
/// id that exists nowhere are 404 (SEC-8), a client whose plan has no Nutrition or who was released is
/// refused.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private static string R53dAllergensUrl(Guid clientId) => $"/api/nutrition/clients/{clientId}/allergens";

    private static string R53dCalculationsUrl(Guid clientId, string query = "") =>
        $"/api/nutrition/clients/{clientId}/calculations{query}";

    private static string R53dPlansUrl(Guid clientId) => $"/api/nutrition/clients/{clientId}/plans";

    [TestMethod]
    public async Task R53dTheCoachReadsWhatIsDeclaredAndTheTargetsAlreadyWorkedOutForTheirClient()
    {
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "r53d-reads-coach@example.test", "Hicham Haddad", "R53d Reads");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(coach, maya, tenant, "r53d-reads-maya@example.test", "Maya", "Rahman");
        await R53dStartNutritionAsync(coach, mayaId);

        // Nothing declared and nothing worked out yet: both reads answer, and say so.
        Assert.IsEmpty((await ReadSliceAsync<ClientAllergensView>(coach, R53dAllergensUrl(mayaId))).Codes);
        Assert.IsEmpty(await ReadSliceAsync<NutritionCalculationRecord[]>(coach, R53dCalculationsUrl(mayaId)));

        // The allergens declared now read back in the list's order, and replacing the list leaves only
        // what is declared now (what was dropped stays in the database as history, not in the read).
        await R53dDeclareAsync(coach, mayaId, "Milk", "Peanuts");
        CollectionAssert.AreEqual(
            new[] { AllergenCode.Peanuts, AllergenCode.Milk },
            (await ReadSliceAsync<ClientAllergensView>(coach, R53dAllergensUrl(mayaId))).Codes.ToArray());
        await R53dDeclareAsync(coach, mayaId, "Eggs");
        CollectionAssert.AreEqual(
            new[] { AllergenCode.Eggs },
            (await ReadSliceAsync<ClientAllergensView>(coach, R53dAllergensUrl(mayaId))).Codes.ToArray());
        await R53dDeclareAsync(coach, mayaId);
        Assert.IsEmpty((await ReadSliceAsync<ClientAllergensView>(coach, R53dAllergensUrl(mayaId))).Codes);

        // One calculation reads back with the numbers it was worked out from and the time it was made.
        var worked = RequiredTestClock.UtcNow;
        var first = await R53dCalculateAsync(coach, mayaId, weight: 70m, protein: 120m);
        var onlyOne = await ReadSliceAsync<NutritionCalculationRecord[]>(coach, R53dCalculationsUrl(mayaId));
        var record = onlyOne.Single();
        Assert.AreEqual(first.Id, record.Result.Id);
        R53dAssertSameNumbers(first, record.Result);
        Assert.IsLessThan(TimeSpan.FromMilliseconds(1), (record.CalculatedAtUtc - worked).Duration(), "The time it was made, to the database's precision.");
        Assert.IsNotNull(record.Inputs);
        Assert.AreEqual(
            ("MifflinStJeor", 70m, 168m, 29, FormulaSex.Female, OccupationActivityType.Seated, 8000, 0m, 120m, 25m, false),
            (record.Inputs.BmrMethodKey, record.Inputs.WeightKilograms, record.Inputs.HeightCentimeters, record.Inputs.AgeYears, record.Inputs.Sex,
                record.Inputs.OccupationType, record.Inputs.AverageDailySteps, record.Inputs.CoachGoalAdjustment, record.Inputs.ProteinGrams,
                record.Inputs.FatPercentage, record.Inputs.IsEnergyDeficit));
        Assert.IsEmpty(record.Result.Warnings, "1.7 g/kg is inside the usual range.");

        // A second one is listed first. A protein warning is worked out again from the stored numbers.
        RequiredTestClock.Advance(TimeSpan.FromMinutes(5));
        var second = await R53dCalculateAsync(coach, mayaId, weight: 80m, protein: 190m, adjustment: -300m, deficit: false);
        var both = await ReadSliceAsync<NutritionCalculationRecord[]>(coach, R53dCalculationsUrl(mayaId));
        CollectionAssert.AreEqual(new[] { second.Id, first.Id }, both.Select(item => item.Result.Id).ToArray());
        Assert.AreEqual(-300m, both[0].Result.CoachGoalAdjustment);
        StringAssert.Contains(both[0].Result.Warnings.Single(), "g/kg/day");
        Assert.AreEqual(second.Warnings.Single(), both[0].Result.Warnings.Single(), "The list says what the calculation said.");

        // take limits the list to the newest, and is kept between 1 and 20.
        CollectionAssert.AreEqual(
            new[] { second.Id },
            (await ReadSliceAsync<NutritionCalculationRecord[]>(coach, R53dCalculationsUrl(mayaId, "?take=1"))).Select(item => item.Result.Id).ToArray());
        Assert.HasCount(1, await ReadSliceAsync<NutritionCalculationRecord[]>(coach, R53dCalculationsUrl(mayaId, "?take=0")));
        Assert.HasCount(2, await ReadSliceAsync<NutritionCalculationRecord[]>(coach, R53dCalculationsUrl(mayaId, "?take=500")));
    }

    [TestMethod]
    public async Task R53dThePlanListNamesItsMealPlanAndCarriesTheTargetsTheClientSees()
    {
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "r53d-plans-coach@example.test", "Hicham Haddad", "R53d Plans");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(coach, maya, tenant, "r53d-plans-maya@example.test", "Maya", "Rahman");
        var oats = await R44aRecipeAsync(coach, "Oats", 13m);
        var chicken = await R44aRecipeAsync(coach, "Chicken", 31m);
        var draft = await R44aCreateAsync(coach, new(null, null, null, R44aContent(oats.VersionId, chicken.VersionId, name: "Spring cut")));
        var mealPlan = await R44aPublishAsync(coach, draft.Id, draft.Version, replaceNewer: false);
        var enrollment = await R53dStartNutritionAsync(coach, mayaId);
        var calculation = await R53dCalculateAsync(coach, mayaId, weight: 70m, protein: 130m, adjustment: -300m, deficit: true);
        await RefreshCsrfAsync(coach);
        var assigned = await coach.PostAsJsonAsync(R53dPlansUrl(mayaId), new
        {
            mealPlanTemplateVersionId = mealPlan.VersionId,
            enrollmentId = enrollment.Id,
            calculationSnapshotId = calculation.Id,
            startDate = TenantToday().ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            acknowledgeAllergenWarnings = false,
        });
        await AssertStatusAsync(assigned, HttpStatusCode.OK);

        // The answer to the assignment, the plan list and the answer to a cancellation all carry the
        // meal plan's name and the targets of the calculation it was assigned with.
        var fromAssign = await ReadSlicePayloadAsync<ClientNutritionPlanSummary>(assigned);
        var listed = (await ReadSliceAsync<ClientNutritionPlanSummary[]>(coach, R53dPlansUrl(mayaId))).Single();
        Assert.AreEqual(fromAssign, listed);
        Assert.AreEqual("Spring cut", listed.MealPlanName);
        Assert.AreEqual(calculation.Id, listed.CalculationSnapshotId);
        Assert.AreEqual(calculation.CalorieTarget, listed.CalorieTarget, StoredPrecision);
        Assert.AreEqual(calculation.ProteinGrams, listed.ProteinGrams, StoredPrecision);
        Assert.AreEqual(calculation.CarbohydrateGrams, listed.CarbohydrateGrams, StoredPrecision);
        Assert.AreEqual(calculation.FatGrams, listed.FatGrams, StoredPrecision);

        await RefreshCsrfAsync(coach);
        var cancelled = await coach.PostAsJsonAsync($"{R53dPlansUrl(mayaId)}/{listed.Id}/cancel", new { reason = "Changed the plan", listed.Version });
        await AssertStatusAsync(cancelled, HttpStatusCode.OK);
        var afterCancel = await ReadSlicePayloadAsync<ClientNutritionPlanSummary>(cancelled);
        Assert.AreEqual(ClientNutritionPlanStatus.Cancelled, afterCancel.Status);
        Assert.AreEqual(
            (listed.MealPlanName, listed.CalculationSnapshotId, listed.ProteinGrams, listed.CarbohydrateGrams, listed.FatGrams),
            (afterCancel.MealPlanName, afterCancel.CalculationSnapshotId, afterCancel.ProteinGrams, afterCancel.CarbohydrateGrams, afterCancel.FatGrams));
        var afterList = (await ReadSliceAsync<ClientNutritionPlanSummary[]>(coach, R53dPlansUrl(mayaId))).Single();
        Assert.AreEqual(afterCancel, afterList);
    }

    [TestMethod]
    public async Task R53dTheReadsAreScopedToTheCallersClientsTheirPlanAndTheirWorkspace()
    {
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "r53d-scope-owner@example.test", "Hicham Haddad", "R53d Scope");
        using var coach = CreateClient();
        await JoinAsCoachAsync(owner, coach, "r53d-scope-coach@example.test", "Lina Saad");
        using var ownersClient = CreateClient();
        var ramiId = await R31InviteAsync(owner, ownersClient, tenant, "r53d-scope-rami@example.test", "Rami", "Khoury");
        await R53dStartNutritionAsync(owner, ramiId);
        await R53dCalculateAsync(owner, ramiId, weight: 82m, protein: 150m);
        await R53dDeclareAsync(owner, ramiId, "Sesame");
        using var coachsClient = CreateClient();
        var nourId = await R31InviteAsync(coach, coachsClient, tenant, "r53d-scope-nour@example.test", "Nour", "Fares");
        var urls = new[] { R53dAllergensUrl(ramiId), R53dCalculationsUrl(ramiId), R53dPlansUrl(ramiId) };

        // The owner reads any client's. A coach reads only their own client's, and a client whose plan
        // has no Nutrition is refused all three reads the same way (the plan list always was).
        CollectionAssert.AreEqual(
            new[] { AllergenCode.Sesame },
            (await ReadSliceAsync<ClientAllergensView>(owner, urls[0])).Codes.ToArray());
        Assert.HasCount(1, await ReadSliceAsync<NutritionCalculationRecord[]>(owner, urls[1]));
        foreach (var url in new[] { R53dAllergensUrl(nourId), R53dCalculationsUrl(nourId), R53dPlansUrl(nourId) })
        {
            await AssertStatusAsync(await coach.GetAsync(url), HttpStatusCode.Forbidden);
        }

        // Another coach's client answers exactly as an unknown one: 404, and nothing of what was read.
        foreach (var url in urls)
        {
            var other = await coach.GetAsync(url);
            await AssertStatusAsync(other, HttpStatusCode.NotFound);
            var body = await other.Content.ReadAsStringAsync();
            Assert.IsFalse(body.Contains("Sesame", StringComparison.OrdinalIgnoreCase));
            Assert.IsFalse(body.Contains("MifflinStJeor", StringComparison.Ordinal));
        }

        await AssertStatusAsync(await coach.GetAsync(R53dAllergensUrl(Guid.NewGuid())), HttpStatusCode.NotFound);
        await AssertStatusAsync(await coach.GetAsync(R53dCalculationsUrl(Guid.NewGuid())), HttpStatusCode.NotFound);

        // Nobody signed out, and no client, can read them.
        using var anonymous = CreateClient();
        SetTenant(anonymous, tenant);
        foreach (var url in urls)
        {
            await AssertStatusAsync(await anonymous.GetAsync(url), HttpStatusCode.Unauthorized);
            await AssertStatusAsync(await ownersClient.GetAsync(url), HttpStatusCode.Forbidden);
        }

        // Another workspace's owner finds nothing of this one in their own: the same 404 as for an id that
        // exists nowhere (SEC-8), and is refused this one.
        using var stranger = CreateClient();
        var strangerTenant = await RegisterCoachAsync(stranger, "r53d-scope-stranger@example.test", "Other Owner", "R53d Elsewhere");
        foreach (var url in urls)
        {
            var elsewhere = await stranger.GetAsync(url);
            await AssertStatusAsync(elsewhere, HttpStatusCode.NotFound);
            Assert.IsFalse((await elsewhere.Content.ReadAsStringAsync()).Contains("Sesame", StringComparison.OrdinalIgnoreCase));
        }

        await AssertStatusAsync(await stranger.GetAsync(R53dAllergensUrl(Guid.NewGuid())), HttpStatusCode.NotFound);

        SetTenant(stranger, tenant);
        foreach (var url in urls)
        {
            await AssertStatusAsync(await stranger.GetAsync(url), HttpStatusCode.Forbidden);
        }

        SetTenant(stranger, strangerTenant);

        // Once released, a client's Nutrition is closed to the coach too (ADR 0027), as the plan list is.
        var profile = await RequiredJsonAsync<TeamClientDetails>(await owner.GetAsync($"/api/clients/{ramiId}"));
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync($"/api/clients/{ramiId}/release", new { reason = "Moved away", profile.Version }),
            HttpStatusCode.OK);
        foreach (var url in urls)
        {
            await AssertStatusAsync(await owner.GetAsync(url), HttpStatusCode.Forbidden);
        }
    }

    /// <summary>The database keeps six decimals; the answer to a calculation was the unrounded numbers.</summary>
    private const decimal StoredPrecision = 0.000001m;

    private static void R53dAssertSameNumbers(NutritionCalculationView made, NutritionCalculationView read)
    {
        Assert.AreEqual(made.CalorieTarget, read.CalorieTarget, StoredPrecision);
        Assert.AreEqual(made.ProteinGrams, read.ProteinGrams, StoredPrecision);
        Assert.AreEqual(made.CarbohydrateGrams, read.CarbohydrateGrams, StoredPrecision);
        Assert.AreEqual(made.FatGrams, read.FatGrams, StoredPrecision);
        Assert.AreEqual(made.BmrEstimate, read.BmrEstimate, StoredPrecision);
        Assert.AreEqual(made.ActivityModelPal, read.ActivityModelPal, StoredPrecision);
        Assert.AreEqual(made.TdeeEstimate, read.TdeeEstimate, StoredPrecision);
        Assert.AreEqual(made.CoachGoalAdjustment, read.CoachGoalAdjustment, StoredPrecision);
        CollectionAssert.AreEqual(made.Warnings.ToArray(), read.Warnings.ToArray(), "The list says what the calculation said.");
    }

    /// <summary>A free two-week Nutrition plan starting today in the workspace.</summary>
    private static Task<Enrollment> R53dStartNutritionAsync(HttpClient coach, Guid clientId) =>
        CreateFreeNutritionEnrollmentAsync(coach, clientId, 14, TenantToday().ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));

    private static async Task R53dDeclareAsync(HttpClient coach, Guid clientId, params string[] codes)
    {
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PutAsJsonAsync(R53dAllergensUrl(clientId), new { codes }), HttpStatusCode.OK);
    }

    private static async Task<NutritionCalculationView> R53dCalculateAsync(
        HttpClient coach,
        Guid clientId,
        decimal weight,
        decimal protein,
        decimal adjustment = 0m,
        bool deficit = false)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync(R53dCalculationsUrl(clientId), new
        {
            bmrMethodKey = "MifflinStJeor",
            weightKilograms = weight,
            heightCentimeters = 168m,
            ageYears = 29,
            sex = "Female",
            bodyFatPercentage = (decimal?)null,
            occupationType = "Seated",
            averageDailySteps = 8000,
            coachGoalAdjustment = adjustment,
            calorieTarget = (decimal?)null,
            proteinGrams = protein,
            fatPercentage = 25m,
            isEnergyDeficit = deficit,
        });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<NutritionCalculationView>(response);
    }
}
