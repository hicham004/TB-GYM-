using TB.Gym.Modules.Media;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// The rules reconciliation judges by, proved without a database, a store or a clock.
/// </summary>
/// <remarks>
/// The classifier is a pure function on purpose. Every case in the Phase 6B-4C decision table is a
/// statement about which facts produce which finding, and the moment those statements are only
/// expressible through a live bucket they stop being cheap to assert and start being sampled.
/// </remarks>
[TestClass]
public sealed class Phase6B4CMediaInventoryDomainTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 8, 12, 0, 0, TimeSpan.Zero);
    private static readonly Guid TenantId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private const string Location = "r2-eu-v1";

    [TestMethod]
    public void ClassifyingAStoredObjectCoversEveryDecidedCase()
    {
        // C3a: not an application object at all. Counted, never attributed, never deleted — a
        // finding is a tenant-owned row and there is no tenant here to own one.
        AssertObject(
            Observed(canonical: false),
            MediaInventoryObjectOutcome.Unattributable);
        AssertObject(
            Observed(tenantKnown: false),
            MediaInventoryObjectOutcome.Unattributable);

        // C3c: two live rows claiming one key. Purging either would delete the object the other
        // still serves, so it is reported and nothing is chosen between them.
        AssertObject(
            Observed(liveOwners: 2),
            MediaInventoryObjectOutcome.Finding,
            MediaInventoryFindingKind.DuplicateKeyOwnership);

        // C1b/C1c/C6a: another authority already owns the row. Observed and left alone.
        AssertObject(
            Observed(liveOwners: 1, state: MediaInventoryOwnerState.OwnedByPurge),
            MediaInventoryObjectOutcome.SkippedOwnedByPurge);
        AssertObject(
            Observed(liveOwners: 1, state: MediaInventoryOwnerState.ReservationInFlight),
            MediaInventoryObjectOutcome.SkippedOwnedByPurge);

        // C3b: the only integrity check a listing can make for free.
        AssertObject(
            Observed(liveOwners: 1, ownerLength: 8, objectLength: 9),
            MediaInventoryObjectOutcome.Finding,
            MediaInventoryFindingKind.ObjectLengthMismatch);
        AssertObject(
            Observed(liveOwners: 1, ownerLength: 8, objectLength: 8),
            MediaInventoryObjectOutcome.Consistent);
        // A reservation that has not confirmed its write records a bound rather than a measurement,
        // so there is nothing to compare and the object is simply consistent.
        AssertObject(
            Observed(liveOwners: 1, ownerLength: null, objectLength: 9),
            MediaInventoryObjectOutcome.Consistent);

        // C2a: the database says these bytes were deleted, and the store disagrees.
        AssertObject(
            Observed(liveOwners: 0, purgedOwner: true),
            MediaInventoryObjectOutcome.Finding,
            MediaInventoryFindingKind.PurgedObjectStillPresent);

        // C2c then C2b: age is what separates an upload that is committing from an orphan.
        AssertObject(
            Observed(liveOwners: 0, lastModified: Now.AddHours(-1)),
            MediaInventoryObjectOutcome.SkippedRecent);
        AssertObject(
            Observed(liveOwners: 0, lastModified: Now - MediaInventoryPolicy.UnownedObjectGrace),
            MediaInventoryObjectOutcome.Finding,
            MediaInventoryFindingKind.UnownedObject);
    }

    [TestMethod]
    public void OnlyARowThatIsSupposedToBeReadableCanBeReportedAsMissing()
    {
        Assert.AreEqual(
            MediaInventoryFindingKind.ObjectMissingForLiveOwner,
            MediaInventoryClassifier.ClassifyOwner(MediaInventoryOwnerState.Live, objectMissing: true));

        // A row the purge sweep owns is on its way to being deleted: a missing object is the outcome
        // that deletion wanted, not a disagreement.
        Assert.IsNull(MediaInventoryClassifier.ClassifyOwner(MediaInventoryOwnerState.OwnedByPurge, true));
        Assert.IsNull(MediaInventoryClassifier.ClassifyOwner(MediaInventoryOwnerState.ReservationInFlight, true));
        Assert.IsNull(MediaInventoryClassifier.ClassifyOwner(MediaInventoryOwnerState.Live, false));
    }

    [TestMethod]
    public void ACleanupIsOnlyStuckAfterEnoughFailedAttemptsOverEnoughTime()
    {
        var old = Now - MediaInventoryPolicy.StuckCleanupAge;
        Assert.IsTrue(MediaInventoryClassifier.IsCleanupStuck(
            MediaInventoryPolicy.StuckAttemptThreshold,
            old,
            Now));
        Assert.IsFalse(MediaInventoryClassifier.IsCleanupStuck(
            MediaInventoryPolicy.StuckAttemptThreshold - 1,
            old,
            Now));
        Assert.IsFalse(MediaInventoryClassifier.IsCleanupStuck(
            MediaInventoryPolicy.StuckAttemptThreshold,
            Now.AddHours(-1),
            Now));
        Assert.IsFalse(MediaInventoryClassifier.IsCleanupStuck(
            MediaInventoryPolicy.StuckAttemptThreshold,
            null,
            Now));
    }

    [TestMethod]
    public void ARunLeasesRenewsAndRefusesAStaleToken()
    {
        var lease = TimeSpan.FromMinutes(5);
        var first = Guid.NewGuid();
        var run = MediaInventoryRun.Start(Location, Now, lease, first);
        Assert.IsTrue(run.OwnsLease(first));
        Assert.IsFalse(run.IsClaimable(Now), "A live lease was offered to a second claimant.");

        // The lease expires and another replica takes it over. The cursors survive, because they
        // record how far the location was examined and starting again would re-walk it.
        var later = Now.Add(lease).AddSeconds(1);
        Assert.IsTrue(run.IsClaimable(later));
        var second = Guid.NewGuid();
        run.Claim(later, lease, second);

        Assert.IsFalse(
            run.RecordInventoryPage(later, first, lease, default, "cursor", true),
            "A stale claimant advanced the cursor of a run it no longer owns.");
        Assert.IsFalse(run.RecordPageFailure(later, first, "storage_provider_error"));
        Assert.IsFalse(run.Complete(later, first));
        Assert.IsTrue(run.RecordInventoryPage(later, second, lease, default, "cursor", true));
        Assert.AreEqual("cursor", run.InventoryCursor);
    }

    [TestMethod]
    public void AFailedPageLeavesTheCursorWhereItWas()
    {
        var lease = TimeSpan.FromMinutes(5);
        var token = Guid.NewGuid();
        var run = MediaInventoryRun.Start(Location, Now, lease, token);
        run.RecordInventoryPage(Now, token, lease, new MediaInventoryPageTally(3, 0, 0, 0, 1), "page-2", true);

        Assert.IsTrue(run.RecordPageFailure(Now, token, "storage_provider_unavailable"));

        // The page that failed is re-read rather than stepped over: objects it would have carried
        // have not been examined, and calling them verified is the one thing this must never do.
        Assert.AreEqual("page-2", run.InventoryCursor);
        Assert.AreEqual(3, run.ObjectsScanned);
        Assert.AreEqual(1, run.PageFailureCount);
        Assert.AreEqual("storage_provider_unavailable", run.LastFailureCode);
        Assert.IsFalse(run.HasExhaustedFailures);
    }

    [TestMethod]
    public void ARereadPageRecoversTheRunWhileRepeatedFailuresStillExhaustIt()
    {
        var lease = TimeSpan.FromMinutes(5);
        var token = Guid.NewGuid();
        var run = MediaInventoryRun.Start(Location, Now, lease, token);

        // One blip on a location that takes several passes to walk. The page kept its cursor, so
        // re-reading it means nothing was skipped and the run has as much right to finish as one
        // that never failed.
        run.RecordPageFailure(Now, token, "storage_provider_unavailable");
        run.RecordInventoryPage(Now, token, lease, new MediaInventoryPageTally(3, 0, 0, 0, 0), null, false);
        Assert.AreEqual(0, run.PageFailureCount);
        Assert.AreEqual(1, run.TotalPageFailureCount, "A recovered failure was forgotten entirely.");
        Assert.IsFalse(run.HasExhaustedFailures);

        run.RecordOwnerProbes(Now, token, lease, default, MediaInventoryProbeStage.Completed, null);
        Assert.IsTrue(
            run.HasExaminedEverything,
            "A run that re-read every failed page was not entitled to resolve.");
        run.RecordResolvedFindings(Now, token, 2);
        run.CompleteResolution(Now, token);
        Assert.IsTrue(run.CanComplete, "A run that re-read every failed page could not complete.");
        Assert.IsTrue(run.Complete(Now, token));
        Assert.AreEqual(MediaInventoryRunState.Completed, run.State);
        Assert.AreEqual(2, run.FindingsResolved);
        Assert.AreEqual(1, run.TotalPageFailureCount);

        // A store that keeps refusing still fails the run: the budget counts failures the run never
        // recovered from, and three in a row is three pages it never read.
        var second = MediaInventoryRun.Start(Location, Now, lease, token);
        for (var attempt = 0; attempt < MediaInventoryPolicy.MaximumPageFailures; attempt++)
        {
            second.RecordPageFailure(Now, token, "storage_provider_unavailable");
        }

        Assert.IsTrue(second.HasExhaustedFailures);
        Assert.AreEqual(MediaInventoryPolicy.MaximumPageFailures, second.TotalPageFailureCount);
        Assert.IsFalse(second.CanComplete);
    }

    [TestMethod]
    public void OnlyARunThatFinishedBothPassesWithoutFailureCanBeCompleted()
    {
        var lease = TimeSpan.FromMinutes(5);
        var token = Guid.NewGuid();
        var run = MediaInventoryRun.Start(Location, Now, lease, token);

        // Inventory still has a page to read.
        run.RecordInventoryPage(Now, token, lease, default, "page-2", true);
        Assert.IsFalse(run.CanComplete);
        Assert.ThrowsExactly<InvalidOperationException>(() => run.Complete(Now, token));

        // Inventory finished, but the owner pass has not.
        run.RecordInventoryPage(Now, token, lease, default, null, false);
        Assert.IsFalse(run.CanComplete);
        run.RecordOwnerProbes(Now, token, lease, default, MediaInventoryProbeStage.Completed, null);

        // Both passes are done, so the run may now close findings — and until it has finished doing
        // so it is still not complete. A run that stopped with findings it proved gone still
        // standing would present a stale report as a current one.
        Assert.IsTrue(run.HasExaminedEverything);
        Assert.IsFalse(run.CanComplete, "A run completed before it had closed what it examined away.");
        Assert.ThrowsExactly<InvalidOperationException>(() => run.Complete(Now, token));
        run.CompleteResolution(Now, token);
        Assert.IsTrue(run.CanComplete);

        // A single failed page disqualifies the whole run, however well the rest of it went:
        // "it found nothing" from a pass that could not read everything is not the same statement.
        run.RecordPageFailure(Now, token, "storage_provider_error");
        Assert.IsFalse(run.CanComplete);
        Assert.IsFalse(run.HasExaminedEverything);
        Assert.ThrowsExactly<InvalidOperationException>(() => run.Complete(Now, token));

        Assert.IsTrue(run.Fail(Now, token));
        Assert.AreEqual(MediaInventoryRunState.Failed, run.State);
        Assert.IsNull(run.CompletedAtUtc);
        Assert.IsNull(run.LeaseToken);
    }

    [TestMethod]
    public void APassThatRunsOutOfBudgetHandsTheRunBackWithItsCursorsIntact()
    {
        var lease = TimeSpan.FromMinutes(5);
        var token = Guid.NewGuid();
        var run = MediaInventoryRun.Start(Location, Now, lease, token);
        run.RecordInventoryPage(Now, token, lease, new MediaInventoryPageTally(3, 0, 0, 0, 1), "page-2", true);

        Assert.IsTrue(run.ReleaseClaim(Now, token));

        // Still Running, still resumable, and the next pass can take it at once rather than waiting
        // out a lease nobody is using — which is what would otherwise make the lease duration decide
        // how fast a large location gets walked.
        Assert.AreEqual(MediaInventoryRunState.Running, run.State);
        Assert.IsTrue(run.IsClaimable(Now));
        Assert.AreEqual("page-2", run.InventoryCursor);
        Assert.AreEqual(3, run.ObjectsScanned);
        Assert.IsNull(run.CompletedAtUtc);
        Assert.IsFalse(run.ReleaseClaim(Now, token), "A released run was released again by a token that no longer owns it.");
    }

    [TestMethod]
    public void AStaleRunIsAbandonedRatherThanResumed()
    {
        var token = Guid.NewGuid();
        var run = MediaInventoryRun.Start(Location, Now, TimeSpan.FromMinutes(5), token);
        var later = Now + MediaInventoryPolicy.MaximumRunAge;

        Assert.IsTrue(run.IsStale(later));
        run.Abandon(later);

        Assert.AreEqual(MediaInventoryRunState.Abandoned, run.State);
        Assert.IsNull(run.CompletedAtUtc);
        Assert.IsNull(run.LeaseToken);
        Assert.IsFalse(run.IsClaimable(later), "An abandoned run was offered to a claimant.");
        Assert.IsFalse(run.IsStale(later));
    }

    [TestMethod]
    public void AFindingIsObservedRatherThanReopenedAndResolutionIsOneWay()
    {
        var runId = Guid.CreateVersion7();
        var finding = MediaInventoryFinding.Open(
            TenantId,
            MediaInventoryFindingKind.UnownedObject,
            Locator(),
            MediaInventoryOwnerKind.None,
            null,
            runId,
            Now);
        Assert.AreEqual(1, finding.ConsecutiveObservations);
        Assert.IsFalse(finding.IsActionable, "One observation was treated as an established condition.");

        var secondRun = Guid.CreateVersion7();
        finding.Observe(Now.AddDays(1), secondRun);
        Assert.AreEqual(2, finding.ConsecutiveObservations);
        Assert.AreEqual(Now, finding.FirstObservedAtUtc);
        Assert.AreEqual(Now.AddDays(1), finding.LastObservedAtUtc);
        Assert.AreEqual(runId, finding.FirstRunId);
        Assert.AreEqual(secondRun, finding.LastRunId);
        Assert.IsTrue(finding.IsActionable);

        finding.Resolve(Now.AddDays(2), MediaInventoryResolutionCodes.ObserverConsistent);
        Assert.IsTrue(finding.IsResolved);
        Assert.IsFalse(finding.IsActionable);

        // A resolved finding is history. A condition that comes back is a new finding, so the record
        // of what was once wrong here is never rewritten.
        Assert.ThrowsExactly<InvalidOperationException>(
            () => finding.Observe(Now.AddDays(3), Guid.CreateVersion7()));
        finding.Resolve(Now.AddDays(3), "something_else");
        Assert.AreEqual(Now.AddDays(2), finding.ResolvedAtUtc);
        Assert.AreEqual(MediaInventoryResolutionCodes.ObserverConsistent, finding.ResolutionCode);
    }

    [TestMethod]
    public void AFindingCannotDescribeAnotherTenantsObjectOrHalfAnOwner()
    {
        var otherTenant = Guid.Parse("22222222-2222-2222-2222-222222222222");
        Assert.ThrowsExactly<ArgumentException>(() => MediaInventoryFinding.Open(
            otherTenant,
            MediaInventoryFindingKind.UnownedObject,
            Locator(),
            MediaInventoryOwnerKind.None,
            null,
            Guid.CreateVersion7(),
            Now));

        // An owner kind and an owner id travel together or not at all: half of a reference names a
        // row nobody can look up.
        Assert.ThrowsExactly<ArgumentException>(() => MediaInventoryFinding.Open(
            TenantId,
            MediaInventoryFindingKind.ObjectMissingForLiveOwner,
            Locator(),
            MediaInventoryOwnerKind.Asset,
            null,
            Guid.CreateVersion7(),
            Now));
        Assert.ThrowsExactly<ArgumentException>(() => MediaInventoryFinding.Open(
            TenantId,
            MediaInventoryFindingKind.UnownedObject,
            Locator(),
            MediaInventoryOwnerKind.None,
            Guid.CreateVersion7(),
            Guid.CreateVersion7(),
            Now));
    }

    [TestMethod]
    public void ResolutionAccruesAcrossBatchesAndOnlyAFinishedOneCompletesTheRun()
    {
        var lease = TimeSpan.FromMinutes(5);
        var token = Guid.NewGuid();
        var run = MediaInventoryRun.Start(Location, Now, lease, token);

        // Nothing may be closed before the location has been examined in full: a subset that did not
        // contain a condition is evidence that the pass stopped, not that the condition is gone.
        Assert.ThrowsExactly<InvalidOperationException>(() => run.RecordResolvedFindings(Now, token, 1));
        Assert.ThrowsExactly<InvalidOperationException>(() => run.CompleteResolution(Now, token));

        run.RecordInventoryPage(Now, token, lease, default, null, false);
        run.RecordOwnerProbes(Now, token, lease, default, MediaInventoryProbeStage.Completed, null);

        // Two bounded batches, and the total is the sum of them rather than of the last one.
        Assert.IsTrue(run.RecordResolvedFindings(Now, token, MediaInventoryPolicy.ResolutionBatchSize));
        Assert.IsTrue(run.RecordResolvedFindings(Now.AddMinutes(1), token, 7));
        Assert.AreEqual(MediaInventoryPolicy.ResolutionBatchSize + 7, run.FindingsResolved);

        // A batch that closed fewer rows than it asked for is the same evidence as a short page: it
        // says nothing about what is left, so the run is still unfinished until something looked.
        Assert.IsFalse(run.ResolutionCompleted);
        Assert.IsFalse(run.CanComplete);
        Assert.IsTrue(run.HasExaminedEverything, "A resolving run stopped being entitled to resolve.");

        // Handing the run back mid-resolution keeps every closed batch and every count of one.
        Assert.IsTrue(run.ReleaseClaim(Now.AddMinutes(2), token));
        Assert.AreEqual(MediaInventoryRunState.Running, run.State);
        Assert.AreEqual(MediaInventoryPolicy.ResolutionBatchSize + 7, run.FindingsResolved);
        Assert.IsTrue(run.IsClaimable(Now.AddMinutes(2)));

        // A later claimant resumes it, finds nothing left, and only then may complete it. The stale
        // token can do neither.
        var resumed = Guid.NewGuid();
        run.Claim(Now.AddMinutes(3), lease, resumed);
        Assert.IsFalse(run.RecordResolvedFindings(Now.AddMinutes(3), token, 1), "A stale claimant closed a finding.");
        Assert.IsFalse(run.CompleteResolution(Now.AddMinutes(3), token), "A stale claimant finished resolution.");
        Assert.IsTrue(run.RecordResolvedFindings(Now.AddMinutes(3), resumed, 3));
        Assert.IsTrue(run.CompleteResolution(Now.AddMinutes(3), resumed));
        Assert.IsTrue(run.Complete(Now.AddMinutes(3), resumed));
        Assert.AreEqual(MediaInventoryPolicy.ResolutionBatchSize + 10, run.FindingsResolved);
        Assert.AreEqual(MediaInventoryRunState.Completed, run.State);
    }

    [TestMethod]
    public void OneRunCountsOneObservationHoweverOftenItReplaysThePage()
    {
        var runId = Guid.CreateVersion7();
        var finding = MediaInventoryFinding.Open(
            TenantId,
            MediaInventoryFindingKind.UnownedObject,
            Locator(),
            MediaInventoryOwnerKind.None,
            null,
            runId,
            Now);

        // A crash between writing a page's findings and committing its cursor re-reads exactly that
        // page; a batch whose stat failed is re-examined from the same cursor. Counting those visits
        // would make one logical observation look like an established condition.
        finding.Observe(Now.AddMinutes(5), runId);
        finding.Observe(Now.AddMinutes(9), runId);
        Assert.AreEqual(1, finding.ConsecutiveObservations);
        Assert.IsFalse(finding.IsActionable, "One run made a single observation look actionable.");
        Assert.AreEqual(Now.AddMinutes(9), finding.LastObservedAtUtc);
        Assert.IsTrue(finding.WasObservedBy(runId));

        // The next run is a second look, and two looks are what makes a condition standing.
        var later = Guid.CreateVersion7();
        finding.Observe(Now.AddDays(1), later);
        Assert.AreEqual(2, finding.ConsecutiveObservations);
        Assert.IsTrue(finding.IsActionable);
        Assert.IsFalse(finding.WasObservedBy(runId));
    }

    [TestMethod]
    public void TwoRowsNamingOneMissingObjectBecomeOneFindingThatNamesNeither()
    {
        var locator = Locator();
        var asset = Guid.CreateVersion7();
        var derivative = Guid.CreateVersion7();
        var other = new StorageObjectLocator(TenantId, Location, $"{TenantId:N}/{Guid.CreateVersion7():N}");

        var collapsed = MediaInventoryFindingSet.Collapse(
        [
            new MediaInventoryPendingFinding(
                MediaInventoryFindingKind.ObjectMissingForLiveOwner,
                locator,
                MediaInventoryOwnerKind.Asset,
                asset),
            new MediaInventoryPendingFinding(
                MediaInventoryFindingKind.ObjectMissingForLiveOwner,
                locator,
                MediaInventoryOwnerKind.Derivative,
                derivative),
            new MediaInventoryPendingFinding(
                MediaInventoryFindingKind.CleanupStuck,
                locator,
                MediaInventoryOwnerKind.IngestObject,
                derivative),
            new MediaInventoryPendingFinding(
                MediaInventoryFindingKind.ObjectMissingForLiveOwner,
                other,
                MediaInventoryOwnerKind.Asset,
                asset),
        ]);

        // One disagreement about one object, however many rows name it — which is exactly what the
        // partial unique index over unresolved findings says, so queueing both would lose the whole
        // page's findings to a constraint violation.
        Assert.HasCount(3, collapsed);
        var missing = collapsed.Single(item =>
            item.Kind == MediaInventoryFindingKind.ObjectMissingForLiveOwner &&
            item.Locator.ObjectKey == locator.ObjectKey);
        Assert.AreEqual(MediaInventoryOwnerKind.None, missing.OwnerKind);
        Assert.IsNull(missing.OwnerId, "The finding attributed a shared object to whichever row was read first.");

        // A different kind about the same object, and the same kind about a different object, are
        // both separate findings and keep the owner they were observed with.
        Assert.AreEqual(
            MediaInventoryOwnerKind.IngestObject,
            collapsed.Single(item => item.Kind == MediaInventoryFindingKind.CleanupStuck).OwnerKind);
        Assert.AreEqual(
            asset,
            collapsed.Single(item => item.Locator.ObjectKey == other.ObjectKey).OwnerId);

        // The order observations arrived in is the order they are written in, so a replay of the
        // same page produces the same rows rather than a different arrangement of them.
        Assert.AreEqual(locator.ObjectKey, collapsed[0].Locator.ObjectKey);
        Assert.AreEqual(MediaInventoryFindingKind.CleanupStuck, collapsed[1].Kind);
        Assert.AreEqual(other.ObjectKey, collapsed[2].Locator.ObjectKey);
    }

    [TestMethod]
    public void AnotherAuthorityOwnsARowWhileItHoldsAClaimOrItsRetentionHasElapsed()
    {
        var claim = Guid.NewGuid();
        Assert.AreEqual(
            MediaInventoryOwnerState.Live,
            MediaInventoryClassifier.ClassifyOwnerState(MediaAssetStatus.Ready, null, null, null, Now));

        // A live purge claim, whatever the status says.
        Assert.AreEqual(
            MediaInventoryOwnerState.OwnedByPurge,
            MediaInventoryClassifier.ClassifyOwnerState(
                MediaAssetStatus.Tombstoned,
                Now.AddDays(10),
                claim,
                Now.AddMinutes(1),
                Now));

        // An expired claim is nobody's, so the row is decided by its retention alone.
        Assert.AreEqual(
            MediaInventoryOwnerState.Live,
            MediaInventoryClassifier.ClassifyOwnerState(
                MediaAssetStatus.Tombstoned,
                Now.AddDays(10),
                claim,
                Now.AddMinutes(-1),
                Now));
        Assert.AreEqual(
            MediaInventoryOwnerState.OwnedByPurge,
            MediaInventoryClassifier.ClassifyOwnerState(
                MediaAssetStatus.Tombstoned,
                Now,
                null,
                null,
                Now));

        // A tombstone history references keeps no due date, so nothing is coming to delete it and it
        // is still supposed to be readable.
        Assert.AreEqual(
            MediaInventoryOwnerState.Live,
            MediaInventoryClassifier.ClassifyOwnerState(MediaAssetStatus.Tombstoned, null, null, null, Now));
    }

    private static StorageObjectLocator Locator() =>
        new(TenantId, Location, $"{TenantId:N}/{Guid.CreateVersion7():N}");

    private static ObservedObject Observed(
        bool canonical = true,
        bool tenantKnown = true,
        int liveOwners = 1,
        MediaInventoryOwnerState state = MediaInventoryOwnerState.Live,
        long? ownerLength = 8,
        bool purgedOwner = false,
        long objectLength = 8,
        DateTimeOffset? lastModified = null) =>
        new(
            canonical,
            tenantKnown,
            liveOwners,
            liveOwners == 1 ? state : null,
            liveOwners == 1 ? ownerLength : null,
            purgedOwner,
            objectLength,
            lastModified ?? Now.AddDays(-2),
            Now);

    private static void AssertObject(
        ObservedObject observed,
        MediaInventoryObjectOutcome expected,
        MediaInventoryFindingKind? finding = null)
    {
        var verdict = MediaInventoryClassifier.ClassifyObject(observed);
        Assert.AreEqual(expected, verdict.Outcome);
        Assert.AreEqual(finding, verdict.Finding);
    }
}
