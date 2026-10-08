using Microsoft.EntityFrameworkCore;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Strength;
using TB.Gym.Modules.Training;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// The reads behind a suggested max (BestLoggedSet v1, STR-012) for one program or many: the logged sets that
/// could speak for a lift, the coach's last keep of each max (STR-013), and the suggestion they add up to. The
/// Training maxes panel and Coach Today both come here, so a lift suggests the same max on both. It only reads;
/// whether the caller may see a client's logged sets is the caller's to decide first (TRN-023).
/// </summary>
internal static class LoggedSetMaxSuggestions
{
    /// <summary>
    /// The logged sets of the programs' finished workouts that could speak for their lifts, by program and the
    /// exercise the client actually performed, plus any set named in <paramref name="includeSetIds"/>. The rule
    /// still decides which count; this only leaves out what never could (warm-ups, sets without reps, RPE or weight).
    /// </summary>
    /// <param name="timeZones">Each program's time zone, which dates its sets.</param>
    public static async Task<Dictionary<(Guid MesocycleId, Guid ExerciseId), LoggedSetEvidence[]>> LoadSetsAsync(
        GymDbContext dbContext,
        IReadOnlyDictionary<Guid, TimeZoneInfo> timeZones,
        Guid[] exerciseIds,
        Guid[] includeSetIds,
        CancellationToken cancellationToken)
    {
        if (timeZones.Count == 0 || (exerciseIds.Length == 0 && includeSetIds.Length == 0))
        {
            return [];
        }

        var mesocycleIds = timeZones.Keys.ToArray();
        var rows = await (
            from set in dbContext.WorkoutSetPerformances.AsNoTracking()
            join exercise in dbContext.WorkoutExercisePerformances.AsNoTracking()
                on new { set.TenantId, Id = set.WorkoutExercisePerformanceId } equals new { exercise.TenantId, exercise.Id }
            join workout in dbContext.WorkoutExecutions.AsNoTracking()
                on new { exercise.TenantId, Id = exercise.WorkoutExecutionId } equals new { workout.TenantId, workout.Id }
            join session in dbContext.TrainingSessions.AsNoTracking()
                on new { workout.TenantId, Id = workout.TrainingSessionId } equals new { session.TenantId, session.Id }
            join week in dbContext.MesocycleWeeks.AsNoTracking()
                on new { session.TenantId, Id = session.MesocycleWeekId } equals new { week.TenantId, week.Id }
            where mesocycleIds.Contains(workout.MesocycleId) &&
                  workout.Status == WorkoutExecutionStatus.Completed &&
                  workout.CompletedAtUtc != null &&
                  (includeSetIds.Contains(set.Id) ||
                   (exerciseIds.Contains(exercise.ActualExerciseId) &&
                    set.IsCompleted &&
                    set.SetTypeSnapshot != TrainingSetType.WarmUp &&
                    set.ActualRepetitions >= BestLoggedSetRule.MinimumRepetitions &&
                    set.ActualRepetitions <= BestLoggedSetRule.MaximumRepetitions &&
                    set.ActualRpe >= BestLoggedSetRule.MinimumRpe &&
                    set.ActualLoad > 0m &&
                    set.ActualLoadUnit != null))
            select new
            {
                set.Id,
                workout.MesocycleId,
                exercise.ActualExerciseId,
                week.WeekNumber,
                CompletedAtUtc = workout.CompletedAtUtc!.Value,
                workout.SessionNameSnapshot,
                set.SetTypeSnapshot,
                set.IsCompleted,
                set.ActualRepetitions,
                set.ActualLoad,
                set.ActualLoadUnit,
                set.ActualRpe,
            })
            .ToListAsync(cancellationToken);
        return rows
            .GroupBy(row => (row.MesocycleId, row.ActualExerciseId))
            .ToDictionary(
                group => group.Key,
                group => group.Select(row => new LoggedSetEvidence(
                    row.Id,
                    row.WeekNumber,
                    DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(row.CompletedAtUtc, timeZones[row.MesocycleId]).DateTime),
                    row.CompletedAtUtc,
                    row.SessionNameSnapshot,
                    row.SetTypeSnapshot == TrainingSetType.WarmUp,
                    row.IsCompleted,
                    row.ActualRepetitions,
                    row.ActualLoad,
                    row.ActualLoadUnit is { } unit ? ToStrengthUnit(unit) : null,
                    row.ActualRpe)).ToArray());
    }

    /// <summary>The coach's latest keep of each max of these programs (STR-013), by the max kept.</summary>
    public static async Task<Dictionary<Guid, WorkingMaxKeep>> LoadLastKeepsAsync(
        GymDbContext dbContext,
        Guid[] mesocycleIds,
        CancellationToken cancellationToken)
    {
        if (mesocycleIds.Length == 0)
        {
            return [];
        }

        var keeps = await dbContext.WorkingMaxKeeps.AsNoTracking()
            .Where(item => mesocycleIds.Contains(item.MesocycleId))
            .ToListAsync(cancellationToken);
        return keeps
            .GroupBy(item => item.WorkingMaxSnapshotId)
            .ToDictionary(
                group => group.Key,
                group => group.OrderByDescending(item => item.CreatedAtUtc).ThenByDescending(item => item.Id).First());
    }

    /// <summary>When sets start to count for this max: after it was set, or after the coach last kept it.</summary>
    public static DateTimeOffset CountsAfter(MesocycleWorkingMaxSnapshot current, DateTimeOffset? lastKeptAtUtc) =>
        BestLoggedSetRule.CountsAfter(current.CreatedAtUtc, lastKeptAtUtc);

    /// <summary>The set the rule picks for this max now, whether or not it is worth showing; null when none counts.</summary>
    public static LoggedSetMaxEstimate? Best(
        MesocycleWorkingMaxSnapshot current,
        DateTimeOffset? lastKeptAtUtc,
        IReadOnlyCollection<LoggedSetEvidence> sets,
        TrainingLoadUnit unit) =>
        BestLoggedSetRule.Best(sets, ToStrengthUnit(unit), CountsAfter(current, lastKeptAtUtc));

    /// <summary>The suggestion for one lift: the rule's pick, only while it moves the max by more than one rounding step.</summary>
    public static LoggedSetMaxEstimate? Suggest(
        MesocycleWorkingMaxSnapshot current,
        DateTimeOffset? lastKeptAtUtc,
        IReadOnlyCollection<LoggedSetEvidence> sets,
        TrainingLoadUnit unit,
        decimal roundingStep)
    {
        var best = Best(current, lastKeptAtUtc, sets, unit);
        return best is not null && BestLoggedSetRule.IsWorthSuggesting(current.Value, best.Estimate.Value, roundingStep)
            ? best
            : null;
    }

    private static LoadUnit ToStrengthUnit(TrainingLoadUnit unit) => unit switch
    {
        TrainingLoadUnit.Kilogram => LoadUnit.Kilogram,
        TrainingLoadUnit.Pound => LoadUnit.Pound,
        _ => throw new ArgumentOutOfRangeException(nameof(unit)),
    };
}
