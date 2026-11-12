namespace TB.Gym.Modules.PlatformBilling;

/// <summary>
/// The price a founding space is held at (notes plan N8): the founding status that holds it, the price plan
/// version in force on its founding day (<see cref="FoundingPricePolicy.PlanOn"/>), the founding terms version
/// whose months counted, those months, and the guarantee's last day, a UTC day.
/// </summary>
public sealed record FoundingPriceHold(
    Guid FoundingStatusId,
    PlatformPricePlan Plan,
    int TermsVersion,
    int Months,
    DateOnly LastDay);

/// <summary>A billed stretch priced: the plan version it is billed at and the amounts under it.</summary>
public sealed record PricedUsage(PlatformPricePlan Plan, InvoiceAmounts Amounts);

/// <summary>
/// The named, versioned rule for the founding price guarantee (notes plan N8, decision 16, PBL-012): a
/// founding space keeps the price plan version in force on its founding day, so a later version never raises
/// its bill while the guarantee runs. The months are no constant in code: they come only from the founding
/// terms in force (<see cref="FoundingTerms.PriceGuaranteeMonths"/>).
/// </summary>
/// <remarks>
/// <c>founding-price-v1</c>: a founding status holds prices from UTC midnight of its founding day to the end
/// of the guarantee's last day, or to its own end if that comes first. The last day is the later of the
/// founding day and the last day of the space's last unrevoked discount, plus the months of the terms in
/// force, in calendar months (31 January plus one month is the last day of February): a space with no
/// discount, or one whose discounts ended before its founding day, is held those months from its founding
/// day, and a revoked discount is out of the count. A billed window is held when a hold touches it, as a
/// discount covers every month it touches: the month the last day falls inside is held whole, the month a
/// status ended in is still held, and from the month after the latest version applies, as for every other
/// space; of two statuses touching one window (a space ended and marked again) the one marked last holds.
/// The held version is the last one published by the end of the founding day, or by the moment the status
/// was marked when that comes first (the first version for a founding day older than billing itself): it
/// is fixed by facts that never change, so no version published after the mark, not even later that day,
/// moves a space that was told its prices are held. While held, the window is worked out at the held
/// version and at the latest and the lower total is billed, equal totals keeping the held one; the invoice
/// records the version billed. Terms in force that name no months hold nothing.
/// </remarks>
public static class FoundingPricePolicy
{
    public const string Name = "founding-price-v1";

    public const int MinimumMonths = 0;

    /// <summary>Ten years: far past any guarantee, and a guard against a slip of the hand.</summary>
    public const int MaximumMonths = 120;

    public static bool IsValidMonths(int? months) => months is null or (>= MinimumMonths and <= MaximumMonths);

    /// <summary>
    /// The guarantee's last day: <paramref name="months"/> calendar months after the later of the founding
    /// day and the last day of the last unrevoked discount.
    /// </summary>
    public static DateOnly LastDay(DateOnly foundingSince, IEnumerable<WorkspaceDiscount> discounts, int months)
    {
        ArgumentNullException.ThrowIfNull(discounts);
        if (!IsValidMonths(months))
        {
            throw new ArgumentOutOfRangeException(nameof(months), FoundingText.TermsPriceGuaranteeMonthsInvalid);
        }

        var from = foundingSince;
        foreach (var discount in discounts)
        {
            if (discount.IsRevoked)
            {
                continue;
            }

            var lastDiscountDay = discount.EndsOnExclusive.AddDays(-1);
            if (lastDiscountDay > from)
            {
                from = lastDiscountDay;
            }
        }

        // A discount may run to the calendar's end; the guarantee then does too.
        var monthsLeft = ((DateOnly.MaxValue.Year - from.Year) * 12) + DateOnly.MaxValue.Month - from.Month;
        return months > monthsLeft ? DateOnly.MaxValue : from.AddMonths(months);
    }

    /// <summary>
    /// The plan version a founding status holds: the one in force on its founding day, read at the end of that
    /// UTC day, or at the moment it was marked when that comes first. A version published on the founding day
    /// before the mark is the day's; one published after the mark never is, as a plan published after a
    /// space's creation never changes its trial.
    /// </summary>
    public static PlatformPricePlan PlanOn(IReadOnlyCollection<PlatformPricePlan> plans, FoundingStatus status)
    {
        ArgumentNullException.ThrowIfNull(plans);
        ArgumentNullException.ThrowIfNull(status);
        var dayEnds = EndUtc(status.FoundingSince).AddTicks(-1);
        return TrialPolicy.PlanAt(plans, status.MarkedAtUtc < dayEnds ? status.MarkedAtUtc : dayEnds);
    }

