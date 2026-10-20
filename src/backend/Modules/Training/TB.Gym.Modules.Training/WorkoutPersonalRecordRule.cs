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

    /// <summary>
    /// Whether one set of a workout set a record: the finish summary's answer for that set, so a set save and
    /// the summary never disagree about it (TRN-019).
    /// </summary>
    public static bool IsRecordSet(
        Guid setId,
        IEnumerable<PerformedSet> workoutSetsInOrder,
        IEnumerable<PerformedSet> earlierWorkoutSets) =>
        RecordSetIds(workoutSetsInOrder, earlierWorkoutSets).Contains(setId);

    /// <summary>
    /// A workout's completed sets in the order the rule reads them: its exercises by place, then each one's
    /// sets by place. A lift the session prescribes twice is read across both, as the lift actually done.
    /// </summary>
    public static IReadOnlyList<PerformedSet> CompletedSetsInOrder(WorkoutExecution workout)
    {
        ArgumentNullException.ThrowIfNull(workout);
        return workout.Exercises
            .OrderBy(exercise => exercise.Position).ThenBy(exercise => exercise.Id)
            .SelectMany(exercise => exercise.Sets
                .Where(set => set.IsCompleted)
                .OrderBy(set => set.Position).ThenBy(set => set.Id)
                .Select(set => new PerformedSet(set.Id, exercise.ActualExerciseId, set.ActualRepetitions,
                    set.ActualLoad, set.ActualLoadUnit, true)))
            .ToArray();
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
