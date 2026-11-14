using TB.Gym.Modules.Strength;
using TB.Gym.Modules.Training;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// The notes plan's N9c3, the house's programs and Start (TRN-034) and a trainee's own max (STR-021): a listing's
/// terms, how runs are matched, a program's unit and the lifts that need a max, a block's dates inside a pass, when a
/// run's later block opens, the program week a session may be started early in, which max a lift starts from, the
/// listing and the start row, and the bounds of a max a trainee types. Every name, date and figure is the tests' own.
/// </summary>
[TestClass]
public sealed class N9c3HouseProgramDomainTests
{
    private static readonly Guid HouseId = Guid.Parse("10000000-0000-0000-0000-0000000009c3");
    private static readonly Guid ProfileId = Guid.Parse("30000000-0000-0000-0000-0000000009c3");
    private static readonly Guid TemplateId = Guid.Parse("50000000-0000-0000-0000-0000000009c3");
    private static readonly Guid VersionId = Guid.Parse("50000000-0000-0000-0000-0000000019c3");
    private static readonly Guid EnrollmentId = Guid.Parse("60000000-0000-0000-0000-0000000009c3");
    private static readonly Guid MesocycleId = Guid.Parse("70000000-0000-0000-0000-0000000009c3");
    private static readonly Guid SquatId = Guid.Parse("80000000-0000-0000-0000-0000000009c3");

    // A Saturday, in the house's day.
    private static readonly DateOnly Today = new(2026, 11, 14);

    // ---------- a listing's terms ----------

    [TestMethod]
    public void N9c3TermsTrimTheSuitsLineAndDefaultTheIncrementAndRoundingWithNoRun()
    {
        var (terms, problems) = HouseProgramRules.Terms("  Lifters new to a barbell.  ", null, null, null, null);
        Assert.IsEmpty(problems);
        Assert.AreEqual(
            new HouseProgramTerms("Lifters new to a barbell.", null, null, null, 2.5m, TrainingLoadRoundingMode.Nearest),
            terms);

        // A run's name of spaces alone is no run, and nothing asks for its place.
        var (noRun, noRunProblems) = HouseProgramRules.Terms("Anyone", "   ", null, null, null);
        Assert.IsEmpty(noRunProblems);
        Assert.AreEqual(((string?)null, (string?)null, (int?)null), (noRun!.RunName, noRun.RunKey, noRun.RunPosition));
    }

    [TestMethod]
    public void N9c3TermsKeepARunSingleSpacedWithItsKeyPlaceIncrementAndRounding()
    {
        var (terms, problems) = HouseProgramRules.Terms("Anyone", "  Strength   Base  ", 2, 1.25m, TrainingLoadRoundingMode.Down);
        Assert.IsEmpty(problems);
        Assert.AreEqual(
            new HouseProgramTerms("Anyone", "Strength Base", "strength base", 2, 1.25m, TrainingLoadRoundingMode.Down),
            terms);

        var (up, _) = HouseProgramRules.Terms("Anyone", "Peak", 52, 5m, TrainingLoadRoundingMode.Up);
        Assert.AreEqual((52, 5m, TrainingLoadRoundingMode.Up), (up!.RunPosition, up.LoadIncrement, up.LoadRoundingMode));
    }

    [TestMethod]
    public void N9c3SuitsIsRequiredOnOneLineOfAtMostTwoHundredCharacters()
    {
        foreach (var empty in new[] { null, string.Empty, "   ", " \r\n " })
        {
            var (terms, problems) = HouseProgramRules.Terms(empty, null, null, null, null);
            Assert.IsNull(terms, $"'{empty}'");
            Assert.AreEqual("suits", Keys(problems), $"'{empty}'");
            Assert.AreEqual("Say in one line whom this program suits.", problems["suits"]);
        }

        foreach (var twoLines in new[] { "Line one\nLine two", "Line one\rLine two", "Tab\there", $"Line one{(char)0x2028}Line two", $"Line one{(char)0x2029}Line two" })
        {
            var (terms, problems) = HouseProgramRules.Terms(twoLines, null, null, null, null);
            Assert.IsNull(terms, twoLines);
            Assert.AreEqual("Keep whom it suits to one line.", problems["suits"], twoLines);
        }

        var longest = new string('s', 200);
        Assert.AreEqual(longest, HouseProgramRules.Terms(longest, null, null, null, null).Terms!.Suits);
        Assert.AreEqual(longest, HouseProgramRules.Terms("  " + longest + "  ", null, null, null, null).Terms!.Suits, "Counted after trimming.");
        var (tooLong, tooLongProblems) = HouseProgramRules.Terms(longest + "s", null, null, null, null);
        Assert.IsNull(tooLong);
        Assert.AreEqual("Keep whom it suits to 200 characters or fewer.", tooLongProblems["suits"]);
    }

