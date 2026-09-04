using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Messaging;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>What one sweep of the realtime outbox did.</summary>
public readonly record struct MessagingRealtimeDispatchOutcome(
    int Claimed,
    int Published,
    int Suppressed,
    int Retried,
    int DeadLettered,
    int Reclaimed)
{
    public static MessagingRealtimeDispatchOutcome Empty { get; }

    public int Total => Claimed + Published + Suppressed + Retried + DeadLettered + Reclaimed;

    public MessagingRealtimeDispatchOutcome Add(MessagingRealtimeDispatchOutcome other) => new(
        Claimed + other.Claimed,
        Published + other.Published,
        Suppressed + other.Suppressed,
        Retried + other.Retried,
        DeadLettered + other.DeadLettered,
        Reclaimed + other.Reclaimed);
}

public interface IMessagingRealtimeDispatchService
{
    Task<MessagingRealtimeDispatchOutcome> DispatchDueAsync(CancellationToken cancellationToken);
}

/// <summary>
/// Deterministic checkpoints the concurrency tests arm. A no-op everywhere else.
/// </summary>
/// <remarks>
/// Two of the failures this phase has to prove — a claim that commits and is then overtaken by an
/// authoritative change, and a crash after the hub accepted a frame but before the row was finalized
/// — only exist in the window between two commits. A test that tried to hit that window with a sleep
/// would be a coin toss; these make the interleaving the assertion depends on the one that actually
/// happens.
/// </remarks>
public interface IMessagingRealtimeDispatchCheckpoint
{
    Task AfterClaimCommittedAsync(Guid tenantId, Guid recipientId, Guid claimToken, CancellationToken cancellationToken);

    Task AfterPublishedBeforeFinalizeAsync(Guid tenantId, Guid recipientId, Guid claimToken, CancellationToken cancellationToken);
}

internal sealed class NoOpMessagingRealtimeDispatchCheckpoint : IMessagingRealtimeDispatchCheckpoint
{
    public Task AfterClaimCommittedAsync(Guid tenantId, Guid recipientId, Guid claimToken, CancellationToken cancellationToken) =>
        Task.CompletedTask;

    public Task AfterPublishedBeforeFinalizeAsync(Guid tenantId, Guid recipientId, Guid claimToken, CancellationToken cancellationToken) =>
        Task.CompletedTask;
}

