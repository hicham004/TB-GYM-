using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Training;

public sealed class MesocycleLifecycleEvent : TenantEntity
{
    private MesocycleLifecycleEvent()
    {
    }

    private MesocycleLifecycleEvent(
        Guid tenantId,
        Guid mesocycleId,
        MesocycleLifecycleEventType eventType,
        MesocycleStatus? fromStatus,
        MesocycleStatus toStatus,
        string reason,
        DateTimeOffset occurredAtUtc)
        : base(tenantId)
    {
        if (mesocycleId == Guid.Empty || !Enum.IsDefined(eventType) ||
            (fromStatus is { } source && !Enum.IsDefined(source)) || !Enum.IsDefined(toStatus))
        {
            throw new ArgumentException("Mesocycle lifecycle metadata is invalid.");
        }

        MesocycleId = mesocycleId;
        EventType = eventType;
        FromStatus = fromStatus;
        ToStatus = toStatus;
        Reason = TrainingText.Required(reason, 500, nameof(reason));
        OccurredAtUtc = occurredAtUtc;
    }

    public Guid MesocycleId { get; private set; }

    public MesocycleLifecycleEventType EventType { get; private set; }

    public MesocycleStatus? FromStatus { get; private set; }

    public MesocycleStatus ToStatus { get; private set; }

    public string Reason { get; private set; } = string.Empty;

    public DateTimeOffset OccurredAtUtc { get; private set; }

    public static MesocycleLifecycleEvent Record(
        Guid tenantId,
        Guid mesocycleId,
        MesocycleLifecycleEventType eventType,
        MesocycleStatus? fromStatus,
        MesocycleStatus toStatus,
        string reason,
        DateTimeOffset occurredAtUtc) =>
        new(tenantId, mesocycleId, eventType, fromStatus, toStatus, reason, occurredAtUtc);
}

public enum MesocycleLifecycleEventType
{
    Assigned = 1,
    Cancelled = 2,
    Completed = 3,
}
