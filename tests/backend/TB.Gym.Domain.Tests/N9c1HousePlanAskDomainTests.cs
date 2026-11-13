using TB.Gym.Modules.Subscriptions;
using TB.Gym.Modules.Tenancy;
using TB.Gym.SharedKernel;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// The notes plan's N9c1, asking for a plan of the house and paying (SUB-020): which of the house's plans a trainee may
/// ask for, how the Whish name and number, a closing reason and a receipt's reference are kept, the day a booking
/// starts on, where an ask stands, the trainee's word on the money and its one change (closing the account), how an
/// ask ends, and the house's own Whish number as a setting. Every name, number and figure is the tests' own.
/// </summary>
[TestClass]
public sealed class N9c1HousePlanAskDomainTests
{
    private static readonly Guid HouseId = Guid.Parse("10000000-0000-0000-0000-0000000009c1");
    private static readonly Guid OtherSpaceId = Guid.Parse("10000000-0000-0000-0000-0000000009c2");
    private static readonly Guid TraineeUserId = Guid.Parse("20000000-0000-0000-0000-0000000009c1");
    private static readonly Guid StaffUserId = Guid.Parse("20000000-0000-0000-0000-0000000009c2");
    private static readonly Guid ProfileId = Guid.Parse("30000000-0000-0000-0000-0000000009c1");
    private static readonly Guid OtherProfileId = Guid.Parse("30000000-0000-0000-0000-0000000009c2");
    private static readonly Guid Key = Guid.Parse("40000000-0000-0000-0000-0000000009c1");
    private static readonly Guid OtherKey = Guid.Parse("40000000-0000-0000-0000-0000000009c2");
    private static readonly DateOnly Today = new(2026, 11, 13);
    private static readonly DateTimeOffset Now = new(2026, 11, 13, 9, 0, 0, TimeSpan.Zero);
    private static readonly OfferFeatureDefinition[] TrainingOnly = [new(CoachingFeature.Training)];
    private static readonly OfferFeatureDefinition[] PackFeatures = [new(CoachingFeature.Sessions, true)];

    private const string WhishName = "Zephyrine Quillfeather";
    private const string WhishNumber = "+961 71 234 567";

    // ---------- which plans may be asked for ----------

    [TestMethod]
    public void N9c1OnlyAPricedOptionOnSaleOfAProPlusCoachingPlanMayBeAskedFor()
    {
        var (product, offer) = Plan();
        Assert.IsTrue(HousePlanAskRule.IsAskable(product, offer));

        var (max, maxOffer) = Plan(HouseTier.Max);
        Assert.IsFalse(HousePlanAskRule.IsAskable(max, maxOffer), "Max stays closed until its places exist (N9c5).");

        var (untiered, untieredOffer) = Plan(null);
        Assert.IsFalse(HousePlanAskRule.IsAskable(untiered, untieredOffer), "A plan without a tier is no plan of the house's.");

        var free = CoachingProduct.CreateHouseFree(HouseId);
        Assert.IsFalse(HousePlanAskRule.IsAskable(free, ProductOffer.CreateHouseFree(HouseId, free.Id, "USD")));

        var (zero, zeroOffer) = Plan(price: 0m);
        Assert.IsFalse(HousePlanAskRule.IsAskable(zero, zeroOffer), "A plan at no price is never asked for.");

        var (off, offOffer) = Plan();
        off.Update(off.Name, off.Description, isActive: false);
        Assert.IsFalse(HousePlanAskRule.IsAskable(off, offOffer), "A plan off sale.");

        var (onSale, offerOffSale) = Plan();
        offerOffSale.SetAvailability(false, []);
        Assert.IsFalse(HousePlanAskRule.IsAskable(onSale, offerOffSale), "An option off sale.");

        // A pack's option is never a plan to ask for: not under a pack, nor slipped under a Pro+ plan.
        var pack = CoachingProduct.Create(HouseId, "N9c1 Pack", null, ProductKind.SessionPack);
        var packOffer = ProductOffer.CreateFixedDuration(HouseId, pack.Id, "Eight sessions", 6, OfferDurationUnit.Week, 61.25m, "USD", PackFeatures, 8);
        Assert.IsFalse(HousePlanAskRule.IsAskable(pack, packOffer));
        var sessionsUnderProPlus = ProductOffer.CreateFixedDuration(HouseId, product.Id, "Eight sessions", 6, OfferDurationUnit.Week, 61.25m, "USD", PackFeatures, 8);
        Assert.IsFalse(HousePlanAskRule.IsAskable(product, sessionsUnderProPlus));

        // An option of another plan.
        var (_, otherOffer) = Plan();
        Assert.IsFalse(HousePlanAskRule.IsAskable(product, otherOffer));

        Assert.ThrowsExactly<ArgumentNullException>(() => HousePlanAskRule.IsAskable(null!, offer));
        Assert.ThrowsExactly<ArgumentNullException>(() => HousePlanAskRule.IsAskable(product, null!));
    }

