using Microsoft.EntityFrameworkCore;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Strength;
using TB.Gym.Modules.Tenancy;
using TB.Gym.Modules.Training;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

internal sealed partial class TrainingApplicationService
{
    public async Task<ClientTrainingDayResult> GetTodayAsync(CancellationToken cancellationToken)
    {
        var client = await FindSelfClientAsync(cancellationToken);
        var today = await GetTenantTodayAsync(cancellationToken);
        if (client is null)
        {
            return new ClientTrainingDayResult(false, FeatureAccessReason.MembershipInactive.ToString(), today, []);
        }

        var access = await GetTrainingAccessAsync(client.Id, cancellationToken);
        if (!access.IsAllowed)
        {
            return new ClientTrainingDayResult(false, access.Reason.ToString(), today, []);
        }

        var schedule = await (
            from session in dbContext.TrainingSessions.AsNoTracking()
            join week in dbContext.MesocycleWeeks.AsNoTracking()
                on new { session.TenantId, Id = session.MesocycleWeekId }
                equals new { week.TenantId, week.Id }
            join mesocycle in dbContext.TrainingMesocycles.AsNoTracking()
                on new { week.TenantId, Id = week.MesocycleId }
                equals new { mesocycle.TenantId, mesocycle.Id }
            where mesocycle.ClientProfileId == client.Id &&
                  mesocycle.Status != MesocycleStatus.Cancelled &&
                  mesocycle.StartDate <= today &&
                  mesocycle.EndDateExclusive > today &&
                  week.IsPublished &&
                  session.ScheduledDate == today
            orderby session.Position
            select new TodayScheduleRow(mesocycle.Id, session.Id))
            .ToListAsync(cancellationToken);
        if (schedule.Count == 0)
        {
            return new ClientTrainingDayResult(true, access.Reason.ToString(), today, []);
        }

        var sessionIds = schedule.Select(item => item.SessionId).ToArray();
        var sessions = await dbContext.TrainingSessions.AsNoTracking()
            .Where(item => sessionIds.Contains(item.Id))
            .Include(item => item.Exercises).ThenInclude(item => item.Sets)
            .Include(item => item.Exercises).ThenInclude(item => item.Alternatives)
            .Include(item => item.Exercises).ThenInclude(item => item.Media)
            .AsSplitQuery()
            .ToDictionaryAsync(item => item.Id, cancellationToken);
        var scheduled = schedule
            .Where(item => sessions.ContainsKey(item.SessionId))
            .Select(item => new ScheduledSession(item.MesocycleId, sessions[item.SessionId]))
            .ToArray();
        var executions = await dbContext.WorkoutExecutions.AsNoTracking()
            .Where(item => sessionIds.Contains(item.TrainingSessionId))
            .Include(item => item.Exercises).ThenInclude(item => item.Sets)
            .Include(item => item.Exercises).ThenInclude(item => item.ApprovedAlternatives)
            .Include(item => item.Exercises).ThenInclude(item => item.Media)
            .AsSplitQuery()
            .ToDictionaryAsync(item => item.TrainingSessionId, cancellationToken);
        var executionIds = executions.Values.Select(item => item.Id).ToArray();
        var notes = await dbContext.WorkoutNotes.AsNoTracking()
            .Where(item => executionIds.Contains(item.WorkoutExecutionId))
            .OrderBy(item => item.CreatedAtUtc)
            .ToListAsync(cancellationToken);

        var exerciseIds = scheduled.SelectMany(item => item.Session.Exercises)
            .SelectMany(item => item.Alternatives.Select(alternative => alternative.ExerciseId).Append(item.ExerciseId))
            .Concat(executions.Values.SelectMany(item => item.Exercises).SelectMany(item =>
                item.ApprovedAlternatives.Select(alternative => alternative.ExerciseId)
                    .Append(item.ActualExerciseId)
                    .Append(item.PrescribedExerciseId)))
            .Distinct()
            .ToArray();
        var exerciseNames = await dbContext.Exercises.AsNoTracking()
            .Where(item => exerciseIds.Contains(item.Id))
            .ToDictionaryAsync(item => item.Id, item => item.Name, cancellationToken);
        var previous = await LoadPreviousPerformancesAsync(client.Id, today, exerciseIds, cancellationToken);

        var workouts = scheduled.Select(item =>
        {
            executions.TryGetValue(item.Session.Id, out var execution);
            return execution is null
                ? ToClientWorkout(item.MesocycleId, item.Session, exerciseNames, previous)
                : ToClientWorkout(
                    item.MesocycleId,
                    item.Session,
                    execution,
                    notes.Where(note => note.WorkoutExecutionId == execution.Id).ToArray(),
                    exerciseNames,
                    previous);
        }).ToArray();
        return new ClientTrainingDayResult(true, access.Reason.ToString(), today, workouts);
    }

