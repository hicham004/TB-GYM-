using Microsoft.EntityFrameworkCore;
using Npgsql;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Training;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// A workout of one's own (TRN-033, notes plan N9b2): a current client of the house, while Training is open to them,
/// starts a workout with no program behind it, adds exercises in use in the house's pool, adds sets, logs them through
/// the set route a program's workout uses, and finishes it through the finish route. It is the client's own record:
/// every write is theirs, asks Training again, and stops once it is finished.
/// </summary>
internal sealed partial class TrainingApplicationService
{
    public async Task<TrainingCommandResult> StartOwnWorkoutAsync(
        StartOwnWorkoutRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var trainee = await HouseTraineeAsync(cancellationToken);
        if (trainee is null)
        {
            return NotFound();
        }

        var (client, access) = trainee.Value;
        if (!access.IsAllowed)
        {
            return new TrainingCommandResult(TrainingCommandStatus.Forbidden);
        }

        if (await dbContext.WorkoutExecutions.AsNoTracking().AnyAsync(
                item => item.ClientProfileId == client.Id &&
                        item.TrainingSessionId == null &&
                        item.Status == WorkoutExecutionStatus.InProgress,
                cancellationToken))
        {
            return OwnWorkoutInProgress();
        }

        // Ten a house day at most (OwnWorkoutRule): with one unfinished at a time, the count cannot be raced past.
        var today = await GetTenantTodayAsync(cancellationToken);
        if (await dbContext.WorkoutExecutions.AsNoTracking().CountAsync(
                item => item.ClientProfileId == client.Id &&
                        item.TrainingSessionId == null &&
                        item.ScheduledDateSnapshot == today,
                cancellationToken) >= OwnWorkoutRule.MaximumStartedPerDay)
        {
            return Conflict(
                "own_workout_daily_limit",
                $"You have started {OwnWorkoutRule.MaximumStartedPerDay} workouts today, the most one day holds. Start the next one tomorrow.");
        }

        var execution = WorkoutExecution.StartOwn(tenantContext.TenantId, client.Id, today, clock.UtcNow);
        if (request.FromWorkoutId is { } fromWorkoutId)
        {
            var source = await dbContext.WorkoutExecutions.AsNoTracking()
                .Include(item => item.Exercises).ThenInclude(item => item.Sets)
                .AsSplitQuery()
                .SingleOrDefaultAsync(
                    item => item.Id == fromWorkoutId &&
                            item.ClientProfileId == client.Id &&
                            item.Status == WorkoutExecutionStatus.Completed,
                    cancellationToken);
            if (source is null)
            {
                return NotFound();
            }

            // A workout finished with nothing in it (TRN-033 allows that) has nothing to start from.
            if (source.Exercises.Count == 0)
            {
                return Conflict("own_workout_nothing_to_copy", "That workout has no exercises to start from.");
            }

            // The lifts done there, as the pool names them now; one that left the pool stays out (LIB-004).
            var sourceIds = source.Exercises.Select(item => item.ActualExerciseId).Distinct().ToArray();
            var inPool = await HousePool.InUse(dbContext)
                .Where(item => sourceIds.Contains(item.Id))
                .ToDictionaryAsync(item => item.Id, item => item.Name, cancellationToken);
            foreach (var exercise in source.Exercises
                         .Where(item => inPool.ContainsKey(item.ActualExerciseId))
                         .OrderBy(item => item.Position)
                         .ThenBy(item => item.Id)
                         .Take(OwnWorkoutRule.MaximumExercises))
            {
                execution.AddOwnExercise(
                    exercise.ActualExerciseId,
                    inPool[exercise.ActualExerciseId],
                    OwnWorkoutRule.SetsCarriedOver(exercise.Sets.Count(set => set.IsCompleted)));
            }

            if (execution.Exercises.Count == 0)
            {
                return Conflict(
                    "own_workout_nothing_to_copy",
                    "None of that workout's exercises is in the exercise pool now.");
            }
        }

        dbContext.WorkoutExecutions.Add(execution);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (IsUniqueViolation(exception))
        {
            // Another start won the one unfinished workout of one's own (UX_WorkoutExecutions_OneOwnInProgress).
            return OwnWorkoutInProgress();
        }

        return SuccessOwn(await ReadOwnWorkoutAsync(execution, cancellationToken));
    }

