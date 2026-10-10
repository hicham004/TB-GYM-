namespace TB.Gym.Modules.Strength;

public interface IStrengthApplicationService
{
    Task<StrengthMaxPage?> ListAsync(
        Guid clientProfileId,
        Guid? exerciseId,
        bool includeProgramMaxes,
        int skip,
        int take,
        CancellationToken cancellationToken);

    Task<StrengthCommandResult> RecordAsync(
        Guid clientProfileId,
        RecordStrengthMaxRequest request,
        CancellationToken cancellationToken);

    OneRepMaxEstimateView Estimate(EstimateOneRepMaxRequest request);

    RpeChartMaxEstimateView EstimateFromRpeChart(EstimateRpeChartMaxRequest request);
}

public sealed record StrengthMaxView(
    Guid Id,
    Guid ClientProfileId,
    Guid ExerciseId,
    string ExerciseName,
    StrengthMaxKind Kind,
    decimal Value,
    LoadUnit Unit,
    DateOnly EffectiveDate,
    StrengthMaxSource Source,
    string MethodKey,
    string MethodVersion,
    Guid? SourceWorkoutExecutionId,
    string? Note,
    DateTimeOffset CreatedAtUtc,
    StrengthMaxProgramView? Program = null);

/// <summary>
/// The program a row of the client's max history belongs to, when the row is a program's training max rather
/// than a recorded one (STR-015). Its id is that max's, never a recorded max's.
/// </summary>
public sealed record StrengthMaxProgramView(
    Guid MesocycleId,
    string ProgramName,
    int EffectiveFromWeek,
    WorkingMaxSource Origin);

public sealed record StrengthMaxPage(
    int Total,
    int Skip,
    int Take,
    IReadOnlyList<StrengthMaxView> Items);

public sealed record RecordStrengthMaxRequest(
    Guid ExerciseId,
    StrengthMaxKind Kind,
    decimal Value,
    LoadUnit Unit,
    DateOnly EffectiveDate,
    StrengthMaxSource Source,
    string? MethodKey,
    string? MethodVersion,
    Guid? SourceWorkoutExecutionId,
    string? Note);

public sealed record EstimateOneRepMaxRequest(decimal Load, int Repetitions, LoadUnit Unit, string MethodKey);

public sealed record OneRepMaxEstimateView(
    decimal Estimate,
    LoadUnit Unit,
    string MethodKey,
    string MethodVersion,
    string Qualification);

/// <summary>What week 1's weight implies as a training max, read backwards from the RTS chart (STR-011).</summary>
public sealed record EstimateRpeChartMaxRequest(decimal Load, int Repetitions, decimal Rpe, LoadUnit Unit);

public sealed record RpeChartMaxEstimateView(
    decimal Value,
    LoadUnit Unit,
    decimal Percent,
    string MethodKey,
    string MethodVersion,
    string Explanation);

public sealed record StrengthCommandResult(
    StrengthCommandStatus Status,
    StrengthMaxView? Record = null,
    IReadOnlyDictionary<string, string[]>? Errors = null);

public enum StrengthCommandStatus
{
    Success = 1,
    NotFound = 2,
    Invalid = 3,
}
