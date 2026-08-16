namespace TB.Gym.SharedKernel;

public interface ITenantOwnedEntity
{
    Guid TenantId { get; }
}

public abstract class AuditableEntity
{
    public Guid Id { get; protected set; } = Guid.CreateVersion7();

    public DateTimeOffset CreatedAtUtc { get; private set; }

    public Guid? CreatedByUserId { get; private set; }

    public DateTimeOffset UpdatedAtUtc { get; private set; }

    public Guid? UpdatedByUserId { get; private set; }

    public uint Version { get; private set; }

    public void StampCreation(DateTimeOffset now, Guid? userId)
    {
        CreatedAtUtc = now;
        CreatedByUserId = userId;
        UpdatedAtUtc = now;
        UpdatedByUserId = userId;
    }

    public void StampUpdate(DateTimeOffset now, Guid? userId)
    {
        UpdatedAtUtc = now;
        UpdatedByUserId = userId;
    }
}

public abstract class TenantEntity : AuditableEntity, ITenantOwnedEntity
{
    protected TenantEntity()
    {
    }

    protected TenantEntity(Guid tenantId)
    {
        if (tenantId == Guid.Empty)
        {
            throw new ArgumentException("A tenant id is required.", nameof(tenantId));
        }

        TenantId = tenantId;
    }

    public Guid TenantId { get; protected set; }
}
