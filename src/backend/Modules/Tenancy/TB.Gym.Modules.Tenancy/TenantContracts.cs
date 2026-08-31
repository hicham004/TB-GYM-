using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Tenancy;

public interface ITenantMembershipStore
{
    Task<IReadOnlyList<TenantMembershipSummary>> ListForUserAsync(Guid userId, CancellationToken cancellationToken);

    Task<TenantMembership?> FindActiveAsync(Guid tenantId, Guid userId, CancellationToken cancellationToken);
}

public interface IWorkspaceApplicationService
{
    Task<WorkspaceRegistrationResult> RegisterCoachAsync(
        RegisterCoachRequest request,
        CancellationToken cancellationToken);

    Task<WorkspaceDetails?> GetCurrentAsync(CancellationToken cancellationToken);

    Task<WorkspaceUpdateResult> UpdateCurrentAsync(
        UpdateWorkspaceRequest request,
        CancellationToken cancellationToken);
}

public sealed record TenantMembershipSummary(
    Guid TenantId,
    string TenantName,
    string TenantSlug,
    TenantRole Role);

public sealed record RegisterCoachRequest(
    string DisplayName,
    string Email,
    string Password,
    string WorkspaceName,
    string TimeZoneId = "Asia/Beirut",
    string DefaultCulture = "en-LB",
    string DefaultCurrencyCode = "USD",
    DayOfWeek WeekStartsOn = DayOfWeek.Monday);

public sealed record WorkspaceRegistrationResult(
    WorkspaceRegistrationStatus Status,
    string Email,
    string? DevelopmentConfirmationUrl = null,
    IReadOnlyDictionary<string, string[]>? Errors = null);

public sealed record CoachRegistrationResponse(string Email, string? DevelopmentConfirmationUrl);

public enum WorkspaceRegistrationStatus
{
    Created = 1,
    EmailAlreadyRegistered = 2,
    Invalid = 3,
    Conflict = 4,
}

/// <summary>
/// The workspace's settings, including the calendar date it currently is there.
/// </summary>
/// <remarks>
/// <paramref name="CurrentDate"/> is the workspace-local today, resolved on the server from
/// <c>IClock</c> through <paramref name="TimeZoneId"/>. It is carried here because every date rule
/// in the product is decided in the workspace frame and the browser's own calendar is not that
/// frame: a coach in Beirut just after midnight has a UTC date that is still yesterday, so a client
/// computing "today" locally would refuse a due date the server accepts, or offer one it refuses.
/// The server remains authoritative; this exists so the form agrees with it instead of guessing.
/// </remarks>
public sealed record WorkspaceDetails(
    Guid Id,
    string Name,
    string Slug,
    string TimeZoneId,
    string DefaultCulture,
    string DefaultCurrencyCode,
    DayOfWeek WeekStartsOn,
    DateOnly CurrentDate,
    uint Version);

public sealed record UpdateWorkspaceRequest(
    string Name,
    string TimeZoneId,
    string DefaultCulture,
    string DefaultCurrencyCode,
    DayOfWeek WeekStartsOn,
    uint Version);

public sealed record WorkspaceUpdateResult(
    WorkspaceUpdateStatus Status,
    WorkspaceDetails? Workspace = null,
    IReadOnlyDictionary<string, string[]>? Errors = null);

public enum WorkspaceUpdateStatus
{
    Updated = 1,
    NotFound = 2,
    Invalid = 3,
    Conflict = 4,
}

public sealed class TenancyModule : IModuleMarker
{
    public const string Name = "Tenancy";
}
