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
/// Critique B5a, meal options (NUT-005): a meal's options keep the coach's order in the published
/// version and in each client's copy, so the coach's option 1 is the client's first; the database
/// holds one option to a place; a client changes a meal they logged while the day is open (the old
/// entry is replaced, where it answered 409 with EF's "severed" message); and the migration gives the
/// options already published the order they were read in before it.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string B5aChoicesUrl = "/api/nutrition/me/choices";

    private static readonly string[] B5aToastEggsOats = ["Toast", "Eggs", "Oats"];

    private static readonly string[] B5aOatsToast = ["Oats", "Toast"];

    private static readonly string[] B5aOatsToastEggs = ["Oats", "Toast", "Eggs"];

    [TestMethod]
    public async Task B5aTheCoachsOptionOrderIsWhatTheBuilderAndTheClientRead()
    {
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b5a-order-owner@example.test", "Hicham Haddad", "B5a Options");
        var (eggs, oats, toast) = await B5aRecipesAsync(owner);

        // Neither alphabetical nor the order the recipes were made in: the coach's.
        var draft = await R44aCreateAsync(owner, new(null, null, null, B5aContent([toast, eggs, oats], [oats, toast])));
        var plan = await R44aPublishAsync(owner, draft.Id, draft.Version, replaceNewer: false);
        var version = await ReadSliceAsync<MealPlanVersionView>(owner, R44aVersionUrl(plan.VersionId));
        CollectionAssert.AreEqual(B5aToastEggsOats, B5aNames(version.Slots[0]));
        CollectionAssert.AreEqual(B5aOatsToast, B5aNames(version.Slots[1]));
        CollectionAssert.AreEqual(
            new[] { (0, "Toast"), (1, "Eggs"), (2, "Oats") },
            await B5aStoredOrderAsync("MealPlanChoices", "MealPlanSlotId", "\"MealPlanSlots\" slot ON slot.\"Id\" = choice.\"MealPlanSlotId\" WHERE slot.\"MealPlanTemplateVersionId\" = @owner AND slot.\"Order\" = 0", plan.VersionId));

        using var maya = CreateClient();
        var mayaId = await InviteAndAcceptAsync(owner, maya, "b5a-order-maya@example.test", true);
        SetTenant(maya, tenant);
        var (clientPlanId, start) = await B5aAssignAsync(owner, mayaId, plan.VersionId);
        var day = await ReadSliceAsync<ClientNutritionDayView>(maya, R44dDayUrl(start));
        CollectionAssert.AreEqual(B5aToastEggsOats, day.Slots[0].Choices.Select(choice => choice.RecipeName).ToArray());
        CollectionAssert.AreEqual(B5aOatsToast, day.Slots[1].Choices.Select(choice => choice.RecipeName).ToArray());

        // The coach makes Oats option 1 in a new version; the plan Maya has keeps the order it was given.
        var reordered = await R44aCreateAsync(owner, new(plan.Id, plan.VersionId, 1, B5aContent([oats, toast, eggs], [oats, toast])));
        var next = await R44aPublishAsync(owner, reordered.Id, reordered.Version, replaceNewer: false);
        CollectionAssert.AreEqual(
            B5aOatsToastEggs,
            B5aNames((await ReadSliceAsync<MealPlanVersionView>(owner, R44aVersionUrl(next.VersionId))).Slots[0]));
        var unchanged = await ReadSliceAsync<ClientNutritionDayView>(maya, R44dDayUrl(start));
        CollectionAssert.AreEqual(B5aToastEggsOats, unchanged.Slots[0].Choices.Select(choice => choice.RecipeName).ToArray());
        CollectionAssert.AreEqual(
            new[] { (0, "Toast"), (1, "Eggs"), (2, "Oats") },
            await B5aStoredOrderAsync("ClientNutritionPlanChoices", "ClientNutritionPlanSlotId", "\"ClientNutritionPlanSlots\" slot ON slot.\"Id\" = choice.\"ClientNutritionPlanSlotId\" JOIN nutrition.\"ClientNutritionPlanDays\" planDay ON planDay.\"Id\" = slot.\"ClientNutritionPlanDayId\" WHERE planDay.\"ClientNutritionPlanId\" = @owner AND slot.\"Order\" = 0", clientPlanId));
    }

    [TestMethod]
    public async Task B5aTheDatabaseHoldsOneOptionToAPlace()
    {
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b5a-guard-owner@example.test", "Hicham Haddad", "B5a Guards");
        var (eggs, oats, toast) = await B5aRecipesAsync(owner);
        var draft = await R44aCreateAsync(owner, new(null, null, null, B5aContent([eggs, oats, toast], [toast])));
        var plan = await R44aPublishAsync(owner, draft.Id, draft.Version, replaceNewer: false);
        using var maya = CreateClient();
        var mayaId = await InviteAndAcceptAsync(owner, maya, "b5a-guard-maya@example.test", true);
        SetTenant(maya, tenant);
        var (clientPlanId, _) = await B5aAssignAsync(owner, mayaId, plan.VersionId);

        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        var publishedChoice = await B5aFirstChoiceAsync(connection, """
            SELECT choice."Id" FROM nutrition."MealPlanChoices" choice
            JOIN nutrition."MealPlanSlots" slot ON slot."Id" = choice."MealPlanSlotId"
            WHERE slot."MealPlanTemplateVersionId" = @owner AND choice."Order" = 0 AND slot."Order" = 0
            """, plan.VersionId);
        var clientChoice = await B5aFirstChoiceAsync(connection, """
            SELECT choice."Id" FROM nutrition."ClientNutritionPlanChoices" choice
            JOIN nutrition."ClientNutritionPlanSlots" slot ON slot."Id" = choice."ClientNutritionPlanSlotId"
            JOIN nutrition."ClientNutritionPlanDays" planDay ON planDay."Id" = slot."ClientNutritionPlanDayId"
            WHERE planDay."ClientNutritionPlanId" = @owner AND choice."Order" = 0 AND slot."Order" = 0
            """, clientPlanId);

        // A second option at a place a meal already fills, or a place before the first, is refused.
        var copyPublished = """
            INSERT INTO nutrition."MealPlanChoices"
                ("Id", "TenantId", "MealPlanSlotId", "Order", "RecipeVersionId", "RecipeName", "Servings", "Calories", "ProteinGrams", "CarbohydrateGrams", "FatGrams")
            SELECT gen_random_uuid(), "TenantId", "MealPlanSlotId", PLACE, "RecipeVersionId", "RecipeName", "Servings", "Calories", "ProteinGrams", "CarbohydrateGrams", "FatGrams"
            FROM nutrition."MealPlanChoices" WHERE "Id" = @id
            """;
        await A6AssertSqlRefusedAsync(connection, copyPublished.Replace("PLACE", "2"), publishedChoice, PostgresErrorCodes.UniqueViolation);
        await A6AssertSqlRefusedAsync(connection, copyPublished.Replace("PLACE", "-1"), publishedChoice, PostgresErrorCodes.CheckViolation);
        var copyClient = """
            INSERT INTO nutrition."ClientNutritionPlanChoices"
                ("Id", "TenantId", "ClientNutritionPlanSlotId", "Order", "SourceRecipeVersionId", "RecipeName", "Servings", "Calories", "ProteinGrams", "CarbohydrateGrams", "FatGrams")
            SELECT gen_random_uuid(), "TenantId", "ClientNutritionPlanSlotId", PLACE, "SourceRecipeVersionId", "RecipeName", "Servings", "Calories", "ProteinGrams", "CarbohydrateGrams", "FatGrams"
            FROM nutrition."ClientNutritionPlanChoices" WHERE "Id" = @id
            """;
        await A6AssertSqlRefusedAsync(connection, copyClient.Replace("PLACE", "1"), clientChoice, PostgresErrorCodes.UniqueViolation);
        await A6AssertSqlRefusedAsync(connection, copyClient.Replace("PLACE", "-1"), clientChoice, PostgresErrorCodes.CheckViolation);

        // And a published option or a client's copy never moves: their guards still hold.
        await A6AssertSqlRefusedAsync(connection, "UPDATE nutrition.\"MealPlanChoices\" SET \"Order\" = 7 WHERE \"Id\" = @id", publishedChoice, PostgresErrorCodes.CheckViolation);
        await A6AssertSqlRefusedAsync(connection, "UPDATE nutrition.\"ClientNutritionPlanChoices\" SET \"Order\" = 7 WHERE \"Id\" = @id", clientChoice, PostgresErrorCodes.CheckViolation);
    }

    [TestMethod]
    public async Task B5aAClientChangesAMealTheyLoggedWhileTheDayIsOpen()
    {
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b5a-log-owner@example.test", "Hicham Haddad", "B5a Logging");
        var (eggs, oats, toast) = await B5aRecipesAsync(owner);
        var draft = await R44aCreateAsync(owner, new(null, null, null, B5aContent([eggs, oats], [toast])));
        var plan = await R44aPublishAsync(owner, draft.Id, draft.Version, replaceNewer: false);
        using var maya = CreateClient();
        var mayaId = await InviteAndAcceptAsync(owner, maya, "b5a-log-maya@example.test", true);
        SetTenant(maya, tenant);
        var (_, start) = await B5aAssignAsync(owner, mayaId, plan.VersionId);
        var day = await ReadSliceAsync<ClientNutritionDayView>(maya, R44dDayUrl(start));
        var breakfast = day.Slots[0];
        var (first, second) = (breakfast.Choices[0], breakfast.Choices[1]);

        // "I ate this" on option 1, then the client says it was option 2, one and a half servings of it.
        var logged = await B5aRecordAsync(maya, day.PlanDayId, breakfast.Id, first.Id, first.Servings, null);
        Assert.AreEqual((Guid?)first.Id, logged.Slots[0].SelectedChoiceId);
        var changed = await B5aRecordAsync(maya, day.PlanDayId, breakfast.Id, second.Id, 1.5m, logged.DailyLogVersion);
        Assert.AreEqual(((Guid?)second.Id, (decimal?)1.5m), (changed.Slots[0].SelectedChoiceId, changed.Slots[0].ActualServings));
        Assert.AreEqual(second.Calories * 1.5m, changed.Slots[0].LoggedCalories);
        Assert.AreEqual(second.Calories * 1.5m, changed.SelectedCalories);

        // "Change servings" on the same option logs it again; the day keeps one entry for the meal.
        var servings = await B5aRecordAsync(maya, day.PlanDayId, breakfast.Id, second.Id, 2m, changed.DailyLogVersion);
        Assert.AreEqual(second.Calories * 2m, servings.SelectedCalories);
        Assert.AreEqual(1L, await A6ScalarAsync($"SELECT count(*) FROM nutrition.\"DailyNutritionLogEntries\" WHERE \"ClientNutritionPlanSlotId\" = '{breakfast.Id}'"));
        var read = await ReadSliceAsync<ClientNutritionDayView>(maya, R44dDayUrl(start));
        Assert.AreEqual(((Guid?)second.Id, (decimal?)2m), (read.Slots[0].SelectedChoiceId, read.Slots[0].ActualServings));

        // A tab still holding an older read is told to refresh, and changes nothing.
        var stale = await B5aPutAsync(maya, new(day.PlanDayId, breakfast.Id, first.Id, 1m, changed.DailyLogVersion));
        await AssertStatusAsync(stale, HttpStatusCode.Conflict);
        Assert.AreEqual((Guid?)second.Id, (await ReadSliceAsync<ClientNutritionDayView>(maya, R44dDayUrl(start))).Slots[0].SelectedChoiceId);

        // A completed day is kept as it was.
        await RefreshCsrfAsync(maya);
        await AssertStatusAsync(await maya.PostAsJsonAsync($"/api/nutrition/me/logs/{servings.DailyLogId}/complete", new CompleteNutritionLogRequest(servings.DailyLogVersion!.Value)), HttpStatusCode.OK);
        var completed = await ReadSliceAsync<ClientNutritionDayView>(maya, R44dDayUrl(start));
        var refused = await B5aPutAsync(maya, new(day.PlanDayId, breakfast.Id, first.Id, 1m, completed.DailyLogVersion));
        await AssertStatusAsync(refused, HttpStatusCode.Conflict);
        Assert.AreEqual((Guid?)second.Id, (await ReadSliceAsync<ClientNutritionDayView>(maya, R44dDayUrl(start))).Slots[0].SelectedChoiceId);
    }

    [TestMethod]
    public async Task B5aTheMigrationOrdersPublishedOptionsAsTheyWereReadBeforeIt()
    {
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b5a-migration-owner@example.test", "Hicham Haddad", "B5a Migration");
        var (eggs, oats, toast) = await B5aRecipesAsync(owner);
        var draft = await R44aCreateAsync(owner, new(null, null, null, B5aContent([eggs, oats, toast], [oats, toast])));
        var plan = await R44aPublishAsync(owner, draft.Id, draft.Version, replaceNewer: false);
        using var maya = CreateClient();
        var mayaId = await InviteAndAcceptAsync(owner, maya, "b5a-migration-maya@example.test", true);
        SetTenant(maya, tenant);
        var (clientPlanId, start) = await B5aAssignAsync(owner, mayaId, plan.VersionId);

        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var migrations = context.Database.GetMigrations().ToArray();
        var migration = migrations.Single(item => item.EndsWith("_MealOptionOrder", StringComparison.Ordinal));
        var previous = migrations[Array.IndexOf(migrations, migration) - 1];
        var migrator = context.Database.GetInfrastructure().GetRequiredService<IMigrator>();

        // Before it, options had no order: they were read in the order their rows are stored.
        await migrator.MigrateAsync(previous);
        Assert.AreEqual(0L, await A6ScalarAsync("SELECT count(*) FROM information_schema.columns WHERE table_schema = 'nutrition' AND table_name IN ('MealPlanChoices', 'ClientNutritionPlanChoices') AND column_name = 'Order'"));
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        const string publishedOptions = """
            SELECT choice."MealPlanSlotId", choice."Id" FROM nutrition."MealPlanChoices" choice
            JOIN nutrition."MealPlanSlots" slot ON slot."Id" = choice."MealPlanSlotId"
            WHERE slot."MealPlanTemplateVersionId" = @owner ORDER BY slot."Order", SORT
            """;
        const string clientOptions = """
            SELECT choice."ClientNutritionPlanSlotId", choice."Id" FROM nutrition."ClientNutritionPlanChoices" choice
            JOIN nutrition."ClientNutritionPlanSlots" slot ON slot."Id" = choice."ClientNutritionPlanSlotId"
            JOIN nutrition."ClientNutritionPlanDays" planDay ON planDay."Id" = slot."ClientNutritionPlanDayId"
            WHERE planDay."ClientNutritionPlanId" = @owner ORDER BY slot."Order", SORT
            """;

        // Each three-option meal's first row by id is stored again, so it is read last: the order kept
        // must be the order the rows are read in, never their ids'.
        await B5aMoveFirstByIdAsync(connection, "MealPlanChoices", "TR_MealPlanChoices_PublishedImmutable", publishedOptions, plan.VersionId);
        await B5aMoveFirstByIdAsync(connection, "ClientNutritionPlanChoices", "TR_ClientNutritionPlanChoices_Immutable", clientOptions, clientPlanId);
        var publishedBefore = await B5aRowsAsync(connection, publishedOptions.Replace("SORT", "choice.ctid"), plan.VersionId);
        var clientBefore = await B5aRowsAsync(connection, clientOptions.Replace("SORT", "choice.ctid"), clientPlanId);
        CollectionAssert.AreNotEqual(publishedBefore, await B5aRowsAsync(connection, publishedOptions.Replace("SORT", "choice.\"Id\""), plan.VersionId));

        await migrator.MigrateAsync(migration);
        CollectionAssert.AreEqual(publishedBefore, await B5aRowsAsync(connection, publishedOptions.Replace("SORT", "choice.\"Order\""), plan.VersionId));
        CollectionAssert.AreEqual(clientBefore, await B5aRowsAsync(connection, clientOptions.Replace("SORT", "choice.\"Order\""), clientPlanId));
        Assert.AreEqual(0L, await A6ScalarAsync($"""
            SELECT count(*) FROM (
                SELECT "MealPlanSlotId", array_agg("Order" ORDER BY "Order") AS places, count(*) AS options
                FROM nutrition."MealPlanChoices" GROUP BY "MealPlanSlotId") meal
            WHERE meal.places <> ARRAY(SELECT generate_series(0, meal.options::int - 1))
            """), "Every meal's options are numbered 0, 1, 2 … with no gap.");

        // The guards are back, and a new option must name its place.
        Assert.AreEqual(2L, await A6ScalarAsync("""
            SELECT count(*) FROM pg_trigger
            WHERE tgname IN ('TR_MealPlanChoices_PublishedImmutable', 'TR_ClientNutritionPlanChoices_Immutable') AND tgenabled = 'O'
            """));
        Assert.AreEqual(0L, await A6ScalarAsync("SELECT count(*) FROM information_schema.columns WHERE table_schema = 'nutrition' AND table_name IN ('MealPlanChoices', 'ClientNutritionPlanChoices') AND column_name = 'Order' AND column_default IS NOT NULL"));
        await A6AssertSqlRefusedAsync(connection, "UPDATE nutrition.\"MealPlanChoices\" SET \"Order\" = \"Order\" + 10 WHERE \"Id\" = @id", publishedBefore[0].Option, PostgresErrorCodes.CheckViolation);
        await A6AssertSqlRefusedAsync(connection, "UPDATE nutrition.\"ClientNutritionPlanChoices\" SET \"Order\" = \"Order\" + 10 WHERE \"Id\" = @id", clientBefore[0].Option, PostgresErrorCodes.CheckViolation);

        // The client reads their meal in that order, and the coach's builder the plan in it, once every
        // later migration is back as the app has them.
        await migrator.MigrateAsync();
        var day = await ReadSliceAsync<ClientNutritionDayView>(maya, R44dDayUrl(start));
        CollectionAssert.AreEqual(clientBefore.Take(3).Select(row => row.Option).ToArray(), day.Slots[0].Choices.Select(choice => choice.Id).ToArray());
        var version = await ReadSliceAsync<MealPlanVersionView>(owner, R44aVersionUrl(plan.VersionId));
        Assert.HasCount(3, version.Slots[0].Choices);
    }

    private static MealPlanDraftContent B5aContent(R44aRecipe[] breakfast, R44aRecipe[] lunch) =>
        new(
            $"Options {Guid.NewGuid():N}",
            2000m,
            140m,
            220m,
            60m,
            [
                new MealPlanDraftDay(
                [
                    new MealPlanDraftMeal("Breakfast", breakfast.Select(recipe => new MealPlanChoiceRequest(recipe.VersionId, 1m)).ToArray()),
                    new MealPlanDraftMeal("Lunch", lunch.Select(recipe => new MealPlanChoiceRequest(recipe.VersionId, 1m)).ToArray()),
                ]),
            ]);

    private static async Task<(R44aRecipe Eggs, R44aRecipe Oats, R44aRecipe Toast)> B5aRecipesAsync(HttpClient coach) =>
        (await R44aRecipeAsync(coach, "Eggs", 25m), await R44aRecipeAsync(coach, "Oats", 15m), await R44aRecipeAsync(coach, "Toast", 9m));

    private static string[] B5aNames(MealPlanVersionSlotView slot) => slot.Choices.Select(choice => choice.RecipeName).ToArray();

    /// <summary>Assigns the published version to the client from the workspace's today, inside a free two-week nutrition plan.</summary>
    private static async Task<(Guid PlanId, DateOnly Start)> B5aAssignAsync(HttpClient coach, Guid clientId, Guid versionId)
    {
        var start = TenantToday();
        var startText = start.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var enrollment = await CreateFreeNutritionEnrollmentAsync(coach, clientId, 14, startText);
        await RefreshCsrfAsync(coach);
        var calculationResponse = await coach.PostAsJsonAsync($"/api/nutrition/clients/{clientId}/calculations", new
        {
            bmrMethodKey = "MifflinStJeor",
            weightKilograms = 70m,
            heightCentimeters = 168m,
            ageYears = 29,
            sex = "Female",
            bodyFatPercentage = (decimal?)null,
            occupationType = "Seated",
            averageDailySteps = 8000,
            coachGoalAdjustment = 0m,
            calorieTarget = (decimal?)null,
            proteinGrams = 120m,
            fatPercentage = 25m,
            isEnergyDeficit = false,
        });
        await AssertStatusAsync(calculationResponse, HttpStatusCode.OK);
        var calculation = await RequiredJsonAsync<Phase4Calculation>(calculationResponse);
        await RefreshCsrfAsync(coach);
        var assigned = await coach.PostAsJsonAsync($"/api/nutrition/clients/{clientId}/plans", new
        {
            mealPlanTemplateVersionId = versionId,
            enrollmentId = enrollment.Id,
            calculationSnapshotId = calculation.Id,
            startDate = startText,
            acknowledgeAllergenWarnings = false,
        });
        await AssertStatusAsync(assigned, HttpStatusCode.OK);
        return ((await ReadSlicePayloadAsync<ClientNutritionPlanSummary>(assigned)).Id, start);
    }

    private async Task<HttpResponseMessage> B5aPutAsync(HttpClient client, RecordNutritionChoiceRequest request)
    {
        // A real clock moves between two saves, so each one gives the day's log a new version; the
        // test clock stands still unless it is moved.
        RequiredTestClock.Advance(TimeSpan.FromSeconds(1));
        await RefreshCsrfAsync(client);
        return await client.PutAsJsonAsync(B5aChoicesUrl, request);
    }

    private async Task<ClientNutritionDayView> B5aRecordAsync(HttpClient client, Guid planDayId, Guid slotId, Guid choiceId, decimal servings, uint? logVersion)
    {
        var response = await B5aPutAsync(client, new(planDayId, slotId, choiceId, servings, logVersion));
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<ClientNutritionDayView>(response);
    }

    /// <summary>The meal's options as stored, by place: (place, recipe name).</summary>
    private async Task<(int Place, string Name)[]> B5aStoredOrderAsync(string table, string slotColumn, string join, Guid owner)
    {
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = $"SELECT choice.\"Order\", choice.\"RecipeName\" FROM nutrition.\"{table}\" choice JOIN nutrition.{join} ORDER BY choice.\"{slotColumn}\", choice.\"Order\"";
        command.Parameters.AddWithValue("owner", owner);
        var rows = new List<(int, string)>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add((reader.GetInt32(0), reader.GetString(1)));
        }

        return [.. rows];
    }

    private static async Task<Guid> B5aFirstChoiceAsync(NpgsqlConnection connection, string sql, Guid owner)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.Parameters.AddWithValue("owner", owner);
        return (Guid)(await command.ExecuteScalarAsync() ?? throw new AssertFailedException("No option found."));
    }

    private static async Task<(Guid Meal, Guid Option)[]> B5aRowsAsync(NpgsqlConnection connection, string sql, Guid owner)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.Parameters.AddWithValue("owner", owner);
        var rows = new List<(Guid, Guid)>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add((reader.GetGuid(0), reader.GetGuid(1)));
        }

        return [.. rows];
    }

    /// <summary>
    /// Stores the first row by id of each meal with three options again, as an update does, so the
    /// database reads it last, the way rows came back in no particular order before the migration.
    /// </summary>
    private static async Task B5aMoveFirstByIdAsync(NpgsqlConnection connection, string table, string guard, string options, Guid owner)
    {
        var rows = await B5aRowsAsync(connection, options.Replace("SORT", "choice.\"Id\""), owner);
        var firsts = rows.GroupBy(row => row.Meal).Where(meal => meal.Count() == 3).Select(meal => meal.First().Option).ToArray();
        Assert.HasCount(1, firsts);
        await using var transaction = await connection.BeginTransactionAsync();
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = $"""
            ALTER TABLE nutrition."{table}" DISABLE TRIGGER "{guard}";
            UPDATE nutrition."{table}" SET "RecipeName" = "RecipeName" WHERE "Id" = @id;
            ALTER TABLE nutrition."{table}" ENABLE TRIGGER "{guard}";
            """;
        command.Parameters.AddWithValue("id", firsts[0]);
        await command.ExecuteNonQueryAsync();
        await transaction.CommitAsync();
    }
}
