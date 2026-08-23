namespace TB.Gym.Modules.Progress;

public interface IProgressApplicationService
{
    Task<ProgressView?> GetOwnAsync(DateOnly? from, DateOnly? endExclusive, RecordedMassUnit displayUnit, CancellationToken cancellationToken);
    Task<ProgressView?> GetClientAsync(Guid clientProfileId, DateOnly? from, DateOnly? endExclusive, RecordedMassUnit displayUnit, CancellationToken cancellationToken);
    Task<ProgressCommandResult> RecordOwnAsync(RecordBodyweightRequest request, CancellationToken cancellationToken);
    Task<ProgressCommandResult> RecordForClientAsync(Guid clientProfileId, RecordBodyweightRequest request, CancellationToken cancellationToken);
    Task<ProgressCommandResult> CorrectOwnAsync(Guid observationId, CorrectBodyweightRequest request, CancellationToken cancellationToken);
    Task<ProgressCommandResult> CorrectForClientAsync(Guid clientProfileId, Guid observationId, CorrectBodyweightRequest request, CancellationToken cancellationToken);
    Task<BodyweightHistoryView?> GetOwnHistoryAsync(Guid observationId, CancellationToken cancellationToken);
    Task<BodyweightHistoryView?> GetClientHistoryAsync(Guid clientProfileId, Guid observationId, CancellationToken cancellationToken);
    Task<BodyMeasurementsView?> GetOwnMeasurementsAsync(DateOnly? from, DateOnly? endExclusive, MeasurementUnit displayUnit, CancellationToken cancellationToken);
    Task<BodyMeasurementsView?> GetClientMeasurementsAsync(Guid clientProfileId, DateOnly? from, DateOnly? endExclusive, MeasurementUnit displayUnit, CancellationToken cancellationToken);
    Task<BodyMeasurementCommandResult> RecordOwnMeasurementAsync(RecordBodyMeasurementRequest request, CancellationToken cancellationToken);
    Task<BodyMeasurementCommandResult> RecordMeasurementForClientAsync(Guid clientProfileId, RecordBodyMeasurementRequest request, CancellationToken cancellationToken);
    Task<BodyMeasurementCommandResult> CorrectOwnMeasurementAsync(Guid measurementId, CorrectBodyMeasurementRequest request, CancellationToken cancellationToken);
    Task<BodyMeasurementCommandResult> CorrectMeasurementForClientAsync(Guid clientProfileId, Guid measurementId, CorrectBodyMeasurementRequest request, CancellationToken cancellationToken);
    Task<BodyMeasurementHistoryView?> GetOwnMeasurementHistoryAsync(Guid measurementId, CancellationToken cancellationToken);
    Task<BodyMeasurementHistoryView?> GetClientMeasurementHistoryAsync(Guid clientProfileId, Guid measurementId, CancellationToken cancellationToken);
    Task<ProgressPhotoCommandResult> RecordOwnPhotoAsync(ProgressPhotoUpload upload, CancellationToken cancellationToken);
    Task<ProgressPhotoCommandResult> RecordPhotoForClientAsync(Guid clientProfileId, ProgressPhotoUpload upload, CancellationToken cancellationToken);
    Task<ProgressPhotosView?> GetOwnPhotosAsync(DateOnly? from, DateOnly? endExclusive, CancellationToken cancellationToken);
    Task<ProgressPhotosView?> GetClientPhotosAsync(Guid clientProfileId, DateOnly? from, DateOnly? endExclusive, CancellationToken cancellationToken);
    Task<ProgressPhotoCommandResult> RemoveOwnPhotoAsync(Guid photoId, RemoveProgressPhotoRequest request, CancellationToken cancellationToken);
    Task<ProgressPhotoCommandResult> RemovePhotoForClientAsync(Guid clientProfileId, Guid photoId, RemoveProgressPhotoRequest request, CancellationToken cancellationToken);
    Task<ProgressDashboardView?> GetOwnDashboardAsync(DateOnly? from, DateOnly? endExclusive, RecordedMassUnit displayUnit, MeasurementUnit measurementDisplayUnit, CancellationToken cancellationToken);
    Task<ProgressDashboardView?> GetClientDashboardAsync(Guid clientProfileId, DateOnly? from, DateOnly? endExclusive, RecordedMassUnit displayUnit, MeasurementUnit measurementDisplayUnit, CancellationToken cancellationToken);
}

/// <summary>
/// A streamed progress-photo upload. The stream is consumed once and never buffered whole.
/// </summary>
public sealed record ProgressPhotoUpload(
    DateOnly? PhotoDate,
    ProgressPhotoPose Pose,
    string FileName,
    string ContentType,
    Stream Content);

public sealed record RemoveProgressPhotoRequest(string Reason, uint Version);

public sealed record ProgressPhotoView(
    Guid Id,
    DateOnly PhotoDate,
    ProgressPhotoPose Pose,
    Guid MediaAssetId,
    ProgressPhotoStatus Status,
    ProgressPhotoSource Source,
    Guid? RecordedByUserId,
    DateTimeOffset RecordedAtUtc,
    uint Version);

public sealed record ProgressPhotosView(
    Guid ClientProfileId,
    DateOnly From,
    DateOnly ToExclusive,
    IReadOnlyList<ProgressPhotoView> Photos);

public sealed record ProgressPhotoCommandResult(
    ProgressPhotoCommandStatus Status,
    ProgressPhotoView? Photo = null,
    IReadOnlyDictionary<string, string[]>? Errors = null,
    string? Code = null,
    string? Message = null);

