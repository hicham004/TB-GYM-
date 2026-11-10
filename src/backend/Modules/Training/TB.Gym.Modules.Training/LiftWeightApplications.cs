using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Training;

/// <summary>
/// One lift's weights a coach applied from where it stood (notes plan N6c, STR-020; decision 21: the coach applies,
/// never the app or the client), kept as it was applied: the rule and its version, the answer it read with last
/// time's logged sets, and per set the weight before and after. Who applied it and when are the row's own creation
/// stamps. Append-only, as Edit weeks' record is: a later apply or edit leaves this one as it was. It names the sets
/// and sessions by id only, with no foreign key to them, since Edit weeks replaces a changed session's rows.
/// </summary>
public sealed class LiftWeightApplication : TenantEntity
{
    /// <summary>The longest answer or set list kept; the rule's answer for one writing is a few kilobytes at most.</summary>
    public const int MaximumJsonLength = 64_000;

    private LiftWeightApplication()
    {
    }

    private LiftWeightApplication(
        Guid tenantId,
        Guid clientProfileId,
        Guid mesocycleId,
        Guid trainingSessionId,
        string sessionName,
        DateOnly sessionDate,
        Guid exercisePrescriptionId,
        Guid exerciseId,
        string exerciseName,
        int occurrence,
        LiftStanding standing,
        int setCount,
        Guid idempotencyKey,
        string requestFingerprint,
        string standingJson,
        string appliedSetsJson)
        : base(tenantId)
    {
        if (clientProfileId == Guid.Empty ||
            mesocycleId == Guid.Empty ||
            trainingSessionId == Guid.Empty ||
            exercisePrescriptionId == Guid.Empty ||
            exerciseId == Guid.Empty ||
            idempotencyKey == Guid.Empty ||
            occurrence < 1 ||
            setCount is < 1 or > 20 ||
            requestFingerprint is not { Length: 64 } ||
            requestFingerprint.Any(character => !char.IsAsciiHexDigitLower(character)))
        {
            throw new ArgumentException("The applied weight record is invalid.");
        }

        ClientProfileId = clientProfileId;
        MesocycleId = mesocycleId;
        TrainingSessionId = trainingSessionId;
        SessionName = TrainingText.Required(sessionName, 160, nameof(sessionName));
        SessionDate = sessionDate;
        ExercisePrescriptionId = exercisePrescriptionId;
        ExerciseId = exerciseId;
        ExerciseName = TrainingText.Required(exerciseName, 160, nameof(exerciseName));
        Occurrence = occurrence;
        RuleKey = LastTimeStepRule.Key;
        RuleVersion = LastTimeStepRule.Version;
        Outcome = standing.Outcome;
        ReasonKind = standing.Reason.Kind;
        LastTimeWorkoutExecutionId = standing.LastTime?.WorkoutExecutionId;
        LastTimeDay = standing.LastTime?.Day;
        JudgedOn = standing.JudgedOn;
        SetCount = setCount;
        IdempotencyKey = idempotencyKey;
        RequestFingerprint = requestFingerprint;
        StandingJson = TrainingText.Required(standingJson, MaximumJsonLength, nameof(standingJson));
        AppliedSetsJson = TrainingText.Required(appliedSetsJson, MaximumJsonLength, nameof(appliedSetsJson));
    }

    public Guid ClientProfileId { get; private set; }

    public Guid MesocycleId { get; private set; }

    public Guid TrainingSessionId { get; private set; }

    public string SessionName { get; private set; } = string.Empty;

    public DateOnly SessionDate { get; private set; }

    public Guid ExercisePrescriptionId { get; private set; }

    public Guid ExerciseId { get; private set; }

    public string ExerciseName { get; private set; } = string.Empty;

    /// <summary>Which writing of the lift in its session it is, the first by position being 1 (STR-019, line f).</summary>
    public int Occurrence { get; private set; }

    public string RuleKey { get; private set; } = string.Empty;

    public int RuleVersion { get; private set; }

    public LiftStandingOutcome Outcome { get; private set; }

    public LiftStandingReason ReasonKind { get; private set; }

    /// <summary>The finished workout the answer read as last time.</summary>
    public Guid? LastTimeWorkoutExecutionId { get; private set; }

    public DateOnly? LastTimeDay { get; private set; }

    /// <summary>The day the rule judged the lift on, in its program's calendar.</summary>
    public DateOnly JudgedOn { get; private set; }

    public int SetCount { get; private set; }

    public Guid IdempotencyKey { get; private set; }

    /// <summary>The whole request the key was used for (every lift of it), so a retry is told from another request.</summary>
    public string RequestFingerprint { get; private set; } = string.Empty;

    /// <summary>The rule's answer as the apply read it: the reason, last time's logged sets and every set's answer.</summary>
    public string StandingJson { get; private set; } = string.Empty;

