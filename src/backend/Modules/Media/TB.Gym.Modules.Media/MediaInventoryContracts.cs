namespace TB.Gym.Modules.Media;

/// <summary>
/// Read-only enumeration of one storage location, used to reconcile stored objects against the
/// database rows that own them.
/// </summary>
/// <remarks>
/// Deliberately separate from <see cref="IObjectStorage"/> rather than added to it. Reconciliation
/// is composed with this port and never with the storage port, so no code path inside it can write
/// or delete an object: the guarantee is the constructor's, not the reviewer's. Splitting it also
/// leaves the contract the request path depends on exactly as Phase 6B-4B accepted it.
/// </remarks>
public interface IObjectInventory
{
    /// <summary>The one durable location this inventory enumerates.</summary>
    string ReconciledLocation { get; }

    /// <summary>Whether this deployment can enumerate stored objects at all.</summary>
    bool IsAvailable { get; }

    /// <summary>
    /// One bounded page of stored objects. <paramref name="cursor"/> is the opaque value a previous
    /// page returned, or null to start.
    /// </summary>
    Task<ObjectInventoryPage> ListAsync(
        string? cursor,
        int maximumKeys,
        CancellationToken cancellationToken);

    /// <summary>
    /// Whether one object exists, and how long it is. <see cref="ObjectStorageOperationStatus.NotFound"/>
    /// means the store answered that it does not exist; <see cref="ObjectStorageOperationStatus.Failed"/>
    /// means the store did not answer, which is never the same thing.
    /// </summary>
    Task<ObjectStatResult> StatAsync(
        StorageObjectLocator locator,
        CancellationToken cancellationToken);
}

/// <summary>One stored object as the inventory reports it. No provider metadata is carried.</summary>
public sealed record ObjectInventoryEntry(
    string ObjectKey,
    long Length,
    DateTimeOffset LastModifiedUtc);

/// <summary>
/// One page of an enumeration. <see cref="HasMore"/> and <see cref="NextCursor"/> decide whether to
/// continue; the number of entries never does, because a store may return fewer than were asked for.
/// </summary>
public sealed record ObjectInventoryPage(
    ObjectStorageOperationStatus Status,
    IReadOnlyList<ObjectInventoryEntry> Entries,
    string? NextCursor = null,
    bool HasMore = false,
    string? FailureCode = null);

public sealed record ObjectStatResult(
    ObjectStorageOperationStatus Status,
    long? Length = null,
    string? FailureCode = null);

/// <summary>
/// Compares the objects at one storage location with the database rows that own them, and records
/// what it found. It changes no media row and deletes nothing.
/// </summary>
public interface IMediaInventoryReconciliationService
{
    Task<MediaInventoryReconciliationOutcome> ReconcileAsync(
        int objectBudget,
        int ownerProbeBudget,
        CancellationToken cancellationToken);
}

/// <summary>
/// What one pass did. A pass that ends anywhere other than
/// <see cref="MediaInventoryRunState.Completed"/> has verified a subset, and the run row says which.
/// </summary>
public sealed record MediaInventoryReconciliationOutcome(
    Guid? RunId,
    MediaInventoryRunState State,
    int ObjectsScanned,
    int OwnersProbed,
    int FindingsOpened,
    int FindingsResolved,
    int PageFailures)
{
    public static MediaInventoryReconciliationOutcome Idle { get; } =
        new(null, MediaInventoryRunState.Running, 0, 0, 0, 0, 0);
}

/// <summary>
/// The fixed thresholds reconciliation judges by. They are constants rather than settings because
/// each of them decides what a finding <em>means</em>, and a deployment that could retune them could
/// quietly turn a real leak into silence.
/// </summary>
public static class MediaInventoryPolicy
{
    /// <summary>
    /// One enumeration page. A thousand is the largest page an object store of this shape serves,
    /// and a store may answer with fewer, so this bounds a request rather than describing a result.
    /// </summary>
    public const int PageSize = 1000;

