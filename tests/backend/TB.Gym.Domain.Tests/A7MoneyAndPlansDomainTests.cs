using TB.Gym.Modules.PlatformBilling;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.SharedKernel;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// The audit's batch A7 in the domain: money is kept to the cent and a smaller part is refused, never rounded
/// (BILL-1); two plans for sale never share a name, while two that shared one before keep it (BILL-7); a
/// receipt is dated by the workspace's day, which the server stamps (WEA-6); and a price plan always gives at
/// least one grace day (BILL-4).
/// </summary>
[TestClass]
public sealed class A7MoneyAndPlansDomainTests
{
    private static readonly Guid TenantId = Guid.Parse("10000000-0000-0000-0000-0000000000a7");
    private static readonly TimeZoneInfo Beirut = TimeZoneInfo.FindSystemTimeZoneById("Asia/Beirut");

    [TestMethod]
    public void MoneyWithAPartOfACentIsRefusedNotRounded()
    {
        foreach (var amount in new[] { 1.005m, 10.005m, 2.345m, 10.123m, 0.004m })
        {
            Assert.AreEqual(MoneyRules.TwoDecimalsMessage, MoneyRules.AmountProblem(amount, allowZero: false), $"{amount}");
            Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => MoneyRules.NormalizeAmount(amount, allowZero: true));
        }

        // Trailing zeros are not a smaller part: 1.010 is 1.01.
        Assert.IsNull(MoneyRules.AmountProblem(1.010m, allowZero: false));
        Assert.AreEqual(1.01m, MoneyRules.NormalizeAmount(1.010m, allowZero: false));
        Assert.AreEqual(130m, MoneyRules.NormalizeAmount(130m, allowZero: false));
        Assert.AreEqual(MoneyRules.RangeMessage, MoneyRules.AmountProblem(0m, allowZero: false));
        Assert.IsNull(MoneyRules.AmountProblem(0m, allowZero: true));
        Assert.AreEqual(MoneyRules.RangeMessage, MoneyRules.AmountProblem(-1m, allowZero: true));
        Assert.AreEqual(MoneyRules.RangeMessage, MoneyRules.AmountProblem(1_000_000_000m, allowZero: true));

