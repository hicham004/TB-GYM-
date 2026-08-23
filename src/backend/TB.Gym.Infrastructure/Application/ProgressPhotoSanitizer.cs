using SkiaSharp;
using TB.Gym.Modules.Media;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// Removes metadata from an uploaded progress photo by decoding it and re-encoding only the pixel
/// data, and renders the thumbnail rendition from those same pixels. A phone photo routinely
/// carries GPS coordinates, device identifiers, and timestamps in EXIF; none of that belongs in
/// stored client health-adjacent data.
/// </summary>
/// <remarks>
/// Orientation is the one piece of metadata that must survive, so it is baked into the pixels
/// before the metadata is discarded. Otherwise a portrait photo would display rotated once the
/// EXIF orientation tag is gone. The thumbnail is produced in this same pass, from the decoded and
/// already-uprighted bitmap, so the untrusted original is decoded exactly once and the rendition
/// inherits the sanitised pixels rather than re-reading anything the uploader supplied. Decoding
/// needs the whole image in memory, which is bounded by the image upload limit and the
/// per-workspace upload concurrency gate.
/// </remarks>
internal static class ProgressPhotoSanitizer
{
    private const int JpegQuality = 90;

    /// <summary>
    /// Downscaling a phone photo to 480 px is a large reduction, and plain bilinear filtering
    /// samples too few source pixels at that ratio, which aliases skin texture and clothing
    /// patterns into moire. Mipmapped linear sampling averages the discarded detail instead. Stated
    /// explicitly because the quality-enum resize overloads it replaces are deprecated.
    /// </summary>
    private static readonly SKSamplingOptions ThumbnailSampling = new(SKFilterMode.Linear, SKMipmapMode.Linear);

    public static bool TrySanitize(
        Stream source,
        string verifiedContentType,
        out SanitizedProgressPhoto? sanitized)
    {
        ArgumentNullException.ThrowIfNull(source);
        sanitized = null;
        MemoryStream? image = null;
        MemoryStream? thumbnail = null;
        try
        {
            using var managed = new SKManagedStream(source);
            using var codec = SKCodec.Create(managed);
            if (codec is null)
            {
                return false;
            }

            using var decoded = SKBitmap.Decode(codec);
            if (decoded is null)
            {
                return false;
            }

            using var upright = ApplyOrientation(decoded, codec.EncodedOrigin);
            var format = verifiedContentType switch
            {
                "image/jpeg" => SKEncodedImageFormat.Jpeg,
                "image/png" => SKEncodedImageFormat.Png,
                _ => (SKEncodedImageFormat?)null,
            };
            if (format is null)
            {
                return false;
            }

            using (var full = SKImage.FromBitmap(upright))
            {
                image = Encode(full, format.Value, JpegQuality);
            }

            if (image is null)
            {
                return false;
            }

            var (thumbnailWidth, thumbnailHeight) = MediaThumbnailPolicy.Fit(upright.Width, upright.Height);
            thumbnail = RenderThumbnail(upright, thumbnailWidth, thumbnailHeight);
            if (thumbnail is null)
            {
                return false;
            }

            sanitized = new SanitizedProgressPhoto(image, thumbnail, thumbnailWidth, thumbnailHeight);
            image = null;
            thumbnail = null;
            return true;
        }
        catch (Exception exception) when (exception is ArgumentException or InvalidOperationException or OutOfMemoryException)
        {
            return false;
        }
        finally
        {
            image?.Dispose();
            thumbnail?.Dispose();
        }
    }

    /// <summary>
    /// Draws the uprighted pixels into the target box. The thumbnail is written to an opaque
    /// surface cleared to white first, so a PNG parent's transparency is flattened deterministically
    /// here rather than left to whatever background the JPEG encoder would assume.
    /// </summary>
    private static MemoryStream? RenderThumbnail(SKBitmap upright, int width, int height)
    {
        using var target = new SKBitmap(width, height, SKColorType.Rgba8888, SKAlphaType.Opaque);
        using (var canvas = new SKCanvas(target))
        using (var source = SKImage.FromBitmap(upright))
        {
            canvas.Clear(SKColors.White);
            canvas.DrawImage(source, new SKRect(0, 0, width, height), ThumbnailSampling);
            canvas.Flush();
        }

        using var rendered = SKImage.FromBitmap(target);
        return Encode(rendered, SKEncodedImageFormat.Jpeg, MediaThumbnailPolicy.JpegQuality);
    }

