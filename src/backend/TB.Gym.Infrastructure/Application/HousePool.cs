using Microsoft.EntityFrameworkCore;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.ExerciseLibrary;
using TB.Gym.Modules.Media;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// The house's exercise pool as its read (LIB-006) and a workout of one's own (TRN-033) both see it: the request's
/// workspace while it is the house and active, its exercises in use, and their demos that open now, which are the ones
/// the media grant opens to a client of the house (MED-017).
/// </summary>
internal static class HousePool
{
    public static Task<bool> IsOpenHereAsync(
        GymDbContext dbContext,
        Guid tenantId,
        CancellationToken cancellationToken) =>
        dbContext.Tenants.AsNoTracking()
            .AnyAsync(tenant => tenant.Id == tenantId && tenant.IsHouse && tenant.IsActive, cancellationToken);

    /// <summary>The house's exercises in use (LIB-004); the tenant filter keeps them the house's.</summary>
    public static IQueryable<Exercise> InUse(GymDbContext dbContext) =>
        dbContext.Exercises.AsNoTracking().Where(item => !item.IsArchived);

    /// <summary>
    /// The demos of those of these exercises in use that open now (ready, an exercise's media), each exercise's in the
    /// house's order. An archived exercise has none, as the grant opens none of its.
    /// </summary>
    public static async Task<ILookup<Guid, PoolDemo>> DemosAsync(
        GymDbContext dbContext,
        IReadOnlyCollection<Guid> exerciseIds,
        CancellationToken cancellationToken) =>
        (await (
                from link in dbContext.ExerciseMediaLinks.AsNoTracking()
                join exercise in InUse(dbContext)
                    on new { link.TenantId, Id = link.ExerciseId }
                    equals new { exercise.TenantId, exercise.Id }
                join asset in dbContext.MediaAssets.AsNoTracking()
                    on new { link.TenantId, Id = link.MediaAssetId }
                    equals new { asset.TenantId, asset.Id }
                where exerciseIds.Contains(link.ExerciseId) &&
                      asset.Status == MediaAssetStatus.Ready &&
                      asset.Purpose == MediaPurpose.ExerciseMedia
                select new PoolDemo(link.ExerciseId, link.MediaAssetId, link.DisplayOrder, asset.Source, asset.Kind))
            .ToListAsync(cancellationToken))
        .OrderBy(item => item.DisplayOrder)
        .ThenBy(item => item.MediaAssetId)
        .ToLookup(item => item.ExerciseId);
}

internal sealed record PoolDemo(Guid ExerciseId, Guid MediaAssetId, int DisplayOrder, MediaSource Source, MediaKind Kind);
