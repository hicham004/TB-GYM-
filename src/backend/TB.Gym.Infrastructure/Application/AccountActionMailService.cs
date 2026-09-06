using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Identity;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// The global action-mail queue and its dispatcher: account confirmation and password reset.
/// </summary>
/// <remarks>
/// Global, and deliberately not part of the tenant notification outbox. These two mails belong to an
/// Identity account rather than to a workspace: they can happen before the account has any membership,
/// one account may belong to several workspaces, and no workspace operator is entitled to see that
/// somebody asked to reset their password. ADR 0021 refuses the alternative — assigning a fabricated
/// or "first available" tenant to make global mail fit a tenant-shaped queue — and this is what
/// refusing it costs: a queue of its own, with its own authorization, persistence, claims, retries and
/// privacy rules.
/// <para>
/// The queue holds identifiers, provenance and the credential state the request was made against. It
/// never holds an address, a token, a link or a rendered message. The token is minted here, at
/// materialization, from the same Identity token provider the endpoints used to call directly; it
/// lives in a local variable for the duration of one transport call and is then gone.
/// </para>
/// <para>
/// <b>Enumeration resistance is structural.</b> The public recovery endpoint writes a request whether
/// or not the address resolves to an eligible account, and the two rows differ only in fields nothing
/// outside this process can observe. It never dispatches inline, in any environment, so the
/// caller-visible work is one insert either way — there is no environment in which the known path is
/// measurably slower or answers differently.
/// </para>
/// </remarks>
internal sealed class AccountActionMailService(
    GymDbContext dbContext,
    IServiceScopeFactory scopeFactory,
    IClock clock,
    IOptions<ActionMailDispatchOptions> options,
    ILogger<AccountActionMailService> logger,
    IActionEmailTransport? transport = null)
    : IAccountActionMailScheduler, IAccountActionMailDispatchService
{
    // Identifiers, the action kind, the attempt number and a stable code only. No address, no token,
    // no link, no wording, no exception message.
    private static readonly Action<ILogger, Guid, string, int, string, Exception?> LogMaterialized =
        LoggerMessage.Define<Guid, string, int, string>(
            LogLevel.Information,
            new EventId(6151, "AccountActionMailMaterialized"),
            "Account action mail {RequestId} ({ActionKind}) materialized on attempt {AttemptNumber} through {TransportAdapter}.");

    private static readonly Action<ILogger, Guid, string, string, Exception?> LogSuppressed =
        LoggerMessage.Define<Guid, string, string>(
            LogLevel.Information,
            new EventId(6152, "AccountActionMailSuppressed"),
            "Account action mail {RequestId} ({ActionKind}) was suppressed: {ReasonCode}.");

    private static readonly Action<ILogger, Guid, string, int, string, Exception?> LogRetrying =
        LoggerMessage.Define<Guid, string, int, string>(
            LogLevel.Warning,
            new EventId(6153, "AccountActionMailRetrying"),
            "Account action mail {RequestId} ({ActionKind}) attempt {AttemptNumber} failed with {FailureCode} and will retry.");

    private static readonly Action<ILogger, Guid, string, int, string, Exception?> LogDeadLettered =
        LoggerMessage.Define<Guid, string, int, string>(
            LogLevel.Error,
            new EventId(6154, "AccountActionMailDeadLettered"),
            "Account action mail {RequestId} ({ActionKind}) was dead-lettered after {AttemptNumber} attempts with {FailureCode}.");

    private static readonly Action<ILogger, Guid, int, Exception?> LogReclaimed =
        LoggerMessage.Define<Guid, int>(
            LogLevel.Warning,
            new EventId(6155, "AccountActionMailReclaimed"),
            "Account action mail {RequestId} attempt {AttemptNumber} was abandoned when its lease expired.");

    private readonly ActionMailDispatchOptions settings = options.Value;

    public async Task<AccountActionMailEnqueueResult> RequestAsync(
        AccountActionMailCommand command,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        var now = clock.UtcNow;

        // Deliberately unconditional, and deliberately keyed on an identifier that may be empty. Both
        // the resolved and the unresolved path perform exactly one primary-key probe and exactly one
        // insert, so the work this call costs does not depend on whether the address the caller was
        // given belongs to anybody. Branching on `command.SubjectUserId` to skip the read would
        // reintroduce, in the cheapest possible form, the timing difference the whole design removes.
        var stamp = await dbContext.Users
            .AsNoTracking()
            .Where(user => user.Id == (command.SubjectUserId ?? Guid.Empty))
            .Select(user => user.SecurityStamp)
            .SingleOrDefaultAsync(cancellationToken);
        var request = command.SubjectUserId is { } subjectUserId && stamp is not null
            ? AccountActionMailRequest.For(
                subjectUserId,
                HashSecurityStamp(stamp),
                command.ActionKind,
                command.RequestSource,
                command.RequestedByUserId,
                now)
            // No subject, or an account that vanished between the caller resolving it and this write.
            // Both produce the same row shape, carrying no address and nothing an address could be
            // recovered from, and both terminate safely at materialization.
            : AccountActionMailRequest.ForUnresolvedSubject(command.ActionKind, command.RequestSource, now);

        dbContext.AccountActionMailRequests.Add(request);
        await dbContext.SaveChangesAsync(cancellationToken);

        // Inline materialization is a development affordance and never applies to password recovery,
        // in any environment. Doing it for recovery would make the known path measurably slower than
        // the unknown one and would hand a caller a link for an address they only guessed at.
        if (!ShouldDispatchInline(command.ActionKind))
        {
            return new AccountActionMailEnqueueResult(request.Id);
        }

        await DispatchRequestAsync(request.Id, cancellationToken);
        return new AccountActionMailEnqueueResult(
            request.Id,
            (transport as CapturedActionEmailTransport)?.LatestFor(request.Id)?.ActionUrl);
    }

    public async Task<AccountActionMailDispatchOutcome> DispatchDueAsync(CancellationToken cancellationToken)
    {
        if (!settings.SweepEnabled || settings.BatchSize <= 0)
        {
            return new AccountActionMailDispatchOutcome();
        }

        var now = clock.UtcNow;
        var claim = await ClaimAsync(now, settings.BatchSize, requestId: null, cancellationToken);
        var outcome = claim.Outcome;
        foreach (var work in claim.Work)
        {
            outcome = outcome.Add(await MaterializeAsync(work, cancellationToken));
        }

        return outcome;
    }

    public async Task<AccountActionMailDispatchOutcome> DispatchRequestAsync(
        Guid requestId,
        CancellationToken cancellationToken)
    {
        var now = clock.UtcNow;
        var claim = await ClaimAsync(now, limit: 1, requestId, cancellationToken);
        var outcome = claim.Outcome;
        foreach (var work in claim.Work)
        {
            outcome = outcome.Add(await MaterializeAsync(work, cancellationToken));
        }

        return outcome;
    }

    /// <summary>
    /// Whether this request may be materialized in the same call that enqueued it.
    /// </summary>
    /// <remarks>
    /// Deliberately not a setting. It is true exactly when the configured transport is the capture
    /// adapter, which startup validation already refuses in Production — so there is no configuration
    /// a production deployment could get wrong here, and no flag anybody has to remember to turn off.
    /// <para>
    /// Password recovery is excluded in every environment. Materializing it inline would make the
    /// known-address path measurably slower than the unknown one, which is the enumeration difference
    /// the rest of this design exists to remove.
    /// </para>
    /// </remarks>
    private bool ShouldDispatchInline(AccountActionKind kind) =>
        kind == AccountActionKind.ConfirmEmail &&
        transport is CapturedActionEmailTransport;

    /// <summary>
    /// Reserves due work in one short transaction, with row locks that let several replicas sweep at
    /// once without coordinating.
    /// </summary>
    /// <remarks>
    /// <c>FOR UPDATE SKIP LOCKED</c> means a replica that cannot lock a row steps over it rather than
    /// blocking or double-processing it. Nothing external happens while the lock is held: a claim is a
    /// lease on work, the authorization recheck happens after this commits, and no attempt is spent
    /// here.
    /// </remarks>
    private async Task<ClaimResult> ClaimAsync(
        DateTimeOffset now,
        int limit,
        Guid? requestId,
        CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();

        return await context.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
            var candidates = requestId is { } single
                ? await context.AccountActionMailRequests
                    .FromSql($"""
                        SELECT *, xmin FROM identity."ActionMailRequests"
                        WHERE "Id" = {single}
                          AND (("Status" = 'Pending' AND "NextAttemptAtUtc" <= {now})
                               OR ("Status" = 'Processing' AND "ClaimExpiresAtUtc" IS NOT NULL AND "ClaimExpiresAtUtc" <= {now}))
                        FOR UPDATE SKIP LOCKED
                        """)
                    .ToListAsync(cancellationToken)
                : await context.AccountActionMailRequests
                    .FromSql($"""
                        SELECT *, xmin FROM identity."ActionMailRequests"
                        WHERE ("Status" = 'Pending' AND "NextAttemptAtUtc" <= {now})
                           OR ("Status" = 'Processing' AND "ClaimExpiresAtUtc" IS NOT NULL AND "ClaimExpiresAtUtc" <= {now})
                        ORDER BY "NextAttemptAtUtc", "Id"
                        LIMIT {limit}
                        FOR UPDATE SKIP LOCKED
                        """)
                    .ToListAsync(cancellationToken);

            var outcome = new AccountActionMailDispatchOutcome();
            var work = new List<ClaimedWork>();
            foreach (var request in candidates)
            {
                if (await AbandonExpiredAttemptAsync(context, request, now, cancellationToken))
                {
                    outcome = outcome with { Reclaimed = outcome.Reclaimed + 1 };
                }

                if (request.SchemaVersion != AccountActionMailRequest.CurrentSchemaVersion)
                {
                    // A shape this build cannot read. Permanent on its first sight: no amount of
                    // waiting teaches an older process a newer schema.
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
                        request.ActionKind.ToString(),
                        request.AttemptCount,
                        AccountActionMailCodes.AttemptsExhausted,
                        null);
                    outcome = outcome with { DeadLettered = outcome.DeadLettered + 1 };
                    continue;
                }

                var claimToken = request.Claim(
                    now,
                    TimeSpan.FromSeconds(settings.ClaimLeaseSeconds),
                    settings.MaximumAttempts);
                work.Add(new ClaimedWork(request.Id, request.ActionKind, claimToken));
                outcome = outcome with { Claimed = outcome.Claimed + 1 };
            }

            await context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return new ClaimResult(outcome, work);
        });
    }

    /// <summary>
    /// A lease that expired leaves evidence before it is replaced: the unfinished attempt is marked
    /// Abandoned, so history shows an interrupted try rather than an attempt number that went missing.
    /// An abandoned attempt is still a started attempt and consumes one slot from the budget.
    /// </summary>
    private async Task<bool> AbandonExpiredAttemptAsync(
        GymDbContext context,
        AccountActionMailRequest request,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        if (!request.IsClaimExpired(now) || request.ClaimToken is not { } expiredToken)
        {
            return false;
        }

        var unfinished = await context.AccountActionMailAttempts
            .Where(attempt =>
                attempt.RequestId == request.Id &&
                attempt.ClaimToken == expiredToken &&
                attempt.Outcome == ActionMailAttemptOutcome.Started)
            .ToListAsync(cancellationToken);
        foreach (var attempt in unfinished)
        {
            attempt.Abandon(now, AccountActionMailCodes.ClaimExpired);
            LogReclaimed(logger, request.Id, attempt.AttemptNumber, null);
        }

        return true;
    }

    /// <summary>
    /// Rechecks authorization, starts and commits an attempt, mints a token, renders, sends, and
    /// records only what happened.
    /// </summary>
    /// <remarks>
    /// The order is the security property. The recheck happens <b>after</b> the claim committed and
    /// <b>before</b> anything is minted, because a committed claim is ownership of work and never
    /// durable permission to mail somebody a credential. The Started attempt commits before the token
    /// exists, so a process that dies mid-send leaves evidence rather than silence. And the token, the
    /// address, the link and the rendered body exist only as locals from that point until the transport
    /// call returns.
    /// </remarks>
    private async Task<AccountActionMailDispatchOutcome> MaterializeAsync(
        ClaimedWork work,
        CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var provider = scope.ServiceProvider;
        var context = provider.GetRequiredService<GymDbContext>();
        var userManager = provider.GetRequiredService<UserManager<ApplicationUser>>();
        var links = provider.GetRequiredService<PublicActionLinkBuilder>();
        var fingerprints = provider.GetRequiredService<ActionMailFingerprintKeyring>();

        var preparation = await context.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
            var now = clock.UtcNow;
            var request = await context.AccountActionMailRequests
                .SingleOrDefaultAsync(item => item.Id == work.RequestId, cancellationToken);

            // Another worker may have reclaimed and completed this request while this one was paused
            // after its claim commit. A stale claimant may change neither the newer claim nor a
            // terminal result.
            if (request is null ||
                request.Status != AccountActionMailStatus.Processing ||
                request.ClaimToken != work.ClaimToken)
            {
                await transaction.CommitAsync(cancellationToken);
                return Preparation.Stale;
            }

            // A commit acknowledgement can be lost after the Started attempt became durable. Re-enter
            // that same attempt rather than incrementing the budget or inserting a second row.
            var existing = await context.AccountActionMailAttempts
                .SingleOrDefaultAsync(
                    attempt => attempt.RequestId == request.Id && attempt.ClaimToken == work.ClaimToken,
                    cancellationToken);
            if (existing is not null)
            {
                await transaction.CommitAsync(cancellationToken);
                return Preparation.Resumed(existing.Id, existing.AttemptNumber, existing.ProviderIdempotencyKey);
            }

            var authorization = await AuthorizeAsync(context, request, cancellationToken);
            if (authorization.SuppressionCode is { } preClaimSuppression)
            {
                // Nothing has been tried yet in this claim, but the claim itself is durable, so the
                // request is closed with the code that explains why nobody was mailed.
                request.Suppress(work.ClaimToken, now, preClaimSuppression);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return Preparation.Terminal(PreparationKind.Suppressed, preClaimSuppression);
            }

            if (!links.IsAvailable)
            {
                request.MarkDeadLettered(work.ClaimToken, now, AccountActionMailCodes.PublicOriginUnavailable);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return Preparation.Terminal(
                    PreparationKind.DeadLettered,
                    AccountActionMailCodes.PublicOriginUnavailable);
            }

            var attemptNumber = request.StartAttempt(work.ClaimToken, settings.MaximumAttempts);
            var idempotencyKey = AccountActionMailAttempt.BuildProviderIdempotencyKey(
                request.Id,
                attemptNumber,
                fingerprints.Compute(authorization.EmailAddress!));
            var attempt = AccountActionMailAttempt.Start(
                request.Id,
                request.ActionKind,
                attemptNumber,
                work.ClaimToken,
                idempotencyKey,
                now);
            context.AccountActionMailAttempts.Add(attempt);
            await context.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return Preparation.Started(attempt.Id, attemptNumber, idempotencyKey, authorization);
        });

        return preparation.Kind switch
        {
            PreparationKind.Stale => new AccountActionMailDispatchOutcome(),
            PreparationKind.Suppressed => Suppressed(work, preparation.Code!),
            PreparationKind.DeadLettered => DeadLettered(work, preparation.Code!, preparation.AttemptNumber),
            _ => await SendAsync(context, userManager, links, work, preparation, cancellationToken),
        };
    }

    /// <summary>
    /// Mints the token, builds the link, renders, sends, and finalizes.
    /// </summary>
    /// <remarks>
    /// Everything sensitive lives here and nowhere else. The raw token comes from the Identity token
    /// provider, becomes part of a URL, becomes part of a body, crosses the transport call and is
    /// dropped; nothing on the way is written to a row, a dead-letter view or a log line.
    /// </remarks>
    private async Task<AccountActionMailDispatchOutcome> SendAsync(
        GymDbContext context,
        UserManager<ApplicationUser> userManager,
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
                FinalOutcome.Retryable(AccountActionMailCodes.TransportUnavailable),
                cancellationToken);
        }

        // A resumed attempt lost its authorization result with the acknowledgement it never received.
        // Re-establishing it is not optional: the world may have moved between the two.
        var authorization = preparation.Authorization;
        if (authorization is null)
        {
            authorization = await AuthorizeAsync(context, work.RequestId, cancellationToken);
            if (authorization.SuppressionCode is { } code)
            {
                return await FinalizeAsync(
                    context,
                    work,
                    preparation,
                    FinalOutcome.Suppression(code),
                    cancellationToken);
            }
        }

        var user = await userManager.FindByIdAsync(authorization.SubjectUserId.ToString());
        if (user is null)
        {
            return await FinalizeAsync(
                context,
                work,
                preparation,
                FinalOutcome.Suppression(AccountActionMailCodes.SubjectMissing),
                cancellationToken);
        }

        string rawToken;
        try
        {
            rawToken = work.ActionKind switch
            {
                AccountActionKind.ConfirmEmail => await userManager.GenerateEmailConfirmationTokenAsync(user),
                AccountActionKind.ResetPassword => await userManager.GeneratePasswordResetTokenAsync(user),
                _ => string.Empty,
            };
        }
        catch (NotSupportedException)
        {
            // The configured token provider cannot mint for this account. Permanent: the same request
            // will fail the same way, and the exception is deliberately not attached to anything.
            rawToken = string.Empty;
        }

        if (string.IsNullOrEmpty(rawToken))
        {
            return await FinalizeAsync(
                context,
                work,
                preparation,
                FinalOutcome.Permanent(AccountActionMailCodes.TokenUnavailable),
                cancellationToken);
        }

        var actionUrl = links.BuildAccountActionUrl(
            work.ActionKind,
            authorization.SubjectUserId,
            WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(rawToken)));
        if (actionUrl is null)
        {
            return await FinalizeAsync(
                context,
                work,
                preparation,
                FinalOutcome.Permanent(AccountActionMailCodes.PublicOriginUnavailable),
                cancellationToken);
        }

        var content = AccountActionEmailTemplates.Render(work.ActionKind, actionUrl);
        var result = await transport.SendAsync(
            new ActionEmailMessage(
                ActionMailScopes.Account,
                work.RequestId,
                preparation.AttemptNumber,
                preparation.IdempotencyKey!,
                authorization.EmailAddress!,
                content.Subject,
                content.Body),
            cancellationToken);

        return await FinalizeAsync(context, work, preparation, Classify(result), cancellationToken);
    }

    /// <summary>Maps a transport result to this queue's own vocabulary.</summary>
    private static FinalOutcome Classify(ActionEmailTransportResult result) => result.Outcome switch
    {
        ActionEmailTransportOutcome.Captured => FinalOutcome.Success(null),
        ActionEmailTransportOutcome.ProviderAccepted => FinalOutcome.Success(result.ProviderMessageId),
        _ => result.Failure switch
        {
            ResendFailureKind.Unauthorized or
            ResendFailureKind.RateLimited or
            ResendFailureKind.Timeout or
            ResendFailureKind.Unavailable => FinalOutcome.Retryable(AccountActionMailCodes.TransportTransient),
            _ => FinalOutcome.Permanent(AccountActionMailCodes.TransportPermanent),
        },
    };

    private async Task<AccountActionMailDispatchOutcome> FinalizeAsync(
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
            var request = await context.AccountActionMailRequests
                .SingleOrDefaultAsync(item => item.Id == work.RequestId, cancellationToken);
            var attempt = await context.AccountActionMailAttempts
                .SingleOrDefaultAsync(item => item.Id == preparation.AttemptId, cancellationToken);

            // A stale claimant cannot finalize a newer claimant's work, and a completed attempt is
            // immutable. Both are checked before anything is written, and the sweep records nothing.
            if (request is null ||
                attempt is null ||
                attempt.IsCompleted ||
                request.Status != AccountActionMailStatus.Processing ||
                request.ClaimToken != work.ClaimToken)
            {
                await transaction.CommitAsync(cancellationToken);
                return PreparationKind.Stale;
            }

            if (final.IsSuccess)
            {
                attempt.Succeed(now, final.ProviderMessageId);
                request.MarkMaterialized(
                    work.ClaimToken,
                    now,
                    transport!.AdapterName,
                    final.ProviderMessageId);
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
                ? AccountActionMailRetryPolicy.NextAttemptAtUtc(
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
            _ => new AccountActionMailDispatchOutcome(),
        };
    }

    private AccountActionMailDispatchOutcome Materialized(ClaimedWork work, int attemptNumber)
    {
        LogMaterialized(
            logger,
            work.RequestId,
            work.ActionKind.ToString(),
            attemptNumber,
            transport!.AdapterName,
            null);
        return new AccountActionMailDispatchOutcome(Materialized: 1);
    }

    private AccountActionMailDispatchOutcome Suppressed(ClaimedWork work, string code)
    {
        LogSuppressed(logger, work.RequestId, work.ActionKind.ToString(), code, null);
        return new AccountActionMailDispatchOutcome(Suppressed: 1);
    }

    private AccountActionMailDispatchOutcome Retried(ClaimedWork work, int attemptNumber, string code)
    {
        LogRetrying(logger, work.RequestId, work.ActionKind.ToString(), attemptNumber, code, null);
        return new AccountActionMailDispatchOutcome(Retried: 1);
    }

    private AccountActionMailDispatchOutcome DeadLettered(ClaimedWork work, string code, int attemptNumber)
    {
        LogDeadLettered(logger, work.RequestId, work.ActionKind.ToString(), attemptNumber, code, null);
        return new AccountActionMailDispatchOutcome(DeadLettered: 1);
    }

    private static async Task<Authorization> AuthorizeAsync(
        GymDbContext context,
        Guid requestId,
        CancellationToken cancellationToken)
    {
        var request = await context.AccountActionMailRequests
            .AsNoTracking()
            .SingleOrDefaultAsync(item => item.Id == requestId, cancellationToken);
        return request is null
            ? Authorization.Refused(AccountActionMailCodes.SubjectMissing)
            : await AuthorizeAsync(context, request, cancellationToken);
    }

    /// <summary>
    /// Re-establishes that this action is still wanted, immediately before a token is minted.
    /// </summary>
    /// <remarks>
    /// The rules follow the OWASP guidance that a recovery credential is short-lived, single-use and
    /// unretained: an outstanding request whose reason has gone must not turn into a live credential
    /// hours later. Confirmation stops if the address is already confirmed, gone, or the account is
    /// blocked. Reset stops if the security stamp moved — which Identity rotates on a password change,
    /// an email change, a successful reset and an explicit session revocation — because the token would
    /// be refused at redemption anyway and a credential nobody can use is still a credential in a
    /// mailbox.
    /// </remarks>
    private static async Task<Authorization> AuthorizeAsync(
        GymDbContext context,
        AccountActionMailRequest request,
        CancellationToken cancellationToken)
    {
        if (request.SubjectUserId is not { } subjectUserId || request.SubjectSecurityStampHash is null)
        {
            return Authorization.Refused(AccountActionMailCodes.SubjectUnresolved);
        }

        var account = await context.Users
            .AsNoTracking()
            .Where(user => user.Id == subjectUserId)
            .Select(user => new
            {
                user.Email,
                user.EmailConfirmed,
                user.IsPlatformBlocked,
                user.SecurityStamp,
            })
            .SingleOrDefaultAsync(cancellationToken);
        if (account is null)
        {
            return Authorization.Refused(AccountActionMailCodes.SubjectMissing);
        }

        if (account.IsPlatformBlocked)
        {
            return Authorization.Refused(AccountActionMailCodes.SubjectBlocked);
        }

        if (string.IsNullOrWhiteSpace(account.Email))
        {
            return Authorization.Refused(AccountActionMailCodes.AddressUnavailable);
        }

        if (account.SecurityStamp is null ||
            !string.Equals(HashSecurityStamp(account.SecurityStamp), request.SubjectSecurityStampHash, StringComparison.Ordinal))
        {
            return Authorization.Refused(AccountActionMailCodes.CredentialChanged);
        }

        return request.ActionKind switch
        {
            AccountActionKind.ConfirmEmail when account.EmailConfirmed =>
                Authorization.Refused(AccountActionMailCodes.AlreadyConfirmed),
            AccountActionKind.ResetPassword when !account.EmailConfirmed =>
                // A never-confirmed address is not a mailbox this deployment has established belongs
                // to the account holder, so it is not one a recovery credential may be sent to.
                Authorization.Refused(AccountActionMailCodes.AddressUnavailable),
            _ => Authorization.Allowed(subjectUserId, account.Email),
        };
    }

    /// <summary>
    /// SHA-256 of a security stamp.
    /// </summary>
    /// <remarks>
    /// Unkeyed on purpose, and honest because of what a security stamp is: a high-entropy value this
    /// application generated, not a value drawn from a small enumerable space. The same digest of an
    /// email address would be a synonym for the address rather than a pseudonym for it, which is why
    /// mailbox fingerprints elsewhere in this repository are keyed and this one is not.
    /// </remarks>
    private static string HashSecurityStamp(string securityStamp) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(securityStamp)));

    private sealed record ClaimedWork(Guid RequestId, AccountActionKind ActionKind, Guid ClaimToken);

    private sealed record ClaimResult(
        AccountActionMailDispatchOutcome Outcome,
        IReadOnlyList<ClaimedWork> Work);

    private sealed record Authorization(
        Guid SubjectUserId,
        string? EmailAddress,
        string? SuppressionCode)
    {
        public static Authorization Allowed(Guid subjectUserId, string emailAddress) =>
            new(subjectUserId, emailAddress, null);

        public static Authorization Refused(string suppressionCode) =>
            new(Guid.Empty, null, suppressionCode);
    }

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
        Authorization? Authorization = null)
    {
        public static Preparation Stale { get; } = new(PreparationKind.Stale);

        public static Preparation Started(
            Guid attemptId,
            int attemptNumber,
            string idempotencyKey,
            Authorization authorization) =>
            new(PreparationKind.Started, attemptId, attemptNumber, idempotencyKey, null, authorization);

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
/// The key new action-mail address fingerprints are computed under.
/// </summary>
/// <remarks>
/// A fingerprint appears in one place only: inside a provider idempotency key, which binds the exact
/// mailbox so that a corrected address does not collide with a key the provider still remembers for the
/// old one. It is keyed rather than a plain digest for the reason ADR 0022 sets out — the space of real
/// email addresses is small and enumerable, so an unkeyed hash of one is a synonym for it.
/// <para>
/// When the deployment has configured provider fingerprint keys, the active one is used, so an action
/// mail and a notification to the same mailbox fingerprint identically. When it has not — which is only
/// possible outside Production, where the transport contacts nobody — a random key is generated for the
/// lifetime of the process. That is deliberately not persisted: the value it protects is never compared
/// across restarts, and a key nobody stored is a key nobody can use to reverse the stored digests.
/// </para>
/// </remarks>
internal sealed class ActionMailFingerprintKeyring
{
    private readonly byte[] key;

    public ActionMailFingerprintKeyring(IOptions<TB.Gym.Modules.Notifications.NotificationEmailOptions> options)
    {
        ArgumentNullException.ThrowIfNull(options);
        var configured = options.Value.UsesProviderAdapter
            ? options.Value.Provider.ResolveFingerprintKeys()
            : [];
        key = configured.Count > 0 ? configured[0].Material : RandomNumberGenerator.GetBytes(32);
        KeyId = configured.Count > 0 ? configured[0].KeyId : "ephemeral";
    }

    /// <summary>Which key produced the fingerprints this process writes. For diagnostics only.</summary>
    public string KeyId { get; }

    public string Compute(string address) =>
        TB.Gym.Modules.Notifications.NotificationAddressFingerprint.Compute(key, address);
}
