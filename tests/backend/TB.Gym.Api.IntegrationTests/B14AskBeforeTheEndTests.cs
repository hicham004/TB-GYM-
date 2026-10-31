using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Npgsql;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Notifications;
using TB.Gym.Modules.Subscriptions;
using ClientEnrollmentView = TB.Gym.Modules.Subscriptions.ClientEnrollmentView;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Critique B14 (SUB-014, ADR 0029): a client may ask to renew from the day their plan's ending-soon notice goes out,
/// with the same request and the same answer as after it ended, and My plan carries the ask on the plan it is about.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string B14RenewalUrl = "/api/client-renewal/me";
    private const string B14RequestsUrl = "/api/client-renewal/me/requests";

    [TestMethod]
    public async Task B14AClientAsksFromTheDayTheNoticeGoesOutAndTheRequestStandsOnceThePlanHasEnded()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "b14-ask-coach@example.test", "Karim Haddad", "B14 Ask");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(coach, maya, tenant, "b14-ask-maya@example.test", "Maya", "Rahman");
        var product = await B10aProductAsync(coach, "Online Coaching", null, B10aOffer("2 weeks", 2, 0m, "Training"));
        var plan = await A7EnrollAsync(coach, mayaId, product.Offers[0].Id, today);
        var lastDay = today.AddDays(13);
        var noticeDay = today.AddDays(11);

        // The notice and the ask share one day, in the workspace's calendar.
        Assert.AreEqual(noticeDay, await B14EndingNoticeDayAsync(plan.Id));

        // The day before, nothing has opened, and a request is refused.
        RequiredTestClock.Advance(TimeSpan.FromDays(10));
        var early = await ReadSliceAsync<RenewalStatusView>(maya, B14RenewalUrl);
        Assert.AreEqual((false, false, (DateOnly?)null, (Guid?)null, (string?)null),
            (early.PlanEnded, early.CanAsk, early.EndsOn, early.PlanId, early.CoachName));
        await Step3AssertPlanNotEndedAsync(maya);

        // On the notice's day it opens, naming the plan and its last day, and the plan has not ended.
        RequiredTestClock.Advance(TimeSpan.FromDays(1));
        var open = await ReadSliceAsync<RenewalStatusView>(maya, B14RenewalUrl);
        Assert.AreEqual((false, true, (DateOnly?)lastDay, (DateOnly?)null, (Guid?)plan.Id, "Karim Haddad"),
            (open.PlanEnded, open.CanAsk, open.EndsOn, open.EndedOn, open.PlanId, open.CoachName));

        // Two taps at once store one request and one notice, and both are told about it.
        await RefreshCsrfAsync(maya);
        var asks = await Task.WhenAll(maya.PostAsync(B14RequestsUrl, null), maya.PostAsync(B14RequestsUrl, null));
        Assert.IsTrue(asks.All(response => response.StatusCode is HttpStatusCode.Created or HttpStatusCode.OK));
        Assert.IsTrue(asks.Any(response => response.StatusCode == HttpStatusCode.Created));
        var statuses = await Task.WhenAll(asks.Select(ReadSlicePayloadAsync<RenewalStatusView>));
        Assert.AreEqual(statuses[0].LastRequest?.Id, statuses[1].LastRequest?.Id);
        Assert.AreEqual((false, noticeDay, noticeDay.AddDays(7), (DateOnly?)lastDay),
            (statuses[0].CanAsk, statuses[0].LastRequest!.RequestedOn, statuses[0].LastRequest!.AskAgainFrom, statuses[0].EndsOn));
        Assert.AreEqual(1L, await Step3CountRenewalRequestsAsync(mayaId));
        Assert.AreEqual(1L, await Step3CountRenewalNoticesAsync(mayaId));
        Assert.AreEqual(plan.Id, await B14AskedAboutAsync(mayaId));

        // The coach gets the same notice, which no longer says the plan has ended, in-app only.
        await Step3SweepNotificationsAsync();
        var notice = (await RequiredJsonAsync<RenewalInbox>(await coach.GetAsync("/api/notifications"))).Items
            .Single(item => item.Kind == nameof(CommercialNotificationKind.RenewalRequested));
        Assert.AreEqual(("Maya Rahman asked to renew", "Open the client's page to set up a renewal.", (Guid?)mayaId),
            (notice.Title, notice.Body, notice.ClientProfileId));

        // While the plan runs Clients reads it as ending soon, as ever: an ask changes no plan's status.
        var row = await B4aRowAsync(coach, mayaId);
        Assert.AreEqual(ClientPlanStatus.EndingSoon, row.PlanStatus);
        Assert.IsTrue(row.AttentionItems.Any(item => item.Kind == CoachAttentionKind.PlanEndingSoon));
        Assert.IsTrue(row.AttentionItems.All(item => item.Kind != CoachAttentionKind.RenewalRequested));

        // Asking again inside the window answers with the first request.
        RequiredTestClock.Advance(TimeSpan.FromDays(1));
        await RefreshCsrfAsync(maya);
        var again = await maya.PostAsync(B14RequestsUrl, null);
        await AssertStatusAsync(again, HttpStatusCode.OK);
        Assert.AreEqual(statuses[0].LastRequest?.Id, (await RequiredJsonAsync<RenewalStatus>(again)).LastRequest?.Id);

        // The plan ends. What they asked stands, for them and for the coach, whose screens read it as asked after the end.
        RequiredTestClock.Advance(TimeSpan.FromDays(2));
        var ended = await ReadSliceAsync<RenewalStatusView>(maya, B14RenewalUrl);
        Assert.AreEqual((true, false, (DateOnly?)lastDay, (DateOnly?)null, (Guid?)plan.Id),
            (ended.PlanEnded, ended.CanAsk, ended.EndedOn, ended.EndsOn, ended.PlanId));
        Assert.AreEqual(noticeDay.AddDays(7), ended.LastRequest?.AskAgainFrom, "The seven-day window stands.");
        row = await B4aRowAsync(coach, mayaId);
        var item = row.AttentionItems.Single(entry => entry.Kind == CoachAttentionKind.RenewalRequested);
        Assert.AreEqual(((Guid?)plan.Id, (DateOnly?)lastDay), (item.SubjectId, item.Date));
        var listed = (await ReadSliceAsync<CoachTodayView>(coach, CoachTodayUrl)).PlansEndedNotRenewed.Single();
        Assert.AreEqual((DateOnly?)noticeDay, listed.RenewalRequestedOn);

        // Seven days on they may ask again, and it is a new request.
        RequiredTestClock.Advance(TimeSpan.FromDays(4));
        Assert.IsTrue((await ReadSliceAsync<RenewalStatusView>(maya, B14RenewalUrl)).CanAsk);
        await RefreshCsrfAsync(maya);
        await AssertStatusAsync(await maya.PostAsync(B14RequestsUrl, null), HttpStatusCode.Created);
        Assert.AreEqual(2L, await Step3CountRenewalRequestsAsync(mayaId));
    }

    [TestMethod]
    public async Task B14APlanAlreadyRenewedWaitingForPaymentPausedCancelledBlockedOrPartlyRunningCannotAsk()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "b14-no-coach@example.test", "Karim Haddad", "B14 No");
        var product = await B10aProductAsync(coach, "Online Coaching", null, B10aOffer("2 weeks", 2, 0m, "Training"));
        var priced = await B10aProductAsync(coach, "Paid Coaching", null, B10aOffer("2 weeks", 2, 100m, "Training"));
        var longer = await B10aProductAsync(coach, "Nutrition", null, B10aOffer("6 weeks", 6, 0m, "Nutrition"));

        async Task<(HttpClient Client, Guid Id)> InviteAsync(string name)
        {
            var client = CreateClient();
            return (client, await InviteAndAcceptAsync(coach, client, $"b14-no-{name}@example.test", true));
        }

        // Nothing stands in the way of this one, so the others are refused for their own reason.
        var (free, freeId) = await InviteAsync("free");
        await A7EnrollAsync(coach, freeId, product.Offers[0].Id, today);

        // Renewed, the next plan paid or free and following on.
        var (renewed, renewedId) = await InviteAsync("renewed");
        await B13RenewFromAsync(coach, await A7EnrollAsync(coach, renewedId, product.Offers[0].Id, today), product.Offers[0].Id, today.AddDays(14));

        // Renewed, the next plan waiting for payment.
        var (unpaid, unpaidId) = await InviteAsync("unpaid");
        var paid = await B4aPayInFullAsync(coach, await A7EnrollAsync(coach, unpaidId, priced.Offers[0].Id, today));
        await B13RenewFromAsync(coach, paid, priced.Offers[0].Id, today.AddDays(14));

        var (paused, pausedId) = await InviteAsync("paused");
        var toPause = await A7EnrollAsync(coach, pausedId, product.Offers[0].Id, today);
        await B10aChangeAsync(coach, toPause.Id, "pause", new { reason = "Travelling", Version = await B10aVersionAsync(coach, pausedId, toPause.Id) });

        var (cancelled, cancelledId) = await InviteAsync("cancelled");
        var toCancel = await A7EnrollAsync(coach, cancelledId, product.Offers[0].Id, today);
        await B10aChangeAsync(coach, toCancel.Id, "cancel", new { reason = "Ended early", Version = await B10aVersionAsync(coach, cancelledId, toCancel.Id) });

        var (blocked, blockedId) = await InviteAsync("blocked");
        await A7EnrollAsync(coach, blockedId, product.Offers[0].Id, today);
        var profile = await ReadSliceAsync<SliceProfileVersion>(coach, $"/api/clients/{blockedId}");
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PostAsJsonAsync($"/api/clients/{blockedId}/relationship/block",
            new { reason = "B14 block check", profile.Version }), HttpStatusCode.OK);

        // Training ends with the others while Nutrition runs on for a month.
        var (partial, partialId) = await InviteAsync("partial");
        await A7EnrollAsync(coach, partialId, product.Offers[0].Id, today);
        await A7EnrollAsync(coach, partialId, longer.Offers[0].Id, today);

        RequiredTestClock.Advance(TimeSpan.FromDays(11));
        using (free)
        {
            Assert.IsTrue((await ReadSliceAsync<RenewalStatusView>(free, B14RenewalUrl)).CanAsk);
        }

        foreach (var refused in new[] { renewed, unpaid, paused, cancelled, blocked, partial })
        {
            using (refused)
            {
                var status = await ReadSliceAsync<RenewalStatusView>(refused, B14RenewalUrl);
                Assert.AreEqual((false, false, (DateOnly?)null, (Guid?)null), (status.PlanEnded, status.CanAsk, status.EndsOn, status.PlanId));
                await Step3AssertPlanNotEndedAsync(refused);
            }
        }

        Assert.AreEqual(0L, await Step3CountRenewalRequestsAsync(renewedId) + await Step3CountRenewalRequestsAsync(partialId));
    }

    [TestMethod]
    public async Task B14BesideAPackTheClientAsksAboutTheCoachingPlanAndAPackAloneStandsAsThePlan()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "b14-pack-coach@example.test", "Karim Haddad", "B14 Pack");
        var plan = await B10aProductAsync(coach, "Online Coaching", null, B10aOffer("2 weeks", 2, 0m, "Training"));
        var longPack = await B10bPackProductAsync(coach, "Personal training", B10bPackOffer(10, 90, 0m));
        var shortPack = await B10bPackProductAsync(coach, "Short pack", B10bPackOffer(5, 14, 0m));

        // A pack that outlives the plan keeps nothing away: the coaching plan is the one that ends.
        using var maya = CreateClient();
        var mayaId = await InviteAndAcceptAsync(coach, maya, "b14-pack-maya@example.test", true);
        var coaching = await A7EnrollAsync(coach, mayaId, plan.Offers[0].Id, today);
        await A7EnrollAsync(coach, mayaId, longPack.Offers[0].Id, today);

        // A pack with no coaching plan is the plan, and asks in its own last days.
        using var rami = CreateClient();
        var ramiId = await InviteAndAcceptAsync(coach, rami, "b14-pack-rami@example.test", true);
        var pack = await A7EnrollAsync(coach, ramiId, shortPack.Offers[0].Id, today);

        // A second pack booked after the first is its renewal.
        using var nour = CreateClient();
        var nourId = await InviteAndAcceptAsync(coach, nour, "b14-pack-nour@example.test", true);
        var first = await A7EnrollAsync(coach, nourId, shortPack.Offers[0].Id, today);
        await B13RenewFromAsync(coach, first, shortPack.Offers[0].Id, today.AddDays(14));

        // Too early for the long pack alone, and the short plan beside it is not hers.
        using var lina = CreateClient();
        var linaId = await InviteAndAcceptAsync(coach, lina, "b14-pack-lina@example.test", true);
        await A7EnrollAsync(coach, linaId, longPack.Offers[0].Id, today);

        RequiredTestClock.Advance(TimeSpan.FromDays(11));
        var lastDay = today.AddDays(13);
        var mayas = await ReadSliceAsync<RenewalStatusView>(maya, B14RenewalUrl);
        Assert.AreEqual(((Guid?)coaching.Id, (DateOnly?)lastDay, true), (mayas.PlanId, mayas.EndsOn, mayas.CanAsk));
        var ramis = await ReadSliceAsync<RenewalStatusView>(rami, B14RenewalUrl);
        Assert.AreEqual(((Guid?)pack.Id, (DateOnly?)lastDay, true), (ramis.PlanId, ramis.EndsOn, ramis.CanAsk));
        await Step3AssertPlanNotEndedAsync(nour);
        await Step3AssertPlanNotEndedAsync(lina);

        await RefreshCsrfAsync(maya);
        await AssertStatusAsync(await maya.PostAsync(B14RequestsUrl, null), HttpStatusCode.Created);
        Assert.AreEqual(coaching.Id, await B14AskedAboutAsync(mayaId), "The plan the ask names, never the pack.");
        await RefreshCsrfAsync(rami);
        await AssertStatusAsync(await rami.PostAsync(B14RequestsUrl, null), HttpStatusCode.Created);
        Assert.AreEqual(pack.Id, await B14AskedAboutAsync(ramiId));

        // On the plan's last days the pack still runs and My plan reads them in the order they start.
        var plans = await ReadSliceAsync<OwnPlansView>(maya, OwnPlansUrl);
        Assert.HasCount(2, plans.Plans);
        Assert.AreEqual(coaching.Id, plans.Renewal?.PlanId);
    }

    [TestMethod]
    public async Task B14MyPlanCarriesTheAskAndListsThePlanItIsAboutBesideARunningPack()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "b14-page-coach@example.test", "Karim Haddad", "B14 Page");
        using var maya = CreateClient();
        var mayaId = await InviteAndAcceptAsync(coach, maya, "b14-page-maya@example.test", true);
        var product = await B10aProductAsync(coach, "Online Coaching", null, B10aOffer("2 weeks", 2, 0m, "Training"));
        var packProduct = await B10bPackProductAsync(coach, "Personal training", B10bPackOffer(10, 90, 0m));
        var plan = await A7EnrollAsync(coach, mayaId, product.Offers[0].Id, today);
        var pack = await A7EnrollAsync(coach, mayaId, packProduct.Offers[0].Id, today);

        // With nothing to ask about, the read says so and says nothing else.
        var running = await ReadSliceAsync<OwnPlansView>(maya, OwnPlansUrl);
        Assert.AreEqual((false, false, (Guid?)null), (running.Renewal!.PlanEnded, running.Renewal.CanAsk, running.Renewal.PlanId));

        // The plan ended and the pack runs on: without the plan the page would have no place for the ask its notice
        // promises, so it leads, and the pack follows as it did.
        RequiredTestClock.Advance(TimeSpan.FromDays(14));
        var ended = await ReadSliceAsync<OwnPlansView>(maya, OwnPlansUrl);
        Assert.AreEqual($"{plan.Id} {pack.Id}", string.Join(' ', ended.Plans.Select(item => item.Id)));
        Assert.AreEqual(EffectiveEnrollmentStatus.Expired, ended.Plans[0].Status);
        Assert.AreEqual(EffectiveEnrollmentStatus.Active, ended.Plans[1].Status);
        Assert.AreEqual((true, true, (Guid?)plan.Id, "Karim Haddad", (Guid?)null),
            (ended.Renewal!.PlanEnded, ended.Renewal.CanAsk, ended.Renewal.PlanId, ended.Renewal.CoachName, ended.Renewal.LastRequest?.Id));

        // The same request: asked from My plan, Today's read says it too.
        await RefreshCsrfAsync(maya);
        await AssertStatusAsync(await maya.PostAsync(B14RequestsUrl, null), HttpStatusCode.Created);
        var asked = await ReadSliceAsync<OwnPlansView>(maya, OwnPlansUrl);
        Assert.IsFalse(asked.Renewal!.CanAsk);
        Assert.AreEqual(
            (await ReadSliceAsync<RenewalStatusView>(maya, B14RenewalUrl)).LastRequest?.Id,
            asked.Renewal.LastRequest?.Id);

        // Nothing of money comes with it: a new field is a decision, as a client reads every one.
        using (var document = JsonDocument.Parse(await maya.GetStringAsync(OwnPlansUrl)))
        {
            Assert.AreEqual(
                "canAsk,coachName,endedOn,endsOn,lastRequest,planEnded,planId",
                B10aFieldNames(document.RootElement.GetProperty("renewal")));
        }

        // Renewed, the old plan leaves the page again and the page asks nothing.
        var renewal = await B13RenewFromAsync(coach, plan, product.Offers[0].Id, today.AddDays(14));
        var after = await ReadSliceAsync<OwnPlansView>(maya, OwnPlansUrl);
        Assert.AreEqual($"{pack.Id} {renewal.Id}", string.Join(' ', after.Plans.Select(item => item.Id)));
        Assert.AreEqual((false, (Guid?)null), (after.Renewal!.PlanEnded, after.Renewal.PlanId));
    }

    [TestMethod]
    public async Task B14TheAskStaysInItsWorkspaceAndIsTheClientsAlone()
    {
        var today = R61aStartAtMidday();
        using var coachA = CreateClient();
        var workspaceA = await RegisterCoachAsync(coachA, "b14-scope-a@example.test", "Coach A", "B14 A");
        using var shared = CreateClient();
        var clientA = await InviteAndAcceptAsync(coachA, shared, "b14-scope-client@example.test", true);
        await Step3EnrollAsync(coachA, clientA, today, 2, "Training");

        using var coachB = CreateClient();
        var workspaceB = await RegisterCoachAsync(coachB, "b14-scope-b@example.test", "Coach B", "B14 B");
        var clientB = await InviteAndAcceptAsync(coachB, shared, "b14-scope-client@example.test", false);
        await Step3EnrollAsync(coachB, clientB, today, 8, "Training");
        RequiredTestClock.Advance(TimeSpan.FromDays(11));

        // The plan in B runs on, so it is closed there and open in A, which reaches A's coach alone.
        SetTenant(shared, workspaceB);
        Assert.IsNull((await ReadSliceAsync<RenewalStatusView>(shared, B14RenewalUrl)).EndsOn);
        await Step3AssertPlanNotEndedAsync(shared);
        SetTenant(shared, workspaceA);
        await RefreshCsrfAsync(shared);
        await AssertStatusAsync(await shared.PostAsync(B14RequestsUrl, null), HttpStatusCode.Created);
        await Step3SweepNotificationsAsync();
        Assert.IsFalse((await RequiredJsonAsync<RenewalInbox>(await coachB.GetAsync("/api/notifications"))).Items
            .Any(item => item.Kind == nameof(CommercialNotificationKind.RenewalRequested)));
        Assert.AreEqual(0L, await Step3CountRenewalRequestsAsync(clientB));

        // A workspace they do not belong to, a coach on the client's route and nobody signed in are all refused.
        using var stranger = CreateClient();
        var elsewhere = await RegisterCoachAsync(stranger, "b14-scope-other@example.test", "Other", "B14 Other");
        SetTenant(shared, elsewhere);
        await RefreshCsrfAsync(shared);
        await AssertStatusAsync(await shared.PostAsync(B14RequestsUrl, null), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await shared.GetAsync(OwnPlansUrl), HttpStatusCode.Forbidden);
        await RefreshCsrfAsync(coachA);
        await AssertStatusAsync(await coachA.PostAsync(B14RequestsUrl, null), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await coachA.GetAsync(OwnPlansUrl), HttpStatusCode.Forbidden);
        using var anonymous = CreateClient();
        await AssertStatusAsync(await anonymous.GetAsync(OwnPlansUrl), HttpStatusCode.Unauthorized);
    }

    [TestMethod]
    public async Task B14ARequestFromAnEarlierPlanSaysNothingOfTheNextOne()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "b14-old-coach@example.test", "Karim Haddad", "B14 Old");
        using var maya = CreateClient();
        var mayaId = await InviteAndAcceptAsync(coach, maya, "b14-old-maya@example.test", true);
        var product = await B10aProductAsync(coach, "Online Coaching", null, B10aOffer("2 weeks", 2, 0m, "Training"));
        var plan = await A7EnrollAsync(coach, mayaId, product.Offers[0].Id, today);

        // She asks in the last days of the first plan, and her coach renews it.
        RequiredTestClock.Advance(TimeSpan.FromDays(11));
        await RefreshCsrfAsync(maya);
        await AssertStatusAsync(await maya.PostAsync(B14RequestsUrl, null), HttpStatusCode.Created);
        var next = await B13RenewFromAsync(coach, plan, product.Offers[0].Id, today.AddDays(14));

        // The next plan runs out too: nobody asked about that one.
        RequiredTestClock.Advance(TimeSpan.FromDays(17));
        Assert.AreEqual(next.Id, (await ReadSliceAsync<RenewalStatusView>(maya, B14RenewalUrl)).PlanId);
        var row = await B4aRowAsync(coach, mayaId);
        Assert.IsTrue(row.AttentionItems.All(item => item.Kind != CoachAttentionKind.RenewalRequested));
        var listed = (await ReadSliceAsync<CoachTodayView>(coach, CoachTodayUrl)).PlansEndedNotRenewed.Single();
        Assert.AreEqual((next.Id, (DateOnly?)null), (listed.EnrollmentId, listed.RenewalRequestedOn));
    }

    /// <summary>The workspace day the plan's ending-soon notice is scheduled for, read from the outbox.</summary>
    private async Task<DateOnly> B14EndingNoticeDayAsync(Guid enrollmentId)
    {
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            """SELECT "ScheduledAtUtc" FROM notifications."OutboxItems" WHERE "AggregateId" = @id AND "Kind" = 'EnrollmentEndingSoon'""";
        command.Parameters.AddWithValue("id", enrollmentId);
        var scheduled = (DateTime)(await command.ExecuteScalarAsync() ?? throw new AssertFailedException("No ending-soon notice was queued."));
        return DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(scheduled, TimeZoneInfo.FindSystemTimeZoneById("Asia/Beirut")));
    }

    private async Task<Guid> B14AskedAboutAsync(Guid clientId)
    {
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            """SELECT "EndedEnrollmentId" FROM subscriptions."RenewalRequests" WHERE "ClientProfileId" = @id ORDER BY "RequestedOn" DESC LIMIT 1""";
        command.Parameters.AddWithValue("id", clientId);
        return (Guid)(await command.ExecuteScalarAsync() ?? throw new AssertFailedException("No request was stored."));
    }
}
