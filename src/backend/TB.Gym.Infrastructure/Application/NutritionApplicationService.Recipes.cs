using Microsoft.EntityFrameworkCore;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Media;
using TB.Gym.Modules.Nutrition;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// The recipe editor's read and the checks its saves share (R4.4b): one recipe at its newest version
/// with every ingredient line, and the cover photo a version may carry (MED-014).
/// </summary>
internal sealed partial class NutritionApplicationService
{
    public async Task<RecipeDetail?> GetRecipeAsync(Guid recipeId, CancellationToken cancellationToken)
    {
        var recipe = await dbContext.Recipes.AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == recipeId, cancellationToken);
        if (recipe is null)
        {
            return null;
        }

        var latest = await dbContext.RecipeVersions.AsNoTracking()
            .Where(item => item.RecipeId == recipeId)
            .OrderByDescending(item => item.Revision)
            .Include(item => item.Ingredients)
            .Include(item => item.Allergens)
            .AsSplitQuery()
            .FirstAsync(cancellationToken);
        var publishedVersionId = await dbContext.RecipeVersions.AsNoTracking()
            .Where(item => item.RecipeId == recipeId && item.Status == PublicationStatus.Published)
            .OrderByDescending(item => item.Revision)
            .Select(item => (Guid?)item.Id)
            .FirstOrDefaultAsync(cancellationToken);

        var foodVersionIds = latest.Ingredients.Select(item => item.FoodItemVersionId).Distinct().ToArray();
        var foods = await (
            from version in dbContext.FoodItemVersions.AsNoTracking()
            join food in dbContext.FoodItems.AsNoTracking()
                on new { version.TenantId, Id = version.FoodItemId } equals new { food.TenantId, food.Id }
            where foodVersionIds.Contains(version.Id)
            select new { VersionId = version.Id, FoodId = food.Id, food.Provenance })
            .ToDictionaryAsync(item => item.VersionId, cancellationToken);
        var allergens = (await dbContext.FoodItemAllergens.AsNoTracking()
                .Where(item => foodVersionIds.Contains(item.FoodItemVersionId))
                .Select(item => new { item.FoodItemVersionId, item.Code })
                .ToListAsync(cancellationToken))
            .ToLookup(item => item.FoodItemVersionId, item => item.Code);

        // A food edited since a line copied it, as it is now, so the editor can offer its new numbers.
        var foodIds = foods.Values.Select(item => item.FoodId).Distinct().ToArray();
        var currentFoods = (await dbContext.FoodItems.AsNoTracking()
                .Where(item => foodIds.Contains(item.Id))
                .Include(item => item.Versions).ThenInclude(item => item.Allergens)
                .AsSplitQuery()
                .ToListAsync(cancellationToken))
            .Select(ToFoodView)
            .ToDictionary(item => item.Id);
        FoodItemView? Newer(Guid foodId, Guid versionId) =>
            currentFoods.TryGetValue(foodId, out var current) && current.CurrentVersion.Id != versionId ? current : null;

        // A line weighed cooked carries its conversion's two factors, so the editor can name it and weigh
        // the line raw again (audit INV-6).
        var factorIds = latest.Ingredients
            .SelectMany(item => new[] { item.YieldFactorId, item.RetentionFactorId })
            .OfType<Guid>()
            .Distinct()
            .ToArray();
        var factors = factorIds.Length == 0
            ? new Dictionary<Guid, CookingFactorView>()
            : await dbContext.CookingFactorRecords.AsNoTracking()
                .Where(item => factorIds.Contains(item.Id))
                .ToDictionaryAsync(item => item.Id, ToCookingFactorView, cancellationToken);
        CookingFactorView? Factor(Guid? id) => id is { } value ? factors.GetValueOrDefault(value) : null;

        var ingredients = latest.Ingredients
            .OrderBy(item => item.Order)
            .Select(item => new RecipeIngredientView(
                foods[item.FoodItemVersionId].FoodId,
                item.FoodItemVersionId,
                item.FoodName,
                foods[item.FoodItemVersionId].Provenance,
                item.Quantity,
                item.Unit,
                item.Basis,
                item.Calories,
                item.ProteinGrams,
                item.CarbohydrateGrams,
                item.FatGrams,
                allergens[item.FoodItemVersionId].Order().ToArray(),
                item.YieldFactorId,
                item.RetentionFactorId,
                Newer(foods[item.FoodItemVersionId].FoodId, item.FoodItemVersionId),
                Factor(item.YieldFactorId),
                Factor(item.RetentionFactorId)))
            .ToArray();
        return new RecipeDetail(
            recipe.Id,
            recipe.Name,
            recipe.CurrentRevision,
            publishedVersionId,
            new RecipeVersionView(
                latest.Id,
                latest.Revision,
                latest.Status,
                latest.PublishedAtUtc,
                latest.Instructions,
                latest.Servings,
                latest.Calories,
                latest.ProteinGrams,
                latest.CarbohydrateGrams,
                latest.FatGrams,
                latest.PhotoMediaAssetId,
                latest.Allergens.Select(item => item.Code).Order().ToArray(),
                ingredients,
                latest.PrepMinutes,
                latest.CookMinutes));
    }

    /// <summary>
    /// Checks the photo a new recipe version names (MED-014): a ready recipe photo of this workspace
    /// that the caller uploaded, or one an earlier version of the same recipe already has, so a
    /// second coach editing the recipe keeps its photo. Any other id, including another workspace's
    /// or a progress photo's, is refused as unknown.
    /// </summary>
    private async Task EnsureRecipePhotoAsync(Guid? photoMediaAssetId, Guid? recipeId, CancellationToken cancellationToken)
    {
        if (photoMediaAssetId is not { } assetId)
        {
            return;
        }

        var userId = RequireUserId();
        var asset = await dbContext.MediaAssets.AsNoTracking()
            .Where(item => item.Id == assetId && item.Purpose == MediaPurpose.RecipePhoto && item.Status == MediaAssetStatus.Ready)
            .Select(item => new { item.OwnerUserId, item.CreatedAtUtc })
            .SingleOrDefaultAsync(cancellationToken);
        var allowed = asset is not null &&
            (asset.OwnerUserId == userId ||
             (recipeId is { } id && await dbContext.RecipeVersions.AsNoTracking()
                 .AnyAsync(item => item.RecipeId == id && item.PhotoMediaAssetId == assetId, cancellationToken)));
        if (!allowed)
        {
            throw new NutritionInputException("photoMediaAssetId", "Choose a photo uploaded for this recipe.");
        }

        // An upload no version names is removed 48 hours after it was uploaded; a save stops taking
        // one an hour before that, so the sweep can never remove a photo a save is naming.
        if (asset!.CreatedAtUtc <= clock.UtcNow - MediaRetentionPolicy.UnusedRecipePhotoSaveWindow &&
            !await dbContext.RecipeVersions.AsNoTracking().AnyAsync(item => item.PhotoMediaAssetId == assetId, cancellationToken))
        {
            throw new NutritionInputException("photoMediaAssetId", "This photo was uploaded two days ago and is no longer kept. Add it again.");
        }
    }

    /// <summary>Two saves of one recipe raced for the same next revision; the second is told to reload.</summary>
    private static bool IsRecipeRevisionRace(DbUpdateException exception) =>
        exception.InnerException is PostgresException
        {
            SqlState: PostgresErrorCodes.UniqueViolation,
            ConstraintName: DatabaseConstraintNames.OneRecipeVersionPerRevision,
        };
}
