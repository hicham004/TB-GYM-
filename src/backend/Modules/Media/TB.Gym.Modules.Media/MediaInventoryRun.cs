using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Media;

/// <summary>
/// One reconciliation pass over one storage location: its lease, its resume cursors, what it
/// counted, and whether it actually finished.
/// </summary>
/// <remarks>
/// <para>
/// A run is not tenant-owned. It describes a store, and a store belongs to the deployment rather
/// than to any one workspace; the findings it produces are the tenant-owned half.
/// </para>
/// <para>
/// The reason this row exists at all is the honesty rule: a pass that was interrupted, that hit a
/// provider failure, or that ran out of budget has examined a subset, and "it found nothing" means
/// something entirely different in that case. <see cref="Complete"/> refuses unless both passes
/// finished with no failure, so the distinction is an invariant rather than a convention.
/// </para>
/// </remarks>
public sealed class MediaInventoryRun : AuditableEntity
{
    private MediaInventoryRun()
    {
    }

    private MediaInventoryRun(string location, DateTimeOffset now, TimeSpan lease, Guid leaseToken)
    {
        if (lease <= TimeSpan.Zero || leaseToken == Guid.Empty)
        {
            throw new ArgumentException("A reconciliation run requires a positive lease and a token.");
        }

        Location = MediaText.Required(location, StorageObjectLocator.MaximumLocationLength, nameof(location));
        State = MediaInventoryRunState.Running;
        StartedAtUtc = now;
        LastProgressAtUtc = now;
        LeaseToken = leaseToken;
        LeaseExpiresAtUtc = now.Add(lease);
        ProbeStage = MediaInventoryProbeStage.Assets;
    }

    public string Location { get; private set; } = string.Empty;

    public MediaInventoryRunState State { get; private set; }

    public DateTimeOffset StartedAtUtc { get; private set; }

    public DateTimeOffset LastProgressAtUtc { get; private set; }

    public Guid? LeaseToken { get; private set; }

    public DateTimeOffset? LeaseExpiresAtUtc { get; private set; }

    /// <summary>
    /// Where the enumeration resumes. Advanced only when a page's findings have been committed, so a
    /// failed page is re-read rather than stepped over.
    /// </summary>
    public string? InventoryCursor { get; private set; }

    public bool InventoryCompleted { get; private set; }

    /// <summary>Which table the owner pass is walking, and how far through it has got.</summary>
    public MediaInventoryProbeStage ProbeStage { get; private set; }

    public Guid? ProbeCursorId { get; private set; }

    public int ObjectsScanned { get; private set; }

    public int ObjectsSkippedRecent { get; private set; }

    public int ObjectsSkippedOwnedByPurge { get; private set; }

    /// <summary>
    /// Objects whose key is not an application key, or names no workspace. Counted and never
    /// attributed: a finding is a tenant-owned row and these objects have no tenant to own one.
    /// </summary>
    public int UnattributableKeyCount { get; private set; }

    public int OwnersProbed { get; private set; }

    /// <summary>
    /// Rows at a location this run does not reconcile. Recorded so a completed run is never read as
    /// having verified them.
    /// </summary>
    public int OwnersSkippedNotReconciled { get; private set; }

    public int OwnersSkippedOwnedByPurge { get; private set; }

    public int FindingsOpened { get; private set; }

    public int FindingsResolved { get; private set; }

    public int PageFailureCount { get; private set; }

    public string? LastFailureCode { get; private set; }

    public DateTimeOffset? CompletedAtUtc { get; private set; }

    public static MediaInventoryRun Start(
        string location,
        DateTimeOffset now,
        TimeSpan lease,
        Guid leaseToken) =>
        new(location, now, lease, leaseToken);

    public bool OwnsLease(Guid leaseToken) =>
        leaseToken != Guid.Empty && LeaseToken == leaseToken;

    public bool IsClaimable(DateTimeOffset now) =>
        State == MediaInventoryRunState.Running &&
        (LeaseToken is null || LeaseExpiresAtUtc <= now);

    /// <summary>Whether this run's cursors are too old to be trusted for a resume.</summary>
    public bool IsStale(DateTimeOffset now) =>
        State == MediaInventoryRunState.Running &&
        now - StartedAtUtc >= MediaInventoryPolicy.MaximumRunAge;

    /// <summary>
    /// Takes over an unclaimed or expired run. Deliberately not a new run: the cursors already
    /// record how far the location was examined, and starting again would re-walk work that was done
    /// and delay the part that was not.
    /// </summary>
    public void Claim(DateTimeOffset now, TimeSpan lease, Guid leaseToken)
    {
        if (!IsClaimable(now) || lease <= TimeSpan.Zero || leaseToken == Guid.Empty)
        {
            throw new InvalidOperationException("The reconciliation run cannot be claimed.");
        }

        LeaseToken = leaseToken;
        LeaseExpiresAtUtc = now.Add(lease);
        LastProgressAtUtc = now;
    }

    /// <summary>
    /// Accepts one enumerated page and moves the cursor to where the next page starts. Called only
    /// after that page's findings have been written, which is what makes a resume lossless.
    /// </summary>
    public bool RecordInventoryPage(
        DateTimeOffset now,
        Guid leaseToken,
        TimeSpan lease,
        MediaInventoryPageTally tally,
        string? nextCursor,
        bool hasMore)
    {
        if (!EnsureLive(leaseToken))
        {
            return false;
        }

        ObjectsScanned += tally.ObjectsScanned;
        ObjectsSkippedRecent += tally.SkippedRecent;
        ObjectsSkippedOwnedByPurge += tally.SkippedOwnedByPurge;
        UnattributableKeyCount += tally.Unattributable;
        FindingsOpened += tally.FindingsOpened;
        FindingsResolved += tally.FindingsResolved;
        InventoryCursor = hasMore ? nextCursor : null;
        InventoryCompleted = !hasMore;
        Renew(now, lease);
        return true;
    }

