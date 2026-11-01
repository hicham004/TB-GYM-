using Microsoft.EntityFrameworkCore;
using TB.Gym.Modules.Training;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// Whether a client keeps seeing the programs that finished (TRN-031, critique B19): the coach's choice,
/// on by default. The server applies it to what the client's Training page reads, so a program hidden
/// here reaches no screen; running and next programs, and the client's own workouts, never come this way.
/// </summary>
internal sealed partial class TrainingApplicationService
{
    /// <summary>The choice as the coach's program read gives it: the default, version 0, until one is made.</summary>
    private async Task<FinishedProgramsVisibilityView> ReadFinishedProgramsVisibilityAsync(
        Guid clientProfileId,
        CancellationToken cancellationToken) =>
        await dbContext.ClientProgramVisibilities.AsNoTracking()
            .Where(item => item.ClientProfileId == clientProfileId)
            .Select(item => new FinishedProgramsVisibilityView(item.CanSeeFinishedPrograms, item.Version))
            .SingleOrDefaultAsync(cancellationToken)
        ?? new FinishedProgramsVisibilityView(true, 0);

    /// <summary>
    /// The programs this client reads as finished by <paramref name="today"/> (TRN-030): none while the
    /// coach keeps them back. A cancelled program is never among them, whatever the coach chose.
    /// </summary>
    private IQueryable<TrainingMesocycle> FinishedProgramsShownTo(Guid clientProfileId, DateOnly today) =>
        dbContext.TrainingMesocycles.AsNoTracking()
            .Where(item => item.ClientProfileId == clientProfileId)
            .Where(FinishedBy(today))
            .Where(item => !dbContext.ClientProgramVisibilities.Any(choice =>
                choice.ClientProfileId == clientProfileId && !choice.CanSeeFinishedPrograms));

    public async Task<TrainingCommandResult> SetFinishedProgramsVisibilityAsync(
        Guid clientProfileId,
        SetFinishedProgramsVisibilityRequest request,
        CancellationToken cancellationToken)
    {
        if (!await dbContext.ClientProfiles.AsNoTracking()
                .AnyAsync(item => item.Id == clientProfileId, cancellationToken))
        {
            return NotFound();
        }

        // The choice sits on the coach's Training tab, so it opens and closes with their read (TRN-023).
        if (!(await GetCoachTrainingAccessAsync(clientProfileId, cancellationToken)).IsAllowed)
        {
            return new TrainingCommandResult(TrainingCommandStatus.Forbidden);
        }

        var choice = await dbContext.ClientProgramVisibilities
            .SingleOrDefaultAsync(item => item.ClientProfileId == clientProfileId, cancellationToken);
        if (choice is null && request.Version != 0)
        {
            return FinishedProgramsChanged();
        }

        try
        {
            if (choice is null)
            {
                choice = ClientProgramVisibility.Choose(
                    tenantContext.TenantId, clientProfileId, request.CanSeeFinishedPrograms);
                dbContext.ClientProgramVisibilities.Add(choice);
            }
            else
            {
                dbContext.Entry(choice).Property(item => item.Version).OriginalValue = request.Version;
                choice.SetCanSeeFinishedPrograms(request.CanSeeFinishedPrograms);
            }

            await dbContext.SaveChangesAsync(cancellationToken);
            return new TrainingCommandResult(
                TrainingCommandStatus.Success,
                FinishedPrograms: new FinishedProgramsVisibilityView(choice.CanSeeFinishedPrograms, choice.Version));
        }
        catch (DbUpdateConcurrencyException)
        {
            return FinishedProgramsChanged();
        }
        catch (DbUpdateException exception) when (IsUniqueViolation(exception))
        {
            // Two first choices at once: one row per client, so the second reads the first and asks again.
            return FinishedProgramsChanged();
        }
    }

    private static TrainingCommandResult FinishedProgramsChanged() =>
        Conflict(
            "finished_programs_changed",
            "This was changed somewhere else since you opened it. It has been reloaded: check it, then try again.");
}