    /// <summary>
    /// The hold on a billed window, or none: the window is held when a founding status's hold touches it.
    /// With two such statuses (one ended and the space marked again in the window) the one marked last holds.
    /// </summary>
    public static FoundingPriceHold? For(
        IEnumerable<FoundingStatus> statuses,
        IReadOnlyCollection<FoundingTerms> termsVersions,
        IReadOnlyCollection<WorkspaceDiscount> discounts,
        IReadOnlyCollection<PlatformPricePlan> plans,
        UsageWindow window)
    {
        ArgumentNullException.ThrowIfNull(statuses);
        ArgumentNullException.ThrowIfNull(discounts);
        if (window.IsEmpty || InForce(termsVersions) is not { PriceGuaranteeMonths: { } months } terms)
        {
            return null;
        }

        FoundingStatus? holder = null;
        var holderLastDay = DateOnly.MinValue;
        foreach (var status in statuses)
        {
            var lastDay = LastDay(status.FoundingSince, discounts, months);
            var heldFrom = FoundingSeatPolicy.RunsFromUtc(status);
            var heldTo = EndUtc(lastDay);
            if (status.EndedAtUtc is { } ended && ended < heldTo)
            {
                heldTo = ended;
            }

            if (heldFrom >= heldTo || !window.Overlaps(heldFrom, heldTo))
            {
                continue;
            }

            if (holder is null ||
                status.MarkedAtUtc > holder.MarkedAtUtc ||
                (status.MarkedAtUtc == holder.MarkedAtUtc && status.Id.CompareTo(holder.Id) > 0))
            {
                holder = status;
                holderLastDay = lastDay;
            }
        }

        return holder is null
            ? null
            : new FoundingPriceHold(holder.Id, PlanOn(plans, holder), terms.VersionNumber, months, holderLastDay);
    }

    /// <summary>
    /// The open status's hold on <paramref name="today"/>, a UTC day, for the pages that say until when: none
    /// once the last day has passed, though the rest of that month is still billed at the held version.
    /// </summary>
    public static FoundingPriceHold? On(
        IEnumerable<FoundingStatus> statuses,
        IReadOnlyCollection<FoundingTerms> termsVersions,
        IReadOnlyCollection<WorkspaceDiscount> discounts,
        IReadOnlyCollection<PlatformPricePlan> plans,
        DateOnly today)
    {
        ArgumentNullException.ThrowIfNull(statuses);
        ArgumentNullException.ThrowIfNull(discounts);
        if (InForce(termsVersions) is not { PriceGuaranteeMonths: { } months } terms ||
            statuses.Where(status => !status.IsEnded && status.FoundingSince <= today).MaxBy(status => status.MarkedAtUtc) is not { } open)
        {
            return null;
        }

        var lastDay = LastDay(open.FoundingSince, discounts, months);
        return lastDay < today
            ? null
            : new FoundingPriceHold(open.Id, PlanOn(plans, open), terms.VersionNumber, months, lastDay);
    }

    /// <summary>
    /// Prices a billed stretch: at the latest version, or for a held stretch at the held version unless the
    /// latest totals less. Equal totals keep the held version.
    /// </summary>
    public static PricedUsage Price(
        IReadOnlyCollection<PlatformPricePlan> plans,
        FoundingPriceHold? hold,
        InvoiceQuantities quantities,
        IncludedClientSources includedClients,
        decimal discountPercent)
    {
        ArgumentNullException.ThrowIfNull(plans);
        var latest = plans.MaxBy(plan => plan.VersionNumber)
                     ?? throw new InvalidOperationException("No price plan has been published.");
        var atLatest = At(latest, quantities, includedClients, discountPercent);
        if (hold is null || hold.Plan.VersionNumber == latest.VersionNumber)
        {
            return atLatest;
        }

        var atHeld = At(hold.Plan, quantities, includedClients, discountPercent);

        // No exchange rate exists (ADR 0028): totals in two currencies are never compared, and the held one stays.
        var latestBillsLess =
            string.Equals(latest.CurrencyCode, hold.Plan.CurrencyCode, StringComparison.Ordinal) &&
            atLatest.Amounts.Total < atHeld.Amounts.Total;
        return latestBillsLess ? atLatest : atHeld;
    }

    /// <summary>
    /// The version an unbilled stretch is shown at (a month still inside the trial): the held one while a
    /// hold touches it, else the latest. Nothing is charged, so there is no total to compare.
    /// </summary>
    public static PlatformPricePlan Unbilled(IReadOnlyCollection<PlatformPricePlan> plans, FoundingPriceHold? hold)
    {
        ArgumentNullException.ThrowIfNull(plans);
        return hold?.Plan
               ?? plans.MaxBy(plan => plan.VersionNumber)
               ?? throw new InvalidOperationException("No price plan has been published.");
    }

    private static PricedUsage At(
        PlatformPricePlan plan,
        InvoiceQuantities quantities,
        IncludedClientSources includedClients,
        decimal discountPercent) =>
        new(plan, PlatformInvoiceCalculation.Calculate(plan.Terms, quantities, includedClients, discountPercent));

    /// <summary>The terms in force: the latest published version.</summary>
    private static FoundingTerms? InForce(IReadOnlyCollection<FoundingTerms> termsVersions)
    {
        ArgumentNullException.ThrowIfNull(termsVersions);
        return termsVersions.MaxBy(version => version.VersionNumber);
    }

    /// <summary>The instant a UTC day ends: midnight of the next one, or the end of time for the last day there is.</summary>
    private static DateTimeOffset EndUtc(DateOnly day) =>
        day == DateOnly.MaxValue
            ? DateTimeOffset.MaxValue
            : new DateTimeOffset(day.AddDays(1).ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);
}
