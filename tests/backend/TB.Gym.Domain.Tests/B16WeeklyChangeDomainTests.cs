using TB.Gym.Modules.Progress;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// The change beside the weight on Progress (critique B16, PRG-005), whose fixed reference numbers pin
/// <see cref="BodyweightWeeklyChange"/> version 1.0: the latest weekly mean in a range minus the mean of
/// the week holding its first weigh-in, each week taken whole.
/// </summary>
[TestClass]
public sealed class B16WeeklyChangeDomainTests
{
    private static readonly DateOnly From = new(2026, 8, 9);
    private static readonly DateOnly ToExclusive = new(2026, 11, 1);

    [TestMethod]
    public void B16TheChangeIsTheLatestWeeklyMeanMinusTheMeanOfTheWeekHoldingTheFirstWeighIn()
    {
        // Thu 27 Aug starts a Monday week of two weigh-ins, and the week from Mon 26 Oct has two. The days
        // between them, and each week's own highs and lows, say nothing.
        var result = BodyweightWeeklyChange.Calculate(
            [
                Sample(2026, 8, 27, 68.4m),
                Sample(2026, 8, 29, 68.0m),
                Sample(2026, 9, 20, 60.0m),
                Sample(2026, 10, 26, 64.6m),
                Sample(2026, 10, 28, 64.4m),
            ],
            From,
            ToExclusive,
            DayOfWeek.Monday)!;

        Assert.AreEqual(new DateOnly(2026, 8, 27), result.FromDate);
        Assert.AreEqual(new BodyweightWeekMean(new DateOnly(2026, 8, 24), 68.2m, 2), result.FirstWeek);
        Assert.AreEqual(new BodyweightWeekMean(new DateOnly(2026, 10, 26), 64.5m, 2), result.LatestWeek);
        Assert.AreEqual(-3.7m, result.DeltaKilograms);
    }

    [TestMethod]
    public void B16EachMeanIsRoundedToThreeDecimalsAsEveryWeeklyMeanIs()
    {
        var result = BodyweightWeeklyChange.Calculate(
            [
                Sample(2026, 10, 5, 80.0m),
                Sample(2026, 10, 6, 80.1m),
                Sample(2026, 10, 7, 80.1m),
                Sample(2026, 10, 19, 79.0m),
                Sample(2026, 10, 20, 79.05m),
            ],
            From,
            ToExclusive,
            DayOfWeek.Monday)!;

        Assert.AreEqual(80.067m, result.FirstWeek.MeanKilograms);
        Assert.AreEqual(79.025m, result.LatestWeek.MeanKilograms);
        Assert.AreEqual(-1.042m, result.DeltaKilograms);
    }

    [TestMethod]
    public void B16ARangeOpeningInTheMiddleOfAWeekStillComparesThatWholeWeekNeverASingleDay()
    {
        // The range opens on Sun 4 Oct, the last day of a Monday week: that week's mean has all three days,
        // though the label names the one the range holds.
        var result = BodyweightWeeklyChange.Calculate(
            [
                Sample(2026, 9, 28, 70m),
                Sample(2026, 9, 30, 71m),
                Sample(2026, 10, 4, 72m),
                Sample(2026, 10, 21, 70.5m),
            ],
            new DateOnly(2026, 10, 4),
            ToExclusive,
            DayOfWeek.Monday)!;

        Assert.AreEqual(new DateOnly(2026, 10, 4), result.FromDate);
        Assert.AreEqual(new BodyweightWeekMean(new DateOnly(2026, 9, 28), 71m, 3), result.FirstWeek);
        Assert.AreEqual(-0.5m, result.DeltaKilograms);
    }

    [TestMethod]
    public void B16TheLatestWeekIsTakenWholeToo()
    {
        var result = BodyweightWeeklyChange.Calculate(
            [Sample(2026, 10, 5, 72m), Sample(2026, 10, 19, 70m), Sample(2026, 10, 21, 71m)],
            From,
            new DateOnly(2026, 10, 20),
            DayOfWeek.Monday)!;

        Assert.AreEqual(new BodyweightWeekMean(new DateOnly(2026, 10, 19), 70.5m, 2), result.LatestWeek);
    }

    [TestMethod]
    public void B16TheRangeNamesTheTwoWeeks()
    {
        // Weigh-ins either side of it are neither the first nor the latest, and read weeks they do not
        // fall in stay out of both means.
        var result = BodyweightWeeklyChange.Calculate(
            [
                Sample(2026, 9, 1, 80m),
                Sample(2026, 9, 15, 78m),
                Sample(2026, 9, 22, 77m),
                Sample(2026, 10, 6, 75m),
            ],
            new DateOnly(2026, 9, 10),
            new DateOnly(2026, 9, 30),
            DayOfWeek.Monday)!;

        Assert.AreEqual(new DateOnly(2026, 9, 15), result.FromDate);
        Assert.AreEqual(new DateOnly(2026, 9, 14), result.FirstWeek.WeekStart);
        Assert.AreEqual(new DateOnly(2026, 9, 21), result.LatestWeek.WeekStart);
        Assert.AreEqual(-1m, result.DeltaKilograms);
    }

