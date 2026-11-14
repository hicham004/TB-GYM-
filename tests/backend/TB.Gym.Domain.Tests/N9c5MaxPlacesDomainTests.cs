using System.Globalization;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.Modules.Tenancy;
using TB.Gym.SharedKernel;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// The notes plan's N9c5, Max's places (SUB-021, "MaxPlaces" 1.0), as fixed reference cases: Max is open while its
/// places are above zero; a place is held from the booking until the plan ends, unless it is cancelled, once a trainee
/// however many passes they have; the free places never drop below zero; the open asks of trainees holding none wait in
/// the order given, and an ask's place is open within the free places; a holder's next pass needs no new place; the
/// line's order is told, not enforced at booking. Also what a Max plan covers, the setting's one form, and asking for
/// Max while it is open. Every figure and id is the tests' own.
/// </summary>
[TestClass]
public sealed class N9c5MaxPlacesDomainTests
{
    private static readonly Guid HouseId = Guid.Parse("10000000-0000-0000-0000-0000000009c5");
    private static readonly Guid TraineeUserId = Guid.Parse("20000000-0000-0000-0000-0000000009c5");
    private static readonly Guid Amal = Guid.Parse("30000000-0000-0000-0000-00000000a001");
    private static readonly Guid Basil = Guid.Parse("30000000-0000-0000-0000-00000000a002");
    private static readonly Guid Celine = Guid.Parse("30000000-0000-0000-0000-00000000a003");
    private static readonly Guid Dana = Guid.Parse("30000000-0000-0000-0000-00000000a004");
    private static readonly Guid Elie = Guid.Parse("30000000-0000-0000-0000-00000000a005");
    private static readonly Guid AskOfBasil = Guid.Parse("40000000-0000-0000-0000-00000000b002");
    private static readonly Guid AskOfCeline = Guid.Parse("40000000-0000-0000-0000-00000000b003");
    private static readonly Guid AskOfDana = Guid.Parse("40000000-0000-0000-0000-00000000b004");
    private static readonly Guid AskOfAmal = Guid.Parse("40000000-0000-0000-0000-00000000b001");
    private static readonly DateOnly Today = new(2026, 11, 14);
    private static readonly DateTimeOffset Now = new(2026, 11, 14, 10, 0, 0, TimeSpan.Zero);

    private static readonly OfferFeatureDefinition[] MaxFour =
    [
        new(CoachingFeature.Training),
        new(CoachingFeature.Nutrition),
        new(CoachingFeature.CheckIns),
        new(CoachingFeature.Messaging),
    ];

    private static readonly EnrollmentStatus[] Holding =
        [EnrollmentStatus.PendingPayment, EnrollmentStatus.Active, EnrollmentStatus.Paused, EnrollmentStatus.Expired];

    // ---------- the rule's name, and when Max is open ----------

    [TestMethod]
    public void N9c5PTheRuleIsNamedAndVersioned()
    {
        Assert.AreEqual(("MaxPlaces", "1.0"), (MaxPlacesRule.MethodKey, MaxPlacesRule.MethodVersion));
    }

    [TestMethod]
    public void N9c5PMaxIsOpenWhileItsPlacesAreAboveZero()
    {
        foreach (var closed in new int?[] { null, 0, -1, int.MinValue })
        {
            Assert.IsFalse(MaxPlacesRule.IsOpen(closed), closed?.ToString(CultureInfo.InvariantCulture) ?? "empty");
            Assert.AreEqual(0, MaxPlacesRule.FreePlaces(closed, 0), "No place is free while Max is closed.");
        }

        foreach (var open in new int?[] { 1, 6, 1_000 })
        {
            Assert.IsTrue(MaxPlacesRule.IsOpen(open), open?.ToString(CultureInfo.InvariantCulture));
        }

        var none = MaxPlacesRule.On(null, [], [Ask(AskOfBasil, Basil)], Today);
        Assert.IsFalse(none.IsOpen);
        Assert.AreEqual(new MaxAskPlace(AskOfBasil, Basil, 1, false), none.PlaceOf(AskOfBasil), "Its place in line is kept, no place open.");
        Assert.IsFalse(none.WouldHaveAPlace(Basil));
        Assert.IsFalse(none.MayBook(Basil));
    }

