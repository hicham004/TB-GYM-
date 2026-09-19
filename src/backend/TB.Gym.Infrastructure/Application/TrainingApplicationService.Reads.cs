using Microsoft.EntityFrameworkCore;
using TB.Gym.Modules.Training;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

internal sealed partial class TrainingApplicationService
{
    private const int UnfinishedPageSize = 5;
    private const int WorkoutNotesPageSize = 50;
    private const int UpcomingLookAheadDays = 90;

    public async Task<ClientTrainingUpcomingView> GetUpcomingAsync(
        int skip,
        CancellationToken cancellationToken)
    {
        var timeZoneId = await dbContext.Tenants.AsNoTracking()
            .Where(item => item.Id == tenantContext.TenantId).Select(item => item.TimeZoneId)
            .SingleAsync(cancellationToken);
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.UtcNow,
            TimeZoneInfo.FindSystemTimeZoneById(timeZoneId)).DateTime);
        var through = today.AddDays(UpcomingLookAheadDays);
        var client = await FindSelfClientAsync(cancellationToken);
        var access = client is null ? null : await GetTrainingAccessAsync(client.Id, cancellationToken);
        if (client is null || access is not { IsAllowed: true })
        {
            return new(false, (access?.Reason ?? FeatureAccessReason.MembershipInactive).ToString(),
                today, timeZoneId, false, false, through, null, [], null);
        }

        var hasProgram = await dbContext.TrainingMesocycles.AsNoTracking().AnyAsync(item =>
            item.ClientProfileId == client.Id && item.EndDateExclusive > today &&
            item.Status != MesocycleStatus.Cancelled && item.Status != MesocycleStatus.Completed,
            cancellationToken);

        // Primary blocks cannot overlap; each has at most 52 weeks. Across a 90-day window
        // even boundary-spanning blocks fit under 128 week rows. Only metadata is read here.
        var weeks = await (
            from week in dbContext.MesocycleWeeks.AsNoTracking()
            join block in dbContext.TrainingMesocycles.AsNoTracking()
                on new { week.TenantId, Id = week.MesocycleId } equals new { block.TenantId, block.Id }
            where block.ClientProfileId == client.Id && block.EndDateExclusive > today &&
                block.StartDate <= through && block.Status != MesocycleStatus.Cancelled &&
                block.Status != MesocycleStatus.Completed && week.IsPublished
            orderby block.StartDate, week.WeekNumber
            select new { week.Id, block.StartDate, week.WeekNumber, block.TimeZoneId, block.RevealAllWeeks })
            .Take(128).ToListAsync(cancellationToken);
        var visibleWeekIds = weeks.Where(item => TrainingCalendarPolicy.GetWeekAvailability(
                item.StartDate, item.WeekNumber, item.TimeZoneId, clock.UtcNow, item.RevealAllWeeks, true).IsVisible)
            .Select(item => item.Id).ToArray();
        var hasVisibleSessions = await dbContext.TrainingSessions.AsNoTracking()
            .AnyAsync(item => visibleWeekIds.Contains(item.MesocycleWeekId), cancellationToken);
        var next = await dbContext.TrainingSessions.AsNoTracking()
            .Where(item => visibleWeekIds.Contains(item.MesocycleWeekId) &&
                item.ScheduledDate > today && item.ScheduledDate <= through)
            .OrderBy(item => item.ScheduledDate).ThenBy(item => item.Position).ThenBy(item => item.Id)
            .Select(item => new UpcomingTrainingSessionView(item.Id, item.ScheduledDate, item.Name))
            .FirstOrDefaultAsync(cancellationToken);

        // Page metadata before loading any exercise trees. Hidden rows never contribute content;
        // the cursor advances over them so they cannot prevent a later visible workout being read.
        var candidates = await (
            from execution in dbContext.WorkoutExecutions.AsNoTracking()
            join session in dbContext.TrainingSessions.AsNoTracking()
                on new { execution.TenantId, Id = execution.TrainingSessionId } equals new { session.TenantId, session.Id }
            join week in dbContext.MesocycleWeeks.AsNoTracking()
                on new { session.TenantId, Id = session.MesocycleWeekId } equals new { week.TenantId, week.Id }
            join block in dbContext.TrainingMesocycles.AsNoTracking()
                on new { week.TenantId, Id = week.MesocycleId } equals new { block.TenantId, block.Id }
            where execution.ClientProfileId == client.Id && execution.Status == WorkoutExecutionStatus.InProgress &&
                execution.ScheduledDateSnapshot < today && block.Status != MesocycleStatus.Cancelled &&
                block.Status != MesocycleStatus.Completed && week.IsPublished
            orderby execution.ScheduledDateSnapshot, execution.Id
            select new { execution.Id, block.StartDate, week.WeekNumber, block.TimeZoneId, block.RevealAllWeeks })
            .Skip(skip).Take(UnfinishedPageSize + 1).ToListAsync(cancellationToken);
        var visibleIds = candidates.Take(UnfinishedPageSize).Where(candidate =>
            TrainingCalendarPolicy.GetWeekAvailability(candidate.StartDate, candidate.WeekNumber,
                candidate.TimeZoneId, clock.UtcNow, candidate.RevealAllWeeks, true).IsVisible)
            .Select(item => item.Id).ToArray();
        var unfinished = await ReadWorkoutDetailsAsync(visibleIds, 0, cancellationToken);
        return new(true, access.Reason.ToString(), today, timeZoneId, hasProgram, hasVisibleSessions, through,
            next, unfinished, candidates.Count > UnfinishedPageSize ? skip + UnfinishedPageSize : null);
    }

    public async Task<CoachWorkoutDetailResult?> GetCoachWorkoutAsync(
        Guid clientProfileId,
        Guid workoutExecutionId,
        int notesSkip,
        CancellationToken cancellationToken)
    {
        if (!await dbContext.WorkoutExecutions.AsNoTracking().AnyAsync(item =>
            item.Id == workoutExecutionId && item.ClientProfileId == clientProfileId, cancellationToken))
        {
            return null;
        }
        var access = await GetTrainingAccessAsync(clientProfileId, cancellationToken);
        if (!access.IsAllowed)
        {
            return new(false, access.Reason.ToString(), null, null);
        }
        // Coaches can inspect their own unpublished programming. Client calendar visibility
        // applies to the client projection; it does not conceal coaching history from its coach.
        var detail = (await ReadWorkoutDetailsAsync([workoutExecutionId], notesSkip, cancellationToken)).SingleOrDefault();
        return new(true, access.Reason.ToString(), detail,
            detail is { HasMoreNotes: true } ? notesSkip + WorkoutNotesPageSize : null);
    }

    private async Task<IReadOnlyList<DatedWorkoutView>> ReadWorkoutDetailsAsync(
        Guid[] workoutExecutionIds,
        int notesSkip,
        CancellationToken cancellationToken)
    {
        if (workoutExecutionIds.Length == 0)
        {
            return [];
        }
        // Five roots at most; domain bounds each at 40 exercises and 20 sets per exercise.
        // Batch the graphs and names instead of reloading them once for every workout.
        var executions = await dbContext.WorkoutExecutions.AsNoTracking()
            .Where(item => workoutExecutionIds.Contains(item.Id))
            .Include(item => item.Exercises).ThenInclude(item => item.Sets)
            .Include(item => item.Exercises).ThenInclude(item => item.ApprovedAlternatives)
            .Include(item => item.Exercises).ThenInclude(item => item.Media)
            .AsSplitQuery().ToDictionaryAsync(item => item.Id, cancellationToken);
        var blockIds = executions.Values.Select(item => item.MesocycleId).Distinct().ToArray();
        var timeZones = await dbContext.TrainingMesocycles.AsNoTracking()
            .Where(item => blockIds.Contains(item.Id))
            .ToDictionaryAsync(item => item.Id, item => item.TimeZoneId, cancellationToken);
        var exerciseIds = executions.Values.SelectMany(item => item.Exercises).SelectMany(item => item.ApprovedAlternatives
            .Select(alternative => alternative.ExerciseId).Append(item.ActualExerciseId)).Distinct().ToArray();
        var names = await dbContext.Exercises.AsNoTracking().Where(item => exerciseIds.Contains(item.Id))
            .ToDictionaryAsync(item => item.Id, item => item.Name, cancellationToken);
        var details = new List<DatedWorkoutView>();
        foreach (var id in workoutExecutionIds)
        {
            if (!executions.TryGetValue(id, out var execution)) continue;
            // Independent bounded note pages and a historical cutoff specific to each workout.
            var notes = await dbContext.WorkoutNotes.AsNoTracking()
                .Where(item => item.WorkoutExecutionId == id)
                .OrderByDescending(item => item.CreatedAtUtc).ThenByDescending(item => item.Id)
                .Skip(notesSkip).Take(WorkoutNotesPageSize + 1).ToListAsync(cancellationToken);
            var previous = await LoadPreviousPerformancesAsync(
                execution.ClientProfileId, execution.ScheduledDateSnapshot, exerciseIds, cancellationToken);
            details.Add(new(execution.ScheduledDateSnapshot, timeZones[execution.MesocycleId],
                ToClientWorkout(execution, notes.Take(WorkoutNotesPageSize).ToArray(), names, previous),
                notes.Count > WorkoutNotesPageSize));
        }
        return details;
    }
}
