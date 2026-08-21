using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Training;

public sealed class ProgramTemplate : TenantEntity
{
    private ProgramTemplate()
    {
    }

    private ProgramTemplate(Guid tenantId, string name)
        : base(tenantId)
    {
        Name = TrainingText.Required(name, 160, nameof(name));
    }

    public string Name { get; private set; } = string.Empty;

    public int CurrentVersionNumber { get; private set; }

    public bool IsArchived { get; private set; }

    public static ProgramTemplate Create(Guid tenantId, string name) => new(tenantId, name);

    public int CreateNextVersion(string name)
    {
        if (IsArchived)
        {
            throw new InvalidOperationException("An archived template cannot receive a new version.");
        }

        Name = TrainingText.Required(name, 160, nameof(name));
        CurrentVersionNumber = checked(CurrentVersionNumber + 1);
        return CurrentVersionNumber;
    }

    public void Archive() => IsArchived = true;

    public void Restore() => IsArchived = false;
}

public sealed class ProgramTemplateVersion : TenantEntity
{
    private readonly List<ProgramTemplateWeek> weeks = [];

    private ProgramTemplateVersion()
    {
    }

    private ProgramTemplateVersion(
        Guid tenantId,
        Guid templateId,
        int versionNumber,
        ProgramBlueprint blueprint,
        bool publish,
        DateTimeOffset now)
        : base(tenantId)
    {
        if (templateId == Guid.Empty || versionNumber < 1)
        {
            throw new ArgumentException("Template and version are required.");
        }

        ValidateBlueprint(blueprint);
        TemplateId = templateId;
        VersionNumber = versionNumber;
        NameSnapshot = TrainingText.Required(blueprint.Name, 160, nameof(blueprint));
        DescriptionSnapshot = TrainingText.Optional(blueprint.Description, 4_000, nameof(blueprint));
        IsPublished = publish;
        PublishedAtUtc = publish ? now : null;

        for (var weekIndex = 0; weekIndex < blueprint.Weeks.Count; weekIndex++)
        {
            weeks.Add(ProgramTemplateWeek.Create(
                tenantId,
                Id,
                weekIndex + 1,
                blueprint.Weeks[weekIndex]));
        }
    }

    public Guid TemplateId { get; private set; }

    public int VersionNumber { get; private set; }

    public string NameSnapshot { get; private set; } = string.Empty;

    public string? DescriptionSnapshot { get; private set; }

    public bool IsPublished { get; private set; }

    public DateTimeOffset? PublishedAtUtc { get; private set; }

    public IReadOnlyCollection<ProgramTemplateWeek> Weeks => weeks;

    public static ProgramTemplateVersion Create(
        Guid tenantId,
        Guid templateId,
        int versionNumber,
        ProgramBlueprint blueprint,
        bool publish,
        DateTimeOffset now) =>
        new(tenantId, templateId, versionNumber, blueprint, publish, now);

    public void Publish(DateTimeOffset now)
    {
        if (IsPublished)
        {
            return;
        }

        IsPublished = true;
        PublishedAtUtc = now;
    }

    private static void ValidateBlueprint(ProgramBlueprint blueprint)
    {
        ArgumentNullException.ThrowIfNull(blueprint);
        if (blueprint.Weeks is null || blueprint.Weeks.Count is < 1 or > 52)
        {
            throw new ArgumentOutOfRangeException(nameof(blueprint), "A program requires 1 to 52 weeks.");
        }

        if (blueprint.Weeks.Any(week => week.Sessions is null || week.Sessions.Count > 14))
        {
            throw new ArgumentOutOfRangeException(nameof(blueprint), "Each week supports up to 14 sessions.");
        }
    }
}

public sealed class ProgramTemplateWeek : TenantEntity
{
    private readonly List<ProgramTemplateSession> sessions = [];

    private ProgramTemplateWeek()
    {
    }

    private ProgramTemplateWeek(
        Guid tenantId,
        Guid templateVersionId,
        int weekNumber,
        TrainingWeekBlueprint blueprint)
        : base(tenantId)
    {
        TemplateVersionId = templateVersionId;
        WeekNumber = weekNumber;
        Label = TrainingText.Optional(blueprint.Label, 120, nameof(blueprint));
        IsPublishedByDefault = blueprint.IsPublished;

        for (var index = 0; index < blueprint.Sessions.Count; index++)
        {
            sessions.Add(ProgramTemplateSession.Create(
                tenantId,
                Id,
                index,
                blueprint.Sessions[index]));
        }
    }

    public Guid TemplateVersionId { get; private set; }

    public int WeekNumber { get; private set; }

    public string? Label { get; private set; }

    public bool IsPublishedByDefault { get; private set; }

    public IReadOnlyCollection<ProgramTemplateSession> Sessions => sessions;

    internal static ProgramTemplateWeek Create(
        Guid tenantId,
        Guid templateVersionId,
        int weekNumber,
        TrainingWeekBlueprint blueprint) =>
        new(tenantId, templateVersionId, weekNumber, blueprint);
}

public sealed class ProgramTemplateSession : TenantEntity
{
    private readonly List<ProgramTemplateExercise> exercises = [];

