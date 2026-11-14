using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Npgsql;
using TB.Gym.Modules.Training;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Critique B19 (TRN-031): "Can see finished programs", a coach's choice for one client, on by default. Off,
/// the server keeps finished programs from the client's Training page. It never hides a running or next
/// program, nor the client's own workouts, records and progress, and no coach screen changes.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private static string B19Url(Guid clientId) => $"/api/training/clients/{clientId}/finished-programs";

    [TestMethod]
    public async Task B19OffHidesAFinishedProgramFromTheClientAloneAndOnBringsItBack()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "b19-hide-coach@example.test", "Karim Haddad", "B19 Hide");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "b19-hide-client@example.test", true);
        SetTenant(client, tenant);
        var resources = await CreateTrainingResourcesAsync(coach, clientId, 8, 1, today);
        var block = await AssignAsync(coach, clientId, resources, today);
        var name = (await ReadSliceAsync<TrainingMesocycleView>(coach, $"/api/training/mesocycles/{block.Id}")).Name;
        Assert.IsNotNull((await R61aFinishTodaysWorkoutAsync(client, 80m)).FinishedProgram);

        // On by default, with no choice made: the Training page and the share card read the finished program.
        Assert.AreEqual(new FinishedProgramsVisibilityView(true, 0), await B19ChoiceAsync(coach, clientId));
        var shown = await ReadSliceAsync<ClientTrainingProgramView>(client, B18ProgramUrl);
        Assert.AreEqual((block.Id, ClientProgramPhase.Finished), (shown.Program?.Id, shown.Program?.Phase));
        await AssertStatusAsync(await client.GetAsync(R61aSummaryUrl(block.Id)), HttpStatusCode.OK);

        async Task<string[]> TheClientsOwnAsync() =>
        [
            await client.GetStringAsync("/api/training/me/history"),
            await client.GetStringAsync("/api/training/me/personal-records"),
            await client.GetStringAsync(B6OwnDashboardUrl),
            await client.GetStringAsync("/api/training/me/today"),
            await client.GetStringAsync("/api/training/me/week"),
            await client.GetStringAsync("/api/training/me/upcoming"),
        ];

        async Task<string> TheCoachsProgramsAsync()
        {
            using var read = JsonDocument.Parse(await coach.GetStringAsync(R34aProgramUrl(clientId)));
            return read.RootElement.GetProperty("blocks").GetRawText();
        }

        var own = await TheClientsOwnAsync();
        var programs = await TheCoachsProgramsAsync();

        // Off: the server sends nothing of it, and the rest of the client's training reads as before.
        var off = await B19SetAsync(coach, clientId, false, 0);
        Assert.IsFalse(off.CanSeeFinishedPrograms);
        Assert.AreEqual(off, await B19ChoiceAsync(coach, clientId));
        var hidden = await ReadSliceAsync<ClientTrainingProgramView>(client, B18ProgramUrl);
        Assert.AreEqual((true, "Granted", null, null, (DateOnly?)null),
            (hidden.IsAllowed, hidden.AccessReason, hidden.Program, hidden.NextProgram, hidden.NextProgramStartDate));
        Assert.DoesNotContain(name, await client.GetStringAsync(B18ProgramUrl));
        await AssertStatusAsync(await client.GetAsync(R61aSummaryUrl(block.Id)), HttpStatusCode.NotFound);
        CollectionAssert.AreEqual(own, await TheClientsOwnAsync());
        var history = await ReadSliceAsync<ClientWorkoutHistoryPage>(client, "/api/training/me/history");
        Assert.HasCount(1, history.Items, "The client's own logged workout stays.");
        Assert.HasCount(1, (await ReadSliceAsync<ClientPersonalRecordsResult>(client, "/api/training/me/personal-records")).Items);
        Assert.AreEqual(programs, await TheCoachsProgramsAsync(), "Coach screens do not change.");

        // On again: nothing was lost.
        var on = await B19SetAsync(coach, clientId, true, off.Version);
        Assert.IsTrue(on.CanSeeFinishedPrograms);
        Assert.AreEqual(block.Id, (await ReadSliceAsync<ClientTrainingProgramView>(client, B18ProgramUrl)).Program?.Id);
        await AssertStatusAsync(await client.GetAsync(R61aSummaryUrl(block.Id)), HttpStatusCode.OK);
    }

    [TestMethod]
    public async Task B19OffNeverHidesARunningOrNextProgramAndHidesOnePastItsLastDayToo()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "b19-running-coach@example.test", "Karim Haddad", "B19 Running");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "b19-running-client@example.test", true);
        SetTenant(client, tenant);
        var resources = await CreateTrainingResourcesAsync(coach, clientId, 12, 1, today);
        var first = await AssignAsync(coach, clientId, resources, today);
        await R61aFinishTodaysWorkoutAsync(client, 80m);
        var second = await AssignAsync(coach, clientId, resources, today.AddDays(7));
        var third = await B18AssignAsync(coach, clientId, resources, resources.Enrollment.Id, resources.Template.Id,
            today.AddDays(14), true, "Shown early");
        await B19SetAsync(coach, clientId, false, 0);

        // With a finished program behind it, the next program is the page's, and the one shown early stays.
        var read = await ReadSliceAsync<ClientTrainingProgramView>(client, B18ProgramUrl);
        Assert.AreEqual((second.Id, ClientProgramPhase.Upcoming, (Guid?)third.Id),
            (read.Program?.Id, read.Program?.Phase, read.NextProgram?.Id));

        // The running program.
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        read = await ReadSliceAsync<ClientTrainingProgramView>(client, B18ProgramUrl);
        Assert.AreEqual((second.Id, ClientProgramPhase.Current, (Guid?)third.Id),
            (read.Program?.Id, read.Program?.Phase, read.NextProgram?.Id));

        // Finishing it is the client's own moment: the finish summary keeps its facts, off the Training page.
        var finish = await R61aFinishTodaysWorkoutAsync(client, 82.5m);
        Assert.AreEqual(second.Id, finish.FinishedProgram?.Id);
        await AssertStatusAsync(await client.GetAsync(R61aSummaryUrl(second.Id)), HttpStatusCode.NotFound);
        read = await ReadSliceAsync<ClientTrainingProgramView>(client, B18ProgramUrl);
        Assert.AreEqual((third.Id, ClientProgramPhase.Upcoming), (read.Program?.Id, read.Program?.Phase));
        Assert.IsNull(read.NextProgram);

        // A program past its last day that nobody closed is finished for the client, so it goes too.
        RequiredTestClock.Advance(TimeSpan.FromDays(14));
        read = await ReadSliceAsync<ClientTrainingProgramView>(client, B18ProgramUrl);
        Assert.AreEqual((true, null), (read.IsAllowed, read.Program));
        await AssertStatusAsync(await client.GetAsync(R61aSummaryUrl(third.Id)), HttpStatusCode.NotFound);
        var active = (await ReadSliceAsync<CoachClientProgramView>(coach, R34aProgramUrl(clientId))).Blocks;
        Assert.HasCount(3, active, "The coach keeps every program.");
        Assert.AreEqual(first.Id, active[^1].Id);

        var choice = await B19ChoiceAsync(coach, clientId) ?? throw new AssertFailedException("The choice is missing.");
        await B19SetAsync(coach, clientId, true, choice.Version);
        read = await ReadSliceAsync<ClientTrainingProgramView>(client, B18ProgramUrl);
        Assert.AreEqual((third.Id, ClientProgramPhase.Finished), (read.Program?.Id, read.Program?.Phase));
    }

    [TestMethod]
    public async Task B19ACancelledProgramNeverReachesTheClientWhateverTheCoachChose()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "b19-cancel-coach@example.test", "Karim Haddad", "B19 Cancel");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "b19-cancel-client@example.test", true);
        SetTenant(client, tenant);
        var resources = await CreateTrainingResourcesAsync(coach, clientId, 8, 2, today);
        var block = await AssignAsync(coach, clientId, resources, today);
        await R61aFinishTodaysWorkoutAsync(client, 80m);
        var version = (await ReadSliceAsync<TrainingMesocycleView>(coach, $"/api/training/mesocycles/{block.Id}")).Version;
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync($"/api/training/mesocycles/{block.Id}/cancel", new { reason = "Changed the plan", version }),
            HttpStatusCode.OK);

        async Task AssertHiddenAsync(string because)
        {
            Assert.IsNull((await ReadSliceAsync<ClientTrainingProgramView>(client, B18ProgramUrl)).Program, because);
            await AssertStatusAsync(await client.GetAsync(R61aSummaryUrl(block.Id)), HttpStatusCode.NotFound);
            Assert.HasCount(1, (await ReadSliceAsync<ClientWorkoutHistoryPage>(client, "/api/training/me/history")).Items, because);
        }

        await AssertHiddenAsync("On, as it always was.");
        await B19SetAsync(coach, clientId, false, 0);
        await AssertHiddenAsync("Off reads the same.");
    }

    [TestMethod]
    public async Task B19OnlyTheClientsOwnCoachChooses()
    {
        var today = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b19-scope-owner@example.test", "Karim Haddad", "B19 Scope");
        using var coach = CreateClient();
        await JoinAsCoachAsync(owner, coach, "b19-scope-coach@example.test", "Lea Khoury");
        using var otherCoach = CreateClient();
        await JoinAsCoachAsync(owner, otherCoach, "b19-scope-other@example.test", "Omar Azar");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "b19-scope-client@example.test", true);
        SetTenant(client, tenant);
        var resources = await CreateTrainingResourcesAsync(coach, clientId, 8, 1, today);
        await AssignAsync(coach, clientId, resources, today);
        var url = B19Url(clientId);
        var off = new { canSeeFinishedPrograms = false, version = 0u };

        // Signed out, the client themselves, another coach of the workspace, and another workspace.
        using var anonymous = CreateClient();
        await AssertStatusAsync(await anonymous.PutAsJsonAsync(url, off), HttpStatusCode.Unauthorized);
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(await client.PutAsJsonAsync(url, off), HttpStatusCode.Forbidden);
        await RefreshCsrfAsync(otherCoach);
        await AssertStatusAsync(await otherCoach.PutAsJsonAsync(url, off), HttpStatusCode.NotFound);
        using var foreignCoach = CreateClient();
        await RegisterCoachAsync(foreignCoach, "b19-scope-foreign@example.test", "Foreign", "B19 Foreign");
        await RefreshCsrfAsync(foreignCoach);
        await AssertStatusAsync(await foreignCoach.PutAsJsonAsync(url, off), HttpStatusCode.NotFound);

        // Without the antiforgery token, and for a client who does not exist.
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(await owner.PutAsJsonAsync(B19Url(Guid.NewGuid()), off), HttpStatusCode.NotFound);
        coach.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
        var noToken = await A10AnswerAsync(await coach.PutAsJsonAsync(url, off), HttpStatusCode.BadRequest);
        Assert.AreEqual("antiforgery_token_invalid", noToken.Code);
        Assert.AreEqual(new FinishedProgramsVisibilityView(true, 0), await B19ChoiceAsync(coach, clientId), "Nothing was kept.");

        // The client's own coach. The owner manages every client but coaches only their own, and a program is the
        // private side (C8, notes plan N9d1a): another coach's client answers as a missing one, and nothing changes.
        var chosen = await B19SetAsync(coach, clientId, false, 0);
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PutAsJsonAsync(url, new { canSeeFinishedPrograms = true, version = chosen.Version }),
            HttpStatusCode.NotFound);
        Assert.AreEqual(chosen, await B19ChoiceAsync(coach, clientId));
        var changed = await B19SetAsync(coach, clientId, true, chosen.Version);
        Assert.IsTrue(changed.CanSeeFinishedPrograms);
        Assert.AreNotEqual(chosen.Version, changed.Version);
    }

    [TestMethod]
    public async Task B19TheChoiceOpensAndClosesWithTheCoachsRead()
    {
        var today = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b19-closed-owner@example.test", "Karim Haddad", "B19 Closed");
        var off = new { canSeeFinishedPrograms = false, version = 0u };

        async Task<(HttpClient Client, Guid Id, Guid Plan)> ClientAsync(string name, DateOnly planStart)
        {
            var client = CreateClient();
            var id = await InviteAndAcceptAsync(owner, client, $"b19-closed-{name}@example.test", true);
            SetTenant(client, tenant);
            return (client, id, (await CreateTrainingEnrollmentAsync(owner, id, planStart, 8)).Id);
        }

        async Task AssertClosedAsync(Guid id, string because)
        {
            var read = await ReadSliceAsync<CoachClientProgramView>(owner, R34aProgramUrl(id));
            Assert.AreEqual((false, null), (read.IsAllowed, read.FinishedPrograms), because);
            await RefreshCsrfAsync(owner);
            await AssertStatusAsync(await owner.PutAsJsonAsync(B19Url(id), off), HttpStatusCode.Forbidden);
        }

        // Before a booked plan begins the coach already reads the client's training, so the choice is open.
        var (booked, bookedId, _) = await ClientAsync("booked", today.AddDays(7));
        using (booked)
        {
            Assert.AreEqual(new FinishedProgramsVisibilityView(true, 0), await B19ChoiceAsync(owner, bookedId));
            await B19SetAsync(owner, bookedId, false, 0);
        }

        var (paused, pausedId, pausedPlan) = await ClientAsync("paused", today);
        using (paused)
        {
            await B10aChangeAsync(owner, pausedPlan, "pause", new { reason = "Injury", Version = await B10aVersionAsync(owner, pausedId, pausedPlan) });
            await AssertClosedAsync(pausedId, "A paused plan closes the coach's read.");
        }

        var (blocked, blockedId, _) = await ClientAsync("blocked", today);
        using (blocked)
        {
            var profile = await ReadSliceAsync<SliceProfileVersion>(owner, $"/api/clients/{blockedId}");
            await RefreshCsrfAsync(owner);
            await AssertStatusAsync(await owner.PostAsJsonAsync($"/api/clients/{blockedId}/relationship/block",
                new { reason = "B19 block check", profile.Version }), HttpStatusCode.OK);
            await AssertClosedAsync(blockedId, "A block closes it.");
        }

        var (released, releasedId, _) = await ClientAsync("released", today);
        using (released)
        {
            await ReleaseAsync(owner, releasedId, "Moved away");
            await RefreshCsrfAsync(owner);
            var refused = await A10AnswerAsync(await owner.PutAsJsonAsync(B19Url(releasedId), off), HttpStatusCode.Conflict);
            Assert.AreEqual("client_released", refused.Code);
        }
    }

    [TestMethod]
    public async Task B19TwoChoicesAtOnceLeaveOneRowAndAnOldOneIsRefused()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "b19-race-coach@example.test", "Karim Haddad", "B19 Race");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "b19-race-client@example.test", true);
        await CreateTrainingEnrollmentAsync(coach, clientId, today, 8);
        var url = B19Url(clientId);

        // A version from a read that never happened, while the client still has no row.
        await RefreshCsrfAsync(coach);
        var ghost = await A9ConflictAsync(await coach.PutAsJsonAsync(url, new { canSeeFinishedPrograms = false, version = 7u }));
        Assert.AreEqual("finished_programs_changed", ghost.Code);

        // Two tabs choose first, at once and differently: one row, and the other is told to look again.
        await RefreshCsrfAsync(coach);
        var firsts = await Task.WhenAll(
            coach.PutAsJsonAsync(url, new { canSeeFinishedPrograms = false, version = 0u }),
            coach.PutAsJsonAsync(url, new { canSeeFinishedPrograms = true, version = 0u }));
        CollectionAssert.AreEquivalent(R35cOneWins, firsts.Select(response => response.StatusCode).ToArray());
        var lost = await A9ConflictAsync(firsts.Single(response => response.StatusCode == HttpStatusCode.Conflict));
        Assert.AreEqual("finished_programs_changed", lost.Code);
        StringAssert.Contains(lost.Message, "It has been reloaded");
        Assert.AreEqual(1L, await A7ScalarAsync($"""
            SELECT count(*) FROM training."ClientProgramVisibilities" WHERE "ClientProfileId" = '{clientId}'
            """));

        // A change from an older read never overwrites a newer one.
        var read = await B19ChoiceAsync(coach, clientId) ?? throw new AssertFailedException("The choice is missing.");
        var moved = await B19SetAsync(coach, clientId, !read.CanSeeFinishedPrograms, read.Version);
        await RefreshCsrfAsync(coach);
        var stale = await A9ConflictAsync(await coach.PutAsJsonAsync(
            url, new { canSeeFinishedPrograms = read.CanSeeFinishedPrograms, version = read.Version }));
        Assert.AreEqual("finished_programs_changed", stale.Code);
        Assert.AreEqual(moved, await B19ChoiceAsync(coach, clientId));

        // The database holds both rules, whoever writes: one row a client, inside the client's workspace.
        using var foreignCoach = CreateClient();
        var foreign = await RegisterCoachAsync(foreignCoach, "b19-race-foreign@example.test", "Foreign", "B19 Race Foreign");
        var insert = $"""
            INSERT INTO training."ClientProgramVisibilities" ("Id", "TenantId", "ClientProfileId", "CanSeeFinishedPrograms")
            VALUES ('{Guid.NewGuid()}', 'WORKSPACE', '{clientId}', false)
            """;
        Assert.AreEqual(PostgresErrorCodes.UniqueViolation, (await A7RefusedAsync(insert.Replace("WORKSPACE", tenant.ToString()))).SqlState);
        Assert.AreEqual(PostgresErrorCodes.ForeignKeyViolation, (await A7RefusedAsync(insert.Replace("WORKSPACE", foreign.ToString()))).SqlState);
    }

    private static async Task<FinishedProgramsVisibilityView?> B19ChoiceAsync(HttpClient coach, Guid clientId) =>
        (await ReadSliceAsync<CoachClientProgramView>(coach, R34aProgramUrl(clientId))).FinishedPrograms;

    private static async Task<FinishedProgramsVisibilityView> B19SetAsync(
        HttpClient coach,
        Guid clientId,
        bool canSee,
        uint version)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PutAsJsonAsync(B19Url(clientId), new { canSeeFinishedPrograms = canSee, version });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<FinishedProgramsVisibilityView>(response);
    }
}
