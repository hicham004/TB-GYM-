using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Media;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// Compares the objects at the reconciled storage location with the rows that own them, and records
/// what it found. It changes no media row, releases no allowance and deletes nothing.
/// </summary>
/// <remarks>
/// <para>
/// The guarantee that it cannot repair anything is structural rather than editorial: its constructor
/// takes <see cref="IObjectInventory"/>, which lists and stats, and never <see cref="IObjectStorage"/>,
/// which writes and deletes. There is no object here to call delete on. An architecture test holds
/// that shape, because a later constructor parameter is exactly how a read-only sweep stops being one.
/// </para>
/// <para>
/// Two passes share one run. The inventory pass enumerates stored objects and asks the database who
/// owns each key; the owner pass walks rows with a live key and asks the store whether their object
/// exists. Neither holds a database transaction across a provider call, for the reason the purge
/// sweep does not either: remote latency must not hold a transaction open.
/// </para>
/// <para>
/// Where an existing authority already owns a row — the leased purge sweep, the ingest reservation
/// lease — this sweep observes and stays out of the way. Two authorities over one row is how a lease
/// invariant gets broken, so those rows are counted and deliberately not reported.
/// </para>
/// </remarks>
internal sealed class MediaInventoryReconciliationService(
    GymDbContext dbContext,
    IServiceScopeFactory scopeFactory,
    IObjectInventory inventory,
    IOptions<MediaStorageOptions> storageOptions,
    IClock clock,
    ILogger<MediaInventoryReconciliationService> logger)
    : IMediaInventoryReconciliationService
{
    private static readonly Action<ILogger, Guid, string, int, Exception?> LogPageFailure =
        LoggerMessage.Define<Guid, string, int>(
            LogLevel.Warning,
            new EventId(5521, "MediaInventoryPageFailed"),
            "Media inventory run {RunId} could not read a page: {FailureCode}. Failures so far: {PageFailureCount}.");

    private static readonly Action<ILogger, Guid, Exception?> LogRunAbandoned =
        LoggerMessage.Define<Guid>(
            LogLevel.Warning,
            new EventId(5522, "MediaInventoryRunAbandoned"),
            "Media inventory run {RunId} was abandoned: its resume cursors are older than one day.");

    private readonly TimeSpan runLease =
        TimeSpan.FromSeconds(storageOptions.Value.Reconciliation.RunLeaseSeconds);

    public async Task<MediaInventoryReconciliationOutcome> ReconcileAsync(
        int objectBudget,
        int ownerProbeBudget,
        CancellationToken cancellationToken)
    {
        if (!inventory.IsAvailable || (objectBudget <= 0 && ownerProbeBudget <= 0))
        {
            return MediaInventoryReconciliationOutcome.Idle;
        }

        var location = inventory.ReconciledLocation;
        var run = await ClaimRunAsync(location, cancellationToken);
        if (run is null)
        {
            return MediaInventoryReconciliationOutcome.Idle;
        }

        var totals = new ReconciliationTotals();
        var live = await RunInventoryPassAsync(run, location, objectBudget, totals, cancellationToken);
        if (live is not null)
        {
            live = await RunOwnerPassAsync(live, location, ownerProbeBudget, totals, cancellationToken);
        }

        var state = live is null
            ? MediaInventoryRunState.Running
            : await FinalizeRunAsync(live, cancellationToken);
        return new MediaInventoryReconciliationOutcome(
            run.RunId,
            state,
            totals.ObjectsScanned,
            totals.OwnersProbed,
            totals.FindingsOpened,
            totals.FindingsResolved,
            totals.PageFailures);
    }

    // ---------------------------------------------------------------- run lifecycle

    /// <summary>
    /// Takes over the unfinished run for this location, or starts one. A run older than the maximum
    /// age is abandoned rather than resumed: its cursor describes an enumeration the store may no
    /// longer be able to continue, and silently restarting under the old row would make the counters
    /// describe two different walks.
    /// </summary>
    private async Task<RunProgress?> ClaimRunAsync(string location, CancellationToken cancellationToken)
    {
        var now = clock.UtcNow;
        return await dbContext.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
            var existing = await dbContext.MediaInventoryRuns
                .FromSql($"""
                    SELECT *, xmin FROM media."InventoryRuns"
                    WHERE "Location" = {location}
                      AND "State" = 'Running'
                    ORDER BY "StartedAtUtc"
                    LIMIT 1
                    FOR UPDATE SKIP LOCKED
                    """)
                .SingleOrDefaultAsync(cancellationToken);

            if (existing is not null && existing.IsStale(now))
            {
                existing.Abandon(now);
                await dbContext.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                LogRunAbandoned(logger, existing.Id, null);
                return null;
            }

            if (existing is not null && !existing.IsClaimable(now))
            {
                // Another replica holds a live lease on it. Nothing to do this tick.
                await transaction.RollbackAsync(cancellationToken);
                return null;
            }

            var token = Guid.NewGuid();
            MediaInventoryRun run;
            if (existing is null)
            {
                run = MediaInventoryRun.Start(location, now, runLease, token);
                dbContext.MediaInventoryRuns.Add(run);
            }
            else
            {
                run = existing;
                run.Claim(now, runLease, token);
            }

            try
            {
                await dbContext.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
            }
            catch (DbUpdateException exception)
                when (exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
            {
                // Two replicas ticked at the same moment and both found no run to take over. The
                // partial unique index is what settles it, and losing that race is the ordinary
                // outcome rather than an error: the winner is already walking this location.
                dbContext.MediaInventoryRuns.Entry(run).State = EntityState.Detached;
                await transaction.RollbackAsync(cancellationToken);
                return null;
            }

            return new RunProgress(
                run.Id,
                token,
                run.InventoryCursor,
                run.InventoryCompleted,
                run.ProbeStage,
                run.ProbeCursorId,
                run.PageFailureCount);
        });
    }

    private async Task<MediaInventoryRunState> FinalizeRunAsync(
        RunProgress run,
        CancellationToken cancellationToken)
    {
        var now = clock.UtcNow;
        return await dbContext.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
            var stored = await LoadForUpdateAsync(dbContext, run.RunId, cancellationToken);
            if (stored is null || !stored.OwnsLease(run.Token))
            {
                await transaction.RollbackAsync(cancellationToken);
                return MediaInventoryRunState.Running;
            }

            if (stored.HasExhaustedFailures)
            {
                stored.Fail(now, run.Token);
            }
            else if (stored.CanComplete)
            {
                stored.Complete(now, run.Token);
            }
            else
            {
                // Budget ran out with work left. The run stays Running with its cursors intact and
                // the next tick resumes it — and, because it is not Completed, nothing can read it
                // as a statement that the location was fully examined. The lease is handed back
                // rather than left to expire, so the next pass can pick the run up at once.
                stored.ReleaseClaim(now, run.Token);
            }

            var state = stored.State;
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return state;
        });
    }

    // ---------------------------------------------------------------- inventory pass

    private async Task<RunProgress?> RunInventoryPassAsync(
        RunProgress run,
        string location,
        int objectBudget,
        ReconciliationTotals totals,
        CancellationToken cancellationToken)
    {
        var scanned = 0;
        while (run is { InventoryCompleted: false } &&
               scanned < objectBudget &&
               !cancellationToken.IsCancellationRequested)
        {
            var pageSize = Math.Min(MediaInventoryPolicy.PageSize, objectBudget - scanned);
            // No transaction is open here, and none may be: this is a remote call.
            var page = await inventory.ListAsync(run.InventoryCursor, pageSize, cancellationToken);
            if (page.Status != ObjectStorageOperationStatus.Success)
            {
                var failed = await RecordFailureAsync(run, page.FailureCode, cancellationToken);
                totals.PageFailures++;
                return failed;
            }

            var tally = await ClassifyPageAsync(run, location, page.Entries, cancellationToken);
            scanned += page.Entries.Count;
            totals.Add(tally);
            var advanced = await RecordPageAsync(run, tally, page.NextCursor, page.HasMore, cancellationToken);
            if (advanced is null)
            {
                return null;
            }

            run = advanced;
        }

        return run;
    }

    /// <summary>
    /// Turns one page of stored objects into findings. Keys are attributed to a workspace before
    /// anything else: a key outside the canonical grammar, or one whose tenant segment names no
    /// workspace, is not an application object and is counted rather than judged.
    /// </summary>
    private async Task<MediaInventoryPageTally> ClassifyPageAsync(
        RunProgress run,
        string location,
        IReadOnlyList<ObjectInventoryEntry> entries,
        CancellationToken cancellationToken)
    {
        var attributed = new Dictionary<Guid, List<AttributedObject>>();
        var unattributable = 0;
        foreach (var entry in entries)
        {
            if (!TryAttribute(entry, location, out var tenantId, out var locator))
            {
                unattributable++;
                continue;
            }

            if (!attributed.TryGetValue(tenantId, out var forTenant))
            {
                forTenant = [];
                attributed[tenantId] = forTenant;
            }

            forTenant.Add(new AttributedObject(locator!, entry));
        }

        if (attributed.Count == 0)
        {
            return new MediaInventoryPageTally(entries.Count, 0, 0, unattributable, 0, 0);
        }

        var candidateTenants = attributed.Keys.ToArray();
        var knownTenants = await dbContext.Tenants
            .AsNoTracking()
            .Where(tenant => candidateTenants.Contains(tenant.Id))
            .Select(tenant => tenant.Id)
            .ToListAsync(cancellationToken);

        var skippedRecent = 0;
        var skippedOwned = 0;
        var opened = 0;
        var resolved = 0;
        foreach (var (tenantId, objects) in attributed)
        {
            if (!knownTenants.Contains(tenantId))
            {
                unattributable += objects.Count;
                continue;
            }

            var tallied = await ClassifyTenantObjectsAsync(
                run,
                tenantId,
                location,
                objects,
                cancellationToken);
            skippedRecent += tallied.SkippedRecent;
            skippedOwned += tallied.SkippedOwnedByPurge;
            opened += tallied.FindingsOpened;
            resolved += tallied.FindingsResolved;
        }

        return new MediaInventoryPageTally(
            entries.Count,
            skippedRecent,
            skippedOwned,
            unattributable,
            opened,
            resolved);
    }

    private async Task<MediaInventoryPageTally> ClassifyTenantObjectsAsync(
        RunProgress run,
        Guid tenantId,
        string location,
        IReadOnlyList<AttributedObject> objects,
        CancellationToken cancellationToken)
    {
        var now = clock.UtcNow;
        var keys = objects.Select(item => item.Locator.ObjectKey).ToArray();
        var owners = await LoadLiveOwnersAsync(tenantId, location, keys, cancellationToken);
        var unowned = keys
            .Where(key => !owners.ContainsKey(key))
            .ToArray();
        var purgedOwners = unowned.Length == 0
            ? []
            : await LoadPurgedEvidenceKeysAsync(tenantId, location, unowned, cancellationToken);

        var skippedRecent = 0;
        var skippedOwned = 0;
        var findings = new List<PendingFinding>();
        var consistent = new List<string>();
        foreach (var candidate in objects)
        {
            var key = candidate.Locator.ObjectKey;
            owners.TryGetValue(key, out var owner);
            var verdict = MediaInventoryClassifier.ClassifyObject(new ObservedObject(
                KeyIsCanonical: true,
                TenantIsKnown: true,
                LiveOwnerCount: owner?.Count ?? 0,
                OwnerState: owner?.Count == 1 ? owner.Single.State : null,
                OwnerLength: owner?.Count == 1 ? owner.Single.ComparableLength : null,
                HasPurgedOwner: purgedOwners.Contains(key),
                ObjectLength: candidate.Entry.Length,
                LastModifiedUtc: candidate.Entry.LastModifiedUtc,
                Now: now));

            switch (verdict.Outcome)
            {
                case MediaInventoryObjectOutcome.SkippedRecent:
                    skippedRecent++;
                    break;
                case MediaInventoryObjectOutcome.SkippedOwnedByPurge:
                    skippedOwned++;
                    break;
                case MediaInventoryObjectOutcome.Consistent:
                    consistent.Add(key);
                    break;
                case MediaInventoryObjectOutcome.Finding when verdict.Finding is { } kind:
                    findings.Add(new PendingFinding(
                        kind,
                        candidate.Locator,
                        // A duplicate claim names no single owner: saying which of the two rows it
                        // belongs to would describe the defect as the property of whichever row was
                        // read first.
                        kind == MediaInventoryFindingKind.DuplicateKeyOwnership || owner?.Count != 1
                            ? MediaInventoryOwnerKind.None
                            : owner.Single.Kind,
                        kind == MediaInventoryFindingKind.DuplicateKeyOwnership || owner?.Count != 1
                            ? null
                            : owner.Single.Id));
                    break;
                default:
                    break;
            }
        }

        var (opened, resolvedCount) = await ApplyFindingsAsync(
            run,
            tenantId,
            location,
            findings,
            consistent,
            cancellationToken);
        return new MediaInventoryPageTally(0, skippedRecent, skippedOwned, 0, opened, resolvedCount);
    }

    // ---------------------------------------------------------------- owner pass

    private async Task<RunProgress?> RunOwnerPassAsync(
        RunProgress run,
        string location,
        int ownerProbeBudget,
        ReconciliationTotals totals,
        CancellationToken cancellationToken)
    {
        var examined = 0;
        while (run is { ProbeStage: not MediaInventoryProbeStage.Completed } &&
               examined < ownerProbeBudget &&
               !cancellationToken.IsCancellationRequested)
        {
            var batchSize = Math.Min(OwnerBatchSize, ownerProbeBudget - examined);
            var rows = await LoadOwnerRowsAsync(run.ProbeStage, run.ProbeCursorId, batchSize, cancellationToken);
            if (rows.Count == 0)
            {
                var advancedStage = NextStage(run.ProbeStage);
                var moved = await RecordProbesAsync(
                    run,
                    default,
                    advancedStage,
                    null,
                    cancellationToken);
                if (moved is null)
                {
                    return null;
                }

                run = moved;
                continue;
            }

            var outcome = await ProbeOwnerRowsAsync(run, location, rows, cancellationToken);
            examined += rows.Count;
            totals.Add(outcome.Tally);
            if (outcome.FailureCode is { } failure)
            {
                totals.PageFailures++;
                return await RecordFailureAsync(run, failure, cancellationToken);
            }

            var advanced = await RecordProbesAsync(
                run,
                outcome.Tally,
                run.ProbeStage,
                rows[^1].Id,
                cancellationToken);
            if (advanced is null)
            {
                return null;
            }

            run = advanced;
        }

        return run;
    }

    /// <summary>
    /// Asks the store about the rows in one batch that are supposed to have an object, and
    /// classifies the rest without a provider call at all.
    /// </summary>
    /// <remarks>
    /// A stat that fails is a page failure, never an absence. The distinction is the whole
    /// difference between "this workspace has lost a photo" and "the network was busy".
    /// </remarks>
    private async Task<OwnerProbeOutcome> ProbeOwnerRowsAsync(
        RunProgress run,
        string location,
        IReadOnlyList<OwnerRow> rows,
        CancellationToken cancellationToken)
    {
        var now = clock.UtcNow;
        var probed = 0;
        var skippedNotReconciled = 0;
        var skippedOwned = 0;
        var byTenant = new Dictionary<Guid, (List<PendingFinding> Findings, List<string> Consistent)>();

        foreach (var row in rows)
        {
            if (!string.Equals(row.StorageLocation, location, StringComparison.Ordinal))
            {
                // A row at another location — local-v1, or one a future phase introduces. It is
                // never probed and never judged, only counted, so a completed run is not read as
                // having verified it.
                skippedNotReconciled++;
                continue;
            }

            if (!byTenant.TryGetValue(row.TenantId, out var bucket))
            {
                bucket = ([], []);
                byTenant[row.TenantId] = bucket;
            }

            if (row.Mismatch is { } mismatch)
            {
                if (row.TryLocator() is { } subject)
                {
                    bucket.Findings.Add(new PendingFinding(mismatch, subject, row.Kind, row.Id));
                }

                continue;
            }

            if (row.State != MediaInventoryOwnerState.Live)
            {
                skippedOwned++;
                if (MediaInventoryClassifier.IsCleanupStuck(row.AttemptCount, row.LastAttemptAtUtc, now) &&
                    row.TryLocator() is { } stuck)
                {
                    bucket.Findings.Add(new PendingFinding(
                        MediaInventoryFindingKind.CleanupStuck,
                        stuck,
                        row.Kind,
                        row.Id));
                }

                continue;
            }

            if (row.StorageKey is null || row.TryLocator() is not { } locator)
            {
                continue;
            }

            var stat = await inventory.StatAsync(locator, cancellationToken);
            probed++;
            if (stat.Status == ObjectStorageOperationStatus.Failed)
            {
                var partial = await ApplyPendingAsync(run, byTenant, cancellationToken);
                return new OwnerProbeOutcome(
                    new MediaInventoryProbeTally(
                        probed,
                        skippedNotReconciled,
                        skippedOwned,
                        partial.Opened,
                        partial.Resolved),
                    stat.FailureCode ?? "storage_provider_error");
            }

            var missing = stat.Status == ObjectStorageOperationStatus.NotFound;
            if (MediaInventoryClassifier.ClassifyOwner(row.State, missing) is { } kind)
            {
                bucket.Findings.Add(new PendingFinding(kind, locator, row.Kind, row.Id));
            }
            else if (!missing)
            {
                bucket.Consistent.Add(locator.ObjectKey);
            }
        }

        var (opened, resolved) = await ApplyPendingAsync(run, byTenant, cancellationToken);
        return new OwnerProbeOutcome(
            new MediaInventoryProbeTally(probed, skippedNotReconciled, skippedOwned, opened, resolved),
            null);
    }

    private async Task<(int Opened, int Resolved)> ApplyPendingAsync(
        RunProgress run,
        Dictionary<Guid, (List<PendingFinding> Findings, List<string> Consistent)> byTenant,
        CancellationToken cancellationToken)
    {
        var opened = 0;
        var resolved = 0;
        foreach (var (tenantId, work) in byTenant)
        {
            if (work.Findings.Count == 0 && work.Consistent.Count == 0)
            {
                continue;
            }

            var applied = await ApplyFindingsAsync(
                run,
                tenantId,
                inventory.ReconciledLocation,
                work.Findings,
                work.Consistent,
                cancellationToken);
            opened += applied.Opened;
            resolved += applied.Resolved;
        }

        byTenant.Clear();
        return (opened, resolved);
    }

    // ---------------------------------------------------------------- durable writes

    /// <summary>
    /// Opens or re-observes the findings for one workspace, and resolves the ones whose condition
    /// this pass saw put right. Every write happens inside that workspace's own scope, so the tenant
    /// write-scope guard applies to reconciliation exactly as it does to a request.
    /// </summary>
    private async Task<(int Opened, int Resolved)> ApplyFindingsAsync(
        RunProgress run,
        Guid tenantId,
        string location,
        List<PendingFinding> findings,
        List<string> consistentKeys,
        CancellationToken cancellationToken)
    {
        if (findings.Count == 0 && consistentKeys.Count == 0)
        {
            return (0, 0);
        }

        await using var scope = scopeFactory.CreateAsyncScope();
        var provider = scope.ServiceProvider;
        provider.GetRequiredService<IMutableTenantContext>().SetTenant(tenantId);
        var context = provider.GetRequiredService<GymDbContext>();
        var now = clock.UtcNow;
        var touchedKeys = findings.Select(item => item.Locator.ObjectKey)
            .Concat(consistentKeys)
            .Distinct(StringComparer.Ordinal)
            .ToArray();
        var existing = await context.MediaInventoryFindings
            .Where(item =>
                item.StorageLocation == location &&
                touchedKeys.Contains(item.StorageKey) &&
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
                    run.RunId,
                    now));
                opened++;
            }
            else
            {
                match.Observe(now, run.RunId);
            }
        }

        var stillOpen = findings
            .Select(item => (item.Kind, item.Locator.ObjectKey))
            .ToHashSet();
        var resolved = 0;
        foreach (var candidate in existing)
        {
            if (stillOpen.Contains((candidate.Kind, candidate.StorageKey)) ||
                !touchedKeys.Contains(candidate.StorageKey, StringComparer.Ordinal))
            {
                continue;
            }

            candidate.Resolve(now, MediaInventoryResolutionCodes.ObserverConsistent);
            resolved++;
        }

        await context.SaveChangesAsync(cancellationToken);
        return (opened, resolved);
    }

    private async Task<RunProgress?> RecordPageAsync(
        RunProgress run,
        MediaInventoryPageTally tally,
        string? nextCursor,
        bool hasMore,
        CancellationToken cancellationToken)
    {
        var now = clock.UtcNow;
        return await dbContext.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
            var stored = await LoadForUpdateAsync(dbContext, run.RunId, cancellationToken);
            if (stored is null ||
                !stored.RecordInventoryPage(now, run.Token, runLease, tally, nextCursor, hasMore))
            {
                await transaction.RollbackAsync(cancellationToken);
                return null;
            }

            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return run with
            {
                InventoryCursor = stored.InventoryCursor,
                InventoryCompleted = stored.InventoryCompleted,
            };
        });
    }

    private async Task<RunProgress?> RecordProbesAsync(
        RunProgress run,
        MediaInventoryProbeTally tally,
        MediaInventoryProbeStage stage,
        Guid? cursorId,
        CancellationToken cancellationToken)
    {
        var now = clock.UtcNow;
        return await dbContext.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
            var stored = await LoadForUpdateAsync(dbContext, run.RunId, cancellationToken);
            if (stored is null ||
                !stored.RecordOwnerProbes(now, run.Token, runLease, tally, stage, cursorId))
            {
                await transaction.RollbackAsync(cancellationToken);
                return null;
            }

            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return run with
            {
                ProbeStage = stored.ProbeStage,
                ProbeCursorId = stored.ProbeCursorId,
            };
        });
    }

    /// <summary>
    /// Records a page the store would not serve. The cursor is deliberately left where it was, so
    /// the next attempt re-reads the page that failed instead of stepping over the objects it would
    /// have carried and calling them examined.
    /// </summary>
    private async Task<RunProgress?> RecordFailureAsync(
        RunProgress run,
        string? failureCode,
        CancellationToken cancellationToken)
    {
        var now = clock.UtcNow;
        return await dbContext.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
            var stored = await LoadForUpdateAsync(dbContext, run.RunId, cancellationToken);
            if (stored is null ||
                !stored.RecordPageFailure(now, run.Token, failureCode ?? "storage_provider_error"))
            {
                await transaction.RollbackAsync(cancellationToken);
                return null;
            }

            var failures = stored.PageFailureCount;
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            LogPageFailure(logger, run.RunId, failureCode ?? "storage_provider_error", failures, null);
            return run with { PageFailures = failures };
        });
    }

    // ---------------------------------------------------------------- database reads

    private static Task<MediaInventoryRun?> LoadForUpdateAsync(
        GymDbContext context,
        Guid runId,
        CancellationToken cancellationToken) =>
        context.MediaInventoryRuns
            .FromSql($"""
                SELECT *, xmin FROM media."InventoryRuns"
                WHERE "Id" = {runId}
                FOR UPDATE
                """)
            .SingleOrDefaultAsync(cancellationToken);

    /// <summary>
    /// Every row that currently holds one of these keys, across the three tables that can own one.
    /// The lookup is one query per table per page rather than one per object, and it is a read: no
    /// tenant scope is entered, because nothing here is written.
    /// </summary>
    private async Task<Dictionary<string, KeyOwners>> LoadLiveOwnersAsync(
        Guid tenantId,
        string location,
        string[] keys,
        CancellationToken cancellationToken)
    {
        var now = clock.UtcNow;
        var owners = new Dictionary<string, KeyOwners>(StringComparer.Ordinal);

        var assets = await dbContext.MediaAssets
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(item =>
                item.TenantId == tenantId &&
                item.StorageLocation == location &&
                item.StorageKey != null &&
                keys.Contains(item.StorageKey))
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
            Add(owners, asset.StorageKey!, new OwnerReference(
                MediaInventoryOwnerKind.Asset,
                asset.Id,
                AssetState(asset.Status, asset.PurgeAfterUtc, asset.PurgeClaimToken, asset.PurgeClaimExpiresAtUtc, now),
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
                  keys.Contains(derivative.StorageKey)
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
            Add(owners, derivative.StorageKey!, new OwnerReference(
                MediaInventoryOwnerKind.Derivative,
                derivative.Id,
                // A derivative inherits its parent's cleanup state: it is the parent's purge that
                // deletes it, so the parent is what decides whether another authority owns the row.
                AssetState(
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
                keys.Contains(item.StorageKey))
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
            Add(owners, ingest.StorageKey!, new OwnerReference(
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

    /// <summary>
    /// Keys that a purged row still names through its retained scan evidence. This is what separates
    /// "the database says these bytes were deleted" from "the database has never heard of this
    /// object", and it needs no extra column: the evidence keeps the locator a purge clears.
    /// </summary>
    private async Task<HashSet<string>> LoadPurgedEvidenceKeysAsync(
        Guid tenantId,
        string location,
        string[] keys,
        CancellationToken cancellationToken)
    {
        var assetKeys = await dbContext.MediaAssets
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(item =>
                item.TenantId == tenantId &&
                item.StorageKey == null &&
                item.ScanStorageLocation == location &&
                item.ScanStorageKey != null &&
                keys.Contains(item.ScanStorageKey))
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
                keys.Contains(item.ScanStorageKey))
            .Select(item => item.ScanStorageKey!)
            .ToListAsync(cancellationToken);
        return assetKeys.Concat(derivativeKeys).ToHashSet(StringComparer.Ordinal);
    }

    /// <summary>One bounded slice of the table the owner pass is currently walking.</summary>
    /// <remarks>
    /// Keyset paging on the primary key, expressed in SQL so the ordering is PostgreSQL's own and a
    /// resumed pass continues exactly where the last committed cursor left off. An offset would let
    /// a concurrent insert shift the window and step over a row, which is the one failure mode a
    /// reconciliation pass must not have: a row it never examined would be indistinguishable from a
    /// row it found consistent.
    /// </remarks>
    private async Task<IReadOnlyList<OwnerRow>> LoadOwnerRowsAsync(
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
                return rows.Select(item => new OwnerRow(
                    item.Id,
                    item.TenantId,
                    MediaInventoryOwnerKind.Asset,
                    item.StorageLocation!,
                    item.StorageKey,
                    null,
                    AssetState(
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
                        return new OwnerRow(
                            item.Id,
                            item.TenantId,
                            MediaInventoryOwnerKind.Derivative,
                            item.StorageLocation,
                            item.StorageKey,
                            item.ScanStorageKey,
                            // A derivative inherits its parent's cleanup state: the parent's purge is
                            // what deletes it, so the parent decides whether another authority owns
                            // this row.
                            AssetState(
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
                return rows.Select(item => new OwnerRow(
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

    // ---------------------------------------------------------------- helpers

    /// <summary>
    /// How many rows one slice of the owner pass reads before committing its progress. Small enough
    /// that a lost lease costs little work, large enough that the cursor is not written per row.
    /// </summary>
    private const int OwnerBatchSize = 100;

    private static MediaInventoryProbeStage NextStage(MediaInventoryProbeStage stage) => stage switch
    {
        MediaInventoryProbeStage.Assets => MediaInventoryProbeStage.Derivatives,
        MediaInventoryProbeStage.Derivatives => MediaInventoryProbeStage.IngestObjects,
        _ => MediaInventoryProbeStage.Completed,
    };

    private static MediaInventoryOwnerState AssetState(
        MediaAssetStatus status,
        DateTimeOffset? purgeAfterUtc,
        Guid? claimToken,
        DateTimeOffset? claimExpiresAtUtc,
        DateTimeOffset now) =>
        (claimToken is not null && claimExpiresAtUtc > now) ||
        (status == MediaAssetStatus.Tombstoned && purgeAfterUtc is { } due && due <= now)
            ? MediaInventoryOwnerState.OwnedByPurge
            : MediaInventoryOwnerState.Live;

    /// <summary>
    /// Whether one enumerated key is an application object at all: canonical under the key grammar,
    /// and bound to the tenant its own first segment names.
    /// </summary>
    private static bool TryAttribute(
        ObjectInventoryEntry entry,
        string location,
        out Guid tenantId,
        out StorageObjectLocator? locator)
    {
        tenantId = Guid.Empty;
        locator = null;
        var separator = entry.ObjectKey.IndexOf('/');
        if (separator != 32 || !Guid.TryParseExact(entry.ObjectKey[..separator], "N", out tenantId))
        {
            return false;
        }

        try
        {
            locator = new StorageObjectLocator(tenantId, location, entry.ObjectKey);
            return true;
        }
        catch (ArgumentException)
        {
            // Not a key this application generates. Counted, never attributed, never deleted.
            locator = null;
            return false;
        }
    }

    private static void Add(Dictionary<string, KeyOwners> owners, string key, OwnerReference reference)
    {
        owners[key] = owners.TryGetValue(key, out var existing)
            ? existing with { Count = existing.Count + 1 }
            : new KeyOwners(1, reference);
    }

    private sealed record RunProgress(
        Guid RunId,
        Guid Token,
        string? InventoryCursor,
        bool InventoryCompleted,
        MediaInventoryProbeStage ProbeStage,
        Guid? ProbeCursorId,
        int PageFailures);

    private sealed record AttributedObject(StorageObjectLocator Locator, ObjectInventoryEntry Entry);

    private sealed record OwnerReference(
        MediaInventoryOwnerKind Kind,
        Guid Id,
        MediaInventoryOwnerState State,
        long? ComparableLength);

    private sealed record KeyOwners(int Count, OwnerReference Single);

    private sealed record PendingFinding(
        MediaInventoryFindingKind Kind,
        StorageObjectLocator Locator,
        MediaInventoryOwnerKind OwnerKind,
        Guid? OwnerId);

    private sealed record OwnerProbeOutcome(MediaInventoryProbeTally Tally, string? FailureCode);

    private sealed record OwnerRow(
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

    private sealed class ReconciliationTotals
    {
        public int ObjectsScanned { get; private set; }

        public int OwnersProbed { get; private set; }

        public int FindingsOpened { get; private set; }

        public int FindingsResolved { get; private set; }

        public int PageFailures { get; set; }

        public void Add(MediaInventoryPageTally tally)
        {
            ObjectsScanned += tally.ObjectsScanned;
            FindingsOpened += tally.FindingsOpened;
            FindingsResolved += tally.FindingsResolved;
        }

        public void Add(MediaInventoryProbeTally tally)
        {
            OwnersProbed += tally.Probed;
            FindingsOpened += tally.FindingsOpened;
            FindingsResolved += tally.FindingsResolved;
        }
    }
}