    private static MemoryStream? Encode(SKImage image, SKEncodedImageFormat format, int quality)
    {
        using var encoded = image.Encode(format, quality);
        if (encoded is null || encoded.Size == 0)
        {
            return null;
        }

        var buffer = new MemoryStream();
        encoded.SaveTo(buffer);
        buffer.Position = 0;
        return buffer;
    }

    /// <summary>
    /// Rewrites the pixels so the image is upright without relying on an orientation tag.
    /// </summary>
    private static SKBitmap ApplyOrientation(SKBitmap source, SKEncodedOrigin origin)
    {
        if (origin is SKEncodedOrigin.TopLeft or SKEncodedOrigin.Default)
        {
            return source.Copy();
        }

        var swapsAxes = origin is SKEncodedOrigin.LeftTop
            or SKEncodedOrigin.RightTop
            or SKEncodedOrigin.RightBottom
            or SKEncodedOrigin.LeftBottom;
        var width = swapsAxes ? source.Height : source.Width;
        var height = swapsAxes ? source.Width : source.Height;
        var target = new SKBitmap(width, height, source.ColorType, source.AlphaType);
        using var canvas = new SKCanvas(target);
        canvas.SetMatrix(OrientationMatrix(origin, source.Width, source.Height));
        canvas.DrawBitmap(source, 0, 0);
        canvas.Flush();
        return target;
    }

    private static SKMatrix OrientationMatrix(SKEncodedOrigin origin, int width, int height) => origin switch
    {
        SKEncodedOrigin.TopRight => SKMatrix.CreateScale(-1, 1).PostConcat(SKMatrix.CreateTranslation(width, 0)),
        SKEncodedOrigin.BottomRight => SKMatrix.CreateScale(-1, -1).PostConcat(SKMatrix.CreateTranslation(width, height)),
        SKEncodedOrigin.BottomLeft => SKMatrix.CreateScale(1, -1).PostConcat(SKMatrix.CreateTranslation(0, height)),
        SKEncodedOrigin.LeftTop => SKMatrix.CreateRotationDegrees(90).PostConcat(SKMatrix.CreateScale(-1, 1)).PostConcat(SKMatrix.CreateTranslation(height, 0)),
        SKEncodedOrigin.RightTop => SKMatrix.CreateRotationDegrees(90).PostConcat(SKMatrix.CreateTranslation(height, 0)),
        SKEncodedOrigin.RightBottom => SKMatrix.CreateRotationDegrees(-90).PostConcat(SKMatrix.CreateScale(-1, 1)).PostConcat(SKMatrix.CreateTranslation(0, width)),
        SKEncodedOrigin.LeftBottom => SKMatrix.CreateRotationDegrees(-90).PostConcat(SKMatrix.CreateTranslation(0, width)),
        _ => SKMatrix.CreateIdentity(),
    };
}

/// <summary>
/// The metadata-free bytes of one progress photo together with its thumbnail rendition, both
/// produced from a single decode of the uploaded image.
/// </summary>
internal sealed class SanitizedProgressPhoto(
    MemoryStream image,
    MemoryStream thumbnail,
    int thumbnailWidth,
    int thumbnailHeight) : IAsyncDisposable
{
    public MemoryStream Image { get; } = image;

    public MemoryStream Thumbnail { get; } = thumbnail;

    public int ThumbnailWidth { get; } = thumbnailWidth;

    public int ThumbnailHeight { get; } = thumbnailHeight;

    public async ValueTask DisposeAsync()
    {
        await Image.DisposeAsync();
        await Thumbnail.DisposeAsync();
    }
}
