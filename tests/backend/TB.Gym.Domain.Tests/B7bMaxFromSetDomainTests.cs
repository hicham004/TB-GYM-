using TB.Gym.Modules.Strength;
using StrengthLoadUnit = TB.Gym.Modules.Strength.LoadUnit;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// A max from a set they did (critique B7b, STR-017): an Estimated 1RM worked out by Epley v1 from weight × reps,
/// 1 to 10 reps, and a training max set from it by TrainingMaxShare v1, whose fixed reference numbers pin 90 % to
/// three decimals. Nothing recorded is a number someone typed as an estimate (STR-001).
/// </summary>
[TestClass]
public sealed class B7bMaxFromSetDomainTests
{
    private static readonly Guid TenantId = Guid.Parse("7b7b7b7b-0000-0000-0000-000000000001");
    private static readonly Guid ClientId = Guid.Parse("7b7b7b7b-0000-0000-0000-000000000002");
    private static readonly Guid SquatId = Guid.Parse("7b7b7b7b-0000-0000-0000-000000000003");
    private static readonly DateOnly SetDay = new(2026, 10, 27);

    private static StrengthMaxRecord Estimate(decimal load, int repetitions, StrengthLoadUnit unit = StrengthLoadUnit.Kilogram) =>
        StrengthMaxRecord.EstimateFromSet(TenantId, ClientId, SquatId, load, repetitions, unit, SetDay, "Belt, after the deload.");

    [TestMethod]
    public void B7bAnEstimateFromASetIsEpleyV1AndKeepsTheSetItCameFrom()
    {
        var estimate = Estimate(100m, 5);

        Assert.AreEqual(116.667m, estimate.Value);
        Assert.AreEqual(StrengthMaxKind.EstimatedOneRepMax, estimate.Kind);
        Assert.AreEqual(StrengthMaxSource.Calculation, estimate.Source);
        Assert.AreEqual(("Epley", "1.0"), (estimate.MethodKey, estimate.MethodVersion));
        Assert.AreEqual((100m, 5), (estimate.BasisLoad, estimate.BasisRepetitions));
        Assert.AreEqual((ClientId, SquatId, StrengthLoadUnit.Kilogram, SetDay), (estimate.ClientProfileId, estimate.ExerciseId, estimate.Unit, estimate.EffectiveDate));
        Assert.AreEqual("Belt, after the deload.", estimate.Note);
        Assert.IsNull(estimate.SourceEstimateId);
        Assert.IsNull(estimate.EstimateValue);
        Assert.IsNull(estimate.SharePercent);
    }

