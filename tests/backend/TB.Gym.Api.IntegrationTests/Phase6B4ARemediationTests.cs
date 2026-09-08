using System.Net;
using System.Net.Http.Headers;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Media;

namespace TB.Gym.Api.IntegrationTests;

public sealed partial class Phase3TrainingWorkflowTests
{
    /// <summary>
    /// The remediation's core claim: a lease bounds the item it guards, not the batch it arrived
    /// in. Deliberately not asserted here is exclusivity *after* expiry — ADR 0023 makes an expired
    /// claim reclaimable on purpose, and that is what recovers a crashed worker's work.
    /// </summary>
    [TestMethod]
    public async Task Phase6B4ARemediationEachPurgedItemIsLeasedOnlyWhenItsOwnWorkBegins()
    {
        var first = await Phase6B4ACreateDuePhotoAsync("lease-a", "Front");
        var second = await Phase6B4ACreateDuePhotoAsync("lease-b", "Side");
        var third = await Phase6B4ACreateDuePhotoAsync("lease-c", "Back");
        Guid[] assetIds = [first.Photo.MediaAssetId, second.Photo.MediaAssetId, third.Photo.MediaAssetId];
        Guid[] tenantIds = [first.WorkspaceId, second.WorkspaceId, third.WorkspaceId];
        CollectionAssert.AllItemsAreUnique(tenantIds, "The three items must span three workspaces.");

        var lease = TimeSpan.FromSeconds(RequiredFactory.Services
            .GetRequiredService<IOptions<MediaStorageOptions>>()
            .Value.PurgeClaimLeaseSeconds);
        var observations = new List<Phase6B4ALeaseObservation>();
        var started = new HashSet<Guid>();

        RequiredStorageFaults.OnDeleteStarting = async _ =>
        {
            // Reading these rows from a separate scope while a delete is in flight only returns at
            // all because the claim transaction has already committed. If the sweep still held it
            // open, this would block on the row locks until the test timed out.
            var rows = await Phase6B4AReadPurgeStateAsync(assetIds);
            var inFlight = rows.Where(row => row.ClaimToken is not null).ToArray();
            Assert.HasCount(1, inFlight, "Exactly one item may hold a claim at a time.");

            var current = inFlight[0];
            if (!started.Add(current.AssetId))
            {
                // A later object of an item already being processed under the same claim.
                return;
            }

            observations.Add(new Phase6B4ALeaseObservation(
                current.AssetId,
                RequiredTestClock.UtcNow,
                current.ClaimExpiresAtUtc!.Value,
                rows.Where(row =>
                        row.AssetId != current.AssetId &&
                        row.Status != MediaAssetStatus.Purged)
                    .All(row => row.ClaimToken is null && row.AttemptCount == 0)));

            // Age the world past a whole lease while this item is mid-delete. Under a batched
            // claim every remaining item's lease was already ticking and would now have expired
            // before its work had started; under a per-item claim nothing else is leased yet.
            RequiredTestClock.Advance(lease + TimeSpan.FromSeconds(30));
        };

        try
        {
            var swept = await Phase5B5SweepAsync();
            Assert.AreEqual(3, swept.Claimed);
            Assert.AreEqual(3, swept.Purged);
            Assert.AreEqual(0, swept.Failed);
        }
        finally
        {
            RequiredStorageFaults.OnDeleteStarting = null;
        }

        CollectionAssert.AreEquivalent(
            assetIds,
            observations.Select(item => item.AssetId).ToArray(),
            "Every item must have been processed under its own claim.");

        foreach (var observation in observations)
        {
            // A fresh lease: dated from the clock as it stood when this item's work began, not from
            // the instant the sweep started, so its whole interval is still ahead of it.
            Assert.IsGreaterThan(
                observation.ObservedAtUtc,
                observation.ClaimExpiresAtUtc,
                $"Asset {observation.AssetId} began its deletion under an already-expired lease.");
            Assert.IsGreaterThan(
                lease - TimeSpan.FromSeconds(1),
                observation.ClaimExpiresAtUtc - observation.ObservedAtUtc,
                $"Asset {observation.AssetId} started work on a lease that had already been running.");
            Assert.IsTrue(
                observation.OthersUnclaimed,
                "Work that had not started yet was already sitting under an aging lease.");
        }

        foreach (var assetId in assetIds)
        {
            var purged = await Phase5B5ReadAssetAsync(assetId);
            Assert.AreEqual(MediaAssetStatus.Purged, purged.Status);
            Assert.IsNull(purged.PurgeClaimToken);
            Assert.AreEqual(1, purged.PurgeAttemptCount, "An item was claimed more than once.");
        }
    }

