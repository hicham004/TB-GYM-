using TB.Gym.Modules.Progress;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// The starting weight (critique B6, PRG-014) and "since start", whose fixed reference numbers pin
/// <see cref="BodyweightSinceStart"/> version 1.0: the latest weekly mean minus the mean of the week
/// holding the first start (PRG-005).
/// </summary>
[TestClass]
public sealed class B6StartingWeightDomainTests
{
    private static readonly Guid TenantId = Guid.Parse("6b6b6b6b-0000-0000-0000-000000000001");
    private static readonly Guid ProfileId = Guid.Parse("6b6b6b6b-0000-0000-0000-000000000002");
    private static readonly Guid CoachId = Guid.Parse("6b6b6b6b-0000-0000-0000-000000000003");
    private static readonly DateTimeOffset Now = new(2026, 10, 30, 9, 0, 0, TimeSpan.Zero);

    [TestMethod]
    public void B6AStartKeepsWhatWasTypedAndStoresCanonicalKilograms()
    {
        var start = StartingWeight.Record(
            TenantId,
            ProfileId,
            new DateOnly(2025, 10, 15),
            214.7m,
            RecordedMassUnit.Pound,
            StartingWeightOrigin.Intake);

        Assert.AreEqual(97.386m, start.ValueKilograms);
        Assert.AreEqual(214.7m, start.EnteredValue);
        Assert.AreEqual(RecordedMassUnit.Pound, start.EnteredUnit);
        Assert.AreEqual(new DateOnly(2025, 10, 15), start.MeasurementDate);
        Assert.AreEqual(StartingWeightOrigin.Intake, start.Origin);
        Assert.AreEqual(ProfileId, start.ClientProfileId);
    }

