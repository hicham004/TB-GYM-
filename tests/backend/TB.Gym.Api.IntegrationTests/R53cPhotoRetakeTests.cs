using System.Net;
using System.Net.Http.Json;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// R5.3c, a removed progress photo frees its date and pose (PRG-012): a wrong shot can be retaken the
/// same day, by the client and by their coach, while two ACTIVE photos for one date and pose still
/// conflict. The removed one stays in the client's own history and out of the coach's view.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task R53cARemovedPhotoFreesItsDateAndPoseSoTheShotCanBeTakenAgain()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "r53c-photo-coach@example.test", "R53c Coach", "R53c Photo Gym");
        using var client = CreateClient();
        await InviteAndAcceptAsync(coach, client, "r53c-photo-client@example.test", true);
        SetTenant(client, workspaceId);

        const string front = "/api/progress/me/photos?pose=Front&photoDate=2026-08-22";
        var first = await UploadProgressPhotoAsync(client, front);
        Assert.AreEqual(HttpStatusCode.Conflict, (await PostProgressPhotoAsync(client, front)).StatusCode);

        // The wrong shot is removed, with a reason, as before.
        await RefreshCsrfAsync(client);
        var removed = await client.PostAsJsonAsync(
            $"/api/progress/me/photos/{first.Id}/remove",
            new { reason = "Wrong pose captured.", version = first.Version });
        await AssertStatusAsync(removed, HttpStatusCode.OK);

        // Its date and pose are free again: the same shot is taken again...
        var retake = await UploadProgressPhotoAsync(client, front);
        Assert.AreNotEqual(first.Id, retake.Id);
        Assert.AreNotEqual(first.MediaAssetId, retake.MediaAssetId);
        Assert.AreEqual("Active", retake.Status);

        // ...and the new one holds the slot again: two active photos for one date and pose still conflict.
        Assert.AreEqual(HttpStatusCode.Conflict, (await PostProgressPhotoAsync(client, front)).StatusCode);

        // The client's own history keeps both, the older (removed) one first; the coach sees only the retake.
        var own = await client.GetFromJsonAsync<Phase5B2Photos>("/api/progress/me/photos?from=2026-08-01&to=2026-09-01")
            ?? throw new AssertFailedException("Own photos were empty.");
        CollectionAssert.AreEqual(
            new[] { (first.Id, "Removed"), (retake.Id, "Active") },
            own.Photos.Select(item => (item.Id, item.Status)).ToArray());
        var coachView = await coach.GetFromJsonAsync<Phase5B2Photos>(
            $"/api/progress/clients/{own.ClientProfileId}/photos?from=2026-08-01&to=2026-09-01")
            ?? throw new AssertFailedException("Coach photos were empty.");
        CollectionAssert.AreEqual(new[] { retake.Id }, coachView.Photos.Select(item => item.Id).ToArray());

        // The coach records for the client the same way, and retakes after removing.
        var back = $"/api/progress/clients/{own.ClientProfileId}/photos?pose=Back&photoDate=2026-08-22";
        var coachFirst = await UploadProgressPhotoAsync(coach, back);
        Assert.AreEqual(HttpStatusCode.Conflict, (await PostProgressPhotoAsync(coach, back)).StatusCode);
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync(
                $"/api/progress/clients/{own.ClientProfileId}/photos/{coachFirst.Id}/remove",
                new { reason = "Blurred.", version = coachFirst.Version }),
            HttpStatusCode.OK);
        var coachRetake = await UploadProgressPhotoAsync(coach, back);
        Assert.AreNotEqual(coachFirst.Id, coachRetake.Id);
        Assert.AreEqual(HttpStatusCode.Conflict, (await PostProgressPhotoAsync(coach, back)).StatusCode);
    }
}
