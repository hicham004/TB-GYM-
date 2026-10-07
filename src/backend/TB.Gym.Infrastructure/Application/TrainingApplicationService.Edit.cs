using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using TB.Gym.Modules.Strength;
using TB.Gym.Modules.Training;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// Editing a client's weeks in the builder's grid (TRN-028, P3b, ADR 0036). The coach sends the open sessions of
/// every week as the grid holds them; preview works out what that changes, with every weight, and saves nothing.
/// Apply runs the same planning again, checks the hash, the program's version, the training coverage and
/// overlap, carries the change out in one save and records it. Started, finished and past sessions are never
/// in a request and never change.
/// </summary>
internal sealed partial class TrainingApplicationService
{
    private static readonly JsonSerializerOptions ProgramEditJsonOptions = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    public async Task<ProgramEditPreviewView?> PreviewProgramEditAsync(
        Guid mesocycleId,
        PreviewProgramEditRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var mesocycle = await LoadMesocycleAsync(mesocycleId, tracking: false, cancellationToken);
        if (mesocycle is null)
        {
            return null;
        }

        var built = await BuildProgramEditAsync(mesocycle, request.MesocycleVersion, request.Weeks, cancellationToken);
        var plan = built.Plan;
        return new ProgramEditPreviewView(
            built.Hash,
            ProgramEditRules.Key,
            ProgramEditRules.CurrentVersion,
            plan.Today,
            plan.FrozenWeekCount,
            plan.Weeks.Count,
            mesocycle.EndDateExclusive,
            built.ResultingEndDateExclusive,
            built.IsInsideTrainingCoverage,
            built.Problems,
            plan.WeeksAdded,
            plan.WeeksMoved,
            plan.WeeksRemoved,
            plan.SessionsAdded,
            plan.SessionsEdited,
            plan.SessionsMoved,
            plan.SessionsRemoved,
            plan.WeekChanges.Select(change => new ProgramEditWeekChangeView(
                change.Kind,
                change.WeekNumber,
                change.PreviousWeekNumber,
                change.Label,
                change.IsShared)).ToArray(),
            plan.SessionChanges.Select(change => new ProgramEditSessionChangeView(
                change.Kind,
                change.Existing?.Id,
                change.WeekNumber,
                change.Date,
                change.PreviousWeekNumber,
                change.PreviousDate,
                change.Name,
                change.WeekIsShared,
                change.PlannedKey is { } key && change.Kind != ProgramEditChangeKind.Moved
                    ? ToPreviewSessionView(built.Blueprints[key], 0)
                    : null)).ToArray());
    }