    public async Task<TrainingCommandResult> StartWorkoutAsync(
        Guid sessionId,
        CancellationToken cancellationToken)
    {
        var client = await FindSelfClientAsync(cancellationToken);
        if (client is null)
        {
            return NotFound();
        }

        var access = await GetTrainingAccessAsync(client.Id, cancellationToken);
        if (!access.IsAllowed)
        {
            return new TrainingCommandResult(TrainingCommandStatus.Forbidden);
        }

        var mesocycle = await LoadMesocycleBySessionAsync(sessionId, cancellationToken);
        if (mesocycle is null || mesocycle.ClientProfileId != client.Id)
        {
            return NotFound();
        }

        var week = mesocycle.Weeks.Single(item => item.Sessions.Any(session => session.Id == sessionId));
        var session = week.Sessions.Single(item => item.Id == sessionId);
        var today = await GetTenantTodayAsync(cancellationToken);
        if (mesocycle.GetEffectiveStatus(clock.UtcNow) != MesocycleStatus.Active)
        {
            return Conflict("mesocycle_not_active", "Only an active mesocycle can start a workout.");
        }

        if (session.ScheduledDate > today)
        {
            return new TrainingCommandResult(TrainingCommandStatus.Forbidden);
        }

        var availability = TrainingCalendarPolicy.GetWeekAvailability(
            mesocycle.StartDate,
            week.WeekNumber,
            mesocycle.TimeZoneId,
            clock.UtcNow,
            mesocycle.RevealAllWeeks,
            week.IsPublished);
        if (!availability.IsVisible)
        {
            return new TrainingCommandResult(TrainingCommandStatus.Forbidden);
        }

        var existing = await dbContext.WorkoutExecutions.AsNoTracking().SingleOrDefaultAsync(
            item => item.TrainingSessionId == sessionId,
            cancellationToken);
        if (existing is not null)
        {
            return SuccessWorkout(existing);
        }

        try
        {
            var execution = WorkoutExecution.Start(
                tenantContext.TenantId,
                client.Id,
                mesocycle.Id,
                session,
                clock.UtcNow);
            mesocycle.MarkSessionStarted(session.Id);
            dbContext.WorkoutExecutions.Add(execution);
            await dbContext.SaveChangesAsync(cancellationToken);
            return SuccessWorkout(execution);
        }
        catch (InvalidOperationException exception)
        {
            return Conflict("workout_start_conflict", exception.Message);
        }
        catch (DbUpdateException)
        {
            var concurrent = await dbContext.WorkoutExecutions.AsNoTracking().SingleOrDefaultAsync(
                item => item.TrainingSessionId == sessionId,
                cancellationToken);
            return concurrent is null
                ? Conflict("workout_start_conflict", "The workout could not be started.")
                : SuccessWorkout(concurrent);
        }
    }

