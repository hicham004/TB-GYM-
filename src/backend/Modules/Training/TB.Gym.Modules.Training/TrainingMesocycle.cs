using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Training;

public sealed class TrainingMesocycle : TenantEntity
{
    private readonly List<MesocycleWeek> weeks = [];

    private TrainingMesocycle()
    {
    }

    private TrainingMesocycle(
        Guid tenantId,
        Guid clientProfileId,
        Guid enrollmentId,
        Guid sourceTemplateId,
        Guid sourceTemplateVersionId,
        string name,
        DateOnly startDate,
        string timeZoneId,
        MesocycleKind kind,
        TrainingLoadUnit loadUnit,
        decimal loadIncrement,
        TrainingLoadRoundingMode loadRoundingMode,
        Guid assignmentCommandId,
        ProgramBlueprint snapshot,
        Guid? id)
        : base(tenantId)
    {
        if (clientProfileId == Guid.Empty || enrollmentId == Guid.Empty ||
            sourceTemplateId == Guid.Empty || sourceTemplateVersionId == Guid.Empty || assignmentCommandId == Guid.Empty)
        {
            throw new ArgumentException("Client, enrollment, and source template ids are required.");
        }

        if (kind != MesocycleKind.Primary)
        {
            throw new ArgumentException("Phase 3 supports primary mesocycles only.", nameof(kind));
        }

        if (id is { } suppliedId)
        {
            if (suppliedId == Guid.Empty)
            {
                throw new ArgumentException("A supplied mesocycle id cannot be empty.", nameof(id));
            }

            Id = suppliedId;
        }

        _ = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);
        if (!Enum.IsDefined(loadUnit) || !Enum.IsDefined(loadRoundingMode) || loadIncrement is <= 0m or > 50m)
        {
            throw new ArgumentException("The load-rounding policy is invalid.");
        }

        ClientProfileId = clientProfileId;
        EnrollmentId = enrollmentId;
        SourceTemplateId = sourceTemplateId;
        SourceTemplateVersionId = sourceTemplateVersionId;
        Name = TrainingText.Required(name, 160, nameof(name));
        StartDate = startDate;
        TimeZoneId = timeZoneId;
        Kind = kind;
        Status = MesocycleStatus.Planned;
        BlocksPrimaryOverlap = true;
        LoadUnit = loadUnit;
        LoadIncrement = decimal.Round(loadIncrement, 3, MidpointRounding.AwayFromZero);
        LoadRoundingMode = loadRoundingMode;
        AssignmentCommandId = assignmentCommandId;

