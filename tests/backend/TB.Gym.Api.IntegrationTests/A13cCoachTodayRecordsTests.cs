using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using TB.Gym.Infrastructure.Application;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Training;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Audit batch A13c (BEB-2): Coach Today's records come from each workout's best earlier loads, worked out by the
/// database, so the rows it reads stay the same however long a client's history grows, and every record it shows
/// is the one the client's own history shows. Both tests start at midday, so whole days stepped across Beirut's
/// 25 October clock change stay on the intended dates.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private static readonly int[] A13cSessionDays = [0, 2, 4];

    [TestMethod]
    public async Task A13cCoachTodayReadsTheSameRowsForItsRecordsHoweverLongTheHistory()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "a13c-rows-coach@example.test", "Coach", "Rows");
        using var maya = CreateClient();
        var mayaId = await InviteAndAcceptAsync(coach, maya, "a13c-rows-maya@example.test", true);
        SetTenant(maya, tenant);
        var resources = await CreateTrainingResourcesAsync(coach, mayaId, 13, 12, today);
        await AssignAsync(coach, mayaId, resources, today);

        // One squat set of 5 a week: a record in week 3 (90 kg), none for eight weeks, then 92.5 kg in week 12.
        decimal[] loads = [80m, 85m, 90m, 85m, 87.5m, 90m, 82.5m, 85m, 87.5m, 90m, 80m, 92.5m];
        var workouts = new List<Guid>();
        CoachRecordReads weekThree = default;
        for (var week = 1; week <= loads.Length; week++)
        {
            if (week > 1)
            {
                RequiredTestClock.Advance(TimeSpan.FromDays(7));
            }

            workouts.Add(await R25bFinishTodaysWorkoutAsync(maya, loads[week - 1]));
            if (week == 3)
            {
                weekThree = await A13cReadCoachTodayAsync(coach);
            }
        }

        var weekTwelve = await A13cReadCoachTodayAsync(coach);
        Console.WriteLine(
            $"A13c Coach Today record reads after 3 workouts: {weekThree.Sets}, {weekThree.Best} and " +
            $"{weekThree.Recent}; after 12: {weekTwelve.Sets}, {weekTwelve.Best} and {weekTwelve.Recent}.");

        // Each Today shows the one workout of its last seven days, with its record.
        Assert.AreEqual((workouts[2], "90 Kilogram"), A13cOnlyWorkout(weekThree.View));
        Assert.AreEqual((workouts[11], "92.5 Kilogram"), A13cOnlyWorkout(weekTwelve.View));

        // One read each of the workout's sets, the best loads before it and the sets since, with the same rows
        // after 3 workouts or 12.
        Assert.AreEqual(
            (1, 1, 1),
            (weekThree.Sets.Commands, weekThree.Best.Commands, weekThree.Recent.Commands));
        Assert.AreEqual(weekThree.Sets, weekTwelve.Sets);
        Assert.AreEqual(weekThree.Best, weekTwelve.Best, "Nine more earlier workouts must not add a row to read.");
        Assert.AreEqual(weekThree.Recent, weekTwelve.Recent);

        // The client's page shows the same last workout and record, read the same way.
        RequiredTodayQueryCounter.Reset();
        var page = await ReadSliceAsync<ClientProfileOverviewView>(coach, $"/api/clients/{mayaId}/overview");
        var last = page.LastWorkout ?? throw new AssertFailedException("Maya has a finished workout.");
        Assert.AreEqual((workouts[11], "92.5 Kilogram"), (last.SubjectId, A13cRecords(last)));
        Assert.AreEqual(weekTwelve.Best, RequiredTodayQueryCounter.ReadsTagged(CoachOverviewReader.EarlierBestTag));

        // And the client's own history names the same records for those workouts.
        var history = await ReadSliceAsync<ClientWorkoutHistoryPage>(maya, "/api/training/me/history");
        Assert.AreEqual("92.5 Kilogram", A13cRecords(history.Items.Single(item => item.WorkoutExecutionId == workouts[11])));
        Assert.AreEqual(string.Empty, A13cRecords(history.Items.Single(item => item.WorkoutExecutionId == workouts[9])),
            "Week 10's 90 kg ties week 3's.");
    }

    [TestMethod]
    public async Task A13cEachWorkoutInTheFeedIsComparedWithTheWorkoutsFinishedBeforeItStarted()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "a13c-feed-coach@example.test", "Coach", "Feed");
        using var maya = CreateClient();
        var mayaId = await InviteAndAcceptAsync(coach, maya, "a13c-feed-maya@example.test", true);
        SetTenant(maya, tenant);
        var resources = await CreateTrainingResourcesAsync(coach, mayaId, 4, 1, today);
        var template = await PublishProgramAsync(
            coach, A13cThreeSessionsAWeek(resources.Exercise.Id, resources.Alternative.Id, 2));
        await AssignAsync(coach, mayaId, resources with { Template = template }, today);

        // Pounds and kilograms are separate records, never compared with each other.
        (int Day, decimal Load, string Unit)[] plan =
        [
            (0, 80m, "Kilogram"), (2, 80m, "Pound"), (4, 80m, "Kilogram"),
            (7, 85m, "Kilogram"), (9, 90m, "Kilogram"), (11, 88m, "Pound"),
        ];
        var workouts = new Dictionary<int, Guid>();
        var day = 0;
        foreach (var (at, load, unit) in plan)
        {
            RequiredTestClock.Advance(TimeSpan.FromDays(at - day));
            day = at;
            workouts[at] = await A13cFinishTodaysWorkoutAsync(maya, load, unit);
        }

        var view = (await A13cReadCoachTodayAsync(coach)).View;

        // Day 4 finished more than seven days ago, so the feed is days 11, 9 and 7, newest first. Day 7's 85 kg
        // is a record although day 9, later in the same feed, lifted 90: only what finished before day 7 counts.
        var feed = view.Activity.Where(item => item.Kind == CoachActivityKind.WorkoutCompleted).ToArray();
        CollectionAssert.AreEqual(
            new[] { workouts[11], workouts[9], workouts[7] },
            feed.Select(item => item.SubjectId).ToArray());
        Assert.AreEqual(
            "88 Pound | 90 Kilogram | 85 Kilogram",
            string.Join(" | ", feed.Select(A13cRecords)),
            "88 lb beats day 2's 80 lb although it is less than 90 kg.");

        var history = await ReadSliceAsync<ClientWorkoutHistoryPage>(maya, "/api/training/me/history");
        foreach (var item in feed)
        {
            Assert.AreEqual(
                A13cRecords(history.Items.Single(entry => entry.WorkoutExecutionId == item.SubjectId)),
                A13cRecords(item),
                "Coach Today and the client's history read the same records.");
        }

        Assert.AreEqual(string.Empty, A13cRecords(history.Items.Single(entry => entry.WorkoutExecutionId == workouts[4])),
            "Day 4's 80 kg ties day 0's.");
    }

    private async Task<CoachRecordReads> A13cReadCoachTodayAsync(HttpClient coach)
    {
        // An hour on, so the workout before the newest one is out of the feed's seven days.
        RequiredTestClock.Advance(TimeSpan.FromHours(1));
        RequiredTodayQueryCounter.Reset();
        var view = await ReadSliceAsync<CoachTodayView>(coach, CoachTodayUrl);
        return new CoachRecordReads(
            view,
            RequiredTodayQueryCounter.ReadsTagged(CoachOverviewReader.RecordSetsTag),
            RequiredTodayQueryCounter.ReadsTagged(CoachOverviewReader.EarlierBestTag),
            RequiredTodayQueryCounter.ReadsTagged(CoachOverviewReader.RecentSetsTag));
    }

    private static (Guid WorkoutId, string Records) A13cOnlyWorkout(CoachTodayView view)
    {
        var workout = view.Activity.Single(item => item.Kind == CoachActivityKind.WorkoutCompleted);
        return (workout.SubjectId, A13cRecords(workout));
    }

    private static string A13cRecords(CoachActivityItemView item) =>
        string.Join(", ", item.PersonalRecords.Select(record => A13cRecord(record.Load, record.Unit.ToString())));

    private static string A13cRecords(ClientWorkoutHistoryItemView item) =>
        string.Join(", ", item.PersonalRecords.Select(record => A13cRecord(record.Load, record.Unit.ToString())));

    private static string A13cRecord(decimal load, string unit) =>
        $"{load.ToString("0.##", CultureInfo.InvariantCulture)} {unit}";

    /// <summary>Starts today's single session, logs its one set as 5 reps at the load and unit, and finishes it.</summary>
    private static async Task<Guid> A13cFinishTodaysWorkoutAsync(HttpClient client, decimal load, string unit)
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
            new
            {
                repetitions = 5, load, loadUnit = unit, rpe = 8m,
                isCompleted = true, clientNote = (string?)null, version = execution.Version,
            });
        await AssertStatusAsync(saved, HttpStatusCode.OK);
        var savedSet = await ReadSlicePayloadAsync<WorkoutSetSaveView>(saved);
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(await client.PostAsJsonAsync($"/api/training/me/workouts/{execution.Id}/complete",
            new { version = savedSet.ExecutionVersion }), HttpStatusCode.OK);
        return execution.Id;
    }

    /// <summary>Weeks of three squat sessions, on the week's first, third and fifth day, one set of 5 each.</summary>
    private static object A13cThreeSessionsAWeek(Guid exerciseId, Guid alternativeId, int weekCount) => new
    {
        name = $"{weekCount}-week three-day scenario",
        description = "Three squat days a week",
        weeks = Enumerable.Range(1, weekCount).Select(week => new
        {
            label = $"Week {week}",
            isPublished = true,
            sessions = A13cSessionDays.Select(dayOffset => new
            {
                name = $"Squat day {week}.{dayOffset}",
                dayOffset,
                coachNotes = (string?)null,
                exercises = new[]
                {
                    new
                    {
                        exerciseId,
                        position = 0,
                        isMainLift = false,
                        modificationPolicy = "CoachApprovedSwap",
                        coachNotes = (string?)null,
                        approvedAlternativeExerciseIds = new[] { alternativeId },
                        sets = new[]
                        {
                            new
                            {
                                position = 0,
                                setType = "Normal",
                                repetitionsMinimum = 5,
                                repetitionsMaximum = 5,
                                loadStrategy = "RpeBasedEpley",
                                directLoad = (decimal?)null,
                                loadUnit = "Kilogram",
                                percentageWorkingMax = (decimal?)null,
                                targetRpe = 8m,
                                targetRir = (decimal?)null,
                                exertionDisplayPreference = "Rpe",
                                restSeconds = 180,
                                tempo = (string?)null,
                                coachNotes = (string?)null,
                                manualLoadOverride = (decimal?)null,
                            },
                        },
                    },
                },
            }).ToArray(),
        }).ToArray(),
    };

    private readonly record struct CoachRecordReads(
        CoachTodayView View,
        (int Commands, int Reads) Sets,
        (int Commands, int Reads) Best,
        (int Commands, int Reads) Recent);
}
