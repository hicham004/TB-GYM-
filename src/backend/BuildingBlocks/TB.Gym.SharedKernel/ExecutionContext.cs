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

    /// <summary>
    /// A person's own authoring and logging (programs, meal plans, sets, meals, weigh-ins, settings):
    /// every state-changing route that names no stricter policy, in a bucket of its own (audit INV-10).
    /// </summary>
    public const string RoutineWrite = "RoutineWrite";

    public const string MediaUpload = "MediaUpload";

    /// <summary>
    /// The provider-authenticated webhook route. Partitioned by source address, because there is no
    /// signed-in user to partition by and the caller is a fixed set of provider egress addresses.
    /// </summary>
    public const string ProviderWebhook = "ProviderWebhook";

    /// <summary>
    /// The public website's Talk-to-us form (UI plan R6.2g): the one route anybody may post to
    /// without an account, partitioned by source address with an allowance sized for a person.
    /// </summary>
    public const string PublicContact = "PublicContact";
}

public static class TenantHeaders
{
    public const string TenantId = "X-Tenant-Id";
}
