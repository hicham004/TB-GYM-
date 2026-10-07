using System.Globalization;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Training;

/// <summary>
/// Editing a client's weeks in the builder's grid (TRN-028, P3b, ADR 0036). A session is open while it has not
/// started and is not before today, the same line as replacing one (TRN-004) and updating training maxes
/// (STR-011). The weeks up to the last one that holds a session that is not open keep their place; the weeks
/// after them can be added, removed, moved and copied.
/// </summary>
public static class ProgramEditRules
{
    public const string Key = "GridEdit";
    public const string CurrentVersion = "1.0";
    public const int MaximumWeeks = 52;
    public const int MaximumSessionsPerWeek = 14;
    public const int MaximumLabelLength = 120;

    /// <summary>A session the coach may still change: not started, and not before today in the workspace.</summary>
    public static bool IsOpen(TrainingSession session, DateOnly today) =>
        !session.HasStarted && session.ScheduledDate >= today;

    /// <summary>
    /// Checks a built prescription against the rules every stored session obeys (a name, up to 40 exercises,
    /// 1 to 20 sets each, every set's limits), without storing anything, so a preview refuses what applying it
    /// would refuse. Throws <see cref="ArgumentException"/>.
    /// </summary>
    public static void EnsureValid(TrainingSessionBlueprint blueprint)
    {
        ArgumentNullException.ThrowIfNull(blueprint);
        _ = TrainingSession.Create(Guid.NewGuid(), Guid.NewGuid(), new DateOnly(2000, 1, 3), 0, blueprint);
    }

    /// <summary>
    /// How many weeks, counted from the first, keep their place: up to and including the last week that holds
    /// a session that is not open. Their open sessions can still change, but the weeks cannot move or go.
    /// </summary>
    public static int FrozenWeekCount(IReadOnlyList<MesocycleWeek> weeksInOrder, DateOnly today)
    {
        ArgumentNullException.ThrowIfNull(weeksInOrder);
        var frozen = 0;
        for (var index = 0; index < weeksInOrder.Count; index++)
        {
            if (weeksInOrder[index].Sessions.Any(session => !IsOpen(session, today)))
            {
                frozen = index + 1;
            }
        }

        return frozen;
    }
}

public enum ProgramEditChangeKind
{
    Added = 1,
    Edited = 2,
    Moved = 3,
    Removed = 4,
}

/// <summary>What happens to one requested session's row (TRN-028).</summary>
public enum ProgramEditDisposition
{
    /// <summary>The row stays exactly as it is.</summary>
    Keep = 1,

    /// <summary>The same row, with its prescription (and day) replaced.</summary>
    Replace = 2,

    /// <summary>A new row, in a week that stays or in a new one; the row it came from, if any, goes.</summary>
    Create = 3,
}

/// <param name="Key">The session's place in the request, which names its blueprint.</param>
/// <param name="Existing">The stored session this one comes from, if any.</param>
/// <param name="ContentChanged">The prescription, name, notes or day differs from the stored session's.</param>
public sealed record PlannedSession(
    int Key,
    TrainingSession? Existing,
    ProgramEditDisposition Disposition,
    TrainingSessionRequest Request,
    int Position,
    DateOnly Date,
    bool ContentChanged)
{
    /// <summary>Whether the server must build and calculate a prescription for this session.</summary>
    public bool NeedsBlueprint => Disposition != ProgramEditDisposition.Keep;
}

/// <param name="Source">The stored week this one comes from; null for a new week.</param>
public sealed record PlannedWeek(
    int Number,
    DateOnly StartsOn,
    MesocycleWeek? Source,
    string? Label,
    bool IsPublished,
    IReadOnlyList<PlannedSession> Sessions)
{
    /// <summary>The stored row stays where it is (same week number); otherwise the week is built as a new row.</summary>
    public bool KeepsRow => Source is not null && Source.WeekNumber == Number;
}

/// <summary>One session that is added, edited, moved or removed, for the preview and the audit record.</summary>
public sealed record ProgramEditSessionChange(
    ProgramEditChangeKind Kind,
    TrainingSession? Existing,
    int? PlannedKey,
    int WeekNumber,
    DateOnly Date,
    int? PreviousWeekNumber,
    DateOnly? PreviousDate,
    string Name,
    bool WeekIsShared);

