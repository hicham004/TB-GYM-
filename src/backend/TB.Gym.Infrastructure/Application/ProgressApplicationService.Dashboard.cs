using Microsoft.EntityFrameworkCore;
using TB.Gym.Modules.Media;
using TB.Gym.Modules.Nutrition;
using TB.Gym.Modules.Progress;
using TB.Gym.Modules.Training;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// Read-side composition of the progress dashboard.
/// </summary>
/// <remarks>
/// The composition lives here, in Infrastructure, because only this layer may see Training and
/// Nutrition alongside Progress. The Progress module owns the dashboard's shape but references
/// neither assembly, so its contracts carry counts and dates rather than another module's types.
/// Nothing is copied into Progress: this is a projection over data those modules already own.
/// </remarks>
internal sealed partial class ProgressApplicationService
{
    /// <summary>
    /// The trailing span the "recent" counts are taken over. It is carved out of the requested
    /// window rather than measured from today, so every number the dashboard reports comes from
    /// inside the range the caller asked for, and a short window shrinks it instead of reaching
    /// outside.
    /// </summary>
    private const int RecentDays = 7;

    public async Task<ProgressDashboardView?> GetOwnDashboardAsync(
        DateOnly? from,
        DateOnly? endExclusive,
        RecordedMassUnit displayUnit,
        MeasurementUnit measurementDisplayUnit,
        CancellationToken cancellationToken)
    {
        var client = await FindSelfAsync(cancellationToken);
        return client is null
            ? null
            : await BuildDashboardAsync(
                client.Id,
                from,
                endExclusive,
                displayUnit,
                measurementDisplayUnit,
                cancellationToken);
    }

    public async Task<ProgressDashboardView?> GetClientDashboardAsync(
        Guid clientProfileId,
        DateOnly? from,
        DateOnly? endExclusive,
        RecordedMassUnit displayUnit,
        MeasurementUnit measurementDisplayUnit,
        CancellationToken cancellationToken)
    {
        // Identical to every other coach-facing progress read: an unknown client and a blocked
        // relationship are both "not found", so blocking cannot be probed through this endpoint.
        var blocked = await FindClientRelationshipAsync(clientProfileId, cancellationToken);
        return blocked is null or true
            ? null
            : await BuildDashboardAsync(
                clientProfileId,
                from,
                endExclusive,
                displayUnit,
                measurementDisplayUnit,
                cancellationToken);
    }

    private async Task<ProgressDashboardView> BuildDashboardAsync(
        Guid clientProfileId,
        DateOnly? requestedFrom,
        DateOnly? requestedEndExclusive,
        RecordedMassUnit displayUnit,
        MeasurementUnit measurementDisplayUnit,
        CancellationToken cancellationToken)
    {
        if (!Enum.IsDefined(displayUnit))
        {
            throw new ArgumentOutOfRangeException(nameof(displayUnit));
        }

        if (measurementDisplayUnit is not (MeasurementUnit.Centimetre or MeasurementUnit.Inch))
        {
            throw new ArgumentOutOfRangeException(
                nameof(measurementDisplayUnit),
                "The girth display unit must be Centimetre or Inch.");
        }

        var calendar = await GetTenantCalendarAsync(cancellationToken);
        var toExclusive = requestedEndExclusive ?? AddDaysClamped(calendar.Today, 1);
        var from = requestedFrom ?? AddDaysClamped(toExclusive, -DefaultWindowDays);
        if (from >= toExclusive || toExclusive.DayNumber - from.DayNumber > MaximumWindowDays)
        {
            throw new ArgumentException($"Progress windows must contain between 1 and {MaximumWindowDays} days.");
        }

        var windowDayCount = toExclusive.DayNumber - from.DayNumber;
        var recentFrom = windowDayCount <= RecentDays ? from : AddDaysClamped(toExclusive, -RecentDays);
        var window = new DashboardWindow(from, toExclusive, recentFrom, windowDayCount);

        // One evaluation covers every feature in a single pass over the entitlement tables, and
        // still yields a separate per-feature decision. Calling EvaluateAsync twice would repeat
        // the same five queries to reach the same two answers.
        var access = await featureAccessService.EvaluateAllAsync(
            tenantContext.TenantId,
            clientProfileId,
            cancellationToken);

        var bodyweight = await BuildDashboardBodyweightAsync(
            clientProfileId,
            window,
            calendar,
            displayUnit,
            cancellationToken);
        var measurements = await BuildDashboardMeasurementsAsync(
            clientProfileId,
            window,
            measurementDisplayUnit,
            cancellationToken);
        var photos = await BuildDashboardPhotosAsync(clientProfileId, window, cancellationToken);
        var nutrition = await BuildDashboardNutritionAsync(clientProfileId, window, access, cancellationToken);
        var training = await BuildDashboardTrainingAsync(clientProfileId, window, access, cancellationToken);

        return new ProgressDashboardView(
            clientProfileId,
            calendar.TimeZoneId,
            calendar.WeekStartsOn,
            from,
            toExclusive,
            windowDayCount,
            displayUnit,
            measurementDisplayUnit,
            bodyweight,
            measurements,
            photos,
            nutrition,
            training);
    }

