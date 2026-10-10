using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TB.Gym.Modules.Strength;
using TB.Gym.Modules.Training;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// Build next block (STR-006, STR-009, P3a): the chosen weeks of an assigned program, copied after its last
/// week, each copy a further WeekStep v1 step away (TRN-025), with the weights worked out again from the
/// program's maxes by each set's own formula. Preview saves nothing; apply recomputes it, checks the hash,
/// the program's version and the training coverage, and records what it did.
/// </summary>
internal sealed partial class TrainingApplicationService
{
    private static readonly JsonSerializerOptions ProgressionJsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<ProgressionPreviewView?> PreviewProgressionAsync(
        Guid mesocycleId,
        ProgressionPreviewRequest request,
        CancellationToken cancellationToken)
    {
        var mesocycle = await LoadMesocycleAsync(mesocycleId, tracking: false, cancellationToken);
        if (mesocycle is null)
        {
            return null;
        }

        var preview = await BuildProgressionAsync(
            mesocycle,
            request.SourceWeekIds,
            request.Iterations,
            request.ToSteps(),
            request.MesocycleVersion,
            cancellationToken);
        var resultingEndDate = mesocycle.StartDate.AddDays(
            checked((mesocycle.Weeks.Count + preview.GeneratedWeeks.Count) * 7));
        var coverage = await EvaluateCoverageAsync(
            mesocycle.ClientProfileId,
            mesocycle.EnrollmentId,
            mesocycle.StartDate,
            resultingEndDate,
            cancellationToken);
        return new ProgressionPreviewView(
            preview.Hash,
            WeekStepProgressionTransform.Key,
            WeekStepProgressionTransform.CurrentVersion,
            mesocycle.Weeks.Count + preview.GeneratedWeeks.Count,
            resultingEndDate,
            coverage.Exists && coverage.Decision.IsAuthorized,
            coverage.Decision.Reason,
            preview.GeneratedWeeks.Select((week, index) =>
                ToPreviewView(week, mesocycle.Weeks.Count + index + 1)).ToArray());
    }

    public async Task<TrainingCommandResult> ApplyProgressionAsync(
        Guid mesocycleId,
        ApplyProgressionRequest request,
        CancellationToken cancellationToken)
    {
        var mesocycle = await LoadMesocycleAsync(mesocycleId, tracking: true, cancellationToken);
        if (mesocycle is null)
        {
            return NotFound();
        }

        try
        {
            var preview = await BuildProgressionAsync(
                mesocycle,
                request.SourceWeekIds,
                request.Iterations,
                request.ToSteps(),
                request.MesocycleVersion,
                cancellationToken);
            if (!HashesEqual(preview.Hash, request.PreviewHash))
            {
                return Conflict(
                    "progression_preview_changed",
                    "The progression no longer matches the reviewed preview. Generate a new preview before applying.");
            }

            var resultingEndDate = mesocycle.StartDate.AddDays(
                checked((mesocycle.Weeks.Count + preview.GeneratedWeeks.Count) * 7));
            var coverage = await EvaluateCoverageAsync(
                mesocycle.ClientProfileId,
                mesocycle.EnrollmentId,
                mesocycle.StartDate,
                resultingEndDate,
                cancellationToken);
            if (!coverage.Exists || !coverage.Decision.IsAuthorized)
            {
                return Invalid(
                    "progression",
                    coverage.Decision.Reason ?? "The progression is outside training coverage.");
            }

            dbContext.Entry(mesocycle).Property(item => item.Version).OriginalValue = request.MesocycleVersion;
            var visibleBefore = ClientVisibleWeeks(mesocycle);
            var existingWeekIds = mesocycle.Weeks.Select(item => item.Id).ToHashSet();
            mesocycle.AppendWeeks(preview.GeneratedWeeks);
            dbContext.MesocycleWeeks.AddRange(
                mesocycle.Weeks.Where(item => !existingWeekIds.Contains(item.Id)));
            dbContext.ProgressionApplications.Add(ProgressionApplication.Record(
                tenantContext.TenantId,
                mesocycle.Id,
                WeekStepProgressionTransform.Key,
                WeekStepProgressionTransform.CurrentVersion,
                preview.Hash,
                preview.RequestJson,
                request.SourceWeekIds.Distinct().Count(),
                preview.GeneratedWeeks.Count));
            await QueueClientWeekNoticesAsync(mesocycle, visibleBefore, cancellationToken);
            await dbContext.SaveChangesAsync(cancellationToken);
            return SuccessMesocycle(await ToViewAsync(mesocycle, cancellationToken));
        }
        catch (ArgumentException exception)
        {
            return Invalid("progression", exception.Message);
        }
        catch (InvalidOperationException exception)
        {
            return Conflict("progression_conflict", exception.Message);
        }
        catch (DbUpdateConcurrencyException)
        {
            return ConcurrencyConflict();
        }
        catch (DbUpdateException)
        {
            return Conflict("progression_conflict", "The progression conflicts with current training data.");
        }
    }

