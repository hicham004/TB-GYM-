using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Training;

public sealed class WorkoutExecution : TenantEntity
{
    private readonly List<WorkoutExercisePerformance> exercises = [];

    private WorkoutExecution()
    {
    }

    private WorkoutExecution(
        Guid tenantId,
        Guid clientProfileId,
        Guid mesocycleId,
        TrainingSession session,
        DateTimeOffset now)
        : base(tenantId)
    {
        if (clientProfileId == Guid.Empty || mesocycleId == Guid.Empty)
        {
            throw new ArgumentException("Client and mesocycle ids are required.");
        }

        ClientProfileId = clientProfileId;
        MesocycleId = mesocycleId;
        TrainingSessionId = session.Id;
        ScheduledDateSnapshot = session.ScheduledDate;
        SessionNameSnapshot = session.Name;
        SessionCoachNotesSnapshot = session.CoachNotes;
        PrescriptionVersionSnapshot = session.Version;
        Status = WorkoutExecutionStatus.InProgress;
        StartedAtUtc = now;

        foreach (var exercise in session.Exercises.OrderBy(item => item.Position))
        {
            exercises.Add(WorkoutExercisePerformance.Create(tenantId, Id, exercise));
        }
    }

    public Guid ClientProfileId { get; private set; }

    public Guid MesocycleId { get; private set; }

    public Guid TrainingSessionId { get; private set; }

    public DateOnly ScheduledDateSnapshot { get; private set; }

    public string SessionNameSnapshot { get; private set; } = string.Empty;

    public string? SessionCoachNotesSnapshot { get; private set; }

    public uint PrescriptionVersionSnapshot { get; private set; }

    public WorkoutExecutionStatus Status { get; private set; }

    public DateTimeOffset StartedAtUtc { get; private set; }

    public DateTimeOffset? CompletedAtUtc { get; private set; }

    public int MutationSequence { get; private set; }

    public IReadOnlyCollection<WorkoutExercisePerformance> Exercises => exercises;

    public static WorkoutExecution Start(
        Guid tenantId,
        Guid clientProfileId,
        Guid mesocycleId,
        TrainingSession session,
        DateTimeOffset now) =>
        new(tenantId, clientProfileId, mesocycleId, session, now);

    public void Complete(DateTimeOffset now)
    {
        EnsureMutable();
        RegisterMutation();
        Status = WorkoutExecutionStatus.Completed;
        CompletedAtUtc = now;
    }

    public WorkoutExercisePerformance GetExercise(Guid performanceId)
    {
        EnsureMutable();
        return exercises.SingleOrDefault(item => item.Id == performanceId)
            ?? throw new ArgumentException("The exercise performance does not belong to this workout.", nameof(performanceId));
    }

    public WorkoutSetPerformance GetSet(Guid performanceId)
    {
        EnsureMutable();
        return exercises.SelectMany(item => item.Sets).SingleOrDefault(item => item.Id == performanceId)
            ?? throw new ArgumentException("The set performance does not belong to this workout.", nameof(performanceId));
    }

    public void SelectActuallyPerformedExercise(
        Guid performanceId,
        Guid exerciseId,
        string exerciseName)
    {
        GetExercise(performanceId).SelectActuallyPerformedExercise(exerciseId, exerciseName);
        RegisterMutation();
    }

    public void RecordSetActual(
        Guid performanceId,
        int? repetitions,
        decimal? load,
        TrainingLoadUnit? loadUnit,
        decimal? rpe,
        bool isCompleted,
        string? clientNote)
    {
        GetSet(performanceId).RecordActual(
            repetitions,
            load,
            loadUnit,
            rpe,
            isCompleted,
            clientNote);
        RegisterMutation();
    }

    public void RegisterMutation()
    {
        EnsureMutable();
        MutationSequence = checked(MutationSequence + 1);
    }

    private void EnsureMutable()
    {
        if (Status == WorkoutExecutionStatus.Completed)
        {
            throw new InvalidOperationException("Completed workout history is immutable.");
        }
    }
}

public sealed class WorkoutExercisePerformance : TenantEntity
{
    private readonly List<WorkoutSetPerformance> sets = [];
    private readonly List<WorkoutExerciseAlternativeSnapshot> approvedAlternatives = [];
    private readonly List<WorkoutExerciseMediaSnapshot> media = [];

    private WorkoutExercisePerformance()
    {
    }

    private WorkoutExercisePerformance(
        Guid tenantId,
        Guid workoutExecutionId,
        ExercisePrescription prescription)
        : base(tenantId)
    {
        WorkoutExecutionId = workoutExecutionId;
        ExercisePrescriptionId = prescription.Id;
        PrescribedExerciseId = prescription.ExerciseId;
        PrescribedExerciseName = prescription.ExerciseNameSnapshot;
        ActualExerciseId = prescription.ExerciseId;
        ActualExerciseName = prescription.ExerciseNameSnapshot;
        Position = prescription.Position;
        ModificationPolicySnapshot = prescription.ModificationPolicy;
        IsMainLiftSnapshot = prescription.IsMainLift;
        CoachNotesSnapshot = prescription.CoachNotes;

        foreach (var alternative in prescription.Alternatives)
        {
            approvedAlternatives.Add(WorkoutExerciseAlternativeSnapshot.Create(
                tenantId,
                Id,
                alternative.ExerciseId));
        }

        foreach (var item in prescription.Media.OrderBy(item => item.DisplayOrder))
        {
            media.Add(WorkoutExerciseMediaSnapshot.Create(
                tenantId,
                Id,
                item.MediaAssetId,
                item.DisplayOrder));
        }

        foreach (var set in prescription.Sets.OrderBy(item => item.Position))
        {
            sets.Add(WorkoutSetPerformance.Create(tenantId, Id, set));
        }
    }

