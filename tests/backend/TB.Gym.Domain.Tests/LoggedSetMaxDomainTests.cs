using TB.Gym.Modules.Strength;
using StrengthLoadUnit = TB.Gym.Modules.Strength.LoadUnit;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// P4b, adjusting from logged performance (ADR 0036, STR-007): which logged sets count, the max a set
/// implies, the best set of the latest week, the one-rounding-step threshold, and the max kept with the
/// set it was estimated from. BestLoggedSet v1; any change to these answers is a new version.
/// </summary>
[TestClass]
public sealed class LoggedSetMaxDomainTests
{
    private static readonly Guid TenantId = Guid.Parse("10000000-0000-0000-0000-000000000041");
    private static readonly Guid MesocycleId = Guid.Parse("40000000-0000-0000-0000-000000000041");
    private static readonly Guid ClientId = Guid.Parse("20000000-0000-0000-0000-000000000041");
    private static readonly Guid SquatId = Guid.Parse("30000000-0000-0000-0000-000000000041");
    private static readonly DateTimeOffset MaxSetAt = new(2026, 10, 5, 8, 0, 0, TimeSpan.Zero);

    private static int setNumber;

    private static LoggedSetEvidence Set(
        int week,
        int? reps,
        decimal? load,
        decimal? rpe,
        int hoursAfterMax = 24,
        bool warmUp = false,
        bool completed = true,
        StrengthLoadUnit? unit = StrengthLoadUnit.Kilogram,
        Guid? id = null)
    {
        var loggedAt = MaxSetAt.AddHours(hoursAfterMax);
        return new LoggedSetEvidence(
            id ?? Guid.Parse($"50000000-0000-0000-0000-{Interlocked.Increment(ref setNumber):000000000000}"),
            week,
            DateOnly.FromDateTime(loggedAt.UtcDateTime),
            loggedAt,
            $"Week {week} lower",
            warmUp,
            completed,
            reps,
            load,
            unit,
            rpe);
    }

    private static bool Counts(LoggedSetEvidence set) =>
        BestLoggedSetRule.Counts(set, StrengthLoadUnit.Kilogram, MaxSetAt);

    // ----- which sets count -----

    [TestMethod]
    public void AFinishedWorkingSetOfOneToEightRepsAtRpeSevenToTenCounts()
    {
        Assert.IsTrue(Counts(Set(1, 1, 140m, 10m)));
        Assert.IsTrue(Counts(Set(1, 8, 100m, 7m)));
        Assert.IsTrue(Counts(Set(1, 5, 100m, 8.5m)));

        // Where the chart and Helms et al. agree, and where reps in reserve are judged best: no further.
        Assert.IsFalse(Counts(Set(1, 9, 100m, 8m)), "nine reps");
        Assert.IsFalse(Counts(Set(1, 0, 100m, 8m)), "no reps");
        Assert.IsFalse(Counts(Set(1, 5, 100m, 6.5m)), "RPE 6.5");
        Assert.IsFalse(Counts(Set(1, null, 100m, 8m)), "reps not logged");
        Assert.IsFalse(Counts(Set(1, 5, 100m, null)), "a set without an RPE is never evidence");
    }

    [TestMethod]
    public void WarmUpsUnfinishedSetsAndSetsWithoutAWeightNeverCount()
    {
        Assert.IsFalse(Counts(Set(1, 5, 100m, 8m, warmUp: true)));
        Assert.IsFalse(Counts(Set(1, 5, 100m, 8m, completed: false)));
        Assert.IsFalse(Counts(Set(1, 5, null, 8m)));
        Assert.IsFalse(Counts(Set(1, 5, 0m, 8m)));
    }

