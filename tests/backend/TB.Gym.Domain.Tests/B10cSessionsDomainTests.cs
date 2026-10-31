using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Notifications;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.SharedKernel;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// Sessions for clients and on Today (critique B10c, SES-007 to SES-009): what a client reads of a pack, when a client's
/// sessions are running out, and the notices a pack hears in its own words.
/// </summary>
[TestClass]
public sealed class B10cSessionsDomainTests
{
    private static readonly Guid TenantId = Guid.Parse("10000000-0000-0000-0000-0000000000c1");
    private static readonly Guid ClientId = Guid.Parse("20000000-0000-0000-0000-0000000000c1");
    private static readonly Guid CoachId = Guid.Parse("30000000-0000-0000-0000-0000000000c1");
    private static readonly DateOnly Today = new(2026, 10, 15);
    private static readonly DateTimeOffset Now = new(2026, 10, 15, 9, 0, 0, TimeSpan.Zero);
    private static readonly TimeZoneInfo Beirut = TimeZoneInfo.FindSystemTimeZoneById("Asia/Beirut");

    private static readonly CommercialNotificationKind[] PlanNotices =
    [
        CommercialNotificationKind.PaymentRequired,
        CommercialNotificationKind.EnrollmentActivated,
        CommercialNotificationKind.EnrollmentEndingSoon,
        CommercialNotificationKind.EnrollmentExpired,
        CommercialNotificationKind.EnrollmentRenewed,
    ];

    [TestMethod]
    public void AClientReadsTheSessionsThatStandAndAChargesReasonButNeverACoachsNoteOrWhoRecordedIt()
    {
        var pack = Pack(10);
        var older = SessionLedgerEntry.Hold(pack, Today.AddDays(-7), CoachId, CoachId, "Knee felt better", Guid.NewGuid());
        var charged = SessionLedgerEntry.Charge(pack, Today.AddDays(-3), CoachId, "No-show: you didn't come", Guid.NewGuid());
        var undone = SessionLedgerEntry.Hold(pack, Today.AddDays(-1), CoachId, CoachId, "Wrong day", Guid.NewGuid());
        var newest = SessionLedgerEntry.Hold(pack, Today, CoachId, CoachId, null, Guid.NewGuid());
        SessionLedgerEntry[] entries =
        [
            SessionLedgerEntry.Issue(pack, Today.AddDays(-10)),
            older,
            charged,
            undone,
            SessionLedgerEntry.Void(pack, undone, Today, Guid.NewGuid()),
            newest,
        ];

        var own = OwnPlans.SessionsOf(SessionLedger.ViewOf(pack, entries, new Dictionary<Guid, string> { [CoachId] = "Karim" }, Today, Beirut));

        Assert.AreEqual((10, 7, 3, 0), (own.Count, own.Left, own.Used, own.Lapsed));
        Assert.IsNull(own.LapsedOn);
        CollectionAssert.AreEqual(
            new[]
            {
                new OwnSessionView(Today, SessionOutcome.Held, null),
                new OwnSessionView(Today.AddDays(-3), SessionOutcome.Charged, "No-show: you didn't come"),
                new OwnSessionView(Today.AddDays(-7), SessionOutcome.Held, null),
            },
            own.Sessions.ToArray(),
            "Newest first; the session undone and the row that undid it are the team's to read.");
    }

    [TestMethod]
    public void WhatWasLeftAtTheEndHasLapsedAndUsedCountsWhatStands()
    {
        var pack = Pack(5, Today.AddDays(-20), days: 10);
        SessionLedgerEntry[] entries =
        [
            SessionLedgerEntry.Issue(pack, Today.AddDays(-20)),
            SessionLedgerEntry.Hold(pack, Today.AddDays(-15), CoachId, CoachId, null, Guid.NewGuid()),
            SessionLedgerEntry.Charge(pack, Today.AddDays(-14), CoachId, "Late cancel", Guid.NewGuid()),
        ];

        var own = OwnPlans.SessionsOf(SessionLedger.ViewOf(pack, entries, new Dictionary<Guid, string>(), Today, Beirut));

        Assert.AreEqual((5, 3, 2, 3, (DateOnly?)pack.Period.LastActiveDate), (own.Count, own.Left, own.Used, own.Lapsed, own.LapsedOn));
    }