    [TestMethod]
    public void B7bASingleIsTheMaxItselfAndTenRepsIsTheLastTheProductTakes()
    {
        Assert.AreEqual(120m, Estimate(120m, 1).Value);
        Assert.AreEqual(106.667m, Estimate(80m, 10).Value);
        Assert.AreEqual(221m, Estimate(195m, 4, StrengthLoadUnit.Pound).Value);
        Assert.AreEqual(StrengthLoadUnit.Pound, Estimate(195m, 4, StrengthLoadUnit.Pound).Unit);

        // Epley v1 reads 12 reps (STR-005); past 10 an estimate from reps is too rough, so the product stops there.
        var eleven = Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => Estimate(80m, 11));
        Assert.AreEqual("repetitions", eleven.ParamName);
        StringAssert.Contains(eleven.Message, "1 to 10 reps");
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => Estimate(80m, 0));
    }

    [TestMethod]
    public void B7bAWeightOutsideTheRangeOrAnEstimatePastTwoThousandIsRefusedInWords()
    {
        Assert.AreEqual("load", Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => Estimate(0m, 5)).ParamName);
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => Estimate(2_000.001m, 1));
        Assert.AreEqual(2_000m, Estimate(2_000m, 1).Value);

        // 1,600 kg × 10 is 2,133.333 kg by Epley: more than a max can be, so nothing is recorded.
        var past = Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => Estimate(1_600m, 10));
        StringAssert.Contains(past.Message, "more than 2,000");
    }

    [TestMethod]
    public void B7bTrainingMaxShareV1IsNinetyPercentToThreeDecimals()
    {
        Assert.AreEqual(("TrainingMaxShare", "1.0", 90m), (TrainingMaxShare.Key, TrainingMaxShare.CurrentVersion, TrainingMaxShare.Percent));
        Assert.AreEqual(105m, TrainingMaxShare.Apply(116.667m));
        Assert.AreEqual(90m, TrainingMaxShare.Apply(100m));
        Assert.AreEqual(96m, TrainingMaxShare.Apply(106.667m));
        Assert.AreEqual(70m, TrainingMaxShare.Apply(77.778m));
        Assert.AreEqual(1_800m, TrainingMaxShare.Apply(2_000m));
        // 0.0045 is half way: it rounds away from zero, as PostgreSQL's round does for the database's check.
        Assert.AreEqual(0.005m, TrainingMaxShare.Apply(0.005m));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => TrainingMaxShare.Apply(0m));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => TrainingMaxShare.Apply(2_000.001m));
        Assert.AreEqual("TrainingMaxShare v1: 90% of 116.667 kg = 105 kg.", TrainingMaxShare.Explain(116.667m, StrengthLoadUnit.Kilogram));
        Assert.AreEqual("TrainingMaxShare v1: 90% of 225 lb = 202.5 lb.", TrainingMaxShare.Explain(225m, StrengthLoadUnit.Pound));
    }

    [TestMethod]
    public void B7bATrainingMaxFromAnEstimateNamesItAndKeepsItsNumbers()
    {
        var estimate = Estimate(100m, 5);
        var trainingMax = StrengthMaxRecord.TrainingMaxFromEstimate(estimate);

        Assert.AreEqual(105m, trainingMax.Value);
        Assert.AreEqual(StrengthMaxKind.CoachWorkingMax, trainingMax.Kind);
        Assert.AreEqual(StrengthMaxSource.Calculation, trainingMax.Source);
        Assert.AreEqual(("TrainingMaxShare", "1.0"), (trainingMax.MethodKey, trainingMax.MethodVersion));
        Assert.AreEqual((estimate.Id, 116.667m, 90m), (trainingMax.SourceEstimateId, trainingMax.EstimateValue, trainingMax.SharePercent));
        Assert.AreEqual(
            (TenantId, ClientId, SquatId, StrengthLoadUnit.Kilogram, SetDay),
            (trainingMax.TenantId, trainingMax.ClientProfileId, trainingMax.ExerciseId, trainingMax.Unit, trainingMax.EffectiveDate));
        Assert.IsNull(trainingMax.BasisLoad);
        Assert.IsNull(trainingMax.BasisRepetitions);
        Assert.IsNull(trainingMax.Note);
        Assert.AreNotEqual(estimate.Id, trainingMax.Id);
    }

    [TestMethod]
    public void B7bOnlyAnEstimateWorkedOutFromASetMakesATrainingMax()
    {
        var typed = StrengthMaxRecord.Create(
            TenantId, ClientId, SquatId, StrengthMaxKind.TestedOneRepMax, 120m, StrengthLoadUnit.Kilogram, SetDay,
            StrengthMaxSource.Manual, "TestedLift", "1.0", null, null);

        Assert.ThrowsExactly<ArgumentException>(() => StrengthMaxRecord.TrainingMaxFromEstimate(typed));
        Assert.ThrowsExactly<ArgumentException>(() =>
            StrengthMaxRecord.TrainingMaxFromEstimate(StrengthMaxRecord.TrainingMaxFromEstimate(Estimate(100m, 5))));
    }

    [TestMethod]
    public void B7bAMaxTypedByHandIsNeverAnEstimateNorCalledACalculation()
    {
        var estimate = Assert.ThrowsExactly<ArgumentException>(() => StrengthMaxRecord.Create(
            TenantId, ClientId, SquatId, StrengthMaxKind.EstimatedOneRepMax, 116.667m, StrengthLoadUnit.Kilogram, SetDay,
            StrengthMaxSource.WorkoutSet, "Epley", "1.0", null, null));
        StringAssert.Contains(estimate.Message, "never typed");
        var calculated = Assert.ThrowsExactly<ArgumentException>(() => StrengthMaxRecord.Create(
            TenantId, ClientId, SquatId, StrengthMaxKind.CoachWorkingMax, 105m, StrengthLoadUnit.Kilogram, SetDay,
            StrengthMaxSource.Calculation, "CoachSelection", "1.0", null, null));
        StringAssert.Contains(calculated.Message, "from a set they did");

        var typed = StrengthMaxRecord.Create(
            TenantId, ClientId, SquatId, StrengthMaxKind.CoachWorkingMax, 105m, StrengthLoadUnit.Kilogram, SetDay,
            StrengthMaxSource.Manual, "CoachSelection", "1.0", null, null);
        Assert.IsNull(typed.BasisLoad);
        Assert.IsNull(typed.SourceEstimateId);
    }

    [TestMethod]
    public void B7bTheEstimatorsExplainTheirNumbers()
    {
        var epley = new EpleyOneRepMaxEstimator();
        var brzycki = new BrzyckiOneRepMaxEstimator();

        Assert.AreEqual("Epley v1: 100 kg × (1 + 5 / 30) = 116.667 kg.", epley.Explain(100m, 5, StrengthLoadUnit.Kilogram));
        Assert.AreEqual("Epley v1: a single of 100 kg is the max itself.", epley.Explain(100m, 1, StrengthLoadUnit.Kilogram));
        Assert.AreEqual("Epley v1: 195 lb × (1 + 4 / 30) = 221 lb.", epley.Explain(195m, 4, StrengthLoadUnit.Pound));
        Assert.AreEqual("Brzycki v1: 100 kg × 36 / (37 − 5) = 112.5 kg.", brzycki.Explain(100m, 5, StrengthLoadUnit.Kilogram));
    }

    /// <summary>
    /// The database's check on an estimate (CK_StrengthMaxHistory_SetBasis) bounds it between the weight lifted and
    /// 4/3 of it rounded to three decimals, the 10-rep factor; Epley v1 must sit inside for every rep count, or a
    /// legitimate save would be refused by the database.
    /// </summary>
    [TestMethod]
    public void B7bEveryEstimateFromASetSitsInsideTheDatabasesBounds()
    {
        foreach (var load in new[] { 0.001m, 0.015m, 2.5m, 61.235m, 100m, 333.333m, 1_499.999m })
        {
            for (var repetitions = 1; repetitions <= StrengthMaxRecord.MaximumSetRepetitions; repetitions++)
            {
                var value = Estimate(load, repetitions).Value;
                Assert.IsGreaterThanOrEqualTo(load, value, $"{load} × {repetitions}");
                Assert.IsLessThanOrEqualTo(decimal.Round(load * 40m / 30m, 3, MidpointRounding.AwayFromZero), value, $"{load} × {repetitions}");
            }
        }
    }
}
