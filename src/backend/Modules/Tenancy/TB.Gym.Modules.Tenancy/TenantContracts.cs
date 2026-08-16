using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Tenancy;

public interface ITenantMembershipStore
{
    Task<IReadOnlyList<TenantMembershipSummary>> ListForUserAsync(Guid userId, CancellationToken cancellationToken);

    Task<TenantMembership?> FindActiveAsync(Guid tenantId, Guid userId, CancellationToken cancellationToken);
}

public sealed record TenantMembershipSummary(
    Guid TenantId,
    string TenantName,
    string TenantSlug,
    TenantRole Role);

public sealed class TenancyModule : IModuleMarker
{
    public const string Name = "Tenancy";
}
