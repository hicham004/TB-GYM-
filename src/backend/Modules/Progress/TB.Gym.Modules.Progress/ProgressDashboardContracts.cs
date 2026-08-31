using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Progress;

/// <summary>
/// A read-side composition of what the authoritative modules already record for one client over one
/// window. It owns no data of its own and creates no tables.
/// </summary>
/// <remarks>
/// The dashboard places observations from separate domains side by side and does nothing more. It
/// states no relationship between them, because nothing in this data establishes one: a client may
/// log every meal and every session and still not move, or the reverse, for reasons none of these
/// tables record.
/// </remarks>
public sealed record ProgressDashboardView(
    Guid ClientProfileId,
    string TimeZoneId,
    DayOfWeek WeekStartsOn,
    DateOnly From,
    DateOnly ToExclusive,
    int WindowDayCount,
    RecordedMassUnit DisplayUnit,
    MeasurementUnit MeasurementDisplayUnit,
    DashboardBodyweightSection Bodyweight,
    DashboardMeasurementsSection Measurements,
    DashboardPhotosSection Photos,
    DashboardEntitledSection<DashboardNutritionContext> Nutrition,
    DashboardEntitledSection<DashboardTrainingContext> Training);

/// <summary>
/// A cross-domain section, which exists only when the client is currently entitled to the feature
/// that owns the underlying data.
/// </summary>
/// <remarks>
/// Bodyweight, measurements, and photos carry no such wrapper because progress is deliberately
/// entitlement-independent: a client keeps their own body data when a subscription lapses. Nutrition
/// and Training are not, so their content is gated here. An unentitled section is returned present
/// and explicitly unavailable with the deciding reason, never omitted and never populated, so a
/// caller cannot mistake "not permitted" for "nothing recorded".
/// </remarks>
public sealed record DashboardEntitledSection<TContext>(
    CoachingFeature Feature,
    DashboardSectionAvailability Availability,
    FeatureAccessReason Reason,
    TContext? Context)
    where TContext : class;

public enum DashboardSectionAvailability
{
    Available = 1,
    Unavailable = 2,
}

/// <summary>
/// A change between the first and last observation actually present in the window, in display
/// units. Null when fewer than two observations exist, rather than being reported as zero.
/// </summary>
public sealed record DashboardChange(
    DateOnly FromDate,
    decimal FromValue,
    DateOnly ToDate,
    decimal ToValue,
    decimal Delta);

public sealed record DashboardBodyweightSection(
    BodyweightObservationView? Latest,
    decimal? LatestDisplayValue,
    DashboardChange? Change,
    IReadOnlyList<BodyweightWeekView> Weeks,
    BodyweightTrendView Trend,
    // The denominator is stated so "12" is never read as a rate: 12 observed days out of 84.
    int ObservedDayCount);

public sealed record DashboardMeasurementSummary(
    MeasurementType MeasurementType,
    MeasurementUnit DisplayUnit,
    DateOnly LatestDate,
    decimal LatestDisplayValue,
    DashboardChange? Change,
    int ObservationCount);

public sealed record DashboardMeasurementsSection(
    IReadOnlyList<DashboardMeasurementSummary> Measurements,
    int ObservedDayCount);

/// <summary>
/// One photo in the timeline. Only the thumbnail rendition is addressed; the dashboard never
/// carries a path to the full-resolution original.
/// </summary>
/// <remarks>
/// <see cref="ThumbnailUrl"/> is null for a photo stored before renditions existed. That case is
/// reported rather than papered over, because the alternative — quietly substituting the original —
/// would transfer a multi-megabyte image into a tile.
/// </remarks>
public sealed record DashboardPhotoView(
    Guid Id,
    DateOnly PhotoDate,
    ProgressPhotoPose Pose,
    Guid MediaAssetId,
    string? ThumbnailUrl);

public sealed record DashboardPhotoPoseTimeline(
    ProgressPhotoPose Pose,
    IReadOnlyList<DashboardPhotoView> Photos);

/// <summary>
/// The photo timelines, bounded to a preview, together with the true totals for the window.
/// </summary>
/// <remarks>
/// <see cref="PhotoCount"/> counts every active photo in the requested range;
/// <see cref="PreviewPhotoCount"/> counts the tiles actually carried in <see cref="Poses"/>. They
/// differ once a pose has more than <see cref="DashboardPhotoPolicy.MaximumPreviewPhotosPerPose"/>
/// photos in the window, and both are stated so a viewer reports "the most recent 8 of 23" rather
/// than presenting a truncated list as the whole history.
/// </remarks>
public sealed record DashboardPhotosSection(
    IReadOnlyList<DashboardPhotoPoseTimeline> Poses,
    int PhotoCount,
    // Photos whose rendition is missing, so a viewer can say why some tiles cannot preview.
    int MissingThumbnailCount,
    int PreviewPhotoCount);

/// <summary>
/// How much of a photo timeline the dashboard previews.
/// </summary>
/// <remarks>
/// Each tile is a protected image whose bytes need a short-lived, path-scoped media grant, and
/// grants are issued in one bounded batch rather than one request per tile. Eight per pose across
/// the three poses is 24 assets, which sits inside that batch ceiling with room to spare, and is
/// already more history than a summary tile strip can usefully show. The full set stays on the
/// progress page, which pages through it properly.
/// </remarks>
public static class DashboardPhotoPolicy
{
    public const int MaximumPreviewPhotosPerPose = 8;
}

/// <summary>
/// Counts of what the client logged, each against the number of days it was counted over. No
/// adherence score, percentage, streak, or rating is derived: this data defines no target a client
/// was supposed to hit, so any such number would be invented.
/// </summary>
public sealed record DashboardNutritionContext(
    DateOnly RecentFrom,
    DateOnly RecentToExclusive,
    int RecentDayCount,
    int RecentLoggedDayCount,
    int RecentCompletedDayCount,
    int WindowLoggedDayCount,
    int WindowCompletedDayCount,
    DateOnly? LastLoggedDate);

/// <summary>
/// Scheduled sessions and completed workouts over the same two spans. Scheduled counts exclude
/// cancelled mesocycles, so the denominator reflects work the client was actually asked to do.
/// </summary>
public sealed record DashboardTrainingContext(
    DateOnly RecentFrom,
    DateOnly RecentToExclusive,
    int RecentDayCount,
    int RecentScheduledSessionCount,
    int RecentCompletedWorkoutCount,
    int WindowScheduledSessionCount,
    int WindowCompletedWorkoutCount,
    int WindowInProgressWorkoutCount,
    DateOnly? LastCompletedDate);
