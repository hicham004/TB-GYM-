using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.CheckIns;

/// <summary>
/// One client's answers to one assignment. There is exactly one response per assignment and it moves
/// Draft to Submitted to Reviewed, one way. The response never copies the questions it answers: the
/// assignment names a published version, 6A-1 froze that version, so the original wording is read back
/// from those rows rather than snapshotted here.
/// </summary>
public sealed class CheckInResponse : TenantEntity
{
    private readonly List<CheckInAnswer> answers = [];

    private CheckInResponse()
    {
    }

    private CheckInResponse(CheckInAssignment assignment)
        : base(assignment.TenantId)
    {
        AssignmentId = assignment.Id;
        FormVersionId = assignment.FormVersionId;
        ClientProfileId = assignment.ClientProfileId;
        Status = CheckInResponseStatus.Draft;
    }

    public Guid AssignmentId { get; private set; }

    /// <summary>
    /// Copied from the assignment so an answer can be tied to a question of that exact version by
    /// foreign key. It is the version's identity, never its content.
    /// </summary>
    public Guid FormVersionId { get; private set; }

    public Guid ClientProfileId { get; private set; }

    public CheckInResponseStatus Status { get; private set; }

    public DateTimeOffset? SubmittedAtUtc { get; private set; }

    /// <summary>
    /// The workspace-local date the response was submitted on. Stored rather than derived from
    /// <see cref="SubmittedAtUtc"/>, because the workspace time zone can be changed later and that
    /// would silently re-date a submission that already happened.
    /// </summary>
    public DateOnly? SubmittedDate { get; private set; }

    public DateTimeOffset? ReviewedAtUtc { get; private set; }

    public Guid? ReviewedByUserId { get; private set; }

    public IReadOnlyList<CheckInAnswer> Answers => answers;

    public static CheckInResponse StartDraft(CheckInAssignment assignment)
    {
        ArgumentNullException.ThrowIfNull(assignment);
        return new CheckInResponse(assignment);
    }

    /// <summary>
    /// Replaces the whole draft answer set. A draft is deliberately lenient: it may be partial and it
    /// may hold a number outside the question's range, because a client filling a form in over several
    /// sittings should never lose what they typed. Structure is still enforced — an answer must belong
    /// to a question of the assigned version and a selection must belong to that question — because
    /// those are not opinions a later submission could repair.
    /// </summary>
    public void ReplaceAnswers(
        IReadOnlyList<CheckInAnswerInput> inputs,
        IReadOnlyList<CheckInQuestion> questions)
    {
        ArgumentNullException.ThrowIfNull(inputs);
        ArgumentNullException.ThrowIfNull(questions);
        EnsureDraft();

        var byId = questions.ToDictionary(question => question.Id);
        var seen = new HashSet<Guid>();
        var replacement = new List<CheckInAnswer>(inputs.Count);
        foreach (var input in inputs)
        {
            if (!byId.TryGetValue(input.QuestionId, out var question))
            {
                throw new ArgumentException(
                    "An answer must belong to a question of the assigned version.",
                    nameof(inputs));
            }

            if (!seen.Add(input.QuestionId))
            {
                throw new ArgumentException(
                    "A question may be answered only once in a response.",
                    nameof(inputs));
            }

            replacement.Add(CheckInAnswer.Create(TenantId, Id, FormVersionId, question, input));
        }

        answers.Clear();
        answers.AddRange(replacement);
    }

