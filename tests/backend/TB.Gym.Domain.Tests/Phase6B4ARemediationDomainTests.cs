using TB.Gym.Modules.Media;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// Phase 6B-4A remediation: the canonical storage-key grammar, and a refused original travelling
/// the cleanup lifecycle without losing the evidence that says why it was refused.
/// </summary>
[TestClass]
public sealed class Phase6B4ARemediationDomainTests
{
    private static readonly Guid TenantId = Guid.Parse("10000000-0000-0000-0000-00000006b4a1");
    private static readonly Guid OtherTenantId = Guid.Parse("20000000-0000-0000-0000-00000006b4a1");
    private static readonly Guid OwnerId = Guid.Parse("30000000-0000-0000-0000-00000006b4a1");
    private static readonly DateTimeOffset Now = new(2026, 9, 7, 9, 0, 0, TimeSpan.Zero);

    private static string Tenant => TenantId.ToString("N");

    private static string OtherTenant => OtherTenantId.ToString("N");

    [TestMethod]
    public void CanonicalKeysAcceptEveryHistoricalShapeThisApplicationHasEverWritten()
    {
        // Exactly the shapes the application and its migrations have created: the generated
        // `{tenant}/{uuid}` upload key, the dotted multi-segment key the storage-port contract test
        // writes, and the hyphenated key the Phase 5B-2 backfill test inserts.
        string[] historical =
        [
            $"{Tenant}/019291f0aaaa4bbbccccddddeeeeffff",
            $"{Tenant}/contract/019291f0aaaa4bbbccccddddeeeeffff.bin",
            $"{Tenant}/legacy-object",
            $"{Tenant}/objects/photo.jpg",
            $"{Tenant}/a_b/c-d.e",
        ];

        foreach (var key in historical)
        {
            var locator = new StorageObjectLocator(TenantId, MediaStorageLocations.LocalV1, key);

            // Verbatim: a durable address that was silently trimmed or rewritten would name a
            // different object than the one the row was written for.
            Assert.AreEqual(key, locator.ObjectKey, key);
        }
    }

    [TestMethod]
    public void CanonicalKeysRejectTraversalRootingAndUnsafeCharactersInEitherSeparatorForm()
    {
        (string Scenario, string Key)[] unsafeKeys =
        [
            // The finding itself: a key that satisfies a tenant-prefix check and still resolves
            // inside another tenant on every adapter that treats a key as a path.
            ("cross-tenant traversal", $"{Tenant}/../{OtherTenant}/object"),
            ("trailing dot-dot", $"{Tenant}/.."),
            ("interior dot-dot", $"{Tenant}/a/../b"),
            ("single dot segment", $"{Tenant}/./x"),
            ("multi dot segment", $"{Tenant}/.../x"),
            ("empty interior segment", $"{Tenant}/a//b"),
            ("trailing separator", $"{Tenant}/a/"),
            ("rooted key", $"/{Tenant}/a"),
            ("tenant prefix only", Tenant),
            ("backslash separator", $@"{Tenant}\a"),
            ("backslash traversal", $@"{Tenant}/a\..\b"),
            ("windows drive", $"{Tenant}/C:/x"),
            ("another tenant", $"{OtherTenant}/object"),
            // `StartsWith("<tenant>/")` was the old check; this is what a bare prefix comparison
            // without the separator would have let through.
            ("tenant prefix extension", $"{Tenant}ff/object"),
            ("embedded space", $"{Tenant}/a b"),
            ("embedded newline", $"{Tenant}/a\nb"),
            ("embedded null", $"{Tenant}/a\0b"),
            ("leading whitespace", $" {Tenant}/a"),
            ("trailing whitespace", $"{Tenant}/a "),
            ("percent escape", $"{Tenant}/%2e%2e/x"),
            ("over length", $"{Tenant}/{new string('a', StorageObjectLocator.MaximumKeyLength)}"),
        ];

        foreach (var (scenario, key) in unsafeKeys)
        {
            Assert.ThrowsExactly<ArgumentException>(
                () => new StorageObjectLocator(TenantId, MediaStorageLocations.LocalV1, key),
                scenario);
        }
    }

    [TestMethod]
    public void RefusedEvidenceStaysExactWhileTheRefusedBytesTravelTombstoneToPurge()
    {
        var locator = new StorageObjectLocator(
            TenantId,
            MediaStorageLocations.LocalV1,
            $"{Tenant}/019291f0aaaa4bbbccccddddeeeeffff");
        var asset = MediaAsset.RegisterUpload(
            TenantId,
            OwnerId,
            "Refused upload",
            MediaKind.Image,
            "photo.jpg",
            "image/jpeg",
            "image/jpeg",
            1_024,
            new string('b', 64),
            locator,
            MediaPurpose.ProgressPhoto);

        asset.RecordScan(MediaScanEvidence.Record(
            locator,
            asset.Sha256!,
            new MediaScanResult(false, "domain-test-scanner", "6b4a", "malware_detected"),
            Now));
        Assert.AreEqual(MediaAssetStatus.Rejected, asset.Status);
        Assert.AreEqual(MediaScanOutcome.Refused, asset.ScanOutcome);

        // The refused bytes are still stored, so they still have to be reclaimed. Tombstoning is
        // how that is scheduled, and it must not rewrite what the scanner said.
        asset.MarkTombstoned(Now, TimeSpan.FromDays(30), isHistoricallyReferenced: false);
        Assert.AreEqual(MediaAssetStatus.Tombstoned, asset.Status);
        Assert.AreEqual(MediaScanOutcome.Refused, asset.ScanOutcome);
        Assert.AreEqual(MediaScanEvidenceState.Complete, asset.ScanEvidenceState);
        Assert.AreEqual(locator.ObjectKey, asset.ScanStorageKey);
        Assert.AreEqual(asset.Sha256, asset.ScanSha256);
        Assert.AreEqual("malware_detected", asset.ScanFailureCode);

        var due = Now.AddDays(30);
        Assert.IsTrue(asset.IsPurgeDue(due));
        var claim = Guid.NewGuid();
        asset.ClaimPurge(due, TimeSpan.FromMinutes(2), claim);
        Assert.IsTrue(asset.CompletePurge(due, claim));

        Assert.AreEqual(MediaAssetStatus.Purged, asset.Status);
        Assert.IsNull(asset.StorageKey);
        Assert.AreEqual(MediaStorageLocations.LocalV1, asset.StorageLocation);
        Assert.AreEqual(MediaScanOutcome.Refused, asset.ScanOutcome);
        Assert.AreEqual(locator.ObjectKey, asset.ScanStorageKey);
    }
}
