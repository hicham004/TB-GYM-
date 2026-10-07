using TB.Gym.Modules.Nutrition;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// The recipe editor's rules in the domain (R4.4b): a rename changes the library's name only, and
/// each version keeps the photo it was saved with (MED-014).
/// </summary>
[TestClass]
public sealed class RecipeEditorDomainTests
{
    private static readonly Guid TenantId = Guid.Parse("10000000-0000-0000-0000-000000000441");
    private static readonly Guid CoachId = Guid.Parse("20000000-0000-0000-0000-000000000441");
    private static readonly Guid PhotoId = Guid.Parse("30000000-0000-0000-0000-000000000441");

    [TestMethod]
    public void ARenameTrimsTheNameAndRefusesAnEmptyOne()
    {
        var recipe = Recipe.Create(TenantId, "Overnight oats");
        recipe.Rename("  Berry overnight oats ");
        Assert.AreEqual(("Berry overnight oats", "BERRY OVERNIGHT OATS"), (recipe.Name, recipe.NormalizedName));
        Assert.ThrowsExactly<ArgumentException>(() => recipe.Rename("   "));
        Assert.AreEqual("Berry overnight oats", recipe.Name);
    }

    [TestMethod]
    public void EachVersionKeepsItsOwnPhoto()
    {
        var recipe = Recipe.Create(TenantId, "Overnight oats");
        var first = recipe.AddDraft("Stir and chill.", 2m, [Oats(80m)], PhotoId);
        first.Publish(new DateTimeOffset(2026, 10, 7, 8, 0, 0, TimeSpan.Zero), CoachId);
        var second = recipe.AddDraft("Stir and chill.", 2m, [Oats(100m)]);

        Assert.AreEqual(((Guid?)PhotoId, (Guid?)null), (first.PhotoMediaAssetId, second.PhotoMediaAssetId));
        Assert.AreEqual((1, 2, 2), (first.Revision, second.Revision, recipe.CurrentRevision));
        Assert.ThrowsExactly<ArgumentException>(() => recipe.AddDraft("Stir.", 1m, [Oats(50m)], Guid.Empty));
        Assert.AreEqual(2, recipe.CurrentRevision, "A refused version leaves the revision where it was.");
    }

    private static RecipeIngredientInput Oats(decimal grams) =>
        new(Guid.NewGuid(), "Rolled oats", grams, FoodQuantityUnit.Gram, PreparationBasis.Prepared, 13m * grams / 100m, 60m * grams / 100m, 7m * grams / 100m, 380m * grams / 100m, "Coach-authored food", []);
}
