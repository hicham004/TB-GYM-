namespace TB.Gym.Modules.Identity;

public interface ILegalConsentApplicationService
{
    Task<IReadOnlyList<LegalDocumentView>> ListCurrentAsync(
        Guid? workspaceId,
        CancellationToken cancellationToken);

    Task<LegalConsentCommandResult> AcceptAsync(
        AcceptLegalDocumentRequest request,
        CancellationToken cancellationToken);

    /// <summary>
    /// What a person joining as <paramref name="audience"/> is asked to accept: one current version per
    /// document and context that applies to them, leaving out platform documents a signed-in caller has
    /// already accepted. Anyone may ask; the documents are public.
    /// </summary>
    Task<IReadOnlyList<LegalDocumentToAccept>> ListToAcceptAsync(
        LegalAudience audience,
        CancellationToken cancellationToken);

    /// <summary>A published version with its text, current or replaced; null for anything else.</summary>
    Task<LegalDocumentText?> GetPublishedAsync(Guid documentVersionId, CancellationToken cancellationToken);
}

/// <summary>
/// The platform admin's legal documents (CLI-010): every version, publishing a reviewed one, and
/// withdrawing one so nobody is asked for it any more.
/// </summary>
public interface ILegalDocumentAdminService
{
    Task<IReadOnlyList<LegalDocumentAdminView>> ListAsync(CancellationToken cancellationToken);

    Task<LegalDocumentCommandResult> PublishAsync(
        PublishLegalDocumentRequest request,
        CancellationToken cancellationToken);

    /// <summary>
    /// Retires a version in force without a replacement, for one published by mistake: nobody joining is
    /// asked for it from then on, those who accepted it keep their acceptance, and it stays readable.
    /// </summary>
    Task<LegalDocumentCommandResult> WithdrawAsync(Guid documentVersionId, CancellationToken cancellationToken);
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

/// <summary>One document a person ticks to join: the sentence beside the box and where to read it.</summary>
public sealed record LegalDocumentToAccept(
    Guid Id,
    LegalDocumentKind Kind,
    string Version,
    string Culture,
    LegalConsentContext Context,
    string AcceptanceStatement,
    string ContentUri,
    DateTimeOffset PublishedAtUtc);

/// <summary>A published version as anyone reads it.</summary>
public sealed record LegalDocumentText(
    Guid Id,
    LegalDocumentKind Kind,
    string Version,
    string Culture,
    LegalConsentContext Context,
    string Content,
    string AcceptanceStatement,
    string ContentSha256,
    DateTimeOffset PublishedAtUtc,
    DateTimeOffset? RetiredAtUtc);

/// <summary>A version as the platform admin lists it, with how many acceptances name it.</summary>
public sealed record LegalDocumentAdminView(
    Guid Id,
    LegalDocumentKind Kind,
    string Version,
    string Culture,
    LegalConsentContext Context,
    string AcceptanceStatement,
    string ContentUri,
    string ContentSha256,
    int CharacterCount,
    DateTimeOffset? PublishedAtUtc,
    DateTimeOffset? RetiredAtUtc,
    int AcceptanceCount);

/// <summary>
/// Publishes reviewed text at once. <see cref="Reviewed"/> is the admin's statement that a qualified
/// reviewer approved this exact text and sentence; <see cref="ReplacesVersionId"/> is the version in
/// force the admin saw (null when none), so a version published meanwhile is never replaced unseen.
/// The same version name with the same words answers with the version already published.
/// </summary>
public sealed record PublishLegalDocumentRequest(
    LegalDocumentKind Kind,
    string Culture,
    LegalConsentContext Context,
    string Version,
    string Content,
    string AcceptanceStatement,
    bool Reviewed,
    Guid? ReplacesVersionId);

public sealed record LegalDocumentCommandResult(
    LegalConsentCommandStatus Status,
    LegalDocumentAdminView? Document = null,
    IReadOnlyDictionary<string, string[]>? Errors = null,
    string? ConflictCode = null,
    string? ConflictMessage = null);

/// <summary>
/// The codes the platform admin's legal routes answer with. Registration and an invitation's acceptance answer
/// <c>legal_acceptance_required</c> from their own modules, which do not reference this one.
/// </summary>
public static class LegalConsentCodes
{
    public const string VersionTaken = "legal_version_taken";

    public const string DocumentChanged = "legal_document_changed";
}

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
    Conflict = 5,
}