    [TestMethod]
    public void KilogramsAndPoundsAreKeptApart()
    {
        // A set logged in pounds says nothing about a program in kilograms, and nothing is converted.
        var pounds = Set(1, 5, 225m, 8m, unit: StrengthLoadUnit.Pound);

        Assert.IsFalse(BestLoggedSetRule.Counts(pounds, StrengthLoadUnit.Kilogram, MaxSetAt));
        Assert.IsTrue(BestLoggedSetRule.Counts(pounds, StrengthLoadUnit.Pound, MaxSetAt));
        Assert.IsFalse(Counts(Set(1, 5, 100m, 8m, unit: null)));
        Assert.IsNull(BestLoggedSetRule.Best([pounds], StrengthLoadUnit.Kilogram, MaxSetAt));
    }

    [TestMethod]
    public void OnlySetsLoggedAfterTheMaxInUseWasSetCount()
    {
        // The coach set the max knowing what came before; only what came after can argue with it.
        Assert.IsFalse(Counts(Set(1, 5, 100m, 8m, hoursAfterMax: -1)));
        Assert.IsFalse(Counts(Set(1, 5, 100m, 8m, hoursAfterMax: 0)));
        Assert.IsTrue(Counts(Set(1, 5, 100m, 8m, hoursAfterMax: 1)));
    }

    [TestMethod]
    public void ASetImplyingAMaxAboveTheLimitDoesNotCount()
    {
        // 1,500 kg for 8 reps at RPE 7 is 70.7% of a max of 2,121.6 kg: over the 2,000 every max keeps to.
        Assert.IsFalse(Counts(Set(1, 8, 1_500m, 7m)));
        Assert.IsTrue(Counts(Set(1, 8, 1_400m, 7m)));
    }

    // ----- the max a set implies -----

    [TestMethod]
    public void TheMaxASetImpliesIsItsWeightDividedByTheChartsPercentage()
    {
        // Fixed reference values: RTS chart v1, three decimals, rounded half away from zero.
        var cases = new (int Reps, decimal Load, decimal Rpe, decimal Percent, decimal Max)[]
        {
            (5, 55m, 8m, 81.1m, 67.818m),
            (3, 100m, 9m, 89.2m, 112.108m),
            (1, 140m, 10m, 100m, 140m),
            (8, 120m, 7m, 70.7m, 169.731m),
            (2, 150m, 9.5m, 93.9m, 159.744m),
        };
        foreach (var (reps, load, rpe, percent, max) in cases)
        {
            var estimate = BestLoggedSetRule.Estimate(Set(1, reps, load, rpe), StrengthLoadUnit.Kilogram, MaxSetAt);

            Assert.AreEqual((percent, max), (estimate.Percent, estimate.Value), $"{load} kg x {reps} at RPE {rpe}");
            Assert.AreEqual(("RpeChart", "1.0", StrengthLoadUnit.Kilogram), (estimate.StrategyKey, estimate.Version, estimate.Unit));
        }

        Assert.AreEqual(
            "RTS RPE chart v1: 5 reps at RPE 8 is 81.1% of the max, so 55 kg / 81.1% = 67.818 kg.",
            BestLoggedSetRule.Estimate(Set(1, 5, 55m, 8m), StrengthLoadUnit.Kilogram, MaxSetAt).Explanation);
    }

    [TestMethod]
    public void ASetThatDoesNotCountGetsNoEstimate()
    {
        Assert.ThrowsExactly<ArgumentException>(
            () => BestLoggedSetRule.Estimate(Set(1, 10, 100m, 8m), StrengthLoadUnit.Kilogram, MaxSetAt));
        Assert.ThrowsExactly<ArgumentException>(
            () => BestLoggedSetRule.Estimate(Set(1, 5, 100m, 8m, warmUp: true), StrengthLoadUnit.Kilogram, MaxSetAt));
    }

    // ----- which set speaks -----

