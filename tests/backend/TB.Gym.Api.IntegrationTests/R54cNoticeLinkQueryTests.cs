using System.Net;
using System.Net.Http.Json;
using TB.Gym.Modules.Training;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// R5.4c (review finding E2): an inbox page works out where its week notices lead from one read of their
/// programs and one of their weeks, however many week notices the page holds, and each notice still opens
/// the week it did before: the first of its delivered weeks the client can open now, and none for a
/// cancelled program.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task R54cAnInboxPageReadsTheProgramsAndWeeksOfItsWeekNoticesOnceEach()
    {
        using var coach = CreateClient();
        using var client = CreateClient();
        var scenario = await P2StartAsync(coach, client, "r54c-links", 3);
        SetTenant(client, scenario.WorkspaceId);

        // The first program shares every week, then week 3 again: two week notices, then it is cancelled.
        var first = scenario.Block;
        var firstVersion = await R54cRevealAllAsync(coach, first.Id, first.Version);
        await R51cSweepAsync();
        firstVersion = await R54cShareWeekThreeAgainAsync(coach, first.Id, firstVersion);
        await R51cSweepAsync();
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync($"/api/training/mesocycles/{first.Id}/cancel", new { reason = "A new plan", version = firstVersion }),
            HttpStatusCode.OK);

        // The program that replaces it does the same: two more week notices, on a program still running.
        var second = await AssignAsync(coach, scenario.ClientId, scenario.Resources, TenantToday());
        var secondVersion = await R54cRevealAllAsync(coach, second.Id, second.Version);
        await R51cSweepAsync();
        await R54cShareWeekThreeAgainAsync(coach, second.Id, secondVersion);
        await R51cSweepAsync();

        RequiredTodayQueryCounter.Reset();
        var page = await RequiredJsonAsync<R54cInbox>(await client.GetAsync("/api/notifications"));
        var commands = RequiredTodayQueryCounter.Commands;

        var weekNotices = page.Items
            .Where(item => item.Kind is "WeeksShared" or "WeeksChanged")
            .Select(item => (item.MesocycleId, item.Title, item.WeekNumber))
            .OrderBy(item => item.MesocycleId == first.Id ? 0 : 1)
            .ThenBy(item => item.Title, StringComparer.Ordinal)
            .ToArray();
        CollectionAssert.AreEqual(
            new (Guid?, string, int?)[]
            {
                (first.Id, "Your coach shared week 3", null),
                (first.Id, "Your coach shared weeks 2 and 3", null),
                (second.Id, "Your coach shared week 3", 3),
                (second.Id, "Your coach shared weeks 2 and 3", 2),
            },
            weekNotices,
            "A cancelled program's notices open no week; a running one's open the first delivered week still open.");

        Console.WriteLine($"R5.4c inbox page with four week notices on two programs: {commands.Count} SQL commands.");
        Assert.AreEqual(
            1,
            commands.Count(text => text.Contains("training.\"Mesocycles\"", StringComparison.Ordinal)),
            "The page's programs are read once:\n" + string.Join("\n---\n", commands));
        Assert.AreEqual(
            1,
            commands.Count(text => text.Contains("training.\"MesocycleWeeks\"", StringComparison.Ordinal)),
            "The page's weeks are read once:\n" + string.Join("\n---\n", commands));
    }

    private static async Task<uint> R54cRevealAllAsync(HttpClient coach, Guid mesocycleId, uint version)
    {
        await RefreshCsrfAsync(coach);
        var revealed = await coach.PutAsJsonAsync(
            $"/api/training/mesocycles/{mesocycleId}/visibility",
            new { revealAllWeeks = true, version });
        await AssertStatusAsync(revealed, HttpStatusCode.OK);
        return (await ReadSlicePayloadAsync<TrainingMesocycleView>(revealed)).Version;
    }

    /// <summary>Week 3 unshared and shared again is said once more, for that week alone (R5.1c).</summary>
    private static async Task<uint> R54cShareWeekThreeAgainAsync(HttpClient coach, Guid mesocycleId, uint version)
    {
        var weekThree = (await ReadSliceAsync<TrainingMesocycleView>(coach, P2MesocycleUrl(mesocycleId)))
            .Weeks.Single(week => week.WeekNumber == 3).Id;
        version = await R51cPublishAsync(coach, mesocycleId, weekThree, false, version);
        return await R51cPublishAsync(coach, mesocycleId, weekThree, true, version);
    }

    private sealed record R54cNotice(Guid Id, string Kind, string Title, int? WeekNumber, Guid? MesocycleId);

    private sealed record R54cInbox(long Total, R54cNotice[] Items);
}
