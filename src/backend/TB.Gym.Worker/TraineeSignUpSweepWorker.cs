using Microsoft.Extensions.Options;
using TB.Gym.Modules.Tenancy;

namespace TB.Gym.Worker;

/// <summary>
/// Removes the house's sign-ups whose email was never confirmed, once an hour (CLI-025, notes plan N9a1), so a
/// name, an email and a date of birth somebody typed are not kept for an account nobody ever claimed.
/// </summary>
/// <remarks>
/// Like the other sweeps it runs once at start and then on every tick: a Worker that was down catches up on its
/// next start, and a second Worker finds nothing left, since each sign-up is removed under its own row lock.
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
            "The trainee sign-up sweep is disabled by configuration.");

    private static readonly Action<ILogger, Exception?> LogSweepFailed =
        LoggerMessage.Define(
            LogLevel.Error,
            new EventId(6406, "TraineeSignUpSweepFailed"),
            "The trainee sign-up sweep failed and will retry on the next tick.");

    private readonly TraineeSignUpOptions settings = options.Value;

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
            // The sweep logs its own counts; it never logs who signed up.
            await scope.ServiceProvider.GetRequiredService<ITraineeSignUpSweep>().RunAsync(stoppingToken);
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