    public async Task<TrainingCommandResult> AddOwnWorkoutExerciseAsync(
        Guid workoutExecutionId,
        AddOwnWorkoutExerciseRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var execution = await LoadOwnExecutionAsync(workoutExecutionId, cancellationToken);
        if (execution is null)
        {
            return NotFound();
        }

        if (await OwnWorkoutRefusalAsync(execution, cancellationToken) is { } refusal)
        {
            return refusal;
        }

        var exerciseName = await HousePool.IsOpenHereAsync(dbContext, tenantContext.TenantId, cancellationToken)
            ? await HousePool.InUse(dbContext)
                .Where(item => item.Id == request.ExerciseId)
                .Select(item => item.Name)
                .SingleOrDefaultAsync(cancellationToken)
            : null;
        if (exerciseName is null)
        {
            return NotFound();
        }

        return await ChangeOwnWorkoutAsync(
            execution,
            request.Version,
            () => TrackOwnAsAdded(execution.AddOwnExercise(request.ExerciseId, exerciseName)),
            cancellationToken);
    }

    public async Task<TrainingCommandResult> RemoveOwnWorkoutExerciseAsync(
        Guid workoutExecutionId,
        Guid exercisePerformanceId,
        OwnWorkoutChangeRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var execution = await LoadOwnExecutionAsync(workoutExecutionId, cancellationToken);
        if (execution is null)
        {
            return NotFound();
        }

        if (await OwnWorkoutRefusalAsync(execution, cancellationToken) is { } refusal)
        {
            return refusal;
        }

        if (execution.Exercises.All(item => item.Id != exercisePerformanceId))
        {
            return NotFound();
        }

        // A note is append-only and holds its exercise (TRN-009), so an exercise with one stays.
        if (await dbContext.WorkoutNotes.AsNoTracking().AnyAsync(
                item => item.WorkoutExercisePerformanceId == exercisePerformanceId,
                cancellationToken))
        {
            return Conflict("own_exercise_has_note", "This exercise has a note, so it stays in this workout.");
        }

        return await ChangeOwnWorkoutAsync(
            execution,
            request.Version,
            () => dbContext.Remove(execution.RemoveOwnExercise(exercisePerformanceId)),
            cancellationToken);
    }

    public async Task<TrainingCommandResult> AddOwnWorkoutSetAsync(
        Guid workoutExecutionId,
        Guid exercisePerformanceId,
        OwnWorkoutChangeRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var execution = await LoadOwnExecutionAsync(workoutExecutionId, cancellationToken);
        if (execution is null)
        {
            return NotFound();
        }

        return await OwnWorkoutRefusalAsync(execution, cancellationToken) is { } refusal
            ? refusal
            : await ChangeOwnWorkoutAsync(
                execution,
                request.Version,
                () => TrackOwnAsAdded(execution.AddOwnSet(exercisePerformanceId)),
                cancellationToken);
    }

    public async Task<TrainingCommandResult> RemoveOwnWorkoutSetAsync(
        Guid workoutExecutionId,
        Guid setPerformanceId,
        OwnWorkoutChangeRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var execution = await LoadOwnExecutionAsync(workoutExecutionId, cancellationToken);
        if (execution is null)
        {
            return NotFound();
        }

        return await OwnWorkoutRefusalAsync(execution, cancellationToken) is { } refusal
            ? refusal
            : await ChangeOwnWorkoutAsync(
                execution,
                request.Version,
                () => dbContext.Remove(execution.RemoveOwnSet(setPerformanceId)),
                cancellationToken);
    }

    /// <summary>
    /// The client's unfinished workout of their own, whichever day it was started (TRN-033), for Today's "Carry on";
    /// one query when there is none.
    /// </summary>
    private async Task<OwnWorkoutView?> ReadUnfinishedOwnWorkoutAsync(
        Guid clientProfileId,
        CancellationToken cancellationToken)
    {
        var id = await dbContext.WorkoutExecutions.AsNoTracking()
            .Where(item => item.ClientProfileId == clientProfileId &&
                           item.TrainingSessionId == null &&
                           item.Status == WorkoutExecutionStatus.InProgress)
            .Select(item => (Guid?)item.Id)
            .SingleOrDefaultAsync(cancellationToken);
        if (id is null)
        {
            return null;
        }

        var execution = await dbContext.WorkoutExecutions.AsNoTracking()
            .Include(item => item.Exercises).ThenInclude(item => item.Sets)
            .AsSplitQuery()
            .SingleOrDefaultAsync(item => item.Id == id.Value, cancellationToken);
        return execution is null ? null : await ReadOwnWorkoutAsync(execution, cancellationToken);
    }

