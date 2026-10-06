using System.Globalization;

namespace TB.Gym.Modules.Strength;

/// <summary>
/// RpeChart v1: the widely used Tuchscherer (Reactive Training Systems) reps x RPE chart, which says
/// what share of a one-rep max a set of N repetitions at a given RPE is. Rows run from RPE 10 down to
/// RPE 6.5 in half steps and columns from 1 to 12 repetitions. The values are the chart as it is
/// reproduced in coaching practice; RTS itself teaches lifters to personalise it, so it is a starting
/// point and not physiology. It agrees with the peer-reviewed table in Helms et al. (2016, Strength &amp;
/// Conditioning Journal 38(4), Table 2) to within 2.2 percentage points where the two overlap (RPE 7
/// to 10, 1 to 8 repetitions); a reference test pins both. Inputs outside the chart are rejected, never
/// extrapolated (ADR 0036). A change to any value is a new version, not an edit.
/// </summary>
public static class RtsRpeChart
{
    public const string Key = "RpeChart";
    public const string CurrentVersion = "1.0";
    public const decimal MinimumRpe = 6.5m;
    public const decimal MaximumRpe = 10m;
    public const int MinimumRepetitions = 1;
    public const int MaximumRepetitions = 12;

    private const decimal RpeStep = 0.5m;

    // Row 0 is RPE 10, row 7 is RPE 6.5; column 0 is 1 repetition, column 11 is 12.
    private static readonly decimal[][] Percentages =
    [
        [100.0m, 95.5m, 92.2m, 89.2m, 86.3m, 83.7m, 81.1m, 78.6m, 76.2m, 73.9m, 70.7m, 68.0m],
        [97.8m, 93.9m, 90.7m, 87.8m, 85.0m, 82.4m, 79.9m, 77.4m, 75.1m, 72.3m, 69.4m, 66.7m],
        [95.5m, 92.2m, 89.2m, 86.3m, 83.7m, 81.1m, 78.6m, 76.2m, 73.9m, 70.7m, 68.0m, 65.3m],
        [93.9m, 90.7m, 87.8m, 85.0m, 82.4m, 79.9m, 77.4m, 75.1m, 72.3m, 69.4m, 66.7m, 64.0m],
        [92.2m, 89.2m, 86.3m, 83.7m, 81.1m, 78.6m, 76.2m, 73.9m, 70.7m, 68.0m, 65.3m, 62.6m],
        [90.7m, 87.8m, 85.0m, 82.4m, 79.9m, 77.4m, 75.1m, 72.3m, 69.4m, 66.7m, 64.0m, 61.3m],
        [89.2m, 86.3m, 83.7m, 81.1m, 78.6m, 76.2m, 73.9m, 70.7m, 68.0m, 65.3m, 62.6m, 59.9m],
        [87.8m, 85.0m, 82.4m, 79.9m, 77.4m, 75.1m, 72.3m, 69.4m, 66.7m, 64.0m, 61.3m, 58.6m],
    ];

    /// <summary>The coach-readable reason a set is outside the chart, shown wherever it is refused.</summary>
    public const string CoverageMessage =
        "The RTS RPE chart covers RPE 6.5 to 10 in half steps and 1 to 12 repetitions. " +
        "For this set, type a weight yourself or use the Epley-shaped formula.";

    public static bool Covers(int repetitions, decimal rpe) =>
        repetitions is >= MinimumRepetitions and <= MaximumRepetitions &&
        rpe is >= MinimumRpe and <= MaximumRpe &&
        rpe % RpeStep == 0m;

    /// <summary>The chart's percentage of a one-rep max, one decimal as printed.</summary>
    public static decimal PercentOfOneRepMax(int repetitions, decimal rpe)
    {
        if (!Covers(repetitions, rpe))
        {
            throw new ArgumentOutOfRangeException(nameof(rpe), CoverageMessage);
        }

        var row = (int)((MaximumRpe - rpe) / RpeStep);
        return Percentages[row][repetitions - MinimumRepetitions];
    }
}

