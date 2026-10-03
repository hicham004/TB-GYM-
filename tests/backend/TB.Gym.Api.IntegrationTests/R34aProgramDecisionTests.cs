using System.Net;
using System.Net.Http.Json;
using TB.Gym.Modules.Training;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The two owner decisions left open by R3.4a: a coach closes a program with a missed session once its
/// last day has passed (TRN-013), and reads a client's training before a booked plan begins (TRN-023).
/// Every template week holds one session, on the week's first day.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task R34aACoachClosesAProgramWithAMissedSessionOnlyAfterItsLastDay()
    {
        var today = TenantToday();
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "r34a-close-coach@example.test", "Hicham Haddad", "R34a Close");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(coach, maya, tenant, "r34a-close-maya@example.test", "Maya", "Rahman");
        var resources = await CreateTrainingResourcesAsync(coach, mayaId, 8, 2, today);
        var block = await AssignAsync(coach, mayaId, resources, today);
        await R25bFinishTodaysWorkoutAsync(maya, 80m);

        // Week 2's session goes by untrained. Before the last day the program cannot close.
        RequiredTestClock.Advance(TimeSpan.FromDays(8));
        var view = (await ReadSliceAsync<CoachClientProgramView>(coach, R34aProgramUrl(mayaId))).Blocks.Single();
        Assert.AreEqual((MesocycleStatus.Active, 1, 1), (view.Status, view.CompletedCount, view.MissedCount));
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PostAsJsonAsync($"/api/training/mesocycles/{block.Id}/complete",
            new { view.Version }), HttpStatusCode.Conflict);

        // The day after its last day it closes as finished, with the miss kept on record.
        RequiredTestClock.Advance(TimeSpan.FromDays(6));
        view = (await ReadSliceAsync<CoachClientProgramView>(coach, R34aProgramUrl(mayaId))).Blocks.Single();
        Assert.AreEqual((MesocycleStatus.Active, (int?)null), (view.Status, view.CurrentWeekNumber));
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PostAsJsonAsync($"/api/training/mesocycles/{block.Id}/complete",
            new { view.Version }), HttpStatusCode.OK);
        var closed = (await ReadSliceAsync<CoachClientProgramView>(coach, R34aProgramUrl(mayaId))).Blocks.Single();
        Assert.AreEqual((MesocycleStatus.Completed, 2, 1, 1),
            (closed.Status, closed.SessionCount, closed.CompletedCount, closed.MissedCount));
        var missed = closed.Weeks[1].Sessions.Single();
        Assert.AreEqual(ClientSessionState.Missed, missed.State);
        Assert.AreEqual(
            1L,
            await Phase6CountAsync(
                RequiredDatabaseConnection,
                """
                SELECT count(*) FROM training."MesocycleLifecycleEvents"
                WHERE "MesocycleId" = @id AND "EventType" = 'Completed'
                  AND "Reason" = 'Closed after its last day with 1 programmed session(s) not done.'
                """,
                block.Id));

        // The client can no longer start the missed session late, and sees the same program finished.
        await RefreshCsrfAsync(maya);
        await AssertStatusAsync(
            await maya.PostAsync($"/api/training/me/sessions/{missed.SessionId}/start", null),
            HttpStatusCode.Conflict);
        var own = (await ReadSliceAsync<ClientTrainingProgramView>(maya, "/api/training/me/program")).Program!;
        Assert.AreEqual(ClientSessionState.Missed, own.Weeks[1].Sessions.Single().State);

        // A closed program is history: closing it twice is refused.
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PostAsJsonAsync($"/api/training/mesocycles/{block.Id}/complete",
            new { closed.Version }), HttpStatusCode.Conflict);
    }

    [TestMethod]
    public async Task R34aACoachReadsTrainingBeforeABookedPlanBeginsAndTheClientDoesNot()
    {
        var today = TenantToday();
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "r34a-booked-coach@example.test", "Hicham Haddad", "R34a Booked");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(coach, maya, tenant, "r34a-booked-maya@example.test", "Maya", "Rahman");

        // A one-week plan running now, its program finished today, then a renewal booked after a gap.
        var resources = await CreateTrainingResourcesAsync(coach, mayaId, 1, 1, today);
        var first = await AssignAsync(coach, mayaId, resources, today);
        var workoutId = await R25bFinishTodaysWorkoutAsync(maya, 80m);
        var renewal = await CreateTrainingEnrollmentAsync(coach, mayaId, today.AddDays(14), 4);
        var next = await AssignAsync(coach, mayaId, resources with { Enrollment = renewal }, today.AddDays(14));

        // Between the two plans the coach still reads the finished program, the booked one, the workout
        // and the records, with the plan's own reason so the page can say when it starts.
        RequiredTestClock.Advance(TimeSpan.FromDays(9));
        var program = await ReadSliceAsync<CoachClientProgramView>(coach, R34aProgramUrl(mayaId));
        Assert.AreEqual((true, "NotStarted"), (program.IsAllowed, program.AccessReason));
        CollectionAssert.AreEqual(new[] { next.Id, first.Id }, program.Blocks.Select(item => item.Id).ToArray());
        Assert.AreEqual(MesocycleStatus.Planned, program.Blocks[0].Status);
        var records = await ReadSliceAsync<ClientPersonalRecordsResult>(coach, R33bRecordsUrl(mayaId));
        Assert.AreEqual((true, "NotStarted", 1), (records.IsAllowed, records.AccessReason, records.Items.Count));
        var workout = await ReadSliceAsync<CoachWorkoutDetailResult>(
            coach, $"/api/training/clients/{mayaId}/workouts/{workoutId}");
        Assert.IsTrue(workout.IsAllowed);
        Assert.IsNotNull(workout.Detail);

        // The client sees none of it until the plan's first day.
        var own = await ReadSliceAsync<ClientTrainingProgramView>(maya, "/api/training/me/program");
        Assert.AreEqual((false, "NotStarted"), (own.IsAllowed, own.AccessReason));
        Assert.IsNull(own.Program);
        var ownRecords = await ReadSliceAsync<ClientPersonalRecordsResult>(maya, "/api/training/me/personal-records");
        Assert.AreEqual((false, 0), (ownRecords.IsAllowed, ownRecords.Items.Count));

        // From the first day both read it as usual; after it lapses with nothing booked, both are closed.
        RequiredTestClock.Advance(TimeSpan.FromDays(5));
        Assert.AreEqual("Granted", (await ReadSliceAsync<CoachClientProgramView>(coach, R34aProgramUrl(mayaId))).AccessReason);
        Assert.IsTrue((await ReadSliceAsync<ClientTrainingProgramView>(maya, "/api/training/me/program")).IsAllowed);
        RequiredTestClock.Advance(TimeSpan.FromDays(28));
        var lapsed = await ReadSliceAsync<CoachClientProgramView>(coach, R34aProgramUrl(mayaId));
        Assert.AreEqual((false, "Expired", 0), (lapsed.IsAllowed, lapsed.AccessReason, lapsed.Blocks.Count));
        records = await ReadSliceAsync<ClientPersonalRecordsResult>(coach, R33bRecordsUrl(mayaId));
        Assert.AreEqual((false, 0), (records.IsAllowed, records.Items.Count));
    }
}