    private async Task<DashboardBodyweightSection> BuildDashboardBodyweightAsync(
        Guid clientProfileId,
        DashboardWindow window,
        TenantCalendar calendar,
        RecordedMassUnit displayUnit,
        CancellationToken cancellationToken)
    {
        // The trend needs its warm-up, and the weekly grid needs whole workspace weeks, so the read
        // spans the union of those and the window. It stays one date-filtered projection.
        var firstWeekStart = BodyweightWeekPolicy.GetWeekStart(window.From, calendar.WeekStartsOn);
        var trendWarmupStart = AddDaysClamped(window.From, -BodyweightTrendEwma.WarmupDays);
        var queryStart = firstWeekStart < trendWarmupStart ? firstWeekStart : trendWarmupStart;
        var lastIncludedDate = window.ToExclusive.AddDays(-1);
        var weekEndExclusive = BodyweightWeekPolicy
            .GetWeekStart(lastIncludedDate, calendar.WeekStartsOn)
            .AddDays(7);
        // Voided observations are excluded here for the same reason as on the detail view: the
        // dashboard reports current truth, and a corrected-away entry is not part of it.
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
            .Where(item => item.MeasurementDate >= window.From && item.MeasurementDate < window.ToExclusive)
            .ToArray();
        var trendIsAvailable = windowObservations.Length >= BodyweightTrendEwma.MinimumWindowSampleCount;
        var trends = trendIsAvailable
            ? BodyweightTrendEwma.Calculate(
                observations.Select(item => new BodyweightTrendSample(item.MeasurementDate, item.ValueKilograms)),
                window.From,
                window.ToExclusive)
            : [];

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

        var latest = windowObservations.Length == 0 ? null : windowObservations[^1];
        var change = windowObservations.Length < 2
            ? null
            : BuildChange(
                windowObservations[0].MeasurementDate,
                BodyweightUnitConverter.FromKilograms(windowObservations[0].ValueKilograms, displayUnit),
                windowObservations[^1].MeasurementDate,
                BodyweightUnitConverter.FromKilograms(windowObservations[^1].ValueKilograms, displayUnit));
        var latestTrend = trends.Count == 0 ? null : trends[^1];
        return new DashboardBodyweightSection(
            latest is null ? null : ToObservationView(latest),
            latest is null ? null : BodyweightUnitConverter.FromKilograms(latest.ValueKilograms, displayUnit),
            change,
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
                window.From,
                window.ToExclusive,
                latestTrend?.EstimateKilograms,
                latestTrend is null ? null : BodyweightUnitConverter.FromKilograms(latestTrend.EstimateKilograms, displayUnit)),
            windowObservations.Length);
    }

    private async Task<DashboardMeasurementsSection> BuildDashboardMeasurementsAsync(
        Guid clientProfileId,
        DashboardWindow window,
        MeasurementUnit measurementDisplayUnit,
        CancellationToken cancellationToken)
    {
        var measurements = await dbContext.BodyMeasurements
            .AsNoTracking()
            .Where(item =>
                item.ClientProfileId == clientProfileId &&
                item.MeasurementDate >= window.From &&
                item.MeasurementDate < window.ToExclusive)
            .OrderBy(item => item.MeasurementType)
            .ThenBy(item => item.MeasurementDate)
            .ToArrayAsync(cancellationToken);

        var summaries = measurements
            .GroupBy(item => item.MeasurementType)
            .Select(group =>
            {
                var ordered = group.ToArray();
                var latest = ToMeasurementView(ordered[^1], measurementDisplayUnit);
                var first = ToMeasurementView(ordered[0], measurementDisplayUnit);
                return new DashboardMeasurementSummary(
                    group.Key,
                    latest.DisplayUnit,
                    latest.MeasurementDate,
                    latest.DisplayValue,
                    ordered.Length < 2
                        ? null
                        : BuildChange(
                            first.MeasurementDate,
                            first.DisplayValue,
                            latest.MeasurementDate,
                            latest.DisplayValue),
                    ordered.Length);
            })
            .OrderBy(item => item.MeasurementType)
            .ToArray();
        return new DashboardMeasurementsSection(
            summaries,
            measurements.Select(item => item.MeasurementDate).Distinct().Count());
    }

    private async Task<DashboardPhotosSection> BuildDashboardPhotosAsync(
        Guid clientProfileId,
        DashboardWindow window,
        CancellationToken cancellationToken)
    {
        // The rendition's existence is resolved in the same statement rather than per photo, so a
        // timeline of any length still costs one round trip.
        var photos = await dbContext.ProgressPhotos
            .AsNoTracking()
            .Where(item =>
                item.ClientProfileId == clientProfileId &&
                item.Status == ProgressPhotoStatus.Active &&
                item.PhotoDate >= window.From &&
                item.PhotoDate < window.ToExclusive)
            .OrderBy(item => item.Pose)
            .ThenBy(item => item.PhotoDate)
            .Select(item => new DashboardPhotoRow(
                item.Id,
                item.PhotoDate,
                item.Pose,
                item.MediaAssetId,
                dbContext.MediaAssetDerivatives.Any(derivative =>
                    derivative.MediaAssetId == item.MediaAssetId &&
                    derivative.Variant == MediaDerivativeVariant.Thumbnail)))
            .ToArrayAsync(cancellationToken);

        var poses = photos
            .GroupBy(item => item.Pose)
            .Select(group => new DashboardPhotoPoseTimeline(
                group.Key,
                group
                    .Select(item => new DashboardPhotoView(
                        item.Id,
                        item.PhotoDate,
                        item.Pose,
                        item.MediaAssetId,
                        // Only ever the rendition. A photo without one reports null so the viewer
                        // can say so, instead of the dashboard substituting the original.
                        item.HasThumbnail ? MediaAccessCookie.ThumbnailPath(item.MediaAssetId) : null))
                    .ToArray()))
            .OrderBy(item => item.Pose)
            .ToArray();
        return new DashboardPhotosSection(
            poses,
            photos.Length,
            photos.Count(item => !item.HasThumbnail));
    }

    private async Task<DashboardEntitledSection<DashboardNutritionContext>> BuildDashboardNutritionAsync(
        Guid clientProfileId,
        DashboardWindow window,
        IReadOnlyList<FeatureAccessDecision> access,
        CancellationToken cancellationToken)
    {
        var decision = Decision(access, CoachingFeature.Nutrition);
        if (!decision.IsAllowed)
        {
            // Nothing is read. An unentitled section carries no counts at all, so a lapsed
            // subscription cannot leak "how much did they log" through the dashboard.
            return Unavailable<DashboardNutritionContext>(decision);
        }

        var days = await dbContext.DailyNutritionLogs
            .AsNoTracking()
            .Where(item =>
                item.ClientProfileId == clientProfileId &&
                item.Date >= window.From &&
                item.Date < window.ToExclusive)
            .Select(item => new DashboardLoggedDay(item.Date, item.Status == DailyNutritionLogStatus.Completed))
            .ToArrayAsync(cancellationToken);

        var recent = days.Where(item => item.Date >= window.RecentFrom).ToArray();
        return Available(decision, new DashboardNutritionContext(
            window.RecentFrom,
            window.ToExclusive,
            window.RecentDayCount,
            recent.Select(item => item.Date).Distinct().Count(),
            recent.Where(item => item.IsCompleted).Select(item => item.Date).Distinct().Count(),
            days.Select(item => item.Date).Distinct().Count(),
            days.Where(item => item.IsCompleted).Select(item => item.Date).Distinct().Count(),
            days.Length == 0 ? null : days.Max(item => item.Date)));
    }

    private async Task<DashboardEntitledSection<DashboardTrainingContext>> BuildDashboardTrainingAsync(
        Guid clientProfileId,
        DashboardWindow window,
        IReadOnlyList<FeatureAccessDecision> access,
        CancellationToken cancellationToken)
    {
        var decision = Decision(access, CoachingFeature.Training);
        if (!decision.IsAllowed)
        {
            return Unavailable<DashboardTrainingContext>(decision);
        }

        // Cancelled programming is excluded so the denominator counts work the client was actually
        // asked to do rather than sessions that were withdrawn.
        var scheduled = await (
            from session in dbContext.TrainingSessions.AsNoTracking()
            join week in dbContext.MesocycleWeeks.AsNoTracking()
                on new { session.TenantId, Id = session.MesocycleWeekId }
                equals new { week.TenantId, week.Id }
            join mesocycle in dbContext.TrainingMesocycles.AsNoTracking()
                on new { week.TenantId, Id = week.MesocycleId }
                equals new { mesocycle.TenantId, mesocycle.Id }
            where mesocycle.ClientProfileId == clientProfileId &&
                  mesocycle.Status != MesocycleStatus.Cancelled &&
                  session.ScheduledDate >= window.From &&
                  session.ScheduledDate < window.ToExclusive
            select session.ScheduledDate)
            .ToArrayAsync(cancellationToken);

        var executions = await dbContext.WorkoutExecutions
            .AsNoTracking()
            .Where(item =>
                item.ClientProfileId == clientProfileId &&
                item.ScheduledDateSnapshot >= window.From &&
                item.ScheduledDateSnapshot < window.ToExclusive)
            .Select(item => new DashboardLoggedDay(
                item.ScheduledDateSnapshot,
                item.Status == WorkoutExecutionStatus.Completed))
            .ToArrayAsync(cancellationToken);

        var completed = executions.Where(item => item.IsCompleted).ToArray();
        return Available(decision, new DashboardTrainingContext(
            window.RecentFrom,
            window.ToExclusive,
            window.RecentDayCount,
            scheduled.Count(date => date >= window.RecentFrom),
            completed.Count(item => item.Date >= window.RecentFrom),
            scheduled.Length,
            completed.Length,
            executions.Length - completed.Length,
            completed.Length == 0 ? null : completed.Max(item => item.Date)));
    }

    private static FeatureAccessDecision Decision(
        IReadOnlyList<FeatureAccessDecision> access,
        CoachingFeature feature) =>
        access.SingleOrDefault(item => item.Feature == feature)
        // Fail closed: an evaluator that returned nothing for this feature denies it rather than
        // falling through to a populated section.
        ?? new FeatureAccessDecision(feature, false, FeatureAccessReason.NoEntitlement);

    private static DashboardEntitledSection<TContext> Available<TContext>(
        FeatureAccessDecision decision,
        TContext context)
        where TContext : class =>
        new(decision.Feature, DashboardSectionAvailability.Available, decision.Reason, context);

    private static DashboardEntitledSection<TContext> Unavailable<TContext>(FeatureAccessDecision decision)
        where TContext : class =>
        new(decision.Feature, DashboardSectionAvailability.Unavailable, decision.Reason, null);

    private static DashboardChange BuildChange(
        DateOnly fromDate,
        decimal fromValue,
        DateOnly toDate,
        decimal toValue) =>
        new(fromDate, fromValue, toDate, toValue, toValue - fromValue);

    private sealed record DashboardWindow(
        DateOnly From,
        DateOnly ToExclusive,
        DateOnly RecentFrom,
        int DayCount)
    {
        public int RecentDayCount => ToExclusive.DayNumber - RecentFrom.DayNumber;
    }

    private sealed record DashboardLoggedDay(DateOnly Date, bool IsCompleted);

    private sealed record DashboardPhotoRow(
        Guid Id,
        DateOnly PhotoDate,
        ProgressPhotoPose Pose,
        Guid MediaAssetId,
        bool HasThumbnail);
}
