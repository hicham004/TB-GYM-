using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.CheckIns;

/// <summary>
/// Answering, submitting, reviewing and comparing. Kept apart from
/// <see cref="ICheckInApplicationService"/> because authoring is workspace content while everything
/// here names a client and therefore evaluates <see cref="CoachingFeature.CheckIns"/> first.
/// </summary>
public interface ICheckInResponseApplicationService
{
    Task<CheckInResponseCommandResult> GetOwnResponseAsync(
        Guid assignmentId,
        CancellationToken cancellationToken);

    Task<CheckInResponseCommandResult> SaveOwnDraftAsync(
        Guid assignmentId,
        SaveCheckInResponseRequest request,
        CancellationToken cancellationToken);

    Task<CheckInResponseCommandResult> SubmitOwnResponseAsync(
        Guid assignmentId,
        CheckInResponseConcurrencyRequest request,
        CancellationToken cancellationToken);

    Task<CheckInResponseCommandResult> GetClientResponseAsync(
        Guid clientProfileId,
        Guid assignmentId,
        CancellationToken cancellationToken);

    Task<CheckInResponseCommandResult> ReviewAsync(
        Guid clientProfileId,
        Guid assignmentId,
        CheckInResponseConcurrencyRequest request,
        CancellationToken cancellationToken);

    Task<CheckInComparisonResult> CompareAsync(
        Guid clientProfileId,
        Guid firstResponseId,
        Guid secondResponseId,
        CancellationToken cancellationToken);
}

public sealed record CheckInAnswerRequest(
    Guid QuestionId,
    string? TextValue = null,
    decimal? NumericValue = null,
    IReadOnlyList<Guid>? SelectedOptionIds = null);

/// <summary>
/// A whole-draft save. <see cref="Version"/> is null on the first save, when the response row does not
/// exist yet; from then on it is the token the client last read.
/// </summary>
public sealed record SaveCheckInResponseRequest(
    IReadOnlyList<CheckInAnswerRequest> Answers,
    uint? Version = null);

public sealed record CheckInResponseConcurrencyRequest(uint Version);

public sealed record CheckInAnswerChoiceView(Guid QuestionOptionId, int Order, string Label);

public sealed record CheckInAnswerView(
    Guid QuestionId,
    string QuestionKey,
    CheckInQuestionType QuestionType,
    string? TextValue,
    decimal? NumericValue,
    IReadOnlyList<CheckInAnswerChoiceView> Choices);

/// <summary>
/// One response as an audience is permitted to see it.
/// </summary>
/// <remarks>
/// <see cref="AnswersWithheld"/> distinguishes "this response has no answers" from "you may not read
/// this response's answers". A coach reading a client's unsubmitted draft receives the second: the
/// row exists, its status says Draft, and <see cref="Answers"/> is empty because the content is
/// still the client's own, not because nothing has been typed. Returning an empty list without
/// saying so would let a coach conclude the client had started and written nothing.
/// </remarks>
public sealed record CheckInResponseView(
    Guid Id,
    Guid AssignmentId,
    Guid ClientProfileId,
    CheckInResponseStatus Status,
    DateTimeOffset? SubmittedAtUtc,
    DateOnly? SubmittedDate,
    bool IsLate,
    DateTimeOffset? ReviewedAtUtc,
    Guid? ReviewedByUserId,
    IReadOnlyList<CheckInAnswerView> Answers,
    uint Version,
    bool AnswersWithheld = false);

/// <summary>
/// The assignment, the exact version it named, and the response so far. A null
/// <see cref="Response"/> means the client has not started: there is no empty draft row until they
/// save one.
/// </summary>
public sealed record CheckInResponseDetail(
    CheckInAssignmentView Assignment,
    CheckInFormVersionView Version,
    CheckInResponseView? Response);

public enum CheckInComparisonPresence
{
    InBoth = 1,
    OnlyInFirst = 2,
    OnlyInSecond = 3,
}

/// <summary>
/// One side's own wording for a question, together with what was answered. Each side carries the
/// prompt from its own version, so a re-worded question shows both wordings rather than one of them
/// standing in for both.
/// </summary>
public sealed record CheckInComparisonCell(
    Guid QuestionId,
    int Order,
    CheckInQuestionType QuestionType,
    string Prompt,
    bool IsRequired,
    CheckInAnswerView? Answer);

/// <summary>
/// One question aligned across the two responses by <c>QuestionKey</c>. A question that exists in only
/// one of the two versions is reported as such and keeps its side's content; it is never dropped and
/// never rendered as an unanswered question on the side that never asked it.
/// </summary>
public sealed record CheckInComparisonRow(
    string QuestionKey,
    CheckInComparisonPresence Presence,
    CheckInComparisonCell? First,
    CheckInComparisonCell? Second);

public sealed record CheckInComparisonSideView(
    Guid ResponseId,
    Guid AssignmentId,
    Guid FormVersionId,
    int FormVersionNumber,
    CheckInResponseStatus Status,
    DateOnly DueDate,
    DateOnly? SubmittedDate,
    DateTimeOffset? SubmittedAtUtc,
    bool IsLate);

/// <summary>
/// A read-side projection over two submitted responses of one lineage. Nothing here is stored and
/// nothing is derived from the answers themselves: it is two sets of answers, side by side.
/// </summary>
public sealed record CheckInComparisonView(
    Guid ClientProfileId,
    Guid FormId,
    string FormTitle,
    CheckInComparisonSideView First,
    CheckInComparisonSideView Second,
    IReadOnlyList<CheckInComparisonRow> Rows);

public sealed record CheckInResponseCommandResult(
    CheckInCommandStatus Status,
    CheckInResponseDetail? Response = null,
    IReadOnlyDictionary<string, string[]>? Errors = null,
    string? Code = null,
    string? Message = null,
    FeatureAccessReason? AccessReason = null,
    IReadOnlyList<CheckInSubmissionFailure>? Failures = null);

public sealed record CheckInComparisonResult(
    CheckInCommandStatus Status,
    CheckInComparisonView? Comparison = null,
    string? Code = null,
    string? Message = null,
    FeatureAccessReason? AccessReason = null);
