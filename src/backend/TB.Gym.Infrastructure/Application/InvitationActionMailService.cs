using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Invitations;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// The tenant-owned action-mail dispatcher for client invitations.
/// </summary>
/// <remarks>
/// Invitations are a workspace's own act, so this queue is tenant-scoped, tenant-filtered and written
/// only inside an active tenant scope — unlike the global account queue beside it, which must not carry
/// a tenant at all. What it cannot use is membership: the invitee is by definition not a member yet, so
/// authorization comes from the invitation aggregate through
/// <see cref="IInvitationMailAuthorization"/>, a narrow contract the Invitations module owns.
/// <para>
/// The ordering inside one materialization is the substantive guarantee of this phase, and it is:
/// </para>
/// <list type="number">
/// <item><description>re-establish authorization for <i>this generation</i>, after the claim
/// committed and before anything is minted;</description></item>
/// <item><description>start the attempt and commit it;</description></item>
/// <item><description>mint a high-entropy token in memory;</description></item>
/// <item><description><b>commit its hash</b>, tagged with the invitation, workspace, generation,
/// request and attempt;</description></item>
/// <item><description>only then invoke the provider.</description></item>
/// </list>
/// <para>
/// Step 4 before step 5 is what makes a link that a provider accepted survive a lost commit
/// acknowledgement. The failure it removes is somebody holding a real invitation email whose link this
/// system has no record of and therefore refuses — and that failure is invisible until a recipient
/// complains, which is the worst kind.
/// </para>
/// <para>
/// A transport retry re-enters this same request row and therefore this same generation. It mints a new
/// token and appends a second hash; it does not revoke the first, because the first may already be in a
/// mailbox. Only a deliberate resend — a different command, creating a different request at the next
/// generation — revokes anything.
/// </para>
/// </remarks>
internal sealed class InvitationActionMailService(
    IServiceScopeFactory scopeFactory,
    IClock clock,
    IOptions<ActionMailDispatchOptions> options,
    ILogger<InvitationActionMailService> logger,
    IActionEmailTransport? transport = null)
    : IInvitationActionMailDispatchService
{
    // The request id, the generation, the attempt number, a stable code and the adapter name. No
    // workspace identifier, deliberately: Phase 6B-2B established that a workspace identifier in a log
    // line is a workspace an operator can correlate, and nothing here needs one — the request id
    // resolves to its workspace by query when somebody genuinely has to know. And no address, token,
    // link or wording, which is the rule this whole design exists to keep.
    private static readonly Action<ILogger, Guid, int, int, string, Exception?> LogMaterialized =
        LoggerMessage.Define<Guid, int, int, string>(
            LogLevel.Information,
            new EventId(6161, "InvitationActionMailMaterialized"),
            "Invitation action mail {RequestId} (generation {Generation}) materialized on attempt {AttemptNumber} through {TransportAdapter}.");

    private static readonly Action<ILogger, Guid, int, string, Exception?> LogSuppressed =
        LoggerMessage.Define<Guid, int, string>(
            LogLevel.Information,
            new EventId(6162, "InvitationActionMailSuppressed"),
            "Invitation action mail {RequestId} (generation {Generation}) was suppressed: {ReasonCode}.");

    private static readonly Action<ILogger, Guid, int, string, Exception?> LogRetrying =
        LoggerMessage.Define<Guid, int, string>(
            LogLevel.Warning,
            new EventId(6163, "InvitationActionMailRetrying"),
            "Invitation action mail {RequestId} attempt {AttemptNumber} failed with {FailureCode} and will retry on the same generation.");

    private static readonly Action<ILogger, Guid, int, string, Exception?> LogDeadLettered =
        LoggerMessage.Define<Guid, int, string>(
            LogLevel.Error,
            new EventId(6164, "InvitationActionMailDeadLettered"),
            "Invitation action mail {RequestId} was dead-lettered after {AttemptNumber} attempts with {FailureCode}.");

    private static readonly Action<ILogger, Guid, int, Exception?> LogReclaimed =
        LoggerMessage.Define<Guid, int>(
            LogLevel.Warning,
            new EventId(6165, "InvitationActionMailReclaimed"),
            "Invitation action mail {RequestId} attempt {AttemptNumber} was abandoned when its lease expired.");

    private readonly ActionMailDispatchOptions settings = options.Value;

    /// <summary>
    /// Whether a caller may materialize its own request inline.
    /// </summary>
    /// <remarks>
    /// True exactly when the configured transport is the capture adapter, which startup validation
    /// refuses in Production. Deriving it rather than configuring it means there is no flag a
    /// production deployment could leave switched on.
    /// </remarks>
    public bool InlineDispatchAvailable => transport is CapturedActionEmailTransport;

    /// <summary>The captured link for one request, or null. Development and test only.</summary>
    public string? CapturedActionUrl(Guid requestId) =>
        (transport as CapturedActionEmailTransport)?.LatestFor(requestId)?.ActionUrl;

    public async Task<InvitationActionMailDispatchOutcome> DispatchDueAsync(CancellationToken cancellationToken)
    {
        if (!settings.SweepEnabled || settings.BatchSize <= 0)
        {
            return new InvitationActionMailDispatchOutcome();
        }

        var now = clock.UtcNow;
        List<Guid> tenantIds;
        await using (var readScope = scopeFactory.CreateAsyncScope())
        {
            // The only global read in the sweep, and it is read-only. Every tenant-owned write below
            // happens in a fresh scope after SetTenant, so the SaveChanges write-scope guard stays
            // fully in force for every row this worker touches.
            var readContext = readScope.ServiceProvider.GetRequiredService<GymDbContext>();
            tenantIds = await readContext.InvitationActionMailRequests
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(item =>
                    (item.Status == InvitationActionMailStatus.Pending && item.NextAttemptAtUtc <= now) ||
                    (item.Status == InvitationActionMailStatus.Processing &&
                     item.ClaimExpiresAtUtc != null &&
                     item.ClaimExpiresAtUtc <= now))
                .GroupBy(item => item.TenantId)
                .Select(group => new
                {
                    TenantId = group.Key,
                    EffectiveDueAtUtc = group.Min(item =>
                        item.Status == InvitationActionMailStatus.Pending
                            ? item.NextAttemptAtUtc
                            : item.ClaimExpiresAtUtc!.Value),
                })
                .OrderBy(workspace => workspace.EffectiveDueAtUtc)
                .ThenBy(workspace => workspace.TenantId)
                .Select(workspace => workspace.TenantId)
                .Take(settings.BatchSize)
                .ToListAsync(cancellationToken);
        }

        var outcome = new InvitationActionMailDispatchOutcome();
        var remaining = settings.BatchSize;
        foreach (var tenantId in tenantIds)
        {
            if (remaining <= 0)
            {
                break;
            }

            var claim = await ClaimAsync(tenantId, now, remaining, requestId: null, cancellationToken);
            outcome = outcome.Add(claim.Outcome);
            remaining -= Math.Max(claim.Work.Count, 0);
            foreach (var work in claim.Work)
            {
                outcome = outcome.Add(await MaterializeAsync(work, cancellationToken));
            }
        }

        return outcome;
    }

    public async Task<InvitationActionMailDispatchOutcome> DispatchRequestAsync(
        Guid tenantId,
        Guid requestId,
        CancellationToken cancellationToken)
    {
        var claim = await ClaimAsync(tenantId, clock.UtcNow, limit: 1, requestId, cancellationToken);
        var outcome = claim.Outcome;
        foreach (var work in claim.Work)
        {
            outcome = outcome.Add(await MaterializeAsync(work, cancellationToken));
        }

        return outcome;
    }

    private async Task<ClaimResult> ClaimAsync(
        Guid tenantId,
        DateTimeOffset now,
        int limit,
        Guid? requestId,
        CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var provider = scope.ServiceProvider;
        provider.GetRequiredService<IMutableTenantContext>().SetTenant(tenantId);
        var context = provider.GetRequiredService<GymDbContext>();

        return await context.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
            var candidates = requestId is { } single
                ? await context.InvitationActionMailRequests
                    .FromSql($"""
                        SELECT *, xmin FROM invitations."ActionMailRequests"
                        WHERE "TenantId" = {tenantId} AND "Id" = {single}
                          AND (("Status" = 'Pending' AND "NextAttemptAtUtc" <= {now})
                               OR ("Status" = 'Processing' AND "ClaimExpiresAtUtc" IS NOT NULL AND "ClaimExpiresAtUtc" <= {now}))
                        FOR UPDATE SKIP LOCKED
                        """)
                    .ToListAsync(cancellationToken)
                : await context.InvitationActionMailRequests
                    .FromSql($"""
                        SELECT *, xmin FROM invitations."ActionMailRequests"
                        WHERE "TenantId" = {tenantId}
                          AND (("Status" = 'Pending' AND "NextAttemptAtUtc" <= {now})
                               OR ("Status" = 'Processing' AND "ClaimExpiresAtUtc" IS NOT NULL AND "ClaimExpiresAtUtc" <= {now}))
                        ORDER BY "NextAttemptAtUtc", "Id"
                        LIMIT {limit}
                        FOR UPDATE SKIP LOCKED
                        """)
                    .ToListAsync(cancellationToken);

            var outcome = new InvitationActionMailDispatchOutcome();
            var work = new List<ClaimedWork>();
            foreach (var request in candidates)
            {
                if (await AbandonExpiredAttemptAsync(context, request, now, cancellationToken))
                {
                    outcome = outcome with { Reclaimed = outcome.Reclaimed + 1 };
                }

                if (request.SchemaVersion != InvitationActionMailRequest.CurrentSchemaVersion)
                {
                    request.MarkAttemptsExhausted(now);
                    outcome = outcome with { DeadLettered = outcome.DeadLettered + 1 };
                    continue;
                }

                if (request.AttemptCount >= settings.MaximumAttempts)
                {
                    request.MarkAttemptsExhausted(now);
                    LogDeadLettered(
                        logger,
                        request.Id,
                        request.AttemptCount,
                        InvitationActionMailCodes.AttemptsExhausted,
                        null);
                    outcome = outcome with { DeadLettered = outcome.DeadLettered + 1 };
                    continue;
                }

                var claimToken = request.Claim(
                    now,
                    TimeSpan.FromSeconds(settings.ClaimLeaseSeconds),
                    settings.MaximumAttempts);
                work.Add(new ClaimedWork(
                    tenantId,
                    request.Id,
                    request.InvitationId,
                    request.LogicalSendGeneration,
                    claimToken));
                outcome = outcome with { Claimed = outcome.Claimed + 1 };
            }

            await context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return new ClaimResult(outcome, work);
        });
    }

    private async Task<bool> AbandonExpiredAttemptAsync(
        GymDbContext context,
        InvitationActionMailRequest request,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        if (!request.IsClaimExpired(now) || request.ClaimToken is not { } expiredToken)
        {
            return false;
        }

        var unfinished = await context.InvitationActionMailAttempts
            .Where(attempt =>
                attempt.RequestId == request.Id &&
                attempt.ClaimToken == expiredToken &&
                attempt.Outcome == InvitationActionMailOutcome.Started)
            .ToListAsync(cancellationToken);
        foreach (var attempt in unfinished)
        {
            attempt.Abandon(now, InvitationActionMailCodes.ClaimExpired);
            LogReclaimed(logger, request.Id, attempt.AttemptNumber, null);
        }

        return true;
    }

    private async Task<InvitationActionMailDispatchOutcome> MaterializeAsync(
        ClaimedWork work,
        CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var provider = scope.ServiceProvider;
        provider.GetRequiredService<IMutableTenantContext>().SetTenant(work.TenantId);
        var context = provider.GetRequiredService<GymDbContext>();
        var authorizer = provider.GetRequiredService<IInvitationMailAuthorization>();
        var links = provider.GetRequiredService<PublicActionLinkBuilder>();
        var fingerprints = provider.GetRequiredService<ActionMailFingerprintKeyring>();

        var preparation = await context.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
            var now = clock.UtcNow;
            var request = await context.InvitationActionMailRequests
                .SingleOrDefaultAsync(item => item.Id == work.RequestId, cancellationToken);
            if (request is null ||
                request.Status != InvitationActionMailStatus.Processing ||
                request.ClaimToken != work.ClaimToken)
            {
                await transaction.CommitAsync(cancellationToken);
                return Preparation.Stale;
            }

            var existing = await context.InvitationActionMailAttempts
                .SingleOrDefaultAsync(
                    attempt => attempt.RequestId == request.Id && attempt.ClaimToken == work.ClaimToken,
                    cancellationToken);
            if (existing is not null)
            {
                await transaction.CommitAsync(cancellationToken);
                return Preparation.Resumed(
                    existing.Id,
                    existing.AttemptNumber,
                    existing.ProviderIdempotencyKey);
            }

            var authorization = await authorizer.AuthorizeAsync(
                work.TenantId,
                work.InvitationId,
                work.LogicalSendGeneration,
                cancellationToken);
            if (!authorization.IsAuthorized)
            {
                request.Suppress(work.ClaimToken, now, authorization.SuppressionCode!);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return Preparation.Terminal(PreparationKind.Suppressed, authorization.SuppressionCode!);
            }

            if (!links.IsAvailable)
            {
                request.MarkDeadLettered(
                    work.ClaimToken,
                    now,
                    InvitationActionMailCodes.PublicOriginUnavailable);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return Preparation.Terminal(
                    PreparationKind.DeadLettered,
                    InvitationActionMailCodes.PublicOriginUnavailable);
            }

            var attemptNumber = request.StartAttempt(work.ClaimToken, settings.MaximumAttempts);
            var idempotencyKey = InvitationActionMailAttempt.BuildProviderIdempotencyKey(
                request.Id,
                attemptNumber,
                fingerprints.Compute(authorization.RecipientAddress!));
            var attempt = InvitationActionMailAttempt.Start(
                work.TenantId,
                request.Id,
                request.InvitationId,
                request.LogicalSendGeneration,
                attemptNumber,
                work.ClaimToken,
                idempotencyKey,
                now);
            context.InvitationActionMailAttempts.Add(attempt);
            await context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return Preparation.Started(attempt.Id, attemptNumber, idempotencyKey, authorization);
        });

        return preparation.Kind switch
        {
            PreparationKind.Stale => new InvitationActionMailDispatchOutcome(),
            PreparationKind.Suppressed => Suppressed(work, preparation.Code!),
            PreparationKind.DeadLettered => DeadLettered(work, preparation.Code!, preparation.AttemptNumber),
            _ => await SendAsync(context, authorizer, links, work, preparation, cancellationToken),
        };
    }

    private async Task<InvitationActionMailDispatchOutcome> SendAsync(
        GymDbContext context,
        IInvitationMailAuthorization authorizer,
        PublicActionLinkBuilder links,
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
                FinalOutcome.Retryable(InvitationActionMailCodes.TransportUnavailable),
                cancellationToken);
        }

        var authorization = preparation.Authorization
            ?? await authorizer.AuthorizeAsync(
                work.TenantId,
                work.InvitationId,
                work.LogicalSendGeneration,
                cancellationToken);
        if (!authorization.IsAuthorized)
        {
            return await FinalizeAsync(
                context,
                work,
                preparation,
                FinalOutcome.Suppression(authorization.SuppressionCode!),
                cancellationToken);
        }

        // The raw token exists from here until the transport call returns, and nowhere else. Its hash
        // is committed first, deliberately: a link the provider accepts must never be one this system
        // has no record of, and the only way to guarantee that is to make the record older than the
        // send.
        var rawToken = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
        var tokenHash = HashToken(rawToken);
        var mintedAt = clock.UtcNow;
        var issued = await context.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
            var attempt = await context.InvitationActionMailAttempts
                .SingleOrDefaultAsync(item => item.Id == preparation.AttemptId, cancellationToken);
            if (attempt is null || attempt.IsCompleted)
            {
                await transaction.CommitAsync(cancellationToken);
                return false;
            }

            if (attempt.TokenMintedAtUtc is not null)
            {
                // This attempt already minted and committed a token in a run whose acknowledgement was
                // lost. Re-minting would append a second hash for one attempt, which the schema
                // refuses and which would be a second live credential for one materialization.
                await transaction.CommitAsync(cancellationToken);
                return false;
            }

            attempt.RecordTokenMinted(mintedAt);
            context.InvitationTokenIssues.Add(InvitationTokenIssue.Issue(
                work.TenantId,
                work.InvitationId,
                work.LogicalSendGeneration,
                work.RequestId,
                attempt.Id,
                attempt.AttemptNumber,
                tokenHash,
                mintedAt,
                authorization.ExpiresAtUtc!.Value));
            await context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return true;
        });

        if (!issued)
        {
            // Either the attempt was finalized elsewhere, or it had already minted. Neither is this
            // worker's to complete, and no link is sent for a token nothing recorded.
            return new InvitationActionMailDispatchOutcome();
        }

        var actionUrl = links.BuildInvitationUrl(rawToken);
        if (actionUrl is null)
        {
            return await FinalizeAsync(
                context,
                work,
                preparation,
                FinalOutcome.Permanent(InvitationActionMailCodes.PublicOriginUnavailable),
                cancellationToken);
        }

        var content = InvitationActionEmailTemplates.Render(actionUrl);
        var result = await transport.SendAsync(
            new ActionEmailMessage(
                ActionMailScopes.Invitation,
                work.RequestId,
                preparation.AttemptNumber,
                preparation.IdempotencyKey!,
                authorization.RecipientAddress!,
                content.Subject,
                content.Body),
            cancellationToken);

        return await FinalizeAsync(context, work, preparation, Classify(result), cancellationToken);
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
            ResendFailureKind.Unavailable => FinalOutcome.Retryable(InvitationActionMailCodes.TransportTransient),
            _ => FinalOutcome.Permanent(InvitationActionMailCodes.TransportPermanent),
        },
    };

    private async Task<InvitationActionMailDispatchOutcome> FinalizeAsync(
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
            var request = await context.InvitationActionMailRequests
                .SingleOrDefaultAsync(item => item.Id == work.RequestId, cancellationToken);
            var attempt = await context.InvitationActionMailAttempts
                .SingleOrDefaultAsync(item => item.Id == preparation.AttemptId, cancellationToken);
            if (request is null ||
                attempt is null ||
                attempt.IsCompleted ||
                request.Status != InvitationActionMailStatus.Processing ||
                request.ClaimToken != work.ClaimToken)
            {
                await transaction.CommitAsync(cancellationToken);
                return PreparationKind.Stale;
            }

            if (final.IsSuccess)
            {
                attempt.Succeed(now, final.ProviderMessageId);
                request.MarkMaterialized(work.ClaimToken, now, transport!.AdapterName, final.ProviderMessageId);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return PreparationKind.Materialized;
            }

            if (final.SuppressionCode is { } suppression)
            {
                attempt.Suppress(now, suppression);
                request.Suppress(work.ClaimToken, now, suppression);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return PreparationKind.Suppressed;
            }

            var next = final.IsRetryable
                ? InvitationActionMailRetryPolicy.NextAttemptAtUtc(
                    preparation.AttemptNumber,
                    settings.MaximumAttempts,
                    now)
                : null;
            if (next is { } nextAttemptAtUtc)
            {
                attempt.FailTransiently(now, final.FailureCode!);
                request.MarkRetrying(work.ClaimToken, nextAttemptAtUtc, final.FailureCode!);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return PreparationKind.Retried;
            }

            if (final.IsRetryable)
            {
                attempt.FailTransiently(now, final.FailureCode!);
            }
            else
            {
                attempt.FailPermanently(now, final.FailureCode!);
            }

            request.MarkDeadLettered(work.ClaimToken, now, final.FailureCode!);
            await context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return PreparationKind.DeadLettered;
        });

        return kind switch
        {
            PreparationKind.Materialized => Materialized(work, preparation.AttemptNumber),
            PreparationKind.Suppressed => Suppressed(work, final.SuppressionCode ?? final.FailureCode!),
            PreparationKind.Retried => Retried(work, preparation.AttemptNumber, final.FailureCode!),
            PreparationKind.DeadLettered => DeadLettered(work, final.FailureCode!, preparation.AttemptNumber),
            _ => new InvitationActionMailDispatchOutcome(),
        };
    }

    private InvitationActionMailDispatchOutcome Materialized(ClaimedWork work, int attemptNumber)
    {
        LogMaterialized(
            logger,
            work.RequestId,
            work.LogicalSendGeneration,
            attemptNumber,
            transport!.AdapterName,
            null);
        return new InvitationActionMailDispatchOutcome(Materialized: 1);
    }

    private InvitationActionMailDispatchOutcome Suppressed(ClaimedWork work, string code)
    {
        LogSuppressed(logger, work.RequestId, work.LogicalSendGeneration, code, null);
        return new InvitationActionMailDispatchOutcome(Suppressed: 1);
    }

    private InvitationActionMailDispatchOutcome Retried(ClaimedWork work, int attemptNumber, string code)
    {
        LogRetrying(logger, work.RequestId, attemptNumber, code, null);
        return new InvitationActionMailDispatchOutcome(Retried: 1);
    }

    private InvitationActionMailDispatchOutcome DeadLettered(ClaimedWork work, string code, int attemptNumber)
    {
        LogDeadLettered(logger, work.RequestId, attemptNumber, code, null);
        return new InvitationActionMailDispatchOutcome(DeadLettered: 1);
    }

    /// <summary>SHA-256 of the raw token, lowercase hex. The only durable form a token ever takes.</summary>
    internal static string HashToken(string token) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    private sealed record ClaimedWork(
        Guid TenantId,
        Guid RequestId,
        Guid InvitationId,
        int LogicalSendGeneration,
        Guid ClaimToken);

    private sealed record ClaimResult(
        InvitationActionMailDispatchOutcome Outcome,
        IReadOnlyList<ClaimedWork> Work);

    private enum PreparationKind
    {
        Stale = 0,
        Started = 1,
        Suppressed = 2,
        DeadLettered = 3,
        Materialized = 4,
        Retried = 5,
    }

    private sealed record Preparation(
        PreparationKind Kind,
        Guid AttemptId = default,
        int AttemptNumber = 0,
        string? IdempotencyKey = null,
        string? Code = null,
        InvitationMailAuthorization? Authorization = null)
    {
        public static Preparation Stale { get; } = new(PreparationKind.Stale);

        public static Preparation Started(
            Guid attemptId,
            int attemptNumber,
            string idempotencyKey,
            InvitationMailAuthorization authorization) =>
            new(PreparationKind.Started, attemptId, attemptNumber, idempotencyKey, null, authorization);

        /// <summary>
        /// An attempt whose Started commit landed but whose acknowledgement was lost. It carries no
        /// authorization, so the send path re-establishes it; whether it already minted is read from
        /// the row itself at mint time, which is the only place that answer can be trusted.
        /// </summary>
        public static Preparation Resumed(Guid attemptId, int attemptNumber, string idempotencyKey) =>
            new(PreparationKind.Started, attemptId, attemptNumber, idempotencyKey);

        public static Preparation Terminal(PreparationKind kind, string code) =>
            new(kind, Code: code);
    }

    private sealed record FinalOutcome(
        bool IsSuccess,
        bool IsRetryable,
        string? FailureCode,
        string? SuppressionCode,
        string? ProviderMessageId)
    {
        public static FinalOutcome Success(string? providerMessageId) =>
            new(true, false, null, null, providerMessageId);

        public static FinalOutcome Retryable(string failureCode) =>
            new(false, true, failureCode, null, null);

        public static FinalOutcome Permanent(string failureCode) =>
            new(false, false, failureCode, null, null);

        public static FinalOutcome Suppression(string suppressionCode) =>
            new(false, false, suppressionCode, suppressionCode, null);
    }
}

