namespace TB.Gym.SharedKernel;

public interface IClock
{
    DateTimeOffset UtcNow { get; }
}

public interface ICurrentUser
{
    bool IsAuthenticated { get; }

    Guid? UserId { get; }
}

public interface ITenantContext
{
    bool HasTenant { get; }

    Guid TenantId { get; }
}

public interface IMutableTenantContext : ITenantContext
{
    void SetTenant(Guid tenantId);
}

public static class AuthorizationPolicies
{
    public const string PlatformAdmin = "PlatformAdmin";
    public const string TenantMember = "TenantMember";
    public const string TenantOwner = "TenantOwner";
    public const string TenantCoach = "TenantCoach";
    public const string TenantClient = "TenantClient";
}

public static class RateLimitPolicies
{
    public const string PublicAuthentication = "PublicAuthentication";

    public const string SensitiveWrite = "SensitiveWrite";

    public const string MediaUpload = "MediaUpload";

    /// <summary>
    /// The provider-authenticated webhook route. Partitioned by source address, because there is no
    /// signed-in user to partition by and the caller is a fixed set of provider egress addresses.
    /// </summary>
    public const string ProviderWebhook = "ProviderWebhook";
}

public static class TenantHeaders
{
    public const string TenantId = "X-Tenant-Id";
}
