using Microsoft.EntityFrameworkCore;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Invitations;
using TB.Gym.Modules.Tenancy;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// The owner's team: who coaches here, and removing a coach without losing any client. See ADR 0026.
/// </summary>
internal sealed class TeamApplicationService(
    GymDbContext dbContext,
    IClock clock,
    ITenantContext tenantContext)
    : ITeamApplicationService
{
    public async Task<IReadOnlyList<TeamMemberSummary>> ListMembersAsync(CancellationToken cancellationToken)
    {
        var tenantId = tenantContext.TenantId;
        var members = await (
            from membership in dbContext.TenantMemberships.AsNoTracking()
            join user in dbContext.Users.AsNoTracking() on membership.UserId equals user.Id
            where membership.TenantId == tenantId &&
                  membership.Status == MembershipStatus.Active &&
                  (membership.Role == TenantRole.Owner || membership.Role == TenantRole.Coach)
            select new
            {
                membership.UserId,
                user.DisplayName,
                user.Email,
                membership.Role,
                membership.CreatedAtUtc,
                membership.Version,
            })
            .ToListAsync(cancellationToken);
        // Current clients only: a released client stays with the owner as a record, not as work.
        var counts = await dbContext.ClientProfiles
            .AsNoTracking()
            .Where(client => client.ReleasedAtUtc == null)
            .GroupBy(client => client.AssignedCoachUserId)
            .Select(group => new { CoachUserId = group.Key, Count = group.Count() })
            .ToDictionaryAsync(item => item.CoachUserId, item => item.Count, cancellationToken);

        return members
            .OrderBy(member => member.Role == TenantRole.Owner ? 0 : 1)
            .ThenBy(member => member.DisplayName, StringComparer.CurrentCultureIgnoreCase)
            .Select(member => new TeamMemberSummary(
                member.UserId,
                member.DisplayName,
                member.Email ?? string.Empty,
                member.Role,
                counts.GetValueOrDefault(member.UserId),
                member.CreatedAtUtc,
                member.Version))
            .ToArray();
    }

    public async Task<CoachRemovalResult> RemoveCoachAsync(
        Guid coachUserId,
        RemoveCoachRequest request,
        CancellationToken cancellationToken)
    {
        var tenantId = tenantContext.TenantId;
        try
        {
            return await dbContext.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
            {
                dbContext.ChangeTracker.Clear();
                await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);

                // Exclusive first, then read. Any assignment to this coach that is already in flight
                // holds a shared lock on the same row, so this waits for it to commit and the client
                // query below then includes that client.
                await CoachTeam.LockMembershipForUpdateAsync(dbContext, tenantId, coachUserId, cancellationToken);
                var membership = await dbContext.TenantMemberships.SingleOrDefaultAsync(
                    item => item.TenantId == tenantId && item.UserId == coachUserId,
                    cancellationToken);
                if (membership is null ||
                    membership.Role != TenantRole.Coach ||
                    membership.Status != MembershipStatus.Active)
                {
                    return new CoachRemovalResult(CoachRemovalStatus.NotFound);
                }

                if (membership.Version != request.Version)
                {
                    return new CoachRemovalResult(CoachRemovalStatus.Conflict);
                }

                var ownerUserId = await CoachTeam.OwnerUserIdAsync(dbContext, tenantId, cancellationToken);
                var now = clock.UtcNow;

                var clients = await dbContext.ClientProfiles
                    .Where(client => client.AssignedCoachUserId == coachUserId)
                    .ToListAsync(cancellationToken);
                foreach (var client in clients)
                {
                    client.AssignCoach(ownerUserId);
                    dbContext.ClientCoachAssignments.Add(ClientCoachAssignment.ForChange(
                        tenantId,
                        client.Id,
                        await CoachTeam.NextAssignmentSequenceAsync(dbContext, client.Id, cancellationToken),
                        coachUserId,
                        ownerUserId,
                        ClientCoachAssignmentReason.CoachRemoved,
                        null,
                        now));
                }

                // Their pending client invitations stay valid; the client will land with the owner.
                var invitations = await dbContext.ClientInvitations
                    .Where(invitation =>
                        invitation.Kind == InvitationKind.Client &&
                        invitation.Status == InvitationStatus.Pending &&
                        invitation.AssignedCoachUserId == coachUserId)
                    .ToListAsync(cancellationToken);
                foreach (var invitation in invitations)
                {
                    invitation.HandOverTo(ownerUserId);
                }

                membership.RemoveCoach();
                await dbContext.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return new CoachRemovalResult(CoachRemovalStatus.Removed, clients.Count, invitations.Count);
            });
        }
        catch (DbUpdateException)
        {
            // A client's own concurrent reassignment took the history number or version first.
            dbContext.ChangeTracker.Clear();
            return new CoachRemovalResult(CoachRemovalStatus.Conflict);
        }
    }
}
