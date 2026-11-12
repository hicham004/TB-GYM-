using System.Globalization;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.Modules.Tenancy;
using TB.Gym.SharedKernel;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// The notes plan's N9a1, the house and trainee sign-up (ADR 0041): the house mark (CLI-022), the house's settings
/// (CLI-023), trainee sign-up v1 (CLI-024: when it is open, the house's own week and who is old enough), the sweep's
/// settings (CLI-025), a self-directed trainee under coach attention v9 (CLI-026, CLI-018) and who is asked the
/// consumer terms (CLI-010). The house keeps Beirut's time: two hours ahead of UTC in winter and three from 29 Mar
/// 2026, whose midnight the clocks skipped, until 25 Oct 2026. Read on Thu 12 Nov 2026. Every name, number and age
/// here is the tests' own: the house's real figures are data its admin enters.
/// </summary>
[TestClass]
public sealed class N9a1HouseSignUpDomainTests
{
    private static readonly TimeZoneInfo Beirut = TimeZoneInfo.FindSystemTimeZoneById("Asia/Beirut");
    private static readonly Guid HouseId = Guid.Parse("10000000-0000-0000-0000-0000000009a1");
    private static readonly Guid TraineeUserId = Guid.Parse("20000000-0000-0000-0000-0000000009a1");
    private static readonly Guid HouseCoachUserId = Guid.Parse("20000000-0000-0000-0000-0000000009a2");
    private static readonly Guid HouseOwnerUserId = Guid.Parse("20000000-0000-0000-0000-0000000009a3");
    private static readonly Guid AdminUserId = Guid.Parse("20000000-0000-0000-0000-0000000009a4");
    private static readonly Guid ProfileId = Guid.Parse("30000000-0000-0000-0000-0000000009a1");
    private static readonly DateOnly Today = new(2026, 11, 12);
    private static readonly DateTimeOffset Now = new(2026, 11, 12, 9, 0, 0, TimeSpan.Zero);

    private const string SignUpsPerWeekSentence =
        "Enter a whole number from 0 to 10,000, or leave it empty. Empty or 0 keeps sign-up closed.";

    private const string MinimumSignUpAgeSentence =
        "Enter an age from 18 to 100, or leave it empty, which keeps sign-up closed. TB Gym is for adults, so the age cannot be under 18.";

    private const string UnknownSettingSentence = "Choose one of the house's settings.";

    private const string NamesRequiredSentence = "First and last names are required.";

    private const string NamesTooLongSentence = "First and last names cannot exceed 100 characters.";

    private const string SweepDaysSentence =
        "TraineeSignUps:RemoveUnconfirmedAfterDays must be a whole number of days from 1 to 90.";

    private const string SweepSecondsSentence = "TraineeSignUps:SweepIntervalSeconds must be from 60 to 86400 seconds.";

    // ---- the house mark (CLI-022) ----

    [TestMethod]
    public void AWorkspaceIsMarkedAsTheHouseOnceAndClearedOnce()
    {
        var workspace = Tenant.Create("Oak Hall Training", "oak-hall-training");
        Assert.IsFalse(workspace.IsHouse, "No workspace is the house until the platform admin's command says so.");
        Assert.IsFalse(workspace.ClearHouse(), "There is no mark to take away.");
        Assert.IsFalse(workspace.IsHouse);

        Assert.IsTrue(workspace.MarkAsHouse());
        Assert.IsTrue(workspace.IsHouse);
        Assert.IsFalse(workspace.MarkAsHouse(), "Marked already: the command has nothing to save.");
        Assert.IsTrue(workspace.IsHouse);

        Assert.IsTrue(workspace.ClearHouse());
        Assert.IsFalse(workspace.IsHouse);
        Assert.IsFalse(workspace.ClearHouse(), "Cleared already.");
        Assert.IsFalse(workspace.IsHouse);

        Assert.IsTrue(workspace.MarkAsHouse(), "A cleared workspace can be marked again.");
        Assert.IsTrue(workspace.IsHouse);
    }

    [TestMethod]
    public void TheMarkChangesNothingElseOfTheWorkspace()
    {
        var workspace = Tenant.Create("Oak Hall Training", "oak-hall-training", weekStartsOn: DayOfWeek.Saturday);
        var id = workspace.Id;

        workspace.MarkAsHouse();

        Assert.AreEqual(id, workspace.Id);
        Assert.AreEqual("Oak Hall Training", workspace.Name);
        Assert.AreEqual("oak-hall-training", workspace.Slug);
        Assert.AreEqual("Asia/Beirut", workspace.TimeZoneId);
        Assert.AreEqual(DayOfWeek.Saturday, workspace.WeekStartsOn, "The house's week is still the one its owner set.");
        Assert.IsTrue(workspace.IsActive);
    }

    // ---- the house's settings (CLI-023) ----

    [TestMethod]
    public void TheHouseHasItsTwoSettingsAndTheirBounds()
    {
        // Each change row keeps the setting it changed, so a setting's number is never given to another.
        Assert.AreEqual(
            "SignUpsPerWeek 1, MinimumSignUpAge 2",
            string.Join(", ", Enum.GetValues<HouseSetting>().Select(setting => $"{setting} {(int)setting}")));
        Assert.AreEqual(
            (10_000, 18, 100),
            (HouseSettingRule.MaximumSignUpsPerWeek, HouseSettingRule.AdultAge, HouseSettingRule.MaximumSignUpAge));
    }

    [TestMethod]
    public void AnEmptySettingIsValidAndStoresNothing()
    {
        string?[] empties = [null, "", " ", "    ", "\t", " \r\n "];
        foreach (var setting in Enum.GetValues<HouseSetting>())
        {
            foreach (var typed in empties)
            {
                var value = HouseSettingRule.Normalize(setting, typed);

                Assert.IsTrue(value.IsValid, $"{setting}: an empty setting is a way to close what it governs.");
                Assert.IsNull(value.Value, $"{setting}: nothing is stored.");
                Assert.IsNull(value.Error);
                Assert.AreEqual(HouseSettingValue.Empty, value);
                Assert.IsNull(HouseSettingRule.Number(value.Value), "And it reads back as no number.");
            }
        }
    }

    [TestMethod]
    public void ASettingIsStoredAsItsNumberTrimmedAndWithoutLeadingZeros()
    {
        (HouseSetting Setting, string Typed, string Stored)[] cases =
        [
            (HouseSetting.SignUpsPerWeek, "0", "0"),
            (HouseSetting.SignUpsPerWeek, "1", "1"),
            (HouseSetting.SignUpsPerWeek, "137", "137"),
            (HouseSetting.SignUpsPerWeek, "9999", "9999"),
            (HouseSetting.SignUpsPerWeek, "10000", "10000"),
            (HouseSetting.SignUpsPerWeek, "007", "7"),
            (HouseSetting.SignUpsPerWeek, "000", "0"),
            (HouseSetting.SignUpsPerWeek, "000000053", "53"),
            (HouseSetting.SignUpsPerWeek, "  53  ", "53"),
            (HouseSetting.SignUpsPerWeek, "\t0010000\r\n", "10000"),
            (HouseSetting.SignUpsPerWeek, "\u00A07\u00A0", "7"),
            (HouseSetting.MinimumSignUpAge, "18", "18"),
            (HouseSetting.MinimumSignUpAge, "19", "19"),
            (HouseSetting.MinimumSignUpAge, "99", "99"),
            (HouseSetting.MinimumSignUpAge, "100", "100"),
            (HouseSetting.MinimumSignUpAge, "021", "21"),
            (HouseSetting.MinimumSignUpAge, " 0018 ", "18"),
        ];

        foreach (var (setting, typed, stored) in cases)
        {
            var value = HouseSettingRule.Normalize(setting, typed);

            Assert.AreEqual(HouseSettingValue.Of(stored), value, $"{setting} typed as '{typed}'");
            Assert.AreEqual(int.Parse(stored, CultureInfo.InvariantCulture), HouseSettingRule.Number(value.Value));
            // The stored form typed again is the same value, which is how the admin's API knows nothing changed.
            Assert.AreEqual(value, HouseSettingRule.Normalize(setting, value.Value), $"{setting} '{stored}' again");
        }
    }

    [TestMethod]
    public void SignUpsAWeekIsAWholeNumberFromZeroToTenThousand()
    {
        string[] refused =
        [
            // Past the bound, however far.
            "10001", "010001", "2147483647", "2147483648", "99999999999999999999",
            // A sign, either side.
            "-1", "-0", "+7", "7-", "7+",
            // Not whole, or written with separators.
            "7.0", "7.5", "7,5", "1,000", "1 000", "1e3", "0x1F",
            // Not a number.
            "seven", "7a", "a7", "7 a week", "?",
            // Digits outside ASCII: Arabic-Indic 7 and 13, a full-width 7, a vulgar half.
            "\u0667", "\u0661\u0663", "\uFF17", "\u00BD",
        ];

        foreach (var typed in refused)
        {
            var value = HouseSettingRule.Normalize(HouseSetting.SignUpsPerWeek, typed);

            Assert.AreEqual(HouseSettingValue.Refused(SignUpsPerWeekSentence), value, $"'{typed}'");
            Assert.IsFalse(value.IsValid, $"'{typed}'");
            Assert.IsNull(value.Value, $"'{typed}' stores nothing.");
        }
    }

    [TestMethod]
    public void TheSignUpAgeIsFromEighteenToAHundredAndItsRefusalSaysTbGymIsForAdults()
    {
        string[] refused =
        [
            // Under 18, and over 100.
            "17", "017", "16", "1", "0", "101", "0101", "180", "1000",
            // A sign, either side.
            "-18", "+18", "18+",
            // Not whole, or not a number.
            "18.0", "18.5", "18,5", "1 8", "eighteen", "18y", "18 years",
            // Digits outside ASCII: Arabic-Indic and full-width 18.
            "\u0661\u0668", "\uFF11\uFF18",
        ];

        foreach (var typed in refused)
        {
            var value = HouseSettingRule.Normalize(HouseSetting.MinimumSignUpAge, typed);

            Assert.AreEqual(HouseSettingValue.Refused(MinimumSignUpAgeSentence), value, $"'{typed}'");
            Assert.Contains("TB Gym is for adults", value.Error!);
            Assert.IsNull(value.Value, $"'{typed}' stores nothing.");
        }

        // A number the other setting takes is still refused here, and the other way round.
        Assert.IsFalse(HouseSettingRule.Normalize(HouseSetting.MinimumSignUpAge, "7").IsValid);
        Assert.IsTrue(HouseSettingRule.Normalize(HouseSetting.SignUpsPerWeek, "7").IsValid);
        Assert.IsTrue(HouseSettingRule.Normalize(HouseSetting.SignUpsPerWeek, "101").IsValid);
    }