    [TestMethod]
    public void N9c1AnAskNamesTheTraineeThePlanItsOptionAndTierAndRefusesWhatIsNotOnSale()
    {
        var (product, offer) = Plan();
        var ask = HousePlanAsk.Create(HouseId, ProfileId, product, offer, TraineeUserId, Today, Now);
        Assert.AreEqual(
            (HouseId, ProfileId, product.Id, offer.Id, HouseTier.ProPlus, TraineeUserId, Today, Now),
            (ask.TenantId, ask.ClientProfileId, ask.ProductId, ask.OfferId, ask.Tier, ask.AskedByUserId, ask.AskedOn, ask.AskedAtUtc));

        Assert.ThrowsExactly<ArgumentException>(() => HousePlanAsk.Create(HouseId, Guid.Empty, product, offer, TraineeUserId, Today, Now));
        Assert.ThrowsExactly<ArgumentException>(() => HousePlanAsk.Create(HouseId, ProfileId, product, offer, Guid.Empty, Today, Now));
        var (_, otherOffer) = Plan();
        Assert.ThrowsExactly<ArgumentException>(() => HousePlanAsk.Create(HouseId, ProfileId, product, otherOffer, TraineeUserId, Today, Now));
        Assert.ThrowsExactly<ArgumentException>(() => HousePlanAsk.Create(OtherSpaceId, ProfileId, product, offer, TraineeUserId, Today, Now));
        var (max, maxOffer) = Plan(HouseTier.Max);
        var refused = Assert.ThrowsExactly<ArgumentException>(() => HousePlanAsk.Create(HouseId, ProfileId, max, maxOffer, TraineeUserId, Today, Now));
        Assert.AreEqual(HousePlanAskRule.NotOnSaleMessage, refused.PersonMessage());
    }

    // ---------- the words kept ----------

    [TestMethod]
    public void N9c1TheWhishNameIsTrimmedWithSingleSpacesUpToAHundredCharacters()
    {
        Assert.AreEqual(HousePlanAskText.Of(WhishName), HousePlanAskRule.NormalizeWhishName("  Zephyrine \t  Quillfeather "));
        Assert.AreEqual(HousePlanAskText.Of(WhishName), HousePlanAskRule.NormalizeWhishName("Zephyrine\nQuillfeather"));
        Assert.AreEqual(HousePlanAskText.Of(new string('z', 100)), HousePlanAskRule.NormalizeWhishName(new string('z', 100)));

        foreach (var refused in new[] { null, string.Empty, "   ", new string('z', 101), "Zephyrine\u0007Quillfeather" })
        {
            Assert.AreEqual(
                HousePlanAskText.Refused(HousePlanAskRule.WhishNameRefusal),
                HousePlanAskRule.NormalizeWhishName(refused),
                $"'{refused}'");
        }
    }

    [TestMethod]
    public void N9c1TheWhishNumberIsKeptInTheGroupsTypedWithAnOptionalPlusAndSixToTwentyDigits()
    {
        var kept = new (string Typed, string Stored)[]
        {
            ("+961 71 234 567", "+961 71 234 567"),
            ("  +961   71 234567 ", "+961 71 234567"),
            ("+ 961 71 234", "+961 71 234"),
            ("71234567", "71234567"),
            ("123456", "123456"),
            ("12345678901234567890", "12345678901234567890"),
            ("+1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0", "+1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0"),
        };
        foreach (var (typed, stored) in kept)
        {
            Assert.AreEqual(HousePlanAskText.Of(stored), HousePlanAskRule.NormalizeWhishNumber(typed), typed);
        }

        var refused = new[]
        {
            null, string.Empty, "   ", "+", "12345", "+961 7", "71-234-567", "(961) 71 234567", "123456789012345678901",
            "++961 71 234567", "961 71 234567+", "٧١٢٣٤٥٦", "71 234 567 ext",
        };
        foreach (var typed in refused)
        {
            Assert.AreEqual(
                HousePlanAskText.Refused(HousePlanAskRule.WhishNumberRefusal),
                HousePlanAskRule.NormalizeWhishNumber(typed),
                $"'{typed}'");
        }
    }

