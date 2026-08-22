namespace TB.Gym.Modules.Nutrition;

public enum FormulaSex
{
    Female = 1,
    Male = 2,
}

public sealed record BmrInput(
    decimal WeightKilograms,
    decimal HeightCentimeters,
    int AgeYears,
    FormulaSex Sex,
    decimal? BodyFatPercentage = null);

public sealed record BmrResult(
    decimal KilocaloriesPerDay,
    string MethodKey,
    string MethodVersion,
    BmrInput Input);

public interface IBmrStrategy
{
    string MethodKey { get; }

    string Version { get; }

    BmrResult Estimate(BmrInput input);
}

public abstract class BmrStrategyBase : IBmrStrategy
{
    public abstract string MethodKey { get; }

    public const string CurrentVersion = "1.0";

    public string Version => CurrentVersion;

    public BmrResult Estimate(BmrInput input)
    {
        ValidateCommon(input);
        var result = Calculate(input);
        return new BmrResult(
            decimal.Round(result, 3, MidpointRounding.AwayFromZero),
            MethodKey,
            Version,
            input);
    }

    protected abstract decimal Calculate(BmrInput input);

    protected static void ValidateCommon(BmrInput input)
    {
        if (input.WeightKilograms is < 20m or > 500m)
        {
            throw new ArgumentOutOfRangeException(nameof(input), "Weight must be between 20 and 500 kg.");
        }

        if (input.HeightCentimeters is < 50m or > 300m)
        {
            throw new ArgumentOutOfRangeException(nameof(input), "Height must be between 50 and 300 cm.");
        }

        if (input.AgeYears is < 18 or > 120)
        {
            throw new ArgumentOutOfRangeException(nameof(input), "Adult BMR strategies support ages 18 through 120.");
        }

        if (!Enum.IsDefined(input.Sex))
        {
            throw new ArgumentOutOfRangeException(nameof(input), "A supported formula sex is required.");
        }
    }
}

public sealed class MifflinStJeorBmrStrategy : BmrStrategyBase
{
    public const string Key = "MifflinStJeor";

    public override string MethodKey => Key;

    protected override decimal Calculate(BmrInput input) =>
        10m * input.WeightKilograms +
        6.25m * input.HeightCentimeters -
        5m * input.AgeYears +
        (input.Sex == FormulaSex.Male ? 5m : -161m);
}

public sealed class KatchMcArdleBmrStrategy : BmrStrategyBase
{
    public const string Key = "KatchMcArdle";

    public override string MethodKey => Key;

    protected override decimal Calculate(BmrInput input)
    {
        if (input.BodyFatPercentage is null)
        {
            throw new ArgumentException("Katch-McArdle requires a known body-fat percentage.", nameof(input));
        }

        if (input.BodyFatPercentage is < 1m or > 70m)
        {
            throw new ArgumentOutOfRangeException(nameof(input), "Body-fat percentage must be between 1 and 70.");
        }

        var leanBodyMass = input.WeightKilograms * (1m - input.BodyFatPercentage.Value / 100m);
        return 370m + 21.6m * leanBodyMass;
    }
}

public sealed class HarrisBenedictRevisedBmrStrategy : BmrStrategyBase
{
    public const string Key = "HarrisBenedictRevised";

    public override string MethodKey => Key;

    protected override decimal Calculate(BmrInput input) =>
        input.Sex == FormulaSex.Male
            ? 88.362m + 13.397m * input.WeightKilograms + 4.799m * input.HeightCentimeters - 5.677m * input.AgeYears
            : 447.593m + 9.247m * input.WeightKilograms + 3.098m * input.HeightCentimeters - 4.330m * input.AgeYears;
}

public enum OccupationActivityType
{
    Seated = 1,
    Mixed = 2,
    Physical = 3,
}

public enum PalBand
{
    Sedentary = 1,
    Moderate = 2,
    Vigorous = 3,
}

public sealed record ActivityModelInput(OccupationActivityType OccupationType, int AverageDailySteps);

public sealed record ActivityModelResult(
    decimal Pal,
    PalBand Band,
    string MethodKey,
    string MethodVersion,
    ActivityModelInput Input);

public sealed class OccupationStepsActivityModel
{
    public const string Key = "OccupationStepsPal";
    public const string CurrentVersion = "1.0";

