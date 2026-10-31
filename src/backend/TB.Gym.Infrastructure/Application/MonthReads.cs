using Microsoft.EntityFrameworkCore;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Subscriptions;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// The two reads Coach Today's This month (CLI-020) and the This month page (SUB-018) share, so a number never differs
/// between them.
/// </summary>
internal static class MonthReads
{
    /// <summary>
    /// In one read, the receipts whose instant falls in <c>[fromUtc, toUtc)</c>, the months and a day either side
    /// (<see cref="MoneyReceivedPolicy.ReadWindowUtc"/>), each with the coach history of the client it was for
    /// (ADR 0026). <see cref="MoneyReceivedPolicy"/> then decides each receipt's month, by its workspace day, and its
    /// coach. A coach's read is narrowed to clients they ever coached; the rule decides which receipts are theirs.
    /// Every client counts, a former one or one coached by someone else since included: the money arrived (ADR 0027
    /// keeps payments).
    /// </summary>
    public static async Task<IReadOnlyList<ReceivedPayment>> ReceiptsAsync(
        GymDbContext dbContext,
        Guid? coachUserId,
        DateTimeOffset fromUtc,
        DateTimeOffset toUtc,
        string tag,
        CancellationToken cancellationToken)
    {
        var rows = await (
            from payment in dbContext.PaymentRecords.AsNoTracking()
            join enrollment in dbContext.ClientEnrollments.AsNoTracking()
                on new { payment.TenantId, Id = payment.EnrollmentId }
                equals new { enrollment.TenantId, enrollment.Id }
            where payment.Operation == PaymentOperation.Receipt &&
                  payment.ReceivedAtUtc >= fromUtc &&
                  payment.ReceivedAtUtc < toUtc &&
                  (coachUserId == null || dbContext.ClientCoachAssignments.Any(entry =>
                      entry.TenantId == enrollment.TenantId &&
                      entry.ClientProfileId == enrollment.ClientProfileId &&
                      entry.CoachUserId == coachUserId))
            select new
            {
                payment.Amount,
                payment.CurrencyCode,
                payment.ReceivedAtUtc,
                payment.Operation,
                History = dbContext.ClientCoachAssignments
                    .Where(entry =>
                        entry.TenantId == enrollment.TenantId &&
                        entry.ClientProfileId == enrollment.ClientProfileId)
                    .Select(entry => new CoachHistoryEntry(entry.Sequence, entry.CoachUserId, entry.AssignedAtUtc))
                    .ToList(),
            })
            .TagWith(tag)
            .ToListAsync(cancellationToken);
        return [.. rows.Select(row => new ReceivedPayment(
            row.Amount,
            row.CurrencyCode,
            row.ReceivedAtUtc,
            row.Operation,
            row.History))];
    }

    /// <summary>
    /// The sessions held in <c>[from, toExclusive)</c> that still stand: a session counts on its own workspace day, a
    /// former client's too, for who held it (SES-003), or every one with <paramref name="coachUserId"/> null, and an
    /// undone one counts for nobody. A charge is no session held.
    /// </summary>
    public static IQueryable<SessionLedgerEntry> SessionsHeld(
        GymDbContext dbContext,
        Guid? coachUserId,
        DateOnly from,
        DateOnly toExclusive) =>
        dbContext.SessionLedgerEntries.AsNoTracking()
            .Where(entry => entry.Kind == SessionEntryKind.Held &&
                            entry.Day >= from &&
                            entry.Day < toExclusive &&
                            (coachUserId == null || entry.CoachUserId == coachUserId) &&
                            !dbContext.SessionLedgerEntries.Any(undo =>
                                undo.TenantId == entry.TenantId && undo.VoidsEntryId == entry.Id));
}