    [TestMethod]
    public void N9c1AClosingReasonKeepsItsLineBreaksAndAReferenceMayBeEmpty()
    {
        Assert.AreEqual(HousePlanAskText.Of("No transfer arrived."), HousePlanAskRule.NormalizeReason("  No transfer arrived.  "));
        Assert.AreEqual(HousePlanAskText.Of("Line one\nLine two"), HousePlanAskRule.NormalizeReason("Line one\nLine two"));
        Assert.AreEqual(HousePlanAskText.Of("Line one\r\nLine two"), HousePlanAskRule.NormalizeReason("Line one\r\nLine two"));
        Assert.AreEqual(HousePlanAskText.Of(new string('r', 500)), HousePlanAskRule.NormalizeReason(new string('r', 500)));
        foreach (var refused in new[] { null, string.Empty, "  \n ", new string('r', 501), "No\ttransfer", "No\u0000transfer" })
        {
            Assert.AreEqual(
                HousePlanAskText.Refused(HousePlanAskRule.ReasonRefusal),
                HousePlanAskRule.NormalizeReason(refused),
                $"'{refused}'");
        }

        Assert.AreEqual(new HousePlanAskText(true, null, null), HousePlanAskRule.NormalizeReference(null));
        Assert.AreEqual(new HousePlanAskText(true, null, null), HousePlanAskRule.NormalizeReference("   "));
        Assert.AreEqual(HousePlanAskText.Of("WH-7731"), HousePlanAskRule.NormalizeReference("  WH-7731 "));
        Assert.AreEqual(HousePlanAskText.Of(new string('w', 200)), HousePlanAskRule.NormalizeReference(new string('w', 200)));
        foreach (var refused in new[] { new string('w', 201), "WH\n7731" })
        {
            Assert.AreEqual(
                HousePlanAskText.Refused(HousePlanAskRule.ReferenceRefusal),
                HousePlanAskRule.NormalizeReference(refused),
                $"'{refused}'");
        }

        Assert.AreEqual("USD 47.50", HousePlanAskRule.Money(47.5m, "USD"));
    }

    // ---------- the day a booking starts and where an ask stands ----------

    [TestMethod]
    public void N9c1ABookingStartsTodayOrWhenTheLatestPaidPlanStillToEndEnds()
    {
        Assert.AreEqual(Today, HousePlanAskRule.BookingStart(Today, []));
        Assert.AreEqual(Today, HousePlanAskRule.BookingStart(Today, [Today.AddDays(-9), Today.AddDays(-1)]), "Ended plans are ignored.");
        Assert.AreEqual(Today, HousePlanAskRule.BookingStart(Today, [Today]), "A plan ending today leaves today free.");
        Assert.AreEqual(Today.AddDays(11), HousePlanAskRule.BookingStart(Today, [Today.AddDays(11)]));
        Assert.AreEqual(
            Today.AddDays(39),
            HousePlanAskRule.BookingStart(Today, [Today.AddDays(11), Today.AddDays(39), Today.AddDays(-4), Today.AddDays(25)]));
        Assert.ThrowsExactly<ArgumentNullException>(() => HousePlanAskRule.BookingStart(Today, null!));
    }

    [TestMethod]
    public void N9c1AnAskStandsAskedThenMoneySentAndItsOutcomeWinsOverBoth()
    {
        Assert.AreEqual(HousePlanAskState.Asked, HousePlanAskRule.State(false, null));
        Assert.AreEqual(HousePlanAskState.MoneySent, HousePlanAskRule.State(true, null));
        Assert.AreEqual(HousePlanAskState.Booked, HousePlanAskRule.State(true, HousePlanAskOutcomeKind.Booked));
        Assert.AreEqual(HousePlanAskState.Booked, HousePlanAskRule.State(false, HousePlanAskOutcomeKind.Booked));
        Assert.AreEqual(HousePlanAskState.Closed, HousePlanAskRule.State(false, HousePlanAskOutcomeKind.Closed));
        Assert.AreEqual(HousePlanAskState.Closed, HousePlanAskRule.State(true, HousePlanAskOutcomeKind.Closed));
    }

