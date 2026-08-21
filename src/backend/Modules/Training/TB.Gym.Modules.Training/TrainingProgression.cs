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