    public async Task<TrainingCommandResult> RecordSetActualAsync(
        Guid workoutExecutionId,
        Guid setPerformanceId,
        RecordSetActualRequest request,
        CancellationToken cancellationToken)
    {
        var execution = await LoadExecutionAsync(workoutExecutionId, tracking: true, cancellationToken);
        if (execution is null)
        {
            return NotFound();
        }

        if (!await CanCurrentClientUseExecutionAsync(execution, cancellationToken))
        {
            return new TrainingCommandResult(TrainingCommandStatus.Forbidden);
        }

        try
        {
            var canonicalRpe = CanonicalRpe(request.Rpe, request.Rir);
            dbContext.Entry(execution).Property(item => item.Version).OriginalValue = request.Version;
            execution.RecordSetActual(
                setPerformanceId,
                request.Repetitions,
                request.Load,
                request.LoadUnit,
                canonicalRpe,
                request.IsCompleted,
                request.ClientNote);
            await dbContext.SaveChangesAsync(cancellationToken);
            var saved = execution.Exercises.SelectMany(item => item.Sets)
                .Single(item => item.Id == setPerformanceId);
            return SuccessSet(execution, saved);
        }
        catch (ArgumentException exception)
        {
            return Invalid("set", exception.Message);
        }
        catch (InvalidOperationException exception)
        {
            return Conflict("workout_immutable", exception.Message);
        }
        catch (DbUpdateConcurrencyException)
        {
            return ConcurrencyConflict();
        }
    }

    public async Task<TrainingCommandResult> SubstituteExerciseAsync(
        Guid workoutExecutionId,
        Guid exercisePerformanceId,
        SubstituteExerciseRequest request,
        CancellationToken cancellationToken)
    {
        var execution = await LoadExecutionAsync(workoutExecutionId, tracking: true, cancellationToken);
        if (execution is null)
        {
            return NotFound();
        }

        if (!await CanCurrentClientUseExecutionAsync(execution, cancellationToken))
        {
            return new TrainingCommandResult(TrainingCommandStatus.Forbidden);
        }

        var exerciseName = await dbContext.Exercises.AsNoTracking()
            .Where(item => item.Id == request.ExerciseId)
            .Select(item => item.Name)
            .SingleOrDefaultAsync(cancellationToken);
        if (exerciseName is null)
        {
            return NotFound();
        }

        try
        {
            dbContext.Entry(execution).Property(item => item.Version).OriginalValue = request.Version;
            execution.SelectActuallyPerformedExercise(
                exercisePerformanceId,
                request.ExerciseId,
                exerciseName);
            await dbContext.SaveChangesAsync(cancellationToken);
            return SuccessWorkout(execution);
        }
        catch (InvalidOperationException exception)
        {
            return Conflict("substitution_not_allowed", exception.Message);
        }
        catch (DbUpdateConcurrencyException)
        {
            return ConcurrencyConflict();
        }
    }

    public async Task<TrainingCommandResult> CompleteWorkoutAsync(
        Guid workoutExecutionId,
        CompleteWorkoutRequest request,
        CancellationToken cancellationToken)
    {
        var execution = await LoadExecutionAsync(workoutExecutionId, tracking: true, cancellationToken);
        if (execution is null)
        {
            return NotFound();
        }

        if (!await CanCurrentClientUseExecutionAsync(execution, cancellationToken))
        {
            return new TrainingCommandResult(TrainingCommandStatus.Forbidden);
        }

        var mesocycle = await LoadMesocycleBySessionAsync(execution.TrainingSessionId, cancellationToken);
        if (mesocycle is null)
        {
            return Conflict("workout_state_conflict", "The workout session is unavailable.");
        }

        try
        {
            dbContext.Entry(execution).Property(item => item.Version).OriginalValue = request.Version;
            execution.Complete(clock.UtcNow);
            var mesocycleCompleted = mesocycle.MarkSessionCompleted(
                execution.TrainingSessionId,
                clock.UtcNow);
            if (mesocycleCompleted)
            {
                dbContext.MesocycleLifecycleEvents.Add(MesocycleLifecycleEvent.Record(
                    tenantContext.TenantId,
                    mesocycle.Id,
                    MesocycleLifecycleEventType.Completed,
                    MesocycleStatus.Active,
                    MesocycleStatus.Completed,
                    "All programmed sessions were completed.",
                    clock.UtcNow));
            }
            await dbContext.SaveChangesAsync(cancellationToken);
            return SuccessWorkout(execution);
        }
        catch (InvalidOperationException exception)
        {
            return Conflict("workout_immutable", exception.Message);
        }
        catch (DbUpdateConcurrencyException)
        {
            return ConcurrencyConflict();
        }
    }