    /// <summary>
    /// How old an object with no durable owner must be before it is called unowned. Well past the
    /// fifteen-minute ingest reservation lease, so an upload that is committing right now can never
    /// be mistaken for an orphan, and past any plausible clock difference between a replica and the
    /// store.
    /// </summary>
    public static readonly TimeSpan UnownedObjectGrace = TimeSpan.FromHours(24);

    /// <summary>
    /// Attempts after which a cleanup that keeps failing is reported rather than left to retry
    /// silently. The sweep goes on retrying it either way; this only decides when it becomes visible.
    /// </summary>
    public const int StuckAttemptThreshold = 5;

    /// <summary>How long a repeatedly failing cleanup must have been failing before it is reported.</summary>
    public static readonly TimeSpan StuckCleanupAge = TimeSpan.FromHours(24);

    /// <summary>
    /// Consecutive observations before a finding describes itself as actionable. One observation
    /// cannot distinguish an orphan from an object deleted a moment after its page was read.
    /// </summary>
    public const int ActionableObservations = 2;

    /// <summary>
    /// Consecutive page failures after which a run is abandoned as failed rather than resumed. The
    /// next scheduled pass starts a fresh run from the beginning.
    /// </summary>
    /// <remarks>
    /// Consecutive rather than cumulative. A page that failed keeps its cursor, so a later
    /// successful re-read of that same page means nothing was skipped and the run is entitled to
    /// finish; counting the failure forever would make one blip on a location that takes several
    /// passes to walk a permanent refusal to ever complete. <see cref="MaximumRunAge"/> is what
    /// bounds a run that keeps flapping between a failure and a success.
    /// </remarks>
    public const int MaximumPageFailures = 3;

    /// <summary>
    /// How much of the lease must remain before a provider call is started, and therefore the
    /// slack every remote call is bounded by.
    /// </summary>
    /// <remarks>
    /// A lease exists to say who owns the run right now. A call that may still be in flight when
    /// the lease expires makes that statement false: another replica can claim the run while the
    /// first is still probing, and the first would then write findings and cursors for a run it no
    /// longer owns. Every remote call is therefore given the remaining lease minus this margin as
    /// its own deadline, and the margin is what is left for the database writes that follow it.
    /// </remarks>
    public static readonly TimeSpan LeaseSafetyMargin = TimeSpan.FromSeconds(30);

    /// <summary>
    /// Consecutive empty-but-truncated pages tolerated before the enumeration is called stuck. A
    /// store may legitimately answer with fewer entries than were asked for, including none, but a
    /// store that keeps doing so is not making progress and must not be waited on forever.
    /// </summary>
    public const int MaximumEmptyPages = 10;

    /// <summary>
    /// How long an unfinished run may live before it is abandoned instead of resumed. A cursor from
    /// a run this old describes an enumeration the store may no longer be able to continue.
    /// </summary>
    public static readonly TimeSpan MaximumRunAge = TimeSpan.FromHours(24);
}

public enum MediaInventoryRunState
{
    Running = 1,

    /// <summary>
    /// Both passes finished with no page failure. This is the only state that means the location was
    /// fully examined, which is why "no findings" is only meaningful beside it.
    /// </summary>
    Completed = 2,

    /// <summary>Too many page failures. Retained, and never read as a clean sweep.</summary>
    Failed = 3,

    /// <summary>Older than the maximum run age, so its cursor was no longer trustworthy.</summary>
    Abandoned = 4,
}

public enum MediaInventoryOwnerKind
{
    /// <summary>The object has no durable owner in the database.</summary>
    None = 0,
    Asset = 1,
    Derivative = 2,
    IngestObject = 3,
}

public enum MediaInventoryFindingKind
{
    /// <summary>
    /// A row that should be readable names an object the store says does not exist. Access already
    /// fails closed; nothing here repairs it.
    /// </summary>
    ObjectMissingForLiveOwner = 1,

