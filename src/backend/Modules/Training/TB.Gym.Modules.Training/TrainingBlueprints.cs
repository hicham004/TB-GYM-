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

/// <param name="LoadStep">
/// A last time + step set's step, in the set's unit (N6a); null on every other set. Not the week copies'
/// weight a week, <see cref="WeekProgressionSteps.LoadStep"/>.
/// </param>
public sealed record SetPrescriptionBlueprint(
    int Position,
    TrainingSetType SetType,
    int? RepetitionsMinimum,
    int? RepetitionsMaximum,
    TrainingLoadStrategy LoadStrategy,
    decimal? DirectLoad,
    TrainingLoadUnit? LoadUnit,
    decimal? PercentageWorkingMax,
    decimal? LoadStep,
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

/// <summary>The load of one set worked out again after its program's training max changed (STR-002).</summary>
public sealed record SetLoadCalculation(
    Guid WorkingMaxSnapshotId,
    decimal UnroundedRecommendedLoad,
    decimal PrescribedLoad,
    string StrategyKey,
    string StrategyVersion,
    string Explanation);

/// <summary>
/// The weight a coach applied on a "Last time + step" set from where its lift stood (notes plan N6c, STR-020), in
/// the set's own unit, with why in plain words (<see cref="LastTimeStepRule.Explain"/>). <paramref name="From"/> is
/// the set's weight as the coach read it (null when the client picked): the set must still hold it.
/// </summary>
public sealed record AppliedLiftWeight(decimal? From, decimal Weight, TrainingLoadUnit Unit, string Explanation);

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
    RpeChart = 5,

    /// <summary>
    /// Last time + step (N6a): the coach's starting weight, or none, and a step the coach adds after reading
    /// the logged sets (decision 21). A typed weight: never worked out from a max or rounded.
    /// </summary>
    LastTimeStep = 6,
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
