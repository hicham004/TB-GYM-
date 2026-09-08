using System.Globalization;
using System.Data.Common;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Npgsql;
using TB.Gym.Infrastructure.Persistence;
using TB.Gym.Modules.Media;
using TB.Gym.Modules.Nutrition;
using TB.Gym.SharedKernel;

namespace TB.Gym.Api.IntegrationTests;

[TestClass]
public sealed partial class Phase3TrainingWorkflowTests
{
    // Pinned so grant-expiry assertions do not silently track the production default. Expiry is
    // driven by the injected test clock, so this value costs no real waiting.
    private const int MediaAccessLifetimeSeconds = 120;
    private static readonly string Password = $"Aa1!{Guid.NewGuid():N}";
    private static readonly byte[] JpegBytes = [0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3];
    private static readonly string[] ExerciseTags = ["powerlifting", "squat"];
    private string? adminConnection;
    private string? databaseName;
    private string? databaseConnection;
    private WebApplicationFactory<Program>? factory;
    private MutableTestClock? testClock;
    private SensitiveLogCapture? sensitiveLogCapture;
    private StorageFaultSwitch? storageFaults;
    private InsertBarrier? insertBarrier;
    private ScannerSwitch? scannerSwitch;
    private InventoryProbe? inventoryProbe;
    private Phase6B4BProviderHarness? providerHarness;

    public TestContext TestContext { get; set; } = null!;

