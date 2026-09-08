using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using TB.Gym.Modules.Media;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// Runs the media inventory reconciliation pass on a long interval inside the API process.
/// </summary>
/// <remarks>
/// <para>
/// Deliberately a second loop rather than more work inside the purge sweep. Deleting due bytes and
/// auditing a whole bucket have nothing in common except the tables they read: one must run every
/// few minutes and finish quickly, the other walks everything and may take several passes to get
/// through it. Sharing a loop would make an inventory walk the reason a deletion was late.
/// </para>
/// <para>
/// Like the purge worker, this is a timer, a scope and one call, and it must not grow into a job
/// platform. Its safety with several replicas comes from the database: the service claims one run
/// per location under a lease, so every replica may run this loop and only one of them does the work.
/// </para>
/// </remarks>
internal sealed class MediaInventoryReconciliationWorker(
    IServiceScopeFactory scopeFactory,
    IOptions<MediaStorageOptions> storageOptions,
    ILogger<MediaInventoryReconciliationWorker> logger)
    : BackgroundService
{
    private static readonly Action<ILogger, Exception?> LogDisabled =
        LoggerMessage.Define(
            LogLevel.Information,
            new EventId(5523, "MediaInventoryReconciliationDisabled"),
            "Media inventory reconciliation is disabled by configuration.");

    private static readonly Action<ILogger, Guid, string, int, int, int, int, Exception?> LogReconciled =
        LoggerMessage.Define<Guid, string, int, int, int, int>(
            LogLevel.Information,
            new EventId(5524, "MediaInventoryReconciled"),
            "Media inventory run {RunId} is {State}: {ObjectsScanned} objects scanned, {OwnersProbed} owners probed, {FindingsOpened} findings opened, {FindingsResolved} resolved.");

    private static readonly Action<ILogger, Exception?> LogFailed =
        LoggerMessage.Define(
            LogLevel.Error,
            new EventId(5525, "MediaInventoryReconciliationFailed"),
            "The media inventory reconciliation pass failed and will retry on the next tick.");

    private readonly MediaReconciliationOptions options = storageOptions.Value.Reconciliation;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Enabled)
        {
            LogDisabled(logger, null);
            return;
        }

        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(options.IntervalSeconds));
        while (!stoppingToken.IsCancellationRequested)
        {
            // Wait first. Startup is already busy, and a location's inventory is not more correct
            // for having been walked in the first seconds of a deployment.
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
            var service = scope.ServiceProvider
                .GetRequiredService<IMediaInventoryReconciliationService>();
            var outcome = await service.ReconcileAsync(
                options.ObjectsPerRun,
                options.OwnerProbesPerRun,
                stoppingToken);
            if (outcome.RunId is { } runId)
            {
                LogReconciled(
                    logger,
                    runId,
                    outcome.State.ToString(),
                    outcome.ObjectsScanned,
                    outcome.OwnersProbed,
                    outcome.FindingsOpened,
                    outcome.FindingsResolved,
                    null);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Shutdown, not a failure.
        }
        catch (Exception exception)
        {
            // A failed pass must not end the loop. The run keeps its cursors and the next tick
            // resumes it; nothing about the location has been asserted in the meantime.
            LogFailed(logger, exception);
        }
    }
}
