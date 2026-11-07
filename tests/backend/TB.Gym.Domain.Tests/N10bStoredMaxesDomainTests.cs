using TB.Gym.Modules.Strength;
using StrengthLoadUnit = TB.Gym.Modules.Strength.LoadUnit;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// What P4b and P4c leave in the Strength domain once the notes plan's N10b removed BestLoggedSet v1 and the keep
/// (decision 19's note, 7 Nov 2026): a keep recorded before stays, append-only, and still says which max, which set
/// and what that set suggested (STR-013); a max worked out from week 1's weight never names a logged set (STR-011).
/// Nothing makes a max from a logged set now; N10bNoSuggestedMaxesTests reads one stored by SQL.
/// </summary>
[TestClass]
public sealed class N10bStoredMaxesDomainTests
{
    private static readonly Guid TenantId = Guid.Parse("10000000-0000-0000-0000-000000000041");
    private static readonly Guid MesocycleId = Guid.Parse("40000000-0000-0000-0000-000000000041");
    private static readonly Guid ClientId = Guid.Parse("20000000-0000-0000-0000-000000000041");
    private static readonly Guid SquatId = Guid.Parse("30000000-0000-0000-0000-000000000041");

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
