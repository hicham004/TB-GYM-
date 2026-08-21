namespace TB.Gym.Modules.Training;

public sealed record ProgramBlueprint(
    string Name,
    string? Description,
    IReadOnlyList<TrainingWeekBlueprint> Weeks);

public sealed record TrainingWeekBlueprint(
    string? Label,
    bool IsPublished,
    IReadOnlyList<TrainingSessionBlueprint> Sessions);

public sealed record TrainingSessionBlueprint(
    string Name,
    int DayOffset,
    string? CoachNotes,
    IReadOnlyList<ExercisePrescriptionBlueprint> Exercises);

public sealed record ExercisePrescriptionBlueprint(
    Guid ExerciseId,
    string ExerciseNameSnapshot,
    int Position,
    bool IsMainLift,
    PrescriptionModificationPolicy ModificationPolicy,
    string? CoachNotes,
    IReadOnlyList<Guid> ApprovedAlternativeExerciseIds,
    IReadOnlyList<Guid> MediaAssetIds,
    IReadOnlyList<SetPrescriptionBlueprint> Sets);

public sealed record SetPrescriptionBlueprint(
    int Position,
    TrainingSetType SetType,
    int? RepetitionsMinimum,
    int? RepetitionsMaximum,
    TrainingLoadStrategy LoadStrategy,
    decimal? DirectLoad,
    TrainingLoadUnit? LoadUnit,
    decimal? PercentageWorkingMax,
    decimal? TargetRpe,
    ExertionDisplayPreference ExertionDisplayPreference,
    int? RestSeconds,
    string? Tempo,
    string? CoachNotes,
    Guid? WorkingMaxSnapshotId = null,
    decimal? UnroundedRecommendedLoad = null,
    decimal? PrescribedLoad = null,
    string? CalculationStrategyKey = null,
    string? CalculationStrategyVersion = null,
    string? CalculationExplanation = null,
    bool IsManualLoadOverride = false);

public enum PrescriptionModificationPolicy
{
    Locked = 1,
    CoachApprovedSwap = 2,
}

public enum TrainingSetType
{
    WarmUp = 1,
    Normal = 2,
    Top = 3,
    BackOff = 4,
    Drop = 5,
    Failure = 6,
}

public enum TrainingLoadStrategy
{
    None = 1,
    Direct = 2,
    PercentageWorkingMax = 3,
    RpeBasedEpley = 4,
}

public enum TrainingLoadUnit
{
    Kilogram = 1,
    Pound = 2,
}

public enum ExertionDisplayPreference
{
    Rpe = 1,
    Rir = 2,
}

public static class TrainingExertion
{
    public static decimal ValidateRpe(decimal rpe)
    {
        if (rpe is < 5m or > 10m || rpe * 2m != decimal.Truncate(rpe * 2m))
        {
            throw new ArgumentOutOfRangeException(nameof(rpe), "RPE must be between 5 and 10 in 0.5 steps.");
        }

        return rpe;
    }

    public static decimal RpeFromRir(decimal rir)
    {
        if (rir is < 0m or > 5m || rir * 2m != decimal.Truncate(rir * 2m))
        {
            throw new ArgumentOutOfRangeException(nameof(rir), "RIR must be between 0 and 5 in 0.5 steps.");
        }

        return 10m - rir;
    }

    public static decimal RirFromRpe(decimal rpe) => 10m - ValidateRpe(rpe);
}

internal static class TrainingText
{
    public static string Required(string value, int maxLength, string parameterName)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(value);
        var normalized = value.Trim();
        return normalized.Length <= maxLength
            ? normalized
            : throw new ArgumentException($"The value cannot exceed {maxLength} characters.", parameterName);
    }

    public static string? Optional(string? value, int maxLength, string parameterName) =>
        string.IsNullOrWhiteSpace(value) ? null : Required(value, maxLength, parameterName);
}
