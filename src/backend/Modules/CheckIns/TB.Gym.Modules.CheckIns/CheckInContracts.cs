using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.CheckIns;

public interface ICheckInApplicationService
{
    Task<CheckInFormPage> ListFormsAsync(int skip, int take, CancellationToken cancellationToken);

    Task<CheckInFormDetails?> GetFormAsync(Guid formId, CancellationToken cancellationToken);

    Task<CheckInFormVersionView?> GetVersionAsync(
        Guid formId,
        Guid versionId,
        CancellationToken cancellationToken);

    Task<CheckInFormCommandResult> CreateFormAsync(
        CreateCheckInFormRequest request,
        CancellationToken cancellationToken);

    Task<CheckInFormCommandResult> RenameFormAsync(
        Guid formId,
        RenameCheckInFormRequest request,
        CancellationToken cancellationToken);

    Task<CheckInFormCommandResult> ArchiveFormAsync(
        Guid formId,
        CheckInConcurrencyRequest request,
        CancellationToken cancellationToken);

    Task<CheckInFormCommandResult> RestoreFormAsync(
        Guid formId,
        CheckInConcurrencyRequest request,
        CancellationToken cancellationToken);

    Task<CheckInVersionCommandResult> SaveDraftAsync(
        Guid formId,
        Guid versionId,
        SaveCheckInDraftRequest request,
        CancellationToken cancellationToken);

    Task<CheckInVersionCommandResult> DeriveDraftAsync(
        Guid formId,
        DeriveCheckInDraftRequest request,
        CancellationToken cancellationToken);

    Task<CheckInVersionCommandResult> PublishVersionAsync(
        Guid formId,
        Guid versionId,
        CheckInConcurrencyRequest request,
        CancellationToken cancellationToken);

    Task<CheckInAssignmentCommandResult> AssignAsync(
        Guid clientProfileId,
        AssignCheckInRequest request,
        CancellationToken cancellationToken);

    Task<CheckInAssignmentListResult> ListClientAssignmentsAsync(
        Guid clientProfileId,
        int skip,
        int take,
        CancellationToken cancellationToken);

    Task<CheckInAssignmentDetailResult> GetClientAssignmentAsync(
        Guid clientProfileId,
        Guid assignmentId,
        CancellationToken cancellationToken);

    Task<CheckInAssignmentListResult> ListOwnAssignmentsAsync(
        int skip,
        int take,
        CancellationToken cancellationToken);

    Task<CheckInAssignmentDetailResult> GetOwnAssignmentAsync(
        Guid assignmentId,
        CancellationToken cancellationToken);
}

public sealed record CheckInQuestionRequest(
    CheckInQuestionType QuestionType,
    string Prompt,
    bool IsRequired,
    string? QuestionKey = null,
    string? HelpText = null,
    decimal? ScaleMinimum = null,
    decimal? ScaleMaximum = null,
    decimal? ScaleStep = null,
    IReadOnlyList<string>? Options = null);

public sealed record CreateCheckInFormRequest(
    string Title,
    string? Description,
    IReadOnlyList<CheckInQuestionRequest> Questions);

public sealed record RenameCheckInFormRequest(string Title, string? Description, uint Version);

public sealed record CheckInConcurrencyRequest(uint Version);

public sealed record SaveCheckInDraftRequest(
    IReadOnlyList<CheckInQuestionRequest> Questions,
    uint Version);

/// <summary>
/// Derives the lineage's next draft from an existing published version. The form's own concurrency
/// token is checked because deriving a draft advances the lineage's version counter.
/// </summary>
public sealed record DeriveCheckInDraftRequest(Guid SourceVersionId, uint FormVersion);

public sealed record AssignCheckInRequest(Guid FormVersionId, DateOnly DueDate);

public sealed record CheckInQuestionOptionView(Guid Id, int Order, string Label);

public sealed record CheckInQuestionView(
    Guid Id,
    string QuestionKey,
    int Order,
    CheckInQuestionType QuestionType,
    string Prompt,
    string? HelpText,
    bool IsRequired,
    decimal? ScaleMinimum,
    decimal? ScaleMaximum,
    decimal? ScaleStep,
    IReadOnlyList<CheckInQuestionOptionView> Options);

public sealed record CheckInFormVersionView(
    Guid Id,
    Guid FormId,
    string FormTitle,
    string? FormDescription,
    int VersionNumber,
    CheckInFormVersionStatus Status,
    Guid? DerivedFromVersionId,
    DateTimeOffset? PublishedAtUtc,
    Guid? PublishedByUserId,
    IReadOnlyList<CheckInQuestionView> Questions,
    uint Version);

