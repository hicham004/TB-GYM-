using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Media;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The read-only guarantee of Phase 6B-4C, proved against PostgreSQL rather than argued from the
/// code.
/// </summary>
/// <remarks>
/// <para>
/// The architecture test proves reconciliation is never <em>handed</em> anything that can write a
/// media row: no storage port, no database context, no container, and no mutable aggregate returned
/// from any of its ports. That is a statement about one constructor. These tests are the statement
/// about the whole subsystem, including the two adapters that do hold a context because writing a
/// run row and a finding is their job.
/// </para>
/// <para>
/// The instrument is PostgreSQL's own <c>xmin</c>: the transaction that last wrote each row. An
/// <c>UPDATE</c> changes it, a <c>DELETE</c> removes the row and an <c>INSERT</c> adds one, so a
/// snapshot of every media row's id and <c>xmin</c> taken before and after a run is a complete
/// answer to "did anything touch these tables". It cannot be satisfied by a repair that happens to
/// restore the same values, which is the loophole in comparing columns by hand.
/// </para>
/// <para>
/// Each test deliberately runs reconciliation through work rather than through an empty location:
/// findings are opened, re-observed and then closed, so the write paths that exist really do
/// execute. A pass that did nothing at all would satisfy an unchanged snapshot trivially and prove
/// nothing.
/// </para>
/// </remarks>
public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task Phase6B4COverProvidersReconciliationOpensAndClosesFindingsWithoutWritingOneMediaRow()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(
            coach,
            "p6b4c-readonly@example.test",
            "Read Only Coach",
            "Read Only Workspace");

        // Three of the seven kinds at once, across both passes: an object nobody owns, a live owner
        // whose bytes are gone, and a row whose object is the wrong length. Between them they drive
        // the inventory pass, the owner pass and the finding writer.
        var intact = await UploadJpegAsync(coach);
        var emptied = await UploadJpegAsync(coach);
        var resized = await UploadJpegAsync(coach);
        var intactKey = (await Phase5B5ReadAssetAsync(intact.Id)).StorageKey!;
        var emptiedStored = await Phase5B5ReadAssetAsync(emptied.Id);
        var resizedStored = await Phase5B5ReadAssetAsync(resized.Id);

        var harness = RequiredProviderHarness;
        var orphanKey = Phase6B4CSeedUnownedObject(workspaceId);
        Assert.IsTrue(harness.Bucket.Objects.TryRemove(emptiedStored.StorageKey!, out var emptiedObject));
        var resizedObject = harness.Bucket.Objects[resizedStored.StorageKey!];
        harness.Bucket.Seed(
            resizedStored.StorageKey!,
            [.. resizedObject.Content, 0xFF],
            resizedObject.LastModifiedUtc);

        var before = await Phase6B4CMediaRowVersionsAsync();
        Assert.IsNotEmpty(before, "The proof needs media rows to be unchanged; there are none.");

        var opening = await Phase6B4CReconcileAsync();

        Assert.AreEqual(MediaInventoryRunState.Completed, opening.State);
        Assert.IsGreaterThan(0, opening.FindingsOpened, "No finding was opened, so nothing was proved about the writer.");
        var opened = await Phase6B4CFindingsAsync();
        CollectionAssert.AreEquivalent(
            new[]
            {
                MediaInventoryFindingKind.ObjectMissingForLiveOwner,
                MediaInventoryFindingKind.ObjectLengthMismatch,
                MediaInventoryFindingKind.UnownedObject,
            },
            opened.Select(finding => finding.Kind).Distinct().ToArray());

        // Now put the world back the way the database always said it was, and let a completed run
        // close what it no longer observes. Resolution is the last write path in the subsystem, and
        // it is the one whose first implementation reached across findings it had no evidence about.
        harness.Bucket.Objects[emptiedStored.StorageKey!] = emptiedObject!;
        harness.Bucket.Seed(resizedStored.StorageKey!, resizedObject.Content, resizedObject.LastModifiedUtc);
        Assert.IsTrue(harness.Bucket.Objects.TryRemove(orphanKey, out _));

        var closing = await Phase6B4CReconcileAsync();

        Assert.AreEqual(MediaInventoryRunState.Completed, closing.State);
        Assert.IsGreaterThan(0, closing.FindingsResolved, "No finding was resolved, so nothing was proved about the resolver.");
        var resolved = await Phase6B4CFindingsAsync();
        Assert.IsTrue(
            resolved.All(finding => finding.ResolvedAtUtc is not null),
            "A condition that is demonstrably gone is still open.");

        // The whole point. Every media row is byte-identical in the only sense that cannot be faked:
        // the same rows, written by the same transactions as before either run.
        var after = await Phase6B4CMediaRowVersionsAsync();
        CollectionAssert.AreEqual(
            before.ToArray(),
            after.ToArray(),
            "Reconciliation wrote to a media row. It has no authority to repair, tombstone, purge or delete anything.");

        // And the objects it merely had opinions about are all still in the bucket.
        Assert.IsTrue(harness.Bucket.Objects.ContainsKey(intactKey));
        Assert.IsTrue(harness.Bucket.Objects.ContainsKey(emptiedStored.StorageKey!));
        Assert.IsTrue(harness.Bucket.Objects.ContainsKey(resizedStored.StorageKey!));
    }

    [TestMethod]
    public async Task Phase6B4COverProvidersReconciliationWritesNoMediaRowWhenEveryPageFails()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(
            coach,
            "p6b4c-readonly-failure@example.test",
            "Failing Store Coach",
            "Failing Store Workspace");
        await UploadJpegAsync(coach);

        var before = await Phase6B4CMediaRowVersionsAsync();
        Assert.IsNotEmpty(before);

        // A store that will not answer is the other half of the guarantee. An enumeration that
        // failed has reported nothing at all, and "nothing" must never become a licence to tidy up
        // the rows it could not confirm.
        RequiredInventoryProbe.FailListCalls = 1;
        var outcome = await Phase6B4CReconcileAsync();

        Assert.AreNotEqual(MediaInventoryRunState.Completed, outcome.State);
        Assert.AreEqual(1, outcome.PageFailures);
        Assert.IsEmpty(await Phase6B4CFindingsAsync(), "A failed enumeration produced a finding about a row it never read.");
        CollectionAssert.AreEqual(
            before.ToArray(),
            (await Phase6B4CMediaRowVersionsAsync()).ToArray(),
            "Reconciliation wrote to a media row while the store was unavailable.");
    }

    /// <summary>
    /// Every media row's identity and the transaction that last wrote it, ordered so two snapshots
    /// compare directly.
    /// </summary>
    /// <remarks>
    /// <c>xmin</c> is a system column PostgreSQL maintains itself, so this cannot be defeated by a
    /// write that restores the previous values: an update writes a new row version whatever it puts
    /// in the columns. Reading all three tables together means a row that was deleted, inserted or
    /// moved between them shows up as a difference in the sequence rather than being missed.
    /// </remarks>
    private async Task<IReadOnlyList<string>> Phase6B4CMediaRowVersionsAsync()
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        return await context.Database
            .SqlQuery<string>($"""
                SELECT 'asset:' || "Id"::text || ':' || xmin::text AS "Value" FROM media."Assets"
                UNION ALL
                SELECT 'derivative:' || "Id"::text || ':' || xmin::text FROM media."AssetDerivatives"
                UNION ALL
                SELECT 'ingest:' || "Id"::text || ':' || xmin::text FROM media."IngestObjects"
                ORDER BY 1
                """)
            .ToListAsync(TestContext.CancellationTokenSource.Token);
    }
}
