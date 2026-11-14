namespace TB.Gym.Modules.Subscriptions;

/// <summary>
/// Money received v1 (SUB-016, critique B4b): what Coach Today's This month counts. Only receipts count, part
/// payments included, each on the workspace day it was received (SUB-007), inside the workspace's calendar month.
/// A receipt counts for the coach the client had when it was received, read from the client's append-only coach
/// history (ADR 0026). Totals are exact and per currency: never added, netted or converted across currencies.
/// </summary>
public static class MoneyReceivedPolicy
{
    public const string Key = "MoneyReceived";
    public const int Version = 1;

    /// <summary>The workspace calendar month holding <paramref name="today"/>: [its first day, the next month's first day).</summary>
    public static (DateOnly From, DateOnly ToExclusive) MonthOf(DateOnly today)
    {
        var from = new DateOnly(today.Year, today.Month, 1);
        return (from, from.AddMonths(1));
    }

    /// <summary>
    /// The first instant of <paramref name="day"/> in the workspace's zone, for the edges of <see cref="ReadWindowUtc"/>.
    /// A midnight the clocks skip (moved forward at 00:00) starts the day when they land; a midnight they pass twice
    /// (moved back across it) starts the day at its first pass. So no zone's calendar makes this throw.
    /// </summary>
    public static DateTimeOffset StartOfDayUtc(DateOnly day, TimeZoneInfo workspaceZone)
    {
        var midnight = day.ToDateTime(TimeOnly.MinValue, DateTimeKind.Unspecified);
        var local = midnight;
        while (workspaceZone.IsInvalidTime(local) && local < midnight.AddDays(1))
        {
            local = local.AddMinutes(1);
        }

        var offset = workspaceZone.IsAmbiguousTime(local)
            ? workspaceZone.GetAmbiguousTimeOffsets(local).Max()
            : workspaceZone.GetUtcOffset(local);
        return new DateTimeOffset(local, offset).ToUniversalTime();
    }

    /// <summary>
    /// The instants the database reads <c>[from, toExclusive)</c>'s receipts between, <c>[FromUtc, ToUtc)</c>: a day
    /// wider on each side, from the start of the day before <paramref name="from"/> to the start of the day after
    /// <paramref name="toExclusive"/>. It only narrows the read; <see cref="IsReceivedIn"/>, by each receipt's workspace
    /// day, alone decides the month. Where the clocks go back across midnight, the month's last day goes on after the
    /// next month's first midnight, and a window ending there would drop those receipts.
    /// </summary>
    public static (DateTimeOffset FromUtc, DateTimeOffset ToUtc) ReadWindowUtc(
        DateOnly from,
        DateOnly toExclusive,
        TimeZoneInfo workspaceZone) =>
        (StartOfDayUtc(from.AddDays(-1), workspaceZone), StartOfDayUtc(toExclusive.AddDays(1), workspaceZone));

    /// <summary>Whether a receipt's workspace day (<see cref="PaymentDay.Of"/>) falls in <c>[from, toExclusive)</c>.</summary>
    public static bool IsReceivedIn(
        DateTimeOffset receivedAtUtc,
        DateOnly from,
        DateOnly toExclusive,
        TimeZoneInfo workspaceZone)
    {
        var day = PaymentDay.Of(receivedAtUtc, workspaceZone);
        return day >= from && day < toExclusive;
    }

    /// <summary>
    /// The coach a receipt counts for: the client's coach when it was received, by the newest history entry assigned
    /// at or before its instant (SUB-007 stamps the moment it was recorded for today, the workspace's midday for an
    /// earlier day). A receipt dated before the client's first entry counts for that entry's coach: whoever invited
    /// them, or the owner who had every client before assignment shipped. Null with no history at all, which the
    /// database does not allow, and when the entry in force names nobody: the client was waiting for a coach
    /// (CLI-012, notes plan N9d1b), so the receipt counts in the workspace's total and for nobody, never for the
    /// coach who left before the wait.
    /// </summary>
    public static Guid? CoachAt(DateTimeOffset receivedAtUtc, IEnumerable<CoachHistoryEntry> history)
    {
        var entries = history.OrderBy(entry => entry.Sequence).ToArray();
        if (entries.Length == 0)
        {
            return null;
        }

        return (entries.LastOrDefault(entry => entry.AssignedAtUtc <= receivedAtUtc) ?? entries[0]).CoachUserId;
    }

    /// <summary>
    /// Money received in <c>[from, toExclusive)</c>, one total per currency in currency order: every receipt for the
    /// owner (<paramref name="coachUserId"/> null), or only those that count for that coach (<see cref="CoachAt"/>).
    /// Refunds and reversals are not money received; none is recorded yet (SUB-007).
    /// </summary>
    public static IReadOnlyList<MoneyReceivedTotal> Totals(
        IEnumerable<ReceivedPayment> payments,
        DateOnly from,
        DateOnly toExclusive,
        TimeZoneInfo workspaceZone,
        Guid? coachUserId) =>
        Totals(payments, from, toExclusive, workspaceZone, coach => coachUserId is null || coach == coachUserId);

    /// <summary>
    /// Money received in <c>[from, toExclusive)</c> that counts for whoever <paramref name="countsFor"/> accepts, the
    /// coach of <see cref="CoachAt"/> being null for a receipt that counted for nobody.
    /// </summary>
    public static IReadOnlyList<MoneyReceivedTotal> Totals(
        IEnumerable<ReceivedPayment> payments,
        DateOnly from,
        DateOnly toExclusive,
        TimeZoneInfo workspaceZone,
        Func<Guid?, bool> countsFor) =>
        [.. payments
            .Where(payment =>
                payment.Operation == PaymentOperation.Receipt &&
                IsReceivedIn(payment.ReceivedAtUtc, from, toExclusive, workspaceZone) &&
                countsFor(CoachAt(payment.ReceivedAtUtc, payment.CoachHistory)))
            .GroupBy(payment => payment.CurrencyCode, StringComparer.Ordinal)
            .OrderBy(group => group.Key, StringComparer.Ordinal)
            .Select(group => new MoneyReceivedTotal(group.Key, group.Sum(payment => payment.Amount), group.Count()))];
}

/// <summary>
/// One entry of a client's coach history (ADR 0026): who coaches them from that instant, or nobody while they wait for
/// a coach (CLI-012).
/// </summary>
public sealed record CoachHistoryEntry(int Sequence, Guid? CoachUserId, DateTimeOffset AssignedAtUtc);

/// <summary>A payment as money received reads it, with the coach history of the client it was for.</summary>
public sealed record ReceivedPayment(
    decimal Amount,
    string CurrencyCode,
    DateTimeOffset ReceivedAtUtc,
    PaymentOperation Operation,
    IReadOnlyList<CoachHistoryEntry> CoachHistory);

/// <summary>Money received in one currency, exact, with how many payments made it up.</summary>
public sealed record MoneyReceivedTotal(string CurrencyCode, decimal Amount, int PaymentCount);
