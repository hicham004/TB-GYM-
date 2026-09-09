using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Media;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// The only durable writes reconciliation is allowed to make: opening, re-observing and resolving
/// the findings of one workspace, each under a checked lease.
/// </summary>
/// <remarks>
/// <para>
/// This exists as a port so that the reconciliation service can be composed without a container. A
/// service holding <see cref="IServiceScopeFactory"/> can resolve anything the application
/// registered — <see cref="IObjectStorage"/> included — so a constructor that took one would make
/// the "there is nothing here that can delete" guarantee an argument about the code inside rather
/// than a property of the code's shape. Writing a finding needs a per-workspace scope; nothing else
/// about a container does, so nothing else is handed over.
/// </para>
/// <para>
/// Every method commits in its own short transaction, and every one of them re-checks the run's
/// lease inside that transaction before writing. Ownership is not a fact a caller may carry across a
/// remote call: another replica can claim a run while the first is still probing, and a worker that
/// discovered it had lost the lease only afterwards would already have written the findings.
/// </para>
/// </remarks>
internal interface IMediaInventoryFindingStore
{
    /// <summary>
    /// Opens the findings for one workspace that are not already open, and re-observes the ones that
    /// are. The observations must already be collapsed to one per kind and key.
    /// </summary>
    Task<MediaInventoryFindingWrite> ApplyAsync(
        MediaInventoryRunClaim claim,
        Guid tenantId,
        string location,
        IReadOnlyList<MediaInventoryPendingFinding> findings,
        CancellationToken cancellationToken);

    /// <summary>
    /// Closes one bounded batch of the findings at this location that the run identified by the
    /// claim did not observe, and adds that batch to the run's total in the same transaction.
    /// Called only for a run that finished both passes with no outstanding failure, and which
    /// therefore examined every object and every row this location has.
    /// </summary>
    /// <remarks>
    /// One batch, one workspace, one transaction. The candidate set shrinks with every batch —
    /// closing a finding removes it from the query that finds the next one — so the phase is
    /// resumable without a cursor, and a batch that finds no candidate at all is the bounded proof
    /// that there is nothing left, reported as <see cref="MediaInventoryFindingWrite.Drained"/>.
    /// </remarks>
    Task<MediaInventoryFindingWrite> ResolveUnobservedBatchAsync(
        MediaInventoryRunClaim claim,
        string location,
        CancellationToken cancellationToken);

    /// <summary>
    /// Records on the run that resolution is finished, if and only if a bounded look finds no
    /// unresolved finding this run left unobserved.
    /// </summary>
    Task<MediaInventoryFindingWrite> CompleteResolutionAsync(
        MediaInventoryRunClaim claim,
        string location,
        CancellationToken cancellationToken);
}

/// <summary>Which run is writing, and the lease token that says it still may.</summary>
internal readonly record struct MediaInventoryRunClaim(Guid RunId, Guid LeaseToken);

/// <summary>
/// What one write did. <see cref="Owned"/> is false when the lease had moved on, in which case
/// nothing at all was written and the caller must stop rather than carry on. <see cref="Drained"/>
/// says a bounded look found nothing left to close, which is the only thing that entitles a run to
/// be completed.
/// </summary>
internal readonly record struct MediaInventoryFindingWrite(
    bool Owned,
    int Opened,
    int Resolved,
    bool Drained = false)
{
    public static MediaInventoryFindingWrite Nothing { get; } = new(true, 0, 0);

    public static MediaInventoryFindingWrite Lost { get; } = new(false, 0, 0);
}