/// <summary>
/// The Invitations module's own answer to "may this logical send still go out, and to whom".
/// </summary>
/// <remarks>
/// It lives in Infrastructure because Infrastructure is what composes modules and owns persistence, and
/// it is expressed as the module's contract so the dispatcher never re-derives invitation rules for
/// itself. Membership is deliberately not consulted: an invitee is not a member, which is the entire
/// point of an invitation, so the invitation aggregate is the authority.
/// <para>
/// The generation check is what separates a stale request from a live one. A request created for
/// generation 2 is refused once a deliberate resend has moved the invitation to generation 3 — the
/// newer request carries the send, and this one stops without contacting anybody or minting anything.
/// </para>
/// </remarks>
internal sealed class InvitationMailAuthorizationService(GymDbContext dbContext, IClock clock)
    : IInvitationMailAuthorization
{
    public async Task<InvitationMailAuthorization> AuthorizeAsync(
        Guid tenantId,
        Guid invitationId,
        int logicalSendGeneration,
        CancellationToken cancellationToken)
    {
        var tenantIsActive = await dbContext.Tenants
            .IgnoreQueryFilters()
            .AsNoTracking()
            .AnyAsync(tenant => tenant.Id == tenantId && tenant.IsActive, cancellationToken);
        if (!tenantIsActive)
        {
            return InvitationMailAuthorization.Refused(InvitationActionMailCodes.TenantInactive);
        }

        var invitation = await dbContext.ClientInvitations
            .IgnoreQueryFilters()
            .AsNoTracking()
            .SingleOrDefaultAsync(
                item => item.Id == invitationId && item.TenantId == tenantId,
                cancellationToken);
        if (invitation is null)
        {
            return InvitationMailAuthorization.Refused(InvitationActionMailCodes.InvitationMissing);
        }

        if (invitation.LogicalSendGeneration != logicalSendGeneration)
        {
            return InvitationMailAuthorization.Refused(InvitationActionMailCodes.GenerationSuperseded);
        }

        var now = clock.UtcNow;
        if (invitation.Status == InvitationStatus.Accepted)
        {
            return InvitationMailAuthorization.Refused(InvitationActionMailCodes.InvitationAccepted);
        }

        if (invitation.Status == InvitationStatus.Revoked)
        {
            return InvitationMailAuthorization.Refused(InvitationActionMailCodes.InvitationRevoked);
        }

        if (!invitation.IsMailable(now))
        {
            return InvitationMailAuthorization.Refused(InvitationActionMailCodes.InvitationExpired);
        }

        return string.IsNullOrWhiteSpace(invitation.Email)
            ? InvitationMailAuthorization.Refused(InvitationActionMailCodes.AddressUnavailable)
            : InvitationMailAuthorization.Allowed(invitation.Email, invitation.ExpiresAtUtc);
    }
}
