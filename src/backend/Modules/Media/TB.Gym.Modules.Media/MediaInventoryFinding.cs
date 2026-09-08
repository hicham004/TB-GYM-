using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Media;

/// <summary>
/// One durable disagreement between a workspace's stored objects and the rows that own them.
/// </summary>
/// <remarks>
/// <para>
/// A finding is an observation, not a verdict and not an instruction. Nothing acts on one
/// automatically: it exists so that a person can look at a key, decide what happened, and act
/// deliberately. That is also why it is the only place an object key is recorded — a key identifies
/// one workspace's private content, so it belongs in a tenant-scoped row and never in a log line.
/// </para>
/// <para>
/// It is re-observed rather than re-created. <see cref="ConsecutiveObservations"/> is what separates
/// a standing condition from an object that was deleted a moment after its page was read, and
/// resolution is one-way: a condition that returns is a new finding, so the history of the old one
/// stays intact.
/// </para>
/// </remarks>
public sealed class MediaInventoryFinding : TenantEntity
{
    private MediaInventoryFinding()
    {
    }

    private MediaInventoryFinding(
        Guid tenantId,
        MediaInventoryFindingKind kind,
        StorageObjectLocator locator,
        MediaInventoryOwnerKind ownerKind,
        Guid? ownerId,
        Guid runId,
        DateTimeOffset now)
        : base(tenantId)
    {
        if (!Enum.IsDefined(kind) || !Enum.IsDefined(ownerKind) || runId == Guid.Empty)
        {
            throw new ArgumentException("A media inventory finding requires a kind, an owner kind and a run.");
        }

        if (locator.TenantId != tenantId)
        {
            throw new ArgumentException("A finding cannot describe another tenant's stored object.");
        }

        if ((ownerKind == MediaInventoryOwnerKind.None) != (ownerId is null))
        {
            throw new ArgumentException("A finding names an owning row or none, never half of one.");
        }

        Kind = kind;
        StorageLocation = locator.Location;
        StorageKey = locator.ObjectKey;
        OwnerKind = ownerKind;
        OwnerId = ownerId;
        FirstObservedAtUtc = now;
        LastObservedAtUtc = now;
        ConsecutiveObservations = 1;
        FirstRunId = runId;
        LastRunId = runId;
    }

    public MediaInventoryFindingKind Kind { get; private set; }

    public string StorageLocation { get; private set; } = string.Empty;

    public string StorageKey { get; private set; } = string.Empty;

    /// <summary>
    /// Which table owns the object, when exactly one does. <see cref="MediaInventoryOwnerKind.None"/>
    /// for an object nothing owns, and for a duplicate claim, where naming one of the owners would
    /// describe the defect as belonging to whichever row happened to be read first.
    /// </summary>
    public MediaInventoryOwnerKind OwnerKind { get; private set; }

    public Guid? OwnerId { get; private set; }

    public DateTimeOffset FirstObservedAtUtc { get; private set; }

    public DateTimeOffset LastObservedAtUtc { get; private set; }

    public int ConsecutiveObservations { get; private set; }

    public Guid FirstRunId { get; private set; }

    public Guid LastRunId { get; private set; }

    public DateTimeOffset? ResolvedAtUtc { get; private set; }

    public string? ResolutionCode { get; private set; }

    public bool IsResolved => ResolvedAtUtc is not null;

    /// <summary>
    /// Whether this condition has been seen often enough to be worth acting on. Nothing in this
    /// phase acts on it either way; the flag exists so that a report does not present a single
    /// observation as though it were established.
    /// </summary>
    public bool IsActionable =>
        !IsResolved && ConsecutiveObservations >= MediaInventoryPolicy.ActionableObservations;

    public static MediaInventoryFinding Open(
        Guid tenantId,
        MediaInventoryFindingKind kind,
        StorageObjectLocator locator,
        MediaInventoryOwnerKind ownerKind,
        Guid? ownerId,
        Guid runId,
        DateTimeOffset now) =>
        new(tenantId, kind, locator, ownerKind, ownerId, runId, now);

    /// <summary>Records that a later run saw the same condition again.</summary>
    /// <remarks>
    /// One run counts once, however many times it looks. A pass is resumable and replayable — a
    /// crash between writing a page's findings and committing its cursor re-reads exactly that page,
    /// and a batch whose stat failed is re-examined from the same cursor — so a run that counted
    /// every visit would turn one logical observation into two and make a condition seen once look
    /// established. Recording the instant is still right: it says when this run last saw it.
    /// </remarks>
    public void Observe(DateTimeOffset now, Guid runId)
    {
        if (IsResolved)
        {
            throw new InvalidOperationException(
                "A resolved finding is history. A condition that returns is a new finding.");
        }

        if (runId == Guid.Empty)
        {
            throw new ArgumentException("An observation belongs to a run.", nameof(runId));
        }

        LastObservedAtUtc = now;
        if (LastRunId == runId)
        {
            return;
        }

        LastRunId = runId;
        ConsecutiveObservations++;
    }

    /// <summary>Whether the run identified here already counted this condition.</summary>
    public bool WasObservedBy(Guid runId) => runId != Guid.Empty && LastRunId == runId;

    /// <summary>
    /// Records that the condition is gone. One-way, and never a deletion: the row stays as the
    /// history of something that was once wrong here.
    /// </summary>
    public void Resolve(DateTimeOffset now, string resolutionCode)
    {
        if (IsResolved)
        {
            return;
        }

        ResolvedAtUtc = now;
        ResolutionCode = MediaText.Required(resolutionCode, 60, nameof(resolutionCode));
    }
}

/// <summary>Why a finding stopped applying. Stable codes, never provider prose.</summary>
/// <remarks>
/// Both codes are written only by a run that read the whole location without an outstanding failure.
/// A pass that stopped early has examined a subset, and a subset that did not contain a condition is
/// not evidence that the condition is gone — it is evidence that the pass stopped.
/// </remarks>
public static class MediaInventoryResolutionCodes
{
    /// <summary>
    /// A run that examined everything re-examined this exact subject and did not find the condition:
    /// the lengths agree, one row claims the key, or the store answered the probe with the object.
    /// </summary>
    public const string ObserverConsistent = "observed_consistent";

    /// <summary>
    /// The subject was no longer there to examine: the object is gone from the location, or the row
    /// the finding named no longer holds that key here as a live owner.
    /// </summary>
    public const string OwnerNoLongerHoldsKey = "owner_released_key";
}
