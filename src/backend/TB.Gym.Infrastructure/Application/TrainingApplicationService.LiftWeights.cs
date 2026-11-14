using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Training;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// Applying a weight (notes plan N6c, STR-020; decision 21: the coach applies, never the app or the client). The
/// coach sends, per lift, the sets where it stands moves and the weights the read gave them; the apply judges the
/// lift again with <c>LastTimeStep</c> v1 and writes only when the answer still says exactly that, so nothing is
/// worked out here and nothing the coach did not read is written. Each lift leaves an append-only record of what
/// the rule read and what changed; the program's version moves on, so a start, an edit or another apply that read
/// it before is refused and asked to read again.
/// </summary>
internal sealed partial class TrainingApplicationService
{
    /// <summary>"Apply all" for one client: every lift with a step in its coming sessions, and room to spare.</summary>
    private const int MaximumLiftsPerApply = 100;

    private const int MaximumSetsPerLift = 20;

    private static readonly JsonSerializerOptions LiftWeightJsonOptions = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    public async Task<TrainingCommandResult> ApplyLiftWeightsAsync(
        Guid clientProfileId,
        ApplyLiftWeightsRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (request.IdempotencyKey == Guid.Empty)
        {
            return Invalid("idempotencyKey", "A non-empty idempotency key is required.");
        }

        if (LiftWeightRequestProblem(request) is { } problem)
        {
            return Invalid("lifts", problem);
        }

        // The tenant handler has already answered another coach's client as missing and refused a released one
        // for this route's client (ADR 0026, ADR 0027); the scope is asked again for whoever it did not judge.
        if (!await dbContext.ClientProfiles.AsNoTracking().AnyAsync(item => item.Id == clientProfileId, cancellationToken) ||
            await coachClientScope.ExcludesFromCoachingAsync(clientProfileId, cancellationToken))
        {
            return NotFound();
        }

        await coachClientScope.EnsureNotReleasedAsync(clientProfileId, cancellationToken);

        // Where a lift stands is read on the coach's Training read, so applying it opens and closes with that (TRN-023).
        if (!(await GetCoachTrainingAccessAsync(clientProfileId, cancellationToken)).IsAllowed)
        {
            return new TrainingCommandResult(TrainingCommandStatus.Forbidden);
        }

        var fingerprint = LiftWeightsFingerprint(clientProfileId, request);
        if (await LiftWeightsReplayAsync(clientProfileId, request.IdempotencyKey, fingerprint, cancellationToken) is { } replay)
        {
            return replay;
        }

        // The rule judges every lift again now; the request must name exactly what it moves, as the coach read it.
        var standings = (await ReadLiftStandingsAsync(clientProfileId, cancellationToken))
            .ToDictionary(item => item.ExercisePrescriptionId);
        var lifts = new List<(LiftStandingView View, IReadOnlyList<SetStanding> Sets)>(request.Lifts.Count);
        foreach (var lift in request.Lifts)
        {
            if (!standings.TryGetValue(lift.ExercisePrescriptionId, out var view))
            {
                return await ReplayOrStandingChangedAsync(clientProfileId, request.IdempotencyKey, fingerprint,
                    cancellationToken);
            }

            var sets = LastTimeStepRule.SetsToApply(view.Standing);
            if (!SameSets(sets, lift.Sets))
            {
                // An identical request that won a moment ago left these sets at their new weight: its answer is ours.
                return await ReplayOrStandingChangedAsync(clientProfileId, request.IdempotencyKey, fingerprint,
                    cancellationToken);
            }

            lifts.Add((view, sets));
        }

        try
        {
            foreach (var block in lifts.GroupBy(item => item.View.MesocycleId))
            {
                var mesocycle = await LoadMesocycleAsync(block.Key, tracking: true, cancellationToken);
                if (mesocycle is null || mesocycle.ClientProfileId != clientProfileId)
                {
                    return await ReplayOrStandingChangedAsync(clientProfileId, request.IdempotencyKey, fingerprint,
                        cancellationToken);
                }

                // The day the rule judged the lifts on, in this program's calendar, draws the line of what is open.
                mesocycle.ApplyLiftWeights(
                    block.SelectMany(item => item.Sets.Select(set => (item.View, Set: set)))
                        .ToDictionary(
                            item => item.Set.SetPrescriptionId,
                            item => new AppliedLiftWeight(
                                item.Set.CurrentWeight,
                                item.Set.Weight!.Value,
                                item.Set.Unit,
                                LastTimeStepRule.Explain(item.View.Standing, item.Set))),
                    block.First().View.Standing.JudgedOn);
            }

            var records = lifts.Select(item =>
            {
                var applied = item.Sets.Select(set => new AppliedLiftSet(
                    set.SetPrescriptionId,
                    set.SetNumber,
                    set.Move,
                    set.CurrentWeight,
                    set.Weight!.Value,
                    set.Unit,
                    set.Step)).ToArray();
                return LiftWeightApplication.Record(
                    tenantContext.TenantId,
                    clientProfileId,
                    new LiftWeightTarget(
                        item.View.MesocycleId,
                        item.View.SessionId,
                        item.View.SessionName,
                        item.View.SessionDate,
                        item.View.ExercisePrescriptionId,
                        item.View.ExerciseId,
                        item.View.ExerciseName,
                        item.View.Occurrence),
                    item.View.Standing,
                    applied,
                    request.IdempotencyKey,
                    fingerprint,
                    JsonSerializer.Serialize(item.View, LiftWeightJsonOptions),
                    JsonSerializer.Serialize(applied, LiftWeightJsonOptions));
            }).ToArray();
            dbContext.LiftWeightApplications.AddRange(records);
            await dbContext.SaveChangesAsync(cancellationToken);
            return LiftWeightsApplied(clientProfileId, records);
        }
        catch (InvalidOperationException exception)
        {
            dbContext.ChangeTracker.Clear();
            return await LiftWeightsReplayAsync(clientProfileId, request.IdempotencyKey, fingerprint, cancellationToken)
                   ?? Conflict("lift_standing_changed", exception.PersonMessage());
        }
        catch (ArgumentException)
        {
            // The program changed between the rule's read and its load, as when Edit weeks replaced the session.
            dbContext.ChangeTracker.Clear();
            return await ReplayOrStandingChangedAsync(clientProfileId, request.IdempotencyKey, fingerprint,
                cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return await LiftWeightsReplayOrConflictAsync(
                clientProfileId, request.IdempotencyKey, fingerprint, cancellationToken);
        }
        catch (DbUpdateException exception) when (IsLiftWeightKeyViolation(exception) ||
                                                   IsLiftWeightRequestViolation(exception))
        {
            return await LiftWeightsReplayOrConflictAsync(
                clientProfileId, request.IdempotencyKey, fingerprint, cancellationToken);
        }
        catch (Exception exception) when (IsRefusedAsStarted(exception))
        {
            // A workout started between the read and the save: the database keeps its sets as they were.
            dbContext.ChangeTracker.Clear();
            return await ReplayOrStandingChangedAsync(clientProfileId, request.IdempotencyKey, fingerprint,
                cancellationToken);
        }
    }

    /// <summary>
    /// The history triggers' refusal (55000, a started session's sets), wherever it sits: Npgsql counts it as
    /// transient, so the context's retrying strategy runs the save again and hands it over inside its own
    /// exception once its retries are spent.
    /// </summary>
    private static bool IsRefusedAsStarted(Exception exception)
    {
        for (var current = exception; current is not null; current = current.InnerException)
        {
            if (current is Npgsql.PostgresException
                {
                    SqlState: Npgsql.PostgresErrorCodes.ObjectNotInPrerequisiteState,
                })
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>
    /// The client's line for each writing whose weight a coach applied (N6c, STR-020): the latest record of that
    /// writing, only while every set it wrote still holds the weight it wrote. Asked only for exercises with a set
    /// whose calculation names <c>LastTimeStep</c>, so a read with none makes no query, and one query otherwise.
    /// </summary>
    private async Task<IReadOnlyDictionary<Guid, ClientWeightNoteView>> ReadWeightNotesAsync(
        IReadOnlyList<WeightNoteCandidate> candidates,
        CancellationToken cancellationToken)
    {
        if (candidates.Count == 0)
        {
            return new Dictionary<Guid, ClientWeightNoteView>();
        }

        var ids = candidates.Select(item => item.ExercisePrescriptionId).Distinct().ToArray();
        var rows = await dbContext.LiftWeightApplications.AsNoTracking()
            .Where(item => ids.Contains(item.ExercisePrescriptionId))
            .Select(item => new
            {
                item.Id,
                item.ExercisePrescriptionId,
                item.CreatedAtUtc,
                item.StandingJson,
                item.AppliedSetsJson,
            })
            .ToListAsync(cancellationToken);
        var latest = rows
            .GroupBy(item => item.ExercisePrescriptionId)
            .ToDictionary(
                group => group.Key,
                group => group.OrderByDescending(item => item.CreatedAtUtc).ThenByDescending(item => item.Id).First());
        var notes = new Dictionary<Guid, ClientWeightNoteView>();
        foreach (var candidate in candidates)
        {
            if (!latest.TryGetValue(candidate.ExercisePrescriptionId, out var row))
            {
                continue;
            }

            var view = JsonSerializer.Deserialize<LiftStandingView>(row.StandingJson, LiftWeightJsonOptions);
            var sets = JsonSerializer.Deserialize<AppliedLiftSet[]>(row.AppliedSetsJson, LiftWeightJsonOptions);
            if (view is null || sets is not { Length: > 0 })
            {
                continue;
            }

            // True only while every set the line speaks of still holds the weight the apply left it at.
            var unit = sets[0].Unit;
            if (!LiftWeightNotes.HeldWeights(view, sets).All(held =>
                    candidate.Weights.TryGetValue(held.Key, out var now) && now.Weight == held.Value && now.Unit == unit))
            {
                continue;
            }

            if (LiftWeightNotes.For(view, sets) is { } note)
            {
                notes[candidate.ExercisePrescriptionId] = note;
            }
        }

        return notes;
    }

    /// <summary>The writings of a not-started session whose sets carry an applied weight.</summary>
    private static IEnumerable<WeightNoteCandidate> WeightNoteCandidates(TrainingSession session) =>
        session.Exercises
            .Where(exercise => exercise.Sets.Any(set => set.CalculationStrategyKey == LastTimeStepRule.Key))
            .Select(exercise => new WeightNoteCandidate(
                exercise.Id,
                exercise.Sets.ToDictionary(
                    set => set.Id,
                    set => (set.PrescribedLoad ?? set.DirectLoad, set.LoadUnit))));

    /// <summary>
    /// The writings of a running workout whose snapshot started at an applied weight, done as written: a swapped
    /// lift's sets are another exercise's, for which the coach's weight was never meant (TRN-029).
    /// </summary>
    private static IEnumerable<WeightNoteCandidate> WeightNoteCandidates(WorkoutExecution execution) =>
        execution.Status != WorkoutExecutionStatus.InProgress
            ? []
            : execution.Exercises
                .Where(exercise => !exercise.WasSubstituted &&
                                   exercise.ExercisePrescriptionId is not null &&
                                   exercise.Sets.Any(set => set.CalculationStrategyKeySnapshot == LastTimeStepRule.Key))
                .Select(exercise => new WeightNoteCandidate(
                    exercise.ExercisePrescriptionId!.Value,
                    exercise.Sets.Where(set => set.SetPrescriptionId is not null).ToDictionary(
                        set => set.SetPrescriptionId!.Value,
                        set => (set.PrescribedLoad, set.PrescribedLoadUnit))));

    private sealed record WeightNoteCandidate(
        Guid ExercisePrescriptionId,
        IReadOnlyDictionary<Guid, (decimal? Weight, TrainingLoadUnit? Unit)> Weights);

    /// <summary>What is wrong with the request's shape, before anything is read; null when nothing is.</summary>
    private static string? LiftWeightRequestProblem(ApplyLiftWeightsRequest request)
    {
        if (request.Lifts is not { Count: > 0 } lifts)
        {
            return "Name at least one lift to apply.";
        }

        if (lifts.Count > MaximumLiftsPerApply)
        {
            return $"Apply at most {MaximumLiftsPerApply} lifts at once.";
        }

        if (lifts.Any(lift => lift is null) ||
            lifts.Select(lift => lift.ExercisePrescriptionId).Distinct().Count() != lifts.Count)
        {
            return "Name each lift once.";
        }

        foreach (var lift in lifts)
        {
            if (lift.Sets is not { Count: > 0 } sets || sets.Count > MaximumSetsPerLift || sets.Any(set => set is null))
            {
                return $"Name the sets to apply for each lift, {MaximumSetsPerLift} at most.";
            }

            if (sets.Select(set => set.SetPrescriptionId).Distinct().Count() != sets.Count)
            {
                return "Name each set once.";
            }

            if (sets.Any(set => !IsAppliedWeight(set.Weight) ||
                                set.CurrentWeight is { } current && !IsAppliedWeight(current)))
            {
                return "A weight is more than 0 and at most 2,000, to three decimals.";
            }
        }

        return null;
    }

    private static bool IsAppliedWeight(decimal weight) =>
        weight > 0m &&
        weight <= LastTimeStepRule.MaximumWeight &&
        decimal.Round(weight, 3, MidpointRounding.AwayFromZero) == weight;

    /// <summary>Whether the request names exactly the sets the answer moves now, each from and to the same weight.</summary>
    private static bool SameSets(IReadOnlyList<SetStanding> moving, IReadOnlyList<SetWeightRequest> requested) =>
        moving.Count == requested.Count &&
        moving.All(set => requested.Any(item =>
            item.SetPrescriptionId == set.SetPrescriptionId &&
            item.CurrentWeight == set.CurrentWeight &&
            item.Weight == set.Weight));

    /// <summary>
    /// Binds the key to the exact request: the client, and every lift's sets with the weights they come from and go
    /// to, in a fixed order. A retry of it answers with the first result; anything else under the key is refused.
    /// </summary>
    private static string LiftWeightsFingerprint(Guid clientProfileId, ApplyLiftWeightsRequest request)
    {
        var payload = new
        {
            clientProfileId,
            lifts = request.Lifts
                .OrderBy(lift => lift.ExercisePrescriptionId)
                .Select(lift => new
                {
                    lift.ExercisePrescriptionId,
                    sets = lift.Sets
                        .OrderBy(set => set.SetPrescriptionId)
                        .Select(set => new
                        {
                            set.SetPrescriptionId,
                            currentWeight = set.CurrentWeight is { } current ? Canonical(current) : null,
                            weight = Canonical(set.Weight),
                        })
                        .ToArray(),
                })
                .ToArray(),
        };
        return Convert.ToHexString(
                SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload, LiftWeightJsonOptions))))
            .ToLowerInvariant();
    }

