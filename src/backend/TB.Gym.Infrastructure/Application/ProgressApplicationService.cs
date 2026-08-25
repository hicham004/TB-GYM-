using Microsoft.EntityFrameworkCore;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Media;
using TB.Gym.Modules.Progress;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

internal sealed partial class ProgressApplicationService(
    GymDbContext dbContext,
    IClock clock,
    ICurrentUser currentUser,
    ITenantContext tenantContext,
    IMediaApplicationService mediaService,
    ICoachingFeatureAccessService featureAccessService)
    : IProgressApplicationService
{
    private const int DefaultWindowDays = 84;
    private const int MaximumWindowDays = 366;

    public async Task<ProgressView?> GetOwnAsync(
        DateOnly? from,
        DateOnly? to,
        RecordedMassUnit displayUnit,
        CancellationToken cancellationToken)
    {
        var client = await FindSelfAsync(cancellationToken);
        return client is null
            ? null
            : await BuildViewAsync(client.Id, from, to, displayUnit, cancellationToken);
    }

    public async Task<ProgressView?> GetClientAsync(
        Guid clientProfileId,
        DateOnly? from,
        DateOnly? to,
        RecordedMassUnit displayUnit,
        CancellationToken cancellationToken)
    {
        var client = await dbContext.ClientProfiles
            .AsNoTracking()
            .Where(client => client.Id == clientProfileId)
            .Select(client => new { client.IsCoachBlocked })
            .SingleOrDefaultAsync(cancellationToken);
        return client is { IsCoachBlocked: false }
            ? await BuildViewAsync(clientProfileId, from, to, displayUnit, cancellationToken)
            : null;
    }

    public async Task<ProgressCommandResult> RecordOwnAsync(
        RecordBodyweightRequest request,
        CancellationToken cancellationToken)
    {
        var client = await FindSelfAsync(cancellationToken);
        return client is null
            ? new ProgressCommandResult(ProgressCommandStatus.NotFound)
            : await RecordAsync(client.Id, request, BodyweightSource.Client, cancellationToken);
    }

    public async Task<ProgressCommandResult> RecordForClientAsync(
        Guid clientProfileId,
        RecordBodyweightRequest request,
        CancellationToken cancellationToken)
    {
        var client = await FindClientRelationshipAsync(clientProfileId, cancellationToken);
        return client switch
        {
            null => new ProgressCommandResult(ProgressCommandStatus.NotFound),
            true => new ProgressCommandResult(ProgressCommandStatus.Forbidden),
            false => await RecordAsync(clientProfileId, request, BodyweightSource.Coach, cancellationToken),
        };
    }

    public async Task<ProgressCommandResult> CorrectOwnAsync(
        Guid observationId,
        CorrectBodyweightRequest request,
        CancellationToken cancellationToken)
    {
        var client = await FindSelfAsync(cancellationToken);
        return client is null
            ? new ProgressCommandResult(ProgressCommandStatus.NotFound)
            : await CorrectAsync(client.Id, observationId, request, BodyweightSource.Client, cancellationToken);
    }

    public async Task<ProgressCommandResult> CorrectForClientAsync(
        Guid clientProfileId,
        Guid observationId,
        CorrectBodyweightRequest request,
        CancellationToken cancellationToken)
    {
        var client = await FindClientRelationshipAsync(clientProfileId, cancellationToken);
        return client switch
        {
            null => new ProgressCommandResult(ProgressCommandStatus.NotFound),
            true => new ProgressCommandResult(ProgressCommandStatus.Forbidden),
            false => await CorrectAsync(clientProfileId, observationId, request, BodyweightSource.Coach, cancellationToken),
        };
    }

    public async Task<ProgressCommandResult> ReplaceOwnBodyweightDateAsync(
        Guid observationId,
        ReplaceBodyweightDateRequest request,
        CancellationToken cancellationToken)
    {
        var client = await FindSelfAsync(cancellationToken);
        return client is null
            ? new ProgressCommandResult(ProgressCommandStatus.NotFound)
            : await ReplaceDateAsync(client.Id, observationId, request, BodyweightSource.Client, cancellationToken);
    }

    public async Task<ProgressCommandResult> ReplaceBodyweightDateForClientAsync(
        Guid clientProfileId,
        Guid observationId,
        ReplaceBodyweightDateRequest request,
        CancellationToken cancellationToken)
    {
        var client = await FindClientRelationshipAsync(clientProfileId, cancellationToken);
        return client switch
        {
            null => new ProgressCommandResult(ProgressCommandStatus.NotFound),
            true => new ProgressCommandResult(ProgressCommandStatus.Forbidden),
            false => await ReplaceDateAsync(clientProfileId, observationId, request, BodyweightSource.Coach, cancellationToken),
        };
    }

    public async Task<BodyweightHistoryView?> GetOwnHistoryAsync(
        Guid observationId,
        CancellationToken cancellationToken)
    {
        var client = await FindSelfAsync(cancellationToken);
        return client is null
            ? null
            : await GetHistoryAsync(client.Id, observationId, cancellationToken);
    }

    public async Task<BodyweightHistoryView?> GetClientHistoryAsync(
        Guid clientProfileId,
        Guid observationId,
        CancellationToken cancellationToken)
    {
        var client = await dbContext.ClientProfiles
            .AsNoTracking()
            .Where(client => client.Id == clientProfileId)
            .Select(client => new { client.IsCoachBlocked })
            .SingleOrDefaultAsync(cancellationToken);
        return client is { IsCoachBlocked: false }
            ? await GetHistoryAsync(clientProfileId, observationId, cancellationToken)
            : null;
    }

    public async Task<BodyMeasurementsView?> GetOwnMeasurementsAsync(
        DateOnly? from,
        DateOnly? to,
        MeasurementUnit displayUnit,
        CancellationToken cancellationToken)
    {
        var client = await FindSelfAsync(cancellationToken);
        return client is null
            ? null
            : await BuildMeasurementsViewAsync(client.Id, from, to, displayUnit, cancellationToken);
    }

    public async Task<BodyMeasurementsView?> GetClientMeasurementsAsync(
        Guid clientProfileId,
        DateOnly? from,
        DateOnly? to,
        MeasurementUnit displayUnit,
        CancellationToken cancellationToken)
    {
        var client = await FindClientRelationshipAsync(clientProfileId, cancellationToken);
        return client is false
            ? await BuildMeasurementsViewAsync(clientProfileId, from, to, displayUnit, cancellationToken)
            : null;
    }

    public async Task<BodyMeasurementCommandResult> RecordOwnMeasurementAsync(
        RecordBodyMeasurementRequest request,
        CancellationToken cancellationToken)
    {
        var client = await FindSelfAsync(cancellationToken);
        return client is null
            ? new BodyMeasurementCommandResult(ProgressCommandStatus.NotFound)
            : await RecordMeasurementAsync(
                client.Id,
                request,
                BodyMeasurementSource.Client,
                cancellationToken);
    }

    public async Task<BodyMeasurementCommandResult> RecordMeasurementForClientAsync(
        Guid clientProfileId,
        RecordBodyMeasurementRequest request,
        CancellationToken cancellationToken)
    {
        var client = await FindClientRelationshipAsync(clientProfileId, cancellationToken);
        return client switch
        {
            null => new BodyMeasurementCommandResult(ProgressCommandStatus.NotFound),
            true => new BodyMeasurementCommandResult(ProgressCommandStatus.Forbidden),
            false => await RecordMeasurementAsync(
                clientProfileId,
                request,
                BodyMeasurementSource.Coach,
                cancellationToken),
        };
    }

    public async Task<BodyMeasurementCommandResult> CorrectOwnMeasurementAsync(
        Guid measurementId,
        CorrectBodyMeasurementRequest request,
        CancellationToken cancellationToken)
    {
        var client = await FindSelfAsync(cancellationToken);
        return client is null
            ? new BodyMeasurementCommandResult(ProgressCommandStatus.NotFound)
            : await CorrectMeasurementAsync(
                client.Id,
                measurementId,
                request,
                BodyMeasurementSource.Client,
                cancellationToken);
    }

    public async Task<BodyMeasurementCommandResult> CorrectMeasurementForClientAsync(
        Guid clientProfileId,
        Guid measurementId,
        CorrectBodyMeasurementRequest request,
        CancellationToken cancellationToken)
    {
        var client = await FindClientRelationshipAsync(clientProfileId, cancellationToken);
        return client switch
        {
            null => new BodyMeasurementCommandResult(ProgressCommandStatus.NotFound),
            true => new BodyMeasurementCommandResult(ProgressCommandStatus.Forbidden),
            false => await CorrectMeasurementAsync(
                clientProfileId,
                measurementId,
                request,
                BodyMeasurementSource.Coach,
                cancellationToken),
        };
    }

    public async Task<BodyMeasurementHistoryView?> GetOwnMeasurementHistoryAsync(
        Guid measurementId,
        CancellationToken cancellationToken)
    {
        var client = await FindSelfAsync(cancellationToken);
        return client is null
            ? null
            : await GetMeasurementHistoryAsync(client.Id, measurementId, cancellationToken);
    }

    public async Task<BodyMeasurementHistoryView?> GetClientMeasurementHistoryAsync(
        Guid clientProfileId,
        Guid measurementId,
        CancellationToken cancellationToken)
    {
        var client = await FindClientRelationshipAsync(clientProfileId, cancellationToken);
        return client is false
            ? await GetMeasurementHistoryAsync(clientProfileId, measurementId, cancellationToken)
            : null;
    }

    private async Task<ProgressCommandResult> RecordAsync(
        Guid clientProfileId,
        RecordBodyweightRequest request,
        BodyweightSource source,
        CancellationToken cancellationToken)
    {
        try
        {
            var settings = await GetTenantCalendarAsync(cancellationToken);
            var measurementDate = request.MeasurementDate ?? settings.Today;
            if (measurementDate > settings.Today)
            {
                return Invalid("measurementDate", "Bodyweight cannot be dated in the future.");
            }

            // Only an active observation reserves its date. A date freed by a void-and-replace is
            // available again, and the partial unique index agrees.
            if (await dbContext.BodyweightObservations.AnyAsync(
                    item =>
                        item.ClientProfileId == clientProfileId &&
                        item.MeasurementDate == measurementDate &&
                        item.Status == BodyweightObservationStatus.Active,
                    cancellationToken))
            {
                return Conflict("BodyweightDateAlreadyExists", "A bodyweight observation already exists for that local date. Correct the existing entry instead.");
            }

            var observation = BodyweightObservation.CreateInitial(
                tenantContext.TenantId,
                clientProfileId,
                measurementDate,
                request.Value,
                request.Unit,
                source);
            dbContext.BodyweightObservations.Add(observation);
            await dbContext.SaveChangesAsync(cancellationToken);
            return new ProgressCommandResult(
                ProgressCommandStatus.Success,
                Observation: ToObservationView(observation));
        }
        catch (ArgumentException exception)
        {
            return Invalid("bodyweight", exception.Message);
        }
        catch (DbUpdateException)
        {
            return Conflict("BodyweightDateAlreadyExists", "A bodyweight observation already exists for that local date.");
        }
    }

    private async Task<ProgressCommandResult> CorrectAsync(
        Guid clientProfileId,
        Guid observationId,
        CorrectBodyweightRequest request,
        BodyweightSource source,
        CancellationToken cancellationToken)
    {
        var actorUserId = currentUser.UserId;
        if (actorUserId is null)
        {
            return new ProgressCommandResult(ProgressCommandStatus.NotFound);
        }

        var observation = await dbContext.BodyweightObservations.SingleOrDefaultAsync(
            item => item.Id == observationId && item.ClientProfileId == clientProfileId,
            cancellationToken);
        if (observation is null)
        {
            return new ProgressCommandResult(ProgressCommandStatus.NotFound);
        }

        // A voided observation is still readable as history, so this is a conflict rather than a
        // not-found: the entry exists, it just is not current truth any more.
        if (observation.Status != BodyweightObservationStatus.Active)
        {
            return VoidedConflict();
        }

        try
        {
            dbContext.Entry(observation).Property(item => item.Version).OriginalValue = request.Version;
            var previous = observation.Correct(request.Value, request.Unit, source);
            dbContext.BodyweightCorrections.Add(BodyweightCorrection.Create(
                observation,
                previous,
                request.Reason,
                clock.UtcNow,
                actorUserId.Value));
            await dbContext.SaveChangesAsync(cancellationToken);
            return new ProgressCommandResult(
                ProgressCommandStatus.Success,
                History: await GetHistoryAsync(clientProfileId, observationId, cancellationToken));
        }
        catch (ArgumentException exception)
        {
            return Invalid("bodyweight", exception.Message);
        }
        catch (DbUpdateConcurrencyException)
        {
            return Conflict("BodyweightVersionConflict", "The bodyweight observation changed. Reload it before correcting it again.");
        }
    }

    /// <summary>
    /// Corrects a mis-dated observation by voiding it and recording a replacement on the date it was
    /// actually taken. The measurement date is the observation's identity and is immutable in the
    /// domain and at the database, so this is never an in-place date change.
    /// </summary>
    private async Task<ProgressCommandResult> ReplaceDateAsync(
        Guid clientProfileId,
        Guid observationId,
        ReplaceBodyweightDateRequest request,
        BodyweightSource source,
        CancellationToken cancellationToken)
    {
        if (currentUser.UserId is not { } actorUserId)
        {
            return new ProgressCommandResult(ProgressCommandStatus.NotFound);
        }

        var observation = await dbContext.BodyweightObservations.SingleOrDefaultAsync(
            item => item.Id == observationId && item.ClientProfileId == clientProfileId,
            cancellationToken);
        if (observation is null)
        {
            return new ProgressCommandResult(ProgressCommandStatus.NotFound);
        }

        if (observation.Status != BodyweightObservationStatus.Active)
        {
            return VoidedConflict();
        }

        var calendar = await GetTenantCalendarAsync(cancellationToken);
        if (request.MeasurementDate > calendar.Today)
        {
            return Invalid("measurementDate", "Bodyweight cannot be dated in the future.");
        }

        if (request.MeasurementDate == observation.MeasurementDate)
        {
            return Invalid(
                "measurementDate",
                "The observation is already on that date. Correct its value instead.");
        }

        // Checked here for a precise message; the partial unique index is what actually guarantees it
        // under a concurrent write, and a violation rolls the whole operation back.
        if (await dbContext.BodyweightObservations.AnyAsync(
                item =>
                    item.ClientProfileId == clientProfileId &&
                    item.MeasurementDate == request.MeasurementDate &&
                    item.Status == BodyweightObservationStatus.Active,
                cancellationToken))
        {
            return Conflict(
                "BodyweightDateAlreadyExists",
                "A bodyweight observation already exists for that local date. Correct the existing entry instead.");
        }

        try
        {
            var replacement = BodyweightObservation.CreateInitial(
                tenantContext.TenantId,
                clientProfileId,
                request.MeasurementDate,
                observation.EnteredValue,
                observation.EnteredUnit,
                source);

            // One SaveChanges, therefore one transaction: the void and the replacement commit
            // together or not at all, and a collision on the target date leaves the original active.
            dbContext.Entry(observation).Property(item => item.Version).OriginalValue = request.Version;
            var record = observation.Void(request.Reason, clock.UtcNow, actorUserId, replacement.Id);
            dbContext.BodyweightObservations.Add(replacement);
            dbContext.BodyweightObservationVoids.Add(record);
            await dbContext.SaveChangesAsync(cancellationToken);

            return new ProgressCommandResult(
                ProgressCommandStatus.Success,
                DateCorrection: new BodyweightDateCorrectionView(
                    ToObservationView(replacement),
                    ToObservationView(observation),
                    ToVoidView(record)));
        }
        catch (ArgumentException exception)
        {
            return Invalid("reason", exception.Message);
        }
        catch (InvalidOperationException exception)
        {
            return Conflict("BodyweightObservationVoided", exception.Message);
        }
        catch (DbUpdateConcurrencyException)
        {
            return Conflict(
                "BodyweightVersionConflict",
                "The bodyweight observation changed. Reload it before correcting it again.");
        }
        catch (DbUpdateException)
        {
            return Conflict(
                "BodyweightDateAlreadyExists",
                "A bodyweight observation already exists for that local date.");
        }
    }

    private async Task<ProgressView> BuildViewAsync(
        Guid clientProfileId,
        DateOnly? requestedFrom,
        DateOnly? requestedTo,
        RecordedMassUnit displayUnit,
        CancellationToken cancellationToken)
    {
        if (!Enum.IsDefined(displayUnit))
        {
            throw new ArgumentOutOfRangeException(nameof(displayUnit));
        }

        var calendar = await GetTenantCalendarAsync(cancellationToken);
        var toExclusive = requestedTo ?? calendar.Today.AddDays(1);
        var from = requestedFrom ?? toExclusive.AddDays(-DefaultWindowDays);
        if (from >= toExclusive || toExclusive.DayNumber - from.DayNumber > MaximumWindowDays)
        {
            throw new ArgumentException($"Progress windows must contain between 1 and {MaximumWindowDays} days.");
        }

        var firstWeekStart = BodyweightWeekPolicy.GetWeekStart(from, calendar.WeekStartsOn);
        var trendWarmupStart = AddDaysClamped(from, -BodyweightTrendEwma.WarmupDays);
        var queryStart = firstWeekStart < trendWarmupStart ? firstWeekStart : trendWarmupStart;
        var lastIncludedDate = toExclusive.AddDays(-1);
        var weekEndExclusive = BodyweightWeekPolicy.GetWeekStart(lastIncludedDate, calendar.WeekStartsOn).AddDays(7);
        // Days, weekly means and the trend are current truth, so a voided observation contributes
        // nothing to any of them: not a sample, not a mean, not a warm-up point.
        var observations = await dbContext.BodyweightObservations
            .AsNoTracking()
            .Where(item =>
                item.ClientProfileId == clientProfileId &&
                item.Status == BodyweightObservationStatus.Active &&
                item.MeasurementDate >= queryStart &&
                item.MeasurementDate < weekEndExclusive)
            .OrderBy(item => item.MeasurementDate)
            .ToArrayAsync(cancellationToken);

        var windowObservations = observations
            .Where(item => item.MeasurementDate >= from && item.MeasurementDate < toExclusive)
            .ToArray();
        var trendIsAvailable = windowObservations.Length >= BodyweightTrendEwma.MinimumWindowSampleCount;
        var trends = trendIsAvailable
            ? BodyweightTrendEwma.Calculate(
                observations.Select(item => new BodyweightTrendSample(item.MeasurementDate, item.ValueKilograms)),
                from,
                toExclusive)
            : [];
        var observationsByDate = windowObservations.ToDictionary(item => item.MeasurementDate);
        var trendsByDate = trends.ToDictionary(item => item.Date);
        var days = Enumerable.Range(0, toExclusive.DayNumber - from.DayNumber)
            .Select(offset =>
            {
                var date = from.AddDays(offset);
                observationsByDate.TryGetValue(date, out var observation);
                trendsByDate.TryGetValue(date, out var trend);
                return new BodyweightDayView(
                    date,
                    observation is null ? null : ToObservationView(observation),
                    observation is null ? null : BodyweightUnitConverter.FromKilograms(observation.ValueKilograms, displayUnit),
                    trend is null ? null : BodyweightUnitConverter.FromKilograms(trend.EstimateKilograms, displayUnit),
                    trend?.SampleCount);
            })
            .ToArray();

        var weeks = new List<BodyweightWeekView>();
        for (var weekStart = firstWeekStart; weekStart < weekEndExclusive; weekStart = weekStart.AddDays(7))
        {
            var nextWeek = weekStart.AddDays(7);
            var samples = observations
                .Where(item => item.MeasurementDate >= weekStart && item.MeasurementDate < nextWeek)
                .ToArray();
            decimal? meanKilograms = samples.Length == 0
                ? null
                : decimal.Round(samples.Average(item => item.ValueKilograms), 3, MidpointRounding.AwayFromZero);
            weeks.Add(new BodyweightWeekView(
                weekStart,
                nextWeek,
                meanKilograms,
                meanKilograms is null ? null : BodyweightUnitConverter.FromKilograms(meanKilograms.Value, displayUnit),
                samples.Length));
        }

        var latestTrend = trends.Count == 0 ? null : trends[trends.Count - 1];
        return new ProgressView(
            clientProfileId,
            calendar.TimeZoneId,
            calendar.WeekStartsOn,
            displayUnit,
            from,
            toExclusive,
            days,
            weeks,
            new BodyweightTrendView(
                true,
                trendIsAvailable
                    ? BodyweightTrendAvailability.Available
                    : BodyweightTrendAvailability.NotEnoughData,
                BodyweightTrendEwma.MethodKey,
                BodyweightTrendEwma.MethodVersion,
                BodyweightTrendEwma.TimeConstantDays,
                BodyweightTrendEwma.WarmupDays,
                BodyweightTrendEwma.MinimumWindowSampleCount,
                windowObservations.Length,
                from,
                toExclusive,
                latestTrend?.EstimateKilograms,
                latestTrend is null ? null : BodyweightUnitConverter.FromKilograms(latestTrend.EstimateKilograms, displayUnit)));
    }

    /// <summary>
    /// The audit read, and the one place a voided observation is deliberately still resolved: a
    /// correction has to remain visible with its reason and actor, not disappear from history.
    /// </summary>
    private async Task<BodyweightHistoryView?> GetHistoryAsync(
        Guid clientProfileId,
        Guid observationId,
        CancellationToken cancellationToken)
    {
        var observation = await dbContext.BodyweightObservations
            .AsNoTracking()
            .SingleOrDefaultAsync(
                item => item.Id == observationId && item.ClientProfileId == clientProfileId,
                cancellationToken);
        if (observation is null)
        {
            return null;
        }

        var voided = observation.Status == BodyweightObservationStatus.Active
            ? null
            : await dbContext.BodyweightObservationVoids
                .AsNoTracking()
                .Where(item => item.ObservationId == observationId && item.ClientProfileId == clientProfileId)
                .Select(item => new BodyweightVoidView(
                    item.Id,
                    item.Reason,
                    item.VoidedByUserId,
                    item.VoidedAtUtc,
                    item.ReplacementObservationId))
                .SingleOrDefaultAsync(cancellationToken);

        var previous = await dbContext.BodyweightCorrections
            .AsNoTracking()
            .Where(item => item.ObservationId == observationId && item.ClientProfileId == clientProfileId)
            .OrderByDescending(item => item.SupersededAtUtc)
            .Select(item => new BodyweightHistoryItemView(
                item.Id,
                item.ValueKilograms,
                item.EnteredValue,
                item.EnteredUnit,
                item.Source,
                item.RecordedByUserId,
                item.RecordedAtUtc,
                item.Reason,
                item.SupersededByUserId,
                item.SupersededAtUtc))
            .ToArrayAsync(cancellationToken);
        return new BodyweightHistoryView(ToObservationView(observation), previous, voided);
    }

    private async Task<BodyMeasurementCommandResult> RecordMeasurementAsync(
        Guid clientProfileId,
        RecordBodyMeasurementRequest request,
        BodyMeasurementSource source,
        CancellationToken cancellationToken)
    {
        try
        {
            var calendar = await GetTenantCalendarAsync(cancellationToken);
            var measurementDate = request.MeasurementDate ?? calendar.Today;
            if (measurementDate > calendar.Today)
            {
                return InvalidMeasurement(
                    "measurementDate",
                    "Body measurements cannot be dated in the future.");
            }

            if (await dbContext.BodyMeasurements.AnyAsync(
                    item =>
                        item.ClientProfileId == clientProfileId &&
                        item.MeasurementDate == measurementDate &&
                        item.MeasurementType == request.MeasurementType,
                    cancellationToken))
            {
                return MeasurementConflict(
                    "BodyMeasurementDateAndTypeAlreadyExists",
                    "That measurement type already exists for the local date. Correct the existing entry instead.");
            }

            var measurement = BodyMeasurement.CreateInitial(
                tenantContext.TenantId,
                clientProfileId,
                measurementDate,
                request.MeasurementType,
                request.Value,
                request.Unit,
                source);
            dbContext.BodyMeasurements.Add(measurement);
            await dbContext.SaveChangesAsync(cancellationToken);
            return new BodyMeasurementCommandResult(
                ProgressCommandStatus.Success,
                Measurement: ToMeasurementView(measurement, request.Unit));
        }
        catch (ArgumentException exception)
        {
            return InvalidMeasurement("measurement", exception.Message);
        }
        catch (DbUpdateException)
        {
            return MeasurementConflict(
                "BodyMeasurementDateAndTypeAlreadyExists",
                "That measurement type already exists for the local date.");
        }
    }

    private async Task<BodyMeasurementCommandResult> CorrectMeasurementAsync(
        Guid clientProfileId,
        Guid measurementId,
        CorrectBodyMeasurementRequest request,
        BodyMeasurementSource source,
        CancellationToken cancellationToken)
    {
        var actorUserId = currentUser.UserId;
        if (actorUserId is null)
        {
            return new BodyMeasurementCommandResult(ProgressCommandStatus.NotFound);
        }

        var measurement = await dbContext.BodyMeasurements.SingleOrDefaultAsync(
            item => item.Id == measurementId && item.ClientProfileId == clientProfileId,
            cancellationToken);
        if (measurement is null)
        {
            return new BodyMeasurementCommandResult(ProgressCommandStatus.NotFound);
        }

        try
        {
            dbContext.Entry(measurement).Property(item => item.Version).OriginalValue = request.Version;
            var previous = measurement.Correct(request.Value, request.Unit, source);
            dbContext.BodyMeasurementCorrections.Add(BodyMeasurementCorrection.Create(
                measurement,
                previous,
                request.Reason,
                clock.UtcNow,
                actorUserId.Value));
            await dbContext.SaveChangesAsync(cancellationToken);
            return new BodyMeasurementCommandResult(
                ProgressCommandStatus.Success,
                History: await GetMeasurementHistoryAsync(
                    clientProfileId,
                    measurementId,
                    cancellationToken));
        }
        catch (ArgumentException exception)
        {
            return InvalidMeasurement("measurement", exception.Message);
        }
        catch (DbUpdateConcurrencyException)
        {
            return MeasurementConflict(
                "BodyMeasurementVersionConflict",
                "The body measurement changed. Reload it before correcting it again.");
        }
    }

    private async Task<BodyMeasurementsView> BuildMeasurementsViewAsync(
        Guid clientProfileId,
        DateOnly? requestedFrom,
        DateOnly? requestedTo,
        MeasurementUnit displayUnit,
        CancellationToken cancellationToken)
    {
        if (displayUnit is not (MeasurementUnit.Centimetre or MeasurementUnit.Inch))
        {
            throw new ArgumentOutOfRangeException(
                nameof(displayUnit),
                "The girth display unit must be Centimetre or Inch.");
        }

        var calendar = await GetTenantCalendarAsync(cancellationToken);
        var toExclusive = requestedTo ?? calendar.Today.AddDays(1);
        var from = requestedFrom ?? toExclusive.AddDays(-DefaultWindowDays);
        if (from >= toExclusive || toExclusive.DayNumber - from.DayNumber > MaximumWindowDays)
        {
            throw new ArgumentException(
                $"Progress windows must contain between 1 and {MaximumWindowDays} days.");
        }

        var measurements = await dbContext.BodyMeasurements
            .AsNoTracking()
            .Where(item =>
                item.ClientProfileId == clientProfileId &&
                item.MeasurementDate >= from &&
                item.MeasurementDate < toExclusive)
            .OrderBy(item => item.MeasurementDate)
            .ThenBy(item => item.MeasurementType)
            .ToArrayAsync(cancellationToken);
        var measurementsByDate = measurements
            .GroupBy(item => item.MeasurementDate)
            .ToDictionary(
                group => group.Key,
                group => (IReadOnlyList<BodyMeasurementView>)group
                    .Select(item => ToMeasurementView(item, displayUnit))
                    .ToArray());
        var days = Enumerable.Range(0, toExclusive.DayNumber - from.DayNumber)
            .Select(offset =>
            {
                var date = from.AddDays(offset);
                return new BodyMeasurementDayView(
                    date,
                    measurementsByDate.GetValueOrDefault(date) ?? []);
            })
            .ToArray();
        return new BodyMeasurementsView(
            clientProfileId,
            calendar.TimeZoneId,
            displayUnit,
            from,
            toExclusive,
            days);
    }

    private async Task<BodyMeasurementHistoryView?> GetMeasurementHistoryAsync(
        Guid clientProfileId,
        Guid measurementId,
        CancellationToken cancellationToken)
    {
        var measurement = await dbContext.BodyMeasurements
            .AsNoTracking()
            .SingleOrDefaultAsync(
                item => item.Id == measurementId && item.ClientProfileId == clientProfileId,
                cancellationToken);
        if (measurement is null)
        {
            return null;
        }

        var previous = await dbContext.BodyMeasurementCorrections
            .AsNoTracking()
            .Where(item =>
                item.MeasurementId == measurementId &&
                item.ClientProfileId == clientProfileId)
            .OrderByDescending(item => item.SupersededAtUtc)
            .Select(item => new BodyMeasurementHistoryItemView(
                item.Id,
                item.MeasurementDate,
                item.MeasurementType,
                item.CanonicalValue,
                item.MeasurementType == MeasurementType.BodyFatPercentage
                    ? MeasurementUnit.Percent
                    : MeasurementUnit.Centimetre,
                item.EnteredValue,
                item.EnteredUnit,
                item.Source,
                item.RecordedByUserId,
                item.RecordedAtUtc,
                item.Reason,
                item.SupersededByUserId,
                item.SupersededAtUtc))
            .ToArrayAsync(cancellationToken);
        return new BodyMeasurementHistoryView(
            ToMeasurementView(measurement, measurement.EnteredUnit),
            previous);
    }

    public async Task<ProgressPhotoCommandResult> RecordOwnPhotoAsync(
        ProgressPhotoUpload upload,
        CancellationToken cancellationToken)
    {
        var client = await FindSelfAsync(cancellationToken);
        return client is null
            ? new ProgressPhotoCommandResult(ProgressPhotoCommandStatus.NotFound)
            : await RecordPhotoAsync(client.Id, upload, ProgressPhotoSource.Client, cancellationToken);
    }

    public async Task<ProgressPhotoCommandResult> RecordPhotoForClientAsync(
        Guid clientProfileId,
        ProgressPhotoUpload upload,
        CancellationToken cancellationToken)
    {
        var blocked = await FindClientRelationshipAsync(clientProfileId, cancellationToken);
        return blocked switch
        {
            null => new ProgressPhotoCommandResult(ProgressPhotoCommandStatus.NotFound),
            true => new ProgressPhotoCommandResult(ProgressPhotoCommandStatus.Forbidden),
            _ => await RecordPhotoAsync(clientProfileId, upload, ProgressPhotoSource.Coach, cancellationToken),
        };
    }

    public async Task<ProgressPhotosView?> GetOwnPhotosAsync(
        DateOnly? from,
        DateOnly? endExclusive,
        CancellationToken cancellationToken)
    {
        var client = await FindSelfAsync(cancellationToken);
        // The owning client also sees their removed photos, so a removal is visible rather than
        // making an image silently vanish from their own history.
        return client is null
            ? null
            : await BuildPhotosViewAsync(client.Id, from, endExclusive, includeRemoved: true, cancellationToken);
    }

    public async Task<ProgressPhotosView?> GetClientPhotosAsync(
        Guid clientProfileId,
        DateOnly? from,
        DateOnly? endExclusive,
        CancellationToken cancellationToken)
    {
        var blocked = await FindClientRelationshipAsync(clientProfileId, cancellationToken);
        return blocked is null or true
            ? null
            : await BuildPhotosViewAsync(clientProfileId, from, endExclusive, includeRemoved: false, cancellationToken);
    }

    public async Task<ProgressPhotoCommandResult> RemoveOwnPhotoAsync(
        Guid photoId,
        RemoveProgressPhotoRequest request,
        CancellationToken cancellationToken)
    {
        var client = await FindSelfAsync(cancellationToken);
        return client is null
            ? new ProgressPhotoCommandResult(ProgressPhotoCommandStatus.NotFound)
            : await RemovePhotoAsync(client.Id, photoId, request, cancellationToken);
    }

    public async Task<ProgressPhotoCommandResult> RemovePhotoForClientAsync(
        Guid clientProfileId,
        Guid photoId,
        RemoveProgressPhotoRequest request,
        CancellationToken cancellationToken)
    {
        var blocked = await FindClientRelationshipAsync(clientProfileId, cancellationToken);
        return blocked switch
        {
            null => new ProgressPhotoCommandResult(ProgressPhotoCommandStatus.NotFound),
            true => new ProgressPhotoCommandResult(ProgressPhotoCommandStatus.Forbidden),
            _ => await RemovePhotoAsync(clientProfileId, photoId, request, cancellationToken),
        };
    }

    private async Task<ProgressPhotoCommandResult> RecordPhotoAsync(
        Guid clientProfileId,
        ProgressPhotoUpload upload,
        ProgressPhotoSource source,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(upload);
        if (!Enum.IsDefined(upload.Pose))
        {
            return PhotoInvalid("pose", "A supported progress photo pose is required.");
        }

        var calendar = await GetTenantCalendarAsync(cancellationToken);
        var photoDate = upload.PhotoDate ?? calendar.Today;
        if (photoDate > calendar.Today)
        {
            return PhotoInvalid("photoDate", "A progress photo cannot be dated in the future.");
        }

        if (await dbContext.ProgressPhotos.AnyAsync(
                item => item.ClientProfileId == clientProfileId &&
                        item.PhotoDate == photoDate &&
                        item.Pose == upload.Pose,
                cancellationToken))
        {
            return PhotoConflict(
                "ProgressPhotoAlreadyExists",
                "A photo already exists for that local date and pose. Remove it before adding another.");
        }

        // The title is derived, never taken from user input or client identity, so health-adjacent
        // detail cannot leak into media metadata or logs.
        var stored = await mediaService.UploadAsync(
            $"Progress photo {upload.Pose} {photoDate:yyyy-MM-dd}",
            upload.FileName,
            upload.ContentType,
            upload.Content,
            cancellationToken,
            MediaPurpose.ProgressPhoto,
            clientProfileId);
        if (stored.Status != MediaCommandStatus.Success || stored.Asset is null)
        {
            return stored.Status switch
            {
                MediaCommandStatus.RateLimited => new ProgressPhotoCommandResult(
                    ProgressPhotoCommandStatus.RateLimited,
                    Code: "ProgressPhotoRateLimited",
                    Message: "Too many uploads are in flight for this workspace. Try again shortly."),
                MediaCommandStatus.Invalid => new ProgressPhotoCommandResult(
                    ProgressPhotoCommandStatus.Invalid,
                    Errors: stored.Errors ?? new Dictionary<string, string[]>
                    {
                        ["file"] = ["The progress photo was rejected."],
                    }),
                MediaCommandStatus.Conflict => PhotoConflict(
                    "ProgressPhotoConflict",
                    "The progress photo conflicts with current media state."),
                // The storage-allowance codes are passed straight through rather than flattened
                // into a generic conflict, so the client can tell which limit was reached.
                MediaCommandStatus.QuotaExceeded => PhotoConflict(
                    stored.Code ?? MediaQuotaCodes.WorkspaceStorageExceeded,
                    stored.Message ?? "The storage allowance is full."),
                _ => new ProgressPhotoCommandResult(ProgressPhotoCommandStatus.NotFound),
            };
        }

        var photo = ProgressPhoto.Record(
            tenantContext.TenantId,
            clientProfileId,
            photoDate,
            upload.Pose,
            stored.Asset.Id,
            source);
        dbContext.ProgressPhotos.Add(photo);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
            return new ProgressPhotoCommandResult(ProgressPhotoCommandStatus.Success, ToPhotoView(photo));
        }
        catch (DbUpdateException)
        {
            // Two simultaneous uploads for the same date and pose: the loser's bytes would
            // otherwise be orphaned, so tombstone the asset for the existing retention sweep.
            await TombstoneOrphanedAssetAsync(stored.Asset.Id, cancellationToken);
            return PhotoConflict(
                "ProgressPhotoAlreadyExists",
                "A photo already exists for that local date and pose.");
        }
    }

    private async Task<ProgressPhotoCommandResult> RemovePhotoAsync(
        Guid clientProfileId,
        Guid photoId,
        RemoveProgressPhotoRequest request,
        CancellationToken cancellationToken)
    {
        if (currentUser.UserId is not { } actorUserId)
        {
            return new ProgressPhotoCommandResult(ProgressPhotoCommandStatus.NotFound);
        }

        var photo = await dbContext.ProgressPhotos.SingleOrDefaultAsync(
            item => item.Id == photoId && item.ClientProfileId == clientProfileId,
            cancellationToken);
        if (photo is null)
        {
            return new ProgressPhotoCommandResult(ProgressPhotoCommandStatus.NotFound);
        }

        try
        {
            var now = clock.UtcNow;
            dbContext.Entry(photo).Property(item => item.Version).OriginalValue = request.Version;
            photo.Remove();
            dbContext.ProgressPhotoRemovals.Add(ProgressPhotoRemoval.Create(
                photo,
                request.Reason,
                now,
                actorUserId));

            // Removing a photo also schedules its bytes for deletion. Without this the image left
            // the coach's view but stayed on disk forever, counted against the allowance and never
            // reclaimed. A progress photo is never referenced by a program snapshot, so it is not
            // historically referenced and the ordinary retention applies. The owning client keeps
            // reading it until the bytes actually go: CreateAccessAsync still permits Tombstoned.
            var asset = await dbContext.MediaAssets.SingleOrDefaultAsync(
                item => item.Id == photo.MediaAssetId,
                cancellationToken);
            asset?.MarkTombstoned(now, MediaRetentionPolicy.DeleteRetention, isHistoricallyReferenced: false);

            await dbContext.SaveChangesAsync(cancellationToken);
            return new ProgressPhotoCommandResult(ProgressPhotoCommandStatus.Success, ToPhotoView(photo));
        }
        catch (ArgumentException exception)
        {
            return PhotoInvalid("reason", exception.Message);
        }
        catch (InvalidOperationException exception)
        {
            return PhotoConflict("ProgressPhotoAlreadyRemoved", exception.Message);
        }
        catch (DbUpdateConcurrencyException)
        {
            return PhotoConflict(
                "ProgressPhotoVersionConflict",
                "The progress photo changed. Reload it before removing it again.");
        }
    }

    private async Task<ProgressPhotosView> BuildPhotosViewAsync(
        Guid clientProfileId,
        DateOnly? requestedFrom,
        DateOnly? requestedEndExclusive,
        bool includeRemoved,
        CancellationToken cancellationToken)
    {
        var calendar = await GetTenantCalendarAsync(cancellationToken);
        var toExclusive = requestedEndExclusive ?? AddDaysClamped(calendar.Today, 1);
        var from = requestedFrom ?? AddDaysClamped(toExclusive, -DefaultWindowDays);
        if (from >= toExclusive || toExclusive.DayNumber - from.DayNumber > MaximumWindowDays)
        {
            throw new ArgumentException($"Progress windows must contain between 1 and {MaximumWindowDays} days.");
        }

        var photos = await dbContext.ProgressPhotos
            .AsNoTracking()
            .Where(item =>
                item.ClientProfileId == clientProfileId &&
                item.PhotoDate >= from &&
                item.PhotoDate < toExclusive &&
                (includeRemoved || item.Status == ProgressPhotoStatus.Active))
            .OrderBy(item => item.PhotoDate)
            .ThenBy(item => item.Pose)
            .ToArrayAsync(cancellationToken);
        return new ProgressPhotosView(
            clientProfileId,
            from,
            toExclusive,
            photos.Select(ToPhotoView).ToArray());
    }

    private async Task TombstoneOrphanedAssetAsync(Guid mediaAssetId, CancellationToken cancellationToken)
    {
        var asset = await dbContext.MediaAssets.SingleOrDefaultAsync(
            item => item.Id == mediaAssetId,
            cancellationToken);
        if (asset is null)
        {
            return;
        }

        asset.MarkTombstoned(clock.UtcNow, MediaRetentionPolicy.DeleteRetention, isHistoricallyReferenced: false);
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    private static ProgressPhotoView ToPhotoView(ProgressPhoto photo) =>
        new(
            photo.Id,
            photo.PhotoDate,
            photo.Pose,
            photo.MediaAssetId,
            photo.Status,
            photo.Source,
            photo.UpdatedByUserId ?? photo.CreatedByUserId,
            photo.UpdatedAtUtc,
            photo.Version);

    private static ProgressPhotoCommandResult PhotoInvalid(string field, string message) =>
        new(
            ProgressPhotoCommandStatus.Invalid,
            Errors: new Dictionary<string, string[]> { [field] = [message] });

    private static ProgressPhotoCommandResult PhotoConflict(string code, string message) =>
        new(ProgressPhotoCommandStatus.Conflict, Code: code, Message: message);

    private Task<ClientProfile?> FindSelfAsync(CancellationToken cancellationToken) =>
        currentUser.UserId is not { } userId
            ? Task.FromResult<ClientProfile?>(null)
            : dbContext.ClientProfiles.SingleOrDefaultAsync(
                client => client.UserId == userId,
                cancellationToken);

    private Task<bool?> FindClientRelationshipAsync(
        Guid clientProfileId,
        CancellationToken cancellationToken) =>
        dbContext.ClientProfiles
            .AsNoTracking()
            .Where(client => client.Id == clientProfileId)
            .Select(client => (bool?)client.IsCoachBlocked)
            .SingleOrDefaultAsync(cancellationToken);

    private static DateOnly AddDaysClamped(DateOnly date, int days) =>
        DateOnly.FromDayNumber(Math.Clamp(
            date.DayNumber + days,
            DateOnly.MinValue.DayNumber,
            DateOnly.MaxValue.DayNumber));

    private Task<WorkspaceCalendar> GetTenantCalendarAsync(CancellationToken cancellationToken) =>
        WorkspaceCalendarReader.ReadAsync(dbContext, clock, tenantContext.TenantId, cancellationToken);

    private static BodyweightObservationView ToObservationView(BodyweightObservation observation) =>
        new(
            observation.Id,
            observation.MeasurementDate,
            observation.ValueKilograms,
            observation.EnteredValue,
            observation.EnteredUnit,
            observation.Source,
            observation.UpdatedByUserId ?? observation.CreatedByUserId,
            observation.UpdatedAtUtc,
            observation.Status,
            observation.Version);

    private static BodyweightVoidView ToVoidView(BodyweightObservationVoid record) =>
        new(
            record.Id,
            record.Reason,
            record.VoidedByUserId,
            record.VoidedAtUtc,
            record.ReplacementObservationId);

    private static BodyMeasurementView ToMeasurementView(
        BodyMeasurement measurement,
        MeasurementUnit girthDisplayUnit)
    {
        var canonicalUnit = BodyMeasurementUnitConverter.CanonicalUnit(measurement.MeasurementType);
        var displayUnit = measurement.MeasurementType == MeasurementType.BodyFatPercentage
            ? MeasurementUnit.Percent
            : girthDisplayUnit;
        return new BodyMeasurementView(
            measurement.Id,
            measurement.MeasurementDate,
            measurement.MeasurementType,
            measurement.CanonicalValue,
            canonicalUnit,
            measurement.EnteredValue,
            measurement.EnteredUnit,
            BodyMeasurementUnitConverter.FromCanonical(
                measurement.MeasurementType,
                measurement.CanonicalValue,
                displayUnit),
            displayUnit,
            measurement.Source,
            measurement.UpdatedByUserId ?? measurement.CreatedByUserId,
            measurement.UpdatedAtUtc,
            measurement.Version);
    }

    private static ProgressCommandResult Invalid(string field, string message) =>
        new(
            ProgressCommandStatus.Invalid,
            Errors: new Dictionary<string, string[]> { [field] = [message] });

    private static ProgressCommandResult Conflict(string code, string message) =>
        new(ProgressCommandStatus.Conflict, Code: code, Message: message);

    private static ProgressCommandResult VoidedConflict() =>
        Conflict(
            "BodyweightObservationVoided",
            "That bodyweight entry was voided by a correction. Work from the replacement instead.");

    private static BodyMeasurementCommandResult InvalidMeasurement(
        string field,
        string message) =>
        new(
            ProgressCommandStatus.Invalid,
            Errors: new Dictionary<string, string[]> { [field] = [message] });

    private static BodyMeasurementCommandResult MeasurementConflict(
        string code,
        string message) =>
        new(ProgressCommandStatus.Conflict, Code: code, Message: message);
}
