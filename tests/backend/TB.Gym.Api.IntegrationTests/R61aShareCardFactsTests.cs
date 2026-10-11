using System.Net;
using System.Net.Http.Json;
using TB.Gym.Modules.Training;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// R6.1a: a finished program's facts for the client's share card (TRN-030), read on its own or with the
/// finish summary of the workout that finished it. The card is made on the client's phone; these reads
/// are all the server gives it. Every template week holds one session on the week's first day.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task R61aTheWorkoutThatFinishesAProgramTellsItsFactsAndTheReadAgrees()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "r61a-facts-coach@example.test", "Coach", "Facts");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "r61a-facts-client@example.test", true);
        SetTenant(client, tenant);
        var resources = await CreateTrainingResourcesAsync(coach, clientId, 8, 3, today);
        var block = await AssignAsync(coach, clientId, resources, today);

        // A program still running has no summary, and a workout that leaves sessions to do names none.
        await AssertStatusAsync(await client.GetAsync(R61aSummaryUrl(block.Id)), HttpStatusCode.NotFound);
        Assert.IsNull((await R61aFinishTodaysWorkoutAsync(client, 80m)).FinishedProgram);
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        Assert.IsNull((await R61aFinishTodaysWorkoutAsync(client, 85m)).FinishedProgram);
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        var last = await R61aFinishTodaysWorkoutAsync(client, 85m);

        // 80 and then 85 were records; the second 85 only tied. The last session done finished it.
        var finished = last.FinishedProgram
            ?? throw new AssertFailedException("The workout that finished the program did not say so.");
        var name = (await ReadSliceAsync<TrainingMesocycleView>(coach, $"/api/training/mesocycles/{block.Id}")).Name;
        Assert.AreEqual((block.Id, name, today, today.AddDays(21)),
            (finished.Id, finished.Name, finished.StartDate, finished.EndDateExclusive));
        Assert.AreEqual((3, 3, 2), (finished.WeekCount, finished.WorkoutCount, finished.PersonalRecordCount));
        Assert.AreEqual((WorkoutPersonalRecordRule.Key, WorkoutPersonalRecordRule.Version),
            (finished.PersonalRecordRuleKey, finished.PersonalRecordRuleVersion));
        Assert.IsEmpty(last.PersonalRecords, "The tie set no record of its own.");

        var read = await ReadSliceAsync<ClientProgramSummaryResult>(client, R61aSummaryUrl(block.Id));
        Assert.IsTrue(read.IsAllowed);
        Assert.AreEqual("Granted", read.AccessReason);
        Assert.AreEqual(finished, read.Program, "The page reads what the finish summary told.");

        // A record from an earlier program is the bar this one's lifts had to beat.
        var next = await AssignAsync(coach, clientId, resources, today.AddDays(21));
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        await R61aFinishTodaysWorkoutAsync(client, 82.5m);
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        await R61aFinishTodaysWorkoutAsync(client, 90m);
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        var nextFinished = (await R61aFinishTodaysWorkoutAsync(client, 87.5m)).FinishedProgram
            ?? throw new AssertFailedException("The second program's last workout did not say it finished it.");
        Assert.AreEqual((next.Id, 3, 1), (nextFinished.Id, nextFinished.WorkoutCount, nextFinished.PersonalRecordCount));
        Assert.AreEqual(finished, (await ReadSliceAsync<ClientProgramSummaryResult>(client, R61aSummaryUrl(block.Id))).Program,
            "A later program changes nothing of an earlier one's facts.");
    }

    [TestMethod]
    public async Task R61aAProgramPastItsLastDayIsFinishedWithItsMissedSessionsLeftOut()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "r61a-ended-coach@example.test", "Coach", "Ended");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "r61a-ended-client@example.test", true);
        SetTenant(client, tenant);
        var resources = await CreateTrainingResourcesAsync(coach, clientId, 8, 2, today);
        var block = await AssignAsync(coach, clientId, resources, today);

        // Week 1 is missed, so finishing week 2's session leaves the program open until its last day.
        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        Assert.IsNull((await R61aFinishTodaysWorkoutAsync(client, 80m)).FinishedProgram);
        await AssertStatusAsync(await client.GetAsync(R61aSummaryUrl(block.Id)), HttpStatusCode.NotFound);

        RequiredTestClock.Advance(TimeSpan.FromDays(7));
        var read = await ReadSliceAsync<ClientProgramSummaryResult>(client, R61aSummaryUrl(block.Id));
        var program = read.Program ?? throw new AssertFailedException("A program past its last day is finished.");
        Assert.AreEqual((block.Id, 2, 1, 1),
            (program.Id, program.WeekCount, program.WorkoutCount, program.PersonalRecordCount));
        var page = await ReadSliceAsync<ClientTrainingProgramView>(client, "/api/training/me/program");
        Assert.AreEqual((block.Id, ClientProgramPhase.Finished), (page.Program?.Id, page.Program?.Phase),
            "The Training page calls the same program finished.");
    }

    [TestMethod]
    public async Task R61aAProgramSummaryIsOnlyTheSignedInClientsOwnFinishedProgramInTheirWorkspace()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "r61a-scope-coach@example.test", "Coach", "Scope");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "r61a-scope-client@example.test", true);
        SetTenant(client, tenant);
        var resources = await CreateTrainingResourcesAsync(coach, clientId, 8, 1, today);
        var block = await AssignAsync(coach, clientId, resources, today);
        Assert.IsNotNull((await R61aFinishTodaysWorkoutAsync(client, 80m)).FinishedProgram);
        var url = R61aSummaryUrl(block.Id);
        await AssertStatusAsync(await client.GetAsync(url), HttpStatusCode.OK);

        // Another client of the same coach, and a program that was never anyone's.
        using var other = CreateClient();
        var otherId = await InviteAndAcceptAsync(coach, other, "r61a-scope-other@example.test", true);
        SetTenant(other, tenant);
        await CreateTrainingEnrollmentAsync(coach, otherId, today, 8);
        await AssertStatusAsync(await other.GetAsync(url), HttpStatusCode.NotFound);
        await AssertStatusAsync(await client.GetAsync(R61aSummaryUrl(Guid.NewGuid())), HttpStatusCode.NotFound);

        // Signed out, and staff: the read is a client's own.
        using var anonymous = CreateClient();
        await AssertStatusAsync(await anonymous.GetAsync(url), HttpStatusCode.Unauthorized);
        await AssertStatusAsync(await coach.GetAsync(url), HttpStatusCode.Forbidden);

        // Another workspace: its own client's finished program is not found from here, and this client
        // naming that workspace is refused at its door.
        using var foreignCoach = CreateClient();
        var foreign = await RegisterCoachAsync(foreignCoach, "r61a-scope-foreign@example.test", "Foreign", "Coach");
        using var foreignClient = CreateClient();
        var foreignClientId = await InviteAndAcceptAsync(
            foreignCoach, foreignClient, "r61a-scope-foreign-client@example.test", true);
        SetTenant(foreignClient, foreign);
        var foreignResources = await CreateTrainingResourcesAsync(foreignCoach, foreignClientId, 8, 1, today);
        var foreignBlock = await AssignAsync(foreignCoach, foreignClientId, foreignResources, today);
        Assert.IsNotNull((await R61aFinishTodaysWorkoutAsync(foreignClient, 70m)).FinishedProgram);
        await AssertStatusAsync(await foreignClient.GetAsync(R61aSummaryUrl(foreignBlock.Id)), HttpStatusCode.OK);
        await AssertStatusAsync(await client.GetAsync(R61aSummaryUrl(foreignBlock.Id)), HttpStatusCode.NotFound);
        SetTenant(client, foreign);
        await AssertStatusAsync(await client.GetAsync(url), HttpStatusCode.Forbidden);
        SetTenant(client, tenant);

        // A cancelled program is never finished, even past its last day.
        var cancelled = await AssignAsync(coach, clientId, resources, today.AddDays(7));
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync($"/api/training/mesocycles/{cancelled.Id}/cancel",
                new { reason = "Changed the plan", cancelled.Version }),
            HttpStatusCode.OK);
        RequiredTestClock.Advance(TimeSpan.FromDays(15));
        await AssertStatusAsync(await client.GetAsync(R61aSummaryUrl(cancelled.Id)), HttpStatusCode.NotFound);
        await AssertStatusAsync(await client.GetAsync(url), HttpStatusCode.OK);
    }

    [TestMethod]
    public async Task R61aAReleasedClientIsRefusedAndALapsedPlanAnswersWithItsReasonAndNoFacts()
    {
        var today = R61aStartAtMidday();
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "r61a-closed-owner@example.test", "Owner", "Closed");
        using var released = CreateClient();
        var releasedId = await InviteAndAcceptAsync(owner, released, "r61a-closed-released@example.test", true);
        SetTenant(released, tenant);
        var releasedResources = await CreateTrainingResourcesAsync(owner, releasedId, 8, 1, today);
        var releasedBlock = await AssignAsync(owner, releasedId, releasedResources, today);
        Assert.IsNotNull((await R61aFinishTodaysWorkoutAsync(released, 80m)).FinishedProgram);
        await AssertStatusAsync(await released.GetAsync(R61aSummaryUrl(releasedBlock.Id)), HttpStatusCode.OK);

        // Ending coaching closes the workspace to the former client at once (ADR 0027).
        await ReleaseAsync(owner, releasedId, "Moved abroad");
        await AssertStatusAsync(await released.GetAsync(R61aSummaryUrl(releasedBlock.Id)), HttpStatusCode.Forbidden);

        // A second client of the same workspace, on the same exercises and program.
        using var lapsed = CreateClient();
        var lapsedId = await InviteAndAcceptAsync(owner, lapsed, "r61a-closed-lapsed@example.test", true);
        SetTenant(lapsed, tenant);
        var lapsedResources = releasedResources with
        {
            Enrollment = await CreateTrainingEnrollmentAsync(owner, lapsedId, today, 8),
            Max = await RecordWorkingMaxAsync(owner, lapsedId, releasedResources.Exercise.Id, 100m),
        };
        var lapsedBlock = await AssignAsync(owner, lapsedId, lapsedResources, today);
        Assert.IsNotNull((await R61aFinishTodaysWorkoutAsync(lapsed, 80m)).FinishedProgram);

        // Once the plan has ended, training is closed: the reason comes back and nothing of the program.
        RequiredTestClock.Advance(TimeSpan.FromDays(60));
        var closed = await ReadSliceAsync<ClientProgramSummaryResult>(lapsed, R61aSummaryUrl(lapsedBlock.Id));
        Assert.IsFalse(closed.IsAllowed);
        Assert.AreEqual("Expired", closed.AccessReason);
        Assert.IsNull(closed.Program);
    }

    private static string R61aSummaryUrl(Guid programId) => $"/api/training/me/programs/{programId}/summary";

    /// <summary>
    /// Puts the frozen clock at midday in the workspace's zone and returns that day. These tests step
    /// whole days; from midday a step across Beirut's clock change (25 Oct) still lands on the next
    /// calendar day, while from just after midnight it would land an hour short, on the day before.
    /// </summary>
    private DateOnly R61aStartAtMidday()
    {
        var today = TenantToday();
        var midday = today.ToDateTime(new TimeOnly(12, 0));
        var zone = TimeZoneInfo.FindSystemTimeZoneById("Asia/Beirut");
        RequiredTestClock.Set(new DateTimeOffset(midday, zone.GetUtcOffset(midday)).ToUniversalTime());
        return today;
    }

    /// <summary>
    /// Starts today's single session, logs its one set as 5 reps at the load, finishes it, and returns
    /// the finish summary the server answered with.
    /// </summary>
    private static async Task<WorkoutFinishSummaryView> R61aFinishTodaysWorkoutAsync(HttpClient client, decimal load)
    {
        var day = await ReadSliceAsync<ClientTrainingDayResult>(client, "/api/training/me/today");
        await RefreshCsrfAsync(client);
        var start = await client.PostAsync($"/api/training/me/sessions/{day.Workouts.Single().SessionId}/start", null);
        await AssertStatusAsync(start, HttpStatusCode.OK);
        var execution = await ReadSlicePayloadAsync<WorkoutExecutionView>(start);
        day = await ReadSliceAsync<ClientTrainingDayResult>(client, "/api/training/me/today");
        var set = day.Workouts.Single().Exercises.Single().Sets.Single();
        await RefreshCsrfAsync(client);
        var saved = await client.PutAsJsonAsync(
            $"/api/training/me/workouts/{execution.Id}/sets/{set.PerformanceId}",
            new { repetitions = 5, load, loadUnit = "Kilogram", rpe = 8m,
                isCompleted = true, clientNote = (string?)null, version = execution.Version });
        await AssertStatusAsync(saved, HttpStatusCode.OK);
        var savedSet = await ReadSlicePayloadAsync<WorkoutSetSaveView>(saved);
        await RefreshCsrfAsync(client);
        var completed = await client.PostAsJsonAsync($"/api/training/me/workouts/{execution.Id}/complete",
            new { version = savedSet.ExecutionVersion });
        await AssertStatusAsync(completed, HttpStatusCode.OK);
        return (await ReadSlicePayloadAsync<WorkoutExecutionView>(completed)).FinishSummary
            ?? throw new AssertFailedException("A completed workout came back without its summary.");
    }
}
