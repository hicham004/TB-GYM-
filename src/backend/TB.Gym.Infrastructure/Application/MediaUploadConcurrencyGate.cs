using System.Collections.Concurrent;

namespace TB.Gym.Infrastructure.Application;

internal sealed class MediaUploadConcurrencyGate
{
    private readonly ConcurrentDictionary<Guid, SemaphoreSlim> gates = new();

    public IDisposable? TryEnter(Guid tenantId)
    {
        var gate = gates.GetOrAdd(tenantId, static _ => new SemaphoreSlim(1, 1));
        return gate.Wait(0) ? new Lease(gate) : null;
    }

    private sealed class Lease(SemaphoreSlim gate) : IDisposable
    {
        private SemaphoreSlim? current = gate;

        public void Dispose() => Interlocked.Exchange(ref current, null)?.Release();
    }
}
