using System.Net;
using System.Net.Http.Json;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Notes plan N7, against PostgreSQL: the owner's Billing read names every unrevoked discount that is
/// running or still to come, oldest first, with its name (the admin's note), rate and UTC days; an ended
/// or revoked one is not sent. Only the owner reads it, and another space reads none of it. The figures
/// are the test's own.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    // Midday UTC, so the UTC day the discounts use and the workspace's Beirut day agree.
    private static readonly DateTimeOffset N7Now = new(2026, 11, 10, 12, 0, 0, TimeSpan.Zero);
    private static readonly DateOnly N7Today = new(2026, 11, 10);

    [TestMethod]
    public async Task N7TheOwnerReadsEachRunningOrComingDiscountByNameWithItsDaysButNoEndedOrRevokedOne()
    {
        RequiredTestClock.Set(N7Now);
        using var owner = CreateClient();
        var workspaceId = await RegisterCoachAsync(owner, "n7-owner@example.test", "Nadia Owner", "N7 Gym");
        Assert.IsEmpty((await N7BillingAsync(owner)).Discounts, "No discount, nothing to name.");

        using var admin = await SignInPlatformAdminAsync("n7-admin@example.test");
        await RefreshCsrfAsync(admin);
        // Ended: its last day was yesterday. Then a chain of three from today with a free start, one
        // still to come after a gap, and one revoked.
        await N7GrantAsync(admin, workspaceId, 30m, N7Today.AddDays(-40), N7Today, "Opening month");
        await N7GrantAsync(admin, workspaceId, 100m, N7Today, N7Today.AddDays(45), "Early coach offer");
        await N7GrantAsync(admin, workspaceId, 40m, N7Today.AddDays(45), N7Today.AddDays(121), "Early coach offer, second stretch");
        await N7GrantAsync(admin, workspaceId, 15.5m, N7Today.AddDays(121), N7Today.AddDays(212), "Early coach offer, third stretch");
        await N7GrantAsync(admin, workspaceId, 10m, N7Today.AddDays(240), N7Today.AddDays(270), "Spring return");
        var withdrawn = await N7GrantAsync(admin, workspaceId, 20m, N7Today.AddDays(300), N7Today.AddDays(330), "Withdrawn");
        await AssertStatusAsync(await admin.PostAsync($"/api/platform-admin/discounts/{withdrawn.Id}/revoke", null), HttpStatusCode.OK);

        var billing = await N7BillingAsync(owner);
        CollectionAssert.AreEqual(
            new[]
            {
                new N7Discount("Early coach offer", 100m, N7Today, N7Today.AddDays(44), N7Today.AddDays(45), false),
                new N7Discount("Early coach offer, second stretch", 40m, N7Today.AddDays(45), N7Today.AddDays(120), N7Today.AddDays(121), true),
                new N7Discount("Early coach offer, third stretch", 15.5m, N7Today.AddDays(121), N7Today.AddDays(211), N7Today.AddDays(212), true),
                new N7Discount("Spring return", 10m, N7Today.AddDays(240), N7Today.AddDays(269), N7Today.AddDays(270), true),
            },
            billing.Discounts,
            "Oldest first; the ended and the revoked discounts are not sent.");
        Assert.AreEqual("Trial", billing.Status, "The trial reads them too.");

        // On the day after the free start's last day, it has ended and the chain runs from the second stretch.
        RequiredTestClock.Set(N7Now.AddDays(45));
        var later = await N7BillingAsync(owner);
        Assert.HasCount(3, later.Discounts);
        Assert.AreEqual(new N7Discount("Early coach offer, second stretch", 40m, N7Today.AddDays(45), N7Today.AddDays(120), N7Today.AddDays(121), false), later.Discounts[0]);

        // What the admin's page keeps is unchanged: all six, the revoked one with its revocation.
        var kept = (await BillingDetailAsync(admin, workspaceId)).Discounts;
        Assert.HasCount(6, kept);
        Assert.HasCount(1, kept.Where(discount => discount.RevokedAtUtc is not null));
    }

    [TestMethod]
    public async Task N7OnlyTheOwnerReadsTheDiscountsAndAnotherSpaceReadsNoneOfThem()
    {
        RequiredTestClock.Set(N7Now);
        using var owner = CreateClient();
        var workspaceId = await RegisterCoachAsync(owner, "n7-only-owner@example.test", "Nadia Owner", "N7 Owner Gym");
        using var coach = CreateClient();
        await JoinAsCoachAsync(owner, coach, "n7-only-coach@example.test", "Nour Coach");
        using var admin = await SignInPlatformAdminAsync("n7-only-admin@example.test");
        await RefreshCsrfAsync(admin);
        await N7GrantAsync(admin, workspaceId, 35m, N7Today.AddDays(-5), N7Today.AddDays(60), "Early coach offer");

        Assert.AreEqual("Early coach offer", (await N7BillingAsync(owner)).Discounts.Single().Name);
        await AssertStatusAsync(await coach.GetAsync("/api/billing"), HttpStatusCode.Forbidden);

        // Another space's owner reads none of them, and cannot ask for them by header.
        using var stranger = CreateClient();
        await RegisterCoachAsync(stranger, "n7-stranger@example.test", "Sami Stranger", "N7 Other Gym");
        Assert.IsEmpty((await N7BillingAsync(stranger)).Discounts);
        SetTenant(stranger, workspaceId);
        await AssertStatusAsync(await stranger.GetAsync("/api/billing"), HttpStatusCode.Forbidden);

        // The platform admin is not the space's owner either.
        SetTenant(admin, workspaceId);
        await AssertStatusAsync(await admin.GetAsync("/api/billing"), HttpStatusCode.Forbidden);
    }

    private static async Task<N7Billing> N7BillingAsync(HttpClient owner)
    {
        var response = await owner.GetAsync("/api/billing");
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<N7Billing>(response);
    }

    private static async Task<N7Granted> N7GrantAsync(
        HttpClient admin,
        Guid workspaceId,
        decimal percent,
        DateOnly startsOn,
        DateOnly endsOnExclusive,
        string note)
    {
        var response = await admin.PostAsJsonAsync(
            $"/api/platform-admin/workspaces/{workspaceId}/discounts",
            new { percent, startsOn, endsOnExclusive, note });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<N7Granted>(response);
    }

    private sealed record N7Discount(string Name, decimal Percent, DateOnly StartsOn, DateOnly LastDay, DateOnly EndsOnExclusive, bool StartsLater);
    private sealed record N7Billing(string Status, N7Discount[] Discounts);
    private sealed record N7Granted(Guid Id);
}
