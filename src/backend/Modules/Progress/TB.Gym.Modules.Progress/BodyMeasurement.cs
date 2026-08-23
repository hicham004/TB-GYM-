using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Progress;

public sealed class BodyMeasurement : TenantEntity
{
    private BodyMeasurement()
    {
    }

    private BodyMeasurement(
        Guid tenantId,
        Guid clientProfileId,
        DateOnly measurementDate,
        MeasurementType measurementType,
        decimal canonicalValue,
        decimal enteredValue,
        MeasurementUnit enteredUnit,
        BodyMeasurementSource source)
        : base(tenantId)
    {
        ClientProfileId = clientProfileId;
        MeasurementDate = measurementDate;
        MeasurementType = measurementType;
        CanonicalValue = canonicalValue;
        EnteredValue = enteredValue;
        EnteredUnit = enteredUnit;
        Source = source;
    }

    public Guid ClientProfileId { get; private set; }
    public DateOnly MeasurementDate { get; private set; }
    public MeasurementType MeasurementType { get; private set; }
    public decimal CanonicalValue { get; private set; }
    public decimal EnteredValue { get; private set; }
    public MeasurementUnit EnteredUnit { get; private set; }
    public BodyMeasurementSource Source { get; private set; }

    public static BodyMeasurement CreateInitial(
        Guid tenantId,
        Guid clientProfileId,
        DateOnly measurementDate,
        MeasurementType measurementType,
        decimal enteredValue,
        MeasurementUnit enteredUnit,
        BodyMeasurementSource source)
    {
        ValidateClientAndSource(clientProfileId, source);
        var canonicalValue = BodyMeasurementUnitConverter.ToCanonical(
            measurementType,
            enteredValue,
            enteredUnit);
        return new BodyMeasurement(
            tenantId,
            clientProfileId,
            measurementDate,
            measurementType,
            canonicalValue,
            enteredValue,
            enteredUnit,
            source);
    }

    public BodyMeasurementPreviousValue Correct(
        decimal enteredValue,
        MeasurementUnit enteredUnit,
        BodyMeasurementSource source)
    {
        ValidateClientAndSource(ClientProfileId, source);
        var canonicalValue = BodyMeasurementUnitConverter.ToCanonical(
            MeasurementType,
            enteredValue,
            enteredUnit);
        var previous = new BodyMeasurementPreviousValue(
            CanonicalValue,
            EnteredValue,
            EnteredUnit,
            Source,
            UpdatedAtUtc,
            UpdatedByUserId ?? CreatedByUserId);

        CanonicalValue = canonicalValue;
        EnteredValue = enteredValue;
        EnteredUnit = enteredUnit;
        Source = source;
        return previous;
    }

    private static void ValidateClientAndSource(
        Guid clientProfileId,
        BodyMeasurementSource source)
    {
        if (clientProfileId == Guid.Empty)
        {
            throw new ArgumentException("A client profile id is required.", nameof(clientProfileId));
        }

        if (!Enum.IsDefined(source))
        {
            throw new ArgumentOutOfRangeException(nameof(source));
        }
    }
}

public sealed class BodyMeasurementCorrection : TenantEntity
{
    private BodyMeasurementCorrection()
    {
    }

    private BodyMeasurementCorrection(
        Guid tenantId,
        Guid measurementId,
        Guid clientProfileId,
        DateOnly measurementDate,
        MeasurementType measurementType,
        BodyMeasurementPreviousValue previous,
        string reason,
        DateTimeOffset supersededAtUtc,
        Guid supersededByUserId)
        : base(tenantId)
    {
        MeasurementId = measurementId;
        ClientProfileId = clientProfileId;
        MeasurementDate = measurementDate;
        MeasurementType = measurementType;
        CanonicalValue = previous.CanonicalValue;
        EnteredValue = previous.EnteredValue;
        EnteredUnit = previous.EnteredUnit;
        Source = previous.Source;
        RecordedAtUtc = previous.RecordedAtUtc;
        RecordedByUserId = previous.RecordedByUserId;
        Reason = NormalizeReason(reason);
        SupersededAtUtc = supersededAtUtc;
        SupersededByUserId = supersededByUserId;
    }

    public Guid MeasurementId { get; private set; }
    public Guid ClientProfileId { get; private set; }
    public DateOnly MeasurementDate { get; private set; }
    public MeasurementType MeasurementType { get; private set; }
    public decimal CanonicalValue { get; private set; }
    public decimal EnteredValue { get; private set; }
    public MeasurementUnit EnteredUnit { get; private set; }
    public BodyMeasurementSource Source { get; private set; }
    public DateTimeOffset RecordedAtUtc { get; private set; }
    public Guid? RecordedByUserId { get; private set; }
    public string Reason { get; private set; } = string.Empty;
    public DateTimeOffset SupersededAtUtc { get; private set; }
    public Guid SupersededByUserId { get; private set; }

