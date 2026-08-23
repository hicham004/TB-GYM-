using TB.Gym.Modules.Media;

namespace TB.Gym.Domain.Tests;

[TestClass]
public sealed class Phase5B3ProgressPhotoThumbnailDomainTests
{
    private static readonly Guid TenantId = Guid.Parse("10000000-0000-0000-0000-00000000053b");
    private static readonly Guid MediaAssetId = Guid.Parse("30000000-0000-0000-0000-00000000053b");
    private static readonly string Hash = new('a', 64);

    [TestMethod]
    public void ThumbnailSizingPreservesAspectRatioAndNeverUpscalesASmallerOriginal()
    {
        // Poses are compared across dates, so a distorted body outline would be worse than a small
        // one: the ratio must survive the resize in both orientations.
        var landscape = MediaThumbnailPolicy.Fit(4000, 3000);
        Assert.AreEqual(480, landscape.Width);
        Assert.AreEqual(360, landscape.Height);
        AssertRatioPreserved(4000, 3000, landscape);

        var portrait = MediaThumbnailPolicy.Fit(3000, 4000);
        Assert.AreEqual(360, portrait.Width);
        Assert.AreEqual(480, portrait.Height);
        AssertRatioPreserved(3000, 4000, portrait);

        var square = MediaThumbnailPolicy.Fit(1200, 1200);
        Assert.AreEqual(480, square.Width);
        Assert.AreEqual(480, square.Height);

        // An extreme ratio still yields an encodable image rather than a zero-width one.
        var panorama = MediaThumbnailPolicy.Fit(9600, 5);
        Assert.AreEqual(480, panorama.Width);
        Assert.AreEqual(1, panorama.Height);

        // Never upscale: a smaller original is emitted at its own size, because enlarging it only
        // adds bytes and invents detail that was never captured.
        Assert.AreEqual((320, 240), MediaThumbnailPolicy.Fit(320, 240));
        Assert.AreEqual((480, 200), MediaThumbnailPolicy.Fit(480, 200));
        Assert.AreEqual((1, 1), MediaThumbnailPolicy.Fit(1, 1));

        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => MediaThumbnailPolicy.Fit(0, 100));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => MediaThumbnailPolicy.Fit(100, -1));
    }

    [TestMethod]
    public void AThumbnailIsSubordinateToItsParentAndAccountsForItsOwnBytes()
    {
        var thumbnail = MediaAssetDerivative.RegisterThumbnail(
            TenantId,
            MediaAssetId,
            18_432,
            Hash.ToUpperInvariant(),
            "tenant/thumbnail-object",
            480,
            360);

        // A derivative always names the asset it renders, and records the length and hash of its
        // own bytes so storage accounting and a later purge never have to re-read the object.
        Assert.AreEqual(MediaAssetId, thumbnail.MediaAssetId);
        Assert.AreEqual(MediaDerivativeVariant.Thumbnail, thumbnail.Variant);
        Assert.AreEqual(18_432, thumbnail.Length);
        Assert.AreEqual(Hash, thumbnail.Sha256);
        Assert.AreEqual(MediaThumbnailPolicy.ContentType, thumbnail.VerifiedContentType);

        // It cannot exist without a parent, and it cannot claim bytes or dimensions it does not
        // have, because those are exactly the values a purge and a quota would later trust.
        Assert.ThrowsExactly<ArgumentException>(() => MediaAssetDerivative.RegisterThumbnail(
            TenantId, Guid.Empty, 18_432, Hash, "tenant/object", 480, 360));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => MediaAssetDerivative.RegisterThumbnail(
            TenantId, MediaAssetId, 0, Hash, "tenant/object", 480, 360));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => MediaAssetDerivative.RegisterThumbnail(
            TenantId, MediaAssetId, 18_432, Hash, "tenant/object", 480, 0));
        Assert.ThrowsExactly<ArgumentException>(() => MediaAssetDerivative.RegisterThumbnail(
            TenantId, MediaAssetId, 18_432, "not-a-hash", "tenant/object", 480, 360));
    }

    private static void AssertRatioPreserved(int width, int height, (int Width, int Height) fitted)
    {
        var source = (double)width / height;
        var target = (double)fitted.Width / fitted.Height;
        Assert.IsLessThan(
            0.01,
            Math.Abs(source - target),
            $"The aspect ratio changed from {source} to {target}.");
    }
}
