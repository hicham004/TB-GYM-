using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Progress;

public sealed class BodyweightObservation : TenantEntity
{
    private BodyweightObservation()
    {
    }

    private BodyweightObservation(
        Guid tenantId,
        Guid clientProfileId,
        DateOnly measurementDate,
        decimal valueKilograms,
        decimal enteredValue,
        RecordedMassUnit enteredUnit,
        BodyweightSource source)
        : base(tenantId)
    {
        ClientProfileId = clientProfileId;
        MeasurementDate = measurementDate;
        ValueKilograms = valueKilograms;
        EnteredValue = enteredValue;
        EnteredUnit = enteredUnit;
        Source = source;
    }

    public Guid ClientProfileId { get; private set; }

    public DateOnly MeasurementDate { get; private set; }

    public decimal ValueKilograms { get; private set; }

    public decimal EnteredValue { get; private set; }

    public RecordedMassUnit EnteredUnit { get; private set; }

    public BodyweightSource Source { get; private set; }

    public static BodyweightObservation CreateInitial(
        Guid tenantId,
        Guid clientProfileId,
        DateOnly measurementDate,
        decimal enteredValue,
        RecordedMassUnit enteredUnit,
        BodyweightSource source = BodyweightSource.Client)
    {
        ValidateClientAndSource(clientProfileId, source);
        var kilograms = BodyweightUnitConverter.ToKilograms(enteredValue, enteredUnit);

        return new BodyweightObservation(
            tenantId,
            clientProfileId,
            measurementDate,
            decimal.Round(kilograms, 3, MidpointRounding.AwayFromZero),
            enteredValue,
            enteredUnit,
            source);
    }

    public BodyweightPreviousValue Correct(
        decimal enteredValue,
        RecordedMassUnit enteredUnit,
        BodyweightSource source)
    {
        ValidateClientAndSource(ClientProfileId, source);
        var kilograms = BodyweightUnitConverter.ToKilograms(enteredValue, enteredUnit);
        var previous = new BodyweightPreviousValue(
            ValueKilograms,
            EnteredValue,
            EnteredUnit,
            Source,
            UpdatedAtUtc,
            UpdatedByUserId ?? CreatedByUserId);

        ValueKilograms = kilograms;
        EnteredValue = enteredValue;
        EnteredUnit = enteredUnit;
        Source = source;
        return previous;
    }

    private static void ValidateClientAndSource(Guid clientProfileId, BodyweightSource source)
    {
        if (clientProfileId == Guid.Empty)
        {
            throw new ArgumentException("A client profile id is required.", nameof(clientProfileId));
        }

        if (!Enum.IsDefined(source) || source == BodyweightSource.DeviceImport)
        {
            throw new ArgumentOutOfRangeException(nameof(source));
        }
    }
}

public sealed class BodyweightCorrection : TenantEntity
{
    private BodyweightCorrection()
    {
    }

    private BodyweightCorrection(
        Guid tenantId,
        Guid observationId,
        Guid clientProfileId,
        DateOnly measurementDate,
        BodyweightPreviousValue previous,
        string reason,
        DateTimeOffset supersededAtUtc,
        Guid supersededByUserId)
        : base(tenantId)
    {
        ObservationId = observationId;
        ClientProfileId = clientProfileId;
        MeasurementDate = measurementDate;
        ValueKilograms = previous.ValueKilograms;
        EnteredValue = previous.EnteredValue;
        EnteredUnit = previous.EnteredUnit;
        Source = previous.Source;
        RecordedAtUtc = previous.RecordedAtUtc;
        RecordedByUserId = previous.RecordedByUserId;
        Reason = NormalizeReason(reason);
        SupersededAtUtc = supersededAtUtc;
        SupersededByUserId = supersededByUserId;
    }

    public Guid ObservationId { get; private set; }
    public Guid ClientProfileId { get; private set; }
    public DateOnly MeasurementDate { get; private set; }
    public decimal ValueKilograms { get; private set; }
    public decimal EnteredValue { get; private set; }
    public RecordedMassUnit EnteredUnit { get; private set; }
    public BodyweightSource Source { get; private set; }
    public DateTimeOffset RecordedAtUtc { get; private set; }
    public Guid? RecordedByUserId { get; private set; }
    public string Reason { get; private set; } = string.Empty;
    public DateTimeOffset SupersededAtUtc { get; private set; }
    public Guid SupersededByUserId { get; private set; }

    public static BodyweightCorrection Create(
        BodyweightObservation observation,
        BodyweightPreviousValue previous,
        string reason,
        DateTimeOffset supersededAtUtc,
        Guid supersededByUserId)
    {
        ArgumentNullException.ThrowIfNull(observation);
        if (supersededByUserId == Guid.Empty)
        {
            throw new ArgumentException("A correction actor is required.", nameof(supersededByUserId));
        }

        return new BodyweightCorrection(
            observation.TenantId,
            observation.Id,
            observation.ClientProfileId,
            observation.MeasurementDate,
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
            : throw new ArgumentException("The correction reason cannot exceed 500 characters.", nameof(reason));
    }
}

public sealed record BodyweightPreviousValue(
    decimal ValueKilograms,
    decimal EnteredValue,
    RecordedMassUnit EnteredUnit,
    BodyweightSource Source,
    DateTimeOffset RecordedAtUtc,
    Guid? RecordedByUserId);

public static class BodyweightUnitConverter
{
    public const decimal PoundsPerKilogram = 2.2046226218487758072297380135m;

    public static decimal ToKilograms(decimal value, RecordedMassUnit unit)
    {
        if (!Enum.IsDefined(unit))
        {
            throw new ArgumentOutOfRangeException(nameof(unit));
        }

        var kilograms = unit == RecordedMassUnit.Kilogram
            ? value
            : value / PoundsPerKilogram;
        if (kilograms is < 20m or > 500m)
        {
            throw new ArgumentOutOfRangeException(
                nameof(value),
                "Bodyweight must be between 20 and 500 kilograms.");
        }

        return decimal.Round(kilograms, 3, MidpointRounding.AwayFromZero);
    }

    public static decimal FromKilograms(decimal kilograms, RecordedMassUnit unit)
    {
        if (!Enum.IsDefined(unit))
        {
            throw new ArgumentOutOfRangeException(nameof(unit));
        }

        var value = unit == RecordedMassUnit.Kilogram
            ? kilograms
            : kilograms * PoundsPerKilogram;
        return decimal.Round(value, 3, MidpointRounding.AwayFromZero);
    }
}

public enum RecordedMassUnit
{
    Kilogram = 1,
    Pound = 2,
}

public enum BodyweightSource
{
    Client = 1,
    Coach = 2,
    DeviceImport = 3,
}

public sealed class ProgressModule : IModuleMarker
{
    public const string Name = "Progress";
}