public enum ProgressPhotoCommandStatus
{
    Success = 1,
    NotFound = 2,
    Invalid = 3,
    Conflict = 4,
    Forbidden = 5,
    RateLimited = 6,
}

public sealed record RecordBodyweightRequest(
    decimal Value,
    RecordedMassUnit Unit,
    DateOnly? MeasurementDate = null);

public sealed record CorrectBodyweightRequest(
    decimal Value,
    RecordedMassUnit Unit,
    string Reason,
    uint Version);

public sealed record BodyweightObservationView(
    Guid Id,
    DateOnly MeasurementDate,
    decimal ValueKilograms,
    decimal EnteredValue,
    RecordedMassUnit EnteredUnit,
    BodyweightSource Source,
    Guid? RecordedByUserId,
    DateTimeOffset RecordedAtUtc,
    uint Version);

public sealed record BodyweightDayView(
    DateOnly Date,
    BodyweightObservationView? Observation,
    decimal? DisplayValue,
    decimal? TrendEstimate,
    int? TrendSampleCount);

public sealed record BodyweightWeekView(
    DateOnly WeekStart,
    DateOnly WeekEndExclusive,
    decimal? MeanKilograms,
    decimal? DisplayMean,
    int ObservedDayCount);

public sealed record BodyweightTrendView(
    bool IsEstimate,
    BodyweightTrendAvailability Availability,
    string MethodKey,
    string MethodVersion,
    int TimeConstantDays,
    int WarmupDays,
    int MinimumSampleCount,
    int SampleCount,
    DateOnly WindowStart,
    DateOnly WindowEndExclusive,
    decimal? LatestEstimateKilograms,
    decimal? LatestDisplayEstimate);

public enum BodyweightTrendAvailability
{
    Available = 1,
    NotEnoughData = 2,
}

public sealed record ProgressView(
    Guid ClientProfileId,
    string TimeZoneId,
    DayOfWeek WeekStartsOn,
    RecordedMassUnit DisplayUnit,
    DateOnly From,
    DateOnly ToExclusive,
    IReadOnlyList<BodyweightDayView> Days,
    IReadOnlyList<BodyweightWeekView> Weeks,
    BodyweightTrendView Trend);

public sealed record BodyweightHistoryItemView(
    Guid Id,
    decimal ValueKilograms,
    decimal EnteredValue,
    RecordedMassUnit EnteredUnit,
    BodyweightSource Source,
    Guid? RecordedByUserId,
    DateTimeOffset RecordedAtUtc,
    string Reason,
    Guid SupersededByUserId,
    DateTimeOffset SupersededAtUtc);

public sealed record BodyweightHistoryView(
    BodyweightObservationView Current,
    IReadOnlyList<BodyweightHistoryItemView> PreviousValues);

public sealed record RecordBodyMeasurementRequest(
    MeasurementType MeasurementType,
    decimal Value,
    MeasurementUnit Unit,
    DateOnly? MeasurementDate = null);

public sealed record CorrectBodyMeasurementRequest(
    decimal Value,
    MeasurementUnit Unit,
    string Reason,
    uint Version);

public sealed record BodyMeasurementView(
    Guid Id,
    DateOnly MeasurementDate,
    MeasurementType MeasurementType,
    decimal CanonicalValue,
    MeasurementUnit CanonicalUnit,
    decimal EnteredValue,
    MeasurementUnit EnteredUnit,
    decimal DisplayValue,
    MeasurementUnit DisplayUnit,
    BodyMeasurementSource Source,
    Guid? RecordedByUserId,
    DateTimeOffset RecordedAtUtc,
    uint Version);

public sealed record BodyMeasurementDayView(
    DateOnly Date,
    IReadOnlyList<BodyMeasurementView> Measurements);

public sealed record BodyMeasurementsView(
    Guid ClientProfileId,
    string TimeZoneId,
    MeasurementUnit DisplayUnit,
    DateOnly From,
    DateOnly ToExclusive,
    IReadOnlyList<BodyMeasurementDayView> Days);

public sealed record BodyMeasurementHistoryItemView(
    Guid Id,
    DateOnly MeasurementDate,
    MeasurementType MeasurementType,
    decimal CanonicalValue,
    MeasurementUnit CanonicalUnit,
    decimal EnteredValue,
    MeasurementUnit EnteredUnit,
    BodyMeasurementSource Source,
    Guid? RecordedByUserId,
    DateTimeOffset RecordedAtUtc,
    string Reason,
    Guid SupersededByUserId,
    DateTimeOffset SupersededAtUtc);

public sealed record BodyMeasurementHistoryView(
    BodyMeasurementView Current,
    IReadOnlyList<BodyMeasurementHistoryItemView> PreviousValues);

public sealed record BodyMeasurementCommandResult(
    ProgressCommandStatus Status,
    BodyMeasurementView? Measurement = null,
    BodyMeasurementHistoryView? History = null,
    IReadOnlyDictionary<string, string[]>? Errors = null,
    string? Code = null,
    string? Message = null);

public sealed record ProgressCommandResult(
    ProgressCommandStatus Status,
    BodyweightObservationView? Observation = null,
    BodyweightHistoryView? History = null,
    IReadOnlyDictionary<string, string[]>? Errors = null,
    string? Code = null,
    string? Message = null);

public enum ProgressCommandStatus
{
    Success = 1,
    NotFound = 2,
    Invalid = 3,
    Conflict = 4,
    Forbidden = 5,
}
