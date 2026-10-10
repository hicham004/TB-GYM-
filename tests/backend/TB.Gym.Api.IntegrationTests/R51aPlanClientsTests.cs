using System.Net;
using System.Net.Http.Json;
using CoachingProductView = TB.Gym.Modules.Subscriptions.CoachingProductView;
using PlanClientCount = TB.Gym.Modules.Subscriptions.PlanClientCount;
using ProductCatalog = TB.Gym.Modules.Subscriptions.ProductCatalog;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// R5.1a, Plans you sell (SUB-015): each product and price option counts the caller's clients on it today
/// and booked to start later, each client once, as their client list shows them (ADR 0026): a Coach their
/// own, the Owner every client still coached here. Cancelled and released clients drop out.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string R51aProductsUrl = "/api/commercial/products";

    private static async Task<CoverageEnrollment> R51aEnrollAsync(HttpClient coach, Guid clientId, Guid offerId, DateOnly startDate)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync(
            $"/api/commercial/clients/{clientId}/enrollments",
            new { offerId, startDate, idempotencyKey = Guid.NewGuid() });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<CoverageEnrollment>(response);
    }

    private static async Task<CoachingProductView> R51aProductAsync(HttpClient caller, Guid productId) =>
        (await ReadSliceAsync<ProductCatalog>(caller, R51aProductsUrl)).Products.Single(item => item.Id == productId);

    [TestMethod]
    public async Task R51aEachPlanCountsTheCallersClientsOnItNowAndStartingLaterEachOnce()
    {
        using var owner = CreateClient();
        var workspaceId = await RegisterCoachAsync(owner, "r51a-owner@example.test", "R51a Owner", "R51a Gym");
        using var pat = CreateClient();
        await JoinAsCoachAsync(owner, pat, "r51a-pat@example.test", "Pat Coach");
        using var sam = CreateClient();
        await JoinAsCoachAsync(owner, sam, "r51a-sam@example.test", "Sam Coach");
        var clients = new Dictionary<string, Guid>();
        foreach (var (name, coach) in new[] { ("ana", pat), ("ben", pat), ("dan", pat), ("eli", pat), ("cal", sam) })
        {
            using var client = CreateClient();
            clients[name] = await InviteAndAcceptAsync(coach, client, $"r51a-{name}@example.test", newAccount: true);
        }

        // One free product with an 8-week and a 4-week option, so every plan is active at once.
        await RefreshCsrfAsync(owner);
        var created = await owner.PostAsJsonAsync(R51aProductsUrl, new
        {
            name = "Online Coaching",
            description = (string?)null,
            initialOffer = new
            {
                label = "8 weeks",
                durationCount = 8,
                durationUnit = "Week",
                priceAmount = 0m,
                priceCurrency = "USD",
                features = new[] { new { feature = "Training", allowsConcurrentCoverage = false } },
            },
        });
        await AssertStatusAsync(created, HttpStatusCode.OK);
        var product = await ReadSlicePayloadAsync<CoachingProductView>(created);
        Assert.AreEqual(new PlanClientCount(0, 0), product.Clients);
        await RefreshCsrfAsync(owner);
        var added = await owner.PostAsJsonAsync($"{R51aProductsUrl}/{product.Id}/offers", new
        {
            label = "4 weeks",
            durationCount = 4,
            durationUnit = "Week",
            priceAmount = 0m,
            priceCurrency = "USD",
            features = new[] { new { feature = "Training", allowsConcurrentCoverage = false } },
        });
        await AssertStatusAsync(added, HttpStatusCode.OK);
        var offers = (await ReadSlicePayloadAsync<CoachingProductView>(added)).Offers;
        var eight = offers.Single(item => item.DurationCount == 8).Id;
        var four = offers.Single(item => item.DurationCount == 4).Id;

        // Ana is on it and already booked her next eight weeks; Ben starts in two weeks; Dan cancelled;
        // Eli is released by the owner; Cal is Sam's.
        var today = P4bWorkspaceToday();
        await R51aEnrollAsync(pat, clients["ana"], eight, today);
        await R51aEnrollAsync(pat, clients["ana"], eight, today.AddDays(56));
        await R51aEnrollAsync(pat, clients["ben"], eight, today.AddDays(14));
        var dan = await R51aEnrollAsync(pat, clients["dan"], four, today);
        await R51aEnrollAsync(pat, clients["eli"], four, today);
        await R51aEnrollAsync(sam, clients["cal"], four, today);
        await RefreshCsrfAsync(pat);
        await AssertStatusAsync(
            await pat.PostAsJsonAsync($"/api/commercial/enrollments/{dan.Id}/cancel", new { reason = "Changed plans", version = dan.Version }),
            HttpStatusCode.OK);
        var eli = await RequiredJsonAsync<TeamClientDetails>(await owner.GetAsync($"/api/clients/{clients["eli"]}"));
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PostAsJsonAsync($"/api/clients/{clients["eli"]}/release", new { reason = "Moved away", version = eli.Version }),
            HttpStatusCode.OK);

        // The owner counts everyone still coached here: Ana and Cal now, Ben later; Ana once.
        var all = await R51aProductAsync(owner, product.Id);
        Assert.AreEqual(new PlanClientCount(2, 1), all.Clients);
        Assert.AreEqual(new PlanClientCount(1, 1), all.Offers.Single(item => item.Id == eight).Clients);
        Assert.AreEqual(new PlanClientCount(1, 0), all.Offers.Single(item => item.Id == four).Clients);

        // Each coach counts their own clients only.
        var patsView = await R51aProductAsync(pat, product.Id);
        Assert.AreEqual(new PlanClientCount(1, 1), patsView.Clients);
        Assert.AreEqual(new PlanClientCount(0, 0), patsView.Offers.Single(item => item.Id == four).Clients);
        Assert.AreEqual(new PlanClientCount(1, 0), (await R51aProductAsync(sam, product.Id)).Clients);

        // Another workspace sees none of it, and cannot ask as this one.
        using var stranger = CreateClient();
        await RegisterCoachAsync(stranger, "r51a-stranger@example.test", "R51a Stranger", "R51a Stranger Gym");
        Assert.IsEmpty((await ReadSliceAsync<ProductCatalog>(stranger, R51aProductsUrl)).Products);
        SetTenant(stranger, workspaceId);
        await AssertStatusAsync(await stranger.GetAsync(R51aProductsUrl), HttpStatusCode.Forbidden);
    }
}