    /// <summary>
    /// A live claim is still exclusive for its own interval, and a workspace the sweep has not
    /// reached yet carries no lease at all.
    /// </summary>
    [TestMethod]
    public async Task Phase6B4ARemediationLiveClaimIsExclusiveAndUnreachedWorkIsUnleased()
    {
        var first = await Phase6B4ACreateDuePhotoAsync("exclusive-a", "Front");
        var second = await Phase6B4ACreateDuePhotoAsync("exclusive-b", "Side");
        Assert.AreNotEqual(first.WorkspaceId, second.WorkspaceId);
        RequiredStorageFaults.ArmDeleteBarrier();

        var sweep = Phase5B5SweepAsync();
        try
        {
            var deleting = await RequiredStorageFaults.WaitForDeleteAsync(
                TestContext.CancellationTokenSource.Token);

            // Which workspace the sweep visits first is decided by tenant id ordering, so the
            // in-flight item is identified from the locator rather than assumed.
            var inFlightId = deleting.TenantId == first.WorkspaceId
                ? first.Photo.MediaAssetId
                : second.Photo.MediaAssetId;
            var unreachedId = deleting.TenantId == first.WorkspaceId
                ? second.Photo.MediaAssetId
                : first.Photo.MediaAssetId;

            var inFlight = await Phase5B5ReadAssetAsync(inFlightId);
            Assert.IsNotNull(inFlight.PurgeClaimToken);
            Assert.IsFalse(
                inFlight.IsPurgeClaimable(RequiredTestClock.UtcNow),
                "A competing worker could reclaim an item whose lease is still live.");

            // The claim predicate a competing replica would actually run. It must step over the
            // in-flight item, and it must still see the workspace this sweep has not reached —
            // which is only true because unstarted work carries no lease of its own.
            Assert.AreEqual(0, await Phase6B4ACountClaimableAsync(inFlightId));
            Assert.AreEqual(1, await Phase6B4ACountClaimableAsync(unreachedId));

            var unreached = await Phase5B5ReadAssetAsync(unreachedId);
            Assert.IsNull(unreached.PurgeClaimToken);
            Assert.AreEqual(0, unreached.PurgeAttemptCount);
        }
        finally
        {
            RequiredStorageFaults.ReleaseDeleteBarrier();
        }

        var outcome = await sweep;
        Assert.AreEqual(2, outcome.Claimed);
        Assert.AreEqual(2, outcome.Purged);
    }

    /// <summary>
    /// Claiming per item must not turn a failure into a hot retry loop. A failed item is due again
    /// for the *next* sweep; offering it back immediately would let one stuck object spend the
    /// whole batch budget and starve the rest of the workspace for a full interval.
    /// </summary>
    [TestMethod]
    public async Task Phase6B4ARemediationAFailedItemIsNotReofferedWithinTheSameSweep()
    {
        var (_, photo) = await Phase6B4ACreateDuePhotoAsync("no-hot-retry", "Front");
        var peer = await Phase6B4ACreateDuePhotoAsync("no-hot-retry-peer", "Side");
        RequiredStorageFaults.FailDeletes = true;

        var swept = await Phase5B5SweepAsync();

        Assert.AreEqual(2, swept.Claimed, "A failed item was re-offered inside its own sweep.");
        Assert.AreEqual(2, swept.Failed);
        Assert.AreEqual(0, swept.Purged);
        foreach (var assetId in new[] { photo.MediaAssetId, peer.Photo.MediaAssetId })
        {
            var pending = await Phase5B5ReadAssetAsync(assetId);
            Assert.AreEqual(MediaAssetStatus.Tombstoned, pending.Status);
            Assert.AreEqual(1, pending.PurgeAttemptCount);
            Assert.AreEqual("storage_io_error", pending.PurgeFailureCode);
            Assert.IsNull(pending.PurgeClaimToken);
        }

        // Still due, so the next sweep picks it up: retryable, just not in a spin.
        RequiredStorageFaults.AllowDeletes();
        Assert.AreEqual(2, (await Phase5B5SweepAsync()).Purged);
    }

