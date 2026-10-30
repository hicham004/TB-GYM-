using Microsoft.EntityFrameworkCore;
using TB.Gym.Modules.Progress;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// A client's starting weight (critique B6, PRG-014): read for their coach with the dashboard, and
/// corrected by staff with a reason.
/// </summary>
internal sealed partial class ProgressApplicationService
{
    public async Task<StartingWeightCommandResult> CorrectStartingWeightForClientAsync(
        Guid clientProfileId,
        CorrectStartingWeightRequest request,
        CancellationToken cancellationToken)
    {
        // As every coach write here: a blocked relationship is refused, an unknown client is not found.
        // Another coach's client and a released one are refused before this, by the route's client check.
        var blocked = await FindClientRelationshipAsync(clientProfileId, cancellationToken);
        if (blocked is null || currentUser.UserId is not { } actorUserId)
        {
            return new StartingWeightCommandResult(ProgressCommandStatus.NotFound);
        }

        if (blocked is true)
        {
            return new StartingWeightCommandResult(ProgressCommandStatus.Forbidden);
        }

        var start = await dbContext.StartingWeights.SingleOrDefaultAsync(
            item => item.ClientProfileId == clientProfileId,
            cancellationToken);
        if (start is null)
        {
            return new StartingWeightCommandResult(ProgressCommandStatus.NotFound);
        }

        try
        {
            var calendar = await GetTenantCalendarAsync(cancellationToken);
            if (request.MeasurementDate > calendar.Today)
            {
                return StartInvalid("measurementDate", "The start cannot be dated in the future.");
            }

            dbContext.Entry(start).Property(item => item.Version).OriginalValue = request.Version;
            dbContext.StartingWeightCorrections.Add(start.Correct(
                request.MeasurementDate,
                request.Value,
                request.Unit,
                request.Reason,
                clock.UtcNow,
                actorUserId));
            await dbContext.SaveChangesAsync(cancellationToken);
            return new StartingWeightCommandResult(
                ProgressCommandStatus.Success,
                await StartViewAsync(start, cancellationToken));
        }
        catch (ArgumentException exception)
        {
            return StartInvalid("startingWeight", exception.PersonMessage());
        }
        catch (DbUpdateConcurrencyException)
        {
            return new StartingWeightCommandResult(
                ProgressCommandStatus.Conflict,
                Code: "StartingWeightVersionConflict",
                Message: "The starting weight changed. Reload it before correcting it again.");
        }
    }

    /// <summary>
    /// The person's starts in this workspace up to the profile read, and the change since the first. A
    /// returning client has an older, ended profile (CLI-016) whose start is where they first began, so
    /// it is read here for their coach; another workspace's profiles never are (the tenant filter).
    /// </summary>
    private async Task<DashboardStart> BuildDashboardStartAsync(
        Guid clientProfileId,
        WorkspaceCalendar calendar,
        RecordedMassUnit displayUnit,
        CancellationToken cancellationToken)
    {
        var userId = await dbContext.ClientProfiles
            .AsNoTracking()
            .Where(item => item.Id == clientProfileId)
            .Select(item => item.UserId)
            .SingleAsync(cancellationToken);
        // Oldest first, ties broken by the time-ordered id, and none after the profile read: an older
        // profile is never told of a later comeback.
        var profileIds = userId is null
            ? [clientProfileId]
            : (await dbContext.ClientProfiles
                .AsNoTracking()
                .Where(item => item.UserId == userId)
                .OrderBy(item => item.CreatedAtUtc)
                .ThenBy(item => item.Id)
                .Select(item => item.Id)
                .ToArrayAsync(cancellationToken))
                .TakeWhile(id => id != clientProfileId)
                .Append(clientProfileId)
                .ToArray();
        var stored = await dbContext.StartingWeights
            .AsNoTracking()
            .Where(item => profileIds.Contains(item.ClientProfileId))
            .ToDictionaryAsync(item => item.ClientProfileId, cancellationToken);
        var starts = profileIds
            .Where(stored.ContainsKey)
            .Select(id => stored[id])
            .ToArray();
        if (starts.Length == 0)
        {
            return new DashboardStart([], null, null);
        }

        var lines = starts
            .Select((start, index) => new DashboardStartLine(
                start.ClientProfileId,
                index == 0 ? DashboardStartKind.Started : DashboardStartKind.CameBack,
                start.MeasurementDate,
                start.ValueKilograms,
                BodyweightUnitConverter.FromKilograms(start.ValueKilograms, displayUnit)))
            .ToArray();
        var first = starts[0];
        var current = stored.GetValueOrDefault(clientProfileId);
        return new DashboardStart(
            lines,
            await SinceStartAsync(first, clientProfileId, calendar.WeekStartsOn, displayUnit, cancellationToken),
            current is null ? null : await StartViewAsync(current, cancellationToken));
    }

