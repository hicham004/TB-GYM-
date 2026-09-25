using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace TB.Gym.Modules.PlatformBilling;

/// <summary>
/// One billing month: a UTC calendar month, half-open, <c>[first day 00:00Z, first day of next month)</c>.
/// </summary>
public readonly record struct BillingMonth
{
    public BillingMonth(int year, int month)
    {
        if (year is < 2000 or > 9998 || month is < 1 or > 12)
        {
            throw new ArgumentOutOfRangeException(nameof(month), "A billing month needs a year and a month.");
        }

        Start = new DateOnly(year, month, 1);
    }

    public DateOnly Start { get; }

    public DateOnly EndExclusive => Start.AddMonths(1);

    public DateTimeOffset StartUtc => new(Start.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);

    public DateTimeOffset EndUtc => new(EndExclusive.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);

    public static BillingMonth Containing(DateTimeOffset instant)
    {
        var utc = instant.UtcDateTime;
        return new BillingMonth(utc.Year, utc.Month);
    }

    public static BillingMonth StartingOn(DateOnly start) =>
        start.Day == 1
            ? new BillingMonth(start.Year, start.Month)
            : throw new ArgumentException("A billing month starts on the first day of a month.", nameof(start));

    public BillingMonth Previous()
    {
        var previous = Start.AddMonths(-1);
        return new BillingMonth(previous.Year, previous.Month);
    }

    public override string ToString() => Start.ToString("yyyy-MM", System.Globalization.CultureInfo.InvariantCulture);
}

/// <summary>An interval of instants, half-open: <c>[Start, End)</c>.</summary>
public readonly record struct UsageWindow(DateTimeOffset Start, DateTimeOffset End)
{
    public bool IsEmpty => End <= Start;

    public bool Overlaps(DateTimeOffset start, DateTimeOffset end) => start < End && Start < end;
}

/// <summary>
/// The free trial: it runs from workspace creation for the trial length of the plan that was current
/// then, so publishing a shorter trial never takes days from a workspace already in one.
/// </summary>
public static class TrialPolicy
{
    public static DateTimeOffset EndsAt(DateTimeOffset workspaceCreatedAtUtc, int trialDays) =>
        workspaceCreatedAtUtc.AddDays(trialDays);

    /// <summary>
    /// The plan whose trial a workspace received: the latest published at or before its creation, or
    /// the first plan for a workspace older than billing itself.
    /// </summary>
    public static PlatformPricePlan PlanAt(IReadOnlyCollection<PlatformPricePlan> plans, DateTimeOffset workspaceCreatedAtUtc)
    {
        if (plans.Count == 0)
        {
            throw new InvalidOperationException("No price plan has been published.");
        }

        return plans
                   .Where(plan => plan.PublishedAtUtc <= workspaceCreatedAtUtc)
                   .MaxBy(plan => plan.VersionNumber)
               ?? plans.MinBy(plan => plan.VersionNumber)!;
    }

    /// <summary>
    /// The billable part of a month: from the later of the month's start and the trial's end, to the
    /// month's end or <paramref name="until"/>, whichever is earlier. Empty while in trial.
    /// </summary>
    public static UsageWindow BillableWindow(BillingMonth month, DateTimeOffset trialEndsAtUtc, DateTimeOffset? until = null)
    {
        var start = trialEndsAtUtc > month.StartUtc ? trialEndsAtUtc : month.StartUtc;
        var end = until is { } cutoff && cutoff < month.EndUtc ? cutoff : month.EndUtc;
        return new UsageWindow(start, end);
    }
}

/// <summary>One recorded status of an owner's or coach's membership, from the membership history.</summary>
public sealed record StaffStatusChange(Guid MembershipId, Guid UserId, bool IsActive, DateTimeOffset ChangedAtUtc);

/// <summary>
/// Seats: the owner plus every coach whose membership was active at any moment of the window, each
/// person counted once however often they left and came back.
/// </summary>
public static class SeatCounter
{
    public static int Count(IEnumerable<StaffStatusChange> changes, UsageWindow window)
    {
        if (window.IsEmpty)
        {
            return 0;
        }

        var people = new HashSet<Guid>();
        foreach (var membership in changes.GroupBy(change => change.MembershipId))
        {
            var ordered = membership.OrderBy(change => change.ChangedAtUtc).ToArray();
            for (var index = 0; index < ordered.Length; index++)
            {
                if (!ordered[index].IsActive)
                {
                    continue;
                }

                var from = ordered[index].ChangedAtUtc;
                var to = index + 1 < ordered.Length ? ordered[index + 1].ChangedAtUtc : DateTimeOffset.MaxValue;
                if (from < to && window.Overlaps(from, to))
                {
                    people.Add(ordered[index].UserId);
                    break;
                }
            }
        }

        return people.Count;
    }
}