    [TestMethod]
    public void N9c3ARunsNameAndPlaceGoTogetherFromOneToFiftyTwo()
    {
        Assert.AreEqual("runPosition", Keys(HouseProgramRules.Terms("Anyone", "Strength Base", null, null, null).Problems));
        Assert.AreEqual("runName", Keys(HouseProgramRules.Terms("Anyone", null, 2, null, null).Problems));
        Assert.AreEqual("runName", Keys(HouseProgramRules.Terms("Anyone", "   ", 2, null, null).Problems));

        foreach (var refused in new[] { int.MinValue, -1, 0, 53, int.MaxValue })
        {
            var (terms, problems) = HouseProgramRules.Terms("Anyone", "Strength Base", refused, null, null);
            Assert.IsNull(terms, $"{refused}");
            Assert.AreEqual("runPosition", Keys(problems), $"{refused}");
        }

        foreach (var kept in new[] { 1, 2, 51, 52 })
        {
            Assert.AreEqual(kept, HouseProgramRules.Terms("Anyone", "Strength Base", kept, null, null).Terms!.RunPosition);
        }
    }

    [TestMethod]
    public void N9c3ARunsNameIsOneLineOfAtMostEightyCharactersOnceSingleSpaced()
    {
        foreach (var twoLines in new[] { "Strength\nBase", "Strength\tBase", $"Strength{(char)0x2028}Base" })
        {
            var (terms, problems) = HouseProgramRules.Terms("Anyone", twoLines, 1, null, null);
            Assert.IsNull(terms, twoLines);
            Assert.AreEqual("runName", Keys(problems), twoLines);
            Assert.AreEqual("Keep the run's name to one line.", problems["runName"]);
        }

        var longest = new string('r', 80);
        Assert.AreEqual(longest, HouseProgramRules.Terms("Anyone", longest, 1, null, null).Terms!.RunName);
        var (tooLong, tooLongProblems) = HouseProgramRules.Terms("Anyone", longest + "r", 1, null, null);
        Assert.IsNull(tooLong);
        Assert.AreEqual("Keep the run's name to 80 characters or fewer.", tooLongProblems["runName"]);

        // 84 characters as typed, 80 once its spaces are collapsed.
        var spaced = new string('a', 40) + "     " + new string('b', 39);
        var (collapsed, _) = HouseProgramRules.Terms("Anyone", spaced, 1, null, null);
        Assert.AreEqual(new string('a', 40) + " " + new string('b', 39), collapsed!.RunName);

        // Both of a run's problems at once.
        Assert.AreEqual("runName,runPosition", Keys(HouseProgramRules.Terms("Anyone", longest + "r", null, null, null).Problems));
    }

    [TestMethod]
    public void N9c3TheIncrementIsAboveZeroAtMostFiftyWithTwoDecimalsAtMost()
    {
        foreach (var kept in new[] { 0.01m, 0.5m, 1.25m, 1.250m, 2.5m, 5m, 49.99m, 50m, 50.00m })
        {
            var (terms, problems) = HouseProgramRules.Terms("Anyone", null, null, kept, null);
            Assert.IsEmpty(problems, $"{kept}");
            Assert.AreEqual(kept, terms!.LoadIncrement);
        }

        foreach (var refused in new[] { -2.5m, -0.01m, 0m, 0.001m, 1.255m, 50.01m, 50.001m, 100m })
        {
            var (terms, problems) = HouseProgramRules.Terms("Anyone", null, null, refused, null);
            Assert.IsNull(terms, $"{refused}");
            Assert.AreEqual("loadIncrement", Keys(problems), $"{refused}");
        }
    }

    [TestMethod]
    public void N9c3TheRoundingIsNearestDownOrUpAndEveryProblemIsAnsweredAtOnce()
    {
        foreach (var refused in new[] { (TrainingLoadRoundingMode)0, (TrainingLoadRoundingMode)4, (TrainingLoadRoundingMode)(-1) })
        {
            var (terms, problems) = HouseProgramRules.Terms("Anyone", null, null, null, refused);
            Assert.IsNull(terms);
            Assert.AreEqual("loadRoundingMode", Keys(problems), $"{refused}");
        }

        var (none, all) = HouseProgramRules.Terms(null, null, 3, 0m, (TrainingLoadRoundingMode)9);
        Assert.IsNull(none);
        Assert.AreEqual("loadIncrement,loadRoundingMode,runName,suits", Keys(all));
    }

    // ---------- runs ----------

    [TestMethod]
    public void N9c3ARunIsMatchedByItsNameTrimmedSingleSpacedAndLowerCase()
    {
        Assert.IsNull(HouseProgramRules.RunKeyOf(null));
        Assert.IsNull(HouseProgramRules.RunKeyOf(string.Empty));
        Assert.IsNull(HouseProgramRules.RunKeyOf("    "));
        foreach (var typed in new[] { "Strength Base", "strength base", "STRENGTH BASE", "  Strength    Base ", "sTrEnGtH  bAsE" })
        {
            Assert.AreEqual("strength base", HouseProgramRules.RunKeyOf(typed), typed);
        }

        Assert.AreEqual("été fort", HouseProgramRules.RunKeyOf(" ÉTÉ  Fort "));
        Assert.AreNotEqual(HouseProgramRules.RunKeyOf("Strength Base"), HouseProgramRules.RunKeyOf("StrengthBase"));
    }

    // ---------- a program's unit and its lifts that need a max ----------

