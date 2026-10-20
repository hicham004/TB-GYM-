using Microsoft.EntityFrameworkCore;
using TB.Gym.Modules.Training;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

internal sealed partial class TrainingApplicationService
{
    private const int MaximumProgramWeeks = 52;

    public async Task<WeekProgressionPreviewView> PreviewWeekProgressionAsync(
        PreviewWeekProgressionRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (request.SourceWeek is null || request.Steps is null)
        {
            throw new ArgumentException("Choose a week to copy and how it should change.");
        }

        if (request.Copies is < 1 or > WeekStepProgressionTransform.MaximumCopies)
        {
            throw new ArgumentException($"Choose 1 to {WeekStepProgressionTransform.MaximumCopies} copies.");
        }

        if (request.WeeksInProgram is < 1 or > MaximumProgramWeeks ||
            request.WeeksInProgram + request.Copies > MaximumProgramWeeks)
        {
            throw new ArgumentException(
                $"A program holds up to {MaximumProgramWeeks} weeks. This one has {request.WeeksInProgram}, so only {Math.Max(0, MaximumProgramWeeks - request.WeeksInProgram)} more fit.");
        }

        var exerciseIds = (request.SourceWeek.Sessions ?? [])
            .SelectMany(session => session.Exercises ?? [])
            .Select(exercise => exercise.ExerciseId)
            .Distinct()
            .ToArray();
        var names = await dbContext.Exercises.AsNoTracking()
            .Where(item => exerciseIds.Contains(item.Id))
            .ToDictionaryAsync(item => item.Id, item => item.Name, cancellationToken);

        // The source and every copy are checked as a save checks them, so a week that cannot be
        // published is refused here, with the reason, rather than added to the draft.
        EnsureWeekIsValid(request.SourceWeek, exerciseIds, names, "Fix this week before copying it. ");
        var generated = WeekStepProgressionTransform.Generate(request.SourceWeek, request.Steps, request.Copies, names);
        foreach (var week in generated)
        {
            EnsureWeekIsValid(week, exerciseIds, names, string.Empty);
        }

        return new WeekProgressionPreviewView(
            WeekStepProgressionTransform.Key,
            WeekStepProgressionTransform.CurrentVersion,
            generated);
    }

    private void EnsureWeekIsValid(
        TrainingWeekRequest week,
        IReadOnlyList<Guid> exerciseIds,
        IReadOnlyDictionary<Guid, string> names,
        string prefix)
    {
        var knownNames = exerciseIds.ToDictionary(id => id, id => names.GetValueOrDefault(id, "Exercise"));
        try
        {
            var blueprint = new ProgramBlueprint(
                "Preview",
                null,
                [new TrainingWeekBlueprint(
                    week.Label,
                    week.IsPublished,
                    (week.Sessions ?? []).Select(session => ToBlueprint(session, knownNames)).ToArray())]);
            _ = ProgramTemplateVersion.Create(tenantContext.TenantId, Guid.NewGuid(), 1, blueprint, false, clock.UtcNow);
        }
        catch (ArgumentException exception)
        {
            throw new ArgumentException(prefix + exception.PersonMessage(), exception);
        }
    }
}
