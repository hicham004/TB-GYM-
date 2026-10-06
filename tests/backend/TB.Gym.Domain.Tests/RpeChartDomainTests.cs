using TB.Gym.Modules.Strength;

namespace TB.Gym.Domain.Tests;

/// <summary>RpeChart v1 (STR-010, ADR 0036): the locked table, its limits and the loads it gives.</summary>
[TestClass]
public sealed class RpeChartDomainTests
{
    private static readonly decimal[] RpeRows = [10m, 9.5m, 9m, 8.5m, 8m, 7.5m, 7m, 6.5m];

    // The chart exactly as locked for v1. A change to any cell is a new version, so this table is not
    // edited: a failing test here means the chart was changed by accident.
    private static readonly decimal[][] LockedChart =
    [
        [100.0m, 95.5m, 92.2m, 89.2m, 86.3m, 83.7m, 81.1m, 78.6m, 76.2m, 73.9m, 70.7m, 68.0m],
        [97.8m, 93.9m, 90.7m, 87.8m, 85.0m, 82.4m, 79.9m, 77.4m, 75.1m, 72.3m, 69.4m, 66.7m],
        [95.5m, 92.2m, 89.2m, 86.3m, 83.7m, 81.1m, 78.6m, 76.2m, 73.9m, 70.7m, 68.0m, 65.3m],
        [93.9m, 90.7m, 87.8m, 85.0m, 82.4m, 79.9m, 77.4m, 75.1m, 72.3m, 69.4m, 66.7m, 64.0m],
        [92.2m, 89.2m, 86.3m, 83.7m, 81.1m, 78.6m, 76.2m, 73.9m, 70.7m, 68.0m, 65.3m, 62.6m],
        [90.7m, 87.8m, 85.0m, 82.4m, 79.9m, 77.4m, 75.1m, 72.3m, 69.4m, 66.7m, 64.0m, 61.3m],
        [89.2m, 86.3m, 83.7m, 81.1m, 78.6m, 76.2m, 73.9m, 70.7m, 68.0m, 65.3m, 62.6m, 59.9m],
        [87.8m, 85.0m, 82.4m, 79.9m, 77.4m, 75.1m, 72.3m, 69.4m, 66.7m, 64.0m, 61.3m, 58.6m],
    ];

    // Helms, Cronin, Storey, Zourdos, Strength & Conditioning Journal 38(4), 2016, Table 2: percentage
    // 1RM by RIR-based RPE (rows 10 to 7) and repetitions (1 to 8), from experienced squatters.
    private static readonly decimal[][] HelmsTable2 =
    [
        [100m, 95m, 91m, 87m, 85m, 83m, 81m, 79m],
        [97m, 93m, 89m, 86m, 84m, 82m, 80m, 77.5m],
        [95m, 91m, 87m, 85m, 83m, 81m, 79m, 76m],
        [93m, 89m, 86m, 84m, 82m, 80m, 77.5m, 74.5m],
        [91m, 87m, 85m, 83m, 81m, 79m, 76m, 73m],
        [89m, 86m, 84m, 82m, 80m, 77.5m, 74.5m, 71.5m],
        [87m, 85m, 83m, 81m, 79m, 76m, 73m, 70m],
    ];

    [TestMethod]
    public void EveryCellMatchesTheLockedVersionOneChart()
    {
        var mismatches = new List<string>();
        for (var row = 0; row < RpeRows.Length; row++)
        {
            for (var reps = 1; reps <= 12; reps++)
            {
                var actual = RtsRpeChart.PercentOfOneRepMax(reps, RpeRows[row]);
                if (actual != LockedChart[row][reps - 1])
                {
                    mismatches.Add($"RPE {RpeRows[row]} x {reps}: {actual} (locked {LockedChart[row][reps - 1]})");
                }
            }
        }

        Assert.IsEmpty(mismatches, string.Join("; ", mismatches));
    }