    /// <summary>
    /// The signed-in client of the house and their Training decision, or null when the workspace in scope is not the
    /// house, or not active, or the caller is no current client of it: the pool's own reader (N9b1, LIB-006).
    /// </summary>
    private async Task<(ClientProfile Client, FeatureAccessDecision Access)?> HouseTraineeAsync(
        CancellationToken cancellationToken)
    {
        if (!tenantContext.HasTenant ||
            !await HousePool.IsOpenHereAsync(dbContext, tenantContext.TenantId, cancellationToken))
        {
            return null;
        }

        var client = await FindSelfClientAsync(cancellationToken);
        return client is null ? null : (client, await GetTrainingAccessAsync(client.Id, cancellationToken));
    }

    /// <summary>
    /// Why the signed-in client may not change this workout as one of their own: another client's answers as a missing
    /// one and their own is refused while Training is closed (as every workout write is), then a program's workout, then
    /// a finished one.
    /// </summary>
    private async Task<TrainingCommandResult?> OwnWorkoutRefusalAsync(
        WorkoutExecution execution,
        CancellationToken cancellationToken)
    {
        if (await ClientExecutionRefusalAsync(execution, cancellationToken) is { } refusal)
        {
            return refusal;
        }

        if (!execution.IsOwn)
        {
            return Conflict(OwnWorkoutConflictException.NotOwnCode, OwnWorkoutConflictException.NotOwnMessage);
        }

        return execution.Status == WorkoutExecutionStatus.Completed
            ? Conflict("workout_immutable", "Completed workout history is immutable.")
            : null;
    }

