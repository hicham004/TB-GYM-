using Microsoft.EntityFrameworkCore;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Tenancy;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// Which clients the signed-in person may manage and which they may coach in the current workspace. See ADR 0026
/// and C8 (the owner privacy split, notes plan N9d1a).
/// </summary>
/// <remarks>
/// Two questions, and every client route is sorted into one (<see cref="ClientSide"/>):
/// <list type="bullet">
/// <item><b>May manage</b>, the business side (name, coach, plan and payment status, renewals, sessions, activity
/// counts): the Owner may manage every client of the workspace, a Coach only the clients assigned to them.</item>
/// <item><b>May coach</b>, the private side (training and food logs, check-in answers, weigh-ins, measurements,
/// progress photos, intake answers and the health fields): only the client's own coach, the Owner included, so an
/// Owner who coaches is simply the coach of their own clients. A former client's private side opens only to an Owner
/// who coached them when they left: a release or a leave hands the record to the Owner as its keeper (ADR 0027),
/// which never makes the Owner the coach of another coach's client, and that coach loses the record, so nobody reads
/// another coach's former client's private side.</item>
/// </list>
/// A Client is not restricted here at all, because what a client may reach about themselves is decided by the
/// self-service paths.
/// <para>
/// Route parameters named <c>clientProfileId</c> or <c>clientId</c> are checked once, centrally, by the tenant
/// authorization handler, against the route's <see cref="ClientSide"/>. Routes that reach a client indirectly
/// (through a mesocycle, an enrollment, a workout, a conversation or a photo) ask
/// <see cref="ExcludesFromManagingAsync"/> or <see cref="ExcludesFromCoachingAsync"/> themselves after loading the
/// row that names the client, and answer exactly as they would for a row that does not exist.
/// </para>
/// </remarks>
internal sealed class CoachClientScope(
    GymDbContext dbContext,
    ICurrentUser currentUser,
    ITenantContext tenantContext)
{
    private bool resolved;
    private Guid? restrictedCoachUserId;
    private TenantRole? callerRole;

    /// <summary>
    /// The caller's user id when they are an active Coach (not the Owner) of this workspace, so the clients they may
    /// manage are their own; otherwise null. Resolved once per request. Business reads filter on it; a private read
    /// filters on <see cref="StaffUserIdAsync"/> instead, which narrows the Owner too.
    /// </summary>
    public async Task<Guid?> RestrictedCoachUserIdAsync(CancellationToken cancellationToken)
    {
        if (resolved)
        {
            return restrictedCoachUserId;
        }

        if (currentUser.UserId is { } userId && tenantContext.HasTenant)
        {
            callerRole = await dbContext.TenantMemberships
                .AsNoTracking()
                .Where(membership =>
                    membership.TenantId == tenantContext.TenantId &&
                    membership.UserId == userId &&
                    membership.Status == MembershipStatus.Active)
                .Select(membership => (TenantRole?)membership.Role)
                .SingleOrDefaultAsync(cancellationToken);
            restrictedCoachUserId = callerRole == TenantRole.Coach ? userId : null;
        }

        resolved = true;
        return restrictedCoachUserId;
    }

    /// <summary>
    /// Whether the caller is this workspace's active Owner, read with the role above (no second query). What only the
    /// owner may read, such as the whole workspace's money or the team's client counts, asks this rather than taking
    /// "not restricted" to mean the owner.
    /// </summary>
    public async Task<bool> IsOwnerAsync(CancellationToken cancellationToken)
    {
        await RestrictedCoachUserIdAsync(cancellationToken);
        return callerRole == TenantRole.Owner;
    }

    /// <summary>
    /// The caller's user id when they are an active Owner or Coach of this workspace, else null. A private read lists
    /// only the clients assigned to this id (<c>AssignedCoachUserId == staffUserId</c>, current clients only), so it
    /// lists nothing for a caller who is not staff.
    /// </summary>
    public async Task<Guid?> StaffUserIdAsync(CancellationToken cancellationToken)
    {
        await RestrictedCoachUserIdAsync(cancellationToken);
        return callerRole is TenantRole.Owner or TenantRole.Coach ? currentUser.UserId : null;
    }

    /// <summary>
    /// The business side: true when the caller is a Coach and this client is not assigned to them, including a
    /// client that does not exist in this workspace. Always false for the Owner and for a Client.
    /// </summary>
    public async Task<bool> ExcludesFromManagingAsync(Guid clientProfileId, CancellationToken cancellationToken)
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
    /// The private side: true when the caller is an Owner or a Coach who may not coach this client
    /// (<see cref="MayCoachAsync"/>), including a client that does not exist in this workspace. Always false for a
    /// Client, whose own reads are decided by the self-service paths.
    /// </summary>
    public async Task<bool> ExcludesFromCoachingAsync(Guid clientProfileId, CancellationToken cancellationToken)
    {
        if (await StaffUserIdAsync(cancellationToken) is not { } staffUserId)
        {
            return false;
        }

        return !await MayCoachAsync(staffUserId, clientProfileId, cancellationToken);
    }

    /// <summary>
    /// Whether <paramref name="staffUserId"/> may open this client's private side: they are an active Owner or Coach
    /// of this workspace and the client's coach, and for a former client they were its coach when it left. A release
    /// or a leave records the Owner as the keeper with a <c>Released</c> or <c>ClientLeft</c> history entry only when
    /// someone else coached the client (ADR 0027), so such an entry means the private side is not the Owner's.
    /// </summary>
    public Task<bool> MayCoachAsync(Guid staffUserId, Guid clientProfileId, CancellationToken cancellationToken) =>
        dbContext.ClientProfiles
            .AsNoTracking()
            .AnyAsync(
                client =>
                    client.Id == clientProfileId &&
                    client.AssignedCoachUserId == staffUserId &&
                    dbContext.TenantMemberships.Any(membership =>
                        membership.TenantId == tenantContext.TenantId &&
                        membership.UserId == staffUserId &&
                        membership.Status == MembershipStatus.Active &&
                        (membership.Role == TenantRole.Owner || membership.Role == TenantRole.Coach)) &&
                    (client.ReleasedAtUtc == null ||
                     !dbContext.ClientCoachAssignments.Any(entry =>
                         entry.ClientProfileId == client.Id &&
                         (entry.Reason == ClientCoachAssignmentReason.Released ||
                          entry.Reason == ClientCoachAssignmentReason.ClientLeft))),
                cancellationToken);

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
    /// Whether <paramref name="staffUserId"/>, whoever is asking, is this client's coach now: an
    /// active Owner or Coach the client is assigned to. The Owner is no exception.
    /// </summary>
    /// <remarks>
    /// Messaging asks this about the coach side of a conversation rather than about the caller, so a
    /// client can tell that their old coach's thread is closed and a background dispatcher, which has
    /// no caller at all, can refuse to deliver to a coach who no longer has the client. A thread
    /// belongs to the coach who has the client, so after the owner hands a client to a coach the
    /// owner's old thread closes exactly as a coach's does (ADR 0026, COACH-13); seeing every client
    /// is not the same as being their coach.
    /// </remarks>
    public Task<bool> IsAssignedCoachAsync(
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
                    (membership.Role == TenantRole.Owner || membership.Role == TenantRole.Coach) &&
                    dbContext.ClientProfiles.Any(client =>
                        client.Id == clientProfileId &&
                        client.AssignedCoachUserId == staffUserId),
                cancellationToken);
}
