using Microsoft.EntityFrameworkCore;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Progress;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

internal sealed class ProgressApplicationService(
    GymDbContext dbContext,
    IClock clock,
    ICurrentUser currentUser,
    ITenantContext tenantContext)
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

            if (await dbContext.BodyweightObservations.AnyAsync(
                    item => item.ClientProfileId == clientProfileId && item.MeasurementDate == measurementDate,
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
        var observations = await dbContext.BodyweightObservations
            .AsNoTracking()
            .Where(item =>
                item.ClientProfileId == clientProfileId &&
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
        return new BodyweightHistoryView(ToObservationView(observation), previous);
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

    private async Task<TenantCalendar> GetTenantCalendarAsync(CancellationToken cancellationToken)
    {
        var tenant = await dbContext.Tenants
            .Where(item => item.Id == tenantContext.TenantId)
            .Select(item => new { item.TimeZoneId, item.WeekStartsOn })
            .SingleAsync(cancellationToken);
        var localNow = TimeZoneInfo.ConvertTime(
            clock.UtcNow,
            TimeZoneInfo.FindSystemTimeZoneById(tenant.TimeZoneId));
        return new TenantCalendar(
            tenant.TimeZoneId,
            tenant.WeekStartsOn,
            DateOnly.FromDateTime(localNow.DateTime));
    }

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
            observation.Version);

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

    private sealed record TenantCalendar(string TimeZoneId, DayOfWeek WeekStartsOn, DateOnly Today);
}
