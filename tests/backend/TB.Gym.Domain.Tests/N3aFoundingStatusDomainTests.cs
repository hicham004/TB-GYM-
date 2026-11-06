using System.Reflection;
using System.Text.RegularExpressions;
using TB.Gym.Modules.PlatformBilling;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// The Founding coach badge (notes plan N3a, decision 15, 5 Nov 2026): the named rule
/// <c>founding-badge-v1</c>, whole calendar months at a month's end, the thresholds coming from the terms
/// version rather than code, a badge recorded once and kept, and the refusals.
/// </summary>
[TestClass]
public sealed class N3aFoundingStatusDomainTests
{
    private static readonly Guid TenantId = Guid.Parse("10000000-0000-0000-0000-0000000000a3");
    private static readonly Guid AdminUserId = Guid.Parse("20000000-0000-0000-0000-0000000000a3");

    /// <summary>A space created on 12 January 2027 at 09:00 UTC.</summary>
    private static readonly DateTimeOffset SpaceCreated = new(2027, 1, 12, 9, 0, 0, TimeSpan.Zero);

    private static readonly DateTimeOffset MarkedAt = new(2027, 1, 20, 10, 0, 0, TimeSpan.Zero);

    /// <summary>Version 1 as the migration seeds it: 10 clients with an active plan and 2 months.</summary>
    private static readonly FoundingTerms VersionOne = FoundingTerms.Publish(1, new FoundingBadgeTerms(10, 2), null, null, MarkedAt);

    private static readonly string[] TermsFields = ["ClientsWithActivePlan", "MonthsSinceStart"];

