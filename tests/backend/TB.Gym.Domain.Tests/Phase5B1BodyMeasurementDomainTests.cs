using TB.Gym.Modules.Progress;

namespace TB.Gym.Domain.Tests;

[TestClass]
public sealed class Phase5B1BodyMeasurementDomainTests
{
    [TestMethod]
    public void InchInputConvertsToCanonicalCentimetresAndPreservesEnteredValue()
    {
        var measurement = BodyMeasurement.CreateInitial(
            Guid.NewGuid(),
            Guid.NewGuid(),
            new DateOnly(2026, 8, 23),
            MeasurementType.Waist,
            10m,
            MeasurementUnit.Inch,
            BodyMeasurementSource.Client);

        Assert.AreEqual(25.4m, measurement.CanonicalValue);
        Assert.AreEqual(10m, measurement.EnteredValue);
        Assert.AreEqual(MeasurementUnit.Inch, measurement.EnteredUnit);
        Assert.AreEqual(
            10m,
            BodyMeasurementUnitConverter.FromCanonical(
                MeasurementType.Waist,
                measurement.CanonicalValue,
                MeasurementUnit.Inch));
    }

    [TestMethod]
    public void MeasurementTypeRejectsAnIncompatibleUnit()
    {
        Assert.ThrowsExactly<ArgumentException>(() => BodyMeasurement.CreateInitial(
            Guid.NewGuid(),
            Guid.NewGuid(),
            new DateOnly(2026, 8, 23),
            MeasurementType.Waist,
            80m,
            MeasurementUnit.Percent,
            BodyMeasurementSource.Client));
        Assert.ThrowsExactly<ArgumentException>(() => BodyMeasurement.CreateInitial(
            Guid.NewGuid(),
            Guid.NewGuid(),
            new DateOnly(2026, 8, 23),
            MeasurementType.BodyFatPercentage,
            20m,
            MeasurementUnit.Inch,
            BodyMeasurementSource.Client));
    }

    [TestMethod]
    public void MeasurementTypeRejectsValuesOutsideItsCanonicalRange()
    {
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => BodyMeasurement.CreateInitial(
            Guid.NewGuid(),
            Guid.NewGuid(),
            new DateOnly(2026, 8, 23),
            MeasurementType.Chest,
            9.999m,
            MeasurementUnit.Centimetre,
            BodyMeasurementSource.Client));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => BodyMeasurement.CreateInitial(
            Guid.NewGuid(),
            Guid.NewGuid(),
            new DateOnly(2026, 8, 23),
            MeasurementType.BodyFatPercentage,
            75.001m,
            MeasurementUnit.Percent,
            BodyMeasurementSource.Client));
    }
}
