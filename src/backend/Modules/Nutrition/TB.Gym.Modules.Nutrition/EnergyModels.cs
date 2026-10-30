using System.Globalization;

namespace TB.Gym.Modules.Nutrition;

/// <summary>
/// Which energy model new calculations use (critique B8a, NUT-015). Version 1 is <see cref="OccupationStepsActivityModel"/>
/// as it always was; version 2 is <see cref="OccupationStepsActivityModelVersion2"/> or the coach's own multiplier
/// (<see cref="CoachChosenPal"/>), with the words, the walking line, the goal's rate and the floors around them.
/// Version 1 stays the default until version 2's table and words are reviewed (B8c); a setting turns version 2 on.
/// </summary>
public enum EnergyModelVersion
{
    Version1 = 1,
    Version2 = 2,
}

/// <summary>Steps a day in Tudor-Locke's five bands (2004, 2011): the columns of version 2's table.</summary>
public enum StepsBand
{
    /// <summary>Under 5,000 steps a day.</summary>
    Sedentary = 1,

    /// <summary>5,000 to 7,499.</summary>
    LowActive = 2,

    /// <summary>7,500 to 9,999.</summary>
    SomewhatActive = 3,

    /// <summary>10,000 to 12,499.</summary>
    Active = 4,

    /// <summary>12,500 and over.</summary>
    HighlyActive = 5,
}

/// <summary>
/// A refusal of one of the targets sheet's inputs that names the field it is about, so an answer can say it
/// beside that box (critique B8a).
/// </summary>
public sealed class EnergyModelInputException(string field, string message) : ArgumentException(message, field);

/// <summary>What the targets sheet says about how active a client is (NUT-007), as it was sent.</summary>
/// <param name="WorkoutsPerWeek">Version 2: 0 to 7, filled in from their program; the server keeps what was sent.</param>
/// <param name="ChosenPal">Version 2: the coach's own multiplier, in place of the table's.</param>
/// <param name="ChosenPalReason">Why the coach chose it, when they said.</param>
public sealed record ActivityRequest(
    OccupationActivityType OccupationType,
    int AverageDailySteps,
    int? WorkoutsPerWeek = null,
    decimal? ChosenPal = null,
    string? ChosenPalReason = null);

/// <summary>
/// The words beside the multiplier (critique B8a, NUT-015) and the parts they are made of: the table's value for
/// the kind of work and the steps band and the workouts' term (<see cref="OccupationStepsActivityModelVersion2"/>),
/// or the coach's own multiplier with the words of its pick and their reason (<see cref="CoachChosenPal"/>).
/// </summary>
/// <param name="Words">"Counts as low active: × 1.68 (mixed work with 5,000 steps a day × 1.60, plus 4 workouts a week + 0.08)".</param>
/// <param name="StepsBandName">The steps band in words: "sedentary", "low active", "somewhat active", "active" or "highly active".</param>
/// <param name="TableValue">The table's cell; null for the coach's own multiplier.</param>
/// <param name="WorkoutTerm">What the workouts add; null for the coach's own multiplier.</param>
/// <param name="ChosenWords">The words of the pick the coach chose; null for the table, or a multiplier they typed.</param>
/// <param name="Reason">Why the coach chose their own multiplier, when they said.</param>
public sealed record ActivityWords(
    string MethodKey,
    string MethodVersion,
    decimal Pal,
    string Words,
    OccupationActivityType OccupationType,
    int AverageDailySteps,
    StepsBand StepsBand,
    string StepsBandName,
    int WorkoutsPerWeek,
    decimal? TableValue,
    decimal? WorkoutTerm,
    string? ChosenWords,
    string? Reason);

/// <summary>One of the coach's picks (<see cref="CoachChosenPal"/>): a multiplier and the plain words it is chosen by.</summary>
public sealed record CoachPalPick(decimal Pal, string Words);