/// <summary>
/// The load for a set from the captured working max and the RTS chart (RpeChart v1): the chart's
/// percentage for the prescribed repetitions at the target RPE, applied to the working max. The
/// rounding to a practical plate step is a separate policy (STR-008).
/// </summary>
public sealed class RpeChartLoadStrategy : ILoadRecommendationStrategy
{
    public string StrategyKey => RtsRpeChart.Key;

    public string Version => RtsRpeChart.CurrentVersion;

    public UnroundedLoadRecommendation Recommend(LoadRecommendationInput input)
    {
        if (input.Strategy != PrescriptionLoadStrategy.RpeChart || !Enum.IsDefined(input.Unit))
        {
            throw new ArgumentException("RpeChart v1 only calculates RPE-chart loads.", nameof(input));
        }

        var max = input.WorkingMax is > 0m
            ? input.WorkingMax.Value
            : throw new ArgumentException("A positive working max is required.");
        var repetitions = input.Repetitions
            ?? throw new ArgumentException("Repetitions are required for RPE loading.");
        var rpe = input.TargetRpe ?? throw new ArgumentException("Target RPE is required for RPE loading.");

        var percent = RtsRpeChart.PercentOfOneRepMax(repetitions, rpe);
        var raw = decimal.Round(max * percent / 100m, 3, MidpointRounding.AwayFromZero);
        var unit = StrengthUnits.Short(input.Unit);
        var culture = CultureInfo.InvariantCulture;
        return new UnroundedLoadRecommendation(
            raw,
            input.Unit,
            StrategyKey,
            Version,
            string.Create(culture,
                $"RTS RPE chart v1: {repetitions} reps at RPE {rpe:0.#} is {percent:0.#}% of {max:0.###} {unit} = {raw:0.###} {unit}."));
    }
}

/// <summary>The max that one set's weight implies on the RTS chart, with the numbers behind it.</summary>
public sealed record RpeChartMaxEstimate(
    decimal Value,
    LoadUnit Unit,
    decimal Percent,
    string StrategyKey,
    string Version,
    string Explanation);

/// <summary>
/// "From week 1's weight" (RpeChart v1 read backwards, ADR 0036): a set of N repetitions at a target
/// RPE is the chart's percentage of the max, so the max is the weight divided by that percentage. It
/// uses the prescription only, never a logged performance (STR-007), and it rejects a set the chart
/// does not cover instead of guessing. The value keeps three decimals, as every captured max does.
/// </summary>
public static class RpeChartMaxEstimator
{
    public static RpeChartMaxEstimate Estimate(decimal load, int repetitions, decimal rpe, LoadUnit unit)
    {
        if (!Enum.IsDefined(unit))
        {
            throw new ArgumentException("A load unit is required.", nameof(unit));
        }

        if (load is <= 0m or > 2_000m)
        {
            throw new ArgumentOutOfRangeException(nameof(load), "The weight must be more than 0 and at most 2,000.");
        }

        var percent = RtsRpeChart.PercentOfOneRepMax(repetitions, rpe);
        var value = decimal.Round(load * 100m / percent, 3, MidpointRounding.AwayFromZero);
        if (value > 2_000m)
        {
            throw new ArgumentOutOfRangeException(nameof(load), "That weight would make the training max more than 2,000.");
        }

        var unitName = StrengthUnits.Short(unit);
        return new RpeChartMaxEstimate(
            value,
            unit,
            percent,
            RtsRpeChart.Key,
            RtsRpeChart.CurrentVersion,
            string.Create(
                CultureInfo.InvariantCulture,
                $"RTS RPE chart v1: {repetitions} reps at RPE {rpe:0.#} is {percent:0.#}% of the max, so {load:0.###} {unitName} / {percent:0.#}% = {value:0.###} {unitName}."));
    }
}

internal static class StrengthUnits
{
    public static string Short(LoadUnit unit) => unit == LoadUnit.Pound ? "lb" : "kg";
}
