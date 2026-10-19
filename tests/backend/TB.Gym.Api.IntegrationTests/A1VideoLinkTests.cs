using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using MediaAssetView = TB.Gym.Modules.Media.MediaAssetView;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Audit batch A1 (WEA-2, C18): a YouTube or Vimeo link opens on its own site. The grant names the
/// provider and the video's page, built from the stored id on the provider's own host, beside the
/// privacy-oriented embed address kept for the day embedding ships.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task A1AVideoLinkGrantNamesTheProviderAndTheVideosOwnPage()
    {
        using var owner = CreateClient();
        await RegisterCoachAsync(owner, "a1-video@example.test", "A1 Video Owner", "A1 Video Gym");
        var youTube = await R51bAddLinkOkAsync(owner, "dQw4w9WgXcQ", "Back squat demo");
        await RefreshCsrfAsync(owner);
        var vimeoResponse = await owner.PostAsJsonAsync("/api/media/external", new
        {
            title = "Hinge demo",
            provider = "Vimeo",
            externalMediaId = "76979871",
        });
        await AssertStatusAsync(vimeoResponse, HttpStatusCode.OK);
        var vimeo = await ReadSlicePayloadAsync<MediaAssetView>(vimeoResponse);

        RequiredTestClock.Set(DateTimeOffset.UtcNow);
        foreach (var (id, provider, embed, watch) in new[]
                 {
                     (youTube.Id, "YouTube", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
                     (vimeo.Id, "Vimeo", "https://player.vimeo.com/video/76979871", "https://vimeo.com/76979871"),
                 })
        {
            await RefreshCsrfAsync(owner);
            var response = await owner.PostAsync($"/api/media/{id}/access", null);
            await AssertStatusAsync(response, HttpStatusCode.OK);
            var access = await response.Content.ReadFromJsonAsync<JsonElement>();
            Assert.AreEqual("ExternalEmbed", access.GetProperty("source").GetString());
            Assert.AreEqual(provider, access.GetProperty("externalProvider").GetString());
            Assert.AreEqual(watch, access.GetProperty("watchUrl").GetString());
            Assert.AreEqual(embed, access.GetProperty("url").GetString(), "The embed address stays for C18's later half.");
        }
    }
}
