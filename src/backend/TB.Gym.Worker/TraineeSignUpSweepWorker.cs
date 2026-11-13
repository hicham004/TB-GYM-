using Microsoft.Extensions.Options;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.Modules.Tenancy;

namespace TB.Gym.Worker;

/// <summary>
/// The house's hourly sweeps. It removes the house's sign-ups whose email was never confirmed (CLI-025, notes plan
/// N9a1), so a name, an email and a date of birth somebody typed are not kept for an account nobody ever claimed;
/// and it renews Free before a trainee's row ends, or starts it for one who has none (SUB-019, notes plan N9b1).
/// </summary>
/// <remarks>
/// Like the other sweeps it runs once at start and then on every tick: a Worker that was down catches up on its
/// next start, and a second Worker finds nothing left, since each sign-up is removed under its own row lock and each
/// Free row is written once under the house's lock and its own command id. One sweep failing leaves the other.
/// <c>TraineeSignUps:SweepEnabled</c> switches off the sign-up sweep alone: Free's renewal is a promise the house keeps
/// (SUB-019), so it runs on every tick whatever that switch says.
/// </remarks>
public sealed class TraineeSignUpSweepWorker(
    IServiceScopeFactory scopeFactory,
    IOptions<TraineeSignUpOptions> options,
    ILogger<TraineeSignUpSweepWorker> logger)
    : BackgroundService
{
    private static readonly Action<ILogger, Exception?> LogDisabled =
        LoggerMessage.Define(
            LogLevel.Information,
            new EventId(6405, "TraineeSignUpSweepDisabled"),
            "The trainee sign-up sweep is disabled by configuration. Free's renewal still runs on every tick.");

    private static readonly Action<ILogger, Exception?> LogSweepFailed =
        LoggerMessage.Define(
            LogLevel.Error,
            new EventId(6406, "TraineeSignUpSweepFailed"),
            "The trainee sign-up sweep failed and will retry on the next tick.");

    private static readonly Action<ILogger, Exception?> LogFreePlanSweepFailed =
        LoggerMessage.Define(
            LogLevel.Error,
            new EventId(6414, "HouseFreePlanSweepFailed"),
            "The Free plan sweep failed and will retry on the next tick.");

    private readonly TraineeSignUpOptions settings = options.Value;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!settings.SweepEnabled)
        {
            LogDisabled(logger, null);
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
        // Each sweep logs its own counts; neither logs who signed up or trains.
        if (settings.SweepEnabled)
        {
            await RunSweepAsync<ITraineeSignUpSweep>(
                (sweep, cancellationToken) => sweep.RunAsync(cancellationToken),
                LogSweepFailed,
                stoppingToken);
        }

        await RunSweepAsync<IHouseFreePlanRenewal>(
            (sweep, cancellationToken) => sweep.RunAsync(cancellationToken),
            LogFreePlanSweepFailed,
            stoppingToken);
    }

    private async Task RunSweepAsync<TSweep>(
        Func<TSweep, CancellationToken, Task> run,
        Action<ILogger, Exception?> logFailure,
        CancellationToken stoppingToken)
        where TSweep : notnull
    {
        try
        {
            await using var scope = scopeFactory.CreateAsyncScope();
            await run(scope.ServiceProvider.GetRequiredService<TSweep>(), stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Shutdown, not a failure.
        }
        catch (Exception exception)
        {
            // An unavailable database or a schema not migrated yet are expected states at startup.
            logFailure(logger, exception);
        }
    }
}
