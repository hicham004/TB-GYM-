using TB.Gym.Modules.Media;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// The bound that actually holds on a decoded image, and the arithmetic behind it.
/// </summary>
/// <remarks>
/// The compressed byte cap does not bound decoded memory. PNG's filtering and JPEG's DC-only
/// encoding both describe a large uniform bitmap in a handful of kilobytes, so a file well inside
/// the 15 MB upload limit can demand gigabytes the instant a decoder expands it. These tests fix
/// the documented ceiling by driving it at its exact boundaries, and prove the arithmetic that
/// enforces it cannot be made to wrap.
/// </remarks>
[TestClass]
public sealed class Phase6MediaDecodeLimitTests
{
    [TestMethod]
    public void AnOrdinaryPhotoIsWithinTheDecodedImageLimits()
    {
        // 4032x3024 is a 12-megapixel phone photo, the size a progress photo actually arrives at.
        Assert.IsTrue(MediaUploadPolicy.TryValidateDecodedImage(4032, 3024, out var decodedBytes));
        Assert.AreEqual(4032L * 3024L * MediaUploadPolicy.DecodedBytesPerPixel, decodedBytes);
        Assert.IsLessThan(MediaUploadPolicy.MaximumDecodedImageBytes, decodedBytes);
    }

    /// <summary>
    /// The documented numbers, pinned by driving the boundary rather than by restating the
    /// constants: 8000 px per edge, 30 megapixels, 4 bytes each, 120 MB for one pixel buffer. Widening any of
    /// them means changing a case here that says which number moved.
    /// </summary>
    [TestMethod]
    public void TheEdgeLimitIsEightThousandPixels()
    {
        Assert.IsTrue(MediaUploadPolicy.TryValidateDecodedImage(8_000, 3_750, out var atWidth));
        Assert.AreEqual(120_000_000L, atWidth);
        Assert.IsFalse(MediaUploadPolicy.TryValidateDecodedImage(8_001, 10, out _));

        Assert.IsTrue(MediaUploadPolicy.TryValidateDecodedImage(3_750, 8_000, out var atHeight));
        Assert.AreEqual(120_000_000L, atHeight);
        Assert.IsFalse(MediaUploadPolicy.TryValidateDecodedImage(10, 8_001, out _));
    }

    [TestMethod]
    public void ThePixelCeilingIsThirtyMegapixelsAtFourBytesEach()
    {
        // 6000x5000 is exactly 30 megapixels, and 30e6 * 4 is the one-buffer ceiling.
        Assert.IsTrue(MediaUploadPolicy.TryValidateDecodedImage(6_000, 5_000, out var atCeiling));
        Assert.AreEqual(120_000_000L, atCeiling);

        // One pixel more is refused, and reports no size at all.
        Assert.IsFalse(MediaUploadPolicy.TryValidateDecodedImage(6_001, 5_000, out var over));
        Assert.AreEqual(0L, over);

        // 8000x8000 is 64 megapixels: each edge is legal on its own and the product is not, which
        // is exactly why the pixel ceiling exists alongside the edge limits.
        Assert.IsFalse(MediaUploadPolicy.TryValidateDecodedImage(8_000, 8_000, out _));
    }

    /// <summary>
    /// A header can claim any dimensions at all. The guards run before the multiplications, so the
    /// pathological values are refused rather than multiplied into a small number that passes.
    /// </summary>
    [TestMethod]
    public void PathologicalDimensionsAreRejectedWithoutOverflowing()
    {
        Assert.IsFalse(MediaUploadPolicy.TryValidateDecodedImage(int.MaxValue, int.MaxValue, out _));
        Assert.IsFalse(MediaUploadPolicy.TryValidateDecodedImage(int.MaxValue, 1, out _));
        Assert.IsFalse(MediaUploadPolicy.TryValidateDecodedImage(1, int.MaxValue, out _));

        // 65536 * 65536 * 4 is exactly 2^34: a 64-bit product, and a wrapped 32-bit one would be 0
        // and would sail through a size check written against int.
        Assert.IsFalse(MediaUploadPolicy.TryValidateDecodedImage(65_536, 65_536, out var wrapped));
        Assert.AreEqual(0L, wrapped);
    }

    [TestMethod]
    public void NonPositiveDimensionsAreRejected()
    {
        Assert.IsFalse(MediaUploadPolicy.TryValidateDecodedImage(0, 100, out _));
        Assert.IsFalse(MediaUploadPolicy.TryValidateDecodedImage(100, 0, out _));
        Assert.IsFalse(MediaUploadPolicy.TryValidateDecodedImage(-1, -1, out _));
        Assert.IsFalse(MediaUploadPolicy.TryValidateDecodedImage(int.MinValue, 100, out _));
    }
}

[TestClass]
public sealed class Phase6MediaIngestObjectTests
{
    private static readonly DateTimeOffset Now =
        new(2026, 8, 30, 0, 0, 0, TimeSpan.Zero);

    [TestMethod]
    public void FailedImmediateCleanupStaysDiscoverableUntilAConfirmedPurgeClearsItsKey()
    {
        var ingest = MediaIngestObject.Reserve(
            Guid.NewGuid(),
            "tenant/generated-object-key",
            1_000,
            MediaPurpose.ProgressPhoto,
            Guid.NewGuid(),
            Now);
        ingest.ConfirmStored(750, Now);

        ingest.BeginImmediatePurgeAttempt(Now, TimeSpan.FromSeconds(35));
        Assert.AreEqual(MediaIngestObjectStatus.CleanupPending, ingest.Status);
        Assert.AreEqual(Now.AddSeconds(35), ingest.PurgeAfterUtc);
        Assert.AreEqual("tenant/generated-object-key", ingest.StorageKey);
        Assert.AreEqual(750L, ingest.AccountedBytes);

        ingest.RecordPurgeFailure(Now.AddSeconds(1), "storage_io_error");
        Assert.AreEqual(Now.AddSeconds(1), ingest.PurgeAfterUtc);
        ingest.BeginPurgeAttempt(Now.AddSeconds(1));
        ingest.CompletePurge(Now.AddSeconds(1));

        Assert.AreEqual(MediaIngestObjectStatus.Purged, ingest.Status);
        Assert.IsNull(ingest.StorageKey);
        Assert.AreEqual(Now.AddSeconds(1), ingest.PurgedAtUtc);
        Assert.AreEqual(2, ingest.PurgeAttemptCount);
    }

    [TestMethod]
    public void ConfirmedBytesCannotExceedTheConservativeReservation()
    {
        var ingest = MediaIngestObject.Reserve(
            Guid.NewGuid(),
            "tenant/generated-object-key",
            1_000,
            MediaPurpose.ExerciseMedia,
            null,
            Now);

        Assert.ThrowsExactly<InvalidOperationException>(() => ingest.ConfirmStored(1_001, Now));
        Assert.AreEqual(1_000L, ingest.AccountedBytes);
        Assert.AreEqual(MediaIngestObjectStatus.Reserved, ingest.Status);
    }
}