    [TestMethod]
    public void B16TheFirstWeekFollowsTheWorkspaceWeek()
    {
        // As since start's: Sun 4 Oct sits in a Monday week with Fri 2, in a Sunday week with Mon 5.
        BodyweightTrendSample[] samples =
        [
            Sample(2026, 10, 2, 70m),
            Sample(2026, 10, 4, 72m),
            Sample(2026, 10, 5, 74m),
            Sample(2026, 10, 21, 71m),
        ];
        var from = new DateOnly(2026, 10, 4);

        var monday = BodyweightWeeklyChange.Calculate(samples, from, ToExclusive, DayOfWeek.Monday)!;
        Assert.AreEqual(new BodyweightWeekMean(new DateOnly(2026, 9, 28), 71m, 2), monday.FirstWeek);
        Assert.AreEqual(0m, monday.DeltaKilograms);

        var sunday = BodyweightWeeklyChange.Calculate(samples, from, ToExclusive, DayOfWeek.Sunday)!;
        Assert.AreEqual(new BodyweightWeekMean(new DateOnly(2026, 10, 4), 73m, 2), sunday.FirstWeek);
        Assert.AreEqual(-2m, sunday.DeltaKilograms);
    }

    [TestMethod]
    public void B16TheFigureIsSinceStartsWhenTheChartBeginsAtTheStart()
    {
        BodyweightTrendSample[] samples =
        [
            Sample(2026, 8, 27, 68.4m),
            Sample(2026, 8, 28, 68.3m),
            Sample(2026, 8, 30, 68.2m),
            Sample(2026, 10, 26, 64.6m),
            Sample(2026, 10, 29, 64.3m),
        ];
        var start = new DateOnly(2026, 8, 27);
        var sinceStart = BodyweightSinceStart.Calculate(start, samples, samples, DayOfWeek.Monday)!;

        var fromTheStart = BodyweightWeeklyChange.Calculate(samples, start, ToExclusive, DayOfWeek.Monday)!;
        Assert.AreEqual(sinceStart.DeltaKilograms, fromTheStart.DeltaKilograms);
        Assert.AreEqual(sinceStart.StartWeek, fromTheStart.FirstWeek);
        Assert.AreEqual(sinceStart.LatestWeek, fromTheStart.LatestWeek);

        // A chart opening a little later in that same week still compares it, so the two still agree.
        var later = BodyweightWeeklyChange.Calculate(samples, new DateOnly(2026, 8, 30), ToExclusive, DayOfWeek.Monday)!;
        Assert.AreEqual(sinceStart.DeltaKilograms, later.DeltaKilograms);
        Assert.AreEqual(new DateOnly(2026, 8, 30), later.FromDate);
    }

    [TestMethod]
    public void B16ThereIsNoChangeWhileThereIsNothingToCompare()
    {
        Assert.IsNull(BodyweightWeeklyChange.Calculate([], From, ToExclusive, DayOfWeek.Monday));
        // Two weigh-ins of one week are no weekly comparison, whatever they differ by.
        Assert.IsNull(BodyweightWeeklyChange.Calculate(
            [Sample(2026, 10, 26, 65m), Sample(2026, 10, 29, 64m)], From, ToExclusive, DayOfWeek.Monday));
        // A Sunday and the next Monday are two weeks only where the workspace's week turns between them.
        Assert.IsNotNull(BodyweightWeeklyChange.Calculate(
            [Sample(2026, 10, 25, 65m), Sample(2026, 10, 26, 64m)], From, ToExclusive, DayOfWeek.Monday));
        Assert.IsNull(BodyweightWeeklyChange.Calculate(
            [Sample(2026, 10, 25, 65m), Sample(2026, 10, 26, 64m)], From, ToExclusive, DayOfWeek.Sunday));
        // Read for the trend's warm-up, but outside the range.
        Assert.IsNull(BodyweightWeeklyChange.Calculate(
            [Sample(2026, 6, 1, 70m), Sample(2026, 6, 15, 69m)], From, ToExclusive, DayOfWeek.Monday));
    }

    private static BodyweightTrendSample Sample(int year, int month, int day, decimal kilograms) =>
        new(new DateOnly(year, month, day), kilograms);
}
