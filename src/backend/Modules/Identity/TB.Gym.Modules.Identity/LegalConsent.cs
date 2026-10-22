using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Identity;

/// <summary>
/// One version of a legal document (CLI-010): its text and the sentence beside the box a person ticks,
/// both exactly as the platform admin entered them from a qualified review, and the SHA-256 of the text,
/// which the database checks against the text itself. TB Gym writes none of the words. A version is read
/// at <see cref="ContentUri"/>; once created its words never change (a database trigger), and a new
/// version replaces it by retiring it.
/// </summary>
public sealed class LegalDocumentVersion : AuditableEntity
{
    public const int MaximumVersionLength = 40;
    public const int MaximumStatementLength = 300;
    public const int MaximumContentLength = 200_000;

    /// <summary>
    /// The languages a document is published in: English, which TB Gym ships (ADR 0003). Each language's
    /// version is published and replaced on its own, so a second language would let a translation lag behind
    /// its English and still count; Arabic waits for versions that carry every language at once.
    /// </summary>
    public static readonly IReadOnlyList<string> Languages = ["en"];

    private static readonly UTF8Encoding StrictUtf8 = new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);

    private LegalDocumentVersion()
    {
    }

    private LegalDocumentVersion(
        LegalDocumentKind kind,
        string version,
        string culture,
        LegalConsentContext context,
        string content,
        string acceptanceStatement)
    {
        if (!Enum.IsDefined(kind) || !Enum.IsDefined(context))
        {
            throw new ArgumentException("Legal document kind and context are required.");
        }

        Kind = kind;
        VersionLabel = NormalizeLine(version, MaximumVersionLength, "Give the version a name", nameof(version));
        Culture = NormalizeLanguage(culture);
        Context = context;
        Content = NormalizeContent(content);
        AcceptanceStatement = NormalizeLine(
            acceptanceStatement,
            MaximumStatementLength,
            "Enter the sentence people tick to accept",
            nameof(acceptanceStatement));
        ContentSha256 = HashOf(Content);
        ContentUri = $"/legal/{Id:D}";
        ReviewStatus = LegalReviewStatus.RequiresProfessionalReview;
    }

    public LegalDocumentKind Kind { get; private set; }

    public string VersionLabel { get; private set; } = string.Empty;

    public string Culture { get; private set; } = string.Empty;

    public LegalConsentContext Context { get; private set; }

    /// <summary>The app's own page that shows this version, <c>/legal/{id}</c>.</summary>
    public string ContentUri { get; private set; } = string.Empty;

    public string ContentSha256 { get; private set; } = string.Empty;

    /// <summary>The whole text, line endings made <c>\n</c> and the ends trimmed, and nothing else changed.</summary>
    public string Content { get; private set; } = string.Empty;

    /// <summary>The sentence beside the box a person ticks to accept this version, in the reviewer's words.</summary>
    public string AcceptanceStatement { get; private set; } = string.Empty;

    public LegalReviewStatus ReviewStatus { get; private set; }

    public DateTimeOffset? PublishedAtUtc { get; private set; }

    public DateTimeOffset? RetiredAtUtc { get; private set; }

    /// <summary>Published and not replaced: the version people are asked to accept now.</summary>
    public bool IsCurrent => PublishedAtUtc is not null && RetiredAtUtc is null;

    public static LegalDocumentVersion CreateDraft(
        LegalDocumentKind kind,
        string version,
        string culture,
        LegalConsentContext context,
        string content,
        string acceptanceStatement) =>
        new(kind, version, culture, context, content, acceptanceStatement);

    /// <summary>
    /// The platform admin's one step: text a qualified reviewer approved, published as it is. Saying the
    /// review happened is the admin's own statement at publishing; nothing unreviewed becomes accepted.
    /// </summary>
    public static LegalDocumentVersion PublishReviewed(
        LegalDocumentKind kind,
        string version,
        string culture,
        LegalConsentContext context,
        string content,
        string acceptanceStatement,
        DateTimeOffset now)
    {
        var document = CreateDraft(kind, version, culture, context, content, acceptanceStatement);
        document.ApproveAndPublish(now);
        return document;
    }

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

    /// <summary>
    /// The text as it is stored and hashed: Windows and old Mac line endings become <c>\n</c> and the
    /// whitespace around the whole is trimmed, so the same text pasted twice hashes the same.
    /// </summary>
    public static string NormalizeContent(string? content)
    {
        var normalized = (content ?? string.Empty)
            .Replace("\r\n", "\n", StringComparison.Ordinal)
            .Replace('\r', '\n')
            .Trim();
        if (normalized.Length == 0)
        {
            throw new ArgumentException("Paste the document's text.", nameof(content));
        }

        if (normalized.Length > MaximumContentLength)
        {
            throw new ArgumentException(
                string.Create(CultureInfo.InvariantCulture, $"The text can be at most {MaximumContentLength:N0} characters."),
                nameof(content));
        }

        try
        {
            StrictUtf8.GetByteCount(normalized);
        }
        catch (EncoderFallbackException exception)
        {
            throw new ArgumentException("The text holds a character that cannot be stored.", nameof(content), exception);
        }

        return normalized;
    }

    /// <summary>The lower-case hex SHA-256 of the text's UTF-8 bytes, as PostgreSQL's own check works it out.</summary>
    public static string HashOf(string normalizedContent) =>
        Convert.ToHexStringLower(SHA256.HashData(StrictUtf8.GetBytes(normalizedContent)));

    private static string NormalizeLanguage(string? culture)
    {
        string name;
        try
        {
            name = CultureInfo.GetCultureInfo((culture ?? string.Empty).Trim()).Name;
        }
        catch (CultureNotFoundException exception)
        {
            throw new ArgumentException("Only English can be published for now.", nameof(culture), exception);
        }

        return Languages.Contains(name, StringComparer.Ordinal)
            ? name
            : throw new ArgumentException("Only English can be published for now.", nameof(culture));
    }

    private static string NormalizeLine(string? value, int maxLength, string missing, string parameterName)
    {
        var normalized = (value ?? string.Empty).Trim();
        if (normalized.Length == 0)
        {
            throw new ArgumentException($"{missing}.", parameterName);
        }

        if (normalized.Contains('\n') || normalized.Contains('\r'))
        {
            throw new ArgumentException("Write it on one line.", parameterName);
        }

        return normalized.Length <= maxLength
            ? normalized
            : throw new ArgumentException(
                string.Create(CultureInfo.InvariantCulture, $"Use {maxLength} characters or fewer."),
                parameterName);
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
        ContextKey = KeyFor(tenantId);
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

    /// <summary><c>platform</c>, or the workspace's id: acceptance in one workspace never stands for another.</summary>
    public static string KeyFor(Guid? tenantId) => tenantId?.ToString("N") ?? "platform";
}