    [TestMethod]
    public void B6AStartIsRefusedOutsideTheBodyweightRangeOrWithoutAProfile()
    {
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => StartingWeight.Record(
            TenantId, ProfileId, new DateOnly(2025, 10, 15), 19.9m, RecordedMassUnit.Kilogram, StartingWeightOrigin.Intake));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => StartingWeight.Record(
            TenantId, ProfileId, new DateOnly(2025, 10, 15), 500.1m, RecordedMassUnit.Kilogram, StartingWeightOrigin.Intake));
        Assert.ThrowsExactly<ArgumentException>(() => StartingWeight.Record(
            TenantId, Guid.Empty, new DateOnly(2025, 10, 15), 80m, RecordedMassUnit.Kilogram, StartingWeightOrigin.Intake));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => StartingWeight.Record(
            TenantId, ProfileId, new DateOnly(2025, 10, 15), 80m, RecordedMassUnit.Kilogram, (StartingWeightOrigin)9));
    }

    [TestMethod]
    public void B6ACorrectionChangesTheStartAndKeepsTheOldValueWithItsReason()
    {
        var start = StartingWeight.Record(
            TenantId, ProfileId, new DateOnly(2025, 10, 15), 79.4m, RecordedMassUnit.Kilogram, StartingWeightOrigin.Intake);

        var correction = start.Correct(
            new DateOnly(2025, 10, 14),
            97.4m,
            RecordedMassUnit.Kilogram,
            "  Typed the digits the wrong way round  ",
            Now,
            CoachId);

        Assert.AreEqual(97.4m, start.ValueKilograms);
        Assert.AreEqual(new DateOnly(2025, 10, 14), start.MeasurementDate);
        Assert.AreEqual(StartingWeightOrigin.Intake, start.Origin, "A correction never changes where the start came from.");
        Assert.AreEqual(start.Id, correction.StartingWeightId);
        Assert.AreEqual(ProfileId, correction.ClientProfileId);
        Assert.AreEqual(TenantId, correction.TenantId);
        Assert.AreEqual(79.4m, correction.ValueKilograms);
        Assert.AreEqual(79.4m, correction.EnteredValue);
        Assert.AreEqual(new DateOnly(2025, 10, 15), correction.MeasurementDate);
        Assert.AreEqual("Typed the digits the wrong way round", correction.Reason);
        Assert.AreEqual(Now, correction.SupersededAtUtc);
        Assert.AreEqual(CoachId, correction.SupersededByUserId);
    }

    [TestMethod]
    public void B6ACorrectionMayChangeOnlyTheDayOrOnlyTheUnit()
    {
        var start = StartingWeight.Record(
            TenantId, ProfileId, new DateOnly(2025, 10, 15), 97.4m, RecordedMassUnit.Kilogram, StartingWeightOrigin.Intake);

        start.Correct(new DateOnly(2025, 10, 16), 97.4m, RecordedMassUnit.Kilogram, "Wrong day", Now, CoachId);
        Assert.AreEqual(new DateOnly(2025, 10, 16), start.MeasurementDate);

        start.Correct(new DateOnly(2025, 10, 16), 214.7m, RecordedMassUnit.Pound, "Weighed in pounds", Now, CoachId);
        Assert.AreEqual(RecordedMassUnit.Pound, start.EnteredUnit);
        Assert.AreEqual(97.386m, start.ValueKilograms);
    }

    [TestMethod]
    public void B6ACorrectionThatChangesNothingOrLacksAReasonIsRefusedBeforeAnythingChanges()
    {
        var start = StartingWeight.Record(
            TenantId, ProfileId, new DateOnly(2025, 10, 15), 97.4m, RecordedMassUnit.Kilogram, StartingWeightOrigin.Intake);

        Assert.ThrowsExactly<ArgumentException>(() => start.Correct(
            new DateOnly(2025, 10, 15), 97.4m, RecordedMassUnit.Kilogram, "No change", Now, CoachId));
        Assert.ThrowsExactly<ArgumentException>(() => start.Correct(
            new DateOnly(2025, 10, 15), 96m, RecordedMassUnit.Kilogram, "   ", Now, CoachId));
        Assert.ThrowsExactly<ArgumentException>(() => start.Correct(
            new DateOnly(2025, 10, 15), 96m, RecordedMassUnit.Kilogram, new string('x', 501), Now, CoachId));
        Assert.ThrowsExactly<ArgumentException>(() => start.Correct(
            new DateOnly(2025, 10, 15), 96m, RecordedMassUnit.Kilogram, "Typed wrong", Now, Guid.Empty));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => start.Correct(
            new DateOnly(2025, 10, 15), 12m, RecordedMassUnit.Kilogram, "Typed wrong", Now, CoachId));

        Assert.AreEqual(97.4m, start.ValueKilograms, "A refused correction leaves the start as it was.");
        Assert.AreEqual(new DateOnly(2025, 10, 15), start.MeasurementDate);
    }

    [TestMethod]
    public void B6BSinceStartIsTheLatestWeeklyMeanMinusTheStartWeeksMean()
    {
        // Wed 15 Oct 2025 starts a Monday week of one weigh-in; the latest week, from Mon 2 Mar 2026, has two.
        var result = BodyweightSinceStart.Calculate(
            new DateOnly(2025, 10, 15),
            [Sample(2025, 10, 15, 97.4m)],
            [Sample(2026, 3, 2, 92.3m), Sample(2026, 3, 4, 91.9m)],
            DayOfWeek.Monday)!;

        Assert.AreEqual(new BodyweightWeekMean(new DateOnly(2025, 10, 13), 97.4m, 1), result.StartWeek);
        Assert.AreEqual(new BodyweightWeekMean(new DateOnly(2026, 3, 2), 92.1m, 2), result.LatestWeek);
        Assert.AreEqual(-5.3m, result.DeltaKilograms);
        Assert.AreEqual(-5.4m, result.Percent);
    }

    [TestMethod]
    public void B6BSinceStartRoundsEachMeanToThreeDecimalsAndThePercentToOneHalfAwayFromZero()
    {
        var means = BodyweightSinceStart.Calculate(
            new DateOnly(2026, 10, 5),
            [Sample(2026, 10, 5, 80.0m), Sample(2026, 10, 6, 80.1m), Sample(2026, 10, 7, 80.1m)],
            [Sample(2026, 10, 19, 79.0m), Sample(2026, 10, 20, 79.05m)],
            DayOfWeek.Monday)!;
        Assert.AreEqual(80.067m, means.StartWeek.MeanKilograms);
        Assert.AreEqual(79.025m, means.LatestWeek.MeanKilograms);
        Assert.AreEqual(-1.042m, means.DeltaKilograms);
        Assert.AreEqual(-1.3m, means.Percent);

        // −1.25 % exactly: half away from zero gives −1.3, where banker's rounding would give −1.2.
        var half = BodyweightSinceStart.Calculate(
            new DateOnly(2026, 10, 5),
            [Sample(2026, 10, 5, 100m)],
            [Sample(2026, 10, 19, 98.75m)],
            DayOfWeek.Monday)!;
        Assert.AreEqual(-1.25m, half.DeltaKilograms);
        Assert.AreEqual(-1.3m, half.Percent);
    }

    [TestMethod]
    public void B6BTheStartWeekFollowsTheWorkspaceWeek()
    {
        // Sun 4 Oct 2026: a Monday week holds Fri 2 and Sun 4, a Sunday week Sun 4 and Mon 5.
        BodyweightTrendSample[] start = [Sample(2026, 10, 2, 70m), Sample(2026, 10, 4, 72m), Sample(2026, 10, 5, 74m)];
        BodyweightTrendSample[] latest = [Sample(2026, 10, 21, 71m)];

        var monday = BodyweightSinceStart.Calculate(new DateOnly(2026, 10, 4), start, latest, DayOfWeek.Monday)!;
        Assert.AreEqual(new DateOnly(2026, 9, 28), monday.StartWeek.WeekStart);
        Assert.AreEqual(71m, monday.StartWeek.MeanKilograms);
        Assert.AreEqual(0m, monday.DeltaKilograms);
        Assert.AreEqual(0m, monday.Percent);

        var sunday = BodyweightSinceStart.Calculate(new DateOnly(2026, 10, 4), start, latest, DayOfWeek.Sunday)!;
        Assert.AreEqual(new DateOnly(2026, 10, 4), sunday.StartWeek.WeekStart);
        Assert.AreEqual(73m, sunday.StartWeek.MeanKilograms);
        Assert.AreEqual(-2m, sunday.DeltaKilograms);
        Assert.AreEqual(-2.7m, sunday.Percent);
    }

    [TestMethod]
    public void B6BAReturningClientIsMeasuredFromTheirFirstStartAndTheLatestWeekOfTheProfileRead()
    {
        // The first profile's own later weigh-ins are not "latest": the profile read is the new one.
        var result = BodyweightSinceStart.Calculate(
            new DateOnly(2025, 10, 15),
            [Sample(2025, 10, 15, 97.4m), Sample(2026, 2, 1, 90m)],
            [Sample(2026, 3, 3, 99.0m)],
            DayOfWeek.Monday)!;

        Assert.AreEqual(97.4m, result.StartWeek.MeanKilograms);
        Assert.AreEqual(new DateOnly(2026, 3, 2), result.LatestWeek.WeekStart);
        Assert.AreEqual(1.6m, result.DeltaKilograms);
        Assert.AreEqual(1.6m, result.Percent);
    }

    [TestMethod]
    public void B6BOnlyTheStartShowsWhileThereIsNothingToCompare()
    {
        var startDate = new DateOnly(2025, 10, 15);

        // No week after the start's week has a weigh-in.
        Assert.IsNull(BodyweightSinceStart.Calculate(
            startDate, [Sample(2025, 10, 15, 97.4m)], [Sample(2025, 10, 15, 97.4m), Sample(2025, 10, 19, 97m)], DayOfWeek.Monday));
        // The profile read has no weigh-in at all.
        Assert.IsNull(BodyweightSinceStart.Calculate(startDate, [Sample(2025, 10, 15, 97.4m)], [], DayOfWeek.Monday));
        // The start's week has no weigh-in, so there is no weekly mean to start from, never a single day.
        Assert.IsNull(BodyweightSinceStart.Calculate(
            startDate, [Sample(2025, 10, 20, 97m)], [Sample(2026, 3, 2, 92m)], DayOfWeek.Monday));
    }

    private static BodyweightTrendSample Sample(int year, int month, int day, decimal kilograms) =>
        new(new DateOnly(year, month, day), kilograms);
}