    [TestMethod]
    public void N9c3AProgramsUnitIsItsLoadedSetsUnitKilogramsWithNoneAndMixedWhenTheyDiffer()
    {
        Assert.AreEqual(new HouseProgramUnit(false, TrainingLoadUnit.Kilogram), HouseProgramRules.UnitOf([]));

        // "No prescribed load" sets never count, whatever unit they carry.
        Assert.AreEqual(
            new HouseProgramUnit(false, TrainingLoadUnit.Kilogram),
            HouseProgramRules.UnitOf([(TrainingLoadStrategy.None, null), (TrainingLoadStrategy.None, TrainingLoadUnit.Pound)]));
        Assert.AreEqual(
            new HouseProgramUnit(false, TrainingLoadUnit.Pound),
            HouseProgramRules.UnitOf(
            [
                (TrainingLoadStrategy.Direct, TrainingLoadUnit.Pound),
                (TrainingLoadStrategy.PercentageWorkingMax, TrainingLoadUnit.Pound),
                (TrainingLoadStrategy.None, TrainingLoadUnit.Kilogram),
                (TrainingLoadStrategy.LastTimeStep, null),
            ]));
        Assert.AreEqual(
            new HouseProgramUnit(false, TrainingLoadUnit.Kilogram),
            HouseProgramRules.UnitOf([(TrainingLoadStrategy.RpeChart, TrainingLoadUnit.Kilogram), (TrainingLoadStrategy.Direct, TrainingLoadUnit.Kilogram)]));

        var mixed = HouseProgramRules.UnitOf(
        [
            (TrainingLoadStrategy.Direct, TrainingLoadUnit.Kilogram),
            (TrainingLoadStrategy.RpeBasedEpley, TrainingLoadUnit.Pound),
        ]);
        Assert.IsTrue(mixed.IsMixed);
        Assert.IsTrue(HouseProgramRules.UnitOf([(TrainingLoadStrategy.LastTimeStep, TrainingLoadUnit.Pound), (TrainingLoadStrategy.Direct, TrainingLoadUnit.Kilogram)]).IsMixed);

        Assert.ThrowsExactly<ArgumentNullException>(() => HouseProgramRules.UnitOf(null!));
    }

    [TestMethod]
    public void N9c3OnlyASetWorkedOutFromAMaxNeedsOne()
    {
        var needing = Enum.GetValues<TrainingLoadStrategy>().Where(HouseProgramRules.NeedsMax).ToArray();
        CollectionAssert.AreEquivalent(
            new[] { TrainingLoadStrategy.PercentageWorkingMax, TrainingLoadStrategy.RpeBasedEpley, TrainingLoadStrategy.RpeChart },
            needing);
        Assert.IsFalse(HouseProgramRules.NeedsMax(TrainingLoadStrategy.None));
        Assert.IsFalse(HouseProgramRules.NeedsMax(TrainingLoadStrategy.Direct));
        Assert.IsFalse(HouseProgramRules.NeedsMax(TrainingLoadStrategy.LastTimeStep));
    }

    // ---------- a block's dates inside a pass ----------

    [TestMethod]
    public void N9c3ABlockRunsWholeWeeksHalfOpenFromItsStart()
    {
        Assert.AreEqual(new DateOnly(2026, 12, 12), HouseProgramRules.EndExclusive(Today, 4));
        Assert.AreEqual(new DateOnly(2026, 11, 21), HouseProgramRules.EndExclusive(Today, 1));
        Assert.AreEqual(new DateOnly(2028, 1, 31), HouseProgramRules.EndExclusive(new DateOnly(2027, 12, 20), 6));
        Assert.AreEqual(new DateOnly(2028, 2, 29), HouseProgramRules.EndExclusive(new DateOnly(2028, 2, 1), 4));

        // A program of no weeks is still a week long.
        Assert.AreEqual(Today.AddDays(7), HouseProgramRules.EndExclusive(Today, 0));
        Assert.AreEqual(Today.AddDays(7), HouseProgramRules.EndExclusive(Today, -3));

        Assert.AreEqual(new DateOnly(2026, 11, 16), HouseProgramRules.LastStartDay(new DateOnly(2026, 12, 14), 4));
        Assert.AreEqual(new DateOnly(2028, 2, 23), HouseProgramRules.LastStartDay(new DateOnly(2028, 3, 1), 1));
        Assert.AreEqual(new DateOnly(2026, 12, 7), HouseProgramRules.LastStartDay(new DateOnly(2026, 12, 14), 0));
    }