/// <summary>
/// OccupationStepsPal version 2 (critique B8a, NUT-015, ADR 0008 amended 2026-10-30): the kind of work in four kinds,
/// steps a day in Tudor-Locke's five bands, and 0.02 for each workout a week, 0.14 at most, inside FAO/WHO/UNU's
/// 1.40 to 2.40. Version 1's bands were 5,000 steps wide and its Physical spanned a waiter and a farm labourer, so
/// every mixed-work client from 5,000 to 9,999 steps read 1.80, FAO's active band. These cells are anchored on
/// FAO/WHO/UNU 2004's worked days (an office clerk with an hour of walking 1.53, a standing job with walking 1.64,
/// farm labour 2.25), the IOM's bands and about 0.015 to 0.02 per 1,000 steps; an hour of lifting is 245 to 390 kcal
/// net for a 97 kg man, so 0.02 a weekly workout is the conservative end. A draft for the review B8c records;
/// version 1 stays for every calculation made with it.
/// </summary>
public static class OccupationStepsActivityModelVersion2
{
    public const string Key = OccupationStepsActivityModel.Key;
    public const string Version = "2.0";
    public const int MaximumWorkoutsPerWeek = 7;
    public const decimal WorkoutTerm = 0.02m;
    public const decimal MaximumWorkoutTerm = 0.14m;

    public static IReadOnlyList<OccupationActivityType> KindsOfWork { get; } =
    [
        OccupationActivityType.Seated,
        OccupationActivityType.Mixed,
        OccupationActivityType.OnTheirFeet,
        OccupationActivityType.HeavyManual,
    ];

    public static StepsBand BandFor(int averageDailySteps) => averageDailySteps switch
    {
        < 5_000 => StepsBand.Sedentary,
        < 7_500 => StepsBand.LowActive,
        < 10_000 => StepsBand.SomewhatActive,
        < 12_500 => StepsBand.Active,
        _ => StepsBand.HighlyActive,
    };

    /// <summary>The table: a row for each kind of work, a column for each steps band.</summary>
    public static decimal TableValue(OccupationActivityType kind, StepsBand band) => (kind, band) switch
    {
        (OccupationActivityType.Seated, StepsBand.Sedentary) => 1.45m,
        (OccupationActivityType.Seated, StepsBand.LowActive) => 1.50m,
        (OccupationActivityType.Seated, StepsBand.SomewhatActive) => 1.55m,
        (OccupationActivityType.Seated, StepsBand.Active) => 1.60m,
        (OccupationActivityType.Seated, StepsBand.HighlyActive) => 1.65m,
        (OccupationActivityType.Mixed, StepsBand.Sedentary) => 1.55m,
        (OccupationActivityType.Mixed, StepsBand.LowActive) => 1.60m,
        (OccupationActivityType.Mixed, StepsBand.SomewhatActive) => 1.65m,
        (OccupationActivityType.Mixed, StepsBand.Active) => 1.70m,
        (OccupationActivityType.Mixed, StepsBand.HighlyActive) => 1.75m,
        (OccupationActivityType.OnTheirFeet, StepsBand.Sedentary) => 1.65m,
        (OccupationActivityType.OnTheirFeet, StepsBand.LowActive) => 1.70m,
        (OccupationActivityType.OnTheirFeet, StepsBand.SomewhatActive) => 1.75m,
        (OccupationActivityType.OnTheirFeet, StepsBand.Active) => 1.80m,
        (OccupationActivityType.OnTheirFeet, StepsBand.HighlyActive) => 1.85m,
        (OccupationActivityType.HeavyManual, StepsBand.Sedentary) => 1.90m,
        (OccupationActivityType.HeavyManual, StepsBand.LowActive) => 1.95m,
        (OccupationActivityType.HeavyManual, StepsBand.SomewhatActive) => 2.00m,
        (OccupationActivityType.HeavyManual, StepsBand.Active) => 2.05m,
        (OccupationActivityType.HeavyManual, StepsBand.HighlyActive) => 2.10m,
        _ => throw new EnergyModelInputException("occupationType", EnergyModels.KindRefusal(EnergyModelVersion.Version2, kind)),
    };

    /// <summary>What the workouts add: 0.02 for each workout a week, 0.14 at most.</summary>
    public static decimal TermFor(int workoutsPerWeek) =>
        workoutsPerWeek is < 0 or > MaximumWorkoutsPerWeek
            ? throw new EnergyModelInputException("workoutsPerWeek", EnergyModels.WorkoutsRefusal)
            : Math.Min(workoutsPerWeek * WorkoutTerm, MaximumWorkoutTerm);