    // ---------- a place is held from the booking until the plan ends ----------

    [TestMethod]
    public void N9c5PAPlaceIsHeldFromTheBookingUntilThePlanEndsUnlessItIsCancelled()
    {
        // Running, paused, waiting for its money or booked to start later: each holds its place.
        foreach (var status in Holding)
        {
            Assert.IsTrue(MaxPlacesRule.HoldsAPlace(new MaxPlacePlan(Amal, status, Today.AddDays(1)), Today), status.ToString());
            Assert.IsTrue(MaxPlacesRule.HoldsAPlace(new MaxPlacePlan(Amal, status, Today.AddDays(60)), Today), $"{status}, a pass still to start.");
        }

        // Cancelled holds none, however far its days run; a plan whose exclusive end is today has ended (half-open).
        Assert.IsFalse(MaxPlacesRule.HoldsAPlace(new MaxPlacePlan(Amal, EnrollmentStatus.Cancelled, Today.AddDays(20)), Today));
        Assert.IsFalse(MaxPlacesRule.HoldsAPlace(new MaxPlacePlan(Amal, EnrollmentStatus.Active, Today), Today), "Its last day was yesterday.");
        Assert.IsFalse(MaxPlacesRule.HoldsAPlace(new MaxPlacePlan(Amal, EnrollmentStatus.Active, Today.AddDays(-9)), Today));
        Assert.ThrowsExactly<ArgumentNullException>(() => MaxPlacesRule.HoldsAPlace(null!, Today));
    }

    [TestMethod]
    public void N9c5PTheFreePlacesAreThePlacesLessTheTraineesHoldingOneAndNeverBelowZero()
    {
        Assert.AreEqual(3, MaxPlacesRule.FreePlaces(3, 0));
        Assert.AreEqual(2, MaxPlacesRule.FreePlaces(3, 1));
        Assert.AreEqual(0, MaxPlacesRule.FreePlaces(3, 3));
        Assert.AreEqual(0, MaxPlacesRule.FreePlaces(2, 5), "Places lowered below the trainees on Max end nobody's plan.");
        Assert.AreEqual(4, MaxPlacesRule.FreePlaces(4, -2), "A count below zero counts as none.");

        // A trainee holds one place however many passes they have still to end: this one and the next.
        var places = MaxPlacesRule.On(
            3,
            [
                new MaxPlacePlan(Amal, EnrollmentStatus.Active, Today.AddDays(10)),
                new MaxPlacePlan(Amal, EnrollmentStatus.Active, Today.AddDays(38)),
                new MaxPlacePlan(Basil, EnrollmentStatus.Paused, Today.AddDays(3)),
                new MaxPlacePlan(Celine, EnrollmentStatus.Cancelled, Today.AddDays(25)),
                new MaxPlacePlan(Dana, EnrollmentStatus.Active, Today),
            ],
            [],
            Today);
        CollectionAssert.AreEquivalent(new[] { Amal, Basil }, places.Holders.ToArray());
        Assert.AreEqual((2, 1, 0), (places.Holders.Count, places.Free, places.Waiting));
        Assert.IsTrue(places.Holds(Amal));
        Assert.IsFalse(places.Holds(Celine), "A cancelled Max frees its place.");
        Assert.IsFalse(places.Holds(Dana), "An ended Max frees its place.");
    }

    // ---------- the line ----------

