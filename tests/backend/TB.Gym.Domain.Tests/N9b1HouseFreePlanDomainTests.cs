using TB.Gym.Modules.Subscriptions;
using TB.Gym.SharedKernel;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// The notes plan's N9b1, Free in the house (SUB-019): the plan the server makes with the house, its one option at no
/// price covering Training beside any plan, its rows that follow one another half-open with no gap and no overlap,
/// when a row is due its renewal, the command ids that make a start and a renewal happen once, what nobody may do to
/// Free by hand, and the tier a trainee is on from the house's plans that grant today. Every figure is the tests' own.
/// </summary>
[TestClass]
public sealed class N9b1HouseFreePlanDomainTests
{
    private static readonly Guid HouseId = Guid.Parse("10000000-0000-0000-0000-0000000009b1");
    private static readonly Guid ProfileId = Guid.Parse("30000000-0000-0000-0000-0000000009b1");
    private static readonly DateOnly Today = new(2026, 11, 12);
    private static readonly DateTimeOffset Now = new(2026, 11, 12, 9, 0, 0, TimeSpan.Zero);

    [TestMethod]
    public void N9b1FreeIsAPlanOfTheHouseWithOneOptionAtNoPriceCoveringTrainingBesideAnyPlan()
    {
        var (product, offer) = HouseFree();
        Assert.AreEqual(("Free", ProductKind.CoachingPlan, (HouseTier?)HouseTier.Free, true, true),
            (product.Name, product.Kind, product.HouseTier, product.IsHouseFree, product.IsActive));
        Assert.IsNull(product.Description, "Nothing in code says what Free is to a trainee: the words are the owner's.");
        Assert.AreEqual(("Free", 365, OfferDurationUnit.Day, 0m, "USD", (int?)null),
            (offer.Label, offer.DurationCount, offer.DurationUnit, offer.PriceAmount, offer.PriceCurrency, offer.SessionCount));
        var feature = offer.Entitlements.Single();
        Assert.AreEqual((CoachingFeature.Training, true), (feature.Feature, feature.AllowsConcurrentCoverage));

        // Booked, it is active at once, its own coverage never blocks another plan's, and it carries the tier.
        var row = ClientEnrollment.Assign(HouseId, ProfileId, product, offer, Today, HouseFreePlanRule.StartCommandId(ProfileId), Now);
        Assert.AreEqual((EnrollmentStatus.Active, (HouseTier?)HouseTier.Free, true, Now),
            (row.Status, row.HouseTier, row.IsHouseFree, row.ActivatedAtUtc));
        Assert.AreEqual((Today, new DateOnly(2027, 11, 12)), (row.StartDate, row.EndDateExclusive));
        Assert.IsFalse(row.Entitlements.Single().BlocksOverlap, "The GiST exclusion never weighs Free (SUB-004).");
    }

    [TestMethod]
    public void N9b1FreesRowsFollowOneAnotherHalfOpenWithNoGapAndNoOverlap()
    {
        var (product, offer) = HouseFree();
        var first = ClientEnrollment.Assign(HouseId, ProfileId, product, offer, Today, HouseFreePlanRule.StartCommandId(ProfileId), Now);
        var rows = new List<ClientEnrollment> { first };
        for (var renewal = 0; renewal < 3; renewal++)
        {
            var previous = rows[^1];
            rows.Add(ClientEnrollment.Assign(
                HouseId,
                ProfileId,
                product,
                offer,
                HouseFreePlanRule.RenewalStart(previous.EndDateExclusive),
                HouseFreePlanRule.RenewalCommandId(previous.Id),
                Now,
                previous.Id));
        }

        // Each row starts on the day the one before ends: its last covered day is the day before, so no day is
        // covered twice and none is missed, and each names the row it renews.
        for (var index = 1; index < rows.Count; index++)
        {
            Assert.AreEqual(rows[index - 1].EndDateExclusive, rows[index].StartDate);
            Assert.AreEqual(rows[index].StartDate.AddDays(-1), rows[index - 1].Period.LastActiveDate);
            Assert.IsFalse(rows[index - 1].Period.Overlaps(rows[index].Period));
            Assert.AreEqual(rows[index - 1].Id, rows[index].RenewedFromEnrollmentId);
            Assert.AreEqual(365, rows[index].EndDateExclusive.DayNumber - rows[index].StartDate.DayNumber);
        }

        // 29 February 2028 falls inside the second row: a year of days, not a calendar year, so the rows drift a day.
        CollectionAssert.AreEqual(
            new[] { new DateOnly(2026, 11, 12), new DateOnly(2027, 11, 12), new DateOnly(2028, 11, 11), new DateOnly(2029, 11, 11) },
            rows.Select(item => item.StartDate).ToArray());
    }

