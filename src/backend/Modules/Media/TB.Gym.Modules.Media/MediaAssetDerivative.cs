using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Media;

/// <summary>
/// A subordinate rendition of one <see cref="MediaAsset"/>, such as a thumbnail. A derivative is
/// never a standalone asset: it has no owner, no title, and no
/// address. Callers resolve it by naming the parent asset and the variant they want, so a
/// derivative can only ever be reached by someone already authorized for its parent.
/// </summary>
/// <remarks>
/// Length and SHA-256 are recorded per derivative so storage accounting and a later physical purge
/// can measure and verify these bytes without re-reading them. Width and height are recorded
/// because the rendition dimensions are a decision the pipeline made, not a property of the
/// original.
/// </remarks>
public sealed class MediaAssetDerivative : TenantEntity
{
    private MediaAssetDerivative()
    {
    }

    private MediaAssetDerivative(
        Guid tenantId,
        Guid mediaAssetId,
        MediaDerivativeVariant variant,
        string verifiedContentType,
        long length,
        string sha256,
        StorageObjectLocator storageLocator,
        MediaScanEvidence scanEvidence,
        int width,
        int height)
        : base(tenantId)
    {
        if (mediaAssetId == Guid.Empty || !Enum.IsDefined(variant))
        {
            throw new ArgumentException("A media derivative requires a parent asset and a variant.");
        }

        if (width <= 0 || height <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(width), "A media derivative requires positive pixel dimensions.");
        }

        if (length <= 0 || length > MediaUploadPolicy.MaximumImageBytes)
        {
            throw new ArgumentOutOfRangeException(nameof(length), "The media derivative exceeds the allowed size.");
        }

        if (storageLocator.TenantId != tenantId)
        {
            throw new ArgumentException("A media derivative cannot use another tenant's storage locator.");
        }

        MediaAssetId = mediaAssetId;
        Variant = variant;
        VerifiedContentType = MediaText.Required(verifiedContentType, 100, nameof(verifiedContentType));
        Length = length;
        Sha256 = MediaText.Sha256(sha256);
        StorageLocation = storageLocator.Location;
        StorageKey = storageLocator.ObjectKey;
        if (!scanEvidence.IsAllowed || !scanEvidence.Covers(storageLocator, Sha256))
        {
            throw new InvalidOperationException(
                "A publishable media derivative requires allowed evidence for its exact stored bytes.");
        }

        ScanEvidenceState = MediaScanEvidenceState.Complete;
        ScanStorageLocation = scanEvidence.StorageLocation;
        ScanStorageKey = scanEvidence.StorageKey;
        ScanSha256 = scanEvidence.Sha256;
        ScannerKey = scanEvidence.ScannerKey;
        ScannerVersion = scanEvidence.ScannerVersion;
        ScannedAtUtc = scanEvidence.ScannedAtUtc;
        ScanOutcome = scanEvidence.Outcome;
        ScanFailureCode = scanEvidence.FailureCode;
        Width = width;
        Height = height;
    }

    public Guid MediaAssetId { get; private set; }

    public MediaDerivativeVariant Variant { get; private set; }

    public string VerifiedContentType { get; private set; } = string.Empty;

    public long Length { get; private set; }

    public string Sha256 { get; private set; } = string.Empty;

    /// <summary>
    /// Null once the object has been physically deleted. Length and hash are retained so storage
    /// accounting can still describe what was released.
    /// </summary>
    public string? StorageKey { get; private set; }

    public string StorageLocation { get; private set; } = string.Empty;

    public MediaScanEvidenceState ScanEvidenceState { get; private set; }

    public string? ScanStorageLocation { get; private set; }

    public string? ScanStorageKey { get; private set; }

    public string? ScanSha256 { get; private set; }

    public string? ScannerKey { get; private set; }

    public string? ScannerVersion { get; private set; }

    public DateTimeOffset? ScannedAtUtc { get; private set; }

    public MediaScanOutcome? ScanOutcome { get; private set; }

    public string? ScanFailureCode { get; private set; }

    public DateTimeOffset? PurgedAtUtc { get; private set; }

    public int Width { get; private set; }

    public int Height { get; private set; }

    public StorageObjectLocator GetStorageLocator()
    {
        if (StorageKey is null)
        {
            throw new InvalidOperationException("The media derivative has no live stored object.");
        }

        return new StorageObjectLocator(TenantId, StorageLocation, StorageKey);
    }

    /// <summary>
    /// The rendition's object is gone. Purging a derivative twice is a no-op rather than an error,
    /// because a retry after a partial failure must be able to walk the same list again.
    /// </summary>
    public void MarkPurged(DateTimeOffset now)
    {
        if (PurgedAtUtc is not null)
        {
            return;
        }

        PurgedAtUtc = now;
        StorageKey = null;
    }

    public static MediaAssetDerivative RegisterThumbnail(
        Guid tenantId,
        Guid mediaAssetId,
        long length,
        string sha256,
        StorageObjectLocator storageLocator,
        MediaScanEvidence scanEvidence,
        int width,
        int height) =>
        new(
            tenantId,
            mediaAssetId,
            MediaDerivativeVariant.Thumbnail,
            MediaThumbnailPolicy.ContentType,
            length,
            sha256,
            storageLocator,
            scanEvidence,
            width,
            height);
}