    /// <summary>
    /// A scanner that answers with unusable metadata has failed operationally. That is not evidence
    /// that the caller's file is bad, and 400 stays reserved for an actual refusal.
    /// </summary>
    [TestMethod]
    public async Task Phase6B4ARemediationMalformedScannerMetadataIsReportedAsAScannerFailure()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(
            coach,
            "p6b4r-malformed-scan@example.test",
            "Malformed Scan Coach",
            "Malformed Scan Workspace");
        RequiredScannerSwitch.ProduceMalformedResult = true;
        await RefreshCsrfAsync(coach);

        using var form = new MultipartFormDataContent();
        form.Add(new StringContent("Malformed scanner metadata"), "title");
        var file = new ByteArrayContent(JpegBytes);
        file.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");
        form.Add(file, "file", "unusable-verdict.jpg");

        var response = await coach.PostAsync("/api/media/uploads", form);

        Assert.AreEqual(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("Media uploads are unavailable", body);
        Assert.DoesNotContain("scanner", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("unusable-verdict", body, StringComparison.OrdinalIgnoreCase);

        // Nothing was published, and every accepted byte is either gone or durably scheduled.
        Assert.AreEqual(
            0,
            await Phase5B5CountAsync(context => context.MediaAssets.IgnoreQueryFilters()),
            "A malformed scanner verdict published an asset.");
        Assert.AreEqual(
            0,
            await Phase5B5CountAsync(context => context.MediaIngestObjects
                .IgnoreQueryFilters()
                .Where(item => item.Status != MediaIngestObjectStatus.Purged)),
            "A stored object was left neither deleted nor durably scheduled.");
        Assert.DoesNotContain(
            "SwitchableTestScanner",
            RequiredSensitiveLogCapture.Text,
            StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// The database refuses a traversing key on every media table, so a direct SQL writer cannot
    /// give one tenant's row an address that resolves inside another tenant.
    /// </summary>
    [TestMethod]
    public async Task Phase6B4ARemediationDatabaseRefusesTraversingKeysOnEveryMediaTable()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(
            coach,
            "p6b4r-keys@example.test",
            "Key Grammar Coach",
            "Key Grammar Workspace");
        using var client = CreateClient();
        await InviteAndAcceptAsync(coach, client, "p6b4r-keys-client@example.test", true);
        SetTenant(client, workspaceId);
        var photo = await UploadProgressPhotoAsync(
            client,
            "/api/progress/me/photos?pose=Front&photoDate=2026-08-22");

        var tenant = workspaceId.ToString("N");
        var victim = Guid.NewGuid().ToString("N");
        (string Scenario, string Key)[] unsafeKeys =
        [
            // The finding itself: satisfies a tenant-prefix check, resolves inside another tenant.
            ("cross-tenant traversal", $"{tenant}/../{victim}/object"),
            ("interior dot-dot", $"{tenant}/a/../b"),
            ("single dot segment", $"{tenant}/./x"),
            ("empty segment", $"{tenant}/a//b"),
            ("trailing separator", $"{tenant}/a/"),
            ("rooted key", $"/{tenant}/a"),
            ("backslash traversal", $@"{tenant}/a\..\b"),
            ("prefix extension", $"{tenant}ff/object"),
            ("foreign tenant", $"{victim}/object"),
            ("embedded space", $"{tenant}/a b"),
        ];

        // The evidence key is moved with the live key so the scan-evidence constraint is satisfied
        // and the storage-locator constraint is the only one under test. The ingest row is revived
        // out of its purged state for the same reason.
        (string Table, string Sql, Guid Filter)[] targets =
        [
            ("Assets",
                "UPDATE media.\"Assets\" SET \"StorageKey\" = @key, \"ScanStorageKey\" = @key WHERE \"Id\" = @id",
                photo.MediaAssetId),
            ("AssetDerivatives",
                "UPDATE media.\"AssetDerivatives\" SET \"StorageKey\" = @key, \"ScanStorageKey\" = @key WHERE \"MediaAssetId\" = @id",
                photo.MediaAssetId),
            ("IngestObjects",
                "UPDATE media.\"IngestObjects\" SET \"Status\" = 'CleanupPending', \"PurgedAtUtc\" = NULL, " +
                "\"StorageKey\" = @key WHERE \"TenantId\" = @id",
                workspaceId),
        ];

        foreach (var (table, sql, filter) in targets)
        {
            foreach (var (scenario, key) in unsafeKeys)
            {
                var refusal = await Phase6B4AExpectCheckViolationAsync(sql, filter, key);
                Assert.Contains(
                    "StorageLocator",
                    refusal.ConstraintName ?? string.Empty,
                    $"{table} refused {scenario} for the wrong reason.");
            }
        }

        // The shape the application actually writes is still accepted on every table.
        foreach (var (_, sql, filter) in targets)
        {
            await Phase6ExecuteAsync(
                sql,
                ("id", filter),
                ("key", $"{tenant}/{Guid.NewGuid():N}/rendition.jpg"));
        }
    }

    /// <summary>
    /// Refused bytes have to be reclaimable, so Complete/Refused evidence stays valid all the way
    /// to Purged — without the asset becoming readable while it sits in the otherwise-readable
    /// Tombstoned state.
    /// </summary>
    [TestMethod]
    public async Task Phase6B4ARemediationRefusedEvidenceIsPurgeableButNeverReadable()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(
            coach,
            "p6b4r-refused@example.test",
            "Refused Coach",
            "Refused Workspace");
        var asset = await UploadJpegAsync(coach);
        var grant = await Phase5B5GrantAsync(coach, asset.Id);
        await AssertStatusAsync(await coach.GetAsync(grant.Url), HttpStatusCode.OK);

        // A refused original cannot be produced through the API — a refusal commits no asset — so
        // the row is moved into that state directly, which is the shape a legacy row or a future
        // repair path would present.
        await Phase6ExecuteAsync(
            "UPDATE media.\"Assets\" SET \"Status\" = 'Rejected', \"ScanOutcome\" = 'Refused', " +
            "\"ScanFailureCode\" = 'malware_detected' WHERE \"Id\" = @id",
            ("id", asset.Id));

        // Rejected -> Tombstoned is accepted with the evidence left exactly as the scanner wrote it.
        await Phase6ExecuteAsync(
            "UPDATE media.\"Assets\" SET \"Status\" = 'Tombstoned', \"TombstonedAtUtc\" = @now, " +
            "\"PurgeAfterUtc\" = @now WHERE \"Id\" = @id",
            ("id", asset.Id),
            ("now", RequiredTestClock.UtcNow));

        var tombstoned = await Phase5B5ReadAssetAsync(asset.Id);
        Assert.AreEqual(MediaAssetStatus.Tombstoned, tombstoned.Status);
        Assert.AreEqual(MediaScanOutcome.Refused, tombstoned.ScanOutcome);
        Assert.AreEqual(MediaScanEvidenceState.Complete, tombstoned.ScanEvidenceState);

        // Tombstoned is readable for ordinary media. Refused bytes are not, on the full read, on a
        // ranged read, or through a freshly minted grant.
        await AssertStatusAsync(await coach.GetAsync(grant.Url), HttpStatusCode.NotFound);
        using var ranged = new HttpRequestMessage(HttpMethod.Get, grant.Url);
        ranged.Headers.Range = new RangeHeaderValue(0, 0);
        await AssertStatusAsync(await coach.SendAsync(ranged), HttpStatusCode.NotFound);
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsync($"/api/media/{asset.Id}/access", null),
            HttpStatusCode.NotFound);

        // And the bytes still follow the ordinary cleanup lifecycle.
        var keys = await Phase5B5ReadStorageKeysAsync(asset.Id);
        Assert.IsTrue(Phase5B5ObjectExists(keys.AssetKey!));
        Assert.AreEqual(1, (await Phase5B5SweepAsync()).Purged);
        Assert.IsFalse(Phase5B5ObjectExists(keys.AssetKey!));

        var purged = await Phase5B5ReadAssetAsync(asset.Id);
        Assert.AreEqual(MediaAssetStatus.Purged, purged.Status);
        Assert.AreEqual(MediaScanOutcome.Refused, purged.ScanOutcome);
        Assert.AreEqual(MediaStorageLocations.LocalV1, purged.StorageLocation);
        Assert.IsNull(purged.StorageKey);
    }

