using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Website;

/// <summary>
/// The public website (UI plan R6.2g): what a visitor who is nobody's member yet can do and read.
/// </summary>
/// <remarks>
/// It owns the Talk-to-us requests a gym sends from the homepage and the public settings the
/// website reads (a WhatsApp number, the analytics script). Nothing here is tenant-owned: a gym that
/// writes to us has no workspace yet, and the request belongs to TB Gym, not to any coaching space.
/// </remarks>
public sealed class WebsiteModule : IModuleMarker
{
    public const string Name = "Website";
}
