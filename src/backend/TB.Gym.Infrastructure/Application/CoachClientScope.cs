using Microsoft.EntityFrameworkCore;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Tenancy;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// Which clients the signed-in person may coach in the current workspace. See ADR 0026.
/// </summary>
/// <remarks>
/// A Coach sees and acts only on the clients assigned to them. The Owner sees every client, and a
/// Client is not restricted here at all, because what a client may reach about themselves is decided
/// by the self-service paths. So the only question this answers is "is the caller a Coach, and is
/// this client someone else's?".
/// <para>
/// Route parameters named <c>clientProfileId</c> or <c>clientId</c> are checked once, centrally, by
/// the tenant authorization handler. Routes that reach a client indirectly — through a mesocycle, an
/// enrollment, a conversation or a photo — ask <see cref="ExcludesAsync"/> themselves after loading
/// the row that names the client, and answer exactly as they would for a row that does not exist.
/// </para>
/// </remarks>
internal sealed class CoachClientScope(
    GymDbContext dbContext,
    ICurrentUser currentUser,
    ITenantContext tenantContext)
{
    private bool resolved;
    private Guid? restrictedCoachUserId;

    /// <summary>
    /// The caller's user id when they are an active Coach (not the Owner) of this workspace, so their
    /// view is limited to their own clients; otherwise null. Resolved once per request.
    /// </summary>
    public async Task<Guid?> RestrictedCoachUserIdAsync(CancellationToken cancellationToken)
    {
        if (resolved)
        {
            return restrictedCoachUserId;
        }

        if (currentUser.UserId is { } userId && tenantContext.HasTenant)
        {
            var role = await dbContext.TenantMemberships
                .AsNoTracking()
                .Where(membership =>
                    membership.TenantId == tenantContext.TenantId &&
                    membership.UserId == userId &&
                    membership.Status == MembershipStatus.Active)
                .Select(membership => (TenantRole?)membership.Role)
                .SingleOrDefaultAsync(cancellationToken);
            restrictedCoachUserId = role == TenantRole.Coach ? userId : null;
        }

        resolved = true;
        return restrictedCoachUserId;
    }

    /// <summary>
    /// True when the caller is a Coach and this client is not assigned to them, including a client
    /// that does not exist in this workspace. Always false for the Owner and for a Client.
    /// </summary>
    public async Task<bool> ExcludesAsync(Guid clientProfileId, CancellationToken cancellationToken)
    {
        if (await RestrictedCoachUserIdAsync(cancellationToken) is not { } coachUserId)
        {
            return false;
        }

        return !await dbContext.ClientProfiles
            .AsNoTracking()
            .AnyAsync(
                client => client.Id == clientProfileId && client.AssignedCoachUserId == coachUserId,
                cancellationToken);
    }

    /// <summary>
    /// Whether the owner released this client (ADR 0027). A released client is always with the owner,
    /// so a Coach never gets this far; the Owner may read the record but change nothing about it.
    /// </summary>
    public Task<bool> IsReleasedAsync(Guid clientProfileId, CancellationToken cancellationToken) =>
        dbContext.ClientProfiles
            .AsNoTracking()
            .AnyAsync(
                client => client.Id == clientProfileId && client.ReleasedAtUtc != null,
                cancellationToken);

    /// <summary>
    /// Refuses a write to a released client's record. Routes that name the client as a route
    /// parameter are refused centrally by the tenant authorization handler; a write that reaches the
    /// client through another row (an enrollment, a mesocycle, a workout) calls this after loading it.
    /// </summary>
    /// <exception cref="ClientReleasedException">The client has been released.</exception>
    public async Task EnsureNotReleasedAsync(Guid clientProfileId, CancellationToken cancellationToken)
    {
        if (await IsReleasedAsync(clientProfileId, cancellationToken))
        {
            throw new ClientReleasedException();
        }
    }

    /// <summary>
    /// Whether <paramref name="staffUserId"/>, whoever is asking, may currently coach this client: the
    /// active Owner always, an active Coach only while the client is assigned to them.
    /// </summary>
    /// <remarks>
    /// Messaging asks this about the coach side of a conversation rather than about the caller, so a
    /// client can tell that their old coach's thread is closed and a background dispatcher, which has
    /// no caller at all, can refuse to deliver to a coach who no longer has the client.
    /// </remarks>
    public Task<bool> MayCoachAsync(
        Guid staffUserId,
        Guid clientProfileId,
        CancellationToken cancellationToken) =>
        dbContext.TenantMemberships
            .AsNoTracking()
            .AnyAsync(
                membership =>
                    membership.TenantId == tenantContext.TenantId &&
                    membership.UserId == staffUserId &&
                    membership.Status == MembershipStatus.Active &&
                    (membership.Role == TenantRole.Owner ||
                     (membership.Role == TenantRole.Coach &&
                      dbContext.ClientProfiles.Any(client =>
                          client.Id == clientProfileId &&
                          client.AssignedCoachUserId == staffUserId))),
                cancellationToken);
}
