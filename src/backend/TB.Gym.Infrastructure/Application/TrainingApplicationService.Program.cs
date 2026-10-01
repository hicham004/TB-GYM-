using Microsoft.EntityFrameworkCore;
using TB.Gym.Modules.Training;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>The client's Training page (R2.5b): one program with its weeks, and finished workouts.</summary>
internal sealed partial class TrainingApplicationService
{
    private const int HistoryPageSize = 10;

    public async Task<ClientTrainingProgramView> GetMyProgramAsync(CancellationToken cancellationToken)
    {
        var today = await GetTenantTodayAsync(cancellationToken);
        var client = await FindSelfClientAsync(cancellationToken);
        var access = client is null ? null : await GetTrainingAccessAsync(client.Id, cancellationToken);
        if (client is null || access is not { IsAllowed: true })
        {
            return new(false, (access?.Reason ?? FeatureAccessReason.MembershipInactive).ToString(), today,
                null, null, ClientSessionStatePolicy.Key, ClientSessionStatePolicy.Version);
        }

        // The same open blocks as Today's coverage: primary blocks cannot overlap (TRN-011), so the
        // first few by start answer both "covering today" and "next".
        var open = await dbContext.TrainingMesocycles.AsNoTracking()
            .Where(item => item.ClientProfileId == client.Id && item.EndDateExclusive > today &&
                item.Status != MesocycleStatus.Cancelled && item.Status != MesocycleStatus.Completed)
            .OrderBy(item => item.StartDate).ThenBy(item => item.Id)
            .Take(8)
            .Select(item => new ProgramBlockRow(item.Id, item.Name, item.Kind, item.StartDate,
                item.EndDateExclusive, item.TimeZoneId, item.RevealAllWeeks))
            .ToListAsync(cancellationToken);
        var current = open.Where(item => item.StartDate <= today)
            .OrderBy(item => item.Kind == MesocycleKind.Primary ? 0 : 1)
            .FirstOrDefault();
        var next = open.FirstOrDefault(item => item.StartDate > today);
        var described = current ?? next ?? await dbContext.TrainingMesocycles.AsNoTracking()
            .Where(item => item.ClientProfileId == client.Id && item.Status != MesocycleStatus.Cancelled &&
                item.StartDate <= today &&
                (item.Status == MesocycleStatus.Completed || item.EndDateExclusive <= today))
            .OrderByDescending(item => item.StartDate).ThenByDescending(item => item.Id)
            .Select(item => new ProgramBlockRow(item.Id, item.Name, item.Kind, item.StartDate,
                item.EndDateExclusive, item.TimeZoneId, item.RevealAllWeeks))
            .FirstOrDefaultAsync(cancellationToken);
        var program = described is null
            ? null
            : await ReadProgramAsync(described, described == current ? ClientProgramPhase.Current
                : described == next ? ClientProgramPhase.Upcoming : ClientProgramPhase.Finished,
                today, cancellationToken);
        return new(true, access.Reason.ToString(), today, program, next?.StartDate,
            ClientSessionStatePolicy.Key, ClientSessionStatePolicy.Version);
    }

