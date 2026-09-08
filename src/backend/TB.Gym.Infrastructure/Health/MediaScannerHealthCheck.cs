using Microsoft.Extensions.Diagnostics.HealthChecks;
using TB.Gym.Infrastructure.Application;
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
/// <para>
/// Since Phase 6B-4B a composed scanner is also asked, once and briefly, whether the daemon answers.
/// A configured but unreachable scanner refuses every upload exactly as an unconfigured one does,
/// and the same Degraded reasoning applies to it.
/// </para>
/// </remarks>
internal sealed class MediaScannerHealthCheck(IMediaScanner scanner) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context,
        CancellationToken cancellationToken = default)
    {
        if (!scanner.IsAvailable)
        {
            return HealthCheckResult.Degraded(
                "No upload scanner is configured, so media uploads are refused.");
        }

        if (scanner is IMediaDependencyProbe probe &&
            !await probe.ProbeAsync(cancellationToken))
        {
            return HealthCheckResult.Degraded(
                "The upload scanner is configured but did not respond, so media uploads are refused.");
        }

        return HealthCheckResult.Healthy("An upload scanner is configured.");
    }
}
