using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Npgsql;
using TB.Gym.Modules.Media;

namespace TB.Gym.Api.IntegrationTests;

public sealed partial class Phase3TrainingWorkflowTests
{
    [TestMethod]
    public async Task TodayReadModelUsesBoundedDateFilteredQueries()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(
            coach,
            "today-query-coach@example.test",
            "Today Query Coach",
            "Today Query Workspace");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(
            coach,
            client,
            "today-query-client@example.test",
            newAccount: true);
        SetTenant(client, workspaceId);
        var resources = await CreateTrainingResourcesAsync(coach, clientId, 8, 1, TenantToday());
        await AssignAsync(coach, clientId, resources, TenantToday());

        var counter = RequiredTodayQueryCounter;
        counter.Reset();
        var response = await client.GetAsync("/api/training/me/today");
        await AssertStatusAsync(response, HttpStatusCode.OK);

        Console.WriteLine($"Phase 3 /today SQL command count: {counter.Count}");
        Assert.IsLessThanOrEqualTo(24, counter.Count, "The athlete read model exceeded its bounded query budget.");
        Assert.IsTrue(counter.Commands.Any(command =>
            command.Contains("\"ScheduledDate\"", StringComparison.Ordinal) &&
            command.Contains("\"ClientProfileId\"", StringComparison.Ordinal)),
            "The schedule query did not push client/date filtering into PostgreSQL.");
    }

    [TestMethod]
    public async Task MesocycleLifecycleCancellationReleasesDatesAndPreservesHistory()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(
            coach,
            "lifecycle-coach@example.test",
            "Lifecycle Coach",
            "Lifecycle Workspace");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(
            coach,
            client,
            "lifecycle-client@example.test",
            newAccount: true);
        SetTenant(client, workspaceId);
        var resources = await CreateTrainingResourcesAsync(coach, clientId, 8, 1, TenantToday());

        var assigned = await AssignAsync(coach, clientId, resources, TenantToday());
        await RefreshCsrfAsync(coach);
        var cancelResponse = await coach.PostAsJsonAsync(
            $"/api/training/mesocycles/{assigned.Id}/cancel",
            new { reason = "Assigned the wrong block", assigned.Version });
        await AssertStatusAsync(cancelResponse, HttpStatusCode.OK);
        var cancelled = await RequiredJsonAsync<LifecycleMesocycle>(cancelResponse);
        Assert.AreEqual("Cancelled", cancelled.Status);
        Assert.IsTrue(cancelled.Lifecycle.Any(item =>
            item.EventType == "Cancelled" && item.Reason == "Assigned the wrong block"));

        var replacement = await AssignAsync(coach, clientId, resources, TenantToday());
        Assert.AreNotEqual(cancelled.Id, replacement.Id);

        var history = await coach.GetFromJsonAsync<MesocycleHistoryItem[]>(
            $"/api/training/clients/{clientId}/mesocycles")
            ?? throw new AssertFailedException("Mesocycle history was empty.");
        Assert.IsTrue(history.Any(item => item.Id == cancelled.Id && item.Status == "Cancelled"));
        Assert.IsTrue(history.Any(item => item.Id == replacement.Id));

        await RefreshCsrfAsync(coach);
        var repeatedCancellation = await coach.PostAsJsonAsync(
            $"/api/training/mesocycles/{cancelled.Id}/cancel",
            new { reason = "Retry", cancelled.Version });
        Assert.AreEqual(HttpStatusCode.Conflict, repeatedCancellation.StatusCode);

        await RefreshCsrfAsync(coach);
        var prematureCompletion = await coach.PostAsJsonAsync(
            $"/api/training/mesocycles/{replacement.Id}/complete",
            new { replacement.Version });
        Assert.AreEqual(HttpStatusCode.Conflict, prematureCompletion.StatusCode);

        using var foreignCoach = CreateClient();
        await RegisterCoachAsync(
            foreignCoach,
            "lifecycle-foreign@example.test",
            "Foreign Coach",
            "Foreign Workspace");
        await RefreshCsrfAsync(foreignCoach);
        var foreignCancellation = await foreignCoach.PostAsJsonAsync(
            $"/api/training/mesocycles/{replacement.Id}/cancel",
            new { reason = "Cross-tenant attempt", replacement.Version });
        Assert.AreEqual(HttpStatusCode.NotFound, foreignCancellation.StatusCode);
    }

    [TestMethod]
    public async Task ProgressionCoverageRejectsWithoutMutationAndAllowsExactBoundary()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(
            coach,
            "coverage-coach@example.test",
            "Coverage Coach",
            "Coverage Workspace");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(
            coach,
            client,
            "coverage-client@example.test",
            newAccount: true);
        var resources = await CreateTrainingResourcesAsync(coach, clientId, 12, 8, TenantToday());
        var mesocycle = await AssignAsync(coach, clientId, resources, TenantToday());
        var sourceWeekId = mesocycle.Weeks[0].Id;

        var outside = await PreviewProgressionAsync(coach, mesocycle, sourceWeekId, 6);
        Assert.IsFalse(outside.IsInsideTrainingCoverage);
        Assert.AreEqual(14, outside.ResultingWeekCount);

        await RefreshCsrfAsync(coach);
        var rejectedApply = await coach.PostAsJsonAsync(
            $"/api/training/mesocycles/{mesocycle.Id}/progression/apply",
            ProgressionApplyRequest(mesocycle, sourceWeekId, 6, outside.PreviewHash));
        Assert.AreEqual(HttpStatusCode.BadRequest, rejectedApply.StatusCode);
        mesocycle = await GetMesocycleAsync(coach, mesocycle.Id);
        Assert.HasCount(8, mesocycle.Weeks);

        var exact = await PreviewProgressionAsync(coach, mesocycle, sourceWeekId, 4);
        Assert.IsTrue(exact.IsInsideTrainingCoverage);
        Assert.AreEqual(resources.Enrollment.EndDateExclusive, exact.ResultingEndDateExclusive);

        await RefreshCsrfAsync(coach);
        var malformedApply = await coach.PostAsJsonAsync(
            $"/api/training/mesocycles/{mesocycle.Id}/progression/apply",
            ProgressionApplyRequest(mesocycle, sourceWeekId, 4, null!));
        Assert.AreEqual(HttpStatusCode.Conflict, malformedApply.StatusCode);

        await RefreshCsrfAsync(coach);
        var visibility = await coach.PutAsJsonAsync(
            $"/api/training/mesocycles/{mesocycle.Id}/visibility",
            new { revealAllWeeks = true, mesocycle.Version });
        await AssertStatusAsync(visibility, HttpStatusCode.OK);
        var changed = await RequiredJsonAsync<ScenarioMesocycle>(visibility);

        await RefreshCsrfAsync(coach);
        var staleApply = await coach.PostAsJsonAsync(
            $"/api/training/mesocycles/{mesocycle.Id}/progression/apply",
            ProgressionApplyRequest(mesocycle, sourceWeekId, 4, exact.PreviewHash));
        Assert.AreEqual(HttpStatusCode.Conflict, staleApply.StatusCode);

        var fresh = await PreviewProgressionAsync(coach, changed, sourceWeekId, 4);
        await RefreshCsrfAsync(coach);
        var validRequest = ProgressionApplyRequest(changed, sourceWeekId, 4, fresh.PreviewHash);
        var validApply = await coach.PostAsJsonAsync(
            $"/api/training/mesocycles/{mesocycle.Id}/progression/apply",
            validRequest);
        await AssertStatusAsync(validApply, HttpStatusCode.OK);
        var completedBoundary = await RequiredJsonAsync<ScenarioMesocycle>(validApply);
        Assert.HasCount(12, completedBoundary.Weeks);
        Assert.AreEqual(resources.Enrollment.EndDateExclusive, completedBoundary.EndDateExclusive);

        await RefreshCsrfAsync(coach);
        var repeatedApply = await coach.PostAsJsonAsync(
            $"/api/training/mesocycles/{mesocycle.Id}/progression/apply",
            validRequest);
        Assert.AreEqual(HttpStatusCode.Conflict, repeatedApply.StatusCode);
    }

    [TestMethod]
    public async Task ConcurrentOverlapRaceRejectsOneWriterAndAdjacentBoundarySucceeds()
    {
        using var coach = CreateClient();
        await RegisterCoachAsync(
            coach,
            "overlap-coach@example.test",
            "Overlap Coach",
            "Overlap Workspace");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(
            coach,
            client,
            "overlap-client@example.test",
            newAccount: true);
        var start = TenantToday();
        var resources = await CreateTrainingResourcesAsync(coach, clientId, 12, 4, start);

        await RefreshCsrfAsync(coach);
        var concurrent = await Task.WhenAll(
            coach.PostAsJsonAsync(
                $"/api/training/clients/{clientId}/mesocycles",
                AssignmentRequestAt(resources, start, Guid.NewGuid())),
            coach.PostAsJsonAsync(
                $"/api/training/clients/{clientId}/mesocycles",
                AssignmentRequestAt(resources, start, Guid.NewGuid())));
        Assert.AreEqual(1, concurrent.Count(item => item.StatusCode == HttpStatusCode.OK));
        Assert.AreEqual(1, concurrent.Count(item => item.StatusCode == HttpStatusCode.Conflict));

        var adjacentStart = start.AddDays(28);
        await RefreshCsrfAsync(coach);
        var adjacent = await coach.PostAsJsonAsync(
            $"/api/training/clients/{clientId}/mesocycles",
            AssignmentRequestAt(resources, adjacentStart, Guid.NewGuid()));
        await AssertStatusAsync(adjacent, HttpStatusCode.OK);
        var adjacentMesocycle = await RequiredJsonAsync<ScenarioMesocycle>(adjacent);
        Assert.AreEqual(adjacentStart, adjacentMesocycle.StartDate);
    }

    [TestMethod]
    public async Task PrivateMediaGrantEnforcesBrowserAuthorizationExpiryAndHistoricalSnapshot()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(
            coach,
            "media-coach@example.test",
            "Media Coach",
            "Media Workspace");
        using var client = CreateInspectableClient(out var cookies);
        var clientId = await InviteAndAcceptAsync(
            coach,
            client,
            "media-client@example.test",
            newAccount: true);
        SetTenant(client, workspaceId);
        var resources = await CreateTrainingResourcesAsync(
            coach,
            clientId,
            8,
            1,
            TenantToday(),
            includeMedia: true);
        await AssignAsync(coach, clientId, resources, TenantToday());

        var currentExercise = await coach.GetFromJsonAsync<Exercise>(
            $"/api/exercises/{resources.Exercise.Id}")
            ?? throw new AssertFailedException("Exercise response was empty.");
        await using (var versionConnection = new NpgsqlConnection(RequiredDatabaseConnection))
        {
            await versionConnection.OpenAsync();
            await using var versionCommand = versionConnection.CreateCommand();
            versionCommand.CommandText =
                "SELECT xmin::text::bigint FROM exercise_library.\"Exercises\" WHERE \"Id\" = @id";
            versionCommand.Parameters.AddWithValue("id", resources.Exercise.Id);
            var databaseVersion = Convert.ToUInt32(
                await versionCommand.ExecuteScalarAsync(),
                System.Globalization.CultureInfo.InvariantCulture);
            Assert.AreEqual(databaseVersion, currentExercise.Version, "Exercise GET returned a stale xmin token.");
        }
        await RefreshCsrfAsync(coach);
        var detachResponse = await coach.PutAsJsonAsync(
            $"/api/exercises/{resources.Exercise.Id}",
            new
            {
                name = "Snapshot squat",
                instructions = "Updated after assignment.",
                equipment = "Barbell",
                movementPattern = "Squat",
                classification = "Strength",
                muscles = new[] { new { muscle = "Quadriceps", role = "Primary" } },
                tags = ExerciseTags,
                alternatives = new[]
                {
                    new { exerciseId = resources.Alternative.Id, note = "Coach-approved" },
                },
                mediaAssetIds = Array.Empty<Guid>(),
                currentExercise.Version,
            });
        await AssertStatusAsync(detachResponse, HttpStatusCode.OK);

        await RefreshCsrfAsync(coach);
        var deleteResponse = await coach.SendAsync(new HttpRequestMessage(
            HttpMethod.Delete,
            $"/api/media/{resources.Media!.Id}")
        {
            Content = JsonContent.Create(new { resources.Media.Version }),
        });
        await AssertStatusAsync(deleteResponse, HttpStatusCode.OK);
        Assert.AreEqual("Tombstoned", (await RequiredJsonAsync<MediaAsset>(deleteResponse)).Status);

        var today = await client.GetFromJsonAsync<TrainingDay>("/api/training/me/today")
            ?? throw new AssertFailedException("Client training day was empty.");
        CollectionAssert.Contains(today.Workouts.Single().Exercises.Single().MediaAssetIds, resources.Media.Id);

        var access = await CreateMediaAccessAsync(client, resources.Media.Id);
        client.DefaultRequestHeaders.Remove("X-Tenant-Id");
        await AssertStatusAsync(await client.GetAsync(access.Url), HttpStatusCode.OK);

        var contentUri = new Uri(client.BaseAddress!, access.Url);
        var validGrant = RequiredMediaGrant(cookies, contentUri).Value;
        ReplaceMediaGrant(cookies, contentUri, validGrant + "tampered");
        Assert.AreEqual(HttpStatusCode.Forbidden, (await client.GetAsync(access.Url)).StatusCode);

        SetTenant(client, workspaceId);
        access = await CreateMediaAccessAsync(client, resources.Media.Id);
        contentUri = new Uri(client.BaseAddress!, access.Url);
        validGrant = RequiredMediaGrant(cookies, contentUri).Value;
        // Expiry is evaluated server-side against IClock, so advancing the test clock past the
        // configured lifetime proves rejection without any real waiting. The grant is re-attached
        // explicitly because the assertion must exercise the server check, not cookie eviction.
        RequiredTestClock.Advance(TimeSpan.FromSeconds(MediaAccessLifetimeSeconds + 1));
        ReplaceMediaGrant(cookies, contentUri, validGrant);
        client.DefaultRequestHeaders.Remove("X-Tenant-Id");
        Assert.AreEqual(HttpStatusCode.Forbidden, (await client.GetAsync(access.Url)).StatusCode);

        // Issuing a fresh grant re-syncs the clock, and that grant must work again: the rejection
        // above was the elapsed lifetime, not a permanently poisoned session or asset.
        SetTenant(client, workspaceId);
        access = await CreateMediaAccessAsync(client, resources.Media.Id);
        client.DefaultRequestHeaders.Remove("X-Tenant-Id");
        await AssertStatusAsync(await client.GetAsync(access.Url), HttpStatusCode.OK);

        SetTenant(client, workspaceId);
        access = await CreateMediaAccessAsync(client, resources.Media.Id);
        await RefreshCsrfAsync(coach);
        var pause = await coach.PostAsJsonAsync(
            $"/api/commercial/enrollments/{resources.Enrollment.Id}/pause",
            new { reason = "Revoke media entitlement", resources.Enrollment.Version });
        await AssertStatusAsync(pause, HttpStatusCode.OK);
        client.DefaultRequestHeaders.Remove("X-Tenant-Id");
        Assert.AreEqual(HttpStatusCode.Forbidden, (await client.GetAsync(access.Url)).StatusCode);

        using var unassignedClient = CreateClient();
        await InviteAndAcceptAsync(
            coach,
            unassignedClient,
            "media-unassigned@example.test",
            newAccount: true);
        await RefreshCsrfAsync(unassignedClient);
        Assert.AreEqual(
            HttpStatusCode.Forbidden,
            (await unassignedClient.PostAsync($"/api/media/{resources.Media.Id}/access", null)).StatusCode);

        using var foreignCoach = CreateClient();
        await RegisterCoachAsync(
            foreignCoach,
            "media-foreign@example.test",
            "Media Foreign",
            "Media Foreign Workspace");
        await RefreshCsrfAsync(foreignCoach);
        Assert.AreEqual(
            HttpStatusCode.NotFound,
            (await foreignCoach.PostAsync($"/api/media/{resources.Media.Id}/access", null)).StatusCode);
    }

    [TestMethod]
    public async Task MultiWorkspaceClientWorkoutNotesRemainTenantScoped()
    {
        using var coachA = CreateClient();
        var workspaceA = await RegisterCoachAsync(
            coachA,
            "notes-coach-a@example.test",
            "Notes Coach A",
            "Notes Workspace A");
        using var sharedClient = CreateClient();
        var clientA = await InviteAndAcceptAsync(
            coachA,
            sharedClient,
            "notes-shared@example.test",
            newAccount: true);
        var resourcesA = await CreateTrainingResourcesAsync(coachA, clientA, 8, 1, TenantToday());
        await AssignAsync(coachA, clientA, resourcesA, TenantToday());

        using var coachB = CreateClient();
        var workspaceB = await RegisterCoachAsync(
            coachB,
            "notes-coach-b@example.test",
            "Notes Coach B",
            "Notes Workspace B");
        var clientB = await InviteAndAcceptAsync(
            coachB,
            sharedClient,
            "notes-shared@example.test",
            newAccount: false);
        var resourcesB = await CreateTrainingResourcesAsync(coachB, clientB, 8, 1, TenantToday());
        await AssignAsync(coachB, clientB, resourcesB, TenantToday());

        await AddClientWorkoutNoteAsync(sharedClient, workspaceA, "Workspace A note");
        await AddClientWorkoutNoteAsync(sharedClient, workspaceB, "Workspace B note");

        SetTenant(sharedClient, workspaceA);
        var dayA = await sharedClient.GetFromJsonAsync<NoteTrainingDay>("/api/training/me/today")
            ?? throw new AssertFailedException("Workspace A training day was empty.");
        Assert.IsTrue(dayA.Workouts.Single().Notes.Any(item =>
            item.Text == "Workspace A note" && item.AuthorRole == "Client"));
        Assert.IsFalse(dayA.Workouts.Single().Notes.Any(item => item.Text == "Workspace B note"));

        SetTenant(sharedClient, workspaceB);
        var dayB = await sharedClient.GetFromJsonAsync<NoteTrainingDay>("/api/training/me/today")
            ?? throw new AssertFailedException("Workspace B training day was empty.");
        Assert.IsTrue(dayB.Workouts.Single().Notes.Any(item =>
            item.Text == "Workspace B note" && item.AuthorRole == "Client"));
        Assert.IsFalse(dayB.Workouts.Single().Notes.Any(item => item.Text == "Workspace A note"));
    }

    [TestMethod]
    public async Task EntitlementExpiryIsDateAuthoritativeMidProgram()
    {
        using var coach = CreateClient();
        var workspaceId = await RegisterCoachAsync(
            coach,
            "expiry-coach@example.test",
            "Expiry Coach",
            "Expiry Workspace");
        using var client = CreateClient();
        var clientId = await InviteAndAcceptAsync(
            coach,
            client,
            "expiry-client@example.test",
            newAccount: true);
        SetTenant(client, workspaceId);
        var start = TenantToday().AddDays(-1);
        var resources = await CreateTrainingResourcesAsync(coach, clientId, 8, 1, start);
        await AssignAsync(coach, clientId, resources, start);

        var before = await client.GetFromJsonAsync<TrainingDay>("/api/training/me/today")
            ?? throw new AssertFailedException("Pre-expiry training response was empty.");
        Assert.IsTrue(before.IsAllowed);

        RequiredTestClock.Advance(TimeSpan.FromDays(57));

        var after = await client.GetFromJsonAsync<TrainingDay>("/api/training/me/today")
            ?? throw new AssertFailedException("Expired training response was empty.");
        Assert.IsFalse(after.IsAllowed);
        Assert.AreEqual("Expired", after.AccessReason);
    }

    private static async Task<TrainingResources> CreateTrainingResourcesAsync(
        HttpClient coach,
        Guid clientId,
        int durationWeeks,
        int templateWeeks,
        DateOnly startDate,
        bool includeMedia = false)
    {
        var enrollment = await CreateTrainingEnrollmentAsync(coach, clientId, startDate, durationWeeks);
        var media = includeMedia ? await UploadJpegAsync(coach) : null;
        var alternative = await CreateExerciseAsync(coach, "Scenario alternative", [], []);
        var exercise = await CreateExerciseAsync(
            coach,
            includeMedia ? "Snapshot squat" : "Scenario squat",
            [alternative.Id],
            media is null ? [] : [media.Id]);
        var max = await RecordWorkingMaxAsync(coach, clientId, exercise.Id, 100m);
        var template = await CreateTemplateWithWeeksAsync(
            coach,
            exercise.Id,
            alternative.Id,
            templateWeeks);
        return new TrainingResources(enrollment, media, alternative, exercise, max, template);
    }

    private static async Task<CoverageEnrollment> CreateTrainingEnrollmentAsync(
        HttpClient coach,
        Guid clientId,
        DateOnly startDate,
        int durationWeeks)
    {
        await RefreshCsrfAsync(coach);
        var productResponse = await coach.PostAsJsonAsync("/api/commercial/products", new
        {
            name = $"{durationWeeks}-week training",
            description = "Focused Phase 3 scenario",
            initialOffer = new
            {
                label = $"{durationWeeks} weeks",
                durationCount = durationWeeks,
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
        return await RequiredJsonAsync<CoverageEnrollment>(enrollmentResponse);
    }

    private static async Task<TemplateVersion> CreateTemplateWithWeeksAsync(
        HttpClient coach,
        Guid exerciseId,
        Guid alternativeId,
        int weekCount)
    {
        var weeks = Enumerable.Range(1, weekCount).Select(week => new
        {
            label = $"Week {week}",
            isPublished = true,
            sessions = new[]
            {
                new
                {
                    name = $"Squat day {week}",
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
                            coachNotes = "Controlled technique.",
                            approvedAlternativeExerciseIds = new[] { alternativeId },
                            sets = new[]
                            {
                                new
                                {
                                    position = 0,
                                    setType = "Normal",
                                    repetitionsMinimum = 5,
                                    repetitionsMaximum = 5,
                                    loadStrategy = "RpeBasedEpley",
                                    directLoad = (decimal?)null,
                                    loadUnit = "Kilogram",
                                    percentageWorkingMax = (decimal?)null,
                                    targetRpe = 8m,
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
        }).ToArray();
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync("/api/training/templates", new
        {
            name = $"{weekCount}-week scenario",
            description = "Focused Phase 3 scenario",
            publish = true,
            templateVersion = (uint?)null,
            weeks,
        });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<TemplateVersion>(response);
    }

    private static object AssignmentRequestAt(
        TrainingResources resources,
        DateOnly startDate,
        Guid idempotencyKey) => new
        {
            enrollmentId = resources.Enrollment.Id,
            templateVersionId = resources.Template.Id,
            startDate,
            kind = "Primary",
            loadUnit = "Kilogram",
            loadIncrement = 2.5m,
            loadRoundingMode = "Nearest",
            workingMaxes = new[]
            {
                new
                {
                    exerciseId = resources.Exercise.Id,
                    strengthMaxRecordId = resources.Max.Id,
                    value = 100m,
                    unit = "Kilogram",
                },
            },
            idempotencyKey,
        };

    private static async Task<ScenarioMesocycle> AssignAsync(
        HttpClient coach,
        Guid clientId,
        TrainingResources resources,
        DateOnly startDate)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync(
            $"/api/training/clients/{clientId}/mesocycles",
            AssignmentRequestAt(resources, startDate, Guid.NewGuid()));
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<ScenarioMesocycle>(response);
    }

    private static async Task<CoveragePreview> PreviewProgressionAsync(
        HttpClient coach,
        ScenarioMesocycle mesocycle,
        Guid sourceWeekId,
        int iterations)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync(
            $"/api/training/mesocycles/{mesocycle.Id}/progression/preview",
            new
            {
                sourceWeekIds = new[] { sourceWeekId },
                iterations,
                rpeIncrement = 0m,
                mesocycleVersion = mesocycle.Version,
            });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<CoveragePreview>(response);
    }

    private static object ProgressionApplyRequest(
        ScenarioMesocycle mesocycle,
        Guid sourceWeekId,
        int iterations,
        string previewHash) => new
        {
            sourceWeekIds = new[] { sourceWeekId },
            iterations,
            rpeIncrement = 0m,
            previewHash,
            mesocycleVersion = mesocycle.Version,
        };

    private static async Task<ScenarioMesocycle> GetMesocycleAsync(HttpClient coach, Guid id) =>
        await coach.GetFromJsonAsync<ScenarioMesocycle>($"/api/training/mesocycles/{id}")
        ?? throw new AssertFailedException("Mesocycle response was empty.");

    private async Task<MediaAccess> CreateMediaAccessAsync(HttpClient client, Guid mediaId)
    {
        RequiredTestClock.Set(DateTimeOffset.UtcNow);
        await RefreshCsrfAsync(client);
        var response = await client.PostAsync($"/api/media/{mediaId}/access", null);
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<MediaAccess>(response);
    }

    private static async Task AddClientWorkoutNoteAsync(HttpClient client, Guid workspaceId, string text)
    {
        SetTenant(client, workspaceId);
        var day = await client.GetFromJsonAsync<TrainingDay>("/api/training/me/today")
            ?? throw new AssertFailedException("Training day was empty.");
        await RefreshCsrfAsync(client);
        var start = await client.PostAsync(
            $"/api/training/me/sessions/{day.Workouts.Single().SessionId}/start",
            null);
        await AssertStatusAsync(start, HttpStatusCode.OK);
        var execution = await RequiredJsonAsync<Execution>(start);
        await RefreshCsrfAsync(client);
        var note = await client.PostAsJsonAsync(
            $"/api/training/workouts/{execution.Id}/notes",
            new { exercisePerformanceId = (Guid?)null, text });
        await AssertStatusAsync(note, HttpStatusCode.OK);
    }

    private HttpClient CreateInspectableClient(out CookieContainer cookies)
    {
        cookies = new CookieContainer();
        var client = RequiredFactory.CreateDefaultClient(new TrackingCookieHandler(cookies));
        client.BaseAddress = new Uri("http://localhost");
        return client;
    }

    private static Cookie RequiredMediaGrant(CookieContainer cookies, Uri contentUri) =>
        cookies.GetCookies(contentUri)[MediaAccessCookie.Name]
        ?? throw new AssertFailedException("The media access cookie was not issued.");

    private static void ReplaceMediaGrant(CookieContainer cookies, Uri contentUri, string value) =>
        cookies.Add(contentUri, new Cookie(
            MediaAccessCookie.Name,
            value,
            MediaAccessCookie.Path(Guid.Parse(contentUri.Segments[^2].TrimEnd('/'))))
        {
            Expires = DateTime.UtcNow.AddMinutes(5),
        });

    private sealed class TrackingCookieHandler(CookieContainer cookies) : DelegatingHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            var uri = request.RequestUri ?? throw new InvalidOperationException("Request URI is required.");
            var cookieHeader = cookies.GetCookieHeader(uri);
            if (!string.IsNullOrEmpty(cookieHeader))
            {
                request.Headers.TryAddWithoutValidation("Cookie", cookieHeader);
            }

            var response = await base.SendAsync(request, cancellationToken);
            if (response.Headers.TryGetValues("Set-Cookie", out var values))
            {
                foreach (var value in values)
                {
                    cookies.SetCookies(uri, value);
                }
            }

            return response;
        }
    }

    private sealed record TrainingResources(
        CoverageEnrollment Enrollment,
        MediaAsset? Media,
        Exercise Alternative,
        Exercise Exercise,
        StrengthMax Max,
        TemplateVersion Template);

    private sealed record CoverageEnrollment(Guid Id, DateOnly EndDateExclusive, uint Version);
    private sealed record ScenarioMesocycle(
        Guid Id,
        DateOnly StartDate,
        DateOnly EndDateExclusive,
        string Status,
        ScenarioWeek[] Weeks,
        uint Version);
    private sealed record ScenarioWeek(Guid Id);
    private sealed record LifecycleMesocycle(
        Guid Id,
        string Status,
        LifecycleEvent[] Lifecycle,
        uint Version);
    private sealed record LifecycleEvent(string EventType, string Reason);
    private sealed record MesocycleHistoryItem(Guid Id, string Status);
    private sealed record CoveragePreview(
        string PreviewHash,
        int ResultingWeekCount,
        DateOnly ResultingEndDateExclusive,
        bool IsInsideTrainingCoverage);
    private sealed record NoteTrainingDay(NoteWorkout[] Workouts);
    private sealed record NoteWorkout(WorkoutNote[] Notes);
    private sealed record WorkoutNote(string AuthorRole, string Text);
}
