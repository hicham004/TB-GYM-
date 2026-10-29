using System.Net;
using System.Net.Http.Json;
using TB.Gym.Modules.Nutrition;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Critique B5d: the recipe editor keeps a coach's unfinished recipe on the server as they type (NUT-014),
/// as the builders keep theirs (ADR 0033). A draft belongs to that coach in that workspace and to nobody
/// else, the owner included; it keeps any value mid-edit within a version's shape; two tabs never start
/// two or overwrite each other; and only Publish or Save as draft makes it a version, checked like any
/// save, asking first when someone saved one after it began. A new recipe's draft carries the AI
/// suggestion it began from and approves it once; a draft keeps its photo past the unused-photo sweep.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string B5dDraftsUrl = "/api/nutrition/recipe-drafts";

    private static string B5dDraftUrl(Guid draftId) => $"{B5dDraftsUrl}/{draftId}";

    private static string B5dPublishUrl(Guid draftId) => $"{B5dDraftsUrl}/{draftId}/publish";

    private static string B5dDiscardUrl(Guid draftId) => $"{B5dDraftsUrl}/{draftId}/discard";

    private static readonly decimal[] B5dFirstAmounts = [80m, 150m];

    private static readonly decimal[] B5dThirdAmounts = [80m, 200m];

    [TestMethod]
    public async Task B5dACoachKeepsRecipeChangesOnTheServerAndMakesThemVersions()
    {
        using var owner = CreateClient();
        await RegisterCoachAsync(owner, "b5d-owner@example.test", "Hicham Haddad", "B5d Recipes");
        var oats = await R44bFoodAsync(owner, "Rolled oats", 13m, ["GlutenCereals"]);
        var yogurt = await R44bFoodAsync(owner, "Greek yogurt", 10m, ["Milk"]);

        // Mid-edit: no name, no servings, an ingredient waiting for a food, an amount of 0 and half a
        // minute are all kept as they are, and nothing reaches the recipes.
        var started = await B5dCreateAsync(owner, new(null, null, new RecipeDraftContent(
            string.Empty,
            null,
            null,
            [new RecipeDraftLine(null, null, Suggestion: new RecipeDraftSuggestion("Chickpeas", 200m, "g", true)), new RecipeDraftLine(oats.VersionId, 0m)],
            PrepMinutes: 2.5m)));
        var listed = (await ReadSliceAsync<RecipeDraftSummary[]>(owner, B5dDraftsUrl)).Single();
        Assert.AreEqual((started.Id, (Guid?)null, string.Empty, 2), (listed.Id, listed.RecipeId, listed.Name, listed.LineCount));
        Assert.AreEqual(0, (await ReadSliceAsync<RecipePage>(owner, R44bRecipesUrl)).Total);
        var read = await ReadSliceAsync<RecipeDraftView>(owner, B5dDraftUrl(started.Id));
        Assert.AreEqual((started.Version, (decimal?)2.5m), (read.Version, read.Content.PrepMinutes));
        var food = read.Foods.Single();
        Assert.AreEqual((oats.FoodId, oats.VersionId, "Rolled oats", (FoodItemView?)null), (food.FoodItemId, food.Version.Id, food.Name, food.NewerFood));

        // Each rule a save has stops it, in the order the editor reads, and a refusal keeps the draft.
        var version = started.Version;
        foreach (var (content, field) in new (RecipeDraftContent, string)[]
        {
            (B5dContent(oats, yogurt) with { Name = "  " }, "name"),
            (B5dContent(oats, yogurt) with { Servings = 0m }, "servings"),
            (B5dContent(oats, yogurt) with { Lines = [] }, "ingredients"),
            (B5dContent(oats, yogurt) with { Lines = [new RecipeDraftLine(null, null, Suggestion: new RecipeDraftSuggestion("Chickpeas", 200m, "g", true))] }, "ingredients"),
            (B5dContent(oats, yogurt) with { Lines = [new RecipeDraftLine(oats.VersionId, 0m)] }, "ingredients"),
            (B5dContent(oats, yogurt) with { PrepMinutes = 2.5m }, "prepMinutes"),
            (B5dContent(oats, yogurt) with { CookMinutes = RecipeVersion.MaximumMinutes + 1 }, "cookMinutes"),
            (B5dContent(oats, yogurt) with { Instructions = " " }, "instructions"),
        })
        {
            version = (await B5dSaveAsync(owner, started.Id, version, content)).Version;
            await B5dAssertPublishRefusedAsync(owner, started.Id, version, field);
        }

        // Published: a new recipe at its first version, ready for meal plans, and the draft is gone.
        var ready = await B5dSaveAsync(owner, started.Id, version, B5dContent(oats, yogurt) with { Name = "  Overnight oats  " });
        var first = await B5dPublishAsync(owner, started.Id, ready.Version);
        Assert.AreEqual(("Overnight oats", 1, PublicationStatus.Published, (Guid?)first.VersionId), (first.Name, first.Revision, first.Status, first.PublishedVersionId));
        await AssertStatusAsync(await owner.GetAsync(B5dDraftUrl(started.Id)), HttpStatusCode.NotFound);
        Assert.IsEmpty(await ReadSliceAsync<RecipeDraftSummary[]>(owner, B5dDraftsUrl));
        var detail = await ReadSliceAsync<RecipeDetail>(owner, R44bRecipeUrl(first.Id));
        Assert.IsNull(detail.Draft);
        Assert.AreEqual((2m, (int?)10, (int?)5), (detail.Latest.Servings, detail.Latest.PrepMinutes, detail.Latest.CookMinutes));
        CollectionAssert.AreEqual(B5dFirstAmounts, detail.Latest.Ingredients.Select(line => line.Quantity).ToArray());
        Assert.AreEqual("Soak overnight, then stir.", detail.Latest.Instructions, "Saved trimmed, as any save.");

        // Changing it: a draft of the recipe, on its card and in its detail; each save carries the version it read.
        var change = await B5dCreateAsync(owner, new(first.Id, 1, B5dContent(oats, yogurt) with { Name = "High-protein oats" }));
        Assert.AreEqual(change.Id, (await ReadSliceAsync<RecipeDetail>(owner, R44bRecipeUrl(first.Id))).Draft?.Id);
        Assert.AreEqual(change.Id, (await ReadSliceAsync<RecipePage>(owner, R44bRecipesUrl)).Items.Single().Draft?.Id);
        Assert.IsNull((await ReadSliceAsync<RecipePage>(owner, $"{R44bRecipesUrl}?published=true")).Items.Single().Draft, "A meal plan's panel has none.");
        var later = await B5dSaveAsync(owner, change.Id, change.Version, B5dContent(oats, yogurt, yogurtGrams: 200m) with { Name = "High-protein oats" });
        await B5dAssertConflictAsync(await B5dPutAsync(owner, change.Id, change.Version, B5dContent(oats, yogurt)), RecipeDraftConflictCodes.Stale);

        // Save as draft: the next version, complete and unpublished, renamed; meal plans keep version 1.
        var kept = await B5dPublishAsync(owner, change.Id, later.Version, keepAsDraft: true);
        Assert.AreEqual((2, PublicationStatus.Draft, (Guid?)first.VersionId, "High-protein oats"), (kept.Revision, kept.Status, kept.PublishedVersionId, kept.Name));
        var shared = await ReadSliceAsync<RecipeDetail>(owner, R44bRecipeUrl(first.Id));
        Assert.AreEqual((2, (Guid?)first.VersionId, (RecipeDraftSummary?)null), (shared.CurrentRevision, shared.PublishedVersionId, shared.Draft));
        Assert.AreEqual(first.VersionId, (await ReadSliceAsync<RecipePage>(owner, $"{R44bRecipesUrl}?published=true")).Items.Single().VersionId);

        // From the shared draft, another change is published as version 3.
        var third = await B5dCreateAsync(owner, new(first.Id, 2, B5dContent(oats, yogurt, yogurtGrams: 200m) with { Name = "High-protein oats" }));
        var published = await B5dPublishAsync(owner, third.Id, third.Version);
        Assert.AreEqual((3, PublicationStatus.Published, (Guid?)published.VersionId), (published.Revision, published.Status, published.PublishedVersionId));
        CollectionAssert.AreEqual(B5dThirdAmounts, (await ReadSliceAsync<RecipeDetail>(owner, R44bRecipeUrl(first.Id))).Latest.Ingredients.Select(line => line.Quantity).ToArray());
    }

    [TestMethod]
    public async Task B5dRecipeDraftsAreReachedOnlyByTheirOwnerInTheirWorkspace()
    {
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b5d-scope-owner@example.test", "Hicham Haddad", "B5d Scope");
        using var coach = CreateClient();
        await JoinAsCoachAsync(owner, coach, "b5d-scope-coach@example.test", "Lina Saad");
        var oats = await R44bFoodAsync(owner, "Rolled oats", 13m, []);
        var yogurt = await R44bFoodAsync(owner, "Greek yogurt", 10m, []);
        var content = B5dContent(oats, yogurt);

        // A coach's new recipe is their own until it becomes a version; nobody else reads or touches it.
        var started = await B5dCreateAsync(coach, new(null, null, content));
        Assert.IsEmpty(await ReadSliceAsync<RecipeDraftSummary[]>(owner, B5dDraftsUrl));
        await AssertStatusAsync(await owner.GetAsync(B5dDraftUrl(started.Id)), HttpStatusCode.NotFound);
        await AssertStatusAsync(await B5dPutAsync(owner, started.Id, started.Version, content), HttpStatusCode.NotFound);
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync(B5dPublishUrl(started.Id), new PublishRecipeDraftRequest(started.Version, false)),
            HttpStatusCode.NotFound);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync(B5dDiscardUrl(started.Id), new DiscardRecipeDraftRequest(started.Version)),
            HttpStatusCode.NotFound);

        // A client keeps no drafts and reads no recipes, and nobody signed out reaches one.
        using var client = CreateClient();
        await R31InviteAsync(owner, client, tenant, "b5d-scope-maya@example.test", "Maya", "Rahman");
        await AssertStatusAsync(await client.GetAsync(B5dDraftsUrl), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await client.GetAsync(B5dDraftUrl(started.Id)), HttpStatusCode.Forbidden);
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync(B5dDraftsUrl, new CreateRecipeDraftRequest(null, null, content), SliceReadJson),
            HttpStatusCode.Forbidden);
        using var anonymous = CreateClient();
        SetTenant(anonymous, tenant);
        await AssertStatusAsync(await anonymous.GetAsync(B5dDraftUrl(started.Id)), HttpStatusCode.Unauthorized);

        // Published by the coach: the workspace's recipe, which the team now sees.
        var recipe = await B5dPublishAsync(coach, started.Id, started.Version);
        Assert.AreEqual(recipe.Id, (await ReadSliceAsync<RecipePage>(owner, R44bRecipesUrl)).Items.Single().Id);
        Assert.IsNull((await ReadSliceAsync<RecipeDetail>(owner, R44bRecipeUrl(recipe.Id))).Draft);

        // The owner's own changes to it are theirs alone: the coach's read shows no draft.
        await B5dCreateAsync(owner, new(recipe.Id, 1, content with { Name = "Owner's oats" }));
        Assert.IsNull((await ReadSliceAsync<RecipeDetail>(coach, R44bRecipeUrl(recipe.Id))).Draft);
        Assert.IsNull((await ReadSliceAsync<RecipePage>(coach, R44bRecipesUrl)).Items.Single().Draft);

        // Another workspace is refused this one and finds nothing of it in its own.
        using var stranger = CreateClient();
        var strangerTenant = await RegisterCoachAsync(stranger, "b5d-scope-stranger@example.test", "Other Owner", "B5d Elsewhere");
        SetTenant(stranger, tenant);
        await AssertStatusAsync(await stranger.GetAsync(B5dDraftsUrl), HttpStatusCode.Forbidden);
        SetTenant(stranger, strangerTenant);
        await AssertStatusAsync(await stranger.GetAsync(B5dDraftUrl(started.Id)), HttpStatusCode.NotFound);

        // Nor does it start changes to this workspace's recipe, or use or learn this workspace's foods.
        await RefreshCsrfAsync(stranger);
        await AssertStatusAsync(
            await stranger.PostAsJsonAsync(B5dDraftsUrl, new CreateRecipeDraftRequest(recipe.Id, 1, content), SliceReadJson),
            HttpStatusCode.NotFound);
        var borrowed = await B5dCreateAsync(stranger, new(null, null, content));
        Assert.IsEmpty((await ReadSliceAsync<RecipeDraftView>(stranger, B5dDraftUrl(borrowed.Id))).Foods);
        await B5dAssertPublishRefusedAsync(stranger, borrowed.Id, borrowed.Version, "ingredients");

        // A draft of a recipe starts at a revision the recipe really had; a new one names none.
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync(B5dDraftsUrl, new CreateRecipeDraftRequest(recipe.Id, 2, content), SliceReadJson),
            HttpStatusCode.BadRequest);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync(B5dDraftsUrl, new CreateRecipeDraftRequest(null, 1, content), SliceReadJson),
            HttpStatusCode.BadRequest);
    }

    [TestMethod]
    public async Task B5dTwoTabsNeitherStartTwoRecipeDraftsNorOverwriteAndANewerVersionIsAskedAbout()
    {
        using var owner = CreateClient();
        await RegisterCoachAsync(owner, "b5d-tabs-owner@example.test", "Hicham Haddad", "B5d Tabs");
        using var coach = CreateClient();
        await JoinAsCoachAsync(owner, coach, "b5d-tabs-coach@example.test", "Lina Saad");
        var oats = await R44bFoodAsync(owner, "Rolled oats", 13m, []);
        var yogurt = await R44bFoodAsync(owner, "Greek yogurt", 10m, []);
        var content = B5dContent(oats, yogurt);
        var seed = await B5dCreateAsync(owner, new(null, null, content));
        var recipe = await B5dPublishAsync(owner, seed.Id, seed.Version);

        // Two tabs start changes to one recipe at once: one draft, and the other is told to reload.
        await RefreshCsrfAsync(owner);
        var start = new CreateRecipeDraftRequest(recipe.Id, 1, content);
        var starts = await Task.WhenAll(
            owner.PostAsJsonAsync(B5dDraftsUrl, start, SliceReadJson),
            owner.PostAsJsonAsync(B5dDraftsUrl, start, SliceReadJson));
        CollectionAssert.AreEquivalent(R35cOneWins, starts.Select(response => response.StatusCode).ToArray());
        await B5dAssertConflictAsync(
            starts.Single(response => response.StatusCode == HttpStatusCode.Conflict),
            RecipeDraftConflictCodes.AlreadyExists);
        var draft = await ReadSlicePayloadAsync<RecipeDraftSaveView>(starts.Single(response => response.StatusCode == HttpStatusCode.OK));

        // Two saves from the same read: one lands, the other is refused rather than overwriting it.
        // The token is refreshed once, before both (see R42a).
        await RefreshCsrfAsync(owner);
        var saves = await Task.WhenAll(
            owner.PutAsJsonAsync(B5dDraftUrl(draft.Id), new SaveRecipeDraftRequest(content with { Servings = 3m }, draft.Version), SliceReadJson),
            owner.PutAsJsonAsync(B5dDraftUrl(draft.Id), new SaveRecipeDraftRequest(content with { Servings = 4m }, draft.Version), SliceReadJson));
        CollectionAssert.AreEquivalent(R35cOneWins, saves.Select(response => response.StatusCode).ToArray());
        await B5dAssertConflictAsync(saves.Single(response => response.StatusCode == HttpStatusCode.Conflict), RecipeDraftConflictCodes.Stale);
        var kept = await ReadSlicePayloadAsync<RecipeDraftSaveView>(saves.Single(response => response.StatusCode == HttpStatusCode.OK));

        // The coach saves a version in between; the owner is told before anything is replaced, and keeps
        // their changes. Publishing anyway makes theirs the newest, and the coach's stays in the history.
        var coachVersion = await R44bAddVersionAsync(coach, recipe.Id, new AddRecipeVersionRequest(
            "Coach's method.", 1m, [R44bLine(oats, 60m)], Publish: true, BaseRevision: 1));
        Assert.AreEqual(2, coachVersion.Revision);
        await RefreshCsrfAsync(owner);
        await B5dAssertConflictAsync(
            await owner.PostAsJsonAsync(B5dPublishUrl(draft.Id), new PublishRecipeDraftRequest(kept.Version, false)),
            RecipeDraftConflictCodes.NewerVersionSaved);
        await AssertStatusAsync(await owner.GetAsync(B5dDraftUrl(draft.Id)), HttpStatusCode.OK);
        var newest = await B5dPublishAsync(owner, draft.Id, kept.Version, replaceNewer: true);
        Assert.AreEqual(3, newest.Revision);
        var after = await ReadSliceAsync<RecipeDetail>(owner, R44bRecipeUrl(recipe.Id));
        Assert.AreEqual((3, (Guid?)newest.VersionId), (after.CurrentRevision, after.PublishedVersionId));

        // Discarding from an older read is refused; from the newest it leaves the recipe as it was.
        var again = await B5dCreateAsync(owner, new(recipe.Id, 3, content));
        var moved = await B5dSaveAsync(owner, again.Id, again.Version, content with { Name = "Moved on" });
        await RefreshCsrfAsync(owner);
        await B5dAssertConflictAsync(
            await owner.PostAsJsonAsync(B5dDiscardUrl(again.Id), new DiscardRecipeDraftRequest(again.Version)),
            RecipeDraftConflictCodes.Stale);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync(B5dDiscardUrl(again.Id), new DiscardRecipeDraftRequest(moved.Version)),
            HttpStatusCode.NoContent);
        var left = await ReadSliceAsync<RecipeDetail>(owner, R44bRecipeUrl(recipe.Id));
        Assert.AreEqual((3, (RecipeDraftSummary?)null, recipe.Name), (left.CurrentRevision, left.Draft, left.Name));
    }

    [TestMethod]
    public async Task B5dARecipeDraftIsBoundedInShapeAndNumberButNotInItsValues()
    {
        using var owner = CreateClient();
        await RegisterCoachAsync(owner, "b5d-limits-owner@example.test", "Hicham Haddad", "B5d Limits");
        var oats = await R44bFoodAsync(owner, "Rolled oats", 13m, []);
        var yogurt = await R44bFoodAsync(owner, "Greek yogurt", 10m, []);
        var content = B5dContent(oats, yogurt);

        // What a version could never hold is refused, by field.
        await B5dAssertInvalidAsync(owner, content with { Lines = [.. Enumerable.Repeat(new RecipeDraftLine(oats.VersionId, 1m), 501)] }, "lines");
        await B5dAssertInvalidAsync(owner, content with { Lines = [new RecipeDraftLine(Guid.Empty, 1m)] }, "lines");
        await B5dAssertInvalidAsync(owner, content with { Instructions = new string('m', 20_001) }, "instructions");
        // A NUL is refused where the request is read, under its path in the body (audit SEC-2).
        await B5dAssertInvalidAsync(owner, content with { Name = "Bad\0name" }, "content.name");
        await B5dAssertInvalidAsync(owner, content with { PhotoMediaAssetId = Guid.NewGuid() }, "photoMediaAssetId");
        await B5dAssertInvalidAsync(owner, content with { AiMealDraftOperationId = Guid.NewGuid() }, "aiMealDraftOperationId");

        // At most twenty new recipes per coach, even when two starts race for the last place.
        for (var count = 0; count < RecipeDraft.MaximumNewRecipesPerOwner - 1; count++)
        {
            await B5dCreateAsync(owner, new(null, null, content));
        }

        await RefreshCsrfAsync(owner);
        var fresh = new CreateRecipeDraftRequest(null, null, content);
        var racing = await Task.WhenAll(
            owner.PostAsJsonAsync(B5dDraftsUrl, fresh, SliceReadJson),
            owner.PostAsJsonAsync(B5dDraftsUrl, fresh, SliceReadJson));
        CollectionAssert.AreEquivalent(R35cOneWins, racing.Select(response => response.StatusCode).ToArray());
        await B5dAssertConflictAsync(
            racing.Single(response => response.StatusCode == HttpStatusCode.Conflict),
            RecipeDraftConflictCodes.LimitReached);
        var drafts = await ReadSliceAsync<RecipeDraftSummary[]>(owner, B5dDraftsUrl);
        Assert.HasCount(RecipeDraft.MaximumNewRecipesPerOwner, drafts);

        // The list's search reads every word of the name, as the Recipes page's does.
        var named = await B5dSaveAsync(owner, drafts[0].Id, (await ReadSliceAsync<RecipeDraftView>(owner, B5dDraftUrl(drafts[0].Id))).Version, content with { Name = "Chicken & rice bowl" });
        Assert.AreEqual(drafts[0].Id, (await ReadSliceAsync<RecipeDraftSummary[]>(owner, $"{B5dDraftsUrl}?query=rice%20chicken")).Single().Id);

        // Making one a version makes room; changes to a saved recipe never count against it.
        var recipe = await B5dPublishAsync(owner, drafts[0].Id, named.Version);
        await B5dCreateAsync(owner, new(recipe.Id, 1, content));
        await B5dCreateAsync(owner, new(null, null, content));
    }

    [TestMethod]
    public async Task B5dAiSuggestionsStartANewRecipesDraftAndAreApprovedOnce()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "b5d-ai@example.test", "AI Coach", "B5d AI");
        await SetLaunchAiBudgetAsync(coach, 10, 10m);
        var oats = await R44bFoodAsync(coach, "Rolled oats", 13m, []);
        var yogurt = await R44bFoodAsync(coach, "Greek yogurt", 10m, []);

        // The suggestion starts the draft: its ingredient waits for a food, and the draft names it.
        var suggestion = await R44bSuggestAsync(coach);
        var waiting = new RecipeDraftContent(
            "Oat bowl",
            1m,
            null,
            [new RecipeDraftLine(null, null, Suggestion: new RecipeDraftSuggestion("oats", 100m, "g", true))],
            AiMealDraftOperationId: suggestion);
        var started = await B5dCreateAsync(coach, new(null, null, waiting));
        Assert.AreEqual((Guid?)suggestion, (await ReadSliceAsync<RecipeDraftView>(coach, B5dDraftUrl(started.Id))).Content.AiMealDraftOperationId);
        await B5dAssertPublishRefusedAsync(coach, started.Id, started.Version, "ingredients");

        // Matched and published: the recipe is made and the suggestion approved in the same save.
        var matched = await B5dSaveAsync(coach, started.Id, started.Version, B5dContent(oats, yogurt) with { Name = "Oat bowl", AiMealDraftOperationId = suggestion });
        var recipe = await B5dPublishAsync(coach, started.Id, matched.Version);
        Assert.AreEqual(("Oat bowl", PublicationStatus.Published), (recipe.Name, recipe.Status));
        await B5dAssertSuggestionReviewedAsync(coach, suggestion);

        // A suggestion is reviewed once (BEA-7): a second draft carrying it makes no second recipe.
        var twice = await B5dCreateAsync(coach, new(null, null, B5dContent(oats, yogurt) with { Name = "Oat bowl again", AiMealDraftOperationId = suggestion }));
        await RefreshCsrfAsync(coach);
        var refused = await coach.PostAsJsonAsync(B5dPublishUrl(twice.Id), new PublishRecipeDraftRequest(twice.Version, false));
        await AssertStatusAsync(refused, HttpStatusCode.Conflict);
        StringAssert.Contains(await refused.Content.ReadAsStringAsync(), "ai_review_conflict");
        Assert.AreEqual(1, (await ReadSliceAsync<RecipePage>(coach, R44bRecipesUrl)).Total);

        // A suggestion turned down since leaves the recipe the coach's own lines, and stays turned down.
        var other = await R44bSuggestAsync(coach);
        var dropped = await B5dCreateAsync(coach, new(null, null, B5dContent(oats, yogurt) with { Name = "Own bowl", AiMealDraftOperationId = other }));
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync($"/api/nutrition/ai-drafts/{other}/review", new ReviewAiMealDraftRequest(false, "Coach turned the suggestion down.", null, null, null, []), SliceReadJson),
            HttpStatusCode.OK);
        Assert.AreEqual(PublicationStatus.Draft, (await B5dPublishAsync(coach, dropped.Id, dropped.Version, keepAsDraft: true)).Status);
        await B5dAssertSuggestionReviewedAsync(coach, other);

        // Only a new recipe starts from a suggestion, and only from one of this workspace.
        var third = await R44bSuggestAsync(coach);
        await RefreshCsrfAsync(coach);
        var onRecipe = await coach.PostAsJsonAsync(B5dDraftsUrl, new CreateRecipeDraftRequest(recipe.Id, 1, B5dContent(oats, yogurt) with { AiMealDraftOperationId = third }), SliceReadJson);
        await B5dAssertFieldAsync(onRecipe, "aiMealDraftOperationId");
        using var stranger = CreateClient();
        await RegisterCoachAsync(stranger, "b5d-ai-stranger@example.test", "Other Owner", "B5d AI Elsewhere");
        await RefreshCsrfAsync(stranger);
        var borrowed = await stranger.PostAsJsonAsync(B5dDraftsUrl, new CreateRecipeDraftRequest(null, null, new RecipeDraftContent("Theirs", 1m, null, [], AiMealDraftOperationId: third)), SliceReadJson);
        await B5dAssertFieldAsync(borrowed, "aiMealDraftOperationId");
    }

    [TestMethod]
    public async Task B5dADraftKeepsItsPhotoPastTheUnusedPhotoSweep()
    {
        using var owner = CreateClient();
        await RegisterCoachAsync(owner, "b5d-photo-owner@example.test", "Hicham Haddad", "B5d Photos");
        using var coach = CreateClient();
        await JoinAsCoachAsync(owner, coach, "b5d-photo-coach@example.test", "Lina Saad");
        var oats = await R44bFoodAsync(owner, "Rolled oats", 13m, []);
        var yogurt = await R44bFoodAsync(owner, "Greek yogurt", 10m, []);
        var uploadedAt = DateTimeOffset.UtcNow;
        RequiredTestClock.Set(uploadedAt);
        var named = await R44bUploadPhotoAsync(owner);
        var unnamed = await R44bUploadPhotoAsync(owner);
        var draft = await B5dCreateAsync(owner, new(null, null, B5dContent(oats, yogurt) with { PhotoMediaAssetId = named }));
        Assert.AreEqual((Guid?)named, (await ReadSliceAsync<RecipeDraftSummary[]>(owner, B5dDraftsUrl)).Single().PhotoMediaAssetId);

        // Another coach cannot put the owner's upload in a draft of theirs.
        await B5dAssertFieldAsync(
            await B5dPostAsync(coach, new CreateRecipeDraftRequest(null, null, B5dContent(oats, yogurt) with { PhotoMediaAssetId = unnamed })),
            "photoMediaAssetId");

        // At 48 hours the upload nothing names goes; the one the draft names stays.
        RequiredTestClock.Set(uploadedAt.AddHours(48));
        Assert.AreEqual(1, await R44dRetireUnusedRecipePhotosAsync());
        CollectionAssert.AreEquivalent(
            new[] { (named, "Ready"), (unnamed, "Tombstoned") },
            await R44dAssetStatusesAsync(named, unnamed));

        // An old upload no version or draft names cannot be named now; the draft's own keeps being saved
        // with it and becomes the version's photo.
        var late = await B5dCreateAsync(owner, new(null, null, B5dContent(oats, yogurt) with { Name = "Second bowl" }));
        await B5dAssertFieldAsync(await B5dPutAsync(owner, late.Id, late.Version, B5dContent(oats, yogurt) with { PhotoMediaAssetId = unnamed }), "photoMediaAssetId");
        RequiredTestClock.Set(uploadedAt.AddHours(50));
        var saved = await B5dSaveAsync(owner, draft.Id, draft.Version, B5dContent(oats, yogurt) with { Name = "Photo bowl", PhotoMediaAssetId = named });
        var recipe = await B5dPublishAsync(owner, draft.Id, saved.Version);
        Assert.AreEqual((Guid?)named, recipe.PhotoMediaAssetId);
        RequiredTestClock.Set(uploadedAt.AddHours(96));
        Assert.AreEqual(0, await R44dRetireUnusedRecipePhotosAsync());
    }

    /// <summary>
    /// A complete recipe: two servings of rolled oats and Greek yogurt, with its times and method, each
    /// line in grams of a prepared food.
    /// </summary>
    private static RecipeDraftContent B5dContent(R44bFood oats, R44bFood yogurt, decimal yogurtGrams = 150m) =>
        new(
            "Overnight oats",
            2m,
            "  Soak overnight, then stir.  ",
            [new RecipeDraftLine(oats.VersionId, 80m), new RecipeDraftLine(yogurt.VersionId, yogurtGrams)],
            PrepMinutes: 10m,
            CookMinutes: 5m);

    private static async Task<HttpResponseMessage> B5dPostAsync(HttpClient coach, CreateRecipeDraftRequest request)
    {
        await RefreshCsrfAsync(coach);
        return await coach.PostAsJsonAsync(B5dDraftsUrl, request, SliceReadJson);
    }

    private static async Task<RecipeDraftSaveView> B5dCreateAsync(HttpClient coach, CreateRecipeDraftRequest request)
    {
        var response = await B5dPostAsync(coach, request);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<RecipeDraftSaveView>(response);
    }

    private static async Task<HttpResponseMessage> B5dPutAsync(HttpClient coach, Guid draftId, uint version, RecipeDraftContent content)
    {
        await RefreshCsrfAsync(coach);
        return await coach.PutAsJsonAsync(B5dDraftUrl(draftId), new SaveRecipeDraftRequest(content, version), SliceReadJson);
    }

    private static async Task<RecipeDraftSaveView> B5dSaveAsync(HttpClient coach, Guid draftId, uint version, RecipeDraftContent content)
    {
        var response = await B5dPutAsync(coach, draftId, version, content);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<RecipeDraftSaveView>(response);
    }

    private static async Task<RecipeSummary> B5dPublishAsync(HttpClient coach, Guid draftId, uint version, bool replaceNewer = false, bool keepAsDraft = false)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync(B5dPublishUrl(draftId), new PublishRecipeDraftRequest(version, replaceNewer, keepAsDraft));
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<RecipeSummary>(response);
    }

    private static async Task B5dAssertPublishRefusedAsync(HttpClient coach, Guid draftId, uint version, string field)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync(B5dPublishUrl(draftId), new PublishRecipeDraftRequest(version, false));
        await B5dAssertFieldAsync(response, field);
        await AssertStatusAsync(await coach.GetAsync(B5dDraftUrl(draftId)), HttpStatusCode.OK);
    }

    private static async Task B5dAssertInvalidAsync(HttpClient coach, RecipeDraftContent content, string field) =>
        await B5dAssertFieldAsync(await B5dPostAsync(coach, new CreateRecipeDraftRequest(null, null, content)), field);

    private static async Task B5dAssertFieldAsync(HttpResponseMessage response, string field)
    {
        await AssertStatusAsync(response, HttpStatusCode.BadRequest);
        var problem = await RequiredJsonAsync<R42aValidationProblem>(response);
        Assert.IsTrue(problem.Errors.ContainsKey(field), $"Expected an error on '{field}': {string.Join(", ", problem.Errors.Keys)}");
    }

    private static async Task B5dAssertConflictAsync(HttpResponseMessage response, string code)
    {
        await AssertStatusAsync(response, HttpStatusCode.Conflict);
        Assert.AreEqual(code, (await RequiredJsonAsync<R42aConflict>(response)).Code);
    }

    /// <summary>A suggestion already reviewed refuses another review (BEA-7), whichever way it went.</summary>
    private static async Task B5dAssertSuggestionReviewedAsync(HttpClient coach, Guid operationId)
    {
        await RefreshCsrfAsync(coach);
        var again = await coach.PostAsJsonAsync($"/api/nutrition/ai-drafts/{operationId}/review", new ReviewAiMealDraftRequest(false, "Once more.", null, null, null, []), SliceReadJson);
        await AssertStatusAsync(again, HttpStatusCode.Conflict);
        StringAssert.Contains(await again.Content.ReadAsStringAsync(), "ai_review_conflict");
    }
}
