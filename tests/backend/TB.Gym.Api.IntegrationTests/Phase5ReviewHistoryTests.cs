using System.Net;
using System.Net.Http.Json;
using TB.Gym.Modules.Progress;

namespace TB.Gym.Api.IntegrationTests;

public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task ReviewHistoryBoundaryCrossesEmptyYearsAndKeepsClientAndPhotoAudienceScope()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "review-history@example.test", "History Coach", "History");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "review-history-client@example.test", true);
        SetTenant(client, workspaceId);
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(await client.PostAsJsonAsync("/api/progress/me/measurements", Measurement("Waist", 80m, "Centimetre", "2020-06-15")), HttpStatusCode.OK);
        var photo = await UploadProgressPhotoAsync(client, "/api/progress/me/photos?pose=Front&photoDate=2020-06-15");
        const string range = "?from=2025-08-01&to=2026-08-01";
        var measured = await client.GetFromJsonAsync<BodyMeasurementsView>("/api/progress/me/measurements" + range, SliceReadJson);
        Assert.AreEqual(new DateOnly(2020, 6, 15), measured!.EarlierDate);
        Assert.IsTrue(measured.Days.All(day => day.Measurements.Count == 0));
        var photos = await client.GetFromJsonAsync<ProgressPhotosView>("/api/progress/me/photos" + range, SliceReadJson);
        Assert.AreEqual(new DateOnly(2020, 6, 15), photos!.EarlierDate);
        Assert.IsEmpty(photos.Photos);
        var older = await client.GetFromJsonAsync<BodyMeasurementsView>("/api/progress/me/measurements?from=2019-06-16&to=2020-06-16", SliceReadJson);
        Assert.IsNull(older!.EarlierDate);
        Assert.HasCount(1, older.Days.SelectMany(day => day.Measurements).ToArray());
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(await client.PostAsJsonAsync($"/api/progress/me/photos/{photo.Id}/remove", new { reason = "Wrong photo", photo.Version }), HttpStatusCode.OK);
        Assert.AreEqual(new DateOnly(2020, 6, 15), (await client.GetFromJsonAsync<ProgressPhotosView>("/api/progress/me/photos" + range, SliceReadJson))!.EarlierDate);
        Assert.IsNull((await coach.GetFromJsonAsync<ProgressPhotosView>($"/api/progress/clients/{clientId}/photos" + range, SliceReadJson))!.EarlierDate);
        Assert.AreEqual(new DateOnly(2020, 6, 15), (await coach.GetFromJsonAsync<BodyMeasurementsView>($"/api/progress/clients/{clientId}/measurements" + range, SliceReadJson))!.EarlierDate);
        using var otherClient = CreateClient();
        await InviteAndAcceptAsync(coach, otherClient, "review-history-other@example.test", true);
        SetTenant(otherClient, workspaceId);
        Assert.IsNull((await otherClient.GetFromJsonAsync<BodyMeasurementsView>("/api/progress/me/measurements" + range, SliceReadJson))!.EarlierDate);
        await AssertStatusAsync(await otherClient.GetAsync($"/api/progress/clients/{clientId}/measurements" + range), HttpStatusCode.Forbidden);
        using var foreign = CreateClient();
        await RegisterCoachAsync(foreign, "review-history-foreign@example.test", "Other Coach", "Other History");
        await AssertStatusAsync(await foreign.GetAsync($"/api/progress/clients/{clientId}/measurements" + range), HttpStatusCode.NotFound);
        await AssertStatusAsync(await foreign.GetAsync($"/api/progress/clients/{clientId}/photos" + range), HttpStatusCode.NotFound);
        using var anonymous = CreateClient();
        SetTenant(anonymous, workspaceId);
        await AssertStatusAsync(await anonymous.GetAsync("/api/progress/me/photos" + range), HttpStatusCode.Unauthorized);
        await AssertStatusAsync(await client.GetAsync("/api/progress/me/measurements?from=2020-01-01&to=2026-08-01"), HttpStatusCode.BadRequest);
    }
}