        AppendWeeks(snapshot.Weeks);
    }

    public Guid ClientProfileId { get; private set; }

    public Guid EnrollmentId { get; private set; }

    public Guid SourceTemplateId { get; private set; }

    public Guid SourceTemplateVersionId { get; private set; }

    public string Name { get; private set; } = string.Empty;

    public DateOnly StartDate { get; private set; }

    public DateOnly EndDateExclusive { get; private set; }

    public string TimeZoneId { get; private set; } = string.Empty;

    public MesocycleKind Kind { get; private set; }

    public MesocycleStatus Status { get; private set; }

    public bool BlocksPrimaryOverlap { get; private set; }

    public bool RevealAllWeeks { get; private set; }

    public TrainingLoadUnit LoadUnit { get; private set; }

    public decimal LoadIncrement { get; private set; }

    public TrainingLoadRoundingMode LoadRoundingMode { get; private set; }

    public Guid AssignmentCommandId { get; private set; }

    public int MutationSequence { get; private set; }

    public IReadOnlyCollection<MesocycleWeek> Weeks => weeks;

    public MesocycleStatus GetEffectiveStatus(DateTimeOffset now)
    {
        if (Status is MesocycleStatus.Completed or MesocycleStatus.Cancelled)
        {
            return Status;
        }

        var localNow = TimeZoneInfo.ConvertTime(now, TimeZoneInfo.FindSystemTimeZoneById(TimeZoneId));
        return DateOnly.FromDateTime(localNow.DateTime) < StartDate
            ? MesocycleStatus.Planned
            : MesocycleStatus.Active;
    }

    public static TrainingMesocycle CreateSnapshot(
        Guid tenantId,
        Guid clientProfileId,
        Guid enrollmentId,
        Guid sourceTemplateId,
        Guid sourceTemplateVersionId,
        string name,
        DateOnly startDate,
        string timeZoneId,
        MesocycleKind kind,
        TrainingLoadUnit loadUnit,
        decimal loadIncrement,
        TrainingLoadRoundingMode loadRoundingMode,
        Guid assignmentCommandId,
        ProgramBlueprint snapshot,
        Guid? id = null) =>
        new(
            tenantId,
            clientProfileId,
            enrollmentId,
            sourceTemplateId,
            sourceTemplateVersionId,
            name,
            startDate,
            timeZoneId,
            kind,
            loadUnit,
            loadIncrement,
            loadRoundingMode,
            assignmentCommandId,
            snapshot,
            id);

    public void SetRevealAllWeeks(bool reveal)
    {
        EnsureNonTerminal();
        if (RevealAllWeeks != reveal)
        {
            RevealAllWeeks = reveal;
            RegisterMutation();
        }
    }

    public void SetWeekPublished(Guid weekId, bool isPublished)
    {
        EnsureNonTerminal();
        var week = weeks.SingleOrDefault(item => item.Id == weekId)
            ?? throw new ArgumentException("The week does not belong to this mesocycle.", nameof(weekId));
        week.SetPublished(isPublished);
        RegisterMutation();
    }

    public MesocycleStatus Cancel(DateTimeOffset now)
    {
        EnsureNonTerminal();
        if (weeks.SelectMany(item => item.Sessions).Any(session => session.HasStarted && !session.IsCompleted))
        {
            throw new InvalidOperationException("A mesocycle with a workout in progress cannot be cancelled.");
        }

        var previous = GetEffectiveStatus(now);
        Status = MesocycleStatus.Cancelled;
        BlocksPrimaryOverlap = false;
        RegisterMutation();
        return previous;
    }

    public MesocycleStatus Complete(DateTimeOffset now)
    {
        EnsureNonTerminal();
        var previous = GetEffectiveStatus(now);
        if (previous != MesocycleStatus.Active)
        {
            throw new InvalidOperationException("A planned mesocycle cannot be completed before it starts.");
        }

        if (weeks.SelectMany(item => item.Sessions).Any(session => !session.IsCompleted))
        {
            throw new InvalidOperationException("Every programmed session must be completed before the mesocycle closes.");
        }

        Status = MesocycleStatus.Completed;
        RegisterMutation();
        return previous;
    }

    public void Reschedule(DateOnly newStartDate)
    {
        EnsureNonTerminal();
        if (weeks.SelectMany(item => item.Sessions).Any(session => session.HasStarted))
        {
            throw new InvalidOperationException("A mesocycle cannot be rescheduled after a workout starts.");
        }

        StartDate = newStartDate;
        foreach (var week in weeks)
        {
            week.Reschedule(newStartDate.AddDays((week.WeekNumber - 1) * 7));
        }

        RecalculateEndDate();
        RegisterMutation();
    }

    public void ReplaceFutureSession(Guid sessionId, TrainingSessionBlueprint blueprint)
    {
        EnsureNonTerminal();
        var session = weeks.SelectMany(item => item.Sessions).SingleOrDefault(item => item.Id == sessionId)
            ?? throw new ArgumentException("The session does not belong to this mesocycle.", nameof(sessionId));
        session.ReplacePrescription(blueprint);
        RegisterMutation();
    }

    public void MarkSessionStarted(Guid sessionId)
    {
        EnsureNonTerminal();
        var session = weeks.SelectMany(item => item.Sessions).SingleOrDefault(item => item.Id == sessionId)
            ?? throw new ArgumentException("The session does not belong to this mesocycle.", nameof(sessionId));
        session.MarkStarted();
        RegisterMutation();
    }

    public bool MarkSessionCompleted(Guid sessionId, DateTimeOffset now)
    {
        EnsureNonTerminal();
        var session = weeks.SelectMany(item => item.Sessions).SingleOrDefault(item => item.Id == sessionId)
            ?? throw new ArgumentException("The session does not belong to this mesocycle.", nameof(sessionId));
        session.MarkCompleted();
        RegisterMutation();
        if (weeks.SelectMany(item => item.Sessions).All(item => item.IsCompleted))
        {
            Complete(now);
            return true;
        }

        return false;
    }

    public void AppendWeeks(IReadOnlyList<TrainingWeekBlueprint> newWeeks)
    {
        EnsureNonTerminal();
        if (newWeeks.Count == 0 || weeks.Count + newWeeks.Count > 52)
        {
            throw new ArgumentOutOfRangeException(nameof(newWeeks), "A mesocycle supports 1 to 52 weeks.");
        }

        foreach (var blueprint in newWeeks)
        {
            var weekNumber = weeks.Count + 1;
            weeks.Add(MesocycleWeek.Create(
                TenantId,
                Id,
                weekNumber,
                StartDate.AddDays((weekNumber - 1) * 7),
                blueprint));
        }

        RecalculateEndDate();
        RegisterMutation();
    }

    private void RecalculateEndDate() => EndDateExclusive = StartDate.AddDays(checked(weeks.Count * 7));

    private void RegisterMutation() => MutationSequence = checked(MutationSequence + 1);

    private void EnsureNonTerminal()
    {
        if (Status is MesocycleStatus.Completed or MesocycleStatus.Cancelled)
        {
            throw new InvalidOperationException("Completed or cancelled mesocycle history is immutable.");
        }
    }
}

