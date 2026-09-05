using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
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
/// Turns due channel deliveries into their own artefacts, durably and at least once.
/// </summary>
/// <remarks>
/// The unit of work is one <see cref="NotificationChannelDelivery"/>, not one intent. That is the
/// whole point of Phase 6B-3A: a notification whose inbox row was written and whose email is on its
/// third retry has two truths at once, and a sweep that claimed the intent could represent only one of
/// them. Two channels of the same notification are claimed, retried, suppressed, deferred and
/// exhausted entirely independently, and neither can block, complete or resurrect the other.
/// <para>
/// <b>Claiming</b> happens in one short transaction per workspace. Due rows are locked with
/// <c>FOR UPDATE SKIP LOCKED</c>, so several worker replicas may sweep at the same time and step over
/// each other's rows instead of blocking or double-processing them. Inside that transaction each
    /// candidate has its eligibility re-established from the authoritative rows and a lease token and
    /// expiry are written. A claim is only a reservation; no attempt is spent yet, and nothing external
    /// happens while the row lock is held.
/// </para>
/// <para>
/// <b>Materialization</b> happens afterwards, per delivery, in its own scope and its own transaction.
    /// It first re-establishes eligibility — including the recipient's <i>current</i> email preference and
    /// the current quiet-hours window — so the committed claim cannot authorize stale delivery after an
    /// authoritative change. Quiet hours can release the reservation without an attempt. Otherwise the
    /// Started attempt commits before an artefact is written or handed to a transport.