    [TestMethod]
    public void N9c3ABlockFitsWhenItEndsOnThePassesEndAndNotADayLater()
    {
        // A pass of 30 days: Saturday 14 November to Sunday 13 December 2026, its end exclusive Monday 14 December.
        var passStart = Today;
        var passEnd = new DateOnly(2026, 12, 14);

        Assert.IsTrue(HouseProgramRules.Fits(passStart, 4, passStart, passEnd), "From the pass's first day.");
        var last = HouseProgramRules.LastStartDay(passEnd, 4);
        Assert.AreEqual(new DateOnly(2026, 11, 16), last);
        Assert.AreEqual(passEnd, HouseProgramRules.EndExclusive(last, 4));
        Assert.IsTrue(HouseProgramRules.Fits(last, 4, passStart, passEnd), "Its end exclusive is the pass's: it fits.");
        Assert.IsFalse(HouseProgramRules.Fits(last.AddDays(1), 4, passStart, passEnd), "A day later it would outrun the pass.");
        Assert.IsFalse(HouseProgramRules.Fits(passStart.AddDays(-1), 4, passStart, passEnd), "Never before the pass starts.");

        for (var weeks = 1; weeks <= 4; weeks++)
        {
            var lastDay = HouseProgramRules.LastStartDay(passEnd, weeks);
            Assert.IsTrue(HouseProgramRules.Fits(lastDay, weeks, passStart, passEnd), $"{weeks} weeks");
            Assert.IsFalse(HouseProgramRules.Fits(lastDay.AddDays(1), weeks, passStart, passEnd), $"{weeks} weeks");
        }

        // A block longer than the pass never fits: its last start day is before the pass begins.
        Assert.AreEqual(new DateOnly(2026, 11, 9), HouseProgramRules.LastStartDay(passEnd, 5));
        Assert.IsTrue(HouseProgramRules.LastStartDay(passEnd, 5) < passStart);
        Assert.IsFalse(HouseProgramRules.Fits(passStart, 5, passStart, passEnd));
        Assert.IsFalse(HouseProgramRules.Fits(HouseProgramRules.LastStartDay(passEnd, 5), 5, passStart, passEnd));
        Assert.IsFalse(HouseProgramRules.Fits(passStart, 52, passStart, passEnd));
    }

    // ---------- when a run's block opens ----------

    [TestMethod]
    public void N9c3ABlockWithNoRunOrTheFirstOfARunAlwaysOpens()
    {
        var opened = new HouseProgramBlockOpening(true, false, null);
        Assert.AreEqual(opened, HouseProgramRules.Opening(null, [], Today));
        Assert.AreEqual(opened, HouseProgramRules.Opening(1, [], Today));
        Assert.AreEqual(opened, HouseProgramRules.Opening(1, [Block(1, Today.AddDays(20)), Block(2, Today.AddDays(40))], Today));
        Assert.AreEqual(opened, HouseProgramRules.Opening(null, [Block(1, Today.AddDays(20))], Today));

        Assert.ThrowsExactly<ArgumentNullException>(() => HouseProgramRules.Opening(2, null!, Today));
    }

    [TestMethod]
    public void N9c3ALaterBlockOpensOnTheDayTheBlockBeforeHasEnded()
    {
        // Never started first.
        Assert.AreEqual(new HouseProgramBlockOpening(false, false, null), HouseProgramRules.Opening(2, [], Today));

        // Started and still running: it opens on the block before's end exclusive.
        var running = new DateOnly(2026, 12, 12);
        Assert.AreEqual(new HouseProgramBlockOpening(false, true, running), HouseProgramRules.Opening(2, [Block(1, running)], Today));

        // Its last day is today: still running.
        Assert.AreEqual(
            new HouseProgramBlockOpening(false, true, Today.AddDays(1)),
            HouseProgramRules.Opening(2, [Block(1, Today.AddDays(1))], Today));

        // Its last day was yesterday: open from today, done or not.
        Assert.AreEqual(new HouseProgramBlockOpening(true, true, Today), HouseProgramRules.Opening(2, [Block(1, Today)], Today));
        var longAgo = new DateOnly(2026, 10, 1);
        Assert.AreEqual(new HouseProgramBlockOpening(true, true, longAgo), HouseProgramRules.Opening(2, [Block(1, longAgo)], Today));
        Assert.AreEqual(new HouseProgramBlockOpening(true, true, longAgo), HouseProgramRules.Opening(52, [Block(51, longAgo)], Today));
    }

    [TestMethod]
    public void N9c3ACancelledBlockDoesNotCountAndTwoStartsTakeTheEarliestEnd()
    {
        var longAgo = new DateOnly(2026, 10, 1);
        Assert.AreEqual(
            new HouseProgramBlockOpening(false, false, null),
            HouseProgramRules.Opening(2, [Block(1, longAgo, cancelled: true)], Today));
        Assert.AreEqual(
            new HouseProgramBlockOpening(false, true, new DateOnly(2026, 12, 12)),
            HouseProgramRules.Opening(2, [Block(1, longAgo, cancelled: true), Block(1, new DateOnly(2026, 12, 12))], Today));

        Assert.AreEqual(
            new HouseProgramBlockOpening(true, true, new DateOnly(2026, 11, 1)),
            HouseProgramRules.Opening(2, [Block(1, new DateOnly(2026, 12, 12)), Block(1, new DateOnly(2026, 11, 1))], Today));
        Assert.AreEqual(
            new HouseProgramBlockOpening(false, true, new DateOnly(2026, 11, 20)),
            HouseProgramRules.Opening(2, [Block(1, new DateOnly(2026, 12, 12)), Block(1, new DateOnly(2026, 11, 20))], Today));
    }

    [TestMethod]
    public void N9c3OnlyTheBlockJustBeforeOpensALaterOne()
    {
        var longAgo = new DateOnly(2026, 10, 1);
        Assert.AreEqual(new HouseProgramBlockOpening(false, false, null), HouseProgramRules.Opening(3, [Block(1, longAgo)], Today));
        Assert.AreEqual(
            new HouseProgramBlockOpening(false, false, null),
            HouseProgramRules.Opening(2, [Block(2, longAgo), Block(3, longAgo)], Today));
        Assert.AreEqual(
            new HouseProgramBlockOpening(true, true, longAgo),
            HouseProgramRules.Opening(3, [Block(1, longAgo), Block(2, longAgo)], Today));
    }

