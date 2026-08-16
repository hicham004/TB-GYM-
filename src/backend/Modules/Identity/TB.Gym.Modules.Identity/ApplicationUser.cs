using Microsoft.AspNetCore.Identity;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Identity;

public sealed class ApplicationUser : IdentityUser<Guid>
{
    public string DisplayName { get; set; } = string.Empty;

    public bool IsPlatformBlocked { get; set; }

    public DateTimeOffset CreatedAtUtc { get; set; }

    public DateTimeOffset UpdatedAtUtc { get; set; }
}

public static class SystemRoles
{
    public const string PlatformAdmin = "PlatformAdmin";
}

public sealed class IdentityModule : IModuleMarker
{
    public const string Name = "Identity";
}
