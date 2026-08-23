using System.Net;
using System.Net.Http.Json;
using TB.Gym.Modules.Media;

namespace TB.Gym.Api.IntegrationTests;

public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task Phase5B3ThumbnailIsReadableByTheOwningClientAndTheirUnblockedCoach()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "p5b3-coach@example.test", "Thumb Coach", "Thumb Workspace");
        using var client = CreateClient();
        await InviteAndAcceptAsync(coach, client, "p5b3-client@example.test", true);
        SetTenant(client, workspaceId);

        var photo = await Phase5B3UploadAsync(client, "/api/progress/me/photos?pose=Front&photoDate=2026-08-22");

        // The thumbnail is advertised on the same grant as the original and needs no second call.
        var owned = await Phase5B3GrantAsync(client, photo.MediaAssetId);
        Assert.IsNotNull(owned.ThumbnailUrl, "The progress photo was stored without a thumbnail.");
        Assert.AreEqual(
            MediaAccessCookie.ThumbnailPath(photo.MediaAssetId),
            owned.ThumbnailUrl,
            "The thumbnail must live beneath the asset content path the grant cookie is scoped to.");

        var clientThumbnail = await client.GetAsync(owned.ThumbnailUrl);
        await AssertStatusAsync(clientThumbnail, HttpStatusCode.OK);
        Assert.AreEqual("image/jpeg", clientThumbnail.Content.Headers.ContentType?.MediaType);

        // The coaching relationship is not blocked, so the coach resolves it under their own grant.
        var coachAccess = await Phase5B3GrantAsync(coach, photo.MediaAssetId);
        Assert.IsNotNull(coachAccess.ThumbnailUrl);
        await AssertStatusAsync(await coach.GetAsync(coachAccess.ThumbnailUrl), HttpStatusCode.OK);
        await AssertStatusAsync(await coach.GetAsync(coachAccess.Url), HttpStatusCode.OK);
    }

    [TestMethod]
    public async Task Phase5B3ThumbnailAndOriginalAreBothClosedToOtherClientsAndForeignTenants()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "p5b3-iso-coach@example.test", "Iso Coach", "Iso Workspace");
        using var owner = CreateClient();
        var ownerId = await InviteAndAcceptAsync(coach, owner, "p5b3-iso-owner@example.test", true);
        SetTenant(owner, workspaceId);
        using var otherClient = CreateClient();
        await InviteAndAcceptAsync(coach, otherClient, "p5b3-iso-other@example.test", true);
        SetTenant(otherClient, workspaceId);

        var photo = await Phase5B3UploadAsync(owner, "/api/progress/me/photos?pose=Front&photoDate=2026-08-22");
        var thumbnailPath = MediaAccessCookie.ThumbnailPath(photo.MediaAssetId);
        var contentPath = MediaAccessCookie.Path(photo.MediaAssetId);

        // Another client of the same workspace holds valid identifiers and an active session in the
        // same tenant, and still gets nothing: no grant, no original, no thumbnail.
        await Phase5B3AssertClosedAsync(otherClient, photo.MediaAssetId, contentPath, thumbnailPath);
        await AssertStatusAsync(
            await otherClient.GetAsync($"/api/progress/clients/{ownerId}/photos"),
            HttpStatusCode.Forbidden);

        // A grant that client legitimately holds for their own photo does not travel to someone
        // else's rendition: the thumbnail is authorized against its parent asset, not the cookie.
        var ownPhoto = await Phase5B3UploadAsync(otherClient, "/api/progress/me/photos?pose=Back&photoDate=2026-08-22");
        var ownGrant = await Phase5B3GrantAsync(otherClient, ownPhoto.MediaAssetId);
        Assert.IsNotNull(ownGrant.ThumbnailUrl);
        await AssertStatusAsync(await otherClient.GetAsync(ownGrant.ThumbnailUrl), HttpStatusCode.OK);
        await Phase5B3AssertClosedAsync(otherClient, photo.MediaAssetId, contentPath, thumbnailPath);

        // A coach of another workspace cannot reach either variant.
        using var foreignCoach = CreateClient();
        await RegisterCoachAsync(foreignCoach, "p5b3-iso-foreign@example.test", "Foreign", "Foreign Iso Workspace");
        await Phase5B3AssertClosedAsync(foreignCoach, photo.MediaAssetId, contentPath, thumbnailPath);
        await AssertStatusAsync(
            await foreignCoach.GetAsync($"/api/progress/clients/{ownerId}/photos"),
            HttpStatusCode.NotFound);
    }

    [TestMethod]
    public async Task Phase5B3BlockingTheCoachRevokesTheThumbnailAndTheOriginalTogether()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "p5b3-block-coach@example.test", "Block Coach", "Block Thumb");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "p5b3-block-client@example.test", true);
        SetTenant(client, workspaceId);

        var photo = await Phase5B3UploadAsync(client, "/api/progress/me/photos?pose=Side&photoDate=2026-08-22");
        var access = await Phase5B3GrantAsync(coach, photo.MediaAssetId);
        Assert.IsNotNull(access.ThumbnailUrl);
        await AssertStatusAsync(await coach.GetAsync(access.ThumbnailUrl), HttpStatusCode.OK);
        await AssertStatusAsync(await coach.GetAsync(access.Url), HttpStatusCode.OK);

        var details = await coach.GetFromJsonAsync<Phase5B3ClientDetails>($"/api/clients/{clientId}")
            ?? throw new AssertFailedException("Client details were empty.");
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync(
                $"/api/clients/{clientId}/relationship/block",
                new { reason = "Blocked for the thumbnail test.", details.Version }),
            HttpStatusCode.OK);

        // The grant cookie the coach already holds is still unexpired and still cryptographically
        // valid. Both variants re-authorize on every request, so both stop resolving at once.
        await AssertStatusAsync(await coach.GetAsync(access.ThumbnailUrl), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await coach.GetAsync(access.Url), HttpStatusCode.Forbidden);
        await Phase5B3AssertGrantRefusedAsync(coach, photo.MediaAssetId);

        // The client it depicts keeps both throughout.
        var owned = await Phase5B3GrantAsync(client, photo.MediaAssetId);
        Assert.IsNotNull(owned.ThumbnailUrl);
        await AssertStatusAsync(await client.GetAsync(owned.ThumbnailUrl), HttpStatusCode.OK);
        await AssertStatusAsync(await client.GetAsync(owned.Url), HttpStatusCode.OK);
    }

    [TestMethod]
    public async Task Phase5B3ThumbnailIsMateriallySmallerWhileTheOriginalStaysFullResolution()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "p5b3-size-coach@example.test", "Size Coach", "Size Thumb");
        using var client = CreateClient();
        await InviteAndAcceptAsync(coach, client, "p5b3-size-client@example.test", true);
        SetTenant(client, workspaceId);

        // Already upright, so the stored original keeps its 1200x900 dimensions and only the
        // rendition changes size. The EXIF description must not survive into either object.
        var original = ProgressPhotoImageFactory.DetailedJpegWithExif(
            1200,
            900,
            ProgressPhotoImageFactory.UprightOrientation);
        Assert.IsTrue(Contains(original, ProgressPhotoImageFactory.SecretDescription));

        var response = await PostProgressPhotoAsync(
            client,
            "/api/progress/me/photos?pose=Front&photoDate=2026-08-22",
            original);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        var photo = await RequiredJsonAsync<Phase5B3Photo>(response);

        var access = await Phase5B3GrantAsync(client, photo.MediaAssetId);
        Assert.IsNotNull(access.ThumbnailUrl);

        var thumbnailResponse = await client.GetAsync(access.ThumbnailUrl);
        await AssertStatusAsync(thumbnailResponse, HttpStatusCode.OK);
        var thumbnail = await thumbnailResponse.Content.ReadAsByteArrayAsync();

        // The original is still fetchable when the viewer deliberately opens it, at full size.
        var contentResponse = await client.GetAsync(access.Url);
        await AssertStatusAsync(contentResponse, HttpStatusCode.OK);
        var stored = await contentResponse.Content.ReadAsByteArrayAsync();
        Assert.AreEqual((1200, 900), ProgressPhotoImageFactory.Measure(stored));

        // The rendition is a real downscale, not a re-encode of the same pixels.
        var expected = MediaThumbnailPolicy.Fit(1200, 900);
        Assert.AreEqual(expected, ProgressPhotoImageFactory.Measure(thumbnail));
        Assert.AreEqual((480, 360), (expected.Width, expected.Height));
        Assert.IsLessThan(
            stored.Length,
            thumbnail.Length * 4,
            $"The thumbnail was {thumbnail.Length} bytes against a {stored.Length} byte original.");

        // The rendition is re-encoded from pixels like its parent, so it carries no metadata either.
        Assert.IsFalse(
            Contains(thumbnail, ProgressPhotoImageFactory.SecretDescription),
            "The EXIF description survived into the thumbnail.");
        Assert.IsFalse(ContainsExifApp1(thumbnail), "An EXIF APP1 segment survived into the thumbnail.");
        Assert.IsFalse(ContainsExifApp1(stored), "An EXIF APP1 segment survived into the original.");
    }

    /// <summary>
    /// Mints a grant for one asset. The pinned Phase 5 clock is resynced first because the grant
    /// embeds an absolute expiry that the data-protection provider also validates against real wall
    /// time, so a grant minted on the pinned instant would be born expired.
    /// </summary>
    private async Task<Phase5B3Access> Phase5B3GrantAsync(HttpClient caller, Guid mediaAssetId)
    {
        RequiredTestClock.Set(DateTimeOffset.UtcNow);
        await RefreshCsrfAsync(caller);
        var response = await caller.PostAsync($"/api/media/{mediaAssetId}/access", null);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<Phase5B3Access>(response);
    }

    private async Task Phase5B3AssertGrantRefusedAsync(HttpClient caller, Guid mediaAssetId)
    {
        RequiredTestClock.Set(DateTimeOffset.UtcNow);
        await RefreshCsrfAsync(caller);
        var response = await caller.PostAsync($"/api/media/{mediaAssetId}/access", null);
        Assert.IsTrue(
            response.StatusCode is HttpStatusCode.Forbidden or HttpStatusCode.NotFound,
            $"Expected the grant to be refused but received {(int)response.StatusCode}.");
    }

    private async Task Phase5B3AssertClosedAsync(
        HttpClient caller,
        Guid mediaAssetId,
        string contentPath,
        string thumbnailPath)
    {
        await Phase5B3AssertGrantRefusedAsync(caller, mediaAssetId);
        await AssertStatusAsync(await caller.GetAsync(thumbnailPath), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await caller.GetAsync(contentPath), HttpStatusCode.Forbidden);
    }

    private static async Task<Phase5B3Photo> Phase5B3UploadAsync(HttpClient caller, string url)
    {
        var response = await PostProgressPhotoAsync(caller, url, ProgressPhotoImageFactory.PlainJpeg(960, 720));
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<Phase5B3Photo>(response);
    }

    private sealed record Phase5B3Photo(Guid Id, Guid MediaAssetId, uint Version);
    private sealed record Phase5B3Access(string Url, string? ThumbnailUrl);
    private sealed record Phase5B3ClientDetails(uint Version);
}