    /// <summary>
    /// Validates the whole response against the assigned version's definitions and, if it holds,
    /// freezes it. Every failure is collected rather than the first one thrown, so a client is told
    /// everything that is wrong in one pass instead of discovering it one field at a time.
    /// </summary>
    public CheckInSubmissionResult Submit(
        IReadOnlyList<CheckInQuestion> questions,
        DateTimeOffset submittedAtUtc,
        DateOnly workspaceToday,
        Guid actorUserId)
    {
        ArgumentNullException.ThrowIfNull(questions);
        if (Status != CheckInResponseStatus.Draft)
        {
            throw new InvalidOperationException(
                "This check-in has already been submitted. A submission cannot be repeated.");
        }

        if (actorUserId == Guid.Empty)
        {
            throw new ArgumentException("Submitting requires the acting user.", nameof(actorUserId));
        }

        var failures = CheckInSubmissionValidator.Validate(questions, answers);
        if (failures.Count > 0)
        {
            return CheckInSubmissionResult.Rejected(failures);
        }

        Status = CheckInResponseStatus.Submitted;
        SubmittedAtUtc = submittedAtUtc;
        SubmittedDate = workspaceToday;
        return CheckInSubmissionResult.Accepted(
            CheckInResponseEvent.Submitted(this, submittedAtUtc, actorUserId));
    }

    /// <summary>
    /// Marks a submitted response as read by the coach. Review is a state change and an append-only
    /// record; it never touches an answer, and re-reviewing is refused rather than ignored.
    /// </summary>
    public CheckInResponseEvent Review(DateTimeOffset reviewedAtUtc, Guid reviewerUserId)
    {
        if (Status == CheckInResponseStatus.Draft)
        {
            throw new InvalidOperationException("A check-in that has not been submitted cannot be reviewed.");
        }

        if (Status == CheckInResponseStatus.Reviewed)
        {
            throw new InvalidOperationException("This check-in has already been reviewed.");
        }

        if (reviewerUserId == Guid.Empty)
        {
            throw new ArgumentException("Reviewing requires the acting user.", nameof(reviewerUserId));
        }

        Status = CheckInResponseStatus.Reviewed;
        ReviewedAtUtc = reviewedAtUtc;
        ReviewedByUserId = reviewerUserId;
        return CheckInResponseEvent.Reviewed(this, reviewedAtUtc, reviewerUserId);
    }

    /// <summary>
    /// Lateness is a recorded fact and nothing more: the workspace-local submission date against the
    /// date the check-in was due. It carries no rating, score or consequence.
    /// </summary>
    public bool IsLate(DateOnly dueDate) => SubmittedDate is { } submitted && submitted > dueDate;

    private void EnsureDraft()
    {
        if (Status != CheckInResponseStatus.Draft)
        {
            throw new InvalidOperationException(
                "A submitted check-in is frozen. Its answers can no longer be changed.");
        }
    }
}

/// <summary>
/// One answer to one question, in typed columns rather than a JSON blob, so the database can refuse a
/// selection that does not belong to the question and a query can read a number as a number.
/// </summary>
public sealed class CheckInAnswer : TenantEntity
{
    private readonly List<CheckInAnswerChoice> choices = [];

    private CheckInAnswer()
    {
    }

    private CheckInAnswer(
        Guid tenantId,
        Guid responseId,
        Guid formVersionId,
        CheckInQuestion question,
        CheckInAnswerInput input)
        : base(tenantId)
    {
        ResponseId = responseId;
        FormVersionId = formVersionId;
        QuestionId = question.Id;
        QuestionType = question.QuestionType;
        ApplyValue(question, input);
    }

    public Guid ResponseId { get; private set; }

    /// <summary>
    /// The version this answer's question must belong to. It is the response's own version, carried so
    /// the foreign key can reach <c>CheckInQuestions (TenantId, FormVersionId, Id, QuestionType)</c>:
    /// answering a question from a different version of the lineage is then not representable.
    /// </summary>
    public Guid FormVersionId { get; private set; }

    public Guid QuestionId { get; private set; }

    /// <summary>
    /// The answered question's type, carried so a composite foreign key can force it to match the
    /// question's own type and a check constraint can tie it to the column that may be populated.
    /// It is a discriminator, not a copy of the question.
    /// </summary>
    public CheckInQuestionType QuestionType { get; private set; }

    public string? TextValue { get; private set; }