    [TestMethod]
    public void N9c5PTheAsksOfTraineesHoldingNoPlaceWaitInTheOrderGivenAndThoseWithinTheFreePlacesHaveOne()
    {
        // Three places, one held by Amal: two free. Basil, Celine and Dana asked in that order; Amal asked for a next pass.
        var places = MaxPlacesRule.On(
            3,
            [new MaxPlacePlan(Amal, EnrollmentStatus.Active, Today.AddDays(5))],
            [Ask(AskOfBasil, Basil), Ask(AskOfAmal, Amal), Ask(AskOfCeline, Celine), Ask(AskOfDana, Dana)],
            Today);
        Assert.AreEqual((2, 3), (places.Free, places.Waiting));
        CollectionAssert.AreEqual(
            new[]
            {
                new MaxAskPlace(AskOfBasil, Basil, 1, true),
                new MaxAskPlace(AskOfAmal, Amal, null, true),
                new MaxAskPlace(AskOfCeline, Celine, 2, true),
                new MaxAskPlace(AskOfDana, Dana, 3, false),
            },
            places.Asks.ToArray(),
            "The holder's ask never queues; the line counts 1, 2, 3 past it.");
        Assert.AreEqual(new MaxAskPlace(AskOfDana, Dana, 3, false), places.PlaceOf(AskOfDana));
        Assert.IsNull(places.PlaceOf(Guid.Parse("40000000-0000-0000-0000-00000000bfff")), "No such open ask.");

        // The order is the one given: the database orders the asks (time asked, then id), the rule never reorders them.
        var reversed = MaxPlacesRule.On(1, [], [Ask(AskOfDana, Dana), Ask(AskOfBasil, Basil)], Today);
        CollectionAssert.AreEqual(
            new[] { new MaxAskPlace(AskOfDana, Dana, 1, true), new MaxAskPlace(AskOfBasil, Basil, 2, false) },
            reversed.Asks.ToArray());
    }

    [TestMethod]
    public void N9c5PEveryPlaceTakenLeavesEveryAskInLineWithoutAPlaceAndTheHoldersWithTheirs()
    {
        var places = MaxPlacesRule.On(
            2,
            [new MaxPlacePlan(Amal, EnrollmentStatus.Active, Today.AddDays(5)), new MaxPlacePlan(Elie, EnrollmentStatus.PendingPayment, Today.AddDays(30))],
            [Ask(AskOfBasil, Basil), Ask(AskOfAmal, Amal)],
            Today);
        Assert.AreEqual(0, places.Free);
        Assert.AreEqual(new MaxAskPlace(AskOfBasil, Basil, 1, false), places.PlaceOf(AskOfBasil));
        Assert.AreEqual(new MaxAskPlace(AskOfAmal, Amal, null, true), places.PlaceOf(AskOfAmal), "A renewal needs no new place.");

        // Closed, nobody's ask has a place, a holder's included: nothing on Max is booked while it is closed.
        var closed = MaxPlacesRule.On(0, [new MaxPlacePlan(Amal, EnrollmentStatus.Active, Today.AddDays(5))], [Ask(AskOfAmal, Amal)], Today);
        Assert.AreEqual(new MaxAskPlace(AskOfAmal, Amal, null, false), closed.PlaceOf(AskOfAmal));
        Assert.IsFalse(closed.MayBook(Amal));
    }

    // ---------- whether an ask would have a place, and who may be booked ----------

    [TestMethod]
    public void N9c5PANewAskWouldHaveAPlaceWhenMorePlacesAreFreeThanOtherTraineesAsksWait()
    {
        // Two free places; Basil and Celine wait.
        var places = MaxPlacesRule.On(3, [new MaxPlacePlan(Amal, EnrollmentStatus.Active, Today.AddDays(5))], [Ask(AskOfBasil, Basil), Ask(AskOfCeline, Celine)], Today);
        Assert.IsTrue(places.WouldHaveAPlace(Amal), "A holder always would.");
        Assert.IsFalse(places.WouldHaveAPlace(Dana), "Two free places, two asks before hers.");
        Assert.IsTrue(places.WouldHaveAPlace(Basil), "Not counting their own ask: one other waits for two places.");
        Assert.IsTrue(places.WouldHaveAPlace(Celine));

        var roomy = MaxPlacesRule.On(4, [new MaxPlacePlan(Amal, EnrollmentStatus.Active, Today.AddDays(5))], [Ask(AskOfBasil, Basil), Ask(AskOfCeline, Celine)], Today);
        Assert.IsTrue(roomy.WouldHaveAPlace(Dana), "Three free places, two asks before hers.");
    }

