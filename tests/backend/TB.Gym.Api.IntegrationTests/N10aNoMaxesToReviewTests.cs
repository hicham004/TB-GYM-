using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using TB.Gym.Infrastructure.Application;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Training;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The notes plan's N10a (decision 19's note, 7 Nov 2026): maxes to review are gone from Coach Today, the client list
/// and a client's page, on the server (coach attention v7, CLI-018). Logged sets that P4b's rule read as a heavier
/// max (90 kg for 5 at RPE 8 over a 100 kg max suggested 110.974 kg) raise no item, change no status and leave nothing
/// of maxes in what the three reads send. Between programs No program still names the client's latest program not
/// cancelled, with nothing beside it, read for every client in scope at once. The test starts at midday in the
/// workspace's zone, so each whole day it steps lands on the next calendar day.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task N10aLoggedSetsRaiseNoMaxesToReviewOnTodayTheListOrAClientsPage()
    {
        var start = R61aStartAtMidday();
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2CustomStartAsync(coach, client, "n10a-reads", P4bWeeks);
        var block = await P2AssignAsync(coach, scenario, [P2SavedMax(scenario)]);
        var clientId = scenario.ClientId;

        // A second client of the same coach runs the same program from a week later (below), so the reads have two
        // clients with a program, and the latest-programs read must keep each client's programs apart.
        using var other = CreateClient();
        var otherId = await InviteAndAcceptAsync(coach, other, "n10a-reads-other@example.test", newAccount: true);
        var otherScenario = scenario with
        {
            ClientId = otherId,
            Enrollment = await CreateTrainingEnrollmentAsync(coach, otherId, TenantToday(), 8),
            Max = await RecordWorkingMaxAsync(coach, otherId, scenario.Exercise.Id, 100m),
        };

        // A three-week program running and nothing waiting: Today lists nothing for the client; the list and the page
        // say On track.
        var before = await N10aReadAsync(coach, clientId);
        Assert.AreEqual(
            new N10aReads(string.Empty, string.Empty, ClientOverviewStatus.OnTrack, string.Empty, ClientOverviewStatus.OnTrack),
            before);

        // A minute on, so the sets come after the max was set, the client logs 90 kg for 5 at RPE 8 over the 100 kg
        // max: 110.974 kg by BestLoggedSet v1 (STR-012), which Coach Today named as maxes to review until N10a.
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        await P4bLogTodayAsync(client, finish: true, new P4bLog(5, 60m, "Kilogram", null), new P4bLog(5, 90m, "Kilogram", 8m));

        // The three reads give the client the same kinds and status as before, and send nothing of maxes to review.
        Assert.AreEqual(before, await N10aReadAsync(coach, clientId), "Logged sets raise nothing for the coach.");
        await N10aAssertNoMaxesAsync(coach, clientId);

        // Weeks 2 and 3 are logged the same way; finishing the last session finishes the program. The second client's
        // program starts with week 2, after the first client's, so it is never the first client's latest.
        for (var week = 2; week <= 3; week++)
        {
            RequiredTestClock.Advance(TimeSpan.FromDays(7));
            if (week == 2)
            {
                await AssertStatusAsync(
                    await P4cAssignNextAsync(coach, otherScenario, P2SavedMax(otherScenario), Guid.NewGuid()),
                    HttpStatusCode.OK);
            }

            await P4bLogTodayAsync(client, finish: true, new P4bLog(5, 60m, "Kilogram", null), new P4bLog(5, 90m, "Kilogram", 8m));
        }

        Assert.AreEqual(
            MesocycleStatus.Completed,
            (await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(block.Id))).Status);

        // Between programs every read says No program, naming the program that ended and the day the client joined,
        // and nothing its logged sets suggest.
        await N10aAssertNoProgramAsync(coach, clientId, block.Id, start);
        await N10aAssertNoMaxesAsync(coach, clientId);

        // Each read asks for the latest program of every client in scope in one command, never one per client: Today
        // and the list read a row for each of the two clients, the page one for its client (a reader reads once more
        // than it has rows).
        foreach (var (url, programs) in new[] { (CoachTodayUrl, 2), (ClientOverviewUrl, 2), (R33bOverviewUrl(clientId), 1) })
        {
            RequiredTodayQueryCounter.Reset();
            await coach.GetStringAsync(url);
            Assert.AreEqual(
                (1, programs + 1),
                RequiredTodayQueryCounter.ReadsTagged(CoachOverviewReader.LatestProgramsTag),
                $"{url}: one read of the latest programs, whatever the client count.");
        }

        // A week on, a program assigned after it and then cancelled is never the one No program names: the latest
        // program not cancelled is.
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        var assigned = await P4cAssignNextAsync(coach, scenario, P2SavedMax(scenario), Guid.NewGuid());
        await AssertStatusAsync(assigned, HttpStatusCode.OK);
        var next = await ReadSlicePayloadAsync<TrainingMesocycleView>(assigned);
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync($"/api/training/mesocycles/{next.Id}/cancel", new { reason = "Changed plan", version = next.Version }),
            HttpStatusCode.OK);
        await N10aAssertNoProgramAsync(coach, clientId, block.Id, start);
    }

    // ---------- N10a helpers ----------

    /// <summary>
    /// What the three reads say about one client: the kinds Today, the list and the page give them, each in its own
    /// order, and the status the list and the page give them.
    /// </summary>
    private sealed record N10aReads(
        string Today,
        string List,
        ClientOverviewStatus ListStatus,
        string Page,
        ClientOverviewStatus PageStatus);

    /// <summary>Coach Today, the client list and the client's page.</summary>
    private static string[] N10aUrls(Guid clientId) => [CoachTodayUrl, ClientOverviewUrl, R33bOverviewUrl(clientId)];

    private static async Task<N10aReads> N10aReadAsync(HttpClient coach, Guid clientId)
    {
        var today = await ReadSliceAsync<CoachTodayView>(coach, CoachTodayUrl);
        var row = (await ReadSliceAsync<ClientOverviewView>(coach, ClientOverviewUrl)).Clients
            .Single(item => item.Client.ClientProfileId == clientId);
        var page = await ReadSliceAsync<ClientProfileOverviewView>(coach, R33bOverviewUrl(clientId));
        return new N10aReads(
            string.Join(", ", today.Attention.Where(item => item.Client.ClientProfileId == clientId).Select(item => item.Kind)),
            string.Join(", ", row.Attention),
            row.Status,
            string.Join(", ", page.Attention.Select(item => item.Kind)),
            page.Status);
    }

    /// <summary>Asserts that none of the three reads sends the removed kind or a maxes key anywhere in its JSON.</summary>
    private static async Task N10aAssertNoMaxesAsync(HttpClient coach, Guid clientId)
    {
        foreach (var url in N10aUrls(clientId))
        {
            // Typed reads skip a member they do not know, so only the text proves the key is gone; the API writes
            // nulls, so before N10a every item carried "maxes":null.
            var raw = await coach.GetStringAsync(url);
            Assert.DoesNotContain("MaxesToReview", raw, StringComparison.OrdinalIgnoreCase, url);
            Assert.DoesNotContain("\"maxes\"", raw, StringComparison.OrdinalIgnoreCase, url);
        }
    }

    /// <summary>
    /// Asserts that each read gives the client No program alone, Needs attention on the list and the page, naming
    /// <paramref name="programId"/> and the day they joined, with no maxes key beside them.
    /// </summary>
    private static async Task N10aAssertNoProgramAsync(HttpClient coach, Guid clientId, Guid programId, DateOnly joinedOn)
    {
        Assert.AreEqual(
            new N10aReads("NoProgram", "NoProgram", ClientOverviewStatus.NeedsAttention, "NoProgram", ClientOverviewStatus.NeedsAttention),
            await N10aReadAsync(coach, clientId));
        foreach (var url in N10aUrls(clientId))
        {
            var item = (await N10aRawItemsAsync(coach, url, clientId)).Single();
            Assert.AreEqual(
                $"NoProgram {programId} {joinedOn:yyyy-MM-dd}",
                $"{item.GetProperty("kind").GetString()} {item.GetProperty("subjectId").GetString()} {item.GetProperty("date").GetString()}",
                url);
            Assert.IsFalse(item.TryGetProperty("maxes", out _), $"{url}: No program carries no maxes.");
        }
    }

    /// <summary>
    /// The attention items one read sends about the client, as raw JSON: Today's and the page's <c>attention</c>, the
    /// list row's <c>attentionItems</c>. Cloned, so they outlive the document.
    /// </summary>
    private static async Task<JsonElement[]> N10aRawItemsAsync(HttpClient coach, string url, Guid clientId)
    {
        using var document = JsonDocument.Parse(await coach.GetStringAsync(url));
        var root = document.RootElement;
        var items = url == ClientOverviewUrl
            ? root.GetProperty("clients").EnumerateArray()
                .Where(row => row.GetProperty("client").GetProperty("clientProfileId").GetGuid() == clientId)
                .SelectMany(row => row.GetProperty("attentionItems").EnumerateArray())
            : root.GetProperty("attention").EnumerateArray()
                .Where(item => item.GetProperty("client").GetProperty("clientProfileId").GetGuid() == clientId);
        return [.. items.Select(item => item.Clone())];
    }
}
