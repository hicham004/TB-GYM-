using System.Net;
using System.Net.Http.Json;

namespace TB.Gym.Api.IntegrationTests;

/// <summary>
/// Shared fixtures for the Phase 6A-2 check-in response tests. Every date comes from the injected
/// clock resolved through the workspace time zone, never from the machine clock.
/// </summary>
public sealed partial class Phase3TrainingWorkflowTests
{
    private static readonly string[] ExpectedOneSidedPresence = ["InBoth", "InBoth", "InBoth", "OnlyInSecond"];

    private static async Task<HttpResponseMessage> Phase6SaveDraftAsync(
        HttpClient client,
        Guid assignmentId,
        IReadOnlyList<object> answers,
        uint? version = null)
    {
        await RefreshCsrfAsync(client);
        return await client.PutAsJsonAsync(
            $"/api/checkins/me/assignments/{assignmentId}/response",
            new { answers, version });
    }

    private static async Task<HttpResponseMessage> Phase6SubmitAsync(
        HttpClient client,
        Guid assignmentId,
        uint version)
    {
        await RefreshCsrfAsync(client);
        return await client.PostAsJsonAsync(
            $"/api/checkins/me/assignments/{assignmentId}/response/submit",
            new { version });
    }

    private static async Task<HttpResponseMessage> Phase6ReviewAsync(
        HttpClient coach,
        Guid clientProfileId,
        Guid assignmentId,
        uint version)
    {
        await RefreshCsrfAsync(coach);
        return await coach.PostAsJsonAsync(
            $"/api/checkins/clients/{clientProfileId}/assignments/{assignmentId}/response/review",
            new { version });
    }

    private static async Task<Phase6ResponseDetail> Phase6GetOwnResponseAsync(
        HttpClient client,
        Guid assignmentId)
    {
        var response = await client.GetAsync($"/api/checkins/me/assignments/{assignmentId}/response");
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<Phase6ResponseDetail>(response);
    }

    private static async Task<Phase6ResponseDetail> Phase6GetClientResponseAsync(
        HttpClient coach,
        Guid clientProfileId,
        Guid assignmentId)
    {
        var response = await coach.GetAsync(
            $"/api/checkins/clients/{clientProfileId}/assignments/{assignmentId}/response");
        await AssertStatusAsync(response, HttpStatusCode.OK);
        return await RequiredJsonAsync<Phase6ResponseDetail>(response);
    }

    private static Task<HttpResponseMessage> Phase6CompareAsync(
        HttpClient coach,
        Guid clientProfileId,
        Guid firstResponseId,
        Guid secondResponseId) =>
        coach.GetAsync(
            $"/api/checkins/clients/{clientProfileId}/checkin-comparison" +
            $"?firstResponseId={firstResponseId}&secondResponseId={secondResponseId}");

    /// <summary>
    /// Answers every question of the version in one payload, so a test that is about submission does
    /// not have to spell out a whole form to get there.
    /// </summary>
    private static object[] Phase6AnswerAll(
        Phase6Version version,
        string text = "Feeling good.",
        decimal scale = 7m)
    {
        return [.. version.Questions.Select(question => question.QuestionType switch
        {
            "ShortText" or "LongText" => Phase6TextAnswer(question.Id, text),
            "NumericScale" => Phase6NumericAnswer(question.Id, scale),
            _ => Phase6ChoiceAnswer(question.Id, question.Options[0].Id),
        })];
    }

    private static object Phase6TextAnswer(Guid questionId, string value) => new
    {
        questionId,
        textValue = value,
    };

    private static object Phase6NumericAnswer(Guid questionId, decimal value) => new
    {
        questionId,
        numericValue = value,
    };

    private static object Phase6ChoiceAnswer(Guid questionId, params Guid[] optionIds) => new
    {
        questionId,
        selectedOptionIds = optionIds,
    };

    private static Phase6Question Phase6QuestionOfType(Phase6Version version, string questionType) =>
        version.Questions.First(question => question.QuestionType == questionType);

    private sealed record Phase6AnswerChoice(Guid QuestionOptionId, int Order, string Label);

    private sealed record Phase6Answer(
        Guid QuestionId,
        string QuestionKey,
        string QuestionType,
        string? TextValue,
        decimal? NumericValue,
        Phase6AnswerChoice[] Choices);

    private sealed record Phase6Response(
        Guid Id,
        Guid AssignmentId,
        Guid ClientProfileId,
        string Status,
        DateTimeOffset? SubmittedAtUtc,
        DateOnly? SubmittedDate,
        bool IsLate,
        DateTimeOffset? ReviewedAtUtc,
        Guid? ReviewedByUserId,
        Phase6Answer[] Answers,
        uint Version,
        // Set when the audience may know a response exists but not what it says: a coach reading a
        // draft. It separates "nothing was written" from "this is not yours to read yet".
        bool AnswersWithheld);

    private sealed record Phase6ResponseDetail(
        Phase6Assignment Assignment,
        Phase6Version Version,
        Phase6Response? Response);

    private sealed record Phase6ComparisonCell(
        Guid QuestionId,
        int Order,
        string QuestionType,
        string Prompt,
        bool IsRequired,
        Phase6Answer? Answer);

    private sealed record Phase6ComparisonRow(
        string QuestionKey,
        string Presence,
        Phase6ComparisonCell? First,
        Phase6ComparisonCell? Second);

    private sealed record Phase6ComparisonSide(
        Guid ResponseId,
        Guid AssignmentId,
        Guid FormVersionId,
        int FormVersionNumber,
        string Status,
        DateOnly DueDate,
        DateOnly? SubmittedDate,
        DateTimeOffset? SubmittedAtUtc,
        bool IsLate);

    private sealed record Phase6Comparison(
        Guid ClientProfileId,
        Guid FormId,
        string FormTitle,
        Phase6ComparisonSide First,
        Phase6ComparisonSide Second,
        Phase6ComparisonRow[] Rows);
}
