using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Training;

public interface ITrainingProgressionTransform
{
    string TransformKey { get; }

    string Version { get; }

    decimal? TransformRpe(decimal? sourceRpe, decimal increment, int iteration);
}

public sealed class RpeStepProgressionTransform : ITrainingProgressionTransform
{
    public const string Key = "RpeStep";
    public const string CurrentVersion = "1.0";

    public string TransformKey => Key;

    public string Version => CurrentVersion;

    public decimal? TransformRpe(decimal? sourceRpe, decimal increment, int iteration)
    {
        if (increment is < -2m or > 2m || increment * 2m != decimal.Truncate(increment * 2m))
        {
            throw new ArgumentOutOfRangeException(nameof(increment), "RPE progression must use 0.5 steps between -2 and 2.");
        }

        ArgumentOutOfRangeException.ThrowIfLessThan(iteration, 1);

        return sourceRpe is null
            ? null
            : TrainingExertion.ValidateRpe(sourceRpe.Value + increment * iteration);
    }
}

/// <summary>How far each copy moves from the source week, per week, so copy N moves N times as far.</summary>
public sealed record WeekProgressionSteps(
    decimal RpeStep,
    int RepetitionsStep,
    decimal PercentageStep,
    decimal LoadStep);

/// <summary>
/// Week progression v1 (<c>WeekStep</c>, TRN-025): copies one week N times, each copy a further step
/// away in RPE or RIR, repetitions, percentage of training max and fixed weight. It writes plain
/// numbers and calculates no load, so programs already assigned keep their snapshots. Warm-up sets
/// stay as they are. Any result outside a set's own limits refuses the whole copy with the reason.
/// </summary>
public sealed class WeekStepProgressionTransform
{
    public const string Key = "WeekStep";
    public const string CurrentVersion = "1.0";
    public const int MaximumCopies = 12;

    public static void ValidateSteps(WeekProgressionSteps steps)
    {
        ArgumentNullException.ThrowIfNull(steps);
        if (steps.RpeStep is < -2m or > 2m || steps.RpeStep % 0.5m != 0m)
        {
            throw new ArgumentException("RPE can change by -2 to +2 a week, in half steps.");
        }

        if (steps.RepetitionsStep is < -20 or > 20)
        {
            throw new ArgumentException("Repetitions can change by -20 to +20 a week.");
        }

        if (steps.PercentageStep is < -50m or > 50m || HasMoreThanTwoDecimals(steps.PercentageStep))
        {
            throw new ArgumentException("The percentage can change by -50 to +50 points a week, with at most two decimals.");
        }

        if (steps.LoadStep is < -500m or > 500m || HasMoreThanTwoDecimals(steps.LoadStep))
        {
            throw new ArgumentException("The weight can change by -500 to +500 a week, with at most two decimals.");
        }
    }

    public static IReadOnlyList<TrainingWeekRequest> Generate(
        TrainingWeekRequest source,
        WeekProgressionSteps steps,
        int copies,
        IReadOnlyDictionary<Guid, string> exerciseNames)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(exerciseNames);
        ValidateSteps(steps);
        if (copies is < 1 or > MaximumCopies)
        {
            throw new ArgumentException($"Choose 1 to {MaximumCopies} copies.");
        }

        var generated = new List<TrainingWeekRequest>(copies);
        for (var copy = 1; copy <= copies; copy++)
        {
            generated.Add(source with
            {
                Sessions = (source.Sessions ?? []).Select(session => session with
                {
                    Exercises = (session.Exercises ?? []).Select(exercise => exercise with
                    {
                        Sets = (exercise.Sets ?? []).Select(set => TransformSet(
                            set,
                            steps,
                            copy,
                            $"Copy {copy}, {session.Name}, {exerciseNames.GetValueOrDefault(exercise.ExerciseId, "an exercise")}, set {set.Position}")).ToArray(),
                    }).ToArray(),
                }).ToArray(),
            });
        }

