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
        asset.RecordScan(Evidence(asset));
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
        Assert.ThrowsExactly<InvalidOperationException>(() =>
            asset.CompletePurge(Now.AddYears(50), Guid.NewGuid()));
        Assert.ThrowsExactly<InvalidOperationException>(() =>
            asset.ClaimPurge(Now.AddYears(50), TimeSpan.FromMinutes(2), Guid.NewGuid()));
    }

    [TestMethod]
    public void PurgeTransitionsAreOneWayAndRejectInvalidMoves()
    {
        var ready = Ready();

        // Purging skips no state: an asset must be tombstoned first.
        Assert.ThrowsExactly<InvalidOperationException>(() => ready.CompletePurge(Now, Guid.NewGuid()));
        Assert.ThrowsExactly<InvalidOperationException>(() =>
            ready.ClaimPurge(Now, TimeSpan.FromMinutes(2), Guid.NewGuid()));
        Assert.ThrowsExactly<InvalidOperationException>(() =>
            ready.RecordPurgeFailure(Now, Guid.NewGuid(), "storage_io_error"));

        ready.MarkTombstoned(Now, TimeSpan.FromDays(30), isHistoricallyReferenced: false);
        var due = Now.AddDays(30);

        // A failed attempt leaves the asset tombstoned, due, and visibly pending with its reason.
        var firstClaim = Guid.NewGuid();
        ready.ClaimPurge(due, TimeSpan.FromMinutes(2), firstClaim);
        Assert.IsTrue(ready.RecordPurgeFailure(due, firstClaim, "storage_io_error"));
        Assert.AreEqual(MediaAssetStatus.Tombstoned, ready.Status);
        Assert.AreEqual("storage_io_error", ready.PurgeFailureCode);
        Assert.AreEqual(1, ready.PurgeAttemptCount);
        Assert.IsTrue(ready.IsPurgeDue(due));

        // The retry succeeds, clears the failure, and drops the key: nothing addresses the object.
        var secondClaim = Guid.NewGuid();
        ready.ClaimPurge(due, TimeSpan.FromMinutes(2), secondClaim);
        Assert.IsTrue(ready.CompletePurge(due, secondClaim));
        Assert.AreEqual(MediaAssetStatus.Purged, ready.Status);
        Assert.AreEqual(due, ready.PurgedAtUtc);
        Assert.IsNull(ready.StorageKey);
        Assert.IsNull(ready.PurgeFailureCode);
        Assert.AreEqual(2, ready.PurgeAttemptCount);

        // Purged is terminal. Nothing may re-purge it, re-tombstone it, or reschedule its bytes.
        Assert.IsFalse(ready.IsPurgeDue(due));
        Assert.ThrowsExactly<InvalidOperationException>(() => ready.CompletePurge(due, secondClaim));
        Assert.ThrowsExactly<InvalidOperationException>(() =>
            ready.ClaimPurge(due, TimeSpan.FromMinutes(2), Guid.NewGuid()));
        Assert.ThrowsExactly<InvalidOperationException>(() =>
            ready.RecordPurgeFailure(due, secondClaim, "storage_io_error"));
        Assert.ThrowsExactly<InvalidOperationException>(() =>
            ready.MarkTombstoned(due, TimeSpan.FromDays(30), isHistoricallyReferenced: false));
        Assert.ThrowsExactly<InvalidOperationException>(() =>
            ready.RecordScan(Evidence(ready)));
    }

    [TestMethod]
    public void PurgingADerivativeIsIdempotentSoAPartialFailureCanBeReplayed()
    {
        var locator = Locator("thumbnail-object");
        var thumbnail = MediaAssetDerivative.RegisterThumbnail(
            TenantId,
            AssetId,
            18_432,
            new string('a', 64),
            locator,
            Evidence(locator, new string('a', 64)),
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
        Locator("object"),
        MediaPurpose.ProgressPhoto);

    private static MediaAsset Ready()
    {
        var asset = Upload();
        asset.RecordScan(Evidence(asset));
        return asset;
    }

    private static StorageObjectLocator Locator(string suffix) =>
        new(TenantId, MediaStorageLocations.LocalV1, $"{TenantId:N}/{suffix}");

    private static MediaScanEvidence Evidence(MediaAsset asset) =>
        Evidence(asset.GetStorageLocator(), asset.Sha256!);

    private static MediaScanEvidence Evidence(StorageObjectLocator locator, string sha256) =>
        MediaScanEvidence.Record(
            locator,
            sha256,
            new MediaScanResult(true, "scanner", "1.0", null),
            Now);
}
