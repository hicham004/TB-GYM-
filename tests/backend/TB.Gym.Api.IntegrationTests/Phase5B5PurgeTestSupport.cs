using System.Collections.Concurrent;
using Microsoft.Extensions.DependencyInjection;
using TB.Gym.Modules.Media;

namespace TB.Gym.Api.IntegrationTests;

public sealed partial class Phase3TrainingWorkflowTests
{
    /// <summary>
    /// The quota tests need to reach a limit with a realistic number of realistic uploads, so they
    /// configure the smallest allowance the options validator accepts rather than the production
    /// default. The limits themselves are not weakened: the validator still rejects anything below
    /// one maximum-size image.
    /// </summary>
    private const long Phase5B5SmallQuotaBytes = MediaUploadPolicy.MaximumImageBytes;

    private const long Phase5B5RoomyQuotaBytes = 200L * 1024L * 1024L;

    /// <summary>
    /// The per-client allowance binds while the workspace stays roomy, so the client test proves
    /// the client limit rather than accidentally re-proving the workspace one. Otherwise it tracks
    /// the workspace allowance, which the options validator requires it not to exceed.
    /// </summary>
    private long Phase5B5ClientQuotaBytes() =>
        TestContext.TestName?.Contains("ClientProgressPhotoQuota", StringComparison.Ordinal) == true
            ? Phase5B5SmallQuotaBytes
            : Phase5B5WorkspaceQuotaBytes();

    private long Phase5B5WorkspaceQuotaBytes() =>
        TestContext.TestName?.Contains("WorkspaceQuota", StringComparison.Ordinal) == true ||
        TestContext.TestName?.Contains("ConcurrentUploads", StringComparison.Ordinal) == true
            ? Phase5B5SmallQuotaBytes
            : Phase5B5RoomyQuotaBytes;

    /// <summary>
    /// Wraps whatever object storage the application registered, so a test can make deletion fail
    /// without reimplementing storage. The real implementation stays in place underneath, which is
    /// what makes the retry assertions meaningful.
    /// </summary>
    private static void Phase5B5DecorateObjectStorage(
        IServiceCollection services,
        StorageFaultSwitch faults)
    {
        var original = services.Last(descriptor => descriptor.ServiceType == typeof(IObjectStorage));
        services.Remove(original);
        services.AddSingleton<IObjectStorage>(provider =>
        {
            var inner = original.ImplementationInstance as IObjectStorage
                ?? (original.ImplementationFactory is not null
                    ? (IObjectStorage)original.ImplementationFactory(provider)
                    : (IObjectStorage)ActivatorUtilities.CreateInstance(provider, original.ImplementationType!));
            return new FaultInjectingObjectStorage(inner, faults);
        });
    }

    private StorageFaultSwitch RequiredStorageFaults =>
        storageFaults ?? throw new InvalidOperationException("The storage fault switch is not initialized.");

    internal sealed class StorageFaultSwitch
    {
        public bool FailDeletes { get; set; }

        public bool IsUnavailable { get; set; }

        public string? WriteLocationOverride { get; set; }

        public int PutCount => Volatile.Read(ref putCount);

        public int ReadCount => Volatile.Read(ref readCount);

        public int DeleteCount => Volatile.Read(ref deleteCount);

        public IReadOnlyCollection<string> StoredKeys => storedKeys.Keys.ToArray();

        public IReadOnlyCollection<ObjectReadRequest> Reads => reads.ToArray();

        private readonly ConcurrentDictionary<string, byte> storedKeys = new(StringComparer.Ordinal);
        private readonly ConcurrentDictionary<int, byte> failedDeleteCalls = new();
        private readonly ConcurrentQueue<ObjectReadRequest> reads = new();
        private readonly Lock deleteBarrierSync = new();
        private TaskCompletionSource<StorageObjectLocator>? deleteStarted;
        private TaskCompletionSource? releaseDelete;
        private int putCount;
        private int readCount;
        private int deleteCount;

        public void FailDeleteCall(int callNumber) => failedDeleteCalls[callNumber] = 0;

        public void AllowDeletes()
        {
            FailDeletes = false;
            failedDeleteCalls.Clear();
        }

        public void RecordPut(string objectKey)
        {
            Interlocked.Increment(ref putCount);
            storedKeys[objectKey] = 0;
        }

        public void RecordRead(ObjectReadRequest request)
        {
            Interlocked.Increment(ref readCount);
            reads.Enqueue(request);
        }

        public void ArmDeleteBarrier()
        {
            lock (deleteBarrierSync)
            {
                deleteStarted = new TaskCompletionSource<StorageObjectLocator>(
                    TaskCreationOptions.RunContinuationsAsynchronously);
                releaseDelete = new TaskCompletionSource(
                    TaskCreationOptions.RunContinuationsAsynchronously);
            }
        }

        public async Task<StorageObjectLocator> WaitForDeleteAsync(CancellationToken cancellationToken)
        {
            Task<StorageObjectLocator> started;
            lock (deleteBarrierSync)
            {
                started = deleteStarted?.Task
                    ?? throw new InvalidOperationException("The delete barrier is not armed.");
            }

            return await started.WaitAsync(TimeSpan.FromSeconds(30), cancellationToken);
        }

        public void ReleaseDeleteBarrier()
        {
            lock (deleteBarrierSync)
            {
                releaseDelete?.TrySetResult();
            }
        }

        public async Task EnterDeleteAsync(
            StorageObjectLocator locator,
            CancellationToken cancellationToken)
        {
            Task? release = null;
            lock (deleteBarrierSync)
            {
                if (deleteStarted is not null && !deleteStarted.Task.IsCompleted)
                {
                    deleteStarted.TrySetResult(locator);
                    release = releaseDelete!.Task;
                }
            }

            if (release is not null)
            {
                await release.WaitAsync(TimeSpan.FromSeconds(30), cancellationToken);
            }
        }

        public bool ShouldFailDelete()
        {
            var callNumber = Interlocked.Increment(ref deleteCount);
            return FailDeletes || failedDeleteCalls.ContainsKey(callNumber);
        }

        public void RecordDelete(string objectKey) => storedKeys.TryRemove(objectKey, out _);
    }

    private sealed class FaultInjectingObjectStorage(IObjectStorage inner, StorageFaultSwitch faults)
        : IObjectStorage
    {
        public string WriteLocation => faults.WriteLocationOverride ?? inner.WriteLocation;

        public bool IsAvailable => !faults.IsUnavailable && inner.IsAvailable;

        public async Task<ObjectWriteResult> PutAsync(
            ObjectUpload upload,
            CancellationToken cancellationToken)
        {
            var result = await inner.PutAsync(upload, cancellationToken);
            if (result.StoredObject is { } stored)
            {
                faults.RecordPut(stored.Locator.ObjectKey);
            }

            return result;
        }

        public Task<ObjectReadResult> ReadAsync(
            ObjectReadRequest request,
            CancellationToken cancellationToken)
        {
            faults.RecordRead(request);
            return inner.ReadAsync(request, cancellationToken);
        }

        public async Task<ObjectDeleteResult> DeleteAsync(
            StorageObjectLocator locator,
            CancellationToken cancellationToken)
        {
            await faults.EnterDeleteAsync(locator, cancellationToken);
            if (faults.ShouldFailDelete())
            {
                return new ObjectDeleteResult(
                    ObjectStorageOperationStatus.Failed,
                    "storage_io_error");
            }

            var result = await inner.DeleteAsync(locator, cancellationToken);
            if (result.Status == ObjectStorageOperationStatus.Success)
            {
                faults.RecordDelete(locator.ObjectKey);
            }

            return result;
        }
    }
}
