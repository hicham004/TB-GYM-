using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Strength;

public sealed class StrengthMaxRecord : TenantEntity
{
    private StrengthMaxRecord()
    {
    }

    private StrengthMaxRecord(
        Guid tenantId,
        Guid clientProfileId,
        Guid exerciseId,
        StrengthMaxKind kind,
        decimal value,
        LoadUnit unit,
        DateOnly effectiveDate,
        StrengthMaxSource source,
        string methodKey,
        string methodVersion,
        Guid? sourceWorkoutExecutionId,
        string? note)
        : base(tenantId)
    {
        if (clientProfileId == Guid.Empty || exerciseId == Guid.Empty)
        {
            throw new ArgumentException("Client and exercise ids are required.");
        }

        if (!Enum.IsDefined(kind) || !Enum.IsDefined(unit) || !Enum.IsDefined(source))
        {
            throw new ArgumentException("Strength max metadata contains an unsupported value.");
        }

        ClientProfileId = clientProfileId;
        ExerciseId = exerciseId;
        Kind = kind;
        Value = StrengthRules.ValidateLoad(value, nameof(value));
        Unit = unit;
        EffectiveDate = effectiveDate;
        Source = source;
        MethodKey = StrengthText.Required(methodKey, 80, nameof(methodKey));
        MethodVersion = StrengthText.Required(methodVersion, 40, nameof(methodVersion));
        SourceWorkoutExecutionId = sourceWorkoutExecutionId;
        Note = StrengthText.Optional(note, 1_000, nameof(note));

        if (kind == StrengthMaxKind.EstimatedOneRepMax && source == StrengthMaxSource.Manual)
        {
            throw new ArgumentException("An estimated max requires a calculation or workout source.");
        }
    }

    public Guid ClientProfileId { get; private set; }

    public Guid ExerciseId { get; private set; }

    public StrengthMaxKind Kind { get; private set; }

    public decimal Value { get; private set; }

    public LoadUnit Unit { get; private set; }

    public DateOnly EffectiveDate { get; private set; }

    public StrengthMaxSource Source { get; private set; }

    public string MethodKey { get; private set; } = string.Empty;

    public string MethodVersion { get; private set; } = string.Empty;

    public Guid? SourceWorkoutExecutionId { get; private set; }

    public string? Note { get; private set; }

    public static StrengthMaxRecord Create(
        Guid tenantId,
        Guid clientProfileId,
        Guid exerciseId,
        StrengthMaxKind kind,
        decimal value,
        LoadUnit unit,
        DateOnly effectiveDate,
        StrengthMaxSource source,
        string methodKey,
        string methodVersion,
        Guid? sourceWorkoutExecutionId,
        string? note) =>
        new(
            tenantId,
            clientProfileId,
            exerciseId,
            kind,
            value,
            unit,
            effectiveDate,
            source,
            methodKey,
            methodVersion,
            sourceWorkoutExecutionId,
            note);
}

public sealed class MesocycleWorkingMaxSnapshot : TenantEntity
{
    private MesocycleWorkingMaxSnapshot()
    {
    }

    private MesocycleWorkingMaxSnapshot(
        Guid tenantId,
        Guid mesocycleId,
        Guid clientProfileId,
        Guid exerciseId,
        Guid? sourceMaxRecordId,
        decimal value,
        LoadUnit unit,
        int effectiveFromWeek,
        Guid? supersedesSnapshotId,
        string reason)
        : base(tenantId)
    {
        if (mesocycleId == Guid.Empty || clientProfileId == Guid.Empty || exerciseId == Guid.Empty)
        {
            throw new ArgumentException("Mesocycle, client, and exercise ids are required.");
        }

        if (effectiveFromWeek is < 1 or > 52)
        {
            throw new ArgumentOutOfRangeException(nameof(effectiveFromWeek));
        }

        MesocycleId = mesocycleId;
        ClientProfileId = clientProfileId;
        ExerciseId = exerciseId;
        SourceMaxRecordId = sourceMaxRecordId;
        Value = StrengthRules.ValidateLoad(value, nameof(value));
        Unit = Enum.IsDefined(unit) ? unit : throw new ArgumentOutOfRangeException(nameof(unit));
        EffectiveFromWeek = effectiveFromWeek;
        SupersedesSnapshotId = supersedesSnapshotId;
        Reason = StrengthText.Required(reason, 500, nameof(reason));
    }

    public Guid MesocycleId { get; private set; }

    public Guid ClientProfileId { get; private set; }

    public Guid ExerciseId { get; private set; }

    public Guid? SourceMaxRecordId { get; private set; }

    public decimal Value { get; private set; }

    public LoadUnit Unit { get; private set; }

    public int EffectiveFromWeek { get; private set; }

    public Guid? SupersedesSnapshotId { get; private set; }

    public string Reason { get; private set; } = string.Empty;

    public static MesocycleWorkingMaxSnapshot Capture(
        Guid tenantId,
        Guid mesocycleId,
        Guid clientProfileId,
        Guid exerciseId,
        Guid? sourceMaxRecordId,
        decimal value,
        LoadUnit unit,
        int effectiveFromWeek,
        Guid? supersedesSnapshotId,
        string reason) =>
        new(
            tenantId,
            mesocycleId,
            clientProfileId,
            exerciseId,
            sourceMaxRecordId,
            value,
            unit,
            effectiveFromWeek,
            supersedesSnapshotId,
            reason);
}

public enum StrengthMaxKind
{
    TestedOneRepMax = 1,
    EstimatedOneRepMax = 2,
    CoachWorkingMax = 3,
}

public enum StrengthMaxSource
{
    Manual = 1,
    TestedLift = 2,
    WorkoutSet = 3,
    Calculation = 4,
}

public enum LoadUnit
{
    Kilogram = 1,
    Pound = 2,
}

internal static class StrengthText
{
    public static string Required(string value, int maxLength, string parameterName)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(value);
        var normalized = value.Trim();
        return normalized.Length <= maxLength
            ? normalized
            : throw new ArgumentException($"The value cannot exceed {maxLength} characters.", parameterName);
    }

    public static string? Optional(string? value, int maxLength, string parameterName) =>
        string.IsNullOrWhiteSpace(value) ? null : Required(value, maxLength, parameterName);
}

internal static class StrengthRules
{
    public static decimal ValidateLoad(decimal value, string parameterName)
    {
        var normalized = decimal.Round(value, 3, MidpointRounding.AwayFromZero);
        return normalized is > 0m and <= 2_000m
            ? normalized
            : throw new ArgumentOutOfRangeException(parameterName, "Load must be greater than zero and at most 2,000.");
    }
}
