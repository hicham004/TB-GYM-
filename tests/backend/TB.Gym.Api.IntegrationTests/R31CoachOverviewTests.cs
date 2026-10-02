using System.Net;
using System.Net.Http.Json;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Training;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// R3.1: Coach Today and the client list. Both read only the caller's own clients (a Coach theirs, the
/// Owner all), never a former client, never another coach's chat, and nothing of a feature the
/// client's plan does not include. Training templates hold one session per week, on the week's first
/// day, so a block started today has sessions on today, today + 7 and today + 14.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string CoachTodayUrl = "/api/coach-today";
    private const string ClientOverviewUrl = "/api/clients/overview";

    [TestMethod]
    public async Task R31TodayAndTheListShowWhatWaitsForTheCoachAndWhatClientsDid()
    {
        var today = TenantToday();
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "r31-today-coach@example.test", "Hicham Haddad", "R31 Today");

        // Maya trains today, sets a record, then weighs in.
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(coach, maya, tenant, "r31-today-maya@example.test", "Maya", "Rahman");
        var resources = await CreateTrainingResourcesAsync(coach, mayaId, 8, 3, today);
        await AssignAsync(coach, mayaId, resources, today);
        var workoutId = await R25bFinishTodaysWorkoutAsync(maya, 80m);
        R31Tick();
        await R31WeighInAsync(maya, today, 64.2m);

        // Nour has training in her plan but no program; Omar writes twice; Sara sends a check-in.
        using var nour = CreateClient();
        var nourId = await R31InviteAsync(coach, nour, tenant, "r31-today-nour@example.test", "Nour", "Fares");
        await GrantFreeFeaturesAsync(coach, nourId, "Training");
        using var omar = CreateClient();
        var omarId = await R31InviteAsync(coach, omar, tenant, "r31-today-omar@example.test", "Omar", "Nasser");
        await GrantFreeFeaturesAsync(coach, omarId, "Messaging");
        var chatId = await StartChatAsync(coach, omarId);
        await SendChatAsync(omar, chatId, "Can we move Friday?");
        await SendChatAsync(omar, chatId, "Morning works too.");
        using var sara = CreateClient();
        var saraId = await R31InviteAsync(coach, sara, tenant, "r31-today-sara@example.test", "Sara", "Khoury");
        R31Tick();
        var checkIn = await R31SubmitCheckInAsync(coach, sara, saraId);

        RequiredTodayQueryCounter.Reset();
        var view = await ReadSliceAsync<CoachTodayView>(coach, CoachTodayUrl);
        var queries = RequiredTodayQueryCounter.Count;
        Console.WriteLine($"R3.1 Coach Today: {queries} SQL commands for 4 clients.");
        // Observed 22, sign-in and tenant checks included. A query per client would add four or more.
        Assert.IsLessThanOrEqualTo(25, queries, "Coach Today must stay a fixed number of queries.");

        Assert.AreEqual((today, "Asia/Beirut", 4, 0, 0),
            (view.Today, view.TimeZoneId, view.ClientCount, view.PlansEndingSoonCount, view.RenewalRequestCount));
        Assert.AreEqual((CoachAttentionPolicy.Key, CoachAttentionPolicy.Version, TrainingAttentionPolicy.Key,
                TrainingAttentionPolicy.Version),
            (view.AttentionRuleKey, view.AttentionRuleVersion, view.TrainingRuleKey, view.TrainingRuleVersion));
        Assert.AreEqual(
            $"CheckInToReview {saraId} 1 {checkIn.AssignmentId}, UnreadMessages {omarId} 2 {chatId}, " +
            $"NoProgram {nourId}  ",
            string.Join(", ", view.Attention.Select(item =>
                $"{item.Kind} {item.Client.ClientProfileId} {item.Count} {item.SubjectId}")));
        Assert.IsNotNull(view.Attention[0].Since);
        Assert.AreEqual(today, view.Attention[2].Date, "A client with no program shows the day they joined.");
        Assert.AreEqual("Hicham Haddad", view.Attention[0].Client.AssignedCoachName);

        // This week: Maya's one session today, done. Next week's session is not this week's.
        Assert.AreEqual(DayOfWeek.Monday, view.Week.From.DayOfWeek);
        Assert.AreEqual((7, 1, 1), (view.Week.Days.Count, view.Week.Scheduled, view.Week.Completed));
        var todayCount = view.Week.Days.Single(day => day.Date == today);
        Assert.AreEqual((1, 1), (todayCount.Scheduled, todayCount.Completed));

        // Newest first; Maya's weigh-in is her last activity in the list, never a line of the feed.
        Assert.AreEqual("CheckInSubmitted, WorkoutCompleted", string.Join(", ", view.Activity.Select(item => item.Kind)));
        var workout = view.Activity[1];
        Assert.AreEqual((mayaId, workoutId, "Squat day 1"), (workout.Client.ClientProfileId, workout.SubjectId, workout.Title));
        Assert.IsNotNull(workout.DurationSeconds);
        var record = workout.PersonalRecords.Single();
        Assert.AreEqual(("Scenario squat", 5, 80m, CoachActivityLoadUnit.Kilogram),
            (record.ExerciseName, record.Repetitions, record.Load, record.Unit));
        Assert.AreEqual(("Weekly check-in", checkIn.AssignmentId), (view.Activity[0].Title, view.Activity[0].SubjectId));

        var list = await ReadSliceAsync<ClientOverviewView>(coach, ClientOverviewUrl);
        Assert.AreEqual((today, today.AddDays(-6), today.AddDays(1)), (list.Today, list.RecentFrom, list.RecentToExclusive));
        Assert.AreEqual("Fares, Khoury, Nasser, Rahman", string.Join(", ", list.Clients.Select(row => row.Client.LastName)));
        var mayaRow = list.Clients.Single(row => row.Client.ClientProfileId == mayaId);
        Assert.AreEqual((ClientOverviewStatus.OnTrack, ClientPlanState.Running, today.AddDays(55), true, today),
            (mayaRow.Status, mayaRow.PlanState, mayaRow.PlanEndsOn, mayaRow.IsNew, mayaRow.JoinedOn));
        Assert.IsEmpty(mayaRow.Attention);
        Assert.AreEqual(CoachActivityKind.WeighInLogged, mayaRow.LastActivityKind);
        var recent = mayaRow.RecentSessions ?? throw new AssertFailedException("Maya's plan includes training.");
        Assert.AreEqual((7, today.AddDays(-6)), (recent.Count, recent[0].Date));
        Assert.AreEqual((today, 1, 1), (recent[6].Date, recent[6].Scheduled, recent[6].Completed));
        Assert.AreEqual(0, recent.Take(6).Sum(day => day.Scheduled));

        var nourRow = list.Clients.Single(row => row.Client.ClientProfileId == nourId);
        Assert.AreEqual(ClientOverviewStatus.NeedsAttention, nourRow.Status);
        CollectionAssert.AreEqual(new[] { CoachAttentionKind.NoProgram }, nourRow.Attention.ToArray());
        Assert.AreEqual(7, nourRow.RecentSessions?.Count, "Training is in Nour's plan: seven empty days.");
        Assert.IsNull(nourRow.LastActivityKind);
        var omarRow = list.Clients.Single(row => row.Client.ClientProfileId == omarId);
        CollectionAssert.AreEqual(new[] { CoachAttentionKind.UnreadMessages }, omarRow.Attention.ToArray());
        Assert.IsNull(omarRow.RecentSessions, "Training is not in Omar's plan.");
        var saraRow = list.Clients.Single(row => row.Client.ClientProfileId == saraId);
        Assert.AreEqual((ClientOverviewStatus.NeedsAttention, CoachActivityKind.CheckInSubmitted),
            (saraRow.Status, saraRow.LastActivityKind));

        // Reviewing the check-in takes it off the queue.
        await AssertStatusAsync(
            await Phase6ReviewAsync(coach, saraId, checkIn.AssignmentId, checkIn.Version), HttpStatusCode.OK);
        view = await ReadSliceAsync<CoachTodayView>(coach, CoachTodayUrl);
        Assert.IsFalse(view.Attention.Any(item => item.Kind == CoachAttentionKind.CheckInToReview));
        list = await ReadSliceAsync<ClientOverviewView>(coach, ClientOverviewUrl);
        Assert.AreEqual(ClientOverviewStatus.OnTrack,
            list.Clients.Single(row => row.Client.ClientProfileId == saraId).Status);
    }

    [TestMethod]
    public async Task R31MissedSessionsAnUnsharedWeekAndAnEndingPlanFollowTheCalendar()
    {
        var start = TenantToday();
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "r31-calendar-coach@example.test", "Hicham Haddad", "R31 Calendar");
        using var client = CreateClient();
        var clientId = await R31InviteAsync(coach, client, tenant, "r31-calendar-client@example.test", "Omar", "Nasser");
        var resources = await CreateTrainingResourcesAsync(coach, clientId, 3, 3, start);
        var block = await AssignAsync(coach, clientId, resources, start);
        await R31ShareWeekAsync(coach, block.Id, 3, false);

        // Day 12: weeks 1 and 2 passed untouched, week 3 starts in two days unshared, and the plan's
        // last day is day 20.
        RequiredTestClock.Advance(TimeSpan.FromDays(12));
        var view = await ReadSliceAsync<CoachTodayView>(coach, CoachTodayUrl);
        Assert.AreEqual(start.AddDays(12), view.Today);
        Assert.AreEqual(
            $"PlanEndingSoon {start.AddDays(20)}  {resources.Enrollment.Id}, " +
            $"WeekNotShared {start.AddDays(14)} 3 {block.Id}, MissedSessions  2 ",
            string.Join(", ", view.Attention.Select(item =>
                $"{item.Kind} {item.Date} {item.WeekNumber ?? item.Count} {item.SubjectId}")));
        Assert.AreEqual(1, view.PlansEndingSoonCount);
        var row = (await ReadSliceAsync<ClientOverviewView>(coach, ClientOverviewUrl)).Clients.Single();
        Assert.AreEqual((ClientOverviewStatus.NeedsAttention, start.AddDays(20)), (row.Status, row.PlanEndsOn));
        var lastSeven = row.RecentSessions ?? throw new AssertFailedException("Training is in the plan.");
        Assert.AreEqual((1, 0), (lastSeven.Sum(day => day.Scheduled), lastSeven.Sum(day => day.Completed)),
            "Week 2's session falls in the last seven days, missed.");

        // Sharing week 3 and training on its first day clears everything but the plan's end.
        await R31ShareWeekAsync(coach, block.Id, 3, true);
        RequiredTestClock.Advance(TimeSpan.FromDays(2));
        await R25bFinishTodaysWorkoutAsync(client, 82.5m);
        view = await ReadSliceAsync<CoachTodayView>(coach, CoachTodayUrl);
        Assert.AreEqual(CoachAttentionKind.PlanEndingSoon, view.Attention.Single().Kind);
        var day14 = view.Week.Days.Single(day => day.Date == start.AddDays(14));
        Assert.AreEqual((1, 1), (day14.Scheduled, day14.Completed));
        row = (await ReadSliceAsync<ClientOverviewView>(coach, ClientOverviewUrl)).Clients.Single();
        Assert.AreEqual(ClientOverviewStatus.EndingSoon, row.Status);
        Assert.AreEqual((start.AddDays(14), 1, 1),
            (row.RecentSessions![6].Date, row.RecentSessions[6].Scheduled, row.RecentSessions[6].Completed));
    }

    [TestMethod]
    public async Task R31ACoachSeesOnlyTheirClientsAndTheOwnerNeverAnotherCoachsChat()
    {
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "r31-scope-owner@example.test", "Hicham Haddad", "R31 Scope");
        using var coach = CreateClient();
        var coachUserId = await JoinAsCoachAsync(owner, coach, "r31-scope-coach@example.test", "Lina Saad");
        using var ownersClient = CreateClient();
        var ramiId = await R31InviteAsync(owner, ownersClient, tenant, "r31-scope-rami@example.test", "Rami", "Khoury");
        using var coachsClient = CreateClient();
        var nourId = await R31InviteAsync(coach, coachsClient, tenant, "r31-scope-nour@example.test", "Nour", "Fares");
        await GrantFreeFeaturesAsync(owner, ramiId, "Messaging");
        await GrantFreeFeaturesAsync(coach, nourId, "Messaging");
        var ownerChat = await StartChatAsync(owner, ramiId);
        await SendChatAsync(ownersClient, ownerChat, "Hello Hicham");
        var coachChat = await StartChatAsync(coach, nourId);
        await SendChatAsync(coachsClient, coachChat, "Hello Lina");

        // The coach sees their own client and their own chat, and nothing of the owner's client.
        var coachView = await ReadSliceAsync<CoachTodayView>(coach, CoachTodayUrl);
        Assert.AreEqual(1, coachView.ClientCount);
        var waiting = coachView.Attention.Single();
        Assert.AreEqual((CoachAttentionKind.UnreadMessages, nourId, coachChat, coachUserId, "Lina Saad"),
            (waiting.Kind, waiting.Client.ClientProfileId, waiting.SubjectId, waiting.Client.AssignedCoachUserId,
                waiting.Client.AssignedCoachName));
        var coachList = await ReadSliceAsync<ClientOverviewView>(coach, ClientOverviewUrl);
        Assert.AreEqual(nourId, coachList.Clients.Single().Client.ClientProfileId);
        foreach (var url in new[] { CoachTodayUrl, ClientOverviewUrl })
        {
            var raw = await coach.GetStringAsync(url);
            Assert.IsFalse(raw.Contains(ramiId.ToString(), StringComparison.OrdinalIgnoreCase), url);
            Assert.IsFalse(raw.Contains(ownerChat.ToString(), StringComparison.OrdinalIgnoreCase), url);
        }

        // The owner sees every client with their coach, but only their own chat's unread messages.
        var ownerView = await ReadSliceAsync<CoachTodayView>(owner, CoachTodayUrl);
        Assert.AreEqual(2, ownerView.ClientCount);
        var ownerWaiting = ownerView.Attention.Single();
        Assert.AreEqual((ramiId, ownerChat), (ownerWaiting.Client.ClientProfileId, ownerWaiting.SubjectId));
        Assert.IsFalse((await owner.GetStringAsync(CoachTodayUrl)).Contains(coachChat.ToString(), StringComparison.OrdinalIgnoreCase));
        var ownerList = await ReadSliceAsync<ClientOverviewView>(owner, ClientOverviewUrl);
        Assert.AreEqual("Fares, Khoury", string.Join(", ", ownerList.Clients.Select(row => row.Client.LastName)));
        var coachsRow = ownerList.Clients.Single(row => row.Client.ClientProfileId == nourId);
        Assert.AreEqual((coachUserId, ClientOverviewStatus.OnTrack), (coachsRow.Client.AssignedCoachUserId, coachsRow.Status));
        Assert.IsEmpty(coachsRow.Attention, "Lina's unread chat is hers alone.");

        // Nobody signed out, and no client, can read either view.
        using var anonymous = CreateClient();
        SetTenant(anonymous, tenant);
        foreach (var url in new[] { CoachTodayUrl, ClientOverviewUrl })
        {
            await AssertStatusAsync(await anonymous.GetAsync(url), HttpStatusCode.Unauthorized);
            await AssertStatusAsync(await ownersClient.GetAsync(url), HttpStatusCode.Forbidden);
        }

        // Another workspace's owner sees an empty workspace of their own, and is refused this one.
        using var stranger = CreateClient();
        await RegisterCoachAsync(stranger, "r31-scope-stranger@example.test", "Other Owner", "R31 Elsewhere");
        var strangerView = await ReadSliceAsync<CoachTodayView>(stranger, CoachTodayUrl);
        Assert.AreEqual((0, 0), (strangerView.ClientCount, strangerView.Attention.Count));
        Assert.IsEmpty((await ReadSliceAsync<ClientOverviewView>(stranger, ClientOverviewUrl)).Clients);
        SetTenant(stranger, tenant);
        foreach (var url in new[] { CoachTodayUrl, ClientOverviewUrl })
        {
            await AssertStatusAsync(await stranger.GetAsync(url), HttpStatusCode.Forbidden);
        }

        // A released client leaves both views, and their chat with them.
        var details = await RequiredJsonAsync<TeamClientDetails>(await owner.GetAsync($"/api/clients/{ramiId}"));
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync($"/api/clients/{ramiId}/release", new { reason = "Moved away", version = details.Version }),
            HttpStatusCode.OK);
        ownerView = await ReadSliceAsync<CoachTodayView>(owner, CoachTodayUrl);
        Assert.AreEqual((1, 0), (ownerView.ClientCount, ownerView.Attention.Count));
        foreach (var url in new[] { CoachTodayUrl, ClientOverviewUrl })
        {
            Assert.IsFalse((await owner.GetStringAsync(url)).Contains(ramiId.ToString(), StringComparison.OrdinalIgnoreCase), url);
        }
    }

    [TestMethod]
    public async Task R31ABlockOrALapsedPlanHidesTrainingAndARenewalRequestTakesItsPlace()
    {
        var today = TenantToday();
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "r31-lapse-coach@example.test", "Hicham Haddad", "R31 Lapse");
        using var client = CreateClient();
        var clientId = await R31InviteAsync(coach, client, tenant, "r31-lapse-client@example.test", "Maya", "Rahman");
        var resources = await CreateTrainingResourcesAsync(coach, clientId, 1, 1, today);
        await AssignAsync(coach, clientId, resources, today);
        await R31WeighInAsync(client, today, 64.2m);
        R31Tick();
        await R25bFinishTodaysWorkoutAsync(client, 80m);

        // Finishing the only session finishes the program; the one-week plan ends on day 6.
        var row = (await ReadSliceAsync<ClientOverviewView>(coach, ClientOverviewUrl)).Clients.Single();
        Assert.AreEqual((ClientPlanState.Running, CoachActivityKind.WorkoutCompleted, today.AddDays(6)),
            (row.PlanState, row.LastActivityKind, row.PlanEndsOn));
        CollectionAssert.AreEqual(
            new[] { CoachAttentionKind.PlanEndingSoon, CoachAttentionKind.NoProgram }, row.Attention.ToArray());

        // A blocked relationship closes everything, the weigh-in included (ADR 0009).
        var profile = await RequiredJsonAsync<TeamClientDetails>(await coach.GetAsync($"/api/clients/{clientId}"));
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PostAsJsonAsync($"/api/clients/{clientId}/relationship/block",
            new { reason = "R3.1 privacy check", profile.Version }), HttpStatusCode.OK);
        row = (await ReadSliceAsync<ClientOverviewView>(coach, ClientOverviewUrl)).Clients.Single();
        Assert.AreEqual((ClientPlanState.Blocked, ClientOverviewStatus.NoActivePlan), (row.PlanState, row.Status));
        Assert.IsNull(row.LastActivityKind);
        Assert.IsNull(row.RecentSessions);
        Assert.IsEmpty(row.Attention);
        var view = await ReadSliceAsync<CoachTodayView>(coach, CoachTodayUrl);
        Assert.IsEmpty(view.Activity);
        Assert.IsEmpty(view.Attention);
        Assert.AreEqual(0, view.Week.Scheduled);

        profile = await RequiredJsonAsync<TeamClientDetails>(await coach.GetAsync($"/api/clients/{clientId}"));
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PostAsJsonAsync($"/api/clients/{clientId}/relationship/unblock",
            new { reason = "R3.1 privacy check done", profile.Version }), HttpStatusCode.OK);
        view = await ReadSliceAsync<CoachTodayView>(coach, CoachTodayUrl);
        Assert.AreEqual(CoachActivityKind.WorkoutCompleted, view.Activity.Single().Kind);
        row = (await ReadSliceAsync<ClientOverviewView>(coach, ClientOverviewUrl)).Clients.Single();
        Assert.AreEqual(CoachActivityKind.WorkoutCompleted, row.LastActivityKind);

        // After the plan runs out, training is no longer read, but the weigh-in still is.
        RequiredTestClock.Advance(TimeSpan.FromDays(8));
        row = (await ReadSliceAsync<ClientOverviewView>(coach, ClientOverviewUrl)).Clients.Single();
        Assert.AreEqual((ClientPlanState.Ended, ClientOverviewStatus.NoActivePlan, today.AddDays(6)),
            (row.PlanState, row.Status, row.PlanEndsOn));
        Assert.AreEqual(CoachActivityKind.WeighInLogged, row.LastActivityKind);
        Assert.IsNull(row.RecentSessions);
        Assert.IsEmpty(row.Attention);

        // The client asks to renew: the coach is asked, with the ended plan to renew.
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(await client.PostAsync("/api/client-renewal/me/requests", null), HttpStatusCode.Created);
        view = await ReadSliceAsync<CoachTodayView>(coach, CoachTodayUrl);
        var asked = view.Attention.Single();
        Assert.AreEqual((CoachAttentionKind.RenewalRequested, today.AddDays(6), resources.Enrollment.Id),
            (asked.Kind, asked.Date, asked.SubjectId));
        Assert.IsNotNull(asked.Since);
        Assert.AreEqual(1, view.RenewalRequestCount);
        Assert.AreEqual(ClientOverviewStatus.NeedsAttention,
            (await ReadSliceAsync<ClientOverviewView>(coach, ClientOverviewUrl)).Clients.Single().Status);

        // Renewing answers it.
        await Step3EnrollAsync(coach, clientId, today.AddDays(8), 4, "Training");
        view = await ReadSliceAsync<CoachTodayView>(coach, CoachTodayUrl);
        Assert.IsFalse(view.Attention.Any(item => item.Kind == CoachAttentionKind.RenewalRequested));
        Assert.AreEqual(0, view.RenewalRequestCount);
    }

    // ---------- R3.1 helpers ----------

    /// <summary>The test clock stands still, so a minute passes between actions the feed orders.</summary>
    private void R31Tick() => RequiredTestClock.Advance(TimeSpan.FromMinutes(1));

    /// <summary>Invites a named client and accepts with a new account. Returns the client profile id.</summary>
    private static async Task<Guid> R31InviteAsync(
        HttpClient sender,
        HttpClient invitee,
        Guid tenant,
        string email,
        string firstName,
        string lastName)
    {
        await RefreshCsrfAsync(sender);
        var response = await sender.PostAsJsonAsync("/api/invitations", new
        {
            email,
            firstName,
            lastName,
            phoneNumber = "+96170000000",
            birthDate = "1995-04-02",
        });
        await AssertStatusAsync(response, HttpStatusCode.Created);
        var invitation = await RequiredJsonAsync<Invitation>(response);
        await RefreshCsrfAsync(invitee);
        var acceptance = await invitee.PostAsJsonAsync("/api/invitations/accept", new
        {
            token = QueryValue(invitation.DevelopmentActionUrl!, "token"),
            displayName = $"{firstName} {lastName}",
            password = Password,
        });
        await AssertStatusAsync(acceptance, HttpStatusCode.OK);
        SetTenant(invitee, tenant);
        return (await RequiredJsonAsync<InvitationAcceptance>(acceptance)).ClientProfileId;
    }

    private static async Task R31WeighInAsync(HttpClient client, DateOnly date, decimal kilograms)
    {
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync("/api/progress/me/bodyweight",
                new { value = kilograms, unit = "Kilogram", measurementDate = date }),
            HttpStatusCode.OK);
    }

    /// <summary>A check-in plan, a one-question form, an assignment, and the client's submitted answer.</summary>
    private async Task<(Guid AssignmentId, uint Version)> R31SubmitCheckInAsync(
        HttpClient coach,
        HttpClient client,
        Guid clientId)
    {
        await Phase6EnrollAsync(coach, clientId, "Check-in coaching", "CheckIns");
        var form = await Phase6CreateFormAsync(coach, "Weekly check-in", Phase6ShortText("How was your week?"));
        var version = await Phase6PublishAsync(coach, form.Form.Id, form.Versions[0]);
        var assignment = await RequiredJsonAsync<Phase6AssignmentDetail>(
            await Phase6AssignAsync(coach, clientId, version.Id, Phase6WorkspaceToday().AddDays(2)));
        var question = Phase6QuestionOfType(version, "ShortText");
        var draft = await RequiredJsonAsync<Phase6ResponseDetail>(await Phase6SaveDraftAsync(
            client,
            assignment.Assignment.Id,
            [Phase6TextAnswer(question.Id, "A good week.")]));
        var submitted = await Phase6SubmitAsync(client, assignment.Assignment.Id, draft.Response!.Version);
        await AssertStatusAsync(submitted, HttpStatusCode.OK);
        return (assignment.Assignment.Id, (await RequiredJsonAsync<Phase6ResponseDetail>(submitted)).Response!.Version);
    }

    private static async Task R31ShareWeekAsync(HttpClient coach, Guid blockId, int weekNumber, bool isPublished)
    {
        var block = await ReadSliceAsync<TrainingMesocycleView>(coach, $"/api/training/mesocycles/{blockId}");
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PutAsJsonAsync(
            $"/api/training/mesocycles/{blockId}/weeks/{block.Weeks.Single(week => week.WeekNumber == weekNumber).Id}/publish",
            new { isPublished, block.Version }), HttpStatusCode.OK);
    }
}
