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

/// <param name="MovementPatterns">Any of these patterns; none asks for every pattern.</param>
/// <param name="Ids">
/// Only these exercises, at most <see cref="MaximumIds"/>: a program's own lifts, read without the rest of the
/// library. None asks for every exercise.
/// </param>
/// <param name="IncludePatterns">Whether the answer counts the library's exercises per pattern.</param>
public sealed record ExerciseSearchRequest(
    string? Query = null,
    ExerciseEquipment? Equipment = null,
    IReadOnlyList<MovementPattern>? MovementPatterns = null,
    MuscleGroup? Muscle = null,
    ExerciseClassification? Classification = null,
    string? Tag = null,
    bool IncludeArchived = false,
    int Skip = 0,
    int Take = 50,
    IReadOnlyList<Guid>? Ids = null,
    bool IncludePatterns = false)
{
    public const int MaximumIds = 100;
}

/// <param name="Patterns">
/// When asked for, how many exercises the library holds under each movement pattern it has, archived ones only
/// when asked for too, whatever the other filters: the chips a builder's library can offer without reading the
/// whole library. Empty when not asked for.
/// </param>
public sealed record ExerciseSearchResult(
    int Total,
    IReadOnlyList<ExerciseView> Items,
    IReadOnlyList<ExercisePatternCount> Patterns);

public sealed record ExercisePatternCount(MovementPattern Pattern, int Count);

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

/// <param name="IsArchived">The alternative was archived, so a builder offers it under no name of its own.</param>
public sealed record ExerciseAlternativeView(Guid ExerciseId, string ExerciseName, string? Note, bool IsArchived);

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
