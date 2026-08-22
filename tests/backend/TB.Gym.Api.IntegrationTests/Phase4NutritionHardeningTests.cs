using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.Logging;
using Npgsql;
using TB.Gym.Modules.Nutrition;

namespace TB.Gym.Api.IntegrationTests;

public sealed partial class Phase3TrainingWorkflowTests
{
    private static readonly string[] MilkAllergen = ["Milk"];
    private static readonly string[] NoAllergens = [];

    [TestMethod]
    public async Task Phase4AssignmentSnapshotsLibraryAndLoggingKeepsPrescriptionSeparate()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "p4-snapshot-coach@example.test", "Nutrition Coach", "Nutrition Snapshot");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "p4-snapshot-client@example.test", true);
        SetTenant(client, workspaceId);
        var scenario = await CreateNutritionScenarioAsync(coach, clientId, 1, 7, false, true);

        var before = await client.GetFromJsonAsync<Phase4Day>("/api/nutrition/me/day?localDate=2026-08-22")
            ?? throw new AssertFailedException("Nutrition day was empty.");
        var prescribedCalories = before.Slots.Single().Choices.Single().Calories;

        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PostAsJsonAsync($"/api/nutrition/recipes/{scenario.RecipeId}/versions", new
        {
            instructions = "A later library edit.",
            servings = 1m,
            ingredients = new[] { new { foodItemVersionId = scenario.FoodVersionId, quantity = 50m, unit = "Gram", basis = "Prepared", yieldFactorId = (Guid?)null, retentionFactorId = (Guid?)null } },
        }), HttpStatusCode.OK);
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PostAsJsonAsync($"/api/nutrition/meal-plans/{scenario.MealPlanId}/versions", new
        {
            dayCount = 1,
            targetCalories = 1_900m,
            targetProteinGrams = 140m,
            targetCarbohydrateGrams = 210m,
            targetFatGrams = 55m,
            slots = new[] { new { dayOffset = 0, order = 0, name = "Edited meal", choices = new[] { new { recipeVersionId = scenario.RecipeVersionId, servings = 1m } } } },
        }), HttpStatusCode.OK);

        await RefreshCsrfAsync(coach);
        var edited = await coach.PostAsJsonAsync($"/api/nutrition/foods/{scenario.FoodId}/versions", FoodVersion(40m, []));
        await AssertStatusAsync(edited, HttpStatusCode.OK);
        var afterEdit = await client.GetFromJsonAsync<Phase4Day>("/api/nutrition/me/day?localDate=2026-08-22")
            ?? throw new AssertFailedException("Nutrition day was empty after the library edit.");
        Assert.AreEqual(prescribedCalories, afterEdit.Slots.Single().Choices.Single().Calories);

        var slot = afterEdit.Slots.Single();
        await RefreshCsrfAsync(client);
        var loggedResponse = await client.PutAsJsonAsync("/api/nutrition/me/choices", new
        {
            planDayId = afterEdit.PlanDayId,
            planSlotId = slot.Id,
            choiceId = slot.Choices.Single().Id,
            actualServings = 2m,
            dailyLogVersion = afterEdit.DailyLogVersion,
        });
        await AssertStatusAsync(loggedResponse, HttpStatusCode.OK);
        var logged = await RequiredJsonAsync<Phase4Day>(loggedResponse);
        Assert.AreEqual(prescribedCalories, logged.Slots.Single().Choices.Single().Calories);
        Assert.AreEqual(prescribedCalories * 2m, logged.SelectedCalories);

        await RefreshCsrfAsync(client);
        var completed = await client.PostAsJsonAsync($"/api/nutrition/me/logs/{logged.DailyLogId}/complete", new { version = logged.DailyLogVersion });
        await AssertStatusAsync(completed, HttpStatusCode.OK);
        var completedDay = await RequiredJsonAsync<Phase4Day>(completed);
        Assert.AreEqual("Completed", completedDay.LogStatus);
    }

    [TestMethod]
    public async Task Phase4CoverageRejectsPlanPastEnrollmentBoundaryWithoutPersistingPlan()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "p4-coverage-coach@example.test", "Nutrition Coach", "Nutrition Coverage");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "p4-coverage-client@example.test", true);
        var scenario = await CreateNutritionScenarioAsync(coach, clientId, 2, 1, false, false);

        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync($"/api/nutrition/clients/{clientId}/plans", new
        {
            mealPlanTemplateVersionId = scenario.MealPlanVersionId,
            enrollmentId = scenario.EnrollmentId,
            calculationSnapshotId = scenario.CalculationId,
            startDate = "2026-08-22",
            acknowledgeAllergenWarnings = false,
        });
        Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);

        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT count(*) FROM nutrition.\"ClientNutritionPlans\"";
        Assert.AreEqual(0L, (long)(await command.ExecuteScalarAsync() ?? -1L));
    }

    [TestMethod]
    public async Task Phase4AuthorizationDeniesAnonymousCrossTenantAndSameTenantOtherClient()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "p4-auth-coach@example.test", "Nutrition Coach", "Nutrition Auth");
        using var assignedClient = CreateClient();
        var assignedClientId = await InviteAndAcceptAsync(coach, assignedClient, "p4-auth-client@example.test", true);
        SetTenant(assignedClient, workspaceId);
        var scenario = await CreateNutritionScenarioAsync(coach, assignedClientId, 1, 7, false, true);

        using var otherClient = CreateClient();
        await InviteAndAcceptAsync(coach, otherClient, "p4-auth-other-client@example.test", true);
        SetTenant(otherClient, workspaceId);
        Assert.AreEqual(HttpStatusCode.NotFound, (await otherClient.GetAsync("/api/nutrition/me/day?localDate=2026-08-22")).StatusCode);

        using var foreignCoach = CreateClient();
        await RegisterCoachAsync(foreignCoach, "p4-auth-foreign@example.test", "Foreign Coach", "Foreign Nutrition");
        Assert.AreEqual(HttpStatusCode.Forbidden, (await foreignCoach.GetAsync($"/api/nutrition/clients/{assignedClientId}/plans")).StatusCode);
        await RefreshCsrfAsync(foreignCoach);
        Assert.AreEqual(HttpStatusCode.NotFound, (await foreignCoach.PostAsJsonAsync($"/api/nutrition/foods/{scenario.FoodId}/versions", FoodVersion(30m, []))).StatusCode);
        await RefreshCsrfAsync(foreignCoach);
        Assert.AreEqual(HttpStatusCode.NotFound, (await foreignCoach.PostAsJsonAsync($"/api/nutrition/recipes/{scenario.RecipeId}/versions", new { instructions = "Cross-tenant", servings = 1m, ingredients = Array.Empty<object>() })).StatusCode);
        await RefreshCsrfAsync(foreignCoach);
        Assert.AreEqual(HttpStatusCode.NotFound, (await foreignCoach.PostAsJsonAsync($"/api/nutrition/meal-plans/{scenario.MealPlanId}/versions", new { dayCount = 1, targetCalories = 1m, targetProteinGrams = 0m, targetCarbohydrateGrams = 0m, targetFatGrams = 0m, slots = Array.Empty<object>() })).StatusCode);

        using var anonymous = CreateClient();
        Assert.AreEqual(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/nutrition/foods")).StatusCode);
        Assert.AreEqual(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/nutrition/me/day?localDate=2026-08-22")).StatusCode);
    }

    [TestMethod]
    public async Task Phase4ConcurrentOverlappingAssignmentsAllowExactlyOneWriter()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "p4-concurrency-coach@example.test", "Nutrition Coach", "Nutrition Concurrency");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "p4-concurrency-client@example.test", true);
        var scenario = await CreateNutritionScenarioAsync(coach, clientId, 1, 7, false, false);
        await RefreshCsrfAsync(coach);

        var responses = await Task.WhenAll(
            coach.PostAsJsonAsync($"/api/nutrition/clients/{clientId}/plans", AssignmentRequest(scenario, false)),
            coach.PostAsJsonAsync($"/api/nutrition/clients/{clientId}/plans", AssignmentRequest(scenario, false)));

        Assert.AreEqual(1, responses.Count(item => item.StatusCode == HttpStatusCode.OK));
        Assert.AreEqual(1, responses.Count(item => item.StatusCode == HttpStatusCode.Conflict));
    }

    [TestMethod]
    public async Task Phase4AllergenConflictRequiresAcknowledgementRecordsWarningAndDoesNotLogSensitiveIntake()
    {
        const string sensitiveAllergy = "phase4-sensitive-allergy";
        const string sensitiveMedication = "phase4-sensitive-medication";
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "p4-allergen-coach@example.test", "Nutrition Coach", "Nutrition Safety");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "p4-allergen-client@example.test", true);
        var scenario = await CreateNutritionScenarioAsync(coach, clientId, 1, 7, true, false);

        var details = await coach.GetFromJsonAsync<Phase4ClientDetails>($"/api/clients/{clientId}")
            ?? throw new AssertFailedException("Client details were empty.");
        await RefreshCsrfAsync(coach);
        var intake = await coach.PutAsJsonAsync($"/api/clients/{clientId}/intake", new
        {
            firstName = details.FirstName,
            lastName = details.LastName,
            details.PhoneNumber,
            details.BirthDate,
            heightValue = details.HeightEnteredValue,
            heightUnit = details.HeightEnteredUnit,
            details.WorkType,
            details.AverageDailySteps,
            details.TrainingBackground,
            details.FoodPreferences,
            details.FoodAversions,
            details.Goals,
            allergies = sensitiveAllergy,
            medications = sensitiveMedication,
            details.PreviousInjuries,
            details.Version,
        });
        await AssertStatusAsync(intake, HttpStatusCode.OK);

        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PutAsJsonAsync($"/api/nutrition/clients/{clientId}/allergens", new { codes = MilkAllergen }), HttpStatusCode.OK);
        await RefreshCsrfAsync(coach);
        var warning = await coach.PostAsJsonAsync($"/api/nutrition/clients/{clientId}/plans", AssignmentRequest(scenario, false));
        Assert.AreEqual(HttpStatusCode.Conflict, warning.StatusCode);
        StringAssert.Contains(await warning.Content.ReadAsStringAsync(), "does not assert any recipe is safe");

        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PostAsJsonAsync($"/api/nutrition/clients/{clientId}/plans", AssignmentRequest(scenario, true)), HttpStatusCode.OK);
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT count(*) FROM nutrition.\"AllergenConflictRecords\"";
        Assert.AreEqual(1L, (long)(await command.ExecuteScalarAsync() ?? -1L));

        var captured = RequiredSensitiveLogCapture.Text;
        Assert.IsFalse(captured.Contains(sensitiveAllergy, StringComparison.Ordinal));
        Assert.IsFalse(captured.Contains(sensitiveMedication, StringComparison.Ordinal));
    }

    [TestMethod]
    public async Task Phase4InvalidAiSchemaFailsVisiblyAndNeverCreatesLibraryFact()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "p4-ai-coach@example.test", "Nutrition Coach", "Nutrition AI");
        var settings = await coach.GetFromJsonAsync<Phase4Settings>("/api/nutrition/settings")
            ?? throw new AssertFailedException("Nutrition settings were empty.");
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PutAsJsonAsync("/api/nutrition/settings", new
        {
            settings.EnergyPolicyKey,
            settings.ProviderCalorieTolerance,
            aiMonthlyRequestLimit = 10,
            aiMonthlyCostLimit = 10m,
            aiCostCurrency = "USD",
            settings.Version,
        }), HttpStatusCode.OK);

        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync("/api/nutrition/ai-drafts", new { prompt = "Create a meal", promptVersion = "coach-prompt-v1", culture = "en-LB" });
        Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);
        StringAssert.Contains(await response.Content.ReadAsStringAsync(), "schema");

        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT (SELECT count(*) FROM nutrition.\"AiMealDraftOperations\" WHERE \"Status\" = 'Failed'), (SELECT count(*) FROM nutrition.\"Recipes\")";
        await using var reader = await command.ExecuteReaderAsync();
        Assert.IsTrue(await reader.ReadAsync());
        Assert.AreEqual(1L, reader.GetInt64(0));
        Assert.AreEqual(0L, reader.GetInt64(1));
    }

    [TestMethod]
    public async Task Phase4PostgreSqlTriggersRejectPublishedAppendOnlyAndCompletedMutations()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "p4-trigger-coach@example.test", "Nutrition Coach", "Nutrition Triggers");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "p4-trigger-client@example.test", true);
        SetTenant(client, workspaceId);
        var scenario = await CreateNutritionScenarioAsync(coach, clientId, 1, 7, false, true);
        var day = await client.GetFromJsonAsync<Phase4Day>("/api/nutrition/me/day?localDate=2026-08-22")
            ?? throw new AssertFailedException("Nutrition day was empty.");
        var slot = day.Slots.Single();
        await RefreshCsrfAsync(client);
        var logged = await RequiredJsonAsync<Phase4Day>(await client.PutAsJsonAsync("/api/nutrition/me/choices", new
        {
            planDayId = day.PlanDayId,
            planSlotId = slot.Id,
            choiceId = slot.Choices.Single().Id,
            actualServings = 1m,
            dailyLogVersion = day.DailyLogVersion,
        }));
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(await client.PostAsJsonAsync($"/api/nutrition/me/logs/{logged.DailyLogId}/complete", new { version = logged.DailyLogVersion }), HttpStatusCode.OK);

        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await AssertDatabaseMutationRejectedAsync(connection, "UPDATE nutrition.\"CalculationSnapshots\" SET \"CalorieTarget\" = \"CalorieTarget\" + 1 WHERE \"Id\" = @id", scenario.CalculationId);
        await AssertDatabaseMutationRejectedAsync(connection, "UPDATE nutrition.\"RecipeVersions\" SET \"Servings\" = \"Servings\" + 1 WHERE \"Id\" = @id", scenario.RecipeVersionId);
        await AssertDatabaseMutationRejectedAsync(connection, "UPDATE nutrition.\"DailyNutritionLogs\" SET \"LocalDate\" = \"LocalDate\" + 1 WHERE \"Id\" = @id", logged.DailyLogId!.Value);
    }

    private static async Task AssertDatabaseMutationRejectedAsync(NpgsqlConnection connection, string sql, Guid id)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.Parameters.AddWithValue("id", id);
        await Assert.ThrowsAsync<PostgresException>(async () => await command.ExecuteNonQueryAsync());
    }

    [TestMethod]
    public async Task Phase4UsdaImportChargesFibreOnceUnderEu1169()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "p4-usda-coach@example.test", "Nutrition Coach", "Nutrition Usda");

        var settings = await coach.GetFromJsonAsync<Phase4Settings>("/api/nutrition/settings")
            ?? throw new AssertFailedException("Nutrition settings were empty.");
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PutAsJsonAsync("/api/nutrition/settings", new
        {
            energyPolicyKey = "Eu1169",
            providerCalorieTolerance = settings.ProviderCalorieTolerance,
            aiMonthlyRequestLimit = 0,
            aiMonthlyCostLimit = 0m,
            aiCostCurrency = "USD",
            version = settings.Version,
        }), HttpStatusCode.OK);

        await RefreshCsrfAsync(coach);
        var imported = await coach.PostAsJsonAsync("/api/nutrition/providers/usda/import", new
        {
            fdcId = FibreRichTestNutritionDataProvider.LentilFdcId,
        });
        await AssertStatusAsync(imported, HttpStatusCode.OK);

        // USDA reports carbohydrate by difference (20.13 g), which already contains the 7.9 g of
        // dietary fibre. EU 1169 must charge the available 12.23 g at 4 kcal/g and fibre at its own
        // 2 kcal/g: 9.02*4 + 12.23*4 + 0.38*9 + 7.9*2 = 104.22. Charging the full carbohydrate
        // would bill fibre at 4 + 2 kcal/g and overstate this food as 135.82.
        var food = await RequiredJsonAsync<Phase4ImportedFood>(imported);
        Assert.AreEqual(104.22m, food.CurrentVersion.ComputedCalories);
    }

    [TestMethod]
    public async Task Phase4CancelledPlanReleasesDatesAndKeepsHistory()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "p4-cancel-coach@example.test", "Nutrition Coach", "Nutrition Cancel");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "p4-cancel-client@example.test", true);
        SetTenant(client, workspaceId);
        var scenario = await CreateNutritionScenarioAsync(coach, clientId, 1, 7, false, true);

        await RefreshCsrfAsync(coach);
        var blocked = await coach.PostAsJsonAsync($"/api/nutrition/clients/{clientId}/plans", AssignmentRequest(scenario, false));
        Assert.AreEqual(HttpStatusCode.Conflict, blocked.StatusCode);

        var plans = await coach.GetFromJsonAsync<Phase4PlanSummary[]>($"/api/nutrition/clients/{clientId}/plans")
            ?? throw new AssertFailedException("Client plans were empty.");
        var original = plans.Single();
        Assert.AreEqual("Active", original.Status);

        await RefreshCsrfAsync(coach);
        var cancelled = await coach.PostAsJsonAsync(
            $"/api/nutrition/clients/{clientId}/plans/{original.Id}/cancel",
            new { reason = "Assigned the wrong meal plan.", version = original.Version });
        await AssertStatusAsync(cancelled, HttpStatusCode.OK);
        Assert.AreEqual("Cancelled", (await RequiredJsonAsync<Phase4PlanSummary>(cancelled)).Status);

        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync($"/api/nutrition/clients/{clientId}/plans", AssignmentRequest(scenario, false)),
            HttpStatusCode.OK);

        var afterPlans = await coach.GetFromJsonAsync<Phase4PlanSummary[]>($"/api/nutrition/clients/{clientId}/plans")
            ?? throw new AssertFailedException("Client plans were empty after reassignment.");
        Assert.HasCount(2, afterPlans);
        Assert.HasCount(1, afterPlans.Where(item => item.Status == "Cancelled").ToArray());
        var day = await client.GetFromJsonAsync<Phase4Day>("/api/nutrition/me/day?localDate=2026-08-22")
            ?? throw new AssertFailedException("Nutrition day was empty after reassignment.");
        Assert.AreEqual(afterPlans.Single(item => item.Status == "Active").Id, day.PlanId);

        await RefreshCsrfAsync(coach);
        var second = await coach.PostAsJsonAsync(
            $"/api/nutrition/clients/{clientId}/plans/{original.Id}/cancel",
            new { reason = "Repeat.", version = original.Version });
        Assert.AreEqual(HttpStatusCode.Conflict, second.StatusCode);
    }

    [TestMethod]
    public async Task Phase4ClientCannotLogAgainstAnotherClientsSlot()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "p4-slot-coach@example.test", "Nutrition Coach", "Nutrition Slot");
        using var victim = CreateClient();
        var victimId = await InviteAndAcceptAsync(coach, victim, "p4-slot-victim@example.test", true);
        SetTenant(victim, workspaceId);
        using var attacker = CreateClient();
        var attackerId = await InviteAndAcceptAsync(coach, attacker, "p4-slot-attacker@example.test", true);
        SetTenant(attacker, workspaceId);

        await CreateNutritionScenarioAsync(coach, victimId, 1, 7, false, true);
        await CreateNutritionScenarioAsync(coach, attackerId, 1, 7, false, true);

        var victimDay = await victim.GetFromJsonAsync<Phase4Day>("/api/nutrition/me/day?localDate=2026-08-22")
            ?? throw new AssertFailedException("Victim nutrition day was empty.");
        var attackerDay = await attacker.GetFromJsonAsync<Phase4Day>("/api/nutrition/me/day?localDate=2026-08-22")
            ?? throw new AssertFailedException("Attacker nutrition day was empty.");
        var victimSlot = victimDay.Slots.Single();

        // Same tenant and valid identifiers, but the slot belongs to another client's plan day.
        await RefreshCsrfAsync(attacker);
        var response = await attacker.PutAsJsonAsync("/api/nutrition/me/choices", new
        {
            planDayId = attackerDay.PlanDayId,
            planSlotId = victimSlot.Id,
            choiceId = victimSlot.Choices.Single().Id,
            actualServings = 1m,
            dailyLogVersion = (uint?)null,
        });
        Assert.AreEqual(HttpStatusCode.BadRequest, response.StatusCode);

        var after = await attacker.GetFromJsonAsync<Phase4Day>("/api/nutrition/me/day?localDate=2026-08-22")
            ?? throw new AssertFailedException("Attacker nutrition day was empty after the attempt.");
        Assert.AreEqual(0m, after.SelectedCalories);
        Assert.IsNull(after.DailyLogId);
    }

    private static async Task<Phase4Scenario> CreateNutritionScenarioAsync(HttpClient coach, Guid clientId, int dayCount, int enrollmentDays, bool milkAllergen, bool assign)
    {
        var enrollment = await CreateFreeNutritionEnrollmentAsync(coach, clientId, enrollmentDays);
        await RefreshCsrfAsync(coach);
        var foodResponse = await coach.PostAsJsonAsync("/api/nutrition/foods", new
        {
            name = $"Coach food {Guid.NewGuid():N}",
            provenance = "CoachAuthored",
            externalId = (string?)null,
            externalDataType = (string?)null,
            labelMediaAssetId = (Guid?)null,
            version = FoodVersion(20m, milkAllergen ? MilkAllergen : NoAllergens),
        });
        await AssertStatusAsync(foodResponse, HttpStatusCode.OK);
        var food = await RequiredJsonAsync<Phase4Food>(foodResponse);

        await RefreshCsrfAsync(coach);
        var recipeResponse = await coach.PostAsJsonAsync("/api/nutrition/recipes", new
        {
            name = $"Recipe {Guid.NewGuid():N}",
            instructions = "Coach-authored preparation.",
            servings = 1m,
            ingredients = new[] { new { foodItemVersionId = food.CurrentVersion.Id, quantity = 100m, unit = "Gram", basis = "Prepared", yieldFactorId = (Guid?)null, retentionFactorId = (Guid?)null } },
        });
        await AssertStatusAsync(recipeResponse, HttpStatusCode.OK);
        var recipe = await RequiredJsonAsync<Phase4Recipe>(recipeResponse);
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PostAsync($"/api/nutrition/recipe-versions/{recipe.VersionId}/publish", null), HttpStatusCode.OK);

        var slots = Enumerable.Range(0, dayCount).Select(day => new
        {
            dayOffset = day,
            order = 0,
            name = "Meal",
            choices = new[] { new { recipeVersionId = recipe.VersionId, servings = 1m } },
        }).ToArray();
        await RefreshCsrfAsync(coach);
        var planResponse = await coach.PostAsJsonAsync("/api/nutrition/meal-plans", new
        {
            name = $"Plan {Guid.NewGuid():N}",
            dayCount,
            targetCalories = 2000m,
            targetProteinGrams = 150m,
            targetCarbohydrateGrams = 220m,
            targetFatGrams = 60m,
            slots,
        });
        await AssertStatusAsync(planResponse, HttpStatusCode.OK);
        var plan = await RequiredJsonAsync<Phase4MealPlan>(planResponse);
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PostAsync($"/api/nutrition/meal-plan-versions/{plan.VersionId}/publish", null), HttpStatusCode.OK);

        await RefreshCsrfAsync(coach);
        var calculationResponse = await coach.PostAsJsonAsync($"/api/nutrition/clients/{clientId}/calculations", new
        {
            bmrMethodKey = "MifflinStJeor",
            weightKilograms = 80m,
            heightCentimeters = 180m,
            ageYears = 30,
            sex = "Male",
            bodyFatPercentage = (decimal?)null,
            occupationType = "Seated",
            averageDailySteps = 7000,
            coachGoalAdjustment = 0m,
            calorieTarget = (decimal?)null,
            proteinGrams = 150m,
            fatPercentage = 25m,
            isEnergyDeficit = false,
        });
        await AssertStatusAsync(calculationResponse, HttpStatusCode.OK);
        var calculation = await RequiredJsonAsync<Phase4Calculation>(calculationResponse);
        var scenario = new Phase4Scenario(food.Id, food.CurrentVersion.Id, recipe.Id, recipe.VersionId, plan.Id, plan.VersionId, enrollment.Id, calculation.Id);
        if (assign)
        {
            await RefreshCsrfAsync(coach);
            await AssertStatusAsync(await coach.PostAsJsonAsync($"/api/nutrition/clients/{clientId}/plans", AssignmentRequest(scenario, milkAllergen)), HttpStatusCode.OK);
        }

        return scenario;
    }

    private static object AssignmentRequest(Phase4Scenario scenario, bool acknowledge) => new
    {
        mealPlanTemplateVersionId = scenario.MealPlanVersionId,
        enrollmentId = scenario.EnrollmentId,
        calculationSnapshotId = scenario.CalculationId,
        startDate = "2026-08-22",
        acknowledgeAllergenWarnings = acknowledge,
    };

    private static object FoodVersion(decimal protein, string[] allergens) => new
    {
        basisQuantity = 100m,
        basisUnit = "Gram",
        preparationBasis = "Prepared",
        proteinGrams = protein,
        carbohydrateGrams = 30m,
        fatGrams = 10m,
        fibreGrams = 5m,
        polyolGrams = 0m,
        ethanolGrams = 0m,
        providerCalories = (decimal?)null,
        sourceAttribution = "Coach authored test record",
        sourceRecordVersion = "test-v1",
        declaredAllergens = allergens,
    };

    private static async Task<Enrollment> CreateFreeNutritionEnrollmentAsync(HttpClient coach, Guid clientId, int durationDays)
    {
        await RefreshCsrfAsync(coach);
        var productResponse = await coach.PostAsJsonAsync("/api/commercial/products", new
        {
            name = $"Nutrition {Guid.NewGuid():N}",
            description = "Phase 4 nutrition test",
            initialOffer = new
            {
                label = $"{durationDays} days",
                durationCount = durationDays,
                durationUnit = "Day",
                priceAmount = 0m,
                priceCurrency = "USD",
                features = new[] { new { feature = "Nutrition", allowsConcurrentCoverage = false } },
            },
        });
        await AssertStatusAsync(productResponse, HttpStatusCode.OK);
        var product = await RequiredJsonAsync<Product>(productResponse);
        await RefreshCsrfAsync(coach);
        var enrollmentResponse = await coach.PostAsJsonAsync($"/api/commercial/clients/{clientId}/enrollments", new
        {
            offerId = product.Offers[0].Id,
            startDate = "2026-08-22",
            idempotencyKey = Guid.NewGuid(),
        });
        await AssertStatusAsync(enrollmentResponse, HttpStatusCode.OK);
        return await RequiredJsonAsync<Enrollment>(enrollmentResponse);
    }

    private SensitiveLogCapture RequiredSensitiveLogCapture =>
        sensitiveLogCapture ?? throw new InvalidOperationException("Log capture is not initialized.");

    private sealed record Phase4Scenario(Guid FoodId, Guid FoodVersionId, Guid RecipeId, Guid RecipeVersionId, Guid MealPlanId, Guid MealPlanVersionId, Guid EnrollmentId, Guid CalculationId);
    private sealed record Phase4Food(Guid Id, Phase4FoodVersion CurrentVersion);
    private sealed record Phase4FoodVersion(Guid Id);
    private sealed record Phase4Recipe(Guid Id, Guid VersionId);
    private sealed record Phase4MealPlan(Guid Id, Guid VersionId);
    private sealed record Phase4Calculation(Guid Id);
    private sealed record Phase4Day(Guid PlanId, Guid PlanDayId, Guid? DailyLogId, uint? DailyLogVersion, string? LogStatus, decimal SelectedCalories, Phase4Slot[] Slots);
    private sealed record Phase4Slot(Guid Id, Phase4Choice[] Choices);
    private sealed record Phase4Choice(Guid Id, decimal Calories);
    private sealed record Phase4PlanSummary(Guid Id, DateOnly StartDate, DateOnly EndDateExclusive, string Status, uint Version);
    private sealed record Phase4ImportedFood(Guid Id, Phase4ImportedFoodVersion CurrentVersion);
    private sealed record Phase4ImportedFoodVersion(Guid Id, decimal ComputedCalories);
    private sealed record Phase4Settings(string EnergyPolicyKey, decimal ProviderCalorieTolerance, uint Version);
    private sealed record Phase4ClientDetails(string FirstName, string LastName, string? PhoneNumber, DateOnly? BirthDate, decimal? HeightEnteredValue, string? HeightEnteredUnit, string? WorkType, int? AverageDailySteps, string? TrainingBackground, string? FoodPreferences, string? FoodAversions, string? Goals, string? PreviousInjuries, uint Version);
}

