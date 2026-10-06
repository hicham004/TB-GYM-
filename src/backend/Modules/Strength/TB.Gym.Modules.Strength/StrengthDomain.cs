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

/// <summary>Where a program's training max came from.</summary>
public enum WorkingMaxSource
{
    /// <summary>The coach typed the number.</summary>
    Typed = 1,

    /// <summary>The coach picked a max already saved in the client's history.</summary>
    SavedMax = 2,

    /// <summary>Worked out from the weight of week 1's working set on the RTS chart (STR-011).</summary>
    WeekOneWeight = 3,
}

/// <summary>The set a "from week 1's weight" max was worked out from, and the method that did it.</summary>
public sealed record WeekOneWeightBasis(
    decimal Load,
    int Repetitions,
    decimal Rpe,
    string MethodKey,
    string MethodVersion);

/// <summary>
/// One working max a program keeps for one exercise (STR-002). Append-only: assignment captures the first
/// one, and a later update adds a new snapshot that names the one it supersedes, the week it applies from
/// and a reason. Each exercise has one chain, so exactly one snapshot is current.
/// </summary>
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
        string reason,
        WeekOneWeightBasis? basis)
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

        if (basis is not null && sourceMaxRecordId is not null)
        {
            throw new ArgumentException("A max worked out from week 1's weight has no saved max behind it.");
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
        if (basis is not null)
        {
            if (basis.Repetitions is < 1 or > 100 || basis.Rpe is < 5m or > 10m)
            {
                throw new ArgumentException("The set a max was worked out from has an invalid repetition count or RPE.");
            }

            BasisLoad = StrengthRules.ValidateLoad(basis.Load, nameof(basis));
            BasisRepetitions = basis.Repetitions;
            BasisRpe = basis.Rpe;
            EstimateMethodKey = StrengthText.Required(basis.MethodKey, 80, nameof(basis));
            EstimateMethodVersion = StrengthText.Required(basis.MethodVersion, 40, nameof(basis));
        }
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

    /// <summary>The weight, repetitions and RPE of the set a week 1 estimate came from; null otherwise.</summary>
    public decimal? BasisLoad { get; private set; }

    public int? BasisRepetitions { get; private set; }

    public decimal? BasisRpe { get; private set; }

    public string? EstimateMethodKey { get; private set; }

    public string? EstimateMethodVersion { get; private set; }

    /// <summary>Derived, so the source and its numbers can never disagree.</summary>
    public WorkingMaxSource Source =>
        BasisLoad is not null
            ? WorkingMaxSource.WeekOneWeight
            : SourceMaxRecordId is not null
                ? WorkingMaxSource.SavedMax
                : WorkingMaxSource.Typed;

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
            reason,
            null);

    /// <summary>Captures the max a week 1 weight implies, keeping the set it was worked out from.</summary>
    public static MesocycleWorkingMaxSnapshot CaptureFromWeekOneWeight(
        Guid tenantId,
        Guid mesocycleId,
        Guid clientProfileId,
        Guid exerciseId,
        RpeChartMaxEstimate estimate,
        decimal load,
        int repetitions,
        decimal rpe,
        int effectiveFromWeek,
        Guid? supersedesSnapshotId,
        string reason)
    {
        ArgumentNullException.ThrowIfNull(estimate);
        return new(
            tenantId,
            mesocycleId,
            clientProfileId,
            exerciseId,
            null,
            estimate.Value,
            estimate.Unit,
            effectiveFromWeek,
            supersedesSnapshotId,
            reason,
            new WeekOneWeightBasis(load, repetitions, rpe, estimate.StrategyKey, estimate.Version));
    }
}

/// <summary>
/// The audit and idempotency record of one reviewed update of a program's training maxes (STR-002,
/// STR-009). Append-only. The key is unique per workspace, and the fingerprint binds it to the exact
/// request, so a retry returns the first result and a changed request with the same key conflicts.
/// </summary>
public sealed class WorkingMaxUpdate : TenantEntity
{
    private WorkingMaxUpdate()
    {
    }

    private WorkingMaxUpdate(
        Guid tenantId,
        Guid mesocycleId,
        Guid idempotencyKey,
        string requestFingerprint,
        string previewHash,
        string reason,
        int effectiveFromWeek,
        int liftCount,
        int sessionCount,
        int setCount)
        : base(tenantId)
    {
        if (mesocycleId == Guid.Empty || idempotencyKey == Guid.Empty)
        {
            throw new ArgumentException("A mesocycle and an idempotency key are required.");
        }

        if (effectiveFromWeek is < 1 or > 52 || liftCount < 1 || sessionCount < 0 || setCount < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(liftCount));
        }

        MesocycleId = mesocycleId;
        IdempotencyKey = idempotencyKey;
        RequestFingerprint = ValidateHash(requestFingerprint);
        PreviewHash = ValidateHash(previewHash);
        Reason = StrengthText.Required(reason, 500, nameof(reason));
        EffectiveFromWeek = effectiveFromWeek;
        LiftCount = liftCount;
        SessionCount = sessionCount;
        SetCount = setCount;
    }

    public Guid MesocycleId { get; private set; }

    public Guid IdempotencyKey { get; private set; }

    public string RequestFingerprint { get; private set; } = string.Empty;

    public string PreviewHash { get; private set; } = string.Empty;

    public string Reason { get; private set; } = string.Empty;

    public int EffectiveFromWeek { get; private set; }

    public int LiftCount { get; private set; }

    public int SessionCount { get; private set; }

    public int SetCount { get; private set; }

    public static WorkingMaxUpdate Record(
        Guid tenantId,
        Guid mesocycleId,
        Guid idempotencyKey,
        string requestFingerprint,
        string previewHash,
        string reason,
        int effectiveFromWeek,
        int liftCount,
        int sessionCount,
        int setCount) =>
        new(
            tenantId,
            mesocycleId,
            idempotencyKey,
            requestFingerprint,
            previewHash,
            reason,
            effectiveFromWeek,
            liftCount,
            sessionCount,
            setCount);

    private static string ValidateHash(string value)
    {
        var normalized = StrengthText.Required(value, 64, nameof(value)).ToLowerInvariant();
        return normalized.Length == 64 && normalized.All(Uri.IsHexDigit)
            ? normalized
            : throw new ArgumentException("A SHA-256 hash is required.", nameof(value));
    }
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
