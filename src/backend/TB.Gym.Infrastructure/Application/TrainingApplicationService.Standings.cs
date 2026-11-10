using Microsoft.EntityFrameworkCore;
using TB.Gym.Modules.Training;

namespace TB.Gym.Infrastructure.Application;

internal sealed partial class TrainingApplicationService
{
    /// <summary>
    /// Where each lift with a "Last time + step" set stands for the client (<c>LastTimeStep</c> v1, STR-019, notes
    /// plan N6b): one answer per writing of the lift in its coming session, the earliest session not started and not
    /// before today (in its program's calendar) of a block neither completed nor cancelled that writes the lift with
    /// a step. Two reads at most: the coming step sets, then the client's workouts of those lifts, from any program.
    /// Callers decide first that the coach's read is open (TRN-023); nothing is written.
    /// </summary>
    private async Task<IReadOnlyList<LiftStandingView>> ReadLiftStandingsAsync(
        Guid clientProfileId,
        CancellationToken cancellationToken)
    {
        var now = clock.UtcNow;
        // Every program's today is on or after the UTC day before; each block's own day is checked below.
        var earliest = DateOnly.FromDateTime(now.UtcDateTime).AddDays(-1);
        var rows = await (
                from block in dbContext.TrainingMesocycles.AsNoTracking()
                join week in dbContext.MesocycleWeeks.AsNoTracking()
                    on new { block.TenantId, MesocycleId = block.Id } equals new { week.TenantId, week.MesocycleId }
                join session in dbContext.TrainingSessions.AsNoTracking()
                    on new { week.TenantId, MesocycleWeekId = week.Id } equals new { session.TenantId, session.MesocycleWeekId }
                join exercise in dbContext.ExercisePrescriptions.AsNoTracking()
                    on new { session.TenantId, TrainingSessionId = session.Id }
                    equals new { exercise.TenantId, exercise.TrainingSessionId }
                where block.ClientProfileId == clientProfileId &&
                      block.Status == MesocycleStatus.Planned &&
                      !session.HasStarted &&
                      session.ScheduledDate >= earliest &&
                      exercise.Sets.Any(set => set.LoadStrategy == TrainingLoadStrategy.LastTimeStep)
                select new
                {
                    BlockId = block.Id,
                    block.TimeZoneId,
                    block.StartDate,
                    week.WeekNumber,
                    SessionId = session.Id,
                    SessionName = session.Name,
                    session.ScheduledDate,
                    SessionPosition = session.Position,
                    ExercisePrescriptionId = exercise.Id,
                    exercise.ExerciseId,
                    exercise.ExerciseNameSnapshot,
                    exercise.Position,
                    // Line (f): which writing of the lift in the session it is, every writing counted.
                    Occurrence = dbContext.ExercisePrescriptions.Count(other =>
                        other.TrainingSessionId == session.Id &&
                        other.ExerciseId == exercise.ExerciseId &&
                        other.Position < exercise.Position) + 1,
                    Sets = exercise.Sets
                        .OrderBy(set => set.Position)
                        .Select(set => new
                        {
                            set.Id,
                            set.LoadStrategy,
                            set.LoadStep,
                            set.LoadUnit,
                            Weight = set.PrescribedLoad ?? set.DirectLoad,
                            set.ExertionDisplayPreference,
                        })
                        .ToList(),
                })
            .ToListAsync(cancellationToken);
        if (rows.Count == 0)
        {
            return [];
        }

        var todays = rows.Select(row => row.TimeZoneId).Distinct()
            .ToDictionary(zone => zone, zone => DateOnly.FromDateTime(
                TimeZoneInfo.ConvertTime(now, TimeZoneInfo.FindSystemTimeZoneById(zone)).DateTime));
        // A lift's coming session is its first open one; every writing of the lift there is answered.
        var writings = rows
            .Where(row => row.ScheduledDate >= todays[row.TimeZoneId])
            .OrderBy(row => row.ScheduledDate)
            .ThenBy(row => row.StartDate).ThenBy(row => row.BlockId)
            .ThenBy(row => row.WeekNumber).ThenBy(row => row.SessionPosition).ThenBy(row => row.SessionId)
            .ThenBy(row => row.Position)
            .GroupBy(row => row.ExerciseId)
            .SelectMany(lift => lift.Where(row => row.SessionId == lift.First().SessionId))
            .ToArray();
        if (writings.Length == 0)
        {
            return [];
        }

        var lifts = writings.Select(row => row.ExerciseId).Distinct().ToArray();
        var through = writings.Max(row => row.ScheduledDate);
        var logged = await (
                from set in dbContext.WorkoutSetPerformances.AsNoTracking()
                join performance in dbContext.WorkoutExercisePerformances.AsNoTracking()
                    on new { set.TenantId, Id = set.WorkoutExercisePerformanceId }
                    equals new { performance.TenantId, performance.Id }
                join execution in dbContext.WorkoutExecutions.AsNoTracking()
                    on new { performance.TenantId, Id = performance.WorkoutExecutionId }
                    equals new { execution.TenantId, execution.Id }
                where execution.ClientProfileId == clientProfileId &&
                      execution.ScheduledDateSnapshot <= through &&
                      lifts.Contains(performance.PrescribedExerciseId)
                select new
                {
                    ExecutionId = execution.Id,
                    execution.ScheduledDateSnapshot,
                    execution.Status,
                    execution.StartedAtUtc,
                    PerformanceId = performance.Id,
                    performance.PrescribedExerciseId,
                    performance.ActualExerciseId,
                    PerformancePosition = performance.Position,
                    set.Position,
                    set.SetTypeSnapshot,
                    set.PrescribedRepetitionsMinimum,
                    set.PrescribedRepetitionsMaximum,
                    set.PrescribedTargetRpe,
                    set.PrescribedLoad,
                    set.PrescribedLoadUnit,
                    set.IsCompleted,
                    set.ActualRepetitions,
                    set.ActualLoad,
                    set.ActualLoadUnit,
                    set.ActualRpe,
                })
            .ToListAsync(cancellationToken);
        // Line (f): a workout's writings of a lift are numbered by the place the coach wrote them, and only one done
        // as written is the lift's: a writing swapped for another lift never shifts the numbering, so a top set is
        // never matched to last time's back-off, and a lift done in another lift's place is not read.
        var history = logged
            .GroupBy(row => (row.ExecutionId, row.PrescribedExerciseId))
            .SelectMany(workout => workout
                .GroupBy(row => row.PerformanceId)
                .OrderBy(performance => performance.First().PerformancePosition)
                .Select((performance, index) => (Performance: performance, Occurrence: index + 1))
                .Where(item => item.Performance.First().ActualExerciseId == item.Performance.First().PrescribedExerciseId)
                .Select(item =>
                {
                    var (performance, occurrence) = item;
                    var first = performance.First();
                    return (Lift: first.PrescribedExerciseId, Writing: new LoggedLift(
                        first.ExecutionId,
                        first.ScheduledDateSnapshot,
                        first.Status,
                        first.StartedAtUtc,
                        occurrence,
                        performance.OrderBy(row => row.Position).Select((row, number) => new LoggedSet(
                            number + 1,
                            row.SetTypeSnapshot,
                            row.PrescribedRepetitionsMaximum ?? row.PrescribedRepetitionsMinimum,
                            row.PrescribedTargetRpe,
                            row.PrescribedLoad,
                            row.PrescribedLoadUnit,
                            row.IsCompleted,
                            row.ActualRepetitions,
                            row.ActualLoad,
                            row.ActualLoadUnit,
                            row.ActualRpe)).ToArray()));
                }))
            .ToLookup(item => item.Lift, item => item.Writing);

        var standings = new List<LiftStandingView>(writings.Length);
        foreach (var row in writings)
        {
            // The database holds a step set's step and unit (CK_SetPrescriptions_LoadStrategy).
            var steps = row.Sets
                .Select((set, index) => (Set: set, Number: index + 1))
                .Where(item => item.Set.LoadStrategy == TrainingLoadStrategy.LastTimeStep &&
                               item.Set is { LoadStep: not null, LoadUnit: not null })
                .ToArray();
            if (steps.Length == 0)
            {
                continue;
            }

            var coming = new ComingLift(row.ExerciseId, row.Occurrence, row.ScheduledDate, steps
                .Select(item => new ComingStepSet(item.Set.Id, item.Number, item.Set.LoadStep!.Value,
                    item.Set.LoadUnit!.Value, item.Set.Weight))
                .ToArray());
            standings.Add(new LiftStandingView(
                LastTimeStepRule.Key,
                LastTimeStepRule.Version,
                row.BlockId,
                row.SessionId,
                row.SessionName,
                row.ScheduledDate,
                row.ExercisePrescriptionId,
                row.ExerciseId,
                row.ExerciseNameSnapshot,
                row.Occurrence,
                steps[0].Set.ExertionDisplayPreference,
                LastTimeStepRule.Read(coming, history[row.ExerciseId], todays[row.TimeZoneId])));
        }

        return standings;
    }
}
