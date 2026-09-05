using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Notifications;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// The signed-in member's own notification settings, in the active workspace.
/// </summary>
/// <remarks>
/// Two narrowings apply to every read and write. The workspace comes from the tenant authorization
/// handler, which has already verified an active membership, and is enforced again by the global query
/// filter; the member comes from the authentication cookie and is applied as a predicate here. There
/// is no parameter anywhere in this class that names a subject, so a coach or an owner has no route
/// that opts somebody else into email — not a forgotten check, an absent shape.
/// <para>
/// A write is one transaction that does three things or none of them: it spends the idempotency key,
/// it updates the mutable preference under its concurrency token, and it appends consent evidence for
/// every email decision that actually changed. The mutable row is a read optimisation over that
/// evidence, so the two can be compared afterwards and must agree.
/// </para>
/// </remarks>
internal sealed class NotificationPreferenceService(
    GymDbContext dbContext,
    IClock clock,
    ICurrentUser currentUser,
    ITenantContext tenantContext,
    INotificationRecipientContacts contacts,
    IOptions<NotificationEmailOptions> emailOptions)
    : INotificationPreferenceService
{
    /// <summary>
    /// Advisory locks share one 64-bit key space across the database, so this use is mixed with a
    /// constant that namespaces it and keeps it clear of the media quota and messaging locks. Two
    /// different keys can collide in this space; the only consequence is that they serialize with each
    /// other, which costs a little concurrency and breaks nothing.
    /// </summary>
    private const long PreferenceIdempotencyLockNamespace = 0x6B3_0000_0000_0000L;

    private readonly NotificationEmailOptions email = emailOptions.Value;

    public async Task<NotificationPreferenceView?> GetOwnAsync(CancellationToken cancellationToken)
    {
        if (!TryResolveMember(out var userId))
        {
            return null;
        }

        var timeZoneId = await ReadTimeZoneAsync(cancellationToken);
        if (timeZoneId is null)
        {
            return null;
        }

        var preference = await dbContext.NotificationChannelPreferences
            .AsNoTracking()
            .SingleOrDefaultAsync(item => item.UserId == userId, cancellationToken);

        // A member who has never opened the screen has no row, and reading their settings must not
        // create one: a GET that writes would turn every navigation into a database write and would
        // make "has this person ever decided anything" unanswerable.
        var suppression = await ReadSuppressionReasonAsync(userId, cancellationToken);
        return preference is null
            ? ToView(
                NotificationChannelPreference.CreateDefault(tenantContext.TenantId, userId),
                timeZoneId,
                suppression)
            : ToView(preference, timeZoneId, suppression);
    }

    public async Task<NotificationPreferenceCommandResult> UpdateOwnAsync(
        UpdateNotificationPreferenceRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (!TryResolveMember(out var userId))
        {
            return NotificationPreferenceCommandResult.NotFound();
        }

        if (request.IdempotencyKey == Guid.Empty)
        {
            return NotificationPreferenceCommandResult.Invalid(
                "idempotencyKey",
                "An idempotency key is required.");
        }

        if (!TryReadQuietHours(request, out var quietHoursStart, out var quietHoursEnd, out var invalid))
        {
            return invalid!;
        }

        var timeZoneId = await ReadTimeZoneAsync(cancellationToken);
        if (timeZoneId is null)
        {
            return NotificationPreferenceCommandResult.NotFound();
        }

        // A configured zone the runtime cannot resolve would make quiet hours unenforceable, so the
        // command is refused rather than stored against a frame nothing can evaluate.
        if (request.QuietHoursEnabled && !NotificationQuietHoursPolicy.TryResolveZone(timeZoneId, out _))
        {
            return NotificationPreferenceCommandResult.Invalid(
                "quietHours",
                "This workspace's time zone cannot be resolved, so quiet hours cannot be saved.");
        }

        var fingerprint = NotificationPreferenceFingerprint.ForUpdate(
            tenantContext.TenantId,
            userId,
            request.EmailServiceEnabled,
            request.QuietHoursEnabled,
            quietHoursStart,
            quietHoursEnd);

        try
        {
            return await dbContext.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
            {
                await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);

                // The key is serialized first, before the preference row is read, because the row whose
                // existence is being decided may not exist yet. Two concurrent identical retries meet
                // here rather than both writing.
                await LockIdempotencyKeyAsync(request.IdempotencyKey, cancellationToken);
                await NotificationAdvisoryLocks.LockRecipientPolicyAsync(
                    dbContext,
                    tenantContext.TenantId,
                    userId,
                    cancellationToken);
                var spent = await dbContext.NotificationPreferenceCommandRecords
                    .AsNoTracking()
                    .SingleOrDefaultAsync(
                        item => item.IdempotencyKey == request.IdempotencyKey,
                        cancellationToken);
                if (spent is not null)
                {
                    await transaction.CommitAsync(cancellationToken);
                    return spent.Matches(
                        NotificationPreferenceCommandType.UpdateOwnPreferences,
                        fingerprint,
                        userId)
                        // The caller lost a response, not a decision. Replay the response produced by
                        // that command, not mutable settings written by a later command.
                        ? NotificationPreferenceCommandResult.Success(spent.ReplayResult(
                            await ReadSuppressionReasonAsync(userId, cancellationToken)))
                        : NotificationPreferenceCommandResult.Conflict(
                            "idempotency_conflict",
                            "This request key was already used for different notification settings.");
                }

                var preference = await dbContext.NotificationChannelPreferences
                    .SingleOrDefaultAsync(item => item.UserId == userId, cancellationToken);
                if (preference is null)
                {
                    // First decision. Version 0 is the honest expected token for a row that does not
                    // exist yet, and anything else means the caller is working from a state that never
                    // was.
                    if (request.Version != 0)
                    {
                        await transaction.RollbackAsync(cancellationToken);
                        return NotificationPreferenceCommandResult.Conflict(
                            "concurrency_conflict",
                            "Your notification settings were changed by another request. Reload and try again.");
                    }

                    preference = NotificationChannelPreference.CreateDefault(tenantContext.TenantId, userId);
                    dbContext.NotificationChannelPreferences.Add(preference);
                }
                else
                {
                    dbContext.Entry(preference).Property(item => item.Version).OriginalValue = request.Version;
                }

                var now = clock.UtcNow;
                var evidence = preference.SetEmailService(
                    request.EmailServiceEnabled,
                    userId,
                    now,
                    NotificationPreferencePolicy.OwnSettingsSource);
                if (evidence is not null)
                {
                    // Appended in the same transaction as the change it explains, so the mutable row
                    // and the evidence can never disagree about what was decided.
                    dbContext.NotificationConsentEvents.Add(evidence);
                }

                preference.SetQuietHours(request.QuietHoursEnabled, quietHoursStart, quietHoursEnd);

                // Save the preference first so PostgreSQL's xmin concurrency token is the exact
                // version returned to the caller and snapshotted by the command record. Both saves
                // are still one transaction, so neither can become visible without the other.
                await dbContext.SaveChangesAsync(cancellationToken);
                var result = ToView(
                    preference,
                    timeZoneId,
                    await ReadSuppressionReasonAsync(userId, cancellationToken));
                dbContext.NotificationPreferenceCommandRecords.Add(
                    NotificationPreferenceCommandRecord.Record(
                        tenantContext.TenantId,
                        request.IdempotencyKey,
                        NotificationPreferenceCommandType.UpdateOwnPreferences,
                        fingerprint,
                        userId,
                        now,
                        result));

                await dbContext.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return NotificationPreferenceCommandResult.Success(result);
            });
        }
        catch (ArgumentException exception)
        {
            return NotificationPreferenceCommandResult.Invalid("quietHours", exception.Message);
        }
        catch (DbUpdateConcurrencyException)
        {
            return NotificationPreferenceCommandResult.Conflict(
                "concurrency_conflict",
                "Your notification settings were changed by another request. Reload and try again.");
        }
        catch (DbUpdateException exception) when (IsUniqueViolation(exception, out var constraint))
        {
            // Two requests that both got past the key check — different keys racing to create the
            // same member's first row, or an identical retry that arrived on another connection.
            // Neither is a server error, and both are settled by re-reading the winner's row.
            return constraint == DatabaseConstraintNames.OneNotificationPreferenceCommandPerKey
                ? await ReplayIfMatchingAsync(request, userId, fingerprint, cancellationToken)
                : NotificationPreferenceCommandResult.Conflict(
                    "concurrency_conflict",
                    "Your notification settings were changed by another request. Reload and try again.");
        }
    }

    /// <summary>
    /// Settles a key collision that the advisory lock could not, because the two requests were on
    /// different connections and the loser only discovered the winner at the unique index.
    /// </summary>
    private async Task<NotificationPreferenceCommandResult> ReplayIfMatchingAsync(
        UpdateNotificationPreferenceRequest request,
        Guid userId,
        string fingerprint,
        CancellationToken cancellationToken)
    {
        dbContext.ChangeTracker.Clear();
        var winner = await dbContext.NotificationPreferenceCommandRecords
            .AsNoTracking()
            .SingleOrDefaultAsync(item => item.IdempotencyKey == request.IdempotencyKey, cancellationToken);
        if (winner is null)
        {
            return NotificationPreferenceCommandResult.Conflict(
                "concurrency_conflict",
                "Your notification settings were changed by another request. Reload and try again.");
        }

        return winner.Matches(NotificationPreferenceCommandType.UpdateOwnPreferences, fingerprint, userId)
            ? NotificationPreferenceCommandResult.Success(winner.ReplayResult(
                await ReadSuppressionReasonAsync(userId, cancellationToken)))
            : NotificationPreferenceCommandResult.Conflict(
                "idempotency_conflict",
                "This request key was already used for different notification settings.");
    }

    private static bool TryReadQuietHours(
        UpdateNotificationPreferenceRequest request,
        out TimeOnly? start,
        out TimeOnly? end,
        out NotificationPreferenceCommandResult? invalid)
    {
        start = null;
        end = null;
        invalid = null;
        if (!request.QuietHoursEnabled)
        {
            // Leftover times on a disabled window are ignored rather than refused: the browser keeps
            // the last values in its inputs so the user can switch quiet hours back on without
            // retyping them, and that is not an error to report.
            return true;
        }

        if (!NotificationLocalTime.TryParse(request.QuietHoursStartLocal, out var parsedStart))
        {
            invalid = NotificationPreferenceCommandResult.Invalid(
                "quietHoursStartLocal",
                "A quiet-hours start time is required, as a 24-hour HH:mm value.");
            return false;
        }

        if (!NotificationLocalTime.TryParse(request.QuietHoursEndLocal, out var parsedEnd))
        {
            invalid = NotificationPreferenceCommandResult.Invalid(
                "quietHoursEndLocal",
                "A quiet-hours end time is required, as a 24-hour HH:mm value.");
            return false;
        }

        if (parsedStart == parsedEnd)
        {
            invalid = NotificationPreferenceCommandResult.Invalid(
                "quietHoursEndLocal",
                "Quiet hours must start and end at different times. Choose an end time that differs from the start.");
            return false;
        }

        start = parsedStart;
        end = parsedEnd;
        return true;
    }

    private async Task<string?> ReadTimeZoneAsync(CancellationToken cancellationToken) =>
        await dbContext.Tenants
            .AsNoTracking()
            .Where(item => item.Id == tenantContext.TenantId)
            .Select(item => item.TimeZoneId)
            .SingleOrDefaultAsync(cancellationToken);

    private async Task LockIdempotencyKeyAsync(Guid idempotencyKey, CancellationToken cancellationToken) =>
        // The affected-row count of a lock statement means nothing, so it is deliberately discarded.
        // The marker comment is deliberate too: the integration barriers arm on it, so a race test can
        // prove both requests reached this exact boundary.
        await dbContext.Database.ExecuteSqlAsync(
            $"SELECT pg_advisory_xact_lock({IdempotencyLockKey(tenantContext.TenantId, idempotencyKey)}) /* notification-preference-idempotency */",
            cancellationToken);

    private bool TryResolveMember(out Guid userId)
    {
        userId = currentUser.UserId ?? Guid.Empty;
        return tenantContext.HasTenant && userId != Guid.Empty;
    }

    /// <summary>
    /// Whether this member's current mailbox is durably suppressed, and why.
    /// </summary>
    /// <remarks>
    /// Resolved through the same authorized contract the dispatcher uses, and compared as a keyed
    /// fingerprint under every configured key — so a key rotation does not make a live suppression
    /// look cleared, and a member who corrects a mistyped address sees it clear by itself, because
    /// the address they use now fingerprints differently. The address exists for the length of this
    /// call and is never returned, stored or logged.
    /// </remarks>
    private async Task<NotificationEmailSuppressionReason?> ReadSuppressionReasonAsync(
        Guid userId,
        CancellationToken cancellationToken)
    {
        var keys = email.Provider.ResolveFingerprintKeys();
        if (keys.Count == 0)
        {
            // No provider is configured, so nothing can have been suppressed by one.
            return null;
        }

        var contact = await contacts.ResolveAsync(tenantContext.TenantId, userId, cancellationToken);
        if (contact is null)
        {
            return null;
        }

        var fingerprints = NotificationAddressFingerprint.ComputeAll(keys, contact.EmailAddress);
        return await dbContext.NotificationEmailSuppressions
            .AsNoTracking()
            .Where(item => item.UserId == userId && fingerprints.Contains(item.AddressFingerprint))
            .Select(item => (NotificationEmailSuppressionReason?)item.Reason)
            .FirstOrDefaultAsync(cancellationToken);
    }

    private NotificationPreferenceView ToView(
        NotificationChannelPreference preference,
        string timeZoneId,
        NotificationEmailSuppressionReason? suppressionReason) => new(
        // In-app is stated rather than implied. It is always on, every supported type keeps it, and
        // this slice deliberately offers no way to switch it off.
        InAppEnabled: true,
        preference.EmailServiceEnabled,
        preference.EmailMarketingEnabled,
        email.IsAvailable,
        suppressionReason is not null,
        suppressionReason,
        preference.QuietHoursEnabled,
        NotificationLocalTime.Format(preference.QuietHoursStartLocal),
        NotificationLocalTime.Format(preference.QuietHoursEndLocal),
        timeZoneId,
        preference.PolicyVersion,
        preference.Version);

    private static bool IsUniqueViolation(DbUpdateException exception, out string? constraintName)
    {
        if (exception.InnerException is PostgresException
            {
                SqlState: PostgresErrorCodes.UniqueViolation,
            } postgres)
        {
            constraintName = postgres.ConstraintName;
            return true;
        }

        constraintName = null;
        return false;
    }

    private static long IdempotencyLockKey(Guid tenantId, Guid idempotencyKey) =>
        BitConverter.ToInt64(tenantId.ToByteArray(), 0)
        ^ BitConverter.ToInt64(tenantId.ToByteArray(), 8)
        ^ BitConverter.ToInt64(idempotencyKey.ToByteArray(), 0)
        ^ BitConverter.ToInt64(idempotencyKey.ToByteArray(), 8)
        ^ PreferenceIdempotencyLockNamespace;
}
