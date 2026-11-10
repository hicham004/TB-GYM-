using Microsoft.EntityFrameworkCore;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Training;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// Where each lift with a "Last time + step" set stands (<c>LastTimeStep</c> v1, STR-019, notes plan N6b), for one
/// client or many at once: one answer per writing of the lift in its coming session, the earliest session not started
/// and not before today (in its program's calendar) of a block neither completed nor cancelled that writes the lift
/// with a step. The coach's training reads and Coach Today's attention (notes plan N6d) share it, so a weight Today
/// counts is one the client's Training tab offers. Callers decide first whose read is open; nothing is written.
/// </summary>
internal static class LiftStandingsReader
{
    /// <summary>Names the reads in the SQL they send, for logs and for the tests that count them.</summary>
    internal const string ComingTag = "Lift standings: the coming step sets";

    internal const string HistoryTag = "Lift standings: the workouts of those lifts";

    internal const string RecentTag = "Lift standings: the last weeks of those lifts";

    internal const string EarlierTag = "Lift standings: the workouts before those weeks";

    /// <summary>
    /// Every answer for <paramref name="clientIds"/>, read from the whole history of each lift: two commands at most,
    /// the coming step sets, then the clients' workouts of those lifts from any program.
    /// </summary>
    public static async Task<ILookup<Guid, LiftStandingView>> ReadAsync(
        GymDbContext dbContext,
        DateTimeOffset now,
        IReadOnlyCollection<Guid> clientIds,
        CancellationToken cancellationToken)
    {
        var coming = await ReadComingAsync(dbContext, now, clientIds, cancellationToken);
        if (coming.Writings.Length == 0)
        {
            return Lookup([]);
        }

        var history = await ReadHistoryAsync(
            dbContext, coming.Writings, from: null, before: null, HistoryTag, cancellationToken);
        return Lookup(coming.Writings
            .Select(row => Answer(row, coming.Todays[row.TimeZoneId], history[(row.ClientProfileId, row.ExerciseId)]))
            .OfType<(Guid, LiftStandingView)>());
    }

    /// <summary>
    /// The same answers as <see cref="ReadAsync"/> for what applying writes (<see cref="LastTimeStepRule.SetsToApply"/>)
    /// and whether a lift steps up, for Coach Today, whose rows must not grow with every workout a client logs (audit
    /// BEB-2): the lifts' workouts of the last <see cref="LastTimeStepRule.LookbackDays"/> days and a day, and the
    /// workouts before them only of a lift whose recent logs cannot settle the typo guard
    /// (<see cref="LastTimeStepRule.RecentSettles"/>): one whose step sets were given no weight its client logged near
    /// in those weeks. Three commands at most; the reasons a hold gives can differ from the Training tab's only where
    /// nothing applies either way (never done, or last done long ago).
    /// </summary>
    public static async Task<ILookup<Guid, LiftStandingView>> ReadRecentAsync(
        GymDbContext dbContext,
        DateTimeOffset now,
        IReadOnlyCollection<Guid> clientIds,
        CancellationToken cancellationToken)
    {
        var coming = await ReadComingAsync(dbContext, now, clientIds, cancellationToken);
        if (coming.Writings.Length == 0)
        {
            return Lookup([]);
        }

        // Every program's today is on or after the UTC day before (ReadComingAsync), so this is at least the lookback
        // before each of them.
        var from = coming.Earliest.AddDays(-LastTimeStepRule.LookbackDays);
        var recent = await ReadHistoryAsync(
            dbContext, coming.Writings, from, before: null, RecentTag, cancellationToken);
        var unsettled = coming.Writings
            .Where(row => Coming(row) is { } lift &&
                          !LastTimeStepRule.RecentSettles(
                              lift,
                              recent[(row.ClientProfileId, row.ExerciseId)].ToArray(),
                              from,
                              coming.Todays[row.TimeZoneId]))
            .ToArray();
        // An unsettled writing reads the workouts before the window too, which with the window are its whole history.
        var earlier = unsettled.Length == 0
            ? Array.Empty<((Guid, Guid) Key, LoggedLift Writing)>().ToLookup(item => item.Key, item => item.Writing)
            : await ReadHistoryAsync(dbContext, unsettled, from: null, before: from, EarlierTag, cancellationToken);
        var readWhole = unsettled.Select(row => row.ExercisePrescriptionId).ToHashSet();
        return Lookup(coming.Writings
            .Select(row => Answer(
                row,
                coming.Todays[row.TimeZoneId],
                readWhole.Contains(row.ExercisePrescriptionId)
                    ? earlier[(row.ClientProfileId, row.ExerciseId)].Concat(recent[(row.ClientProfileId, row.ExerciseId)])
                    : recent[(row.ClientProfileId, row.ExerciseId)]))
            .OfType<(Guid, LiftStandingView)>());
    }

