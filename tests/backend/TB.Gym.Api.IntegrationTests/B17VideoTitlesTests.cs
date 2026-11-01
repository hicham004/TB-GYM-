using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Npgsql;
using TB.Gym.Infrastructure.Initialization;
using MediaAssetStatus = TB.Gym.Modules.Media.MediaAssetStatus;
using MediaAssetView = TB.Gym.Modules.Media.MediaAssetView;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The one-time job for older video links (critique B17, MED-015): <c>video-titles</c> asks YouTube or Vimeo once for
/// every link with no title, in every workspace, as adding a link does. A video that is gone keeps its tile as it is,
/// a link with a title is not asked about, and running it twice changes nothing.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task B17TheJobAsksOnceForEveryLinkWithNoTitleInEveryWorkspaceAndASecondRunChangesNothing()
    {
        var fake = oEmbed ?? throw new InvalidOperationException("The video title fake is not running.");
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "b17-coach@example.test", "B17 Coach", "B17 Gym");
        using var stranger = CreateClient();
        await RegisterCoachAsync(stranger, "b17-stranger@example.test", "B17 Stranger", "B17 Stranger Gym");

        // Added while the provider says nothing, which is how a link from before B9 reads. The same video in another
        // workspace is its own link, and a removed one is still a link with no title.
        var squat = await R51bAddLinkOkAsync(coach, "OlderLink01", "Back Squat");
        var theirs = await R51bAddLinkOkAsync(stranger, "OlderLink01", "Their squat");
        await RefreshCsrfAsync(coach);
        var vimeoResponse = await coach.PostAsJsonAsync("/api/media/external", new { title = "Hinge", provider = "Vimeo", externalMediaId = "76979871" });
        await AssertStatusAsync(vimeoResponse, HttpStatusCode.OK);
        var hinge = await ReadSlicePayloadAsync<MediaAssetView>(vimeoResponse);
        var removed = await R51bAddLinkOkAsync(coach, "OlderLink02", "Removed demo");
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.SendAsync(new HttpRequestMessage(HttpMethod.Delete, $"/api/media/{removed.Id}")
            {
                Content = JsonContent.Create(new { version = removed.Version }),
            }),
            HttpStatusCode.OK);

        // Each way a provider can fail to say.
        var gone = await R51bAddLinkOkAsync(coach, OEmbedFake.NotFoundId, "Gone demo");
        var down = await R51bAddLinkOkAsync(coach, OEmbedFake.UnreachableId, "Provider down");
        var notJson = await R51bAddLinkOkAsync(coach, OEmbedFake.NotJsonId, "Not JSON");

        // A link that has its title, and an upload, which has none to ask for.
        fake.Titles["HasTitle001"] = "Its own title";
        var titled = await R51bAddLinkOkAsync(coach, "HasTitle001", "Titled demo");
        await UploadJpegAsync(coach);

        fake.Titles["OlderLink01"] = "  How to Back Squat\n\u202E| Starting Strength  ";
        fake.Titles["OlderLink02"] = "A removed demo";
        fake.Titles["76979871"] = "The Hip Hinge";
        fake.Titles["HasTitle001"] = "Renamed on YouTube";
        var before = await B17RowsAsync();
        var asked = fake.Asked.Count;

        using (var output = new StringWriter())
        {
            Assert.AreEqual(0, await VideoTitlesCommand.RunAsync(RequiredFactory.Services, [VideoTitlesCommand.Name], output));
            Assert.AreEqual(
                string.Join(
                    Environment.NewLine,
                    "Video links with no title: 7",
                    "Given their title: 4",
                    "Left as they are: 3",
                    "A video that is gone or private stays as it is. Running this again asks about these once more, " +
                    "which fills in any whose provider could not say just now.",
                    string.Empty),
                output.ToString());
        }

        // Once each, the seven links with no title and nothing else, at the same address adding a link asks.
        Assert.AreEqual(7, fake.Asked.Count - asked);
        var addresses = fake.Asked.Skip(asked).ToArray();
        Assert.AreEqual(
            2,
            addresses.Count(address => address == "https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DOlderLink01"),
            "A video in two workspaces is two links.");
        CollectionAssert.Contains(addresses, "https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F76979871");
        Assert.IsFalse(addresses.Any(address => address.Contains("HasTitle001", StringComparison.Ordinal)));

        // The title is the provider's made fit to show, in each workspace's own row, and the name the coach's screen
        // gave stays. A removed link takes it too and stays removed.
        Assert.AreEqual(
            ("How to Back Squat | Starting Strength", "Back Squat"),
            await B17TitlesAsync(coach, squat.Id));
        Assert.AreEqual(
            ("How to Back Squat | Starting Strength", "Their squat"),
            await B17TitlesAsync(stranger, theirs.Id));
        Assert.AreEqual(("The Hip Hinge", "Hinge"), await B17TitlesAsync(coach, hinge.Id));
        var after = await B17RowsAsync();
        StringAssert.Contains(after[removed.Id], "A removed demo");
        StringAssert.Contains(after[removed.Id], nameof(MediaAssetStatus.Tombstoned));

        // A video that is gone keeps its tile as it is: nothing about its row changed, nor the others left alone.
        foreach (var kept in new[] { gone.Id, down.Id, notJson.Id, titled.Id })
        {
            Assert.AreEqual(before[kept], after[kept]);
        }

        Assert.HasCount(before.Count, after);
        Assert.HasCount(4, before.Keys.Where(id => before[id] != after[id]));

        // A second run asks only about those still with no title, and changes nothing.
        asked = fake.Asked.Count;
        using (var second = new StringWriter())
        {
            Assert.AreEqual(0, await VideoTitlesCommand.RunAsync(RequiredFactory.Services, [VideoTitlesCommand.Name], second));
            StringAssert.Contains(second.ToString(), "Video links with no title: 3");
            StringAssert.Contains(second.ToString(), "Given their title: 0");
        }

        Assert.AreEqual(3, fake.Asked.Count - asked);
        CollectionAssert.AreEquivalent(after, await B17RowsAsync());

        // A provider that was only down answers a later run.
        fake.Titles[OEmbedFake.NotFoundId] = "Back online";
        Assert.AreEqual(0, await VideoTitlesCommand.RunAsync(RequiredFactory.Services, [VideoTitlesCommand.Name], TextWriter.Null));
        Assert.AreEqual(("Back online", "Gone demo"), await B17TitlesAsync(coach, gone.Id));

        // With every link answered there is nothing left to ask.
        await B9ExecuteAsync("UPDATE media.\"Assets\" SET \"ExternalTitle\" = 'Filled' WHERE \"Id\" = @id", down.Id);
        await B9ExecuteAsync("UPDATE media.\"Assets\" SET \"ExternalTitle\" = 'Filled' WHERE \"Id\" = @id", notJson.Id);
        asked = fake.Asked.Count;
        using var last = new StringWriter();
        Assert.AreEqual(0, await VideoTitlesCommand.RunAsync(RequiredFactory.Services, [VideoTitlesCommand.Name], last));
        Assert.AreEqual(
            string.Join(
                Environment.NewLine,
                "Video links with no title: 0",
                "Given their title: 0",
                "Left as they are: 0",
                string.Empty),
            last.ToString());
        Assert.HasCount(asked, fake.Asked);
    }

    [TestMethod]
    public async Task B17ALinkGivenItsTitleWhileTheJobAsksKeepsThatTitle()
    {
        var fake = oEmbed ?? throw new InvalidOperationException("The video title fake is not running.");
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "b17-meanwhile@example.test", "B17 Coach", "B17 Meanwhile");
        var link = await R51bAddLinkOkAsync(coach, "Meanwhile01", "Back Squat");
        fake.Titles["Meanwhile01"] = "From the job";

        // A coach adds the same video while the provider is answering the job, and adding it fills the title first.
        fake.WhileAsking = async _ =>
        {
            fake.WhileAsking = null;
            await B9ExecuteAsync("UPDATE media.\"Assets\" SET \"ExternalTitle\" = 'From the coach' WHERE \"Id\" = @id", link.Id);
        };
        using var output = new StringWriter();

        Assert.AreEqual(0, await VideoTitlesCommand.RunAsync(RequiredFactory.Services, [VideoTitlesCommand.Name], output));

        StringAssert.Contains(output.ToString(), "Given their title: 0");
        Assert.AreEqual(("From the coach", "Back Squat"), await B17TitlesAsync(coach, link.Id));
    }

    [TestMethod]
    public async Task B17TheJobRefusesAnythingElseOnItsCommandLineAndAsksNobody()
    {
        var fake = oEmbed ?? throw new InvalidOperationException("The video title fake is not running.");
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "b17-usage@example.test", "B17 Coach", "B17 Usage");
        await R51bAddLinkOkAsync(coach, "OlderLink01", "Back Squat");
        var asked = fake.Asked.Count;
        using var output = new StringWriter();

        Assert.AreEqual(2, await VideoTitlesCommand.RunAsync(RequiredFactory.Services, [VideoTitlesCommand.Name, "--all"], output));

        Assert.AreEqual("Usage: video-titles" + Environment.NewLine, output.ToString());
        Assert.HasCount(asked, fake.Asked);
        Assert.IsTrue(VideoTitlesCommand.IsInvocation(["video-titles"]));
        Assert.IsFalse(VideoTitlesCommand.IsInvocation(["platform-admin"]));
        Assert.IsFalse(VideoTitlesCommand.IsInvocation([]));
    }

    /// <summary>What the coach's media list says of a link: the provider's title, then the name their screen gave it.</summary>
    private static async Task<(string? ExternalTitle, string Title)> B17TitlesAsync(HttpClient coach, Guid id)
    {
        using var list = JsonDocument.Parse(await coach.GetStringAsync("/api/media?skip=0&take=100"));
        var row = list.RootElement.GetProperty("items").EnumerateArray()
            .Single(item => item.GetProperty("id").GetGuid() == id);
        return (row.GetProperty("externalTitle").GetString(), row.GetProperty("title").GetString()!);
    }

    /// <summary>Every media row as the database holds it, its row version among the rest, so that any write shows.</summary>
    private async Task<Dictionary<Guid, string>> B17RowsAsync()
    {
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT \"Id\", concat_ws(' | ', \"Title\", \"ExternalTitle\", \"Status\", \"UpdatedAtUtc\"::text, xmin::text) FROM media.\"Assets\"";
        await using var reader = await command.ExecuteReaderAsync();
        var rows = new Dictionary<Guid, string>();
        while (await reader.ReadAsync())
        {
            rows[reader.GetGuid(0)] = reader.GetString(1);
        }

        return rows;
    }
}
