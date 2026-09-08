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
    /// Resolves every unresolved finding at this location that the run identified by the claim did
    /// not observe. Called only for a run that finished both passes with no outstanding failure, and
    /// which therefore examined every object and every row this location has.
    /// </summary>
    Task<MediaInventoryFindingWrite> SweepUnobservedAsync(
        MediaInventoryRunClaim claim,
        string location,
        CancellationToken cancellationToken);
}

/// <summary>Which run is writing, and the lease token that says it still may.</summary>
internal readonly record struct MediaInventoryRunClaim(Guid RunId, Guid LeaseToken);

/// <summary>
/// What one write did. <see cref="Owned"/> is false when the lease had moved on, in which case
/// nothing at all was written and the caller must stop rather than carry on.
/// </summary>
internal readonly record struct MediaInventoryFindingWrite(bool Owned, int Opened, int Resolved)
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

    public async Task<MediaInventoryFindingWrite> SweepUnobservedAsync(
        MediaInventoryRunClaim claim,
        string location,
        CancellationToken cancellationToken)
    {
        // Ownership is established before anything is read, not only before something is written.
        // "Nothing needed resolving" from a worker that no longer holds the run is not an answer
        // about the location; it is an answer about a run somebody else is now walking, and the
        // caller uses this to decide whether it may complete that run.
        await using var lookup = scopeFactory.CreateAsyncScope();
        var reader = lookup.ServiceProvider.GetRequiredService<GymDbContext>();
        if (!await OwnsRunAsync(reader, claim, cancellationToken))
        {
            return MediaInventoryFindingWrite.Lost;
        }

        // Which workspaces still hold a standing finding this run never observed. A cross-tenant
        // read, and only a read: every write below happens inside the workspace's own scope.
        var tenantIds = await reader.MediaInventoryFindings
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(item =>
                item.StorageLocation == location &&
                item.ResolvedAtUtc == null &&
                item.LastRunId != claim.RunId)
            .Select(item => item.TenantId)
            .Distinct()
            .OrderBy(tenantId => tenantId)
            .ToListAsync(cancellationToken);

        var resolved = 0;
        foreach (var tenantId in tenantIds)
        {
            var swept = await SweepTenantAsync(claim, tenantId, location, cancellationToken);
            if (!swept.Owned)
            {
                return new MediaInventoryFindingWrite(false, 0, resolved);
            }

            resolved += swept.Resolved;
        }

        return new MediaInventoryFindingWrite(true, 0, resolved);
    }

    private async Task<MediaInventoryFindingWrite> SweepTenantAsync(
        MediaInventoryRunClaim claim,
        Guid tenantId,
        string location,
        CancellationToken cancellationToken)
    {
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

            var unobserved = await context.MediaInventoryFindings
                .Where(item =>
                    item.StorageLocation == location &&
                    item.ResolvedAtUtc == null &&
                    item.LastRunId != claim.RunId)
                .ToListAsync(cancellationToken);
            if (unobserved.Count == 0)
            {
                await transaction.RollbackAsync(cancellationToken);
                return MediaInventoryFindingWrite.Nothing;
            }

            var stillLive = await LiveOwnersStillHoldingKeysAsync(
                context,
                location,
                unobserved,
                now,
                cancellationToken);
            foreach (var finding in unobserved)
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

            await context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return new MediaInventoryFindingWrite(true, 0, unobserved.Count);
        });
    }

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
