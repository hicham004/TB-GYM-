using Microsoft.Extensions.Diagnostics.HealthChecks;
using TB.Gym.Infrastructure.Application;
using TB.Gym.Modules.Media;

namespace TB.Gym.Infrastructure.Health;

/// <summary>Makes the media-storage fail-closed state visible without exposing configuration.</summary>
/// <remarks>
/// Since Phase 6B-4B a composed provider is also asked, once and briefly, whether it actually
/// answers: a bucket that is configured but unreachable refuses every upload exactly as an
/// unconfigured one does, and a check that only read a flag would call that healthy. The probe never
/// names the bucket, the endpoint or a key, and a failed probe stays
/// <see cref="HealthStatus.Degraded"/> for the reason the unconfigured case is — everything except
/// media works, so failing readiness outright would pull a functioning API out of its load balancer
/// over one dependency.
/// </remarks>
internal sealed class MediaStorageHealthCheck(IObjectStorage storage) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context,
        CancellationToken cancellationToken = default)
    {
        if (!storage.IsAvailable)
        {
            return HealthCheckResult.Degraded(
                "Media object storage is unavailable, so media uploads and object access are refused.");
        }

        if (storage is IMediaDependencyProbe probe &&
            !await probe.ProbeAsync(cancellationToken))
        {
            return HealthCheckResult.Degraded(
                "Media object storage is configured but did not respond, so media uploads and object access fail.");
        }

        return HealthCheckResult.Healthy("Media object storage is configured.");
    }
}