    [TestMethod]
    public void TheDatabasesSumOfALedgerIsTheBalance()
    {
        var pack = Pack(3);
        var held = SessionLedgerEntry.Hold(pack, Today, CoachId, CoachId, null, Guid.NewGuid());
        var charged = SessionLedgerEntry.Charge(pack, Today, CoachId, "No-show", Guid.NewGuid());
        SessionLedgerEntry[] entries =
        [
            SessionLedgerEntry.Issue(pack, Today),
            held,
            charged,
            SessionLedgerEntry.Void(pack, held, Today, Guid.NewGuid()),
        ];

        var signed = SessionLedger.SignedCount.Compile();

        Assert.AreEqual(2, entries.Sum(signed));
        Assert.AreEqual(SessionLedger.Balance(entries), entries.Sum(signed));
    }

    [TestMethod]
    [DataRow(3, false)]
    [DataRow(2, true)]
    [DataRow(1, true)]
    [DataRow(0, true)]
    public void TwoSessionsLeftOrFewerAreRunningOut(int left, bool runningOut) =>
        Assert.AreEqual(runningOut, Flags(left, Today.AddDays(60)).Contains(CoachAttentionKind.SessionsRunningOut));

    [TestMethod]
    [DataRow(14, false)]
    [DataRow(13, true)]
    [DataRow(0, true)]
    public void SessionsWhoseLastDayIsWithin14DaysAreRunningOutHoweverManyAreLeft(int daysToLastDay, bool runningOut) =>
        Assert.AreEqual(runningOut, Flags(9, Today.AddDays(daysToLastDay)).Contains(CoachAttentionKind.SessionsRunningOut));

    [TestMethod]
    public void AClientWhoseSessionsAreNotInTodaysPlanIsNotRunningOut() =>
        Assert.IsEmpty(CoachAttentionPolicy.Flags(Quiet() with { SessionsLastDay = Today }, ClientPlanState.Paused, Today));

    [TestMethod]
    public void SessionsRunningOutRanksAfterAPlanEndingAndIsNotNeedsAttention()
    {
        Assert.AreEqual(
            CoachAttentionPolicy.RankOf(CoachAttentionKind.PlanEndingSoon) + 1,
            CoachAttentionPolicy.RankOf(CoachAttentionKind.SessionsRunningOut));

        var alone = Flags(1, Today.AddDays(60));
        CollectionAssert.AreEqual(new[] { CoachAttentionKind.SessionsRunningOut }, alone.ToArray());
        Assert.AreEqual(ClientOverviewStatus.OnTrack, CoachAttentionPolicy.Status(alone, ClientPlanState.Running));
        Assert.AreEqual(ClientPlanStatus.OnTrack, CoachAttentionPolicy.PlanStatus(alone, ClientPlanState.Running));

        var withAPlanEnding = CoachAttentionPolicy.Flags(
            Quiet() with { PlanLastDay = Today.AddDays(5), SessionsLeft = 1, SessionsLastDay = Today.AddDays(60) },
            ClientPlanState.Running,
            Today);
        CollectionAssert.AreEqual(
            new[] { CoachAttentionKind.PlanEndingSoon, CoachAttentionKind.SessionsRunningOut },
            withAPlanEnding.ToArray());
        Assert.AreEqual(ClientOverviewStatus.EndingSoon, CoachAttentionPolicy.Status(withAPlanEnding, ClientPlanState.Running));
    }

