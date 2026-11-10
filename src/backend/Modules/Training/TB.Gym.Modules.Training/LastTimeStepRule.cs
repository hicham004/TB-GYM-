namespace TB.Gym.Modules.Training;

/// <summary>
/// Where a lift stands, <c>LastTimeStep</c> v1 (notes plan N6b, STR-019, ADR 0040; decisions 20 to 22 of 5 and
/// 7 Nov 2026). For one writing of a lift with "Last time + step" sets in its coming session (TRN-032) it reads
/// the client's workouts of that lift, from any program, and answers per set the weight the coach may apply next
/// (that set's last logged weight plus its step, exact) or a hold and its reason. It only reads: the coach applies
/// (decision 21), so nothing here changes a weight, and kilograms and pounds are never converted.
/// </summary>
public static class LastTimeStepRule
{
    public const string Key = "LastTimeStep";
    public const int Version = 1;

    /// <summary>The version as a set's calculation keeps it beside <see cref="Key"/> once a coach applies it (N6c).</summary>
    public const string VersionName = "1";

    /// <summary>Line (b): last time is within this many days of today, its day counted in the program's calendar.</summary>
    public const int LookbackDays = 14;

    /// <summary>Line (e): a logged weight further than this share from the weight before it looks like a typo.</summary>
    public const decimal TypoShare = 0.25m;

    /// <summary>The heaviest weight a set can hold (TRN-025, TRN-032): a step past it holds the set.</summary>
    public const decimal MaximumWeight = 2_000m;

