using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.CheckIns;

/// <summary>
/// A check-in form lineage. The form owns identity, title and status; the questions live on its
/// versions, because a version is the unit of truth. Editing published content therefore derives a
/// new draft version rather than mutating the one clients were already asked to answer.
/// </summary>
public sealed class CheckInForm : TenantEntity
{
    private CheckInForm()
    {
    }

    private CheckInForm(Guid tenantId, string title, string? description)
        : base(tenantId)
    {
        Title = CheckInText.Required(title, 160, nameof(title));
        Description = CheckInText.Optional(description, 2_000);
        Status = CheckInFormStatus.Draft;
    }

    public string Title { get; private set; } = string.Empty;

    public string? Description { get; private set; }

    /// <summary>
    /// Draft until the lineage's first version is published, and Published from then on. Archiving is
    /// a separate reversible flag so restoring a form never has to guess which of the two it was.
    /// </summary>
    public CheckInFormStatus Status { get; private set; }

    public bool IsArchived { get; private set; }

    public int CurrentVersionNumber { get; private set; }

    public static CheckInForm Create(Guid tenantId, string title, string? description) =>
        new(tenantId, title, description);

    public void Rename(string title, string? description)
    {
        EnsureNotArchived();
        Title = CheckInText.Required(title, 160, nameof(title));
        Description = CheckInText.Optional(description, 2_000);
    }

    /// <summary>
    /// Reserves the next version number for a new draft. The lineage owns the counter so two drafts
    /// can never claim the same number, and the database enforces that with a unique index.
    /// </summary>
    public int StartNextVersion()
    {
        EnsureNotArchived();
        CurrentVersionNumber = checked(CurrentVersionNumber + 1);
        return CurrentVersionNumber;
    }

    /// <summary>
    /// Records that the lineage now has published content. Publishing a second version does not move
    /// the form backwards, so this is deliberately idempotent.
    /// </summary>
    public void MarkPublished()
    {
        EnsureNotArchived();
        Status = CheckInFormStatus.Published;
    }

    public void Archive()
    {
        if (IsArchived)
        {
            throw new InvalidOperationException("The check-in form is already archived.");
        }

        IsArchived = true;
    }

    public void Restore()
    {
        if (!IsArchived)
        {
            throw new InvalidOperationException("The check-in form is not archived.");
        }

        IsArchived = false;
    }

    private void EnsureNotArchived()
    {
        if (IsArchived)
        {
            throw new InvalidOperationException("An archived check-in form cannot be edited or published.");
        }
    }
}

/// <summary>
/// One version of a form lineage and the unit of truth for its questions. A draft can be edited
/// freely; publishing freezes it permanently, in the domain and at the database, because an
/// assignment resolves the exact wording and options a client was asked.
/// </summary>
public sealed class CheckInFormVersion : TenantEntity
{
    private readonly List<CheckInQuestion> questions = [];

    private CheckInFormVersion()
    {
    }

    private CheckInFormVersion(
        Guid tenantId,
        Guid formId,
        int versionNumber,
        Guid? derivedFromVersionId,
        IReadOnlyList<CheckInQuestionInput> inputs)
        : base(tenantId)
    {
        if (formId == Guid.Empty || versionNumber < 1)
        {
            throw new ArgumentException("A check-in form version requires a form and a version number.");
        }

        FormId = formId;
        VersionNumber = versionNumber;
        DerivedFromVersionId = derivedFromVersionId;
        Status = CheckInFormVersionStatus.Draft;
        IsDraft = true;
        SetQuestions(inputs);
    }

    public Guid FormId { get; private set; }

    public int VersionNumber { get; private set; }

    public CheckInFormVersionStatus Status { get; private set; }

    /// <summary>
    /// The predicate behind the partial unique index that allows at most one open draft per lineage.
    /// It is redundant with <see cref="Status"/> on purpose and a check constraint keeps the two from
    /// drifting, the same shape the bodyweight active-observation index uses.
    /// </summary>
    public bool IsDraft { get; private set; }

    /// <summary>
    /// The published version this draft was derived from, or null for the lineage's first draft. It
    /// records provenance only; the derived draft is an independent version from creation onward.
    /// </summary>
    public Guid? DerivedFromVersionId { get; private set; }

    public DateTimeOffset? PublishedAtUtc { get; private set; }