    public decimal? NumericValue { get; private set; }

    public IReadOnlyList<CheckInAnswerChoice> Choices => choices;

    internal static CheckInAnswer Create(
        Guid tenantId,
        Guid responseId,
        Guid formVersionId,
        CheckInQuestion question,
        CheckInAnswerInput input) =>
        new(tenantId, responseId, formVersionId, question, input);

    private void ApplyValue(CheckInQuestion question, CheckInAnswerInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        switch (question.QuestionType)
        {
            case CheckInQuestionType.ShortText:
            case CheckInQuestionType.LongText:
                RejectUnusable(input.NumericValue is not null || input.SelectedOptionIds.Count > 0);
                TextValue = CheckInAnswerText.Optional(
                    input.TextValue,
                    question.QuestionType == CheckInQuestionType.ShortText
                        ? CheckInAnswerLimits.ShortTextLength
                        : CheckInAnswerLimits.LongTextLength);
                break;

            case CheckInQuestionType.SingleChoice:
            case CheckInQuestionType.MultipleChoice:
                RejectUnusable(input.NumericValue is not null || input.TextValue is not null);
                SetChoices(question, input.SelectedOptionIds);
                break;

            case CheckInQuestionType.NumericScale:
                RejectUnusable(input.TextValue is not null || input.SelectedOptionIds.Count > 0);

                // Deliberately not range-checked here. A draft may hold a number the scale does not
                // allow; submission is where the whole response is measured against its definitions.
                NumericValue = input.NumericValue;
                break;

            default:
                throw new ArgumentOutOfRangeException(nameof(question), "A supported question type is required.");
        }
    }

    private void SetChoices(CheckInQuestion question, IReadOnlyList<Guid> selectedOptionIds)
    {
        var known = question.Options.Select(option => option.Id).ToHashSet();
        var seen = new HashSet<Guid>();
        foreach (var optionId in selectedOptionIds)
        {
            if (!known.Contains(optionId))
            {
                throw new ArgumentException(
                    "A selected option must belong to the question it answers.",
                    nameof(selectedOptionIds));
            }

            if (!seen.Add(optionId))
            {
                throw new ArgumentException(
                    "An option may be selected only once.",
                    nameof(selectedOptionIds));
            }

            choices.Add(CheckInAnswerChoice.Create(TenantId, Id, question.Id, optionId));
        }
    }

    private static void RejectUnusable(bool unusable)
    {
        if (unusable)
        {
            throw new ArgumentException("An answer carries only the value its question type accepts.");
        }
    }
}

/// <summary>
/// One selected option. It carries the owning question so the foreign key can reach
/// <c>CheckInQuestionOptions (TenantId, QuestionId, Id)</c>: an option from another version belongs to
/// another question, so the database refuses it without any code path having to remember to check.
/// </summary>
public sealed class CheckInAnswerChoice : TenantEntity
{
    private CheckInAnswerChoice()
    {
    }

    private CheckInAnswerChoice(Guid tenantId, Guid answerId, Guid questionId, Guid questionOptionId)
        : base(tenantId)
    {
        AnswerId = answerId;
        QuestionId = questionId;
        QuestionOptionId = questionOptionId;
    }

    public Guid AnswerId { get; private set; }

    public Guid QuestionId { get; private set; }

    public Guid QuestionOptionId { get; private set; }

    internal static CheckInAnswerChoice Create(
        Guid tenantId,
        Guid answerId,
        Guid questionId,
        Guid questionOptionId) =>
        new(tenantId, answerId, questionId, questionOptionId);
}

/// <summary>
/// Append-only record of the two moments in a response's life that cannot be undone. Separate from
/// <see cref="CheckInLifecycleEvent"/>, which records what happened to a form: these carry a response
/// and never a version, and collapsing the two would mean a nullable column for every field either
/// shape needs.
/// </summary>
public sealed class CheckInResponseEvent : TenantEntity
{
    private CheckInResponseEvent()
    {
    }