/// <summary>One week that is added, moved, removed or renamed or shared differently.</summary>
public sealed record ProgramEditWeekChange(
    ProgramEditChangeKind Kind,
    int WeekNumber,
    int? PreviousWeekNumber,
    string? Label,
    bool IsShared);

/// <summary>
/// What a requested grid would do to a program, worked out from the stored weeks alone (no calculation, no
/// database): which sessions and weeks stay, change, move, appear or go. The application service builds and
/// calculates the prescriptions the plan names, and <see cref="TrainingMesocycle.ApplyProgramEdit"/> carries it out.
/// </summary>
public sealed record ProgramEditPlan(
    DateOnly Today,
    int FrozenWeekCount,
    IReadOnlyList<PlannedWeek> Weeks,
    IReadOnlyList<MesocycleWeek> RemovedWeeks,
    IReadOnlyList<TrainingSession> RemovedSessions,
    IReadOnlyList<ProgramEditWeekChange> WeekChanges,
    IReadOnlyList<ProgramEditSessionChange> SessionChanges)
{
    public bool HasChanges => WeekChanges.Count > 0 || SessionChanges.Count > 0;

    public int WeeksAdded => WeekChanges.Count(item => item.Kind == ProgramEditChangeKind.Added);

    public int WeeksMoved => WeekChanges.Count(item => item.Kind == ProgramEditChangeKind.Moved);

    public int WeeksRemoved => WeekChanges.Count(item => item.Kind == ProgramEditChangeKind.Removed);

    public int SessionsAdded => SessionChanges.Count(item => item.Kind == ProgramEditChangeKind.Added);

    public int SessionsEdited => SessionChanges.Count(item => item.Kind == ProgramEditChangeKind.Edited);

    public int SessionsMoved => SessionChanges.Count(item => item.Kind == ProgramEditChangeKind.Moved);

    public int SessionsRemoved => SessionChanges.Count(item => item.Kind == ProgramEditChangeKind.Removed);

    public DateOnly ResultingEndDateExclusive(DateOnly startDate) => startDate.AddDays(checked(Weeks.Count * 7));
}

/// <summary>The rows <see cref="TrainingMesocycle.ApplyProgramEdit"/> made or took away, for the context to track.</summary>
public sealed record ProgramEditApplied(
    IReadOnlyList<MesocycleWeek> AddedWeeks,
    IReadOnlyList<MesocycleWeek> RemovedWeeks,
    IReadOnlyList<TrainingSession> AddedSessions,
    IReadOnlyList<TrainingSession> RemovedSessions,
    IReadOnlyList<TrainingSession> ReplacedSessions);

