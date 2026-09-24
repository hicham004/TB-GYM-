using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Clients;

/// <summary>
/// One entry in a client's append-only coach history: who coaches them from this point, who did
/// before, and why it changed. See ADR 0026.
/// </summary>
/// <remarks>
/// Entries are numbered 1, 2, 3… per client. Entry 1 is where the client started (their invitation,
/// or the migration that gave existing clients to the owner); every later entry names the coach it
/// replaced. The actor is the audit <c>CreatedByUserId</c>, which is empty for the migration. A
/// database trigger refuses any update or delete, and another refuses a coach change on the profile
/// that has no matching newest entry.
/// </remarks>
public sealed class ClientCoachAssignment : TenantEntity
{
    public const int NoteMaximumLength = 500;

    private ClientCoachAssignment()
    {
    }

    private ClientCoachAssignment(
        Guid tenantId,
        Guid clientProfileId,
        int sequence,
        Guid coachUserId,
        Guid? previousCoachUserId,
        ClientCoachAssignmentReason reason,
        string? note,
        DateTimeOffset assignedAtUtc)
        : base(tenantId)
    {
        ClientProfileId = clientProfileId;
        Sequence = sequence;
        CoachUserId = coachUserId;
        PreviousCoachUserId = previousCoachUserId;
        Reason = reason;
        Note = note;
        AssignedAtUtc = assignedAtUtc;
    }

    public Guid ClientProfileId { get; private set; }

    public int Sequence { get; private set; }

    public Guid CoachUserId { get; private set; }

    public Guid? PreviousCoachUserId { get; private set; }

    public ClientCoachAssignmentReason Reason { get; private set; }

    public string? Note { get; private set; }

    public DateTimeOffset AssignedAtUtc { get; private set; }

    /// <summary>The first entry: the coach whose invitation the client accepted.</summary>
    public static ClientCoachAssignment ForInvitation(
        Guid tenantId,
        Guid clientProfileId,
        Guid coachUserId,
        DateTimeOffset assignedAtUtc)
    {
        RequireIds(clientProfileId, coachUserId);
        return new ClientCoachAssignment(
            tenantId,
            clientProfileId,
            1,
            coachUserId,
            null,
            ClientCoachAssignmentReason.Invitation,
            null,
            assignedAtUtc);
    }

    /// <summary>A later entry, replacing <paramref name="previousCoachUserId"/>.</summary>
    public static ClientCoachAssignment ForChange(
        Guid tenantId,
        Guid clientProfileId,
        int sequence,
        Guid previousCoachUserId,
        Guid coachUserId,
        ClientCoachAssignmentReason reason,
        string? note,
        DateTimeOffset assignedAtUtc)
    {
        RequireIds(clientProfileId, coachUserId);
        if (sequence < 2)
        {
            throw new ArgumentOutOfRangeException(nameof(sequence), "A change follows the first assignment.");
        }

        if (previousCoachUserId == Guid.Empty || previousCoachUserId == coachUserId)
        {
            throw new ArgumentException("A change names a different previous coach.", nameof(previousCoachUserId));
        }

        if (reason is not (ClientCoachAssignmentReason.Reassigned
            or ClientCoachAssignmentReason.CoachRemoved
            or ClientCoachAssignmentReason.Released))
        {
            throw new ArgumentOutOfRangeException(nameof(reason), "A change is a reassignment, a coach removal or a release.");
        }

        return new ClientCoachAssignment(
            tenantId,
            clientProfileId,
            sequence,
            coachUserId,
            previousCoachUserId,
            reason,
            NormalizeNote(note),
            assignedAtUtc);
    }

    private static void RequireIds(Guid clientProfileId, Guid coachUserId)
    {
        if (clientProfileId == Guid.Empty || coachUserId == Guid.Empty)
        {
            throw new ArgumentException("A client and a coach are required.");
        }
    }

    private static string? NormalizeNote(string? note)
    {
        if (string.IsNullOrWhiteSpace(note))
        {
            return null;
        }

        var normalized = note.Trim();
        return normalized.Length <= NoteMaximumLength
            ? normalized
            : throw new ArgumentException($"The note cannot exceed {NoteMaximumLength} characters.", nameof(note));
    }
}

public enum ClientCoachAssignmentReason
{
    /// <summary>The client accepted an invitation and started with that coach.</summary>
    Invitation = 1,

    /// <summary>The owner moved the client to another coach.</summary>
    Reassigned = 2,

    /// <summary>The client's coach was removed from the team and the client moved to the owner.</summary>
    CoachRemoved = 3,

    /// <summary>An existing client was given to the workspace owner when coach assignment shipped.</summary>
    Migration = 4,

    /// <summary>The owner released the client, who moved to the owner as the record's keeper.</summary>
    Released = 5,
}
