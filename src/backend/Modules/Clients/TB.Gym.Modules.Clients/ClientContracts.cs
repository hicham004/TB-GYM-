using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Clients;

public interface IClientProfileApplicationService
{
    Task<IReadOnlyList<ClientSummary>> ListAsync(CancellationToken cancellationToken);

    Task<CoachClientDetails?> GetForCoachAsync(Guid clientId, CancellationToken cancellationToken);

    Task<ClientSelfProfile?> GetSelfAsync(CancellationToken cancellationToken);

    Task<OwnCoachView?> GetOwnCoachAsync(CancellationToken cancellationToken);

    Task<ClientCommandResult> UpdateForCoachAsync(
        Guid clientId,
        UpdateClientIntakeRequest request,
        CancellationToken cancellationToken);

    Task<ClientCommandResult> UpdateSelfAsync(
        UpdateClientIntakeRequest request,
        CancellationToken cancellationToken);

    Task<ClientCommandResult> CompleteForCoachAsync(
        Guid clientId,
        CompleteClientOnboardingRequest request,
        CancellationToken cancellationToken);

    Task<ClientCommandResult> CompleteSelfAsync(
        CompleteClientOnboardingRequest request,
        CancellationToken cancellationToken);

    Task<ClientCommandResult> UpdateCoachNotesAsync(
        Guid clientId,
        UpdateCoachNotesRequest request,
        CancellationToken cancellationToken);

    Task<ClientCommandResult> BlockRelationshipAsync(
        Guid clientId,
        ChangeClientRelationshipRequest request,
        CancellationToken cancellationToken);

    Task<ClientCommandResult> UnblockRelationshipAsync(
        Guid clientId,
        ChangeClientRelationshipRequest request,
        CancellationToken cancellationToken);

    /// <summary>The owner moves a client to another active Owner or Coach of the workspace.</summary>
    Task<ClientCommandResult> ReassignCoachAsync(
        Guid clientId,
        ReassignClientCoachRequest request,
        CancellationToken cancellationToken);

    /// <summary>The client's coach history, oldest first, or null for an unknown client.</summary>
    Task<IReadOnlyList<ClientCoachAssignmentView>?> ListCoachAssignmentsAsync(
        Guid clientId,
        CancellationToken cancellationToken);

    /// <summary>
    /// The owner releases a client: their workspace access ends at once, their open plans and
    /// programs close, their record is kept read-only, and they are emailed. See ADR 0027.
    /// </summary>
    Task<ClientCommandResult> ReleaseAsync(
        Guid clientId,
        ReleaseClientRequest request,
        CancellationToken cancellationToken);

    /// <summary>
    /// The signed-in client leaves this workspace themselves. The same effect as a release — access
    /// ends, open work closes, the owner keeps a read-only record — recorded as left by the client, and
    /// the owner and the client's coach are told in-app. No email: the client did it.
    /// </summary>
    Task<ClientCommandResult> LeaveAsync(LeaveWorkspaceRequest request, CancellationToken cancellationToken);

    /// <summary>The owner's former clients, released or departed, most recent first.</summary>
    Task<IReadOnlyList<FormerClientSummary>> ListFormerAsync(CancellationToken cancellationToken);
}

/// <summary>
/// A current client on staff's list. The coach and their name are null while the client waits for a coach
/// (CLI-012).
/// </summary>
public sealed record ClientSummary(
    Guid Id,
    string FirstName,
    string LastName,
    string Email,
    string? PhoneNumber,
    ClientOnboardingStatus OnboardingStatus,
    bool IsCoachBlocked,
    uint Version,
    Guid? AssignedCoachUserId,
    string? AssignedCoachName);

/// <summary>
/// A client as staff read them. <paramref name="MayCoach"/> says whether the caller is the client's own coach
/// (C8, ADR 0026): when false (the Owner on another coach's client, or on a former client someone else coached), the
/// private side is withheld, so the birth date, height, work and steps, the intake answers, the health fields and the
/// coach's notes are null, and only the business side is filled. While the client waits for a coach (CLI-012) the
/// coach is null and their name empty, and nobody may coach them.
/// </summary>
public sealed record CoachClientDetails(
    Guid Id,
    Guid? UserId,
    string FirstName,
    string LastName,
    string Email,
    string? PhoneNumber,
    DateOnly? BirthDate,
    decimal? HeightCentimeters,
    decimal? HeightEnteredValue,
    LengthUnit? HeightEnteredUnit,
    string? WorkType,
    int? AverageDailySteps,
    string? TrainingBackground,
    string? FoodPreferences,
    string? FoodAversions,
    string? Goals,
    string? Allergies,
    string? Medications,
    string? PreviousInjuries,
    string? CoachNotes,
    ClientOnboardingStatus OnboardingStatus,
    DateTimeOffset? OnboardingCompletedAtUtc,
    bool IsCoachBlocked,
    uint Version,
    Guid? AssignedCoachUserId,
    string AssignedCoachName,
    ClientReleaseView? Release = null,
    bool MayCoach = true,
    bool HealthStepOpen = true);

/// <summary>
/// When, why and by whom a client's relationship ended: released by the owner or left by the client.
/// Present only on a former client.
/// </summary>
public sealed record ClientReleaseView(
    DateTimeOffset ReleasedAtUtc,
    string Reason,
    Guid? ReleasedByUserId,
    string ReleasedByName,
    ClientDepartureKind DepartureKind);

/// <summary>One row of the owner's "Former clients" list.</summary>
public sealed record FormerClientSummary(
    Guid Id,
    string FirstName,
    string LastName,
    string Email,
    DateTimeOffset ReleasedAtUtc,
    string Reason,
    ClientDepartureKind DepartureKind);

