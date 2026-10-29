using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using Npgsql;
using TB.Gym.Modules.Nutrition;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Critique B5c2: the meal-plan builder's daily target and the Recipes page's filter. "Fill in fat and
/// carbs" is the server's macro split (NUT-008), unrounded, with its warnings, and a plan published with
/// it names the share its fat and carbohydrate came from, which the database keeps whole. "Start from a
/// client's targets" lists the caller's current clients whose Nutrition is open (ADR 0026), each with
/// their latest targets. The Recipes page filters published recipes and drafts on the server, and
/// Publish refuses a day with no meals in the builder's words.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string B5c2SplitUrl = "/api/nutrition/macro-split";

    private const string B5c2ClientTargetsUrl = "/api/nutrition/client-targets";

    private const string B5c2RecipesUrl = "/api/nutrition/recipes";

    [TestMethod]
    public async Task B5c2FillInFatAndCarbsIsTheServersSplitAndAPublishedPlanNamesItsShare()
    {
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b5c2-split-owner@example.test", "Hicham Haddad", "B5c2 Split");

        // Fat takes its share of the calories and carbs what protein and fat leave, unrounded and named.
        var split = await ReadSliceAsync<MacroSplitView>(owner, B5c2Split(2_000m, 150m, 25m));
        Assert.AreEqual(
            (2_000m, 150m, 25m, 225m, MacroTargetCalculator.Key, MacroTargetCalculator.CurrentVersion),
            (split.CalorieTarget, split.ProteinGrams, split.FatPercentage, split.CarbohydrateGrams, split.MethodKey, split.MethodVersion));
        Assert.AreEqual(55.555555555555555555555555556m, split.FatGrams);
        Assert.IsEmpty(split.Warnings);

        // Under 20 % fat, and with a weight under half a gram a kilogram, it warns and still answers.
        var low = await ReadSliceAsync<MacroSplitView>(owner, B5c2Split(2_000m, 150m, 15m, weight: 80m));
        Assert.AreEqual(275m, low.CarbohydrateGrams);
        Assert.HasCount(2, low.Warnings);
        StringAssert.StartsWith(low.Warnings[0], "Fat is 15% of calories, under the coaching review floor of 20%.");
        StringAssert.StartsWith(low.Warnings[1], "Fat is 0.42 g/kg/day, under the coaching review floor of 0.5 g/kg/day.");

        // The protein range is the split's too, wider while they eat below what they burn.
        StringAssert.StartsWith((await ReadSliceAsync<MacroSplitView>(owner, B5c2Split(2_400m, 200m, 25m, weight: 80m))).Warnings.Single(), "Protein is 2.5 g/kg/day");
        Assert.IsEmpty((await ReadSliceAsync<MacroSplitView>(owner, B5c2Split(2_400m, 200m, 25m, weight: 80m, deficit: true))).Warnings);

        // What NUT-008 refuses is said in words, on the box it is about.
        await B5c2AssertSplitRefusedAsync(owner, B5c2Split(2_000m, 450m, 25m), "fatPercentage", "Protein and fat come to more than 2,000 calories, so nothing is left for carbs.");
        await B5c2AssertSplitRefusedAsync(owner, $"{B5c2SplitUrl}?proteinGrams=150&fatPercentage=25", "calorieTarget", "Type the daily calories first");
        await B5c2AssertSplitRefusedAsync(owner, B5c2Split(2_000m, -1m, 25m), "proteinGrams", "Type the daily protein first");
        await B5c2AssertSplitRefusedAsync(owner, B5c2Split(2_000m, 150m, 120m), "fatPercentage", "Fat has to be between 0 and 100 percent");
        await B5c2AssertSplitRefusedAsync(owner, B5c2Split(2_000m, 150m, 25m, weight: 0m), "bodyweightKilograms", "A body weight has to be");

        // Staff only: a client and someone signed out are refused.
        using var maya = CreateClient();
        await R31InviteAsync(owner, maya, tenant, "b5c2-split-maya@example.test", "Maya", "Rahman");
        await AssertStatusAsync(await maya.GetAsync(B5c2Split(2_000m, 150m, 25m)), HttpStatusCode.Forbidden);
        using var anonymous = CreateClient();
        SetTenant(anonymous, tenant);
        await AssertStatusAsync(await anonymous.GetAsync(B5c2Split(2_000m, 150m, 25m)), HttpStatusCode.Unauthorized);

        // The builder keeps the server's grams as a browser's numbers, with the share beside them. Published,
        // the version keeps the split's own grams, to the database's six decimals, and names the share.
        var oats = await R44aRecipeAsync(owner, "Overnight oats", 20m);
        var chicken = await R44aRecipeAsync(owner, "Chicken & rice", 40m);
        var filled = R44aContent(oats.VersionId, chicken.VersionId, calories: 2_000m) with
        {
            TargetProteinGrams = 150m,
            TargetCarbohydrateGrams = 225m,
            TargetFatGrams = 55.55555555555556m,
            TargetFatPercentage = 25m,
        };
        var draft = await R44aCreateAsync(owner, new(null, null, null, filled));
        var plan = await R44aPublishAsync(owner, draft.Id, draft.Version, replaceNewer: false);
        var first = await ReadSliceAsync<MealPlanVersionView>(owner, R44aVersionUrl(plan.VersionId));
        Assert.AreEqual(
            ((decimal?)25m, MacroTargetCalculator.Key, MacroTargetCalculator.CurrentVersion, 55.555556m, 225m),
            (first.TargetFatPercentage, first.TargetMacroMethodKey, first.TargetMacroMethodVersion, first.TargetFatGrams, first.TargetCarbohydrateGrams));

        // Grams changed by hand since are kept as typed and name nothing.
        var typedDraft = await R44aCreateAsync(owner, new(plan.Id, plan.VersionId, 1, filled with { TargetFatGrams = 60m }));
        var typedPlan = await R44aPublishAsync(owner, typedDraft.Id, typedDraft.Version, replaceNewer: false);
        var typed = await ReadSliceAsync<MealPlanVersionView>(owner, R44aVersionUrl(typedPlan.VersionId));
        Assert.AreEqual(
            ((decimal?)null, (string?)null, (string?)null, 60m, 225m),
            (typed.TargetFatPercentage, typed.TargetMacroMethodKey, typed.TargetMacroMethodVersion, typed.TargetFatGrams, typed.TargetCarbohydrateGrams));

        // The first version's grams as read back, six decimals, are still the split's: reopened, it keeps its share.
        var reopenedDraft = await R44aCreateAsync(owner, new(plan.Id, typedPlan.VersionId, 2, filled with
        {
            TargetFatGrams = first.TargetFatGrams,
            TargetCarbohydrateGrams = first.TargetCarbohydrateGrams,
        }));
        var reopenedPlan = await R44aPublishAsync(owner, reopenedDraft.Id, reopenedDraft.Version, replaceNewer: false);
        Assert.AreEqual(25m, (await ReadSliceAsync<MealPlanVersionView>(owner, R44aVersionUrl(reopenedPlan.VersionId))).TargetFatPercentage);

        // A share with protein and fat beyond the calories cannot be the split's: the grams stay as typed.
        var beyondDraft = await R44aCreateAsync(owner, new(plan.Id, reopenedPlan.VersionId, 3, filled with { TargetCalories = 1_000m, TargetProteinGrams = 200m, TargetFatPercentage = 30m }));
        var beyondPlan = await R44aPublishAsync(owner, beyondDraft.Id, beyondDraft.Version, replaceNewer: false);
        var beyond = await ReadSliceAsync<MealPlanVersionView>(owner, R44aVersionUrl(beyondPlan.VersionId));
        Assert.AreEqual(((decimal?)null, 55.555556m), (beyond.TargetFatPercentage, beyond.TargetFatGrams));

        // The database keeps a share and the split that used it together, between 0 and 100, and a published
        // version's never changes.
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        var copy = """
            INSERT INTO nutrition."MealPlanTemplateVersions"
                ("Id", "TenantId", "MealPlanTemplateId", "Revision", "DayCount", "Status", "TargetCalories", "TargetProteinGrams",
                 "TargetCarbohydrateGrams", "TargetFatGrams", "TargetFatPercentage", "TargetMacroMethodKey", "TargetMacroMethodVersion")
            SELECT gen_random_uuid(), "TenantId", "MealPlanTemplateId", "Revision" + 100, "DayCount", 'Draft', "TargetCalories",
                "TargetProteinGrams", "TargetCarbohydrateGrams", "TargetFatGrams", SPLIT
            FROM nutrition."MealPlanTemplateVersions" WHERE "Id" = @id
            """;
        const string splitConstraint = "CK_MealPlanTemplateVersions_TargetSplit";
        await B5c2AssertRefusedByAsync(connection, copy.Replace("SPLIT", "25, NULL, NULL", StringComparison.Ordinal), plan.VersionId, splitConstraint);
        await B5c2AssertRefusedByAsync(connection, copy.Replace("SPLIT", "NULL, 'Nut008MacroSplit', '1.0'", StringComparison.Ordinal), plan.VersionId, splitConstraint);
        await B5c2AssertRefusedByAsync(connection, copy.Replace("SPLIT", "120, 'Nut008MacroSplit', '1.0'", StringComparison.Ordinal), plan.VersionId, splitConstraint);
        await A6AssertSqlRefusedAsync(
            connection,
            "UPDATE nutrition.\"MealPlanTemplateVersions\" SET \"TargetFatPercentage\" = NULL, \"TargetMacroMethodKey\" = NULL, \"TargetMacroMethodVersion\" = NULL WHERE \"Id\" = @id",
            plan.VersionId,
            PostgresErrorCodes.CheckViolation);
    }

    [TestMethod]
    public async Task B5c2StartFromAClientsTargetsListsTheCallersCurrentClientsWhoseNutritionIsOpen()
    {
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b5c2-targets-owner@example.test", "Hicham Haddad", "B5c2 Targets");
        using var coach = CreateClient();
        await JoinAsCoachAsync(owner, coach, "b5c2-targets-coach@example.test", "Lina Saad");

        // The owner's Rami with targets the split made; the coach's Nour, whose latest are her coach's own
        // macros; the owner's Sara on a one-day plan; and the owner's Lena with nothing worked out yet.
        using var rami = CreateClient();
        var ramiId = await R31InviteAsync(owner, rami, tenant, "b5c2-targets-rami@example.test", "Rami", "Khoury");
        await R53dStartNutritionAsync(owner, ramiId);
        var ramis = await R53dCalculateAsync(owner, ramiId, weight: 82m, protein: 150m);
        using var nour = CreateClient();
        var nourId = await R31InviteAsync(coach, nour, tenant, "b5c2-targets-nour@example.test", "Nour", "Fares");
        await R53dStartNutritionAsync(owner, nourId);
        var formula = await R53dCalculateAsync(coach, nourId, weight: 60m, protein: 110m, adjustment: -300m, deficit: true);
        RequiredTestClock.Advance(TimeSpan.FromMinutes(5));
        await RefreshCsrfAsync(coach);
        var made = await coach.PostAsJsonAsync(A6OverrideUrl(nourId, formula.Id), new CreateMacroOverrideRequest(120m, 45m, 160m, "Her own numbers"));
        await AssertStatusAsync(made, HttpStatusCode.OK);
        var nours = await ReadSlicePayloadAsync<NutritionCalculationRecord>(made);
        using var sara = CreateClient();
        var saraId = await R31InviteAsync(owner, sara, tenant, "b5c2-targets-sara@example.test", "Sara", "Mansour");
        await CreateFreeNutritionEnrollmentAsync(owner, saraId, 1, TenantToday().ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
        await R53dCalculateAsync(owner, saraId, weight: 65m, protein: 120m);
        using var lena = CreateClient();
        var lenaId = await R31InviteAsync(owner, lena, tenant, "b5c2-targets-lena@example.test", "Lena", "Haddad");
        await R53dStartNutritionAsync(owner, lenaId);

        // The owner sees every client with targets, by name, each with whose client they are.
        var ownersList = await ReadSliceAsync<ClientTargetsList>(owner, B5c2ClientTargetsUrl);
        CollectionAssert.AreEqual(new[] { nourId, ramiId, saraId }, ownersList.Items.Select(item => item.ClientProfileId).ToArray());
        Assert.AreEqual((3, 500), (ownersList.Total, ownersList.Limit));
        var ramiItem = ownersList.Items[1];
        Assert.AreEqual(
            (ramis.Id, "Rami", "Khoury", "Hicham Haddad", (decimal?)25m, (decimal?)82m, false),
            (ramiItem.CalculationId, ramiItem.FirstName, ramiItem.LastName, ramiItem.CoachName, ramiItem.FatPercentage, ramiItem.BodyweightKilograms, ramiItem.IsEnergyDeficit));
        Assert.AreEqual(ramis.CalorieTarget, ramiItem.CalorieTarget, StoredPrecision);
        Assert.AreEqual(ramis.ProteinGrams, ramiItem.ProteinGrams, StoredPrecision);
        Assert.AreEqual(ramis.CarbohydrateGrams, ramiItem.CarbohydrateGrams, StoredPrecision);
        Assert.AreEqual(ramis.FatGrams, ramiItem.FatGrams, StoredPrecision);
        Assert.IsEmpty(ramiItem.Warnings);

        // Nour's latest targets are her coach's own macros: no share, and she eats below what she burns.
        var nourItem = ownersList.Items[0];
        Assert.AreEqual(
            (nours.Result.Id, "Lina Saad", (decimal?)null, (decimal?)60m, true, 120m, 160m, 45m),
            (nourItem.CalculationId, nourItem.CoachName, nourItem.FatPercentage, nourItem.BodyweightKilograms, nourItem.IsEnergyDeficit,
                nourItem.ProteinGrams, nourItem.CarbohydrateGrams, nourItem.FatGrams));
        Assert.AreEqual(1_525m, nourItem.CalorieTarget);

        // A coach sees only their own client, and nothing of the owner's.
        var coachsAnswer = await coach.GetAsync(B5c2ClientTargetsUrl);
        await AssertStatusAsync(coachsAnswer, HttpStatusCode.OK);
        Assert.IsFalse((await coachsAnswer.Content.ReadAsStringAsync()).Contains("Khoury", StringComparison.Ordinal));
        CollectionAssert.AreEqual(
            new[] { nourId },
            (await ReadSliceAsync<ClientTargetsList>(coach, B5c2ClientTargetsUrl)).Items.Select(item => item.ClientProfileId).ToArray());

        // Not for a client or someone signed out; another workspace's owner reads only their own.
        await AssertStatusAsync(await rami.GetAsync(B5c2ClientTargetsUrl), HttpStatusCode.Forbidden);
        using var anonymous = CreateClient();
        SetTenant(anonymous, tenant);
        await AssertStatusAsync(await anonymous.GetAsync(B5c2ClientTargetsUrl), HttpStatusCode.Unauthorized);
        using var stranger = CreateClient();
        var strangerTenant = await RegisterCoachAsync(stranger, "b5c2-targets-stranger@example.test", "Other Owner", "B5c2 Elsewhere");
        Assert.IsEmpty((await ReadSliceAsync<ClientTargetsList>(stranger, B5c2ClientTargetsUrl)).Items);
        SetTenant(stranger, tenant);
        await AssertStatusAsync(await stranger.GetAsync(B5c2ClientTargetsUrl), HttpStatusCode.Forbidden);
        SetTenant(stranger, strangerTenant);

        // Sara's one-day plan ends, so her Nutrition is closed: she leaves the list.
        RequiredTestClock.Advance(TimeSpan.FromDays(2));
        CollectionAssert.AreEqual(
            new[] { nourId, ramiId },
            (await ReadSliceAsync<ClientTargetsList>(owner, B5c2ClientTargetsUrl)).Items.Select(item => item.ClientProfileId).ToArray());

        // A released client is a former client (ADR 0027): never listed.
        var profile = await RequiredJsonAsync<TeamClientDetails>(await owner.GetAsync($"/api/clients/{ramiId}"));
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync($"/api/clients/{ramiId}/release", new { reason = "Moved away", profile.Version }),
            HttpStatusCode.OK);
        CollectionAssert.AreEqual(
            new[] { nourId },
            (await ReadSliceAsync<ClientTargetsList>(owner, B5c2ClientTargetsUrl)).Items.Select(item => item.ClientProfileId).ToArray());
    }

    [TestMethod]
    public async Task B5c2TheRecipesPageFiltersPublishedRecipesAndDraftsOnTheServer()
    {
        using var owner = CreateClient();
        await RegisterCoachAsync(owner, "b5c2-recipes-owner@example.test", "Hicham Haddad", "B5c2 Recipes");
        var oats = await R44aRecipeAsync(owner, "Overnight oats", 20m);
        var soup = await R44aRecipeAsync(owner, "Lentil soup", 15m, publish: false);
        var rice = await R44aRecipeAsync(owner, "Chicken rice", 40m);

        // Rice has a newer version, not published: it is still a published recipe, its changes waiting.
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync($"/api/nutrition/recipes/{rice.Id}/versions", new
            {
                instructions = "A later edit, not published.",
                servings = 1m,
                ingredients = new[] { new { foodItemVersionId = rice.FoodVersionId, quantity = 50m, unit = "Gram", basis = "Prepared" } },
            }),
            HttpStatusCode.OK);

        var all = await ReadSliceAsync<RecipePage>(owner, B5c2RecipesUrl);
        Assert.AreEqual((3, new RecipeListCounts(3, 2, 1)), (all.Total, all.Counts));

        var published = await ReadSliceAsync<RecipePage>(owner, $"{B5c2RecipesUrl}?status=Published");
        Assert.AreEqual((2, new RecipeListCounts(3, 2, 1)), (published.Total, published.Counts));
        CollectionAssert.AreEquivalent(new[] { oats.Id, rice.Id }, published.Items.Select(item => item.Id).ToArray());
        var riceRow = published.Items.Single(item => item.Id == rice.Id);
        Assert.AreEqual(
            (PublicationStatus.Draft, (Guid?)rice.VersionId),
            (riceRow.Status, riceRow.PublishedVersionId),
            "Listed at its newest version, as every row of the page is.");

        var drafts = await ReadSliceAsync<RecipePage>(owner, $"{B5c2RecipesUrl}?status=Drafts");
        Assert.AreEqual((1, soup.Id), (drafts.Total, drafts.Items.Single().Id));
        Assert.IsNull(drafts.Items.Single().PublishedVersionId);

        // The counts are the search's, whichever status is asked for.
        var searched = await ReadSliceAsync<RecipePage>(owner, $"{B5c2RecipesUrl}?query=soup&status=Published");
        Assert.AreEqual((0, new RecipeListCounts(1, 0, 1)), (searched.Total, searched.Counts));
        Assert.IsEmpty(searched.Items);

        // The meal-plan builder's panel is as it was; with Drafts asked of it too, it holds nothing.
        CollectionAssert.AreEquivalent(
            new[] { oats.VersionId, rice.VersionId },
            (await ReadSliceAsync<RecipePage>(owner, $"{B5c2RecipesUrl}?published=true")).Items.Select(item => item.VersionId).ToArray());
        var none = await ReadSliceAsync<RecipePage>(owner, $"{B5c2RecipesUrl}?published=true&status=Drafts");
        Assert.AreEqual(0, none.Total);
        Assert.IsEmpty(none.Items);

        // A status the page does not know is refused.
        await AssertStatusAsync(await owner.GetAsync($"{B5c2RecipesUrl}?status=Archived"), HttpStatusCode.BadRequest);
    }

    [TestMethod]
    public async Task B5c2PublishRefusesADayWithNoMealsInTheBuildersWords()
    {
        using var owner = CreateClient();
        await RegisterCoachAsync(owner, "b5c2-words-owner@example.test", "Hicham Haddad", "B5c2 Words");
        var oats = await R44aRecipeAsync(owner, "Overnight oats", 20m);
        var chicken = await R44aRecipeAsync(owner, "Chicken & rice", 40m);
        var content = R44aContent(oats.VersionId, chicken.VersionId);
        var day = content.Days![0];
        var empty = new MealPlanDraftDay([]);

        // Nothing shifts (NUT-013): a day in the middle is filled, never deleted; the last day may go too.
        var draft = await R44aCreateAsync(owner, new(null, null, null, content with { Days = [day, empty, day] }));
        await B5c2AssertPublishSaysAsync(owner, draft.Id, draft.Version, "Day 2 has no meals yet. Add a meal, or copy a day here.");
        var last = await R44aSaveAsync(owner, draft.Id, draft.Version, content with { Days = [day, empty] });
        await B5c2AssertPublishSaysAsync(owner, draft.Id, last.Version, "Day 2 has no meals yet. Add a meal, copy a day here, or delete the day.");
        var nothing = await R44aSaveAsync(owner, draft.Id, last.Version, content with { Days = [empty, empty] });
        await B5c2AssertPublishSaysAsync(owner, draft.Id, nothing.Version, "Day 1 has no meals yet. Add a meal to it.");
    }

    private static string B5c2Split(decimal calories, decimal protein, decimal fat, decimal? weight = null, bool deficit = false) =>
        string.Create(CultureInfo.InvariantCulture, $"{B5c2SplitUrl}?calorieTarget={calories}&proteinGrams={protein}&fatPercentage={fat}")
        + (weight is { } kilograms ? string.Create(CultureInfo.InvariantCulture, $"&bodyweightKilograms={kilograms}") : string.Empty)
        + (deficit ? "&isEnergyDeficit=true" : string.Empty);

    private static async Task B5c2AssertSplitRefusedAsync(HttpClient coach, string url, string field, string startsWith)
    {
        var response = await coach.GetAsync(url);
        await AssertStatusAsync(response, HttpStatusCode.BadRequest);
        var problem = await RequiredJsonAsync<R42aValidationProblem>(response);
        Assert.IsTrue(problem.Errors.TryGetValue(field, out var messages), $"Expected an error on '{field}': {string.Join(", ", problem.Errors.Keys)}");
        StringAssert.StartsWith(messages.Single(), startsWith);
    }

    private static async Task B5c2AssertPublishSaysAsync(HttpClient coach, Guid draftId, uint version, string words)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync(R44aPublishUrl(draftId), new PublishMealPlanDraftRequest(version, false));
        await AssertStatusAsync(response, HttpStatusCode.BadRequest);
        Assert.AreEqual(words, (await RequiredJsonAsync<R42aValidationProblem>(response)).Errors["days"].Single());
    }

    private static async Task B5c2AssertRefusedByAsync(NpgsqlConnection connection, string sql, Guid id, string constraint)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.Parameters.AddWithValue("id", id);
        var refused = await Assert.ThrowsAsync<PostgresException>(async () => await command.ExecuteNonQueryAsync());
        Assert.AreEqual((PostgresErrorCodes.CheckViolation, constraint), (refused.SqlState, refused.ConstraintName), refused.MessageText);
    }
}
