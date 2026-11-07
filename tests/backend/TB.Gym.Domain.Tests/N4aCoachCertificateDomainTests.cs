using System.Globalization;
using System.Reflection;
using System.Text.RegularExpressions;
using TB.Gym.Modules.Identity;
using TB.Gym.Modules.Tenancy;
using TB.Gym.SharedKernel;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// The certificate record (notes plan N4a, CLI-021, ADR 0039): a line is the coach's proof on one line of 1 to 120
/// characters with the day it was shown, never TB Gym's own promises nor a protected health title; it is confirmed
/// once, dropped only while it waits, taken down only once confirmed, and erased on request with its words gone and
/// its dates kept; the sentence a reader will see is version 1 of one constant, its date in the space's language.
/// </summary>
[TestClass]
public sealed class N4aCoachCertificateDomainTests
{
    private static readonly Guid TenantId = Guid.Parse("10000000-0000-0000-0000-0000000000a4");
    private static readonly Guid CoachUserId = Guid.Parse("20000000-0000-0000-0000-0000000000a4");
    private static readonly Guid AdminUserId = Guid.Parse("30000000-0000-0000-0000-0000000000a4");
    private static readonly Guid SecondAdminUserId = Guid.Parse("40000000-0000-0000-0000-0000000000a4");

    /// <summary>Today in the coaching space's calendar, 3 November 2026.</summary>
    private static readonly DateOnly Today = new(2026, 11, 3);