    public static ActivityModelResult Calculate(ActivityModelInput input)
    {
        if (input.WorkoutsPerWeek is not { } workouts)
        {
            throw new EnergyModelInputException("workoutsPerWeek", EnergyModels.WorkoutsRefusal);
        }

        EnergyModels.RequireSteps(input.AverageDailySteps);
        var pal = TableValue(input.OccupationType, BandFor(input.AverageDailySteps)) + TermFor(workouts);
        if (pal is < PalGuard.Minimum or > PalGuard.Maximum)
        {
            throw new InvalidOperationException("Calculated PAL is outside the supported FAO/WHO/UNU range.");
        }

        return new ActivityModelResult(pal, PalGuard.BandFor(pal), Key, Version, input);
    }
}

/// <summary>
/// The coach's own multiplier (critique B8a, NUT-015): "Or choose the multiplier yourself", one of the picks in plain
/// words or one they type, 1.40 to 2.40 with at most three decimals, and a reason if they want. The familiar ladder's
/// 1.2 and 1.375 are refused in words, as below the lowest whole day FAO/WHO/UNU gives. It is recorded as its own
/// activity model, so a calculation says the number was the coach's and not the table's, in the append-only
/// calculation with the inputs it was sent, the reason among them; the picks' words are this version's. Version 1.
/// </summary>
public static class CoachChosenPal
{
    public const string Key = "CoachChosenPal";
    public const string Version = "1.0";
    public const int MaximumReasonLength = 500;

    /// <summary>The familiar activity ladder from FAO/WHO/UNU's lowest whole day up, in plain words.</summary>
    public static IReadOnlyList<CoachPalPick> Picks { get; } =
    [
        new(1.40m, "little movement, no exercise"),
        new(1.55m, "moderate exercise 3 to 5 days a week"),
        new(1.725m, "hard exercise 6 to 7 days a week"),
        new(1.90m, "very hard training daily or heavy manual work"),
        new(2.20m, "heavy manual work and hard training most days"),
        new(2.40m, "heavy manual work all day and training every day"),
    ];

    public static ActivityModelResult Calculate(decimal chosenPal, ActivityModelInput input, string? reason = null)
    {
        Require(chosenPal);
        Reason(reason);
        return new ActivityModelResult(chosenPal, PalGuard.BandFor(chosenPal), Key, Version, input);
    }

    public static void Require(decimal chosenPal)
    {
        if (chosenPal < PalGuard.Minimum)
        {
            throw new EnergyModelInputException("chosenPal", string.Create(
                CultureInfo.InvariantCulture,
                $"A multiplier of {chosenPal:0.###} is under 1.40, the lowest FAO/WHO/UNU's scale gives a healthy adult's whole day. Choose one from 1.40 to 2.40."));
        }

        if (chosenPal > PalGuard.Maximum)
        {
            throw new EnergyModelInputException("chosenPal", string.Create(
                CultureInfo.InvariantCulture,
                $"A multiplier of {chosenPal:0.###} is over 2.40, the highest FAO/WHO/UNU's scale gives a whole day that can be kept up. Choose one from 1.40 to 2.40."));
        }

        if (decimal.Round(chosenPal, 3) != chosenPal)
        {
            throw new EnergyModelInputException("chosenPal", "Type the multiplier with at most three decimals, like 1.725.");
        }
    }

    /// <summary>The words of the pick at this multiplier; null for one the coach typed.</summary>
    public static string? WordsFor(decimal pal) => Picks.FirstOrDefault(pick => pick.Pal == pal)?.Words;

    /// <summary>The reason as it is kept: trimmed, and none when nothing is left.</summary>
    public static string? Reason(string? reason)
    {
        var trimmed = reason?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return null;
        }

        return trimmed.Length > MaximumReasonLength
            ? throw new EnergyModelInputException("chosenPalReason", "Keep the reason to 500 characters.")
            : trimmed;
    }
}

/// <summary>
/// The multiplier a new calculation uses, by the energy model in force (critique B8a, NUT-015), and the words beside
/// it. Each version takes only its own inputs and says in words what it does not take.
/// </summary>
public static class EnergyModels
{
    public const int MaximumDailySteps = 100_000;

    internal const string WorkoutsRefusal = "Say how many workouts a week they do, from 0 to 7.";

    private const string VersionOneRefusal = "which this server does not use yet";

    private static readonly OccupationActivityType[] VersionOneKinds =
    [
        OccupationActivityType.Seated,
        OccupationActivityType.Mixed,
        OccupationActivityType.Physical,
    ];

    public static IReadOnlyList<OccupationActivityType> KindsOfWork(EnergyModelVersion version) =>
        version == EnergyModelVersion.Version1 ? VersionOneKinds : OccupationStepsActivityModelVersion2.KindsOfWork;