/// <summary>
/// One enrollment's coverage as billing sees it. <see cref="ClientKey"/> identifies the person, so a
/// client who left and came back with a new profile counts once.
/// </summary>
public sealed record CoverageSpan(
    Guid ClientKey,
    DateOnly StartDate,
    DateOnly EndDateExclusive,
    DateTimeOffset? ActivatedAtUtc,
    DateTimeOffset? CancelledAtUtc,
    IReadOnlyList<PausePeriod>? Pauses = null);

/// <summary>One recorded status of a client's plan, from the enrollment history.</summary>
public sealed record EnrollmentStatusStep(Guid EnrollmentId, bool IsPaused, DateTimeOffset ChangedAtUtc);

/// <summary>A stretch of time a plan was paused, half-open: <c>[From, To)</c>.</summary>
public readonly record struct PausePeriod(DateTimeOffset From, DateTimeOffset To)
{
    /// <summary>
    /// The pauses of each enrollment: each runs from entering Paused to the next recorded status, or on
    /// if none has followed yet.
    /// </summary>
    public static IReadOnlyDictionary<Guid, IReadOnlyList<PausePeriod>> FromHistory(IEnumerable<EnrollmentStatusStep> steps) =>
        steps.GroupBy(step => step.EnrollmentId)
            .ToDictionary(
                enrollment => enrollment.Key,
                enrollment =>
                {
                    var ordered = enrollment.OrderBy(step => step.ChangedAtUtc).ToArray();
                    return (IReadOnlyList<PausePeriod>)ordered
                        .Select((step, index) => (step, index))
                        .Where(item => item.step.IsPaused)
                        .Select(item => new PausePeriod(
                            item.step.ChangedAtUtc,
                            item.index + 1 < ordered.Length ? ordered[item.index + 1].ChangedAtUtc : DateTimeOffset.MaxValue))
                        .ToArray();
                });
}

/// <summary>
/// Billable clients: people who had access to any coaching feature at any moment of the window.
/// </summary>
/// <remarks>
/// Coverage starts at the later of the plan's first day (workspace midnight) and its activation — full
/// payment, or creation for a zero-price plan — and ends at the earlier of its end date and its
/// cancellation. A pending, never-paid plan covers nothing. A paused plan gives no access, so its
/// paused time does not count: a client paused for the whole window is not billable, one paused for
/// part of it is (ADR 0028, decided 2026-09-25).
/// </remarks>
public static class BillableClientCounter
{
    public static int Count(IEnumerable<CoverageSpan> spans, UsageWindow window, TimeZoneInfo timeZone) =>
        spans.Where(span => HadCoverage(span, window, timeZone))
            .Select(span => span.ClientKey)
            .Distinct()
            .Count();

    public static bool HadCoverage(CoverageSpan span, UsageWindow window, TimeZoneInfo timeZone)
    {
        if (window.IsEmpty || span.ActivatedAtUtc is not { } activated)
        {
            return false;
        }

        var dayStart = WorkspaceMidnightUtc(span.StartDate, timeZone);
        var start = activated > dayStart ? activated : dayStart;
        var end = WorkspaceMidnightUtc(span.EndDateExclusive, timeZone);
        if (span.CancelledAtUtc is { } cancelled && cancelled < end)
        {
            end = cancelled;
        }

        if (window.Start > start)
        {
            start = window.Start;
        }

        if (window.End < end)
        {
            end = window.End;
        }

        // Access is the covered part of the window minus the pauses: any instant left over counts.
        foreach (var pause in (span.Pauses ?? []).OrderBy(pause => pause.From))
        {
            if (start >= end || pause.From > start)
            {
                break;
            }

            if (pause.To > start)
            {
                start = pause.To;
            }
        }

        return start < end;
    }

    /// <summary>
    /// The instant a workspace calendar day starts. Where a daylight-saving change skips midnight, as it
    /// does in Beirut, the day starts at its first instant that exists.
    /// </summary>
    public static DateTimeOffset WorkspaceMidnightUtc(DateOnly date, TimeZoneInfo timeZone)
    {
        var local = date.ToDateTime(TimeOnly.MinValue, DateTimeKind.Unspecified);
        while (timeZone.IsInvalidTime(local))
        {
            local = local.AddMinutes(15);
        }

        return new DateTimeOffset(local, timeZone.GetUtcOffset(local)).ToUniversalTime();
    }
}

/// <summary>What was counted for one invoice or estimate.</summary>
public sealed record InvoiceQuantities(int Seats, int BillableClients);

/// <summary>Every line of an invoice, as the calculation produced it.</summary>
public sealed record InvoiceAmounts(
    int Seats,
    int BillableClients,
    int IncludedClients,
    int ExtraClients,
    decimal SeatAmount,
    decimal ExtraClientAmount,
    decimal GymFeeAmount,
    decimal Subtotal,
    decimal DiscountPercent,
    decimal DiscountAmount,
    decimal Total);

