namespace TB.Gym.Modules.Training;

/// <summary>
/// A workout of one's own (TRN-033, notes plan N9b2): what a client of the house logs from its exercise pool with no
/// program behind it. Nothing in it is prescribed or worked out (Free's "no calculation", decision 32): its sets hold
/// only what was typed, within <see cref="WorkoutSetPerformance"/>'s limits.
/// </summary>
public static class OwnWorkoutRule
{
    /// <summary>The name every workout of one's own carries, where a program's workout shows its session's name.</summary>
    public const string Name = "Workout";

    /// <summary>The most exercises one workout holds: a program's session's limit (TRN-024).</summary>
    public const int MaximumExercises = 40;

    /// <summary>The most sets one exercise holds: a program's session's limit (TRN-024).</summary>
    public const int MaximumSetsPerExercise = 20;

    /// <summary>
    /// The most workouts of one's own a client starts on one of the house's days: far beyond a real day's training, it
    /// bounds what one account can write, since a workout is never deleted.
    /// </summary>
    public const int MaximumStartedPerDay = 10;

    /// <summary>
    /// The empty sets an exercise starts with in a workout started from a finished one: as many as were done there, at
    /// least one and at most the limit. No weight, rep or effort is carried in.
    /// </summary>
    public static int SetsCarriedOver(int completedSets) => Math.Clamp(completedSets, 1, MaximumSetsPerExercise);
}

/// <summary>
/// A workout of one's own refused a change (TRN-033): the workout is a program's, a limit is reached, or the set is not
/// its exercise's last.
/// </summary>
public sealed class OwnWorkoutConflictException(string code, string message) : InvalidOperationException(message)
{
    public const string NotOwnCode = "own_workout_only";
    public const string LimitCode = "own_workout_limit";
    public const string NotLastSetCode = "own_workout_not_last_set";

    /// <summary>What a program's workout answers when an exercise or set is added to it or taken from it.</summary>
    public const string NotOwnMessage =
        "Exercises and sets are added or taken away only in a workout of your own, not in a program's workout.";

    public string Code { get; } = code;
}
