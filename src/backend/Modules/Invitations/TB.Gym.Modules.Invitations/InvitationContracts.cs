using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Invitations;

public interface IInvitationApplicationService
{
    Task<IReadOnlyList<InvitationSummary>> ListAsync(CancellationToken cancellationToken);

    Task<InvitationCommandResult> CreateAsync(
        CreateClientInvitationRequest request,
        CancellationToken cancellationToken);

    Task<InvitationCommandResult> ResendAsync(
        Guid invitationId,
        ResendClientInvitationRequest request,
        CancellationToken cancellationToken);

    Task<InvitationCommandResult> RevokeAsync(
        Guid invitationId,
        RevokeClientInvitationRequest request,
        CancellationToken cancellationToken);

    Task<PublicInvitationDetails?> GetPublicAsync(string token, CancellationToken cancellationToken);

    Task<InvitationAcceptanceResult> AcceptAsync(
        AcceptClientInvitationRequest request,
        CancellationToken cancellationToken);
}

/// <summary>
/// The narrow, Invitations-owned contract by which a materializing dispatcher learns whether one
/// logical send is still authorized, and where it goes.
/// </summary>
/// <remarks>
/// It exists so the action-mail dispatcher never re-derives invitation eligibility itself and never
/// reads another module's tables to find an address. The invitee may not be a member of the workspace
/// — that is what an invitation is for — so membership is precisely the wrong authorization here; the
/// invitation aggregate is the authority, and this contract is its answer.
/// <para>
/// It is deliberately re-evaluated immediately before a token is minted. A committed claim is a lease
/// on work, never durable permission to mail somebody a credential: an invitation revoked, accepted,
/// expired, retargeted or superseded by a deliberate resend in the meantime must stop the send.
/// </para>
/// </remarks>
public interface IInvitationMailAuthorization
{
    Task<InvitationMailAuthorization> AuthorizeAsync(
        Guid tenantId,
        Guid invitationId,
        int logicalSendGeneration,
        CancellationToken cancellationToken);
}

/// <summary>
/// The answer: either an authorized send with its current recipient and expiry, or a stable
/// suppression code and nothing else.
/// </summary>
/// <remarks>
/// The address is returned for use in memory during one materialization and is never persisted by the
/// caller. When <see cref="IsAuthorized"/> is false, no address is returned at all.
/// </remarks>
public sealed record InvitationMailAuthorization(
    bool IsAuthorized,
    string? SuppressionCode = null,
    string? RecipientAddress = null,
    DateTimeOffset? ExpiresAtUtc = null)
{
    public static InvitationMailAuthorization Allowed(string recipientAddress, DateTimeOffset expiresAtUtc) =>
        new(true, null, recipientAddress, expiresAtUtc);

    public static InvitationMailAuthorization Refused(string suppressionCode) =>
        new(false, suppressionCode);
}

/// <summary>Drains due invitation action-mail requests.</summary>
public interface IInvitationActionMailDispatchService
{
    Task<InvitationActionMailDispatchOutcome> DispatchDueAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Materializes one specific request, now, if it is still claimable. The development capture path
    /// and the tests use it; it runs the same sequence a sweep does.
    /// </summary>
    Task<InvitationActionMailDispatchOutcome> DispatchRequestAsync(
        Guid tenantId,
        Guid requestId,
        CancellationToken cancellationToken);
}

public sealed record InvitationActionMailDispatchOutcome(
    int Claimed = 0,
    int Materialized = 0,
    int Suppressed = 0,
    int Retried = 0,
    int DeadLettered = 0,
    int Reclaimed = 0)
{
    public int Total => Materialized + Suppressed + Retried + DeadLettered + Reclaimed;

    public InvitationActionMailDispatchOutcome Add(InvitationActionMailDispatchOutcome other) =>
        new(
            Claimed + other.Claimed,
            Materialized + other.Materialized,
            Suppressed + other.Suppressed,
            Retried + other.Retried,
            DeadLettered + other.DeadLettered,
            Reclaimed + other.Reclaimed);
}

/// <summary>The stable source codes an invitation action-mail request may record.</summary>
public static class InvitationActionMailSources
{
    /// <summary>The first send, created with the invitation itself.</summary>
    public const string Creation = "invitation-created";

    /// <summary>A coach or owner deliberately pressed Resend.</summary>
    public const string DeliberateResend = "invitation-resend";
}

public sealed record CreateClientInvitationRequest(
    string Email,
    string FirstName,
    string LastName,
    string? PhoneNumber,
    DateOnly? BirthDate,
    Guid? IdempotencyKey = null);

/// <summary>
/// A deliberate resend.
/// </summary>
/// <remarks>
/// Both fields are required, and both are security-relevant rather than ergonomic. The key makes two
/// concurrent presses converge on one new generation instead of racing to create two, and the version
/// makes a resend issued against a stale view of the invitation — one that has since been revoked,
/// accepted or already resent — conflict rather than silently kill a link somebody is holding.
/// </remarks>
public sealed record ResendClientInvitationRequest(Guid IdempotencyKey, uint Version);

/// <summary>A revocation, with the same optimistic-concurrency requirement and for the same reason.</summary>
public sealed record RevokeClientInvitationRequest(uint Version);

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
    int LogicalSendGeneration,
    DateTimeOffset CreatedAtUtc,
    uint Version,
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
