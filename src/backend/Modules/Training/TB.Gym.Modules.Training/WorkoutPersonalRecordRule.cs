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
        IEnumerable<PerformedSet> earlierWorkoutSets) =>
        RecordSetIds(workoutSetsInOrder, BestLoads(earlierWorkoutSets));

    /// <summary>
    /// The same answer from the heaviest load at each key among the workouts that finished before it
    /// started, which a database can work out without handing over every earlier set.
    /// </summary>
    public static IReadOnlyList<Guid> RecordSetIds(
        IEnumerable<PerformedSet> workoutSetsInOrder,
        IReadOnlyDictionary<PersonalRecordKey, decimal> earlierBestLoads)
    {
        ArgumentNullException.ThrowIfNull(earlierBestLoads);
        var best = new Dictionary<PersonalRecordKey, decimal>(earlierBestLoads);
        var records = new List<Guid>();
        foreach (var set in workoutSetsInOrder)
        {
            if (!set.IsCompleted || set.Repetitions is not { } repetitions || set.Load is not { } load ||
                set.Unit is not { } unit)
            {
                continue;
            }

            var key = new PersonalRecordKey(set.ExerciseId, repetitions, unit);
            decimal? prior = best.TryGetValue(key, out var known) ? known : null;
            if (IsRecord(true, repetitions, load, unit, prior))
            {
                records.Add(set.SetId);
            }

            best[key] = prior is null ? load : Math.Max(prior.Value, load);
        }

        return records;
    }

    /// <summary>The heaviest completed load at each key: what a later workout is compared against.</summary>
    public static IReadOnlyDictionary<PersonalRecordKey, decimal> BestLoads(IEnumerable<PerformedSet> sets) =>
        sets
            .Where(set => set.IsCompleted && set.Repetitions is not null && set.Load is not null &&
                          set.Unit is not null)
            .GroupBy(set => new PersonalRecordKey(set.ExerciseId, set.Repetitions!.Value, set.Unit!.Value))
            .ToDictionary(group => group.Key, group => group.Max(set => set.Load!.Value));

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

/// <summary>What the record rule compares: one exercise at one exact repetition count in one unit.</summary>
public readonly record struct PersonalRecordKey(Guid ExerciseId, int Repetitions, TrainingLoadUnit Unit);

/// <summary>One logged set as the record rule reads it: the exercise actually performed and its actuals.</summary>
public sealed record PerformedSet(
    Guid SetId,
    Guid ExerciseId,
    int? Repetitions,
    decimal? Load,
    TrainingLoadUnit? Unit,
    bool IsCompleted);