    [TestMethod]
    public void AnUndefinedSettingIsRefusedWhateverIsTyped()
    {
        HouseSetting[] undefined = [(HouseSetting)0, (HouseSetting)3, (HouseSetting)(-1), (HouseSetting)int.MaxValue];
        string?[] typed = [null, "", "7", "19", "seven"];

        foreach (var setting in undefined)
        {
            foreach (var value in typed)
            {
                Assert.AreEqual(
                    HouseSettingValue.Refused(UnknownSettingSentence),
                    HouseSettingRule.Normalize(setting, value),
                    $"{(int)setting} with '{value}'");
            }
        }
    }

    [TestMethod]
    public void AStoredNumberIsReadBackAndAnythingElseReadsAsNone()
    {
        Assert.AreEqual(0, HouseSettingRule.Number("0"));
        Assert.AreEqual(7, HouseSettingRule.Number("7"));
        Assert.AreEqual(19, HouseSettingRule.Number("19"));
        Assert.AreEqual(10_000, HouseSettingRule.Number("10000"));

        string?[] none = [null, "", " ", " 7", "7 ", "-7", "+7", "7.0", "seven", "\u0667", "99999999999999999999"];
        foreach (var stored in none)
        {
            Assert.IsNull(HouseSettingRule.Number(stored), $"'{stored}'");
        }
    }

    [TestMethod]
    public void TheSettingsAsTheyStandAreTheLatestValueOfEachReadAsNumbers()
    {
        Assert.AreEqual(
            new HouseSettings(7, 19),
            HouseSettings.From(new Dictionary<HouseSetting, string?>
            {
                [HouseSetting.MinimumSignUpAge] = "19",
                [HouseSetting.SignUpsPerWeek] = "7",
            }));

        // A setting never changed has no row, and one emptied has a row holding nothing: both read as none.
        Assert.AreEqual(HouseSettings.Empty, HouseSettings.From([]));
        Assert.AreEqual(new HouseSettings(null, null), HouseSettings.Empty);
        Assert.AreEqual(
            new HouseSettings(null, 19),
            HouseSettings.From([KeyValuePair.Create(HouseSetting.MinimumSignUpAge, (string?)"19")]));
        Assert.AreEqual(
            new HouseSettings(7, null),
            HouseSettings.From(new Dictionary<HouseSetting, string?>
            {
                [HouseSetting.SignUpsPerWeek] = "7",
                [HouseSetting.MinimumSignUpAge] = null,
            }));
        Assert.AreEqual(
            new HouseSettings(0, 100),
            HouseSettings.From(new Dictionary<HouseSetting, string?>
            {
                [HouseSetting.SignUpsPerWeek] = "0",
                [HouseSetting.MinimumSignUpAge] = "100",
            }));

        Assert.ThrowsExactly<ArgumentNullException>(() => HouseSettings.From(null!));
    }

    [TestMethod]
    public void ASettingChangeKeepsTheStoredValueWhoChangedItAndWhen()
    {
        var first = HouseSettingChange.Record(HouseId, HouseSetting.SignUpsPerWeek, 1, " 007 ", AdminUserId, Now);

        Assert.AreEqual(HouseId, first.TenantId);
        Assert.AreEqual(HouseSetting.SignUpsPerWeek, first.Setting);
        Assert.AreEqual(1, first.Sequence);
        Assert.AreEqual("7", first.Value, "The value is kept in the one form the rule writes.");
        Assert.AreEqual(AdminUserId, first.ChangedByUserId);
        Assert.AreEqual(Now, first.ChangedAtUtc);

        // Emptying a setting is a change like any other: a new row that holds nothing.
        var emptied = HouseSettingChange.Record(HouseId, HouseSetting.SignUpsPerWeek, 2, "   ", AdminUserId, Now.AddMinutes(3));
        Assert.AreEqual(2, emptied.Sequence);
        Assert.IsNull(emptied.Value);
        Assert.AreEqual(Now.AddMinutes(3), emptied.ChangedAtUtc);
        Assert.IsNull(HouseSettingChange.Record(HouseId, HouseSetting.MinimumSignUpAge, 1, null, AdminUserId, Now).Value);

        var age = HouseSettingChange.Record(HouseId, HouseSetting.MinimumSignUpAge, 5, "021", AdminUserId, Now);
        Assert.AreEqual(HouseSetting.MinimumSignUpAge, age.Setting);
        Assert.AreEqual(5, age.Sequence);
        Assert.AreEqual("21", age.Value);
    }

