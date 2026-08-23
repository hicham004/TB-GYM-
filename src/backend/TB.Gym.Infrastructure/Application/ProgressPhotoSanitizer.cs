using SkiaSharp;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// Removes metadata from an uploaded progress photo by decoding it and re-encoding only the pixel
/// data. A phone photo routinely carries GPS coordinates, device identifiers, and timestamps in
/// EXIF; none of that belongs in stored client health-adjacent data.
/// </summary>
/// <remarks>
/// Orientation is the one piece of metadata that must survive, so it is baked into the pixels
/// before the metadata is discarded. Otherwise a portrait photo would display rotated once the
/// EXIF orientation tag is gone. Decoding needs the whole image in memory, which is bounded by the
/// image upload limit and the per-workspace upload concurrency gate.
/// </remarks>
internal static class ProgressPhotoSanitizer
{
    private const int JpegQuality = 90;

    public static bool TrySanitize(Stream source, string verifiedContentType, out MemoryStream sanitized)
    {
        ArgumentNullException.ThrowIfNull(source);
        sanitized = new MemoryStream();
        try
        {
            using var managed = new SKManagedStream(source);
            using var codec = SKCodec.Create(managed);
            if (codec is null)
            {
                return Fail(ref sanitized);
            }

            using var decoded = SKBitmap.Decode(codec);
            if (decoded is null)
            {
                return Fail(ref sanitized);
            }

            using var upright = ApplyOrientation(decoded, codec.EncodedOrigin);
            using var image = SKImage.FromBitmap(upright);
            var format = verifiedContentType switch
            {
                "image/jpeg" => SKEncodedImageFormat.Jpeg,
                "image/png" => SKEncodedImageFormat.Png,
                _ => (SKEncodedImageFormat?)null,
            };
            if (format is null)
            {
                return Fail(ref sanitized);
            }

            using var encoded = image.Encode(format.Value, JpegQuality);
            if (encoded is null || encoded.Size == 0)
            {
                return Fail(ref sanitized);
            }

            encoded.SaveTo(sanitized);
            sanitized.Position = 0;
            return true;
        }
        catch (Exception exception) when (exception is ArgumentException or InvalidOperationException or OutOfMemoryException)
        {
            return Fail(ref sanitized);
        }
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

    private static bool Fail(ref MemoryStream sanitized)
    {
        sanitized.Dispose();
        sanitized = new MemoryStream();
        return false;
    }
}