    public static ActivityModelResult Calculate(ActivityModelInput input)
    {
        if (!Enum.IsDefined(input.OccupationType))
        {
            throw new ArgumentOutOfRangeException(nameof(input), "A supported occupation type is required.");
        }

        if (input.AverageDailySteps is < 0 or > 100_000)
        {
            throw new ArgumentOutOfRangeException(nameof(input), "Average daily steps must be between 0 and 100,000.");
        }

        var stepBand = input.AverageDailySteps switch
        {
            < 5_000 => 0,
            < 10_000 => 1,
            _ => 2,
        };
        var pal = (input.OccupationType, stepBand) switch
        {
            (OccupationActivityType.Seated, 0) => 1.50m,
            (OccupationActivityType.Seated, 1) => 1.70m,
            (OccupationActivityType.Seated, _) => 1.85m,
            (OccupationActivityType.Mixed, 0) => 1.65m,
            (OccupationActivityType.Mixed, 1) => 1.80m,
            (OccupationActivityType.Mixed, _) => 2.00m,
            (OccupationActivityType.Physical, 0) => 1.80m,
            (OccupationActivityType.Physical, 1) => 2.00m,
            _ => 2.20m,
        };
        var band = pal switch
        {
            <= 1.69m => PalBand.Sedentary,
            <= 1.99m => PalBand.Moderate,
            _ => PalBand.Vigorous,
        };

        if (pal is < 1.40m or > 2.40m)
        {
            throw new InvalidOperationException("Calculated PAL is outside the supported FAO/WHO/UNU range.");
        }

        return new ActivityModelResult(pal, band, Key, CurrentVersion, input);
    }
}

public sealed record TdeeResult(
    decimal KilocaloriesPerDay,
    string MethodKey,
    string MethodVersion,
    BmrResult BmrEstimate,
    ActivityModelResult ActivityModel);

public static class TdeeEstimator
{
    public const string Key = "BmrTimesPal";
    public const string CurrentVersion = "1.0";

    public static TdeeResult Estimate(BmrResult bmrEstimate, ActivityModelResult activityModel)
    {
        ArgumentNullException.ThrowIfNull(bmrEstimate);
        ArgumentNullException.ThrowIfNull(activityModel);
        if (bmrEstimate.KilocaloriesPerDay <= 0m || activityModel.Pal is < 1.40m or > 2.40m)
        {
            throw new ArgumentOutOfRangeException(nameof(activityModel), "BMR and PAL must be inside their supported ranges.");
        }

        return new TdeeResult(
            decimal.Round(bmrEstimate.KilocaloriesPerDay * activityModel.Pal, 3, MidpointRounding.AwayFromZero),
            Key,
            CurrentVersion,
            bmrEstimate,
            activityModel);
    }
}

/// <param name="FatPercentage">
/// Percentage of the calorie target from fat, expressed 0-100 to match
/// <see cref="BmrInput.BodyFatPercentage"/>. Every percentage in this module uses the same scale.
/// </param>
public sealed record MacroTargetInput(
    decimal CalorieTarget,
    decimal ProteinGrams,
    decimal FatPercentage,
    decimal? BodyweightKilograms = null,
    bool IsEnergyDeficit = false);

public sealed record MacroTargetResult(
    decimal CalorieTarget,
    decimal ProteinGrams,
    decimal FatGrams,
    decimal CarbohydrateGrams,
    decimal ProteinCalories,
    decimal FatCalories,
    decimal CarbohydrateCalories,
    string MethodKey,
    string MethodVersion,
    IReadOnlyList<string> Warnings)
{
    public MacroTargetPrescription RoundForPrescription(int decimals = 0)
    {
        if (decimals is < 0 or > 3)
        {
            throw new ArgumentOutOfRangeException(nameof(decimals));
        }

        var protein = decimal.Round(ProteinGrams, decimals, MidpointRounding.AwayFromZero);
        var fat = decimal.Round(FatGrams, decimals, MidpointRounding.AwayFromZero);
        var carbohydrate = decimal.Round(CarbohydrateGrams, decimals, MidpointRounding.AwayFromZero);
        if (ProteinGrams > 0m && protein == 0m || FatGrams > 0m && fat == 0m || CarbohydrateGrams > 0m && carbohydrate == 0m)
        {
            throw new InvalidOperationException("A positive macro target cannot silently round to zero.");
        }

        return new MacroTargetPrescription(protein, fat, carbohydrate, decimals);
    }
}