    public async Task<TrainingCommandResult> AddWorkoutNoteAsync(
        Guid workoutExecutionId,
        AddWorkoutNoteRequest request,
        CancellationToken cancellationToken)
    {
        if (currentUser.UserId is not { } userId)
        {
            return NotFound();
        }

        var execution = await LoadExecutionAsync(workoutExecutionId, tracking: false, cancellationToken);
        if (execution is null)
        {
            return NotFound();
        }

        var role = await dbContext.TenantMemberships.AsNoTracking()
            .Where(item =>
                item.TenantId == tenantContext.TenantId &&
                item.UserId == userId &&
                item.Status == MembershipStatus.Active)
            .Select(item => (TenantRole?)item.Role)
            .SingleOrDefaultAsync(cancellationToken);
        var authorRole = role switch
        {
            TenantRole.Owner or TenantRole.Coach => WorkoutNoteAuthorRole.Coach,
            TenantRole.Client when await CanCurrentClientUseExecutionAsync(execution, cancellationToken) => WorkoutNoteAuthorRole.Client,
            _ => (WorkoutNoteAuthorRole?)null,
        };
        if (authorRole is null)
        {
            return new TrainingCommandResult(TrainingCommandStatus.Forbidden);
        }

        if (request.ExercisePerformanceId is { } performanceId &&
            execution.Exercises.All(item => item.Id != performanceId))
        {
            return Invalid("exercisePerformanceId", "The exercise does not belong to this workout.");
        }

        try
        {
            dbContext.WorkoutNotes.Add(WorkoutNote.Create(
                tenantContext.TenantId,
                execution.Id,
                request.ExercisePerformanceId,
                userId,
                authorRole.Value,
                request.Text));
            await dbContext.SaveChangesAsync(cancellationToken);
            return SuccessWorkout(execution);
        }
        catch (ArgumentException exception)
        {
            return Invalid("note", exception.Message);
        }
    }

    public async Task<ExerciseHistoryPage?> GetExerciseHistoryAsync(
        Guid clientProfileId,
        Guid exerciseId,
        int skip,
        int take,
        CancellationToken cancellationToken)
    {
        if (!await dbContext.ClientProfiles.AsNoTracking()
                .AnyAsync(item => item.Id == clientProfileId, cancellationToken))
        {
            return null;
        }

        var query =
            from set in dbContext.WorkoutSetPerformances.AsNoTracking()
            join performance in dbContext.WorkoutExercisePerformances.AsNoTracking()
                on new { set.TenantId, Id = set.WorkoutExercisePerformanceId }
                equals new { performance.TenantId, performance.Id }
            join execution in dbContext.WorkoutExecutions.AsNoTracking()
                on new { performance.TenantId, Id = performance.WorkoutExecutionId }
                equals new { execution.TenantId, execution.Id }
            where execution.ClientProfileId == clientProfileId &&
                  execution.Status == WorkoutExecutionStatus.Completed &&
                  (performance.PrescribedExerciseId == exerciseId || performance.ActualExerciseId == exerciseId) &&
                  set.IsCompleted &&
                  (set.ActualLoad != null || set.ActualRepetitions != null)
            select new { Execution = execution, Performance = performance, Set = set };
        var total = await query.CountAsync(cancellationToken);
        var rows = await query
            .OrderByDescending(item => item.Execution.ScheduledDateSnapshot)
            .ThenByDescending(item => item.Execution.Id)
            .ThenBy(item => item.Set.Position)
            .Skip(skip)
            .Take(take)
            .ToListAsync(cancellationToken);
        var estimator = new EpleyOneRepMaxEstimator();
        var items = rows.Select(item =>
        {
            decimal? estimate = null;
            if (item.Set.ActualLoad is { } load && item.Set.ActualRepetitions is >= 1 and <= 12)
            {
                estimate = estimator.Estimate(load, item.Set.ActualRepetitions.Value);
            }

            return new ExerciseHistoryItem(
                item.Execution.Id,
                item.Execution.ScheduledDateSnapshot,
                item.Performance.PrescribedExerciseId,
                item.Performance.ActualExerciseId,
                item.Performance.WasSubstituted,
                item.Set.ActualRepetitions,
                item.Set.ActualLoad,
                item.Set.ActualLoadUnit,
                item.Set.ActualRpe,
                item.Set.ActualRpe is null ? null : TrainingExertion.RirFromRpe(item.Set.ActualRpe.Value),
                estimate,
                item.Set.ActualLoad is not null && item.Set.ActualRepetitions is not null
                    ? item.Set.ActualLoad * item.Set.ActualRepetitions
                    : null,
                item.Set.ClientNote);
        }).ToArray();
        return new ExerciseHistoryPage(total, skip, take, items);
    }

