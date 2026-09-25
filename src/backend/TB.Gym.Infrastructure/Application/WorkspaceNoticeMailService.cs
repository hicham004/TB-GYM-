using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.PlatformBilling;
using TB.Gym.Modules.Tenancy;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// The tenant-owned dispatcher for workspace notices (ADR 0027).
/// </summary>
/// <remarks>
/// The invitation dispatcher's sequence without its token: claim under a lease, re-establish that the
/// notice is still true and to whom, start and commit an attempt, send, and finalize as materialized,
/// retrying, suppressed or dead-lettered. The recipient is a current or former member, so eligibility is
/// the notice's own fact rather than an active membership — a released client is by definition no
/// longer active, and is exactly who this queue exists to reach.
/// <para>
/// Every tenant-owned write happens in a fresh scope after <c>SetTenant</c>, so the write-scope guard
/// applies to each row this worker touches. Log lines carry the request id, the attempt number and a
/// stable code; never an address, a name or wording.
/// </para>
/// </remarks>
internal sealed class WorkspaceNoticeMailService(
    IServiceScopeFactory scopeFactory,
    IClock clock,
    IOptions<ActionMailDispatchOptions> options,
    ILogger<WorkspaceNoticeMailService> logger,
    IActionEmailTransport? transport = null)
    : IWorkspaceNoticeMailDispatchService
{
    private static readonly Action<ILogger, Guid, int, string, Exception?> LogMaterialized =
        LoggerMessage.Define<Guid, int, string>(
            LogLevel.Information,
            new EventId(6171, "WorkspaceNoticeMailMaterialized"),
            "Workspace notice {RequestId} materialized on attempt {AttemptNumber} through {TransportAdapter}.");

    private static readonly Action<ILogger, Guid, string, Exception?> LogSuppressed =
        LoggerMessage.Define<Guid, string>(
            LogLevel.Information,
            new EventId(6172, "WorkspaceNoticeMailSuppressed"),
            "Workspace notice {RequestId} was suppressed: {ReasonCode}.");

    private static readonly Action<ILogger, Guid, int, string, Exception?> LogRetrying =
        LoggerMessage.Define<Guid, int, string>(
            LogLevel.Warning,
            new EventId(6173, "WorkspaceNoticeMailRetrying"),
            "Workspace notice {RequestId} attempt {AttemptNumber} failed with {FailureCode} and will retry.");

    private static readonly Action<ILogger, Guid, int, string, Exception?> LogDeadLettered =
        LoggerMessage.Define<Guid, int, string>(
            LogLevel.Error,
            new EventId(6174, "WorkspaceNoticeMailDeadLettered"),
            "Workspace notice {RequestId} was dead-lettered after {AttemptNumber} attempts with {FailureCode}.");

    private static readonly Action<ILogger, Guid, int, Exception?> LogReclaimed =
        LoggerMessage.Define<Guid, int>(
            LogLevel.Warning,
            new EventId(6175, "WorkspaceNoticeMailReclaimed"),
            "Workspace notice {RequestId} attempt {AttemptNumber} was abandoned when its lease expired.");

    private readonly ActionMailDispatchOptions settings = options.Value;

    public async Task<WorkspaceNoticeMailDispatchOutcome> DispatchDueAsync(CancellationToken cancellationToken)
    {
        if (!settings.SweepEnabled || settings.BatchSize <= 0)
        {
            return new WorkspaceNoticeMailDispatchOutcome();
        }

        var now = clock.UtcNow;
        List<Guid> tenantIds;
        await using (var readScope = scopeFactory.CreateAsyncScope())
        {
            // The only global read in the sweep, and read-only.
            var readContext = readScope.ServiceProvider.GetRequiredService<GymDbContext>();
            tenantIds = await readContext.WorkspaceNoticeMailRequests
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(item =>
                    (item.Status == WorkspaceNoticeMailStatus.Pending && item.NextAttemptAtUtc <= now) ||
                    (item.Status == WorkspaceNoticeMailStatus.Processing &&
                     item.ClaimExpiresAtUtc != null &&
                     item.ClaimExpiresAtUtc <= now))
                .Select(item => item.TenantId)
                .Distinct()
                .OrderBy(tenantId => tenantId)
                .Take(settings.BatchSize)
                .ToListAsync(cancellationToken);
        }

        var outcome = new WorkspaceNoticeMailDispatchOutcome();
        var remaining = settings.BatchSize;
        foreach (var tenantId in tenantIds)
        {
            if (remaining <= 0)
            {
                break;
            }

            var claim = await ClaimAsync(tenantId, now, remaining, cancellationToken);
            outcome = outcome.Add(claim.Outcome);
            remaining -= claim.Work.Count;
            foreach (var work in claim.Work)
            {
                outcome = outcome.Add(await MaterializeAsync(work, cancellationToken));
            }
        }

        return outcome;
    }

    private async Task<ClaimResult> ClaimAsync(
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
            var candidates = await context.WorkspaceNoticeMailRequests
                .FromSql($"""
                    SELECT *, xmin FROM tenancy."NoticeMailRequests"
                    WHERE "TenantId" = {tenantId}
                      AND (("Status" = 'Pending' AND "NextAttemptAtUtc" <= {now})
                           OR ("Status" = 'Processing' AND "ClaimExpiresAtUtc" IS NOT NULL AND "ClaimExpiresAtUtc" <= {now}))
                    ORDER BY "NextAttemptAtUtc", "Id"
                    LIMIT {limit}
                    FOR UPDATE SKIP LOCKED
                    """)
                .ToListAsync(cancellationToken);

            var outcome = new WorkspaceNoticeMailDispatchOutcome();
            var work = new List<ClaimedWork>();
            foreach (var request in candidates)
            {
                if (await AbandonExpiredAttemptAsync(context, request, now, cancellationToken))
                {
                    outcome = outcome with { Reclaimed = outcome.Reclaimed + 1 };
                }

                if (request.SchemaVersion != WorkspaceNoticeMailRequest.CurrentSchemaVersion ||
                    request.AttemptCount >= settings.MaximumAttempts)
                {
                    request.MarkAttemptsExhausted(now);
                    LogDeadLettered(logger, request.Id, request.AttemptCount, WorkspaceNoticeMailCodes.AttemptsExhausted, null);
                    outcome = outcome with { DeadLettered = outcome.DeadLettered + 1 };
                    continue;
                }

                var claimToken = request.Claim(
                    now,
                    TimeSpan.FromSeconds(settings.ClaimLeaseSeconds),
                    settings.MaximumAttempts);
                work.Add(new ClaimedWork(tenantId, request.Id, claimToken));
                outcome = outcome with { Claimed = outcome.Claimed + 1 };
            }

            await context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return new ClaimResult(outcome, work);
        });
    }

    private async Task<bool> AbandonExpiredAttemptAsync(
        GymDbContext context,
        WorkspaceNoticeMailRequest request,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        if (!request.IsClaimExpired(now) || request.ClaimToken is not { } expiredToken)
        {
            return false;
        }

        var unfinished = await context.WorkspaceNoticeMailAttempts
            .Where(attempt =>
                attempt.RequestId == request.Id &&
                attempt.ClaimToken == expiredToken &&
                attempt.Outcome == WorkspaceNoticeMailOutcome.Started)
            .ToListAsync(cancellationToken);
        foreach (var attempt in unfinished)
        {
            attempt.Abandon(now, WorkspaceNoticeMailCodes.ClaimExpired);
            LogReclaimed(logger, request.Id, attempt.AttemptNumber, null);
        }

        return true;
    }

    private async Task<WorkspaceNoticeMailDispatchOutcome> MaterializeAsync(
        ClaimedWork work,
        CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var provider = scope.ServiceProvider;
        provider.GetRequiredService<IMutableTenantContext>().SetTenant(work.TenantId);
        var context = provider.GetRequiredService<GymDbContext>();
        var fingerprints = provider.GetRequiredService<ActionMailFingerprintKeyring>();

        var preparation = await context.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
            var now = clock.UtcNow;
            var request = await context.WorkspaceNoticeMailRequests
                .SingleOrDefaultAsync(item => item.Id == work.RequestId, cancellationToken);
            if (request is null ||
                request.Status != WorkspaceNoticeMailStatus.Processing ||
                request.ClaimToken != work.ClaimToken)
            {
                await transaction.CommitAsync(cancellationToken);
                return Preparation.Stale;
            }

            var existing = await context.WorkspaceNoticeMailAttempts
                .SingleOrDefaultAsync(
                    attempt => attempt.RequestId == request.Id && attempt.ClaimToken == work.ClaimToken,
                    cancellationToken);
            if (existing is not null)
            {
                await transaction.CommitAsync(cancellationToken);
                return Preparation.Started(existing.Id, existing.AttemptNumber, existing.ProviderIdempotencyKey, request.Kind);
            }

            var eligibility = await EvaluateAsync(context, request, clock.UtcNow, cancellationToken);
            if (eligibility.SuppressionCode is { } suppression)
            {
                request.Suppress(work.ClaimToken, now, suppression);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return Preparation.Suppressed(suppression);
            }

            var attemptNumber = request.StartAttempt(work.ClaimToken, settings.MaximumAttempts);
            var idempotencyKey = WorkspaceNoticeMailAttempt.BuildProviderIdempotencyKey(
                request.Id,
                attemptNumber,
                fingerprints.Compute(eligibility.Address!));
            var attempt = WorkspaceNoticeMailAttempt.Start(
                work.TenantId,
                request.Id,
                attemptNumber,
                work.ClaimToken,
                idempotencyKey,
                now);
            context.WorkspaceNoticeMailAttempts.Add(attempt);
            await context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return Preparation.Started(attempt.Id, attemptNumber, idempotencyKey, request.Kind);
        });

        if (preparation.Kind == PreparationKind.Stale)
        {
            return new WorkspaceNoticeMailDispatchOutcome();
        }

        if (preparation.Kind == PreparationKind.Suppressed)
        {
            LogSuppressed(logger, work.RequestId, preparation.Code!, null);
            return new WorkspaceNoticeMailDispatchOutcome(Suppressed: 1);
        }

        return await SendAsync(context, work, preparation, cancellationToken);
    }

    private async Task<WorkspaceNoticeMailDispatchOutcome> SendAsync(
        GymDbContext context,
        ClaimedWork work,
        Preparation preparation,
        CancellationToken cancellationToken)
    {
        if (transport is null)
        {
            return await FinalizeAsync(
                context,
                work,
                preparation,
                FinalOutcome.Retryable(WorkspaceNoticeMailCodes.TransportUnavailable),
                cancellationToken);
        }

        // A committed Started attempt is evidence that work began, not permission to send. Re-check
        // after that commit, so a change in the boundary is honoured before anybody is emailed.
        var request = await context.WorkspaceNoticeMailRequests
            .AsNoTracking()
            .SingleAsync(item => item.Id == work.RequestId, cancellationToken);
        var eligibility = await EvaluateAsync(context, request, clock.UtcNow, cancellationToken);
        if (eligibility.SuppressionCode is { } suppression)
        {
            return await FinalizeAsync(context, work, preparation, FinalOutcome.Suppression(suppression), cancellationToken);
        }

        var content = WorkspaceNoticeEmailTemplates.Render(preparation.NoticeKind);
        var result = await transport.SendAsync(
            new ActionEmailMessage(
                ActionMailScopes.WorkspaceNotice,
                work.RequestId,
                preparation.AttemptNumber,
                preparation.IdempotencyKey!,
                eligibility.Address!,
                content.Subject,
                content.Body),
            cancellationToken);

        return await FinalizeAsync(context, work, preparation, Classify(result), cancellationToken);
    }

    /// <summary>
    /// Whether the notice still states something true, and to which address. Read fresh every time.
    /// </summary>
    private static async Task<Eligibility> EvaluateAsync(
        GymDbContext context,
        WorkspaceNoticeMailRequest request,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var tenantIsActive = await context.Tenants
            .AsNoTracking()
            .AnyAsync(tenant => tenant.Id == request.TenantId && tenant.IsActive, cancellationToken);
        if (!tenantIsActive)
        {
            return Eligibility.Suppress(WorkspaceNoticeMailCodes.TenantInactive);
        }

        var recipient = await context.Users
            .AsNoTracking()
            .Where(user => user.Id == request.RecipientUserId)
            .Select(user => new { user.Email, user.IsPlatformBlocked })
            .SingleOrDefaultAsync(cancellationToken);
        if (recipient is null || recipient.IsPlatformBlocked || string.IsNullOrWhiteSpace(recipient.Email))
        {
            return Eligibility.Suppress(WorkspaceNoticeMailCodes.RecipientUnavailable);
        }

        var stillTrue = request.Kind switch
        {
            // Released, still the recipient's own profile, and no active membership came back.
            WorkspaceNoticeKind.ClientReleased =>
                await context.ClientProfiles.AsNoTracking().AnyAsync(
                    client =>
                        client.Id == request.SubjectId &&
                        client.UserId == request.RecipientUserId &&
                        client.ReleasedAtUtc != null,
                    cancellationToken) &&
                !await context.TenantMemberships.AsNoTracking().AnyAsync(
                    membership =>
                        membership.TenantId == request.TenantId &&
                        membership.UserId == request.RecipientUserId &&
                        membership.Status == MembershipStatus.Active,
                    cancellationToken),
            // Still a current client of this workspace, through the same profile the history entry
            // moved; a client who has since left or been released is not told about a coach.
            WorkspaceNoticeKind.CoachDeparted =>
                await (
                    from entry in context.ClientCoachAssignments.AsNoTracking()
                    join client in context.ClientProfiles.AsNoTracking() on entry.ClientProfileId equals client.Id
                    where entry.Id == request.SubjectId &&
                          client.UserId == request.RecipientUserId &&
                          client.ReleasedAtUtc == null
                    select client.Id)
                    .AnyAsync(cancellationToken) &&
                await context.TenantMemberships.AsNoTracking().AnyAsync(
                    membership =>
                        membership.TenantId == request.TenantId &&
                        membership.UserId == request.RecipientUserId &&
                        membership.Role == TenantRole.Client &&
                        membership.Status == MembershipStatus.Active,
                    cancellationToken),
            WorkspaceNoticeKind.InvoiceIssued or WorkspaceNoticeKind.InvoiceDueSoon or WorkspaceNoticeKind.InvoiceOverdue =>
                await BillingNoticeStillTrueAsync(context, request, PaymentSchedule.Today(now), cancellationToken),
            _ => false,
        };

        return stillTrue
            ? Eligibility.Allowed(recipient.Email)
            : Eligibility.Suppress(WorkspaceNoticeMailCodes.StateChanged);
    }

    /// <summary>
    /// A billing notice (ADR 0028) is worth sending while the invoice still owes money — not voided, not
    /// paid — to the workspace's current owner. "Due soon" is not sent once the invoice is overdue.
    /// </summary>
    private static async Task<bool> BillingNoticeStillTrueAsync(
        GymDbContext context,
        WorkspaceNoticeMailRequest request,
        DateOnly today,
        CancellationToken cancellationToken)
    {
        var invoice = await WorkspaceBillingLock.UnpaidInvoices(context, request.TenantId)
            .Where(item => item.Id == request.SubjectId)
            .Select(item => new { item.DueOn })
            .SingleOrDefaultAsync(cancellationToken);
        if (invoice is null || (request.Kind == WorkspaceNoticeKind.InvoiceDueSoon && today > invoice.DueOn))
        {
            return false;
        }

        return await context.TenantMemberships.AsNoTracking().AnyAsync(
            membership =>
                membership.TenantId == request.TenantId &&
                membership.UserId == request.RecipientUserId &&
                membership.Role == TenantRole.Owner &&
                membership.Status == MembershipStatus.Active,
            cancellationToken);
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
            ResendFailureKind.RetryableConflict => FinalOutcome.Retryable(WorkspaceNoticeMailCodes.TransportTransient),
            _ => FinalOutcome.Permanent(WorkspaceNoticeMailCodes.TransportPermanent),
        },
    };

    private async Task<WorkspaceNoticeMailDispatchOutcome> FinalizeAsync(
        GymDbContext context,
        ClaimedWork work,
        Preparation preparation,
        FinalOutcome final,
        CancellationToken cancellationToken)
    {
        var kind = await context.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
            var now = clock.UtcNow;
            var request = await context.WorkspaceNoticeMailRequests
                .SingleOrDefaultAsync(item => item.Id == work.RequestId, cancellationToken);
            var attempt = await context.WorkspaceNoticeMailAttempts
                .SingleOrDefaultAsync(item => item.Id == preparation.AttemptId, cancellationToken);
            if (request is null ||
                attempt is null ||
                attempt.IsCompleted ||
                request.Status != WorkspaceNoticeMailStatus.Processing ||
                request.ClaimToken != work.ClaimToken)
            {
                await transaction.CommitAsync(cancellationToken);
                return PreparationKind.Stale;
            }

            PreparationKind result;
            if (final.IsSuccess)
            {
                attempt.Succeed(now, final.ProviderMessageId);
                request.MarkMaterialized(work.ClaimToken, now, transport!.AdapterName, final.ProviderMessageId);
                result = PreparationKind.Materialized;
            }
            else if (final.SuppressionCode is { } suppression)
            {
                attempt.Suppress(now, suppression);
                request.Suppress(work.ClaimToken, now, suppression);
                result = PreparationKind.Suppressed;
            }
            else if (final.IsRetryable &&
                     WorkspaceNoticeMailRetryPolicy.NextAttemptAtUtc(
                         preparation.AttemptNumber,
                         settings.MaximumAttempts,
                         now) is { } nextAttemptAtUtc)
            {
                attempt.FailTransiently(now, final.FailureCode!);
                request.MarkRetrying(work.ClaimToken, nextAttemptAtUtc, final.FailureCode!);
                result = PreparationKind.Retried;
            }
            else
            {
                if (final.IsRetryable)
                {
                    attempt.FailTransiently(now, final.FailureCode!);
                }
                else
                {
                    attempt.FailPermanently(now, final.FailureCode!);
                }

                request.MarkDeadLettered(work.ClaimToken, now, final.FailureCode!);
                result = PreparationKind.DeadLettered;
            }

            await context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return result;
        });

        switch (kind)
        {
            case PreparationKind.Materialized:
                LogMaterialized(logger, work.RequestId, preparation.AttemptNumber, transport!.AdapterName, null);
                return new WorkspaceNoticeMailDispatchOutcome(Materialized: 1);
            case PreparationKind.Suppressed:
                LogSuppressed(logger, work.RequestId, final.SuppressionCode!, null);
                return new WorkspaceNoticeMailDispatchOutcome(Suppressed: 1);
            case PreparationKind.Retried:
                LogRetrying(logger, work.RequestId, preparation.AttemptNumber, final.FailureCode!, null);
                return new WorkspaceNoticeMailDispatchOutcome(Retried: 1);
            case PreparationKind.DeadLettered:
                LogDeadLettered(logger, work.RequestId, preparation.AttemptNumber, final.FailureCode!, null);
                return new WorkspaceNoticeMailDispatchOutcome(DeadLettered: 1);
            default:
                return new WorkspaceNoticeMailDispatchOutcome();
        }
    }

    private sealed record ClaimedWork(Guid TenantId, Guid RequestId, Guid ClaimToken);

    private sealed record ClaimResult(WorkspaceNoticeMailDispatchOutcome Outcome, IReadOnlyList<ClaimedWork> Work);

    private sealed record Eligibility(string? Address, string? SuppressionCode)
    {
        public static Eligibility Allowed(string address) => new(address, null);

        public static Eligibility Suppress(string code) => new(null, code);
    }

    private enum PreparationKind
    {
        Stale = 0,
        Started = 1,
        Suppressed = 2,
        Materialized = 3,
        Retried = 4,
        DeadLettered = 5,
    }

    private sealed record Preparation(
        PreparationKind Kind,
        Guid AttemptId = default,
        int AttemptNumber = 0,
        string? IdempotencyKey = null,
        WorkspaceNoticeKind NoticeKind = WorkspaceNoticeKind.ClientReleased,
        string? Code = null)
    {
        public static Preparation Stale { get; } = new(PreparationKind.Stale);

        public static Preparation Started(Guid attemptId, int attemptNumber, string idempotencyKey, WorkspaceNoticeKind kind) =>
            new(PreparationKind.Started, attemptId, attemptNumber, idempotencyKey, kind);

        public static Preparation Suppressed(string code) => new(PreparationKind.Suppressed, Code: code);
    }

    private sealed record FinalOutcome(
        bool IsSuccess,
        bool IsRetryable,
        string? FailureCode,
        string? SuppressionCode,
        string? ProviderMessageId)
    {
        public static FinalOutcome Success(string? providerMessageId) => new(true, false, null, null, providerMessageId);

        public static FinalOutcome Retryable(string failureCode) => new(false, true, failureCode, null, null);

        public static FinalOutcome Permanent(string failureCode) => new(false, false, failureCode, null, null);

        public static FinalOutcome Suppression(string suppressionCode) => new(false, false, suppressionCode, suppressionCode, null);
    }
}
