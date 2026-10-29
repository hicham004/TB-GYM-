using Microsoft.EntityFrameworkCore;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Nutrition;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// The recipe editor's working copies (NUT-014, critique B5d): each coach's own drafts, kept as the editor
/// sends them and checked in full only when they become a version, as the builders keep theirs (ADR 0033).
/// </summary>
/// <remarks>
/// Every draft read and write is narrowed to the signed-in caller inside the active workspace, so another
/// person's draft, in this workspace or another, is simply not found. Recipe text stays out of logs and
/// exception messages. The references a draft keeps beside its content, its photo and the AI suggestion it
/// began from, are checked on every save, since they are this workspace's rows.
/// </remarks>
internal sealed partial class NutritionApplicationService
{
    private const long RecipeDraftLockNamespace = 0x4e55_b5d0;

    public async Task<IReadOnlyList<RecipeDraftSummary>> ListRecipeDraftsAsync(string? query, CancellationToken cancellationToken)
    {
        if (currentUser.UserId is not { } userId || !tenantContext.HasTenant)
        {
            return [];
        }

        var drafts = dbContext.RecipeDrafts.AsNoTracking().Where(draft => draft.OwnerUserId == userId);
        foreach (var pattern in LikePattern.EachWord(query))
        {
            drafts = drafts.Where(draft => EF.Functions.ILike(draft.Name, pattern, LikePattern.EscapeCharacter));
        }

        // The content can run long, so the list reads only what it shows.
        return await drafts
            .OrderByDescending(draft => draft.UpdatedAtUtc)
            .ThenBy(draft => draft.Id)
            .Select(draft => new RecipeDraftSummary(
                draft.Id,
                draft.RecipeId,
                draft.Name,
                draft.LineCount,
                draft.PhotoMediaAssetId,
                draft.UpdatedAtUtc))
            .ToListAsync(cancellationToken);
    }

    public async Task<RecipeDraftView?> GetRecipeDraftAsync(Guid draftId, CancellationToken cancellationToken)
    {
        if (await FindOwnRecipeDraftAsync(draftId, tracked: false, cancellationToken) is not { } draft)
        {
            return null;
        }

        var content = RecipeDraftShape.Read(draft.ContentJson);
        var lines = content.Lines ?? [];
        var foods = await RecipeDraftFoodsAsync(lines.Select(line => line.FoodItemVersionId).OfType<Guid>(), cancellationToken);
        var factorIds = lines
            .SelectMany(line => new[] { line.YieldFactorId, line.RetentionFactorId })
            .OfType<Guid>()
            .Distinct()
            .ToArray();
        CookingFactorView[] factors = factorIds.Length == 0
            ? []
            : (await dbContext.CookingFactorRecords.AsNoTracking()
                    .Where(item => factorIds.Contains(item.Id))
                    .ToListAsync(cancellationToken))
                .Select(ToCookingFactorView)
                .ToArray();
        return new RecipeDraftView(
            draft.Id,
            draft.RecipeId,
            draft.StartedAtRevision,
            draft.UpdatedAtUtc,
            draft.Version,
            content,
            foods,
            factors);
    }

    public async Task<NutritionCommandResult> CreateRecipeDraftAsync(CreateRecipeDraftRequest request, CancellationToken cancellationToken)
    {
        if (currentUser.UserId is not { } userId || !tenantContext.HasTenant)
        {
            return NotFound();
        }

        if (!RecipeDraftShape.TryCreate(request?.Content, out var shape, out var field, out var problem))
        {
            return Invalid(field, problem);
        }

        return request!.RecipeId is { } recipeId
            ? await CreateDraftOfRecipeAsync(userId, recipeId, request, shape, cancellationToken)
            : request.RecipeRevision is not null
                ? Invalid("recipeId", "A new recipe has no versions to start from.")
                : await CreateDraftOfNewRecipeAsync(userId, shape, cancellationToken);
    }

    public async Task<NutritionCommandResult> SaveRecipeDraftAsync(Guid draftId, SaveRecipeDraftRequest request, CancellationToken cancellationToken)
    {
        // Found before the content is read, so a stranger's identifier answers the same whatever it is
        // sent with.
        if (await FindOwnRecipeDraftAsync(draftId, tracked: true, cancellationToken) is not { } draft)
        {
            return NotFound();
        }

        if (!RecipeDraftShape.TryCreate(request?.Content, out var shape, out var field, out var problem))
        {
            return Invalid(field, problem);
        }

        if (await RecipeDraftReferencesRefusalAsync(draft.RecipeId, draft.PhotoMediaAssetId, shape, cancellationToken) is { } refusal)
        {
            return refusal;
        }

        dbContext.Entry(draft).Property(item => item.Version).OriginalValue = request!.Version;
        draft.Replace(shape);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return StaleRecipeDraft();
        }

