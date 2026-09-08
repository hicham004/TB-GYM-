using System.Globalization;
using System.Net;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TB.Gym.Infrastructure.Application;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Media;

using StoredMediaAsset = TB.Gym.Modules.Media.MediaAsset;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The production providers in the real request path: an upload stored in R2, scanned by clamd, and
/// served back under the same authorization every other media request uses.
/// </summary>
/// <remarks>
/// The adapters have their own tests against the same fakes. What this file adds is the composition:
/// that the API actually writes to the configured bucket, that the scanner reads the bytes that were
/// stored rather than the ones that were uploaded, that a refusal and an outage each leave nothing
/// behind, and that authorization still completes before the bucket is asked anything.
/// </remarks>
public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task Phase6B4BOverProvidersAnUploadIsStoredInR2AndScannedFromTheStoredBytes()
    {
        var harness = RequiredProviderHarness;
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(
            coach,
            "p6b4b-upload@example.test",
            "Provider Coach",
            "Provider Workspace");

        var asset = await UploadJpegAsync(coach);

        var stored = await Phase5B5ReadAssetAsync(asset.Id);
        Assert.AreEqual(R2StorageOptions.LocationName, stored.StorageLocation);
        Assert.AreEqual(workspaceId, stored.TenantId);
        Assert.IsNotNull(stored.StorageKey);
        CollectionAssert.AreEqual(
            JpegBytes,
            harness.Bucket[stored.StorageKey!],
            "The bytes in the bucket are not the bytes that were uploaded.");

        // The scan is of what was stored, which is the whole reason evidence names a locator.
        var scan = harness.Daemon.Sessions.Single(session => session.Command == "zINSTREAM");
        CollectionAssert.AreEqual(JpegBytes, scan.ReceivedBody);
        Assert.IsTrue(scan.SawTerminator);

        var evidence = await ReadScanEvidenceAsync(asset.Id);
        Assert.AreEqual(ClamAvScannerOptions.ScannerKey, evidence.ScannerKey);
        Assert.AreEqual("ClamAV 1.5.4/28115", evidence.ScannerVersion);
        Assert.AreEqual("Allowed", evidence.Outcome);
        Assert.AreEqual("Complete", evidence.State);
        Assert.AreEqual(stored.Sha256, evidence.Sha256);
        Assert.AreEqual(stored.StorageKey, evidence.StorageKey);
        Assert.AreEqual(R2StorageOptions.LocationName, evidence.StorageLocation);
    }

    [TestMethod]
    public async Task Phase6B4BOverProvidersFullAndRangedReadsAreServedFromTheBucket()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(
            coach,
            "p6b4b-read@example.test",
            "Reading Coach",
            "Reading Workspace");
        var asset = await UploadJpegAsync(coach);
        var grant = await Phase5B5GrantAsync(coach, asset.Id);

        var full = await coach.GetAsync(grant.Url);
        Assert.AreEqual(HttpStatusCode.OK, full.StatusCode);
        CollectionAssert.AreEqual(JpegBytes, await full.Content.ReadAsByteArrayAsync());
        Assert.AreEqual(JpegBytes.Length, full.Content.Headers.ContentLength);

        await AssertRangeAsync(
            coach,
            grant.Url,
            "bytes=2-5",
            HttpStatusCode.PartialContent,
            [0xff, 0xe0, 0, 1],
            "bytes 2-5/8");
        await AssertRangeAsync(
            coach,
            grant.Url,
            "bytes=-2",
            HttpStatusCode.PartialContent,
            [2, 3],
            "bytes 6-7/8");

        var unsatisfiable = await SendRangeAsync(coach, grant.Url, "bytes=8-");
        Assert.AreEqual(HttpStatusCode.RequestedRangeNotSatisfiable, unsatisfiable.StatusCode);
    }

    [TestMethod]
    public async Task Phase6B4BOverProvidersADetectionRefusesTheUploadAndLeavesNothingStored()
    {
        var harness = RequiredProviderHarness;
        harness.InstreamReply = "stream: Eicar-Test-Signature FOUND";
        using var coach = CreateClient();
        await RegisterCoachAsync(
            coach,
            "p6b4b-detection@example.test",
            "Detection Coach",
            "Detection Workspace");

        var refused = await PostJpegAsync(coach);

        Assert.AreEqual(HttpStatusCode.BadRequest, refused.StatusCode);
        var body = await refused.Content.ReadAsStringAsync();
        Assert.Contains("deleted or scheduled for secure cleanup", body, StringComparison.Ordinal);
        Assert.DoesNotContain(
            "Eicar",
            body,
            StringComparison.OrdinalIgnoreCase,
            "The response named the signature the scanner matched.");
        Assert.IsEmpty(harness.Bucket.Objects, "Refused bytes were left in the bucket.");
        Assert.AreEqual(0, await Phase5B5CountAsync(context => context.MediaAssets.IgnoreQueryFilters()));
    }

    [TestMethod]
    public async Task Phase6B4BOverProvidersAScannerOutageIsUnavailableAndCommitsNoAsset()
    {
        var harness = RequiredProviderHarness;
        harness.InstreamReply = "INSTREAM size limit exceeded. ERROR";
        using var coach = CreateClient();
        await RegisterCoachAsync(
            coach,
            "p6b4b-outage@example.test",
            "Outage Coach",
            "Outage Workspace");

        var refused = await PostJpegAsync(coach);

        Assert.AreEqual(HttpStatusCode.ServiceUnavailable, refused.StatusCode);
        Assert.IsEmpty(harness.Bucket.Objects, "An unscannable upload left its bytes in the bucket.");
        Assert.AreEqual(0, await Phase5B5CountAsync(context => context.MediaAssets.IgnoreQueryFilters()));
        // The reservation survives as history, purged with its key cleared — never as a live
        // reservation that nothing will ever attach or clean.
        Assert.AreEqual(
            0,
            await Phase5B5CountAsync(context => context.MediaIngestObjects
                .IgnoreQueryFilters()
                .Where(item => item.Status != MediaIngestObjectStatus.Purged)),
            "A failed upload left a reservation that was neither attached nor cleaned.");
    }

    [TestMethod]
    public async Task Phase6B4BOverProvidersAStorageOutageIsUnavailableAndCommitsNoAsset()
    {
        var harness = RequiredProviderHarness;
        using var coach = CreateClient();
        await RegisterCoachAsync(
            coach,
            "p6b4b-storageoutage@example.test",
            "Storage Outage Coach",
            "Storage Outage Workspace");
        harness.Bucket.Fault = request => request.Method == "PUT"
            ? FakeS3Handler.Error(HttpStatusCode.InternalServerError, "InternalError")
            : null;

        var refused = await PostJpegAsync(coach);

        Assert.AreEqual(HttpStatusCode.ServiceUnavailable, refused.StatusCode);
        Assert.IsEmpty(harness.Bucket.Objects);
        Assert.AreEqual(0, await Phase5B5CountAsync(context => context.MediaAssets.IgnoreQueryFilters()));
        Assert.IsEmpty(
            harness.Daemon.Sessions.Where(session => session.Command == "zINSTREAM"),
            "A file that was never stored was nevertheless scanned.");
    }

    /// <summary>
    /// Authorization completes before storage is opened, so a caller who may not read an asset
    /// causes no provider request at all — not a refused one, and not a successful one that is then
    /// thrown away.
    /// </summary>
    [TestMethod]
    public async Task Phase6B4BOverProvidersAnUnauthorizedReadNeverReachesTheBucket()
    {
        var harness = RequiredProviderHarness;
        using var owner = CreateClient();
        await RegisterCoachAsync(
            owner,
            "p6b4b-owner@example.test",
            "Owning Coach",
            "Owning Workspace");
        var asset = await UploadJpegAsync(owner);
        var grant = await Phase5B5GrantAsync(owner, asset.Id);
        await AssertStatusAsync(await owner.GetAsync(grant.Url), HttpStatusCode.OK);

        using var stranger = CreateClient();
        await RegisterCoachAsync(
            stranger,
            "p6b4b-stranger@example.test",
            "Other Coach",
            "Other Workspace");
        var requestsBefore = harness.Bucket.RequestCount;

        // The stranger's own workspace, their own session, and somebody else's asset - with and
        // without the other workspace's grant cookie, which they cannot mint anyway.
        await RefreshCsrfAsync(stranger);
        var refusedGrant = await stranger.PostAsync($"/api/media/{asset.Id}/access", null);
        Assert.IsTrue(
            refusedGrant.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Forbidden,
            $"Expected the grant to be refused but received {(int)refusedGrant.StatusCode}.");

        var refusedContent = await stranger.GetAsync(grant.Url);
        Assert.IsTrue(
            refusedContent.StatusCode is HttpStatusCode.NotFound
                or HttpStatusCode.Forbidden
                or HttpStatusCode.Unauthorized,
            $"Expected the content to be refused but received {(int)refusedContent.StatusCode}.");

        var refusedRange = await SendRangeAsync(stranger, grant.Url, "bytes=0-3");
        Assert.IsTrue(
            refusedRange.StatusCode is HttpStatusCode.NotFound
                or HttpStatusCode.Forbidden
                or HttpStatusCode.Unauthorized,
            $"Expected the ranged read to be refused but received {(int)refusedRange.StatusCode}.");

        Assert.AreEqual(
            requestsBefore,
            harness.Bucket.RequestCount,
            "A refused media request still opened the object store.");
    }

    private Phase6B4BProviderHarness RequiredProviderHarness =>
        providerHarness ?? throw new InvalidOperationException(
            "The provider harness only starts for tests named Phase6B4BOverProviders*.");

    private static async Task<HttpResponseMessage> PostJpegAsync(HttpClient coach)
    {
        await RefreshCsrfAsync(coach);
        using var form = new System.Net.Http.MultipartFormDataContent();
        form.Add(new StringContent("Refused demo"), "title");
        var file = new ByteArrayContent(JpegBytes);
        file.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("image/jpeg");
        form.Add(file, "file", "refused-demo.jpg");
        return await coach.PostAsync("/api/media/uploads", form);
    }

    private async Task<ScanEvidenceRow> ReadScanEvidenceAsync(Guid assetId)
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var asset = await context.MediaAssets
            .IgnoreQueryFilters()
            .AsNoTracking()
            .SingleAsync(item => item.Id == assetId, TestContext.CancellationTokenSource.Token);
        var entry = context.Entry(asset);
        return new ScanEvidenceRow(
            Property<string>(entry, "ScanEvidenceState"),
            Property<string>(entry, "ScanStorageLocation"),
            Property<string>(entry, "ScanStorageKey"),
            Property<string>(entry, "ScanSha256"),
            Property<string>(entry, "ScannerKey"),
            Property<string>(entry, "ScannerVersion"),
            Property<string>(entry, "ScanOutcome"));
    }

    private static string? Property<T>(
        Microsoft.EntityFrameworkCore.ChangeTracking.EntityEntry<StoredMediaAsset> entry,
        string name)
    {
        var value = entry.Property(name).CurrentValue;
        return value switch
        {
            null => null,
            string text => text,
            _ => Convert.ToString(value, CultureInfo.InvariantCulture),
        };
    }

    private sealed record ScanEvidenceRow(
        string? State,
        string? StorageLocation,
        string? StorageKey,
        string? Sha256,
        string? ScannerKey,
        string? ScannerVersion,
        string? Outcome);
}