    /// <summary>The sets it wrote: each set's id and place, its move, the weight before and after, the unit and the step.</summary>
    public string AppliedSetsJson { get; private set; } = string.Empty;

    public static LiftWeightApplication Record(
        Guid tenantId,
        Guid clientProfileId,
        LiftWeightTarget target,
        LiftStanding standing,
        IReadOnlyList<AppliedLiftSet> sets,
        Guid idempotencyKey,
        string requestFingerprint,
        string standingJson,
        string appliedSetsJson)
    {
        ArgumentNullException.ThrowIfNull(target);
        ArgumentNullException.ThrowIfNull(standing);
        ArgumentNullException.ThrowIfNull(sets);
        if (sets.Any(set => set.Move is not (SetStandingMove.StepUp or SetStandingMove.SameAsLastTime) ||
                            set.WeightAfter is <= 0m or > LastTimeStepRule.MaximumWeight ||
                            set.WeightAfter == set.WeightBefore) ||
            sets.Select(set => set.SetPrescriptionId).Distinct().Count() != sets.Count)
        {
            throw new ArgumentException("Each applied set moves once, to a new weight within the limit.", nameof(sets));
        }

        return new LiftWeightApplication(
            tenantId,
            clientProfileId,
            target.MesocycleId,
            target.TrainingSessionId,
            target.SessionName,
            target.SessionDate,
            target.ExercisePrescriptionId,
            target.ExerciseId,
            target.ExerciseName,
            target.Occurrence,
            standing,
            sets.Count,
            idempotencyKey,
            requestFingerprint,
            standingJson,
            appliedSetsJson);
    }
}

/// <summary>The writing of a lift an apply wrote to: its coming session (STR-019) and its place there.</summary>
public sealed record LiftWeightTarget(
    Guid MesocycleId,
    Guid TrainingSessionId,
    string SessionName,
    DateOnly SessionDate,
    Guid ExercisePrescriptionId,
    Guid ExerciseId,
    string ExerciseName,
    int Occurrence);

/// <summary>One set an apply wrote: what the answer did with it, the weight before and after, in its own unit.</summary>
/// <param name="Step">The set's step, which an apply never changes.</param>
public sealed record AppliedLiftSet(
    Guid SetPrescriptionId,
    int SetNumber,
    SetStandingMove Move,
    decimal? WeightBefore,
    decimal WeightAfter,
    TrainingLoadUnit Unit,
    decimal Step);

/// <summary>
/// The client's line from an applied weight (notes plan N6c, STR-020): what the coach did with last time's sets,
/// in the client's own numbers. A step up names each stepped set's rise and last time's working sets and reps; a
/// weight kept names why it held (STR-019). Built from what the apply recorded, never from the client's reads: the
/// answer's own move, so a step up whose stepped sets already held their weights (only a carried set was written)
/// still reads as the step it is.
/// </summary>
public static class LiftWeightNotes
{
    /// <summary>
    /// The weight each set must still hold for the line to be true: what the apply wrote, and the answer's stepped
    /// sets, written or already at their step.
    /// </summary>
    public static IReadOnlyDictionary<Guid, decimal> HeldWeights(LiftStandingView applied, IReadOnlyList<AppliedLiftSet> sets)
    {
        ArgumentNullException.ThrowIfNull(applied);
        ArgumentNullException.ThrowIfNull(sets);
        var held = applied.Standing.Sets
            .Where(set => set.Move == SetStandingMove.StepUp && set.Weight is > 0m)
            .ToDictionary(set => set.SetPrescriptionId, set => set.Weight!.Value);
        foreach (var set in sets)
        {
            held[set.SetPrescriptionId] = set.WeightAfter;
        }

        return held;
    }

    public static ClientWeightNoteView? For(LiftStandingView applied, IReadOnlyList<AppliedLiftSet> sets)
    {
        ArgumentNullException.ThrowIfNull(applied);
        ArgumentNullException.ThrowIfNull(sets);
        if (applied.Standing.LastTime is not { } last || sets.Count == 0)
        {
            return null;
        }

        var stepped = applied.Standing.Outcome == LiftStandingOutcome.StepUp
            ? applied.Standing.Sets.Where(set => set.Move == SetStandingMove.StepUp).OrderBy(set => set.SetNumber).ToArray()
            : [];
        var working = last.Sets.Where(set => set.SetType != TrainingSetType.WarmUp).ToArray();
        var asked = working.Select(set => set.RepetitionsAsked).Distinct().ToArray();
        return new ClientWeightNoteView(
            stepped.Length > 0 ? SetStandingMove.StepUp : SetStandingMove.SameAsLastTime,
            stepped.Select(set => set.Step).ToArray(),
            sets[0].Unit,
            last.Day,
            working.Length,
            asked is [{ } reps] ? reps : null,
            stepped.Length > 0 ? null : applied.Standing.Reason,
            applied.ExertionDisplay);
    }
}
