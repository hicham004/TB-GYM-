using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Progress;

/// <summary>
/// Where a client began with this coach (critique B6, PRG-014): one per client profile, a record of its
/// own beside the daily weigh-ins. The intake's "Where you start" writes it together with the first
/// weigh-in, and profiles from before it were filled in from their first weigh-in. Correcting a weigh-in
/// never moves it, and correcting it never touches a weigh-in; only staff correct it, with a reason, and
/// every correction keeps the previous value in <see cref="StartingWeightCorrection"/>.
/// </summary>
public sealed class StartingWeight : TenantEntity
{
    private StartingWeight()
    {
    }

    private StartingWeight(
        Guid tenantId,
        Guid clientProfileId,
        DateOnly measurementDate,
        decimal valueKilograms,
        decimal enteredValue,
        RecordedMassUnit enteredUnit,
        StartingWeightOrigin origin)
        : base(tenantId)
    {
        ClientProfileId = clientProfileId;
        MeasurementDate = measurementDate;
        ValueKilograms = valueKilograms;
        EnteredValue = enteredValue;
        EnteredUnit = enteredUnit;
        Origin = origin;
    }

    public Guid ClientProfileId { get; private set; }

    /// <summary>The workspace-local day the start was weighed.</summary>
    public DateOnly MeasurementDate { get; private set; }

    public decimal ValueKilograms { get; private set; }

    public decimal EnteredValue { get; private set; }

    public RecordedMassUnit EnteredUnit { get; private set; }

    /// <summary>How the start was first set; a later correction does not change it.</summary>
    public StartingWeightOrigin Origin { get; private set; }

    public static StartingWeight Record(
        Guid tenantId,
        Guid clientProfileId,
        DateOnly measurementDate,
        decimal enteredValue,
        RecordedMassUnit enteredUnit,
        StartingWeightOrigin origin)
    {
        if (clientProfileId == Guid.Empty)
        {
            throw new ArgumentException("A client profile id is required.", nameof(clientProfileId));
        }

        if (!Enum.IsDefined(origin))
        {
            throw new ArgumentOutOfRangeException(nameof(origin));
        }

        return new StartingWeight(
            tenantId,
            clientProfileId,
            measurementDate,
            BodyweightUnitConverter.ToKilograms(enteredValue, enteredUnit),
            enteredValue,
            enteredUnit,
            origin);
    }

    /// <summary>
    /// Sets the start to another day or value and returns the append-only record of what it was. Every
    /// check runs before anything changes, and a correction that changes nothing is refused rather than
    /// recorded as history.
    /// </summary>
    public StartingWeightCorrection Correct(
        DateOnly measurementDate,
        decimal enteredValue,
        RecordedMassUnit enteredUnit,
        string reason,
        DateTimeOffset correctedAtUtc,
        Guid correctedByUserId)
    {
        var kilograms = BodyweightUnitConverter.ToKilograms(enteredValue, enteredUnit);
        if (measurementDate == MeasurementDate && enteredValue == EnteredValue && enteredUnit == EnteredUnit)
        {
            throw new ArgumentException("Change the weight or the day to correct the start.", nameof(enteredValue));
        }

        var correction = StartingWeightCorrection.Create(this, reason, correctedAtUtc, correctedByUserId);
        MeasurementDate = measurementDate;
        ValueKilograms = kilograms;
        EnteredValue = enteredValue;
        EnteredUnit = enteredUnit;
        return correction;
    }
}

/// <summary>
/// The start as it was before one correction, with who set it and when, and why it was corrected.
/// Append-only in the domain and at the database.
/// </summary>
public sealed class StartingWeightCorrection : TenantEntity
{
    private StartingWeightCorrection()
    {
    }

    private StartingWeightCorrection(
        StartingWeight start,
        string reason,
        DateTimeOffset supersededAtUtc,
        Guid supersededByUserId)
        : base(start.TenantId)
    {
        StartingWeightId = start.Id;
        ClientProfileId = start.ClientProfileId;
        MeasurementDate = start.MeasurementDate;
        ValueKilograms = start.ValueKilograms;
        EnteredValue = start.EnteredValue;
        EnteredUnit = start.EnteredUnit;
        RecordedAtUtc = start.UpdatedAtUtc;
        RecordedByUserId = start.UpdatedByUserId ?? start.CreatedByUserId;
        Reason = ProgressText.RequiredReason(reason);
        SupersededAtUtc = supersededAtUtc;
        SupersededByUserId = supersededByUserId;
    }