    public async Task<TrainingCommandResult> ApplyProgramEditAsync(
        Guid mesocycleId,
        ApplyProgramEditRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        // The write loader also answers another coach's client as missing and refuses a released client.
        var mesocycle = await LoadMesocycleAsync(mesocycleId, tracking: true, cancellationToken);
        if (mesocycle is null)
        {
            return NotFound();
        }

        try
        {
            var built = await BuildProgramEditAsync(mesocycle, request.MesocycleVersion, request.Weeks, cancellationToken);
            if (!HashesEqual(built.Hash, request.PreviewHash))
            {
                return Conflict(
                    "program_edit_preview_changed",
                    "The program no longer matches the changes you reviewed. Review them again before applying.");
            }

            if (!built.Plan.HasChanges)
            {
                return Invalid("edit", "There is nothing to change.");
            }

            if (built.Problems.Count > 0)
            {
                return Invalid("edit", built.Problems[0]);
            }

            // The record keeps each session as it was, so it is written before an edited one changes in place.
            var changes = ChangesJson(built.Plan);
            dbContext.Entry(mesocycle).Property(item => item.Version).OriginalValue = request.MesocycleVersion;
            var applied = mesocycle.ApplyProgramEdit(built.Plan, built.Blueprints);

            // Taken-out rows go with everything under them. New rows are named explicitly, each one: a key made
            // in the application would otherwise be taken for a row that already exists, and once rows are
            // taken out the change tracker can meet the new ones through a tracked week before they are added.
            dbContext.MesocycleWeeks.RemoveRange(applied.RemovedWeeks);
            dbContext.TrainingSessions.RemoveRange(applied.RemovedSessions);
            foreach (var week in applied.AddedWeeks)
            {
                dbContext.Entry(week).State = EntityState.Added;
                TrackAsAdded(week.Sessions);
            }

            TrackAsAdded(applied.AddedSessions);
            TrackAsAdded(applied.ReplacedSessions.SelectMany(session => session.Exercises));
            dbContext.ProgramEdits.Add(ProgramEdit.Record(
                tenantContext.TenantId,
                mesocycle.Id,
                built.Hash,
                built.Plan,
                mesocycle.EndDateExclusive,
                changes));
            await dbContext.SaveChangesAsync(cancellationToken);
            return SuccessMesocycle(await ToViewAsync(mesocycle, cancellationToken));
        }
        catch (ArgumentException exception)
        {
            return Invalid("edit", ReadableMessage(exception));
        }
        catch (InvalidOperationException exception)
        {
            return Conflict("program_edit_conflict", exception.Message);
        }
        catch (DbUpdateConcurrencyException)
        {
            return ConcurrencyConflict();
        }
        catch (DbUpdateException exception) when (IsExclusionViolation(exception))
        {
            dbContext.ChangeTracker.Clear();
            return await PrimaryOverlapConflictAsync(
                mesocycle.ClientProfileId,
                mesocycle.StartDate,
                mesocycle.StartDate.AddDays(checked(request.Weeks.Count * 7)),
                mesocycle.Id,
                cancellationToken);
        }
        catch (DbUpdateException)
        {
            return Conflict("program_edit_conflict", "The changes conflict with the program as it is now. Reload it and try again.");
        }
    }