public static class ProgramEditPlanner
{
    /// <summary>
    /// Plans the grid the coach sent: every open session of every week, in the order the coach wants them.
    /// Sessions that are not open are never in the request, and are never touched. Anything the rule does not
    /// allow throws <see cref="ArgumentException"/> with a sentence the coach can read.
    /// </summary>
    public static ProgramEditPlan Plan(
        TrainingMesocycle mesocycle,
        IReadOnlyList<ProgramEditWeekRequest> requested,
        DateOnly today)
    {
        ArgumentNullException.ThrowIfNull(mesocycle);
        ArgumentNullException.ThrowIfNull(requested);
        if (mesocycle.Status is MesocycleStatus.Completed or MesocycleStatus.Cancelled)
        {
            throw new InvalidOperationException("Completed or cancelled mesocycle history is immutable.");
        }

        if (requested.Count is < 1 or > ProgramEditRules.MaximumWeeks)
        {
            throw new ArgumentException($"A program has 1 to {ProgramEditRules.MaximumWeeks} weeks.");
        }

        var existing = mesocycle.Weeks.OrderBy(item => item.WeekNumber).ToArray();
        var frozen = ProgramEditRules.FrozenWeekCount(existing, today);
        if (requested.Count < frozen)
        {
            throw new ArgumentException(
                $"Weeks up to week {frozen} have sessions that started or passed, so they stay in the program.");
        }

        var weekById = existing.ToDictionary(item => item.Id);
        var sessionById = existing.SelectMany(week => week.Sessions).ToDictionary(item => item.Id);
        var weekNumberOfSession = existing
            .SelectMany(week => week.Sessions.Select(session => (session.Id, week.WeekNumber)))
            .ToDictionary(item => item.Id, item => item.WeekNumber);

        var usedWeeks = new HashSet<Guid>();
        var referencedSessions = new HashSet<Guid>();
        var removedSessions = new Dictionary<Guid, TrainingSession>();
        var plannedWeeks = new List<PlannedWeek>(requested.Count);
        var key = 0;
        for (var index = 0; index < requested.Count; index++)
        {
            var number = index + 1;
            var week = requested[index] ?? throw new ArgumentException("A week is missing from the request.");
            var source = ResolveWeek(week, number, frozen, weekById, usedWeeks);
            var label = CleanLabel(week.Label, number);
            var startsOn = mesocycle.StartDate.AddDays(checked(7 * index));
            var kept = source is not null && source.WeekNumber == number ? source : null;
            var locked = kept?.Sessions.Where(item => !ProgramEditRules.IsOpen(item, today)).ToArray() ?? [];
            var items = week.Sessions ?? [];
            if (locked.Length + items.Count > ProgramEditRules.MaximumSessionsPerWeek)
            {
                throw new ArgumentException(
                    $"Week {number} holds up to {ProgramEditRules.MaximumSessionsPerWeek} sessions.");
            }

            // A kept session stays where it is in the week only while the sessions before it, new ones
            // included, take lower places; otherwise it is built again after them. Sessions that are not
            // open keep their places, and everything new goes after them.
            var floor = locked.Length == 0 ? 0 : locked.Max(item => item.Position) + 1;
            var sessions = new List<PlannedSession>(items.Count);
            for (var position = 0; position < items.Count; position++)
            {
                var item = items[position] ?? throw new ArgumentException($"A session of week {number} is missing.");
                var request = item.Session ?? throw new ArgumentException($"A session of week {number} is missing.");
                var where = string.IsNullOrWhiteSpace(request.Name)
                    ? $"Week {number}"
                    : $"Week {number}, {request.Name.Trim()}";
                if (request.DayOffset is < 0 or > 6)
                {
                    throw new ArgumentException($"{where}: a session's day runs from Day 1 to Day 7.");
                }

                TrainingSession? stored = null;
                if (item.SessionId is { } sessionId)
                {
                    if (!sessionById.TryGetValue(sessionId, out stored) || !referencedSessions.Add(sessionId))
                    {
                        throw Mismatch();
                    }

                    if (!ProgramEditRules.IsOpen(stored, today))
                    {
                        throw new ArgumentException(
                            $"{stored.Name} on {Day(stored.ScheduledDate)} has started or passed, so it can't be changed.");
                    }
                }

                var date = startsOn.AddDays(request.DayOffset);
                if (date < today)
                {
                    throw new ArgumentException(
                        $"{where}: {Day(date)} has already passed. Choose a day from today on.");
                }

                var changed = stored is null || !SameInputs(stored, request);
                if (kept is not null && stored is not null && stored.MesocycleWeekId == kept.Id &&
                    stored.Position >= floor)
                {
                    floor = stored.Position + 1;
                    sessions.Add(new PlannedSession(
                        key++,
                        stored,
                        changed ? ProgramEditDisposition.Replace : ProgramEditDisposition.Keep,
                        request,
                        stored.Position,
                        date,
                        changed));
                    continue;
                }

                if (stored is not null)
                {
                    removedSessions[stored.Id] = stored;
                }

                sessions.Add(new PlannedSession(
                    key++,
                    stored,
                    ProgramEditDisposition.Create,
                    request,
                    kept is null ? position : floor++,
                    date,
                    changed));
            }

            plannedWeeks.Add(new PlannedWeek(number, startsOn, source, label, week.IsPublished, sessions));
        }

        // Every open session nobody asked for goes, whether its week stays or not; one that moved to another
        // week is already counted above.
        foreach (var session in sessionById.Values)
        {
            if (ProgramEditRules.IsOpen(session, today) && !referencedSessions.Contains(session.Id))
            {
                removedSessions[session.Id] = session;
            }
        }

        var keptIds = plannedWeeks.Where(item => item.KeepsRow).Select(item => item.Source!.Id).ToHashSet();
        var removedWeeks = existing.Where(item => !keptIds.Contains(item.Id)).ToArray();
        return new ProgramEditPlan(
            today,
            frozen,
            plannedWeeks,
            removedWeeks,
            removedSessions.Values.OrderBy(item => item.ScheduledDate).ThenBy(item => item.Position).ToArray(),
            WeekChanges(plannedWeeks, removedWeeks, usedWeeks),
            SessionChanges(plannedWeeks, removedSessions, referencedSessions, weekNumberOfSession));
    }

