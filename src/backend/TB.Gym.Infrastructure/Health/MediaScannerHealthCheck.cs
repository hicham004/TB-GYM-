using Microsoft.Extensions.Diagnostics.HealthChecks;
using TB.Gym.Modules.Media;

namespace TB.Gym.Infrastructure.Health;

/// <summary>
/// Reports whether this deployment can accept media uploads at all.
/// </summary>
/// <remarks>
/// Media publication fails closed without a scanner: every upload is refused and no asset is
/// stored. That is the safe behaviour, but it is silent — a workspace simply finds that no photo
/// can be added, and nothing in the deployment says why. This makes the closed state visible on
/// the existing readiness endpoint.
/// <para>
/// It reports <see cref="HealthStatus.Degraded"/> rather than Unhealthy on purpose. Everything
/// except media works normally, so failing readiness outright would pull a functioning API out of
/// its load balancer over one unconfigured adapter. Degraded keeps the deployment serving and
/// still surfaces the condition, which is what an operator needs before a coach reports it as a
/// bug.
/// </para>
/// </remarks>
internal sealed class MediaScannerHealthCheck(IMediaScanner scanner) : IHealthCheck
{
    public Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context,
        CancellationToken cancellationToken = default) =>
        Task.FromResult(scanner.IsAvailable
            ? HealthCheckResult.Healthy("An upload scanner is configured.")
            : HealthCheckResult.Degraded(
                "No upload scanner is configured, so media uploads are refused."));
}