    [TestMethod]
    public void ASettingChangeRefusesANumberBelowOneNobodyAndAValueTheRuleRefuses()
    {
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() =>
            HouseSettingChange.Record(HouseId, HouseSetting.SignUpsPerWeek, 0, "7", AdminUserId, Now));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() =>
            HouseSettingChange.Record(HouseId, HouseSetting.SignUpsPerWeek, -1, "7", AdminUserId, Now));

        var nobody = Assert.ThrowsExactly<ArgumentException>(() =>
            HouseSettingChange.Record(HouseId, HouseSetting.SignUpsPerWeek, 1, "7", Guid.Empty, Now));
        Assert.AreEqual("A setting is changed by somebody.", nobody.PersonMessage());

        Assert.ThrowsExactly<ArgumentException>(() =>
            HouseSettingChange.Record(Guid.Empty, HouseSetting.SignUpsPerWeek, 1, "7", AdminUserId, Now));

        // An invalid value is refused in the rule's own sentence, the one the admin reads.
        static ArgumentException Refused(HouseSetting setting, string? value) =>
            Assert.ThrowsExactly<ArgumentException>(() =>
                HouseSettingChange.Record(HouseId, setting, 1, value, AdminUserId, Now));

        Assert.AreEqual(SignUpsPerWeekSentence, Refused(HouseSetting.SignUpsPerWeek, "10001").PersonMessage());
        Assert.AreEqual(SignUpsPerWeekSentence, Refused(HouseSetting.SignUpsPerWeek, "-1").PersonMessage());
        Assert.AreEqual(MinimumSignUpAgeSentence, Refused(HouseSetting.MinimumSignUpAge, "17").PersonMessage());
        Assert.AreEqual(MinimumSignUpAgeSentence, Refused(HouseSetting.MinimumSignUpAge, "101").PersonMessage());
        Assert.AreEqual(UnknownSettingSentence, Refused((HouseSetting)3, "7").PersonMessage());
        Assert.AreEqual(UnknownSettingSentence, Refused((HouseSetting)0, null).PersonMessage());
        Assert.AreEqual("value", Refused(HouseSetting.MinimumSignUpAge, "17").ParamName);
    }

    // ---- trainee sign-up v1 (CLI-024): open, full or closed ----

    [TestMethod]
    public void TheRuleIsNamedAndVersioned()
    {
        Assert.AreEqual(("TraineeSignUp", 1), (TraineeSignUpRule.Key, TraineeSignUpRule.Version));
        // The oldest birth date it takes is the intake's own (CLI-004), and its form is 16 KB at most.
        Assert.AreEqual((120, 16_384), (TraineeSignUpRule.OldestAgeYears, TraineeSignUpRule.MaximumRequestBytes));
    }

    [TestMethod]
    public void SignUpIsClosedUntilAHouseAndBothSettingsOpenItAndFullOnceTheWeekIsTaken()
    {
        (bool HasHouse, int? PerWeek, int? Age, int ThisWeek, bool OpenFor, TraineeSignUpStatus Status, string Case)[] cases =
        [
            (false, 7, 19, 0, true, TraineeSignUpStatus.Closed, "no house, though both settings are filled"),
            (false, null, null, 0, false, TraineeSignUpStatus.Closed, "no house and nothing filled"),
            (true, null, null, 0, false, TraineeSignUpStatus.Closed, "a house with nothing filled, as it starts"),
            (true, null, 19, 0, false, TraineeSignUpStatus.Closed, "an empty number"),
            (true, 0, 19, 0, false, TraineeSignUpStatus.Closed, "zero: closed, not full"),
            (true, 0, 19, 4, false, TraineeSignUpStatus.Closed, "zero after a week that took some"),
            (true, 7, null, 0, false, TraineeSignUpStatus.Closed, "an empty age"),
            (true, 7, null, 9, false, TraineeSignUpStatus.Closed, "an empty age, whatever the week holds"),
            (true, 7, 19, 0, true, TraineeSignUpStatus.Open, "nobody yet this week"),
            (true, 7, 19, 6, true, TraineeSignUpStatus.Open, "below the number: one place left"),
            (true, 7, 19, 7, true, TraineeSignUpStatus.Full, "at the number: the last place is taken"),
            (true, 7, 19, 8, true, TraineeSignUpStatus.Full, "above it, after the number was lowered mid-week"),
            (true, 1, 18, 0, true, TraineeSignUpStatus.Open, "one a week, none yet"),
            (true, 1, 18, 1, true, TraineeSignUpStatus.Full, "one a week, taken"),
            (true, 10_000, 100, 9_999, true, TraineeSignUpStatus.Open, "the highest values a setting holds"),
        ];

        foreach (var (hasHouse, perWeek, age, thisWeek, openFor, status, name) in cases)
        {
            var settings = new HouseSettings(perWeek, age);

            Assert.AreEqual(openFor, TraineeSignUpRule.IsOpenFor(settings), name);
            Assert.AreEqual(status, TraineeSignUpRule.Status(hasHouse, settings, thisWeek), name);
        }

        Assert.IsFalse(TraineeSignUpRule.IsOpenFor(HouseSettings.Empty), "Switched off until the admin fills both.");
        Assert.ThrowsExactly<ArgumentNullException>(() => TraineeSignUpRule.IsOpenFor(null!));
        Assert.ThrowsExactly<ArgumentNullException>(() => TraineeSignUpRule.Status(true, null!, 0));
    }

    // ---- trainee sign-up v1: the house's week ----

    [TestMethod]
    public void InWinterTheHousesWeekTurnsAtBeirutsMidnightTwoHoursBeforeUtcs()
    {
        // Mon 9 Nov 2026 begins in Beirut at 22:00 UTC on Sun 8 Nov.
        AssertWeek(
            Beirut, DayOfWeek.Monday, Utc(2026, 11, 8, 21, 59, 59),
            today: Day(2026, 11, 8), startsOn: Day(2026, 11, 2), endsOnExclusive: Day(2026, 11, 9),
            startsAtUtc: Utc(2026, 11, 1, 22, 0), endsAtUtc: Utc(2026, 11, 8, 22, 0),
            "Sunday's last second still counts in the week before.");
        AssertWeek(
            Beirut, DayOfWeek.Monday, Utc(2026, 11, 8, 22, 0),
            today: Day(2026, 11, 9), startsOn: Day(2026, 11, 9), endsOnExclusive: Day(2026, 11, 16),
            startsAtUtc: Utc(2026, 11, 8, 22, 0), endsAtUtc: Utc(2026, 11, 15, 22, 0),
            "Monday's midnight opens the week, while UTC still reads Sunday.");
        AssertWeek(
            Beirut, DayOfWeek.Monday, Now,
            today: Today, startsOn: Day(2026, 11, 9), endsOnExclusive: Day(2026, 11, 16),
            startsAtUtc: Utc(2026, 11, 8, 22, 0), endsAtUtc: Utc(2026, 11, 15, 22, 0),
            "Thursday morning is the same week.");
        AssertWeek(
            Beirut, DayOfWeek.Monday, Utc(2026, 11, 15, 21, 59, 59),
            today: Day(2026, 11, 15), startsOn: Day(2026, 11, 9), endsOnExclusive: Day(2026, 11, 16),
            startsAtUtc: Utc(2026, 11, 8, 22, 0), endsAtUtc: Utc(2026, 11, 15, 22, 0),
            "And so is its last second.");

        // A week that starts on Saturday: Sat 7 Nov begins at 22:00 UTC on Fri 6 Nov.
        AssertWeek(
            Beirut, DayOfWeek.Saturday, Utc(2026, 11, 6, 21, 59, 59),
            today: Day(2026, 11, 6), startsOn: Day(2026, 10, 31), endsOnExclusive: Day(2026, 11, 7),
            startsAtUtc: Utc(2026, 10, 30, 22, 0), endsAtUtc: Utc(2026, 11, 6, 22, 0),
            "Friday's last second.");
        AssertWeek(
            Beirut, DayOfWeek.Saturday, Utc(2026, 11, 6, 22, 0),
            today: Day(2026, 11, 7), startsOn: Day(2026, 11, 7), endsOnExclusive: Day(2026, 11, 14),
            startsAtUtc: Utc(2026, 11, 6, 22, 0), endsAtUtc: Utc(2026, 11, 13, 22, 0),
            "Saturday's midnight.");

        // A week that starts on Sunday: Sun 8 Nov begins at 22:00 UTC on Sat 7 Nov.
        AssertWeek(
            Beirut, DayOfWeek.Sunday, Utc(2026, 11, 7, 21, 59, 59),
            today: Day(2026, 11, 7), startsOn: Day(2026, 11, 1), endsOnExclusive: Day(2026, 11, 8),
            startsAtUtc: Utc(2026, 10, 31, 22, 0), endsAtUtc: Utc(2026, 11, 7, 22, 0),
            "Saturday's last second.");
        AssertWeek(
            Beirut, DayOfWeek.Sunday, Utc(2026, 11, 7, 22, 0),
            today: Day(2026, 11, 8), startsOn: Day(2026, 11, 8), endsOnExclusive: Day(2026, 11, 15),
            startsAtUtc: Utc(2026, 11, 7, 22, 0), endsAtUtc: Utc(2026, 11, 14, 22, 0),
            "Sunday's midnight.");
    }

    [TestMethod]
    public void InSummerTheHousesWeekTurnsAtBeirutsMidnightThreeHoursBeforeUtcs()
    {
        // Mon 13 Jul 2026 begins in Beirut at 21:00 UTC on Sun 12 Jul.
        AssertWeek(
            Beirut, DayOfWeek.Monday, Utc(2026, 7, 12, 20, 59, 59),
            today: Day(2026, 7, 12), startsOn: Day(2026, 7, 6), endsOnExclusive: Day(2026, 7, 13),
            startsAtUtc: Utc(2026, 7, 5, 21, 0), endsAtUtc: Utc(2026, 7, 12, 21, 0),
            "Sunday's last second.");
        AssertWeek(
            Beirut, DayOfWeek.Monday, Utc(2026, 7, 12, 21, 0),
            today: Day(2026, 7, 13), startsOn: Day(2026, 7, 13), endsOnExclusive: Day(2026, 7, 20),
            startsAtUtc: Utc(2026, 7, 12, 21, 0), endsAtUtc: Utc(2026, 7, 19, 21, 0),
            "Monday's midnight, an hour earlier in UTC than in winter.");

        // Sat 11 Jul begins at 21:00 UTC on Fri 10 Jul.
        AssertWeek(
            Beirut, DayOfWeek.Saturday, Utc(2026, 7, 10, 20, 59, 59),
            today: Day(2026, 7, 10), startsOn: Day(2026, 7, 4), endsOnExclusive: Day(2026, 7, 11),
            startsAtUtc: Utc(2026, 7, 3, 21, 0), endsAtUtc: Utc(2026, 7, 10, 21, 0),
            "Friday's last second.");
        AssertWeek(
            Beirut, DayOfWeek.Saturday, Utc(2026, 7, 10, 21, 0),
            today: Day(2026, 7, 11), startsOn: Day(2026, 7, 11), endsOnExclusive: Day(2026, 7, 18),
            startsAtUtc: Utc(2026, 7, 10, 21, 0), endsAtUtc: Utc(2026, 7, 17, 21, 0),
            "Saturday's midnight.");

        // Sun 12 Jul begins at 21:00 UTC on Sat 11 Jul.
        AssertWeek(
            Beirut, DayOfWeek.Sunday, Utc(2026, 7, 11, 20, 59, 59),
            today: Day(2026, 7, 11), startsOn: Day(2026, 7, 5), endsOnExclusive: Day(2026, 7, 12),
            startsAtUtc: Utc(2026, 7, 4, 21, 0), endsAtUtc: Utc(2026, 7, 11, 21, 0),
            "Saturday's last second.");
        AssertWeek(
            Beirut, DayOfWeek.Sunday, Utc(2026, 7, 11, 21, 0),
            today: Day(2026, 7, 12), startsOn: Day(2026, 7, 12), endsOnExclusive: Day(2026, 7, 19),
            startsAtUtc: Utc(2026, 7, 11, 21, 0), endsAtUtc: Utc(2026, 7, 18, 21, 0),
            "Sunday's midnight.");
    }

    [TestMethod]
    public void AWeekHoldingAClockChangeIsAnHourShorterOrLongerAndNoInstantFallsBetweenTwoWeeks()
    {
        // Spring: the clocks skipped Sun 29 Mar 2026's first hour, so a Monday week holding it runs 167 hours.
        AssertWeek(
            Beirut, DayOfWeek.Monday, Utc(2026, 3, 25, 10, 0),
            today: Day(2026, 3, 25), startsOn: Day(2026, 3, 23), endsOnExclusive: Day(2026, 3, 30),
            startsAtUtc: Utc(2026, 3, 22, 22, 0), endsAtUtc: Utc(2026, 3, 29, 21, 0),
            "It starts at UTC+2 and ends at UTC+3.");

        // A Sunday week starts on that skipped midnight: it begins when the clocks land, at 01:00.
        AssertWeek(
            Beirut, DayOfWeek.Sunday, Utc(2026, 3, 28, 21, 59, 59),
            today: Day(2026, 3, 28), startsOn: Day(2026, 3, 22), endsOnExclusive: Day(2026, 3, 29),
            startsAtUtc: Utc(2026, 3, 21, 22, 0), endsAtUtc: Utc(2026, 3, 28, 22, 0),
            "23:59:59 on Saturday, the second before the clocks move.");
        AssertWeek(
            Beirut, DayOfWeek.Sunday, Utc(2026, 3, 28, 22, 0),
            today: Day(2026, 3, 29), startsOn: Day(2026, 3, 29), endsOnExclusive: Day(2026, 4, 5),
            startsAtUtc: Utc(2026, 3, 28, 22, 0), endsAtUtc: Utc(2026, 4, 4, 21, 0),
            "01:00 on Sunday, as the clocks land: the week before ended where this one starts.");

        // Autumn: Sat 24 Oct 2026 had 23:00 to midnight twice, so a Monday week holding it runs 169 hours.
        AssertWeek(
            Beirut, DayOfWeek.Monday, Utc(2026, 10, 21, 10, 0),
            today: Day(2026, 10, 21), startsOn: Day(2026, 10, 19), endsOnExclusive: Day(2026, 10, 26),
            startsAtUtc: Utc(2026, 10, 18, 21, 0), endsAtUtc: Utc(2026, 10, 25, 22, 0),
            "It starts at UTC+3 and ends at UTC+2.");

        // A Sunday week ends with that doubled hour: both passes are Saturday's, and Sunday starts once.
        AssertWeek(
            Beirut, DayOfWeek.Sunday, Utc(2026, 10, 24, 20, 30),
            today: Day(2026, 10, 24), startsOn: Day(2026, 10, 18), endsOnExclusive: Day(2026, 10, 25),
            startsAtUtc: Utc(2026, 10, 17, 21, 0), endsAtUtc: Utc(2026, 10, 24, 22, 0),
            "23:30 on Saturday, the first time.");
        AssertWeek(
            Beirut, DayOfWeek.Sunday, Utc(2026, 10, 24, 21, 59, 59),
            today: Day(2026, 10, 24), startsOn: Day(2026, 10, 18), endsOnExclusive: Day(2026, 10, 25),
            startsAtUtc: Utc(2026, 10, 17, 21, 0), endsAtUtc: Utc(2026, 10, 24, 22, 0),
            "23:59:59 on Saturday, the second time.");
        AssertWeek(
            Beirut, DayOfWeek.Sunday, Utc(2026, 10, 24, 22, 0),
            today: Day(2026, 10, 25), startsOn: Day(2026, 10, 25), endsOnExclusive: Day(2026, 11, 1),
            startsAtUtc: Utc(2026, 10, 24, 22, 0), endsAtUtc: Utc(2026, 10, 31, 22, 0),
            "Sunday's one midnight.");
    }

    [TestMethod]
    public void TheWeekIsReadInTheHousesOwnZoneAndFromItsOwnFirstDay()
    {
        // The same instant, 22:00 UTC on Sun 8 Nov 2026: Monday in Beirut, still Sunday in a house that keeps UTC.
        AssertWeek(
            TimeZoneInfo.Utc, DayOfWeek.Monday, Utc(2026, 11, 8, 22, 0),
            today: Day(2026, 11, 8), startsOn: Day(2026, 11, 2), endsOnExclusive: Day(2026, 11, 9),
            startsAtUtc: Utc(2026, 11, 2, 0, 0), endsAtUtc: Utc(2026, 11, 9, 0, 0),
            "A house on UTC.");

        // And one Thursday morning falls in three different weeks by the day the house's week starts on.
        Assert.AreEqual(Day(2026, 11, 9), TraineeSignUpRule.WeekOf(Now, Beirut, DayOfWeek.Monday).StartsOn);
        Assert.AreEqual(Day(2026, 11, 7), TraineeSignUpRule.WeekOf(Now, Beirut, DayOfWeek.Saturday).StartsOn);
        Assert.AreEqual(Day(2026, 11, 8), TraineeSignUpRule.WeekOf(Now, Beirut, DayOfWeek.Sunday).StartsOn);
        Assert.AreEqual(Today, TraineeSignUpRule.WeekOf(Now, Beirut, DayOfWeek.Thursday).StartsOn, "Its own first day.");
        Assert.AreEqual(Day(2026, 11, 6), TraineeSignUpRule.WeekOf(Now, Beirut, DayOfWeek.Friday).StartsOn, "Six days in.");

        Assert.ThrowsExactly<ArgumentNullException>(() => TraineeSignUpRule.WeekOf(Now, null!, DayOfWeek.Monday));
    }

    [TestMethod]
    public void AHouseDayStartsAtItsMidnightAndAMidnightTheClocksSkipStartsWhenTheyLand()
    {
        Assert.AreEqual(Utc(2026, 11, 11, 22, 0), TraineeSignUpRule.StartOfDayUtc(Today, Beirut), "Winter, UTC+2.");
        Assert.AreEqual(Utc(2026, 7, 12, 21, 0), TraineeSignUpRule.StartOfDayUtc(Day(2026, 7, 13), Beirut), "Summer, UTC+3.");
        Assert.AreEqual(TimeSpan.Zero, TraineeSignUpRule.StartOfDayUtc(Today, Beirut).Offset, "Npgsql takes UTC alone.");

        // Beirut, the days money received v1's tests read (B4b): 29 Mar 2026 had no 00:00 to 01:00, so the day began
        // when the clocks landed on 01:00 (UTC+3); 24 Oct had 23:00 to midnight twice, and 25 Oct began once, at UTC+2.
        Assert.AreEqual(Utc(2026, 3, 28, 22, 0), TraineeSignUpRule.StartOfDayUtc(Day(2026, 3, 29), Beirut));
        Assert.AreEqual(Utc(2026, 3, 29, 21, 0), TraineeSignUpRule.StartOfDayUtc(Day(2026, 3, 30), Beirut));
        Assert.AreEqual(Utc(2026, 10, 23, 21, 0), TraineeSignUpRule.StartOfDayUtc(Day(2026, 10, 24), Beirut));
        Assert.AreEqual(Utc(2026, 10, 24, 22, 0), TraineeSignUpRule.StartOfDayUtc(Day(2026, 10, 25), Beirut));

        Assert.ThrowsExactly<ArgumentNullException>(() => TraineeSignUpRule.StartOfDayUtc(Today, null!));
    }

    [TestMethod]
    public void AMidnightTheClocksPassTwiceStartsTheDayAtItsFirstPass()
    {
        // A made-up zone whose clocks move at midnight on a month's first day: forward on Wed 1 Apr 2026 (no 00:00 to
        // 01:00), back on Thu 1 Oct 2026 (00:00 to 01:00 twice).
        var zone = MidnightChangesZone();
        Assert.IsTrue(zone.IsInvalidTime(new DateTime(2026, 4, 1, 0, 0, 0)), "The test zone skips April's first midnight.");
        Assert.IsTrue(zone.IsAmbiguousTime(new DateTime(2026, 10, 1, 0, 0, 0)), "The test zone doubles October's.");

        Assert.AreEqual(Utc(2026, 3, 31, 22, 0), TraineeSignUpRule.StartOfDayUtc(Day(2026, 4, 1), zone));
        Assert.AreEqual(Utc(2026, 9, 30, 21, 0), TraineeSignUpRule.StartOfDayUtc(Day(2026, 10, 1), zone));

        // A week that starts on the skipped midnight begins as the clocks land.
        AssertWeek(
            zone, DayOfWeek.Wednesday, Utc(2026, 3, 31, 21, 59, 59),
            today: Day(2026, 3, 31), startsOn: Day(2026, 3, 25), endsOnExclusive: Day(2026, 4, 1),
            startsAtUtc: Utc(2026, 3, 24, 22, 0), endsAtUtc: Utc(2026, 3, 31, 22, 0),
            "23:59:59 on Tuesday.");
        AssertWeek(
            zone, DayOfWeek.Wednesday, Utc(2026, 3, 31, 22, 0),
            today: Day(2026, 4, 1), startsOn: Day(2026, 4, 1), endsOnExclusive: Day(2026, 4, 8),
            startsAtUtc: Utc(2026, 3, 31, 22, 0), endsAtUtc: Utc(2026, 4, 7, 21, 0),
            "01:00 on Wednesday.");

        // A week that starts on the doubled midnight begins at its first pass, so a sign-up in either pass of that
        // hour counts in the new week and one a second before in the old.
        AssertWeek(
            zone, DayOfWeek.Thursday, Utc(2026, 9, 30, 20, 59, 59),
            today: Day(2026, 9, 30), startsOn: Day(2026, 9, 24), endsOnExclusive: Day(2026, 10, 1),
            startsAtUtc: Utc(2026, 9, 23, 21, 0), endsAtUtc: Utc(2026, 9, 30, 21, 0),
            "23:59:59 on Wednesday.");
        AssertWeek(
            zone, DayOfWeek.Thursday, Utc(2026, 9, 30, 21, 30),
            today: Day(2026, 10, 1), startsOn: Day(2026, 10, 1), endsOnExclusive: Day(2026, 10, 8),
            startsAtUtc: Utc(2026, 9, 30, 21, 0), endsAtUtc: Utc(2026, 10, 7, 22, 0),
            "00:30 on Thursday, the first pass.");
        AssertWeek(
            zone, DayOfWeek.Thursday, Utc(2026, 9, 30, 22, 30),
            today: Day(2026, 10, 1), startsOn: Day(2026, 10, 1), endsOnExclusive: Day(2026, 10, 8),
            startsAtUtc: Utc(2026, 9, 30, 21, 0), endsAtUtc: Utc(2026, 10, 7, 22, 0),
            "00:30 on Thursday, the second pass.");
    }

    [TestMethod]
    public void TheHousesDayBeginsWhenAWorkspacesMoneyDayDoesOnEveryDayOf2026()
    {
        // Two modules keep the same reading of a workspace day (this rule, and money received v1, SUB-016), since a
        // module may not use another's. If one changes, this says so.
        var zones = new[] { Beirut, MidnightChangesZone(), TimeZoneInfo.Utc };
        foreach (var zone in zones)
        {
            for (var day = Day(2026, 1, 1); day < Day(2027, 1, 1); day = day.AddDays(1))
            {
                Assert.AreEqual(
                    MoneyReceivedPolicy.StartOfDayUtc(day, zone),
                    TraineeSignUpRule.StartOfDayUtc(day, zone),
                    $"{zone.Id} {day:yyyy-MM-dd}");
            }
        }
    }

    // ---- trainee sign-up v1: who is old enough ----

    [TestMethod]
    public void TheBirthdayItselfIsOldEnoughAndTheDayBeforeItIsTooYoung()
    {
        (DateOnly Birth, int Age, DateOnly HouseToday, TraineeBirthDateCheck Expected, string Case)[] cases =
        [
            (Day(2008, 11, 12), 18, Today, TraineeBirthDateCheck.Valid, "18 today"),
            (Day(2008, 11, 13), 18, Today, TraineeBirthDateCheck.TooYoung, "18 tomorrow"),
            (Day(2008, 11, 11), 18, Today, TraineeBirthDateCheck.Valid, "18 yesterday"),
            (Day(2008, 12, 31), 18, Today, TraineeBirthDateCheck.TooYoung, "18 later this year"),
            (Day(1987, 5, 3), 18, Today, TraineeBirthDateCheck.Valid, "39"),
            (Today, 18, Today, TraineeBirthDateCheck.TooYoung, "born today: a real date, and too young"),

            // A house that asks for more than 18.
            (Day(2005, 11, 12), 21, Today, TraineeBirthDateCheck.Valid, "21 today in a house that asks for 21"),
            (Day(2005, 11, 13), 21, Today, TraineeBirthDateCheck.TooYoung, "21 tomorrow in a house that asks for 21"),
            (Day(2005, 11, 13), 18, Today, TraineeBirthDateCheck.Valid, "the same person where 18 is enough"),
            (Day(2003, 11, 13), 23, Today, TraineeBirthDateCheck.TooYoung, "23 tomorrow in a house that asks for 23"),
            (Day(1926, 11, 12), 100, Today, TraineeBirthDateCheck.Valid, "100 today, the highest age a house can ask"),
            (Day(1926, 11, 13), 100, Today, TraineeBirthDateCheck.TooYoung, "100 tomorrow"),
        ];

        foreach (var (birth, age, houseToday, expected, name) in cases)
        {
            Assert.AreEqual(expected, TraineeSignUpRule.CheckBirthDate(birth, age, houseToday), name);
        }
    }

    [TestMethod]
    public void SomeoneBornOnTheTwentyNinthOfFebruaryReachesAnAgeOnTheTwentyEighthOfAYearWithoutOne()
    {
        var leapDay = Day(2008, 2, 29);

        // 2026 has no 29 February: 18 is reached on the 28th.
        Assert.AreEqual(TraineeBirthDateCheck.TooYoung, TraineeSignUpRule.CheckBirthDate(leapDay, 18, Day(2026, 2, 27)));
        Assert.AreEqual(TraineeBirthDateCheck.Valid, TraineeSignUpRule.CheckBirthDate(leapDay, 18, Day(2026, 2, 28)));
        Assert.AreEqual(TraineeBirthDateCheck.Valid, TraineeSignUpRule.CheckBirthDate(leapDay, 18, Day(2026, 3, 1)));

        // 2028 has one: 20 is reached on the day itself.
        Assert.AreEqual(TraineeBirthDateCheck.TooYoung, TraineeSignUpRule.CheckBirthDate(leapDay, 20, Day(2028, 2, 28)));
        Assert.AreEqual(TraineeBirthDateCheck.Valid, TraineeSignUpRule.CheckBirthDate(leapDay, 20, Day(2028, 2, 29)));

        // And someone born the day before a leap day never waits for one.
        Assert.AreEqual(TraineeBirthDateCheck.Valid, TraineeSignUpRule.CheckBirthDate(Day(2008, 2, 28), 18, Day(2026, 2, 28)));
        Assert.AreEqual(TraineeBirthDateCheck.TooYoung, TraineeSignUpRule.CheckBirthDate(Day(2008, 3, 1), 18, Day(2026, 2, 28)));
    }

    [TestMethod]
    public void ADayStillToComeOrMoreThanAHundredAndTwentyYearsAgoIsOutOfRange()
    {
        (DateOnly Birth, int Age, TraineeBirthDateCheck Expected, string Case)[] cases =
        [
            (Today.AddDays(1), 18, TraineeBirthDateCheck.OutOfRange, "tomorrow"),
            (Day(2027, 1, 1), 18, TraineeBirthDateCheck.OutOfRange, "next year"),
            (Day(9999, 12, 31), 18, TraineeBirthDateCheck.OutOfRange, "the last day there is"),
            (Day(1906, 11, 12), 18, TraineeBirthDateCheck.Valid, "120 years ago to the day"),
            (Day(1906, 11, 11), 18, TraineeBirthDateCheck.OutOfRange, "a day more than 120 years ago"),
            (Day(1900, 1, 1), 18, TraineeBirthDateCheck.OutOfRange, "1900"),
            (Day(1, 1, 1), 18, TraineeBirthDateCheck.OutOfRange, "the first day there is"),
            // Out of range is said before too young or old enough, whatever the house's age.
            (Today.AddDays(1), 100, TraineeBirthDateCheck.OutOfRange, "tomorrow, in a house that asks for 100"),
            (Day(1906, 11, 11), 100, TraineeBirthDateCheck.OutOfRange, "over 120, in a house that asks for 100"),
        ];

        foreach (var (birth, age, expected, name) in cases)
        {
            Assert.AreEqual(expected, TraineeSignUpRule.CheckBirthDate(birth, age, Today), name);
        }
    }

    [TestMethod]
    public void AgeIsReadOnTheHousesDayWhileUtcStillReadsTheDayBefore()
    {
        var birthday = Day(2008, 11, 12);
        var lastSecond = TraineeSignUpRule.WeekOf(Utc(2026, 11, 11, 21, 59, 59), Beirut, DayOfWeek.Monday);
        var midnight = TraineeSignUpRule.WeekOf(Utc(2026, 11, 11, 22, 0), Beirut, DayOfWeek.Monday);

        Assert.AreEqual(Day(2026, 11, 11), lastSecond.Today);
        Assert.AreEqual(TraineeBirthDateCheck.TooYoung, TraineeSignUpRule.CheckBirthDate(birthday, 18, lastSecond.Today));
        Assert.AreEqual(Today, midnight.Today);
        Assert.AreEqual(TraineeBirthDateCheck.Valid, TraineeSignUpRule.CheckBirthDate(birthday, 18, midnight.Today));
    }

    [TestMethod]
    public void NamesAreTrimmedRequiredAndAHundredCharactersAtMost()
    {
        Assert.AreEqual(("Lina", "Haddad"), TraineeSignUpRule.NormalizeNames("  Lina ", "\tHaddad\r\n"));
        Assert.AreEqual(
            ("Jean Paul", "El Khoury"),
            TraineeSignUpRule.NormalizeNames("Jean Paul", " El Khoury "),
            "Only the ends are trimmed.");

        // A hundred characters are kept whole, counted after the trim.
        var longest = new string('a', TraineeSignUp.NameMaximumLength);
        Assert.AreEqual(100, longest.Length);
        Assert.AreEqual((longest, longest), TraineeSignUpRule.NormalizeNames($"  {longest}  ", longest));

        static string Refused(string? firstName, string? lastName) =>
            Assert.ThrowsExactly<ArgumentException>(() => TraineeSignUpRule.NormalizeNames(firstName, lastName)).Message;

        Assert.AreEqual(NamesTooLongSentence, Refused(longest + "a", "Haddad"));
        Assert.AreEqual(NamesTooLongSentence, Refused("Lina", longest + "a"));

        (string? FirstName, string? LastName)[] missing =
        [
            (null, "Haddad"), ("", "Haddad"), ("   ", "Haddad"), ("\t\r\n", "Haddad"),
            ("Lina", null), ("Lina", ""), ("Lina", "  "),
            (null, null), ("", ""),
        ];
        foreach (var (firstName, lastName) in missing)
        {
            Assert.AreEqual(NamesRequiredSentence, Refused(firstName, lastName), $"'{firstName}' '{lastName}'");
        }

        // The profile a confirmed sign-up becomes keeps a name of that length too.
        var profile = ClientProfile.CreateForHouseSignUp(
            HouseId, TraineeUserId, HouseCoachUserId, longest, longest, "lina.haddad@oakhall.example", null);
        Assert.AreEqual((100, 100), (profile.FirstName.Length, profile.LastName.Length));
    }

    // ---- a sign-up's row (CLI-024) ----

    [TestMethod]
    public void ANewAccountsSignUpWaitsWithTheNamesAndBirthDateThePersonTyped()
    {
        var signUp = TraineeSignUp.Request(HouseId, TraineeUserId, "  Lina ", " Haddad\t", Day(2001, 5, 3), Now);

        Assert.IsTrue(signUp.IsPending);
        Assert.AreEqual(HouseId, signUp.TenantId);
        Assert.AreEqual(TraineeUserId, signUp.UserId);
        Assert.AreEqual("Lina", signUp.FirstName);
        Assert.AreEqual("Haddad", signUp.LastName);
        Assert.AreEqual(Day(2001, 5, 3), signUp.BirthDate);
        Assert.AreEqual(Now, signUp.RequestedAtUtc);
        Assert.IsNull(signUp.ConfirmedAtUtc);
        Assert.IsNull(signUp.ClientProfileId, "No profile exists until the email is confirmed.");

        // What it keeps is what a profile keeps, so the same names are refused here.
        Assert.ThrowsExactly<ArgumentException>(() =>
            TraineeSignUp.Request(HouseId, TraineeUserId, " ", "Haddad", Day(2001, 5, 3), Now));
        Assert.ThrowsExactly<ArgumentException>(() =>
            TraineeSignUp.Request(HouseId, TraineeUserId, "Lina", new string('h', 101), Day(2001, 5, 3), Now));
    }

    [TestMethod]
    public void AConfirmedAccountJoinsAtOnceAndNothingTypedIsKept()
    {
        var joined = TraineeSignUp.Joined(HouseId, TraineeUserId, ProfileId, Now);

        Assert.IsFalse(joined.IsPending);
        Assert.AreEqual(HouseId, joined.TenantId);
        Assert.AreEqual(TraineeUserId, joined.UserId);
        Assert.AreEqual(ProfileId, joined.ClientProfileId);
        Assert.AreEqual(Now, joined.RequestedAtUtc);
        Assert.AreEqual(Now, joined.ConfirmedAtUtc, "The week's count reads the moment they joined.");
        Assert.IsNull(joined.FirstName);
        Assert.IsNull(joined.LastName);
        Assert.IsNull(joined.BirthDate);

        Assert.ThrowsExactly<InvalidOperationException>(() => joined.Confirm(Guid.NewGuid(), Now.AddMinutes(1)));
        Assert.AreEqual(ProfileId, joined.ClientProfileId);
    }

    [TestMethod]
    public void ConfirmingASignUpNamesItsProfileAndClearsWhatWasTyped()
    {
        var signUp = TraineeSignUp.Request(HouseId, TraineeUserId, "Lina", "Haddad", Day(2001, 5, 3), Now);
        var confirmedAt = Now.AddHours(5);

        signUp.Confirm(ProfileId, confirmedAt);

        Assert.IsFalse(signUp.IsPending);
        Assert.AreEqual(ProfileId, signUp.ClientProfileId);
        Assert.AreEqual(confirmedAt, signUp.ConfirmedAtUtc);
        Assert.IsNull(signUp.FirstName, "The typed details live on the profile alone from here.");
        Assert.IsNull(signUp.LastName);
        Assert.IsNull(signUp.BirthDate);
        Assert.AreEqual(Now, signUp.RequestedAtUtc, "When it was asked for is kept beside when it took its place.");
        Assert.AreEqual(TraineeUserId, signUp.UserId);
        Assert.AreEqual(HouseId, signUp.TenantId);
    }

    [TestMethod]
    public void ASignUpIsConfirmedOnce()
    {
        var signUp = TraineeSignUp.Request(HouseId, TraineeUserId, "Lina", "Haddad", Day(2001, 5, 3), Now);
        signUp.Confirm(ProfileId, Now.AddHours(5));

        var again = Assert.ThrowsExactly<InvalidOperationException>(() => signUp.Confirm(Guid.NewGuid(), Now.AddHours(6)));

        Assert.AreEqual("This sign-up was already confirmed.", again.Message);
        Assert.AreEqual(ProfileId, signUp.ClientProfileId, "The first confirmation stands.");
        Assert.AreEqual(Now.AddHours(5), signUp.ConfirmedAtUtc);
    }

    [TestMethod]
    public void ASignUpNeedsItsHouseItsAccountAndItsProfile()
    {
        var birthDate = Day(2001, 5, 3);

        Assert.ThrowsExactly<ArgumentException>(() => TraineeSignUp.Request(HouseId, Guid.Empty, "Lina", "Haddad", birthDate, Now));
        Assert.ThrowsExactly<ArgumentException>(() => TraineeSignUp.Request(Guid.Empty, TraineeUserId, "Lina", "Haddad", birthDate, Now));
        Assert.ThrowsExactly<ArgumentException>(() => TraineeSignUp.Joined(HouseId, Guid.Empty, ProfileId, Now));
        Assert.ThrowsExactly<ArgumentException>(() => TraineeSignUp.Joined(HouseId, TraineeUserId, Guid.Empty, Now));
        Assert.ThrowsExactly<ArgumentException>(() => TraineeSignUp.Joined(Guid.Empty, TraineeUserId, ProfileId, Now));

        // A confirmation that names no profile is refused and leaves the sign-up waiting, with what was typed.
        var waiting = TraineeSignUp.Request(HouseId, TraineeUserId, "Lina", "Haddad", birthDate, Now);
        Assert.ThrowsExactly<ArgumentException>(() => waiting.Confirm(Guid.Empty, Now.AddHours(1)));
        Assert.IsTrue(waiting.IsPending);
        Assert.IsNull(waiting.ConfirmedAtUtc);
        Assert.IsNull(waiting.ClientProfileId);
        Assert.AreEqual("Lina", waiting.FirstName);
        Assert.AreEqual("Haddad", waiting.LastName);
        Assert.AreEqual(birthDate, waiting.BirthDate);

        waiting.Confirm(ProfileId, Now.AddHours(2));
        Assert.IsFalse(waiting.IsPending);
    }

    // ---- the sweep's settings (CLI-025) ----

    [TestMethod]
    public void TheSweepsSettingsPassAsShippedAndAtEachBound()
    {
        // Two days: a confirmation link works for one, so a late email still has room and the address is then free.
        var shipped = new TraineeSignUpOptions();
        Assert.AreEqual(
            ("TraineeSignUps", 2, true, 3_600),
            (TraineeSignUpOptions.SectionName, shipped.RemoveUnconfirmedAfterDays, shipped.SweepEnabled, shipped.SweepIntervalSeconds));
        Assert.IsNull(shipped.Validate());

        (int Days, int Seconds, string? Refusal)[] cases =
        [
            (1, 3_600, null),
            (90, 3_600, null),
            (11, 60, null),
            (11, 86_400, null),
            (1, 60, null),
            (90, 86_400, null),
            (0, 3_600, SweepDaysSentence),
            (91, 3_600, SweepDaysSentence),
            (-1, 3_600, SweepDaysSentence),
            (int.MinValue, 3_600, SweepDaysSentence),
            (int.MaxValue, 3_600, SweepDaysSentence),
            (11, 59, SweepSecondsSentence),
            (11, 86_401, SweepSecondsSentence),
            (11, 0, SweepSecondsSentence),
            (11, -1, SweepSecondsSentence),
            (11, int.MaxValue, SweepSecondsSentence),
            // With both wrong, the first is the one named.
            (0, 59, SweepDaysSentence),
            (91, 86_401, SweepDaysSentence),
        ];

        foreach (var (days, seconds, refusal) in cases)
        {
            var options = new TraineeSignUpOptions { RemoveUnconfirmedAfterDays = days, SweepIntervalSeconds = seconds };

            Assert.AreEqual(refusal, options.Validate(), $"{days} days, {seconds} seconds");
        }

        // A sweep switched off still has to read: a host with a wrong setting does not start.
        var off = new TraineeSignUpOptions { SweepEnabled = false, RemoveUnconfirmedAfterDays = 0 };
        Assert.AreEqual(SweepDaysSentence, off.Validate());
        Assert.IsNull(new TraineeSignUpOptions { SweepEnabled = false }.Validate());
    }

    [TestMethod]
    public void ARefusedSweepSettingIsNamedAndItsValueIsNeverQuoted()
    {
        (int Days, int Seconds, string Named, string NotNamed, string Wrong)[] cases =
        [
            (4_321, 3_600, "TraineeSignUps:RemoveUnconfirmedAfterDays", "SweepIntervalSeconds", "4321"),
            (-37, 3_600, "TraineeSignUps:RemoveUnconfirmedAfterDays", "SweepIntervalSeconds", "37"),
            (11, 37, "TraineeSignUps:SweepIntervalSeconds", "RemoveUnconfirmedAfterDays", "37"),
            (11, 987_654, "TraineeSignUps:SweepIntervalSeconds", "RemoveUnconfirmedAfterDays", "987654"),
            (11, -53, "TraineeSignUps:SweepIntervalSeconds", "RemoveUnconfirmedAfterDays", "53"),
        ];

        foreach (var (days, seconds, named, notNamed, wrong) in cases)
        {
            var refusal = new TraineeSignUpOptions { RemoveUnconfirmedAfterDays = days, SweepIntervalSeconds = seconds }.Validate();

            Assert.IsNotNull(refusal, $"{days} days, {seconds} seconds");
            Assert.Contains(named, refusal);
            Assert.DoesNotContain(notNamed, refusal);
            Assert.DoesNotContain(wrong, refusal, "The refusal reaches a log line: it never carries what was set.");
        }
    }

    // ---- coach attention v9 (CLI-018, CLI-026): a self-directed trainee raises nothing ----

    [TestMethod]
    public void SignalsThatRaiseEveryKindRaiseNothingOnceTheClientIsSelfDirected()
    {
        // Three kinds each need the plan to be one way: a plan ends soon only while it runs, a renewal is asked only
        // once it ended, and no plan is no plan. Every other kind comes whatever the plan does, so one signals value
        // raises all eleven across the seven plan states, and at most nine at once.
        const string always = "SessionsRunningOut, WeekNotShared, MissedSessions, CheckInOverdue, NoProgram, WeightsToApply";
        (ClientPlanState State, string Raised)[] cases =
        [
            (ClientPlanState.Running, $"CheckInToReview, UnreadMessages, PlanEndingSoon, {always}"),
            (ClientPlanState.Paused, $"CheckInToReview, UnreadMessages, {always}"),
            (ClientPlanState.PaymentDue, $"CheckInToReview, UnreadMessages, {always}"),
            (ClientPlanState.NotStarted, $"CheckInToReview, UnreadMessages, {always}"),
            (ClientPlanState.Ended, $"CheckInToReview, UnreadMessages, RenewalRequested, {always}"),
            (ClientPlanState.None, $"CheckInToReview, UnreadMessages, NoPlan, {always}"),
            (ClientPlanState.Blocked, $"CheckInToReview, UnreadMessages, {always}"),
        ];
        CollectionAssert.AreEqual(
            Enum.GetValues<ClientPlanState>(), cases.Select(item => item.State).ToArray(), "Every plan state is a case.");

        var raisedSomewhere = new HashSet<CoachAttentionKind>();
        foreach (var (state, raised) in cases)
        {
            // Without the flag the signals raise what they raised under version 8.
            var coached = CoachAttentionPolicy.Flags(Loud(), state, Today);
            Assert.AreEqual(raised, string.Join(", ", coached), state.ToString());
            Assert.AreEqual(ClientOverviewStatus.NeedsAttention, CoachAttentionPolicy.Status(coached, state), state.ToString());
            raisedSomewhere.UnionWith(coached);

            // With it, nothing asks the house's staff to act.
            Assert.IsEmpty(CoachAttentionPolicy.Flags(Loud() with { SelfDirected = true }, state, Today), state.ToString());
        }

        CollectionAssert.AreEquivalent(
            Enum.GetValues<CoachAttentionKind>(), raisedSomewhere.ToArray(), "The signals raise every kind there is.");
    }

    [TestMethod]
    public void EachSignalAloneRaisesItsKindForACoachedClientAndNothingForASelfDirectedOne()
    {
        (ClientAttentionSignals Signals, ClientPlanState State, CoachAttentionKind Kind)[] cases =
        [
            (Quiet() with { CheckInsToReview = 1 }, ClientPlanState.Running, CoachAttentionKind.CheckInToReview),
            (Quiet() with { UnreadMessages = 1 }, ClientPlanState.Running, CoachAttentionKind.UnreadMessages),
            (Quiet() with { RenewalRequestedOn = Today }, ClientPlanState.Ended, CoachAttentionKind.RenewalRequested),
            (Quiet() with { JoinedOn = Today }, ClientPlanState.None, CoachAttentionKind.NoPlan),
            (Quiet() with { PlanLastDay = Today }, ClientPlanState.Running, CoachAttentionKind.PlanEndingSoon),
            (Quiet() with { SessionsLeft = 0 }, ClientPlanState.Running, CoachAttentionKind.SessionsRunningOut),
            (Quiet() with { HasWeekToShare = true }, ClientPlanState.Running, CoachAttentionKind.WeekNotShared),
            (Quiet() with { MissedSinceLastWorkout = 2 }, ClientPlanState.Running, CoachAttentionKind.MissedSessions),
            (Quiet() with { CheckInsOverdue = 1 }, ClientPlanState.Running, CoachAttentionKind.CheckInOverdue),
            (Quiet() with { HasNoProgram = true }, ClientPlanState.Running, CoachAttentionKind.NoProgram),
            (Quiet() with { WeightsToApply = 1 }, ClientPlanState.Running, CoachAttentionKind.WeightsToApply),
        ];
        CollectionAssert.AreEquivalent(
            Enum.GetValues<CoachAttentionKind>(), cases.Select(item => item.Kind).ToArray(), "Every kind is a case.");

        foreach (var (signals, state, kind) in cases)
        {
            CollectionAssert.AreEqual(new[] { kind }, CoachAttentionPolicy.Flags(signals, state, Today).ToArray(), kind.ToString());
            Assert.IsEmpty(CoachAttentionPolicy.Flags(signals with { SelfDirected = true }, state, Today), kind.ToString());
        }
    }

    [TestMethod]
    public void ASelfDirectedClientsStatusIsThePlansOwn()
    {
        (ClientPlanState State, ClientOverviewStatus Status, ClientPlanStatus PlanStatus)[] cases =
        [
            (ClientPlanState.Running, ClientOverviewStatus.OnTrack, ClientPlanStatus.OnTrack),
            (ClientPlanState.Paused, ClientOverviewStatus.Paused, ClientPlanStatus.Paused),
            (ClientPlanState.PaymentDue, ClientOverviewStatus.NoActivePlan, ClientPlanStatus.NoActivePlan),
            (ClientPlanState.NotStarted, ClientOverviewStatus.NoActivePlan, ClientPlanStatus.NoActivePlan),
            (ClientPlanState.Ended, ClientOverviewStatus.NoActivePlan, ClientPlanStatus.NoActivePlan),
            (ClientPlanState.None, ClientOverviewStatus.NoActivePlan, ClientPlanStatus.NoActivePlan),
            (ClientPlanState.Blocked, ClientOverviewStatus.NoActivePlan, ClientPlanStatus.AccessBlocked),
        ];
        CollectionAssert.AreEqual(
            Enum.GetValues<ClientPlanState>(), cases.Select(item => item.State).ToArray(), "Every plan state is a case.");

        foreach (var (state, status, planStatus) in cases)
        {
            // The loudest signals there are, and none at all: a self-directed client reads the same either way.
            foreach (var signals in new[] { Loud() with { SelfDirected = true }, Quiet() with { SelfDirected = true } })
            {
                var flags = CoachAttentionPolicy.Flags(signals, state, Today);

                Assert.AreEqual(status, CoachAttentionPolicy.Status(flags, state), state.ToString());
                Assert.AreEqual(planStatus, CoachAttentionPolicy.PlanStatus(flags, state), state.ToString());
            }
        }

        // A plan three days from its end reads Ending soon for a coached client, whose coach sells the next one; a
        // self-directed trainee's is On track, since nobody on the staff is asked to.
        var ending = Quiet() with { PlanLastDay = Today.AddDays(3) };
        Assert.AreEqual(
            ClientOverviewStatus.EndingSoon,
            CoachAttentionPolicy.Status(CoachAttentionPolicy.Flags(ending, ClientPlanState.Running, Today), ClientPlanState.Running));
        Assert.AreEqual(
            ClientOverviewStatus.OnTrack,
            CoachAttentionPolicy.Status(
                CoachAttentionPolicy.Flags(ending with { SelfDirected = true }, ClientPlanState.Running, Today),
                ClientPlanState.Running));
    }

    [TestMethod]
    public void AClientIsNotSelfDirectedUnlessSaid()
    {
        Assert.IsFalse(Quiet().SelfDirected);
        Assert.IsFalse(Loud().SelfDirected);
        Assert.IsTrue((Quiet() with { SelfDirected = true }).SelfDirected);

        // The flag was added last and optional to each record that carries it, so a reader that says nothing of it
        // keeps a coached client.
        Assert.IsTrue(DefaultsToFalse(typeof(ClientAttentionSignals), nameof(ClientAttentionSignals.SelfDirected)));
        Assert.IsTrue(DefaultsToFalse(typeof(ClientOverviewRow), nameof(ClientOverviewRow.SelfDirected)));
        Assert.IsTrue(DefaultsToFalse(typeof(ClientSelfProfile), nameof(ClientSelfProfile.SelfDirected)));
    }

    // ---- who is asked which document (CLI-010) ----

    [TestMethod]
    public void TheConsumerTermsAreATraineesAloneAndTheHealthConsentAClientsAlone()
    {
        // Kinds and audiences are stored and sent by name and number: neither is ever given to another.
        Assert.AreEqual(
            "TermsOfService 1, PrivacyPolicy 2, HealthIntakeConsent 3, ConsumerTerms 4",
            string.Join(", ", Enum.GetValues<LegalDocumentKind>().Select(kind => $"{kind} {(int)kind}")));
        Assert.AreEqual(
            "Owner 1, Coach 2, Client 3, Trainee 4",
            string.Join(", ", Enum.GetValues<LegalAudience>().Select(audience => $"{audience} {(int)audience}")));

        Assert.AreEqual(
            "TermsOfService: Owner, Coach, Client, Trainee; PrivacyPolicy: Owner, Coach, Client, Trainee; " +
            "HealthIntakeConsent: Client; ConsumerTerms: Trainee",
            string.Join("; ", Enum.GetValues<LegalDocumentKind>().Select(kind =>
                $"{kind}: {string.Join(", ", Enum.GetValues<LegalAudience>().Where(audience => LegalAcceptanceRule.AppliesTo(kind, audience)))}")));

        // A kind this rule does not know is asked of nobody.
        foreach (var audience in Enum.GetValues<LegalAudience>())
        {
            Assert.IsFalse(LegalAcceptanceRule.AppliesTo((LegalDocumentKind)5, audience), audience.ToString());
            Assert.IsFalse(LegalAcceptanceRule.AppliesTo((LegalDocumentKind)0, audience), audience.ToString());
        }
    }

    [TestMethod]
    public void ATraineeIsShownTermsPrivacyAndTheConsumerTermsAndNeverTheHealthConsent()
    {
        var terms = Current(LegalDocumentKind.TermsOfService, LegalConsentContext.Platform);
        var privacy = Current(LegalDocumentKind.PrivacyPolicy, LegalConsentContext.Platform);
        var consumer = Current(LegalDocumentKind.ConsumerTerms, LegalConsentContext.Workspace);
        var health = Current(LegalDocumentKind.HealthIntakeConsent, LegalConsentContext.Workspace);
        CurrentLegalDocument[] current = [health, consumer, privacy, terms];
        var none = new HashSet<Guid>();

        CollectionAssert.AreEqual(
            new[] { terms, privacy, consumer },
            LegalAcceptanceRule.ToShow(current, LegalAudience.Trainee, none).ToArray(),
            "A trainee's health is asked only on Max (decision 33), so its consent is not theirs at sign-up.");

        // Everyone else is shown what they were shown before the consumer terms existed.
        CollectionAssert.AreEqual(
            new[] { terms, privacy, health }, LegalAcceptanceRule.ToShow(current, LegalAudience.Client, none).ToArray());
        CollectionAssert.AreEqual(
            new[] { terms, privacy }, LegalAcceptanceRule.ToShow(current, LegalAudience.Owner, none).ToArray());
        CollectionAssert.AreEqual(
            new[] { terms, privacy }, LegalAcceptanceRule.ToShow(current, LegalAudience.Coach, none).ToArray());

        // An account that accepted the platform's documents before is shown the consumer terms alone, and one that
        // accepted all three nothing.
        CollectionAssert.AreEqual(
            new[] { consumer },
            LegalAcceptanceRule.ToShow(current, LegalAudience.Trainee, new HashSet<Guid> { terms.Id, privacy.Id }).ToArray());
        Assert.IsEmpty(LegalAcceptanceRule.ToShow(
            current, LegalAudience.Trainee, new HashSet<Guid> { terms.Id, privacy.Id, consumer.Id }));

        // With nothing published for a trainee the sign-up shows nothing, as a coach's does today.
        Assert.IsEmpty(LegalAcceptanceRule.ToShow([health], LegalAudience.Trainee, none));
        Assert.IsEmpty(LegalAcceptanceRule.ToShow([], LegalAudience.Trainee, none));
    }

    [TestMethod]
    public void ATraineeMustNameTheConsumerTermsAndCannotNameTheHealthConsent()
    {
        var terms = Current(LegalDocumentKind.TermsOfService, LegalConsentContext.Platform);
        var privacy = Current(LegalDocumentKind.PrivacyPolicy, LegalConsentContext.Platform);
        var consumer = Current(LegalDocumentKind.ConsumerTerms, LegalConsentContext.Workspace);
        var health = Current(LegalDocumentKind.HealthIntakeConsent, LegalConsentContext.Workspace);
        CurrentLegalDocument[] current = [health, consumer, privacy, terms];
        var none = new HashSet<Guid>();

        CollectionAssert.AreEquivalent(
            new[] { terms, privacy, consumer },
            LegalAcceptanceRule.Check(current, LegalAudience.Trainee, none, [terms.Id, privacy.Id, consumer.Id])!.ToArray());

        Assert.IsNull(
            LegalAcceptanceRule.Check(current, LegalAudience.Trainee, none, [terms.Id, privacy.Id, consumer.Id, health.Id]),
            "Naming the health consent is refused: it is not a trainee's to accept.");
        Assert.IsNull(
            LegalAcceptanceRule.Check(current, LegalAudience.Trainee, none, [terms.Id, privacy.Id]),
            "Leaving the consumer terms out is refused.");
        Assert.IsNull(LegalAcceptanceRule.Check(current, LegalAudience.Trainee, none, [consumer.Id]));
        Assert.IsNull(LegalAcceptanceRule.Check(current, LegalAudience.Trainee, none, [terms.Id, privacy.Id, health.Id]));
        Assert.IsNull(LegalAcceptanceRule.Check(current, LegalAudience.Trainee, none, null));
        Assert.IsNull(LegalAcceptanceRule.Check(current, LegalAudience.Trainee, none, []));

        // An account that accepted the platform's documents before names the consumer terms alone, and only they are
        // recorded.
        var before = new HashSet<Guid> { terms.Id, privacy.Id };
        CollectionAssert.AreEqual(
            new[] { consumer },
            LegalAcceptanceRule.Check(current, LegalAudience.Trainee, before, [consumer.Id])!.ToArray());
        CollectionAssert.AreEqual(
            new[] { consumer },
            LegalAcceptanceRule.Check(current, LegalAudience.Trainee, before, [terms.Id, consumer.Id, privacy.Id])!.ToArray());
        Assert.IsNull(LegalAcceptanceRule.Check(current, LegalAudience.Trainee, before, null));
        Assert.IsEmpty(LegalAcceptanceRule.Check(
            current, LegalAudience.Trainee, new HashSet<Guid> { terms.Id, privacy.Id, consumer.Id }, null)!);

        // With nothing published for a trainee nothing is asked, and nothing can be named.
        Assert.IsEmpty(LegalAcceptanceRule.Check([health], LegalAudience.Trainee, none, null)!);
        Assert.IsNull(LegalAcceptanceRule.Check([health], LegalAudience.Trainee, none, [health.Id]));
        Assert.IsEmpty(LegalAcceptanceRule.Check([], LegalAudience.Trainee, none, null)!);
    }

    [TestMethod]
    public void AnOwnerACoachAndAClientNamingTheConsumerTermsAreRefused()
    {
        var terms = Current(LegalDocumentKind.TermsOfService, LegalConsentContext.Platform);
        var privacy = Current(LegalDocumentKind.PrivacyPolicy, LegalConsentContext.Platform);
        var consumer = Current(LegalDocumentKind.ConsumerTerms, LegalConsentContext.Workspace);
        var health = Current(LegalDocumentKind.HealthIntakeConsent, LegalConsentContext.Workspace);
        CurrentLegalDocument[] current = [terms, privacy, consumer, health];
        var none = new HashSet<Guid>();

        Assert.IsNull(LegalAcceptanceRule.Check(current, LegalAudience.Owner, none, [terms.Id, privacy.Id, consumer.Id]));
        Assert.IsNull(LegalAcceptanceRule.Check(current, LegalAudience.Coach, none, [terms.Id, privacy.Id, consumer.Id]));
        Assert.IsNull(LegalAcceptanceRule.Check(
            current, LegalAudience.Client, none, [terms.Id, privacy.Id, health.Id, consumer.Id]));
        Assert.IsNull(LegalAcceptanceRule.Check(
            current, LegalAudience.Client, new HashSet<Guid> { terms.Id, privacy.Id, health.Id }, [consumer.Id]));

        // What each named before the consumer terms existed is still everything asked of them.
        CollectionAssert.AreEquivalent(
            new[] { terms, privacy },
            LegalAcceptanceRule.Check(current, LegalAudience.Owner, none, [terms.Id, privacy.Id])!.ToArray());
        CollectionAssert.AreEquivalent(
            new[] { terms, privacy },
            LegalAcceptanceRule.Check(current, LegalAudience.Coach, none, [terms.Id, privacy.Id])!.ToArray());
        CollectionAssert.AreEquivalent(
            new[] { terms, privacy, health },
            LegalAcceptanceRule.Check(current, LegalAudience.Client, none, [terms.Id, privacy.Id, health.Id])!.ToArray());
    }

    // ---- the client record of a sign-up (CLI-024, CLI-026) ----

    [TestMethod]
    public void AHouseSignUpsProfileIsSelfDirectedWithTheTypedNamesAndNoPhone()
    {
        var profile = ClientProfile.CreateForHouseSignUp(
            HouseId,
            TraineeUserId,
            HouseCoachUserId,
            "  Lina ",
            " Haddad ",
            " Lina.Haddad@OakHall.Example ",
            Day(2001, 5, 3));

        Assert.IsTrue(profile.IsSelfDirected);
        Assert.IsNull(profile.PhoneNumber, "The sign-up form asks for none.");
        Assert.AreEqual("Lina", profile.FirstName);
        Assert.AreEqual("Haddad", profile.LastName);
        Assert.AreEqual("lina.haddad@oakhall.example", profile.Email);
        Assert.AreEqual(Day(2001, 5, 3), profile.BirthDate);
        Assert.AreEqual(HouseId, profile.TenantId);
        Assert.AreEqual(TraineeUserId, profile.UserId);
        Assert.AreEqual(HouseCoachUserId, profile.AssignedCoachUserId, "The record still names a member of the house's staff (ADR 0026).");
        Assert.AreEqual(ClientOnboardingStatus.NotStarted, profile.OnboardingStatus);
        Assert.IsFalse(profile.IsReleased);
        Assert.IsFalse(profile.IsCoachBlocked);

        // A client a coach invited is never self-directed.
        var invited = ClientProfile.CreateForAcceptedInvitation(
            HouseId, TraineeUserId, HouseCoachUserId, "Lina", "Haddad", "lina.haddad@oakhall.example", null, Day(2001, 5, 3));
        Assert.IsFalse(invited.IsSelfDirected);
    }

    [TestMethod]
    public void AHouseSignUpsProfileIsRefusedWhatEveryClientsIs()
    {
        static void Refused(Guid userId, Guid coachUserId, string firstName, string lastName, string email) =>
            Assert.Throws<ArgumentException>(() => ClientProfile.CreateForHouseSignUp(
                HouseId, userId, coachUserId, firstName, lastName, email, Day(2001, 5, 3)));

        Refused(Guid.Empty, HouseCoachUserId, "Lina", "Haddad", "lina.haddad@oakhall.example");
        Refused(TraineeUserId, Guid.Empty, "Lina", "Haddad", "lina.haddad@oakhall.example");
        Refused(TraineeUserId, TraineeUserId, "Lina", "Haddad", "lina.haddad@oakhall.example");
        Refused(TraineeUserId, HouseCoachUserId, " ", "Haddad", "lina.haddad@oakhall.example");
        Refused(TraineeUserId, HouseCoachUserId, "Lina", new string('h', 101), "lina.haddad@oakhall.example");
        Refused(TraineeUserId, HouseCoachUserId, "Lina", "Haddad", "not an address");
    }

    [TestMethod]
    public void ASignUpsCoachHistoryStartsAtEntryOneWithItsOwnReasonAndNoPreviousCoach()
    {
        var entry = ClientCoachAssignment.ForSignUp(HouseId, ProfileId, HouseCoachUserId, Now);

        Assert.AreEqual(1, entry.Sequence);
        Assert.AreEqual(ClientCoachAssignmentReason.SignUp, entry.Reason, "No invitation came before it, so the history does not say one did.");
        Assert.IsNull(entry.PreviousCoachUserId);
        Assert.IsNull(entry.Note);
        Assert.AreEqual(HouseCoachUserId, entry.CoachUserId);
        Assert.AreEqual(ProfileId, entry.ClientProfileId);
        Assert.AreEqual(HouseId, entry.TenantId);
        Assert.AreEqual(Now, entry.AssignedAtUtc);

        Assert.Throws<ArgumentException>(() => ClientCoachAssignment.ForSignUp(HouseId, Guid.Empty, HouseCoachUserId, Now));
        Assert.Throws<ArgumentException>(() => ClientCoachAssignment.ForSignUp(HouseId, ProfileId, Guid.Empty, Now));
        Assert.Throws<ArgumentException>(() => ClientCoachAssignment.ForSignUp(Guid.Empty, ProfileId, HouseCoachUserId, Now));

        // An invited client's first entry keeps its own reason.
        Assert.AreEqual(
            ClientCoachAssignmentReason.Invitation,
            ClientCoachAssignment.ForInvitation(HouseId, ProfileId, HouseCoachUserId, Now).Reason);
    }

    [TestMethod]
    public void ASignUpIsNeverTheReasonOfALaterChange()
    {
        // Reasons and sources are stored by name and number: neither is ever given to another.
        Assert.AreEqual(
            "Invitation 1, Reassigned 2, CoachRemoved 3, Migration 4, Released 5, CoachResigned 6, ClientLeft 7, SignUp 8",
            string.Join(", ", Enum.GetValues<ClientCoachAssignmentReason>().Select(reason => $"{reason} {(int)reason}")));
        Assert.AreEqual(
            "InvitationAcceptance 1, Client 2, Coach 3, OnboardingCompletion 4, SignUp 5",
            string.Join(", ", Enum.GetValues<ClientChangeSource>().Select(source => $"{source} {(int)source}")));

        static ClientCoachAssignment Change(ClientCoachAssignmentReason reason) =>
            ClientCoachAssignment.ForChange(HouseId, ProfileId, 2, HouseCoachUserId, HouseOwnerUserId, reason, null, Now);

        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => Change(ClientCoachAssignmentReason.SignUp));

        // The three ways a record starts are refused as a change; the five ways it moves are taken. A trainee whose
        // coach leaves the house moves to its owner like any client.
        Assert.AreEqual(
            "Reassigned, CoachRemoved, Released, CoachResigned, ClientLeft",
            string.Join(", ", Enum.GetValues<ClientCoachAssignmentReason>().Where(reason =>
            {
                try
                {
                    return Change(reason).Reason == reason;
                }
                catch (ArgumentOutOfRangeException)
                {
                    return false;
                }
            })));

        var moved = Change(ClientCoachAssignmentReason.CoachResigned);
        Assert.AreEqual(2, moved.Sequence);
        Assert.AreEqual(HouseOwnerUserId, moved.CoachUserId);
        Assert.AreEqual(HouseCoachUserId, moved.PreviousCoachUserId);
    }

    // ---- TB Gym is for adults: the house's lowest age and the intake's (CLI-004) ----

    [TestMethod]
    public void TheHousesLowestAgeIsEighteenAsTheIntakesOwnAdultRuleIs()
    {
        // 18 years before Thu 12 Nov 2026, counted with the house's lowest age, which is the lowest its setting takes.
        var eighteenToday = Today.AddYears(-HouseSettingRule.AdultAge);
        Assert.AreEqual(Day(2008, 11, 12), eighteenToday);
        Assert.AreEqual(
            HouseSettingRule.AdultAge,
            HouseSettingRule.Number(HouseSettingRule.Normalize(HouseSetting.MinimumSignUpAge, "18").Value));
        Assert.IsFalse(HouseSettingRule.Normalize(HouseSetting.MinimumSignUpAge, "17").IsValid);

        // The intake refuses a birth date one day short of 18 years, and changes nothing.
        var tooYoung = SelfDirectedProfile();
        var refusal = Assert.ThrowsExactly<ArgumentOutOfRangeException>(() =>
            tooYoung.UpdateIntake(Intake(eighteenToday.AddDays(1)), Today));
        Assert.Contains($"at least {HouseSettingRule.AdultAge} years old", refusal.PersonMessage());
        Assert.IsNull(tooYoung.BirthDate);

        // And accepts 18 exactly.
        var adult = SelfDirectedProfile();
        adult.UpdateIntake(Intake(eighteenToday), Today);
        Assert.AreEqual(eighteenToday, adult.BirthDate);
        Assert.IsTrue(adult.IsSelfDirected, "Filling the intake leaves the mark alone.");
    }

    [TestMethod]
    public void AtEighteenTheSignUpsAgeCheckAndTheIntakesAcceptTheSameBirthDates()
    {
        (DateOnly Birth, DateOnly HouseToday, bool Accepted, string Case)[] cases =
        [
            (Day(2008, 11, 12), Today, true, "18 today"),
            (Day(2008, 11, 13), Today, false, "18 tomorrow"),
            (Day(1987, 5, 3), Today, true, "39"),
            (Day(2008, 2, 29), Day(2026, 2, 27), false, "born 29 Feb, the day before 28 Feb 2026"),
            (Day(2008, 2, 29), Day(2026, 2, 28), true, "born 29 Feb, on 28 Feb 2026"),
            (Today, Today, false, "born today"),
            (Today.AddDays(1), Today, false, "born tomorrow"),
            (Day(1906, 11, 12), Today, true, "120 years ago to the day"),
            (Day(1906, 11, 11), Today, false, "a day more than 120 years ago"),
        ];

        foreach (var (birth, houseToday, accepted, name) in cases)
        {
            var signUp = TraineeSignUpRule.CheckBirthDate(birth, HouseSettingRule.AdultAge, houseToday) == TraineeBirthDateCheck.Valid;
            var intake = IntakeAccepts(birth, houseToday);

            Assert.AreEqual(accepted, signUp, $"sign-up: {name}");
            Assert.AreEqual(accepted, intake, $"intake: {name}");
        }
    }

    // ---- helpers ----

    private static DateOnly Day(int year, int month, int day) => new(year, month, day);

    private static DateTimeOffset Utc(int year, int month, int day, int hour, int minute, int second = 0) =>
        new(year, month, day, hour, minute, second, TimeSpan.Zero);

    /// <summary>
    /// The week <paramref name="now"/> falls in, whole: its days, its instants in UTC, its first day's name, and that
    /// the instant itself lies inside it, so a sign-up confirmed now is one the week's count reads.
    /// </summary>
    private static void AssertWeek(
        TimeZoneInfo zone,
        DayOfWeek weekStartsOn,
        DateTimeOffset now,
        DateOnly today,
        DateOnly startsOn,
        DateOnly endsOnExclusive,
        DateTimeOffset startsAtUtc,
        DateTimeOffset endsAtUtc,
        string because)
    {
        var week = TraineeSignUpRule.WeekOf(now, zone, weekStartsOn);

        Assert.AreEqual(new TraineeSignUpWeek(today, startsOn, endsOnExclusive, startsAtUtc, endsAtUtc), week, because);
        Assert.AreEqual((TimeSpan.Zero, TimeSpan.Zero), (week.StartsAtUtc.Offset, week.EndsAtUtc.Offset), because);
        Assert.AreEqual(weekStartsOn, week.StartsOn.DayOfWeek, because);
        Assert.AreEqual(7, week.EndsOnExclusive.DayNumber - week.StartsOn.DayNumber, because);
        Assert.IsGreaterThanOrEqualTo(week.StartsAtUtc, now, because);
        Assert.IsLessThan(week.EndsAtUtc, now, because);
    }

    /// <summary>
    /// UTC+2, and +3 from 00:00 on 1 Apr (clocks to 01:00) until 01:00 summer time on 1 Oct (clocks back to 00:00):
    /// a month's first midnight that does not exist, and one that comes twice. The zone B4b's tests read.
    /// </summary>
    private static TimeZoneInfo MidnightChangesZone()
    {
        var rule = TimeZoneInfo.AdjustmentRule.CreateAdjustmentRule(
            new DateTime(2000, 1, 1),
            new DateTime(2099, 12, 31),
            TimeSpan.FromHours(1),
            TimeZoneInfo.TransitionTime.CreateFixedDateRule(new DateTime(1, 1, 1, 0, 0, 0), 4, 1),
            TimeZoneInfo.TransitionTime.CreateFixedDateRule(new DateTime(1, 1, 1, 1, 0, 0), 10, 1));
        return TimeZoneInfo.CreateCustomTimeZone(
            "N9a1/MidnightChanges", TimeSpan.FromHours(2), "Midnight changes", "Standard", "Summer", [rule]);
    }

    private static ClientAttentionSignals Quiet() => new(0, 0, null, null, false, 0, false);

    /// <summary>Every signal there is, set so that each raises its kind under the plan state that lets it.</summary>
    private static ClientAttentionSignals Loud() => new(
        CheckInsToReview: 3,
        UnreadMessages: 5,
        RenewalRequestedOn: Today.AddDays(-1),
        PlanLastDay: Today.AddDays(3),
        HasWeekToShare: true,
        MissedSinceLastWorkout: 3,
        HasNoProgram: true,
        JoinedOn: Today.AddDays(-2),
        CheckInsOverdue: 1,
        SessionsLeft: 1,
        SessionsLastDay: Today.AddDays(5),
        WeightsToApply: 2);

    private static bool DefaultsToFalse(Type record, string parameter)
    {
        var found = record.GetConstructors().Single().GetParameters().Single(item => item.Name == parameter);
        return found.HasDefaultValue && found.DefaultValue is false;
    }

    private static CurrentLegalDocument Current(LegalDocumentKind kind, LegalConsentContext context) =>
        new(Guid.NewGuid(), kind, context, "en");

    private static ClientProfile SelfDirectedProfile() =>
        ClientProfile.CreateForHouseSignUp(
            HouseId, TraineeUserId, HouseCoachUserId, "Lina", "Haddad", "lina.haddad@oakhall.example", null);

    private static ClientIntakeInput Intake(DateOnly? birthDate) =>
        new(
            "Lina",
            "Haddad",
            null,
            birthDate,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null);

    private static bool IntakeAccepts(DateOnly birthDate, DateOnly tenantToday)
    {
        try
        {
            SelfDirectedProfile().UpdateIntake(Intake(birthDate), tenantToday);
            return true;
        }
        catch (ArgumentOutOfRangeException)
        {
            return false;
        }
    }
}
