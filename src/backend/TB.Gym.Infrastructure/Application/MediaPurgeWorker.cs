using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using TB.Gym.Modules.Media;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// Runs the media purge sweep on a fixed interval inside the API process.
/// </summary>
/// <remarks>
/// This is deliberately the smallest thing that works: a timer, a scope, one call. It is not a job
/// platform and must not grow into one — no queue, no schedule table, no retry policy engine, no
/// generic work dispatch. Its safety with several replicas comes entirely from the database:
/// <see cref="IMediaPurgeService"/> claims rows with <c>FOR UPDATE SKIP LOCKED</c>, so every replica
/// may run this loop and no two will ever claim the same asset. Nothing here is a foundation for
/// notification-outbox dispatch; that needs durable delivery semantics this does not have, and
/// reusing this loop for it would be a mistake.
/// </remarks>
internal sealed class MediaPurgeWorker(
    IServiceScopeFactory scopeFactory,
    IOptions<MediaStorageOptions> storageOptions,
    ILogger<MediaPurgeWorker> logger)
    : BackgroundService
{
    private static readonly Action<ILogger, Exception?> LogDisabled =
        LoggerMessage.Define(
            LogLevel.Information,
            new EventId(5502, "MediaPurgeDisabled"),
            "The media purge sweep is disabled by configuration.");

    private static readonly Action<ILogger, int, int, int, Exception?> LogSwept =
        LoggerMessage.Define<int, int, int>(
            LogLevel.Information,
            new EventId(5503, "MediaPurgeSwept"),
            "Media purge swept {Claimed} assets: {Purged} purged, {Failed} left pending.");

    private static readonly Action<ILogger, Exception?> LogSweepFailed =
        LoggerMessage.Define(
            LogLevel.Error,
            new EventId(5504, "MediaPurgeSweepFailed"),
            "The media purge sweep failed and will retry on the next tick.");

    private readonly MediaStorageOptions options = storageOptions.Value;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.PurgeEnabled)
        {
            LogDisabled(logger, null);
            return;
        }

        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(options.PurgeIntervalSeconds));
        while (!stoppingToken.IsCancellationRequested)
        {
            // Wait first: startup is already busy, and retention is measured in days, so a sweep
            // has nothing useful to do in the first seconds of a deployment.
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
            var service = scope.ServiceProvider.GetRequiredService<IMediaPurgeService>();
            var outcome = await service.PurgeDueAsync(options.PurgeBatchSize, stoppingToken);
            if (outcome.Claimed > 0)
            {
                LogSwept(logger, outcome.Claimed, outcome.Purged, outcome.Failed, null);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Shutdown, not a failure.
        }
        catch (Exception exception)
        {
            // A failed sweep must not end the loop: the rows it could not claim are still due and
            // the next tick tries again.
            LogSweepFailed(logger, exception);
        }
    }
}
