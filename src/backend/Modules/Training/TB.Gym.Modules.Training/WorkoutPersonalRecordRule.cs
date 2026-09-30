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
}