    [TestMethod]
    public void N9c5PABookingTakesAFreePlaceOrTheTraineesOwnAndTheLinesOrderIsToldNotEnforced()
    {
        // One free place, Basil first in line: Dana, third, may still be booked; an unpaid earlier ask holds no place.
        var one = MaxPlacesRule.On(
            2,
            [new MaxPlacePlan(Amal, EnrollmentStatus.Active, Today.AddDays(5))],
            [Ask(AskOfBasil, Basil), Ask(AskOfCeline, Celine), Ask(AskOfDana, Dana)],
            Today);
        Assert.IsTrue(one.MayBook(Basil));
        Assert.IsTrue(one.MayBook(Dana));
        Assert.IsTrue(one.MayBook(Amal), "A holder's next pass keeps their place.");

        // Every place taken: only a holder's next pass.
        var full = MaxPlacesRule.On(
            1,
            [new MaxPlacePlan(Amal, EnrollmentStatus.Paused, Today.AddDays(5))],
            [Ask(AskOfBasil, Basil)],
            Today);
        Assert.IsFalse(full.MayBook(Basil));
        Assert.IsTrue(full.MayBook(Amal));

        // Once Amal's plan is cancelled, or once it has ended, the place is free again.
        Assert.IsTrue(MaxPlacesRule.On(1, [new MaxPlacePlan(Amal, EnrollmentStatus.Cancelled, Today.AddDays(5))], [], Today).MayBook(Basil));
        Assert.IsTrue(MaxPlacesRule.On(1, [new MaxPlacePlan(Amal, EnrollmentStatus.Paused, Today.AddDays(5))], [], Today.AddDays(5)).MayBook(Basil));

        Assert.ThrowsExactly<ArgumentNullException>(() => MaxPlacesRule.On(1, null!, [], Today));
        Assert.ThrowsExactly<ArgumentNullException>(() => MaxPlacesRule.On(1, [], null!, Today));
    }

    [TestMethod]
    public void N9c5PTheRefusalsReadInTheWordsThePeopleRead()
    {
        Assert.AreEqual(
            (
                "A Max place isn't open for you yet. Your ask is kept in line; don't send money until a place opens.",
                "Max isn't taking anyone right now. Your ask is kept; don't send money until it opens again.",
                "Max is closed: TB Gym's settings give it no places. Book this ask once Max opens again, or close it.",
                "Every place on Max is taken. Book this ask once a place opens, or close it.",
                "Max is booked from the trainee's ask, so its places are kept."),
            (
                MaxPlacesRule.PlaceNotOpenMessage,
                MaxPlacesRule.ClosedForTraineeMessage,
                MaxPlacesRule.ClosedForStaffMessage,
                MaxPlacesRule.FullMessage,
                MaxPlanRule.ByAskRefusal));
        Assert.AreEqual(
            ("house_max_closed", "house_max_full", "house_max_place_not_open", "house_max_by_ask"),
            (HousePlanAskCodes.MaxClosed, HousePlanAskCodes.MaxFull, HousePlanAskCodes.MaxPlaceNotOpen, HousePlanAskCodes.MaxByAsk));
    }

