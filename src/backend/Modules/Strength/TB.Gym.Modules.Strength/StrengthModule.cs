using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Strength;

public interface ILoadProgressionModel
{
    ProgressedLoad Calculate(ProgressionInput input);
}

public sealed record ProgressionInput(
    decimal OneRepMaxKg,
    int Repetitions,
    decimal TargetRpe,
    decimal PlateIncrementKg);

public sealed record ProgressedLoad(decimal LoadKg, string ModelVersion);

public sealed class StrengthModule : IModuleMarker
{
    public const string Name = "Strength";
}
