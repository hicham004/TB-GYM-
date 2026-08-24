using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Media;

public interface IObjectStorage
{
    Task<StoredObject> PutAsync(ObjectUpload upload, CancellationToken cancellationToken);

    Task<Stream> OpenReadAsync(string objectKey, CancellationToken cancellationToken);

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
/// What one sweep did. <paramref name="Failed"/> assets remain tombstoned, due, and retryable.
/// </summary>
public sealed record MediaPurgeOutcome(int Claimed, int Purged, int Failed);

public interface IMediaScanner
{
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
