using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Tenancy;

public sealed class Tenant : AuditableEntity
{
    private Tenant()
    {
    }

    private Tenant(string name, string slug)
    {
        Name = name;
        Slug = slug;
        IsActive = true;
    }

    public string Name { get; private set; } = string.Empty;

    public string Slug { get; private set; } = string.Empty;

    public bool IsActive { get; private set; }

    public static Tenant Create(string name, string slug)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        ArgumentException.ThrowIfNullOrWhiteSpace(slug);
        return new Tenant(name.Trim(), slug.Trim().ToLowerInvariant());
    }
}

public sealed class TenantMembership : AuditableEntity
{
    private TenantMembership()
    {
    }

    private TenantMembership(Guid tenantId, Guid userId, TenantRole role)
    {
        if (tenantId == Guid.Empty || userId == Guid.Empty)
        {
            throw new ArgumentException("Tenant and user ids are required.");
        }

        TenantId = tenantId;
        UserId = userId;
        Role = role;
        Status = MembershipStatus.Active;
    }

    public Guid TenantId { get; private set; }

    public Guid UserId { get; private set; }

    public TenantRole Role { get; private set; }

    public MembershipStatus Status { get; private set; }

    public static TenantMembership Create(Guid tenantId, Guid userId, TenantRole role) =>
        new(tenantId, userId, role);
}

public enum TenantRole
{
    Owner = 1,
    Coach = 2,
    Client = 3,
}

public enum MembershipStatus
{
    Invited = 1,
    Active = 2,
    Suspended = 3,
    Removed = 4,
}