    // ---------- the program week a session may be started early in ----------

    [TestMethod]
    public void N9c3ASessionOfTheCurrentProgramWeekCountsFromTheProgramsStartNotTheCalendar()
    {
        var start = new DateOnly(2026, 11, 12);
        Assert.AreEqual(DayOfWeek.Thursday, start.DayOfWeek);
        var cases = new (DateOnly Session, DateOnly Today, bool Expected, string Why)[]
        {
            (new(2026, 11, 12), new(2026, 11, 12), true, "the first day itself"),
            (new(2026, 11, 18), new(2026, 11, 12), true, "week 1's last day from its first"),
            (new(2026, 11, 16), new(2026, 11, 14), true, "a later day of week 1"),
            (new(2026, 11, 16), new(2026, 11, 15), true, "Sunday to Monday: a calendar week apart, one program week"),
            (new(2026, 11, 13), new(2026, 11, 16), true, "an earlier day of the same week"),
            (new(2026, 11, 19), new(2026, 11, 18), false, "next week's first day from week 1's last"),
            (new(2026, 11, 19), new(2026, 11, 14), false, "next week"),
            (new(2026, 11, 25), new(2026, 11, 19), true, "week 2's last day from its first"),
            (new(2026, 11, 26), new(2026, 11, 25), false, "week 3 from week 2"),
            (new(2026, 11, 18), new(2026, 11, 19), false, "last week's day"),
            (new(2026, 11, 12), new(2026, 11, 11), false, "before the program starts"),
            (new(2026, 11, 13), new(2026, 11, 11), false, "before the program starts, a day of its first week"),
            (new(2026, 11, 9), new(2026, 11, 12), false, "a day before the program's start"),
        };
        foreach (var (session, today, expected, why) in cases)
        {
            Assert.AreEqual(expected, HouseProgramRules.InCurrentWeek(start, session, today), why);
        }
    }

    // ---------- which max a lift starts from ----------

    [TestMethod]
    public void N9c3ARecordedTrainingMaxBeatsATestedOneWhateverItsDate()
    {
        var trainingMax = Candidate(1, 100m, new DateOnly(2026, 11, 1), trainingMax: true);
        var olderTested = Candidate(2, 120m, new DateOnly(2026, 10, 20), trainingMax: false);
        var newerTested = Candidate(3, 125m, new DateOnly(2026, 11, 10), trainingMax: false);

        Assert.AreEqual(Typed(trainingMax), HouseProgramRules.PickMax([olderTested, trainingMax], null));
        Assert.AreEqual(Typed(trainingMax), HouseProgramRules.PickMax([newerTested, trainingMax, olderTested], null));

        // The newest training max of several: by its date, then by when it was recorded.
        var newerTraining = Candidate(4, 105m, new DateOnly(2026, 11, 5), trainingMax: true, hour: 9);
        var sameDayLater = Candidate(5, 107.5m, new DateOnly(2026, 11, 5), trainingMax: true, hour: 10);
        Assert.AreEqual(Typed(newerTraining), HouseProgramRules.PickMax([trainingMax, newerTraining], null));
        Assert.AreEqual(Typed(sameDayLater), HouseProgramRules.PickMax([sameDayLater, trainingMax, newerTraining], null));
    }

    [TestMethod]
    public void N9c3WithNoTrainingMaxTheNewestOfAnyKindIsTaken()
    {
        var older = Candidate(1, 120m, new DateOnly(2026, 10, 20), trainingMax: false);
        var newer = Candidate(2, 125m, new DateOnly(2026, 11, 8), trainingMax: false);
        Assert.AreEqual(Typed(newer), HouseProgramRules.PickMax([newer, older], null));
        Assert.AreEqual(Typed(newer), HouseProgramRules.PickMax([older, newer], null));
    }

    [TestMethod]
    public void N9c3TheLastProgramsMaxWinsATieAndWhenNewerAndARecordedOneWinsWhenNewer()
    {
        var recorded = Candidate(1, 105m, new DateOnly(2026, 11, 5), trainingMax: true);

        // The same day: the one recorded later wins, and the carried one an exact tie.
        var carriedLater = Candidate(9, 102.5m, new DateOnly(2026, 11, 5), trainingMax: true, hour: 10);
        Assert.AreEqual(Carried(carriedLater), HouseProgramRules.PickMax([recorded], carriedLater));
        var carriedEarlier = Candidate(9, 102.5m, new DateOnly(2026, 11, 5), trainingMax: true, hour: 8);
        Assert.AreEqual(Typed(recorded), HouseProgramRules.PickMax([recorded], carriedEarlier), "Typed after it the same day.");
        var tie = Candidate(9, 102.5m, new DateOnly(2026, 11, 5), trainingMax: true);
        Assert.AreEqual(Carried(tie), HouseProgramRules.PickMax([recorded], tie), "An exact tie goes to the carried max.");

        var newerCarried = Candidate(9, 110m, new DateOnly(2026, 11, 10), trainingMax: true);
        Assert.AreEqual(Carried(newerCarried), HouseProgramRules.PickMax([recorded], newerCarried));

        var olderCarried = Candidate(9, 95m, new DateOnly(2026, 11, 1), trainingMax: true);
        Assert.AreEqual(Typed(recorded), HouseProgramRules.PickMax([recorded], olderCarried));

        // The recorded side is its training max, even when a tested max of theirs is newer than the carried one.
        var newerTested = Candidate(2, 130m, new DateOnly(2026, 11, 12), trainingMax: false);
        Assert.AreEqual(Carried(newerCarried), HouseProgramRules.PickMax([recorded, newerTested], newerCarried));
        Assert.AreEqual(Typed(newerTested), HouseProgramRules.PickMax([newerTested], newerCarried));
    }

