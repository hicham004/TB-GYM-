using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Notifications;
using TB.Gym.Modules.Website;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// Emails the owner about each Talk-to-us request (UI plan R6.2g): the fourth action-mail queue.
/// </summary>
/// <remarks>
/// The workspace-notice dispatcher's sequence without a tenant and without suppression: claim under
/// a lease, count the attempt and commit, send, finalize as materialized, retrying or dead-lettered.
/// The recipient is this deployment's <c>Website:ContactRecipient</c>; while it is empty the sweep
/// claims nothing, so requests wait as pending rather than burning their attempts, and go out the day
/// the address is set. Log lines carry the request id, the attempt number and a code; never the
/// person's name, contact or words.
/// </remarks>
internal sealed class ContactRequestMailService(
    IServiceScopeFactory scopeFactory,
    IClock clock,
    IOptions<ActionMailDispatchOptions> options,
    IOptions<WebsiteOptions> website,
    ILogger<ContactRequestMailService> logger,
    IActionEmailTransport? transport = null)
    : IContactRequestMailDispatchService
{
    private static readonly Action<ILogger, Guid, int, string, Exception?> LogMaterialized =
        LoggerMessage.Define<Guid, int, string>(
            LogLevel.Information,
            new EventId(6191, "ContactRequestMailMaterialized"),
            "Contact request {RequestId} was emailed on attempt {AttemptNumber} through {TransportAdapter}.");

    private static readonly Action<ILogger, Guid, int, string, Exception?> LogRetrying =
        LoggerMessage.Define<Guid, int, string>(
            LogLevel.Warning,
            new EventId(6192, "ContactRequestMailRetrying"),
            "Contact request {RequestId} email attempt {AttemptNumber} failed with {FailureCode} and will retry.");

    private static readonly Action<ILogger, Guid, int, string, Exception?> LogDeadLettered =
        LoggerMessage.Define<Guid, int, string>(
            LogLevel.Error,
            new EventId(6193, "ContactRequestMailDeadLettered"),
            "Contact request {RequestId} email was dead-lettered after {AttemptNumber} attempts with {FailureCode}.");

    private static readonly Action<ILogger, Guid, Exception?> LogReclaimed =
        LoggerMessage.Define<Guid>(
            LogLevel.Warning,
            new EventId(6194, "ContactRequestMailReclaimed"),
            "Contact request {RequestId} email attempt was abandoned when its lease expired.");

    private static readonly Action<ILogger, Exception?> LogNoRecipient =
        LoggerMessage.Define(
            LogLevel.Warning,
            new EventId(6195, "ContactRequestMailNoRecipient"),
            "Contact requests are waiting but Website:ContactRecipient is not set, so none is emailed.");

    private static int noRecipientWarned;

    private readonly ActionMailDispatchOptions settings = options.Value;

    public async Task<ContactRequestMailDispatchOutcome> DispatchDueAsync(CancellationToken cancellationToken)
    {
        if (!settings.SweepEnabled || settings.BatchSize <= 0)
        {
            return new ContactRequestMailDispatchOutcome();
        }

        var recipient = website.Value.ContactRecipient.Trim();
        var now = clock.UtcNow;
        if (recipient.Length == 0)
        {
            await WarnIfWaitingAsync(now, cancellationToken);
            return new ContactRequestMailDispatchOutcome();
        }

        var claim = await ClaimAsync(now, cancellationToken);
        var outcome = claim.Outcome;
        foreach (var work in claim.Work)
        {
            outcome = outcome.Add(await MaterializeAsync(work, recipient, cancellationToken));
        }

        return outcome;
    }

    private async Task WarnIfWaitingAsync(DateTimeOffset now, CancellationToken cancellationToken)
    {
        if (Volatile.Read(ref noRecipientWarned) != 0)
        {
            return;
        }

        await using var scope = scopeFactory.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var waiting = await context.ContactRequests
            .AsNoTracking()
            .AnyAsync(item => item.Status == ContactRequestMailStatus.Pending && item.NextAttemptAtUtc <= now, cancellationToken);
        if (waiting && Interlocked.Exchange(ref noRecipientWarned, 1) == 0)
        {
            LogNoRecipient(logger, null);
        }
    }

    private async Task<ClaimResult> ClaimAsync(DateTimeOffset now, CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        return await context.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
            var limit = settings.BatchSize;
            var candidates = await context.ContactRequests
                .FromSql($"""
                    SELECT *, xmin FROM website."ContactRequests"
                    WHERE (("Status" = 'Pending' AND "NextAttemptAtUtc" <= {now})
                           OR ("Status" = 'Processing' AND "ClaimExpiresAtUtc" IS NOT NULL AND "ClaimExpiresAtUtc" <= {now}))
                    ORDER BY "NextAttemptAtUtc", "Id"
                    LIMIT {limit}
                    FOR UPDATE SKIP LOCKED
                    """)
                .ToListAsync(cancellationToken);

            var outcome = new ContactRequestMailDispatchOutcome();
            var work = new List<ClaimedWork>();
            foreach (var request in candidates)
            {
                if (request.IsClaimExpired(now))
                {
                    request.Abandon(now);
                    LogReclaimed(logger, request.Id, null);
                    outcome = outcome with { Reclaimed = outcome.Reclaimed + 1 };
                }

                if (request.SchemaVersion != ContactRequest.CurrentSchemaVersion ||
                    request.AttemptCount >= settings.MaximumAttempts)
                {
                    request.MarkAttemptsExhausted(now);
                    LogDeadLettered(logger, request.Id, request.AttemptCount, ContactRequestMailCodes.AttemptsExhausted, null);
                    outcome = outcome with { DeadLettered = outcome.DeadLettered + 1 };
                    continue;
                }

                var claimToken = request.Claim(
                    now,
                    TimeSpan.FromSeconds(settings.ClaimLeaseSeconds),
                    settings.MaximumAttempts);
                work.Add(new ClaimedWork(request.Id, claimToken));
                outcome = outcome with { Claimed = outcome.Claimed + 1 };
            }

            await context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return new ClaimResult(outcome, work);
        });
    }

    private async Task<ContactRequestMailDispatchOutcome> MaterializeAsync(
        ClaimedWork work,
        string recipient,
        CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();

        // The attempt is counted and committed before the provider is called, so a crash mid-send
        // leaves evidence that work began and the retry presents a new key.
        var started = await context.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
            var request = await context.ContactRequests
                .SingleOrDefaultAsync(item => item.Id == work.RequestId, cancellationToken);
            if (request is null ||
                request.Status != ContactRequestMailStatus.Processing ||
                request.ClaimToken != work.ClaimToken)
            {
                await transaction.CommitAsync(cancellationToken);
                return Started.Stale;
            }

            var attemptNumber = request.StartAttempt(work.ClaimToken, settings.MaximumAttempts);
            await context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return new Started(attemptNumber, ContactRequestEmailTemplate.Render(request), request.ProviderIdempotencyKey);
        });

        if (started.Attempt == 0 || started.Content is null || started.Key is null)
        {
            return new ContactRequestMailDispatchOutcome();
        }

        FinalOutcome final;
        if (transport is null)
        {
            final = FinalOutcome.Retryable(ContactRequestMailCodes.TransportUnavailable);
        }
        else
        {
            var result = await transport.SendAsync(
                new ActionEmailMessage(
                    ActionMailScopes.ContactRequest,
                    work.RequestId,
                    started.Attempt,
                    started.Key,
                    recipient,
                    started.Content.Subject,
                    started.Content.Body),
                cancellationToken);
            final = Classify(result);
        }

        return await FinalizeAsync(context, work, started.Attempt, final, cancellationToken);
    }

    private static FinalOutcome Classify(ActionEmailTransportResult result) => result.Outcome switch
    {
        ActionEmailTransportOutcome.Captured => FinalOutcome.Success(null),
        ActionEmailTransportOutcome.ProviderAccepted => FinalOutcome.Success(result.ProviderMessageId),
        _ => result.Failure switch
        {
            ResendFailureKind.Unauthorized or
            ResendFailureKind.RateLimited or
            ResendFailureKind.Timeout or
            ResendFailureKind.Unavailable or
            ResendFailureKind.RetryableConflict => FinalOutcome.Retryable(ContactRequestMailCodes.TransportTransient),
            _ => FinalOutcome.Permanent(ContactRequestMailCodes.TransportPermanent),
        },
    };

    private async Task<ContactRequestMailDispatchOutcome> FinalizeAsync(
        GymDbContext context,
        ClaimedWork work,
        int attemptNumber,
        FinalOutcome final,
        CancellationToken cancellationToken)
    {
        var kind = await context.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
            var now = clock.UtcNow;
            var request = await context.ContactRequests
                .SingleOrDefaultAsync(item => item.Id == work.RequestId, cancellationToken);
            if (request is null ||
                request.Status != ContactRequestMailStatus.Processing ||
                request.ClaimToken != work.ClaimToken)
            {
                await transaction.CommitAsync(cancellationToken);
                return Final.Stale;
            }

            Final result;
            if (final.IsSuccess)
            {
                request.MarkMaterialized(work.ClaimToken, now, transport!.AdapterName, final.ProviderMessageId);
                result = Final.Materialized;
            }
            else if (final.IsRetryable &&
                     ContactRequestMailRetryPolicy.NextAttemptAtUtc(attemptNumber, settings.MaximumAttempts, now)
                         is { } nextAttemptAtUtc)
            {
                request.MarkRetrying(work.ClaimToken, nextAttemptAtUtc, final.FailureCode!);
                result = Final.Retried;
            }
            else
            {
                request.MarkDeadLettered(work.ClaimToken, now, final.FailureCode!);
                result = Final.DeadLettered;
            }

            await context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return result;
        });

        switch (kind)
        {
            case Final.Materialized:
                LogMaterialized(logger, work.RequestId, attemptNumber, transport!.AdapterName, null);
                return new ContactRequestMailDispatchOutcome(Materialized: 1);
            case Final.Retried:
                LogRetrying(logger, work.RequestId, attemptNumber, final.FailureCode!, null);
                return new ContactRequestMailDispatchOutcome(Retried: 1);
            case Final.DeadLettered:
                LogDeadLettered(logger, work.RequestId, attemptNumber, final.FailureCode!, null);
                return new ContactRequestMailDispatchOutcome(DeadLettered: 1);
            default:
                return new ContactRequestMailDispatchOutcome();
        }
    }

    private sealed record ClaimedWork(Guid RequestId, Guid ClaimToken);

    /// <summary>A counted attempt and the rendered email, or nothing when the claim went stale.</summary>
    private sealed record Started(int Attempt, ContactRequestEmailContent? Content, string? Key)
    {
        public static Started Stale { get; } = new(0, null, null);
    }

    private sealed record ClaimResult(ContactRequestMailDispatchOutcome Outcome, IReadOnlyList<ClaimedWork> Work);

    private enum Final
    {
        Stale,
        Materialized,
        Retried,
        DeadLettered,
    }

    private sealed record FinalOutcome(bool IsSuccess, bool IsRetryable, string? FailureCode, string? ProviderMessageId)
    {
        public static FinalOutcome Success(string? providerMessageId) => new(true, false, null, providerMessageId);

        public static FinalOutcome Retryable(string failureCode) => new(false, true, failureCode, null);

        public static FinalOutcome Permanent(string failureCode) => new(false, false, failureCode, null);
    }
}