        return RecipeDraftSaved(draft);
    }

    public async Task<NutritionCommandResult> DiscardRecipeDraftAsync(Guid draftId, DiscardRecipeDraftRequest request, CancellationToken cancellationToken)
    {
        if (await FindOwnRecipeDraftAsync(draftId, tracked: true, cancellationToken) is not { } draft)
        {
            return NotFound();
        }

        // Unsaved changes, not a record: removing them leaves nothing behind. The version still guards
        // against discarding changes another tab has just made. A suggestion it carried stays awaiting
        // review, as one never saved does.
        dbContext.Entry(draft).Property(item => item.Version).OriginalValue = request?.Version ?? 0;
        dbContext.RecipeDrafts.Remove(draft);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return StaleRecipeDraft();
        }

        return new NutritionCommandResult(NutritionCommandStatus.Success);
    }

    public async Task<NutritionCommandResult> PublishRecipeDraftAsync(Guid draftId, PublishRecipeDraftRequest request, CancellationToken cancellationToken)
    {
        if (await FindOwnRecipeDraftAsync(draftId, tracked: true, cancellationToken) is not { } draft)
        {
            return NotFound();
        }

        if (request is null || draft.Version != request.Version)
        {
            return StaleRecipeDraft();
        }

        Recipe? existing = null;
        if (draft.RecipeId is { } recipeId)
        {
            existing = await dbContext.Recipes.SingleOrDefaultAsync(item => item.Id == recipeId, cancellationToken);
            if (existing is null)
            {
                return NotFound();
            }

            if (draft.IsBehind(existing.CurrentRevision) && !request.ReplaceNewer)
            {
                return NewerRecipeVersionSaved(existing.CurrentRevision);
            }
        }

        var content = RecipeDraftShape.Read(draft.ContentJson);
        var lines = content.Lines ?? [];
        var versionIds = lines.Select(line => line.FoodItemVersionId).OfType<Guid>().Distinct().ToArray();
        var foods = await (
            from version in dbContext.FoodItemVersions.AsNoTracking()
            join food in dbContext.FoodItems.AsNoTracking()
                on new { version.TenantId, Id = version.FoodItemId } equals new { food.TenantId, food.Id }
            where versionIds.Contains(version.Id)
            select new DraftLineFood(version.Id, food.Name, version.BasisUnit, version.PreparationBasis))
            .ToDictionaryAsync(item => item.VersionId, cancellationToken);
        if (RecipePublishRefusal(content, foods) is { } refusal)
        {
            return refusal;
        }

        // A suggestion still awaiting review is approved by this save, once (BEA-7); one turned down since is
        // left as it is, and the recipe is the coach's own lines, each a food they chose (NUT-004).
        AiMealDraftOperation? suggestion = null;
        if (draft.AiMealDraftOperationId is { } operationId)
        {
            suggestion = await dbContext.AiMealDraftOperations.SingleOrDefaultAsync(item => item.Id == operationId, cancellationToken);
            if (suggestion?.Status == AiDraftStatus.Approved)
            {
                return AiReviewedElsewhere();
            }

            if (suggestion?.Status != AiDraftStatus.AwaitingCoachReview)
            {
                suggestion = null;
            }
        }

        try
        {
            await EnsureRecipePhotoAsync(content.PhotoMediaAssetId, existing?.Id, cancellationToken);
            var inputs = await BuildRecipeIngredientsAsync(DraftIngredientRequests(lines, foods), cancellationToken);
            var name = content.Name!.Trim();
            var recipe = existing ?? Recipe.Create(tenantContext.TenantId, name);
            if (existing is not null && !string.Equals(existing.Name, name, StringComparison.Ordinal))
            {
                existing.Rename(name);
            }

            var version = recipe.AddDraft(
                content.Instructions!,
                content.Servings!.Value,
                inputs,
                content.PhotoMediaAssetId,
                (int?)content.PrepMinutes,
                (int?)content.CookMinutes);
            if (!request.KeepAsDraft)
            {
                version.Publish(clock.UtcNow, RequireUserId());
            }

            // Added explicitly, with every line under it: keys are made here, so rows found only through a
            // navigation could be taken for rows already stored.
            if (existing is null)
            {
                dbContext.Recipes.Add(recipe);
            }
            else
            {
                dbContext.RecipeVersions.Add(version);
            }

            suggestion?.Review(true, RequireUserId(), clock.UtcNow);
            dbContext.Entry(draft).Property(item => item.Version).OriginalValue = request.Version;
            dbContext.RecipeDrafts.Remove(draft);
            // One save, one transaction: the version lands, the suggestion is approved and the draft goes,
            // or none of them.
            await dbContext.SaveChangesAsync(cancellationToken);
            var publishedVersionId = !request.KeepAsDraft
                ? version.Id
                : await dbContext.RecipeVersions.AsNoTracking()
                    .Where(item => item.RecipeId == recipe.Id && item.Status == PublicationStatus.Published)
                    .OrderByDescending(item => item.Revision)
                    .Select(item => (Guid?)item.Id)
                    .FirstOrDefaultAsync(cancellationToken);
            return new NutritionCommandResult(NutritionCommandStatus.Success, Recipe: ToRecipeSummary(recipe, version, publishedVersionId));
        }
        catch (NutritionInputException exception)
        {
            return Invalid(exception.Field, exception.PersonMessage());
        }
        catch (ArgumentException exception)
        {
            return Invalid("recipe", exception.PersonMessage());
        }
        catch (DbUpdateConcurrencyException exception)
        {
            // The draft changed in another tab, the suggestion was reviewed elsewhere, or someone saved this
            // recipe in the same moment.
            return exception.Entries.Any(entry => entry.Entity is RecipeDraft)
                ? StaleRecipeDraft()
                : exception.Entries.Any(entry => entry.Entity is AiMealDraftOperation)
                    ? AiReviewedElsewhere()
                    : NewerRecipeVersionSaved(null);
        }
        catch (DbUpdateException exception) when (IsRecipeRevisionRace(exception))
        {
            return NewerRecipeVersionSaved(null);
        }
    }

    /// <summary>
    /// What would stop the draft from becoming a version, said the way the editor reads top to bottom: the
    /// name, the servings, each ingredient, the times and the method. Null when every rule is met that the
    /// content alone can show; the foods, conversions and photo are checked as any save checks them.
    /// </summary>
    private static NutritionCommandResult? RecipePublishRefusal(RecipeDraftContent content, Dictionary<Guid, DraftLineFood> foods)
    {
        var name = content.Name?.Trim() ?? string.Empty;
        if (name.Length == 0)
        {
            return Invalid("name", "Give the recipe a name before publishing it.");
        }

        if (content.Servings is not (> 0m and <= 10_000m))
        {
            return Invalid("servings", "Say how many servings the recipe makes: more than 0 and at most 10,000.");
        }

        var lines = content.Lines ?? [];
        if (lines.Count == 0)
        {
            return Invalid("ingredients", "Add at least one ingredient.");
        }

        for (var index = 0; index < lines.Count; index++)
        {
            var line = lines[index];
            if (line.FoodItemVersionId is not { } versionId)
            {
                return Invalid("ingredients", line.Suggestion?.Name?.Trim() is { Length: > 0 } suggested
                    ? $"Choose a food for “{suggested}”, or remove it."
                    : $"Ingredient {index + 1} has no food yet. Choose one, or remove it.");
            }

            if (line.Quantity is not (> 0m and <= 1_000_000m))
            {
                return Invalid("ingredients", foods.TryGetValue(versionId, out var food)
                    ? $"Give “{food.Name}” an amount above 0, up to 1,000,000."
                    : $"Give ingredient {index + 1} an amount above 0, up to 1,000,000.");
            }
        }

        foreach (var (field, what, minutes) in new[] { ("prepMinutes", "prep", content.PrepMinutes), ("cookMinutes", "cook", content.CookMinutes) })
        {
            if (minutes is { } value && (value < 0m || value > RecipeVersion.MaximumMinutes || value != decimal.Truncate(value)))
            {
                return Invalid(field, $"Give the {what} time in whole minutes, up to 2,880 (two days).");
            }
        }

        if (string.IsNullOrWhiteSpace(content.Instructions))
        {
            return Invalid("instructions", "Add a few words on how to make it before publishing it.");
        }

        return null;
    }

    /// <summary>
    /// The lines as a save takes them. The editor measures every line in its food's own unit and weighs only
    /// a raw food cooked, so the unit and the basis come from the food version and the conversion it names.
    /// </summary>
    private static RecipeIngredientRequest[] DraftIngredientRequests(IReadOnlyList<RecipeDraftLine> lines, Dictionary<Guid, DraftLineFood> foods) =>
        lines.Select(line =>
        {
            var food = foods.GetValueOrDefault(line.FoodItemVersionId!.Value);
            var cooked = line.YieldFactorId is not null || line.RetentionFactorId is not null;
            return new RecipeIngredientRequest(
                line.FoodItemVersionId.Value,
                line.Quantity!.Value,
                food?.Unit ?? FoodQuantityUnit.Gram,
                cooked ? PreparationBasis.Cooked : food?.Basis ?? PreparationBasis.Raw,
                line.YieldFactorId,
                line.RetentionFactorId);
        }).ToArray();

    /// <summary>
    /// The rows a draft names beside its content, which must be this workspace's: the AI suggestion, for a
    /// new recipe only, and a photo newly named, which may be named only as a version may name it (MED-014).
    /// </summary>
    private async Task<NutritionCommandResult?> RecipeDraftReferencesRefusalAsync(
        Guid? recipeId,
        Guid? namedPhoto,
        RecipeDraftShape shape,
        CancellationToken cancellationToken)
    {
        if (shape.AiMealDraftOperationId is { } operationId)
        {
            if (recipeId is not null)
            {
                return Invalid("aiMealDraftOperationId", "Only a new recipe starts from an AI suggestion.");
            }

            if (!await dbContext.AiMealDraftOperations.AsNoTracking().AnyAsync(item => item.Id == operationId, cancellationToken))
            {
                return Invalid("aiMealDraftOperationId", "The suggestion this recipe started from is not in this coaching space.");
            }
        }

        if (shape.PhotoMediaAssetId is { } photo && photo != namedPhoto)
        {
            try
            {
                await EnsureRecipePhotoAsync(photo, recipeId, cancellationToken);
            }
            catch (NutritionInputException exception)
            {
                return Invalid(exception.Field, exception.PersonMessage());
            }
        }

        return null;
    }

    private async Task<NutritionCommandResult> CreateDraftOfRecipeAsync(
        Guid userId,
        Guid recipeId,
        CreateRecipeDraftRequest request,
        RecipeDraftShape shape,
        CancellationToken cancellationToken)
    {
        var recipe = await dbContext.Recipes.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == recipeId, cancellationToken);
        if (recipe is null)
        {
            return NotFound();
        }

        if (request.RecipeRevision is not { } seen || seen < 1 || seen > recipe.CurrentRevision)
        {
            return Invalid("recipeRevision", "The recipe's newest revision, as read, is required.");
        }

        if (await RecipeDraftReferencesRefusalAsync(recipeId, null, shape, cancellationToken) is { } refusal)
        {
            return refusal;
        }

        var draft = RecipeDraft.ForRecipe(tenantContext.TenantId, userId, recipeId, seen, shape);
        dbContext.RecipeDrafts.Add(draft);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (IsOneDraftPerRecipeViolation(exception))
        {
            return Conflict(
                RecipeDraftConflictCodes.AlreadyExists,
                "Changes to this recipe are already open in another tab or device. Reload to continue them.");
        }

        return RecipeDraftSaved(draft);
    }

    private async Task<NutritionCommandResult> CreateDraftOfNewRecipeAsync(
        Guid userId,
        RecipeDraftShape shape,
        CancellationToken cancellationToken)
    {
        if (await RecipeDraftReferencesRefusalAsync(null, null, shape, cancellationToken) is { } refusal)
        {
            return refusal;
        }

        return await dbContext.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            dbContext.ChangeTracker.Clear();
            await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
            // One start at a time per person, so two quick starts cannot both slip under the limit.
            await dbContext.Database.ExecuteSqlAsync(
                $"SELECT pg_advisory_xact_lock({RecipeDraftLockKey(tenantContext.TenantId, userId)}) /* recipe-drafts */",
                cancellationToken);
            var kept = await dbContext.RecipeDrafts.CountAsync(
                draft => draft.OwnerUserId == userId && draft.RecipeId == null,
                cancellationToken);
            if (kept >= RecipeDraft.MaximumNewRecipesPerOwner)
            {
                await transaction.RollbackAsync(cancellationToken);
                return Conflict(
                    RecipeDraftConflictCodes.LimitReached,
                    $"You can keep up to {RecipeDraft.MaximumNewRecipesPerOwner} new recipes that are not saved yet. Publish or discard one to start another.");
            }

            var draft = RecipeDraft.ForNewRecipe(tenantContext.TenantId, userId, shape);
            dbContext.RecipeDrafts.Add(draft);
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return RecipeDraftSaved(draft);
        });
    }

    private async Task<RecipeDraft?> FindOwnRecipeDraftAsync(Guid draftId, bool tracked, CancellationToken cancellationToken)
    {
        if (currentUser.UserId is not { } userId || !tenantContext.HasTenant)
        {
            return null;
        }

        var drafts = tracked ? dbContext.RecipeDrafts : dbContext.RecipeDrafts.AsNoTracking();
        return await drafts.SingleOrDefaultAsync(
            draft => draft.Id == draftId && draft.OwnerUserId == userId,
            cancellationToken);
    }

    /// <summary>The caller's own drafts of these recipes, by recipe, for the recipe reads.</summary>
    private async Task<Dictionary<Guid, RecipeDraftSummary>> OwnDraftsByRecipeAsync(
        Guid[] recipeIds,
        CancellationToken cancellationToken)
    {
        if (currentUser.UserId is not { } userId || !tenantContext.HasTenant || recipeIds.Length == 0)
        {
            return [];
        }

        var drafts = await dbContext.RecipeDrafts.AsNoTracking()
            .Where(draft => draft.OwnerUserId == userId &&
                            draft.RecipeId != null &&
                            recipeIds.Contains(draft.RecipeId.Value))
            .Select(draft => new RecipeDraftSummary(
                draft.Id,
                draft.RecipeId,
                draft.Name,
                draft.LineCount,
                draft.PhotoMediaAssetId,
                draft.UpdatedAtUtc))
            .ToListAsync(cancellationToken);
        return drafts.ToDictionary(draft => draft.RecipeId!.Value);
    }

    /// <summary>
    /// The food versions a draft's lines name, as this workspace's foods have them, each under its food's
    /// name now and with the food now when it was edited since (NUT-001).
    /// </summary>
    private async Task<RecipeDraftFoodView[]> RecipeDraftFoodsAsync(IEnumerable<Guid> versionIds, CancellationToken cancellationToken)
    {
        var ids = versionIds.Distinct().ToArray();
        if (ids.Length == 0)
        {
            return [];
        }

        var versions = await dbContext.FoodItemVersions.AsNoTracking()
            .Where(item => ids.Contains(item.Id))
            .Include(item => item.Allergens)
            .ToListAsync(cancellationToken);
        var foodIds = versions.Select(item => item.FoodItemId).Distinct().ToArray();
        var foods = await dbContext.FoodItems.AsNoTracking()
            .Where(item => foodIds.Contains(item.Id))
            .Include(item => item.Versions).ThenInclude(item => item.Allergens)
            .AsSplitQuery()
            .ToDictionaryAsync(item => item.Id, cancellationToken);
        return versions
            .Where(version => foods.ContainsKey(version.FoodItemId))
            .Select(version =>
            {
                var food = foods[version.FoodItemId];
                var now = ToFoodView(food);
                return new RecipeDraftFoodView(
                    food.Id,
                    food.Name,
                    food.Provenance,
                    ToFoodVersionView(version),
                    now.CurrentVersion.Id != version.Id ? now : null);
            })
            .ToArray();
    }

    private static NutritionCommandResult RecipeDraftSaved(RecipeDraft draft) =>
        new(NutritionCommandStatus.Success, RecipeDraft: new RecipeDraftSaveView(draft.Id, draft.UpdatedAtUtc, draft.Version));

    private static NutritionCommandResult StaleRecipeDraft() =>
        Conflict(
            RecipeDraftConflictCodes.Stale,
            "These changes were changed or saved in another tab or device. Reload to continue with the latest.");

    private static NutritionCommandResult NewerRecipeVersionSaved(int? newest) =>
        Conflict(
            RecipeDraftConflictCodes.NewerVersionSaved,
            newest is { } revision
                ? $"Version {revision} of this recipe was saved after you started these changes."
                : "A newer version of this recipe was saved after you started these changes.");

    private static bool IsOneDraftPerRecipeViolation(DbUpdateException exception) =>
        exception.InnerException is PostgresException
        {
            SqlState: PostgresErrorCodes.UniqueViolation,
            ConstraintName: DatabaseConstraintNames.OneRecipeDraftPerPersonAndRecipe,
        };

    private static long RecipeDraftLockKey(Guid tenantId, Guid userId) =>
        BitConverter.ToInt64(tenantId.ToByteArray(), 0)
        ^ BitConverter.ToInt64(tenantId.ToByteArray(), 8)
        ^ BitConverter.ToInt64(userId.ToByteArray(), 0)
        ^ BitConverter.ToInt64(userId.ToByteArray(), 8)
        ^ RecipeDraftLockNamespace;

    /// <summary>What a draft's line needs of the food version it names to be read and saved.</summary>
    private sealed record DraftLineFood(Guid VersionId, string Name, FoodQuantityUnit Unit, PreparationBasis Basis);
}
