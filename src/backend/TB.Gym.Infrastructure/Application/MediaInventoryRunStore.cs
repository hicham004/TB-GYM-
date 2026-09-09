using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Media;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// The run row's whole lifecycle, and the only table reconciliation's own progress is written to.
/// </summary>
/// <remarks>
/// <para>
/// This port exists so that the reconciliation service can record where it got to without holding a
/// database context. A context is a handle to every table in the application, media aggregates
/// included, and EF's method for deleting a row is called <c>Remove</c> — so a service holding one
/// can clear a locator, mark a row purged or delete an asset outright, and no amount of care in the
/// code inside it turns that into a structural guarantee. The reconciliation service is composed
/// with this port, <see cref="IMediaInventoryRowReader"/> and <see cref="IMediaInventoryFindingStore"/>,
/// and with no context at all; between them they can write exactly two tables and read three, and
/// nothing they hand back is a mutable aggregate.
/// </para>
/// <para>
/// Every method commits in its own short transaction and re-checks the run's lease inside it. A
/// worker whose run was taken over while it was probing writes nothing: ownership is a fact about
/// this instant under this lock, never one a caller may carry across a remote call.
/// </para>
/// </remarks>
internal interface IMediaInventoryRunStore
{
    /// <summary>
    /// Takes over the unfinished run for this location, or starts one. Null when another replica
    /// holds a live lease, when the run was abandoned as stale, or when a concurrent starter won.
    /// </summary>
    Task<MediaInventoryRunProgress?> ClaimAsync(
        string location,
        TimeSpan lease,
        CancellationToken cancellationToken);

    /// <summary>
    /// Whether this run has read everything, asked before the resolution phase so that a partial,
    /// failed or budget-exhausted pass never reaches it.
    /// </summary>
    Task<bool> MayResolveAsync(MediaInventoryRunClaim claim, CancellationToken cancellationToken);

    /// <summary>Records one enumerated page and advances the inventory cursor.</summary>
    Task<MediaInventoryRunProgress?> RecordInventoryPageAsync(
        MediaInventoryRunClaim claim,
        TimeSpan lease,
        MediaInventoryPageTally tally,
        string? nextCursor,
        bool hasMore,
        CancellationToken cancellationToken);

    /// <summary>Records one probed batch and advances the owner cursor or stage.</summary>
    Task<MediaInventoryRunProgress?> RecordOwnerProbesAsync(
        MediaInventoryRunClaim claim,
        TimeSpan lease,
        MediaInventoryProbeTally tally,
        MediaInventoryProbeStage stage,
        Guid? cursorId,
        CancellationToken cancellationToken);

    /// <summary>
    /// Records a page the store would not serve, leaving its cursor exactly where it was so the page
    /// is re-read rather than stepped over and its objects called examined.
    /// </summary>
    Task<MediaInventoryRunProgress?> RecordPageFailureAsync(
        MediaInventoryRunClaim claim,
        string failureCode,
        CancellationToken cancellationToken);

    /// <summary>
    /// Ends this worker's turn on the run: failed, completed, or handed back still Running with its
    /// cursors intact.
    /// </summary>
    Task<MediaInventoryRunState> FinalizeAsync(
        MediaInventoryRunClaim claim,
        CancellationToken cancellationToken);
}

/// <summary>
/// What the run row currently says, as values. The aggregate itself never leaves this store, so
/// nothing upstream can move a cursor, extend a lease or complete a run except by asking for it.
/// </summary>
internal sealed record MediaInventoryRunProgress(
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

    public static MediaInventoryRunProgress From(MediaInventoryRun run, Guid token) =>
        new(
            run.Id,
            token,
            run.InventoryCursor,
            run.InventoryCompleted,
            run.ProbeStage,
            run.ProbeCursorId,
            run.PageFailureCount,
            // A run whose lease this worker released or lost has nothing left to spend, so an absent
            // expiry is treated as an expiry that has already passed.
            run.LeaseExpiresAtUtc ?? DateTimeOffset.MinValue);
}

