using System.Globalization;
using System.Net;
using System.Net.Http.Json;

namespace TB.Gym.Api.IntegrationTests;

public sealed partial class Phase3TrainingWorkflowTests
{
    private const string Phase5B4Window = "from=2026-06-01&to=2026-08-23";

    [TestMethod]
    public async Task Phase5B4DashboardIsTenantIsolatedAndScopedToTheCallersOwnProfile()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "p5b4-coach@example.test", "Dash Coach", "Dash Workspace");
        using var owner = CreateClient();
        var ownerId = await InviteAndAcceptAsync(coach, owner, "p5b4-owner@example.test", true);
        SetTenant(owner, workspaceId);
        using var otherClient = CreateClient();
        var otherId = await InviteAndAcceptAsync(coach, otherClient, "p5b4-other@example.test", true);
        SetTenant(otherClient, workspaceId);

        await Phase5B4RecordBodyweightAsync(owner, 82.5m, "2026-08-20");
        await Phase5B4RecordBodyweightAsync(owner, 81.5m, "2026-08-22");

        var own = await Phase5B4OwnDashboardAsync(owner);
        Assert.AreEqual(ownerId, own.ClientProfileId);
        Assert.AreEqual(81.5m, own.Bodyweight.LatestDisplayValue);
        Assert.AreEqual(-1.0m, own.Bodyweight.Change!.Delta);
        Assert.AreEqual(2, own.Bodyweight.ObservedDayCount);

        // Another client of the same workspace sees only their own, empty, dashboard.
        var otherOwn = await Phase5B4OwnDashboardAsync(otherClient);
        Assert.AreEqual(otherId, otherOwn.ClientProfileId);
        Assert.IsNull(otherOwn.Bodyweight.Latest);
        Assert.AreEqual(0, otherOwn.Bodyweight.ObservedDayCount);

        // A client cannot reach the coach-facing route for anyone, including themselves.
        await AssertStatusAsync(
            await otherClient.GetAsync($"/api/progress/clients/{ownerId}/dashboard?{Phase5B4Window}"),
            HttpStatusCode.Forbidden);

        // A coach of another workspace cannot resolve this client at all.
        using var foreignCoach = CreateClient();
        await RegisterCoachAsync(foreignCoach, "p5b4-foreign@example.test", "Foreign", "Foreign Dash Workspace");
        await AssertStatusAsync(
            await foreignCoach.GetAsync($"/api/progress/clients/{ownerId}/dashboard?{Phase5B4Window}"),
            HttpStatusCode.NotFound);

        // The owning coach sees the same figures the client does.
        var coachView = await Phase5B4ClientDashboardAsync(coach, ownerId);
        Assert.AreEqual(ownerId, coachView.ClientProfileId);
        Assert.AreEqual(81.5m, coachView.Bodyweight.LatestDisplayValue);
    }

    [TestMethod]
    public async Task Phase5B4DashboardKeepsTheSameUsersTwoWorkspacesSeparate()
    {
        using var firstCoach = CreateClient();
        var firstWorkspace = await RegisterCoachAsync(firstCoach, "p5b4-w1@example.test", "W1 Coach", "Dash Workspace One");
        using var client = CreateClient();
        await InviteAndAcceptAsync(firstCoach, client, "p5b4-dual@example.test", true);
        SetTenant(client, firstWorkspace);
        await Phase5B4RecordBodyweightAsync(client, 90m, "2026-08-21");

        using var secondCoach = CreateClient();
        var secondWorkspace = await RegisterCoachAsync(secondCoach, "p5b4-w2@example.test", "W2 Coach", "Dash Workspace Two");
        await InviteAndAcceptAsync(secondCoach, client, "p5b4-dual@example.test", false);

        // The same person in the second workspace has a separate client profile and no history
        // there: progress must never follow a user across workspaces.
        SetTenant(client, secondWorkspace);
        var second = await Phase5B4OwnDashboardAsync(client);
        Assert.IsNull(second.Bodyweight.Latest);
        Assert.AreEqual(0, second.Bodyweight.ObservedDayCount);

        SetTenant(client, firstWorkspace);
        var first = await Phase5B4OwnDashboardAsync(client);
        Assert.AreEqual(90m, first.Bodyweight.LatestDisplayValue);
        Assert.AreNotEqual(first.ClientProfileId, second.ClientProfileId);
    }

    [TestMethod]
    public async Task Phase5B4BlockedCoachLosesTheDashboardWhileTheClientKeepsIt()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "p5b4-block-coach@example.test", "Block Coach", "Dash Block");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "p5b4-block-client@example.test", true);
        SetTenant(client, workspaceId);
        await Phase5B4RecordBodyweightAsync(client, 77m, "2026-08-22");
        await Phase5B4ClientDashboardAsync(coach, clientId);

        var details = await coach.GetFromJsonAsync<Phase5B4ClientDetails>($"/api/clients/{clientId}")
            ?? throw new AssertFailedException("Client details were empty.");
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync(
                $"/api/clients/{clientId}/relationship/block",
                new { reason = "Blocked for the dashboard test.", details.Version }),
            HttpStatusCode.OK);

        // Blocking takes effect immediately and is indistinguishable from an unknown client.
        await AssertStatusAsync(
            await coach.GetAsync($"/api/progress/clients/{clientId}/dashboard?{Phase5B4Window}"),
            HttpStatusCode.NotFound);

        // The client's own dashboard is untouched, because progress is theirs.
        var own = await Phase5B4OwnDashboardAsync(client);
        Assert.AreEqual(77m, own.Bodyweight.LatestDisplayValue);
    }

    [TestMethod]
    public async Task Phase5B4DashboardHonoursWorkspaceTimeZoneAndNonMondayWeekStart()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "p5b4-cal-coach@example.test", "Cal Coach", "Dash Calendar");
        var workspace = await coach.GetFromJsonAsync<Phase5B4Workspace>("/api/workspace")
            ?? throw new AssertFailedException("Workspace details were empty.");
        await RefreshCsrfAsync(coach);
        // Sunday-start workspace, so the weekly grid must not fall back to the ISO Monday default.
        await AssertStatusAsync(
            await coach.PutAsJsonAsync("/api/workspace", new
            {
                workspace.Name,
                timeZoneId = "Asia/Beirut",
                defaultCulture = "en-LB",
                defaultCurrencyCode = "USD",
                weekStartsOn = "Sunday",
                workspace.Version,
            }),
            HttpStatusCode.OK);

        using var client = CreateClient();
        await InviteAndAcceptAsync(coach, client, "p5b4-cal-client@example.test", true);
        SetTenant(client, workspaceId);
        // 2026-08-19 is a Wednesday; its Sunday-start week begins 2026-08-16.
        await Phase5B4RecordBodyweightAsync(client, 70m, "2026-08-19");

        var view = await Phase5B4OwnDashboardAsync(client);
        Assert.AreEqual("Asia/Beirut", view.TimeZoneId);
        Assert.AreEqual("Sunday", view.WeekStartsOn);
        var week = view.Bodyweight.Weeks.Single(item => item.ObservedDayCount > 0);
        var weekStart = DateOnly.Parse(week.WeekStart, CultureInfo.InvariantCulture);
        Assert.AreEqual(new DateOnly(2026, 8, 16), weekStart);
        Assert.AreEqual(DayOfWeek.Sunday, weekStart.DayOfWeek);
        Assert.AreEqual(1, week.ObservedDayCount);

        // The window rules are the existing progress rules, so an invalid range is still a 400.
        await AssertStatusAsync(
            await client.GetAsync("/api/progress/me/dashboard?from=2026-08-23&to=2026-08-23"),
            HttpStatusCode.BadRequest);
        await AssertStatusAsync(
            await client.GetAsync("/api/progress/me/dashboard?from=2020-01-01&to=2026-08-23"),
            HttpStatusCode.BadRequest);
    }

    [TestMethod]
    public async Task Phase5B4ExpiredNutritionEntitlementClosesOnlyThatSection()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "p5b4-ent-coach@example.test", "Ent Coach", "Dash Entitlement");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "p5b4-ent-client@example.test", true);
        SetTenant(client, workspaceId);

        await Phase5B4RecordBodyweightAsync(client, 88m, "2026-08-22");
        await Phase5B4RecordMeasurementAsync(client, "Waist", 90m, "2026-08-22");
        await UploadProgressPhotoAsync(client, "/api/progress/me/photos?pose=Front&photoDate=2026-08-22");
        await Phase5B4EnrollAsync(coach, clientId, "Nutrition", new DateOnly(2026, 8, 17), 1);

        var entitled = await Phase5B4OwnDashboardAsync(client);
        Assert.AreEqual("Available", entitled.Nutrition.Availability);
        Assert.AreEqual("Granted", entitled.Nutrition.Reason);
        Assert.IsNotNull(entitled.Nutrition.Context);

        // Move the workspace clock past the one-week enrollment. Nothing else changes.
        RequiredTestClock.Advance(TimeSpan.FromDays(30));
        var lapsed = await Phase5B4OwnDashboardAsync(client);

        // The nutrition section is present, explicitly unavailable, and carries no counts at all,
        // so a lapsed subscription cannot leak logging activity through the dashboard.
        Assert.AreEqual("Unavailable", lapsed.Nutrition.Availability);
        Assert.AreEqual("Expired", lapsed.Nutrition.Reason);
        Assert.IsNull(lapsed.Nutrition.Context);
        // Training was never entitled at all, and is reported as such rather than omitted.
        Assert.AreEqual("Unavailable", lapsed.Training.Availability);
        Assert.AreEqual("NoEntitlement", lapsed.Training.Reason);
        Assert.IsNull(lapsed.Training.Context);

        // Progress is entitlement-independent, so the client keeps their own body data.
        Assert.AreEqual(88m, lapsed.Bodyweight.LatestDisplayValue);
        Assert.AreEqual(90m, lapsed.Measurements.Measurements.Single().LatestDisplayValue);
        Assert.AreEqual(1, lapsed.Photos.PhotoCount);
    }

    [TestMethod]
    public async Task Phase5B4PhotoTimelineReturnsThumbnailsAndNeverOriginals()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "p5b4-photo-coach@example.test", "Photo Coach", "Dash Photos");
        using var client = CreateClient();
        await InviteAndAcceptAsync(coach, client, "p5b4-photo-client@example.test", true);
        SetTenant(client, workspaceId);

        var front = await UploadProgressPhotoAsync(client, "/api/progress/me/photos?pose=Front&photoDate=2026-08-21");
        await UploadProgressPhotoAsync(client, "/api/progress/me/photos?pose=Front&photoDate=2026-08-22");
        await UploadProgressPhotoAsync(client, "/api/progress/me/photos?pose=Back&photoDate=2026-08-22");

        var view = await Phase5B4OwnDashboardAsync(client);
        Assert.AreEqual(3, view.Photos.PhotoCount);
        Assert.AreEqual(0, view.Photos.MissingThumbnailCount);
        Assert.HasCount(2, view.Photos.Poses);

        var frontTimeline = view.Photos.Poses.Single(item => item.Pose == "Front");
        Assert.HasCount(2, frontTimeline.Photos);
        // Ordered oldest first so a pose reads as a timeline.
        Assert.AreEqual("2026-08-21", frontTimeline.Photos[0].PhotoDate);

        foreach (var photo in view.Photos.Poses.SelectMany(item => item.Photos))
        {
            Assert.IsNotNull(photo.ThumbnailUrl);
            Assert.EndsWith("/content/thumbnail", photo.ThumbnailUrl, StringComparison.Ordinal);
            // The dashboard must never hand out a path to the full-resolution original.
            Assert.AreNotEqual($"/api/media/{photo.MediaAssetId:D}/content", photo.ThumbnailUrl);
        }

        // A removed photo leaves the timeline rather than appearing without a preview.
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync(
                $"/api/progress/me/photos/{front.Id}/remove",
                new { reason = "Removed for the dashboard test.", front.Version }),
            HttpStatusCode.OK);
        var afterRemoval = await Phase5B4OwnDashboardAsync(client);
        Assert.AreEqual(2, afterRemoval.Photos.PhotoCount);
        Assert.IsFalse(afterRemoval.Photos.Poses
            .SelectMany(item => item.Photos)
            .Any(item => item.Id == front.Id));
    }

    [TestMethod]
    public async Task Phase5B4DashboardUsesBoundedProjectionsWithinItsQueryBudget()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "p5b4-query-coach@example.test", "Query Coach", "Dash Query");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "p5b4-query-client@example.test", true);
        SetTenant(client, workspaceId);

        // Enough rows in every section that an N+1 would show up as a rising command count.
        for (var day = 1; day <= 12; day++)
        {
            await Phase5B4RecordBodyweightAsync(client, 80m + day, $"2026-08-{day:00}");
            await Phase5B4RecordMeasurementAsync(client, "Waist", 90m + day, $"2026-08-{day:00}");
        }

        await UploadProgressPhotoAsync(client, "/api/progress/me/photos?pose=Front&photoDate=2026-08-20");
        await UploadProgressPhotoAsync(client, "/api/progress/me/photos?pose=Side&photoDate=2026-08-20");
        await UploadProgressPhotoAsync(client, "/api/progress/me/photos?pose=Back&photoDate=2026-08-20");
        var resources = await CreateTrainingResourcesAsync(coach, clientId, 8, 2, new DateOnly(2026, 8, 3));
        await AssignAsync(coach, clientId, resources, new DateOnly(2026, 8, 3));

        var counter = RequiredTodayQueryCounter;
        counter.Reset();
        var response = await client.GetAsync($"/api/progress/me/dashboard?{Phase5B4Window}");
        await AssertStatusAsync(response, HttpStatusCode.OK);
        var view = await RequiredJsonAsync<Phase5B4Dashboard>(response);

        Console.WriteLine($"Phase 5B-4 /dashboard SQL command count: {counter.Count}");
        Assert.IsLessThanOrEqualTo(
            20,
            counter.Count,
            "The dashboard projection exceeded its bounded query budget.");

        // Every section is composed from date-filtered projections rather than loaded aggregates.
        Assert.IsTrue(
            counter.Commands.Any(command =>
                command.Contains("\"PhotoDate\"", StringComparison.Ordinal) &&
                command.Contains("\"ClientProfileId\"", StringComparison.Ordinal)),
            "The photo timeline did not push client/date filtering into PostgreSQL.");
        Assert.IsTrue(
            counter.Commands.Any(command =>
                command.Contains("\"ScheduledDate\"", StringComparison.Ordinal) &&
                command.Contains("\"ClientProfileId\"", StringComparison.Ordinal)),
            "The training context did not push client/date filtering into PostgreSQL.");

        Assert.AreEqual(12, view.Bodyweight.ObservedDayCount);
        Assert.AreEqual(3, view.Photos.PhotoCount);
        Assert.AreEqual("Available", view.Training.Availability);
        // Denominators are reported alongside the counts rather than folded into a score.
        Assert.IsGreaterThan(0, view.Training.Context!.WindowScheduledSessionCount);
        Assert.AreEqual(0, view.Training.Context.WindowCompletedWorkoutCount);
        Assert.AreEqual(7, view.Training.Context.RecentDayCount);
    }

    private static async Task<Phase5B4Dashboard> Phase5B4OwnDashboardAsync(HttpClient caller)
    {
        var response = await caller.GetAsync($"/api/progress/me/dashboard?{Phase5B4Window}");
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<Phase5B4Dashboard>(response);
    }

    private static async Task<Phase5B4Dashboard> Phase5B4ClientDashboardAsync(HttpClient caller, Guid clientProfileId)
    {
        var response = await caller.GetAsync($"/api/progress/clients/{clientProfileId}/dashboard?{Phase5B4Window}");
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<Phase5B4Dashboard>(response);
    }

    private static async Task Phase5B4RecordBodyweightAsync(HttpClient caller, decimal value, string date)
    {
        await RefreshCsrfAsync(caller);
        await AssertStatusAsync(
            await caller.PostAsJsonAsync(
                "/api/progress/me/bodyweight",
                new { value, unit = "Kilogram", measurementDate = date }),
            HttpStatusCode.OK);
    }

    private static async Task Phase5B4RecordMeasurementAsync(
        HttpClient caller,
        string measurementType,
        decimal value,
        string date)
    {
        await RefreshCsrfAsync(caller);
        await AssertStatusAsync(
            await caller.PostAsJsonAsync(
                "/api/progress/me/measurements",
                new { measurementType, value, unit = "Centimetre", measurementDate = date }),
            HttpStatusCode.OK);
    }

    private static async Task Phase5B4EnrollAsync(
        HttpClient coach,
        Guid clientId,
        string feature,
        DateOnly startDate,
        int durationWeeks)
    {
        await RefreshCsrfAsync(coach);
        var productResponse = await coach.PostAsJsonAsync("/api/commercial/products", new
        {
            name = $"{feature} {durationWeeks}-week",
            description = "Phase 5B-4 dashboard entitlement",
            initialOffer = new
            {
                label = $"{durationWeeks} weeks",
                durationCount = durationWeeks,
                durationUnit = "Week",
                priceAmount = 0m,
                priceCurrency = "USD",
                features = new[] { new { feature, allowsConcurrentCoverage = false } },
            },
        });
        await AssertStatusAsync(productResponse, HttpStatusCode.OK);
        var product = await RequiredJsonAsync<Product>(productResponse);
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync(
                $"/api/commercial/clients/{clientId}/enrollments",
                new { offerId = product.Offers[0].Id, startDate, idempotencyKey = Guid.NewGuid() }),
            HttpStatusCode.OK);
    }

    private sealed record Phase5B4Dashboard(
        Guid ClientProfileId,
        string TimeZoneId,
        string WeekStartsOn,
        int WindowDayCount,
        Phase5B4Bodyweight Bodyweight,
        Phase5B4Measurements Measurements,
        Phase5B4Photos Photos,
        Phase5B4Section<Phase5B4NutritionContext> Nutrition,
        Phase5B4Section<Phase5B4TrainingContext> Training);

    private sealed record Phase5B4Bodyweight(
        Phase5B4Observation? Latest,
        decimal? LatestDisplayValue,
        Phase5B4Change? Change,
        Phase5B4Week[] Weeks,
        int ObservedDayCount);

    private sealed record Phase5B4Observation(Guid Id, string MeasurementDate);
    private sealed record Phase5B4Change(decimal Delta);
    private sealed record Phase5B4Week(string WeekStart, int ObservedDayCount);
    private sealed record Phase5B4Measurements(Phase5B4MeasurementSummary[] Measurements, int ObservedDayCount);
    private sealed record Phase5B4MeasurementSummary(string MeasurementType, decimal LatestDisplayValue);
    private sealed record Phase5B4Photos(Phase5B4PoseTimeline[] Poses, int PhotoCount, int MissingThumbnailCount);
    private sealed record Phase5B4PoseTimeline(string Pose, Phase5B4Photo[] Photos);
    private sealed record Phase5B4Photo(Guid Id, string PhotoDate, Guid MediaAssetId, string? ThumbnailUrl);
    private sealed record Phase5B4Section<TContext>(string Availability, string Reason, TContext? Context);
    private sealed record Phase5B4NutritionContext(int RecentDayCount, int RecentLoggedDayCount, int WindowLoggedDayCount);
    private sealed record Phase5B4TrainingContext(
        int RecentDayCount,
        int RecentScheduledSessionCount,
        int WindowScheduledSessionCount,
        int WindowCompletedWorkoutCount);
    private sealed record Phase5B4ClientDetails(uint Version);
    private sealed record Phase5B4Workspace(string Name, uint Version);
}