    [TestMethod]
    public void N9c5PAnAskWhoseMoneyWasSaidSentHoldsItsPlaceUntilItIsBookedOrClosed()
    {
        // Amal holds the one place with a pass ending in five days and has said the money for her next pass was sent;
        // Basil asked before her next ask. On the day her pass ends her place is still hers: Basil's stays closed and
        // only Amal may be booked.
        var plans = new[] { new MaxPlacePlan(Amal, EnrollmentStatus.Active, Today.AddDays(5)) };
        MaxPlaceAsk[] line = [Ask(AskOfBasil, Basil), new MaxPlaceAsk(AskOfAmal, Amal, MoneySent: true)];
        foreach (var day in new[] { Today, Today.AddDays(5), Today.AddDays(40) })
        {
            var places = MaxPlacesRule.On(1, plans, line, day);
            Assert.AreEqual((true, 0, false, true), (places.Holds(Amal), places.Free, places.MayBook(Basil), places.MayBook(Amal)), day.ToString("O", CultureInfo.InvariantCulture));
            Assert.AreEqual(new MaxAskPlace(AskOfBasil, Basil, 1, false), places.PlaceOf(AskOfBasil));
            Assert.AreEqual(new MaxAskPlace(AskOfAmal, Amal, null, true), places.PlaceOf(AskOfAmal));
        }

        // Without her word on the money, the day her pass ends the place is Basil's, first in line.
        var unpaid = MaxPlacesRule.On(1, plans, [Ask(AskOfBasil, Basil), Ask(AskOfAmal, Amal)], Today.AddDays(5));
        Assert.AreEqual(
            (new MaxAskPlace(AskOfBasil, Basil, 1, true), new MaxAskPlace(AskOfAmal, Amal, 2, false)),
            (unpaid.PlaceOf(AskOfBasil), unpaid.PlaceOf(AskOfAmal)));

        // Celine, first in line with one free place, says the money was sent: the place is hers until her ask is booked
        // or closed, so Dana, asked later, may not be booked into it and her place is not open; closed, it is Dana's.
        var reserved = MaxPlacesRule.On(
            1,
            [],
            [new MaxPlaceAsk(AskOfCeline, Celine, MoneySent: true), Ask(AskOfDana, Dana)],
            Today);
        Assert.AreEqual((0, true, false), (reserved.Free, reserved.MayBook(Celine), reserved.MayBook(Dana)));
        Assert.AreEqual(
            (new MaxAskPlace(AskOfCeline, Celine, null, true), new MaxAskPlace(AskOfDana, Dana, 1, false)),
            (reserved.PlaceOf(AskOfCeline), reserved.PlaceOf(AskOfDana)));
        Assert.IsFalse(reserved.WouldHaveAPlace(Elie));
        var closed = MaxPlacesRule.On(1, [], [Ask(AskOfDana, Dana)], Today);
        Assert.AreEqual((1, true, new MaxAskPlace(AskOfDana, Dana, 1, true)), (closed.Free, closed.MayBook(Dana), closed.PlaceOf(AskOfDana)));

        // A trainee holding by a plan and by a word on the money holds one place; while Max is closed nobody may pay.
        var both = MaxPlacesRule.On(2, plans, [new MaxPlaceAsk(AskOfAmal, Amal, MoneySent: true), Ask(AskOfBasil, Basil)], Today);
        Assert.AreEqual((1, new MaxAskPlace(AskOfBasil, Basil, 1, true)), (both.Free, both.PlaceOf(AskOfBasil)));
        var shut = MaxPlacesRule.On(0, plans, [new MaxPlaceAsk(AskOfAmal, Amal, MoneySent: true)], Today);
        Assert.AreEqual((false, false), (shut.MayBook(Amal), shut.PlaceOf(AskOfAmal)!.PlaceOpen));
    }

    // ---------- what a Max plan covers ----------

    [TestMethod]
    public void N9c5PAMaxOptionCoversTrainingNutritionCheckInsAndMessagingAllFourAndNothingElse()
    {
        CollectionAssert.AreEqual(
            new[] { CoachingFeature.Training, CoachingFeature.Nutrition, CoachingFeature.CheckIns, CoachingFeature.Messaging },
            MaxPlanRule.Features.ToArray());
        Assert.AreEqual(
            ("A Max plan covers Training, Nutrition, Check-ins and Messaging, all four.", 4),
            (MaxPlanRule.FeaturesRefusal, MaxPlanRule.Features.Count));
        Assert.IsTrue(MaxPlanRule.CoversItsFour(MaxPlanRule.Features));
        Assert.IsTrue(
            MaxPlanRule.CoversItsFour([CoachingFeature.Messaging, CoachingFeature.CheckIns, CoachingFeature.Training, CoachingFeature.Nutrition]),
            "In any order.");

        foreach (var (features, what) in new (CoachingFeature[], string)[]
        {
            ([], "nothing"),
            ([CoachingFeature.Training], "Training alone"),
            ([CoachingFeature.Training, CoachingFeature.Nutrition, CoachingFeature.CheckIns], "three of the four"),
            ([.. MaxPlanRule.Features, CoachingFeature.ResourceLibrary], "a fifth"),
            ([.. MaxPlanRule.Features, CoachingFeature.Sessions], "sessions"),
            ([CoachingFeature.Training, CoachingFeature.Training, CoachingFeature.Nutrition, CoachingFeature.CheckIns], "one twice"),
            ([CoachingFeature.Training, CoachingFeature.Nutrition, CoachingFeature.CheckIns, CoachingFeature.ResourceLibrary], "one swapped"),
        })
        {
            Assert.IsFalse(MaxPlanRule.CoversItsFour(features), what);
        }

        Assert.ThrowsExactly<ArgumentNullException>(() => MaxPlanRule.CoversItsFour(null!));
    }

    // ---------- the setting, and asking for Max ----------