    [TestMethod]
    public void TheBestSetOfTheLatestWeekSpeaksNotAnAverageAndNotAnEarlierWeek()
    {
        var top = Set(3, 3, 120m, 8m, hoursAfterMax: 300);
        var sets = new[]
        {
            // Week 2 implied more, but week 3 is the newer evidence.
            Set(2, 1, 150m, 9m, hoursAfterMax: 150),
            top,
            // Back-off sets after the top set, tired by it: they read lower and never pull the answer down.
            Set(3, 5, 100m, 8m, hoursAfterMax: 301),
            Set(3, 5, 100m, 8.5m, hoursAfterMax: 302),
            Set(3, 5, 60m, 5m, hoursAfterMax: 299, warmUp: true),
        };

        var best = BestLoggedSetRule.Best(sets, StrengthLoadUnit.Kilogram, MaxSetAt);

        Assert.IsNotNull(best);
        Assert.AreEqual(top.SetId, best.Set.SetId);
        // 120 kg for 3 at RPE 8 is 86.3% of the max.
        Assert.AreEqual(139.050m, best.Estimate.Value);
    }

    [TestMethod]
    public void AWeekWithNoSetThatCountsLeavesTheWeekBeforeToSpeak()
    {
        var weekThree = Set(3, 3, 120m, 8m, hoursAfterMax: 300);
        var sets = new[]
        {
            weekThree,
            // A deload week at RPE 6 says nothing about the max.
            Set(4, 5, 80m, 6m, hoursAfterMax: 470),
            Set(4, 10, 70m, 7m, hoursAfterMax: 471),
        };

        Assert.AreEqual(weekThree.SetId, BestLoggedSetRule.Best(sets, StrengthLoadUnit.Kilogram, MaxSetAt)!.Set.SetId);
        Assert.IsNull(BestLoggedSetRule.Best([], StrengthLoadUnit.Kilogram, MaxSetAt));
        Assert.IsNull(BestLoggedSetRule.Best(
            [Set(3, 3, 120m, 8m, hoursAfterMax: -5)],
            StrengthLoadUnit.Kilogram,
            MaxSetAt));
    }

    [TestMethod]
    public void ATieGoesToTheLaterSetWhateverOrderTheSetsAreReadIn()
    {
        // 100 kg for 5 at RPE 8 and 100 kg for 5 at RPE 8 two days apart imply the same max.
        var earlier = Set(2, 5, 100m, 8m, hoursAfterMax: 100);
        var later = Set(2, 5, 100m, 8m, hoursAfterMax: 148);

        Assert.AreEqual(later.SetId, BestLoggedSetRule.Best([earlier, later], StrengthLoadUnit.Kilogram, MaxSetAt)!.Set.SetId);
        Assert.AreEqual(later.SetId, BestLoggedSetRule.Best([later, earlier], StrengthLoadUnit.Kilogram, MaxSetAt)!.Set.SetId);
    }

    // ----- when it is worth saying -----

