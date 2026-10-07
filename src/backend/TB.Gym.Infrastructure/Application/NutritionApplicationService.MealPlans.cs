using Microsoft.EntityFrameworkCore;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Nutrition;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// The meal-plan builder's reads and its working copies (NUT-013, R4.4a): one plan with its versions,
/// one version's days, and each coach's own drafts, kept as the builder sends them and checked in
/// full only when published.
/// </summary>
/// <remarks>
/// Every draft read and write is narrowed to the signed-in caller inside the active workspace, so
/// another person's draft, in this workspace or another, is simply not found. Plan text stays out of
/// logs and exception messages.
/// </remarks>
internal sealed partial class NutritionApplicationService
{
    private const long MealPlanDraftLockNamespace = 0x4e55_7d13;

    public async Task<MealPlanTemplateDetail?> GetMealPlanAsync(Guid mealPlanTemplateId, CancellationToken cancellationToken)
    {
        var template = await dbContext.MealPlanTemplates.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == mealPlanTemplateId, cancellationToken);
        if (template is null)
        {
            return null;
        }

        var versions = await dbContext.MealPlanTemplateVersions.AsNoTracking()
            .Where(version => version.MealPlanTemplateId == mealPlanTemplateId)
            .OrderByDescending(version => version.Revision)
            .Select(version => new MealPlanVersionSummary(
                version.Id,
                version.Revision,
                version.Status,
                version.CreatedAtUtc,
                version.PublishedAtUtc,
                version.DayCount,
                version.TargetCalories,
                version.Slots.Count))
            .ToListAsync(cancellationToken);
        var drafts = await OwnDraftsByPlanAsync([template.Id], cancellationToken);
        return new MealPlanTemplateDetail(
            template.Id,
            template.Name,
            template.CurrentRevision,
            versions,
            drafts.GetValueOrDefault(template.Id));
    }

    public async Task<MealPlanVersionView?> GetMealPlanVersionAsync(Guid mealPlanVersionId, CancellationToken cancellationToken)
    {
        var version = await dbContext.MealPlanTemplateVersions.AsNoTracking()
            .Include(item => item.Slots).ThenInclude(item => item.Choices)
            .AsSplitQuery()
            .SingleOrDefaultAsync(item => item.Id == mealPlanVersionId, cancellationToken);
        if (version is null)
        {
            return null;
        }

        var slots = version.Slots
            .OrderBy(slot => slot.DayOffset)
            .ThenBy(slot => slot.Order)
            .Select(slot => new MealPlanVersionSlotView(
                slot.DayOffset,
                slot.Order,
                slot.Name,
                slot.Choices.Select(choice => new MealPlanVersionChoiceView(
                    choice.RecipeVersionId,
                    choice.RecipeName,
                    choice.Servings,
                    choice.Calories,
                    choice.ProteinGrams,
                    choice.CarbohydrateGrams,
                    choice.FatGrams)).ToArray()))
            .ToArray();
        var recipes = await RecipeSummariesAsync(
            slots.SelectMany(slot => slot.Choices).Select(choice => choice.RecipeVersionId),
            cancellationToken);
        return new MealPlanVersionView(
            version.Id,
            version.MealPlanTemplateId,
            version.Revision,
            version.Status,
            version.DayCount,
            version.TargetCalories,
            version.TargetProteinGrams,
            version.TargetCarbohydrateGrams,
            version.TargetFatGrams,
            slots,
            recipes);
    }

    public async Task<IReadOnlyList<MealPlanDraftSummary>> ListMealPlanDraftsAsync(CancellationToken cancellationToken)
    {
        if (currentUser.UserId is not { } userId || !tenantContext.HasTenant)
        {
            return [];
        }

        // The content can run long, so the list reads only what it shows.
        return await dbContext.MealPlanDrafts.AsNoTracking()
            .Where(draft => draft.OwnerUserId == userId)
            .OrderByDescending(draft => draft.UpdatedAtUtc)
            .ThenBy(draft => draft.Id)
            .Select(draft => new MealPlanDraftSummary(
                draft.Id,
                draft.MealPlanTemplateId,
                draft.Name,
                draft.DayCount,
                draft.UpdatedAtUtc))
            .ToListAsync(cancellationToken);
    }

    public async Task<MealPlanDraftView?> GetMealPlanDraftAsync(Guid draftId, CancellationToken cancellationToken)
    {
        if (await FindOwnMealPlanDraftAsync(draftId, tracked: false, cancellationToken) is not { } draft)
        {
            return null;
        }

        var content = MealPlanDraftShape.Read(draft.ContentJson);
        var recipes = await RecipeSummariesAsync(
            (content.Days ?? [])
                .SelectMany(day => day.Meals ?? [])
                .SelectMany(meal => meal.Choices ?? [])
                .Select(choice => choice.RecipeVersionId),
            cancellationToken);
        return new MealPlanDraftView(
            draft.Id,
            draft.MealPlanTemplateId,
            draft.SourceVersionId,
            draft.StartedAtRevision,
            draft.UpdatedAtUtc,
            draft.Version,
            content,
            recipes);
    }

    public async Task<NutritionCommandResult> CreateMealPlanDraftAsync(CreateMealPlanDraftRequest request, CancellationToken cancellationToken)
    {
        if (currentUser.UserId is not { } userId || !tenantContext.HasTenant)
        {
            return NotFound();
        }

        if (!MealPlanDraftShape.TryCreate(request?.Content, out var shape, out var field, out var problem))
        {
            return Invalid(field, problem);
        }

        return request!.MealPlanTemplateId is { } templateId
            ? await CreateDraftOfMealPlanAsync(userId, templateId, request, shape, cancellationToken)
            : request.SourceVersionId is not null || request.TemplateRevision is not null
                ? Invalid("mealPlanTemplateId", "A new meal plan has no versions to start from.")
                : await CreateDraftOfNewMealPlanAsync(userId, shape, cancellationToken);
    }

    public async Task<NutritionCommandResult> SaveMealPlanDraftAsync(Guid draftId, SaveMealPlanDraftRequest request, CancellationToken cancellationToken)
    {
        // Found before the content is read, so a stranger's identifier answers the same whatever it
        // is sent with.
        if (await FindOwnMealPlanDraftAsync(draftId, tracked: true, cancellationToken) is not { } draft)
        {
            return NotFound();
        }

        if (!MealPlanDraftShape.TryCreate(request?.Content, out var shape, out var field, out var problem))
        {
            return Invalid(field, problem);
        }

        dbContext.Entry(draft).Property(item => item.Version).OriginalValue = request!.Version;
        draft.Replace(shape);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return StaleMealPlanDraft();
        }

        return MealPlanDraftSaved(draft);
    }

    public async Task<NutritionCommandResult> DiscardMealPlanDraftAsync(Guid draftId, DiscardMealPlanDraftRequest request, CancellationToken cancellationToken)
    {
        if (await FindOwnMealPlanDraftAsync(draftId, tracked: true, cancellationToken) is not { } draft)
        {
            return NotFound();
        }

        // Unpublished changes, not a record: removing them leaves nothing behind. The version still
        // guards against discarding changes another tab has just made.
        dbContext.Entry(draft).Property(item => item.Version).OriginalValue = request?.Version ?? 0;
        dbContext.MealPlanDrafts.Remove(draft);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return StaleMealPlanDraft();
        }

        return new NutritionCommandResult(NutritionCommandStatus.Success);
    }

    public async Task<NutritionCommandResult> PublishMealPlanDraftAsync(Guid draftId, PublishMealPlanDraftRequest request, CancellationToken cancellationToken)
    {
        if (await FindOwnMealPlanDraftAsync(draftId, tracked: true, cancellationToken) is not { } draft)
        {
            return NotFound();
        }

        if (request is null || draft.Version != request.Version)
        {
            return StaleMealPlanDraft();
        }

        MealPlanTemplate? existing = null;
        if (draft.MealPlanTemplateId is { } templateId)
        {
            existing = await dbContext.MealPlanTemplates.SingleOrDefaultAsync(item => item.Id == templateId, cancellationToken);
            if (existing is null)
            {
                return NotFound();
            }

            if (draft.IsBehind(existing.CurrentRevision) && !request.ReplaceNewer)
            {
                return NewerMealPlanVersionPublished(existing.CurrentRevision);
            }
        }

        var content = MealPlanDraftShape.Read(draft.ContentJson);
        if (await PublishRefusalAsync(content, cancellationToken) is { } refusal)
        {
            return refusal;
        }

        try
        {
            // The same checks and arithmetic as any save: published recipes of this workspace only,
            // each choice's macros worked out from its servings (NUT-005).
            var slots = await BuildMealSlotsAsync(ToSlotRequests(content), cancellationToken);
            var name = content.Name!.Trim();
            var template = existing ?? MealPlanTemplate.Create(tenantContext.TenantId, name);
            if (existing is not null && !string.Equals(existing.Name, name, StringComparison.Ordinal))
            {
                existing.Rename(name);
            }

            var version = template.AddDraft(
                content.Days!.Count,
                content.TargetCalories!.Value,
                content.TargetProteinGrams!.Value,
                content.TargetCarbohydrateGrams!.Value,
                content.TargetFatGrams!.Value,
                slots);
            version.Publish(clock.UtcNow, RequireUserId());
            // Added explicitly, with every meal and choice under it: keys are made here, so rows found
            // only through a navigation could be taken for rows already stored.
            if (existing is null)
            {
                dbContext.MealPlanTemplates.Add(template);
            }
            else
            {
                dbContext.MealPlanTemplateVersions.Add(version);
            }

            dbContext.Entry(draft).Property(item => item.Version).OriginalValue = request.Version;
            dbContext.MealPlanDrafts.Remove(draft);
            // One save, one transaction: the version lands and the draft goes, or neither.
            await dbContext.SaveChangesAsync(cancellationToken);
            return new NutritionCommandResult(NutritionCommandStatus.Success, MealPlan: ToMealPlanSummary(template, version));
        }
        catch (NutritionInputException exception)
        {
            return Invalid(exception.Field, exception.Message);
        }
        catch (ArgumentException exception)
        {
            return Invalid("mealPlan", exception.Message);
        }
        catch (DbUpdateConcurrencyException exception)
        {
            // The draft changed in another tab, or someone published this plan in the same moment.
            return exception.Entries.Any(entry => entry.Entity is MealPlanDraft)
                ? StaleMealPlanDraft()
                : NewerMealPlanVersionPublished(null);
        }
        catch (DbUpdateException exception) when (exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            return NewerMealPlanVersionPublished(null);
        }
    }

    /// <summary>
    /// What would stop the draft from becoming a version, said the way the coach sees the plan: by
    /// day and meal. Null when every rule a version has is met, recipes included.
    /// </summary>
    private async Task<NutritionCommandResult?> PublishRefusalAsync(MealPlanDraftContent content, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(content.Name))
        {
            return Invalid("name", "Give the meal plan a name before publishing it.");
        }

        if (content.TargetCalories is not (> 0m and <= 100_000m))
        {
            return Invalid("targetCalories", "Set the daily calories before publishing: more than 0 and at most 100,000.");
        }

        if (new[] { content.TargetProteinGrams, content.TargetCarbohydrateGrams, content.TargetFatGrams }
            .Any(target => target is not (>= 0m and <= 1_000_000m)))
        {
            return Invalid("targets", "Set the daily protein, carbohydrate and fat before publishing: 0 or more grams each.");
        }

        var days = content.Days ?? [];
        var recipeIds = days.SelectMany(day => day.Meals ?? []).SelectMany(meal => meal.Choices ?? [])
            .Select(choice => choice.RecipeVersionId).Distinct().ToArray();
        var published = await dbContext.RecipeVersions.AsNoTracking()
            .Where(version => recipeIds.Contains(version.Id) && version.Status == PublicationStatus.Published)
            .Select(version => version.Id)
            .ToListAsync(cancellationToken);
        for (var dayIndex = 0; dayIndex < days.Count; dayIndex++)
        {
            var meals = days[dayIndex].Meals ?? [];
            var day = dayIndex + 1;
            if (meals.Count == 0)
            {
                return Invalid("days", $"Day {day} has no meals yet. Add one, or remove the day.");
            }

            for (var mealIndex = 0; mealIndex < meals.Count; mealIndex++)
            {
                var meal = meals[mealIndex];
                if (string.IsNullOrWhiteSpace(meal.Name))
                {
                    return Invalid("meals", $"Day {day}, meal {mealIndex + 1} needs a name.");
                }

                var label = $"Day {day}, {meal.Name.Trim()}";
                var choices = meal.Choices ?? [];
                if (choices.Count == 0)
                {
                    return Invalid("meals", $"{label} has no recipe yet.");
                }

                if (choices.Any(choice => choice.Servings is not (> 0m and <= 1_000m)))
                {
                    return Invalid("choices", $"{label}: servings must be more than 0 and at most 1,000.");
                }

                if (choices.Any(choice => !published.Contains(choice.RecipeVersionId)))
                {
                    return Invalid("choices", $"{label} uses a recipe that is not published in this workspace.");
                }
            }
        }

        return null;
    }

    private static MealPlanSlotRequest[] ToSlotRequests(MealPlanDraftContent content) =>
        (content.Days ?? [])
            .SelectMany((day, dayOffset) => (day.Meals ?? []).Select((meal, order) => new MealPlanSlotRequest(
                dayOffset,
                order,
                meal.Name!.Trim(),
                meal.Choices ?? [])))
            .ToArray();

    private async Task<NutritionCommandResult> CreateDraftOfMealPlanAsync(
        Guid userId,
        Guid templateId,
        CreateMealPlanDraftRequest request,
        MealPlanDraftShape shape,
        CancellationToken cancellationToken)
    {
        var template = await dbContext.MealPlanTemplates.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == templateId, cancellationToken);
        if (template is null)
        {
            return NotFound();
        }

        if (request.SourceVersionId is not { } sourceVersionId ||
            !await dbContext.MealPlanTemplateVersions.AsNoTracking().AnyAsync(
                version => version.Id == sourceVersionId && version.MealPlanTemplateId == templateId,
                cancellationToken))
        {
            return Invalid("sourceVersionId", "Open one of this meal plan's versions first.");
        }

        if (request.TemplateRevision is not { } seen || seen < 1 || seen > template.CurrentRevision)
        {
            return Invalid("templateRevision", "The meal plan's newest revision, as read, is required.");
        }

        var draft = MealPlanDraft.ForPlan(tenantContext.TenantId, userId, templateId, sourceVersionId, seen, shape);
        dbContext.MealPlanDrafts.Add(draft);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (IsOneDraftPerMealPlanViolation(exception))
        {
            return Conflict(
                MealPlanDraftConflictCodes.AlreadyExists,
                "Changes to this meal plan are already open in another tab or device. Reload to continue them.");
        }

        return MealPlanDraftSaved(draft);
    }

    private Task<NutritionCommandResult> CreateDraftOfNewMealPlanAsync(
        Guid userId,
        MealPlanDraftShape shape,
        CancellationToken cancellationToken) =>
        dbContext.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            dbContext.ChangeTracker.Clear();
            await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
            // One start at a time per person, so two quick starts cannot both slip under the limit.
            await dbContext.Database.ExecuteSqlAsync(
                $"SELECT pg_advisory_xact_lock({MealPlanDraftLockKey(tenantContext.TenantId, userId)}) /* meal-plan-drafts */",
                cancellationToken);
            var kept = await dbContext.MealPlanDrafts.CountAsync(
                draft => draft.OwnerUserId == userId && draft.MealPlanTemplateId == null,
                cancellationToken);
            if (kept >= MealPlanDraft.MaximumNewPlansPerOwner)
            {
                await transaction.RollbackAsync(cancellationToken);
                return Conflict(
                    MealPlanDraftConflictCodes.LimitReached,
                    $"You can keep up to {MealPlanDraft.MaximumNewPlansPerOwner} new meal plans that are not published. Publish or discard one to start another.");
            }

            var draft = MealPlanDraft.ForNewPlan(tenantContext.TenantId, userId, shape);
            dbContext.MealPlanDrafts.Add(draft);
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return MealPlanDraftSaved(draft);
        });

    private async Task<MealPlanDraft?> FindOwnMealPlanDraftAsync(Guid draftId, bool tracked, CancellationToken cancellationToken)
    {
        if (currentUser.UserId is not { } userId || !tenantContext.HasTenant)
        {
            return null;
        }

        var drafts = tracked ? dbContext.MealPlanDrafts : dbContext.MealPlanDrafts.AsNoTracking();
        return await drafts.SingleOrDefaultAsync(
            draft => draft.Id == draftId && draft.OwnerUserId == userId,
            cancellationToken);
    }

    /// <summary>The caller's own drafts of these plans, by plan, for the plan summaries.</summary>
    private async Task<Dictionary<Guid, MealPlanDraftSummary>> OwnDraftsByPlanAsync(
        Guid[] templateIds,
        CancellationToken cancellationToken)
    {
        if (currentUser.UserId is not { } userId || !tenantContext.HasTenant || templateIds.Length == 0)
        {
            return [];
        }

        var drafts = await dbContext.MealPlanDrafts.AsNoTracking()
            .Where(draft => draft.OwnerUserId == userId &&
                            draft.MealPlanTemplateId != null &&
                            templateIds.Contains(draft.MealPlanTemplateId.Value))
            .Select(draft => new MealPlanDraftSummary(
                draft.Id,
                draft.MealPlanTemplateId,
                draft.Name,
                draft.DayCount,
                draft.UpdatedAtUtc))
            .ToListAsync(cancellationToken);
        return drafts.ToDictionary(draft => draft.MealPlanTemplateId!.Value);
    }

    /// <summary>
    /// The recipe versions a plan names, as this workspace's library has them: names, yields, macros
    /// and status. An id from anywhere else names nothing.
    /// </summary>
    private async Task<RecipeSummary[]> RecipeSummariesAsync(IEnumerable<Guid> recipeVersionIds, CancellationToken cancellationToken)
    {
        var ids = recipeVersionIds.Distinct().ToArray();
        if (ids.Length == 0)
        {
            return [];
        }

        var versions = await dbContext.RecipeVersions.AsNoTracking()
            .Where(version => ids.Contains(version.Id))
            .Include(version => version.Allergens)
            .AsSplitQuery()
            .ToListAsync(cancellationToken);
        var recipeIds = versions.Select(version => version.RecipeId).Distinct().ToArray();
        var recipes = await dbContext.Recipes.AsNoTracking()
            .Where(recipe => recipeIds.Contains(recipe.Id))
            .ToDictionaryAsync(recipe => recipe.Id, cancellationToken);
        return versions
            .Where(version => recipes.ContainsKey(version.RecipeId))
            .Select(version => ToRecipeSummary(recipes[version.RecipeId], version))
            .OrderBy(summary => summary.Name, StringComparer.Ordinal)
            .ToArray();
    }

    private static NutritionCommandResult MealPlanDraftSaved(MealPlanDraft draft) =>
        new(NutritionCommandStatus.Success, MealPlanDraft: new MealPlanDraftSaveView(draft.Id, draft.UpdatedAtUtc, draft.Version));

    private static NutritionCommandResult StaleMealPlanDraft() =>
        Conflict(
            MealPlanDraftConflictCodes.Stale,
            "These changes were changed or published in another tab or device. Reload to continue with the latest.");

    private static NutritionCommandResult NewerMealPlanVersionPublished(int? newest) =>
        Conflict(
            MealPlanDraftConflictCodes.NewerVersionPublished,
            newest is { } revision
                ? $"Version {revision} of this meal plan was published after you started these changes."
                : "A newer version of this meal plan was published after you started these changes.");

    private static bool IsOneDraftPerMealPlanViolation(DbUpdateException exception) =>
        exception.InnerException is PostgresException
        {
            SqlState: PostgresErrorCodes.UniqueViolation,
            ConstraintName: DatabaseConstraintNames.OneMealPlanDraftPerPersonAndPlan,
        };

    private static long MealPlanDraftLockKey(Guid tenantId, Guid userId) =>
        BitConverter.ToInt64(tenantId.ToByteArray(), 0)
        ^ BitConverter.ToInt64(tenantId.ToByteArray(), 8)
        ^ BitConverter.ToInt64(userId.ToByteArray(), 0)
        ^ BitConverter.ToInt64(userId.ToByteArray(), 8)
        ^ MealPlanDraftLockNamespace;
}
