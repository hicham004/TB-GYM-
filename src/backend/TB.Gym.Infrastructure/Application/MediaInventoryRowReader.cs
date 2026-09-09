using Microsoft.EntityFrameworkCore;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Media;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// Everything reconciliation needs to know about the rows that can own a stored object, and nothing
/// it could change about them.
/// </summary>
/// <remarks>
/// <para>
/// Every method here answers with values — ids, keys, lengths, a classified state — and never with a
/// <c>MediaAsset</c>, a <c>MediaAssetDerivative</c>, a <c>MediaIngestObject</c> or anything else EF
/// is tracking. That is the point of the port rather than a detail of it: you cannot mutate what you
/// were never handed, so the reconciliation service has no media aggregate to clear a locator on, no
/// <c>DbSet</c> to remove a row from and no <c>SaveChanges</c> to call. An architecture test asserts
/// exactly that about this interface's signatures, because the alternative — a "read model" that
/// quietly returns an entity — moves the hole rather than closing it.
/// </para>
/// <para>
/// Each query is <c>AsNoTracking</c> and <c>IgnoreQueryFilters</c>: this pass reads across every
/// workspace by design, one query per table per page rather than one per object, and it enters no
/// tenant scope because it writes nothing. Findings, which are tenant-owned, are written elsewhere
/// under a scope of their own.
/// </para>
/// </remarks>
internal interface IMediaInventoryRowReader
{
    /// <summary>
    /// Which of these workspace ids exist. A key whose first segment names no workspace is not an
    /// application object, and a finding is a tenant-owned row that would have no tenant to own it.
    /// </summary>
    Task<IReadOnlyList<Guid>> ListKnownTenantsAsync(
        IReadOnlyCollection<Guid> candidateTenantIds,
        CancellationToken cancellationToken);

    /// <summary>
    /// Every row that currently holds one of these keys, across the three tables that can own one.
    /// </summary>
    Task<IReadOnlyDictionary<string, MediaInventoryKeyOwners>> ListLiveOwnersAsync(
        Guid tenantId,
        string location,
        IReadOnlyCollection<string> keys,
        CancellationToken cancellationToken);

    /// <summary>
    /// Keys that a purged row still names through its retained scan evidence. This is what separates
    /// "the database says these bytes were deleted" from "the database has never heard of this
    /// object", and it needs no extra column: the evidence keeps the locator a purge clears.
    /// </summary>
    Task<IReadOnlySet<string>> ListPurgedEvidenceKeysAsync(
        Guid tenantId,
        string location,
        IReadOnlyCollection<string> keys,
        CancellationToken cancellationToken);

    /// <summary>One bounded slice of the table the owner pass is currently walking.</summary>
    /// <remarks>
    /// Keyset paging on the primary key, expressed in SQL so the ordering is PostgreSQL's own and a
    /// resumed pass continues exactly where the last committed cursor left off. An offset would let
    /// a concurrent insert shift the window and step over a row, which is the one failure mode a
    /// reconciliation pass must not have: a row it never examined would be indistinguishable from a
    /// row it found consistent.
    /// </remarks>
    Task<IReadOnlyList<MediaInventoryOwnerRow>> ListOwnerRowsAsync(
        MediaInventoryProbeStage stage,
        Guid? cursorId,
        int batchSize,
        CancellationToken cancellationToken);
}

/// <summary>One row that holds a key, reduced to what classification needs.</summary>
internal sealed record MediaInventoryOwnerReference(
    MediaInventoryOwnerKind Kind,
    Guid Id,
    MediaInventoryOwnerState State,
    long? ComparableLength);

/// <summary>
/// How many live rows claim one key, and which row it is when exactly one does. A key two rows claim
/// names no single owner, which is why the count is carried rather than the first row found.
/// </summary>
internal sealed record MediaInventoryKeyOwners(int Count, MediaInventoryOwnerReference Single);