    public Guid? PublishedByUserId { get; private set; }

    public IReadOnlyList<CheckInQuestion> Questions => questions;

    public static CheckInFormVersion CreateDraft(
        Guid tenantId,
        Guid formId,
        int versionNumber,
        Guid? derivedFromVersionId,
        IReadOnlyList<CheckInQuestionInput> inputs) =>
        new(tenantId, formId, versionNumber, derivedFromVersionId, inputs);

    /// <summary>
    /// Replaces a draft's whole question set. Editing a draft is a wholesale replacement rather than
    /// a per-question patch, so the ordering and the question keys are always resolved together.
    /// </summary>
    public void ReplaceQuestions(IReadOnlyList<CheckInQuestionInput> inputs)
    {
        EnsureDraft();
        questions.Clear();
        SetQuestions(inputs);
    }

    /// <summary>
    /// Freezes this version permanently and returns the append-only record of who did it and when.
    /// Publishing is one-way: a second publish is refused rather than silently ignored.
    /// </summary>
    public CheckInLifecycleEvent Publish(DateTimeOffset publishedAtUtc, Guid publishedByUserId)
    {
        EnsureDraft();
        if (publishedByUserId == Guid.Empty)
        {
            throw new ArgumentException("Publishing requires the acting user.", nameof(publishedByUserId));
        }

        Status = CheckInFormVersionStatus.Published;
        IsDraft = false;
        PublishedAtUtc = publishedAtUtc;
        PublishedByUserId = publishedByUserId;
        return CheckInLifecycleEvent.VersionPublished(this, publishedAtUtc, publishedByUserId);
    }

    /// <summary>
    /// Projects this version's questions as inputs for the next draft, carrying every
    /// <see cref="CheckInQuestion.QuestionKey"/> forward unchanged so a question keeps its identity
    /// across the lineage even when its wording changes.
    /// </summary>
    public IReadOnlyList<CheckInQuestionInput> ToCarryForwardInputs() =>
        [.. questions.OrderBy(question => question.Order).Select(question => new CheckInQuestionInput(
            question.QuestionKey,
            question.QuestionType,
            question.Prompt,
            question.HelpText,
            question.IsRequired,
            question.ScaleMinimum,
            question.ScaleMaximum,
            question.ScaleStep,
            [.. question.Options.OrderBy(option => option.Order).Select(option => option.Label)]))];

    private void EnsureDraft()
    {
        if (Status != CheckInFormVersionStatus.Draft)
        {
            throw new InvalidOperationException(
                "A published check-in form version is immutable. Derive a new draft version instead.");
        }
    }

    private void SetQuestions(IReadOnlyList<CheckInQuestionInput> inputs)
    {
        ArgumentNullException.ThrowIfNull(inputs);
        if (inputs.Count is 0 or > CheckInFormLimits.MaximumQuestions)
        {
            throw new ArgumentException(
                $"A check-in form version requires 1 to {CheckInFormLimits.MaximumQuestions} questions.",
                nameof(inputs));
        }

        var keys = new HashSet<string>(StringComparer.Ordinal);
        for (var index = 0; index < inputs.Count; index++)
        {
            var question = CheckInQuestion.Create(TenantId, Id, index + 1, inputs[index]);
            if (!keys.Add(question.QuestionKey))
            {
                throw new ArgumentException(
                    "A question key may appear only once in a version.",
                    nameof(inputs));
            }

            questions.Add(question);
        }
    }
}

/// <summary>
/// One question inside a version. <see cref="QuestionKey"/> is the stable identity that survives
/// re-wording and re-ordering across versions of the same lineage; the row id does not, because every
/// version owns its own rows.
/// </summary>
public sealed class CheckInQuestion : TenantEntity
{
    private readonly List<CheckInQuestionOption> options = [];

    private CheckInQuestion()
    {
    }

    private CheckInQuestion(Guid tenantId, Guid formVersionId, int order, CheckInQuestionInput input)
        : base(tenantId)
    {
        ArgumentNullException.ThrowIfNull(input);
        if (!Enum.IsDefined(input.QuestionType))
        {
            throw new ArgumentOutOfRangeException(nameof(input), "A supported question type is required.");
        }

        FormVersionId = formVersionId;
        Order = order;
        QuestionKey = input.QuestionKey is null
            ? GenerateQuestionKey()
            : NormalizeQuestionKey(input.QuestionKey);
        QuestionType = input.QuestionType;
        Prompt = CheckInText.Required(input.Prompt, 500, nameof(input.Prompt));
        HelpText = CheckInText.Optional(input.HelpText, 1_000);
        IsRequired = input.IsRequired;
        ApplyTypeSpecificContent(input);
    }