        var product = CoachingProduct.Create(TenantId, "Online Coaching", null);
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => ProductOffer.CreateFixedDuration(
            TenantId, product.Id, "4 weeks", 4, OfferDurationUnit.Week, 10.123m, "USD",
            [new OfferFeatureDefinition(CoachingFeature.Training)]));
    }

    [TestMethod]
    public void TwoPlansForSaleNeverShareANameComparedWithoutCase()
    {
        var formCheck = CoachingProduct.Create(TenantId, "Form check (free)", null);
        var online = CoachingProduct.Create(TenantId, "Online Coaching", null);
        var stopped = CoachingProduct.Create(TenantId, "Strength Program", null);
        stopped.Update("Strength Program", null, isActive: false);
        CoachingProduct[] products = [formCheck, online, stopped];

        var refused = Assert.ThrowsExactly<ProductNameTakenException>(() =>
            CoachingProduct.EnsureNameFree(Guid.NewGuid(), "  FORM CHECK (Free) ", products));
        Assert.AreEqual("FORM CHECK (Free)", refused.Name);
        Assert.AreEqual("You already sell a plan called \"FORM CHECK (Free)\". Choose another name, or rename that plan first.", refused.Message);

        // A plan keeps its own name; a plan no longer sold holds none; another workspace's plan never counts
        // because the service passes only this workspace's plans for sale.
        CoachingProduct.EnsureNameFree(formCheck.Id, "Form check (FREE)", products);
        CoachingProduct.EnsureNameFree(Guid.NewGuid(), "strength program", products);
        CoachingProduct.EnsureNameFree(Guid.NewGuid(), "Form check", products);
        Assert.IsTrue(CoachingProduct.SameName("Élan", "élan"));
        Assert.IsFalse(CoachingProduct.SameName("Form check", "Form-check"));
    }

    [TestMethod]
    public void OnlyANewRenamedOrRestoredPlanClaimsANameSoOldDuplicatesKeepTheirs()
    {
        var plan = CoachingProduct.Create(TenantId, "Form check (free)", null);

        // Saved unchanged, or with only its description changed: nothing is claimed (existing duplicates stay).
        Assert.IsFalse(plan.ClaimsName("Form check (free)", isActive: true));
        Assert.IsFalse(plan.ClaimsName("  Form check (free)  ", isActive: true));

        // Renamed, even only in case, or stopped and sold again: the name is claimed and checked.
        Assert.IsTrue(plan.ClaimsName("Form Check (free)", isActive: true));
        Assert.IsTrue(plan.ClaimsName("Video review", isActive: true));
        Assert.IsFalse(plan.ClaimsName("Video review", isActive: false), "A plan no longer sold claims no name.");
        plan.Update("Form check (free)", null, isActive: false);
        Assert.IsTrue(plan.ClaimsName("Form check (free)", isActive: true), "Selling it again claims its name.");
    }

    // Fixed reference: Beirut is UTC+3 in October (summer time runs to 25 Oct 2026).
    [TestMethod]
    public void AReceiptIsStampedFromTheWorkspaceDayNotTheBrowsersClock()
    {
        var now = new DateTimeOffset(2026, 10, 20, 7, 30, 0, TimeSpan.Zero);
        Assert.AreEqual(new DateOnly(2026, 10, 20), PaymentDay.Of(now, Beirut));

        // Today: the moment it is recorded. An earlier day: midday there, which every zone reads as that day
        // once it reads the day back in the workspace's zone.
        Assert.AreEqual(now, PaymentDay.ReceivedAtUtc(new DateOnly(2026, 10, 20), Beirut, now));
        var sunday = PaymentDay.ReceivedAtUtc(new DateOnly(2026, 10, 18), Beirut, now);
        Assert.AreEqual(new DateTimeOffset(2026, 10, 18, 9, 0, 0, TimeSpan.Zero), sunday);
        Assert.AreEqual(new DateOnly(2026, 10, 18), PaymentDay.Of(sunday!.Value, Beirut));
        Assert.IsNull(PaymentDay.ReceivedAtUtc(new DateOnly(2026, 10, 21), Beirut, now), "Tomorrow is in the future.");

        // Just after midnight in Beirut it is already the next day there, whatever UTC says.
        var lateNight = new DateTimeOffset(2026, 10, 19, 22, 30, 0, TimeSpan.Zero);
        Assert.AreEqual(new DateOnly(2026, 10, 20), PaymentDay.Of(lateNight, Beirut));
        Assert.AreEqual(lateNight, PaymentDay.ReceivedAtUtc(new DateOnly(2026, 10, 20), Beirut, lateNight));

        // After the clocks go back, midday is UTC+2: still that day.
        var winter = PaymentDay.ReceivedAtUtc(new DateOnly(2026, 11, 2), Beirut, new DateTimeOffset(2026, 11, 5, 8, 0, 0, TimeSpan.Zero));
        Assert.AreEqual(new DateTimeOffset(2026, 11, 2, 10, 0, 0, TimeSpan.Zero), winter);
    }

    [TestMethod]
    public void APricePlanGivesAtLeastOneGraceDay()
    {
        Assert.IsTrue(new PricePlanTerms("USD", 15m, 5, 2m, 10m, 2, 30, 7, 0).Validate().ContainsKey(nameof(PricePlanTerms.GraceDays)));
        Assert.IsEmpty(new PricePlanTerms("USD", 15m, 5, 2m, 10m, 2, 30, 7, 1).Validate());
        Assert.IsTrue(new PricePlanTerms("USD", 15m, 5, 2m, 10m, 2, 30, 7, 91).Validate().ContainsKey(nameof(PricePlanTerms.GraceDays)));

        // A version published with 0 before still locks a day after the due date, as it always did.
        Assert.AreEqual(new DateOnly(2026, 10, 9), PaymentSchedule.ReadOnlyFrom(new DateOnly(2026, 10, 8), 0));
    }
}
