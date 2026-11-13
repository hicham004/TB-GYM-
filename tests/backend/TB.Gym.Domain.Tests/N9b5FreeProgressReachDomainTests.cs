using TB.Gym.Modules.Progress;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.Modules.Tenancy;
using TB.Gym.SharedKernel;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// The notes plan's N9b5: how far back a Free trainee's own Progress reaches (PRG-015, "FreeProgressReach" 1.0), a
/// requested window moved inside that reach, and the house's two new settings, the window in days and the house's own
/// media storage in gigabytes (MED-019). Every figure is the tests' own, never the owner's.
/// </summary>
[TestClass]
public sealed class N9b5FreeProgressReachDomainTests
{
    private static readonly DateOnly Today = new(2026, 11, 13);

    // ---- the reach (PRG-015) ----

    [TestMethod]
    public void N9b5TheReachIsNamedAndVersioned()
    {
        Assert.AreEqual(
            ("FreeProgressReach", "1.0"),
            (FreeProgressReachRule.MethodKey, FreeProgressReachRule.MethodVersion));
    }

    [TestMethod]
    public void N9b5OnFreeTheReachIsTheWindowOfDaysEndingToday()
    {
        // A window of N days is [today - N + 1, today + 1): the same shape as the dashboard's own windows.
        Assert.AreEqual(Today, FreeProgressReachRule.EarliestShown(HouseTier.Free, 1, Today));
        Assert.AreEqual(new DateOnly(2026, 11, 7), FreeProgressReachRule.EarliestShown(HouseTier.Free, 7, Today));
        Assert.AreEqual(new DateOnly(2026, 8, 16), FreeProgressReachRule.EarliestShown(HouseTier.Free, 90, Today));
        Assert.AreEqual(new DateOnly(2016, 11, 16), FreeProgressReachRule.EarliestShown(HouseTier.Free, 3_650, Today));

        // The day moves with today, so a weigh-in leaves the reach the day it is N days old.
        Assert.AreEqual(new DateOnly(2026, 8, 17), FreeProgressReachRule.EarliestShown(HouseTier.Free, 90, Today.AddDays(1)));
        Assert.AreEqual(
            new DateOnly(2024, 3, 1),
            FreeProgressReachRule.EarliestShown(HouseTier.Free, 1, new DateOnly(2024, 3, 1)),
            "A leap day's next morning is no special case.");
    }

    [TestMethod]
    public void N9b5APaidTierNoTierOrAnEmptyWindowReachesBackWithoutLimit()
    {
        foreach (var paid in new HouseTier?[] { HouseTier.ProPlus, HouseTier.Max, null })
        {
            Assert.IsNull(FreeProgressReachRule.EarliestShown(paid, 90, Today), $"{paid?.ToString() ?? "no tier"}: no limit.");
        }

        Assert.IsNull(FreeProgressReachRule.EarliestShown(HouseTier.Free, null, Today), "An empty window means no limit.");
        Assert.IsNull(FreeProgressReachRule.EarliestShown(HouseTier.Free, 0, Today), "A window the setting refuses limits nothing.");
        Assert.IsNull(FreeProgressReachRule.EarliestShown(HouseTier.Free, -5, Today));
    }

    [TestMethod]
    public void N9b5TheReachNeverRunsPastTheFirstDayACalendarHolds()
    {
        Assert.AreEqual(DateOnly.MinValue, FreeProgressReachRule.EarliestShown(HouseTier.Free, 3_650, DateOnly.MinValue.AddDays(3)));
    }

    // ---- a window moved inside the reach ----

    [TestMethod]
    public void N9b5AWindowInsideTheReachOrWithNoReachIsLeftAsAsked()
    {
        var from = new DateOnly(2026, 10, 1);
        var toExclusive = new DateOnly(2026, 11, 14);
        Assert.AreEqual((from, toExclusive), ProgressReachWindow.Clamp(from, toExclusive, null));
        Assert.AreEqual((from, toExclusive), ProgressReachWindow.Clamp(from, toExclusive, from));
        Assert.AreEqual((from, toExclusive), ProgressReachWindow.Clamp(from, toExclusive, new DateOnly(2026, 9, 30)));
    }

    [TestMethod]
    public void N9b5AWindowThatStartsBeforeTheReachStartsOnItsFirstDayAndEndsWhereAsked()
    {
        var earliest = new DateOnly(2026, 8, 16);
        Assert.AreEqual(
            (earliest, new DateOnly(2026, 11, 14)),
            ProgressReachWindow.Clamp(new DateOnly(2025, 11, 13), new DateOnly(2026, 11, 14), earliest),
            "A year asked for on a 90-day reach is the 90 days.");
        Assert.AreEqual(
            (earliest, earliest.AddDays(1)),
            ProgressReachWindow.Clamp(new DateOnly(2026, 8, 15), earliest.AddDays(1), earliest),
            "Half-open: a window ending the day after the reach starts keeps that one day.");
    }

