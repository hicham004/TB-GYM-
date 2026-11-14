using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Notifications;
using TB.Gym.Modules.PlatformBilling;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.Modules.Tenancy;
using TB.Gym.SharedKernel;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The notes plan's N9c1, asking for a plan of the house and paying (SUB-020), against PostgreSQL: the house's Whish
/// number opens asks and an empty one keeps them closed; a trainee reads only the Pro+ options on sale and asks for
/// one, which books nothing and tells the house's Owner and the trainee's coach in-app by name (the first notices a
/// self-directed trainee raises for staff), once however often it is tapped; says the money was sent, once, from a Whish
/// name and number no log, payload or notice ever holds; one staff step books the plan from the house's day, or from
/// the end of the paid plan still running, with its receipt of the exact price, once under its key, and never twice
/// at once; an ask closed keeps its reason for the trainee; nothing of it reaches outside the house, a coach who is not
/// the trainee's, a trainee who left or one who is paused; the database keeps the asks, their word and their outcome
/// as written and one paid plan at a time; a paid plan of the house never offers the coach's Ask to renew; closing the
/// account erases the Whish details alone; an unpaid house cannot book; and the migration. Every name, number, address
/// and figure is invented.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private const string N9c1WhishSetting = "WhishNumber";

    private const string N9c1HouseWhish = "+961 70 123 456";

    private const string N9c1PlansUrl = "/api/house-plans/me";

    private const string N9c1AsksUrl = "/api/house-plans/me/asks";

    private const string N9c1PlanName = "N9c1 Strength Pass";

    private const decimal N9c1Price = 47.50m;

    private const string N9c1WhishName = "Zephyrine Quillfeather";

    private const string N9c1TraineeWhish = "+961 71 234 567";

    private const string N9c1AskedBody = "Open the client's page to see the ask. Book the plan once the money is there.";

    private const string N9c1SentBody = "Check the Whish account, then book the plan from the client's page.";

    /// <summary>The three tables, their six triggers and three functions, the exclusion, the receipts' key and the two kinds.</summary>
    private const string N9c1SchemaSql =
        """
        SELECT
            (SELECT count(*) FROM information_schema.tables
             WHERE table_schema = 'subscriptions' AND table_name IN ('HousePlanAsks', 'HousePlanTransfers', 'HousePlanAskOutcomes'))
          + (SELECT count(*) FROM pg_trigger
             WHERE NOT tgisinternal AND tgname IN (
                 'TR_HousePlanAsks_House', 'TR_HousePlanAsks_Guard', 'TR_HousePlanAsks_AppendOnly',
                 'TR_HousePlanAskOutcomes_Guard', 'TR_HousePlanAskOutcomes_AppendOnly', 'TR_HousePlanTransfers_Protect'))
          + (SELECT count(*) FROM pg_proc
             WHERE proname IN ('guard_house_plan_ask', 'guard_house_plan_ask_outcome', 'protect_house_plan_transfer'))
          + (SELECT count(*) FROM pg_constraint
             WHERE conname IN ('EX_ClientEnrollments_OneHousePaidPlanAtATime', 'AK_PaymentRecords_TenantId_Id'))
          + (SELECT count(*) FROM pg_constraint
             WHERE conname = 'CK_NotificationOutboxItems_Vocabulary' AND pg_get_constraintdef(oid) LIKE '%HousePlanMoneySent%')
        """;

    private const long N9c1SchemaObjects = 15;

    private static readonly string[] N9c1HouseKinds = ["HousePlanAsked", "HousePlanMoneySent"];

    private static readonly CoachingFeature[] N9c1TrainingOnly = [CoachingFeature.Training];

    private static readonly HttpStatusCode[] N9c1OneNewOneSame = [HttpStatusCode.Created, HttpStatusCode.OK];

    private static readonly string[] N9c1BadWhishNumbers = ["70-123-456", "12345", "+961 70 123 456 ext", "123456789012345678901", "(961) 70 123456"];

    // ---------- 1. the house's Whish number and the plans a trainee reads ----------

    [TestMethod]
    public async Task N9c1TheHousesWhishNumberOpensAsksAndTheTraineeReadsOnlyTheProPlusOptionsOnSale()
    {
        var today = N9b1FStartAtMidday();
        using var space = await N9c1OpenAsync("whish", whish: null);
        var house = space.House;
        using var trainee = await N9a1TraineeAsync(house.TenantId, "n9c1-whish-talia@example.test", "Talia", "Wexford");

        // A longer option of the plan, a third option put off sale, and plans no trainee may ask for.
        await N9c1AddOptionAsync(house.Owner, space.Plan.Id, 8, 89.75m);
        var twelve = (await N9c1AddOptionAsync(house.Owner, space.Plan.Id, 12, 120.25m)).Offers.Single(item => item.DurationCount == 12);
        await N9c1OptionOffSaleAsync(house.Owner, twelve);
        // A Max plan covers Training, Nutrition, Check-ins and Messaging, all four (N9c5); its places are empty here.
        await RefreshCsrfAsync(house.Owner);
        var maxMade = await house.Owner.PostAsJsonAsync(
            A7ProductsUrl,
            new
            {
                name = "N9c1 Max Pass",
                description = (string?)null,
                initialOffer = B4aOfferRequest(4, 150m, "USD", "Training", "Nutrition", "CheckIns", "Messaging"),
                houseTier = "Max",
            });
        await AssertStatusAsync(maxMade, HttpStatusCode.OK);
        var max = await ReadSlicePayloadAsync<CoachingProductView>(maxMade);
        var zero = await N9b1FProductAsync(house.Owner, "N9c1 Zero Pass", 4, 0m, "ProPlus");
        var untiered = await N9b1FProductAsync(house.Owner, "N9c1 Untiered Pass", 4, 33.25m, null);
        var retired = await N9b1FProductAsync(house.Owner, "N9c1 Retired Pass", 4, 41.75m, "ProPlus");
        await N9c1PlanOffSaleAsync(house.Owner, retired);
        var free = (await N9b1FTieredPlansAsync(house.TenantId)).Single(item => item.Tier == HouseTier.Free).Options.Single();

        // Empty, as the house starts: asks are closed, the read names no number and no plan, and an ask is refused.
        var closed = await N9c1OwnAsync(trainee.Client);
        Assert.AreEqual((today, false, (string?)null), (closed.Today, closed.AsksOpen, closed.WhishNumber));
        Assert.IsEmpty(closed.Plans);
        Assert.IsEmpty(closed.Asks);
        var shut = await A7ConflictAsync(await N9c1AskAsync(trainee.Client, space.OfferId));
        Assert.AreEqual("house_plan_asks_closed", shut.Code);
        Assert.AreEqual("TB Gym isn't taking asks for a paid plan right now. Nothing you have changes.", shut.Message);

        // A number that is not one: refused in the rule's own sentence, and nothing kept.
        foreach (var value in N9c1BadWhishNumbers)
        {
            var refused = await N9a1PutSettingAsync(house.Admin, N9c1WhishSetting, value, 0);
            Assert.AreEqual(HouseSettingRule.WhishNumberRefusal, await A7FieldErrorAsync(refused, "value"), value);
        }

        Assert.IsNull((await N9a1HouseReadAsync(house.Admin)).Settings.Single(item => item.Setting == N9c1WhishSetting).Value);

        // Filled, it is kept in its one form and asks open, listing only the two options on sale of the Pro+ plan priced
        // above nothing, the shorter first: never Max, Free, a plan without a tier, one off sale or one at no price.
        Assert.AreEqual(
            new N9a1Setting(N9c1WhishSetting, "+961 70 123456", 1),
            await N9a1SettingAsync(house.Admin, N9c1WhishSetting, "  +961   70 123456 "));
        var open = await N9c1OwnAsync(trainee.Client);
        Assert.AreEqual((today, true, "+961 70 123456"), (open.Today, open.AsksOpen, open.WhishNumber));
        Assert.HasCount(2, open.Plans);
        var eight = open.Plans[1];
        Assert.AreEqual(
            (space.OfferId, space.Plan.Id, HouseTier.ProPlus, N9c1PlanName, (string?)null, "4 weeks", N9c1Price, "USD", 4, OfferDurationUnit.Week),
            (open.Plans[0].OfferId, open.Plans[0].ProductId, open.Plans[0].Tier, open.Plans[0].Name, open.Plans[0].Description, open.Plans[0].OptionLabel,
                open.Plans[0].PriceAmount, open.Plans[0].PriceCurrency, open.Plans[0].DurationCount, open.Plans[0].DurationUnit));
        Assert.AreEqual(
            (space.Plan.Id, HouseTier.ProPlus, N9c1PlanName, "8 weeks", 89.75m, "USD", 8, OfferDurationUnit.Week),
            (eight.ProductId, eight.Tier, eight.Name, eight.OptionLabel, eight.PriceAmount, eight.PriceCurrency, eight.DurationCount, eight.DurationUnit));
        CollectionAssert.AreEqual(N9c1TrainingOnly, open.Plans[0].Features.ToArray());
        CollectionAssert.AreEqual(N9c1TrainingOnly, eight.Features.ToArray());

        // Asked for anyway, each of the others is not on sale, and nothing is kept.
        foreach (var (offerId, what) in new[]
        {
            (max.Offers[0].Id, "Max"),
            (zero.Offers[0].Id, "a plan at no price"),
            (untiered.Offers[0].Id, "a plan without a tier"),
            (retired.Offers[0].Id, "a plan off sale"),
            (twelve.Id, "an option off sale"),
            (free.Id, "Free"),
            (Guid.NewGuid(), "no option at all"),
        })
        {
            Assert.AreEqual(
                ("house_plan_not_on_sale", HousePlanAskRule.NotOnSaleMessage),
                await A7ConflictAsync(await N9c1AskAsync(trainee.Client, offerId)),
                what);
        }

        Assert.AreEqual(0L, await N9c1AsksOfAsync(trainee.ProfileId));

        // Asked while open, then the number emptied: closed again for a new ask, the ask still read, and its money may
        // still be said sent.
        var ask = await N9c1AskedAsync(trainee.Client, space.OfferId);
        Assert.AreEqual(
            new N9a1Setting(N9c1WhishSetting, null, 2),
            await N9a1SettingAsync(house.Admin, N9c1WhishSetting, "   "));
        var again = await N9c1OwnAsync(trainee.Client);
        Assert.AreEqual((false, (string?)null), (again.AsksOpen, again.WhishNumber));
        Assert.IsEmpty(again.Plans);
        Assert.AreEqual(ask, again.Asks.Single());
        Assert.AreEqual("house_plan_asks_closed", (await A7ConflictAsync(await N9c1AskAsync(trainee.Client, eight.OfferId))).Code);
        var sent = await N9c1SayMoneySentAsync(trainee.Client, ask.Id);
        await AssertStatusAsync(sent, HttpStatusCode.OK);
        Assert.AreEqual(HousePlanAskState.MoneySent, (await ReadSlicePayloadAsync<HousePlanAskView>(sent)).State);
        Assert.AreEqual(1L, await N9c1AsksOfAsync(trainee.ProfileId));
    }

    // ---------- 2. an ask books nothing and tells the house's staff ----------

    [TestMethod]
    public async Task N9c1AnAskBooksNothingAndTellsTheOwnerAndTheTraineesCoachInAppByName()
    {
        const string email = "n9c1-ask-talia@example.test";
        var today = N9b1FStartAtMidday();
        using var space = await N9c1OpenAsync("ask", withCoach: true);
        var house = space.House;
        using var trainee = await N9a1TraineeAsync(house.TenantId, email, "Talia", "Wexford");
        var free = (await N9b1FRowsAsync(trainee.ProfileId)).Single();
        Assert.AreEqual(house.CoachUserId, (await N9a1PersonAsync(email)).Profiles.Single().AssignedCoachUserId, "The house's Coach is the trainee's coach.");

        var response = await N9c1AskAsync(trainee.Client, space.OfferId);
        await AssertStatusAsync(response, HttpStatusCode.Created);
        var ask = await ReadSlicePayloadAsync<HousePlanAskView>(response);
        Assert.AreEqual(
            (space.OfferId, HouseTier.ProPlus, N9c1PlanName, "4 weeks", N9c1Price, "USD", 4, OfferDurationUnit.Week, today, HousePlanAskState.Asked),
            (ask.OfferId, ask.Tier, ask.PlanName, ask.OptionLabel, ask.PriceAmount, ask.PriceCurrency, ask.DurationCount, ask.DurationUnit, ask.AskedOn, ask.State));
        Assert.IsNull(ask.MoneySent);
        Assert.IsNull(ask.Outcome);

        // Nothing is booked: Free alone, the tier Free, and Training granted by it.
        var rows = await N9b1FRowsAsync(trainee.ProfileId);
        Assert.AreEqual(free, rows.Single());
        var plans = await ReadSliceAsync<OwnPlansView>(trainee.Client, N9b1FPlanUrl);
        Assert.AreEqual(((HouseTier?)HouseTier.Free, EffectiveEnrollmentStatus.Active), (plans.Tier, plans.Free!.Status));
        await N9b1FAssertTrainingAsync(trainee.Client, free.Id);

        // Queued once for the Owner and once for the trainee's coach, each carrying the trainee's id alone.
        CollectionAssert.AreEquivalent(
            new[] { house.OwnerUserId, house.CoachUserId!.Value },
            await N9c1RecipientsAsync("HousePlanAsked", trainee.ProfileId));
        foreach (var payload in await N9c1PayloadsAsync(trainee.ProfileId))
        {
            using var document = JsonDocument.Parse(payload);
            Assert.AreEqual(
                "clientProfileId,schemaVersion",
                string.Join(',', document.RootElement.EnumerateObject().Select(property => property.Name).Order()));
            Assert.AreEqual(trainee.ProfileId, document.RootElement.GetProperty("clientProfileId").GetGuid());
        }

        // Delivered, each reads the trainee's name and opens the trainee's page.
        await Step3SweepNotificationsAsync();
        foreach (var (staff, who) in new[] { (house.Owner, "the Owner"), (house.Coach!, "the Coach") })
        {
            var inbox = await RequiredJsonAsync<RenewalInbox>(await staff.GetAsync("/api/notifications"));
            var notice = inbox.Items.Single(item => item.Kind == nameof(CommercialNotificationKind.HousePlanAsked));
            Assert.AreEqual(
                ("Talia Wexford asked for a plan", N9c1AskedBody, (Guid?)trainee.ProfileId),
                (notice.Title, notice.Body, notice.ClientProfileId),
                who);
        }

        // In-app only, and the trainee's own inbox has nothing of it.
        Assert.AreEqual(0L, await N9c1CountAsync(
            """
            SELECT count(*) FROM notifications."ChannelDeliveries" d
            JOIN notifications."OutboxItems" o ON o."Id" = d."OutboxItemId"
            WHERE o."AggregateId" = @id AND o."Kind" IN ('HousePlanAsked', 'HousePlanMoneySent') AND d."Channel" <> 'InApp'
            """,
            trainee.ProfileId));
        var own = await RequiredJsonAsync<RenewalInbox>(await trainee.Client.GetAsync("/api/notifications"));
        Assert.IsFalse(own.Items.Any(item => N9c1HouseKinds.Contains(item.Kind)));
        Assert.IsTrue(own.Items.All(item => item.ClientProfileId is null));

        // The trainee's page and each staff member read the one ask as it was asked.
        Assert.AreEqual(ask, (await N9c1OwnAsync(trainee.Client)).Asks.Single());
        Assert.AreEqual(ask, (await N9c1StaffListAsync(house.Owner, trainee.ProfileId)).Single());
        Assert.AreEqual(ask, (await N9c1StaffListAsync(house.Coach!, trainee.ProfileId)).Single());
    }

    [TestMethod]
    public async Task N9c1ANoticeReachesOnlyStaffStillTheTraineesAndNeverOneAboutATraineeWhoLeft()
    {
        N9b1FStartAtMidday();
        using var space = await N9c1OpenAsync("still", withCoach: true);
        var house = space.House;
        var coachId = house.CoachUserId!.Value;
        using var talia = await N9a1TraineeAsync(house.TenantId, "n9c1-still-talia@example.test", "Talia", "Wexford");
        using var corin = await N9a1TraineeAsync(house.TenantId, "n9c1-still-corin@example.test", "Corin", "Ashgrove");
        var ask = await N9c1AskedAsync(talia.Client, space.OfferId);
        await N9c1AskedAsync(corin.Client, space.OfferId);
        CollectionAssert.AreEquivalent(new[] { house.OwnerUserId, coachId }, await N9c1RecipientsAsync("HousePlanAsked", talia.ProfileId));
        CollectionAssert.AreEquivalent(new[] { house.OwnerUserId, coachId }, await N9c1RecipientsAsync("HousePlanAsked", corin.ProfileId));

        // Before the notices go out, Corin leaves the house and its Coach leaves the team, so Talia waits for a coach
        // (N9d1b).
        await N9a1LeaveAsync(corin.Client, "Moving to another city");
        await RemoveCoachForBillingAsync(house.Owner, coachId);
        Assert.IsNull((await N9a1PersonAsync("n9c1-still-talia@example.test")).Profiles.Single().AssignedCoachUserId);
        await Step3SweepNotificationsAsync();

        // The Owner reads Talia's ask alone; nobody reads Corin's, and the Coach who left reads nothing.
        var inbox = await RequiredJsonAsync<RenewalInbox>(await house.Owner.GetAsync("/api/notifications"));
        Assert.AreEqual(
            (Guid?)talia.ProfileId,
            inbox.Items.Single(item => item.Kind == nameof(CommercialNotificationKind.HousePlanAsked)).ClientProfileId);
        Assert.AreEqual(0L, await N9c1CountAsync(
            """SELECT count(*) FROM notifications."Notifications" WHERE "RecipientUserId" = @id AND "Kind" IN ('HousePlanAsked', 'HousePlanMoneySent')""",
            coachId));

        // Talia, waiting for a coach, says the money is sent: the Owner alone is told.
        await AssertStatusAsync(await N9c1SayMoneySentAsync(talia.Client, ask.Id), HttpStatusCode.OK);
        CollectionAssert.AreEqual(new[] { house.OwnerUserId }, await N9c1RecipientsAsync("HousePlanMoneySent", talia.ProfileId));
    }

    [TestMethod]
    public async Task N9c1ANoticeToACoachWhoNoLongerHasTheTraineeIsNotDeliveredWhileTheOwnersIs()
    {
        N9b1FStartAtMidday();
        using var space = await N9c1OpenAsync("moved", withCoach: true);
        var house = space.House;
        var leaId = house.CoachUserId!.Value;
        using var talia = await N9a1TraineeAsync(house.TenantId, "n9c1-moved-talia@example.test", "Talia", "Wexford");
        using var rania = CreateClient();
        var raniaId = await JoinAsCoachAsync(house.Owner, rania, "n9c1-moved-rania@example.test", "Rania Saab");
        var ask = await N9c1AskedAsync(talia.Client, space.OfferId);
        await AssertStatusAsync(await N9c1SayMoneySentAsync(talia.Client, ask.Id), HttpStatusCode.OK);
        foreach (var kind in N9c1HouseKinds)
        {
            CollectionAssert.AreEquivalent(new[] { house.OwnerUserId, leaId }, await N9c1RecipientsAsync(kind, talia.ProfileId), kind);
        }

        // Before the notices go out, the Owner gives Talia to a second Coach; the house's Coach stays on the team.
        await ReassignAsync(house.Owner, talia.ProfileId, raniaId, "Evening sessions suit Rania better");
        await Step3SweepNotificationsAsync();

        // The Coach who no longer has her reads neither notice, though still on the team; the Owner reads both; the new
        // Coach was never told.
        var leas = await RequiredJsonAsync<RenewalInbox>(await house.Coach!.GetAsync("/api/notifications"));
        Assert.IsFalse(leas.Items.Any(item => N9c1HouseKinds.Contains(item.Kind)), "The Coach who no longer has the trainee.");
        var owners = await RequiredJsonAsync<RenewalInbox>(await house.Owner.GetAsync("/api/notifications"));
        CollectionAssert.AreEquivalent(
            N9c1HouseKinds,
            owners.Items.Where(item => N9c1HouseKinds.Contains(item.Kind)).Select(item => item.Kind).ToArray());
        Assert.IsTrue(owners.Items.Where(item => N9c1HouseKinds.Contains(item.Kind)).All(item => item.ClientProfileId == talia.ProfileId));
        var ranias = await RequiredJsonAsync<RenewalInbox>(await rania.GetAsync("/api/notifications"));
        Assert.IsFalse(ranias.Items.Any(item => N9c1HouseKinds.Contains(item.Kind)), "The new Coach was never told.");
        Assert.AreEqual(0L, await N9c1CountAsync(
            """SELECT count(*) FROM notifications."Notifications" WHERE "RecipientUserId" = @id AND "Kind" IN ('HousePlanAsked', 'HousePlanMoneySent')""",
            leaId));
    }

    // ---------- 3. a double tap, two at once, and another plan while one is asked ----------

    [TestMethod]
    public async Task N9c1ADoubleTapAndTwoAsksAtOnceStoreOneAskAndOneNoticeAndAnotherPlanWaits()
    {
        N9b1FStartAtMidday();
        using var space = await N9c1OpenAsync("twice");
        var house = space.House;
        var eight = (await N9c1AddOptionAsync(house.Owner, space.Plan.Id, 8, 89.75m)).Offers.Single(item => item.DurationCount == 8);
        using var talia = await N9a1TraineeAsync(house.TenantId, "n9c1-twice-talia@example.test", "Talia", "Wexford");
        using var corin = await N9a1TraineeAsync(house.TenantId, "n9c1-twice-corin@example.test", "Corin", "Ashgrove");

        // A double tap: the second answers the first's ask. The trainee waits for a coach (no house Coach), so the Owner
        // alone is told, once.
        var first = await N9c1AskAsync(talia.Client, space.OfferId);
        await AssertStatusAsync(first, HttpStatusCode.Created);
        var second = await N9c1AskAsync(talia.Client, space.OfferId);
        await AssertStatusAsync(second, HttpStatusCode.OK);
        var asked = await ReadSlicePayloadAsync<HousePlanAskView>(first);
        Assert.AreEqual(asked, await ReadSlicePayloadAsync<HousePlanAskView>(second));
        Assert.AreEqual(1L, await N9c1AsksOfAsync(talia.ProfileId));
        CollectionAssert.AreEqual(new[] { house.OwnerUserId }, await N9c1RecipientsAsync("HousePlanAsked", talia.ProfileId));

        // Another option of the same plan while it is open: refused, naming the plan and the option asked for, and
        // nothing kept.
        Assert.AreEqual(
            ("house_plan_ask_open", $"You already asked for {N9c1PlanName}, 4 weeks. TB Gym books it once your money is there, or closes the ask, before you can ask for anything else."),
            await A7ConflictAsync(await N9c1AskAsync(talia.Client, eight.Id)));
        Assert.AreEqual(1L, await N9c1AsksOfAsync(talia.ProfileId));
        Assert.AreEqual(1L, await N9a1QueuedAsync("HousePlanAsked", "AggregateId", talia.ProfileId));

        // Two at once: the first is held at its insert holding the trainee's record, the second waits on that lock and
        // then finds the first's ask.
        await RefreshCsrfAsync(corin.Client);
        RequiredInsertBarrier.Arm("subscriptions.\"HousePlanAsks\"", 2);
        HttpResponseMessage[] answers;
        try
        {
            var a = corin.Client.PostAsJsonAsync(N9c1AsksUrl, new { offerId = space.OfferId });
            if (await Task.WhenAny(a, RequiredInsertBarrier.ArrivedAsync(1)) == a)
            {
                Assert.Fail($"The first ask ended before its insert: {(await a).StatusCode}.");
            }

            var b = corin.Client.PostAsJsonAsync(N9c1AsksUrl, new { offerId = space.OfferId });
            await N9b1FAwaitLockWaitAsync("house-plan-ask", b);
            RequiredInsertBarrier.Disarm();
            answers = await Task.WhenAll(a, b);
            Assert.AreEqual(1, RequiredInsertBarrier.Arrived, "Only the first ask's insert was held.");
        }
        finally
        {
            RequiredInsertBarrier.Disarm();
        }

        CollectionAssert.AreEquivalent(N9c1OneNewOneSame, answers.Select(item => item.StatusCode).ToArray());
        var ids = await Task.WhenAll(answers.Select(async item => (await ReadSlicePayloadAsync<HousePlanAskView>(item)).Id));
        Assert.AreEqual(ids[0], ids[1]);
        Assert.AreEqual(1L, await N9c1AsksOfAsync(corin.ProfileId));
        Assert.AreEqual(1L, await N9a1QueuedAsync("HousePlanAsked", "AggregateId", corin.ProfileId));
    }

    // ---------- 4. the money said sent, and where its details never go ----------

    [TestMethod]
    public async Task N9c1TheMoneySentIsTheTraineesOwnWordSaidOnceAndItsDetailsReachNoLogNoticeOrPayload()
    {
        const string reason = "No transfer from Vantablack Orchard arrived this week.";
        const string reference = "WH 4417 Larkspur";
        var today = N9b1FStartAtMidday();
        using var space = await N9c1OpenAsync("sent");
        var house = space.House;
        using var talia = await N9a1TraineeAsync(house.TenantId, "n9c1-sent-talia@example.test", "Talia", "Wexford");
        using var corin = await N9a1TraineeAsync(house.TenantId, "n9c1-sent-corin@example.test", "Corin", "Ashgrove");
        var ask = await N9c1AskedAsync(talia.Client, space.OfferId);
        var corinsAsk = await N9c1AskedAsync(corin.Client, space.OfferId);

        // Another trainee's ask, or none: not found.
        await AssertStatusAsync(await N9c1SayMoneySentAsync(talia.Client, corinsAsk.Id), HttpStatusCode.NotFound);
        await AssertStatusAsync(await N9c1SayMoneySentAsync(talia.Client, Guid.NewGuid()), HttpStatusCode.NotFound);

        // Details the rule cannot keep: refused field by field.
        Assert.AreEqual(
            HousePlanAskRule.WhishNameRefusal,
            await A7FieldErrorAsync(await N9c1SayMoneySentAsync(talia.Client, ask.Id, "   ", N9c1TraineeWhish), "whishName"));
        Assert.AreEqual(
            HousePlanAskRule.WhishNumberRefusal,
            await A7FieldErrorAsync(await N9c1SayMoneySentAsync(talia.Client, ask.Id, N9c1WhishName, "71-234-567"), "whishNumber"));
        Assert.AreEqual(
            HousePlanAskRule.WhishNumberRefusal,
            await A7FieldErrorAsync(await N9c1SayMoneySentAsync(talia.Client, ask.Id, N9c1WhishName, "12345"), "whishNumber"));
        Assert.AreEqual(0L, await N9c1TransfersOfAsync(talia.ProfileId));
        Assert.AreEqual(0L, await N9a1QueuedAsync("HousePlanMoneySent", "AggregateId", talia.ProfileId));

        // Said with stray spaces: kept as the rule writes it, and the staff told once.
        var said = await N9c1SayMoneySentAsync(talia.Client, ask.Id, "  Zephyrine   Quillfeather ", "+961  71 234   567");
        await AssertStatusAsync(said, HttpStatusCode.OK);
        var sent = await ReadSlicePayloadAsync<HousePlanAskView>(said);
        Assert.AreEqual(
            (ask.Id, HousePlanAskState.MoneySent, new HousePlanTransferView(N9c1WhishName, N9c1TraineeWhish, today)),
            (sent.Id, sent.State, sent.MoneySent));
        Assert.IsNull(sent.Outcome);
        Assert.AreEqual(1L, await N9a1QueuedAsync("HousePlanMoneySent", "AggregateId", talia.ProfileId));

        // The same details again: answered as said, nothing more. Other details: refused, nothing more.
        var same = await N9c1SayMoneySentAsync(talia.Client, ask.Id, N9c1WhishName, N9c1TraineeWhish);
        await AssertStatusAsync(same, HttpStatusCode.OK);
        Assert.AreEqual(sent, await ReadSlicePayloadAsync<HousePlanAskView>(same));
        Assert.AreEqual(
            ("house_plan_money_already_sent", "You already said you sent this money, from other Whish details. TB Gym looks for it with the details you gave first."),
            await A7ConflictAsync(await N9c1SayMoneySentAsync(talia.Client, ask.Id, N9c1WhishName, "+961 71 234 568")));
        Assert.AreEqual(1L, await N9c1TransfersOfAsync(talia.ProfileId));
        Assert.AreEqual(1L, await N9a1QueuedAsync("HousePlanMoneySent", "AggregateId", talia.ProfileId));
        Assert.AreEqual(sent, (await N9c1OwnAsync(talia.Client)).Asks.Single());

        // The staff read the details to find the money, book it, and close Corin's ask.
        Assert.AreEqual(sent, (await N9c1StaffListAsync(house.Owner, talia.ProfileId)).Single());
        var booked = await N9c1BookedAsync(house.Owner, talia.ProfileId, ask.Id, Guid.NewGuid(), reference);
        await AssertStatusAsync(await N9c1CloseAsync(house.Owner, corin.ProfileId, corinsAsk.Id, reason), HttpStatusCode.OK);

        // Once booked, the details said answer as they stand; other details find the ask ended, and nothing more is told.
        var afterBooking = await N9c1SayMoneySentAsync(talia.Client, ask.Id, N9c1WhishName, N9c1TraineeWhish);
        await AssertStatusAsync(afterBooking, HttpStatusCode.OK);
        Assert.AreEqual(booked with { Outcome = booked.Outcome! with { DecidedByName = null } }, await ReadSlicePayloadAsync<HousePlanAskView>(afterBooking));
        Assert.AreEqual(
            "house_plan_ask_ended",
            (await A7ConflictAsync(await N9c1SayMoneySentAsync(talia.Client, ask.Id, N9c1WhishName, "+961 71 234 568"))).Code);
        Assert.AreEqual(1L, await N9c1TransfersOfAsync(talia.ProfileId));
        Assert.AreEqual(1L, await N9a1QueuedAsync("HousePlanMoneySent", "AggregateId", talia.ProfileId));

        // Delivered, the notice names the trainee and nothing of the money.
        await Step3SweepNotificationsAsync();
        var notice = (await RequiredJsonAsync<RenewalInbox>(await house.Owner.GetAsync("/api/notifications"))).Items
            .Single(item => item.Kind == nameof(CommercialNotificationKind.HousePlanMoneySent));
        Assert.AreEqual(
            ("Talia Wexford says the money is sent", N9c1SentBody, (Guid?)talia.ProfileId),
            (notice.Title, notice.Body, notice.ClientProfileId));

        // The Whish name and number, the reference and the reason are in no log line, no intent's payload and no notice.
        var log = RequiredEveryLogLine.Text;
        var payloads = string.Join('\n', await N9c1TextsAsync(
            """SELECT "PayloadJson"::text FROM notifications."OutboxItems" WHERE "TenantId" = @id""",
            house.TenantId));
        var delivered = string.Join('\n', await N9c1TextsAsync(
            """SELECT "Title" || ' ' || "Body" FROM notifications."Notifications" WHERE "TenantId" = @id""",
            house.TenantId));
        Assert.Contains("Talia Wexford says the money is sent", delivered);
        foreach (var secret in new[] { "Zephyrine", "Quillfeather", N9c1TraineeWhish, "71 234 567", "71234567", "71 234   567", "71-234-567", reference, "Vantablack" })
        {
            Assert.DoesNotContain(secret, log, StringComparison.OrdinalIgnoreCase, $"The log holds '{secret}'.");
            Assert.DoesNotContain(secret, payloads, StringComparison.OrdinalIgnoreCase, $"A payload holds '{secret}'.");
            Assert.DoesNotContain(secret, delivered, StringComparison.OrdinalIgnoreCase, $"A notice holds '{secret}'.");
        }

        // What the log does say: the ask's and the plan's ids.
        Assert.Contains($"A trainee asked for a plan of the house: ask {ask.Id}.", log);
        Assert.Contains($"A trainee said the money of ask {ask.Id} was sent.", log);
        Assert.Contains($"A plan of the house was booked from ask {ask.Id} with its receipt: enrollment {booked.Outcome!.EnrollmentId}.", log);
        Assert.Contains($"An ask for a plan of the house was closed: ask {corinsAsk.Id}.", log);
    }

    // ---------- 5. one staff step books the plan with its receipt ----------

    [TestMethod]
    public async Task N9c1OneStaffStepBooksTheAskedPlanWithItsReceiptOnceUnderItsKeyAndOnlyForTheExactPrice()
    {
        var today = N9b1FStartAtMidday();
        using var space = await N9c1OpenAsync("book");
        var house = space.House;
        using var talia = await N9a1TraineeAsync(house.TenantId, "n9c1-book-talia@example.test", "Talia", "Wexford");
        using var corin = await N9a1TraineeAsync(house.TenantId, "n9c1-book-corin@example.test", "Corin", "Ashgrove");
        var free = (await N9b1FRowsAsync(talia.ProfileId)).Single();
        var ask = await N9c1AskedAsync(talia.Client, space.OfferId);
        await AssertStatusAsync(await N9c1SayMoneySentAsync(talia.Client, ask.Id), HttpStatusCode.OK);

        // Booked in one step: the plan from the house's day, active, with its receipt.
        var key = Guid.NewGuid();
        var response = await N9c1BookAsync(house.Owner, talia.ProfileId, ask.Id, key, 47.5m, "USD", "  WH-1113-7 ");
        await AssertStatusAsync(response, HttpStatusCode.OK);
        var booked = await ReadSlicePayloadAsync<HousePlanAskView>(response);
        var outcome = booked.Outcome!;
        Assert.AreEqual(
            (ask.Id, HousePlanAskState.Booked, HousePlanAskOutcomeKind.Booked, today, (string?)null, (DateOnly?)today, (DateOnly?)today.AddDays(27), "Nour Haddad"),
            (booked.Id, booked.State, outcome.Kind, outcome.DecidedOn, outcome.Reason, outcome.PlanStartDate, outcome.PlanLastDay, outcome.DecidedByName));
        Assert.IsNotNull(booked.MoneySent, "What the trainee said stays with the ask.");
        var enrollmentId = outcome.EnrollmentId!.Value;

        var rows = await N9b1FRowsAsync(talia.ProfileId);
        Assert.HasCount(2, rows);
        Assert.AreEqual(free, rows.Single(item => item.Id == free.Id), "Free runs on as it was.");
        var plan = rows.Single(item => item.Id == enrollmentId);
        Assert.AreEqual(
            (space.Plan.Id, space.OfferId, N9c1PlanName, (HouseTier?)HouseTier.ProPlus, EnrollmentStatus.Active, today, today.AddDays(28)),
            (plan.ProductId, plan.OfferId, plan.ProductName, plan.Tier, plan.Status, plan.StartDate, plan.EndDateExclusive));
        Assert.AreEqual((N9c1Price, "USD", key, (Guid?)null, "Training alone"), (plan.PriceAmount, plan.PriceCurrency, plan.AssignmentCommandId, plan.RenewedFromEnrollmentId, plan.Coverage));
        var receipt = (await N9c1ReceiptsAsync(enrollmentId)).Single();
        Assert.AreEqual(
            (PaymentOperation.Receipt, PaymentSource.Manual, ManualPaymentMethod.MobileWallet, N9c1Price, "USD", "WH-1113-7", key, house.OwnerUserId, RequiredTestClock.UtcNow),
            (receipt.Operation, receipt.Source, receipt.Method, receipt.Amount, receipt.CurrencyCode, receipt.Reference, receipt.IdempotencyKey, receipt.RecordedByUserId, receipt.ReceivedAtUtc));

        // The trainee is on Pro+ with Free still under it, Training granted, and told nothing of the plan's own notices.
        var mine = await ReadSliceAsync<OwnPlansView>(talia.Client, N9b1FPlanUrl);
        Assert.AreEqual(((HouseTier?)HouseTier.ProPlus, EffectiveEnrollmentStatus.Active), (mine.Tier, mine.Free!.Status));
        Assert.IsTrue((await N9b1FTrainingAsync(talia.Client)).IsAllowed);
        await N9b1FAssertToldNothingAsync(enrollmentId);

        // The trainee reads the booking but not who made it.
        Assert.AreEqual(booked with { Outcome = outcome with { DecidedByName = null } }, (await N9c1OwnAsync(talia.Client)).Asks.Single());

        // The same request under the same key answers the same booking; a changed one under it is refused.
        var retry = await N9c1BookAsync(house.Owner, talia.ProfileId, ask.Id, key, 47.50m, "usd", "WH-1113-7");
        await AssertStatusAsync(retry, HttpStatusCode.OK);
        Assert.AreEqual(booked, await ReadSlicePayloadAsync<HousePlanAskView>(retry));
        foreach (var (amount, reference, what) in new[] { (N9c1Price, "WH-1113-8", "another reference"), (48m, "WH-1113-7", "another amount") })
        {
            var reused = await A7ConflictAsync(await N9c1BookAsync(house.Owner, talia.ProfileId, ask.Id, key, amount, "USD", reference));
            Assert.AreEqual("idempotency_key_reused", reused.Code, what);
        }

        // Booked again under a new key: the ask has ended.
        Assert.AreEqual(
            "house_plan_ask_ended",
            (await A7ConflictAsync(await N9c1BookAsync(house.Owner, talia.ProfileId, ask.Id, Guid.NewGuid()))).Code);
        Assert.HasCount(2, await N9b1FRowsAsync(talia.ProfileId));
        Assert.HasCount(1, await N9c1ReceiptsAsync(enrollmentId));
        Assert.AreEqual(1L, await N9c1ReceiptsOfAsync(talia.ProfileId));

        // Corin's ask: a key a plan, a booking or a staff plan already carries is refused, and so is anything but the
        // exact price in the plan's currency. Nothing is stored.
        var corinsAsk = await N9c1AskedAsync(corin.Client, space.OfferId);
        var corinsFree = (await N9b1FRowsAsync(corin.ProfileId)).Single();
        var extra = await N9c1TieredProductAsync(house.Owner, "N9c1 Messages Extra", 4, 12.25m, null, "Messaging");
        var staffKey = Guid.NewGuid();
        await AssertStatusAsync(await N9c1EnrollAsync(house.Owner, corin.ProfileId, extra.Offers[0].Id, today, staffKey), HttpStatusCode.OK);
        foreach (var (used, what) in new[] { (corinsFree.AssignmentCommandId, "Free's own key"), (key, "Talia's booking"), (staffKey, "a staff plan") })
        {
            var reused = await A7ConflictAsync(await N9c1BookAsync(house.Owner, corin.ProfileId, corinsAsk.Id, used));
            Assert.AreEqual("idempotency_key_reused", reused.Code, what);
        }

        Assert.AreEqual(
            "Record the plan's exact price, USD 47.50. A part books nothing: wait for the rest, or close the ask.",
            await A7FieldErrorAsync(await N9c1BookAsync(house.Owner, corin.ProfileId, corinsAsk.Id, Guid.NewGuid(), 20m), "amount"));
        Assert.AreEqual(
            "Record the plan's exact price, USD 47.50. A part books nothing: wait for the rest, or close the ask.",
            await A7FieldErrorAsync(await N9c1BookAsync(house.Owner, corin.ProfileId, corinsAsk.Id, Guid.NewGuid(), 95m), "amount"));
        Assert.AreEqual(
            "Record the money in the plan's own currency, USD.",
            await A7FieldErrorAsync(await N9c1BookAsync(house.Owner, corin.ProfileId, corinsAsk.Id, Guid.NewGuid(), N9c1Price, "EUR"), "currencyCode"));
        Assert.AreEqual(
            "Choose the currency the money came in: a three-letter code such as USD.",
            await A7FieldErrorAsync(await N9c1BookAsync(house.Owner, corin.ProfileId, corinsAsk.Id, Guid.NewGuid(), N9c1Price, "US"), "currencyCode"));
        Assert.AreEqual(
            MoneyRules.TwoDecimalsMessage,
            await A7FieldErrorAsync(await N9c1BookAsync(house.Owner, corin.ProfileId, corinsAsk.Id, Guid.NewGuid(), 47.505m), "amount"));
        Assert.AreEqual(
            MoneyRules.RangeMessage,
            await A7FieldErrorAsync(await N9c1BookAsync(house.Owner, corin.ProfileId, corinsAsk.Id, Guid.NewGuid(), 0m), "amount"));
        Assert.AreEqual(
            "An idempotency key is required.",
            await A7FieldErrorAsync(await N9c1BookAsync(house.Owner, corin.ProfileId, corinsAsk.Id, Guid.Empty), "idempotencyKey"));
        Assert.AreEqual(
            HousePlanAskRule.ReferenceRefusal,
            await A7FieldErrorAsync(await N9c1BookAsync(house.Owner, corin.ProfileId, corinsAsk.Id, Guid.NewGuid(), N9c1Price, "USD", new string('w', 201)), "reference"));

        var corinsRows = await N9b1FRowsAsync(corin.ProfileId);
        Assert.HasCount(2, corinsRows);
        Assert.IsFalse(corinsRows.Any(item => item.Tier == HouseTier.ProPlus), "No Pro+ plan was booked for Corin.");
        Assert.AreEqual(0L, await N9c1ReceiptsOfAsync(corin.ProfileId));
        Assert.AreEqual(0L, await N9c1OutcomesOfAsync(corin.ProfileId));
        Assert.AreEqual(HousePlanAskState.Asked, (await N9c1StaffListAsync(house.Owner, corin.ProfileId)).Single().State);
    }

    // ---------- 6. one ask booked twice at once ----------

    [TestMethod]
    public async Task N9c1OneAskBookedTwiceAtOnceBooksOnePlanWithOneReceipt()
    {
        N9b1FStartAtMidday();
        using var space = await N9c1OpenAsync("race", withCoach: true);
        var house = space.House;
        using var talia = await N9a1TraineeAsync(house.TenantId, "n9c1-race-talia@example.test", "Talia", "Wexford");
        var ask = await N9c1AskedAsync(talia.Client, space.OfferId);
        var url = $"{N9c1StaffUrl(talia.ProfileId)}/{ask.Id}/book";

        // The Owner's booking is held at its insert, holding the trainee's record; the Coach's, under its own key, waits
        // on that lock and then finds the ask booked.
        await RefreshCsrfAsync(house.Owner);
        await RefreshCsrfAsync(house.Coach!);
        RequiredInsertBarrier.Arm("subscriptions.\"HousePlanAskOutcomes\"", 2);
        HttpResponseMessage byOwner;
        HttpResponseMessage byCoach;
        try
        {
            var owner = house.Owner.PostAsJsonAsync(url, new { amount = N9c1Price, currencyCode = "USD", reference = (string?)null, idempotencyKey = Guid.NewGuid() });
            if (await Task.WhenAny(owner, RequiredInsertBarrier.ArrivedAsync(1)) == owner)
            {
                Assert.Fail($"The Owner's booking ended before its insert: {(await owner).StatusCode}.");
            }

            var coach = house.Coach!.PostAsJsonAsync(url, new { amount = N9c1Price, currencyCode = "USD", reference = (string?)null, idempotencyKey = Guid.NewGuid() });
            await N9b1FAwaitLockWaitAsync("house-plan-book", coach);
            RequiredInsertBarrier.Disarm();
            byOwner = await owner;
            byCoach = await coach;
            Assert.AreEqual(1, RequiredInsertBarrier.Arrived, "Only the Owner's insert was held.");
        }
        finally
        {
            RequiredInsertBarrier.Disarm();
        }

        await AssertStatusAsync(byOwner, HttpStatusCode.OK);
        Assert.AreEqual("house_plan_ask_ended", (await A7ConflictAsync(byCoach)).Code);
        var booked = await ReadSlicePayloadAsync<HousePlanAskView>(byOwner);
        var paid = (await N9b1FRowsAsync(talia.ProfileId)).Where(item => item.Tier == HouseTier.ProPlus).ToArray();
        Assert.AreEqual(booked.Outcome!.EnrollmentId, paid.Single().Id);
        Assert.AreEqual(1L, await N9c1ReceiptsOfAsync(talia.ProfileId));
        Assert.AreEqual(1L, await N9c1OutcomesOfAsync(talia.ProfileId));
    }

    // ---------- 7. the next pass, and one paid plan at a time ----------

    [TestMethod]
    public async Task N9c1ANextPassStartsWhenThePaidPlanRunningEndsAndTheDatabaseKeepsOnePaidPlanAtATime()
    {
        var today = N9b1FStartAtMidday();
        using var space = await N9c1OpenAsync("next");
        var house = space.House;
        using var talia = await N9a1TraineeAsync(house.TenantId, "n9c1-next-talia@example.test", "Talia", "Wexford");

        var first = await N9c1AskAndBookAsync(space, talia);
        Assert.AreEqual(((DateOnly?)today, (DateOnly?)today.AddDays(27)), (first.Outcome!.PlanStartDate, first.Outcome.PlanLastDay));

        // Asked and booked ten days in, while the first runs: it starts the day the first ends, no gap and no overlap.
        N9b1FSetHouseDay(today.AddDays(10));
        var second = await N9c1AskAndBookAsync(space, talia);
        Assert.AreEqual(
            (today.AddDays(10), (DateOnly?)today.AddDays(28), (DateOnly?)today.AddDays(55)),
            (second.Outcome!.DecidedOn, second.Outcome.PlanStartDate, second.Outcome.PlanLastDay));

        // Once both have ended, a booking starts on the house's new day.
        N9b1FSetHouseDay(today.AddDays(70));
        var third = await N9c1AskAndBookAsync(space, talia);
        Assert.AreEqual(((DateOnly?)today.AddDays(70), (DateOnly?)today.AddDays(97)), (third.Outcome!.PlanStartDate, third.Outcome.PlanLastDay));
        var paid = (await N9b1FRowsAsync(talia.ProfileId)).Where(item => item.Tier == HouseTier.ProPlus).ToArray();
        CollectionAssert.AreEqual(
            new[] { (today, today.AddDays(28)), (today.AddDays(28), today.AddDays(56)), (today.AddDays(70), today.AddDays(98)) },
            paid.Select(item => (item.StartDate, item.EndDateExclusive)).ToArray());
        Assert.AreEqual(3L, await N9c1ReceiptsOfAsync(talia.ProfileId));

        // Another Pro+ plan over the same days, of another feature, through the staff's own booking: the database
        // refuses it, whatever its features, and the staff are told the days are taken.
        var nutrition = await N9c1TieredProductAsync(house.Owner, "N9c1 Nutrition Pass", 4, 39.25m, "ProPlus", "Nutrition");
        var overlap = await N9c1EnrollAsync(house.Owner, talia.ProfileId, nutrition.Offers[0].Id, today.AddDays(75), Guid.NewGuid());
        Assert.AreEqual("entitlement_overlap", (await A7ConflictAsync(overlap)).Code);

        // And whoever writes: a copy of the running plan's row five days on is refused by the exclusion; one from its
        // end fits.
        var running = paid[2];
        var refused = await Assert.ThrowsExactlyAsync<PostgresException>(() => Phase6ExecuteAsync(
            N9b1FCopyRowSql,
            ("id", running.Id),
            ("tier", "ProPlus"),
            ("start", running.StartDate.AddDays(5))));
        Assert.AreEqual(
            (PostgresErrorCodes.ExclusionViolation, "EX_ClientEnrollments_OneHousePaidPlanAtATime"),
            (refused.SqlState, refused.ConstraintName));
        await Phase6ExecuteAsync(N9b1FCopyRowSql, ("id", running.Id), ("tier", "ProPlus"), ("start", running.EndDateExclusive));
        Assert.HasCount(4, (await N9b1FRowsAsync(talia.ProfileId)).Where(item => item.Tier == HouseTier.ProPlus).ToArray());
    }

    [TestMethod]
    public async Task N9c1ABookingWaitsOnlyForThePlansItCannotRunBeside()
    {
        var today = N9b1FStartAtMidday();
        using var space = await N9c1OpenAsync("beside");
        var house = space.House;
        using var corin = await N9a1TraineeAsync(house.TenantId, "n9c1-beside-corin@example.test", "Corin", "Ashgrove", address: "198.51.100.31");
        using var dana = await N9a1TraineeAsync(house.TenantId, "n9c1-beside-dana@example.test", "Dana", "Fairbrook", address: "198.51.100.32");
        using var emil = await N9a1TraineeAsync(house.TenantId, "n9c1-beside-emil@example.test", "Emil", "Thornbury", address: "198.51.100.33");

        // Corin: a plan without a tier covering Messaging alone, paid, from today.
        var messaging = await N9c1TieredProductAsync(house.Owner, "N9c1 Messages Extra", 4, 12.25m, null, "Messaging");
        await N9c1PaidPlanAsync(house.Owner, corin.ProfileId, messaging.Offers[0].Id, today, 12.25m);
        // Dana: a plan without a tier covering Training, paid, from today for six weeks.
        var training = await N9c1TieredProductAsync(house.Owner, "N9c1 Coached Training", 6, 64.50m, null, "Training");
        await N9c1PaidPlanAsync(house.Owner, dana.ProfileId, training.Offers[0].Id, today, 64.50m);
        // Emil: a Pro+ plan from today, cancelled.
        var mistake = await N9c1EnrollAsync(house.Owner, emil.ProfileId, space.OfferId, today, Guid.NewGuid());
        await AssertStatusAsync(mistake, HttpStatusCode.OK);
        var cancelled = await RequiredJsonAsync<RenewalEnrollment>(mistake);
        await RefreshCsrfAsync(house.Owner);
        await AssertStatusAsync(
            await house.Owner.PostAsJsonAsync($"/api/commercial/enrollments/{cancelled.Id}/cancel", new { reason = "Booked by mistake", cancelled.Version }),
            HttpStatusCode.OK);

        // A plan of other features, Free and a cancelled plan never delay it; one holding Training alone does.
        foreach (var (trainee, start, what) in new[]
        {
            (corin, today, "a plan of Messaging alone runs beside it"),
            (dana, today.AddDays(42), "a plan holding Training alone runs until then"),
            (emil, today, "a cancelled Pro+ plan holds nothing"),
        })
        {
            var booked = await N9c1AskAndBookAsync(space, trainee);
            Assert.AreEqual(((DateOnly?)start, (DateOnly?)start.AddDays(27)), (booked.Outcome!.PlanStartDate, booked.Outcome.PlanLastDay), what);
            var running = (await N9b1FRowsAsync(trainee.ProfileId))
                .Single(item => item.Tier == HouseTier.ProPlus && item.Status == EnrollmentStatus.Active);
            Assert.AreEqual((booked.Outcome.EnrollmentId, start, start.AddDays(28)), ((Guid?)running.Id, running.StartDate, running.EndDateExclusive), what);
        }
    }

    [TestMethod]
    public async Task N9c1ABookingTheDatabaseRefusesAsAnOverlapIsAConflictAndStoresNothing()
    {
        N9b1FStartAtMidday();
        using var space = await N9c1OpenAsync("refused");
        var house = space.House;
        using var talia = await N9a1TraineeAsync(house.TenantId, "n9c1-refused-talia@example.test", "Talia", "Wexford");
        var ask = await N9c1AskedAsync(talia.Client, space.OfferId);
        var key = Guid.NewGuid();

        // A plan booked meanwhile by something the service did not read: the database refuses the insert as an overlap.
        await Phase6ExecuteAsync(
            $$"""
            CREATE FUNCTION subscriptions.n9c1_overlap_meanwhile() RETURNS trigger AS $body$
            BEGIN
                IF NEW."ClientProfileId" = '{{talia.ProfileId}}' AND NEW."HouseTier" = 'ProPlus' THEN
                    RAISE EXCEPTION 'A plan booked meanwhile covers these days' USING ERRCODE = '23P01';
                END IF;
                RETURN NEW;
            END;
            $body$ LANGUAGE plpgsql;
            CREATE TRIGGER "TR_ZZ_N9c1OverlapMeanwhile" BEFORE INSERT ON subscriptions."ClientEnrollments"
            FOR EACH ROW EXECUTE FUNCTION subscriptions.n9c1_overlap_meanwhile();
            """);
        HttpResponseMessage refused;
        try
        {
            refused = await N9c1BookAsync(house.Owner, talia.ProfileId, ask.Id, key);
        }
        finally
        {
            await Phase6ExecuteAsync(
                """
                DROP TRIGGER "TR_ZZ_N9c1OverlapMeanwhile" ON subscriptions."ClientEnrollments";
                DROP FUNCTION subscriptions.n9c1_overlap_meanwhile();
                """);
        }

        Assert.AreEqual(
            ("entitlement_overlap", "Another plan already covers some of these days. Reload the client to check their plans."),
            await A7ConflictAsync(refused));

        // Nothing of it stands: no plan, no receipt, no outcome, and the key unused.
        Assert.IsFalse((await N9b1FRowsAsync(talia.ProfileId)).Any(item => item.Tier == HouseTier.ProPlus));
        Assert.AreEqual(0L, await N9c1ReceiptsOfAsync(talia.ProfileId));
        Assert.AreEqual(0L, await N9c1OutcomesOfAsync(talia.ProfileId));
        Assert.AreEqual(0L, await N9c1CountAsync("""SELECT count(*) FROM subscriptions."PaymentRecords" WHERE "IdempotencyKey" = @id""", key));
        Assert.AreEqual(HousePlanAskState.Asked, (await N9c1StaffListAsync(house.Owner, talia.ProfileId)).Single().State);

        // Once nothing stands in the way, the same key books it.
        Assert.AreEqual(HousePlanAskState.Booked, (await N9c1BookedAsync(house.Owner, talia.ProfileId, ask.Id, key)).State);
    }

    [TestMethod]
    public async Task N9c1TheSameBookingSentTwiceAtOnceUnderOneKeyBooksOnceAndAnswersBoth()
    {
        N9b1FStartAtMidday();
        using var space = await N9c1OpenAsync("retry");
        var house = space.House;
        using var talia = await N9a1TraineeAsync(house.TenantId, "n9c1-retry-talia@example.test", "Talia", "Wexford");
        var ask = await N9c1AskedAsync(talia.Client, space.OfferId);
        var url = $"{N9c1StaffUrl(talia.ProfileId)}/{ask.Id}/book";
        var body = new { amount = N9c1Price, currencyCode = "USD", reference = "WH 2290", idempotencyKey = Guid.NewGuid() };

        // The first is held at its insert holding the trainee's record; the second, the same request, waits on that lock
        // and then finds the first's booking under its key.
        await RefreshCsrfAsync(house.Owner);
        RequiredInsertBarrier.Arm("subscriptions.\"HousePlanAskOutcomes\"", 2);
        HttpResponseMessage first;
        HttpResponseMessage second;
        try
        {
            var a = house.Owner.PostAsJsonAsync(url, body);
            if (await Task.WhenAny(a, RequiredInsertBarrier.ArrivedAsync(1)) == a)
            {
                Assert.Fail($"The first booking ended before its insert: {(await a).StatusCode}.");
            }

            var b = house.Owner.PostAsJsonAsync(url, body);
            await N9b1FAwaitLockWaitAsync("house-plan-book", b);
            RequiredInsertBarrier.Disarm();
            first = await a;
            second = await b;
            Assert.AreEqual(1, RequiredInsertBarrier.Arrived, "Only the first booking's insert was held.");
        }
        finally
        {
            RequiredInsertBarrier.Disarm();
        }

        await AssertStatusAsync(first, HttpStatusCode.OK);
        await AssertStatusAsync(second, HttpStatusCode.OK);
        var once = await ReadSlicePayloadAsync<HousePlanAskView>(first);
        Assert.AreEqual(once, await ReadSlicePayloadAsync<HousePlanAskView>(second));
        Assert.AreEqual(HousePlanAskState.Booked, once.State);
        var paid = (await N9b1FRowsAsync(talia.ProfileId)).Where(item => item.Tier == HouseTier.ProPlus).ToArray();
        Assert.AreEqual(once.Outcome!.EnrollmentId, paid.Single().Id);
        Assert.AreEqual(1L, await N9c1ReceiptsOfAsync(talia.ProfileId));
        Assert.AreEqual(1L, await N9c1OutcomesOfAsync(talia.ProfileId));
    }

    // ---------- 8. closing an ask ----------

    [TestMethod]
    public async Task N9c1AClosedAskKeepsItsReasonForTheTraineeBooksNothingAndTheTraineeMayAskAgain()
    {
        const string reason = "No transfer reached TB Gym within a week.\nAsk again whenever you like.";
        var today = N9b1FStartAtMidday();
        using var space = await N9c1OpenAsync("close", withCoach: true);
        var house = space.House;
        using var talia = await N9a1TraineeAsync(house.TenantId, "n9c1-close-talia@example.test", "Talia", "Wexford");
        var ask = await N9c1AskedAsync(talia.Client, space.OfferId);

        // A reason is required, and not a long one.
        foreach (var missing in new[] { null, string.Empty, "   ", new string('r', 501) })
        {
            Assert.AreEqual(
                HousePlanAskRule.ReasonRefusal,
                await A7FieldErrorAsync(await N9c1CloseAsync(house.Coach!, talia.ProfileId, ask.Id, missing), "reason"),
                $"'{missing}'");
        }

        Assert.AreEqual(0L, await N9c1OutcomesOfAsync(talia.ProfileId));

        // Closed by the trainee's coach: the reason is kept, trimmed, and the staff read who closed it.
        var closing = await N9c1CloseAsync(house.Coach!, talia.ProfileId, ask.Id, $"  {reason}  ");
        await AssertStatusAsync(closing, HttpStatusCode.OK);
        var closed = await ReadSlicePayloadAsync<HousePlanAskView>(closing);
        Assert.AreEqual(
            (HousePlanAskState.Closed, new HousePlanAskOutcomeView(HousePlanAskOutcomeKind.Closed, today, reason, null, null, null, "Lea Khoury")),
            (closed.State, closed.Outcome));
        Assert.AreEqual(closed, (await N9c1StaffListAsync(house.Owner, talia.ProfileId)).Single());
        Assert.AreEqual(
            closed with { Outcome = closed.Outcome! with { DecidedByName = null } },
            (await N9c1OwnAsync(talia.Client)).Asks.Single(),
            "The trainee reads why, never who.");

        // The same closing again answers it; another reason, a booking or the money said sent find it ended.
        var twice = await N9c1CloseAsync(house.Owner, talia.ProfileId, ask.Id, reason);
        await AssertStatusAsync(twice, HttpStatusCode.OK);
        Assert.AreEqual(closed, await ReadSlicePayloadAsync<HousePlanAskView>(twice));
        Assert.AreEqual("house_plan_ask_ended", (await A7ConflictAsync(await N9c1CloseAsync(house.Owner, talia.ProfileId, ask.Id, "Another reason"))).Code);
        Assert.AreEqual("house_plan_ask_ended", (await A7ConflictAsync(await N9c1BookAsync(house.Owner, talia.ProfileId, ask.Id, Guid.NewGuid()))).Code);
        Assert.AreEqual("house_plan_ask_ended", (await A7ConflictAsync(await N9c1SayMoneySentAsync(talia.Client, ask.Id))).Code);
        Assert.AreEqual(1L, await N9c1OutcomesOfAsync(talia.ProfileId));
        Assert.AreEqual(0L, await N9c1TransfersOfAsync(talia.ProfileId));
        Assert.HasCount(1, await N9b1FRowsAsync(talia.ProfileId), "Nothing but Free.");

        // The trainee may ask again: a new ask, read first.
        RequiredTestClock.Advance(TimeSpan.FromMinutes(3));
        var again = await N9c1AskedAsync(talia.Client, space.OfferId);
        Assert.AreNotEqual(ask.Id, again.Id);
        CollectionAssert.AreEqual(
            new[] { again.Id, ask.Id },
            (await N9c1OwnAsync(talia.Client)).Asks.Select(item => item.Id).ToArray());
    }

    // ---------- 9. who may: the house alone, its trainee, its Owner and the trainee's coach ----------

    [TestMethod]
    public async Task N9c1AsksLiveInTheHouseAloneAndNoOtherSpaceReadsOrWritesThem()
    {
        N9b1FStartAtMidday();
        using var space = await N9c1OpenAsync("where");
        var house = space.House;
        using var talia = await N9a1TraineeAsync(house.TenantId, "n9c1-where-talia@example.test", "Talia", "Wexford");
        var ask = await N9c1AskedAsync(talia.Client, space.OfferId);
        using var coach = CreateClient();
        var coachSpace = await RegisterCoachAsync(coach, "n9c1-where-zeina@example.test", "Zeina Aoun", "N9c1 Where Gym");
        var outside = await B4aProductAsync(coach, "N9c1 Outside Plan", B4aOfferRequest(4, 52.25m, "USD", "Training"));
        using var karim = CreateClient();
        var karimId = await InviteAndAcceptAsync(coach, karim, "n9c1-where-karim@example.test", true);

        // A coach's client in their coaching space: it has no asks, not even of the house's plans.
        await AssertStatusAsync(await karim.GetAsync(N9c1PlansUrl), HttpStatusCode.NotFound);
        await AssertStatusAsync(await N9c1AskAsync(karim, space.OfferId), HttpStatusCode.NotFound);
        await AssertStatusAsync(await N9c1AskAsync(karim, outside.Offers[0].Id), HttpStatusCode.NotFound);
        await AssertStatusAsync(await N9c1SayMoneySentAsync(karim, ask.Id), HttpStatusCode.NotFound);
        // In the house, where they are nobody: refused.
        SetTenant(karim, house.TenantId);
        await AssertStatusAsync(await karim.GetAsync(N9c1PlansUrl), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await N9c1AskAsync(karim, space.OfferId), HttpStatusCode.Forbidden);

        // The trainee naming the coaching space's plan: not one of the house's.
        Assert.AreEqual("house_plan_not_on_sale", (await A7ConflictAsync(await N9c1AskAsync(talia.Client, outside.Offers[0].Id))).Code);

        // The coaching space's owner naming the trainee in their own space: no such client; in the house: refused.
        await AssertStatusAsync(await coach.GetAsync(N9c1StaffUrl(talia.ProfileId)), HttpStatusCode.NotFound);
        await AssertStatusAsync(await N9c1BookAsync(coach, talia.ProfileId, ask.Id, Guid.NewGuid()), HttpStatusCode.NotFound);
        await AssertStatusAsync(await N9c1CloseAsync(coach, talia.ProfileId, ask.Id, "Not ours"), HttpStatusCode.NotFound);
        SetTenant(coach, house.TenantId);
        await AssertStatusAsync(await coach.GetAsync(N9c1StaffUrl(talia.ProfileId)), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await N9c1BookAsync(coach, talia.ProfileId, ask.Id, Guid.NewGuid()), HttpStatusCode.Forbidden);

        // The house's owner in the coaching space: refused; naming its client in the house: not found.
        SetTenant(house.Owner, coachSpace);
        await AssertStatusAsync(await house.Owner.GetAsync(N9c1StaffUrl(karimId)), HttpStatusCode.Forbidden);
        SetTenant(house.Owner, house.TenantId);
        await AssertStatusAsync(await house.Owner.GetAsync(N9c1StaffUrl(karimId)), HttpStatusCode.NotFound);
        await AssertStatusAsync(await N9c1BookAsync(house.Owner, karimId, ask.Id, Guid.NewGuid()), HttpStatusCode.NotFound);
        await AssertStatusAsync(await N9c1CloseAsync(house.Owner, karimId, ask.Id, "Not ours"), HttpStatusCode.NotFound);
        await AssertStatusAsync(await house.Owner.GetAsync(N9c1StaffUrl(Guid.NewGuid())), HttpStatusCode.NotFound);

        // Nothing was written anywhere but the one ask.
        Assert.AreEqual(1L, await A7ScalarAsync("""SELECT count(*) FROM subscriptions."HousePlanAsks" """));
        Assert.AreEqual(0L, await A7ScalarAsync("""SELECT count(*) FROM subscriptions."HousePlanAskOutcomes" """));
        Assert.AreEqual(0L, await A7ScalarAsync("""SELECT count(*) FROM subscriptions."HousePlanTransfers" """));
        Assert.AreEqual(HousePlanAskState.Asked, (await N9c1OwnAsync(talia.Client)).Asks.Single().State);
    }

    [TestMethod]
    public async Task N9c1OnlyTheTraineeAsksAndOnlyTheOwnerAndTheTraineesCoachDecide()
    {
        const string email = "n9c1-roles-talia@example.test";
        N9b1FStartAtMidday();
        using var space = await N9c1OpenAsync("roles", withCoach: true);
        var house = space.House;
        using var talia = await N9a1TraineeAsync(house.TenantId, email, "Talia", "Wexford");
        using var corin = await N9a1TraineeAsync(house.TenantId, "n9c1-roles-corin@example.test", "Corin", "Ashgrove");
        Assert.AreEqual(house.CoachUserId, (await N9a1PersonAsync(email)).Profiles.Single().AssignedCoachUserId);
        // A second Coach joins after the trainee: not their coach.
        using var second = CreateClient();
        var secondUserId = await JoinAsCoachAsync(house.Owner, second, "n9c1-roles-rania@example.test", "Rania Saab");
        var ask = await N9c1AskedAsync(talia.Client, space.OfferId);

        // The second Coach: every staff route answers as if the trainee did not exist, and they were told nothing.
        await AssertStatusAsync(await second.GetAsync(N9c1StaffUrl(talia.ProfileId)), HttpStatusCode.NotFound);
        await AssertStatusAsync(await N9c1BookAsync(second, talia.ProfileId, ask.Id, Guid.NewGuid()), HttpStatusCode.NotFound);
        await AssertStatusAsync(await N9c1CloseAsync(second, talia.ProfileId, ask.Id, "Not mine"), HttpStatusCode.NotFound);
        Assert.AreEqual(0L, await N9a1QueuedAsync("HousePlanAsked", "RecipientUserId", secondUserId));

        // Staff on the trainee's routes, and the trainee on the staff's: refused.
        foreach (var (staff, who) in new[] { (house.Owner, "the Owner"), (house.Coach!, "the trainee's coach"), (second, "another Coach") })
        {
            await AssertStatusAsync(await staff.GetAsync(N9c1PlansUrl), HttpStatusCode.Forbidden);
            await AssertStatusAsync(await N9c1AskAsync(staff, space.OfferId), HttpStatusCode.Forbidden);
            await AssertStatusAsync(await N9c1SayMoneySentAsync(staff, ask.Id), HttpStatusCode.Forbidden);
            Assert.AreEqual(1L, await N9c1AsksOfAsync(talia.ProfileId), who);
        }

        await AssertStatusAsync(await talia.Client.GetAsync(N9c1StaffUrl(talia.ProfileId)), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await N9c1BookAsync(talia.Client, talia.ProfileId, ask.Id, Guid.NewGuid()), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await N9c1CloseAsync(talia.Client, talia.ProfileId, ask.Id, "Changed my mind"), HttpStatusCode.Forbidden);

        // Another trainee cannot touch it either: not their ask.
        await AssertStatusAsync(await N9c1SayMoneySentAsync(corin.Client, ask.Id), HttpStatusCode.NotFound);

        // A client the Owner invited is no trainee of their own: with the Whish number filled, the house's asks are not
        // theirs to read or make, nor anyone's money theirs to say sent. Nothing is kept or queued.
        using var rita = CreateClient();
        var ritaId = await InviteAndAcceptAsync(house.Owner, rita, "n9c1-roles-rita@example.test", true);
        Assert.IsFalse((await N9a1PersonAsync("n9c1-roles-rita@example.test")).Profiles.Single().IsSelfDirected);
        const string asksSql = """SELECT count(*) FROM subscriptions."HousePlanAsks" """;
        const string noticesSql = """SELECT count(*) FROM notifications."OutboxItems" WHERE "Kind" IN ('HousePlanAsked', 'HousePlanMoneySent')""";
        var asksBefore = await A7ScalarAsync(asksSql);
        var noticesBefore = await A7ScalarAsync(noticesSql);
        await AssertStatusAsync(await rita.GetAsync(N9c1PlansUrl), HttpStatusCode.NotFound);
        await AssertStatusAsync(await N9c1AskAsync(rita, space.OfferId), HttpStatusCode.NotFound);
        await AssertStatusAsync(await N9c1SayMoneySentAsync(rita, ask.Id), HttpStatusCode.NotFound);
        Assert.AreEqual((asksBefore, noticesBefore), (await A7ScalarAsync(asksSql), await A7ScalarAsync(noticesSql)));
        Assert.AreEqual(0L, await N9c1AsksOfAsync(ritaId));
        Assert.AreEqual(0L, await N9c1TransfersOfAsync(talia.ProfileId));

        // The Owner and the trainee's coach read it; a trainee who asked nothing has no asks.
        Assert.AreEqual(ask, (await N9c1StaffListAsync(house.Coach!, talia.ProfileId)).Single());
        Assert.AreEqual(ask, (await N9c1StaffListAsync(house.Owner, talia.ProfileId)).Single());
        Assert.IsEmpty(await N9c1StaffListAsync(house.Owner, corin.ProfileId));
        Assert.AreEqual(0L, await N9c1OutcomesOfAsync(talia.ProfileId));
        Assert.AreEqual(0L, await N9c1TransfersOfAsync(talia.ProfileId));
    }

    // ---------- 10. leaving and being paused ----------

    [TestMethod]
    public async Task N9c1ATraineeWhoLeftCannotAskAndTheirAskCannotBeBookedOrClosed()
    {
        N9b1FStartAtMidday();
        using var space = await N9c1OpenAsync("leave");
        var house = space.House;
        using var talia = await N9a1TraineeAsync(house.TenantId, "n9c1-leave-talia@example.test", "Talia", "Wexford");
        var ask = await N9c1AskedAsync(talia.Client, space.OfferId);
        await N9a1LeaveAsync(talia.Client, "Training somewhere else for a while");

        // Gone from the house: their routes refuse them as they refuse anyone not in it.
        await AssertStatusAsync(await talia.Client.GetAsync(N9c1PlansUrl), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await N9c1AskAsync(talia.Client, space.OfferId), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await N9c1SayMoneySentAsync(talia.Client, ask.Id), HttpStatusCode.Forbidden);

        // The staff still read the ask, and neither book nor close it: the record is read-only.
        Assert.AreEqual(ask, (await N9c1StaffListAsync(house.Owner, talia.ProfileId)).Single());
        Assert.AreEqual("client_released", (await A7ConflictAsync(await N9c1BookAsync(house.Owner, talia.ProfileId, ask.Id, Guid.NewGuid()))).Code);
        Assert.AreEqual("client_released", (await A7ConflictAsync(await N9c1CloseAsync(house.Owner, talia.ProfileId, ask.Id, "Left"))).Code);
        Assert.AreEqual(0L, await N9c1OutcomesOfAsync(talia.ProfileId));
        Assert.AreEqual(0L, await N9c1ReceiptsOfAsync(talia.ProfileId));
        Assert.IsFalse((await N9b1FRowsAsync(talia.ProfileId)).Any(item => item.Tier == HouseTier.ProPlus));
    }

    [TestMethod]
    public async Task N9c1ABlockedTraineeCannotAskOrBeBookedButMaySayTheMoneyWasSent()
    {
        N9b1FStartAtMidday();
        using var space = await N9c1OpenAsync("block");
        var house = space.House;
        var eight = (await N9c1AddOptionAsync(house.Owner, space.Plan.Id, 8, 89.75m)).Offers.Single(item => item.DurationCount == 8);
        using var talia = await N9a1TraineeAsync(house.TenantId, "n9c1-block-talia@example.test", "Talia", "Wexford");
        var ask = await N9c1AskedAsync(talia.Client, space.OfferId);
        await N9c1RelationshipAsync(house.Owner, talia.ProfileId, "block");

        // Paused: asks are closed to them, the ask they made still read.
        var paused = await N9c1OwnAsync(talia.Client);
        Assert.AreEqual((false, (string?)null), (paused.AsksOpen, paused.WhishNumber));
        Assert.IsEmpty(paused.Plans);
        Assert.AreEqual(ask, paused.Asks.Single());
        foreach (var offerId in new[] { space.OfferId, eight.Id })
        {
            Assert.AreEqual("client_blocked", (await A7ConflictAsync(await N9c1AskAsync(talia.Client, offerId))).Code);
        }

        Assert.AreEqual(1L, await N9c1AsksOfAsync(talia.ProfileId));

        // The money may still be said sent for the ask that exists; the staff cannot book it while paused.
        await AssertStatusAsync(await N9c1SayMoneySentAsync(talia.Client, ask.Id), HttpStatusCode.OK);
        Assert.AreEqual("client_blocked", (await A7ConflictAsync(await N9c1BookAsync(house.Owner, talia.ProfileId, ask.Id, Guid.NewGuid()))).Code);
        Assert.AreEqual(0L, await N9c1OutcomesOfAsync(talia.ProfileId));
        Assert.AreEqual(0L, await N9c1ReceiptsOfAsync(talia.ProfileId));

        // Unpaused, the booking goes through.
        await N9c1RelationshipAsync(house.Owner, talia.ProfileId, "unblock");
        Assert.AreEqual(HousePlanAskState.Booked, (await N9c1BookedAsync(house.Owner, talia.ProfileId, ask.Id, Guid.NewGuid())).State);
    }

    // ---------- 11. the database's guards ----------

    [TestMethod]
    public async Task N9c1TheDatabaseKeepsAsksTheirWordAndTheirOutcomeAsWritten()
    {
        var today = N9b1FStartAtMidday();
        using var space = await N9c1OpenAsync("guards");
        var house = space.House;
        using var talia = await N9a1TraineeAsync(house.TenantId, "n9c1-guards-talia@example.test", "Talia", "Wexford");
        using var corin = await N9a1TraineeAsync(house.TenantId, "n9c1-guards-corin@example.test", "Corin", "Ashgrove");
        var ask = await N9c1AskedAsync(talia.Client, space.OfferId);
        await AssertStatusAsync(await N9c1SayMoneySentAsync(talia.Client, ask.Id), HttpStatusCode.OK);
        await N9c1BookedAsync(house.Owner, talia.ProfileId, ask.Id, Guid.NewGuid());

        // Asks and their outcomes are never rewritten nor deleted.
        foreach (var (sql, table) in new[]
        {
            ($"""UPDATE subscriptions."HousePlanAsks" SET "AskedOn" = "AskedOn" + 1 WHERE "Id" = '{ask.Id}'""", "HousePlanAsks"),
            ($"""DELETE FROM subscriptions."HousePlanAsks" WHERE "Id" = '{ask.Id}'""", "HousePlanAsks"),
            ($"""UPDATE subscriptions."HousePlanAskOutcomes" SET "DecidedOn" = "DecidedOn" + 1 WHERE "AskId" = '{ask.Id}'""", "HousePlanAskOutcomes"),
            ($"""DELETE FROM subscriptions."HousePlanAskOutcomes" WHERE "AskId" = '{ask.Id}'""", "HousePlanAskOutcomes"),
            ($"""DELETE FROM subscriptions."HousePlanTransfers" WHERE "AskId" = '{ask.Id}'""", "HousePlanTransfers"),
            ($"""UPDATE subscriptions."HousePlanTransfers" SET "WhishName" = 'Someone Else' WHERE "AskId" = '{ask.Id}'""", "HousePlanTransfers"),
            ($"""UPDATE subscriptions."HousePlanTransfers" SET "WhishName" = NULL, "WhishNumber" = NULL WHERE "AskId" = '{ask.Id}'""", "HousePlanTransfers"),
            ($"""
              UPDATE subscriptions."HousePlanTransfers"
              SET "WhishName" = NULL, "WhishNumber" = NULL, "AnonymisedAtUtc" = now(), "SentOn" = "SentOn" - 1
              WHERE "AskId" = '{ask.Id}'
              """, "HousePlanTransfers"),
        })
        {
            var refused = await A7RefusedAsync(sql);
            Assert.AreEqual(("55000", $"{table} is append-only"), (refused.SqlState, refused.MessageText), sql);
        }

        Assert.AreEqual(
            new HousePlanTransferView(N9c1WhishName, N9c1TraineeWhish, today),
            (await N9c1StaffListAsync(house.Owner, talia.ProfileId)).Single().MoneySent);

        // The one change the word ever takes: its details erased, once.
        const string anonymise =
            """UPDATE subscriptions."HousePlanTransfers" SET "WhishName" = NULL, "WhishNumber" = NULL, "AnonymisedAtUtc" = now() WHERE "AskId" = '{0}'""";
        await A7SqlAsync(string.Format(System.Globalization.CultureInfo.InvariantCulture, anonymise, ask.Id));
        var again = await A7RefusedAsync(string.Format(System.Globalization.CultureInfo.InvariantCulture, anonymise, ask.Id));
        Assert.AreEqual(("55000", "HousePlanTransfers is append-only"), (again.SqlState, again.MessageText));
        Assert.AreEqual(new HousePlanTransferView(null, null, today), (await N9c1StaffListAsync(house.Owner, talia.ProfileId)).Single().MoneySent);

        // A booked outcome needs a receipt of the plan's whole price: a part, kept under the plan's own key by the
        // staff's ordinary routes, is refused.
        var corinsAsk = await N9c1AskedAsync(corin.Client, space.OfferId);
        var key = Guid.NewGuid();
        var planResponse = await N9c1EnrollAsync(house.Owner, corin.ProfileId, space.OfferId, today, key);
        await AssertStatusAsync(planResponse, HttpStatusCode.OK);
        var plan = await ReadSlicePayloadAsync<ClientEnrollmentView>(planResponse);
        await RefreshCsrfAsync(house.Owner);
        await AssertStatusAsync(
            await house.Owner.PostAsJsonAsync($"/api/commercial/enrollments/{plan.Id}/payments", A7PaymentRequest(20m, today, key)),
            HttpStatusCode.OK);
        var part = await A7RefusedAsync(
            $"""
            INSERT INTO subscriptions."HousePlanAskOutcomes"
                ("Id", "TenantId", "AskId", "ClientProfileId", "Kind", "EnrollmentId", "PaymentRecordId", "CommandId",
                 "DecidedByUserId", "DecidedOn", "DecidedAtUtc")
            SELECT uuidv7(), receipt."TenantId", '{corinsAsk.Id}', '{corin.ProfileId}', 'Booked', receipt."EnrollmentId", receipt."Id",
                   receipt."IdempotencyKey", '{house.OwnerUserId}', current_date, now()
            FROM subscriptions."PaymentRecords" receipt
            WHERE receipt."IdempotencyKey" = '{key}'
            """);
        Assert.AreEqual(
            ("23514", "A booked ask names its own plan and a receipt of that plan's whole price"),
            (part.SqlState, part.MessageText));
        Assert.AreEqual(0L, await N9c1OutcomesOfAsync(corin.ProfileId));

        // An ask is a self-directed trainee's, of an option of the plan and tier it names.
        using var rita = CreateClient();
        var ritaId = await InviteAndAcceptAsync(house.Owner, rita, "n9c1-guards-rita@example.test", true);
        var notSelf = await A7RefusedAsync(N9c1CopyAskSql(ask.Id, $"'{ritaId}'", "\"Tier\""));
        Assert.AreEqual(("23514", "Only a self-directed trainee of the house asks for its plans"), (notSelf.SqlState, notSelf.MessageText));
        var wrongTier = await A7RefusedAsync(N9c1CopyAskSql(ask.Id, "\"ClientProfileId\"", "'Max'"));
        Assert.AreEqual(("23514", "An ask names an option of the plan and the tier it asks for"), (wrongTier.SqlState, wrongTier.MessageText));
        Assert.AreEqual(1L, await N9c1AsksOfAsync(talia.ProfileId));
    }

    // ---------- 12. a coach's Ask to renew is never a trainee's ----------

    [TestMethod]
    public async Task N9c1ATraineeOnAPaidPlanOfTheHouseIsNeverOfferedACoachsAskToRenew()
    {
        var today = N9b1FStartAtMidday();
        using var space = await N9c1OpenAsync("renew");
        var house = space.House;
        using var talia = await N9a1TraineeAsync(house.TenantId, "n9c1-renew-talia@example.test", "Talia", "Wexford");
        await N9c1AskAndBookAsync(space, talia);

        // Two days before the paid plan ends, and two days after: never the coach's ask, whatever the days.
        foreach (var day in new[] { today.AddDays(26), today.AddDays(30) })
        {
            N9b1FSetHouseDay(day);
            var status = await ReadSliceAsync<RenewalStatusView>(talia.Client, RenewalUrl);
            Assert.IsFalse(status.CanAsk, N9a1Day(day));
            await Step3AssertPlanNotEndedAsync(talia.Client);
        }

        Assert.AreEqual(0L, await N9a1QueuedAsync("RenewalRequested", "AggregateId", talia.ProfileId));
        Assert.AreEqual(0L, await N9c1CountAsync("""SELECT count(*) FROM subscriptions."RenewalRequests" WHERE "ClientProfileId" = @id""", talia.ProfileId));

        // The next pass is asked for the house's own way.
        Assert.AreEqual(HousePlanAskState.Asked, (await N9c1AskedAsync(talia.Client, space.OfferId)).State);
    }

    // ---------- 13. closing the account ----------

    [TestMethod]
    public async Task N9c1ClosingTheAccountErasesTheWhishDetailsAndKeepsTheAskTheBookingAndTheReceipt()
    {
        var today = N9b1FStartAtMidday();
        using var space = await N9c1OpenAsync("closure");
        var house = space.House;
        using var talia = await N9a1TraineeAsync(house.TenantId, "n9c1-closure-talia@example.test", "Talia", "Wexford");
        var ask = await N9c1AskedAsync(talia.Client, space.OfferId);
        await AssertStatusAsync(await N9c1SayMoneySentAsync(talia.Client, ask.Id), HttpStatusCode.OK);
        var key = Guid.NewGuid();
        var booked = await N9c1BookedAsync(house.Owner, talia.ProfileId, ask.Id, key);
        var enrollmentId = booked.Outcome!.EnrollmentId!.Value;

        RequiredTestClock.Advance(TimeSpan.FromMinutes(5));
        var closedAt = RequiredTestClock.UtcNow;
        await AssertStatusAsync(await N9eCloseAsync(talia.Client, Password), HttpStatusCode.NoContent);

        // The details are gone from the word, which stays with its day.
        var transfer = (await N9c1TransfersAsync(talia.ProfileId)).Single();
        Assert.AreEqual(
            ((string?)null, (string?)null, (DateTimeOffset?)closedAt, today),
            (transfer.WhishName, transfer.WhishNumber, transfer.AnonymisedAtUtc, transfer.SentOn));

        // The ask, its booking, the plan and its receipt stay.
        Assert.AreEqual(1L, await N9c1AsksOfAsync(talia.ProfileId));
        Assert.AreEqual(1L, await N9c1OutcomesOfAsync(talia.ProfileId));
        Assert.IsTrue((await N9b1FRowsAsync(talia.ProfileId)).Any(item => item.Id == enrollmentId));
        var receipt = (await N9c1ReceiptsAsync(enrollmentId)).Single();
        Assert.AreEqual((N9c1Price, "USD", key), (receipt.Amount, receipt.CurrencyCode, receipt.IdempotencyKey));
        var read = (await N9c1StaffListAsync(house.Owner, talia.ProfileId)).Single();
        Assert.AreEqual(
            (HousePlanAskState.Booked, new HousePlanTransferView(null, null, today), (Guid?)enrollmentId),
            (read.State, read.MoneySent, read.Outcome!.EnrollmentId));
    }

    // ---------- 14. an unpaid house ----------

    [TestMethod]
    public async Task N9c1AnUnpaidHouseCannotBookOrCloseAnAskWhileItsTraineeMaySayTheMoneyWasSent()
    {
        // The house opens three months back, so a whole month past its 30-day trial can be billed.
        var today = N9b1FStartAtMidday();
        var opened = new DateOnly(today.Year, today.Month, 1).AddMonths(-3);
        N9b1FSetHouseDay(opened);
        using var space = await N9c1OpenAsync("unpaid");
        var house = space.House;
        using var talia = await N9a1TraineeAsync(house.TenantId, "n9c1-unpaid-talia@example.test", "Talia", "Wexford");
        var ask = await N9c1AskedAsync(talia.Client, space.OfferId);

        // The house's month is billed and left unpaid until the day it locks.
        var billed = opened.AddMonths(2);
        var nextMonth = billed.AddMonths(1);
        RequiredTestClock.Set(new DateTimeOffset(nextMonth.Year, nextMonth.Month, 1, 0, 10, 0, TimeSpan.Zero));
        await IssueBillingAsync(new BillingMonth(billed.Year, billed.Month));
        var warning = await RequiredJsonAsync<BillingAccess>(await house.Owner.GetAsync("/api/billing/access"));
        Assert.IsNotNull(warning.ReadOnlyFrom, "The house's month was billed.");
        N9b1FSetHouseDay(warning.ReadOnlyFrom.Value);
        Assert.IsTrue((await RequiredJsonAsync<BillingAccess>(await house.Owner.GetAsync("/api/billing/access"))).IsReadOnly);

        // The staff read the ask, and can neither book nor close it.
        Assert.AreEqual(ask, (await N9c1StaffListAsync(house.Owner, talia.ProfileId)).Single());
        await AssertReadOnlyAsync(await N9c1BookAsync(house.Owner, talia.ProfileId, ask.Id, Guid.NewGuid()));
        await AssertReadOnlyAsync(await N9c1CloseAsync(house.Owner, talia.ProfileId, ask.Id, "Unpaid bill"));
        Assert.AreEqual(0L, await N9c1OutcomesOfAsync(talia.ProfileId));

        // A trainee is never touched by the house's bill.
        await AssertStatusAsync(await N9c1SayMoneySentAsync(talia.Client, ask.Id), HttpStatusCode.OK);
    }

    // ---------- 15. the migration ----------

    [TestMethod]
    public async Task N9c1TheMigrationRevertsWhileNoTraineeAskedAndRefusesOnceOneDid()
    {
        N9b1FStartAtMidday();
        // With a house Coach, so Talia has one: the way back passes WaitingForACoach's Down first, which refuses while a
        // client waits.
        using var space = await N9c1OpenAsync("migration", withCoach: true);
        using var talia = await N9a1TraineeAsync(space.House.TenantId, "n9c1-migration-talia@example.test", "Talia", "Wexford");
        Assert.AreEqual(N9c1SchemaObjects, await A7ScalarAsync(N9c1SchemaSql));

        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        var (migration, previous, migrator) = N9c1Migrations(context);
        Assert.EndsWith("_AccountClosure", previous);

        // With no ask, going back drops the tables, their guards, the exclusion and the two kinds, keeping the house's
        // plan, its Whish number and the trainee's Free. Nothing asks the API anything until it is back.
        await migrator.MigrateAsync(previous);
        Assert.AreEqual(0L, await A7ScalarAsync(N9c1SchemaSql));
        Assert.AreEqual(1L, await A7ScalarAsync("""SELECT count(*) FROM pg_constraint WHERE conname = 'CK_NotificationOutboxItems_Vocabulary'"""));
        Assert.DoesNotContain(migration, await context.Database.GetAppliedMigrationsAsync());
        Assert.AreEqual(1L, await N9c1CountAsync("""SELECT count(*) FROM subscriptions."CoachingProducts" WHERE "Id" = @id""", space.Plan.Id));
        Assert.AreEqual(1L, await N9c1CountAsync("""SELECT count(*) FROM subscriptions."ClientEnrollments" WHERE "ClientProfileId" = @id""", talia.ProfileId));

        // Reapplied, all of it is back.
        await migrator.MigrateAsync();
        Assert.Contains(migration, await context.Database.GetAppliedMigrationsAsync());
        Assert.AreEqual(N9c1SchemaObjects, await A7ScalarAsync(N9c1SchemaSql));

        // Once a trainee asked, the way back stops with a plain message and the migration stays (Npgsql retries 55000
        // first, each time rolled back).
        await N9c1AskedAsync(talia.Client, space.OfferId);
        var thrown = await Assert.ThrowsAsync<Exception>(() => migrator.MigrateAsync(previous));
        var refused = thrown as PostgresException ?? thrown.InnerException as PostgresException
            ?? throw new AssertFailedException($"Expected PostgreSQL's refusal, not {thrown}");
        Assert.AreEqual("55000", refused.SqlState, refused.MessageText);
        Assert.Contains("roll forward", refused.MessageText);
        Assert.Contains(migration, await context.Database.GetAppliedMigrationsAsync());
        Assert.AreEqual(N9c1SchemaObjects, await A7ScalarAsync(N9c1SchemaSql));
        await migrator.MigrateAsync();
        Assert.AreEqual(1L, await N9c1AsksOfAsync(talia.ProfileId));
    }

    // ---------- helpers ----------

    /// <summary>
    /// The house, opened as N9a1 opens it (Free on sale), with one Pro+ plan of one four-week Training option and, unless
    /// <paramref name="whish"/> is null, its Whish number filled by the platform admin.
    /// </summary>
    private async Task<N9c1Space> N9c1OpenAsync(string tag, bool withCoach = false, string? whish = N9c1HouseWhish)
    {
        var house = await N9a1OpenHouseAsync($"n9c1-{tag}", withCoach);
        var plan = await N9b1FProductAsync(house.Owner, N9c1PlanName, 4, N9c1Price, "ProPlus");
        if (whish is not null)
        {
            await N9a1SettingAsync(house.Admin, N9c1WhishSetting, whish);
        }

        return new N9c1Space(house, plan);
    }

    private static string N9c1StaffUrl(Guid clientProfileId) =>
        $"/api/commercial/clients/{clientProfileId}/house-plan-asks";

    private static async Task<HttpResponseMessage> N9c1AskAsync(HttpClient trainee, Guid offerId)
    {
        await RefreshCsrfAsync(trainee);
        return await trainee.PostAsJsonAsync(N9c1AsksUrl, new { offerId });
    }

    private static async Task<HousePlanAskView> N9c1AskedAsync(HttpClient trainee, Guid offerId)
    {
        var response = await N9c1AskAsync(trainee, offerId);
        await AssertStatusAsync(response, HttpStatusCode.Created);
        return await ReadSlicePayloadAsync<HousePlanAskView>(response);
    }

    private static async Task<HttpResponseMessage> N9c1SayMoneySentAsync(
        HttpClient trainee,
        Guid askId,
        string? whishName = N9c1WhishName,
        string? whishNumber = N9c1TraineeWhish)
    {
        await RefreshCsrfAsync(trainee);
        return await trainee.PostAsJsonAsync($"{N9c1AsksUrl}/{askId}/money-sent", new { whishName, whishNumber });
    }

    private static async Task<HttpResponseMessage> N9c1BookAsync(
        HttpClient staff,
        Guid clientProfileId,
        Guid askId,
        Guid idempotencyKey,
        decimal amount = N9c1Price,
        string? currencyCode = "USD",
        string? reference = null)
    {
        await RefreshCsrfAsync(staff);
        return await staff.PostAsJsonAsync(
            $"{N9c1StaffUrl(clientProfileId)}/{askId}/book",
            new { amount, currencyCode, reference, idempotencyKey });
    }

    private static async Task<HousePlanAskView> N9c1BookedAsync(
        HttpClient staff,
        Guid clientProfileId,
        Guid askId,
        Guid idempotencyKey,
        string? reference = null)
    {
        var response = await N9c1BookAsync(staff, clientProfileId, askId, idempotencyKey, N9c1Price, "USD", reference);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<HousePlanAskView>(response);
    }

    /// <summary>The trainee asks for the four-week option and the Owner books it at once, under a new key.</summary>
    private static async Task<HousePlanAskView> N9c1AskAndBookAsync(N9c1Space space, N9a1Trainee trainee)
    {
        var ask = await N9c1AskedAsync(trainee.Client, space.OfferId);
        return await N9c1BookedAsync(space.House.Owner, trainee.ProfileId, ask.Id, Guid.NewGuid());
    }

    private static async Task<HttpResponseMessage> N9c1CloseAsync(HttpClient staff, Guid clientProfileId, Guid askId, string? reason)
    {
        await RefreshCsrfAsync(staff);
        return await staff.PostAsJsonAsync($"{N9c1StaffUrl(clientProfileId)}/{askId}/close", new { reason });
    }

    private static Task<HousePlansView> N9c1OwnAsync(HttpClient trainee) =>
        ReadSliceAsync<HousePlansView>(trainee, N9c1PlansUrl);

    private static Task<HousePlanAskView[]> N9c1StaffListAsync(HttpClient staff, Guid clientProfileId) =>
        ReadSliceAsync<HousePlanAskView[]>(staff, N9c1StaffUrl(clientProfileId));

    /// <summary>The staff's ordinary booking of a plan, under the key given.</summary>
    private static async Task<HttpResponseMessage> N9c1EnrollAsync(HttpClient staff, Guid clientProfileId, Guid offerId, DateOnly startDate, Guid key)
    {
        await RefreshCsrfAsync(staff);
        return await staff.PostAsJsonAsync(
            $"/api/commercial/clients/{clientProfileId}/enrollments",
            new { offerId, startDate = N9a1Day(startDate), idempotencyKey = key });
    }

    /// <summary>The staff book a plan by their ordinary route and record its whole price the same day.</summary>
    private static async Task N9c1PaidPlanAsync(HttpClient staff, Guid clientProfileId, Guid offerId, DateOnly startDate, decimal price)
    {
        var response = await N9c1EnrollAsync(staff, clientProfileId, offerId, startDate, Guid.NewGuid());
        await AssertStatusAsync(response, HttpStatusCode.OK);
        var plan = await RequiredJsonAsync<RenewalEnrollment>(response);
        await RefreshCsrfAsync(staff);
        await AssertStatusAsync(
            await staff.PostAsJsonAsync($"/api/commercial/enrollments/{plan.Id}/payments", A7PaymentRequest(price, startDate, Guid.NewGuid())),
            HttpStatusCode.OK);
    }

    /// <summary>A plan of one option of one feature, with the tier given (null for none).</summary>
    private static async Task<CoachingProductView> N9c1TieredProductAsync(
        HttpClient staff,
        string name,
        int weeks,
        decimal price,
        string? houseTier,
        string feature)
    {
        await RefreshCsrfAsync(staff);
        var response = await staff.PostAsJsonAsync(
            A7ProductsUrl,
            new { name, description = (string?)null, initialOffer = B4aOfferRequest(weeks, price, "USD", feature), houseTier });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<CoachingProductView>(response);
    }

    private static async Task<CoachingProductView> N9c1AddOptionAsync(HttpClient staff, Guid productId, int weeks, decimal price)
    {
        await RefreshCsrfAsync(staff);
        var response = await staff.PostAsJsonAsync($"{A7ProductsUrl}/{productId}/offers", B4aOfferRequest(weeks, price, "USD", "Training"));
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<CoachingProductView>(response);
    }

    private static async Task N9c1OptionOffSaleAsync(HttpClient staff, ProductOfferView offer)
    {
        await RefreshCsrfAsync(staff);
        await AssertStatusAsync(
            await staff.PutAsJsonAsync($"/api/commercial/offers/{offer.Id}/availability", new { isActive = false, version = offer.Version }),
            HttpStatusCode.OK);
    }

    private static async Task N9c1PlanOffSaleAsync(HttpClient staff, CoachingProductView product)
    {
        await RefreshCsrfAsync(staff);
        await AssertStatusAsync(
            await staff.PutAsJsonAsync(
                $"{A7ProductsUrl}/{product.Id}",
                new { name = product.Name, description = product.Description, isActive = false, version = product.Version }),
            HttpStatusCode.OK);
    }

    /// <summary>Blocks or unblocks the client's relationship, as the client's page does.</summary>
    private static async Task N9c1RelationshipAsync(HttpClient staff, Guid clientProfileId, string change)
    {
        var profile = await ReadSliceAsync<SliceProfileVersion>(staff, $"/api/clients/{clientProfileId}");
        await RefreshCsrfAsync(staff);
        await AssertStatusAsync(
            await staff.PostAsJsonAsync($"/api/clients/{clientProfileId}/relationship/{change}", new { reason = "N9c1 pause check", profile.Version }),
            HttpStatusCode.OK);
    }

    /// <summary>A copy of an ask's row under a new id, with the trainee and the tier given as SQL.</summary>
    private static string N9c1CopyAskSql(Guid askId, string clientProfileId, string tier) =>
        $"""
        INSERT INTO subscriptions."HousePlanAsks"
            ("Id", "TenantId", "ClientProfileId", "ProductId", "OfferId", "Tier", "AskedByUserId", "AskedOn", "AskedAtUtc")
        SELECT uuidv7(), "TenantId", {clientProfileId}, "ProductId", "OfferId", {tier}, "AskedByUserId", "AskedOn", "AskedAtUtc"
        FROM subscriptions."HousePlanAsks" WHERE "Id" = '{askId}'
        """;

    private Task<long> N9c1CountAsync(string sql, Guid id) => Phase6CountAsync(RequiredDatabaseConnection, sql, id);

    private Task<long> N9c1AsksOfAsync(Guid clientProfileId) => N9c1CountAsync(
        """SELECT count(*) FROM subscriptions."HousePlanAsks" WHERE "ClientProfileId" = @id""",
        clientProfileId);

    private Task<long> N9c1TransfersOfAsync(Guid clientProfileId) => N9c1CountAsync(
        """SELECT count(*) FROM subscriptions."HousePlanTransfers" WHERE "ClientProfileId" = @id""",
        clientProfileId);

    private Task<long> N9c1OutcomesOfAsync(Guid clientProfileId) => N9c1CountAsync(
        """SELECT count(*) FROM subscriptions."HousePlanAskOutcomes" WHERE "ClientProfileId" = @id""",
        clientProfileId);

    private Task<long> N9c1ReceiptsOfAsync(Guid clientProfileId) => N9c1CountAsync(
        """
        SELECT count(*) FROM subscriptions."PaymentRecords" receipt
        JOIN subscriptions."ClientEnrollments" plan ON plan."Id" = receipt."EnrollmentId"
        WHERE plan."ClientProfileId" = @id
        """,
        clientProfileId);

    /// <summary>Who each queued notice of <paramref name="kind"/> about the trainee goes to.</summary>
    private async Task<Guid[]> N9c1RecipientsAsync(string kind, Guid clientProfileId)
    {
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            """
            SELECT "RecipientUserId" FROM notifications."OutboxItems"
            WHERE "AggregateId" = @id AND "Kind" = @kind
            """;
        command.Parameters.AddWithValue("id", clientProfileId);
        command.Parameters.AddWithValue("kind", kind);
        var recipients = new List<Guid>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            recipients.Add(reader.GetGuid(0));
        }

        return [.. recipients];
    }

    /// <summary>The payloads of the house's two money notices about the trainee.</summary>
    private Task<string[]> N9c1PayloadsAsync(Guid clientProfileId) => N9c1TextsAsync(
        """
        SELECT "PayloadJson"::text FROM notifications."OutboxItems"
        WHERE "AggregateId" = @id AND "Kind" IN ('HousePlanAsked', 'HousePlanMoneySent')
        """,
        clientProfileId);

    private async Task<string[]> N9c1TextsAsync(string sql, Guid id)
    {
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.Parameters.AddWithValue("id", id);
        var texts = new List<string>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            texts.Add(reader.GetString(0));
        }

        return [.. texts];
    }

    private async Task<PaymentRecord[]> N9c1ReceiptsAsync(Guid enrollmentId)
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        return await context.PaymentRecords.IgnoreQueryFilters().AsNoTracking()
            .Where(item => item.EnrollmentId == enrollmentId)
            .ToArrayAsync();
    }

    private async Task<HousePlanTransfer[]> N9c1TransfersAsync(Guid clientProfileId)
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<GymDbContext>();
        return await context.HousePlanTransfers.IgnoreQueryFilters().AsNoTracking()
            .Where(item => item.ClientProfileId == clientProfileId)
            .ToArrayAsync();
    }

    /// <summary>This row's migration, the one before it, and the migrator that moves between them.</summary>
    private static (string Migration, string Previous, IMigrator Migrator) N9c1Migrations(GymDbContext context)
    {
        var migrations = context.Database.GetMigrations().ToArray();
        var migration = migrations.Single(item => item.EndsWith("_HousePlanAsks", StringComparison.Ordinal));
        return (
            migration,
            migrations[Array.IndexOf(migrations, migration) - 1],
            context.Database.GetInfrastructure().GetRequiredService<IMigrator>());
    }

    private sealed record N9c1Space(N9a1House House, CoachingProductView Plan) : IDisposable
    {
        public Guid OfferId => Plan.Offers[0].Id;

        public void Dispose() => House.Dispose();
    }
}
