using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using TB.Gym.Infrastructure.Application;
using TB.Gym.Modules.Clients;
using ClientEnrollmentView = TB.Gym.Modules.Subscriptions.ClientEnrollmentView;
using EnrollmentStatus = TB.Gym.Modules.Subscriptions.EnrollmentStatus;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Critique B4b, the server's half of Coach Today: This month (money received v1, SUB-016; active clients; the
/// owner's team) and the two plan lists (CLI-020). Every test sets the frozen clock to fixed days at midday in the
/// workspace's zone, so nothing depends on the real day of the month and a whole day always lands on the next one.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    /// <summary>
    /// Coach Today's SQL commands in its busiest case, sign-in and tenant checks included: every read in use, measured
    /// by <see cref="B4bTodayIsAFixedNumberOfQueriesInItsBusiestCase"/> and pinned exactly.
    /// </summary>
    private const int B4bTodayQueryPin = 28;

    [TestMethod]
    public async Task B4bMoneyReceivedCountsPerCurrencyForTheCoachTheClientHadWhenItArrived()
    {
        // Another workspace exists before anything here: its owner reads none of this one.
        B4aSetWorkspaceClock(new DateOnly(2026, 10, 5), new TimeOnly(12, 0));
        using var stranger = CreateClient();
        await RegisterCoachAsync(stranger, "b4b-money-stranger@example.test", "Other Owner", "B4b Elsewhere");

        // The owner, three coaches (Zeina has no client), and their clients: Maya and Rami are Lea's, Jad too (no
        // plan); Nour is Omar's; Sara is the owner's.
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b4b-money-owner@example.test", "Hicham Haddad", "B4b Money");
        using var lea = CreateClient();
        var leaId = await JoinAsCoachAsync(owner, lea, "b4b-money-lea@example.test", "Lea Khoury");
        using var omar = CreateClient();
        var omarId = await JoinAsCoachAsync(owner, omar, "b4b-money-omar@example.test", "Omar Nasser");
        using var zeina = CreateClient();
        var zeinaId = await JoinAsCoachAsync(owner, zeina, "b4b-money-zeina@example.test", "Zeina Aoun");
        var ownerId = (await TeamMembersAsync(owner)).Single(member => member.Role == "Owner").UserId;
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(lea, maya, tenant, "b4b-money-maya@example.test", "Maya", "Rahman");
        using var rami = CreateClient();
        var ramiId = await R31InviteAsync(lea, rami, tenant, "b4b-money-rami@example.test", "Rami", "Saliba");
        using var jad = CreateClient();
        var jadId = await R31InviteAsync(lea, jad, tenant, "b4b-money-jad@example.test", "Jad", "Mansour");
        using var nour = CreateClient();
        var nourId = await R31InviteAsync(omar, nour, tenant, "b4b-money-nour@example.test", "Nour", "Fares");
        using var sara = CreateClient();
        var saraId = await R31InviteAsync(owner, sara, tenant, "b4b-money-sara@example.test", "Sara", "Khalil");

        // Four weeks of check-ins and chat for 100 USD; four weeks of meal plans for 1,500,000 LBP.
        var day = new DateOnly(2026, 10, 5);
        var coaching = (await B4aProductAsync(owner, "B4b Coaching", B4bOffer(4, "Week", 100m, "USD", "CheckIns", "Messaging"))).Offers.Single().Id;
        var meals = (await B4aProductAsync(owner, "B4b Meals", B4bOffer(4, "Week", 1_500_000m, "LBP", "Nutrition"))).Offers.Single().Id;
        var mayaPlan = await A7EnrollAsync(owner, mayaId, coaching, day);
        var ramiPlan = await A7EnrollAsync(owner, ramiId, meals, day);
        var nourCoaching = await A7EnrollAsync(owner, nourId, coaching, day);
        var nourMeals = await A7EnrollAsync(owner, nourId, meals, day);
        var saraPlan = await A7EnrollAsync(owner, saraId, coaching, day);

        // Maya paid 40 USD on 3 Oct, before she accepted Lea's invitation today: it counts for Lea, her first coach.
        await B4bPayAsync(owner, mayaPlan, 40m, new DateOnly(2026, 10, 3));
        B4bNextDay();
        await B4bPayAsync(owner, ramiPlan, 1_500_000m, new DateOnly(2026, 10, 6));
        B4bNextDay();
        await B4bPayAsync(owner, nourCoaching, 100m, new DateOnly(2026, 10, 7));
        B4bNextDay();
        // A part payment on Nour's meals counts as it arrives, though the plan waits for the rest (SUB-008).
        await B4bPayAsync(owner, nourMeals, 500_000m, new DateOnly(2026, 10, 8));
        B4bNextDay();
        // Sara's first 30 USD arrived in September and count there, not in October.
        await B4bPayAsync(owner, saraPlan, 30m, new DateOnly(2026, 9, 28));
        await B4bPayAsync(owner, saraPlan, 70m, new DateOnly(2026, 10, 9));

        // On 10 Oct the owner moves Maya to Omar. Two days on, her 25 USD of 9 Oct, recorded after the move, is still
        // Lea's; her 35 USD of today is Omar's, and pays her plan in full.
        B4bNextDay();
        await ReassignAsync(owner, mayaId, omarId, "Omar trains mornings");
        B4bNextDay();
        B4bNextDay();
        await B4bPayAsync(owner, mayaPlan, 25m, new DateOnly(2026, 10, 9));
        var paidUp = await B4bPayAsync(owner, mayaPlan, 35m, new DateOnly(2026, 10, 12));
        Assert.AreEqual(0m, paidUp.BalanceAmount);

        // On 14 Oct the owner releases Rami: his receipt stays money received, for the coach he had then (ADR 0027).
        B4bNextDay();
        B4bNextDay();
        await ReleaseAsync(owner, ramiId, "Moved away");

        // The owner reads every receipt of October, per currency, never one total across currencies.
        var ownerView = await ReadSliceAsync<CoachTodayView>(owner, CoachTodayUrl);
        var month = ownerView.Month;
        Assert.AreEqual((new DateOnly(2026, 10, 14), new DateOnly(2026, 10, 1), new DateOnly(2026, 11, 1)),
            (ownerView.Today, month.From, month.ToExclusive));
        Assert.AreEqual("LBP 2000000.00 2, USD 270.00 5", B4bSay(month.MoneyReceived));
        Assert.AreEqual(("MoneyReceived", 1), (month.MoneyRuleKey, month.MoneyRuleVersion));

        // Three of the four current clients have a plan running today; Jad has none, and Rami is a former client.
        Assert.AreEqual((4, 3), (ownerView.ClientCount, month.ActiveClientCount));
        var team = month.Coaches ?? throw new AssertFailedException("The owner reads their team.");
        Assert.AreEqual(
            $"{ownerId} Hicham Haddad True 1 1, {leaId} Lea Khoury False 0 1, {omarId} Omar Nasser False 2 2, {zeinaId} Zeina Aoun False 0 0",
            string.Join(", ", team.Select(member =>
                $"{member.CoachUserId} {member.Name} {member.IsYou} {member.ActiveClientCount} {member.ClientCount}")));

        // Each coach reads only the receipts that count for them, per currency, with no client named, no team and
        // nothing of anyone else's. Together with the owner's 70 USD, they make the owner's totals.
        var leasView = await ReadSliceAsync<CoachTodayView>(lea, CoachTodayUrl);
        Assert.AreEqual("LBP 1500000.00 1, USD 65.00 2", B4bSay(leasView.Month.MoneyReceived));
        Assert.AreEqual((1, 0, (IReadOnlyList<CoachClientCountView>?)null),
            (leasView.ClientCount, leasView.Month.ActiveClientCount, leasView.Month.Coaches));
        var omarsView = await ReadSliceAsync<CoachTodayView>(omar, CoachTodayUrl);
        Assert.AreEqual("LBP 500000.00 1, USD 135.00 2", B4bSay(omarsView.Month.MoneyReceived));
        Assert.AreEqual((2, 2, (IReadOnlyList<CoachClientCountView>?)null),
            (omarsView.ClientCount, omarsView.Month.ActiveClientCount, omarsView.Month.Coaches));
        var zeinasView = await ReadSliceAsync<CoachTodayView>(zeina, CoachTodayUrl);
        Assert.AreEqual((0, 0, 0), (zeinasView.ClientCount, zeinasView.Month.ActiveClientCount, zeinasView.Month.MoneyReceived.Count));

        await B4bAssertNotInAsync(lea, "Lea's Today",
            ownerId.ToString(), omarId.ToString(), zeinaId.ToString(), "Hicham", "Omar", "Zeina",
            mayaId.ToString(), ramiId.ToString(), nourId.ToString(), saraId.ToString(), "Rahman", "Saliba", "Fares", "Khalil",
            "\"coaches\":[");
        await B4bAssertNotInAsync(omar, "Omar's Today",
            ownerId.ToString(), leaId.ToString(), zeinaId.ToString(), "Hicham", "Lea Khoury", "Zeina",
            ramiId.ToString(), jadId.ToString(), saraId.ToString(), "Saliba", "Mansour", "Khalil", "\"coaches\":[");
        Assert.Contains("\"coaches\":null", await lea.GetStringAsync(CoachTodayUrl));

        // Nobody signed out and no client reads Today; another workspace's owner reads only their own, empty one.
        using var anonymous = CreateClient();
        SetTenant(anonymous, tenant);
        await AssertStatusAsync(await anonymous.GetAsync(CoachTodayUrl), HttpStatusCode.Unauthorized);
        await AssertStatusAsync(await maya.GetAsync(CoachTodayUrl), HttpStatusCode.Forbidden);
        var strangersView = await ReadSliceAsync<CoachTodayView>(stranger, CoachTodayUrl);
        Assert.AreEqual((0, 0), (strangersView.ClientCount, strangersView.Month.MoneyReceived.Count));
        Assert.AreEqual("Other Owner True 0 0", string.Join(", ", strangersView.Month.Coaches!.Select(member =>
            $"{member.Name} {member.IsYou} {member.ActiveClientCount} {member.ClientCount}")));
        SetTenant(stranger, tenant);
        await AssertStatusAsync(await stranger.GetAsync(CoachTodayUrl), HttpStatusCode.Forbidden);
    }

    [TestMethod]
    public async Task B4bTheWorkspacesDayNotUtcsDecidesTheMonthAReceiptCountsIn()
    {
        // Maya's four weeks cost 100 USD. She pays 30 at 23:30 on 30 Sep in Beirut and the rest an hour later, at
        // 00:30 on 1 Oct, which is still 30 Sep in UTC.
        B4aSetWorkspaceClock(new DateOnly(2026, 9, 30), new TimeOnly(12, 0));
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b4b-edge-owner@example.test", "Hicham Haddad", "B4b Edge");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(owner, maya, tenant, "b4b-edge-maya@example.test", "Maya", "Rahman");
        var offer = (await B4aProductAsync(owner, "B4b Edge plan", B4bOffer(4, "Week", 100m, "USD", "Messaging"))).Offers.Single().Id;
        var plan = await A7EnrollAsync(owner, mayaId, offer, new DateOnly(2026, 9, 30));

        B4aSetWorkspaceClock(new DateOnly(2026, 9, 30), new TimeOnly(23, 30));
        await B4bPayAsync(owner, plan, 30m, new DateOnly(2026, 9, 30));
        var september = await ReadSliceAsync<CoachTodayView>(owner, CoachTodayUrl);
        Assert.AreEqual((new DateOnly(2026, 9, 1), new DateOnly(2026, 10, 1), "USD 30.00 1"),
            (september.Month.From, september.Month.ToExclusive, B4bSay(september.Month.MoneyReceived)));
        Assert.AreEqual(0, september.Month.ActiveClientCount, "A part payment opens nothing (SUB-008).");

        B4aSetWorkspaceClock(new DateOnly(2026, 10, 1), new TimeOnly(0, 30));
        Assert.AreEqual(new DateOnly(2026, 9, 30), B4aUtcDay(), "In UTC it is still 30 Sep.");
        var paid = await B4bPayAsync(owner, plan, 70m, new DateOnly(2026, 10, 1));
        CollectionAssert.AreEqual(
            new[] { new DateOnly(2026, 9, 30), new DateOnly(2026, 10, 1) },
            paid.Payments.Select(payment => payment.ReceivedOn).Order().ToArray(),
            "Every reader names the same day for each receipt (SUB-007).");

        // October counts only what arrived on its own days; the plan, paid in full, runs.
        var october = await ReadSliceAsync<CoachTodayView>(owner, CoachTodayUrl);
        Assert.AreEqual((new DateOnly(2026, 10, 1), new DateOnly(2026, 11, 1), "USD 70.00 1", 1),
            (october.Month.From, october.Month.ToExclusive, B4bSay(october.Month.MoneyReceived), october.Month.ActiveClientCount));
    }

    [TestMethod]
    public async Task B4bPlansEndingSoonAndEndedNotRenewedSayWhatToDoNext()
    {
        var start = new DateOnly(2026, 11, 2);
        B4aSetWorkspaceClock(start, new TimeOnly(12, 0));
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b4b-plans-owner@example.test", "Hicham Haddad", "B4b Plans");
        using var lea = CreateClient();
        await JoinAsCoachAsync(owner, lea, "b4b-plans-lea@example.test", "Lea Khoury");

        // Ending soon, thirty days on: six-week plans. Nadine's (the owner's) and Nour's (Lea's) include chat; Ziad's
        // paid plan has a four-week renewal booked after it, not paid yet.
        using var nadine = CreateClient();
        var nadineId = await R31InviteAsync(owner, nadine, tenant, "b4b-plans-nadine@example.test", "Nadine", "Aoun");
        var nadinePlan = await B4bPlanAsync(owner, nadineId, "B4b Nadine", B4bOffer(6, "Week", 0m, "USD", "Messaging"), start);
        var nadineChat = await StartChatAsync(owner, nadineId);
        using var nour = CreateClient();
        var nourId = await R31InviteAsync(lea, nour, tenant, "b4b-plans-nour@example.test", "Nour", "Fares");
        var nourPlan = await B4bPlanAsync(owner, nourId, "B4b Nour", B4bOffer(6, "Week", 0m, "USD", "Messaging"), start);
        var nourChat = await StartChatAsync(lea, nourId);
        using var ziad = CreateClient();
        var ziadId = await R31InviteAsync(owner, ziad, tenant, "b4b-plans-ziad@example.test", "Ziad", "Karam");
        var ziadProduct = await B4aProductAsync(owner, "B4b Ziad", B4bOffer(6, "Week", 120m, "USD", "Nutrition"));
        var ziadNext = await B4aAddOfferAsync(owner, ziadProduct, B4bOffer(4, "Week", 80m, "USD", "Nutrition"));
        var ziadPlan = await B4aPayInFullAsync(owner, await A7EnrollAsync(owner, ziadId, ziadProduct.Offers.Single().Id, start));
        var ziadRenewal = await B4aRenewAsync(owner, ziadPlan, ziadNext);

        // Ran out by then: Maya's and Karim's (Lea's) two weeks; Tarek's paid two weeks, with a four-week renewal
        // still unpaid; Lina's day tomorrow. Not listed: Jad's day today (thirty days before), Rami's cancelled two
        // weeks, and Hadi's week, renewed by a paid week starting later.
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(owner, maya, tenant, "b4b-plans-maya@example.test", "Maya", "Rahman");
        var mayaPlan = await B4bPlanAsync(owner, mayaId, "B4b Maya", B4bOffer(2, "Week", 0m, "USD", "Training"), start);
        using var karim = CreateClient();
        var karimId = await R31InviteAsync(lea, karim, tenant, "b4b-plans-karim@example.test", "Karim", "Bitar");
        var karimPlan = await B4bPlanAsync(owner, karimId, "B4b Karim", B4bOffer(2, "Week", 0m, "USD", "Training"), start);
        using var tarek = CreateClient();
        var tarekId = await R31InviteAsync(owner, tarek, tenant, "b4b-plans-tarek@example.test", "Tarek", "Nasser");
        var tarekProduct = await B4aProductAsync(owner, "B4b Tarek", B4bOffer(2, "Week", 100m, "USD", "CheckIns"));
        var tarekNext = await B4aAddOfferAsync(owner, tarekProduct, B4bOffer(4, "Week", 180m, "USD", "CheckIns"));
        var tarekPlan = await B4aPayInFullAsync(owner, await A7EnrollAsync(owner, tarekId, tarekProduct.Offers.Single().Id, start));
        var tarekRenewal = await B4aRenewAsync(owner, tarekPlan, tarekNext);
        using var lina = CreateClient();
        var linaId = await R31InviteAsync(owner, lina, tenant, "b4b-plans-lina@example.test", "Lina", "Saad");
        var linaPlan = await B4bPlanAsync(owner, linaId, "B4b Lina", B4bOffer(1, "Day", 0m, "USD", "Training"), start.AddDays(1));
        using var jad = CreateClient();
        var jadId = await R31InviteAsync(owner, jad, tenant, "b4b-plans-jad@example.test", "Jad", "Mansour");
        await B4bPlanAsync(owner, jadId, "B4b Jad", B4bOffer(1, "Day", 0m, "USD", "Training"), start);
        using var rami = CreateClient();
        var ramiId = await R31InviteAsync(owner, rami, tenant, "b4b-plans-rami@example.test", "Rami", "Saliba");
        var ramiPlan = await B4bPlanAsync(owner, ramiId, "B4b Rami", B4bOffer(2, "Week", 0m, "USD", "Training"), start);
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(await owner.PostAsJsonAsync($"/api/commercial/enrollments/{ramiPlan.Id}/cancel",
            new { reason = "Booked by mistake", ramiPlan.Version }), HttpStatusCode.OK);
        using var hadi = CreateClient();
        var hadiId = await R31InviteAsync(owner, hadi, tenant, "b4b-plans-hadi@example.test", "Hadi", "Daher");
        await B4bPlanAsync(owner, hadiId, "B4b Hadi", B4bOffer(1, "Week", 0m, "USD", "Training"), start);
        await B4bPlanAsync(owner, hadiId, "B4b Hadi later", B4bOffer(1, "Week", 0m, "USD", "Training"), start.AddDays(35));

        // Thirty days on, Maya asks to renew (ADR 0029).
        RequiredTestClock.Advance(TimeSpan.FromDays(30));
        var today = start.AddDays(30);
        await RefreshCsrfAsync(maya);
        await AssertStatusAsync(await maya.PostAsync("/api/client-renewal/me/requests", null), HttpStatusCode.Created);

        // Ending soon, the soonest end first, then by name. The owner may message their own client, with chat in her
        // plan; Lea's client is Lea's to message; Ziad's renewal is booked, so its payment is what to record.
        var view = await ReadSliceAsync<CoachTodayView>(owner, CoachTodayUrl);
        var lastDay = start.AddDays(41);
        Assert.AreEqual(
            $"Nadine {nadinePlan.Id} B4b Nadine {lastDay:yyyy-MM-dd}  True {nadineChat}, " +
            $"Nour {nourPlan.Id} B4b Nour {lastDay:yyyy-MM-dd}  False , " +
            $"Ziad {ziadPlan.Id} B4b Ziad {lastDay:yyyy-MM-dd} {ziadRenewal.Id} False ",
            string.Join(", ", view.PlansEndingSoon.Select(row =>
                $"{row.Client.FirstName} {row.EnrollmentId} {row.PlanName} {row.LastDay:yyyy-MM-dd} {row.UnpaidRenewalId} {row.CanMessage} {row.ChatId}")));
        Assert.AreEqual("Lea Khoury", view.PlansEndingSoon[1].Client.AssignedCoachName);
        Assert.AreEqual(view.PlansEndingSoon.Count, view.PlansEndingSoonCount);
        Assert.AreEqual((Guid?)ziadRenewal.Id, view.Attention
            .Single(item => item.Kind == CoachAttentionKind.PlanEndingSoon && item.Client.ClientProfileId == ziadId).SubjectId,
            "Needs you names the same renewal to pay (BEB-7).");

        // Ended, not renewed, the latest end first, then by name: Maya asked today; Tarek's renewal waits for payment.
        // The owner's rows carry each client's version, for ending their coaching (ADR 0027).
        var twoWeeks = start.AddDays(13);
        Assert.AreEqual(
            $"Karim {karimPlan.Id} B4b Karim {twoWeeks:yyyy-MM-dd}  , " +
            $"Tarek {tarekPlan.Id} B4b Tarek {twoWeeks:yyyy-MM-dd} {tarekRenewal.Id} , " +
            $"Maya {mayaPlan.Id} B4b Maya {twoWeeks:yyyy-MM-dd}  {today:yyyy-MM-dd}, " +
            $"Lina {linaPlan.Id} B4b Lina {start.AddDays(1):yyyy-MM-dd}  ",
            string.Join(", ", view.PlansEndedNotRenewed.Select(row =>
                $"{row.Client.FirstName} {row.EnrollmentId} {row.PlanName} {row.LastDay:yyyy-MM-dd} {row.UnpaidRenewalId} {row.RenewalRequestedOn:yyyy-MM-dd}")));
        foreach (var row in view.PlansEndedNotRenewed)
        {
            var details = await RequiredJsonAsync<TeamClientDetails>(await owner.GetAsync($"/api/clients/{row.Client.ClientProfileId}"));
            Assert.AreEqual((uint?)details.Version, row.ClientVersion, row.Client.FirstName);
        }

        Assert.AreEqual((mayaPlan.Id, (DateOnly?)twoWeeks), view.Attention
            .Where(item => item.Kind == CoachAttentionKind.RenewalRequested)
            .Select(item => (item.SubjectId!.Value, item.Date))
            .Single(), "Needs you still asks about Maya's request, as before.");
        foreach (var hidden in new[] { jadId, ramiId, hadiId })
        {
            Assert.IsFalse(view.PlansEndedNotRenewed.Any(row => row.Client.ClientProfileId == hidden), hidden.ToString());
        }

        // Lea reads her own clients alone: Nour, whom she may message, and Karim, with no version, since ending a
        // client's coaching is the owner's.
        var leasView = await ReadSliceAsync<CoachTodayView>(lea, CoachTodayUrl);
        Assert.AreEqual((nourId, true, (Guid?)nourChat),
            (leasView.PlansEndingSoon.Single().Client.ClientProfileId, leasView.PlansEndingSoon.Single().CanMessage,
                leasView.PlansEndingSoon.Single().ChatId));
        Assert.AreEqual((karimId, (uint?)null),
            (leasView.PlansEndedNotRenewed.Single().Client.ClientProfileId, leasView.PlansEndedNotRenewed.Single().ClientVersion));
        Assert.IsFalse((await lea.GetStringAsync(CoachTodayUrl)).Contains(nadineChat.ToString(), StringComparison.OrdinalIgnoreCase));

        // The version on the owner's row is what ending Karim's coaching asks for; a former client leaves the list.
        var karimRow = view.PlansEndedNotRenewed.Single(row => row.Client.ClientProfileId == karimId);
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(await owner.PostAsJsonAsync($"/api/clients/{karimId}/release",
            new { reason = "Stopped coming", version = karimRow.ClientVersion }), HttpStatusCode.OK);
        view = await ReadSliceAsync<CoachTodayView>(owner, CoachTodayUrl);
        Assert.AreEqual("Tarek, Maya, Lina", string.Join(", ", view.PlansEndedNotRenewed.Select(row => row.Client.FirstName)));
        Assert.IsEmpty((await ReadSliceAsync<CoachTodayView>(lea, CoachTodayUrl)).PlansEndedNotRenewed);

        // Paying Tarek's renewal renews him: his plan runs, and he leaves the list.
        await B4aPayInFullAsync(owner, tarekRenewal);
        view = await ReadSliceAsync<CoachTodayView>(owner, CoachTodayUrl);
        Assert.AreEqual("Maya, Lina", string.Join(", ", view.PlansEndedNotRenewed.Select(row => row.Client.FirstName)));
    }

    [TestMethod]
    public async Task B4bTodayIsAFixedNumberOfQueriesInItsBusiestCase()
    {
        var start = new DateOnly(2026, 11, 9);
        B4aSetWorkspaceClock(start, new TimeOnly(12, 0));
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b4b-queries-owner@example.test", "Hicham Haddad", "B4b Queries");
        using var lea = CreateClient();
        await JoinAsCoachAsync(owner, lea, "b4b-queries-lea@example.test", "Lea Khoury");
        var form = await Phase6CreateFormAsync(owner, "Weekly check-in", Phase6ShortText("How was your week?"));
        var version = await Phase6PublishAsync(owner, form.Form.Id, form.Versions[0]);

        // Sara pays for meal plans in USD and LBP; Jad's one day of training runs out tonight. The clients that follow
        // touch every other read Today makes (a program with a record, a sent check-in and one coming, an unread chat).
        using var sara = CreateClient();
        var saraId = await R31InviteAsync(owner, sara, tenant, "b4b-queries-sara@example.test", "Sara", "Khalil");
        await B4aPayInFullAsync(owner, await B4bPlanAsync(owner, saraId, "B4b Sara", B4bOffer(4, "Week", 50m, "USD", "Nutrition"), start));
        await B4aPayInFullAsync(owner, await B4bPlanAsync(owner, saraId, "B4b Sara lira", B4bOffer(4, "Week", 900_000m, "LBP", "ResourceLibrary"), start));
        using var jad = CreateClient();
        var jadId = await R31InviteAsync(owner, jad, tenant, "b4b-queries-jad@example.test", "Jad", "Mansour");
        await B4bPlanAsync(owner, jadId, "B4b Jad", B4bOffer(1, "Day", 0m, "USD", "Training"), start);
        B4bNextDay();
        var today = Phase6WorkspaceToday();
        using var maya = CreateClient();
        var (_, training) = await B4aBusyClientAsync(owner, maya, tenant, "maya", version, null, today);
        using var omar = CreateClient();
        await B4aBusyClientAsync(owner, omar, tenant, "omar", version, training, today);
        var (fewer, view) = await B4aMeasureAsync<CoachTodayView>(owner, CoachTodayUrl, "B4b Coach Today, 4 clients");
        Assert.AreEqual(jadId, view.PlansEndedNotRenewed.Single().Client.ClientProfileId, "The renewal requests' read runs.");
        Assert.HasCount(2, view.Month.MoneyReceived);
        Assert.AreEqual((1, 1), (
            RequiredTodayQueryCounter.ReadsTagged(CoachOverviewReader.MoneyReceivedTag).Commands,
            RequiredTodayQueryCounter.ReadsTagged(CoachOverviewReader.CoachesTag).Commands));

        using var nour = CreateClient();
        await B4aBusyClientAsync(owner, nour, tenant, "nour", version, training, today);
        using var rami = CreateClient();
        await B4aBusyClientAsync(owner, rami, tenant, "rami", version, training, today);
        var (more, _) = await B4aMeasureAsync<CoachTodayView>(owner, CoachTodayUrl, "B4b Coach Today, 6 clients");
        Assert.AreEqual(fewer, more, "Two more clients cost Today no query.");
        // 28: B4a's 25 (every read Today made then, in use in its busy scenario), plus the renewal requests' read,
        // which runs only while some client's whole plan has run out (Jad's, here), and This month's two: money
        // received, one query with each receipt's coach history (SUB-016), and the owner's team, the owner's alone.
        // Ended plans' names and the client's version ride on reads Today already made. Pinned exactly, so one
        // more read fails here, as a query per client fails the equality above.
        Assert.AreEqual(B4bTodayQueryPin, more, "Coach Today costs a fixed number of queries (docs/ARCHITECTURE.md).");

        // A coach's Today reads no team.
        var (coach, _) = await B4aMeasureAsync<CoachTodayView>(lea, CoachTodayUrl, "B4b Coach Today, a coach");
        Assert.IsLessThan(B4bTodayQueryPin, coach);
        Assert.AreEqual(0, RequiredTodayQueryCounter.ReadsTagged(CoachOverviewReader.CoachesTag).Commands);
    }

    [TestMethod]
    public async Task B4bAClientMovedAwayAndBackLeavesEachStintsReceiptsWithThatStintsCoach()
    {
        // Lea invites Maya on 5 Oct; the owner moves her to Omar on 8 Oct and back to Lea on 12 Oct. Maya pays in each
        // stint, in USD and in LBP, towards plans she never pays off, so every receipt is a part payment.
        var day = new DateOnly(2026, 10, 5);
        B4aSetWorkspaceClock(day, new TimeOnly(12, 0));
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b4b-stints-owner@example.test", "Hicham Haddad", "B4b Stints");
        using var lea = CreateClient();
        var leaId = await JoinAsCoachAsync(owner, lea, "b4b-stints-lea@example.test", "Lea Khoury");
        using var omar = CreateClient();
        var omarId = await JoinAsCoachAsync(owner, omar, "b4b-stints-omar@example.test", "Omar Nasser");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(lea, maya, tenant, "b4b-stints-maya@example.test", "Maya", "Rahman");
        var coaching = await B4bPlanAsync(owner, mayaId, "B4b Stints coaching", B4bOffer(8, "Week", 300m, "USD", "CheckIns", "Messaging"), day);
        var meals = await B4bPlanAsync(owner, mayaId, "B4b Stints meals", B4bOffer(8, "Week", 3_000_000m, "LBP", "Nutrition"), day);

        // Lea's first stint: 40 USD on 5 Oct and 10 USD on 6 Oct.
        await B4bPayAsync(owner, coaching, 40m, day);
        B4bNextDay();
        await B4bPayAsync(owner, coaching, 10m, day.AddDays(1));

        // Omar's stint, from 8 Oct: 60 USD and 500,000 LBP on 9 Oct.
        B4bNextDay();
        B4bNextDay();
        await ReassignAsync(owner, mayaId, omarId, "Omar trains mornings");
        B4bNextDay();
        await B4bPayAsync(owner, coaching, 60m, day.AddDays(4));
        await B4bPayAsync(owner, meals, 500_000m, day.AddDays(4));

        // Lea's second stint, from 12 Oct: 70 USD and 1,000,000 LBP on 13 Oct, and 25 USD of 10 Oct recorded only then,
        // which arrived while Omar coached her and is his.
        B4bNextDay();
        B4bNextDay();
        B4bNextDay();
        await ReassignAsync(owner, mayaId, leaId, "Back to evenings");
        B4bNextDay();
        await B4bPayAsync(owner, coaching, 70m, day.AddDays(8));
        await B4bPayAsync(owner, meals, 1_000_000m, day.AddDays(8));
        var recordedLate = await B4bPayAsync(owner, coaching, 25m, day.AddDays(5));
        Assert.AreEqual((95m, "USD"), (recordedLate.BalanceAmount, recordedLate.PriceCurrency), "300 USD less 205 received.");

        // Each coach reads exactly the receipts of their own stints, per currency.
        var ownerView = await ReadSliceAsync<CoachTodayView>(owner, CoachTodayUrl);
        var leasView = await ReadSliceAsync<CoachTodayView>(lea, CoachTodayUrl);
        var omarsView = await ReadSliceAsync<CoachTodayView>(omar, CoachTodayUrl);
        Assert.AreEqual(day.AddDays(8), ownerView.Today);
        Assert.AreEqual("LBP 1000000.00 1, USD 120.00 3", B4bSay(leasView.Month.MoneyReceived), "40 + 10, then 70.");
        Assert.AreEqual("LBP 500000.00 1, USD 85.00 2", B4bSay(omarsView.Month.MoneyReceived), "60, and 25 recorded late.");
        Assert.AreEqual("LBP 1500000.00 2, USD 205.00 5", B4bSay(ownerView.Month.MoneyReceived));

        // Together the coaches' totals make the owner's for this client: no receipt lost, none counted twice.
        Assert.AreEqual(
            B4bSay(ownerView.Month.MoneyReceived),
            B4bSay(leasView.Month.MoneyReceived
                .Concat(omarsView.Month.MoneyReceived)
                .GroupBy(total => total.Currency, StringComparer.Ordinal)
                .OrderBy(group => group.Key, StringComparer.Ordinal)
                .Select(group => new CoachMoneyReceivedView(
                    group.Key,
                    group.Sum(total => total.Amount),
                    group.Sum(total => total.PaymentCount)))));

        // Omar keeps his money but no longer reads Maya: no client, and nothing that names her.
        Assert.AreEqual((1, 0), (leasView.ClientCount, omarsView.ClientCount));
        await B4bAssertNotInAsync(omar, "Omar's Today", mayaId.ToString(), "Rahman", coaching.Id.ToString(), meals.Id.ToString());
    }

    [TestMethod]
    public async Task B4bAReceiptStaysMoneyReceivedWhenItsPlanIsCancelledLater()
    {
        // Lea's client Maya pays 40 USD towards a 100 USD chat plan on 5 Oct and the whole 60 USD of a meal plan on 6 Oct.
        // On 7 Oct the owner cancels both: the part-paid plan and the paid one.
        var day = new DateOnly(2026, 10, 5);
        B4aSetWorkspaceClock(day, new TimeOnly(12, 0));
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b4b-cancel-owner@example.test", "Hicham Haddad", "B4b Cancel");
        using var lea = CreateClient();
        await JoinAsCoachAsync(owner, lea, "b4b-cancel-lea@example.test", "Lea Khoury");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(lea, maya, tenant, "b4b-cancel-maya@example.test", "Maya", "Rahman");
        var chat = await B4bPlanAsync(owner, mayaId, "B4b Cancel chat", B4bOffer(4, "Week", 100m, "USD", "Messaging"), day);
        var meals = await B4bPlanAsync(owner, mayaId, "B4b Cancel meals", B4bOffer(4, "Week", 60m, "USD", "Nutrition"), day);
        chat = await B4bPayAsync(owner, chat, 40m, day);
        B4bNextDay();
        meals = await B4bPayAsync(owner, meals, 60m, day.AddDays(1));
        Assert.AreEqual((EnrollmentStatus.PendingPayment, EnrollmentStatus.Active), (chat.StoredStatus, meals.StoredStatus));
        Assert.AreEqual("USD 100.00 2", B4bSay((await ReadSliceAsync<CoachTodayView>(owner, CoachTodayUrl)).Month.MoneyReceived));

        B4bNextDay();
        foreach (var plan in new[] { chat, meals })
        {
            await RefreshCsrfAsync(owner);
            var cancelled = await owner.PostAsJsonAsync($"/api/commercial/enrollments/{plan.Id}/cancel",
                new { reason = "Stopped coming", plan.Version });
            await AssertStatusAsync(cancelled, HttpStatusCode.OK);
            var view = await ReadSlicePayloadAsync<ClientEnrollmentView>(cancelled);
            Assert.AreEqual((EnrollmentStatus.Cancelled, plan.PaidAmount), (view.StoredStatus, view.PaidAmount), plan.ProductName);
        }

        // The money arrived, so it stays this month's for the owner and for Lea, though no plan runs and none is
        // listed as ended (a cancelled plan never is).
        var ownerView = await ReadSliceAsync<CoachTodayView>(owner, CoachTodayUrl);
        var leasView = await ReadSliceAsync<CoachTodayView>(lea, CoachTodayUrl);
        Assert.AreEqual(("USD 100.00 2", "USD 100.00 2"), (B4bSay(ownerView.Month.MoneyReceived), B4bSay(leasView.Month.MoneyReceived)));
        Assert.AreEqual((0, 0), (ownerView.Month.ActiveClientCount, ownerView.PlansEndedNotRenewed.Count));
    }

    [TestMethod]
    public async Task B4bAnotherWorkspacesReceiptsOfTheSameMonthReachNoTotalHere()
    {
        // Lea coaches in two workspaces. Here her client Maya pays 100 USD; at Other Owner's, in the same October, her
        // client Nour pays 55 USD and 700,000 LBP and the owner's own client Sara 33 USD.
        var day = new DateOnly(2026, 10, 5);
        B4aSetWorkspaceClock(day, new TimeOnly(12, 0));
        using var owner = CreateClient();
        var here = await RegisterCoachAsync(owner, "b4b-apart-owner@example.test", "Hicham Haddad", "B4b Here");
        using var lea = CreateClient();
        await JoinAsCoachAsync(owner, lea, "b4b-apart-lea@example.test", "Lea Khoury");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(lea, maya, here, "b4b-apart-maya@example.test", "Maya", "Rahman");
        await B4bPayAsync(owner, await B4bPlanAsync(owner, mayaId, "B4b Here plan", B4bOffer(4, "Week", 100m, "USD", "Messaging"), day), 100m, day);

        B4bNextDay();
        using var other = CreateClient();
        var elsewhere = await RegisterCoachAsync(other, "b4b-apart-other@example.test", "Other Owner", "B4b Elsewhere");
        await B4bJoinSignedInAsCoachAsync(other, lea, elsewhere, "b4b-apart-lea@example.test", "Lea");
        using var nour = CreateClient();
        var nourId = await R31InviteAsync(lea, nour, elsewhere, "b4b-apart-nour@example.test", "Nour", "Fares");
        using var sara = CreateClient();
        var saraId = await R31InviteAsync(other, sara, elsewhere, "b4b-apart-sara@example.test", "Sara", "Khalil");
        await B4bPayAsync(other, await B4bPlanAsync(other, nourId, "B4b Elsewhere chat", B4bOffer(4, "Week", 55m, "USD", "Messaging"), day), 55m, day.AddDays(1));
        await B4bPayAsync(other, await B4bPlanAsync(other, nourId, "B4b Elsewhere meals", B4bOffer(4, "Week", 700_000m, "LBP", "Nutrition"), day), 700_000m, day.AddDays(1));
        await B4bPayAsync(other, await B4bPlanAsync(other, saraId, "B4b Elsewhere coaching", B4bOffer(4, "Week", 50m, "USD", "CheckIns"), day), 33m, day.AddDays(1));

        // Here, the owner and Lea read Maya's 100 USD alone.
        SetTenant(lea, here);
        Assert.AreEqual("USD 100.00 1", B4bSay((await ReadSliceAsync<CoachTodayView>(owner, CoachTodayUrl)).Month.MoneyReceived));
        Assert.AreEqual("USD 100.00 1", B4bSay((await ReadSliceAsync<CoachTodayView>(lea, CoachTodayUrl)).Month.MoneyReceived));
        await B4bAssertNotInAsync(lea, "Lea's Today here", nourId.ToString(), saraId.ToString(), "Fares", "Khalil");

        // There, Other Owner reads that workspace's own and Lea her client Nour's, and neither reads Maya's.
        SetTenant(lea, elsewhere);
        Assert.AreEqual("LBP 700000.00 1, USD 88.00 2", B4bSay((await ReadSliceAsync<CoachTodayView>(other, CoachTodayUrl)).Month.MoneyReceived));
        Assert.AreEqual("LBP 700000.00 1, USD 55.00 1", B4bSay((await ReadSliceAsync<CoachTodayView>(lea, CoachTodayUrl)).Month.MoneyReceived));
        await B4bAssertNotInAsync(lea, "Lea's Today elsewhere", mayaId.ToString(), "Rahman");
    }

    [TestMethod]
    public async Task B4bEndedNotRenewedLeavesOutAPausedPlanABlockedClientAndAPaidPlanStillToCome()
    {
        // Every client's two weeks of training run out after 2 Nov + 13; thirty days on, each last day was 17 days ago.
        // Maya has nothing else. Paula's meal plans run on beside it, paused; Bilal is blocked; Fadi's meal plans, paid
        // in full, start on day 35. Nadia's two weeks were never paid for.
        var start = new DateOnly(2026, 11, 2);
        B4aSetWorkspaceClock(start, new TimeOnly(12, 0));
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b4b-lapsed-owner@example.test", "Hicham Haddad", "B4b Lapsed");
        var training = B4bOffer(2, "Week", 0m, "USD", "Training");

        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(owner, maya, tenant, "b4b-lapsed-maya@example.test", "Maya", "Rahman");
        var mayaPlan = await B4bPlanAsync(owner, mayaId, "B4b Maya", training, start);

        using var paula = CreateClient();
        var paulaId = await R31InviteAsync(owner, paula, tenant, "b4b-lapsed-paula@example.test", "Paula", "Aoun");
        await B4bPlanAsync(owner, paulaId, "B4b Paula", training, start);
        var paulaMeals = await B4bPlanAsync(owner, paulaId, "B4b Paula meals", B4bOffer(8, "Week", 0m, "USD", "Nutrition"), start);
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(await owner.PostAsJsonAsync($"/api/commercial/enrollments/{paulaMeals.Id}/pause",
            new { reason = "Travelling", paulaMeals.Version }), HttpStatusCode.OK);

        using var bilal = CreateClient();
        var bilalId = await R31InviteAsync(owner, bilal, tenant, "b4b-lapsed-bilal@example.test", "Bilal", "Saab");
        await B4bPlanAsync(owner, bilalId, "B4b Bilal", training, start);

        using var fadi = CreateClient();
        var fadiId = await R31InviteAsync(owner, fadi, tenant, "b4b-lapsed-fadi@example.test", "Fadi", "Daher");
        await B4bPlanAsync(owner, fadiId, "B4b Fadi", training, start);
        var fadiMeals = await B4aPayInFullAsync(owner,
            await B4bPlanAsync(owner, fadiId, "B4b Fadi meals", B4bOffer(4, "Week", 90m, "USD", "Nutrition"), start.AddDays(35)));
        Assert.AreEqual(EnrollmentStatus.Active, fadiMeals.StoredStatus);

        using var nadia = CreateClient();
        var nadiaId = await R31InviteAsync(owner, nadia, tenant, "b4b-lapsed-nadia@example.test", "Nadia", "Haddad");
        var nadiaPlan = await B4bPlanAsync(owner, nadiaId, "B4b Nadia", B4bOffer(2, "Week", 100m, "USD", "Training"), start);
        Assert.AreEqual(EnrollmentStatus.PendingPayment, nadiaPlan.StoredStatus);

        RequiredTestClock.Advance(TimeSpan.FromDays(30));
        await B4aSetBlockedAsync(owner, bilalId, blocked: true);

        // Why each is or is not listed, as the client list reads their plan.
        var states = (await ReadSliceAsync<ClientOverviewView>(owner, ClientOverviewUrl)).Clients
            .ToDictionary(row => row.Client.FirstName, row => row.PlanState);
        Assert.AreEqual(
            "Bilal Blocked, Fadi NotStarted, Maya Ended, Nadia Ended, Paula Paused",
            string.Join(", ", states.OrderBy(item => item.Key, StringComparer.Ordinal).Select(item => $"{item.Key} {item.Value}")));

        // Listed: Maya, and Nadia, pinned as the code stands. A question for the owner: a plan never paid for whose
        // dates passed counts as ran out, as its access decision (Expired) and SUB-014 read it, so it is listed with
        // Renew rather than with a payment to record or not at all.
        var lastDay = start.AddDays(13);
        var view = await ReadSliceAsync<CoachTodayView>(owner, CoachTodayUrl);
        Assert.AreEqual(
            $"Nadia {nadiaPlan.Id} {lastDay:yyyy-MM-dd} , Maya {mayaPlan.Id} {lastDay:yyyy-MM-dd} ",
            string.Join(", ", view.PlansEndedNotRenewed.Select(row =>
                $"{row.Client.FirstName} {row.EnrollmentId} {row.LastDay:yyyy-MM-dd} {row.UnpaidRenewalId}")));
        foreach (var hidden in new[] { paulaId, bilalId, fadiId })
        {
            Assert.IsFalse(view.PlansEndedNotRenewed.Any(row => row.Client.ClientProfileId == hidden), hidden.ToString());
        }
    }

    // ---------- B4b helpers ----------

    /// <summary>A price option of <paramref name="count"/> weeks or days with these features, as the plan editor sends one.</summary>
    private static object B4bOffer(int count, string unit, decimal price, string currency, params string[] features) => new
    {
        label = $"{count} {unit.ToLowerInvariant()}s",
        durationCount = count,
        durationUnit = unit,
        priceAmount = price,
        priceCurrency = currency,
        features = features.Select(feature => new { feature, allowsConcurrentCoverage = false }).ToArray(),
    };

    /// <summary>A plan for sale with this one option, booked for the client from <paramref name="startDate"/>.</summary>
    private static async Task<ClientEnrollmentView> B4bPlanAsync(
        HttpClient coach,
        Guid clientId,
        string name,
        object offer,
        DateOnly startDate) =>
        await A7EnrollAsync(coach, clientId, (await B4aProductAsync(coach, name, offer)).Offers.Single().Id, startDate);

    /// <summary>Records money received on a workspace day, in the plan's own currency (SUB-007, SUB-008).</summary>
    private static async Task<ClientEnrollmentView> B4bPayAsync(
        HttpClient coach,
        ClientEnrollmentView plan,
        decimal amount,
        DateOnly receivedOn)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync($"/api/commercial/enrollments/{plan.Id}/payments", new
        {
            amount,
            currencyCode = plan.PriceCurrency,
            receivedOn = receivedOn.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            method = "Cash",
            reference = (string?)null,
            note = (string?)null,
            idempotencyKey = Guid.NewGuid(),
        });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<ClientEnrollmentView>(response);
    }

    /// <summary>
    /// The owner invites someone who already coaches elsewhere to coach here too; they accept signed in, and their
    /// next calls go to this workspace.
    /// </summary>
    private static async Task B4bJoinSignedInAsCoachAsync(HttpClient owner, HttpClient coach, Guid tenant, string email, string firstName)
    {
        await RefreshCsrfAsync(owner);
        var invited = await owner.PostAsJsonAsync("/api/team/invitations", new { email, firstName, lastName = "Coach" });
        await AssertStatusAsync(invited, HttpStatusCode.Created);
        var link = (await RequiredJsonAsync<TeamInvitation>(invited)).DevelopmentActionUrl!;
        await RefreshCsrfAsync(coach);
        var accepted = await coach.PostAsJsonAsync("/api/invitations/accept",
            new { token = QueryValue(link, "token"), displayName = (string?)null, password = (string?)null });
        await AssertStatusAsync(accepted, HttpStatusCode.OK);
        var acceptance = await RequiredJsonAsync<TeamAcceptance>(accepted);
        Assert.AreEqual((tenant, "Coach"), (acceptance.TenantId, acceptance.Kind));
        SetTenant(coach, tenant);
    }

    /// <summary>Moves the frozen clock a whole day on, from midday, and checks the workspace reads the next day.</summary>
    private void B4bNextDay()
    {
        var next = Phase6WorkspaceToday().AddDays(1);
        RequiredTestClock.Advance(TimeSpan.FromDays(1));
        Assert.AreEqual(next, Phase6WorkspaceToday());
    }

    /// <summary>Money received as one line: each currency's exact total and how many payments made it up.</summary>
    private static string B4bSay(IEnumerable<CoachMoneyReceivedView> money) =>
        string.Join(", ", money.Select(total =>
            string.Create(CultureInfo.InvariantCulture, $"{total.Currency} {total.Amount:0.00} {total.PaymentCount}")));

    /// <summary>Asserts that the caller's Coach Today names none of these anywhere in what it sends.</summary>
    private static async Task B4bAssertNotInAsync(HttpClient caller, string whose, params string[] hidden)
    {
        var raw = await caller.GetStringAsync(CoachTodayUrl);
        foreach (var item in hidden)
        {
            Assert.IsFalse(raw.Contains(item, StringComparison.OrdinalIgnoreCase), $"{whose} carries {item}.");
        }
    }
}