    /// <summary>
    /// A stored object older than the grace window that no durable row owns. Never deleted: an
    /// object the database does not know about is what a defect looks like, not what cleanup does.
    /// </summary>
    UnownedObject = 2,

    /// <summary>
    /// A stored object whose owner is already <c>Purged</c>, recognised through the scan evidence
    /// that survives a purge. The database says these bytes are gone and the store disagrees.
    /// </summary>
    PurgedObjectStillPresent = 3,

    /// <summary>
    /// The stored object's length differs from the length its owner records. The row feeds the
    /// storage allowance, so it is never rewritten from a provider answer.
    /// </summary>
    ObjectLengthMismatch = 4,

    /// <summary>
    /// One key claimed by more than one live row. Purging either owner would delete the object the
    /// other still serves.
    /// </summary>
    DuplicateKeyOwnership = 5,

    /// <summary>A derivative and its parent disagree about whether their objects have been purged.</summary>
    DerivativePurgeStateMismatch = 6,

    /// <summary>
    /// Cleanup has failed repeatedly for long enough to be worth a human's attention. The sweep
    /// keeps retrying on its own schedule regardless.
    /// </summary>
    CleanupStuck = 7,
}

/// <summary>
/// What one observed row is expected to look like in the store, and therefore whether reconciliation
/// may say anything about it at all.
/// </summary>
public enum MediaInventoryOwnerState
{
    /// <summary>
    /// The object is supposed to exist: a pending, ready or refused original, a live derivative, or a
    /// tombstone retained indefinitely because history references it.
    /// </summary>
    Live = 1,

    /// <summary>
    /// Tombstoned and due, or holding an unexpired purge claim. The leased purge sweep owns this row
    /// and reconciliation stays out of its way; two authorities over one row is how a lease
    /// invariant gets broken.
    /// </summary>
    OwnedByPurge = 2,

    /// <summary>
    /// A reservation still inside its lease, which by construction means a request is mid-write.
    /// Probing it would race the upload it describes.
    /// </summary>
    ReservationInFlight = 3,
}

/// <summary>What one observed stored object turned out to be.</summary>
public enum MediaInventoryObjectOutcome
{
    /// <summary>A live owner holds this key and agrees about it.</summary>
    Consistent = 1,

    /// <summary>
    /// Not an application object: the key is outside the canonical grammar, or its tenant segment
    /// names no workspace. Counted, never attributed, never deleted.
    /// </summary>
    Unattributable = 2,

    /// <summary>Newer than the grace window, so nothing can be concluded about it yet.</summary>
    SkippedRecent = 3,

    /// <summary>Its owner is mid-cleanup or mid-write, and another authority owns the outcome.</summary>
    SkippedOwnedByPurge = 4,

    /// <summary>Something worth recording. <see cref="MediaInventoryObjectVerdict.Finding"/> says what.</summary>
    Finding = 5,
}

/// <summary>The facts about one enumerated object that decide what it is.</summary>
/// <param name="KeyIsCanonical">Whether the key parses as an application-generated tenant-bound key.</param>
/// <param name="TenantIsKnown">Whether the key's tenant segment names a workspace that exists.</param>
/// <param name="LiveOwnerCount">How many rows hold this key with a live locator.</param>
/// <param name="OwnerState">The state of the single live owner, when there is exactly one.</param>
/// <param name="OwnerLength">The live owner's recorded length, when it is comparable.</param>
/// <param name="HasPurgedOwner">Whether a purged row's retained scan evidence names this key.</param>
public readonly record struct ObservedObject(
    bool KeyIsCanonical,
    bool TenantIsKnown,
    int LiveOwnerCount,
    MediaInventoryOwnerState? OwnerState,
    long? OwnerLength,
    bool HasPurgedOwner,
    long ObjectLength,
    DateTimeOffset LastModifiedUtc,
    DateTimeOffset Now);

public readonly record struct MediaInventoryObjectVerdict(
    MediaInventoryObjectOutcome Outcome,
    MediaInventoryFindingKind? Finding = null);

