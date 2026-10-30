using TB.Gym.Modules.Nutrition;
using TB.Gym.SharedKernel;

namespace TB.Gym.Infrastructure.Application;

/// <summary>
/// Which energy model new calculations use (critique B8a, NUT-015): version 1 until B8c switches version 2 on, after
/// its table and words are reviewed. A development or review server sets <c>Nutrition:EnergyModel:Version</c> to 2.
/// </summary>
internal sealed class NutritionEnergyModelOptions
{
    public const string SectionName = "Nutrition:EnergyModel";

    public int Version { get; set; } = (int)EnergyModelVersion.Version1;
}

/// <summary>
/// Energy version 2 (critique B8a): what new calculations take, the targets sheet's numbers worked out as the coach
/// types, and what a calculation says beside its numbers.
/// </summary>
/// <remarks>
/// The words beside a multiplier belong to the model that made it, so a version 2 calculation always has them. The
/// walking line, the goal's rate and the energy floors are words the review approves with the table (ADR 0008), so
/// they are said only while version 2 is in force, on every calculation alike, as the other warnings are worked out
/// again on every read.
/// </remarks>
internal sealed partial class NutritionApplicationService
{
    private EnergyModelVersion EnergyModel => (EnergyModelVersion)energyModelOptions.Value.Version;

    private bool EnergyVersionTwo => EnergyModel == EnergyModelVersion.Version2;

    public EnergyModelView GetEnergyModel() => EnergyModels.Describe(EnergyModel);

    public NutritionCommandResult PreviewEnergy(PreviewEnergyRequest request)
    {
        if (!EnergyVersionTwo)
        {
            return Conflict("energy_version_2_off", "The energy preview is energy version 2's, which this server does not use yet.");
        }

        try
        {
            return new NutritionCommandResult(NutritionCommandStatus.Success, EnergyPreview: EnergyPreviews.Work(request));
        }
        catch (EnergyModelInputException exception)
        {
            return Invalid(exception.ParamName ?? "calculation", exception.PersonMessage());
        }
        catch (ArgumentException exception)
        {
            return Invalid("calculation", exception.PersonMessage());
        }
    }

    /// <summary>
    /// A calculation as the coach reads it: its numbers and warnings, the words beside its multiplier, and while energy
    /// version 2 is in force what their steps are worth and the goal's rate and share.
    /// </summary>
    private NutritionCalculationView CalculationView(NutritionCalculationSnapshot item, CalculateNutritionTargetsRequest? inputs, IReadOnlyList<string> warnings)
    {
        var activity = inputs is null ? null : EnergyModels.Words(item.ActivityModelKey, item.ActivityModelVersion, ActivityRequestOf(inputs));
        WalkingWords? walking = null;
        if (EnergyVersionTwo && inputs is not null)
        {
            try
            {
                walking = WalkingCost.Describe(inputs.AverageDailySteps, inputs.WeightKilograms);
            }
            catch (ArgumentException)
            {
                // The calculation stays; only its walking line is left out.
            }
        }

        var goal = EnergyVersionTwo ? WeeklyWeightChange.Describe(item.CoachGoalAdjustment, item.TdeeEstimate) : null;
        return new NutritionCalculationView(
            item.Id,
            item.BmrMethodKey,
            item.BmrMethodVersion,
            item.BmrEstimate,
            item.ActivityModelKey,
            item.ActivityModelVersion,
            item.ActivityModelPal,
            item.TdeeMethodKey,
            item.TdeeMethodVersion,
            item.TdeeEstimate,
            item.CoachGoalAdjustment,
            item.CalorieTarget,
            item.ProteinGrams,
            item.CarbohydrateGrams,
            item.FatGrams,
            item.EnergyPolicyKey,
            item.EnergyPolicyVersion,
            warnings,
            activity,
            walking,
            goal);
    }

    /// <summary>The energy floors (<see cref="EnergyTargetFloors"/>), while energy version 2 is in force.</summary>
    private IReadOnlyList<string> EnergyWarnings(decimal calorieTarget, decimal bmrEstimate, FormulaSex sex) =>
        EnergyVersionTwo ? EnergyTargetFloors.Warnings(calorieTarget, bmrEstimate, sex) : [];

    private static ActivityRequest ActivityRequestOf(CalculateNutritionTargetsRequest request) =>
        new(request.OccupationType, request.AverageDailySteps, request.WorkoutsPerWeek, request.ChosenPal, request.ChosenPalReason);
}