    private async Task<ClientProfile?> FindSelfClientAsync(CancellationToken cancellationToken) =>
        currentUser.UserId is not { } userId
            ? null
            : await dbContext.ClientProfiles.SingleOrDefaultAsync(item => item.UserId == userId, cancellationToken);

    private Task<FeatureAccessDecision> GetTrainingAccessAsync(
        Guid clientProfileId,
        CancellationToken cancellationToken) =>
        featureAccessService.EvaluateAsync(
            tenantContext.TenantId,
            clientProfileId,
            CoachingFeature.Training,
            cancellationToken);

    private async Task<bool> CanCurrentClientUseExecutionAsync(
        WorkoutExecution execution,
        CancellationToken cancellationToken)
    {
        var client = await FindSelfClientAsync(cancellationToken);
        return client?.Id == execution.ClientProfileId &&
            (await GetTrainingAccessAsync(client.Id, cancellationToken)).IsAllowed;
    }

    private async Task<TrainingMesocycle?> LoadMesocycleBySessionAsync(
        Guid sessionId,
        CancellationToken cancellationToken)
    {
        var mesocycleId = await (
            from session in dbContext.TrainingSessions.AsNoTracking()
            join week in dbContext.MesocycleWeeks.AsNoTracking()
                on new { session.TenantId, Id = session.MesocycleWeekId }
                equals new { week.TenantId, week.Id }
            where session.Id == sessionId
            select (Guid?)week.MesocycleId)
            .SingleOrDefaultAsync(cancellationToken);
        return mesocycleId is null
            ? null
            : await LoadMesocycleAsync(mesocycleId.Value, tracking: true, cancellationToken);
    }

    private async Task<WorkoutExecution?> LoadExecutionAsync(
        Guid id,
        bool tracking,
        CancellationToken cancellationToken)
    {
        var query = dbContext.WorkoutExecutions
            .Include(item => item.Exercises).ThenInclude(item => item.Sets)
            .Include(item => item.Exercises).ThenInclude(item => item.ApprovedAlternatives)
            .Include(item => item.Exercises).ThenInclude(item => item.Media)
            .AsSplitQuery();
        return tracking
            ? await query.SingleOrDefaultAsync(item => item.Id == id, cancellationToken)
            : await query.AsNoTracking().SingleOrDefaultAsync(item => item.Id == id, cancellationToken);
    }