    /// <summary>
    /// The coming writings of every client's step lifts: each lift's first open session, every writing of the lift
    /// there, in the order the program reads (day, block, week, session, place), with each program's today.
    /// </summary>
    private static async Task<ComingRead> ReadComingAsync(
        GymDbContext dbContext,
        DateTimeOffset now,
        IReadOnlyCollection<Guid> clientIds,
        CancellationToken cancellationToken)
    {
        // Every program's today is on or after the UTC day before; each block's own day is checked below.
        var earliest = DateOnly.FromDateTime(now.UtcDateTime).AddDays(-1);
        if (clientIds.Count == 0)
        {
            return new ComingRead(earliest, [], new Dictionary<string, DateOnly>());
        }

        Guid[] clients = [.. clientIds.Distinct()];
        // Every program's today is on or before the UTC day after, so a lift's first open step session from that day
        // on is already a coming one: no later session of the lift can be its first, and none is read (only the few
        // before it, from the UTC day before, whose own program's today decides below).
        var horizon = earliest.AddDays(2);
        var rows = await (
                from block in dbContext.TrainingMesocycles.AsNoTracking()
                join week in dbContext.MesocycleWeeks.AsNoTracking()
                    on new { block.TenantId, MesocycleId = block.Id } equals new { week.TenantId, week.MesocycleId }
                join session in dbContext.TrainingSessions.AsNoTracking()
                    on new { week.TenantId, MesocycleWeekId = week.Id } equals new { session.TenantId, session.MesocycleWeekId }
                join exercise in dbContext.ExercisePrescriptions.AsNoTracking()
                    on new { session.TenantId, TrainingSessionId = session.Id }
                    equals new { exercise.TenantId, exercise.TrainingSessionId }
                where clients.Contains(block.ClientProfileId) &&
                      block.Status == MesocycleStatus.Planned &&
                      !session.HasStarted &&
                      session.ScheduledDate >= earliest &&
                      exercise.Sets.Any(set => set.LoadStrategy == TrainingLoadStrategy.LastTimeStep) &&
                      !(from soonerBlock in dbContext.TrainingMesocycles
                        join soonerWeek in dbContext.MesocycleWeeks
                            on new { soonerBlock.TenantId, MesocycleId = soonerBlock.Id }
                            equals new { soonerWeek.TenantId, soonerWeek.MesocycleId }
                        join soonerSession in dbContext.TrainingSessions
                            on new { soonerWeek.TenantId, MesocycleWeekId = soonerWeek.Id }
                            equals new { soonerSession.TenantId, soonerSession.MesocycleWeekId }
                        join soonerExercise in dbContext.ExercisePrescriptions
                            on new { soonerSession.TenantId, TrainingSessionId = soonerSession.Id }
                            equals new { soonerExercise.TenantId, soonerExercise.TrainingSessionId }
                        where soonerBlock.ClientProfileId == block.ClientProfileId &&
                              soonerBlock.Status == MesocycleStatus.Planned &&
                              !soonerSession.HasStarted &&
                              soonerSession.ScheduledDate >= horizon &&
                              soonerSession.ScheduledDate < session.ScheduledDate &&
                              soonerExercise.ExerciseId == exercise.ExerciseId &&
                              soonerExercise.Sets.Any(set => set.LoadStrategy == TrainingLoadStrategy.LastTimeStep)
                        select soonerExercise.Id).Any()
                select new
                {
                    block.ClientProfileId,
                    BlockId = block.Id,
                    block.TimeZoneId,
                    block.StartDate,
                    week.WeekNumber,
                    SessionId = session.Id,
                    SessionName = session.Name,
                    session.ScheduledDate,
                    SessionPosition = session.Position,
                    ExercisePrescriptionId = exercise.Id,
                    exercise.ExerciseId,
                    exercise.ExerciseNameSnapshot,
                    exercise.Position,
                    // Line (f): which writing of the lift in the session it is, every writing counted.
                    Occurrence = dbContext.ExercisePrescriptions.Count(other =>
                        other.TrainingSessionId == session.Id &&
                        other.ExerciseId == exercise.ExerciseId &&
                        other.Position < exercise.Position) + 1,
                    Sets = exercise.Sets
                        .OrderBy(set => set.Position)
                        .Select(set => new ComingSetRow(
                            set.Id,
                            set.LoadStrategy,
                            set.LoadStep,
                            set.LoadUnit,
                            set.PrescribedLoad ?? set.DirectLoad,
                            set.ExertionDisplayPreference))
                        .ToList(),
                })
            .TagWith(ComingTag)
            .ToListAsync(cancellationToken);
        if (rows.Count == 0)
        {
            return new ComingRead(earliest, [], new Dictionary<string, DateOnly>());
        }

        var todays = rows.Select(row => row.TimeZoneId).Distinct()
            .ToDictionary(zone => zone, zone => DateOnly.FromDateTime(
                TimeZoneInfo.ConvertTime(now, TimeZoneInfo.FindSystemTimeZoneById(zone)).DateTime));
        // A lift's coming session is its first open one, per client; every writing of the lift there is answered.
        var writings = rows
            .Where(row => row.ScheduledDate >= todays[row.TimeZoneId])
            .OrderBy(row => row.ScheduledDate)
            .ThenBy(row => row.StartDate).ThenBy(row => row.BlockId)
            .ThenBy(row => row.WeekNumber).ThenBy(row => row.SessionPosition).ThenBy(row => row.SessionId)
            .ThenBy(row => row.Position)
            .GroupBy(row => (row.ClientProfileId, row.ExerciseId))
            .SelectMany(lift => lift.Where(row => row.SessionId == lift.First().SessionId))
            .Select(row => new ComingRow(
                row.ClientProfileId,
                row.BlockId,
                row.TimeZoneId,
                row.SessionId,
                row.SessionName,
                row.ScheduledDate,
                row.ExercisePrescriptionId,
                row.ExerciseId,
                row.ExerciseNameSnapshot,
                row.Occurrence,
                row.Sets))
            .ToArray();
        return new ComingRead(earliest, writings, todays);
    }

