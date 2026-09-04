using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using TB.Gym.Modules.Messaging;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// Sweeps the realtime outbox on a fixed interval, inside the API host.
/// </summary>
/// <remarks>
/// It lives in the API and not in the Worker because publishing needs <c>IHubContext</c>, and an
/// <c>IHubContext</c> is only useful in a process that has connections or a backplane to reach them
/// through. Giving the notification Worker a hub context would mean giving a background process an
/// HTTP surface, a listener and a Redis dependency it exists precisely not to have.
/// <para>
/// The loop is the smallest thing that works: a timer, a scope, one call. Everything that makes
/// publication safe with several API replicas lives in the database and in
/// <see cref="IMessagingRealtimeDispatchService"/> — claim leases, <c>FOR UPDATE SKIP LOCKED</c>, the
/// durable retry schedule, the re-authorization before materialization — which is why replicas need
/// no coordination with each other.
/// </para>
/// <para>
/// A failed sweep never ends the loop. An unavailable database, a schema that has not been migrated
/// yet, and an unreachable backplane are all states this process starts beside; the rows are still
/// there, and the next tick tries again.
/// </para>
/// <para>
/// Public so an integration fixture can name the type it removes. Those tests drive the sweep
/// explicitly, and a background tick racing an assertion about what one sweep did would make the
/// suite flaky rather than deterministic.
/// </para>
/// </remarks>
public sealed class MessagingRealtimeWorker(
    IServiceScopeFactory scopeFactory,
    IOptions<MessagingRealtimeOptions> options,
    ILogger<MessagingRealtimeWorker> logger)
    : BackgroundService
{
    private static readonly Action<ILogger, Exception?> LogDisabled =
        LoggerMessage.Define(
            LogLevel.Information,
            new EventId(6210, "MessagingRealtimeDispatchDisabled"),
            "Realtime messaging dispatch is disabled by configuration. Messages are still persisted, and clients reconcile through catch-up.");

    private static readonly Action<ILogger, int, string, int, Exception?> LogStarted =
        LoggerMessage.Define<int, string, int>(
            LogLevel.Information,
            new EventId(6211, "MessagingRealtimeDispatchStarted"),
            "Realtime messaging dispatch is sweeping every {PollIntervalSeconds} seconds in {ScaleOut} mode across {ApiReplicaCount} declared API replicas.");

    private static readonly Action<ILogger, int, int, int, int, int, int, Exception?> LogSwept =
        LoggerMessage.Define<int, int, int, int, int, int>(
            LogLevel.Information,
            new EventId(6212, "MessagingRealtimeSwept"),
            "Realtime sweep claimed {Claimed}: {Published} published, {Suppressed} suppressed, {Retried} retrying, {DeadLettered} dead-lettered, {Reclaimed} reclaimed.");

    private static readonly Action<ILogger, Exception?> LogSweepFailed =
        LoggerMessage.Define(
            LogLevel.Error,
            new EventId(6213, "MessagingRealtimeSweepFailed"),
            "The realtime messaging sweep failed and will retry on the next tick.");

    private readonly MessagingRealtimeOptions settings = options.Value;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!settings.Enabled)
        {
            LogDisabled(logger, null);
            return;
        }

        // The scale-out mode and the replica count, and deliberately nothing about the backplane
        // endpoint. A connection string in a startup line is a credential in a log file.
        LogStarted(
            logger,
            settings.PollIntervalSeconds,
            settings.ScaleOut.ToString(),
            settings.ApiReplicaCount,
            null);
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(settings.PollIntervalSeconds));

        // One immediate sweep, then wait between sweeps. A restarted replica may be inheriting leases
        // that expired while it was down.
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
            var service = scope.ServiceProvider.GetRequiredService<IMessagingRealtimeDispatchService>();
            var outcome = await service.DispatchDueAsync(stoppingToken);
            if (outcome.Total > 0)
            {
                LogSwept(
                    logger,
                    outcome.Claimed,
                    outcome.Published,
                    outcome.Suppressed,
                    outcome.Retried,
                    outcome.DeadLettered,
                    outcome.Reclaimed,
                    null);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Shutdown, not a failure.
        }
        catch (Exception exception)
        {
            // One poisoned row, an unmigrated schema or an unreachable backplane must not end the
            // service. The exception object is attached because everything reachable from here is
            // this repository's own code, Npgsql or the SignalR lifetime manager — no external
            // provider response and no credential passes through this path.
            LogSweepFailed(logger, exception);
        }
    }
}
