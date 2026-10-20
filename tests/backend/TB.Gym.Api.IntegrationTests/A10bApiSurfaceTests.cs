using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using TB.Gym.Infrastructure.Security;
using TB.Gym.SharedKernel;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// The audit's batch A10b, the API contract's surface: every state-changing route names a rate limit, a
/// person's authoring and logging counted in a bucket of its own (INV-10), and the routes no screen called
/// are gone (INV-12).
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private static readonly string[] A10bPolicies =
    [
        RateLimitPolicies.SensitiveWrite,
        RateLimitPolicies.RoutineWrite,
        RateLimitPolicies.MediaUpload,
        RateLimitPolicies.PublicAuthentication,
        RateLimitPolicies.PublicContact,
        RateLimitPolicies.ProviderWebhook,
    ];

    /// <summary>The modules Program.cs composes under the routine limit at the group level.</summary>
    private static readonly string[] A10bRoutineModules =
        ["/api/exercises", "/api/strength", "/api/training", "/api/nutrition", "/api/progress"];

    /// <summary>The routes of those modules that name a stricter policy of their own.</summary>
    private static readonly string[] A10bStricterRoutes =
        ["ExportOwnProgressPhotos", "RecordClientProgressPhoto", "RecordOwnProgressPhoto"];

    private static readonly string[] A10bRemovedRoutes =
    [
        "AddMealPlanTemplateVersion",
        "AddProgramTemplateVersion",
        "CreateMealPlanTemplate",
        "CreateProgramTemplate",
        "GetClientCheckInAssignment",
        "GetOwnCheckInAssignment",
        "PublishMealPlanTemplateVersion",
    ];

    [TestMethod]
    public void A10bEveryStateChangingRouteNamesARateLimit()
    {
        var routes = A10bApiRoutes();
        var writes = routes.Where(route => WriteRateLimiting.IsStateChanging(route.Metadata.GetMetadata<IHttpMethodMetadata>())).ToArray();

        // Every write names one of the API's policies; 91 of 159 named none (audit INV-10).
        CollectionAssert.AreEqual(
            Array.Empty<string>(),
            writes.Where(route => A10bPolicy(route) is not { } policy || !A10bPolicies.Contains(policy))
                .Select(A10bName)
                .ToArray());

        // The authoring and logging of the training and nutrition modules are limited at their group, so a
        // route added there later is limited too; only the photo routes name a stricter policy.
        var routine = writes.Where(route => A10bRoutineModules.Any(prefix =>
            route.RoutePattern.RawText!.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))).ToArray();
        Assert.IsGreaterThanOrEqualTo(70, routine.Length);
        CollectionAssert.AreEquivalent(
            A10bStricterRoutes,
            routine.Where(route => A10bPolicy(route) != RateLimitPolicies.RoutineWrite).Select(A10bName).ToArray());

        // The split ARCHITECTURE section 6 describes, route by route where it is not a module's group.
        foreach (var (name, policy) in new[]
        {
            ("SaveProgramDraft", RateLimitPolicies.RoutineWrite),
            ("RecordMyTrainingSet", RateLimitPolicies.RoutineWrite),
            ("RecordOwnNutritionChoice", RateLimitPolicies.RoutineWrite),
            ("RecordOwnBodyweight", RateLimitPolicies.RoutineWrite),
            ("CreateExercise", RateLimitPolicies.RoutineWrite),
            ("RecordStrengthMax", RateLimitPolicies.RoutineWrite),
            ("UpdateOwnClientIntake", RateLimitPolicies.RoutineWrite),
            ("UpdateCurrentWorkspace", RateLimitPolicies.RoutineWrite),
            ("UpdateOwnThemeMode", RateLimitPolicies.RoutineWrite),
            ("CreatePrivateMediaAccessBatch", RateLimitPolicies.RoutineWrite),
            ("RenameCheckInForm", RateLimitPolicies.SensitiveWrite),
            ("PublishCheckInFormVersion", RateLimitPolicies.SensitiveWrite),
            ("SendConversationMessage", RateLimitPolicies.SensitiveWrite),
            ("ReleaseClient", RateLimitPolicies.SensitiveWrite),
            ("RecordOwnProgressPhoto", RateLimitPolicies.MediaUpload),
            ("Login", RateLimitPolicies.PublicAuthentication),
        })
        {
            Assert.AreEqual(policy, A10bPolicy(writes.Single(route => A10bName(route) == name)), name);
        }

        // A read never counts against a write bucket.
        CollectionAssert.AreEqual(
            Array.Empty<string>(),
            routes.Except(writes)
                .Where(route => A10bPolicy(route) is RateLimitPolicies.SensitiveWrite or RateLimitPolicies.RoutineWrite or RateLimitPolicies.MediaUpload)
                .Select(A10bName)
                .ToArray());
    }

    /// <summary>
    /// A person's routine writes are counted in a bucket of their own: 300 in a window (an hour for this
    /// test, see InitializeAsync), then 429 with the wait, whichever module the write is in. Their reads,
    /// their sensitive writes and another person's writes are not counted in it.
    /// </summary>
    [TestMethod]
    public async Task A10bRoutineWritesAreLimitedPerPersonInABucketOfTheirOwn()
    {
        using var owner = CreateClient();
        await RegisterCoachAsync(owner, "a10b-routine-owner@example.test", "Hicham Haddad", "A10b Routine");
        using var coach = CreateClient();
        await JoinAsCoachAsync(owner, coach, "a10b-routine-coach@example.test", "Lina Saad");
        var squat = await CreateExerciseAsync(owner, "Back squat", [], []);
        var preview = P1Request(P1Week(squat.Id, P1Set(1, "RpeChart")), 1);

        // Signing up made no routine write and the exercise made one. A preview saves nothing, but it is a
        // POST and counts like any write.
        var accepted = 1;
        HttpResponseMessage? refused = null;
        await RefreshCsrfAsync(owner);
        while (refused is null && accepted <= 300)
        {
            var response = await owner.PostAsJsonAsync(P1PreviewUrl, preview);
            if (response.StatusCode == HttpStatusCode.TooManyRequests)
            {
                refused = response;
            }
            else
            {
                await AssertStatusAsync(response, HttpStatusCode.OK);
                accepted++;
            }
        }

        Assert.IsNotNull(refused, "The 301st routine write in the window must be refused.");
        Assert.AreEqual(300, accepted, "No person's ordinary work reaches 300 writes in a minute.");
        Assert.IsGreaterThan(TimeSpan.Zero, refused.Headers.RetryAfter?.Delta ?? TimeSpan.Zero);
        Assert.AreEqual("too_many_requests", (await RequiredJsonAsync<A10bRefusal>(refused)).Code);

        // One bucket for the person, whichever module the write is in.
        await RefreshCsrfAsync(owner);
        await AssertStatusAsync(
            await owner.PutAsJsonAsync("/api/auth/me/theme", new { mode = "dark" }),
            HttpStatusCode.TooManyRequests);

        // Their reads and their sensitive writes are not counted in it, and another person's writes are theirs.
        await AssertStatusAsync(await owner.GetAsync("/api/exercises"), HttpStatusCode.OK);
        await Phase6CreateFormAsync(owner, "Weekly check-in", Phase6ShortText("How was your week?"));
        await AssertStatusAsync(await P1PreviewAsync(coach, preview), HttpStatusCode.OK);
    }

    /// <summary>
    /// A program or a meal plan is made only by publishing a draft (TRN-024, NUT-013), and one check-in
    /// assignment is read with its response: the direct routes no screen called answer as routes that do
    /// not exist, 405 where the path still has a read (audit INV-12).
    /// </summary>
    [TestMethod]
    public async Task A10bTheRoutesNoScreenCalledAreGone()
    {
        using var owner = CreateClient();
        await RegisterCoachAsync(owner, "a10b-gone-owner@example.test", "Hicham Haddad", "A10b Gone");
        var id = Guid.NewGuid();
        foreach (var (method, url, status) in new[]
        {
            (HttpMethod.Post, "/api/training/templates", HttpStatusCode.MethodNotAllowed),
            (HttpMethod.Post, $"/api/training/templates/{id}/versions", HttpStatusCode.NotFound),
            (HttpMethod.Post, "/api/nutrition/meal-plans", HttpStatusCode.MethodNotAllowed),
            (HttpMethod.Post, $"/api/nutrition/meal-plans/{id}/versions", HttpStatusCode.NotFound),
            (HttpMethod.Post, $"/api/nutrition/meal-plan-versions/{id}/publish", HttpStatusCode.NotFound),
            (HttpMethod.Get, $"/api/checkins/clients/{id}/assignments/{Guid.NewGuid()}", HttpStatusCode.NotFound),
            (HttpMethod.Get, $"/api/checkins/me/assignments/{id}", HttpStatusCode.NotFound),
        })
        {
            await RefreshCsrfAsync(owner);
            using var request = new HttpRequestMessage(method, url);
            if (method == HttpMethod.Post)
            {
                request.Content = JsonContent.Create(new { });
            }

            Assert.AreEqual(status, (await owner.SendAsync(request)).StatusCode, $"{method} {url}");
        }

        var names = A10bApiRoutes().Select(A10bName).ToHashSet(StringComparer.Ordinal);
        Assert.IsEmpty(A10bRemovedRoutes.Where(names.Contains).ToArray());
    }

    private RouteEndpoint[] A10bApiRoutes() =>
        RequiredFactory.Services.GetRequiredService<EndpointDataSource>().Endpoints
            .OfType<RouteEndpoint>()
            .Where(route => route.RoutePattern.RawText?.StartsWith("/api/", StringComparison.OrdinalIgnoreCase) == true)
            .ToArray();

    /// <summary>The policy the limiter reads for a route: the last one it carries.</summary>
    private static string? A10bPolicy(RouteEndpoint route) =>
        route.Metadata.GetMetadata<EnableRateLimitingAttribute>()?.PolicyName;

    private static string A10bName(RouteEndpoint route) =>
        route.Metadata.GetMetadata<IEndpointNameMetadata>()?.EndpointName ?? route.DisplayName ?? route.RoutePattern.RawText!;

    private sealed record A10bRefusal(string Code, string Message);
}
