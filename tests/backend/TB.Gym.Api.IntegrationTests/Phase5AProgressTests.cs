using System.Net;
using System.Net.Http.Json;
using Npgsql;

namespace TB.Gym.Api.IntegrationTests;

public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task Phase5OnboardingWeightIsTheFirstProgressObservationNotADuplicate()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "p5-onboarding-coach@example.test", "Progress Coach", "Progress Onboarding");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "p5-onboarding-client@example.test", true);
        SetTenant(client, workspaceId);
        var profile = await client.GetFromJsonAsync<Phase5Profile>("/api/client-profile/me")
            ?? throw new AssertFailedException("Client profile was empty.");

        // Progress is available before commercial enrollment and can precede intake completion.
        // Completing intake with the same initial fact must adopt this first row, not duplicate it.
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync("/api/progress/me/bodyweight", Weight(78.2m, "2026-08-20")),
            HttpStatusCode.OK);

        await RefreshCsrfAsync(client);
        var completed = await client.PostAsJsonAsync("/api/client-profile/me/complete-onboarding", new
        {
            intake = new
            {
                firstName = "Training",
                lastName = "Client",
                phoneNumber = "+96170000000",
                birthDate = "1995-04-02",
                heightValue = 175m,
                heightUnit = "Centimeter",
                workType = "Office",
                averageDailySteps = 8000,
                trainingBackground = "Two years",
                foodPreferences = "Mediterranean",
                foodAversions = (string?)null,
                goals = "Build strength",
                allergies = (string?)null,
                medications = (string?)null,
                previousInjuries = (string?)null,
                profile.Version,
            },
            initialBodyweightValue = 78.2m,
            initialBodyweightUnit = "Kilogram",
            measurementDate = "2026-08-20",
        });
        await AssertStatusAsync(completed, HttpStatusCode.OK);

        var progress = await client.GetFromJsonAsync<Phase5Progress>("/api/progress/me?from=2026-08-20&to=2026-08-21")
            ?? throw new AssertFailedException("Progress view was empty.");
        var initial = progress.Days.Single().Observation
            ?? throw new AssertFailedException("Initial weight did not reach progress history.");
        Assert.AreEqual(78.2m, initial.ValueKilograms);
        Assert.AreEqual("Client", initial.Source);

        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync("/api/progress/me/bodyweight", Weight(78.2m, "2026-08-20")),
            HttpStatusCode.Conflict);

        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT count(*) FROM progress.\"BodyweightObservations\" WHERE \"ClientProfileId\" = @client";
        command.Parameters.AddWithValue("client", clientId);
        Assert.AreEqual(1L, (long)(await command.ExecuteScalarAsync() ?? -1L));
    }

    [TestMethod]
    public async Task Phase5AuthorizationScopesEveryProgressEndpointWithoutEntitlement()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "p5-auth-coach@example.test", "Progress Coach", "Progress Auth");
        using var owner = CreateClient();
        var ownerId = await InviteAndAcceptAsync(coach, owner, "p5-auth-owner@example.test", true);
        SetTenant(owner, workspaceId);
        using var otherClient = CreateClient();
        await InviteAndAcceptAsync(coach, otherClient, "p5-auth-other@example.test", true);
        SetTenant(otherClient, workspaceId);

        await RefreshCsrfAsync(owner);
        var recorded = await owner.PostAsJsonAsync("/api/progress/me/bodyweight", new
        {
            value = 123.456m,
            unit = "Kilogram",
            measurementDate = "2026-08-22",
        });
        await AssertStatusAsync(recorded, HttpStatusCode.OK);
        var observation = await RequiredJsonAsync<Phase5Observation>(recorded);

        // No commercial product or enrollment exists: own logging and history remain available.
        await AssertStatusAsync(await owner.GetAsync("/api/progress/me?from=2026-08-22&to=2026-08-23"), HttpStatusCode.OK);
        await AssertStatusAsync(await owner.GetAsync($"/api/progress/me/bodyweight/{observation.Id}/history"), HttpStatusCode.OK);
        await AssertStatusAsync(await coach.GetAsync($"/api/progress/clients/{ownerId}"), HttpStatusCode.OK);

        var profile = await coach.GetFromJsonAsync<Phase5ClientDetails>($"/api/clients/{ownerId}")
            ?? throw new AssertFailedException("Client details were empty.");
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync(
                $"/api/clients/{ownerId}/relationship/block",
                new { reason = "Progress privacy boundary.", profile.Version }),
            HttpStatusCode.OK);
        await AssertStatusAsync(await coach.GetAsync($"/api/progress/clients/{ownerId}"), HttpStatusCode.NotFound);
        await AssertStatusAsync(await coach.GetAsync($"/api/progress/clients/{ownerId}/bodyweight/{observation.Id}/history"), HttpStatusCode.NotFound);
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PostAsJsonAsync($"/api/progress/clients/{ownerId}/bodyweight", Weight(80m, "2026-08-21")), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await coach.PutAsJsonAsync($"/api/progress/clients/{ownerId}/bodyweight/{observation.Id}", Correction(observation.Version)), HttpStatusCode.Forbidden);

        // Blocking is scoped to the coach relationship; it does not hide the client's own facts.
        await AssertStatusAsync(await owner.GetAsync("/api/progress/me?from=2026-08-22&to=2026-08-23"), HttpStatusCode.OK);
        await AssertStatusAsync(await owner.GetAsync($"/api/progress/me/bodyweight/{observation.Id}/history"), HttpStatusCode.OK);

        await AssertStatusAsync(await otherClient.GetAsync($"/api/progress/me/bodyweight/{observation.Id}/history"), HttpStatusCode.NotFound);
        await RefreshCsrfAsync(otherClient);
        await AssertStatusAsync(await otherClient.PutAsJsonAsync($"/api/progress/me/bodyweight/{observation.Id}", Correction(observation.Version)), HttpStatusCode.NotFound);
        await AssertStatusAsync(await otherClient.GetAsync($"/api/progress/clients/{ownerId}"), HttpStatusCode.Forbidden);
        await RefreshCsrfAsync(otherClient);
        await AssertStatusAsync(await otherClient.PostAsJsonAsync($"/api/progress/clients/{ownerId}/bodyweight", Weight(80m, "2026-08-21")), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await otherClient.PutAsJsonAsync($"/api/progress/clients/{ownerId}/bodyweight/{observation.Id}", Correction(observation.Version)), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await otherClient.GetAsync($"/api/progress/clients/{ownerId}/bodyweight/{observation.Id}/history"), HttpStatusCode.Forbidden);

        using var foreignCoach = CreateClient();
        await RegisterCoachAsync(foreignCoach, "p5-auth-foreign@example.test", "Foreign Progress", "Foreign Progress");
        await AssertStatusAsync(await foreignCoach.GetAsync($"/api/progress/clients/{ownerId}"), HttpStatusCode.NotFound);
        await RefreshCsrfAsync(foreignCoach);
        await AssertStatusAsync(await foreignCoach.PostAsJsonAsync($"/api/progress/clients/{ownerId}/bodyweight", Weight(80m, "2026-08-21")), HttpStatusCode.NotFound);
        await AssertStatusAsync(await foreignCoach.PutAsJsonAsync($"/api/progress/clients/{ownerId}/bodyweight/{observation.Id}", Correction(observation.Version)), HttpStatusCode.NotFound);
        await AssertStatusAsync(await foreignCoach.GetAsync($"/api/progress/clients/{ownerId}/bodyweight/{observation.Id}/history"), HttpStatusCode.NotFound);

        Assert.IsFalse(RequiredSensitiveLogCapture.Text.Contains("123.456", StringComparison.Ordinal));
    }

    [TestMethod]
    public async Task Phase5MissingDaysUnitsWeeklyMeanAndTrendAreDeterministic()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "p5-summary-coach@example.test", "Progress Coach", "Progress Summary");
        using var client = CreateClient();
        await InviteAndAcceptAsync(coach, client, "p5-summary-client@example.test", true);
        SetTenant(client, workspaceId);

        await RefreshCsrfAsync(client);
        await AssertStatusAsync(await client.PostAsJsonAsync("/api/progress/me/bodyweight", Weight(100m, "2026-08-17")), HttpStatusCode.OK);
        await RefreshCsrfAsync(client);
        var pounds = await client.PostAsJsonAsync("/api/progress/me/bodyweight", new
        {
            value = 220.46226218487758072297380135m,
            unit = "Pound",
            measurementDate = "2026-08-20",
        });
        await AssertStatusAsync(pounds, HttpStatusCode.OK);
        Assert.AreEqual(100m, (await RequiredJsonAsync<Phase5Observation>(pounds)).ValueKilograms);

        var kilograms = await client.GetFromJsonAsync<Phase5Progress>("/api/progress/me?from=2026-08-17&to=2026-08-24&displayUnit=Kilogram")
            ?? throw new AssertFailedException("Progress view was empty.");
        Assert.HasCount(7, kilograms.Days);
        Assert.HasCount(5, kilograms.Days.Where(item => item.Observation is null).ToArray());
        Assert.AreEqual(2, kilograms.Weeks.Single().ObservedDayCount);
        Assert.AreEqual(100m, kilograms.Weeks.Single().MeanKilograms);
        Assert.AreEqual(2, kilograms.Trend.SampleCount);
        Assert.AreEqual("NotEnoughData", kilograms.Trend.Availability);
        Assert.IsNull(kilograms.Trend.LatestEstimateKilograms);
        Assert.IsTrue(kilograms.Days.All(day => day.TrendEstimate is null));
        Assert.IsTrue(kilograms.Trend.IsEstimate);

        await RefreshCsrfAsync(client);
        await AssertStatusAsync(await client.PostAsJsonAsync("/api/progress/me/bodyweight", Weight(100m, "2026-08-22")), HttpStatusCode.OK);
        kilograms = await client.GetFromJsonAsync<Phase5Progress>("/api/progress/me?from=2026-08-17&to=2026-08-24&displayUnit=Kilogram")
            ?? throw new AssertFailedException("Updated progress view was empty.");
        Assert.AreEqual("Available", kilograms.Trend.Availability);
        Assert.AreEqual(3, kilograms.Trend.SampleCount);
        Assert.AreEqual(100m, kilograms.Trend.LatestEstimateKilograms);
        Assert.AreEqual("2.0", kilograms.Trend.MethodVersion);
        Assert.AreEqual(10, kilograms.Trend.TimeConstantDays);
        Assert.AreEqual(90, kilograms.Trend.WarmupDays);
        Assert.AreEqual(3, kilograms.Trend.MinimumSampleCount);

        var displayedPounds = await client.GetFromJsonAsync<Phase5Progress>("/api/progress/me?from=2026-08-17&to=2026-08-24&displayUnit=Pound")
            ?? throw new AssertFailedException("Pound progress view was empty.");
        Assert.AreEqual(220.462m, displayedPounds.Weeks.Single().DisplayMean);
        Assert.IsTrue(displayedPounds.Days.Where(item => item.Observation is not null).All(item => item.Observation!.ValueKilograms == 100m));
    }

    [TestMethod]
    public async Task Phase5TrendForADateIsIndependentOfTheRequestedWindow()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "p5-window-coach@example.test", "Progress Coach", "Progress Windows");
        using var client = CreateClient();
        await InviteAndAcceptAsync(coach, client, "p5-window-client@example.test", true);
        SetTenant(client, workspaceId);

        foreach (var sample in new[]
        {
            (83m, "2026-05-20"),
            (82m, "2026-06-15"),
            (81m, "2026-07-10"),
            (80m, "2026-08-01"),
            (79m, "2026-08-15"),
        })
        {
            await RefreshCsrfAsync(client);
            await AssertStatusAsync(
                await client.PostAsJsonAsync("/api/progress/me/bodyweight", Weight(sample.Item1, sample.Item2)),
                HttpStatusCode.OK);
        }

        var wide = await client.GetFromJsonAsync<Phase5Progress>("/api/progress/me?from=2026-06-01&to=2026-08-16")
            ?? throw new AssertFailedException("Wide progress view was empty.");
        var narrow = await client.GetFromJsonAsync<Phase5Progress>("/api/progress/me?from=2026-07-01&to=2026-08-16")
            ?? throw new AssertFailedException("Narrow progress view was empty.");

        var targetDate = new DateOnly(2026, 8, 15);
        Assert.AreEqual(
            wide.Days.Single(day => day.Date == targetDate).TrendEstimate,
            narrow.Days.Single(day => day.Date == targetDate).TrendEstimate);
    }

    [TestMethod]
    public async Task Phase5InvalidProgressRangesReturnBadRequest()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "p5-range-coach@example.test", "Progress Coach", "Progress Ranges");
        using var client = CreateClient();
        await InviteAndAcceptAsync(coach, client, "p5-range-client@example.test", true);
        SetTenant(client, workspaceId);

        await AssertStatusAsync(
            await client.GetAsync("/api/progress/me?from=2026-08-23&to=2026-08-22"),
            HttpStatusCode.BadRequest);
        await AssertStatusAsync(
            await client.GetAsync("/api/progress/me?from=2025-08-20&to=2026-08-22"),
            HttpStatusCode.BadRequest);
    }

    [TestMethod]
    public async Task Phase5TenantClockAndNonMondayWeekStartControlDefaultMeasurementDate()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "p5-time-coach@example.test", "Progress Coach", "Progress Clock");
        using var client = CreateClient();
        await InviteAndAcceptAsync(coach, client, "p5-time-client@example.test", true);
        SetTenant(client, workspaceId);

        var workspace = await coach.GetFromJsonAsync<Phase5Workspace>("/api/workspace")
            ?? throw new AssertFailedException("Workspace was empty.");
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(await coach.PutAsJsonAsync("/api/workspace", new
        {
            workspace.Name,
            workspace.TimeZoneId,
            workspace.DefaultCulture,
            workspace.DefaultCurrencyCode,
            weekStartsOn = "Saturday",
            workspace.Version,
        }), HttpStatusCode.OK);

        // 20:30Z is 23:30 in Beirut on this date.
        RequiredTestClock.Set(new DateTimeOffset(2026, 8, 22, 20, 30, 0, TimeSpan.Zero));
        await RefreshCsrfAsync(client);
        var lateLocal = await client.PostAsJsonAsync("/api/progress/me/bodyweight", new { value = 80m, unit = "Kilogram" });
        await AssertStatusAsync(lateLocal, HttpStatusCode.OK);
        Assert.AreEqual(new DateOnly(2026, 8, 22), (await RequiredJsonAsync<Phase5Observation>(lateLocal)).MeasurementDate);

        // 21:30Z is already 00:30 on the next local day, proving the business date is not UTC.
        RequiredTestClock.Set(new DateTimeOffset(2026, 8, 22, 21, 30, 0, TimeSpan.Zero));
        await RefreshCsrfAsync(client);
        var afterMidnight = await client.PostAsJsonAsync("/api/progress/me/bodyweight", new { value = 79m, unit = "Kilogram" });
        await AssertStatusAsync(afterMidnight, HttpStatusCode.OK);
        Assert.AreEqual(new DateOnly(2026, 8, 23), (await RequiredJsonAsync<Phase5Observation>(afterMidnight)).MeasurementDate);

        var progress = await client.GetFromJsonAsync<Phase5Progress>("/api/progress/me?from=2026-08-22&to=2026-08-24")
            ?? throw new AssertFailedException("Progress view was empty.");
        Assert.AreEqual("Saturday", progress.WeekStartsOn);
        Assert.AreEqual(new DateOnly(2026, 8, 22), progress.Weeks.Single().WeekStart);
        Assert.AreEqual(2, progress.Weeks.Single().ObservedDayCount);
    }

    [TestMethod]
    public async Task Phase5ProgressIsIsolatedWhenTheSameUserBelongsToTwoWorkspaces()
    {
        const string clientEmail = "p5-multi-client@example.test";
        using var coachA = CreateClient();
        var workspaceA = await RegisterCoachAsync(coachA, "p5-multi-coach-a@example.test", "Coach A", "Progress Workspace A");
        using var sharedClient = CreateClient();
        var clientA = await InviteAndAcceptAsync(coachA, sharedClient, clientEmail, true);
        SetTenant(sharedClient, workspaceA);
        await RefreshCsrfAsync(sharedClient);
        await AssertStatusAsync(
            await sharedClient.PostAsJsonAsync("/api/progress/me/bodyweight", Weight(80m, "2026-08-21")),
            HttpStatusCode.OK);

        using var coachB = CreateClient();
        var workspaceB = await RegisterCoachAsync(coachB, "p5-multi-coach-b@example.test", "Coach B", "Progress Workspace B");
        var clientB = await InviteAndAcceptAsync(coachB, sharedClient, clientEmail, false);
        Assert.AreNotEqual(clientA, clientB);

        SetTenant(sharedClient, workspaceB);
        var beforeB = await sharedClient.GetFromJsonAsync<Phase5Progress>("/api/progress/me?from=2026-08-21&to=2026-08-22")
            ?? throw new AssertFailedException("Workspace B progress was empty.");
        Assert.IsNull(beforeB.Days.Single().Observation);
        await RefreshCsrfAsync(sharedClient);
        await AssertStatusAsync(
            await sharedClient.PostAsJsonAsync("/api/progress/me/bodyweight", Weight(90m, "2026-08-21")),
            HttpStatusCode.OK);

        SetTenant(sharedClient, workspaceA);
        var viewA = await sharedClient.GetFromJsonAsync<Phase5Progress>("/api/progress/me?from=2026-08-21&to=2026-08-22")
            ?? throw new AssertFailedException("Workspace A progress was empty.");
        SetTenant(sharedClient, workspaceB);
        var viewB = await sharedClient.GetFromJsonAsync<Phase5Progress>("/api/progress/me?from=2026-08-21&to=2026-08-22")
            ?? throw new AssertFailedException("Workspace B progress was empty.");

        Assert.AreEqual(clientA, viewA.ClientProfileId);
        Assert.AreEqual(80m, viewA.Days.Single().Observation?.ValueKilograms);
        Assert.AreEqual(clientB, viewB.ClientProfileId);
        Assert.AreEqual(90m, viewB.Days.Single().Observation?.ValueKilograms);
    }

    [TestMethod]
    public async Task Phase5CorrectionPreservesHistoryAndUniqueDailyObservation()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "p5-correction-coach@example.test", "Progress Coach", "Progress Correction");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "p5-correction-client@example.test", true);
        SetTenant(client, workspaceId);

        await RefreshCsrfAsync(client);
        var createdResponse = await client.PostAsJsonAsync("/api/progress/me/bodyweight", Weight(80m, "2026-08-21"));
        await AssertStatusAsync(createdResponse, HttpStatusCode.OK);
        var created = await RequiredJsonAsync<Phase5Observation>(createdResponse);

        await RefreshCsrfAsync(coach);
        var correctedResponse = await coach.PutAsJsonAsync(
            $"/api/progress/clients/{clientId}/bodyweight/{created.Id}",
            new { value = 81m, unit = "Kilogram", reason = "Scale was misread.", created.Version });
        await AssertStatusAsync(correctedResponse, HttpStatusCode.OK);
        var history = await RequiredJsonAsync<Phase5History>(correctedResponse);
        Assert.AreEqual(81m, history.Current.ValueKilograms);
        Assert.HasCount(1, history.PreviousValues);
        Assert.AreEqual(80m, history.PreviousValues[0].ValueKilograms);
        Assert.AreEqual("Client", history.PreviousValues[0].Source);
        Assert.AreEqual("Coach", history.Current.Source);

        await RefreshCsrfAsync(client);
        var concurrentCorrections = await Task.WhenAll(
            client.PutAsJsonAsync(
                $"/api/progress/me/bodyweight/{created.Id}",
                new { value = 82m, unit = "Kilogram", reason = "Concurrent correction A.", history.Current.Version }),
            client.PutAsJsonAsync(
                $"/api/progress/me/bodyweight/{created.Id}",
                new { value = 83m, unit = "Kilogram", reason = "Concurrent correction B.", history.Current.Version }));
        CollectionAssert.AreEquivalent(
            new[] { HttpStatusCode.OK, HttpStatusCode.Conflict },
            concurrentCorrections.Select(response => response.StatusCode).ToArray());

        await RefreshCsrfAsync(client);
        var duplicate = await client.PostAsJsonAsync("/api/progress/me/bodyweight", Weight(82m, "2026-08-21"));
        await AssertStatusAsync(duplicate, HttpStatusCode.Conflict);

        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT (SELECT count(*) FROM progress.\"BodyweightObservations\" WHERE \"ClientProfileId\" = @client), (SELECT count(*) FROM progress.\"BodyweightCorrections\" WHERE \"ClientProfileId\" = @client)";
        command.Parameters.AddWithValue("client", clientId);
        await using var reader = await command.ExecuteReaderAsync();
        Assert.IsTrue(await reader.ReadAsync());
        Assert.AreEqual(1L, reader.GetInt64(0));
        Assert.AreEqual(2L, reader.GetInt64(1));
    }

    private static object Weight(decimal value, string measurementDate) => new
    {
        value,
        unit = "Kilogram",
        measurementDate,
    };

    private static object Correction(uint version) => new
    {
        value = 81m,
        unit = "Kilogram",
        reason = "Authorization boundary check.",
        version,
    };

    private sealed record Phase5Observation(
        Guid Id,
        DateOnly MeasurementDate,
        decimal ValueKilograms,
        string Source,
        uint Version);
    private sealed record Phase5Day(DateOnly Date, Phase5Observation? Observation, decimal? TrendEstimate);
    private sealed record Phase5Week(DateOnly WeekStart, decimal? MeanKilograms, decimal? DisplayMean, int ObservedDayCount);
    private sealed record Phase5Trend(
        bool IsEstimate,
        string Availability,
        string MethodVersion,
        int TimeConstantDays,
        int WarmupDays,
        int MinimumSampleCount,
        int SampleCount,
        decimal? LatestEstimateKilograms);
    private sealed record Phase5Progress(Guid ClientProfileId, string WeekStartsOn, Phase5Day[] Days, Phase5Week[] Weeks, Phase5Trend Trend);
    private sealed record Phase5History(Phase5Observation Current, Phase5HistoryItem[] PreviousValues);
    private sealed record Phase5HistoryItem(decimal ValueKilograms, string Source);
    private sealed record Phase5Workspace(string Name, string TimeZoneId, string DefaultCulture, string DefaultCurrencyCode, uint Version);
    private sealed record Phase5Profile(uint Version);
    private sealed record Phase5ClientDetails(bool IsCoachBlocked, uint Version);
}
