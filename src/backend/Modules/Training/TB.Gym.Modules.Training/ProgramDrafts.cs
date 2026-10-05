using System.Text.Json;
using System.Text.Json.Serialization;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Training;

/// <summary>
/// A coach's working copy of a program in the builder (TRN-024, R4.2a): kept on the server as they
/// work, read back on any device, and turned into a version only by Publish.
/// </summary>
/// <remarks>
/// It belongs to one Owner or Coach in one workspace and nobody else reads it, the workspace owner
/// included. Its content is what the builder holds mid-edit, so it may break the program rules (a
/// session with no name, reps of 0); only its shape is bounded (<see cref="ProgramDraftShape"/>).
/// Publishing checks every rule as any save does (TRN-005), creates the next immutable version
/// (TRN-001, ADR 0007) and removes the draft. A draft never reaches a client.
/// </remarks>
public sealed class ProgramDraft : TenantEntity
{
    /// <summary>How many programs not published yet one person keeps in one workspace.</summary>
    public const int MaximumNewProgramsPerOwner = 20;

    private ProgramDraft()
    {
    }

    private ProgramDraft(
        Guid tenantId,
        Guid ownerUserId,
        Guid? templateId,
        Guid? sourceVersionId,
        int startedAtVersionNumber,
        ProgramDraftShape shape)
        : base(tenantId)
    {
        if (ownerUserId == Guid.Empty)
        {
            throw new ArgumentException("A program draft needs its owner.", nameof(ownerUserId));
        }

        if (templateId == Guid.Empty || sourceVersionId == Guid.Empty || templateId is null != sourceVersionId is null)
        {
            throw new ArgumentException("A draft of a saved program names the program and the version it started from.");
        }

        if (templateId is null ? startedAtVersionNumber != 0 : startedAtVersionNumber < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(startedAtVersionNumber));
        }

        OwnerUserId = ownerUserId;
        TemplateId = templateId;
        SourceVersionId = sourceVersionId;
        StartedAtVersionNumber = startedAtVersionNumber;
        Replace(shape);
    }

    public Guid OwnerUserId { get; private set; }

    /// <summary>The program it changes; null for a program not published yet.</summary>
    public Guid? TemplateId { get; private set; }

    /// <summary>The version its content started from; null for a program not published yet.</summary>
    public Guid? SourceVersionId { get; private set; }

    /// <summary>
    /// The program's newest version number when this draft began, 0 for a new program. A higher number
    /// at Publish means someone published in between.
    /// </summary>
    public int StartedAtVersionNumber { get; private set; }

    /// <summary>The program's name as typed, for the programs list; it may be empty.</summary>
    public string Name { get; private set; } = string.Empty;

    public int WeekCount { get; private set; }

    public string ContentJson { get; private set; } = "{}";

    public static ProgramDraft ForNewProgram(Guid tenantId, Guid ownerUserId, ProgramDraftShape shape) =>
        new(tenantId, ownerUserId, null, null, 0, shape);

    public static ProgramDraft ForProgram(
        Guid tenantId,
        Guid ownerUserId,
        Guid templateId,
        Guid sourceVersionId,
        int startedAtVersionNumber,
        ProgramDraftShape shape) =>
        new(tenantId, ownerUserId, templateId, sourceVersionId, startedAtVersionNumber, shape);

    public void Replace(ProgramDraftShape shape)
    {
        ArgumentNullException.ThrowIfNull(shape);
        Name = shape.Name;
        WeekCount = shape.WeekCount;
        ContentJson = shape.Json;
    }

    /// <summary>True when a version was published after this draft began.</summary>
    public bool IsBehind(int currentVersionNumber) =>
        TemplateId is not null && currentVersionNumber != StartedAtVersionNumber;
}