    private ProgramTemplateSession()
    {
    }

    private ProgramTemplateSession(
        Guid tenantId,
        Guid templateWeekId,
        int position,
        TrainingSessionBlueprint blueprint)
        : base(tenantId)
    {
        if (blueprint.DayOffset is < 0 or > 6 || blueprint.Exercises.Count > 40)
        {
            throw new ArgumentOutOfRangeException(nameof(blueprint), "A session day must be within its week and contain at most 40 exercises.");
        }

        TemplateWeekId = templateWeekId;
        Position = position;
        DayOffset = blueprint.DayOffset;
        Name = TrainingText.Required(blueprint.Name, 160, nameof(blueprint));
        CoachNotes = TrainingText.Optional(blueprint.CoachNotes, 4_000, nameof(blueprint));

        foreach (var exercise in blueprint.Exercises.OrderBy(item => item.Position))
        {
            exercises.Add(ProgramTemplateExercise.Create(tenantId, Id, exercise));
        }
    }

    public Guid TemplateWeekId { get; private set; }

    public int Position { get; private set; }

    public int DayOffset { get; private set; }

    public string Name { get; private set; } = string.Empty;

    public string? CoachNotes { get; private set; }

    public IReadOnlyCollection<ProgramTemplateExercise> Exercises => exercises;

    internal static ProgramTemplateSession Create(
        Guid tenantId,
        Guid templateWeekId,
        int position,
        TrainingSessionBlueprint blueprint) =>
        new(tenantId, templateWeekId, position, blueprint);
}

public sealed class ProgramTemplateExercise : TenantEntity
{
    private readonly List<ProgramTemplateSet> sets = [];
    private readonly List<ProgramTemplateExerciseAlternative> alternatives = [];

    private ProgramTemplateExercise()
    {
    }

    private ProgramTemplateExercise(
        Guid tenantId,
        Guid templateSessionId,
        ExercisePrescriptionBlueprint blueprint)
        : base(tenantId)
    {
        if (blueprint.ExerciseId == Guid.Empty || blueprint.Sets.Count is < 1 or > 20)
        {
            throw new ArgumentException("An exercise and 1 to 20 sets are required.", nameof(blueprint));
        }

        if (!Enum.IsDefined(blueprint.ModificationPolicy))
        {
            throw new ArgumentOutOfRangeException(nameof(blueprint));
        }

        TemplateSessionId = templateSessionId;
        ExerciseId = blueprint.ExerciseId;
        ExerciseNameSnapshot = TrainingText.Required(blueprint.ExerciseNameSnapshot, 160, nameof(blueprint));
        Position = blueprint.Position;
        IsMainLift = blueprint.IsMainLift;
        ModificationPolicy = blueprint.IsMainLift
            ? PrescriptionModificationPolicy.Locked
            : blueprint.ModificationPolicy;
        CoachNotes = TrainingText.Optional(blueprint.CoachNotes, 2_000, nameof(blueprint));

        foreach (var alternativeId in blueprint.ApprovedAlternativeExerciseIds.Distinct().Take(20))
        {
            if (alternativeId == Guid.Empty || alternativeId == ExerciseId)
            {
                throw new ArgumentException("Approved alternatives must reference another exercise.", nameof(blueprint));
            }

            alternatives.Add(ProgramTemplateExerciseAlternative.Create(
                tenantId,
                Id,
                alternativeId));
        }

        foreach (var set in blueprint.Sets.OrderBy(item => item.Position))
        {
            sets.Add(ProgramTemplateSet.Create(tenantId, Id, set));
        }
    }

    public Guid TemplateSessionId { get; private set; }

    public Guid ExerciseId { get; private set; }

    public string ExerciseNameSnapshot { get; private set; } = string.Empty;

    public int Position { get; private set; }

    public bool IsMainLift { get; private set; }

    public PrescriptionModificationPolicy ModificationPolicy { get; private set; }

    public string? CoachNotes { get; private set; }

    public IReadOnlyCollection<ProgramTemplateSet> Sets => sets;

    public IReadOnlyCollection<ProgramTemplateExerciseAlternative> Alternatives => alternatives;

    internal static ProgramTemplateExercise Create(
        Guid tenantId,
        Guid templateSessionId,
        ExercisePrescriptionBlueprint blueprint) =>
        new(tenantId, templateSessionId, blueprint);
}

public sealed class ProgramTemplateExerciseAlternative : TenantEntity
{
    private ProgramTemplateExerciseAlternative()
    {
    }

    private ProgramTemplateExerciseAlternative(Guid tenantId, Guid templateExerciseId, Guid exerciseId)
        : base(tenantId)
    {
        TemplateExerciseId = templateExerciseId;
        ExerciseId = exerciseId;
    }

    public Guid TemplateExerciseId { get; private set; }

    public Guid ExerciseId { get; private set; }

    internal static ProgramTemplateExerciseAlternative Create(
        Guid tenantId,
        Guid templateExerciseId,
        Guid exerciseId) =>
        new(tenantId, templateExerciseId, exerciseId);
}

