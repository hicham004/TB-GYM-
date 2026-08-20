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
}

public sealed record ClientSummary(
    Guid Id,
    string FirstName,
    string LastName,
    string Email,
    string? PhoneNumber,
    ClientOnboardingStatus OnboardingStatus,
    bool IsCoachBlocked,
    uint Version);

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
    uint Version);

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
