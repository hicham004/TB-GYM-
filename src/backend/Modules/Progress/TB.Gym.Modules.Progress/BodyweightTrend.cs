namespace TB.Gym.Modules.Progress;

public sealed record BodyweightTrendSample(DateOnly Date, decimal ValueKilograms);

public sealed record BodyweightTrendPoint(DateOnly Date, decimal EstimateKilograms, int SampleCount);

public static class BodyweightTrendEwma
{
    public const string MethodKey = "BodyweightTrendEwma";
    public const string MethodVersion = "2.0";
    public const int TimeConstantDays = 10;
    public const int WarmupDays = 90;
    public const int MinimumWindowSampleCount = 3;

    public static IReadOnlyList<BodyweightTrendPoint> Calculate(
        IEnumerable<BodyweightTrendSample> samples,
        DateOnly from,
        DateOnly toExclusive)
    {
        ArgumentNullException.ThrowIfNull(samples);
        var ordered = samples.OrderBy(sample => sample.Date).ToArray();
        var targets = ordered
            .Where(sample => sample.Date >= from && sample.Date < toExclusive)
            .ToArray();
        var result = new List<BodyweightTrendPoint>(targets.Length);

        foreach (var target in targets)
        {
            var warmupStart = DateOnly.FromDayNumber(Math.Max(
                DateOnly.MinValue.DayNumber,
                target.Date.DayNumber - WarmupDays));
            var warmup = ordered
                .Where(sample => sample.Date >= warmupStart && sample.Date <= target.Date)
                .ToArray();
            var estimate = warmup[0].ValueKilograms;
            var previousDate = warmup[0].Date;
            for (var index = 1; index < warmup.Length; index++)
            {
                var sample = warmup[index];
                var elapsedDays = sample.Date.DayNumber - previousDate.DayNumber;
                var alpha = (decimal)(1d - Math.Exp(-(double)elapsedDays / TimeConstantDays));
                estimate += alpha * (sample.ValueKilograms - estimate);
                previousDate = sample.Date;
            }

            result.Add(new BodyweightTrendPoint(
                target.Date,
                decimal.Round(estimate, 3, MidpointRounding.AwayFromZero),
                warmup.Length));
        }

        return result;
    }
}

public static class BodyweightWeekPolicy
{
    public static DateOnly GetWeekStart(DateOnly date, DayOfWeek weekStartsOn)
    {
        if (!Enum.IsDefined(weekStartsOn))
        {
            throw new ArgumentOutOfRangeException(nameof(weekStartsOn));
        }

        var difference = ((int)date.DayOfWeek - (int)weekStartsOn + 7) % 7;
        return date.AddDays(-difference);
    }

    /// <summary>
    /// One workspace week's mean as every comparison takes it: over the samples in the seven days from
    /// <paramref name="weekStart"/>, rounded as every weekly mean is. Null for a week with no sample,
    /// which has no mean (PRG-004).
    /// </summary>
    public static BodyweightWeekMean? WeekMean(IEnumerable<BodyweightTrendSample> samples, DateOnly weekStart)
    {
        var weekEnd = weekStart.AddDays(7);
        var week = samples.Where(sample => sample.Date >= weekStart && sample.Date < weekEnd).ToArray();
        return week.Length == 0
            ? null
            : new BodyweightWeekMean(
                weekStart,
                decimal.Round(week.Average(sample => sample.ValueKilograms), 3, MidpointRounding.AwayFromZero),
                week.Length);
    }
}

public sealed record BodyweightWeeklyChangeResult(
    DateOnly FromDate,
    BodyweightWeekMean FirstWeek,
    BodyweightWeekMean LatestWeek,
    decimal DeltaKilograms);

/// <summary>
/// The change beside the weight on Progress (critique B16, PRG-005): the mean of the latest workspace
/// week a range has a weigh-in in, minus the mean of the week holding its first weigh-in, never two
/// single days. Each week is taken whole, whatever part of it the range covers, so a range that opens
/// in the middle of a week compares a week all the same, and so the figure is
/// <see cref="BodyweightSinceStart"/>'s when a chart begins at the start.
/// </summary>
public static class BodyweightWeeklyChange
{
    public const string MethodKey = "BodyweightChangeWeeklyMean";
    public const string MethodVersion = "1.0";

    /// <summary>
    /// <paramref name="samples"/> must hold the whole of the weeks the range's weigh-ins fall in. Null
    /// while there is nothing to compare: the range's weigh-ins all sit in one week, or it has none.
    /// </summary>
    public static BodyweightWeeklyChangeResult? Calculate(
        IEnumerable<BodyweightTrendSample> samples,
        DateOnly from,
        DateOnly toExclusive,
        DayOfWeek weekStartsOn)
    {
        ArgumentNullException.ThrowIfNull(samples);
        var read = samples.ToArray();
        var inRange = read
            .Where(sample => sample.Date >= from && sample.Date < toExclusive)
            .Select(sample => sample.Date)
            .ToArray();
        if (inRange.Length == 0)
        {
            return null;
        }

        var fromDate = inRange.Min();
        var firstWeek = BodyweightWeekPolicy.GetWeekStart(fromDate, weekStartsOn);
        var latestWeek = BodyweightWeekPolicy.GetWeekStart(inRange.Max(), weekStartsOn);
        if (latestWeek <= firstWeek)
        {
            return null;
        }

        var firstMean = BodyweightWeekPolicy.WeekMean(read, firstWeek)!;
        var latestMean = BodyweightWeekPolicy.WeekMean(read, latestWeek)!;
        return new BodyweightWeeklyChangeResult(
            fromDate,
            firstMean,
            latestMean,
            latestMean.MeanKilograms - firstMean.MeanKilograms);
    }
}