    /// <summary>
    /// The clients' workouts of the coming lifts, from any program, finished or running, up to the last coming day and,
    /// with <paramref name="from"/>, from that day on, or, with <paramref name="before"/>, before that day. One
    /// command, one part per lift, each for exactly the clients coming to it, so a client's workouts are read only for
    /// that client's own coming lifts.
    /// </summary>
    private static async Task<ILookup<(Guid Client, Guid Lift), LoggedLift>> ReadHistoryAsync(
        GymDbContext dbContext,
        IReadOnlyCollection<ComingRow> writings,
        DateOnly? from,
        DateOnly? before,
        string tag,
        CancellationToken cancellationToken)
    {
        var through = writings.Max(row => row.ScheduledDate);
        var parts = writings
            .GroupBy(row => row.ExerciseId)
            .Select(lift =>
            {
                var liftId = lift.Key;
                Guid[] clients = [.. lift.Select(row => row.ClientProfileId).Distinct()];
                var joined =
                    from set in dbContext.WorkoutSetPerformances.AsNoTracking()
                    join performance in dbContext.WorkoutExercisePerformances.AsNoTracking()
                        on new { set.TenantId, Id = set.WorkoutExercisePerformanceId }
                        equals new { performance.TenantId, performance.Id }
                    join execution in dbContext.WorkoutExecutions.AsNoTracking()
                        on new { performance.TenantId, Id = performance.WorkoutExecutionId }
                        equals new { execution.TenantId, execution.Id }
                    where performance.PrescribedExerciseId == liftId &&
                          clients.Contains(execution.ClientProfileId) &&
                          execution.ScheduledDateSnapshot <= through
                    select new { set, performance, execution };
                if (from is { } floor)
                {
                    joined = joined.Where(item => item.execution.ScheduledDateSnapshot >= floor);
                }

                if (before is { } ceiling)
                {
                    joined = joined.Where(item => item.execution.ScheduledDateSnapshot < ceiling);
                }

                return joined.Select(item => new
                {
                    item.execution.ClientProfileId,
                    ExecutionId = item.execution.Id,
                    item.execution.ScheduledDateSnapshot,
                    item.execution.Status,
                    item.execution.StartedAtUtc,
                    PerformanceId = item.performance.Id,
                    item.performance.PrescribedExerciseId,
                    item.performance.ActualExerciseId,
                    PerformancePosition = item.performance.Position,
                    item.set.Position,
                    item.set.SetTypeSnapshot,
                    item.set.PrescribedRepetitionsMinimum,
                    item.set.PrescribedRepetitionsMaximum,
                    item.set.PrescribedTargetRpe,
                    item.set.PrescribedLoad,
                    item.set.PrescribedLoadUnit,
                    item.set.IsCompleted,
                    item.set.ActualRepetitions,
                    item.set.ActualLoad,
                    item.set.ActualLoadUnit,
                    item.set.ActualRpe,
                });
            })
            .ToArray();
        var logged = await parts.Skip(1).Aggregate(parts[0], (union, part) => union.Concat(part))
            .TagWith(tag)
            .ToListAsync(cancellationToken);
        // Line (f): a workout's writings of a lift are numbered by the place the coach wrote them, and only one done
        // as written is the lift's: a writing swapped for another lift never shifts the numbering, so a top set is
        // never matched to last time's back-off, and a lift done in another lift's place is not read.
        return logged
            .GroupBy(row => (row.ExecutionId, row.PrescribedExerciseId))
            .SelectMany(workout => workout
                .GroupBy(row => row.PerformanceId)
                .OrderBy(performance => performance.First().PerformancePosition)
                .Select((performance, index) => (Performance: performance, Occurrence: index + 1))
                .Where(item => item.Performance.First().ActualExerciseId == item.Performance.First().PrescribedExerciseId)
                .Select(item =>
                {
                    var (performance, occurrence) = item;
                    var first = performance.First();
                    return (Key: (first.ClientProfileId, first.PrescribedExerciseId), Writing: new LoggedLift(
                        first.ExecutionId,
                        first.ScheduledDateSnapshot,
                        first.Status,
                        first.StartedAtUtc,
                        occurrence,
                        performance.OrderBy(row => row.Position).Select((row, number) => new LoggedSet(
                            number + 1,
                            row.SetTypeSnapshot,
                            row.PrescribedRepetitionsMaximum ?? row.PrescribedRepetitionsMinimum,
                            row.PrescribedTargetRpe,
                            row.PrescribedLoad,
                            row.PrescribedLoadUnit,
                            row.IsCompleted,
                            row.ActualRepetitions,
                            row.ActualLoad,
                            row.ActualLoadUnit,
                            row.ActualRpe)).ToArray()));
                }))
            .ToLookup(item => item.Key, item => item.Writing);
    }

