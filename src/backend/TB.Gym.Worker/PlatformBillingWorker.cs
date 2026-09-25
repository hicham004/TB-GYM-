using Microsoft.Extensions.Options;
using TB.Gym.Infrastructure.Application;
using TB.Gym.Modules.PlatformBilling;
using TB.Gym.SharedKernel;

namespace TB.Gym.Worker;

/// <summary>
/// Issues last month's platform invoices and queues payment reminders on a fixed interval (ADR 0028).
/// </summary>
/// <remarks>
/// There is no "run on the 1st" schedule: every tick asks for the previous month's invoices, and the
/// unique index on one original invoice per workspace and month turns every tick after the first into a
/// check. So a Worker that was down on the 1st catches up on its next start, and two Workers cannot
/// bill twice. The emails themselves go out through the workspace notice queue, which the action-mail
/// sweep drains.
/// </remarks>
public sealed class PlatformBillingWorker(
    IServiceScopeFactory scopeFactory,
    IClock clock,
    IOptions<PlatformBillingOptions> options,
    ILogger<PlatformBillingWorker> logger)
    : BackgroundService
{
    private static readonly Action<ILogger, Exception?> LogDisabled =
        LoggerMessage.Define(
            LogLevel.Information,
            new EventId(6201, "PlatformBillingSweepDisabled"),
            "The platform billing sweep is disabled by configuration.");

    private static readonly Action<ILogger, string, int, int, int, Exception?> LogIssued =
        LoggerMessage.Define<string, int, int, int>(
            LogLevel.Information,
            new EventId(6202, "PlatformBillingInvoicesIssued"),
            "Platform invoices for {Month}: {Issued} issued, {AlreadyIssued} already issued, {InTrial} in trial.");

    private static readonly Action<ILogger, int, Exception?> LogReminders =
        LoggerMessage.Define<int>(
            LogLevel.Information,
            new EventId(6203, "PlatformBillingRemindersQueued"),
            "Queued {Count} platform billing reminders.");

    private static readonly Action<ILogger, Exception?> LogSweepFailed =
        LoggerMessage.Define(
            LogLevel.Error,
            new EventId(6204, "PlatformBillingSweepFailed"),
            "The platform billing sweep failed and will retry on the next tick.");

    private readonly PlatformBillingOptions settings = options.Value;

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
            var run = scope.ServiceProvider.GetRequiredService<IPlatformInvoiceRun>();
            var month = BillingMonth.Containing(clock.UtcNow).Previous();
            var outcome = await run.IssueForMonthAsync(month, stoppingToken);
            if (outcome.Issued > 0)
            {
                LogIssued(logger, month.ToString(), outcome.Issued, outcome.AlreadyIssued, outcome.InTrial, null);
            }

            var reminders = await run.QueueRemindersAsync(stoppingToken);
            if (reminders > 0)
            {
                LogReminders(logger, reminders, null);
            }
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