    [TestMethod]
    public void N9c3WithNothingRecordedTheLastProgramsMaxIsTakenAndWithNeitherNone()
    {
        var carried = Candidate(9, 100m, new DateOnly(2026, 10, 1), trainingMax: true);
        Assert.AreEqual(Carried(carried), HouseProgramRules.PickMax([], carried));
        Assert.IsNull(HouseProgramRules.PickMax([], null));

        var recorded = Candidate(1, 100m, new DateOnly(2026, 10, 1), trainingMax: true);
        Assert.AreEqual(Typed(recorded), HouseProgramRules.PickMax([recorded], null));

        Assert.ThrowsExactly<ArgumentNullException>(() => HouseProgramRules.PickMax(null!, carried));
    }

    // ---------- words ----------

    [TestMethod]
    public void N9c3TheLiftsASentenceNamesAndTheDaysItSays()
    {
        Assert.AreEqual(string.Empty, HouseProgramRules.Names([]));
        Assert.AreEqual("Back Squat", HouseProgramRules.Names(["Back Squat"]));
        Assert.AreEqual("Back Squat and Bench Press", HouseProgramRules.Names(["Back Squat", "Bench Press"]));
        Assert.AreEqual("Back Squat, Bench Press and Deadlift", HouseProgramRules.Names(["Back Squat", "Bench Press", "Deadlift"]));
        Assert.AreEqual(
            "Back Squat, Bench Press, Deadlift and Overhead Press",
            HouseProgramRules.Names(["Back Squat", "Bench Press", "Deadlift", "Overhead Press"]));
        Assert.ThrowsExactly<ArgumentNullException>(() => HouseProgramRules.Names(null!));

        Assert.AreEqual("Sat 14 Nov 2026", HouseProgramRules.Day(Today));
        Assert.AreEqual("Tue 29 Feb 2028", HouseProgramRules.Day(new DateOnly(2028, 2, 29)));
    }

    [TestMethod]
    public void N9c3TheRuleIsNamedAndVersionedAndItsCodesAreTheContracts()
    {
        Assert.AreEqual(("HouseProgramStart", "1.0"), (HouseProgramRules.Key, HouseProgramRules.Version));
        Assert.AreEqual(
            "house_program_not_offered house_program_needs_pass house_program_changed house_program_unit " +
            "house_program_block_not_open mesocycle_overlap house_program_does_not_fit house_program_needs_maxes " +
            "house_program_run_position_taken program_plan_closed",
            string.Join(
                " ",
                HouseProgramCodes.NotOffered,
                HouseProgramCodes.NeedsPass,
                HouseProgramCodes.Changed,
                HouseProgramCodes.MixedUnits,
                HouseProgramCodes.BlockNotOpen,
                HouseProgramCodes.Overlap,
                HouseProgramCodes.DoesNotFit,
                HouseProgramCodes.NeedsMaxes,
                HouseProgramCodes.PositionTaken,
                HouseProgramCodes.PlanClosed));
    }

    // ---------- the listing ----------

    [TestMethod]
    public void N9c3AListingIsOfferedWithItsTermsWithdrawnAndOfferedAgainByAChange()
    {
        var first = Terms("Lifters new to a barbell.", "Strength Base", 1, 2.5m, TrainingLoadRoundingMode.Nearest);
        var listing = HouseProgramListing.Offer(HouseId, TemplateId, first);
        Assert.AreNotEqual(Guid.Empty, listing.Id);
        Assert.AreEqual(
            (HouseId, TemplateId, "Lifters new to a barbell.", "Strength Base", "strength base", (int?)1, 2.5m, TrainingLoadRoundingMode.Nearest, true),
            (listing.TenantId, listing.TemplateId, listing.Suits, listing.RunName, listing.RunKey, listing.RunPosition,
                listing.LoadIncrement, listing.LoadRoundingMode, listing.IsOffered));

        listing.Withdraw();
        Assert.IsFalse(listing.IsOffered);
        Assert.AreEqual(("Strength Base", (int?)1), (listing.RunName, listing.RunPosition), "Withdrawing keeps its terms.");
        listing.Withdraw();
        Assert.IsFalse(listing.IsOffered);

        var id = listing.Id;
        listing.Change(Terms("Lifters past their first year.", "  Strength  Peak ", 2, 1.25m, TrainingLoadRoundingMode.Down));
        Assert.AreEqual(
            (id, TemplateId, "Lifters past their first year.", "Strength Peak", "strength peak", (int?)2, 1.25m, TrainingLoadRoundingMode.Down, true),
            (listing.Id, listing.TemplateId, listing.Suits, listing.RunName, listing.RunKey, listing.RunPosition,
                listing.LoadIncrement, listing.LoadRoundingMode, listing.IsOffered),
            "A change offers it again.");

        listing.Change(Terms("Anyone", null, null, null, null));
        Assert.AreEqual(((string?)null, (string?)null, (int?)null, true), (listing.RunName, listing.RunKey, listing.RunPosition, listing.IsOffered));

        Assert.ThrowsExactly<ArgumentNullException>(() => listing.Change(null!));
        Assert.ThrowsExactly<ArgumentException>(() => HouseProgramListing.Offer(HouseId, Guid.Empty, first));
        Assert.ThrowsExactly<ArgumentException>(() => HouseProgramListing.Offer(Guid.Empty, TemplateId, first));
        Assert.ThrowsExactly<ArgumentNullException>(() => HouseProgramListing.Offer(HouseId, TemplateId, null!));
    }

