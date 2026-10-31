using System.Net;
using System.Net.Http.Json;
using TB.Gym.Infrastructure.Application;
using TB.Gym.Modules.Clients;
using ClientEnrollmentView = TB.Gym.Modules.Subscriptions.ClientEnrollmentView;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Critique B10d, the This month page (SUB-018): money received, sessions held, plans and packs sold, clients started and
/// ended, this month and last, a coach's own, and for the owner each coach's and the total. Every test sets the frozen
/// clock to fixed days at midday in the workspace's zone, so nothing depends on the real day of the month.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string CoachMonthUrl = "/api/coach-month";

    /// <summary>
    /// The page's SQL commands for the owner of a team, sign-in and tenant checks included, measured by
    /// <see cref="B10dThePageIsAFixedNumberOfQueries"/> and pinned exactly.
    /// </summary>
    private const int B10dMonthQueryPin = 11;

    [TestMethod]
    public async Task B10dACoachReadsTheirOwnAndTheOwnerEachCoachAndTheTotal()
    {
        var september = new DateOnly(2026, 9, 14);
        B4aSetWorkspaceClock(september, new TimeOnly(12, 0));
        using var stranger = CreateClient();
        await RegisterCoachAsync(stranger, "b10d-month-stranger@example.test", "Other Owner", "B10d Elsewhere");

        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b10d-month-owner@example.test", "Hicham Haddad", "B10d Month");
        using var lea = CreateClient();
        var leaId = await JoinAsCoachAsync(owner, lea, "b10d-month-lea@example.test", "Lea Khoury");
        using var omar = CreateClient();
        var omarId = await JoinAsCoachAsync(owner, omar, "b10d-month-omar@example.test", "Omar Nasser");
        using var zeina = CreateClient();
        var zeinaId = await JoinAsCoachAsync(owner, zeina, "b10d-month-zeina@example.test", "Zeina Aoun");
        var ownerId = (await TeamMembersAsync(owner)).Single(member => member.Role == "Owner").UserId;
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(lea, maya, tenant, "b10d-month-maya@example.test", "Maya", "Rahman");
        using var rami = CreateClient();
        var ramiId = await R31InviteAsync(lea, rami, tenant, "b10d-month-rami@example.test", "Rami", "Saliba");
        using var nour = CreateClient();
        var nourId = await R31InviteAsync(omar, nour, tenant, "b10d-month-nour@example.test", "Nour", "Fares");
        using var sara = CreateClient();
        var saraId = await R31InviteAsync(owner, sara, tenant, "b10d-month-sara@example.test", "Sara", "Khalil");

        var coaching = (await B4aProductAsync(owner, "B10d Coaching", B4bOffer(4, "Week", 100m, "USD", "CheckIns", "Messaging"))).Offers.Single().Id;
        var meals = (await B4aProductAsync(owner, "B10d Meals", B4bOffer(4, "Week", 1_500_000m, "LBP", "Nutrition"))).Offers.Single().Id;
        var pack = (await B10bPackProductAsync(owner, "B10d Personal training", B10bPackOffer(10, 90, 300m))).Offers.Single().Id;
        var goodwill = (await B10bPackProductAsync(owner, "B10d Goodwill", B10bPackOffer(1, 30, 0m))).Offers.Single().Id;

        // September: Maya starts with Lea, in dollars, and Nour with Omar, in pounds, each on a plan of four weeks.
        await B4bPayAsync(owner, await A7EnrollAsync(owner, mayaId, coaching, september), 100m, september);
        await B4bPayAsync(owner, await A7EnrollAsync(owner, nourId, meals, september), 1_500_000m, september);

        // October: Maya's renewal follows on from 12 Oct with 60 of its 100 paid. Rami and Sara start on packs, and Sara
        // gets a gift and a plan booked by mistake.
        var october = new DateOnly(2026, 10, 5);
        B4aSetWorkspaceClock(october, new TimeOnly(12, 0));
        var renewal = await A7EnrollAsync(owner, mayaId, coaching, new DateOnly(2026, 10, 12));
        await B4bPayAsync(owner, renewal, 60m, october);
        await B4bPayAsync(owner, await A7EnrollAsync(owner, ramiId, pack, october), 300m, october);
        await B4bPayAsync(owner, await A7EnrollAsync(owner, saraId, pack, october), 300m, october);
        await A7EnrollAsync(owner, saraId, goodwill, october);
        await B10dCancelAsync(owner, await A7EnrollAsync(owner, saraId, coaching, october));

        // Lea holds three for Rami, undoes one and charges a no-show; the owner holds one for her client and one for
        // their own.
        await B10bRecordAsync(lea, ramiId, october);
        await B10bRecordAsync(lea, ramiId, october);
        var undone = await B10bRecordAsync(lea, ramiId, october, note: "Wrong day");
        await B10bVoidOkAsync(lea, ramiId, undone.Sessions!.Entries.First(item => item.Note == "Wrong day").Id, Guid.NewGuid());
        await B10bRecordAsync(lea, ramiId, october, "Charged", reason: "No-show");
        await B10bRecordAsync(owner, ramiId, october);
        await B10bRecordAsync(owner, saraId, october);

        // On 20 Oct Nour's plan has run out with nothing after it, and so has Maya's first: her renewal isn't paid yet.
        B4aSetWorkspaceClock(new DateOnly(2026, 10, 20), new TimeOnly(12, 0));
        Assert.AreEqual(
            "USD 360.00 2 | held 2 | plans 1 | packs 1 | started 1 | ended 1",
            B10dSay((await ReadSliceAsync<CoachMonthReportView>(lea, CoachMonthUrl)).ThisMonth));

        // Its last 40 cover the renewal from its first day, so Maya never ended.
        await B4bPayAsync(owner, renewal, 40m, new DateOnly(2026, 10, 20));

        var leas = await ReadSliceAsync<CoachMonthReportView>(lea, CoachMonthUrl);
        Assert.AreEqual(
            (new DateOnly(2026, 10, 20), new DateOnly(2026, 10, 1), new DateOnly(2026, 9, 1)),
            (leas.Today, leas.ThisMonthFrom, leas.LastMonthFrom));
        Assert.AreEqual(("MonthNumbers", 2, "MoneyReceived", 1), (leas.MonthRuleKey, leas.MonthRuleVersion, leas.MoneyRuleKey, leas.MoneyRuleVersion));
        Assert.AreEqual("USD 400.00 3 | held 2 | plans 1 | packs 1 | started 1 | ended 0", B10dSay(leas.ThisMonth));
        Assert.AreEqual("USD 100.00 1 | held 0 | plans 1 | packs 0 | started 1 | ended 0", B10dSay(leas.LastMonth));
        Assert.IsNull(leas.Coaches);

        var omars = await ReadSliceAsync<CoachMonthReportView>(omar, CoachMonthUrl);
        Assert.AreEqual("none | held 0 | plans 0 | packs 0 | started 0 | ended 1", B10dSay(omars.ThisMonth));
        Assert.AreEqual("LBP 1500000.00 1 | held 0 | plans 1 | packs 0 | started 1 | ended 0", B10dSay(omars.LastMonth));

        var zeinas = await ReadSliceAsync<CoachMonthReportView>(zeina, CoachMonthUrl);
        Assert.AreEqual("none | held 0 | plans 0 | packs 0 | started 0 | ended 0", B10dSay(zeinas.ThisMonth));
        Assert.AreEqual("none | held 0 | plans 0 | packs 0 | started 0 | ended 0", B10dSay(zeinas.LastMonth));

        // The owner reads the workspace's, each currency apart, and every member of staff's, themselves first.
        var owners = await ReadSliceAsync<CoachMonthReportView>(owner, CoachMonthUrl);
        Assert.AreEqual("USD 700.00 4 | held 4 | plans 1 | packs 2 | started 2 | ended 1", B10dSay(owners.ThisMonth));
        Assert.AreEqual("LBP 1500000.00 1, USD 100.00 1 | held 0 | plans 2 | packs 0 | started 2 | ended 0", B10dSay(owners.LastMonth));
        var rows = owners.Coaches ?? throw new AssertFailedException("The owner reads each coach.");
        Assert.AreEqual(
            $"{ownerId} Hicham Haddad True False, {leaId} Lea Khoury False False, {omarId} Omar Nasser False False, {zeinaId} Zeina Aoun False False",
            string.Join(", ", rows.Select(row => $"{row.CoachUserId} {row.Name} {row.IsYou} {row.HasLeftTheTeam}")));
        Assert.AreEqual("USD 300.00 1 | held 2 | plans 0 | packs 1 | started 1 | ended 0", B10dSay(rows[0].ThisMonth));
        Assert.AreEqual(B10dSay(leas.ThisMonth), B10dSay(rows[1].ThisMonth), "Lea reads what the owner reads of her.");
        Assert.AreEqual(B10dSay(leas.LastMonth), B10dSay(rows[1].LastMonth));
        Assert.AreEqual(B10dSay(omars.ThisMonth), B10dSay(rows[2].ThisMonth));
        Assert.AreEqual(B10dSay(zeinas.ThisMonth), B10dSay(rows[3].ThisMonth), "A coach with nothing still has a row.");
        B10dAssertRowsAddUp(owners);

        // A coach's page carries nobody else's money, name or client, and no client's name at all.
        await B10dAssertNotInAsync(lea, "Lea's page",
            ownerId.ToString(), omarId.ToString(), zeinaId.ToString(), "Hicham", "Omar", "Zeina", "LBP",
            mayaId.ToString(), ramiId.ToString(), nourId.ToString(), saraId.ToString(), "Rahman", "Saliba", "Fares", "Khalil");
        await B10dAssertNotInAsync(omar, "Omar's page",
            ownerId.ToString(), leaId.ToString(), zeinaId.ToString(), "Hicham", "Lea Khoury", "Zeina", "USD",
            nourId.ToString(), "Fares");
        await B10dAssertNotInAsync(owner, "The owner's page",
            mayaId.ToString(), ramiId.ToString(), nourId.ToString(), saraId.ToString(), "Rahman", "Saliba", "Fares", "Khalil");
        Assert.Contains("\"coaches\":null", await lea.GetStringAsync(CoachMonthUrl));

        // Another workspace reads none of it.
        var elsewhere = await ReadSliceAsync<CoachMonthReportView>(stranger, CoachMonthUrl);
        Assert.AreEqual("none | held 0 | plans 0 | packs 0 | started 0 | ended 0", B10dSay(elsewhere.ThisMonth));
        Assert.AreEqual("none | held 0 | plans 0 | packs 0 | started 0 | ended 0", B10dSay(elsewhere.LastMonth));
        Assert.AreEqual("Other Owner", elsewhere.Coaches!.Single().Name);
    }

    [TestMethod]
    public async Task B10dAClientMovedToAnotherCoachLeavesTheirEarlierNumbersWithTheEarlierCoach()
    {
        var start = new DateOnly(2026, 10, 5);
        B4aSetWorkspaceClock(start, new TimeOnly(12, 0));
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b10d-move-owner@example.test", "Hicham Haddad", "B10d Move");
        using var lea = CreateClient();
        await JoinAsCoachAsync(owner, lea, "b10d-move-lea@example.test", "Lea Khoury");
        using var omar = CreateClient();
        var omarId = await JoinAsCoachAsync(owner, omar, "b10d-move-omar@example.test", "Omar Nasser");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(lea, maya, tenant, "b10d-move-maya@example.test", "Maya", "Rahman");
        var offer = (await B4aProductAsync(owner, "B10d Moved plan", B4bOffer(2, "Week", 100m, "USD", "Messaging"))).Offers.Single().Id;
        await B4bPayAsync(owner, await A7EnrollAsync(owner, mayaId, offer, start), 100m, start);

        B4aSetWorkspaceClock(new DateOnly(2026, 10, 10), new TimeOnly(12, 0));
        await ReassignAsync(owner, mayaId, omarId, "Omar trains mornings");
        B4aSetWorkspaceClock(new DateOnly(2026, 10, 12), new TimeOnly(12, 0));
        var renewal = await A7EnrollAsync(owner, mayaId, offer, new DateOnly(2026, 10, 19));
        await B4bPayAsync(owner, renewal, 100m, new DateOnly(2026, 10, 12));

        Assert.AreEqual(
            "USD 100.00 1 | held 0 | plans 1 | packs 0 | started 1 | ended 0",
            B10dSay((await ReadSliceAsync<CoachMonthReportView>(lea, CoachMonthUrl)).ThisMonth));
        Assert.AreEqual(
            "USD 100.00 1 | held 0 | plans 1 | packs 0 | started 0 | ended 0",
            B10dSay((await ReadSliceAsync<CoachMonthReportView>(omar, CoachMonthUrl)).ThisMonth));
        B10dAssertRowsAddUp(await ReadSliceAsync<CoachMonthReportView>(owner, CoachMonthUrl));
    }

    [TestMethod]
    public async Task B10dSomeoneWhoLeftTheTeamKeepsTheirNumbersOnTheOwnersRows()
    {
        var start = new DateOnly(2026, 10, 5);
        B4aSetWorkspaceClock(start, new TimeOnly(12, 0));
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b10d-left-owner@example.test", "Hicham Haddad", "B10d Left");
        using var lea = CreateClient();
        var leaId = await JoinAsCoachAsync(owner, lea, "b10d-left-lea@example.test", "Lea Khoury");
        using var zeina = CreateClient();
        var zeinaId = await JoinAsCoachAsync(owner, zeina, "b10d-left-zeina@example.test", "Zeina Aoun");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(lea, maya, tenant, "b10d-left-maya@example.test", "Maya", "Rahman");
        var pack = (await B10bPackProductAsync(owner, "B10d Left pack", B10bPackOffer(10, 90, 300m))).Offers.Single().Id;
        await B4bPayAsync(owner, await A7EnrollAsync(owner, mayaId, pack, start), 300m, start);
        await B10bRecordAsync(lea, mayaId, start);

        // A day on, Lea and Zeina leave.
        B4aSetWorkspaceClock(new DateOnly(2026, 10, 6), new TimeOnly(12, 0));
        foreach (var (userId, member) in (await TeamMembersAsync(owner))
                     .Where(item => item.UserId == leaId || item.UserId == zeinaId)
                     .Select(item => (item.UserId, item)))
        {
            await RefreshCsrfAsync(owner);
            await AssertStatusAsync(
                await owner.PostAsJsonAsync($"/api/team/members/{userId}/remove", new { version = member.Version }),
                HttpStatusCode.OK);
        }

        // Maya is the owner's now, and what she does from here on counts for them.
        B4aSetWorkspaceClock(new DateOnly(2026, 10, 7), new TimeOnly(12, 0));
        await B10bRecordAsync(owner, mayaId, new DateOnly(2026, 10, 7));

        var page = await ReadSliceAsync<CoachMonthReportView>(owner, CoachMonthUrl);
        Assert.AreEqual("Hicham Haddad False, Lea Khoury True", string.Join(", ", page.Coaches!.Select(row => $"{row.Name} {row.HasLeftTheTeam}")));
        Assert.AreEqual("none | held 1 | plans 0 | packs 0 | started 0 | ended 0", B10dSay(page.Coaches![0].ThisMonth));
        Assert.AreEqual("USD 300.00 1 | held 1 | plans 0 | packs 1 | started 1 | ended 0", B10dSay(page.Coaches[1].ThisMonth));
        B10dAssertRowsAddUp(page);
    }

    [TestMethod]
    public async Task B10dAClientWhoseCoachingEndsCountsForTheCoachTheyHadAndKeepsTheirSale()
    {
        var start = new DateOnly(2026, 10, 5);
        B4aSetWorkspaceClock(start, new TimeOnly(12, 0));
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b10d-end-owner@example.test", "Hicham Haddad", "B10d End");
        using var lea = CreateClient();
        await JoinAsCoachAsync(owner, lea, "b10d-end-lea@example.test", "Lea Khoury");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(lea, maya, tenant, "b10d-end-maya@example.test", "Maya", "Rahman");
        var offer = (await B4aProductAsync(owner, "B10d Ended plan", B4bOffer(8, "Week", 100m, "USD", "Messaging"))).Offers.Single().Id;
        await B4bPayAsync(owner, await A7EnrollAsync(owner, mayaId, offer, start), 100m, start);

        B4aSetWorkspaceClock(new DateOnly(2026, 10, 7), new TimeOnly(9, 0));
        await ReleaseAsync(owner, mayaId, "Moved away");

        Assert.AreEqual(
            "USD 100.00 1 | held 0 | plans 1 | packs 0 | started 1 | ended 1",
            B10dSay((await ReadSliceAsync<CoachMonthReportView>(lea, CoachMonthUrl)).ThisMonth));
        var page = await ReadSliceAsync<CoachMonthReportView>(owner, CoachMonthUrl);
        Assert.AreEqual("USD 100.00 1 | held 0 | plans 1 | packs 0 | started 1 | ended 1", B10dSay(page.ThisMonth));
        Assert.AreEqual("none | held 0 | plans 0 | packs 0 | started 0 | ended 0", B10dSay(page.Coaches![0].ThisMonth));
        B10dAssertRowsAddUp(page);
    }

    [TestMethod]
    public async Task B10dTheMonthsAreTheWorkspacesWhateverTheDayInUtc()
    {
        B4aSetWorkspaceClock(new DateOnly(2026, 9, 30), new TimeOnly(23, 30));
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b10d-edge-owner@example.test", "Hicham Haddad", "B10d Edge");
        using var maya = CreateClient();
        var mayaId = await R31InviteAsync(owner, maya, tenant, "b10d-edge-maya@example.test", "Maya", "Rahman");
        var offer = (await B4aProductAsync(owner, "B10d Edge plan", B4bOffer(4, "Week", 100m, "USD", "Messaging"))).Offers.Single().Id;
        await A7EnrollAsync(owner, mayaId, offer, new DateOnly(2026, 9, 30));

        // An hour on it is October in the workspace and still 30 Sep in UTC.
        B4aSetWorkspaceClock(new DateOnly(2026, 10, 1), new TimeOnly(0, 30));
        Assert.AreEqual(new DateOnly(2026, 9, 30), B4aUtcDay());
        await A7EnrollAsync(owner, mayaId, offer, new DateOnly(2026, 11, 2));

        var page = await ReadSliceAsync<CoachMonthReportView>(owner, CoachMonthUrl);
        Assert.AreEqual((new DateOnly(2026, 10, 1), new DateOnly(2026, 9, 1)), (page.ThisMonthFrom, page.LastMonthFrom));
        Assert.AreEqual((1, 1), (page.ThisMonth.PlansSold, page.LastMonth.PlansSold));

        // January's last month is the December before it.
        B4aSetWorkspaceClock(new DateOnly(2027, 1, 12), new TimeOnly(12, 0));
        page = await ReadSliceAsync<CoachMonthReportView>(owner, CoachMonthUrl);
        Assert.AreEqual((new DateOnly(2027, 1, 1), new DateOnly(2026, 12, 1)), (page.ThisMonthFrom, page.LastMonthFrom));
    }

    [TestMethod]
    public async Task B10dThePageIsStaffOnlyAndEachWorkspacesOwn()
    {
        B4aSetWorkspaceClock(new DateOnly(2026, 10, 5), new TimeOnly(12, 0));
        using var stranger = CreateClient();
        var elsewhere = await RegisterCoachAsync(stranger, "b10d-own-stranger@example.test", "Other Owner", "B10d Own Elsewhere");
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b10d-own-owner@example.test", "Hicham Haddad", "B10d Own");
        using var maya = CreateClient();
        await R31InviteAsync(owner, maya, tenant, "b10d-own-maya@example.test", "Maya", "Rahman");

        using var anonymous = CreateClient();
        await AssertStatusAsync(await anonymous.GetAsync(CoachMonthUrl), HttpStatusCode.Unauthorized);
        await AssertStatusAsync(await maya.GetAsync(CoachMonthUrl), HttpStatusCode.Forbidden);

        // Naming a workspace you are no member of opens nothing (the tenant handler decides, not this read).
        using var trespasser = CreateClient();
        await RegisterCoachAsync(trespasser, "b10d-own-trespasser@example.test", "Tess Passer", "B10d Own Third");
        SetTenant(trespasser, elsewhere);
        await AssertStatusAsync(await trespasser.GetAsync(CoachMonthUrl), HttpStatusCode.Forbidden);
    }

    [TestMethod]
    public async Task B10dThePageIsAFixedNumberOfQueries()
    {
        var start = new DateOnly(2026, 10, 5);
        B4aSetWorkspaceClock(start, new TimeOnly(12, 0));
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "b10d-queries-owner@example.test", "Hicham Haddad", "B10d Queries");
        using var lea = CreateClient();
        await JoinAsCoachAsync(owner, lea, "b10d-queries-lea@example.test", "Lea Khoury");
        var pack = (await B10bPackProductAsync(owner, "B10d Queries pack", B10bPackOffer(10, 90, 300m))).Offers.Single().Id;

        async Task SellAsync(string name)
        {
            using var client = CreateClient();
            var clientId = await R31InviteAsync(lea, client, tenant, $"b10d-queries-{name}@example.test", name, "Busy");
            await B4bPayAsync(owner, await A7EnrollAsync(owner, clientId, pack, start), 300m, start);
            await B10bRecordAsync(lea, clientId, start);
        }

        await SellAsync("maya");
        await SellAsync("rami");
        var (fewer, view) = await B4aMeasureAsync<CoachMonthReportView>(owner, CoachMonthUrl, "B10d This month, 2 clients");
        Assert.AreEqual("USD 600.00 2 | held 2 | plans 0 | packs 2 | started 2 | ended 0", B10dSay(view.ThisMonth));
        Assert.AreEqual(
            (1, 1, 1, 1, 1),
            (RequiredTodayQueryCounter.ReadsTagged(CoachMonthReader.MoneyReceivedTag).Commands,
                RequiredTodayQueryCounter.ReadsTagged(CoachMonthReader.SessionsHeldTag).Commands,
                RequiredTodayQueryCounter.ReadsTagged(CoachMonthReader.PlansTag).Commands,
                RequiredTodayQueryCounter.ReadsTagged(CoachMonthReader.StaffTag).Commands,
                RequiredTodayQueryCounter.ReadsTagged(CoachMonthReader.NamesTag).Commands));

        await SellAsync("nour");
        await SellAsync("sara");
        var (more, _) = await B4aMeasureAsync<CoachMonthReportView>(owner, CoachMonthUrl, "B10d This month, 4 clients");
        Assert.AreEqual(fewer, more, "Two more clients cost the page no query.");
        // 11, sign-in and tenant checks included: the workspace's calendar, the money, the sessions and the plans (each
        // with its coach history in the same read), and the owner's team and names. Pinned exactly, so one more read fails
        // here, as a query per client fails the equality above.
        Assert.AreEqual(B10dMonthQueryPin, more, "The page costs a fixed number of queries (docs/ARCHITECTURE.md).");

        // A coach's page reads no team.
        var (coach, _) = await B4aMeasureAsync<CoachMonthReportView>(lea, CoachMonthUrl, "B10d This month, a coach");
        Assert.IsLessThan(B10dMonthQueryPin, coach);
        Assert.AreEqual(0, RequiredTodayQueryCounter.ReadsTagged(CoachMonthReader.StaffTag).Commands);
    }

    // ---------- B10d helpers ----------

    /// <summary>One month's numbers as one line, each currency's exact total and how many payments made it up.</summary>
    private static string B10dSay(CoachMonthNumbersView numbers) =>
        $"{(numbers.MoneyReceived.Count == 0 ? "none" : B4bSay(numbers.MoneyReceived))} | held {numbers.SessionsHeld} | plans {numbers.PlansSold} | packs {numbers.PacksSold} | started {numbers.ClientsStarted} | ended {numbers.ClientsEnded}";

    /// <summary>Every row adds up to the owner's totals: nothing counts twice, and nothing falls out of the rows.</summary>
    private static void B10dAssertRowsAddUp(CoachMonthReportView page)
    {
        var rows = page.Coaches ?? throw new AssertFailedException("The owner reads each coach.");
        foreach (var (total, month) in new (CoachMonthNumbersView Total, Func<CoachMonthRowView, CoachMonthNumbersView> Month)[]
                 {
                     (page.ThisMonth, row => row.ThisMonth),
                     (page.LastMonth, row => row.LastMonth),
                 })
        {
            var parts = rows.Select(month).ToArray();
            var added = parts
                .SelectMany(part => part.MoneyReceived)
                .GroupBy(line => line.Currency)
                .OrderBy(group => group.Key, StringComparer.Ordinal)
                .Select(group => new CoachMoneyReceivedView(group.Key, group.Sum(line => line.Amount), group.Sum(line => line.PaymentCount)));
            var sum = new CoachMonthNumbersView(
                [.. added],
                parts.Sum(part => part.SessionsHeld),
                parts.Sum(part => part.PlansSold),
                parts.Sum(part => part.PacksSold),
                parts.Sum(part => part.ClientsStarted),
                parts.Sum(part => part.ClientsEnded));
            Assert.AreEqual(B10dSay(total), B10dSay(sum));
        }
    }

    private static async Task B10dCancelAsync(HttpClient coach, ClientEnrollmentView plan)
    {
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.PostAsJsonAsync($"/api/commercial/enrollments/{plan.Id}/cancel", new { reason = "Booked by mistake", plan.Version }),
            HttpStatusCode.OK);
    }

    /// <summary>Asserts that the caller's page names none of these anywhere in what it sends.</summary>
    private static async Task B10dAssertNotInAsync(HttpClient caller, string whose, params string[] hidden)
    {
        var raw = await caller.GetStringAsync(CoachMonthUrl);
        foreach (var item in hidden)
        {
            Assert.IsFalse(raw.Contains(item, StringComparison.OrdinalIgnoreCase), $"{whose} carries {item}.");
        }
    }
}
