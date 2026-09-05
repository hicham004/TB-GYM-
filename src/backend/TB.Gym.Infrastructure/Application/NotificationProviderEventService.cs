using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Notifications;
using TB.Gym.Modules.Tenancy;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// Turns one authenticated provider webhook into durable, append-only evidence.
/// </summary>
/// <remarks>
/// The order of operations is the design, and it is strictly: bound, verify, parse, resolve, scope,
/// write. Nothing before verification touches a parser; nothing before resolution touches a workspace;
/// nothing at all touches a channel delivery or an attempt, which stay exactly as immutable as Phase
/// 6B-3A left them.
/// <para>
/// <b>Resolution is the tenancy boundary.</b> The request carries no workspace and could not be
/// trusted with one if it did. The provider's message identifier is looked up in
/// <see cref="NotificationProviderMessage"/> — the only query in this file that ignores the tenant
/// filter, because the tenant is what it is resolving — and the workspace it names is then set as the
/// active scope for every read and write that follows. An identifier this deployment never issued
/// resolves to nothing and is acknowledged without a row being written, so a caller who guesses
/// identifiers learns nothing and a provider retrying a dead event is not left retrying forever.
/// </para>
/// <para>
/// <b>Idempotency is the provider's event identifier.</b> The provider guarantees at-least-once
/// delivery and no ordering, so the same event will arrive twice and a later event will arrive before
/// an earlier one. A unique index on the adapter and that identifier turns the repeat into a no-op;
/// write-once fact columns turn the reordering into two true statements rather than a race the last
/// writer wins.
/// </para>
/// <para>
/// <b>Nothing sensitive is persisted.</b> The raw body is never stored, and the two things in it that
/// would matter — the recipient address and the provider's diagnostic text — are never even read. The
/// mailbox a suppression is about comes from the fingerprint this application recorded when it
/// submitted the message, not from anything the provider echoes back, so a forged or altered
/// <c>to</c> could not redirect a suppression even if the signature had somehow been satisfied.
/// </para>
/// </remarks>
internal sealed class NotificationProviderEventService(
    GymDbContext dbContext,
    IMutableTenantContext tenantContext,
    IClock clock,
    IOptions<NotificationEmailOptions> options,
    ILogger<NotificationProviderEventService> logger)
    : INotificationProviderEventIngestion
{
    // Counts and stable classifications only. No event identifier is logged at information level and
    // no recipient, address, body, header or signature is logged at any level.
    private static readonly Action<ILogger, Guid, string, bool, Exception?> LogApplied =
        LoggerMessage.Define<Guid, string, bool>(
            LogLevel.Information,
            new EventId(6121, "NotificationProviderEventApplied"),
            "Provider event applied in workspace {TenantId} as {EventType}; new fact: {AppliedNewFact}.");

    private static readonly Action<ILogger, Guid, string, string, Exception?> LogSuppressed =
        LoggerMessage.Define<Guid, string, string>(
            LogLevel.Warning,
            new EventId(6122, "NotificationEmailAddressSuppressed"),
            "Email to a member of workspace {TenantId} is suppressed by {Reason} from a verified {EventType} event.");

    private static readonly Action<ILogger, string, Exception?> LogRefused =
        LoggerMessage.Define<string>(
            LogLevel.Warning,
            new EventId(6123, "NotificationProviderEventRefused"),
            "A provider webhook was refused: {Verdict}.");

    private readonly NotificationEmailOptions email = options.Value;

    public async Task<NotificationProviderEventIngestionResult> IngestAsync(
        NotificationProviderEventRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        if (!email.UsesProviderAdapter ||
            !NotificationWebhookSignature.TryParseSecret(email.Provider.WebhookSigningSecret, out var secret, out _))
        {
            return Result(NotificationProviderEventIngestionStatus.Unavailable);
        }

        var receivedAtUtc = clock.UtcNow;
        var verdict = NotificationWebhookSignature.Verify(
            secret,
            request.EventId,
            request.Timestamp,
            request.Signature,
            request.Body.Span,
            receivedAtUtc,
            TimeSpan.FromSeconds(email.Provider.WebhookToleranceSeconds));
        if (verdict != NotificationWebhookSignatureVerdict.Valid)
        {
            LogRefused(logger, verdict.ToString(), null);
            return Result(NotificationProviderEventIngestionStatus.Unauthorized);
        }

        // Only now, with the exact bytes authenticated, is a parser allowed anywhere near them.
        var payload = NotificationProviderEventPayload.Read(request.Body.Span, receivedAtUtc);
        if (payload.Status == NotificationProviderEventPayloadStatus.Ignored)
        {
            // A well-formed event this build deliberately records nothing for — an open, a click, a
            // domain or contact change. Persisting even an "ignored" row for an open would be the
            // start of the tracking log this model exists to not have.
            return Result(NotificationProviderEventIngestionStatus.Ignored);
        }

        if (payload.Status != NotificationProviderEventPayloadStatus.Read || payload.Facts is not { } facts)
        {
            return Result(NotificationProviderEventIngestionStatus.Malformed);
        }

        var adapter = NotificationEmailAdapters.ResendAdapterName;
        var providerMessage = await dbContext.NotificationProviderMessages
            .IgnoreQueryFilters()
            .AsNoTracking()
            .SingleOrDefaultAsync(
                candidate => candidate.Adapter == adapter &&
                             candidate.ProviderMessageId == facts.ProviderMessageId,
                cancellationToken);
        if (providerMessage is null)
        {
            return Result(NotificationProviderEventIngestionStatus.UnknownMessage);
        }

        tenantContext.SetTenant(providerMessage.TenantId);

        // At most two passes. A second verified event for the same message can race this one to the
        // suppression row; the loser re-reads, finds the suppression already there, and completes.
        for (var attempt = 0; attempt < 2; attempt++)
        {
            try
            {
                return await ApplyAsync(
                    providerMessage.Id,
                    providerMessage.TenantId,
                    providerMessage.RecipientUserId,
                    adapter,
                    request.EventId!,
                    facts,
                    receivedAtUtc,
                    cancellationToken);
            }
            catch (DbUpdateException exception) when (IsUniqueViolation(exception, out var constraint))
            {
                dbContext.ChangeTracker.Clear();
                if (string.Equals(
                        constraint,
                        DatabaseConstraintNames.OneNotificationProviderEventPerProviderId,
                        StringComparison.Ordinal))
                {
                    // The same event, concurrently. Converged rather than duplicated.
                    return Result(NotificationProviderEventIngestionStatus.Duplicate);
                }

                if (!string.Equals(
                        constraint,
                        DatabaseConstraintNames.OneEmailSuppressionPerAddress,
                        StringComparison.Ordinal))
                {
                    throw;
                }
            }
        }

        return Result(NotificationProviderEventIngestionStatus.Duplicate);
    }

    private async Task<NotificationProviderEventIngestionResult> ApplyAsync(
        Guid providerMessageRecordId,
        Guid tenantId,
        Guid recipientUserId,
        string adapter,
        string providerEventId,
        NotificationProviderEventFacts facts,
        DateTimeOffset receivedAtUtc,
        CancellationToken cancellationToken)
    {
        var strategy = dbContext.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);

            // The same lock the preference write and the final materialization recheck take. Without
            // it a bounce could commit in the window between the dispatcher checking suppression and
            // handing the message to the provider, and the very message that suppressed the mailbox
            // would be followed by one more. With it, whichever operation takes the lock first has an
            // unambiguous order and the dispatcher either sees the suppression or finishes first.
            await NotificationAdvisoryLocks.LockRecipientPolicyAsync(
                dbContext,
                tenantId,
                recipientUserId,
                cancellationToken);

            // Tenant-filtered from here on: the workspace was resolved from the durable relationship,
            // and every row this touches has to belong to it.
            var alreadyRecorded = await dbContext.NotificationProviderEvents
                .AsNoTracking()
                .AnyAsync(
                    candidate => candidate.Adapter == adapter &&
                                 candidate.ProviderEventId == providerEventId,
                    cancellationToken);
            if (alreadyRecorded)
            {
                await transaction.CommitAsync(cancellationToken);
                return Result(NotificationProviderEventIngestionStatus.Duplicate);
            }

            var message = await dbContext.NotificationProviderMessages
                .SingleAsync(candidate => candidate.Id == providerMessageRecordId, cancellationToken);

            var appliedNewFact = message.Apply(
                facts.EventType,
                facts.BounceClass,
                facts.FailureCode,
                facts.OccurredAtUtc,
                receivedAtUtc);

            var evidence = NotificationProviderEvent.Record(
                message.TenantId,
                message.Id,
                adapter,
                providerEventId,
                facts.EventType,
                facts.BounceClass,
                facts.FailureCode,
                facts.OccurredAtUtc,
                receivedAtUtc,
                appliedNewFact);
            dbContext.NotificationProviderEvents.Add(evidence);

            // Suppression follows the fact this event established, never a fact an earlier event
            // already recorded: a duplicate bounce must not write a second suppression, and a
            // recipient-server acceptance arriving after a bounce must not undo one.
            if (appliedNewFact && message.SuppressionReasonFor(facts.EventType) is { } reason)
            {
                await SuppressAsync(message, evidence, reason, receivedAtUtc, cancellationToken);
            }

            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);

            LogApplied(logger, message.TenantId, facts.EventType.ToString(), appliedNewFact, null);
            return Result(NotificationProviderEventIngestionStatus.Recorded);
        });
    }

    /// <summary>
    /// Stops further email to the exact mailbox this message was accepted for.
    /// </summary>
    /// <remarks>
    /// The fingerprint and the member come from the provider-message row this application wrote at
    /// submission, not from the webhook. That is what keeps suppression honest in both directions: a
    /// forged body cannot aim it at somebody else's mailbox, and a member who has since corrected a
    /// mistyped address is not suppressed, because the address they use now fingerprints differently.
    /// </remarks>
    private async Task SuppressAsync(
        NotificationProviderMessage message,
        NotificationProviderEvent evidence,
        NotificationEmailSuppressionReason reason,
        DateTimeOffset receivedAtUtc,
        CancellationToken cancellationToken)
    {
        var alreadySuppressed = await dbContext.NotificationEmailSuppressions
            .AsNoTracking()
            .AnyAsync(
                candidate => candidate.UserId == message.RecipientUserId &&
                             candidate.AddressFingerprint == message.RecipientAddressFingerprint,
                cancellationToken);
        if (alreadySuppressed)
        {
            return;
        }

        dbContext.NotificationEmailSuppressions.Add(NotificationEmailSuppression.Record(
            message.TenantId,
            message.RecipientUserId,
            message.RecipientAddressFingerprint,
            message.FingerprintKeyId,
            reason,
            receivedAtUtc,
            evidence.Id,
            message.Id));
        LogSuppressed(logger, message.TenantId, reason.ToString(), evidence.EventType.ToString(), null);
    }

    private static NotificationProviderEventIngestionResult Result(
        NotificationProviderEventIngestionStatus status) =>
        NotificationProviderEventIngestionResult.Of(status);

    private static bool IsUniqueViolation(DbUpdateException exception, out string? constraint)
    {
        if (exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation } postgres)
        {
            constraint = postgres.ConstraintName;
            return true;
        }

        constraint = null;
        return false;
    }
}