    /// <summary>
    /// Works out what a requested grid would do, without saving anything: the plan, the prescription of every
    /// session that is new or changed (weights worked out from the program's maxes by each set's own formula),
    /// and whether the result stays inside the plan. Preview and apply both run this, so the hash proves they agree.
    /// </summary>
    private async Task<ProgramEditBuild> BuildProgramEditAsync(
        TrainingMesocycle mesocycle,
        uint expectedVersion,
        IReadOnlyList<ProgramEditWeekRequest> weeks,
        CancellationToken cancellationToken)
    {
        if (mesocycle.Version != expectedVersion)
        {
            throw new InvalidOperationException(
                "The program changed after you opened it. Reload it to see the latest, then make your changes again.");
        }

        var today = await GetTenantTodayAsync(cancellationToken);
        var plan = ProgramEditPlanner.Plan(mesocycle, weeks, today);

        var workingMaxes = await LoadWorkingMaxDictionaryAsync(mesocycle.Id, cancellationToken);
        var rounding = CreateRoundingPolicy(mesocycle.LoadUnit, mesocycle.LoadIncrement, mesocycle.LoadRoundingMode);
        var blueprints = new SortedDictionary<int, TrainingSessionBlueprint>();

        // A session that is new or changed is built from the request; one that only moves, or is built again
        // as it is, keeps what is stored, weights and all.
        var needed = plan.Weeks
            .SelectMany(week => week.Sessions.Select(session => (Week: week, Session: session)))
            .Where(item => item.Session.NeedsBlueprint)
            .ToArray();
        var fromRequest = needed
            .Where(item => item.Session.Existing is null || item.Session.ContentChanged)
            .ToArray();
        foreach (var (_, session) in needed.Where(item => item.Session.Existing is not null && !item.Session.ContentChanged))
        {
            blueprints[session.Key] = ToBlueprint(session.Existing!);
        }

        var built = await BuildSessionBlueprintsAsync(
            fromRequest.Select(item => (Where: PlaceOf(item.Week, item.Session), item.Session.Request)).ToArray(),
            cancellationToken);
        for (var index = 0; index < fromRequest.Length; index++)
        {
            var (week, session) = fromRequest[index];
            var blueprint = built[index];
            blueprints[session.Key] = Located(PlaceOf(week, session), () =>
            {
                RequireWorkingMaxes(blueprint, workingMaxes);
                var calculated = CalculateSessionBlueprint(blueprint, mesocycle.LoadUnit, rounding, workingMaxes);
                ProgramEditRules.EnsureValid(calculated);
                return calculated;
            });
        }

        var resultingEnd = plan.ResultingEndDateExclusive(mesocycle.StartDate);
        var problems = new List<string>();
        var coverage = await EvaluateCoverageAsync(
            mesocycle.ClientProfileId,
            mesocycle.EnrollmentId,
            mesocycle.StartDate,
            resultingEnd,
            cancellationToken);
        var inside = coverage.Exists && coverage.Decision.IsAuthorized;
        if (!inside)
        {
            problems.Add(await CoverageProblemAsync(mesocycle, resultingEnd, coverage.Decision.Reason, cancellationToken));
        }

        if (resultingEnd > mesocycle.EndDateExclusive &&
            await HasPrimaryOverlapAsync(
                mesocycle.ClientProfileId, mesocycle.StartDate, resultingEnd, mesocycle.Id, cancellationToken))
        {
            problems.Add((await PrimaryOverlapConflictAsync(
                mesocycle.ClientProfileId, mesocycle.StartDate, resultingEnd, mesocycle.Id, cancellationToken)).Message!);
        }

        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(
            new ProgramEditHashInput(mesocycle.Id, expectedVersion, today, weeks, blueprints.Values.ToArray()),
            ProgramEditJsonOptions)))).ToLowerInvariant();
        return new ProgramEditBuild(plan, blueprints, hash, resultingEnd, inside, problems);
    }

    private void TrackAsAdded(IEnumerable<TrainingSession> sessions)
    {
        foreach (var session in sessions)
        {
            dbContext.Entry(session).State = EntityState.Added;
            TrackAsAdded(session.Exercises);
        }
    }

    private void TrackAsAdded(IEnumerable<ExercisePrescription> exercises)
    {
        foreach (var exercise in exercises)
        {
            dbContext.Entry(exercise).State = EntityState.Added;
            foreach (var row in exercise.Sets.Cast<object>().Concat(exercise.Alternatives).Concat(exercise.Media))
            {
                dbContext.Entry(row).State = EntityState.Added;
            }
        }
    }

    private static string PlaceOf(PlannedWeek week, PlannedSession session) =>
        string.IsNullOrWhiteSpace(session.Request.Name)
            ? $"Week {week.Number}, {session.Date.ToString("ddd d MMM", CultureInfo.InvariantCulture)}"
            : $"Week {week.Number}, {session.Request.Name.Trim()}";

    /// <summary>
    /// The requests as blueprints: exercise names and current pictures read once for all of them, and a
    /// refusal (an archived lift, a set that breaks a limit) saying which week and session it is about.
    /// </summary>
    private async Task<IReadOnlyList<TrainingSessionBlueprint>> BuildSessionBlueprintsAsync(
        (string Where, TrainingSessionRequest Request)[] items,
        CancellationToken cancellationToken)
    {
        if (items.Length == 0)
        {
            return [];
        }

        var ids = items
            .SelectMany(item => (item.Request.Exercises ?? [])
                .SelectMany(exercise => (exercise.ApprovedAlternativeExerciseIds ?? []).Prepend(exercise.ExerciseId)))
            .Distinct()
            .ToArray();
        var names = await dbContext.Exercises.AsNoTracking()
            .Where(item => ids.Contains(item.Id) && !item.IsArchived)
            .ToDictionaryAsync(item => item.Id, item => item.Name, cancellationToken);
        var blueprints = items
            .Select(item => Located(item.Where, () =>
            {
                if ((item.Request.Exercises ?? []).SelectMany(exercise =>
                        (exercise.ApprovedAlternativeExerciseIds ?? []).Prepend(exercise.ExerciseId))
                    .Any(id => !names.ContainsKey(id)))
                {
                    throw new ArgumentException("an exercise here is archived or no longer in your library.");
                }

                return ToBlueprint(item.Request, names);
            }))
            .ToArray();
        var withMedia = await AttachCurrentMediaAsync(
            new ProgramBlueprint("Session media snapshot", null, [new TrainingWeekBlueprint(null, true, blueprints)]),
            cancellationToken);
        return withMedia.Weeks[0].Sessions;
    }

    /// <summary>A lift can take its weight from the program's max only if the program has one for it.</summary>
    private static void RequireWorkingMaxes(
        TrainingSessionBlueprint session,
        Dictionary<Guid, MesocycleWorkingMaxSnapshot> workingMaxes)
    {
        foreach (var exercise in session.Exercises)
        {
            if (!workingMaxes.ContainsKey(exercise.ExerciseId) &&
                exercise.Sets.Any(set => set.LoadStrategy is TrainingLoadStrategy.PercentageWorkingMax
                    or TrainingLoadStrategy.RpeBasedEpley or TrainingLoadStrategy.RpeChart))
            {
                throw new ArgumentException(
                    $"{exercise.ExerciseNameSnapshot} has no training max in this program. Type a weight for it, or choose a lift that has one.");
            }
        }
    }

    private async Task<string> CoverageProblemAsync(
        TrainingMesocycle mesocycle,
        DateOnly resultingEnd,
        string? reason,
        CancellationToken cancellationToken)
    {
        var planEnd = await dbContext.ClientEnrollments.AsNoTracking()
            .Where(item => item.Id == mesocycle.EnrollmentId)
            .Select(item => (DateOnly?)item.EndDateExclusive)
            .SingleOrDefaultAsync(cancellationToken);
        if (planEnd is { } end && resultingEnd > end)
        {
            var culture = CultureInfo.InvariantCulture;
            return $"The program would run until {resultingEnd.AddDays(-1).ToString("ddd d MMM yyyy", culture)}, but the plan it belongs to ends {end.AddDays(-1).ToString("ddd d MMM yyyy", culture)}. Remove a week, or renew the plan first.";
        }

        return reason ?? "The program is outside what the plan covers.";
    }

    /// <summary>
    /// What is kept of the edit: each change, and every changed or removed session as it was before, so the
    /// program's history is never lost to a later edit (TRN-028). A record too big to keep whole keeps the
    /// changes without the old prescriptions.
    /// </summary>
    private static string ChangesJson(ProgramEditPlan plan)
    {
        var json = SerializeChanges(plan, includeBefore: true);
        return json.Length <= ProgramEdit.MaximumChangesLength ? json : SerializeChanges(plan, includeBefore: false);
    }

    private static string SerializeChanges(ProgramEditPlan plan, bool includeBefore) =>
        JsonSerializer.Serialize(
            new
            {
                rule = new { key = ProgramEditRules.Key, version = ProgramEditRules.CurrentVersion },
                today = plan.Today,
                beforeKept = includeBefore,
                weeks = plan.WeekChanges,
                sessions = plan.SessionChanges.Select(change => new
                {
                    change.Kind,
                    change.WeekNumber,
                    change.Date,
                    change.PreviousWeekNumber,
                    change.PreviousDate,
                    change.Name,
                    shared = change.WeekIsShared,
                    before = includeBefore &&
                             change.Kind is ProgramEditChangeKind.Edited or ProgramEditChangeKind.Removed &&
                             change.Existing is { } stored
                        ? ToBlueprint(stored)
                        : null,
                }),
            },
            ProgramEditJsonOptions);

    /// <summary>An exception's sentence without the "(Parameter 'x')" the framework appends.</summary>
    private static string ReadableMessage(ArgumentException exception)
    {
        var message = exception.Message;
        var suffix = message.IndexOf(" (Parameter '", StringComparison.Ordinal);
        return suffix < 0 ? message : message[..suffix];
    }

    private sealed record ProgramEditBuild(
        ProgramEditPlan Plan,
        IReadOnlyDictionary<int, TrainingSessionBlueprint> Blueprints,
        string Hash,
        DateOnly ResultingEndDateExclusive,
        bool IsInsideTrainingCoverage,
        IReadOnlyList<string> Problems);

    private sealed record ProgramEditHashInput(
        Guid MesocycleId,
        uint MesocycleVersion,
        DateOnly Today,
        IReadOnlyList<ProgramEditWeekRequest> Weeks,
        IReadOnlyList<TrainingSessionBlueprint> Blueprints);
}