    /// <summary>
    /// The sweep's own claim predicate, run against one asset: 1 when another replica could take
    /// it, 0 when a live lease keeps it out of reach.
    /// </summary>
    private async Task<long> Phase6B4ACountClaimableAsync(Guid assetId)
    {
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync(TestContext.CancellationTokenSource.Token);
        await using var command = connection.CreateCommand();
        command.CommandText =
            """
            SELECT count(*) FROM media."Assets"
            WHERE "Id" = @id
              AND "Status" = 'Tombstoned'
              AND "Source" = 'Upload'
              AND "PurgeAfterUtc" IS NOT NULL
              AND "PurgeAfterUtc" <= @now
              AND ("PurgeClaimToken" IS NULL OR "PurgeClaimExpiresAtUtc" <= @now)
            """;
        command.Parameters.AddWithValue("id", assetId);
        command.Parameters.AddWithValue("now", RequiredTestClock.UtcNow);
        return (long)(await command.ExecuteScalarAsync(TestContext.CancellationTokenSource.Token))!;
    }

    private async Task<PostgresException> Phase6B4AExpectCheckViolationAsync(
        string sql,
        Guid id,
        string key)
    {
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync(TestContext.CancellationTokenSource.Token);
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.Parameters.AddWithValue("id", id);
        command.Parameters.AddWithValue("key", key);
        var refusal = await Assert.ThrowsExactlyAsync<PostgresException>(
            () => command.ExecuteNonQueryAsync(TestContext.CancellationTokenSource.Token));
        Assert.AreEqual(PostgresErrorCodes.CheckViolation, refusal.SqlState);
        return refusal;
    }

    private async Task<IReadOnlyList<Phase6B4APurgeState>> Phase6B4AReadPurgeStateAsync(
        IReadOnlyCollection<Guid> assetIds)
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        return await context.MediaAssets
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(item => assetIds.Contains(item.Id))
            .Select(item => new Phase6B4APurgeState(
                item.Id,
                item.Status,
                item.PurgeClaimToken,
                item.PurgeClaimExpiresAtUtc,
                item.PurgeAttemptCount))
            .ToListAsync(TestContext.CancellationTokenSource.Token);
    }

    private sealed record Phase6B4APurgeState(
        Guid AssetId,
        MediaAssetStatus Status,
        Guid? ClaimToken,
        DateTimeOffset? ClaimExpiresAtUtc,
        int AttemptCount);

    private sealed record Phase6B4ALeaseObservation(
        Guid AssetId,
        DateTimeOffset ObservedAtUtc,
        DateTimeOffset ClaimExpiresAtUtc,
        bool OthersUnclaimed);
}