    public Guid FormVersionId { get; private set; }

    /// <summary>
    /// A 32-character lowercase hex identity generated once, on first authoring, and copied into every
    /// later version of the same lineage.
    /// </summary>
    public string QuestionKey { get; private set; } = string.Empty;

    public int Order { get; private set; }

    public CheckInQuestionType QuestionType { get; private set; }

    public string Prompt { get; private set; } = string.Empty;

    public string? HelpText { get; private set; }

    public bool IsRequired { get; private set; }

    public decimal? ScaleMinimum { get; private set; }

    public decimal? ScaleMaximum { get; private set; }

    public decimal? ScaleStep { get; private set; }

    public IReadOnlyList<CheckInQuestionOption> Options => options;

    public static string GenerateQuestionKey() => Guid.CreateVersion7().ToString("N");

    public static bool IsQuestionKey(string? value) =>
        value is { Length: 32 } && value.All(character =>
            character is >= '0' and <= '9' or >= 'a' and <= 'f');

    internal static CheckInQuestion Create(
        Guid tenantId,
        Guid formVersionId,
        int order,
        CheckInQuestionInput input) =>
        new(tenantId, formVersionId, order, input);

    private static string NormalizeQuestionKey(string value)
    {
        var normalized = value.Trim().ToLowerInvariant();
        return IsQuestionKey(normalized)
            ? normalized
            : throw new ArgumentException(
                "A question key must be 32 hexadecimal characters.",
                nameof(value));
    }

    private void ApplyTypeSpecificContent(CheckInQuestionInput input)
    {
        switch (input.QuestionType)
        {
            case CheckInQuestionType.ShortText:
            case CheckInQuestionType.LongText:
                if (input.Options.Count > 0 ||
                    input.ScaleMinimum is not null ||
                    input.ScaleMaximum is not null ||
                    input.ScaleStep is not null)
                {
                    throw new ArgumentException(
                        "A text question carries neither options nor a numeric scale.",
                        nameof(input));
                }

                break;

            case CheckInQuestionType.SingleChoice:
            case CheckInQuestionType.MultipleChoice:
                if (input.ScaleMinimum is not null ||
                    input.ScaleMaximum is not null ||
                    input.ScaleStep is not null)
                {
                    throw new ArgumentException(
                        "A choice question does not carry a numeric scale.",
                        nameof(input));
                }

                SetOptions(input.Options);
                break;

            case CheckInQuestionType.NumericScale:
                if (input.Options.Count > 0)
                {
                    throw new ArgumentException(
                        "A numeric scale does not carry options.",
                        nameof(input));
                }

                var scale = CheckInNumericScale.Validate(input.ScaleMinimum, input.ScaleMaximum, input.ScaleStep);
                ScaleMinimum = scale.Minimum;
                ScaleMaximum = scale.Maximum;
                ScaleStep = scale.Step;
                break;

            default:
                throw new ArgumentOutOfRangeException(nameof(input), "A supported question type is required.");
        }
    }

    private void SetOptions(IReadOnlyList<string> labels)
    {
        if (labels.Count is < CheckInFormLimits.MinimumOptions or > CheckInFormLimits.MaximumOptions)
        {
            throw new ArgumentException(
                $"A choice question requires {CheckInFormLimits.MinimumOptions} to {CheckInFormLimits.MaximumOptions} options.",
                nameof(labels));
        }

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (var index = 0; index < labels.Count; index++)
        {
            var option = CheckInQuestionOption.Create(TenantId, Id, index + 1, labels[index]);
            if (!seen.Add(option.Label))
            {
                throw new ArgumentException("Choice options must be distinct.", nameof(labels));
            }

            options.Add(option);
        }
    }
}

/// <summary>
/// One ordered choice belonging to a single- or multiple-choice question.
/// </summary>
public sealed class CheckInQuestionOption : TenantEntity
{
    private CheckInQuestionOption()
    {
    }

