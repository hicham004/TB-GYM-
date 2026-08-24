using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Media;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// Physically deletes the objects behind media that has been tombstoned long enough.
/// </summary>
/// <remarks>
/// This is a sweep over existing rows, not a second lifecycle. An asset moves Active -> Tombstoned
/// (with <c>PurgeAfterUtc</c> set by <see cref="MediaAsset.MarkTombstoned"/>) -> Purged, or stays
/// visibly tombstoned with an attempt count and the last failure code so a stuck object can be
/// found. Nothing here invents a new tombstone concept or a job record.
/// <para>
/// The sweep works one workspace at a time, each in its own scope. That is not an optimisation: the
/// tenant write-scope guard refuses to let a single scope write rows belonging to two workspaces,
/// and a background sweep that bypassed the guard would be exactly the hole the guard exists to
/// close. Working per tenant keeps the guard fully in force for every write the purge makes.
/// </para>
/// </remarks>
internal sealed class MediaPurgeService(
    GymDbContext dbContext,
    IServiceScopeFactory scopeFactory,
    IClock clock,
    ILogger<MediaPurgeService> logger)
    : IMediaPurgeService
{
    // The exception message may name a storage path, so only the asset identifier, the mapped code
    // and the counts are logged. Media content and client data never reach the log.
    private static readonly Action<ILogger, Guid, string, int, int, Exception?> LogPurgeFailure =
        LoggerMessage.Define<Guid, string, int, int>(
            LogLevel.Warning,
            new EventId(5501, "MediaPurgeFailed"),
            "Media purge failed for asset {AssetId} with {FailureCode} after {AttemptCount} attempts over {DerivativeCount} derivatives.");

    public async Task<MediaPurgeOutcome> PurgeDueAsync(int batchSize, CancellationToken cancellationToken)
    {
        if (batchSize <= 0)
        {
            return new MediaPurgeOutcome(0, 0, 0);
        }

        var now = clock.UtcNow;
        var tenantIds = await DueAssets(dbContext, now)
            .Select(item => item.TenantId)
            .Distinct()
            .Take(batchSize)
            .ToListAsync(cancellationToken);

        var claimed = 0;
        var purged = 0;
        var failed = 0;
        foreach (var tenantId in tenantIds)
        {
            var outcome = await PurgeTenantAsync(tenantId, now, batchSize, cancellationToken);
            claimed += outcome.Claimed;
            purged += outcome.Purged;
            failed += outcome.Failed;
        }

        return new MediaPurgeOutcome(claimed, purged, failed);
    }

    /// <summary>
    /// The eligibility rules, expressed once. An asset that is not tombstoned, one retained
    /// indefinitely because history references it, and one whose retention has not elapsed are all
    /// excluded here as well as by <see cref="MediaAsset.IsPurgeDue"/>, so a claim can never even
    /// select something that is not due.
    /// </summary>
    private static IQueryable<MediaAsset> DueAssets(GymDbContext context, DateTimeOffset now) =>
        context.MediaAssets
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(item =>
                item.Status == MediaAssetStatus.Tombstoned &&
                item.Source == MediaSource.Upload &&
                item.PurgeAfterUtc != null &&
                item.PurgeAfterUtc <= now);

    private async Task<MediaPurgeOutcome> PurgeTenantAsync(
        Guid tenantId,
        DateTimeOffset now,
        int batchSize,
        CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var provider = scope.ServiceProvider;
        provider.GetRequiredService<IMutableTenantContext>().SetTenant(tenantId);
        var context = provider.GetRequiredService<GymDbContext>();
        var objectStorage = provider.GetRequiredService<IObjectStorage>();

        // The connection retries on transient failure, and that strategy owns transaction
        // boundaries. Replaying the whole sweep is safe: a retry re-claims rows that were never
        // committed, and deleting an object that is already gone succeeds.
        return await context.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);

            // FOR UPDATE SKIP LOCKED is what makes several API replicas safe: each sweep locks the
            // rows it claims for the life of its transaction, and any other sweep steps over them
            // instead of blocking or double-deleting the same object.
            var claimed = await context.MediaAssets
                // xmin is a system column and is not covered by *, but EF maps it as the optimistic
                // concurrency token, so it has to be selected explicitly.
                .FromSql($"""
                    SELECT *, xmin FROM media."Assets"
                    WHERE "TenantId" = {tenantId}
                      AND "Status" = 'Tombstoned'
                      AND "Source" = 'Upload'
                      AND "PurgeAfterUtc" IS NOT NULL
                      AND "PurgeAfterUtc" <= {now}
                    ORDER BY "PurgeAfterUtc"
                    LIMIT {batchSize}
                    FOR UPDATE SKIP LOCKED
                    """)
                .ToListAsync(cancellationToken);

            var purged = 0;
            var failed = 0;
            foreach (var asset in claimed)
            {
                if (await TryPurgeAsync(context, objectStorage, asset, now, cancellationToken))
                {
                    purged++;
                }
                else
                {
                    failed++;
                }
            }

            await transaction.CommitAsync(cancellationToken);
            return new MediaPurgeOutcome(claimed.Count, purged, failed);
        });
    }

    private async Task<bool> TryPurgeAsync(
        GymDbContext context,
        IObjectStorage objectStorage,
        MediaAsset asset,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var derivatives = await context.MediaAssetDerivatives
            .Where(item => item.MediaAssetId == asset.Id)
            .ToListAsync(cancellationToken);
        try
        {
            // Recorded before any object is touched, so a process that dies mid-purge still leaves
            // evidence that an attempt happened.
            asset.BeginPurgeAttempt(now);
            await context.SaveChangesAsync(cancellationToken);

            // Derivatives first: if the sweep dies between the two, the parent is still tombstoned
            // and due, and the retry walks the same list again. Deleting an object that is already
            // gone succeeds, so replaying a partial purge is safe.
            foreach (var derivative in derivatives)
            {
                if (derivative.StorageKey is { } derivativeKey)
                {
                    await objectStorage.DeleteAsync(derivativeKey, cancellationToken);
                }

                derivative.MarkPurged(now);
            }

            if (asset.StorageKey is { } storageKey)
            {
                await objectStorage.DeleteAsync(storageKey, cancellationToken);
            }

            asset.CompletePurge(now);
            await context.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (Exception exception) when (exception is IOException
                                              or UnauthorizedAccessException
                                              or InvalidOperationException
                                              or ArgumentException)
        {
            // The row stays tombstoned and due, so the next sweep retries it. The failure is
            // recorded rather than swallowed, and the asset is never marked complete on a failure.
            await RecordFailureAsync(context, asset, derivatives.Count, now, exception, cancellationToken);
            return false;
        }
    }

    private async Task RecordFailureAsync(
        GymDbContext context,
        MediaAsset asset,
        int derivativeCount,
        DateTimeOffset now,
        Exception exception,
        CancellationToken cancellationToken)
    {
        // Discard whatever the failed attempt staged, so the recorded failure is the only change
        // this asset makes and no half-applied purge state is committed.
        foreach (var entry in context.ChangeTracker.Entries().ToArray())
        {
            entry.State = EntityState.Detached;
        }

        var current = await context.MediaAssets
            .SingleOrDefaultAsync(item => item.Id == asset.Id, cancellationToken);
        if (current is null)
        {
            return;
        }

        var failureCode = PurgeFailureCode(exception);
        current.RecordPurgeFailure(now, failureCode);
        await context.SaveChangesAsync(cancellationToken);
        LogPurgeFailure(logger, current.Id, failureCode, current.PurgeAttemptCount, derivativeCount, null);
    }

    private static string PurgeFailureCode(Exception exception) => exception switch
    {
        UnauthorizedAccessException => "storage_access_denied",
        IOException => "storage_io_error",
        ArgumentException => "storage_key_invalid",
        _ => "storage_unavailable",
    };
}
