using System.Net;
using System.Net.Http.Json;
using TB.Gym.Modules.Training;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// R3.4a: a coach reads a client's programs as the client's own Training page does, with the weeks not
/// yet shared (TRN-020, TRN-022). Every template week holds one session, on the week's first day, so
/// week n's session is "Squat day n" on start + 7(n - 1).
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private static string R34aProgramUrl(Guid clientId) => $"/api/training/clients/{clientId}/program";

    [TestMethod]
    public async Task R34aACoachReadsTheTimelineWithTheStatesTheClientSees()
    {
        var today = TenantToday();
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "r34a-timeline-coach@example.test", "Hicham Haddad", "R34a Timeline");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(coach, maya, tenant, "r34a-timeline-maya@example.test", "Maya", "Rahman");
        var resources = await CreateTrainingResourcesAsync(coach, mayaId, 8, 3, today);

        var none = await ReadSliceAsync<CoachClientProgramView>(coach, R34aProgramUrl(mayaId));
        Assert.IsTrue(none.IsAllowed);
        Assert.IsEmpty(none.Blocks, "A client with training in the plan and no program has no blocks.");

        var block = await AssignAsync(coach, mayaId, resources, today);
        var program = await ReadSliceAsync<CoachClientProgramView>(coach, R34aProgramUrl(mayaId));
        Assert.IsTrue(program.IsAllowed);
        Assert.AreEqual("Granted", program.AccessReason);
        Assert.AreEqual(today, program.LocalDate);
        Assert.AreEqual(
            (ClientSessionStatePolicy.Key, ClientSessionStatePolicy.Version),
            (program.SessionStateRuleKey, program.SessionStateRuleVersion));
        var view = program.Blocks.Single();
        Assert.AreEqual(
            (block.Id, MesocycleStatus.Active, today, today.AddDays(21), 3, (int?)1, 3, 0, 0),
            (view.Id, view.Status, view.StartDate, view.EndDateExclusive, view.WeekCount, view.CurrentWeekNumber,
                view.SessionCount, view.CompletedCount, view.MissedCount));
        Assert.AreEqual(resources.Enrollment.Id, view.EnrollmentId);
        Assert.AreEqual(block.Version, view.Version, "The block carries the token its changes must send back.");

        // The coach sees every week at once: the first is open, the later ones are shared and still
        // locked for the client, with the day they open.
        var first = view.Weeks[0].Sessions.Single();
        Assert.AreEqual(("Squat day 1", today, ClientSessionState.Today, 1, 1),
            (first.Name, first.ScheduledDate, first.State, first.ExerciseCount, first.SetCount));
        Assert.IsNull(first.WorkoutExecutionId);
        Assert.AreEqual((true, true), (view.Weeks[0].IsShared, view.Weeks[0].IsVisible));
        foreach (var locked in view.Weeks.Skip(1))
        {
            Assert.AreEqual((true, false), (locked.IsShared, locked.IsVisible));
            Assert.AreEqual(ClientSessionState.Upcoming, locked.Sessions.Single().State);
        }
        Assert.AreEqual(
            (today.AddDays(7), today.AddDays(7), "Squat day 2"),
            (view.Weeks[1].StartDate, view.Weeks[1].UnlockDate, view.Weeks[1].Sessions.Single().Name));
        var own = (await ReadSliceAsync<ClientTrainingProgramView>(maya, "/api/training/me/program")).Program!;
        Assert.IsEmpty(own.Weeks[1].Sessions, "The client's own read still hides a locked week.");

        // A week later, week 2's workout is finished and week 1's was never started.
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        var workoutId = await R25bFinishTodaysWorkoutAsync(maya, 80m);
        view = (await ReadSliceAsync<CoachClientProgramView>(coach, R34aProgramUrl(mayaId))).Blocks.Single();
        Assert.AreEqual(2, view.CurrentWeekNumber);
        Assert.AreEqual(ClientSessionState.Missed, view.Weeks[0].Sessions.Single().State);
        var done = view.Weeks[1].Sessions.Single();
        Assert.AreEqual((ClientSessionState.Completed, workoutId), (done.State, done.WorkoutExecutionId));
        Assert.AreEqual(ClientSessionState.Upcoming, view.Weeks[2].Sessions.Single().State);
        Assert.AreEqual((3, 1, 1), (view.SessionCount, view.CompletedCount, view.MissedCount));

        // Wherever the client can see a session, the coach and the client call it the same thing.
        own = (await ReadSliceAsync<ClientTrainingProgramView>(maya, "/api/training/me/program")).Program!;
        foreach (var week in own.Weeks.Where(item => item.IsVisible))
        {
            CollectionAssert.AreEqual(
                week.Sessions.Select(item => (item.SessionId, item.State)).ToArray(),
                view.Weeks.Single(item => item.WeekNumber == week.WeekNumber).Sessions
                    .Select(item => (item.SessionId, (ClientSessionState)item.State!)).ToArray());
        }
    }

    [TestMethod]
    public async Task R34aUnsharedWeeksCancelledBlocksAndLaterBlocksAreToldApart()
    {
        var today = TenantToday();
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "r34a-blocks-coach@example.test", "Hicham Haddad", "R34a Blocks");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(coach, maya, tenant, "r34a-blocks-maya@example.test", "Maya", "Rahman");
        var resources = await CreateTrainingResourcesAsync(coach, mayaId, 12, 3, today);
        var first = await AssignAsync(coach, mayaId, resources, today);

        // The coach stops sharing week 3 and reveals all shared weeks at once: the week stays unshared,
        // so the client could not train it and its session has no state however late it gets.
        var view = (await ReadSliceAsync<CoachClientProgramView>(coach, R34aProgramUrl(mayaId))).Blocks.Single();
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PutAsJsonAsync(
            $"/api/training/mesocycles/{first.Id}/weeks/{view.Weeks[2].Id}/publish",
            new { isPublished = false, view.Version }), HttpStatusCode.OK);
        view = (await ReadSliceAsync<CoachClientProgramView>(coach, R34aProgramUrl(mayaId))).Blocks.Single();
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PutAsJsonAsync($"/api/training/mesocycles/{first.Id}/visibility",
            new { revealAllWeeks = true, view.Version }), HttpStatusCode.OK);
        view = (await ReadSliceAsync<CoachClientProgramView>(coach, R34aProgramUrl(mayaId))).Blocks.Single();
        Assert.IsTrue(view.RevealAllWeeks);
        var unshared = view.Weeks[2];
        Assert.AreEqual((false, false, "Squat day 3"), (unshared.IsShared, unshared.IsVisible, unshared.Sessions.Single().Name));
        Assert.IsNull(unshared.Sessions.Single().State);

        RequiredTestClock.Advance(TimeSpan.FromDays(30));
        view = (await ReadSliceAsync<CoachClientProgramView>(coach, R34aProgramUrl(mayaId))).Blocks.Single();
        Assert.IsNull(view.Weeks[2].Sessions.Single().State, "A week that was never shared is not missed.");
        Assert.AreEqual((ClientSessionState.Missed, ClientSessionState.Missed),
            (view.Weeks[0].Sessions.Single().State, view.Weeks[1].Sessions.Single().State));
        Assert.AreEqual((3, 0, 2), (view.SessionCount, view.CompletedCount, view.MissedCount));
        // Past its last day it is still active, because a missed session keeps it from closing, but
        // no week of it is current any more.
        Assert.AreEqual(MesocycleStatus.Active, view.Status);
        Assert.IsNull(view.CurrentWeekNumber);

        // A second block is listed first, planned, with no current week.
        var second = await AssignAsync(coach, mayaId, resources, today.AddDays(35));
        var program = await ReadSliceAsync<CoachClientProgramView>(coach, R34aProgramUrl(mayaId));
        CollectionAssert.AreEqual(new[] { second.Id, first.Id }, program.Blocks.Select(item => item.Id).ToArray());
        var planned = program.Blocks[0];
        Assert.AreEqual((MesocycleStatus.Planned, (int?)null, 3, 0, 0),
            (planned.Status, planned.CurrentWeekNumber, planned.SessionCount, planned.CompletedCount, planned.MissedCount));
        Assert.IsTrue(planned.Weeks.SelectMany(week => week.Sessions)
            .All(session => session.State == ClientSessionState.Upcoming));

        // Cancelling a block keeps it in the list; what was never trained has no state and counts nothing.
        var firstVersion = program.Blocks.Single(item => item.Id == first.Id).Version;
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PostAsJsonAsync($"/api/training/mesocycles/{first.Id}/cancel",
            new { reason = "Client travelling", version = firstVersion }), HttpStatusCode.OK);
        program = await ReadSliceAsync<CoachClientProgramView>(coach, R34aProgramUrl(mayaId));
        var cancelled = program.Blocks.Single(item => item.Id == first.Id);
        Assert.AreEqual((MesocycleStatus.Cancelled, (int?)null, 3, 0, 0),
            (cancelled.Status, cancelled.CurrentWeekNumber, cancelled.SessionCount, cancelled.CompletedCount, cancelled.MissedCount));
        Assert.IsTrue(cancelled.Weeks.SelectMany(week => week.Sessions).All(session => session.State is null));
        Assert.AreEqual(MesocycleStatus.Planned, program.Blocks.Single(item => item.Id == second.Id).Status);
    }

    [TestMethod]
    public async Task R34aAFinishedBlockKeepsItsWorkoutAndALongHistoryIsReadInAFixedNumberOfQueries()
    {
        var today = TenantToday();
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "r34a-history-coach@example.test", "Hicham Haddad", "R34a History");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(coach, maya, tenant, "r34a-history-maya@example.test", "Maya", "Rahman");
        var resources = await CreateTrainingResourcesAsync(coach, mayaId, 30, 1, today);
        var oldest = await AssignAsync(coach, mayaId, resources, today);
        var workoutId = await R25bFinishTodaysWorkoutAsync(maya, 80m);

        // Finishing the only session finishes the block, which stays in the list with its workout.
        var finished = (await ReadSliceAsync<CoachClientProgramView>(coach, R34aProgramUrl(mayaId))).Blocks.Single();
        Assert.AreEqual((oldest.Id, MesocycleStatus.Completed, (int?)null, 1, 1, 0),
            (finished.Id, finished.Status, finished.CurrentWeekNumber, finished.SessionCount,
                finished.CompletedCount, finished.MissedCount));
        var session = finished.Weeks.Single().Sessions.Single();
        Assert.AreEqual((ClientSessionState.Completed, workoutId), (session.State, session.WorkoutExecutionId));

        // Twenty-four later blocks push it off the end: only the newest are read, in a fixed number of
        // queries however many blocks, weeks and sessions there are.
        var later = new List<ScenarioMesocycle>();
        for (var week = 1; week <= 24; week++)
        {
            later.Add(await AssignAsync(coach, mayaId, resources, today.AddDays(7 * week)));
        }

        RequiredTodayQueryCounter.Reset();
        var program = await ReadSliceAsync<CoachClientProgramView>(coach, R34aProgramUrl(mayaId));
        var queries = RequiredTodayQueryCounter.Count;
        Console.WriteLine($"R3.4a coach program: {queries} SQL commands for 24 blocks.");
        // Observed 15, sign-in and tenant checks included: a fixed number, whatever the block count.
        Assert.IsLessThanOrEqualTo(18, queries, "The coach's program read must not query once per block.");
        Assert.HasCount(24, program.Blocks);
        CollectionAssert.AreEqual(
            later.AsEnumerable().Reverse().Select(item => item.Id).ToArray(),
            program.Blocks.Select(item => item.Id).ToArray());
        Assert.IsFalse(program.Blocks.Any(item => item.Id == oldest.Id), "Only the newest 24 are read.");
    }

    [TestMethod]
    public async Task R34aTheProgramIsScopedToTheCallersClientsAndTheClientsPlan()
    {
        var today = TenantToday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "r34a-scope-owner@example.test", "Hicham Haddad", "R34a Scope");
        using var coach = CreateClient();
        await JoinAsCoachAsync(owner, coach, "r34a-scope-coach@example.test", "Lina Saad");
        using var ownersClient = CreateClient();
        var ramiId = await R31InviteAsync(owner, ownersClient, tenant, "r34a-scope-rami@example.test", "Rami", "Khoury");
        var resources = await CreateTrainingResourcesAsync(owner, ramiId, 8, 3, today);
        await AssignAsync(owner, ramiId, resources, today);
        using var coachsClient = CreateClient();
        var nourId = await R31InviteAsync(coach, coachsClient, tenant, "r34a-scope-nour@example.test", "Nour", "Fares");

        // The owner reads any client's program; a coach reads only their own client's.
        var ownerRead = await ReadSliceAsync<CoachClientProgramView>(owner, R34aProgramUrl(ramiId));
        Assert.HasCount(1, ownerRead.Blocks);
        var closed = await ReadSliceAsync<CoachClientProgramView>(coach, R34aProgramUrl(nourId));
        Assert.AreEqual((false, "NoEntitlement", 0), (closed.IsAllowed, closed.AccessReason, closed.Blocks.Count));

        // Another coach's client answers exactly as an unknown one: 404, and nothing of the program.
        var other = await coach.GetAsync(R34aProgramUrl(ramiId));
        await AssertStatusAsync(other, HttpStatusCode.NotFound);
        Assert.IsFalse((await other.Content.ReadAsStringAsync()).Contains("Squat day", StringComparison.Ordinal));
        await AssertStatusAsync(await coach.GetAsync(R34aProgramUrl(Guid.NewGuid())), HttpStatusCode.NotFound);

        // Nobody signed out, and no client, can read it; another workspace's owner is refused this one
        // and finds nothing of it in their own.
        using var anonymous = CreateClient();
        SetTenant(anonymous, tenant);
        await AssertStatusAsync(await anonymous.GetAsync(R34aProgramUrl(ramiId)), HttpStatusCode.Unauthorized);
        await AssertStatusAsync(await ownersClient.GetAsync(R34aProgramUrl(ramiId)), HttpStatusCode.Forbidden);
        using var stranger = CreateClient();
        var strangerTenant = await RegisterCoachAsync(stranger, "r34a-scope-stranger@example.test", "Other Owner", "R34a Elsewhere");
        await AssertStatusAsync(await stranger.GetAsync(R34aProgramUrl(ramiId)), HttpStatusCode.NotFound);
        SetTenant(stranger, tenant);
        await AssertStatusAsync(await stranger.GetAsync(R34aProgramUrl(ramiId)), HttpStatusCode.Forbidden);
        SetTenant(stranger, strangerTenant);

        // A blocked relationship closes it with the reason; unblocking opens it again (ADR 0009).
        var profile = await RequiredJsonAsync<TeamClientDetails>(await owner.GetAsync($"/api/clients/{ramiId}"));
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(await owner.PostAsJsonAsync($"/api/clients/{ramiId}/relationship/block",
            new { reason = "R3.4a privacy check", profile.Version }), HttpStatusCode.OK);
        var blocked = await ReadSliceAsync<CoachClientProgramView>(owner, R34aProgramUrl(ramiId));
        Assert.AreEqual((false, "RelationshipBlocked", 0), (blocked.IsAllowed, blocked.AccessReason, blocked.Blocks.Count));
        profile = await RequiredJsonAsync<TeamClientDetails>(await owner.GetAsync($"/api/clients/{ramiId}"));
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(await owner.PostAsJsonAsync($"/api/clients/{ramiId}/relationship/unblock",
            new { reason = "R3.4a privacy check done", profile.Version }), HttpStatusCode.OK);
        Assert.IsTrue((await ReadSliceAsync<CoachClientProgramView>(owner, R34aProgramUrl(ramiId))).IsAllowed);

        // Once the plan has run out the feature is closed for the coach too: no blocks, and the reason.
        RequiredTestClock.Advance(TimeSpan.FromDays(57));
        var lapsed = await ReadSliceAsync<CoachClientProgramView>(owner, R34aProgramUrl(ramiId));
        Assert.AreEqual((false, "Expired", 0), (lapsed.IsAllowed, lapsed.AccessReason, lapsed.Blocks.Count));

        // A released client's record is kept, but nothing of training is read for them (ADR 0027).
        profile = await RequiredJsonAsync<TeamClientDetails>(await owner.GetAsync($"/api/clients/{ramiId}"));
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(await owner.PostAsJsonAsync($"/api/clients/{ramiId}/release",
            new { reason = "Moved away", profile.Version }), HttpStatusCode.OK);
        var released = await ReadSliceAsync<CoachClientProgramView>(owner, R34aProgramUrl(ramiId));
        Assert.AreEqual((false, 0), (released.IsAllowed, released.Blocks.Count));
    }
}