    [TestMethod]
    public void ASuggestionMovesTheMaxByMoreThanOneRoundingStepEitherWay()
    {
        Assert.IsFalse(BestLoggedSetRule.IsWorthSuggesting(100m, 102.5m, 2.5m));
        Assert.IsTrue(BestLoggedSetRule.IsWorthSuggesting(100m, 102.501m, 2.5m));
        Assert.IsFalse(BestLoggedSetRule.IsWorthSuggesting(100m, 97.5m, 2.5m));
        Assert.IsTrue(BestLoggedSetRule.IsWorthSuggesting(100m, 97.499m, 2.5m));
        Assert.IsTrue(BestLoggedSetRule.IsWorthSuggesting(225m, 231m, 5m));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => BestLoggedSetRule.IsWorthSuggesting(100m, 110m, 0m));
    }

    // ----- keeping a max over a suggestion (STR-013, P4c) -----

    [TestMethod]
    public void AfterAKeepOnlySetsLoggedLaterCanSuggestAgain()
    {
        var keptAt = MaxSetAt.AddDays(3);
        Assert.AreEqual(MaxSetAt, BestLoggedSetRule.CountsAfter(MaxSetAt, null));
        Assert.AreEqual(keptAt, BestLoggedSetRule.CountsAfter(MaxSetAt, keptAt));
        // A keep of an older max never reaches back past the max in use.
        Assert.AreEqual(MaxSetAt, BestLoggedSetRule.CountsAfter(MaxSetAt, MaxSetAt.AddDays(-1)));

        var weighed = Set(2, 5, 90m, 8m, hoursAfterMax: 48);
        var later = Set(3, 5, 92.5m, 8m, hoursAfterMax: 96);
        var since = BestLoggedSetRule.CountsAfter(MaxSetAt, keptAt);
        Assert.IsNull(BestLoggedSetRule.Best([weighed], StrengthLoadUnit.Kilogram, since));
        Assert.AreEqual(later.SetId, BestLoggedSetRule.Best([weighed, later], StrengthLoadUnit.Kilogram, since)?.Set.SetId);
    }

    [TestMethod]
    public void AKeepRecordsTheMaxTheSetAndWhatItSuggested()
    {
        var snapshot = Guid.Parse("60000000-0000-0000-0000-000000000042");
        var set = Guid.Parse("50000000-0000-0000-0000-000000000042");
        var keep = WorkingMaxKeep.Record(TenantId, MesocycleId, snapshot, set, 110.9744m, StrengthLoadUnit.Kilogram);

        Assert.AreEqual(
            (MesocycleId, snapshot, set, 110.974m, StrengthLoadUnit.Kilogram),
            (keep.MesocycleId, keep.WorkingMaxSnapshotId, keep.LoggedSetPerformanceId, keep.SuggestedValue, keep.Unit));
        Assert.ThrowsExactly<ArgumentException>(() => WorkingMaxKeep.Record(TenantId, MesocycleId, snapshot, Guid.Empty, 100m, StrengthLoadUnit.Kilogram));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => WorkingMaxKeep.Record(TenantId, MesocycleId, snapshot, set, 0m, StrengthLoadUnit.Kilogram));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => WorkingMaxKeep.Record(TenantId, MesocycleId, snapshot, set, 100m, (StrengthLoadUnit)9));
    }

    // ----- the max kept -----

    [TestMethod]
    public void AMaxEstimatedFromALoggedSetKeepsThatSetAndItsNumbers()
    {
        var set = Set(3, 5, 55m, 8m);
        var estimate = new LoggedSetMaxEstimate(
            set,
            BestLoggedSetRule.Estimate(set, StrengthLoadUnit.Kilogram, MaxSetAt));
        var previous = Guid.Parse("60000000-0000-0000-0000-000000000041");

        var snapshot = MesocycleWorkingMaxSnapshot.CaptureFromLoggedSet(
            TenantId, MesocycleId, ClientId, SquatId, estimate, 4, previous, "Estimated from logged sets, week 3.");

        Assert.AreEqual(WorkingMaxSource.LoggedSet, snapshot.Source);
        Assert.AreEqual((Guid?)set.SetId, snapshot.SourceSetPerformanceId);
        Assert.AreEqual((67.818m, StrengthLoadUnit.Kilogram, 4, (Guid?)previous), (snapshot.Value, snapshot.Unit, snapshot.EffectiveFromWeek, snapshot.SupersedesSnapshotId));
        Assert.AreEqual(
            ((decimal?)55m, (int?)5, (decimal?)8m, "RpeChart", "1.0"),
            (snapshot.BasisLoad, snapshot.BasisRepetitions, snapshot.BasisRpe, snapshot.EstimateMethodKey, snapshot.EstimateMethodVersion));
        Assert.IsNull(snapshot.SourceMaxRecordId);
    }

    [TestMethod]
    public void AWeekOneEstimateIsNotALoggedSetEstimate()
    {
        var weekOne = MesocycleWorkingMaxSnapshot.CaptureFromWeekOneWeight(
            TenantId,
            MesocycleId,
            ClientId,
            SquatId,
            RpeChartMaxEstimator.Estimate(100m, 5, 7m, StrengthLoadUnit.Kilogram),
            100m,
            5,
            7m,
            1,
            null,
            "Week 1.");

        Assert.AreEqual(WorkingMaxSource.WeekOneWeight, weekOne.Source);
        Assert.IsNull(weekOne.SourceSetPerformanceId);
    }
}