internal sealed class MediaInventoryRunStore(
    GymDbContext dbContext,
    IClock clock,
    ILogger<MediaInventoryRunStore> logger)
    : IMediaInventoryRunStore
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

    public async Task<MediaInventoryRunProgress?> ClaimAsync(
        string location,
        TimeSpan lease,
        CancellationToken cancellationToken)
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
                run = MediaInventoryRun.Start(location, now, lease, token);
                dbContext.MediaInventoryRuns.Add(run);
            }
            else
            {
                run = existing;
                run.Claim(now, lease, token);
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

            return MediaInventoryRunProgress.From(run, token);
        });
    }

    public async Task<bool> MayResolveAsync(
        MediaInventoryRunClaim claim,
        CancellationToken cancellationToken)
    {
        var stored = await dbContext.MediaInventoryRuns
            .AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == claim.RunId, cancellationToken);
        return stored is not null &&
            stored.OwnsLease(claim.LeaseToken) &&
            !stored.HasExhaustedFailures &&
            stored.HasExaminedEverything &&
            !stored.ResolutionCompleted;
    }

    public Task<MediaInventoryRunProgress?> RecordInventoryPageAsync(
        MediaInventoryRunClaim claim,
        TimeSpan lease,
        MediaInventoryPageTally tally,
        string? nextCursor,
        bool hasMore,
        CancellationToken cancellationToken)
    {
        var now = clock.UtcNow;
        return MutateAsync(
            claim,
            run => run.RecordInventoryPage(now, claim.LeaseToken, lease, tally, nextCursor, hasMore),
            cancellationToken);
    }

    public Task<MediaInventoryRunProgress?> RecordOwnerProbesAsync(
        MediaInventoryRunClaim claim,
        TimeSpan lease,
        MediaInventoryProbeTally tally,
        MediaInventoryProbeStage stage,
        Guid? cursorId,
        CancellationToken cancellationToken)
    {
        var now = clock.UtcNow;
        return MutateAsync(
            claim,
            run => run.RecordOwnerProbes(now, claim.LeaseToken, lease, tally, stage, cursorId),
            cancellationToken);
    }

    public async Task<MediaInventoryRunProgress?> RecordPageFailureAsync(
        MediaInventoryRunClaim claim,
        string failureCode,
        CancellationToken cancellationToken)
    {
        var now = clock.UtcNow;
        var failures = 0;
        var progress = await MutateAsync(
            claim,
            run =>
            {
                if (!run.RecordPageFailure(now, claim.LeaseToken, failureCode))
                {
                    return false;
                }

                failures = run.PageFailureCount;
                return true;
            },
            cancellationToken);
        if (progress is not null)
        {
            LogPageFailure(logger, claim.RunId, failureCode, failures, null);
        }

        return progress;
    }

    public async Task<MediaInventoryRunState> FinalizeAsync(
        MediaInventoryRunClaim claim,
        CancellationToken cancellationToken)
    {
        var now = clock.UtcNow;
        return await dbContext.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
            var stored = await LoadForUpdateAsync(claim.RunId, cancellationToken);
            if (stored is null || !stored.OwnsLease(claim.LeaseToken))
            {
                await transaction.RollbackAsync(cancellationToken);
                return MediaInventoryRunState.Running;
            }

            if (stored.HasExhaustedFailures)
            {
                stored.Fail(now, claim.LeaseToken);
            }
            else if (stored.CanComplete)
            {
                stored.Complete(now, claim.LeaseToken);
            }
            else
            {
                // Budget or lease ran out with work left — an unread page, an unprobed row, or a
                // finding still to close. The run stays Running with its cursors intact and the next
                // tick resumes it, and because it is not Completed nothing can read it as a
                // statement that the location was fully examined. The lease is handed back rather
                // than left to expire, so the next pass can pick the run up at once.
                stored.ReleaseClaim(now, claim.LeaseToken);
            }

            var state = stored.State;
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return state;
        });
    }

    /// <summary>
    /// One short transaction that locks the run row, applies a change that judges the lease itself,
    /// and commits. A change that refuses — because the lease moved on — rolls back and reports
    /// nothing rather than writing under somebody else's claim.
    /// </summary>
    private async Task<MediaInventoryRunProgress?> MutateAsync(
        MediaInventoryRunClaim claim,
        Func<MediaInventoryRun, bool> change,
        CancellationToken cancellationToken)
    {
        return await dbContext.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
            var stored = await LoadForUpdateAsync(claim.RunId, cancellationToken);
            if (stored is null || !change(stored))
            {
                await transaction.RollbackAsync(cancellationToken);
                LogLeaseLost(logger, claim.RunId, null);
                return null;
            }

            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return MediaInventoryRunProgress.From(stored, claim.LeaseToken);
        });
    }

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
    private Task<MediaInventoryRun?> LoadForUpdateAsync(Guid runId, CancellationToken cancellationToken)
    {
        var tracked = dbContext.ChangeTracker
            .Entries<MediaInventoryRun>()
            .FirstOrDefault(entry => entry.Entity.Id == runId);
        if (tracked is not null)
        {
            tracked.State = EntityState.Detached;
        }

        return dbContext.MediaInventoryRuns
            .FromSql($"""
                SELECT *, xmin FROM media."InventoryRuns"
                WHERE "Id" = {runId}
                FOR UPDATE
                """)
            .SingleOrDefaultAsync(cancellationToken);
    }
}
