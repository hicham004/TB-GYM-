using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.SharedKernel;
using ClientProfileOverviewView = TB.Gym.Modules.Clients.ClientProfileOverviewView;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The notes plan's N9b1, Free's life in the house (SUB-019), against PostgreSQL: the house command makes the house's
/// Free plan once, or says why it cannot and marks nothing, and clearing the mark takes Free off sale, unless a plan of
/// a tier was booked; a trainee confirmed by the emailed link or joining with the signed-in form starts Free once from
/// the house's day, is told nothing, and reads Free and their tier on My plan, and a house marked before Free existed
/// makes it at its first confirmation, once; a paid Pro+ plan raises the tier only while it is paid, with Free running
/// on under it, and the staff read a paid plan or a pack beside Free as the client's plan; the sweep renews Free thirty
/// days before a row ends, or from its end once it lapsed, once, for a blocked trainee too and never for one who left,
/// whichever of a leave and a renewal goes first, and with the sign-up sweep switched off too, and starts it for a
/// trainee who joined without it; the warning of a join without Free has an event id of its own; no staff route books,
/// renews, pauses, cancels, edits, reprices or takes money for Free, and no program goes under it; the database keeps
/// the tier rules whoever writes; and the migration. Every name, address and figure is invented.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string N9b1FPlanUrl = "/api/client-plan/me";

    private const string N9b1FAccessUrl = "/api/client-access/me";

    private const string N9b1FFreeRefusal =
        "Free is TB Gym's own plan for people training on their own: it starts and renews by itself, and nobody changes it by hand.";

    /// <summary>A plan for sale written straight into the table, with whatever tier the statement is given.</summary>
    private const string N9b1FInsertProductSql =
        """
        INSERT INTO subscriptions."CoachingProducts" ("Id", "TenantId", "Name", "IsActive", "Kind", "HouseTier")
        VALUES (gen_random_uuid(), @tenant, @name, @active, @kind, @tier)
        """;

    /// <summary>
    /// A copy of one enrollment under a new id and command id, with its tier and its dates as the statement says
    /// (<c>@tier</c> null keeps no tier), so the copy differs from a row the server wrote in that alone.
    /// </summary>
    private const string N9b1FCopyRowSql =
        """
        INSERT INTO subscriptions."ClientEnrollments"
        SELECT (jsonb_populate_record(
            NULL::subscriptions."ClientEnrollments",
            to_jsonb(source) || jsonb_build_object(
                'Id', gen_random_uuid(),
                'AssignmentCommandId', gen_random_uuid(),
                'HouseTier', @tier::text,
                'StartDate', @start::date,
                'EndDateExclusive', @start::date + 365))).*
        FROM subscriptions."ClientEnrollments" AS source
        WHERE source."Id" = @id
        """;

    /// <summary>The two columns, the two triggers and their functions, the two checks, the exclusion and the index.</summary>
    private const string N9b1FSchemaSql =
        """
        SELECT
            (SELECT count(*) FROM information_schema.columns
             WHERE table_schema = 'subscriptions' AND table_name IN ('CoachingProducts', 'ClientEnrollments')
               AND column_name = 'HouseTier')
          + (SELECT count(*) FROM pg_trigger
             WHERE NOT tgisinternal AND tgname IN ('TR_CoachingProducts_HouseTier', 'TR_ClientEnrollments_HouseTier'))
          + (SELECT count(*) FROM pg_proc WHERE proname IN ('guard_product_house_tier', 'guard_enrollment_house_tier'))
          + (SELECT count(*) FROM pg_constraint
             WHERE conname IN ('CK_CoachingProducts_HouseTier', 'CK_ClientEnrollments_HouseTier', 'EX_ClientEnrollments_OneHouseFreeAtATime'))
          + (SELECT count(*) FROM pg_indexes WHERE indexname = 'UX_CoachingProducts_OneHouseFree')
        """;

    private const long N9b1FSchemaObjects = 10;

    /// <summary>Every notice a plan booked by the staff can queue (CommercialNotificationKind's plan kinds).</summary>
    private static readonly string[] N9b1FPlanNotices =
    [
        nameof(TB.Gym.Modules.Notifications.CommercialNotificationKind.PaymentRequired),
        nameof(TB.Gym.Modules.Notifications.CommercialNotificationKind.EnrollmentActivated),
        nameof(TB.Gym.Modules.Notifications.CommercialNotificationKind.EnrollmentEndingSoon),
        nameof(TB.Gym.Modules.Notifications.CommercialNotificationKind.EnrollmentExpired),
        nameof(TB.Gym.Modules.Notifications.CommercialNotificationKind.EnrollmentRenewed),
    ];

    private static readonly CoachingFeature[] N9b1FTrainingAlone = [CoachingFeature.Training];

    // ---------- 1. the house command makes Free ----------

    [TestMethod]
    public async Task N9b1FreeMarkingTheHouseMakesItsFreePlanOnceAndAPlanOfItsOwnCalledFreeStopsTheMarkUntilRenamed()
    {
        N9b1FStartAtMidday();
        using var owner = CreateClient();
        var spaceId = await RegisterCoachAsync(owner, "n9b1f-mark-owner@example.test", "Nour Haddad", "N9b1 Mark Space");
        var slug = await N9a1SlugAsync(owner, spaceId);
        // The space bills in euros, not the dollars every test workspace registers with, so Free's option shows it
        // takes the house's own currency.
        await N9b1FSetCurrencyAsync(owner, "EUR");

        // The space already sells a plan of its own called Free (a fortnight of messages at no price). One name is one
        // plan for sale (BILL-7), so the house's Free cannot be made beside it: the command says what to do, exits 2
        // and marks nothing, in the one transaction that would have marked it.
        var theirs = await B4aProductAsync(owner, "Free", B4aOfferRequest(2, 0m, "USD", "Messaging"));
        Assert.AreEqual(
            (2, $"N9b1 Mark Space ({slug}) already sells a plan called Free. Rename that plan in Plans you sell, then run this again: the house's own Free plan takes that name."),
            await N9a1HouseCommandAsync("set", slug));
        Assert.IsEmpty(await N9a1MarkedAsync());
        Assert.IsEmpty(await N9b1FTieredPlansAsync(spaceId));
        Assert.AreEqual((0, "No coaching space is the house."), await N9a1HouseCommandAsync());

        // Renamed, the same command marks the space and makes its Free with the mark: one plan, one option.
        var renamed = await N9b1FRenameAsync(owner, theirs, "Free Fortnight");
        var marked = await N9a1HouseCommandAsync("set", slug);
        Assert.AreEqual(0, marked.Code, marked.Said);
        Assert.Contains($"N9b1 Mark Space ({slug}) is the house.", marked.Said);
        CollectionAssert.AreEqual(new[] { spaceId }, await N9a1MarkedAsync());
        var free = N9b1FAssertFree(await N9b1FTieredPlansAsync(spaceId), "EUR");

        // Marked again, by its slug and by its id: still that one plan with its one option.
        foreach (var again in new[] { slug, spaceId.ToString() })
        {
            var repeated = await N9a1HouseCommandAsync("set", again);
            Assert.AreEqual(0, repeated.Code, $"{again}: {repeated.Said}");
            var same = N9b1FAssertFree(await N9b1FTieredPlansAsync(spaceId), "EUR");
            Assert.AreEqual((free.Plan.Id, free.Option.Id), (same.Plan.Id, same.Option.Id), again);
        }

        // An empty house still clears, as before Free existed, and its Free goes off sale with the mark: the same plan
        // and option, sold to nobody, since an ordinary space sells no plan of the house's.
        Assert.AreEqual((0, $"N9b1 Mark Space ({slug}) is no longer the house."), await N9a1HouseCommandAsync("clear"));
        Assert.IsEmpty(await N9a1MarkedAsync());
        N9b1FAssertOffSale(await N9b1FTieredPlansAsync(spaceId), free);

        // Marked once more, the command finds that Free by its tier, puts the same plan back on sale and makes no other.
        var remarked = await N9a1HouseCommandAsync("set", slug);
        Assert.AreEqual(0, remarked.Code, remarked.Said);
        CollectionAssert.AreEqual(new[] { spaceId }, await N9a1MarkedAsync());
        var reused = N9b1FAssertFree(await N9b1FTieredPlansAsync(spaceId), "EUR");
        Assert.AreEqual((free.Plan.Id, free.Option.Id), (reused.Plan.Id, reused.Option.Id));

        // Cleared again, the name Free is the space's own: its owner sells a plan of their own called Free, and the
        // mark is then refused in the first refusal's words until that plan is renamed, marking nothing and leaving
        // the house's Free off sale.
        Assert.AreEqual((0, $"N9b1 Mark Space ({slug}) is no longer the house."), await N9a1HouseCommandAsync("clear"));
        var ownFree = await B4aProductAsync(owner, "Free", B4aOfferRequest(1, 0m, "EUR", "Messaging"));
        Assert.AreEqual(("Free", (HouseTier?)null, true), (ownFree.Name, ownFree.HouseTier, ownFree.IsActive));
        Assert.AreEqual(
            (2, $"N9b1 Mark Space ({slug}) already sells a plan called Free. Rename that plan in Plans you sell, then run this again: the house's own Free plan takes that name."),
            await N9a1HouseCommandAsync("set", slug));
        Assert.IsEmpty(await N9a1MarkedAsync());
        N9b1FAssertOffSale(await N9b1FTieredPlansAsync(spaceId), free);

        // The staff's own plans are as they left them, for sale and with no tier, listed beside the house's Free.
        var catalog = await ReadSliceAsync<ProductCatalog>(owner, A7ProductsUrl);
        Assert.HasCount(3, catalog.Products);
        var listedFree = catalog.Products.Single(item => item.Id == free.Plan.Id);
        Assert.AreEqual(("Free", (HouseTier?)HouseTier.Free, false), (listedFree.Name, listedFree.HouseTier, listedFree.IsActive));
        var listedTheirs = catalog.Products.Single(item => item.Id == theirs.Id);
        Assert.AreEqual(
            ("Free Fortnight", (HouseTier?)null, true, renamed.Version),
            (listedTheirs.Name, listedTheirs.HouseTier, listedTheirs.IsActive, listedTheirs.Version));
        var listedOwn = catalog.Products.Single(item => item.Id == ownFree.Id);
        Assert.AreEqual(
            ("Free", (HouseTier?)null, true, ownFree.Version),
            (listedOwn.Name, listedOwn.HouseTier, listedOwn.IsActive, listedOwn.Version));
    }

    [TestMethod]
    public async Task N9b1FreeTheHouseKeepsItsMarkWhileAPlanOfItsTiersIsBookedForAClientItInvited()
    {
        var today = N9b1FStartAtMidday();
        using var house = await N9a1OpenHouseAsync("n9b1f-kept");
        var slug = await N9a1SlugAsync(house.Owner, house.TenantId);
        var free = N9b1FAssertFree(await N9b1FTieredPlansAsync(house.TenantId), "USD");

        // A client the house invited, coached and not self-directed, and no sign-up anywhere: none of what held the
        // mark before N9b1. Its staff book that client Pro+ from today.
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(house.Owner, client, "n9b1f-kept-rita@example.test", true);
        var proPlus = await N9b1FProductAsync(house.Owner, "Pro+ Programs", 4, 45m, "ProPlus");
        var booked = await A7EnrollAsync(house.Owner, clientId, proPlus.Offers[0].Id, today);
        Assert.AreEqual((HouseTier?)HouseTier.ProPlus, booked.HouseTier);

        // A plan of a tier is a fact only the house holds, so the mark stays with it: the command says why and changes
        // nothing, and Free stays on sale.
        Assert.AreEqual(
            (2, $"{house.Name} ({slug}) holds plans of the house's tiers and keeps its mark."),
            await N9a1HouseCommandAsync("clear"));
        CollectionAssert.AreEqual(new[] { house.TenantId }, await N9a1MarkedAsync());
        Assert.AreEqual((0, $"{house.Name} ({slug}) is the house."), await N9a1HouseCommandAsync());
        var tiered = await N9b1FTieredPlansAsync(house.TenantId);
        var kept = N9b1FAssertFree([.. tiered.Where(plan => plan.Tier == HouseTier.Free)], "USD");
        Assert.AreEqual((free.Plan.Id, free.Option.Id), (kept.Plan.Id, kept.Option.Id));
        var keptProPlus = tiered.Single(plan => plan.Tier == HouseTier.ProPlus);
        Assert.AreEqual((proPlus.Id, true), (keptProPlus.Id, keptProPlus.IsActive));
        var row = (await N9b1FRowsAsync(clientId)).Single();
        Assert.AreEqual(
            (booked.Id, (HouseTier?)HouseTier.ProPlus, EnrollmentStatus.PendingPayment),
            (row.Id, row.Tier, row.Status));
    }

    // ---------- 2. a trainee starts Free ----------

    [TestMethod]
    public async Task N9b1FreeAConfirmedTraineeStartsFreeOnceFromTheHousesDayIsToldNothingAndReadsIt()
    {
        const string email = "n9b1f-start-dalia@example.test";
        var today = N9b1FStartAtMidday();
        using var house = await N9a1OpenHouseAsync("n9b1f-start");
        var free = N9b1FAssertFree(await N9b1FTieredPlansAsync(house.TenantId), "USD");
        using var person = CreateClient();
        var response = await N9a1SignUpAsync(person, email);
        await AssertStatusAsync(response, HttpStatusCode.Accepted);
        var link = (await RequiredJsonAsync<N9a1Answer>(response)).DevelopmentConfirmationUrl!;
        // While the email waits there is no profile, and so nothing of Free.
        Assert.AreEqual(0L, await A7ScalarAsync("""SELECT count(*) FROM subscriptions."ClientEnrollments" """));

        // The link opened in two tabs at once: both are answered, one profile is made, and Free starts once (its
        // command id is the profile's own, unique in the house).
        RequiredTestClock.Advance(TimeSpan.FromMinutes(3));
        using var otherTab = CreateClient();
        await RefreshCsrfAsync(person);
        await RefreshCsrfAsync(otherTab);
        var body = N9a1ConfirmationBody(link);
        var answers = await Task.WhenAll(
            person.PostAsJsonAsync("/api/auth/confirm-email", body),
            otherTab.PostAsJsonAsync("/api/auth/confirm-email", body));
        CollectionAssert.AreEqual(N9a1BothConfirmed, answers.Select(item => item.StatusCode).ToArray());
        var profileId = (await N9a1PersonAsync(email)).Profiles.Single().Id;
        var row = (await N9b1FRowsAsync(profileId)).Single();
        Assert.AreEqual(
            (house.TenantId, free.Plan.Id, free.Option.Id, "Free", (HouseTier?)HouseTier.Free, EnrollmentStatus.Active),
            (row.TenantId, row.ProductId, row.OfferId, row.ProductName, row.Tier, row.Status));
        Assert.AreEqual(
            (today, today.AddDays(365), 0m, "USD", "Training beside"),
            (row.StartDate, row.EndDateExclusive, row.PriceAmount, row.PriceCurrency, row.Coverage));
        Assert.AreEqual(
            (HouseFreePlanRule.StartCommandId(profileId), (Guid?)null),
            (row.AssignmentCommandId, row.RenewedFromEnrollmentId));

        // The link tapped again an hour on answers alike and adds nothing.
        RequiredTestClock.Advance(TimeSpan.FromHours(1));
        using var again = CreateClient();
        await AssertStatusAsync(await N9a1ConfirmAsync(again, link), HttpStatusCode.NoContent);
        Assert.AreEqual(row, (await N9b1FRowsAsync(profileId)).Single());

        // Free asks for no money, never ends and renews by itself: no plan notice of any kind is queued for it.
        await N9b1FAssertToldNothingAsync(row.Id);

        // Signed in, the trainee may train on Free, and Free covers nothing else.
        await N9a1SignInAsync(person, email);
        SetTenant(person, house.TenantId);
        var access = await ReadSliceAsync<FeatureAccessDecision[]>(person, N9b1FAccessUrl);
        var training = access.Single(item => item.Feature == CoachingFeature.Training);
        Assert.AreEqual(
            (true, FeatureAccessReason.Granted, (Guid?)row.Id),
            (training.IsAllowed, training.Reason, training.EnrollmentId));
        foreach (var other in access.Where(item => item.Feature != CoachingFeature.Training))
        {
            Assert.AreEqual((false, FeatureAccessReason.NoEntitlement), (other.IsAllowed, other.Reason), $"{other.Feature}");
        }

        // My plan lists no plan with a last day: Free stands apart, since the day they joined, and so does the tier.
        var plans = await ReadSliceAsync<OwnPlansView>(person, N9b1FPlanUrl);
        Assert.AreEqual(today, plans.Today);
        Assert.IsEmpty(plans.Plans);
        Assert.AreEqual(HouseTier.Free, plans.Tier);
        Assert.IsNotNull(plans.Free);
        Assert.AreEqual(("Free", today, EffectiveEnrollmentStatus.Active), (plans.Free.Name, plans.Free.Since, plans.Free.Status));
        CollectionAssert.AreEqual(N9b1FTrainingAlone, plans.Free.Features.ToArray());

        // These fields and no others, Free's own among them: a trainee reads every one, and Free tells no end date.
        using (var document = JsonDocument.Parse(await person.GetStringAsync(N9b1FPlanUrl)))
        {
            Assert.AreEqual("coachName,free,plans,renewal,tier,today", B10aFieldNames(document.RootElement));
            Assert.AreEqual("features,name,since,status", B10aFieldNames(document.RootElement.GetProperty("free")));
        }

        // Free is never the plan to renew (SUB-014): even in its own last days, with no sweep run to renew it, the
        // trainee is offered no ask about it and a request finds nothing to ask about, so no money ask about a plan at
        // no price reaches the staff. Training still stands on Free meanwhile.
        N9b1FSetHouseDay(row.EndDateExclusive.AddDays(-2));
        var renewal = await ReadSliceAsync<RenewalStatusView>(person, B13RenewalUrl);
        Assert.AreEqual(
            (false, false, (DateOnly?)null, (Guid?)null),
            (renewal.PlanEnded, renewal.CanAsk, renewal.EndsOn, renewal.PlanId));
        await RefreshCsrfAsync(person);
        Assert.AreEqual("plan_not_ended", (await A7ConflictAsync(await person.PostAsync("/api/client-renewal/me/requests", null))).Code);
        await N9b1FAssertTrainingAsync(person, row.Id);
    }

    [TestMethod]
    public async Task N9b1FreeASignedInJoinStartsFreeOnceAndTheCoachsOwnSpaceReadsNoTierAndNoFree()
    {
        const string email = "n9b1f-join-karim@example.test";
        var today = N9b1FStartAtMidday();
        using var house = await N9a1OpenHouseAsync("n9b1f-join");
        using var coach = CreateClient();
        var coachesSpace = await RegisterCoachAsync(coach, "n9b1f-join-zeina@example.test", "Zeina Aoun", "N9b1 Join Zeina Gym");
        using var client = CreateClient();
        var coachedId = await InviteAndAcceptAsync(coach, client, email, true);
        var coaching = await B4aProductAsync(coach, "Online Coaching", B4aOfferRequest(4, 0m, "USD", "Training", "Messaging"));
        var coachesPlan = await A7EnrollAsync(coach, coachedId, coaching.Offers[0].Id, today);

        // A coach's client, signed in with the coach's space in their header, joins the house with the signed-in form.
        var response = await N9a1SignUpAsync(client, email, "Karim", "Nassar", "1990-12-05", withPassword: false);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        Assert.IsTrue((await RequiredJsonAsync<N9a1Answer>(response)).Joined);
        var houseProfileId = (await N9a1PersonAsync(email)).Profiles.Single(item => item.TenantId == house.TenantId).Id;
        var free = (await N9b1FRowsAsync(houseProfileId)).Single();
        Assert.AreEqual(
            (house.TenantId, (HouseTier?)HouseTier.Free, EnrollmentStatus.Active, today, today.AddDays(365)),
            (free.TenantId, free.Tier, free.Status, free.StartDate, free.EndDateExclusive));
        Assert.AreEqual(HouseFreePlanRule.StartCommandId(houseProfileId), free.AssignmentCommandId);
        await N9b1FAssertToldNothingAsync(free.Id);

        // The coach's own record of them holds the coach's plan alone: Free belongs to the house's record.
        var coached = (await N9b1FRowsAsync(coachedId)).Single();
        Assert.AreEqual((coachesPlan.Id, (HouseTier?)null), (coached.Id, coached.Tier));

        // Asked again, they are told they joined already, and Free is still the one row.
        var twice = await N9a1SignUpAsync(client, email, withPassword: false);
        Assert.AreEqual("trainee_already_joined", (await N9a1AnswerAsync(twice, HttpStatusCode.Conflict)).Code);
        Assert.AreEqual(free, (await N9b1FRowsAsync(houseProfileId)).Single());

        // Under the coach's header, My plan has no tier and no Free: only the coach's plan, which grants Training there.
        SetTenant(client, coachesSpace);
        var there = await ReadSliceAsync<OwnPlansView>(client, N9b1FPlanUrl);
        Assert.AreEqual(((HouseTier?)null, (OwnFreePlanView?)null), (there.Tier, there.Free));
        Assert.AreEqual(coachesPlan.Id, there.Plans.Single().Id);
        var thereTraining = await N9b1FTrainingAsync(client);
        Assert.AreEqual((true, (Guid?)coachesPlan.Id), (thereTraining.IsAllowed, thereTraining.EnrollmentId));

        // Under the house's, Free and its tier, and no plan of the coach's.
        SetTenant(client, house.TenantId);
        var here = await ReadSliceAsync<OwnPlansView>(client, N9b1FPlanUrl);
        Assert.AreEqual(HouseTier.Free, here.Tier);
        Assert.IsEmpty(here.Plans);
        Assert.IsNotNull(here.Free);
        Assert.AreEqual(("Free", today, EffectiveEnrollmentStatus.Active), (here.Free.Name, here.Free.Since, here.Free.Status));
        await N9b1FAssertTrainingAsync(client, free.Id);
    }

    [TestMethod]
    public async Task N9b1FreeAHouseMarkedBeforeFreeExistedMakesItAtItsFirstConfirmationOnceEvenWithTwoAtOnce()
    {
        const string rimasEmail = "n9b1f-early-rima@example.test";
        const string tareksEmail = "n9b1f-early-tarek@example.test";
        var today = N9b1FStartAtMidday();
        using var owner = CreateClient();
        var houseId = await RegisterCoachAsync(owner, "n9b1f-early-owner@example.test", "Nour Haddad", "N9b1 Early House");
        // Marked by hand, as a house marked before N9b1 was: open for sign-up, with no Free plan yet and nothing in its way.
        await Phase6ExecuteAsync(N9a1MarkSql, ("mark", true), ("id", houseId));
        using var admin = await SignInPlatformAdminAsync("n9b1f-early-admin@example.test");
        await N9a1SettingAsync(admin, N9a1PlacesSetting, N9a1Places);
        await N9a1SettingAsync(admin, N9a1AgeSetting, N9a1Age);
        Assert.IsEmpty(await N9b1FTieredPlansAsync(houseId));

        // Two people sign up, each from an address of their own, and confirm their emails at the same moment.
        using var rima = CreateClient();
        rima.DefaultRequestHeaders.Add("X-Test-Remote-Ip", "198.51.100.71");
        using var tarek = CreateClient();
        tarek.DefaultRequestHeaders.Add("X-Test-Remote-Ip", "198.51.100.72");
        var rimasLink = (await N9a1AnswerAsync(await N9a1SignUpAsync(rima, rimasEmail, "Rima", "Daou"), HttpStatusCode.Accepted))
            .DevelopmentConfirmationUrl!;
        var tareksLink = (await N9a1AnswerAsync(await N9a1SignUpAsync(tarek, tareksEmail, "Tarek", "Mrad"), HttpStatusCode.Accepted))
            .DevelopmentConfirmationUrl!;
        await RefreshCsrfAsync(rima);
        await RefreshCsrfAsync(tarek);
        var answers = await Task.WhenAll(
            rima.PostAsJsonAsync("/api/auth/confirm-email", N9a1ConfirmationBody(rimasLink)),
            tarek.PostAsJsonAsync("/api/auth/confirm-email", N9a1ConfirmationBody(tareksLink)));
        CollectionAssert.AreEqual(N9a1BothConfirmed, answers.Select(item => item.StatusCode).ToArray());

        // Whichever confirmation came first made the house's Free under the house's lock; the other found it. Each
        // trainee has one row of that one plan, from today.
        var free = N9b1FAssertFree(await N9b1FTieredPlansAsync(houseId), "USD");
        foreach (var email in new[] { rimasEmail, tareksEmail })
        {
            var profileId = (await N9a1PersonAsync(email)).Profiles.Single().Id;
            var row = (await N9b1FRowsAsync(profileId)).Single();
            Assert.AreEqual(
                (free.Plan.Id, free.Option.Id, EnrollmentStatus.Active, today, HouseFreePlanRule.StartCommandId(profileId)),
                (row.ProductId, row.OfferId, row.Status, row.StartDate, row.AssignmentCommandId),
                email);
        }

        // The command run on the house afterwards, as whoever deploys N9b1 may, finds that Free and makes no other.
        var again = await N9a1HouseCommandAsync("set", houseId.ToString());
        Assert.AreEqual(0, again.Code, again.Said);
        var after = N9b1FAssertFree(await N9b1FTieredPlansAsync(houseId), "USD");
        Assert.AreEqual((free.Plan.Id, free.Option.Id), (after.Plan.Id, after.Option.Id));
    }

    // ---------- 3. Free under a paid plan ----------

    [TestMethod]
    public async Task N9b1FreeAPaidProPlusPlanRaisesTheTierOnlyWhilePaidAndFreeRunsOnUnderIt()
    {
        var today = N9b1FStartAtMidday();
        using var house = await N9a1OpenHouseAsync("n9b1f-tier");
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9b1f-tier-maya@example.test", "Maya", "Rahman");
        var free = (await N9b1FRowsAsync(trainee.ProfileId)).Single();

        // The house's staff sell Pro+, four weeks of programs for 45 USD, and book it for the trainee from today.
        var proPlus = await N9b1FProductAsync(house.Owner, "Pro+ Programs", 4, 45m, "ProPlus");
        Assert.AreEqual(HouseTier.ProPlus, proPlus.HouseTier);
        var plan = await A7EnrollAsync(house.Owner, trainee.ProfileId, proPlus.Offers[0].Id, today);
        Assert.AreEqual((EnrollmentStatus.PendingPayment, (HouseTier?)HouseTier.ProPlus), (plan.StoredStatus, plan.HouseTier));
        // A booking by the staff queues its notices as any plan's does: the count that finds none for Free finds this.
        Assert.AreEqual(1L, await N9a1QueuedAsync("PaymentRequired", "AggregateId", plan.Id));

        // Unpaid, it raises nothing: the tier is Free, and Free grants Training.
        var unpaid = await ReadSliceAsync<OwnPlansView>(trainee.Client, N9b1FPlanUrl);
        Assert.AreEqual(HouseTier.Free, unpaid.Tier);
        Assert.AreEqual((plan.Id, EffectiveEnrollmentStatus.PendingPayment), (unpaid.Plans.Single().Id, unpaid.Plans.Single().Status));
        Assert.AreEqual(EffectiveEnrollmentStatus.Active, unpaid.Free!.Status);
        await N9b1FAssertTrainingAsync(trainee.Client, free.Id);

        // Paid in full, the tier is Pro+, and the Training decision names the paid plan and its days, while Free runs on.
        await A7PayAsync(house.Owner, plan.Id, 45m, today, Guid.NewGuid());
        var paid = await ReadSliceAsync<OwnPlansView>(trainee.Client, N9b1FPlanUrl);
        Assert.AreEqual(HouseTier.ProPlus, paid.Tier);
        Assert.AreEqual(("Free", today, EffectiveEnrollmentStatus.Active), (paid.Free!.Name, paid.Free.Since, paid.Free.Status));
        var training = await N9b1FAssertTrainingAsync(trainee.Client, plan.Id);
        Assert.AreEqual(
            ((DateOnly?)today, (DateOnly?)today.AddDays(28)),
            (training.AccessibleFrom, training.AccessibleUntilExclusive));

        // The house's staff read the paid plan as the trainee's plan, by its name and its last day, though Free runs
        // eleven months longer, and Free is no other plan to count.
        await N9b1FAssertStaffReadAsync(house.Owner, trainee.ProfileId, plan.Id, "Pro+ Programs", today.AddDays(27));

        // Free covers Training beside a plan, never between two: a second paid Training plan over the same days is
        // refused as before, naming the plan it would overlap.
        var other = await N9b1FProductAsync(house.Owner, "Strength Coaching", 4, 30m, houseTier: null);
        await RefreshCsrfAsync(house.Owner);
        var overlap = await house.Owner.PostAsJsonAsync(
            $"/api/commercial/clients/{trainee.ProfileId}/enrollments",
            new { offerId = other.Offers[0].Id, startDate = N9a1Day(today.AddDays(7)), idempotencyKey = Guid.NewGuid() });
        var (code, message) = await A7ConflictAsync(overlap);
        Assert.AreEqual("entitlement_overlap", code);
        Assert.StartsWith("Maya already has Pro+ Programs from", message);

        // From the paid plan's exclusive end the tier is Free again, and Free still grants Training.
        N9b1FSetHouseDay(today.AddDays(28));
        var ended = await ReadSliceAsync<OwnPlansView>(trainee.Client, N9b1FPlanUrl);
        Assert.AreEqual(HouseTier.Free, ended.Tier);
        Assert.AreEqual(EffectiveEnrollmentStatus.Active, ended.Free!.Status);
        await N9b1FAssertTrainingAsync(trainee.Client, free.Id);
        CollectionAssert.AreEquivalent(
            new[] { free.Id, plan.Id },
            (await N9b1FRowsAsync(trainee.ProfileId)).Select(item => item.Id).ToArray(),
            "Free and Pro+, and the refused plan written nowhere.");
    }

    [TestMethod]
    public async Task N9b1FreeASessionPackBesideFreeIsThePlanTheHousesStaffRead()
    {
        var today = N9b1FStartAtMidday();
        using var house = await N9a1OpenHouseAsync("n9b1f-pack");
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9b1f-pack-hadi@example.test", "Hadi", "Zein");
        var free = (await N9b1FRowsAsync(trainee.ProfileId)).Single();

        // The staff book ten sessions over ninety days at no price, from today: a pack and Free, and nothing else.
        var product = await B10bPackProductAsync(house.Owner, "Personal training", B10bPackOffer(10, 90, 0m));
        var pack = await A7EnrollAsync(house.Owner, trainee.ProfileId, product.Offers[0].Id, today);
        Assert.AreEqual(EnrollmentStatus.Active, pack.StoredStatus);

        // The row and the page name the pack and its last day, never Free, whose year runs on beyond it, and Free is no
        // other plan to count. Training still stands on Free, which the pack does not cover.
        await N9b1FAssertStaffReadAsync(house.Owner, trainee.ProfileId, pack.Id, "Personal training", today.AddDays(89));
        await N9b1FAssertTrainingAsync(trainee.Client, free.Id);
    }

    // ---------- 4. the sweep renews Free ----------

    [TestMethod]
    public async Task N9b1FreeTheSweepRenewsTheLastRowThirtyDaysBeforeItEndsFromItsEndOnceEvenWithTwoSweepsAtOnce()
    {
        var today = N9b1FStartAtMidday();
        using var house = await N9a1OpenHouseAsync("n9b1f-renew");
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9b1f-renew-sami@example.test", "Sami", "Khalil");
        var first = (await N9b1FRowsAsync(trainee.ProfileId)).Single();
        Assert.AreEqual(today.AddDays(365), first.EndDateExclusive);

        // Thirty-one days before the row ends it is not due.
        N9b1FSetHouseDay(first.EndDateExclusive.AddDays(-31));
        Assert.AreEqual(new HouseFreePlanRenewalResult(0, 0, 0), await N9b1FSweepAsync());
        Assert.AreEqual(first, (await N9b1FRowsAsync(trainee.ProfileId)).Single());

        // Thirty days before, it is: one new row from the day the first ends (half-open, so no gap and no overlap),
        // linked to it, under the command id that row alone has, and still told nothing.
        N9b1FSetHouseDay(first.EndDateExclusive.AddDays(-30));
        Assert.AreEqual(new HouseFreePlanRenewalResult(0, 1, 0), await N9b1FSweepAsync());
        var rows = await N9b1FRowsAsync(trainee.ProfileId);
        Assert.HasCount(2, rows);
        Assert.AreEqual(first, rows[0], "The first row is as it was.");
        var second = rows[1];
        Assert.AreEqual(
            (first.ProductId, first.OfferId, (HouseTier?)HouseTier.Free, EnrollmentStatus.Active, 0m, "Training beside"),
            (second.ProductId, second.OfferId, second.Tier, second.Status, second.PriceAmount, second.Coverage));
        Assert.AreEqual(
            (first.EndDateExclusive, first.EndDateExclusive.AddDays(365), (Guid?)first.Id, HouseFreePlanRule.RenewalCommandId(first.Id)),
            (second.StartDate, second.EndDateExclusive, second.RenewedFromEnrollmentId, second.AssignmentCommandId));
        await N9b1FAssertToldNothingAsync(second.Id);

        // A second sweep finds nothing left to do.
        Assert.AreEqual(new HouseFreePlanRenewalResult(0, 0, 0), await N9b1FSweepAsync());
        Assert.HasCount(2, await N9b1FRowsAsync(trainee.ProfileId));

        // On the renewed row's first day the trainee still reads Free since the day they joined, granted by the new row.
        N9b1FSetHouseDay(second.StartDate);
        var plans = await ReadSliceAsync<OwnPlansView>(trainee.Client, N9b1FPlanUrl);
        Assert.AreEqual(HouseTier.Free, plans.Tier);
        Assert.IsEmpty(plans.Plans);
        Assert.AreEqual(("Free", today, EffectiveEnrollmentStatus.Active), (plans.Free!.Name, plans.Free.Since, plans.Free.Status));
        await N9b1FAssertTrainingAsync(trainee.Client, second.Id);

        // When that row is due, two sweeps at once (two Workers) leave one more row: the second waits for the house's
        // lock and then finds the first's.
        N9b1FSetHouseDay(second.EndDateExclusive.AddDays(-30));
        var both = await Task.WhenAll(N9b1FSweepAsync(), N9b1FSweepAsync());
        Assert.AreEqual(
            (0, 1, 0),
            (both.Sum(item => item.Started), both.Sum(item => item.Renewed), both.Sum(item => item.Skipped)));
        rows = await N9b1FRowsAsync(trainee.ProfileId);
        Assert.HasCount(3, rows);
        Assert.AreEqual(
            (second.EndDateExclusive, (Guid?)second.Id, HouseFreePlanRule.RenewalCommandId(second.Id), EnrollmentStatus.Active),
            (rows[2].StartDate, rows[2].RenewedFromEnrollmentId, rows[2].AssignmentCommandId, rows[2].Status));

        // The Worker's own loop runs this sweep beside the sign-up sweep as it starts.
        var third = rows[2];
        N9b1FSetHouseDay(third.EndDateExclusive.AddDays(-30));
        using var worker = new TB.Gym.Worker.TraineeSignUpSweepWorker(
            RequiredFactory.Services.GetRequiredService<IServiceScopeFactory>(),
            Microsoft.Extensions.Options.Options.Create(new TB.Gym.Modules.Tenancy.TraineeSignUpOptions { SweepIntervalSeconds = 3_600 }),
            RequiredFactory.Services.GetRequiredService<ILogger<TB.Gym.Worker.TraineeSignUpSweepWorker>>());
        await worker.StartAsync(CancellationToken.None);
        try
        {
            // Real time only bounds the wait here; the house's days come from the test clock.
            var waited = System.Diagnostics.Stopwatch.StartNew();
            while ((await N9b1FRowsAsync(trainee.ProfileId)).Length < 4 && waited.Elapsed < TimeSpan.FromSeconds(30))
            {
                await Task.Delay(100);
            }
        }
        finally
        {
            await worker.StopAsync(CancellationToken.None);
        }

        // Only the Worker swept since the third row was written, so a fourth row is its work.
        rows = await N9b1FRowsAsync(trainee.ProfileId);
        Assert.HasCount(4, rows, "The Worker renewed the due row as it started.");
        Assert.AreEqual((third.EndDateExclusive, (Guid?)third.Id), (rows[3].StartDate, rows[3].RenewedFromEnrollmentId));
        Assert.DoesNotContain("The Free plan sweep failed", RequiredEveryLogLine.Text);
    }

    [TestMethod]
    public async Task N9b1FreeTheSweepRenewsABlockedTraineeAndNeverOneWhoLeft()
    {
        const string leosEmail = "n9b1f-who-leo@example.test";
        var today = N9b1FStartAtMidday();
        using var house = await N9a1OpenHouseAsync("n9b1f-who");
        using var bea = await N9a1TraineeAsync(house.TenantId, "n9b1f-who-bea@example.test", "Bea", "Saliba", address: "203.0.113.51");
        using var leo = await N9a1TraineeAsync(house.TenantId, leosEmail, "Leo", "Haddad", address: "203.0.113.52");
        using var mia = await N9a1TraineeAsync(house.TenantId, "n9b1f-who-mia@example.test", "Mia", "Karam", address: "203.0.113.53");
        var beasFree = (await N9b1FRowsAsync(bea.ProfileId)).Single();
        var leosFree = (await N9b1FRowsAsync(leo.ProfileId)).Single();
        var miasFree = (await N9b1FRowsAsync(mia.ProfileId)).Single();
        Assert.AreEqual((today, today, today), (beasFree.StartDate, leosFree.StartDate, miasFree.StartDate));

        // The house blocks Bea. A block decides access, not the plan: Training and the tier close, and Free itself is
        // left as it was, reading Blocked.
        await B4aSetBlockedAsync(house.Owner, bea.ProfileId, blocked: true);
        var blocked = await ReadSliceAsync<OwnPlansView>(bea.Client, N9b1FPlanUrl);
        Assert.AreEqual(((HouseTier?)null, EffectiveEnrollmentStatus.Blocked), (blocked.Tier, blocked.Free!.Status));
        var closed = await N9b1FTrainingAsync(bea.Client);
        Assert.AreEqual((false, FeatureAccessReason.RelationshipBlocked), (closed.IsAllowed, closed.Reason));
        Assert.AreEqual(beasFree, (await N9b1FRowsAsync(bea.ProfileId)).Single());

        // Leo leaves: Free ends with the relationship, the one way it ends.
        await N9a1LeaveAsync(leo.Client, "Training at another gym for a while");
        var left = (await N9b1FRowsAsync(leo.ProfileId)).Single();
        Assert.AreEqual((leosFree.Id, EnrollmentStatus.Cancelled), (left.Id, left.Status));
        Assert.IsNotNull((await N9a1PersonAsync(leosEmail)).Profiles.Single().ReleasedAtUtc);

        // When the three rows are due, the sweep renews Bea's, blocked or not, and Mia's, and writes nothing for Leo.
        N9b1FSetHouseDay(beasFree.EndDateExclusive.AddDays(-30));
        Assert.AreEqual(new HouseFreePlanRenewalResult(0, 2, 0), await N9b1FSweepAsync());
        var beas = await N9b1FRowsAsync(bea.ProfileId);
        Assert.HasCount(2, beas);
        Assert.AreEqual(
            (beasFree.EndDateExclusive, (Guid?)beasFree.Id, EnrollmentStatus.Active, (HouseTier?)HouseTier.Free),
            (beas[1].StartDate, beas[1].RenewedFromEnrollmentId, beas[1].Status, beas[1].Tier));
        Assert.AreEqual(left, (await N9b1FRowsAsync(leo.ProfileId)).Single(), "Nothing was written for the trainee who left.");

        // Mia leaves once her next row is booked: the row running and the one still to come both end with her, so a
        // released profile keeps no Free that would start later.
        var miasRenewal = (await N9b1FRowsAsync(mia.ProfileId))[1];
        Assert.AreEqual(((Guid?)miasFree.Id, EnrollmentStatus.Active), (miasRenewal.RenewedFromEnrollmentId, miasRenewal.Status));
        await N9a1LeaveAsync(mia.Client, "Moving to another city");
        var miasRows = await N9b1FRowsAsync(mia.ProfileId);
        Assert.AreEqual(
            ((miasFree.Id, EnrollmentStatus.Cancelled), (miasRenewal.Id, EnrollmentStatus.Cancelled)),
            ((miasRows[0].Id, miasRows[0].Status), (miasRows[1].Id, miasRows[1].Status)));
        Assert.HasCount(2, miasRows);

        // Nor, on the day Leo's and Mia's first rows end, is either renewed or started again: they were released.
        N9b1FSetHouseDay(leosFree.EndDateExclusive);
        Assert.AreEqual(new HouseFreePlanRenewalResult(0, 0, 0), await N9b1FSweepAsync());
        Assert.AreEqual(left, (await N9b1FRowsAsync(leo.ProfileId)).Single());
        CollectionAssert.AreEqual(miasRows, await N9b1FRowsAsync(mia.ProfileId));

        // The block lifted, Bea finds Free in place on the renewed row, and her tier with it.
        await B4aSetBlockedAsync(house.Owner, bea.ProfileId, blocked: false);
        var unblocked = await ReadSliceAsync<OwnPlansView>(bea.Client, N9b1FPlanUrl);
        Assert.AreEqual((HouseTier?)HouseTier.Free, unblocked.Tier);
        Assert.AreEqual(("Free", today, EffectiveEnrollmentStatus.Active), (unblocked.Free!.Name, unblocked.Free.Since, unblocked.Free.Status));
        await N9b1FAssertTrainingAsync(bea.Client, beas[1].Id);
    }

    [TestMethod]
    public async Task N9b1FreeARowThatEndedUnrenewedIsNoPlanToAskAboutAndTheSweepRenewsItFromItsOwnEnd()
    {
        var today = N9b1FStartAtMidday();
        using var house = await N9a1OpenHouseAsync("n9b1f-lapsed");
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9b1f-lapsed-nadim@example.test", "Nadim", "Farah");
        var first = (await N9b1FRowsAsync(trainee.ProfileId)).Single();

        // No sweep ran through the row's last month (the Worker was down): ten days past its exclusive end, Training
        // has ended with it, and My plan reads no Free and no tier, since no row of Free covers the day.
        N9b1FSetHouseDay(first.EndDateExclusive.AddDays(10));
        var lapsed = await N9b1FTrainingAsync(trainee.Client);
        Assert.AreEqual(
            (false, FeatureAccessReason.Expired, (Guid?)first.Id),
            (lapsed.IsAllowed, lapsed.Reason, lapsed.EnrollmentId));
        var lapsedPlans = await ReadSliceAsync<OwnPlansView>(trainee.Client, N9b1FPlanUrl);
        Assert.AreEqual(((HouseTier?)null, (OwnFreePlanView?)null), (lapsedPlans.Tier, lapsedPlans.Free));

        // Ended as it is, Free is still no plan to ask about (SUB-014): the trainee is offered no ask, and a request
        // is refused as one with no plan ended, storing nothing for the staff to read.
        var renewal = await ReadSliceAsync<RenewalStatusView>(trainee.Client, B13RenewalUrl);
        Assert.AreEqual(
            (false, false, (DateOnly?)null, (Guid?)null),
            (renewal.PlanEnded, renewal.CanAsk, renewal.EndedOn, renewal.PlanId));
        await RefreshCsrfAsync(trainee.Client);
        Assert.AreEqual(
            "plan_not_ended",
            (await A7ConflictAsync(await trainee.Client.PostAsync("/api/client-renewal/me/requests", null))).Code);
        Assert.AreEqual(
            0L,
            await Phase6CountAsync(
                RequiredDatabaseConnection,
                """SELECT count(*) FROM subscriptions."RenewalRequests" WHERE "ClientProfileId" = @id""",
                trainee.ProfileId));

        // The next sweep renews the row all the same, from its own exclusive end, so the new row covers the days since
        // it lapsed and the year on: one row, linked to it, told nothing.
        Assert.AreEqual(new HouseFreePlanRenewalResult(0, 1, 0), await N9b1FSweepAsync());
        var rows = await N9b1FRowsAsync(trainee.ProfileId);
        Assert.HasCount(2, rows);
        Assert.AreEqual(first, rows[0], "The ended row is as it was.");
        Assert.AreEqual(
            (first.EndDateExclusive, first.EndDateExclusive.AddDays(365), (Guid?)first.Id, HouseFreePlanRule.RenewalCommandId(first.Id)),
            (rows[1].StartDate, rows[1].EndDateExclusive, rows[1].RenewedFromEnrollmentId, rows[1].AssignmentCommandId));
        Assert.AreEqual(((HouseTier?)HouseTier.Free, EnrollmentStatus.Active), (rows[1].Tier, rows[1].Status));
        await N9b1FAssertToldNothingAsync(rows[1].Id);

        // Training is granted again, by the new row, and My plan reads Free since the day the trainee joined.
        await N9b1FAssertTrainingAsync(trainee.Client, rows[1].Id);
        var plans = await ReadSliceAsync<OwnPlansView>(trainee.Client, N9b1FPlanUrl);
        Assert.AreEqual(HouseTier.Free, plans.Tier);
        Assert.AreEqual(("Free", today, EffectiveEnrollmentStatus.Active), (plans.Free!.Name, plans.Free.Since, plans.Free.Status));
    }

    [TestMethod]
    public async Task N9b1FreeTheWorkerRenewsFreeWithTheSignUpSweepSwitchedOffAndRemovesNoSignUp()
    {
        const string waitingEmail = "n9b1f-off-omar@example.test";
        N9b1FStartAtMidday();
        using var house = await N9a1OpenHouseAsync("n9b1f-off");
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9b1f-off-lina@example.test", "Lina", "Saad", address: "203.0.113.81");
        var first = (await N9b1FRowsAsync(trainee.ProfileId)).Single();
        // Somebody else signs up and never confirms their email.
        using var visitor = CreateClient();
        visitor.DefaultRequestHeaders.Add("X-Test-Remote-Ip", "203.0.113.82");
        await AssertStatusAsync(await N9a1SignUpAsync(visitor, waitingEmail, "Omar", "Saleh"), HttpStatusCode.Accepted);

        // Thirty days before the trainee's row ends: Free is due, and the waiting sign-up is long past the days it is
        // kept, so a sign-up sweep that ran would remove it.
        N9b1FSetHouseDay(first.EndDateExclusive.AddDays(-30));
        using var worker = new TB.Gym.Worker.TraineeSignUpSweepWorker(
            RequiredFactory.Services.GetRequiredService<IServiceScopeFactory>(),
            Microsoft.Extensions.Options.Options.Create(new TB.Gym.Modules.Tenancy.TraineeSignUpOptions { SweepEnabled = false }),
            RequiredFactory.Services.GetRequiredService<ILogger<TB.Gym.Worker.TraineeSignUpSweepWorker>>());
        await worker.StartAsync(CancellationToken.None);
        try
        {
            // Real time only bounds the wait here; the house's days come from the test clock.
            var waited = System.Diagnostics.Stopwatch.StartNew();
            while ((await N9b1FRowsAsync(trainee.ProfileId)).Length < 2 && waited.Elapsed < TimeSpan.FromSeconds(30))
            {
                await Task.Delay(100);
            }
        }
        finally
        {
            await worker.StopAsync(CancellationToken.None);
        }

        // Switched off, the sign-up sweep stops nothing of Free's: the Worker renewed the row on its first tick, after
        // the place where the sign-up sweep would have run, and says that it runs on.
        var rows = await N9b1FRowsAsync(trainee.ProfileId);
        Assert.HasCount(2, rows, "The Worker renewed the due row with the sign-up sweep switched off.");
        Assert.AreEqual(
            (first.EndDateExclusive, (Guid?)first.Id, (HouseTier?)HouseTier.Free, EnrollmentStatus.Active),
            (rows[1].StartDate, rows[1].RenewedFromEnrollmentId, rows[1].Tier, rows[1].Status));
        var log = RequiredEveryLogLine.Text;
        Assert.Contains("The trainee sign-up sweep is disabled by configuration. Free's renewal still runs on every tick.", log);
        Assert.DoesNotContain("The Free plan sweep failed", log);

        // And the sign-up waiting for its email was kept, with its account, though it was due: the sign-up sweep run
        // by hand removes it.
        Assert.AreEqual(1, await N9a1AccountsAsync(waitingEmail));
        var waiting = await N9a1PersonAsync(waitingEmail);
        Assert.AreEqual(((DateTimeOffset?)null, (Guid?)null), (waiting.SignUps.Single().ConfirmedAtUtc, waiting.SignUps.Single().ClientProfileId));
        Assert.DoesNotContain("sign-ups never confirmed were removed", log);
        Assert.AreEqual(new TB.Gym.Modules.Tenancy.TraineeSignUpSweepResult(1, 0), await N9a1SweepAsync());
        Assert.AreEqual(0, await N9a1AccountsAsync(waitingEmail));
    }

    // ---------- 5. the sweep starts Free ----------

    [TestMethod]
    public async Task N9b1FreeTheSweepStartsFreeForATraineeWhoJoinedWithoutItOnceThePlanTakingItsNameIsRenamed()
    {
        const string email = "n9b1f-late-hala@example.test";
        const string ramisEmail = "n9b1f-late-rami@example.test";
        var today = N9b1FStartAtMidday();
        using var house = await N9b1FClashHouseAsync("late");
        var (owner, houseId, theirs) = (house.Owner, house.HouseId, house.Theirs);

        // The confirmation joins the trainee all the same, without Free, and the log says why without saying who. So
        // it does for Rami, who joins just after her.
        using var trainee = await N9a1TraineeAsync(houseId, email, "Hala", "Tannous", address: "203.0.113.41");
        using var rami = await N9a1TraineeAsync(houseId, ramisEmail, "Rami", "Aoun", address: "203.0.113.42");
        Assert.IsEmpty(await N9b1FRowsAsync(trainee.ProfileId));
        Assert.IsEmpty(await N9b1FRowsAsync(rami.ProfileId));
        Assert.IsEmpty(await N9b1FTieredPlansAsync(houseId));
        var log = RequiredEveryLogLine.Text;
        Assert.Contains(
            "A trainee joined the house without Free: the house sells a plan of its own under Free's name. The Free plan sweep starts it once that plan is renamed.",
            log);
        Assert.DoesNotContain(email, log);
        Assert.DoesNotContain(ramisEmail, log);
        var noTraining = await N9b1FTrainingAsync(trainee.Client);
        Assert.AreEqual((false, FeatureAccessReason.NoEntitlement), (noTraining.IsAllowed, noTraining.Reason));
        var none = await ReadSliceAsync<OwnPlansView>(trainee.Client, N9b1FPlanUrl);
        Assert.AreEqual(((HouseTier?)null, (OwnFreePlanView?)null), (none.Tier, none.Free));

        // The sweep cannot make Free either while that name is taken: it writes nothing and leaves both trainees for
        // later.
        Assert.AreEqual(new HouseFreePlanRenewalResult(0, 0, 2), await N9b1FSweepAsync());
        Assert.IsEmpty(await N9b1FRowsAsync(trainee.ProfileId));
        Assert.IsEmpty(await N9b1FRowsAsync(rami.ProfileId));
        Assert.IsEmpty(await N9b1FTieredPlansAsync(houseId));
        Assert.Contains(
            "Free plan sweep: the house sells a plan of its own under Free's name, so Free cannot be made; rename that plan.",
            RequiredEveryLogLine.Text);

        // Rami leaves while he waits for Free.
        await N9a1LeaveAsync(rami.Client, "Training at home for now");
        Assert.IsNotNull((await N9a1PersonAsync(ramisEmail)).Profiles.Single().ReleasedAtUtc);

        // Two days on the staff rename their plan, and the next sweep makes Free and starts it from that day for Hala
        // alone: Rami left, and nothing of Free is started for a trainee who left.
        var startDay = today.AddDays(2);
        N9b1FSetHouseDay(startDay);
        await N9b1FRenameAsync(owner, theirs, "Free Fortnight");
        Assert.AreEqual(new HouseFreePlanRenewalResult(1, 0, 0), await N9b1FSweepAsync());
        Assert.IsEmpty(await N9b1FRowsAsync(rami.ProfileId), "No Free row for the trainee who left.");
        var free = N9b1FAssertFree(await N9b1FTieredPlansAsync(houseId), "USD");
        var row = (await N9b1FRowsAsync(trainee.ProfileId)).Single();
        Assert.AreEqual(
            (free.Plan.Id, free.Option.Id, (HouseTier?)HouseTier.Free, EnrollmentStatus.Active, startDay, startDay.AddDays(365)),
            (row.ProductId, row.OfferId, row.Tier, row.Status, row.StartDate, row.EndDateExclusive));
        Assert.AreEqual((HouseFreePlanRule.StartCommandId(trainee.ProfileId), (Guid?)null), (row.AssignmentCommandId, row.RenewedFromEnrollmentId));
        await N9b1FAssertToldNothingAsync(row.Id);

        // Once started there is nothing more to start, and the trainee reads Free since the day the sweep started it.
        Assert.AreEqual(new HouseFreePlanRenewalResult(0, 0, 0), await N9b1FSweepAsync());
        Assert.AreEqual(row, (await N9b1FRowsAsync(trainee.ProfileId)).Single());
        var plans = await ReadSliceAsync<OwnPlansView>(trainee.Client, N9b1FPlanUrl);
        Assert.AreEqual(HouseTier.Free, plans.Tier);
        Assert.AreEqual(("Free", startDay, EffectiveEnrollmentStatus.Active), (plans.Free!.Name, plans.Free.Since, plans.Free.Status));
        await N9b1FAssertTrainingAsync(trainee.Client, row.Id);
    }

    /// <summary>
    /// The warning a join without Free logs carries an event id of its own (the house's events are numbered from 6401):
    /// whoever counts or alerts on the house's log events by id must never read it as a house setting changed, nor a
    /// setting's change as a trainee who joined without Free. The id and the name are compared together, since two
    /// event ids are equal when their numbers are.
    /// </summary>
    [TestMethod]
    public async Task N9b1FreeTheWarningOfAJoinWithoutFreeHasAnEventIdNoOtherHouseEventUses()
    {
        N9b1FStartAtMidday();
        var events = new N9b1FEventLog();
        RequiredFactory.Services.GetRequiredService<ILoggerFactory>().AddProvider(events);
        using var house = await N9b1FClashHouseAsync("event-ids");
        using var trainee = await N9a1TraineeAsync(house.HouseId, "n9b1f-event-ids-hala@example.test", "Hala", "Tannous");
        Assert.AreEqual(new HouseFreePlanRenewalResult(0, 0, 1), await N9b1FSweepAsync());

        // The settings changed twice, the sign-up stored, the join without Free and the sweep that could not make it.
        var houseEvents = events.Logged.Where(item => item.Id is > 6400 and < 6500).Distinct().ToArray();
        foreach (var name in new[] { "HouseSettingChanged", "TraineeSignUpStored", "TraineeFreePlanNameTaken", "HouseFreePlanNameTaken" })
        {
            Assert.IsTrue(houseEvents.Any(item => item.Name == name), $"{name} was logged.");
        }

        var shared = houseEvents
            .GroupBy(item => item.Id)
            .Where(group => group.Count() > 1)
            .Select(group => $"{group.Key} names {string.Join(" and ", group.Select(item => item.Name).Order(StringComparer.Ordinal))}")
            .ToArray();
        Assert.IsEmpty(shared, $"One event id names two of the house's events: {string.Join("; ", shared)}.");
    }

    // ---------- 6. a renewal and a booking at once ----------

    [TestMethod]
    public async Task N9b1FreeARenewalAndAStaffBookingOfAPaidTrainingPlanAtOnceBothStand()
    {
        N9b1FStartAtMidday();
        using var house = await N9a1OpenHouseAsync("n9b1f-race");
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9b1f-race-omar@example.test", "Omar", "Nasser");
        var first = (await N9b1FRowsAsync(trainee.ProfileId)).Single();
        var proPlus = await N9b1FProductAsync(house.Owner, "Pro+ Programs", 4, 45m, "ProPlus");
        var day = first.EndDateExclusive.AddDays(-30);
        N9b1FSetHouseDay(day);

        // The staff book Pro+ from the very day the sweep renews Free. Free covers Training beside any plan and the
        // sweep holds the trainee's row lock only for its own write, so neither refuses the other. The token is
        // refreshed once, before both go out.
        await RefreshCsrfAsync(house.Owner);
        var booking = house.Owner.PostAsJsonAsync(
            $"/api/commercial/clients/{trainee.ProfileId}/enrollments",
            new { offerId = proPlus.Offers[0].Id, startDate = N9a1Day(day), idempotencyKey = Guid.NewGuid() });
        var sweep = N9b1FSweepAsync();
        await Task.WhenAll(booking, sweep);

        await AssertStatusAsync(await booking, HttpStatusCode.OK);
        var plan = await ReadSlicePayloadAsync<ClientEnrollmentView>(await booking);
        Assert.AreEqual(new HouseFreePlanRenewalResult(0, 1, 0), await sweep);
        var rows = await N9b1FRowsAsync(trainee.ProfileId);
        Assert.HasCount(3, rows);
        var renewal = rows.Single(item => item.RenewedFromEnrollmentId == first.Id);
        Assert.AreEqual(
            ((HouseTier?)HouseTier.Free, first.EndDateExclusive, EnrollmentStatus.Active),
            (renewal.Tier, renewal.StartDate, renewal.Status));
        var booked = rows.Single(item => item.Id == plan.Id);
        Assert.AreEqual(
            ((HouseTier?)HouseTier.ProPlus, day, day.AddDays(28), EnrollmentStatus.PendingPayment, "Training alone"),
            (booked.Tier, booked.StartDate, booked.EndDateExclusive, booked.Status, booked.Coverage));
        Assert.AreEqual(first, rows.Single(item => item.Id == first.Id));
    }

    // ---------- 6b. a leave and a renewal at once ----------

    [TestMethod]
    public async Task N9b1FreeALeaveThatWaitsOnTheSweepsRenewalCancelsTheRowTheSweepAdded()
    {
        const string email = "n9b1f-leave-race-yara@example.test";
        N9b1FStartAtMidday();
        using var house = await N9a1OpenHouseAsync("n9b1f-leave-race");
        using var trainee = await N9a1TraineeAsync(house.TenantId, email, "Yara", "Mansour");
        var first = (await N9b1FRowsAsync(trainee.ProfileId)).Single();
        N9b1FSetHouseDay(first.EndDateExclusive.AddDays(-30));

        // The sweep has taken the house's lock and the trainee's row lock and is held at its insert. The trainee leaves
        // meanwhile, and the leave comes to that row lock before it reads their plans, and waits. Only then is the
        // insert let go.
        RequiredInsertBarrier.Arm("subscriptions.\"ClientEnrollments\"", 2);
        HouseFreePlanRenewalResult swept;
        try
        {
            var sweep = N9b1FSweepAsync();
            if (await Task.WhenAny(sweep, RequiredInsertBarrier.ArrivedAsync(1)) == sweep)
            {
                Assert.Fail($"The sweep ended before its insert: {await sweep}.");
            }

            var leave = N9a1LeaveAsync(trainee.Client, "Moving to another city");
            await N9b1FAwaitLockWaitAsync("end-relationship", leave);
            RequiredInsertBarrier.Disarm();
            swept = await sweep;
            await leave;
            Assert.AreEqual(1, RequiredInsertBarrier.Arrived, "Only the sweep's insert was held.");
        }
        finally
        {
            RequiredInsertBarrier.Disarm();
        }

        // The sweep's row committed first, so the leave read it and cancelled it with the row it renews: the trainee
        // who left keeps no Free running, nor one to start later.
        Assert.AreEqual(new HouseFreePlanRenewalResult(0, 1, 0), swept);
        Assert.IsNotNull((await N9a1PersonAsync(email)).Profiles.Single().ReleasedAtUtc);
        var rows = await N9b1FRowsAsync(trainee.ProfileId);
        Assert.HasCount(2, rows);
        Assert.AreEqual(
            (first.Id, (Guid?)first.Id, first.EndDateExclusive),
            (rows[0].Id, rows[1].RenewedFromEnrollmentId, rows[1].StartDate));
        CollectionAssert.AreEqual(
            new[] { EnrollmentStatus.Cancelled, EnrollmentStatus.Cancelled },
            rows.Select(item => item.Status).ToArray(),
            "Every Free row of the trainee who left is cancelled.");

        // And no later sweep writes for them.
        Assert.AreEqual(new HouseFreePlanRenewalResult(0, 0, 0), await N9b1FSweepAsync());
        CollectionAssert.AreEqual(rows, await N9b1FRowsAsync(trainee.ProfileId));
    }

    [TestMethod]
    public async Task N9b1FreeASweepThatWaitsOnALeaveRenewsNothingForTheTraineeWhoLeft()
    {
        const string email = "n9b1f-sweep-race-jad@example.test";
        N9b1FStartAtMidday();
        using var house = await N9a1OpenHouseAsync("n9b1f-sweep-race");
        using var trainee = await N9a1TraineeAsync(house.TenantId, email, "Jad", "Saliba");
        var first = (await N9b1FRowsAsync(trainee.ProfileId)).Single();
        N9b1FSetHouseDay(first.EndDateExclusive.AddDays(-30));

        // The trainee's leave has taken their row lock and is held at the save that cancels their Free. The sweep,
        // which still reads them as a current trainee whose row is due, comes to that row lock meanwhile, and waits.
        // Only then is the save let go.
        RequiredInsertBarrier.Arm("UPDATE subscriptions.\"ClientEnrollments\"", 2, "UPDATE");
        HouseFreePlanRenewalResult swept;
        try
        {
            var leave = N9a1LeaveAsync(trainee.Client, "Training at another gym");
            if (await Task.WhenAny(leave, RequiredInsertBarrier.ArrivedAsync(1)) == leave)
            {
                await leave;
                Assert.Fail("The leave answered before its save was held.");
            }

            var sweep = N9b1FSweepAsync();
            await N9b1FAwaitLockWaitAsync("house-free-plan", sweep);
            RequiredInsertBarrier.Disarm();
            await leave;
            swept = await sweep;
            Assert.AreEqual(1, RequiredInsertBarrier.Arrived, "Only the leave's save was held.");
        }
        finally
        {
            RequiredInsertBarrier.Disarm();
        }

        // The leave committed first, so the sweep read the trainee gone under the lock and wrote nothing for them.
        Assert.AreEqual(new HouseFreePlanRenewalResult(0, 0, 0), swept);
        Assert.IsNotNull((await N9a1PersonAsync(email)).Profiles.Single().ReleasedAtUtc);
        var row = (await N9b1FRowsAsync(trainee.ProfileId)).Single();
        Assert.AreEqual((first.Id, EnrollmentStatus.Cancelled), (row.Id, row.Status));
        Assert.AreEqual(new HouseFreePlanRenewalResult(0, 0, 0), await N9b1FSweepAsync());
        Assert.AreEqual(row, (await N9b1FRowsAsync(trainee.ProfileId)).Single());
    }

    // ---------- 7. no staff route changes Free ----------

    [TestMethod]
    public async Task N9b1FreeNoStaffRouteChangesFreeAndOnlyTheHouseSellsAPlanWithATier()
    {
        var today = N9b1FStartAtMidday();
        using var house = await N9a1OpenHouseAsync("n9b1f-hands", withCoach: true);
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9b1f-hands-lina@example.test", "Lina", "Saad");
        using var rita = CreateClient();
        var ritaId = await R31InviteAsync(house.Coach!, rita, house.TenantId, "n9b1f-hands-rita@example.test", "Rita", "Daher");
        var catalog = await ReadSliceAsync<ProductCatalog>(house.Owner, A7ProductsUrl);
        var freePlan = catalog.Products.Single();
        Assert.AreEqual(("Free", (HouseTier?)HouseTier.Free), (freePlan.Name, freePlan.HouseTier));
        var freeOption = freePlan.Offers.Single();
        var overview = await ReadSliceAsync<ClientCommercialOverview>(house.Owner, $"/api/commercial/clients/{trainee.ProfileId}");
        var freeRow = overview.Enrollments.Single();
        Assert.AreEqual(((HouseTier?)HouseTier.Free, "Free", 0m), (freeRow.HouseTier, freeRow.ProductName, freeRow.PriceAmount));

        // The plan and its option, as the owner edits a plan for sale: renamed or retired, a priced option added, the
        // option retired or repriced.
        await RefreshCsrfAsync(house.Owner);
        var refusals = new List<(string What, HttpResponseMessage Response)>
        {
            ("edit the plan", await house.Owner.PutAsJsonAsync(
                $"{A7ProductsUrl}/{freePlan.Id}",
                new { name = "Free Forever", description = "Edited", isActive = false, version = freePlan.Version })),
            ("add a priced option", await house.Owner.PostAsJsonAsync(
                $"{A7ProductsUrl}/{freePlan.Id}/offers",
                B4aOfferRequest(4, 15m, "USD", "Training"))),
            ("retire the option", await house.Owner.PutAsJsonAsync(
                $"/api/commercial/offers/{freeOption.Id}/availability",
                new { isActive = false, version = freeOption.Version })),
            ("reprice the option", await house.Owner.PostAsJsonAsync(
                $"/api/commercial/offers/{freeOption.Id}/price-changes",
                new { priceAmount = 9.99m, version = freeOption.Version, idempotencyKey = Guid.NewGuid() })),
        };

        // The rows, by the owner and by the Coach the trainee's record names: booking Free for a coached client or
        // for the trainee, renewing it, pausing, resuming and cancelling it, and money taken on it.
        foreach (var (staff, who) in new[] { (house.Owner, "the owner"), (house.Coach!, "the Coach") })
        {
            await RefreshCsrfAsync(staff);
            foreach (var clientId in new[] { ritaId, trainee.ProfileId })
            {
                refusals.Add(($"{who} books Free", await staff.PostAsJsonAsync(
                    $"/api/commercial/clients/{clientId}/enrollments",
                    new { offerId = freeOption.Id, startDate = N9a1Day(today), idempotencyKey = Guid.NewGuid() })));
            }

            var row = $"/api/commercial/enrollments/{freeRow.Id}";
            refusals.Add(($"{who} renews it", await staff.PostAsJsonAsync(
                $"{row}/renew",
                new { offerId = freeOption.Id, startDate = N9a1Day(freeRow.EndDateExclusive), idempotencyKey = Guid.NewGuid() })));
            refusals.Add(($"{who} pauses it", await staff.PostAsJsonAsync(
                $"{row}/pause",
                new { reason = "Away for a month", version = freeRow.Version })));
            refusals.Add(($"{who} resumes it", await staff.PostAsJsonAsync($"{row}/resume", new { version = freeRow.Version })));
            refusals.Add(($"{who} cancels it", await staff.PostAsJsonAsync(
                $"{row}/cancel",
                new { reason = "Asked to stop", version = freeRow.Version })));
            refusals.Add(($"{who} records a payment", await staff.PostAsJsonAsync($"{row}/payments", new
            {
                amount = 10m,
                currencyCode = "USD",
                receivedOn = N9a1Day(today),
                method = "Cash",
                reference = (string?)null,
                note = (string?)null,
                idempotencyKey = Guid.NewGuid(),
            })));
        }

        Assert.HasCount(18, refusals);
        foreach (var (what, refused) in refusals)
        {
            Assert.AreEqual(("house_free_plan", N9b1FFreeRefusal), await A7ConflictAsync(refused), what);
        }

        // Every refusal left Free as it was: the plan, its one option, the trainee's one row, and no row for the coached client.
        var after = (await ReadSliceAsync<ProductCatalog>(house.Owner, A7ProductsUrl)).Products.Single();
        Assert.AreEqual(
            (freePlan.Id, "Free", true, freePlan.Version, (HouseTier?)HouseTier.Free),
            (after.Id, after.Name, after.IsActive, after.Version, after.HouseTier));
        var optionAfter = after.Offers.Single();
        Assert.AreEqual(
            (freeOption.Id, true, 0m, freeOption.Version),
            (optionAfter.Id, optionAfter.IsActive, optionAfter.PriceAmount, optionAfter.Version));
        var rowAfter = (await ReadSliceAsync<ClientCommercialOverview>(house.Owner, $"/api/commercial/clients/{trainee.ProfileId}"))
            .Enrollments.Single();
        Assert.AreEqual(
            (freeRow.Id, EnrollmentStatus.Active, freeRow.Version, 0),
            (rowAfter.Id, rowAfter.StoredStatus, rowAfter.Version, rowAfter.Payments.Count));
        Assert.IsEmpty(await N9b1FRowsAsync(ritaId));

        // A tier on a new plan: Free is never made by hand, and a tier is the house's alone, on a coaching plan alone.
        Assert.AreEqual(
            "Choose Pro+ or Max. Free is TB Gym's own plan, made with its coaching space.",
            await N9b1FTierRefusalAsync(house.Owner, N9b1FProductRequest("Free Again", 4, 0m, "Free"), "houseTier"));
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "n9b1f-hands-zeina@example.test", "Zeina Aoun", "N9b1 Hands Zeina Gym");
        foreach (var tier in new[] { "ProPlus", "Max" })
        {
            Assert.AreEqual(
                "Only TB Gym's own coaching space sells plans with a tier.",
                await N9b1FTierRefusalAsync(coach, N9b1FProductRequest($"Zeina {tier}", 4, 50m, tier), "houseTier"),
                tier);
        }

        Assert.AreEqual(
            "Only a coaching plan carries a tier.",
            await N9b1FTierRefusalAsync(
                house.Owner,
                new { name = "Ten Sessions", kind = "SessionPack", initialOffer = B10bPackOffer(10, 90, 300m), houseTier = "ProPlus" },
                "product"));

        // In the house, Pro+ and Max are sold, and every plan in the list carries its tier: none elsewhere.
        var proPlus = await N9b1FProductAsync(house.Owner, "Pro+ Programs", 4, 45m, "ProPlus");
        var max = await N9b1FProductAsync(house.Owner, "Max Coaching", 4, 120m, "Max");
        var plain = await N9b1FProductAsync(house.Owner, "Gym Floor", 4, 20m, houseTier: null);
        var listed = (await ReadSliceAsync<ProductCatalog>(house.Owner, A7ProductsUrl)).Products.ToDictionary(item => item.Id, item => item.HouseTier);
        Assert.HasCount(4, listed);
        Assert.AreEqual(
            ((HouseTier?)HouseTier.Free, (HouseTier?)HouseTier.ProPlus, (HouseTier?)HouseTier.Max, (HouseTier?)null),
            (listed[freePlan.Id], listed[proPlus.Id], listed[max.Id], listed[plain.Id]));
        await N9b1FProductAsync(coach, "Zeina Coaching", 4, 50m, houseTier: null);
        var elsewhere = (await ReadSliceAsync<ProductCatalog>(coach, A7ProductsUrl)).Products.Single();
        Assert.AreEqual(("Zeina Coaching", (HouseTier?)null), (elsewhere.Name, elsewhere.HouseTier));
    }

    // ---------- 8. no program under Free ----------

    [TestMethod]
    public async Task N9b1FreeAProgramIsNeverPutUnderFreeWhileAPaidPlanTakesIt()
    {
        var today = N9b1FStartAtMidday();
        using var house = await N9a1OpenHouseAsync("n9b1f-program");
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9b1f-program-nadia@example.test", "Nadia", "Fares");
        // The house has no Coach, so the trainee waits for one (N9d1b); the Owner takes them to coach them.
        await ReassignAsync(house.Owner, trainee.ProfileId, house.OwnerUserId, null);
        var free = (await N9b1FRowsAsync(trainee.ProfileId)).Single();
        var squat = await CreateExerciseAsync(house.Owner, "N9b1 Goblet squat", [], []);
        var program = await PublishProgramAsync(house.Owner, N9b1FProgram(squat.Id));
        var blocksUrl = $"/api/training/clients/{trainee.ProfileId}/mesocycles";

        // Free holds the trainee's own workouts, never a program: the coverage itself refuses it, by the plan's field.
        var underFree = await N9b1FAssignAsync(house.Owner, trainee.ProfileId, free.Id, program.Id, today);
        Assert.AreEqual(
            "Free covers a trainee's own workouts, never a program. Choose another plan.",
            await A7FieldErrorAsync(underFree, "enrollmentId"));
        Assert.IsEmpty(await RequiredJsonAsync<N9b1FBlock[]>(await house.Owner.GetAsync(blocksUrl)));

        // The same program under a paid Pro+ plan is assigned, so the refusal was Free's alone.
        var proPlus = await N9b1FProductAsync(house.Owner, "Pro+ Programs", 4, 45m, "ProPlus");
        var plan = await A7EnrollAsync(house.Owner, trainee.ProfileId, proPlus.Offers[0].Id, today);
        await A7PayAsync(house.Owner, plan.Id, 45m, today, Guid.NewGuid());
        var assigned = await N9b1FAssignAsync(house.Owner, trainee.ProfileId, plan.Id, program.Id, today);
        await AssertStatusAsync(assigned, HttpStatusCode.OK);
        Assert.AreEqual(plan.Id, (await RequiredJsonAsync<N9b1FBlock>(assigned)).EnrollmentId);
        Assert.AreEqual(plan.Id, (await RequiredJsonAsync<N9b1FBlock[]>(await house.Owner.GetAsync(blocksUrl))).Single().EnrollmentId);
    }

    // ---------- 9. the database's own guards ----------

    [TestMethod]
    public async Task N9b1FreeTheDatabaseKeepsTiersInTheHouseUnchangedAndOneFreeRowAtATimeWhoeverWrites()
    {
        N9b1FStartAtMidday();
        using var house = await N9a1OpenHouseAsync("n9b1f-guard");
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9b1f-guard-rana@example.test", "Rana", "Aoun");
        var free = (await N9b1FRowsAsync(trainee.ProfileId)).Single();
        var freePlan = N9b1FAssertFree(await N9b1FTieredPlansAsync(house.TenantId), "USD").Plan;
        var plain = await N9b1FProductAsync(house.Owner, "Gym Floor", 4, 20m, houseTier: null);
        using var otherOwner = CreateClient();
        var otherSpace = await RegisterCoachAsync(otherOwner, "n9b1f-guard-zeina@example.test", "Zeina Aoun", "N9b1 Guard Zeina Gym");

        // A plan with a tier written for a space that is not the house.
        var outside = await N9a1RefusedBySqlAsync(
            N9b1FInsertProductSql,
            ("tenant", otherSpace), ("name", "Zeina Max"), ("active", true), ("kind", "CoachingPlan"), ("tier", "Max"));
        Assert.AreEqual(("23514", "Only the house sells plans with a tier"), (outside.SqlState, outside.MessageText));

        // In the house: a second Free plan (not for sale, so BILL-7's name guard has nothing to say), a tier on a
        // session pack, and a tier the house does not sell.
        var secondFree = await N9a1RefusedBySqlAsync(
            N9b1FInsertProductSql,
            ("tenant", house.TenantId), ("name", "Free Again"), ("active", false), ("kind", "CoachingPlan"), ("tier", "Free"));
        Assert.AreEqual(("23505", "UX_CoachingProducts_OneHouseFree"), (secondFree.SqlState, secondFree.ConstraintName));
        foreach (var (kind, tier) in new[] { ("SessionPack", "ProPlus"), ("CoachingPlan", "Pro") })
        {
            var refused = await N9a1RefusedBySqlAsync(
                N9b1FInsertProductSql,
                ("tenant", house.TenantId), ("name", $"House {kind} {tier}"), ("active", true), ("kind", kind), ("tier", tier));
            Assert.AreEqual(("23514", "CK_CoachingProducts_HouseTier"), (refused.SqlState, refused.ConstraintName), $"{kind} {tier}");
        }

        // A plan's tier changed: Free's taken away or raised, and one given to a plan sold without.
        foreach (var (sql, id) in new[]
        {
            ("""UPDATE subscriptions."CoachingProducts" SET "HouseTier" = NULL WHERE "Id" = @id""", freePlan.Id),
            ("""UPDATE subscriptions."CoachingProducts" SET "HouseTier" = 'Max' WHERE "Id" = @id""", freePlan.Id),
            ("""UPDATE subscriptions."CoachingProducts" SET "HouseTier" = 'ProPlus' WHERE "Id" = @id""", plain.Id),
        })
        {
            var changed = await N9a1RefusedBySqlAsync(sql, ("id", id));
            Assert.AreEqual(("55000", "A plan's tier never changes"), (changed.SqlState, changed.MessageText), sql);
        }

        // An enrollment's tier changed: Free's taken away, or another given.
        foreach (var sql in new[]
        {
            """UPDATE subscriptions."ClientEnrollments" SET "HouseTier" = NULL WHERE "Id" = @id""",
            """UPDATE subscriptions."ClientEnrollments" SET "HouseTier" = 'Max' WHERE "Id" = @id""",
        })
        {
            var changed = await N9a1RefusedBySqlAsync(sql, ("id", free.Id));
            Assert.AreEqual(("55000", "Enrollment commercial snapshots are immutable"), (changed.SqlState, changed.MessageText), sql);
        }

        // A row of Free's plan that does not carry Free's tier, on days nobody else covers.
        var untiered = await N9a1RefusedBySqlAsync(
            N9b1FCopyRowSql,
            ("id", free.Id), ("tier", DBNull.Value), ("start", free.EndDateExclusive));
        Assert.AreEqual(("23514", "An enrollment carries its plan's tier"), (untiered.SqlState, untiered.MessageText));

        // A second Free row over days the first covers, written by hand and as the server writes one (Free's plan and
        // option, a command id of its own): the exclusion on Free's rows refuses both.
        var overlapping = await N9a1RefusedBySqlAsync(
            N9b1FCopyRowSql,
            ("id", free.Id), ("tier", "Free"), ("start", free.StartDate.AddDays(100)));
        Assert.AreEqual(("23P01", "EX_ClientEnrollments_OneHouseFreeAtATime"), (overlapping.SqlState, overlapping.ConstraintName));
        await using (var scope = RequiredFactory.Services.CreateAsyncScope())
        {
            scope.ServiceProvider.GetRequiredService<IMutableTenantContext>().SetTenant(house.TenantId);
            var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
            var product = await context.CoachingProducts.SingleAsync(item => item.HouseTier == HouseTier.Free);
            var option = await context.ProductOffers.Include(item => item.Entitlements).SingleAsync(item => item.ProductId == product.Id);
            context.ClientEnrollments.Add(ClientEnrollment.Assign(
                house.TenantId,
                trainee.ProfileId,
                product,
                option,
                free.StartDate.AddDays(200),
                Guid.NewGuid(),
                RequiredTestClock.UtcNow));
            var thrown = await Assert.ThrowsAsync<DbUpdateException>(() => context.SaveChangesAsync());
            var refused = thrown.InnerException as PostgresException
                ?? throw new AssertFailedException($"Expected PostgreSQL's refusal, not {thrown}");
            Assert.AreEqual(("23P01", "EX_ClientEnrollments_OneHouseFreeAtATime"), (refused.SqlState, refused.ConstraintName));
        }

        // Half-open periods: a row from the day the first ends overlaps nothing, as the sweep's renewals rely on.
        await Phase6ExecuteAsync(N9b1FCopyRowSql, ("id", free.Id), ("tier", "Free"), ("start", free.EndDateExclusive));

        // Every refusal left what was there: one Free plan, the trainee's row, and nothing with a tier elsewhere.
        var rows = await N9b1FRowsAsync(trainee.ProfileId);
        Assert.HasCount(2, rows);
        Assert.AreEqual(free, rows[0]);
        Assert.AreEqual((free.EndDateExclusive, (HouseTier?)HouseTier.Free), (rows[1].StartDate, rows[1].Tier));
        Assert.AreEqual(freePlan.Id, N9b1FAssertFree(await N9b1FTieredPlansAsync(house.TenantId), "USD").Plan.Id);
        Assert.IsEmpty(await N9b1FTieredPlansAsync(otherSpace));
    }

    // ---------- 10. the migration ----------

    [TestMethod]
    public async Task N9b1FreeTheMigrationRevertsWhileNoPlanHasATierAndRefusesOnceTheHouseHasFree()
    {
        N9b1FStartAtMidday();
        using var owner = CreateClient();
        var spaceId = await RegisterCoachAsync(owner, "n9b1f-migration-owner@example.test", "Nour Haddad", "N9b1 Migration Space");
        var plan = await B4aProductAsync(owner, "Online Coaching", B4aOfferRequest(4, 40m, "USD", "Training"));
        Assert.AreEqual(N9b1FSchemaObjects, await A7ScalarAsync(N9b1FSchemaSql));

        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var (migration, previous, migrator) = N9b1FMigrations(context);

        // With no tier anywhere, going back drops the columns, the guards, the exclusion and the index, and keeps the
        // plan that was there. Nothing asks the API anything until it is back.
        await migrator.MigrateAsync(previous);
        Assert.AreEqual(0L, await A7ScalarAsync(N9b1FSchemaSql));
        Assert.DoesNotContain(migration, await context.Database.GetAppliedMigrationsAsync());
        Assert.AreEqual(
            1L,
            await Phase6CountAsync(RequiredDatabaseConnection, """SELECT count(*) FROM subscriptions."CoachingProducts" WHERE "Id" = @id""", plan.Id));

        // Reapplied, all of it is back and nothing has a tier.
        await migrator.MigrateAsync();
        Assert.Contains(migration, await context.Database.GetAppliedMigrationsAsync());
        Assert.AreEqual(N9b1FSchemaObjects, await A7ScalarAsync(N9b1FSchemaSql));
        Assert.AreEqual(0L, await A7ScalarAsync("""SELECT count(*) FROM subscriptions."CoachingProducts" WHERE "HouseTier" IS NOT NULL"""));

        // A space marked as the house without Free, as one marked before this migration was, holds no tier. Whoever
        // deploys runs the command on it again, which marks nothing new and makes its Free, over the schema made again.
        await Phase6ExecuteAsync(N9a1MarkSql, ("mark", true), ("id", spaceId));
        Assert.IsEmpty(await N9b1FTieredPlansAsync(spaceId));
        await N9a1MarkHouseAsync(owner, spaceId);
        var free = N9b1FAssertFree(await N9b1FTieredPlansAsync(spaceId), "USD");

        // From then the way back stops with a plain message and the migration stays applied (Npgsql retries 55000
        // first, each time rolled back).
        var thrown = await Assert.ThrowsAsync<Exception>(() => migrator.MigrateAsync(previous));
        var refused = thrown as PostgresException ?? thrown.InnerException as PostgresException
            ?? throw new AssertFailedException($"Expected PostgreSQL's refusal, not {thrown}");
        Assert.AreEqual("55000", refused.SqlState, refused.MessageText);
        Assert.Contains("roll forward", refused.MessageText);
        Assert.Contains(migration, await context.Database.GetAppliedMigrationsAsync());
        Assert.AreEqual(N9b1FSchemaObjects, await A7ScalarAsync(N9b1FSchemaSql));
        await migrator.MigrateAsync();
        Assert.AreEqual(free.Plan.Id, N9b1FAssertFree(await N9b1FTieredPlansAsync(spaceId), "USD").Plan.Id);
    }

    // ---------- helpers (writer A of N9b1: Free's life) ----------

    /// <summary>
    /// Puts the frozen clock at midday of its own day in the house's zone and returns that day: whole days stepped
    /// from midday land on the day meant across Beirut's clock changes, which a step from just after midnight would not.
    /// </summary>
    private DateOnly N9b1FStartAtMidday()
    {
        var today = N9a1HouseToday();
        N9b1FSetHouseDay(today);
        return today;
    }

    /// <summary>Puts the frozen clock at midday of <paramref name="day"/> in the house's zone (Asia/Beirut), in UTC.</summary>
    private void N9b1FSetHouseDay(DateOnly day)
    {
        var midday = day.ToDateTime(new TimeOnly(12, 0));
        var zone = TimeZoneInfo.FindSystemTimeZoneById("Asia/Beirut");
        RequiredTestClock.Set(new DateTimeOffset(midday, zone.GetUtcOffset(midday)).ToUniversalTime());
        Assert.AreEqual(day, N9a1HouseToday(), $"The clock is on {N9a1Day(day)} in the house.");
    }

    /// <summary>
    /// A space whose staff sell a plan called Free, marked as the house by hand (as a house marked before Free existed
    /// was; the command would refuse it, see the first test), with both settings filled: sign-up is open, the house has
    /// no Free, and none can be made until that plan is renamed.
    /// </summary>
    private async Task<N9b1FClash> N9b1FClashHouseAsync(string tag)
    {
        var owner = CreateClient();
        var houseId = await RegisterCoachAsync(owner, $"n9b1f-{tag}-owner@example.test", "Nour Haddad", $"N9b1 {tag} House");
        var theirs = await B4aProductAsync(owner, "Free", B4aOfferRequest(2, 0m, "USD", "Messaging"));
        await Phase6ExecuteAsync(N9a1MarkSql, ("mark", true), ("id", houseId));
        var admin = await SignInPlatformAdminAsync($"n9b1f-{tag}-admin@example.test");
        await N9a1SettingAsync(admin, N9a1PlacesSetting, N9a1Places);
        await N9a1SettingAsync(admin, N9a1AgeSetting, N9a1Age);
        return new N9b1FClash(owner, admin, houseId, theirs);
    }

    /// <summary>Free's sweep as the Worker runs it, from a scope of its own on the test host.</summary>
    private async Task<HouseFreePlanRenewalResult> N9b1FSweepAsync()
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<IHouseFreePlanRenewal>().RunAsync(CancellationToken.None);
    }

    /// <summary>
    /// Waits until a statement of this test's database marked <c>/* <paramref name="marker"/> */</c> waits on a lock
    /// another transaction holds (one PostgreSQL has not granted it), and fails as soon as <paramref name="racing"/>
    /// ends first, since then it never waited.
    /// </summary>
    private async Task N9b1FAwaitLockWaitAsync(string marker, Task racing)
    {
        var waiting = $"""
            SELECT count(*) FROM pg_locks AS held
            JOIN pg_stat_activity AS backend ON backend.pid = held.pid
            WHERE NOT held.granted
              AND backend.datname = current_database()
              AND backend.pid <> pg_backend_pid()
              AND backend.query LIKE '%/* {marker} */%'
            """;
        var waited = System.Diagnostics.Stopwatch.StartNew();
        while (await A7ScalarAsync(waiting) == 0)
        {
            if (racing.IsCompleted)
            {
                await racing;
                Assert.Fail($"What was to wait at /* {marker} */ ended before it waited on a lock.");
            }

            if (waited.Elapsed > TimeSpan.FromSeconds(20))
            {
                Assert.Fail($"Nothing waited on a lock at /* {marker} */ within 20 seconds.");
            }

            await Task.Delay(50);
        }
    }

    /// <summary>The one plan with a tier is Free as the server makes it, with its one option: returns both.</summary>
    private static (N9b1FPlan Plan, N9b1FOption Option) N9b1FAssertFree(N9b1FPlan[] plans, string currency)
    {
        var plan = plans.Single();
        Assert.AreEqual(
            ("Free", (string?)null, true, ProductKind.CoachingPlan, (HouseTier?)HouseTier.Free),
            (plan.Name, plan.Description, plan.IsActive, plan.Kind, plan.Tier));
        var option = plan.Options.Single();
        Assert.AreEqual(
            ("Free", 365, OfferDurationUnit.Day, 0m, currency, true, (int?)null, "Training beside"),
            (option.Label, option.DurationCount, option.DurationUnit, option.PriceAmount, option.PriceCurrency, option.IsActive, option.SessionCount, option.Coverage));
        return (plan, option);
    }

    /// <summary>
    /// The staff's Clients row and the client's page name this plan as the client's plan, with its last day, and the
    /// row counts no other plan beside it.
    /// </summary>
    private static async Task N9b1FAssertStaffReadAsync(
        HttpClient staff,
        Guid clientProfileId,
        Guid enrollmentId,
        string name,
        DateOnly lastDay)
    {
        var row = await B4aRowAsync(staff, clientProfileId);
        Assert.IsNotNull(row.Plan, "The row names a plan.");
        Assert.AreEqual(
            (enrollmentId, name, (DateOnly?)lastDay, 0),
            (row.Plan.EnrollmentId, row.Plan.Name, row.PlanEndsOn, row.OtherPlanCount),
            "The Clients row.");
        var page = await ReadSliceAsync<ClientProfileOverviewView>(staff, R33bOverviewUrl(clientProfileId));
        Assert.AreEqual((name, (DateOnly?)lastDay), (page.PlanName, page.PlanEndsOn), "The client's page.");
    }

    /// <summary>
    /// The one plan with a tier is the house's Free off sale, as clearing the mark leaves it: the same plan, its option
    /// as it was.
    /// </summary>
    private static void N9b1FAssertOffSale(N9b1FPlan[] plans, (N9b1FPlan Plan, N9b1FOption Option) free)
    {
        var plan = plans.Single();
        Assert.AreEqual(
            (free.Plan.Id, "Free", (HouseTier?)HouseTier.Free, false),
            (plan.Id, plan.Name, plan.Tier, plan.IsActive),
            "The house's Free is off sale.");
        Assert.AreEqual(free.Option, plan.Options.Single(), "Its one option is as it was.");
    }

    /// <summary>No notice of a plan's kinds, nor of any other kind, is about this row.</summary>
    private async Task N9b1FAssertToldNothingAsync(Guid enrollmentId)
    {
        foreach (var kind in N9b1FPlanNotices)
        {
            Assert.AreEqual(0L, await N9a1QueuedAsync(kind, "AggregateId", enrollmentId), kind);
        }

        Assert.AreEqual(
            0L,
            await Phase6CountAsync(
                RequiredDatabaseConnection,
                """SELECT count(*) FROM notifications."OutboxItems" WHERE "AggregateId" = @id""",
                enrollmentId),
            "No notice of any kind is about a row of Free.");
    }

    /// <summary>The caller's Training decision in the workspace their header names.</summary>
    private static async Task<FeatureAccessDecision> N9b1FTrainingAsync(HttpClient client) =>
        (await ReadSliceAsync<FeatureAccessDecision[]>(client, N9b1FAccessUrl)).Single(item => item.Feature == CoachingFeature.Training);

    /// <summary>Training is granted, by this plan, and the decision says so.</summary>
    private static async Task<FeatureAccessDecision> N9b1FAssertTrainingAsync(HttpClient client, Guid enrollmentId)
    {
        var training = await N9b1FTrainingAsync(client);
        Assert.AreEqual(
            (true, FeatureAccessReason.Granted, (Guid?)enrollmentId),
            (training.IsAllowed, training.Reason, training.EnrollmentId));
        return training;
    }

    /// <summary>A plan for sale with one Training option of <paramref name="weeks"/> weeks, with the tier given.</summary>
    private static object N9b1FProductRequest(string name, int weeks, decimal price, string? houseTier) => new
    {
        name,
        description = (string?)null,
        initialOffer = B4aOfferRequest(weeks, price, "USD", "Training"),
        houseTier,
    };

    private static async Task<CoachingProductView> N9b1FProductAsync(
        HttpClient staff,
        string name,
        int weeks,
        decimal price,
        string? houseTier)
    {
        await RefreshCsrfAsync(staff);
        var response = await staff.PostAsJsonAsync(A7ProductsUrl, N9b1FProductRequest(name, weeks, price, houseTier));
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<CoachingProductView>(response);
    }

    /// <summary>A new plan refused for its tier: the one message under <paramref name="field"/>, and nothing made.</summary>
    private static async Task<string> N9b1FTierRefusalAsync(HttpClient staff, object request, string field)
    {
        var before = (await ReadSliceAsync<ProductCatalog>(staff, A7ProductsUrl)).Products.Count;
        await RefreshCsrfAsync(staff);
        var message = await A7FieldErrorAsync(await staff.PostAsJsonAsync(A7ProductsUrl, request), field);
        Assert.HasCount(before, (await ReadSliceAsync<ProductCatalog>(staff, A7ProductsUrl)).Products);
        return message;
    }

    /// <summary>Renames a plan for sale as the owner's editor does, keeping it for sale.</summary>
    private static async Task<CoachingProductView> N9b1FRenameAsync(HttpClient staff, CoachingProductView product, string name)
    {
        await RefreshCsrfAsync(staff);
        var response = await staff.PutAsJsonAsync(
            $"{A7ProductsUrl}/{product.Id}",
            new { name, description = product.Description, isActive = true, version = product.Version });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<CoachingProductView>(response);
    }

    /// <summary>The owner changes the workspace's own currency in its settings, leaving everything else as it was.</summary>
    private static async Task N9b1FSetCurrencyAsync(HttpClient owner, string currency)
    {
        var workspace = await RequiredJsonAsync<N9b1FWorkspace>(await owner.GetAsync("/api/workspace"));
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PutAsJsonAsync("/api/workspace", workspace with { DefaultCurrencyCode = currency }),
            HttpStatusCode.OK);
        Assert.AreEqual(currency, (await RequiredJsonAsync<N9b1FWorkspace>(await owner.GetAsync("/api/workspace"))).DefaultCurrencyCode);
    }

    /// <summary>A one-week program of one lift, a typed 40 kg set of 5, which needs no training max.</summary>
    private static object N9b1FProgram(Guid exerciseId) => new
    {
        name = "N9b1 Starter Block",
        description = "The basics, one week",
        weeks = new[] { N6bWeek("Week 1", "Full body", N6bLift(exerciseId, 1, P1Set(1, "Direct", rpe: null, direct: 40m))) },
    };

    /// <summary>Assigns a program to a client under the plan given, from the day given, with no training max.</summary>
    private static async Task<HttpResponseMessage> N9b1FAssignAsync(
        HttpClient staff,
        Guid clientProfileId,
        Guid enrollmentId,
        Guid templateVersionId,
        DateOnly startDate)
    {
        await RefreshCsrfAsync(staff);
        return await staff.PostAsJsonAsync($"/api/training/clients/{clientProfileId}/mesocycles", new
        {
            enrollmentId,
            templateVersionId,
            startDate = N9a1Day(startDate),
            kind = "Primary",
            loadUnit = "Kilogram",
            loadIncrement = 2.5m,
            loadRoundingMode = "Nearest",
            workingMaxes = Array.Empty<object>(),
            idempotencyKey = Guid.NewGuid(),
        });
    }

    /// <summary>A profile's plans as the table holds them, past every filter, oldest first.</summary>
    private async Task<N9b1FRow[]> N9b1FRowsAsync(Guid clientProfileId)
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var rows = await context.ClientEnrollments.IgnoreQueryFilters().AsNoTracking()
            .Include(item => item.Entitlements)
            .Where(item => item.ClientProfileId == clientProfileId)
            .ToListAsync();
        return [.. rows
            .OrderBy(item => item.StartDate)
            .ThenBy(item => item.Id)
            .Select(item => new N9b1FRow(
                item.Id,
                item.TenantId,
                item.ProductId,
                item.OfferId,
                item.ProductNameSnapshot,
                item.HouseTier,
                item.Status,
                item.StartDate,
                item.EndDateExclusive,
                item.PriceAmount,
                item.PriceCurrency,
                item.AssignmentCommandId,
                item.RenewedFromEnrollmentId,
                N9b1FCoverage(item.Entitlements.Select(entitlement => (entitlement.Feature, !entitlement.BlocksOverlap)))))];
    }

    /// <summary>A workspace's plans with a tier and their price options, past every filter.</summary>
    private async Task<N9b1FPlan[]> N9b1FTieredPlansAsync(Guid tenantId)
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var plans = await context.CoachingProducts.IgnoreQueryFilters().AsNoTracking()
            .Where(item => item.TenantId == tenantId && item.HouseTier != null)
            .ToListAsync();
        var planIds = plans.Select(item => item.Id).ToArray();
        var options = await context.ProductOffers.IgnoreQueryFilters().AsNoTracking()
            .Include(item => item.Entitlements)
            .Where(item => planIds.Contains(item.ProductId))
            .ToListAsync();
        return [.. plans
            .OrderBy(item => item.Id)
            .Select(plan => new N9b1FPlan(
                plan.Id,
                plan.Name,
                plan.Description,
                plan.IsActive,
                plan.Kind,
                plan.HouseTier,
                [.. options
                    .Where(option => option.ProductId == plan.Id)
                    .OrderBy(option => option.Id)
                    .Select(option => new N9b1FOption(
                        option.Id,
                        option.Label,
                        option.DurationCount,
                        option.DurationUnit,
                        option.PriceAmount,
                        option.PriceCurrency,
                        option.IsActive,
                        option.SessionCount,
                        N9b1FCoverage(option.Entitlements.Select(entitlement => (entitlement.Feature, entitlement.AllowsConcurrentCoverage)))))]))];
    }

    /// <summary>What a plan covers, each feature with whether it covers it beside another plan or alone.</summary>
    private static string N9b1FCoverage(IEnumerable<(CoachingFeature Feature, bool Beside)> features) =>
        string.Join(", ", features.OrderBy(item => item.Feature).Select(item => $"{item.Feature} {(item.Beside ? "beside" : "alone")}"));

    /// <summary>This row's migration, the one before it, and the migrator that moves between them.</summary>
    private static (string Migration, string Previous, IMigrator Migrator) N9b1FMigrations(GymDbContext context)
    {
        var migrations = context.Database.GetMigrations().ToArray();
        var migration = migrations.Single(item => item.EndsWith("_HouseFreePlan", StringComparison.Ordinal));
        return (
            migration,
            migrations[Array.IndexOf(migrations, migration) - 1],
            context.Database.GetInfrastructure().GetRequiredService<IMigrator>());
    }

    private sealed record N9b1FRow(
        Guid Id,
        Guid TenantId,
        Guid ProductId,
        Guid OfferId,
        string ProductName,
        HouseTier? Tier,
        EnrollmentStatus Status,
        DateOnly StartDate,
        DateOnly EndDateExclusive,
        decimal PriceAmount,
        string PriceCurrency,
        Guid AssignmentCommandId,
        Guid? RenewedFromEnrollmentId,
        string Coverage);

    private sealed record N9b1FPlan(
        Guid Id,
        string Name,
        string? Description,
        bool IsActive,
        ProductKind Kind,
        HouseTier? Tier,
        N9b1FOption[] Options);

    private sealed record N9b1FOption(
        Guid Id,
        string Label,
        int DurationCount,
        OfferDurationUnit DurationUnit,
        decimal PriceAmount,
        string PriceCurrency,
        bool IsActive,
        int? SessionCount,
        string Coverage);

    private sealed record N9b1FBlock(Guid Id, Guid EnrollmentId);

    private sealed record N9b1FClash(HttpClient Owner, HttpClient Admin, Guid HouseId, CoachingProductView Theirs) : IDisposable
    {
        public void Dispose()
        {
            Owner.Dispose();
            Admin.Dispose();
        }
    }

    /// <summary>Every event the host logs from the moment it is added, as its id's number and name together.</summary>
    private sealed class N9b1FEventLog : ILoggerProvider
    {
        private readonly ConcurrentQueue<(int Id, string? Name)> logged = new();

        public (int Id, string? Name)[] Logged => [.. logged];

        public ILogger CreateLogger(string categoryName) => new Recorder(logged);

        public void Dispose()
        {
        }

        private sealed class Recorder(ConcurrentQueue<(int Id, string? Name)> logged) : ILogger
        {
            public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

            public bool IsEnabled(LogLevel logLevel) => true;

            public void Log<TState>(
                LogLevel logLevel,
                EventId eventId,
                TState state,
                Exception? exception,
                Func<TState, Exception?, string> formatter) =>
                logged.Enqueue((eventId.Id, eventId.Name));
        }
    }

    /// <summary>The workspace's settings as its page reads and sends them back.</summary>
    private sealed record N9b1FWorkspace(
        string Name,
        string TimeZoneId,
        string DefaultCulture,
        string DefaultCurrencyCode,
        string WeekStartsOn,
        uint Version);
}