    [TestMethod]
    public void N9b5AWindowWhollyBeforeTheReachBecomesItsFirstDayAndIsNeverRefused()
    {
        var earliest = new DateOnly(2026, 8, 16);
        Assert.AreEqual(
            (earliest, earliest.AddDays(1)),
            ProgressReachWindow.Clamp(new DateOnly(2025, 1, 1), new DateOnly(2025, 2, 1), earliest));
        Assert.AreEqual(
            (earliest, earliest.AddDays(1)),
            ProgressReachWindow.Clamp(new DateOnly(2026, 7, 1), earliest, earliest),
            "A window ending exactly where the reach starts holds nothing it may show.");
    }

    // ---- the house's two new settings ----

    [TestMethod]
    public void N9b5FreesWindowIsWholeDaysFromOneToTenYearsAndEmptyMeansNoLimit()
    {
        Assert.AreEqual("1", HouseSettingRule.Normalize(HouseSetting.FreeProgressDays, " 001 ").Value);
        Assert.AreEqual("90", HouseSettingRule.Normalize(HouseSetting.FreeProgressDays, "90").Value);
        Assert.AreEqual(
            (3_650, "3650"),
            (HouseSettingRule.MaximumFreeProgressDays, HouseSettingRule.Normalize(HouseSetting.FreeProgressDays, "3650").Value));
        Assert.AreEqual(HouseSettingValue.Empty, HouseSettingRule.Normalize(HouseSetting.FreeProgressDays, "  "));

        const string Sentence =
            "Enter a whole number of days from 1 to 3,650, or leave it empty. Empty means Free's Progress has no limit.";
        foreach (var refused in new[] { "0", "3651", "-1", "90.5", "9 0", "ninety", "1e2", "+90" })
        {
            var value = HouseSettingRule.Normalize(HouseSetting.FreeProgressDays, refused);
            Assert.AreEqual((false, (string?)null, (string?)Sentence), (value.IsValid, value.Value, value.Error), refused);
        }
    }

    [TestMethod]
    public void N9b5TheHousesStorageIsWholeGigabytesUpToThePlatformsCeilingAndEmptyMeansThePlatformsAllowance()
    {
        Assert.AreEqual((10_240, 1_073_741_824L), (HouseSettingRule.MaximumMediaStorageGigabytes, HouseSettingRule.BytesPerGigabyte));
        Assert.AreEqual("1", HouseSettingRule.Normalize(HouseSetting.MediaStorageGigabytes, "1").Value);
        Assert.AreEqual("10240", HouseSettingRule.Normalize(HouseSetting.MediaStorageGigabytes, "10240").Value);
        Assert.AreEqual(HouseSettingValue.Empty, HouseSettingRule.Normalize(HouseSetting.MediaStorageGigabytes, null));

        const string Sentence =
            "Enter a whole number of gigabytes from 1 to 10,240, or leave it empty. Empty gives the house the platform's allowance.";
        foreach (var refused in new[] { "0", "10241", "-3", "2.5", "20GB", "999999999" })
        {
            var value = HouseSettingRule.Normalize(HouseSetting.MediaStorageGigabytes, refused);
            Assert.AreEqual((false, (string?)null, (string?)Sentence), (value.IsValid, value.Value, value.Error), refused);
        }

        // A change of either setting is refused in the same sentence the admin reads.
        var change = Assert.ThrowsExactly<ArgumentException>(() => HouseSettingChange.Record(
            Guid.Parse("10000000-0000-0000-0000-0000000009b5"),
            HouseSetting.MediaStorageGigabytes,
            1,
            "0",
            Guid.Parse("20000000-0000-0000-0000-0000000009b5"),
            new DateTimeOffset(2026, 11, 13, 9, 0, 0, TimeSpan.Zero)));
        Assert.AreEqual(Sentence, change.PersonMessage());
    }

    [TestMethod]
    public void N9b5TheSettingsAsTheyStandReadTheWindowAndTheStorageInBytes()
    {
        var settings = HouseSettings.From(
        [
            KeyValuePair.Create(HouseSetting.SignUpsPerWeek, (string?)"7"),
            KeyValuePair.Create(HouseSetting.FreeProgressDays, (string?)"90"),
            KeyValuePair.Create(HouseSetting.MediaStorageGigabytes, (string?)"10240"),
        ]);
        Assert.AreEqual((7, (int?)null, 90, 10_240), (settings.SignUpsPerWeek, settings.MinimumSignUpAge, settings.FreeProgressDays, settings.MediaStorageGigabytes));
        Assert.AreEqual(10_240L * 1024 * 1024 * 1024, settings.MediaStorageBytes, "Ten terabytes in a long, never an int.");

        Assert.IsNull(HouseSettings.Empty.FreeProgressDays);
        Assert.IsNull(HouseSettings.Empty.MediaStorageBytes, "Empty: the platform's allowance stands.");

        // Sign-up reads its own two settings alone: the window and the storage never open or close it.
        var signUpOnly = new HouseSettings(7, 18);
        Assert.AreEqual(
            TraineeSignUpRule.IsOpenFor(signUpOnly),
            TraineeSignUpRule.IsOpenFor(signUpOnly with { FreeProgressDays = 30, MediaStorageGigabytes = 100 }));
        Assert.IsFalse(TraineeSignUpRule.IsOpenFor(new HouseSettings(null, null, 30, 100)));
    }
}