    /// <summary>What a version takes, for the targets sheet to ask for.</summary>
    public static EnergyModelView Describe(EnergyModelVersion version) => version == EnergyModelVersion.Version1
        ? new((int)version, OccupationStepsActivityModel.Key, OccupationStepsActivityModel.CurrentVersion, VersionOneKinds, null, null)
        : new(
            (int)version,
            OccupationStepsActivityModelVersion2.Key,
            OccupationStepsActivityModelVersion2.Version,
            OccupationStepsActivityModelVersion2.KindsOfWork,
            OccupationStepsActivityModelVersion2.MaximumWorkoutsPerWeek,
            new CoachChosenPalView(CoachChosenPal.Key, CoachChosenPal.Version, PalGuard.Minimum, PalGuard.Maximum, CoachChosenPal.Picks));

    public static ActivityModelResult Activity(EnergyModelVersion version, ActivityRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        RequireSteps(request.AverageDailySteps);
        if (!KindsOfWork(version).Contains(request.OccupationType))
        {
            throw new EnergyModelInputException("occupationType", KindRefusal(version, request.OccupationType));
        }

        if (version == EnergyModelVersion.Version1)
        {
            if (request.WorkoutsPerWeek is not null)
            {
                throw new EnergyModelInputException("workoutsPerWeek", $"Workouts a week are part of energy version 2, {VersionOneRefusal}.");
            }

            if (request.ChosenPal is not null || request.ChosenPalReason is not null)
            {
                throw new EnergyModelInputException("chosenPal", $"Choosing the multiplier yourself is part of energy version 2, {VersionOneRefusal}.");
            }

            return OccupationStepsActivityModel.Calculate(new ActivityModelInput(request.OccupationType, request.AverageDailySteps));
        }

        if (request.WorkoutsPerWeek is not { } workouts || workouts is < 0 or > OccupationStepsActivityModelVersion2.MaximumWorkoutsPerWeek)
        {
            throw new EnergyModelInputException("workoutsPerWeek", WorkoutsRefusal);
        }

        if (request.ChosenPal is null && CoachChosenPal.Reason(request.ChosenPalReason) is not null)
        {
            throw new EnergyModelInputException("chosenPalReason", "A reason goes with a multiplier you choose yourself.");
        }

        var input = new ActivityModelInput(request.OccupationType, request.AverageDailySteps, workouts);
        return request.ChosenPal is { } chosen
            ? CoachChosenPal.Calculate(chosen, input, request.ChosenPalReason)
            : OccupationStepsActivityModelVersion2.Calculate(input);
    }

    /// <summary>
    /// The words beside a calculation's multiplier, from the model that made it and what it was sent; version 1 has
    /// none, and neither has a calculation whose inputs no longer read as its model takes them.
    /// </summary>
    public static ActivityWords? Words(string methodKey, string methodVersion, ActivityRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (request.WorkoutsPerWeek is not { } workouts)
        {
            return null;
        }

        try
        {
            var band = OccupationStepsActivityModelVersion2.BandFor(request.AverageDailySteps);
            var bandName = BandName(band);
            if (methodKey == OccupationStepsActivityModelVersion2.Key && methodVersion == OccupationStepsActivityModelVersion2.Version && request.ChosenPal is null)
            {
                var table = OccupationStepsActivityModelVersion2.TableValue(request.OccupationType, band);
                var term = OccupationStepsActivityModelVersion2.TermFor(workouts);
                var pal = table + term;
                var steps = string.Create(CultureInfo.InvariantCulture, $"{WorkPhrase(request.OccupationType)} with {request.AverageDailySteps:#,0} steps a day");
                var words = workouts == 0
                    ? string.Create(CultureInfo.InvariantCulture, $"Counts as {bandName}: × {pal:0.00} ({steps}, no workouts a week)")
                    : string.Create(CultureInfo.InvariantCulture, $"Counts as {bandName}: × {pal:0.00} ({steps} × {table:0.00}, plus {workouts} {(workouts == 1 ? "workout" : "workouts")} a week + {term:0.00})");
                return new ActivityWords(methodKey, methodVersion, pal, words, request.OccupationType, request.AverageDailySteps, band, bandName, workouts, table, term, null, null);
            }

            if (methodKey == CoachChosenPal.Key && methodVersion == CoachChosenPal.Version && request.ChosenPal is { } chosen)
            {
                CoachChosenPal.Require(chosen);
                var pick = CoachChosenPal.WordsFor(chosen);
                var words = pick is null
                    ? string.Create(CultureInfo.InvariantCulture, $"Chosen by the coach: × {chosen:0.00#}")
                    : string.Create(CultureInfo.InvariantCulture, $"Chosen by the coach: × {chosen:0.00#} ({pick})");
                return new ActivityWords(methodKey, methodVersion, chosen, words, request.OccupationType, request.AverageDailySteps, band, bandName, workouts, null, null, pick, CoachChosenPal.Reason(request.ChosenPalReason));
            }
        }
        catch (ArgumentException)
        {
            // The result stays; only its words are left out.
        }

        return null;
    }