/// </para>
/// <para>
/// Every finalization presents the claim token it was issued. A worker whose lease expired and whose
/// delivery has since been taken over cannot overwrite the newer worker's result: the domain refuses
/// the transition, and the sweep records nothing.
/// </para>
/// </remarks>
internal sealed class NotificationDispatchService(
    GymDbContext dbContext,
    IServiceScopeFactory scopeFactory,
    IClock clock,
    IOptions<NotificationDispatchOptions> options,
    IOptions<NotificationEmailOptions> emailOptions,
    ILogger<NotificationDispatchService> logger,
    INotificationDispatchCheckpoint checkpoint)
    : INotificationDispatchService
{
    private static readonly JsonSerializerOptions PayloadJsonOptions =
        new(JsonSerializerDefaults.Web);

    // Identifiers, kind, channel, attempt number and a stable code only. No recipient, no address, no
    // rendered wording, no payload, no exception message: an operator needs to know which delivery
    // behaved how, not what it said or who it was for.
    private static readonly Action<ILogger, Guid, Guid, string, string, int, Exception?> LogMaterialized =
        LoggerMessage.Define<Guid, Guid, string, string, int>(
            LogLevel.Information,
            new EventId(6101, "NotificationMaterialized"),
            "Notification {OutboxItemId} in workspace {TenantId} ({Kind}) materialized over {Channel} on attempt {AttemptNumber}.");

    private static readonly Action<ILogger, Guid, Guid, string, string, string, Exception?> LogSuppressed =
        LoggerMessage.Define<Guid, Guid, string, string, string>(
            LogLevel.Information,
            new EventId(6102, "NotificationSuppressed"),
            "Notification {OutboxItemId} in workspace {TenantId} ({Kind}) suppressed on {Channel} with {FailureCode}.");

    private static readonly Action<ILogger, Guid, Guid, string, string, int, string, Exception?> LogRetrying =
        LoggerMessage.Define<Guid, Guid, string, string, int, string>(
            LogLevel.Warning,
            new EventId(6103, "NotificationRetrying"),
            "Notification {OutboxItemId} in workspace {TenantId} ({Kind}) failed attempt {AttemptNumber} on {Channel} with {FailureCode} and will be retried.");

    private static readonly Action<ILogger, Guid, Guid, string, string, int, string, Exception?> LogDeadLettered =
        LoggerMessage.Define<Guid, Guid, string, string, int, string>(
            LogLevel.Error,
            new EventId(6104, "NotificationDeadLettered"),
            "Notification {OutboxItemId} in workspace {TenantId} ({Kind}) dead-lettered on {Channel} after {AttemptNumber} attempts with {FailureCode}.");

    private static readonly Action<ILogger, Guid, Guid, string, int, Exception?> LogReclaimed =
        LoggerMessage.Define<Guid, Guid, string, int>(
            LogLevel.Warning,
            new EventId(6105, "NotificationClaimReclaimed"),
            "Notification {OutboxItemId} in workspace {TenantId} had an expired {Channel} claim; attempt {AttemptNumber} was abandoned.");

    private static readonly Action<ILogger, Guid, Guid, string, string, Exception?> LogDeferred =
        LoggerMessage.Define<Guid, Guid, string, string>(
            LogLevel.Information,
            new EventId(6106, "NotificationDeferred"),
            "Notification {OutboxItemId} in workspace {TenantId} deferred on {Channel} by {DeferralCode}.");

    private readonly NotificationDispatchOptions settings = options.Value;

    private readonly NotificationEmailOptions email = emailOptions.Value;

    public async Task<NotificationDispatchOutcome> DispatchDueAsync(CancellationToken cancellationToken)
    {
        if (!settings.Enabled || settings.BatchSize <= 0)
        {
            return NotificationDispatchOutcome.Empty;
        }

        var now = clock.UtcNow;

        // The only global read in the sweep, and it is read-only. The scheduling instant is the
        // pending delivery's NextAttemptAtUtc or an expired claim's ClaimExpiresAtUtc. A workspace
        // that was just served is placed behind workspaces whose due work has waited longer, using the
        // durable attempt history rather than tenant GUID order or a process-local cursor. New work in
        // a continuously busy workspace therefore cannot indefinitely starve an older waiter.
        var tenantIds = await DueDeliveries(dbContext, now)
            .GroupBy(item => item.TenantId)
            .Select(group => new
            {
                TenantId = group.Key,
                EffectiveDueAtUtc = group.Min(item =>
                    item.Status == NotificationDeliveryStatus.Pending
                        ? item.NextAttemptAtUtc
                        : item.ClaimExpiresAtUtc!.Value),
                LastAttemptStartedAtUtc = dbContext.NotificationDeliveryAttempts
                    .IgnoreQueryFilters()
                    .Where(attempt => attempt.TenantId == group.Key)
                    .Max(attempt => (DateTimeOffset?)attempt.StartedAtUtc),
            })
            // The later of oldest due and last service is the workspace's effective waiting instant:
            // due age leads until the workspace is served, then the durable service instant rotates it
            // behind older due workspaces.
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
                var claimed = await ClaimForTenantAsync(tenantId, now, limit, cancellationToken);
                outcome = outcome.Add(claimed.Outcome);
                remaining -= claimed.Consumed;

                foreach (var work in claimed.Work)
                {
                    // ClaimForTenantAsync has committed before it returns. Tests replace this no-op
                    // checkpoint with a barrier and commit authoritative changes — a preference
                    // opt-out, a membership removal — while the durable claim is visible but nothing
                    // has yet been materialized.
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
    /// Everything a sweep may act on: due Pending deliveries, and Processing deliveries whose lease has
    /// run out. The second half is what stops a crashed worker from hiding a channel permanently.
    /// </summary>
    /// <remarks>
    /// A quiet-hours deferral simply moves <c>NextAttemptAtUtc</c>, so a deferred email is not in this
    /// set at all until its window ends. The worker never polls it and never spends an attempt on it.
    /// </remarks>
    private static IQueryable<NotificationChannelDelivery> DueDeliveries(GymDbContext context, DateTimeOffset now) =>
        context.NotificationChannelDeliveries
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(item =>
                (item.Status == NotificationDeliveryStatus.Pending && item.NextAttemptAtUtc <= now) ||
                (item.Status == NotificationDeliveryStatus.Processing &&
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
            // Only the delivery rows are locked: the intent is immutable and needs no lock, and
            // locking it would serialize two channels that are deliberately independent.
            var candidates = await context.NotificationChannelDeliveries
                .FromSql($"""
                    SELECT *, xmin FROM notifications."ChannelDeliveries"
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
            foreach (var delivery in candidates)
            {
                var item = await context.NotificationOutboxItems
                    .AsNoTracking()
                    .SingleOrDefaultAsync(candidate => candidate.Id == delivery.OutboxItemId, cancellationToken);
                if (item is null)
                {
                    // A delivery whose intent is not visible in this workspace is a broken row rather
                    // than a delayed one. The composite foreign key makes it unreachable in practice.
                    delivery.SuppressBeforeClaim(now, NotificationFailureCodes.AggregateMismatch);
                    outcome = outcome with { Suppressed = outcome.Suppressed + 1 };
                    continue;
                }

                var reclaimed = await AbandonExpiredAttemptAsync(context, delivery, item.Id, now, cancellationToken);
                if (reclaimed)
                {
                    outcome = outcome with { Reclaimed = outcome.Reclaimed + 1 };
                }

                var eligibility = await EvaluateAsync(context, item, delivery, now, cancellationToken);
                if (eligibility.Deferral is { } deferral)
                {
                    // Quiet hours. Nothing was tried, nothing went wrong, and the notification is still
                    // wanted: the row simply becomes invisible again until the window ends.
                    delivery.Defer(now, deferral.NextAllowedAtUtc, deferral.Code);
                    LogDeferred(logger, item.Id, tenantId, delivery.Channel.ToString(), deferral.Code, null);
                    outcome = outcome with { Deferred = outcome.Deferred + 1 };
                    continue;
                }

                if (eligibility.Suppression is { } suppression)
                {
                    // Suppression costs no attempt: nothing was tried, the reason to try simply went
                    // away. Recorded with a stable code so it is distinguishable from a failure.
                    delivery.SuppressBeforeClaim(now, suppression);
                    LogSuppressed(
                        logger,
                        item.Id,
                        tenantId,
                        item.Kind.ToString(),
                        delivery.Channel.ToString(),
                        suppression,
                        null);
                    outcome = outcome with { Suppressed = outcome.Suppressed + 1 };
                    continue;
                }

                // Every increment represents a durably started attempt, including an abandoned one.
                // Once that count reaches the configured maximum, reclaiming closes the delivery using
                // the real last attempt already in history; it never manufactures attempt max + 1. The
                // budget belongs to this channel alone.
                if (delivery.AttemptCount >= settings.MaximumAttempts)
                {
                    delivery.MarkAttemptsExhausted(now);
                    LogDeadLettered(
                        logger,
                        item.Id,
                        tenantId,
                        item.Kind.ToString(),
                        delivery.Channel.ToString(),
                        delivery.AttemptCount,
                        NotificationFailureCodes.AttemptsExhausted,
                        null);
                    outcome = outcome with { DeadLettered = outcome.DeadLettered + 1 };
                    continue;
                }

                var claimToken = delivery.Claim(
                    now,
                    TimeSpan.FromSeconds(settings.ClaimLeaseSeconds),
                    settings.MaximumAttempts);

                // Permanent eligibility failures still cross the committed claim boundary. That keeps
                // the reservation and started-attempt transitions in separate transactions (required
                // by the deferred attempt-history guard), and MaterializeAsync records the failed
                // attempt with the final recheck's stable code.
                work.Add(new ClaimedWork(
                    tenantId,
                    item.Id,
                    delivery.Id,
                    delivery.Channel,
                    item.Kind,
                    item.RecipientUserId,
                    claimToken,
                    Guid.Empty,
                    0));
                outcome = outcome with { Claimed = outcome.Claimed + 1 };
            }

            await context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return new ClaimResult(outcome, work, candidates.Count);
        });
    }

    /// <summary>
    /// A lease that expired leaves evidence before it is replaced when it had reached the Started
    /// boundary: the unfinished attempt is marked Abandoned, so the history shows a try that was
    /// interrupted rather than an attempt number that silently went missing. An expired reservation
    /// that never started work has no attempt to invent or abandon.
    /// </summary>
    private async Task<bool> AbandonExpiredAttemptAsync(
        GymDbContext context,
        NotificationChannelDelivery delivery,
        Guid outboxItemId,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        if (!delivery.IsClaimExpired(now) || delivery.ClaimToken is not { } expiredToken)
        {
            return false;
        }

        var unfinished = await context.NotificationDeliveryAttempts
            .Where(attempt =>
                attempt.ChannelDeliveryId == delivery.Id &&
                attempt.ClaimToken == expiredToken &&
                attempt.Outcome == NotificationDeliveryOutcome.Started)
            .ToListAsync(cancellationToken);
        foreach (var attempt in unfinished)
        {
            attempt.Abandon(now, NotificationFailureCodes.ClaimExpired);
            LogReclaimed(
                logger,
                outboxItemId,
                delivery.TenantId,
                delivery.Channel.ToString(),
                attempt.AttemptNumber,
                null);
        }

        return true;
    }

    /// <summary>
    /// Re-establishes every relationship server-side before anything is rendered, and then the
    /// channel's own additional conditions.
    /// </summary>
    /// <remarks>
    /// A delayed notification describes a world that may have moved: the workspace may be closed, the
    /// account blocked, the membership gone, the coaching relationship blocked, the enrollment
    /// cancelled or renewed, and — new in this phase — the recipient may have turned email off, or the
    /// workspace may now be inside their quiet hours. None of that can be trusted from the payload,
    /// which holds identifiers and nothing else.
    /// <para>
    /// The shared checks are evaluated once and apply to every channel. The email-only checks are
    /// deliberately after them and deliberately cannot suppress in-app: a preference is about how
    /// somebody is interrupted, never about whether their inbox exists.
    /// </para>
    /// <para>
    /// <c>ICoachingFeatureAccessService</c> is deliberately not the decision here. <c>PaymentRequired</c>
    /// exists precisely to describe a state in which feature access is denied, so gating on it would
    /// suppress the one notification the client most needs.
    /// </para>
    /// </remarks>
    private async Task<Eligibility> EvaluateAsync(
        GymDbContext context,
        NotificationOutboxItem item,
        NotificationChannelDelivery delivery,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        if (item.IsCancelled)
        {
            return Eligibility.Suppress(NotificationSuppressionCodes.IntentCancelled);
        }

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

        // The workspace's current time zone, not the one stored on the row. The stored zone is
        // scheduling provenance; what "today" means now, and when quiet hours are now, are questions
        // about the workspace now. An unresolvable zone fails closed rather than being answered in UTC.
        if (!NotificationQuietHoursPolicy.TryResolveZone(tenant.TimeZoneId, out var zone))
        {
            return Eligibility.Permanent(NotificationFailureCodes.AggregateMismatch);
        }

        var tenantToday = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(now, zone).DateTime);
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

        return delivery.Channel switch
        {
            NotificationChannel.InApp => NotificationTemplateCatalog.TryResolve(
                item.Kind,
                tenant.DefaultCulture,
                out var template)
                ? Eligibility.InApp(template)
                : Eligibility.Permanent(NotificationFailureCodes.TemplateMissing),
            NotificationChannel.Email => await EvaluateEmailAsync(context, item, zone, now, cancellationToken),
            _ => Eligibility.Permanent(NotificationFailureCodes.AggregateMismatch),
        };
    }

    /// <summary>
    /// The email channel's own conditions, checked after every shared one and never able to affect a
    /// different channel.
    /// </summary>
    /// <remarks>
    /// The order matters. The preference is read first, so somebody who has opted out is not evaluated
    /// against quiet hours or looked up in the account tables at all. Quiet hours come next and defer
    /// rather than suppress: the notification is still wanted, this is simply not a moment the
    /// recipient agreed to be interrupted in.
    /// </remarks>
    private async Task<Eligibility> EvaluateEmailAsync(
        GymDbContext context,
        NotificationOutboxItem item,
        TimeZoneInfo zone,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        // A deployment that has switched email off, or that never had a transport, stops delivering it.
        // Nothing is half-sent: no address is resolved, no wording is rendered.
        if (!email.IsAvailable)
        {
            return Eligibility.Suppress(NotificationSuppressionCodes.EmailChannelUnavailable);
        }

        var preference = await context.NotificationChannelPreferences
            .AsNoTracking()
            .SingleOrDefaultAsync(candidate => candidate.UserId == item.RecipientUserId, cancellationToken);

        // A member with no row has never opted in, which is exactly the default. Opting out after the
        // delivery was planned lands here too, and suppresses the pending email without touching the
        // in-app delivery of the same notification.
        var wanted = item.Purpose switch
        {
            NotificationPurpose.ServiceTransactional => preference?.EmailServiceEnabled == true,
            NotificationPurpose.Marketing => preference?.EmailMarketingEnabled == true,
            _ => false,
        };
        if (!wanted)
        {
            return Eligibility.Suppress(item.Purpose == NotificationPurpose.Marketing
                ? NotificationSuppressionCodes.MarketingConsentMissing
                : NotificationSuppressionCodes.EmailOptedOut);
        }

        if (preference?.QuietHours is { } window && NotificationQuietHoursPolicy.IsWithin(now, window, zone))
        {
            var nextAllowed = NotificationQuietHoursPolicy.NextAllowedInstantUtc(now, window, zone);
            return nextAllowed > now
                ? Eligibility.Defer(nextAllowed, NotificationDeferralCodes.QuietHours)
                // A window the policy cannot move past would be a bug, not a reason to email somebody
                // at 3am. Failing closed here is deliberate.
                : Eligibility.Suppress(NotificationSuppressionCodes.QuietHoursUnresolvable);
        }

        return Eligibility.Email();
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
                // in every other respect, so they are read as version 1; anything else is a build that
                // cannot read this payload, which no amount of retrying will change.
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
    /// One channel's artefact, its successful attempt and its completed delivery row, committed
    /// together.
    /// </summary>
    private async Task<NotificationDispatchOutcome> MaterializeAsync(
        ClaimedWork work,
        CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var provider = scope.ServiceProvider;
        provider.GetRequiredService<IMutableTenantContext>().SetTenant(work.TenantId);
        var context = provider.GetRequiredService<GymDbContext>();
        var activeWork = work;
        IAsyncDisposable? recipientPolicyLease = null;

        try
        {
            if (work.Channel == NotificationChannel.Email)
            {
                recipientPolicyLease = await NotificationAdvisoryLocks.AcquireRecipientPolicySessionAsync(
                    context,
                    work.TenantId,
                    work.RecipientUserId,
                    cancellationToken);
            }

            // Reserve and attempt are deliberately separate. A committed claim authorizes nothing;
            // current state is checked under the member policy lock, and quiet hours can still release
            // that claim without creating an attempt. Once the check passes, the Started attempt is
            // committed before any channel artefact is produced.
            var preparation = await context.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
            {
                await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
                var preparationNow = clock.UtcNow;
                var (delivery, item) = await LoadClaimedDeliveryAsync(context, work, cancellationToken);

                // Another worker may have reclaimed and completed this delivery while this worker was
                // paused after its claim commit. Neither the newer claim nor a terminal result may be
                // changed by the stale claimant.
                if (delivery.Status != NotificationDeliveryStatus.Processing ||
                    delivery.ClaimToken != work.ClaimToken)
                {
                    await transaction.CommitAsync(cancellationToken);
                    return MaterializationFinalization.Stale;
                }

                // A commit acknowledgement can be lost after the Started attempt became durable.
                // Re-enter that same attempt instead of incrementing the budget or inserting a second
                // row for the claim.
                var existingAttempt = await context.NotificationDeliveryAttempts
                    .AsNoTracking()
                    .SingleOrDefaultAsync(
                        attempt =>
                            attempt.ChannelDeliveryId == delivery.Id &&
                            attempt.ClaimToken == work.ClaimToken,
                        cancellationToken);
                if (existingAttempt is not null)
                {
                    await transaction.CommitAsync(cancellationToken);
                    return MaterializationFinalization.Prepared(
                        work with
                        {
                            AttemptId = existingAttempt.Id,
                            AttemptNumber = existingAttempt.AttemptNumber,
                        },
                        template: null);
                }

                // A committed claim is a lease, not authorization forever. Re-read every authoritative
                // relationship, the current preference and the current quiet-hours window. Email holds
                // the same recipient-policy lock through its Started commit and capture, so an opt-out
                // cannot commit in the gap between this decision and the transport call.
                var eligibility = await EvaluateAsync(context, item, delivery, preparationNow, cancellationToken);
                if (eligibility.Deferral is { } deferral)
                {
                    // Quiet hours started while this delivery was reserved. No attempt has started, so
                    // releasing the lease and moving the due instant spends no attempt or capacity.
                    delivery.Defer(preparationNow, deferral.NextAllowedAtUtc, deferral.Code);
                    await context.SaveChangesAsync(cancellationToken);
                    await transaction.CommitAsync(cancellationToken);
                    return new MaterializationFinalization(
                        MaterializationFinalizationKind.Deferred,
                        deferral.Code);
                }

                var attemptNumber = delivery.StartAttempt(work.ClaimToken, settings.MaximumAttempts);
                var attempt = NotificationDeliveryAttempt.Start(
                    work.TenantId,
                    work.OutboxItemId,
                    work.ChannelDeliveryId,
                    work.Channel,
                    attemptNumber,
                    work.ClaimToken,
                    preparationNow);
                context.NotificationDeliveryAttempts.Add(attempt);

                // The insert guard requires every attempt to be born Started. Flush it before any
                // terminal update, still inside this transaction.
                await context.SaveChangesAsync(cancellationToken);
                var startedWork = work with { AttemptId = attempt.Id, AttemptNumber = attemptNumber };

                if (eligibility.Suppression is { } suppression)
                {
                    // This attempt was already durably started. Suppression starts no replacement and
                    // earns no retry, but history must close the real attempt rather than delete it or
                    // leave it Started forever.
                    attempt.Suppress(preparationNow, suppression);
                    delivery.Suppress(work.ClaimToken, preparationNow, suppression);
                    await context.SaveChangesAsync(cancellationToken);
                    await transaction.CommitAsync(cancellationToken);
                    return new MaterializationFinalization(
                        MaterializationFinalizationKind.Suppressed,
                        suppression,
                        AttemptNumber: attemptNumber);
                }

                if (eligibility.PermanentFailure is { } permanent)
                {
                    attempt.FailPermanently(preparationNow, permanent);
                    delivery.MarkDeadLettered(work.ClaimToken, preparationNow, permanent);
                    await context.SaveChangesAsync(cancellationToken);
                    await transaction.CommitAsync(cancellationToken);
                    return new MaterializationFinalization(
                        MaterializationFinalizationKind.DeadLettered,
                        permanent,
                        AttemptNumber: attemptNumber);
                }

                await transaction.CommitAsync(cancellationToken);
                return MaterializationFinalization.Prepared(startedWork, eligibility.Template);
            });

            activeWork = preparation.StartedWork ?? work;
            var finalization = preparation.Kind == MaterializationFinalizationKind.Prepared
                ? await FinalizeStartedAttemptAsync(
                    provider,
                    context,
                    activeWork,
                    preparation.Template,
                    cancellationToken)
                : preparation;

            switch (finalization.Kind)
            {
                case MaterializationFinalizationKind.Materialized:
                    LogMaterialized(
                        logger,
                        work.OutboxItemId,
                        work.TenantId,
                        work.Kind.ToString(),
                        work.Channel.ToString(),
                        finalization.AttemptNumber,
                        null);
                    return NotificationDispatchOutcome.Empty with { Materialized = 1 };
                case MaterializationFinalizationKind.Suppressed:
                    LogSuppressed(
                        logger,
                        work.OutboxItemId,
                        work.TenantId,
                        work.Kind.ToString(),
                        work.Channel.ToString(),
                        finalization.Code!,
                        null);
                    return NotificationDispatchOutcome.Empty with { Suppressed = 1 };
                case MaterializationFinalizationKind.Deferred:
                    LogDeferred(
                        logger,
                        work.OutboxItemId,
                        work.TenantId,
                        work.Channel.ToString(),
                        finalization.Code!,
                        null);
                    return NotificationDispatchOutcome.Empty with { Deferred = 1 };
                case MaterializationFinalizationKind.DeadLettered:
                    LogDeadLettered(
                        logger,
                        work.OutboxItemId,
                        work.TenantId,
                        work.Kind.ToString(),
                        work.Channel.ToString(),
                        finalization.AttemptNumber,
                        finalization.Code!,
                        null);
                    return NotificationDispatchOutcome.Empty with { DeadLettered = 1 };
                case MaterializationFinalizationKind.Retry:
                    return await RecordFailureAsync(activeWork, finalization.Code!, cancellationToken);
                case MaterializationFinalizationKind.Stale:
                    return NotificationDispatchOutcome.Empty;
                default:
                    throw new InvalidOperationException("Unknown notification finalization.");
            }
        }
        catch (Exception exception) when (IsRecoverable(exception))
        {
            // The transaction rolled back, so nothing partial is visible. The failure is recorded in a
            // clean scope, because the context that failed is holding tracked state that failed with it.
            return await RecordFailureAsync(activeWork, NotificationFailureCodes.DispatchTransient, cancellationToken);
        }
        finally
        {
            if (recipientPolicyLease is not null)
            {
                await recipientPolicyLease.DisposeAsync();
            }
        }
    }

    private async Task<MaterializationFinalization> FinalizeStartedAttemptAsync(
        IServiceProvider provider,
        GymDbContext context,
        ClaimedWork work,
        NotificationTemplate? preparedTemplate,
        CancellationToken cancellationToken)
    {
        context.ChangeTracker.Clear();
        return await context.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
            var now = clock.UtcNow;
            var (delivery, attempt, item) = await LoadClaimedAsync(context, work, cancellationToken);
            if (delivery.Status != NotificationDeliveryStatus.Processing ||
                delivery.ClaimToken != work.ClaimToken ||
                attempt.ClaimToken != work.ClaimToken ||
                attempt.IsCompleted)
            {
                await transaction.CommitAsync(cancellationToken);
                return MaterializationFinalization.Stale;
            }

            var template = preparedTemplate;
            if (work.Channel == NotificationChannel.InApp && template is null)
            {
                var culture = await context.Tenants
                    .AsNoTracking()
                    .Where(candidate => candidate.Id == work.TenantId)
                    .Select(candidate => candidate.DefaultCulture)
                    .SingleAsync(cancellationToken);
                if (!NotificationTemplateCatalog.TryResolve(work.Kind, culture, out template))
                {
                    throw new InvalidOperationException("The in-app template was not prepared.");
                }
            }

            return work.Channel switch
            {
                NotificationChannel.InApp => await MaterializeInAppAsync(
                    context,
                    transaction,
                    work,
                    delivery,
                    attempt,
                    item,
                    template!,
                    now,
                    cancellationToken),
                NotificationChannel.Email => await MaterializeEmailAsync(
                    provider,
                    context,
                    transaction,
                    work,
                    delivery,
                    attempt,
                    now,
                    cancellationToken),
                _ => throw new InvalidOperationException("Unknown notification channel."),
            };
        });
    }

    /// <summary>
    /// The inbox row, its successful attempt and the completed in-app delivery, committed together.
    /// </summary>
    /// <remarks>
    /// The email channel never reaches this method, so an email retry cannot write, rewrite or
    /// duplicate an inbox row — and if it somehow did, the unique notification-per-source-intent index
    /// would refuse it. The two channels touch entirely different tables.
    /// </remarks>
    private static async Task<MaterializationFinalization> MaterializeInAppAsync(
        GymDbContext context,
        IDbContextTransaction transaction,
        ClaimedWork work,
        NotificationChannelDelivery delivery,
        NotificationDeliveryAttempt attempt,
        NotificationOutboxItem item,
        NotificationTemplate template,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        // A replay after a crash between the insert and the commit finds its own notification already
        // there. That is a success, not a duplicate: the unique constraint on the source intent is what
        // makes at-least-once delivery safe to repeat.
        var alreadyMaterialized = await context.Notifications
            .AnyAsync(existing => existing.SourceOutboxItemId == item.Id, cancellationToken);
        if (!alreadyMaterialized)
        {
            context.Notifications.Add(Notification.Materialize(
                work.TenantId,
                work.RecipientUserId,
                item.Id,
                item.Kind,
                template));
        }

        attempt.Succeed(now);
        delivery.MarkMaterialized(work.ClaimToken, now);
        await context.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return MaterializationFinalization.Materialized(attempt.AttemptNumber);
    }

    /// <summary>
    /// Resolves the recipient, rechecks suppression, renders the generic service wording, hands both
    /// to the configured transport, and records only what happened.
    /// </summary>
    /// <remarks>
    /// The address, the subject and the body exist as local variables for the duration of one call.
    /// None of them is written to the delivery, the attempt, the intent, a dead-letter row or a log
    /// line; with the captured adapter the content exists only in that adapter's own memory, and with
    /// the provider adapter it exists only inside one HTTPS request. The recipient is resolved here
    /// rather than snapshotted at scheduling time precisely so that a queue row never holds an address.
    /// <para>
    /// Suppression is rechecked here, at the same boundary the preference recheck uses and under the
    /// same recipient-policy lock, because it is the same class of fact: something authoritative that
    /// may have become true after the claim committed. A mailbox that hard-bounced or complained must
    /// not receive one more message merely because the work was already reserved. The provider-event
    /// route takes the same lock before it writes a suppression, so the two cannot interleave.
    /// </para>
    /// <para>
    /// The mailbox is compared as a keyed fingerprint under every configured key, not just the active
    /// one. Rotating the fingerprint key must not silently resume mail to an address that bounced
    /// under the previous one.
    /// </para>
    /// </remarks>
    private async Task<MaterializationFinalization> MaterializeEmailAsync(
        IServiceProvider provider,
        GymDbContext context,
        IDbContextTransaction transaction,
        ClaimedWork work,
        NotificationChannelDelivery delivery,
        NotificationDeliveryAttempt attempt,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var transport = provider.GetService<INotificationEmailTransport>();
        if (transport is null)
        {
            // Configuration says email is available and composition disagrees. Fail closed rather than
            // retrying forever against a transport that does not exist.
            return await SuppressEmailAsync(
                context,
                transaction,
                work,
                delivery,
                attempt,
                now,
                NotificationSuppressionCodes.EmailChannelUnavailable,
                cancellationToken);
        }

        var contacts = provider.GetRequiredService<INotificationRecipientContacts>();
        var contact = await contacts.ResolveAsync(work.TenantId, work.RecipientUserId, cancellationToken);

        // An unconfirmed address is not a delivery target. Mailing one both risks a stranger's inbox
        // and teaches a mail provider that this sender writes to addresses nobody verified.
        if (contact is null || !contact.EmailConfirmed)
        {
            return await SuppressEmailAsync(
                context,
                transaction,
                work,
                delivery,
                attempt,
                now,
                NotificationSuppressionCodes.EmailAddressUnavailable,
                cancellationToken);
        }

        var fingerprintKeys = email.Provider.ResolveFingerprintKeys();
        if (transport.ContactsProvider && fingerprintKeys.Count == 0)
        {
            // A real provider with no fingerprint key cannot have its suppressions checked, and
            // sending to a mailbox whose bounce cannot be honoured is exactly what destroys a sending
            // reputation. Startup already refuses this configuration; failing closed here as well
            // means a runtime options reload cannot open a hole startup would have closed.
            return await SuppressEmailAsync(
                context,
                transaction,
                work,
                delivery,
                attempt,
                now,
                NotificationSuppressionCodes.EmailChannelUnavailable,
                cancellationToken);
        }

        string? activeFingerprint = null;
        string? activeFingerprintKeyId = null;
        if (fingerprintKeys.Count > 0)
        {
            // ResolveFingerprintKeys returns the active key first, so the leading fingerprint is the
            // one new evidence is recorded under and the rest exist only to keep older suppressions
            // matching across a rotation.
            var fingerprints = NotificationAddressFingerprint.ComputeAll(fingerprintKeys, contact.EmailAddress);
            activeFingerprint = fingerprints[0];
            activeFingerprintKeyId = fingerprintKeys[0].KeyId;
            var suppressed = await context.NotificationEmailSuppressions
                .AsNoTracking()
                .AnyAsync(
                    candidate => candidate.UserId == work.RecipientUserId &&
                                 fingerprints.Contains(candidate.AddressFingerprint),
                    cancellationToken);
            if (suppressed)
            {
                return await SuppressEmailAsync(
                    context,
                    transaction,
                    work,
                    delivery,
                    attempt,
                    now,
                    NotificationSuppressionCodes.EmailAddressSuppressed,
                    cancellationToken);
            }
        }

        var logicalKey = NotificationDeliveryAttempt.BuildIdempotencyKey(
            work.OutboxItemId,
            NotificationChannel.Email);
        var template = NotificationTemplateCatalog.ServiceEmailV1;
        var result = await transport.SendAsync(
            new NotificationEmailMessage(
                work.TenantId,
                work.OutboxItemId,
                activeFingerprint is null
                    ? logicalKey
                    : NotificationDeliveryAttempt.BuildProviderIdempotencyKey(logicalKey, activeFingerprint),
                contact.EmailAddress,
                template.Title,
                template.Body),
            cancellationToken);

        switch (result.Outcome)
        {
            case NotificationEmailTransportOutcome.Captured:
                // Captured, and named that way. No provider was contacted, so no provider message
                // identifier is recorded and no acceptance is claimed.
                attempt.Succeed(now);
                delivery.MarkMaterialized(work.ClaimToken, now, transport.AdapterName);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return MaterializationFinalization.Materialized(attempt.AttemptNumber);

            case NotificationEmailTransportOutcome.ProviderAccepted:
                return await RecordProviderAcceptanceAsync(
                    context,
                    transaction,
                    work,
                    delivery,
                    attempt,
                    transport,
                    result.ProviderMessageId,
                    activeFingerprint,
                    activeFingerprintKeyId,
                    now,
                    cancellationToken);

            case NotificationEmailTransportOutcome.PermanentFailure:
                var permanent = result.FailureCode ?? NotificationFailureCodes.EmailTransportPermanent;
                attempt.FailPermanently(now, permanent);
                delivery.MarkDeadLettered(work.ClaimToken, now, permanent);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return new MaterializationFinalization(
                    MaterializationFinalizationKind.DeadLettered,
                    permanent,
                    AttemptNumber: attempt.AttemptNumber);

            default:
                // Rolled back deliberately: the failure is recorded by RecordFailureAsync in a clean
                // scope, which is also the path a thrown transport exception takes, so both look the
                // same in history.
                await transaction.RollbackAsync(cancellationToken);
                return new MaterializationFinalization(
                    MaterializationFinalizationKind.Retry,
                    result.FailureCode ?? NotificationFailureCodes.EmailTransportTransient,
                    AttemptNumber: attempt.AttemptNumber);
        }
    }

    /// <summary>
    /// Records that a real provider took responsibility for this message, and the durable relationship
    /// its later events will resolve through.
    /// </summary>
    /// <remarks>
    /// The delivery becomes terminal and records provider acceptance in the same statement, which is
    /// what keeps a terminal delivery immutable while still carrying the one provider fact that was
    /// established synchronously. Everything the provider says afterwards belongs to the
    /// <see cref="NotificationProviderMessage"/> written here.
    /// <para>
    /// An adapter that reports acceptance it cannot own — a capture claiming a provider identifier, an
    /// identifier that fails validation, a send with no fingerprint to correlate a bounce through — is
    /// a permanent failure rather than a recorded success. Writing evidence a provider did not give is
    /// worse than not delivering.
    /// </para>
    /// </remarks>
    private static async Task<MaterializationFinalization> RecordProviderAcceptanceAsync(
        GymDbContext context,
        IDbContextTransaction transaction,
        ClaimedWork work,
        NotificationChannelDelivery delivery,
        NotificationDeliveryAttempt attempt,
        INotificationEmailTransport transport,
        string? providerMessageId,
        string? activeFingerprint,
        string? activeFingerprintKeyId,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        if (!transport.ContactsProvider ||
            !NotificationProviderMessageId.IsValid(providerMessageId) ||
            activeFingerprint is null ||
            activeFingerprintKeyId is null)
        {
            var invalid = NotificationFailureCodes.EmailProviderResponseInvalid;
            attempt.FailPermanently(now, invalid);
            delivery.MarkDeadLettered(work.ClaimToken, now, invalid);
            await context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return new MaterializationFinalization(
                MaterializationFinalizationKind.DeadLettered,
                invalid,
                AttemptNumber: attempt.AttemptNumber);
        }

        attempt.Succeed(now, providerMessageId);
        delivery.MarkMaterialized(work.ClaimToken, now, transport.AdapterName, providerMessageId);
        context.NotificationProviderMessages.Add(NotificationProviderMessage.Record(
            work.TenantId,
            work.OutboxItemId,
            work.ChannelDeliveryId,
            work.RecipientUserId,
            transport.AdapterName,
            providerMessageId!,
            activeFingerprint,
            activeFingerprintKeyId,
            now));
        await context.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return MaterializationFinalization.Materialized(attempt.AttemptNumber);
    }

    /// <summary>
    /// One channel-only suppression, committed with its already-started attempt.
    /// </summary>
    /// <remarks>
    /// The attempt is real history and closes as suppressed; no replacement attempt is created and no
    /// retry is earned. In-app is not touched, ever: a mailbox refusing mail is not a member losing
    /// what they are entitled to be told.
    /// </remarks>
    private static async Task<MaterializationFinalization> SuppressEmailAsync(
        GymDbContext context,
        IDbContextTransaction transaction,
        ClaimedWork work,
        NotificationChannelDelivery delivery,
        NotificationDeliveryAttempt attempt,
        DateTimeOffset now,
        string reasonCode,
        CancellationToken cancellationToken)
    {
        attempt.Suppress(now, reasonCode);
        delivery.Suppress(work.ClaimToken, now, reasonCode);
        await context.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new MaterializationFinalization(
            MaterializationFinalizationKind.Suppressed,
            reasonCode,
            AttemptNumber: attempt.AttemptNumber);
    }

    private static async Task<(NotificationChannelDelivery Delivery, NotificationOutboxItem Item)> LoadClaimedDeliveryAsync(
        GymDbContext context,
        ClaimedWork work,
        CancellationToken cancellationToken)
    {
        var delivery = await context.NotificationChannelDeliveries
            .SingleAsync(candidate => candidate.Id == work.ChannelDeliveryId, cancellationToken);
        var item = await context.NotificationOutboxItems
            .AsNoTracking()
            .SingleAsync(candidate => candidate.Id == work.OutboxItemId, cancellationToken);
        return (delivery, item);
    }

    private static async Task<(NotificationChannelDelivery Delivery, NotificationDeliveryAttempt Attempt, NotificationOutboxItem Item)> LoadClaimedAsync(
        GymDbContext context,
        ClaimedWork work,
        CancellationToken cancellationToken)
    {
        var delivery = await context.NotificationChannelDeliveries
            .SingleAsync(candidate => candidate.Id == work.ChannelDeliveryId, cancellationToken);
        var attempt = await context.NotificationDeliveryAttempts
            .SingleAsync(
                candidate => work.AttemptId != Guid.Empty
                    ? candidate.Id == work.AttemptId
                    : candidate.ChannelDeliveryId == work.ChannelDeliveryId &&
                      candidate.ClaimToken == work.ClaimToken,
                cancellationToken);
        var item = await context.NotificationOutboxItems
            .AsNoTracking()
            .SingleAsync(candidate => candidate.Id == work.OutboxItemId, cancellationToken);
        return (delivery, attempt, item);
    }

    /// <summary>
    /// Records a transient failure against the claim that suffered it, and either schedules this
    /// channel's next attempt from <c>notification-exponential-v1</c> or dead-letters the delivery
    /// because its own schedule is exhausted. No other channel of the same notification is touched.
    /// </summary>
    private async Task<NotificationDispatchOutcome> RecordFailureAsync(
        ClaimedWork work,
        string failureCode,
        CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var provider = scope.ServiceProvider;
        provider.GetRequiredService<IMutableTenantContext>().SetTenant(work.TenantId);
        var context = provider.GetRequiredService<GymDbContext>();
        var now = clock.UtcNow;

        try
        {
            var (delivery, attempt, _) = await LoadClaimedAsync(context, work, cancellationToken);

            // The lease may already have expired and been taken over while this attempt was running.
            // The newer claimant owns the delivery now, so this one records nothing at all rather than
            // overwriting a result it no longer has any right to.
            if (delivery.Status != NotificationDeliveryStatus.Processing ||
                delivery.ClaimToken != work.ClaimToken ||
                attempt.IsCompleted)
            {
                return NotificationDispatchOutcome.Empty;
            }

            attempt.FailTransiently(now, failureCode);
            var attemptNumber = attempt.AttemptNumber;
            var next = NotificationRetryPolicy.NextAttemptAtUtc(
                attemptNumber,
                settings.MaximumAttempts,
                now);
            if (next is { } nextAttemptAtUtc)
            {
                delivery.MarkRetrying(work.ClaimToken, nextAttemptAtUtc, failureCode);
                await context.SaveChangesAsync(cancellationToken);
                LogRetrying(
                    logger,
                    work.OutboxItemId,
                    work.TenantId,
                    work.Kind.ToString(),
                    work.Channel.ToString(),
                    attemptNumber,
                    failureCode,
                    null);
                return NotificationDispatchOutcome.Empty with { Retried = 1 };
            }

            delivery.MarkDeadLettered(
                work.ClaimToken,
                now,
                NotificationFailureCodes.AttemptsExhausted);
            await context.SaveChangesAsync(cancellationToken);
            LogDeadLettered(
                logger,
                work.OutboxItemId,
                work.TenantId,
                work.Kind.ToString(),
                work.Channel.ToString(),
                attemptNumber,
                NotificationFailureCodes.AttemptsExhausted,
                null);
            return NotificationDispatchOutcome.Empty with { DeadLettered = 1 };
        }
        catch (Exception exception) when (IsRecoverable(exception))
        {
            // Even recording the failure failed. The claim lease still expires, so the delivery becomes
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
    /// No exception object reaches a log from this sweep. Each failure is classified into a stable code
    /// first, because the exception is where an untrusted provider response, a recipient address or a
    /// connection string would turn up once a real transport exists.
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
        Guid ChannelDeliveryId,
        NotificationChannel Channel,
        CommercialNotificationKind Kind,
        Guid RecipientUserId,
        Guid ClaimToken,
        Guid AttemptId,
        int AttemptNumber);

    private sealed record MaterializationFinalization(
        MaterializationFinalizationKind Kind,
        string? Code = null,
        ClaimedWork? StartedWork = null,
        NotificationTemplate? Template = null,
        int AttemptNumber = 0)
    {
        public static MaterializationFinalization Materialized(int attemptNumber) =>
            new(MaterializationFinalizationKind.Materialized, AttemptNumber: attemptNumber);

        public static MaterializationFinalization Prepared(
            ClaimedWork work,
            NotificationTemplate? template) =>
            new(
                MaterializationFinalizationKind.Prepared,
                StartedWork: work,
                Template: template,
                AttemptNumber: work.AttemptNumber);

        public static MaterializationFinalization Stale { get; } =
            new(MaterializationFinalizationKind.Stale);
    }

    private enum MaterializationFinalizationKind
    {
        Materialized = 1,
        Suppressed = 2,
        DeadLettered = 3,
        Stale = 4,
        Deferred = 5,
        Retry = 6,
        Prepared = 7,
    }

    private sealed record QuietHoursDeferral(DateTimeOffset NextAllowedAtUtc, string Code);

    private sealed record Eligibility(
        NotificationTemplate? Template,
        string? Suppression,
        string? PermanentFailure,
        QuietHoursDeferral? Deferral = null)
    {
        public static Eligibility InApp(NotificationTemplate template) => new(template, null, null);

        /// <summary>Email renders one fixed generic wording, so it carries no per-kind template.</summary>
        public static Eligibility Email() => new(null, null, null);

        public static Eligibility Suppress(string code) => new(null, code, null);

        public static Eligibility Permanent(string code) => new(null, null, code);

        public static Eligibility Defer(DateTimeOffset nextAllowedAtUtc, string code) =>
            new(null, null, null, new QuietHoursDeferral(nextAllowedAtUtc, code));
    }
}
