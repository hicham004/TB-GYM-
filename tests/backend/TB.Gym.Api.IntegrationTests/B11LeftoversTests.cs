using System.Net;
using System.Net.Http.Json;
using TB.Gym.Modules.Clients;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Critique B11, the server's half of two leftovers: the check-in list says overdue on the very days the coach is
/// asked (CHK-015), so the client's page reads the rule instead of counting days of its own, and a blocked client's
/// row says their access is blocked beside the plan that still stands (CLI-018, SUB-010). The tests that step days
/// start at midday in the workspace's zone, so a whole day always lands on the next calendar day.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task B11TheCheckInListSaysOverdueOnTheDaysTheCoachIsAskedAndOnNoOthers()
    {
        var start = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b11-overdue-owner@example.test", "Hicham Haddad", "B11 Overdue");
        var form = await Phase6CreateFormAsync(owner, "Weekly check-in", Phase6ShortText("How was your week?"));
        var version = await Phase6PublishAsync(owner, form.Form.Id, form.Versions[0]);

        // Maya's eight-week plan has check-ins. Three are due today: Maya starts one, sends one and leaves one.
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(owner, maya, tenant, "b11-overdue-maya@example.test", "Maya", "Rahman");
        await Phase6EnrollAsync(owner, mayaId, "B11 check-ins", "CheckIns");
        var untouched = await B4aAssignAsync(owner, mayaId, version.Id, start);
        var secondForm = await Phase6CreateFormAsync(owner, "Mid-week check-in", Phase6ShortText("How is it going?"));
        var secondVersion = await Phase6PublishAsync(owner, secondForm.Form.Id, secondForm.Versions[0]);
        var started = await B4aAssignAsync(owner, mayaId, secondVersion.Id, start);
        var thirdForm = await Phase6CreateFormAsync(owner, "Sleep check-in", Phase6ShortText("How did you sleep?"));
        var thirdVersion = await Phase6PublishAsync(owner, thirdForm.Form.Id, thirdForm.Versions[0]);
        var sent = await B4aAssignAsync(owner, mayaId, thirdVersion.Id, start);
        await B4aSendAsync(maya, sent, thirdVersion);
        await AssertStatusAsync(
            await Phase6SaveDraftAsync(maya, started, [Phase6TextAnswer(Phase6QuestionOfType(secondVersion, "ShortText").Id, "Half written.")]),
            HttpStatusCode.OK);

        async Task AssertOverdueAsync(string when, params Guid[] expected)
        {
            var list = await B11ListAsync(owner, mayaId);
            CollectionAssert.AreEquivalent(
                expected,
                list.Items.Where(item => item.IsOverdue).Select(item => item.Assignment.Id).ToArray(),
                $"{when}: the list.");
            var tag = (await B4aOverdueAsync(owner)).SingleOrDefault(item => item.Client.ClientProfileId == mayaId);
            Assert.AreEqual(expected.Length == 0 ? null : expected.Length, tag?.Count, $"{when}: the tag.");
        }

        // On its due day and the day after it is not late, for the list as for the tag.
        await AssertOverdueAsync("The due day");
        RequiredTestClock.Advance(TimeSpan.FromDays(1));
        await AssertOverdueAsync("The day after");

        // The workspace's midnight decides, not UTC's: Beirut reads the next day two or three hours sooner.
        B4aSetWorkspaceClock(start.AddDays(1), new TimeOnly(23, 59));
        await AssertOverdueAsync("A minute before the second day");
        B4aSetWorkspaceClock(start.AddDays(2), new TimeOnly(0, 1));
        Assert.AreEqual(start.AddDays(1), B4aUtcDay(), "UTC is still on the day before.");

        // From the second day after its due day, a draft counting as not sent and a sent one never.
        await AssertOverdueAsync("A minute into the second day", untouched, started);

        // Through day 13. On day 14 it stops asking, for the list as for the tag.
        B4aSetWorkspaceClock(start.AddDays(13), new TimeOnly(12, 0));
        await AssertOverdueAsync("Day 13", untouched, started);
        B4aSetWorkspaceClock(start.AddDays(14), new TimeOnly(12, 0));
        await AssertOverdueAsync("Day 14");

        // Sending it ends it, however late: an overdue check-in goes as soon as it is sent.
        var another = await B4aAssignAsync(owner, mayaId, version.Id, start.AddDays(14));
        B4aSetWorkspaceClock(start.AddDays(16), new TimeOnly(12, 0));
        await AssertOverdueAsync("Two days after a new one", another);
        await B4aSendAsync(maya, another, version);
        await AssertOverdueAsync("Once it is sent");
    }

    [TestMethod]
    public async Task B11TheCheckInListOnlyOpensWhereItsAnswerHolds()
    {
        var start = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b11-closed-owner@example.test", "Hicham Haddad", "B11 Closed");
        using var lea = CreateClient();
        await JoinAsCoachAsync(owner, lea, "b11-closed-lea@example.test", "Lea Khoury");
        var form = await Phase6CreateFormAsync(owner, "Weekly check-in", Phase6ShortText("How was your week?"));
        var version = await Phase6PublishAsync(owner, form.Form.Id, form.Versions[0]);
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(owner, maya, tenant, "b11-closed-maya@example.test", "Maya", "Rahman");
        await Phase6EnrollAsync(owner, mayaId, "B11 check-ins", "CheckIns");
        await B4aAssignAsync(owner, mayaId, version.Id, start);
        RequiredTestClock.Advance(TimeSpan.FromDays(2));
        Assert.IsTrue((await B11ListAsync(owner, mayaId)).Items.Single().IsOverdue);

        // The rule asks whether check-ins are in the plan, and the read says true: nobody reaches it when they are not.
        var url = $"/api/checkins/clients/{mayaId}/assignments";
        await B4aSetBlockedAsync(owner, mayaId, blocked: true);
        await AssertStatusAsync(await owner.GetAsync(url), HttpStatusCode.Forbidden);
        await B4aSetBlockedAsync(owner, mayaId, blocked: false);

        // Another coach's client (ADR 0026), and another workspace's: neither learns the client exists.
        await AssertStatusAsync(await lea.GetAsync(url), HttpStatusCode.NotFound);
        using var stranger = CreateClient();
        await RegisterCoachAsync(stranger, "b11-closed-stranger@example.test", "Nadia Stranger", "B11 Elsewhere");
        await AssertStatusAsync(await stranger.GetAsync(url), HttpStatusCode.NotFound);

        // Signed out, nothing.
        using var signedOut = CreateClient();
        await AssertStatusAsync(await signedOut.GetAsync(url), HttpStatusCode.Unauthorized);
    }

    [TestMethod]
    public async Task B11ABlockedClientsRowSaysSoBesideThePlanThatStillStands()
    {
        var today = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b11-blocked-owner@example.test", "Hicham Haddad", "B11 Blocked");

        // Maya pays for twelve weeks; Sara has no plan at all.
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(owner, maya, tenant, "b11-blocked-maya@example.test", "Maya", "Rahman");
        var plan = await B4aPaidPlanAsync(owner, mayaId, "B11 Strength", 120.50m, 12, "Messaging", "CheckIns");
        using var sara = CreateClient();
        var saraId = await R31InviteAsync(owner, sara, tenant, "b11-blocked-sara@example.test", "Sara", "Haddad");
        var lastDay = today.AddDays(83);

        var row = await B4aRowAsync(owner, mayaId);
        Assert.AreEqual((ClientPlanStatus.OnTrack, (DateOnly?)lastDay), (row.PlanStatus, row.PlanEndsOn));

        // Blocked, the row says so where it said No active plan, and the plan it sums up stays with its last day: a
        // block changes no plan (SUB-010). The one status the chat's panel reads keeps to the plan.
        await B4aSetBlockedAsync(owner, mayaId, blocked: true);
        row = await B4aRowAsync(owner, mayaId);
        Assert.AreEqual(
            (ClientPlanState.Blocked, ClientPlanStatus.AccessBlocked, ClientOverviewStatus.NoActivePlan, (DateOnly?)lastDay),
            (row.PlanState, row.PlanStatus, row.Status, row.PlanEndsOn));
        Assert.AreEqual((Guid?)plan.Id, row.Plan?.EnrollmentId);

        // With no plan to stand by, it still says so, and the row sums up nothing.
        await B4aSetBlockedAsync(owner, saraId, blocked: true);
        row = await B4aRowAsync(owner, saraId);
        Assert.AreEqual((ClientPlanStatus.AccessBlocked, (DateOnly?)null), (row.PlanStatus, row.PlanEndsOn));
        Assert.IsNull(row.Plan);

        // Unblocked, the plan's own status is back, and Sara has no active plan, as before.
        await B4aSetBlockedAsync(owner, mayaId, blocked: false);
        await B4aSetBlockedAsync(owner, saraId, blocked: false);
        Assert.AreEqual(ClientPlanStatus.OnTrack, (await B4aRowAsync(owner, mayaId)).PlanStatus);
        Assert.AreEqual(ClientPlanStatus.NoActivePlan, (await B4aRowAsync(owner, saraId)).PlanStatus);
    }

    /// <summary>The coach's list of this client's check-ins, the read the client's page and its Check-ins tab draw from.</summary>
    private static async Task<Phase6AssignmentList> B11ListAsync(HttpClient coach, Guid clientId) =>
        await coach.GetFromJsonAsync<Phase6AssignmentList>($"/api/checkins/clients/{clientId}/assignments")
        ?? throw new AssertFailedException("The check-in list was empty.");
}