/// <inheritdoc cref="IMediaInventoryFindingStore"/>
internal sealed class MediaInventoryFindingStore(
    IServiceScopeFactory scopeFactory,
    IClock clock)
    : IMediaInventoryFindingStore
{
    public async Task<MediaInventoryFindingWrite> ApplyAsync(
        MediaInventoryRunClaim claim,
        Guid tenantId,
        string location,
        IReadOnlyList<MediaInventoryPendingFinding> findings,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(findings);
        if (findings.Count == 0)
        {
            return MediaInventoryFindingWrite.Nothing;
        }

        await using var scope = OpenTenantScope(tenantId, out var context);
        var now = clock.UtcNow;
        return await context.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
            if (!await OwnsRunAsync(context, claim, cancellationToken))
            {
                await transaction.RollbackAsync(cancellationToken);
                return MediaInventoryFindingWrite.Lost;
            }

            var keys = findings
                .Select(finding => finding.Locator.ObjectKey)
                .Distinct(StringComparer.Ordinal)
                .ToArray();
            var existing = await context.MediaInventoryFindings
                .Where(item =>
                    item.StorageLocation == location &&
                    keys.Contains(item.StorageKey) &&
                    item.ResolvedAtUtc == null)
                .ToListAsync(cancellationToken);

            var opened = 0;
            foreach (var pending in findings)
            {
                var match = existing.SingleOrDefault(item =>
                    item.Kind == pending.Kind &&
                    string.Equals(item.StorageKey, pending.Locator.ObjectKey, StringComparison.Ordinal));
                if (match is null)
                {
                    context.MediaInventoryFindings.Add(MediaInventoryFinding.Open(
                        tenantId,
                        pending.Kind,
                        pending.Locator,
                        pending.OwnerKind,
                        pending.OwnerId,
                        claim.RunId,
                        now));
                    opened++;
                }
                else
                {
                    match.Observe(now, claim.RunId);
                }
            }

            await context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return new MediaInventoryFindingWrite(true, opened, 0);
        });
    }

    public async Task<MediaInventoryFindingWrite> ResolveUnobservedBatchAsync(
        MediaInventoryRunClaim claim,
        string location,
        CancellationToken cancellationToken)
    {
        // Which workspace holds the next finding to close. One, not all of them: the caller runs
        // this a bounded number of times and every batch shrinks the set, so the whole backlog is
        // never materialised and a workspace with ten thousand findings is drained over as many
        // passes as it takes rather than in one transaction nobody bounded.
        await using var lookup = scopeFactory.CreateAsyncScope();
        var reader = lookup.ServiceProvider.GetRequiredService<GymDbContext>();
        var tenantId = await UnobservedTenants(reader, claim, location)
            .FirstOrDefaultAsync(cancellationToken);
        if (tenantId == Guid.Empty)
        {
            // Nothing found to close. Ownership still decides whether that is an answer about this
            // location or an answer about a run somebody else is now walking, because the caller
            // uses it to decide whether the run may be completed.
            return await OwnsRunAsync(reader, claim, cancellationToken)
                ? MediaInventoryFindingWrite.Nothing with { Drained = true }
                : MediaInventoryFindingWrite.Lost;
        }

        await using var scope = OpenTenantScope(tenantId, out var context);
        var now = clock.UtcNow;
        return await context.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
            var run = await LoadRunForUpdateAsync(context, claim, cancellationToken);
            if (run is null)
            {
                await transaction.RollbackAsync(cancellationToken);
                return MediaInventoryFindingWrite.Lost;
            }

            var batch = await context.MediaInventoryFindings
                .Where(item =>
                    item.StorageLocation == location &&
                    item.ResolvedAtUtc == null &&
                    item.LastRunId != claim.RunId)
                .OrderBy(item => item.Id)
                .Take(MediaInventoryPolicy.ResolutionBatchSize)
                .ToListAsync(cancellationToken);
            if (batch.Count == 0)
            {
                // This workspace's findings were closed between the two queries. That is an ordinary
                // outcome and not a drained location: only the query for the next workspace may say
                // that, and it says it above.
                await transaction.RollbackAsync(cancellationToken);
                return MediaInventoryFindingWrite.Nothing;
            }

            var stillLive = await LiveOwnersStillHoldingKeysAsync(
                context,
                location,
                batch,
                now,
                cancellationToken);
            foreach (var finding in batch)
            {
                // A finding about a live owner's missing object is the one kind whose resolution has
                // to name which of two things happened. If that row is still the live owner of that
                // key here, then a completed owner pass probed it and did not report it missing,
                // which can only mean the store answered with the object. If it is not, the
                // accusation's subject is gone rather than disproved.
                var provedByStat = finding.Kind != MediaInventoryFindingKind.ObjectMissingForLiveOwner ||
                    stillLive.Contains(finding.Id);
                finding.Resolve(
                    now,
                    provedByStat
                        ? MediaInventoryResolutionCodes.ObserverConsistent
                        : MediaInventoryResolutionCodes.OwnerNoLongerHoldsKey);
            }

            // The count and the rows it counts commit together, so a pass that dies between two
            // batches neither loses one nor counts one twice when it resumes.
            if (!run.RecordResolvedFindings(now, claim.LeaseToken, batch.Count))
            {
                await transaction.RollbackAsync(cancellationToken);
                return MediaInventoryFindingWrite.Lost;
            }

            await context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return new MediaInventoryFindingWrite(true, 0, batch.Count);
        });
    }

    public async Task<MediaInventoryFindingWrite> CompleteResolutionAsync(
        MediaInventoryRunClaim claim,
        string location,
        CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var now = clock.UtcNow;
        return await context.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
            var run = await LoadRunForUpdateAsync(context, claim, cancellationToken);
            if (run is null)
            {
                await transaction.RollbackAsync(cancellationToken);
                return MediaInventoryFindingWrite.Lost;
            }

            // One row, not a count: this asks whether anything is left, and stops looking the moment
            // it finds one. The run row is already locked, so nothing can open a finding for this
            // location between this answer and the flag it sets.
            var remaining = await UnobservedTenants(context, claim, location)
                .AnyAsync(cancellationToken);
            if (remaining || !run.CompleteResolution(now, claim.LeaseToken))
            {
                await transaction.RollbackAsync(cancellationToken);
                return remaining ? MediaInventoryFindingWrite.Nothing : MediaInventoryFindingWrite.Lost;
            }

            await context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return MediaInventoryFindingWrite.Nothing with { Drained = true };
        });
    }

    /// <summary>
    /// The workspaces still holding a finding this run never observed, in a fixed order and never
    /// materialised: callers take one, or ask whether there is one.
    /// </summary>
    private static IQueryable<Guid> UnobservedTenants(
        GymDbContext context,
        MediaInventoryRunClaim claim,
        string location) =>
        context.MediaInventoryFindings
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(item =>
                item.StorageLocation == location &&
                item.ResolvedAtUtc == null &&
                item.LastRunId != claim.RunId)
            .Select(item => item.TenantId)
            .Distinct()
            .OrderBy(tenantId => tenantId);

    /// <summary>
    /// Of the findings that accuse an owning row of naming a missing object, the ones whose row is
    /// still the live owner of that exact key at this location.
    /// </summary>
    private static async Task<HashSet<Guid>> LiveOwnersStillHoldingKeysAsync(
        GymDbContext context,
        string location,
        IReadOnlyList<MediaInventoryFinding> findings,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var live = new HashSet<Guid>();
        var subjects = findings
            .Where(finding =>
                finding.Kind == MediaInventoryFindingKind.ObjectMissingForLiveOwner &&
                finding.OwnerId is not null)
            .ToArray();
        if (subjects.Length == 0)
        {
            return live;
        }

        var assetSubjects = subjects
            .Where(finding => finding.OwnerKind == MediaInventoryOwnerKind.Asset)
            .ToArray();
        if (assetSubjects.Length > 0)
        {
            var assetIds = assetSubjects.Select(finding => finding.OwnerId!.Value).ToArray();
            var assets = await context.MediaAssets
                .AsNoTracking()
                .Where(item => assetIds.Contains(item.Id) && item.StorageLocation == location)
                .Select(item => new
                {
                    item.Id,
                    item.StorageKey,
                    item.Status,
                    item.PurgeAfterUtc,
                    item.PurgeClaimToken,
                    item.PurgeClaimExpiresAtUtc,
                })
                .ToListAsync(cancellationToken);
            foreach (var finding in assetSubjects)
            {
                var asset = assets.SingleOrDefault(item => item.Id == finding.OwnerId);
                if (asset is not null &&
                    string.Equals(asset.StorageKey, finding.StorageKey, StringComparison.Ordinal) &&
                    MediaInventoryClassifier.ClassifyOwnerState(
                        asset.Status,
                        asset.PurgeAfterUtc,
                        asset.PurgeClaimToken,
                        asset.PurgeClaimExpiresAtUtc,
                        now) == MediaInventoryOwnerState.Live)
                {
                    live.Add(finding.Id);
                }
            }
        }

        var derivativeSubjects = subjects
            .Where(finding => finding.OwnerKind == MediaInventoryOwnerKind.Derivative)
            .ToArray();
        if (derivativeSubjects.Length == 0)
        {
            return live;
        }

        var derivativeIds = derivativeSubjects.Select(finding => finding.OwnerId!.Value).ToArray();
        var derivatives = await (
            from derivative in context.MediaAssetDerivatives.AsNoTracking()
            join parent in context.MediaAssets.AsNoTracking()
                on new { derivative.TenantId, Id = derivative.MediaAssetId }
                equals new { parent.TenantId, parent.Id }
            where derivativeIds.Contains(derivative.Id) && derivative.StorageLocation == location
            select new
            {
                derivative.Id,
                derivative.StorageKey,
                parent.Status,
                parent.PurgeAfterUtc,
                parent.PurgeClaimToken,
                parent.PurgeClaimExpiresAtUtc,
            }).ToListAsync(cancellationToken);
        foreach (var finding in derivativeSubjects)
        {
            var derivative = derivatives.SingleOrDefault(item => item.Id == finding.OwnerId);
            if (derivative is not null &&
                string.Equals(derivative.StorageKey, finding.StorageKey, StringComparison.Ordinal) &&
                MediaInventoryClassifier.ClassifyOwnerState(
                    derivative.Status,
                    derivative.PurgeAfterUtc,
                    derivative.PurgeClaimToken,
                    derivative.PurgeClaimExpiresAtUtc,
                    now) == MediaInventoryOwnerState.Live)
            {
                live.Add(finding.Id);
            }
        }

        return live;
    }

    /// <summary>
    /// Whether the claim still owns the run, decided under the run row's own lock so that a
    /// concurrent takeover happens either entirely before this write or entirely after it.
    /// </summary>
    /// <remarks>
    /// The token decides, not the expiry. An expired lease nobody has taken is still held by its
    /// original claimant and writing under it is safe; the dangerous case is a lease somebody else
    /// has taken, and taking one replaces the token. Claiming and this check contend for the same
    /// row lock, so there is no window between them.
    /// </remarks>
    private static async Task<bool> OwnsRunAsync(
        GymDbContext context,
        MediaInventoryRunClaim claim,
        CancellationToken cancellationToken)
    {
        var run = await context.MediaInventoryRuns
            .FromSql($"""
                SELECT *, xmin FROM media."InventoryRuns"
                WHERE "Id" = {claim.RunId}
                FOR UPDATE
                """)
            .AsNoTracking()
            .SingleOrDefaultAsync(cancellationToken);
        return run is not null &&
            run.State == MediaInventoryRunState.Running &&
            run.OwnsLease(claim.LeaseToken);
    }

    /// <summary>
    /// The run this claim owns, locked and tracked so the same transaction that closes findings can
    /// also record how many it closed. Null when the claim no longer owns it, which is the caller's
    /// signal to write nothing at all.
    /// </summary>
    /// <remarks>
    /// A run is not tenant-owned, so it can be read and written from a workspace's scope without
    /// meeting the write-scope guard — which is what lets one transaction hold both halves of the
    /// count. It is not media state: nothing about an asset, a derivative or an ingest object is
    /// reachable from here.
    /// </remarks>
    private static async Task<MediaInventoryRun?> LoadRunForUpdateAsync(
        GymDbContext context,
        MediaInventoryRunClaim claim,
        CancellationToken cancellationToken)
    {
        var run = await context.MediaInventoryRuns
            .FromSql($"""
                SELECT *, xmin FROM media."InventoryRuns"
                WHERE "Id" = {claim.RunId}
                FOR UPDATE
                """)
            .SingleOrDefaultAsync(cancellationToken);
        return run is not null &&
            run.State == MediaInventoryRunState.Running &&
            run.OwnsLease(claim.LeaseToken)
            ? run
            : null;
    }

    /// <summary>
    /// One workspace's own scope, so the tenant write-scope guard applies to reconciliation exactly
    /// as it does to a request rather than being bypassed by a background sweep.
    /// </summary>
    private AsyncServiceScope OpenTenantScope(Guid tenantId, out GymDbContext context)
    {
        var scope = scopeFactory.CreateAsyncScope();
        scope.ServiceProvider.GetRequiredService<IMutableTenantContext>().SetTenant(tenantId);
        context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        return scope;
    }
}
