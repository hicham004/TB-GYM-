using TB.Gym.Modules.Nutrition;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// The Foods page's rules in the domain (R4.4c): renaming a food changes the library's name only, and
/// every earlier version stays as it was saved; archiving hides a food without touching its versions;
/// and USDA's carbohydrate just below zero counts as 0 g, keeping USDA's figure.
/// </summary>
[TestClass]
public sealed class FoodEditorDomainTests
{
    private static readonly Guid TenantId = Guid.Parse("10000000-0000-0000-0000-000000000443");

    [TestMethod]
    public void ARenameTrimsTheNameKeepsEveryVersionAndRefusesAnEmptyOne()
    {
        var food = FoodItem.Create(TenantId, "Greek yoghurt", FoodProvenance.CoachAuthored);
        var first = food.AddVersion(Yogurt(10m));

        food.Rename("  Greek yogurt ");
        var second = food.AddVersion(Yogurt(11m));

        Assert.AreEqual(("Greek yogurt", "GREEK YOGURT", 2), (food.Name, food.NormalizedName, food.CurrentRevision));
        Assert.AreEqual((1, 10m, 2, 11m), (first.Revision, first.ProteinGrams, second.Revision, second.ProteinGrams));
        Assert.ThrowsExactly<ArgumentException>(() => food.Rename("   "));
        Assert.AreEqual("Greek yogurt", food.Name);
    }

    [TestMethod]
    public void ArchivingKeepsTheFirstTimeAndEveryVersionAndRestoringBringsTheFoodBack()
    {
        var food = FoodItem.Create(TenantId, "Greek yogurt", FoodProvenance.CoachAuthored);
        var version = food.AddVersion(Yogurt(10m));
        var monday = new DateTimeOffset(2026, 10, 5, 9, 0, 0, TimeSpan.Zero);

        food.Archive(monday);
        food.Archive(monday.AddDays(1));
        Assert.AreEqual(monday, food.ArchivedAtUtc);
        Assert.AreSame(version, food.Versions.Single());

        food.Restore();
        Assert.IsNull(food.ArchivedAtUtc);
        Assert.AreEqual(1, food.CurrentRevision);
    }

    // Fixed references: USDA's four raw chicken cuts with skin (FDC 2727566 to 2727569, checked
    // 2026-10-07) report -0.475, -0.173, -0.459 and -0.428 g; labels round under 0.5 g to 0 g.
    [TestMethod]
    [DataRow("12.3", "12.3")]
    [DataRow("0", "0")]
    [DataRow("-0.428", "0")]
    [DataRow("-0.475", "0")]
    [DataRow("-0.5", "0")]
    [DataRow("-0.51", null)]
    [DataRow("-3", null)]
    public void UsdaCarbohydrateJustBelowZeroCountsAsZeroAndLowerIsNotUsed(string reported, string? counted)
    {
        Assert.AreEqual(
            counted is null ? (decimal?)null : decimal.Parse(counted, System.Globalization.CultureInfo.InvariantCulture),
            ProviderCarbohydrateRule.Count(decimal.Parse(reported, System.Globalization.CultureInfo.InvariantCulture)));
        Assert.AreEqual(("UsdaNegativeByDifferenceAsZero", "v1"), (ProviderCarbohydrateRule.Key, ProviderCarbohydrateRule.Version));
    }

    [TestMethod]
    public void AVersionKeepsUsdasCarbohydrateOnlyBesideTheZeroItCountsAs()
    {
        var chicken = FoodItem.Create(TenantId, "Chicken, breast, meat and skin, raw", FoodProvenance.UsdaFdc, "2727569", "Foundation");
        var version = chicken.AddVersion(Chicken(carbohydrate: 0m, reported: -0.42825m));
        Assert.AreEqual((0m, (decimal?)-0.42825m), (version.CarbohydrateGrams, version.ReportedCarbohydrateGrams));
        // 21.40625 * 4 + 0 * 4 + 4.777 * 9: the counted zero is what the calories use.
        Assert.AreEqual(128.618m, version.ComputedCalories);

        Assert.ThrowsExactly<ArgumentException>(() => chicken.AddVersion(Chicken(carbohydrate: 0.1m, reported: -0.42825m)));
        Assert.ThrowsExactly<ArgumentException>(() => chicken.AddVersion(Chicken(carbohydrate: 0m, reported: -0.6m)));
        Assert.ThrowsExactly<ArgumentException>(() => chicken.AddVersion(Chicken(carbohydrate: 0m, reported: 0m)));

        // A coach or a label states the carbohydrate itself, so nothing is kept beside it.
        var own = FoodItem.Create(TenantId, "My chicken", FoodProvenance.CoachAuthored);
        Assert.ThrowsExactly<ArgumentException>(() => own.AddVersion(Chicken(carbohydrate: 0m, reported: -0.42825m)));
        Assert.AreEqual(1, chicken.CurrentRevision);
    }

    private static FoodVersionInput Chicken(decimal carbohydrate, decimal reported) =>
        new(100m, FoodQuantityUnit.Gram, PreparationBasis.AsSold, 21.40625m, carbohydrate, 4.777m, 0m, 0m, 0m, 126.905m,
            AtwaterEnergyPolicy.Key, 25m, "USDA FoodData Central (CC0 1.0)", "Foundation:2026-10-07T00:00:00.0000000+00:00", [],
            ReportedCarbohydrateGrams: reported);

    private static FoodVersionInput Yogurt(decimal protein) =>
        new(100m, FoodQuantityUnit.Gram, PreparationBasis.AsSold, protein, 4m, 0m, 0m, 0m, 0m, null,
            AtwaterEnergyPolicy.Key, 25m, "Coach-authored food", "coach-entry-v1", [AllergenCode.Milk]);
}
