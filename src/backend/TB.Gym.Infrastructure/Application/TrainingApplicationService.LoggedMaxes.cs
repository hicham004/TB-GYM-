using System.Globalization;
using Microsoft.EntityFrameworkCore;
using TB.Gym.Modules.Strength;
using TB.Gym.Modules.Training;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// The max a client's logged sets suggest (P4b, BestLoggedSet v1, STR-007). The Training maxes panel reads
/// it, and the coach applies it through the usual preview; nothing here changes a max. It reads the client's
/// finished workouts, so it follows the coach's training reads (TRN-023): no suggestion, and no applying
/// one, while those are closed.
/// </summary>
internal sealed partial class TrainingApplicationService
{
    /// <summary>
    /// The logged sets of a program's finished workouts that could speak for its lifts, by the exercise the
    /// client actually performed, plus any set a max was already estimated from. The rule still decides which
    /// count; this only leaves out what never could (warm-ups, sets without reps, RPE or weight).
    /// </summary>
    private async Task<Dictionary<Guid, LoggedSetEvidence[]>> LoadLoggedSetsAsync(
        Guid mesocycleId,
        Guid[] exerciseIds,
        Guid[] includeSetIds,
        TimeZoneInfo timeZone,
        CancellationToken cancellationToken)
    {
        if (exerciseIds.Length == 0 && includeSetIds.Length == 0)
        {
            return [];
        }

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
            where workout.MesocycleId == mesocycleId &&
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
            .GroupBy(row => row.ActualExerciseId)
            .ToDictionary(
                group => group.Key,
                group => group.Select(row => new LoggedSetEvidence(
                    row.Id,
                    row.WeekNumber,
                    DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(row.CompletedAtUtc, timeZone).DateTime),
                    row.CompletedAtUtc,
                    row.SessionNameSnapshot,
                    row.SetTypeSnapshot == TrainingSetType.WarmUp,
                    row.IsCompleted,
                    row.ActualRepetitions,
                    row.ActualLoad,
                    row.ActualLoadUnit is { } unit ? ToStrengthUnit(unit) : null,
                    row.ActualRpe)).ToArray());
    }

    /// <summary>The coach reads a client's logged sets on the same terms as their program and workouts (TRN-023).</summary>
    private async Task<bool> CoachMayReadLoggedSetsAsync(Guid clientProfileId, CancellationToken cancellationToken) =>
        (await GetCoachTrainingAccessAsync(clientProfileId, cancellationToken)).IsAllowed;

    /// <summary>
    /// The suggestion for one lift: the rule's best set since the max in use was set, shown only while it
    /// moves that max by more than one rounding step.
    /// </summary>
    private static TrainingMaxSuggestionView? SuggestionFor(
        MesocycleWorkingMaxSnapshot current,
        IReadOnlyCollection<LoggedSetEvidence> sets,
        TrainingLoadUnit unit,
        decimal roundingStep)
    {
        var best = BestLoggedSetRule.Best(sets, ToStrengthUnit(unit), current.CreatedAtUtc);
        return best is null || !BestLoggedSetRule.IsWorthSuggesting(current.Value, best.Estimate.Value, roundingStep)
            ? null
            : new TrainingMaxSuggestionView(
                best.Estimate.Value,
                unit,
                LoggedBasisView(best),
                LoggedExplanation(best, unit));
    }

    /// <summary>
    /// The logged set a coach picked for a lift, worked out again here: it has to be the one the rule picks
    /// now, so a max is never estimated from a set the suggestion did not name.
    /// </summary>
    private static LoggedSetMaxEstimate ResolveLoggedSet(
        Guid loggedSetId,
        string exerciseName,
        MesocycleWorkingMaxSnapshot current,
        IReadOnlyCollection<LoggedSetEvidence> sets,
        TrainingLoadUnit unit)
    {
        var strengthUnit = ToStrengthUnit(unit);
        var chosen = sets.SingleOrDefault(set => set.SetId == loggedSetId);
        if (chosen is null || !BestLoggedSetRule.Counts(chosen, strengthUnit, current.CreatedAtUtc))
        {
            throw new ArgumentException(
                $"That logged set cannot suggest {exerciseName}'s max: only a finished working set of 1 to 8 reps " +
                "at RPE 7 to 10, in the program's unit, logged after the max in use was set, can.");
        }

        var best = BestLoggedSetRule.Best(sets, strengthUnit, current.CreatedAtUtc)!;
        if (best.Set.SetId != loggedSetId)
        {
            throw new InvalidOperationException(
                $"{exerciseName} has newer logged sets than this suggestion. Read the training maxes again.");
        }

        return best;
    }

    private static TrainingMaxBasisView LoggedBasisView(LoggedSetMaxEstimate estimate) =>
        new(
            estimate.Set.Load!.Value,
            estimate.Set.Repetitions!.Value,
            estimate.Set.Rpe!.Value,
            estimate.Estimate.StrategyKey,
            estimate.Estimate.Version,
            LoggedSetView(estimate.Set));

    private static TrainingMaxLoggedSetView LoggedSetView(LoggedSetEvidence set) =>
        new(set.SetId, set.WeekNumber, set.PerformedOn, set.SessionName);

    /// <summary>The rule, the set and the chart, in one sentence the coach can check by hand.</summary>
    private static string LoggedExplanation(LoggedSetMaxEstimate estimate, TrainingLoadUnit unit)
    {
        var set = estimate.Set;
        return string.Create(
            CultureInfo.InvariantCulture,
            $"Best logged set v1: the best set of week {set.WeekNumber} was {set.Load:0.###} {UnitName(unit)} for {set.Repetitions} reps at RPE {set.Rpe:0.#} on {set.PerformedOn:ddd d MMM yyyy}. {estimate.Estimate.Explanation}");
    }

    /// <summary>The reason kept with a max estimated from a logged set when the coach gives none.</summary>
    private static string LoggedReason(LoggedSetMaxEstimate estimate, TrainingLoadUnit unit)
    {
        var set = estimate.Set;
        return string.Create(
            CultureInfo.InvariantCulture,
            $"Estimated from logged sets, week {set.WeekNumber}: {set.Load:0.###} {UnitName(unit)} for {set.Repetitions} reps at RPE {set.Rpe:0.#} on {set.PerformedOn:ddd d MMM yyyy}.");
    }
}
