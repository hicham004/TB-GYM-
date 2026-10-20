using System.Globalization;
using Microsoft.EntityFrameworkCore;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Strength;
using TB.Gym.Modules.Training;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// The max a client's logged sets suggest (P4b, BestLoggedSet v1, STR-007). The Training maxes panel reads
/// it, and the coach applies it through the usual preview or keeps the max in use (STR-013); nothing here
/// changes a max. It reads the client's finished workouts, so it follows the coach's training reads (TRN-023):
/// no suggestion, and no applying or keeping one, while those are closed.
/// </summary>
internal sealed partial class TrainingApplicationService
{
    public async Task<TrainingCommandResult> KeepTrainingMaxAsync(
        Guid mesocycleId,
        KeepTrainingMaxRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (request.ExerciseId == Guid.Empty || request.LoggedSetId == Guid.Empty)
        {
            return Invalid("maxes", "Name the lift and the logged set behind its suggestion.");
        }

        // The write loader answers another coach's client as missing and refuses a released client (ADR 0026, 0027).
        var mesocycle = await LoadMesocycleAsync(mesocycleId, tracking: true, cancellationToken);
        if (mesocycle is null)
        {
            return NotFound();
        }

        if (mesocycle.Status is MesocycleStatus.Completed or MesocycleStatus.Cancelled)
        {
            return Conflict("program_closed", "A finished or cancelled program keeps its training maxes.");
        }

        if (!await CoachMayReadLoggedSetsAsync(mesocycle.ClientProfileId, cancellationToken))
        {
            return Invalid("maxes", "This client's logged sets are not open to you now, so there is no suggestion to keep.");
        }

        var snapshots = await dbContext.MesocycleWorkingMaxSnapshots.AsNoTracking()
            .Where(item => item.MesocycleId == mesocycleId)
            .ToListAsync(cancellationToken);
        if (!CurrentWorkingMaxes(snapshots).TryGetValue(request.ExerciseId, out var current))
        {
            return Invalid("maxes", "That lift does not use a training max in this program.");
        }

        // A retried keep finds the one it saved and answers as the first did.
        if (!await dbContext.WorkingMaxKeeps.AsNoTracking().AnyAsync(
                item => item.WorkingMaxSnapshotId == current.Id && item.LoggedSetPerformanceId == request.LoggedSetId,
                cancellationToken))
        {
            var lastKeeps = await LoggedSetMaxSuggestions.LoadLastKeepsAsync(dbContext, [mesocycleId], cancellationToken);
            var sets = await LoadLoggedSetsAsync(
                mesocycleId,
                [request.ExerciseId],
                [],
                TimeZoneInfo.FindSystemTimeZoneById(mesocycle.TimeZoneId),
                cancellationToken);
            var name = mesocycle.Weeks
                .SelectMany(week => week.Sessions)
                .SelectMany(session => session.Exercises)
                .FirstOrDefault(exercise => exercise.ExerciseId == request.ExerciseId)?.ExerciseNameSnapshot ?? "This lift";
            try
            {
                var kept = ResolveLoggedSet(
                    request.LoggedSetId,
                    name,
                    current,
                    lastKeeps.GetValueOrDefault(current.Id)?.CreatedAtUtc,
                    sets.GetValueOrDefault(request.ExerciseId, []),
                    mesocycle.LoadUnit);
                dbContext.WorkingMaxKeeps.Add(WorkingMaxKeep.Record(
                    tenantContext.TenantId,
                    mesocycleId,
                    current.Id,
                    kept.Set.SetId,
                    kept.Estimate.Value,
                    ToStrengthUnit(mesocycle.LoadUnit)));
                await dbContext.SaveChangesAsync(cancellationToken);
            }
            catch (TrainingMaxSuggestionChangedException exception)
            {
                return Conflict(TrainingMaxSuggestionChangedException.Code, exception.PersonMessage());
            }
            catch (ArgumentException exception)
            {
                return Invalid("maxes", exception.PersonMessage());
            }
            catch (DbUpdateException exception) when (exception.InnerException is Npgsql.PostgresException
                       {
                           SqlState: Npgsql.PostgresErrorCodes.UniqueViolation,
                           ConstraintName: DatabaseConstraintNames.OneKeepPerTrainingMaxAndSet,
                       })
            {
                // The same keep, sent twice at once: the other one saved it.
                dbContext.ChangeTracker.Clear();
            }
        }

        var view = await GetTrainingMaxesAsync(mesocycleId, cancellationToken);
        return view is null ? NotFound() : new TrainingCommandResult(TrainingCommandStatus.Success, TrainingMaxes: view);
    }

