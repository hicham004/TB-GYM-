using TB.Gym.Modules.Notifications;
using TB.Gym.Modules.Nutrition;
using TB.Gym.Modules.Subscriptions;
using TB.Gym.Modules.Tenancy;
using TB.Gym.SharedKernel;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// Audit A16b, the owner's extras: a raw-to-cooked conversion's two factors in a coach's words (INV-6), a plan
/// sold in days (INV-7), and the workspace's language, English or Arabic, with every notice still said in
/// English until Arabic is written (INV-8).
/// </summary>
[TestClass]
public sealed class A16bOwnerExtrasDomainTests
{
    private static readonly Guid TenantId = Guid.NewGuid();

    [TestMethod]
    public void AConversionNamesWhatItIsForAndWhereItsNumbersComeFrom()
    {
        var yield = CookingFactorRecord.CreateYield(TenantId, Factor("  White rice, boiled ", " USDA cooking yields, 2014 ", 2.9m));
        var retention = CookingFactorRecord.CreateRetention(TenantId, Factor("White rice, boiled", "USDA cooking yields, 2014", 1m));

        Assert.AreEqual(("White rice, boiled", "USDA cooking yields, 2014", "Yield", 2.9m), (yield.SourceKey, yield.SourceVersion, yield.Kind, yield.Factor));
        Assert.AreEqual(("Retention", 1m), (retention.Kind, retention.Factor));
        // Rice and burghul near 3x fit, as does the 5x ceiling; a share kept is all of it at most.
        Assert.AreEqual(5m, CookingFactorRecord.CreateYield(TenantId, Factor("Burghul", "Weighed", 5m)).Factor);
        Assert.AreEqual(0.000001m, CookingFactorRecord.CreateRetention(TenantId, Factor("Fat drained", "Weighed", 0.000001m)).Factor);
    }

    [TestMethod]
    public void AConversionOutsideItsBoundsIsRefusedNamingTheFieldAtFault()
    {
        foreach (var (factor, field) in new[]
        {
            (Yield(0m), "yieldFactor"),
            (Yield(-1m), "yieldFactor"),
            (Yield(5.000001m), "yieldFactor"),
            // The column keeps six decimals: a seventh is refused, never rounded.
            (Yield(2.9000001m), "yieldFactor"),
            (Retention(0m), "retentionFactor"),
            (Retention(1.01m), "retentionFactor"),
            (Retention(0.9999999m), "retentionFactor"),
        })
        {
            var refused = Assert.ThrowsExactly<ArgumentException>(factor, field);
            Assert.AreEqual(field, refused.ParamName);
        }

        var tooLongName = Assert.ThrowsExactly<ArgumentException>(() =>
            CookingFactorRecord.CreateYield(TenantId, Factor(new string('r', CookingFactorRecord.MaximumSourceKeyLength + 1), "USDA", 3m)));
        Assert.AreEqual(("sourceKey", "Say what the conversion is for, in up to 200 characters."), (tooLongName.ParamName, tooLongName.PersonMessage()));
        Assert.AreEqual("sourceKey", Assert.ThrowsExactly<ArgumentException>(() =>
            CookingFactorRecord.CreateYield(TenantId, Factor("   ", "USDA", 3m))).ParamName);
        var noSource = Assert.ThrowsExactly<ArgumentException>(() =>
            CookingFactorRecord.CreateYield(TenantId, Factor("White rice", " ", 3m)));
        Assert.AreEqual(("sourceVersion", "Say where its numbers come from, in up to 100 characters."), (noSource.ParamName, noSource.PersonMessage()));
        Assert.AreEqual("sourceVersion", Assert.ThrowsExactly<ArgumentException>(() =>
            CookingFactorRecord.CreateYield(TenantId, Factor("White rice", new string('u', CookingFactorRecord.MaximumSourceVersionLength + 1), 3m))).ParamName);
        Assert.AreEqual(
            "The cooked weight must be above 0 and at most 5 times the raw weight, to six decimals.",
            Assert.ThrowsExactly<ArgumentException>(Yield(6m)).PersonMessage());
    }

    [TestMethod]
    public void AFoodWeighedCookedCountsTheRawShareItCameFrom()
    {
        // 100 g of raw rice holds 7 g protein, 80 g carbs and 0.6 g fat; it cooks to 250 g and keeps 90%.
        var raw = new NutrientQuantity(100m, PreparationBasis.Raw, new EnergyNutrients(7m, 80m, 0.6m));
        var yield = new CookingFactor("White rice, boiled", "Weighed", PreparationBasis.Raw, PreparationBasis.Cooked, 2.5m);
        var retention = new CookingFactor("White rice, boiled", "Weighed", PreparationBasis.Raw, PreparationBasis.Cooked, 0.9m);

        var cooked = PreparationBasisCalculator.Resolve(raw, 150m, PreparationBasis.Cooked, yield, retention);

        // 150 g cooked is 60 g raw, and 90% of what that held: the arithmetic the recipe editor shows live.
        Assert.AreEqual(150m, cooked.WeightGrams);
        Assert.AreEqual(7m * 0.6m * 0.9m, cooked.Nutrients.ProteinGrams);
        Assert.AreEqual(80m * 0.6m * 0.9m, cooked.Nutrients.CarbohydrateGrams);
        Assert.AreEqual(0.6m * 0.6m * 0.9m, cooked.Nutrients.FatGrams);
    }

