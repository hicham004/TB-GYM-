using System.Globalization;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Identity;

public sealed class LegalDocumentVersion : AuditableEntity
{
    private LegalDocumentVersion()
    {
    }

    private LegalDocumentVersion(
        LegalDocumentKind kind,
        string version,
        string culture,
        LegalConsentContext context,
        string contentUri,
        string contentSha256)
    {
        if (!Enum.IsDefined(kind) || !Enum.IsDefined(context))
        {
            throw new ArgumentException("Legal document kind and context are required.");
        }

        Kind = kind;
        VersionLabel = Normalize(version, 40, nameof(version));
        Culture = CultureInfo.GetCultureInfo(Normalize(culture, 20, nameof(culture))).Name;
        Context = context;
        ContentUri = Normalize(contentUri, 1_000, nameof(contentUri));
        ContentSha256 = NormalizeHash(contentSha256);
        ReviewStatus = LegalReviewStatus.RequiresProfessionalReview;
    }

    public LegalDocumentKind Kind { get; private set; }

    public string VersionLabel { get; private set; } = string.Empty;

    public string Culture { get; private set; } = string.Empty;

    public LegalConsentContext Context { get; private set; }

    public string ContentUri { get; private set; } = string.Empty;

    public string ContentSha256 { get; private set; } = string.Empty;

    public LegalReviewStatus ReviewStatus { get; private set; }

    public DateTimeOffset? PublishedAtUtc { get; private set; }

    public DateTimeOffset? RetiredAtUtc { get; private set; }

    public static LegalDocumentVersion CreateDraft(
        LegalDocumentKind kind,
        string version,
        string culture,
        LegalConsentContext context,
        string contentUri,
        string contentSha256) =>
        new(kind, version, culture, context, contentUri, contentSha256);

    public void ApproveAndPublish(DateTimeOffset now)
    {
        if (PublishedAtUtc is not null || RetiredAtUtc is not null)
        {
            throw new InvalidOperationException("Only a current draft can be published.");
        }

        ReviewStatus = LegalReviewStatus.Approved;
        PublishedAtUtc = now;
    }

    public void Retire(DateTimeOffset now)
    {
        if (PublishedAtUtc is null || RetiredAtUtc is not null)
        {
            throw new InvalidOperationException("Only a current published document can be retired.");
        }

        RetiredAtUtc = now;
    }

    private static string Normalize(string value, int maxLength, string parameterName)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(value);
        var normalized = value.Trim();
        return normalized.Length <= maxLength
            ? normalized
            : throw new ArgumentException($"The value cannot exceed {maxLength} characters.", parameterName);
    }

    private static string NormalizeHash(string hash)
    {
        var normalized = Normalize(hash, 64, nameof(hash)).ToLowerInvariant();
        if (normalized.Length != 64 || normalized.Any(character => !Uri.IsHexDigit(character)))
        {
            throw new ArgumentException("Legal document content requires a SHA-256 hash.", nameof(hash));
        }

        return normalized;
    }
}

public sealed class LegalConsentAcceptance : AuditableEntity
{
    private LegalConsentAcceptance()
    {
    }

    private LegalConsentAcceptance(
        Guid userId,
        Guid documentVersionId,
        LegalConsentContext context,
        Guid? tenantId,
        DateTimeOffset acceptedAtUtc)
    {
        if (userId == Guid.Empty || documentVersionId == Guid.Empty)
        {
            throw new ArgumentException("User and document version ids are required.");
        }

        if ((context == LegalConsentContext.Workspace) != tenantId.HasValue)
        {
            throw new ArgumentException("Workspace consent requires exactly one workspace context.");
        }

        UserId = userId;
        DocumentVersionId = documentVersionId;
        Context = context;
        TenantId = tenantId;
        ContextKey = tenantId?.ToString("N") ?? "platform";
        AcceptedAtUtc = acceptedAtUtc;
    }

    public Guid UserId { get; private set; }

    public Guid DocumentVersionId { get; private set; }

    public LegalConsentContext Context { get; private set; }

    public Guid? TenantId { get; private set; }

    public string ContextKey { get; private set; } = string.Empty;

    public DateTimeOffset AcceptedAtUtc { get; private set; }

    public static LegalConsentAcceptance Accept(
        Guid userId,
        Guid documentVersionId,
        LegalConsentContext context,
        Guid? tenantId,
        DateTimeOffset acceptedAtUtc) =>
        new(userId, documentVersionId, context, tenantId, acceptedAtUtc);
}

public enum LegalDocumentKind
{
    TermsOfService = 1,
    PrivacyPolicy = 2,
    HealthIntakeConsent = 3,
}

public enum LegalConsentContext
{
    Platform = 1,
    Workspace = 2,
}

public enum LegalReviewStatus
{
    RequiresProfessionalReview = 1,
    Approved = 2,
}
