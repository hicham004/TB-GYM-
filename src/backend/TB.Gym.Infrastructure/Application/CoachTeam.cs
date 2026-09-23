using Microsoft.EntityFrameworkCore;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Tenancy;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// The shared steps every write that assigns a client to a coach takes, so reassignment, invitation
/// acceptance and coach removal cannot disagree about locking or history numbering. See ADR 0026.
/// </summary>
/// <remarks>
/// The race these locks close: an owner removes a coach while one of that coach's clients accepts an
/// invitation, or while the owner reassigns somebody to them. Assigning takes a shared lock on the
/// coach's membership row; removal takes an exclusive one. Under read committed, whichever runs second
/// waits for the first to commit and then sees its result — removal then moves the newly assigned
/// client too, or the assignment finds the coach no longer active. Deferred database triggers refuse
/// any outcome that still ends with a client assigned to somebody who is not active staff.
/// </remarks>
internal static class CoachTeam
{
    /// <summary>
    /// Locks <paramref name="userId"/>'s membership row for sharing and reports whether they are an
    /// active Owner or Coach. Must run inside the caller's transaction.
    /// </summary>
    public static async Task<bool> LockActiveStaffAsync(
        GymDbContext dbContext,
        Guid tenantId,
        Guid userId,
        CancellationToken cancellationToken)
    {
        var locked = await dbContext.Database.SqlQuery<Guid>($"""
            SELECT "UserId" AS "Value"
            FROM tenancy."Memberships"
            WHERE "TenantId" = {tenantId}
              AND "UserId" = {userId}
              AND "Status" = 'Active'
              AND "Role" IN ('Owner', 'Coach')
            FOR SHARE /* coach-assignment */
            """).ToListAsync(cancellationToken);
        return locked.Count == 1;
    }

    /// <summary>Locks a membership row for update, ahead of reading and changing it.</summary>
    public static async Task LockMembershipForUpdateAsync(
        GymDbContext dbContext,
        Guid tenantId,
        Guid userId,
        CancellationToken cancellationToken) =>
        await dbContext.Database.ExecuteSqlAsync(
            $"""SELECT 1 FROM tenancy."Memberships" WHERE "TenantId" = {tenantId} AND "UserId" = {userId} FOR UPDATE /* coach-removal */""",
            cancellationToken);

    /// <summary>The workspace's one active owner. A unique partial index guarantees there is one.</summary>
    public static Task<Guid> OwnerUserIdAsync(
        GymDbContext dbContext,
        Guid tenantId,
        CancellationToken cancellationToken) =>
        dbContext.TenantMemberships
            .AsNoTracking()
            .Where(membership =>
                membership.TenantId == tenantId &&
                membership.Role == TenantRole.Owner &&
                membership.Status == MembershipStatus.Active)
            .Select(membership => membership.UserId)
            .SingleAsync(cancellationToken);

    /// <summary>
    /// The coach a newly accepted client starts with: the one the invitation names while they are
    /// still active staff, otherwise the owner. Locks the chosen membership like any assignment.
    /// </summary>
    public static async Task<Guid> ResolveStartingCoachAsync(
        GymDbContext dbContext,
        Guid tenantId,
        Guid? invitedFor,
        CancellationToken cancellationToken)
    {
        if (invitedFor is { } coachUserId &&
            await LockActiveStaffAsync(dbContext, tenantId, coachUserId, cancellationToken))
        {
            return coachUserId;
        }

        var ownerUserId = await OwnerUserIdAsync(dbContext, tenantId, cancellationToken);
        await LockActiveStaffAsync(dbContext, tenantId, ownerUserId, cancellationToken);
        return ownerUserId;
    }

    /// <summary>The next history number for one client. Unique per client, so a racer conflicts.</summary>
    public static async Task<int> NextAssignmentSequenceAsync(
        GymDbContext dbContext,
        Guid clientProfileId,
        CancellationToken cancellationToken) =>
        (await dbContext.ClientCoachAssignments
            .AsNoTracking()
            .Where(item => item.ClientProfileId == clientProfileId)
            .MaxAsync(item => (int?)item.Sequence, cancellationToken) ?? 0) + 1;
}
