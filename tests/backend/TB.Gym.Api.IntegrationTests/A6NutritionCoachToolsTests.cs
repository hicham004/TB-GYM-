using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Nutrition;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The audit's batch A6, the coach's nutrition tools (docs/FULL-AUDIT-2026-10.md, section 11): a coach
/// stops a meal plan with a reason the plan list keeps (NCM-1); a coach's own macros become the targets
/// the next plan carries (INV-2); a client that is not in the workspace is 404 (SEC-8); a label typed as
/// an EU label prints it counts as printed (NCM-3); USDA's outages are the designed failures (BEA-2,
/// BEA-13); two food saves or two AI approvals at once keep one (BEA-6, BEA-7, BEA-16); a logged meal
/// carries the calories of its amount (CLIENT-10); and AI availability is one answer (LOST-4).
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private static string A6CancelUrl(Guid clientId, Guid planId) => $"/api/nutrition/clients/{clientId}/plans/{planId}/cancel";

    private static string A6OverrideUrl(Guid clientId, Guid calculationId) =>
        $"/api/nutrition/clients/{clientId}/calculations/{calculationId}/macro-overrides";

    private static string A6DayUrl(DateOnly day) =>
        $"/api/nutrition/me/day?localDate={day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)}";

    [TestMethod]
    public async Task A6ACoachStopsAMealPlanWithAReasonAndThePlanListSaysWhy()
    {
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "a6-stop-coach@example.test", "Hicham Haddad", "A6 Stop");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(coach, maya, tenant, "a6-stop-maya@example.test", "Maya", "Rahman");
        var (mealPlan, enrollment) = await A6MealPlanAsync(coach, mayaId, "Spring cut");
        var calculation = await R53dCalculateAsync(coach, mayaId, weight: 70m, protein: 130m);
        var today = TenantToday();
        await A6AssignAsync(coach, mayaId, mealPlan.VersionId, enrollment.Id, calculation.Id, today);
        var running = (await ReadSliceAsync<ClientNutritionPlanSummary[]>(coach, R53dPlansUrl(mayaId))).Single();
        Assert.AreEqual(((DateTimeOffset?)null, (string?)null), (running.StoppedAtUtc, running.StopReason), "A plan never stopped says nothing about stopping.");
        await AssertStatusAsync(await maya.GetAsync(A6DayUrl(today)), HttpStatusCode.OK);

        // A stop needs a reason, and the version the coach read.
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync(A6CancelUrl(mayaId, running.Id), new { reason = "   ", running.Version }),
            HttpStatusCode.BadRequest);
        await RefreshCsrfAsync(coach);
        await A6AssertConflictAsync(
            await coach.PostAsJsonAsync(A6CancelUrl(mayaId, running.Id), new { reason = "Wrong dates", version = running.Version + 1 }),
            "nutrition_plan_conflict");

        await RefreshCsrfAsync(coach);
        var stopped = await coach.PostAsJsonAsync(A6CancelUrl(mayaId, running.Id), new { reason = "  Assigned the wrong dates.  ", running.Version });
        await AssertStatusAsync(stopped, HttpStatusCode.OK);
        var answer = await ReadSlicePayloadAsync<ClientNutritionPlanSummary>(stopped);
        Assert.AreEqual((ClientNutritionPlanStatus.Cancelled, "Assigned the wrong dates."), (answer.Status, answer.StopReason));
        Assert.IsLessThan(TimeSpan.FromMilliseconds(1), (answer.StoppedAtUtc!.Value - RequiredTestClock.UtcNow).Duration(), "Stopped now, to the database's precision.");
        Assert.AreEqual(answer, (await ReadSliceAsync<ClientNutritionPlanSummary[]>(coach, R53dPlansUrl(mayaId))).Single(), "The list says what the stop answered.");

        // Maya's day has no meal plan now (nothing for the day: 200 and null, AUTH-12), a second stop is
        // refused, and the dates take a corrected plan.
        await A11bAssertNothingHereAsync(await maya.GetAsync(A6DayUrl(today)));
        await RefreshCsrfAsync(coach);
        await A6AssertConflictAsync(
            await coach.PostAsJsonAsync(A6CancelUrl(mayaId, running.Id), new { reason = "Again", answer.Version }),
            "nutrition_plan_already_cancelled");
        await A6AssignAsync(coach, mayaId, mealPlan.VersionId, enrollment.Id, calculation.Id, today);
        var both = await ReadSliceAsync<ClientNutritionPlanSummary[]>(coach, R53dPlansUrl(mayaId));
        Assert.HasCount(2, both);
        Assert.AreEqual("Assigned the wrong dates.", both.Single(item => item.Status == ClientNutritionPlanStatus.Cancelled).StopReason);
        Assert.IsNull(both.Single(item => item.Status == ClientNutritionPlanStatus.Active).StopReason);
        await AssertStatusAsync(await maya.GetAsync(A6DayUrl(today)), HttpStatusCode.OK);

        // Another coach of the team cannot stop Maya's plan: her plan is not theirs to reach (ADR 0026).
        using var lina = CreateClient();
        await JoinAsCoachAsync(coach, lina, "a6-stop-lina@example.test", "Lina Saad");
        var active = both.Single(item => item.Status == ClientNutritionPlanStatus.Active);
        await RefreshCsrfAsync(lina);
        await AssertStatusAsync(
            await lina.PostAsJsonAsync(A6CancelUrl(mayaId, active.Id), new { reason = "Not mine", active.Version }),
            HttpStatusCode.NotFound);
        Assert.AreEqual(
            ClientNutritionPlanStatus.Active,
            (await ReadSliceAsync<ClientNutritionPlanSummary[]>(coach, R53dPlansUrl(mayaId))).Single(item => item.Id == active.Id).Status);
    }

    [TestMethod]
    public async Task A6ACoachsOwnMacrosBecomeTheTargetsTheNextMealPlanCarries()
    {
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "a6-macros-coach@example.test", "Hicham Haddad", "A6 Macros");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(coach, maya, tenant, "a6-macros-maya@example.test", "Maya", "Rahman");
        var (mealPlan, enrollment) = await A6MealPlanAsync(coach, mayaId, "Spring cut");
        var formula = await R53dCalculateAsync(coach, mayaId, weight: 70m, protein: 130m, adjustment: -300m, deficit: true);
        var today = TenantToday();
        await A6AssignAsync(coach, mayaId, mealPlan.VersionId, enrollment.Id, formula.Id, today);
        RequiredTestClock.Advance(TimeSpan.FromMinutes(5));

        // The coach's grams: 150 g protein, 200 g carbohydrate and 60 g fat make 1,940 calories a day.
        await RefreshCsrfAsync(coach);
        var made = await coach.PostAsJsonAsync(A6OverrideUrl(mayaId, formula.Id), new CreateMacroOverrideRequest(150m, 60m, 200m, "  More protein while she cuts  "));
        await AssertStatusAsync(made, HttpStatusCode.OK);
        var adjusted = await ReadSlicePayloadAsync<NutritionCalculationRecord>(made);
        Assert.AreNotEqual(formula.Id, adjusted.Result.Id);
        Assert.AreEqual((1_940m, 150m, 200m, 60m), (adjusted.Result.CalorieTarget, adjusted.Result.ProteinGrams, adjusted.Result.CarbohydrateGrams, adjusted.Result.FatGrams));
        Assert.AreEqual(
            (formula.BmrEstimate, formula.TdeeEstimate, formula.BmrMethodKey),
            (adjusted.Result.BmrEstimate, adjusted.Result.TdeeEstimate, adjusted.Result.BmrMethodKey),
            "What the body burns stays the formula's.");
        Assert.AreEqual(adjusted.Result.CalorieTarget - adjusted.Result.TdeeEstimate, adjusted.Result.CoachGoalAdjustment, StoredPrecision);
        Assert.IsNotNull(adjusted.Adjustment);
        Assert.AreEqual(("More protein while she cuts", formula.Id), (adjusted.Adjustment.Reason, adjusted.Adjustment.AdjustedFromCalculationId));
        Assert.AreEqual(formula.CalorieTarget, adjusted.Adjustment.FromCalorieTarget, StoredPrecision);
        Assert.AreEqual(formula.ProteinGrams, adjusted.Adjustment.FromProteinGrams, StoredPrecision);
        Assert.AreEqual(formula.CarbohydrateGrams, adjusted.Adjustment.FromCarbohydrateGrams, StoredPrecision);
        Assert.AreEqual(formula.FatGrams, adjusted.Adjustment.FromFatGrams, StoredPrecision);
        Assert.AreEqual(70m, adjusted.Inputs?.WeightKilograms, "The numbers it was worked out from stay with it.");
        Assert.IsEmpty(adjusted.Result.Warnings, "150 g is 2.1 g a kilogram, inside the range while she eats below what she burns.");

        // The list puts them first and says what they changed; the formula's targets are still there.
        var listed = await ReadSliceAsync<NutritionCalculationRecord[]>(coach, R53dCalculationsUrl(mayaId));
        CollectionAssert.AreEqual(new[] { adjusted.Result.Id, formula.Id }, listed.Select(item => item.Result.Id).ToArray());
        Assert.AreEqual(adjusted.Adjustment, listed[0].Adjustment);
        Assert.IsNull(listed[1].Adjustment);
        R53dAssertSameNumbers(formula, listed[1].Result);

        // The plan already assigned keeps the targets it had (NUT-009); Maya's day still shows them.
        var first = (await ReadSliceAsync<ClientNutritionPlanSummary[]>(coach, R53dPlansUrl(mayaId))).Single();
        Assert.AreEqual(formula.Id, first.CalculationSnapshotId);
        Assert.AreEqual(formula.CalorieTarget, (await ReadSliceAsync<ClientNutritionDayView>(maya, A6DayUrl(today))).TargetCalories, StoredPrecision);

        // Stopped and assigned again with the coach's targets, the plan carries them to Maya.
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync(A6CancelUrl(mayaId, first.Id), new { reason = "New macros", first.Version }),
            HttpStatusCode.OK);
        var second = await A6AssignAsync(coach, mayaId, mealPlan.VersionId, enrollment.Id, adjusted.Result.Id, today);
        Assert.AreEqual((1_940m, 150m, 200m, 60m), (second.CalorieTarget, second.ProteinGrams, second.CarbohydrateGrams, second.FatGrams));
        var day = await ReadSliceAsync<ClientNutritionDayView>(maya, A6DayUrl(today));
        Assert.AreEqual((1_940m, 150m, 200m, 60m), (day.TargetCalories, day.TargetProteinGrams, day.TargetCarbohydrateGrams, day.TargetFatGrams));

        // A coach's own macros can be adjusted again, and a high protein is flagged, never refused.
        await RefreshCsrfAsync(coach);
        var again = await ReadSlicePayloadAsync<NutritionCalculationRecord>(await coach.PostAsJsonAsync(
            A6OverrideUrl(mayaId, adjusted.Result.Id), new CreateMacroOverrideRequest(240m, 60m, 140m, "Testing a higher protein")));
        Assert.AreEqual(adjusted.Result.Id, again.Adjustment?.AdjustedFromCalculationId);
        StringAssert.Contains(again.Result.Warnings.Single(), "g/kg/day");

        // What is refused: no reason, macros that make nothing, more than 1,000 g, a calculation of
        // someone else, one that does not exist, and a client that does not exist.
        foreach (var refused in new[]
        {
            new CreateMacroOverrideRequest(150m, 60m, 200m, "  "),
            new CreateMacroOverrideRequest(0m, 0m, 0m, "Nothing"),
            new CreateMacroOverrideRequest(150m, 60m, 1_001m, "Too much"),
            new CreateMacroOverrideRequest(-1m, 60m, 200m, "Negative"),
        })
        {
            await RefreshCsrfAsync(coach);
            await AssertStatusAsync(await coach.PostAsJsonAsync(A6OverrideUrl(mayaId, formula.Id), refused), HttpStatusCode.BadRequest);
        }

        using var nour = CreateClient();
        var nourId = await R31InviteAsync(coach, nour, tenant, "a6-macros-nour@example.test", "Nour", "Fares");
        await R53dStartNutritionAsync(coach, nourId);
        var nours = await R53dCalculateAsync(coach, nourId, weight: 60m, protein: 100m);
        var valid = new CreateMacroOverrideRequest(150m, 60m, 200m, "Fine");
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PostAsJsonAsync(A6OverrideUrl(mayaId, nours.Id), valid), HttpStatusCode.NotFound);
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PostAsJsonAsync(A6OverrideUrl(mayaId, Guid.NewGuid()), valid), HttpStatusCode.NotFound);
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PostAsJsonAsync(A6OverrideUrl(Guid.NewGuid(), formula.Id), valid), HttpStatusCode.NotFound);
        // Nobody signed out, not the client herself, and no other coach of the team reaches them (ADR 0026).
        using var anonymous = CreateClient();
        SetTenant(anonymous, tenant);
        await AssertStatusAsync(await anonymous.PostAsJsonAsync(A6OverrideUrl(mayaId, formula.Id), valid), HttpStatusCode.Unauthorized);
        await RefreshCsrfAsync(maya);
        await AssertStatusAsync(await maya.PostAsJsonAsync(A6OverrideUrl(mayaId, formula.Id), valid), HttpStatusCode.Forbidden);
        using var lina = CreateClient();
        await JoinAsCoachAsync(coach, lina, "a6-macros-lina@example.test", "Lina Saad");
        await RefreshCsrfAsync(lina);
        await AssertStatusAsync(await lina.PostAsJsonAsync(A6OverrideUrl(mayaId, formula.Id), valid), HttpStatusCode.NotFound);
        Assert.HasCount(3, await ReadSliceAsync<NutritionCalculationRecord[]>(coach, R53dCalculationsUrl(mayaId)), "Nothing refused was recorded.");

        // The database keeps the override and its targets as facts: an override is never rewritten,
        // targets naming none cannot claim to be a coach's, and each override makes one set of targets.
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await A6AssertSqlRefusedAsync(connection, "UPDATE nutrition.\"MacroOverrideAudits\" SET \"Reason\" = 'Rewritten'", null);
        var copy = """
            INSERT INTO nutrition."CalculationSnapshots"
                ("Id", "TenantId", "ClientProfileId", "BmrMethodKey", "BmrMethodVersion", "BmrEstimate", "ActivityModelKey",
                 "ActivityModelVersion", "ActivityModelPal", "TdeeMethodKey", "TdeeMethodVersion", "TdeeEstimate", "CoachGoalAdjustment",
                 "CalorieTarget", "ProteinGrams", "FatGrams", "CarbohydrateGrams", "MacroMethodKey", "MacroMethodVersion",
                 "EnergyPolicyKey", "EnergyPolicyVersion", "InputJson", "MacroOverrideAuditId")
            SELECT gen_random_uuid(), "TenantId", "ClientProfileId", "BmrMethodKey", "BmrMethodVersion", "BmrEstimate", "ActivityModelKey",
                   "ActivityModelVersion", "ActivityModelPal", "TdeeMethodKey", "TdeeMethodVersion", "TdeeEstimate", "CoachGoalAdjustment",
                   "CalorieTarget", "ProteinGrams", "FatGrams", "CarbohydrateGrams", MACRO_KEY, "MacroMethodVersion",
                   "EnergyPolicyKey", "EnergyPolicyVersion", "InputJson", LINK
            FROM nutrition."CalculationSnapshots" WHERE "Id" = @id
            """;
        await A6AssertSqlRefusedAsync(connection, copy.Replace("MACRO_KEY", "'CoachMacroOverride'").Replace("LINK", "NULL"), formula.Id, PostgresErrorCodes.CheckViolation);
        await A6AssertSqlRefusedAsync(connection, copy.Replace("MACRO_KEY", "'Nut008MacroSplit'").Replace("LINK", "\"MacroOverrideAuditId\""), adjusted.Result.Id, PostgresErrorCodes.CheckViolation);
        await A6AssertSqlRefusedAsync(connection, copy.Replace("MACRO_KEY", "\"MacroMethodKey\"").Replace("LINK", "\"MacroOverrideAuditId\""), adjusted.Result.Id, PostgresErrorCodes.UniqueViolation);
        await A6AssertSqlRefusedAsync(connection, copy.Replace("MACRO_KEY", "\"MacroMethodKey\"").Replace("LINK", "gen_random_uuid()"), adjusted.Result.Id, PostgresErrorCodes.ForeignKeyViolation);
    }

    [TestMethod]
    public async Task A6TheOverrideLinkSurvivesARevertAndAReapplyOfItsMigration()
    {
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "a6-migration-coach@example.test", "Hicham Haddad", "A6 Migration");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(coach, maya, tenant, "a6-migration-maya@example.test", "Maya", "Rahman");
        await R53dStartNutritionAsync(coach, mayaId);
        var formula = await R53dCalculateAsync(coach, mayaId, weight: 70m, protein: 130m);
        await RefreshCsrfAsync(coach);
        var adjusted = await ReadSlicePayloadAsync<NutritionCalculationRecord>(await coach.PostAsJsonAsync(
            A6OverrideUrl(mayaId, formula.Id), new CreateMacroOverrideRequest(150m, 60m, 200m, "Before the revert")));

        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var migrations = context.Database.GetMigrations().ToArray();
        var migration = migrations.Single(item => item.EndsWith("_CoachMacrosMakeTargets", StringComparison.Ordinal));
        var previous = migrations[Array.IndexOf(migrations, migration) - 1];
        var migrator = context.Database.GetInfrastructure().GetRequiredService<IMigrator>();

        // The revert drops only the link; snapshots are append-only, so both sets of targets stay.
        await migrator.MigrateAsync(previous);
        Assert.AreEqual(0L, await A6ScalarAsync("SELECT count(*) FROM information_schema.columns WHERE table_schema = 'nutrition' AND table_name = 'CalculationSnapshots' AND column_name = 'MacroOverrideAuditId'"));
        Assert.AreEqual(2L, await A6ScalarAsync("SELECT count(*) FROM nutrition.\"CalculationSnapshots\""));

        // Applied again, the targets made before keep their numbers without their link, and new ones link.
        await migrator.MigrateAsync(migration);
        Assert.AreEqual(1L, await A6ScalarAsync($"SELECT count(*) FROM nutrition.\"CalculationSnapshots\" WHERE \"MacroMethodKey\" = 'CoachMacroOverride' AND \"MacroOverrideAuditId\" IS NULL AND \"Id\" = '{adjusted.Result.Id}'"));
        await RefreshCsrfAsync(coach);
        var afterwards = await coach.PostAsJsonAsync(A6OverrideUrl(mayaId, formula.Id), new CreateMacroOverrideRequest(140m, 60m, 210m, "After the revert"));
        await AssertStatusAsync(afterwards, HttpStatusCode.OK);
        Assert.AreEqual("After the revert", (await ReadSlicePayloadAsync<NutritionCalculationRecord>(afterwards)).Adjustment?.Reason);
        Assert.HasCount(3, await ReadSliceAsync<NutritionCalculationRecord[]>(coach, R53dCalculationsUrl(mayaId)));
    }

    [TestMethod]
    public async Task A6AClientThatIsNotInTheWorkspaceIsNotFoundOnEveryNutritionRoute()
    {
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "a6-missing-owner@example.test", "Hicham Haddad", "A6 Missing");
        using var rami = CreateClient();
        var ramiId = await R31InviteAsync(owner, rami, tenant, "a6-missing-rami@example.test", "Rami", "Khoury");
        var nobody = Guid.NewGuid();
        var calculation = Guid.NewGuid();
        var plan = Guid.NewGuid();

        // The owner, whom the tenant handler never answers 404 for, now meets the same 404 as a coach.
        foreach (var url in new[] { R53dAllergensUrl(nobody), R53dCalculationsUrl(nobody), R53dPlansUrl(nobody) })
        {
            await AssertStatusAsync(await owner.GetAsync(url), HttpStatusCode.NotFound);
        }

        async Task<HttpResponseMessage> PostAsync(string url, object body)
        {
            await RefreshCsrfAsync(owner);
            return await owner.PostAsJsonAsync(url, body);
        }

        await AssertStatusAsync(await PostAsync(R53dCalculationsUrl(nobody), new
        {
            bmrMethodKey = "MifflinStJeor", weightKilograms = 70m, heightCentimeters = 168m, ageYears = 29, sex = "Female",
            bodyFatPercentage = (decimal?)null, occupationType = "Seated", averageDailySteps = 8000, coachGoalAdjustment = 0m,
            calorieTarget = (decimal?)null, proteinGrams = 120m, fatPercentage = 25m, isEnergyDeficit = false,
        }), HttpStatusCode.NotFound);
        await AssertStatusAsync(await PostAsync(A6OverrideUrl(nobody, calculation), new CreateMacroOverrideRequest(150m, 60m, 200m, "Why")), HttpStatusCode.NotFound);
        await AssertStatusAsync(await PostAsync(R53dPlansUrl(nobody), new { mealPlanTemplateVersionId = Guid.NewGuid(), enrollmentId = Guid.NewGuid(), calculationSnapshotId = calculation, startDate = "2026-10-20", acknowledgeAllergenWarnings = false }), HttpStatusCode.NotFound);
        await AssertStatusAsync(await PostAsync(A6CancelUrl(nobody, plan), new { reason = "Why", version = 0 }), HttpStatusCode.NotFound);
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(await owner.PutAsJsonAsync(R53dAllergensUrl(nobody), new { codes = Array.Empty<string>() }), HttpStatusCode.NotFound);

        // A client of the workspace whose plan has no Nutrition is still refused, not hidden.
        foreach (var url in new[] { R53dAllergensUrl(ramiId), R53dCalculationsUrl(ramiId), R53dPlansUrl(ramiId) })
        {
            await AssertStatusAsync(await owner.GetAsync(url), HttpStatusCode.Forbidden);
        }

        await AssertStatusAsync(await PostAsync(A6OverrideUrl(ramiId, calculation), new CreateMacroOverrideRequest(150m, 60m, 200m, "Why")), HttpStatusCode.Forbidden);
    }

    [TestMethod]
    public async Task A6AnEuLabelTypedAsPrintedCountsTheCaloriesOnThePacket()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "a6-eu-coach@example.test", "Hicham Haddad", "A6 EU labels");
        var settings = await ReadSliceAsync<NutritionWorkspaceSettingsView>(coach, "/api/nutrition/settings");
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PutAsJsonAsync("/api/nutrition/settings", new UpdateNutritionSettingsRequest(
            "Eu1169", settings.ProviderCalorieTolerance, 0, 0m, "USD", settings.Version)), HttpStatusCode.OK);

        // Porridge oats as a UK label prints them (C6): 60 g of carbohydrate without the 9 g of fibre.
        object Oats(decimal carbohydrate, string declaration, int? baseRevision = null) => new
        {
            basisQuantity = 100m, basisUnit = "Gram", preparationBasis = "AsSold", proteinGrams = 11m, carbohydrateGrams = carbohydrate,
            fatGrams = 8m, fibreGrams = 9m, polyolGrams = 0m, ethanolGrams = 0m, providerCalories = 374m,
            sourceAttribution = "Coach-authored food", sourceRecordVersion = "coach-entry-v1", declaredAllergens = Array.Empty<string>(),
            name = "Porridge oats", baseRevision, carbohydrateDeclaration = declaration,
        };

        await RefreshCsrfAsync(coach);
        var created = await coach.PostAsJsonAsync("/api/nutrition/foods", new
        {
            name = "Porridge oats", provenance = "CoachAuthored", externalId = (string?)null, externalDataType = (string?)null,
            labelMediaAssetId = (Guid?)null, version = Oats(60m, "WithoutFibre"),
        });
        await AssertStatusAsync(created, HttpStatusCode.OK);
        var oats = await ReadSlicePayloadAsync<FoodItemView>(created);
        Assert.AreEqual((69m, 374m, false), (oats.CurrentVersion.CarbohydrateGrams, oats.CurrentVersion.ComputedCalories, oats.CurrentVersion.HasCalorieDiscrepancy));

        // An edit typed the same way keeps the total; typed as a total, the same numbers are a total.
        await RefreshCsrfAsync(coach);
        var edited = await ReadSlicePayloadAsync<FoodItemView>(await coach.PostAsJsonAsync(
            $"/api/nutrition/foods/{oats.Id}/versions", Oats(60m, "WithoutFibre", oats.CurrentRevision)));
        Assert.AreEqual((2, 69m, 374m), (edited.CurrentRevision, edited.CurrentVersion.CarbohydrateGrams, edited.CurrentVersion.ComputedCalories));
        await RefreshCsrfAsync(coach);
        var total = await ReadSlicePayloadAsync<FoodItemView>(await coach.PostAsJsonAsync(
            $"/api/nutrition/foods/{oats.Id}/versions", Oats(69m, "TotalWithFibre", edited.CurrentRevision)));
        Assert.AreEqual((69m, 374m, false), (total.CurrentVersion.CarbohydrateGrams, total.CurrentVersion.ComputedCalories, total.CurrentVersion.HasCalorieDiscrepancy));

        // Left out, the declaration is a total, as every saved food has been (NUT-011).
        await RefreshCsrfAsync(coach);
        var unsaid = await coach.PostAsJsonAsync("/api/nutrition/foods", new
        {
            name = "Plain oats", provenance = "CoachAuthored", externalId = (string?)null, externalDataType = (string?)null, labelMediaAssetId = (Guid?)null,
            version = new
            {
                basisQuantity = 100m, basisUnit = "Gram", preparationBasis = "AsSold", proteinGrams = 11m, carbohydrateGrams = 60m, fatGrams = 8m,
                fibreGrams = 9m, polyolGrams = 0m, ethanolGrams = 0m, providerCalories = 374m, sourceAttribution = "Coach-authored food",
                sourceRecordVersion = "coach-entry-v1", declaredAllergens = Array.Empty<string>(),
            },
        });
        var plain = (await ReadSlicePayloadAsync<FoodItemView>(unsaid)).CurrentVersion;
        Assert.AreEqual((60m, 338m, true), (plain.CarbohydrateGrams, plain.ComputedCalories, plain.HasCalorieDiscrepancy));
    }

    [TestMethod]
    public async Task A6RealUsdaProviderOutageTimeoutAndBrokenAnswersAreTheDesignedFailures()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "a6-usda-coach@example.test", "Hicham Haddad", "A6 USDA");

        // A search tells the page USDA failed, with no matches, rather than failing the page (BEA-2).
        foreach (var (query, code) in new[]
        {
            (UsdaFoodDataCentralFake.UnreachableQuery, "usda_unreachable"),
            (UsdaFoodDataCentralFake.TimeoutQuery, "usda_timeout"),
            (UsdaFoodDataCentralFake.NotJsonQuery, "usda_schema_changed"),
            (UsdaFoodDataCentralFake.WrongShapeQuery, "usda_schema_changed"),
        })
        {
            var page = await ReadSliceAsync<ProviderFoodSearchPage>(coach, $"/api/nutrition/providers/usda/search?query={Uri.EscapeDataString(query)}");
            Assert.AreEqual(code, page.FailureCode, query);
            Assert.IsEmpty(page.Items);
        }

        // An import answers 503 with the code and a sentence for the coach, and adds nothing.
        foreach (var (fdcId, code, words) in new[]
        {
            (UsdaFoodDataCentralFake.UnreachableFdcId, "usda_unreachable", "couldn’t be reached"),
            (UsdaFoodDataCentralFake.TimeoutFdcId, "usda_timeout", "took too long"),
            (UsdaFoodDataCentralFake.NotJsonFdcId, "usda_schema_changed", "unexpected response"),
            (UsdaFoodDataCentralFake.WrongShapeFdcId, "usda_schema_changed", "no structured nutrient array"),
        })
        {
            await RefreshCsrfAsync(coach);
            var refused = await coach.PostAsJsonAsync("/api/nutrition/providers/usda/import", new { fdcId });
            Assert.AreEqual(HttpStatusCode.ServiceUnavailable, refused.StatusCode, fdcId);
            var problem = await RequiredJsonAsync<Phase4ProviderProblem>(refused);
            Assert.AreEqual(code, problem.Code, fdcId);
            Assert.Contains(words, problem.Message, fdcId);
        }

        Assert.AreEqual(0, (await coach.GetFromJsonAsync<Phase4FoodPage>("/api/nutrition/foods"))!.Total);

        // USDA working again, the same coach's search and import work as before.
        Assert.IsNull((await ReadSliceAsync<ProviderFoodSearchPage>(coach, "/api/nutrition/providers/usda/search?query=chicken")).FailureCode);
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PostAsJsonAsync("/api/nutrition/providers/usda/import", new { fdcId = UsdaFoodDataCentralFake.ChickenFdcId }), HttpStatusCode.OK);
    }

    [TestMethod]
    public async Task A6TwoSavesOfOneFoodAtOnceKeepOneAndCallTheOtherAChange()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "a6-food-race@example.test", "Hicham Haddad", "A6 Food race");
        await RefreshCsrfAsync(coach);
        var food = await ReadSlicePayloadAsync<FoodItemView>(await coach.PostAsJsonAsync("/api/nutrition/foods", new
        {
            name = "Greek yogurt", provenance = "CoachAuthored", externalId = (string?)null, externalDataType = (string?)null,
            labelMediaAssetId = (Guid?)null, version = FoodVersion(10m, NoAllergens),
        }));

        object Edit(decimal protein, int? baseRevision) => new
        {
            basisQuantity = 100m, basisUnit = "Gram", preparationBasis = "Prepared", proteinGrams = protein, carbohydrateGrams = 30m,
            fatGrams = 10m, fibreGrams = 5m, polyolGrams = 0m, ethanolGrams = 0m, providerCalories = (decimal?)null,
            sourceAttribution = "Coach authored test record", sourceRecordVersion = "test-v1", declaredAllergens = Array.Empty<string>(),
            name = "Greek yogurt", baseRevision,
        };

        // The editor's saves name the revision they opened: one is kept, the other is told the food
        // changed. A save naming none is told the food was versioned. Neither is a 500 (BEA-6).
        var revision = food.CurrentRevision;
        foreach (var (named, code) in new[] { (true, "food_changed"), (false, "food_version_conflict") })
        {
            await RefreshCsrfAsync(coach);
            RequiredInsertBarrier.Arm("nutrition.\"FoodItemVersions\"", 2);
            HttpResponseMessage[] saves;
            try
            {
                saves = await Task.WhenAll(
                    coach.PostAsJsonAsync($"/api/nutrition/foods/{food.Id}/versions", Edit(11m, named ? revision : null)),
                    coach.PostAsJsonAsync($"/api/nutrition/foods/{food.Id}/versions", Edit(12m, named ? revision : null)));
                Assert.AreEqual(2, RequiredInsertBarrier.Arrived, "The two saves never raced.");
            }
            finally
            {
                RequiredInsertBarrier.Disarm();
            }

            CollectionAssert.AreEquivalent(new[] { HttpStatusCode.OK, HttpStatusCode.Conflict }, saves.Select(item => item.StatusCode).ToArray());
            await A6AssertConflictAsync(saves.Single(item => item.StatusCode == HttpStatusCode.Conflict), code);
            revision++;
        }

        Assert.AreEqual(3L, await A6ScalarAsync($"SELECT count(*) FROM nutrition.\"FoodItemVersions\" WHERE \"FoodItemId\" = '{food.Id}'"));
    }

    [TestMethod]
    public async Task A6AiTwoApprovalsOfOneSuggestionAtOnceSaveOneRecipe()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "a6-ai-race@example.test", "Hicham Haddad", "A6 AI race");
        await SetLaunchAiBudgetAsync(coach, 10, 10m);
        Assert.IsTrue((await ReadSliceAsync<AiMealDraftAvailabilityView>(coach, "/api/nutrition/ai-drafts/availability")).IsConfigured);
        var oats = await R44bFoodAsync(coach, "Rolled oats", 13m, []);
        var suggestion = await R44bSuggestAsync(coach);
        ReviewAiMealDraftRequest Approval(string name) =>
            new(true, "Coach matched the foods.", name, "Stir in the oats.", 1m, [R44bMapping(oats, 80m)]);

        await RefreshCsrfAsync(coach);
        RequiredInsertBarrier.Arm("nutrition.\"Recipes\"", 2);
        HttpResponseMessage[] approvals;
        try
        {
            approvals = await Task.WhenAll(
                coach.PostAsJsonAsync($"/api/nutrition/ai-drafts/{suggestion}/review", Approval("Oat bowl"), SliceReadJson),
                coach.PostAsJsonAsync($"/api/nutrition/ai-drafts/{suggestion}/review", Approval("Oat bowl again"), SliceReadJson));
            Assert.AreEqual(2, RequiredInsertBarrier.Arrived, "The two approvals never raced.");
        }
        finally
        {
            RequiredInsertBarrier.Disarm();
        }

        // One approval is kept with its recipe; the other is told it was already reviewed (BEA-7).
        CollectionAssert.AreEquivalent(new[] { HttpStatusCode.OK, HttpStatusCode.Conflict }, approvals.Select(item => item.StatusCode).ToArray());
        await A6AssertConflictAsync(approvals.Single(item => item.StatusCode == HttpStatusCode.Conflict), "ai_review_conflict");
        Assert.AreEqual(1L, await A6ScalarAsync("SELECT count(*) FROM nutrition.\"Recipes\""));

        // A later approval or rejection of the same suggestion answers alike.
        await RefreshCsrfAsync(coach);
        await A6AssertConflictAsync(await coach.PostAsJsonAsync($"/api/nutrition/ai-drafts/{suggestion}/review", Approval("Third"), SliceReadJson), "ai_review_conflict");
        await RefreshCsrfAsync(coach);
        await A6AssertConflictAsync(
            await coach.PostAsJsonAsync($"/api/nutrition/ai-drafts/{suggestion}/review", new ReviewAiMealDraftRequest(false, "Not now", null, null, null, []), SliceReadJson),
            "ai_review_conflict");
        Assert.AreEqual(1L, await A6ScalarAsync("SELECT count(*) FROM nutrition.\"Recipes\""));
    }

    [TestMethod]
    public async Task A6AiOffWhileTbGymsCeilingIsZeroEvenWithTheProviderSetUp()
    {
        // The provider is set up, but TB Gym's ceiling is zero, so suggestions are off: Settings and the
        // recipe editor read the same answer (LOST-4).
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "a6-ai-off@example.test", "Hicham Haddad", "A6 AI off");
        Assert.IsFalse((await ReadSliceAsync<AiMealDraftAvailabilityView>(coach, "/api/nutrition/ai-drafts/availability")).IsConfigured);
        Assert.AreEqual(0, (await ReadSliceAsync<NutritionWorkspaceSettingsView>(coach, "/api/nutrition/settings")).AiMaximumMonthlyRequests);
    }

    [TestMethod]
    public async Task A6ALoggedMealCarriesTheCaloriesOfTheAmountLogged()
    {
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "a6-logged-coach@example.test", "Hicham Haddad", "A6 Logged");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(coach, maya, tenant, "a6-logged-maya@example.test", "Maya", "Rahman");
        var (mealPlan, enrollment) = await A6MealPlanAsync(coach, mayaId, "Spring cut");
        var calculation = await R53dCalculateAsync(coach, mayaId, weight: 70m, protein: 130m);
        var today = TenantToday();
        await A6AssignAsync(coach, mayaId, mealPlan.VersionId, enrollment.Id, calculation.Id, today);

        var before = await ReadSliceAsync<ClientNutritionDayView>(maya, A6DayUrl(today));
        var breakfast = before.Slots.OrderBy(slot => slot.Order).First();
        var choice = breakfast.Choices.Single();
        Assert.IsNull(breakfast.LoggedCalories, "Nothing is logged yet.");

        // One and a half of the plan's servings: the meal carries the calories the day's totals count.
        await RefreshCsrfAsync(maya);
        var logged = await maya.PutAsJsonAsync("/api/nutrition/me/choices", new
        {
            planDayId = before.PlanDayId,
            planSlotId = breakfast.Id,
            choiceId = choice.Id,
            actualServings = choice.Servings * 1.5m,
            dailyLogVersion = before.DailyLogVersion,
        });
        await AssertStatusAsync(logged, HttpStatusCode.OK);
        var day = await ReadSlicePayloadAsync<ClientNutritionDayView>(logged);
        var meal = day.Slots.Single(slot => slot.Id == breakfast.Id);
        Assert.AreEqual(choice.Calories * 1.5m, meal.LoggedCalories!.Value, StoredPrecision);
        Assert.AreEqual(day.SelectedCalories, meal.LoggedCalories!.Value, StoredPrecision, "The only meal logged is the day's total.");
        Assert.AreEqual(choice.Calories, meal.Choices.Single().Calories, "The plan's own serving is unchanged.");
        Assert.AreEqual(meal.LoggedCalories, (await ReadSliceAsync<ClientNutritionDayView>(maya, A6DayUrl(today))).Slots.Single(slot => slot.Id == breakfast.Id).LoggedCalories);
    }

    /// <summary>A published two-day meal plan (R44a's content) and a free two-week Nutrition plan from today.</summary>
    private static async Task<(MealPlanTemplateSummary MealPlan, Enrollment Enrollment)> A6MealPlanAsync(HttpClient coach, Guid clientId, string name)
    {
        var oats = await R44aRecipeAsync(coach, $"{name} oats", 13m);
        var chicken = await R44aRecipeAsync(coach, $"{name} chicken", 31m);
        var draft = await R44aCreateAsync(coach, new(null, null, null, R44aContent(oats.VersionId, chicken.VersionId, name: name)));
        var mealPlan = await R44aPublishAsync(coach, draft.Id, draft.Version, replaceNewer: false);
        return (mealPlan, await R53dStartNutritionAsync(coach, clientId));
    }

    private static async Task<ClientNutritionPlanSummary> A6AssignAsync(HttpClient coach, Guid clientId, Guid mealPlanVersionId, Guid enrollmentId, Guid calculationId, DateOnly start)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync(R53dPlansUrl(clientId), new
        {
            mealPlanTemplateVersionId = mealPlanVersionId,
            enrollmentId,
            calculationSnapshotId = calculationId,
            startDate = start.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            acknowledgeAllergenWarnings = false,
        });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<ClientNutritionPlanSummary>(response);
    }

    private static async Task A6AssertConflictAsync(HttpResponseMessage response, string code)
    {
        await AssertStatusAsync(response, HttpStatusCode.Conflict);
        Assert.AreEqual(code, (await response.Content.ReadFromJsonAsync<A6Refusal>())?.Code);
    }

    private static async Task A6AssertSqlRefusedAsync(NpgsqlConnection connection, string sql, Guid? id, string? sqlState = null)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        if (id is { } value)
        {
            command.Parameters.AddWithValue("id", value);
        }

        var refused = await Assert.ThrowsAsync<PostgresException>(async () => await command.ExecuteNonQueryAsync());
        if (sqlState is not null)
        {
            Assert.AreEqual(sqlState, refused.SqlState, refused.MessageText);
        }
    }

    private async Task<long> A6ScalarAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        return Convert.ToInt64(await command.ExecuteScalarAsync(), CultureInfo.InvariantCulture);
    }

    private sealed record A6Refusal(string Code, string Message);
}
