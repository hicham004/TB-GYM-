using Microsoft.EntityFrameworkCore;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Strength;
using TB.Gym.Modules.Tenancy;
using TB.Gym.Modules.Training;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

internal sealed partial class TrainingApplicationService
{
    public async Task<ClientPersonalRecordsResult> GetMyPersonalRecordsAsync(
        CancellationToken cancellationToken)
    {
        var client = await FindSelfClientAsync(cancellationToken);
        return client is null
            ? new ClientPersonalRecordsResult(false, FeatureAccessReason.MembershipInactive.ToString(), [])
            : await ReadPersonalRecordsAsync(
                client.Id,
                await GetTrainingAccessAsync(client.Id, cancellationToken),
                cancellationToken);
    }

    public async Task<ClientPersonalRecordsResult?> GetClientPersonalRecordsAsync(
        Guid clientProfileId,
        CancellationToken cancellationToken) =>
        await dbContext.ClientProfiles.AsNoTracking().AnyAsync(item => item.Id == clientProfileId, cancellationToken)
            ? await ReadPersonalRecordsAsync(
                clientProfileId,
                await GetCoachTrainingAccessAsync(clientProfileId, cancellationToken),
                cancellationToken)
            : null;

    /// <summary>
    /// The client's records (TRN-019) while their plan includes training: for each exercise, exact
    /// repetition count and unit, the heaviest completed load and the day it was lifted. The client
    /// and their coach read the same list by the same rule, so a record on one screen is on the other.
    /// </summary>
    private async Task<ClientPersonalRecordsResult> ReadPersonalRecordsAsync(
        Guid clientProfileId,
        FeatureAccessDecision access,
        CancellationToken cancellationToken)
    {
        if (!access.IsAllowed)
        {
            return new ClientPersonalRecordsResult(false, access.Reason.ToString(), []);
        }

        var performances =
            from set in dbContext.WorkoutSetPerformances.AsNoTracking()
            join exercise in dbContext.WorkoutExercisePerformances.AsNoTracking()
                on new { set.TenantId, Id = set.WorkoutExercisePerformanceId }
                equals new { exercise.TenantId, exercise.Id }
            join workout in dbContext.WorkoutExecutions.AsNoTracking()
                on new { exercise.TenantId, Id = exercise.WorkoutExecutionId }
                equals new { workout.TenantId, workout.Id }
            where workout.ClientProfileId == clientProfileId &&
                  workout.Status == WorkoutExecutionStatus.Completed &&
                  set.IsCompleted && set.ActualRepetitions != null &&
                  set.ActualLoad > 0 && set.ActualLoadUnit != null
            select new
            {
                ExerciseId = exercise.ActualExerciseId,
                Reps = set.ActualRepetitions!.Value,
                Load = set.ActualLoad!.Value,
                Unit = set.ActualLoadUnit!.Value,
                Date = workout.ScheduledDateSnapshot,
            };
        var best = from item in performances
                   group item by new { item.ExerciseId, item.Reps, item.Unit } into grouped
                   select new
                   {
                       grouped.Key.ExerciseId,
                       grouped.Key.Reps,
                       grouped.Key.Unit,
                       Load = grouped.Max(item => item.Load),
                   };
        var recordRows =
            from item in performances
            join record in best on new { item.ExerciseId, item.Reps, item.Unit, item.Load }
                equals new { record.ExerciseId, record.Reps, record.Unit, record.Load }
            group item by new { item.ExerciseId, item.Reps, item.Unit, item.Load } into grouped
            select new
            {
                grouped.Key.ExerciseId,
                grouped.Key.Reps,
                grouped.Key.Unit,
                grouped.Key.Load,
                Date = grouped.Max(item => item.Date),
            };
        var rows = await recordRows.OrderByDescending(item => item.Date)
            .ThenBy(item => item.ExerciseId).Take(12).ToListAsync(cancellationToken);
        var exerciseIds = rows.Select(item => item.ExerciseId).Distinct().ToArray();
        var names = await dbContext.Exercises.AsNoTracking()
            .Where(item => exerciseIds.Contains(item.Id))
            .ToDictionaryAsync(item => item.Id, item => item.Name, cancellationToken);
        var items = rows
            .Select(item => new ClientPersonalRecordView(
                item.ExerciseId, names.GetValueOrDefault(item.ExerciseId, "Exercise"),
                item.Date, item.Reps, item.Load,
                item.Unit, WorkoutPersonalRecordRule.Key, WorkoutPersonalRecordRule.Version))
            .ToArray();
        return new ClientPersonalRecordsResult(true, access.Reason.ToString(), items);
    }

