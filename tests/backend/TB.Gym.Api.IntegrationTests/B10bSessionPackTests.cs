using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.SharedKernel;
using ClientEnrollmentView = TB.Gym.Modules.Subscriptions.ClientEnrollmentView;
using CoachingProductView = TB.Gym.Modules.Subscriptions.CoachingProductView;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Critique B10b, session packs (ADR 0038): sold as plans, consumed from an append-only ledger on the pack ending
/// first, refused in words, and held to it by the database whoever writes.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task B10bAPackIsSoldAsAPlanAndItsSessionsOpenOnceTheExactPriceIsReceived()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "b10b-sell-coach@example.test", "Karim Haddad", "B10b Sell");
        using var maya = CreateClient();
        var mayaId = await InviteAndAcceptAsync(coach, maya, "b10b-sell-maya@example.test", true);

        var product = await B10bPackProductAsync(coach, "Personal training", B10bPackOffer(10, 90, 300m));
        Assert.AreEqual(ProductKind.SessionPack, product.Kind);
        var offer = product.Offers.Single();
        Assert.AreEqual((10, 90, OfferDurationUnit.Day), (offer.SessionCount, offer.DurationCount, offer.DurationUnit));
        var sessions = offer.Features.Single();
        Assert.AreEqual((CoachingFeature.Sessions, true), (sessions.Feature, sessions.AllowsConcurrentCoverage));

        var sold = await A7EnrollAsync(coach, mayaId, offer.Id, today);
        Assert.AreEqual(EnrollmentStatus.PendingPayment, sold.StoredStatus);
        Assert.AreEqual((10, 0), (sold.Sessions!.Count, sold.Sessions.Left), "Nothing is issued before the pack is paid.");
        Assert.IsEmpty(sold.Sessions.Entries);

        // A part payment opens nothing (SUB-008), and a session is refused in words.
        var part = await A7PayAsync(coach, sold.Id, 100m, today, Guid.NewGuid());
        Assert.AreEqual(0, part.Sessions!.Left);
        var unpaid = await A7ConflictAsync(await B10bPostSessionAsync(coach, mayaId, today));
        Assert.AreEqual("session_pack_unpaid", unpaid.Code);
        Assert.AreEqual("Personal training is waiting for payment. Record the payment first, or take it with this session.", unpaid.Message);

        var paid = await A7PayAsync(coach, sold.Id, 200m, today, Guid.NewGuid());
        Assert.AreEqual(EnrollmentStatus.Active, paid.StoredStatus);
        var issued = paid.Sessions!.Entries.Single();
        Assert.AreEqual((SessionEntryKind.Issued, 10, today), (issued.Kind, issued.Count, issued.Day));
        Assert.AreEqual(10, paid.Sessions.Left);

        // The feature's own decision follows, through the shared port.
        var overview = await ReadSliceAsync<ClientCommercialOverview>(coach, $"/api/commercial/clients/{mayaId}");
        var access = overview.FeatureAccess.Single(item => item.Feature == CoachingFeature.Sessions);
        Assert.AreEqual((true, FeatureAccessReason.Granted, (DateOnly?)today.AddDays(90)), (access.IsAllowed, access.Reason, access.AccessibleUntilExclusive));
        Assert.HasCount(6, overview.FeatureAccess, "Sessions is the sixth coaching feature.");

        // The client's own read names what's included, and says nothing of the ledger yet (B10c).
        var plan = (await ReadSliceAsync<OwnPlansView>(maya, OwnPlansUrl)).Plans.Single();
        Assert.AreEqual("Personal training", plan.Name);
        Assert.AreEqual(CoachingFeature.Sessions, plan.Features.Single());
    }

    [TestMethod]
    public async Task B10bAFreePackIsActiveAtOnceAndAClientMayHoldPacksSideBySide()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "b10b-free-coach@example.test", "Karim Haddad", "B10b Free");
        using var maya = CreateClient();
        var mayaId = await InviteAndAcceptAsync(coach, maya, "b10b-free-maya@example.test", true);

        var goodwill = await B10bPackProductAsync(coach, "On the house", B10bPackOffer(1, 30, 0m));
        var ten = await B10bPackProductAsync(coach, "Ten sessions", B10bPackOffer(10, 90, 300m));

        var free = await A7EnrollAsync(coach, mayaId, goodwill.Offers[0].Id, today);
        Assert.AreEqual(EnrollmentStatus.Active, free.StoredStatus);
        Assert.AreEqual(1, free.Sessions!.Left);

        // Sessions never block a date: the same pack twice, and a coaching plan beside them, on the same days.
        var second = await A7EnrollAsync(coach, mayaId, ten.Offers[0].Id, today);
        var third = await A7EnrollAsync(coach, mayaId, ten.Offers[0].Id, today);
        Assert.AreNotEqual(second.Id, third.Id);
        var plan = await B10aProductAsync(coach, "Online Coaching", null, B10aOffer("4 weeks", 4, 0m, "Training"));
        await A7EnrollAsync(coach, mayaId, plan.Offers[0].Id, today);

        // Ticked features still block theirs: a pack with Training cannot overlap the plan's Training.
        var withTraining = await B10bPackProductAsync(coach, "Train and sessions", B10bPackOffer(5, 60, 100m, "USD", "Training"));
        Assert.AreEqual(
            "Sessions, Training",
            string.Join(", ", withTraining.Offers[0].Features.Select(item => item.Feature.ToString()).Order(StringComparer.Ordinal)));
        await RefreshCsrfAsync(coach);
        var overlap = await coach.PostAsJsonAsync(
            $"/api/commercial/clients/{mayaId}/enrollments",
            new { offerId = withTraining.Offers[0].Id, startDate = B10bDay(today), idempotencyKey = Guid.NewGuid() });
        Assert.AreEqual("entitlement_overlap", (await A7ConflictAsync(overlap)).Code);

        // A renewal is a new pack with a full count of its own; the old one keeps its ledger.
        await RefreshCsrfAsync(coach);
        var renewed = await coach.PostAsJsonAsync(
            $"/api/commercial/enrollments/{free.Id}/renew",
            new { offerId = goodwill.Offers[0].Id, startDate = B10bDay(today), idempotencyKey = Guid.NewGuid() });
        await AssertStatusAsync(renewed, HttpStatusCode.OK);
        var renewal = await ReadSlicePayloadAsync<ClientEnrollmentView>(renewed);
        Assert.AreEqual((free.Id, 1), (renewal.RenewedFromEnrollmentId, renewal.Sessions!.Left));
    }

    [TestMethod]
    public async Task B10bAPacksPriceOptionsCountSessionsAndACoachingPlansDoNot()
    {
        R61aStartAtMidday();
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "b10b-offer-coach@example.test", "Karim Haddad", "B10b Offer");

        var pack = await B10bPackProductAsync(coach, "Personal training", B10bPackOffer(10, 90, 300m));
        var plan = await B10aProductAsync(coach, "Online Coaching", null, B10aOffer("4 weeks", 4, 100m, "Training"));
        Assert.AreEqual(ProductKind.CoachingPlan, plan.Kind);
        Assert.IsNull(plan.Offers.Single().SessionCount);

        // A plan is a coaching plan or a pack, each with its own kind of option.
        await RefreshCsrfAsync(coach);
        var noCount = await coach.PostAsJsonAsync($"{A7ProductsUrl}/{pack.Id}/offers", B10aOffer("90 days", 12, 50m, "Training"));
        Assert.AreEqual("Say how many sessions this price sells.", await A7FieldErrorAsync(noCount, "offer"));
        var counted = await coach.PostAsJsonAsync($"{A7ProductsUrl}/{plan.Id}/offers", B10bPackOffer(5, 30, 50m));
        Assert.AreEqual("Only a session pack counts sessions.", await A7FieldErrorAsync(counted, "offer"));
        var sessionsInAPlan = await coach.PostAsJsonAsync(
            $"{A7ProductsUrl}/{plan.Id}/offers",
            B10aOffer("8 weeks", 8, 100m, "Sessions"));
        Assert.AreEqual("1-on-1 sessions are sold as a session pack.", await A7FieldErrorAsync(sessionsInAPlan, "offer"));
        var tooMany = await coach.PostAsJsonAsync($"{A7ProductsUrl}/{pack.Id}/offers", B10bPackOffer(101, 90, 900m));
        StringAssert.StartsWith(await A7FieldErrorAsync(tooMany, "offer"), "A pack holds 1 to 100 sessions.");

        // One active option per count, length and currency (ADR 0034).
        var same = await coach.PostAsJsonAsync($"{A7ProductsUrl}/{pack.Id}/offers", B10bPackOffer(10, 90, 250m));
        Assert.AreEqual("active_offer_slot_conflict", (await A7ConflictAsync(same)).Code);
        await RefreshCsrfAsync(coach);
        var other = await coach.PostAsJsonAsync($"{A7ProductsUrl}/{pack.Id}/offers", B10bPackOffer(5, 90, 160m));
        await AssertStatusAsync(other, HttpStatusCode.OK);
        var both = await ReadSlicePayloadAsync<CoachingProductView>(other);
        Assert.AreEqual("5, 10", string.Join(", ", both.Offers.Select(item => item.SessionCount).Order()));

        // The database holds the same slot, and still clashes for a coaching plan's options, whose counts are empty.
        await A7ExpectUniqueSlotAsync(both.Offers.Single(item => item.SessionCount == 5));
        await RefreshCsrfAsync(coach);
        var planClash = await coach.PostAsJsonAsync($"{A7ProductsUrl}/{plan.Id}/offers", B10aOffer("Other name", 4, 80m, "Nutrition"));
        Assert.AreEqual("active_offer_slot_conflict", (await A7ConflictAsync(planClash)).Code);

        // A new price is a new option that sells the same count.
        await RefreshCsrfAsync(coach);
        var ten = both.Offers.Single(item => item.SessionCount == 10);
        var changed = await coach.PostAsJsonAsync(
            $"/api/commercial/offers/{ten.Id}/price-changes",
            new { priceAmount = 350m, version = ten.Version, idempotencyKey = Guid.NewGuid() });
        await AssertStatusAsync(changed, HttpStatusCode.OK);
        var after = await ReadSlicePayloadAsync<CoachingProductView>(changed);
        var replacement = after.Offers.Single(item => item.IsActive && item.DurationCount == 90 && item.PriceAmount == 350m);
        Assert.AreEqual(10, replacement.SessionCount);
        Assert.AreEqual(CoachingFeature.Sessions, replacement.Features.Single().Feature);
    }

    [TestMethod]
    public async Task B10bASessionGoesOnThePackEndingFirstAndAChargeCarriesItsReason()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "b10b-use-coach@example.test", "Karim Haddad", "B10b Use");
        using var maya = CreateClient();
        var mayaId = await InviteAndAcceptAsync(coach, maya, "b10b-use-maya@example.test", true);
        var longPack = await B10bPackProductAsync(coach, "Long pack", B10bPackOffer(2, 90, 0m));
        var shortPack = await B10bPackProductAsync(coach, "Short pack", B10bPackOffer(1, 30, 0m));
        var later = await A7EnrollAsync(coach, mayaId, longPack.Offers[0].Id, today);
        var soonest = await A7EnrollAsync(coach, mayaId, shortPack.Offers[0].Id, today);

        var first = await B10bRecordAsync(coach, mayaId, today, note: "Legs");
        Assert.AreEqual(soonest.Id, first.Id, "The pack ending first is used.");
        var held = first.Sessions!.Entries[0];
        Assert.AreEqual((SessionEntryKind.Held, today, "Legs", "Karim Haddad"), (held.Kind, held.Day, held.Note, held.CoachName));
        Assert.AreEqual((0, 1, today), (first.Sessions.Left, first.Sessions.Held, first.Sessions.LastHeldOn!.Value));

        // Used up, it steps aside. A charge needs a reason, which the coach reads back and a Held note never is.
        var refused = await B10bPostSessionAsync(coach, mayaId, today, "Charged", reason: "  ");
        Assert.AreEqual("Say why the session is charged. Your client reads it.", await A7FieldErrorAsync(refused, "reason"));
        var charged = await B10bRecordAsync(coach, mayaId, today, "Charged", reason: "  No-show  ", note: "Ignored");
        Assert.AreEqual(later.Id, charged.Id);
        var line = charged.Sessions!.Entries[0];
        Assert.AreEqual((SessionEntryKind.Charged, "No-show", (string?)null), (line.Kind, line.Reason, line.Note));
        Assert.AreEqual((1, 0, 1), (charged.Sessions.Left, charged.Sessions.Held, charged.Sessions.Charged));
        Assert.IsNull(charged.Sessions.LastHeldOn, "A charged session was not held.");

        // The overview's ledger agrees with what the command answered.
        var pack = await B10bPackViewAsync(coach, mayaId, later.Id);
        Assert.AreEqual("Charged | Issued", string.Join(" | ", pack.Entries.Select(item => item.Kind)));
    }

    [TestMethod]
    public async Task B10bAnOwnerRecordingForAClientIsTheCoachOfThatSessionOnTheLedger()
    {
        var today = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b10b-team-owner@example.test", "Hicham Haddad", "B10b Team");
        using var lea = CreateClient();
        await JoinAsCoachAsync(owner, lea, "b10b-team-lea@example.test", "Lea Khoury");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(lea, maya, tenant, "b10b-team-maya@example.test", "Maya", "Rahman");
        var pack = await B10bPackProductAsync(owner, "Personal training", B10bPackOffer(3, 90, 0m));
        await A7EnrollAsync(owner, mayaId, pack.Offers[0].Id, today);

        var byOwner = await B10bRecordAsync(owner, mayaId, today);
        Assert.AreEqual("Hicham Haddad", byOwner.Sessions!.Entries[0].CoachName);
        var byCoach = await B10bRecordAsync(lea, mayaId, today);
        Assert.AreEqual("Lea Khoury", byCoach.Sessions!.Entries.First(item => item.Kind == SessionEntryKind.Held && item.CoachName != "Hicham Haddad").CoachName);
    }

    [TestMethod]
    public async Task B10bEachRefusalSaysWhatStoppedTheSession()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "b10b-no-coach@example.test", "Karim Haddad", "B10b No");
        using var maya = CreateClient();
        var mayaId = await InviteAndAcceptAsync(coach, maya, "b10b-no-maya@example.test", true);

        var none = await A7ConflictAsync(await B10bPostSessionAsync(coach, mayaId, today));
        Assert.AreEqual("no_session_pack", none.Code);
        StringAssert.EndsWith(none.Message, " has no session pack. Sell one first.");

        var product = await B10bPackProductAsync(coach, "Personal training", B10bPackOffer(1, 30, 0m));
        var pack = await A7EnrollAsync(coach, mayaId, product.Offers[0].Id, today.AddDays(-2));

        var future = await A7ConflictAsync(await B10bPostSessionAsync(coach, mayaId, today.AddDays(1)));
        Assert.AreEqual(
            ("session_in_future", "A session counts once it has happened. Choose today or an earlier day."),
            future);

        var outside = await A7ConflictAsync(await B10bPostSessionAsync(coach, mayaId, today.AddDays(-3)));
        Assert.AreEqual("session_day_outside_pack", outside.Code);
        StringAssert.Contains(outside.Message, "is outside Personal training, which runs");

        var noDay = await coach.PostAsJsonAsync($"/api/commercial/clients/{mayaId}/sessions", new { outcome = "Held", idempotencyKey = Guid.NewGuid() });
        Assert.AreEqual("Choose the day of the session.", await A7FieldErrorAsync(noDay, "day"));
        var noKey = await B10bPostSessionAsync(coach, mayaId, today, key: Guid.Empty);
        await AssertStatusAsync(noKey, HttpStatusCode.BadRequest);
        var longNote = await B10bPostSessionAsync(coach, mayaId, today, note: new string('x', 501));
        Assert.AreEqual("Keep it to 500 characters.", await A7FieldErrorAsync(longNote, "note"));

        await B10bRecordAsync(coach, mayaId, today);
        var used = await A7ConflictAsync(await B10bPostSessionAsync(coach, mayaId, today));
        Assert.AreEqual("no_sessions_left", used.Code);
        StringAssert.EndsWith(used.Message, " has no sessions left on Personal training. Sell a new pack first.");

        // A pause closes the sessions; the coach is told what to do about it.
        var second = await A7EnrollAsync(coach, mayaId, product.Offers[0].Id, today);
        await B10aChangeAsync(coach, second.Id, "pause", new { reason = "Injured", second.Version });
        var paused = await A7ConflictAsync(await B10bPostSessionAsync(coach, mayaId, today));
        Assert.AreEqual(
            ("session_pack_paused", "Personal training is paused. Resume it to record a session."),
            paused);

        // A blocked client's sessions are closed, in the words Progress uses, and unblocking opens them again.
        var version = await B10aVersionAsync(coach, mayaId, second.Id);
        await B10aChangeAsync(coach, second.Id, "resume", new { Version = version });
        await B4aSetBlockedAsync(coach, mayaId, true);
        var blocked = await A7ConflictAsync(await B10bPostSessionAsync(coach, mayaId, today));
        Assert.AreEqual("client_blocked", blocked.Code);
        StringAssert.EndsWith(blocked.Message, "’s access is blocked, so a session can’t be recorded. Unblock them on Service & access.");
        await B4aSetBlockedAsync(coach, mayaId, false);
        await B10bRecordAsync(coach, mayaId, today);

        // Cancelled, a pack takes nothing more.
        var third = await A7EnrollAsync(coach, mayaId, product.Offers[0].Id, today);
        await B10aChangeAsync(coach, third.Id, "cancel", new { reason = "Sold by mistake", third.Version });
        Assert.AreEqual("no_sessions_left", (await A7ConflictAsync(await B10bPostSessionAsync(coach, mayaId, today))).Code);
        Assert.AreEqual(1, (await B10bPackViewAsync(coach, mayaId, pack.Id)).Held);
    }

    [TestMethod]
    public async Task B10bAnUndoPutsTheSessionBackOnceAndKeepsTheRowItUndid()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "b10b-undo-coach@example.test", "Karim Haddad", "B10b Undo");
        using var maya = CreateClient();
        var mayaId = await InviteAndAcceptAsync(coach, maya, "b10b-undo-maya@example.test", true);
        var product = await B10bPackProductAsync(coach, "Personal training", B10bPackOffer(2, 30, 0m));
        await A7EnrollAsync(coach, mayaId, product.Offers[0].Id, today);
        var recorded = await B10bRecordAsync(coach, mayaId, today);
        var held = recorded.Sessions!.Entries.Single(item => item.Kind == SessionEntryKind.Held);

        var key = Guid.NewGuid();
        var undone = await ReadSlicePayloadAsync<ClientEnrollmentView>(await B10bVoidOkAsync(coach, mayaId, held.Id, key));
        Assert.AreEqual((2, 0), (undone.Sessions!.Left, undone.Sessions.Held));
        var row = undone.Sessions.Entries.Single(item => item.Id == held.Id);
        Assert.IsTrue(row.IsVoided, "The row it undid stays on the ledger.");
        Assert.AreEqual(held.Id, undone.Sessions.Entries.Single(item => item.Kind == SessionEntryKind.Voided).VoidsEntryId);

        // A retry is the same undo; another undo of the row is refused, and so is the key on another row.
        await B10bVoidOkAsync(coach, mayaId, held.Id, key);
        Assert.AreEqual(2, (await B10bPackViewAsync(coach, mayaId, recorded.Id)).Left);
        var again = await A7ConflictAsync(await B10bPostVoidAsync(coach, mayaId, held.Id, Guid.NewGuid()));
        Assert.AreEqual(("session_already_undone", "This session was already undone."), again);
        var other = await B10bRecordAsync(coach, mayaId, today);
        var otherId = other.Sessions!.Entries.First(item => item.Kind == SessionEntryKind.Held && item.Id != held.Id).Id;
        Assert.AreEqual("idempotency_key_reused", (await A7ConflictAsync(await B10bPostVoidAsync(coach, mayaId, otherId, key))).Code);

        // Only a session held or charged can be undone, on this client's own record.
        var issued = other.Sessions.Entries.Single(item => item.Kind == SessionEntryKind.Issued);
        Assert.AreEqual("session_not_undoable", (await A7ConflictAsync(await B10bPostVoidAsync(coach, mayaId, issued.Id, Guid.NewGuid()))).Code);
        var correction = other.Sessions.Entries.Single(item => item.Kind == SessionEntryKind.Voided);
        Assert.AreEqual("session_not_undoable", (await A7ConflictAsync(await B10bPostVoidAsync(coach, mayaId, correction.Id, Guid.NewGuid()))).Code);
        using var rami = CreateClient();
        var ramiId = await InviteAndAcceptAsync(coach, rami, "b10b-undo-rami@example.test", true);
        await AssertStatusAsync(await B10bPostVoidAsync(coach, ramiId, otherId, Guid.NewGuid()), HttpStatusCode.NotFound);
        await AssertStatusAsync(await B10bPostVoidAsync(coach, mayaId, Guid.NewGuid(), Guid.NewGuid()), HttpStatusCode.NotFound);

        // A session undone frees its place: the pack's count is what bounds it, not how many rows it holds.
        await B10bRecordAsync(coach, mayaId, today);
        Assert.AreEqual("no_sessions_left", (await A7ConflictAsync(await B10bPostSessionAsync(coach, mayaId, today))).Code);
    }

    [TestMethod]
    public async Task B10bAReceiptTakenWithASessionPaysThePackAndRecordsTheSessionOrNeither()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "b10b-cash-coach@example.test", "Karim Haddad", "B10b Cash");
        using var maya = CreateClient();
        var mayaId = await InviteAndAcceptAsync(coach, maya, "b10b-cash-maya@example.test", true);
        var product = await B10bPackProductAsync(coach, "Single session", B10bPackOffer(1, 30, 35m));
        var pack = await A7EnrollAsync(coach, mayaId, product.Offers[0].Id, today);

        // Only the whole of what is left opens the pack, so anything else records nothing at all.
        var part = await A7ConflictAsync(await B10bPostSessionAsync(coach, mayaId, today, receipt: B10bCash(20m)));
        Assert.AreEqual("session_receipt_not_full", part.Code);
        Assert.AreEqual("Single session needs paying in full before a session goes on it: USD 35 is left to pay.", part.Message);
        var over = await A7ConflictAsync(await B10bPostSessionAsync(coach, mayaId, today, receipt: B10bCash(36m)));
        Assert.AreEqual("session_receipt_not_full", over.Code);
        var currency = await B10bPostSessionAsync(coach, mayaId, today, receipt: B10bCash(35m, "EUR"));
        await AssertStatusAsync(currency, HttpStatusCode.BadRequest);
        var cents = await B10bPostSessionAsync(coach, mayaId, today, receipt: B10bCash(1.005m));
        Assert.AreEqual(MoneyRules.TwoDecimalsMessage, await A7FieldErrorAsync(cents, "amount"));
        var untouched = (await ReadSliceAsync<ClientCommercialOverview>(coach, $"/api/commercial/clients/{mayaId}")).Enrollments.Single();
        Assert.AreEqual((EnrollmentStatus.PendingPayment, 0m), (untouched.StoredStatus, untouched.PaidAmount));
        Assert.IsEmpty(untouched.Sessions!.Entries);

        // The exact amount pays it, opens its session and uses it, all in one command, dated the session's day.
        var key = Guid.NewGuid();
        var paid = await B10bRecordAsync(coach, mayaId, today, note: "Paid at the gym", receipt: B10bCash(35m), key: key);
        Assert.AreEqual((pack.Id, EnrollmentStatus.Active, 35m, 0m), (paid.Id, paid.StoredStatus, paid.PaidAmount, paid.BalanceAmount));
        Assert.AreEqual("Held | Issued", string.Join(" | ", paid.Sessions!.Entries.OrderByDescending(item => item.Kind).Select(item => item.Kind)));
        var receipt = paid.Payments.Single();
        Assert.AreEqual((35m, "USD", today, ManualPaymentMethod.Cash), (receipt.Amount, receipt.CurrencyCode, receipt.ReceivedOn, receipt.Method));

        // A retry of the whole command does nothing more, and a changed receipt under the key conflicts.
        var retried = await B10bRecordAsync(coach, mayaId, today, note: "Paid at the gym", receipt: B10bCash(35m), key: key);
        Assert.AreEqual((1, 35m), (retried.Payments.Count, retried.PaidAmount));
        Assert.AreEqual(1, retried.Sessions!.Held);
        var changed = await A7ConflictAsync(await B10bPostSessionAsync(coach, mayaId, today, note: "Paid at the gym", receipt: B10bCash(35m, method: "BankTransfer"), key: key));
        Assert.AreEqual("idempotency_key_reused", changed.Code);

        // Money with nothing waiting for it has no pack to pay.
        Assert.AreEqual(
            ("no_pack_waiting_for_payment", "No pack is waiting for payment on that day."),
            await A7ConflictAsync(await B10bPostSessionAsync(coach, mayaId, today, receipt: B10bCash(35m))));

        // A receipt on an earlier day is dated that day, and pays a pack still to be used; a pack already running
        // with a session left takes the session, ending first as always.
        RequiredTestClock.Advance(TimeSpan.FromDays(3));
        var yesterday = today.AddDays(2);
        var goodwill = await B10bPackProductAsync(coach, "On the house", B10bPackOffer(1, 5, 0m));
        var running = await A7EnrollAsync(coach, mayaId, goodwill.Offers[0].Id, today);
        var paying = await A7EnrollAsync(coach, mayaId, product.Offers[0].Id, today);
        var taken = await B10bRecordAsync(coach, mayaId, yesterday, receipt: B10bCash(35m));
        Assert.AreEqual(running.Id, taken.Id);
        var opened = (await ReadSliceAsync<ClientCommercialOverview>(coach, $"/api/commercial/clients/{mayaId}"))
            .Enrollments.Single(item => item.Id == paying.Id);
        Assert.AreEqual((EnrollmentStatus.Active, 1, yesterday), (opened.StoredStatus, opened.Sessions!.Left, opened.Payments.Single().ReceivedOn));
    }

    [TestMethod]
    public async Task B10bAPackEndsOnItsDayWhatIsLeftLapsesAndAPauseStopsAccessAlone()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "b10b-end-coach@example.test", "Karim Haddad", "B10b End");
        using var maya = CreateClient();
        var mayaId = await InviteAndAcceptAsync(coach, maya, "b10b-end-maya@example.test", true);
        var product = await B10bPackProductAsync(coach, "Short pack", B10bPackOffer(5, 10, 0m));
        var pack = await A7EnrollAsync(coach, mayaId, product.Offers[0].Id, today);
        await B10bRecordAsync(coach, mayaId, today);

        // A pause stops access and leaves the dates alone.
        RequiredTestClock.Advance(TimeSpan.FromDays(2));
        var paused = await B10aChangeAsync(coach, pack.Id, "pause", new { reason = "Injured", Version = await B10aVersionAsync(coach, mayaId, pack.Id) });
        Assert.AreEqual(pack.EndDateExclusive, paused.EndDateExclusive);
        var access = (await ReadSliceAsync<ClientCommercialOverview>(coach, $"/api/commercial/clients/{mayaId}"))
            .FeatureAccess.Single(item => item.Feature == CoachingFeature.Sessions);
        Assert.AreEqual((false, FeatureAccessReason.Paused), (access.IsAllowed, access.Reason));
        await B10aChangeAsync(coach, pack.Id, "resume", new { paused.Version });

        // On the last covered day nothing has lapsed; a session the day after is outside it, for good.
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        Assert.AreEqual((4, 0), B10bLeftAndLapsed(await B10bPackViewAsync(coach, mayaId, pack.Id)));
        RequiredTestClock.Advance(TimeSpan.FromDays(1));
        var lastDay = today.AddDays(9);
        var over = await B10bPackViewAsync(coach, mayaId, pack.Id);
        Assert.AreEqual((4, 4), B10bLeftAndLapsed(over));
        Assert.AreEqual(lastDay, over.LapsedOn);
        Assert.AreEqual("session_day_outside_pack", (await A7ConflictAsync(await B10bPostSessionAsync(coach, mayaId, today.AddDays(10)))).Code);

        // A session held on its last day and recorded the next morning still counts: its day is inside the pack.
        var late = await B10bRecordAsync(coach, mayaId, lastDay, note: "Recorded the morning after");
        Assert.AreEqual((3, 3), B10bLeftAndLapsed(late.Sessions!));
        var closed = (await ReadSliceAsync<ClientCommercialOverview>(coach, $"/api/commercial/clients/{mayaId}"))
            .FeatureAccess.Single(item => item.Feature == CoachingFeature.Sessions);
        Assert.AreEqual((false, FeatureAccessReason.Expired), (closed.IsAllowed, closed.Reason));

        // Nothing lets a pack past its end: no renewal touches it, and its dates are immutable.
        Assert.AreEqual(
            "55000",
            (await A7RefusedAsync($"UPDATE subscriptions.\"ClientEnrollments\" SET \"EndDateExclusive\" = \"EndDateExclusive\" + 30 WHERE \"Id\" = '{pack.Id}'")).SqlState);
    }

    [TestMethod]
    public async Task B10bRetriesAndRacesRecordOneSession()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "b10b-race-coach@example.test", "Karim Haddad", "B10b Race");
        using var maya = CreateClient();
        var mayaId = await InviteAndAcceptAsync(coach, maya, "b10b-race-maya@example.test", true);
        var product = await B10bPackProductAsync(coach, "Personal training", B10bPackOffer(3, 30, 0m));
        var pack = await A7EnrollAsync(coach, mayaId, product.Offers[0].Id, today);

        // The same command retried at once is one session; each attempt reads the same result.
        var key = Guid.NewGuid();
        await RefreshCsrfAsync(coach);
        var retries = await Task.WhenAll(Enumerable.Range(0, 4).Select(_ => B10bSendSessionAsync(coach, mayaId, today, note: "One", key: key)));
        foreach (var retry in retries)
        {
            await AssertStatusAsync(retry, HttpStatusCode.OK);
        }

        Assert.AreEqual(2, (await B10bPackViewAsync(coach, mayaId, pack.Id)).Left);

        // The key is bound to what was entered: another day, outcome or note under it conflicts.
        foreach (var changed in new[]
        {
            await B10bPostSessionAsync(coach, mayaId, today, note: "Two", key: key),
            await B10bPostSessionAsync(coach, mayaId, today.AddDays(-1), note: "One", key: key),
            await B10bPostSessionAsync(coach, mayaId, today, "Charged", reason: "One", key: key),
        })
        {
            Assert.AreEqual("idempotency_key_reused", (await A7ConflictAsync(changed)).Code);
        }

        // Two sessions left and five different commands at once: two take them, the rest are told none is left.
        await RefreshCsrfAsync(coach);
        var raced = await Task.WhenAll(Enumerable.Range(0, 5).Select(_ => B10bSendSessionAsync(coach, mayaId, today)));
        Assert.AreEqual(2, raced.Count(item => item.StatusCode == HttpStatusCode.OK));
        foreach (var refused in raced.Where(item => item.StatusCode != HttpStatusCode.OK))
        {
            Assert.AreEqual("no_sessions_left", (await A7ConflictAsync(refused)).Code);
        }

        var view = await B10bPackViewAsync(coach, mayaId, pack.Id);
        Assert.AreEqual((0, 3), (view.Left, view.Held));

        // Two undos of one row at once are one undo.
        var held = view.Entries.First(item => item.Kind == SessionEntryKind.Held);
        await RefreshCsrfAsync(coach);
        var undos = await Task.WhenAll(Enumerable.Range(0, 3).Select(_ =>
            coach.PostAsJsonAsync($"/api/commercial/clients/{mayaId}/sessions/{held.Id}/void", new { idempotencyKey = Guid.NewGuid() })));
        Assert.AreEqual(1, undos.Count(item => item.StatusCode == HttpStatusCode.OK));
        Assert.AreEqual(1, (await B10bPackViewAsync(coach, mayaId, pack.Id)).Left);
    }

    [TestMethod]
    public async Task B10bTheDatabaseHoldsTheLedgerAndThePacksTermsWhoeverWrites()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "b10b-sql-coach@example.test", "Karim Haddad", "B10b Sql");
        using var maya = CreateClient();
        var mayaId = await InviteAndAcceptAsync(coach, maya, "b10b-sql-maya@example.test", true);
        var coachId = (await TeamMembersAsync(coach)).Single().UserId;
        var product = await B10bPackProductAsync(coach, "Personal training", B10bPackOffer(1, 30, 0m));
        var pack = await A7EnrollAsync(coach, mayaId, product.Offers[0].Id, today);
        var waitingProduct = await B10bPackProductAsync(coach, "Waiting pack", B10bPackOffer(1, 30, 50m));
        var waiting = await A7EnrollAsync(coach, mayaId, waitingProduct.Offers[0].Id, today);
        var plan = await B10aProductAsync(coach, "Online Coaching", null, B10aOffer("4 weeks", 4, 0m, "Training"));
        var coachingPlan = await A7EnrollAsync(coach, mayaId, plan.Offers[0].Id, today);
        var used = await B10bRecordAsync(coach, mayaId, today);
        Assert.AreEqual(pack.Id, used.Id);
        var heldId = used.Sessions!.Entries.Single(item => item.Kind == SessionEntryKind.Held).Id;
        var issuedId = used.Sessions.Entries.Single(item => item.Kind == SessionEntryKind.Issued).Id;

        // Append-only: no change and no delete, of any row.
        foreach (var sql in new[]
        {
            $"UPDATE subscriptions.\"SessionLedgerEntries\" SET \"Note\" = 'Changed' WHERE \"Id\" = '{heldId}'",
            $"UPDATE subscriptions.\"SessionLedgerEntries\" SET \"Day\" = \"Day\" - 1 WHERE \"Id\" = '{heldId}'",
            $"DELETE FROM subscriptions.\"SessionLedgerEntries\" WHERE \"Id\" = '{heldId}'",
            $"DELETE FROM subscriptions.\"SessionLedgerEntries\" WHERE \"Id\" = '{issuedId}'",
            $"UPDATE subscriptions.\"ProductOffers\" SET \"SessionCount\" = 50 WHERE \"Id\" = '{product.Offers[0].Id}'",
            $"UPDATE subscriptions.\"ClientEnrollments\" SET \"SessionCountSnapshot\" = 50 WHERE \"Id\" = '{pack.Id}'",
            $"UPDATE subscriptions.\"CoachingProducts\" SET \"Kind\" = 'CoachingPlan' WHERE \"Id\" = '{product.Id}'",
        })
        {
            Assert.AreEqual("55000", (await A7RefusedAsync(sql)).SqlState, sql);
        }

        string Row(Guid enrollmentId, string kind, int count, DateOnly day, Guid? coachUser, string? reason = null, Guid? voids = null, Guid? client = null) =>
            $"""
            INSERT INTO subscriptions."SessionLedgerEntries"
                ("Id", "TenantId", "EnrollmentId", "ClientProfileId", "Kind", "Count", "Day", "CoachUserId", "Reason", "VoidsEntryId", "IdempotencyKey")
            SELECT '{Guid.NewGuid()}', "TenantId", '{enrollmentId}', '{client ?? mayaId}', '{kind}', {count}, '{B10bDay(day)}',
                {(coachUser is { } id ? $"'{id}'" : "NULL")}, {(reason is null ? "NULL" : $"'{reason}'")}, {(voids is { } target ? $"'{target}'" : "NULL")}, '{Guid.NewGuid()}'
            FROM subscriptions."ClientEnrollments" WHERE "Id" = '{pack.Id}'
            """;

        // The guard refuses, as check violations, what the service would refuse in words.
        foreach (var sql in new[]
        {
            Row(pack.Id, "Held", 1, today, coachId),
            Row(pack.Id, "Charged", 1, today, coachId, "No-show"),
            Row(waiting.Id, "Held", 1, today, coachId),
            Row(coachingPlan.Id, "Issued", 1, today, null),
            Row(waiting.Id, "Issued", 2, today, null),
            Row(pack.Id, "Voided", 1, today, null, voids: issuedId),
            Row(waiting.Id, "Voided", 1, today, null, voids: heldId),
        })
        {
            Assert.AreEqual("23514", (await A7RefusedAsync(sql)).SqlState, sql);
        }

        // The table's own checks, and one Issued per pack, one correction per row.
        foreach (var sql in new[]
        {
            Row(pack.Id, "Held", 1, today, null),
            Row(pack.Id, "Charged", 1, today, coachId),
            Row(pack.Id, "Held", 2, today, coachId),
            Row(pack.Id, "Voided", 1, today, null),
            Row(pack.Id, "Issued", 0, today, null),
        })
        {
            Assert.AreEqual("23514", (await A7RefusedAsync(sql)).SqlState, sql);
        }

        Assert.AreEqual("23505", (await A7RefusedAsync(Row(pack.Id, "Issued", 1, today, null))).SqlState);
        await B10bVoidOkAsync(coach, mayaId, heldId, Guid.NewGuid());
        Assert.AreEqual("23505", (await A7RefusedAsync(Row(pack.Id, "Voided", 1, today, null, voids: heldId))).SqlState);

        // Outside the pack's dates, and on a client it is not theirs, however the row arrives.
        Assert.AreEqual("23514", (await A7RefusedAsync(Row(pack.Id, "Held", 1, today.AddDays(40), coachId))).SqlState);
        using var rami = CreateClient();
        var ramiId = await InviteAndAcceptAsync(coach, rami, "b10b-sql-rami@example.test", true);
        Assert.AreEqual("23514", (await A7RefusedAsync(Row(pack.Id, "Held", 1, today, coachId, client: ramiId))).SqlState);

        // A coach's user id that is not a member of this workspace cannot sit on its ledger.
        Assert.AreEqual("23503", (await A7RefusedAsync(Row(pack.Id, "Held", 1, today, Guid.NewGuid()))).SqlState);
    }

    [TestMethod]
    public async Task B10bOnlyTheClientsCoachInThisWorkspaceReachesTheirSessions()
    {
        var today = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b10b-who-owner@example.test", "Hicham Haddad", "B10b Who");
        using var lea = CreateClient();
        await JoinAsCoachAsync(owner, lea, "b10b-who-lea@example.test", "Lea Khoury");
        using var omar = CreateClient();
        await JoinAsCoachAsync(owner, omar, "b10b-who-omar@example.test", "Omar Saad");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(lea, maya, tenant, "b10b-who-maya@example.test", "Maya", "Rahman");
        var product = await B10bPackProductAsync(owner, "Personal training", B10bPackOffer(3, 30, 0m));
        var pack = await A7EnrollAsync(owner, mayaId, product.Offers[0].Id, today);
        var recorded = await B10bRecordAsync(lea, mayaId, today);
        var held = recorded.Sessions!.Entries.Single(item => item.Kind == SessionEntryKind.Held);

        // Nobody signed in.
        using var anonymous = CreateClient();
        SetTenant(anonymous, tenant);
        await RefreshCsrfAsync(anonymous);
        await AssertStatusAsync(await B10bSendSessionAsync(anonymous, mayaId, today), HttpStatusCode.Unauthorized);

        // The client on the coach's route.
        await RefreshCsrfAsync(maya);
        await AssertStatusAsync(await B10bSendSessionAsync(maya, mayaId, today), HttpStatusCode.Forbidden);

        // Another coach's client reads as missing, the record and the undo alike (ADR 0026).
        await AssertStatusAsync(await B10bPostSessionAsync(omar, mayaId, today), HttpStatusCode.NotFound);
        await AssertStatusAsync(await B10bPostVoidAsync(omar, mayaId, held.Id, Guid.NewGuid()), HttpStatusCode.NotFound);

        // Another workspace knows neither the client nor their ledger, and its own header proves nothing.
        using var stranger = CreateClient();
        var strangers = await RegisterCoachAsync(stranger, "b10b-who-stranger@example.test", "Other Coach", "B10b Other");
        await AssertStatusAsync(await B10bPostSessionAsync(stranger, mayaId, today), HttpStatusCode.NotFound);
        await AssertStatusAsync(await B10bPostVoidAsync(stranger, mayaId, held.Id, Guid.NewGuid()), HttpStatusCode.NotFound);
        SetTenant(stranger, tenant);
        await AssertStatusAsync(await B10bPostSessionAsync(stranger, mayaId, today), HttpStatusCode.Forbidden);
        SetTenant(stranger, strangers);

        // An antiforgery token is required like every other write.
        owner.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
        await AssertStatusAsync(await B10bSendSessionAsync(owner, mayaId, today), HttpStatusCode.BadRequest);
        Assert.AreEqual(1, (await B10bPackViewAsync(owner, mayaId, pack.Id)).Held);

        // The owner sees and writes for every client of the workspace.
        await B10bRecordAsync(owner, mayaId, today);

        // Released, the record is read-only, by the route and through the row alike (ADR 0027).
        await ReleaseAsync(owner, mayaId, "Moved away");
        Assert.AreEqual("client_released", (await A7ConflictAsync(await B10bPostSessionAsync(owner, mayaId, today))).Code);
        Assert.AreEqual("client_released", (await A7ConflictAsync(await B10bPostVoidAsync(owner, mayaId, held.Id, Guid.NewGuid()))).Code);
        var kept = await B10bPackViewAsync(owner, mayaId, pack.Id);
        Assert.AreEqual((2, 1), (kept.Held, kept.Lapsed), "Their ledger is kept, and what was left lapsed the day coaching ended.");
    }

    [TestMethod]
    public async Task B10bAPackOnlyClientIsACoveredClientAndNeverStandsInForACoachingPlan()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "b10b-list-coach@example.test", "Karim Haddad", "B10b List");
        using var maya = CreateClient();
        var mayaId = await InviteAndAcceptAsync(coach, maya, "b10b-list-maya@example.test", true);
        using var rami = CreateClient();
        var ramiId = await InviteAndAcceptAsync(coach, rami, "b10b-list-rami@example.test", true);
        var pack = await B10bPackProductAsync(coach, "Personal training", B10bPackOffer(5, 90, 0m));

        // Pack-only, a client is not greeted as having no plan.
        await A7EnrollAsync(coach, mayaId, pack.Offers[0].Id, today);
        var row = await B4aRowAsync(coach, mayaId);
        Assert.AreEqual(ClientPlanState.Running, row.PlanState);
        Assert.AreEqual((today.AddDays(89), "Personal training"), (row.PlanEndsOn!.Value, row.Plan!.Name));
        Assert.AreEqual(CoachingFeature.Sessions, row.FeaturesToday.Single());

        // Beside a coaching plan ending sooner, the pack says nothing of when the plan ends.
        var plan = await B10aProductAsync(coach, "Online Coaching", null, B10aOffer("2 weeks", 2, 0m, "Training"));
        await A7EnrollAsync(coach, ramiId, pack.Offers[0].Id, today);
        await A7EnrollAsync(coach, ramiId, plan.Offers[0].Id, today);
        var both = await B4aRowAsync(coach, ramiId);
        Assert.AreEqual((today.AddDays(13), "Online Coaching", 1), (both.PlanEndsOn!.Value, both.Plan!.Name, both.OtherPlanCount));
        Assert.IsTrue(both.Attention.Contains(CoachAttentionKind.PlanEndingSoon), "The plan's end still raises its flag.");

        // A pack that ran out is a plan that ran out: the client may ask to renew it (SUB-014).
        var shortPack = await B10bPackProductAsync(coach, "Short pack", B10bPackOffer(1, 7, 0m));
        using var nour = CreateClient();
        var nourId = await InviteAndAcceptAsync(coach, nour, "b10b-list-nour@example.test", true);
        await A7EnrollAsync(coach, nourId, shortPack.Offers[0].Id, today);
        RequiredTestClock.Advance(TimeSpan.FromDays(8));
        var ended = await ReadSliceAsync<RenewalStatusView>(nour, "/api/client-renewal/me");
        Assert.AreEqual((true, true, (DateOnly?)today.AddDays(6)), (ended.PlanEnded, ended.CanAsk, ended.EndedOn));
    }

    [TestMethod]
    public async Task B10bAPackOnlyClientCountsOnTheWorkspacesBillAndAPackAwaitingPaymentDoesNot()
    {
        RequiredTestClock.Set(BillingWorkspaceCreated);
        using var owner = CreateClient();
        await RegisterCoachAsync(owner, "b10b-bill-owner@example.test", "Bill Owner", "B10b Bill");
        using var covered = CreateClient();
        var coveredId = await InviteAndAcceptAsync(owner, covered, "b10b-bill-a@example.test", true);
        using var waiting = CreateClient();
        var waitingId = await InviteAndAcceptAsync(owner, waiting, "b10b-bill-b@example.test", true);
        var free = await B10bPackProductAsync(owner, "Free pack", B10bPackOffer(5, 90, 0m));
        var paid = await B10bPackProductAsync(owner, "Paid pack", B10bPackOffer(5, 90, 100m));
        await A7EnrollAsync(owner, coveredId, free.Offers[0].Id, BillingLocalDate());
        await A7EnrollAsync(owner, waitingId, paid.Offers[0].Id, BillingLocalDate());

        RequiredTestClock.Set(new DateTimeOffset(2026, 8, 1, 0, 10, 0, TimeSpan.Zero));
        Assert.AreEqual(1, (await IssueBillingAsync(BillingJuly)).Issued);
        var invoice = (await RequiredJsonAsync<BillingView>(await owner.GetAsync("/api/billing"))).Invoices.Single();
        Assert.AreEqual(1, invoice.Amounts.BillableClients, "A pack is coverage like any plan, once it is active (PBL-002).");
    }

    /// <summary>A pack's price option as the plan editor sends one: its days of validity and what it holds.</summary>
    private static object B10bPackOffer(int sessions, int days, decimal price, string currency = "USD", params string[] features) => new
    {
        label = sessions == 1 ? "Single session" : $"{sessions} sessions",
        durationCount = days,
        durationUnit = "Day",
        priceAmount = price,
        priceCurrency = currency,
        features = features.Select(feature => new { feature, allowsConcurrentCoverage = false }).ToArray(),
        sessionCount = sessions,
    };

    private static async Task<CoachingProductView> B10bPackProductAsync(HttpClient coach, string name, object offer)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync(A7ProductsUrl, new { name, kind = "SessionPack", initialOffer = offer });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<CoachingProductView>(response);
    }

    private static string B10bDay(DateOnly day) => day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static Task<HttpResponseMessage> B10bSendSessionAsync(
        HttpClient coach,
        Guid clientId,
        DateOnly day,
        string outcome = "Held",
        string? note = null,
        string? reason = null,
        object? receipt = null,
        Guid? key = null) =>
        coach.PostAsJsonAsync($"/api/commercial/clients/{clientId}/sessions", new
        {
            outcome,
            day = B10bDay(day),
            note,
            reason,
            receipt,
            idempotencyKey = key ?? Guid.NewGuid(),
        });

    private static async Task<HttpResponseMessage> B10bPostSessionAsync(
        HttpClient coach,
        Guid clientId,
        DateOnly day,
        string outcome = "Held",
        string? note = null,
        string? reason = null,
        object? receipt = null,
        Guid? key = null)
    {
        await RefreshCsrfAsync(coach);
        return await B10bSendSessionAsync(coach, clientId, day, outcome, note, reason, receipt, key);
    }

    private static async Task<ClientEnrollmentView> B10bRecordAsync(
        HttpClient coach,
        Guid clientId,
        DateOnly day,
        string outcome = "Held",
        string? note = null,
        string? reason = null,
        object? receipt = null,
        Guid? key = null)
    {
        var response = await B10bPostSessionAsync(coach, clientId, day, outcome, note, reason, receipt, key);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<ClientEnrollmentView>(response);
    }

    private static async Task<HttpResponseMessage> B10bPostVoidAsync(HttpClient coach, Guid clientId, Guid entryId, Guid key)
    {
        await RefreshCsrfAsync(coach);
        return await coach.PostAsJsonAsync($"/api/commercial/clients/{clientId}/sessions/{entryId}/void", new { idempotencyKey = key });
    }

    private static async Task<HttpResponseMessage> B10bVoidOkAsync(HttpClient coach, Guid clientId, Guid entryId, Guid key)
    {
        var response = await B10bPostVoidAsync(coach, clientId, entryId, key);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return response;
    }

    private static async Task<SessionPackView> B10bPackViewAsync(HttpClient coach, Guid clientId, Guid packId) =>
        (await ReadSliceAsync<ClientCommercialOverview>(coach, $"/api/commercial/clients/{clientId}"))
            .Enrollments.Single(item => item.Id == packId).Sessions!;

    private static (int Left, int Lapsed) B10bLeftAndLapsed(SessionPackView pack) => (pack.Left, pack.Lapsed);

    private static object B10bCash(decimal amount, string currency = "USD", string method = "Cash") =>
        new { amount, currencyCode = currency, method };

    /// <summary>The unique index itself: a second active row in the slot, past the service.</summary>
    private async Task A7ExpectUniqueSlotAsync(ProductOfferView offer)
    {
        var refused = await A7RefusedAsync($"""
            INSERT INTO subscriptions."ProductOffers"
                ("Id", "TenantId", "ProductId", "Label", "BillingModel", "DurationCount", "DurationUnit", "PriceAmount", "PriceCurrency", "IsActive", "SessionCount")
            SELECT '{Guid.NewGuid()}', "TenantId", "ProductId", 'Same slot', "BillingModel", "DurationCount", "DurationUnit", 1, "PriceCurrency", TRUE, "SessionCount"
            FROM subscriptions."ProductOffers" WHERE "Id" = '{offer.Id}'
            """);
        Assert.AreEqual(("23505", "IX_ProductOffers_ActiveDurationCurrency"), (refused.SqlState, refused.ConstraintName));
    }
}
