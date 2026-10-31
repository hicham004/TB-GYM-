using TB.Gym.Modules.Subscriptions;
using TB.Gym.SharedKernel;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// Session packs in the domain (critique B10b, ADR 0038): what a pack's price option may be, the ledger's balance,
/// which pack a session goes on, why none can take it, and what is left once a pack is over.
/// </summary>
[TestClass]
public sealed class B10bSessionPackDomainTests
{
    private static readonly Guid TenantId = Guid.Parse("10000000-0000-0000-0000-0000000000b1");
    private static readonly Guid ClientId = Guid.Parse("20000000-0000-0000-0000-0000000000b1");
    private static readonly Guid CoachId = Guid.Parse("30000000-0000-0000-0000-0000000000b1");
    private static readonly DateOnly Today = new(2026, 10, 15);
    private static readonly DateTimeOffset Now = new(2026, 10, 15, 9, 0, 0, TimeSpan.Zero);
    private static readonly TimeZoneInfo Beirut = TimeZoneInfo.FindSystemTimeZoneById("Asia/Beirut");

    [TestMethod]
    public void APackHoldsOneToAHundredSessionsAlwaysIncludesThemAndRunsBesideOtherPacks()
    {
        var product = CoachingProduct.Create(TenantId, "Personal training", null, ProductKind.SessionPack);
        var offer = Offer(product, sessions: 100);
        Assert.AreEqual(100, offer.SessionCount);
        var sessions = offer.Entitlements.Single();
        Assert.AreEqual(CoachingFeature.Sessions, sessions.Feature);
        Assert.IsTrue(sessions.AllowsConcurrentCoverage, "A client may hold several packs at once (SUB-004).");

        foreach (var count in new[] { 0, -1, 101 })
        {
            var refused = Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => Offer(product, sessions: count));
            Assert.AreEqual("A pack holds 1 to 100 sessions.", refused.PersonMessage().Split(Environment.NewLine)[0]);
        }

