using System.Net;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TB.Gym.Infrastructure.Application;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Media;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// A progress photo through the production providers, end to end.
/// </summary>
/// <remarks>
/// The sanitiser is the one media path that reads a stored object back and decodes it, and it was
/// the one path no provider test covered. Every test above it uploaded and read bytes; none asked a
/// codec to interpret them. That gap hid a defect that only exists off local disk: a file stream
/// seeks and a remote response body does not, so the decoder was handed a stream it could not
/// rewind, produced no codec, and every progress-photo upload was refused as an image that could not
/// be processed — a correct-looking 400 for a perfectly valid photograph.
/// <para>
/// This runs the real R2 adapter over the fake S3 transport and the real ClamAV adapter over the
/// fake daemon, so the read the sanitiser decodes is the actual non-seekable response body, and both
/// stored objects are actually scanned.
/// </para>
/// </remarks>
public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task Phase6B4BOverProvidersAProgressPhotoIsSanitizedFromTheNonSeekableStoredObject()
    {
        var harness = RequiredProviderHarness;
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(
            coach,
            "p6b4b-photo-coach@example.test",
            "Photo Coach",
            "Photo Workspace");
        using var client = CreateClient();
        await InviteAndAcceptAsync(coach, client, "p6b4b-photo-client@example.test", newAccount: true);
        SetTenant(client, workspaceId);

        var uploaded = ProgressPhotoImageFactory.DetailedJpegWithExif(
            1200,
            900,
            ProgressPhotoImageFactory.UprightOrientation);
        Assert.IsTrue(
            Contains(uploaded, ProgressPhotoImageFactory.SecretDescription),
            "The uploaded photo carries no private metadata, so nothing would be proved by removing it.");

        var response = await PostProgressPhotoAsync(
            client,
            "/api/progress/me/photos?pose=Front&photoDate=2026-08-22",
            uploaded);

        // 1. A normal success. Before this fix the same request was a 400 naming the caller's file.
        await AssertStatusAsync(response, HttpStatusCode.OK);
        var photo = await RequiredJsonAsync<Phase6B4BPhoto>(response);

        // 2. Both stored objects live at the production location, and they are the only two objects
        //    in the bucket: the raw upload the sanitiser decoded is gone.
        var asset = await Phase5B5ReadAssetAsync(photo.MediaAssetId);
        var derivative = await Phase6B4BReadThumbnailAsync(photo.MediaAssetId);
        Assert.AreEqual(R2StorageOptions.LocationName, asset.StorageLocation);
        Assert.AreEqual(R2StorageOptions.LocationName, derivative.StorageLocation);
        Assert.AreEqual(MediaAssetStatus.Ready, asset.Status);
        Assert.IsNotNull(asset.StorageKey);
        Assert.IsNotNull(derivative.StorageKey);
        CollectionAssert.AreEquivalent(
            new[] { asset.StorageKey!, derivative.StorageKey! },
            harness.Bucket.Objects.Keys.ToArray(),
            "The bucket holds something other than the sanitised original and its thumbnail.");

        // 3. Neither stored object carries the uploader's metadata, and neither is the uploaded file.
        var storedOriginal = harness.Bucket[asset.StorageKey!];
        var storedThumbnail = harness.Bucket[derivative.StorageKey!];
        Assert.IsFalse(Contains(storedOriginal, ProgressPhotoImageFactory.SecretDescription));
        Assert.IsFalse(Contains(storedThumbnail, ProgressPhotoImageFactory.SecretDescription));
        Assert.IsFalse(ContainsExifApp1(storedOriginal), "An EXIF APP1 segment survived into the original.");
        Assert.IsFalse(ContainsExifApp1(storedThumbnail), "An EXIF APP1 segment survived into the thumbnail.");
        Assert.AreEqual((1200, 900), ProgressPhotoImageFactory.Measure(storedOriginal));
        Assert.AreEqual(
            MediaThumbnailPolicy.Fit(1200, 900),
            ProgressPhotoImageFactory.Measure(storedThumbnail));

        // 4. Both were scanned, and the evidence names the exact bytes that were stored.
        var originalEvidence = await ReadScanEvidenceAsync(photo.MediaAssetId);
        Assert.AreEqual("Allowed", originalEvidence.Outcome);
        Assert.AreEqual("Complete", originalEvidence.State);
        Assert.AreEqual(asset.StorageKey, originalEvidence.StorageKey);
        Assert.AreEqual(asset.Sha256, originalEvidence.Sha256);
        Assert.AreEqual(R2StorageOptions.LocationName, originalEvidence.StorageLocation);
        Assert.AreEqual(MediaScanEvidenceState.Complete, derivative.ScanEvidenceState);
        Assert.AreEqual(MediaScanOutcome.Allowed, derivative.ScanOutcome);
        Assert.AreEqual(derivative.StorageKey, derivative.ScanStorageKey);
        Assert.AreEqual(derivative.Sha256, derivative.ScanSha256);
        // The scanner saw the sanitised bytes, not the ones the client uploaded.
        var scanned = harness.Daemon.Sessions
            .Where(session => session.Command == "zINSTREAM")
            .Select(session => session.ReceivedBody)
            .ToArray();
        Assert.HasCount(2, scanned);
        Assert.IsTrue(
            scanned.Any(body => body.SequenceEqual(storedOriginal)) &&
            scanned.Any(body => body.SequenceEqual(storedThumbnail)),
            "The scanner was given bytes other than the two objects that were stored.");

        // 5. Both variants are readable by the client who owns them and by their unblocked coach,
        //    under the ordinary grant, and both come back out of the bucket.
        foreach (var caller in new[] { client, coach })
        {
            var grant = await Phase5B3GrantAsync(caller, photo.MediaAssetId);
            Assert.IsNotNull(grant.ThumbnailUrl);
            var original = await caller.GetAsync(grant.Url);
            await AssertStatusAsync(original, HttpStatusCode.OK);
            CollectionAssert.AreEqual(storedOriginal, await original.Content.ReadAsByteArrayAsync());
            var thumbnail = await caller.GetAsync(grant.ThumbnailUrl);
            await AssertStatusAsync(thumbnail, HttpStatusCode.OK);
            CollectionAssert.AreEqual(storedThumbnail, await thumbnail.Content.ReadAsByteArrayAsync());
        }

        // 6. Nothing was left behind: no reservation still counting bytes, no media row in a state
        //    that needs cleaning up, and an allowance that measures exactly the two stored objects.
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var token = TestContext.CancellationTokenSource.Token;
        var ingest = await context.MediaIngestObjects
            .IgnoreQueryFilters()
            .AsNoTracking()
            .ToListAsync(token);
        Assert.IsTrue(
            ingest.All(item => item.Status == MediaIngestObjectStatus.Purged && item.StorageKey is null),
            "A raw or intermediate ingest object is still reserved, so its bytes still count against the allowance.");
        Assert.HasCount(
            1,
            await context.MediaAssets.IgnoreQueryFilters().AsNoTracking().ToListAsync(token));
        Assert.IsEmpty(
            await context.MediaAssets
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(item => item.Status != MediaAssetStatus.Ready)
                .ToListAsync(token),
            "A failed media row survived a successful upload.");
        var usage = await Phase5B5MeasureAsync();
        Assert.AreEqual(
            asset.Length + derivative.Length,
            usage.TotalBytes,
            "The allowance counts bytes other than the two objects the bucket actually holds.");
        Assert.AreEqual(storedOriginal.Length, asset.Length);
        Assert.AreEqual(storedThumbnail.Length, derivative.Length);
    }

    private async Task<MediaAssetDerivative> Phase6B4BReadThumbnailAsync(Guid mediaAssetId)
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        return await context.MediaAssetDerivatives
            .IgnoreQueryFilters()
            .AsNoTracking()
            .SingleAsync(
                item => item.MediaAssetId == mediaAssetId && item.Variant == MediaDerivativeVariant.Thumbnail,
                TestContext.CancellationTokenSource.Token);
    }

    private sealed record Phase6B4BPhoto(Guid Id, Guid MediaAssetId, uint Version);
}