public sealed record MacroTargetPrescription(
    decimal ProteinGrams,
    decimal FatGrams,
    decimal CarbohydrateGrams,
    int DecimalPlaces);

public static class MacroTargetCalculator
{
    public const string Key = "Nut008MacroSplit";
    public const string CurrentVersion = "1.0";

    public static MacroTargetResult Calculate(MacroTargetInput input)
    {
        if (input.CalorieTarget <= 0m)
        {
            throw new ArgumentOutOfRangeException(nameof(input), "Calorie target must be positive.");
        }

        if (input.ProteinGrams < 0m)
        {
            throw new ArgumentOutOfRangeException(nameof(input), "Protein grams cannot be negative.");
        }

        if (input.FatPercentage is < 0m or > 100m)
        {
            throw new ArgumentOutOfRangeException(nameof(input), "Fat percentage must be between 0 and 100.");
        }

        var proteinCalories = input.ProteinGrams * 4m;
        var fatCalories = input.CalorieTarget * input.FatPercentage / 100m;
        if (proteinCalories + fatCalories > input.CalorieTarget)
        {
            throw new ArgumentException("Protein and fat calories cannot exceed the calorie target.", nameof(input));
        }

        var fatGrams = fatCalories / 9m;
        var carbohydrateCalories = input.CalorieTarget - proteinCalories - fatCalories;
        var carbohydrateGrams = carbohydrateCalories / 4m;
        if (fatGrams < 0m || carbohydrateGrams < 0m)
        {
            throw new InvalidOperationException("Calculated macro grams cannot be negative.");
        }

        var warnings = BuildProteinWarnings(input);
        return new MacroTargetResult(
            input.CalorieTarget,
            input.ProteinGrams,
            fatGrams,
            carbohydrateGrams,
            proteinCalories,
            fatCalories,
            carbohydrateCalories,
            Key,
            CurrentVersion,
            warnings);
    }

    private static IReadOnlyList<string> BuildProteinWarnings(MacroTargetInput input)
    {
        if (input.BodyweightKilograms is null)
        {
            return [];
        }

        if (input.BodyweightKilograms is <= 0m or > 500m)
        {
            throw new ArgumentOutOfRangeException(nameof(input), "Bodyweight must be positive and no more than 500 kg.");
        }

        var gramsPerKilogram = input.ProteinGrams / input.BodyweightKilograms.Value;
        var upper = input.IsEnergyDeficit ? 3.1m : 2.0m;
        return gramsPerKilogram is < 1.4m || gramsPerKilogram > upper
            ? [$"Protein is {gramsPerKilogram:0.##} g/kg/day, outside the Phase 4 coaching review range of 1.4-{upper:0.#} g/kg/day. This is a warning, not a clinical determination."]
            : [];
    }
}

/// <summary>
/// Canonical nutrient input for every energy policy.
/// </summary>
/// <param name="CarbohydrateGrams">
/// TOTAL carbohydrate, including fibre, polyols, and erythritol. This matches USDA
/// "Carbohydrate, by difference" and the total-carbohydrate figure printed on a nutrition label,
/// so a coach can transcribe a label without converting. Policies that need available
/// carbohydrate subtract the components themselves; callers must never pre-subtract.
/// </param>
public sealed record EnergyNutrients(
    decimal ProteinGrams,
    decimal CarbohydrateGrams,
    decimal FatGrams,
    decimal PolyolGrams = 0m,
    decimal SalatrimGrams = 0m,
    decimal EthanolGrams = 0m,
    decimal OrganicAcidGrams = 0m,
    decimal FibreGrams = 0m,
    decimal ErythritolGrams = 0m)
{
    /// <summary>
    /// Carbohydrate that is neither fibre nor a polyol, which is what EU 1169 Annex XIV charges
    /// at 4 kcal/g. Fibre, polyols, and erythritol carry their own factors.
    /// </summary>
    public decimal AvailableCarbohydrateGrams =>
        CarbohydrateGrams - FibreGrams - PolyolGrams - ErythritolGrams;
}

public sealed record EnergyPolicyResult(decimal Kilocalories, string PolicyKey, string PolicyVersion);

public interface IEnergyFactorPolicy
{
    string PolicyKey { get; }

