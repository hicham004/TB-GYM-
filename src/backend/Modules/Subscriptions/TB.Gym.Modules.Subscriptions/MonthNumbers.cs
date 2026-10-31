namespace TB.Gym.Modules.Subscriptions;

/// <summary>
/// Month numbers v1 (SUB-018, critique B10d): what the This month page counts in one workspace calendar month, beside
/// money received v1 (SUB-016) and the sessions held (SES-008). Plans and packs sold count on the day they were booked,
/// at a price, unless cancelled with no money received. Clients started and ended count a stint: days in a row on
/// plans that opened, paid in full or free, a pack included, from its first day to its last or the day it was
/// cancelled, which is not covered. Nothing else covers days (SUB-008), and a gap, however short, ends one stint and
/// starts another. Each counts for the coach the client had that day (ADR 0026), read as money received reads it; a
/// session counts for whoever recorded it (SES-003). Past months move with what is recorded late, as money and
/// sessions do: the day decides, not the day it was typed.
/// </summary>
public static class MonthNumbersPolicy
{
    public const string Key = "MonthNumbers";
    public const int Version = 1;

    /// <summary>
    /// The numbers of <c>[from, toExclusive)</c>: the whole workspace's (<paramref name="coachUserId"/> null), or only
    /// what counts for that coach. Every number is in the workspace's calendar, and <paramref name="today"/> keeps what
    /// has not happened yet out of them: a stint starting later this month, or a plan still running.
    /// </summary>
    public static MonthNumbers Count(
        MonthFacts facts,
        DateOnly from,
        DateOnly toExclusive,
        DateOnly today,
        TimeZoneInfo workspaceZone,
        Guid? coachUserId)
    {
        bool InMonth(DateOnly day) => day >= from && day < toExclusive;
        bool CountsFor(Guid? coach) => coachUserId is null || coach == coachUserId;

        var sold = facts.Plans
            .Where(plan => IsSold(plan) &&
                           InMonth(PaymentDay.Of(plan.BookedAtUtc, workspaceZone)) &&
                           CountsFor(MoneyReceivedPolicy.CoachAt(plan.BookedAtUtc, plan.CoachHistory)))
            .ToArray();
        var stints = facts.Plans
            .GroupBy(plan => plan.ClientProfileId)
            .SelectMany(client => Stints(client, today).Select(stint => (Stint: stint, client.First().CoachHistory)))
            .ToArray();

        return new MonthNumbers(
            MoneyReceivedPolicy.Totals(facts.Payments, from, toExclusive, workspaceZone, coachUserId),
            facts.Sessions.Count(session => InMonth(session.Day) && CountsFor(session.CoachUserId)),
            sold.Count(plan => !plan.IsSessionPack),
            sold.Count(plan => plan.IsSessionPack),
            stints.Count(item => item.Stint.Start <= today &&
                                 InMonth(item.Stint.Start) &&
                                 CountsFor(CoachOn(item.Stint.Start, item.CoachHistory, workspaceZone))),
            stints.Count(item => item.Stint.EndedOn is { } endedOn &&
                                 InMonth(endedOn) &&
                                 CountsFor(CoachOn(endedOn, item.CoachHistory, workspaceZone))));
    }

    /// <summary>
    /// Whether a booked plan was sold: it has a price, so a free one, a goodwill pack among them (ADR 0038), is not, and
    /// it was not cancelled before any money arrived. A renewal is a sale; a plan still waiting for payment is one too,
    /// which is what selling is (SES-002). Money kept on a cancelled plan keeps its sale (SUB-008, ADR 0027).
    /// </summary>
    public static bool IsSold(MonthPlan plan) =>
        plan.Price > 0m && (plan.CancelledOn is null || plan.MoneyReceived);

    /// <summary>
    /// A client's stints, in order. A plan paid late still covers from its first day, so a renewal paid three days after
    /// it began is no gap; one never paid covers nothing, a free one covers as a paid one does, and one cancelled covers
    /// up to that day. A plan running today leaves its stint open (<see cref="PlanStint.EndedOn"/> null), whatever comes
    /// after it.
    /// </summary>
    public static IReadOnlyList<PlanStint> Stints(IEnumerable<MonthPlan> plans, DateOnly today)
    {
        var stints = new List<PlanStint>();
        PlanStint? open = null;
        var coveredUntil = default(DateOnly);

        foreach (var plan in plans
                     .Where(plan => plan.Paid && plan.CoveredUntil > plan.StartDate)
                     .OrderBy(plan => plan.StartDate))
        {
            if (open is not null && plan.StartDate > coveredUntil)
            {
                stints.Add(Closed(open, coveredUntil, today));
                open = null;
            }

            if (open is null)
            {
                open = new PlanStint(plan.StartDate, plan.LastDay);
                coveredUntil = plan.CoveredUntil;
            }
            else if (plan.CoveredUntil > coveredUntil ||
                     (plan.CoveredUntil == coveredUntil && plan.LastDay > open.EndedOn))
            {
                open = open with { EndedOn = plan.LastDay };
                coveredUntil = plan.CoveredUntil;
            }
        }

        if (open is not null)
        {
            stints.Add(Closed(open, coveredUntil, today));
        }

        return stints;
    }

