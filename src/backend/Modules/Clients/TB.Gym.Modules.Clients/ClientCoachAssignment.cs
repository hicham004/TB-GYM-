using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Clients;

/// <summary>
/// One entry in a client's append-only coach history: who coaches them from this point, who did
/// before, and why it changed. See ADR 0026.
/// </summary>
/// <remarks>
/// Entries are numbered 1, 2, 3… per client. Entry 1 is where the client started (their invitation,
/// their own sign-up into the house, or the migration that gave existing clients to the owner); every
/// later entry names the coach it replaced. An entry may name nobody: the client waits for a coach
/// (CLI-012, C8), because their coach left the team or nobody could take them when they joined. The
/// actor is the audit <c>CreatedByUserId</c>, which is empty for the migration. A database trigger
/// refuses any update or delete, and another refuses a coach change on the profile that has no matching
/// newest entry.
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
        Guid? coachUserId,
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

    /// <summary>Who coaches the client from this entry on; null: nobody, the client waits for a coach (CLI-012).</summary>
    public Guid? CoachUserId { get; private set; }

    /// <summary>Who coached the client before this entry; null on entry 1, and on the entry that ends a wait.</summary>
    public Guid? PreviousCoachUserId { get; private set; }

    public ClientCoachAssignmentReason Reason { get; private set; }

    public string? Note { get; private set; }

    public DateTimeOffset AssignedAtUtc { get; private set; }

    /// <summary>
    /// The first entry: the coach whose invitation the client accepted, or nobody when that coach had left the team
    /// by then and the client waits for a coach (CLI-012).
    /// </summary>
    public static ClientCoachAssignment ForInvitation(
        Guid tenantId,
        Guid clientProfileId,
        Guid? coachUserId,
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

    /// <summary>
    /// The first entry of someone who signed up into the house (CLI-024): the member of the house's staff their
    /// record names, or nobody while the house has no Coach. No invitation came before it, so the history does not
    /// say one did.
    /// </summary>
    public static ClientCoachAssignment ForSignUp(
        Guid tenantId,
        Guid clientProfileId,
        Guid? coachUserId,
        DateTimeOffset assignedAtUtc)
    {
        RequireIds(clientProfileId, coachUserId);
        return new ClientCoachAssignment(
            tenantId,
            clientProfileId,
            1,
            coachUserId,
            null,
            ClientCoachAssignmentReason.SignUp,
            null,
            assignedAtUtc);
    }

    /// <summary>
    /// A later entry that names the coach the client has from now on: a reassignment (the Owner's, a waiting client
    /// included), a release or a leave (the Owner as the record's keeper). <paramref name="previousCoachUserId"/> is
    /// the coach it replaces, or null when the client was waiting for a coach.
    /// </summary>
    public static ClientCoachAssignment ForChange(
        Guid tenantId,
        Guid clientProfileId,
        int sequence,
        Guid? previousCoachUserId,
        Guid coachUserId,
        ClientCoachAssignmentReason reason,
        string? note,
        DateTimeOffset assignedAtUtc)
    {
        RequireIds(clientProfileId, coachUserId);
        RequireLater(sequence);
        if (previousCoachUserId == Guid.Empty || previousCoachUserId == coachUserId)
        {
            throw new ArgumentException("A change names a different previous coach, or nobody.", nameof(previousCoachUserId));
        }

        if (reason is not (ClientCoachAssignmentReason.Reassigned
            or ClientCoachAssignmentReason.Released
            or ClientCoachAssignmentReason.ClientLeft))
        {
            throw new ArgumentOutOfRangeException(
                nameof(reason),
                "A change that names a coach is a reassignment, a release or a client leaving.");
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

    /// <summary>
    /// A coach left the team, removed by the Owner or of their own accord, and the client waits for a coach (C8: the
    /// Owner never gets a departing coach's clients automatically). Names the coach who left and nobody after them.
    /// </summary>
    public static ClientCoachAssignment ForDeparture(
        Guid tenantId,
        Guid clientProfileId,
        int sequence,
        Guid departedCoachUserId,
        ClientCoachAssignmentReason reason,
        DateTimeOffset assignedAtUtc)
    {
        RequireIds(clientProfileId, departedCoachUserId);
        RequireLater(sequence);
        if (reason is not (ClientCoachAssignmentReason.CoachRemoved or ClientCoachAssignmentReason.CoachResigned))
        {
            throw new ArgumentOutOfRangeException(nameof(reason), "A departure is a coach removed or a coach resigning.");
        }

        return new ClientCoachAssignment(
            tenantId,
            clientProfileId,
            sequence,
            null,
            departedCoachUserId,
            reason,
            null,
            assignedAtUtc);
    }

    private static void RequireIds(Guid clientProfileId, Guid? coachUserId)
    {
        if (clientProfileId == Guid.Empty || coachUserId == Guid.Empty)
        {
            throw new ArgumentException("A client is required, and a coach is a member of staff or nobody.");
        }
    }

    private static void RequireLater(int sequence)
    {
        if (sequence < 2)
        {
            throw new ArgumentOutOfRangeException(nameof(sequence), "A change follows the first assignment.");
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
    /// <summary>The client accepted an invitation and started with that coach, or waiting when that coach had left.</summary>
    Invitation = 1,

    /// <summary>The owner gave the client another coach, or a coach at all while they were waiting.</summary>
    Reassigned = 2,

    /// <summary>
    /// The client's coach was removed from the team, and the client waits for a coach (before notes plan N9d1b they
    /// moved to the owner, and those entries still name the owner).
    /// </summary>
    CoachRemoved = 3,

    /// <summary>An existing client was given to the workspace owner when coach assignment shipped.</summary>
    Migration = 4,

    /// <summary>The owner released the client, who moved to the owner as the record's keeper.</summary>
    Released = 5,

    /// <summary>
    /// The client's coach left the team of their own accord, and the client waits for a coach (before notes plan
    /// N9d1b they moved to the owner, and those entries still name the owner).
    /// </summary>
    CoachResigned = 6,

    /// <summary>The client left the workspace and moved to the owner as the record's keeper.</summary>
    ClientLeft = 7,

    /// <summary>
    /// The person signed up into the house with no invitation and started with that member of its staff, or waiting
    /// while the house had no Coach.
    /// </summary>
    SignUp = 8,
}
