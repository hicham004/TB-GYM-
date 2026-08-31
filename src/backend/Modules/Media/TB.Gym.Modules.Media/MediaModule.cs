using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Media;

public interface IObjectStorage
{
    Task<StoredObject> PutAsync(ObjectUpload upload, CancellationToken cancellationToken);

    Task<Stream> OpenReadAsync(string objectKey, CancellationToken cancellationToken);

    /// <summary>
    /// Deletes the key idempotently. A missing key is success so durable reconciliation can safely
    /// repeat a deletion whose storage result outlived its database transaction.
    /// </summary>
    Task DeleteAsync(string objectKey, CancellationToken cancellationToken);
}

/// <summary>
/// Deletes the objects behind media whose retention has elapsed. Exposed as a port so the sweep can
/// be driven directly by a test rather than only by its background schedule.
/// </summary>
public interface IMediaPurgeService
{
    Task<MediaPurgeOutcome> PurgeDueAsync(int batchSize, CancellationToken cancellationToken);
}

/// <summary>
/// What one sweep did. Failed assets or ingest objects remain due and retryable.
/// </summary>
public sealed record MediaPurgeOutcome(int Claimed, int Purged, int Failed);

public interface IMediaScanner
{
    /// <summary>
    /// Whether a real scanner is configured. A deployment without one still refuses every upload —
    /// scanning fails closed — but this separates "this file was rejected" from "this installation
    /// cannot accept uploads at all", which are a client error and a server condition respectively
    /// and must not be reported as the same thing.
    /// </summary>
    bool IsAvailable { get; }

    Task<MediaScanResult> ScanAsync(
        string objectKey,
        string verifiedContentType,
        CancellationToken cancellationToken);
}

public sealed record ObjectUpload(
    string ObjectKey,
    string ContentType,
    Stream Content,
    Guid TenantId,
    long MaximumLength);

public sealed record StoredObject(
    string ObjectKey,
    long Length,
    string ContentType,
    string Sha256,
    byte[] Signature);

public sealed record MediaScanResult(bool IsAllowed, string ScannerKey, string ScannerVersion, string? FailureCode);

public sealed class MediaModule : IModuleMarker
{
    public const string Name = "Media";
}
