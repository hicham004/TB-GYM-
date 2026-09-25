namespace TB.Gym.Modules.Tenancy;

/// <summary>
/// One status a membership entered, and when. Append-only history (ADR 0028).
/// </summary>
/// <remarks>
/// A membership row keeps only its current status, so on its own it cannot say whether a coach removed
/// last week was active at any moment of last month. Platform billing counts seats from this history.
/// A database trigger writes it on every membership insert and every status change, stamped with the
/// row's own created or updated time, so no code path can forget it; the application only reads it.
/// </remarks>
public sealed class MembershipStatusChange
{
    private MembershipStatusChange()
    {
    }

    public Guid Id { get; private set; }

    public Guid TenantId { get; private set; }

    public Guid MembershipId { get; private set; }

    public Guid UserId { get; private set; }

    public TenantRole Role { get; private set; }

    public MembershipStatus Status { get; private set; }

    public DateTimeOffset ChangedAtUtc { get; private set; }
}