public sealed class MesocycleWeek : TenantEntity
{
    private readonly List<TrainingSession> sessions = [];

    private MesocycleWeek()
    {
    }

    private MesocycleWeek(
        Guid tenantId,
        Guid mesocycleId,
        int weekNumber,
        DateOnly startsOn,
        TrainingWeekBlueprint blueprint)
        : base(tenantId)
    {
        if (blueprint.Sessions.Count > 14)
        {
            throw new ArgumentOutOfRangeException(nameof(blueprint), "Each week supports at most 14 sessions.");
        }

        MesocycleId = mesocycleId;
        WeekNumber = weekNumber;
        StartsOn = startsOn;
        Label = TrainingText.Optional(blueprint.Label, 120, nameof(blueprint));
        IsPublished = blueprint.IsPublished;

        for (var index = 0; index < blueprint.Sessions.Count; index++)
        {
            sessions.Add(TrainingSession.Create(
                tenantId,
                Id,
                startsOn,
                index,
                blueprint.Sessions[index]));
        }
    }

    public Guid MesocycleId { get; private set; }

    public int WeekNumber { get; private set; }

    public DateOnly StartsOn { get; private set; }

    public string? Label { get; private set; }

    public bool IsPublished { get; private set; }

    public IReadOnlyCollection<TrainingSession> Sessions => sessions;

    internal static MesocycleWeek Create(
        Guid tenantId,
        Guid mesocycleId,
        int weekNumber,
        DateOnly startsOn,
        TrainingWeekBlueprint blueprint) =>
        new(tenantId, mesocycleId, weekNumber, startsOn, blueprint);

    internal void SetPublished(bool value) => IsPublished = value;

    internal void Reschedule(DateOnly startsOn)
    {
        StartsOn = startsOn;
        foreach (var session in sessions.Where(item => !item.HasStarted))
        {
            session.Reschedule(startsOn.AddDays(session.DayOffset));
        }
    }
}

public sealed class TrainingSession : TenantEntity
{
    private readonly List<ExercisePrescription> exercises = [];

    private TrainingSession()
    {
    }

    private TrainingSession(
        Guid tenantId,
        Guid mesocycleWeekId,
        DateOnly weekStartsOn,
        int position,
        TrainingSessionBlueprint blueprint)
        : base(tenantId)
    {
        MesocycleWeekId = mesocycleWeekId;
        Position = position;
        ApplyBlueprint(blueprint, weekStartsOn);
    }

    public Guid MesocycleWeekId { get; private set; }

    public int Position { get; private set; }

    public int DayOffset { get; private set; }

    public DateOnly ScheduledDate { get; private set; }

    public string Name { get; private set; } = string.Empty;

    public string? CoachNotes { get; private set; }

    public bool HasStarted { get; private set; }

    public bool IsCompleted { get; private set; }

    public IReadOnlyCollection<ExercisePrescription> Exercises => exercises;

    internal static TrainingSession Create(
        Guid tenantId,
        Guid mesocycleWeekId,
        DateOnly weekStartsOn,
        int position,
        TrainingSessionBlueprint blueprint) =>
        new(tenantId, mesocycleWeekId, weekStartsOn, position, blueprint);

    internal void MarkStarted()
    {
        if (HasStarted)
        {
            throw new InvalidOperationException("The session was already started.");
        }

        HasStarted = true;
    }

    internal void MarkCompleted()
    {
        if (!HasStarted || IsCompleted)
        {
            throw new InvalidOperationException("Only an active session can be completed.");
        }

        IsCompleted = true;
    }

    internal void Reschedule(DateOnly date)
    {
        if (!IsCompleted)
        {
            ScheduledDate = date;
        }
    }

    internal void ReplacePrescription(TrainingSessionBlueprint blueprint)
    {
        if (HasStarted)
        {
            throw new InvalidOperationException("Started or completed programming is immutable.");
        }

        var weekStartsOn = ScheduledDate.AddDays(-DayOffset);
        exercises.Clear();
        ApplyBlueprint(blueprint, weekStartsOn);
    }

