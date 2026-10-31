using Microsoft.EntityFrameworkCore;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.Modules.Tenancy;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// The This month page (critique B10d, SUB-018), built like Coach Today (ADR 0013): it owns no table, writes nothing
/// and copies nothing. A fixed number of set-based reads gather two months of facts; <see cref="MonthNumbersPolicy"/>
/// decides what counts, in which month and for whom.
/// </summary>
internal sealed class CoachMonthReader(
    GymDbContext dbContext,
    IClock clock,
    ICurrentUser currentUser,
    ITenantContext tenantContext,
    CoachClientScope coachClientScope)
    : ICoachMonthService
{
    /// <summary>Names the page's reads in the SQL they send, for logs and for the test that counts them.</summary>
    internal const string MoneyReceivedTag = "Coach month: money received, this month and last";

    internal const string SessionsHeldTag = "Coach month: 1-on-1 sessions held, this month and last";

    internal const string PlansTag = "Coach month: the plans booked or covering days, this month and last";

    internal const string StaffTag = "Coach month: the owner's team";

    internal const string NamesTag = "Coach month: the names on the owner's rows";

    public async Task<CoachMonthReportView> GetAsync(CancellationToken cancellationToken)
    {
        var calendar = await WorkspaceCalendarReader.ReadAsync(dbContext, clock, tenantContext.TenantId, cancellationToken);
        var zone = TimeZoneInfo.FindSystemTimeZoneById(calendar.TimeZoneId);
        var today = calendar.Today;
        var (thisFrom, toExclusive) = MoneyReceivedPolicy.MonthOf(today);
        var (lastFrom, _) = MoneyReceivedPolicy.MonthOf(thisFrom.AddDays(-1));

        var callerId = currentUser.UserId ?? Guid.Empty;
        var isOwner = await coachClientScope.IsOwnerAsync(cancellationToken);
        Guid? countsFor = isOwner ? null : callerId;

        var (fromUtc, toUtc) = MoneyReceivedPolicy.ReadWindowUtc(lastFrom, toExclusive, zone);
        var facts = new MonthFacts(
            await MonthReads.ReceiptsAsync(dbContext, countsFor, fromUtc, toUtc, MoneyReceivedTag, cancellationToken),
            await ReadSessionsAsync(countsFor, lastFrom, toExclusive, cancellationToken),
            await ReadPlansAsync(countsFor, lastFrom, toExclusive, fromUtc, toUtc, zone, cancellationToken));

        MonthNumbers ThisMonth(Guid? coach) =>
            MonthNumbersPolicy.Count(facts, thisFrom, toExclusive, today, zone, coach);
        MonthNumbers LastMonth(Guid? coach) =>
            MonthNumbersPolicy.Count(facts, lastFrom, thisFrom, today, zone, coach);

        return new CoachMonthReportView(
            today,
            thisFrom,
            lastFrom,
            View(ThisMonth(countsFor)),
            View(LastMonth(countsFor)),
            isOwner ? await ReadCoachRowsAsync(facts, callerId, ThisMonth, LastMonth, cancellationToken) : null,
            MonthNumbersPolicy.Key,
            MonthNumbersPolicy.Version,
            MoneyReceivedPolicy.Key,
            MoneyReceivedPolicy.Version);
    }

    private async Task<IReadOnlyList<HeldSession>> ReadSessionsAsync(
        Guid? coachUserId,
        DateOnly from,
        DateOnly toExclusive,
        CancellationToken cancellationToken)
    {
        var rows = await MonthReads.SessionsHeld(dbContext, coachUserId, from, toExclusive)
            .Select(entry => new { entry.Day, entry.CoachUserId })
            .TagWith(SessionsHeldTag)
            .ToListAsync(cancellationToken);
        // CK_SessionLedgerEntries_Coach: a session held always names who held it.
        return [.. rows.Select(row => new HeldSession(row.Day, row.CoachUserId!.Value))];
    }

    /// <summary>
    /// In one read, each plan booked in the months, and each paid plan touching them or the day either side, whose
    /// neighbours say whether a client started or ended; each with whether money came in on it and the coach history of
    /// its client. Every client counts, a former one included (ADR 0027), and a coach's read is narrowed to clients they
    /// ever coached; the rule decides what is theirs. A cancelled or never-paid plan stays in the read: the rule decides
    /// that too.
    /// </summary>
    private async Task<IReadOnlyList<MonthPlan>> ReadPlansAsync(
        Guid? coachUserId,
        DateOnly from,
        DateOnly toExclusive,
        DateTimeOffset fromUtc,
        DateTimeOffset toUtc,
        TimeZoneInfo zone,
        CancellationToken cancellationToken)
    {
        var rows = await dbContext.ClientEnrollments.AsNoTracking()
            .Where(plan =>
                ((plan.CreatedAtUtc >= fromUtc && plan.CreatedAtUtc < toUtc) ||
                 (plan.ActivatedAtUtc != null && plan.StartDate <= toExclusive && plan.EndDateExclusive >= from)) &&
                (coachUserId == null || dbContext.ClientCoachAssignments.Any(entry =>
                    entry.TenantId == plan.TenantId &&
                    entry.ClientProfileId == plan.ClientProfileId &&
                    entry.CoachUserId == coachUserId)))
            .Select(plan => new
            {
                plan.ClientProfileId,
                plan.CreatedAtUtc,
                plan.SessionCountSnapshot,
                plan.PriceAmount,
                plan.StartDate,
                plan.EndDateExclusive,
                plan.ActivatedAtUtc,
                plan.Status,
                plan.CancelledAtUtc,
                MoneyReceived = dbContext.PaymentRecords.Any(payment =>
                    payment.TenantId == plan.TenantId &&
                    payment.EnrollmentId == plan.Id &&
                    payment.Operation == PaymentOperation.Receipt),
                History = dbContext.ClientCoachAssignments
                    .Where(entry =>
                        entry.TenantId == plan.TenantId &&
                        entry.ClientProfileId == plan.ClientProfileId)
                    .Select(entry => new CoachHistoryEntry(entry.Sequence, entry.CoachUserId, entry.AssignedAtUtc))
                    .ToList(),
            })
            .TagWith(PlansTag)
            .ToListAsync(cancellationToken);
        return [.. rows.Select(row => new MonthPlan(
            row.ClientProfileId,
            row.CreatedAtUtc,
            row.SessionCountSnapshot is not null,
            row.PriceAmount,
            row.StartDate,
            row.EndDateExclusive,
            row.ActivatedAtUtc is not null,
            row.Status == EnrollmentStatus.Cancelled && row.CancelledAtUtc is { } cancelledAtUtc
                ? PaymentDay.Of(cancelledAtUtc, zone)
                : null,
            row.MoneyReceived,
            row.History))];
    }

    /// <summary>
    /// The owner's rows: every active owner and coach, the owner first, then by name, numbers or none, and after them
    /// anyone who left the team with a number in either month, so no receipt, session or client falls out of the rows.
    /// </summary>
    private async Task<IReadOnlyList<CoachMonthRowView>> ReadCoachRowsAsync(
        MonthFacts facts,
        Guid callerId,
        Func<Guid?, MonthNumbers> thisMonth,
        Func<Guid?, MonthNumbers> lastMonth,
        CancellationToken cancellationToken)
    {
        var tenantId = tenantContext.TenantId;
        var staff = await dbContext.TenantMemberships.AsNoTracking()
            .Where(membership =>
                membership.TenantId == tenantId &&
                membership.Status == MembershipStatus.Active &&
                (membership.Role == TenantRole.Owner || membership.Role == TenantRole.Coach))
            .Select(membership => new { membership.UserId, membership.Role })
            .TagWith(StaffTag)
            .ToDictionaryAsync(member => member.UserId, member => member.Role, cancellationToken);

        var people = staff.Keys
            .Union(MonthNumbersPolicy.CoachesIn(facts))
            .Select(userId => (UserId: userId, ThisMonth: thisMonth(userId), LastMonth: lastMonth(userId)))
            .Where(person => staff.ContainsKey(person.UserId) || !(person.ThisMonth.IsEmpty && person.LastMonth.IsEmpty))
            .ToArray();
        var ids = people.Select(person => person.UserId).ToArray();
        var names = await dbContext.Users.AsNoTracking()
            .Where(user => ids.Contains(user.Id))
            .Select(user => new { user.Id, user.DisplayName })
            .TagWith(NamesTag)
            .ToDictionaryAsync(user => user.Id, user => user.DisplayName, cancellationToken);

        return [.. people
            .Select(person => new CoachMonthRowView(
                person.UserId,
                names.GetValueOrDefault(person.UserId) ?? string.Empty,
                person.UserId == callerId,
                !staff.ContainsKey(person.UserId),
                View(person.ThisMonth),
                View(person.LastMonth)))
            .OrderBy(row => row.HasLeftTheTeam ? 2 : staff.GetValueOrDefault(row.CoachUserId) == TenantRole.Owner ? 0 : 1)
            .ThenBy(row => row.Name, StringComparer.CurrentCultureIgnoreCase)
            .ThenBy(row => row.CoachUserId)];
    }

    private static CoachMonthNumbersView View(MonthNumbers numbers) =>
        new(
            [.. numbers.MoneyReceived.Select(total => new CoachMoneyReceivedView(total.CurrencyCode, total.Amount, total.PaymentCount))],
            numbers.SessionsHeld,
            numbers.PlansSold,
            numbers.PacksSold,
            numbers.ClientsStarted,
            numbers.ClientsEnded);
}