    [TestMethod]
    public void N9b1ARowIsDueItsRenewalFromThirtyDaysBeforeItsEnd()
    {
        var end = new DateOnly(2027, 11, 12);
        Assert.IsFalse(HouseFreePlanRule.IsDueForRenewal(end, new DateOnly(2027, 10, 12)), "31 days before its end.");
        Assert.IsTrue(HouseFreePlanRule.IsDueForRenewal(end, new DateOnly(2027, 10, 13)), "30 days before its end.");
        Assert.IsTrue(HouseFreePlanRule.IsDueForRenewal(end, new DateOnly(2027, 11, 11)), "Its last covered day.");
        Assert.IsTrue(HouseFreePlanRule.IsDueForRenewal(end, new DateOnly(2028, 3, 1)), "A Worker down for months still renews.");

        // The day the sweep reads its rows by: every row ending on or before it, one already ended included.
        Assert.AreEqual(new DateOnly(2027, 12, 12), HouseFreePlanRule.DueBy(new DateOnly(2027, 11, 12)));
        Assert.AreEqual(new DateOnly(2028, 3, 30), HouseFreePlanRule.DueBy(new DateOnly(2028, 2, 29)), "Across a leap day.");
        Assert.IsGreaterThan(
            RenewalEligibility.EndingSoonDays,
            HouseFreePlanRule.RenewWithinDays,
            "Free is renewed well before a plan's ending-soon day, so no ask to renew is ever about it.");
    }

    [TestMethod]
    public void N9b1AStartAndARenewalHaveCommandIdsOfTheirOwnThatNeverChangeAndNeverMeetAScreens()
    {
        var other = Guid.Parse("30000000-0000-0000-0000-0000000009b2");
        var start = HouseFreePlanRule.StartCommandId(ProfileId);
        Assert.AreEqual(start, HouseFreePlanRule.StartCommandId(ProfileId), "The same profile, the same id: a second start finds the first.");
        Assert.AreNotEqual(start, HouseFreePlanRule.StartCommandId(other));
        Assert.AreNotEqual(start, HouseFreePlanRule.RenewalCommandId(ProfileId), "A start and a renewal of the same id differ.");
        Assert.AreEqual(HouseFreePlanRule.RenewalCommandId(other), HouseFreePlanRule.RenewalCommandId(other));

        // Version 8 (RFC 9562), never the version 4 ids the screens send.
        foreach (var id in new[] { start, HouseFreePlanRule.RenewalCommandId(other) })
        {
            Assert.AreEqual(8, id.Version);
            Assert.AreEqual(0b10, id.Variant >> 2);
        }

        // Reference values: the rows already stored carry these ids, so a change to how they are made (the name, its
        // format, the bytes kept) would leave a second start or renewal unable to find the first. Worked out once.
        Assert.AreEqual(Guid.Parse("5ef38772-c0ec-8e79-97b7-8c005d073d09"), start);
        Assert.AreEqual(Guid.Parse("138dca69-1512-87ba-8ae7-8e87940afd35"), HouseFreePlanRule.RenewalCommandId(other));
    }

    [TestMethod]
    public void N9b1NobodyMakesFreeEditsItOrEndsItByHandAndOnlyACoachingPlanCarriesATier()
    {
        Assert.ThrowsExactly<HouseFreePlanException>(() =>
            CoachingProduct.Create(HouseId, "Free", null, ProductKind.CoachingPlan, HouseTier.Free));
        Assert.ThrowsExactly<ArgumentException>(() =>
            CoachingProduct.Create(HouseId, "Ten sessions", null, ProductKind.SessionPack, HouseTier.ProPlus));
        Assert.ThrowsExactly<ArgumentException>(() =>
            CoachingProduct.Create(HouseId, "Odd", null, ProductKind.CoachingPlan, (HouseTier)99));
        var proPlus = CoachingProduct.Create(HouseId, "Pro+", null, ProductKind.CoachingPlan, HouseTier.ProPlus);
        Assert.AreEqual(((HouseTier?)HouseTier.ProPlus, false), (proPlus.HouseTier, proPlus.IsHouseFree));
        proPlus.Update("Pro+ monthly", "Programs", isActive: true);
        Assert.AreEqual((HouseTier?)HouseTier.ProPlus, proPlus.HouseTier, "Renaming a plan leaves its tier.");
        Assert.IsNull(CoachingProduct.Create(HouseId, "Coaching", null).HouseTier);

        var (product, offer) = HouseFree();
        var problem = Assert.ThrowsExactly<HouseFreePlanException>(() => product.Update("Starter", null, isActive: false));
        Assert.Contains("starts and renews by itself", problem.Message);

        var row = ClientEnrollment.Assign(HouseId, ProfileId, product, offer, Today, Guid.NewGuid(), Now);
        Assert.ThrowsExactly<HouseFreePlanException>(() => row.Pause(Now, "Holiday"));
        Assert.ThrowsExactly<HouseFreePlanException>(() => row.Resume(Now));
        Assert.ThrowsExactly<HouseFreePlanException>(() => row.Cancel(Now, "No longer wanted"));
        Assert.AreEqual(EnrollmentStatus.Active, row.Status);

        // Only the end of the relationship ends it (ADR 0027): leaving, or being released.
        row.Cancel(Now, "The client left.", relationshipEnded: true);
        Assert.AreEqual(EnrollmentStatus.Cancelled, row.Status);
        Assert.IsFalse(row.Entitlements.Single().BlocksOverlap);
    }

