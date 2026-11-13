using Microsoft.EntityFrameworkCore;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.ExerciseLibrary;
using TB.Gym.Modules.Media;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// The house's exercise pool (LIB-006, notes plan N9b1), composed here as the library, the house's mark, the
/// caller's own profile and the access port meet nowhere else. Its reader is any current client of the house: Free
/// runs under every tier the house sells, so the pool is theirs whatever they are on, while Training is open to them.
/// </summary>
/// <remarks>
/// Only the request's own workspace counts: a person who is a client of the house and of a coach reads nothing of the
/// pool under the coach's header, and the coach's workspace has no pool. The exercises in use alone, searched as the
/// coach's library is; every demo the read names is one that opens now (ready, an exercise's media), in the house's
/// order. Nothing here writes.
/// </remarks>
internal sealed class ExercisePoolService(
    GymDbContext dbContext,
    ITenantContext tenantContext,
    ICurrentUser currentUser,
    ICoachingFeatureAccessService featureAccess)
    : IExercisePoolService
{
    public async Task<ExercisePoolPage?> SearchAsync(
        ExercisePoolSearchRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var access = await TrainingAccessAsync(cancellationToken);
        if (access is null)
        {
            return null;
        }

        if (!access.IsAllowed)
        {
            return new ExercisePoolPage(false, access.Reason.ToString(), 0, []);
        }

        var query = ExerciseLibraryApplicationService.Search(
            InUse(),
            request.Query,
            request.Equipment,
            request.MovementPatterns,
            request.Classification,
            request.TypeName,
            request.Muscle,
            tag: null);
        var total = await query.CountAsync(cancellationToken);
        var items = await ExerciseLibraryApplicationService.InNameOrder(query)
            .Skip(Math.Max(request.Skip, 0))
            .Take(Math.Clamp(request.Take, 1, 100))
            .AsSplitQuery()
            .ToListAsync(cancellationToken);
        return new ExercisePoolPage(true, access.Reason.ToString(), total, await ToViewsAsync(items, cancellationToken));
    }

    public async Task<ExercisePoolExerciseResult?> GetAsync(Guid exerciseId, CancellationToken cancellationToken)
    {
        var access = await TrainingAccessAsync(cancellationToken);
        if (access is null)
        {
            return null;
        }

        if (!access.IsAllowed)
        {
            return new ExercisePoolExerciseResult(false, access.Reason.ToString(), null);
        }

        var exercise = await InUse().AsSplitQuery().SingleOrDefaultAsync(item => item.Id == exerciseId, cancellationToken);
        return exercise is null
            ? null
            : new ExercisePoolExerciseResult(true, access.Reason.ToString(), (await ToViewsAsync([exercise], cancellationToken))[0]);
    }

    /// <summary>The house's exercises in use (LIB-004), with their muscles; the tenant filter keeps them the house's.</summary>
    private IQueryable<Exercise> InUse() =>
        dbContext.Exercises
            .AsNoTracking()
            .Include(item => item.Muscles)
            .Where(item => !item.IsArchived);

    /// <summary>
    /// The caller's Training decision in the house (SUB-009), or null when the workspace in scope is not the house or
    /// the caller is no current client of it (ADR 0027's <c>CurrentFor</c>).
    /// </summary>
    private async Task<FeatureAccessDecision?> TrainingAccessAsync(CancellationToken cancellationToken)
    {
        if (currentUser.UserId is not { } userId || !tenantContext.HasTenant)
        {
            return null;
        }

        var tenantId = tenantContext.TenantId;
        if (!await dbContext.Tenants.AsNoTracking()
                .AnyAsync(tenant => tenant.Id == tenantId && tenant.IsHouse && tenant.IsActive, cancellationToken))
        {
            return null;
        }

        var clientId = await dbContext.ClientProfiles.AsNoTracking()
            .CurrentFor(userId)
            .Select(profile => (Guid?)profile.Id)
            .SingleOrDefaultAsync(cancellationToken);
        return clientId is null
            ? null
            : await featureAccess.EvaluateAsync(tenantId, clientId.Value, CoachingFeature.Training, cancellationToken);
    }

    private async Task<IReadOnlyList<PoolExerciseView>> ToViewsAsync(
        IReadOnlyList<Exercise> exercises,
        CancellationToken cancellationToken)
    {
        var exerciseIds = exercises.Select(item => item.Id).ToArray();
        var demos = (await (
                from link in dbContext.ExerciseMediaLinks.AsNoTracking()
                join asset in dbContext.MediaAssets.AsNoTracking()
                    on new { link.TenantId, Id = link.MediaAssetId }
                    equals new { asset.TenantId, asset.Id }
                where exerciseIds.Contains(link.ExerciseId) &&
                      asset.Status == MediaAssetStatus.Ready &&
                      asset.Purpose == MediaPurpose.ExerciseMedia
                select new { link.ExerciseId, link.MediaAssetId, link.DisplayOrder, asset.Source, asset.Kind })
            .ToListAsync(cancellationToken))
            .ToLookup(item => item.ExerciseId);
        return
        [
            .. exercises.Select(item => new PoolExerciseView(
                item.Id,
                item.Name,
                item.Classification,
                item.TypeName,
                item.Equipment,
                item.MovementPattern,
                [.. item.Muscles
                    .OrderBy(link => link.Role)
                    .ThenBy(link => link.Muscle)
                    .Select(link => new ExerciseMuscleView(link.Muscle, link.Role))],
                item.Instructions,
                [.. demos[item.Id]
                    .OrderBy(demo => demo.DisplayOrder)
                    .Select(demo => new PoolDemoView(demo.MediaAssetId, KindOf(demo.Source, demo.Kind)))])),
        ];
    }

    private static PoolDemoKind KindOf(MediaSource source, MediaKind kind) =>
        source == MediaSource.ExternalEmbed
            ? PoolDemoKind.VideoLink
            : kind == MediaKind.Image
                ? PoolDemoKind.Picture
                : PoolDemoKind.Video;
}