    // ---------- the word on the money ----------

    [TestMethod]
    public void N9c1TheWordOnTheMoneyKeepsTheDetailsAsTheRuleWritesThemAndMatchesThemSoTyped()
    {
        var ask = Ask();
        var transfer = HousePlanTransfer.Record(HouseId, ask, "  Zephyrine   Quillfeather ", " +961  71 234 567 ", Today, Now);
        Assert.AreEqual(
            (HouseId, ask.Id, ProfileId, WhishName, WhishNumber, Today, Now, (DateTimeOffset?)null),
            (transfer.TenantId, transfer.AskId, transfer.ClientProfileId, transfer.WhishName, transfer.WhishNumber, transfer.SentOn, transfer.SentAtUtc, transfer.AnonymisedAtUtc));

        Assert.IsTrue(transfer.Matches(WhishName, WhishNumber));
        Assert.IsTrue(transfer.Matches(" Zephyrine Quillfeather", "+961 71   234 567"), "Typed again with other spaces.");
        Assert.IsTrue(transfer.Matches(WhishName, "+ 961 71 234 567"));
        Assert.IsFalse(transfer.Matches("Zephyrine Quillfeathers", WhishNumber));
        Assert.IsFalse(transfer.Matches(WhishName, "+961 71 234 568"));
        Assert.IsFalse(transfer.Matches(WhishName, "961 71 234 567"), "The + is part of the number as typed.");
        Assert.IsFalse(transfer.Matches(WhishName, "+96171234567"), "The groups are part of the number as typed.");
        Assert.IsFalse(transfer.Matches("zephyrine quillfeather", WhishNumber), "Case is kept.");
        Assert.IsFalse(transfer.Matches(null, null));
    }

    [TestMethod]
    public void N9c1ClosingTheAccountErasesTheWhishDetailsOnceAndNothingElse()
    {
        var transfer = HousePlanTransfer.Record(HouseId, Ask(), WhishName, WhishNumber, Today, Now);
        var later = Now.AddDays(3);
        Assert.IsTrue(transfer.Anonymise(later));
        Assert.AreEqual(
            ((string?)null, (string?)null, (DateTimeOffset?)later, Today, Now),
            (transfer.WhishName, transfer.WhishNumber, transfer.AnonymisedAtUtc, transfer.SentOn, transfer.SentAtUtc));
        Assert.IsFalse(transfer.Anonymise(later.AddDays(1)), "Erased once.");
        Assert.AreEqual(later, transfer.AnonymisedAtUtc);
        Assert.IsFalse(transfer.Matches(WhishName, WhishNumber), "Erased details match nothing.");
    }

    [TestMethod]
    public void N9c1TheWordOnTheMoneyRefusesBadDetailsAndAnotherSpacesAsk()
    {
        var ask = Ask();
        var badName = Assert.ThrowsExactly<ArgumentException>(() => HousePlanTransfer.Record(HouseId, ask, "  ", WhishNumber, Today, Now));
        Assert.AreEqual((HousePlanAskRule.WhishNameRefusal, "whishName"), (badName.PersonMessage(), badName.ParamName));
        var badNumber = Assert.ThrowsExactly<ArgumentException>(() => HousePlanTransfer.Record(HouseId, ask, WhishName, "71-234-567", Today, Now));
        Assert.AreEqual((HousePlanAskRule.WhishNumberRefusal, "whishNumber"), (badNumber.PersonMessage(), badNumber.ParamName));
        Assert.ThrowsExactly<ArgumentException>(() => HousePlanTransfer.Record(OtherSpaceId, ask, WhishName, WhishNumber, Today, Now));
        Assert.ThrowsExactly<ArgumentNullException>(() => HousePlanTransfer.Record(HouseId, null!, WhishName, WhishNumber, Today, Now));
    }

    // ---------- how an ask ends ----------

