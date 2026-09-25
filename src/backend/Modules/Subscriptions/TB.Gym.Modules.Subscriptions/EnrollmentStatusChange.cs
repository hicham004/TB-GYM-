namespace TB.Gym.Modules.Subscriptions;

/// <summary>
/// One status an enrollment entered, and when. Append-only history (ADR 0028).
/// </summary>
/// <remarks>
/// An enrollment keeps only its current status and forgets a pause once it is resumed, so on its own it
/// cannot say whether a plan was paused for the whole of last month. Platform billing reads pauses from
/// this history. A database trigger writes it on every enrollment insert and every status change,
/// stamped with the row's own created or updated time, so no code path can forget it; the application
/// only reads it.
/// </remarks>
public sealed class EnrollmentStatusChange
{
    private EnrollmentStatusChange()
    {
    }

    public Guid Id { get; private set; }

    public Guid TenantId { get; private set; }

    public Guid EnrollmentId { get; private set; }

    public EnrollmentStatus Status { get; private set; }

    public DateTimeOffset ChangedAtUtc { get; private set; }
}
