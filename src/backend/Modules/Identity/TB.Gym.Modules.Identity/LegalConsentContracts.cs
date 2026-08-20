namespace TB.Gym.Modules.Identity;

public interface ILegalConsentApplicationService
{
    Task<IReadOnlyList<LegalDocumentView>> ListCurrentAsync(
        Guid? workspaceId,
        CancellationToken cancellationToken);

    Task<LegalConsentCommandResult> AcceptAsync(
        AcceptLegalDocumentRequest request,
        CancellationToken cancellationToken);
}

public sealed record LegalDocumentView(
    Guid Id,
    LegalDocumentKind Kind,
    string Version,
    string Culture,
    LegalConsentContext Context,
    string ContentUri,
    string ContentSha256,
    DateTimeOffset PublishedAtUtc,
    bool IsAccepted);

public sealed record AcceptLegalDocumentRequest(Guid DocumentVersionId, Guid? TenantId);

public sealed record LegalConsentAcceptanceView(
    Guid Id,
    Guid DocumentVersionId,
    LegalConsentContext Context,
    Guid? TenantId,
    DateTimeOffset AcceptedAtUtc);

public sealed record LegalConsentCommandResult(
    LegalConsentCommandStatus Status,
    LegalConsentAcceptanceView? Acceptance = null,
    string? Message = null);

public enum LegalConsentCommandStatus
{
    Success = 1,
    NotFound = 2,
    Invalid = 3,
    Forbidden = 4,
}
