using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.CheckIns;

public static class CheckInResponseEndpoints
{
    public static IEndpointRouteBuilder MapCheckInResponses(this IEndpointRouteBuilder endpoints)
    {
        MapClientResponses(endpoints);
        MapCoachReview(endpoints);
        return endpoints;
    }

    private static void MapClientResponses(IEndpointRouteBuilder endpoints)
    {
        // The client owns their draft and their submission. Every route here resolves the caller's own
        // client profile and evaluates CoachingFeature.CheckIns before it reads or writes anything.
        var client = endpoints.MapGroup("/api/checkins/me/assignments/{assignmentId:guid}/response")
            .RequireAuthorization(AuthorizationPolicies.TenantClient)
            .WithTags(CheckInsModule.Name);

        client.MapGet("", async (
            Guid assignmentId,
            ICheckInResponseApplicationService service,
            CancellationToken token) =>
            ToResponseResult(await service.GetOwnResponseAsync(assignmentId, token)))
        .WithName("GetOwnCheckInResponse")
        .Produces<CheckInResponseDetail>()
        .ProducesProblem(StatusCodes.Status403Forbidden)
        .ProducesProblem(StatusCodes.Status404NotFound);

        client.MapPut("", async (
            Guid assignmentId,
            SaveCheckInResponseRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ICheckInResponseApplicationService service,
            CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResponseResult(await service.SaveOwnDraftAsync(assignmentId, request, token));
        })
        .WithName("SaveOwnCheckInDraftResponse")
        .Produces<CheckInResponseDetail>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status403Forbidden)
        .ProducesProblem(StatusCodes.Status404NotFound)
        .ProducesProblem(StatusCodes.Status409Conflict)
        .RequireRateLimiting(RateLimitPolicies.SensitiveWrite);

        client.MapPost("/submit", async (
            Guid assignmentId,
            CheckInResponseConcurrencyRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ICheckInResponseApplicationService service,
            CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResponseResult(await service.SubmitOwnResponseAsync(assignmentId, request, token));
        })
        .WithName("SubmitOwnCheckInResponse")
        .Produces<CheckInResponseDetail>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status403Forbidden)
        .ProducesProblem(StatusCodes.Status404NotFound)
        .ProducesProblem(StatusCodes.Status409Conflict)
        .RequireRateLimiting(RateLimitPolicies.SensitiveWrite);
    }

    private static void MapCoachReview(IEndpointRouteBuilder endpoints)
    {
        var coach = endpoints.MapGroup("/api/checkins/clients/{clientProfileId:guid}")
            .RequireAuthorization(AuthorizationPolicies.TenantCoach)
            .WithTags(CheckInsModule.Name);

        coach.MapGet("/assignments/{assignmentId:guid}/response", async (
            Guid clientProfileId,
            Guid assignmentId,
            ICheckInResponseApplicationService service,
            CancellationToken token) =>
            ToResponseResult(await service.GetClientResponseAsync(clientProfileId, assignmentId, token)))
        .WithName("GetClientCheckInResponse")
        .Produces<CheckInResponseDetail>()
        .ProducesProblem(StatusCodes.Status403Forbidden)
        .ProducesProblem(StatusCodes.Status404NotFound);

        coach.MapPost("/assignments/{assignmentId:guid}/response/review", async (
            Guid clientProfileId,
            Guid assignmentId,
            CheckInResponseConcurrencyRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ICheckInResponseApplicationService service,
            CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResponseResult(await service.ReviewAsync(clientProfileId, assignmentId, request, token));
        })
        .WithName("ReviewCheckInResponse")
        .Produces<CheckInResponseDetail>()
        .ProducesProblem(StatusCodes.Status403Forbidden)
        .ProducesProblem(StatusCodes.Status404NotFound)
        .ProducesProblem(StatusCodes.Status409Conflict)
        .RequireRateLimiting(RateLimitPolicies.SensitiveWrite);

        coach.MapGet("/checkin-comparison", async (
            Guid clientProfileId,
            Guid firstResponseId,
            Guid secondResponseId,
            ICheckInResponseApplicationService service,
            CancellationToken token) =>
            ToComparisonResult(await service.CompareAsync(
                clientProfileId,
                firstResponseId,
                secondResponseId,
                token)))
        .WithName("CompareCheckInResponses")
        .Produces<CheckInComparisonView>()
        .ProducesProblem(StatusCodes.Status403Forbidden)
        .ProducesProblem(StatusCodes.Status404NotFound)
        .ProducesProblem(StatusCodes.Status409Conflict);
    }

    private static IResult ToResponseResult(CheckInResponseCommandResult result) => result.Status switch
    {
        CheckInCommandStatus.Success => Results.Ok(result.Response),
        CheckInCommandStatus.NotFound => Results.NotFound(),
        CheckInCommandStatus.Invalid => SubmissionProblem(result),
        CheckInCommandStatus.Conflict => Conflict(result.Code, result.Message),
        CheckInCommandStatus.Forbidden => Denied(result.AccessReason),
        _ => Results.Problem(statusCode: StatusCodes.Status500InternalServerError),
    };

    private static IResult ToComparisonResult(CheckInComparisonResult result) => result.Status switch
    {
        CheckInCommandStatus.Success => Results.Ok(result.Comparison),
        CheckInCommandStatus.NotFound => Results.NotFound(),
        CheckInCommandStatus.Conflict => Conflict(result.Code, result.Message),
        CheckInCommandStatus.Forbidden => Denied(result.AccessReason),
        _ => Results.Problem(statusCode: StatusCodes.Status500InternalServerError),
    };

    /// <summary>
    /// Submission reports every failure at once. The messages are keyed by question key so the form can
    /// place each one, and the machine-readable codes travel alongside so the SPA never has to parse
    /// prose to decide what went wrong.
    /// </summary>
    private static IResult SubmissionProblem(CheckInResponseCommandResult result)
    {
        var errors = result.Errors ?? new Dictionary<string, string[]>();
        if (result.Failures is not { Count: > 0 } failures)
        {
            return Results.ValidationProblem(errors);
        }

        return Results.ValidationProblem(
            failures
                .GroupBy(failure => failure.QuestionKey, StringComparer.Ordinal)
                .ToDictionary(
                    group => group.Key,
                    group => group.Select(failure => failure.Message).ToArray(),
                    StringComparer.Ordinal),
            extensions: new Dictionary<string, object?>
            {
                ["failures"] = failures
                    .Select(failure => new
                    {
                        questionKey = failure.QuestionKey,
                        code = failure.Code.ToString(),
                        message = failure.Message,
                    })
                    .ToArray(),
            });
    }

    private static IResult Conflict(string? code, string? message) =>
        Results.Problem(
            statusCode: StatusCodes.Status409Conflict,
            title: message ?? "The check-in conflicts with current state.",
            extensions: code is null
                ? null
                : new Dictionary<string, object?> { ["code"] = code });

    private static IResult Denied(FeatureAccessReason? reason) =>
        reason is null
            ? Results.Forbid()
            : Results.Problem(
                statusCode: StatusCodes.Status403Forbidden,
                title: "Check-ins are not available for this client.",
                extensions: new Dictionary<string, object?> { ["accessReason"] = reason.ToString() });
}