    [TestMethod]
    public void WholeRpeRowsAreTheRpeTenCurveShiftedAndHalfRowsAreMidpoints()
    {
        // Each RPE point below 10 is one more rep in reserve, so the row is the RPE 10 curve moved one rep.
        foreach (var rpe in new[] { 9m, 8m, 7m })
        {
            for (var reps = 1; reps + (10 - rpe) <= 12; reps++)
            {
                Assert.AreEqual(
                    RtsRpeChart.PercentOfOneRepMax(reps + (int)(10 - rpe), 10m),
                    RtsRpeChart.PercentOfOneRepMax(reps, rpe),
                    $"RPE {rpe} x {reps}");
            }
        }

        // A half RPE point is half a rep in reserve: the midpoint of its neighbours, rounded half up.
        foreach (var rpe in new[] { 9.5m, 8.5m, 7.5m })
        {
            for (var reps = 1; reps <= 12; reps++)
            {
                var midpoint = decimal.Round(
                    (RtsRpeChart.PercentOfOneRepMax(reps, rpe + 0.5m) + RtsRpeChart.PercentOfOneRepMax(reps, rpe - 0.5m)) / 2m,
                    1,
                    MidpointRounding.AwayFromZero);
                Assert.AreEqual(midpoint, RtsRpeChart.PercentOfOneRepMax(reps, rpe), $"RPE {rpe} x {reps}");
            }
        }
    }

    [TestMethod]
    public void TheChartAgreesWithThePeerReviewedHelmsTableWhereTheyOverlap()
    {
        var differences = new List<decimal>();
        for (var row = 0; row < HelmsTable2.Length; row++)
        {
            for (var reps = 1; reps <= HelmsTable2[row].Length; reps++)
            {
                differences.Add(Math.Abs(RtsRpeChart.PercentOfOneRepMax(reps, RpeRows[row]) - HelmsTable2[row][reps - 1]));
            }
        }

        Assert.HasCount(56, differences);
        Assert.IsLessThanOrEqualTo(2.2m, differences.Max());
        Assert.IsLessThan(1m, differences.Average());
    }

    [TestMethod]
    [DataRow(0, 8.0)]
    [DataRow(13, 8.0)]
    [DataRow(5, 6.0)]
    [DataRow(5, 5.5)]
    [DataRow(5, 5.0)]
    [DataRow(5, 10.5)]
    [DataRow(5, 7.25)]
    [DataRow(5, 6.75)]
    public void InputsOutsideTheChartAreRejectedAndNeverExtrapolated(int repetitions, double rpe)
    {
        var exertion = (decimal)rpe;

        Assert.IsFalse(RtsRpeChart.Covers(repetitions, exertion));
        var failure = Assert.ThrowsExactly<ArgumentOutOfRangeException>(
            () => RtsRpeChart.PercentOfOneRepMax(repetitions, exertion));
        StringAssert.Contains(failure.Message, "RPE 6.5 to 10");
        StringAssert.Contains(failure.Message, "1 to 12 repetitions");
    }

    [TestMethod]
    public void TheLoadIsTheChartPercentageOfTheWorkingMaxAndTheRoundingIsSeparate()
    {
        var strategy = new RpeChartLoadStrategy();
        var recommendation = strategy.Recommend(new LoadRecommendationInput(
            PrescriptionLoadStrategy.RpeChart, null, null, 140m, 5, 7m, LoadUnit.Kilogram));
        var policy = new LoadRoundingPolicy(LoadUnit.Kilogram, 2.5m, LoadRoundingMode.Nearest);
        var rounded = policy.Round(recommendation.Value);

        Assert.AreEqual(110.04m, recommendation.Value);
        Assert.AreEqual(110m, rounded);
        Assert.AreEqual("RpeChart", recommendation.StrategyKey);
        Assert.AreEqual("1.0", recommendation.StrategyVersion);
        Assert.AreEqual(
            "RTS RPE chart v1: 5 reps at RPE 7 is 78.6% of 140 kg = 110.04 kg.",
            recommendation.Explanation);
        Assert.AreEqual("Rounded to the nearest 2.5 kg: 110 kg.", policy.Describe(rounded));
    }

