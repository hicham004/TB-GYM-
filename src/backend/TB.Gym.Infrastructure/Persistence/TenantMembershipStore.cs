using Microsoft.EntityFrameworkCore;
using TB.Gym.Modules.Tenancy;

namespace TB.Gym.Infrastructure.Persistence;

internal sealed class TenantMembershipStore(GymDbContext dbContext) : ITenantMembershipStore
{
    public async Task<IReadOnlyList<TenantMembershipSummary>> ListForUserAsync(
        Guid userId,
        CancellationToken cancellationToken) =>
        await (
            from membership in dbContext.TenantMemberships.AsNoTracking()
            join tenant in dbContext.Tenants.AsNoTracking() on membership.TenantId equals tenant.Id
            where membership.UserId == userId &&
                  membership.Status == MembershipStatus.Active &&
                  tenant.IsActive
            orderby tenant.Name
            select new TenantMembershipSummary(
                tenant.Id,
                tenant.Name,
                tenant.Slug,
                membership.Role))
            .ToListAsync(cancellationToken);

    public Task<TenantMembership?> FindActiveAsync(
        Guid tenantId,
        Guid userId,
        CancellationToken cancellationToken) =>
        (
            from membership in dbContext.TenantMemberships
            join tenant in dbContext.Tenants on membership.TenantId equals tenant.Id
            where membership.TenantId == tenantId &&
                  membership.UserId == userId &&
                  membership.Status == MembershipStatus.Active &&
                  tenant.IsActive
            select membership)
            .SingleOrDefaultAsync(cancellationToken);
}