        return generated;
    }

    private static SetPrescriptionRequest TransformSet(
        SetPrescriptionRequest set,
        WeekProgressionSteps steps,
        int copy,
        string where)
    {
        if (set.SetType == TrainingSetType.WarmUp)
        {
            return set;
        }

        var next = set;
        if (steps.RepetitionsStep != 0)
        {
            var shift = steps.RepetitionsStep * copy;
            next = next with
            {
                RepetitionsMinimum = ShiftRepetitions(set.RepetitionsMinimum, shift, where),
                RepetitionsMaximum = ShiftRepetitions(set.RepetitionsMaximum, shift, where),
            };
        }

        if (steps.RpeStep != 0 && (set.TargetRpe is not null || set.TargetRir is not null))
        {
            var rpe = (set.TargetRpe ?? 10m - set.TargetRir!.Value) + steps.RpeStep * copy;
            if (rpe is < 5m or > 10m)
            {
                throw new ArgumentException(
                    $"{where}: RPE would be {rpe:0.#}, and RPE runs from 5 to 10. Use a smaller step or fewer copies.");
            }

            next = set.TargetRpe is not null
                ? next with { TargetRpe = rpe }
                : next with { TargetRir = 10m - rpe };
        }

        if (steps.PercentageStep != 0 &&
            set.LoadStrategy == TrainingLoadStrategy.PercentageWorkingMax &&
            set.PercentageWorkingMax is { } percentage)
        {
            var moved = percentage + steps.PercentageStep * copy;
            if (moved is <= 0m or > 150m)
            {
                throw new ArgumentException(
                    $"{where}: the percentage would be {moved:0.##}%, and it must be more than 0 and at most 150. Use a smaller step or fewer copies.");
            }

            next = next with { PercentageWorkingMax = moved };
        }

        if (steps.LoadStep != 0)
        {
            if (set.LoadStrategy == TrainingLoadStrategy.Direct && set.DirectLoad is { } fixedLoad)
            {
                next = next with { DirectLoad = ShiftLoad(fixedLoad, steps.LoadStep * copy, where) };
            }

            if (set.ManualLoadOverride is { } typedLoad)
            {
                next = next with { ManualLoadOverride = ShiftLoad(typedLoad, steps.LoadStep * copy, where) };
            }
        }

        return next;
    }

    private static int? ShiftRepetitions(int? repetitions, int shift, string where)
    {
        if (repetitions is not { } current)
        {
            return null;
        }

        var moved = current + shift;
        return moved is >= 1 and <= 100
            ? moved
            : throw new ArgumentException(
                $"{where}: the repetitions would be {moved}, and they must be 1 to 100. Use a smaller step or fewer copies.");
    }

    private static decimal ShiftLoad(decimal load, decimal shift, string where)
    {
        var moved = load + shift;
        return moved is > 0m and <= 2_000m
            ? moved
            : throw new ArgumentException(
                $"{where}: the weight would be {moved:0.##}, and it must be more than 0 and at most 2,000. Use a smaller step or fewer copies.");
    }

    private static bool HasMoreThanTwoDecimals(decimal value) => decimal.Round(value, 2) != value;
}

public sealed class ProgressionApplication : TenantEntity
{
    private ProgressionApplication()
    {
    }

    private ProgressionApplication(
        Guid tenantId,
        Guid mesocycleId,
        string transformKey,
        string transformVersion,
        string previewHash,
        string requestJson,
        int sourceWeekCount,
        int generatedWeekCount)
        : base(tenantId)
    {
        MesocycleId = mesocycleId;
        TransformKey = TrainingText.Required(transformKey, 80, nameof(transformKey));
        TransformVersion = TrainingText.Required(transformVersion, 40, nameof(transformVersion));
        PreviewHash = ValidateHash(previewHash);
        RequestJson = TrainingText.Required(requestJson, 8_000, nameof(requestJson));
        SourceWeekCount = sourceWeekCount;
        GeneratedWeekCount = generatedWeekCount;
    }

    public Guid MesocycleId { get; private set; }

    public string TransformKey { get; private set; } = string.Empty;

    public string TransformVersion { get; private set; } = string.Empty;

    public string PreviewHash { get; private set; } = string.Empty;

    public string RequestJson { get; private set; } = string.Empty;

    public int SourceWeekCount { get; private set; }

    public int GeneratedWeekCount { get; private set; }

    public static ProgressionApplication Record(
        Guid tenantId,
        Guid mesocycleId,
        string transformKey,
        string transformVersion,
        string previewHash,
        string requestJson,
        int sourceWeekCount,
        int generatedWeekCount) =>
        new(
            tenantId,
            mesocycleId,
            transformKey,
            transformVersion,
            previewHash,
            requestJson,
            sourceWeekCount,
            generatedWeekCount);

    private static string ValidateHash(string value)
    {
        var normalized = TrainingText.Required(value, 64, nameof(value)).ToLowerInvariant();
        return normalized.Length == 64 && normalized.All(Uri.IsHexDigit)
            ? normalized
            : throw new ArgumentException("A SHA-256 preview hash is required.", nameof(value));
    }
}
