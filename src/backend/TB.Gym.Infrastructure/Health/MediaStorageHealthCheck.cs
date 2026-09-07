using Microsoft.Extensions.Diagnostics.HealthChecks;
using TB.Gym.Modules.Media;

namespace TB.Gym.Infrastructure.Health;

/// <summary>Makes the media-storage fail-closed state visible without exposing configuration.</summary>
internal sealed class MediaStorageHealthCheck(IObjectStorage storage) : IHealthCheck
{
    public Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context,
        CancellationToken cancellationToken = default) =>
        Task.FromResult(storage.IsAvailable
            ? HealthCheckResult.Healthy("Media object storage is configured.")
            : HealthCheckResult.Degraded(
                "Media object storage is unavailable, so media uploads and object access are refused."));
}
