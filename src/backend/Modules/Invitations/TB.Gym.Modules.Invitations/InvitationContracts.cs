using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Invitations;

public interface IInvitationDelivery
{
    Task<InvitationDeliveryResult> SendAsync(
        InvitationDeliveryRequest request,
        CancellationToken cancellationToken);
}

public sealed record InvitationDeliveryRequest(
    Guid InvitationId,
    Guid TenantId,
    string WorkspaceName,
    string Recipient,
    string Token,
    int AttemptNumber);

public sealed record InvitationDeliveryResult(
    InvitationDeliveryStatus Status,
    string? ProviderMessageId = null,
    string? DevelopmentActionUrl = null);

public interface IInvitationApplicationService
{
    Task<IReadOnlyList<InvitationSummary>> ListAsync(CancellationToken cancellationToken);

    Task<InvitationCommandResult> CreateAsync(
        CreateClientInvitationRequest request,
        CancellationToken cancellationToken);

    Task<InvitationCommandResult> ResendAsync(Guid invitationId, CancellationToken cancellationToken);

    Task<InvitationCommandResult> RevokeAsync(Guid invitationId, CancellationToken cancellationToken);

    Task<PublicInvitationDetails?> GetPublicAsync(string token, CancellationToken cancellationToken);

    Task<InvitationAcceptanceResult> AcceptAsync(
        AcceptClientInvitationRequest request,
        CancellationToken cancellationToken);
}

public sealed record CreateClientInvitationRequest(
    string Email,
    string FirstName,
    string LastName,
    string? PhoneNumber,
    DateOnly? BirthDate);

public sealed record AcceptClientInvitationRequest(
    string Token,
    string? DisplayName,
    string? Password);

public sealed record InvitationSummary(
    Guid Id,
    string Email,
    string FirstName,
    string LastName,
    InvitationStatus Status,
    DateTimeOffset ExpiresAtUtc,
    int SendCount,
    DateTimeOffset CreatedAtUtc,
    string? DevelopmentActionUrl = null);

public sealed record PublicInvitationDetails(
    string WorkspaceName,
    string Email,
    string FirstName,
    string LastName,
    InvitationStatus Status,
    DateTimeOffset ExpiresAtUtc,
    bool RequiresExistingAccountSignIn);

public sealed record InvitationCommandResult(
    InvitationCommandStatus Status,
    InvitationSummary? Invitation = null,
    IReadOnlyDictionary<string, string[]>? Errors = null);

public enum InvitationCommandStatus
{
    Success = 1,
    NotFound = 2,
    Invalid = 3,
    Conflict = 4,
}

public sealed record InvitationAcceptanceResult(
    InvitationAcceptanceStatus Status,
    Guid? TenantId = null,
    Guid? ClientProfileId = null,
    bool SignedIn = false,
    IReadOnlyDictionary<string, string[]>? Errors = null);

public sealed record InvitationAcceptanceResponse(
    Guid TenantId,
    Guid ClientProfileId,
    bool SignedIn);

public enum InvitationAcceptanceStatus
{
    Accepted = 1,
    ExistingAccountSignInRequired = 2,
    WrongSignedInAccount = 3,
    InvalidOrExpired = 4,
    Revoked = 5,
    Invalid = 6,
    Conflict = 7,
}

public sealed class InvitationsModule : IModuleMarker
{
    public const string Name = "Invitations";
}
