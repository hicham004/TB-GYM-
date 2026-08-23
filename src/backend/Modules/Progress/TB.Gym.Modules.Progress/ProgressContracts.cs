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