    private CheckInResponseEvent(
        Guid tenantId,
        CheckInResponseEventType eventType,
        Guid responseId,
        Guid assignmentId,
        Guid clientProfileId,
        DateTimeOffset occurredAtUtc,
        Guid actorUserId)
        : base(tenantId)
    {
        if (actorUserId == Guid.Empty)
        {
            throw new ArgumentException("A response event requires the acting user.", nameof(actorUserId));
        }

        EventType = eventType;
        ResponseId = responseId;
        AssignmentId = assignmentId;
        ClientProfileId = clientProfileId;
        OccurredAtUtc = occurredAtUtc;
        ActorUserId = actorUserId;
    }

    public CheckInResponseEventType EventType { get; private set; }

    public Guid ResponseId { get; private set; }

    public Guid AssignmentId { get; private set; }

    public Guid ClientProfileId { get; private set; }

    public DateTimeOffset OccurredAtUtc { get; private set; }

    public Guid ActorUserId { get; private set; }

    internal static CheckInResponseEvent Submitted(
        CheckInResponse response,
        DateTimeOffset occurredAtUtc,
        Guid actorUserId) =>
        new(
            response.TenantId,
            CheckInResponseEventType.ResponseSubmitted,
            response.Id,
            response.AssignmentId,
            response.ClientProfileId,
            occurredAtUtc,
            actorUserId);

    internal static CheckInResponseEvent Reviewed(
        CheckInResponse response,
        DateTimeOffset occurredAtUtc,
        Guid actorUserId) =>
        new(
            response.TenantId,
            CheckInResponseEventType.ResponseReviewed,
            response.Id,
            response.AssignmentId,
            response.ClientProfileId,
            occurredAtUtc,
            actorUserId);
}

/// <summary>
/// The whole response measured against the assigned version's definitions in one pass. Every rule the
/// draft was allowed to break is checked here, and all failures are returned together.
/// </summary>
public static class CheckInSubmissionValidator
{
    public static IReadOnlyList<CheckInSubmissionFailure> Validate(
        IReadOnlyList<CheckInQuestion> questions,
        IReadOnlyList<CheckInAnswer> answers)
    {
        ArgumentNullException.ThrowIfNull(questions);
        ArgumentNullException.ThrowIfNull(answers);

        var failures = new List<CheckInSubmissionFailure>();
        var byQuestion = answers.ToDictionary(answer => answer.QuestionId);
        foreach (var question in questions.OrderBy(question => question.Order))
        {
            if (!byQuestion.TryGetValue(question.Id, out var answer) || IsEmpty(answer))
            {
                if (question.IsRequired)
                {
                    failures.Add(new CheckInSubmissionFailure(
                        question.QuestionKey,
                        CheckInSubmissionFailureCode.RequiredAnswerMissing,
                        "This question has to be answered."));
                }

                continue;
            }

            switch (question.QuestionType)
            {
                case CheckInQuestionType.NumericScale:
                    ValidateNumeric(question, answer, failures);
                    break;

                case CheckInQuestionType.SingleChoice:
                    ValidateChoices(question, answer, failures);
                    if (answer.Choices.Count > 1)
                    {
                        failures.Add(new CheckInSubmissionFailure(
                            question.QuestionKey,
                            CheckInSubmissionFailureCode.SingleChoiceRequiresExactlyOne,
                            "This question takes exactly one answer."));
                    }

                    break;

                case CheckInQuestionType.MultipleChoice:
                    ValidateChoices(question, answer, failures);
                    break;

                case CheckInQuestionType.ShortText:
                case CheckInQuestionType.LongText:
                default:
                    break;
            }
        }

        return failures;
    }

