using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Progress;

/// <summary>
/// One client's weight on one workspace-local date. The date is the observation's identity, so it is
/// immutable in the domain and at the database. Fixing a mis-dated entry therefore voids this row and
/// records a replacement on the correct date; it is never an in-place date change, and the voided row
/// is retained so the correction stays visible rather than erased.
/// </summary>
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
        Status = BodyweightObservationStatus.Active;
        IsActive = true;
    }

    public Guid ClientProfileId { get; private set; }

    public DateOnly MeasurementDate { get; private set; }

    public decimal ValueKilograms { get; private set; }

    public decimal EnteredValue { get; private set; }

    public RecordedMassUnit EnteredUnit { get; private set; }

    public BodyweightSource Source { get; private set; }

    public BodyweightObservationStatus Status { get; private set; }

    /// <summary>
    /// The predicate the partial unique index is built on, so a voided row releases its date for
    /// reuse. It is redundant with <see cref="Status"/> on purpose and a check constraint keeps the
    /// two from drifting, exactly as the nutrition plan overlap reservation does.
    /// </summary>
    public bool IsActive { get; private set; }

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
        EnsureActive();
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

    /// <summary>
    /// Withdraws this observation from every current-truth read and returns the append-only record of
    /// why. Voiding is one-way and cannot be combined with a value change: the recorded weight stays
    /// exactly as it was so history reads the original fact, not a rewritten one.
    /// </summary>
    public BodyweightObservationVoid Void(
        string reason,
        DateTimeOffset voidedAtUtc,
        Guid voidedByUserId,
        Guid? replacementObservationId)
    {
        EnsureActive();
        var record = BodyweightObservationVoid.Create(
            this,
            reason,
            voidedAtUtc,
            voidedByUserId,
            replacementObservationId);
        Status = BodyweightObservationStatus.Voided;
        IsActive = false;
        return record;
    }

    private void EnsureActive()
    {
        if (Status != BodyweightObservationStatus.Active)
        {
            throw new InvalidOperationException("The bodyweight observation is already voided.");
        }
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

/// <summary>
/// Append-only record of one observation being voided. It keeps the observation's recorded facts
/// alongside the actor, reason and moment, so a mis-dated entry that has been replaced can still be
/// read back in full instead of vanishing from the client's history.
/// </summary>
public sealed class BodyweightObservationVoid : TenantEntity
{
    private BodyweightObservationVoid()
    {
    }

    private BodyweightObservationVoid(
        Guid tenantId,
        BodyweightObservation observation,
        string reason,
        DateTimeOffset voidedAtUtc,
        Guid voidedByUserId,
        Guid? replacementObservationId)
        : base(tenantId)
    {
        if (voidedByUserId == Guid.Empty)
        {
            throw new ArgumentException("A void requires the acting user.", nameof(voidedByUserId));
        }

        if (replacementObservationId == observation.Id)
        {
            throw new ArgumentException(
                "An observation cannot replace itself.",
                nameof(replacementObservationId));
        }

        ObservationId = observation.Id;
        ClientProfileId = observation.ClientProfileId;
        MeasurementDate = observation.MeasurementDate;
        ValueKilograms = observation.ValueKilograms;
        EnteredValue = observation.EnteredValue;
        EnteredUnit = observation.EnteredUnit;
        Source = observation.Source;
        Reason = ProgressText.RequiredReason(reason);
        VoidedAtUtc = voidedAtUtc;
        VoidedByUserId = voidedByUserId;
        ReplacementObservationId = replacementObservationId;
    }

    public Guid ObservationId { get; private set; }

    public Guid ClientProfileId { get; private set; }

    public DateOnly MeasurementDate { get; private set; }

    public decimal ValueKilograms { get; private set; }

    public decimal EnteredValue { get; private set; }

    public RecordedMassUnit EnteredUnit { get; private set; }

    public BodyweightSource Source { get; private set; }

    public string Reason { get; private set; } = string.Empty;

    public DateTimeOffset VoidedAtUtc { get; private set; }

    public Guid VoidedByUserId { get; private set; }

    /// <summary>
    /// The corrected observation this one was replaced by, or null when it was voided outright.
    /// </summary>
    public Guid? ReplacementObservationId { get; private set; }

    internal static BodyweightObservationVoid Create(
        BodyweightObservation observation,
        string reason,
        DateTimeOffset voidedAtUtc,
        Guid voidedByUserId,
        Guid? replacementObservationId)
    {
        ArgumentNullException.ThrowIfNull(observation);
        return new BodyweightObservationVoid(
            observation.TenantId,
            observation,
            reason,
            voidedAtUtc,
            voidedByUserId,
            replacementObservationId);
    }
}

public enum BodyweightObservationStatus
{
    Active = 1,
    Voided = 2,
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