    [TestInitialize]
    public async Task InitializeAsync()
    {
        adminConnection = PostgreSqlTestEnvironment.RequireAdminConnection();
        databaseName = await PostgreSqlTestEnvironment.CreateDatabaseAsync("tbgym_p3");

        databaseConnection = new NpgsqlConnectionStringBuilder(adminConnection)
        {
            Database = databaseName,
        }.ConnectionString;
        var clock = new MutableTestClock(
            TestContext.TestName.StartsWith("Phase4", StringComparison.Ordinal) ||
            TestContext.TestName.StartsWith("Phase5", StringComparison.Ordinal) ||
            TestContext.TestName.StartsWith("Phase6", StringComparison.Ordinal)
                ? new DateTimeOffset(2026, 8, 22, 10, 0, 0, TimeSpan.Zero)
                : DateTimeOffset.UtcNow);
        testClock = clock;
        var logCapture = new SensitiveLogCapture();
        sensitiveLogCapture = logCapture;
        var storageFaults = new StorageFaultSwitch();
        this.storageFaults = storageFaults;
        var barrier = new InsertBarrier();
        insertBarrier = barrier;
        var scanner = new ScannerSwitch();
        scannerSwitch = scanner;
        var inventoryProbe = new InventoryProbe();
        this.inventoryProbe = inventoryProbe;
        // The 6B-4B tests run the real R2 and clamd adapters, so they compose the providers instead
        // of the local adapter and the switchable scanner. Everything else about the fixture — the
        // clock, the storage-call counting, the database — stays as it is.
        var providers = Phase6B4BProviderHarness.StartIfRequestedBy(TestContext.TestName);
        providerHarness = providers;
        factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Development");
            builder.UseSetting("ConnectionStrings:Database", databaseConnection);
            builder.UseSetting("Database:ApplyMigrationsOnStartup", "true");
            builder.UseSetting("Seed:Enabled", "false");
            // Also as host settings, not only as an application configuration source: which media
            // provider to compose is read while the services are being registered, which happens
            // before ConfigureAppConfiguration's sources are applied.
            foreach (var (key, value) in providers?.Settings ?? new Dictionary<string, string?>())
            {
                builder.UseSetting(key, value);
            }

            builder.ConfigureAppConfiguration((_, configuration) =>
                // The provider harness, when one is running, has the last word on the media
                // settings: it is what selects R2 and clamd instead of the local defaults.
                configuration.AddInMemoryCollection(Phase6B4BProviderHarness.Merge(
                    providers,
                    new Dictionary<string, string?>
                    {
                        ["ConnectionStrings:Database"] = databaseConnection,
                        ["Database:ApplyMigrationsOnStartup"] = "true",
                        ["Seed:Enabled"] = "false",
                        // Phase 6B-2B added an API-hosted realtime sweep. It is switched off here for the same
                        // reason the media purge is: a background tick must not race an assertion about what one
                        // request did. The realtime rows these commands write are still written.
                        ["Messaging:Realtime:Enabled"] = "false",
                        ["Application:PublicBaseUrl"] = "http://localhost:4200",
                        ["Media:StorageAdapter"] =
                            TestContext.TestName?.Contains(
                                "UnavailableStorage",
                                StringComparison.Ordinal) == true
                                ? "None"
                                : "Local",
                        ["Media:StorageRoot"] = Path.Combine(Path.GetTempPath(), databaseName, "media"),
                        ["Media:AccessLifetimeSeconds"] =
                            MediaAccessLifetimeSeconds.ToString(CultureInfo.InvariantCulture),
                        // The sweep is driven explicitly by the purge tests, so a background tick can
                        // never race an assertion about what has or has not been deleted.
                        ["Media:PurgeEnabled"] = "false",
                        // Reconciliation is driven explicitly by its own tests, for the same reason
                        // the purge sweep is: a background pass must not race an assertion about
                        // what one run observed.
                        ["Media:Reconciliation:Enabled"] = "false",
                        ["Media:MaxWorkspaceStorageBytes"] =
                            Phase5B5WorkspaceQuotaBytes().ToString(CultureInfo.InvariantCulture),
                        ["Media:MaxClientProgressPhotoBytes"] =
                            Phase5B5ClientQuotaBytes().ToString(CultureInfo.InvariantCulture),
                    })));
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<IClock>();
                services.RemoveAll<IAiMealDraftProvider>();
                services.RemoveAll<INutritionDataProvider>();
                services.AddSingleton<IClock>(clock);
                services.AddSingleton<IAiMealDraftProvider, InvalidSchemaAiMealDraftProvider>();
                services.AddSingleton<INutritionDataProvider, FibreRichTestNutritionDataProvider>();
                services.AddSingleton<ILoggerProvider>(logCapture);
                services.AddTransient<IStartupFilter, TestRemoteAddressStartupFilter>();
                services.AddSingleton<TodayQueryCounter>();
                services.AddSingleton(barrier);
                services.AddDbContext<GymDbContext>((provider, options) => options.AddInterceptors(
                    provider.GetRequiredService<TodayQueryCounter>(),
                    provider.GetRequiredService<InsertBarrier>()));
                if (providers is not null)
                {
                    // Only the socket is replaced: the composed adapter, its configuration and the
                    // requests it makes are the real ones.
                    services.RemoveAll<Amazon.S3.IAmazonS3>();
                    services.AddSingleton<Amazon.S3.IAmazonS3>(_ =>
                        Phase6B4BMediaProviderStartupTests.CreateFakeS3(providers.Bucket));
                }

                Phase5B5DecorateObjectStorage(services, storageFaults);
                Phase6B4CDecorateObjectInventory(services, inventoryProbe);
                if (providers is null)
                {
                    // A scanner the test can switch off, so an unavailable-scanner deployment can be
                    // exercised without leaving Development, which the rest of the harness needs.
                    services.RemoveAll<IMediaScanner>();
                    services.AddSingleton<IMediaScanner>(new SwitchableMediaScanner(scanner));
                }
            });
        });
    }

    [TestCleanup]
    public async Task CleanupAsync()
    {
        factory?.Dispose();
        if (providerHarness is not null)
        {
            await providerHarness.DisposeAsync();
        }

        NpgsqlConnection.ClearAllPools();
        if (databaseName is null || adminConnection is null)
        {
            return;
        }

        var mediaRoot = Path.Combine(Path.GetTempPath(), databaseName);
        if (Directory.Exists(mediaRoot))
        {
            Directory.Delete(mediaRoot, recursive: true);
        }

        await using var connection = new NpgsqlConnection(adminConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = $"DROP DATABASE IF EXISTS \"{databaseName}\" WITH (FORCE)";
        await command.ExecuteNonQueryAsync();
    }

    [TestMethod]
    public async Task TrainingEngineSnapshotsProgressionLoggingSecurityAndIsolationWorkEndToEnd()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(
            coach,
            "phase3-coach@example.test",
            "Phase Three Coach",
            "Phase Three Workspace");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(
            coach,
            client,
            "phase3-client@example.test",
            newAccount: true);
        SetTenant(client, workspaceId);

        var enrollment = await CreateFreeTrainingEnrollmentAsync(coach, clientId, TenantToday());
        var media = await UploadJpegAsync(coach);
        var alternative = await CreateExerciseAsync(coach, "Safety-bar squat", [], []);
        var squat = await CreateExerciseAsync(
            coach,
            "Competition squat",
            [alternative.Id],
            [media.Id]);
        var exerciseSearch = await coach.GetAsync("/api/exercises?skip=0&take=200");
        Assert.AreEqual(HttpStatusCode.OK, exerciseSearch.StatusCode);
        var max = await RecordWorkingMaxAsync(coach, clientId, squat.Id, 100m);
        var template = await CreateTemplateAsync(coach, squat.Id, alternative.Id, targetRpe: 6m);
        var assignmentKey = Guid.NewGuid();
        var assignmentRequest = AssignmentRequest(
            enrollment.Id,
            template.Id,
            squat.Id,
            max.Id,
            100m,
            assignmentKey);

        await RefreshCsrfAsync(coach);
        var assignmentResponse = await coach.PostAsJsonAsync(
            $"/api/training/clients/{clientId}/mesocycles",
            assignmentRequest);
        await AssertStatusAsync(assignmentResponse, HttpStatusCode.OK);
        var mesocycle = await RequiredJsonAsync<Mesocycle>(assignmentResponse);
        Assert.HasCount(1, mesocycle.WorkingMaxes);
        Assert.AreEqual(100m, mesocycle.WorkingMaxes[0].Value);
        Assert.AreEqual(76.923m, mesocycle.Weeks[0].Sessions[0].Exercises[0].Sets[0].UnroundedRecommendedLoad);
        Assert.AreEqual(77.5m, mesocycle.Weeks[0].Sessions[0].Exercises[0].Sets[0].PrescribedLoad);

        await RefreshCsrfAsync(coach);
        var idempotent = await coach.PostAsJsonAsync(
            $"/api/training/clients/{clientId}/mesocycles",
            assignmentRequest);
        await AssertStatusAsync(idempotent, HttpStatusCode.OK);
        Assert.AreEqual(mesocycle.Id, (await RequiredJsonAsync<Mesocycle>(idempotent)).Id);

        await RefreshCsrfAsync(coach);
        var reusedKey = await coach.PostAsJsonAsync(
            $"/api/training/clients/{clientId}/mesocycles",
            AssignmentRequest(enrollment.Id, template.Id, squat.Id, max.Id, 90m, assignmentKey));
        Assert.AreEqual(HttpStatusCode.Conflict, reusedKey.StatusCode);

        await RefreshCsrfAsync(coach);
        var overlap = await coach.PostAsJsonAsync(
            $"/api/training/clients/{clientId}/mesocycles",
            AssignmentRequest(enrollment.Id, template.Id, squat.Id, max.Id, 100m, Guid.NewGuid()));
        Assert.AreEqual(HttpStatusCode.Conflict, overlap.StatusCode);

        var secondMax = await RecordWorkingMaxAsync(coach, clientId, squat.Id, 150m);
        Assert.AreNotEqual(max.Id, secondMax.Id);
        mesocycle = await coach.GetFromJsonAsync<Mesocycle>($"/api/training/mesocycles/{mesocycle.Id}")
            ?? throw new AssertFailedException("Mesocycle response was empty.");
        Assert.AreEqual(100m, mesocycle.WorkingMaxes[0].Value);
        Assert.AreEqual(77.5m, mesocycle.Weeks[0].Sessions[0].Exercises[0].Sets[0].PrescribedLoad);

        var templatePage = await coach.GetFromJsonAsync<TemplatePage>("/api/training/templates")
            ?? throw new AssertFailedException("Template list was empty.");
        await RefreshCsrfAsync(coach);
        var nextVersionResponse = await coach.PostAsJsonAsync(
            $"/api/training/templates/{template.TemplateId}/versions",
            TemplateRequest(squat.Id, alternative.Id, targetRpe: 9m, templatePage.Items.Single().Version));
        await AssertStatusAsync(nextVersionResponse, HttpStatusCode.OK);
        mesocycle = await coach.GetFromJsonAsync<Mesocycle>($"/api/training/mesocycles/{mesocycle.Id}")
            ?? throw new AssertFailedException("Mesocycle response was empty.");
        Assert.AreEqual(6m, mesocycle.Weeks[0].Sessions[0].Exercises[0].Sets[0].TargetRpe);

        await RefreshCsrfAsync(coach);
        var previewResponse = await coach.PostAsJsonAsync(
            $"/api/training/mesocycles/{mesocycle.Id}/progression/preview",
            new
            {
                sourceWeekIds = new[] { mesocycle.Weeks[0].Id },
                iterations = 2,
                rpeIncrement = 0.5m,
                mesocycleVersion = mesocycle.Version,
            });
        await AssertStatusAsync(previewResponse, HttpStatusCode.OK);
        var preview = await RequiredJsonAsync<ProgressionPreview>(previewResponse);
        Assert.HasCount(2, preview.GeneratedWeeks);
        Assert.AreEqual(6.5m, preview.GeneratedWeeks[0].Sessions[0].Exercises[0].Sets[0].TargetRpe);
        Assert.AreEqual(7m, preview.GeneratedWeeks[1].Sessions[0].Exercises[0].Sets[0].TargetRpe);

        await RefreshCsrfAsync(coach);
        var applyResponse = await coach.PostAsJsonAsync(
            $"/api/training/mesocycles/{mesocycle.Id}/progression/apply",
            new
            {
                sourceWeekIds = new[] { mesocycle.Weeks[0].Id },
                iterations = 2,
                rpeIncrement = 0.5m,
                previewHash = preview.PreviewHash,
                mesocycleVersion = mesocycle.Version,
            });
        await AssertStatusAsync(applyResponse, HttpStatusCode.OK);
        mesocycle = await RequiredJsonAsync<Mesocycle>(applyResponse);
        Assert.HasCount(3, mesocycle.Weeks);

        await RefreshCsrfAsync(coach);
        var revealResponse = await coach.PutAsJsonAsync(
            $"/api/training/mesocycles/{mesocycle.Id}/visibility",
            new { revealAllWeeks = true, mesocycle.Version });
        await AssertStatusAsync(revealResponse, HttpStatusCode.OK);
        var revealed = await RequiredJsonAsync<Mesocycle>(revealResponse);
        Assert.IsTrue(revealed.Weeks.All(item => item.IsVisible == true));

        await RefreshCsrfAsync(coach);
        var staleReveal = await coach.PutAsJsonAsync(
            $"/api/training/mesocycles/{mesocycle.Id}/visibility",
            new { revealAllWeeks = false, mesocycle.Version });
        Assert.AreEqual(HttpStatusCode.Conflict, staleReveal.StatusCode);

        RequiredTestClock.Set(DateTimeOffset.UtcNow);
        await RefreshCsrfAsync(client);
        var mediaAccessBeforeAssignmentCheck = await client.PostAsync($"/api/media/{media.Id}/access", null);
        await AssertStatusAsync(mediaAccessBeforeAssignmentCheck, HttpStatusCode.OK);
        var mediaAccess = await RequiredJsonAsync<MediaAccess>(mediaAccessBeforeAssignmentCheck);
        Assert.IsFalse(mediaAccess.DownloadAllowed);
        var mediaContent = await client.GetAsync(mediaAccess.Url);
        await AssertStatusAsync(mediaContent, HttpStatusCode.OK);
        Assert.AreEqual("image/jpeg", mediaContent.Content.Headers.ContentType?.MediaType);

        var today = await client.GetFromJsonAsync<TrainingDay>("/api/training/me/today")
            ?? throw new AssertFailedException("Client training day was empty.");
        Assert.IsTrue(today.IsAllowed);
        Assert.HasCount(1, today.Workouts);
        Assert.HasCount(1, today.Workouts[0].Exercises[0].MediaAssetIds);

        await RefreshCsrfAsync(client);
        var startResponse = await client.PostAsync(
            $"/api/training/me/sessions/{today.Workouts[0].SessionId}/start",
            null);
        await AssertStatusAsync(startResponse, HttpStatusCode.OK);
        var execution = await RequiredJsonAsync<Execution>(startResponse);
        today = await client.GetFromJsonAsync<TrainingDay>("/api/training/me/today")
            ?? throw new AssertFailedException("Started training day was empty.");
        var workout = today.Workouts.Single();
        var exercise = workout.Exercises.Single();
        var set = exercise.Sets.Single();

        await RefreshCsrfAsync(client);
        var substitutionResponse = await client.PutAsJsonAsync(
            $"/api/training/me/workouts/{execution.Id}/exercises/{exercise.PerformanceId}/substitution",
            new { exerciseId = alternative.Id, version = workout.ExecutionVersion });
        await AssertStatusAsync(substitutionResponse, HttpStatusCode.OK);
        execution = await RequiredJsonAsync<Execution>(substitutionResponse);

        await RefreshCsrfAsync(client);
        var actualResponse = await client.PutAsJsonAsync(
            $"/api/training/me/workouts/{execution.Id}/sets/{set.PerformanceId}",
            new
            {
                repetitions = 5,
                load = 80m,
                loadUnit = "Kilogram",
                rpe = (decimal?)null,
                rir = 2m,
                isCompleted = true,
                clientNote = "Strong set",
                execution.Version,
            });
        await AssertStatusAsync(actualResponse, HttpStatusCode.OK);
        var afterActual = await RequiredJsonAsync<WorkoutSetSave>(actualResponse);

        await RefreshCsrfAsync(client);
        var staleActual = await client.PutAsJsonAsync(
            $"/api/training/me/workouts/{execution.Id}/sets/{set.PerformanceId}",
            new
            {
                repetitions = 6,
                load = 82.5m,
                loadUnit = "Kilogram",
                rpe = 9m,
                rir = (decimal?)null,
                isCompleted = true,
                clientNote = "Stale",
                execution.Version,
            });
        Assert.AreEqual(HttpStatusCode.Conflict, staleActual.StatusCode);

        today = await client.GetFromJsonAsync<TrainingDay>("/api/training/me/today")
            ?? throw new AssertFailedException("Updated training day was empty.");
        workout = today.Workouts.Single();
        exercise = workout.Exercises.Single();
        set = exercise.Sets.Single();
        Assert.AreEqual(squat.Id, exercise.PrescribedExerciseId);
        Assert.AreEqual(alternative.Id, exercise.ActualExerciseId);
        Assert.IsTrue(exercise.WasSubstituted);
        Assert.AreEqual(77.5m, set.PrescribedLoad);
        Assert.AreEqual(80m, set.ActualLoad);
        Assert.AreEqual(8m, set.ActualRpe);
        Assert.AreEqual(2m, set.ActualRir);

        await RefreshCsrfAsync(client);
        var completeResponse = await client.PostAsJsonAsync(
            $"/api/training/me/workouts/{execution.Id}/complete",
            new { version = afterActual.ExecutionVersion });
        await AssertStatusAsync(completeResponse, HttpStatusCode.OK);
        var completed = await RequiredJsonAsync<Execution>(completeResponse);
        Assert.AreEqual("Completed", completed.Status);

        var completedToday = await client.GetFromJsonAsync<TrainingDay>("/api/training/me/today")
            ?? throw new AssertFailedException("Completed training day was empty.");
        var completedSet = completedToday.Workouts.Single().Exercises.Single().Sets.Single();
        Assert.AreEqual("Completed", completedToday.Workouts.Single().Status);
        Assert.AreEqual(77.5m, completedSet.PrescribedLoad);
        Assert.AreEqual(80m, completedSet.ActualLoad);

        await RefreshCsrfAsync(client);
        var mutateCompleted = await client.PutAsJsonAsync(
            $"/api/training/me/workouts/{execution.Id}/sets/{set.PerformanceId}",
            new
            {
                repetitions = 10,
                load = 200m,
                loadUnit = "Kilogram",
                rpe = 10m,
                rir = (decimal?)null,
                isCompleted = true,
                clientNote = "Tamper",
                completed.Version,
            });
        Assert.AreEqual(HttpStatusCode.Conflict, mutateCompleted.StatusCode);
        await AssertCompletedSetRejectsDirectMutationAsync(set.PerformanceId!.Value);

        var historyPage = await coach.GetFromJsonAsync<HistoryPage>(
            $"/api/training/clients/{clientId}/exercises/{alternative.Id}/history")
            ?? throw new AssertFailedException("Exercise history was empty.");
        Assert.HasCount(1, historyPage.Items);
        Assert.AreEqual(80m, historyPage.Items[0].Load);
        Assert.AreEqual(400m, historyPage.Items[0].Volume);
        Assert.IsTrue(historyPage.Items[0].WasSubstituted);

        using var otherCoach = CreateClient();
        await RegisterCoachAsync(
            otherCoach,
            "phase3-other@example.test",
            "Other Coach",
            "Other Workspace");
        Assert.AreEqual(HttpStatusCode.NotFound, (await otherCoach.GetAsync($"/api/exercises/{squat.Id}")).StatusCode);
        Assert.AreEqual(HttpStatusCode.NotFound, (await otherCoach.GetAsync($"/api/training/mesocycles/{mesocycle.Id}")).StatusCode);

        await RefreshCsrfAsync(coach);
        var pause = await coach.PostAsJsonAsync(
            $"/api/commercial/enrollments/{enrollment.Id}/pause",
            new { reason = "Access enforcement test", enrollment.Version });
        await AssertStatusAsync(pause, HttpStatusCode.OK);
        var deniedToday = await client.GetFromJsonAsync<TrainingDay>("/api/training/me/today")
            ?? throw new AssertFailedException("Denied training response was empty.");
        Assert.IsFalse(deniedToday.IsAllowed);
        Assert.AreEqual("Paused", deniedToday.AccessReason);
        await RefreshCsrfAsync(client);
        Assert.AreEqual(
            HttpStatusCode.Forbidden,
            (await client.PostAsync($"/api/media/{media.Id}/access", null)).StatusCode);
    }

    private HttpClient CreateClient() => RequiredFactory.CreateClient(new WebApplicationFactoryClientOptions
    {
        AllowAutoRedirect = false,
        HandleCookies = true,
        BaseAddress = new Uri("http://localhost"),
    });

    private static async Task<Guid> RegisterCoachAsync(
        HttpClient client,
        string email,
        string displayName,
        string workspaceName)
    {
        await RefreshCsrfAsync(client);
        var response = await client.PostAsJsonAsync("/api/auth/register/coach", new
        {
            displayName,
            email,
            password = Password,
            workspaceName,
            timeZoneId = "Asia/Beirut",
            defaultCulture = "en-LB",
            defaultCurrencyCode = "USD",
            weekStartsOn = "Monday",
        });
        await AssertStatusAsync(response, HttpStatusCode.Accepted);
        var registration = await RequiredJsonAsync<Registration>(response);
        Assert.IsNotNull(registration.DevelopmentConfirmationUrl);
        await RefreshCsrfAsync(client);
        var confirmation = await client.PostAsJsonAsync("/api/auth/confirm-email", new
        {
            userId = Guid.Parse(QueryValue(registration.DevelopmentConfirmationUrl, "userId")),
            code = QueryValue(registration.DevelopmentConfirmationUrl, "code"),
        });
        await AssertStatusAsync(confirmation, HttpStatusCode.NoContent);
        await RefreshCsrfAsync(client);
        await AssertStatusAsync(
            await client.PostAsJsonAsync("/api/auth/login", new { email, password = Password, rememberMe = false }),
            HttpStatusCode.OK);
        var memberships = await client.GetFromJsonAsync<TenantMembership[]>("/api/tenants")
            ?? throw new AssertFailedException("Workspace membership was empty.");
        SetTenant(client, memberships.Single().TenantId);
        return memberships.Single().TenantId;
    }

    private static async Task<Guid> InviteAndAcceptAsync(
        HttpClient coach,
        HttpClient client,
        string email,
        bool newAccount)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync("/api/invitations", new
        {
            email,
            firstName = "Training",
            lastName = "Client",
            phoneNumber = "+96170000000",
            birthDate = "1995-04-02",
        });
        await AssertStatusAsync(response, HttpStatusCode.Created);
        var invitation = await RequiredJsonAsync<Invitation>(response);
        var token = QueryValue(invitation.DevelopmentActionUrl!, "token");
        await RefreshCsrfAsync(client);
        var acceptance = await client.PostAsJsonAsync("/api/invitations/accept", new
        {
            token,
            displayName = newAccount ? "Training Client" : null,
            password = newAccount ? Password : null,
        });
        await AssertStatusAsync(acceptance, HttpStatusCode.OK);
        var accepted = await RequiredJsonAsync<InvitationAcceptance>(acceptance);
        SetTenant(client, accepted.TenantId);
        return accepted.ClientProfileId;
    }

    private static async Task<Enrollment> CreateFreeTrainingEnrollmentAsync(
        HttpClient coach,
        Guid clientId,
        DateOnly startDate)
    {
        await RefreshCsrfAsync(coach);
        var productResponse = await coach.PostAsJsonAsync("/api/commercial/products", new
        {
            name = "Training Engine Test",
            description = "Phase 3",
            initialOffer = new
            {
                label = "8 weeks",
                durationCount = 8,
                durationUnit = "Week",
                priceAmount = 0m,
                priceCurrency = "USD",
                features = new[] { new { feature = "Training", allowsConcurrentCoverage = false } },
            },
        });
        await AssertStatusAsync(productResponse, HttpStatusCode.OK);
        var product = await RequiredJsonAsync<Product>(productResponse);
        await RefreshCsrfAsync(coach);
        var enrollmentResponse = await coach.PostAsJsonAsync(
            $"/api/commercial/clients/{clientId}/enrollments",
            new { offerId = product.Offers[0].Id, startDate, idempotencyKey = Guid.NewGuid() });
        await AssertStatusAsync(enrollmentResponse, HttpStatusCode.OK);
        return await RequiredJsonAsync<Enrollment>(enrollmentResponse);
    }

    private static async Task<MediaAsset> UploadJpegAsync(HttpClient coach)
    {
        await RefreshCsrfAsync(coach);
        using var form = new MultipartFormDataContent();
        form.Add(new StringContent("Squat demo"), "title");
        var file = new ByteArrayContent(JpegBytes);
        file.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");
        form.Add(file, "file", "squat-demo.jpg");
        var response = await coach.PostAsync("/api/media/uploads", form);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<MediaAsset>(response);
    }

    private static async Task<Exercise> CreateExerciseAsync(
        HttpClient coach,
        string name,
        Guid[] alternatives,
        Guid[] mediaIds)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync("/api/exercises/", new
        {
            name,
            instructions = "Use controlled technique.",
            equipment = "Barbell",
            movementPattern = "Squat",
            classification = "Strength",
            muscles = new[] { new { muscle = "Quadriceps", role = "Primary" } },
            tags = ExerciseTags,
            alternatives = alternatives.Select(id => new { exerciseId = id, note = "Coach-approved" }).ToArray(),
            mediaAssetIds = mediaIds,
        });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<Exercise>(response);
    }

    private static async Task<StrengthMax> RecordWorkingMaxAsync(
        HttpClient coach,
        Guid clientId,
        Guid exerciseId,
        decimal value)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync($"/api/strength/clients/{clientId}/maxes", new
        {
            exerciseId,
            kind = "CoachWorkingMax",
            value,
            unit = "Kilogram",
            effectiveDate = TenantToday(),
            source = "Manual",
            methodKey = (string?)null,
            methodVersion = (string?)null,
            sourceWorkoutExecutionId = (Guid?)null,
            note = "Coach-selected max",
        });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<StrengthMax>(response);
    }

    private static async Task<TemplateVersion> CreateTemplateAsync(
        HttpClient coach,
        Guid exerciseId,
        Guid alternativeId,
        decimal targetRpe)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync(
            "/api/training/templates",
            TemplateRequest(exerciseId, alternativeId, targetRpe, null));
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<TemplateVersion>(response);
    }

    private static object TemplateRequest(
        Guid exerciseId,
        Guid alternativeId,
        decimal targetRpe,
        uint? templateVersion) => new
        {
            name = "Powerlifting Base",
            description = "Fast strength template",
            publish = true,
            templateVersion,
            weeks = new[]
            {
                new
                {
                    label = "Week 1",
                    isPublished = true,
                    sessions = new[]
                    {
                        new
                        {
                            name = "Squat day",
                            dayOffset = 0,
                            coachNotes = "Brace before every rep.",
                            exercises = new[]
                            {
                                new
                                {
                                    exerciseId,
                                    position = 0,
                                    isMainLift = false,
                                    modificationPolicy = "CoachApprovedSwap",
                                    coachNotes = "Stop if technique degrades.",
                                    approvedAlternativeExerciseIds = new[] { alternativeId },
                                    sets = new[]
                                    {
                                        new
                                        {
                                            position = 0,
                                            setType = "Top",
                                            repetitionsMinimum = 5,
                                            repetitionsMaximum = 5,
                                            loadStrategy = "RpeBasedEpley",
                                            directLoad = (decimal?)null,
                                            loadUnit = "Kilogram",
                                            percentageWorkingMax = (decimal?)null,
                                            targetRpe,
                                            targetRir = (decimal?)null,
                                            exertionDisplayPreference = "Rpe",
                                            restSeconds = 180,
                                            tempo = "3-1-1",
                                            coachNotes = "Crisp reps",
                                            manualLoadOverride = (decimal?)null,
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        };

    private static object AssignmentRequest(
        Guid enrollmentId,
        Guid templateVersionId,
        Guid exerciseId,
        Guid strengthMaxRecordId,
        decimal value,
        Guid idempotencyKey) => new
        {
            enrollmentId,
            templateVersionId,
            startDate = TenantToday(),
            kind = "Primary",
            loadUnit = "Kilogram",
            loadIncrement = 2.5m,
            loadRoundingMode = "Nearest",
            workingMaxes = new[]
            {
                new { exerciseId, strengthMaxRecordId, value, unit = "Kilogram" },
            },
            idempotencyKey,
        };

    private async Task AssertCompletedSetRejectsDirectMutationAsync(Guid setId)
    {
        await using var connection = new NpgsqlConnection(RequiredDatabaseConnection);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            "UPDATE training.\"WorkoutSetPerformances\" SET \"ActualRepetitions\" = 99 WHERE \"Id\" = @id";
        command.Parameters.AddWithValue("id", setId);
        var exception = await Assert.ThrowsExactlyAsync<PostgresException>(
            async () => await command.ExecuteNonQueryAsync());
        Assert.AreEqual("55000", exception.SqlState);
    }

    private static async Task RefreshCsrfAsync(HttpClient client)
    {
        var csrf = await client.GetFromJsonAsync<Csrf>("/api/auth/csrf")
            ?? throw new AssertFailedException("CSRF response was empty.");
        client.DefaultRequestHeaders.Remove("X-XSRF-TOKEN");
        client.DefaultRequestHeaders.Add("X-XSRF-TOKEN", csrf.Token);
    }

    private static void SetTenant(HttpClient client, Guid tenantId)
    {
        client.DefaultRequestHeaders.Remove("X-Tenant-Id");
        client.DefaultRequestHeaders.Add("X-Tenant-Id", tenantId.ToString());
    }

    private static DateOnly TenantToday()
    {
        var local = TimeZoneInfo.ConvertTime(
            DateTimeOffset.UtcNow,
            TimeZoneInfo.FindSystemTimeZoneById("Asia/Beirut"));
        return DateOnly.FromDateTime(local.DateTime);
    }

    private static string QueryValue(string url, string key)
    {
        var query = QueryHelpers.ParseQuery(new Uri(url).Query);
        return query.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value)
            ? value.ToString()
            : throw new AssertFailedException($"The URL does not contain query value '{key}'.");
    }

    private static async Task<T> RequiredJsonAsync<T>(HttpResponseMessage response) =>
        await response.Content.ReadFromJsonAsync<T>()
        ?? throw new AssertFailedException($"{typeof(T).Name} response was empty.");

    private static async Task AssertStatusAsync(HttpResponseMessage response, HttpStatusCode expected)
    {
        if (response.StatusCode == expected)
        {
            return;
        }

        Assert.Fail($"Expected {(int)expected}, received {(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
    }

    private WebApplicationFactory<Program> RequiredFactory =>
        factory ?? throw new InvalidOperationException("The test application is not initialized.");

    private string RequiredDatabaseConnection =>
        databaseConnection ?? throw new InvalidOperationException("The test database is not initialized.");

    private MutableTestClock RequiredTestClock =>
        testClock ?? throw new InvalidOperationException("The test clock is not initialized.");

    private TodayQueryCounter RequiredTodayQueryCounter =>
        RequiredFactory.Services.GetRequiredService<TodayQueryCounter>();

    private sealed record Csrf(string Token);
    private sealed record Registration(string? DevelopmentConfirmationUrl);
    private sealed record TenantMembership(Guid TenantId);
    private sealed record Invitation(string? DevelopmentActionUrl);
    private sealed record InvitationAcceptance(Guid TenantId, Guid ClientProfileId);
    private sealed record Product(Offer[] Offers);
    private sealed record Offer(Guid Id);
    private sealed record Enrollment(Guid Id, uint Version);
    private sealed record MediaAsset(Guid Id, string Status, uint Version);
    private sealed record MediaAccess(string Url, bool DownloadAllowed);
    private sealed record Exercise(Guid Id, uint Version);
    private sealed record StrengthMax(Guid Id, decimal Value);
    private sealed record TemplateVersion(Guid Id, Guid TemplateId);
    private sealed record TemplateSummary(Guid Id, uint Version);
    private sealed record TemplatePage(long Total, TemplateSummary[] Items);
    private sealed record WorkingMax(Guid Id, decimal Value);
    private sealed record Mesocycle(
        Guid Id,
        bool RevealAllWeeks,
        WorkingMax[] WorkingMaxes,
        Week[] Weeks,
        uint Version);
    private sealed record Week(Guid Id, bool? IsVisible, Session[] Sessions);
    private sealed record Session(Guid Id, ExercisePrescription[] Exercises);
    private sealed record ExercisePrescription(Guid ExerciseId, SetPrescription[] Sets);
    private sealed record SetPrescription(
        Guid Id,
        decimal? TargetRpe,
        decimal? UnroundedRecommendedLoad,
        decimal? PrescribedLoad);
    private sealed record ProgressionPreview(string PreviewHash, Week[] GeneratedWeeks);
    private sealed record TrainingDay(bool IsAllowed, string AccessReason, Workout[] Workouts);
    private sealed record Workout(
        Guid SessionId,
        Guid? WorkoutExecutionId,
        string? Status,
        ClientExercise[] Exercises,
        uint? ExecutionVersion);
    private sealed record ClientExercise(
        Guid? PerformanceId,
        Guid PrescribedExerciseId,
        Guid ActualExerciseId,
        bool WasSubstituted,
        Guid[] MediaAssetIds,
        ClientSet[] Sets);
    private sealed record ClientSet(
        Guid? PerformanceId,
        decimal? PrescribedLoad,
        decimal? ActualLoad,
        decimal? ActualRpe,
        decimal? ActualRir);
    private sealed record Execution(Guid Id, string Status, uint Version);
    private sealed record WorkoutSetSave(uint ExecutionVersion);
    private sealed record HistoryItem(decimal? Load, decimal? Volume, bool WasSubstituted);
    private sealed record HistoryPage(long Total, HistoryItem[] Items);

    private sealed class MutableTestClock(DateTimeOffset utcNow) : IClock
    {
        public DateTimeOffset UtcNow { get; private set; } = utcNow;

        public void Advance(TimeSpan duration) => UtcNow = UtcNow.Add(duration);

        public void Set(DateTimeOffset value) => UtcNow = value;
    }

    private sealed class TodayQueryCounter : DbCommandInterceptor
    {
        private readonly Lock sync = new();
        private readonly List<string> commands = [];

        public int Count
        {
            get
            {
                lock (sync)
                {
                    return commands.Count;
                }
            }
        }

        public IReadOnlyList<string> Commands
        {
            get
            {
                lock (sync)
                {
                    return commands.ToArray();
                }
            }
        }

        public void Reset()
        {
            lock (sync)
            {
                commands.Clear();
            }
        }

        public override InterceptionResult<DbDataReader> ReaderExecuting(
            DbCommand command,
            CommandEventData eventData,
            InterceptionResult<DbDataReader> result)
        {
            Record(command);
            return result;
        }

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command,
            CommandEventData eventData,
            InterceptionResult<DbDataReader> result,
            CancellationToken cancellationToken = default)
        {
            Record(command);
            return ValueTask.FromResult(result);
        }

        private void Record(DbCommand command)
        {
            lock (sync)
            {
                commands.Add(command.CommandText);
            }
        }
    }
}
