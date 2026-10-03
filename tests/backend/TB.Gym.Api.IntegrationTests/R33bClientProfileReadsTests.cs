using System.Net;
using System.Net.Http.Json;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Training;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// R3.3b: the two reads behind a client's page. A coach reads their client's personal records by the
/// rule the client sees (TRN-019), and one client's status, attention and week come from the same
/// reader as Today and the list (CLI-018), so the page can never disagree with them. Both answer
/// another coach's client, another workspace's client and an unknown one with 404.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private static string R33bRecordsUrl(Guid clientId) => $"/api/training/clients/{clientId}/personal-records";

    private static string R33bOverviewUrl(Guid clientId) => $"/api/clients/{clientId}/overview";

    [TestMethod]
    public async Task R33bACoachReadsTheirClientsRecordsByTheRuleTheClientSees()
    {
        var today = TenantToday();
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "r33b-records-coach@example.test", "Hicham Haddad", "R33b Records");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(coach, maya, tenant, "r33b-records-maya@example.test", "Maya", "Rahman");
        var resources = await CreateTrainingResourcesAsync(coach, mayaId, 8, 3, today);
        await AssignAsync(coach, mayaId, resources, today);

        // Nothing lifted yet: the read answers, with no records.
        var none = await ReadSliceAsync<ClientPersonalRecordsResult>(coach, R33bRecordsUrl(mayaId));
        Assert.IsTrue(none.IsAllowed);
        Assert.IsEmpty(none.Items);

        // 80 kg for five today, then 85 kg a week later: the heavier set is the record for five reps.
        await R25bFinishTodaysWorkoutAsync(maya, 80m);
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        await R25bFinishTodaysWorkoutAsync(maya, 85m);

        var seen = await ReadSliceAsync<ClientPersonalRecordsResult>(coach, R33bRecordsUrl(mayaId));
        var own = await ReadSliceAsync<ClientPersonalRecordsResult>(maya, "/api/training/me/personal-records");
        Assert.IsTrue(seen.IsAllowed);
        var record = seen.Items.Single();
        Assert.AreEqual(("Scenario squat", 5, 85m, TrainingLoadUnit.Kilogram, today.AddDays(7)),
            (record.ExerciseName, record.Repetitions, record.Load, record.Unit, record.Date));
        Assert.AreEqual(
            (WorkoutPersonalRecordRule.Key, WorkoutPersonalRecordRule.Version),
            (record.RuleKey, record.RuleVersion));
        Assert.AreEqual(own.Items.Single(), record, "The coach and the client read one list by one rule.");
    }

    [TestMethod]
    public async Task R33bCoachRecordsAreScopedToTheCallersClientsAndTheClientsPlan()
    {
        var today = TenantToday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "r33b-scope-owner@example.test", "Hicham Haddad", "R33b Scope");
        using var coach = CreateClient();
        await JoinAsCoachAsync(owner, coach, "r33b-scope-coach@example.test", "Lina Saad");
        using var ownersClient = CreateClient();
        var ramiId = await R31InviteAsync(owner, ownersClient, tenant, "r33b-scope-rami@example.test", "Rami", "Khoury");
        var resources = await CreateTrainingResourcesAsync(owner, ramiId, 8, 3, today);
        await AssignAsync(owner, ramiId, resources, today);
        await R25bFinishTodaysWorkoutAsync(ownersClient, 100m);
        using var coachsClient = CreateClient();
        var nourId = await R31InviteAsync(coach, coachsClient, tenant, "r33b-scope-nour@example.test", "Nour", "Fares");

        // The owner reads any client's records; the coach reads only their own client's.
        var ownerRead = await ReadSliceAsync<ClientPersonalRecordsResult>(owner, R33bRecordsUrl(ramiId));
        Assert.AreEqual(100m, ownerRead.Items.Single().Load);
        var coachOwn = await ReadSliceAsync<ClientPersonalRecordsResult>(coach, R33bRecordsUrl(nourId));
        Assert.IsFalse(coachOwn.IsAllowed, "Nour's plan has no training.");
        Assert.AreEqual("NoEntitlement", coachOwn.AccessReason);
        Assert.IsEmpty(coachOwn.Items);

        // Another coach's client answers exactly as an unknown one: 404, and nothing of the record.
        var other = await coach.GetAsync(R33bRecordsUrl(ramiId));
        await AssertStatusAsync(other, HttpStatusCode.NotFound);
        Assert.IsFalse((await other.Content.ReadAsStringAsync()).Contains("Scenario squat", StringComparison.Ordinal));
        await AssertStatusAsync(await coach.GetAsync(R33bRecordsUrl(Guid.NewGuid())), HttpStatusCode.NotFound);

        // Nobody signed out, and no client, can read it.
        using var anonymous = CreateClient();
        SetTenant(anonymous, tenant);
        await AssertStatusAsync(await anonymous.GetAsync(R33bRecordsUrl(ramiId)), HttpStatusCode.Unauthorized);
        await AssertStatusAsync(await ownersClient.GetAsync(R33bRecordsUrl(ramiId)), HttpStatusCode.Forbidden);

        // Another workspace's owner is refused this one, and finds nothing of it in their own.
        using var stranger = CreateClient();
        var strangerTenant = await RegisterCoachAsync(stranger, "r33b-scope-stranger@example.test", "Other Owner", "R33b Elsewhere");
        await AssertStatusAsync(await stranger.GetAsync(R33bRecordsUrl(ramiId)), HttpStatusCode.NotFound);
        SetTenant(stranger, tenant);
        await AssertStatusAsync(await stranger.GetAsync(R33bRecordsUrl(ramiId)), HttpStatusCode.Forbidden);
        SetTenant(stranger, strangerTenant);

        // A blocked relationship closes it, with the reason; unblocking opens it again (ADR 0009).
        var profile = await RequiredJsonAsync<TeamClientDetails>(await owner.GetAsync($"/api/clients/{ramiId}"));
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(await owner.PostAsJsonAsync($"/api/clients/{ramiId}/relationship/block",
            new { reason = "R3.3b privacy check", profile.Version }), HttpStatusCode.OK);
        var blocked = await ReadSliceAsync<ClientPersonalRecordsResult>(owner, R33bRecordsUrl(ramiId));
        Assert.AreEqual((false, "RelationshipBlocked", 0), (blocked.IsAllowed, blocked.AccessReason, blocked.Items.Count));
        profile = await RequiredJsonAsync<TeamClientDetails>(await owner.GetAsync($"/api/clients/{ramiId}"));
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(await owner.PostAsJsonAsync($"/api/clients/{ramiId}/relationship/unblock",
            new { reason = "R3.3b privacy check done", profile.Version }), HttpStatusCode.OK);
        Assert.IsTrue((await ReadSliceAsync<ClientPersonalRecordsResult>(owner, R33bRecordsUrl(ramiId))).IsAllowed);

        // Once the plan has run out the feature is closed for the coach too, and records are not shown.
        RequiredTestClock.Advance(TimeSpan.FromDays(57));
        var lapsed = await ReadSliceAsync<ClientPersonalRecordsResult>(owner, R33bRecordsUrl(ramiId));
        Assert.AreEqual((false, "Expired", 0), (lapsed.IsAllowed, lapsed.AccessReason, lapsed.Items.Count));

        // A released client's record is kept, but nothing of training is read for them (ADR 0027).
        profile = await RequiredJsonAsync<TeamClientDetails>(await owner.GetAsync($"/api/clients/{ramiId}"));
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(await owner.PostAsJsonAsync($"/api/clients/{ramiId}/release",
            new { reason = "Moved away", profile.Version }), HttpStatusCode.OK);
        var released = await ReadSliceAsync<ClientPersonalRecordsResult>(owner, R33bRecordsUrl(ramiId));
        Assert.AreEqual((false, 0), (released.IsAllowed, released.Items.Count));
    }

    [TestMethod]
    public async Task R33bAClientsPageReadsTheStatusAttentionAndWeekTheListAndTodayShow()
    {
        var today = TenantToday();
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "r33b-page-coach@example.test", "Hicham Haddad", "R33b Page");

        // Maya trains today and weighs in; Nour has training but no program; Omar's plan is messaging
        // only and he writes twice; Sara sends a check-in.
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(coach, maya, tenant, "r33b-page-maya@example.test", "Maya", "Rahman");
        var resources = await CreateTrainingResourcesAsync(coach, mayaId, 8, 3, today);
        await AssignAsync(coach, mayaId, resources, today);
        var workoutId = await R25bFinishTodaysWorkoutAsync(maya, 80m);
        R31Tick();
        await R31WeighInAsync(maya, today, 64.2m);
        using var nour = CreateClient();
        var nourId = await R31InviteAsync(coach, nour, tenant, "r33b-page-nour@example.test", "Nour", "Fares");
        await GrantFreeFeaturesAsync(coach, nourId, "Training");
        using var omar = CreateClient();
        var omarId = await R31InviteAsync(coach, omar, tenant, "r33b-page-omar@example.test", "Omar", "Nasser");
        await GrantFreeFeaturesAsync(coach, omarId, "Messaging");
        var chatId = await StartChatAsync(coach, omarId);
        await SendChatAsync(omar, chatId, "Can we move Friday?");
        await SendChatAsync(omar, chatId, "Morning works too.");
        using var sara = CreateClient();
        var saraId = await R31InviteAsync(coach, sara, tenant, "r33b-page-sara@example.test", "Sara", "Khoury");
        R31Tick();
        var checkIn = await R31SubmitCheckInAsync(coach, sara, saraId);

        // Each client's page reads what the list and Today already say about them.
        var list = await ReadSliceAsync<ClientOverviewView>(coach, ClientOverviewUrl);
        var queue = (await ReadSliceAsync<CoachTodayView>(coach, CoachTodayUrl)).Attention;
        foreach (var row in list.Clients)
        {
            var page = await ReadSliceAsync<ClientProfileOverviewView>(coach, R33bOverviewUrl(row.Client.ClientProfileId));
            Assert.AreEqual(
                (list.Today, row.Client, row.JoinedOn, row.IsNew, row.Status, row.PlanState, row.PlanEndsOn,
                    row.LastActivityKind, row.LastActivityAtUtc),
                (page.Today, page.Client, page.JoinedOn, page.IsNew, page.Status, page.PlanState, page.PlanEndsOn,
                    page.LastActivityKind, page.LastActivityAtUtc),
                row.Client.LastName);
            CollectionAssert.AreEqual(
                queue.Where(item => item.Client.ClientProfileId == row.Client.ClientProfileId).ToArray(),
                page.Attention.ToArray(),
                $"{row.Client.LastName}: the page lists what Today's queue lists for them, with the same targets.");
            CollectionAssert.AreEqual(row.Attention.ToArray(), page.Attention.Select(item => item.Kind).ToArray());
            Assert.AreEqual(
                (CoachAttentionPolicy.Key, CoachAttentionPolicy.Version, TrainingAttentionPolicy.Key, TrainingAttentionPolicy.Version),
                (page.AttentionRuleKey, page.AttentionRuleVersion, page.TrainingRuleKey, page.TrainingRuleVersion));
        }

        // The targets an action needs: Sara's check-in, Omar's chat, Nour's missing program.
        var saraPage = await ReadSliceAsync<ClientProfileOverviewView>(coach, R33bOverviewUrl(saraId));
        var review = saraPage.Attention.Single();
        Assert.AreEqual((CoachAttentionKind.CheckInToReview, 1, checkIn.AssignmentId), (review.Kind, review.Count, review.SubjectId));
        Assert.AreEqual((ClientOverviewStatus.NeedsAttention, CoachActivityKind.CheckInSubmitted),
            (saraPage.Status, saraPage.LastActivityKind));
        var omarPage = await ReadSliceAsync<ClientProfileOverviewView>(coach, R33bOverviewUrl(omarId));
        Assert.AreEqual((CoachAttentionKind.UnreadMessages, 2, chatId),
            (omarPage.Attention.Single().Kind, omarPage.Attention.Single().Count, omarPage.Attention.Single().SubjectId));
        Assert.IsNull(omarPage.Week, "Training is not in Omar's plan.");
        var nourPage = await ReadSliceAsync<ClientProfileOverviewView>(coach, R33bOverviewUrl(nourId));
        Assert.AreEqual(CoachAttentionKind.NoProgram, nourPage.Attention.Single().Kind);
        var nourWeek = nourPage.Week ?? throw new AssertFailedException("Training is in Nour's plan.");
        Assert.AreEqual((7, 0, 0), (nourWeek.Days.Count, nourWeek.Scheduled, nourWeek.Completed));

        // Maya's week is the workspace's calendar week, counted as Today counts it: her one session
        // today is done, and next week's session is not this week's.
        RequiredTodayQueryCounter.Reset();
        var mayaPage = await ReadSliceAsync<ClientProfileOverviewView>(coach, R33bOverviewUrl(mayaId));
        var queries = RequiredTodayQueryCounter.Count;
        Console.WriteLine($"R3.3b client page: {queries} SQL commands for 1 of 4 clients.");
        // Observed 18, sign-in and tenant checks included: a fixed number, whatever the client count.
        Assert.IsLessThanOrEqualTo(22, queries, "One client's page must stay a fixed number of queries.");
        Assert.AreEqual((ClientOverviewStatus.OnTrack, CoachActivityKind.WeighInLogged),
            (mayaPage.Status, mayaPage.LastActivityKind));
        Assert.IsEmpty(mayaPage.Attention);
        var week = mayaPage.Week ?? throw new AssertFailedException("Training is in Maya's plan.");
        Assert.AreEqual(DayOfWeek.Monday, week.From.DayOfWeek);
        Assert.AreEqual((week.From.AddDays(7), 7, 1, 1), (week.ToExclusive, week.Days.Count, week.Scheduled, week.Completed));
        var todaysCount = week.Days.Single(day => day.Date == today);
        Assert.AreEqual((1, 1), (todaysCount.Scheduled, todaysCount.Completed));
        Assert.AreNotEqual(Guid.Empty, workoutId);

        // Reviewing the check-in takes it off her page, as it does off Today.
        await AssertStatusAsync(
            await Phase6ReviewAsync(coach, saraId, checkIn.AssignmentId, checkIn.Version), HttpStatusCode.OK);
        saraPage = await ReadSliceAsync<ClientProfileOverviewView>(coach, R33bOverviewUrl(saraId));
        Assert.IsEmpty(saraPage.Attention);
        Assert.AreEqual(ClientOverviewStatus.OnTrack, saraPage.Status);
    }

    [TestMethod]
    public async Task R33bAClientsPageIsScopedHidesWhatThePlanLacksAndNeverShowsAFormerClient()
    {
        var today = TenantToday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "r33b-pagescope-owner@example.test", "Hicham Haddad", "R33b Page Scope");
        using var coach = CreateClient();
        var coachUserId = await JoinAsCoachAsync(owner, coach, "r33b-pagescope-coach@example.test", "Lina Saad");
        using var ownersClient = CreateClient();
        var ramiId = await R31InviteAsync(owner, ownersClient, tenant, "r33b-pagescope-rami@example.test", "Rami", "Khoury");
        var resources = await CreateTrainingResourcesAsync(owner, ramiId, 1, 1, today);
        await AssignAsync(owner, ramiId, resources, today);
        await R31WeighInAsync(ownersClient, today, 90m);
        R31Tick();
        await R25bFinishTodaysWorkoutAsync(ownersClient, 100m);
        using var coachsClient = CreateClient();
        var nourId = await R31InviteAsync(coach, coachsClient, tenant, "r33b-pagescope-nour@example.test", "Nour", "Fares");

        // The owner sees any client's page, naming the coach; the coach sees only their own.
        var nourForOwner = await ReadSliceAsync<ClientProfileOverviewView>(owner, R33bOverviewUrl(nourId));
        Assert.AreEqual((coachUserId, "Lina Saad"), (nourForOwner.Client.AssignedCoachUserId, nourForOwner.Client.AssignedCoachName));
        var nourForCoach = await ReadSliceAsync<ClientProfileOverviewView>(coach, R33bOverviewUrl(nourId));
        Assert.AreEqual(nourId, nourForCoach.Client.ClientProfileId);

        // Another coach's client answers as an unknown one does: 404, and nothing of them.
        var other = await coach.GetAsync(R33bOverviewUrl(ramiId));
        await AssertStatusAsync(other, HttpStatusCode.NotFound);
        Assert.IsFalse((await other.Content.ReadAsStringAsync()).Contains("Khoury", StringComparison.Ordinal));
        await AssertStatusAsync(await coach.GetAsync(R33bOverviewUrl(Guid.NewGuid())), HttpStatusCode.NotFound);

        // Nobody signed out, and no client, can read it; another workspace's owner is refused this one
        // and finds nothing of it in their own.
        using var anonymous = CreateClient();
        SetTenant(anonymous, tenant);
        await AssertStatusAsync(await anonymous.GetAsync(R33bOverviewUrl(ramiId)), HttpStatusCode.Unauthorized);
        await AssertStatusAsync(await ownersClient.GetAsync(R33bOverviewUrl(ramiId)), HttpStatusCode.Forbidden);
        using var stranger = CreateClient();
        var strangerTenant = await RegisterCoachAsync(stranger, "r33b-pagescope-stranger@example.test", "Other Owner", "R33b Elsewhere");
        await AssertStatusAsync(await stranger.GetAsync(R33bOverviewUrl(ramiId)), HttpStatusCode.NotFound);
        SetTenant(stranger, tenant);
        await AssertStatusAsync(await stranger.GetAsync(R33bOverviewUrl(ramiId)), HttpStatusCode.Forbidden);
        SetTenant(stranger, strangerTenant);

        // Finishing the only session finishes the program, and the one-week plan ends on day 6.
        var page = await ReadSliceAsync<ClientProfileOverviewView>(owner, R33bOverviewUrl(ramiId));
        Assert.AreEqual((ClientPlanState.Running, CoachActivityKind.WorkoutCompleted, today.AddDays(6)),
            (page.PlanState, page.LastActivityKind, page.PlanEndsOn));
        CollectionAssert.AreEqual(
            new[] { CoachAttentionKind.PlanEndingSoon, CoachAttentionKind.NoProgram },
            page.Attention.Select(item => item.Kind).ToArray());
        Assert.AreEqual(today.AddDays(6), page.Attention[0].Date);
        Assert.AreEqual(resources.Enrollment.Id, page.Attention[0].SubjectId);

        // A blocked relationship closes everything, the weigh-in included (ADR 0009).
        var profile = await RequiredJsonAsync<TeamClientDetails>(await owner.GetAsync($"/api/clients/{ramiId}"));
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(await owner.PostAsJsonAsync($"/api/clients/{ramiId}/relationship/block",
            new { reason = "R3.3b privacy check", profile.Version }), HttpStatusCode.OK);
        page = await ReadSliceAsync<ClientProfileOverviewView>(owner, R33bOverviewUrl(ramiId));
        Assert.AreEqual((ClientPlanState.Blocked, ClientOverviewStatus.NoActivePlan), (page.PlanState, page.Status));
        Assert.IsNull(page.LastActivityKind);
        Assert.IsNull(page.Week);
        Assert.IsEmpty(page.Attention);

        // A released client is a former client: no page is read for them.
        profile = await RequiredJsonAsync<TeamClientDetails>(await owner.GetAsync($"/api/clients/{ramiId}"));
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(await owner.PostAsJsonAsync($"/api/clients/{ramiId}/release",
            new { reason = "Moved away", profile.Version }), HttpStatusCode.OK);
        await AssertStatusAsync(await owner.GetAsync(R33bOverviewUrl(ramiId)), HttpStatusCode.NotFound);
    }
}
