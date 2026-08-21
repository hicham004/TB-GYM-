namespace TB.Gym.Modules.Strength;

public readonly record struct ExertionTarget
{
    private ExertionTarget(decimal rpe)
    {
        Rpe = ValidateRpe(rpe);
    }

    public decimal Rpe { get; }

    public decimal Rir => 10m - Rpe;

    public static ExertionTarget FromRpe(decimal rpe) => new(rpe);

    public static ExertionTarget FromRir(decimal rir)
    {
        if (rir is < 0m or > 5m || !IsHalfStep(rir))
        {
            throw new ArgumentOutOfRangeException(nameof(rir), "RIR must be between 0 and 5 in 0.5 steps.");
        }

        return new ExertionTarget(10m - rir);
    }

    private static decimal ValidateRpe(decimal rpe)
    {
        if (rpe is < 5m or > 10m || !IsHalfStep(rpe))
        {
            throw new ArgumentOutOfRangeException(nameof(rpe), "RPE must be between 5 and 10 in 0.5 steps.");
        }

        return rpe;
    }

    private static bool IsHalfStep(decimal value) => value * 2m == decimal.Truncate(value * 2m);
}

public interface IOneRepMaxEstimator
{
    string MethodKey { get; }

    string Version { get; }

    decimal Estimate(decimal load, int repetitions);
}

public sealed class EpleyOneRepMaxEstimator : IOneRepMaxEstimator
{
    public const string Key = "Epley";
    public const string CurrentVersion = "1.0";

    public string MethodKey => Key;

    public string Version => CurrentVersion;

    public decimal Estimate(decimal load, int repetitions)
    {
        ValidateEstimateInput(load, repetitions, 12);
        var estimate = repetitions == 1 ? load : load * (1m + repetitions / 30m);
        return decimal.Round(estimate, 3, MidpointRounding.AwayFromZero);
    }

    internal static void ValidateEstimateInput(decimal load, int repetitions, int maxRepetitions)
    {
        StrengthRules.ValidateLoad(load, nameof(load));
        if (repetitions is < 1 || repetitions > maxRepetitions)
        {
            throw new ArgumentOutOfRangeException(
                nameof(repetitions),
                $"This estimator supports 1 to {maxRepetitions} repetitions.");
        }
    }
}

public sealed class BrzyckiOneRepMaxEstimator : IOneRepMaxEstimator
{
    public const string Key = "Brzycki";
    public const string CurrentVersion = "1.0";

    public string MethodKey => Key;

    public string Version => CurrentVersion;

    public decimal Estimate(decimal load, int repetitions)
    {
        EpleyOneRepMaxEstimator.ValidateEstimateInput(load, repetitions, 10);
        var estimate = repetitions == 1 ? load : load * 36m / (37m - repetitions);
        return decimal.Round(estimate, 3, MidpointRounding.AwayFromZero);
    }
}

public interface ILoadRecommendationStrategy
{
    string StrategyKey { get; }

    string Version { get; }

    UnroundedLoadRecommendation Recommend(LoadRecommendationInput input);
}

public sealed record LoadRecommendationInput(
    PrescriptionLoadStrategy Strategy,
    decimal? DirectLoad,
    decimal? PercentageWorkingMax,
    decimal? WorkingMax,
    int? Repetitions,
    decimal? TargetRpe,
    LoadUnit Unit);

public sealed record UnroundedLoadRecommendation(
    decimal Value,
    LoadUnit Unit,
    string StrategyKey,
    string StrategyVersion,
    string Explanation);

public sealed class StrengthLoadRecommendationStrategy : ILoadRecommendationStrategy
{
    public const string Key = "WorkingMaxLoad";
    public const string CurrentVersion = "2.0";

    public string StrategyKey => Key;

    public string Version => CurrentVersion;