    string Version { get; }

    EnergyPolicyResult Calculate(EnergyNutrients nutrients);
}

public abstract class EnergyFactorPolicyBase : IEnergyFactorPolicy
{
    public abstract string PolicyKey { get; }

    public const string CurrentVersion = "1.0";

    public string Version => CurrentVersion;

    public EnergyPolicyResult Calculate(EnergyNutrients nutrients)
    {
        if (new[]
            {
                nutrients.ProteinGrams,
                nutrients.CarbohydrateGrams,
                nutrients.FatGrams,
                nutrients.PolyolGrams,
                nutrients.SalatrimGrams,
                nutrients.EthanolGrams,
                nutrients.OrganicAcidGrams,
                nutrients.FibreGrams,
                nutrients.ErythritolGrams,
            }.Any(value => value < 0m))
        {
            throw new ArgumentOutOfRangeException(nameof(nutrients), "Nutrients cannot be negative.");
        }

        // Fibre, polyols, and erythritol are subsets of total carbohydrate. If they exceed it the
        // caller has either pre-subtracted or mixed sources, and any energy figure would be wrong.
        if (nutrients.AvailableCarbohydrateGrams < 0m)
        {
            throw new ArgumentOutOfRangeException(
                nameof(nutrients),
                "Fibre, polyols, and erythritol cannot exceed total carbohydrate. Supply total carbohydrate, not available carbohydrate.");
        }

        return new EnergyPolicyResult(
            decimal.Round(CalculateEnergy(nutrients), 3, MidpointRounding.AwayFromZero),
            PolicyKey,
            Version);
    }

    protected abstract decimal CalculateEnergy(EnergyNutrients nutrients);
}

/// <summary>
/// General Atwater 4/4/9 applied to total carbohydrate, the conventional US treatment. Fibre is
/// therefore charged 4 kcal/g, which is the accepted convention for this policy rather than an
/// oversight; choose <see cref="Eu1169EnergyPolicy"/> when fibre must carry its own factor.
/// </summary>
public sealed class AtwaterEnergyPolicy : EnergyFactorPolicyBase
{
    public const string Key = "Atwater";

    public override string PolicyKey => Key;

    protected override decimal CalculateEnergy(EnergyNutrients nutrients) =>
        nutrients.ProteinGrams * 4m + nutrients.CarbohydrateGrams * 4m + nutrients.FatGrams * 9m;
}

public sealed class Eu1169EnergyPolicy : EnergyFactorPolicyBase
{
    public const string Key = "Eu1169";

    public override string PolicyKey => Key;

    // Annex XIV charges "carbohydrate (except polyols)" at 4 kcal/g and gives fibre, polyols, and
    // erythritol their own factors. Charging total carbohydrate here would bill fibre at 4 + 2 and
    // polyols at 4 + 2.4, so available carbohydrate is the only correct base.
    protected override decimal CalculateEnergy(EnergyNutrients nutrients) =>
        nutrients.ProteinGrams * 4m +
        nutrients.AvailableCarbohydrateGrams * 4m +
        nutrients.FatGrams * 9m +
        nutrients.PolyolGrams * 2.4m +
        nutrients.SalatrimGrams * 6m +
        nutrients.EthanolGrams * 7m +
        nutrients.OrganicAcidGrams * 3m +
        nutrients.FibreGrams * 2m +
        nutrients.ErythritolGrams * 0m;
}

public sealed record EnergyComparison(
    decimal ComputedKilocalories,
    decimal? ProviderKilocalories,
    decimal ToleranceKilocalories,
    bool HasDiscrepancy,
    string PolicyKey,
    string PolicyVersion);

public static class EnergyComparisonCalculator
{
    public static EnergyComparison Compare(
        IEnergyFactorPolicy policy,
        EnergyNutrients nutrients,
        decimal? providerKilocalories,
        decimal toleranceKilocalories)
    {
        ArgumentNullException.ThrowIfNull(policy);
        if (providerKilocalories < 0m || toleranceKilocalories < 0m)
        {
            throw new ArgumentOutOfRangeException(nameof(providerKilocalories));
        }

        var result = policy.Calculate(nutrients);
        return new EnergyComparison(
            result.Kilocalories,
            providerKilocalories,
            toleranceKilocalories,
            providerKilocalories is { } supplied && Math.Abs(supplied - result.Kilocalories) > toleranceKilocalories,
            result.PolicyKey,
            result.PolicyVersion);
    }
}

