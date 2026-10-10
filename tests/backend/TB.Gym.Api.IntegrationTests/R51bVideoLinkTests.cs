using System.Net;
using System.Net.Http.Json;
using ExerciseView = TB.Gym.Modules.ExerciseLibrary.ExerciseView;
using MediaAssetStatus = TB.Gym.Modules.Media.MediaAssetStatus;
using MediaAssetView = TB.Gym.Modules.Media.MediaAssetView;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// R5.1b, one asset per video link (MED-015): adding a YouTube or Vimeo video the workspace already
/// has returns that asset, a removed one comes back, two coaches adding it at once end with one, and
/// another workspace keeps its own. It used to answer 500 from the unique index.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private static readonly string[] R51bKneeFriendly = ["knee-friendly"];

    private static async Task<HttpResponseMessage> R51bAddLinkAsync(HttpClient coach, string videoId, string title)
    {
        await RefreshCsrfAsync(coach);
        return await coach.PostAsJsonAsync("/api/media/external", new
        {
            title,
            provider = "YouTube",
            externalMediaId = videoId,
        });
    }

    private static async Task<MediaAssetView> R51bAddLinkOkAsync(HttpClient coach, string videoId, string title)
    {
        var response = await R51bAddLinkAsync(coach, videoId, title);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<MediaAssetView>(response);
    }

    [TestMethod]
    public async Task R51bAVideoLinkIsAddedOncePerWorkspaceAndComesBackAfterItIsRemoved()
    {
        using var owner = CreateClient();
        await RegisterCoachAsync(owner, "r51b-owner@example.test", "R51b Owner", "R51b Gym");
        using var coach = CreateClient();
        await JoinAsCoachAsync(owner, coach, "r51b-coach@example.test", "Pat Coach");

        var first = await R51bAddLinkOkAsync(owner, "dQw4w9WgXcQ", "Back squat demo");
        Assert.AreEqual(MediaAssetStatus.Ready, first.Status);

        // The same video again, by the same coach or a colleague, is the same asset with its first title.
        var again = await R51bAddLinkOkAsync(owner, "dQw4w9WgXcQ", "Paused squat demo");
        var colleague = await R51bAddLinkOkAsync(coach, "dQw4w9WgXcQ", "Squat");
        Assert.AreEqual((first.Id, first.Id, "Back squat demo"), (again.Id, colleague.Id, colleague.Title));
        Assert.AreEqual(1L, await P2CountAsync(
            "SELECT count(*) FROM media.\"Assets\" WHERE \"ExternalMediaId\" = 'dQw4w9WgXcQ' AND \"TenantId\" = (SELECT \"TenantId\" FROM media.\"Assets\" WHERE \"Id\" = @id)",
            first.Id));

        // Removed, then added again: it comes back, ready, as the same asset.
        await RefreshCsrfAsync(owner);
        var removed = await owner.SendAsync(new HttpRequestMessage(HttpMethod.Delete, $"/api/media/{first.Id}")
        {
            Content = JsonContent.Create(new { version = first.Version }),
        });
        await AssertStatusAsync(removed, HttpStatusCode.OK);
        Assert.AreEqual(MediaAssetStatus.Tombstoned, (await ReadSlicePayloadAsync<MediaAssetView>(removed)).Status);
        var back = await R51bAddLinkOkAsync(owner, "dQw4w9WgXcQ", "Back squat demo");
        Assert.AreEqual((first.Id, MediaAssetStatus.Ready), (back.Id, back.Status));

        // Another workspace has its own copy.
        using var stranger = CreateClient();
        await RegisterCoachAsync(stranger, "r51b-stranger@example.test", "R51b Stranger", "R51b Stranger Gym");
        var theirs = await R51bAddLinkOkAsync(stranger, "dQw4w9WgXcQ", "Their demo");
        Assert.AreNotEqual(first.Id, theirs.Id);

        // A client cannot add to the coach's media.
        using var client = CreateClient();
        await InviteAndAcceptAsync(owner, client, "r51b-client@example.test", newAccount: true);
        await AssertStatusAsync(await R51bAddLinkAsync(client, "aaaaaaaaaaa", "Mine"), HttpStatusCode.Forbidden);
    }

    [TestMethod]
    public async Task R51bTwoCoachesAddingTheSameVideoAtOnceEndWithOneAsset()
    {
        using var owner = CreateClient();
        await RegisterCoachAsync(owner, "r51b-race-owner@example.test", "R51b Owner", "R51b Race Gym");
        using var coach = CreateClient();
        await JoinAsCoachAsync(owner, coach, "r51b-race-coach@example.test", "Pat Coach");
        await RefreshCsrfAsync(owner);
        await RefreshCsrfAsync(coach);

        var payload = new { title = "Deadlift demo", provider = "YouTube", externalMediaId = "Xyz_123-abC" };
        var responses = await Task.WhenAll(
            owner.PostAsJsonAsync("/api/media/external", payload),
            coach.PostAsJsonAsync("/api/media/external", payload));
        foreach (var response in responses)
        {
            await AssertStatusAsync(response, HttpStatusCode.OK);
        }

        var ids = await Task.WhenAll(responses.Select(response => ReadSlicePayloadAsync<MediaAssetView>(response)));
        Assert.AreEqual(ids[0].Id, ids[1].Id);
    }

    [TestMethod]
    public async Task R51bEditingAnExerciseAddsAndRemovesItsMusclesTagsSwapsAndMedia()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "r51b-edit@example.test", "R51b Coach", "R51b Edit Gym");
        var link = await R51bAddLinkOkAsync(coach, "dQw4w9WgXcQ", "Squat demo");
        var second = await R51bAddLinkOkAsync(coach, "aBcDeFgHiJk", "Squat side view");
        var goblet = await CreateExerciseAsync(coach, "Goblet squat", [], []);
        var squat = await CreateExerciseAsync(coach, "Back squat", [], [link.Id]);

        // One save adds a muscle, a tag, a swap and a second video, and drops the first tag.
        await RefreshCsrfAsync(coach);
        var edited = await coach.PutAsJsonAsync($"/api/exercises/{squat.Id}", new
        {
            name = "Back squat",
            instructions = "Brace, then sit between the hips.",
            equipment = "Barbell",
            movementPattern = "Squat",
            classification = "Strength",
            muscles = new[]
            {
                new { muscle = "Quadriceps", role = "Primary" },
                new { muscle = "Glutes", role = "Secondary" },
            },
            tags = R51bKneeFriendly,
            alternatives = new[] { new { exerciseId = goblet.Id, note = (string?)null } },
            mediaAssetIds = new[] { link.Id, second.Id },
            version = squat.Version,
        });
        await AssertStatusAsync(edited, HttpStatusCode.OK);
        var view = await ReadSlicePayloadAsync<ExerciseView>(edited);
        Assert.HasCount(2, view.Muscles);
        CollectionAssert.AreEqual(R51bKneeFriendly, view.Tags.ToArray());
        Assert.AreEqual(goblet.Id, view.Alternatives.Single().ExerciseId);
        CollectionAssert.AreEqual(new[] { link.Id, second.Id }, view.MediaAssetIds.ToArray());

        // The next save, from the version it returned, can reorder and drop again.
        await RefreshCsrfAsync(coach);
        var again = await coach.PutAsJsonAsync($"/api/exercises/{squat.Id}", new
        {
            name = "Back squat",
            instructions = (string?)null,
            equipment = "Barbell",
            movementPattern = "Squat",
            classification = "Strength",
            muscles = new[] { new { muscle = "Glutes", role = "Primary" } },
            tags = Array.Empty<string>(),
            alternatives = Array.Empty<object>(),
            mediaAssetIds = new[] { second.Id },
            version = view.Version,
        });
        await AssertStatusAsync(again, HttpStatusCode.OK);
        var last = await ReadSlicePayloadAsync<ExerciseView>(again);
        CollectionAssert.AreEqual(new[] { second.Id }, last.MediaAssetIds.ToArray());
        Assert.AreEqual((1, 0, 0), (last.Muscles.Count, last.Tags.Count, last.Alternatives.Count));
    }
}
