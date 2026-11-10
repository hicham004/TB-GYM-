using System.Net;
using System.Net.Http.Json;
using TB.Gym.Modules.Clients;
using TB.Gym.SharedKernel;
using ClientEnrollmentView = TB.Gym.Modules.Subscriptions.ClientEnrollmentView;
using CoachingProductView = TB.Gym.Modules.Subscriptions.CoachingProductView;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Critique B4a, the server's half of the Clients table: overdue check-ins (CHK-015) in coach attention v4
/// (CLI-018), and what each row of the list says about the client, their plan and what they last did, for the
/// caller's own clients alone. The tests that step days start at midday in the workspace's zone, so a whole day
/// always lands on the next calendar day; the one about the workspace's midnight sets the clock to each time it reads.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task B4aAnUnsentCheckInIsOverdueFromTwoDaysAfterItsDueDayUntilSentOrFourteenDaysOn()
    {
        var start = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b4a-overdue-owner@example.test", "Hicham Haddad", "B4a Overdue");
        using var lea = CreateClient();
        await JoinAsCoachAsync(owner, lea, "b4a-overdue-lea@example.test", "Lea Khoury");
        var form = await Phase6CreateFormAsync(owner, "Weekly check-in", Phase6ShortText("How was your week?"));
        var version = await Phase6PublishAsync(owner, form.Form.Id, form.Versions[0]);

        // Maya is the owner's, with check-ins and messaging; Rami is Lea's, and Lea has a chat with him; Nour's
        // one-week plan has check-ins alone. Each is asked for a check-in due today.
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(owner, maya, tenant, "b4a-overdue-maya@example.test", "Maya", "Rahman");
        await Phase6EnrollAsync(owner, mayaId, "B4a check-ins and chat", "CheckIns", "Messaging");
        var mayaAssignment = await B4aAssignAsync(owner, mayaId, version.Id, start);
        using var rami = CreateClient();
        var ramiId = await R31InviteAsync(lea, rami, tenant, "b4a-overdue-rami@example.test", "Rami", "Khoury");
        await Phase6EnrollAsync(owner, ramiId, "B4a check-ins and chat", "CheckIns", "Messaging");
        await B4aAssignAsync(lea, ramiId, version.Id, start);
        var leasChat = await StartChatAsync(lea, ramiId);
        using var nour = CreateClient();
        var nourId = await R31InviteAsync(owner, nour, tenant, "b4a-overdue-nour@example.test", "Nour", "Fares");
        await Step3EnrollAsync(owner, nourId, start, 1, "CheckIns");
        await B4aAssignAsync(owner, nourId, version.Id, start);

        // On the due day and the day after, nothing is overdue yet.
        Assert.IsEmpty(await B4aOverdueAsync(owner));
        RequiredTestClock.Advance(TimeSpan.FromDays(1));
        Assert.IsEmpty(await B4aOverdueAsync(owner));

        // Two days on, every one asks, the oldest due first, then by name. Only the client's own coach with
        // messaging in the plan may remind them: the owner may message Maya (no chat yet, so Remind starts one),
        // not Nour, whose plan has no messaging, nor Rami, Lea's client; Lea's Remind opens her chat with him.
        RequiredTestClock.Advance(TimeSpan.FromDays(1));
        Assert.AreEqual(
            $"Nour 1 {start:yyyy-MM-dd} False , Rami 1 {start:yyyy-MM-dd} False , Maya 1 {start:yyyy-MM-dd} True ",
            string.Join(", ", (await B4aOverdueAsync(owner)).Select(item =>
                $"{item.Client.FirstName} {item.Count} {item.Date:yyyy-MM-dd} {item.CanMessage} {item.SubjectId}")));
        var leas = (await B4aOverdueAsync(lea)).Single();
        Assert.AreEqual((ramiId, true, (Guid?)leasChat), (leas.Client.ClientProfileId, leas.CanMessage, leas.SubjectId));
        foreach (var url in new[] { CoachTodayUrl, ClientOverviewUrl })
        {
            Assert.IsFalse((await owner.GetStringAsync(url)).Contains(leasChat.ToString(), StringComparison.OrdinalIgnoreCase),
                $"{url}: another coach's chat is never the owner's to open.");
        }

        // It makes Nour Needs attention, where her one-week plan's end alone would not; the plan keeps its own
        // status, and her own page says what the row says.
        var nourRow = await B4aRowAsync(owner, nourId);
        Assert.AreEqual((ClientOverviewStatus.NeedsAttention, ClientPlanStatus.EndingSoon), (nourRow.Status, nourRow.PlanStatus));
        CollectionAssert.AreEqual(
            new[] { CoachAttentionKind.PlanEndingSoon, CoachAttentionKind.CheckInOverdue }, nourRow.Attention.ToArray());
        var nourItem = nourRow.AttentionItems.Single(item => item.Kind == CoachAttentionKind.CheckInOverdue);
        Assert.AreEqual((1, (DateOnly?)start, (Guid?)null, false),
            (nourItem.Count, nourItem.Date, nourItem.SubjectId, nourItem.CanMessage));
        var nourPage = await ReadSliceAsync<ClientProfileOverviewView>(owner, R33bOverviewUrl(nourId));
        CollectionAssert.AreEqual(nourRow.Attention.ToArray(), nourPage.Attention.Select(item => item.Kind).ToArray());
        Assert.AreEqual((CoachAttentionPolicy.Key, 8), (nourPage.AttentionRuleKey, nourPage.AttentionRuleVersion));

        // Once the owner and Maya have a chat, Remind opens it. A draft is not sent; sending takes the item away
        // and puts the check-in to review in its place.
        var mayasChat = await StartChatAsync(owner, mayaId);
        Assert.AreEqual((Guid?)mayasChat, (await B4aOverdueAsync(owner)).Single(item => item.Client.ClientProfileId == mayaId).SubjectId);
        var question = Phase6QuestionOfType(version, "ShortText");
        var draft = await RequiredJsonAsync<Phase6ResponseDetail>(
            await Phase6SaveDraftAsync(maya, mayaAssignment, [Phase6TextAnswer(question.Id, "Half written.")]));
        Assert.IsTrue((await B4aOverdueAsync(owner)).Any(item => item.Client.ClientProfileId == mayaId), "A draft is not sent.");
        await AssertStatusAsync(await Phase6SubmitAsync(maya, mayaAssignment, draft.Response!.Version), HttpStatusCode.OK);
        var today = await ReadSliceAsync<CoachTodayView>(owner, CoachTodayUrl);
        Assert.IsFalse(today.Attention.Any(item => item.Kind == CoachAttentionKind.CheckInOverdue && item.Client.ClientProfileId == mayaId));
        Assert.IsTrue(today.Attention.Any(item => item.Kind == CoachAttentionKind.CheckInToReview && item.Client.ClientProfileId == mayaId));

        // Day 8: Nour's plan has ended, so her check-in no longer asks; Rami's still does, through day 13.
        RequiredTestClock.Advance(TimeSpan.FromDays(6));
        Assert.AreEqual(ramiId, (await B4aOverdueAsync(owner)).Single().Client.ClientProfileId);
        RequiredTestClock.Advance(TimeSpan.FromDays(5));
        Assert.AreEqual(ramiId, (await B4aOverdueAsync(lea)).Single().Client.ClientProfileId);

        // Fourteen days after its due day it stops asking.
        RequiredTestClock.Advance(TimeSpan.FromDays(1));
        Assert.IsEmpty(await B4aOverdueAsync(lea));
        Assert.IsEmpty(await B4aOverdueAsync(owner));
    }

    [TestMethod]
    public async Task B4aEachRowSaysTheBirthDateThePlanAndWhatTheClientLastDidForTheCallersClientsAlone()
    {
        var today = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b4a-rows-owner@example.test", "Hicham Haddad", "B4a Rows");
        using var lea = CreateClient();
        await JoinAsCoachAsync(owner, lea, "b4a-rows-lea@example.test", "Lea Khoury");

        // Maya pays 120.50 USD for twelve weeks of check-ins and messaging, and sends a check-in.
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(owner, maya, tenant, "b4a-rows-maya@example.test", "Maya", "Rahman");
        var plan = await B4aPaidPlanAsync(owner, mayaId, "B4a Strength", 120.50m, 12, "Messaging", "CheckIns");
        var form = await Phase6CreateFormAsync(owner, "Weekly check-in", Phase6ShortText("How was your week?"));
        var version = await Phase6PublishAsync(owner, form.Form.Id, form.Versions[0]);
        var assignment = await B4aAssignAsync(owner, mayaId, version.Id, today);
        R31Tick();
        await B4aSendAsync(maya, assignment, version);

        // Omar trains on an eight-week plan, with a four-week nutrition plan beside it; Sara has no plan at all.
        using var omar = CreateClient();
        var omarId = await R31InviteAsync(owner, omar, tenant, "b4a-rows-omar@example.test", "Omar", "Nasser");
        var resources = await CreateTrainingResourcesAsync(owner, omarId, 8, 3, today);
        await AssignAsync(owner, omarId, resources, today);
        await Step3EnrollAsync(owner, omarId, today, 4, "Nutrition");
        await R25bFinishTodaysWorkoutAsync(omar, 80m);
        using var sara = CreateClient();
        var saraId = await R31InviteAsync(owner, sara, tenant, "b4a-rows-sara@example.test", "Sara", "Haddad");

        // Rami is Lea's.
        using var rami = CreateClient();
        var ramiId = await R31InviteAsync(lea, rami, tenant, "b4a-rows-rami@example.test", "Rami", "Saliba");
        await GrantFreeFeaturesAsync(lea, ramiId, "Training");

        var rows = (await ReadSliceAsync<ClientOverviewView>(owner, ClientOverviewUrl)).Clients
            .ToDictionary(row => row.Client.ClientProfileId);
        var mayaRow = rows[mayaId];
        Assert.AreEqual((DateOnly?)new DateOnly(1995, 4, 2), mayaRow.BirthDate);
        var summary = mayaRow.Plan ?? throw new AssertFailedException("Maya has a plan.");
        Assert.AreEqual((plan.Id, "B4a Strength", 12, ClientPlanLengthUnit.Week, 120.50m, "USD"),
            (summary.EnrollmentId, summary.Name, summary.LengthCount, summary.LengthUnit, summary.PriceAmount, summary.PriceCurrency));
        CollectionAssert.AreEqual(new[] { CoachingFeature.CheckIns, CoachingFeature.Messaging }, summary.Features.ToArray());
        CollectionAssert.AreEqual(new[] { CoachingFeature.CheckIns, CoachingFeature.Messaging }, mayaRow.FeaturesToday.ToArray());
        Assert.AreEqual((ClientPlanState.Running, ClientPlanStatus.OnTrack, (DateOnly?)today.AddDays(83), 0, (DateOnly?)null),
            (mayaRow.PlanState, mayaRow.PlanStatus, mayaRow.PlanEndsOn, mayaRow.OtherPlanCount, mayaRow.PlanPausedSince));
        Assert.AreEqual(CoachActivityKind.CheckInSubmitted, mayaRow.LastActivityKind);
        Assert.IsNotNull(mayaRow.LastCheckInSentAtUtc);
        Assert.AreEqual((mayaRow.LastActivityAtUtc, (string?)null), (mayaRow.LastCheckInSentAtUtc, mayaRow.LastActivityTitle));
        var waiting = mayaRow.AttentionItems.Single();
        Assert.AreEqual((CoachAttentionKind.CheckInToReview, 1, (Guid?)assignment, true),
            (waiting.Kind, waiting.Count, waiting.SubjectId, waiting.CanMessage));

        // Omar's row names the plan that ends last, says one more runs beside it, and names his workout.
        var omarRow = rows[omarId];
        Assert.AreEqual((CoachActivityKind.WorkoutCompleted, "Squat day 1"), (omarRow.LastActivityKind, omarRow.LastActivityTitle));
        Assert.IsNull(omarRow.LastCheckInSentAtUtc, "Check-ins are not in Omar's plan.");
        Assert.AreEqual(("8-week training", 8, ClientPlanLengthUnit.Week, 0m, "USD", 1),
            (omarRow.Plan?.Name, omarRow.Plan?.LengthCount, omarRow.Plan?.LengthUnit, omarRow.Plan?.PriceAmount,
                omarRow.Plan?.PriceCurrency, omarRow.OtherPlanCount));
        Assert.AreEqual((resources.Enrollment.Id, (DateOnly?)today.AddDays(55)), (omarRow.Plan!.EnrollmentId, omarRow.PlanEndsOn));
        CollectionAssert.AreEqual(new[] { CoachingFeature.Training }, omarRow.Plan.Features.ToArray());
        CollectionAssert.AreEqual(new[] { CoachingFeature.Training, CoachingFeature.Nutrition }, omarRow.FeaturesToday.ToArray());
        var saraRow = rows[saraId];
        Assert.AreEqual(((ClientPlanSummary?)null, ClientPlanState.None, ClientPlanStatus.NoActivePlan, 0),
            (saraRow.Plan, saraRow.PlanState, saraRow.PlanStatus, saraRow.OtherPlanCount));
        Assert.IsEmpty(saraRow.FeaturesToday);
        CollectionAssert.AreEqual(new[] { CoachAttentionKind.NoPlan }, saraRow.AttentionItems.Select(item => item.Kind).ToArray());
        Assert.IsNotNull(rows[ramiId].Plan, "The owner reads every client's plan.");
        Assert.IsFalse(rows[ramiId].AttentionItems.Any(item => item.CanMessage), "Rami is Lea's to message.");

        // Pausing says since when, never until when; the plan and its end stay as they were, and nothing of the
        // features it covers is read while it is paused.
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(await owner.PostAsJsonAsync($"/api/commercial/enrollments/{plan.Id}/pause",
            new { reason = "Travelling", plan.Version }), HttpStatusCode.OK);
        RequiredTestClock.Advance(TimeSpan.FromDays(2));
        mayaRow = await B4aRowAsync(owner, mayaId);
        Assert.AreEqual(
            (ClientPlanState.Paused, ClientOverviewStatus.Paused, ClientPlanStatus.Paused, (DateOnly?)today, (DateOnly?)today.AddDays(83)),
            (mayaRow.PlanState, mayaRow.Status, mayaRow.PlanStatus, mayaRow.PlanPausedSince, mayaRow.PlanEndsOn));
        Assert.AreEqual((plan.Id, "B4a Strength"), (mayaRow.Plan?.EnrollmentId, mayaRow.Plan?.Name));
        Assert.IsNull(mayaRow.LastCheckInSentAtUtc, "A paused plan's check-ins are not read, as the screens that own them refuse.");
        Assert.IsEmpty(mayaRow.FeaturesToday);
        Assert.IsEmpty(mayaRow.AttentionItems);

        // Lea reads her own client's row, and nothing of the owner's clients: no id, plan or price of theirs.
        var leasRow = (await ReadSliceAsync<ClientOverviewView>(lea, ClientOverviewUrl)).Clients.Single();
        Assert.AreEqual((ramiId, (DateOnly?)new DateOnly(1995, 4, 2)), (leasRow.Client.ClientProfileId, leasRow.BirthDate));
        Assert.AreEqual(CoachingFeature.Training, leasRow.Plan?.Features.Single());
        var raw = await lea.GetStringAsync(ClientOverviewUrl);
        foreach (var hidden in new[] { mayaId.ToString(), omarId.ToString(), saraId.ToString(), "B4a Strength", "120.5", "8-week training" })
        {
            Assert.IsFalse(raw.Contains(hidden, StringComparison.OrdinalIgnoreCase), hidden);
        }

        // Nobody signed out, no client and no other workspace's owner reads the list.
        using var anonymous = CreateClient();
        SetTenant(anonymous, tenant);
        await AssertStatusAsync(await anonymous.GetAsync(ClientOverviewUrl), HttpStatusCode.Unauthorized);
        await AssertStatusAsync(await maya.GetAsync(ClientOverviewUrl), HttpStatusCode.Forbidden);
        using var stranger = CreateClient();
        await RegisterCoachAsync(stranger, "b4a-rows-stranger@example.test", "Other Owner", "B4a Elsewhere");
        Assert.IsEmpty((await ReadSliceAsync<ClientOverviewView>(stranger, ClientOverviewUrl)).Clients);
        SetTenant(stranger, tenant);
        await AssertStatusAsync(await stranger.GetAsync(ClientOverviewUrl), HttpStatusCode.Forbidden);
    }

    [TestMethod]
    public async Task B4aAReturningClientsRowIsTheNewProfilesAndShowsNothingOfTheOldOne()
    {
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b4a-back-owner@example.test", "Hicham Haddad", "B4a Back");
        using var sara = CreateClient();
        var oldId = await R31InviteAsync(owner, sara, tenant, "b4a-back-sara@example.test", "Sara", "Haddad");
        await A8CompleteOnboardingAsync(sara, "Sara", "Haddad");
        var row = await B4aRowAsync(owner, oldId);
        Assert.AreEqual(((DateOnly?)new DateOnly(1995, 4, 2), "Build strength"), (row.BirthDate, row.Goals));

        // Released, she leaves the list (ADR 0027).
        await ReleaseAsync(owner, oldId, "Took a break");
        Assert.IsFalse((await owner.GetStringAsync(ClientOverviewUrl)).Contains(oldId.ToString(), StringComparison.OrdinalIgnoreCase));

        // Invited back with no date of birth, she is a new relationship (CLI-016): her row has neither the old
        // profile's date of birth nor its goal, and nothing else of it.
        await RefreshCsrfAsync(owner);
        var invited = await owner.PostAsJsonAsync("/api/invitations",
            new { email = "b4a-back-sara@example.test", firstName = "Sara", lastName = "Haddad" });
        await AssertStatusAsync(invited, HttpStatusCode.Created);
        var link = (await RequiredJsonAsync<Invitation>(invited)).DevelopmentActionUrl!;
        await RefreshCsrfAsync(sara);
        var accepted = await sara.PostAsJsonAsync("/api/invitations/accept",
            new { token = QueryValue(link, "token"), displayName = (string?)null, password = (string?)null });
        await AssertStatusAsync(accepted, HttpStatusCode.OK);
        var newId = (await RequiredJsonAsync<InvitationAcceptance>(accepted)).ClientProfileId;
        Assert.AreNotEqual(oldId, newId);
        var back = (await ReadSliceAsync<ClientOverviewView>(owner, ClientOverviewUrl)).Clients.Single();
        Assert.AreEqual((newId, (DateOnly?)null, (string?)null), (back.Client.ClientProfileId, back.BirthDate, back.Goals));
        Assert.IsFalse((await owner.GetStringAsync(ClientOverviewUrl)).Contains(oldId.ToString(), StringComparison.OrdinalIgnoreCase));
    }

    [TestMethod]
    public async Task B4aTheClientListIsAFixedNumberOfQueriesWhateverTheClientCount()
    {
        var today = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b4a-queries-owner@example.test", "Hicham Haddad", "B4a Queries");
        var form = await Phase6CreateFormAsync(owner, "Weekly check-in", Phase6ShortText("How was your week?"));
        var version = await Phase6PublishAsync(owner, form.Form.Id, form.Versions[0]);
        using var sara = CreateClient();
        await R31InviteAsync(owner, sara, tenant, "b4a-queries-sara@example.test", "Sara", "Haddad");

        // Every client below has every read the list makes: a program with a finished workout, a sent check-in
        // and one still to come, an unread message, a weigh-in, and two plans; Sara has no plan.
        using var maya = CreateClient();
        var (mayaId, training) = await B4aBusyClientAsync(owner, maya, tenant, "maya", version, null, today);
        using var omar = CreateClient();
        await B4aBusyClientAsync(owner, omar, tenant, "omar", version, training, today);
        // Rana's lift has "Last time + step" sets with no starting weight, done today: all three of where her lifts
        // stand are read (notes plan N6d).
        using var rana = CreateClient();
        var ranaId = await R31InviteAsync(owner, rana, tenant, "b4a-queries-rana@example.test", "Rana", "Step");
        await N6dStepProgramAsync(owner, ranaId, "b4a queries", null);
        await N6bTrainTodayAsync(rana, true, new N6bLog(10, 12m), new N6bLog(10, 12m));
        var (fewer, _) = await B4aMeasureAsync<ClientOverviewView>(owner, ClientOverviewUrl, "client list, 4 clients");

        using var nour = CreateClient();
        await B4aBusyClientAsync(owner, nour, tenant, "nour", version, training, today);
        using var rami = CreateClient();
        await B4aBusyClientAsync(owner, rami, tenant, "rami", version, training, today);
        var (more, list) = await B4aMeasureAsync<ClientOverviewView>(owner, ClientOverviewUrl, "client list, 6 clients");
        Assert.HasCount(6, list.Clients);
        Assert.AreEqual(fewer, more, "Two more clients cost the list no query.");
        // 23, sign-in and tenant checks included: Today's reads without its feed, plus the last activity (three) and
        // the plan summaries (one); N10a reads each client's latest program in one query where P4c's suggested maxes
        // took two; 26 since N6d, which reads where the step lifts stand: the coming step sets, those lifts' last weeks
        // and the workouts before them of a lift those cannot settle (Rana's). Every read the list makes is in use
        // here but the renewal requests, read only when some client's whole plan has run out. Pinned exactly, so one
        // more read fails here, as a query per client fails the equality above.
        Assert.AreEqual(26, more, "The client list costs a fixed 26 queries (docs/ARCHITECTURE.md).");
        Assert.AreEqual((1, 1, 1, 0), N6dCommands());
        var (todayBefore, _) = await B4aMeasureAsync<CoachTodayView>(owner, CoachTodayUrl, "Coach Today");
        var (pageBefore, _) = await B4aMeasureAsync<ClientProfileOverviewView>(owner, R33bOverviewUrl(mayaId), "client page");

        // Three days on, each check-in still to come is overdue and Remind opens each client's chat. The list, Today
        // and a client's page cost what they did: overdue check-ins come in the read of those waiting for review, and
        // the chats in the read of unread messages, so the shared reads gain no command.
        RequiredTestClock.Advance(TimeSpan.FromDays(3));
        Assert.AreEqual(more, (await B4aMeasureAsync<ClientOverviewView>(owner, ClientOverviewUrl, "client list, overdue")).Queries);
        var (todayAfter, view) = await B4aMeasureAsync<CoachTodayView>(owner, CoachTodayUrl, "Coach Today, overdue");
        Assert.AreEqual(todayBefore, todayAfter, "Overdue check-ins and their chats cost Coach Today no query.");
        var overdue = view.Attention.Where(item => item.Kind == CoachAttentionKind.CheckInOverdue).ToArray();
        Assert.HasCount(4, overdue);
        Assert.IsTrue(overdue.All(item => item.CanMessage && item.SubjectId is not null && item.Count == 1));
        var (pageAfter, page) = await B4aMeasureAsync<ClientProfileOverviewView>(
            owner, R33bOverviewUrl(mayaId), "client page, overdue");
        Assert.AreEqual(pageBefore, pageAfter, "An overdue check-in and its chat cost a client's page no query.");
        Assert.Contains(CoachAttentionKind.CheckInOverdue, page.Attention.Select(item => item.Kind).ToArray());
    }

    [TestMethod]
    public async Task B4aARowSumsUpThePaidPlanEndingLastElseAnUnpaidOneElseTheOneThatRanOut()
    {
        var start = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b4a-plans-owner@example.test", "Hicham Haddad", "B4a Plans");

        // One plan for sale has two options: four weeks of check-ins and chat for 99.99 USD, and twelve weeks of
        // training and chat for 250 EUR. Another sells one week of nutrition for 35.50 USD.
        var coaching = await B4aProductAsync(owner, "B4a Coaching", B4aOfferRequest(4, 99.99m, "USD", "CheckIns", "Messaging"));
        var month = coaching.Offers.Single().Id;
        var block = await B4aAddOfferAsync(owner, coaching, B4aOfferRequest(12, 250m, "EUR", "Training", "Messaging"));
        var week = (await B4aProductAsync(owner, "B4a Nutrition", B4aOfferRequest(1, 35.50m, "USD", "Nutrition"))).Offers.Single().Id;

        // Maya has paid her month and the twelve weeks booked after it; Omar has paid his month but not the renewal.
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(owner, maya, tenant, "b4a-plans-maya@example.test", "Maya", "Rahman");
        var mayaMonth = await B4aPayInFullAsync(owner, await A7EnrollAsync(owner, mayaId, month, start));
        var mayaRenewal = await B4aPayInFullAsync(owner, await B4aRenewAsync(owner, mayaMonth, block));
        using var omar = CreateClient();
        var omarId = await R31InviteAsync(owner, omar, tenant, "b4a-plans-omar@example.test", "Omar", "Nasser");
        var omarMonth = await B4aPayInFullAsync(owner, await A7EnrollAsync(owner, omarId, month, start));
        await B4aRenewAsync(owner, omarMonth, block);

        // Nour's month waits for payment and is her only plan; Rami's was paid, then cancelled; Sara's paid week has
        // run out by the time the rows are read, a week on.
        using var nour = CreateClient();
        var nourId = await R31InviteAsync(owner, nour, tenant, "b4a-plans-nour@example.test", "Nour", "Fares");
        var nourMonth = await A7EnrollAsync(owner, nourId, month, start);
        using var rami = CreateClient();
        var ramiId = await R31InviteAsync(owner, rami, tenant, "b4a-plans-rami@example.test", "Rami", "Saliba");
        var ramiMonth = await B4aPayInFullAsync(owner, await A7EnrollAsync(owner, ramiId, month, start));
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(await owner.PostAsJsonAsync($"/api/commercial/enrollments/{ramiMonth.Id}/cancel",
            new { reason = "Booked by mistake", ramiMonth.Version }), HttpStatusCode.OK);
        using var sara = CreateClient();
        var saraId = await R31InviteAsync(owner, sara, tenant, "b4a-plans-sara@example.test", "Sara", "Haddad");
        var saraWeek = await B4aPayInFullAsync(owner, await A7EnrollAsync(owner, saraId, week, start));
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        var rows = (await ReadSliceAsync<ClientOverviewView>(owner, ClientOverviewUrl)).Clients
            .ToDictionary(row => row.Client.ClientProfileId);

        // A paid renewal booked after the running plan is the plan the row ends with: the twelve weeks at 250 EUR,
        // ending on their last day, with the running month counted beside it. Today's features are still the month's.
        Assert.AreEqual((mayaRenewal.Id, "B4a Coaching", "Training, Messaging", 12, ClientPlanLengthUnit.Week, 250m, "EUR"),
            B4aPlanSummary(rows[mayaId]));
        Assert.AreEqual((ClientPlanState.Running, (DateOnly?)mayaRenewal.LastActiveDate, 1),
            (rows[mayaId].PlanState, rows[mayaId].PlanEndsOn, rows[mayaId].OtherPlanCount));
        CollectionAssert.AreEqual(new[] { CoachingFeature.CheckIns, CoachingFeature.Messaging }, rows[mayaId].FeaturesToday.ToArray());

        // A renewal waiting for payment covers nothing (SUB-008, BEB-7): the paid month is the plan, at its own price,
        // never added to the renewal's, and the renewal is counted beside it.
        Assert.AreEqual((omarMonth.Id, "B4a Coaching", "CheckIns, Messaging", 4, ClientPlanLengthUnit.Week, 99.99m, "USD"),
            B4aPlanSummary(rows[omarId]));
        Assert.AreEqual((ClientPlanState.Running, (DateOnly?)omarMonth.LastActiveDate, 1),
            (rows[omarId].PlanState, rows[omarId].PlanEndsOn, rows[omarId].OtherPlanCount));

        // With nothing paid, the plan waiting for payment is the plan, alone.
        Assert.AreEqual((nourMonth.Id, "B4a Coaching", "CheckIns, Messaging", 4, ClientPlanLengthUnit.Week, 99.99m, "USD"),
            B4aPlanSummary(rows[nourId]));
        Assert.AreEqual((ClientPlanState.PaymentDue, (DateOnly?)nourMonth.LastActiveDate, 0),
            (rows[nourId].PlanState, rows[nourId].PlanEndsOn, rows[nourId].OtherPlanCount));
        Assert.IsEmpty(rows[nourId].FeaturesToday);

        // A plan that ran out is still the plan the row names, ending on its last day.
        Assert.AreEqual((saraWeek.Id, "B4a Nutrition", "Nutrition", 1, ClientPlanLengthUnit.Week, 35.50m, "USD"),
            B4aPlanSummary(rows[saraId]));
        Assert.AreEqual((ClientPlanState.Ended, (DateOnly?)saraWeek.LastActiveDate, 0),
            (rows[saraId].PlanState, rows[saraId].PlanEndsOn, rows[saraId].OtherPlanCount));

        // A cancelled plan neither runs nor ran out: nothing to sum up, no end, nothing beside it.
        Assert.AreEqual(((ClientPlanSummary?)null, ClientPlanState.Ended, (DateOnly?)null, 0),
            (rows[ramiId].Plan, rows[ramiId].PlanState, rows[ramiId].PlanEndsOn, rows[ramiId].OtherPlanCount));
    }

    [TestMethod]
    public async Task B4aTheWorkspacesMidnightNotUtcsDecidesWhenACheckInIsOverdueAndWhenAPlanWasPaused()
    {
        var start = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b4a-midnight-owner@example.test", "Hicham Haddad", "B4a Midnight");
        var form = await Phase6CreateFormAsync(owner, "Weekly check-in", Phase6ShortText("How was your week?"));
        var version = await Phase6PublishAsync(owner, form.Form.Id, form.Versions[0]);

        // The workspace keeps Beirut's time, two or three hours ahead of UTC. Maya's check-in is due today; Omar is
        // on an eight-week nutrition plan.
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(owner, maya, tenant, "b4a-midnight-maya@example.test", "Maya", "Rahman");
        await Phase6EnrollAsync(owner, mayaId, "B4a check-ins", "CheckIns");
        await B4aAssignAsync(owner, mayaId, version.Id, start);
        using var omar = CreateClient();
        var omarId = await R31InviteAsync(owner, omar, tenant, "b4a-midnight-omar@example.test", "Omar", "Nasser");
        var plan = await Step3EnrollAsync(owner, omarId, start, 8, "Nutrition");

        // At 23:30 the day after its due day the check-in is a day late, not overdue. An hour later it is the second
        // day in Beirut but still the first in UTC, and it is overdue: the workspace's day decides.
        B4aSetWorkspaceClock(start.AddDays(1), new TimeOnly(23, 30));
        Assert.IsEmpty(await B4aOverdueAsync(owner));
        B4aSetWorkspaceClock(start.AddDays(2), new TimeOnly(0, 30));
        Assert.AreEqual(start.AddDays(1), B4aUtcDay(), "In UTC it is still the day after the due day.");
        var overdue = (await B4aOverdueAsync(owner)).Single();
        Assert.AreEqual((mayaId, 1, (DateOnly?)start), (overdue.Client.ClientProfileId, overdue.Count, overdue.Date));

        // Paused now, Omar's plan was paused on Beirut's day, the day after UTC's.
        await RefreshCsrfAsync(owner);
        var pausing = await owner.PostAsJsonAsync($"/api/commercial/enrollments/{plan.Id}/pause",
            new { reason = "Travelling", plan.Version });
        await AssertStatusAsync(pausing, HttpStatusCode.OK);
        var paused = await ReadSlicePayloadAsync<ClientEnrollmentView>(pausing);
        var omarRow = await B4aRowAsync(owner, omarId);
        Assert.AreEqual((ClientPlanState.Paused, (DateOnly?)start.AddDays(2)), (omarRow.PlanState, omarRow.PlanPausedSince));

        // The check-in asks until Beirut's midnight thirteen days after its due day, and not half an hour later,
        // though in UTC that day has not ended.
        B4aSetWorkspaceClock(start.AddDays(13), new TimeOnly(23, 30));
        Assert.AreEqual((DateOnly?)start, (await B4aOverdueAsync(owner)).Single().Date);
        B4aSetWorkspaceClock(start.AddDays(14), new TimeOnly(0, 30));
        Assert.AreEqual(start.AddDays(13), B4aUtcDay(), "In UTC it is still the thirteenth day after the due day.");
        Assert.IsEmpty(await B4aOverdueAsync(owner));

        // The pause still says the day it began. Resumed, the plan ends on the day it always did (SUB-006).
        omarRow = await B4aRowAsync(owner, omarId);
        Assert.AreEqual(((DateOnly?)start.AddDays(2), (DateOnly?)start.AddDays(55)), (omarRow.PlanPausedSince, omarRow.PlanEndsOn));
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(await owner.PostAsJsonAsync($"/api/commercial/enrollments/{plan.Id}/resume",
            new { paused.Version }), HttpStatusCode.OK);
        omarRow = await B4aRowAsync(owner, omarId);
        Assert.AreEqual((ClientPlanState.Running, (DateOnly?)null, (DateOnly?)start.AddDays(55)),
            (omarRow.PlanState, omarRow.PlanPausedSince, omarRow.PlanEndsOn));
    }

    [TestMethod]
    public async Task B4aAnOldChatGivesNoRemindOnceTodaysPlanLeavesMessagingOut()
    {
        var start = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b4a-oldchat-owner@example.test", "Hicham Haddad", "B4a Old Chat");
        var form = await Phase6CreateFormAsync(owner, "Weekly check-in", Phase6ShortText("How was your week?"));
        var version = await Phase6PublishAsync(owner, form.Form.Id, form.Versions[0]);

        // Maya's first week includes messaging and her check-ins run two weeks. The owner starts a chat and Maya
        // writes in it; she sends one check-in at once and leaves the one due today.
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(owner, maya, tenant, "b4a-oldchat-maya@example.test", "Maya", "Rahman");
        await Step3EnrollAsync(owner, mayaId, start, 1, "Messaging");
        var checkIns = await Step3EnrollAsync(owner, mayaId, start, 2, "CheckIns");
        var chat = await StartChatAsync(owner, mayaId);
        await SendChatAsync(maya, chat, "See you next week.");
        await B4aAssignAsync(owner, mayaId, version.Id, start);
        await B4aSendAsync(maya, await B4aAssignAsync(owner, mayaId, version.Id, start.AddDays(1)), version);

        // Two days on, messaging is in today's plan: the overdue check-in's Remind opens the chat, where her message waits.
        RequiredTestClock.Advance(TimeSpan.FromDays(2));
        var row = await B4aRowAsync(owner, mayaId);
        var overdue = row.AttentionItems.Single(item => item.Kind == CoachAttentionKind.CheckInOverdue);
        Assert.AreEqual((true, (Guid?)chat), (overdue.CanMessage, overdue.SubjectId));
        Assert.AreEqual((Guid?)chat, row.AttentionItems.Single(item => item.Kind == CoachAttentionKind.UnreadMessages).SubjectId);

        // A week on, messaging has run out and today's plan has check-ins alone. The chat is still there, but nothing
        // offers it: no item may message her, the overdue check-in has no chat for Remind (the screen links to her
        // check-ins instead), and her unread message is not counted (CLI-013, CHK-015).
        RequiredTestClock.Advance(TimeSpan.FromDays(5));
        row = await B4aRowAsync(owner, mayaId);
        CollectionAssert.AreEqual(new[] { CoachingFeature.CheckIns }, row.FeaturesToday.ToArray());
        var page = await ReadSliceAsync<ClientProfileOverviewView>(owner, R33bOverviewUrl(mayaId));
        var today = await ReadSliceAsync<CoachTodayView>(owner, CoachTodayUrl);
        var kinds = new[] { CoachAttentionKind.CheckInToReview, CoachAttentionKind.PlanEndingSoon, CoachAttentionKind.CheckInOverdue };
        foreach (var items in new[] { row.AttentionItems, page.Attention, today.Attention })
        {
            CollectionAssert.AreEqual(kinds, items.Select(item => item.Kind).ToArray());
            Assert.IsFalse(items.Any(item => item.CanMessage), "Messaging is not in today's plan.");
            overdue = items.Single(item => item.Kind == CoachAttentionKind.CheckInOverdue);
            Assert.AreEqual((1, (DateOnly?)start, (Guid?)null), (overdue.Count, overdue.Date, overdue.SubjectId));
        }

        Assert.AreEqual((Guid?)checkIns.Id, row.AttentionItems.Single(item => item.Kind == CoachAttentionKind.PlanEndingSoon).SubjectId);
        await B4aAssertNowhereAsync(owner, mayaId, chat, "a chat today's plan does not cover is offered nowhere.");
    }

    [TestMethod]
    public async Task B4aABlockedClientsRowHasNoOverdueCheckInLastCheckInRemindOrFeatures()
    {
        var start = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b4a-blocked-owner@example.test", "Hicham Haddad", "B4a Blocked");
        var form = await Phase6CreateFormAsync(owner, "Weekly check-in", Phase6ShortText("How was your week?"));
        var version = await Phase6PublishAsync(owner, form.Form.Id, form.Versions[0]);

        // Maya's plan has check-ins and messaging, and she has a chat with the owner. She sends one check-in at once
        // and leaves the one due today; two days on, Remind opens the chat and the row says when she last sent one.
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(owner, maya, tenant, "b4a-blocked-maya@example.test", "Maya", "Rahman");
        await Phase6EnrollAsync(owner, mayaId, "B4a check-ins and chat", "CheckIns", "Messaging");
        var chat = await StartChatAsync(owner, mayaId);
        await B4aAssignAsync(owner, mayaId, version.Id, start);
        await B4aSendAsync(maya, await B4aAssignAsync(owner, mayaId, version.Id, start.AddDays(1)), version);
        RequiredTestClock.Advance(TimeSpan.FromDays(2));
        var row = await B4aRowAsync(owner, mayaId);
        Assert.IsNotNull(row.LastCheckInSentAtUtc);
        CollectionAssert.AreEqual(new[] { CoachingFeature.CheckIns, CoachingFeature.Messaging }, row.FeaturesToday.ToArray());
        var overdue = row.AttentionItems.Single(item => item.Kind == CoachAttentionKind.CheckInOverdue);
        Assert.AreEqual((true, (Guid?)chat), (overdue.CanMessage, overdue.SubjectId));

        // Blocked in this workspace (SUB-009), her plan grants nothing today, so nothing of her check-ins or chat is
        // read: no overdue check-in, no last check-in, no Remind, and no feature.
        await B4aSetBlockedAsync(owner, mayaId, blocked: true);
        row = await B4aRowAsync(owner, mayaId);
        Assert.AreEqual((ClientPlanState.Blocked, (DateTimeOffset?)null, (CoachActivityKind?)null),
            (row.PlanState, row.LastCheckInSentAtUtc, row.LastActivityKind));
        Assert.IsEmpty(row.FeaturesToday);
        Assert.IsEmpty(row.AttentionItems);
        Assert.IsEmpty(await B4aOverdueAsync(owner));
        await B4aAssertNowhereAsync(owner, mayaId, chat, "a blocked client's chat is offered nowhere.");

        // Unblocked, all of it is back as it was: a block changes no plan and no check-in (SUB-010).
        await B4aSetBlockedAsync(owner, mayaId, blocked: false);
        row = await B4aRowAsync(owner, mayaId);
        Assert.IsNotNull(row.LastCheckInSentAtUtc);
        overdue = row.AttentionItems.Single(item => item.Kind == CoachAttentionKind.CheckInOverdue);
        Assert.AreEqual((true, (Guid?)chat, (DateOnly?)start), (overdue.CanMessage, overdue.SubjectId, overdue.Date));
    }

    // ---------- B4a helpers ----------

    private static async Task<IReadOnlyList<CoachAttentionItemView>> B4aOverdueAsync(HttpClient coach) =>
        [.. (await ReadSliceAsync<CoachTodayView>(coach, CoachTodayUrl)).Attention
            .Where(item => item.Kind == CoachAttentionKind.CheckInOverdue)];

    private static async Task<ClientOverviewRow> B4aRowAsync(HttpClient coach, Guid clientId) =>
        (await ReadSliceAsync<ClientOverviewView>(coach, ClientOverviewUrl)).Clients
            .Single(row => row.Client.ClientProfileId == clientId);

    /// <summary>Reads one view and counts the SQL commands it took, sign-in and tenant checks included.</summary>
    private async Task<(int Queries, T View)> B4aMeasureAsync<T>(HttpClient caller, string url, string label)
    {
        RequiredTodayQueryCounter.Reset();
        var view = await ReadSliceAsync<T>(caller, url);
        var queries = RequiredTodayQueryCounter.Count;
        Console.WriteLine($"B4a {label}: {queries} SQL commands.");
        return (queries, view);
    }

    private static async Task<Guid> B4aAssignAsync(HttpClient coach, Guid clientId, Guid versionId, DateOnly dueDate)
    {
        var response = await Phase6AssignAsync(coach, clientId, versionId, dueDate);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return (await RequiredJsonAsync<Phase6AssignmentDetail>(response)).Assignment.Id;
    }

    /// <summary>The client answers the form's one question and sends it.</summary>
    private static async Task B4aSendAsync(HttpClient client, Guid assignmentId, Phase6Version version)
    {
        var question = Phase6QuestionOfType(version, "ShortText");
        var draft = await RequiredJsonAsync<Phase6ResponseDetail>(
            await Phase6SaveDraftAsync(client, assignmentId, [Phase6TextAnswer(question.Id, "A good week.")]));
        await AssertStatusAsync(await Phase6SubmitAsync(client, assignmentId, draft.Response!.Version), HttpStatusCode.OK);
    }

    /// <summary>A plan of <paramref name="weeks"/> weeks with these features at a price in USD, from today, paid in full.</summary>
    private static async Task<ClientEnrollmentView> B4aPaidPlanAsync(
        HttpClient coach,
        Guid clientId,
        string name,
        decimal price,
        int weeks,
        params string[] features)
    {
        var product = await B4aProductAsync(coach, name, B4aOfferRequest(weeks, price, "USD", features));
        var plan = await A7EnrollAsync(coach, clientId, product.Offers[0].Id, TenantToday());
        return await A7PayAsync(coach, plan.Id, price, TenantToday(), Guid.NewGuid());
    }

    /// <summary>A price option of <paramref name="weeks"/> weeks with these features, as the plan editor sends one.</summary>
    private static object B4aOfferRequest(int weeks, decimal price, string currency, params string[] features) => new
    {
        label = $"{weeks} weeks",
        durationCount = weeks,
        durationUnit = "Week",
        priceAmount = price,
        priceCurrency = currency,
        features = features.Select(feature => new { feature, allowsConcurrentCoverage = false }).ToArray(),
    };

    /// <summary>A plan for sale with this one price option.</summary>
    private static async Task<CoachingProductView> B4aProductAsync(HttpClient coach, string name, object offer)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync(A7ProductsUrl, new { name, description = (string?)null, initialOffer = offer });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<CoachingProductView>(response);
    }

    /// <summary>Adds a price option to a plan for sale and returns the new option's id.</summary>
    private static async Task<Guid> B4aAddOfferAsync(HttpClient coach, CoachingProductView product, object offer)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync($"{A7ProductsUrl}/{product.Id}/offers", offer);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return (await ReadSlicePayloadAsync<CoachingProductView>(response)).Offers
            .Single(item => product.Offers.All(existing => existing.Id != item.Id)).Id;
    }

    /// <summary>Records a plan's whole price as received today, in the plan's own currency (SUB-008).</summary>
    private async Task<ClientEnrollmentView> B4aPayInFullAsync(HttpClient coach, ClientEnrollmentView plan)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync($"/api/commercial/enrollments/{plan.Id}/payments", new
        {
            amount = plan.PriceAmount,
            currencyCode = plan.PriceCurrency,
            receivedOn = Phase6WorkspaceToday(),
            method = "Cash",
            reference = (string?)null,
            note = (string?)null,
            idempotencyKey = Guid.NewGuid(),
        });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<ClientEnrollmentView>(response);
    }

    /// <summary>Books a renewal on this option of the same plan for sale, from the day after the plan's last day.</summary>
    private static async Task<ClientEnrollmentView> B4aRenewAsync(HttpClient coach, ClientEnrollmentView plan, Guid offerId)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync($"/api/commercial/enrollments/{plan.Id}/renew",
            new { offerId, startDate = plan.EndDateExclusive, idempotencyKey = Guid.NewGuid() });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<ClientEnrollmentView>(response);
    }

    /// <summary>The row's plan summary in one tuple, its features in their order; fails when the row has none.</summary>
    private static (Guid EnrollmentId, string Name, string Features, int Length, ClientPlanLengthUnit Unit, decimal Price, string Currency)
        B4aPlanSummary(ClientOverviewRow row) =>
        row.Plan is { } plan
            ? (plan.EnrollmentId, plan.Name, string.Join(", ", plan.Features), plan.LengthCount, plan.LengthUnit,
                plan.PriceAmount, plan.PriceCurrency)
            : throw new AssertFailedException($"{row.Client.FirstName}'s row sums up no plan.");

    /// <summary>
    /// Puts the frozen clock at this time on this day in the workspace's zone, Asia/Beirut as every workspace here is
    /// registered, and checks that the workspace reads that day.
    /// </summary>
    private void B4aSetWorkspaceClock(DateOnly day, TimeOnly time)
    {
        var local = day.ToDateTime(time);
        var zone = TimeZoneInfo.FindSystemTimeZoneById("Asia/Beirut");
        RequiredTestClock.Set(new DateTimeOffset(local, zone.GetUtcOffset(local)).ToUniversalTime());
        Assert.AreEqual(day, Phase6WorkspaceToday(), $"The clock is on {day:yyyy-MM-dd} in the workspace.");
    }

    /// <summary>The frozen clock's day in UTC, which no read of the workspace's should go by.</summary>
    private DateOnly B4aUtcDay() => DateOnly.FromDateTime(RequiredTestClock.UtcNow.UtcDateTime);

    /// <summary>Blocks or unblocks the client in this workspace from their record (SUB-010).</summary>
    private static async Task B4aSetBlockedAsync(HttpClient coach, Guid clientId, bool blocked)
    {
        var profile = await RequiredJsonAsync<TeamClientDetails>(await coach.GetAsync($"/api/clients/{clientId}"));
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PostAsJsonAsync(
            $"/api/clients/{clientId}/relationship/{(blocked ? "block" : "unblock")}",
            new { reason = "B4a block check", profile.Version }), HttpStatusCode.OK);
    }

    /// <summary>Asserts that Coach Today, the client list and the client's page name this id nowhere in what they send.</summary>
    private static async Task B4aAssertNowhereAsync(HttpClient coach, Guid clientId, Guid hidden, string because)
    {
        foreach (var url in new[] { CoachTodayUrl, ClientOverviewUrl, R33bOverviewUrl(clientId) })
        {
            Assert.IsFalse((await coach.GetStringAsync(url)).Contains(hidden.ToString(), StringComparison.OrdinalIgnoreCase),
                $"{url}: {because}");
        }
    }

    /// <summary>
    /// A client of the owner's who touches every read of the list: a check-in and messaging plan and a training
    /// plan, a program with today's workout finished, a sent check-in and one due tomorrow, an unread message and
    /// a weigh-in. The first one's exercise and template serve the others.
    /// </summary>
    private async Task<(Guid ClientId, TrainingResources Training)> B4aBusyClientAsync(
        HttpClient owner,
        HttpClient client,
        Guid tenant,
        string name,
        Phase6Version version,
        TrainingResources? training,
        DateOnly today)
    {
        var clientId = await R31InviteAsync(owner, client, tenant, $"b4a-queries-{name}@example.test", name, "Busy");
        await Phase6EnrollAsync(owner, clientId, "B4a check-ins and chat", "CheckIns", "Messaging");
        training = training is null
            ? await CreateTrainingResourcesAsync(owner, clientId, 8, 3, today)
            : training with
            {
                Enrollment = await CreateTrainingEnrollmentAsync(owner, clientId, today, 8),
                Max = await RecordWorkingMaxAsync(owner, clientId, training.Exercise.Id, 100m),
            };
        await AssignAsync(owner, clientId, training, today);
        await R25bFinishTodaysWorkoutAsync(client, 80m);
        var sent = await B4aAssignAsync(owner, clientId, version.Id, today);
        await B4aSendAsync(client, sent, version);
        await B4aAssignAsync(owner, clientId, version.Id, today.AddDays(1));
        var chat = await StartChatAsync(owner, clientId);
        await SendChatAsync(client, chat, "Done for today.");
        await R31WeighInAsync(client, today, 70m);
        return (clientId, training);
    }
}