    private static readonly Regex ForbiddenWords =
        new(@"\b(verified|certified|licensed|qualified|approved)\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private static FoundingStatus MarkedSpace() =>
        FoundingStatus.Mark(TenantId, new DateOnly(2027, 1, 20), "On the founding list", AdminUserId, MarkedAt);

    // ---- states ----

    [TestMethod]
    public void ASpaceWithNoStatusOrAFoundingDayAheadIsNotFounding()
    {
        var none = FoundingBadgePolicy.Read(null, VersionOne, SpaceCreated, null, new DateOnly(2027, 6, 1));
        Assert.AreEqual(FoundingBadgeState.NotFounding, none.State);
        Assert.IsNull(none.FoundingSince);
        Assert.IsNull(none.ClientsWithActivePlan, "Nothing is counted for a space that is not founding.");
        Assert.AreEqual(10, none.ClientsNeeded);
        Assert.AreEqual(2, none.MonthsNeeded);
        Assert.IsFalse(none.IsDue);

        // Read on a day before the founding day (a clock that ran back): still not founding.
        Assert.AreEqual(FoundingBadgeState.NotFounding, FoundingBadgePolicy.StateOf(MarkedSpace(), new DateOnly(2027, 1, 19)));
        Assert.AreEqual(FoundingBadgeState.Waiting, FoundingBadgePolicy.StateOf(MarkedSpace(), new DateOnly(2027, 1, 20)));
    }

    [TestMethod]
    public void EnoughClientsStillWaitForTheMonths()
    {
        var reading = FoundingBadgePolicy.Read(MarkedSpace(), VersionOne, SpaceCreated, 12, new DateOnly(2027, 3, 11));

        Assert.AreEqual(FoundingBadgeState.Waiting, reading.State);
        Assert.AreEqual(12, reading.ClientsWithActivePlan);
        Assert.AreEqual(10, reading.ClientsNeeded);
        Assert.AreEqual(1, reading.MonthsSinceStart, "12 January to 11 March is one whole month.");
        Assert.AreEqual(2, reading.MonthsNeeded);
        Assert.AreEqual(new DateOnly(2027, 1, 20), reading.FoundingSince);
        Assert.IsFalse(reading.IsDue);
    }

    [TestMethod]
    public void EnoughMonthsStillWaitForTheClients()
    {
        var reading = FoundingBadgePolicy.Read(MarkedSpace(), VersionOne, SpaceCreated, 9, new DateOnly(2027, 5, 1));

        Assert.AreEqual(FoundingBadgeState.Waiting, reading.State);
        Assert.AreEqual(9, reading.ClientsWithActivePlan);
        Assert.AreEqual(3, reading.MonthsSinceStart);
        Assert.IsFalse(reading.IsDue);
    }

    [TestMethod]
    public void TheBadgeIsEarnedOnTheDayBothHoldAndRecordedWithWhatWasCounted()
    {
        var status = MarkedSpace();
        var day = new DateOnly(2027, 3, 12);
        var reading = FoundingBadgePolicy.Read(status, VersionOne, SpaceCreated, 10, day);
        Assert.AreEqual(FoundingBadgeState.Waiting, reading.State, "Due, but not earned until the check records it.");
        Assert.IsTrue(reading.IsDue);

        status.RecordEarned(day, VersionOne, reading.ClientsWithActivePlan!.Value, reading.MonthsSinceStart!.Value);

        Assert.AreEqual(day, status.EarnedOn);
        Assert.AreEqual(1, status.EarnedUnderTermsVersion);
        Assert.AreEqual(10, status.EarnedClientCount);
        Assert.AreEqual("founding-badge-v1", status.EarnedUnderRule);
        var earned = FoundingBadgePolicy.Read(status, VersionOne, SpaceCreated, null, day);
        Assert.AreEqual(FoundingBadgeState.Earned, earned.State);
        Assert.AreEqual(day, earned.EarnedOn);
        Assert.IsNull(earned.ClientsWithActivePlan, "An earned badge is not counted again.");
    }

    [TestMethod]
    public void AnEarnedBadgeIsKeptWhenTheClientsLaterFall()
    {
        var status = MarkedSpace();
        status.RecordEarned(new DateOnly(2027, 3, 12), VersionOne, 11, 2);

        var later = FoundingBadgePolicy.Read(status, VersionOne, SpaceCreated, 0, new DateOnly(2027, 9, 1));
        Assert.AreEqual(FoundingBadgeState.Earned, later.State);
        Assert.AreEqual(new DateOnly(2027, 3, 12), later.EarnedOn);

        // Stricter terms published later do not take it away either.
        var stricter = FoundingTerms.Publish(2, new FoundingBadgeTerms(50, 12), "Stricter", AdminUserId, MarkedAt.AddMonths(6));
        Assert.AreEqual(FoundingBadgeState.Earned, FoundingBadgePolicy.Read(status, stricter, SpaceCreated, 0, new DateOnly(2027, 9, 1)).State);
        Assert.AreEqual(1, status.EarnedUnderTermsVersion);
    }

    [TestMethod]
    public void AnEndKeepsTheEarnedDayAndNamesItsOwn()
    {
        var status = MarkedSpace();
        status.RecordEarned(new DateOnly(2027, 3, 12), VersionOne, 10, 2);
        status.SetBadgeHidden(true);
        Assert.IsTrue(FoundingBadgePolicy.Read(status, VersionOne, SpaceCreated, null, new DateOnly(2027, 4, 1)).Hidden);

        status.End("The coach asked", AdminUserId, new DateTimeOffset(2027, 5, 5, 23, 30, 0, TimeSpan.Zero));

        var reading = FoundingBadgePolicy.Read(status, VersionOne, SpaceCreated, null, new DateOnly(2027, 5, 6));
        Assert.AreEqual(FoundingBadgeState.Ended, reading.State);
        Assert.AreEqual(new DateOnly(2027, 3, 12), reading.EarnedOn, "The earned day survives an end.");
        Assert.AreEqual(new DateOnly(2027, 5, 5), reading.EndedOn, "A UTC day.");
        Assert.IsFalse(reading.Hidden, "Hiding means something only while the status is open.");
        Assert.AreEqual("The coach asked", status.EndReason);
        Assert.AreEqual(AdminUserId, status.EndedByUserId);
    }

    [TestMethod]
    public void TheOwnersSwitchHidesTheBadgeWhileOpen()
    {
        var status = MarkedSpace();
        status.RecordEarned(new DateOnly(2027, 3, 12), VersionOne, 10, 2);

        status.SetBadgeHidden(true);
        Assert.IsTrue(FoundingBadgePolicy.Read(status, VersionOne, SpaceCreated, null, new DateOnly(2027, 3, 13)).Hidden);
        status.SetBadgeHidden(false);
        Assert.IsFalse(FoundingBadgePolicy.Read(status, VersionOne, SpaceCreated, null, new DateOnly(2027, 3, 13)).Hidden);
    }

    // ---- months ----

    [TestMethod]
    public void WholeMonthsCountFromTheCreationDayAndClampAtAMonthsEnd()
    {
        var january31 = new DateOnly(2027, 1, 31);
        Assert.AreEqual(0, FoundingBadgePolicy.WholeMonthsSince(january31, new DateOnly(2027, 2, 27)));
        Assert.AreEqual(1, FoundingBadgePolicy.WholeMonthsSince(january31, new DateOnly(2027, 2, 28)), "31 January plus one month is the last day of February.");
        Assert.AreEqual(1, FoundingBadgePolicy.WholeMonthsSince(january31, new DateOnly(2027, 3, 30)));
        Assert.AreEqual(2, FoundingBadgePolicy.WholeMonthsSince(january31, new DateOnly(2027, 3, 31)), "Counted from the creation day, never month by month.");
        Assert.AreEqual(1, FoundingBadgePolicy.WholeMonthsSince(new DateOnly(2028, 1, 31), new DateOnly(2028, 2, 29)), "A leap year's February.");
        Assert.AreEqual(2, FoundingBadgePolicy.WholeMonthsSince(new DateOnly(2026, 12, 31), new DateOnly(2027, 2, 28)), "Across a year.");
        Assert.AreEqual(12, FoundingBadgePolicy.WholeMonthsSince(new DateOnly(2027, 3, 15), new DateOnly(2028, 3, 15)));
        Assert.AreEqual(0, FoundingBadgePolicy.WholeMonthsSince(january31, january31));
        Assert.AreEqual(0, FoundingBadgePolicy.WholeMonthsSince(january31, new DateOnly(2027, 1, 1)), "Never negative.");
    }

    [TestMethod]
    public void MonthsCountFromTheSpacesUtcCreationDay()
    {
        // Created at 23:30 UTC on 31 January: its creation day is 31 January.
        var lateCreated = new DateTimeOffset(2027, 1, 31, 23, 30, 0, TimeSpan.Zero);
        var status = FoundingStatus.Mark(TenantId, new DateOnly(2027, 2, 1), "Founding", AdminUserId, new DateTimeOffset(2027, 2, 1, 8, 0, 0, TimeSpan.Zero));

        Assert.AreEqual(1, FoundingBadgePolicy.Read(status, VersionOne, lateCreated, 10, new DateOnly(2027, 3, 30)).MonthsSinceStart);
        Assert.AreEqual(2, FoundingBadgePolicy.Read(status, VersionOne, lateCreated, 10, new DateOnly(2027, 3, 31)).MonthsSinceStart);
        Assert.IsTrue(FoundingBadgePolicy.Read(status, VersionOne, lateCreated, 10, new DateOnly(2027, 3, 31)).IsDue);
    }

    // ---- the numbers come from the terms ----

    [TestMethod]
    public void EveryThresholdComesFromTheTermsNotFromCode()
    {
        var lenient = FoundingTerms.Publish(2, new FoundingBadgeTerms(3, 0), "Trying the badge", AdminUserId, MarkedAt);
        var sameDay = new DateOnly(2027, 1, 20);

        var due = FoundingBadgePolicy.Read(MarkedSpace(), lenient, SpaceCreated, 3, sameDay);
        Assert.IsTrue(due.IsDue, "3 clients and no months meet terms of 3 and 0.");
        Assert.AreEqual(3, due.ClientsNeeded);
        Assert.AreEqual(0, due.MonthsNeeded);
        Assert.AreEqual(2, due.TermsVersion);

        Assert.IsFalse(FoundingBadgePolicy.Read(MarkedSpace(), VersionOne, SpaceCreated, 3, sameDay).IsDue, "The same space under version 1.");
        Assert.IsFalse(FoundingBadgePolicy.MeetsTerms(VersionOne.Terms, 9, 24));
        Assert.IsFalse(FoundingBadgePolicy.MeetsTerms(VersionOne.Terms, 1_000, 1));
        Assert.IsTrue(FoundingBadgePolicy.MeetsTerms(VersionOne.Terms, 10, 2));
        Assert.AreEqual(10, VersionOne.ClientsWithActivePlan);
        Assert.AreEqual(2, VersionOne.MonthsSinceStart);
    }

    // ---- refusals ----

    [TestMethod]
    public void AMarkNeedsAPastOrPresentDayAndANote()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            FoundingStatus.Mark(TenantId, new DateOnly(2027, 1, 21), "Tomorrow", AdminUserId, MarkedAt));
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            FoundingStatus.Mark(TenantId, default, "No day", AdminUserId, MarkedAt));
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            FoundingStatus.Mark(TenantId, new DateOnly(1999, 12, 31), "Before 2000", AdminUserId, MarkedAt));
        Assert.AreEqual(
            new DateOnly(2000, 1, 1),
            FoundingStatus.Mark(TenantId, new DateOnly(2000, 1, 1), "The first day allowed", AdminUserId, MarkedAt).FoundingSince);
        Assert.Throws<ArgumentException>(() => FoundingStatus.Mark(TenantId, new DateOnly(2027, 1, 20), "  ", AdminUserId, MarkedAt));
        Assert.Throws<ArgumentException>(() => FoundingStatus.Mark(TenantId, new DateOnly(2027, 1, 20), null!, AdminUserId, MarkedAt));
        Assert.Throws<ArgumentException>(() =>
            FoundingStatus.Mark(TenantId, new DateOnly(2027, 1, 20), new string('a', 201), AdminUserId, MarkedAt));
        Assert.Throws<ArgumentException>(() => FoundingStatus.Mark(Guid.Empty, new DateOnly(2027, 1, 20), "Note", AdminUserId, MarkedAt));
        Assert.Throws<ArgumentException>(() => FoundingStatus.Mark(TenantId, new DateOnly(2027, 1, 20), "Note", Guid.Empty, MarkedAt));

        var status = FoundingStatus.Mark(TenantId, new DateOnly(2027, 1, 20), "  Trimmed  ", AdminUserId, MarkedAt);
        Assert.AreEqual("Trimmed", status.Note);
        Assert.AreEqual(TenantId, status.TenantId);
        Assert.IsFalse(status.BadgeHidden, "Shown to clients from the start.");
    }

    [TestMethod]
    public void AnEndNeedsAReasonAndHappensOnce()
    {
        var status = MarkedSpace();
        Assert.Throws<ArgumentException>(() => status.End("", AdminUserId, MarkedAt));
        Assert.Throws<ArgumentException>(() => status.End(new string('r', 501), AdminUserId, MarkedAt));
        Assert.Throws<ArgumentException>(() => status.End("Harm to clients", Guid.Empty, MarkedAt));

        status.End("Harm to clients", AdminUserId, MarkedAt.AddDays(1));
        Assert.Throws<InvalidOperationException>(() => status.End("Again", AdminUserId, MarkedAt.AddDays(2)));
        Assert.Throws<InvalidOperationException>(() => status.SetBadgeHidden(true), "An ended status is never changed.");
        Assert.Throws<InvalidOperationException>(() => status.RecordEarned(new DateOnly(2027, 3, 12), VersionOne, 10, 2));
    }

    [TestMethod]
    public void ABadgeIsRecordedOnceAndOnlyWithItsTermsMet()
    {
        var status = MarkedSpace();
        Assert.Throws<ArgumentOutOfRangeException>(() => status.RecordEarned(new DateOnly(2027, 3, 12), VersionOne, 9, 2));
        Assert.Throws<ArgumentOutOfRangeException>(() => status.RecordEarned(new DateOnly(2027, 3, 12), VersionOne, 10, 1));
        Assert.Throws<ArgumentOutOfRangeException>(
            () => status.RecordEarned(new DateOnly(2027, 1, 19), VersionOne, 10, 2),
            "Never earlier than the founding day.");

        status.RecordEarned(new DateOnly(2027, 3, 12), VersionOne, 10, 2);
        Assert.Throws<InvalidOperationException>(() => status.RecordEarned(new DateOnly(2027, 3, 13), VersionOne, 12, 2));
        Assert.AreEqual(new DateOnly(2027, 3, 12), status.EarnedOn);
    }

    [TestMethod]
    public void TermsOutOfRangeAreRefused()
    {
        var errors = new FoundingBadgeTerms(0, 25).Validate();
        CollectionAssert.AreEquivalent(TermsFields, errors.Keys.ToArray());
        Assert.HasCount(2, new FoundingBadgeTerms(1_001, -1).Validate());
        Assert.IsEmpty(new FoundingBadgeTerms(1, 0).Validate());
        Assert.IsEmpty(new FoundingBadgeTerms(1_000, 24).Validate());

        Assert.Throws<ArgumentException>(() => FoundingTerms.Publish(2, new FoundingBadgeTerms(0, 2), null, AdminUserId, MarkedAt));
        Assert.Throws<ArgumentOutOfRangeException>(() => FoundingTerms.Publish(0, new FoundingBadgeTerms(10, 2), null, AdminUserId, MarkedAt));
        Assert.Throws<ArgumentException>(() =>
            FoundingTerms.Publish(2, new FoundingBadgeTerms(10, 2), new string('n', 501), AdminUserId, MarkedAt));
    }

    [TestMethod]
    public void AWaitingSpaceIsReadOnlyWithItsClientsCounted()
    {
        Assert.Throws<ArgumentNullException>(() =>
            FoundingBadgePolicy.Read(MarkedSpace(), VersionOne, SpaceCreated, null, new DateOnly(2027, 3, 12)));
    }

    // ---- the words ----

    [TestMethod]
    public void NoSentenceTheFoundingStatusAnswersCallsACoachChecked()
    {
        var sentences = typeof(FoundingText)
            .GetFields(BindingFlags.Public | BindingFlags.Static)
            .Where(field => field.FieldType == typeof(string))
            .Select(field => (string)field.GetValue(null)!)
            .Append(FoundingBadgePolicy.Name)
            .ToArray();

        Assert.IsGreaterThanOrEqualTo(10, sentences.Length);
        foreach (var sentence in sentences)
        {
            Assert.IsFalse(ForbiddenWords.IsMatch(sentence), $"\"{sentence}\" uses a word the notes plan forbids for a coach.");
        }

        // The refusals a person can meet, beyond the constants.
        foreach (var problem in new FoundingBadgeTerms(0, 99).Validate().Values.SelectMany(messages => messages))
        {
            Assert.IsFalse(ForbiddenWords.IsMatch(problem), problem);
        }
    }
}