    [TestMethod]
    public void N9b1ATraineeIsOnTheHighestTierOfTheHousesPlansThatGrantToday()
    {
        var free = Candidate(HouseTier.Free, -40, 325, EnrollmentStatus.Active, 0m, 0m);
        Assert.IsNull(HouseTierRule.TierOn([], Today, relationshipBlocked: false), "No plan of the house: no tier.");
        Assert.AreEqual(HouseTier.Free, HouseTierRule.TierOn([free], Today, relationshipBlocked: false));

        // A paid plan grants a tier only active, covering today and paid in full; else the trainee reads Free.
        Assert.AreEqual(HouseTier.ProPlus, HouseTierRule.TierOn(
            [free, Candidate(HouseTier.ProPlus, -3, 27, EnrollmentStatus.Active, 30m, 30m)], Today, relationshipBlocked: false));
        Assert.AreEqual(HouseTier.Free, HouseTierRule.TierOn(
            [free, Candidate(HouseTier.ProPlus, 0, 30, EnrollmentStatus.PendingPayment, 30m, 0m)], Today, relationshipBlocked: false),
            "Waiting for its money.");
        Assert.AreEqual(HouseTier.Free, HouseTierRule.TierOn(
            [free, Candidate(HouseTier.ProPlus, 0, 30, EnrollmentStatus.Active, 30m, 29.99m)], Today, relationshipBlocked: false),
            "A part grants nothing (SUB-008).");
        Assert.AreEqual(HouseTier.Free, HouseTierRule.TierOn(
            [free, Candidate(HouseTier.Max, -3, 27, EnrollmentStatus.Paused, 90m, 90m)], Today, relationshipBlocked: false),
            "Paused.");
        Assert.AreEqual(HouseTier.Free, HouseTierRule.TierOn(
            [free, Candidate(HouseTier.Max, -3, 27, EnrollmentStatus.Cancelled, 90m, 90m)], Today, relationshipBlocked: false),
            "Cancelled.");
        Assert.AreEqual(HouseTier.Free, HouseTierRule.TierOn(
            [free, Candidate(HouseTier.ProPlus, 1, 31, EnrollmentStatus.Active, 30m, 30m)], Today, relationshipBlocked: false),
            "Starting tomorrow.");
        Assert.AreEqual(HouseTier.Free, HouseTierRule.TierOn(
            [free, Candidate(HouseTier.ProPlus, -30, 0, EnrollmentStatus.Active, 30m, 30m)], Today, relationshipBlocked: false),
            "Ended yesterday: its exclusive end is today.");
        Assert.AreEqual(HouseTier.ProPlus, HouseTierRule.TierOn(
            [free, Candidate(HouseTier.ProPlus, 0, 1, EnrollmentStatus.Active, 30m, 30m)], Today, relationshipBlocked: false),
            "Its first and last day.");

        // Max over Pro+ over Free, whatever their order; a block grants none at all, Free included.
        Assert.AreEqual(HouseTier.Max, HouseTierRule.TierOn(
            [Candidate(HouseTier.Max, -1, 29, EnrollmentStatus.Active, 90m, 90m), free, Candidate(HouseTier.ProPlus, -3, 27, EnrollmentStatus.Active, 30m, 30m)],
            Today,
            relationshipBlocked: false));
        Assert.IsNull(HouseTierRule.TierOn([free], Today, relationshipBlocked: true));
        Assert.IsNull(HouseTierRule.TierOn(
            [Candidate(HouseTier.Free, -400, -35, EnrollmentStatus.Active, 0m, 0m)], Today, relationshipBlocked: false),
            "A Free row that ran out, never renewed, grants nothing.");
    }

    private static (CoachingProduct Product, ProductOffer Offer) HouseFree()
    {
        var product = CoachingProduct.CreateHouseFree(HouseId);
        return (product, ProductOffer.CreateHouseFree(HouseId, product.Id, "usd"));
    }

    private static HouseTierCandidate Candidate(
        HouseTier tier,
        int startsInDays,
        int endsInDaysExclusive,
        EnrollmentStatus status,
        decimal price,
        decimal paid) =>
        new(tier, Today.AddDays(startsInDays), Today.AddDays(endsInDaysExclusive), status, price, paid);
}
