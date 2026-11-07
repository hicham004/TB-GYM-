using System.Globalization;
using System.Reflection;
using System.Text.RegularExpressions;
using TB.Gym.Modules.Identity;
using TB.Gym.SharedKernel;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// The coach's switch and the keeping period (notes plan N4b, CLI-021, ADR 0039): a coach shows or hides only a
/// confirmed line that is still up, and only the switch moves; a taken-down line keeps its words for whole calendar
/// months after its own take-down, counted in UTC to the whole microsecond, and is then erased with no erasing user
/// and no request day, its dates kept; a line still up, one the coach hid and a waiting line are never due; a client
/// reads a line only while it is confirmed, up and shown; and the settings refuse a period outside 1 to 120 months or
/// a sweep outside a minute to a day, naming the setting and never its value. The four sentences N4b adds to
/// <see cref="CoachCertificateText"/> are read with every other one by N4a's reflection test of the record's words.
/// </summary>
[TestClass]
public sealed class N4bCoachCertificateDomainTests
{
    private static readonly Guid TenantId = Guid.Parse("10000000-0000-0000-0000-0000000000b4");
    private static readonly Guid CoachUserId = Guid.Parse("20000000-0000-0000-0000-0000000000b4");
    private static readonly Guid AdminUserId = Guid.Parse("30000000-0000-0000-0000-0000000000b4");
    private static readonly Guid SecondAdminUserId = Guid.Parse("40000000-0000-0000-0000-0000000000b4");

    /// <summary>The day the line was added in the space's calendar, and the day the coach showed the proof.</summary>
    private static readonly DateOnly AddedOn = new(2026, 1, 12);

    private static readonly DateOnly ShownOn = new(2026, 1, 9);
    private static readonly DateTimeOffset ConfirmedAt = new(2026, 1, 12, 9, 30, 0, TimeSpan.Zero);

    /// <summary>A line confirmed more than twelve years before the sweep's clock.</summary>
    private static readonly DateTimeOffset ConfirmedLongAgoAt = new(2015, 3, 2, 9, 30, 0, TimeSpan.Zero);

    /// <summary>The sweep's clock: 7 December 2027 at 10:00 UTC, noon in Beirut.</summary>
    private static readonly DateTimeOffset Now = new(2027, 12, 7, 10, 0, 0, TimeSpan.Zero);

    /// <summary>Twelve calendar months before <see cref="Now"/>: the default period's cut-off.</summary>
    private static readonly DateTimeOffset TwelveMonthsBeforeNow = new(2026, 12, 7, 10, 0, 0, TimeSpan.Zero);

    private static readonly DateOnly RequestedOn = new(2027, 12, 1);

    private static readonly TimeSpan BeirutWinterOffset = TimeSpan.FromHours(2);

    private static readonly TimeSpan Microsecond = TimeSpan.FromTicks(TimeSpan.TicksPerMicrosecond);

    private static readonly CoachCertificateKeepingPeriod TwelveMonths = new(12);