    private static MesocycleWeek? ResolveWeek(
        ProgramEditWeekRequest week,
        int number,
        int frozen,
        Dictionary<Guid, MesocycleWeek> weekById,
        HashSet<Guid> usedWeeks)
    {
        if (week.WeekId is not { } weekId)
        {
            return number <= frozen
                ? throw new ArgumentException(
                    $"A new week can't go before week {frozen + 1}: weeks up to week {frozen} have sessions that started or passed.")
                : null;
        }

        if (!weekById.TryGetValue(weekId, out var current) || !usedWeeks.Add(weekId))
        {
            throw Mismatch();
        }

        if ((current.WeekNumber <= frozen || number <= frozen) && current.WeekNumber != number)
        {
            throw new ArgumentException(
                $"Week {current.WeekNumber} stays where it is: weeks up to week {frozen} have sessions that started or passed.");
        }

        return current;
    }

    private static ArgumentException Mismatch() =>
        new("The weeks in this request do not match the program. Reload the program and try again.");

    private static string? CleanLabel(string? label, int number)
    {
        var cleaned = Clean(label);
        return cleaned is { Length: > ProgramEditRules.MaximumLabelLength }
            ? throw new ArgumentException(
                $"Week {number}: keep the name to {ProgramEditRules.MaximumLabelLength} characters or fewer.")
            : cleaned;
    }

    private static string Day(DateOnly date) => date.ToString("ddd d MMM", CultureInfo.InvariantCulture);

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static List<ProgramEditWeekChange> WeekChanges(
        IReadOnlyList<PlannedWeek> planned,
        IReadOnlyList<MesocycleWeek> removed,
        HashSet<Guid> referencedWeeks)
    {
        var changes = new List<ProgramEditWeekChange>();
        foreach (var week in planned)
        {
            if (week.Source is null)
            {
                changes.Add(new ProgramEditWeekChange(
                    ProgramEditChangeKind.Added, week.Number, null, week.Label, week.IsPublished));
            }
            else if (!week.KeepsRow)
            {
                changes.Add(new ProgramEditWeekChange(
                    ProgramEditChangeKind.Moved, week.Number, week.Source.WeekNumber, week.Label, week.IsPublished));
            }
            else if (!string.Equals(Clean(week.Source.Label), week.Label, StringComparison.Ordinal) ||
                     week.Source.IsPublished != week.IsPublished)
            {
                changes.Add(new ProgramEditWeekChange(
                    ProgramEditChangeKind.Edited, week.Number, week.Number, week.Label, week.IsPublished));
            }
        }

        // A week that is in the request under another number moved; only the others are gone.
        changes.AddRange(removed
            .Where(item => !referencedWeeks.Contains(item.Id))
            .Select(item => new ProgramEditWeekChange(
                ProgramEditChangeKind.Removed, item.WeekNumber, item.WeekNumber, Clean(item.Label), item.IsPublished)));
        return changes;
    }