    public Guid StartingWeightId { get; private set; }
    public Guid ClientProfileId { get; private set; }
    public DateOnly MeasurementDate { get; private set; }
    public decimal ValueKilograms { get; private set; }
    public decimal EnteredValue { get; private set; }
    public RecordedMassUnit EnteredUnit { get; private set; }
    public DateTimeOffset RecordedAtUtc { get; private set; }
    public Guid? RecordedByUserId { get; private set; }
    public string Reason { get; private set; } = string.Empty;
    public DateTimeOffset SupersededAtUtc { get; private set; }
    public Guid SupersededByUserId { get; private set; }

    /// <summary>The start as it stands now, before the correction that is about to change it.</summary>
    internal static StartingWeightCorrection Create(
        StartingWeight start,
        string reason,
        DateTimeOffset supersededAtUtc,
        Guid supersededByUserId)
    {
        ArgumentNullException.ThrowIfNull(start);
        if (supersededByUserId == Guid.Empty)
        {
            throw new ArgumentException("A correction actor is required.", nameof(supersededByUserId));
        }

        return new StartingWeightCorrection(start, reason, supersededAtUtc, supersededByUserId);
    }
}

public enum StartingWeightOrigin
{
    /// <summary>The intake's "Where you start", written with the first weigh-in.</summary>
    Intake = 1,

    /// <summary>Filled in from the profile's first weigh-in for a profile set up before starts existed.</summary>
    FirstWeighIn = 2,
}

/// <summary>
/// One week's mean weight as a comparison uses it: the workspace week it covers, its mean rounded as
/// every weekly mean is (three decimals, half away from zero), and how many days it was taken over.
/// </summary>
public sealed record BodyweightWeekMean(DateOnly WeekStart, decimal MeanKilograms, int ObservedDayCount);

public sealed record BodyweightSinceStartResult(
    BodyweightWeekMean StartWeek,
    BodyweightWeekMean LatestWeek,
    decimal DeltaKilograms,
    decimal Percent);

/// <summary>
/// "Since start" (critique B6, PRG-005 as the owner approved it on 2026-10-27): the latest weekly mean
/// minus the mean of the workspace week holding the first start, never two single days. The start week's
/// mean is taken over the weigh-ins of the profile the first start belongs to, and the latest over the
/// profile being read, so a returning client is measured from where they first began. The change is in
/// kilograms and as a percentage of the start week's mean, to one decimal.
/// </summary>
public static class BodyweightSinceStart
{
    public const string MethodKey = "BodyweightSinceStartWeeklyMean";
    public const string MethodVersion = "1.0";

    /// <summary>
    /// Null while there is nothing to compare: no weigh-in in the start's week, or no week with a
    /// weigh-in after it. The start alone is shown then.
    /// </summary>
    public static BodyweightSinceStartResult? Calculate(
        DateOnly startDate,
        IEnumerable<BodyweightTrendSample> startProfileSamples,
        IEnumerable<BodyweightTrendSample> readProfileSamples,
        DayOfWeek weekStartsOn)
    {
        ArgumentNullException.ThrowIfNull(startProfileSamples);
        ArgumentNullException.ThrowIfNull(readProfileSamples);
        var startWeek = BodyweightWeekPolicy.GetWeekStart(startDate, weekStartsOn);
        var startMean = WeekMean(startProfileSamples, startWeek);
        if (startMean is null)
        {
            return null;
        }

        var read = readProfileSamples.ToArray();
        if (read.Length == 0)
        {
            return null;
        }

        var latestWeek = BodyweightWeekPolicy.GetWeekStart(read.Max(sample => sample.Date), weekStartsOn);
        if (latestWeek <= startWeek)
        {
            return null;
        }

        var latestMean = WeekMean(read, latestWeek)!;
        var delta = latestMean.MeanKilograms - startMean.MeanKilograms;
        return new BodyweightSinceStartResult(
            startMean,
            latestMean,
            delta,
            decimal.Round(delta / startMean.MeanKilograms * 100m, 1, MidpointRounding.AwayFromZero));
    }

    private static BodyweightWeekMean? WeekMean(IEnumerable<BodyweightTrendSample> samples, DateOnly weekStart)
    {
        var weekEnd = weekStart.AddDays(7);
        var week = samples.Where(sample => sample.Date >= weekStart && sample.Date < weekEnd).ToArray();
        return week.Length == 0
            ? null
            : new BodyweightWeekMean(
                weekStart,
                decimal.Round(week.Average(sample => sample.ValueKilograms), 3, MidpointRounding.AwayFromZero),
                week.Length);
    }
}