    [TestMethod]
    public void PoundsStayPoundsAndEveryRoundingModeIsDescribedInPlainWords()
    {
        var recommendation = new RpeChartLoadStrategy().Recommend(new LoadRecommendationInput(
            PrescriptionLoadStrategy.RpeChart, null, null, 315m, 3, 8m, LoadUnit.Pound));

        Assert.AreEqual(271.845m, recommendation.Value);
        Assert.AreEqual(LoadUnit.Pound, recommendation.Unit);
        Assert.AreEqual(
            "RTS RPE chart v1: 3 reps at RPE 8 is 86.3% of 315 lb = 271.845 lb.",
            recommendation.Explanation);
        Assert.AreEqual(270m, new LoadRoundingPolicy(LoadUnit.Pound, 5m, LoadRoundingMode.Nearest).Round(recommendation.Value));
        Assert.AreEqual(270m, new LoadRoundingPolicy(LoadUnit.Pound, 5m, LoadRoundingMode.Down).Round(recommendation.Value));
        Assert.AreEqual(275m, new LoadRoundingPolicy(LoadUnit.Pound, 5m, LoadRoundingMode.Up).Round(recommendation.Value));
        Assert.AreEqual(
            "Rounded down to a multiple of 5 lb: 270 lb.",
            new LoadRoundingPolicy(LoadUnit.Pound, 5m, LoadRoundingMode.Down).Describe(270m));
        Assert.AreEqual(
            "Rounded up to a multiple of 5 lb: 275 lb.",
            new LoadRoundingPolicy(LoadUnit.Pound, 5m, LoadRoundingMode.Up).Describe(275m));
    }

    [TestMethod]
    public void TheStrategyRejectsAnythingItCannotCalculate()
    {
        var strategy = new RpeChartLoadStrategy();
        LoadRecommendationInput Input(PrescriptionLoadStrategy kind, decimal? max, int? reps, decimal? rpe) =>
            new(kind, null, null, max, reps, rpe, LoadUnit.Kilogram);

        Assert.ThrowsExactly<ArgumentException>(() => strategy.Recommend(
            Input(PrescriptionLoadStrategy.RpeBasedEpley, 100m, 5, 8m)));
        Assert.ThrowsExactly<ArgumentException>(() => strategy.Recommend(
            Input(PrescriptionLoadStrategy.RpeChart, null, 5, 8m)));
        Assert.ThrowsExactly<ArgumentException>(() => strategy.Recommend(
            Input(PrescriptionLoadStrategy.RpeChart, 0m, 5, 8m)));
        Assert.ThrowsExactly<ArgumentException>(() => strategy.Recommend(
            Input(PrescriptionLoadStrategy.RpeChart, 100m, null, 8m)));
        Assert.ThrowsExactly<ArgumentException>(() => strategy.Recommend(
            Input(PrescriptionLoadStrategy.RpeChart, 100m, 5, null)));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => strategy.Recommend(
            Input(PrescriptionLoadStrategy.RpeChart, 100m, 5, 6m)));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => strategy.Recommend(
            Input(PrescriptionLoadStrategy.RpeChart, 100m, 13, 8m)));
    }

    [TestMethod]
    public void EveryCalculatedLoadExplainsItselfWithItsNumbers()
    {
        var workingMax = new StrengthLoadRecommendationStrategy();
        var percentage = workingMax.Recommend(new LoadRecommendationInput(
            PrescriptionLoadStrategy.PercentageWorkingMax, null, 75m, 140m, null, null, LoadUnit.Kilogram));
        var rpe = workingMax.Recommend(new LoadRecommendationInput(
            PrescriptionLoadStrategy.RpeBasedEpley, null, null, 100m, 5, 8m, LoadUnit.Kilogram));

        Assert.AreEqual(105m, percentage.Value);
        Assert.AreEqual("75% of the training max 140 kg = 105 kg.", percentage.Explanation);
        Assert.AreEqual(81.081m, rpe.Value);
        StringAssert.StartsWith(rpe.Explanation, "WorkingMaxLoad v2: 100 kg / (1 + (5 reps + 2 in reserve) / 30) = 81.081 kg.");
        StringAssert.Contains(rpe.Explanation, "does not estimate or imply a true 1RM");
    }
}