    /// <summary>The first answer again for a retry of the same request; a conflict for another request under its key.</summary>
    private async Task<TrainingCommandResult?> LiftWeightsReplayAsync(
        Guid clientProfileId,
        Guid idempotencyKey,
        string fingerprint,
        CancellationToken cancellationToken)
    {
        var stored = await dbContext.LiftWeightApplications.AsNoTracking()
            .Where(item => item.IdempotencyKey == idempotencyKey)
            .OrderBy(item => item.Id)
            .ToListAsync(cancellationToken);
        if (stored.Count == 0)
        {
            return null;
        }

        return stored.All(item => item.ClientProfileId == clientProfileId && item.RequestFingerprint == fingerprint)
            ? LiftWeightsApplied(clientProfileId, stored)
            : Conflict("idempotency_conflict", "This idempotency key was already used for another request.");
    }

    /// <summary>
    /// An apply that lost a race: the winner may be this same request (answer with its result), another request
    /// under this key (say so), or another apply or start on the same program (read again and apply).
    /// </summary>
    private async Task<TrainingCommandResult> LiftWeightsReplayOrConflictAsync(
        Guid clientProfileId,
        Guid idempotencyKey,
        string fingerprint,
        CancellationToken cancellationToken)
    {
        dbContext.ChangeTracker.Clear();
        return await LiftWeightsReplayAsync(clientProfileId, idempotencyKey, fingerprint, cancellationToken)
               ?? ConcurrencyConflict();
    }