    // ---------- the start row ----------

    [TestMethod]
    public void N9c3AStartCopiesTheListingsRunAndTheProgramsPlanAndDay()
    {
        var listing = HouseProgramListing.Offer(HouseId, TemplateId, Terms("Anyone", "Strength Base", 2, 2.5m, TrainingLoadRoundingMode.Nearest));
        var program = Program(Today);

        var start = HouseProgramStart.Record(listing, program, VersionId);
        Assert.AreNotEqual(Guid.Empty, start.Id);
        Assert.AreEqual(
            (HouseId, ProfileId, MesocycleId, listing.Id, TemplateId, VersionId, EnrollmentId),
            (start.TenantId, start.ClientProfileId, start.MesocycleId, start.ListingId, start.TemplateId, start.TemplateVersionId, start.EnrollmentId));
        Assert.AreEqual(("Strength Base", "strength base", (int?)2, Today), (start.RunName, start.RunKey, start.RunPosition, start.StartDate));

        // The listing changed or withdrawn later: the start keeps the run it had then.
        listing.Change(Terms("Anyone", "Peak", 1, 2.5m, TrainingLoadRoundingMode.Nearest));
        listing.Withdraw();
        Assert.AreEqual(("Strength Base", "strength base", (int?)2), (start.RunName, start.RunKey, start.RunPosition));

        var alone = HouseProgramListing.Offer(HouseId, TemplateId, Terms("Anyone", null, null, null, null));
        var noRun = HouseProgramStart.Record(alone, Program(new DateOnly(2026, 11, 20)), VersionId);
        Assert.AreEqual(((string?)null, (string?)null, (int?)null, new DateOnly(2026, 11, 20)), (noRun.RunName, noRun.RunKey, noRun.RunPosition, noRun.StartDate));

        Assert.ThrowsExactly<ArgumentNullException>(() => HouseProgramStart.Record(null!, program, VersionId));
        Assert.ThrowsExactly<ArgumentNullException>(() => HouseProgramStart.Record(listing, null!, VersionId));
        Assert.ThrowsExactly<ArgumentException>(() => HouseProgramStart.Record(listing, program, Guid.Empty));
    }

    // ---------- a trainee's own max ----------

    [TestMethod]
    public void N9c3ATraineesMaxIsAboveZeroAtMostFiveHundredKilogramsOrElevenHundredPoundsWithTwoDecimals()
    {
        var kept = new (decimal Value, LoadUnit Unit)[]
        {
            (0.01m, LoadUnit.Kilogram), (142.5m, LoadUnit.Kilogram), (102.25m, LoadUnit.Kilogram), (500m, LoadUnit.Kilogram),
            (500.00m, LoadUnit.Kilogram), (0.01m, LoadUnit.Pound), (500.01m, LoadUnit.Pound), (1100m, LoadUnit.Pound),
        };
        foreach (var (value, unit) in kept)
        {
            Assert.IsEmpty(TraineeMaxRule.Problems(value, unit), $"{value} {unit}");
        }

        var refused = new (decimal Value, LoadUnit Unit)[]
        {
            (0m, LoadUnit.Kilogram), (-1m, LoadUnit.Kilogram), (-0.01m, LoadUnit.Pound), (500.01m, LoadUnit.Kilogram),
            (600m, LoadUnit.Kilogram), (1100.01m, LoadUnit.Pound), (2000m, LoadUnit.Pound), (100.125m, LoadUnit.Kilogram),
            (0.001m, LoadUnit.Kilogram), (225.005m, LoadUnit.Pound),
        };
        foreach (var (value, unit) in refused)
        {
            var problems = TraineeMaxRule.Problems(value, unit);
            Assert.AreEqual("value", Keys(problems), $"{value} {unit}");
            StringAssert.Contains(problems["value"], unit == LoadUnit.Pound ? " lb" : " kg", $"{value} {unit}");
        }

        Assert.AreEqual((500m, 1100m), (TraineeMaxRule.KilogramCeiling, TraineeMaxRule.PoundCeiling));

        foreach (var unit in new[] { (LoadUnit)0, (LoadUnit)3 })
        {
            Assert.AreEqual("unit", Keys(TraineeMaxRule.Problems(100m, unit)), $"{unit}");
            Assert.AreEqual("unit", Keys(TraineeMaxRule.Problems(-1m, unit)), "An unknown unit is answered first.");
        }
    }

