using System.Net;
using System.Net.Http.Json;
using Npgsql;

namespace TB.Gym.Api.IntegrationTests;

public sealed partial class Phase3TrainingWorkflowTests
{
    private const string Phase5B6Window = "from=2026-08-17&to=2026-08-24";

    [TestMethod]
    public async Task Phase5B6MisdatedObservationIsVoidedAndReplacedOnTheCorrectDate()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "p5b6-fix-coach@example.test", "Fix Coach", "Bodyweight Fix");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "p5b6-fix-client@example.test", true);
        SetTenant(client, workspaceId);

        // 80 kg was actually measured on the 18th but was logged against the 17th.
        var misdated = await Phase5B6RecordAsync(client, 80m, "2026-08-17");
        await Phase5B6RecordAsync(client, 100m, "2026-08-19");
        await Phase5B6RecordAsync(client, 100m, "2026-08-21");

        await RefreshCsrfAsync(coach);
        var replaced = await coach.PostAsJsonAsync(
            $"/api/progress/clients/{clientId}/bodyweight/{misdated.Id}/replace-date",
            new { measurementDate = "2026-08-18", reason = "Logged against the wrong day.", misdated.Version });
        await AssertStatusAsync(replaced, HttpStatusCode.OK);
        var correction = await RequiredJsonAsync<Phase5B6Correction>(replaced);

        // The replacement carries the original weight onto the correct date; only the date moved.
        Assert.AreEqual(new DateOnly(2026, 8, 18), correction.Replacement.MeasurementDate);
        Assert.AreEqual(80m, correction.Replacement.ValueKilograms);
        Assert.AreEqual("Active", correction.Replacement.Status);
        Assert.AreEqual("Coach", correction.Replacement.Source);

        // The original is retained exactly as it was recorded, marked voided rather than rewritten.
        Assert.AreEqual(misdated.Id, correction.Voided.Id);
        Assert.AreEqual(new DateOnly(2026, 8, 17), correction.Voided.MeasurementDate);
        Assert.AreEqual(80m, correction.Voided.ValueKilograms);
        Assert.AreEqual("Voided", correction.Voided.Status);
        Assert.AreEqual("Client", correction.Voided.Source);
        Assert.AreEqual(correction.Replacement.Id, correction.Void.ReplacementObservationId);
        Assert.AreEqual("Logged against the wrong day.", correction.Void.Reason);

        // The actor is the coach who made the correction, not the client who recorded the entry.
        Assert.AreEqual(correction.Replacement.RecordedByUserId, correction.Void.VoidedByUserId);
        Assert.AreNotEqual(Guid.Empty, correction.Void.VoidedByUserId);

        // Current truth: the wrong date is empty, the right one holds the weight, and the weekly
        // mean, sample count and trend all count three observations rather than four.
        var progress = await client.GetFromJsonAsync<Phase5Progress>("/api/progress/me?from=2026-08-17&to=2026-08-24")
            ?? throw new AssertFailedException("Progress view was empty.");
        Assert.IsNull(progress.Days.Single(day => day.Date == new DateOnly(2026, 8, 17)).Observation);
        Assert.AreEqual(80m, progress.Days.Single(day => day.Date == new DateOnly(2026, 8, 18)).Observation?.ValueKilograms);
        Assert.AreEqual(3, progress.Weeks.Single().ObservedDayCount);
        Assert.AreEqual(93.333m, progress.Weeks.Single().MeanKilograms);
        Assert.AreEqual(3, progress.Trend.SampleCount);
        Assert.AreEqual("Available", progress.Trend.Availability);

        // History still resolves the voided entry, with the reason and actor attached: a correction
        // has to stay visible to be auditable.
        var history = await client.GetFromJsonAsync<Phase5B6History>(
            $"/api/progress/me/bodyweight/{misdated.Id}/history")
            ?? throw new AssertFailedException("Voided observation history was empty.");
        Assert.AreEqual("Voided", history.Current.Status);
        Assert.AreEqual(new DateOnly(2026, 8, 17), history.Current.MeasurementDate);
        Assert.IsNotNull(history.Void);
        Assert.AreEqual("Logged against the wrong day.", history.Void.Reason);
        Assert.AreEqual(correction.Void.VoidedByUserId, history.Void.VoidedByUserId);
        Assert.AreEqual(correction.Replacement.Id, history.Void.ReplacementObservationId);

        // A voided entry is not current truth, so it can no longer be value-corrected or re-voided.
        await RefreshCsrfAsync(client);
        var correctVoided = await client.PutAsJsonAsync(
            $"/api/progress/me/bodyweight/{misdated.Id}",
            new { value = 81m, unit = "Kilogram", reason = "Too late.", history.Current.Version });
        Assert.AreEqual(HttpStatusCode.Conflict, correctVoided.StatusCode);
        Assert.AreEqual("BodyweightObservationVoided", (await RequiredJsonAsync<Phase5B6Problem>(correctVoided)).Code);

        await RefreshCsrfAsync(client);
        var voidAgain = await client.PostAsJsonAsync(
            $"/api/progress/me/bodyweight/{misdated.Id}/replace-date",
            new { measurementDate = "2026-08-16", reason = "Second void.", history.Current.Version });
        Assert.AreEqual(HttpStatusCode.Conflict, voidAgain.StatusCode);
        Assert.AreEqual("BodyweightObservationVoided", (await RequiredJsonAsync<Phase5B6Problem>(voidAgain)).Code);

        // Both rows survive, and exactly one void record explains the pair.
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT (SELECT count(*) FROM progress.\"BodyweightObservations\" WHERE \"ClientProfileId\" = @client), " +
            "(SELECT count(*) FROM progress.\"BodyweightObservations\" WHERE \"ClientProfileId\" = @client AND \"IsActive\"), " +
            "(SELECT count(*) FROM progress.\"BodyweightObservationVoids\" WHERE \"ClientProfileId\" = @client)";
        command.Parameters.AddWithValue("client", clientId);
        await using var reader = await command.ExecuteReaderAsync();
        Assert.IsTrue(await reader.ReadAsync());
        Assert.AreEqual(4L, reader.GetInt64(0));
        Assert.AreEqual(3L, reader.GetInt64(1));
        Assert.AreEqual(1L, reader.GetInt64(2));
    }

    [TestMethod]
    public async Task Phase5B6ReplacingOntoAnOccupiedDateIsRejectedAndLeavesTheOriginalActive()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "p5b6-clash-coach@example.test", "Clash Coach", "Bodyweight Clash");
        using var client = CreateClient();
        await InviteAndAcceptAsync(coach, client, "p5b6-clash-client@example.test", true);
        SetTenant(client, workspaceId);

        var misdated = await Phase5B6RecordAsync(client, 80m, "2026-08-17");
        var occupant = await Phase5B6RecordAsync(client, 90m, "2026-08-18");

        await RefreshCsrfAsync(client);
        var rejected = await client.PostAsJsonAsync(
            $"/api/progress/me/bodyweight/{misdated.Id}/replace-date",
            new { measurementDate = "2026-08-18", reason = "That date is taken.", misdated.Version });
        Assert.AreEqual(HttpStatusCode.Conflict, rejected.StatusCode);
        Assert.AreEqual("BodyweightDateAlreadyExists", (await RequiredJsonAsync<Phase5B6Problem>(rejected)).Code);

        // The whole operation is one transaction, so a rejected collision leaves nothing half-done:
        // the original is still active on its original date and the occupant is untouched.
        var progress = await client.GetFromJsonAsync<Phase5Progress>("/api/progress/me?from=2026-08-17&to=2026-08-19")
            ?? throw new AssertFailedException("Progress view was empty.");
        Assert.AreEqual(80m, progress.Days.Single(day => day.Date == new DateOnly(2026, 8, 17)).Observation?.ValueKilograms);
        Assert.AreEqual(90m, progress.Days.Single(day => day.Date == new DateOnly(2026, 8, 18)).Observation?.ValueKilograms);

        var history = await client.GetFromJsonAsync<Phase5B6History>(
            $"/api/progress/me/bodyweight/{misdated.Id}/history")
            ?? throw new AssertFailedException("History was empty.");
        Assert.AreEqual("Active", history.Current.Status);
        Assert.IsNull(history.Void);

        // Correcting onto its own date is a validation error, not a silent no-op that voids the row.
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync(
                $"/api/progress/me/bodyweight/{misdated.Id}/replace-date",
                new { measurementDate = "2026-08-17", reason = "Same date.", history.Current.Version }),
            HttpStatusCode.BadRequest);

        // A future date is refused on this route exactly as it is when recording.
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync(
                $"/api/progress/me/bodyweight/{occupant.Id}/replace-date",
                new { measurementDate = "2026-09-01", reason = "Not yet.", occupant.Version }),
            HttpStatusCode.BadRequest);
    }

    [TestMethod]
    public async Task Phase5B6AFreedDateCanBeLoggedAgainAfterTheVoid()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "p5b6-reuse-coach@example.test", "Reuse Coach", "Bodyweight Reuse");
        using var client = CreateClient();
        await InviteAndAcceptAsync(coach, client, "p5b6-reuse-client@example.test", true);
        SetTenant(client, workspaceId);

        var misdated = await Phase5B6RecordAsync(client, 80m, "2026-08-17");
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync(
                $"/api/progress/me/bodyweight/{misdated.Id}/replace-date",
                new { measurementDate = "2026-08-18", reason = "Off by one day.", misdated.Version }),
            HttpStatusCode.OK);

        // The voided row still holds 2026-08-17, but only active rows reserve a date, so the date is
        // free again. Under the old total unique index this would have been blocked forever.
        var relogged = await Phase5B6RecordAsync(client, 79m, "2026-08-17");
        Assert.AreEqual(new DateOnly(2026, 8, 17), relogged.MeasurementDate);

        // And it is a genuine reservation again: a second active row on that date is still refused.
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync(
                "/api/progress/me/bodyweight",
                new { value = 78m, unit = "Kilogram", measurementDate = "2026-08-17" }),
            HttpStatusCode.Conflict);

        var progress = await client.GetFromJsonAsync<Phase5Progress>("/api/progress/me?from=2026-08-17&to=2026-08-19")
            ?? throw new AssertFailedException("Progress view was empty.");
        Assert.AreEqual(79m, progress.Days.Single(day => day.Date == new DateOnly(2026, 8, 17)).Observation?.ValueKilograms);
        Assert.AreEqual(80m, progress.Days.Single(day => day.Date == new DateOnly(2026, 8, 18)).Observation?.ValueKilograms);
    }

    [TestMethod]
    public async Task Phase5B6DashboardBodyweightSectionIgnoresVoidedObservations()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "p5b6-dash-coach@example.test", "Dash Coach", "Bodyweight Dash");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "p5b6-dash-client@example.test", true);
        SetTenant(client, workspaceId);

        await Phase5B6RecordAsync(client, 82m, "2026-08-18");
        var misdated = await Phase5B6RecordAsync(client, 70m, "2026-08-22");

        var before = await Phase5B6DashboardAsync(client);
        Assert.AreEqual(70m, before.Bodyweight.LatestDisplayValue);
        Assert.AreEqual(2, before.Bodyweight.ObservedDayCount);

        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync(
                $"/api/progress/me/bodyweight/{misdated.Id}/replace-date",
                new { measurementDate = "2026-08-19", reason = "Entered days later against today.", misdated.Version }),
            HttpStatusCode.OK);

        // The latest weight is now the 19th's replacement, and the count did not grow: a voided row
        // is neither the newest observation nor an extra observed day.
        var after = await Phase5B6DashboardAsync(client);
        Assert.AreEqual(70m, after.Bodyweight.LatestDisplayValue);
        Assert.AreEqual(new DateOnly(2026, 8, 19), after.Bodyweight.Latest!.MeasurementDate);
        Assert.AreEqual(2, after.Bodyweight.ObservedDayCount);

        // The coach-facing dashboard reads the same corrected figures.
        var coachDashboard = await coach.GetFromJsonAsync<Phase5B6Dashboard>(
            $"/api/progress/clients/{clientId}/dashboard?{Phase5B6Window}")
            ?? throw new AssertFailedException("Coach dashboard was empty.");
        Assert.AreEqual(new DateOnly(2026, 8, 19), coachDashboard.Bodyweight.Latest!.MeasurementDate);
        Assert.AreEqual(2, coachDashboard.Bodyweight.ObservedDayCount);
    }

    [TestMethod]
    public async Task Phase5B6OnboardingDoesNotAdoptAVoidedObservationAsTheFirstWeighIn()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "p5b6-intake-coach@example.test", "Intake Coach", "Bodyweight Intake");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "p5b6-intake-client@example.test", true);
        SetTenant(client, workspaceId);

        // The first weigh-in is logged against the wrong day, then corrected onto the right one.
        var misdated = await Phase5B6RecordAsync(client, 78.2m, "2026-08-19");
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync(
                $"/api/progress/me/bodyweight/{misdated.Id}/replace-date",
                new { measurementDate = "2026-08-20", reason = "Weighed on the 20th, logged on the 19th.", misdated.Version }),
            HttpStatusCode.OK);

        var profile = await client.GetFromJsonAsync<Phase5Profile>("/api/client-profile/me")
            ?? throw new AssertFailedException("Client profile was empty.");
        await RefreshCsrfAsync(client);

        // Onboarding reconciles against the earliest observation. If it saw the voided row it would
        // reject this as a mismatched initial fact.
        await AssertStatusAsync(
            await client.PostAsJsonAsync("/api/client-profile/me/complete-onboarding", new
            {
                intake = Phase5B6Intake(profile.Version),
                initialBodyweightValue = 78.2m,
                initialBodyweightUnit = "Kilogram",
                measurementDate = "2026-08-20",
            }),
            HttpStatusCode.OK);

        // It adopted the corrected observation rather than adding a third row.
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT count(*) FROM progress.\"BodyweightObservations\" WHERE \"ClientProfileId\" = @client";
        command.Parameters.AddWithValue("client", clientId);
        Assert.AreEqual(2L, (long)(await command.ExecuteScalarAsync() ?? -1L));

        var progress = await client.GetFromJsonAsync<Phase5Progress>("/api/progress/me?from=2026-08-19&to=2026-08-21")
            ?? throw new AssertFailedException("Progress view was empty.");
        Assert.IsNull(progress.Days.Single(day => day.Date == new DateOnly(2026, 8, 19)).Observation);
        Assert.AreEqual(78.2m, progress.Days.Single(day => day.Date == new DateOnly(2026, 8, 20)).Observation?.ValueKilograms);
    }

    [TestMethod]
    public async Task Phase5B6ReplaceDateIsDeniedAcrossTenantsAndToABlockedCoach()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "p5b6-auth-coach@example.test", "Auth Coach", "Bodyweight Auth");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "p5b6-auth-client@example.test", true);
        SetTenant(client, workspaceId);
        using var otherClient = CreateClient();
        await InviteAndAcceptAsync(coach, otherClient, "p5b6-auth-other@example.test", true);
        SetTenant(otherClient, workspaceId);

        var observation = await Phase5B6RecordAsync(client, 80m, "2026-08-17");
        var request = new { measurementDate = "2026-08-18", reason = "Authorization boundary check.", observation.Version };

        // Another client of the same workspace cannot reach the entry on either route.
        await RefreshCsrfAsync(otherClient);
        await AssertStatusAsync(
            await otherClient.PostAsJsonAsync($"/api/progress/me/bodyweight/{observation.Id}/replace-date", request),
            HttpStatusCode.NotFound);
        await AssertStatusAsync(
            await otherClient.PostAsJsonAsync($"/api/progress/clients/{clientId}/bodyweight/{observation.Id}/replace-date", request),
            HttpStatusCode.Forbidden);

        // A coach of a different workspace cannot resolve the client at all.
        using var foreignCoach = CreateClient();
        await RegisterCoachAsync(foreignCoach, "p5b6-auth-foreign@example.test", "Foreign", "Bodyweight Foreign");
        await RefreshCsrfAsync(foreignCoach);
        await AssertStatusAsync(
            await foreignCoach.PostAsJsonAsync($"/api/progress/clients/{clientId}/bodyweight/{observation.Id}/replace-date", request),
            HttpStatusCode.NotFound);

        var details = await coach.GetFromJsonAsync<Phase5ClientDetails>($"/api/clients/{clientId}")
            ?? throw new AssertFailedException("Client details were empty.");
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync(
                $"/api/clients/{clientId}/relationship/block",
                new { reason = "Blocked for the correction test.", details.Version }),
            HttpStatusCode.OK);

        // A blocked coach loses the write, while the client keeps it over their own data.
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync($"/api/progress/clients/{clientId}/bodyweight/{observation.Id}/replace-date", request),
            HttpStatusCode.Forbidden);

        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync($"/api/progress/me/bodyweight/{observation.Id}/replace-date", request),
            HttpStatusCode.OK);
    }

    private static async Task<Phase5B6Observation> Phase5B6RecordAsync(
        HttpClient caller,
        decimal value,
        string measurementDate)
    {
        await RefreshCsrfAsync(caller);
        var response = await caller.PostAsJsonAsync(
            "/api/progress/me/bodyweight",
            new { value, unit = "Kilogram", measurementDate });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<Phase5B6Observation>(response);
    }

    private static async Task<Phase5B6Dashboard> Phase5B6DashboardAsync(HttpClient caller)
    {
        var response = await caller.GetAsync($"/api/progress/me/dashboard?{Phase5B6Window}");
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<Phase5B6Dashboard>(response);
    }

    private static object Phase5B6Intake(uint version) => new
    {
        firstName = "Intake",
        lastName = "Client",
        phoneNumber = "+96170000001",
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
        version,
    };

    private sealed record Phase5B6Observation(
        Guid Id,
        DateOnly MeasurementDate,
        decimal ValueKilograms,
        string Source,
        Guid? RecordedByUserId,
        string Status,
        uint Version);

    private sealed record Phase5B6Void(
        Guid Id,
        string Reason,
        Guid VoidedByUserId,
        Guid? ReplacementObservationId);

    private sealed record Phase5B6Correction(
        Phase5B6Observation Replacement,
        Phase5B6Observation Voided,
        Phase5B6Void Void);

    private sealed record Phase5B6History(Phase5B6Observation Current, Phase5B6Void? Void);

    private sealed record Phase5B6Bodyweight(
        Phase5B6Observation? Latest,
        decimal? LatestDisplayValue,
        int ObservedDayCount);

    private sealed record Phase5B6Dashboard(Phase5B6Bodyweight Bodyweight);

    private sealed record Phase5B6Problem(string? Code);
}
