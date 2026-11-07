using System.Net;
using System.Net.Http.Json;
using TB.Gym.Modules.Training;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// P4b's helpers: three weeks of RPE-chart sets and the client logging today's session, used by P4c's carried
/// maxes, P4d's max history, R51a, N10a and N10b. P4b's suggested max (BestLoggedSet v1, STR-012) and its tests went
/// with the notes plan's N10b (decision 19's note, 7 Nov 2026); N10bNoSuggestedMaxesTests proves what stays.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    /// <summary>One set as the client logs it.</summary>
    private sealed record P4bLog(int? Reps, decimal? Load, string? Unit, decimal? Rpe, bool Completed = true);

    /// <summary>A warm-up, then two working sets of 5 reps at RPE 8 worked out on the RTS chart, in each of three weeks.</summary>
    private static object[] P4bWeeks(Guid exerciseId) =>
    [
        P2Week("Week 1", exerciseId, P4bSets()),
        P2Week("Week 2", exerciseId, P4bSets()),
        P2Week("Week 3", exerciseId, P4bSets()),
    ];

    private static object[] P4bSets() =>
    [
        P1Set(1, "Direct", rpe: null, direct: 60m, setType: "WarmUp"),
        P1Set(2, "RpeChart", rpe: 8m, reps: 5),
        P1Set(3, "RpeChart", rpe: 8m, reps: 5),
    ];

    /// <summary>A lift's change naming a logged set and no number, as the web sent a suggestion until N10b.</summary>
    private static object P4bChange(Guid exerciseId, Guid loggedSetId) =>
        new { exerciseId, value = (decimal?)null, weekOneWeight = (decimal?)null, loggedSetId };

    /// <summary>The workspace's date now, by the server's clock (Asia/Beirut in these tests).</summary>
    private DateOnly P4bWorkspaceToday() =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(
            RequiredTestClock.UtcNow,
            TimeZoneInfo.FindSystemTimeZoneById("Asia/Beirut")).DateTime);

    /// <summary>
    /// The client starts today's session, logs its sets in order and, unless told not to, finishes it.
    /// Returns the logged sets' ids in order.
    /// </summary>
    private static async Task<Guid[]> P4bLogTodayAsync(HttpClient client, bool finish, params P4bLog[] sets)
    {
        var day = await ReadSliceAsync<ClientTrainingDayResult>(client, "/api/training/me/today");
        await RefreshCsrfAsync(client);
        var start = await client.PostAsync($"/api/training/me/sessions/{day.Workouts.Single().SessionId}/start", null);
        await AssertStatusAsync(start, HttpStatusCode.OK);
        var execution = await ReadSlicePayloadAsync<WorkoutExecutionView>(start);
        day = await ReadSliceAsync<ClientTrainingDayResult>(client, "/api/training/me/today");
        var performed = day.Workouts.Single().Exercises.Single().Sets.OrderBy(set => set.Position).ToArray();
        var version = execution.Version;
        for (var index = 0; index < sets.Length; index++)
        {
            await RefreshCsrfAsync(client);
            var saved = await client.PutAsJsonAsync(
                $"/api/training/me/workouts/{execution.Id}/sets/{performed[index].PerformanceId}",
                new
                {
                    repetitions = sets[index].Reps,
                    load = sets[index].Load,
                    loadUnit = sets[index].Unit,
                    rpe = sets[index].Rpe,
                    isCompleted = sets[index].Completed,
                    clientNote = (string?)null,
                    version,
                });
            await AssertStatusAsync(saved, HttpStatusCode.OK);
            version = (await ReadSlicePayloadAsync<WorkoutSetSaveView>(saved)).ExecutionVersion;
        }

        if (finish)
        {
            await RefreshCsrfAsync(client);
            await AssertStatusAsync(
                await client.PostAsJsonAsync($"/api/training/me/workouts/{execution.Id}/complete", new { version }),
                HttpStatusCode.OK);
        }

        return performed.Select(set => set.PerformanceId!.Value).ToArray();
    }
}
