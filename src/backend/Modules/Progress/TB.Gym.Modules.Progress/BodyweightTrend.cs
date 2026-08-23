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
}