    private async Task<IReadOnlyDictionary<Guid, PreviousExercisePerformanceView>> LoadPreviousPerformancesAsync(
        Guid clientProfileId,
        DateOnly beforeDate,
        IReadOnlyList<Guid> exerciseIds,
        CancellationToken cancellationToken)
    {
        var candidates =
            from performance in dbContext.WorkoutExercisePerformances.AsNoTracking()
            join execution in dbContext.WorkoutExecutions.AsNoTracking()
                on new { performance.TenantId, Id = performance.WorkoutExecutionId }
                equals new { execution.TenantId, execution.Id }
            where execution.ClientProfileId == clientProfileId &&
                  execution.Status == WorkoutExecutionStatus.Completed &&
                  execution.ScheduledDateSnapshot < beforeDate &&
                  exerciseIds.Contains(performance.ActualExerciseId)
            select new { Performance = performance, Execution = execution };
        var latestDates =
            from item in candidates
            group item by item.Performance.ActualExerciseId
            into grouped
            select new
            {
                ExerciseId = grouped.Key,
                Date = grouped.Max(item => item.Execution.ScheduledDateSnapshot),
            };
        var rows = await (
            from item in candidates
            join latest in latestDates
                on new
                {
                    ExerciseId = item.Performance.ActualExerciseId,
                    Date = item.Execution.ScheduledDateSnapshot,
                }
                equals new { latest.ExerciseId, latest.Date }
            let best = item.Performance.Sets
                .Where(set => set.IsCompleted && set.ActualLoad != null)
                .OrderByDescending(set => set.ActualLoad)
                .ThenByDescending(set => set.ActualRepetitions)
                .FirstOrDefault()
            where best != null
            orderby item.Execution.Id descending
            select new
            {
                item.Performance.ActualExerciseId,
                item.Execution.ScheduledDateSnapshot,
                best!.ActualLoad,
                best.ActualLoadUnit,
                best.ActualRepetitions,
                best.ActualRpe,
            })
            .ToListAsync(cancellationToken);
        return rows.GroupBy(item => item.ActualExerciseId)
            .ToDictionary(
                group => group.Key,
                group =>
                {
                    var item = group.First();
                    return new PreviousExercisePerformanceView(
                        item.ScheduledDateSnapshot,
                        item.ActualLoad,
                        item.ActualLoadUnit,
                        item.ActualRepetitions,
                        item.ActualRpe);
                });
    }

    private static ClientWorkoutView ToClientWorkout(
        Guid mesocycleId,
        TrainingSession session,
        IReadOnlyDictionary<Guid, string> names,
        IReadOnlyDictionary<Guid, PreviousExercisePerformanceView> previous) =>
        new(
            session.Id,
            mesocycleId,
            null,
            session.Name,
            session.CoachNotes,
            null,
            session.Exercises.OrderBy(item => item.Position).Select(exercise => new ClientExerciseView(
                exercise.Id,
                null,
                exercise.ExerciseId,
                exercise.ExerciseNameSnapshot,
                exercise.ExerciseId,
                exercise.ExerciseNameSnapshot,
                false,
                exercise.ModificationPolicy,
                exercise.Alternatives.Select(item => new ExerciseAlternativeOptionView(
                    item.ExerciseId,
                    names.GetValueOrDefault(item.ExerciseId, "Unavailable exercise"))).ToArray(),
                exercise.CoachNotes,
                exercise.Media.OrderBy(item => item.DisplayOrder).Select(item => item.MediaAssetId).ToArray(),
                previous.GetValueOrDefault(exercise.ExerciseId),
                exercise.Sets.OrderBy(item => item.Position).Select(ToClientSet).ToArray())).ToArray(),
            [],
            null);

    private static ClientWorkoutView ToClientWorkout(
        Guid mesocycleId,
        TrainingSession session,
        WorkoutExecution execution,
        IReadOnlyList<WorkoutNote> notes,
        IReadOnlyDictionary<Guid, string> names,
        IReadOnlyDictionary<Guid, PreviousExercisePerformanceView> previous) =>
        new(
            session.Id,
            mesocycleId,
            execution.Id,
            execution.SessionNameSnapshot,
            execution.SessionCoachNotesSnapshot,
            execution.Status,
            execution.Exercises.OrderBy(item => item.Position).Select(exercise => new ClientExerciseView(
                exercise.ExercisePrescriptionId,
                exercise.Id,
                exercise.PrescribedExerciseId,
                exercise.PrescribedExerciseName,
                exercise.ActualExerciseId,
                exercise.ActualExerciseName,
                exercise.WasSubstituted,
                exercise.ModificationPolicySnapshot,
                exercise.ApprovedAlternatives.Select(item => new ExerciseAlternativeOptionView(
                    item.ExerciseId,
                    names.GetValueOrDefault(item.ExerciseId, "Unavailable exercise"))).ToArray(),
                exercise.CoachNotesSnapshot,
                exercise.Media.OrderBy(item => item.DisplayOrder).Select(item => item.MediaAssetId).ToArray(),
                previous.GetValueOrDefault(exercise.ActualExerciseId),
                exercise.Sets.OrderBy(item => item.Position).Select(ToClientSet).ToArray())).ToArray(),
            notes.Select(ToView).ToArray(),
            execution.Version);

