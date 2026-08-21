namespace TB.Gym.Modules.ExerciseLibrary;

public interface IExerciseLibraryApplicationService
{
    Task<ExerciseSearchResult> SearchAsync(ExerciseSearchRequest request, CancellationToken cancellationToken);

    Task<ExerciseView?> GetAsync(Guid exerciseId, CancellationToken cancellationToken);

    Task<ExerciseCommandResult> CreateAsync(CreateExerciseRequest request, CancellationToken cancellationToken);

    Task<ExerciseCommandResult> UpdateAsync(
        Guid exerciseId,
        UpdateExerciseRequest request,
        CancellationToken cancellationToken);

    Task<ExerciseCommandResult> SetArchivedAsync(
        Guid exerciseId,
        SetExerciseArchivedRequest request,
        CancellationToken cancellationToken);
}

public sealed record ExerciseSearchRequest(
    string? Query = null,
    ExerciseEquipment? Equipment = null,
    MovementPattern? MovementPattern = null,
    MuscleGroup? Muscle = null,
    ExerciseClassification? Classification = null,
    string? Tag = null,
    bool IncludeArchived = false,
    int Skip = 0,
    int Take = 50);

public sealed record ExerciseSearchResult(int Total, IReadOnlyList<ExerciseView> Items);

public sealed record ExerciseView(
    Guid Id,
    string Name,
    string? Instructions,
    ExerciseEquipment Equipment,
    MovementPattern MovementPattern,
    ExerciseClassification Classification,
    bool IsArchived,
    IReadOnlyList<ExerciseMuscleView> Muscles,
    IReadOnlyList<string> Tags,
    IReadOnlyList<ExerciseAlternativeView> Alternatives,
    IReadOnlyList<Guid> MediaAssetIds,
    uint Version);

public sealed record ExerciseMuscleView(MuscleGroup Muscle, MuscleRole Role);

public sealed record ExerciseAlternativeView(Guid ExerciseId, string ExerciseName, string? Note);

public sealed record CreateExerciseRequest(
    string Name,
    string? Instructions,
    ExerciseEquipment Equipment,
    MovementPattern MovementPattern,
    ExerciseClassification Classification,
    IReadOnlyList<ExerciseMuscleRequest> Muscles,
    IReadOnlyList<string> Tags,
    IReadOnlyList<ExerciseAlternativeRequest> Alternatives,
    IReadOnlyList<Guid> MediaAssetIds);

public sealed record UpdateExerciseRequest(
    string Name,
    string? Instructions,
    ExerciseEquipment Equipment,
    MovementPattern MovementPattern,
    ExerciseClassification Classification,
    IReadOnlyList<ExerciseMuscleRequest> Muscles,
    IReadOnlyList<string> Tags,
    IReadOnlyList<ExerciseAlternativeRequest> Alternatives,
    IReadOnlyList<Guid> MediaAssetIds,
    uint Version);

public sealed record ExerciseMuscleRequest(MuscleGroup Muscle, MuscleRole Role);

public sealed record ExerciseAlternativeRequest(Guid ExerciseId, string? Note);

public sealed record SetExerciseArchivedRequest(bool IsArchived, uint Version);

public sealed record ExerciseCommandResult(
    ExerciseCommandStatus Status,
    ExerciseView? Exercise = null,
    IReadOnlyDictionary<string, string[]>? Errors = null,
    string? Code = null,
    string? Message = null);

public enum ExerciseCommandStatus
{
    Success = 1,
    NotFound = 2,
    Invalid = 3,
    Conflict = 4,
}
