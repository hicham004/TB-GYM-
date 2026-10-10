using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Strength;
using TB.Gym.Modules.Training;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// A program's training maxes (STR-002, P2): reading them, updating them for the coming weeks through
/// preview, hash and apply (STR-009), and renaming the program (TRN-002). The max is the one working
/// number an assigned program calculates its weights from; updating it adds a superseding snapshot, and
/// recalculates only the sets of sessions that have not started and are not in the past (TRN-004).
/// </summary>
internal sealed partial class TrainingApplicationService
{
    private const int ProgramNameMaximumLength = 160;
    private const int MaximumMaxChanges = 40;
    private const int ReasonMaximumLength = 500;
    private const string DefaultMaxReason = "Training max updated by the coach.";

    private static readonly JsonSerializerOptions MaxesJsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<TrainingMaxesView?> GetTrainingMaxesAsync(
        Guid mesocycleId,
        CancellationToken cancellationToken)
    {
        // A read like every mesocycle read: another coach's client's program is a missing one (ADR 0026).
        var header = await dbContext.TrainingMesocycles.AsNoTracking()
            .Where(item => item.Id == mesocycleId)
            .Select(item => new
            {
                item.ClientProfileId,
                item.LoadUnit,
                item.LoadIncrement,
                item.Version,
                item.Status,
                item.TimeZoneId,
            })
            .SingleOrDefaultAsync(cancellationToken);
        if (header is null || await coachClientScope.ExcludesAsync(header.ClientProfileId, cancellationToken))
        {
            return null;
        }

        var snapshots = await dbContext.MesocycleWorkingMaxSnapshots.AsNoTracking()
            .Where(item => item.MesocycleId == mesocycleId)
            .ToListAsync(cancellationToken);
        var exerciseIds = snapshots.Select(item => item.ExerciseId).Distinct().ToArray();
        var names = await dbContext.Exercises.AsNoTracking()
            .Where(item => exerciseIds.Contains(item.Id))
            .ToDictionaryAsync(item => item.Id, item => item.Name, cancellationToken);
        var weekOneEntity = await dbContext.MesocycleWeeks.AsNoTracking()
            .Where(item => item.MesocycleId == mesocycleId && item.WeekNumber == 1)
            .Include(item => item.Sessions).ThenInclude(item => item.Exercises).ThenInclude(item => item.Sets)
            .AsSplitQuery()
            .SingleOrDefaultAsync(cancellationToken);
        var weekOne = weekOneEntity is null ? null : ToBlueprint(weekOneEntity);
        var timeZone = TimeZoneInfo.FindSystemTimeZoneById(header.TimeZoneId);
        var isClosed = header.Status is MesocycleStatus.Completed or MesocycleStatus.Cancelled;

        // Suggestions only where the coach could act on them: an open program of a client still coached
        // here, while the coach's training reads are open (TRN-023, STR-007).
        var suggests = !isClosed &&
                       !await coachClientScope.IsReleasedAsync(header.ClientProfileId, cancellationToken) &&
                       await CoachMayReadLoggedSetsAsync(header.ClientProfileId, cancellationToken);
        var loggedSets = await LoadLoggedSetsAsync(
            mesocycleId,
            suggests ? exerciseIds : [],
            snapshots.Where(item => item.SourceSetPerformanceId is not null)
                .Select(item => item.SourceSetPerformanceId!.Value)
                .ToArray(),
            timeZone,
            cancellationToken);
        var setsById = loggedSets.Values.SelectMany(sets => sets).ToDictionary(set => set.SetId);
        var lastKeeps = await LoggedSetMaxSuggestions.LoadLastKeepsAsync(dbContext, [mesocycleId], cancellationToken);

        var current = CurrentWorkingMaxes(snapshots);
        var maxes = current.Values
            .OrderBy(item => names.GetValueOrDefault(item.ExerciseId, string.Empty), StringComparer.OrdinalIgnoreCase)
            .Select(item =>
            {
                var anchor = weekOne is null
                    ? null
                    : WeekOneAnchors.Find(weekOne, item.ExerciseId, RtsRpeChart.Covers);
                var earlier = snapshots
                    .Where(other => other.ExerciseId == item.ExerciseId && other.Id != item.Id)
                    .OrderByDescending(other => other.CreatedAtUtc)
                    .ThenByDescending(other => other.Id)
                    .Select(other => ToEntryView(other, timeZone, setsById))
                    .ToArray();
                return new TrainingMaxView(
                    item.ExerciseId,
                    names.GetValueOrDefault(item.ExerciseId, string.Empty),
                    ToEntryView(item, timeZone, setsById),
                    anchor is null ? null : new TrainingMaxWeekOneSetView(anchor.Repetitions, anchor.Rpe, anchor.Load),
                    earlier,
                    suggests && loggedSets.TryGetValue(item.ExerciseId, out var sets)
                        ? SuggestionFor(item, lastKeeps.GetValueOrDefault(item.Id)?.CreatedAtUtc, sets, header.LoadUnit, header.LoadIncrement)
                        : null,
                    lastKeeps.TryGetValue(item.Id, out var kept)
                        ? new TrainingMaxKeptView(
                            kept.SuggestedValue,
                            header.LoadUnit,
                            DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(kept.CreatedAtUtc, timeZone).DateTime))
                        : null);
            })
            .ToArray();
        return new TrainingMaxesView(
            mesocycleId,
            header.Version,
            header.LoadUnit,
            isClosed,
            maxes);
    }

    public async Task<TrainingMaxesPreviewView?> PreviewTrainingMaxesAsync(
        Guid mesocycleId,
        PreviewTrainingMaxesRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var mesocycle = await LoadMesocycleAsync(mesocycleId, tracking: false, cancellationToken);
        if (mesocycle is null)
        {
            return null;
        }

        var plan = await PlanTrainingMaxesAsync(
            mesocycle,
            request.MesocycleVersion,
            request.Changes,
            string.Empty,
            cancellationToken);
        var changed = plan.Sets.Where(item => item.IsChanged).ToArray();
        return new TrainingMaxesPreviewView(
            plan.Hash,
            mesocycle.LoadUnit,
            plan.EffectiveFromWeek,
            plan.Lifts.OrderBy(lift => lift.ExerciseName, StringComparer.OrdinalIgnoreCase).Select(lift => new TrainingMaxLiftChangeView(
                lift.ExerciseId,
                lift.ExerciseName,
                lift.Current.Value,
                lift.NewValue,
                mesocycle.LoadUnit,
                lift.Source,
                lift.Basis is null
                    ? null
                    : new TrainingMaxBasisView(
                        lift.Basis.Load,
                        lift.Basis.Repetitions,
                        lift.Basis.Rpe,
                        lift.Basis.MethodKey,
                        lift.Basis.MethodVersion,
                        lift.Logged is null ? null : LoggedSetView(lift.Logged.Set)),
                lift.Explanation)).ToArray(),
            changed.Select(item => new TrainingMaxSetChangeView(
                item.Set.Id,
                item.WeekNumber,
                item.ScheduledDate,
                item.SessionId,
                item.SessionName,
                item.ExerciseId,
                item.ExerciseName,
                item.Set.Position,
                item.Set.RepetitionsMaximum,
                item.Set.TargetRpe,
                item.Set.PercentageWorkingMax,
                item.Set.PrescribedLoad,
                item.Calculation.PrescribedLoad,
                item.Calculation.Explanation)).ToArray(),
            changed.Length,
            plan.Sets.Count - changed.Length,
            plan.SessionCount,
            plan.KeptSessionCount);
    }

    public async Task<TrainingCommandResult> ApplyTrainingMaxesAsync(
        Guid mesocycleId,
        ApplyTrainingMaxesRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (request.IdempotencyKey == Guid.Empty)
        {
            return Invalid("idempotencyKey", "A non-empty idempotency key is required.");
        }

        // The write loader also answers another coach's client as missing and refuses a released client.
        var mesocycle = await LoadMesocycleAsync(mesocycleId, tracking: true, cancellationToken);
        if (mesocycle is null)
        {
            return NotFound();
        }

        // What the client can open before the new weights land, to tell them which of those weeks changed.
        var visibleBefore = ClientVisibleWeeks(mesocycle);
        string reason;
        string fingerprint;
        try
        {
            reason = NormalizeMaxReason(request.Reason);
            fingerprint = MaxRequestFingerprint(mesocycleId, request, reason);
        }
        catch (ArgumentException exception)
        {
            return Invalid("maxes", exception.Message);
        }

        try
        {
            var replay = await dbContext.WorkingMaxUpdates.AsNoTracking()
                .SingleOrDefaultAsync(item => item.IdempotencyKey == request.IdempotencyKey, cancellationToken);
            if (replay is not null)
            {
                // A retry of the same request answers with the first result; another request with this
                // key is a conflict.
                return replay.MesocycleId == mesocycleId && replay.RequestFingerprint == fingerprint
                    ? SuccessMesocycle(await ToViewAsync(mesocycle, cancellationToken))
                    : Conflict("idempotency_conflict", "This idempotency key was already used for another update.");
            }

            var plan = await PlanTrainingMaxesAsync(
                mesocycle,
                request.MesocycleVersion,
                request.Changes,
                reason,
                cancellationToken);
            if (!HashesEqual(plan.Hash, request.PreviewHash))
            {
                return Conflict(
                    "training_maxes_preview_changed",
                    "The new weights no longer match the ones you reviewed. Preview them again before applying.");
            }

            dbContext.Entry(mesocycle).Property(item => item.Version).OriginalValue = request.MesocycleVersion;
            foreach (var lift in plan.Lifts)
            {
                dbContext.MesocycleWorkingMaxSnapshots.Add(lift.Snapshot!);
            }

            var (sessions, sets) = mesocycle.ApplyRecalculatedLoads(
                plan.Sets.ToDictionary(item => item.Set.Id, item => item.Calculation));
            dbContext.WorkingMaxUpdates.Add(WorkingMaxUpdate.Record(
                tenantContext.TenantId,
                mesocycle.Id,
                request.IdempotencyKey,
                fingerprint,
                plan.Hash,
                string.IsNullOrEmpty(reason) ? DefaultMaxReason : reason,
                plan.EffectiveFromWeek,
                plan.Lifts.Count,
                sessions,
                sets));
            await QueueClientWeekNoticesAsync(mesocycle, visibleBefore, cancellationToken);
            await dbContext.SaveChangesAsync(cancellationToken);
            return SuccessMesocycle(await ToViewAsync(mesocycle, cancellationToken));
        }
        catch (ArgumentException exception)
        {
            return Invalid("maxes", exception.Message);
        }
        catch (TrainingMaxSuggestionChangedException exception)
        {
            return Conflict(TrainingMaxSuggestionChangedException.Code, exception.Message);
        }
        catch (InvalidOperationException exception)
        {
            return Conflict("training_maxes_conflict", exception.Message);
        }
        catch (DbUpdateConcurrencyException)
        {
            return await ReplayOrConflictAsync(mesocycleId, request.IdempotencyKey, fingerprint, cancellationToken);
        }
        catch (DbUpdateException exception) when (IsMaxChainOrKeyViolation(exception))
        {
            return await ReplayOrConflictAsync(mesocycleId, request.IdempotencyKey, fingerprint, cancellationToken);
        }
    }

    public async Task<TrainingCommandResult> RenameMesocycleAsync(
        Guid mesocycleId,
        RenameMesocycleRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var name = request.Name?.Trim() ?? string.Empty;
        if (name.Length == 0)
        {
            return Invalid("name", "Give the program a name.");
        }

        if (name.Length > ProgramNameMaximumLength)
        {
            return Invalid("name", $"Keep the name to {ProgramNameMaximumLength} characters or fewer.");
        }

        var mesocycle = await LoadMesocycleAsync(mesocycleId, tracking: true, cancellationToken);
        if (mesocycle is null)
        {
            return NotFound();
        }

        try
        {
            dbContext.Entry(mesocycle).Property(item => item.Version).OriginalValue = request.Version;
            var previousName = mesocycle.Name;
            var status = mesocycle.GetEffectiveStatus(clock.UtcNow);
            if (mesocycle.Rename(name))
            {
                dbContext.MesocycleLifecycleEvents.Add(MesocycleLifecycleEvent.Record(
                    tenantContext.TenantId,
                    mesocycle.Id,
                    MesocycleLifecycleEventType.Renamed,
                    status,
                    status,
                    $"Renamed from \"{previousName}\" to \"{name}\".",
                    clock.UtcNow));
                await dbContext.SaveChangesAsync(cancellationToken);
            }

            return SuccessMesocycle(await ToViewAsync(mesocycle, cancellationToken));
        }
        catch (InvalidOperationException)
        {
            return Conflict("program_closed", "A finished or cancelled program keeps its name.");
        }
        catch (DbUpdateConcurrencyException)
        {
            return ConcurrencyConflict();
        }
    }

    /// <summary>
    /// Works out what updating the maxes would do, without saving anything: the new max of each lift, and
    /// the new weight of every set that is calculated from it in a session that has not started and is not
    /// in the past. Preview and apply both run this, so the hash proves they agree.
    /// </summary>
    private async Task<MaxesPlan> PlanTrainingMaxesAsync(
        TrainingMesocycle mesocycle,
        uint expectedVersion,
        IReadOnlyList<TrainingMaxChangeRequest> changes,
        string coachReason,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(changes);
        if (mesocycle.Version != expectedVersion)
        {
            throw new InvalidOperationException(
                "The program changed after this update was prepared. Reload the program and try again.");
        }

        if (mesocycle.Status is MesocycleStatus.Completed or MesocycleStatus.Cancelled)
        {
            throw new InvalidOperationException("A finished or cancelled program keeps its training maxes.");
        }

        if (changes.Count is < 1 or > MaximumMaxChanges ||
            changes.Select(item => item.ExerciseId).Distinct().Count() != changes.Count)
        {
            throw new ArgumentException($"Change each lift's training max once, for 1 to {MaximumMaxChanges} lifts.");
        }

        var snapshots = await dbContext.MesocycleWorkingMaxSnapshots.AsNoTracking()
            .Where(item => item.MesocycleId == mesocycle.Id)
            .ToListAsync(cancellationToken);
        var current = CurrentWorkingMaxes(snapshots);
        var sessions = mesocycle.Weeks
            .OrderBy(item => item.WeekNumber)
            .SelectMany(week => week.Sessions
                .OrderBy(item => item.Position)
                .Select(session => (Week: week, Session: session)))
            .ToArray();
        var exerciseNames = sessions
            .SelectMany(item => item.Session.Exercises)
            .GroupBy(item => item.ExerciseId)
            .ToDictionary(group => group.Key, group => group.First().ExerciseNameSnapshot);
        var unit = ToStrengthUnit(mesocycle.LoadUnit);
        var weekOne = ToBlueprint(mesocycle.Weeks.OrderBy(item => item.WeekNumber).First());

        // A max from a logged set is worked out again here from the client's finished workouts, never taken
        // from the request, and only while the coach may read those workouts (STR-007, TRN-023).
        var loggedLifts = changes.Where(item => item.LoggedSetId is not null).Select(item => item.ExerciseId).Distinct().ToArray();
        var loggedSets = new Dictionary<Guid, LoggedSetEvidence[]>();
        var lastKeeps = new Dictionary<Guid, WorkingMaxKeep>();
        if (loggedLifts.Length > 0)
        {
            if (!await CoachMayReadLoggedSetsAsync(mesocycle.ClientProfileId, cancellationToken))
            {
                throw new ArgumentException(
                    "This client's logged sets are not open to you now, so no max can be estimated from them. Type the max instead.");
            }

            loggedSets = await LoadLoggedSetsAsync(
                mesocycle.Id,
                loggedLifts,
                [],
                TimeZoneInfo.FindSystemTimeZoneById(mesocycle.TimeZoneId),
                cancellationToken);
            lastKeeps = await LoggedSetMaxSuggestions.LoadLastKeepsAsync(dbContext, [mesocycle.Id], cancellationToken);
        }

        var lifts = new List<PlannedLift>();
        foreach (var change in changes.OrderBy(item => item.ExerciseId))
        {
            var name = exerciseNames.GetValueOrDefault(change.ExerciseId, "This lift");
            if (!current.TryGetValue(change.ExerciseId, out var existing))
            {
                throw new ArgumentException($"{name} does not use a training max in this program.");
            }

            var given = (change.Value is null ? 0 : 1) + (change.WeekOneWeight is null ? 0 : 1) + (change.LoggedSetId is null ? 0 : 1);
            if (given != 1)
            {
                throw new ArgumentException(
                    $"Give {name} either a training max or week 1's weight, or the logged set to estimate it from: one of the three.");
            }

            PlannedLift lift;
            if (change.LoggedSetId is { } loggedSetId)
            {
                var logged = ResolveLoggedSet(
                    loggedSetId,
                    name,
                    existing,
                    lastKeeps.GetValueOrDefault(existing.Id)?.CreatedAtUtc,
                    loggedSets.GetValueOrDefault(change.ExerciseId, []),
                    mesocycle.LoadUnit);
                lift = new PlannedLift(
                    change.ExerciseId,
                    name,
                    existing,
                    logged.Estimate.Value,
                    TrainingMaxSource.LoggedSet,
                    new MaxEstimateBasis(
                        logged.Set.Load!.Value,
                        logged.Set.Repetitions!.Value,
                        logged.Set.Rpe!.Value,
                        logged.Estimate.StrategyKey,
                        logged.Estimate.Version),
                    logged.Estimate,
                    LoggedExplanation(logged, mesocycle.LoadUnit))
                {
                    Logged = logged,
                };
            }
            else if (change.WeekOneWeight is { } weekOneWeight)
            {
                var estimate = EstimateFromWeekOne(
                    weekOne,
                    change.ExerciseId,
                    name,
                    weekOneWeight,
                    mesocycle.LoadUnit,
                    out var anchor);
                lift = new PlannedLift(
                    change.ExerciseId,
                    name,
                    existing,
                    estimate.Value,
                    TrainingMaxSource.WeekOneWeight,
                    new MaxEstimateBasis(
                        decimal.Round(weekOneWeight, 3, MidpointRounding.AwayFromZero),
                        anchor.Repetitions,
                        anchor.Rpe,
                        estimate.StrategyKey,
                        estimate.Version),
                    estimate,
                    estimate.Explanation);
            }
            else
            {
                var typed = change.Value!.Value;
                if (typed is <= 0m or > 2_000m)
                {
                    throw new ArgumentException($"{name}: the training max must be more than 0 and at most 2,000.");
                }

                var value = decimal.Round(typed, 3, MidpointRounding.AwayFromZero);
                lift = new PlannedLift(
                    change.ExerciseId,
                    name,
                    existing,
                    value,
                    TrainingMaxSource.Typed,
                    null,
                    null,
                    string.Create(CultureInfo.InvariantCulture, $"Typed by the coach: {value:0.###} {UnitName(mesocycle.LoadUnit)}."));
            }

            if (lift.NewValue != existing.Value)
            {
                lifts.Add(lift);
            }
        }

        if (lifts.Count == 0)
        {
            throw new ArgumentException("Those are the training maxes already in use. Change at least one.");
        }

        // The sessions that follow the new max: not started, and not before today in the workspace (the
        // same line as replacing a session). Everything else keeps the weights it was given.
        var today = await GetTenantTodayAsync(cancellationToken);
        var changedIds = lifts.Select(item => item.ExerciseId).ToHashSet();
        var calculated = new[]
        {
            TrainingLoadStrategy.PercentageWorkingMax,
            TrainingLoadStrategy.RpeBasedEpley,
            TrainingLoadStrategy.RpeChart,
        };
        var inScope = sessions.Where(item => !item.Session.HasStarted && item.Session.ScheduledDate >= today).ToArray();
        var keptSessions = sessions
            .Where(item => (item.Session.HasStarted || item.Session.ScheduledDate < today) &&
                           item.Session.Exercises.Any(exercise => changedIds.Contains(exercise.ExerciseId) &&
                                                                  exercise.Sets.Any(set => calculated.Contains(set.LoadStrategy))))
            .Select(item => item.Session.Id)
            .Distinct()
            .Count();

        var firstComingWeek = inScope.Length > 0 ? inScope.Min(item => item.Week.WeekNumber) : mesocycle.Weeks.Count;
        var planned = new List<PlannedLift>(lifts.Count);
        foreach (var lift in lifts)
        {
            var fromWeek = inScope
                .Where(item => item.Session.Exercises.Any(exercise => exercise.ExerciseId == lift.ExerciseId &&
                                                                       exercise.Sets.Any(set => calculated.Contains(set.LoadStrategy))))
                .Select(item => (int?)item.Week.WeekNumber)
                .Min() ?? firstComingWeek;
            fromWeek = Math.Clamp(fromWeek, 1, 52);
            var reason = !string.IsNullOrEmpty(coachReason)
                ? coachReason
                : lift.Logged is { } fromLog
                    ? LoggedReason(fromLog, mesocycle.LoadUnit)
                    : lift.Basis is null
                        ? DefaultMaxReason
                        : string.Create(
                            CultureInfo.InvariantCulture,
                            $"Worked out from week 1's weight: {lift.Basis.Load:0.###} {UnitName(mesocycle.LoadUnit)} for {lift.Basis.Repetitions} reps at RPE {lift.Basis.Rpe:0.#}.");
            planned.Add(lift with
            {
                FromWeek = fromWeek,
                Snapshot = lift.Logged is { } logged
                    ? MesocycleWorkingMaxSnapshot.CaptureFromLoggedSet(
                        tenantContext.TenantId,
                        mesocycle.Id,
                        mesocycle.ClientProfileId,
                        lift.ExerciseId,
                        logged,
                        fromWeek,
                        lift.Current.Id,
                        reason)
                    : lift.Basis is { } basis && lift.Estimate is { } estimate
                        ? MesocycleWorkingMaxSnapshot.CaptureFromWeekOneWeight(
                            tenantContext.TenantId,
                            mesocycle.Id,
                            mesocycle.ClientProfileId,
                            lift.ExerciseId,
                            estimate,
                            basis.Load,
                            basis.Repetitions,
                            basis.Rpe,
                            fromWeek,
                            lift.Current.Id,
                            reason)
                        : MesocycleWorkingMaxSnapshot.Capture(
                            tenantContext.TenantId,
                            mesocycle.Id,
                            mesocycle.ClientProfileId,
                            lift.ExerciseId,
                            null,
                            lift.NewValue,
                            unit,
                            fromWeek,
                            lift.Current.Id,
                            reason),
            });
        }

        var newMaxes = planned.ToDictionary(item => item.ExerciseId, item => item.Snapshot!);
        var policy = CreateRoundingPolicy(mesocycle.LoadUnit, mesocycle.LoadIncrement, mesocycle.LoadRoundingMode);
        var sets = new List<PlannedSet>();
        foreach (var (week, session) in inScope)
        {
            foreach (var exercise in session.Exercises.OrderBy(item => item.Position))
            {
                if (!changedIds.Contains(exercise.ExerciseId))
                {
                    continue;
                }

                foreach (var set in exercise.Sets.OrderBy(item => item.Position))
                {
                    if (!calculated.Contains(set.LoadStrategy))
                    {
                        continue;
                    }

                    var recalculated = CalculateSetBlueprint(
                        exercise.ExerciseId,
                        ToBlueprint(set),
                        mesocycle.LoadUnit,
                        policy,
                        newMaxes);
                    sets.Add(new PlannedSet(
                        set,
                        week.WeekNumber,
                        session.ScheduledDate,
                        session.Id,
                        session.Name,
                        exercise.ExerciseId,
                        exercise.ExerciseNameSnapshot,
                        new SetLoadCalculation(
                            recalculated.WorkingMaxSnapshotId!.Value,
                            recalculated.UnroundedRecommendedLoad!.Value,
                            recalculated.PrescribedLoad!.Value,
                            recalculated.CalculationStrategyKey!,
                            recalculated.CalculationStrategyVersion!,
                            recalculated.CalculationExplanation!)));
                }
            }
        }

        var effectiveFromWeek = planned.Min(item => item.FromWeek);
        var hashInput = new MaxesHashInput(
            mesocycle.Id,
            expectedVersion,
            planned.Select(item => new MaxesHashLift(
                item.ExerciseId,
                Canonical(item.NewValue),
                item.Basis is null ? null : Canonical(item.Basis.Load),
                item.Basis?.Repetitions,
                item.Basis is null ? null : Canonical(item.Basis.Rpe),
                item.Logged?.Set.SetId,
                item.FromWeek)).ToArray(),
            sets.OrderBy(item => item.Set.Id).Select(item => new MaxesHashSet(
                item.Set.Id,
                Canonical(item.Calculation.UnroundedRecommendedLoad),
                Canonical(item.Calculation.PrescribedLoad),
                item.Calculation.Explanation)).ToArray());
        var hash = Convert.ToHexString(
            SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(hashInput, MaxesJsonOptions))))
            .ToLowerInvariant();
        return new MaxesPlan(
            hash,
            effectiveFromWeek,
            planned,
            sets.OrderBy(item => item.WeekNumber)
                .ThenBy(item => item.ScheduledDate)
                .ThenBy(item => item.SessionId)
                .ToArray(),
            sets.Select(item => item.SessionId).Distinct().Count(),
            keptSessions);
    }

    /// <summary>The max a week 1 weight implies for a lift of a program version or an assigned program.</summary>
    private static RpeChartMaxEstimate EstimateFromWeekOne(
        TrainingWeekBlueprint? weekOne,
        Guid exerciseId,
        string exerciseName,
        decimal weight,
        TrainingLoadUnit unit,
        out WeekOneAnchor anchor)
    {
        var found = weekOne is null ? null : WeekOneAnchors.Find(weekOne, exerciseId, RtsRpeChart.Covers);
        anchor = found ?? throw new ArgumentException(
            $"Week 1 has no working set of {exerciseName} with a repetition count and an RPE the RTS chart covers " +
            "(RPE 6.5 to 10, 1 to 12 repetitions), so its training max cannot be worked out from week 1's weight. " +
            "Type the training max instead.");
        return RpeChartMaxEstimator.Estimate(weight, found.Repetitions, found.Rpe, ToStrengthUnit(unit));
    }

    private static SetPrescriptionBlueprint ToBlueprint(SetPrescription set) =>
        new(
            set.Position,
            set.SetType,
            set.RepetitionsMinimum,
            set.RepetitionsMaximum,
            set.LoadStrategy,
            set.DirectLoad,
            set.LoadUnit,
            set.PercentageWorkingMax,
            set.TargetRpe,
            set.ExertionDisplayPreference,
            set.RestSeconds,
            set.Tempo,
            set.CoachNotes,
            set.WorkingMaxSnapshotId,
            set.UnroundedRecommendedLoad,
            set.PrescribedLoad,
            set.CalculationStrategyKey,
            set.CalculationStrategyVersion,
            set.CalculationExplanation,
            set.IsManualLoadOverride);

    private static TrainingMaxEntryView ToEntryView(
        MesocycleWorkingMaxSnapshot snapshot,
        TimeZoneInfo timeZone,
        Dictionary<Guid, LoggedSetEvidence> loggedSets) =>
        new(
            snapshot.Id,
            snapshot.Value,
            ToTrainingUnit(snapshot.Unit),
            ToTrainingSource(snapshot.Source),
            snapshot.BasisLoad is { } load
                ? new TrainingMaxBasisView(
                    load,
                    snapshot.BasisRepetitions!.Value,
                    snapshot.BasisRpe!.Value,
                    snapshot.EstimateMethodKey!,
                    snapshot.EstimateMethodVersion!,
                    snapshot.SourceSetPerformanceId is { } setId && loggedSets.TryGetValue(setId, out var set)
                        ? LoggedSetView(set)
                        : null)
                : null,
            snapshot.EffectiveFromWeek,
            DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(snapshot.CreatedAtUtc, timeZone).DateTime),
            snapshot.Reason);

    private static TrainingMaxSource ToTrainingSource(WorkingMaxSource source) => source switch
    {
        WorkingMaxSource.Typed => TrainingMaxSource.Typed,
        WorkingMaxSource.SavedMax => TrainingMaxSource.SavedMax,
        WorkingMaxSource.WeekOneWeight => TrainingMaxSource.WeekOneWeight,
        WorkingMaxSource.LoggedSet => TrainingMaxSource.LoggedSet,
        WorkingMaxSource.PreviousProgram => TrainingMaxSource.PreviousProgram,
        _ => throw new ArgumentOutOfRangeException(nameof(source)),
    };

    private static string UnitName(TrainingLoadUnit unit) => unit == TrainingLoadUnit.Pound ? "lb" : "kg";

    private static string NormalizeMaxReason(string? reason)
    {
        var normalized = reason?.Trim() ?? string.Empty;
        return normalized.Length <= ReasonMaximumLength
            ? normalized
            : throw new ArgumentException($"Keep the reason to {ReasonMaximumLength} characters or fewer.");
    }

    private static string Canonical(decimal value) =>
        decimal.Round(value, 3, MidpointRounding.AwayFromZero).ToString("0.###", CultureInfo.InvariantCulture);

    /// <summary>
    /// Binds an idempotency key to the exact request: a retry of it answers with the first result, and any
    /// change to the lifts, the numbers, the reason or the reviewed preview is another request.
    /// </summary>
    private static string MaxRequestFingerprint(Guid mesocycleId, ApplyTrainingMaxesRequest request, string reason)
    {
        var payload = new
        {
            mesocycleId,
            request.MesocycleVersion,
            changes = (request.Changes ?? [])
                .OrderBy(item => item.ExerciseId)
                .Select(item => new
                {
                    item.ExerciseId,
                    value = item.Value is { } value ? Canonical(value) : null,
                    weekOneWeight = item.WeekOneWeight is { } weight ? Canonical(weight) : null,
                    item.LoggedSetId,
                })
                .ToArray(),
            reason,
            previewHash = request.PreviewHash?.Trim().ToLowerInvariant() ?? string.Empty,
        };
        return Convert.ToHexString(
            SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload, MaxesJsonOptions))))
            .ToLowerInvariant();
    }

    /// <summary>
    /// A write that lost a race: when the winner is this same request, answer with its result; when the
    /// key belongs to another request, say so; otherwise it is an ordinary stale-version conflict.
    /// </summary>
    private async Task<TrainingCommandResult> ReplayOrConflictAsync(
        Guid mesocycleId,
        Guid idempotencyKey,
        string fingerprint,
        CancellationToken cancellationToken)
    {
        dbContext.ChangeTracker.Clear();
        var stored = await dbContext.WorkingMaxUpdates.AsNoTracking()
            .SingleOrDefaultAsync(item => item.IdempotencyKey == idempotencyKey, cancellationToken);
        if (stored is null)
        {
            return ConcurrencyConflict();
        }

        if (stored.MesocycleId != mesocycleId || stored.RequestFingerprint != fingerprint)
        {
            return Conflict("idempotency_conflict", "This idempotency key was already used for another update.");
        }

        var mesocycle = await LoadMesocycleAsync(mesocycleId, tracking: false, cancellationToken);
        return mesocycle is null ? NotFound() : SuccessMesocycle(await ToViewAsync(mesocycle, cancellationToken));
    }

    private static bool IsMaxChainOrKeyViolation(DbUpdateException exception) =>
        exception.InnerException is Npgsql.PostgresException
        {
            SqlState: Npgsql.PostgresErrorCodes.UniqueViolation,
            ConstraintName: DatabaseConstraintNames.OneTrainingMaxUpdatePerKey
                or DatabaseConstraintNames.OneSuccessorPerTrainingMax
                or DatabaseConstraintNames.OneFirstTrainingMaxPerLift,
        };

    /// <summary>
    /// One lift whose max changes: the one in use, the new value and where it comes from. The new snapshot
    /// and the week it applies from are filled in once the sessions that follow it are known.
    /// </summary>
    private sealed record PlannedLift(
        Guid ExerciseId,
        string ExerciseName,
        MesocycleWorkingMaxSnapshot Current,
        decimal NewValue,
        TrainingMaxSource Source,
        MaxEstimateBasis? Basis,
        RpeChartMaxEstimate? Estimate,
        string Explanation)
    {
        public int FromWeek { get; init; } = 1;

        public MesocycleWorkingMaxSnapshot? Snapshot { get; init; }

        /// <summary>The logged set a max is estimated from (STR-007); null for the other sources.</summary>
        public LoggedSetMaxEstimate? Logged { get; init; }
    }

    private sealed record PlannedSet(
        SetPrescription Set,
        int WeekNumber,
        DateOnly ScheduledDate,
        Guid SessionId,
        string SessionName,
        Guid ExerciseId,
        string ExerciseName,
        SetLoadCalculation Calculation)
    {
        public bool IsChanged => Set.PrescribedLoad != Calculation.PrescribedLoad;
    }

    private sealed record MaxesPlan(
        string Hash,
        int EffectiveFromWeek,
        IReadOnlyList<PlannedLift> Lifts,
        IReadOnlyList<PlannedSet> Sets,
        int SessionCount,
        int KeptSessionCount);

    private sealed record MaxesHashLift(
        Guid ExerciseId,
        string NewValue,
        string? BasisLoad,
        int? BasisRepetitions,
        string? BasisRpe,
        Guid? LoggedSetId,
        int FromWeek);

    private sealed record MaxesHashSet(
        Guid SetId,
        string UnroundedLoad,
        string PrescribedLoad,
        string Explanation);

    private sealed record MaxesHashInput(
        Guid MesocycleId,
        uint MesocycleVersion,
        IReadOnlyList<MaxesHashLift> Lifts,
        IReadOnlyList<MaxesHashSet> Sets);
}
