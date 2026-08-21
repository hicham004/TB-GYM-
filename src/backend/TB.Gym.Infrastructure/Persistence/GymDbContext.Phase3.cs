using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Persistence;

public sealed partial class GymDbContext
{
    private void ConfigureTenantEntity<TEntity>(EntityTypeBuilder<TEntity> entity)
        where TEntity : TenantEntity
    {
        entity.HasAlternateKey(item => new { item.TenantId, item.Id });
        entity.HasQueryFilter(item =>
            tenantContext.HasTenant && item.TenantId == tenantContext.TenantId);
        ConfigureAuditable(entity);
    }
}
