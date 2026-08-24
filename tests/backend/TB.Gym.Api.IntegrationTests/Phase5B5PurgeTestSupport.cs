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
    }

    private sealed class FaultInjectingObjectStorage(IObjectStorage inner, StorageFaultSwitch faults)
        : IObjectStorage
    {
        public Task<StoredObject> PutAsync(ObjectUpload upload, CancellationToken cancellationToken) =>
            inner.PutAsync(upload, cancellationToken);

        public Task<Stream> OpenReadAsync(string objectKey, CancellationToken cancellationToken) =>
            inner.OpenReadAsync(objectKey, cancellationToken);

        public Task DeleteAsync(string objectKey, CancellationToken cancellationToken) =>
            faults.FailDeletes
                ? throw new IOException("The object store is unavailable.")
                : inner.DeleteAsync(objectKey, cancellationToken);
    }
}
