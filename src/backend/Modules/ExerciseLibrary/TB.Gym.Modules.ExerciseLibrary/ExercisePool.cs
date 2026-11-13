namespace TB.Gym.Modules.ExerciseLibrary;

/// <summary>
/// The house's exercise pool (LIB-006, notes plan N9b1): the house's own library as a client of the house reads it
/// while they have Training access, the exercises in use alone, searched as the coach's library is (LIB-003). It is
/// the library grant MED-002 names, built for the house alone: a coach's client still reads no library, and nobody
/// writes to the pool through it.
/// </summary>
public interface IExercisePoolService
{
    /// <returns>Null when the caller is no current client of the house, so the route answers as missing.</returns>
    Task<ExercisePoolPage?> SearchAsync(ExercisePoolSearchRequest request, CancellationToken cancellationToken);

    /// <returns>
    /// Null when the caller is no current client of the house, or when, with Training open, the exercise is not in the
    /// pool: another workspace's, archived, or none.
    /// </returns>
    Task<ExercisePoolExerciseResult?> GetAsync(Guid exerciseId, CancellationToken cancellationToken);
}

/// <param name="MovementPatterns">Any of these patterns; none asks for every pattern.</param>
/// <param name="TypeName">Only exercises of type Other that carry this name of the house's own, in any case.</param>
public sealed record ExercisePoolSearchRequest(
    string? Query = null,
    ExerciseEquipment? Equipment = null,
    IReadOnlyList<MovementPattern>? MovementPatterns = null,
    MuscleGroup? Muscle = null,
    ExerciseClassification? Classification = null,
    string? TypeName = null,
    int Skip = 0,
    int Take = 50);

/// <summary>
/// A page of the pool, in the library's natural order of name. While Training is not open to the caller it says why,
/// as the Training reads do, and lists nothing.
/// </summary>
/// <param name="AccessReason">The Training decision's reason (SUB-009): Granted, or why it is locked.</param>
public sealed record ExercisePoolPage(
    bool IsAllowed,
    string AccessReason,
    int Total,
    IReadOnlyList<PoolExerciseView> Items);

/// <param name="AccessReason">The Training decision's reason (SUB-009): Granted, or why it is locked.</param>
/// <param name="Exercise">The exercise while Training is open; null otherwise.</param>
public sealed record ExercisePoolExerciseResult(
    bool IsAllowed,
    string AccessReason,
    PoolExerciseView? Exercise);

/// <summary>
/// One exercise of the pool as a trainee reads it: what it is and how it is done, never the staff's tags, swaps or
/// notes. Its demos are the ones that can be opened now, in the house's order; each opens through the media grant.
/// </summary>
/// <param name="TypeName">Other's own name; null on every other type.</param>
public sealed record PoolExerciseView(
    Guid Id,
    string Name,
    ExerciseClassification Classification,
    string? TypeName,
    ExerciseEquipment Equipment,
    MovementPattern MovementPattern,
    IReadOnlyList<ExerciseMuscleView> Muscles,
    string? Instructions,
    IReadOnlyList<PoolDemoView> Demos);

/// <summary>A demo of a pool exercise, opened with <c>POST /api/media/{assetId}/access</c>.</summary>
public sealed record PoolDemoView(Guid MediaAssetId, PoolDemoKind Kind);

/// <summary>
/// What a demo is, so a screen knows how to show it before it asks for it: a picture, a clip that plays in TB Gym,
/// or a YouTube or Vimeo video that opens on the provider's own page (MED-016).
/// </summary>
public enum PoolDemoKind
{
    Picture = 1,
    Video = 2,
    VideoLink = 3,
}
