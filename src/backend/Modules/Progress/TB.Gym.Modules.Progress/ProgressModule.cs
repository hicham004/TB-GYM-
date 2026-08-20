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
        RecordedMassUnit enteredUnit)
    {
        if (clientProfileId == Guid.Empty)
        {
            throw new ArgumentException("A client profile id is required.", nameof(clientProfileId));
        }

        if (!Enum.IsDefined(enteredUnit))
        {
            throw new ArgumentOutOfRangeException(nameof(enteredUnit));
        }

        var kilograms = enteredUnit == RecordedMassUnit.Kilogram
            ? enteredValue
            : enteredValue * 0.45359237m;
        if (kilograms is < 20m or > 500m)
        {
            throw new ArgumentOutOfRangeException(
                nameof(enteredValue),
                "Bodyweight must be between 20 and 500 kilograms.");
        }

        return new BodyweightObservation(
            tenantId,
            clientProfileId,
            measurementDate,
            decimal.Round(kilograms, 3, MidpointRounding.AwayFromZero),
            enteredValue,
            enteredUnit,
            BodyweightSource.Onboarding);
    }
}

public enum RecordedMassUnit
{
    Kilogram = 1,
    Pound = 2,
}

public enum BodyweightSource
{
    Onboarding = 1,
    ClientEntry = 2,
    CoachEntry = 3,
}

public sealed class ProgressModule : IModuleMarker
{
    public const string Name = "Progress";
}
