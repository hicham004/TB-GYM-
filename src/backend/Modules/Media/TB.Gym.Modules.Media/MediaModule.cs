using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Media;

/// <summary>
/// Provider-neutral object storage. Every operation names both the durable storage location and
/// the generated object key; a deployment setting can therefore never reinterpret an old key as
/// belonging to the currently selected write location.
/// </summary>
public interface IObjectStorage
{
    /// <summary>The durable location assigned to newly written objects.</summary>
    string WriteLocation { get; }

    /// <summary>Whether this deployment can accept storage operations.</summary>
    bool IsAvailable { get; }

    Task<ObjectWriteResult> PutAsync(ObjectUpload upload, CancellationToken cancellationToken);

    Task<ObjectReadResult> ReadAsync(ObjectReadRequest request, CancellationToken cancellationToken);

    /// <summary>
    /// Deletes the locator idempotently. An already-missing object is success so a claim that
    /// outlives its process can safely replay deletion.
    /// </summary>
    Task<ObjectDeleteResult> DeleteAsync(
        StorageObjectLocator locator,
        CancellationToken cancellationToken);
}

/// <summary>
/// Deletes objects behind media whose retention has elapsed. Exposed as a port so the sweep can be
/// driven directly by tests rather than only by its background schedule.
/// </summary>
public interface IMediaPurgeService
{
    Task<MediaPurgeOutcome> PurgeDueAsync(int batchSize, CancellationToken cancellationToken);
}

/// <summary>What one sweep did. Failed work remains due and retryable.</summary>
public sealed record MediaPurgeOutcome(int Claimed, int Purged, int Failed);

public interface IMediaScanner
{
    bool IsAvailable { get; }

    Task<MediaScanResult> ScanAsync(
        StorageObjectLocator locator,
        string verifiedContentType,
        CancellationToken cancellationToken);
}

/// <summary>A tenant-bound durable address for one stored object.</summary>
public sealed record StorageObjectLocator
{
    public const int MaximumLocationLength = 80;
    public const int MaximumKeyLength = 500;

    public StorageObjectLocator(Guid tenantId, string location, string objectKey)
    {
        if (tenantId == Guid.Empty)
        {
            throw new ArgumentException("A storage locator requires a tenant.", nameof(tenantId));
        }

        TenantId = tenantId;
        Location = ValidateLocation(location);
        ObjectKey = MediaText.Required(objectKey, MaximumKeyLength, nameof(objectKey));
        var tenantPrefix = $"{tenantId:N}/";
        if (!ObjectKey.StartsWith(tenantPrefix, StringComparison.Ordinal))
        {
            throw new ArgumentException(
                "A storage object key must belong to the locator tenant.",
                nameof(objectKey));
        }
    }

    public Guid TenantId { get; }

    public string Location { get; }

    public string ObjectKey { get; }

    private static string ValidateLocation(string value)
    {
        var normalized = MediaText.Required(value, MaximumLocationLength, nameof(value));
        if (!char.IsAsciiLetterOrDigit(normalized[0]) ||
            normalized.Any(character =>
                !char.IsAsciiLetterOrDigit(character) && character is not '-' and not '_' and not '.'))
        {
            throw new ArgumentException("The storage location is invalid.", nameof(value));
        }

        return normalized.ToLowerInvariant();
    }
}

public static class MediaStorageLocations
{
    /// <summary>The truthful durable identity of the Development local-file layout.</summary>
    public const string LocalV1 = "local-v1";

    /// <summary>No storage adapter is configured. This is never persisted on a media row.</summary>
    public const string Unavailable = "unavailable";
}

public sealed record ObjectUpload(
    StorageObjectLocator Locator,
    string ContentType,
    Stream Content,
    long MaximumLength);

public sealed record StoredObject(
    StorageObjectLocator Locator,
    long Length,
    string ContentType,
    string Sha256,
    byte[] Signature);

/// <summary>A normalized inclusive HTTP-style byte interval expressed as offset plus length.</summary>
public sealed record ObjectByteRange
{
    public ObjectByteRange(long offset, long length)
    {
        if (offset < 0 || length <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(offset), "A byte range requires a non-negative offset and positive length.");
        }

        Offset = offset;
        Length = length;
    }

    public long Offset { get; }

    public long Length { get; }

    public long EndInclusive => checked(Offset + Length - 1);
}

public sealed record ObjectReadRequest(
    StorageObjectLocator Locator,
    string ContentType,
    ObjectByteRange? Range = null);

public sealed record ObjectReadMetadata(
    long ObjectLength,
    string ContentType,
    ObjectByteRange? Range)
{
    public long ContentLength => Range?.Length ?? ObjectLength;
}

public sealed record ObjectWriteResult(
    ObjectStorageOperationStatus Status,
    StoredObject? StoredObject = null,
    string? FailureCode = null);

public sealed record ObjectReadResult(
    ObjectStorageOperationStatus Status,
    Stream? Content = null,
    ObjectReadMetadata? Metadata = null,
    string? FailureCode = null);

public sealed record ObjectDeleteResult(
    ObjectStorageOperationStatus Status,
    string? FailureCode = null);

public enum ObjectStorageOperationStatus
{
    Success = 1,
    NotFound = 2,
    RangeNotSatisfiable = 3,
    Failed = 4,
}

public sealed record MediaScanResult(
    bool IsAllowed,
    string ScannerKey,
    string ScannerVersion,
    string? FailureCode);

public sealed class MediaModule : IModuleMarker
{
    public const string Name = "Media";
}