public enum PreparationBasis
{
    Raw = 1,
    Cooked = 2,
    AsSold = 3,
    Prepared = 4,
}

public sealed record CookingFactor(
    string SourceKey,
    string SourceVersion,
    PreparationBasis FromBasis,
    PreparationBasis ToBasis,
    decimal Factor);

public sealed record NutrientQuantity(
    decimal WeightGrams,
    PreparationBasis Basis,
    EnergyNutrients Nutrients);

public static class PreparationBasisCalculator
{
    public static NutrientQuantity Resolve(
        NutrientQuantity source,
        decimal requestedWeightGrams,
        PreparationBasis requestedBasis,
        CookingFactor? yieldFactor = null,
        CookingFactor? retentionFactor = null)
    {
        if (source.WeightGrams <= 0m || requestedWeightGrams <= 0m)
        {
            throw new ArgumentOutOfRangeException(nameof(requestedWeightGrams), "Food weights must be positive.");
        }

        if (source.Basis == requestedBasis)
        {
            if (yieldFactor is not null || retentionFactor is not null)
            {
                throw new ArgumentException("Cooking factors cannot be applied when preparation bases already match.");
            }

            return Scale(source, requestedWeightGrams / source.WeightGrams, requestedWeightGrams, requestedBasis);
        }

        if (source.Basis != PreparationBasis.Raw || requestedBasis != PreparationBasis.Cooked)
        {
            throw new ArgumentException("A raw/cooked mismatch requires an explicit supported raw-to-cooked transformation.");
        }

        ValidateFactor(yieldFactor, PreparationBasis.Raw, PreparationBasis.Cooked, "yield", MaximumYieldFactor);
        ValidateFactor(retentionFactor, PreparationBasis.Raw, PreparationBasis.Cooked, "retention", MaximumRetentionFactor);

        var cookedWeight = source.WeightGrams * yieldFactor!.Factor;
        var retained = Scale(source, retentionFactor!.Factor, cookedWeight, PreparationBasis.Cooked);
        return Scale(retained, requestedWeightGrams / cookedWeight, requestedWeightGrams, PreparationBasis.Cooked);
    }

    // Water-absorbing staples gain mass when cooked: rice and burghul land near 3x and pasta near
    // 2.4x, so a 2.0 ceiling made the Lebanese launch menu unrepresentable. 5.0 still rejects the
    // order-of-magnitude typo a 2.0 cap was protecting against.
    public const decimal MaximumYieldFactor = 5m;

    // A retention factor is the fraction of a nutrient surviving cooking, so it cannot exceed 1.
    // Concentration from moisture loss is already carried by the yield factor.
    public const decimal MaximumRetentionFactor = 1m;

    private static void ValidateFactor(
        CookingFactor? factor,
        PreparationBasis from,
        PreparationBasis to,
        string name,
        decimal maximum)
    {
        if (factor is null || factor.FromBasis != from || factor.ToBasis != to ||
            factor.Factor <= 0m || factor.Factor > maximum ||
            string.IsNullOrWhiteSpace(factor.SourceKey) || string.IsNullOrWhiteSpace(factor.SourceVersion))
        {
            throw new ArgumentException(
                $"A valid, sourced {name} factor greater than 0 and no more than {maximum:0.##} is required.",
                nameof(factor));
        }
    }

    private static NutrientQuantity Scale(
        NutrientQuantity source,
        decimal multiplier,
        decimal weightGrams,
        PreparationBasis basis) =>
        new(
            decimal.Round(weightGrams, 6, MidpointRounding.AwayFromZero),
            basis,
            new EnergyNutrients(
                source.Nutrients.ProteinGrams * multiplier,
                source.Nutrients.CarbohydrateGrams * multiplier,
                source.Nutrients.FatGrams * multiplier,
                source.Nutrients.PolyolGrams * multiplier,
                source.Nutrients.SalatrimGrams * multiplier,
                source.Nutrients.EthanolGrams * multiplier,
                source.Nutrients.OrganicAcidGrams * multiplier,
                source.Nutrients.FibreGrams * multiplier,
                source.Nutrients.ErythritolGrams * multiplier));
}
