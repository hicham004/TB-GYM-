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
    ICurrentUser currentUser,
    ITenantContext tenantContext)
    : ITeamApplicationService
{
    public async Task<IReadOnlyList<TeamMemberSummary>> ListMembersAsync(CancellationToken cancellationToken)
    {
        var members = await (
            from membership in ActiveStaff()
            join user in dbContext.Users.AsNoTracking() on membership.UserId equals user.Id
            select new
            {
                membership.UserId,
                user.DisplayName,
                user.Email,
                membership.Role,
                // When they last became active (the membership's history, ADR 0028): a removed coach invited
                // back reuses the row, whose creation time is their first stint, not this one.
                JoinedAtUtc = dbContext.MembershipStatusChanges
                    .Where(change =>
                        change.TenantId == membership.TenantId &&
                        change.MembershipId == membership.Id &&
                        change.Status == MembershipStatus.Active)
                    .Max(change => (DateTimeOffset?)change.ChangedAtUtc) ?? membership.CreatedAtUtc,
                membership.Version,
            })
            .ToListAsync(cancellationToken);
        // Current clients only: a released client stays with the owner as a record, not as work. A client
        // waiting for a coach is nobody's (CLI-012), so no row counts them; Today lists them for the owner.
        var counts = await dbContext.ClientProfiles
            .AsNoTracking()
            .Where(client => client.ReleasedAtUtc == null && client.AssignedCoachUserId != null)
            .GroupBy(client => client.AssignedCoachUserId!.Value)
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
                member.JoinedAtUtc,
                member.Version))
            .ToArray();
    }

    public async Task<IReadOnlyList<TeamRosterMember>> ListRosterAsync(CancellationToken cancellationToken)
    {
        // Only what a coach may see of their colleagues is read at all (ADR 0026).
        var members = await (
            from membership in ActiveStaff()
            join user in dbContext.Users.AsNoTracking() on membership.UserId equals user.Id
            select new
            {
                membership.UserId,
                user.DisplayName,
                membership.Role,
                // The same joining day as the owner's list: the latest return, not the first stint.
                JoinedAtUtc = dbContext.MembershipStatusChanges
                    .Where(change =>
                        change.TenantId == membership.TenantId &&
                        change.MembershipId == membership.Id &&
                        change.Status == MembershipStatus.Active)
                    .Max(change => (DateTimeOffset?)change.ChangedAtUtc) ?? membership.CreatedAtUtc,
            })
            .ToListAsync(cancellationToken);

        return members
            .OrderBy(member => member.Role == TenantRole.Owner ? 0 : 1)
            .ThenBy(member => member.DisplayName, StringComparer.CurrentCultureIgnoreCase)
            .Select(member => new TeamRosterMember(
                member.DisplayName,
                member.Role,
                member.JoinedAtUtc,
                member.UserId == currentUser.UserId))
            .ToArray();
    }

    /// <summary>The workspace's active Owner and Coaches, the team both lists read.</summary>
    private IQueryable<TenantMembership> ActiveStaff()
    {
        var tenantId = tenantContext.TenantId;
        return dbContext.TenantMemberships
            .AsNoTracking()
            .Where(membership =>
                membership.TenantId == tenantId &&
                membership.Status == MembershipStatus.Active &&
                (membership.Role == TenantRole.Owner || membership.Role == TenantRole.Coach));
    }

    public Task<CoachRemovalResult> RemoveCoachAsync(
        Guid coachUserId,
        RemoveCoachRequest request,
        CancellationToken cancellationToken) =>
        DepartAsync(coachUserId, request.Version, ClientCoachAssignmentReason.CoachRemoved, cancellationToken);

    public Task<CoachRemovalResult> ResignAsync(CancellationToken cancellationToken) =>
        currentUser.UserId is { } coachUserId
            ? DepartAsync(coachUserId, expectedVersion: null, ClientCoachAssignmentReason.CoachResigned, cancellationToken)
            : Task.FromResult(new CoachRemovalResult(CoachRemovalStatus.NotFound));

    /// <summary>
    /// A coach leaves the team, removed by the owner or of their own accord. Their clients and pending
    /// client invitations wait for a coach (C8, CLI-014: the owner never gets them automatically), each
    /// client with a waiting entry in their coach history and nothing deleted, and each client with access
    /// is told in-app and by email that the workspace will give them a new coach (ADR 0027). The counts the
    /// result carries are of the clients and invitations left waiting.
    /// </summary>
    private async Task<CoachRemovalResult> DepartAsync(
        Guid coachUserId,
        uint? expectedVersion,
        ClientCoachAssignmentReason reason,
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

                if (expectedVersion is { } version && membership.Version != version)
                {
                    return new CoachRemovalResult(CoachRemovalStatus.Conflict);
                }

                var timeZoneId = await WorkspaceRelationshipNotices.TenantTimeZoneAsync(dbContext, tenantId, cancellationToken);
                var now = clock.UtcNow;

                var clients = await dbContext.ClientProfiles
                    .Where(client => client.AssignedCoachUserId == coachUserId)
                    .ToListAsync(cancellationToken);
                var clientUserIds = clients.Where(client => client.UserId is not null).Select(client => client.UserId!.Value).ToList();
                var activeClientUserIds = await dbContext.TenantMemberships
                    .Where(item =>
                        item.TenantId == tenantId &&
                        clientUserIds.Contains(item.UserId) &&
                        item.Role == TenantRole.Client &&
                        item.Status == MembershipStatus.Active)
                    .Select(item => item.UserId)
                    .ToListAsync(cancellationToken);
                foreach (var client in clients)
                {
                    // One change of the coach per profile in this transaction: the deferred coach trigger reads
                    // each update's own row against the newest history entry at commit.
                    client.WaitForCoach();
                    var entry = ClientCoachAssignment.ForDeparture(
                        tenantId,
                        client.Id,
                        await CoachTeam.NextAssignmentSequenceAsync(dbContext, client.Id, cancellationToken),
                        coachUserId,
                        reason,
                        now);
                    dbContext.ClientCoachAssignments.Add(entry);
                    // Their programs and meal plans keep running and they can still log; nobody opens their
                    // private side until the owner gives them a coach (CLI-013). A self-directed trainee has no
                    // coach to lose (CLI-026): their record waits like any other and they are told nothing about it.
                    if (client.UserId is { } clientUserId && activeClientUserIds.Contains(clientUserId) && !client.IsSelfDirected)
                    {
                        WorkspaceRelationshipNotices.CoachDeparted(
                            dbContext,
                            tenantId,
                            timeZoneId,
                            clientUserId,
                            client.Id,
                            entry.Id,
                            currentUser.UserId,
                            now);
                    }
                }

                // Their pending client invitations stay valid; a client who accepts one lands waiting too.
                var invitations = await dbContext.ClientInvitations
                    .Where(invitation =>
                        invitation.Kind == InvitationKind.Client &&
                        invitation.Status == InvitationStatus.Pending &&
                        invitation.AssignedCoachUserId == coachUserId)
                    .ToListAsync(cancellationToken);
                foreach (var invitation in invitations)
                {
                    invitation.WaitForCoach();
                }

                membership.RemoveCoach();

                // The owner removed a coach themselves, so only a resignation is news to them.
                if (reason == ClientCoachAssignmentReason.CoachResigned)
                {
                    WorkspaceRelationshipNotices.CoachResigned(
                        dbContext,
                        tenantId,
                        timeZoneId,
                        await CoachTeam.OwnerUserIdAsync(dbContext, tenantId, cancellationToken),
                        membership.Id,
                        coachUserId,
                        now);
                }

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
