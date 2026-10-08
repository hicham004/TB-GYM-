using System.Globalization;
using Microsoft.EntityFrameworkCore;
using TB.Gym.Modules.Strength;
using TB.Gym.Modules.Training;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// A new program starts where the client's latest one ended (P4c, STR-014): Assign program reads the maxes that
/// program uses now and what its logged sets suggest, and an assignment may carry a max over or take the
/// suggestion. Both keep their source on the new program's max. The latest program is the client's newest by
/// start date that was not cancelled, at the time of the read and again at the time of the assignment.
/// </summary>
internal sealed partial class TrainingApplicationService
{
    public async Task<PreviousProgramMaxesView?> GetPreviousProgramMaxesAsync(
        Guid clientProfileId,
        CancellationToken cancellationToken)
    {
        // The route names the client, so the tenant handler has already answered another coach's client as missing.
        if (!await dbContext.ClientProfiles.AsNoTracking()
                .AnyAsync(item => item.Id == clientProfileId, cancellationToken))
        {
            return null;
        }

        var previous = await LoadPreviousProgramAsync(clientProfileId, cancellationToken);
        if (previous is null)
        {
            return new PreviousProgramMaxesView(null, null, null, null, []);
        }

        // Suggestions read the client's workouts, so they follow the coach's training reads (TRN-023), and a
        // released client gets no new program to carry them into.
        var suggests = previous.Maxes.Count > 0 &&
                       !await coachClientScope.IsReleasedAsync(clientProfileId, cancellationToken) &&
                       await CoachMayReadLoggedSetsAsync(clientProfileId, cancellationToken);
        var sets = suggests
            ? await LoadLoggedSetsAsync(
                previous.Id,
                [.. previous.Maxes.Keys],
                [],
                previous.TimeZone,
                cancellationToken)
            : [];
        var keeps = suggests
            ? await LoggedSetMaxSuggestions.LoadLastKeepsAsync(dbContext, [previous.Id], cancellationToken)
            : [];
        var names = await ExerciseNamesAsync([.. previous.Maxes.Keys], cancellationToken);

        return new PreviousProgramMaxesView(
            previous.Id,
            previous.Name,
            previous.EndDateExclusive.AddDays(-1),
            previous.LoadUnit,
            previous.Maxes.Values
                .Select(max => new PreviousProgramMaxView(
                    max.ExerciseId,
                    names.GetValueOrDefault(max.ExerciseId, string.Empty),
                    max.Id,
                    max.Value,
                    previous.LoadUnit,
                    previous.LocalDate(max.CreatedAtUtc),
                    sets.TryGetValue(max.ExerciseId, out var logged)
                        ? SuggestionFor(
                            max,
                            keeps.GetValueOrDefault(max.Id)?.CreatedAtUtc,
                            logged,
                            previous.LoadUnit,
                            previous.LoadIncrement)
                        : null))
                .OrderBy(item => item.ExerciseName, StringComparer.OrdinalIgnoreCase)
                .ThenBy(item => item.ExerciseId)
                .ToArray());
    }

    /// <summary>
    /// The new program's first max for a lift, carried over from the latest program's max in use: the same
    /// lift, the same unit and the same value. A max that program has replaced since is refused.
    /// </summary>
    private static MesocycleWorkingMaxSnapshot CarryMax(
        Guid tenantId,
        Guid mesocycleId,
        Guid clientProfileId,
        WorkingMaxSelectionRequest selection,
        PreviousProgram? previous,
        string exerciseName)
    {
        var carried = previous?.Maxes.Values.SingleOrDefault(max => max.Id == selection.CarriedFromMaxId);
        if (previous is null || carried is null)
        {
            throw new ArgumentException(
                $"{exerciseName}'s max can only be carried over from the max the client's latest program uses now. Look at the maxes again.");
        }

        if (carried.ExerciseId != selection.ExerciseId || carried.Unit != ToStrengthUnit(selection.Unit) ||
            selection.Value is not { } value || carried.Value != decimal.Round(value, 3, MidpointRounding.AwayFromZero))
        {
            throw new ArgumentException(
                $"A max carried over keeps {exerciseName}'s lift, unit and value from \"{previous.Name}\"; type the number to change it.");
        }

        return MesocycleWorkingMaxSnapshot.CaptureCarried(
            tenantId,
            mesocycleId,
            clientProfileId,
            carried,
            string.Create(
                CultureInfo.InvariantCulture,
                $"Carried over from the previous program \"{previous.Name}\", where it was set on {previous.LocalDate(carried.CreatedAtUtc):ddd d MMM yyyy}."));
    }