public sealed class ProgramTemplateSet : TenantEntity
{
    private ProgramTemplateSet()
    {
    }

    private ProgramTemplateSet(Guid tenantId, Guid templateExerciseId, SetPrescriptionBlueprint blueprint)
        : base(tenantId)
    {
        SetPrescriptionRules.Validate(blueprint);
        TemplateExerciseId = templateExerciseId;
        Position = blueprint.Position;
        SetType = blueprint.SetType;
        RepetitionsMinimum = blueprint.RepetitionsMinimum;
        RepetitionsMaximum = blueprint.RepetitionsMaximum;
        LoadStrategy = blueprint.LoadStrategy;
        DirectLoad = blueprint.DirectLoad;
        LoadUnit = blueprint.LoadUnit;
        PercentageWorkingMax = blueprint.PercentageWorkingMax;
        TargetRpe = blueprint.TargetRpe;
        ExertionDisplayPreference = blueprint.ExertionDisplayPreference;
        RestSeconds = blueprint.RestSeconds;
        Tempo = TrainingText.Optional(blueprint.Tempo, 32, nameof(blueprint));
        CoachNotes = TrainingText.Optional(blueprint.CoachNotes, 1_000, nameof(blueprint));
        IsManualLoadOverride = blueprint.IsManualLoadOverride;
    }

    public Guid TemplateExerciseId { get; private set; }

    public int Position { get; private set; }

    public TrainingSetType SetType { get; private set; }

    public int? RepetitionsMinimum { get; private set; }

    public int? RepetitionsMaximum { get; private set; }

    public TrainingLoadStrategy LoadStrategy { get; private set; }

    public decimal? DirectLoad { get; private set; }

    public TrainingLoadUnit? LoadUnit { get; private set; }

    public decimal? PercentageWorkingMax { get; private set; }

    public decimal? TargetRpe { get; private set; }

    public ExertionDisplayPreference ExertionDisplayPreference { get; private set; }

    public int? RestSeconds { get; private set; }

    public string? Tempo { get; private set; }

    public string? CoachNotes { get; private set; }

    public bool IsManualLoadOverride { get; private set; }

    internal static ProgramTemplateSet Create(
        Guid tenantId,
        Guid templateExerciseId,
        SetPrescriptionBlueprint blueprint) =>
        new(tenantId, templateExerciseId, blueprint);

}

public sealed class SavedSessionTemplate : TenantEntity
{
    private SavedSessionTemplate()
    {
    }

    private SavedSessionTemplate(
        Guid tenantId,
        string name,
        Guid sourceTemplateVersionId,
        Guid sourceTemplateSessionId)
        : base(tenantId)
    {
        if (sourceTemplateVersionId == Guid.Empty || sourceTemplateSessionId == Guid.Empty)
        {
            throw new ArgumentException("An immutable source session is required.");
        }

        Name = TrainingText.Required(name, 160, nameof(name));
        SourceTemplateVersionId = sourceTemplateVersionId;
        SourceTemplateSessionId = sourceTemplateSessionId;
    }

    public string Name { get; private set; } = string.Empty;

    public Guid SourceTemplateVersionId { get; private set; }

    public Guid SourceTemplateSessionId { get; private set; }

    public bool IsArchived { get; private set; }

    public static SavedSessionTemplate Create(
        Guid tenantId,
        string name,
        Guid sourceTemplateVersionId,
        Guid sourceTemplateSessionId) =>
        new(tenantId, name, sourceTemplateVersionId, sourceTemplateSessionId);

    public void Archive() => IsArchived = true;
}

internal static class SetPrescriptionRules
{
    public static void Validate(SetPrescriptionBlueprint source)
    {
        if (!Enum.IsDefined(source.SetType) ||
            !Enum.IsDefined(source.LoadStrategy) ||
            !Enum.IsDefined(source.ExertionDisplayPreference))
        {
            throw new ArgumentException("Set prescription metadata is invalid.", nameof(source));
        }

        if (source.Position < 0 ||
            source.RepetitionsMinimum is < 1 or > 100 ||
            source.RepetitionsMaximum is < 1 or > 100 ||
            source.RepetitionsMinimum > source.RepetitionsMaximum ||
            source.RestSeconds is < 0 or > 3_600)
        {
            throw new ArgumentOutOfRangeException(nameof(source), "Set repetitions, order, or rest are outside the supported range.");
        }

        if (source.TargetRpe is { } rpe)
        {
            TrainingExertion.ValidateRpe(rpe);
        }

        switch (source.LoadStrategy)
        {
            case TrainingLoadStrategy.None:
                break;
            case TrainingLoadStrategy.Direct when source.DirectLoad is > 0m and <= 2_000m && source.LoadUnit is not null:
                break;
            case TrainingLoadStrategy.PercentageWorkingMax when source.PercentageWorkingMax is > 0m and <= 150m && source.LoadUnit is not null:
                break;
            case TrainingLoadStrategy.RpeBasedEpley when source.TargetRpe is not null && source.RepetitionsMaximum is not null && source.LoadUnit is not null:
                break;
            default:
                throw new ArgumentException("The selected load strategy is missing required fields.", nameof(source));
        }
    }

}
