using TB.Gym.Modules.Clients;

namespace TB.Gym.Infrastructure.Application;

internal static class ClientProfileQueries
{
    /// <summary>
    /// A person's current client profile in the workspace being queried: linked to them and not ended.
    /// </summary>
    /// <remarks>
    /// A former client who was invited back has two profiles here — the old one, read-only since they
    /// left or were released, and the new one (ADR 0027). Everything a client does for themselves
    /// means the new one, and a partial unique index guarantees there is at most one.
    /// </remarks>
    public static IQueryable<ClientProfile> CurrentFor(this IQueryable<ClientProfile> profiles, Guid userId) =>
        profiles.Where(profile => profile.UserId == userId && profile.ReleasedAtUtc == null);
}
