using System.Globalization;
using Microsoft.Extensions.Options;
using TB.Gym.Infrastructure.Application;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Invitations;

namespace TB.Gym.Worker;

/// <summary>
/// Sweeps both action-mail queues on a fixed interval.
/// </summary>
/// <remarks>
/// One loop, two queues, deliberately. Global account mail and tenant-owned invitation mail have
/// different owners, different authorization and different tables, and nothing about one may reach the
/// other — but they are the same <i>kind</i> of work on the same schedule, and a second process to run
/// a second timer would be ceremony rather than isolation. Each queue is drained by its own service in
/// its own scopes and its own transactions; this class only decides when.
/// <para>
/// It is separate from <see cref="NotificationDispatchWorker"/> for the opposite reason: a commercial
/// notification and a password-reset link have genuinely different urgency, different retry schedules
/// and different failure consequences, and sharing a sweep would make one queue's backlog the other's
/// latency.
/// </para>
/// <para>
/// It sweeps immediately on start rather than waiting a first interval, because a deployment replacing
/// the previous worker may be inheriting expired leases, and somebody is waiting for a confirmation
/// link. Ticks never overlap, and a failed sweep never ends the loop: an unavailable database, or a
/// schema not yet migrated because migrations are a separate deployment step, are both expected states
/// for a worker that starts beside its database.
/// </para>
/// </remarks>
public sealed class ActionMailDispatchWorker(
    IServiceScopeFactory scopeFactory,
    IOptions<ActionMailDispatchOptions> options,
    ILogger<ActionMailDispatchWorker> logger)
    : BackgroundService
{
    private static readonly Action<ILogger, Exception?> LogDisabled =
        LoggerMessage.Define(
            LogLevel.Information,
            new EventId(6011, "ActionMailDispatchDisabled"),
            "Action mail dispatch is disabled by configuration.");

    private static readonly Action<ILogger, int, Exception?> LogStarted =
        LoggerMessage.Define<int>(
            LogLevel.Information,
            new EventId(6012, "ActionMailDispatchStarted"),
            "Action mail dispatch is sweeping every {PollIntervalSeconds} seconds.");

    // Counted per request, and named for what actually happened. "Materialized" means a token was
    // minted, a link was built from the configured origin and the transport took the message; it is not
    // a claim that anything was delivered or read.
    private static readonly Action<ILogger, string, int, string, Exception?> LogSwept =
        LoggerMessage.Define<string, int, string>(
            LogLevel.Information,
            new EventId(6013, "ActionMailDispatchSwept"),
            "Action mail sweep of the {Queue} queue claimed {Claimed} requests: {Outcome}.");

    private static readonly Action<ILogger, Exception?> LogSweepFailed =
        LoggerMessage.Define(
            LogLevel.Error,
            new EventId(6014, "ActionMailDispatchSweepFailed"),
            "The action mail sweep failed and will retry on the next tick.");

    private readonly ActionMailDispatchOptions settings = options.Value;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!settings.SweepEnabled)
        {
            LogDisabled(logger, null);
            return;
        }

        LogStarted(logger, settings.PollIntervalSeconds, null);
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(settings.PollIntervalSeconds));

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

            var account = await scope.ServiceProvider
                .GetRequiredService<IAccountActionMailDispatchService>()
                .DispatchDueAsync(stoppingToken);
            if (account.Total > 0)
            {
                LogSwept(
                    logger,
                    ActionMailScopes.Account,
                    account.Claimed,
                    string.Create(
                        CultureInfo.InvariantCulture,
                        $"{account.Materialized} materialized, {account.Suppressed} suppressed, {account.Retried} retrying, {account.DeadLettered} dead-lettered, {account.Reclaimed} reclaimed"),
                    null);
            }

            var invitation = await scope.ServiceProvider
                .GetRequiredService<IInvitationActionMailDispatchService>()
                .DispatchDueAsync(stoppingToken);
            if (invitation.Total > 0)
            {
                LogSwept(
                    logger,
                    ActionMailScopes.Invitation,
                    invitation.Claimed,
                    string.Create(
                        CultureInfo.InvariantCulture,
                        $"{invitation.Materialized} materialized, {invitation.Suppressed} suppressed, {invitation.Retried} retrying, {invitation.DeadLettered} dead-lettered, {invitation.Reclaimed} reclaimed"),
                    null);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Shutdown, not a failure.
        }
        catch (Exception exception)
        {
            // The exception object is attached because it can only have come from this repository's own
            // code or from Npgsql. The provider adapter classifies every one of its own failures into a
            // stable code and never throws, precisely so that nothing carrying a response body, a
            // recipient address or a credential can reach this line.
            LogSweepFailed(logger, exception);
        }
    }
}
