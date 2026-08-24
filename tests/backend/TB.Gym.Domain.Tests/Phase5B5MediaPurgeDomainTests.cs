using TB.Gym.Modules.Media;

namespace TB.Gym.Domain.Tests;

[TestClass]
public sealed class Phase5B5MediaPurgeDomainTests
{
    private static readonly Guid TenantId = Guid.Parse("10000000-0000-0000-0000-00000000055b");
    private static readonly Guid OwnerId = Guid.Parse("40000000-0000-0000-0000-00000000055b");
    private static readonly Guid AssetId = Guid.Parse("30000000-0000-0000-0000-00000000055b");
    private static readonly DateTimeOffset Now = new(2026, 8, 23, 9, 0, 0, TimeSpan.Zero);

    [TestMethod]
    public void PurgeIsOnlyDueForTombstonedMediaWhoseRetentionHasElapsed()
    {
        var asset = Upload();

        // Never purge an asset that is not tombstoned, whatever its scan state.
        Assert.IsFalse(asset.IsPurgeDue(Now));
        asset.RecordScan(new MediaScanResult(true, "scanner", "1.0", null));
        Assert.IsFalse(asset.IsPurgeDue(Now.AddYears(5)));

        asset.MarkTombstoned(Now, TimeSpan.FromDays(30), isHistoricallyReferenced: false);

        // Never purge before the retention has elapsed, including on the boundary instant minus one.
        Assert.IsFalse(asset.IsPurgeDue(Now));
        Assert.IsFalse(asset.IsPurgeDue(Now.AddDays(30).AddTicks(-1)));
        Assert.IsTrue(asset.IsPurgeDue(Now.AddDays(30)));
        Assert.IsTrue(asset.IsPurgeDue(Now.AddDays(31)));
    }

    [TestMethod]
    public void HistoricallyReferencedMediaIsRetainedIndefinitelyAndCannotBePurged()
    {
        var asset = Ready();
        asset.MarkTombstoned(Now, TimeSpan.FromDays(30), isHistoricallyReferenced: true);

        // A null purge date means "never": a program snapshot still has to resolve these bytes.
        Assert.IsNull(asset.PurgeAfterUtc);
        Assert.IsFalse(asset.IsPurgeDue(Now.AddYears(50)));
        Assert.ThrowsExactly<InvalidOperationException>(() => asset.CompletePurge(Now.AddYears(50)));
        Assert.ThrowsExactly<InvalidOperationException>(() => asset.BeginPurgeAttempt(Now.AddYears(50)));
    }

    [TestMethod]
    public void PurgeTransitionsAreOneWayAndRejectInvalidMoves()
    {
        var ready = Ready();

        // Purging skips no state: an asset must be tombstoned first.
        Assert.ThrowsExactly<InvalidOperationException>(() => ready.CompletePurge(Now));
        Assert.ThrowsExactly<InvalidOperationException>(() => ready.BeginPurgeAttempt(Now));
        Assert.ThrowsExactly<InvalidOperationException>(() => ready.RecordPurgeFailure(Now, "storage_io_error"));

        ready.MarkTombstoned(Now, TimeSpan.FromDays(30), isHistoricallyReferenced: false);
        var due = Now.AddDays(30);

        // A failed attempt leaves the asset tombstoned, due, and visibly pending with its reason.
        ready.BeginPurgeAttempt(due);
        ready.RecordPurgeFailure(due, "storage_io_error");
        Assert.AreEqual(MediaAssetStatus.Tombstoned, ready.Status);
        Assert.AreEqual("storage_io_error", ready.PurgeFailureCode);
        Assert.AreEqual(1, ready.PurgeAttemptCount);
        Assert.IsTrue(ready.IsPurgeDue(due));

        // The retry succeeds, clears the failure, and drops the key: nothing addresses the object.
        ready.BeginPurgeAttempt(due);
        ready.CompletePurge(due);
        Assert.AreEqual(MediaAssetStatus.Purged, ready.Status);
        Assert.AreEqual(due, ready.PurgedAtUtc);
        Assert.IsNull(ready.StorageKey);
        Assert.IsNull(ready.PurgeFailureCode);
        Assert.AreEqual(2, ready.PurgeAttemptCount);

        // Purged is terminal. Nothing may re-purge it, re-tombstone it, or reschedule its bytes.
        Assert.IsFalse(ready.IsPurgeDue(due));
        Assert.ThrowsExactly<InvalidOperationException>(() => ready.CompletePurge(due));
        Assert.ThrowsExactly<InvalidOperationException>(() => ready.BeginPurgeAttempt(due));
        Assert.ThrowsExactly<InvalidOperationException>(() => ready.RecordPurgeFailure(due, "storage_io_error"));
        Assert.ThrowsExactly<InvalidOperationException>(() =>
            ready.MarkTombstoned(due, TimeSpan.FromDays(30), isHistoricallyReferenced: false));
        Assert.ThrowsExactly<InvalidOperationException>(() =>
            ready.RecordScan(new MediaScanResult(true, "scanner", "1.0", null)));
    }

    [TestMethod]
    public void PurgingADerivativeIsIdempotentSoAPartialFailureCanBeReplayed()
    {
        var thumbnail = MediaAssetDerivative.RegisterThumbnail(
            TenantId,
            AssetId,
            18_432,
            new string('a', 64),
            "tenant/thumbnail-object",
            480,
            360);

        thumbnail.MarkPurged(Now);
        Assert.AreEqual(Now, thumbnail.PurgedAtUtc);
        Assert.IsNull(thumbnail.StorageKey);

        // A retry after a partial failure walks the same derivative list again, so a second purge
        // is a no-op rather than an error, and the first purge time is not overwritten.
        thumbnail.MarkPurged(Now.AddDays(1));
        Assert.AreEqual(Now, thumbnail.PurgedAtUtc);

        // Length and hash survive so accounting can still describe what was released.
        Assert.AreEqual(18_432, thumbnail.Length);
        Assert.AreEqual(new string('a', 64), thumbnail.Sha256);
    }

    private static MediaAsset Upload() => MediaAsset.RegisterUpload(
        TenantId,
        OwnerId,
        "Progress photo Front 2026-08-23",
        MediaKind.Image,
        "front.jpg",
        "image/jpeg",
        "image/jpeg",
        1_024,
        new string('b', 64),
        "tenant/object",
        MediaPurpose.ProgressPhoto);

    private static MediaAsset Ready()
    {
        var asset = Upload();
        asset.RecordScan(new MediaScanResult(true, "scanner", "1.0", null));
        return asset;
    }
}
