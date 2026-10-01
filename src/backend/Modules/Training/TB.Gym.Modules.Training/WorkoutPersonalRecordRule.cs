namespace TB.Gym.Modules.Training;

/// <summary>Highest load at an exact rep count, for one exercise and one unit.</summary>
public static class WorkoutPersonalRecordRule
{
    public const string Key = "ExactRepsLoad";
    public const int Version = 1;

    public static bool IsRecord(
        bool isCompleted,
        int? repetitions,
        decimal? load,
        TrainingLoadUnit? unit,
        decimal? priorBestLoad) =>
        isCompleted && repetitions is > 0 && load is > 0 && unit is not null &&
        (priorBestLoad is null || load > priorBestLoad);

    /// <summary>
    /// The sets of one workout that set a record, given the completed sets of every workout that
    /// finished before it started. The workout's sets are read in order, so a later set must beat
    /// an earlier one in the same workout as well.
    /// </summary>
    public static IReadOnlyList<Guid> RecordSetIds(
        IEnumerable<PerformedSet> workoutSetsInOrder,
        IEnumerable<PerformedSet> earlierWorkoutSets)
    {
        var best = earlierWorkoutSets
            .Where(set => set.IsCompleted && set.Repetitions is not null && set.Load is not null &&
                          set.Unit is not null)
            .GroupBy(set => (set.ExerciseId, set.Repetitions, set.Unit))
            .ToDictionary(group => group.Key, group => group.Max(set => set.Load));
        var records = new List<Guid>();
        foreach (var set in workoutSetsInOrder)
        {
            if (!set.IsCompleted || set.Repetitions is null || set.Load is not { } load ||
                set.Unit is null)
            {
                continue;
            }

            var key = (set.ExerciseId, set.Repetitions, set.Unit);
            best.TryGetValue(key, out var prior);
            if (IsRecord(true, set.Repetitions, load, set.Unit, prior))
            {
                records.Add(set.SetId);
            }

            best[key] = prior is null ? load : Math.Max(prior.Value, load);
        }

        return records;
    }
}

/// <summary>One logged set as the record rule reads it: the exercise actually performed and its actuals.</summary>
public sealed record PerformedSet(
    Guid SetId,
    Guid ExerciseId,
    int? Repetitions,
    decimal? Load,
    TrainingLoadUnit? Unit,
    bool IsCompleted);
