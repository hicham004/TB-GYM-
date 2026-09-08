using System.Collections.Concurrent;
using System.Net;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Media;

namespace TB.Gym.Api.IntegrationTests;

public sealed partial class Phase3TrainingWorkflowTests
{
    /// <summary>
    /// Wraps the composed inventory so a test can see every call the reconciliation service made and,
    /// crucially, whether it made any of them while a database transaction was open.
    /// </summary>
    /// <remarks>
    /// Registered <em>scoped</em> and given the same <see cref="GymDbContext"/> the service resolves,
    /// so the transaction it inspects is the one the service itself would be holding. A singleton
    /// decorator could not see that context at all, and the rule it is checking — no storage call
    /// inside a database transaction — is precisely about that context.
    /// </remarks>
    private static void Phase6B4CDecorateObjectInventory(IServiceCollection services, InventoryProbe probe)
    {
        var original = services.LastOrDefault(descriptor => descriptor.ServiceType == typeof(IObjectInventory));
        if (original is null)
        {
            return;
        }

        services.Remove(original);
        services.AddScoped<IObjectInventory>(provider =>
        {
            var inner = original.ImplementationInstance as IObjectInventory
                ?? (original.ImplementationFactory is not null
                    ? (IObjectInventory)original.ImplementationFactory(provider)
                    : (IObjectInventory)ActivatorUtilities.CreateInstance(provider, original.ImplementationType!));
            return new ObservingObjectInventory(
                inner,
                probe,
                provider.GetRequiredService<GymDbContext>());
        });
        services.TryAddSingleton(probe);
    }

    private InventoryProbe RequiredInventoryProbe =>
        inventoryProbe ?? throw new InvalidOperationException("The inventory probe is not initialized.");

    /// <summary>What the reconciliation service asked the store, and whether it was allowed to.</summary>
    internal sealed class InventoryProbe
    {
        private int listCalls;
        private int statCalls;

        public int ListCalls => Volatile.Read(ref listCalls);

        public int StatCalls => Volatile.Read(ref statCalls);

        /// <summary>Every key the service asked about, so a test can prove what was never probed.</summary>
        public ConcurrentQueue<string> StattedKeys { get; } = new();

        /// <summary>
        /// Calls that happened while a database transaction was open. Any entry here is a defect:
        /// remote latency inside a transaction is the failure the purge sweep was rebuilt to avoid.
        /// </summary>
        public ConcurrentQueue<string> CallsInsideTransaction { get; } = new();

        /// <summary>Fails the next list calls, as a provider that would not answer.</summary>
        public int FailListCalls { get; set; }

        /// <summary>Fails the next stat calls. A store that did not answer is never an absence.</summary>
        public int FailStatCalls { get; set; }

        /// <summary>
        /// How much time each stat appears to take. A slow store is the only way a provider call can
        /// approach the lease that says who owns the run, and a test cannot wait out a real one.
        /// </summary>
        public TimeSpan AdvanceOnStat { get; set; }

        /// <summary>The fixture's clock, so a slow store can be simulated rather than waited for.</summary>
        internal Action<TimeSpan>? Advance { get; init; }

        public void RecordList() => Interlocked.Increment(ref listCalls);

        public void RecordStat(string key)
        {
            Interlocked.Increment(ref statCalls);
            StattedKeys.Enqueue(key);
            if (AdvanceOnStat > TimeSpan.Zero)
            {
                Advance?.Invoke(AdvanceOnStat);
            }
        }
    }

    private sealed class ObservingObjectInventory(
        IObjectInventory inner,
        InventoryProbe probe,
        GymDbContext context)
        : IObjectInventory
    {
        public string ReconciledLocation => inner.ReconciledLocation;

        public bool IsAvailable => inner.IsAvailable;

        public Task<ObjectInventoryPage> ListAsync(
            string? cursor,
            int maximumKeys,
            CancellationToken cancellationToken)
        {
            Guard("list");
            probe.RecordList();
            if (probe.FailListCalls > 0)
            {
                probe.FailListCalls--;
                return Task.FromResult(new ObjectInventoryPage(
                    ObjectStorageOperationStatus.Failed,
                    [],
                    FailureCode: "storage_provider_unavailable"));
            }

            return inner.ListAsync(cursor, maximumKeys, cancellationToken);
        }

        public Task<ObjectStatResult> StatAsync(
            StorageObjectLocator locator,
            CancellationToken cancellationToken)
        {
            Guard("stat");
            probe.RecordStat(locator.ObjectKey);
            if (probe.FailStatCalls > 0)
            {
                probe.FailStatCalls--;
                return Task.FromResult(new ObjectStatResult(
                    ObjectStorageOperationStatus.Failed,
                    FailureCode: "storage_provider_unavailable"));
            }

            return inner.StatAsync(locator, cancellationToken);
        }

        private void Guard(string operation)
        {
            if (context.Database.CurrentTransaction is not null)
            {
                probe.CallsInsideTransaction.Enqueue(operation);
            }
        }
    }

    // ------------------------------------------------------------------ helpers

