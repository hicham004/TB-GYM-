using System.Net;
using System.Net.Http.Json;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Training;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The audit's batch A8, coach screens and sheets (docs/FULL-AUDIT-2026-10.md, section 11): Coach Today asks for a
/// plan for a new client who has none, and the client list says who never finished their profile (COACH-9,
/// LOST-12, the owner's decision of 2026-10-19); a client's check-ins name the newest as well as the oldest
/// (CLIENT-19); a program's history is read with the Training tab (LOST-6); and an invitation link says when it
/// stops working on the workspace's clock (COACH-6).
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task A8ANewClientWithNoPlanAsksForOneUntilAPlanStarts()
    {
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "a8-noplan-coach@example.test", "Hicham Haddad", "A8 No Plan");
        using var rita = CreateClient();
        var ritaId = await R31InviteAsync(coach, rita, tenant, "a8-noplan-rita@example.test", "Rita", "Daher");

        // Coach Today asks for a plan, on the day she joined; the list says she needs attention and is not set up.
        var today = await ReadSliceAsync<CoachTodayView>(coach, CoachTodayUrl);
        var asked = today.Attention.Single();
        Assert.AreEqual((CoachAttentionKind.NoPlan, ritaId, (DateOnly?)today.Today, (Guid?)null),
            (asked.Kind, asked.Client.ClientProfileId, asked.Date, asked.SubjectId));
        Assert.AreEqual((CoachAttentionPolicy.Key, 3), (today.AttentionRuleKey, today.AttentionRuleVersion));
        var row = await A8RowAsync(coach, ritaId);
        Assert.AreEqual(
            (ClientOverviewStatus.NeedsAttention, ClientPlanState.None, ClientOnboardingStatus.NotStarted, true),
            (row.Status, row.PlanState, row.OnboardingStatus, row.IsNew));
        CollectionAssert.AreEqual(new[] { CoachAttentionKind.NoPlan }, row.Attention.ToArray());
        var page = await ReadSliceAsync<ClientProfileOverviewView>(coach, $"/api/clients/{ritaId}/overview");
        Assert.AreEqual((CoachAttentionKind.NoPlan, ClientOverviewStatus.NeedsAttention),
            (page.Attention.Single().Kind, page.Status), "Her own page says what Today says.");

        // Rita finishes setting up her profile; the list no longer says she has not.
        await A8CompleteOnboardingAsync(rita, "Rita", "Daher");
        Assert.AreEqual(ClientOnboardingStatus.Completed, (await A8RowAsync(coach, ritaId)).OnboardingStatus);

        // A plan waiting for payment is a plan: the row goes, and she has no active plan until it is paid.
        var product = await A7ProductAsync(coach, "Online Coaching", 130m, 4, "Training");
        await A7EnrollAsync(coach, ritaId, product.Offers.Single().Id, TenantToday());
        today = await ReadSliceAsync<CoachTodayView>(coach, CoachTodayUrl);
        Assert.IsEmpty(today.Attention);
        row = await A8RowAsync(coach, ritaId);
        Assert.AreEqual((ClientOverviewStatus.NoActivePlan, ClientPlanState.PaymentDue), (row.Status, row.PlanState));
        Assert.IsEmpty(row.Attention);
    }

    [TestMethod]
    public async Task A8NoPlanAsksOnlyWhileTheClientIsNew()
    {
        var joined = R61aStartAtMidday();
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "a8-new-coach@example.test", "Hicham Haddad", "A8 New");
        using var nour = CreateClient();
        var nourId = await R31InviteAsync(coach, nour, tenant, "a8-new-nour@example.test", "Nour", "Fares");

        // Thirteen days on she is still new and still asked about.
        RequiredTestClock.Advance(TimeSpan.FromDays(13));
        var today = await ReadSliceAsync<CoachTodayView>(coach, CoachTodayUrl);
        Assert.AreEqual((joined.AddDays(13), CoachAttentionKind.NoPlan, (DateOnly?)joined),
            (today.Today, today.Attention.Single().Kind, today.Attention.Single().Date));

        // On the fourteenth day she is no longer new: no row, and the list says only that she has no active plan.
        RequiredTestClock.Advance(TimeSpan.FromDays(1));
        today = await ReadSliceAsync<CoachTodayView>(coach, CoachTodayUrl);
        Assert.AreEqual(joined.AddDays(14), today.Today);
        Assert.IsEmpty(today.Attention);
        var row = await A8RowAsync(coach, nourId);
        Assert.AreEqual((ClientOverviewStatus.NoActivePlan, ClientPlanState.None, false), (row.Status, row.PlanState, row.IsNew));
    }

    [TestMethod]
    public async Task A8SeveralCheckInsNameTheNewestAsWellAsTheOldest()
    {
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "a8-checkins-coach@example.test", "Hicham Haddad", "A8 Check-ins");
        using var sara = CreateClient();
        var saraId = await R31InviteAsync(coach, sara, tenant, "a8-checkins-sara@example.test", "Sara", "Khoury");

        // Sara sends one check-in, and a second one six days later.
        var first = await R31SubmitCheckInAsync(coach, sara, saraId);
        var firstSentAt = RequiredTestClock.UtcNow;
        RequiredTestClock.Advance(TimeSpan.FromDays(6));
        var form = await Phase6CreateFormAsync(coach, "Mid-week check-in", Phase6ShortText("How are you sleeping?"));
        var version = await Phase6PublishAsync(coach, form.Form.Id, form.Versions[0]);
        var assignment = await RequiredJsonAsync<Phase6AssignmentDetail>(
            await Phase6AssignAsync(coach, saraId, version.Id, Phase6WorkspaceToday().AddDays(1)));
        var draft = await RequiredJsonAsync<Phase6ResponseDetail>(await Phase6SaveDraftAsync(
            sara,
            assignment.Assignment.Id,
            [Phase6TextAnswer(Phase6QuestionOfType(version, "ShortText").Id, "Better.")]));
        await AssertStatusAsync(await Phase6SubmitAsync(sara, assignment.Assignment.Id, draft.Response!.Version), HttpStatusCode.OK);
        var secondSentAt = RequiredTestClock.UtcNow;

        // The oldest still ranks the item and opens the list; the newest says one just came in (CLIENT-19).
        var item = (await ReadSliceAsync<CoachTodayView>(coach, CoachTodayUrl)).Attention
            .Single(entry => entry.Kind == CoachAttentionKind.CheckInToReview);
        Assert.AreEqual((2, (Guid?)first.AssignmentId), (item.Count, item.SubjectId));
        A8AssertSameInstant(firstSentAt, item.Since);
        A8AssertSameInstant(secondSentAt, item.NewestAt);
        var page = await ReadSliceAsync<ClientProfileOverviewView>(coach, $"/api/clients/{saraId}/overview");
        var onPage = page.Attention.Single(entry => entry.Kind == CoachAttentionKind.CheckInToReview);
        A8AssertSameInstant(firstSentAt, onPage.Since);
        A8AssertSameInstant(secondSentAt, onPage.NewestAt);
    }

    [TestMethod]
    public async Task A8TheTrainingTabReadsEachProgramsHistoryWithTheCancelReason()
    {
        var today = TenantToday();
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "a8-history-coach@example.test", "Hicham Haddad", "A8 History");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(coach, maya, tenant, "a8-history-maya@example.test", "Maya", "Rahman");
        var resources = await CreateTrainingResourcesAsync(coach, mayaId, 8, 3, today);
        var block = await AssignAsync(coach, mayaId, resources, today);

        // Renamed, then cancelled with a reason the coach typed.
        await RefreshCsrfAsync(coach);
        var renamed = await coach.PutAsJsonAsync($"/api/training/mesocycles/{block.Id}/name",
            new { name = "Strength A", version = block.Version });
        await AssertStatusAsync(renamed, HttpStatusCode.OK);
        var afterRename = await RequiredJsonAsync<ScenarioMesocycle>(renamed);
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PostAsJsonAsync($"/api/training/mesocycles/{block.Id}/cancel",
            new { reason = "Assigned the wrong start date", version = afterRename.Version }), HttpStatusCode.OK);

        var program = await ReadSliceAsync<CoachClientProgramView>(coach, $"/api/training/clients/{mayaId}/program");
        var history = program.Blocks.Single(item => item.Id == block.Id).Lifecycle;
        Assert.AreEqual(
            "Assigned, Renamed, Cancelled",
            string.Join(", ", history.Select(item => item.EventType)));
        Assert.AreEqual("Assigned the wrong start date", history[2].Reason);
        Assert.AreEqual((MesocycleStatus.Cancelled, (MesocycleStatus?)MesocycleStatus.Active),
            (history[2].ToStatus, history[2].FromStatus));
        Assert.Contains("Strength A", history[1].Reason);
        Assert.IsTrue(history.Zip(history.Skip(1)).All(pair => pair.First.OccurredAtUtc <= pair.Second.OccurredAtUtc),
            "Oldest first.");

        // Another workspace's coach reads nothing of it.
        using var stranger = CreateClient();
        await RegisterCoachAsync(stranger, "a8-history-stranger@example.test", "Lea Khoury", "A8 Elsewhere");
        await AssertStatusAsync(await stranger.GetAsync($"/api/training/clients/{mayaId}/program"), HttpStatusCode.NotFound);
    }

    [TestMethod]
    public async Task A8AnInvitationLinkSaysWhenItStopsOnTheWorkspaceClock()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "a8-zone-coach@example.test", "Hicham Haddad", "A8 Zone");

        // The owner moves the workspace to Dubai's clock, then invites a client.
        var workspace = await coach.GetFromJsonAsync<A8Workspace>("/api/workspace")
            ?? throw new AssertFailedException("Workspace was empty.");
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PutAsJsonAsync("/api/workspace", new
        {
            workspace.Name,
            timeZoneId = "Asia/Dubai",
            workspace.DefaultCulture,
            workspace.DefaultCurrencyCode,
            workspace.WeekStartsOn,
            workspace.Version,
        }), HttpStatusCode.OK);
        await RefreshCsrfAsync(coach);
        var invited = await coach.PostAsJsonAsync("/api/invitations", new
        {
            email = "a8-zone-rita@example.test",
            firstName = "Rita",
            lastName = "Daher",
        });
        await AssertStatusAsync(invited, HttpStatusCode.Created);
        var token = QueryValue((await RequiredJsonAsync<Invitation>(invited)).DevelopmentActionUrl!, "token");

        // Whoever holds the link reads the workspace's zone with the day it stops working.
        using var anonymous = CreateClient();
        var details = await RequiredJsonAsync<A8PublicInvitation>(
            await anonymous.GetAsync($"/api/invitations/public/{Uri.EscapeDataString(token)}"));
        Assert.AreEqual(("A8 Zone", "Asia/Dubai"), (details.WorkspaceName, details.TimeZoneId));
    }

    // ---------- A8 helpers ----------

    /// <summary>PostgreSQL keeps microseconds, so an instant read back may lose the clock's last ticks.</summary>
    private static void A8AssertSameInstant(DateTimeOffset expected, DateTimeOffset? actual)
    {
        Assert.IsNotNull(actual);
        Assert.IsLessThan(TimeSpan.FromMilliseconds(1), (actual.Value - expected).Duration(), $"{actual:o} is not {expected:o}.");
    }

    private static async Task<ClientOverviewRow> A8RowAsync(HttpClient coach, Guid clientId) =>
        (await ReadSliceAsync<ClientOverviewView>(coach, ClientOverviewUrl)).Clients
            .Single(item => item.Client.ClientProfileId == clientId);

    /// <summary>The client answers the intake and finishes setting up their profile.</summary>
    private static async Task A8CompleteOnboardingAsync(HttpClient client, string firstName, string lastName)
    {
        var profile = await client.GetFromJsonAsync<A8OwnProfile>("/api/client-profile/me")
            ?? throw new AssertFailedException("The client's profile was empty.");
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(await client.PostAsJsonAsync("/api/client-profile/me/complete-onboarding", new
        {
            intake = new
            {
                firstName,
                lastName,
                phoneNumber = "+96170000000",
                birthDate = "1995-04-02",
                heightValue = 168m,
                heightUnit = "Centimeter",
                workType = "Office",
                averageDailySteps = 8000,
                trainingBackground = "Two years",
                foodPreferences = "Mediterranean",
                foodAversions = (string?)null,
                goals = "Build strength",
                allergies = (string?)null,
                medications = (string?)null,
                previousInjuries = (string?)null,
                profile.Version,
            },
            initialBodyweightValue = 64.2m,
            initialBodyweightUnit = "Kilogram",
            measurementDate = TenantToday().AddDays(-1).ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture),
        }), HttpStatusCode.OK);
    }

    private sealed record A8OwnProfile(Guid Id, uint Version);

    private sealed record A8Workspace(
        string Name,
        string TimeZoneId,
        string DefaultCulture,
        string DefaultCurrencyCode,
        string WeekStartsOn,
        uint Version);

    private sealed record A8PublicInvitation(string WorkspaceName, string TimeZoneId, DateTimeOffset ExpiresAtUtc);
}