    public static string BandName(StepsBand band) => band switch
    {
        StepsBand.Sedentary => "sedentary",
        StepsBand.LowActive => "low active",
        StepsBand.SomewhatActive => "somewhat active",
        StepsBand.Active => "active",
        StepsBand.HighlyActive => "highly active",
        _ => throw new ArgumentOutOfRangeException(nameof(band)),
    };

    internal static void RequireSteps(int averageDailySteps)
    {
        if (averageDailySteps is < 0 or > MaximumDailySteps)
        {
            throw new EnergyModelInputException("averageDailySteps", "Steps a day have to be between 0 and 100,000.");
        }
    }

    internal static string KindRefusal(EnergyModelVersion version, OccupationActivityType kind) => (version, kind) switch
    {
        (EnergyModelVersion.Version2, OccupationActivityType.Physical) =>
            "Physical work is split in two now: choose on their feet (teaching, retail, nursing, serving) or heavy manual work (building, farm, moving loads).",
        (EnergyModelVersion.Version1, OccupationActivityType.OnTheirFeet or OccupationActivityType.HeavyManual) =>
            $"Work on their feet and heavy manual work are energy version 2's, {VersionOneRefusal}. Choose seated, mixed or physical.",
        _ => "Choose the kind of work they do.",
    };

    private static string WorkPhrase(OccupationActivityType kind) => kind switch
    {
        OccupationActivityType.Seated => "seated work",
        OccupationActivityType.Mixed => "mixed work",
        OccupationActivityType.OnTheirFeet => "work on their feet",
        OccupationActivityType.HeavyManual => "heavy manual work",
        _ => "physical work",
    };
}

/// <summary>What a client's steps are worth beside the multiplier (<see cref="WalkingCost"/>), never added to it.</summary>
/// <param name="Kilocalories">Rounded to ten.</param>
/// <param name="Words">"Their 5,000 steps are inside that, worth about 180 calories a day at 97 kg."</param>
public sealed record WalkingWords(int AverageDailySteps, decimal WeightKilograms, decimal Kilocalories, string Words, string MethodKey, string MethodVersion);

/// <summary>
/// What a client's steps are worth (critique B8a, NUT-015), said beside the multiplier and never added to it: walking
/// is inside every whole-day multiplier, so adding it on top would count it twice. About 0.5 kcal for each kilogram
/// and kilometre above rest (the ACSM walking equation; the literature spans 0.41 to 0.59), at 0.75 m a step, rounded
/// to ten, so ±25 % with stride and pace. Shown, never stored. Version 1.
/// </summary>
public static class WalkingCost
{
    public const string Key = "WalkingCost";
    public const string Version = "1.0";
    public const decimal KilocaloriesPerKilogramKilometre = 0.5m;
    public const decimal MetresPerStep = 0.75m;

    public static decimal Kilocalories(int averageDailySteps, decimal weightKilograms)
    {
        EnergyModels.RequireSteps(averageDailySteps);
        if (weightKilograms is <= 0m or > 500m)
        {
            throw new ArgumentOutOfRangeException(nameof(weightKilograms), "Weight must be more than 0 and at most 500 kg.");
        }

        var kilometres = averageDailySteps * MetresPerStep / 1_000m;
        var cost = KilocaloriesPerKilogramKilometre * weightKilograms * kilometres;
        return decimal.Round(cost / 10m, 0, MidpointRounding.AwayFromZero) * 10m;
    }