    public async Task<ClientWorkoutHistoryPage> GetMyWorkoutHistoryAsync(
        int skip,
        CancellationToken cancellationToken)
    {
        var client = await FindSelfClientAsync(cancellationToken);
        var access = client is null ? null : await GetTrainingAccessAsync(client.Id, cancellationToken);
        if (client is null || access is not { IsAllowed: true })
        {
            return new(false, (access?.Reason ?? FeatureAccessReason.MembershipInactive).ToString(), [],
                null, WorkoutPersonalRecordRule.Key, WorkoutPersonalRecordRule.Version);
        }

        // Finished workouts are the client's own immutable facts (TRN-012, TRN-015), so later
        // publishing changes do not hide them; the personal-records read counts them the same way.
        var page = await (
            from execution in dbContext.WorkoutExecutions.AsNoTracking()
            join block in dbContext.TrainingMesocycles.AsNoTracking()
                on new { execution.TenantId, Id = execution.MesocycleId } equals new { block.TenantId, block.Id }
            where execution.ClientProfileId == client.Id && execution.Status == WorkoutExecutionStatus.Completed
            orderby execution.CompletedAtUtc descending, execution.Id descending
            select new { execution.Id, ProgramName = block.Name })
            .Skip(skip).Take(HistoryPageSize + 1).ToListAsync(cancellationToken);
        var shown = page.Take(HistoryPageSize).ToArray();
        var ids = shown.Select(item => item.Id).ToArray();
        var workouts = await dbContext.WorkoutExecutions.AsNoTracking()
            .Where(item => ids.Contains(item.Id))
            .Include(item => item.Exercises).ThenInclude(item => item.Sets)
            .AsSplitQuery()
            .ToDictionaryAsync(item => item.Id, cancellationToken);
        var earlier = workouts.Count == 0
            ? []
            : await LoadEarlierSetsAsync(
                client.Id,
                workouts.Values.SelectMany(item => item.Exercises).Select(item => item.ActualExerciseId)
                    .Distinct().ToArray(),
                workouts.Values.Max(item => item.StartedAtUtc),
                cancellationToken);
        var items = shown.Select(row =>
        {
            var workout = workouts[row.Id];
            var summary = SummarizeWorkout(workout, earlier.Where(set =>
                set.WorkoutId != workout.Id && set.CompletedAtUtc <= workout.StartedAtUtc));
            return new ClientWorkoutHistoryItemView(
                workout.Id,
                workout.SessionNameSnapshot,
                row.ProgramName,
                workout.ScheduledDateSnapshot,
                workout.CompletedAtUtc!.Value,
                WorkoutDurationSeconds(workout),
                summary.CompletedSetCount,
                summary.TotalSetCount,
                summary.Volume,
                summary.PersonalRecords);
        }).ToArray();
        return new(true, access.Reason.ToString(), items,
            page.Count > HistoryPageSize ? skip + HistoryPageSize : null,
            WorkoutPersonalRecordRule.Key, WorkoutPersonalRecordRule.Version);
    }

    private async Task<ClientProgramView> ReadProgramAsync(
        ProgramBlockRow block,
        ClientProgramPhase phase,
        DateOnly today,
        CancellationToken cancellationToken)
    {
        var weeks = await dbContext.MesocycleWeeks.AsNoTracking()
            .Where(item => item.MesocycleId == block.Id)
            .OrderBy(item => item.WeekNumber)
            .Select(item => new { item.Id, item.WeekNumber, item.StartsOn, item.IsPublished })
            .ToListAsync(cancellationToken);
        var visibleWeekIds = weeks
            .Where(item => TrainingCalendarPolicy.GetWeekAvailability(block.StartDate, item.WeekNumber,
                block.TimeZoneId, clock.UtcNow, block.RevealAllWeeks, item.IsPublished).IsVisible)
            .Select(item => item.Id)
            .ToHashSet();

        // A hidden week sends no session content at all (TRN-006): only visible weeks are queried.
        var visibleIds = visibleWeekIds.ToArray();
        var sessions = await dbContext.TrainingSessions.AsNoTracking()
            .Where(item => visibleIds.Contains(item.MesocycleWeekId))
            .OrderBy(item => item.ScheduledDate).ThenBy(item => item.Position).ThenBy(item => item.Id)
            .Select(item => new
            {
                item.Id,
                item.MesocycleWeekId,
                item.Name,
                item.ScheduledDate,
                ExerciseCount = item.Exercises.Count(),
                SetCount = item.Exercises.SelectMany(exercise => exercise.Sets).Count(),
            })
            .ToListAsync(cancellationToken);
        var sessionIds = sessions.Select(item => item.Id).ToArray();
        var workouts = await dbContext.WorkoutExecutions.AsNoTracking()
            .Where(item => sessionIds.Contains(item.TrainingSessionId))
            .Select(item => new { item.TrainingSessionId, item.Id, item.Status })
            .ToDictionaryAsync(item => item.TrainingSessionId, cancellationToken);
        var views = sessions.Select(item =>
        {
            workouts.TryGetValue(item.Id, out var workout);
            return (item.MesocycleWeekId, View: new ClientProgramSessionView(
                item.Id,
                item.Name,
                item.ScheduledDate,
                ClientSessionStatePolicy.Evaluate(item.ScheduledDate, today, workout?.Status),
                workout?.Id,
                item.ExerciseCount,
                item.SetCount));
        }).ToArray();

        var weekCount = weeks.Count;
        int? currentWeek = phase == ClientProgramPhase.Current
            ? Math.Clamp((today.DayNumber - block.StartDate.DayNumber) / 7 + 1, 1, Math.Max(1, weekCount))
            : null;
        return new ClientProgramView(
            block.Id,
            block.Name,
            block.StartDate,
            block.EndDateExclusive,
            phase,
            weekCount,
            currentWeek,
            views.Length,
            views.Count(item => item.View.State == ClientSessionState.Completed),
            views.Count(item => item.View.State == ClientSessionState.Missed),
            weeks.Select(week => new ClientProgramWeekView(
                week.WeekNumber,
                week.StartsOn,
                visibleWeekIds.Contains(week.Id),
                week.IsPublished,
                views.Where(item => item.MesocycleWeekId == week.Id).Select(item => item.View).ToArray()))
            .ToArray());
    }

