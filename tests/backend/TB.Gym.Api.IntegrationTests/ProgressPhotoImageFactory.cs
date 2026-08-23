using SkiaSharp;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Builds real JPEG bytes for progress-photo tests, optionally carrying an EXIF APP1 segment with
/// an orientation tag and a searchable description. Hand-built so a test can prove that specific
/// metadata bytes do not survive storage.
/// </summary>
internal static class ProgressPhotoImageFactory
{
    public const string SecretDescription = "TBGYM-SECRET-GPS-51.5074N-0.1278W";

    /// <summary>EXIF orientation 6: rotate 90 degrees clockwise when displayed.</summary>
    public const ushort RotateNinetyOrientation = 6;

    public static byte[] PlainJpeg(int width, int height) => EncodeJpeg(width, height);

    /// <summary>
    /// A valid JPEG whose EXIF carries the given orientation and a description string that must not
    /// appear in stored bytes.
    /// </summary>
    public static byte[] JpegWithExif(int width, int height, ushort orientation)
    {
        var body = EncodeJpeg(width, height);
        var exif = BuildExifApp1(orientation);
        var result = new byte[2 + exif.Length + (body.Length - 2)];
        // SOI, then our APP1, then the encoder's output minus its own SOI.
        result[0] = 0xFF;
        result[1] = 0xD8;
        exif.CopyTo(result, 2);
        Array.Copy(body, 2, result, 2 + exif.Length, body.Length - 2);
        return result;
    }

    public static (int Width, int Height) Measure(byte[] image)
    {
        using var data = SKData.CreateCopy(image);
        using var codec = SKCodec.Create(data)
            ?? throw new AssertFailedException("The stored progress photo is not a decodable image.");
        return (codec.Info.Width, codec.Info.Height);
    }

    private static byte[] EncodeJpeg(int width, int height)
    {
        using var bitmap = new SKBitmap(width, height, SKColorType.Rgba8888, SKAlphaType.Opaque);
        using (var canvas = new SKCanvas(bitmap))
        {
            canvas.Clear(SKColors.CornflowerBlue);
            using var paint = new SKPaint { Color = SKColors.Orange };
            // An asymmetric mark keeps the image from being visually identical under rotation.
            canvas.DrawRect(0, 0, Math.Max(1, width / 3), Math.Max(1, height / 5), paint);
            canvas.Flush();
        }

        using var image = SKImage.FromBitmap(bitmap);
        using var encoded = image.Encode(SKEncodedImageFormat.Jpeg, 92)
            ?? throw new AssertFailedException("The test JPEG could not be encoded.");
        return encoded.ToArray();
    }

    /// <summary>
    /// Minimal little-endian TIFF wrapped in an APP1 segment: IFD0 with ImageDescription and
    /// Orientation entries.
    /// </summary>
    private static byte[] BuildExifApp1(ushort orientation)
    {
        var description = System.Text.Encoding.ASCII.GetBytes(SecretDescription + "\0");
        var tiff = new List<byte>();
        tiff.AddRange("II"u8.ToArray());
        tiff.AddRange(BitConverter.GetBytes((ushort)42));
        tiff.AddRange(BitConverter.GetBytes(8u));

        const int ifdStart = 8;
        const int entryCount = 2;
        var ifdLength = 2 + (entryCount * 12) + 4;
        var descriptionOffset = ifdStart + ifdLength;

        tiff.AddRange(BitConverter.GetBytes((ushort)entryCount));
        // ImageDescription (0x010E), ASCII, stored out of line because it exceeds four bytes.
        tiff.AddRange(BitConverter.GetBytes((ushort)0x010E));
        tiff.AddRange(BitConverter.GetBytes((ushort)2));
        tiff.AddRange(BitConverter.GetBytes((uint)description.Length));
        tiff.AddRange(BitConverter.GetBytes((uint)descriptionOffset));
        // Orientation (0x0112), SHORT, stored inline.
        tiff.AddRange(BitConverter.GetBytes((ushort)0x0112));
        tiff.AddRange(BitConverter.GetBytes((ushort)3));
        tiff.AddRange(BitConverter.GetBytes(1u));
        tiff.AddRange(BitConverter.GetBytes((uint)orientation));
        tiff.AddRange(BitConverter.GetBytes(0u));
        tiff.AddRange(description);

        var payload = new List<byte>("Exif"u8.ToArray()) { 0x00, 0x00 };
        payload.AddRange(tiff);

        var segment = new List<byte> { 0xFF, 0xE1 };
        var length = payload.Count + 2;
        segment.Add((byte)(length >> 8));
        segment.Add((byte)(length & 0xFF));
        segment.AddRange(payload);
        return [.. segment];
    }
}
