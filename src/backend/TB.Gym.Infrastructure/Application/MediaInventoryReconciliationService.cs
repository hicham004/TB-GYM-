using Microsoft.EntityFrameworkCore;
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
/// takes <see cref="IObjectInventory"/>, which lists and stats, and <see cref="IMediaInventoryFindingStore"/>,
/// which writes findings, and neither <see cref="IObjectStorage"/> nor any container that could
/// resolve one. There is no object here to call delete on and no way to ask for one. An architecture
/// test holds that shape, because a later constructor parameter is exactly how a read-only sweep
/// stops being one.
/// </para>
/// <para>
/// Two passes share one run. The inventory pass enumerates stored objects and asks the database who
/// owns each key; the owner pass walks rows with a live key and asks the store whether their object
/// exists. Neither holds a database transaction across a provider call, for the reason the purge
/// sweep does not either: remote latency must not hold a transaction open.
/// </para>
/// <para>
/// Neither pass ever closes a finding. A pass examines a subset — a page, a batch, whatever its
/// budget and its lease allowed — and a subset that did not contain a condition is not evidence that
/// the condition has gone. Only a run that finished both passes with no outstanding failure has
/// looked at everything, and only such a run resolves what it did not observe again.
/// </para>
/// <para>
/// Where an existing authority already owns a row — the leased purge sweep, the ingest reservation
/// lease — this sweep observes and stays out of the way. Two authorities over one row is how a lease
/// invariant gets broken, so those rows are counted and deliberately not reported.
/// </para>
/// </remarks>
internal sealed class MediaInventoryReconciliationService(
    GymDbContext dbContext,
    IObjectInventory inventory,
    IMediaInventoryFindingStore findingStore,
    IOptions<MediaStorageOptions> storageOptions,
    IClock clock,
    ILogger<MediaInventoryReconciliationService> logger)
    : IMediaInventoryReconciliationService
{
    private static readonly Action<ILogger, Guid, string, int, Exception?> LogPageFailure =
        LoggerMessage.Define<Guid, string, int>(
            LogLevel.Warning,
            new EventId(5521, "MediaInventoryPageFailed"),
            "Media inventory run {RunId} could not read a page: {FailureCode}. Unrecovered failures: {PageFailureCount}.");

    private static readonly Action<ILogger, Guid, Exception?> LogRunAbandoned =
        LoggerMessage.Define<Guid>(
            LogLevel.Warning,
            new EventId(5522, "MediaInventoryRunAbandoned"),
            "Media inventory run {RunId} was abandoned: its resume cursors are older than one day.");

    private static readonly Action<ILogger, Guid, Exception?> LogLeaseLost =
        LoggerMessage.Define<Guid>(
            LogLevel.Information,
            new EventId(5526, "MediaInventoryLeaseLost"),
            "Media inventory run {RunId} is no longer held by this worker; it stopped without writing.");

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
        var claimed = await ClaimRunAsync(location, cancellationToken);
        if (claimed is null)
        {
            return MediaInventoryReconciliationOutcome.Idle;
        }

        var totals = new ReconciliationTotals();
        var pass = await RunInventoryPassAsync(claimed, location, objectBudget, totals, cancellationToken);
        if (pass is { Run: { } afterInventory, Continue: true })
        {
            pass = await RunOwnerPassAsync(afterInventory, location, ownerProbeBudget, totals, cancellationToken);
        }

        var state = pass.Run is { } live
            ? await FinalizeRunAsync(live, location, totals, cancellationToken)
            : MediaInventoryRunState.Running;
        return new MediaInventoryReconciliationOutcome(
            claimed.RunId,
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

            return RunProgress.From(run, token);
        });
    }

    /// <summary>
    /// Ends this worker's turn on the run: failed, completed, or handed back unfinished.
    /// </summary>
    /// <remarks>
    /// Completion is the only place a finding is resolved, and the resolution sweep therefore runs
    /// before the state changes rather than after it. Each of its writes re-checks the lease on its
    /// own, so a worker that lost the run between the last page and here resolves nothing; and a
    /// crash between the sweep and the state change leaves a run that is still Running with both
    /// passes done, which the next tick finalises again from exactly this point.
    /// </remarks>
    private async Task<MediaInventoryRunState> FinalizeRunAsync(
        RunProgress run,
        string location,
        ReconciliationTotals totals,
        CancellationToken cancellationToken)
    {
        if (await MayResolveAsync(run, cancellationToken) &&
            await ResolveUnobservedAsync(run, location, totals, cancellationToken) == ResolutionOutcome.Lost)
        {
            // The run belongs to somebody else now. Its row is theirs to move, not this worker's.
            return MediaInventoryRunState.Running;
        }

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
                // Budget or lease ran out with work left — an unread page, an unprobed row, or a
                // finding still to close. The run stays Running with its cursors intact and the next
                // tick resumes it, and because it is not Completed nothing can read it as a
                // statement that the location was fully examined. The lease is handed back rather
                // than left to expire, so the next pass can pick the run up at once.
                stored.ReleaseClaim(now, run.Token);
            }

            var state = stored.State;
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return state;
        });
    }

    /// <summary>
    /// Whether this run has read everything, asked before the resolution phase so that a partial,
    /// failed or budget-exhausted pass never reaches it.
    /// </summary>
    private async Task<bool> MayResolveAsync(RunProgress run, CancellationToken cancellationToken)
    {
        var stored = await dbContext.MediaInventoryRuns
            .AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == run.RunId, cancellationToken);
        return stored is not null &&
            stored.OwnsLease(run.Token) &&
            !stored.HasExhaustedFailures &&
            stored.HasExaminedEverything &&
            !stored.ResolutionCompleted;
    }

    /// <summary>How a bounded resolution phase ended.</summary>
    private enum ResolutionOutcome
    {
        /// <summary>Nothing was left to close, and the run may be completed.</summary>
        Finished,

        /// <summary>
        /// The batch budget or the lease ran out with findings still standing. The run is handed
        /// back, still Running, for the next tick to resume.
        /// </summary>
        Yielded,

        /// <summary>The lease moved on. Nothing was written and nothing may be.</summary>
        Lost,
    }

    /// <summary>
    /// Closes the findings this run examined away, a bounded batch at a time, and marks the phase
    /// finished only when a bounded look finds none left.
    /// </summary>
    /// <remarks>
    /// The third bounded phase, and bounded the same way the other two are rather than by an
    /// assumption that the backlog is small. How many findings a location has is a property of how
    /// wrong the deployment is: pointing the configuration at the wrong bucket makes every object
    /// unowned and every row missing at once, and "close everything that is left" would then be one
    /// transaction the size of the workspace. Each batch is a fixed number of rows in its own
    /// transaction, at most a fixed number of batches run per pass, and the lease is checked between
    /// them and never extended to fit more in — the pass stops and the next one resumes, because the
    /// candidate set only ever shrinks.
    /// </remarks>
    private async Task<ResolutionOutcome> ResolveUnobservedAsync(
        RunProgress run,
        string location,
        ReconciliationTotals totals,
        CancellationToken cancellationToken)
    {
        for (var batch = 0; batch < MediaInventoryPolicy.ResolutionBatchesPerPass; batch++)
        {
            if (cancellationToken.IsCancellationRequested || !TryLeaseBudget(run, out _))
            {
                return ResolutionOutcome.Yielded;
            }

            var resolved = await findingStore.ResolveUnobservedBatchAsync(
                run.Claim,
                location,
                cancellationToken);
            if (!resolved.Owned)
            {
                LogLeaseLost(logger, run.RunId, null);
                return ResolutionOutcome.Lost;
            }

            totals.FindingsResolved += resolved.Resolved;
            if (!resolved.Drained)
            {
                continue;
            }

            // Nothing was found to close. That is recorded on the run under its own lock, together
            // with a second bounded look, so the flag and the emptiness it asserts are one fact.
            var completed = await findingStore.CompleteResolutionAsync(
                run.Claim,
                location,
                cancellationToken);
            if (!completed.Owned)
            {
                LogLeaseLost(logger, run.RunId, null);
                return ResolutionOutcome.Lost;
            }

            return completed.Drained ? ResolutionOutcome.Finished : ResolutionOutcome.Yielded;
        }

        // The batch budget is spent with findings still standing. The run keeps everything it has
        // closed and is handed back, and the next tick picks up exactly where this one stopped: a
        // closed finding is no longer a candidate, so the phase needs no cursor to be resumable.
        return ResolutionOutcome.Yielded;
    }

    // ---------------------------------------------------------------- inventory pass

    private async Task<PassOutcome> RunInventoryPassAsync(
        RunProgress run,
        string location,
        int objectBudget,
        ReconciliationTotals totals,
        CancellationToken cancellationToken)
    {
        var scanned = 0;
        var emptyPages = 0;
        while (run is { InventoryCompleted: false } &&
               scanned < objectBudget &&
               !cancellationToken.IsCancellationRequested)
        {
            if (!TryLeaseBudget(run, out var budget))
            {
                // Not enough lease left to finish a call inside it. Nothing has been asserted about
                // the pages not yet read, and the cursor still says where they start.
                return new PassOutcome(run, Continue: false);
            }

            var pageSize = Math.Min(MediaInventoryPolicy.PageSize, objectBudget - scanned);
            var cursor = run.InventoryCursor;
            // No transaction is open here, and none may be: this is a remote call.
            var page = await ListWithinLeaseAsync(cursor, pageSize, budget, cancellationToken);
            if (page.Status != ObjectStorageOperationStatus.Success)
            {
                totals.PageFailures++;
                return new PassOutcome(
                    await RecordFailureAsync(run, page.FailureCode, cancellationToken),
                    Continue: false);
            }

            if (!IsUsablePage(page, cursor, ref emptyPages))
            {
                // The store answered with a page that cannot be continued or cannot advance. That is
                // a provider failure rather than the end of the enumeration: treating it as the end
                // would mark the run complete having never read what is behind it.
                totals.PageFailures++;
                return new PassOutcome(
                    await RecordFailureAsync(run, MediaInventoryFailureCodes.ListNoProgress, cancellationToken),
                    Continue: false);
            }

            var tally = await ClassifyPageAsync(run, location, page.Entries, cancellationToken);
            if (tally is not { } counted)
            {
                return new PassOutcome(null, Continue: false);
            }

            scanned += page.Entries.Count;
            totals.Add(counted);
            var advanced = await RecordPageAsync(run, counted, page.NextCursor, page.HasMore, cancellationToken);
            if (advanced is null)
            {
                return new PassOutcome(null, Continue: false);
            }

            run = advanced;
        }

        return new PassOutcome(run, Continue: true);
    }

    /// <summary>
    /// Whether one answered page lets the enumeration go on. A page that claims more behind it and
    /// hands back no usable cursor, or the same cursor it was given, is a page that cannot be
    /// followed; a store that keeps answering with nothing is one that is not advancing.
    /// </summary>
    private static bool IsUsablePage(ObjectInventoryPage page, string? cursor, ref int emptyPages)
    {
        if (page.HasMore &&
            (string.IsNullOrEmpty(page.NextCursor) ||
             string.Equals(page.NextCursor, cursor, StringComparison.Ordinal)))
        {
            return false;
        }

        if (page.Entries.Count > 0)
        {
            emptyPages = 0;
            return true;
        }

        // An empty last page is an ordinary end. An empty page with more behind it is legitimate
        // once — a store may answer with fewer entries than were asked for — and is a store going
        // nowhere if it keeps happening.
        return !page.HasMore || ++emptyPages <= MediaInventoryPolicy.MaximumEmptyPages;
    }

    /// <summary>
    /// Turns one page of stored objects into findings. Keys are attributed to a workspace before
    /// anything else: a key outside the canonical grammar, or one whose tenant segment names no
    /// workspace, is not an application object and is counted rather than judged.
    /// </summary>
    private async Task<MediaInventoryPageTally?> ClassifyPageAsync(
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
            return new MediaInventoryPageTally(entries.Count, 0, 0, unattributable, 0);
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
            if (tallied is not { } counted)
            {
                return null;
            }

            skippedRecent += counted.SkippedRecent;
            skippedOwned += counted.SkippedOwnedByPurge;
            opened += counted.FindingsOpened;
        }

        return new MediaInventoryPageTally(
            entries.Count,
            skippedRecent,
            skippedOwned,
            unattributable,
            opened);
    }

    private async Task<MediaInventoryPageTally?> ClassifyTenantObjectsAsync(
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
        var findings = new List<MediaInventoryPendingFinding>();
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
                case MediaInventoryObjectOutcome.Finding when verdict.Finding is { } kind:
                    findings.Add(new MediaInventoryPendingFinding(
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

        var applied = await findingStore.ApplyAsync(
            run.Claim,
            tenantId,
            location,
            MediaInventoryFindingSet.Collapse(findings),
            cancellationToken);
        if (!applied.Owned)
        {
            LogLeaseLost(logger, run.RunId, null);
            return null;
        }

        return new MediaInventoryPageTally(0, skippedRecent, skippedOwned, 0, applied.Opened);
    }

    // ---------------------------------------------------------------- owner pass

    private async Task<PassOutcome> RunOwnerPassAsync(
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
            if (!TryLeaseBudget(run, out _))
            {
                return new PassOutcome(run, Continue: false);
            }

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
                    return new PassOutcome(null, Continue: false);
                }

                run = moved;
                continue;
            }

            var outcome = await ProbeOwnerRowsAsync(run, location, rows, cancellationToken);
            if (outcome.LostLease)
            {
                return new PassOutcome(null, Continue: false);
            }

            examined += rows.Count;
            totals.Add(outcome.Tally);
            if (outcome.FailureCode is { } failure)
            {
                // The batch keeps its cursor exactly as a failed page does, so the rows it was
                // examining are re-read rather than counted as verified.
                totals.PageFailures++;
                return new PassOutcome(
                    await RecordFailureAsync(run, failure, cancellationToken),
                    Continue: false);
            }

            if (outcome.LastExaminedId is not { } cursorId)
            {
                return new PassOutcome(run, Continue: false);
            }

            var advanced = await RecordProbesAsync(
                run,
                outcome.Tally,
                run.ProbeStage,
                cursorId,
                cancellationToken);
            if (advanced is null)
            {
                return new PassOutcome(null, Continue: false);
            }

            run = advanced;
            if (outcome.LeaseExhausted)
            {
                return new PassOutcome(run, Continue: false);
            }
        }

        return new PassOutcome(run, Continue: true);
    }

    /// <summary>
    /// Asks the store about the rows in one batch that are supposed to have an object, and
    /// classifies the rest without a provider call at all.
    /// </summary>
    /// <remarks>
    /// A stat that fails is a page failure, never an absence. The distinction is the whole
    /// difference between "this workspace has lost a photo" and "the network was busy". A stat that
    /// would outlive the lease is not started at all: the batch stops at the last row it fully
    /// examined and the rest is re-read by whoever holds the run next.
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
        Guid? lastExaminedId = null;
        var leaseExhausted = false;
        var byTenant = new Dictionary<Guid, List<MediaInventoryPendingFinding>>();

        foreach (var row in rows)
        {
            if (!string.Equals(row.StorageLocation, location, StringComparison.Ordinal))
            {
                // A row at another location — local-v1, or one a future phase introduces. It is
                // never probed and never judged, only counted, so a completed run is not read as
                // having verified it.
                skippedNotReconciled++;
                lastExaminedId = row.Id;
                continue;
            }

            if (!byTenant.TryGetValue(row.TenantId, out var pending))
            {
                pending = [];
                byTenant[row.TenantId] = pending;
            }

            if (row.Mismatch is { } mismatch)
            {
                if (row.TryLocator() is { } subject)
                {
                    pending.Add(new MediaInventoryPendingFinding(mismatch, subject, row.Kind, row.Id));
                }

                lastExaminedId = row.Id;
                continue;
            }

            if (row.State != MediaInventoryOwnerState.Live)
            {
                skippedOwned++;
                if (MediaInventoryClassifier.IsCleanupStuck(row.AttemptCount, row.LastAttemptAtUtc, now) &&
                    row.TryLocator() is { } stuck)
                {
                    pending.Add(new MediaInventoryPendingFinding(
                        MediaInventoryFindingKind.CleanupStuck,
                        stuck,
                        row.Kind,
                        row.Id));
                }

                lastExaminedId = row.Id;
                continue;
            }

            if (row.StorageKey is null || row.TryLocator() is not { } locator)
            {
                lastExaminedId = row.Id;
                continue;
            }

            if (!TryLeaseBudget(run, out var budget))
            {
                leaseExhausted = true;
                break;
            }

            var stat = await StatWithinLeaseAsync(locator, budget, cancellationToken);
            probed++;
            if (stat.Status == ObjectStorageOperationStatus.Failed)
            {
                var partial = await ApplyPendingAsync(run, location, byTenant, cancellationToken);
                return new OwnerProbeOutcome(
                    new MediaInventoryProbeTally(
                        probed,
                        skippedNotReconciled,
                        skippedOwned,
                        partial.Opened),
                    stat.FailureCode ?? MediaInventoryFailureCodes.ProviderError,
                    LastExaminedId: null,
                    LeaseExhausted: false,
                    LostLease: !partial.Owned);
            }

            var missing = stat.Status == ObjectStorageOperationStatus.NotFound;
            if (MediaInventoryClassifier.ClassifyOwner(row.State, missing) is { } kind)
            {
                pending.Add(new MediaInventoryPendingFinding(kind, locator, row.Kind, row.Id));
            }

            lastExaminedId = row.Id;
        }

        var applied = await ApplyPendingAsync(run, location, byTenant, cancellationToken);
        return new OwnerProbeOutcome(
            new MediaInventoryProbeTally(probed, skippedNotReconciled, skippedOwned, applied.Opened),
            FailureCode: null,
            lastExaminedId,
            leaseExhausted,
            LostLease: !applied.Owned);
    }

    private async Task<MediaInventoryFindingWrite> ApplyPendingAsync(
        RunProgress run,
        string location,
        Dictionary<Guid, List<MediaInventoryPendingFinding>> byTenant,
        CancellationToken cancellationToken)
    {
        var opened = 0;
        foreach (var (tenantId, pending) in byTenant)
        {
            if (pending.Count == 0)
            {
                continue;
            }

            var applied = await findingStore.ApplyAsync(
                run.Claim,
                tenantId,
                location,
                MediaInventoryFindingSet.Collapse(pending),
                cancellationToken);
            if (!applied.Owned)
            {
                LogLeaseLost(logger, run.RunId, null);
                byTenant.Clear();
                return new MediaInventoryFindingWrite(false, opened, 0);
            }

            opened += applied.Opened;
        }

        byTenant.Clear();
        return new MediaInventoryFindingWrite(true, opened, 0);
    }

    // ---------------------------------------------------------------- provider calls

    /// <summary>
    /// How long a remote call may take: whatever is left of the lease, less the margin the database
    /// writes that follow it need. False when there is not enough left to start one at all.
    /// </summary>
    private bool TryLeaseBudget(RunProgress run, out TimeSpan budget)
    {
        budget = run.LeaseExpiresAtUtc - clock.UtcNow - MediaInventoryPolicy.LeaseSafetyMargin;
        return budget > TimeSpan.Zero;
    }

    private async Task<ObjectInventoryPage> ListWithinLeaseAsync(
        string? cursor,
        int pageSize,
        TimeSpan budget,
        CancellationToken cancellationToken)
    {
        using var bounded = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        bounded.CancelAfter(budget);
        try
        {
            return await inventory.ListAsync(cursor, pageSize, bounded.Token);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            // The store had the whole remaining lease and did not answer inside it. That is a page
            // this run did not read, which is exactly what a page failure means.
            return new ObjectInventoryPage(
                ObjectStorageOperationStatus.Failed,
                [],
                FailureCode: MediaInventoryFailureCodes.LeaseExpired);
        }
    }

    private async Task<ObjectStatResult> StatWithinLeaseAsync(
        StorageObjectLocator locator,
        TimeSpan budget,
        CancellationToken cancellationToken)
    {
        using var bounded = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        bounded.CancelAfter(budget);
        try
        {
            return await inventory.StatAsync(locator, bounded.Token);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            // A store that did not answer has reported nothing at all, and a call abandoned at the
            // lease boundary is a store that did not answer.
            return new ObjectStatResult(
                ObjectStorageOperationStatus.Failed,
                FailureCode: MediaInventoryFailureCodes.LeaseExpired);
        }
    }

    // ---------------------------------------------------------------- durable progress

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
                LogLeaseLost(logger, run.RunId, null);
                return null;
            }

            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return RunProgress.From(stored, run.Token);
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
                LogLeaseLost(logger, run.RunId, null);
                return null;
            }

            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return RunProgress.From(stored, run.Token);
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
        var code = failureCode ?? MediaInventoryFailureCodes.ProviderError;
        return await dbContext.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
            var stored = await LoadForUpdateAsync(dbContext, run.RunId, cancellationToken);
            if (stored is null || !stored.RecordPageFailure(now, run.Token, code))
            {
                await transaction.RollbackAsync(cancellationToken);
                LogLeaseLost(logger, run.RunId, null);
                return null;
            }

            var failures = stored.PageFailureCount;
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            LogPageFailure(logger, run.RunId, code, failures, null);
            return RunProgress.From(stored, run.Token);
        });
    }

    // ---------------------------------------------------------------- database reads

    /// <summary>
    /// The run row, locked, with the values the database currently holds.
    /// </summary>
    /// <remarks>
    /// Anything this context is still tracking from an earlier transaction is discarded first. The
    /// finding store writes this row too — the count of what it closed commits with the rows it
    /// closed — so a copy left over from a previous transaction carries a concurrency token the
    /// database has already moved past, and saving against it would fail as a conflict with a writer
    /// that is this same worker. Reading under <c>FOR UPDATE</c> exists to get the authoritative
    /// row, so the stale copy is dropped rather than merged with it.
    /// </remarks>
    private static Task<MediaInventoryRun?> LoadForUpdateAsync(
        GymDbContext context,
        Guid runId,
        CancellationToken cancellationToken)
    {
        var tracked = context.ChangeTracker
            .Entries<MediaInventoryRun>()
            .FirstOrDefault(entry => entry.Entity.Id == runId);
        if (tracked is not null)
        {
            tracked.State = EntityState.Detached;
        }

        return context.MediaInventoryRuns
            .FromSql($"""
                SELECT *, xmin FROM media."InventoryRuns"
                WHERE "Id" = {runId}
                FOR UPDATE
                """)
            .SingleOrDefaultAsync(cancellationToken);
    }

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
    /// The lease, not this number, is what bounds how long the slice may take.
    /// </summary>
    private const int OwnerBatchSize = 100;

    private static MediaInventoryProbeStage NextStage(MediaInventoryProbeStage stage) => stage switch
    {
        MediaInventoryProbeStage.Assets => MediaInventoryProbeStage.Derivatives,
        MediaInventoryProbeStage.Derivatives => MediaInventoryProbeStage.IngestObjects,
        _ => MediaInventoryProbeStage.Completed,
    };

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
        int PageFailures,
        DateTimeOffset LeaseExpiresAtUtc)
    {
        public MediaInventoryRunClaim Claim => new(RunId, Token);

        public static RunProgress From(MediaInventoryRun run, Guid token) =>
            new(
                run.Id,
                token,
                run.InventoryCursor,
                run.InventoryCompleted,
                run.ProbeStage,
                run.ProbeCursorId,
                run.PageFailureCount,
                // A run whose lease this worker released or lost has nothing left to spend, so an
                // absent expiry is treated as an expiry that has already passed.
                run.LeaseExpiresAtUtc ?? DateTimeOffset.MinValue);
    }

    /// <summary>
    /// What one pass left behind. <see cref="Run"/> is null when the lease moved on mid-pass, and
    /// <see cref="Continue"/> is false when this worker's turn is over even though the run survives.
    /// </summary>
    private readonly record struct PassOutcome(RunProgress? Run, bool Continue);

    private sealed record AttributedObject(StorageObjectLocator Locator, ObjectInventoryEntry Entry);

    private sealed record OwnerReference(
        MediaInventoryOwnerKind Kind,
        Guid Id,
        MediaInventoryOwnerState State,
        long? ComparableLength);

    private sealed record KeyOwners(int Count, OwnerReference Single);

    private sealed record OwnerProbeOutcome(
        MediaInventoryProbeTally Tally,
        string? FailureCode,
        Guid? LastExaminedId,
        bool LeaseExhausted,
        bool LostLease);

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

        public int FindingsResolved { get; set; }

        public int PageFailures { get; set; }

        public void Add(MediaInventoryPageTally tally)
        {
            ObjectsScanned += tally.ObjectsScanned;
            FindingsOpened += tally.FindingsOpened;
        }

        public void Add(MediaInventoryProbeTally tally)
        {
            OwnersProbed += tally.Probed;
            FindingsOpened += tally.FindingsOpened;
        }
    }
}