/// <summary>
/// Why a pass stopped reading. Stable codes owned here rather than provider prose, because a
/// failure code is recorded on the run row and read by a person.
/// </summary>
public static class MediaInventoryFailureCodes
{
    /// <summary>The store answered, but its answer could not be continued or could not be trusted.</summary>
    public const string ListNoProgress = "storage_list_no_progress";

    /// <summary>The store listed an object without the metadata a decision about it needs.</summary>
    public const string ListMetadataMissing = "storage_list_metadata_missing";

    /// <summary>The call would have outlived the lease, so it was abandoned rather than finished.</summary>
    public const string LeaseExpired = "storage_lease_expired";

    /// <summary>The store did not answer, and an absence was therefore never established.</summary>
    public const string ProviderError = "storage_provider_error";
}

/// <summary>
/// One condition a pass observed, before anything durable is written for it: the kind, the object
/// it is about, and the row that owns that object when exactly one does.
/// </summary>
public readonly record struct MediaInventoryPendingFinding(
    MediaInventoryFindingKind Kind,
    StorageObjectLocator Locator,
    MediaInventoryOwnerKind OwnerKind,
    Guid? OwnerId);

/// <summary>
/// The one-finding-per-object representation the unresolved unique index enforces, computed before
/// a write rather than discovered as a constraint violation.
/// </summary>
public static class MediaInventoryFindingSet
{
    /// <summary>
    /// Reduces one pass's observations to at most one finding per kind and key.
    /// </summary>
    /// <remarks>
    /// Two rows can name one object: an asset and a derivative may both hold the same key, and both
    /// being missing is one disagreement about one object rather than two. The index says so — it is
    /// unique on tenant, kind, location and key over unresolved rows — so a pass that queued both
    /// would collide with it and lose the whole page's findings to a constraint violation.
    /// <para>
    /// When the claimants differ, the surviving finding names none of them, for the reason a
    /// duplicate key claim names none: attributing the condition to whichever row happened to be
    /// read first would describe a defect about an object as a property of one row.
    /// </para>
    /// </remarks>
    public static IReadOnlyList<MediaInventoryPendingFinding> Collapse(
        IReadOnlyList<MediaInventoryPendingFinding> observations)
    {
        ArgumentNullException.ThrowIfNull(observations);
        if (observations.Count <= 1)
        {
            return observations;
        }

        var collapsed = new Dictionary<(MediaInventoryFindingKind Kind, string ObjectKey), MediaInventoryPendingFinding>();
        var order = new List<(MediaInventoryFindingKind Kind, string ObjectKey)>();
        foreach (var observation in observations)
        {
            var subject = (observation.Kind, observation.Locator.ObjectKey);
            if (!collapsed.TryGetValue(subject, out var existing))
            {
                collapsed.Add(subject, observation);
                order.Add(subject);
                continue;
            }

            if (existing.OwnerKind == observation.OwnerKind && existing.OwnerId == observation.OwnerId)
            {
                continue;
            }

            collapsed[subject] = existing with
            {
                OwnerKind = MediaInventoryOwnerKind.None,
                OwnerId = null,
            };
        }

        return [.. order.Select(subject => collapsed[subject])];
    }
}