    public async Task<ClientTrainingWeekView> GetMyWeekAsync(CancellationToken cancellationToken)
    {
        var today = await GetTenantTodayAsync(cancellationToken);
        var weekStartsOn = await dbContext.Tenants.AsNoTracking()
            .Where(item => item.Id == tenantContext.TenantId)
            .Select(item => item.WeekStartsOn)
            .SingleAsync(cancellationToken);
        var start = today.AddDays(-((7 + (int)today.DayOfWeek - (int)weekStartsOn) % 7));
        var end = start.AddDays(7);
        var client = await FindSelfClientAsync(cancellationToken);
        var access = client is null ? null : await GetTrainingAccessAsync(client.Id, cancellationToken);
        if (client is null || access is not { IsAllowed: true })
        {
            return new(false, (access?.Reason ?? FeatureAccessReason.MembershipInactive).ToString(),
                today, start, []);
        }

        var rows = await (
            from session in dbContext.TrainingSessions.AsNoTracking()
            join week in dbContext.MesocycleWeeks.AsNoTracking()
                on new { session.TenantId, Id = session.MesocycleWeekId }
                equals new { week.TenantId, week.Id }
            join block in dbContext.TrainingMesocycles.AsNoTracking()
                on new { week.TenantId, Id = week.MesocycleId }
                equals new { block.TenantId, block.Id }
            where block.ClientProfileId == client.Id && block.Status != MesocycleStatus.Cancelled &&
                  session.ScheduledDate >= start && session.ScheduledDate < end && week.IsPublished
            orderby session.ScheduledDate, session.Position
            select new { session.Id, session.ScheduledDate, block.StartDate, week.WeekNumber,
                block.TimeZoneId, block.RevealAllWeeks })
            .Take(50).ToListAsync(cancellationToken);
        var visible = rows.Where(row => TrainingCalendarPolicy.GetWeekAvailability(
                row.StartDate, row.WeekNumber, row.TimeZoneId, clock.UtcNow,
                row.RevealAllWeeks, true).IsVisible).ToArray();
        var ids = visible.Select(row => row.Id).ToArray();
        var completed = await dbContext.WorkoutExecutions.AsNoTracking()
            .Where(item => ids.Contains(item.TrainingSessionId) &&
                           item.Status == WorkoutExecutionStatus.Completed)
            .Select(item => item.TrainingSessionId)
            .ToListAsync(cancellationToken);
        var completedIds = completed.ToHashSet();
        var days = Enumerable.Range(0, 7).Select(offset =>
        {
            var date = start.AddDays(offset);
            var sessions = visible.Where(row => row.ScheduledDate == date).ToArray();
            return new ClientTrainingWeekDayView(date, sessions.Length,
                sessions.Count(row => completedIds.Contains(row.Id)));
        }).ToArray();
        return new(true, access.Reason.ToString(), today, start, days);
    }

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

        // Visibility first, so a week the client cannot see says nothing about its sessions' days.
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

        if (session.ScheduledDate > today)
        {
            return Conflict("session_not_due", "This session is not due yet. It opens on its day.");
        }

        var existing = await dbContext.WorkoutExecutions.AsNoTracking().SingleOrDefaultAsync(
            item => item.TrainingSessionId == sessionId,
            cancellationToken);
        if (existing is not null)
        {
            return SuccessWorkout(existing);
        }

