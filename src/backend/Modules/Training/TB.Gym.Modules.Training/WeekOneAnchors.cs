namespace TB.Gym.Modules.Training;

/// <summary>
/// The set of week 1 that "from week 1's weight" reads for one exercise (TRN-026): its repetitions and
/// RPE, and the weight it has: the one typed in a program version, or the one prescribed in an assigned
/// program. Null when the set has no weight yet.
/// </summary>
public sealed record WeekOneAnchor(
    Guid ExerciseId,
    string ExerciseName,
    string SessionName,
    int SetPosition,
    int Repetitions,
    decimal Rpe,
    decimal? Load,
    TrainingLoadUnit? LoadUnit);

public static class WeekOneAnchors
{
    /// <summary>
    /// The first working set of the exercise in week 1, by day and then position, that names a repetition
    /// count and an RPE the load formula covers. Warm-up sets never count. Null when week 1 has none, and
    /// the caller says so rather than guessing (STR-010).
    /// </summary>
    /// <param name="weekOne">Week 1 of a published program version or of an assigned program.</param>
    /// <param name="exerciseId">The exercise whose max is being worked out.</param>
    /// <param name="isCovered">Whether the formula covers a repetition count at an RPE.</param>
    public static WeekOneAnchor? Find(
        TrainingWeekBlueprint weekOne,
        Guid exerciseId,
        Func<int, decimal, bool> isCovered)
    {
        ArgumentNullException.ThrowIfNull(weekOne);
        ArgumentNullException.ThrowIfNull(isCovered);
        foreach (var session in weekOne.Sessions.OrderBy(item => item.DayOffset))
        {
            foreach (var exercise in session.Exercises
                         .Where(item => item.ExerciseId == exerciseId)
                         .OrderBy(item => item.Position))
            {
                foreach (var set in exercise.Sets.OrderBy(item => item.Position))
                {
                    if (set.SetType == TrainingSetType.WarmUp ||
                        set.RepetitionsMaximum is not { } repetitions ||
                        set.TargetRpe is not { } rpe ||
                        !isCovered(repetitions, rpe))
                    {
                        continue;
                    }

                    return new WeekOneAnchor(
                        exerciseId,
                        exercise.ExerciseNameSnapshot,
                        session.Name,
                        set.Position,
                        repetitions,
                        rpe,
                        set.PrescribedLoad ?? (set.LoadStrategy == TrainingLoadStrategy.Direct ? set.DirectLoad : null),
                        set.LoadUnit);
                }
            }
        }

        return null;
    }
}
