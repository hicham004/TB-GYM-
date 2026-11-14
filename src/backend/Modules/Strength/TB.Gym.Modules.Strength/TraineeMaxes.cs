using System.Globalization;

namespace TB.Gym.Modules.Strength;

/// <summary>
/// A max a self-directed trainee of the house types for themselves (STR-021, notes plan N9c3): the training max a
/// program works its weights out from, recorded like a coach's (append-only, STR-001), with its own method name so
/// the history says who typed it. Sensible values only: a typing slip of a trainee alone has nobody to catch it.
/// </summary>
public static class TraineeMaxRule
{
    public const string MethodKey = "TraineeTyped";
    public const string MethodVersion = "1.0";
    public const decimal KilogramCeiling = 500m;
    public const decimal PoundCeiling = 1100m;

    /// <summary>Why a typed max is refused, in plain words, by field ("value", "unit"); empty when it is sensible.</summary>
    public static IReadOnlyDictionary<string, string> Problems(decimal value, LoadUnit unit)
    {
        if (!Enum.IsDefined(unit))
        {
            return new Dictionary<string, string>(StringComparer.Ordinal) { ["unit"] = "Choose kg or lb." };
        }

        var ceiling = unit == LoadUnit.Pound ? PoundCeiling : KilogramCeiling;
        var word = unit == LoadUnit.Pound ? "lb" : "kg";
        return value <= 0m || value > ceiling || decimal.Round(value, 2) != value
            ? new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["value"] = string.Create(
                    CultureInfo.InvariantCulture,
                    $"Enter a max above 0 and at most {ceiling:#,0} {word}, with two decimals at most."),
            }
            : new Dictionary<string, string>(StringComparer.Ordinal);
    }

    /// <summary>The trainee's training max for a lift, dated the house's day it was typed.</summary>
    public static StrengthMaxRecord Record(
        Guid tenantId,
        Guid clientProfileId,
        Guid exerciseId,
        decimal value,
        LoadUnit unit,
        DateOnly today)
    {
        if (Problems(value, unit).Count > 0)
        {
            throw new ArgumentException("A trainee's max must be a sensible weight.", nameof(value));
        }

        return StrengthMaxRecord.Create(
            tenantId,
            clientProfileId,
            exerciseId,
            StrengthMaxKind.CoachWorkingMax,
            value,
            unit,
            today,
            StrengthMaxSource.Manual,
            MethodKey,
            MethodVersion,
            null,
            null);
    }
}
