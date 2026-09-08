using System.Collections.Concurrent;
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

        public void RecordList() => Interlocked.Increment(ref listCalls);

        public void RecordStat(string key)
        {
            Interlocked.Increment(ref statCalls);
            StattedKeys.Enqueue(key);
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
}