/// <summary>Who joins: a new owner registering their coaching space, a coach joining a team, or a client.</summary>
public enum LegalAudience
{
    Owner = 1,
    Coach = 2,
    Client = 3,
}

/// <summary>What the acceptance rule reads of a version in force: never its text.</summary>
public sealed record CurrentLegalDocument(
    Guid Id,
    LegalDocumentKind Kind,
    LegalConsentContext Context,
    string Culture);

/// <summary>
/// What a person must accept to join (CLI-010): one current version of each document kind and context
/// that applies to them. Terms of Service and the Privacy Policy apply to everyone; the health intake
/// consent to clients, whose health their coach reads. A platform document is accepted once per person;
/// a workspace document once per coaching space joined.
/// </summary>
public static class LegalAcceptanceRule
{
    public static bool AppliesTo(LegalDocumentKind kind, LegalAudience audience) => kind switch
    {
        LegalDocumentKind.TermsOfService or LegalDocumentKind.PrivacyPolicy => true,
        LegalDocumentKind.HealthIntakeConsent => audience == LegalAudience.Client,
        _ => false,
    };

    /// <summary>
    /// The documents to show: per kind and context that applies, the current version in the reader's
    /// language when there is one, else the first by language. Groups already accepted are left out.
    /// </summary>
    public static IReadOnlyList<CurrentLegalDocument> ToShow(
        IEnumerable<CurrentLegalDocument> current,
        LegalAudience audience,
        IReadOnlySet<Guid> alreadyAccepted,
        string language = "en") =>
        Groups(current, audience)
            .Where(group => !group.Any(document => alreadyAccepted.Contains(document.Id)))
            .Select(group => group
                .OrderBy(document => document.Culture == language ? 0 : 1)
                .ThenBy(document => document.Culture, StringComparer.Ordinal)
                .First())
            .ToArray();

    /// <summary>
    /// Whether what a person named, with what they accepted before, covers every group that applies;
    /// and if so the versions to record. Every named id must be a current version of a group that
    /// applies: a replaced or unknown one means the page is out of date, so nothing is recorded.
    /// </summary>
    public static IReadOnlyList<CurrentLegalDocument>? Check(
        IEnumerable<CurrentLegalDocument> current,
        LegalAudience audience,
        IReadOnlySet<Guid> alreadyAccepted,
        IReadOnlyCollection<Guid>? named)
    {
        var groups = Groups(current, audience);
        var applicable = groups.SelectMany(group => group).ToDictionary(document => document.Id);
        var ids = (named ?? []).Distinct().ToArray();
        if (ids.Any(id => !applicable.ContainsKey(id)))
        {
            return null;
        }

        var covered = groups.All(group => group.Any(document =>
            alreadyAccepted.Contains(document.Id) || ids.Contains(document.Id)));
        return covered
            ? ids.Where(id => !alreadyAccepted.Contains(id)).Select(id => applicable[id]).ToArray()
            : null;
    }

    private static IGrouping<(LegalDocumentKind Kind, LegalConsentContext Context), CurrentLegalDocument>[] Groups(
        IEnumerable<CurrentLegalDocument> current,
        LegalAudience audience) =>
        current
            .Where(document => AppliesTo(document.Kind, audience))
            .GroupBy(document => (document.Kind, document.Context))
            .OrderBy(group => group.Key.Kind)
            .ThenBy(group => group.Key.Context)
            .ToArray();
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