    private async Task<TrainingCommandResult> ChangeOwnWorkoutAsync(
        WorkoutExecution execution,
        uint version,
        Action change,
        CancellationToken cancellationToken)
    {
        try
        {
            dbContext.Entry(execution).Property(item => item.Version).OriginalValue = version;
            change();
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (OwnWorkoutConflictException exception)
        {
            return Conflict(exception.Code, exception.PersonMessage());
        }
        catch (ArgumentException)
        {
            // The exercise or set named is not this workout's.
            return NotFound();
        }
        catch (DbUpdateConcurrencyException)
        {
            return ConcurrencyConflict();
        }
        catch (DbUpdateException exception) when (IsUniqueViolation(exception))
        {
            // Another change took the same place in the workout first.
            return ConcurrencyConflict();
        }
        catch (DbUpdateException exception) when (IsForeignKeyViolation(exception))
        {
            // A note written on the exercise meanwhile holds it (TRN-009), or the exercise a set was added to left first.
            return exception.InnerException is PostgresException { TableName: "WorkoutNotes" }
                ? Conflict("own_exercise_has_note", "This exercise has a note, so it stays in this workout.")
                : ConcurrencyConflict();
        }
        catch (Exception exception) when (IsWorkoutGuardRefusal(exception))
        {
            // The workout was finished by another request between the read and this write.
            return ConcurrencyConflict();
        }
        catch (InvalidOperationException exception)
        {
            return Conflict("workout_immutable", exception.PersonMessage());
        }

        return SuccessOwn(await ReadOwnWorkoutAsync(execution, cancellationToken));
    }

    private async Task<TrainingCommandResult> CompleteOwnWorkoutAsync(
        WorkoutExecution execution,
        uint version,
        CancellationToken cancellationToken)
    {
        try
        {
            dbContext.Entry(execution).Property(item => item.Version).OriginalValue = version;
            execution.Complete(clock.UtcNow);
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return ConcurrencyConflict();
        }
        catch (Exception exception) when (IsWorkoutGuardRefusal(exception))
        {
            return ConcurrencyConflict();
        }
        catch (InvalidOperationException exception)
        {
            return Conflict("workout_immutable", exception.PersonMessage());
        }

        // Its records count as a program's workout's do (TRN-019), so the finish summary is the share card's source too.
        return SuccessWorkout(execution, await BuildFinishSummaryAsync(execution, cancellationToken));
    }

    private async Task<WorkoutExecution?> LoadOwnExecutionAsync(Guid id, CancellationToken cancellationToken) =>
        await dbContext.WorkoutExecutions
            .Include(item => item.Exercises).ThenInclude(item => item.Sets)
            .AsSplitQuery()
            .SingleOrDefaultAsync(item => item.Id == id, cancellationToken);

    private async Task<OwnWorkoutView> ReadOwnWorkoutAsync(
        WorkoutExecution execution,
        CancellationToken cancellationToken)
    {
        var exerciseIds = execution.Exercises.Select(item => item.ActualExerciseId).Distinct().ToArray();
        var demos = exerciseIds.Length == 0
            ? Array.Empty<PoolDemo>().ToLookup(item => item.ExerciseId)
            : await HousePool.DemosAsync(dbContext, exerciseIds, cancellationToken);
        var previous = exerciseIds.Length == 0
            ? new Dictionary<Guid, PreviousExercisePerformanceView>()
            : await LoadPreviousPerformancesAsync(
                execution.ClientProfileId,
                execution.ScheduledDateSnapshot,
                exerciseIds,
                cancellationToken);
        var notes = await dbContext.WorkoutNotes.AsNoTracking()
            .Where(item => item.WorkoutExecutionId == execution.Id)
            .OrderBy(item => item.CreatedAtUtc)
            .ThenBy(item => item.Id)
            .ToListAsync(cancellationToken);
        return new OwnWorkoutView(
            execution.Id,
            execution.SessionNameSnapshot,
            execution.ScheduledDateSnapshot,
            execution.Status,
            execution.StartedAtUtc,
            execution.CompletedAtUtc,
            execution.Version,
            [
                .. execution.Exercises
                    .OrderBy(item => item.Position)
                    .ThenBy(item => item.Id)
                    .Select(exercise => new OwnWorkoutExerciseView(
                        exercise.Id,
                        exercise.ActualExerciseId,
                        exercise.ActualExerciseName,
                        exercise.Position,
                        [.. demos[exercise.ActualExerciseId].Select(demo => demo.MediaAssetId)],
                        previous.GetValueOrDefault(exercise.ActualExerciseId),
                        [
                            .. exercise.Sets.OrderBy(set => set.Position).Select(set => new OwnWorkoutSetView(
                                set.Id,
                                set.Position,
                                set.ActualRepetitions,
                                set.ActualLoad,
                                set.ActualLoadUnit,
                                set.ActualRpe,
                                set.ActualRpe is null ? null : TrainingExertion.RirFromRpe(set.ActualRpe.Value),
                                set.IsCompleted,
                                set.ClientNote)),
                        ])),
            ],
            [.. notes.Select(ToView)]);
    }

    private void TrackOwnAsAdded(WorkoutExercisePerformance exercise)
    {
        dbContext.Entry(exercise).State = EntityState.Added;
        foreach (var set in exercise.Sets)
        {
            dbContext.Entry(set).State = EntityState.Added;
        }
    }

    private void TrackOwnAsAdded(WorkoutSetPerformance set) => dbContext.Entry(set).State = EntityState.Added;

    /// <summary>
    /// A workout trigger's refusal (SQLSTATE 55000), which the context's retrying strategy runs again before it gives
    /// up: here only when another request finished the workout between the read and the write.
    /// </summary>
    private static bool IsWorkoutGuardRefusal(Exception exception)
    {
        for (var current = exception; current is not null; current = current.InnerException)
        {
            if (current is PostgresException { SqlState: PostgresErrorCodes.ObjectNotInPrerequisiteState })
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>
    /// A foreign key refused the write: 23503 for a row naming one that is gone, 23001 for deleting a row an
    /// <c>ON DELETE RESTRICT</c> key still names (a note holding its exercise).
    /// </summary>
    private static bool IsForeignKeyViolation(DbUpdateException exception) =>
        exception.InnerException is PostgresException
        {
            SqlState: PostgresErrorCodes.ForeignKeyViolation or PostgresErrorCodes.RestrictViolation,
        };

    private static TrainingCommandResult OwnWorkoutInProgress() =>
        Conflict(
            "own_workout_in_progress",
            "You have a workout you have not finished. Carry on with it, or finish it first.");

    private static TrainingCommandResult SuccessOwn(OwnWorkoutView view) =>
        new(TrainingCommandStatus.Success, OwnWorkout: view);
}