    [TestMethod]
    public void APackHearsThePlanNoticesInItsOwnWordsAndAPlanInItsOwn()
    {
        foreach (var kind in PlanNotices)
        {
            Assert.IsTrue(NotificationTemplateCatalog.TryResolveForEnrollment(kind, "en", isSessionPack: true, out var pack), kind.ToString());
            Assert.IsTrue(NotificationTemplateCatalog.TryResolveForEnrollment(kind, "en", isSessionPack: false, out var plan), kind.ToString());
            Assert.IsTrue(NotificationTemplateCatalog.TryResolve(kind, "en", out var asEver), kind.ToString());

            Assert.AreEqual(asEver, plan, "A plan's notice is as it was.");
            Assert.AreNotEqual(plan.Key, pack.Key);
            Assert.AreEqual("en", pack.Culture);
            Assert.AreEqual(kind == CommercialNotificationKind.EnrollmentRenewed ? 2 : 1, pack.Version, "Critique B14 moved its renewal on.");
            Assert.Contains("1-on-1 sessions", pack.Title, "It never says \"your plan\", which may be another one.");

            // My plan is the page it opens (critique B14), and the only plan it speaks of.
            Assert.DoesNotContain(
                "plan",
                (pack.Title + " " + pack.Body).Replace("My plan", string.Empty, StringComparison.Ordinal),
                StringComparison.OrdinalIgnoreCase);

            // As generic as every notice: no count, no date, no name and nothing to fill in.
            Assert.DoesNotContain("{", pack.Title + pack.Body);
            foreach (var word in new[] { "workspace", "service", "access", "enrollment", "activated" })
            {
                Assert.DoesNotContain(word, pack.Title + " " + pack.Body, StringComparison.OrdinalIgnoreCase, kind.ToString());
            }

            Assert.Contains(pack, NotificationTemplateCatalog.Published);
        }

        Assert.IsTrue(NotificationTemplateCatalog.TryResolveForEnrollment(CommercialNotificationKind.EnrollmentEndingSoon, "en", true, out var ending));
        Assert.AreEqual(
            ("Your 1-on-1 sessions end soon", "If you'd like to keep going, ask your coach to renew them."),
            (ending.Title, ending.Body));

        // A renewal may still be waiting for payment: it says only that more were set up.
        Assert.IsTrue(NotificationTemplateCatalog.TryResolveForEnrollment(CommercialNotificationKind.EnrollmentRenewed, "en", true, out var renewed));
        Assert.DoesNotContain("started", renewed.Title + renewed.Body, StringComparison.OrdinalIgnoreCase);
    }

    [TestMethod]
    public void AKindWithNoWordsOfItsOwnForAPackIsSaidAsEver()
    {
        Assert.IsTrue(NotificationTemplateCatalog.TryResolveForEnrollment(CommercialNotificationKind.CoachDeparted, "en", true, out var pack));
        Assert.IsTrue(NotificationTemplateCatalog.TryResolve(CommercialNotificationKind.CoachDeparted, "en", out var asEver));
        Assert.AreEqual(asEver, pack);
    }

    private static IReadOnlyList<CoachAttentionKind> Flags(int left, DateOnly lastDay) =>
        CoachAttentionPolicy.Flags(
            Quiet() with { SessionsLeft = left, SessionsLastDay = lastDay },
            ClientPlanState.Running,
            Today);

    private static ClientAttentionSignals Quiet() => new(0, 0, null, null, false, 0, false);

    private static ClientEnrollment Pack(int sessions, DateOnly? start = null, int days = 90)
    {
        var product = CoachingProduct.Create(TenantId, "Personal training", null, ProductKind.SessionPack);
        var offer = ProductOffer.CreateFixedDuration(
            TenantId,
            product.Id,
            $"{sessions} sessions",
            days,
            OfferDurationUnit.Day,
            0m,
            "USD",
            SessionPackRules.PackFeatures([]),
            sessions);
        return ClientEnrollment.Assign(TenantId, ClientId, product, offer, start ?? Today.AddDays(-10), Guid.NewGuid(), Now.AddDays(-30));
    }
}
