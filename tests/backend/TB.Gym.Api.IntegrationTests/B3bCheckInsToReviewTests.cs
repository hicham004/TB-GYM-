using System.Net;
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

        // The owner sees both, oldest first, with whose client each is and how late.
        var ownerList = await ReadSliceAsync<CheckInToReviewList>(owner, B3bToReviewUrl);
        CollectionAssert.AreEqual(
            new[] { mayaAssignment, ramiAssignment },
            ownerList.Items.Select(item => item.AssignmentId).ToArray());
        Assert.AreEqual((2, 500), (ownerList.Total, ownerList.Maximum));
        var first = ownerList.Items[0];
        Assert.AreEqual(
            ("Maya", "Rahman", mayaId, "Hicham Haddad", "Weekly check-in", 2),
            (first.ClientFirstName, first.ClientLastName, first.ClientProfileId, first.CoachName, first.FormTitle, first.DaysLate));
        Assert.AreEqual(first.DueDate.AddDays(2), first.SentDate);
        var second = ownerList.Items[1];
        Assert.AreEqual(("Rami", "Lina Saad", 0), (second.ClientFirstName, second.CoachName, second.DaysLate));

        // A coach sees their own clients' alone (ADR 0026).
        var coachList = await ReadSliceAsync<CheckInToReviewList>(coach, B3bToReviewUrl);
        Assert.AreEqual((ramiAssignment, 1), (coachList.Items.Single().AssignmentId, coachList.Total));

        // Reviewed, a check-in leaves the list.
        await AssertStatusAsync(await Phase6ReviewAsync(owner, mayaId, mayaAssignment, mayaVersion), HttpStatusCode.OK);
        Assert.AreEqual(ramiAssignment, (await ReadSliceAsync<CheckInToReviewList>(owner, B3bToReviewUrl)).Items.Single().AssignmentId);

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