        // A missed session is done late only while its program runs (TRN-020 v2): after the last day
        // the coach closes the program, and what was not done stays missed (TRN-013).
        if (mesocycle.HasEnded(clock.UtcNow))
        {
            return Conflict("program_ended", "This program has ended, so its sessions can no longer be started.");
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
            return Conflict("workout_start_conflict", exception.PersonMessage());
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

        if (await ClientExecutionRefusalAsync(execution, cancellationToken) is { } refusal)
        {
            return refusal;
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
            var isRecord = await IsNewPersonalRecordAsync(execution, saved, cancellationToken);
            return SuccessSet(execution, saved, isRecord);
        }
        catch (ArgumentException exception)
        {
            return Invalid("set", exception.PersonMessage());
        }
        catch (InvalidOperationException exception)
        {
            return Conflict("workout_immutable", exception.PersonMessage());
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

        if (await ClientExecutionRefusalAsync(execution, cancellationToken) is { } refusal)
        {
            return refusal;
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
        catch (WorkoutExerciseSwapLockedException exception)
        {
            return Conflict(WorkoutExerciseSwapLockedException.Code, exception.PersonMessage());
        }
        catch (InvalidOperationException exception)
        {
            return Conflict("substitution_not_allowed", exception.PersonMessage());
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

        if (await ClientExecutionRefusalAsync(execution, cancellationToken) is { } refusal)
        {
            return refusal;
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
            var summary = await BuildFinishSummaryAsync(execution, cancellationToken);
            if (mesocycleCompleted)
            {
                summary = summary with
                {
                    FinishedProgram = await SummarizeProgramAsync(
                        new FinishedProgramRow(mesocycle.Id, mesocycle.ClientProfileId, mesocycle.Name,
                            mesocycle.StartDate, mesocycle.EndDateExclusive),
                        cancellationToken),
                };
            }

            return SuccessWorkout(execution, summary);
        }
        catch (InvalidOperationException exception)
        {
            return Conflict("workout_immutable", exception.PersonMessage());
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
        if (role == TenantRole.Coach &&
            await coachClientScope.ExcludesAsync(execution.ClientProfileId, cancellationToken))
        {
            return NotFound();
        }

        // Before anything about the workout's client is read, so another client's workout says nothing.
        if (role == TenantRole.Client &&
            await ClientExecutionRefusalAsync(execution, cancellationToken) is { } refusal)
        {
            return refusal;
        }

        await coachClientScope.EnsureNotReleasedAsync(execution.ClientProfileId, cancellationToken);
        var authorRole = role switch
        {
            TenantRole.Owner or TenantRole.Coach => WorkoutNoteAuthorRole.Coach,
            TenantRole.Client => WorkoutNoteAuthorRole.Client,
            _ => (WorkoutNoteAuthorRole?)null,
        };
        if (authorRole is null)
        {
            return new TrainingCommandResult(TrainingCommandStatus.Forbidden);
        }

        // Staff write on the workout only while they may read it (audit BEA-8): the same shared access
        // decision as the coach's workout page, so a paused or blocked client's workout takes no note.
        if (authorRole == WorkoutNoteAuthorRole.Coach &&
            !(await GetCoachTrainingAccessAsync(execution.ClientProfileId, cancellationToken)).IsAllowed)
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
            var note = WorkoutNote.Create(
                tenantContext.TenantId,
                execution.Id,
                request.ExercisePerformanceId,
                userId,
                authorRole.Value,
                request.Text);
            dbContext.WorkoutNotes.Add(note);
            await QueueWorkoutNoteNoticeAsync(execution, note, cancellationToken);
            await dbContext.SaveChangesAsync(cancellationToken);
            return SuccessWorkout(execution);
        }
        catch (ArgumentException exception)
        {
            return Invalid("note", exception.PersonMessage());
        }
    }

    /// <summary>
    /// Tells the other side of a workout about a note on it, in-app (ADR 0036): a coach's note goes to
    /// the client, a client's note to the coach who has the client. Never the note's text.
    /// </summary>
    private async Task QueueWorkoutNoteNoticeAsync(
        WorkoutExecution execution,
        WorkoutNote note,
        CancellationToken cancellationToken)
    {
        var client = await dbContext.ClientProfiles.AsNoTracking()
            .Where(item => item.Id == execution.ClientProfileId)
            .Select(item => new { item.UserId, item.AssignedCoachUserId })
            .SingleOrDefaultAsync(cancellationToken);
        var fromCoach = note.AuthorRole == WorkoutNoteAuthorRole.Coach;
        if (client is null || (fromCoach ? client.UserId : client.AssignedCoachUserId) is not { } recipient ||
            recipient == note.AuthorUserId)
        {
            return;
        }

        TrainingNotices.WorkoutNote(
            dbContext,
            tenantContext.TenantId,
            await WorkspaceRelationshipNotices.TenantTimeZoneAsync(dbContext, tenantContext.TenantId, cancellationToken),
            recipient,
            fromCoach,
            execution.ClientProfileId,
            execution.MesocycleId,
            execution.TrainingSessionId,
            execution.Id,
            note.Id,
            clock.UtcNow);
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
        var epley = new EpleyOneRepMaxEstimator();
        var items = rows.Select(item =>
        {
            var (estimate, method) = EstimateLoggedMax(item.Set, epley);
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
                method,
                item.Set.ActualLoad is not null && item.Set.ActualRepetitions is not null
                    ? item.Set.ActualLoad * item.Set.ActualRepetitions
                    : null,
                item.Set.ClientNote);
        }).ToArray();
        return new ExerciseHistoryPage(total, skip, take, items);
    }

    /// <summary>
    /// The max one logged set suggests, and the formula that read it (TRAIN-4): a set with an RPE the RTS chart
    /// covers is read on the chart, the number the Training maxes panel gives the same set (STR-012); any other
    /// set of 1 to 12 reps with a weight by Epley. A set that neither covers has no estimate.
    /// </summary>
    private static (decimal? Value, string? Method) EstimateLoggedMax(
        WorkoutSetPerformance set,
        EpleyOneRepMaxEstimator epley)
    {
        if (set.ActualLoad is not ({ } load and > 0m and <= 2_000m) || set.ActualLoadUnit is not { } unit ||
            set.ActualRepetitions is not ({ } repetitions and >= 1 and <= 12))
        {
            return (null, null);
        }

        if (set.ActualRpe is { } rpe &&
            RpeChartMaxEstimator.TryEstimate(load, repetitions, rpe, ToStrengthUnit(unit)) is { } chart)
        {
            return (chart.Value, chart.StrategyKey);
        }

        return (epley.Estimate(load, repetitions), EpleyOneRepMaxEstimator.Key);
    }

    private async Task<ClientProfile?> FindSelfClientAsync(CancellationToken cancellationToken) =>
        currentUser.UserId is not { } userId
            ? null
            : await dbContext.ClientProfiles.CurrentFor(userId).SingleOrDefaultAsync(cancellationToken);

    private Task<FeatureAccessDecision> GetTrainingAccessAsync(
        Guid clientProfileId,
        CancellationToken cancellationToken) =>
        featureAccessService.EvaluateAsync(
            tenantContext.TenantId,
            clientProfileId,
            CoachingFeature.Training,
            cancellationToken);

    /// <summary>
    /// Today's training access as a coach's reads of the client see it (TRN-023): open as well before
    /// a booked plan begins, keeping the plan's own reason so the page can say when it starts.
    /// </summary>
    private async Task<FeatureAccessDecision> GetCoachTrainingAccessAsync(
        Guid clientProfileId,
        CancellationToken cancellationToken)
    {
        var access = await GetTrainingAccessAsync(clientProfileId, cancellationToken);
        return !access.IsAllowed &&
               CoachTrainingReadPolicy.Opens(access, await GetTenantTodayAsync(cancellationToken))
            ? access with { IsAllowed = true }
            : access;
    }

    /// <summary>
    /// Why the signed-in client may not use this workout, or null when they may. Another client's
    /// workout answers as a missing one (audit SEC-7, ADR 0026); their own is refused only while their
    /// training is closed.
    /// </summary>
    private async Task<TrainingCommandResult?> ClientExecutionRefusalAsync(
        WorkoutExecution execution,
        CancellationToken cancellationToken)
    {
        var client = await FindSelfClientAsync(cancellationToken);
        if (client is null || client.Id != execution.ClientProfileId)
        {
            return NotFound();
        }

        return (await GetTrainingAccessAsync(client.Id, cancellationToken)).IsAllowed
            ? null
            : new TrainingCommandResult(TrainingCommandStatus.Forbidden);
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
                Sets = item.Performance.Sets
                    .Where(set => set.IsCompleted)
                    .OrderBy(set => set.Position)
                    .Select(set => new PreviousSetPerformanceView(
                        set.Position, set.ActualRepetitions, set.ActualLoad,
                        set.ActualLoadUnit, set.ActualRpe))
                    .ToArray(),
            })
            .ToListAsync(cancellationToken);
        var latestRows = rows.GroupBy(item => item.ActualExerciseId)
            .Select(group => group.First()).ToArray();
        return latestRows.GroupBy(item => item.ActualExerciseId)
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
                        item.ActualRpe,
                        item.Sets);
                });
    }

    private async Task<WorkoutFinishSummaryView> BuildFinishSummaryAsync(
        WorkoutExecution execution,
        CancellationToken cancellationToken)
    {
        var earlier = await LoadEarlierSetsAsync(
            execution.ClientProfileId,
            execution.Exercises.Select(item => item.ActualExerciseId).Distinct().ToArray(),
            execution.StartedAtUtc,
            cancellationToken);
        var summary = SummarizeWorkout(execution, earlier.Where(item => item.WorkoutId != execution.Id));
        return new WorkoutFinishSummaryView(
            WorkoutDurationSeconds(execution), summary.CompletedSetCount, summary.TotalSetCount,
            summary.Volume, summary.PersonalRecords);
    }

    private async Task<bool> IsNewPersonalRecordAsync(
        WorkoutExecution execution,
        WorkoutSetPerformance saved,
        CancellationToken cancellationToken)
    {
        if (!WorkoutPersonalRecordRule.IsRecord(saved.IsCompleted, saved.ActualRepetitions,
                saved.ActualLoad, saved.ActualLoadUnit, null))
        {
            return false;
        }

        // The finish summary's question for this one set (TRN-019): the workout's sets in its order, whichever
        // of its exercises they sit under, against the workouts finished before it started. Only the same lift,
        // reps and unit can speak, so those workouts are read as their one best load.
        var exercise = execution.Exercises.Single(item => item.Sets.Any(set => set.Id == saved.Id));
        var historical = await (
            from set in dbContext.WorkoutSetPerformances.AsNoTracking()
            join performance in dbContext.WorkoutExercisePerformances.AsNoTracking()
                on new { set.TenantId, Id = set.WorkoutExercisePerformanceId }
                equals new { performance.TenantId, performance.Id }
            join workout in dbContext.WorkoutExecutions.AsNoTracking()
                on new { performance.TenantId, Id = performance.WorkoutExecutionId }
                equals new { workout.TenantId, workout.Id }
            where workout.ClientProfileId == execution.ClientProfileId &&
                  workout.Status == WorkoutExecutionStatus.Completed &&
                  workout.CompletedAtUtc <= execution.StartedAtUtc &&
                  performance.ActualExerciseId == exercise.ActualExerciseId &&
                  set.IsCompleted && set.ActualRepetitions == saved.ActualRepetitions &&
                  set.ActualLoadUnit == saved.ActualLoadUnit
            select set.ActualLoad).MaxAsync(cancellationToken);
        PerformedSet[] earlier = historical is { } best
            ? [new PerformedSet(Guid.Empty, exercise.ActualExerciseId, saved.ActualRepetitions, best,
                saved.ActualLoadUnit, true)]
            : [];
        return WorkoutPersonalRecordRule.IsRecordSet(
            saved.Id, WorkoutPersonalRecordRule.CompletedSetsInOrder(execution), earlier);
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
        WorkoutExecution execution,
        IReadOnlyList<WorkoutNote> notes,
        IReadOnlyDictionary<Guid, string> names,
        IReadOnlyDictionary<Guid, PreviousExercisePerformanceView> previous) =>
        new(
            execution.TrainingSessionId,
            execution.MesocycleId,
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
            execution.Version,
            execution.StartedAtUtc,
            FinishedDurationSeconds(execution));

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
            set.CoachNotes,
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
            set.CoachNotesSnapshot,
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

    private static TrainingCommandResult SuccessWorkout(
        WorkoutExecution execution,
        WorkoutFinishSummaryView? summary = null) =>
        new(
            TrainingCommandStatus.Success,
            WorkoutExecution: new WorkoutExecutionView(
                execution.Id,
                execution.Status,
                execution.StartedAtUtc,
                execution.CompletedAtUtc,
                execution.Version,
                summary));

    private static TrainingCommandResult SuccessSet(
        WorkoutExecution execution,
        WorkoutSetPerformance set,
        bool isPersonalRecord) =>
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
                set.ClientNote,
                isPersonalRecord,
                WorkoutPersonalRecordRule.Key,
                WorkoutPersonalRecordRule.Version));

    private sealed record TodayScheduleRow(Guid MesocycleId, Guid SessionId);

    private sealed record ScheduledSession(Guid MesocycleId, TrainingSession Session);
}