    private static List<ProgramEditSessionChange> SessionChanges(
        IReadOnlyList<PlannedWeek> planned,
        IReadOnlyDictionary<Guid, TrainingSession> removed,
        HashSet<Guid> referenced,
        Dictionary<Guid, int> weekNumberOfSession)
    {
        var changes = new List<ProgramEditSessionChange>();
        foreach (var week in planned)
        {
            foreach (var session in week.Sessions)
            {
                var name = Clean(session.Request.Name) ?? string.Empty;
                if (session.Existing is not { } stored)
                {
                    changes.Add(new ProgramEditSessionChange(
                        ProgramEditChangeKind.Added, null, session.Key, week.Number, session.Date, null, null, name,
                        week.IsPublished));
                    continue;
                }

                var dateChanged = session.Date != stored.ScheduledDate;
                if (!session.ContentChanged && !dateChanged)
                {
                    continue;
                }

                changes.Add(new ProgramEditSessionChange(
                    session.ContentChanged ? ProgramEditChangeKind.Edited : ProgramEditChangeKind.Moved,
                    stored,
                    session.Key,
                    week.Number,
                    session.Date,
                    dateChanged ? weekNumberOfSession[stored.Id] : null,
                    dateChanged ? stored.ScheduledDate : null,
                    name,
                    week.IsPublished));
            }
        }

        changes.AddRange(removed.Values
            .Where(item => !referenced.Contains(item.Id))
            .OrderBy(item => item.ScheduledDate)
            .ThenBy(item => item.Position)
            .Select(item => new ProgramEditSessionChange(
                ProgramEditChangeKind.Removed,
                item,
                null,
                weekNumberOfSession[item.Id],
                item.ScheduledDate,
                null,
                null,
                item.Name,
                false)));
        return changes;
    }

    /// <summary>
    /// Whether a requested session asks for what the stored one already prescribes. Only the coach's inputs
    /// count (never the calculated weights, names read from the library, or media), so a session that is not
    /// touched keeps its numbers even if a lift was archived or a picture changed since.
    /// </summary>
    private static bool SameInputs(TrainingSession stored, TrainingSessionRequest request)
    {
        if (!string.Equals(stored.Name, Clean(request.Name), StringComparison.Ordinal) ||
            stored.DayOffset != request.DayOffset ||
            !string.Equals(stored.CoachNotes, Clean(request.CoachNotes), StringComparison.Ordinal))
        {
            return false;
        }

        var current = stored.Exercises.OrderBy(item => item.Position).ToArray();
        var sent = (request.Exercises ?? []).OrderBy(item => item.Position).ToArray();
        return current.Length == sent.Length && current.Zip(sent).All(pair => SameExercise(pair.First, pair.Second));
    }

    private static bool SameExercise(ExercisePrescription stored, ExercisePrescriptionRequest request)
    {
        var policy = request.IsMainLift ? PrescriptionModificationPolicy.Locked : request.ModificationPolicy;
        if (stored.ExerciseId != request.ExerciseId ||
            stored.IsMainLift != request.IsMainLift ||
            stored.ModificationPolicy != policy ||
            !string.Equals(stored.CoachNotes, Clean(request.CoachNotes), StringComparison.Ordinal))
        {
            return false;
        }

        // A locked exercise approves no swap, whatever was stored beside it.
        if (policy == PrescriptionModificationPolicy.CoachApprovedSwap &&
            !stored.Alternatives.Select(item => item.ExerciseId).ToHashSet()
                .SetEquals(request.ApprovedAlternativeExerciseIds ?? []))
        {
            return false;
        }

        var current = stored.Sets.OrderBy(item => item.Position).ToArray();
        var sent = (request.Sets ?? []).OrderBy(item => item.Position).ToArray();
        return current.Length == sent.Length && current.Zip(sent).All(pair => SameSet(pair.First, pair.Second));
    }

    private static bool SameSet(SetPrescription stored, SetPrescriptionRequest request)
    {
        // The request in the form the server stores it: a typed weight is a direct, manual one, and a
        // target in reserve is a target in effort.
        var manual = request.ManualLoadOverride is not null;
        var strategy = manual ? TrainingLoadStrategy.Direct : request.LoadStrategy;
        var direct = manual ? request.ManualLoadOverride : request.DirectLoad;
        var percentage = manual ? null : request.PercentageWorkingMax;
        var rpe = request.TargetRpe ?? (request.TargetRir is { } reserve ? 10m - reserve : null);
        return stored.SetType == request.SetType &&
               stored.RepetitionsMinimum == request.RepetitionsMinimum &&
               stored.RepetitionsMaximum == request.RepetitionsMaximum &&
               stored.LoadStrategy == strategy &&
               stored.DirectLoad == direct &&
               (strategy == TrainingLoadStrategy.None || stored.LoadUnit == request.LoadUnit) &&
               stored.PercentageWorkingMax == percentage &&
               stored.TargetRpe == rpe &&
               stored.ExertionDisplayPreference == request.ExertionDisplayPreference &&
               stored.RestSeconds == request.RestSeconds &&
               stored.IsManualLoadOverride == manual &&
               string.Equals(stored.Tempo, Clean(request.Tempo), StringComparison.Ordinal) &&
               string.Equals(stored.CoachNotes, Clean(request.CoachNotes), StringComparison.Ordinal);
    }
}

