using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using TB.Gym.Modules.Notifications;
using TB.Gym.Modules.Training;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// The client's training notices (ADR 0036, R5.1c): what a coach's change lets the client see that
/// they could not before, and what it changed that they could already see.
/// </summary>
/// <remarks>
/// Every coach command on a program takes the weeks the client can open before it changes anything,
/// and queues the notices just before it saves. Which weeks changed is read from the change tracker,
/// so any command that edits a week's sessions, exercises, sets, name or dates counts, without each
/// command describing its own changes. A week shared before its day says nothing: the client sees it
/// on that day, as every week arrives. Weeks are tracked by identity, since an edit can move them.
/// </remarks>
internal sealed partial class TrainingApplicationService
{
    /// <summary>The weeks of <paramref name="mesocycle"/> its client can open now.</summary>
    private HashSet<Guid> ClientVisibleWeeks(TrainingMesocycle mesocycle)
    {
        var now = clock.UtcNow;
        return mesocycle.Weeks
            .Where(week => TrainingCalendarPolicy.GetWeekAvailability(
                mesocycle.StartDate,
                week.WeekNumber,
                mesocycle.TimeZoneId,
                now,
                mesocycle.RevealAllWeeks,
                week.IsPublished).IsVisible)
            .Select(week => week.Id)
            .ToHashSet();
    }

    /// <summary>
    /// Queues "shared" for weeks the client can open now and could not before, and "updated" for weeks
    /// they could open before and still can whose content changed. Call it after the change and before
    /// saving, with what <see cref="ClientVisibleWeeks"/> said before the change.
    /// </summary>
    private async Task QueueClientWeekNoticesAsync(
        TrainingMesocycle mesocycle,
        HashSet<Guid> visibleBefore,
        CancellationToken cancellationToken)
    {
        if (mesocycle.Status is MesocycleStatus.Cancelled or MesocycleStatus.Completed)
        {
            return;
        }

        var visibleNow = ClientVisibleWeeks(mesocycle);
        var changed = ChangedWeekIds();
        var weeks = mesocycle.Weeks.ToDictionary(week => week.Id, week => week.WeekNumber);
        var shared = visibleNow.Where(id => !visibleBefore.Contains(id)).Select(id => weeks[id]).ToArray();
        var updated = visibleNow.Where(id => visibleBefore.Contains(id) && changed.Contains(id)).Select(id => weeks[id]).ToArray();
        if (shared.Length == 0 && updated.Length == 0)
        {
            return;
        }

        var clientUserId = await dbContext.ClientProfiles.AsNoTracking()
            .Where(profile => profile.Id == mesocycle.ClientProfileId && profile.ReleasedAtUtc == null)
            .Select(profile => profile.UserId)
            .SingleOrDefaultAsync(cancellationToken);
        if (clientUserId is not { } userId)
        {
            return;
        }

        var timeZone = await WorkspaceRelationshipNotices.TenantTimeZoneAsync(dbContext, tenantContext.TenantId, cancellationToken);
        var changeId = Guid.CreateVersion7();
        if (shared.Length > 0)
        {
            TrainingNotices.Weeks(dbContext, tenantContext.TenantId, timeZone, userId, mesocycle.ClientProfileId,
                mesocycle.Id, CommercialNotificationKind.WeeksShared, shared, changeId, clock.UtcNow);
        }

        if (updated.Length > 0)
        {
            TrainingNotices.Weeks(dbContext, tenantContext.TenantId, timeZone, userId, mesocycle.ClientProfileId,
                mesocycle.Id, CommercialNotificationKind.WeeksChanged, updated, changeId, clock.UtcNow);
        }
    }

    /// <summary>
    /// The weeks whose rows the pending save adds, changes or removes: a week's own name or dates, or
    /// anything under it. Sharing or unsharing alone is not a change of content.
    /// </summary>
    private HashSet<Guid> ChangedWeekIds()
    {
        dbContext.ChangeTracker.DetectChanges();
        var sessionWeeks = dbContext.ChangeTracker.Entries<TrainingSession>()
            .ToDictionary(entry => entry.Entity.Id, entry => entry.Entity.MesocycleWeekId);
        var exerciseWeeks = dbContext.ChangeTracker.Entries<ExercisePrescription>()
            .Where(entry => sessionWeeks.ContainsKey(entry.Entity.TrainingSessionId))
            .ToDictionary(entry => entry.Entity.Id, entry => sessionWeeks[entry.Entity.TrainingSessionId]);

        Guid? WeekOfExercise(Guid exerciseId) => exerciseWeeks.TryGetValue(exerciseId, out var week) ? week : null;

        var changed = new HashSet<Guid>();
        foreach (var entry in dbContext.ChangeTracker.Entries())
        {
            if (entry.State is not (EntityState.Added or EntityState.Modified or EntityState.Deleted))
            {
                continue;
            }

            Guid? week = entry.Entity switch
            {
                MesocycleWeek item when !OnlySharingChanged(entry) => item.Id,
                TrainingSession item => item.MesocycleWeekId,
                ExercisePrescription item => sessionWeeks.TryGetValue(item.TrainingSessionId, out var id) ? id : null,
                SetPrescription item => WeekOfExercise(item.ExercisePrescriptionId),
                ExercisePrescriptionAlternative item => WeekOfExercise(item.ExercisePrescriptionId),
                ExercisePrescriptionMediaSnapshot item => WeekOfExercise(item.ExercisePrescriptionId),
                _ => null,
            };
            if (week is { } weekId)
            {
                changed.Add(weekId);
            }
        }

        return changed;
    }

    private static bool OnlySharingChanged(EntityEntry entry) =>
        entry.State == EntityState.Modified &&
        entry.Properties.Where(property => property.IsModified).All(property =>
            property.Metadata.Name == nameof(MesocycleWeek.IsPublished));
}