    private static void ValidateNumeric(
        CheckInQuestion question,
        CheckInAnswer answer,
        List<CheckInSubmissionFailure> failures)
    {
        if (answer.NumericValue is not { } value ||
            question.ScaleMinimum is not { } minimum ||
            question.ScaleMaximum is not { } maximum ||
            question.ScaleStep is not { } step)
        {
            return;
        }

        if (value < minimum || value > maximum)
        {
            failures.Add(new CheckInSubmissionFailure(
                question.QuestionKey,
                CheckInSubmissionFailureCode.NumericOutOfRange,
                $"Answer between {minimum} and {maximum}."));
            return;
        }

        // Exact decimal arithmetic, the same check the scale was authored under.
        if ((value - minimum) % step != 0m)
        {
            failures.Add(new CheckInSubmissionFailure(
                question.QuestionKey,
                CheckInSubmissionFailureCode.NumericOffStep,
                $"Answer in steps of {step} from {minimum}."));
        }
    }

    private static void ValidateChoices(
        CheckInQuestion question,
        CheckInAnswer answer,
        List<CheckInSubmissionFailure> failures)
    {
        var known = question.Options.Select(option => option.Id).ToHashSet();
        if (answer.Choices.Any(choice => !known.Contains(choice.QuestionOptionId)))
        {
            failures.Add(new CheckInSubmissionFailure(
                question.QuestionKey,
                CheckInSubmissionFailureCode.ChoiceNotOnQuestion,
                "A selected option does not belong to this question."));
        }
    }

    private static bool IsEmpty(CheckInAnswer answer) => answer.QuestionType switch
    {
        CheckInQuestionType.ShortText or CheckInQuestionType.LongText =>
            string.IsNullOrWhiteSpace(answer.TextValue),
        CheckInQuestionType.SingleChoice or CheckInQuestionType.MultipleChoice =>
            answer.Choices.Count == 0,
        CheckInQuestionType.NumericScale => answer.NumericValue is null,
        _ => true,
    };
}

/// <summary>
/// The authored content of one answer. A null value on every field is how a client clears a question
/// they had previously answered in a draft.
/// </summary>
public sealed record CheckInAnswerInput(
    Guid QuestionId,
    string? TextValue,
    decimal? NumericValue,
    IReadOnlyList<Guid> SelectedOptionIds);

public sealed record CheckInSubmissionFailure(
    string QuestionKey,
    CheckInSubmissionFailureCode Code,
    string Message);

/// <summary>
/// The outcome of a submission attempt: either the response is frozen and the append-only record
/// exists, or nothing changed and every reason is listed.
/// </summary>
public sealed record CheckInSubmissionResult(
    bool IsAccepted,
    CheckInResponseEvent? Event,
    IReadOnlyList<CheckInSubmissionFailure> Failures)
{
    internal static CheckInSubmissionResult Accepted(CheckInResponseEvent submitted) =>
        new(true, submitted, []);

    internal static CheckInSubmissionResult Rejected(IReadOnlyList<CheckInSubmissionFailure> failures) =>
        new(false, null, failures);
}

public static class CheckInAnswerLimits
{
    public const int ShortTextLength = 500;
    public const int LongTextLength = 4_000;
}

public enum CheckInResponseStatus
{
    Draft = 1,
    Submitted = 2,
    Reviewed = 3,
}

public enum CheckInResponseEventType
{
    ResponseSubmitted = 1,
    ResponseReviewed = 2,
}

public enum CheckInSubmissionFailureCode
{
    RequiredAnswerMissing = 1,
    NumericOutOfRange = 2,
    NumericOffStep = 3,
    ChoiceNotOnQuestion = 4,
    SingleChoiceRequiresExactlyOne = 5,
}

internal static class CheckInAnswerText
{
    public static string? Optional(string? value, int maximumLength)
    {
        var normalized = (value ?? string.Empty).Trim();
        return normalized.Length switch
        {
            0 => null,
            var length when length <= maximumLength => normalized,
            _ => throw new ArgumentException(
                $"An answer cannot exceed {maximumLength} characters.",
                nameof(value)),
        };
    }
}