    /// <summary>Accepts one bounded slice of the owner pass and advances its table and cursor.</summary>
    public bool RecordOwnerProbes(
        DateTimeOffset now,
        Guid leaseToken,
        TimeSpan lease,
        MediaInventoryProbeTally tally,
        MediaInventoryProbeStage stage,
        Guid? cursorId)
    {
        if (!EnsureLive(leaseToken))
        {
            return false;
        }

        OwnersProbed += tally.Probed;
        OwnersSkippedNotReconciled += tally.SkippedNotReconciled;
        OwnersSkippedOwnedByPurge += tally.SkippedOwnedByPurge;
        FindingsOpened += tally.FindingsOpened;
        FindingsResolved += tally.FindingsResolved;
        ProbeStage = stage;
        ProbeCursorId = stage == MediaInventoryProbeStage.Completed ? null : cursorId;
        Renew(now, lease);
        return true;
    }

    /// <summary>
    /// A page the store would not serve. The cursor is deliberately untouched, so the next attempt
    /// re-reads exactly the page that failed rather than skipping the objects it would have carried.
    /// </summary>
    public bool RecordPageFailure(DateTimeOffset now, Guid leaseToken, string failureCode)
    {
        if (!EnsureLive(leaseToken))
        {
            return false;
        }

        PageFailureCount++;
        LastFailureCode = MediaText.Required(failureCode, 100, nameof(failureCode));
        LastProgressAtUtc = now;
        return true;
    }

    /// <summary>
    /// Whether this run examined the whole location. Both passes finished and nothing failed; a
    /// budget that ran out leaves a cursor behind and therefore does not qualify.
    /// </summary>
    public bool CanComplete =>
        State == MediaInventoryRunState.Running &&
        InventoryCompleted &&
        ProbeStage == MediaInventoryProbeStage.Completed &&
        PageFailureCount == 0;

    public bool Complete(DateTimeOffset now, Guid leaseToken)
    {
        if (!EnsureLive(leaseToken))
        {
            return false;
        }

        if (!CanComplete)
        {
            throw new InvalidOperationException(
                "A reconciliation run that did not finish both passes without failure cannot be completed.");
        }

        State = MediaInventoryRunState.Completed;
        CompletedAtUtc = now;
        LastProgressAtUtc = now;
        ReleaseLease();
        return true;
    }

    /// <summary>
    /// Gives the run back, unfinished. A pass that has spent its budget is done for now but the run
    /// is not: its cursors say exactly how far the location was examined.
    /// </summary>
    /// <remarks>
    /// Released rather than left to expire, so the next tick — or another replica — can resume at
    /// once instead of waiting out a lease nobody is using. Holding it would make the lease duration
    /// decide how often a large location makes progress, which is not what a lease is for.
    /// </remarks>
    public bool ReleaseClaim(DateTimeOffset now, Guid leaseToken)
    {
        if (!EnsureLive(leaseToken))
        {
            return false;
        }

        LastProgressAtUtc = now;
        ReleaseLease();
        return true;
    }

    public bool Fail(DateTimeOffset now, Guid leaseToken)
    {
        if (!EnsureLive(leaseToken))
        {
            return false;
        }

        State = MediaInventoryRunState.Failed;
        LastProgressAtUtc = now;
        ReleaseLease();
        return true;
    }

    /// <summary>
    /// Gives up on a run whose cursors have aged out. It needs no lease token: the whole point is
    /// that nobody has made progress on it for longer than a cursor stays meaningful.
    /// </summary>
    public void Abandon(DateTimeOffset now)
    {
        if (State != MediaInventoryRunState.Running)
        {
            return;
        }

        State = MediaInventoryRunState.Abandoned;
        LastProgressAtUtc = now;
        ReleaseLease();
    }

    /// <summary>Whether the failure budget for one run has been spent.</summary>
    public bool HasExhaustedFailures => PageFailureCount >= MediaInventoryPolicy.MaximumPageFailures;

    private bool EnsureLive(Guid leaseToken) =>
        State == MediaInventoryRunState.Running && OwnsLease(leaseToken);

    private void Renew(DateTimeOffset now, TimeSpan lease)
    {
        LastProgressAtUtc = now;
        if (lease > TimeSpan.Zero)
        {
            LeaseExpiresAtUtc = now.Add(lease);
        }
    }

    private void ReleaseLease()
    {
        LeaseToken = null;
        LeaseExpiresAtUtc = null;
    }
}

/// <summary>Which table the owner pass is walking. Tables are walked in a fixed order.</summary>
public enum MediaInventoryProbeStage
{
    Assets = 1,
    Derivatives = 2,
    IngestObjects = 3,
    Completed = 4,
}

public readonly record struct MediaInventoryPageTally(
    int ObjectsScanned,
    int SkippedRecent,
    int SkippedOwnedByPurge,
    int Unattributable,
    int FindingsOpened,
    int FindingsResolved);

public readonly record struct MediaInventoryProbeTally(
    int Probed,
    int SkippedNotReconciled,
    int SkippedOwnedByPurge,
    int FindingsOpened,
    int FindingsResolved);
