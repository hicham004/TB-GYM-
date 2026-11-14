using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using TB.Gym.Modules.Subscriptions;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The notes plan's N9c5a, Max's places (SUB-021), against PostgreSQL: Max is closed while its places are empty or
/// zero, and an ask made while it was open is then neither paid nor booked; an ask is stored in the order asked even
/// when every place is taken, each read says whether its place is open and the staff's says its place in line, and the
/// money is said sent only for an ask whose place is open; the last place booked twice at once goes to one trainee and
/// the other is told every place is taken; a trainee on Max keeps their place for their next pass; a paused Max holds
/// its place and a cancelled or ended one frees it; the coaches' ordinary routes never book or renew Max, and still
/// book Pro+; a Max plan covers the four things a coach's client gets; and nothing of it reaches outside the house or
/// anyone signed out. Every name, number, address and figure is invented.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private static readonly string[] N9c5PThreeOfFour = ["Training", "Nutrition", "CheckIns"];

    private static readonly string[] N9c5PFive = ["Training", "Nutrition", "CheckIns", "Messaging", "ResourceLibrary"];

    // ---------- 1. closed while the places are empty or zero ----------

    [TestMethod]
    public async Task N9c5PMaxIsClosedWhileItsPlacesAreEmptyOrZeroAndAnAskMadeWhileOpenIsNeitherPaidNorBookedOnceClosed()
    {
        N9b1FStartAtMidday();
        using var space = await N9c5MaxSpaceAsync("p-closed", places: null);
        var house = space.House;
        using var amal = await N9a1TraineeAsync(house.TenantId, "n9c5p-closed-amal@example.test", "Amal", "Thornbury");

        // Empty, as the house starts: no Max on the read, and an ask for it is not on sale; so with zero places.
        foreach (var places in new[] { (string?)null, "0" })
        {
            if (places is not null)
            {
                await N9c5SetMaxPlacesAsync(space, places);
            }

            var read = await N9c1OwnAsync(amal.Client);
            Assert.IsTrue(read.AsksOpen, "Asks are open: the Whish number is filled.");
            Assert.AreEqual(
                (space.Space.OfferId, HouseTier.ProPlus, (bool?)null),
                (read.Plans.Single().OfferId, read.Plans.Single().Tier, read.Plans.Single().PlaceOpen),
                $"Places {places ?? "empty"}: Pro+ alone, which never says a place.");
            Assert.AreEqual(
                ("house_plan_not_on_sale", HousePlanAskRule.NotOnSaleMessage),
                await A7ConflictAsync(await N9c1AskAsync(amal.Client, space.MaxOfferId)),
                $"Places {places ?? "empty"}.");
        }

        Assert.AreEqual(0L, await N9c1AsksOfAsync(amal.ProfileId));

        // Open with two places: Max is listed beside Pro+ with a place open, and the ask is stored with its place open.
        await N9c5SetMaxPlacesAsync(space, "2");
        var open = await N9c1OwnAsync(amal.Client);
        Assert.HasCount(2, open.Plans);
        var max = open.Plans.Single(plan => plan.Tier == HouseTier.Max);
        Assert.AreEqual(
            (space.MaxOfferId, N9c5MaxPlanName, N9c5MaxPrice, "USD", (bool?)true),
            (max.OfferId, max.Name, max.PriceAmount, max.PriceCurrency, max.PlaceOpen));
        CollectionAssert.AreEqual(MaxPlanRule.Features.ToArray(), max.Features.ToArray());
        Assert.IsNull(open.Plans.Single(plan => plan.Tier == HouseTier.ProPlus).PlaceOpen);
        var ask = await N9c5AskForMaxAsync(space, amal);
        Assert.AreEqual((HouseTier.Max, HousePlanAskState.Asked, (bool?)true, (int?)null), N9c5PPlace(ask));
        Assert.AreEqual(
            (HouseTier.Max, HousePlanAskState.Asked, (bool?)true, (int?)1),
            N9c5PPlace((await N9c1StaffListAsync(house.Owner, amal.ProfileId)).Single()),
            "The staff read the ask's place in line.");

        // Emptied again: Max leaves the read, the ask is kept and read with no place, and neither the trainee's word nor
        // the staff's booking goes through; nothing is kept of either.
        await N9c5SetMaxPlacesAsync(space, null);
        var closed = await N9c1OwnAsync(amal.Client);
        Assert.IsFalse(closed.Plans.Any(plan => plan.Tier == HouseTier.Max));
        Assert.AreEqual((HouseTier.Max, HousePlanAskState.Asked, (bool?)false, (int?)null), N9c5PPlace(closed.Asks.Single()));
        Assert.AreEqual(
            (HousePlanAskCodes.MaxClosed, MaxPlacesRule.ClosedForTraineeMessage),
            await A7ConflictAsync(await N9c1SayMoneySentAsync(amal.Client, ask.Id)));
        Assert.AreEqual(
            (HousePlanAskCodes.MaxClosed, MaxPlacesRule.ClosedForStaffMessage),
            await A7ConflictAsync(await N9c5BookMaxAsync(space, amal, ask.Id)));
        await N9c5SetMaxPlacesAsync(space, "0");
        Assert.AreEqual(HousePlanAskCodes.MaxClosed, (await A7ConflictAsync(await N9c5BookMaxAsync(space, amal, ask.Id))).Code);
        Assert.AreEqual(
            ("house_plan_not_on_sale", HousePlanAskRule.NotOnSaleMessage),
            await A7ConflictAsync(await N9c1AskAsync(amal.Client, space.MaxOfferId)),
            "Asked again while closed: the open ask is not answered, Max is not on sale.");
        Assert.AreEqual(
            (0L, 0L, 0L, 0),
            (await N9c1TransfersOfAsync(amal.ProfileId), await N9c1OutcomesOfAsync(amal.ProfileId), await N9c1ReceiptsOfAsync(amal.ProfileId),
                (await N9c5PMaxRowsAsync(amal.ProfileId)).Length));
        Assert.AreEqual(0L, await N9a1QueuedAsync("HousePlanMoneySent", "AggregateId", amal.ProfileId), "The staff were told nothing.");

        // Open again: the same ask is paid and booked.
        await N9c5SetMaxPlacesAsync(space, "1");
        await AssertStatusAsync(await N9c1SayMoneySentAsync(amal.Client, ask.Id), HttpStatusCode.OK);
        var booked = await N9c5PBookedAsync(space, amal, ask.Id);
        Assert.AreEqual((HousePlanAskState.Booked, (bool?)null, (int?)null), (booked.State, booked.PlaceOpen, booked.PlaceInLine));
        Assert.AreEqual(booked.Outcome!.EnrollmentId, (await N9c5PMaxRowsAsync(amal.ProfileId)).Single().Id);
    }

    // ---------- 2. asks stored in order when every place is taken ----------

    [TestMethod]
    public async Task N9c5PAnAskIsStoredInOrderWhenEveryPlaceIsTakenAndOnlyAnAskWhosePlaceIsOpenSaysTheMoneyWasSent()
    {
        N9b1FStartAtMidday();
        using var space = await N9c5MaxSpaceAsync("p-line", places: "1");
        var house = space.House;
        using var amal = await N9a1TraineeAsync(house.TenantId, "n9c5p-line-amal@example.test", "Amal", "Thornbury", address: "203.0.113.141");
        using var basil = await N9a1TraineeAsync(house.TenantId, "n9c5p-line-basil@example.test", "Basil", "Fenwick", address: "203.0.113.142");
        using var celine = await N9a1TraineeAsync(house.TenantId, "n9c5p-line-celine@example.test", "Celine", "Ormsby", address: "203.0.113.143");
        using var dana = await N9a1TraineeAsync(house.TenantId, "n9c5p-line-dana@example.test", "Dana", "Halloway", address: "203.0.113.144");

        // Amal takes the one place. Basil, then Celine, ask anyway: both stored, neither with a place.
        await N9c5OnMaxAsync(space, amal);
        Assert.IsFalse((await N9c5PMaxOptionAsync(basil)).PlaceOpen, "Every place is taken.");
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        var basilAsk = await N9c5AskForMaxAsync(space, basil);
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        var celineAsk = await N9c5AskForMaxAsync(space, celine);
        Assert.AreEqual((HouseTier.Max, HousePlanAskState.Asked, (bool?)false, (int?)null), N9c5PPlace(basilAsk));
        Assert.AreEqual((HouseTier.Max, HousePlanAskState.Asked, (bool?)false, (int?)null), N9c5PPlace(celineAsk));
        Assert.AreEqual(
            ((bool?)false, (int?)1, (bool?)false, (int?)2),
            await N9c5PLineAsync(house.Owner, basil, celine),
            "The staff read the order asked.");

        // Basil's word on the money is refused while his place is not open, and nothing is kept or told.
        Assert.AreEqual(
            (HousePlanAskCodes.MaxPlaceNotOpen, MaxPlacesRule.PlaceNotOpenMessage),
            await A7ConflictAsync(await N9c1SayMoneySentAsync(basil.Client, basilAsk.Id)));
        Assert.AreEqual(0L, await N9c1TransfersOfAsync(basil.ProfileId));
        Assert.AreEqual(0L, await N9a1QueuedAsync("HousePlanMoneySent", "AggregateId", basil.ProfileId));

        // A second place: the first in line has it, on both reads; the second still waits. A new ask from Dana, or from
        // either of them, would wait behind the other's.
        await N9c5SetMaxPlacesAsync(space, "2");
        Assert.AreEqual(((bool?)true, (int?)1, (bool?)false, (int?)2), await N9c5PLineAsync(house.Owner, basil, celine));
        Assert.IsTrue((await N9c1OwnAsync(basil.Client)).Asks.Single().PlaceOpen);
        Assert.IsFalse((await N9c1OwnAsync(celine.Client)).Asks.Single().PlaceOpen);
        Assert.IsNull((await N9c1OwnAsync(basil.Client)).Asks.Single().PlaceInLine, "The trainee never reads a place in line.");
        Assert.AreEqual(
            ((bool?)false, (bool?)false, (bool?)false, (bool?)true),
            ((await N9c5PMaxOptionAsync(dana)).PlaceOpen, (await N9c5PMaxOptionAsync(basil)).PlaceOpen,
                (await N9c5PMaxOptionAsync(celine)).PlaceOpen, (await N9c5PMaxOptionAsync(amal)).PlaceOpen),
            "One free place and two asks: a new ask would have none, unless the trainee already holds one.");

        // Only the ask whose place is open says the money was sent, and the staff are told once.
        Assert.AreEqual(
            HousePlanAskCodes.MaxPlaceNotOpen,
            (await A7ConflictAsync(await N9c1SayMoneySentAsync(celine.Client, celineAsk.Id))).Code);
        var sent = await N9c1SayMoneySentAsync(basil.Client, basilAsk.Id);
        await AssertStatusAsync(sent, HttpStatusCode.OK);
        Assert.AreEqual(
            (HouseTier.Max, HousePlanAskState.MoneySent, (bool?)true, (int?)null),
            N9c5PPlace(await ReadSlicePayloadAsync<HousePlanAskView>(sent)));
        Assert.AreEqual((1L, 0L), (await N9c1TransfersOfAsync(basil.ProfileId), await N9c1TransfersOfAsync(celine.ProfileId)));
        CollectionAssert.AreEquivalent(
            new[] { house.OwnerUserId, house.CoachUserId!.Value },
            await N9c1RecipientsAsync("HousePlanMoneySent", basil.ProfileId),
            "The Owner and Basil's coach, once each.");
        Assert.AreEqual(0L, await N9a1QueuedAsync("HousePlanMoneySent", "AggregateId", celine.ProfileId));
        await AssertStatusAsync(await N9c1SayMoneySentAsync(basil.Client, basilAsk.Id), HttpStatusCode.OK);
        Assert.AreEqual(1L, await N9c1TransfersOfAsync(basil.ProfileId), "The same word again answers the first.");
        Assert.HasCount(2, await N9c1RecipientsAsync("HousePlanMoneySent", basil.ProfileId));

        // Basil's word on the money holds his place: he leaves the line, and Celine is first in it.
        Assert.AreEqual(((bool?)true, (int?)null, (bool?)false, (int?)1), await N9c5PLineAsync(house.Owner, basil, celine));

        // Room for all: Dana's new ask would have a place too.
        await N9c5SetMaxPlacesAsync(space, "4");
        Assert.AreEqual(((bool?)true, (int?)null, (bool?)true, (int?)1), await N9c5PLineAsync(house.Owner, basil, celine));
        Assert.IsTrue((await N9c5PMaxOptionAsync(dana)).PlaceOpen);

        // A trainee who leaves the house leaves the line: theirs can be neither booked nor closed. Back to two places,
        // Celine is first and has the free one.
        await N9c5SetMaxPlacesAsync(space, "2");
        await N9a1LeaveAsync(basil.Client, "Moving to another city");
        Assert.AreEqual(
            (HousePlanAskState.MoneySent, (bool?)false, (int?)null),
            (await N9c1StaffListAsync(house.Owner, basil.ProfileId)).Select(item => (item.State, item.PlaceOpen, item.PlaceInLine)).Single());
        Assert.AreEqual((HouseTier.Max, HousePlanAskState.Asked, (bool?)true, (int?)1), N9c5PPlace((await N9c1StaffListAsync(house.Owner, celine.ProfileId)).Single()));

        // The order is told, not enforced: a later ask may be booked while a place is free, and then the earlier one
        // has none.
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        var danaAsk = await N9c5AskForMaxAsync(space, dana);
        Assert.AreEqual(
            ((bool?)true, (int?)1, (bool?)false, (int?)2),
            await N9c5PLineAsync(house.Owner, celine, dana));
        await N9c5PBookedAsync(space, dana, danaAsk.Id);
        Assert.AreEqual((HouseTier.Max, HousePlanAskState.Asked, (bool?)false, (int?)1), N9c5PPlace((await N9c1StaffListAsync(house.Owner, celine.ProfileId)).Single()));
        Assert.AreEqual(
            (HousePlanAskCodes.MaxFull, MaxPlacesRule.FullMessage),
            await A7ConflictAsync(await N9c5BookMaxAsync(space, celine, celineAsk.Id)));
        Assert.IsEmpty(await N9c5PMaxRowsAsync(celine.ProfileId));
    }

    // ---------- 3. the last place booked twice at once ----------

    [TestMethod]
    public async Task N9c5PTheLastPlaceBookedTwiceAtOnceGoesToOneTraineeAndTheOtherIsToldEveryPlaceIsTaken()
    {
        N9b1FStartAtMidday();
        using var space = await N9c5MaxSpaceAsync("p-race", places: "1");
        var house = space.House;
        using var basil = await N9a1TraineeAsync(house.TenantId, "n9c5p-race-basil@example.test", "Basil", "Fenwick", address: "203.0.113.151");
        using var celine = await N9a1TraineeAsync(house.TenantId, "n9c5p-race-celine@example.test", "Celine", "Ormsby", address: "203.0.113.152");
        var basilAsk = await N9c5AskForMaxAsync(space, basil);
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        var celineAsk = await N9c5AskForMaxAsync(space, celine);
        Assert.AreEqual(house.CoachUserId, (await N9a1PersonAsync("n9c5p-race-celine@example.test")).Profiles.Single().AssignedCoachUserId);

        // The Owner's booking of Basil is held at its insert, holding the house's Max lock; the Coach's booking of Celine,
        // another trainee whose record nothing holds, waits on that lock and then counts the place taken.
        await RefreshCsrfAsync(house.Owner);
        await RefreshCsrfAsync(house.Coach!);
        RequiredInsertBarrier.Arm("subscriptions.\"HousePlanAskOutcomes\"", 2);
        HttpResponseMessage byOwner;
        HttpResponseMessage byCoach;
        try
        {
            var owner = house.Owner.PostAsJsonAsync(
                $"{N9c1StaffUrl(basil.ProfileId)}/{basilAsk.Id}/book",
                new { amount = N9c5MaxPrice, currencyCode = "USD", reference = (string?)null, idempotencyKey = Guid.NewGuid() });
            if (await Task.WhenAny(owner, RequiredInsertBarrier.ArrivedAsync(1)) == owner)
            {
                Assert.Fail($"The Owner's booking ended before its insert: {(await owner).StatusCode}.");
            }

            var coach = house.Coach!.PostAsJsonAsync(
                $"{N9c1StaffUrl(celine.ProfileId)}/{celineAsk.Id}/book",
                new { amount = N9c5MaxPrice, currencyCode = "USD", reference = (string?)null, idempotencyKey = Guid.NewGuid() });
            await N9b1FAwaitLockWaitAsync("house-max-places", coach);
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
        Assert.AreEqual((HousePlanAskCodes.MaxFull, MaxPlacesRule.FullMessage), await A7ConflictAsync(byCoach));
        var booked = await ReadSlicePayloadAsync<HousePlanAskView>(byOwner);
        Assert.AreEqual(booked.Outcome!.EnrollmentId, (await N9c5PMaxRowsAsync(basil.ProfileId)).Single().Id);
        Assert.IsEmpty(await N9c5PMaxRowsAsync(celine.ProfileId));
        Assert.AreEqual(
            (1L, 0L, 0L),
            (await N9c1ReceiptsOfAsync(basil.ProfileId), await N9c1ReceiptsOfAsync(celine.ProfileId), await N9c1OutcomesOfAsync(celine.ProfileId)));
        Assert.AreEqual(
            (HouseTier.Max, HousePlanAskState.Asked, (bool?)false, (int?)1),
            N9c5PPlace((await N9c1StaffListAsync(house.Owner, celine.ProfileId)).Single()),
            "Celine is first in line, with no place.");
    }

    // ---------- 4. a renewal keeps its place; paused holds it, cancelled or ended frees it ----------

    [TestMethod]
    public async Task N9c5PATraineeOnMaxKeepsTheirPlaceForTheNextPassAPausedMaxHoldsItAndACancelledOneFreesIt()
    {
        var today = N9b1FStartAtMidday();
        using var space = await N9c5MaxSpaceAsync("p-renew", places: "1");
        var house = space.House;
        using var amal = await N9a1TraineeAsync(house.TenantId, "n9c5p-renew-amal@example.test", "Amal", "Thornbury", address: "203.0.113.161");
        using var basil = await N9a1TraineeAsync(house.TenantId, "n9c5p-renew-basil@example.test", "Basil", "Fenwick", address: "203.0.113.162");
        await N9c5OnMaxAsync(space, amal);
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        var basilAsk = await N9c5AskForMaxAsync(space, basil);

        // Amal asks for the next pass while every place is taken: the ask never queues, its place is open, the money is
        // said sent and it is booked from the day the first pass ends.
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        var next = await N9c5AskForMaxAsync(space, amal);
        Assert.AreEqual((HouseTier.Max, HousePlanAskState.Asked, (bool?)true, (int?)null), N9c5PPlace(next));
        Assert.AreEqual((HouseTier.Max, HousePlanAskState.Asked, (bool?)true, (int?)null), N9c5PPlace((await N9c1StaffListAsync(house.Owner, amal.ProfileId))[0]));
        Assert.AreEqual((HouseTier.Max, HousePlanAskState.Asked, (bool?)false, (int?)1), N9c5PPlace((await N9c1StaffListAsync(house.Owner, basil.ProfileId)).Single()));
        Assert.IsTrue((await N9c5PMaxOptionAsync(amal)).PlaceOpen);
        await AssertStatusAsync(await N9c1SayMoneySentAsync(amal.Client, next.Id), HttpStatusCode.OK);
        await N9c5PBookedAsync(space, amal, next.Id);
        var passes = await N9c5PMaxRowsAsync(amal.ProfileId);
        Assert.AreEqual(
            (today, today.AddDays(28), today.AddDays(28), today.AddDays(56)),
            (passes[0].StartDate, passes[0].EndDateExclusive, passes[1].StartDate, passes[1].EndDateExclusive));

        // Basil is still told every place is taken; Amal's first pass paused, the place is still Amal's.
        Assert.AreEqual(HousePlanAskCodes.MaxFull, (await A7ConflictAsync(await N9c5BookMaxAsync(space, basil, basilAsk.Id))).Code);
        await N9c5PChangeStatusAsync(house.Owner, amal.ProfileId, passes[0].Id, "pause");
        Assert.AreEqual(HousePlanAskCodes.MaxFull, (await A7ConflictAsync(await N9c5BookMaxAsync(space, basil, basilAsk.Id))).Code);
        Assert.AreEqual(HousePlanAskCodes.MaxPlaceNotOpen, (await A7ConflictAsync(await N9c1SayMoneySentAsync(basil.Client, basilAsk.Id))).Code);

        // One pass cancelled, the other still holds the place; both cancelled, it is free and Basil's.
        await N9c5PChangeStatusAsync(house.Owner, amal.ProfileId, passes[1].Id, "cancel");
        Assert.AreEqual(HousePlanAskCodes.MaxFull, (await A7ConflictAsync(await N9c5BookMaxAsync(space, basil, basilAsk.Id))).Code);
        await N9c5PChangeStatusAsync(house.Owner, amal.ProfileId, passes[0].Id, "cancel");
        Assert.AreEqual((HouseTier.Max, HousePlanAskState.Asked, (bool?)true, (int?)1), N9c5PPlace((await N9c1StaffListAsync(house.Owner, basil.ProfileId)).Single()));
        await AssertStatusAsync(await N9c1SayMoneySentAsync(basil.Client, basilAsk.Id), HttpStatusCode.OK);
        await N9c5PBookedAsync(space, basil, basilAsk.Id);
        Assert.AreEqual(today, (await N9c5PMaxRowsAsync(basil.ProfileId)).Single().StartDate);

        // Amal, with no place now, asks again and waits.
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        var again = await N9c5AskForMaxAsync(space, amal);
        Assert.AreEqual((HouseTier.Max, HousePlanAskState.Asked, (bool?)false, (int?)null), N9c5PPlace(again));
        Assert.AreEqual(HousePlanAskCodes.MaxFull, (await A7ConflictAsync(await N9c5BookMaxAsync(space, amal, again.Id))).Code);
    }

    [TestMethod]
    public async Task N9c5PAMaxThatHasEndedFreesItsPlaceOnTheHousesDay()
    {
        var today = N9b1FStartAtMidday();
        using var space = await N9c5MaxSpaceAsync("p-ended", places: "1");
        var house = space.House;
        using var amal = await N9a1TraineeAsync(house.TenantId, "n9c5p-ended-amal@example.test", "Amal", "Thornbury", address: "203.0.113.171");
        using var basil = await N9a1TraineeAsync(house.TenantId, "n9c5p-ended-basil@example.test", "Basil", "Fenwick", address: "203.0.113.172");
        await N9c5OnMaxAsync(space, amal);
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        var basilAsk = await N9c5AskForMaxAsync(space, basil);
        var ends = (await N9c5PMaxRowsAsync(amal.ProfileId)).Single().EndDateExclusive;
        Assert.AreEqual(today.AddDays(28), ends);

        // On Amal's last day the place is still Amal's.
        N9b1FSetHouseDay(ends.AddDays(-1));
        Assert.IsFalse((await N9c1OwnAsync(basil.Client)).Asks.Single().PlaceOpen);
        Assert.AreEqual(HousePlanAskCodes.MaxFull, (await A7ConflictAsync(await N9c5BookMaxAsync(space, basil, basilAsk.Id))).Code);

        // The day after it, it is free: Basil's place opens, the money is said sent and the booking goes through.
        N9b1FSetHouseDay(ends);
        Assert.AreEqual((HouseTier.Max, HousePlanAskState.Asked, (bool?)true, (int?)null), N9c5PPlace((await N9c1OwnAsync(basil.Client)).Asks.Single()));
        Assert.IsFalse((await N9c5PMaxOptionAsync(amal)).PlaceOpen, "Amal holds none now, and a new ask of hers would wait behind Basil's.");
        await AssertStatusAsync(await N9c1SayMoneySentAsync(basil.Client, basilAsk.Id), HttpStatusCode.OK);
        await N9c5PBookedAsync(space, basil, basilAsk.Id);
        Assert.AreEqual(ends, (await N9c5PMaxRowsAsync(basil.ProfileId)).Single().StartDate);
    }

    [TestMethod]
    public async Task N9c5PAnAskWhoseMoneyWasSaidSentKeepsItsPlacePastThePassAndAgainstALaterBooking()
    {
        var today = N9b1FStartAtMidday();
        using var space = await N9c5MaxSpaceAsync("p-said", places: "1");
        var house = space.House;
        using var amal = await N9a1TraineeAsync(house.TenantId, "n9c5p-said-amal@example.test", "Amal", "Thornbury", address: "203.0.113.181");
        using var basil = await N9a1TraineeAsync(house.TenantId, "n9c5p-said-basil@example.test", "Basil", "Fenwick", address: "203.0.113.182");
        using var celine = await N9a1TraineeAsync(house.TenantId, "n9c5p-said-celine@example.test", "Celine", "Ormsby", address: "203.0.113.183");
        await N9c5OnMaxAsync(space, amal);
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        var basilAsk = await N9c5AskForMaxAsync(space, basil);
        var ends = (await N9c5PMaxRowsAsync(amal.ProfileId)).Single().EndDateExclusive;

        // On her last day Amal asks for her next pass and says its money was sent; the staff book it only the day after
        // the pass ended. Her place is still hers that day: Basil, first in line since before, may neither pay nor be
        // booked, and Amal's next pass starts that day.
        N9b1FSetHouseDay(ends.AddDays(-1));
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        var next = await N9c5AskForMaxAsync(space, amal);
        await AssertStatusAsync(await N9c1SayMoneySentAsync(amal.Client, next.Id), HttpStatusCode.OK);
        N9b1FSetHouseDay(ends);
        Assert.AreEqual(
            (HouseTier.Max, HousePlanAskState.MoneySent, (bool?)true, (int?)null),
            N9c5PPlace((await N9c1OwnAsync(amal.Client)).Asks.First(item => item.Id == next.Id)));
        Assert.AreEqual(
            (HouseTier.Max, HousePlanAskState.Asked, (bool?)false, (int?)1),
            N9c5PPlace((await N9c1StaffListAsync(house.Owner, basil.ProfileId)).Single()));
        Assert.AreEqual(HousePlanAskCodes.MaxPlaceNotOpen, (await A7ConflictAsync(await N9c1SayMoneySentAsync(basil.Client, basilAsk.Id))).Code);
        Assert.AreEqual(HousePlanAskCodes.MaxFull, (await A7ConflictAsync(await N9c5BookMaxAsync(space, basil, basilAsk.Id))).Code);
        await N9c5PBookedAsync(space, amal, next.Id);
        Assert.AreEqual(ends, (await N9c5PMaxRowsAsync(amal.ProfileId))[1].StartDate);
        Assert.IsEmpty(await N9c5PMaxRowsAsync(basil.ProfileId));

        // A second place opens: Basil is first and says the money was sent. Celine, asking later, may not be booked into
        // the place his word holds; once his ask is closed it is hers.
        await N9c5SetMaxPlacesAsync(space, "2");
        await AssertStatusAsync(await N9c1SayMoneySentAsync(basil.Client, basilAsk.Id), HttpStatusCode.OK);
        RequiredTestClock.Advance(TimeSpan.FromMinutes(1));
        var celineAsk = await N9c5AskForMaxAsync(space, celine);
        Assert.AreEqual((HouseTier.Max, HousePlanAskState.Asked, (bool?)false, (int?)null), N9c5PPlace(celineAsk));
        Assert.AreEqual(HousePlanAskCodes.MaxFull, (await A7ConflictAsync(await N9c5BookMaxAsync(space, celine, celineAsk.Id))).Code);
        Assert.IsEmpty(await N9c5PMaxRowsAsync(celine.ProfileId));
        await AssertStatusAsync(await N9c1CloseAsync(house.Owner, basil.ProfileId, basilAsk.Id, "No money reached TB Gym's Whish account."), HttpStatusCode.OK);
        Assert.AreEqual(
            (HouseTier.Max, HousePlanAskState.Asked, (bool?)true, (int?)1),
            N9c5PPlace((await N9c1StaffListAsync(house.Owner, celine.ProfileId)).Single()));
        await N9c5PBookedAsync(space, celine, celineAsk.Id);
        Assert.AreEqual(ends, (await N9c5PMaxRowsAsync(celine.ProfileId)).Single().StartDate);
        Assert.AreEqual(today.AddDays(28), ends);
    }

    // ---------- 5. the coaches' ordinary routes never book Max ----------

    [TestMethod]
    public async Task N9c5PTheCoachesOrdinaryRoutesNeitherBookNorRenewMaxAndStillBookAndRenewProPlus()
    {
        var today = N9b1FStartAtMidday();
        using var space = await N9c5MaxSpaceAsync("p-routes", places: "3");
        var house = space.House;
        using var amal = await N9a1TraineeAsync(house.TenantId, "n9c5p-routes-amal@example.test", "Amal", "Thornbury", address: "203.0.113.181");
        using var basil = await N9a1TraineeAsync(house.TenantId, "n9c5p-routes-basil@example.test", "Basil", "Fenwick", address: "203.0.113.182");

        // Booking Max by hand, by the Owner or the trainee's coach: refused, and nothing is written.
        foreach (var (staff, who) in new[] { (house.Owner, "the Owner"), (house.Coach!, "the trainee's coach") })
        {
            Assert.AreEqual(
                (HousePlanAskCodes.MaxByAsk, MaxPlanRule.ByAskRefusal),
                await A7ConflictAsync(await N9c1EnrollAsync(staff, basil.ProfileId, space.MaxOfferId, today, Guid.NewGuid())),
                who);
        }

        Assert.IsEmpty(await N9c5PMaxRowsAsync(basil.ProfileId));

        // A Max booked from the ask is not renewed by the ordinary route either, today or after it.
        await N9c5OnMaxAsync(space, amal);
        var max = (await N9c5PMaxRowsAsync(amal.ProfileId)).Single();
        foreach (var start in new[] { today, max.EndDateExclusive })
        {
            Assert.AreEqual(
                (HousePlanAskCodes.MaxByAsk, MaxPlanRule.ByAskRefusal),
                await A7ConflictAsync(await N9c5PRenewAsync(house.Owner, max.Id, space.MaxOfferId, start)),
                N9a1Day(start));
        }

        Assert.HasCount(1, await N9c5PMaxRowsAsync(amal.ProfileId));

        // Pro+ is booked and renewed by the ordinary routes as before.
        var proPlus = await N9c1EnrollAsync(house.Owner, basil.ProfileId, space.Space.OfferId, today, Guid.NewGuid());
        await AssertStatusAsync(proPlus, HttpStatusCode.OK);
        var plan = await RequiredJsonAsync<RenewalEnrollment>(proPlus);
        var renewed = await N9c5PRenewAsync(house.Owner, plan.Id, space.Space.OfferId, today.AddDays(28));
        await AssertStatusAsync(renewed, HttpStatusCode.OK);
        Assert.AreEqual(
            2,
            (await N9b1FRowsAsync(basil.ProfileId)).Count(item => item.Tier == HouseTier.ProPlus),
            "Pro+, and its renewal.");
    }

    // ---------- 6. what a Max plan covers ----------

    [TestMethod]
    public async Task N9c5PAMaxPlanCoversTrainingNutritionCheckInsAndMessagingAllFourAndProPlusAsBefore()
    {
        N9b1FStartAtMidday();
        using var space = await N9c5MaxSpaceAsync("p-four", places: "3");
        var house = space.House;
        var catalog = (await ReadSliceAsync<ProductCatalog>(house.Owner, A7ProductsUrl)).Products.Count;

        // A new Max plan with fewer or more than the four: refused on the plan, and nothing is made.
        foreach (var (features, what) in new[] { (new[] { "Training" }, "Training alone"), (N9c5PThreeOfFour, "three"), (N9c5PFive, "five") })
        {
            Assert.AreEqual(
                MaxPlanRule.FeaturesRefusal,
                await A7FieldErrorAsync(await N9c5PNewPlanAsync(house.Owner, $"N9c5 Max {what}", "Max", features), "product"),
                what);
        }

        Assert.HasCount(catalog, (await ReadSliceAsync<ProductCatalog>(house.Owner, A7ProductsUrl)).Products);

        // An option added to the Max plan: refused on the option unless it covers the four; with the four, added.
        Assert.AreEqual(
            MaxPlanRule.FeaturesRefusal,
            await A7FieldErrorAsync(await N9c5PAddOptionAsync(house.Owner, space.Max.Id, 8, N9c5PThreeOfFour), "offer"));
        Assert.AreEqual(
            MaxPlanRule.FeaturesRefusal,
            await A7FieldErrorAsync(await N9c5PAddOptionAsync(house.Owner, space.Max.Id, 8, N9c5PFive), "offer"));
        var added = await N9c5PAddOptionAsync(house.Owner, space.Max.Id, 8, ["Messaging", "CheckIns", "Nutrition", "Training"]);
        await AssertStatusAsync(added, HttpStatusCode.OK);
        Assert.HasCount(2, (await ReadSlicePayloadAsync<CoachingProductView>(added)).Offers);

        // Pro+ keeps whatever its staff choose, a single feature or another.
        await AssertStatusAsync(await N9c5PNewPlanAsync(house.Owner, "N9c5 Pro Messages", "ProPlus", ["Messaging"]), HttpStatusCode.OK);
        await AssertStatusAsync(await N9c5PAddOptionAsync(house.Owner, space.Space.Plan.Id, 8, N9c5PThreeOfFour), HttpStatusCode.OK);
    }

    // ---------- 7. the house's alone, and nobody signed out ----------

    [TestMethod]
    public async Task N9c5PMaxsPlacesAreTheHousesAloneAndNeitherAnotherSpaceNorAnyoneSignedOutReadsOrBooksThem()
    {
        var today = N9b1FStartAtMidday();
        using var space = await N9c5MaxSpaceAsync("p-where", places: "1");
        var house = space.House;
        using var amal = await N9a1TraineeAsync(house.TenantId, "n9c5p-where-amal@example.test", "Amal", "Thornbury", address: "203.0.113.191");
        var ask = await N9c5AskForMaxAsync(space, amal);
        using var coach = CreateClient();
        var coachSpace = await RegisterCoachAsync(coach, "n9c5p-where-zeina@example.test", "Zeina Aoun", "N9c5 Where Gym");
        using var karim = CreateClient();
        var karimId = await InviteAndAcceptAsync(coach, karim, "n9c5p-where-karim@example.test", true);

        // A coaching space sells no Max: a plan with its tier is refused, and a plan like it without one is an ordinary
        // plan, which a coach's client may have and pay without taking the house's place.
        Assert.AreEqual(
            "Only TB Gym's own coaching space sells plans with a tier.",
            await A7FieldErrorAsync(await N9c5PNewPlanAsync(coach, "Zeina Max", "Max", N9c5MaxFeatures), "houseTier"));
        var lookalike = await N9c5PNewPlanAsync(coach, N9c5MaxPlanName, null, N9c5MaxFeatures);
        await AssertStatusAsync(lookalike, HttpStatusCode.OK);
        var theirs = await A7EnrollAsync(coach, karimId, (await ReadSlicePayloadAsync<CoachingProductView>(lookalike)).Offers[0].Id, today);
        await A7PayAsync(coach, theirs.Id, N9c5MaxPrice, today, Guid.NewGuid());
        Assert.AreEqual((HouseTier.Max, HousePlanAskState.Asked, (bool?)true, (int?)null), N9c5PPlace((await N9c1OwnAsync(amal.Client)).Asks.Single()));
        Assert.AreEqual(
            (HouseTier.Max, HousePlanAskState.Asked, (bool?)true, (int?)1),
            N9c5PPlace((await N9c1StaffListAsync(house.Owner, amal.ProfileId)).Single()),
            "The house's one place is still free: nothing of another space counts.");

        // The coach's client reads and asks nothing, there or in the house.
        await AssertStatusAsync(await karim.GetAsync(N9c1PlansUrl), HttpStatusCode.NotFound);
        await AssertStatusAsync(await N9c1AskAsync(karim, space.MaxOfferId), HttpStatusCode.NotFound);
        await AssertStatusAsync(await N9c1SayMoneySentAsync(karim, ask.Id), HttpStatusCode.NotFound);
        SetTenant(karim, house.TenantId);
        await AssertStatusAsync(await karim.GetAsync(N9c1PlansUrl), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await N9c1AskAsync(karim, space.MaxOfferId), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await N9c1SayMoneySentAsync(karim, ask.Id), HttpStatusCode.Forbidden);

        // The coach reads no place in line and books nothing: no such client in their space, refused in the house's.
        await AssertStatusAsync(await coach.GetAsync(N9c1StaffUrl(amal.ProfileId)), HttpStatusCode.NotFound);
        await AssertStatusAsync(await N9c1BookAsync(coach, amal.ProfileId, ask.Id, Guid.NewGuid(), N9c5MaxPrice), HttpStatusCode.NotFound);
        SetTenant(coach, house.TenantId);
        await AssertStatusAsync(await coach.GetAsync(N9c1StaffUrl(amal.ProfileId)), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await N9c1BookAsync(coach, amal.ProfileId, ask.Id, Guid.NewGuid(), N9c5MaxPrice), HttpStatusCode.Forbidden);
        await AssertStatusAsync(await N9c1EnrollAsync(coach, amal.ProfileId, space.MaxOfferId, today, Guid.NewGuid()), HttpStatusCode.Forbidden);
        SetTenant(coach, coachSpace);

        // The house's Owner in the coaching space books nothing there.
        SetTenant(house.Owner, coachSpace);
        await AssertStatusAsync(await N9c5BookMaxAsync(space, amal, ask.Id), HttpStatusCode.Forbidden);
        SetTenant(house.Owner, house.TenantId);

        // Someone signed out: refused before anything is read.
        using var anonymous = CreateClient();
        SetTenant(anonymous, house.TenantId);
        await AssertStatusAsync(await anonymous.GetAsync(N9c1PlansUrl), HttpStatusCode.Unauthorized);
        await AssertStatusAsync(await anonymous.GetAsync(N9c1StaffUrl(amal.ProfileId)), HttpStatusCode.Unauthorized);
        await AssertStatusAsync(await N9c1AskAsync(anonymous, space.MaxOfferId), HttpStatusCode.Unauthorized);
        await AssertStatusAsync(await N9c1SayMoneySentAsync(anonymous, ask.Id), HttpStatusCode.Unauthorized);
        await AssertStatusAsync(await N9c1BookAsync(anonymous, amal.ProfileId, ask.Id, Guid.NewGuid(), N9c5MaxPrice), HttpStatusCode.Unauthorized);
        await AssertStatusAsync(await N9c1EnrollAsync(anonymous, amal.ProfileId, space.MaxOfferId, today, Guid.NewGuid()), HttpStatusCode.Unauthorized);

        // Nothing was written but the one ask, and the place is still free.
        Assert.AreEqual(
            (1L, 0L, 0L, 0),
            (await N9c1AsksOfAsync(amal.ProfileId), await N9c1OutcomesOfAsync(amal.ProfileId), await N9c1TransfersOfAsync(amal.ProfileId),
                (await N9c5PMaxRowsAsync(amal.ProfileId)).Length));
        Assert.AreEqual(0L, await A7ScalarAsync("""SELECT count(*) FROM subscriptions."ClientEnrollments" WHERE "HouseTier" = 'Max'"""));
        Assert.AreEqual(HousePlanAskState.Booked, (await N9c5PBookedAsync(space, amal, ask.Id)).State);
    }

    // ---------- helpers (writer A of N9c5a: Max's places) ----------

    /// <summary>An ask's tier, state, whether its place is open and its place in line, as one value.</summary>
    private static (HouseTier Tier, HousePlanAskState State, bool? PlaceOpen, int? PlaceInLine) N9c5PPlace(HousePlanAskView ask) =>
        (ask.Tier, ask.State, ask.PlaceOpen, ask.PlaceInLine);

    /// <summary>Two trainees' one open ask each, as the house's staff read it: whether its place is open, its place in line.</summary>
    private static async Task<(bool? FirstOpen, int? FirstInLine, bool? SecondOpen, int? SecondInLine)> N9c5PLineAsync(
        HttpClient staff,
        N9a1Trainee first,
        N9a1Trainee second)
    {
        var one = (await N9c1StaffListAsync(staff, first.ProfileId))[0];
        var two = (await N9c1StaffListAsync(staff, second.ProfileId))[0];
        return (one.PlaceOpen, one.PlaceInLine, two.PlaceOpen, two.PlaceInLine);
    }

    /// <summary>Max's option on the trainee's own read; it must be there.</summary>
    private static async Task<HousePlanOfferView> N9c5PMaxOptionAsync(N9a1Trainee trainee) =>
        (await N9c1OwnAsync(trainee.Client)).Plans.Single(plan => plan.Tier == HouseTier.Max);

    /// <summary>The house's Owner books a trainee's Max ask with its whole price; 200 with the booked ask.</summary>
    private static async Task<HousePlanAskView> N9c5PBookedAsync(N9c5MaxSpace space, N9a1Trainee trainee, Guid askId)
    {
        var response = await N9c5BookMaxAsync(space, trainee, askId);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await ReadSlicePayloadAsync<HousePlanAskView>(response);
    }

    /// <summary>The trainee's Max plans as the table holds them, oldest first.</summary>
    private async Task<N9b1FRow[]> N9c5PMaxRowsAsync(Guid clientProfileId) =>
        [.. (await N9b1FRowsAsync(clientProfileId)).Where(item => item.Tier == HouseTier.Max)];

    /// <summary>Pauses or cancels one of the trainee's plans by the staff's ordinary route, at its current version.</summary>
    private static async Task N9c5PChangeStatusAsync(HttpClient staff, Guid clientProfileId, Guid enrollmentId, string change)
    {
        var plan = (await ReadSliceAsync<ClientCommercialOverview>(staff, $"/api/commercial/clients/{clientProfileId}"))
            .Enrollments.Single(item => item.Id == enrollmentId);
        await RefreshCsrfAsync(staff);
        await AssertStatusAsync(
            await staff.PostAsJsonAsync(
                $"/api/commercial/enrollments/{enrollmentId}/{change}",
                new { reason = "N9c5 places check", version = plan.Version }),
            HttpStatusCode.OK);
    }

    /// <summary>The staff's ordinary renewal of a plan, from the day given, under a new key.</summary>
    private static async Task<HttpResponseMessage> N9c5PRenewAsync(HttpClient staff, Guid enrollmentId, Guid offerId, DateOnly startDate)
    {
        await RefreshCsrfAsync(staff);
        return await staff.PostAsJsonAsync(
            $"/api/commercial/enrollments/{enrollmentId}/renew",
            new { offerId, startDate = startDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), idempotencyKey = Guid.NewGuid() });
    }

    /// <summary>A new plan of one four-week option covering the features given, with the tier given (null for none).</summary>
    private static async Task<HttpResponseMessage> N9c5PNewPlanAsync(HttpClient staff, string name, string? houseTier, string[] features)
    {
        await RefreshCsrfAsync(staff);
        return await staff.PostAsJsonAsync(
            A7ProductsUrl,
            new { name, description = (string?)null, initialOffer = B4aOfferRequest(4, N9c5MaxPrice, "USD", features), houseTier });
    }

    /// <summary>A new option of a plan, of the weeks given, covering the features given.</summary>
    private static async Task<HttpResponseMessage> N9c5PAddOptionAsync(HttpClient staff, Guid productId, int weeks, string[] features)
    {
        await RefreshCsrfAsync(staff);
        return await staff.PostAsJsonAsync($"{A7ProductsUrl}/{productId}/offers", B4aOfferRequest(weeks, 259.43m, "USD", features));
    }
}