    /// <summary>
    /// The answer for <paramref name="coming"/>, judged on <paramref name="today"/> (the program's day).
    /// <paramref name="history"/> holds the client's writings of the lift in finished and running workouts, any
    /// program, each with its occurrence in its workout; writings of other occurrences are read only to find
    /// last time (line f: a writing is matched only to the same occurrence).
    /// </summary>
    public static LiftStanding Read(ComingLift coming, IEnumerable<LoggedLift> history, DateOnly today)
    {
        ArgumentNullException.ThrowIfNull(coming);
        ArgumentNullException.ThrowIfNull(history);
        if (coming.Sets.Count == 0)
        {
            throw new ArgumentException("A coming lift needs at least one step set.", nameof(coming));
        }

        // Line (d): last time is the latest workout of the lift by its day, whatever its program or session name.
        var writings = history
            .Where(item => item.Day <= coming.SessionDate)
            .OrderBy(item => item.Day)
            .ThenBy(item => item.StartedAtUtc)
            .ThenBy(item => item.WorkoutExecutionId)
            .ThenBy(item => item.Occurrence)
            .ToArray();
        if (writings.Length == 0)
        {
            return Own(coming, today, Reason(LiftStandingReason.NeverDone), null);
        }

        var latest = writings[^1];
        if (latest.Day < today.AddDays(-LookbackDays))
        {
            return Own(coming, today, Reason(LiftStandingReason.LastDoneTooLongAgo, latest.Day,
                workoutExecutionId: latest.WorkoutExecutionId), null);
        }

        // Line (g): a workout still running is not last time.
        if (latest.Status != WorkoutExecutionStatus.Completed)
        {
            return Own(coming, today, Reason(LiftStandingReason.WorkoutInProgress, latest.Day,
                workoutExecutionId: latest.WorkoutExecutionId), null);
        }

        var writing = writings.LastOrDefault(item =>
            item.WorkoutExecutionId == latest.WorkoutExecutionId && item.Occurrence == coming.Occurrence);
        if (writing is null)
        {
            return Own(coming, today, Reason(LiftStandingReason.NoMatchLastTime, latest.Day), null);
        }

        var lastTime = new LiftLastTime(writing.WorkoutExecutionId, writing.Day,
            writing.Sets.OrderBy(item => item.SetNumber).ToArray());
        var logged = lastTime.Sets.Where(item => item.IsCompleted && item.Weight is not null).ToArray();

        // A weight logged in the other unit counts for nothing and holds the lift.
        var otherUnit = logged.FirstOrDefault(item => item.Unit != UnitFor(coming, item.SetNumber));
        if (otherUnit is not null)
        {
            return Own(coming, today, Reason(LiftStandingReason.LoggedInOtherUnit, writing.Day,
                setNumber: otherUnit.SetNumber, weight: otherUnit.Weight, unit: otherUnit.Unit), lastTime);
        }

        // Line (e): the typo guard, set by set against that set's earlier logs of the same writing.
        var earlier = writings
            .Where(item => item.Status == WorkoutExecutionStatus.Completed && item.Occurrence == coming.Occurrence)
            .ToArray();
        foreach (var set in logged)
        {
            var guard = TypoGuard(earlier, set.SetNumber, set.Unit!.Value);
            if (!guard.Accepted)
            {
                return Own(coming, today, Reason(LiftStandingReason.LooksLikeTypo, writing.Day,
                    setNumber: set.SetNumber, weight: set.Weight, earlierWeight: guard.Reference, unit: set.Unit),
                    lastTime);
            }
        }

        // Lines (a) and (h): every working set logged with typed reps at or above what that workout asked.
        var working = lastTime.Sets.Where(item => item.SetType != TrainingSetType.WarmUp).ToArray();
        foreach (var set in working)
        {
            if (!set.IsCompleted)
            {
                return SameAsLastTime(coming, today, lastTime, earlier,
                    Reason(LiftStandingReason.SetNotLogged, writing.Day, setNumber: set.SetNumber));
            }

            if (set.Repetitions is not { } reps)
            {
                return SameAsLastTime(coming, today, lastTime, earlier,
                    Reason(LiftStandingReason.NoRepsTyped, writing.Day, setNumber: set.SetNumber));
            }

            if (set.RepetitionsAsked is { } asked && reps < asked)
            {
                return SameAsLastTime(coming, today, lastTime, earlier,
                    Reason(LiftStandingReason.RepsShort, writing.Day, setNumber: set.SetNumber,
                        repetitions: reps, repetitionsAsked: asked));
            }
        }

        // Line (c): a working set the client rated harder than the coach's target; no rating is no hold.
        var harder = working.FirstOrDefault(item => item is { TargetRpe: { } target, Rpe: { } rpe } && rpe > target);
        if (harder is not null)
        {
            return SameAsLastTime(coming, today, lastTime, earlier,
                Reason(LiftStandingReason.HarderThanPlanned, writing.Day, setNumber: harder.SetNumber,
                    rpe: harder.Rpe, targetRpe: harder.TargetRpe));
        }

        // Line (i): each set moves by its own number; a set with nothing to step from keeps its weight and says why.
        // A warm-up is never judged in (a), but its own step still needs its reps typed (decision 22).
        var sets = coming.Sets.OrderBy(item => item.SetNumber).Select(set =>
        {
            var match = lastTime.Sets.FirstOrDefault(item => item.SetNumber == set.SetNumber);
            if (match is null)
            {
                return Unchanged(set, SetStandingNote.NewSet);
            }

            if (!match.IsCompleted || match.Weight is not { } weight)
            {
                return Kept(set, earlier, today, SetStandingNote.NoWeightLogged);
            }

            if (match.Repetitions is null)
            {
                return Kept(set, earlier, today, SetStandingNote.NoRepsTyped);
            }

            var next = weight + set.Step;
            return next > MaximumWeight
                ? new SetStanding(set.SetPrescriptionId, set.SetNumber, SetStandingMove.SameAsLastTime, weight,
                    set.Weight, set.Unit, set.Step, SetStandingNote.AboveLimit)
                : new SetStanding(set.SetPrescriptionId, set.SetNumber, SetStandingMove.StepUp, next,
                    set.Weight, set.Unit, set.Step, SetStandingNote.None);
        }).ToArray();
        if (sets.Any(item => item.Move == SetStandingMove.StepUp))
        {
            return new LiftStanding(LiftStandingOutcome.StepUp,
                Reason(LiftStandingReason.EverySetDone, writing.Day), lastTime, sets, today);
        }

        // Nothing could step: the sets' notes say why, a missing weight first, then missing reps.
        var note = sets.Any(item => item.Note == SetStandingNote.NoWeightLogged) ? SetStandingNote.NoWeightLogged
            : sets.Any(item => item.Note == SetStandingNote.NoRepsTyped) ? SetStandingNote.NoRepsTyped
            : sets.Any(item => item.Note == SetStandingNote.AboveLimit) ? SetStandingNote.AboveLimit
            : SetStandingNote.NewSet;
        var kind = note switch
        {
            SetStandingNote.NoWeightLogged => LiftStandingReason.NoWeightLogged,
            SetStandingNote.NoRepsTyped => LiftStandingReason.NoRepsTyped,
            SetStandingNote.AboveLimit => LiftStandingReason.AboveLimit,
            _ => LiftStandingReason.NoMatchLastTime,
        };
        int? named = note == SetStandingNote.NewSet ? null : sets.First(item => item.Note == note).SetNumber;
        return new LiftStanding(LiftStandingOutcome.Hold, Reason(kind, writing.Day, setNumber: named), lastTime,
            sets, today);
    }

