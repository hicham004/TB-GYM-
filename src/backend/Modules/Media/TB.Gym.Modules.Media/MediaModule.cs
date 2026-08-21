using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Media;

public interface IObjectStorage
{
    Task<StoredObject> PutAsync(ObjectUpload upload, CancellationToken cancellationToken);

    Task<Stream> OpenReadAsync(string objectKey, CancellationToken cancellationToken);

    Task DeleteAsync(string objectKey, CancellationToken cancellationToken);
}

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
