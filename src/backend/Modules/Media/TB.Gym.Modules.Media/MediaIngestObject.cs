using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Media;

/// <summary>
/// Durable ownership of an object key while an upload is between object storage and a committed
/// media asset. It is created before the storage write, so a process failure after a successful
/// write cannot leave a key that neither an asset nor reconciliation can discover.
/// </summary>
public sealed class MediaIngestObject : TenantEntity
{
    private MediaIngestObject()
    {
    }

    private MediaIngestObject(
        Guid tenantId,
        string storageKey,
        long reservedBytes,
        MediaPurpose purpose,
        Guid? clientProfileId,
        DateTimeOffset now)
        : base(tenantId)
    {
        if (reservedBytes <= 0 || reservedBytes > MediaUploadPolicy.MaximumVideoBytes)
        {
            throw new ArgumentOutOfRangeException(nameof(reservedBytes));
        }

        if (!Enum.IsDefined(purpose) ||
            (purpose == MediaPurpose.ProgressPhoto && clientProfileId is null))
        {
            throw new ArgumentException("An ingest reservation requires its media purpose and client when applicable.");
        }

        StorageKey = MediaText.Required(storageKey, 500, nameof(storageKey));
        AccountedBytes = reservedBytes;
        Purpose = purpose;
        ClientProfileId = clientProfileId;
        Status = MediaIngestObjectStatus.Reserved;
        PurgeAfterUtc = now.Add(MediaIngestPolicy.ReservationLease);
    }

    public string? StorageKey { get; private set; }

    /// <summary>
    /// Actual bytes after a successful write, or the conservative reservation before then.
    /// Non-purged rows contribute this value to storage allowances.
    /// </summary>
    public long AccountedBytes { get; private set; }

    public MediaPurpose Purpose { get; private set; }

    public Guid? ClientProfileId { get; private set; }

    public MediaIngestObjectStatus Status { get; private set; }

    public DateTimeOffset PurgeAfterUtc { get; private set; }

    public DateTimeOffset? StoredAtUtc { get; private set; }

    public DateTimeOffset? PurgedAtUtc { get; private set; }

    public int PurgeAttemptCount { get; private set; }

    public DateTimeOffset? LastPurgeAttemptAtUtc { get; private set; }

    public string? PurgeFailureCode { get; private set; }

    public static MediaIngestObject Reserve(
        Guid tenantId,
        string storageKey,
        long reservedBytes,
        MediaPurpose purpose,
        Guid? clientProfileId,
        DateTimeOffset now) =>
        new(tenantId, storageKey, reservedBytes, purpose, clientProfileId, now);

    public void ConfirmStored(long actualBytes, DateTimeOffset now)
    {
        if (Status != MediaIngestObjectStatus.Reserved || actualBytes <= 0 || actualBytes > AccountedBytes)
        {
            throw new InvalidOperationException("Only a live ingest reservation can confirm stored bytes within its bound.");
        }

        AccountedBytes = actualBytes;
        StoredAtUtc = now;
    }

    public void ScheduleCleanup(DateTimeOffset now)
    {
        if (Status == MediaIngestObjectStatus.Purged)
        {
            return;
        }

        Status = MediaIngestObjectStatus.CleanupPending;
        PurgeAfterUtc = now;
    }

    /// <summary>
    /// Claims the request's immediate compensation attempt and keeps the background sweep away for
    /// its bounded duration. A process failure makes the row due when this short lease expires;
    /// an ordinary storage failure calls <see cref="RecordPurgeFailure"/> and makes it due at once.
    /// </summary>
    public void BeginImmediatePurgeAttempt(DateTimeOffset now, TimeSpan attemptLease)
    {
        if (Status == MediaIngestObjectStatus.Purged || attemptLease <= TimeSpan.Zero)
        {
            throw new InvalidOperationException("A live ingest object and positive cleanup lease are required.");
        }

        Status = MediaIngestObjectStatus.CleanupPending;
        PurgeAfterUtc = now.Add(attemptLease);
        PurgeAttemptCount++;
        LastPurgeAttemptAtUtc = now;
    }

    public void BeginPurgeAttempt(DateTimeOffset now)
    {
        EnsurePurgeable(now);
        PurgeAttemptCount++;
        LastPurgeAttemptAtUtc = now;
    }

    public void CompletePurge(DateTimeOffset now)
    {
        EnsurePurgeable(now);
        Status = MediaIngestObjectStatus.Purged;
        StorageKey = null;
        PurgedAtUtc = now;
        PurgeFailureCode = null;
    }

    public void RecordPurgeFailure(DateTimeOffset now, string failureCode)
    {
        if (Status == MediaIngestObjectStatus.Purged)
        {
            throw new InvalidOperationException("A purged ingest object cannot fail cleanup.");
        }

        Status = MediaIngestObjectStatus.CleanupPending;
        PurgeAfterUtc = now;
        LastPurgeAttemptAtUtc = now;
        PurgeFailureCode = MediaText.Required(failureCode, 100, nameof(failureCode));
    }

    private void EnsurePurgeable(DateTimeOffset now)
    {
        if (Status == MediaIngestObjectStatus.Purged || now < PurgeAfterUtc)
        {
            throw new InvalidOperationException("The ingest object is not due for cleanup.");
        }
    }
}

public enum MediaIngestObjectStatus
{
    Reserved = 1,
    CleanupPending = 2,
    Purged = 3,
}

public static class MediaIngestPolicy
{
    /// <summary>
    /// Engineering policy: a live request has this long to attach or explicitly clean an object.
    /// A crashed process leaves the pre-write reservation behind and reconciliation deletes the
    /// key after this lease, idempotently whether or not the write reached storage.
    /// </summary>
    public static readonly TimeSpan ReservationLease = TimeSpan.FromMinutes(15);
}
