using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Identity;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// The certificate record's keeping period, enforced (CLI-021, notes plan N4b): in every coaching space, each line
/// taken down before the cut-off is erased with reason <see cref="CoachCertificateErasureReason.KeepingPeriod"/>, no
/// erasing user and no request day, the row kept without its words as the admin's erasure keeps it. A line still up,
/// one the coach switched off and a waiting line are never touched. The Worker runs it once a day; tests run it
/// directly. It logs counts only.
/// </summary>
/// <remarks>
/// Spaces are found past the tenant query filter, then each is erased in a scope of its own whose tenant context is
/// set to that space, so the ordinary write guard sees a write inside the space it names, as the invoice run does.
/// </remarks>
internal sealed class CoachCertificateKeepingSweep(
    GymDbContext dbContext,
    IServiceScopeFactory scopeFactory,
    IClock clock,
    IOptions<CoachCertificateOptions> options,
    ILogger<CoachCertificateKeepingSweep> logger) : ICoachCertificateKeepingSweep
{
    private const int Attempts = 3;

    private static readonly Action<ILogger, int, int, Exception?> LogErased =
        LoggerMessage.Define<int, int>(
            LogLevel.Information,
            new EventId(6301, "CoachCertificateLinesErasedAfterKeepingPeriod"),
            "Certificate keeping sweep: {Erased} taken-down lines erased in {Spaces} coaching spaces.");

    private static readonly Action<ILogger, int, Exception?> LogSkipped =
        LoggerMessage.Define<int>(
            LogLevel.Warning,
            new EventId(6304, "CoachCertificateKeepingSpacesSkipped"),
            "Certificate keeping sweep: {Skipped} coaching spaces changed while being swept and wait for the next sweep.");

    public async Task<CoachCertificateKeepingSweepResult> RunAsync(CancellationToken cancellationToken)
    {
        var period = options.Value.KeepingPeriod;
        var now = clock.UtcNow;
        var cutOff = period.CutOff(now);
        var spaces = await dbContext.CoachCertificateLines
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(line => line.ErasedAtUtc == null && line.TakenDownAtUtc != null && line.TakenDownAtUtc < cutOff)
            .Select(line => line.TenantId)
            .Distinct()
            .OrderBy(tenantId => tenantId)
            .ToListAsync(cancellationToken);

        var erased = 0;
        var touched = 0;
        var skipped = 0;
        foreach (var tenantId in spaces)
        {
            // A space whose lines keep changing under the sweep waits for the next one; the others go on.
            if (await EraseInSpaceAsync(tenantId, period, now, cancellationToken) is not { } count)
            {
                skipped++;
            }
            else if (count > 0)
            {
                erased += count;
                touched++;
            }
        }

        if (erased > 0)
        {
            LogErased(logger, erased, touched, null);
        }

        if (skipped > 0)
        {
            LogSkipped(logger, skipped, null);
        }

        return new CoachCertificateKeepingSweepResult(erased, touched, skipped);
    }

    /// <summary>The lines erased in the space, or null when they kept changing until the last attempt.</summary>
    private async Task<int?> EraseInSpaceAsync(
        Guid tenantId,
        CoachCertificateKeepingPeriod period,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        scope.ServiceProvider.GetRequiredService<IMutableTenantContext>().SetTenant(tenantId);
        var space = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var cutOff = period.CutOff(now);
        for (var attempt = 1; ; attempt++)
        {
            // A retry starts from what is stored: a line the admin erased meanwhile is no longer due.
            space.ChangeTracker.Clear();
            var due = (await space.CoachCertificateLines
                    .Where(line => line.TenantId == tenantId &&
                                   line.ErasedAtUtc == null &&
                                   line.TakenDownAtUtc != null &&
                                   line.TakenDownAtUtc < cutOff)
                    .ToListAsync(cancellationToken))
                .Where(line => period.IsDue(line, now))
                .ToList();
            foreach (var line in due)
            {
                line.EraseAfterKeepingPeriod(period, now);
            }

            try
            {
                await space.SaveChangesAsync(cancellationToken);
                return due.Count;
            }
            catch (DbUpdateConcurrencyException) when (attempt < Attempts)
            {
            }
            catch (DbUpdateConcurrencyException)
            {
                return null;
            }
        }
    }
}
