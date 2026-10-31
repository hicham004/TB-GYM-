using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using TB.Gym.Infrastructure.Application;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.SharedKernel;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Critique B13, a plan that ends beside a pack (SES-010): once a coaching plan has run out, the client's status, Ended,
/// not renewed and Ask to renew read them as they would with no pack, Renew offers the coaching plan that ended, and the
/// pack runs on as it did. A client who never had a coaching plan keeps their pack as the plan.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string B13RenewalUrl = "/api/client-renewal/me";

    [TestMethod]
    public async Task B13APlanThatRanOutBesideARunningPackReadsAsEndedAndThePackChangesInNothing()
    {
        var today = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b13-read-owner@example.test", "Hicham Haddad", "B13 Read");
        using var lea = CreateClient();
        await JoinAsCoachAsync(owner, lea, "b13-read-lea@example.test", "Lea Khoury");
        using var omar = CreateClient();
        await JoinAsCoachAsync(owner, omar, "b13-read-omar@example.test", "Omar Saad");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(lea, maya, tenant, "b13-read-maya@example.test", "Maya", "Rahman");
        var plan = await B10aProductAsync(owner, "Online Coaching", null, B10aOffer("2 weeks", 2, 0m, "Training", "Messaging"));
        var pack = await B10bPackProductAsync(owner, "Personal training", B10bPackOffer(10, 90, 0m));
        var coaching = await A7EnrollAsync(owner, mayaId, plan.Offers[0].Id, today);
        await A7EnrollAsync(owner, mayaId, pack.Offers[0].Id, today);

        // While the plan runs the row reads it, as ever, and the client has nothing to ask for.
        var row = await B4aRowAsync(lea, mayaId);
        Assert.AreEqual((ClientPlanState.Running, "Online Coaching"), (row.PlanState, row.Plan!.Name));
        Assert.IsFalse((await ReadSliceAsync<RenewalStatusView>(maya, B13RenewalUrl)).PlanEnded);

        // The plan's last day has passed and the pack runs on: Clients and the client's page say so, naming the plan.
        var lastDay = today.AddDays(13);
        RequiredTestClock.Advance(TimeSpan.FromDays(14));
        row = await B4aRowAsync(lea, mayaId);
        Assert.AreEqual(
            (ClientOverviewStatus.NoActivePlan, ClientPlanStatus.NoActivePlan, ClientPlanState.Ended),
            (row.Status, row.PlanStatus, row.PlanState));
        Assert.AreEqual((coaching.Id, "Online Coaching", (DateOnly?)lastDay, 1),
            (row.Plan!.EnrollmentId, row.Plan.Name, row.PlanEndsOn, row.OtherPlanCount));
        Assert.AreEqual((CoachingFeature.Sessions, (int?)10), (row.FeaturesToday.Single(), row.SessionsLeft));
        var page = await ReadSliceAsync<ClientProfileOverviewView>(lea, R33bOverviewUrl(mayaId));
        Assert.AreEqual(
            (ClientOverviewStatus.NoActivePlan, ClientPlanState.Ended, "Online Coaching", (DateOnly?)lastDay),
            (page.Status, page.PlanState, page.PlanName, page.PlanEndsOn));

        // Today lists it to renew, the coaching plan rather than the pack, and still counts Maya as coached today.
        var view = await ReadSliceAsync<CoachTodayView>(lea, CoachTodayUrl);
        var ended = view.PlansEndedNotRenewed.Single();
        Assert.AreEqual((coaching.Id, "Online Coaching", lastDay, (Guid?)null, (DateOnly?)null),
            (ended.EnrollmentId, ended.PlanName, ended.LastDay, ended.UnpaidRenewalId, ended.RenewalRequestedOn));
        Assert.IsEmpty(view.PlansEndingSoon);
        Assert.AreEqual(1, view.Month.ActiveClientCount);

        // The client may ask, and their coach reads it about the plan that ended.
        var status = await ReadSliceAsync<RenewalStatusView>(maya, B13RenewalUrl);
        Assert.AreEqual((true, true, (DateOnly?)lastDay, "Lea Khoury"), (status.PlanEnded, status.CanAsk, status.EndedOn, status.CoachName));
        await RefreshCsrfAsync(maya);
        await AssertStatusAsync(await maya.PostAsync("/api/client-renewal/me/requests", null), HttpStatusCode.Created);
        row = await B4aRowAsync(lea, mayaId);
        Assert.AreEqual(ClientOverviewStatus.NeedsAttention, row.Status);
        var asked = row.AttentionItems.Single(item => item.Kind == CoachAttentionKind.RenewalRequested);
        Assert.AreEqual(((Guid?)coaching.Id, (DateOnly?)lastDay), (asked.SubjectId, asked.Date));
        var listed = (await ReadSliceAsync<CoachTodayView>(lea, CoachTodayUrl)).PlansEndedNotRenewed.Single();
        Assert.AreEqual(today.AddDays(14), listed.RenewalRequestedOn);

        // The pack changes in nothing: it takes sessions, the balance moves, and Messaging stays closed with the plan.
        await B10bRecordAsync(lea, mayaId, today.AddDays(14));
        Assert.AreEqual(9, (await B4aRowAsync(lea, mayaId)).SessionsLeft);
        var access = (await ReadSliceAsync<ClientCommercialOverview>(lea, $"/api/commercial/clients/{mayaId}")).FeatureAccess;
        Assert.AreEqual(
            (FeatureAccessReason.Expired, FeatureAccessReason.Expired, FeatureAccessReason.Granted),
            (access.Single(item => item.Feature == CoachingFeature.Messaging).Reason,
                access.Single(item => item.Feature == CoachingFeature.Training).Reason,
                access.Single(item => item.Feature == CoachingFeature.Sessions).Reason));

        // Nobody else reads any of it: not another coach, not another workspace, and neither read is a coach's or a
        // stranger's to make.
        Assert.IsTrue((await ReadSliceAsync<ClientOverviewView>(omar, ClientOverviewUrl)).Clients.All(item => item.Client.ClientProfileId != mayaId));
        Assert.IsEmpty((await ReadSliceAsync<CoachTodayView>(omar, CoachTodayUrl)).PlansEndedNotRenewed);
        await AssertStatusAsync(await omar.GetAsync(R33bOverviewUrl(mayaId)), HttpStatusCode.NotFound);
        using var stranger = CreateClient();
        await RegisterCoachAsync(stranger, "b13-read-stranger@example.test", "Other Coach", "B13 Elsewhere");
        Assert.IsEmpty((await ReadSliceAsync<CoachTodayView>(stranger, CoachTodayUrl)).PlansEndedNotRenewed);
        await AssertStatusAsync(await stranger.GetAsync(R33bOverviewUrl(mayaId)), HttpStatusCode.NotFound);
        SetTenant(stranger, tenant);
        await AssertStatusAsync(await stranger.GetAsync(ClientOverviewUrl), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await lea.GetAsync(B13RenewalUrl), HttpStatusCode.Forbidden);
        using var anonymous = CreateClient();
        await AssertStatusAsync(await anonymous.GetAsync(B13RenewalUrl), HttpStatusCode.Unauthorized);

        // Renewing the plan that ended brings the row back to it, and takes the client off the list.
        await B13RenewFromAsync(owner, coaching, plan.Offers[0].Id, today.AddDays(14));
        row = await B4aRowAsync(lea, mayaId);
        Assert.AreEqual((ClientPlanState.Running, "Online Coaching", (DateOnly?)today.AddDays(27)),
            (row.PlanState, row.Plan!.Name, row.PlanEndsOn));
        Assert.IsEmpty((await ReadSliceAsync<CoachTodayView>(lea, CoachTodayUrl)).PlansEndedNotRenewed);
        Assert.IsFalse((await ReadSliceAsync<RenewalStatusView>(maya, B13RenewalUrl)).PlanEnded);
    }

    [TestMethod]
    public async Task B13APlanBookedAfterTheOneThatRanOutReadsAsItWouldWithNoPack()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "b13-next-coach@example.test", "Karim Haddad", "B13 Next");
        var plan = await B10aProductAsync(coach, "Online Coaching", null, B10aOffer("2 weeks", 2, 100m, "Training"));
        var free = await B10bPackProductAsync(coach, "Personal training", B10bPackOffer(10, 90, 0m));
        var priced = await B10bPackProductAsync(coach, "Paid sessions", B10bPackOffer(5, 90, 200m));

        // Three clients on the same plan beside a free pack, and Nour beside one still waiting for its money.
        using var maya = CreateClient();
        var mayaId = await InviteAndAcceptAsync(coach, maya, "b13-next-maya@example.test", true);
        using var rami = CreateClient();
        var ramiId = await InviteAndAcceptAsync(coach, rami, "b13-next-rami@example.test", true);
        using var nour = CreateClient();
        var nourId = await InviteAndAcceptAsync(coach, nour, "b13-next-nour@example.test", true);
        var mayaPlan = await B4aPayInFullAsync(coach, await A7EnrollAsync(coach, mayaId, plan.Offers[0].Id, today));
        var ramiPlan = await B4aPayInFullAsync(coach, await A7EnrollAsync(coach, ramiId, plan.Offers[0].Id, today));
        var nourPlan = await B4aPayInFullAsync(coach, await A7EnrollAsync(coach, nourId, plan.Offers[0].Id, today));
        await A7EnrollAsync(coach, mayaId, free.Offers[0].Id, today);
        await A7EnrollAsync(coach, ramiId, free.Offers[0].Id, today);
        await A7EnrollAsync(coach, nourId, priced.Offers[0].Id, today);
        RequiredTestClock.Advance(TimeSpan.FromDays(14));
        var day = today.AddDays(14);
        var lastDay = today.AddDays(13);

        // Maya's renewal waits for payment: that is what the row says and what Today asks for, and she has nothing to ask.
        var renewal = await B13RenewFromAsync(coach, mayaPlan, plan.Offers[0].Id, day);
        var row = await B4aRowAsync(coach, mayaId);
        Assert.AreEqual((ClientOverviewStatus.NoActivePlan, ClientPlanState.PaymentDue, "Online Coaching"),
            (row.Status, row.PlanState, row.Plan!.Name));
        var mayas = (await ReadSliceAsync<CoachTodayView>(coach, CoachTodayUrl)).PlansEndedNotRenewed
            .Single(item => item.Client.ClientProfileId == mayaId);
        Assert.AreEqual((mayaPlan.Id, lastDay, (Guid?)renewal.Id), (mayas.EnrollmentId, mayas.LastDay, mayas.UnpaidRenewalId));
        await Step3AssertPlanNotEndedAsync(maya);

        // Paid, the plan runs, and she leaves the list.
        await B4aPayInFullAsync(coach, renewal);
        Assert.AreEqual(ClientPlanState.Running, (await B4aRowAsync(coach, mayaId)).PlanState);
        Assert.IsTrue((await ReadSliceAsync<CoachTodayView>(coach, CoachTodayUrl)).PlansEndedNotRenewed
            .All(item => item.Client.ClientProfileId != mayaId));

        // Rami's renewal is paid and starts next week: nothing runs but the pack, and a booked plan is no ended one.
        var coming = await B4aPayInFullAsync(coach, await B13RenewFromAsync(coach, ramiPlan, plan.Offers[0].Id, day.AddDays(7)));
        row = await B4aRowAsync(coach, ramiId);
        Assert.AreEqual((ClientOverviewStatus.NoActivePlan, ClientPlanState.NotStarted, coming.Id),
            (row.Status, row.PlanState, row.Plan!.EnrollmentId));
        Assert.IsTrue((await ReadSliceAsync<CoachTodayView>(coach, CoachTodayUrl)).PlansEndedNotRenewed
            .All(item => item.Client.ClientProfileId != ramiId));
        await Step3AssertPlanNotEndedAsync(rami);

        // A pack waiting for payment is no plan booked after it: Today says Renew, and Nour may ask.
        var nours = (await ReadSliceAsync<CoachTodayView>(coach, CoachTodayUrl)).PlansEndedNotRenewed
            .Single(item => item.Client.ClientProfileId == nourId);
        Assert.AreEqual((nourPlan.Id, (Guid?)null), (nours.EnrollmentId, nours.UnpaidRenewalId));
        Assert.AreEqual(ClientPlanState.Ended, (await B4aRowAsync(coach, nourId)).PlanState);
        Assert.IsTrue((await ReadSliceAsync<RenewalStatusView>(nour, B13RenewalUrl)).CanAsk);
    }

    [TestMethod]
    public async Task B13WithThePlanAndThePackBothOverThePlanStaysTheOneThatEndedAndWhatWasLeftLapses()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "b13-over-coach@example.test", "Karim Haddad", "B13 Over");
        using var maya = CreateClient();
        var mayaId = await InviteAndAcceptAsync(coach, maya, "b13-over-maya@example.test", true);
        var plan = await B10aProductAsync(coach, "Online Coaching", null, B10aOffer("2 weeks", 2, 0m, "Training"));
        var pack = await B10bPackProductAsync(coach, "Personal training", B10bPackOffer(5, 21, 0m));
        var coaching = await A7EnrollAsync(coach, mayaId, plan.Offers[0].Id, today);
        var sessions = await A7EnrollAsync(coach, mayaId, pack.Offers[0].Id, today);
        await B10bRecordAsync(coach, mayaId, today);

        // Maya asks once the plan ended, while the pack still runs.
        RequiredTestClock.Advance(TimeSpan.FromDays(14));
        await RefreshCsrfAsync(maya);
        await AssertStatusAsync(await maya.PostAsync("/api/client-renewal/me/requests", null), HttpStatusCode.Created);

        // The pack ends a week after the plan. Everything reads ended, and nothing jumps to the pack: not the date, not
        // the plan to renew, and her request still stands.
        var lastDay = today.AddDays(13);
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        var row = await B4aRowAsync(coach, mayaId);
        Assert.AreEqual((ClientPlanState.Ended, coaching.Id, (DateOnly?)lastDay), (row.PlanState, row.Plan!.EnrollmentId, row.PlanEndsOn));
        Assert.IsNull(row.SessionsLeft);
        Assert.AreEqual(((Guid?)coaching.Id, ClientOverviewStatus.NeedsAttention),
            (row.AttentionItems.Single(item => item.Kind == CoachAttentionKind.RenewalRequested).SubjectId, row.Status));
        var ended = (await ReadSliceAsync<CoachTodayView>(coach, CoachTodayUrl)).PlansEndedNotRenewed.Single();
        Assert.AreEqual((coaching.Id, lastDay, (DateOnly?)today.AddDays(14)), (ended.EnrollmentId, ended.LastDay, ended.RenewalRequestedOn));
        var status = await ReadSliceAsync<RenewalStatusView>(maya, B13RenewalUrl);
        Assert.AreEqual((true, (DateOnly?)lastDay, true), (status.PlanEnded, status.EndedOn, status.CanAsk));

        // What was left lapsed, on the date (SES-006), and nothing else happened to it.
        var over = await B10bPackViewAsync(coach, mayaId, sessions.Id);
        Assert.AreEqual((1, 4, (DateOnly?)today.AddDays(20)), (over.Held, over.Lapsed, over.LapsedOn));

        // Renewing works as usual.
        await B13RenewFromAsync(coach, coaching, plan.Offers[0].Id, today.AddDays(21));
        row = await B4aRowAsync(coach, mayaId);
        Assert.AreEqual((ClientPlanState.Running, (int?)null), (row.PlanState, row.SessionsLeft));
        Assert.IsEmpty((await ReadSliceAsync<CoachTodayView>(coach, CoachTodayUrl)).PlansEndedNotRenewed);
    }

    [TestMethod]
    public async Task B13AClientBetweenPacksLongAfterTheirPlanStillShowsForThePackThatJustEnded()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "b13-gap-coach@example.test", "Karim Haddad", "B13 Gap");
        using var maya = CreateClient();
        var mayaId = await InviteAndAcceptAsync(coach, maya, "b13-gap-maya@example.test", true);
        var plan = await B10aProductAsync(coach, "Online Coaching", null, B10aOffer("1 week", 1, 0m, "Training"));
        var pack = await B10bPackProductAsync(coach, "Personal training", B10bPackOffer(5, 50, 0m));
        var coaching = await A7EnrollAsync(coach, mayaId, plan.Offers[0].Id, today);
        var sessions = await A7EnrollAsync(coach, mayaId, pack.Offers[0].Id, today);

        // Forty days after the plan it has left the list, and the pack running does not take its place.
        RequiredTestClock.Advance(TimeSpan.FromDays(46));
        Assert.IsEmpty((await ReadSliceAsync<CoachTodayView>(coach, CoachTodayUrl)).PlansEndedNotRenewed);
        var row = await B4aRowAsync(coach, mayaId);
        Assert.AreEqual((ClientPlanState.Ended, coaching.Id), (row.PlanState, row.Plan!.EnrollmentId));

        // Once it ends with nothing else running, the coach still hears of it, and Renew offers that pack.
        RequiredTestClock.Advance(TimeSpan.FromDays(5));
        var ended = (await ReadSliceAsync<CoachTodayView>(coach, CoachTodayUrl)).PlansEndedNotRenewed.Single();
        Assert.AreEqual((sessions.Id, "Personal training", today.AddDays(49)), (ended.EnrollmentId, ended.PlanName, ended.LastDay));
        Assert.AreEqual(today.AddDays(6), (await ReadSliceAsync<RenewalStatusView>(maya, B13RenewalUrl)).EndedOn, "The client's own sentence stays true.");
    }

    [TestMethod]
    public async Task B13APackStaysThePlanForAnyoneWhoseCoachingPlanHasNotRunOut()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "b13-alone-coach@example.test", "Karim Haddad", "B13 Alone");
        var plan = await B10aProductAsync(coach, "Online Coaching", null, B10aOffer("4 weeks", 4, 0m, "Training"));
        var pack = await B10bPackProductAsync(coach, "Personal training", B10bPackOffer(5, 90, 0m));

        // A client with no pack pays nothing for the read.
        using var sara = CreateClient();
        var saraId = await InviteAndAcceptAsync(coach, sara, "b13-alone-sara@example.test", true);
        await A7EnrollAsync(coach, saraId, plan.Offers[0].Id, today);
        await B4aMeasureAsync<CoachTodayView>(coach, CoachTodayUrl, "B13 no pack");
        Assert.AreEqual(0, RequiredTodayQueryCounter.ReadsTagged(CoachOverviewReader.CoachingPlansRunOutTag).Commands);

        // Pack-only (B10c's rule): the pack is the plan.
        using var maya = CreateClient();
        var mayaId = await InviteAndAcceptAsync(coach, maya, "b13-alone-maya@example.test", true);
        await A7EnrollAsync(coach, mayaId, pack.Offers[0].Id, today);

        // An earlier pack that also ticked Training ran out beside it: a pack is no coaching plan, so nothing has ended.
        using var rami = CreateClient();
        var ramiId = await InviteAndAcceptAsync(coach, rami, "b13-alone-rami@example.test", true);
        var ticked = await B10bPackProductAsync(coach, "Short pack", B10bPackOffer(2, 7, 0m, "USD", "Training"));
        await A7EnrollAsync(coach, ramiId, ticked.Offers[0].Id, today);
        await A7EnrollAsync(coach, ramiId, pack.Offers[0].Id, today);

        // The coach cancelled the plan beside the pack: a cancelled plan is not one that ran out (SUB-014, CLI-020).
        using var nour = CreateClient();
        var nourId = await InviteAndAcceptAsync(coach, nour, "b13-alone-nour@example.test", true);
        var cancelled = await A7EnrollAsync(coach, nourId, plan.Offers[0].Id, today);
        await A7EnrollAsync(coach, nourId, pack.Offers[0].Id, today);
        await B10aChangeAsync(coach, cancelled.Id, "cancel", new { reason = "Moved to in-person only", Version = await B10aVersionAsync(coach, nourId, cancelled.Id) });

        // The plan is paused beside the pack.
        using var jad = CreateClient();
        var jadId = await InviteAndAcceptAsync(coach, jad, "b13-alone-jad@example.test", true);
        var paused = await A7EnrollAsync(coach, jadId, plan.Offers[0].Id, today);
        await A7EnrollAsync(coach, jadId, pack.Offers[0].Id, today);
        await B10aChangeAsync(coach, paused.Id, "pause", new { reason = "Travelling", Version = await B10aVersionAsync(coach, jadId, paused.Id) });

        // A returning client's plan from their old profile stays with it (ADR 0027): their new one has only a pack.
        using var lina = CreateClient();
        var oldId = await InviteAndAcceptAsync(coach, lina, "b13-alone-lina@example.test", true);
        var week = await B10aProductAsync(coach, "One week", null, B10aOffer("1 week", 1, 0m, "Training"));
        await A7EnrollAsync(coach, oldId, week.Offers[0].Id, today);
        RequiredTestClock.Advance(TimeSpan.FromDays(8));
        var day = today.AddDays(8);
        await ReleaseAsync(coach, oldId, "Took a break");
        await RefreshCsrfAsync(coach);
        var invited = await coach.PostAsJsonAsync("/api/invitations",
            new { email = "b13-alone-lina@example.test", firstName = "Lina", lastName = "Haddad" });
        await AssertStatusAsync(invited, HttpStatusCode.Created);
        await RefreshCsrfAsync(lina);
        var accepted = await lina.PostAsJsonAsync("/api/invitations/accept", new
        {
            token = QueryValue((await RequiredJsonAsync<Invitation>(invited)).DevelopmentActionUrl!, "token"),
            displayName = (string?)null,
            password = (string?)null,
        });
        await AssertStatusAsync(accepted, HttpStatusCode.OK);
        var linaId = (await RequiredJsonAsync<InvitationAcceptance>(accepted)).ClientProfileId;
        await A7EnrollAsync(coach, linaId, pack.Offers[0].Id, day);

        // A paused plan is still the plan in front of the pack (SES-002); for the others the pack is the plan.
        foreach (var (client, clientId, name) in new[]
        {
            (maya, mayaId, "Personal training"),
            (rami, ramiId, "Personal training"),
            (nour, nourId, "Personal training"),
            (jad, jadId, "Online Coaching"),
            (lina, linaId, "Personal training"),
        })
        {
            var row = await B4aRowAsync(coach, clientId);
            Assert.AreEqual((ClientOverviewStatus.OnTrack, ClientPlanState.Running, name), (row.Status, row.PlanState, row.Plan?.Name), name);
            Assert.IsFalse((await ReadSliceAsync<RenewalStatusView>(client, B13RenewalUrl)).PlanEnded, clientId.ToString());
            await Step3AssertPlanNotEndedAsync(client);
        }

        Assert.IsEmpty((await ReadSliceAsync<CoachTodayView>(coach, CoachTodayUrl)).PlansEndedNotRenewed);
    }

    private static async Task<ClientEnrollmentView> B13RenewFromAsync(HttpClient coach, ClientEnrollmentView plan, Guid offerId, DateOnly startDate)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync($"/api/commercial/enrollments/{plan.Id}/renew",
            new { offerId, startDate = startDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), idempotencyKey = Guid.NewGuid() });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<ClientEnrollmentView>(response);
    }
}