public enum MediaDerivativeVariant
{
    Thumbnail = 1,
}

/// <summary>
/// The sizing and encoding rules for a thumbnail rendition.
/// </summary>
/// <remarks>
/// A thumbnail exists so a gallery can be browsed without transferring full-resolution
/// health-adjacent images, so the target is the largest edge a list tile or a retina preview needs
/// rather than a display-exact box. 480 px covers a 240 px tile at 2x, keeps a typical phone photo
/// under roughly 40 KB at quality 80, and is a two-figure fraction of the 15 MB original ceiling.
/// The aspect ratio is preserved because poses are compared across dates and a distorted body
/// outline is worse than a small one, and a smaller original is emitted unchanged rather than
/// upscaled, because upscaling only adds bytes and invents detail.
/// </remarks>
public static class MediaThumbnailPolicy
{
    public const int LongestEdgePixels = 480;

    /// <summary>
    /// Quality 80 rather than the 90 used for the stored original: a thumbnail is a preview that is
    /// never zoomed, so the artefacts that quality 90 buys back are not visible at this size.
    /// </summary>
    public const int JpegQuality = 80;

    /// <summary>
    /// A thumbnail is always emitted as JPEG, including when the parent was a PNG. Progress photos
    /// are photographic, and PNG's lossless encoding of photographic content is several times
    /// larger than JPEG at a size where the difference is invisible, which would defeat the point
    /// of the rendition. A PNG's transparency cannot survive that conversion, so it is flattened
    /// deterministically when the thumbnail is rendered rather than left to the encoder.
    /// </summary>
    public const string ContentType = "image/jpeg";

    /// <summary>
    /// Scales the longest edge down to <see cref="LongestEdgePixels"/> while preserving the aspect
    /// ratio, and returns the source dimensions unchanged when it is already that small or smaller.
    /// </summary>
    public static (int Width, int Height) Fit(int width, int height)
    {
        if (width <= 0 || height <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(width), "Image dimensions must be positive.");
        }

        var longestEdge = Math.Max(width, height);
        if (longestEdge <= LongestEdgePixels)
        {
            return (width, height);
        }

        var scale = (double)LongestEdgePixels / longestEdge;
        // A one-pixel edge can round to zero on an extreme aspect ratio, which is not an encodable
        // image, so the short edge is floored at one pixel.
        return (
            Math.Max(1, (int)Math.Round(width * scale, MidpointRounding.AwayFromZero)),
            Math.Max(1, (int)Math.Round(height * scale, MidpointRounding.AwayFromZero)));
    }
}