    /// <summary>One program's logged sets that could speak for its lifts, by the exercise actually performed.</summary>
    private async Task<Dictionary<Guid, LoggedSetEvidence[]>> LoadLoggedSetsAsync(
        Guid mesocycleId,
        Guid[] exerciseIds,
        Guid[] includeSetIds,
        TimeZoneInfo timeZone,
        CancellationToken cancellationToken) =>
        (await LoggedSetMaxSuggestions.LoadSetsAsync(
            dbContext,
            new Dictionary<Guid, TimeZoneInfo> { [mesocycleId] = timeZone },
            exerciseIds,
            includeSetIds,
            cancellationToken))
        .ToDictionary(item => item.Key.ExerciseId, item => item.Value);

    /// <summary>The coach reads a client's logged sets on the same terms as their program and workouts (TRN-023).</summary>
    private async Task<bool> CoachMayReadLoggedSetsAsync(Guid clientProfileId, CancellationToken cancellationToken) =>
        (await GetCoachTrainingAccessAsync(clientProfileId, cancellationToken)).IsAllowed;

    /// <summary>
    /// The suggestion for one lift: the rule's best set since the max in use was set or last kept, shown only
    /// while it moves that max by more than one rounding step.
    /// </summary>
    private static TrainingMaxSuggestionView? SuggestionFor(
        MesocycleWorkingMaxSnapshot current,
        DateTimeOffset? lastKeptAtUtc,
        IReadOnlyCollection<LoggedSetEvidence> sets,
        TrainingLoadUnit unit,
        decimal roundingStep)
    {
        var best = LoggedSetMaxSuggestions.Suggest(current, lastKeptAtUtc, sets, unit, roundingStep);
        return best is null
            ? null
            : new TrainingMaxSuggestionView(
                best.Estimate.Value,
                unit,
                LoggedBasisView(best),
                LoggedExplanation(best, unit));
    }

    /// <summary>
    /// The logged set a coach picked for a lift, worked out again here: it has to be the one the rule picks
    /// now, so a max is never estimated from, or kept over, a set the suggestion did not name. A newer best set
    /// is <see cref="TrainingMaxSuggestionChangedException"/>, so the coach can be told what moved.
    /// </summary>
    private static LoggedSetMaxEstimate ResolveLoggedSet(
        Guid loggedSetId,
        string exerciseName,
        MesocycleWorkingMaxSnapshot current,
        DateTimeOffset? lastKeptAtUtc,
        IReadOnlyCollection<LoggedSetEvidence> sets,
        TrainingLoadUnit unit)
    {
        var chosen = sets.SingleOrDefault(set => set.SetId == loggedSetId);
        var since = LoggedSetMaxSuggestions.CountsAfter(current, lastKeptAtUtc);
        if (chosen is null || !BestLoggedSetRule.Counts(chosen, ToStrengthUnit(unit), since))
        {
            // A set that still counts for the max in use but came before the coach kept it was weighed already:
            // the suggestion the coach looked at has moved on.
            if (chosen is not null && BestLoggedSetRule.Counts(chosen, ToStrengthUnit(unit), current.CreatedAtUtc))
            {
                throw SuggestionChanged(exerciseName);
            }

            throw new ArgumentException(
                $"That logged set cannot suggest {exerciseName}'s max: only a finished working set of 1 to 8 reps " +
                "at RPE 7 to 10, in the program's unit, logged after the max in use was set, can.");
        }

        var best = LoggedSetMaxSuggestions.Best(current, lastKeptAtUtc, sets, unit)!;
        return best.Set.SetId == loggedSetId ? best : throw SuggestionChanged(exerciseName);
    }

    private static TrainingMaxSuggestionChangedException SuggestionChanged(string exerciseName) =>
        new($"{exerciseName} has a newer logged set than the one you looked at, so its suggested max changed. Look at it again.");

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
