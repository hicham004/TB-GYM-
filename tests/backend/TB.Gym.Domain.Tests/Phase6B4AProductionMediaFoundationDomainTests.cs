using TB.Gym.Modules.Media;

namespace TB.Gym.Domain.Tests;

[TestClass]
public sealed class Phase6B4AProductionMediaFoundationDomainTests
{
    private static readonly Guid TenantId = Guid.Parse("10000000-0000-0000-0000-000000006b4a");
    private static readonly Guid OtherTenantId = Guid.Parse("20000000-0000-0000-0000-000000006b4a");
    private static readonly Guid OwnerId = Guid.Parse("30000000-0000-0000-0000-000000006b4a");
    private static readonly Guid AssetId = Guid.Parse("40000000-0000-0000-0000-000000006b4a");
    private static readonly DateTimeOffset Now = new(2026, 9, 7, 9, 0, 0, TimeSpan.Zero);

    [TestMethod]
    public void StorageLocatorsNormalizeLocationAndCannotMixTenantIdentity()
    {
        var locator = new StorageObjectLocator(
            TenantId,
            "LOCAL-V1",
            $"{TenantId:N}/objects/photo.jpg");

        Assert.AreEqual(MediaStorageLocations.LocalV1, locator.Location);
        Assert.ThrowsExactly<ArgumentException>(() => new StorageObjectLocator(
            OtherTenantId,
            MediaStorageLocations.LocalV1,
            locator.ObjectKey));

        var otherTenantLocator = new StorageObjectLocator(
            OtherTenantId,
            MediaStorageLocations.LocalV1,
            $"{OtherTenantId:N}/objects/photo.jpg");
        Assert.ThrowsExactly<ArgumentException>(() => Upload(otherTenantLocator));
    }