        // What the coach ticks stays beside the sessions, and the sessions are never left out of it.
        var ticked = SessionPackRules.PackFeatures([
            new OfferFeatureDefinition(CoachingFeature.Sessions),
            new OfferFeatureDefinition(CoachingFeature.Training),
        ]).ToArray();
        Assert.AreEqual("Training, Sessions", string.Join(", ", ticked.Select(item => item.Feature)));
        Assert.IsTrue(ticked.Single(item => item.Feature == CoachingFeature.Sessions).AllowsConcurrentCoverage);
        Assert.IsFalse(ticked.Single(item => item.Feature == CoachingFeature.Training).AllowsConcurrentCoverage);
    }

    [TestMethod]
    public void ACoachingPlanNeverIncludesSessionsAndAPackNeverGoesWithoutThem()
    {
        var plan = CoachingProduct.Create(TenantId, "Online Coaching", null);
        Assert.AreEqual(ProductKind.CoachingPlan, plan.Kind);
        var refused = Assert.ThrowsExactly<ArgumentException>(() => ProductOffer.CreateFixedDuration(
            TenantId, plan.Id, "4 weeks", 4, OfferDurationUnit.Week, 100m, "USD",
            [new OfferFeatureDefinition(CoachingFeature.Sessions, AllowsConcurrentCoverage: true)]));
        Assert.AreEqual("1-on-1 sessions are sold as a session pack.", refused.PersonMessage());

        Assert.ThrowsExactly<ArgumentException>(() => ProductOffer.CreateFixedDuration(
            TenantId, plan.Id, "10 sessions", 90, OfferDurationUnit.Day, 300m, "USD",
            [new OfferFeatureDefinition(CoachingFeature.Training)], sessionCount: 10));
        Assert.ThrowsExactly<ArgumentException>(() => ProductOffer.CreateFixedDuration(
            TenantId, plan.Id, "10 sessions", 90, OfferDurationUnit.Day, 300m, "USD",
            [new OfferFeatureDefinition(CoachingFeature.Sessions, AllowsConcurrentCoverage: false)], sessionCount: 10));
    }

    [TestMethod]
    public void AnActiveSlotIsTheCountTheLengthAndTheCurrencyAndAPriceChangeKeepsTheCount()
    {
        var product = CoachingProduct.Create(TenantId, "Personal training", null, ProductKind.SessionPack);
        var ten = Offer(product, sessions: 10);

        // Ten sessions for another 90 days clash; five sessions for 90 days, or ten for 60, are options of their own.
        Assert.ThrowsExactly<ActiveOfferSlotConflictException>(() => Offer(product, sessions: 10).EnsureActiveSlotAvailable([ten]));
        Offer(product, sessions: 5).EnsureActiveSlotAvailable([ten]);
        Offer(product, sessions: 10, days: 60).EnsureActiveSlotAvailable([ten]);
        Offer(product, sessions: 10, currency: "EUR").EnsureActiveSlotAvailable([ten]);

        var replacement = ten.CreatePriceReplacement(350m);
        Assert.AreEqual(10, replacement.SessionCount);
        Assert.AreEqual(90, replacement.DurationCount);
        Assert.IsTrue(replacement.Entitlements.Single().AllowsConcurrentCoverage);
    }

    [TestMethod]
    public void APackIsADatedPlanThatKeepsTheCountItWasSoldWith()
    {
        var pack = Pack(sessions: 10, start: Today, price: 300m);
        Assert.AreEqual(10, pack.SessionCountSnapshot);
        Assert.IsTrue(pack.IsSessionPack);
        Assert.AreEqual(EnrollmentStatus.PendingPayment, pack.Status, "Waiting for payment until the exact price is received.");
        Assert.AreEqual(Today.AddDays(90), pack.EndDateExclusive);
        Assert.IsFalse(pack.Entitlements.Single().BlocksOverlap);

        var free = Pack(sessions: 1, start: Today, price: 0m);
        Assert.AreEqual(EnrollmentStatus.Active, free.Status, "A free pack is the goodwill tool, active at once.");

        Assert.IsFalse(CoachingPlan().IsSessionPack);
    }

    [TestMethod]
    public void TheBalanceIsIssuedLessHeldLessChargedPlusVoided()
    {
        var pack = Pack(sessions: 10, start: Today.AddDays(-20), price: 0m);
        var issued = SessionLedgerEntry.Issue(pack, Today.AddDays(-20));
        Assert.AreEqual((SessionEntryKind.Issued, 10), (issued.Kind, issued.Count));
        var held = Hold(pack, Today.AddDays(-5));
        var heldAgain = Hold(pack, Today.AddDays(-3));
        var charged = SessionLedgerEntry.Charge(pack, Today.AddDays(-1), CoachId, "No-show", Guid.NewGuid());
        var undone = SessionLedgerEntry.Void(pack, heldAgain, Today, Guid.NewGuid());

        Assert.AreEqual(10, SessionLedger.Balance([issued]));
        Assert.AreEqual(7, SessionLedger.Balance([issued, held, heldAgain, charged]));
        Assert.AreEqual(8, SessionLedger.Balance([issued, held, heldAgain, charged, undone]));
        Assert.AreEqual(0, SessionLedger.Balance([]), "A pack waiting for payment has issued nothing.");
    }

    [TestMethod]
    public void OnlyASessionHeldOrChargedOnThisPackCanBeUndone()
    {
        var pack = Pack(sessions: 2, start: Today, price: 0m);
        var issued = SessionLedgerEntry.Issue(pack, Today);
        var held = Hold(pack, Today);
        var undone = SessionLedgerEntry.Void(pack, held, Today, Guid.NewGuid());
        Assert.AreEqual(held.Id, undone.VoidsEntryId);

        Assert.ThrowsExactly<InvalidOperationException>(() => SessionLedgerEntry.Void(pack, issued, Today, Guid.NewGuid()));
        Assert.ThrowsExactly<InvalidOperationException>(() => SessionLedgerEntry.Void(pack, undone, Today, Guid.NewGuid()));
        var other = Pack(sessions: 2, start: Today, price: 0m);
        Assert.ThrowsExactly<InvalidOperationException>(() => SessionLedgerEntry.Void(other, held, Today, Guid.NewGuid()));
    }

    [TestMethod]
    public void TheLedgerOfAPlanWithoutSessionsDoesNotExist()
    {
        Assert.ThrowsExactly<InvalidOperationException>(() => SessionLedgerEntry.Issue(CoachingPlan(), Today));
        Assert.ThrowsExactly<InvalidOperationException>(() => Hold(CoachingPlan(), Today));
    }

    [TestMethod]
    public void WhenSeveralPacksRunTheOneEndingFirstIsUsed()
    {
        var later = Pack(sessions: 10, start: Today.AddDays(-5), price: 0m, days: 90);
        var soonest = Pack(sessions: 10, start: Today.AddDays(-40), price: 0m, days: 60);
        var middle = Pack(sessions: 10, start: Today.AddDays(-10), price: 0m, days: 70);

        var choice = SessionPackRules.Choose([Standing(later, 3), Standing(soonest, 1), Standing(middle, 5)], Today, Today);
        Assert.AreSame(soonest, choice.Pack);
        Assert.IsNull(choice.Refusal);

        // Empty, the one ending first steps aside for the next.
        choice = SessionPackRules.Choose([Standing(later, 3), Standing(soonest, 0), Standing(middle, 5)], Today, Today);
        Assert.AreSame(middle, choice.Pack);

        // A pack that does not cover the day never takes it, however soon it ends.
        var pastDay = Today.AddDays(-20);
        choice = SessionPackRules.Choose([Standing(later, 3), Standing(soonest, 2), Standing(middle, 5)], pastDay, Today);
        Assert.AreSame(soonest, choice.Pack);
    }

    [TestMethod]
    public void ASessionOnThePacksFirstAndLastDaysCountsAndADayAfterIsOutside()
    {
        var pack = Pack(sessions: 5, start: Today.AddDays(-30), price: 0m, days: 30);
        Assert.AreSame(pack, SessionPackRules.Choose([Standing(pack, 5)], pack.StartDate, Today).Pack);
        Assert.AreSame(pack, SessionPackRules.Choose([Standing(pack, 5)], pack.Period.LastActiveDate, Today).Pack);

        // A lapsed pack is never extended: its end is the end, and today is past it.
        var after = SessionPackRules.Choose([Standing(pack, 5)], Today, Today);
        Assert.AreEqual(SessionRefusal.OutsidePack, after.Refusal);
        Assert.AreSame(pack, after.Pack);
        var before = SessionPackRules.Choose([Standing(pack, 5)], pack.StartDate.AddDays(-1), Today);
        Assert.AreEqual(SessionRefusal.OutsidePack, before.Refusal);
    }

    [TestMethod]
    public void EachRefusalNamesWhatTheCoachCanActOnFirst()
    {
        Assert.AreEqual(SessionRefusal.NoPack, SessionPackRules.Choose([], Today, Today).Refusal);

        var used = Pack(sessions: 5, start: Today.AddDays(-10), price: 0m);
        var usedUp = SessionPackRules.Choose([Standing(used, 0)], Today, Today);
        Assert.AreEqual(SessionRefusal.NoSessionsLeft, usedUp.Refusal);
        Assert.AreSame(used, usedUp.Pack);

        var waiting = Pack(sessions: 5, start: Today.AddDays(-2), price: 100m);
        Assert.AreEqual(SessionRefusal.WaitingForPayment, SessionPackRules.Choose([Standing(waiting, 0)], Today, Today).Refusal);

        // A pack used up and one waiting for payment: the payment is the way forward.
        var both = SessionPackRules.Choose([Standing(used, 0), Standing(waiting, 0)], Today, Today);
        Assert.AreEqual(SessionRefusal.WaitingForPayment, both.Refusal);
        Assert.AreSame(waiting, both.Pack);

        var paused = Pack(sessions: 5, start: Today.AddDays(-2), price: 0m);
        paused.Pause(Now, "Injured");
        Assert.AreEqual(SessionRefusal.Paused, SessionPackRules.Choose([Standing(paused, 5)], Today, Today).Refusal);

        // A cancelled pack is gone, whatever it still held.
        var cancelled = Pack(sessions: 5, start: Today.AddDays(-2), price: 0m);
        cancelled.Cancel(Now, "Moved away");
        Assert.AreEqual(SessionRefusal.NoPack, SessionPackRules.Choose([Standing(cancelled, 5)], Today, Today).Refusal);

        // A session counts when it happens, never at booking, whatever the packs say.
        Assert.AreEqual(SessionRefusal.Future, SessionPackRules.Choose([Standing(used, 5)], Today.AddDays(1), Today).Refusal);

        // With several packs no single one's dates can be named.
        var far = Pack(sessions: 5, start: Today.AddDays(30), price: 0m);
        var outside = SessionPackRules.Choose([Standing(far, 5), Standing(Pack(sessions: 5, start: Today.AddDays(40), price: 0m), 5)], Today, Today);
        Assert.AreEqual(SessionRefusal.OutsidePack, outside.Refusal);
        Assert.IsNull(outside.Pack);
    }

    [TestMethod]
    public void AReceiptPaysThePackWaitingOnThatDayEndingFirst()
    {
        var running = Pack(sessions: 5, start: Today, price: 0m);
        var soon = Pack(sessions: 1, start: Today.AddDays(-1), price: 30m, days: 30);
        var later = Pack(sessions: 1, start: Today.AddDays(-1), price: 30m, days: 60);
        var notYet = Pack(sessions: 1, start: Today.AddDays(1), price: 30m, days: 10);
        SessionPackStanding[] packs = [Standing(running, 5), Standing(later, 0), Standing(soon, 0), Standing(notYet, 0)];

        Assert.AreSame(soon, SessionPackRules.WaitingOn(packs, Today));
        Assert.IsNull(SessionPackRules.WaitingOn([Standing(running, 5)], Today));
    }

    [TestMethod]
    public void WhatIsLeftAtTheEndLapsesByTheCalendarAndAnUndoLapsesWithIt()
    {
        var pack = Pack(sessions: 10, start: Today.AddDays(-30), price: 0m, days: 30);
        var issued = SessionLedgerEntry.Issue(pack, pack.StartDate);
        var held = Hold(pack, Today.AddDays(-20));
        var charged = SessionLedgerEntry.Charge(pack, Today.AddDays(-10), CoachId, "Late cancel", Guid.NewGuid());
        SessionLedgerEntry[] entries = [issued, held, charged];
        var names = new Dictionary<Guid, string> { [CoachId] = "Karim Haddad" };

        // The last covered day is still inside the pack: nothing has lapsed.
        var running = SessionLedger.ViewOf(pack, entries, names, pack.Period.LastActiveDate, Beirut);
        Assert.AreEqual((10, 8, 1, 1, 0), (running.Count, running.Left, running.Held, running.Charged, running.Lapsed));
        Assert.IsNull(running.LapsedOn);
        Assert.AreEqual(Today.AddDays(-20), running.LastHeldOn);
        Assert.AreEqual("Charged | Held | Issued", string.Join(" | ", running.Entries.Select(item => item.Kind)));
        Assert.AreEqual("Late cancel", running.Entries[0].Reason);
        Assert.AreEqual("Karim Haddad", running.Entries[1].CoachName);

        var over = SessionLedger.ViewOf(pack, entries, names, Today, Beirut);
        Assert.AreEqual((8, 8, pack.Period.LastActiveDate), (over.Left, over.Lapsed, over.LapsedOn!.Value));

        // The ledger takes a correction after the end, and what lapsed follows it.
        var undone = SessionLedgerEntry.Void(pack, held, Today, Guid.NewGuid());
        var corrected = SessionLedger.ViewOf(pack, [.. entries, undone], names, Today, Beirut);
        Assert.AreEqual((9, 9, 0), (corrected.Left, corrected.Lapsed, corrected.Held));
        Assert.IsNull(corrected.LastHeldOn, "The session undone is no longer the last one held.");
        Assert.IsTrue(corrected.Entries.Single(item => item.Id == held.Id).IsVoided);
    }

    [TestMethod]
    public void ACancelledPackLapsesTheDayItWasCancelled()
    {
        var pack = Pack(sessions: 4, start: Today.AddDays(-10), price: 0m);
        var issued = SessionLedgerEntry.Issue(pack, pack.StartDate);
        pack.Cancel(Now.AddDays(-2), "Moved away");

        var view = SessionLedger.ViewOf(pack, [issued], new Dictionary<Guid, string>(), Today, Beirut);
        Assert.AreEqual((4, 4, Today.AddDays(-2)), (view.Left, view.Lapsed, view.LapsedOn!.Value));
    }

    [TestMethod]
    public void APauseLeavesThePacksDatesAlone()
    {
        var pack = Pack(sessions: 4, start: Today.AddDays(-10), price: 0m, days: 20);
        var issued = SessionLedgerEntry.Issue(pack, pack.StartDate);
        var end = pack.EndDateExclusive;
        pack.Pause(Now, "Injured");

        Assert.AreEqual(end, pack.EndDateExclusive);
        var view = SessionLedger.ViewOf(pack, [issued], new Dictionary<Guid, string>(), end, Beirut);
        Assert.AreEqual((4, end.AddDays(-1)), (view.Lapsed, view.LapsedOn!.Value), "Paused or not, a pack ends on its last day.");
    }

    [TestMethod]
    public void APackThatWasNeverPaidHasNothingToLapse()
    {
        var pack = Pack(sessions: 4, start: Today.AddDays(-100), price: 50m);
        var view = SessionLedger.ViewOf(pack, [], new Dictionary<Guid, string>(), Today, Beirut);
        Assert.AreEqual((0, 0), (view.Left, view.Lapsed));
        Assert.IsNull(view.LapsedOn);
    }

    private static ProductOffer Offer(CoachingProduct product, int sessions, int days = 90, decimal price = 300m, string currency = "USD") =>
        ProductOffer.CreateFixedDuration(
            TenantId,
            product.Id,
            $"{sessions} sessions",
            days,
            OfferDurationUnit.Day,
            price,
            currency,
            SessionPackRules.PackFeatures([]),
            sessions);

    private static ClientEnrollment Pack(int sessions, DateOnly start, decimal price, int days = 90)
    {
        var product = CoachingProduct.Create(TenantId, "Personal training", null, ProductKind.SessionPack);
        return ClientEnrollment.Assign(TenantId, ClientId, product, Offer(product, sessions, days, price), start, Guid.NewGuid(), Now);
    }

    private static ClientEnrollment CoachingPlan()
    {
        var product = CoachingProduct.Create(TenantId, "Online Coaching", null);
        var offer = ProductOffer.CreateFixedDuration(
            TenantId, product.Id, "4 weeks", 4, OfferDurationUnit.Week, 0m, "USD",
            [new OfferFeatureDefinition(CoachingFeature.Training)]);
        return ClientEnrollment.Assign(TenantId, ClientId, product, offer, Today, Guid.NewGuid(), Now);
    }

    private static SessionLedgerEntry Hold(ClientEnrollment pack, DateOnly day) =>
        SessionLedgerEntry.Hold(pack, day, CoachId, CoachId, null, Guid.NewGuid());

    private static SessionPackStanding Standing(ClientEnrollment pack, int left) => new(pack, left);
}
