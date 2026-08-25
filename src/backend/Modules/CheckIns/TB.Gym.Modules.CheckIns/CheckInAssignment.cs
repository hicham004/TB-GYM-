using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.CheckIns;

/// <summary>
/// One client being asked to complete one specific published version of a form by a workspace-local
/// date. The assignment targets a version and never the lineage, so publishing a later version can
/// never change what an already-assigned client was asked.
/// </summary>
public sealed class CheckInAssignment : TenantEntity
{
    private CheckInAssignment()
    {
    }

    private CheckInAssignment(
        Guid tenantId,
        Guid formId,
        Guid formVersionId,
        Guid clientProfileId,
        DateOnly dueDate)
        : base(tenantId)
    {
        if (formId == Guid.Empty || formVersionId == Guid.Empty || clientProfileId == Guid.Empty)
        {
            throw new ArgumentException("An assignment requires a form version and a client.");
        }

        FormId = formId;
        FormVersionId = formVersionId;
        ClientProfileId = clientProfileId;
        DueDate = dueDate;
    }

    public Guid FormId { get; private set; }

    public Guid FormVersionId { get; private set; }

    public Guid ClientProfileId { get; private set; }

    /// <summary>
    /// Interpreted in the workspace time zone, like every other calendar date in the product.
    /// </summary>
    public DateOnly DueDate { get; private set; }

    /// <summary>
    /// Creates the assignment and the append-only record of who created it. An unpublished version is
    /// refused because its wording can still change, and a due date already in the past is refused
    /// because it asks for something that can no longer be delivered on time.
    /// </summary>
    public static (CheckInAssignment Assignment, CheckInLifecycleEvent Event) Create(
        CheckInFormVersion version,
        Guid clientProfileId,
        DateOnly dueDate,
        DateOnly workspaceToday,
        DateTimeOffset assignedAtUtc,
        Guid assignedByUserId)
    {
        ArgumentNullException.ThrowIfNull(version);
        if (version.Status != CheckInFormVersionStatus.Published)
        {
            throw new InvalidOperationException(
                "Only a published check-in form version can be assigned. Publish the draft first.");
        }

        if (dueDate < workspaceToday)
        {
            throw new ArgumentOutOfRangeException(
                nameof(dueDate),
                "A check-in cannot be due before today in the workspace time zone.");
        }

        if (assignedByUserId == Guid.Empty)
        {
            throw new ArgumentException("An assignment requires the acting user.", nameof(assignedByUserId));
        }

        var assignment = new CheckInAssignment(
            version.TenantId,
            version.FormId,
            version.Id,
            clientProfileId,
            dueDate);
        return (assignment, CheckInLifecycleEvent.AssignmentCreated(assignment, assignedAtUtc, assignedByUserId));
    }
}

/// <summary>
/// Append-only record of the two moments that cannot be undone: a version being published and a
/// version being assigned to a client. Both carry the actor and the instant, and a database trigger
/// refuses updates and deletes.
/// </summary>
public sealed class CheckInLifecycleEvent : TenantEntity
{
    private CheckInLifecycleEvent()
    {
    }

    private CheckInLifecycleEvent(
        Guid tenantId,
        CheckInLifecycleEventType eventType,
        Guid formId,
        Guid formVersionId,
        Guid? assignmentId,
        Guid? clientProfileId,
        DateTimeOffset occurredAtUtc,
        Guid actorUserId)
        : base(tenantId)
    {
        if (actorUserId == Guid.Empty)
        {
            throw new ArgumentException("A lifecycle event requires the acting user.", nameof(actorUserId));
        }

        EventType = eventType;
        FormId = formId;
        FormVersionId = formVersionId;
        AssignmentId = assignmentId;
        ClientProfileId = clientProfileId;
        OccurredAtUtc = occurredAtUtc;
        ActorUserId = actorUserId;
    }

    public CheckInLifecycleEventType EventType { get; private set; }

    public Guid FormId { get; private set; }

    public Guid FormVersionId { get; private set; }

    public Guid? AssignmentId { get; private set; }

    public Guid? ClientProfileId { get; private set; }

    public DateTimeOffset OccurredAtUtc { get; private set; }

    public Guid ActorUserId { get; private set; }

    internal static CheckInLifecycleEvent VersionPublished(
        CheckInFormVersion version,
        DateTimeOffset occurredAtUtc,
        Guid actorUserId) =>
        new(
            version.TenantId,
            CheckInLifecycleEventType.VersionPublished,
            version.FormId,
            version.Id,
            null,
            null,
            occurredAtUtc,
            actorUserId);

    internal static CheckInLifecycleEvent AssignmentCreated(
        CheckInAssignment assignment,
        DateTimeOffset occurredAtUtc,
        Guid actorUserId) =>
        new(
            assignment.TenantId,
            CheckInLifecycleEventType.AssignmentCreated,
            assignment.FormId,
            assignment.FormVersionId,
            assignment.Id,
            assignment.ClientProfileId,
            occurredAtUtc,
            actorUserId);
}

public enum CheckInLifecycleEventType
{
    VersionPublished = 1,
    AssignmentCreated = 2,
}