    public Guid WorkoutExecutionId { get; private set; }

    public Guid ExercisePrescriptionId { get; private set; }

    public Guid PrescribedExerciseId { get; private set; }

    public string PrescribedExerciseName { get; private set; } = string.Empty;

    public Guid ActualExerciseId { get; private set; }

    public string ActualExerciseName { get; private set; } = string.Empty;

    public bool WasSubstituted { get; private set; }

    public int Position { get; private set; }

    public PrescriptionModificationPolicy ModificationPolicySnapshot { get; private set; }

    public bool IsMainLiftSnapshot { get; private set; }

    public string? CoachNotesSnapshot { get; private set; }

    public IReadOnlyCollection<WorkoutSetPerformance> Sets => sets;

    public IReadOnlyCollection<WorkoutExerciseAlternativeSnapshot> ApprovedAlternatives => approvedAlternatives;

    public IReadOnlyCollection<WorkoutExerciseMediaSnapshot> Media => media;

    internal static WorkoutExercisePerformance Create(
        Guid tenantId,
        Guid workoutExecutionId,
        ExercisePrescription prescription) =>
        new(tenantId, workoutExecutionId, prescription);

    internal void SelectActuallyPerformedExercise(Guid exerciseId, string exerciseName)
    {
        if (exerciseId == PrescribedExerciseId)
        {
            ActualExerciseId = PrescribedExerciseId;
            ActualExerciseName = PrescribedExerciseName;
            WasSubstituted = false;
            return;
        }

        if (ModificationPolicySnapshot != PrescriptionModificationPolicy.CoachApprovedSwap ||
            approvedAlternatives.All(item => item.ExerciseId != exerciseId))
        {
            throw new InvalidOperationException("This prescription does not authorize the selected substitution.");
        }

        ActualExerciseId = exerciseId;
        ActualExerciseName = TrainingText.Required(exerciseName, 160, nameof(exerciseName));
        WasSubstituted = true;
    }
}

public sealed class WorkoutExerciseMediaSnapshot : TenantEntity
{
    private WorkoutExerciseMediaSnapshot()
    {
    }

    private WorkoutExerciseMediaSnapshot(
        Guid tenantId,
        Guid workoutExercisePerformanceId,
        Guid mediaAssetId,
        int displayOrder)
        : base(tenantId)
    {
        if (workoutExercisePerformanceId == Guid.Empty || mediaAssetId == Guid.Empty || displayOrder < 0)
        {
            throw new ArgumentException("Workout media snapshot metadata is invalid.");
        }

        WorkoutExercisePerformanceId = workoutExercisePerformanceId;
        MediaAssetId = mediaAssetId;
        DisplayOrder = displayOrder;
    }

    public Guid WorkoutExercisePerformanceId { get; private set; }

    public Guid MediaAssetId { get; private set; }

    public int DisplayOrder { get; private set; }

    internal static WorkoutExerciseMediaSnapshot Create(
        Guid tenantId,
        Guid workoutExercisePerformanceId,
        Guid mediaAssetId,
        int displayOrder) =>
        new(tenantId, workoutExercisePerformanceId, mediaAssetId, displayOrder);
}

public sealed class WorkoutExerciseAlternativeSnapshot : TenantEntity
{
    private WorkoutExerciseAlternativeSnapshot()
    {
    }

    private WorkoutExerciseAlternativeSnapshot(
        Guid tenantId,
        Guid workoutExercisePerformanceId,
        Guid exerciseId)
        : base(tenantId)
    {
        WorkoutExercisePerformanceId = workoutExercisePerformanceId;
        ExerciseId = exerciseId;
    }

    public Guid WorkoutExercisePerformanceId { get; private set; }

    public Guid ExerciseId { get; private set; }

    internal static WorkoutExerciseAlternativeSnapshot Create(
        Guid tenantId,
        Guid workoutExercisePerformanceId,
        Guid exerciseId) =>
        new(tenantId, workoutExercisePerformanceId, exerciseId);
}

public sealed class WorkoutSetPerformance : TenantEntity
{
    private WorkoutSetPerformance()
    {
    }

