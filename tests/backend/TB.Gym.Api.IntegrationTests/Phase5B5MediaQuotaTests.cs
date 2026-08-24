using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using TB.Gym.Modules.Media;
using TB.Gym.Modules.Nutrition;
using TB.Gym.SharedKernel;

namespace TB.Gym.Api.IntegrationTests;

public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task Phase5B5WorkspaceQuotaCountsDerivativesAndPendingPurgeBytesAndReleasesPurgedOnes()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "p5b5-quota-coach@example.test", "Quota Coach", "Quota Workspace");
        using var client = CreateClient();
        await InviteAndAcceptAsync(coach, client, "p5b5-quota-client@example.test", true);
        SetTenant(client, workspaceId);

        var photo = await UploadProgressPhotoAsync(client, "/api/progress/me/photos?pose=Front&photoDate=2026-08-22");
        var stored = await Phase5B5MeasureAsync();

        // A rendition is a real object on disk, so it counts. Before this chunk the sum ignored
        // derivatives entirely and a workspace could overshoot by every thumbnail it held.
        Assert.IsGreaterThan(0, stored.DerivativeBytes, "Derivative bytes were not counted.");
        Assert.AreEqual(stored.AssetBytes + stored.DerivativeBytes, stored.TotalBytes);

        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync(
                $"/api/progress/me/photos/{photo.Id}/remove",
                new { reason = "Removed for the quota test.", photo.Version }),
            HttpStatusCode.OK);

        // Tombstoned bytes are still physically stored, so they still count. Releasing the
        // allowance at removal would let a workspace overshoot by everything awaiting deletion.
        var afterRemoval = await Phase5B5MeasureAsync();
        Assert.AreEqual(stored.TotalBytes, afterRemoval.TotalBytes, "Pending-purge bytes stopped counting too early.");

        RequiredTestClock.Advance(TimeSpan.FromDays(31));
        Assert.AreEqual(1, (await Phase5B5SweepAsync()).Purged);

        // Purging is what finally releases the space, for the original and its rendition together.
        var afterPurge = await Phase5B5MeasureAsync();
        Assert.AreEqual(0, afterPurge.TotalBytes, "Purged bytes were not released from the allowance.");
    }

    [TestMethod]
    public async Task Phase5B5WorkspaceQuotaRejectionCarriesAStableCode()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(coach, "p5b5-full-coach@example.test", "Full Coach", "Quota Full");

        // Three uploads fit inside the 15 MB allowance; the fourth cannot.
        for (var index = 0; index < 3; index++)
        {
            await AssertStatusAsync(
                await Phase5B5UploadExerciseMediaAsync(coach, 5_000_000, $"fill-{index}.jpg"),
                HttpStatusCode.OK);
        }

        var rejected = await Phase5B5UploadExerciseMediaAsync(coach, 5_000_000, "overflow.jpg");
        // A full allowance is a conflict with stored state carrying an actionable code, not a
        // validation problem that reads as though the file itself was wrong.
        Assert.AreEqual(HttpStatusCode.Conflict, rejected.StatusCode);
        var problem = await RequiredJsonAsync<Phase5B5Problem>(rejected);
        Assert.AreEqual(MediaQuotaCodes.WorkspaceStorageExceeded, problem.Code);

        // Deleting and purging frees the space, and the same upload then succeeds.
        var assets = await coach.GetFromJsonAsync<Phase5B5MediaPage>("/api/media?skip=0&take=100")
            ?? throw new AssertFailedException("The media library was empty.");
        var victim = assets.Items[0];
        await RefreshCsrfAsync(coach);
        await AssertStatusAsync(
            await coach.SendAsync(new HttpRequestMessage(HttpMethod.Delete, $"/api/media/{victim.Id}")
            {
                Content = JsonContent.Create(new { victim.Version }),
            }),
            HttpStatusCode.OK);
        RequiredTestClock.Advance(TimeSpan.FromDays(31));
        Assert.AreEqual(1, (await Phase5B5SweepAsync()).Purged);

        await AssertStatusAsync(
            await Phase5B5UploadExerciseMediaAsync(coach, 5_000_000, "after-purge.jpg"),
            HttpStatusCode.OK);
    }

    [TestMethod]
    public async Task Phase5B5ClientProgressPhotoQuotaIsEnforcedIndependentlyOfTheWorkspaceAllowance()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "p5b5-client-coach@example.test", "Client Quota", "Client Quota");
        using var client = CreateClient();
        await InviteAndAcceptAsync(coach, client, "p5b5-client-client@example.test", true);
        SetTenant(client, workspaceId);

        // Photographic noise, so each sanitised image is megabytes rather than kilobytes and the
        // allowance binds within the endpoint's hourly upload limit rather than after it.
        // Roughly 4 MB stored per photo, so the 15 MB client allowance binds on the fourth upload,
        // well inside the endpoint's hourly upload limit.
        var image = ProgressPhotoImageFactory.DetailedJpegWithExif(
            3000,
            2250,
            ProgressPhotoImageFactory.UprightOrientation);

        var accepted = 0;
        Phase5B5Problem? rejection = null;
        for (var day = 1; day <= 8 && rejection is null; day++)
        {
            var response = await PostProgressPhotoAsync(
                client,
                $"/api/progress/me/photos?pose=Front&photoDate=2026-08-{day:00}",
                image);
            if (response.StatusCode == HttpStatusCode.OK)
            {
                accepted++;
                continue;
            }

            Assert.AreEqual(HttpStatusCode.Conflict, response.StatusCode, await response.Content.ReadAsStringAsync());
            rejection = await RequiredJsonAsync<Phase5B5Problem>(response);
        }

        var used = await Phase5B5MeasureAsync();
        Assert.IsGreaterThan(0, accepted, "The client allowance rejected every upload.");
        Assert.IsNotNull(
            rejection,
            $"The per-client allowance never bound after {accepted} uploads totalling {used.TotalBytes} bytes.");
        Assert.AreEqual(MediaQuotaCodes.ClientProgressPhotoStorageExceeded, rejection!.Code);

        // The workspace allowance is 200 MB here and nowhere near full, so the client limit bound
        // on its own rather than the workspace limit binding first.
        Assert.IsLessThan(Phase5B5RoomyQuotaBytes, used.TotalBytes);

        // A second client in the same workspace has their own allowance and is unaffected.
        using var other = CreateClient();
        await InviteAndAcceptAsync(coach, other, "p5b5-client-other@example.test", true);
        SetTenant(other, workspaceId);
        await AssertStatusAsync(
            await PostProgressPhotoAsync(other, "/api/progress/me/photos?pose=Front&photoDate=2026-08-22", image),
            HttpStatusCode.OK);
    }

    [TestMethod]
    public async Task Phase5B5ConcurrentUploadsAcrossReplicasCannotBothPassTheSameQuota()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(coach, "p5b5-race-coach@example.test", "Race Coach", "Quota Race");

        // Fill to 10 MB of the 15 MB allowance, leaving room for exactly one of the two racers.
        for (var index = 0; index < 2; index++)
        {
            await AssertStatusAsync(
                await Phase5B5UploadExerciseMediaAsync(coach, 5_000_000, $"race-fill-{index}.jpg"),
                HttpStatusCode.OK);
        }

        // A second application instance on the same database. The in-process upload gate is a
        // per-process semaphore, so two requests in one process can never overlap; only a second
        // instance reproduces the real race between API replicas. What serialises them is the
        // transaction-scoped PostgreSQL advisory lock, and nothing else.
        await using var replica = Phase5B5CreateReplica();
        using var replicaCoach = replica.CreateClient(new WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = true,
            BaseAddress = new Uri("http://localhost"),
        });
        await RefreshCsrfAsync(replicaCoach);
        await AssertStatusAsync(
            await replicaCoach.PostAsJsonAsync(
                "/api/auth/login",
                new { email = "p5b5-race-coach@example.test", password = Password, rememberMe = false }),
            HttpStatusCode.OK);
        SetTenant(replicaCoach, workspaceId);

        // Either upload alone fits in the remaining 5.7 MB; together they exceed it.
        await RefreshCsrfAsync(coach);
        await RefreshCsrfAsync(replicaCoach);
        var first = Phase5B5UploadExerciseMediaAsync(coach, 4_000_000, "race-a.jpg");
        var second = Phase5B5UploadExerciseMediaAsync(replicaCoach, 4_000_000, "race-b.jpg");
        var responses = await Task.WhenAll(first, second);

        var succeeded = responses.Count(response => response.StatusCode == HttpStatusCode.OK);
        var conflicted = responses.Count(response => response.StatusCode == HttpStatusCode.Conflict);
        Assert.AreEqual(
            1,
            succeeded,
            $"Exactly one upload may win the last of the allowance; received {string.Join(", ", responses.Select(item => (int)item.StatusCode))}.");
        Assert.AreEqual(1, conflicted);

        var loser = responses.Single(response => response.StatusCode == HttpStatusCode.Conflict);
        Assert.AreEqual(
            MediaQuotaCodes.WorkspaceStorageExceeded,
            (await RequiredJsonAsync<Phase5B5Problem>(loser)).Code);

        // The committed total never exceeded the allowance, which is the property a read-then-write
        // check cannot give: both racers measured the same free space before either committed.
        var used = await Phase5B5MeasureAsync();
        Assert.IsLessThanOrEqualTo(MediaUploadPolicy.MaximumImageBytes, used.TotalBytes);
        Assert.AreEqual(14_000_000, used.TotalBytes);

        foreach (var response in responses)
        {
            response.Dispose();
        }
    }

    /// <summary>
    /// A second application instance over the same database and storage root, standing in for a
    /// second API replica. It shares no in-process state with the first.
    /// </summary>
    private WebApplicationFactory<Program> Phase5B5CreateReplica() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Development");
            builder.UseSetting("ConnectionStrings:Database", RequiredDatabaseConnection);
            builder.UseSetting("Database:ApplyMigrationsOnStartup", "false");
            builder.UseSetting("Seed:Enabled", "false");
            builder.ConfigureAppConfiguration((_, configuration) =>
                configuration.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["ConnectionStrings:Database"] = RequiredDatabaseConnection,
                    ["Database:ApplyMigrationsOnStartup"] = "false",
                    ["Seed:Enabled"] = "false",
                    ["Application:PublicBaseUrl"] = "http://localhost:4200",
                    ["Media:StorageRoot"] = Path.Combine(Path.GetTempPath(), databaseName!, "media"),
                    ["Media:PurgeEnabled"] = "false",
                    ["Media:MaxWorkspaceStorageBytes"] =
                        Phase5B5WorkspaceQuotaBytes().ToString(CultureInfo.InvariantCulture),
                    ["Media:MaxClientProgressPhotoBytes"] =
                        Phase5B5ClientQuotaBytes().ToString(CultureInfo.InvariantCulture),
                }));
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<IClock>();
                services.RemoveAll<IAiMealDraftProvider>();
                services.RemoveAll<INutritionDataProvider>();
                services.AddSingleton<IClock>(RequiredTestClock);
                services.AddSingleton<IAiMealDraftProvider, InvalidSchemaAiMealDraftProvider>();
                services.AddSingleton<INutritionDataProvider, FibreRichTestNutritionDataProvider>();
                services.AddLogging(logging => logging.ClearProviders());
            });
        });

    /// <summary>
    /// Uploads exercise media of an exact size. Exercise media is not re-encoded, so the stored
    /// length is exactly what was sent and the quota arithmetic in the assertions is exact.
    /// </summary>
    private static async Task<HttpResponseMessage> Phase5B5UploadExerciseMediaAsync(
        HttpClient coach,
        int lengthBytes,
        string fileName)
    {
        var bytes = new byte[lengthBytes];
        bytes[0] = 0xFF;
        bytes[1] = 0xD8;
        bytes[2] = 0xFF;
        await RefreshCsrfAsync(coach);
        using var form = new MultipartFormDataContent();
        var file = new ByteArrayContent(bytes);
        file.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");
        form.Add(file, "file", fileName);
        return await coach.PostAsync("/api/media/uploads", form);
    }

    /// <summary>
    /// The allowance as the application defines it: originals plus renditions, tombstoned bytes
    /// included, purged bytes excluded.
    /// </summary>
    private async Task<Phase5B5Usage> Phase5B5MeasureAsync()
    {
        await using var scope = RequiredFactory.Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<Infrastructure.Persistence.GymDbContext>();
        var token = TestContext.CancellationTokenSource.Token;
        var assetBytes = await context.MediaAssets
            .AsNoTracking()
            .IgnoreQueryFilters()
            .Where(item =>
                item.Source == MediaSource.Upload &&
                item.Status != MediaAssetStatus.Purged &&
                item.Length != null)
            .SumAsync(item => item.Length ?? 0L, token);
        var derivativeBytes = await context.MediaAssetDerivatives
            .AsNoTracking()
            .IgnoreQueryFilters()
            .Where(item => item.PurgedAtUtc == null)
            .SumAsync(item => item.Length, token);
        return new Phase5B5Usage(assetBytes, derivativeBytes);
    }

    private sealed record Phase5B5Usage(long AssetBytes, long DerivativeBytes)
    {
        public long TotalBytes => AssetBytes + DerivativeBytes;
    }

    private sealed record Phase5B5Problem(string? Code);
    private sealed record Phase5B5MediaItem(Guid Id, uint Version);
    private sealed record Phase5B5MediaPage(Phase5B5MediaItem[] Items);
}