    private async Task<MediaInventoryReconciliationOutcome> Phase6B4CReconcileAsync(
        int objectBudget = 500,
        int ownerProbeBudget = 500)
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var service = scope.ServiceProvider.GetRequiredService<IMediaInventoryReconciliationService>();
        return await service.ReconcileAsync(
            objectBudget,
            ownerProbeBudget,
            TestContext.CancellationTokenSource.Token);
    }

    private async Task<IReadOnlyList<MediaInventoryFinding>> Phase6B4CFindingsAsync()
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        return await context.MediaInventoryFindings
            .IgnoreQueryFilters()
            .AsNoTracking()
            .OrderBy(item => item.StorageKey)
            .ToListAsync(TestContext.CancellationTokenSource.Token);
    }

    private async Task<IReadOnlyList<MediaInventoryRun>> Phase6B4CRunsAsync()
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        return await context.MediaInventoryRuns
            .AsNoTracking()
            .OrderBy(item => item.StartedAtUtc)
            .ToListAsync(TestContext.CancellationTokenSource.Token);
    }

    /// <summary>
    /// Puts an object in the bucket that this application did not write, aged past the grace window
    /// so reconciliation is entitled to have an opinion about it.
    /// </summary>
    private string Phase6B4CSeedUnownedObject(Guid tenantId, DateTimeOffset? lastModifiedUtc = null)
    {
        var harness = RequiredProviderHarness;
        var key = $"{tenantId:N}/{Guid.CreateVersion7():N}";
        harness.Bucket.Seed(
            key,
            [1, 2, 3, 4],
            lastModifiedUtc ?? RequiredTestClock.UtcNow.AddDays(-2));
        return key;
    }

    private async Task<MediaInventoryRun> Phase6B4CRunAsync() =>
        (await Phase6B4CRunsAsync()).Single();

    /// <summary>
    /// Hands the run's lease to a named token with a given expiry, as one replica holding it looks
    /// to every other. Written directly because no supported path lends a caller somebody else's
    /// lease, which is exactly the situation being proved impossible to write under.
    /// </summary>
    private async Task Phase6B4CHoldLeaseAsync(Guid runId, Guid leaseToken, DateTimeOffset expiresAtUtc)
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        await context.Database.ExecuteSqlAsync($"""
            UPDATE media."InventoryRuns"
            SET "LeaseToken" = {leaseToken}, "LeaseExpiresAtUtc" = {expiresAtUtc}
            WHERE "Id" = {runId}
            """);
    }

    /// <summary>
    /// Makes the store answer every listing with the given body, so a malformed or unfollowable page
    /// can be served by the same transport the adapter really talks to.
    /// </summary>
    private void Phase6B4CServeListing(string body) =>
        RequiredProviderHarness.Bucket.Fault = request =>
            request.Method == "GET" && request.Query.Contains("list-type", StringComparison.Ordinal)
                ? new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(body, Encoding.UTF8, "application/xml"),
                }
                : null;

    private const string Phase6B4CListNamespace = "http://s3.amazonaws.com/doc/2006-03-01/";

    /// <summary>A listing that says there is more behind it and hands back no way to ask for it.</summary>
    private static string Phase6B4CTruncatedWithoutCursor() =>
        $"""<ListBucketResult xmlns="{Phase6B4CListNamespace}"><Name>tb-gym-media</Name><KeyCount>0</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>true</IsTruncated></ListBucketResult>""";

    /// <summary>A listing whose object carries no size and no modification instant.</summary>
    private static string Phase6B4CListingWithoutObjectMetadata(string objectKey) =>
        $"""<ListBucketResult xmlns="{Phase6B4CListNamespace}"><Name>tb-gym-media</Name><KeyCount>1</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated><Contents><Key>{objectKey}</Key><ETag>&quot;abc&quot;</ETag><StorageClass>STANDARD</StorageClass></Contents></ListBucketResult>""";

    /// <summary>
    /// A second live row claiming the object an asset already holds, in the other table that can own
    /// one. Inserted directly because no supported path produces two live claims on one key.
    /// </summary>
    private async Task<Guid> Phase6B4CInsertDerivativeClaimingAsync(
        Guid tenantId,
        Guid mediaAssetId,
        string storageLocation,
        string objectKey)
    {
        var id = Guid.CreateVersion7();
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        await context.Database.ExecuteSqlAsync($"""
            INSERT INTO media."AssetDerivatives"
                ("Id", "TenantId", "MediaAssetId", "Variant", "VerifiedContentType", "Width", "Height",
                 "Length", "Sha256", "StorageLocation", "StorageKey", "ScanEvidenceState",
                 "ScanStorageLocation", "ScanStorageKey", "ScanSha256", "ScannerKey",
                 "ScannerVersion", "ScannedAtUtc", "ScanOutcome", "CreatedAtUtc", "UpdatedAtUtc")
            VALUES ({id}, {tenantId}, {mediaAssetId}, 'Thumbnail', 'image/jpeg', 48, 32,
                    8, repeat('b', 64), {storageLocation}, {objectKey}, 'Complete',
                    {storageLocation}, {objectKey}, repeat('b', 64), 'test-scanner',
                    '1.0/1', CURRENT_TIMESTAMP, 'Allowed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """);
        return id;
    }
}
