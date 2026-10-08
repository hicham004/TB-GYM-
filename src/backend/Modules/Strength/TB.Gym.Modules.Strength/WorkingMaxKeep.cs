using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Strength;

/// <summary>
/// The coach kept a program's max when the client's logged sets suggested another (STR-013, P4c). Append-only:
/// it names the max that was kept, the logged set behind the suggestion and the max that set suggested. From
/// then on only sets logged after it can suggest a new value for that max (BestLoggedSet v1); a later update of
/// the max leaves it behind as history.
/// </summary>
public sealed class WorkingMaxKeep : TenantEntity
{
    private WorkingMaxKeep()
    {
    }

    private WorkingMaxKeep(
        Guid tenantId,
        Guid mesocycleId,
        Guid workingMaxSnapshotId,
        Guid loggedSetPerformanceId,
        decimal suggestedValue,
        LoadUnit unit)
        : base(tenantId)
    {
        if (mesocycleId == Guid.Empty || workingMaxSnapshotId == Guid.Empty || loggedSetPerformanceId == Guid.Empty)
        {
            throw new ArgumentException("The program, the max kept and the logged set behind the suggestion are required.");
        }

        MesocycleId = mesocycleId;
        WorkingMaxSnapshotId = workingMaxSnapshotId;
        LoggedSetPerformanceId = loggedSetPerformanceId;
        SuggestedValue = StrengthRules.ValidateLoad(suggestedValue, nameof(suggestedValue));
        Unit = Enum.IsDefined(unit) ? unit : throw new ArgumentOutOfRangeException(nameof(unit));
    }

    public Guid MesocycleId { get; private set; }

    /// <summary>The max the coach kept.</summary>
    public Guid WorkingMaxSnapshotId { get; private set; }

    /// <summary>The logged set the suggestion came from.</summary>
    public Guid LoggedSetPerformanceId { get; private set; }

    /// <summary>The max that set suggested, in the program's unit; kept so the record reads without the chart.</summary>
    public decimal SuggestedValue { get; private set; }

    public LoadUnit Unit { get; private set; }

    public static WorkingMaxKeep Record(
        Guid tenantId,
        Guid mesocycleId,
        Guid workingMaxSnapshotId,
        Guid loggedSetPerformanceId,
        decimal suggestedValue,
        LoadUnit unit) =>
        new(tenantId, mesocycleId, workingMaxSnapshotId, loggedSetPerformanceId, suggestedValue, unit);
}