    /// <summary>
    /// The completed sets of this client's workouts that finished by <paramref name="completedBy"/>,
    /// for the given exercises: what the record rule compares a workout against (TRN-019).
    /// </summary>
    private async Task<IReadOnlyList<EarlierSetRow>> LoadEarlierSetsAsync(
        Guid clientProfileId,
        Guid[] exerciseIds,
        DateTimeOffset completedBy,
        CancellationToken cancellationToken) =>
        await (
            from set in dbContext.WorkoutSetPerformances.AsNoTracking()
            join exercise in dbContext.WorkoutExercisePerformances.AsNoTracking()
                on new { set.TenantId, Id = set.WorkoutExercisePerformanceId }
                equals new { exercise.TenantId, exercise.Id }
            join workout in dbContext.WorkoutExecutions.AsNoTracking()
                on new { exercise.TenantId, Id = exercise.WorkoutExecutionId }
                equals new { workout.TenantId, workout.Id }
            where workout.ClientProfileId == clientProfileId &&
                  workout.Status == WorkoutExecutionStatus.Completed &&
                  workout.CompletedAtUtc <= completedBy &&
                  exerciseIds.Contains(exercise.ActualExerciseId) &&
                  set.IsCompleted && set.ActualRepetitions != null &&
                  set.ActualLoad != null && set.ActualLoadUnit != null
            select new EarlierSetRow(
                workout.Id,
                workout.CompletedAtUtc!.Value,
                new PerformedSet(set.Id, exercise.ActualExerciseId, set.ActualRepetitions,
                    set.ActualLoad, set.ActualLoadUnit, true)))
            .ToListAsync(cancellationToken);

    /// <summary>Sets, volume and records of one workout; the finish summary and history share it.</summary>
    private static WorkoutSummary SummarizeWorkout(WorkoutExecution workout, IEnumerable<EarlierSetRow> earlier)
    {
        var ordered = workout.Exercises.OrderBy(item => item.Position)
            .SelectMany(exercise => exercise.Sets.OrderBy(item => item.Position)
                .Select(set => (exercise, set)))
            .ToArray();
        var completed = ordered.Where(item => item.set.IsCompleted).ToArray();
        var recordIds = WorkoutPersonalRecordRule.RecordSetIds(
            completed.Select(item => new PerformedSet(item.set.Id, item.exercise.ActualExerciseId,
                item.set.ActualRepetitions, item.set.ActualLoad, item.set.ActualLoadUnit, true)),
            earlier.Select(item => item.Set)).ToHashSet();
        var records = completed.Where(item => recordIds.Contains(item.set.Id))
            .Select(item => new WorkoutPersonalRecordView(
                item.set.Id, item.exercise.ActualExerciseName, item.set.ActualRepetitions!.Value,
                item.set.ActualLoad!.Value, item.set.ActualLoadUnit!.Value,
                WorkoutPersonalRecordRule.Key, WorkoutPersonalRecordRule.Version))
            .ToArray();
        var volume = completed
            .Where(item => item.set.ActualLoad is not null && item.set.ActualRepetitions is not null &&
                           item.set.ActualLoadUnit is not null)
            .GroupBy(item => item.set.ActualLoadUnit!.Value)
            .Select(group => new WorkoutVolumeView(group.Key,
                group.Sum(item => item.set.ActualLoad!.Value * item.set.ActualRepetitions!.Value)))
            .ToArray();
        return new WorkoutSummary(completed.Length, ordered.Length, volume, records);
    }

    private int WorkoutDurationSeconds(WorkoutExecution workout) =>
        (int)Math.Max(0, Math.Floor(
            ((workout.CompletedAtUtc ?? clock.UtcNow) - workout.StartedAtUtc).TotalSeconds));

    private sealed record ProgramBlockRow(
        Guid Id,
        string Name,
        MesocycleKind Kind,
        DateOnly StartDate,
        DateOnly EndDateExclusive,
        string TimeZoneId,
        bool RevealAllWeeks);

    private sealed record EarlierSetRow(Guid WorkoutId, DateTimeOffset CompletedAtUtc, PerformedSet Set);

    private sealed record WorkoutSummary(
        int CompletedSetCount,
        int TotalSetCount,
        IReadOnlyList<WorkoutVolumeView> Volume,
        IReadOnlyList<WorkoutPersonalRecordView> PersonalRecords);
}
