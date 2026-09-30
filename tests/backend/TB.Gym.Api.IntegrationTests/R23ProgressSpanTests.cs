using System.Net;
using System.Net.Http.Json;
using TB.Gym.Modules.Progress;

namespace TB.Gym.Api.IntegrationTests;

public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task ProgressSpanIsTenantScopedAndIncludesOlderWeightWithoutEntitlement()
    {
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "r23-span-coach@example.test", "Coach", "Progress");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(coach, client, "r23-span-client@example.test", true);
        SetTenant(client, tenant);

        var empty = await ReadSliceAsync<BodyweightHistorySpanView>(client, "/api/progress/me/span");
        Assert.IsNull(empty.FirstDate);
        Assert.IsNull(empty.LastDate);

        var older = TenantToday().AddDays(-400);
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(await client.PostAsJsonAsync("/api/progress/me/bodyweight",
            new { value = 80m, unit = "Kilogram", measurementDate = older }), HttpStatusCode.OK);
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(await client.PostAsJsonAsync("/api/progress/me/bodyweight",
            new { value = 79m, unit = "Kilogram", measurementDate = TenantToday() }), HttpStatusCode.OK);
        var span = await ReadSliceAsync<BodyweightHistorySpanView>(client, "/api/progress/me/span");
        Assert.AreEqual(older, span.FirstDate);
        Assert.AreEqual(TenantToday(), span.LastDate);
        var coachSpan = await ReadSliceAsync<BodyweightHistorySpanView>(coach,
            $"/api/progress/clients/{clientId}/span");
        Assert.AreEqual(span, coachSpan);

        using var anonymous = CreateClient();
        await AssertStatusAsync(await anonymous.GetAsync("/api/progress/me/span"),
            HttpStatusCode.Unauthorized);
        await AssertStatusAsync(await coach.GetAsync("/api/progress/me/span"),
            HttpStatusCode.Forbidden);
        await AssertStatusAsync(await coach.GetAsync(
            $"/api/progress/clients/{Guid.NewGuid()}/span"), HttpStatusCode.NotFound);
        using var foreignCoach = CreateClient();
        var foreignTenant = await RegisterCoachAsync(foreignCoach,
            "r23-span-foreign@example.test", "Foreign", "Coach");
        SetTenant(client, foreignTenant);
        await AssertStatusAsync(await client.GetAsync("/api/progress/me/span"),
            HttpStatusCode.Forbidden);
    }
}