    public static BodyMeasurementCorrection Create(
        BodyMeasurement measurement,
        BodyMeasurementPreviousValue previous,
        string reason,
        DateTimeOffset supersededAtUtc,
        Guid supersededByUserId)
    {
        ArgumentNullException.ThrowIfNull(measurement);
        if (supersededByUserId == Guid.Empty)
        {
            throw new ArgumentException("A correction actor is required.", nameof(supersededByUserId));
        }

        return new BodyMeasurementCorrection(
            measurement.TenantId,
            measurement.Id,
            measurement.ClientProfileId,
            measurement.MeasurementDate,
            measurement.MeasurementType,
            previous,
            reason,
            supersededAtUtc,
            supersededByUserId);
    }

    private static string NormalizeReason(string reason)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(reason);
        var normalized = reason.Trim();
        return normalized.Length <= 500
            ? normalized
            : throw new ArgumentException(
                "The correction reason cannot exceed 500 characters.",
                nameof(reason));
    }
}

public sealed record BodyMeasurementPreviousValue(
    decimal CanonicalValue,
    decimal EnteredValue,
    MeasurementUnit EnteredUnit,
    BodyMeasurementSource Source,
    DateTimeOffset RecordedAtUtc,
    Guid? RecordedByUserId);

public static class BodyMeasurementUnitConverter
{
    public const decimal CentimetresPerInch = 2.54m;

    public static decimal ToCanonical(
        MeasurementType measurementType,
        decimal value,
        MeasurementUnit unit)
    {
        ValidateTypeAndUnit(measurementType, unit);
        var canonicalValue = measurementType == MeasurementType.BodyFatPercentage
            ? value
            : unit == MeasurementUnit.Centimetre
                ? value
                : value * CentimetresPerInch;
        ValidateRange(measurementType, canonicalValue);
        return decimal.Round(canonicalValue, 3, MidpointRounding.AwayFromZero);
    }

    public static decimal FromCanonical(
        MeasurementType measurementType,
        decimal canonicalValue,
        MeasurementUnit displayUnit)
    {
        ValidateTypeAndUnit(measurementType, displayUnit);
        var displayValue = measurementType == MeasurementType.BodyFatPercentage ||
                           displayUnit == MeasurementUnit.Centimetre
            ? canonicalValue
            : canonicalValue / CentimetresPerInch;
        return decimal.Round(displayValue, 3, MidpointRounding.AwayFromZero);
    }

    public static MeasurementUnit CanonicalUnit(MeasurementType measurementType)
    {
        if (!Enum.IsDefined(measurementType))
        {
            throw new ArgumentOutOfRangeException(nameof(measurementType));
        }

        return measurementType == MeasurementType.BodyFatPercentage
            ? MeasurementUnit.Percent
            : MeasurementUnit.Centimetre;
    }

    private static void ValidateTypeAndUnit(
        MeasurementType measurementType,
        MeasurementUnit unit)
    {
        if (!Enum.IsDefined(measurementType))
        {
            throw new ArgumentOutOfRangeException(nameof(measurementType));
        }

        if (!Enum.IsDefined(unit))
        {
            throw new ArgumentOutOfRangeException(nameof(unit));
        }

        var valid = measurementType == MeasurementType.BodyFatPercentage
            ? unit == MeasurementUnit.Percent
            : unit is MeasurementUnit.Centimetre or MeasurementUnit.Inch;
        if (!valid)
        {
            throw new ArgumentException(
                $"{unit} is not valid for {measurementType}.",
                nameof(unit));
        }
    }

    private static void ValidateRange(
        MeasurementType measurementType,
        decimal canonicalValue)
    {
        if (measurementType == MeasurementType.BodyFatPercentage)
        {
            if (canonicalValue is < 1m or > 75m)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(canonicalValue),
                    "Body fat percentage must be between 1 and 75 percent.");
            }

            return;
        }

        if (canonicalValue is < 10m or > 300m)
        {
            throw new ArgumentOutOfRangeException(
                nameof(canonicalValue),
                "Girth measurements must be between 10 and 300 centimetres.");
        }
    }
}

public enum MeasurementType
{
    Waist = 1,
    Chest = 2,
    Hips = 3,
    Thigh = 4,
    Arm = 5,
    BodyFatPercentage = 6,
}

public enum MeasurementUnit
{
    Centimetre = 1,
    Inch = 2,
    Percent = 3,
}

public enum BodyMeasurementSource
{
    Client = 1,
    Coach = 2,
}