    /// <summary>
    /// What applying an answer writes (notes plan N6c, STR-020): each set the answer moves to a weight it does not
    /// have yet, last time's weight plus its step or last time's weight kept (line d). A set that keeps its own
    /// weight, or already has the answer's, is left alone, so a hold that keeps every set's own weight applies
    /// nothing and applying twice writes nothing the second time. A weight of 0 (a set carried on from a log of
    /// 0 kg) is no weight to apply, so that set keeps its own.
    /// </summary>
    public static IReadOnlyList<SetStanding> SetsToApply(LiftStanding standing)
    {
        ArgumentNullException.ThrowIfNull(standing);
        return standing.Sets
            .Where(set => (set.Move is SetStandingMove.StepUp or SetStandingMove.SameAsLastTime) &&
                          set.Weight is { } weight && weight > 0m && weight != set.CurrentWeight)
            .OrderBy(set => set.SetNumber)
            .ToArray();
    }

    /// <summary>
    /// Why an applied set holds its weight, kept on the set beside the rule's key and version (STR-020): the weight
    /// the answer started from and what it did with it. Plain words for the record; screens say it their own way.
    /// </summary>
    public static string Explain(LiftStanding standing, SetStanding set)
    {
        ArgumentNullException.ThrowIfNull(standing);
        ArgumentNullException.ThrowIfNull(set);
        var unit = set.Unit == TrainingLoadUnit.Pound ? "lb" : "kg";
        var day = standing.LastTime?.Day.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
        string Weight(decimal value) =>
            $"{value.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture)} {unit}";
        var weight = set.Weight ?? throw new ArgumentException("An applied set names its weight.", nameof(set));
        return set switch
        {
            { Move: SetStandingMove.StepUp } =>
                $"{Weight(weight - set.Step)} logged on {day} plus the {Weight(set.Step)} step ({Key} v{Version}), applied by the coach.",
            { Note: SetStandingNote.AboveLimit } =>
                $"{Weight(weight)} logged on {day}, kept as a step would pass {Weight(MaximumWeight)} ({Key} v{Version}), applied by the coach.",
            { Note: SetStandingNote.None } =>
                $"{Weight(weight)} logged on {day}, kept ({Key} v{Version}), applied by the coach.",
            _ =>
                $"{Weight(weight)}, the set's latest log that stood, carried on ({Key} v{Version}), applied by the coach.",
        };
    }

    /// <summary>
    /// Line (e) for one set: walks that set's logs, oldest first (finished workouts only, in its unit), and says
    /// whether the last one stands, what it was compared with, and the latest log that stood. A log stands when
    /// there is nothing before it (or only 0), or it is within <see cref="TypoShare"/> of the latest earlier log
    /// that stood, so one typo holds once and the next sensible log steps again, or of the weight that workout
    /// asked for the set: what the coach wrote, an applied step or the client's nearest weight is never a typo.
    /// A typo logged again (the player starts the box at last time's weight) holds again, as does a sensible log
    /// after a first log that was a typo, until a workout logs the set near a weight the coach typed with Edit
    /// weeks (line e). Also returns the latest log that stood and its day, for carrying a weight on.
    /// </summary>
    private static (bool Accepted, decimal? Reference, decimal? Stood, DateOnly? StoodOn) TypoGuard(
        IReadOnlyList<LoggedLift> writings,
        int setNumber,
        TrainingLoadUnit unit)
    {
        decimal? reference = null;
        DateOnly? referenceDay = null;
        var accepted = true;
        decimal? compared = null;
        foreach (var writing in writings)
        {
            var set = writing.Sets.FirstOrDefault(item => item.SetNumber == setNumber);
            if (set is not { IsCompleted: true, Weight: { } weight } || set.Unit != unit)
            {
                continue;
            }

            var asked = set.PrescribedUnit == unit ? set.PrescribedWeight : null;
            compared = reference;
            accepted = reference is not { } earlier || earlier == 0m || Near(weight, earlier) ||
                       asked is { } prescribed && Near(weight, prescribed);
            if (accepted)
            {
                reference = weight;
                referenceDay = writing.Day;
            }
        }

        return (accepted, compared, reference, referenceDay);
    }

