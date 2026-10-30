using System.Globalization;

namespace TB.Gym.Modules.Strength;

/// <summary>
/// TrainingMaxShare v1 (critique B7b, the owner's choice of 2026-10-27): a training max set at 90 % of an
/// estimated one-rep max, Wendler's starting point for 5/3/1, kept to three decimals as every max is. A
/// training max is deliberately lighter than the best single, so a program does not run off one good day
/// ("Training is NOT testing"). Named and versioned: another share is v2, never an edit.
/// </summary>
public static class TrainingMaxShare
{
    public const string Key = "TrainingMaxShare";
    public const string CurrentVersion = "1.0";
    public const decimal Percent = 90m;

    public static decimal Apply(decimal estimate)
    {
        if (estimate is <= 0m or > 2_000m)
        {
            throw new ArgumentOutOfRangeException(nameof(estimate), "An estimate must be more than 0 and at most 2,000.");
        }

        return decimal.Round(estimate * Percent / 100m, 3, MidpointRounding.AwayFromZero);
    }

    /// <summary>"TrainingMaxShare v1: 90% of 116.667 kg = 105 kg."</summary>
    public static string Explain(decimal estimate, LoadUnit unit)
    {
        var unitName = StrengthUnits.Short(unit);
        return string.Create(
            CultureInfo.InvariantCulture,
            $"TrainingMaxShare v1: {Percent:0.##}% of {estimate:0.###} {unitName} = {Apply(estimate):0.###} {unitName}.");
    }
}