    private void ApplyBlueprint(TrainingSessionBlueprint blueprint, DateOnly weekStartsOn)
    {
        if (blueprint.DayOffset is < 0 or > 6 || blueprint.Exercises.Count > 40)
        {
            throw new ArgumentOutOfRangeException(nameof(blueprint), "A session day or exercise count is invalid.");
        }

        DayOffset = blueprint.DayOffset;
        ScheduledDate = weekStartsOn.AddDays(DayOffset);
        Name = TrainingText.Required(blueprint.Name, 160, nameof(blueprint));
        CoachNotes = TrainingText.Optional(blueprint.CoachNotes, 4_000, nameof(blueprint));
        foreach (var exercise in blueprint.Exercises.OrderBy(item => item.Position))
        {
            exercises.Add(ExercisePrescription.Create(TenantId, Id, exercise));
        }
    }
}

public sealed class ExercisePrescription : TenantEntity
{
    private readonly List<SetPrescription> sets = [];
    private readonly List<ExercisePrescriptionAlternative> alternatives = [];
    private readonly List<ExercisePrescriptionMediaSnapshot> media = [];

    private ExercisePrescription()
    {
    }

    private ExercisePrescription(Guid tenantId, Guid trainingSessionId, ExercisePrescriptionBlueprint blueprint)
        : base(tenantId)
    {
        if (blueprint.ExerciseId == Guid.Empty || blueprint.Sets.Count is < 1 or > 20)
        {
            throw new ArgumentException("An exercise and 1 to 20 sets are required.", nameof(blueprint));
        }

        TrainingSessionId = trainingSessionId;
        ExerciseId = blueprint.ExerciseId;
        ExerciseNameSnapshot = TrainingText.Required(blueprint.ExerciseNameSnapshot, 160, nameof(blueprint));
        Position = blueprint.Position;
        IsMainLift = blueprint.IsMainLift;
        ModificationPolicy = IsMainLift
            ? PrescriptionModificationPolicy.Locked
            : blueprint.ModificationPolicy;
        CoachNotes = TrainingText.Optional(blueprint.CoachNotes, 2_000, nameof(blueprint));

        ArgumentNullException.ThrowIfNull(blueprint.MediaAssetIds);
        var mediaPosition = 0;
        foreach (var mediaAssetId in blueprint.MediaAssetIds.Distinct().Take(10))
        {
            media.Add(ExercisePrescriptionMediaSnapshot.Create(TenantId, Id, mediaAssetId, mediaPosition++));
        }

        foreach (var alternative in blueprint.ApprovedAlternativeExerciseIds.Distinct().Take(20))
        {
            alternatives.Add(ExercisePrescriptionAlternative.Create(TenantId, Id, alternative));
        }

        foreach (var set in blueprint.Sets.OrderBy(item => item.Position))
        {
            sets.Add(SetPrescription.Create(TenantId, Id, set));
        }
    }

    public Guid TrainingSessionId { get; private set; }

    public Guid ExerciseId { get; private set; }

    public string ExerciseNameSnapshot { get; private set; } = string.Empty;

    public int Position { get; private set; }

    public bool IsMainLift { get; private set; }

    public PrescriptionModificationPolicy ModificationPolicy { get; private set; }

    public string? CoachNotes { get; private set; }

    public IReadOnlyCollection<SetPrescription> Sets => sets;

    public IReadOnlyCollection<ExercisePrescriptionAlternative> Alternatives => alternatives;

    public IReadOnlyCollection<ExercisePrescriptionMediaSnapshot> Media => media;

    internal static ExercisePrescription Create(
        Guid tenantId,
        Guid trainingSessionId,
        ExercisePrescriptionBlueprint blueprint) =>
        new(tenantId, trainingSessionId, blueprint);
}

public sealed class ExercisePrescriptionMediaSnapshot : TenantEntity
{
    private ExercisePrescriptionMediaSnapshot()
    {
    }

    private ExercisePrescriptionMediaSnapshot(
        Guid tenantId,
        Guid exercisePrescriptionId,
        Guid mediaAssetId,
        int displayOrder)
        : base(tenantId)
    {
        if (exercisePrescriptionId == Guid.Empty || mediaAssetId == Guid.Empty || displayOrder < 0)
        {
            throw new ArgumentException("Prescription media snapshot metadata is invalid.");
        }

        ExercisePrescriptionId = exercisePrescriptionId;
        MediaAssetId = mediaAssetId;
        DisplayOrder = displayOrder;
    }

