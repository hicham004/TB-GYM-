using System.Net;
using System.Net.Http.Json;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Shared fixtures for the Phase 6A-1 check-in tests. Every date comes from the injected clock in the
/// workspace time zone, never from the machine clock.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private static readonly string[] EnergyOptions = ["Low", "Steady", "High"];
    private static readonly string[] ExtendedEnergyOptions = ["Low", "Steady", "High", "Excellent"];
    private static readonly string[] EquipmentOptions = ["Barbell", "Dumbbell"];
    private static readonly string[] ExpectedQuestionTypes =
        ["ShortText", "LongText", "SingleChoice", "MultipleChoice", "NumericScale"];
    private static readonly int[] ExpectedAssignedVersions = [1, 2];
    private static readonly string[] RacingEdits = ["Edit A.", "Edit B."];

    /// <summary>
    /// Today in the workspace time zone as the API itself computes it: the pinned test clock resolved
    /// through Asia/Beirut. Using the machine clock here would make due-date assertions drift.
    /// </summary>
    private DateOnly Phase6WorkspaceToday() =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(
            RequiredTestClock.UtcNow,
            TimeZoneInfo.FindSystemTimeZoneById("Asia/Beirut")).DateTime);

    private static async Task<Phase6FormDetails> Phase6CreateFormAsync(
        HttpClient coach,
        string title,
        params object[] questions)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync(
            "/api/checkins/forms",
            new { title, description = "Sent every Monday.", questions });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<Phase6FormDetails>(response);
    }

    private static async Task<Phase6Version> Phase6PublishAsync(
        HttpClient coach,
        Guid formId,
        Phase6VersionSummary version)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync(
            $"/api/checkins/forms/{formId}/versions/{version.Id}/publish",
            new { version.Version });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<Phase6Version>(response);
    }

    private static async Task<Phase6Version> Phase6DeriveDraftAsync(
        HttpClient coach,
        Phase6FormDetails form,
        Guid sourceVersionId)
    {
        await RefreshCsrfAsync(coach);
        var response = await coach.PostAsJsonAsync(
            $"/api/checkins/forms/{form.Form.Id}/versions",
            new { sourceVersionId, formVersion = form.Form.Version });
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<Phase6Version>(response);
    }

    private static async Task<Phase6FormDetails> Phase6GetFormAsync(HttpClient coach, Guid formId)
    {
        var response = await coach.GetAsync($"/api/checkins/forms/{formId}");
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<Phase6FormDetails>(response);
    }

    private static async Task<HttpResponseMessage> Phase6AssignAsync(
        HttpClient coach,
        Guid clientId,
        Guid formVersionId,
        DateOnly dueDate)
    {
        await RefreshCsrfAsync(coach);
        return await coach.PostAsJsonAsync(
            $"/api/checkins/clients/{clientId}/assignments",
            new { formVersionId, dueDate });
    }

    /// <summary>
    /// A free enrollment covering the named coaching features, starting on the workspace's today so it
    /// is active immediately. Free offers activate without a payment, which keeps the entitlement
    /// under test rather than the payment workflow.
    /// </summary>
    private async Task<Guid> Phase6EnrollAsync(
        HttpClient coach,
        Guid clientId,
        string productName,
        params string[] features)
    {
        await RefreshCsrfAsync(coach);
        var productResponse = await coach.PostAsJsonAsync("/api/commercial/products", new
        {
            name = productName,
            description = "Phase 6A-1",
            initialOffer = new
            {
                label = "8 weeks",
                durationCount = 8,
                durationUnit = "Week",
                priceAmount = 0m,
                priceCurrency = "USD",
                features = features.Select(feature => new { feature, allowsConcurrentCoverage = false }).ToArray(),
            },
        });
        await AssertStatusAsync(productResponse, HttpStatusCode.OK);
        var product = await RequiredJsonAsync<Product>(productResponse);

        await RefreshCsrfAsync(coach);
        var enrollmentResponse = await coach.PostAsJsonAsync(
            $"/api/commercial/clients/{clientId}/enrollments",
            new
            {
                offerId = product.Offers[0].Id,
                startDate = Phase6WorkspaceToday(),
                idempotencyKey = Guid.NewGuid(),
            });
        await AssertStatusAsync(enrollmentResponse, HttpStatusCode.OK);
        return (await RequiredJsonAsync<Enrollment>(enrollmentResponse)).Id;
    }

    private static object Phase6ShortText(string prompt, string? questionKey = null) => new
    {
        questionType = "ShortText",
        prompt,
        isRequired = true,
        questionKey,
    };

    private static object Phase6LongText(string prompt, string? questionKey = null) => new
    {
        questionType = "LongText",
        prompt,
        isRequired = false,
        helpText = "Anything you want your coach to know.",
        questionKey,
    };

    private static object Phase6SingleChoice(
        string prompt,
        IReadOnlyList<string> options,
        string? questionKey = null) => new
    {
        questionType = "SingleChoice",
        prompt,
        isRequired = true,
        options,
        questionKey,
    };

    private static object Phase6MultipleChoice(
        string prompt,
        IReadOnlyList<string> options,
        string? questionKey = null) => new
    {
        questionType = "MultipleChoice",
        prompt,
        isRequired = false,
        options,
        questionKey,
    };

    private static object Phase6Scale(
        string prompt,
        decimal minimum,
        decimal maximum,
        decimal step,
        string? questionKey = null) => new
    {
        questionType = "NumericScale",
        prompt,
        isRequired = true,
        scaleMinimum = minimum,
        scaleMaximum = maximum,
        scaleStep = step,
        questionKey,
    };

    private sealed record Phase6Option(Guid Id, int Order, string Label);

    private sealed record Phase6Question(
        Guid Id,
        string QuestionKey,
        int Order,
        string QuestionType,
        string Prompt,
        string? HelpText,
        bool IsRequired,
        decimal? ScaleMinimum,
        decimal? ScaleMaximum,
        decimal? ScaleStep,
        Phase6Option[] Options);

    private sealed record Phase6Version(
        Guid Id,
        Guid FormId,
        string FormTitle,
        int VersionNumber,
        string Status,
        Guid? DerivedFromVersionId,
        DateTimeOffset? PublishedAtUtc,
        Guid? PublishedByUserId,
        Phase6Question[] Questions,
        uint Version);

    private sealed record Phase6VersionSummary(
        Guid Id,
        int VersionNumber,
        string Status,
        Guid? DerivedFromVersionId,
        int QuestionCount,
        uint Version);

    private sealed record Phase6Form(
        Guid Id,
        string Title,
        string? Description,
        string Status,
        bool IsArchived,
        int CurrentVersionNumber,
        Guid? DraftVersionId,
        Guid? LatestPublishedVersionId,
        int? LatestPublishedVersionNumber,
        uint Version);

    private sealed record Phase6FormDetails(Phase6Form Form, Phase6VersionSummary[] Versions);

    private sealed record Phase6FormPage(long Total, Phase6Form[] Items);

    private sealed record Phase6Assignment(
        Guid Id,
        Guid FormId,
        string FormTitle,
        Guid FormVersionId,
        int FormVersionNumber,
        Guid ClientProfileId,
        DateOnly DueDate,
        DateTimeOffset AssignedAtUtc,
        Guid? AssignedByUserId);

    private sealed record Phase6AssignmentDetail(Phase6Assignment Assignment, Phase6Version Version);

    private sealed record Phase6AssignmentList(Guid ClientProfileId, Phase6Assignment[] Assignments);

    private sealed record Phase6Problem(string? Code, string? AccessReason);
}