    /// <summary>
    /// A coming set whose match last time gives no weight to step from (none logged, or no reps typed): it carries
    /// on the set's latest log that stood (line d), when that was logged within <see cref="LookbackDays"/> of today
    /// as line (b) asks of last time; otherwise it keeps its own weight. Either way the note says why.
    /// </summary>
    private static SetStanding Kept(
        ComingStepSet set,
        IReadOnlyList<LoggedLift> earlier,
        DateOnly today,
        SetStandingNote note)
    {
        var guard = TypoGuard(earlier, set.SetNumber, set.Unit);
        return guard is { Stood: { } carried, StoodOn: { } day } && day >= today.AddDays(-LookbackDays)
            ? new SetStanding(set.SetPrescriptionId, set.SetNumber, SetStandingMove.SameAsLastTime, carried,
                set.Weight, set.Unit, set.Step, note)
            : Unchanged(set, note);
    }

    private static bool Near(decimal weight, decimal earlier) => Math.Abs(weight - earlier) <= TypoShare * earlier;

    private static TrainingLoadUnit UnitFor(ComingLift coming, int setNumber) =>
        (coming.Sets.FirstOrDefault(item => item.SetNumber == setNumber) ??
         coming.Sets.OrderBy(item => item.SetNumber).First()).Unit;

    /// <summary>A hold on which every coming set keeps its own weight (line d's exceptions).</summary>
    private static LiftStanding Own(ComingLift coming, DateOnly today, LiftStandingReasonDetail reason, LiftLastTime? lastTime) =>
        new(LiftStandingOutcome.Hold, reason, lastTime,
            coming.Sets.OrderBy(item => item.SetNumber).Select(set => Unchanged(set, SetStandingNote.None)).ToArray(),
            today);

    /// <summary>
    /// A hold of line (a) or (c): each set stays at last time's logged weight (line d), carried on. A set last time
    /// left without a weight (not logged, or the lift skipped) carries on its latest earlier log that stood when
    /// that is within the lookback (<see cref="Kept"/>), so a skipped lift never drops a new program back to its
    /// starting weight; otherwise it keeps its own.
    /// </summary>
    private static LiftStanding SameAsLastTime(ComingLift coming, DateOnly today, LiftLastTime lastTime,
        IReadOnlyList<LoggedLift> earlier, LiftStandingReasonDetail reason) =>
        new(LiftStandingOutcome.Hold, reason, lastTime,
            coming.Sets.OrderBy(item => item.SetNumber).Select(set =>
            {
                var match = lastTime.Sets.FirstOrDefault(item => item.SetNumber == set.SetNumber);
                if (match is null)
                {
                    return Unchanged(set, SetStandingNote.NewSet);
                }

                return match is { IsCompleted: true, Weight: { } weight } && match.Unit == set.Unit
                    ? new SetStanding(set.SetPrescriptionId, set.SetNumber, SetStandingMove.SameAsLastTime,
                        weight, set.Weight, set.Unit, set.Step, SetStandingNote.None)
                    : Kept(set, earlier, today, SetStandingNote.NoWeightLogged);
            }).ToArray(),
            today);

    private static SetStanding Unchanged(ComingStepSet set, SetStandingNote note) =>
        new(set.SetPrescriptionId, set.SetNumber, SetStandingMove.Unchanged, set.Weight, set.Weight, set.Unit,
            set.Step, note);

