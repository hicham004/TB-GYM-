namespace TB.Gym.Modules.Strength;

public interface IStrengthApplicationService
{
    Task<StrengthMaxPage?> ListAsync(
        Guid clientProfileId,
        Guid? exerciseId,
        int skip,
        int take,
        CancellationToken cancellationToken);

    Task<StrengthCommandResult> RecordAsync(
        Guid clientProfileId,
        RecordStrengthMaxRequest request,
        CancellationToken cancellationToken);

    OneRepMaxEstimateView Estimate(EstimateOneRepMaxRequest request);
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
    DateTimeOffset CreatedAtUtc);

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
