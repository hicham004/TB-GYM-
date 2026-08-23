using TB.Gym.Modules.Progress;

namespace TB.Gym.Domain.Tests;

[TestClass]
public sealed class Phase5AProgressDomainTests
{
    [TestMethod]
    public void KilogramAndPoundInputsResolveToTheSameCanonicalValue()
    {
        var kilograms = BodyweightUnitConverter.ToKilograms(100m, RecordedMassUnit.Kilogram);
        var pounds = BodyweightUnitConverter.ToKilograms(
            220.46226218487758072297380135m,
            RecordedMassUnit.Pound);

        Assert.AreEqual(100m, kilograms);
        Assert.AreEqual(kilograms, pounds);
        Assert.AreEqual(220.462m, BodyweightUnitConverter.FromKilograms(kilograms, RecordedMassUnit.Pound));
    }

    [TestMethod]
    public void Ewmav2MatchesTimeAwareReferenceSeriesAndUsesRecordedSamplesOnly()
    {
        var points = BodyweightTrendEwma.Calculate(
        [
            new BodyweightTrendSample(new DateOnly(2026, 8, 1), 80m),
            new BodyweightTrendSample(new DateOnly(2026, 8, 3), 79m),
            new BodyweightTrendSample(new DateOnly(2026, 8, 7), 78m),
        ],
        new DateOnly(2026, 8, 1),
        new DateOnly(2026, 8, 8));

        Assert.HasCount(3, points);
        Assert.AreEqual(80m, points[0].EstimateKilograms);
        Assert.AreEqual(79.819m, points[1].EstimateKilograms);
        Assert.AreEqual(79.219m, points[2].EstimateKilograms);
        Assert.AreEqual(3, points[2].SampleCount);
    }

    [TestMethod]
    public void Ewmav2UsesElapsedDaysSoASixtyDayGapNearlyReplacesTheEstimate()
    {
        var points = BodyweightTrendEwma.Calculate(
        [
            new BodyweightTrendSample(new DateOnly(2026, 6, 1), 80m),
            new BodyweightTrendSample(new DateOnly(2026, 7, 31), 100m),
        ],
        new DateOnly(2026, 6, 1),
        new DateOnly(2026, 8, 1));

        Assert.AreEqual(99.950m, points[1].EstimateKilograms);
        Assert.IsGreaterThan(99.9m, points[1].EstimateKilograms);
    }

    [TestMethod]
    public void Ewmav2ProducesTheSameDateValueForDifferentDisplayWindows()
    {
        BodyweightTrendSample[] samples =
        [
            new(new DateOnly(2026, 5, 20), 83m),
            new(new DateOnly(2026, 6, 15), 82m),
            new(new DateOnly(2026, 7, 10), 81m),
            new(new DateOnly(2026, 8, 1), 80m),
            new(new DateOnly(2026, 8, 15), 79m),
        ];

        var wide = BodyweightTrendEwma.Calculate(
            samples,
            new DateOnly(2026, 6, 1),
            new DateOnly(2026, 8, 16));
        var narrow = BodyweightTrendEwma.Calculate(
            samples,
            new DateOnly(2026, 8, 1),
            new DateOnly(2026, 8, 16));

        Assert.AreEqual(
            wide.Single(point => point.Date == new DateOnly(2026, 8, 15)).EstimateKilograms,
            narrow.Single(point => point.Date == new DateOnly(2026, 8, 15)).EstimateKilograms);
    }

    [TestMethod]
    public void WeekAlignmentUsesConfiguredNonMondayStart()
    {
        Assert.AreEqual(
            new DateOnly(2026, 8, 22),
            BodyweightWeekPolicy.GetWeekStart(new DateOnly(2026, 8, 23), DayOfWeek.Saturday));
        Assert.AreEqual(
            new DateOnly(2026, 8, 15),
            BodyweightWeekPolicy.GetWeekStart(new DateOnly(2026, 8, 21), DayOfWeek.Saturday));
    }

    [TestMethod]
    public void CorrectionReturnsThePriorEnteredAndCanonicalValue()
    {
        var observation = BodyweightObservation.CreateInitial(
            Guid.NewGuid(),
            Guid.NewGuid(),
            new DateOnly(2026, 8, 22),
            80m,
            RecordedMassUnit.Kilogram,
            BodyweightSource.Client);
        var actor = Guid.NewGuid();
        observation.StampCreation(new DateTimeOffset(2026, 8, 22, 8, 0, 0, TimeSpan.Zero), actor);

        var previous = observation.Correct(176.36980974790206457837904108m, RecordedMassUnit.Pound, BodyweightSource.Coach);

        Assert.AreEqual(80m, previous.ValueKilograms);
        Assert.AreEqual(80m, previous.EnteredValue);
        Assert.AreEqual(RecordedMassUnit.Kilogram, previous.EnteredUnit);
        Assert.AreEqual(actor, previous.RecordedByUserId);
        Assert.AreEqual(80m, observation.ValueKilograms);
        Assert.AreEqual(RecordedMassUnit.Pound, observation.EnteredUnit);
    }
}
