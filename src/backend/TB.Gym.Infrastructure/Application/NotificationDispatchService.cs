using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Notifications;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.Modules.Tenancy;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// Turns due outbox intents into in-app notifications, durably and at least once.
/// </summary>
/// <remarks>
/// The sweep has two deliberately separate halves.
/// <para>
/// <b>Claiming</b> happens in one short transaction per workspace. Due rows are locked with
/// <c>FOR UPDATE SKIP LOCKED</c>, so several worker replicas may sweep at the same time and step over
/// each other's rows instead of blocking or double-processing them. Inside that transaction each
/// candidate has its eligibility re-established from the authoritative rows, a lease token and expiry
/// are written, and an attempt row is started. Nothing external happens while the lock is held; there
/// is no external provider in this slice, and preserving that boundary now is what will let one be
/// added later without holding a database transaction across a network call.
/// </para>
/// <para>
/// <b>Materialization</b> happens afterwards, per item, in its own scope and its own transaction. It
/// first re-establishes eligibility so the committed claim cannot authorize stale delivery after an
/// authoritative change. The notification row, the successful attempt and the completed outbox row
/// then commit together or not at all. If that transaction fails, none of the three facts is visible,
/// and the unique notification-per-intent constraint makes the replay idempotent even if the process
/// died after the insert but before the commit.
/// </para>
/// <para>
/// Every finalization presents the claim token it was issued. A worker whose lease expired and whose
/// item has since been taken over cannot overwrite the newer worker's result: the domain refuses the
/// transition, and the sweep records nothing.
/// </para>
/// </remarks>
internal sealed class NotificationDispatchService(
    GymDbContext dbContext,
    IServiceScopeFactory scopeFactory,
    IClock clock,
    IOptions<NotificationDispatchOptions> options,
    ILogger<NotificationDispatchService> logger,
    INotificationDispatchCheckpoint checkpoint)
    : INotificationDispatchService
{
    private static readonly JsonSerializerOptions PayloadJsonOptions =
        new(JsonSerializerDefaults.Web);

    // Identifiers, kind, channel, attempt number and a stable code only. No recipient, no rendered
    // wording, no payload, no exception message: an operator needs to know which intent behaved how,
    // not what it said or who it was for.
    private static readonly Action<ILogger, Guid, Guid, string, int, string, Exception?> LogDispatched =
        LoggerMessage.Define<Guid, Guid, string, int, string>(
            LogLevel.Information,
            new EventId(6101, "NotificationDispatched"),
            "Notification {OutboxItemId} in workspace {TenantId} ({Kind}) dispatched on attempt {AttemptNumber} over {Channel}.");

    private static readonly Action<ILogger, Guid, Guid, string, string, Exception?> LogSuppressed =
        LoggerMessage.Define<Guid, Guid, string, string>(
            LogLevel.Information,
            new EventId(6102, "NotificationSuppressed"),
            "Notification {OutboxItemId} in workspace {TenantId} ({Kind}) suppressed with {FailureCode}.");

    private static readonly Action<ILogger, Guid, Guid, string, int, string, Exception?> LogRetrying =
        LoggerMessage.Define<Guid, Guid, string, int, string>(
            LogLevel.Warning,
            new EventId(6103, "NotificationRetrying"),
            "Notification {OutboxItemId} in workspace {TenantId} ({Kind}) failed attempt {AttemptNumber} with {FailureCode} and will be retried.");

    private static readonly Action<ILogger, Guid, Guid, string, int, string, Exception?> LogDeadLettered =
        LoggerMessage.Define<Guid, Guid, string, int, string>(
            LogLevel.Error,
            new EventId(6104, "NotificationDeadLettered"),
            "Notification {OutboxItemId} in workspace {TenantId} ({Kind}) dead-lettered after {AttemptNumber} attempts with {FailureCode}.");

    private static readonly Action<ILogger, Guid, Guid, int, Exception?> LogReclaimed =
        LoggerMessage.Define<Guid, Guid, int>(
            LogLevel.Warning,
            new EventId(6105, "NotificationClaimReclaimed"),
            "Notification {OutboxItemId} in workspace {TenantId} had an expired claim; attempt {AttemptNumber} was abandoned.");

    private readonly NotificationDispatchOptions settings = options.Value;

    public async Task<NotificationDispatchOutcome> DispatchDueAsync(CancellationToken cancellationToken)
    {
        if (!settings.Enabled || settings.BatchSize <= 0)
        {
            return NotificationDispatchOutcome.Empty;
        }

        var now = clock.UtcNow;

        // The only global read in the sweep, and it is read-only. The scheduling instant is the
        // pending item's NextAttemptAtUtc or an expired claim's ClaimExpiresAtUtc. A workspace that
        // was just served is placed behind workspaces whose due work has waited longer, using the
        // durable attempt history rather than tenant GUID order or a process-local cursor. New work
        // in a continuously busy workspace therefore cannot indefinitely starve an older waiter.
        var tenantIds = await DueItems(dbContext, now)
            .GroupBy(item => item.TenantId)
            .Select(group => new
            {
                TenantId = group.Key,
                EffectiveDueAtUtc = group.Min(item =>
                    item.Status == NotificationOutboxStatus.Pending
                        ? item.NextAttemptAtUtc
                        : item.ClaimExpiresAtUtc!.Value),
                LastAttemptStartedAtUtc = dbContext.NotificationDeliveryAttempts
                    .IgnoreQueryFilters()
                    .Where(attempt => attempt.TenantId == group.Key)
                    .Max(attempt => (DateTimeOffset?)attempt.StartedAtUtc),
            })
            // The later of oldest due and last service is the workspace's effective waiting instant:
            // due age leads until the workspace is served, then the durable service instant rotates
            // it behind older due workspaces.
            .OrderBy(workspace =>
                workspace.LastAttemptStartedAtUtc == null ||
                workspace.LastAttemptStartedAtUtc < workspace.EffectiveDueAtUtc
                    ? workspace.EffectiveDueAtUtc
                    : workspace.LastAttemptStartedAtUtc.Value)
            .ThenBy(workspace => workspace.EffectiveDueAtUtc)
            .ThenBy(workspace => workspace.TenantId)
            .Select(workspace => workspace.TenantId)
            .Take(settings.BatchSize)
            .ToListAsync(cancellationToken);
        if (tenantIds.Count == 0)
        {
            return NotificationDispatchOutcome.Empty;
        }

        // The batch cap is global. Each selected workspace gets an equal first share; a later round
        // redistributes capacity a workspace could not use, without ever increasing the one global
        // budget. This both avoids per-workspace multiplication and uses the whole cap when possible.
        var activeTenantIds = tenantIds;
        var remaining = settings.BatchSize;
        var outcome = NotificationDispatchOutcome.Empty;
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
                var claimed = await ClaimForTenantAsync(
                    tenantId,
                    now,
                    limit,
                    cancellationToken);
                outcome = outcome.Add(claimed.Outcome);
                remaining -= claimed.Consumed;

                foreach (var work in claimed.Work)
                {
                    // ClaimForTenantAsync has committed before it returns. Tests replace this no-op
                    // checkpoint with a barrier and commit authoritative changes while the durable
                    // claim is visible but no notification has yet been materialized.
                    await checkpoint.AfterClaimCommittedAsync(
                        work.TenantId,
                        work.OutboxItemId,
                        work.ClaimToken,
                        cancellationToken);
                    outcome = outcome.Add(await MaterializeAsync(work, cancellationToken));
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
    /// The second half is what stops a crashed worker from hiding a notification permanently.
    /// </summary>
    private static IQueryable<NotificationOutboxItem> DueItems(GymDbContext context, DateTimeOffset now) =>
        context.NotificationOutboxItems
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(item =>
                (item.Status == NotificationOutboxStatus.Pending && item.NextAttemptAtUtc <= now) ||
                (item.Status == NotificationOutboxStatus.Processing &&
                 item.ClaimExpiresAtUtc != null &&
                 item.ClaimExpiresAtUtc <= now));

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

            // Deterministic order by effective due instant then id, so two workers sweeping the same
            // workspace walk the backlog the same way and SKIP LOCKED simply divides it between them.
            var candidates = await context.NotificationOutboxItems
                .FromSql($"""
                    SELECT *, xmin FROM notifications."OutboxItems"
                    WHERE "TenantId" = {tenantId}
                      AND (("Status" = 'Pending' AND "NextAttemptAtUtc" <= {now})
                           OR ("Status" = 'Processing' AND "ClaimExpiresAtUtc" IS NOT NULL AND "ClaimExpiresAtUtc" <= {now}))
                    ORDER BY "NextAttemptAtUtc", "Id"
                    LIMIT {limit}
                    FOR UPDATE SKIP LOCKED
                    """)
                .ToListAsync(cancellationToken);

            var outcome = NotificationDispatchOutcome.Empty;
            var work = new List<ClaimedWork>();
            foreach (var item in candidates)
            {
                var reclaimed = await AbandonExpiredAttemptAsync(context, item, now, cancellationToken);
                if (reclaimed)
                {
                    outcome = outcome with { Reclaimed = outcome.Reclaimed + 1 };
                }

                var eligibility = await EvaluateAsync(context, item, cancellationToken);
                if (eligibility.Suppression is { } suppression)
                {
                    // Suppression costs no attempt: nothing was tried, the reason to try simply went
                    // away. Recorded with a stable code so it is distinguishable from a failure.
                    item.Suppress(suppression);
                    LogSuppressed(logger, item.Id, tenantId, item.Kind.ToString(), suppression, null);
                    outcome = outcome with { Suppressed = outcome.Suppressed + 1 };
                    continue;
                }

                // Every increment represents a durably started attempt, including an abandoned one.
                // Once that count reaches the configured maximum, reclaiming closes the item using
                // the real last attempt already in history; it never manufactures attempt max + 1.
                if (item.AttemptCount >= settings.MaximumAttempts)
                {
                    item.MarkAttemptsExhausted(now);
                    LogDeadLettered(
                        logger,
                        item.Id,
                        tenantId,
                        item.Kind.ToString(),
                        item.AttemptCount,
                        NotificationFailureCodes.AttemptsExhausted,
                        null);
                    outcome = outcome with { DeadLettered = outcome.DeadLettered + 1 };
                    continue;
                }

                var claimToken = item.Claim(
                    now,
                    TimeSpan.FromSeconds(settings.ClaimLeaseSeconds),
                    settings.MaximumAttempts);
                var attempt = NotificationDeliveryAttempt.Start(
                    tenantId,
                    item.Id,
                    NotificationChannel.InApp,
                    item.AttemptCount,
                    claimToken,
                    now);
                context.NotificationDeliveryAttempts.Add(attempt);

                if (eligibility.PermanentFailure is { } permanent)
                {
                    // A corrupt payload, a missing template or an impossible aggregate will not fix
                    // itself, so this dead-letters now rather than burning the retry schedule on it.
                    attempt.FailPermanently(now, permanent);
                    item.MarkDeadLettered(claimToken, now, permanent);
                    LogDeadLettered(logger, item.Id, tenantId, item.Kind.ToString(), item.AttemptCount, permanent, null);
                    outcome = outcome with
                    {
                        Claimed = outcome.Claimed + 1,
                        DeadLettered = outcome.DeadLettered + 1,
                    };
                    continue;
                }

                work.Add(new ClaimedWork(
                    tenantId,
                    item.Id,
                    item.Kind,
                    item.RecipientUserId,
                    claimToken,
                    attempt.Id,
                    item.AttemptCount));
                outcome = outcome with { Claimed = outcome.Claimed + 1 };
            }

            await context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return new ClaimResult(outcome, work, candidates.Count);
        });
    }

    /// <summary>
    /// A lease that expired leaves evidence before it is replaced: the unfinished attempt it started
    /// is marked Abandoned, so the history shows a try that was interrupted rather than an attempt
    /// number that silently went missing.
    /// </summary>
    private async Task<bool> AbandonExpiredAttemptAsync(
        GymDbContext context,
        NotificationOutboxItem item,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        if (!item.IsClaimExpired(now) || item.ClaimToken is not { } expiredToken)
        {
            return false;
        }

        var unfinished = await context.NotificationDeliveryAttempts
            .Where(attempt =>
                attempt.OutboxItemId == item.Id &&
                attempt.ClaimToken == expiredToken &&
                attempt.Outcome == NotificationDeliveryOutcome.Started)
            .ToListAsync(cancellationToken);
        foreach (var attempt in unfinished)
        {
            attempt.Abandon(now, NotificationFailureCodes.ClaimExpired);
            LogReclaimed(logger, item.Id, item.TenantId, attempt.AttemptNumber, null);
        }

        return true;
    }

    /// <summary>
    /// Re-establishes every relationship server-side before anything is rendered.
    /// </summary>
    /// <remarks>
    /// A delayed notification describes a world that may have moved: the workspace may be closed, the
    /// account blocked, the membership gone, the coaching relationship blocked, the enrollment
    /// cancelled or renewed. None of that can be trusted from the payload, which holds identifiers
    /// and nothing else.
    /// <para>
    /// <c>ICoachingFeatureAccessService</c> is deliberately not the decision here.
    /// <c>PaymentRequired</c> exists precisely to describe a state in which feature access is denied,
    /// so gating on it would suppress the one notification the client most needs.
    /// </para>
    /// </remarks>
    private async Task<Eligibility> EvaluateAsync(
        GymDbContext context,
        NotificationOutboxItem item,
        CancellationToken cancellationToken)
    {
        if (!TryReadPayload(item.PayloadJson, out var payload) || payload.EnrollmentId != item.AggregateId)
        {
            return Eligibility.Permanent(NotificationFailureCodes.PayloadInvalid);
        }

        var tenant = await context.Tenants
            .AsNoTracking()
            .Where(candidate => candidate.Id == item.TenantId)
            .Select(candidate => new { candidate.IsActive, candidate.TimeZoneId, candidate.DefaultCulture })
            .SingleOrDefaultAsync(cancellationToken);
        if (tenant is null)
        {
            return Eligibility.Permanent(NotificationFailureCodes.AggregateMismatch);
        }

        if (!tenant.IsActive)
        {
            return Eligibility.Suppress(NotificationSuppressionCodes.TenantInactive);
        }

        var recipient = await context.Users
            .AsNoTracking()
            .Where(user => user.Id == item.RecipientUserId)
            .Select(user => new { user.IsPlatformBlocked })
            .SingleOrDefaultAsync(cancellationToken);
        if (recipient is null)
        {
            return Eligibility.Permanent(NotificationFailureCodes.AggregateMismatch);
        }

        if (recipient.IsPlatformBlocked)
        {
            return Eligibility.Suppress(NotificationSuppressionCodes.RecipientBlocked);
        }

        var membershipIsActive = await context.TenantMemberships
            .AsNoTracking()
            .AnyAsync(
                membership =>
                    membership.TenantId == item.TenantId &&
                    membership.UserId == item.RecipientUserId &&
                    membership.Status == MembershipStatus.Active,
                cancellationToken);
        if (!membershipIsActive)
        {
            return Eligibility.Suppress(NotificationSuppressionCodes.MembershipInactive);
        }

        // Tenant-filtered reads: a client profile or an enrollment belonging to another workspace is
        // simply not visible here, so the ownership check is enforced by the filter rather than by a
        // predicate somebody could forget to write.
        var client = await context.ClientProfiles
            .AsNoTracking()
            .Where(profile => profile.Id == payload.ClientProfileId)
            .Select(profile => new { profile.UserId, profile.IsCoachBlocked })
            .SingleOrDefaultAsync(cancellationToken);
        if (client is null)
        {
            return Eligibility.Permanent(NotificationFailureCodes.AggregateMismatch);
        }

        if (client.UserId != item.RecipientUserId)
        {
            return Eligibility.Suppress(NotificationSuppressionCodes.RecipientUnlinked);
        }

        if (client.IsCoachBlocked)
        {
            return Eligibility.Suppress(NotificationSuppressionCodes.RelationshipBlocked);
        }

        var enrollment = await context.ClientEnrollments
            .AsNoTracking()
            .Where(candidate => candidate.Id == payload.EnrollmentId)
            .Select(candidate => new
            {
                candidate.ClientProfileId,
                candidate.Status,
                candidate.EndDateExclusive,
                candidate.RenewedFromEnrollmentId,
            })
            .SingleOrDefaultAsync(cancellationToken);
        if (enrollment is null || enrollment.ClientProfileId != payload.ClientProfileId)
        {
            return Eligibility.Permanent(NotificationFailureCodes.AggregateMismatch);
        }

        if (enrollment.Status == EnrollmentStatus.Cancelled)
        {
            return Eligibility.Suppress(NotificationSuppressionCodes.EnrollmentCancelled);
        }

        DateOnly tenantToday;
        try
        {
            // The workspace's current time zone, not the one stored on the row. The stored zone is
            // scheduling provenance; what "today" means now is a question about the workspace now.
            var localNow = TimeZoneInfo.ConvertTime(
                clock.UtcNow,
                TimeZoneInfo.FindSystemTimeZoneById(tenant.TimeZoneId));
            tenantToday = DateOnly.FromDateTime(localNow.DateTime);
        }
        catch (Exception exception) when (exception is TimeZoneNotFoundException or InvalidTimeZoneException)
        {
            return Eligibility.Permanent(NotificationFailureCodes.AggregateMismatch);
        }

        var stillHolds = item.Kind switch
        {
            CommercialNotificationKind.PaymentRequired =>
                enrollment.Status == EnrollmentStatus.PendingPayment &&
                tenantToday < enrollment.EndDateExclusive,
            CommercialNotificationKind.EnrollmentActivated =>
                enrollment.Status is EnrollmentStatus.Active or EnrollmentStatus.Paused &&
                tenantToday < enrollment.EndDateExclusive,
            CommercialNotificationKind.EnrollmentEndingSoon =>
                enrollment.Status is EnrollmentStatus.Active or EnrollmentStatus.Paused &&
                tenantToday < enrollment.EndDateExclusive,
            CommercialNotificationKind.EnrollmentExpired =>
                tenantToday >= enrollment.EndDateExclusive,
            CommercialNotificationKind.EnrollmentRenewed =>
                enrollment.RenewedFromEnrollmentId is not null &&
                tenantToday < enrollment.EndDateExclusive,
            _ => false,
        };
        if (!stillHolds)
        {
            return Eligibility.Suppress(NotificationSuppressionCodes.StateChanged);
        }

        return NotificationTemplateCatalog.TryResolve(item.Kind, tenant.DefaultCulture, out var template)
            ? Eligibility.Eligible(template)
            : Eligibility.Permanent(NotificationFailureCodes.TemplateMissing);
    }

    private static bool TryReadPayload(string payloadJson, out CommercialNotificationPayload payload)
    {
        try
        {
            var parsed = JsonSerializer.Deserialize<CommercialNotificationPayload>(
                payloadJson,
                PayloadJsonOptions);
            if (parsed is null ||
                parsed.EnrollmentId == Guid.Empty ||
                parsed.ClientProfileId == Guid.Empty ||
                // Phase 2 payloads predate the field and deserialize as 0. They are the current shape
                // in every other respect, so they are read as version 1; anything else is a build
                // that cannot read this payload, which no amount of retrying will change.
                parsed.SchemaVersion is not (0 or CommercialNotificationPayload.CurrentSchemaVersion))
            {
                payload = null!;
                return false;
            }

            payload = parsed;
            return true;
        }
        catch (JsonException)
        {
            payload = null!;
            return false;
        }
    }

    /// <summary>
    /// The notification, its successful attempt and the completed outbox row, committed together.
    /// </summary>
    private async Task<NotificationDispatchOutcome> MaterializeAsync(
        ClaimedWork work,
        CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var provider = scope.ServiceProvider;
        provider.GetRequiredService<IMutableTenantContext>().SetTenant(work.TenantId);
        var context = provider.GetRequiredService<GymDbContext>();
        var now = clock.UtcNow;

        try
        {
            var finalization = await context.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
            {
                await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
                var (item, attempt) = await LoadClaimedAsync(context, work, cancellationToken);

                // Another worker may have reclaimed and completed this item while this worker was
                // paused after its claim commit. The historical attempt now belongs to that past
                // claim and may already be Abandoned; neither it nor the newer terminal result may be
                // changed by the stale claimant.
                if (item.Status != NotificationOutboxStatus.Processing ||
                    item.ClaimToken != work.ClaimToken ||
                    attempt.ClaimToken != work.ClaimToken ||
                    attempt.IsCompleted)
                {
                    await transaction.CommitAsync(cancellationToken);
                    return MaterializationFinalization.Stale;
                }

                // A committed claim is a lease, not authorization forever. Re-read every
                // authoritative relationship inside the same transaction that would materialize the
                // notification, closing the race between the original eligibility check and delivery.
                var eligibility = await EvaluateAsync(context, item, cancellationToken);
                if (eligibility.Suppression is { } suppression)
                {
                    // This attempt was already durably started. Suppression starts no replacement and
                    // earns no retry, but history must close the real attempt rather than delete it or
                    // leave it Started forever.
                    attempt.Suppress(now, suppression);
                    item.Suppress(suppression);
                    await context.SaveChangesAsync(cancellationToken);
                    await transaction.CommitAsync(cancellationToken);
                    return new MaterializationFinalization(
                        MaterializationFinalizationKind.Suppressed,
                        suppression);
                }

                if (eligibility.PermanentFailure is { } permanent)
                {
                    attempt.FailPermanently(now, permanent);
                    item.MarkDeadLettered(work.ClaimToken, now, permanent);
                    await context.SaveChangesAsync(cancellationToken);
                    await transaction.CommitAsync(cancellationToken);
                    return new MaterializationFinalization(
                        MaterializationFinalizationKind.DeadLettered,
                        permanent);
                }

                // A replay after a crash between the insert and the commit finds its own notification
                // already there. That is a success, not a duplicate: the unique constraint on the
                // source intent is what makes at-least-once delivery safe to repeat.
                var alreadyMaterialized = await context.Notifications
                    .AnyAsync(existing => existing.SourceOutboxItemId == item.Id, cancellationToken);
                if (!alreadyMaterialized)
                {
                    context.Notifications.Add(Notification.Materialize(
                        work.TenantId,
                        work.RecipientUserId,
                        item.Id,
                        item.Kind,
                        eligibility.Template!));
                }

                attempt.Succeed(now);
                item.MarkDispatched(work.ClaimToken, now);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return MaterializationFinalization.Dispatched;
            });

            switch (finalization.Kind)
            {
                case MaterializationFinalizationKind.Dispatched:
                    LogDispatched(
                        logger,
                        work.OutboxItemId,
                        work.TenantId,
                        work.Kind.ToString(),
                        work.AttemptNumber,
                        NotificationChannel.InApp.ToString(),
                        null);
                    return NotificationDispatchOutcome.Empty with { Dispatched = 1 };
                case MaterializationFinalizationKind.Suppressed:
                    LogSuppressed(
                        logger,
                        work.OutboxItemId,
                        work.TenantId,
                        work.Kind.ToString(),
                        finalization.Code!,
                        null);
                    return NotificationDispatchOutcome.Empty with { Suppressed = 1 };
                case MaterializationFinalizationKind.DeadLettered:
                    LogDeadLettered(
                        logger,
                        work.OutboxItemId,
                        work.TenantId,
                        work.Kind.ToString(),
                        work.AttemptNumber,
                        finalization.Code!,
                        null);
                    return NotificationDispatchOutcome.Empty with { DeadLettered = 1 };
                case MaterializationFinalizationKind.Stale:
                    return NotificationDispatchOutcome.Empty;
                default:
                    throw new InvalidOperationException("Unknown notification finalization.");
            }
        }
        catch (Exception exception) when (IsRecoverable(exception))
        {
            // The transaction rolled back, so nothing partial is visible. The failure is recorded in
            // a clean scope, because the context that failed is holding tracked state that failed
            // with it.
            return await RecordFailureAsync(work, cancellationToken);
        }
    }

    private static async Task<(NotificationOutboxItem Item, NotificationDeliveryAttempt Attempt)> LoadClaimedAsync(
        GymDbContext context,
        ClaimedWork work,
        CancellationToken cancellationToken)
    {
        var item = await context.NotificationOutboxItems
            .SingleAsync(candidate => candidate.Id == work.OutboxItemId, cancellationToken);
        var attempt = await context.NotificationDeliveryAttempts
            .SingleAsync(candidate => candidate.Id == work.AttemptId, cancellationToken);
        return (item, attempt);
    }

    /// <summary>
    /// Records a transient failure against the claim that suffered it, and either schedules the next
    /// attempt from <c>notification-exponential-v1</c> or dead-letters the item because the schedule
    /// is exhausted.
    /// </summary>
    private async Task<NotificationDispatchOutcome> RecordFailureAsync(
        ClaimedWork work,
        CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var provider = scope.ServiceProvider;
        provider.GetRequiredService<IMutableTenantContext>().SetTenant(work.TenantId);
        var context = provider.GetRequiredService<GymDbContext>();
        var now = clock.UtcNow;

        try
        {
            var (item, attempt) = await LoadClaimedAsync(context, work, cancellationToken);

            // The lease may already have expired and been taken over while this attempt was running.
            // The newer claimant owns the item now, so this one records nothing at all rather than
            // overwriting a result it no longer has any right to.
            if (item.Status != NotificationOutboxStatus.Processing || item.ClaimToken != work.ClaimToken)
            {
                return NotificationDispatchOutcome.Empty;
            }

            attempt.FailTransiently(now, NotificationFailureCodes.DispatchTransient);
            var next = NotificationRetryPolicy.NextAttemptAtUtc(
                work.AttemptNumber,
                settings.MaximumAttempts,
                now);
            if (next is { } nextAttemptAtUtc)
            {
                item.MarkRetrying(
                    work.ClaimToken,
                    nextAttemptAtUtc,
                    NotificationFailureCodes.DispatchTransient);
                await context.SaveChangesAsync(cancellationToken);
                LogRetrying(
                    logger,
                    work.OutboxItemId,
                    work.TenantId,
                    work.Kind.ToString(),
                    work.AttemptNumber,
                    NotificationFailureCodes.DispatchTransient,
                    null);
                return NotificationDispatchOutcome.Empty with { Retried = 1 };
            }

            item.MarkDeadLettered(
                work.ClaimToken,
                now,
                NotificationFailureCodes.AttemptsExhausted);
            await context.SaveChangesAsync(cancellationToken);
            LogDeadLettered(
                logger,
                work.OutboxItemId,
                work.TenantId,
                work.Kind.ToString(),
                work.AttemptNumber,
                NotificationFailureCodes.AttemptsExhausted,
                null);
            return NotificationDispatchOutcome.Empty with { DeadLettered = 1 };
        }
        catch (Exception exception) when (IsRecoverable(exception))
        {
            // Even recording the failure failed. The claim lease still expires, so the item becomes
            // visible again and nothing is lost; the next sweep abandons this attempt and retries.
            return NotificationDispatchOutcome.Empty;
        }
    }

    /// <summary>
    /// What the sweep treats as a failed delivery rather than as a bug.
    /// </summary>
    /// <remarks>
    /// The list is enumerated rather than left as a bare <c>catch</c>, so anything unanticipated
    /// surfaces instead of being quietly retried six times and dead-lettered with a misleading code.
    /// Cancellation is excluded deliberately: host shutdown is not a delivery failure, and unwinding
    /// leaves the claim held, which the lease expiry then reclaims.
    /// <para>
    /// <see cref="InvalidOperationException"/> is included because it is how the domain refuses a
    /// finalization whose claim has been taken over. That is the correct outcome for a stale worker:
    /// the failure path re-reads the row, sees a claim it no longer holds, and records nothing at all.
    /// </para>
    /// <para>
    /// No exception object reaches a log from this sweep. Each failure is classified into a stable
    /// code first, because the exception is where an untrusted provider response or a connection
    /// string would eventually turn up once an external adapter exists.
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
        _ => false,
    };

    private sealed record ClaimResult(
        NotificationDispatchOutcome Outcome,
        IReadOnlyList<ClaimedWork> Work,
        int Consumed);

    private sealed record ClaimedWork(
        Guid TenantId,
        Guid OutboxItemId,
        CommercialNotificationKind Kind,
        Guid RecipientUserId,
        Guid ClaimToken,
        Guid AttemptId,
        int AttemptNumber);

    private sealed record MaterializationFinalization(
        MaterializationFinalizationKind Kind,
        string? Code = null)
    {
        public static MaterializationFinalization Dispatched { get; } =
            new(MaterializationFinalizationKind.Dispatched);

        public static MaterializationFinalization Stale { get; } =
            new(MaterializationFinalizationKind.Stale);
    }

    private enum MaterializationFinalizationKind
    {
        Dispatched = 1,
        Suppressed = 2,
        DeadLettered = 3,
        Stale = 4,
    }

    private sealed record Eligibility(
        NotificationTemplate? Template,
        string? Suppression,
        string? PermanentFailure)
    {
        public static Eligibility Eligible(NotificationTemplate template) => new(template, null, null);

        public static Eligibility Suppress(string code) => new(null, code, null);

        public static Eligibility Permanent(string code) => new(null, null, code);
    }
}