    [TestMethod]
    public void N9c1ABookedAskNamesThePlanItAskedForAndThatPlansReceiptUnderOneKey()
    {
        var (product, offer) = Plan();
        var ask = HousePlanAsk.Create(HouseId, ProfileId, product, offer, TraineeUserId, Today, Now);
        var plan = ClientEnrollment.Assign(HouseId, ProfileId, product, offer, Today, Key, Now);
        var receipt = Receipt(plan.Id, Key);

        var booked = HousePlanAskOutcome.Booked(HouseId, ask, plan, receipt, StaffUserId, Today, Now);
        Assert.AreEqual(
            (HousePlanAskOutcomeKind.Booked, ask.Id, ProfileId, (Guid?)plan.Id, (Guid?)receipt.Id, (Guid?)Key, (string?)null, StaffUserId, Today, Now),
            (booked.Kind, booked.AskId, booked.ClientProfileId, booked.EnrollmentId, booked.PaymentRecordId, booked.CommandId, booked.Reason, booked.DecidedByUserId, booked.DecidedOn, booked.DecidedAtUtc));

        // Another trainee's plan, another option's plan, another plan's receipt or a receipt under another key: refused.
        var someoneElses = ClientEnrollment.Assign(HouseId, OtherProfileId, product, offer, Today, Key, Now);
        Assert.ThrowsExactly<ArgumentException>(() =>
            HousePlanAskOutcome.Booked(HouseId, ask, someoneElses, Receipt(someoneElses.Id, Key), StaffUserId, Today, Now));
        var longer = ProductOffer.CreateFixedDuration(HouseId, product.Id, "Eight weeks", 8, OfferDurationUnit.Week, 89.75m, "USD", TrainingOnly);
        var otherOption = ClientEnrollment.Assign(HouseId, ProfileId, product, longer, Today, Key, Now);
        Assert.ThrowsExactly<ArgumentException>(() =>
            HousePlanAskOutcome.Booked(HouseId, ask, otherOption, Receipt(otherOption.Id, Key), StaffUserId, Today, Now));
        var otherPlan = ClientEnrollment.Assign(HouseId, ProfileId, product, offer, Today, Key, Now);
        Assert.ThrowsExactly<ArgumentException>(() =>
            HousePlanAskOutcome.Booked(HouseId, ask, plan, Receipt(otherPlan.Id, Key), StaffUserId, Today, Now));
        Assert.ThrowsExactly<ArgumentException>(() =>
            HousePlanAskOutcome.Booked(HouseId, ask, plan, Receipt(plan.Id, OtherKey), StaffUserId, Today, Now));
        Assert.ThrowsExactly<ArgumentException>(() =>
            HousePlanAskOutcome.Booked(HouseId, ask, plan, receipt, Guid.Empty, Today, Now));
        Assert.ThrowsExactly<ArgumentException>(() =>
            HousePlanAskOutcome.Booked(OtherSpaceId, ask, plan, receipt, StaffUserId, Today, Now));
        Assert.ThrowsExactly<ArgumentNullException>(() =>
            HousePlanAskOutcome.Booked(HouseId, ask, plan, null!, StaffUserId, Today, Now));
    }

    [TestMethod]
    public void N9c1AClosedAskKeepsItsReasonAndBooksNothing()
    {
        var ask = Ask();
        var closed = HousePlanAskOutcome.Closed(HouseId, ask, "  No transfer arrived in a week.\nAsk again any time. ", StaffUserId, Today, Now);
        Assert.AreEqual(
            (HousePlanAskOutcomeKind.Closed, ask.Id, ProfileId, (Guid?)null, (Guid?)null, (Guid?)null, "No transfer arrived in a week.\nAsk again any time."),
            (closed.Kind, closed.AskId, closed.ClientProfileId, closed.EnrollmentId, closed.PaymentRecordId, closed.CommandId, closed.Reason));

        foreach (var reason in new[] { null, string.Empty, "   ", new string('r', 501) })
        {
            var refused = Assert.ThrowsExactly<ArgumentException>(() => HousePlanAskOutcome.Closed(HouseId, ask, reason!, StaffUserId, Today, Now));
            Assert.AreEqual((HousePlanAskRule.ReasonRefusal, "reason"), (refused.PersonMessage(), refused.ParamName), $"'{reason}'");
        }

        Assert.ThrowsExactly<ArgumentException>(() => HousePlanAskOutcome.Closed(HouseId, ask, "No transfer.", Guid.Empty, Today, Now));
        Assert.ThrowsExactly<ArgumentException>(() => HousePlanAskOutcome.Closed(OtherSpaceId, ask, "No transfer.", StaffUserId, Today, Now));
    }