    /// <summary>The words no sentence of the record may hold, "certified" too.</summary>
    private static readonly Regex ForbiddenWords = new(
        @"\b(verified|certified|licensed|qualified|approved)\b",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    // ---- the coach's switch ----

    [TestMethod]
    public void TheCoachHidesAConfirmedLineThatIsStillUpAndShowsItAgainAndOnlyTheSwitchMoves()
    {
        var line = Confirmed();
        var facts = FactsOf(line);
        Assert.IsTrue(line.CoachShows, "A confirmed line starts shown: the coach sent the proof to be shown.");

        line.SetShown(false);
        Assert.IsFalse(line.CoachShows);
        Assert.AreEqual(facts, FactsOf(line), "Hiding moves the switch alone.");

        // The page may send the value the line already holds: no refusal, and nothing moves.
        line.SetShown(false);
        Assert.IsFalse(line.CoachShows);
        Assert.AreEqual(facts, FactsOf(line));

        line.SetShown(true);
        Assert.IsTrue(line.CoachShows);
        line.SetShown(true);
        Assert.IsTrue(line.CoachShows);
        Assert.AreEqual(facts, FactsOf(line), "Showing it again moves the switch alone.");

        // What stayed, read out rather than only compared: the words, the day, who confirmed it and when, the state.
        Assert.AreEqual(CoachCertificateLineState.Confirmed, line.State);
        Assert.AreEqual("NASM CPT, 2019", line.What);
        Assert.AreEqual(ShownOn, line.ShownOn);
        Assert.AreEqual("Rami Saade", line.ConfirmedByName);
        Assert.AreEqual(ConfirmedAt, line.ConfirmedAtUtc);
        Assert.IsNull(line.TakenDownAtUtc);
        Assert.IsNull(line.TakenDownByUserId);
        Assert.IsNull(line.ErasedAtUtc);
        Assert.IsNull(line.ErasureReason);
    }

    [TestMethod]
    public void AWaitingATakenDownOrAnErasedLineRefusesTheSwitchEitherWayAndKeepsTheCoachsLastChoice()
    {
        var lines = new (string Name, CoachCertificateLine Line)[]
        {
            ("waiting", Waiting()),
            ("taken down", TakenDown(Now.AddMonths(-1))),
            ("taken down after the coach hid it", TakenDown(Hidden(Confirmed()), Now.AddMonths(-1))),
            ("erased on request", ErasedOnRequest(Confirmed())),
            ("erased on request after the coach hid it", ErasedOnRequest(Hidden(Confirmed()))),
            ("erased on request after a take-down", ErasedOnRequest(TakenDown(Now.AddMonths(-1)))),
            ("erased after the keeping period", ErasedAfterKeepingPeriod(TakenDown(Now.AddMonths(-13)))),
        };

        foreach (var (name, line) in lines)
        {
            var facts = FactsOf(line);
            var coachShows = line.CoachShows;
            foreach (var shown in new[] { true, false })
            {
                var asked = shown ? "show" : "hide";
                var refused = Assert.ThrowsExactly<InvalidOperationException>(() => line.SetShown(shown), $"{name}: {asked}");
                Assert.AreEqual(CoachCertificateText.ShownNotConfirmed, refused.Message, $"{name}: {asked}");
                Assert.AreEqual(coachShows, line.CoachShows, $"A refused switch leaves the {name} line's choice as it was.");
                Assert.AreEqual(facts, FactsOf(line), $"{name}: {asked}");
            }
        }
    }

    [TestMethod]
    public void AHiddenLineIsStillConfirmedAndTheAdminMayStillTakeItDownOrEraseIt()
    {
        var line = Hidden(Confirmed());
        Assert.AreEqual(CoachCertificateLineState.Confirmed, line.State, "Hiding is not a take-down: the coach may show it again.");
        Assert.IsNull(line.TakenDownAtUtc);
        Assert.IsNull(line.TakenDownByUserId);
        Assert.IsFalse(line.IsShownToClients);

        line.TakeDown(SecondAdminUserId, Now.AddMonths(-13));
        Assert.AreEqual(CoachCertificateLineState.TakenDown, line.State);
        Assert.IsFalse(line.CoachShows, "A take-down leaves the coach's choice as it was.");

        var onRequest = ErasedOnRequest(Hidden(Confirmed()));
        Assert.AreEqual(CoachCertificateLineState.Erased, onRequest.State);
        Assert.AreEqual(CoachCertificateErasureReason.Request, onRequest.ErasureReason);
        Assert.IsFalse(onRequest.CoachShows, "So does an erasure, as the database requires.");
    }

    // ---- erasing after the keeping period ----

    [TestMethod]
    public void OnlyATakenDownLineIsErasedAfterTheKeepingPeriodAndAnyOtherIsLeftAsItWas()
    {
        var lines = new (string Name, CoachCertificateLine Line)[]
        {
            ("waiting", Waiting()),
            ("confirmed and still up", Confirmed()),
            ("confirmed more than twelve years ago and still up", ConfirmedLongAgo()),
            ("hidden by the coach", Hidden(Confirmed())),
            ("hidden by the coach, confirmed more than twelve years ago", Hidden(ConfirmedLongAgo())),
            ("erased on request", ErasedOnRequest(TakenDown(Now.AddMonths(-13)))),
            ("erased after the keeping period", ErasedAfterKeepingPeriod(TakenDown(Now.AddMonths(-13)))),
        };

        foreach (var (name, line) in lines)
        {
            var facts = FactsOf(line);
            var coachShows = line.CoachShows;

            // Whatever the clock: even twenty years on, only a take-down starts the period.
            foreach (var clock in new[] { Now, Now.AddYears(20) })
            {
                var refused = Assert.ThrowsExactly<InvalidOperationException>(
                    () => line.EraseAfterKeepingPeriod(TwelveMonths, clock),
                    name);
                Assert.AreEqual(CoachCertificateText.KeepingPeriodNotTakenDown, refused.Message, name);
                Assert.AreEqual(facts, FactsOf(line), $"A refusal leaves the {name} line as it was.");
                Assert.AreEqual(coachShows, line.CoachShows, name);
            }
        }
    }

    [TestMethod]
    public void ATakenDownLineIsNotErasedBeforeItsPeriodRunsOut()
    {
        var takeDowns = new[]
        {
            ("exactly at the cut-off", TwelveMonthsBeforeNow),
            ("a microsecond after the cut-off", TwelveMonthsBeforeNow + Microsecond),
            ("eleven months before", Now.AddMonths(-11)),
            ("just now", Now),
        };

        foreach (var (name, takenDownAt) in takeDowns)
        {
            var line = TakenDown(takenDownAt);
            var facts = FactsOf(line);
            var refused = Assert.ThrowsExactly<InvalidOperationException>(
                () => line.EraseAfterKeepingPeriod(TwelveMonths, Now),
                name);
            Assert.AreEqual(CoachCertificateText.KeepingPeriodNotOver, refused.Message, name);
            Assert.AreEqual(facts, FactsOf(line), name);
            Assert.AreEqual("NASM CPT, 2019", line.What, $"Taken down {name}: the words stay for the whole period.");
            Assert.IsNull(line.ErasedAtUtc, name);
        }

        Assert.ThrowsExactly<ArgumentNullException>(
            () => TakenDown(Now.AddMonths(-13)).EraseAfterKeepingPeriod(null!, Now),
            "An erasure needs the period it ran out of.");
    }

    [TestMethod]
    [DataRow(true, DisplayName = "A line the coach showed")]
    [DataRow(false, DisplayName = "A line the coach hid")]
    public void AnErasureAfterTheKeepingPeriodBlanksTheWordsKeepsTheDatesAndRecordsNoOne(bool coachShows)
    {
        var takenDownAt = Now.AddMonths(-13);
        var line = Confirmed();
        line.SetShown(coachShows);
        line.TakeDown(SecondAdminUserId, takenDownAt);
        Assert.IsTrue(TwelveMonths.IsDue(line, Now));

        line.EraseAfterKeepingPeriod(TwelveMonths, Now);

        Assert.AreEqual(CoachCertificateLineState.Erased, line.State);
        Assert.AreEqual(string.Empty, line.What);
        Assert.IsNull(line.ShownOn);
        Assert.AreEqual(string.Empty, line.ConfirmedByName, "Blanked, not null: the confirmation's date stays.");
        Assert.AreEqual(Now, line.ErasedAtUtc);
        Assert.IsNull(line.ErasedByUserId, "No one erased it: its period ran out.");
        Assert.AreEqual(CoachCertificateErasureReason.KeepingPeriod, line.ErasureReason);
        Assert.IsNull(line.RequestedOn, "No one asked for it.");

        // The dates and who acted stay, and so does the coach's last choice, as the database requires.
        Assert.AreEqual(ConfirmedAt, line.ConfirmedAtUtc);
        Assert.AreEqual(takenDownAt, line.TakenDownAtUtc);
        Assert.AreEqual(SecondAdminUserId, line.TakenDownByUserId);
        Assert.AreEqual(coachShows, line.CoachShows);
        Assert.AreEqual(AdminUserId, line.RecordedByUserId);
        Assert.AreEqual(CoachUserId, line.CoachUserId);
        Assert.AreEqual(TenantId, line.TenantId);
        Assert.IsFalse(line.IsShownToClients);
        Assert.IsFalse(TwelveMonths.IsDue(line, Now), "An erased line is never due again.");
        AssertNothingChangesAfter(line);
    }

    // ---- the keeping period ----

    [TestMethod]
    public void AKeepingPeriodIsOneTo120WholeMonths()
    {
        foreach (var months in new[] { 1, 12, 120 })
        {
            Assert.AreEqual(months, new CoachCertificateKeepingPeriod(months).Months);
        }

        foreach (var months in new[] { 0, -1, 121, int.MinValue, int.MaxValue })
        {
            var refused = Assert.ThrowsExactly<ArgumentOutOfRangeException>(
                () => new CoachCertificateKeepingPeriod(months),
                months.ToString(CultureInfo.InvariantCulture));
            Assert.AreEqual("months", refused.ParamName);
        }

        Assert.AreEqual(new CoachCertificateKeepingPeriod(12), TwelveMonths, "Two periods of as many months are the same period.");
        Assert.AreNotEqual(new CoachCertificateKeepingPeriod(13), TwelveMonths);
    }

    [TestMethod]
    public void TheCutOffIsThePeriodsCalendarMonthsBeforeTheClock()
    {
        var oneMonth = new CoachCertificateKeepingPeriod(1);

        Assert.AreEqual(TwelveMonthsBeforeNow, TwelveMonths.CutOff(Now));
        Assert.AreEqual(new DateTimeOffset(2027, 11, 7, 10, 0, 0, TimeSpan.Zero), oneMonth.CutOff(Now));
        Assert.AreEqual(new DateTimeOffset(2017, 12, 7, 10, 0, 0, TimeSpan.Zero), new CoachCertificateKeepingPeriod(120).CutOff(Now));

        // A day the earlier month lacks falls on that month's last day.
        Assert.AreEqual(
            new DateTimeOffset(2027, 2, 28, 10, 0, 0, TimeSpan.Zero),
            TwelveMonths.CutOff(new DateTimeOffset(2028, 2, 29, 10, 0, 0, TimeSpan.Zero)));
        Assert.AreEqual(
            new DateTimeOffset(2027, 2, 28, 10, 0, 0, TimeSpan.Zero),
            oneMonth.CutOff(new DateTimeOffset(2027, 3, 31, 10, 0, 0, TimeSpan.Zero)));
        Assert.AreEqual(
            new DateTimeOffset(2028, 2, 29, 10, 0, 0, TimeSpan.Zero),
            oneMonth.CutOff(new DateTimeOffset(2028, 3, 31, 10, 0, 0, TimeSpan.Zero)));
    }

    [TestMethod]
    public void AClockInAnotherOffsetIsReadInUtcAndTheCutOffIsInUtc()
    {
        // Noon in Beirut's winter is 10:00 UTC.
        var beirutNoon = new DateTimeOffset(2027, 12, 7, 12, 0, 0, BeirutWinterOffset);
        var cutOff = TwelveMonths.CutOff(beirutNoon);
        Assert.AreEqual(TwelveMonthsBeforeNow, cutOff);
        Assert.AreEqual(TimeSpan.Zero, cutOff.Offset);

        // 01:00 on 29 February 2028 in Beirut is 23:00 on 28 February in UTC, so the months count back from the 28th.
        // Counted in Beirut's own offset, they would end a day earlier.
        var leapNight = new DateTimeOffset(2028, 2, 29, 1, 0, 0, BeirutWinterOffset);
        cutOff = TwelveMonths.CutOff(leapNight);
        Assert.AreEqual(new DateTimeOffset(2027, 2, 28, 23, 0, 0, TimeSpan.Zero), cutOff);
        Assert.AreEqual(TimeSpan.Zero, cutOff.Offset);
        Assert.AreNotEqual(leapNight.AddMonths(-12), cutOff);

        // West of UTC: 23:00 on 30 March 2027 at -02:00 is already 31 March in UTC, a month after the end of February.
        var oneMonth = new CoachCertificateKeepingPeriod(1);
        var westEvening = new DateTimeOffset(2027, 3, 30, 23, 0, 0, TimeSpan.FromHours(-2));
        cutOff = oneMonth.CutOff(westEvening);
        Assert.AreEqual(new DateTimeOffset(2027, 2, 28, 1, 0, 0, TimeSpan.Zero), cutOff);
        Assert.AreEqual(TimeSpan.Zero, cutOff.Offset);
        Assert.AreNotEqual(westEvening.AddMonths(-1), cutOff);
    }

    [TestMethod]
    public void TheCutOffKeepsWholeMicrosecondsAsTheDatabaseDoes()
    {
        // 1,234,567 ticks is 123,456.7 microseconds: the last 0.7 of a microsecond goes.
        Assert.AreEqual(TwelveMonthsBeforeNow.AddTicks(1_234_560), TwelveMonths.CutOff(Now.AddTicks(1_234_567)));
        Assert.AreEqual(TwelveMonthsBeforeNow, TwelveMonths.CutOff(Now.AddTicks(9)), "Less than a microsecond is dropped.");
        Assert.AreEqual(TwelveMonthsBeforeNow + Microsecond, TwelveMonths.CutOff(Now.AddTicks(10)), "A whole microsecond is kept.");
        Assert.AreEqual(
            TwelveMonthsBeforeNow - Microsecond,
            TwelveMonths.CutOff(Now.AddTicks(-1)),
            "Dropped downwards: a tick before the hour cuts off at the microsecond before it.");

        // A line in hand is held to that same instant: 0.7 of a microsecond past the hour, a line taken down 0.3 of a
        // microsecond past the cut-off's hour is not due, as a query with the cut-off as its parameter reads it.
        var clock = Now.AddTicks(7);
        Assert.AreEqual(TwelveMonthsBeforeNow, TwelveMonths.CutOff(clock));
        Assert.IsFalse(TwelveMonths.IsDue(TakenDown(TwelveMonthsBeforeNow.AddTicks(3)), clock));
        Assert.IsTrue(TwelveMonths.IsDue(TakenDown(TwelveMonthsBeforeNow.AddTicks(-1)), clock));
    }

    [TestMethod]
    public void TheRulePicksExactlyTheLinesTakenDownBeforeTheCutOff()
    {
        var lines = new (string Name, CoachCertificateLine Line, bool Due)[]
        {
            ("taken down 13 months before", TakenDown(Now.AddMonths(-13)), true),
            ("taken down 12 months and a day before", TakenDown(TwelveMonthsBeforeNow.AddDays(-1)), true),
            ("taken down a microsecond before the cut-off", TakenDown(TwelveMonthsBeforeNow - Microsecond), true),
            ("taken down at 11:59:59 in Beirut, a second before the cut-off", TakenDown(new DateTimeOffset(2026, 12, 7, 11, 59, 59, BeirutWinterOffset)), true),
            ("taken down 13 months before, after the coach hid it", TakenDown(Hidden(Confirmed()), Now.AddMonths(-13)), true),
            ("taken down exactly at the cut-off", TakenDown(TwelveMonthsBeforeNow), false),
            ("taken down at noon in Beirut, the cut-off itself", TakenDown(new DateTimeOffset(2026, 12, 7, 12, 0, 0, BeirutWinterOffset)), false),
            ("taken down a microsecond after the cut-off", TakenDown(TwelveMonthsBeforeNow + Microsecond), false),
            ("taken down 11 months before", TakenDown(Now.AddMonths(-11)), false),
            ("taken down just now", TakenDown(Now), false),
            ("confirmed and still up", Confirmed(), false),
            ("confirmed more than twelve years before and still up", ConfirmedLongAgo(), false),
            ("hidden by the coach", Hidden(Confirmed()), false),
            ("hidden by the coach, confirmed more than twelve years before", Hidden(ConfirmedLongAgo()), false),
            ("waiting", Waiting(), false),
            ("erased on request after a take-down 13 months before", ErasedOnRequest(TakenDown(Now.AddMonths(-13))), false),
            ("erased after the keeping period", ErasedAfterKeepingPeriod(TakenDown(Now.AddMonths(-13))), false),
        };

        foreach (var (name, line, due) in lines)
        {
            Assert.AreEqual(due, TwelveMonths.IsDue(line, Now), name);
        }

        Assert.ThrowsExactly<ArgumentNullException>(() => TwelveMonths.IsDue(null!, Now));
    }

    [TestMethod]
    public void EachLineCountsFromItsOwnTakeDownAndThePeriodsOwnMonths()
    {
        // Two lines of one coach: only the one taken down before the cut-off is due, whatever became of the other.
        var earlier = TakenDown(Now.AddMonths(-13));
        var later = TakenDown(Now.AddMonths(-11));
        Assert.IsTrue(TwelveMonths.IsDue(earlier, Now));
        Assert.IsFalse(TwelveMonths.IsDue(later, Now));
        Assert.IsTrue(TwelveMonths.IsDue(later, Now.AddMonths(2)), "Two months on, its own period has run out too.");

        // A month's period on the last day of March cuts off at the end of February, in the period's own months.
        var oneMonth = new CoachCertificateKeepingPeriod(1);
        var endOfMarch = new DateTimeOffset(2027, 3, 31, 10, 0, 0, TimeSpan.Zero);
        var lateFebruary = TakenDown(new DateTimeOffset(2027, 2, 28, 9, 59, 0, TimeSpan.Zero));
        Assert.IsTrue(oneMonth.IsDue(lateFebruary, endOfMarch));
        Assert.IsFalse(oneMonth.IsDue(TakenDown(new DateTimeOffset(2027, 2, 28, 10, 0, 0, TimeSpan.Zero)), endOfMarch));
        Assert.IsFalse(TwelveMonths.IsDue(lateFebruary, endOfMarch), "Under a twelve-month period the same line is far from due.");
    }

    // ---- what a client reads ----

    [TestMethod]
    public void AClientReadsOnlyAConfirmedLineThatIsStillUpWhileTheCoachShowsIt()
    {
        var lines = new (string Name, CoachCertificateLine Line)[]
        {
            ("waiting", Waiting()),
            ("confirmed and shown", Confirmed()),
            ("hidden by the coach", Hidden(Confirmed())),
            ("hidden, then shown again", Shown(Hidden(Confirmed()))),
            ("taken down", TakenDown(Now.AddMonths(-1))),
            ("taken down after the coach hid it", TakenDown(Hidden(Confirmed()), Now.AddMonths(-1))),
            ("erased on request", ErasedOnRequest(Confirmed())),
            ("erased on request after the coach hid it", ErasedOnRequest(Hidden(Confirmed()))),
            ("erased after the keeping period", ErasedAfterKeepingPeriod(TakenDown(Now.AddMonths(-13)))),
        };
        var rule = CoachCertificateLine.ShownToClients.Compile();

        foreach (var (name, line) in lines)
        {
            var expected = line.State == CoachCertificateLineState.Confirmed && line.CoachShows;
            Assert.AreEqual(expected, rule(line), name);
            Assert.AreEqual(expected, line.IsShownToClients, name);
        }

        // The same rule as a query over the lines: the two shown ones and nothing else.
        var read = lines.Select(item => item.Line).AsQueryable().Where(CoachCertificateLine.ShownToClients).ToHashSet();
        Assert.AreEqual(
            "confirmed and shown | hidden, then shown again",
            string.Join(" | ", lines.Where(item => read.Contains(item.Line)).Select(item => item.Name)));
    }

    // ---- the settings ----

    [TestMethod]
    public void TheSettingsDefaultToTwelveMonthsAndADailySweepAndStartAsTheyAre()
    {
        var options = new CoachCertificateOptions();

        // Read as compiled: the Worker's appsettings.json and every host's environment name this section.
        Assert.AreEqual(
            "CoachCertificates",
            typeof(CoachCertificateOptions)
                .GetField(nameof(CoachCertificateOptions.SectionName), BindingFlags.Public | BindingFlags.Static)!
                .GetRawConstantValue());
        Assert.AreEqual(12, options.KeepMonthsAfterTakenDown, "The plan's example, until the lawyer sets the number.");
        Assert.AreEqual(CoachCertificateKeepingPeriod.DefaultMonths, options.KeepMonthsAfterTakenDown);
        Assert.IsTrue(options.SweepEnabled);
        Assert.AreEqual(86_400, options.SweepIntervalSeconds, "Once a day.");
        Assert.IsNull(options.Validate(), "A host with no CoachCertificates section starts.");
        Assert.AreEqual(TwelveMonths, options.KeepingPeriod);
        Assert.AreEqual(12, options.KeepingPeriod.Months);
    }

    [TestMethod]
    public void AKeepingPeriodOutsideOneTo120MonthsIsRefusedNamingTheSettingAndNeverItsValue()
    {
        foreach (var months in new[] { 0, -1, 121, 1_000, int.MinValue, int.MaxValue })
        {
            var value = months.ToString(CultureInfo.InvariantCulture);
            var refusal = new CoachCertificateOptions { KeepMonthsAfterTakenDown = months }.Validate();

            Assert.IsNotNull(refusal, value);
            Assert.Contains("CoachCertificates:KeepMonthsAfterTakenDown", refusal, value);
            Assert.DoesNotContain("SweepIntervalSeconds", refusal, "Only the wrong setting is named.");

            // "1 to 120" holds a 0, so a refused 0 cannot be told apart; every other value must be absent.
            if (months != 0)
            {
                Assert.DoesNotContain(value, refusal, "The refusal names the setting and never quotes its value.");
            }
        }

        foreach (var months in new[] { 1, 12, 120 })
        {
            var options = new CoachCertificateOptions { KeepMonthsAfterTakenDown = months };
            Assert.IsNull(options.Validate(), months.ToString(CultureInfo.InvariantCulture));
            Assert.AreEqual(new CoachCertificateKeepingPeriod(months), options.KeepingPeriod);
            Assert.AreEqual(months, options.KeepingPeriod.Months);
        }

        // Read without validating first, the period still refuses and still never quotes the value.
        var notValidated = new CoachCertificateOptions { KeepMonthsAfterTakenDown = 121 };
        var refused = Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => notValidated.KeepingPeriod);
        Assert.DoesNotContain("121", refused.Message);
        Assert.IsNull(refused.ActualValue);
    }