/// <summary>
/// One edit of a client's weeks (TRN-028), kept as it was applied: the rule, the preview the coach read, how
/// many weeks and sessions it touched, and every changed or removed session as it stood before. Append-only,
/// so what a client was once given is never lost by a later change.
/// </summary>
public sealed class ProgramEdit : TenantEntity
{
    /// <summary>The longest record kept whole; a bigger one keeps its counts and names without the old prescriptions.</summary>
    public const int MaximumChangesLength = 6_000_000;

    private ProgramEdit()
    {
    }

    private ProgramEdit(
        Guid tenantId,
        Guid mesocycleId,
        string previewHash,
        int weeksAdded,
        int weeksMoved,
        int weeksRemoved,
        int sessionsAdded,
        int sessionsEdited,
        int sessionsMoved,
        int sessionsRemoved,
        int resultingWeekCount,
        DateOnly resultingEndDateExclusive,
        string changesJson)
        : base(tenantId)
    {
        if (mesocycleId == Guid.Empty ||
            previewHash is not { Length: 64 } ||
            previewHash.Any(character => !char.IsAsciiHexDigitLower(character)) ||
            new[] { weeksAdded, weeksMoved, weeksRemoved, sessionsAdded, sessionsEdited, sessionsMoved, sessionsRemoved }
                .Any(count => count < 0) ||
            resultingWeekCount is < 1 or > ProgramEditRules.MaximumWeeks)
        {
            throw new ArgumentException("The program edit record is invalid.");
        }

        MesocycleId = mesocycleId;
        RuleKey = ProgramEditRules.Key;
        RuleVersion = ProgramEditRules.CurrentVersion;
        PreviewHash = previewHash;
        WeeksAdded = weeksAdded;
        WeeksMoved = weeksMoved;
        WeeksRemoved = weeksRemoved;
        SessionsAdded = sessionsAdded;
        SessionsEdited = sessionsEdited;
        SessionsMoved = sessionsMoved;
        SessionsRemoved = sessionsRemoved;
        ResultingWeekCount = resultingWeekCount;
        ResultingEndDateExclusive = resultingEndDateExclusive;
        ChangesJson = TrainingText.Required(changesJson, MaximumChangesLength, nameof(changesJson));
    }

    public Guid MesocycleId { get; private set; }

    public string RuleKey { get; private set; } = string.Empty;

    public string RuleVersion { get; private set; } = string.Empty;

    public string PreviewHash { get; private set; } = string.Empty;

    public int WeeksAdded { get; private set; }

    public int WeeksMoved { get; private set; }

    public int WeeksRemoved { get; private set; }

    public int SessionsAdded { get; private set; }

    public int SessionsEdited { get; private set; }

    public int SessionsMoved { get; private set; }

    public int SessionsRemoved { get; private set; }

    public int ResultingWeekCount { get; private set; }

    public DateOnly ResultingEndDateExclusive { get; private set; }

    public string ChangesJson { get; private set; } = string.Empty;

    public static ProgramEdit Record(
        Guid tenantId,
        Guid mesocycleId,
        string previewHash,
        ProgramEditPlan plan,
        DateOnly resultingEndDateExclusive,
        string changesJson)
    {
        ArgumentNullException.ThrowIfNull(plan);
        return new ProgramEdit(
            tenantId,
            mesocycleId,
            previewHash,
            plan.WeeksAdded,
            plan.WeeksMoved,
            plan.WeeksRemoved,
            plan.SessionsAdded,
            plan.SessionsEdited,
            plan.SessionsMoved,
            plan.SessionsRemoved,
            plan.Weeks.Count,
            resultingEndDateExclusive,
            changesJson);
    }
}
