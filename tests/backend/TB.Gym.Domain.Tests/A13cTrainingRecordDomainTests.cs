using TB.Gym.Modules.Training;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// Audit batch A13c (BEB-2): Coach Today asks the database for each workout's best earlier loads instead of
/// reading every earlier set. The record rule answers the same from those bests as from the sets themselves.
/// </summary>
[TestClass]
public sealed class A13cTrainingRecordDomainTests
{
    private static readonly Guid SquatId = Guid.Parse("30000000-0000-0000-0000-0000000013c1");
    private static readonly Guid BenchId = Guid.Parse("30000000-0000-0000-0000-0000000013c2");
    private static readonly Guid RowId = Guid.Parse("30000000-0000-0000-0000-0000000013c3");

    [TestMethod]
    public void TheBestEarlierLoadsGiveTheRecordsTheEarlierSetsGive()
    {
        PerformedSet[] earlier =
        [
            Set(SquatId, 5, 80m, TrainingLoadUnit.Kilogram),
            Set(SquatId, 5, 85m, TrainingLoadUnit.Kilogram),
            Set(SquatId, 3, 95m, TrainingLoadUnit.Kilogram),
            Set(SquatId, 5, 150m, TrainingLoadUnit.Pound),
            Set(BenchId, 8, 60m, TrainingLoadUnit.Kilogram),
            // Not done, or missing a number: never a best.
            Set(BenchId, 8, 100m, TrainingLoadUnit.Kilogram, isCompleted: false),
            new(Guid.NewGuid(), BenchId, null, 100m, TrainingLoadUnit.Kilogram, true),
            new(Guid.NewGuid(), BenchId, 8, null, TrainingLoadUnit.Kilogram, true),
            new(Guid.NewGuid(), BenchId, 8, 100m, null, true),
        ];
        var tie = Set(SquatId, 5, 85m, TrainingLoadUnit.Kilogram);
        var heavier = Set(SquatId, 5, 87.5m, TrainingLoadUnit.Kilogram);
        var sameAgain = Set(SquatId, 5, 87.5m, TrainingLoadUnit.Kilogram);
        var heavierStill = Set(SquatId, 5, 90m, TrainingLoadUnit.Kilogram);
        var lighterTriple = Set(SquatId, 3, 92.5m, TrainingLoadUnit.Kilogram);
        // 152.5 lb is far less than 87.5 kg, yet a record in pounds: the units are never compared.
        var pounds = Set(SquatId, 5, 152.5m, TrainingLoadUnit.Pound);
        var notDone = Set(BenchId, 8, 70m, TrainingLoadUnit.Kilogram, isCompleted: false);
        var bench = Set(BenchId, 8, 62.5m, TrainingLoadUnit.Kilogram);
        var firstRow = Set(RowId, 10, 40m, TrainingLoadUnit.Kilogram);
        var emptyRow = Set(RowId, 12, 0m, TrainingLoadUnit.Kilogram);
        PerformedSet[] workout = [tie, heavier, sameAgain, heavierStill, lighterTriple, pounds, notDone, bench, firstRow, emptyRow];

        var fromSets = WorkoutPersonalRecordRule.RecordSetIds(workout, earlier);
        var bests = WorkoutPersonalRecordRule.BestLoads(earlier);
        var fromBests = WorkoutPersonalRecordRule.RecordSetIds(workout, bests);

        CollectionAssert.AreEqual(
            new[] { heavier.SetId, heavierStill.SetId, pounds.SetId, bench.SetId, firstRow.SetId },
            fromSets.ToArray(),
            "A tie, a set level with one before it in the workout, a lighter set, a set not done and no weight are not records.");
        CollectionAssert.AreEqual(fromSets.ToArray(), fromBests.ToArray());

        // The bests themselves: one per lift, rep count and unit, the heaviest completed load.
        Assert.HasCount(4, bests);
        Assert.AreEqual(85m, bests[new PersonalRecordKey(SquatId, 5, TrainingLoadUnit.Kilogram)]);
        Assert.AreEqual(95m, bests[new PersonalRecordKey(SquatId, 3, TrainingLoadUnit.Kilogram)]);
        Assert.AreEqual(150m, bests[new PersonalRecordKey(SquatId, 5, TrainingLoadUnit.Pound)]);
        Assert.AreEqual(60m, bests[new PersonalRecordKey(BenchId, 8, TrainingLoadUnit.Kilogram)]);
    }

    [TestMethod]
    public void WithNoEarlierBestEachKeysFirstWeightedSetIsARecordAndTheBestsAreNotChanged()
    {
        var first = Set(SquatId, 5, 60m, TrainingLoadUnit.Kilogram);
        var second = Set(SquatId, 5, 60m, TrainingLoadUnit.Kilogram);
        var bests = new Dictionary<PersonalRecordKey, decimal>();

        CollectionAssert.AreEqual(
            new[] { first.SetId },
            WorkoutPersonalRecordRule.RecordSetIds([first, second], bests).ToArray());
        Assert.IsEmpty(bests, "Reading a workout never changes the bests it was given.");
    }

    private static PerformedSet Set(
        Guid exerciseId,
        int repetitions,
        decimal load,
        TrainingLoadUnit unit,
        bool isCompleted = true) =>
        new(Guid.NewGuid(), exerciseId, repetitions, load, unit, isCompleted);
}