/// <summary>
/// The named, versioned invoice calculation. A new rule is a new name; an issued invoice records the
/// name it was calculated with.
/// </summary>
/// <remarks>
/// <c>platform-invoice-v1</c>: included clients are pooled across seats; extra clients never go below
/// zero; the gym fee applies from the plan's minimum seat count; the discount is a percentage of the
/// subtotal rounded half away from zero to the cent, and the total is the subtotal minus it.
/// </remarks>
public static class PlatformInvoiceCalculation
{
    public const string Name = "platform-invoice-v1";

    public static InvoiceAmounts Calculate(PricePlanTerms terms, InvoiceQuantities quantities, decimal discountPercent)
    {
        ArgumentNullException.ThrowIfNull(terms);
        ArgumentNullException.ThrowIfNull(quantities);
        if (quantities.Seats < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(quantities), "A workspace always has at least the owner's seat.");
        }

        if (quantities.BillableClients < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(quantities), "Billable clients cannot be negative.");
        }

        WorkspaceDiscount.ValidatePercent(discountPercent);

        var included = checked(quantities.Seats * terms.IncludedClientsPerSeat);
        var extra = Math.Max(0, quantities.BillableClients - included);
        var seatAmount = quantities.Seats * terms.SeatPrice;
        var extraAmount = extra * terms.ExtraClientPrice;
        var gymFee = quantities.Seats >= terms.GymFeeMinimumSeats ? terms.GymFee : 0m;
        var subtotal = seatAmount + extraAmount + gymFee;
        var discount = decimal.Round(subtotal * discountPercent / 100m, 2, MidpointRounding.AwayFromZero);
        return new InvoiceAmounts(
            quantities.Seats,
            quantities.BillableClients,
            included,
            extra,
            seatAmount,
            extraAmount,
            gymFee,
            subtotal,
            discountPercent,
            discount,
            subtotal - discount);
    }
}

/// <summary>When an invoice falls due and when leaving it unpaid makes the workspace read-only.</summary>
public static class PaymentSchedule
{
    public static DateOnly DueOn(DateTimeOffset issuedAtUtc, int paymentTermDays) =>
        DateOnly.FromDateTime(issuedAtUtc.UtcDateTime).AddDays(paymentTermDays);

    /// <summary>The grace days after the due date, and never earlier than the day after it.</summary>
    public static DateOnly ReadOnlyFrom(DateOnly dueOn, int graceDays) => dueOn.AddDays(Math.Max(1, graceDays));

    public static DateOnly Today(DateTimeOffset now) => DateOnly.FromDateTime(now.UtcDateTime);
}

public enum PlatformInvoiceStatus
{
    Open = 1,
    Overdue = 2,
    Paid = 3,
    Void = 4,
    NothingToPay = 5,
}

public enum WorkspaceBillingStatus
{
    Trial = 1,
    Active = 2,
    Overdue = 3,
    ReadOnly = 4,
}

/// <summary>An invoice's state on a given UTC day, derived from immutable facts rather than stored.</summary>
public static class PlatformInvoiceStatusPolicy
{
    public static PlatformInvoiceStatus Evaluate(decimal total, DateOnly dueOn, bool isVoid, bool isPaid, DateOnly today)
    {
        if (isVoid)
        {
            return PlatformInvoiceStatus.Void;
        }

        if (isPaid)
        {
            return PlatformInvoiceStatus.Paid;
        }

        if (total == 0m)
        {
            return PlatformInvoiceStatus.NothingToPay;
        }

        return today > dueOn ? PlatformInvoiceStatus.Overdue : PlatformInvoiceStatus.Open;
    }

    public static bool LocksWorkspace(decimal total, DateOnly readOnlyFrom, bool isVoid, bool isPaid, DateOnly today) =>
        !isVoid && !isPaid && total > 0m && today >= readOnlyFrom;

    public static WorkspaceBillingStatus Workspace(bool anyLocking, bool anyOverdue, bool inTrial) =>
        anyLocking ? WorkspaceBillingStatus.ReadOnly
        : anyOverdue ? WorkspaceBillingStatus.Overdue
        : inTrial ? WorkspaceBillingStatus.Trial
        : WorkspaceBillingStatus.Active;
}

/// <summary>
/// The code an owner puts on their Whish transfer so the admin can match it: a configurable prefix,
/// the month, and six unambiguous random characters.
/// </summary>
public static partial class InvoiceReference
{
    private const string Alphabet = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

    public static string Create(string prefix, BillingMonth month)
    {
        if (!IsValidPrefix(prefix))
        {
            throw new ArgumentException("The reference prefix must be 2-8 capital letters or digits.", nameof(prefix));
        }

        return $"{prefix}-{month.Start:yyyyMM}-{RandomNumberGenerator.GetString(Alphabet, 6)}";
    }

    public static bool IsValidPrefix(string? prefix) => prefix is not null && PrefixPattern().IsMatch(prefix);

    [GeneratedRegex("^[A-Z][A-Z0-9]{1,7}$", RegexOptions.CultureInvariant)]
    private static partial Regex PrefixPattern();
}
