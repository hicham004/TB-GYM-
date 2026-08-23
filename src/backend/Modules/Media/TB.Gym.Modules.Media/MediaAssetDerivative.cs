using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Media;

/// <summary>
/// A subordinate rendition of one <see cref="MediaAsset"/>, such as a thumbnail. A derivative is
/// never a standalone asset: it has no owner, no scan lifecycle of its own, no title, and no
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
        string storageKey,
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

        MediaAssetId = mediaAssetId;
        Variant = variant;
        VerifiedContentType = MediaText.Required(verifiedContentType, 100, nameof(verifiedContentType));
        Length = length;
        Sha256 = MediaText.Sha256(sha256);
        StorageKey = MediaText.Required(storageKey, 500, nameof(storageKey));
        Width = width;
        Height = height;
    }

    public Guid MediaAssetId { get; private set; }

    public MediaDerivativeVariant Variant { get; private set; }

    public string VerifiedContentType { get; private set; } = string.Empty;

    public long Length { get; private set; }

    public string Sha256 { get; private set; } = string.Empty;

    public string StorageKey { get; private set; } = string.Empty;

    public int Width { get; private set; }

    public int Height { get; private set; }

    public static MediaAssetDerivative RegisterThumbnail(
        Guid tenantId,
        Guid mediaAssetId,
        long length,
        string sha256,
        string storageKey,
        int width,
        int height) =>
        new(
            tenantId,
            mediaAssetId,
            MediaDerivativeVariant.Thumbnail,
            MediaThumbnailPolicy.ContentType,
            length,
            sha256,
            storageKey,
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
