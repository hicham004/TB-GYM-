using System.Net;
using System.Net.Http.Json;
using TB.Gym.Modules.Notifications;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Critique B10c's notices (SES-009): a session pack hears the plan notices in its own words, three days before its end
/// as a plan does, and a pack with no session left is told nothing is ending. A coaching plan beside it is said as ever.
/// </summary>
public sealed partial class Phase6B1NotificationDispatchTests
{
    [TestMethod]
    public async Task B10cAPackHearsThePlanNoticesInItsOwnWords()
    {
        var workspace = await CreateWorkspaceAsync("b10c-words");
        var offerId = await B10cPackOfferAsync(workspace.Coach, 5, 30, 90m);
        var pack = await AssignAsync(workspace.Coach, workspace.ClientProfileId, offerId, TenantToday());

        await SweepAsync();
        Assert.AreEqual("Your new 1-on-1 sessions are waiting for payment", (await B10cNoticesAsync(workspace)).Single());

        await PayInFullAsync(workspace.Coach, pack, 90m);
        await SweepAsync();
        Assert.AreEqual("Your 1-on-1 sessions are ready", (await B10cNoticesAsync(workspace))[0]);

        // Three days before its end, at 09:00 on the workspace's clock, as for a plan.
        var endingSoon = await IntentIdAsync(pack.Id, CommercialNotificationKind.EnrollmentEndingSoon);
        var beirut = TimeZoneInfo.FindSystemTimeZoneById("Asia/Beirut");
        var due = (await OutboxAsync(endingSoon)).ScheduledAtUtc;
        Assert.AreEqual(
            TimeZoneInfo.ConvertTimeToUtc(pack.EndDateExclusive.AddDays(-3).ToDateTime(new TimeOnly(9, 0)), beirut),
            due.UtcDateTime);
        Clock.Set(due);
        await SweepAsync();
        Assert.AreEqual("Your 1-on-1 sessions end soon", (await B10cNoticesAsync(workspace))[0]);
        Assert.IsTrue(NotificationTemplateCatalog.TryResolveForEnrollment(
            CommercialNotificationKind.EnrollmentEndingSoon, "en", true, out var template));
        Assert.AreEqual(template.Key, await ScalarAsync<string>(
            """SELECT "TemplateKey" FROM notifications."Notifications" WHERE "SourceOutboxItemId" = @id""",
            ("id", endingSoon)));

        var expired = await IntentIdAsync(pack.Id, CommercialNotificationKind.EnrollmentExpired);
        Clock.Set((await OutboxAsync(expired)).ScheduledAtUtc);
        await SweepAsync();
        Assert.AreEqual("Your 1-on-1 sessions have ended", (await B10cNoticesAsync(workspace))[0]);
    }

    [TestMethod]
    public async Task B10cAPackWithNoSessionLeftHasNothingToEndSoon()
    {
        var workspace = await CreateWorkspaceAsync("b10c-none");
        var offerId = await B10cPackOfferAsync(workspace.Coach, 1, 30, 0m);
        var used = await AssignAsync(workspace.Coach, workspace.ClientProfileId, offerId, TenantToday());
        await B10cHoldAsync(workspace.Coach, workspace.ClientProfileId, TenantToday());
        await SweepAsync();

        var endingSoon = await IntentIdAsync(used.Id, CommercialNotificationKind.EnrollmentEndingSoon);
        Clock.Set((await OutboxAsync(endingSoon)).ScheduledAtUtc);
        await SweepAsync();

        await AssertSuppressedWithAsync(endingSoon, NotificationSuppressionCodes.StateChanged);
        Assert.AreEqual(0L, await NotificationCountAsync(endingSoon));

        // The same day with a session left says it.
        var other = await AddClientAsync(workspace, "b10c-left");
        Clock.Set(StartInstant);
        var left = await AssignAsync(
            workspace.Coach,
            other,
            await B10cPackOfferAsync(workspace.Coach, 2, 30, 0m),
            TenantToday());
        await B10cHoldAsync(workspace.Coach, other, TenantToday());
        var running = await IntentIdAsync(left.Id, CommercialNotificationKind.EnrollmentEndingSoon);
        Clock.Set((await OutboxAsync(running)).ScheduledAtUtc);
        await SweepAsync();
        Assert.AreEqual("Materialized", await OutboxStatusAsync(running));
        Assert.AreEqual(1L, await NotificationCountAsync(running));
    }

    [TestMethod]
    public async Task B10cACoachingPlanBesideAPackIsStillToldInThePlansWords()
    {
        var workspace = await CreateWorkspaceAsync("b10c-plan");
        var planOffer = await CreateOfferAsync(workspace.Coach, 0m, 4, "4 weeks");
        var plan = await AssignAsync(workspace.Coach, workspace.ClientProfileId, planOffer, TenantToday());
        await AssignAsync(workspace.Coach, workspace.ClientProfileId, await B10cPackOfferAsync(workspace.Coach, 5, 60, 0m), TenantToday());
        await SweepAsync();

        var endingSoon = await IntentIdAsync(plan.Id, CommercialNotificationKind.EnrollmentEndingSoon);
        Clock.Set((await OutboxAsync(endingSoon)).ScheduledAtUtc);
        await SweepAsync();

        Assert.AreEqual("Your plan ends soon", (await B10cNoticesAsync(workspace))[0]);
    }

    /// <summary>The inbox's titles, newest first.</summary>
    private static async Task<string[]> B10cNoticesAsync(Workspace workspace)
    {
        var page = await RequiredJsonAsync<NotificationPageResponse>(await workspace.Client.GetAsync("/api/notifications"));
        return [.. page.Items.Select(item => item.Title)];
    }

    private static async Task<Guid> B10cPackOfferAsync(HttpClient coach, int sessions, int days, decimal price)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync("/api/commercial/products", new
        {
            name = $"Pack {Guid.NewGuid():N}",
            kind = "SessionPack",
            initialOffer = new
            {
                label = $"{sessions} sessions",
                durationCount = days,
                durationUnit = "Day",
                priceAmount = price,
                priceCurrency = "USD",
                features = Array.Empty<object>(),
                sessionCount = sessions,
            },
        });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return (await RequiredJsonAsync<Product>(response)).Offers[0].Id;
    }

    private static async Task B10cHoldAsync(HttpClient coach, Guid clientId, DateOnly day)
    {
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync($"/api/commercial/clients/{clientId}/sessions", new
            {
                outcome = "Held",
                day = day.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture),
                idempotencyKey = Guid.NewGuid(),
            }),
            HttpStatusCode.OK);
    }
}
