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
/// <param name="Status">The exercises in use, the archived ones, or both (critique B9).</param>
/// <param name="TypeName">Only exercises of type Other that carry this name of the coach's own, in any case.</param>
/// <param name="IncludeFacets">Whether the answer carries the library page's counts, tags and own type names.</param>
public sealed record ExerciseSearchRequest(
    string? Query = null,
    ExerciseEquipment? Equipment = null,
    IReadOnlyList<MovementPattern>? MovementPatterns = null,
    MuscleGroup? Muscle = null,
    ExerciseClassification? Classification = null,
    string? Tag = null,
    ExerciseListStatus Status = ExerciseListStatus.Active,
    int Skip = 0,
    int Take = 50,
    IReadOnlyList<Guid>? Ids = null,
    bool IncludePatterns = false,
    string? TypeName = null,
    bool IncludeFacets = false)
{
    public const int MaximumIds = 100;
}

/// <summary>
/// Which exercises a search reads (critique B9): those in use, which every picker offers; the archived ones,
/// which the library's Archived view lists; or both.
/// </summary>
public enum ExerciseListStatus
{
    Active = 1,
    Archived = 2,
    Both = 3,
}

/// <param name="Patterns">
/// When asked for, how many exercises the library holds under each movement pattern it has, archived ones only
/// when asked for too, whatever the other filters: the chips a builder's library can offer without reading the
/// whole library. Empty when not asked for.
/// </param>
/// <param name="Facets">When asked for, what the library page's filters offer; null otherwise.</param>
public sealed record ExerciseSearchResult(
    int Total,
    IReadOnlyList<ExerciseView> Items,
    IReadOnlyList<ExercisePatternCount> Patterns,
    ExerciseLibraryFacets? Facets = null);

public sealed record ExercisePatternCount(MovementPattern Pattern, int Count);

/// <summary>
/// The exercise library page's filters (critique B9), whatever the search and the other filters, so a choice
/// never empties its own menu.
/// </summary>
/// <param name="Active">How many exercises are in use: "Your exercises".</param>
/// <param name="Archived">How many are archived: "Archived (n)".</param>
/// <param name="Tags">Each tag of the exercises in the status asked for, with how many carry it, by name.</param>
/// <param name="TypeNames">The coach's own names for type Other in the status asked for, once each, by name.</param>
public sealed record ExerciseLibraryFacets(
    int Active,
    int Archived,
    IReadOnlyList<ExerciseTagCount> Tags,
    IReadOnlyList<string> TypeNames);

public sealed record ExerciseTagCount(string Tag, int Count);

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
    uint Version,
    string? TypeName = null);

public sealed record ExerciseMuscleView(MuscleGroup Muscle, MuscleRole Role);

/// <param name="IsArchived">The alternative was archived, so a builder offers it under no name of its own.</param>
public sealed record ExerciseAlternativeView(Guid ExerciseId, string ExerciseName, string? Note, bool IsArchived);

/// <param name="TypeName">Other's own name ("Rehab"), up to 40 characters; only with type Other.</param>
public sealed record CreateExerciseRequest(
    string Name,
    string? Instructions,
    ExerciseEquipment Equipment,
    MovementPattern MovementPattern,
    ExerciseClassification Classification,
    IReadOnlyList<ExerciseMuscleRequest> Muscles,
    IReadOnlyList<string> Tags,
    IReadOnlyList<ExerciseAlternativeRequest> Alternatives,
    IReadOnlyList<Guid> MediaAssetIds,
    string? TypeName = null);

/// <param name="TypeName">Other's own name ("Rehab"), up to 40 characters; only with type Other.</param>
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
    uint Version,
    string? TypeName = null);

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
