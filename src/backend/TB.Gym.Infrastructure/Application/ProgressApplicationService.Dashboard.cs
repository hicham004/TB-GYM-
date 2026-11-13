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
                forCoach: false,
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
                forCoach: true,
                cancellationToken);
    }

    private async Task<ProgressDashboardView> BuildDashboardAsync(
        Guid clientProfileId,
        DateOnly? requestedFrom,
        DateOnly? requestedEndExclusive,
        RecordedMassUnit displayUnit,
        MeasurementUnit measurementDisplayUnit,
        bool forCoach,
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

        // One evaluation covers every feature in a single pass over the entitlement tables, and
        // still yields a separate per-feature decision. Calling EvaluateAsync twice would repeat
        // the same five queries to reach the same two answers. The client's own reach reads the
        // tier from the same decisions, so it is evaluated before the window is fixed.
        var access = await featureAccessService.EvaluateAllAsync(
            tenantContext.TenantId,
            clientProfileId,
            cancellationToken);
        var reach = forCoach ? null : await OwnReachAsync(clientProfileId, calendar, access, cancellationToken);
        (from, toExclusive) = ProgressReachWindow.Clamp(from, toExclusive, reach?.EarliestShown);

        var windowDayCount = toExclusive.DayNumber - from.DayNumber;
        var recentFrom = windowDayCount <= RecentDays ? from : AddDaysClamped(toExclusive, -RecentDays);
        var window = new DashboardWindow(from, toExclusive, recentFrom, windowDayCount);

        var bodyweight = await BuildDashboardBodyweightAsync(
            clientProfileId,
            window,
            calendar,
            displayUnit,
            reach,
            cancellationToken);
        if (forCoach)
        {
            // Only the coach's read: a returning client never sees their older profile (CLI-016).
            bodyweight = bodyweight with
            {
                Start = await BuildDashboardStartAsync(clientProfileId, calendar, displayUnit, cancellationToken),
            };
        }
        var measurements = await BuildDashboardMeasurementsAsync(
            clientProfileId,
            window,
            measurementDisplayUnit,
            cancellationToken);
        var photos = await BuildDashboardPhotosAsync(clientProfileId, window, cancellationToken);
        var nutrition = await BuildDashboardNutritionAsync(clientProfileId, window, access, cancellationToken);
        var training = await BuildDashboardTrainingAsync(
            clientProfileId,
            window,
            access,
            countOwnWorkouts: calendar.IsHouse,
            cancellationToken);

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
            training,
            reach);
    }

    private async Task<DashboardBodyweightSection> BuildDashboardBodyweightAsync(
        Guid clientProfileId,
        DashboardWindow window,
        WorkspaceCalendar calendar,
        RecordedMassUnit displayUnit,
        ProgressReach? reach,
        CancellationToken cancellationToken)
    {
        // The trend needs its warm-up, and the weekly grid needs whole workspace weeks, so the read
        // spans the union of those and the window. It stays one date-filtered projection. Nothing
        // before a client's reach is read (PRG-015), not even as warm-up or as a whole week.
        var firstWeekStart = BodyweightWeekPolicy.GetWeekStart(window.From, calendar.WeekStartsOn);
        var trendWarmupStart = AddDaysClamped(window.From, -BodyweightTrendEwma.WarmupDays);
        var queryStart = AtOrAfter(firstWeekStart < trendWarmupStart ? firstWeekStart : trendWarmupStart, reach);
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
        var readSamples = observations
            .Select(item => new BodyweightTrendSample(item.MeasurementDate, item.ValueKilograms))
            .ToArray();
        var trendIsAvailable = windowObservations.Length >= BodyweightTrendEwma.MinimumWindowSampleCount;
        var trends = trendIsAvailable
            ? BodyweightTrendEwma.Calculate(readSamples, window.From, window.ToExclusive)
            : [];

        // The weekly grid keeps whole workspace weeks so the columns line up, but every figure in it
        // is taken from `windowObservations` — the requested range — rather than from the widened
        // read. A partial first or last week therefore reports the days inside [from, toExclusive)
        // and nothing else; an observation the day before `from` is not part of a number the caller
        // asked to see. The widened read exists only so the trend has its documented warm-up and so
        // the grouping is one query.
        var weeks = new List<BodyweightWeekView>();
        for (var weekStart = firstWeekStart; weekStart < weekEndExclusive; weekStart = weekStart.AddDays(7))
        {
            var nextWeek = weekStart.AddDays(7);
            var samples = windowObservations
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
        // The widened read holds the whole of every week the window's weigh-ins fall in, which the
        // change compares, unlike the grid above.
        var change = BodyweightWeeklyChange.Calculate(readSamples, window.From, window.ToExclusive, calendar.WeekStartsOn);
        var latestTrend = trends.Count == 0 ? null : trends[^1];
        return new DashboardBodyweightSection(
            latest is null ? null : ToObservationView(latest),
            latest is null ? null : BodyweightUnitConverter.FromKilograms(latest.ValueKilograms, displayUnit),
            change is null
                ? null
                : new DashboardWeeklyChange(
                    BodyweightWeeklyChange.MethodKey,
                    BodyweightWeeklyChange.MethodVersion,
                    change.FromDate,
                    change.FirstWeek.WeekStart,
                    change.FirstWeek.MeanKilograms,
                    change.FirstWeek.ObservedDayCount,
                    change.LatestWeek.WeekStart,
                    change.LatestWeek.MeanKilograms,
                    change.LatestWeek.ObservedDayCount,
                    change.DeltaKilograms,
                    BodyweightUnitConverter.FromKilograms(change.DeltaKilograms, displayUnit)),
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

        // The timeline is a bounded preview, not the whole window. Every tile is a protected image
        // that needs its own short-lived path-scoped grant before a browser can fetch it, so an
        // unbounded timeline would demand an unbounded number of grants and cookies. The most
        // recent few per pose are shown; `PhotoCount` still reports the true total so the viewer
        // can say how many were left out and send the reader to the progress page for the rest.
        var poses = photos
            .GroupBy(item => item.Pose)
            .Select(group => new DashboardPhotoPoseTimeline(
                group.Key,
                group
                    .OrderByDescending(item => item.PhotoDate)
                    .Take(DashboardPhotoPolicy.MaximumPreviewPhotosPerPose)
                    .OrderBy(item => item.PhotoDate)
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
            photos.Count(item => !item.HasThumbnail),
            poses.Sum(pose => pose.Photos.Count));
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
        bool countOwnWorkouts,
        CancellationToken cancellationToken)
    {
        var decision = Decision(access, CoachingFeature.Training);
        if (!decision.IsAllowed)
        {
            return Unavailable<DashboardTrainingContext>(decision);
        }

        // Non-cancelled programming contributes every scheduled session. After cancellation, an
        // unexecuted session is withdrawn, but a session with an execution remains the denominator
        // for that immutable historical fact. The one-to-one session/execution key makes this a
        // single population rather than two independently filtered counts.
        var sessions = await (
            from session in dbContext.TrainingSessions.AsNoTracking()
            join week in dbContext.MesocycleWeeks.AsNoTracking()
                on new { session.TenantId, Id = session.MesocycleWeekId }
                equals new { week.TenantId, week.Id }
            join mesocycle in dbContext.TrainingMesocycles.AsNoTracking()
                on new { week.TenantId, Id = week.MesocycleId }
                equals new { mesocycle.TenantId, mesocycle.Id }
            join execution in dbContext.WorkoutExecutions.AsNoTracking()
                on new { session.TenantId, Id = (Guid?)session.Id }
                equals new { execution.TenantId, Id = execution.TrainingSessionId }
                into executionGroup
            from execution in executionGroup.DefaultIfEmpty()
            where mesocycle.ClientProfileId == clientProfileId &&
                  (mesocycle.Status != MesocycleStatus.Cancelled || execution != null) &&
                  session.ScheduledDate >= window.From &&
                  session.ScheduledDate < window.ToExclusive
            select new DashboardTrainingSession(
                session.ScheduledDate,
                execution == null ? null : (WorkoutExecutionStatus?)execution.Status))
            .ToArrayAsync(cancellationToken);
        var completed = sessions
            .Where(item => item.ExecutionStatus == WorkoutExecutionStatus.Completed)
            .ToArray();
        var inProgress = sessions.Count(item => item.ExecutionStatus == WorkoutExecutionStatus.InProgress);

        // Workouts of one's own (TRN-033) are counted apart, never as a planned session: finished ones, by the house day
        // each was started on, as the week strip counts them. Only the house holds them, so nowhere else asks.
        var ownDates = countOwnWorkouts
            ? await dbContext.WorkoutExecutions.AsNoTracking()
                .Where(execution =>
                    execution.ClientProfileId == clientProfileId &&
                    execution.TrainingSessionId == null &&
                    execution.Status == WorkoutExecutionStatus.Completed &&
                    execution.ScheduledDateSnapshot >= window.From &&
                    execution.ScheduledDateSnapshot < window.ToExclusive)
                .Select(execution => execution.ScheduledDateSnapshot)
                .ToArrayAsync(cancellationToken)
            : [];
        return Available(decision, new DashboardTrainingContext(
            window.RecentFrom,
            window.ToExclusive,
            window.RecentDayCount,
            sessions.Count(item => item.Date >= window.RecentFrom),
            completed.Count(item => item.Date >= window.RecentFrom),
            sessions.Length,
            completed.Length,
            inProgress,
            completed.Length == 0 ? null : completed.Max(item => item.Date),
            ownDates.Count(date => date >= window.RecentFrom),
            ownDates.Length,
            ownDates.Length == 0 ? null : ownDates.Max(),
            countOwnWorkouts));
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

    private sealed record DashboardTrainingSession(
        DateOnly Date,
        WorkoutExecutionStatus? ExecutionStatus);

    private sealed record DashboardPhotoRow(
        Guid Id,
        DateOnly PhotoDate,
        ProgressPhotoPose Pose,
        Guid MediaAssetId,
        bool HasThumbnail);
}
