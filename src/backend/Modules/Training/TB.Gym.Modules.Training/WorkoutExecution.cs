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

    private WorkoutExecution(
        Guid tenantId,
        Guid clientProfileId,
        DateOnly day,
        DateTimeOffset now)
        : base(tenantId)
    {
        if (clientProfileId == Guid.Empty)
        {
            throw new ArgumentException("A client id is required.");
        }

        ClientProfileId = clientProfileId;
        ScheduledDateSnapshot = day;
        SessionNameSnapshot = OwnWorkoutRule.Name;
        Status = WorkoutExecutionStatus.InProgress;
        StartedAtUtc = now;
    }

    public Guid ClientProfileId { get; private set; }

    /// <summary>The program the workout's session sits in; null on a workout of one's own (TRN-033).</summary>
    public Guid? MesocycleId { get; private set; }

    /// <summary>The session the workout was started from; null on a workout of one's own (TRN-033).</summary>
    public Guid? TrainingSessionId { get; private set; }

    /// <summary>
    /// A workout of one's own (TRN-033, notes plan N9b2): a client of the house started it with no program behind it,
    /// so nothing in it was prescribed. Its program and session are empty together, as a database check keeps them.
    /// </summary>
    public bool IsOwn => TrainingSessionId is null;

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

    /// <summary>
    /// Starts a workout of one's own (TRN-033) on the house's day: no program, no session and no exercise yet, under
    /// the rule's name, since nothing names it.
    /// </summary>
    public static WorkoutExecution StartOwn(
        Guid tenantId,
        Guid clientProfileId,
        DateOnly day,
        DateTimeOffset now) =>
        new(tenantId, clientProfileId, day, now);

    /// <summary>
    /// Adds an exercise to a workout of one's own, after the others, with that many empty sets (TRN-033). The caller
    /// has checked that it is in use in the house's pool. It is its own prescribed exercise, so no swap opens on it.
    /// </summary>
    public WorkoutExercisePerformance AddOwnExercise(Guid exerciseId, string exerciseName, int emptySets = 0)
    {
        EnsureOwnInProgress();
        if (emptySets is < 0 or > OwnWorkoutRule.MaximumSetsPerExercise)
        {
            throw new ArgumentOutOfRangeException(nameof(emptySets), "An exercise holds at most 20 sets.");
        }

        if (exercises.Count >= OwnWorkoutRule.MaximumExercises)
        {
            throw new OwnWorkoutConflictException(
                OwnWorkoutConflictException.LimitCode,
                "A workout holds at most 40 exercises.");
        }

        var exercise = WorkoutExercisePerformance.CreateOwn(
            TenantId,
            Id,
            exerciseId,
            exerciseName,
            exercises.Count == 0 ? 1 : exercises.Max(item => item.Position) + 1);
        for (var count = 0; count < emptySets; count++)
        {
            exercise.AddOwnSet();
        }

        exercises.Add(exercise);
        RegisterMutation();
        return exercise;
    }

    /// <summary>Adds an empty set after an exercise's others, in a workout of one's own (TRN-033).</summary>
    public WorkoutSetPerformance AddOwnSet(Guid exercisePerformanceId)
    {
        EnsureOwnInProgress();
        var set = GetExercise(exercisePerformanceId).AddOwnSet();
        RegisterMutation();
        return set;
    }

    /// <summary>
    /// Takes an exercise added by mistake out of a workout of one's own before it is finished, its sets with it
    /// (TRN-033): the rows go, as nothing in them was finished. No row of a program's workout ever goes.
    /// </summary>
    public WorkoutExercisePerformance RemoveOwnExercise(Guid exercisePerformanceId)
    {
        EnsureOwnInProgress();
        var exercise = GetExercise(exercisePerformanceId);
        exercises.Remove(exercise);
        RegisterMutation();
        return exercise;
    }

    /// <summary>
    /// Takes an exercise's last set out of a workout of one's own before it is finished (TRN-033). Only the last, so an
    /// exercise's sets stay numbered 1, 2, 3 and line up with last time's (TRN-029).
    /// </summary>
    public WorkoutSetPerformance RemoveOwnSet(Guid setPerformanceId)
    {
        EnsureOwnInProgress();
        var exercise = exercises.SingleOrDefault(item => item.Sets.Any(set => set.Id == setPerformanceId))
            ?? throw new ArgumentException("The set performance does not belong to this workout.", nameof(setPerformanceId));
        var set = exercise.RemoveLastOwnSet(setPerformanceId);
        RegisterMutation();
        return set;
    }

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

    private void EnsureOwnInProgress()
    {
        EnsureMutable();
        if (!IsOwn)
        {
            throw new OwnWorkoutConflictException(
                OwnWorkoutConflictException.NotOwnCode,
                OwnWorkoutConflictException.NotOwnMessage);
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

    private WorkoutExercisePerformance(
        Guid tenantId,
        Guid workoutExecutionId,
        Guid exerciseId,
        string exerciseName,
        int position)
        : base(tenantId)
    {
        if (workoutExecutionId == Guid.Empty || exerciseId == Guid.Empty || position < 1)
        {
            throw new ArgumentException("The workout, the exercise and a position are required.");
        }

        var name = TrainingText.Required(exerciseName, 160, nameof(exerciseName));
        WorkoutExecutionId = workoutExecutionId;
        PrescribedExerciseId = exerciseId;
        PrescribedExerciseName = name;
        ActualExerciseId = exerciseId;
        ActualExerciseName = name;
        Position = position;
        ModificationPolicySnapshot = PrescriptionModificationPolicy.Locked;
    }

    public Guid WorkoutExecutionId { get; private set; }

    /// <summary>The prescription it was started from; null on a workout of one's own, where nothing is prescribed.</summary>
    public Guid? ExercisePrescriptionId { get; private set; }

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

    /// <summary>
    /// An exercise of a workout of one's own (TRN-033): its own prescribed exercise, locked, with no coach's notes, no
    /// approved swap and no demo snapshot (its demos are the house pool's, MED-017).
    /// </summary>
    internal static WorkoutExercisePerformance CreateOwn(
        Guid tenantId,
        Guid workoutExecutionId,
        Guid exerciseId,
        string exerciseName,
        int position) =>
        new(tenantId, workoutExecutionId, exerciseId, exerciseName, position);

    internal WorkoutSetPerformance AddOwnSet()
    {
        if (sets.Count >= OwnWorkoutRule.MaximumSetsPerExercise)
        {
            throw new OwnWorkoutConflictException(
                OwnWorkoutConflictException.LimitCode,
                "An exercise holds at most 20 sets.");
        }

        var set = WorkoutSetPerformance.CreateOwn(
            TenantId,
            Id,
            sets.Count == 0 ? 1 : sets.Max(item => item.Position) + 1);
        sets.Add(set);
        return set;
    }

    internal WorkoutSetPerformance RemoveLastOwnSet(Guid setPerformanceId)
    {
        var set = sets.Single(item => item.Id == setPerformanceId);
        if (set.Position != sets.Max(item => item.Position))
        {
            throw new OwnWorkoutConflictException(
                OwnWorkoutConflictException.NotLastSetCode,
                "Only an exercise's last set can be taken away.");
        }

        sets.Remove(set);
        return set;
    }

    /// <summary>
    /// Records which lift is done (TRN-010). A completed set belongs to the lift it was done as (TRN-012), so
    /// once one is logged the choice stays, and a set and its record are never credited to a lift not done.
    /// Choosing the lift already chosen changes nothing.
    /// </summary>
    internal void SelectActuallyPerformedExercise(Guid exerciseId, string exerciseName)
    {
        if (exerciseId == ActualExerciseId)
        {
            return;
        }

        var backToPrescribed = exerciseId == PrescribedExerciseId;
        if (!backToPrescribed &&
            (ModificationPolicySnapshot != PrescriptionModificationPolicy.CoachApprovedSwap ||
             approvedAlternatives.All(item => item.ExerciseId != exerciseId)))
        {
            throw new InvalidOperationException("This prescription does not authorize the selected substitution.");
        }

        if (sets.Any(set => set.IsCompleted))
        {
            throw new WorkoutExerciseSwapLockedException(ActualExerciseName);
        }

        if (backToPrescribed)
        {
            ActualExerciseId = PrescribedExerciseId;
            ActualExerciseName = PrescribedExerciseName;
            WasSubstituted = false;
            return;
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
        LoadStrategySnapshot = prescription.LoadStrategy;
        PrescribedLoadStep = prescription.LoadStep;
        PrescribedTargetRpe = prescription.TargetRpe;
        PrescribedRestSeconds = prescription.RestSeconds;
        PrescribedTempo = prescription.Tempo;
        CoachNotesSnapshot = prescription.CoachNotes;
        CalculationStrategyKeySnapshot = prescription.CalculationStrategyKey;
        CalculationStrategyVersionSnapshot = prescription.CalculationStrategyVersion;
        UnroundedRecommendedLoadSnapshot = prescription.UnroundedRecommendedLoad;
    }

    private WorkoutSetPerformance(
        Guid tenantId,
        Guid workoutExercisePerformanceId,
        int position)
        : base(tenantId)
    {
        if (workoutExercisePerformanceId == Guid.Empty || position < 1)
        {
            throw new ArgumentException("The exercise and a position are required.");
        }

        WorkoutExercisePerformanceId = workoutExercisePerformanceId;
        Position = position;
        SetTypeSnapshot = TrainingSetType.Normal;
    }

    public Guid WorkoutExercisePerformanceId { get; private set; }

    /// <summary>The prescription it was started from; null on a workout of one's own, where nothing is prescribed.</summary>
    public Guid? SetPrescriptionId { get; private set; }

    public int Position { get; private set; }

    public TrainingSetType SetTypeSnapshot { get; private set; }

    public int? PrescribedRepetitionsMinimum { get; private set; }

    public int? PrescribedRepetitionsMaximum { get; private set; }

    public decimal? PrescribedLoad { get; private set; }

    public TrainingLoadUnit? PrescribedLoadUnit { get; private set; }

    /// <summary>The set's weight choice when the workout started; null on a workout started before N6a.</summary>
    public TrainingLoadStrategy? LoadStrategySnapshot { get; private set; }

    /// <summary>A last time + step set's step when the workout started (N6a); null on every other set.</summary>
    public decimal? PrescribedLoadStep { get; private set; }

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

    /// <summary>
    /// An empty set of a workout of one's own (TRN-033): an ordinary set with nothing prescribed, no weight choice and
    /// no calculation, so it holds only what is typed into it.
    /// </summary>
    internal static WorkoutSetPerformance CreateOwn(
        Guid tenantId,
        Guid workoutExercisePerformanceId,
        int position) =>
        new(tenantId, workoutExercisePerformanceId, position);

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

/// <summary>
/// A set is already logged under the lift being done, so the client cannot swap it for this workout (CLIENT-2):
/// the set would otherwise become another lift's set, and its record with it.
/// </summary>
public sealed class WorkoutExerciseSwapLockedException(string exerciseName)
    : InvalidOperationException(
        $"You logged a set as {exerciseName}, so this exercise stays {exerciseName} for this workout.")
{
    public const string Code = "substitution_after_logged_set";
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