    private CheckInQuestionOption(Guid tenantId, Guid questionId, int order, string label)
        : base(tenantId)
    {
        QuestionId = questionId;
        Order = order;
        Label = CheckInText.Required(label, 200, nameof(label));
    }

    public Guid QuestionId { get; private set; }

    public int Order { get; private set; }

    public string Label { get; private set; } = string.Empty;

    internal static CheckInQuestionOption Create(Guid tenantId, Guid questionId, int order, string label) =>
        new(tenantId, questionId, order, label);
}

/// <summary>
/// The authored content of one question, independent of which version it lands in. A null
/// <see cref="QuestionKey"/> means "this question is new", so a key is generated for it.
/// </summary>
public sealed record CheckInQuestionInput(
    string? QuestionKey,
    CheckInQuestionType QuestionType,
    string Prompt,
    string? HelpText,
    bool IsRequired,
    decimal? ScaleMinimum,
    decimal? ScaleMaximum,
    decimal? ScaleStep,
    IReadOnlyList<string> Options);

/// <summary>
/// The v1 numeric scale rule. A scale that cannot be stepped from its minimum onto its maximum is
/// rejected outright rather than silently truncated, because the client would be shown positions the
/// coach never chose.
/// </summary>
public static class CheckInNumericScale
{
    public static (decimal Minimum, decimal Maximum, decimal Step) Validate(
        decimal? minimum,
        decimal? maximum,
        decimal? step)
    {
        if (minimum is not { } min || maximum is not { } max || step is not { } increment)
        {
            throw new ArgumentException("A numeric scale requires a minimum, a maximum and a step.");
        }

        if (min < CheckInFormLimits.MinimumScaleValue || max > CheckInFormLimits.MaximumScaleValue)
        {
            throw new ArgumentOutOfRangeException(
                nameof(minimum),
                $"A numeric scale must stay between {CheckInFormLimits.MinimumScaleValue} and {CheckInFormLimits.MaximumScaleValue}.");
        }

        if (min >= max)
        {
            throw new ArgumentException("A numeric scale minimum must be below its maximum.", nameof(minimum));
        }

        if (increment <= 0m)
        {
            throw new ArgumentOutOfRangeException(nameof(step), "A numeric scale step must be positive.");
        }

        var range = max - min;
        if (range % increment != 0m)
        {
            throw new ArgumentException(
                "A numeric scale step must divide the range between its minimum and maximum exactly.",
                nameof(step));
        }

        if (range / increment > CheckInFormLimits.MaximumScalePositions)
        {
            throw new ArgumentOutOfRangeException(
                nameof(step),
                $"A numeric scale may not have more than {CheckInFormLimits.MaximumScalePositions} steps.");
        }

        return (min, max, increment);
    }
}

public static class CheckInFormLimits
{
    public const int MaximumQuestions = 100;
    public const int MinimumOptions = 2;
    public const int MaximumOptions = 30;
    public const int MaximumScalePositions = 100;
    public const decimal MinimumScaleValue = -1_000_000m;
    public const decimal MaximumScaleValue = 1_000_000m;
}

public enum CheckInFormStatus
{
    Draft = 1,
    Published = 2,
}

public enum CheckInFormVersionStatus
{
    Draft = 1,
    Published = 2,
}

public enum CheckInQuestionType
{
    ShortText = 1,
    LongText = 2,
    SingleChoice = 3,
    MultipleChoice = 4,
    NumericScale = 5,
}

internal static class CheckInText
{
    public static string Required(string value, int maximumLength, string parameterName)
    {
        var normalized = (value ?? string.Empty).Trim();
        return normalized.Length > 0 && normalized.Length <= maximumLength
            ? normalized
            : throw new ArgumentException(
                $"A value between 1 and {maximumLength} characters is required.",
                parameterName);
    }

    public static string? Optional(string? value, int maximumLength)
    {
        var normalized = (value ?? string.Empty).Trim();
        return normalized.Length switch
        {
            0 => null,
            var length when length <= maximumLength => normalized,
            _ => throw new ArgumentException($"The value cannot exceed {maximumLength} characters.", nameof(value)),
        };
    }
}

public sealed class CheckInsModule : IModuleMarker
{
    public const string Name = "CheckIns";
}
