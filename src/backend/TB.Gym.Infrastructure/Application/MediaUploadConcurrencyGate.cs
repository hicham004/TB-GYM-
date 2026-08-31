using System.Collections.Concurrent;
using Microsoft.Extensions.Options;
using TB.Gym.Modules.Media;

namespace TB.Gym.Infrastructure.Application;

public sealed class MediaUploadConcurrencyGate : IDisposable
{
    private readonly ConcurrentDictionary<Guid, SemaphoreSlim> gates = new();
    private readonly SemaphoreSlim progressPhotoDecodes;

    public MediaUploadConcurrencyGate(IOptions<MediaStorageOptions> options)
    {
        var limit = options.Value.MaxConcurrentProgressPhotoDecodes;
        progressPhotoDecodes = new SemaphoreSlim(limit, limit);
    }

    public IDisposable? TryEnter(Guid tenantId)
    {
        var gate = gates.GetOrAdd(tenantId, static _ => new SemaphoreSlim(1, 1));
        return gate.Wait(0) ? new Lease(gate) : null;
    }

    /// <summary>
    /// Process-wide admission for the memory-heavy decode/re-encode section. Tenant admission is
    /// separate and remains held for the complete upload.
    /// </summary>
    public IDisposable? TryEnterProgressPhotoDecode() =>
        progressPhotoDecodes.Wait(0) ? new Lease(progressPhotoDecodes) : null;

    public void Dispose()
    {
        progressPhotoDecodes.Dispose();
        foreach (var gate in gates.Values)
        {
            gate.Dispose();
        }
    }

    private sealed class Lease(SemaphoreSlim gate) : IDisposable
    {
        private SemaphoreSlim? current = gate;

        public void Dispose() => Interlocked.Exchange(ref current, null)?.Release();
    }
}