    public Guid ExercisePrescriptionId { get; private set; }

    public Guid MediaAssetId { get; private set; }

    public int DisplayOrder { get; private set; }

    internal static ExercisePrescriptionMediaSnapshot Create(
        Guid tenantId,
        Guid exercisePrescriptionId,
        Guid mediaAssetId,
        int displayOrder) =>
        new(tenantId, exercisePrescriptionId, mediaAssetId, displayOrder);
}

public sealed class ExercisePrescriptionAlternative : TenantEntity
{
    private ExercisePrescriptionAlternative()
    {
    }

    private ExercisePrescriptionAlternative(Guid tenantId, Guid exercisePrescriptionId, Guid exerciseId)
        : base(tenantId)
    {
        if (exerciseId == Guid.Empty)
        {
            throw new ArgumentException("An alternative exercise is required.", nameof(exerciseId));
        }

        ExercisePrescriptionId = exercisePrescriptionId;
        ExerciseId = exerciseId;
    }

    public Guid ExercisePrescriptionId { get; private set; }

    public Guid ExerciseId { get; private set; }

    internal static ExercisePrescriptionAlternative Create(
        Guid tenantId,
        Guid exercisePrescriptionId,
        Guid exerciseId) =>
        new(tenantId, exercisePrescriptionId, exerciseId);
}

public sealed class SetPrescription : TenantEntity
{
    private SetPrescription()
    {
    }

    private SetPrescription(Guid tenantId, Guid exercisePrescriptionId, SetPrescriptionBlueprint blueprint)
        : base(tenantId)
    {
        SetPrescriptionRules.Validate(blueprint);
        ExercisePrescriptionId = exercisePrescriptionId;
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
        WorkingMaxSnapshotId = blueprint.WorkingMaxSnapshotId;
        UnroundedRecommendedLoad = blueprint.UnroundedRecommendedLoad;
        PrescribedLoad = blueprint.PrescribedLoad;
        CalculationStrategyKey = TrainingText.Optional(blueprint.CalculationStrategyKey, 80, nameof(blueprint));
        CalculationStrategyVersion = TrainingText.Optional(blueprint.CalculationStrategyVersion, 40, nameof(blueprint));
        CalculationExplanation = TrainingText.Optional(blueprint.CalculationExplanation, 1_000, nameof(blueprint));
        IsManualLoadOverride = blueprint.IsManualLoadOverride;
    }

    public Guid ExercisePrescriptionId { get; private set; }

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

    public Guid? WorkingMaxSnapshotId { get; private set; }

    public decimal? UnroundedRecommendedLoad { get; private set; }

    public decimal? PrescribedLoad { get; private set; }

    public string? CalculationStrategyKey { get; private set; }

    public string? CalculationStrategyVersion { get; private set; }

    public string? CalculationExplanation { get; private set; }

    public bool IsManualLoadOverride { get; private set; }

    internal static SetPrescription Create(
        Guid tenantId,
        Guid exercisePrescriptionId,
        SetPrescriptionBlueprint blueprint) =>
        new(tenantId, exercisePrescriptionId, blueprint);
}

public static class TrainingCalendarPolicy
{
    public static WeekAvailability GetWeekAvailability(
        DateOnly mesocycleStartDate,
        int weekNumber,
        string timeZoneId,
        DateTimeOffset now,
        bool revealAllWeeks,
        bool isPublished)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(weekNumber, 1);

        var localNow = TimeZoneInfo.ConvertTime(now, TimeZoneInfo.FindSystemTimeZoneById(timeZoneId));
        var tenantToday = DateOnly.FromDateTime(localNow.DateTime);
        var unlockDate = mesocycleStartDate.AddDays((weekNumber - 1) * 7);
        var unlockedByDate = tenantToday >= unlockDate;
        return new WeekAvailability(
            isPublished && (revealAllWeeks || unlockedByDate),
            isPublished,
            unlockDate,
            revealAllWeeks,
            unlockedByDate);
    }
}

public sealed record WeekAvailability(
    bool IsVisible,
    bool IsPublished,
    DateOnly UnlockDate,
    bool RevealedByCoach,
    bool UnlockedByDate);

public enum MesocycleKind
{
    Primary = 1,
    Supplemental = 2,
}

public enum MesocycleStatus
{
    Planned = 1,
    Active = 2,
    Completed = 3,
    Cancelled = 4,
}

public enum TrainingLoadRoundingMode
{
    Nearest = 1,
    Down = 2,
    Up = 3,
}
