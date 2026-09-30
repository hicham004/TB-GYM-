using System.Net;
using System.Net.Http.Json;
using TB.Gym.Modules.Clients;
using TB.Gym.Modules.Training;

namespace TB.Gym.Api.IntegrationTests;

public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task R21WeekAndCoachReadsStayWithTheCurrentClientAndWorkspace()
    {
        var today = TenantToday();
        using var coachA = CreateClient();
        var tenantA = await RegisterCoachAsync(coachA, "r21-coach-a@example.test", "Coach", "Alpha");
        using var client = CreateClient();
        var clientA = await InviteAndAcceptAsync(coachA, client, "r21-client@example.test", true);
        SetTenant(client, tenantA);
        var resources = await CreateTrainingResourcesAsync(coachA, clientA, 8, 1, today);
        var block = await AssignAsync(coachA, clientA, resources, today);

        var week = await ReadSliceAsync<ClientTrainingWeekView>(client, "/api/training/me/week");
        Assert.IsTrue(week.IsAllowed);
        Assert.HasCount(7, week.Days);
        Assert.AreEqual(today, week.LocalDate);
        Assert.AreEqual(1, week.Days.Single(day => day.Date == today).Scheduled);
        Assert.AreEqual(0, week.Days.Single(day => day.Date == today).Completed);
        var coach = await ReadSliceAsync<OwnCoachView>(client, "/api/client-profile/me/coach");
        Assert.AreEqual("Coach", coach.Name);

        var blockView = await ReadSliceAsync<TrainingMesocycleView>(coachA,
            $"/api/training/mesocycles/{block.Id}");
        await RefreshCsrfAsync(coachA);
        await AssertStatusAsync(await coachA.PutAsJsonAsync(
            $"/api/training/mesocycles/{block.Id}/weeks/{blockView.Weeks[0].Id}/publish",
            new { isPublished = false, blockView.Version }), HttpStatusCode.OK);
        week = await ReadSliceAsync<ClientTrainingWeekView>(client, "/api/training/me/week");
        Assert.AreEqual(0, week.Days.Sum(day => day.Scheduled), "An unshared week is private.");

        using var coachB = CreateClient();
        var tenantB = await RegisterCoachAsync(coachB, "r21-coach-b@example.test", "Beta Coach", "Beta");
        await InviteAndAcceptAsync(coachB, client, "r21-client@example.test", false);
        SetTenant(client, tenantB);
        Assert.AreEqual("Beta Coach",
            (await ReadSliceAsync<OwnCoachView>(client, "/api/client-profile/me/coach")).Name);
        Assert.IsFalse((await ReadSliceAsync<ClientTrainingWeekView>(client, "/api/training/me/week")).IsAllowed);

        using var stranger = CreateClient();
        await AssertStatusAsync(await stranger.GetAsync("/api/training/me/week"), HttpStatusCode.Unauthorized);
        await AssertStatusAsync(await stranger.GetAsync("/api/client-profile/me/coach"), HttpStatusCode.Unauthorized);
        await AssertStatusAsync(await coachA.GetAsync("/api/training/me/week"), HttpStatusCode.Forbidden);
        SetTenant(client, Guid.NewGuid());
        await AssertStatusAsync(await client.GetAsync("/api/training/me/week"), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await client.GetAsync("/api/client-profile/me/coach"), HttpStatusCode.Forbidden);
    }

    [TestMethod]
    public async Task R21ThemeModeIsValidatedAndRememberedOnTheAccount()
    {
        using var account = CreateClient();
        await RegisterCoachAsync(account, "r21-theme@example.test", "Theme", "Owner");
        Assert.AreEqual("system", (await ReadSliceAsync<ThemeUser>(account, "/api/auth/me")).PreferredThemeMode);
        await RefreshCsrfAsync(account);
        await AssertStatusAsync(await account.PutAsJsonAsync("/api/auth/me/theme", new { mode = "neon" }),
            HttpStatusCode.BadRequest);
        Assert.AreEqual("system", (await ReadSliceAsync<ThemeUser>(account, "/api/auth/me")).PreferredThemeMode);
        var saved = await account.PutAsJsonAsync("/api/auth/me/theme", new { mode = "dark" });
        await AssertStatusAsync(saved, HttpStatusCode.OK);
        Assert.AreEqual("dark", (await RequiredJsonAsync<ThemeUser>(saved)).PreferredThemeMode);
        Assert.AreEqual("dark", (await ReadSliceAsync<ThemeUser>(account, "/api/auth/me")).PreferredThemeMode);

        using var stranger = CreateClient();
        await AssertStatusAsync(await stranger.PutAsJsonAsync("/api/auth/me/theme", new { mode = "light" }),
            HttpStatusCode.Unauthorized);
    }

    private sealed record ThemeUser(string PreferredThemeMode);
}
