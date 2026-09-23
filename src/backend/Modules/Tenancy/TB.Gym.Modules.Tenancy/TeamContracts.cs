namespace TB.Gym.Modules.Tenancy;

/// <summary>
/// The owner's view of the people who coach in this workspace. See ADR 0026.
/// </summary>
public interface ITeamApplicationService
{
    /// <summary>The active Owner and Coaches, with how many clients each is assigned.</summary>
    Task<IReadOnlyList<TeamMemberSummary>> ListMembersAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Removes a coach. Their clients move to the owner in the same transaction, and their pending
    /// client invitations will land with the owner too. Nothing about the clients is deleted.
    /// </summary>
    Task<CoachRemovalResult> RemoveCoachAsync(
        Guid coachUserId,
        RemoveCoachRequest request,
        CancellationToken cancellationToken);
}

public sealed record TeamMemberSummary(
    Guid UserId,
    string DisplayName,
    string Email,
    TenantRole Role,
    int AssignedClientCount,
    DateTimeOffset JoinedAtUtc,
    uint Version);

/// <summary>The membership version the owner saw, so a stale screen conflicts instead of acting.</summary>
public sealed record RemoveCoachRequest(uint Version);

public sealed record CoachRemovalResult(
    CoachRemovalStatus Status,
    int ReassignedClientCount = 0,
    int ReassignedInvitationCount = 0);

public sealed record CoachRemovalResponse(int ReassignedClientCount, int ReassignedInvitationCount);

public enum CoachRemovalStatus
{
    Removed = 1,
    NotFound = 2,
    Conflict = 3,
}