    public UnroundedLoadRecommendation Recommend(LoadRecommendationInput input)
    {
        if (!Enum.IsDefined(input.Strategy) || !Enum.IsDefined(input.Unit))
        {
            throw new ArgumentException("Load recommendation metadata is invalid.", nameof(input));
        }

        var raw = input.Strategy switch
        {
            PrescriptionLoadStrategy.Direct => RequirePositive(input.DirectLoad, "direct load"),
            PrescriptionLoadStrategy.PercentageWorkingMax =>
                RequirePositive(input.WorkingMax, "working max") *
                RequirePercentage(input.PercentageWorkingMax) / 100m,
            PrescriptionLoadStrategy.RpeBasedEpley => RecommendFromRpe(input),
            _ => throw new ArgumentOutOfRangeException(nameof(input)),
        };

        raw = decimal.Round(raw, 3, MidpointRounding.AwayFromZero);
        return new UnroundedLoadRecommendation(
            raw,
            input.Unit,
            StrategyKey,
            Version,
            BuildExplanation(input));
    }

    private static decimal RecommendFromRpe(LoadRecommendationInput input)
    {
        var max = RequirePositive(input.WorkingMax, "working max");
        var repetitions = input.Repetitions ?? throw new ArgumentException("Repetitions are required for RPE loading.");
        if (repetitions is < 1 or > 12)
        {
            throw new ArgumentOutOfRangeException(nameof(input), "RPE loading supports 1 to 12 repetitions.");
        }

        var exertion = ExertionTarget.FromRpe(
            input.TargetRpe ?? throw new ArgumentException("Target RPE is required for RPE loading."));
        var effectiveRepetitions = repetitions + exertion.Rir;
        if (effectiveRepetitions > 12m)
        {
            throw new ArgumentOutOfRangeException(
                nameof(input),
                "RPE loading supports at most 12 effective repetitions (prescribed repetitions plus RIR). Use a manual load override for this prescription.");
        }

        return max / (1m + effectiveRepetitions / 30m);
    }

    private static decimal RequirePositive(decimal? value, string field) =>
        value is > 0m ? value.Value : throw new ArgumentException($"A positive {field} is required.");

    private static decimal RequirePercentage(decimal? value) =>
        value is > 0m and <= 150m
            ? value.Value
            : throw new ArgumentOutOfRangeException(nameof(value), "Working-max percentage must be between 0 and 150.");

    private static string BuildExplanation(LoadRecommendationInput input) =>
        input.Strategy switch
        {
            PrescriptionLoadStrategy.Direct => "Coach-prescribed direct load.",
            PrescriptionLoadStrategy.PercentageWorkingMax =>
                $"{input.PercentageWorkingMax:0.###}% of the captured working max.",
            _ => "WorkingMaxLoad v2 scales the captured coach-selected working max with an inverse Epley-shaped curve using prescribed reps plus RIR. It does not estimate or imply a true 1RM.",
        };
}

public sealed record LoadRoundingPolicy(LoadUnit Unit, decimal Increment, LoadRoundingMode Mode)
{
    public decimal Round(decimal unrounded)
    {
        if (!Enum.IsDefined(Unit) || !Enum.IsDefined(Mode) || Increment is <= 0m or > 50m)
        {
            throw new InvalidOperationException("The load-rounding policy is invalid.");
        }

        var steps = unrounded / Increment;
        var roundedSteps = Mode switch
        {
            LoadRoundingMode.Nearest => decimal.Round(steps, 0, MidpointRounding.AwayFromZero),
            LoadRoundingMode.Down => decimal.Floor(steps),
            LoadRoundingMode.Up => decimal.Ceiling(steps),
            _ => throw new InvalidOperationException("The load-rounding mode is invalid."),
        };
        var rounded = decimal.Round(roundedSteps * Increment, 3, MidpointRounding.AwayFromZero);
        if (unrounded > 0m && rounded <= 0m)
        {
            throw new InvalidOperationException(
                "The positive target is below the practical external-load increment. Choose a smaller increment, use a manual override, or prescribe no external load explicitly.");
        }

        return rounded;
    }
}

public enum PrescriptionLoadStrategy
{
    Direct = 1,
    PercentageWorkingMax = 2,
    RpeBasedEpley = 3,
}

public enum LoadRoundingMode
{
    Nearest = 1,
    Down = 2,
    Up = 3,
}
