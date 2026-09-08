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
/// inherits the sanitised pixels rather than re-reading anything the uploader supplied.
/// <para>
/// Decoding needs the whole image in memory, and the compressed byte cap does not bound that: a
/// few kilobytes of PNG or JPEG can describe a bitmap of gigabytes. The encoded dimensions are
/// therefore read from the codec header and checked against
/// <see cref="MediaUploadPolicy.TryValidateDecodedImage"/> before any pixel buffer is allocated,
/// which bounds each full-resolution pixel buffer. It does not claim to equal process peak memory:
/// orientation can hold a second full bitmap, and Skia codec/encoder data, managed output streams,
/// and the thumbnail surface add to both. Callers therefore apply a process-wide decode admission
/// limit as well as the per-tenant upload gate. Catching
/// <see cref="OutOfMemoryException"/> is deliberately not that boundary and is not attempted: by
/// the time it is raised the allocation has already been demanded.
/// </para>
/// <para>
/// The source is whatever the object store handed back, and a remote store hands back a network
/// body that cannot seek. Decoding therefore goes through SkiaSharp's own <see cref="Stream"/> entry
/// point, which front-buffers the handful of bytes a codec rewinds over, rather than through a bare
/// managed stream, which needs a rewindable source and produces no codec at all without one.
/// </para>
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
        SKBitmap? rotated = null;
        try
        {
            // The library's own stream entry point, not a hand-rolled SKManagedStream around the
            // same stream. The two are not equivalent: a bare managed stream must be rewindable, so
            // it produces no codec at all for the non-seekable body a remote object store hands back
            // — which is a correct response body, and made every progress-photo upload fail as
            // "could not be processed as a valid image" the moment storage stopped being a local
            // file. This overload front-buffers exactly the few bytes a codec needs to rewind over,
            // so the image is still read as a stream rather than held whole in memory.
            //
            // It also takes ownership of what it is given and closes it with the codec. The response
            // stream belongs to the caller, which disposes it around this call, so it is handed over
            // behind a view whose only difference is that closing it closes nothing.
            using var owned = new NonOwningStream(source);
            using var codec = SKCodec.Create(owned);
            if (codec is null)
            {
                return false;
            }

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

            // The header says how large the bitmap will be before anything is allocated for it.
            // Everything below this line is bounded by that answer.
            if (!MediaUploadPolicy.TryValidateDecodedImage(codec.Info.Width, codec.Info.Height, out _))
            {
                return false;
            }

            // Pin the destination colour type to the four-byte format the admission arithmetic
            // bounds. Trusting a codec-selected destination here would let a future format choose
            // a wider pixel representation without changing the policy that approved its size.
            var decodeInfo = new SKImageInfo(
                codec.Info.Width,
                codec.Info.Height,
                SKColorType.Rgba8888,
                SKAlphaType.Premul);
            using var decoded = SKBitmap.Decode(codec, decodeInfo);
            if (decoded is null)
            {
                return false;
            }

            // Only an image whose pixels are not already upright is copied. Copying the common case
            // as well would hold a second full bitmap for no benefit and double the peak footprint
            // the limit above was chosen against.
            var origin = codec.EncodedOrigin;
            rotated = origin is SKEncodedOrigin.TopLeft or SKEncodedOrigin.Default
                ? null
                : ApplyOrientation(decoded, origin);
            var upright = rotated ?? decoded;

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
        catch (Exception exception) when (exception is ArgumentException or InvalidOperationException)
        {
            return false;
        }
        finally
        {
            rotated?.Dispose();
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
    /// Rewrites the pixels so the image is upright without relying on an orientation tag. Only
    /// called for an origin that actually needs it; an already-upright bitmap is used as it is.
    /// </summary>
    private static SKBitmap ApplyOrientation(SKBitmap source, SKEncodedOrigin origin)
    {
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

    /// <summary>
    /// The caller's stream, seen by something that will try to close it.
    /// </summary>
    /// <remarks>
    /// One stream, one owner. The decoder's contract is that it closes what it is handed, and the
    /// object-store response stream's contract is that the caller who opened it closes it — and that
    /// caller has already opened the read, applied its own timeout to it, and will dispose it whether
    /// this decode succeeds, fails or is never reached. Passing it through unwrapped would satisfy
    /// neither contract: it would be closed twice on the way out, and once by whichever of the two
    /// finished first. Everything else is forwarded exactly, seekability included, so the decoder
    /// still sees the stream it was actually given.
    /// </remarks>
    private sealed class NonOwningStream(Stream inner) : Stream
    {
        public override bool CanRead => inner.CanRead;

        public override bool CanSeek => inner.CanSeek;

        public override bool CanWrite => false;

        public override long Length => inner.Length;

        public override long Position
        {
            get => inner.Position;
            set => inner.Position = value;
        }

        public override int Read(byte[] buffer, int offset, int count) => inner.Read(buffer, offset, count);

        public override int Read(Span<byte> buffer) => inner.Read(buffer);

        public override long Seek(long offset, SeekOrigin origin) => inner.Seek(offset, origin);

        public override void Flush() => inner.Flush();

        public override void SetLength(long value) => throw new NotSupportedException();

        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
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