    /// <summary>The line beside the multiplier; none when the steps come to less than five calories.</summary>
    public static WalkingWords? Describe(int averageDailySteps, decimal weightKilograms)
    {
        var calories = Kilocalories(averageDailySteps, weightKilograms);
        if (calories <= 0m)
        {
            return null;
        }

        var words = string.Create(
            CultureInfo.InvariantCulture,
            $"Their {averageDailySteps:#,0} steps are inside that, worth about {calories:#,0} calories a day at {decimal.Round(weightKilograms, 0, MidpointRounding.AwayFromZero):0} kg.");
        return new WalkingWords(averageDailySteps, weightKilograms, calories, words, Key, Version);
    }
}

/// <summary>A goal's rate and share (<see cref="WeeklyWeightChange"/>).</summary>
/// <param name="KilogramsPerWeek">Rounded to 0.1 kg, minus for a loss.</param>
/// <param name="ShareOfMaintenance">The target as a whole percent of what they burn; null while that is not known.</param>
/// <param name="Words">"−500 a day ≈ 0.5 kg a week, 84% of what they burn".</param>
public sealed record GoalRate(decimal GoalAdjustment, decimal KilogramsPerWeek, decimal? ShareOfMaintenance, string Words, string MethodKey, string MethodVersion);

/// <summary>
/// How fast a goal moves a client's weight (critique B8a, NUT-015), said beside each goal: the goal's calories a day
/// over a week, at 7,700 kcal a kilogram (Wishnofsky's 3,500 kcal a pound), rounded to 0.1 kg and said as "about".
/// It holds for the first weeks; the body adapts, so later weeks move less (Hall 2008). The share is the target
/// against what they burn. Version 1.
/// </summary>
public static class WeeklyWeightChange
{
    public const string Key = "WeeklyWeightChange";
    public const string Version = "1.0";
    public const decimal KilocaloriesPerKilogram = 7_700m;

    public static decimal KilogramsPerWeek(decimal goalAdjustment) => goalAdjustment * 7m / KilocaloriesPerKilogram;

    public static GoalRate Describe(decimal goalAdjustment, decimal? tdeeEstimate)
    {
        var perWeek = decimal.Round(KilogramsPerWeek(goalAdjustment), 1, MidpointRounding.AwayFromZero);
        var amount = goalAdjustment switch
        {
            < 0m => string.Create(CultureInfo.InvariantCulture, $"−{-goalAdjustment:#,0.##}"),
            > 0m => string.Create(CultureInfo.InvariantCulture, $"+{goalAdjustment:#,0.##}"),
            _ => "0",
        };
        var rate = goalAdjustment == 0m ? "no change in weight"
            : perWeek == 0m ? "under 0.1 kg a week"
            : string.Create(CultureInfo.InvariantCulture, $"{Math.Abs(perWeek):0.0} kg a week");
        if (tdeeEstimate is not { } tdee || tdee <= 0m)
        {
            return new GoalRate(goalAdjustment, perWeek, null, $"{amount} a day ≈ {rate}", Key, Version);
        }

        if (tdee + goalAdjustment <= 0m)
        {
            return new GoalRate(goalAdjustment, perWeek, null, $"{amount} a day is more than they burn", Key, Version);
        }

        var share = decimal.Round((tdee + goalAdjustment) / tdee * 100m, 0, MidpointRounding.AwayFromZero);
        return new GoalRate(
            goalAdjustment,
            perWeek,
            share,
            string.Create(CultureInfo.InvariantCulture, $"{amount} a day ≈ {rate}, {share:0}% of what they burn"),
            Key,
            Version);
    }
}

/// <summary>
/// The energy target's coaching review floors (critique B8a, NUT-015), warnings and never refusals, as protein's range
/// is: a target under what the body burns at rest, and under 1,200 kcal a day for women or 1,500 for men, the floors
/// calculator.net and MyFitnessPal keep. The coach decides.
/// </summary>
public static class EnergyTargetFloors
{
    public const decimal WomenMinimum = 1_200m;
    public const decimal MenMinimum = 1_500m;

    public static IReadOnlyList<string> Warnings(decimal calorieTarget, decimal bmrEstimate, FormulaSex sex)
    {
        var warnings = new List<string>(2);
        if (calorieTarget < bmrEstimate)
        {
            warnings.Add(string.Create(
                CultureInfo.InvariantCulture,
                $"The target, {calorieTarget:#,0} calories a day, is under what their body burns at rest ({bmrEstimate:#,0}). This is a warning, not a clinical determination."));
        }

        var (floor, who) = sex == FormulaSex.Male ? (MenMinimum, "men") : (WomenMinimum, "women");
        if (calorieTarget < floor)
        {
            warnings.Add(string.Create(
                CultureInfo.InvariantCulture,
                $"The target, {calorieTarget:#,0} calories a day, is under {floor:#,0}, the floor most calculators keep for {who}. This is a warning, not a clinical determination."));
        }

        return warnings;
    }
}