    [TestMethod]
    public void ASweepIntervalOutsideAMinuteToADayIsRefusedNamingTheSettingAndNeverItsValue()
    {
        foreach (var seconds in new[] { 59, 86_401, 0, -1, int.MaxValue })
        {
            var value = seconds.ToString(CultureInfo.InvariantCulture);
            var refusal = new CoachCertificateOptions { SweepIntervalSeconds = seconds }.Validate();

            Assert.IsNotNull(refusal, value);
            Assert.Contains("CoachCertificates:SweepIntervalSeconds", refusal, value);
            Assert.DoesNotContain("KeepMonthsAfterTakenDown", refusal, "Only the wrong setting is named.");

            // "60 to 86400" holds a 0, so a refused 0 cannot be told apart; every other value must be absent.
            if (seconds != 0)
            {
                Assert.DoesNotContain(value, refusal, "The refusal names the setting and never quotes its value.");
            }
        }

        foreach (var seconds in new[] { 60, 3_600, 86_400 })
        {
            Assert.IsNull(
                new CoachCertificateOptions { SweepIntervalSeconds = seconds }.Validate(),
                seconds.ToString(CultureInfo.InvariantCulture));
        }

        Assert.IsNotNull(
            new CoachCertificateOptions { KeepMonthsAfterTakenDown = 0, SweepIntervalSeconds = 0 }.Validate(),
            "Two wrong settings still stop the host.");
    }