/// <param name="FoundingCoach">
/// The client's assigned coach is their space's active owner and holds the Founding coach badge, shown
/// to clients (notes plan N3a, decision 15). Infrastructure reads it from platform billing's records.
/// </param>
/// <param name="Lines">
/// What TB Gym shows the client about their coach (notes plan N4b, CLI-021), in the order it was recorded:
/// each confirmed certificate line still up that the coach shows, about the coach of the client's current
/// profile in this space. The server decides every line; Infrastructure reads them from the Identity record.
/// </param>
public sealed record OwnCoachView(string Name, bool FoundingCoach, IReadOnlyList<OwnCoachLineView> Lines);

/// <summary>
/// One line about the client's coach: <paramref name="Text"/> is the finished sentence in the space's
/// language, with its parts, what was shown and the day.
/// </summary>
public sealed record OwnCoachLineView(string Text, string What, DateOnly ShownOn);

/// <param name="SelfDirected">
/// The person signed up into the house (CLI-026): the house's own screens are theirs (the exercise pool, workouts of
/// their own, the programs page), and while <paramref name="CoachedByTheHouse"/> is false they train as their own
/// coach, so their screens name the coaching space, not a coach.
/// </param>
/// <param name="CoachedByTheHouse">
/// A self-directed trainee whose Max plan grants today (CLI-026, SUB-021): the house coaches them as a coach's client
/// is coached, their coach card and Messages included; false again the day Max stops granting. Always false for
/// anyone else.
/// </param>
/// <param name="HealthStepOpen">
/// Whether the intake's health answers may be added or changed (CLI-028): always for a coach's client, and for a house
/// trainee only while Max grants. Answers already saved are kept and read either way.
/// </param>
public sealed record ClientSelfProfile(
    Guid Id,
    string FirstName,
    string LastName,
    string Email,
    string? PhoneNumber,
    DateOnly? BirthDate,
    decimal? HeightCentimeters,
    decimal? HeightEnteredValue,
    LengthUnit? HeightEnteredUnit,
    string? WorkType,
    int? AverageDailySteps,
    string? TrainingBackground,
    string? FoodPreferences,
    string? FoodAversions,
    string? Goals,
    string? Allergies,
    string? Medications,
    string? PreviousInjuries,
    ClientOnboardingStatus OnboardingStatus,
    DateTimeOffset? OnboardingCompletedAtUtc,
    uint Version,
    bool SelfDirected = false,
    bool CoachedByTheHouse = false,
    bool HealthStepOpen = true);

public sealed record UpdateClientIntakeRequest(
    string FirstName,
    string LastName,
    string? PhoneNumber,
    DateOnly? BirthDate,
    decimal? HeightValue,
    LengthUnit? HeightUnit,
    string? WorkType,
    int? AverageDailySteps,
    string? TrainingBackground,
    string? FoodPreferences,
    string? FoodAversions,
    string? Goals,
    string? Allergies,
    string? Medications,
    string? PreviousInjuries,
    uint Version)
{
    public ClientIntakeInput ToInput() =>
        new(
            FirstName,
            LastName,
            PhoneNumber,
            BirthDate,
            HeightValue,
            HeightUnit,
            WorkType,
            AverageDailySteps,
            TrainingBackground,
            FoodPreferences,
            FoodAversions,
            Goals,
            Allergies,
            Medications,
            PreviousInjuries);
}

public sealed record CompleteClientOnboardingRequest(
    UpdateClientIntakeRequest Intake,
    decimal InitialBodyweightValue,
    BodyweightUnit InitialBodyweightUnit,
    DateOnly MeasurementDate);

public sealed record UpdateCoachNotesRequest(string? Notes, uint Version);

public sealed record ChangeClientRelationshipRequest(string Reason, uint Version);

/// <summary>
/// The coach to move the client to, an optional note kept in the history, and the client version the
/// owner saw, so a stale screen conflicts instead of overwriting a newer assignment.
/// </summary>
public sealed record ReassignClientCoachRequest(Guid CoachUserId, string? Note, uint Version);

/// <summary>
/// Why the owner is releasing the client — kept in the relationship history and never emailed — and
/// the client version the owner saw.
/// </summary>
public sealed record ReleaseClientRequest(string Reason, uint Version);

/// <summary>
/// A client leaving on their own: an optional reason the owner will see, and the profile version the
/// client saw.
/// </summary>
public sealed record LeaveWorkspaceRequest(string? Reason, uint Version);

/// <summary>
/// One entry of a client's coach history. The coach and their name are null on an entry that left the client waiting
/// for a coach, and the previous coach is null on the entry that ended a wait (CLI-012).
/// </summary>
public sealed record ClientCoachAssignmentView(
    Guid Id,
    int Sequence,
    Guid? CoachUserId,
    string? CoachName,
    Guid? PreviousCoachUserId,
    string? PreviousCoachName,
    ClientCoachAssignmentReason Reason,
    string? Note,
    DateTimeOffset AssignedAtUtc,
    Guid? AssignedByUserId);

public sealed record ClientCommandResult(
    ClientCommandStatus Status,
    CoachClientDetails? CoachDetails = null,
    ClientSelfProfile? SelfProfile = null,
    IReadOnlyDictionary<string, string[]>? Errors = null);

public enum ClientCommandStatus
{
    Success = 1,
    NotFound = 2,
    Invalid = 3,
    Conflict = 4,

    /// <summary>
    /// An intake added or changed a health answer while the Health step is closed (CLI-028); nothing was saved. The API
    /// answers 409 <c>health_step_closed</c>.
    /// </summary>
    HealthStepClosed = 5,
}

public enum BodyweightUnit
{
    Kilogram = 1,
    Pound = 2,
}

public sealed class ClientsModule : IModuleMarker
{
    public const string Name = "Clients";
}