    /// <summary>
    /// The new program's first max for a lift, estimated from the set the latest program's logged sets suggest
    /// (STR-012). The server works it out again, after any keep (STR-013), and accepts only the set the rule picks
    /// now; a newer best set is <see cref="TrainingMaxSuggestionChangedException"/>.
    /// </summary>
    private async Task<MesocycleWorkingMaxSnapshot> MaxFromPreviousLoggedSetAsync(
        Guid mesocycleId,
        Guid clientProfileId,
        WorkingMaxSelectionRequest selection,
        PreviousProgram? previous,
        string exerciseName,
        CancellationToken cancellationToken)
    {
        if (previous is null || !previous.Maxes.TryGetValue(selection.ExerciseId, out var current))
        {
            throw new ArgumentException(
                $"{exerciseName} has no training max in the client's latest program, so its logged sets suggest nothing.");
        }

        if (previous.LoadUnit != selection.Unit)
        {
            throw new ArgumentException(
                $"\"{previous.Name}\" weighs {exerciseName} in {UnitName(previous.LoadUnit)}; a max from its logged sets stays in that unit.");
        }

        if (!await CoachMayReadLoggedSetsAsync(clientProfileId, cancellationToken))
        {
            throw new ArgumentException(
                "This client's logged sets are not open to you now, so there is no suggestion to start from.");
        }

        var keeps = await LoggedSetMaxSuggestions.LoadLastKeepsAsync(dbContext, [previous.Id], cancellationToken);
        var sets = await LoadLoggedSetsAsync(
            previous.Id,
            [selection.ExerciseId],
            [],
            previous.TimeZone,
            cancellationToken);
        var estimate = ResolveLoggedSet(
            selection.LoggedSetId!.Value,
            exerciseName,
            current,
            keeps.GetValueOrDefault(current.Id)?.CreatedAtUtc,
            sets.GetValueOrDefault(selection.ExerciseId, []),
            previous.LoadUnit);
        return MesocycleWorkingMaxSnapshot.CaptureFromLoggedSet(
            tenantContext.TenantId,
            mesocycleId,
            clientProfileId,
            selection.ExerciseId,
            estimate,
            1,
            null,
            $"From the previous program \"{previous.Name}\". {LoggedReason(estimate, previous.LoadUnit)}");
    }

    /// <summary>The client's latest program that was not cancelled, with the max each lift uses now; null when none.</summary>
    private async Task<PreviousProgram?> LoadPreviousProgramAsync(
        Guid clientProfileId,
        CancellationToken cancellationToken)
    {
        var block = await dbContext.TrainingMesocycles.AsNoTracking()
            .Where(item => item.ClientProfileId == clientProfileId && item.Status != MesocycleStatus.Cancelled)
            .OrderByDescending(item => item.StartDate)
            .ThenByDescending(item => item.Id)
            .Select(item => new
            {
                item.Id,
                item.Name,
                item.EndDateExclusive,
                item.LoadUnit,
                item.LoadIncrement,
                item.TimeZoneId,
            })
            .FirstOrDefaultAsync(cancellationToken);
        if (block is null)
        {
            return null;
        }

        var snapshots = await dbContext.MesocycleWorkingMaxSnapshots.AsNoTracking()
            .Where(item => item.MesocycleId == block.Id)
            .ToListAsync(cancellationToken);
        return new PreviousProgram(
            block.Id,
            block.Name,
            block.EndDateExclusive,
            block.LoadUnit,
            block.LoadIncrement,
            TimeZoneInfo.FindSystemTimeZoneById(block.TimeZoneId),
            CurrentWorkingMaxes(snapshots));
    }

    private async Task<Dictionary<Guid, string>> ExerciseNamesAsync(Guid[] exerciseIds, CancellationToken cancellationToken) =>
        await dbContext.Exercises.AsNoTracking()
            .Where(item => exerciseIds.Contains(item.Id))
            .ToDictionaryAsync(item => item.Id, item => item.Name, cancellationToken);

    private sealed record PreviousProgram(
        Guid Id,
        string Name,
        DateOnly EndDateExclusive,
        TrainingLoadUnit LoadUnit,
        decimal LoadIncrement,
        TimeZoneInfo TimeZone,
        IReadOnlyDictionary<Guid, MesocycleWorkingMaxSnapshot> Maxes)
    {
        public DateOnly LocalDate(DateTimeOffset instant) =>
            DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(instant, TimeZone).DateTime);
    }
}