    private static LiftStandingReasonDetail Reason(
        LiftStandingReason kind,
        DateOnly? day = null,
        int? setNumber = null,
        int? repetitions = null,
        int? repetitionsAsked = null,
        decimal? rpe = null,
        decimal? targetRpe = null,
        decimal? weight = null,
        decimal? earlierWeight = null,
        TrainingLoadUnit? unit = null,
        Guid? workoutExecutionId = null) =>
        new(kind, day, setNumber, repetitions, repetitionsAsked, rpe, targetRpe, weight, earlierWeight, unit,
            workoutExecutionId);
}

/// <summary>One writing of a lift in its coming session, as <see cref="LastTimeStepRule"/> reads it.</summary>
/// <param name="ExerciseId">The lift.</param>
/// <param name="Occurrence">Which writing of the lift in the session it is, the first by position being 1 (line f).</param>
/// <param name="SessionDate">The coming session's day: workouts after it are never last time.</param>
/// <param name="Sets">The writing's "Last time + step" sets.</param>
public sealed record ComingLift(Guid ExerciseId, int Occurrence, DateOnly SessionDate, IReadOnlyList<ComingStepSet> Sets);

/// <param name="SetNumber">The set's place among all the writing's sets by position, the first being 1 (line i).</param>
/// <param name="Step">The set's step, in <paramref name="Unit"/>.</param>
/// <param name="Weight">The set's own weight: its starting weight or what the coach last applied; null when the client picks.</param>
public sealed record ComingStepSet(Guid SetPrescriptionId, int SetNumber, decimal Step, TrainingLoadUnit Unit, decimal? Weight);

/// <summary>One writing of the lift in one of the client's workouts, finished or still running.</summary>
/// <param name="Day">The workout's scheduled day, in its program's calendar.</param>
/// <param name="Occurrence">Which writing of the lift done in that workout it is, the first by position being 1.</param>
public sealed record LoggedLift(
    Guid WorkoutExecutionId,
    DateOnly Day,
    WorkoutExecutionStatus Status,
    DateTimeOffset StartedAtUtc,
    int Occurrence,
    IReadOnlyList<LoggedSet> Sets);

/// <summary>One set of a logged writing: what that workout asked and what the client logged.</summary>
/// <param name="SetNumber">The set's place among the writing's sets by position, the first being 1.</param>
/// <param name="RepetitionsAsked">The reps that workout asked: the top of a range, a fixed target itself (line h).</param>
/// <param name="TargetRpe">The effort that workout asked, as RPE (RIR is kept as 10 minus RPE).</param>
/// <param name="PrescribedWeight">The weight that workout asked, in <paramref name="PrescribedUnit"/>.</param>
/// <param name="Repetitions">The reps the client typed; null when none were typed, which never counts (decision 22).</param>
public sealed record LoggedSet(
    int SetNumber,
    TrainingSetType SetType,
    int? RepetitionsAsked,
    decimal? TargetRpe,
    decimal? PrescribedWeight,
    TrainingLoadUnit? PrescribedUnit,
    bool IsCompleted,
    int? Repetitions,
    decimal? Weight,
    TrainingLoadUnit? Unit,
    decimal? Rpe);

/// <summary>
/// The rule's answer for one writing: step up or hold, the reason with what it names, last time's sets (null when
/// no finished workout is last time) and each coming step set's weight, judged on <paramref name="JudgedOn"/>.
/// </summary>
public sealed record LiftStanding(
    LiftStandingOutcome Outcome,
    LiftStandingReasonDetail Reason,
    LiftLastTime? LastTime,
    IReadOnlyList<SetStanding> Sets,
    DateOnly JudgedOn);

/// <summary>Last time: the finished workout the answer read, its day and the writing's sets.</summary>
public sealed record LiftLastTime(Guid WorkoutExecutionId, DateOnly Day, IReadOnlyList<LoggedSet> Sets);

