using System.Net;
using System.Net.Http.Headers;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Media;

namespace TB.Gym.Api.IntegrationTests;

public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task Phase6B4AUnavailableStorageRefusesUploadBeforeAnyObjectOrReservationIsAccepted()
    {
        RequiredStorageFaults.IsUnavailable = true;
        using var coach = CreateClient();
        await RegisterCoachAsync(
            coach,
            "p6b4-unavailable-storage@example.test",
            "Unavailable Storage Coach",
            "Unavailable Storage Workspace");
        await RefreshCsrfAsync(coach);

        using var form = new MultipartFormDataContent();
        form.Add(new StringContent("Refused before storage"), "title");
        var file = new ByteArrayContent(JpegBytes);
        file.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");
        form.Add(file, "file", "never-accepted.jpg");

        var response = await coach.PostAsync("/api/media/uploads", form);

        Assert.AreEqual(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Contains("Media storage is unavailable", await response.Content.ReadAsStringAsync());
        Assert.AreEqual(0, RequiredStorageFaults.PutCount);
        Assert.AreEqual(0, RequiredStorageFaults.ReadCount);
        Assert.AreEqual(
            0,
            await Phase5B5CountAsync(context => context.MediaIngestObjects.IgnoreQueryFilters()),
            "Unavailable storage created a durable reservation before refusing the upload.");
        Assert.IsFalse(Directory.Exists(Path.Combine(Path.GetTempPath(), databaseName!, "media")));
    }

    [TestMethod]
    public async Task Phase6B4AHttpRangesAreExactAndHistoricalLocationSurvivesCurrentAdapterChange()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(
            coach,
            "p6b4-ranges@example.test",
            "Range Coach",
            "Range Workspace");
        var asset = await UploadJpegAsync(coach);
        var grant = await Phase5B5GrantAsync(coach, asset.Id);

        var full = await coach.GetAsync(grant.Url);
        Assert.AreEqual(HttpStatusCode.OK, full.StatusCode);
        CollectionAssert.AreEqual(JpegBytes, await full.Content.ReadAsByteArrayAsync());
        Assert.AreEqual(JpegBytes.Length, full.Content.Headers.ContentLength);
        Assert.AreEqual("image/jpeg", full.Content.Headers.ContentType!.MediaType);
        Assert.AreEqual("bytes", string.Join(",", full.Headers.AcceptRanges));

        await AssertRangeAsync(coach, grant.Url, "bytes=0-0", HttpStatusCode.PartialContent, [0xff], "bytes 0-0/8");
        await AssertRangeAsync(coach, grant.Url, "bytes=2-5", HttpStatusCode.PartialContent, [0xff, 0xe0, 0, 1], "bytes 2-5/8");
        await AssertRangeAsync(coach, grant.Url, "bytes=6-", HttpStatusCode.PartialContent, [2, 3], "bytes 6-7/8");
        await AssertRangeAsync(coach, grant.Url, "bytes=-2", HttpStatusCode.PartialContent, [2, 3], "bytes 6-7/8");
        await AssertRangeAsync(coach, grant.Url, "bytes=7-99", HttpStatusCode.PartialContent, [3], "bytes 7-7/8");

        var unsatisfiable = await SendRangeAsync(coach, grant.Url, "bytes=8-");
        Assert.AreEqual(HttpStatusCode.RequestedRangeNotSatisfiable, unsatisfiable.StatusCode);
        Assert.AreEqual("bytes */8", unsatisfiable.Content.Headers.ContentRange!.ToString());
        Assert.IsEmpty(await unsatisfiable.Content.ReadAsByteArrayAsync());

        foreach (var invalid in new[] { "bytes=4-3", "bytes=0-1,3-4", "items=0-1", "bytes=-0" })
        {
            var response = await SendRangeAsync(coach, grant.Url, invalid);
            Assert.AreEqual(
                HttpStatusCode.RequestedRangeNotSatisfiable,
                response.StatusCode,
                $"The invalid range '{invalid}' was accepted.");
        }

        var readsBeforeLocationChange = RequiredStorageFaults.ReadCount;
        RequiredStorageFaults.WriteLocationOverride = "next-location-v2";
        await AssertRangeAsync(coach, grant.Url, "bytes=1-2", HttpStatusCode.PartialContent, [0xd8, 0xff], "bytes 1-2/8");
        Assert.AreEqual(readsBeforeLocationChange + 1, RequiredStorageFaults.ReadCount);
        var lastRead = RequiredStorageFaults.Reads.Last();
        Assert.AreEqual(workspaceId, lastRead.Locator.TenantId);
        Assert.AreEqual(MediaStorageLocations.LocalV1, lastRead.Locator.Location);
        Assert.AreEqual(1L, lastRead.Range!.Offset);
        Assert.AreEqual(2L, lastRead.Range.Length);

        var stored = await Phase5B5ReadAssetAsync(asset.Id);
        Assert.AreEqual(MediaStorageLocations.LocalV1, stored.StorageLocation);
    }

    [TestMethod]
    public async Task Phase6B4ANewOriginalAndDerivativeEvidenceCoversExactStoredBytes()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(
            coach,
            "p6b4-evidence-coach@example.test",
            "Evidence Coach",
            "Evidence Workspace");
        using var client = CreateClient();
        await InviteAndAcceptAsync(coach, client, "p6b4-evidence-client@example.test", true);
        SetTenant(client, workspaceId);

        var photo = await UploadProgressPhotoAsync(
            client,
            "/api/progress/me/photos?pose=Front&photoDate=2026-08-22");

        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var original = await context.MediaAssets
            .IgnoreQueryFilters()
            .AsNoTracking()
            .SingleAsync(item => item.Id == photo.MediaAssetId);
        var derivative = await context.MediaAssetDerivatives
            .IgnoreQueryFilters()
            .AsNoTracking()
            .SingleAsync(item => item.MediaAssetId == photo.MediaAssetId);
        var scannedIngests = await context.MediaIngestObjects
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(item => item.ScanEvidenceState == MediaScanEvidenceState.Complete)
            .ToListAsync();

        AssertCompleteEvidence(
            original.StorageLocation!,
            original.StorageKey!,
            original.Sha256!,
            original.ScanEvidenceState,
            original.ScanStorageLocation,
            original.ScanStorageKey,
            original.ScanSha256,
            original.ScannerKey,
            original.ScannerVersion,
            original.ScannedAtUtc,
            original.ScanOutcome);
        AssertCompleteEvidence(
            derivative.StorageLocation,
            derivative.StorageKey!,
            derivative.Sha256,
            derivative.ScanEvidenceState,
            derivative.ScanStorageLocation,
            derivative.ScanStorageKey,
            derivative.ScanSha256,
            derivative.ScannerKey,
            derivative.ScannerVersion,
            derivative.ScannedAtUtc,
            derivative.ScanOutcome);
        Assert.IsEmpty(scannedIngests, "Published bytes are adopted by the asset rows rather than retaining a second ingest owner.");

        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using (var mismatch = connection.CreateCommand())
        {
            mismatch.CommandText =
                "UPDATE media.\"AssetDerivatives\" SET \"ScanSha256\" = repeat('0', 64) WHERE \"Id\" = @id";
            mismatch.Parameters.AddWithValue("id", derivative.Id);
            var refusal = await Assert.ThrowsExactlyAsync<PostgresException>(() => mismatch.ExecuteNonQueryAsync());
            Assert.AreEqual(PostgresErrorCodes.CheckViolation, refusal.SqlState);
        }

        await using (var legacy = connection.CreateCommand())
        {
            legacy.CommandText =
                "UPDATE media.\"AssetDerivatives\" SET \"ScanEvidenceState\" = 'LegacyUnavailable' WHERE \"Id\" = @id";
            legacy.Parameters.AddWithValue("id", derivative.Id);
            var refusal = await Assert.ThrowsExactlyAsync<PostgresException>(() => legacy.ExecuteNonQueryAsync());
            Assert.AreEqual(PostgresErrorCodes.CheckViolation, refusal.SqlState);
            Assert.AreEqual("CK_MediaScanEvidence_LegacyWrite", refusal.ConstraintName);
        }
    }

    [TestMethod]
    public async Task Phase6B4AStoragePortRangesCancellationAndTenantBoundDeletionAreOwnedSemantics()
    {
        using var coach = CreateClient();
        var tenantId = await RegisterCoachAsync(
            coach,
            "p6b4-port@example.test",
            "Storage Port Coach",
            "Storage Port Workspace");
        var storage = RequiredFactory.Services.GetRequiredService<IObjectStorage>();
        var locator = new StorageObjectLocator(
            tenantId,
            MediaStorageLocations.LocalV1,
            $"{tenantId:N}/contract/{Guid.NewGuid():N}.bin");
        var bytes = Enumerable.Range(0, 32).Select(value => (byte)value).ToArray();

        await using var source = new MemoryStream(bytes);
        var written = await storage.PutAsync(
            new ObjectUpload(locator, "application/octet-stream", source, bytes.Length),
            TestContext.CancellationTokenSource.Token);
        Assert.AreEqual(ObjectStorageOperationStatus.Success, written.Status);
        Assert.AreEqual(bytes.Length, written.StoredObject!.Length);

        var ranged = await storage.ReadAsync(
            new ObjectReadRequest(locator, "application/octet-stream", new ObjectByteRange(9, 7)),
            TestContext.CancellationTokenSource.Token);
        Assert.AreEqual(ObjectStorageOperationStatus.Success, ranged.Status);
        Assert.AreEqual(bytes.Length, ranged.Metadata!.ObjectLength);
        Assert.AreEqual(7L, ranged.Metadata.ContentLength);
        Assert.AreEqual("application/octet-stream", ranged.Metadata.ContentType);
        var rangedContent = ranged.Content!;
        await using (rangedContent)
        {
            var actual = new byte[7];
            await rangedContent.ReadExactlyAsync(actual);
            CollectionAssert.AreEqual(bytes[9..16], actual);
            Assert.IsFalse(rangedContent.CanSeek);
        }

        var otherTenant = Guid.NewGuid();
        var otherLocator = new StorageObjectLocator(
            otherTenant,
            MediaStorageLocations.LocalV1,
            $"{otherTenant:N}/contract/{Path.GetFileName(locator.ObjectKey)}");
        Assert.AreEqual(
            ObjectStorageOperationStatus.NotFound,
            (await storage.ReadAsync(
                new ObjectReadRequest(otherLocator, "application/octet-stream"),
                TestContext.CancellationTokenSource.Token)).Status);
        Assert.AreEqual(
            ObjectStorageOperationStatus.Success,
            (await storage.DeleteAsync(otherLocator, TestContext.CancellationTokenSource.Token)).Status);
        var full = await storage.ReadAsync(
            new ObjectReadRequest(locator, "application/octet-stream"),
            TestContext.CancellationTokenSource.Token);
        Assert.AreEqual(ObjectStorageOperationStatus.Success, full.Status);
        await full.Content!.DisposeAsync();

        using var cancelled = new CancellationTokenSource();
        cancelled.Cancel();
        await Assert.ThrowsExactlyAsync<OperationCanceledException>(() =>
            storage.ReadAsync(new ObjectReadRequest(locator, "application/octet-stream"), cancelled.Token));
        Assert.AreEqual(
            ObjectStorageOperationStatus.Success,
            (await storage.DeleteAsync(locator, TestContext.CancellationTokenSource.Token)).Status);
        Assert.AreEqual(
            ObjectStorageOperationStatus.Success,
            (await storage.DeleteAsync(locator, TestContext.CancellationTokenSource.Token)).Status);
    }

    private static async Task<HttpResponseMessage> SendRangeAsync(
        HttpClient caller,
        string url,
        string range)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        Assert.IsTrue(request.Headers.TryAddWithoutValidation("Range", range));
        return await caller.SendAsync(request);
    }

    private static async Task AssertRangeAsync(
        HttpClient caller,
        string url,
        string range,
        HttpStatusCode status,
        byte[] expected,
        string contentRange)
    {
        using var response = await SendRangeAsync(caller, url, range);
        Assert.AreEqual(status, response.StatusCode, range);
        CollectionAssert.AreEqual(expected, await response.Content.ReadAsByteArrayAsync(), range);
        Assert.AreEqual(expected.Length, response.Content.Headers.ContentLength, range);
        Assert.AreEqual(contentRange, response.Content.Headers.ContentRange!.ToString(), range);
        Assert.AreEqual("bytes", string.Join(",", response.Headers.AcceptRanges), range);
    }

    private static void AssertCompleteEvidence(
        string storageLocation,
        string storageKey,
        string sha256,
        MediaScanEvidenceState state,
        string? scanStorageLocation,
        string? scanStorageKey,
        string? scanSha256,
        string? scannerKey,
        string? scannerVersion,
        DateTimeOffset? scannedAtUtc,
        MediaScanOutcome? outcome)
    {
        Assert.AreEqual(MediaScanEvidenceState.Complete, state);
        Assert.AreEqual(storageLocation, scanStorageLocation);
        Assert.AreEqual(storageKey, scanStorageKey);
        Assert.AreEqual(sha256, scanSha256);
        Assert.IsFalse(string.IsNullOrWhiteSpace(scannerKey));
        Assert.IsFalse(string.IsNullOrWhiteSpace(scannerVersion));
        Assert.IsNotNull(scannedAtUtc);
        Assert.AreEqual(TimeSpan.Zero, scannedAtUtc.Value.Offset);
        Assert.AreEqual(MediaScanOutcome.Allowed, outcome);
    }
}