    private static ClientSetView ToClientSet(SetPrescription set) =>
        new(
            set.Id,
            null,
            set.Position,
            set.SetType,
            set.RepetitionsMinimum,
            set.RepetitionsMaximum,
            set.PrescribedLoad ?? set.DirectLoad,
            set.LoadUnit,
            set.TargetRpe,
            set.TargetRpe is null ? null : TrainingExertion.RirFromRpe(set.TargetRpe.Value),
            set.RestSeconds,
            set.Tempo,
            null,
            null,
            null,
            null,
            null,
            false,
            null);

    private static ClientSetView ToClientSet(WorkoutSetPerformance set) =>
        new(
            set.SetPrescriptionId,
            set.Id,
            set.Position,
            set.SetTypeSnapshot,
            set.PrescribedRepetitionsMinimum,
            set.PrescribedRepetitionsMaximum,
            set.PrescribedLoad,
            set.PrescribedLoadUnit,
            set.PrescribedTargetRpe,
            set.PrescribedTargetRpe is null ? null : TrainingExertion.RirFromRpe(set.PrescribedTargetRpe.Value),
            set.PrescribedRestSeconds,
            set.PrescribedTempo,
            set.ActualRepetitions,
            set.ActualLoad,
            set.ActualLoadUnit,
            set.ActualRpe,
            set.ActualRpe is null ? null : TrainingExertion.RirFromRpe(set.ActualRpe.Value),
            set.IsCompleted,
            set.ClientNote);

    private static WorkoutNoteView ToView(WorkoutNote note) =>
        new(
            note.Id,
            note.WorkoutExercisePerformanceId,
            note.AuthorUserId,
            note.AuthorRole,
            note.Text,
            note.CreatedAtUtc);

    private static decimal? CanonicalRpe(decimal? rpe, decimal? rir)
    {
        if (rpe is not null && rir is not null)
        {
            throw new ArgumentException("Record RPE or RIR, not both.");
        }

        return rpe is { } direct
            ? TrainingExertion.ValidateRpe(direct)
            : rir is { } reserve ? TrainingExertion.RpeFromRir(reserve) : null;
    }

    private static TrainingCommandResult SuccessWorkout(WorkoutExecution execution) =>
        new(
            TrainingCommandStatus.Success,
            WorkoutExecution: new WorkoutExecutionView(
                execution.Id,
                execution.Status,
                execution.StartedAtUtc,
                execution.CompletedAtUtc,
                execution.Version));

    private static TrainingCommandResult SuccessSet(
        WorkoutExecution execution,
        WorkoutSetPerformance set) =>
        new(
            TrainingCommandStatus.Success,
            SetSave: new WorkoutSetSaveView(
                execution.Id,
                execution.Version,
                set.Id,
                set.ActualRepetitions,
                set.ActualLoad,
                set.ActualLoadUnit,
                set.ActualRpe,
                set.ActualRpe is null ? null : TrainingExertion.RirFromRpe(set.ActualRpe.Value),
                set.IsCompleted,
                set.ClientNote));

    private sealed record TodayScheduleRow(Guid MesocycleId, Guid SessionId);

    private sealed record ScheduledSession(Guid MesocycleId, TrainingSession Session);
}