    private WorkoutSetPerformance(
        Guid tenantId,
        Guid workoutExercisePerformanceId,
        SetPrescription prescription)
        : base(tenantId)
    {
        WorkoutExercisePerformanceId = workoutExercisePerformanceId;
        SetPrescriptionId = prescription.Id;
        Position = prescription.Position;
        SetTypeSnapshot = prescription.SetType;
        PrescribedRepetitionsMinimum = prescription.RepetitionsMinimum;
        PrescribedRepetitionsMaximum = prescription.RepetitionsMaximum;
        PrescribedLoad = prescription.PrescribedLoad ?? prescription.DirectLoad;
        PrescribedLoadUnit = prescription.LoadUnit;
        PrescribedTargetRpe = prescription.TargetRpe;
        PrescribedRestSeconds = prescription.RestSeconds;
        PrescribedTempo = prescription.Tempo;
        CoachNotesSnapshot = prescription.CoachNotes;
        CalculationStrategyKeySnapshot = prescription.CalculationStrategyKey;
        CalculationStrategyVersionSnapshot = prescription.CalculationStrategyVersion;
        UnroundedRecommendedLoadSnapshot = prescription.UnroundedRecommendedLoad;
    }

    public Guid WorkoutExercisePerformanceId { get; private set; }

    public Guid SetPrescriptionId { get; private set; }

    public int Position { get; private set; }

    public TrainingSetType SetTypeSnapshot { get; private set; }

    public int? PrescribedRepetitionsMinimum { get; private set; }

    public int? PrescribedRepetitionsMaximum { get; private set; }

    public decimal? PrescribedLoad { get; private set; }

    public TrainingLoadUnit? PrescribedLoadUnit { get; private set; }

    public decimal? PrescribedTargetRpe { get; private set; }

    public int? PrescribedRestSeconds { get; private set; }

    public string? PrescribedTempo { get; private set; }

    public string? CoachNotesSnapshot { get; private set; }

    public string? CalculationStrategyKeySnapshot { get; private set; }

    public string? CalculationStrategyVersionSnapshot { get; private set; }

    public decimal? UnroundedRecommendedLoadSnapshot { get; private set; }

    public int? ActualRepetitions { get; private set; }

    public decimal? ActualLoad { get; private set; }

    public TrainingLoadUnit? ActualLoadUnit { get; private set; }

    public decimal? ActualRpe { get; private set; }

    public bool IsCompleted { get; private set; }

    public string? ClientNote { get; private set; }

    internal static WorkoutSetPerformance Create(
        Guid tenantId,
        Guid workoutExercisePerformanceId,
        SetPrescription prescription) =>
        new(tenantId, workoutExercisePerformanceId, prescription);

    internal void RecordActual(
        int? repetitions,
        decimal? load,
        TrainingLoadUnit? loadUnit,
        decimal? rpe,
        bool isCompleted,
        string? clientNote)
    {
        if (repetitions is < 0 or > 200 || load is < 0m or > 2_000m)
        {
            throw new ArgumentOutOfRangeException(nameof(repetitions), "Actual repetitions or load are outside the supported range.");
        }

        if (load is not null && loadUnit is null)
        {
            throw new ArgumentException("A load unit is required when actual load is recorded.", nameof(loadUnit));
        }

        if (rpe is { } actualRpe)
        {
            TrainingExertion.ValidateRpe(actualRpe);
        }

        ActualRepetitions = repetitions;
        ActualLoad = load is null ? null : decimal.Round(load.Value, 3, MidpointRounding.AwayFromZero);
        ActualLoadUnit = loadUnit;
        ActualRpe = rpe;
        IsCompleted = isCompleted;
        ClientNote = TrainingText.Optional(clientNote, 1_000, nameof(clientNote));
    }
}

public sealed class WorkoutNote : TenantEntity
{
    private WorkoutNote()
    {
    }

    private WorkoutNote(
        Guid tenantId,
        Guid workoutExecutionId,
        Guid? workoutExercisePerformanceId,
        Guid authorUserId,
        WorkoutNoteAuthorRole authorRole,
        string text)
        : base(tenantId)
    {
        if (workoutExecutionId == Guid.Empty || authorUserId == Guid.Empty || !Enum.IsDefined(authorRole))
        {
            throw new ArgumentException("Workout, author, and role are required.");
        }

        WorkoutExecutionId = workoutExecutionId;
        WorkoutExercisePerformanceId = workoutExercisePerformanceId;
        AuthorUserId = authorUserId;
        AuthorRole = authorRole;
        Text = TrainingText.Required(text, 2_000, nameof(text));
    }

    public Guid WorkoutExecutionId { get; private set; }

    public Guid? WorkoutExercisePerformanceId { get; private set; }

    public Guid AuthorUserId { get; private set; }

    public WorkoutNoteAuthorRole AuthorRole { get; private set; }

    public string Text { get; private set; } = string.Empty;

    public static WorkoutNote Create(
        Guid tenantId,
        Guid workoutExecutionId,
        Guid? workoutExercisePerformanceId,
        Guid authorUserId,
        WorkoutNoteAuthorRole authorRole,
        string text) =>
        new(
            tenantId,
            workoutExecutionId,
            workoutExercisePerformanceId,
            authorUserId,
            authorRole,
            text);
}

public enum WorkoutExecutionStatus
{
    InProgress = 1,
    Completed = 2,
}

public enum WorkoutNoteAuthorRole
{
    Coach = 1,
    Client = 2,
}