public sealed record CheckInFormVersionSummary(
    Guid Id,
    int VersionNumber,
    CheckInFormVersionStatus Status,
    Guid? DerivedFromVersionId,
    DateTimeOffset? PublishedAtUtc,
    Guid? PublishedByUserId,
    int QuestionCount,
    uint Version);

public sealed record CheckInFormSummary(
    Guid Id,
    string Title,
    string? Description,
    CheckInFormStatus Status,
    bool IsArchived,
    int CurrentVersionNumber,
    Guid? DraftVersionId,
    Guid? LatestPublishedVersionId,
    int? LatestPublishedVersionNumber,
    uint Version);

public sealed record CheckInFormPage(long Total, IReadOnlyList<CheckInFormSummary> Items);

public sealed record CheckInFormDetails(
    CheckInFormSummary Form,
    IReadOnlyList<CheckInFormVersionSummary> Versions);

public sealed record CheckInAssignmentView(
    Guid Id,
    Guid FormId,
    string FormTitle,
    Guid FormVersionId,
    int FormVersionNumber,
    Guid ClientProfileId,
    DateOnly DueDate,
    DateTimeOffset AssignedAtUtc,
    Guid? AssignedByUserId);

/// <summary>
/// The minimum a list needs to state what happened to an assignment, and nothing more.
/// </summary>
/// <remarks>
/// Deliberately carries no answer, no text and no concurrency token. A coach's list is built from
/// this, so an unsubmitted draft contributes its status and its dates and nothing a client typed;
/// reading a response's content is a separate, separately authorized request for one assignment.
/// </remarks>
public sealed record CheckInAssignmentResponseSummary(
    Guid ResponseId,
    CheckInResponseStatus Status,
    DateOnly? SubmittedDate,
    DateTimeOffset? SubmittedAtUtc,
    DateTimeOffset? ReviewedAtUtc,
    bool IsLate);

/// <summary>
/// One row of an assignment list: the assignment, and the state of its response if one exists.
/// </summary>
/// <remarks>
/// The status travels with the list so a caller does not have to fetch every response in full just
/// to render a badge. A null <see cref="Response"/> means the client has not started; there is no
/// empty draft row waiting for them.
/// </remarks>
public sealed record CheckInAssignmentListItem(
    CheckInAssignmentView Assignment,
    CheckInAssignmentResponseSummary? Response);

/// <summary>
/// A bounded page of one client's assignments. <see cref="Total"/> is the whole count so a caller
/// can say how many were not returned rather than presenting a page as the entire history.
/// </summary>
public sealed record CheckInAssignmentListView(
    Guid ClientProfileId,
    long Total,
    IReadOnlyList<CheckInAssignmentListItem> Items);

public static class CheckInAssignmentListLimits
{
    public const int DefaultPageSize = 50;
    public const int MaximumPageSize = 200;
}

/// <summary>
/// One assignment together with the exact version content the client was asked. The version is
/// resolved from the assignment, never from the form's latest publication.
/// </summary>
public sealed record CheckInAssignmentDetail(
    CheckInAssignmentView Assignment,
    CheckInFormVersionView Version);

public enum CheckInCommandStatus
{
    Success = 1,
    NotFound = 2,
    Invalid = 3,
    Conflict = 4,
    Forbidden = 5,
}

public sealed record CheckInFormCommandResult(
    CheckInCommandStatus Status,
    CheckInFormDetails? Form = null,
    IReadOnlyDictionary<string, string[]>? Errors = null,
    string? Code = null,
    string? Message = null);

public sealed record CheckInVersionCommandResult(
    CheckInCommandStatus Status,
    CheckInFormVersionView? Version = null,
    IReadOnlyDictionary<string, string[]>? Errors = null,
    string? Code = null,
    string? Message = null);

public sealed record CheckInAssignmentCommandResult(
    CheckInCommandStatus Status,
    CheckInAssignmentDetail? Assignment = null,
    IReadOnlyDictionary<string, string[]>? Errors = null,
    string? Code = null,
    string? Message = null,
    FeatureAccessReason? AccessReason = null);

public sealed record CheckInAssignmentListResult(
    CheckInCommandStatus Status,
    CheckInAssignmentListView? Assignments = null,
    FeatureAccessReason? AccessReason = null);

public sealed record CheckInAssignmentDetailResult(
    CheckInCommandStatus Status,
    CheckInAssignmentDetail? Assignment = null,
    FeatureAccessReason? AccessReason = null);