    private static TrainingCommandResult LiftStandingChanged() =>
        Conflict(
            "lift_standing_changed",
            "Where this lift stands changed since it was read. Read it again, then apply.");

    /// <summary>The first answer when this very request already went through; otherwise, read it again.</summary>
    private async Task<TrainingCommandResult> ReplayOrStandingChangedAsync(
        Guid clientProfileId,
        Guid idempotencyKey,
        string fingerprint,
        CancellationToken cancellationToken) =>
        await LiftWeightsReplayAsync(clientProfileId, idempotencyKey, fingerprint, cancellationToken)
        ?? LiftStandingChanged();

    /// <summary>
    /// The answer, the same on a retry as the first time: lifts in a fixed order, and the moment to the microsecond,
    /// as the database keeps it.
    /// </summary>
    private static TrainingCommandResult LiftWeightsApplied(
        Guid clientProfileId,
        IReadOnlyList<LiftWeightApplication> records) =>
        new(
            TrainingCommandStatus.Success,
            LiftWeights: new LiftWeightsAppliedView(
                clientProfileId,
                records.OrderBy(record => record.ExercisePrescriptionId).Select(record => new AppliedLiftWeightView(
                    record.Id,
                    record.MesocycleId,
                    record.TrainingSessionId,
                    record.SessionName,
                    record.SessionDate,
                    record.ExercisePrescriptionId,
                    record.ExerciseId,
                    record.ExerciseName,
                    (JsonSerializer.Deserialize<AppliedLiftSet[]>(record.AppliedSetsJson, LiftWeightJsonOptions) ?? [])
                    .Select(set => new AppliedLiftSetView(
                        set.SetPrescriptionId,
                        set.SetNumber,
                        set.Move,
                        set.WeightBefore,
                        set.WeightAfter,
                        set.Unit,
                        set.Step))
                    .ToArray(),
                    new DateTimeOffset(
                        record.CreatedAtUtc.Ticks - record.CreatedAtUtc.Ticks % 10,
                        record.CreatedAtUtc.Offset))).ToArray()));

    /// <summary>Another request under this key at the same moment: the database holds one request per key.</summary>
    private static bool IsLiftWeightRequestViolation(DbUpdateException exception) =>
        exception.InnerException is Npgsql.PostgresException
        {
            SqlState: Npgsql.PostgresErrorCodes.ExclusionViolation,
            ConstraintName: DatabaseConstraintNames.OneLiftWeightRequestPerKey,
        };

    private static bool IsLiftWeightKeyViolation(DbUpdateException exception) =>
        exception.InnerException is Npgsql.PostgresException
        {
            SqlState: Npgsql.PostgresErrorCodes.UniqueViolation,
            ConstraintName: DatabaseConstraintNames.OneLiftWeightApplicationPerKeyAndLift,
        };
}