    [TestMethod]
    public void SingleRangeResolutionCoversInclusiveOpenEndedSuffixAndBoundaryCases()
    {
        AssertRange(RequestedByteRange.FromStart(0, 0), 8, 0, 1);
        AssertRange(RequestedByteRange.FromStart(2, 5), 8, 2, 4);
        AssertRange(RequestedByteRange.FromStart(6), 8, 6, 2);
        AssertRange(RequestedByteRange.FromSuffix(2), 8, 6, 2);
        AssertRange(RequestedByteRange.FromSuffix(80), 8, 0, 8);
        AssertRange(RequestedByteRange.FromStart(7, 99), 8, 7, 1);

        Assert.IsFalse(RequestedByteRange.FromStart(8).TryResolve(8, out _));
        Assert.IsFalse(RequestedByteRange.FromStart(0).TryResolve(0, out _));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => RequestedByteRange.FromStart(-1));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => RequestedByteRange.FromStart(4, 3));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => RequestedByteRange.FromSuffix(0));
    }

    [TestMethod]
    public void ExactAllowedScanEvidenceIsRequiredBeforeOriginalOrDerivativeCanPublish()
    {
        var originalLocator = Locator("original");
        var original = Upload(originalLocator);
        var originalHash = original.Sha256!;

        var wrongHash = Evidence(originalLocator, new string('0', 64), allowed: true);
        Assert.ThrowsExactly<InvalidOperationException>(() => original.RecordScan(wrongHash));
        Assert.AreEqual(MediaAssetStatus.PendingScan, original.Status);

        var wrongLocator = Locator("other-original");
        Assert.ThrowsExactly<InvalidOperationException>(() =>
            original.RecordScan(Evidence(wrongLocator, originalHash, allowed: true)));
        Assert.AreEqual(MediaAssetStatus.PendingScan, original.Status);

        original.RecordScan(Evidence(originalLocator, originalHash, allowed: true));
        Assert.AreEqual(MediaAssetStatus.Ready, original.Status);
        Assert.AreEqual(MediaScanEvidenceState.Complete, original.ScanEvidenceState);
        Assert.AreEqual(originalHash, original.ScanSha256);

        var derivativeLocator = Locator("thumbnail");
        var derivativeHash = new string('a', 64);
        Assert.ThrowsExactly<InvalidOperationException>(() => MediaAssetDerivative.RegisterThumbnail(
            TenantId,
            AssetId,
            512,
            derivativeHash,
            derivativeLocator,
            Evidence(derivativeLocator, new string('b', 64), allowed: true),
            40,
            30));
        Assert.ThrowsExactly<InvalidOperationException>(() => MediaAssetDerivative.RegisterThumbnail(
            TenantId,
            AssetId,
            512,
            derivativeHash,
            derivativeLocator,
            Evidence(derivativeLocator, derivativeHash, allowed: false),
            40,
            30));

        var derivative = MediaAssetDerivative.RegisterThumbnail(
            TenantId,
            AssetId,
            512,
            derivativeHash,
            derivativeLocator,
            Evidence(derivativeLocator, derivativeHash, allowed: true),
            40,
            30);
        Assert.AreEqual(MediaScanEvidenceState.Complete, derivative.ScanEvidenceState);
        Assert.AreEqual(derivative.StorageKey, derivative.ScanStorageKey);
        Assert.AreEqual(derivative.Sha256, derivative.ScanSha256);
    }

    [TestMethod]
    public void ExpiredClaimsCanBeReplacedAndStaleClaimantsCannotFinalizeTheNewOwner()
    {
        var asset = Upload(Locator("leased"));
        asset.RecordScan(Evidence(asset.GetStorageLocator(), asset.Sha256!, allowed: true));
        asset.MarkTombstoned(Now, TimeSpan.Zero, isHistoricallyReferenced: false);

        var first = Guid.NewGuid();
        asset.ClaimPurge(Now, TimeSpan.FromMinutes(2), first);
        Assert.IsFalse(asset.IsPurgeClaimable(Now.AddMinutes(1)));

        var second = Guid.NewGuid();
        asset.ClaimPurge(Now.AddMinutes(2), TimeSpan.FromMinutes(2), second);
        Assert.IsFalse(asset.CompletePurge(Now.AddMinutes(2), first));
        Assert.IsFalse(asset.RecordPurgeFailure(Now.AddMinutes(2), first, "storage_io_error"));
        Assert.AreEqual(second, asset.PurgeClaimToken);
        Assert.IsNull(asset.PurgeFailureCode);

        Assert.IsTrue(asset.CompletePurge(Now.AddMinutes(2), second));
        Assert.AreEqual(MediaAssetStatus.Purged, asset.Status);
        Assert.IsNull(asset.StorageKey);
        Assert.AreEqual(MediaStorageLocations.LocalV1, asset.StorageLocation);
        Assert.AreEqual(2, asset.PurgeAttemptCount);
    }

    private static void AssertRange(
        RequestedByteRange requested,
        long objectLength,
        long expectedOffset,
        long expectedLength)
    {
        Assert.IsTrue(requested.TryResolve(objectLength, out var range));
        Assert.IsNotNull(range);
        Assert.AreEqual(expectedOffset, range.Offset);
        Assert.AreEqual(expectedLength, range.Length);
    }

    private static MediaAsset Upload(StorageObjectLocator locator) => MediaAsset.RegisterUpload(
        TenantId,
        OwnerId,
        "Phase 6B-4A photo",
        MediaKind.Image,
        "photo.jpg",
        "image/jpeg",
        "image/jpeg",
        1_024,
        new string('f', 64),
        locator,
        MediaPurpose.ProgressPhoto);

    private static StorageObjectLocator Locator(string suffix) => new(
        TenantId,
        MediaStorageLocations.LocalV1,
        $"{TenantId:N}/{suffix}");

    private static MediaScanEvidence Evidence(
        StorageObjectLocator locator,
        string sha256,
        bool allowed) => MediaScanEvidence.Record(
            locator,
            sha256,
            new MediaScanResult(
                allowed,
                "domain-test-scanner",
                "6b4a",
                allowed ? null : "malware_detected"),
            Now);
}
