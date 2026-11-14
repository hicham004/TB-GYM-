using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using TB.Gym.Modules.Media;
using TB.Gym.Modules.Progress;
using TB.Gym.Modules.Training;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The notes plan's N9b5 against PostgreSQL. Free's limit (PRG-015): with the house's window filled, a Free trainee's
/// own Progress (the dashboard, the weigh-ins, the span, measurements and photos, each "earlier" date too) reaches back
/// that many days and no further, while their workout history and records stay whole, the house's staff read the same
/// trainee whole, and nothing is refused for asking too far back; a paid plan lifts the limit while it grants and the
/// limit comes back when it ends; an empty window, a coach's client and another workspace's header limit nothing.
/// Progress counts finished workouts of one's own apart from planned sessions. The house's own media storage (MED-019)
/// replaces the platform's allowance for the house alone, never for another workspace or a former house, and refuses an
/// upload over it. Every name, address and figure is invented.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string N9b5DashboardUrl = "/api/progress/me/dashboard";

    private const string N9b5WindowSetting = "FreeProgressDays";

    private const string N9b5StorageSetting = "MediaStorageGigabytes";

    [TestMethod]
    public async Task N9b5FreeProgressReachesBackTheHousesWindowAndNoFurtherWhileHistoryStaysWhole()
    {
        // The trainee joined 200 days ago and finished a workout of their own that day.
        var today = N9a1HouseToday();
        N9b1FSetHouseDay(today.AddDays(-200));
        using var house = await N9a1OpenHouseAsync("n9b5-reach");
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9b5-reach-maya@example.test", "Maya", "Rahman");
        var oldWorkout = await N9b5FinishEmptyWorkoutAsync(trainee.Client);
        N9b1FSetHouseDay(today);

        // The window the admin will set: 90 days, or 91 when the 90th day back starts a workspace week (Monday), so the
        // day before the reach's first day always shares its week. Weigh-ins on both days put that week to the test.
        var windowDays = today.AddDays(-89).DayOfWeek == DayOfWeek.Monday ? 91 : 90;
        var earliest = today.AddDays(1 - windowDays);

        // Weigh-ins, waist measurements and photos, old and new; a year asked for reads every one while nothing limits.
        var weighIns = new[] { (100, 81.4m), (windowDays, 81.0m), (windowDays - 1, 80.8m), (60, 80.2m), (5, 79.1m), (0, 78.9m) };
        foreach (var (daysAgo, kilograms) in weighIns)
        {
            await N9b5WeighAsync(trainee.Client, today.AddDays(-daysAgo), kilograms);
        }

        foreach (var (daysAgo, centimetres) in new[] { (100, 90m), (50, 88m), (10, 86m) })
        {
            await N9b5MeasureAsync(trainee.Client, today.AddDays(-daysAgo), centimetres);
        }

        foreach (var daysAgo in new[] { 100, 10 })
        {
            await UploadProgressPhotoAsync(
                trainee.Client,
                $"/api/progress/me/photos?pose=Front&photoDate={N9b5Day(today.AddDays(-daysAgo))}");
        }

        var year = $"?from={N9b5Day(today.AddDays(-365))}&to={N9b5Day(today.AddDays(1))}";
        var whole = await ReadSliceAsync<ProgressDashboardView>(trainee.Client, N9b5DashboardUrl + year);
        Assert.AreEqual((today.AddDays(-365), 366, 6, (ProgressReach?)null), (whole.From, whole.WindowDayCount, whole.Bodyweight.ObservedDayCount, whole.Reach));
        Assert.AreEqual(1, whole.Training.Context!.WindowOwnCompletedWorkoutCount, "The workout of 200 days ago is in a year.");
        Assert.AreEqual(
            new BodyweightHistorySpanView(today.AddDays(-100), today),
            await ReadSliceAsync<BodyweightHistorySpanView>(trainee.Client, "/api/progress/me/span"));
        var wholeWeights = await ReadSliceAsync<ProgressView>(trainee.Client, "/api/progress/me" + year);
        var reachWeek = wholeWeights.Weeks.Single(week => week.WeekStart < earliest && earliest < week.WeekEndExclusive);
        Assert.AreEqual(2, reachWeek.ObservedDayCount, "Unlimited, the week holding the reach's first day counts the day before it.");

        // The platform admin fills the window. Every own read now starts on the reach's first day, says so, and reads
        // nothing older: not the day before it in the same week, nor the trend's warm-up.
        await N9a1SettingAsync(house.Admin, N9b5WindowSetting, windowDays.ToString(CultureInfo.InvariantCulture));
        var reach = new ProgressReach("FreeProgressReach", "1.0", windowDays, earliest);
        var cut = await ReadSliceAsync<ProgressDashboardView>(trainee.Client, N9b5DashboardUrl + year);
        Assert.AreEqual(
            (earliest, today.AddDays(1), windowDays, 4, (ProgressReach?)reach),
            (cut.From, cut.ToExclusive, cut.WindowDayCount, cut.Bodyweight.ObservedDayCount, cut.Reach));
        Assert.AreEqual(earliest, cut.Bodyweight.WeeklyChange!.FromDate, "The change starts at the first weigh-in shown.");
        Assert.AreEqual(
            1,
            cut.Bodyweight.WeeklyChange.FirstWeekObservedDayCount,
            "The change's first week holds the reach's first day alone: the day before it in that week is not read.");
        // The trend has no warm-up from before the reach: it is the estimate over the weigh-ins shown alone.
        var shownSamples = weighIns
            .Where(item => item.Item1 < windowDays)
            .Select(item => new BodyweightTrendSample(today.AddDays(-item.Item1), item.Item2));
        var expectedTrend = BodyweightTrendEwma.Calculate(shownSamples, earliest, today.AddDays(1))[^1].EstimateKilograms;
        Assert.AreEqual(expectedTrend, cut.Bodyweight.Trend.LatestEstimateKilograms);
        Assert.AreEqual((2, 1), (cut.Measurements.Measurements.Single().ObservationCount, cut.Photos.PhotoCount));
        Assert.AreEqual(0, cut.Training.Context!.WindowOwnCompletedWorkoutCount, "The workout of 200 days ago is past the reach.");

        var weights = await ReadSliceAsync<ProgressView>(trainee.Client, "/api/progress/me" + year);
        Assert.AreEqual((earliest, windowDays, (ProgressReach?)reach), (weights.From, weights.Days.Count, weights.Reach));
        Assert.AreEqual(4, weights.Days.Count(day => day.Observation is not null));
        Assert.AreEqual(
            1,
            weights.Weeks.Single(week => week.WeekStart <= earliest && earliest < week.WeekEndExclusive).ObservedDayCount,
            "The day before the reach shares the week and is not read.");
        Assert.AreEqual(expectedTrend, weights.Trend.LatestEstimateKilograms);
        // On the reach's first day the trend has that day alone behind it; unlimited, the older weigh-ins warm it up.
        Assert.AreEqual(1, weights.Days.Single(day => day.Date == earliest).TrendSampleCount);
        Assert.IsGreaterThan(1, wholeWeights.Days.Single(day => day.Date == earliest).TrendSampleCount!.Value);
        Assert.AreEqual(
            new BodyweightHistorySpanView(earliest, today, reach),
            await ReadSliceAsync<BodyweightHistorySpanView>(trainee.Client, "/api/progress/me/span"),
            "The span starts inside the reach, so the chart's All asks for no older year.");

        var measurements = await ReadSliceAsync<BodyMeasurementsView>(trainee.Client, "/api/progress/me/measurements" + year);
        Assert.AreEqual((earliest, 2, (DateOnly?)null, (ProgressReach?)reach),
            (measurements.From, measurements.Days.Count(day => day.Measurements.Count > 0), measurements.EarlierDate, measurements.Reach));
        var lastMonth = $"?from={N9b5Day(today.AddDays(-30))}&to={N9b5Day(today.AddDays(1))}";
        Assert.AreEqual(
            today.AddDays(-50),
            (await ReadSliceAsync<BodyMeasurementsView>(trainee.Client, "/api/progress/me/measurements" + lastMonth)).EarlierDate);
        var sinceDay55 = $"?from={N9b5Day(today.AddDays(-55))}&to={N9b5Day(today.AddDays(1))}";
        Assert.IsNull(
            (await ReadSliceAsync<BodyMeasurementsView>(trainee.Client, "/api/progress/me/measurements" + sinceDay55)).EarlierDate,
            "The waist of 100 days ago is kept and never offered as an earlier day.");

        var photos = await ReadSliceAsync<ProgressPhotosView>(trainee.Client, "/api/progress/me/photos" + year);
        Assert.AreEqual((earliest, 1, (DateOnly?)null, (ProgressReach?)reach), (photos.From, photos.Photos.Count, photos.EarlierDate, photos.Reach));
        Assert.IsNull((await ReadSliceAsync<ProgressPhotosView>(trainee.Client, "/api/progress/me/photos" + lastMonth)).EarlierDate);

        // A window wholly before the reach is answered with its first day, never refused; a window the rules refuse
        // anyway is refused as before.
        var older = await ReadSliceAsync<ProgressDashboardView>(
            trainee.Client,
            $"{N9b5DashboardUrl}?from={N9b5Day(today.AddDays(-200))}&to={N9b5Day(today.AddDays(-150))}");
        Assert.AreEqual(
            (earliest, earliest.AddDays(1), 1, 1),
            (older.From, older.ToExclusive, older.WindowDayCount, older.Bodyweight.ObservedDayCount),
            "That first day and its one weigh-in.");
        await AssertStatusAsync(
            await trainee.Client.GetAsync($"{N9b5DashboardUrl}?from={N9b5Day(today.AddDays(-400))}&to={N9b5Day(today.AddDays(1))}"),
            HttpStatusCode.BadRequest);

        // Workouts stay whole: the one of 200 days ago is in history.
        var history = await ReadSliceAsync<ClientWorkoutHistoryPage>(trainee.Client, "/api/training/me/history");
        Assert.AreEqual((oldWorkout, today.AddDays(-200)), (history.Items.Single().WorkoutExecutionId, history.Items.Single().Date));

        // The house's staff read the same trainee whole: the limit is the trainee's plan, not what the house keeps.
        var staffUrl = $"/api/progress/clients/{trainee.ProfileId}";
        var staff = await ReadSliceAsync<ProgressDashboardView>(house.Owner, $"{staffUrl}/dashboard{year}");
        Assert.AreEqual((today.AddDays(-365), 6, (ProgressReach?)null), (staff.From, staff.Bodyweight.ObservedDayCount, staff.Reach));
        var staffWeights = await ReadSliceAsync<ProgressView>(house.Owner, staffUrl + year);
        Assert.AreEqual(
            (today.AddDays(-365), 6, (ProgressReach?)null),
            (staffWeights.From, staffWeights.Days.Count(day => day.Observation is not null), staffWeights.Reach));
        Assert.AreEqual(
            new BodyweightHistorySpanView(today.AddDays(-100), today),
            await ReadSliceAsync<BodyweightHistorySpanView>(house.Owner, $"{staffUrl}/span"));
        Assert.AreEqual(3, (await ReadSliceAsync<BodyMeasurementsView>(house.Owner, $"{staffUrl}/measurements{year}"))
            .Days.Count(day => day.Measurements.Count > 0));
        Assert.HasCount(2, (await ReadSliceAsync<ProgressPhotosView>(house.Owner, $"{staffUrl}/photos{year}")).Photos);

        // Nothing was removed: emptying the window shows every day again.
        await N9a1SettingAsync(house.Admin, N9b5WindowSetting, null);
        var again = await ReadSliceAsync<ProgressDashboardView>(trainee.Client, N9b5DashboardUrl + year);
        Assert.AreEqual((today.AddDays(-365), 6, (ProgressReach?)null), (again.From, again.Bodyweight.ObservedDayCount, again.Reach));
    }

    [TestMethod]
    public async Task N9b5APaidPlanLiftsTheReachWhileItGrantsAndTheReachComesBackWhenItEnds()
    {
        var today = N9b1FStartAtMidday();
        using var house = await N9a1OpenHouseAsync("n9b5-paid");
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9b5-paid-hadi@example.test", "Hadi", "Zein");
        foreach (var daysAgo in new[] { 40, 20, 0 })
        {
            await N9b5WeighAsync(trainee.Client, today.AddDays(-daysAgo), 90m - daysAgo / 10m);
        }

        await N9a1SettingAsync(house.Admin, N9b5WindowSetting, "30");
        var year = $"?from={N9b5Day(today.AddDays(-300))}&to={N9b5Day(today.AddDays(1))}";
        Assert.AreEqual(2, (await ReadSliceAsync<ProgressDashboardView>(trainee.Client, N9b5DashboardUrl + year)).Bodyweight.ObservedDayCount);

        // Pro+ booked and waiting for its money lifts nothing: the trainee is on Free.
        var proPlus = await N9b1FProductAsync(house.Owner, "Pro+ Programs", 4, 45m, "ProPlus");
        var plan = await A7EnrollAsync(house.Owner, trainee.ProfileId, proPlus.Offers[0].Id, today);
        var unpaid = await ReadSliceAsync<ProgressDashboardView>(trainee.Client, N9b5DashboardUrl + year);
        Assert.AreEqual((today.AddDays(-29), 2), (unpaid.Reach!.EarliestShown, unpaid.Bodyweight.ObservedDayCount));

        // Paid in full, it grants, and Progress reaches back without a limit.
        await A7PayAsync(house.Owner, plan.Id, 45m, today, Guid.NewGuid());
        var paid = await ReadSliceAsync<ProgressDashboardView>(trainee.Client, N9b5DashboardUrl + year);
        Assert.AreEqual((today.AddDays(-300), 3, (ProgressReach?)null), (paid.From, paid.Bodyweight.ObservedDayCount, paid.Reach));
        Assert.AreEqual(
            new BodyweightHistorySpanView(today.AddDays(-40), today),
            await ReadSliceAsync<BodyweightHistorySpanView>(trainee.Client, "/api/progress/me/span"));

        // From the plan's exclusive end the trainee is on Free again, and the reach comes back from that day: of the
        // three weigh-ins, the one of 28 days before shows.
        var later = today.AddDays(28);
        N9b1FSetHouseDay(later);
        var ended = await ReadSliceAsync<ProgressDashboardView>(
            trainee.Client,
            $"{N9b5DashboardUrl}?from={N9b5Day(later.AddDays(-300))}&to={N9b5Day(later.AddDays(1))}");
        Assert.AreEqual(
            (later.AddDays(-29), (ProgressReach?)new ProgressReach("FreeProgressReach", "1.0", 30, later.AddDays(-29)), 1),
            (ended.From, ended.Reach, ended.Bodyweight.ObservedDayCount));

        // Any paid plan lifts it, one the house's staff made without a tier too, once it is paid in full; a plan of
        // nothing never does.
        var laterYear = $"?from={N9b5Day(later.AddDays(-300))}&to={N9b5Day(later.AddDays(1))}";
        var untiered = await N9b1FProductAsync(house.Owner, "Strength Coaching", 4, 30m, houseTier: null);
        var booked = await A7EnrollAsync(house.Owner, trainee.ProfileId, untiered.Offers[0].Id, later);
        Assert.IsNotNull((await ReadSliceAsync<ProgressDashboardView>(trainee.Client, N9b5DashboardUrl + laterYear)).Reach);
        await A7PayAsync(house.Owner, booked.Id, 29m, later, Guid.NewGuid());
        Assert.IsNotNull(
            (await ReadSliceAsync<ProgressDashboardView>(trainee.Client, N9b5DashboardUrl + laterYear)).Reach,
            "A part of the price grants nothing (SUB-008).");
        await A7PayAsync(house.Owner, booked.Id, 1m, later, Guid.NewGuid());
        var untieredPaid = await ReadSliceAsync<ProgressDashboardView>(trainee.Client, N9b5DashboardUrl + laterYear);
        Assert.AreEqual((later.AddDays(-300), 3, (ProgressReach?)null), (untieredPaid.From, untieredPaid.Bodyweight.ObservedDayCount, untieredPaid.Reach));
        Assert.IsNull((await ReadSliceAsync<BodyweightHistorySpanView>(trainee.Client, "/api/progress/me/span")).Reach);
    }

    [TestMethod]
    public async Task N9b5TheReachIsTheHousesAloneAndNoOtherCallerReadsATraineesProgress()
    {
        var today = N9b1FStartAtMidday();
        using var house = await N9a1OpenHouseAsync("n9b5-alone");
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9b5-alone-rana@example.test", "Rana", "Aoun");
        using var other = await N9a1TraineeAsync(house.TenantId, "n9b5-alone-ziad@example.test", "Ziad", "Nasr");
        await N9b5WeighAsync(trainee.Client, today.AddDays(-50), 70m);
        await N9a1SettingAsync(house.Admin, N9b5WindowSetting, "7");

        // A coach's own client, in a workspace of their own, reads every day whatever the house's window says.
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "n9b5-alone-coach@example.test", "Karim Saleh", "N9b5 Coaching");
        using var client = CreateClient();
        var coachedProfileId = await InviteAndAcceptAsync(coach, client, "n9b5-alone-client@example.test", true);
        SetTenant(client, workspaceId);
        await N9b5WeighAsync(client, today.AddDays(-50), 66m);
        var year = $"?from={N9b5Day(today.AddDays(-300))}&to={N9b5Day(today.AddDays(1))}";
        await CreateFreeTrainingEnrollmentAsync(coach, coachedProfileId, today);
        var coached = await ReadSliceAsync<ProgressDashboardView>(client, N9b5DashboardUrl + year);
        Assert.AreEqual((today.AddDays(-300), 1, (ProgressReach?)null), (coached.From, coached.Bodyweight.ObservedDayCount, coached.Reach));
        Assert.AreEqual(
            (false, 0, 0),
            (coached.Training.Context!.OwnWorkoutsCounted, coached.Training.Context.RecentOwnCompletedWorkoutCount,
                coached.Training.Context.WindowOwnCompletedWorkoutCount),
            "Outside the house nothing of one's own is counted, and the screen keeps done of planned.");

        // The trainee reads their own seven days; another trainee reads none of it, on any route.
        Assert.AreEqual(today.AddDays(-6), (await ReadSliceAsync<ProgressDashboardView>(trainee.Client, N9b5DashboardUrl + year)).From);
        foreach (var route in new[] { "dashboard", "span", "measurements", "photos", "" })
        {
            var url = $"/api/progress/clients/{trainee.ProfileId}" + (route.Length == 0 ? string.Empty : "/" + route);
            await AssertStatusAsync(await other.Client.GetAsync(url), HttpStatusCode.Forbidden);
        }

        Assert.AreEqual(
            new BodyweightHistorySpanView(null, null, new ProgressReach("FreeProgressReach", "1.0", 7, today.AddDays(-6))),
            await ReadSliceAsync<BodyweightHistorySpanView>(other.Client, "/api/progress/me/span"),
            "Their own span holds their own weigh-ins alone: none.");

        // Under another workspace's header the trainee is nobody there.
        SetTenant(trainee.Client, workspaceId);
        await AssertStatusAsync(await trainee.Client.GetAsync(N9b5DashboardUrl), HttpStatusCode.Forbidden);
    }

    [TestMethod]
    public async Task N9b5ProgressCountsFinishedWorkoutsOfOnesOwnApartFromPlannedSessions()
    {
        // The trainee joined ten days ago and finished a workout that day, then one today, and has one unfinished:
        // two count, on the days they were started.
        var today = N9a1HouseToday();
        N9b1FSetHouseDay(today.AddDays(-10));
        using var house = await N9a1OpenHouseAsync("n9b5-count", withCoach: true);
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9b5-count-lina@example.test", "Lina", "Haddad");
        await N9b5FinishEmptyWorkoutAsync(trainee.Client);
        N9b1FSetHouseDay(today);
        await N9b5FinishEmptyWorkoutAsync(trainee.Client);
        await AssertStatusAsync(await N9b2AStartAsync(trainee.Client), HttpStatusCode.OK);

        var dashboard = await ReadSliceAsync<ProgressDashboardView>(trainee.Client, N9b5DashboardUrl);
        Assert.AreEqual(DashboardSectionAvailability.Available, dashboard.Training.Availability);
        var training = dashboard.Training.Context!;
        Assert.AreEqual(
            (0, 0, 0, 0, 0, (DateOnly?)null),
            (training.RecentScheduledSessionCount, training.RecentCompletedWorkoutCount, training.WindowScheduledSessionCount,
                training.WindowCompletedWorkoutCount, training.WindowInProgressWorkoutCount, training.LastCompletedDate),
            "A workout of one's own is never a planned session (TRN-033).");
        Assert.AreEqual(
            (true, 1, 2, (DateOnly?)today),
            (training.OwnWorkoutsCounted, training.RecentOwnCompletedWorkoutCount, training.WindowOwnCompletedWorkoutCount,
                training.LastOwnCompletedDate));

        // The house's Coach, the trainee's coach, reads the same counts, and the owner, who coaches the trainee not, finds
        // no such dashboard (C8, notes plan N9d1a); a window that ends before today counts only what it holds.
        var staffDashboardUrl = $"/api/progress/clients/{trainee.ProfileId}/dashboard";
        var staff = (await ReadSliceAsync<ProgressDashboardView>(house.Coach!, staffDashboardUrl)).Training.Context!;
        Assert.AreEqual((1, 2, (DateOnly?)today), (staff.RecentOwnCompletedWorkoutCount, staff.WindowOwnCompletedWorkoutCount, staff.LastOwnCompletedDate));
        await AssertStatusAsync(await house.Owner.GetAsync(staffDashboardUrl), HttpStatusCode.NotFound);
        var before = (await ReadSliceAsync<ProgressDashboardView>(
            trainee.Client,
            $"{N9b5DashboardUrl}?from={N9b5Day(today.AddDays(-30))}&to={N9b5Day(today)}")).Training.Context!;
        Assert.AreEqual(
            (0, 1, (DateOnly?)today.AddDays(-10)),
            (before.RecentOwnCompletedWorkoutCount, before.WindowOwnCompletedWorkoutCount, before.LastOwnCompletedDate));

        // A client the house's coach invited and coaches finishes today's session of her program and a workout of her
        // own: each is counted once, the session against her plan and her own apart, never her session twice.
        using var rana = CreateClient();
        var ranaId = await R31InviteAsync(house.Coach!, rana, house.TenantId, "n9b5-count-rana@example.test", "Rana", "Saad");
        var resources = await CreateTrainingResourcesAsync(house.Coach!, ranaId, 8, 1, today);
        await AssignAsync(house.Coach!, ranaId, resources, today);
        var (session, _) = await A3StartTodayAsync(rana);
        await N9b2AOkAsync<WorkoutExecutionView>(N9b2AFinishAsync(rana, session.Id, session.Version));
        await N9b5FinishEmptyWorkoutAsync(rana);
        var hers = (await ReadSliceAsync<ProgressDashboardView>(rana, N9b5DashboardUrl)).Training.Context!;
        Assert.AreEqual(
            (1, 1, 1, 1, true),
            (hers.RecentCompletedWorkoutCount, hers.WindowCompletedWorkoutCount, hers.RecentOwnCompletedWorkoutCount,
                hers.WindowOwnCompletedWorkoutCount, hers.OwnWorkoutsCounted));
        Assert.IsGreaterThanOrEqualTo(1, hers.WindowScheduledSessionCount);
    }

    [TestMethod]
    public async Task N9b5WorkspaceQuotaTheHousesOwnStorageIsTheHousesAloneAndRefusesAnUploadOverIt()
    {
        // The platform's allowance in this test is 15 MB: three uploads of 5 MB fit and a fourth does not, in the
        // house and in a coach's space alike, while the house's own storage is empty.
        using var house = await N9a1OpenHouseAsync("n9b5-storage", signUpsPerWeek: null, minimumAge: null);
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "n9b5-storage-coach@example.test", "Karim Saleh", "N9b5 Storage Coaching");
        foreach (var staff in new[] { house.Owner, coach })
        {
            for (var index = 0; index < 3; index++)
            {
                await AssertStatusAsync(await Phase5B5UploadExerciseMediaAsync(staff, 5_000_000, $"fill-{index}.jpg"), HttpStatusCode.OK);
            }

            await N9b5AssertStorageFullAsync(staff);
        }

        // The house's storage refuses what it cannot hold, in its own sentence, and stores nothing.
        foreach (var (setting, value, sentence) in new[]
                 {
                     (N9b5StorageSetting, "0", "Enter a whole number of gigabytes from 1 to 10,240, or leave it empty. Empty gives the house the platform's allowance."),
                     (N9b5StorageSetting, "10241", "Enter a whole number of gigabytes from 1 to 10,240, or leave it empty. Empty gives the house the platform's allowance."),
                     (N9b5WindowSetting, "0", "Enter a whole number of days from 1 to 3,650, or leave it empty. Empty means Free's Progress has no limit."),
                     (N9b5WindowSetting, "3651", "Enter a whole number of days from 1 to 3,650, or leave it empty. Empty means Free's Progress has no limit."),
                 })
        {
            await RefreshCsrfAsync(house.Admin);
            var refused = await house.Admin.PutAsJsonAsync($"{N9a1HouseUrl}/settings/{setting}", new { value, expectedVersion = 0 });
            Assert.AreEqual(HttpStatusCode.BadRequest, refused.StatusCode, $"{setting} {value}");
            var errors = (await RequiredJsonAsync<JsonElement>(refused)).GetProperty("errors");
            Assert.AreEqual(sentence, errors.GetProperty("value")[0].GetString(), $"{setting} {value}");
        }

        // One gigabyte for the house: its fourth upload is taken; the coach's space keeps the platform's allowance.
        await N9a1SettingAsync(house.Admin, N9b5StorageSetting, "1");
        await AssertStatusAsync(await Phase5B5UploadExerciseMediaAsync(house.Owner, 5_000_000, "fourth.jpg"), HttpStatusCode.OK);
        await N9b5AssertStorageFullAsync(coach);

        // Over the gigabyte, the house's upload is refused with the workspace's code, and nothing it holds goes.
        var reserved = RequiredTestClock.UtcNow.AddHours(-1);
        for (var index = 0; index < 3; index++)
        {
            await Phase6ExecuteAsync(
                """
                INSERT INTO media."IngestObjects"
                    ("Id", "TenantId", "StorageLocation", "StorageKey", "AccountedBytes", "Purpose", "Status",
                     "PurgeAfterUtc", "PurgeAttemptCount", "CreatedAtUtc", "UpdatedAtUtc")
                VALUES (@id, @tenant, 'local-v1', @key, 400000000, 'ExerciseMedia', 'Reserved', @purgeAfter, 0, @at, @at)
                """,
                ("id", Guid.CreateVersion7()),
                ("tenant", house.TenantId),
                ("key", $"{house.TenantId:N}/n9b5/held-{index}.bin"),
                ("purgeAfter", reserved.AddDays(30)),
                ("at", reserved));
        }

        await N9b5AssertStorageFullAsync(house.Owner);
        Assert.AreEqual(4, await N9b5UploadsAsync(house.TenantId), "A full allowance deletes nothing.");

        // Two gigabytes hold it again; emptying the setting puts the house back on the platform's 15 MB.
        await N9a1SettingAsync(house.Admin, N9b5StorageSetting, "2");
        await AssertStatusAsync(await Phase5B5UploadExerciseMediaAsync(house.Owner, 5_000_000, "fifth.jpg"), HttpStatusCode.OK);
        await N9a1SettingAsync(house.Admin, N9b5StorageSetting, null);
        await N9b5AssertStorageFullAsync(house.Owner);

        // A former house keeps its setting's rows and none of the room: once the mark is cleared, the platform's
        // allowance stands, whatever was set while it was the house.
        await N9a1SettingAsync(house.Admin, N9b5StorageSetting, "2");
        var cleared = await N9a1HouseCommandAsync("clear");
        Assert.AreEqual(0, cleared.Code, cleared.Said);
        await N9b5AssertStorageFullAsync(house.Owner);
        Assert.AreEqual(5, await N9b5UploadsAsync(house.TenantId));
    }

    private static string N9b5Day(DateOnly day) => day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static async Task N9b5WeighAsync(HttpClient client, DateOnly day, decimal kilograms)
    {
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync("/api/progress/me/bodyweight", new { value = kilograms, unit = "Kilogram", measurementDate = N9b5Day(day) }),
            HttpStatusCode.OK);
    }

    private static async Task N9b5MeasureAsync(HttpClient client, DateOnly day, decimal centimetres)
    {
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync(
                "/api/progress/me/measurements",
                new { measurementType = "Waist", value = centimetres, unit = "Centimetre", measurementDate = N9b5Day(day) }),
            HttpStatusCode.OK);
    }

    /// <summary>Starts a workout of one's own and finishes it with nothing logged, on the house's day it is now.</summary>
    private static async Task<Guid> N9b5FinishEmptyWorkoutAsync(HttpClient client)
    {
        var workout = await N9b2AOkAsync<OwnWorkoutView>(N9b2AStartAsync(client));
        await N9b2AOkAsync<WorkoutExecutionView>(N9b2AFinishAsync(client, workout.WorkoutExecutionId, workout.Version));
        return workout.WorkoutExecutionId;
    }

    private static async Task N9b5AssertStorageFullAsync(HttpClient staff)
    {
        var rejected = await Phase5B5UploadExerciseMediaAsync(staff, 5_000_000, "over.jpg");
        Assert.AreEqual(HttpStatusCode.Conflict, rejected.StatusCode);
        Assert.AreEqual(MediaQuotaCodes.WorkspaceStorageExceeded, (await RequiredJsonAsync<Phase5B5Problem>(rejected)).Code);
    }

    private Task<long> N9b5UploadsAsync(Guid tenantId) => Phase6CountAsync(
        RequiredDatabaseConnection,
        """SELECT count(*) FROM media."Assets" WHERE "TenantId" = @id AND "Source" = 'Upload'""",
        tenantId);
}
