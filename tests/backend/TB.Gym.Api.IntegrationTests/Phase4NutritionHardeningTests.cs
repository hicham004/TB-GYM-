using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Npgsql;
using TB.Gym.Modules.Nutrition;

namespace TB.Gym.Api.IntegrationTests;

public sealed partial class Phase3TrainingWorkflowTests
{
    private static readonly string[] MilkAllergen = ["Milk"];
    private static readonly string[] NoAllergens = [];
    private static readonly string[] ChickenUnreportedNutrients = ["Fibre", "Polyols", "Ethanol"];

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
        // Another workspace's client is not in this one: 404, as an id that exists nowhere (SEC-8).
        Assert.AreEqual(HttpStatusCode.NotFound, (await foreignCoach.GetAsync($"/api/nutrition/clients/{assignedClientId}/plans")).StatusCode);
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
    public async Task Phase4RealUsdaProviderImportsUnreportedNutrientsAsNamedZeros()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "p4-usda-real-coach@example.test", "Nutrition Coach", "Nutrition Usda Real");

        await RefreshCsrfAsync(coach);
        var imported = await coach.PostAsJsonAsync("/api/nutrition/providers/usda/import", new
        {
            fdcId = UsdaFoodDataCentralFake.ChickenFdcId,
        });
        await AssertStatusAsync(imported, HttpStatusCode.OK);

        // USDA reports protein, fat and carbohydrate for this food but not fibre, polyols or ethanol.
        // Each is stored as zero and named, so a coach can tell USDA's silence from a stated zero.
        var version = (await RequiredJsonAsync<Phase4UsdaFood>(imported)).CurrentVersion;
        Assert.AreEqual(22.525m, version.ProteinGrams);
        Assert.AreEqual(1.934m, version.FatGrams);
        Assert.AreEqual(0m, version.FibreGrams);
        Assert.AreEqual(0m, version.PolyolGrams);
        Assert.AreEqual(0m, version.EthanolGrams);
        CollectionAssert.AreEqual(ChickenUnreportedNutrients, version.UnreportedNutrients);
        // Atwater, the workspace default: 22.525 * 4 + 0 * 4 + 1.934 * 9.
        Assert.AreEqual(107.506m, version.ComputedCalories);

        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT \"UnreportedNutrients\" FROM nutrition.\"FoodItemVersions\" WHERE \"Id\" = @id";
        command.Parameters.AddWithValue("id", version.Id);
        CollectionAssert.AreEqual(ChickenUnreportedNutrients, (string[])(await command.ExecuteScalarAsync())!);
    }

    [TestMethod]
    public async Task Phase4RealUsdaProviderRefusesFoodWithoutProteinAndSaysWhy()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "p4-usda-noprotein-coach@example.test", "Nutrition Coach", "Nutrition Usda Protein");

        await RefreshCsrfAsync(coach);
        var refused = await coach.PostAsJsonAsync("/api/nutrition/providers/usda/import", new
        {
            fdcId = UsdaFoodDataCentralFake.NoProteinFdcId,
        });

        Assert.AreEqual(HttpStatusCode.ServiceUnavailable, refused.StatusCode);
        var problem = await RequiredJsonAsync<Phase4ProviderProblem>(refused);
        Assert.AreEqual("usda_nutrient_incomplete", problem.Code);
        Assert.Contains("did not report Protein", problem.Message);
        var foods = await coach.GetFromJsonAsync<Phase4FoodPage>("/api/nutrition/foods")
            ?? throw new AssertFailedException("Food page was empty.");
        Assert.AreEqual(0, foods.Total);
    }

    [TestMethod]
    public async Task Phase4DatabaseRefusesAnUnreportedNutrientThatCarriesAValue()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "p4-usda-constraint-coach@example.test", "Nutrition Coach", "Nutrition Usda Constraint");
        await RefreshCsrfAsync(coach);
        var imported = await coach.PostAsJsonAsync("/api/nutrition/providers/usda/import", new
        {
            fdcId = FibreRichTestNutritionDataProvider.LentilFdcId,
        });
        await AssertStatusAsync(imported, HttpStatusCode.OK);
        var lentils = await RequiredJsonAsync<Phase4ImportedFood>(imported);

        // A copy of the lentil version, which reports 7.9 g of fibre, claiming fibre was unreported.
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            CREATE TEMP TABLE forged AS SELECT * FROM nutrition."FoodItemVersions" WHERE "Id" = @id;
            UPDATE forged SET "Id" = gen_random_uuid(), "Revision" = "Revision" + 1, "UnreportedNutrients" = ARRAY['Fibre'];
            INSERT INTO nutrition."FoodItemVersions" SELECT * FROM forged;
            """;
        command.Parameters.AddWithValue("id", lentils.CurrentVersion.Id);

        var rejected = await Assert.ThrowsAsync<PostgresException>(async () => await command.ExecuteNonQueryAsync());
        Assert.AreEqual(PostgresErrorCodes.CheckViolation, rejected.SqlState);
        Assert.AreEqual("CK_FoodItemVersions_UnreportedNutrients", rejected.ConstraintName);
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

    private static async Task<Enrollment> CreateFreeNutritionEnrollmentAsync(HttpClient coach, Guid clientId, int durationDays, string startDate = "2026-08-22")
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
            startDate,
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
    private sealed record Phase4Day(Guid PlanId, Guid PlanDayId, Guid? DailyLogId, uint? DailyLogVersion, string? LogStatus, decimal SelectedCalories, Phase4Slot[] Slots, Phase4CustomFood[] CustomFoods);
    private sealed record Phase4CustomFood(Guid Id, string Name, decimal Amount, string Unit, decimal Calories);
    private sealed record Phase4Slot(Guid Id, Guid? SelectedChoiceId, Phase4Choice[] Choices);
    private sealed record Phase4Choice(Guid Id, decimal Calories);
    private sealed record Phase4PlanSummary(Guid Id, DateOnly StartDate, DateOnly EndDateExclusive, string Status, uint Version);
    private sealed record Phase4ImportedFood(Guid Id, Phase4ImportedFoodVersion CurrentVersion);
    private sealed record Phase4ImportedFoodVersion(Guid Id, decimal ComputedCalories);
    private sealed record Phase4Settings(string EnergyPolicyKey, decimal ProviderCalorieTolerance, uint Version);
    private sealed record Phase4UsdaFood(Guid Id, Phase4UsdaFoodVersion CurrentVersion);
    private sealed record Phase4UsdaFoodVersion(Guid Id, decimal ProteinGrams, decimal FatGrams, decimal FibreGrams, decimal PolyolGrams, decimal EthanolGrams, decimal ComputedCalories, string[] UnreportedNutrients);
    private sealed record Phase4ProviderProblem(string Code, string Message);
    private sealed record Phase4FoodPage(int Total);
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

    public Task<IReadOnlyList<FoodSearchResult>> SearchAsync(string query, FoodSearchKind kind, int skip, int take, CancellationToken cancellationToken) =>
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

/// <summary>
/// USDA FoodData Central's socket. Responses are trimmed from real ones, so the composed provider
/// parses what USDA actually sends, including the nutrients it leaves out.
/// </summary>
internal sealed class UsdaFoodDataCentralFake : HttpMessageHandler
{
    public const string ApiKey = "test-usda-key";

    // FDC 2646170, Foundation: chicken, breast, boneless, skinless, raw. No fibre, polyol, ethanol
    // or plain "Energy" entry is reported.
    public const string ChickenFdcId = "2646170";

    public const string NoProteinFdcId = "9999001";

    // FDC 2727569, Foundation: chicken, breast, meat and skin, raw. USDA's carbohydrate by difference
    // is -0.42825 g, counted as 0 g (R4.4c); 9999002 is a record whose carbohydrate is too far below.
    public const string ChickenWithSkinFdcId = "2727569";

    public const string BrokenCarbohydrateFdcId = "9999002";

    public const string ChobaniFdcId = "2038865";

    // What a network gives instead of an answer (BEA-2, BEA-13): no connection, no answer before the
    // client's timeout, a body that is not JSON, and JSON that is not the documented shape. A search
    // meets the same through these words.
    public const string UnreachableFdcId = "9999101";
    public const string TimeoutFdcId = "9999102";
    public const string NotJsonFdcId = "9999103";
    public const string WrongShapeFdcId = "9999104";
    public const string UnreachableQuery = "usda outage";
    public const string TimeoutQuery = "usda timeout";
    public const string NotJsonQuery = "usda not json";
    public const string WrongShapeQuery = "usda wrong shape";

    private const string ChickenWithSkinJson = """
        {"fdcId":2727569,"description":"Chicken, breast, meat and skin, raw","dataType":"Foundation","foodNutrients":[
        {"type":"FoodNutrient","id":1,"nutrient":{"id":1051,"number":"255","name":"Water","rank":100,"unitName":"g"},"amount":73.2},
        {"type":"FoodNutrient","id":2,"nutrient":{"id":2047,"number":"957","name":"Energy (Atwater General Factors)","rank":280,"unitName":"kcal"},"amount":126.905},
        {"type":"FoodNutrient","id":3,"nutrient":{"id":1003,"number":"203","name":"Protein","rank":600,"unitName":"g"},"amount":21.40625},
        {"type":"FoodNutrient","id":4,"nutrient":{"id":1004,"number":"204","name":"Total lipid (fat)","rank":800,"unitName":"g"},"amount":4.777},
        {"type":"FoodNutrient","id":5,"nutrient":{"id":1005,"number":"205","name":"Carbohydrate, by difference","rank":1110,"unitName":"g"},"amount":-0.42825}]}
        """;

    private const string BrokenCarbohydrateJson = """
        {"fdcId":9999002,"description":"Record that does not add up","dataType":"SR Legacy","foodNutrients":[
        {"type":"FoodNutrient","id":1,"nutrient":{"id":1003,"number":"203","name":"Protein","rank":600,"unitName":"g"},"amount":30},
        {"type":"FoodNutrient","id":2,"nutrient":{"id":1004,"number":"204","name":"Total lipid (fat)","rank":800,"unitName":"g"},"amount":5},
        {"type":"FoodNutrient","id":3,"nutrient":{"id":1005,"number":"205","name":"Carbohydrate, by difference","rank":1110,"unitName":"g"},"amount":-0.8}]}
        """;

    private const string ChobaniJson = """
        {"fdcId":2038865,"description":"GREEK YOGURT","dataType":"Branded","brandOwner":"Chobani, Inc.","brandName":"CHOBANI","foodNutrients":[
        {"type":"FoodNutrient","id":1,"nutrient":{"id":1003,"number":"203","name":"Protein","rank":600,"unitName":"g"},"amount":8.67},
        {"type":"FoodNutrient","id":2,"nutrient":{"id":1004,"number":"204","name":"Total lipid (fat)","rank":800,"unitName":"g"},"amount":0},
        {"type":"FoodNutrient","id":3,"nutrient":{"id":1005,"number":"205","name":"Carbohydrate, by difference","rank":1110,"unitName":"g"},"amount":10.7},
        {"type":"FoodNutrient","id":4,"nutrient":{"id":1008,"number":"208","name":"Energy","rank":300,"unitName":"kcal"},"amount":80}]}
        """;

    // A basic-foods search for "chicken with skin": the four cuts' carbohydrate is just below zero in
    // USDA's own data, and one made-up record is too far below to use (R4.4c).
    private const string WithSkinSearchJson = """
        {"totalHits":2,"currentPage":1,"totalPages":1,"foods":[
        {"fdcId":2727569,"description":"Chicken, breast, meat and skin, raw","dataType":"Foundation","foodNutrients":[
        {"nutrientId":1003,"nutrientName":"Protein","nutrientNumber":"203","unitName":"G","value":21.4},
        {"nutrientId":1004,"nutrientName":"Total lipid (fat)","nutrientNumber":"204","unitName":"G","value":4.78},
        {"nutrientId":1005,"nutrientName":"Carbohydrate, by difference","nutrientNumber":"205","unitName":"G","value":-0.43},
        {"nutrientId":2047,"nutrientName":"Energy (Atwater General Factors)","nutrientNumber":"957","unitName":"KCAL","value":127}]},
        {"fdcId":9999002,"description":"Record that does not add up","dataType":"SR Legacy","foodNutrients":[
        {"nutrientId":1003,"nutrientName":"Protein","nutrientNumber":"203","unitName":"G","value":30},
        {"nutrientId":1004,"nutrientName":"Total lipid (fat)","nutrientNumber":"204","unitName":"G","value":5},
        {"nutrientId":1005,"nutrientName":"Carbohydrate, by difference","nutrientNumber":"205","unitName":"G","value":-0.8}]}]}
        """;

    private const string ChickenJson = """
        {"fdcId":2646170,"description":"Chicken, breast, boneless, skinless, raw","dataType":"Foundation","foodNutrients":[
        {"type":"FoodNutrient","id":33295225,"nutrient":{"id":1051,"number":"255","name":"Water","rank":100,"unitName":"g"},"amount":74.78},
        {"type":"FoodNutrient","id":33295327,"nutrient":{"id":2047,"number":"957","name":"Energy (Atwater General Factors)","rank":280,"unitName":"kcal"},"amount":106.034},
        {"type":"FoodNutrient","id":33295325,"nutrient":{"id":1003,"number":"203","name":"Protein","rank":600,"unitName":"g"},"amount":22.525},
        {"type":"FoodNutrient","id":33295220,"nutrient":{"id":1004,"number":"204","name":"Total lipid (fat)","rank":800,"unitName":"g"},"amount":1.934},
        {"type":"FoodNutrient","id":33295326,"nutrient":{"id":1005,"number":"205","name":"Carbohydrate, by difference","rank":1110,"unitName":"g"},"amount":0}]}
        """;

    private const string NoProteinJson = """
        {"fdcId":9999001,"description":"Incomplete record","dataType":"Branded","foodNutrients":[
        {"type":"FoodNutrient","id":1,"nutrient":{"id":1004,"number":"204","name":"Total lipid (fat)","rank":800,"unitName":"g"},"amount":1},
        {"type":"FoodNutrient","id":2,"nutrient":{"id":1005,"number":"205","name":"Carbohydrate, by difference","rank":1110,"unitName":"g"},"amount":2}]}
        """;

    // A basic-foods search, abridged as /foods/search answers: the Foundation chicken states energy
    // only under the Atwater names, and the second match has no protein (R4.4c).
    private const string BasicSearchJson = """
        {"totalHits":2,"currentPage":1,"totalPages":1,"foods":[
        {"fdcId":2646170,"description":"Chicken, breast, boneless, skinless, raw","dataType":"Foundation","foodNutrients":[
        {"nutrientId":1004,"nutrientName":"Total lipid (fat)","nutrientNumber":"204","unitName":"G","value":1.93},
        {"nutrientId":1003,"nutrientName":"Protein","nutrientNumber":"203","unitName":"G","value":22.5},
        {"nutrientId":1005,"nutrientName":"Carbohydrate, by difference","nutrientNumber":"205","unitName":"G","value":0.0},
        {"nutrientId":2047,"nutrientName":"Energy (Atwater General Factors)","nutrientNumber":"957","unitName":"KCAL","value":106},
        {"nutrientId":2048,"nutrientName":"Energy (Atwater Specific Factors)","nutrientNumber":"958","unitName":"KCAL","value":112}]},
        {"fdcId":9999001,"description":"Incomplete record","dataType":"SR Legacy","foodNutrients":[
        {"nutrientId":1004,"nutrientName":"Total lipid (fat)","nutrientNumber":"204","unitName":"G","value":1}]}]}
        """;

    // A packaged-products search: USDA's branded foods, one without a brand name.
    private const string PackagedSearchJson = """
        {"totalHits":2,"currentPage":1,"totalPages":1,"foods":[
        {"fdcId":2038865,"description":"GREEK YOGURT","dataType":"Branded","brandOwner":"Chobani, Inc.","brandName":"CHOBANI","foodNutrients":[
        {"nutrientId":1003,"nutrientName":"Protein","nutrientNumber":"203","unitName":"G","value":8.67},
        {"nutrientId":1004,"nutrientName":"Total lipid (fat)","nutrientNumber":"204","unitName":"G","value":0.0},
        {"nutrientId":1005,"nutrientName":"Carbohydrate, by difference","nutrientNumber":"205","unitName":"G","value":10.7},
        {"nutrientId":1008,"nutrientName":"Energy","nutrientNumber":"208","unitName":"KCAL","value":80.0}]},
        {"fdcId":373595,"description":"GREEK YOGURT","dataType":"Branded","brandOwner":"TRADER JOE'S","foodNutrients":[
        {"nutrientId":1003,"nutrientName":"Protein","nutrientNumber":"203","unitName":"G","value":4.85},
        {"nutrientId":1004,"nutrientName":"Total lipid (fat)","nutrientNumber":"204","unitName":"G","value":7.05},
        {"nutrientId":1005,"nutrientName":"Carbohydrate, by difference","nutrientNumber":"205","unitName":"G","value":12.3},
        {"nutrientId":1008,"nutrientName":"Energy","nutrientNumber":"208","unitName":"KCAL","value":132}]}]}
        """;

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var uri = request.RequestUri ?? throw new InvalidOperationException("USDA request had no URI.");
        if (!uri.Query.Contains($"api_key={ApiKey}", StringComparison.Ordinal))
        {
            return new HttpResponseMessage(HttpStatusCode.Forbidden);
        }

        // A search posts its criteria; which data types it asked for picks the answer (R4.4c).
        var dataTypes = string.Empty;
        var query = string.Empty;
        if (request.Method == HttpMethod.Post && request.Content is not null)
        {
            using var criteria = JsonDocument.Parse(await request.Content.ReadAsStringAsync(cancellationToken));
            dataTypes = string.Join(",", criteria.RootElement.GetProperty("dataType").EnumerateArray().Select(item => item.GetString()));
            query = criteria.RootElement.GetProperty("query").GetString() ?? string.Empty;
        }

        if (uri.AbsolutePath == "/fdc/v1/food/" + UnreachableFdcId || query == UnreachableQuery)
        {
            throw new HttpRequestException("No connection could be made (test).");
        }

        if (uri.AbsolutePath == "/fdc/v1/food/" + TimeoutFdcId || query == TimeoutQuery)
        {
            throw new TaskCanceledException("The request was canceled due to the configured HttpClient.Timeout (test).");
        }

        var body = (request.Method.Method, uri.AbsolutePath) switch
        {
            ("GET", "/fdc/v1/food/" + NotJsonFdcId) => "<html>Service Unavailable</html>",
            ("GET", "/fdc/v1/food/" + WrongShapeFdcId) => "[1, 2, 3]",
            ("POST", "/fdc/v1/foods/search") when query == NotJsonQuery => "<html>Service Unavailable</html>",
            ("POST", "/fdc/v1/foods/search") when query == WrongShapeQuery => """
                {"foods":[{"fdcId":{"nested":true},"description":"Odd","dataType":"SR Legacy","foodNutrients":[
                {"nutrientName":"Protein","unitName":"G","value":1},
                {"nutrientName":"Total lipid (fat)","unitName":"G","value":1},
                {"nutrientName":"Carbohydrate, by difference","unitName":"G","value":1}]}]}
                """,
            ("GET", "/fdc/v1/food/" + ChickenFdcId) => ChickenJson,
            ("GET", "/fdc/v1/food/" + NoProteinFdcId) => NoProteinJson,
            ("GET", "/fdc/v1/food/" + ChickenWithSkinFdcId) => ChickenWithSkinJson,
            ("GET", "/fdc/v1/food/" + BrokenCarbohydrateFdcId) => BrokenCarbohydrateJson,
            ("GET", "/fdc/v1/food/" + ChobaniFdcId) => ChobaniJson,
            ("POST", "/fdc/v1/foods/search") when dataTypes == "Branded" => PackagedSearchJson,
            ("POST", "/fdc/v1/foods/search") when query == "chicken with skin" => WithSkinSearchJson,
            ("POST", "/fdc/v1/foods/search") when dataTypes == "Foundation,SR Legacy,Survey (FNDDS)" => BasicSearchJson,
            _ => null,
        };
        return body is null
            ? new HttpResponseMessage(HttpStatusCode.NotFound)
            : new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json") };
    }
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