/// <summary>
/// The decisions reconciliation makes, as pure functions over observed facts, so that every case can
/// be proved without a database, a store or a clock.
/// </summary>
public static class MediaInventoryClassifier
{
    /// <summary>
    /// Classifies one enumerated object. The order of these checks is the decision: ownership is
    /// established before age, because an object a live row owns is never an orphan however old it
    /// is, and age is checked before absence of an owner, because a brand-new object with no row is
    /// indistinguishable from an upload committing right now.
    /// </summary>
    public static MediaInventoryObjectVerdict ClassifyObject(ObservedObject observed)
    {
        if (!observed.KeyIsCanonical || !observed.TenantIsKnown)
        {
            return new MediaInventoryObjectVerdict(MediaInventoryObjectOutcome.Unattributable);
        }

        if (observed.LiveOwnerCount > 1)
        {
            return new MediaInventoryObjectVerdict(
                MediaInventoryObjectOutcome.Finding,
                MediaInventoryFindingKind.DuplicateKeyOwnership);
        }

        if (observed.LiveOwnerCount == 1)
        {
            if (observed.OwnerState is not MediaInventoryOwnerState.Live)
            {
                return new MediaInventoryObjectVerdict(MediaInventoryObjectOutcome.SkippedOwnedByPurge);
            }

            return observed.OwnerLength is { } recorded && recorded != observed.ObjectLength
                ? new MediaInventoryObjectVerdict(
                    MediaInventoryObjectOutcome.Finding,
                    MediaInventoryFindingKind.ObjectLengthMismatch)
                : new MediaInventoryObjectVerdict(MediaInventoryObjectOutcome.Consistent);
        }

        if (observed.HasPurgedOwner)
        {
            return new MediaInventoryObjectVerdict(
                MediaInventoryObjectOutcome.Finding,
                MediaInventoryFindingKind.PurgedObjectStillPresent);
        }

        return observed.LastModifiedUtc > observed.Now - MediaInventoryPolicy.UnownedObjectGrace
            ? new MediaInventoryObjectVerdict(MediaInventoryObjectOutcome.SkippedRecent)
            : new MediaInventoryObjectVerdict(
                MediaInventoryObjectOutcome.Finding,
                MediaInventoryFindingKind.UnownedObject);
    }

    /// <summary>
    /// Whether a row whose object the store reports as absent is worth recording. Only a row that is
    /// supposed to be readable qualifies: a row the purge sweep owns is on its way to being deleted,
    /// and a missing object is the outcome that deletion wanted.
    /// </summary>
    /// <remarks>
    /// <paramref name="objectMissing"/> must come from a store that answered "no such object". A
    /// store that did not answer has reported nothing, and passing a failure in here as though it
    /// were an absence is the one way this function can produce a false accusation.
    /// </remarks>
    public static MediaInventoryFindingKind? ClassifyOwner(
        MediaInventoryOwnerState state,
        bool objectMissing) =>
        objectMissing && state == MediaInventoryOwnerState.Live
            ? MediaInventoryFindingKind.ObjectMissingForLiveOwner
            : null;

    /// <summary>
    /// Whether another authority already owns a stored object's row, from the facts that decide it:
    /// an unexpired purge claim, or a tombstone whose retention has elapsed.
    /// </summary>
    /// <remarks>
    /// Shared rather than duplicated because two places have to agree about it. The pass uses it to
    /// decide what may be reported, and the finding store uses it to decide whether a row is still
    /// the live owner a finding accused — and if those two answers could differ, a finding could be
    /// resolved for a reason the pass never established.
    /// </remarks>
    public static MediaInventoryOwnerState ClassifyOwnerState(
        MediaAssetStatus status,
        DateTimeOffset? purgeAfterUtc,
        Guid? purgeClaimToken,
        DateTimeOffset? purgeClaimExpiresAtUtc,
        DateTimeOffset now) =>
        (purgeClaimToken is not null && purgeClaimExpiresAtUtc > now) ||
        (status == MediaAssetStatus.Tombstoned && purgeAfterUtc is { } due && due <= now)
            ? MediaInventoryOwnerState.OwnedByPurge
            : MediaInventoryOwnerState.Live;

    /// <summary>
    /// Whether a cleanup that keeps failing has been failing long enough to report. It never changes
    /// the retry schedule, which belongs to the purge sweep.
    /// </summary>
    public static bool IsCleanupStuck(
        int attemptCount,
        DateTimeOffset? lastAttemptAtUtc,
        DateTimeOffset now) =>
        attemptCount >= MediaInventoryPolicy.StuckAttemptThreshold &&
        lastAttemptAtUtc is { } attempted &&
        now - attempted >= MediaInventoryPolicy.StuckCleanupAge;
}
