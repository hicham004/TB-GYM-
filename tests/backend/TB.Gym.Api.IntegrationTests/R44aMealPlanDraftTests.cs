using System.Net;
using System.Net.Http.Json;
using TB.Gym.Modules.Nutrition;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// R4.4a: the meal-plan builder keeps a coach's changes on the server as they work (NUT-013), as the
/// program builder does. A draft belongs to that coach in that workspace and to nobody else, the
/// owner included; it keeps any value mid-edit within a version's shape; two tabs never start two or
/// overwrite each other; and only Publish turns it into a version, checked like any save, asking first
/// when someone published after it began.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string R44aDraftsUrl = "/api/nutrition/meal-plan-drafts";

    private static string R44aDraftUrl(Guid draftId) => $"{R44aDraftsUrl}/{draftId}";

    private static string R44aPublishUrl(Guid draftId) => $"{R44aDraftsUrl}/{draftId}/publish";

    private static string R44aDiscardUrl(Guid draftId) => $"{R44aDraftsUrl}/{draftId}/discard";

    private static string R44aPlanUrl(Guid planId) => $"/api/nutrition/meal-plans/{planId}";

    private static string R44aVersionUrl(Guid versionId) => $"/api/nutrition/meal-plan-versions/{versionId}";

    private static readonly string[] R44aSlotsInOrder = ["0:0:Breakfast", "0:1:Lunch", "1:0:Breakfast"];

    [TestMethod]
    public async Task R44aACoachKeepsMealPlanChangesOnTheServerAndPublishesThemAsVersions()
    {
        using var owner = CreateClient();
        await RegisterCoachAsync(owner, "r44a-owner@example.test", "Hicham Haddad", "R44a Meals");
        var oats = await R44aRecipeAsync(owner, "Overnight oats", 20m);
        var chicken = await R44aRecipeAsync(owner, "Chicken & rice", 40m);
        var unpublished = await R44aRecipeAsync(owner, "Lentil soup", 15m, publish: false);

        // The builder's recipe panel lists only what a plan may hold, each at its newest published
        // version, even when a newer draft of the recipe exists.
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync($"/api/nutrition/recipes/{oats.Id}/versions", new
            {
                instructions = "A later edit, not published.",
                servings = 1m,
                ingredients = new[] { new { foodItemVersionId = oats.FoodVersionId, quantity = 50m, unit = "Gram", basis = "Prepared" } },
            }),
            HttpStatusCode.OK);
        var everything = await ReadSliceAsync<RecipePage>(owner, "/api/nutrition/recipes");
        Assert.AreEqual(3, everything.Total);
        var usable = await ReadSliceAsync<RecipePage>(owner, "/api/nutrition/recipes?published=true");
        CollectionAssert.AreEquivalent(
            new[] { oats.VersionId, chicken.VersionId },
            usable.Items.Select(item => item.VersionId).ToArray());
        Assert.IsTrue(usable.Items.All(item => item.Status == PublicationStatus.Published));
        var oatsCalories = usable.Items.Single(item => item.VersionId == oats.VersionId).Calories;

        // Mid-edit: no name, no targets and a day with no meals are kept as they are.
        var started = await R44aCreateAsync(owner, new(null, null, null, R44aContent(oats.VersionId, chicken.VersionId, name: string.Empty) with
        {
            TargetCalories = null,
            Days = [new MealPlanDraftDay([])],
        }));
        var listed = (await ReadSliceAsync<MealPlanDraftSummary[]>(owner, R44aDraftsUrl)).Single();
        Assert.AreEqual((started.Id, (Guid?)null, string.Empty, 1), (listed.Id, listed.MealPlanTemplateId, listed.Name, listed.DayCount));
        Assert.AreEqual(0, (await ReadSliceAsync<MealPlanTemplatePage>(owner, "/api/nutrition/meal-plans")).Total);

        // Publish checks every rule, naming what stops it, and a refusal leaves the draft as it was.
        await R44aAssertPublishRefusedAsync(owner, started.Id, started.Version, "name");
        var noMeals = await R44aSaveAsync(owner, started.Id, started.Version, R44aContent(oats.VersionId, chicken.VersionId) with
        {
            Days = [.. R44aContent(oats.VersionId, chicken.VersionId).Days!, new MealPlanDraftDay([])],
        });
        await R44aAssertPublishRefusedAsync(owner, started.Id, noMeals.Version, "days");
        var notPublished = await R44aSaveAsync(owner, started.Id, noMeals.Version, R44aContent(unpublished.VersionId, chicken.VersionId));
        await R44aAssertPublishRefusedAsync(owner, started.Id, notPublished.Version, "choices");
        var read = await ReadSliceAsync<MealPlanDraftView>(owner, R44aDraftUrl(started.Id));
        Assert.AreEqual(notPublished.Version, read.Version);
        CollectionAssert.AreEquivalent(
            new[] { unpublished.VersionId, chicken.VersionId },
            read.Recipes.Select(recipe => recipe.VersionId).ToArray(),
            "The recipes it names, in whatever state they are now.");

        // Published: a new plan at its first version, ready to assign, and the draft is gone.
        var ready = await R44aSaveAsync(owner, started.Id, notPublished.Version, R44aContent(oats.VersionId, chicken.VersionId, name: "  Lean bulk  "));
        var first = await R44aPublishAsync(owner, started.Id, ready.Version, replaceNewer: false);
        Assert.AreEqual(
            ("Lean bulk", 1, PublicationStatus.Published, 2, 3, 2400m),
            (first.Name, first.Revision, first.Status, first.DayCount, first.SlotCount, first.TargetCalories));
        await AssertStatusAsync(await owner.GetAsync(R44aDraftUrl(started.Id)), HttpStatusCode.NotFound);
        Assert.IsEmpty(await ReadSliceAsync<MealPlanDraftSummary[]>(owner, R44aDraftsUrl));

        // The version holds the days and meals in order, each choice worked out from its servings.
        var version = await ReadSliceAsync<MealPlanVersionView>(owner, R44aVersionUrl(first.VersionId));
        CollectionAssert.AreEqual(
            R44aSlotsInOrder,
            version.Slots.Select(slot => $"{slot.DayOffset}:{slot.Order}:{slot.Name}").ToArray());
        var lunch = version.Slots.Single(slot => slot.Name == "Lunch");
        Assert.AreEqual(oatsCalories * 2m, lunch.Choices.Single(choice => choice.RecipeVersionId == oats.VersionId).Calories);
        Assert.HasCount(2, lunch.Choices);
        Assert.AreEqual((150m, 250m, 70m), (version.TargetProteinGrams, version.TargetCarbohydrateGrams, version.TargetFatGrams));
        CollectionAssert.AreEquivalent(
            new[] { oats.VersionId, chicken.VersionId },
            version.Recipes.Select(recipe => recipe.VersionId).ToArray());

        // Changing it: a draft of the plan, shown on its card and in its detail, renamed on Publish.
        var change = await R44aCreateAsync(owner, new(first.Id, first.VersionId, 1, R44aContent(oats.VersionId, chicken.VersionId, name: "Lean bulk, phase 2")));
        var detail = await ReadSliceAsync<MealPlanTemplateDetail>(owner, R44aPlanUrl(first.Id));
        Assert.AreEqual(change.Id, detail.Draft?.Id);
        Assert.AreEqual(change.Id, (await ReadSliceAsync<MealPlanTemplatePage>(owner, "/api/nutrition/meal-plans")).Items.Single().Draft?.Id);

        // Each save carries the version it read; one from an older read is refused.
        var later = await R44aSaveAsync(owner, change.Id, change.Version, R44aContent(oats.VersionId, chicken.VersionId, name: "Lean bulk, phase 2", calories: 2600m));
        await R44aAssertConflictAsync(
            await R44aPutAsync(owner, change.Id, change.Version, R44aContent(oats.VersionId, chicken.VersionId)),
            MealPlanDraftConflictCodes.Stale);

        var second = await R44aPublishAsync(owner, change.Id, later.Version, replaceNewer: false);
        Assert.AreEqual((first.Id, 2, "Lean bulk, phase 2", 2600m), (second.Id, second.Revision, second.Name, second.TargetCalories));
        var after = await ReadSliceAsync<MealPlanTemplateDetail>(owner, R44aPlanUrl(first.Id));
        Assert.AreEqual(("Lean bulk, phase 2", 2), (after.Name, after.CurrentRevision));
        Assert.IsNull(after.Draft);
        CollectionAssert.AreEqual(
            new[] { second.VersionId, first.VersionId },
            after.Versions.Select(item => item.Id).ToArray());
        Assert.IsTrue(after.Versions.All(item => item.Status == PublicationStatus.Published), "The first version stays as it was.");
        Assert.AreEqual(2400m, (await ReadSliceAsync<MealPlanVersionView>(owner, R44aVersionUrl(first.VersionId))).TargetCalories);
    }

    [TestMethod]
    public async Task R44aMealPlanDraftsAreReachedOnlyByTheirOwnerInTheirWorkspace()
    {
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "r44a-scope-owner@example.test", "Hicham Haddad", "R44a Scope");
        using var coach = CreateClient();
        await JoinAsCoachAsync(owner, coach, "r44a-scope-coach@example.test", "Lina Saad");
        var oats = await R44aRecipeAsync(owner, "Overnight oats", 20m);
        var chicken = await R44aRecipeAsync(owner, "Chicken & rice", 40m);
        var content = R44aContent(oats.VersionId, chicken.VersionId);

        // A coach's new plan is their own until its first Publish; nobody else reads or touches it.
        var started = await R44aCreateAsync(coach, new(null, null, null, content));
        Assert.IsEmpty(await ReadSliceAsync<MealPlanDraftSummary[]>(owner, R44aDraftsUrl));
        await AssertStatusAsync(await owner.GetAsync(R44aDraftUrl(started.Id)), HttpStatusCode.NotFound);
        await AssertStatusAsync(await R44aPutAsync(owner, started.Id, started.Version, content), HttpStatusCode.NotFound);
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync(R44aPublishUrl(started.Id), new PublishMealPlanDraftRequest(started.Version, false)),
            HttpStatusCode.NotFound);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync(R44aDiscardUrl(started.Id), new DiscardMealPlanDraftRequest(started.Version)),
            HttpStatusCode.NotFound);

        // A client keeps no drafts and reads no plans, and nobody signed out reaches one.
        using var client = CreateClient();
        await R31InviteAsync(owner, client, tenant, "r44a-scope-maya@example.test", "Maya", "Rahman");
        await AssertStatusAsync(await client.GetAsync(R44aDraftsUrl), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await client.GetAsync(R44aDraftUrl(started.Id)), HttpStatusCode.Forbidden);
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync(R44aDraftsUrl, new CreateMealPlanDraftRequest(null, null, null, content), SliceReadJson),
            HttpStatusCode.Forbidden);
        using var anonymous = CreateClient();
        SetTenant(anonymous, tenant);
        await AssertStatusAsync(await anonymous.GetAsync(R44aDraftUrl(started.Id)), HttpStatusCode.Unauthorized);

        // Published by the coach: the workspace's plan, which the team now sees.
        var plan = await R44aPublishAsync(coach, started.Id, started.Version, replaceNewer: false);
        Assert.AreEqual(plan.Id, (await ReadSliceAsync<MealPlanTemplatePage>(owner, "/api/nutrition/meal-plans")).Items.Single().Id);
        await AssertStatusAsync(await client.GetAsync(R44aPlanUrl(plan.Id)), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await client.GetAsync(R44aVersionUrl(plan.VersionId)), HttpStatusCode.Forbidden);

        // Another workspace is refused this one and finds nothing of it in its own.
        using var stranger = CreateClient();
        var strangerTenant = await RegisterCoachAsync(stranger, "r44a-scope-stranger@example.test", "Other Owner", "R44a Elsewhere");
        SetTenant(stranger, tenant);
        await AssertStatusAsync(await stranger.GetAsync(R44aPlanUrl(plan.Id)), HttpStatusCode.Forbidden);
        SetTenant(stranger, strangerTenant);
        await AssertStatusAsync(await stranger.GetAsync(R44aPlanUrl(plan.Id)), HttpStatusCode.NotFound);
        await AssertStatusAsync(await stranger.GetAsync(R44aVersionUrl(plan.VersionId)), HttpStatusCode.NotFound);

        // Nor does it start changes to this workspace's plan, or use or learn this workspace's recipes.
        await RefreshCsrfAsync(stranger);
        await AssertStatusAsync(
            await stranger.PostAsJsonAsync(R44aDraftsUrl, new CreateMealPlanDraftRequest(plan.Id, plan.VersionId, 1, content), SliceReadJson),
            HttpStatusCode.NotFound);
        var borrowed = await R44aCreateAsync(stranger, new(null, null, null, content));
        Assert.IsEmpty((await ReadSliceAsync<MealPlanDraftView>(stranger, R44aDraftUrl(borrowed.Id))).Recipes);
        await R44aAssertPublishRefusedAsync(stranger, borrowed.Id, borrowed.Version, "choices");

        // A draft of one plan starts from one of its own versions, at a revision it really had.
        var otherDraft = await R44aCreateAsync(owner, new(null, null, null, content with { Name = "Other plan" }));
        var other = await R44aPublishAsync(owner, otherDraft.Id, otherDraft.Version, replaceNewer: false);
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync(R44aDraftsUrl, new CreateMealPlanDraftRequest(other.Id, plan.VersionId, 1, content), SliceReadJson),
            HttpStatusCode.BadRequest);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync(R44aDraftsUrl, new CreateMealPlanDraftRequest(other.Id, other.VersionId, 2, content), SliceReadJson),
            HttpStatusCode.BadRequest);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync(R44aDraftsUrl, new CreateMealPlanDraftRequest(null, other.VersionId, null, content), SliceReadJson),
            HttpStatusCode.BadRequest);
    }

    [TestMethod]
    public async Task R44aTwoTabsNeitherStartTwoDraftsNorOverwriteAndANewerVersionIsAskedAbout()
    {
        using var owner = CreateClient();
        await RegisterCoachAsync(owner, "r44a-tabs-owner@example.test", "Hicham Haddad", "R44a Tabs");
        using var coach = CreateClient();
        await JoinAsCoachAsync(owner, coach, "r44a-tabs-coach@example.test", "Lina Saad");
        var oats = await R44aRecipeAsync(owner, "Overnight oats", 20m);
        var chicken = await R44aRecipeAsync(owner, "Chicken & rice", 40m);
        var content = R44aContent(oats.VersionId, chicken.VersionId);
        var seed = await R44aCreateAsync(owner, new(null, null, null, content));
        var plan = await R44aPublishAsync(owner, seed.Id, seed.Version, replaceNewer: false);

        // Two tabs start changes to one plan at once: one draft, and the other is told to reload.
        await RefreshCsrfAsync(owner);
        var start = new CreateMealPlanDraftRequest(plan.Id, plan.VersionId, 1, content);
        var starts = await Task.WhenAll(
            owner.PostAsJsonAsync(R44aDraftsUrl, start, SliceReadJson),
            owner.PostAsJsonAsync(R44aDraftsUrl, start, SliceReadJson));
        CollectionAssert.AreEquivalent(R35cOneWins, starts.Select(response => response.StatusCode).ToArray());
        await R44aAssertConflictAsync(
            starts.Single(response => response.StatusCode == HttpStatusCode.Conflict),
            MealPlanDraftConflictCodes.AlreadyExists);
        var draft = await ReadSlicePayloadAsync<MealPlanDraftSaveView>(starts.Single(response => response.StatusCode == HttpStatusCode.OK));

        // Two saves from the same read: one lands, the other is refused rather than overwriting it.
        // The token is refreshed once, before both (see R42a).
        await RefreshCsrfAsync(owner);
        var saves = await Task.WhenAll(
            owner.PutAsJsonAsync(R44aDraftUrl(draft.Id), new SaveMealPlanDraftRequest(content with { TargetCalories = 2100m }, draft.Version), SliceReadJson),
            owner.PutAsJsonAsync(R44aDraftUrl(draft.Id), new SaveMealPlanDraftRequest(content with { TargetCalories = 2200m }, draft.Version), SliceReadJson));
        CollectionAssert.AreEquivalent(R35cOneWins, saves.Select(response => response.StatusCode).ToArray());
        await R44aAssertConflictAsync(saves.Single(response => response.StatusCode == HttpStatusCode.Conflict), MealPlanDraftConflictCodes.Stale);
        var kept = await ReadSlicePayloadAsync<MealPlanDraftSaveView>(saves.Single(response => response.StatusCode == HttpStatusCode.OK));

        // The coach publishes in between; the owner is told before anything is replaced, and keeps
        // their changes. Publishing anyway makes theirs the newest, and the coach's stays a version.
        var coachDraft = await R44aCreateAsync(coach, new(plan.Id, plan.VersionId, 1, content with { TargetCalories = 1900m }));
        var coachVersion = await R44aPublishAsync(coach, coachDraft.Id, coachDraft.Version, replaceNewer: false);
        Assert.AreEqual(2, coachVersion.Revision);
        await RefreshCsrfAsync(owner);
        await R44aAssertConflictAsync(
            await owner.PostAsJsonAsync(R44aPublishUrl(draft.Id), new PublishMealPlanDraftRequest(kept.Version, false)),
            MealPlanDraftConflictCodes.NewerVersionPublished);
        await AssertStatusAsync(await owner.GetAsync(R44aDraftUrl(draft.Id)), HttpStatusCode.OK);
        var third = await R44aPublishAsync(owner, draft.Id, kept.Version, replaceNewer: true);
        Assert.AreEqual(3, third.Revision);
        CollectionAssert.AreEqual(
            new[] { third.VersionId, coachVersion.VersionId, plan.VersionId },
            (await ReadSliceAsync<MealPlanTemplateDetail>(owner, R44aPlanUrl(plan.Id))).Versions.Select(item => item.Id).ToArray());

        // Discarding from an older read is refused; from the newest it leaves the plan as it was.
        var again = await R44aCreateAsync(owner, new(plan.Id, third.VersionId, 3, content));
        var moved = await R44aSaveAsync(owner, again.Id, again.Version, content with { Name = "Moved on" });
        await R44aAssertConflictAsync(
            await owner.PostAsJsonAsync(R44aDiscardUrl(again.Id), new DiscardMealPlanDraftRequest(again.Version)),
            MealPlanDraftConflictCodes.Stale);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync(R44aDiscardUrl(again.Id), new DiscardMealPlanDraftRequest(moved.Version)),
            HttpStatusCode.NoContent);
        var left = await ReadSliceAsync<MealPlanTemplateDetail>(owner, R44aPlanUrl(plan.Id));
        Assert.AreEqual((3, (MealPlanDraftSummary?)null), (left.CurrentRevision, left.Draft));
    }

    [TestMethod]
    public async Task R44aAMealPlanDraftIsBoundedInShapeAndNumberButNotInItsValues()
    {
        using var owner = CreateClient();
        await RegisterCoachAsync(owner, "r44a-limits-owner@example.test", "Hicham Haddad", "R44a Limits");
        var oats = await R44aRecipeAsync(owner, "Overnight oats", 20m);
        var chicken = await R44aRecipeAsync(owner, "Chicken & rice", 40m);
        var content = R44aContent(oats.VersionId, chicken.VersionId);
        var day = content.Days![0];

        // What a version could never hold is refused, by field.
        await R44aAssertInvalidAsync(owner, content with { Days = [.. Enumerable.Repeat(day, 366)] }, "days");
        await R44aAssertInvalidAsync(owner, content with { Days = [new MealPlanDraftDay([.. Enumerable.Repeat(day.Meals![0], 31)])] }, "meals");
        // A NUL is refused where the request is read, under its path in the body (audit SEC-2).
        await R44aAssertInvalidAsync(owner, content with { Name = "Bad\0name" }, "content.name");
        await R44aAssertInvalidAsync(owner, content with { Days = [new MealPlanDraftDay([new MealPlanDraftMeal("Lunch", [new MealPlanChoiceRequest(Guid.Empty, 1m)])])] }, "choices");

        // At most twenty new plans per coach, even when two starts race for the last place.
        for (var count = 0; count < MealPlanDraft.MaximumNewPlansPerOwner - 1; count++)
        {
            await R44aCreateAsync(owner, new(null, null, null, content));
        }

        await RefreshCsrfAsync(owner);
        var fresh = new CreateMealPlanDraftRequest(null, null, null, content);
        var racing = await Task.WhenAll(
            owner.PostAsJsonAsync(R44aDraftsUrl, fresh, SliceReadJson),
            owner.PostAsJsonAsync(R44aDraftsUrl, fresh, SliceReadJson));
        CollectionAssert.AreEquivalent(R35cOneWins, racing.Select(response => response.StatusCode).ToArray());
        await R44aAssertConflictAsync(
            racing.Single(response => response.StatusCode == HttpStatusCode.Conflict),
            MealPlanDraftConflictCodes.LimitReached);
        var drafts = await ReadSliceAsync<MealPlanDraftSummary[]>(owner, R44aDraftsUrl);
        Assert.HasCount(MealPlanDraft.MaximumNewPlansPerOwner, drafts);

        // Publishing one makes room; changes to a saved plan never count against it.
        var plan = await R44aPublishAsync(owner, drafts[0].Id, (await ReadSliceAsync<MealPlanDraftView>(owner, R44aDraftUrl(drafts[0].Id))).Version, replaceNewer: false);
        await R44aCreateAsync(owner, new(plan.Id, plan.VersionId, 1, content));
        await R44aCreateAsync(owner, new(null, null, null, content));
    }

    /// <summary>
    /// Two days: day 1 has Breakfast (one serving of the first recipe) and Lunch (two servings of the
    /// first, or one of the second); day 2 has Breakfast (the second recipe).
    /// </summary>
    private static MealPlanDraftContent R44aContent(
        Guid firstRecipeVersionId,
        Guid secondRecipeVersionId,
        string name = "Lean bulk",
        decimal calories = 2400m) =>
        new(
            name,
            calories,
            150m,
            250m,
            70m,
            [
                new MealPlanDraftDay(
                [
                    new MealPlanDraftMeal("Breakfast", [new MealPlanChoiceRequest(firstRecipeVersionId, 1m)]),
                    new MealPlanDraftMeal(
                        "Lunch",
                        [new MealPlanChoiceRequest(firstRecipeVersionId, 2m), new MealPlanChoiceRequest(secondRecipeVersionId, 1m)]),
                ]),
                new MealPlanDraftDay([new MealPlanDraftMeal("Breakfast", [new MealPlanChoiceRequest(secondRecipeVersionId, 1m)])]),
            ]);

    /// <summary>A coach-authored food and a one-serving recipe of 100 g of it, published unless asked not to be.</summary>
    private static async Task<R44aRecipe> R44aRecipeAsync(HttpClient coach, string name, decimal protein, bool publish = true)
    {
        await RefreshCsrfAsync(coach);
        var foodResponse = await coach.PostAsJsonAsync("/api/nutrition/foods", new
        {
            name = $"{name} base",
            provenance = "CoachAuthored",
            externalId = (string?)null,
            externalDataType = (string?)null,
            labelMediaAssetId = (Guid?)null,
            version = FoodVersion(protein, NoAllergens),
        });
        await AssertStatusAsync(foodResponse, HttpStatusCode.OK);
        var food = await RequiredJsonAsync<Phase4Food>(foodResponse);
        await RefreshCsrfAsync(coach);
        var recipeResponse = await coach.PostAsJsonAsync("/api/nutrition/recipes", new
        {
            name,
            instructions = "Coach-authored preparation.",
            servings = 1m,
            ingredients = new[] { new { foodItemVersionId = food.CurrentVersion.Id, quantity = 100m, unit = "Gram", basis = "Prepared" } },
        });
        await AssertStatusAsync(recipeResponse, HttpStatusCode.OK);
        var recipe = await RequiredJsonAsync<Phase4Recipe>(recipeResponse);
        if (publish)
        {
            await RefreshCsrfAsync(coach);
            await AssertStatusAsync(await coach.PostAsync($"/api/nutrition/recipe-versions/{recipe.VersionId}/publish", null), HttpStatusCode.OK);
        }

        return new R44aRecipe(recipe.Id, recipe.VersionId, food.CurrentVersion.Id);
    }

    private static async Task<MealPlanDraftSaveView> R44aCreateAsync(HttpClient coach, CreateMealPlanDraftRequest request)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync(R44aDraftsUrl, request, SliceReadJson);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<MealPlanDraftSaveView>(response);
    }

    private static async Task<HttpResponseMessage> R44aPutAsync(HttpClient coach, Guid draftId, uint version, MealPlanDraftContent content)
    {
        await RefreshCsrfAsync(coach);
        return await coach.PutAsJsonAsync(R44aDraftUrl(draftId), new SaveMealPlanDraftRequest(content, version), SliceReadJson);
    }

    private static async Task<MealPlanDraftSaveView> R44aSaveAsync(HttpClient coach, Guid draftId, uint version, MealPlanDraftContent content)
    {
        var response = await R44aPutAsync(coach, draftId, version, content);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<MealPlanDraftSaveView>(response);
    }

    private static async Task<MealPlanTemplateSummary> R44aPublishAsync(HttpClient coach, Guid draftId, uint version, bool replaceNewer)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync(R44aPublishUrl(draftId), new PublishMealPlanDraftRequest(version, replaceNewer));
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<MealPlanTemplateSummary>(response);
    }

    private static async Task R44aAssertPublishRefusedAsync(HttpClient coach, Guid draftId, uint version, string field)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync(R44aPublishUrl(draftId), new PublishMealPlanDraftRequest(version, false));
        await AssertStatusAsync(response, HttpStatusCode.BadRequest);
        var problem = await RequiredJsonAsync<R42aValidationProblem>(response);
        Assert.IsTrue(problem.Errors.ContainsKey(field), $"Expected an error on '{field}': {string.Join(", ", problem.Errors.Keys)}");
        await AssertStatusAsync(await coach.GetAsync(R44aDraftUrl(draftId)), HttpStatusCode.OK);
    }

    private static async Task R44aAssertInvalidAsync(HttpClient coach, MealPlanDraftContent content, string field)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync(R44aDraftsUrl, new CreateMealPlanDraftRequest(null, null, null, content), SliceReadJson);
        await AssertStatusAsync(response, HttpStatusCode.BadRequest);
        var problem = await RequiredJsonAsync<R42aValidationProblem>(response);
        Assert.IsTrue(problem.Errors.ContainsKey(field), $"Expected an error on '{field}': {string.Join(", ", problem.Errors.Keys)}");
    }

    private static async Task R44aAssertConflictAsync(HttpResponseMessage response, string code)
    {
        await AssertStatusAsync(response, HttpStatusCode.Conflict);
        Assert.AreEqual(code, (await RequiredJsonAsync<R42aConflict>(response)).Code);
    }

    private sealed record R44aRecipe(Guid Id, Guid VersionId, Guid FoodVersionId);
}
