using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;

namespace TB.Gym.Api.IntegrationTests;

public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task Phase5B2ClientPhotosArePrivateToTheClientAndTheirUnblockedCoach()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "p5b2-coach@example.test", "Photo Coach", "Photo Workspace");
        using var owner = CreateClient();
        var ownerId = await InviteAndAcceptAsync(coach, owner, "p5b2-owner@example.test", true);
        SetTenant(owner, workspaceId);
        using var otherClient = CreateClient();
        await InviteAndAcceptAsync(coach, otherClient, "p5b2-other@example.test", true);
        SetTenant(otherClient, workspaceId);

        var photo = await UploadProgressPhotoAsync(owner, "/api/progress/me/photos?pose=Front&photoDate=2026-08-22");

        // The owning client and their coach can both resolve the bytes.
        await AssertPhotoReadableAsync(owner, photo.MediaAssetId, true);
        await AssertPhotoReadableAsync(coach, photo.MediaAssetId, true);

        // Another client of the same workspace cannot, even holding the identifiers.
        await AssertPhotoReadableAsync(otherClient, photo.MediaAssetId, false);
        await AssertStatusAsync(await otherClient.GetAsync($"/api/progress/clients/{ownerId}/photos"), HttpStatusCode.Forbidden);

        // A coach from another workspace cannot see the photo or the client.
        using var foreignCoach = CreateClient();
        await RegisterCoachAsync(foreignCoach, "p5b2-foreign@example.test", "Foreign Photo", "Foreign Photo Workspace");
        await AssertPhotoReadableAsync(foreignCoach, photo.MediaAssetId, false);
        await AssertStatusAsync(await foreignCoach.GetAsync($"/api/progress/clients/{ownerId}/photos"), HttpStatusCode.NotFound);

        // Progress photos never surface in the coach exercise-media library.
        var library = await coach.GetFromJsonAsync<Phase5B2MediaPage>("/api/media?skip=0&take=100")
            ?? throw new AssertFailedException("Media library was empty.");
        Assert.IsFalse(library.Items.Any(item => item.Id == photo.MediaAssetId));
    }

    [TestMethod]
    public async Task Phase5B2BlockingRevokesCoachPhotoAccessButNotTheClientsOwn()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "p5b2-block-coach@example.test", "Block Coach", "Block Photo");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "p5b2-block-client@example.test", true);
        SetTenant(client, workspaceId);

        var photo = await UploadProgressPhotoAsync(client, "/api/progress/me/photos?pose=Side&photoDate=2026-08-22");
        await AssertPhotoReadableAsync(coach, photo.MediaAssetId, true);

        var details = await coach.GetFromJsonAsync<Phase5B2ClientDetails>($"/api/clients/{clientId}")
            ?? throw new AssertFailedException("Client details were empty.");
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync(
                $"/api/clients/{clientId}/relationship/block",
                new { reason = "Blocked for the photo test.", details.Version }),
            HttpStatusCode.OK);

        // Blocking withdraws the coach's access immediately, including the raw bytes.
        await AssertPhotoReadableAsync(coach, photo.MediaAssetId, false);
        await AssertStatusAsync(await coach.GetAsync($"/api/progress/clients/{clientId}/photos"), HttpStatusCode.NotFound);
        await RefreshCsrfAsync(coach);
        Assert.AreEqual(
            HttpStatusCode.Forbidden,
            (await coach.PostAsJsonAsync(
                $"/api/progress/clients/{clientId}/photos/{photo.Id}/remove",
                new { reason = "Blocked coach attempt.", photo.Version })).StatusCode);

        // The client keeps their own photo throughout.
        await AssertPhotoReadableAsync(client, photo.MediaAssetId, true);
        await AssertStatusAsync(await client.GetAsync("/api/progress/me/photos"), HttpStatusCode.OK);
    }

    [TestMethod]
    public async Task Phase5B2DuplicatePoseConflictsRemovalIsAuditedAndVideoIsRejected()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "p5b2-rules-coach@example.test", "Rules Coach", "Rules Photo");
        using var client = CreateClient();
        await InviteAndAcceptAsync(coach, client, "p5b2-rules-client@example.test", true);
        SetTenant(client, workspaceId);

        var front = await UploadProgressPhotoAsync(client, "/api/progress/me/photos?pose=Front&photoDate=2026-08-22");

        // One photo per local date and pose; a different pose on the same date is fine.
        Assert.AreEqual(
            HttpStatusCode.Conflict,
            (await PostProgressPhotoAsync(client, "/api/progress/me/photos?pose=Front&photoDate=2026-08-22")).StatusCode);
        await UploadProgressPhotoAsync(client, "/api/progress/me/photos?pose=Back&photoDate=2026-08-22");

        // A progress photo is an image; a video is rejected rather than stored.
        await RefreshCsrfAsync(client);
        using var videoForm = new MultipartFormDataContent();
        var video = new ByteArrayContent([0x1a, 0x45, 0xdf, 0xa3, 0, 1, 2, 3]);
        video.Headers.ContentType = new MediaTypeHeaderValue("video/webm");
        videoForm.Add(video, "file", "clip.webm");
        Assert.AreEqual(
            HttpStatusCode.BadRequest,
            (await client.PostAsync("/api/progress/me/photos?pose=Side&photoDate=2026-08-22", videoForm)).StatusCode);

        // Future dating is rejected against the workspace clock.
        Assert.AreEqual(
            HttpStatusCode.BadRequest,
            (await PostProgressPhotoAsync(client, "/api/progress/me/photos?pose=Side&photoDate=2027-01-01")).StatusCode);

        // Removal is one-way, audited, and concurrency protected.
        await RefreshCsrfAsync(client);
        var stale = front.Version;
        var removed = await client.PostAsJsonAsync(
            $"/api/progress/me/photos/{front.Id}/remove",
            new { reason = "Wrong pose captured.", version = stale });
        await AssertStatusAsync(removed, HttpStatusCode.OK);
        Assert.AreEqual("Removed", (await RequiredJsonAsync<Phase5B2Photo>(removed)).Status);

        await RefreshCsrfAsync(client);
        Assert.AreEqual(
            HttpStatusCode.Conflict,
            (await client.PostAsJsonAsync(
                $"/api/progress/me/photos/{front.Id}/remove",
                new { reason = "Second attempt.", version = stale })).StatusCode);

        // The removed photo stays in the client's own history and leaves the coach's view.
        var own = await client.GetFromJsonAsync<Phase5B2Photos>("/api/progress/me/photos")
            ?? throw new AssertFailedException("Own photos were empty.");
        Assert.IsTrue(own.Photos.Any(item => item.Id == front.Id && item.Status == "Removed"));
        var coachView = await coach.GetFromJsonAsync<Phase5B2Photos>(
            $"/api/progress/clients/{own.ClientProfileId}/photos")
            ?? throw new AssertFailedException("Coach photos were empty.");
        Assert.IsFalse(coachView.Photos.Any(item => item.Id == front.Id));

        // Neither the image bytes nor the reason may reach the logs.
        Assert.IsFalse(RequiredSensitiveLogCapture.Text.Contains("Wrong pose captured", StringComparison.Ordinal));
    }

    [TestMethod]
    public async Task Phase5B2UploadedPhotoLosesExifButKeepsOrientationAndRemainsAValidImage()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "p5b2-exif-coach@example.test", "Exif Coach", "Exif Photo");
        using var client = CreateClient();
        await InviteAndAcceptAsync(coach, client, "p5b2-exif-client@example.test", true);
        SetTenant(client, workspaceId);

        // A 48x32 landscape JPEG whose EXIF says "rotate 90" and carries a searchable GPS string.
        var original = ProgressPhotoImageFactory.JpegWithExif(48, 32, ProgressPhotoImageFactory.RotateNinetyOrientation);
        Assert.IsTrue(Contains(original, ProgressPhotoImageFactory.SecretDescription));

        var response = await PostProgressPhotoAsync(
            client,
            "/api/progress/me/photos?pose=Front&photoDate=2026-08-22",
            original);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        var photo = await RequiredJsonAsync<Phase5B2Photo>(response);

        RequiredTestClock.Set(DateTimeOffset.UtcNow);
        await RefreshCsrfAsync(client);
        var access = await client.PostAsync($"/api/media/{photo.MediaAssetId}/access", null);
        await AssertStatusAsync(access, HttpStatusCode.OK);
        var granted = await RequiredJsonAsync<Phase5B2Access>(access);
        var content = await client.GetAsync(granted.Url);
        await AssertStatusAsync(content, HttpStatusCode.OK);
        var stored = await content.Content.ReadAsByteArrayAsync();

        // The metadata is gone: no EXIF APP1 marker and no trace of the GPS description.
        Assert.IsFalse(
            Contains(stored, ProgressPhotoImageFactory.SecretDescription),
            "The EXIF description survived storage.");
        Assert.IsFalse(ContainsExifApp1(stored), "An EXIF APP1 segment survived storage.");

        // The image is still valid, and the orientation was baked into the pixels rather than
        // discarded with the tag: a 48x32 source marked "rotate 90" is stored as 32x48.
        var size = ProgressPhotoImageFactory.Measure(stored);
        Assert.AreEqual(32, size.Width);
        Assert.AreEqual(48, size.Height);
    }

    private static bool Contains(byte[] haystack, string needle) =>
        System.Text.Encoding.ASCII.GetString(haystack).Contains(needle, StringComparison.Ordinal);

    private static bool ContainsExifApp1(byte[] image)
    {
        for (var index = 0; index + 5 < image.Length; index++)
        {
            if (image[index] == 0xFF &&
                image[index + 1] == 0xE1 &&
                image[index + 4] == (byte)'E' &&
                image[index + 5] == (byte)'x')
            {
                return true;
            }
        }

        return false;
    }

    private static Task<HttpResponseMessage> PostProgressPhotoAsync(HttpClient caller, string url) =>
        PostProgressPhotoAsync(caller, url, ProgressPhotoImageFactory.PlainJpeg(48, 32));

    private static async Task<HttpResponseMessage> PostProgressPhotoAsync(
        HttpClient caller,
        string url,
        byte[] image)
    {
        await RefreshCsrfAsync(caller);
        using var form = new MultipartFormDataContent();
        var file = new ByteArrayContent(image);
        file.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");
        form.Add(file, "file", "progress.jpg");
        return await caller.PostAsync(url, form);
    }

    private static async Task<Phase5B2Photo> UploadProgressPhotoAsync(HttpClient caller, string url)
    {
        var response = await PostProgressPhotoAsync(caller, url);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<Phase5B2Photo>(response);
    }

    private async Task AssertPhotoReadableAsync(HttpClient caller, Guid mediaAssetId, bool expected)
    {
        // The grant embeds an absolute expiry that the data-protection provider also checks against
        // real wall time, so the pinned test clock must be resynced before one is minted.
        RequiredTestClock.Set(DateTimeOffset.UtcNow);
        await RefreshCsrfAsync(caller);
        var access = await caller.PostAsync($"/api/media/{mediaAssetId}/access", null);
        if (!expected)
        {
            Assert.IsTrue(
                access.StatusCode is HttpStatusCode.Forbidden or HttpStatusCode.NotFound,
                $"Expected the grant to be refused but received {(int)access.StatusCode}.");
            return;
        }

        await AssertStatusAsync(access, HttpStatusCode.OK);
        var granted = await RequiredJsonAsync<Phase5B2Access>(access);
        await AssertStatusAsync(await caller.GetAsync(granted.Url), HttpStatusCode.OK);
    }

    private sealed record Phase5B2Photo(Guid Id, Guid MediaAssetId, string Status, string Pose, uint Version);
    private sealed record Phase5B2Photos(Guid ClientProfileId, Phase5B2Photo[] Photos);
    private sealed record Phase5B2Access(string Url);
    private sealed record Phase5B2MediaItem(Guid Id);
    private sealed record Phase5B2MediaPage(Phase5B2MediaItem[] Items);
    private sealed record Phase5B2ClientDetails(uint Version);
}
