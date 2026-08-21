using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.ExerciseLibrary;
using TB.Gym.Modules.Media;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

internal sealed class ExerciseLibraryApplicationService(
    GymDbContext dbContext,
    ITenantContext tenantContext,
    ILogger<ExerciseLibraryApplicationService> logger)
    : IExerciseLibraryApplicationService
{
    private static readonly Action<ILogger, Guid, string, Exception?> LogExerciseConcurrencyConflict =
        LoggerMessage.Define<Guid, string>(
            LogLevel.Warning,
            new EventId(3101, "ExerciseConcurrencyConflict"),
            "Concurrency conflict updating exercise {ExerciseId}; conflicted entities: {EntityTypes}");

    public async Task<ExerciseSearchResult> SearchAsync(
        ExerciseSearchRequest request,
        CancellationToken cancellationToken)
    {
        var take = Math.Clamp(request.Take, 1, 100);
        var skip = Math.Max(request.Skip, 0);
        var query = dbContext.Exercises
            .AsNoTracking()
            .Include(item => item.Muscles)
            .Include(item => item.Tags)
            .Include(item => item.Alternatives)
            .Include(item => item.Media)
            .Where(item => request.IncludeArchived || !item.IsArchived);

        if (!string.IsNullOrWhiteSpace(request.Query))
        {
            var pattern = $"%{request.Query.Trim()}%";
            query = query.Where(item =>
                EF.Functions.ILike(item.Name, pattern) ||
                item.Tags.Any(tag => EF.Functions.ILike(tag.Value, pattern)));
        }

        if (request.Equipment is { } equipment)
        {
            query = query.Where(item => item.Equipment == equipment);
        }

        if (request.MovementPattern is { } movementPattern)
        {
            query = query.Where(item => item.MovementPattern == movementPattern);
        }

        if (request.Classification is { } classification)
        {
            query = query.Where(item => item.Classification == classification);
        }

        if (request.Muscle is { } muscle)
        {
            query = query.Where(item => item.Muscles.Any(link => link.Muscle == muscle));
        }

        if (!string.IsNullOrWhiteSpace(request.Tag))
        {
            var normalizedTag = request.Tag.Trim().ToUpperInvariant();
            query = query.Where(item => item.Tags.Any(tag => tag.NormalizedValue == normalizedTag));
        }

        var total = await query.CountAsync(cancellationToken);
        var items = await query
            .OrderBy(item => item.Name)
            .Skip(skip)
            .Take(take)
            .AsSplitQuery()
            .ToListAsync(cancellationToken);
        return new ExerciseSearchResult(total, await ToViewsAsync(items, cancellationToken));
    }

    public async Task<ExerciseView?> GetAsync(Guid exerciseId, CancellationToken cancellationToken)
    {
        var exercise = await LoadAsync(exerciseId, tracking: false, cancellationToken);
        return exercise is null ? null : (await ToViewsAsync([exercise], cancellationToken))[0];
    }

    public async Task<ExerciseCommandResult> CreateAsync(
        CreateExerciseRequest request,
        CancellationToken cancellationToken)
    {
        try
        {
            await ValidateReferencesAsync(request.Alternatives, request.MediaAssetIds, cancellationToken);
            var exercise = Exercise.Create(tenantContext.TenantId, ToDefinition(request));
            dbContext.Exercises.Add(exercise);
            await dbContext.SaveChangesAsync(cancellationToken);
            return Success(await GetRequiredViewAsync(exercise.Id, cancellationToken));
        }
        catch (ArgumentException exception)
        {
            return Invalid("exercise", exception.Message);
        }
        catch (DbUpdateException exception) when (IsUniqueViolation(exception))
        {
            return Conflict("exercise_name_conflict", "An exercise with this name already exists in the workspace.");
        }
    }

    public async Task<ExerciseCommandResult> UpdateAsync(
        Guid exerciseId,
        UpdateExerciseRequest request,
        CancellationToken cancellationToken)
    {
        var exercise = await LoadAsync(exerciseId, tracking: true, cancellationToken);
        if (exercise is null)
        {
            return NotFound();
        }

        try
        {
            await ValidateReferencesAsync(request.Alternatives, request.MediaAssetIds, cancellationToken);
            dbContext.Entry(exercise).Property(item => item.Version).OriginalValue = request.Version;
            exercise.Update(ToDefinition(request));
            await dbContext.SaveChangesAsync(cancellationToken);
            return Success(await GetRequiredViewAsync(exercise.Id, cancellationToken));
        }
        catch (ArgumentException exception)
        {
            return Invalid("exercise", exception.Message);
        }
        catch (InvalidOperationException exception)
        {
            return Invalid("exercise", exception.Message);
        }
        catch (DbUpdateConcurrencyException exception)
        {
            LogExerciseConcurrencyConflict(
                logger,
                exerciseId,
                string.Join(",", exception.Entries.Select(item => item.Metadata.ClrType.Name)),
                exception);
            return Conflict("concurrency_conflict", "The exercise was changed by another request.");
        }
        catch (DbUpdateException exception) when (IsUniqueViolation(exception))
        {
            return Conflict("exercise_name_conflict", "An exercise with this name already exists in the workspace.");
        }
    }

    public async Task<ExerciseCommandResult> SetArchivedAsync(
        Guid exerciseId,
        SetExerciseArchivedRequest request,
        CancellationToken cancellationToken)
    {
        var exercise = await dbContext.Exercises.SingleOrDefaultAsync(
            item => item.Id == exerciseId,
            cancellationToken);
        if (exercise is null)
        {
            return NotFound();
        }

        try
        {
            dbContext.Entry(exercise).Property(item => item.Version).OriginalValue = request.Version;
            if (request.IsArchived)
            {
                exercise.Archive();
            }
            else
            {
                exercise.Restore();
            }

            await dbContext.SaveChangesAsync(cancellationToken);
            return Success(await GetRequiredViewAsync(exercise.Id, cancellationToken));
        }
        catch (DbUpdateConcurrencyException)
        {
            return Conflict("concurrency_conflict", "The exercise was changed by another request.");
        }
    }

    private async Task<Exercise?> LoadAsync(
        Guid exerciseId,
        bool tracking,
        CancellationToken cancellationToken)
    {
        var query = dbContext.Exercises
            .Include(item => item.Muscles)
            .Include(item => item.Tags)
            .Include(item => item.Alternatives)
            .Include(item => item.Media)
            .AsSplitQuery();
        return tracking
            ? await query.SingleOrDefaultAsync(item => item.Id == exerciseId, cancellationToken)
            : await query.AsNoTracking().SingleOrDefaultAsync(item => item.Id == exerciseId, cancellationToken);
    }

    private async Task ValidateReferencesAsync(
        IReadOnlyList<ExerciseAlternativeRequest> alternatives,
        IReadOnlyList<Guid> mediaAssetIds,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(alternatives);
        ArgumentNullException.ThrowIfNull(mediaAssetIds);
        var alternativeIds = alternatives.Select(item => item.ExerciseId).Distinct().ToArray();
        if (alternativeIds.Length > 0 &&
            await dbContext.Exercises.CountAsync(
                item => alternativeIds.Contains(item.Id) && !item.IsArchived,
                cancellationToken) != alternativeIds.Length)
        {
            throw new ArgumentException("Every alternative must be an active exercise in this workspace.");
        }

        var mediaIds = mediaAssetIds.Distinct().ToArray();
        if (mediaIds.Length > 0 &&
            await dbContext.MediaAssets.CountAsync(
                item => mediaIds.Contains(item.Id) && item.Status == MediaAssetStatus.Ready,
                cancellationToken) != mediaIds.Length)
        {
            throw new ArgumentException("Every media item must be ready and owned by this workspace.");
        }
    }

    private static ExerciseDefinition ToDefinition(CreateExerciseRequest request) =>
        new(
            request.Name,
            request.Instructions,
            request.Equipment,
            request.MovementPattern,
            request.Classification,
            request.Muscles.Select(item => new ExerciseMuscleDefinition(item.Muscle, item.Role)).ToArray(),
            request.Tags,
            request.Alternatives.Select(item => new ExerciseAlternativeDefinition(item.ExerciseId, item.Note)).ToArray(),
            request.MediaAssetIds);

    private static ExerciseDefinition ToDefinition(UpdateExerciseRequest request) =>
        new(
            request.Name,
            request.Instructions,
            request.Equipment,
            request.MovementPattern,
            request.Classification,
            request.Muscles.Select(item => new ExerciseMuscleDefinition(item.Muscle, item.Role)).ToArray(),
            request.Tags,
            request.Alternatives.Select(item => new ExerciseAlternativeDefinition(item.ExerciseId, item.Note)).ToArray(),
            request.MediaAssetIds);

    private async Task<IReadOnlyList<ExerciseView>> ToViewsAsync(
        IReadOnlyList<Exercise> exercises,
        CancellationToken cancellationToken)
    {
        var alternativeIds = exercises.SelectMany(item => item.Alternatives)
            .Select(item => item.AlternativeExerciseId)
            .Distinct()
            .ToArray();
        var names = alternativeIds.Length == 0
            ? new Dictionary<Guid, string>()
            : await dbContext.Exercises.AsNoTracking()
                .Where(item => alternativeIds.Contains(item.Id))
                .ToDictionaryAsync(item => item.Id, item => item.Name, cancellationToken);

        return exercises.Select(item => new ExerciseView(
            item.Id,
            item.Name,
            item.Instructions,
            item.Equipment,
            item.MovementPattern,
            item.Classification,
            item.IsArchived,
            item.Muscles.OrderBy(link => link.Role).ThenBy(link => link.Muscle)
                .Select(link => new ExerciseMuscleView(link.Muscle, link.Role)).ToArray(),
            item.Tags.OrderBy(link => link.Value).Select(link => link.Value).ToArray(),
            item.Alternatives.Select(link => new ExerciseAlternativeView(
                link.AlternativeExerciseId,
                names.GetValueOrDefault(link.AlternativeExerciseId, "Unavailable exercise"),
                link.Note)).ToArray(),
            item.Media.OrderBy(link => link.DisplayOrder).Select(link => link.MediaAssetId).ToArray(),
            item.Version)).ToArray();
    }

    private async Task<ExerciseView> GetRequiredViewAsync(Guid id, CancellationToken cancellationToken) =>
        await GetAsync(id, cancellationToken) ?? throw new InvalidOperationException("The exercise was not persisted.");

    private static bool IsUniqueViolation(DbUpdateException exception) =>
        exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation };

    private static ExerciseCommandResult Success(ExerciseView view) =>
        new(ExerciseCommandStatus.Success, view);

    private static ExerciseCommandResult Invalid(string field, string message) =>
        new(ExerciseCommandStatus.Invalid, Errors: new Dictionary<string, string[]> { [field] = [message] });

    private static ExerciseCommandResult NotFound() => new(ExerciseCommandStatus.NotFound);

    private static ExerciseCommandResult Conflict(string code, string message) =>
        new(ExerciseCommandStatus.Conflict, Code: code, Message: message);
}