    private async Task<ProgressionBuild> BuildProgressionAsync(
        TrainingMesocycle mesocycle,
        IReadOnlyList<Guid> sourceWeekIds,
        int iterations,
        WeekProgressionSteps steps,
        uint expectedVersion,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(sourceWeekIds);
        ArgumentNullException.ThrowIfNull(steps);
        if (mesocycle.Version != expectedVersion)
        {
            throw new InvalidOperationException("The mesocycle changed after this progression request was prepared.");
        }

        if (mesocycle.Status is MesocycleStatus.Completed or MesocycleStatus.Cancelled)
        {
            throw new InvalidOperationException("Completed or cancelled mesocycle history cannot be progressed.");
        }

        if (iterations is < 1 or > 12 || sourceWeekIds.Count is < 1 or > 12 ||
            sourceWeekIds.Distinct().Count() != sourceWeekIds.Count)
        {
            throw new ArgumentException("Select 1 to 12 unique source weeks and 1 to 12 iterations.");
        }

        WeekStepProgressionTransform.ValidateSteps(steps);
        var selected = mesocycle.Weeks
            .Where(item => sourceWeekIds.Contains(item.Id))
            .OrderBy(item => item.WeekNumber)
            .ToArray();
        if (selected.Length != sourceWeekIds.Count)
        {
            throw new ArgumentException("Every progression source week must belong to this mesocycle.");
        }

        var generatedCount = checked(selected.Length * iterations);
        if (mesocycle.Weeks.Count + generatedCount > MaximumProgramWeeks)
        {
            throw new ArgumentException("The progression would exceed the 52-week mesocycle limit.");
        }

        var workingMaxes = await LoadWorkingMaxDictionaryAsync(mesocycle.Id, cancellationToken);
        var exerciseNames = mesocycle.Weeks
            .SelectMany(week => week.Sessions)
            .SelectMany(session => session.Exercises)
            .GroupBy(exercise => exercise.ExerciseId)
            .ToDictionary(group => group.Key, group => group.First().ExerciseNameSnapshot);
        var rounding = CreateRoundingPolicy(mesocycle.LoadUnit, mesocycle.LoadIncrement, mesocycle.LoadRoundingMode);

        // Each source week is stepped on its own: copy N moves N steps from it. The new weeks then run
        // round by round, as they always have: every chosen week once, then every chosen week again.
        var sources = selected.Select(week => new SourceWeekCopies(
            week,
            ToBlueprint(week),
            WeekStepProgressionTransform.Generate(
                ToRequest(week),
                steps,
                iterations,
                exerciseNames,
                $"Week {week.WeekNumber}"))).ToArray();
        var generated = new List<TrainingWeekBlueprint>(generatedCount);
        for (var iteration = 1; iteration <= iterations; iteration++)
        {
            foreach (var source in sources)
            {
                generated.Add(CalculateCopy(source, iteration, mesocycle, rounding, workingMaxes));
            }
        }

        var requestPayload = new ProgressionHashInput(
            mesocycle.Id,
            expectedVersion,
            selected.Select(item => item.Id).ToArray(),
            iterations,
            steps,
            WeekStepProgressionTransform.Key,
            WeekStepProgressionTransform.CurrentVersion,
            generated);
        var canonicalJson = JsonSerializer.Serialize(requestPayload, ProgressionJsonOptions);
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(canonicalJson))).ToLowerInvariant();
        var requestJson = JsonSerializer.Serialize(new
        {
            sourceWeekIds = selected.Select(item => item.Id).ToArray(),
            iterations,
            steps,
            expectedVersion,
        }, ProgressionJsonOptions);
        return new ProgressionBuild(hash, requestJson, generated);
    }

    /// <summary>
    /// One new week: the source week as it stands, with each set's stepped numbers and a weight worked out
    /// from the program's current max by the set's own formula (the RTS chart or the Epley curve). A
    /// refusal names the week, the copy, the session, the exercise and the set.
    /// </summary>
    private TrainingWeekBlueprint CalculateCopy(
        SourceWeekCopies source,
        int iteration,
        TrainingMesocycle mesocycle,
        LoadRoundingPolicy rounding,
        IReadOnlyDictionary<Guid, MesocycleWorkingMaxSnapshot> workingMaxes)
    {
        var stepped = source.Copies[iteration - 1];
        return source.Blueprint with
        {
            Label = BuildProgressionLabel(source.Week, iteration),
            Sessions = source.Blueprint.Sessions.Select((session, sessionIndex) => session with
            {
                Exercises = session.Exercises.Select((exercise, exerciseIndex) => exercise with
                {
                    Sets = stepped.Sessions[sessionIndex].Exercises[exerciseIndex].Sets.Select((set, setIndex) => Located(
                        $"Week {source.Week.WeekNumber}, copy {iteration}, {session.Name}, {exercise.ExerciseNameSnapshot}, set {setIndex + 1}",
                        () => CalculateSetBlueprint(
                            exercise.ExerciseId,
                            ToBlueprint(set),
                            mesocycle.LoadUnit,
                            rounding,
                            workingMaxes))).ToArray(),
                }).ToArray(),
            }).ToArray(),
        };
    }

    /// <summary>Runs one set's step through, so that a refusal says which set it is about.</summary>
    private static T Located<T>(string where, Func<T> work)
    {
        try
        {
            return work();
        }
        catch (ArgumentException exception)
        {
            var message = exception.Message;
            var suffix = message.IndexOf(" (Parameter '", StringComparison.Ordinal);
            throw new ArgumentException($"{where}: {(suffix < 0 ? message : message[..suffix])}", exception);
        }
    }

    /// <summary>
    /// An assigned week as the builder's save holds it, so the same step rules move it (TRN-025). The effort
    /// goes back to the way the coach chose to see it, RPE or RIR, and a typed weight stays typed.
    /// </summary>
    private static TrainingWeekRequest ToRequest(MesocycleWeek week) =>
        new(
            week.Label,
            week.IsPublished,
            week.Sessions.OrderBy(item => item.Position).Select(session => new TrainingSessionRequest(
                session.Name,
                session.DayOffset,
                session.CoachNotes,
                session.Exercises.OrderBy(item => item.Position).Select(exercise => new ExercisePrescriptionRequest(
                    exercise.ExerciseId,
                    exercise.Position,
                    exercise.IsMainLift,
                    exercise.ModificationPolicy,
                    exercise.CoachNotes,
                    exercise.Alternatives.Select(item => item.ExerciseId).ToArray(),
                    exercise.Sets.OrderBy(item => item.Position).Select(ToRequest).ToArray())).ToArray())).ToArray());

    private static SetPrescriptionRequest ToRequest(SetPrescription set)
    {
        var showsRir = set.ExertionDisplayPreference == ExertionDisplayPreference.Rir && set.TargetRpe is not null;
        return new SetPrescriptionRequest(
            set.Position,
            set.SetType,
            set.RepetitionsMinimum,
            set.RepetitionsMaximum,
            set.LoadStrategy,
            set.DirectLoad,
            set.LoadUnit,
            set.PercentageWorkingMax,
            showsRir ? null : set.TargetRpe,
            showsRir ? TrainingExertion.RirFromRpe(set.TargetRpe!.Value) : null,
            set.ExertionDisplayPreference,
            set.RestSeconds,
            set.Tempo,
            set.CoachNotes,
            set.IsManualLoadOverride ? set.PrescribedLoad : null);
    }

    private static TrainingWeekBlueprint ToBlueprint(MesocycleWeek week) =>
        new(
            week.Label,
            week.IsPublished,
            week.Sessions.OrderBy(item => item.Position).Select(ToBlueprint).ToArray());

    /// <summary>A stored session as a blueprint, with the weights it was given, so it can be built again as it is.</summary>
    private static TrainingSessionBlueprint ToBlueprint(TrainingSession session) =>
        new(
            session.Name,
            session.DayOffset,
            session.CoachNotes,
            session.Exercises.OrderBy(item => item.Position).Select(exercise => new ExercisePrescriptionBlueprint(
                exercise.ExerciseId,
                exercise.ExerciseNameSnapshot,
                exercise.Position,
                exercise.IsMainLift,
                exercise.ModificationPolicy,
                exercise.CoachNotes,
                exercise.Alternatives.Select(item => item.ExerciseId).ToArray(),
                exercise.Media.OrderBy(item => item.DisplayOrder).Select(item => item.MediaAssetId).ToArray(),
                exercise.Sets.OrderBy(item => item.Position).Select(ToBlueprint).ToArray())).ToArray());

    private static TrainingWeekView ToPreviewView(TrainingWeekBlueprint week, int weekNumber) =>
        new(
            Guid.Empty,
            weekNumber,
            week.Label,
            null,
            week.IsPublished,
            null,
            null,
            week.Sessions.Select(ToPreviewSessionView).ToArray());

    /// <summary>A session not stored yet, as the preview shows it: the position in its week stands in for its id.</summary>
    private static TrainingSessionView ToPreviewSessionView(TrainingSessionBlueprint session, int position) =>
        new(
            Guid.Empty,
            position,
            session.DayOffset,
            null,
            session.Name,
            session.CoachNotes,
            false,
            false,
            null,
            session.Exercises.Select(exercise => new ExercisePrescriptionView(
                Guid.Empty,
                exercise.ExerciseId,
                exercise.ExerciseNameSnapshot,
                exercise.Position,
                exercise.IsMainLift,
                exercise.ModificationPolicy,
                exercise.CoachNotes,
                exercise.ApprovedAlternativeExerciseIds,
                exercise.Sets.Select(set => new SetPrescriptionView(
                    Guid.Empty,
                    set.Position,
                    set.SetType,
                    set.RepetitionsMinimum,
                    set.RepetitionsMaximum,
                    set.LoadStrategy,
                    set.DirectLoad,
                    set.LoadUnit,
                    set.PercentageWorkingMax,
                    set.TargetRpe,
                    set.TargetRpe is null ? null : TrainingExertion.RirFromRpe(set.TargetRpe.Value),
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
                    set.IsManualLoadOverride)).ToArray(),
                exercise.MediaAssetIds)).ToArray());

    private static string BuildProgressionLabel(MesocycleWeek source, int iteration) =>
        string.IsNullOrWhiteSpace(source.Label)
            ? $"Progression {iteration} from Week {source.WeekNumber}"
            : $"{source.Label} - progression {iteration}";

    private static bool HashesEqual(string expected, string actual)
    {
        if (string.IsNullOrWhiteSpace(expected) || string.IsNullOrWhiteSpace(actual))
        {
            return false;
        }

        try
        {
            return CryptographicOperations.FixedTimeEquals(
                Convert.FromHexString(expected),
                Convert.FromHexString(actual));
        }
        catch (FormatException)
        {
            return false;
        }
    }

    private sealed record ProgressionBuild(
        string Hash,
        string RequestJson,
        IReadOnlyList<TrainingWeekBlueprint> GeneratedWeeks);

    /// <summary>One chosen week, as the blueprint it copies and the stepped copies of its numbers.</summary>
    private sealed record SourceWeekCopies(
        MesocycleWeek Week,
        TrainingWeekBlueprint Blueprint,
        IReadOnlyList<TrainingWeekRequest> Copies);

    private sealed record ProgressionHashInput(
        Guid MesocycleId,
        uint MesocycleVersion,
        IReadOnlyList<Guid> SourceWeekIds,
        int Iterations,
        WeekProgressionSteps Steps,
        string TransformKey,
        string TransformVersion,
        IReadOnlyList<TrainingWeekBlueprint> GeneratedWeeks);
}
