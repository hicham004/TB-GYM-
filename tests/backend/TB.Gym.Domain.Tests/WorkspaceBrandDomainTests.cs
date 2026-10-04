using TB.Gym.Modules.Media;
using TB.Gym.Modules.Tenancy;

namespace TB.Gym.Domain.Tests;

/// <summary>
/// The coach's brand (GAM-005) and its logo (MED-013): two colours or none, in one stored shape, and
/// a logo that is only ever a small image.
/// </summary>
[TestClass]
public sealed class WorkspaceBrandDomainTests
{
    private static readonly Guid TenantId = Guid.Parse("10000000-0000-0000-0000-000000000035");
    private static readonly Guid OwnerId = Guid.Parse("20000000-0000-0000-0000-000000000035");

    [TestMethod]
    public void ABrandStoresBothColoursLowerCaseAndClearsBackToTbGym()
    {
        var workspace = Tenant.Create("Cedar Strength", "cedar-strength");
        Assert.AreEqual((null, null, null), (workspace.BrandColor, workspace.AccentColor, workspace.LogoMediaAssetId));

        var logo = Guid.Parse("30000000-0000-0000-0000-000000000035");
        workspace.SetBrand(" #15233F ", "#FFB48C", logo);
        Assert.AreEqual(("#15233f", "#ffb48c", (Guid?)logo),
            (workspace.BrandColor, workspace.AccentColor, workspace.LogoMediaAssetId));

        // Clearing both colours keeps a logo: the two are chosen separately.
        workspace.SetBrand(null, "  ", logo);
        Assert.AreEqual((null, null, (Guid?)logo), (workspace.BrandColor, workspace.AccentColor, workspace.LogoMediaAssetId));

        workspace.SetBrand(null, null, null);
        Assert.IsNull(workspace.LogoMediaAssetId);
    }

    [TestMethod]
    [DataRow("#15233f", null)]
    [DataRow(null, "#ffb48c")]
    [DataRow("navy", "#ffb48c")]
    [DataRow("#123", "#ffb48c")]
    [DataRow("#15233f80", "#ffb48c")]
    [DataRow("#15233f", "rgb(255, 180, 140)")]
    [DataRow("#15233f", "#ffb48c; color: red")]
    [DataRow("15233f", "#ffb48c")]
    public void ABrandRefusesALoneColourOrAnyOtherShape(string? brand, string? accent)
    {
        var workspace = Tenant.Create("Cedar Strength", "cedar-strength");

        Assert.ThrowsExactly<ArgumentException>(() => workspace.SetBrand(brand, accent, null));
        Assert.AreEqual((null, null), (workspace.BrandColor, workspace.AccentColor));
    }

    [TestMethod]
    public void ALogoMustNameAnAsset()
    {
        var workspace = Tenant.Create("Cedar Strength", "cedar-strength");

        Assert.ThrowsExactly<ArgumentException>(() => workspace.SetBrand("#15233f", "#ffb48c", Guid.Empty));
    }

    [TestMethod]
    public void ALogoIsOnlyEverAnImage()
    {
        Assert.ThrowsExactly<ArgumentException>(() => Register(MediaKind.Video, "clip.mp4", "video/mp4"));

        var logo = Register(MediaKind.Image, "logo.png", "image/png");
        Assert.AreEqual(MediaPurpose.WorkspaceLogo, logo.Purpose);
    }

    [TestMethod]
    public void ALogoIsFittedInsideItsSquareAndNeverUpscaled()
    {
        Assert.AreEqual((512, 256), MediaLogoPolicy.Fit(2_000, 1_000));
        Assert.AreEqual((256, 512), MediaLogoPolicy.Fit(1_000, 2_000));
        Assert.AreEqual((512, 512), MediaLogoPolicy.Fit(512, 512));
        Assert.AreEqual((120, 40), MediaLogoPolicy.Fit(120, 40));
        // An extreme banner keeps at least one pixel of height.
        Assert.AreEqual((512, 1), MediaLogoPolicy.Fit(8_000, 2));
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => MediaLogoPolicy.Fit(0, 10));
    }

    private static MediaAsset Register(MediaKind kind, string fileName, string contentType) =>
        MediaAsset.RegisterUpload(
            TenantId,
            OwnerId,
            "Logo",
            kind,
            fileName,
            contentType,
            contentType,
            1_024,
            new string('a', 64),
            new StorageObjectLocator(TenantId, MediaStorageLocations.LocalV1, $"{TenantId:N}/logo"),
            MediaPurpose.WorkspaceLogo);
}
