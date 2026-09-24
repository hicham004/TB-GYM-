using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Clients;

public interface IClientProfileApplicationService
{
    Task<IReadOnlyList<ClientSummary>> ListAsync(CancellationToken cancellationToken);

    Task<CoachClientDetails?> GetForCoachAsync(Guid clientId, CancellationToken cancellationToken);

    Task<ClientSelfProfile?> GetSelfAsync(CancellationToken cancellationToken);

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

    /// <summary>The owner's released clients, most recently released first.</summary>
    Task<IReadOnlyList<FormerClientSummary>> ListFormerAsync(CancellationToken cancellationToken);
}

public sealed record ClientSummary(
    Guid Id,
    string FirstName,
    string LastName,
    string Email,
    string? PhoneNumber,
    ClientOnboardingStatus OnboardingStatus,
    bool IsCoachBlocked,
    uint Version,
    Guid AssignedCoachUserId,
    string AssignedCoachName);

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
    Guid AssignedCoachUserId,
    string AssignedCoachName,
    ClientReleaseView? Release = null);

/// <summary>When, why and by whom a client was released. Present only on a former client.</summary>
public sealed record ClientReleaseView(
    DateTimeOffset ReleasedAtUtc,
    string Reason,
    Guid? ReleasedByUserId,
    string ReleasedByName);

/// <summary>One row of the owner's "Former clients" list.</summary>
public sealed record FormerClientSummary(
    Guid Id,
    string FirstName,
    string LastName,
    string Email,
    DateTimeOffset ReleasedAtUtc,
    string Reason);

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
    uint Version);

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

public sealed record ClientCoachAssignmentView(
    Guid Id,
    int Sequence,
    Guid CoachUserId,
    string CoachName,
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