/// <summary>The resting-energy formulas by key (NUT-007): Mifflin-St Jeor the default, the other two explicit choices.</summary>
public static class BmrStrategies
{
    public static IBmrStrategy For(string? key) => key switch
    {
        MifflinStJeorBmrStrategy.Key => new MifflinStJeorBmrStrategy(),
        KatchMcArdleBmrStrategy.Key => new KatchMcArdleBmrStrategy(),
        HarrisBenedictRevisedBmrStrategy.Key => new HarrisBenedictRevisedBmrStrategy(),
        _ => throw new EnergyModelInputException("bmrMethodKey", "A supported BMR strategy is required."),
    };
}

/// <summary>
/// The targets sheet's numbers so far (critique B8a, NUT-015), worked out as Work out would under energy version 2 and
/// recorded nowhere: the multiplier and the words beside it, what their steps are worth, what they burn, and each
/// goal's rate and share. Every number sent is checked as Work out checks it; one still missing leaves out only what
/// needs it.
/// </summary>
public static class EnergyPreviews
{
    public const int MaximumGoals = 10;
    public const decimal MaximumGoalAdjustment = 5_000m;

    public static EnergyPreviewView Work(PreviewEnergyRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (request.AverageDailySteps is { } sentSteps)
        {
            EnergyModels.RequireSteps(sentSteps);
        }

        if (request.WorkoutsPerWeek is { } sentWorkouts)
        {
            OccupationStepsActivityModelVersion2.TermFor(sentWorkouts);
        }

        if (request.ChosenPal is { } sentPal)
        {
            CoachChosenPal.Require(sentPal);
        }

        if (request.OccupationType is { } sentKind && !OccupationStepsActivityModelVersion2.KindsOfWork.Contains(sentKind))
        {
            throw new EnergyModelInputException("occupationType", EnergyModels.KindRefusal(EnergyModelVersion.Version2, sentKind));
        }

        if (request.WeightKilograms is <= 0m or > 500m)
        {
            throw new EnergyModelInputException("weightKilograms", "Weight has to be more than 0 and at most 500 kg.");
        }

        var goals = request.GoalAdjustments ?? [];
        if (goals.Count > MaximumGoals)
        {
            throw new EnergyModelInputException("goalAdjustments", "Ask about 10 goals at most.");
        }

        if (goals.Any(goal => Math.Abs(goal) > MaximumGoalAdjustment))
        {
            throw new EnergyModelInputException("goalAdjustments", "A goal has to be within 5,000 calories a day of what they burn.");
        }

        ActivityModelResult? activity = null;
        ActivityWords? words = null;
        if (request is { OccupationType: { } kind, AverageDailySteps: { } steps, WorkoutsPerWeek: { } workouts })
        {
            var activityRequest = new ActivityRequest(kind, steps, workouts, request.ChosenPal);
            activity = EnergyModels.Activity(EnergyModelVersion.Version2, activityRequest);
            words = EnergyModels.Words(activity.MethodKey, activity.MethodVersion, activityRequest);
        }

        var walking = request is { AverageDailySteps: { } walked, WeightKilograms: { } carried }
            ? WalkingCost.Describe(walked, carried)
            : null;

        // An unknown formula is refused at once; a known one waits for what it needs (body fat for Katch-McArdle).
        BmrResult? bmr = null;
        if (request.BmrMethodKey is { } key)
        {
            var strategy = BmrStrategies.For(key);
            if (request is { WeightKilograms: { } weight, HeightCentimeters: { } height, AgeYears: { } age, Sex: { } sex } &&
                (key != KatchMcArdleBmrStrategy.Key || request.BodyFatPercentage is not null))
            {
                bmr = strategy.Estimate(new BmrInput(weight, height, age, sex, request.BodyFatPercentage));
            }
        }

        decimal? tdee = bmr is not null && activity is not null ? TdeeEstimator.Estimate(bmr, activity).KilocaloriesPerDay : null;
        return new EnergyPreviewView(words, walking, bmr?.KilocaloriesPerDay, tdee, [.. goals.Select(goal => WeeklyWeightChange.Describe(goal, tdee))]);
    }
}
