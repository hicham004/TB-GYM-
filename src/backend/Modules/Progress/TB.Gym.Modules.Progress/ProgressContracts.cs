namespace TB.Gym.Modules.Progress;

public interface IProgressApplicationService
{
    Task<ProgressView?> GetOwnAsync(DateOnly? from, DateOnly? endExclusive, RecordedMassUnit displayUnit, CancellationToken cancellationToken);
    Task<ProgressView?> GetClientAsync(Guid clientProfileId, DateOnly? from, DateOnly? endExclusive, RecordedMassUnit displayUnit, CancellationToken cancellationToken);
    Task<ProgressCommandResult> RecordOwnAsync(RecordBodyweightRequest request, CancellationToken cancellationToken);
    Task<ProgressCommandResult> RecordForClientAsync(Guid clientProfileId, RecordBodyweightRequest request, CancellationToken cancellationToken);
    Task<ProgressCommandResult> CorrectOwnAsync(Guid observationId, CorrectBodyweightRequest request, CancellationToken cancellationToken);
    Task<ProgressCommandResult> CorrectForClientAsync(Guid clientProfileId, Guid observationId, CorrectBodyweightRequest request, CancellationToken cancellationToken);
    Task<ProgressCommandResult> ReplaceOwnBodyweightDateAsync(Guid observationId, ReplaceBodyweightDateRequest request, CancellationToken cancellationToken);
    Task<ProgressCommandResult> ReplaceBodyweightDateForClientAsync(Guid clientProfileId, Guid observationId, ReplaceBodyweightDateRequest request, CancellationToken cancellationToken);
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

    /// <summary>
    /// The upload could not be admitted because a dependency it needs — the malware scanner — is
    /// unavailable, so no photo was recorded. Kept apart from <see cref="Invalid"/>, which blames
    /// the file, and from <see cref="Conflict"/>, which claims something already exists: nothing
    /// exists, and the same date and pose can be used again once uploads work.
    /// </summary>
    Unavailable = 7,
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

/// <summary>
/// Moves a mis-dated observation onto the date it was actually taken. The recorded weight is carried
/// across untouched — a wrong value is the existing value correction, which is a different operation.
/// </summary>
public sealed record ReplaceBodyweightDateRequest(
    DateOnly MeasurementDate,
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
    BodyweightObservationStatus Status,
    uint Version);

public sealed record BodyweightVoidView(
    Guid Id,
    string Reason,
    Guid VoidedByUserId,
    DateTimeOffset VoidedAtUtc,
    Guid? ReplacementObservationId);

/// <summary>
/// The result of a void-and-replace: both sides of the one atomic operation, so a caller never has to
/// re-read to learn what happened to the entry it corrected.
/// </summary>
public sealed record BodyweightDateCorrectionView(
    BodyweightObservationView Replacement,
    BodyweightObservationView Voided,
    BodyweightVoidView Void);

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

/// <summary>
/// The audit view of one observation. It deliberately still resolves a voided observation, with the
/// void record attached, because a correction has to be visible to be auditable.
/// </summary>
public sealed record BodyweightHistoryView(
    BodyweightObservationView Current,
    IReadOnlyList<BodyweightHistoryItemView> PreviousValues,
    BodyweightVoidView? Void = null);

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
    string? Message = null,
    BodyweightDateCorrectionView? DateCorrection = null);

public enum ProgressCommandStatus
{
    Success = 1,
    NotFound = 2,
    Invalid = 3,
    Conflict = 4,
    Forbidden = 5,
}
