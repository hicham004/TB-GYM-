using System.Net;
using System.Net.Http.Json;
using Npgsql;

namespace TB.Gym.Api.IntegrationTests;

public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task Phase5B1SeveralTypesShareADateAndMissingMeasurementsStayAbsent()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(
            coach,
            "p5b1-list-coach@example.test",
            "Measurement Coach",
            "Measurements List");
        using var client = CreateClient();
        await InviteAndAcceptAsync(coach, client, "p5b1-list-client@example.test", true);
        SetTenant(client, workspaceId);

        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync(
                "/api/progress/me/measurements",
                Measurement("Waist", 31.5m, "Inch", "2026-08-22")),
            HttpStatusCode.OK);
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync(
                "/api/progress/me/measurements",
                Measurement("Chest", 100m, "Centimetre", "2026-08-22")),
            HttpStatusCode.OK);
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync(
                "/api/progress/me/measurements",
                Measurement("BodyFatPercentage", 18m, "Percent", "2026-08-22")),
            HttpStatusCode.OK);

        var view = await client.GetFromJsonAsync<Phase5B1Measurements>(
            "/api/progress/me/measurements?from=2026-08-22&to=2026-08-24&displayUnit=Inch")
            ?? throw new AssertFailedException("Body measurement list was empty.");
        Assert.HasCount(2, view.Days);
        var measuredDay = view.Days.Single(day => day.Date == new DateOnly(2026, 8, 22));
        Assert.HasCount(3, measuredDay.Measurements);
        Assert.IsFalse(measuredDay.Measurements.Any(item =>
            item.MeasurementType is "Hips" or "Thigh" or "Arm"));
        Assert.IsEmpty(view.Days.Single(day => day.Date == new DateOnly(2026, 8, 23)).Measurements);

        var waist = measuredDay.Measurements.Single(item => item.MeasurementType == "Waist");
        Assert.AreEqual(80.010m, waist.CanonicalValue);
        Assert.AreEqual("Centimetre", waist.CanonicalUnit);
        Assert.AreEqual(31.5m, waist.EnteredValue);
        Assert.AreEqual("Inch", waist.EnteredUnit);
        Assert.AreEqual(31.5m, waist.DisplayValue);
        var bodyFat = measuredDay.Measurements.Single(item =>
            item.MeasurementType == "BodyFatPercentage");
        Assert.AreEqual("Percent", bodyFat.DisplayUnit);
        Assert.AreEqual(18m, bodyFat.DisplayValue);

        await AssertStatusAsync(
            await client.GetAsync(
                "/api/progress/me/measurements?from=2026-08-23&to=2026-08-22"),
            HttpStatusCode.BadRequest);
        await AssertStatusAsync(
            await client.GetAsync(
                "/api/progress/me/measurements?from=2025-08-20&to=2026-08-22"),
            HttpStatusCode.BadRequest);
    }

    [TestMethod]
    public async Task Phase5B1DuplicateDateAndTypeConflictsWhileAnotherTypeSucceeds()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(
            coach,
            "p5b1-duplicate-coach@example.test",
            "Measurement Coach",
            "Measurements Duplicate");
        using var client = CreateClient();
        await InviteAndAcceptAsync(coach, client, "p5b1-duplicate-client@example.test", true);
        SetTenant(client, workspaceId);

        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync(
                "/api/progress/me/measurements",
                Measurement("Waist", 80m, "Centimetre", "2026-08-22")),
            HttpStatusCode.OK);
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync(
                "/api/progress/me/measurements",
                Measurement("Waist", 81m, "Centimetre", "2026-08-22")),
            HttpStatusCode.Conflict);
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync(
                "/api/progress/me/measurements",
                Measurement("Hips", 95m, "Centimetre", "2026-08-22")),
            HttpStatusCode.OK);
    }

    [TestMethod]
    public async Task Phase5B1CorrectionPreservesHistoryAndConcurrentCorrectionConflicts()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(
            coach,
            "p5b1-correction-coach@example.test",
            "Measurement Coach",
            "Measurements Correction");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(
            coach,
            client,
            "p5b1-correction-client@example.test",
            true);
        SetTenant(client, workspaceId);

        await RefreshCsrfAsync(client);
        var createdResponse = await client.PostAsJsonAsync(
            "/api/progress/me/measurements",
            Measurement("Waist", 80m, "Centimetre", "2026-08-22"));
        await AssertStatusAsync(createdResponse, HttpStatusCode.OK);
        var created = await RequiredJsonAsync<Phase5B1Measurement>(createdResponse);

        await RefreshCsrfAsync(coach);
        var firstCorrection = await coach.PutAsJsonAsync(
            $"/api/progress/clients/{clientId}/measurements/{created.Id}",
            MeasurementCorrection(81m, "Centimetre", created.Version, "Tape was misread."));
        await AssertStatusAsync(firstCorrection, HttpStatusCode.OK);
        var history = await RequiredJsonAsync<Phase5B1History>(firstCorrection);
        Assert.AreEqual(81m, history.Current.CanonicalValue);
        Assert.HasCount(1, history.PreviousValues);
        Assert.AreEqual(80m, history.PreviousValues[0].CanonicalValue);
        Assert.AreEqual("Client", history.PreviousValues[0].Source);
        Assert.AreEqual("Coach", history.Current.Source);

        await RefreshCsrfAsync(client);
        var concurrent = await Task.WhenAll(
            client.PutAsJsonAsync(
                $"/api/progress/me/measurements/{created.Id}",
                MeasurementCorrection(
                    82m,
                    "Centimetre",
                    history.Current.Version,
                    "Concurrent correction A.")),
            client.PutAsJsonAsync(
                $"/api/progress/me/measurements/{created.Id}",
                MeasurementCorrection(
                    83m,
                    "Centimetre",
                    history.Current.Version,
                    "Concurrent correction B.")));
        CollectionAssert.AreEquivalent(
            new[] { HttpStatusCode.OK, HttpStatusCode.Conflict },
            concurrent.Select(response => response.StatusCode).ToArray());

        var finalHistory = await client.GetFromJsonAsync<Phase5B1History>(
            $"/api/progress/me/measurements/{created.Id}/history")
            ?? throw new AssertFailedException("Measurement correction history was empty.");
        Assert.HasCount(2, finalHistory.PreviousValues);

        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var correctionMutation = connection.CreateCommand();
        correctionMutation.CommandText =
            "UPDATE progress.\"BodyMeasurementCorrections\" SET \"Reason\" = 'rewrite' WHERE \"MeasurementId\" = @id";
        correctionMutation.Parameters.AddWithValue("id", created.Id);
        var correctionException = await Assert.ThrowsExactlyAsync<PostgresException>(
            async () => await correctionMutation.ExecuteNonQueryAsync());
        Assert.AreEqual("23514", correctionException.SqlState);

        await using var identityMutation = connection.CreateCommand();
        identityMutation.CommandText =
            "UPDATE progress.\"BodyMeasurements\" SET \"MeasurementType\" = 'Chest' WHERE \"Id\" = @id";
        identityMutation.Parameters.AddWithValue("id", created.Id);
        var identityException = await Assert.ThrowsExactlyAsync<PostgresException>(
            async () => await identityMutation.ExecuteNonQueryAsync());
        Assert.AreEqual("23514", identityException.SqlState);
    }

    [TestMethod]
    public async Task Phase5B1AuthorizationBlockingAndWorkspaceIsolationMirrorBodyweight()
    {
        const string sharedEmail = "p5b1-auth-owner@example.test";
        using var coachA = CreateClient();
        var workspaceA = await RegisterCoachAsync(
            coachA,
            "p5b1-auth-coach-a@example.test",
            "Measurement Coach A",
            "Measurements Auth A");
        using var owner = CreateClient();
        var clientA = await InviteAndAcceptAsync(coachA, owner, sharedEmail, true);
        SetTenant(owner, workspaceA);
        using var otherClient = CreateClient();
        await InviteAndAcceptAsync(
            coachA,
            otherClient,
            "p5b1-auth-other@example.test",
            true);
        SetTenant(otherClient, workspaceA);

        await RefreshCsrfAsync(owner);
        var recordedResponse = await owner.PostAsJsonAsync(
            "/api/progress/me/measurements",
            Measurement("Waist", 80m, "Centimetre", "2026-08-22"));
        await AssertStatusAsync(recordedResponse, HttpStatusCode.OK);
        var recorded = await RequiredJsonAsync<Phase5B1Measurement>(recordedResponse);

        await AssertStatusAsync(
            await otherClient.GetAsync(
                $"/api/progress/me/measurements/{recorded.Id}/history"),
            HttpStatusCode.NotFound);
        await RefreshCsrfAsync(otherClient);
        await AssertStatusAsync(
            await otherClient.PutAsJsonAsync(
                $"/api/progress/me/measurements/{recorded.Id}",
                MeasurementCorrection(81m, "Centimetre", recorded.Version, "Wrong owner.")),
            HttpStatusCode.NotFound);
        await AssertStatusAsync(
            await otherClient.GetAsync($"/api/progress/clients/{clientA}/measurements"),
            HttpStatusCode.Forbidden);

        using var coachB = CreateClient();
        var workspaceB = await RegisterCoachAsync(
            coachB,
            "p5b1-auth-coach-b@example.test",
            "Measurement Coach B",
            "Measurements Auth B");
        await AssertStatusAsync(
            await coachB.GetAsync($"/api/progress/clients/{clientA}/measurements"),
            HttpStatusCode.NotFound);
        await RefreshCsrfAsync(coachB);
        await AssertStatusAsync(
            await coachB.PostAsJsonAsync(
                $"/api/progress/clients/{clientA}/measurements",
                Measurement("Chest", 100m, "Centimetre", "2026-08-22")),
            HttpStatusCode.NotFound);
        await AssertStatusAsync(
            await coachB.PutAsJsonAsync(
                $"/api/progress/clients/{clientA}/measurements/{recorded.Id}",
                MeasurementCorrection(81m, "Centimetre", recorded.Version, "Cross tenant.")),
            HttpStatusCode.NotFound);
        await AssertStatusAsync(
            await coachB.GetAsync(
                $"/api/progress/clients/{clientA}/measurements/{recorded.Id}/history"),
            HttpStatusCode.NotFound);

        var profile = await coachA.GetFromJsonAsync<Phase5B1ClientDetails>(
            $"/api/clients/{clientA}")
            ?? throw new AssertFailedException("Client details were empty.");
        await RefreshCsrfAsync(coachA);
        await AssertStatusAsync(
            await coachA.PostAsJsonAsync(
                $"/api/clients/{clientA}/relationship/block",
                new { reason = "Measurement privacy boundary.", profile.Version }),
            HttpStatusCode.OK);
        await AssertStatusAsync(
            await coachA.GetAsync($"/api/progress/clients/{clientA}/measurements"),
            HttpStatusCode.NotFound);
        await AssertStatusAsync(
            await coachA.GetAsync(
                $"/api/progress/clients/{clientA}/measurements/{recorded.Id}/history"),
            HttpStatusCode.NotFound);
        await RefreshCsrfAsync(coachA);
        await AssertStatusAsync(
            await coachA.PostAsJsonAsync(
                $"/api/progress/clients/{clientA}/measurements",
                Measurement("Chest", 100m, "Centimetre", "2026-08-22")),
            HttpStatusCode.Forbidden);
        await AssertStatusAsync(
            await coachA.PutAsJsonAsync(
                $"/api/progress/clients/{clientA}/measurements/{recorded.Id}",
                MeasurementCorrection(81m, "Centimetre", recorded.Version, "Blocked coach.")),
            HttpStatusCode.Forbidden);
        await AssertStatusAsync(
            await owner.GetAsync("/api/progress/me/measurements?from=2026-08-22&to=2026-08-23"),
            HttpStatusCode.OK);

        var clientB = await InviteAndAcceptAsync(coachB, owner, sharedEmail, false);
        SetTenant(owner, workspaceB);
        var beforeB = await owner.GetFromJsonAsync<Phase5B1Measurements>(
            "/api/progress/me/measurements?from=2026-08-22&to=2026-08-23")
            ?? throw new AssertFailedException("Workspace B measurement list was empty.");
        Assert.IsEmpty(beforeB.Days.Single().Measurements);
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync(
                "/api/progress/me/measurements",
                Measurement("Waist", 90m, "Centimetre", "2026-08-22")),
            HttpStatusCode.OK);

        SetTenant(owner, workspaceA);
        var viewA = await owner.GetFromJsonAsync<Phase5B1Measurements>(
            "/api/progress/me/measurements?from=2026-08-22&to=2026-08-23")
            ?? throw new AssertFailedException("Workspace A measurement list was empty.");
        SetTenant(owner, workspaceB);
        var viewB = await owner.GetFromJsonAsync<Phase5B1Measurements>(
            "/api/progress/me/measurements?from=2026-08-22&to=2026-08-23")
            ?? throw new AssertFailedException("Workspace B measurement list was empty.");
        Assert.AreEqual(clientA, viewA.ClientProfileId);
        Assert.AreEqual(80m, viewA.Days.Single().Measurements.Single().CanonicalValue);
        Assert.AreEqual(clientB, viewB.ClientProfileId);
        Assert.AreEqual(90m, viewB.Days.Single().Measurements.Single().CanonicalValue);
    }

    private static object Measurement(
        string measurementType,
        decimal value,
        string unit,
        string measurementDate) => new
        {
            measurementType,
            value,
            unit,
            measurementDate,
        };

    private static object MeasurementCorrection(
        decimal value,
        string unit,
        uint version,
        string reason) => new
        {
            value,
            unit,
            reason,
            version,
        };

    private sealed record Phase5B1Measurement(
        Guid Id,
        DateOnly MeasurementDate,
        string MeasurementType,
        decimal CanonicalValue,
        string CanonicalUnit,
        decimal EnteredValue,
        string EnteredUnit,
        decimal DisplayValue,
        string DisplayUnit,
        string Source,
        uint Version);
    private sealed record Phase5B1MeasurementDay(
        DateOnly Date,
        Phase5B1Measurement[] Measurements);
    private sealed record Phase5B1Measurements(
        Guid ClientProfileId,
        string DisplayUnit,
        DateOnly From,
        DateOnly ToExclusive,
        Phase5B1MeasurementDay[] Days);
    private sealed record Phase5B1History(
        Phase5B1Measurement Current,
        Phase5B1HistoryItem[] PreviousValues);
    private sealed record Phase5B1HistoryItem(decimal CanonicalValue, string Source);
    private sealed record Phase5B1ClientDetails(bool IsCoachBlocked, uint Version);
}
