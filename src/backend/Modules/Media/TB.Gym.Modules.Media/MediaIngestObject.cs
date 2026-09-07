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
        StorageObjectLocator storageLocator,
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

        if (storageLocator.TenantId != tenantId)
        {
            throw new ArgumentException("An ingest object cannot use another tenant's storage locator.");
        }

        StorageLocation = storageLocator.Location;
        StorageKey = storageLocator.ObjectKey;
        AccountedBytes = reservedBytes;
        Purpose = purpose;
        ClientProfileId = clientProfileId;
        Status = MediaIngestObjectStatus.Reserved;
        PurgeAfterUtc = now.Add(MediaIngestPolicy.ReservationLease);
    }

    public string? StorageKey { get; private set; }

    public string StorageLocation { get; private set; } = string.Empty;

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

    public string? StoredSha256 { get; private set; }

    public DateTimeOffset? PurgedAtUtc { get; private set; }

    public int PurgeAttemptCount { get; private set; }

    public DateTimeOffset? LastPurgeAttemptAtUtc { get; private set; }

    public string? PurgeFailureCode { get; private set; }

    public Guid? PurgeClaimToken { get; private set; }

    public DateTimeOffset? PurgeClaimExpiresAtUtc { get; private set; }

    public MediaScanEvidenceState ScanEvidenceState { get; private set; }

    public string? ScanStorageLocation { get; private set; }

    public string? ScanStorageKey { get; private set; }

    public string? ScanSha256 { get; private set; }

    public string? ScannerKey { get; private set; }

    public string? ScannerVersion { get; private set; }

    public DateTimeOffset? ScannedAtUtc { get; private set; }

    public MediaScanOutcome? ScanOutcome { get; private set; }

    public string? ScanFailureCode { get; private set; }

    public static MediaIngestObject Reserve(
        Guid tenantId,
        StorageObjectLocator storageLocator,
        long reservedBytes,
        MediaPurpose purpose,
        Guid? clientProfileId,
        DateTimeOffset now) =>
        new(tenantId, storageLocator, reservedBytes, purpose, clientProfileId, now);

    public StorageObjectLocator GetStorageLocator()
    {
        if (StorageKey is null)
        {
            throw new InvalidOperationException("The ingest object has no live stored object.");
        }

        return new StorageObjectLocator(TenantId, StorageLocation, StorageKey);
    }

    public void ConfirmStored(long actualBytes, string sha256, DateTimeOffset now)
    {
        if (Status != MediaIngestObjectStatus.Reserved || actualBytes <= 0 || actualBytes > AccountedBytes)
        {
            throw new InvalidOperationException("Only a live ingest reservation can confirm stored bytes within its bound.");
        }

        AccountedBytes = actualBytes;
        StoredSha256 = MediaText.Sha256(sha256);
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

    public void RecordScanEvidence(MediaScanEvidence evidence)
    {
        ArgumentNullException.ThrowIfNull(evidence);
        if (StoredAtUtc is null ||
            StoredSha256 is null ||
            !evidence.Covers(GetStorageLocator(), StoredSha256))
        {
            throw new InvalidOperationException("Scan evidence requires stored bytes at this locator.");
        }

        ScanEvidenceState = MediaScanEvidenceState.Complete;
        ScanStorageLocation = evidence.StorageLocation;
        ScanStorageKey = evidence.StorageKey;
        ScanSha256 = evidence.Sha256;
        ScannerKey = evidence.ScannerKey;
        ScannerVersion = evidence.ScannerVersion;
        ScannedAtUtc = evidence.ScannedAtUtc;
        ScanOutcome = evidence.Outcome;
        ScanFailureCode = evidence.FailureCode;
    }

    /// <summary>
    /// Claims the request's immediate compensation attempt and keeps the background sweep away for
    /// its bounded duration. A process failure makes the row due when this short lease expires;
    /// an ordinary storage failure calls <see cref="RecordPurgeFailure"/> and makes it due at once.
    /// </summary>
    public void ClaimImmediatePurge(DateTimeOffset now, TimeSpan attemptLease, Guid claimToken)
    {
        if (Status == MediaIngestObjectStatus.Purged ||
            attemptLease <= TimeSpan.Zero ||
            claimToken == Guid.Empty ||
            (PurgeClaimToken is not null && PurgeClaimExpiresAtUtc > now))
        {
            throw new InvalidOperationException("A live ingest object and positive cleanup lease are required.");
        }

        Status = MediaIngestObjectStatus.CleanupPending;
        PurgeAfterUtc = now;
        PurgeClaimToken = claimToken;
        PurgeClaimExpiresAtUtc = now.Add(attemptLease);
        PurgeAttemptCount++;
        LastPurgeAttemptAtUtc = now;
    }

    public bool IsPurgeClaimable(DateTimeOffset now) =>
        Status != MediaIngestObjectStatus.Purged &&
        now >= PurgeAfterUtc &&
        (PurgeClaimToken is null || PurgeClaimExpiresAtUtc <= now);

    public void ClaimPurge(DateTimeOffset now, TimeSpan lease, Guid claimToken)
    {
        if (!IsPurgeClaimable(now) || lease <= TimeSpan.Zero || claimToken == Guid.Empty)
        {
            throw new InvalidOperationException("The ingest object cannot be claimed for cleanup.");
        }

        Status = MediaIngestObjectStatus.CleanupPending;
        PurgeClaimToken = claimToken;
        PurgeClaimExpiresAtUtc = now.Add(lease);
        PurgeAttemptCount++;
        LastPurgeAttemptAtUtc = now;
    }

    public bool CompletePurge(DateTimeOffset now, Guid claimToken)
    {
        if (!OwnsPurgeClaim(claimToken))
        {
            return false;
        }

        Status = MediaIngestObjectStatus.Purged;
        StorageKey = null;
        PurgedAtUtc = now;
        PurgeFailureCode = null;
        PurgeClaimToken = null;
        PurgeClaimExpiresAtUtc = null;
        return true;
    }

    public bool RecordPurgeFailure(DateTimeOffset now, Guid claimToken, string failureCode)
    {
        if (Status == MediaIngestObjectStatus.Purged || !OwnsPurgeClaim(claimToken))
        {
            return false;
        }

        Status = MediaIngestObjectStatus.CleanupPending;
        PurgeAfterUtc = now;
        LastPurgeAttemptAtUtc = now;
        PurgeFailureCode = MediaText.Required(failureCode, 100, nameof(failureCode));
        PurgeClaimToken = null;
        PurgeClaimExpiresAtUtc = null;
        return true;
    }

    public bool OwnsPurgeClaim(Guid claimToken) =>
        claimToken != Guid.Empty && PurgeClaimToken == claimToken;
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