internal sealed class InvalidSchemaAiMealDraftProvider : IAiMealDraftProvider
{
    public string ProviderKey => "DeterministicTestProvider";

    public Task<AiMealDraftProviderResult> GenerateAsync(AiMealDraftProviderRequest request, CancellationToken cancellationToken) =>
        Task.FromResult(new AiMealDraftProviderResult(true, "test-model", "v1", "{\"unexpected\":true}", 0.25m, "USD"));
}

internal sealed class FibreRichTestNutritionDataProvider : INutritionDataProvider
{
    // USDA FDC 172420, lentils (mature seeds, cooked, boiled) per 100 g. CarbohydrateGrams is
    // "Carbohydrate, by difference", which includes the declared dietary fibre.
    public const string LentilFdcId = "172420";

    public string ProviderKey => "UsdaFoodDataCentral";

    public Task<IReadOnlyList<FoodSearchResult>> SearchAsync(string query, int skip, int take, CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<FoodSearchResult>>(
            [new FoodSearchResult(LentilFdcId, "Lentils, mature seeds, cooked, boiled", "SR Legacy", ProviderKey)]);

    public Task<ProviderFoodRecord?> GetFoodAsync(string externalId, CancellationToken cancellationToken) =>
        Task.FromResult<ProviderFoodRecord?>(externalId == LentilFdcId
            ? new ProviderFoodRecord(
                LentilFdcId,
                "Lentils, mature seeds, cooked, boiled",
                "SR Legacy",
                100m,
                PreparationBasis.Cooked,
                116m,
                9.02m,
                20.13m,
                0.38m,
                7.9m,
                0m,
                0m,
                [],
                ProviderKey,
                new DateTimeOffset(2026, 8, 22, 10, 0, 0, TimeSpan.Zero))
            : null);
}

internal sealed class SensitiveLogCapture : ILoggerProvider
{
    private readonly ConcurrentQueue<string> messages = new();

    public string Text => string.Join(Environment.NewLine, messages);

    public ILogger CreateLogger(string categoryName) => new CapturingLogger(messages);

    public void Dispose()
    {
    }

    private sealed class CapturingLogger(ConcurrentQueue<string> messages) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
            messages.Enqueue(formatter(state, exception));
    }
}