/// <summary>One row of the owner pass, as values rather than as the aggregate it was read from.</summary>
internal sealed record MediaInventoryOwnerRow(
    Guid Id,
    Guid TenantId,
    MediaInventoryOwnerKind Kind,
    string StorageLocation,
    string? StorageKey,
    string? EvidenceKey,
    MediaInventoryOwnerState State,
    MediaInventoryFindingKind? Mismatch,
    int AttemptCount,
    DateTimeOffset? LastAttemptAtUtc)
{
    /// <summary>
    /// The key a finding about this row is filed under. A purged row has no live key, so its
    /// retained scan evidence names the object instead; a row that predates that evidence names
    /// nothing at all and therefore cannot be the subject of a finding.
    /// </summary>
    public string? FindingKey => StorageKey ?? EvidenceKey;

    public StorageObjectLocator? TryLocator() =>
        FindingKey is { } key ? new StorageObjectLocator(TenantId, StorageLocation, key) : null;
}

internal sealed class MediaInventoryRowReader(GymDbContext dbContext, IClock clock)
    : IMediaInventoryRowReader
{
    public async Task<IReadOnlyList<Guid>> ListKnownTenantsAsync(
        IReadOnlyCollection<Guid> candidateTenantIds,
        CancellationToken cancellationToken)
    {
        var candidates = candidateTenantIds.ToArray();
        return await dbContext.Tenants
            .AsNoTracking()
            .Where(tenant => candidates.Contains(tenant.Id))
            .Select(tenant => tenant.Id)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyDictionary<string, MediaInventoryKeyOwners>> ListLiveOwnersAsync(
        Guid tenantId,
        string location,
        IReadOnlyCollection<string> keys,
        CancellationToken cancellationToken)
    {
        var now = clock.UtcNow;
        var wanted = keys.ToArray();
        var owners = new Dictionary<string, MediaInventoryKeyOwners>(StringComparer.Ordinal);

        var assets = await dbContext.MediaAssets
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(item =>
                item.TenantId == tenantId &&
                item.StorageLocation == location &&
                item.StorageKey != null &&
                wanted.Contains(item.StorageKey))
            .Select(item => new
            {
                item.Id,
                item.StorageKey,
                item.Status,
                item.PurgeAfterUtc,
                item.PurgeClaimToken,
                item.PurgeClaimExpiresAtUtc,
                item.Length,
            })
            .ToListAsync(cancellationToken);
        foreach (var asset in assets)
        {
            Add(owners, asset.StorageKey!, new MediaInventoryOwnerReference(
                MediaInventoryOwnerKind.Asset,
                asset.Id,
                MediaInventoryClassifier.ClassifyOwnerState(
                    asset.Status,
                    asset.PurgeAfterUtc,
                    asset.PurgeClaimToken,
                    asset.PurgeClaimExpiresAtUtc,
                    now),
                asset.Length));
        }

        var derivatives = await (
            from derivative in dbContext.MediaAssetDerivatives.IgnoreQueryFilters().AsNoTracking()
            join parent in dbContext.MediaAssets.IgnoreQueryFilters().AsNoTracking()
                on new { derivative.TenantId, Id = derivative.MediaAssetId }
                equals new { parent.TenantId, parent.Id }
            where derivative.TenantId == tenantId &&
                  derivative.StorageLocation == location &&
                  derivative.StorageKey != null &&
                  wanted.Contains(derivative.StorageKey)
            select new
            {
                derivative.Id,
                derivative.StorageKey,
                derivative.Length,
                ParentStatus = parent.Status,
                parent.PurgeAfterUtc,
                parent.PurgeClaimToken,
                parent.PurgeClaimExpiresAtUtc,
            }).ToListAsync(cancellationToken);
        foreach (var derivative in derivatives)
        {
            Add(owners, derivative.StorageKey!, new MediaInventoryOwnerReference(
                MediaInventoryOwnerKind.Derivative,
                derivative.Id,
                // A derivative inherits its parent's cleanup state: it is the parent's purge that
                // deletes it, so the parent is what decides whether another authority owns the row.
                MediaInventoryClassifier.ClassifyOwnerState(
                    derivative.ParentStatus,
                    derivative.PurgeAfterUtc,
                    derivative.PurgeClaimToken,
                    derivative.PurgeClaimExpiresAtUtc,
                    now),
                derivative.Length));
        }

        var ingests = await dbContext.MediaIngestObjects
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(item =>
                item.TenantId == tenantId &&
                item.StorageLocation == location &&
                item.StorageKey != null &&
                wanted.Contains(item.StorageKey))
            .Select(item => new
            {
                item.Id,
                item.StorageKey,
                item.Status,
                item.PurgeAfterUtc,
                item.StoredAtUtc,
                item.AccountedBytes,
            })
            .ToListAsync(cancellationToken);
        foreach (var ingest in ingests)
        {
            Add(owners, ingest.StorageKey!, new MediaInventoryOwnerReference(
                MediaInventoryOwnerKind.IngestObject,
                ingest.Id,
                ingest.Status == MediaIngestObjectStatus.Reserved && ingest.PurgeAfterUtc > now
                    ? MediaInventoryOwnerState.ReservationInFlight
                    : MediaInventoryOwnerState.OwnedByPurge,
                // Before the write is confirmed the accounted bytes are a conservative reservation
                // rather than a measurement, so comparing them to an object would compare a bound
                // with a fact.
                ingest.StoredAtUtc is null ? null : ingest.AccountedBytes));
        }

        return owners;
    }

    public async Task<IReadOnlySet<string>> ListPurgedEvidenceKeysAsync(
        Guid tenantId,
        string location,
        IReadOnlyCollection<string> keys,
        CancellationToken cancellationToken)
    {
        var wanted = keys.ToArray();
        var assetKeys = await dbContext.MediaAssets
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(item =>
                item.TenantId == tenantId &&
                item.StorageKey == null &&
                item.ScanStorageLocation == location &&
                item.ScanStorageKey != null &&
                wanted.Contains(item.ScanStorageKey))
            .Select(item => item.ScanStorageKey!)
            .ToListAsync(cancellationToken);
        var derivativeKeys = await dbContext.MediaAssetDerivatives
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(item =>
                item.TenantId == tenantId &&
                item.StorageKey == null &&
                item.ScanStorageLocation == location &&
                item.ScanStorageKey != null &&
                wanted.Contains(item.ScanStorageKey))
            .Select(item => item.ScanStorageKey!)
            .ToListAsync(cancellationToken);
        return assetKeys.Concat(derivativeKeys).ToHashSet(StringComparer.Ordinal);
    }

    public async Task<IReadOnlyList<MediaInventoryOwnerRow>> ListOwnerRowsAsync(
        MediaInventoryProbeStage stage,
        Guid? cursorId,
        int batchSize,
        CancellationToken cancellationToken)
    {
        var now = clock.UtcNow;
        var after = cursorId ?? Guid.Empty;
        switch (stage)
        {
            case MediaInventoryProbeStage.Assets:
            {
                var rows = await dbContext.MediaAssets
                    .FromSql($"""
                        SELECT *, xmin FROM media."Assets"
                        WHERE "StorageKey" IS NOT NULL AND "Id" > {after}
                        ORDER BY "Id"
                        LIMIT {batchSize}
                        """)
                    .IgnoreQueryFilters()
                    .AsNoTracking()
                    .ToListAsync(cancellationToken);
                return rows.Select(item => new MediaInventoryOwnerRow(
                    item.Id,
                    item.TenantId,
                    MediaInventoryOwnerKind.Asset,
                    item.StorageLocation!,
                    item.StorageKey,
                    null,
                    MediaInventoryClassifier.ClassifyOwnerState(
                        item.Status,
                        item.PurgeAfterUtc,
                        item.PurgeClaimToken,
                        item.PurgeClaimExpiresAtUtc,
                        now),
                    null,
                    item.PurgeAttemptCount,
                    item.LastPurgeAttemptAtUtc)).ToList();
            }

            case MediaInventoryProbeStage.Derivatives:
            {
                var rows = await dbContext.MediaAssetDerivatives
                    .FromSql($"""
                        SELECT *, xmin FROM media."AssetDerivatives"
                        WHERE "Id" > {after}
                        ORDER BY "Id"
                        LIMIT {batchSize}
                        """)
                    .IgnoreQueryFilters()
                    .AsNoTracking()
                    .ToListAsync(cancellationToken);
                if (rows.Count == 0)
                {
                    return [];
                }

                var parentIds = rows.Select(item => item.MediaAssetId).Distinct().ToArray();
                var parents = await dbContext.MediaAssets
                    .IgnoreQueryFilters()
                    .AsNoTracking()
                    .Where(item => parentIds.Contains(item.Id))
                    .Select(item => new
                    {
                        item.Id,
                        item.Status,
                        item.PurgeAfterUtc,
                        item.PurgeClaimToken,
                        item.PurgeClaimExpiresAtUtc,
                    })
                    .ToDictionaryAsync(item => item.Id, cancellationToken);
                return rows
                    .Where(item => parents.ContainsKey(item.MediaAssetId))
                    .Select(item =>
                    {
                        var parent = parents[item.MediaAssetId];
                        return new MediaInventoryOwnerRow(
                            item.Id,
                            item.TenantId,
                            MediaInventoryOwnerKind.Derivative,
                            item.StorageLocation,
                            item.StorageKey,
                            item.ScanStorageKey,
                            // A derivative inherits its parent's cleanup state: the parent's purge is
                            // what deletes it, so the parent decides whether another authority owns
                            // this row.
                            MediaInventoryClassifier.ClassifyOwnerState(
                                parent.Status,
                                parent.PurgeAfterUtc,
                                parent.PurgeClaimToken,
                                parent.PurgeClaimExpiresAtUtc,
                                now),
                            // Neither shape the finalize transaction can produce, because it purges
                            // the derivatives and the asset in one commit: either one is evidence of
                            // something the code does not currently do.
                            (parent.Status == MediaAssetStatus.Purged) == (item.PurgedAtUtc is not null)
                                ? null
                                : MediaInventoryFindingKind.DerivativePurgeStateMismatch,
                            0,
                            null);
                    })
                    .ToList();
            }

            case MediaInventoryProbeStage.IngestObjects:
            {
                var rows = await dbContext.MediaIngestObjects
                    .FromSql($"""
                        SELECT *, xmin FROM media."IngestObjects"
                        WHERE "StorageKey" IS NOT NULL AND "Id" > {after}
                        ORDER BY "Id"
                        LIMIT {batchSize}
                        """)
                    .IgnoreQueryFilters()
                    .AsNoTracking()
                    .ToListAsync(cancellationToken);
                return rows.Select(item => new MediaInventoryOwnerRow(
                    item.Id,
                    item.TenantId,
                    MediaInventoryOwnerKind.IngestObject,
                    item.StorageLocation,
                    item.StorageKey,
                    null,
                    // An ingest object is never "supposed to exist": its reservation is written
                    // before the put, so absence is an ordinary state and never a finding. It is
                    // walked here only so that a cleanup stuck for a day becomes visible.
                    item.Status == MediaIngestObjectStatus.Reserved && item.PurgeAfterUtc > now
                        ? MediaInventoryOwnerState.ReservationInFlight
                        : MediaInventoryOwnerState.OwnedByPurge,
                    null,
                    item.PurgeAttemptCount,
                    item.LastPurgeAttemptAtUtc)).ToList();
            }

            default:
                return [];
        }
    }

    private static void Add(
        Dictionary<string, MediaInventoryKeyOwners> owners,
        string key,
        MediaInventoryOwnerReference reference)
    {
        owners[key] = owners.TryGetValue(key, out var existing)
            ? existing with { Count = existing.Count + 1 }
            : new MediaInventoryKeyOwners(1, reference);
    }
}
