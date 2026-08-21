using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TB.Gym.Modules.Strength;
using TB.Gym.Modules.Training;

namespace TB.Gym.Infrastructure.Application;

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
            request.RpeIncrement,
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
            rpeProgression.TransformKey,
            rpeProgression.Version,
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
                request.RpeIncrement,
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
            var existingWeekIds = mesocycle.Weeks.Select(item => item.Id).ToHashSet();
            mesocycle.AppendWeeks(preview.GeneratedWeeks);
            dbContext.MesocycleWeeks.AddRange(
                mesocycle.Weeks.Where(item => !existingWeekIds.Contains(item.Id)));
            dbContext.ProgressionApplications.Add(ProgressionApplication.Record(
                tenantContext.TenantId,
                mesocycle.Id,
                rpeProgression.TransformKey,
                rpeProgression.Version,
                preview.Hash,
                preview.RequestJson,
                request.SourceWeekIds.Distinct().Count(),
                preview.GeneratedWeeks.Count));
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
        decimal increment,
        uint expectedVersion,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(sourceWeekIds);
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

        var selected = mesocycle.Weeks
            .Where(item => sourceWeekIds.Contains(item.Id))
            .OrderBy(item => item.WeekNumber)
            .ToArray();
        if (selected.Length != sourceWeekIds.Count)
        {
            throw new ArgumentException("Every progression source week must belong to this mesocycle.");
        }

        var generatedCount = checked(selected.Length * iterations);
        if (mesocycle.Weeks.Count + generatedCount > 52)
        {
            throw new ArgumentException("The progression would exceed the 52-week mesocycle limit.");
        }

        var workingMaxes = await LoadWorkingMaxDictionaryAsync(mesocycle.Id, cancellationToken);
        var generated = new List<TrainingWeekBlueprint>(generatedCount);
        for (var iteration = 1; iteration <= iterations; iteration++)
        {
            foreach (var sourceWeek in selected)
            {
                var source = ToBlueprint(sourceWeek);
                generated.Add(source with
                {
                    Label = BuildProgressionLabel(sourceWeek, iteration),
                    Sessions = source.Sessions.Select(session =>
                    {
                        var transformed = session with
                        {
                            Exercises = session.Exercises.Select(exercise => exercise with
                            {
                                Sets = exercise.Sets.Select(set => set with
                                {
                                    TargetRpe = rpeProgression.TransformRpe(set.TargetRpe, increment, iteration),
                                }).ToArray(),
                            }).ToArray(),
                        };
                        return CalculateSessionBlueprint(transformed, mesocycle, workingMaxes);
                    }).ToArray(),
                });
            }
        }

        var requestPayload = new ProgressionHashInput(
            mesocycle.Id,
            expectedVersion,
            selected.Select(item => item.Id).ToArray(),
            iterations,
            increment,
            rpeProgression.TransformKey,
            rpeProgression.Version,
            generated);
        var canonicalJson = JsonSerializer.Serialize(requestPayload, ProgressionJsonOptions);
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(canonicalJson))).ToLowerInvariant();
        var requestJson = JsonSerializer.Serialize(new
        {
            sourceWeekIds = selected.Select(item => item.Id).ToArray(),
            iterations,
            rpeIncrement = increment,
            expectedVersion,
        }, ProgressionJsonOptions);
        return new ProgressionBuild(hash, requestJson, generated);
    }

    private static TrainingWeekBlueprint ToBlueprint(MesocycleWeek week) =>
        new(
            week.Label,
            week.IsPublished,
            week.Sessions.OrderBy(item => item.Position).Select(session => new TrainingSessionBlueprint(
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
                    exercise.Sets.OrderBy(item => item.Position).Select(set => new SetPrescriptionBlueprint(
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
                        set.IsManualLoadOverride)).ToArray())).ToArray())).ToArray());

    private static TrainingWeekView ToPreviewView(TrainingWeekBlueprint week, int weekNumber) =>
        new(
            Guid.Empty,
            weekNumber,
            week.Label,
            null,
            week.IsPublished,
            null,
            null,
            week.Sessions.Select((session, sessionIndex) => new TrainingSessionView(
                Guid.Empty,
                sessionIndex,
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
                        set.IsManualLoadOverride)).ToArray())).ToArray())).ToArray());

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

    private sealed record ProgressionHashInput(
        Guid MesocycleId,
        uint MesocycleVersion,
        IReadOnlyList<Guid> SourceWeekIds,
        int Iterations,
        decimal RpeIncrement,
        string TransformKey,
        string TransformVersion,
        IReadOnlyList<TrainingWeekBlueprint> GeneratedWeeks);
}