    [TestMethod]
    public void N9c5PMaxsPlacesAreAWholeNumberFromZeroToAThousandAndEmptyOrZeroKeepsMaxClosed()
    {
        Assert.AreEqual(
            (1_000, "Enter a whole number of places from 0 to 1,000, or leave it empty. Empty or 0 keeps Max closed."),
            (HouseSettingRule.MaximumMaxPlaces, HouseSettingRule.MaxPlacesRefusal));
        Assert.AreEqual("0", HouseSettingRule.Normalize(HouseSetting.MaxPlaces, "0").Value);
        Assert.AreEqual("6", HouseSettingRule.Normalize(HouseSetting.MaxPlaces, " 006 ").Value);
        Assert.AreEqual("1000", HouseSettingRule.Normalize(HouseSetting.MaxPlaces, "1000").Value);
        Assert.AreEqual(HouseSettingValue.Empty, HouseSettingRule.Normalize(HouseSetting.MaxPlaces, "  "));

        const string Sentence = "Enter a whole number of places from 0 to 1,000, or leave it empty. Empty or 0 keeps Max closed.";
        foreach (var refused in new[] { "1001", "-1", "2.5", "six", "+6", "6 places", "999999999" })
        {
            var value = HouseSettingRule.Normalize(HouseSetting.MaxPlaces, refused);
            Assert.AreEqual((false, (string?)null, (string?)Sentence), (value.IsValid, value.Value, value.Error), refused);
        }

        Assert.AreEqual(
            (int?)6,
            HouseSettings.From([KeyValuePair.Create(HouseSetting.MaxPlaces, (string?)"6")]).MaxPlaces);
        Assert.IsNull(HouseSettings.Empty.MaxPlaces);
        Assert.IsFalse(MaxPlacesRule.IsOpen(HouseSettings.From([KeyValuePair.Create(HouseSetting.MaxPlaces, (string?)"0")]).MaxPlaces));
    }

    [TestMethod]
    public void N9c5PMaxIsAskedForOnlyWhileOpenAndAnAskForItCarriesItsTier()
    {
        var max = CoachingProduct.Create(HouseId, "N9c5 Max", null, ProductKind.CoachingPlan, HouseTier.Max);
        var option = ProductOffer.CreateFixedDuration(HouseId, max.Id, "Four weeks", 4, OfferDurationUnit.Week, 141.17m, "USD", MaxFour);
        Assert.IsFalse(HousePlanAskRule.IsAskable(max, option), "The two-argument form means Max closed.");
        Assert.IsFalse(HousePlanAskRule.IsAskable(max, option, maxOpen: false));
        Assert.IsTrue(HousePlanAskRule.IsAskable(max, option, maxOpen: true));

        // Open Max changes nothing else: Pro+ is askable either way, a free Max option never is.
        var proPlus = CoachingProduct.Create(HouseId, "N9c5 Pro+", null, ProductKind.CoachingPlan, HouseTier.ProPlus);
        var proOption = ProductOffer.CreateFixedDuration(HouseId, proPlus.Id, "Four weeks", 4, OfferDurationUnit.Week, 47.50m, "USD", MaxFour);
        Assert.IsTrue(HousePlanAskRule.IsAskable(proPlus, proOption, maxOpen: true));
        Assert.IsTrue(HousePlanAskRule.IsAskable(proPlus, proOption, maxOpen: false));
        var nothing = ProductOffer.CreateFixedDuration(HouseId, max.Id, "Trial", 1, OfferDurationUnit.Week, 0m, "USD", MaxFour);
        Assert.IsFalse(HousePlanAskRule.IsAskable(max, nothing, maxOpen: true));

        var ask = HousePlanAsk.Create(HouseId, Amal, max, option, TraineeUserId, Today, Now, maxOpen: true);
        Assert.AreEqual((HouseTier.Max, max.Id, option.Id, Amal), (ask.Tier, ask.ProductId, ask.OfferId, ask.ClientProfileId));
        Assert.AreEqual(
            HousePlanAskRule.NotOnSaleMessage,
            Assert.ThrowsExactly<ArgumentException>(() => HousePlanAsk.Create(HouseId, Amal, max, option, TraineeUserId, Today, Now)).Message);
    }

    private static MaxPlaceAsk Ask(Guid askId, Guid clientProfileId) => new(askId, clientProfileId);
}