/// <summary>
/// A draft's content once its shape is checked: the limits a version has on how many weeks,
/// sessions, exercises and sets it holds and how long its text is, and nothing about the values
/// themselves, which Publish checks (TRN-024).
/// </summary>
public sealed class ProgramDraftShape
{
    /// <summary>The stored content in characters; a long program takes a few hundred thousand.</summary>
    public const int MaximumContentLength = 2_000_000;

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Converters = { new JsonStringEnumConverter(namingPolicy: null, allowIntegerValues: false) },
    };

    private ProgramDraftShape(string name, int weekCount, string json)
    {
        Name = name;
        WeekCount = weekCount;
        Json = json;
    }

    public string Name { get; }

    public int WeekCount { get; }

    public string Json { get; }

    /// <summary>
    /// Checks the shape and keeps the content in one form: every list present, positions in list
    /// order. Returns the field and the reason when the shape is refused.
    /// </summary>
    public static bool TryCreate(
        ProgramDraftContent? content,
        out ProgramDraftShape shape,
        out string field,
        out string problem)
    {
        shape = new ProgramDraftShape(string.Empty, 0, "{}");
        var (normalized, refusal) = content is null
            ? (null, new Refusal("content", "The program is missing."))
            : Normalize(content);
        if (refusal is null && normalized is not null)
        {
            var json = JsonSerializer.Serialize(normalized, JsonOptions);
            if (json.Length <= MaximumContentLength)
            {
                shape = new ProgramDraftShape(normalized.Name.Trim(), normalized.Weeks.Count, json);
                (field, problem) = (string.Empty, string.Empty);
                return true;
            }

            refusal = new Refusal(
                "content",
                "This program is too long to keep as a draft. Publish it, or split it into two programs.");
        }

        (field, problem) = (refusal!.Field, refusal.Problem);
        return false;
    }

    public static ProgramDraftContent Read(string json) =>
        JsonSerializer.Deserialize<ProgramDraftContent>(json, JsonOptions)
        ?? throw new InvalidOperationException("A stored program draft could not be read.");

    private static (ProgramDraftContent? Content, Refusal? Refusal) Normalize(ProgramDraftContent content)
    {
        var name = content.Name ?? string.Empty;
        if ((Text(name, 160, "name", "A program name") ?? Text(content.Description, 4_000, "description", "A description"))
            is { } textRefusal)
        {
            return (null, textRefusal);
        }

        var weeks = content.Weeks ?? [];
        if (weeks.Count is < 1 or > 52)
        {
            return (null, new Refusal("weeks", "A program has 1 to 52 weeks."));
        }

        var normalWeeks = new List<TrainingWeekRequest>(weeks.Count);
        foreach (var week in weeks)
        {
            var (normalWeek, refusal) = Normalize(week);
            if (refusal is not null)
            {
                return (null, refusal);
            }

            normalWeeks.Add(normalWeek!);
        }

        return (content with { Name = name, Weeks = normalWeeks }, null);
    }

    private static (TrainingWeekRequest? Week, Refusal? Refusal) Normalize(TrainingWeekRequest? week)
    {
        if (week is null)
        {
            return (null, new Refusal("weeks", "A week is missing."));
        }

        if (Text(week.Label, 120, "weeks", "A week name") is { } labelRefusal)
        {
            return (null, labelRefusal);
        }

        var sessions = week.Sessions ?? [];
        if (sessions.Count > 14)
        {
            return (null, new Refusal("weeks", "A week holds at most 14 sessions."));
        }

        var normalSessions = new List<TrainingSessionRequest>(sessions.Count);
        foreach (var session in sessions)
        {
            var (normalSession, refusal) = Normalize(session);
            if (refusal is not null)
            {
                return (null, refusal);
            }

            normalSessions.Add(normalSession!);
        }

        return (week with { Sessions = normalSessions }, null);
    }

    private static (TrainingSessionRequest? Session, Refusal? Refusal) Normalize(TrainingSessionRequest? session)
    {
        if (session is null)
        {
            return (null, new Refusal("sessions", "A session is missing."));
        }

        var name = session.Name ?? string.Empty;
        if ((Text(name, 160, "sessions", "A session name") ?? Text(session.CoachNotes, 4_000, "sessions", "A session note"))
            is { } textRefusal)
        {
            return (null, textRefusal);
        }

        if (session.DayOffset is < 0 or > 6)
        {
            return (null, new Refusal("sessions", "A session falls on day 1 to 7 of its week."));
        }

        var exercises = session.Exercises ?? [];
        if (exercises.Count > 40)
        {
            return (null, new Refusal("sessions", "A session holds at most 40 exercises."));
        }

        var normalExercises = new List<ExercisePrescriptionRequest>(exercises.Count);
        for (var index = 0; index < exercises.Count; index++)
        {
            var (normalExercise, refusal) = Normalize(exercises[index], index + 1);
            if (refusal is not null)
            {
                return (null, refusal);
            }

            normalExercises.Add(normalExercise!);
        }

        return (session with { Name = name, Exercises = normalExercises }, null);
    }

    private static (ExercisePrescriptionRequest? Exercise, Refusal? Refusal) Normalize(
        ExercisePrescriptionRequest? exercise,
        int position)
    {
        if (exercise is null || exercise.ExerciseId == Guid.Empty || !Enum.IsDefined(exercise.ModificationPolicy))
        {
            return (null, new Refusal("exercises", "An exercise is missing or not valid."));
        }

        if (Text(exercise.CoachNotes, 2_000, "exercises", "An exercise note") is { } notesRefusal)
        {
            return (null, notesRefusal);
        }

        var alternatives = exercise.ApprovedAlternativeExerciseIds ?? [];
        if (alternatives.Count > 20 || alternatives.Contains(Guid.Empty))
        {
            return (null, new Refusal("exercises", "An exercise approves at most 20 other exercises as swaps."));
        }

        var sets = exercise.Sets ?? [];
        if (sets.Count > 20)
        {
            return (null, new Refusal("sets", "An exercise holds at most 20 sets."));
        }

        var normalSets = new List<SetPrescriptionRequest>(sets.Count);
        foreach (var set in sets)
        {
            if (set is null ||
                !Enum.IsDefined(set.SetType) ||
                !Enum.IsDefined(set.LoadStrategy) ||
                !Enum.IsDefined(set.ExertionDisplayPreference) ||
                (set.LoadUnit is { } unit && !Enum.IsDefined(unit)))
            {
                return (null, new Refusal("sets", "A set is missing or not valid."));
            }

            if ((Text(set.Tempo, 32, "sets", "A tempo") ?? Text(set.CoachNotes, 1_000, "sets", "A set note"))
                is { } setRefusal)
            {
                return (null, setRefusal);
            }

            normalSets.Add(set with { Position = normalSets.Count + 1 });
        }

        return (exercise with
        {
            Position = position,
            ApprovedAlternativeExerciseIds = [.. alternatives],
            Sets = normalSets,
        }, null);
    }

    /// <summary>
    /// Text up to its limit. A NUL character is refused because PostgreSQL cannot store one; any
    /// other character is kept as typed, and Publish trims and checks it as any save does.
    /// </summary>
    private static Refusal? Text(string? value, int maximum, string field, string what) =>
        value switch
        {
            null => null,
            _ when value.Length > maximum => new Refusal(field, $"{what} can be at most {maximum} characters."),
            _ when value.Contains('\0', StringComparison.Ordinal) =>
                new Refusal(field, $"{what} cannot contain a NUL character."),
            _ => null,
        };

    private sealed record Refusal(string Field, string Problem);
}
