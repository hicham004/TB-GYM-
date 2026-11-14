using System.Net;
using System.Net.Http.Json;
using TB.Gym.Modules.CheckIns;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Critique B3b: Check-ins opens on To review, one row per sent check-in waiting for its review, of the
/// caller's current clients whose plan includes check-ins (a Coach's own, every one for the Owner, the
/// owner's choice of 2026-10-28), oldest first, each saying when it was sent and how late.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string B3bToReviewUrl = "/api/checkins/to-review";

    [TestMethod]
    public async Task B3bToReviewListsEverySentCheckInOfTheCallersClientsOldestFirst()
    {
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b3b-review-owner@example.test", "Hicham Haddad", "B3b Review");
        var form = await Phase6CreateFormAsync(owner, "Weekly check-in", Phase6ShortText("How was your week?"));
        var version = await Phase6PublishAsync(owner, form.Form.Id, form.Versions[0]);
        Assert.IsEmpty((await ReadSliceAsync<CheckInToReviewList>(owner, B3bToReviewUrl)).Items);

        // Maya, the owner's own client, sends two days after the day it was due.
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(owner, maya, tenant, "b3b-review-maya@example.test", "Maya", "Rahman");
        await Phase6EnrollAsync(owner, mayaId, "B3b Maya plan", "CheckIns");
        var mayaAssignment = await B3bAssignAsync(owner, mayaId, version.Id, Phase6WorkspaceToday());
        RequiredTestClock.Advance(TimeSpan.FromDays(2));
        var mayaVersion = await B3bSendAsync(maya, mayaAssignment, version);

        // Rami, a team coach's client, sends on time, after Maya.
        using var coach = CreateClient();
        await JoinAsCoachAsync(owner, coach, "b3b-review-coach@example.test", "Lina Saad");
        using var rami = CreateClient();
        var ramiId = await R31InviteAsync(coach, rami, tenant, "b3b-review-rami@example.test", "Rami", "Saliba");
        await Phase6EnrollAsync(owner, ramiId, "B3b Rami plan", "CheckIns");
        var ramiAssignment = await B3bAssignAsync(coach, ramiId, version.Id, Phase6WorkspaceToday().AddDays(1));
        R31Tick();
        await B3bSendAsync(rami, ramiAssignment, version);

        // The owner sees their own client's, with whose client it is and how late. Each opens the answers, the
        // private side, so a team coach's client's is the coach's alone (C8, notes plan N9d1a).
        var ownerList = await ReadSliceAsync<CheckInToReviewList>(owner, B3bToReviewUrl);
        CollectionAssert.AreEqual(new[] { mayaAssignment }, ownerList.Items.Select(item => item.AssignmentId).ToArray());
        Assert.AreEqual((1, 500), (ownerList.Total, ownerList.Maximum));
        var first = ownerList.Items[0];
        Assert.AreEqual(
            ("Maya", "Rahman", mayaId, "Hicham Haddad", "Weekly check-in", 2),
            (first.ClientFirstName, first.ClientLastName, first.ClientProfileId, first.CoachName, first.FormTitle, first.DaysLate));
        Assert.AreEqual(first.DueDate.AddDays(2), first.SentDate);

        // A coach sees their own clients' alone (ADR 0026), with whose client it is and how late.
        var coachList = await ReadSliceAsync<CheckInToReviewList>(coach, B3bToReviewUrl);
        Assert.AreEqual((ramiAssignment, 1), (coachList.Items.Single().AssignmentId, coachList.Total));
        var second = coachList.Items[0];
        Assert.AreEqual(("Rami", "Lina Saad", 0), (second.ClientFirstName, second.CoachName, second.DaysLate));

        // Reviewed, a check-in leaves the list.
        await AssertStatusAsync(await Phase6ReviewAsync(owner, mayaId, mayaAssignment, mayaVersion), HttpStatusCode.OK);
        Assert.IsEmpty((await ReadSliceAsync<CheckInToReviewList>(owner, B3bToReviewUrl)).Items);

        // A client, someone signed out and another coaching space's owner are refused.
        await AssertStatusAsync(await maya.GetAsync(B3bToReviewUrl), HttpStatusCode.Forbidden);
        using var anonymous = CreateClient();
        SetTenant(anonymous, tenant);
        await AssertStatusAsync(await anonymous.GetAsync(B3bToReviewUrl), HttpStatusCode.Unauthorized);
        using var stranger = CreateClient();
        await RegisterCoachAsync(stranger, "b3b-review-stranger@example.test", "Other Owner", "B3b Elsewhere");
        Assert.IsEmpty((await ReadSliceAsync<CheckInToReviewList>(stranger, B3bToReviewUrl)).Items);
        SetTenant(stranger, tenant);
        await AssertStatusAsync(await stranger.GetAsync(B3bToReviewUrl), HttpStatusCode.Forbidden);
    }

    [TestMethod]
    public async Task B3bToReviewLeavesOutABlockedAReleasedAReassignedAndALapsedClient()
    {
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b3b-out-owner@example.test", "Hicham Haddad", "B3b Left Out");
        var form = await Phase6CreateFormAsync(owner, "Weekly check-in", Phase6ShortText("How was your week?"));
        var version = await Phase6PublishAsync(owner, form.Form.Id, form.Versions[0]);
        using var lina = CreateClient();
        await JoinAsCoachAsync(owner, lina, "b3b-out-lina@example.test", "Lina Saad");
        using var karim = CreateClient();
        var karimUserId = await JoinAsCoachAsync(owner, karim, "b3b-out-karim@example.test", "Karim Nassar");

        // Four of Lina's clients send a check-in each, in this order. Omar's plan covers check-ins for one
        // week only, beside eight weeks of training; the others' cover check-ins for eight weeks.
        using var mayaClient = CreateClient();
        var mayaId = await R31InviteAsync(lina, mayaClient, tenant, "b3b-out-maya@example.test", "Maya", "Rahman");
        using var ramiClient = CreateClient();
        var ramiId = await R31InviteAsync(lina, ramiClient, tenant, "b3b-out-rami@example.test", "Rami", "Saliba");
        using var nourClient = CreateClient();
        var nourId = await R31InviteAsync(lina, nourClient, tenant, "b3b-out-nour@example.test", "Nour", "Fares");
        using var omarClient = CreateClient();
        var omarId = await R31InviteAsync(lina, omarClient, tenant, "b3b-out-omar@example.test", "Omar", "Nasser");
        foreach (var clientId in new[] { mayaId, ramiId, nourId })
        {
            await Phase6EnrollAsync(owner, clientId, "B3b Left Out plan", "CheckIns");
        }

        await Step3EnrollAsync(owner, omarId, Phase6WorkspaceToday(), 1, "CheckIns");
        await Step3EnrollAsync(owner, omarId, Phase6WorkspaceToday(), 8, "Training");
        var maya = await B3bSentAsync(lina, mayaClient, mayaId, version);
        var rami = await B3bSentAsync(lina, ramiClient, ramiId, version);
        var nour = await B3bSentAsync(lina, nourClient, nourId, version);
        var omar = await B3bSentAsync(lina, omarClient, omarId, version);
        // Every one is Lina's client, so the owner's list, the clients they coach, holds none (C8, N9d1a).
        await B3bAssertToReviewAsync(owner);
        await B3bAssertToReviewAsync(lina, maya, rami, nour, omar);

        // A blocked relationship closes check-ins on both sides (CHK-011): Maya leaves both lists, and her
        // check-in, never touched, comes back when the block lifts.
        var mayaProfile = await RequiredJsonAsync<TeamClientDetails>(await owner.GetAsync($"/api/clients/{mayaId}"));
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(await owner.PostAsJsonAsync($"/api/clients/{mayaId}/relationship/block",
            new { reason = "B3b privacy check", mayaProfile.Version }), HttpStatusCode.OK);
        await B3bAssertToReviewAsync(lina, rami, nour, omar);
        mayaProfile = await RequiredJsonAsync<TeamClientDetails>(await owner.GetAsync($"/api/clients/{mayaId}"));
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(await owner.PostAsJsonAsync($"/api/clients/{mayaId}/relationship/unblock",
            new { reason = "B3b privacy check done", mayaProfile.Version }), HttpStatusCode.OK);
        await B3bAssertToReviewAsync(lina, maya, rami, nour, omar);

        // A released client is a former client, whose record is read-only: never listed (ADR 0027).
        await ReleaseAsync(owner, ramiId, "Moved away");
        await B3bAssertToReviewAsync(lina, maya, nour, omar);

        // A client given to another coach takes their check-in along: Lina no longer sees Nour's, Karim
        // does, and his row names him (ADR 0026); the owner, who coaches none of them, still lists none.
        await ReassignAsync(owner, nourId, karimUserId, null);
        await B3bAssertToReviewAsync(lina, maya, omar);
        var karimList = await B3bAssertToReviewAsync(karim, nour);
        Assert.AreEqual("Karim Nassar", karimList.Items[0].CoachName);
        await B3bAssertToReviewAsync(owner);

        // A week on, Omar's plan still runs but no longer includes check-ins (CHK-014): his row leaves while
        // the others stay.
        RequiredTestClock.Advance(TimeSpan.FromDays(8));
        await B3bAssertToReviewAsync(karim, nour);
        await B3bAssertToReviewAsync(lina, maya);

        // Once every plan has ended, nothing waits for anyone.
        RequiredTestClock.Advance(TimeSpan.FromDays(52));
        await B3bAssertToReviewAsync(owner);
        await B3bAssertToReviewAsync(lina);
        await B3bAssertToReviewAsync(karim);
    }

    /// <summary>
    /// What the caller's To review lists, oldest first, by assignment, and that its total counts exactly those.
    /// </summary>
    private static async Task<CheckInToReviewList> B3bAssertToReviewAsync(HttpClient caller, params Guid[] expected)
    {
        var list = await ReadSliceAsync<CheckInToReviewList>(caller, B3bToReviewUrl);
        CollectionAssert.AreEqual(expected, list.Items.Select(item => item.AssignmentId).ToArray());
        Assert.AreEqual(expected.Length, list.Total);
        return list;
    }

    /// <summary>The coach assigns the form due today, and a minute later the client sends it; returns the assignment.</summary>
    private async Task<Guid> B3bSentAsync(HttpClient coach, HttpClient client, Guid clientId, Phase6Version version)
    {
        var assignment = await B3bAssignAsync(coach, clientId, version.Id, Phase6WorkspaceToday());
        R31Tick();
        await B3bSendAsync(client, assignment, version);
        return assignment;
    }

    private static async Task<Guid> B3bAssignAsync(HttpClient coach, Guid clientId, Guid versionId, DateOnly dueDate) =>
        (await RequiredJsonAsync<Phase6AssignmentDetail>(
            await Phase6AssignAsync(coach, clientId, versionId, dueDate))).Assignment.Id;

    /// <summary>The client answers the form's one question and sends it; returns the response's version.</summary>
    private static async Task<uint> B3bSendAsync(HttpClient client, Guid assignmentId, Phase6Version version)
    {
        var question = Phase6QuestionOfType(version, "ShortText");
        var draft = await RequiredJsonAsync<Phase6ResponseDetail>(
            await Phase6SaveDraftAsync(client, assignmentId, [Phase6TextAnswer(question.Id, "A good week.")]));
        var sent = await Phase6SubmitAsync(client, assignmentId, draft.Response!.Version);
        await AssertStatusAsync(sent, HttpStatusCode.OK);
        return (await RequiredJsonAsync<Phase6ResponseDetail>(sent)).Response!.Version;
    }
}
