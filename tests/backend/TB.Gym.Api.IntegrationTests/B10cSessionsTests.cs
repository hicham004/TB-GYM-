using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.SharedKernel;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Critique B10c, sessions for clients and on Today (SES-007, SES-008): what a client reads of their packs, the balance
/// on the client's row, the item when sessions run out, and the sessions held in This month, each for the people it
/// belongs to and nobody else.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task B10cAClientReadsWhatIsLeftAndWhatHappenedAndNothingTheTeamKeptToItself()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "b10c-read-coach@example.test", "Karim Haddad", "B10c Read");
        using var maya = CreateClient();
        var mayaId = await InviteAndAcceptAsync(coach, maya, "b10c-read-maya@example.test", true);
        using var rami = CreateClient();
        var ramiId = await InviteAndAcceptAsync(coach, rami, "b10c-read-rami@example.test", true);
        var product = await B10bPackProductAsync(coach, "Personal training", B10bPackOffer(10, 90, 0m));
        var pack = await A7EnrollAsync(coach, mayaId, product.Offers[0].Id, today);
        await A7EnrollAsync(coach, ramiId, product.Offers[0].Id, today);

        var fresh = await ReadSliceAsync<OwnPlansView>(maya, OwnPlansUrl);
        Assert.AreEqual("Karim Haddad", fresh.CoachName);
        var untouched = fresh.Plans.Single().Sessions!;
        Assert.AreEqual((10, 10, 0, 0), (untouched.Count, untouched.Left, untouched.Used, untouched.Lapsed));
        Assert.IsEmpty(untouched.Sessions);

        const string TeamNote = "Left knee still sore, go lighter";
        await B10bRecordAsync(coach, mayaId, today, note: TeamNote);
        RequiredTestClock.Advance(TimeSpan.FromDays(1));
        await B10bRecordAsync(coach, mayaId, today.AddDays(1), "Charged", reason: "No-show: you didn't come");
        RequiredTestClock.Advance(TimeSpan.FromDays(1));
        var wrong = await B10bRecordAsync(coach, mayaId, today.AddDays(2), note: "Wrong client");
        var undo = wrong.Sessions!.Entries.First(item => item.Kind == SessionEntryKind.Held);
        await B10bVoidOkAsync(coach, mayaId, undo.Id, Guid.NewGuid());
        await B10bRecordAsync(coach, ramiId, today.AddDays(2), note: "Rami's own");

        var own = (await ReadSliceAsync<OwnPlansView>(maya, OwnPlansUrl)).Plans.Single();
        Assert.AreEqual(pack.Id, own.Id);
        var sessions = own.Sessions!;
        Assert.AreEqual((10, 8, 2, 0), (sessions.Count, sessions.Left, sessions.Used, sessions.Lapsed));
        Assert.AreEqual(
            $"{today.AddDays(1)} Charged No-show: you didn't come | {today} Held -",
            string.Join(" | ", sessions.Sessions.Select(item => $"{item.Day} {item.Outcome} {item.Reason ?? "-"}")),
            "Newest first, what was undone gone, and only their own.");

        // These fields and no others: a client reads every one of them.
        var body = await maya.GetStringAsync(OwnPlansUrl);
        using (var document = JsonDocument.Parse(body))
        {
            Assert.AreEqual("coachName,plans,today", B10aFieldNames(document.RootElement));
            var read = document.RootElement.GetProperty("plans")[0].GetProperty("sessions");
            Assert.AreEqual("count,lapsed,lapsedOn,left,sessions,used", B10aFieldNames(read));
            Assert.AreEqual("day,outcome,reason", B10aFieldNames(read.GetProperty("sessions")[0]));
        }

        Assert.DoesNotContain(TeamNote, body);
        Assert.DoesNotContain("Wrong client", body);
        Assert.DoesNotContain(undo.Id.ToString(), body);
        Assert.DoesNotContain("coachUserId", body, StringComparison.OrdinalIgnoreCase);

        // The other client on the same pack reads their own alone.
        var hers = (await ReadSliceAsync<OwnPlansView>(rami, OwnPlansUrl)).Plans.Single().Sessions!;
        Assert.AreEqual((9, 1), (hers.Left, hers.Used));
        Assert.DoesNotContain("No-show", await rami.GetStringAsync(OwnPlansUrl));

        // The read is a client's: the coach's route to the same ledger is another, and nobody signed out reads either.
        await AssertStatusAsync(await coach.GetAsync(OwnPlansUrl), HttpStatusCode.Forbidden);
        using var anonymous = CreateClient();
        await AssertStatusAsync(await anonymous.GetAsync(OwnPlansUrl), HttpStatusCode.Unauthorized);
    }

    [TestMethod]
    public async Task B10cAPackReadsAsItStandsAndACoachingPlanHasNoSessions()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "b10c-states-coach@example.test", "Karim Haddad", "B10c States");
        using var maya = CreateClient();
        var mayaId = await InviteAndAcceptAsync(coach, maya, "b10c-states-maya@example.test", true);
        var paid = await B10bPackProductAsync(coach, "Personal training", B10bPackOffer(5, 10, 100m));
        var plan = await B10aProductAsync(coach, "Online Coaching", null, B10aOffer("12 weeks", 12, 0m, "Training"));

        // A coaching plan alone names no coach here: it has no sentence to put them in.
        await A7EnrollAsync(coach, mayaId, plan.Offers[0].Id, today);
        var planOnly = await ReadSliceAsync<OwnPlansView>(maya, OwnPlansUrl);
        Assert.IsNull(planOnly.Plans.Single().Sessions);
        Assert.IsNull(planOnly.CoachName);

        // Waiting for payment, a pack holds nothing yet.
        var pack = await A7EnrollAsync(coach, mayaId, paid.Offers[0].Id, today);
        var waiting = (await ReadSliceAsync<OwnPlansView>(maya, OwnPlansUrl)).Plans.Single(item => item.Id == pack.Id);
        Assert.AreEqual(EffectiveEnrollmentStatus.PendingPayment, waiting.Status);
        Assert.AreEqual((5, 0, 0), (waiting.Sessions!.Count, waiting.Sessions.Left, waiting.Sessions.Used));

        // Blocked, the client still reads their plan (SUB-009), and what is left on it.
        await A7PayAsync(coach, pack.Id, 100m, today, Guid.NewGuid());
        await B10bRecordAsync(coach, mayaId, today);
        var client = await RequiredJsonAsync<TeamClientDetails>(await coach.GetAsync($"/api/clients/{mayaId}"));
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PostAsJsonAsync($"/api/clients/{mayaId}/relationship/block",
            new { reason = "B10c block check", client.Version }), HttpStatusCode.OK);
        var blocked = (await ReadSliceAsync<OwnPlansView>(maya, OwnPlansUrl)).Plans.Single(item => item.Id == pack.Id);
        Assert.AreEqual((EffectiveEnrollmentStatus.Blocked, 4), (blocked.Status, blocked.Sessions!.Left));
        client = await RequiredJsonAsync<TeamClientDetails>(await coach.GetAsync($"/api/clients/{mayaId}"));
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PostAsJsonAsync($"/api/clients/{mayaId}/relationship/unblock",
            new { reason = "B10c block check done", client.Version }), HttpStatusCode.OK);

        // Over, what was left has lapsed. With a plan still running it leaves the page, as any plan that is over does.
        RequiredTestClock.Advance(TimeSpan.FromDays(10));
        Assert.IsTrue((await ReadSliceAsync<OwnPlansView>(maya, OwnPlansUrl)).Plans.All(item => item.Id != pack.Id));

        using var nour = CreateClient();
        var nourId = await InviteAndAcceptAsync(coach, nour, "b10c-states-nour@example.test", true);
        var shortPack = await B10bPackProductAsync(coach, "Short pack", B10bPackOffer(5, 3, 0m));
        var ended = await A7EnrollAsync(coach, nourId, shortPack.Offers[0].Id, today.AddDays(10));
        await B10bRecordAsync(coach, nourId, today.AddDays(10));
        RequiredTestClock.Advance(TimeSpan.FromDays(3));
        var over = (await ReadSliceAsync<OwnPlansView>(nour, OwnPlansUrl)).Plans.Single();
        Assert.AreEqual((ended.Id, EffectiveEnrollmentStatus.Expired), (over.Id, over.Status));
        Assert.AreEqual((4, 1, 4, (DateOnly?)today.AddDays(12)), (over.Sessions!.Left, over.Sessions.Used, over.Sessions.Lapsed, over.Sessions.LapsedOn));
    }

    [TestMethod]
    public async Task B10cTheClientsRowSaysWhatIsLeftWhileSessionsAreInTodaysPlan()
    {
        var today = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b10c-row-owner@example.test", "Hicham Haddad", "B10c Row");
        using var lea = CreateClient();
        await JoinAsCoachAsync(owner, lea, "b10c-row-lea@example.test", "Lea Khoury");
        using var omar = CreateClient();
        await JoinAsCoachAsync(owner, omar, "b10c-row-omar@example.test", "Omar Saad");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(lea, maya, tenant, "b10c-row-maya@example.test", "Maya", "Rahman");
        using var rami = CreateClient();
        var ramiId = await R31InviteAsync(lea, rami, tenant, "b10c-row-rami@example.test", "Rami", "Nassar");
        var ten = await B10bPackProductAsync(owner, "Personal training", B10bPackOffer(10, 90, 300m));
        var two = await B10bPackProductAsync(owner, "Two sessions", B10bPackOffer(2, 90, 0m));
        var plan = await B10aProductAsync(owner, "Online Coaching", null, B10aOffer("12 weeks", 12, 0m, "Training"));

        // A client with no pack has no balance, and one waiting for payment holds none yet.
        await A7EnrollAsync(owner, ramiId, plan.Offers[0].Id, today);
        Assert.IsNull((await B4aRowAsync(lea, ramiId)).SessionsLeft);
        var sold = await A7EnrollAsync(owner, mayaId, ten.Offers[0].Id, today);
        Assert.IsNull((await B4aRowAsync(lea, mayaId)).SessionsLeft);

        await A7PayAsync(owner, sold.Id, 300m, today, Guid.NewGuid());
        await B10bRecordAsync(lea, mayaId, today);
        Assert.AreEqual(9, (await B4aRowAsync(lea, mayaId)).SessionsLeft);
        Assert.AreEqual(9, (await B4aRowAsync(owner, mayaId)).SessionsLeft, "The owner reads every client's.");

        // Several packs add up, and one still to come counts: it is paid for.
        await A7EnrollAsync(owner, mayaId, two.Offers[0].Id, today.AddDays(30));
        Assert.AreEqual(11, (await B4aRowAsync(lea, mayaId)).SessionsLeft);

        // A pause stops access (SES-006), so sessions are out of today's plan until it is resumed.
        var paused = await B10aChangeAsync(owner, sold.Id, "pause", new { reason = "Injured", Version = await B10aVersionAsync(owner, mayaId, sold.Id) });
        Assert.IsNull((await B4aRowAsync(lea, mayaId)).SessionsLeft);
        await B10aChangeAsync(owner, sold.Id, "resume", new { paused.Version });
        Assert.AreEqual(11, (await B4aRowAsync(lea, mayaId)).SessionsLeft);

        // Another coach reads no row of Maya's, and another workspace none.
        var omarsList = await ReadSliceAsync<ClientOverviewView>(omar, ClientOverviewUrl);
        Assert.IsTrue(omarsList.Clients.All(row => row.Client.ClientProfileId != mayaId));
        using var stranger = CreateClient();
        await RegisterCoachAsync(stranger, "b10c-row-stranger@example.test", "Other Coach", "B10c Elsewhere");
        Assert.IsEmpty((await ReadSliceAsync<ClientOverviewView>(stranger, ClientOverviewUrl)).Clients);
        SetTenant(stranger, tenant);
        await AssertStatusAsync(await stranger.GetAsync(ClientOverviewUrl), HttpStatusCode.Forbidden);

        // A block closes it with the rest of the plan (SUB-009).
        var client = await RequiredJsonAsync<TeamClientDetails>(await owner.GetAsync($"/api/clients/{mayaId}"));
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(await owner.PostAsJsonAsync($"/api/clients/{mayaId}/relationship/block",
            new { reason = "B10c block check", client.Version }), HttpStatusCode.OK);
        Assert.IsNull((await B4aRowAsync(lea, mayaId)).SessionsLeft);
    }

    [TestMethod]
    public async Task B10cSessionsRunningOutAskTheCoachWithoutMakingTheClientNeedAttention()
    {
        var today = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b10c-out-owner@example.test", "Hicham Haddad", "B10c Out");
        using var lea = CreateClient();
        await JoinAsCoachAsync(owner, lea, "b10c-out-lea@example.test", "Lea Khoury");
        using var omar = CreateClient();
        await JoinAsCoachAsync(owner, omar, "b10c-out-omar@example.test", "Omar Saad");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(lea, maya, tenant, "b10c-out-maya@example.test", "Maya", "Rahman");
        var pack = await B10bPackProductAsync(owner, "Personal training", B10bPackOffer(3, 90, 0m));
        var next = await B10bPackProductAsync(owner, "Next pack", B10bPackOffer(5, 120, 150m));
        var plan = await B10aProductAsync(owner, "Online Coaching", null, B10aOffer("26 weeks", 26, 0m, "Nutrition"));
        await A7EnrollAsync(owner, mayaId, plan.Offers[0].Id, today);
        var first = await A7EnrollAsync(owner, mayaId, pack.Offers[0].Id, today);

        // Three left is no reason to speak.
        Assert.IsNull(await B10cRunningOutAsync(lea, mayaId));

        // Two left asks, naming the pack to renew and its last day, and the client is still on track.
        await B10bRecordAsync(lea, mayaId, today);
        var item = (await B10cRunningOutAsync(lea, mayaId))!;
        Assert.AreEqual((2, (int?)null, first.Id, (DateOnly?)today.AddDays(89)), (item.SessionsLeft, item.Count, item.SubjectId, item.Date));
        var row = await B4aRowAsync(lea, mayaId);
        Assert.AreEqual((ClientOverviewStatus.OnTrack, ClientPlanStatus.OnTrack), (row.Status, row.PlanStatus));
        Assert.AreEqual(CoachAttentionKind.SessionsRunningOut, row.Attention.Single());
        Assert.AreEqual(2, row.SessionsLeft);

        // The owner sees it, another coach does not, and neither does another workspace.
        Assert.IsNotNull(await B10cRunningOutAsync(owner, mayaId));
        Assert.IsNull(await B10cRunningOutAsync(omar, mayaId));
        using var stranger = CreateClient();
        await RegisterCoachAsync(stranger, "b10c-out-stranger@example.test", "Other Coach", "B10c Elsewhere");
        Assert.IsNull(await B10cRunningOutAsync(stranger, mayaId));

        // Another pack booked and unpaid is what to act on: it holds nothing yet, so the item stays and names it.
        var renewal = await A7EnrollAsync(owner, mayaId, next.Offers[0].Id, today);
        item = (await B10cRunningOutAsync(lea, mayaId))!;
        Assert.AreEqual((2, (int?)1, renewal.Id), (item.SessionsLeft, item.Count, item.SubjectId));

        // Paid, the sessions are there, and the item clears. The last one used brings it back at nothing left.
        await A7PayAsync(owner, renewal.Id, 150m, today, Guid.NewGuid());
        Assert.IsNull(await B10cRunningOutAsync(lea, mayaId));
        foreach (var _ in Enumerable.Range(0, 5))
        {
            await B10bRecordAsync(lea, mayaId, today);
        }

        Assert.AreEqual(2, (await B10cRunningOutAsync(lea, mayaId))!.SessionsLeft);
        await B10bRecordAsync(lea, mayaId, today);
        await B10bRecordAsync(lea, mayaId, today);
        Assert.AreEqual(0, (await B10cRunningOutAsync(lea, mayaId))!.SessionsLeft);
    }

    [TestMethod]
    public async Task B10cAPackEndingSoonSaysSoOnceAndAPackBesideAPlanSaysItOnItsOwn()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "b10c-once-coach@example.test", "Karim Haddad", "B10c Once");
        using var maya = CreateClient();
        var mayaId = await InviteAndAcceptAsync(coach, maya, "b10c-once-maya@example.test", true);
        using var rami = CreateClient();
        var ramiId = await InviteAndAcceptAsync(coach, rami, "b10c-once-rami@example.test", true);
        var pack = await B10bPackProductAsync(coach, "Personal training", B10bPackOffer(8, 10, 0m));
        var plan = await B10aProductAsync(coach, "Online Coaching", null, B10aOffer("26 weeks", 26, 0m, "Training"));

        // Alone, the pack is the plan: its end is the plan's item, the one every screen reads, with what is left.
        var alone = await A7EnrollAsync(coach, mayaId, pack.Offers[0].Id, today);
        var today1 = await ReadSliceAsync<CoachTodayView>(coach, CoachTodayUrl);
        var ending = today1.Attention.Where(item => item.Client.ClientProfileId == mayaId).ToArray();
        Assert.AreEqual(CoachAttentionKind.PlanEndingSoon, ending.Single().Kind, "One row for one pack, not two.");
        Assert.AreEqual((8, alone.Id), (ending[0].SessionsLeft, ending[0].SubjectId));
        Assert.AreEqual(alone.Id, today1.PlansEndingSoon.Single(item => item.Client.ClientProfileId == mayaId).EnrollmentId);

        // Its flag is still raised, for the row's chip to read.
        var row = await B4aRowAsync(coach, mayaId);
        CollectionAssert.AreEquivalent(
            new[] { CoachAttentionKind.PlanEndingSoon, CoachAttentionKind.SessionsRunningOut },
            row.Attention.ToArray());
        Assert.AreEqual(CoachAttentionKind.PlanEndingSoon, row.AttentionItems.Single().Kind);
        Assert.AreEqual(ClientOverviewStatus.EndingSoon, row.Status);

        // The same pack beside a plan that runs on: no plan is ending, and the pack says so on its own, however many
        // sessions are left, while the Plans ending soon list stays the plan's (SES-002).
        await A7EnrollAsync(coach, ramiId, plan.Offers[0].Id, today);
        var beside = await A7EnrollAsync(coach, ramiId, pack.Offers[0].Id, today);
        var item = (await B10cRunningOutAsync(coach, ramiId))!;
        Assert.AreEqual((8, beside.Id, (DateOnly?)today.AddDays(9)), (item.SessionsLeft, item.SubjectId, item.Date));
        var view = await ReadSliceAsync<CoachTodayView>(coach, CoachTodayUrl);
        Assert.IsTrue(view.PlansEndingSoon.All(entry => entry.Client.ClientProfileId != ramiId));
        var ramiRow = await B4aRowAsync(coach, ramiId);
        Assert.AreEqual(ClientPlanStatus.OnTrack, ramiRow.PlanStatus);
        Assert.AreEqual("Online Coaching", ramiRow.Plan!.Name);
    }

    [TestMethod]
    public async Task B10cThisMonthCountsTheSessionsHeldThatStandForWhoeverHeldThem()
    {
        B4aSetWorkspaceClock(new DateOnly(2026, 9, 29), new TimeOnly(12, 0));
        var september = new DateOnly(2026, 9, 29);
        using var stranger = CreateClient();
        await RegisterCoachAsync(stranger, "b10c-month-stranger@example.test", "Other Owner", "B10c Elsewhere");
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b10c-month-owner@example.test", "Hicham Haddad", "B10c Month");
        using var lea = CreateClient();
        await JoinAsCoachAsync(owner, lea, "b10c-month-lea@example.test", "Lea Khoury");
        using var omar = CreateClient();
        await JoinAsCoachAsync(owner, omar, "b10c-month-omar@example.test", "Omar Saad");
        using var zeina = CreateClient();
        await JoinAsCoachAsync(owner, zeina, "b10c-month-zeina@example.test", "Zeina Aoun");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(lea, maya, tenant, "b10c-month-maya@example.test", "Maya", "Rahman");
        using var nour = CreateClient();
        var nourId = await R31InviteAsync(omar, nour, tenant, "b10c-month-nour@example.test", "Nour", "Aoun");

        // Nobody sells sessions yet, so there is no number to show anyone.
        Assert.IsNull((await ReadSliceAsync<CoachTodayView>(owner, CoachTodayUrl)).Month.SessionsHeld);

        var pack = await B10bPackProductAsync(owner, "Personal training", B10bPackOffer(20, 90, 0m));
        await A7EnrollAsync(owner, mayaId, pack.Offers[0].Id, september);
        await A7EnrollAsync(owner, nourId, pack.Offers[0].Id, september);

        // A pack running makes it a number, zero until one is held; a coach with no such client still has none.
        Assert.AreEqual(0, (await ReadSliceAsync<CoachTodayView>(lea, CoachTodayUrl)).Month.SessionsHeld);
        Assert.AreEqual(0, (await ReadSliceAsync<CoachTodayView>(owner, CoachTodayUrl)).Month.SessionsHeld);
        Assert.IsNull((await ReadSliceAsync<CoachTodayView>(zeina, CoachTodayUrl)).Month.SessionsHeld);

        // September's session is September's, wherever it is recorded from.
        await B10bRecordAsync(lea, mayaId, september);

        B4aSetWorkspaceClock(new DateOnly(2026, 10, 2), new TimeOnly(12, 0));
        var october = new DateOnly(2026, 10, 2);
        await B10bRecordAsync(lea, mayaId, october);
        await B10bRecordAsync(lea, mayaId, october);
        var undone = await B10bRecordAsync(lea, mayaId, october, note: "Wrong day");
        await B10bVoidOkAsync(lea, mayaId, undone.Sessions!.Entries.First(item => item is { Kind: SessionEntryKind.Held, Note: "Wrong day" }).Id, Guid.NewGuid());
        await B10bRecordAsync(lea, mayaId, october, "Charged", reason: "No-show");
        await B10bRecordAsync(omar, nourId, october);

        // The owner records one for Maya: it is the owner's session (SES-003), and in the workspace's total.
        await B10bRecordAsync(owner, mayaId, october);

        var leasMonth = (await ReadSliceAsync<CoachTodayView>(lea, CoachTodayUrl)).Month;
        Assert.AreEqual(2, leasMonth.SessionsHeld, "Her own, standing, this month: no charge, nothing undone, no September.");
        Assert.AreEqual(1, (await ReadSliceAsync<CoachTodayView>(omar, CoachTodayUrl)).Month.SessionsHeld);
        Assert.AreEqual(4, (await ReadSliceAsync<CoachTodayView>(owner, CoachTodayUrl)).Month.SessionsHeld);
        Assert.IsNull((await ReadSliceAsync<CoachTodayView>(stranger, CoachTodayUrl)).Month.SessionsHeld, "Another workspace reads none of it.");

        // A client who left keeps what they had, for the coach who held it (ADR 0027).
        await ReleaseAsync(owner, nourId, "Moved away");
        Assert.AreEqual(1, (await ReadSliceAsync<CoachTodayView>(omar, CoachTodayUrl)).Month.SessionsHeld);
        Assert.AreEqual(4, (await ReadSliceAsync<CoachTodayView>(owner, CoachTodayUrl)).Month.SessionsHeld);
    }

    private static async Task<CoachAttentionItemView?> B10cRunningOutAsync(HttpClient coach, Guid clientId) =>
        (await ReadSliceAsync<CoachTodayView>(coach, CoachTodayUrl)).Attention
            .SingleOrDefault(item => item.Kind == CoachAttentionKind.SessionsRunningOut && item.Client.ClientProfileId == clientId);
}
