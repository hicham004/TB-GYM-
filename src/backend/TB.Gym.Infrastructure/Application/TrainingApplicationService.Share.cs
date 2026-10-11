using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore;
using TB.Gym.Modules.Training;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// A finished program's facts for the client's share card (R6.1a, TRN-030). The card is made on the
/// client's phone from these facts and the finish summary's records; the server keeps nothing of it.
/// </summary>
internal sealed partial class TrainingApplicationService
{
    public async Task<ClientProgramSummaryResult?> GetMyProgramSummaryAsync(
        Guid programId,
        CancellationToken cancellationToken)
    {
        var client = await FindSelfClientAsync(cancellationToken);
        var access = client is null ? null : await GetTrainingAccessAsync(client.Id, cancellationToken);
        if (client is null || access is not { IsAllowed: true })
        {
            return new(false, (access?.Reason ?? FeatureAccessReason.MembershipInactive).ToString(), null);
        }

        var today = await GetTenantTodayAsync(cancellationToken);
        var program = await dbContext.TrainingMesocycles.AsNoTracking()
            .Where(item => item.Id == programId && item.ClientProfileId == client.Id)
            .Where(FinishedBy(today))
            .Select(item => new FinishedProgramRow(item.Id, item.ClientProfileId, item.Name, item.StartDate,
                item.EndDateExclusive))
            .SingleOrDefaultAsync(cancellationToken);
        return program is null
            ? null
            : new(true, access.Reason.ToString(), await SummarizeProgramAsync(program, cancellationToken));
    }

    /// <summary>
    /// A program the client has finished by <paramref name="today"/> (TRN-030): every session done, or its
    /// last day behind it, and never cancelled. The Training page calls the same program finished.
    /// </summary>
    private static Expression<Func<TrainingMesocycle, bool>> FinishedBy(DateOnly today) =>
        item => item.Status != MesocycleStatus.Cancelled && item.StartDate <= today &&
                (item.Status == MesocycleStatus.Completed || item.EndDateExclusive <= today);

    /// <summary>
    /// Its weeks, the workouts finished in it, and the records each of those set against the workouts
    /// finished before it started: the records the finish summary and history showed (TRN-019).
    /// </summary>
    private async Task<ClientProgramSummaryView> SummarizeProgramAsync(
        FinishedProgramRow program,
        CancellationToken cancellationToken)
    {
        var weekCount = await dbContext.MesocycleWeeks.AsNoTracking()
            .CountAsync(item => item.MesocycleId == program.Id, cancellationToken);
        var workouts = await dbContext.WorkoutExecutions.AsNoTracking()
            .Where(item => item.MesocycleId == program.Id && item.Status == WorkoutExecutionStatus.Completed)
            .Include(item => item.Exercises).ThenInclude(item => item.Sets)
            .AsSplitQuery()
            .ToListAsync(cancellationToken);
        var earlier = workouts.Count == 0
            ? []
            : await LoadEarlierSetsAsync(
                program.ClientProfileId,
                workouts.SelectMany(item => item.Exercises).Select(item => item.ActualExerciseId)
                    .Distinct().ToArray(),
                workouts.Max(item => item.StartedAtUtc),
                cancellationToken);
        var records = workouts.Sum(workout => SummarizeWorkout(workout, earlier.Where(set =>
            set.WorkoutId != workout.Id && set.CompletedAtUtc <= workout.StartedAtUtc)).PersonalRecords.Count);
        return new ClientProgramSummaryView(
            program.Id,
            program.Name,
            program.StartDate,
            program.EndDateExclusive,
            weekCount,
            workouts.Count,
            records,
            WorkoutPersonalRecordRule.Key,
            WorkoutPersonalRecordRule.Version);
    }

    private sealed record FinishedProgramRow(
        Guid Id,
        Guid ClientProfileId,
        string Name,
        DateOnly StartDate,
        DateOnly EndDateExclusive);
}
