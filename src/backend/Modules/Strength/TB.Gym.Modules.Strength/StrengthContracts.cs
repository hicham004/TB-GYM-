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

    /// <summary>
    /// Records the Estimated 1RM a set they did implies (Epley v1) and, when asked, a training max at 90 % of it
    /// (TrainingMaxShare v1), in one save (critique B7b, STR-017).
    /// </summary>
    Task<MaxFromSetCommandResult> RecordFromSetAsync(
        Guid clientProfileId,
        RecordMaxFromSetRequest request,
        CancellationToken cancellationToken);

    /// <summary>
    /// A self-directed trainee of the house records their own training max for a lift while a Pro+ pass grants
    /// (STR-021, notes plan N9c3); answers as missing outside the house and for anyone else.
    /// </summary>
    Task<StrengthCommandResult> RecordOwnAsync(
        RecordOwnMaxRequest request,
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
    StrengthMaxProgramView? Program = null,
    StrengthMaxSetView? Basis = null,
    StrengthMaxFromEstimateView? FromEstimate = null);

/// <summary>The set an estimate was worked out from, weight × reps (STR-017).</summary>
public sealed record StrengthMaxSetView(decimal Load, int Repetitions);

/// <summary>The estimate a training max was set from, its value then, and the share it took (STR-017).</summary>
public sealed record StrengthMaxFromEstimateView(Guid EstimateId, decimal Estimate, decimal Percent);

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

/// <summary>
/// A max from a set they did (critique B7b): its weight and reps (1 to 10), the day they did it, and whether a
/// training max at 90 % of the estimate is recorded with it. The server works every number out itself.
/// </summary>
public sealed record RecordMaxFromSetRequest(
    Guid ExerciseId,
    decimal Load,
    int Repetitions,
    LoadUnit Unit,
    DateOnly EffectiveDate,
    bool AlsoSetTrainingMax,
    string? Note);

/// <summary>What a max from a set recorded: the estimate, and the training max set from it when asked.</summary>
public sealed record MaxFromSetView(StrengthMaxView Estimate, StrengthMaxView? TrainingMax);

public sealed record MaxFromSetCommandResult(
    StrengthCommandStatus Status,
    MaxFromSetView? Records = null,
    IReadOnlyDictionary<string, string[]>? Errors = null);

public sealed record EstimateOneRepMaxRequest(decimal Load, int Repetitions, LoadUnit Unit, string MethodKey);

public sealed record OneRepMaxEstimateView(
    decimal Estimate,
    LoadUnit Unit,
    string MethodKey,
    string MethodVersion,
    string Qualification,
    string Explanation,
    TrainingMaxShareView? TrainingMax);

/// <summary>
/// The training max TrainingMaxShare v1 sets from an estimate, 90 % of it, so a screen shows the server's number
/// before anything is recorded; null when the estimate is past what a max can be.
/// </summary>
public sealed record TrainingMaxShareView(
    decimal Value,
    decimal Percent,
    string MethodKey,
    string MethodVersion,
    string Explanation);

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
    IReadOnlyDictionary<string, string[]>? Errors = null,
    string? Code = null,
    string? Message = null);

public enum StrengthCommandStatus
{
    Success = 1,
    NotFound = 2,
    Invalid = 3,
    Forbidden = 4,
    Conflict = 5,
}

/// <summary>A trainee's own training max (STR-021): the lift, the number and its unit; the day is the house's today.</summary>
public sealed record RecordOwnMaxRequest(Guid ExerciseId, decimal Value, LoadUnit Unit);
