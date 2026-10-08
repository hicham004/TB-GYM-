namespace TB.Gym.Modules.Strength;

/// <summary>
/// One logged set as the suggestion reads it (P4b), in this module's words: what the client did and where
/// the set sits in the program. The caller passes only sets of finished workouts of one program, of the
/// exercise actually performed, so a swapped-in lift never speaks for the prescribed one.
/// </summary>
/// <param name="LoggedAtUtc">When the workout holding the set was finished.</param>
/// <param name="PerformedOn">That moment as a date in the program's time zone.</param>
public sealed record LoggedSetEvidence(
    Guid SetId,
    int WeekNumber,
    DateOnly PerformedOn,
    DateTimeOffset LoggedAtUtc,
    string SessionName,
    bool IsWarmUp,
    bool IsCompleted,
    int? Repetitions,
    decimal? Load,
    LoadUnit? Unit,
    decimal? Rpe);

/// <summary>The max one logged set implies on the RTS chart, and the set it came from.</summary>
public sealed record LoggedSetMaxEstimate(LoggedSetEvidence Set, RpeChartMaxEstimate Estimate);

/// <summary>
/// BestLoggedSet v1 (P4b, ADR 0036, STR-007): the training max a client's logged sets suggest for one lift
/// of a program. A set counts when it is a finished working set of 1 to 8 repetitions at RPE 7 to 10, with
/// a weight in the program's unit, logged after the max in use was set: that is where the RTS chart agrees
/// with Helms et al. and where lifters judge their reps in reserve best. Of the latest program week
/// holding such a set, the one implying the highest max wins; back-off sets, tired by the top set, would
/// only pull an average down. The result is a suggestion for the coach to review, never a change.
/// </summary>
public static class BestLoggedSetRule
{
    public const string Key = "BestLoggedSet";
    public const string CurrentVersion = "1.0";
    public const int MinimumRepetitions = 1;
    public const int MaximumRepetitions = 8;
    public const decimal MinimumRpe = 7m;
    public const decimal MaximumRpe = 10m;

    private const decimal MaximumMax = 2_000m;

    /// <summary>Whether a logged set is evidence for a program in <paramref name="unit"/> whose max in use was set at <paramref name="since"/>.</summary>
    public static bool Counts(LoggedSetEvidence set, LoadUnit unit, DateTimeOffset since)
    {
        ArgumentNullException.ThrowIfNull(set);
        return !set.IsWarmUp &&
               set.IsCompleted &&
               set.LoggedAtUtc > since &&
               set.Unit == unit &&
               set.Repetitions is { } repetitions and >= MinimumRepetitions and <= MaximumRepetitions &&
               set.Rpe is { } rpe and >= MinimumRpe and <= MaximumRpe &&
               RtsRpeChart.Covers(repetitions, rpe) &&
               set.Load is { } load and > 0m and <= MaximumMax &&
               ImpliedMax(load, repetitions, rpe) <= MaximumMax;
    }

    /// <summary>The max a set that counts implies, with the chart's numbers behind it.</summary>
    public static RpeChartMaxEstimate Estimate(LoggedSetEvidence set, LoadUnit unit, DateTimeOffset since)
    {
        if (!Counts(set, unit, since))
        {
            throw new ArgumentException(
                "Only a finished working set of 1 to 8 reps at RPE 7 to 10, logged in the program's unit after " +
                "the training max in use was set, can suggest a new max.",
                nameof(set));
        }

        return RpeChartMaxEstimator.Estimate(set.Load!.Value, set.Repetitions!.Value, set.Rpe!.Value, unit);
    }

    /// <summary>
    /// The set the suggestion comes from: of the latest program week holding a set that counts, the one
    /// implying the highest max. A tie goes to the later set, then the set id, so the answer never depends
    /// on the order the sets were read in. Null when no set counts.
    /// </summary>
    public static LoggedSetMaxEstimate? Best(IEnumerable<LoggedSetEvidence> sets, LoadUnit unit, DateTimeOffset since)
    {
        ArgumentNullException.ThrowIfNull(sets);
        var counted = sets.Where(set => Counts(set, unit, since)).ToArray();
        if (counted.Length == 0)
        {
            return null;
        }

        var week = counted.Max(set => set.WeekNumber);
        return counted
            .Where(set => set.WeekNumber == week)
            .Select(set => new LoggedSetMaxEstimate(set, RpeChartMaxEstimator.Estimate(set.Load!.Value, set.Repetitions!.Value, set.Rpe!.Value, unit)))
            .OrderByDescending(item => item.Estimate.Value)
            .ThenByDescending(item => item.Set.LoggedAtUtc)
            .ThenByDescending(item => item.Set.SetId)
            .First();
    }

    /// <summary>
    /// A suggestion is shown only when it moves the max by more than one rounding step, up or down: closer
    /// than that, the weights it gives are mostly the ones the program already has.
    /// </summary>
    public static bool IsWorthSuggesting(decimal current, decimal estimate, decimal roundingStep) =>
        roundingStep > 0m
            ? Math.Abs(estimate - current) > roundingStep
            : throw new ArgumentOutOfRangeException(nameof(roundingStep), "The rounding step must be positive.");

    private static decimal ImpliedMax(decimal load, int repetitions, decimal rpe) =>
        decimal.Round(load * 100m / RtsRpeChart.PercentOfOneRepMax(repetitions, rpe), 3, MidpointRounding.AwayFromZero);
}
