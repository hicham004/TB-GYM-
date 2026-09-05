using System.Globalization;
using Microsoft.Extensions.Options;
using TB.Gym.Modules.Notifications;

namespace TB.Gym.Worker;

/// <summary>
/// Sweeps the notification outbox on a fixed interval.
/// </summary>
/// <remarks>
/// The loop is deliberately the smallest thing that works: a timer, a scope, one call. Everything
/// that makes dispatch safe lives in the database and in
/// <see cref="INotificationDispatchService"/> — claim leases, <c>FOR UPDATE SKIP LOCKED</c>, the
/// durable retry schedule, the atomic materialization — which is why several replicas of this
/// process may run at once and none of them needs to coordinate with the others.
/// <para>
/// It sweeps immediately on start rather than waiting a first interval, because a deployment that
/// has just replaced the previous worker may be inheriting expired leases, and a due notification
/// should not wait on a deployment. Ticks never overlap: <c>PeriodicTimer</c> is awaited after the
/// sweep completes, so a slow sweep delays the next one instead of running beside it.
/// </para>
/// <para>
/// A failed sweep never ends the loop. A database that is unavailable, or a schema that has not been
/// migrated yet because migrations are a separate deployment step, are both expected states for a
/// worker that starts beside its database: the rows are still due, and the next tick tries again.
/// </para>
/// </remarks>
public sealed class NotificationDispatchWorker(
    IServiceScopeFactory scopeFactory,
    IOptions<NotificationDispatchOptions> options,
    ILogger<NotificationDispatchWorker> logger)
    : BackgroundService
{
    private static readonly Action<ILogger, Exception?> LogDisabled =
        LoggerMessage.Define(
            LogLevel.Information,
            new EventId(6001, "NotificationDispatchDisabled"),
            "Notification dispatch is disabled by configuration.");

    private static readonly Action<ILogger, int, Exception?> LogStarted =
        LoggerMessage.Define<int>(
            LogLevel.Information,
            new EventId(6002, "NotificationDispatchStarted"),
            "Notification dispatch is sweeping every {PollIntervalSeconds} seconds.");

    // Counted per channel delivery, and named for what actually happened. "Materialized" means an
    // inbox row was written or a message was taken by the configured transport; it is not a claim that
    // a provider accepted anything or that a person read it. "Deferred" is quiet hours, which costs no
    // attempt. The six counters are formatted into one field because Define takes at most six type
    // arguments, and splitting them across two lines would leave an operator correlating them.
    private static readonly Action<ILogger, int, string, Exception?> LogSwept =
        LoggerMessage.Define<int, string>(
            LogLevel.Information,
            new EventId(6003, "NotificationDispatchSwept"),
            "Notification sweep claimed {Claimed} channel deliveries: {Outcome}.");

    private static readonly Action<ILogger, Exception?> LogSweepFailed =
        LoggerMessage.Define(
            LogLevel.Error,
            new EventId(6004, "NotificationDispatchSweepFailed"),
            "The notification sweep failed and will retry on the next tick.");

    private readonly NotificationDispatchOptions settings = options.Value;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!settings.Enabled)
        {
            LogDisabled(logger, null);
            return;
        }

        LogStarted(logger, settings.PollIntervalSeconds, null);
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(settings.PollIntervalSeconds));

        // One immediate sweep, then wait between sweeps. A restart may be inheriting leases that
        // expired while the previous process was down.
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
            var service = scope.ServiceProvider.GetRequiredService<INotificationDispatchService>();
            var outcome = await service.DispatchDueAsync(stoppingToken);
            if (outcome.Total > 0)
            {
                LogSwept(
                    logger,
                    outcome.Claimed,
                    string.Create(
                        CultureInfo.InvariantCulture,
                        $"{outcome.Materialized} materialized, {outcome.Suppressed} suppressed, {outcome.Retried} retrying, {outcome.DeadLettered} dead-lettered, {outcome.Reclaimed} reclaimed, {outcome.Deferred} deferred"),
                    null);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Shutdown, not a failure.
        }
        catch (Exception exception)
        {
            // The exception object is attached because it can only have come from this repository's
            // own code or from Npgsql: this slice contacts no external provider, so no untrusted
            // response body or credential can be inside it. When a provider adapter is added, its
            // failures must be classified into a stable code and logged without the exception.
            LogSweepFailed(logger, exception);
        }
    }
}
