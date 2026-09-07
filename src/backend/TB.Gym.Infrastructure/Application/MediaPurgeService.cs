using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Media;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// Reconciles due tombstones and incomplete ingests through short claims, storage I/O outside any
/// database transaction, and token-checked finalization.
/// </summary>
internal sealed class MediaPurgeService(
    GymDbContext dbContext,
    IServiceScopeFactory scopeFactory,
    IObjectStorage objectStorage,
    IOptions<MediaStorageOptions> storageOptions,
    IClock clock,
    ILogger<MediaPurgeService> logger)
    : IMediaPurgeService
{
    private static readonly Action<ILogger, Guid, string, int, int, Exception?> LogPurgeFailure =
        LoggerMessage.Define<Guid, string, int, int>(
            LogLevel.Warning,
            new EventId(5501, "MediaPurgeFailed"),
            "Media purge failed for object owner {ObjectOwnerId} with {FailureCode} after {AttemptCount} attempts over {DerivativeCount} derivatives.");

    private readonly TimeSpan claimLease =
        TimeSpan.FromSeconds(storageOptions.Value.PurgeClaimLeaseSeconds);

    public async Task<MediaPurgeOutcome> PurgeDueAsync(
        int batchSize,
        CancellationToken cancellationToken)
    {
        if (batchSize <= 0)
        {
            return new MediaPurgeOutcome(0, 0, 0);
        }

        var now = clock.UtcNow;
        var tenantIds = await DueAssets(dbContext, now)
            .Select(item => item.TenantId)
            .Concat(DueIngestObjects(dbContext, now).Select(item => item.TenantId))
            .Distinct()
            .OrderBy(id => id)
            .Take(batchSize)
            .ToListAsync(cancellationToken);
        if (tenantIds.Count == 0)
        {
            return new MediaPurgeOutcome(0, 0, 0);
        }

        var share = Math.Max(1, batchSize / tenantIds.Count);
        var remaining = batchSize;
        var claimed = 0;
        var purged = 0;
        var failed = 0;
        foreach (var tenantId in tenantIds)
        {
            if (remaining <= 0)
            {
                break;
            }

            var claims = await ClaimTenantAsync(
                tenantId,
                now,
                Math.Min(share, remaining),
                cancellationToken);
            claimed += claims.Count;
            remaining -= claims.Count;

            foreach (var claim in claims)
            {
                if (await ProcessClaimAsync(claim, cancellationToken))
                {
                    purged++;
                }
                else
                {
                    failed++;
                }
            }
        }

        return new MediaPurgeOutcome(claimed, purged, failed);
    }

    private static IQueryable<MediaAsset> DueAssets(GymDbContext context, DateTimeOffset now) =>
        context.MediaAssets
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(item =>
                item.Status == MediaAssetStatus.Tombstoned &&
                item.Source == MediaSource.Upload &&
                item.PurgeAfterUtc != null &&
                item.PurgeAfterUtc <= now &&
                (item.PurgeClaimToken == null || item.PurgeClaimExpiresAtUtc <= now));

    private static IQueryable<MediaIngestObject> DueIngestObjects(
        GymDbContext context,
        DateTimeOffset now) =>
        context.MediaIngestObjects
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(item =>
                item.Status != MediaIngestObjectStatus.Purged &&
                item.PurgeAfterUtc <= now &&
                (item.PurgeClaimToken == null || item.PurgeClaimExpiresAtUtc <= now));

    /// <summary>
    /// Selects and leases work in one short transaction. The transaction is committed before this
    /// method returns any locator to the storage phase.
    /// </summary>
    private async Task<IReadOnlyList<PurgeClaim>> ClaimTenantAsync(
        Guid tenantId,
        DateTimeOffset now,
        int batchSize,
        CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var provider = scope.ServiceProvider;
        provider.GetRequiredService<IMutableTenantContext>().SetTenant(tenantId);
        var context = provider.GetRequiredService<GymDbContext>();

        return await context.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
            var claimedIngest = await context.MediaIngestObjects
                .FromSql($"""
                    SELECT *, xmin FROM media."IngestObjects"
                    WHERE "TenantId" = {tenantId}
                      AND "Status" <> 'Purged'
                      AND "PurgeAfterUtc" <= {now}
                      AND ("PurgeClaimToken" IS NULL OR "PurgeClaimExpiresAtUtc" <= {now})
                    ORDER BY "PurgeAfterUtc", "Id"
                    LIMIT {batchSize}
                    FOR UPDATE SKIP LOCKED
                    """)
                .ToListAsync(cancellationToken);

            var remaining = batchSize - claimedIngest.Count;
            var claimedAssets = remaining <= 0
                ? []
                : await context.MediaAssets
                    .FromSql($"""
                        SELECT *, xmin FROM media."Assets"
                        WHERE "TenantId" = {tenantId}
                          AND "Status" = 'Tombstoned'
                          AND "Source" = 'Upload'
                          AND "PurgeAfterUtc" IS NOT NULL
                          AND "PurgeAfterUtc" <= {now}
                          AND ("PurgeClaimToken" IS NULL OR "PurgeClaimExpiresAtUtc" <= {now})
                        ORDER BY "PurgeAfterUtc", "Id"
                        LIMIT {remaining}
                        FOR UPDATE SKIP LOCKED
                        """)
                    .ToListAsync(cancellationToken);

            var claims = new List<PurgeClaim>(claimedIngest.Count + claimedAssets.Count);
            foreach (var ingest in claimedIngest)
            {
                var token = Guid.NewGuid();
                ingest.ClaimPurge(now, claimLease, token);
                claims.Add(new PurgeClaim(tenantId, ingest.Id, token, PurgeWorkKind.Ingest));
            }

            foreach (var asset in claimedAssets)
            {
                var token = Guid.NewGuid();
                asset.ClaimPurge(now, claimLease, token);
                claims.Add(new PurgeClaim(tenantId, asset.Id, token, PurgeWorkKind.Asset));
            }

            await context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return (IReadOnlyList<PurgeClaim>)claims;
        });
    }

    private async Task<bool> ProcessClaimAsync(
        PurgeClaim claim,
        CancellationToken cancellationToken)
    {
        var work = await LoadClaimedWorkAsync(claim, cancellationToken);
        if (work is null)
        {
            return false;
        }

        string? failureCode = null;
        try
        {
            // The load scope has already been disposed and no transaction exists here.
            foreach (var locator in work.Derivatives)
            {
                var deletion = await objectStorage.DeleteAsync(locator, cancellationToken);
                if (deletion.Status != ObjectStorageOperationStatus.Success)
                {
                    failureCode = deletion.FailureCode ?? "storage_unavailable";
                    break;
                }
            }

            if (failureCode is null && work.Original is { } original)
            {
                var deletion = await objectStorage.DeleteAsync(original, cancellationToken);
                if (deletion.Status != ObjectStorageOperationStatus.Success)
                {
                    failureCode = deletion.FailureCode ?? "storage_unavailable";
                }
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // Caller cancellation leaves the durable live claim to expire and be reclaimed. The
            // storage port must never turn this into a provider failure.
            throw;
        }
        catch (Exception exception) when (IsStorageFailure(exception))
        {
            failureCode = PurgeFailureCode(exception);
        }

        var finalized = await FinalizeClaimAsync(
            claim,
            work.DerivativeCount,
            failureCode,
            cancellationToken);
        return finalized && failureCode is null;
    }

    private async Task<ClaimedPurgeWork?> LoadClaimedWorkAsync(
        PurgeClaim claim,
        CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var provider = scope.ServiceProvider;
        provider.GetRequiredService<IMutableTenantContext>().SetTenant(claim.TenantId);
        var context = provider.GetRequiredService<GymDbContext>();

        if (claim.Kind == PurgeWorkKind.Ingest)
        {
            var ingest = await context.MediaIngestObjects.AsNoTracking().SingleOrDefaultAsync(
                item => item.Id == claim.OwnerId && item.PurgeClaimToken == claim.Token,
                cancellationToken);
            if (ingest is null)
            {
                return null;
            }

            return new ClaimedPurgeWork(
                ingest.StorageKey is null ? null : ingest.GetStorageLocator(),
                [],
                0,
                ingest.PurgeAttemptCount);
        }

        var asset = await context.MediaAssets.AsNoTracking().SingleOrDefaultAsync(
            item => item.Id == claim.OwnerId && item.PurgeClaimToken == claim.Token,
            cancellationToken);
        if (asset is null)
        {
            return null;
        }

        var derivatives = await context.MediaAssetDerivatives.AsNoTracking()
            .Where(item => item.MediaAssetId == asset.Id && item.StorageKey != null)
            .OrderBy(item => item.Variant)
            .ToListAsync(cancellationToken);
        return new ClaimedPurgeWork(
            asset.StorageKey is null ? null : asset.GetStorageLocator(),
            derivatives.Select(item => item.GetStorageLocator()).ToArray(),
            derivatives.Count,
            asset.PurgeAttemptCount);
    }

    /// <summary>
    /// Locks only long enough to compare the token and persist success or failure. A claimant whose
    /// lease was replaced can neither clear keys nor overwrite the newer claimant's state.
    /// </summary>
    private async Task<bool> FinalizeClaimAsync(
        PurgeClaim claim,
        int derivativeCount,
        string? failureCode,
        CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var provider = scope.ServiceProvider;
        provider.GetRequiredService<IMutableTenantContext>().SetTenant(claim.TenantId);
        var context = provider.GetRequiredService<GymDbContext>();

        return await context.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
            if (claim.Kind == PurgeWorkKind.Ingest)
            {
                var ingest = await context.MediaIngestObjects
                    .FromSql($"""
                        SELECT *, xmin FROM media."IngestObjects"
                        WHERE "TenantId" = {claim.TenantId}
                          AND "Id" = {claim.OwnerId}
                        FOR UPDATE
                        """)
                    .SingleOrDefaultAsync(cancellationToken);
                if (ingest is null || !ingest.OwnsPurgeClaim(claim.Token))
                {
                    await transaction.RollbackAsync(cancellationToken);
                    return false;
                }

                if (failureCode is null)
                {
                    ingest.CompletePurge(clock.UtcNow, claim.Token);
                }
                else
                {
                    ingest.RecordPurgeFailure(clock.UtcNow, claim.Token, failureCode);
                }

                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                if (failureCode is not null)
                {
                    LogPurgeFailure(
                        logger,
                        ingest.Id,
                        failureCode,
                        ingest.PurgeAttemptCount,
                        0,
                        null);
                }

                return true;
            }

            var asset = await context.MediaAssets
                .FromSql($"""
                    SELECT *, xmin FROM media."Assets"
                    WHERE "TenantId" = {claim.TenantId}
                      AND "Id" = {claim.OwnerId}
                    FOR UPDATE
                    """)
                .SingleOrDefaultAsync(cancellationToken);
            if (asset is null || !asset.OwnsPurgeClaim(claim.Token))
            {
                await transaction.RollbackAsync(cancellationToken);
                return false;
            }

            if (failureCode is null)
            {
                var derivatives = await context.MediaAssetDerivatives
                    .Where(item => item.MediaAssetId == asset.Id)
                    .ToListAsync(cancellationToken);
                var finalizedAt = clock.UtcNow;
                foreach (var derivative in derivatives)
                {
                    derivative.MarkPurged(finalizedAt);
                }

                asset.CompletePurge(finalizedAt, claim.Token);
            }
            else
            {
                asset.RecordPurgeFailure(clock.UtcNow, claim.Token, failureCode);
            }

            await context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            if (failureCode is not null)
            {
                LogPurgeFailure(
                    logger,
                    asset.Id,
                    failureCode,
                    asset.PurgeAttemptCount,
                    derivativeCount,
                    null);
            }

            return true;
        });
    }

    private static bool IsStorageFailure(Exception exception) => exception is
        IOException or
        TimeoutException or
        UnauthorizedAccessException or
        InvalidOperationException or
        ArgumentException or
        OperationCanceledException;

    private static string PurgeFailureCode(Exception exception) => exception switch
    {
        OperationCanceledException => "storage_timeout",
        UnauthorizedAccessException => "storage_access_denied",
        IOException => "storage_io_error",
        ArgumentException => "storage_key_invalid",
        _ => "storage_unavailable",
    };

    private enum PurgeWorkKind
    {
        Ingest,
        Asset,
    }

    private sealed record PurgeClaim(
        Guid TenantId,
        Guid OwnerId,
        Guid Token,
        PurgeWorkKind Kind);

    private sealed record ClaimedPurgeWork(
        StorageObjectLocator? Original,
        IReadOnlyList<StorageObjectLocator> Derivatives,
        int DerivativeCount,
        int AttemptCount);
}