    [TestMethod]
    public void APlanSoldInDaysEndsAfterThatManyDaysAndIsItsOwnPriceOption()
    {
        var product = CoachingProduct.Create(TenantId, "Monthly coaching", null);
        var month = ProductOffer.CreateFixedDuration(TenantId, product.Id, "30 days", 30, OfferDurationUnit.Day, 90m, "USD", Training());
        var start = new DateOnly(2026, 10, 22);

        Assert.AreEqual(new SubscriptionPeriod(start, new DateOnly(2026, 11, 21)), month.GetPeriod(start));

        // ADR 0034 keys an option by its exact count and unit: 28 days is not 4 weeks, so both may be sold,
        // while a second 30 days in the same currency is refused.
        var fourWeeks = ProductOffer.CreateFixedDuration(TenantId, product.Id, "4 weeks", 4, OfferDurationUnit.Week, 100m, "USD", Training());
        var twentyEight = ProductOffer.CreateFixedDuration(TenantId, product.Id, "28 days", 28, OfferDurationUnit.Day, 95m, "USD", Training());
        twentyEight.EnsureActiveSlotAvailable([fourWeeks, month]);
        Assert.AreEqual(fourWeeks.GetPeriod(start), twentyEight.GetPeriod(start));
        var again = ProductOffer.CreateFixedDuration(TenantId, product.Id, "Another month", 30, OfferDurationUnit.Day, 80m, "USD", Training());
        Assert.ThrowsExactly<ActiveOfferSlotConflictException>(() => again.EnsureActiveSlotAvailable([month]));
    }

    [TestMethod]
    public void AWorkspaceSpeaksEnglishOrArabicAndNothingElse()
    {
        Assert.AreEqual("en-LB", WorkspaceSettings.Validate("Asia/Beirut", "en-LB", "USD", DayOfWeek.Monday).DefaultCulture);
        Assert.AreEqual("ar-LB", WorkspaceSettings.Validate("Asia/Beirut", " ar-lb ", "USD", DayOfWeek.Monday).DefaultCulture);
        Assert.AreEqual("en-LB ar-LB", string.Join(' ', WorkspaceLanguages.Supported));

        foreach (var culture in new[] { "fr-FR", "en-US", "ar", "not a language" })
        {
            var refused = Assert.ThrowsExactly<ArgumentException>(
                () => WorkspaceSettings.Validate("Asia/Beirut", culture, "USD", DayOfWeek.Monday),
                culture);
            Assert.AreEqual(("defaultCulture", "Choose English or Arabic as the coaching space's language."), (refused.ParamName, refused.PersonMessage()));
        }

        var workspace = Tenant.Create("Cedar Strength", "cedar-strength", defaultCulture: "ar-LB");
        Assert.AreEqual("ar-LB", workspace.DefaultCulture);
        workspace.UpdateSettings("Cedar Strength", "Asia/Beirut", "en-LB", "USD", DayOfWeek.Monday);
        Assert.AreEqual("en-LB", workspace.DefaultCulture);
    }

    [TestMethod]
    public void AnArabicWorkspaceHearsEveryNoticeInEnglishUntilArabicIsWritten()
    {
        foreach (var kind in Enum.GetValues<CommercialNotificationKind>())
        {
            Assert.IsTrue(NotificationTemplateCatalog.TryResolve(kind, "en-LB", out var english), kind.ToString());
            foreach (var culture in new[] { "ar-LB", "ar", string.Empty })
            {
                // Refusing it dead-lettered every notice of an Arabic space (audit INV-8); the notice keeps
                // the culture of the words it carries, so it never claims to be Arabic.
                Assert.IsTrue(NotificationTemplateCatalog.TryResolve(kind, culture, out var said), $"{kind} in '{culture}'");
                Assert.AreSame(english, said, $"{kind} in '{culture}'");
                Assert.AreEqual("en", said.Culture);
            }
        }
    }

    private static CookingFactor Factor(string sourceKey, string sourceVersion, decimal factor) =>
        new(sourceKey, sourceVersion, PreparationBasis.Raw, PreparationBasis.Cooked, factor);

    private static Action Yield(decimal factor) =>
        () => CookingFactorRecord.CreateYield(TenantId, Factor("White rice, boiled", "Weighed", factor));

    private static Action Retention(decimal factor) =>
        () => CookingFactorRecord.CreateRetention(TenantId, Factor("White rice, boiled", "Weighed", factor));

    private static OfferFeatureDefinition[] Training() => [new(CoachingFeature.Training, false)];
}