    private async Task<DashboardSinceStart?> SinceStartAsync(
        StartingWeight first,
        Guid readProfileId,
        DayOfWeek weekStartsOn,
        RecordedMassUnit displayUnit,
        CancellationToken cancellationToken)
    {
        // Two weeks of weigh-ins are all the comparison reads: the first start's week, of the profile it
        // belongs to, and the latest week the profile read has a weigh-in in. Voided entries are not
        // current truth, so neither week counts them.
        var startWeek = BodyweightWeekPolicy.GetWeekStart(first.MeasurementDate, weekStartsOn);
        var startSamples = await WeekSamplesAsync(first.ClientProfileId, startWeek, cancellationToken);
        var latestDate = await dbContext.BodyweightObservations
            .AsNoTracking()
            .Where(item => item.ClientProfileId == readProfileId && item.Status == BodyweightObservationStatus.Active)
            .MaxAsync(item => (DateOnly?)item.MeasurementDate, cancellationToken);
        if (latestDate is null)
        {
            return null;
        }

        var latestSamples = await WeekSamplesAsync(
            readProfileId,
            BodyweightWeekPolicy.GetWeekStart(latestDate.Value, weekStartsOn),
            cancellationToken);
        var result = BodyweightSinceStart.Calculate(first.MeasurementDate, startSamples, latestSamples, weekStartsOn);
        return result is null
            ? null
            : new DashboardSinceStart(
                BodyweightSinceStart.MethodKey,
                BodyweightSinceStart.MethodVersion,
                result.StartWeek.WeekStart,
                result.StartWeek.MeanKilograms,
                result.StartWeek.ObservedDayCount,
                result.LatestWeek.WeekStart,
                result.LatestWeek.MeanKilograms,
                result.LatestWeek.ObservedDayCount,
                result.DeltaKilograms,
                BodyweightUnitConverter.FromKilograms(result.DeltaKilograms, displayUnit),
                result.Percent);
    }

    private async Task<BodyweightTrendSample[]> WeekSamplesAsync(
        Guid clientProfileId,
        DateOnly weekStart,
        CancellationToken cancellationToken)
    {
        var weekEnd = weekStart.AddDays(7);
        return await dbContext.BodyweightObservations
            .AsNoTracking()
            .Where(item =>
                item.ClientProfileId == clientProfileId &&
                item.Status == BodyweightObservationStatus.Active &&
                item.MeasurementDate >= weekStart &&
                item.MeasurementDate < weekEnd)
            .Select(item => new BodyweightTrendSample(item.MeasurementDate, item.ValueKilograms))
            .ToArrayAsync(cancellationToken);
    }

    private async Task<StartingWeightView> StartViewAsync(StartingWeight start, CancellationToken cancellationToken)
    {
        var corrections = await dbContext.StartingWeightCorrections
            .AsNoTracking()
            .Where(item => item.StartingWeightId == start.Id)
            .OrderByDescending(item => item.SupersededAtUtc)
            .ThenByDescending(item => item.Id)
            .ToArrayAsync(cancellationToken);
        var actorIds = corrections.Select(item => item.SupersededByUserId).Distinct().ToArray();
        var names = actorIds.Length == 0
            ? new Dictionary<Guid, string>()
            : await dbContext.Users
                .AsNoTracking()
                .Where(user => actorIds.Contains(user.Id))
                .ToDictionaryAsync(user => user.Id, user => user.DisplayName, cancellationToken);
        return new StartingWeightView(
            start.Id,
            start.ClientProfileId,
            start.MeasurementDate,
            start.ValueKilograms,
            start.EnteredValue,
            start.EnteredUnit,
            start.Origin,
            start.Version,
            corrections
                .Select(item => new StartingWeightCorrectionView(
                    item.Id,
                    item.MeasurementDate,
                    item.ValueKilograms,
                    item.EnteredValue,
                    item.EnteredUnit,
                    item.Reason,
                    item.SupersededByUserId,
                    names.GetValueOrDefault(item.SupersededByUserId, string.Empty),
                    item.SupersededAtUtc))
                .ToArray());
    }

    private static StartingWeightCommandResult StartInvalid(string field, string message) =>
        new(
            ProgressCommandStatus.Invalid,
            Errors: new Dictionary<string, string[]> { [field] = [message] });
}
