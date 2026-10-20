using TB.Gym.Modules.Training;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Audit batch A4 (docs/FULL-AUDIT-2026-10.md section 11): the workout player. A finished workout's today read
/// carries the time it took, its finish summary's duration, so the player shows that instead of a clock still
/// counting from the start (UIQ-1); a workout still running carries none, and the player counts from its start.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task A4AFinishedWorkoutTellsTheTimeItTookAsItsSummaryDid()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        using var client = CreateClient();
        await RegisterCoachAsync(coach, "a4-duration@example.test", "A4 Coach", "A4 Duration Gym");
        var clientId = await InviteAndAcceptAsync(coach, client, "a4-duration-client@example.test", newAccount: true);
        var resources = await CreateTrainingResourcesAsync(coach, clientId, 8, 1, today);
        await AssignAsync(coach, clientId, resources, today);
        var (workout, day) = await A3StartTodayAsync(client);
        Assert.IsNull(day.DurationSeconds);

        // Thirty-two minutes and a bit later the one set is logged, and the workout is still running.
        RequiredTestClock.Advance(TimeSpan.FromSeconds(32 * 60 + 5.7));
        var logged = await A3LogAsync(
            client, workout.Id, day.Exercises.Single().Sets.Single().PerformanceId!.Value, 5, 80m, 8m, workout.Version);
        var running = (await ReadSliceAsync<ClientTrainingDayResult>(client, "/api/training/me/today")).Workouts.Single();
        Assert.IsNull(running.DurationSeconds);

        var finished = await A3FinishAsync(client, workout.Id, logged.ExecutionVersion);
        Assert.AreEqual(1925, finished.FinishSummary!.DurationSeconds);

        // Opened again two hours on, the finished workout still took 32:05: nothing counts on from its start.
        RequiredTestClock.Advance(TimeSpan.FromHours(2));
        var read = (await ReadSliceAsync<ClientTrainingDayResult>(client, "/api/training/me/today")).Workouts.Single();
        Assert.AreEqual(
            ((WorkoutExecutionStatus?)WorkoutExecutionStatus.Completed, (int?)1925),
            (read.Status, read.DurationSeconds));
    }
}
