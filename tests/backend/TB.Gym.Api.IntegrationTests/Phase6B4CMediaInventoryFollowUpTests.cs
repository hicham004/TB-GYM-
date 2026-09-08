using System.Net;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TB.Gym.Infrastructure.Application;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Media;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The Phase 6B-4C follow-up: what closes a finding, what a recovered provider failure means, and
/// what a lease is worth while a remote call is in flight.
/// </summary>
/// <remarks>
/// Every one of these is about a statement the pass is entitled to make. Resolving a finding is the
/// strongest one it has — it says a condition somebody would otherwise investigate has gone — and the
/// first cut made it on evidence that did not support it: a successful stat proves an object exists
/// and nothing else, and an object that stopped being listed was never revisited at all. So these
/// tests are mostly about the negative half: what a partial pass may not conclude, and what only a
/// complete one may.
/// </remarks>
public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task Phase6B4COverProvidersAnObjectThatStopsBeingListedResolvesOnlyAfterACompleteRun()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(
            coach,
            "p6b4c-selfheal@example.test",
            "Healing Coach",
            "Healing Workspace");
        var orphan = Phase6B4CSeedUnownedObject(workspaceId);

        await Phase6B4CReconcileAsync();
        var opened = (await Phase6B4CFindingsAsync()).Single();
        Assert.AreEqual(MediaInventoryFindingKind.UnownedObject, opened.Kind);
        Assert.IsFalse(opened.IsResolved);

        // Somebody dealt with it. The object is no longer listed, so nothing probes it and nothing
        // enumerates it — which is exactly why the first cut left this finding open forever.
        Assert.IsTrue(RequiredProviderHarness.Bucket.Objects.TryRemove(orphan, out _));

        // A pass that could not read everything must not conclude anything from not having seen it.
        RequiredInventoryProbe.FailListCalls = 1;
        var partial = await Phase6B4CReconcileAsync();
        Assert.AreEqual(MediaInventoryRunState.Running, partial.State);
        Assert.IsFalse(
            (await Phase6B4CFindingsAsync()).Single().IsResolved,
            "A failed pass resolved a finding it never re-examined.");

        var complete = await Phase6B4CReconcileAsync();
        Assert.AreEqual(MediaInventoryRunState.Completed, complete.State);
        var resolved = (await Phase6B4CFindingsAsync()).Single();
        Assert.AreEqual(opened.Id, resolved.Id, "The condition was refiled rather than resolved.");
        Assert.IsTrue(resolved.IsResolved);
        Assert.AreEqual(MediaInventoryResolutionCodes.ObserverConsistent, resolved.ResolutionCode);
        Assert.IsFalse(resolved.IsActionable);
        Assert.AreEqual(1, complete.FindingsResolved);
        Assert.AreEqual(
            1,
            (await Phase6B4CRunsAsync()).Sum(item => item.FindingsResolved),
            "The run that closed the finding did not record having closed it.");
    }

    [TestMethod]
    public async Task Phase6B4COverProvidersAPurgedObjectThatDisappearsAgainResolvesOnItsOwn()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(
            coach,
            "p6b4c-purged-heal@example.test",
            "Purged Healing Coach",
            "Purged Healing Workspace");
        var asset = await UploadJpegAsync(coach);
        var stored = await Phase5B5ReadAssetAsync(asset.Id);
        var purgedKey = stored.StorageKey!;
        await Phase6B4CTombstoneAsync(coach, asset);
        RequiredTestClock.Advance(MediaRetentionPolicy.DeleteRetention.Add(TimeSpan.FromHours(1)));
        await Phase5B5SweepAsync();

        // The database says the bytes are gone and the store disagrees.
        RequiredProviderHarness.Bucket.Seed(purgedKey, [9, 9, 9], RequiredTestClock.UtcNow.AddDays(-2));
        await Phase6B4CReconcileAsync();
        var finding = (await Phase6B4CFindingsAsync()).Single();
        Assert.AreEqual(MediaInventoryFindingKind.PurgedObjectStillPresent, finding.Kind);

        // The deletion the purge asked for finally lands, by whatever route. Nothing in the database
        // changed, so only a complete enumeration can notice.
        Assert.IsTrue(RequiredProviderHarness.Bucket.Objects.TryRemove(purgedKey, out _));

        var complete = await Phase6B4CReconcileAsync();
        Assert.AreEqual(MediaInventoryRunState.Completed, complete.State);
        var resolved = (await Phase6B4CFindingsAsync()).Single();
        Assert.AreEqual(finding.Id, resolved.Id);
        Assert.IsTrue(resolved.IsResolved);
        Assert.AreEqual(MediaAssetStatus.Purged, (await Phase5B5ReadAssetAsync(asset.Id)).Status);
    }

    [TestMethod]
    public async Task Phase6B4COverProvidersASuccessfulStatNeverResolvesALengthOrDuplicateFinding()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(
            coach,
            "p6b4c-evidence@example.test",
            "Evidence Coach",
            "Evidence Workspace");
        var asset = await UploadJpegAsync(coach);
        var stored = await Phase5B5ReadAssetAsync(asset.Id);
        var key = stored.StorageKey!;
        // Two live rows on one key, and an object whose length disagrees with the row that records
        // it. The object exists throughout, so every stat of it succeeds.
        var duplicate = await Phase6B4CInsertDerivativeClaimingAsync(
            workspaceId,
            asset.Id,
            R2StorageOptions.LocationName,
            key);
        RequiredProviderHarness.Bucket.Seed(key, [1, 2, 3, 4, 5, 6, 7, 8, 9], RequiredTestClock.UtcNow);

        await Phase6B4CReconcileAsync();

        // Only the duplicate claim is reported: a key two live rows hold is never also compared for
        // length, because there is no single row whose recorded length it would be compared with.
        var findings = await Phase6B4CFindingsAsync();
        var reported = findings.Single();
        Assert.AreEqual(MediaInventoryFindingKind.DuplicateKeyOwnership, reported.Kind);
        Assert.AreEqual(MediaInventoryOwnerKind.None, reported.OwnerKind);
        Assert.IsGreaterThan(0, RequiredInventoryProbe.StatCalls, "The owner pass never probed the object.");

        // The owner pass stats that exact key and the store answers with the object — and the
        // duplicate claim is still a duplicate claim. Existence is not evidence about ownership.
        await Phase6B4CReconcileAsync();
        var afterSecondRun = (await Phase6B4CFindingsAsync()).Single();
        Assert.IsFalse(
            afterSecondRun.IsResolved,
            "A successful stat resolved a duplicate claim it says nothing about.");
        Assert.AreEqual(2, afterSecondRun.ConsecutiveObservations);
        Assert.IsTrue(afterSecondRun.IsActionable);

        // Removing the second claim is what actually ends it.
        await Phase6B4CDeleteDerivativeAsync(duplicate);
        var complete = await Phase6B4CReconcileAsync();
        Assert.AreEqual(MediaInventoryRunState.Completed, complete.State);
        var findingsAfter = await Phase6B4CFindingsAsync();
        Assert.IsTrue(findingsAfter.Single(item => item.Id == afterSecondRun.Id).IsResolved);

        // And the length disagreement is now visible, because there is one row to compare against.
        Assert.AreEqual(
            MediaInventoryFindingKind.ObjectLengthMismatch,
            findingsAfter.Single(item => !item.IsResolved).Kind);
    }

    [TestMethod]
    public async Task Phase6B4COverProvidersAMissingObjectFindingResolvesOnAStatAndOnAReleasedKeyDifferently()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(
            coach,
            "p6b4c-missing-heal@example.test",
            "Restoring Coach",
            "Restoring Workspace");
        var restored = await UploadJpegAsync(coach);
        var restoredKey = (await Phase5B5ReadAssetAsync(restored.Id)).StorageKey!;
        var released = await UploadJpegAsync(coach);
        var releasedKey = (await Phase5B5ReadAssetAsync(released.Id)).StorageKey!;
        var bucket = RequiredProviderHarness.Bucket;
        var restoredBytes = bucket[restoredKey];
        Assert.IsTrue(bucket.Objects.TryRemove(restoredKey, out _));
        Assert.IsTrue(bucket.Objects.TryRemove(releasedKey, out _));

        await Phase6B4CReconcileAsync();
        var opened = await Phase6B4CFindingsAsync();
        Assert.HasCount(2, opened);
        Assert.IsTrue(opened.All(item => item.Kind == MediaInventoryFindingKind.ObjectMissingForLiveOwner));

        // One object comes back. The other row stops being a live owner of its key at all, which is
        // an ordinary tombstone followed by the purge sweep doing its job.
        bucket.Seed(restoredKey, restoredBytes, RequiredTestClock.UtcNow);
        await Phase6B4CTombstoneAsync(coach, released);
        RequiredTestClock.Advance(MediaRetentionPolicy.DeleteRetention.Add(TimeSpan.FromHours(1)));
        await Phase5B5SweepAsync();

        var complete = await Phase6B4CReconcileAsync();
        Assert.AreEqual(MediaInventoryRunState.Completed, complete.State);
        var resolvedFindings = await Phase6B4CFindingsAsync();
        Assert.IsTrue(resolvedFindings.All(item => item.IsResolved));
        Assert.AreEqual(
            MediaInventoryResolutionCodes.ObserverConsistent,
            resolvedFindings.Single(item => item.StorageKey == restoredKey).ResolutionCode,
            "A finding closed by an actual successful stat is not recorded as one.");
        Assert.AreEqual(
            MediaInventoryResolutionCodes.OwnerNoLongerHoldsKey,
            resolvedFindings.Single(item => item.StorageKey == releasedKey).ResolutionCode,
            "A finding whose subject stopped existing was recorded as though the store had answered.");
    }

    [TestMethod]
    public async Task Phase6B4COverProvidersARereadPageAndRereadBatchBothLetTheRunFinish()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(
            coach,
            "p6b4c-recovery@example.test",
            "Recovering Coach",
            "Recovering Workspace");
        var asset = await UploadJpegAsync(coach);
        var stored = await Phase5B5ReadAssetAsync(asset.Id);
        var orphan = Phase6B4CSeedUnownedObject(workspaceId);

        // The listing blips once. The page keeps its cursor, so nothing was skipped.
        RequiredInventoryProbe.FailListCalls = 1;
        var afterListFailure = await Phase6B4CReconcileAsync();
        Assert.AreEqual(MediaInventoryRunState.Running, afterListFailure.State);
        var run = await Phase6B4CRunAsync();
        Assert.AreEqual(1, run.PageFailureCount);
        Assert.AreEqual(0, run.ObjectsScanned);
        Assert.IsEmpty(await Phase6B4CFindingsAsync());

        // Then a stat blips once, after the listing has been re-read successfully.
        RequiredInventoryProbe.FailStatCalls = 1;
        var afterStatFailure = await Phase6B4CReconcileAsync();
        Assert.AreEqual(MediaInventoryRunState.Running, afterStatFailure.State);
        run = await Phase6B4CRunAsync();
        Assert.IsTrue(run.InventoryCompleted, "The re-read page did not finish the enumeration.");
        Assert.AreEqual(1, run.PageFailureCount);
        Assert.AreEqual(2, run.TotalPageFailureCount);
        Assert.IsNull(run.CompletedAtUtc);
        // A stat that failed is never an absence: the row it was probing has no finding at all.
        Assert.IsEmpty(
            (await Phase6B4CFindingsAsync())
                .Where(item => item.Kind == MediaInventoryFindingKind.ObjectMissingForLiveOwner),
            "A provider failure was recorded as a missing object.");

        // The re-read of both finishes the run. It is the same run throughout, and it is entitled to
        // complete because every page it failed on was read afterwards.
        var completed = await Phase6B4CReconcileAsync();
        Assert.AreEqual(MediaInventoryRunState.Completed, completed.State);
        var runs = await Phase6B4CRunsAsync();
        Assert.HasCount(1, runs);
        Assert.AreEqual(0, runs[0].PageFailureCount);
        Assert.AreEqual(2, runs[0].TotalPageFailureCount, "A completed run forgot that it had failed twice.");
        Assert.IsNotNull(runs[0].CompletedAtUtc);
        Assert.AreEqual(orphan, (await Phase6B4CFindingsAsync()).Single().StorageKey);
        Assert.AreEqual(
            stored.Version,
            (await Phase5B5ReadAssetAsync(asset.Id)).Version,
            "A recovered run modified a media asset row.");
    }

    [TestMethod]
    public async Task Phase6B4COverProvidersAnUnfollowableOrIncompleteListingIsAFailureAndNeverACompletion()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(
            coach,
            "p6b4c-malformed@example.test",
            "Malformed Coach",
            "Malformed Workspace");
        var orphan = Phase6B4CSeedUnownedObject(workspaceId);

        // "There is more behind this page" with nothing to ask for it with. Reading that as the end
        // of the enumeration would mark the run complete having never seen the rest of the bucket.
        Phase6B4CServeListing(Phase6B4CTruncatedWithoutCursor());
        var unfollowable = await Phase6B4CReconcileAsync();
        Assert.AreEqual(MediaInventoryRunState.Running, unfollowable.State);
        Assert.AreEqual(1, unfollowable.PageFailures);
        var run = await Phase6B4CRunAsync();
        Assert.IsFalse(run.InventoryCompleted, "A page that could not be followed finished the enumeration.");
        Assert.IsNull(run.CompletedAtUtc);
        Assert.AreEqual(MediaInventoryFailureCodes.ListNoProgress, run.LastFailureCode);

        // An object listed without a length or a modification instant. Both fail open if invented:
        // a missing length is a mismatch against the row that owns it, and a missing instant is an
        // object old enough to be called an orphan nobody owns.
        Phase6B4CServeListing(Phase6B4CListingWithoutObjectMetadata(orphan));
        var incomplete = await Phase6B4CReconcileAsync();
        Assert.AreEqual(MediaInventoryRunState.Running, incomplete.State);
        Assert.AreEqual(
            MediaInventoryFailureCodes.ListMetadataMissing,
            (await Phase6B4CRunAsync()).LastFailureCode);
        Assert.IsEmpty(
            await Phase6B4CFindingsAsync(),
            "A finding was invented from metadata the store never sent.");

        // And the store comes back. Nothing was skipped, because neither failure moved the cursor.
        RequiredProviderHarness.Bucket.Fault = null;
        var completed = await Phase6B4CReconcileAsync();
        Assert.AreEqual(MediaInventoryRunState.Completed, completed.State);
        Assert.AreEqual(orphan, (await Phase6B4CFindingsAsync()).Single().StorageKey);
    }

    [TestMethod]
    public async Task Phase6B4COverProvidersASlowStoreStopsAtTheLeaseAndCommitsOnlyWhatItExamined()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(
            coach,
            "p6b4c-slow@example.test",
            "SlowStore Coach",
            "SlowStore Workspace");
        var first = await UploadJpegAsync(coach);
        var second = await UploadJpegAsync(coach);
        var third = await UploadJpegAsync(coach);

        // Each probe takes most of the minute this run is leased for. A worker that kept probing
        // would still be talking to the store after another replica was entitled to take the run,
        // and would then write findings and cursors for a run it no longer owned.
        RequiredInventoryProbe.AdvanceOnStat = TimeSpan.FromSeconds(25);

        var outcome = await Phase6B4CReconcileAsync();

        Assert.AreEqual(MediaInventoryRunState.Running, outcome.State);
        var run = await Phase6B4CRunAsync();
        Assert.IsTrue(run.InventoryCompleted);
        Assert.AreEqual(MediaInventoryProbeStage.Assets, run.ProbeStage);
        Assert.IsNotNull(run.ProbeCursorId, "A pass that stopped at its lease committed no progress at all.");
        Assert.IsNull(run.CompletedAtUtc, "A pass that could not probe every row called the location verified.");
        Assert.AreEqual(0, run.PageFailureCount, "Stopping inside the lease was recorded as a provider failure.");
        Assert.IsNull(run.LeaseToken, "The run was left leased by a worker that had stopped working.");
        Assert.IsLessThan(3, RequiredInventoryProbe.StatCalls, "The pass kept probing past its lease.");
        var probed = RequiredInventoryProbe.StatCalls;

        // The next pass resumes from the row the last one actually finished, so no row is examined
        // twice and none is stepped over.
        RequiredInventoryProbe.AdvanceOnStat = TimeSpan.Zero;
        var completed = await Phase6B4CReconcileAsync();
        Assert.AreEqual(MediaInventoryRunState.Completed, completed.State);
        var runs = await Phase6B4CRunsAsync();
        Assert.HasCount(1, runs);
        Assert.AreEqual(3, runs[0].OwnersProbed);
        Assert.AreEqual(
            3,
            RequiredInventoryProbe.StatCalls,
            $"The resumed pass re-probed rows the first one had already finished; {probed} were examined before the lease ran out.");
        Assert.HasCount(
            3,
            RequiredInventoryProbe.StattedKeys.Distinct(StringComparer.Ordinal).ToArray());
        Assert.IsEmpty(await Phase6B4CFindingsAsync(), "A slow pass invented a disagreement.");
        foreach (var asset in new[] { first, second, third })
        {
            Assert.AreEqual(MediaAssetStatus.Ready, (await Phase5B5ReadAssetAsync(asset.Id)).Status);
        }
    }

    [TestMethod]
    public async Task Phase6B4COverProvidersAStaleClaimantWritesNoFindingAndResolvesNone()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(
            coach,
            "p6b4c-stale@example.test",
            "Stale Coach",
            "Stale Workspace");
        var orphan = Phase6B4CSeedUnownedObject(workspaceId);

        // A run that exists and is unfinished, because the owner pass has not been given a budget.
        await Phase6B4CReconcileAsync(ownerProbeBudget: 0);
        var run = await Phase6B4CRunAsync();
        Assert.AreEqual(MediaInventoryRunState.Running, run.State);
        var openedByRun = (await Phase6B4CFindingsAsync()).Single();
        Assert.AreEqual(orphan, openedByRun.StorageKey);

        var mine = Guid.NewGuid();
        var theirs = Guid.NewGuid();
        await Phase6B4CHoldLeaseAsync(run.Id, mine, RequiredTestClock.UtcNow.AddMinutes(5));

        // An object no listing ever carried, so only these direct writes can file anything about it.
        var locator = new StorageObjectLocator(
            workspaceId,
            R2StorageOptions.LocationName,
            $"{workspaceId:N}/{Guid.CreateVersion7():N}");
        var pending = new[]
        {
            new MediaInventoryPendingFinding(
                MediaInventoryFindingKind.UnownedObject,
                locator,
                MediaInventoryOwnerKind.None,
                null),
        };

        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var store = scope.ServiceProvider.GetRequiredService<IMediaInventoryFindingStore>();
        var claim = new MediaInventoryRunClaim(run.Id, mine);
        var written = await store.ApplyAsync(
            claim,
            workspaceId,
            R2StorageOptions.LocationName,
            pending,
            TestContext.CancellationTokenSource.Token);
        Assert.IsTrue(written.Owned);
        Assert.AreEqual(1, written.Opened);
        Assert.HasCount(2, await Phase6B4CFindingsAsync());

        // Another replica takes the run over while this worker was still probing.
        await Phase6B4CHoldLeaseAsync(run.Id, theirs, RequiredTestClock.UtcNow.AddMinutes(5));

        var refused = await store.ApplyAsync(
            claim,
            workspaceId,
            R2StorageOptions.LocationName,
            pending,
            TestContext.CancellationTokenSource.Token);
        Assert.IsFalse(refused.Owned, "A stale claimant was allowed to write findings.");
        Assert.AreEqual(0, refused.Opened);

        var swept = await store.SweepUnobservedAsync(
            claim,
            R2StorageOptions.LocationName,
            TestContext.CancellationTokenSource.Token);
        Assert.IsFalse(swept.Owned, "A stale claimant was allowed to resolve findings.");
        Assert.AreEqual(0, swept.Resolved);

        // Nothing moved: no third finding, no extra observation on either, and no resolution.
        var findings = await Phase6B4CFindingsAsync();
        Assert.HasCount(2, findings);
        Assert.IsTrue(findings.All(item => !item.IsResolved));
        Assert.IsTrue(findings.All(item => item.ConsecutiveObservations == 1));
        Assert.AreEqual(orphan, findings.Single(item => item.Id == openedByRun.Id).StorageKey);
        Assert.AreEqual(locator.ObjectKey, findings.Single(item => item.Id != openedByRun.Id).StorageKey);

        // And the run row itself is exactly as the last owner left it.
        var after = await Phase6B4CRunAsync();
        Assert.AreEqual(run.InventoryCursor, after.InventoryCursor);
        Assert.AreEqual(run.ObjectsScanned, after.ObjectsScanned);
        Assert.AreEqual(run.FindingsResolved, after.FindingsResolved);
    }

    [TestMethod]
    public async Task Phase6B4COverProvidersTwoRowsNamingOneMissingObjectProduceOneFinding()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(
            coach,
            "p6b4c-shared-key@example.test",
            "Shared Key Coach",
            "Shared Key Workspace");
        var asset = await UploadJpegAsync(coach);
        var stored = await Phase5B5ReadAssetAsync(asset.Id);
        var key = stored.StorageKey!;
        var derivative = await Phase6B4CInsertDerivativeClaimingAsync(
            workspaceId,
            asset.Id,
            R2StorageOptions.LocationName,
            key);
        Assert.IsTrue(RequiredProviderHarness.Bucket.Objects.TryRemove(key, out _));
        var usageBefore = await Phase5B5MeasureAsync();

        var outcome = await Phase6B4CReconcileAsync();

        // One object, one disagreement — which is what the partial unique index over unresolved
        // findings says, and what queueing a second insert for the same key would have violated.
        Assert.AreEqual(MediaInventoryRunState.Completed, outcome.State);
        var finding = (await Phase6B4CFindingsAsync()).Single();
        Assert.AreEqual(MediaInventoryFindingKind.ObjectMissingForLiveOwner, finding.Kind);
        Assert.AreEqual(key, finding.StorageKey);
        // Both rows are probed and both are found missing, and the finding names the first claimant
        // of the fixed walk order rather than being filed twice.
        Assert.AreEqual(MediaInventoryOwnerKind.Asset, finding.OwnerKind);
        Assert.AreEqual(asset.Id, finding.OwnerId);
        Assert.AreEqual(1, finding.ConsecutiveObservations, "One run counted one object twice.");
        Assert.AreEqual(2, RequiredInventoryProbe.StattedKeys.Count(item => item == key));

        // Nothing was repaired: both rows still hold the key, and the allowance still counts them.
        var after = await Phase5B5ReadAssetAsync(asset.Id);
        Assert.AreEqual(MediaAssetStatus.Ready, after.Status);
        Assert.AreEqual(key, after.StorageKey);
        Assert.AreEqual(stored.Version, after.Version);
        var usageAfter = await Phase5B5MeasureAsync();
        Assert.AreEqual(usageBefore.TotalBytes, usageAfter.TotalBytes, "Reconciliation released an allowance.");
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        Assert.IsTrue(await context.MediaAssetDerivatives
            .IgnoreQueryFilters()
            .AnyAsync(
                item => item.Id == derivative && item.StorageKey == key,
                TestContext.CancellationTokenSource.Token));
    }

    private async Task Phase6B4CDeleteDerivativeAsync(Guid derivativeId)
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        await context.Database.ExecuteSqlAsync(
            $"""DELETE FROM media."AssetDerivatives" WHERE "Id" = {derivativeId}""");
    }
}