/// <summary>Why the lift steps up or holds, with what the reason names.</summary>
/// <param name="Day">Last time's day, the running workout's (line g) or the last one done (line b).</param>
/// <param name="SetNumber">The set the reason names.</param>
/// <param name="Weight">A typo's logged weight (line e), or a weight logged in <paramref name="Unit"/>, the other unit.</param>
/// <param name="EarlierWeight">The weight a typo was compared with: the latest earlier log of the set that stood.</param>
/// <param name="WorkoutExecutionId">The workout a hold of line (b) or (g) names: the last one done, or the one running.</param>
public sealed record LiftStandingReasonDetail(
    LiftStandingReason Kind,
    DateOnly? Day,
    int? SetNumber,
    int? Repetitions,
    int? RepetitionsAsked,
    decimal? Rpe,
    decimal? TargetRpe,
    decimal? Weight,
    decimal? EarlierWeight,
    TrainingLoadUnit? Unit,
    Guid? WorkoutExecutionId);

/// <summary>One coming step set's answer.</summary>
/// <param name="Weight">
/// The weight the answer names: last time's plus the step, last time's own, the set's latest log that stood within
/// the lookback when last time gave none, or the set's own (null when the client picks).
/// </param>
/// <param name="CurrentWeight">The set's own weight now, so a reader sees whether the answer changes it.</param>
public sealed record SetStanding(
    Guid SetPrescriptionId,
    int SetNumber,
    SetStandingMove Move,
    decimal? Weight,
    decimal? CurrentWeight,
    TrainingLoadUnit Unit,
    decimal Step,
    SetStandingNote Note);

public enum LiftStandingOutcome
{
    StepUp = 1,
    Hold = 2,
}

public enum LiftStandingReason
{
    /// <summary>Every working set reached its reps, no harder than planned: the step.</summary>
    EverySetDone = 1,

    /// <summary>No workout of the client's holds the lift yet.</summary>
    NeverDone = 2,

    /// <summary>Line (b): the last workout of the lift is more than <see cref="LastTimeStepRule.LookbackDays"/> days old.</summary>
    LastDoneTooLongAgo = 3,

    /// <summary>Line (g): the last workout of the lift is still running.</summary>
    WorkoutInProgress = 4,

    /// <summary>Line (f): last time's workout held the lift, but not this writing of it.</summary>
    NoMatchLastTime = 5,

    /// <summary>A weight was logged in the other unit than the set's.</summary>
    LoggedInOtherUnit = 6,

    /// <summary>Line (e): a logged weight more than 25% away from the weight before it.</summary>
    LooksLikeTypo = 7,

    /// <summary>Line (a): a working set was not logged.</summary>
    SetNotLogged = 8,

    /// <summary>
    /// Line (a): a working set was logged with no reps typed (decision 22); or, every set done, no set could step
    /// because its own match had no reps typed.
    /// </summary>
    NoRepsTyped = 9,

    /// <summary>Line (a): a working set fell short of the reps that workout asked.</summary>
    RepsShort = 10,

    /// <summary>Line (c): a working set was rated harder than the coach's target.</summary>
    HarderThanPlanned = 11,

    /// <summary>Every set was done, but none has a weight to step from.</summary>
    NoWeightLogged = 12,

    /// <summary>Every set was done, but a step would pass <see cref="LastTimeStepRule.MaximumWeight"/>.</summary>
    AboveLimit = 13,
}

public enum SetStandingMove
{
    /// <summary>Last time's logged weight plus the set's step.</summary>
    StepUp = 1,

    /// <summary>
    /// Last time's logged weight, carried on (line d); or, when last time gave the set none to step from, its latest
    /// log that stood within <see cref="LastTimeStepRule.LookbackDays"/>, with a note saying why.
    /// </summary>
    SameAsLastTime = 2,

    /// <summary>The set's own weight.</summary>
    Unchanged = 3,
}

public enum SetStandingNote
{
    None = 1,

    /// <summary>Line (i): last time's writing had no set at this place.</summary>
    NewSet = 2,

    /// <summary>The matching set was not logged with a weight last time.</summary>
    NoWeightLogged = 3,

    /// <summary>A step would pass <see cref="LastTimeStepRule.MaximumWeight"/>.</summary>
    AboveLimit = 4,

    /// <summary>
    /// The matching set (a warm-up, never judged in line a) was logged with a weight but no reps typed, so it
    /// never counts (decision 22): the set does not step, and keeps the weight it logged (carried on, line d).
    /// </summary>
    NoRepsTyped = 5,
}