/// <summary>
/// Turns durable realtime events into hub frames, at least once, for each authorized participant.
/// </summary>
/// <remarks>
/// The sweep has the same two halves Phase 6B-1 proved for notifications, for the same reasons.
/// <para>
/// <b>Claiming</b> happens in one short transaction per workspace. Due rows are locked with
/// <c>FOR UPDATE SKIP LOCKED</c>, so several API replicas may sweep at once and step over each
/// other's rows instead of blocking on them or publishing them twice. Inside that transaction an
/// expired lease has its unfinished attempt marked abandoned, eligibility is re-established, a random
/// claim token and a lease are written, and an attempt row is started. Nothing leaves the process
/// while the transaction is open.
/// </para>
/// <para>
/// <b>Publication</b> happens afterwards, per row, in its own scope. It re-establishes current
/// authorization first — membership, platform block, relationship block, explicit participation and
/// the Messaging decision, all read from PostgreSQL in a fresh tenant scope — and only then loads the
/// projection and sends. A committed claim is a lease, not permission to deliver stale state to
/// somebody who has since lost access, and the connection groups are no help here at all: they are
/// routing, they survive revocation, and they cannot be counted or trusted across replicas.
/// </para>
/// <para>
/// <b>Delivery is deliberately at least once.</b> If this process dies after the hub accepted a frame
/// and before the row is finalized, the lease expires, another replica reclaims it and publishes
/// again. That is the trade this design chooses: a duplicate the client deduplicates by event
/// identity is harmless, and silent loss is not. Nothing here claims exactly-once network delivery,
/// and <c>Published</c> is never called <c>Delivered</c>.
/// </para>
/// <para>
/// <b>Nothing sensitive is logged.</b> Every line carries opaque identifiers, the event kind, an
/// attempt number and a stable outcome code. No body, no revision, no moderation reason, no
/// recipient, no workspace or conversation identifier, no Redis endpoint, no exception object.
/// </para>
/// </remarks>
internal sealed class MessagingRealtimeDispatchService(
    GymDbContext dbContext,
    IServiceScopeFactory scopeFactory,
    IHubContext<ChatHub, IMessagingRealtimeClient> hubContext,
    IClock clock,
    IOptions<MessagingRealtimeOptions> options,
    ILogger<MessagingRealtimeDispatchService> logger,
    IMessagingRealtimeDispatchCheckpoint checkpoint)
    : IMessagingRealtimeDispatchService
{
    // Work identity, kind, attempt number and a stable code. An operator needs to know which unit of
    // work behaved how, not who it was for or what it said.
    private static readonly Action<ILogger, Guid, string, int, Exception?> LogPublished =
        LoggerMessage.Define<Guid, string, int>(
            LogLevel.Information,
            new EventId(6201, "MessagingRealtimePublished"),
            "Realtime publication {RecipientId} ({Kind}) was accepted by the hub on attempt {AttemptNumber}.");

    private static readonly Action<ILogger, Guid, string, string, Exception?> LogSuppressed =
        LoggerMessage.Define<Guid, string, string>(
            LogLevel.Information,
            new EventId(6202, "MessagingRealtimeSuppressed"),
            "Realtime publication {RecipientId} ({Kind}) was suppressed with {FailureCode}.");

    private static readonly Action<ILogger, Guid, string, int, string, Exception?> LogRetrying =
        LoggerMessage.Define<Guid, string, int, string>(
            LogLevel.Warning,
            new EventId(6203, "MessagingRealtimeRetrying"),
            "Realtime publication {RecipientId} ({Kind}) failed attempt {AttemptNumber} with {FailureCode} and will be retried.");

    private static readonly Action<ILogger, Guid, string, int, string, Exception?> LogDeadLettered =
        LoggerMessage.Define<Guid, string, int, string>(
            LogLevel.Error,
            new EventId(6204, "MessagingRealtimeDeadLettered"),
            "Realtime publication {RecipientId} ({Kind}) was dead-lettered after {AttemptNumber} attempts with {FailureCode}.");

    private static readonly Action<ILogger, Guid, int, Exception?> LogReclaimed =
        LoggerMessage.Define<Guid, int>(
            LogLevel.Warning,
            new EventId(6205, "MessagingRealtimeClaimReclaimed"),
            "Realtime publication {RecipientId} had an expired claim; attempt {AttemptNumber} was abandoned.");

    private readonly MessagingRealtimeOptions settings = options.Value;

    public async Task<MessagingRealtimeDispatchOutcome> DispatchDueAsync(CancellationToken cancellationToken)
    {
        if (!settings.Enabled || settings.BatchSize <= 0)
        {
            return MessagingRealtimeDispatchOutcome.Empty;
        }

        var now = clock.UtcNow;

        // The only cross-workspace read in the sweep, and it is read-only. Workspaces are ordered by
        // how long their oldest due work has waited, so a continuously busy workspace cannot starve
        // an older waiter, and the ordering is durable state rather than a process-local cursor.
        var tenantIds = await DueRows(dbContext, now)
            .GroupBy(row => row.TenantId)
            .Select(group => new
            {
                TenantId = group.Key,
                EffectiveDueAtUtc = group.Min(row =>
                    row.Status == MessagingRealtimeStatus.Pending
                        ? row.NextAttemptAtUtc
                        : row.ClaimExpiresAtUtc!.Value),
            })
            .OrderBy(workspace => workspace.EffectiveDueAtUtc)
            .ThenBy(workspace => workspace.TenantId)
            .Select(workspace => workspace.TenantId)
            .Take(settings.BatchSize)
            .ToListAsync(cancellationToken);
        if (tenantIds.Count == 0)
        {
            return MessagingRealtimeDispatchOutcome.Empty;
        }

        // The batch cap is global. Each selected workspace gets an equal first share, and a later
        // round redistributes capacity a workspace could not use without ever raising the one budget:
        // a per-workspace cap multiplied by the number of workspaces is not a bound.
        var activeTenantIds = tenantIds;
        var remaining = settings.BatchSize;
        var outcome = MessagingRealtimeDispatchOutcome.Empty;
        while (remaining > 0 && activeTenantIds.Count > 0)
        {
            var share = Math.Max(1, remaining / activeTenantIds.Count);
            var nextRound = new List<Guid>(activeTenantIds.Count);
            foreach (var tenantId in activeTenantIds)
            {
                if (remaining <= 0)
                {
                    break;
                }

                var limit = Math.Min(share, remaining);
                var claimed = await ClaimForTenantAsync(tenantId, now, limit, cancellationToken);
                outcome = outcome.Add(claimed.Outcome);
                remaining -= claimed.Consumed;

                foreach (var work in claimed.Work)
                {
                    // The claim has committed before this returns. Tests replace this no-op with a
                    // barrier and commit an authoritative change here, while the durable claim is
                    // visible and nothing has yet been sent.
                    await checkpoint.AfterClaimCommittedAsync(
                        work.TenantId,
                        work.RecipientId,
                        work.ClaimToken,
                        cancellationToken);
                    outcome = outcome.Add(await PublishAsync(work, cancellationToken));
                }

                if (claimed.Consumed == limit && remaining > 0)
                {
                    nextRound.Add(tenantId);
                }
            }

            activeTenantIds = nextRound;
        }

        return outcome;
    }

    /// <summary>
    /// Everything a sweep may act on: due Pending work, and Processing work whose lease has run out.
    /// The second half is what stops one crashed replica hiding a frame for ever.
    /// </summary>
    private static IQueryable<MessagingRealtimeRecipient> DueRows(GymDbContext context, DateTimeOffset now) =>
        context.MessagingRealtimeRecipients
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(row =>
                (row.Status == MessagingRealtimeStatus.Pending && row.NextAttemptAtUtc <= now) ||
                (row.Status == MessagingRealtimeStatus.Processing &&
                 row.ClaimExpiresAtUtc != null &&
                 row.ClaimExpiresAtUtc <= now));

    private async Task<ClaimResult> ClaimForTenantAsync(
        Guid tenantId,
        DateTimeOffset now,
        int limit,
        CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var provider = scope.ServiceProvider;
        provider.GetRequiredService<IMutableTenantContext>().SetTenant(tenantId);
        var context = provider.GetRequiredService<GymDbContext>();

        return await context.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);

            // Deterministic order, so two replicas sweeping the same workspace walk the backlog the
            // same way and SKIP LOCKED simply divides it between them rather than making them fight
            // over the head of the queue.
            var candidates = await context.MessagingRealtimeRecipients
                .FromSql($"""
                    SELECT *, xmin FROM messaging."RealtimeRecipients"
                    WHERE "TenantId" = {tenantId}
                      AND (("Status" = 'Pending' AND "NextAttemptAtUtc" <= {now})
                           OR ("Status" = 'Processing' AND "ClaimExpiresAtUtc" IS NOT NULL AND "ClaimExpiresAtUtc" <= {now}))
                    ORDER BY "NextAttemptAtUtc", "Id"
                    LIMIT {limit}
                    FOR UPDATE SKIP LOCKED
                    """)
                .ToListAsync(cancellationToken);

            var outcome = MessagingRealtimeDispatchOutcome.Empty;
            var work = new List<ClaimedWork>();
            foreach (var row in candidates)
            {
                if (await AbandonExpiredAttemptAsync(context, row, now, cancellationToken))
                {
                    outcome = outcome with { Reclaimed = outcome.Reclaimed + 1 };
                }

                var source = await context.MessagingRealtimeEvents
                    .AsNoTracking()
                    .SingleOrDefaultAsync(item => item.Id == row.RealtimeEventId, cancellationToken);
                if (source is null)
                {
                    // Realtime events are append-only and never deleted, so this is an inconsistency
                    // rather than a race. Retrying cannot fix a row whose event is gone.
                    row.SuppressBeforeClaim(now, MessagingRealtimeFailureCodes.AggregateMismatch);
                    outcome = outcome with { Suppressed = outcome.Suppressed + 1 };
                    continue;
                }

                // Every increment represents a durably started attempt, including an abandoned one.
                // Once the count reaches the configured maximum, this closes the row using the real
                // last attempt already in history; it never manufactures attempt maximum + 1.
                if (row.AttemptCount >= settings.MaximumAttempts)
                {
                    row.MarkAttemptsExhausted(now);
                    LogDeadLettered(
                        logger,
                        row.Id,
                        source.Kind.ToString(),
                        row.AttemptCount,
                        MessagingRealtimeFailureCodes.AttemptsExhausted,
                        null);
                    outcome = outcome with { DeadLettered = outcome.DeadLettered + 1 };
                    continue;
                }

                var claimToken = row.Claim(
                    now,
                    TimeSpan.FromSeconds(settings.ClaimLeaseSeconds),
                    settings.MaximumAttempts);
                var attempt = MessagingRealtimeAttempt.Start(
                    tenantId,
                    row.Id,
                    row.AttemptCount,
                    claimToken,
                    now);
                context.MessagingRealtimeAttempts.Add(attempt);

                work.Add(new ClaimedWork(
                    tenantId,
                    row.Id,
                    row.ConversationId,
                    row.RecipientUserId,
                    source.Id,
                    source.Kind,
                    source.EventSequence,
                    source.MessageId,
                    source.OccurredAtUtc,
                    claimToken,
                    attempt.Id,
                    row.AttemptCount));
                outcome = outcome with { Claimed = outcome.Claimed + 1 };
            }

            await context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return new ClaimResult(outcome, work, candidates.Count);
        });
    }

    /// <summary>
    /// A lease that expired leaves evidence before it is replaced: its unfinished attempt is marked
    /// abandoned, so the history shows a try that was interrupted rather than a number that silently
    /// went missing.
    /// </summary>
    private async Task<bool> AbandonExpiredAttemptAsync(
        GymDbContext context,
        MessagingRealtimeRecipient row,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        if (!row.IsClaimExpired(now) || row.ClaimToken is not { } expiredToken)
        {
            return false;
        }

        var unfinished = await context.MessagingRealtimeAttempts
            .Where(attempt =>
                attempt.RecipientId == row.Id &&
                attempt.ClaimToken == expiredToken &&
                attempt.Outcome == MessagingRealtimeOutcome.Started)
            .ToListAsync(cancellationToken);
        foreach (var attempt in unfinished)
        {
            attempt.Abandon(now, MessagingRealtimeFailureCodes.ClaimExpired);
            LogReclaimed(logger, row.Id, attempt.AttemptNumber, null);
        }

        return true;
    }

    /// <summary>
    /// Re-authorizes, materializes, sends, and only then finalizes.
    /// </summary>
    /// <remarks>
    /// The order is the point. Authorization is re-read before anything is loaded, so a suppressed
    /// recipient never causes a body to be fetched at all — not fetched and then filtered, which
    /// would leave the content in this process's memory and in the query log for a person who may no
    /// longer read it.
    /// </remarks>
    private async Task<MessagingRealtimeDispatchOutcome> PublishAsync(
        ClaimedWork work,
        CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var provider = scope.ServiceProvider;
        provider.GetRequiredService<IMutableTenantContext>().SetTenant(work.TenantId);
        var context = provider.GetRequiredService<GymDbContext>();
        var authorizer = provider.GetRequiredService<MessagingRealtimeAuthorizer>();

        try
        {
            var suppression = await authorizer.SuppressionReasonAsync(
                work.TenantId,
                work.ConversationId,
                work.RecipientUserId,
                cancellationToken);
            if (suppression is not null)
            {
                return await FinalizeSuppressionAsync(context, work, suppression, cancellationToken);
            }

            var participant = await context.ConversationParticipants
                .AsNoTracking()
                .SingleOrDefaultAsync(
                    item =>
                        item.ConversationId == work.ConversationId &&
                        item.UserId == work.RecipientUserId,
                    cancellationToken);
            if (participant is null)
            {
                return await FinalizeSuppressionAsync(
                    context,
                    work,
                    MessagingRealtimeSuppressionCodes.NotAParticipant,
                    cancellationToken);
            }

            MessageView? projection = null;
            if (work.MessageId is { } messageId)
            {
                projection = await MessagingMessageProjection.ProjectAsync(
                    context,
                    messageId,
                    participant,
                    cancellationToken);
                if (projection is null)
                {
                    return await FinalizeFailureAsync(
                        work,
                        MessagingRealtimeFailureCodes.AggregateMismatch,
                        permanent: true,
                        cancellationToken);
                }
            }

            if (!await TryPublishAsync(work, projection))
            {
                return await FinalizeFailureAsync(
                    work,
                    MessagingRealtimeFailureCodes.PublishTransient,
                    permanent: false,
                    cancellationToken);
            }

            // The hub has accepted the frames. A crash from here until the finalize below leaves the
            // row claimed until its lease expires, at which point another replica reclaims it and
            // publishes again — a duplicate the client discards by event identity, rather than a
            // frame nobody ever sent.
            await checkpoint.AfterPublishedBeforeFinalizeAsync(
                work.TenantId,
                work.RecipientId,
                work.ClaimToken,
                cancellationToken);

            return await FinalizePublicationAsync(context, work, cancellationToken);
        }
        catch (Exception exception) when (IsRecoverable(exception))
        {
            return await FinalizeFailureAsync(
                work,
                MessagingRealtimeFailureCodes.PublishTransient,
                permanent: false,
                cancellationToken);
        }
    }

    /// <summary>
    /// Sends the two frames, and treats <b>any</b> failure as a transient publication failure.
    /// </summary>
    /// <remarks>
    /// A bare catch here rather than the enumerated list used everywhere else, deliberately. The
    /// lifetime manager behind <c>IHubContext</c> is a third-party component this assembly does not
    /// and must not reference — a Redis backplane throws its own exception types, and enumerating
    /// them would mean naming the package that the architecture tests keep out of Infrastructure.
    /// Anything a send throws is therefore classified as one stable, content-free code, and the
    /// exception object is dropped rather than logged: a backplane failure is exactly where an
    /// endpoint, a credential or an untrusted response body would otherwise appear.
    /// <para>
    /// Two frames, one bounded and one full, both addressed to this participant's own
    /// server-generated groups. The compact one lets a closed thread move up the list without pushing
    /// a body to a browser that had no reason to hold it; the full one lets an open thread merge
    /// immediately. A user with no thread open is still correct, through persisted state and catch-up.
    /// </para>
    /// </remarks>
    private async Task<bool> TryPublishAsync(ClaimedWork work, MessageView? projection)
    {
        try
        {
            await hubContext.Clients
                .Group(MessagingRealtimeGroups.ConversationUser(
                    work.TenantId,
                    work.ConversationId,
                    work.RecipientUserId))
                .RealtimeEvent(new RealtimeEventView(
                    work.TenantId,
                    work.ConversationId,
                    work.RealtimeEventId,
                    work.EventSequence,
                    work.Kind,
                    work.OccurredAtUtc,
                    projection));
            await hubContext.Clients
                .Group(MessagingRealtimeGroups.TenantUser(work.TenantId, work.RecipientUserId))
                .ConversationChanged(new RealtimeConversationInvalidation(
                    work.TenantId,
                    work.ConversationId,
                    work.EventSequence,
                    work.OccurredAtUtc));
            return true;
        }
        catch (OperationCanceledException)
        {
            // Host shutdown is not a delivery failure. Unwinding leaves the claim held, and the lease
            // expiry reclaims it.
            throw;
        }
#pragma warning disable CA1031 // See the remarks: the failure surface here is deliberately unbounded.
        catch (Exception)
        {
            return false;
        }
#pragma warning restore CA1031
    }

    private async Task<MessagingRealtimeDispatchOutcome> FinalizePublicationAsync(
        GymDbContext context,
        ClaimedWork work,
        CancellationToken cancellationToken)
    {
        var now = clock.UtcNow;
        var finalized = await context.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
            var loaded = await LoadClaimedAsync(context, work, cancellationToken);
            if (loaded is not var (row, attempt) || IsStale(row, attempt, work))
            {
                // Another replica reclaimed and finished this row while this one was publishing. The
                // newer result stands; this claimant records nothing at all rather than overwriting
                // a decision it no longer has any right to make.
                await transaction.CommitAsync(cancellationToken);
                return false;
            }

            attempt.Publish(now);
            row.MarkPublished(work.ClaimToken, now);
            await context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return true;
        });

        if (!finalized)
        {
            return MessagingRealtimeDispatchOutcome.Empty;
        }

        LogPublished(logger, work.RecipientId, work.Kind.ToString(), work.AttemptNumber, null);
        return MessagingRealtimeDispatchOutcome.Empty with { Published = 1 };
    }

    private async Task<MessagingRealtimeDispatchOutcome> FinalizeSuppressionAsync(
        GymDbContext context,
        ClaimedWork work,
        string reasonCode,
        CancellationToken cancellationToken)
    {
        var now = clock.UtcNow;
        var finalized = await context.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
            var loaded = await LoadClaimedAsync(context, work, cancellationToken);
            if (loaded is not var (row, attempt) || IsStale(row, attempt, work))
            {
                await transaction.CommitAsync(cancellationToken);
                return false;
            }

            // The attempt was already durably started. Suppression earns no retry and starts no
            // replacement, but history closes the real attempt rather than deleting it or leaving it
            // open for ever.
            attempt.Suppress(now, reasonCode);
            row.Suppress(work.ClaimToken, now, reasonCode);
            await context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return true;
        });

        if (!finalized)
        {
            return MessagingRealtimeDispatchOutcome.Empty;
        }

        LogSuppressed(logger, work.RecipientId, work.Kind.ToString(), reasonCode, null);
        return MessagingRealtimeDispatchOutcome.Empty with { Suppressed = 1 };
    }

    /// <summary>
    /// Records a failure against the claim that suffered it, in a clean scope.
    /// </summary>
    /// <remarks>
    /// The context that failed is holding tracked state that failed with it, so the failure is
    /// recorded through a fresh one. If even that fails, nothing is written: the lease still expires,
    /// the row becomes visible again, and the next sweep abandons this attempt and retries.
    /// </remarks>
    private async Task<MessagingRealtimeDispatchOutcome> FinalizeFailureAsync(
        ClaimedWork work,
        string failureCode,
        bool permanent,
        CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var provider = scope.ServiceProvider;
        provider.GetRequiredService<IMutableTenantContext>().SetTenant(work.TenantId);
        var context = provider.GetRequiredService<GymDbContext>();
        var now = clock.UtcNow;

        try
        {
            var loaded = await LoadClaimedAsync(context, work, cancellationToken);
            if (loaded is not var (row, attempt) || IsStale(row, attempt, work))
            {
                return MessagingRealtimeDispatchOutcome.Empty;
            }

            if (permanent)
            {
                attempt.FailPermanently(now, failureCode);
                row.MarkDeadLettered(work.ClaimToken, now, failureCode);
                await context.SaveChangesAsync(cancellationToken);
                LogDeadLettered(logger, work.RecipientId, work.Kind.ToString(), work.AttemptNumber, failureCode, null);
                return MessagingRealtimeDispatchOutcome.Empty with { DeadLettered = 1 };
            }

            attempt.FailTransiently(now, failureCode);
            var next = MessagingRealtimeRetryPolicy.NextAttemptAtUtc(
                work.AttemptNumber,
                settings.MaximumAttempts,
                now);
            if (next is { } nextAttemptAtUtc)
            {
                row.MarkRetrying(work.ClaimToken, nextAttemptAtUtc, failureCode);
                await context.SaveChangesAsync(cancellationToken);
                LogRetrying(logger, work.RecipientId, work.Kind.ToString(), work.AttemptNumber, failureCode, null);
                return MessagingRealtimeDispatchOutcome.Empty with { Retried = 1 };
            }

            row.MarkDeadLettered(work.ClaimToken, now, MessagingRealtimeFailureCodes.AttemptsExhausted);
            await context.SaveChangesAsync(cancellationToken);
            LogDeadLettered(
                logger,
                work.RecipientId,
                work.Kind.ToString(),
                work.AttemptNumber,
                MessagingRealtimeFailureCodes.AttemptsExhausted,
                null);
            return MessagingRealtimeDispatchOutcome.Empty with { DeadLettered = 1 };
        }
        catch (Exception exception) when (IsRecoverable(exception))
        {
            return MessagingRealtimeDispatchOutcome.Empty;
        }
    }

    private static async Task<(MessagingRealtimeRecipient Row, MessagingRealtimeAttempt Attempt)?> LoadClaimedAsync(
        GymDbContext context,
        ClaimedWork work,
        CancellationToken cancellationToken)
    {
        context.ChangeTracker.Clear();
        var row = await context.MessagingRealtimeRecipients
            .SingleOrDefaultAsync(candidate => candidate.Id == work.RecipientId, cancellationToken);
        var attempt = await context.MessagingRealtimeAttempts
            .SingleOrDefaultAsync(candidate => candidate.Id == work.AttemptId, cancellationToken);
        return row is null || attempt is null ? null : (row, attempt);
    }

    /// <summary>
    /// Whether this claimant still owns the row.
    /// </summary>
    /// <remarks>
    /// The lease may have expired and been taken over while this attempt was running. The newer
    /// claimant owns the row now, its historical attempt may already be Abandoned, and neither it nor
    /// the newer terminal result may be changed by a claimant that has been superseded.
    /// </remarks>
    private static bool IsStale(
        MessagingRealtimeRecipient row,
        MessagingRealtimeAttempt attempt,
        ClaimedWork work) =>
        row.Status != MessagingRealtimeStatus.Processing ||
        row.ClaimToken != work.ClaimToken ||
        attempt.ClaimToken != work.ClaimToken ||
        attempt.IsCompleted;

    /// <summary>
    /// What the sweep treats as a failed publication rather than as a bug.
    /// </summary>
    /// <remarks>
    /// Enumerated rather than left as a bare <c>catch</c>, so anything unanticipated surfaces instead
    /// of being quietly retried and dead-lettered under a misleading code. Cancellation is excluded
    /// deliberately: host shutdown is not a delivery failure, and unwinding leaves the claim held,
    /// which the lease expiry then reclaims.
    /// <para>
    /// <see cref="InvalidOperationException"/> is included because it is how the domain refuses a
    /// finalization whose claim has been taken over, and because it is what a SignalR lifetime
    /// manager throws when its backplane is unavailable.
    /// </para>
    /// </remarks>
    private static bool IsRecoverable(Exception exception) => exception switch
    {
        OperationCanceledException => false,
        DbUpdateConcurrencyException => true,
        DbUpdateException => true,
        NpgsqlException => true,
        TimeoutException => true,
        IOException => true,
        InvalidOperationException => true,
        HubException => true,
        _ => false,
    };

    private sealed record ClaimResult(
        MessagingRealtimeDispatchOutcome Outcome,
        IReadOnlyList<ClaimedWork> Work,
        int Consumed);

    private sealed record ClaimedWork(
        Guid TenantId,
        Guid RecipientId,
        Guid ConversationId,
        Guid RecipientUserId,
        Guid RealtimeEventId,
        MessagingRealtimeEventKind Kind,
        long EventSequence,
        Guid? MessageId,
        DateTimeOffset OccurredAtUtc,
        Guid ClaimToken,
        Guid AttemptId,
        int AttemptNumber);
}
