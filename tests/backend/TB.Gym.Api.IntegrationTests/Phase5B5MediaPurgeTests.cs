using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Media;

// The test class already has a nested MediaAsset DTO for HTTP responses, which would otherwise
// shadow the domain entity these assertions read straight from the database.
using StoredMediaAsset = TB.Gym.Modules.Media.MediaAsset;

namespace TB.Gym.Api.IntegrationTests;

public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task Phase5B5RemovingAPhotoSchedulesItsBytesForPurgeWithoutTakingThemFromTheClient()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "p5b5-sched-coach@example.test", "Purge Coach", "Purge Sched");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "p5b5-sched-client@example.test", true);
        SetTenant(client, workspaceId);

        var photo = await UploadProgressPhotoAsync(client, "/api/progress/me/photos?pose=Front&photoDate=2026-08-22");
        var beforeRemoval = await Phase5B5ReadAssetAsync(photo.MediaAssetId);
        Assert.AreEqual(MediaAssetStatus.Ready, beforeRemoval.Status);
        Assert.IsNull(beforeRemoval.PurgeAfterUtc);

        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync(
                $"/api/progress/me/photos/{photo.Id}/remove",
                new { reason = "Removed to schedule the purge.", photo.Version }),
            HttpStatusCode.OK);

        // Removing the photo now schedules the bytes. Before this chunk the image left the coach's
        // view but stayed on disk forever, counted against the allowance and never reclaimed.
        var scheduled = await Phase5B5ReadAssetAsync(photo.MediaAssetId);
        Assert.AreEqual(MediaAssetStatus.Tombstoned, scheduled.Status);
        Assert.IsNotNull(scheduled.PurgeAfterUtc);
        Assert.AreEqual(scheduled.TombstonedAtUtc!.Value.AddDays(30), scheduled.PurgeAfterUtc!.Value);

        // The client keeps their own photo until the bytes actually go, so a mistaken removal is
        // recoverable for the whole retention window.
        await AssertPhotoReadableAsync(client, photo.MediaAssetId, true);

        // Nothing is due yet, so a sweep run now must not touch it.
        Assert.AreEqual(0, (await Phase5B5SweepAsync()).Claimed);
        Assert.AreEqual(MediaAssetStatus.Tombstoned, (await Phase5B5ReadAssetAsync(photo.MediaAssetId)).Status);
    }

    [TestMethod]
    public async Task Phase5B5SweepDeletesOriginalAndDerivativeBytesAndKeepsTheHistoryRows()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "p5b5-sweep-coach@example.test", "Sweep Coach", "Purge Sweep");
        using var client = CreateClient();
        await InviteAndAcceptAsync(coach, client, "p5b5-sweep-client@example.test", true);
        SetTenant(client, workspaceId);

        var photo = await UploadProgressPhotoAsync(client, "/api/progress/me/photos?pose=Front&photoDate=2026-08-22");
        var keys = await Phase5B5ReadStorageKeysAsync(photo.MediaAssetId);
        Assert.IsNotNull(keys.AssetKey);
        Assert.IsNotNull(keys.DerivativeKey);
        Assert.IsTrue(Phase5B5ObjectExists(keys.AssetKey!));
        Assert.IsTrue(Phase5B5ObjectExists(keys.DerivativeKey!), "The thumbnail rendition was never written.");

        await Phase5B5RemoveAsync(client, photo);
        RequiredTestClock.Advance(TimeSpan.FromDays(31));

        var outcome = await Phase5B5SweepAsync();
        Assert.AreEqual(1, outcome.Claimed);
        Assert.AreEqual(1, outcome.Purged);
        Assert.AreEqual(0, outcome.Failed);

        // Both objects are physically gone: the rendition as well as the original.
        Assert.IsFalse(Phase5B5ObjectExists(keys.AssetKey!), "The original bytes survived the purge.");
        Assert.IsFalse(Phase5B5ObjectExists(keys.DerivativeKey!), "The thumbnail bytes survived the purge.");

        // The rows survive as history with their keys cleared, and the photo and its audited
        // removal are untouched: purging bytes must not rewrite the record that they existed.
        var purged = await Phase5B5ReadAssetAsync(photo.MediaAssetId);
        Assert.AreEqual(MediaAssetStatus.Purged, purged.Status);
        Assert.IsNotNull(purged.PurgedAtUtc);
        Assert.IsNull(purged.StorageKey);
        Assert.IsNull(purged.PurgeFailureCode);
        Assert.AreEqual(1, purged.PurgeAttemptCount);
        Assert.AreEqual(1, await Phase5B5CountAsync(context => context.MediaAssetDerivatives
            .IgnoreQueryFilters()
            .Where(item => item.MediaAssetId == photo.MediaAssetId && item.StorageKey == null && item.PurgedAtUtc != null)));
        Assert.AreEqual(1, await Phase5B5CountAsync(context => context.ProgressPhotos
            .IgnoreQueryFilters()
            .Where(item => item.Id == photo.Id)));
        Assert.AreEqual(1, await Phase5B5CountAsync(context => context.ProgressPhotoRemovals
            .IgnoreQueryFilters()
            .Where(item => item.ProgressPhotoId == photo.Id)));

        // A second sweep finds nothing: purged is terminal, not a state that keeps being retried.
        Assert.AreEqual(0, (await Phase5B5SweepAsync()).Claimed);
    }

    [TestMethod]
    public async Task Phase5B5StorageFailureLeavesTheRowPendingAndTheRetryIsIdempotent()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "p5b5-retry-coach@example.test", "Retry Coach", "Purge Retry");
        using var client = CreateClient();
        await InviteAndAcceptAsync(coach, client, "p5b5-retry-client@example.test", true);
        SetTenant(client, workspaceId);

        var photo = await UploadProgressPhotoAsync(client, "/api/progress/me/photos?pose=Back&photoDate=2026-08-22");
        var keys = await Phase5B5ReadStorageKeysAsync(photo.MediaAssetId);
        await Phase5B5RemoveAsync(client, photo);
        RequiredTestClock.Advance(TimeSpan.FromDays(31));

        RequiredStorageFaults.FailDeletes = true;
        var failedOutcome = await Phase5B5SweepAsync();
        Assert.AreEqual(1, failedOutcome.Claimed);
        Assert.AreEqual(0, failedOutcome.Purged);
        Assert.AreEqual(1, failedOutcome.Failed);

        // The asset is never silently marked complete on a failure. It stays tombstoned, still due,
        // and visibly pending with the reason recorded on the row.
        var pending = await Phase5B5ReadAssetAsync(photo.MediaAssetId);
        Assert.AreEqual(MediaAssetStatus.Tombstoned, pending.Status);
        Assert.IsNull(pending.PurgedAtUtc);
        Assert.IsNotNull(pending.StorageKey);
        Assert.AreEqual("storage_io_error", pending.PurgeFailureCode);
        Assert.AreEqual(1, pending.PurgeAttemptCount);
        Assert.IsTrue(Phase5B5ObjectExists(keys.AssetKey!), "The bytes were deleted despite the failure.");

        // A second failing sweep keeps retrying rather than giving up, and keeps counting.
        var secondFailure = await Phase5B5SweepAsync();
        Assert.AreEqual(1, secondFailure.Failed);
        Assert.AreEqual(2, (await Phase5B5ReadAssetAsync(photo.MediaAssetId)).PurgeAttemptCount);

        // Once storage recovers the retry completes and clears the failure. Deleting an object that
        // a partial attempt already removed counts as success, so replaying is safe.
        RequiredStorageFaults.FailDeletes = false;
        var recovered = await Phase5B5SweepAsync();
        Assert.AreEqual(1, recovered.Purged);
        var purged = await Phase5B5ReadAssetAsync(photo.MediaAssetId);
        Assert.AreEqual(MediaAssetStatus.Purged, purged.Status);
        Assert.IsNull(purged.PurgeFailureCode);
        Assert.AreEqual(3, purged.PurgeAttemptCount);
        Assert.IsFalse(Phase5B5ObjectExists(keys.AssetKey!));
        Assert.IsFalse(Phase5B5ObjectExists(keys.DerivativeKey!));
    }

    [TestMethod]
    public async Task Phase5B5ActiveAndHistoricallyReferencedMediaAreNeverPurged()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "p5b5-keep-coach@example.test", "Keep Coach", "Purge Keep");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "p5b5-keep-client@example.test", true);
        SetTenant(client, workspaceId);

        // An active photo, never removed.
        var active = await UploadProgressPhotoAsync(client, "/api/progress/me/photos?pose=Front&photoDate=2026-08-22");
        var activeKeys = await Phase5B5ReadStorageKeysAsync(active.MediaAssetId);

        // Exercise media that a started workout has snapshotted, then deleted by the coach. It is
        // tombstoned with no purge date, because a program snapshot must still resolve those bytes.
        var resources = await CreateTrainingResourcesAsync(coach, clientId, 8, 1, new DateOnly(2026, 8, 3), includeMedia: true);
        await AssignAsync(coach, clientId, resources, new DateOnly(2026, 8, 3));
        await RefreshCsrfAsync(coach);
        var deleteResponse = await coach.SendAsync(new HttpRequestMessage(
            HttpMethod.Delete,
            $"/api/media/{resources.Media!.Id}")
        {
            Content = JsonContent.Create(new { resources.Media.Version }),
        });
        await AssertStatusAsync(deleteResponse, HttpStatusCode.OK);
        var referenced = await Phase5B5ReadAssetAsync(resources.Media.Id);
        Assert.AreEqual(MediaAssetStatus.Tombstoned, referenced.Status);
        Assert.IsNull(referenced.PurgeAfterUtc, "Historically referenced media must be retained indefinitely.");
        var referencedKeys = await Phase5B5ReadStorageKeysAsync(resources.Media.Id);

        // Years later neither is eligible, so the sweep claims nothing at all.
        RequiredTestClock.Advance(TimeSpan.FromDays(3650));
        var outcome = await Phase5B5SweepAsync();
        Assert.AreEqual(0, outcome.Claimed);

        Assert.AreEqual(MediaAssetStatus.Ready, (await Phase5B5ReadAssetAsync(active.MediaAssetId)).Status);
        Assert.IsTrue(Phase5B5ObjectExists(activeKeys.AssetKey!), "An active photo was purged.");
        Assert.AreEqual(MediaAssetStatus.Tombstoned, (await Phase5B5ReadAssetAsync(resources.Media.Id)).Status);
        Assert.IsTrue(Phase5B5ObjectExists(referencedKeys.AssetKey!), "Historically referenced bytes were purged.");
    }

    [TestMethod]
    public async Task Phase5B5EveryAccessPathToAPurgedAssetFailsClosedForClientAndCoach()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "p5b5-gone-coach@example.test", "Gone Coach", "Purge Gone");
        using var client = CreateClient();
        await InviteAndAcceptAsync(coach, client, "p5b5-gone-client@example.test", true);
        SetTenant(client, workspaceId);

        var photo = await UploadProgressPhotoAsync(client, "/api/progress/me/photos?pose=Side&photoDate=2026-08-22");
        // Grants minted while the bytes still existed must not outlive them either.
        var beforePurge = await Phase5B5GrantAsync(client, photo.MediaAssetId);
        await AssertStatusAsync(await client.GetAsync(beforePurge.Url), HttpStatusCode.OK);
        await AssertStatusAsync(await client.GetAsync(beforePurge.ThumbnailUrl!), HttpStatusCode.OK);

        await Phase5B5RemoveAsync(client, photo);
        RequiredTestClock.Advance(TimeSpan.FromDays(31));
        Assert.AreEqual(1, (await Phase5B5SweepAsync()).Purged);

        var contentPath = MediaAccessCookie.Path(photo.MediaAssetId);
        var thumbnailPath = MediaAccessCookie.ThumbnailPath(photo.MediaAssetId);
        foreach (var caller in new[] { client, coach })
        {
            // Grant creation refuses: there is nothing left to grant.
            RequiredTestClock.Set(DateTimeOffset.UtcNow);
            await RefreshCsrfAsync(caller);
            var access = await caller.PostAsync($"/api/media/{photo.MediaAssetId}/access", null);
            Assert.IsTrue(
                access.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Forbidden,
                $"Expected the grant to be refused but received {(int)access.StatusCode}.");

            // Both content routes fail closed rather than erroring on a cleared storage key. A 500
            // here would mean the purge left an unhandled path into storage.
            foreach (var path in new[] { contentPath, thumbnailPath })
            {
                var response = await caller.GetAsync(path);
                Assert.IsTrue(
                    response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Forbidden,
                    $"Expected {path} to fail closed but received {(int)response.StatusCode}.");
            }
        }

        // The stale grant the client still holds resolves nothing either.
        await AssertStatusAsync(await client.GetAsync(beforePurge.Url), HttpStatusCode.NotFound);
        await AssertStatusAsync(await client.GetAsync(beforePurge.ThumbnailUrl!), HttpStatusCode.NotFound);

        // The dashboard stops offering a preview rather than pointing at bytes that are gone.
        var dashboard = await client.GetAsync("/api/progress/me/dashboard?from=2026-06-01&to=2026-10-01");
        await AssertStatusAsync(dashboard, HttpStatusCode.OK);
    }

    private static async Task Phase5B5RemoveAsync(HttpClient caller, Phase5B2Photo photo)
    {
        await RefreshCsrfAsync(caller);
        await AssertStatusAsync(
            await caller.PostAsJsonAsync(
                $"/api/progress/me/photos/{photo.Id}/remove",
                new { reason = "Removed for the purge test.", photo.Version }),
            HttpStatusCode.OK);
    }

    private async Task<Phase5B5Access> Phase5B5GrantAsync(HttpClient caller, Guid mediaAssetId)
    {
        RequiredTestClock.Set(DateTimeOffset.UtcNow);
        await RefreshCsrfAsync(caller);
        var response = await caller.PostAsync($"/api/media/{mediaAssetId}/access", null);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<Phase5B5Access>(response);
    }

    private async Task<MediaPurgeOutcome> Phase5B5SweepAsync()
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var service = scope.ServiceProvider.GetRequiredService<IMediaPurgeService>();
        return await service.PurgeDueAsync(50, TestContext.CancellationTokenSource.Token);
    }

    private async Task<StoredMediaAsset> Phase5B5ReadAssetAsync(Guid assetId)
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        return await context.MediaAssets
            .IgnoreQueryFilters()
            .AsNoTracking()
            .SingleAsync(item => item.Id == assetId, TestContext.CancellationTokenSource.Token);
    }

    private async Task<(string? AssetKey, string? DerivativeKey)> Phase5B5ReadStorageKeysAsync(Guid assetId)
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var token = TestContext.CancellationTokenSource.Token;
        var assetKey = await context.MediaAssets
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(item => item.Id == assetId)
            .Select(item => item.StorageKey)
            .SingleAsync(token);
        var derivativeKey = await context.MediaAssetDerivatives
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(item => item.MediaAssetId == assetId)
            .Select(item => item.StorageKey)
            .SingleOrDefaultAsync(token);
        return (assetKey, derivativeKey);
    }

    private async Task<int> Phase5B5CountAsync<TEntity>(
        Func<GymDbContext, IQueryable<TEntity>> query)
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        return await query(context).CountAsync(TestContext.CancellationTokenSource.Token);
    }

    private bool Phase5B5ObjectExists(string storageKey) =>
        File.Exists(Path.Combine(
            Path.GetTempPath(),
            databaseName!,
            "media",
            storageKey.Replace('/', Path.DirectorySeparatorChar)));

    private sealed record Phase5B5Access(string Url, string? ThumbnailUrl);
}
