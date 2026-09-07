using System.Net;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Media;
using TB.Gym.SharedKernel;

namespace TB.Gym.Api.IntegrationTests;

public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task Phase6B4APurgeClaimCommitsBeforeDeleteAndTwoWorkersCannotOwnIt()
    {
        var (workspaceId, photo) = await Phase6B4ACreateDuePhotoAsync(
            "claim",
            "Front");
        RequiredStorageFaults.ArmDeleteBarrier();

        var firstSweep = Phase5B5SweepAsync();
        try
        {
            var firstDelete = await RequiredStorageFaults.WaitForDeleteAsync(
                TestContext.CancellationTokenSource.Token);
            Assert.AreEqual(workspaceId, firstDelete.TenantId);

            var claimed = await Phase5B5ReadAssetAsync(photo.MediaAssetId);
            Assert.IsNotNull(claimed.PurgeClaimToken);
            Assert.IsGreaterThan(RequiredTestClock.UtcNow, claimed.PurgeClaimExpiresAtUtc!.Value);
            Assert.AreEqual(1, claimed.PurgeAttemptCount);

            var competing = await Phase5B5SweepAsync();
            Assert.AreEqual(0, competing.Claimed);
            Assert.AreEqual(0, competing.Purged);
            Assert.AreEqual(0, competing.Failed);
        }
        finally
        {
            RequiredStorageFaults.ReleaseDeleteBarrier();
        }

        var winner = await firstSweep;
        Assert.AreEqual(1, winner.Claimed);
        Assert.AreEqual(1, winner.Purged);
        Assert.AreEqual(MediaAssetStatus.Purged, (await Phase5B5ReadAssetAsync(photo.MediaAssetId)).Status);
    }

    [TestMethod]
    public async Task Phase6B4AExpiredLeaseIsReclaimedAndStaleTokenCannotFinalizeOrFailNewClaim()
    {
        var (workspaceId, photo) = await Phase6B4ACreateDuePhotoAsync(
            "stale",
            "Back");
        var firstToken = await Phase6B4AClaimAssetAsync(workspaceId, photo.MediaAssetId);
        Assert.AreEqual(0, (await Phase5B5SweepAsync()).Claimed);

        RequiredTestClock.Advance(TimeSpan.FromMinutes(3));
        var secondToken = await Phase6B4AClaimAssetAsync(workspaceId, photo.MediaAssetId);
        Assert.AreNotEqual(firstToken, secondToken);

        await using (var scope = RequiredFactory.Services.CreateAsyncScope())
        {
            scope.ServiceProvider.GetRequiredService<IMutableTenantContext>().SetTenant(workspaceId);
            var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
            var current = await context.MediaAssets.SingleAsync(item => item.Id == photo.MediaAssetId);
            Assert.AreEqual(secondToken, current.PurgeClaimToken);
            Assert.IsFalse(current.CompletePurge(RequiredTestClock.UtcNow, firstToken));
            Assert.IsFalse(current.RecordPurgeFailure(
                RequiredTestClock.UtcNow,
                firstToken,
                "stale_claim_must_not_win"));
            Assert.AreEqual(secondToken, current.PurgeClaimToken);
            Assert.IsNull(current.PurgeFailureCode);
        }

        Assert.AreEqual(0, (await Phase5B5SweepAsync()).Claimed);
        RequiredTestClock.Advance(TimeSpan.FromMinutes(3));
        var reclaimed = await Phase5B5SweepAsync();
        Assert.AreEqual(1, reclaimed.Claimed);
        Assert.AreEqual(1, reclaimed.Purged);
        var purged = await Phase5B5ReadAssetAsync(photo.MediaAssetId);
        Assert.AreEqual(MediaAssetStatus.Purged, purged.Status);
        Assert.AreEqual(3, purged.PurgeAttemptCount);
    }

    [TestMethod]
    public async Task Phase6B4ACrashBeforeDeletionLeavesAClaimThatExpiresAndReplays()
    {
        var (workspaceId, photo) = await Phase6B4ACreateDuePhotoAsync(
            "before-delete",
            "Side");
        var keys = await Phase5B5ReadStorageKeysAsync(photo.MediaAssetId);
        await Phase6B4AClaimAssetAsync(workspaceId, photo.MediaAssetId);

        Assert.IsTrue(Phase5B5ObjectExists(keys.AssetKey!));
        Assert.IsTrue(Phase5B5ObjectExists(keys.DerivativeKey!));
        Assert.AreEqual(0, (await Phase5B5SweepAsync()).Claimed);

        RequiredTestClock.Advance(TimeSpan.FromMinutes(3));
        var recovered = await Phase5B5SweepAsync();
        Assert.AreEqual(1, recovered.Purged);
        Assert.IsFalse(Phase5B5ObjectExists(keys.AssetKey!));
        Assert.IsFalse(Phase5B5ObjectExists(keys.DerivativeKey!));
    }

    [TestMethod]
    public async Task Phase6B4ACrashBetweenDerivativeAndOriginalIsRetryableWithoutReleasingQuota()
    {
        var (_, photo) = await Phase6B4ACreateDuePhotoAsync(
            "between-delete",
            "Front");
        var keys = await Phase5B5ReadStorageKeysAsync(photo.MediaAssetId);
        var occupied = await Phase5B5MeasureAsync();
        RequiredStorageFaults.FailDeleteCall(RequiredStorageFaults.DeleteCount + 2);

        var interrupted = await Phase5B5SweepAsync();
        Assert.AreEqual(1, interrupted.Failed);
        Assert.IsFalse(Phase5B5ObjectExists(keys.DerivativeKey!), "The derivative was not deleted first.");
        Assert.IsTrue(Phase5B5ObjectExists(keys.AssetKey!), "The original was deleted after its simulated failure.");
        Assert.AreEqual(occupied.TotalBytes, (await Phase5B5MeasureAsync()).TotalBytes);
        var pending = await Phase5B5ReadAssetAsync(photo.MediaAssetId);
        Assert.AreEqual(MediaAssetStatus.Tombstoned, pending.Status);
        Assert.AreEqual("storage_io_error", pending.PurgeFailureCode);

        RequiredStorageFaults.AllowDeletes();
        var recovered = await Phase5B5SweepAsync();
        Assert.AreEqual(1, recovered.Purged);
        Assert.AreEqual(0L, (await Phase5B5MeasureAsync()).TotalBytes);
        Assert.IsFalse(Phase5B5ObjectExists(keys.AssetKey!));
    }

    [TestMethod]
    public async Task Phase6B4ACrashAfterAllDeletesBeforeFinalizeReplaysMissingDeletesAsSuccess()
    {
        var (workspaceId, photo) = await Phase6B4ACreateDuePhotoAsync(
            "before-finalize",
            "Back");
        await Phase6B4AClaimAssetAsync(workspaceId, photo.MediaAssetId);
        var locators = await Phase6B4AReadLocatorsAsync(workspaceId, photo.MediaAssetId);
        var storage = RequiredFactory.Services.GetRequiredService<IObjectStorage>();

        foreach (var derivative in locators.Derivatives)
        {
            Assert.AreEqual(
                ObjectStorageOperationStatus.Success,
                (await storage.DeleteAsync(derivative, TestContext.CancellationTokenSource.Token)).Status);
        }

        Assert.AreEqual(
            ObjectStorageOperationStatus.Success,
            (await storage.DeleteAsync(locators.Original, TestContext.CancellationTokenSource.Token)).Status);
        Assert.AreEqual(0, (await Phase5B5SweepAsync()).Claimed);

        RequiredTestClock.Advance(TimeSpan.FromMinutes(3));
        var recovered = await Phase5B5SweepAsync();
        Assert.AreEqual(1, recovered.Purged);
        var purged = await Phase5B5ReadAssetAsync(photo.MediaAssetId);
        Assert.AreEqual(MediaAssetStatus.Purged, purged.Status);
        Assert.IsNull(purged.StorageKey);
        Assert.AreEqual(MediaStorageLocations.LocalV1, purged.StorageLocation);
    }

    [TestMethod]
    public async Task Phase6B4ACrossTenantContextCannotSeeOrClaimAnotherTenantsDueAsset()
    {
        var (workspaceId, photo) = await Phase6B4ACreateDuePhotoAsync(
            "cross-tenant",
            "Side");
        using var otherCoach = CreateClient();
        var otherTenantId = await RegisterCoachAsync(
            otherCoach,
            "p6b4-purge-other@example.test",
            "Other Purge Coach",
            "Other Purge Workspace");
        Assert.AreNotEqual(workspaceId, otherTenantId);

        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        scope.ServiceProvider.GetRequiredService<IMutableTenantContext>().SetTenant(otherTenantId);
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        Assert.IsNull(await context.MediaAssets.SingleOrDefaultAsync(item => item.Id == photo.MediaAssetId));

        var purged = await Phase5B5SweepAsync();
        Assert.AreEqual(1, purged.Purged);
    }

    private async Task<(Guid WorkspaceId, Phase5B2Photo Photo)> Phase6B4ACreateDuePhotoAsync(
        string scenario,
        string pose)
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(
            coach,
            $"p6b4-{scenario}-coach@example.test",
            $"{scenario} coach",
            $"{scenario} workspace");
        using var client = CreateClient();
        await InviteAndAcceptAsync(coach, client, $"p6b4-{scenario}-client@example.test", true);
        SetTenant(client, workspaceId);
        var photo = await UploadProgressPhotoAsync(
            client,
            $"/api/progress/me/photos?pose={pose}&photoDate=2026-08-22");
        await Phase5B5RemoveAsync(client, photo);
        RequiredTestClock.Advance(TimeSpan.FromDays(31));
        return (workspaceId, photo);
    }

    private async Task<Guid> Phase6B4AClaimAssetAsync(Guid tenantId, Guid assetId)
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        scope.ServiceProvider.GetRequiredService<IMutableTenantContext>().SetTenant(tenantId);
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var asset = await context.MediaAssets.SingleAsync(item => item.Id == assetId);
        var claimToken = Guid.NewGuid();
        asset.ClaimPurge(
            RequiredTestClock.UtcNow,
            TimeSpan.FromMinutes(2),
            claimToken);
        await context.SaveChangesAsync();
        return claimToken;
    }

    private async Task<(StorageObjectLocator Original, StorageObjectLocator[] Derivatives)>
        Phase6B4AReadLocatorsAsync(Guid tenantId, Guid assetId)
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        scope.ServiceProvider.GetRequiredService<IMutableTenantContext>().SetTenant(tenantId);
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var asset = await context.MediaAssets.AsNoTracking().SingleAsync(item => item.Id == assetId);
        var derivatives = await context.MediaAssetDerivatives
            .AsNoTracking()
            .Where(item => item.MediaAssetId == assetId)
            .ToListAsync();
        return (asset.GetStorageLocator(), derivatives.Select(item => item.GetStorageLocator()).ToArray());
    }
}