    private static readonly DateOnly ShownOn = new(2026, 10, 28);
    private static readonly DateTimeOffset ConfirmedAt = new(2026, 11, 3, 9, 30, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset TakenDownAt = new(2026, 11, 5, 14, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset ErasedAt = new(2026, 11, 9, 8, 15, 0, TimeSpan.Zero);
    private static readonly DateOnly RequestedOn = new(2026, 11, 8);

    /// <summary>The refused words, "certified" too: no sentence of the record's own may hold one.</summary>
    private static readonly Regex ForbiddenWords = new(
        @"\b(verified|certified|licensed|qualified|approved|physiotherapists?|physical[\s\p{Pd}]+therapists?|physios?)\b",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private static CoachCertificateLine Waiting(string what = "NASM CPT, 2019") =>
        CoachCertificateLine.Add(TenantId, CoachUserId, what, ShownOn, Today, AdminUserId);

    private static CoachCertificateLine Confirmed()
    {
        var line = Waiting();
        line.Confirm("Rami Saade", ConfirmedAt);
        return line;
    }

    private static CoachCertificateLine TakenDown()
    {
        var line = Confirmed();
        line.TakeDown(SecondAdminUserId, TakenDownAt);
        return line;
    }

    private static ArgumentException RefusedAdd(string? what, DateOnly? shownOn) =>
        Assert.ThrowsExactly<ArgumentException>(() =>
            CoachCertificateLine.Add(TenantId, CoachUserId, what, shownOn, Today, AdminUserId));

    // ---- adding a line ----

    [TestMethod]
    public void ANewLineWaitsWithItsWordsTidiedAndIsShownByTheCoachFromTheStart()
    {
        var line = CoachCertificateLine.Add(TenantId, CoachUserId, "  NASM \t  CPT  ", ShownOn, Today, AdminUserId);

        Assert.AreEqual("NASM CPT", line.What, "Trimmed, every run of spaces and tabs made one space.");
        Assert.AreEqual(ShownOn, line.ShownOn);
        Assert.AreEqual(TenantId, line.TenantId);
        Assert.AreEqual(CoachUserId, line.CoachUserId);
        Assert.AreEqual(AdminUserId, line.RecordedByUserId);
        Assert.AreEqual(CoachCertificateLineState.Waiting, line.State);
        Assert.IsTrue(line.CoachShows, "The coach sent the proof to be shown.");
        Assert.IsNull(line.ConfirmedAtUtc);
        Assert.IsNull(line.ConfirmedByName, "Nobody has confirmed it yet.");
        Assert.IsNull(line.TakenDownAtUtc);
        Assert.IsNull(line.TakenDownByUserId);
        Assert.IsNull(line.ErasedAtUtc);
        Assert.IsNull(line.ErasedByUserId);
        Assert.IsNull(line.ErasureReason);
        Assert.IsNull(line.RequestedOn);
    }

    [TestMethod]
    public void AnAddTakesExactly120CharactersTodayAndTheFirstDayOf2000()
    {
        var longest = new string('a', 120);
        Assert.AreEqual(longest, CoachCertificateLine.Add(TenantId, CoachUserId, longest, Today, Today, AdminUserId).What);
        Assert.AreEqual(Today, CoachCertificateLine.Add(TenantId, CoachUserId, "Owns Iron Gym", Today, Today, AdminUserId).ShownOn);
        Assert.AreEqual(
            new DateOnly(2000, 1, 1),
            CoachCertificateLine.Add(TenantId, CoachUserId, "BSc Sports Science, 2000", new DateOnly(2000, 1, 1), Today, AdminUserId).ShownOn);
        Assert.AreEqual(new DateOnly(2000, 1, 1), CoachCertificateLine.EarliestDay);

        // Spaces around the words do not count towards the 120.
        Assert.AreEqual(longest, CoachCertificateLine.Add(TenantId, CoachUserId, $"  {longest}  ", ShownOn, Today, AdminUserId).What);
    }

    [TestMethod]
    public void AnAddRefusesMissingTooLongOrBrokenWordsUnderTheWordsField()
    {
        foreach (var empty in new[] { null, "", "   ", "\t \t" })
        {
            var refused = RefusedAdd(empty, ShownOn);
            Assert.AreEqual(CoachCertificateText.WhatRequired, refused.PersonMessage(), $"[{empty}]");
            Assert.AreEqual("what", refused.ParamName);
        }

        var tooLong = RefusedAdd(new string('a', 121), ShownOn);
        Assert.AreEqual("Use 120 characters or fewer.", tooLong.PersonMessage());
        Assert.AreEqual("what", tooLong.ParamName);

        foreach (var broken in new[] { "NASM CPT\n2019", "NASM CPT\r\n2019", "NASM CPT, 2019\n", "NASM\u0085CPT", "NASM\u0007CPT" })
        {
            var refused = RefusedAdd(broken, ShownOn);
            Assert.AreEqual(CoachCertificateText.OneLine, refused.PersonMessage(), broken);
            Assert.AreEqual("what", refused.ParamName);
        }

        // The words are read before the day: with both wrong, the words are named.
        Assert.AreEqual("what", RefusedAdd(" ", null).ParamName);
    }

    [TestMethod]
    public void AnAddRefusesAMissingDayADayAfterTodayAndADayBefore2000UnderTheDayField()
    {
        var missing = RefusedAdd("NASM CPT, 2019", null);
        Assert.AreEqual(CoachCertificateText.ShownOnRequired, missing.PersonMessage());
        Assert.AreEqual("shownOn", missing.ParamName);

        var tomorrow = RefusedAdd("NASM CPT, 2019", Today.AddDays(1));
        Assert.AreEqual(CoachCertificateText.DayAfterToday, tomorrow.PersonMessage());
        Assert.AreEqual("shownOn", tomorrow.ParamName);

        var tooEarly = RefusedAdd("NASM CPT, 2019", new DateOnly(1999, 12, 31));
        Assert.AreEqual(CoachCertificateText.DayTooEarly, tooEarly.PersonMessage());
        Assert.AreEqual("shownOn", tooEarly.ParamName);

        // A day left unset by a caller is never stored as the year 1.
        Assert.AreEqual(CoachCertificateText.DayTooEarly, RefusedAdd("NASM CPT, 2019", default(DateOnly)).PersonMessage());
    }

    [TestMethod]
    public void AnAddNeedsItsSpaceItsCoachAndWhoRecordedIt()
    {
        Assert.ThrowsExactly<ArgumentException>(() => CoachCertificateLine.Add(Guid.Empty, CoachUserId, "NASM CPT", ShownOn, Today, AdminUserId));
        Assert.ThrowsExactly<ArgumentException>(() => CoachCertificateLine.Add(TenantId, Guid.Empty, "NASM CPT", ShownOn, Today, AdminUserId));
        Assert.ThrowsExactly<ArgumentException>(() => CoachCertificateLine.Add(TenantId, CoachUserId, "NASM CPT", ShownOn, Today, Guid.Empty));
    }

    // ---- the words a line never holds ----

    [TestMethod]
    [DataRow("Verified")]
    [DataRow("LICENSED")]
    [DataRow("qualified")]
    [DataRow("Approved")]
    [DataRow("Physiotherapist")]
    [DataRow("physiotherapists")]
    [DataRow("physical therapist")]
    [DataRow("Physical  Therapists")]
    [DataRow("physical-therapist")]
    [DataRow("Physical – Therapists")]
    [DataRow("physio")]
    [DataRow("physios")]
    public void AReservedWordOrAProtectedTitleIsRefusedAsAWholeWordInAnyCase(string word)
    {
        foreach (var what in new[] { word, $"{word} coach", $"NASM CPT, {word}, 2019", $"Gym owner ({word})", $"{word.ToUpperInvariant()} 2019" })
        {
            var refused = RefusedAdd(what, ShownOn);
            Assert.AreEqual(CoachCertificateText.WhatRefused, refused.PersonMessage(), what);
            Assert.AreEqual("what", refused.ParamName);

            // The refusal names the field, never the word it found.
            foreach (var part in word.Split(' ', StringSplitOptions.RemoveEmptyEntries))
            {
                Assert.DoesNotContain(part, refused.Message, StringComparison.OrdinalIgnoreCase, what);
            }
        }
    }

    [TestMethod]
    [DataRow("physiotherapy")]
    [DataRow("BSc Physiotherapy, Lebanese University")]
    [DataRow("approval")]
    [DataRow("unverified")]
    [DataRow("NASM Certified Personal Trainer")]
    [DataRow("Owns Iron Gym since 2015")]
    [DataRow("Coached for 8 years")]
    public void ADegreesNameAndWordsThatOnlyHoldAReservedOnePass(string what)
    {
        // "Certified" is not refused by design: it is a certificate's own name.
        Assert.AreEqual(what, Waiting(what).What);
        Assert.AreEqual(what, CoachCertificateLine.NormalizeWhat(what));
    }

    [TestMethod]
    public void NoSentenceTheRecordAnswersHoldsARefusedWordOrCertified()
    {
        var sentences = typeof(CoachCertificateText)
            .GetFields(BindingFlags.Public | BindingFlags.Static)
            .Where(field => field.IsLiteral && field.FieldType == typeof(string))
            .Select(field => (string)field.GetRawConstantValue()!)
            .Append(CoachCertificateLineWording.Sentence)
            .ToList();
        Assert.IsGreaterThanOrEqualTo(15, sentences.Count, "Every sentence and code of CoachCertificateText is read.");

        // The refusals a person can meet beyond the constants.
        sentences.Add(RefusedAdd(new string('a', 121), ShownOn).PersonMessage());
        sentences.Add(Assert.ThrowsExactly<ArgumentException>(() => Waiting().Confirm(new string('n', 81), ConfirmedAt)).PersonMessage());

        foreach (var sentence in sentences)
        {
            Assert.IsFalse(ForbiddenWords.IsMatch(sentence), $"\"{sentence}\" holds a word the record keeps out of a coach's line.");
        }

        // The test's own pattern does catch each word, so a passing loop means something.
        foreach (var word in new[] { "Verified", "certified", "LICENSED", "qualified", "approved", "physiotherapist", "physical  therapists", "physios" })
        {
            Assert.IsTrue(ForbiddenWords.IsMatch($"A {word} line"), word);
        }
    }

    // ---- confirming ----

    [TestMethod]
    public void ALineIsConfirmedOnceWithTheNameOfWhoConfirmedIt()
    {
        var line = Waiting();
        line.Confirm("  Rami   Saade ", ConfirmedAt);

        Assert.AreEqual(CoachCertificateLineState.Confirmed, line.State);
        Assert.AreEqual("Rami Saade", line.ConfirmedByName, "Trimmed, spaces collapsed.");
        Assert.AreEqual(ConfirmedAt, line.ConfirmedAtUtc);
        Assert.AreEqual("NASM CPT, 2019", line.What, "Confirming leaves the words as they are.");
        Assert.AreEqual(ShownOn, line.ShownOn);
        Assert.AreEqual(AdminUserId, line.RecordedByUserId);
        Assert.IsTrue(line.CoachShows);

        var again = Assert.ThrowsExactly<InvalidOperationException>(() => line.Confirm("Someone Else", ConfirmedAt.AddHours(1)));
        Assert.AreEqual(CoachCertificateText.ConfirmNotWaiting, again.Message);
        Assert.AreEqual("Rami Saade", line.ConfirmedByName, "Never confirmed twice.");
        Assert.AreEqual(ConfirmedAt, line.ConfirmedAtUtc);

        var longest = Waiting();
        longest.Confirm(new string('n', CoachCertificateLine.MaximumConfirmedByNameLength), ConfirmedAt);
        Assert.AreEqual(80, longest.ConfirmedByName!.Length);
    }

    [TestMethod]
    public void AConfirmNeedsANameOnOneLineOf80CharactersAtMost()
    {
        foreach (var blank in new[] { null, "", "  " })
        {
            var line = Waiting();
            var refused = Assert.ThrowsExactly<ArgumentException>(() => line.Confirm(blank, ConfirmedAt));
            Assert.AreEqual(CoachCertificateText.ConfirmedByNameRequired, refused.PersonMessage());
            Assert.AreEqual("confirmedByName", refused.ParamName);
            Assert.AreEqual(CoachCertificateLineState.Waiting, line.State, "A refused name leaves the line waiting.");
            Assert.IsNull(line.ConfirmedAtUtc);
        }

        var tooLong = Assert.ThrowsExactly<ArgumentException>(() => Waiting().Confirm(new string('n', 81), ConfirmedAt));
        Assert.AreEqual("Use 80 characters or fewer.", tooLong.PersonMessage());
        Assert.AreEqual("confirmedByName", tooLong.ParamName);

        var broken = Assert.ThrowsExactly<ArgumentException>(() => Waiting().Confirm("Rami\nSaade", ConfirmedAt));
        Assert.AreEqual(CoachCertificateText.OneLine, broken.PersonMessage());
        Assert.AreEqual("confirmedByName", broken.ParamName);
    }

    // ---- dropping and taking down ----

    [TestMethod]
    public void OnlyAWaitingLineCanBeDropped()
    {
        Waiting().EnsureCanDrop();

        foreach (var line in new[] { Confirmed(), TakenDown(), Erased(Confirmed()) })
        {
            var refused = Assert.ThrowsExactly<InvalidOperationException>(line.EnsureCanDrop, line.State.ToString());
            Assert.AreEqual(CoachCertificateText.DropNotWaiting, refused.Message);
        }
    }

    [TestMethod]
    public void OnlyAConfirmedLineIsTakenDownAndOnlyOnce()
    {
        var waiting = Waiting();
        var early = Assert.ThrowsExactly<InvalidOperationException>(() => waiting.TakeDown(AdminUserId, TakenDownAt));
        Assert.AreEqual(CoachCertificateText.TakeDownNotConfirmed, early.Message);
        Assert.AreEqual(CoachCertificateLineState.Waiting, waiting.State);
        Assert.IsNull(waiting.TakenDownAtUtc);

        var line = Confirmed();
        Assert.ThrowsExactly<ArgumentException>(() => line.TakeDown(Guid.Empty, TakenDownAt), "Who took it down is kept.");
        line.TakeDown(SecondAdminUserId, TakenDownAt);

        Assert.AreEqual(CoachCertificateLineState.TakenDown, line.State);
        Assert.AreEqual(TakenDownAt, line.TakenDownAtUtc);
        Assert.AreEqual(SecondAdminUserId, line.TakenDownByUserId);
        Assert.AreEqual("NASM CPT, 2019", line.What, "The words are kept for the keeping period.");
        Assert.AreEqual(ShownOn, line.ShownOn);
        Assert.AreEqual("Rami Saade", line.ConfirmedByName);
        Assert.AreEqual(ConfirmedAt, line.ConfirmedAtUtc);
        Assert.IsTrue(line.CoachShows, "Taking down is the admin's, not the coach's switch.");

        var twice = Assert.ThrowsExactly<InvalidOperationException>(() => line.TakeDown(AdminUserId, TakenDownAt.AddDays(1)));
        Assert.AreEqual(CoachCertificateText.TakeDownNotConfirmed, twice.Message);
        Assert.AreEqual(TakenDownAt, line.TakenDownAtUtc);
        Assert.AreEqual(SecondAdminUserId, line.TakenDownByUserId);
        Assert.ThrowsExactly<InvalidOperationException>(() => line.Confirm("Someone Else", TakenDownAt), "A taken-down line is not confirmed again.");
    }

    // ---- erasing on request ----

    [TestMethod]
    public void AWaitingLineIsDroppedNotErased()
    {
        var line = Waiting();
        var refused = Assert.ThrowsExactly<InvalidOperationException>(() => line.EraseOnRequest(AdminUserId, RequestedOn, ErasedAt));
        Assert.AreEqual(CoachCertificateText.EraseNotConfirmed, refused.Message);
        Assert.AreEqual("NASM CPT, 2019", line.What);
        Assert.IsNull(line.ErasedAtUtc);
        Assert.ThrowsExactly<ArgumentException>(() => Confirmed().EraseOnRequest(Guid.Empty, RequestedOn, ErasedAt), "Who erased it is kept.");
    }

    [TestMethod]
    public void AnErasureBlanksAConfirmedLinesWordsAndKeepsItsDatesAndWhoActed()
    {
        var line = Erased(Confirmed());

        Assert.AreEqual(CoachCertificateLineState.Erased, line.State);
        Assert.AreEqual(string.Empty, line.What);
        Assert.IsNull(line.ShownOn);
        Assert.AreEqual(string.Empty, line.ConfirmedByName, "Blanked, not null: the confirmation's date stays.");
        Assert.AreEqual(ConfirmedAt, line.ConfirmedAtUtc);
        Assert.IsNull(line.TakenDownAtUtc);
        Assert.AreEqual(AdminUserId, line.RecordedByUserId);
        Assert.AreEqual(CoachUserId, line.CoachUserId);
        Assert.AreEqual(TenantId, line.TenantId);
        Assert.AreEqual(ErasedAt, line.ErasedAtUtc);
        Assert.AreEqual(SecondAdminUserId, line.ErasedByUserId);
        Assert.AreEqual(CoachCertificateErasureReason.Request, line.ErasureReason);
        Assert.AreEqual(RequestedOn, line.RequestedOn);
        Assert.IsTrue(line.CoachShows, "The coach's switch is left as it was, as the database requires.");
        AssertNothingChangesAfter(line);
    }

    [TestMethod]
    public void AnErasureOfATakenDownLineKeepsWhenItWasTakenDown()
    {
        var line = Erased(TakenDown());

        Assert.AreEqual(CoachCertificateLineState.Erased, line.State);
        Assert.AreEqual(string.Empty, line.What);
        Assert.IsNull(line.ShownOn);
        Assert.AreEqual(string.Empty, line.ConfirmedByName);
        Assert.AreEqual(ConfirmedAt, line.ConfirmedAtUtc);
        Assert.AreEqual(TakenDownAt, line.TakenDownAtUtc);
        Assert.AreEqual(SecondAdminUserId, line.TakenDownByUserId);
        Assert.AreEqual(AdminUserId, line.RecordedByUserId);
        Assert.AreEqual(CoachUserId, line.CoachUserId);
        Assert.AreEqual(ErasedAt, line.ErasedAtUtc);
        Assert.AreEqual(SecondAdminUserId, line.ErasedByUserId);
        Assert.AreEqual(CoachCertificateErasureReason.Request, line.ErasureReason);
        Assert.AreEqual(RequestedOn, line.RequestedOn);
        AssertNothingChangesAfter(line);
    }

    [TestMethod]
    public void ARequestsDayIsTodayOrEarlierFrom2000()
    {
        Assert.AreEqual(Today, CoachCertificateLine.NormalizeRequestedOn(Today, Today));
        Assert.AreEqual(new DateOnly(2000, 1, 1), CoachCertificateLine.NormalizeRequestedOn(new DateOnly(2000, 1, 1), Today));

        var missing = Assert.ThrowsExactly<ArgumentException>(() => CoachCertificateLine.NormalizeRequestedOn(null, Today));
        Assert.AreEqual(CoachCertificateText.RequestedOnRequired, missing.PersonMessage());
        Assert.AreEqual("requestedOn", missing.ParamName);

        var tomorrow = Assert.ThrowsExactly<ArgumentException>(() => CoachCertificateLine.NormalizeRequestedOn(Today.AddDays(1), Today));
        Assert.AreEqual(CoachCertificateText.DayAfterToday, tomorrow.PersonMessage());
        Assert.AreEqual("requestedOn", tomorrow.ParamName);

        var tooEarly = Assert.ThrowsExactly<ArgumentException>(() => CoachCertificateLine.NormalizeRequestedOn(new DateOnly(1999, 12, 31), Today));
        Assert.AreEqual(CoachCertificateText.DayTooEarly, tooEarly.PersonMessage());
        Assert.AreEqual("requestedOn", tooEarly.ParamName);
    }

    // ---- the sentence a reader sees ----

    [TestMethod]
    public void TheWordingVersionOneReadsTheProofAndTheDayInEnglish()
    {
        // The fixed reference, read as compiled: a reworded sentence is a new version and must break this test.
        Assert.AreEqual(1, WordingConstant(nameof(CoachCertificateLineWording.Version)));
        Assert.AreEqual("{0}, shown to TB Gym on {1}", WordingConstant(nameof(CoachCertificateLineWording.Sentence)));
        Assert.AreEqual("d MMM yyyy", WordingConstant(nameof(CoachCertificateLineWording.DateFormat)));
        Assert.AreEqual(
            "NASM CPT, 2019, shown to TB Gym on 3 Nov 2026",
            CoachCertificateLineWording.Compose("NASM CPT, 2019", new DateOnly(2026, 11, 3), WorkspaceLanguages.English));
        Assert.AreEqual(
            "Owns Iron Gym, shown to TB Gym on 28 Oct 2026",
            CoachCertificateLineWording.Compose("Owns Iron Gym", new DateOnly(2026, 10, 28), "en-LB"));
    }

    [TestMethod]
    public void TheWordingWritesTheDayInAnArabicSpacesOwnLanguage()
    {
        // Built from CultureInfo rather than pasted: ICU's Arabic month names differ between machines.
        var arabicDay = new DateOnly(2026, 11, 3).ToString("d MMM yyyy", CultureInfo.GetCultureInfo("ar-LB"));

        Assert.AreEqual(
            "NASM CPT, 2019, shown to TB Gym on " + arabicDay,
            CoachCertificateLineWording.Compose("NASM CPT, 2019", new DateOnly(2026, 11, 3), WorkspaceLanguages.Arabic));
        Assert.StartsWith("3 ", arabicDay);
        Assert.EndsWith(" 2026", arabicDay);
        Assert.DoesNotContain("Nov", arabicDay);
    }

    [TestMethod]
    public void TheWordingFallsBackToEnglishWhenTheSpacesLanguageCannotBeRead()
    {
        const string English = "NASM CPT, 2019, shown to TB Gym on 3 Nov 2026";
        var day = new DateOnly(2026, 11, 3);

        // "xx-NOPE" is a well-formed name ICU would make up a culture for, in the machine's own month names, so only
        // a predefined culture is read; "not a language" is refused outright.
        foreach (var culture in new[] { "xx-NOPE", "not a language", null, "", "  " })
        {
            Assert.AreEqual(English, CoachCertificateLineWording.Compose("NASM CPT, 2019", day, culture), $"[{culture}]");
        }

        Assert.AreEqual(English, CoachCertificateLineWording.Compose("NASM CPT, 2019", day, " en-LB "), "A space's culture is read trimmed.");
        Assert.ThrowsExactly<ArgumentException>(() => CoachCertificateLineWording.Compose(" ", day, "en-LB"), "An erased line has no sentence.");
    }

    private static object? WordingConstant(string name) =>
        typeof(CoachCertificateLineWording).GetField(name, BindingFlags.Public | BindingFlags.Static)!.GetRawConstantValue();

    private static CoachCertificateLine Erased(CoachCertificateLine line)
    {
        line.EraseOnRequest(SecondAdminUserId, RequestedOn, ErasedAt);
        return line;
    }

    private static void AssertNothingChangesAfter(CoachCertificateLine line)
    {
        Assert.ThrowsExactly<InvalidOperationException>(() => line.Confirm("Someone Else", ErasedAt.AddDays(1)));
        Assert.ThrowsExactly<InvalidOperationException>(() => line.TakeDown(AdminUserId, ErasedAt.AddDays(1)));
        Assert.ThrowsExactly<InvalidOperationException>(line.EnsureCanDrop);
        Assert.ThrowsExactly<InvalidOperationException>(() => line.EraseOnRequest(AdminUserId, RequestedOn.AddDays(1), ErasedAt.AddDays(1)));

        Assert.AreEqual(ErasedAt, line.ErasedAtUtc, "Nothing after the erasure moved it.");
        Assert.AreEqual(SecondAdminUserId, line.ErasedByUserId);
        Assert.AreEqual(RequestedOn, line.RequestedOn);
        Assert.AreEqual(string.Empty, line.What);
    }
}
