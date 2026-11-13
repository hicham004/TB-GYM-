using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using TB.Gym.Modules.Subscriptions;
using ClientEnrollmentView = TB.Gym.Modules.Subscriptions.ClientEnrollmentView;
using CoachingProductView = TB.Gym.Modules.Subscriptions.CoachingProductView;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Critique B10a, the client's own page on their plan (SUB-017): what they read of it, which plans it shows, and
/// that the read is theirs alone. The money stays out of it, and so do the reasons the coach typed.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string OwnPlansUrl = "/api/client-plan/me";

    [TestMethod]
    public async Task B10aAClientReadsTheirPlanAndNothingOfItsMoneyOrTheCoachsReasons()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "b10a-read-coach@example.test", "Karim Haddad", "B10a Read");
        using var maya = CreateClient();
        var mayaId = await InviteAndAcceptAsync(coach, maya, "b10a-read-maya@example.test", true);

        // With no plan yet there is nothing to read, which is no refusal.
        var none = await ReadSliceAsync<OwnPlansView>(maya, OwnPlansUrl);
        Assert.AreEqual(today, none.Today);
        Assert.IsEmpty(none.Plans);

        var product = await B10aProductAsync(
            coach,
            "Online Coaching",
            "Your own program and a weekly check-in.\nAsk me anything.",
            B10aOffer("Student rate", 4, 250.50m, "Nutrition", "Training", "CheckIns"));
        var sold = await A7EnrollAsync(coach, mayaId, product.Offers[0].Id, today);

        var waiting = (await ReadSliceAsync<OwnPlansView>(maya, OwnPlansUrl)).Plans.Single();
        Assert.AreEqual(sold.Id, waiting.Id);
        Assert.AreEqual("Online Coaching", waiting.Name);
        Assert.AreEqual("Student rate", waiting.OptionLabel);
        Assert.AreEqual("Your own program and a weekly check-in.\nAsk me anything.", waiting.Description);
        Assert.AreEqual(today, waiting.StartDate);
        Assert.AreEqual(today.AddDays(27), waiting.LastDay, "The plan's last covered day, not its exclusive end.");
        Assert.IsNull(waiting.CancelledOn);
        Assert.AreEqual(EffectiveEnrollmentStatus.PendingPayment, waiting.Status);
        Assert.AreEqual("Training, Nutrition, CheckIns", string.Join(", ", waiting.Features), "What's included, in the features' own order.");

        await A7PayAsync(coach, sold.Id, 250.50m, today, Guid.NewGuid());
        Assert.AreEqual(EffectiveEnrollmentStatus.Active, (await ReadSliceAsync<OwnPlansView>(maya, OwnPlansUrl)).Plans.Single().Status);

        // These fields and no others: a new one is a decision, since a client reads every one of them.
        var body = await maya.GetStringAsync(OwnPlansUrl);
        using (var document = JsonDocument.Parse(body))
        {
            Assert.AreEqual("coachName,free,plans,renewal,tier,today", B10aFieldNames(document.RootElement));
            Assert.AreEqual(
                "cancelledOn,description,features,id,lastDay,name,optionLabel,sessions,startDate,status",
                B10aFieldNames(document.RootElement.GetProperty("plans")[0]));
            // The tier and Free are the house's alone (SUB-019): a coach's client reads neither.
            Assert.AreEqual(
                (JsonValueKind.Null, JsonValueKind.Null),
                (document.RootElement.GetProperty("free").ValueKind, document.RootElement.GetProperty("tier").ValueKind));
        }

        // The price as JSON writes it (250.5 or 250.50): "250" alone also turns up inside a random id now and then.
        B10aAssertNotIn(body, "250.5", "USD", "Cash");

        // A plan keeps the name it was sold under; the description is the plan's as it stands today.
        await A7UpdateProductAsync(coach, product, "Coaching 2027", true, "A new way of working.");
        var renamed = (await ReadSliceAsync<OwnPlansView>(maya, OwnPlansUrl)).Plans.Single();
        Assert.AreEqual(("Online Coaching", "A new way of working."), (renamed.Name, renamed.Description));

        // A pause leaves the plan's dates alone, and the reason typed for it is the coach's.
        var plan = await B10aChangeAsync(coach, sold.Id, "pause", new { reason = "Behind on rent", version = await B10aVersionAsync(coach, mayaId, sold.Id) });
        var paused = (await ReadSliceAsync<OwnPlansView>(maya, OwnPlansUrl)).Plans.Single();
        Assert.AreEqual((EffectiveEnrollmentStatus.Paused, today.AddDays(27)), (paused.Status, paused.LastDay));
        B10aAssertNotIn(await maya.GetStringAsync(OwnPlansUrl), "Behind on rent");

        plan = await B10aChangeAsync(coach, sold.Id, "resume", new { plan.Version });
        Assert.AreEqual(EffectiveEnrollmentStatus.Active, (await ReadSliceAsync<OwnPlansView>(maya, OwnPlansUrl)).Plans.Single().Status);

        // Cancelled, it says the day it was cancelled; with nothing else to show, it stays on the page.
        RequiredTestClock.Advance(TimeSpan.FromDays(2));
        await B10aChangeAsync(coach, sold.Id, "cancel", new { reason = "Stopped paying", plan.Version });
        var cancelled = (await ReadSliceAsync<OwnPlansView>(maya, OwnPlansUrl)).Plans.Single();
        Assert.AreEqual((EffectiveEnrollmentStatus.Cancelled, today.AddDays(2)), (cancelled.Status, cancelled.CancelledOn));
        B10aAssertNotIn(await maya.GetStringAsync(OwnPlansUrl), "Stopped paying");
    }

    [TestMethod]
    public async Task B10aThePageShowsWhatRunsAndWhatIsComingThenThePlanThatEndedLast()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "b10a-order-coach@example.test", "Karim Haddad", "B10a Order");
        using var maya = CreateClient();
        var mayaId = await InviteAndAcceptAsync(coach, maya, "b10a-order-maya@example.test", true);

        // Booked out of order. The nutrition add-on overlaps training, and the next block waits for payment.
        var next = await B10aProductAsync(coach, "Next block", null, B10aOffer("2 weeks", 2, 100m, "Training"));
        var nextPlan = await A7EnrollAsync(coach, mayaId, next.Offers[0].Id, today.AddDays(14));
        var addOn = await B10aProductAsync(coach, "Nutrition add-on", null, B10aOffer("1 week", 1, 0m, "Nutrition"));
        await A7EnrollAsync(coach, mayaId, addOn.Offers[0].Id, today.AddDays(3));
        var block = await B10aProductAsync(coach, "This block", "The block you are on.", B10aOffer("2 weeks", 2, 0m, "Training"));
        await A7EnrollAsync(coach, mayaId, block.Offers[0].Id, today);

        var booked = (await ReadSliceAsync<OwnPlansView>(maya, OwnPlansUrl)).Plans;
        Assert.AreEqual("This block | Nutrition add-on | Next block", string.Join(" | ", booked.Select(plan => plan.Name)));
        Assert.AreEqual("Active | Upcoming | PendingPayment", string.Join(" | ", booked.Select(plan => plan.Status)));
        Assert.AreEqual("The block you are on. |  | ", string.Join(" | ", booked.Select(plan => plan.Description)));

        // Two have ended, and only what still runs is left.
        RequiredTestClock.Advance(TimeSpan.FromDays(15));
        var later = await ReadSliceAsync<OwnPlansView>(maya, OwnPlansUrl);
        Assert.AreEqual(today.AddDays(15), later.Today);
        Assert.AreEqual(nextPlan.Id, later.Plans.Single().Id);

        // Past its dates a plan never paid for has ended too, and it was the last to.
        RequiredTestClock.Advance(TimeSpan.FromDays(20));
        var ended = (await ReadSliceAsync<OwnPlansView>(maya, OwnPlansUrl)).Plans.Single();
        Assert.AreEqual((nextPlan.Id, EffectiveEnrollmentStatus.Expired), (ended.Id, ended.Status));
    }

    [TestMethod]
    public async Task B10aABlockedClientStillReadsTheirPlansAndTheBlockSpeaksOfWhatRuns()
    {
        var today = R61aStartAtMidday();
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "b10a-block-coach@example.test", "Karim Haddad", "B10a Block");
        using var maya = CreateClient();
        var mayaId = await InviteAndAcceptAsync(coach, maya, "b10a-block-maya@example.test", true);
        var week = await B10aProductAsync(coach, "One week", null, B10aOffer("1 week", 1, 0m, "Training"));
        await A7EnrollAsync(coach, mayaId, week.Offers[0].Id, today);

        await B4aSetBlockedAsync(coach, mayaId, true);
        Assert.AreEqual(EffectiveEnrollmentStatus.Blocked, (await ReadSliceAsync<OwnPlansView>(maya, OwnPlansUrl)).Plans.Single().Status);

        RequiredTestClock.Advance(TimeSpan.FromDays(8));
        Assert.AreEqual(
            EffectiveEnrollmentStatus.Expired,
            (await ReadSliceAsync<OwnPlansView>(maya, OwnPlansUrl)).Plans.Single().Status,
            "A plan that is over still says so while the client is blocked.");

        await B4aSetBlockedAsync(coach, mayaId, false);
        Assert.AreEqual(EffectiveEnrollmentStatus.Expired, (await ReadSliceAsync<OwnPlansView>(maya, OwnPlansUrl)).Plans.Single().Status);
    }

    [TestMethod]
    public async Task B10aTheReadIsTheClientsOwnInTheWorkspaceTheyAskIn()
    {
        var today = R61aStartAtMidday();
        using var coachA = CreateClient();
        var workspaceA = await RegisterCoachAsync(coachA, "b10a-own-a@example.test", "Coach A", "B10a Own A");
        using var coachB = CreateClient();
        var workspaceB = await RegisterCoachAsync(coachB, "b10a-own-b@example.test", "Coach B", "B10a Own B");

        // One person, a client of both coaches, and another client of the first.
        using var shared = CreateClient();
        var clientA = await InviteAndAcceptAsync(coachA, shared, "b10a-own-shared@example.test", true);
        var clientB = await InviteAndAcceptAsync(coachB, shared, "b10a-own-shared@example.test", false);
        using var other = CreateClient();
        var otherId = await InviteAndAcceptAsync(coachA, other, "b10a-own-other@example.test", true);
        var planA = await B10aProductAsync(coachA, "Plan in A", null, B10aOffer("4 weeks", 4, 0m, "Training"));
        await A7EnrollAsync(coachA, clientA, planA.Offers[0].Id, today);
        var planB = await B10aProductAsync(coachB, "Plan in B", null, B10aOffer("4 weeks", 4, 0m, "Nutrition"));
        await A7EnrollAsync(coachB, clientB, planB.Offers[0].Id, today);
        var planOther = await B10aProductAsync(coachA, "Their plan", null, B10aOffer("4 weeks", 4, 0m, "Training"));
        await A7EnrollAsync(coachA, otherId, planOther.Offers[0].Id, today);

        SetTenant(shared, workspaceA);
        Assert.AreEqual("Plan in A", (await ReadSliceAsync<OwnPlansView>(shared, OwnPlansUrl)).Plans.Single().Name);
        SetTenant(shared, workspaceB);
        Assert.AreEqual("Plan in B", (await ReadSliceAsync<OwnPlansView>(shared, OwnPlansUrl)).Plans.Single().Name);
        Assert.AreEqual("Their plan", (await ReadSliceAsync<OwnPlansView>(other, OwnPlansUrl)).Plans.Single().Name);

        // Nobody signed in, a workspace the person is not in, and a coach on the client's route are all refused.
        using var anonymous = CreateClient();
        SetTenant(anonymous, workspaceA);
        await AssertStatusAsync(await anonymous.GetAsync(OwnPlansUrl), HttpStatusCode.Unauthorized);
        using var foreignCoach = CreateClient();
        var foreign = await RegisterCoachAsync(foreignCoach, "b10a-own-foreign@example.test", "Other", "B10a Foreign");
        SetTenant(shared, foreign);
        await AssertStatusAsync(await shared.GetAsync(OwnPlansUrl), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await coachA.GetAsync(OwnPlansUrl), HttpStatusCode.Forbidden);

        // Once released from A the person reads nothing there, and B's plan is untouched.
        SetTenant(shared, workspaceA);
        await ReleaseAsync(coachA, clientA, "Moved away");
        await AssertStatusAsync(await shared.GetAsync(OwnPlansUrl), HttpStatusCode.Forbidden);
        SetTenant(shared, workspaceB);
        Assert.AreEqual("Plan in B", (await ReadSliceAsync<OwnPlansView>(shared, OwnPlansUrl)).Plans.Single().Name);
    }

    [TestMethod]
    public async Task B10aAReturningClientReadsTheirNewProfilesPlansAloneAndNothingOfTheOldOne()
    {
        var today = R61aStartAtMidday();
        using var owner = CreateClient();
        await RegisterCoachAsync(owner, "b10a-back-owner@example.test", "Karim Haddad", "B10a Back");
        using var maya = CreateClient();
        var oldId = await InviteAndAcceptAsync(owner, maya, "b10a-back-maya@example.test", true);
        var first = await B10aProductAsync(owner, "First time round", null, B10aOffer("4 weeks", 4, 0m, "Training"));
        await A7EnrollAsync(owner, oldId, first.Offers[0].Id, today);
        await ReleaseAsync(owner, oldId, "Took a break");

        await RefreshCsrfAsync(owner);
        var invited = await owner.PostAsJsonAsync("/api/invitations",
            new { email = "b10a-back-maya@example.test", firstName = "Maya", lastName = "Rahman" });
        await AssertStatusAsync(invited, HttpStatusCode.Created);
        await RefreshCsrfAsync(maya);
        var accepted = await maya.PostAsJsonAsync("/api/invitations/accept", new
        {
            token = QueryValue((await RequiredJsonAsync<Invitation>(invited)).DevelopmentActionUrl!, "token"),
            displayName = (string?)null,
            password = (string?)null,
        });
        await AssertStatusAsync(accepted, HttpStatusCode.OK);
        var newId = (await RequiredJsonAsync<InvitationAcceptance>(accepted)).ClientProfileId;
        Assert.AreNotEqual(oldId, newId);

        // Their old plan stays with the old profile, even as the last plan they had.
        Assert.IsEmpty((await ReadSliceAsync<OwnPlansView>(maya, OwnPlansUrl)).Plans);

        var second = await B10aProductAsync(owner, "Back again", null, B10aOffer("4 weeks", 4, 0m, "Training"));
        await A7EnrollAsync(owner, newId, second.Offers[0].Id, today);
        Assert.AreEqual("Back again", (await ReadSliceAsync<OwnPlansView>(maya, OwnPlansUrl)).Plans.Single().Name);
    }

    /// <summary>A price option as the plan editor sends one, with its own name.</summary>
    private static object B10aOffer(string label, int weeks, decimal price, params string[] features) => new
    {
        label,
        durationCount = weeks,
        durationUnit = "Week",
        priceAmount = price,
        priceCurrency = "USD",
        features = features.Select(feature => new { feature, allowsConcurrentCoverage = false }).ToArray(),
    };

    /// <summary>A plan for sale with this description and this one price option.</summary>
    private static async Task<CoachingProductView> B10aProductAsync(HttpClient coach, string name, string? description, object offer)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync(A7ProductsUrl, new { name, description, initialOffer = offer });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<CoachingProductView>(response);
    }

    private static async Task<ClientEnrollmentView> B10aChangeAsync(HttpClient coach, Guid enrollmentId, string change, object request)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync($"/api/commercial/enrollments/{enrollmentId}/{change}", request);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<ClientEnrollmentView>(response);
    }

    /// <summary>The plan's version now, which a payment moved on from the one it was sold at.</summary>
    private static async Task<uint> B10aVersionAsync(HttpClient coach, Guid clientId, Guid enrollmentId) =>
        (await ReadSliceAsync<ClientCommercialOverview>(coach, $"/api/commercial/clients/{clientId}"))
            .Enrollments.Single(item => item.Id == enrollmentId).Version;

    private static string B10aFieldNames(JsonElement element) =>
        string.Join(',', element.EnumerateObject().Select(property => property.Name).Order(StringComparer.Ordinal));

    private static void B10aAssertNotIn(string body, params string[] words)
    {
        foreach (var word in words)
        {
            Assert.IsFalse(body.Contains(word, StringComparison.OrdinalIgnoreCase), $"The client's read says {word}: {body}");
        }
    }
}