    // ---------- the house's Whish number ----------

    [TestMethod]
    public void N9c1TheHousesWhishNumberIsKeptInTheTraineesFormAndEmptyKeepsAsksClosed()
    {
        var kept = new (string Typed, string Stored)[]
        {
            ("+961 70 123 456", "+961 70 123 456"),
            ("  +961   70 123456 ", "+961 70 123456"),
            ("+ 961 70 123", "+961 70 123"),
            ("70123456", "70123456"),
        };
        foreach (var (typed, stored) in kept)
        {
            Assert.AreEqual(HouseSettingValue.Of(stored), HouseSettingRule.Normalize(HouseSetting.WhishNumber, typed), typed);
            // The trainee's own number is kept in the same form, so the two read alike.
            Assert.AreEqual(stored, HousePlanAskRule.NormalizeWhishNumber(typed).Value, typed);
            Assert.AreEqual(stored, HouseSettingChange.Record(HouseId, HouseSetting.WhishNumber, 1, typed, StaffUserId, Now).Value, typed);
        }

        foreach (var typed in new[] { "70-123-456", "12345", "+", "123456789012345678901", "+961 70 123 456 x" })
        {
            Assert.AreEqual(
                HouseSettingValue.Refused(HouseSettingRule.WhishNumberRefusal),
                HouseSettingRule.Normalize(HouseSetting.WhishNumber, typed),
                typed);
            Assert.IsFalse(HousePlanAskRule.NormalizeWhishNumber(typed).IsValid, typed);
            var refused = Assert.ThrowsExactly<ArgumentException>(() =>
                HouseSettingChange.Record(HouseId, HouseSetting.WhishNumber, 1, typed, StaffUserId, Now));
            Assert.AreEqual((HouseSettingRule.WhishNumberRefusal, "value"), (refused.PersonMessage(), refused.ParamName));
        }

        foreach (var blank in new[] { null, string.Empty, "   " })
        {
            Assert.AreEqual(HouseSettingValue.Empty, HouseSettingRule.Normalize(HouseSetting.WhishNumber, blank), $"'{blank}'");
        }
    }

    [TestMethod]
    public void N9c1TheHousesSettingsReadTheWhishNumberAsTextBesideTheNumbers()
    {
        Assert.IsNull(HouseSettings.Empty.WhishNumber);
        var settings = HouseSettings.From(
        [
            new KeyValuePair<HouseSetting, string?>(HouseSetting.SignUpsPerWeek, "37"),
            new KeyValuePair<HouseSetting, string?>(HouseSetting.WhishNumber, "+961 70 123 456"),
        ]);
        Assert.AreEqual(new HouseSettings(37, null, null, null, "+961 70 123 456"), settings);
        Assert.IsNull(HouseSettings.From([new KeyValuePair<HouseSetting, string?>(HouseSetting.SignUpsPerWeek, "37")]).WhishNumber);
        Assert.IsNull(HouseSettings.From([new KeyValuePair<HouseSetting, string?>(HouseSetting.WhishNumber, null)]).WhishNumber);
    }

    private static (CoachingProduct Product, ProductOffer Offer) Plan(HouseTier? tier = HouseTier.ProPlus, decimal price = 47.50m)
    {
        var product = CoachingProduct.Create(HouseId, "N9c1 Programs", "A plan of the tests' own.", ProductKind.CoachingPlan, tier);
        var offer = ProductOffer.CreateFixedDuration(HouseId, product.Id, "Four weeks", 4, OfferDurationUnit.Week, price, "USD", TrainingOnly);
        return (product, offer);
    }

    private static HousePlanAsk Ask()
    {
        var (product, offer) = Plan();
        return HousePlanAsk.Create(HouseId, ProfileId, product, offer, TraineeUserId, Today, Now);
    }

    private static PaymentRecord Receipt(Guid enrollmentId, Guid key) =>
        PaymentRecord.RecordManualReceipt(
            HouseId, enrollmentId, 47.50m, "USD", Now, ManualPaymentMethod.MobileWallet, "WH-7731", null, StaffUserId, key, Now);
}
