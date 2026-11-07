using Microsoft.Extensions.Options;
using TB.Gym.Modules.Identity;

namespace TB.Gym.Worker;

/// <summary>
/// Erases the certificate lines whose keeping period has run out, once a day (CLI-021, notes plan N4b), so the
/// record is kept only as long as the period says without anyone having to remember it.
/// </summary>
/// <remarks>
/// Like the billing sweep it runs once at start and then on every tick: a Worker that was down catches up on its
/// next start, and a second Worker finds nothing left to erase, since an erased line is never due again.
/// </remarks>
public sealed class CoachCertificateKeepingWorker(
    IServiceScopeFactory scopeFactory,
    IOptions<CoachCertificateOptions> options,
    ILogger<CoachCertificateKeepingWorker> logger)
    : BackgroundService
{
    private static readonly Action<ILogger, Exception?> LogDisabled =
        LoggerMessage.Define(
            LogLevel.Information,
            new EventId(6302, "CoachCertificateKeepingSweepDisabled"),
            "The certificate keeping sweep is disabled by configuration.");

    private static readonly Action<ILogger, Exception?> LogSweepFailed =
        LoggerMessage.Define(
            LogLevel.Error,
            new EventId(6303, "CoachCertificateKeepingSweepFailed"),
            "The certificate keeping sweep failed and will retry on the next tick.");

    private readonly CoachCertificateOptions settings = options.Value;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!settings.SweepEnabled)
        {
            LogDisabled(logger, null);
            return;
        }

        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(settings.SweepIntervalSeconds));
        await RunOnceAsync(stoppingToken);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (!await timer.WaitForNextTickAsync(stoppingToken))
                {
                    return;
                }
            }
            catch (OperationCanceledException)
            {
                return;
            }

            await RunOnceAsync(stoppingToken);
        }
    }

    private async Task RunOnceAsync(CancellationToken stoppingToken)
    {
        try
        {
            await using var scope = scopeFactory.CreateAsyncScope();
            // The sweep logs its own counts; it never logs a line's words.
            await scope.ServiceProvider.GetRequiredService<ICoachCertificateKeepingSweep>().RunAsync(stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Shutdown, not a failure.
        }
        catch (Exception exception)
        {
            // An unavailable database or a schema not migrated yet are expected states at startup.
            LogSweepFailed(logger, exception);
        }
    }
}
