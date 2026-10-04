using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Npgsql;
using SkiaSharp;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// R3.5a: the coach's brand (GAM-005) and logo (MED-013). The owner sets both; every member reads the
/// brand with their list of workspaces and the current logo through its own grant; no one else
/// changes it, no other workspace's upload can become it, and saving retires every other logo. Also
/// the library delete, which never reaches a logo or a client's progress photo.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task R35aTheOwnerSetsTheBrandAndEveryMemberReadsItAndTheLogo()
    {
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "r35a-brand-owner@example.test", "Hicham Haddad", "Cedar Strength");
        using var coach = CreateClient();
        await JoinAsCoachAsync(owner, coach, "r35a-brand-coach@example.test", "Rami Coach");
        using var maya = CreateClient();
        await R31InviteAsync(owner, maya, tenant, "r35a-brand-maya@example.test", "Maya", "Rahman");

        // Until the owner picks one, every member's workspace carries no brand: TB Gym's colours.
        var before = (await R35aMembershipsAsync(maya)).Single();
        Assert.AreEqual((tenant, (string?)null, (string?)null, (Guid?)null),
            (before.TenantId, before.BrandColor, before.AccentColor, before.LogoAssetId));

        // A wide transparent PNG is kept as a PNG, fitted inside 512 px, its transparency intact.
        var logo = await R35aUploadLogoAsync(owner, 1_200, 600);
        using (var stored = SKBitmap.Decode(await R35aReadLogoAsync(owner, logo)))
        {
            Assert.AreEqual((512, 256), (stored.Width, stored.Height));
            Assert.AreEqual(0, stored.GetPixel(0, 0).Alpha, "The corner stays transparent.");
            Assert.AreEqual(255, stored.GetPixel(256, 128).Alpha);
        }

        // Before it is saved only the owner, previewing it, may read it.
        await AssertPhotoReadableAsync(coach, logo, false);
        await AssertPhotoReadableAsync(maya, logo, false);

        var version = (await R35aWorkspaceAsync(owner)).Version;
        var saved = await R35aPutBrandAsync(owner, " #15233F", "#FFB48C ", logo, version);
        await AssertStatusAsync(saved, HttpStatusCode.OK);
        Assert.AreEqual(("#15233f", "#ffb48c", (Guid?)logo), R35aBrandOf(await RequiredJsonAsync<R35aWorkspace>(saved)));

        // Every member reads it: with their workspaces, with the workspace, and the logo itself.
        var mayaSees = (await R35aMembershipsAsync(maya)).Single();
        Assert.AreEqual(("#15233f", "#ffb48c", (Guid?)logo), (mayaSees.BrandColor, mayaSees.AccentColor, mayaSees.LogoAssetId));
        Assert.AreEqual(("#15233f", "#ffb48c", (Guid?)logo), R35aBrandOf(await R35aWorkspaceAsync(coach)));
        await AssertPhotoReadableAsync(coach, logo, true);
        await AssertPhotoReadableAsync(maya, logo, true);

        // The logo is not library media: it never joins an exercise and the library delete cannot reach it.
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(await owner.PostAsJsonAsync("/api/exercises/", new
        {
            name = "Logo squat",
            instructions = "Use controlled technique.",
            equipment = "Barbell",
            movementPattern = "Squat",
            classification = "Strength",
            muscles = new[] { new { muscle = "Quadriceps", role = "Primary" } },
            tags = ExerciseTags,
            alternatives = Array.Empty<object>(),
            mediaAssetIds = new[] { logo },
        }), HttpStatusCode.BadRequest);
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.SendAsync(new HttpRequestMessage(HttpMethod.Delete, $"/api/media/{logo}")
            {
                Content = JsonContent.Create(new { Version = 0u }),
            }),
            HttpStatusCode.NotFound);
        Assert.IsEmpty((await owner.GetFromJsonAsync<R35aMediaPage>("/api/media?skip=0&take=50"))!.Items);
        await AssertPhotoReadableAsync(maya, logo, true);
    }

    [TestMethod]
    public async Task R35aOnlyTheOwnerChangesTheBrandAndOnlyWithThisWorkspacesOwnLogo()
    {
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "r35a-guard-owner@example.test", "Hicham Haddad", "Ember Athletics");
        using var coach = CreateClient();
        await JoinAsCoachAsync(owner, coach, "r35a-guard-coach@example.test", "Rami Coach");
        using var maya = CreateClient();
        await R31InviteAsync(owner, maya, tenant, "r35a-guard-maya@example.test", "Maya", "Rahman");
        using var otherOwner = CreateClient();
        await RegisterCoachAsync(otherOwner, "r35a-guard-other@example.test", "Lina Other", "Orchid Studio");

        var version = (await R35aWorkspaceAsync(owner)).Version;

        // A coach and a client can neither upload a logo nor change the brand.
        foreach (var member in new[] { coach, maya })
        {
            await AssertStatusAsync(await R35aPostLogoAsync(member, R35aLogoPng(64, 64)), HttpStatusCode.Forbidden);
            await AssertStatusAsync(await R35aPutBrandAsync(member, "#221b18", "#ff8a4c", null, version), HttpStatusCode.Forbidden);
        }

        // Only an image, within the logo's own size.
        var clip = new byte[64];
        "ftypisom"u8.CopyTo(clip.AsSpan(4));
        await AssertStatusAsync(await R35aPostLogoAsync(owner, clip, "video/mp4", "logo.mp4"), HttpStatusCode.BadRequest);
        var huge = new byte[(5 * 1024 * 1024) + 1];
        R35aLogoPng(8, 8).CopyTo(huge, 0);
        await AssertStatusAsync(await R35aPostLogoAsync(owner, huge), HttpStatusCode.BadRequest);

        // Another workspace's logo, an exercise video and an unknown id are all refused as the logo.
        var foreignLogo = await R35aUploadLogoAsync(otherOwner, 64, 64);
        var exerciseMedia = await UploadJpegAsync(owner);
        foreach (var notALogo in new[] { foreignLogo, exerciseMedia.Id, Guid.NewGuid() })
        {
            await AssertStatusAsync(await R35aPutBrandAsync(owner, null, null, notALogo, version), HttpStatusCode.BadRequest);
        }

        // Both colours or neither, each a six-digit hex colour.
        await AssertStatusAsync(await R35aPutBrandAsync(owner, "#221b18", null, null, version), HttpStatusCode.BadRequest);
        await AssertStatusAsync(await R35aPutBrandAsync(owner, "navy", "#ff8a4c", null, version), HttpStatusCode.BadRequest);
        await AssertStatusAsync(await R35aPutBrandAsync(owner, "#221b18", "#ff8a4c80", null, version), HttpStatusCode.BadRequest);

        // A stale screen gets a conflict instead of overwriting a newer brand.
        await AssertStatusAsync(await R35aPutBrandAsync(owner, "#221b18", "#ff8a4c", null, version), HttpStatusCode.OK);
        await AssertStatusAsync(await R35aPutBrandAsync(owner, "#36203a", "#f3b4d1", null, version), HttpStatusCode.Conflict);
        Assert.AreEqual(("#221b18", "#ff8a4c", (Guid?)null), R35aBrandOf(await R35aWorkspaceAsync(owner)));

        // Another workspace's owner never reads this workspace's logo, saved or not.
        var logo = await R35aUploadLogoAsync(owner, 64, 64);
        await AssertPhotoReadableAsync(otherOwner, logo, false);
        await AssertStatusAsync(
            await R35aPutBrandAsync(owner, "#221b18", "#ff8a4c", logo, (await R35aWorkspaceAsync(owner)).Version),
            HttpStatusCode.OK);
        await AssertPhotoReadableAsync(otherOwner, logo, false);
        Assert.AreEqual(((string?)null, (Guid?)null),
            ((await R35aMembershipsAsync(otherOwner)).Single().BrandColor, (await R35aMembershipsAsync(otherOwner)).Single().LogoAssetId));
    }

    [TestMethod]
    public async Task R35aSavingABrandRetiresEveryOtherLogoAndClearingItReturnsToTbGym()
    {
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "r35a-retire-owner@example.test", "Hicham Haddad", "Atlas Performance");
        using var maya = CreateClient();
        await R31InviteAsync(owner, maya, tenant, "r35a-retire-maya@example.test", "Maya", "Rahman");

        var first = await R35aUploadLogoAsync(owner, 300, 300);
        await AssertStatusAsync(
            await R35aPutBrandAsync(owner, "#153d33", "#d9ed94", first, (await R35aWorkspaceAsync(owner)).Version),
            HttpStatusCode.OK);

        // Two previews, one saved: the first logo and the abandoned preview go on the deletion
        // retention, and the client can no longer read the replaced one.
        var abandoned = await R35aUploadLogoAsync(owner, 200, 200);
        var second = await R35aUploadLogoAsync(owner, 400, 200);
        await AssertStatusAsync(
            await R35aPutBrandAsync(owner, "#153d33", "#d9ed94", second, (await R35aWorkspaceAsync(owner)).Version),
            HttpStatusCode.OK);
        Assert.AreEqual(("Tombstoned", "Tombstoned", "Ready"),
            (await R35aAssetStatusAsync(first), await R35aAssetStatusAsync(abandoned), await R35aAssetStatusAsync(second)));
        await AssertPhotoReadableAsync(maya, first, false);
        await AssertPhotoReadableAsync(maya, second, true);

        // Clearing everything returns the workspace to TB Gym's look and retires the last logo too.
        await AssertStatusAsync(
            await R35aPutBrandAsync(owner, null, null, null, (await R35aWorkspaceAsync(owner)).Version),
            HttpStatusCode.OK);
        var cleared = (await R35aMembershipsAsync(maya)).Single();
        Assert.AreEqual(((string?)null, (string?)null, (Guid?)null), (cleared.BrandColor, cleared.AccentColor, cleared.LogoAssetId));
        Assert.AreEqual("Tombstoned", await R35aAssetStatusAsync(second));
        await AssertPhotoReadableAsync(maya, second, false);
    }

    [TestMethod]
    public async Task R35aTheDatabaseKeepsTheBrandInOneShapeAndTheLogoInItsOwnWorkspace()
    {
        using var owner = CreateClient();
        var tenant = await RegisterCoachAsync(owner, "r35a-db-owner@example.test", "Hicham Haddad", "Cedar Database");
        using var otherOwner = CreateClient();
        await RegisterCoachAsync(otherOwner, "r35a-db-other@example.test", "Lina Other", "Orchid Database");
        var foreignLogo = await R35aUploadLogoAsync(otherOwner, 64, 64);

        const string CheckViolation = "23514";
        const string ForeignKeyViolation = "23503";
        Assert.AreEqual(CheckViolation, await R35aRejectedSqlStateAsync(
            "UPDATE tenancy.\"Tenants\" SET \"BrandColor\" = 'red', \"AccentColor\" = '#ffb48c' WHERE \"Id\" = @id",
            tenant, null));
        Assert.AreEqual(CheckViolation, await R35aRejectedSqlStateAsync(
            "UPDATE tenancy.\"Tenants\" SET \"BrandColor\" = '#15233f' WHERE \"Id\" = @id",
            tenant, null));
        Assert.AreEqual(CheckViolation, await R35aRejectedSqlStateAsync(
            "UPDATE tenancy.\"Tenants\" SET \"BrandColor\" = '#15233F', \"AccentColor\" = '#ffb48c' WHERE \"Id\" = @id",
            tenant, null));
        Assert.AreEqual(ForeignKeyViolation, await R35aRejectedSqlStateAsync(
            "UPDATE tenancy.\"Tenants\" SET \"LogoMediaAssetId\" = @asset WHERE \"Id\" = @id",
            tenant, foreignLogo));
    }

    [TestMethod]
    public async Task R35aTheLibraryDeleteNeverRemovesAClientsProgressPhoto()
    {
        using var coach = CreateClient();
        var tenant = await RegisterCoachAsync(coach, "r35a-photo-coach@example.test", "Hicham Haddad", "R35a Photos");
        using var maya = CreateClient();
        await R31InviteAsync(coach, maya, tenant, "r35a-photo-maya@example.test", "Maya", "Rahman");
        var photo = await UploadProgressPhotoAsync(
            maya,
            $"/api/progress/me/photos?pose=Front&photoDate={TenantToday():yyyy-MM-dd}");

        // A photo leaves only through its own audited removal (PRG-007); the coach's library delete
        // answers as for an unknown asset and the client keeps it.
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.SendAsync(new HttpRequestMessage(HttpMethod.Delete, $"/api/media/{photo.MediaAssetId}")
            {
                Content = JsonContent.Create(new { Version = 0u }),
            }),
            HttpStatusCode.NotFound);
        Assert.AreEqual("Ready", await R35aAssetStatusAsync(photo.MediaAssetId));
        await AssertPhotoReadableAsync(maya, photo.MediaAssetId, true);
    }

    private static byte[] R35aLogoPng(int width, int height)
    {
        using var bitmap = new SKBitmap(width, height, SKColorType.Rgba8888, SKAlphaType.Premul);
        using (var canvas = new SKCanvas(bitmap))
        {
            canvas.Clear(SKColors.Transparent);
            using var paint = new SKPaint { Color = new SKColor(0xff, 0xb4, 0x8c) };
            canvas.DrawCircle(width / 2f, height / 2f, Math.Min(width, height) / 3f, paint);
            canvas.Flush();
        }

        using var image = SKImage.FromBitmap(bitmap);
        using var encoded = image.Encode(SKEncodedImageFormat.Png, 100)
            ?? throw new AssertFailedException("The test logo could not be encoded.");
        return encoded.ToArray();
    }

    private static async Task<HttpResponseMessage> R35aPostLogoAsync(
        HttpClient caller,
        byte[] bytes,
        string contentType = "image/png",
        string fileName = "logo.png")
    {
        await RefreshCsrfAsync(caller);
        using var form = new MultipartFormDataContent();
        var file = new ByteArrayContent(bytes);
        file.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        form.Add(file, "file", fileName);
        return await caller.PostAsync("/api/media/workspace-logo", form);
    }

    private static async Task<Guid> R35aUploadLogoAsync(HttpClient owner, int width, int height)
    {
        var response = await R35aPostLogoAsync(owner, R35aLogoPng(width, height));
        await AssertStatusAsync(response, HttpStatusCode.OK);
        var asset = await RequiredJsonAsync<MediaAsset>(response);
        Assert.AreEqual("Ready", asset.Status);
        return asset.Id;
    }

    private async Task<byte[]> R35aReadLogoAsync(HttpClient caller, Guid assetId)
    {
        RequiredTestClock.Set(DateTimeOffset.UtcNow);
        await RefreshCsrfAsync(caller);
        var access = await caller.PostAsync($"/api/media/{assetId}/access", null);
        await AssertStatusAsync(access, HttpStatusCode.OK);
        var content = await caller.GetAsync((await RequiredJsonAsync<Phase5B2Access>(access)).Url);
        await AssertStatusAsync(content, HttpStatusCode.OK);
        Assert.AreEqual("image/png", content.Content.Headers.ContentType?.MediaType);
        return await content.Content.ReadAsByteArrayAsync();
    }

    private static async Task<HttpResponseMessage> R35aPutBrandAsync(
        HttpClient caller,
        string? brandColor,
        string? accentColor,
        Guid? logoAssetId,
        uint version)
    {
        await RefreshCsrfAsync(caller);
        return await caller.PutAsJsonAsync("/api/workspace/brand", new { brandColor, accentColor, logoAssetId, version });
    }

    private static async Task<R35aWorkspace> R35aWorkspaceAsync(HttpClient caller) =>
        await RequiredJsonAsync<R35aWorkspace>(await caller.GetAsync("/api/workspace"));

    private static async Task<R35aMembership[]> R35aMembershipsAsync(HttpClient caller) =>
        await RequiredJsonAsync<R35aMembership[]>(await caller.GetAsync("/api/tenants"));

    private static (string?, string?, Guid?) R35aBrandOf(R35aWorkspace workspace) =>
        (workspace.BrandColor, workspace.AccentColor, workspace.LogoAssetId);

    private async Task<string> R35aAssetStatusAsync(Guid assetId)
    {
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT \"Status\" FROM media.\"Assets\" WHERE \"Id\" = @id";
        command.Parameters.AddWithValue("id", assetId);
        return (string)(await command.ExecuteScalarAsync()
            ?? throw new AssertFailedException("The media asset does not exist."));
    }

    private async Task<string> R35aRejectedSqlStateAsync(string sql, Guid tenantId, Guid? assetId)
    {
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.Parameters.AddWithValue("id", tenantId);
        if (assetId is { } asset)
        {
            command.Parameters.AddWithValue("asset", asset);
        }

        var exception = await Assert.ThrowsExactlyAsync<PostgresException>(
            async () => await command.ExecuteNonQueryAsync());
        return exception.SqlState;
    }

    private sealed record R35aWorkspace(uint Version, string? BrandColor, string? AccentColor, Guid? LogoAssetId);

    private sealed record R35aMembership(Guid TenantId, string? BrandColor, string? AccentColor, Guid? LogoAssetId);

    private sealed record R35aMediaPage(R35aMediaItem[] Items);

    private sealed record R35aMediaItem(Guid Id);
}