    /// <summary>The coming writing as the rule reads it, or null when it holds no step set the database keeps whole.</summary>
    private static ComingLift? Coming(ComingRow row)
    {
        // The database holds a step set's step and unit (CK_SetPrescriptions_LoadStrategy).
        var steps = Steps(row);
        return steps.Length == 0
            ? null
            : new ComingLift(row.ExerciseId, row.Occurrence, row.ScheduledDate, steps
                .Select(item => new ComingStepSet(item.Set.Id, item.Number, item.Set.LoadStep!.Value,
                    item.Set.LoadUnit!.Value, item.Set.Weight))
                .ToArray());
    }

    private static (ComingSetRow Set, int Number)[] Steps(ComingRow row) =>
        [.. row.Sets
            .Select((set, index) => (Set: set, Number: index + 1))
            .Where(item => item.Set.LoadStrategy == TrainingLoadStrategy.LastTimeStep &&
                           item.Set is { LoadStep: not null, LoadUnit: not null })];

    private static (Guid Client, LiftStandingView View)? Answer(
        ComingRow row,
        DateOnly today,
        IEnumerable<LoggedLift> history)
    {
        if (Coming(row) is not { } coming)
        {
            return null;
        }

        return (row.ClientProfileId, new LiftStandingView(
            LastTimeStepRule.Key,
            LastTimeStepRule.Version,
            row.BlockId,
            row.SessionId,
            row.SessionName,
            row.ScheduledDate,
            row.ExercisePrescriptionId,
            row.ExerciseId,
            row.ExerciseNameSnapshot,
            row.Occurrence,
            Steps(row)[0].Set.ExertionDisplayPreference,
            LastTimeStepRule.Read(coming, history, today)));
    }

    private static ILookup<Guid, LiftStandingView> Lookup(IEnumerable<(Guid Client, LiftStandingView View)> answers) =>
        answers.ToLookup(item => item.Client, item => item.View);

    private sealed record ComingRead(
        DateOnly Earliest,
        ComingRow[] Writings,
        IReadOnlyDictionary<string, DateOnly> Todays);

    private sealed record ComingRow(
        Guid ClientProfileId,
        Guid BlockId,
        string TimeZoneId,
        Guid SessionId,
        string SessionName,
        DateOnly ScheduledDate,
        Guid ExercisePrescriptionId,
        Guid ExerciseId,
        string ExerciseNameSnapshot,
        int Occurrence,
        IReadOnlyList<ComingSetRow> Sets);

    private sealed record ComingSetRow(
        Guid Id,
        TrainingLoadStrategy LoadStrategy,
        decimal? LoadStep,
        TrainingLoadUnit? LoadUnit,
        decimal? Weight,
        ExertionDisplayPreference ExertionDisplayPreference);
}