    [TestMethod]
    public void N9c3ATraineesMaxIsATrainingMaxTypedByHandDatedTheHousesDay()
    {
        var max = TraineeMaxRule.Record(HouseId, ProfileId, SquatId, 142.5m, LoadUnit.Kilogram, Today);
        Assert.AreNotEqual(Guid.Empty, max.Id);
        Assert.AreEqual(
            (HouseId, ProfileId, SquatId, StrengthMaxKind.CoachWorkingMax, 142.5m, LoadUnit.Kilogram, Today, StrengthMaxSource.Manual),
            (max.TenantId, max.ClientProfileId, max.ExerciseId, max.Kind, max.Value, max.Unit, max.EffectiveDate, max.Source));
        Assert.AreEqual(("TraineeTyped", "1.0"), (max.MethodKey, max.MethodVersion));
        Assert.AreEqual(("TraineeTyped", "1.0"), (TraineeMaxRule.MethodKey, TraineeMaxRule.MethodVersion));
        Assert.IsNull(max.SourceWorkoutExecutionId);
        Assert.IsNull(max.Note);
        Assert.IsNull(max.BasisLoad);

        var pounds = TraineeMaxRule.Record(HouseId, ProfileId, SquatId, 1100m, LoadUnit.Pound, new DateOnly(2026, 11, 20));
        Assert.AreEqual((1100m, LoadUnit.Pound, new DateOnly(2026, 11, 20)), (pounds.Value, pounds.Unit, pounds.EffectiveDate));

        foreach (var (value, unit) in new (decimal, LoadUnit)[]
                 {
                     (0m, LoadUnit.Kilogram), (500.01m, LoadUnit.Kilogram), (1100.01m, LoadUnit.Pound),
                     (100.125m, LoadUnit.Kilogram), (100m, (LoadUnit)0),
                 })
        {
            Assert.ThrowsExactly<ArgumentException>(
                () => TraineeMaxRule.Record(HouseId, ProfileId, SquatId, value, unit, Today),
                $"{value} {unit}");
        }
    }

    private static string Keys(IReadOnlyDictionary<string, string> problems) =>
        string.Join(",", problems.Keys.OrderBy(key => key, StringComparer.Ordinal));

    private static HouseProgramTerms Terms(
        string suits,
        string? runName,
        int? runPosition,
        decimal? increment,
        TrainingLoadRoundingMode? rounding)
    {
        var (terms, problems) = HouseProgramRules.Terms(suits, runName, runPosition, increment, rounding);
        Assert.IsEmpty(problems, string.Join("; ", problems.Values));
        return terms!;
    }

    private static HouseProgramRunBlock Block(int position, DateOnly endExclusive, bool cancelled = false) =>
        new(position, endExclusive, cancelled);

    private static HouseProgramMaxCandidate Candidate(int id, decimal value, DateOnly on, bool trainingMax, int hour = 9) =>
        new(
            Guid.Parse($"90000000-0000-0000-0000-{id:D12}"),
            value,
            on,
            trainingMax,
            new DateTimeOffset(on.Year, on.Month, on.Day, hour, 0, 0, TimeSpan.Zero));

    private static HouseProgramMaxPick Typed(HouseProgramMaxCandidate candidate) =>
        new(HouseProgramMaxSource.Typed, candidate.Id, candidate.Value, candidate.On);

    private static HouseProgramMaxPick Carried(HouseProgramMaxCandidate candidate) =>
        new(HouseProgramMaxSource.LastProgram, candidate.Id, candidate.Value, candidate.On);

    private static TrainingMesocycle Program(DateOnly start) =>
        TrainingMesocycle.CreateSnapshot(
            HouseId,
            ProfileId,
            EnrollmentId,
            TemplateId,
            VersionId,
            "Strength Base",
            start,
            "Asia/Beirut",
            MesocycleKind.Primary,
            TrainingLoadUnit.Kilogram,
            2.5m,
            TrainingLoadRoundingMode.Nearest,
            Guid.Parse("a0000000-0000-0000-0000-0000000009c3"),
            new ProgramBlueprint(
                "Strength Base",
                null,
                [
                    new TrainingWeekBlueprint(
                        null,
                        true,
                        [
                            new TrainingSessionBlueprint(
                                "Lower A",
                                0,
                                null,
                                [
                                    new ExercisePrescriptionBlueprint(
                                        SquatId,
                                        "Back Squat",
                                        0,
                                        true,
                                        PrescriptionModificationPolicy.CoachApprovedSwap,
                                        null,
                                        [],
                                        [],
                                        [
                                            new SetPrescriptionBlueprint(
                                                0,
                                                TrainingSetType.Normal,
                                                5,
                                                5,
                                                TrainingLoadStrategy.Direct,
                                                100m,
                                                TrainingLoadUnit.Kilogram,
                                                null,
                                                LoadStep: null,
                                                8m,
                                                ExertionDisplayPreference.Rpe,
                                                120,
                                                null,
                                                null,
                                                PrescribedLoad: 100m,
                                                CalculationStrategyKey: "CoachDirect",
                                                CalculationStrategyVersion: "1.0"),
                                        ]),
                                ]),
                        ]),
                ]),
            MesocycleId);
}