    [TestMethod]
    public void NoRefusalOfTheSettingsOrOfThePeriodHoldsAWordTheRecordKeepsOut()
    {
        // N4a's reflection test reads every sentence of CoachCertificateText, N4b's four too; these are the others.
        var refusals = new[]
        {
            new CoachCertificateOptions { KeepMonthsAfterTakenDown = 121 }.Validate(),
            new CoachCertificateOptions { SweepIntervalSeconds = 86_401 }.Validate(),
            Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => new CoachCertificateKeepingPeriod(121)).Message,
        };

        foreach (var refusal in refusals)
        {
            Assert.IsNotNull(refusal);
            Assert.IsFalse(ForbiddenWords.IsMatch(refusal), $"\"{refusal}\" holds a word the record keeps out.");
        }

        Assert.IsTrue(ForbiddenWords.IsMatch("A Certified line"), "The pattern does catch a word, so a passing loop means something.");
    }

    /// <summary>
    /// A word TB Gym keeps out of a line reads whole to a client even with an invisible format character inside it
    /// (a zero-width space or joiner, a soft hyphen, a word joiner, a byte order mark, a direction override), so
    /// such characters are dropped before the check, and the word is refused (notes plan N4b, since clients now
    /// read the lines).
    /// </summary>
    [TestMethod]
    [DataRow("Lic​ensed coach")]
    [DataRow("Veri­fied trainer")]
    [DataRow("Ap‍proved by the board")]
    [DataRow("Physio⁠therapist since 2015")]
    [DataRow("phy﻿siotherapist")]
    [DataRow("‮Qualified‬ coach")]
    [DataRow("Physical‌ therapist")]
    [DataRow("physi‎o")]
    public void AWordTheRecordKeepsOutIsRefusedThoughInvisibleCharactersSplitIt(string what)
    {
        var refused = Assert.ThrowsExactly<ArgumentException>(() => CoachCertificateLine.NormalizeWhat(what));

        Assert.AreEqual(CoachCertificateText.WhatRefused, refused.PersonMessage());
        Assert.AreEqual("what", refused.ParamName);
    }

    [TestMethod]
    public void InvisibleFormatCharactersAreDroppedFromTheWordsAndTheConfirmersName()
    {
        // Direction marks, zero-width spaces and a soft hyphen, as a message pasted from a chat may carry them.
        Assert.AreEqual(
            "NASM CPT, 2019",
            CoachCertificateLine.NormalizeWhat("‎​NASM­ CPT,‏ 2019﻿"));
        Assert.AreEqual("Tarek Bou", CoachCertificateLine.NormalizeConfirmedByName("‫Tarek⁩ Bou‍"));
        // A tag character outside the basic plane is one character, dropped whole, never half a pair.
        Assert.AreEqual("Owns a gym", CoachCertificateLine.NormalizeWhat("Owns a󠀠 gym"));
        // Arabic words and a letter outside the basic plane are kept as they are.
        Assert.AreEqual("مدرب \U0001D400", CoachCertificateLine.NormalizeWhat("مدرب \U0001D400"));
        // Nothing but format characters is no line at all.
        var empty = Assert.ThrowsExactly<ArgumentException>(() => CoachCertificateLine.NormalizeWhat("​‍﻿"));
        Assert.AreEqual(CoachCertificateText.WhatRequired, empty.PersonMessage());
    }

    // ---- helpers ----

    private static CoachCertificateLine Waiting() =>
        CoachCertificateLine.Add(TenantId, CoachUserId, "NASM CPT, 2019", ShownOn, AddedOn, AdminUserId);

    private static CoachCertificateLine Confirmed()
    {
        var line = Waiting();
        line.Confirm("Rami Saade", ConfirmedAt);
        return line;
    }

    private static CoachCertificateLine ConfirmedLongAgo()
    {
        var day = DateOnly.FromDateTime(ConfirmedLongAgoAt.UtcDateTime);
        var line = CoachCertificateLine.Add(TenantId, CoachUserId, "Owns Iron Gym since 2015", day, day, AdminUserId);
        line.Confirm("Rami Saade", ConfirmedLongAgoAt);
        return line;
    }

    private static CoachCertificateLine Hidden(CoachCertificateLine line)
    {
        line.SetShown(false);
        return line;
    }

    private static CoachCertificateLine Shown(CoachCertificateLine line)
    {
        line.SetShown(true);
        return line;
    }

    private static CoachCertificateLine TakenDown(DateTimeOffset takenDownAt) => TakenDown(Confirmed(), takenDownAt);

    private static CoachCertificateLine TakenDown(CoachCertificateLine line, DateTimeOffset takenDownAt)
    {
        line.TakeDown(SecondAdminUserId, takenDownAt);
        return line;
    }

    private static CoachCertificateLine ErasedOnRequest(CoachCertificateLine line)
    {
        line.EraseOnRequest(SecondAdminUserId, RequestedOn, Now);
        return line;
    }

    private static CoachCertificateLine ErasedAfterKeepingPeriod(CoachCertificateLine line)
    {
        line.EraseAfterKeepingPeriod(TwelveMonths, Now);
        return line;
    }

    private static void AssertNothingChangesAfter(CoachCertificateLine line)
    {
        var facts = FactsOf(line);
        var coachShows = line.CoachShows;
        var later = Now.AddMonths(1);

        Assert.AreEqual(
            CoachCertificateText.ShownNotConfirmed,
            Assert.ThrowsExactly<InvalidOperationException>(() => line.SetShown(true)).Message);
        Assert.AreEqual(
            CoachCertificateText.ShownNotConfirmed,
            Assert.ThrowsExactly<InvalidOperationException>(() => line.SetShown(false)).Message);
        Assert.AreEqual(
            CoachCertificateText.EraseNotConfirmed,
            Assert.ThrowsExactly<InvalidOperationException>(() => line.EraseOnRequest(AdminUserId, RequestedOn, later)).Message);
        Assert.AreEqual(
            CoachCertificateText.KeepingPeriodNotTakenDown,
            Assert.ThrowsExactly<InvalidOperationException>(() => line.EraseAfterKeepingPeriod(TwelveMonths, later)).Message);
        Assert.AreEqual(
            CoachCertificateText.TakeDownNotConfirmed,
            Assert.ThrowsExactly<InvalidOperationException>(() => line.TakeDown(AdminUserId, later)).Message);
        Assert.AreEqual(
            CoachCertificateText.ConfirmNotWaiting,
            Assert.ThrowsExactly<InvalidOperationException>(() => line.Confirm("Someone Else", later)).Message);
        Assert.AreEqual(
            CoachCertificateText.DropNotWaiting,
            Assert.ThrowsExactly<InvalidOperationException>(line.EnsureCanDrop).Message);

        Assert.AreEqual(facts, FactsOf(line), "Nothing after the erasure moved the line.");
        Assert.AreEqual(coachShows, line.CoachShows);
    }

    private static LineFacts FactsOf(CoachCertificateLine line) => new(
        line.Id,
        line.TenantId,
        line.CoachUserId,
        line.What,
        line.ShownOn,
        line.RecordedByUserId,
        line.ConfirmedAtUtc,
        line.ConfirmedByName,
        line.TakenDownAtUtc,
        line.TakenDownByUserId,
        line.ErasedAtUtc,
        line.ErasedByUserId,
        line.ErasureReason,
        line.RequestedOn,
        line.State);

    /// <summary>Everything about a line but the coach's switch, compared as one value.</summary>
    private readonly record struct LineFacts(
        Guid Id,
        Guid TenantId,
        Guid CoachUserId,
        string What,
        DateOnly? ShownOn,
        Guid RecordedByUserId,
        DateTimeOffset? ConfirmedAtUtc,
        string? ConfirmedByName,
        DateTimeOffset? TakenDownAtUtc,
        Guid? TakenDownByUserId,
        DateTimeOffset? ErasedAtUtc,
        Guid? ErasedByUserId,
        CoachCertificateErasureReason? ErasureReason,
        DateOnly? RequestedOn,
        CoachCertificateLineState State);
}