    /// <summary>Everyone the facts could count for, so nobody who has left the team falls out of the owner's rows.</summary>
    public static IReadOnlySet<Guid> CoachesIn(MonthFacts facts) =>
        facts.Sessions.Select(session => session.CoachUserId)
            .Concat(facts.Plans.SelectMany(plan => plan.CoachHistory).Select(entry => entry.CoachUserId))
            .Concat(facts.Payments.SelectMany(payment => payment.CoachHistory).Select(entry => entry.CoachUserId))
            .ToHashSet();

    /// <summary>
    /// The coach the client had as <paramref name="day"/> began. Ending a client's coaching moves them to the owner first
    /// (ADR 0027), so read any later that day it would take the ended client off the coach who had them.
    /// </summary>
    private static Guid? CoachOn(DateOnly day, IEnumerable<CoachHistoryEntry> history, TimeZoneInfo workspaceZone) =>
        MoneyReceivedPolicy.CoachAt(MoneyReceivedPolicy.StartOfDayUtc(day, workspaceZone), history);

    private static PlanStint Closed(PlanStint stint, DateOnly coveredUntil, DateOnly today) =>
        coveredUntil <= today ? stint : stint with { EndedOn = null };
}

/// <summary>What one month's numbers are counted from, read once for this month and the last.</summary>
public sealed record MonthFacts(
    IReadOnlyList<ReceivedPayment> Payments,
    IReadOnlyList<HeldSession> Sessions,
    IReadOnlyList<MonthPlan> Plans);

/// <summary>A session held that still stands (SES-008): its own workspace day, and who recorded it (SES-003).</summary>
public sealed record HeldSession(DateOnly Day, Guid CoachUserId);

/// <summary>
/// One plan as the month's numbers read it, with the coach history of its client.
/// </summary>
/// <param name="BookedAtUtc">When it was booked, which is when it was sold (SES-002).</param>
/// <param name="Paid">Paid in full or free, so it opened (SUB-008); nothing covers days until it is.</param>
/// <param name="CancelledOn">The workspace day it was cancelled (SUB-006), null unless it was.</param>
/// <param name="MoneyReceived">Any receipt was recorded on it, a part payment included.</param>
public sealed record MonthPlan(
    Guid ClientProfileId,
    DateTimeOffset BookedAtUtc,
    bool IsSessionPack,
    decimal Price,
    DateOnly StartDate,
    DateOnly EndDateExclusive,
    bool Paid,
    DateOnly? CancelledOn,
    bool MoneyReceived,
    IReadOnlyList<CoachHistoryEntry> CoachHistory)
{
    /// <summary>The day after its cover: its end, or the day it was cancelled if that came first.</summary>
    public DateOnly CoveredUntil => CancelledOn is { } cancelledOn && cancelledOn < EndDateExclusive
        ? cancelledOn
        : EndDateExclusive;

    /// <summary>The day it ended: the day it was cancelled, else its last covered day.</summary>
    public DateOnly LastDay => CancelledOn is { } cancelledOn && cancelledOn < EndDateExclusive
        ? cancelledOn
        : EndDateExclusive.AddDays(-1);
}

/// <summary>Days in a row on paid plans: the first, and the day the last of them ended, null while one runs.</summary>
public sealed record PlanStint(DateOnly Start, DateOnly? EndedOn);

/// <summary>One month's numbers. Money stays per currency (SUB-016); every other number is a count.</summary>
public sealed record MonthNumbers(
    IReadOnlyList<MoneyReceivedTotal> MoneyReceived,
    int SessionsHeld,
    int PlansSold,
    int PacksSold,
    int ClientsStarted,
    int ClientsEnded)
{
    public bool IsEmpty =>
        MoneyReceived.Count == 0 && SessionsHeld == 0 && PlansSold == 0 && PacksSold == 0 &&
        ClientsStarted == 0 && ClientsEnded == 0;
}
