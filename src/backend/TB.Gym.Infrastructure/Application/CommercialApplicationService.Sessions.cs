using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// 1-on-1 sessions on a client's packs (critique B10b, ADR 0038): a session held or charged on the pack ending first,
/// with a receipt in the same command when the client paid that day, and the correction that undoes one. The ledger is
/// append-only; each command locks the client's packs, so a last session cannot go twice.
/// </summary>
internal sealed partial class CommercialApplicationService
{
    public async Task<CommercialCommandResult> RecordSessionAsync(
        Guid clientProfileId,
        RecordSessionRequest request,
        CancellationToken cancellationToken)
    {
        if (currentUser.UserId is not { } actorId)
        {
            return NotFound();
        }

        if (request.IdempotencyKey == Guid.Empty)
        {
            return Invalid("idempotencyKey", "A non-empty idempotency key is required.");
        }

        // A body without the day binds to 0001-01-01.
        if (request.Day == default)
        {
            return Invalid("day", "Choose the day of the session.");
        }

        if (!Enum.IsDefined(request.Outcome))
        {
            return Invalid("outcome", "Say whether the session was held or charged.");
        }

        var note = request.Outcome == SessionOutcome.Held ? NormalizeOptional(request.Note) : null;
        var reason = request.Outcome == SessionOutcome.Charged ? NormalizeOptional(request.Reason) : null;
        var heldBy = request.Outcome == SessionOutcome.Held ? request.HeldByUserId ?? actorId : actorId;
        if (request.Outcome == SessionOutcome.Charged && reason is null)
        {
            return Invalid("reason", "Say why the session is charged. Your client reads it.");
        }

        if ((note ?? reason)?.Length > SessionLedgerEntry.TextLimit)
        {
            return Invalid(
                request.Outcome == SessionOutcome.Held ? "note" : "reason",
                $"Keep it to {SessionLedgerEntry.TextLimit} characters.");
        }

        if (request.Receipt is { } money)
        {
            if (!Enum.IsDefined(money.Method))
            {
                return Invalid("method", "Choose how it was paid.");
            }

            if (MoneyRules.AmountProblem(money.Amount, allowZero: false) is { } amountProblem)
            {
                return Invalid("amount", amountProblem);
            }
        }

        var firstName = await dbContext.ClientProfiles
            .AsNoTracking()
            .Where(item => item.Id == clientProfileId)
            .Select(item => item.FirstName)
            .SingleOrDefaultAsync(cancellationToken);
        if (firstName is null || await coachClientScope.ExcludesAsync(clientProfileId, cancellationToken))
        {
            return NotFound();
        }

        // A coach logs only their own (critique B12), checked past the 404 so another coach's client stays unseen.
        if (heldBy != actorId && !await coachClientScope.IsOwnerAsync(cancellationToken))
        {
            return Conflict(
                "session_held_by_someone_else",
                "A coach records their own sessions. The owner records one that someone else held.");
        }

        await coachClientScope.EnsureNotReleasedAsync(clientProfileId, cancellationToken);
        var strategy = dbContext.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            dbContext.ChangeTracker.Clear();
            await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
            try
            {
                await dbContext.Database.ExecuteSqlInterpolatedAsync(
                    $"SELECT 1 FROM subscriptions.\"ClientEnrollments\" WHERE \"TenantId\" = {tenantContext.TenantId} AND \"ClientProfileId\" = {clientProfileId} AND \"SessionCountSnapshot\" IS NOT NULL ORDER BY \"Id\" FOR UPDATE",
                    cancellationToken);
                var (zone, today) = await GetWorkspaceDayAsync(cancellationToken);
                if (await SessionReplayAsync(clientProfileId, request, heldBy, note, reason, zone, cancellationToken) is { } replay)
                {
                    return replay;
                }

                // Locked as an assignment locks a coach (ADR 0026): a removal waits for this session, or it finds them gone.
                if (heldBy != actorId &&
                    !await CoachTeam.LockActiveStaffAsync(dbContext, tenantContext.TenantId, heldBy, cancellationToken))
                {
                    return Conflict(
                        "session_holder_not_staff",
                        "That person is not on your team, so the session can’t be recorded for them. Choose someone on your team.");
                }

                var access = await featureAccessService.EvaluateAsync(
                    tenantContext.TenantId,
                    clientProfileId,
                    CoachingFeature.Sessions,
                    cancellationToken);
                if (ClosedToSessions(access.Reason, firstName) is { } closed)
                {
                    return closed;
                }

                var packs = await dbContext.ClientEnrollments
                    .Where(item => item.ClientProfileId == clientProfileId && item.SessionCountSnapshot != null)
                    .ToListAsync(cancellationToken);
                var standing = await StandingOfAsync(clientProfileId, packs, cancellationToken);
                if (request.Receipt is { } receipt && request.Day <= today)
                {
                    var refusal = await TakeSessionReceiptAsync(
                        standing, request, receipt, zone, actorId, cancellationToken);
                    if (refusal is not null)
                    {
                        return refusal;
                    }

                    // The pack's Issued row goes in first: the ledger's guard counts it before a session.
                    await dbContext.SaveChangesAsync(cancellationToken);
                    standing = await StandingOfAsync(clientProfileId, packs, cancellationToken);
                }

                var choice = SessionPackRules.Choose(standing, request.Day, today);
                if (choice.Pack is not { } pack || choice.Refusal is not null)
                {
                    return RefuseSession(choice, request.Day, firstName);
                }

                dbContext.SessionLedgerEntries.Add(request.Outcome == SessionOutcome.Held
                    ? SessionLedgerEntry.Hold(pack, request.Day, heldBy, actorId, note, request.IdempotencyKey)
                    : SessionLedgerEntry.Charge(pack, request.Day, actorId, reason!, request.IdempotencyKey));
                await dbContext.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return await EnrollmentSuccessAsync(pack.Id, cancellationToken);
            }
            catch (ArgumentException exception)
            {
                return Invalid("session", exception.PersonMessage());
            }
            catch (InvalidOperationException exception)
            {
                return Invalid("session", exception.PersonMessage());
            }
            catch (DbUpdateConcurrencyException)
            {
                return Conflict("concurrency_conflict", "The pack changed while the session was being recorded.");
            }
            catch (DbUpdateException exception) when (IsSessionWriteConflict(exception))
            {
                return Conflict("session_conflict", "The session clashes with an earlier request. Reload the page to see what was saved.");
            }
        });
    }

    public async Task<CommercialCommandResult> VoidSessionAsync(
        Guid clientProfileId,
        Guid entryId,
        VoidSessionRequest request,
        CancellationToken cancellationToken)
    {
        if (request.IdempotencyKey == Guid.Empty)
        {
            return Invalid("idempotencyKey", "A non-empty idempotency key is required.");
        }

        var entry = await dbContext.SessionLedgerEntries
            .AsNoTracking()
            .SingleOrDefaultAsync(
                item => item.Id == entryId && item.ClientProfileId == clientProfileId,
                cancellationToken);
        if (entry is null || await coachClientScope.ExcludesAsync(clientProfileId, cancellationToken))
        {
            return NotFound();
        }

        await coachClientScope.EnsureNotReleasedAsync(clientProfileId, cancellationToken);
        var strategy = dbContext.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            dbContext.ChangeTracker.Clear();
            await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
            try
            {
                await dbContext.Database.ExecuteSqlInterpolatedAsync(
                    $"SELECT 1 FROM subscriptions.\"ClientEnrollments\" WHERE \"TenantId\" = {tenantContext.TenantId} AND \"Id\" = {entry.EnrollmentId} FOR UPDATE",
                    cancellationToken);
                var prior = await dbContext.SessionLedgerEntries
                    .AsNoTracking()
                    .SingleOrDefaultAsync(item => item.IdempotencyKey == request.IdempotencyKey, cancellationToken);
                if (prior is not null)
                {
                    return prior.VoidsEntryId == entryId
                        ? await EnrollmentSuccessAsync(prior.EnrollmentId, cancellationToken)
                        : Conflict("idempotency_key_reused", "That clashes with an earlier request. Reload the page to see what was saved.");
                }

                if (entry.Kind is not (SessionEntryKind.Held or SessionEntryKind.Charged))
                {
                    return Conflict("session_not_undoable", "Only a session held or charged can be undone.");
                }

                if (await dbContext.SessionLedgerEntries.AnyAsync(item => item.VoidsEntryId == entryId, cancellationToken))
                {
                    return Conflict("session_already_undone", "This session was already undone.");
                }

                var pack = await dbContext.ClientEnrollments
                    .AsNoTracking()
                    .SingleAsync(item => item.Id == entry.EnrollmentId, cancellationToken);
                var today = await GetTenantTodayAsync(cancellationToken);
                dbContext.SessionLedgerEntries.Add(SessionLedgerEntry.Void(pack, entry, today, request.IdempotencyKey));
                await dbContext.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return await EnrollmentSuccessAsync(pack.Id, cancellationToken);
            }
            catch (DbUpdateException exception) when (IsSessionWriteConflict(exception))
            {
                return Conflict("session_already_undone", "This session was already undone.");
            }
        });
    }

    /// <summary>Each pack's ledger read as a coach reads it, with who held what.</summary>
    private async Task<IReadOnlyDictionary<Guid, SessionPackView>> LoadSessionPacksAsync(
        IReadOnlyCollection<ClientEnrollment> enrollments,
        DateOnly today,
        TimeZoneInfo zone,
        CancellationToken cancellationToken)
    {
        var packIds = enrollments.Where(item => item.IsSessionPack).Select(item => item.Id).ToArray();
        if (packIds.Length == 0)
        {
            return new Dictionary<Guid, SessionPackView>();
        }

        var entries = await dbContext.SessionLedgerEntries
            .AsNoTracking()
            .Where(item => packIds.Contains(item.EnrollmentId))
            .ToListAsync(cancellationToken);
        var coachIds = entries
            .SelectMany(item => new[] { item.CoachUserId, item.RecordedByUserId })
            .OfType<Guid>()
            .Distinct()
            .ToArray();
        var coachNames = coachIds.Length == 0
            ? new Dictionary<Guid, string>()
            : await dbContext.Users
                .AsNoTracking()
                .Where(user => coachIds.Contains(user.Id))
                .ToDictionaryAsync(user => user.Id, user => user.DisplayName, cancellationToken);
        return enrollments
            .Where(item => item.IsSessionPack)
            .ToDictionary(
                item => item.Id,
                item => SessionLedger.ViewOf(
                    item,
                    entries.Where(entry => entry.EnrollmentId == item.Id).ToArray(),
                    coachNames,
                    today,
                    zone));
    }

    private void IssueSessions(ClientEnrollment enrollment, DateOnly tenantToday)
    {
        if (enrollment.IsSessionPack)
        {
            dbContext.SessionLedgerEntries.Add(SessionLedgerEntry.Issue(enrollment, tenantToday));
        }
    }

    private async Task<SessionPackStanding[]> StandingOfAsync(
        Guid clientProfileId,
        IReadOnlyCollection<ClientEnrollment> packs,
        CancellationToken cancellationToken)
    {
        var entries = await dbContext.SessionLedgerEntries
            .AsNoTracking()
            .Where(item => item.ClientProfileId == clientProfileId)
            .ToListAsync(cancellationToken);
        return packs
            .Select(pack => new SessionPackStanding(
                pack,
                SessionLedger.Balance(entries.Where(entry => entry.EnrollmentId == pack.Id))))
            .ToArray();
    }

    /// <summary>
    /// The money taken with a session pays the pack waiting on that day, and only in full: a part payment opens nothing
    /// (SUB-008), so the session could not go on it. It is the command's own key, dated the session's day (WEA-6).
    /// </summary>
    private async Task<CommercialCommandResult?> TakeSessionReceiptAsync(
        IReadOnlyCollection<SessionPackStanding> standing,
        RecordSessionRequest request,
        SessionReceiptRequest receipt,
        TimeZoneInfo zone,
        Guid actorId,
        CancellationToken cancellationToken)
    {
        if (SessionPackRules.WaitingOn(standing, request.Day) is not { } waiting)
        {
            return Conflict("no_pack_waiting_for_payment", "No pack is waiting for payment on that day.");
        }

        var leftToPay = waiting.PriceAmount - await PaidAmountAsync(waiting.Id, cancellationToken);
        if (MoneyRules.NormalizeAmount(receipt.Amount, allowZero: false) != leftToPay)
        {
            return Conflict(
                "session_receipt_not_full",
                $"{waiting.ProductNameSnapshot} needs paying in full before a session goes on it: {waiting.PriceCurrency} {leftToPay.ToString("#,0.##", CultureInfo.InvariantCulture)} is left to pay.");
        }

        if (PaymentDay.ReceivedAtUtc(request.Day, zone, clock.UtcNow) is not { } receivedAtUtc)
        {
            return Invalid("day", PaymentDay.FutureMessage);
        }

        return await ApplyReceiptAsync(
            waiting,
            new ReceiptEntry(
                receipt.Amount,
                receipt.CurrencyCode,
                receivedAtUtc,
                receipt.Method,
                null,
                null,
                request.IdempotencyKey),
            actorId,
            cancellationToken);
    }

    /// <summary>
    /// A retry of a command already done answers with what it did (SUB-011), the session and any receipt alike. The
    /// key is bound to the session as entered: a changed day, outcome, holder, note, reason or receipt conflicts. Null
    /// when the key is new.
    /// </summary>
    private async Task<CommercialCommandResult?> SessionReplayAsync(
        Guid clientProfileId,
        RecordSessionRequest request,
        Guid heldBy,
        string? note,
        string? reason,
        TimeZoneInfo zone,
        CancellationToken cancellationToken)
    {
        var entry = await dbContext.SessionLedgerEntries
            .AsNoTracking()
            .SingleOrDefaultAsync(item => item.IdempotencyKey == request.IdempotencyKey, cancellationToken);
        var payment = await dbContext.PaymentRecords
            .AsNoTracking()
            .SingleOrDefaultAsync(item => item.IdempotencyKey == request.IdempotencyKey, cancellationToken);
        if (entry is null && payment is null)
        {
            return null;
        }

        var kind = request.Outcome == SessionOutcome.Held ? SessionEntryKind.Held : SessionEntryKind.Charged;
        return entry is not null &&
               entry.ClientProfileId == clientProfileId &&
               entry.Kind == kind &&
               entry.Day == request.Day &&
               entry.CoachUserId == heldBy &&
               entry.Note == note &&
               entry.Reason == reason &&
               ReceiptMatches(payment, request, zone)
            ? await EnrollmentSuccessAsync(entry.EnrollmentId, cancellationToken)
            : Conflict("idempotency_key_reused", "That clashes with an earlier request. Reload the page to see what was saved.");
    }

    private static bool ReceiptMatches(PaymentRecord? payment, RecordSessionRequest request, TimeZoneInfo zone)
    {
        if (request.Receipt is not { } receipt)
        {
            return payment is null;
        }

        try
        {
            return payment is not null &&
                payment.Amount == MoneyRules.NormalizeAmount(receipt.Amount, allowZero: false) &&
                payment.CurrencyCode == MoneyRules.NormalizeCurrency(receipt.CurrencyCode) &&
                payment.Method == receipt.Method &&
                PaymentDay.Of(payment.ReceivedAtUtc, zone) == request.Day;
        }
        catch (ArgumentException)
        {
            return false;
        }
    }

    /// <summary>The port's decisions that close the client's sessions whatever their packs say (SUB-009).</summary>
    private static CommercialCommandResult? ClosedToSessions(FeatureAccessReason reason, string firstName) =>
        reason switch
        {
            FeatureAccessReason.RelationshipBlocked => Conflict(
                "client_blocked",
                $"{firstName}’s access is blocked, so a session can’t be recorded. Unblock them on Service & access."),
            FeatureAccessReason.PlatformBlocked => Conflict(
                "client_blocked",
                $"{firstName}’s account is blocked by TB Gym, so a session can’t be recorded."),
            FeatureAccessReason.MembershipInactive => Conflict(
                "client_inactive",
                $"{firstName} is no longer coached here, so a session can’t be recorded."),
            _ => null,
        };

    private static CommercialCommandResult RefuseSession(SessionChoice choice, DateOnly day, string firstName)
    {
        var pack = choice.Pack;
        return choice.Refusal switch
        {
            SessionRefusal.Future => Conflict(
                "session_in_future",
                "A session counts once it has happened. Choose today or an earlier day."),
            SessionRefusal.NoPack => Conflict("no_session_pack", $"{firstName} has no session pack. Sell one first."),
            SessionRefusal.OutsidePack when pack is not null => Conflict(
                "session_day_outside_pack",
                $"{CoachDate(day)} is outside {pack.ProductNameSnapshot}, which runs {CoachDate(pack.StartDate)} to {CoachDate(pack.Period.LastActiveDate)}."),
            SessionRefusal.OutsidePack => Conflict(
                "session_day_outside_pack",
                $"None of {firstName}’s packs covers {CoachDate(day)}."),
            SessionRefusal.NoSessionsLeft => Conflict(
                "no_sessions_left",
                $"{firstName} has no sessions left on {pack?.ProductNameSnapshot}. Sell a new pack first."),
            SessionRefusal.WaitingForPayment => Conflict(
                "session_pack_unpaid",
                $"{pack?.ProductNameSnapshot} is waiting for payment. Record the payment first, or take it with this session."),
            SessionRefusal.Paused => Conflict(
                "session_pack_paused",
                $"{pack?.ProductNameSnapshot} is paused. Resume it to record a session."),
            _ => Conflict("session_conflict", "The session could not be recorded. Reload the page and try again."),
        };
    }

    /// <summary>A key used twice at once, a row undone twice, or the ledger's guard refusing a write past the service.</summary>
    private static bool IsSessionWriteConflict(DbUpdateException exception) =>
        exception.InnerException is PostgresException
        {
            SqlState: PostgresErrorCodes.UniqueViolation or PostgresErrorCodes.CheckViolation,
        };

    /// <summary>A receipt as entered, whichever command took it.</summary>
    private sealed record ReceiptEntry(
        decimal Amount,
        string CurrencyCode,
        DateTimeOffset ReceivedAtUtc,
        ManualPaymentMethod Method,
        string? Reference,
        string? Note,
        Guid IdempotencyKey);
}
