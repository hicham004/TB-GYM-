using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.CheckIns;

public static class CheckInEndpoints
{
    private const int DefaultPageSize = 25;
    private const int MaximumPageSize = 100;

    public static IEndpointRouteBuilder MapCheckInsModule(this IEndpointRouteBuilder endpoints)
    {
        MapAuthoring(endpoints);
        MapCoachAssignments(endpoints);
        MapClientAssignments(endpoints);
        return endpoints;
    }

    private static void MapAuthoring(IEndpointRouteBuilder endpoints)
    {
        // Authoring has no client subject, so there is no entitlement to evaluate here: a form is
        // workspace content, and nothing entitles a workspace. Every route that names a client
        // evaluates CoachingFeature.CheckIns. Ratified in ADR 0017 ("Authorization"), which carries
        // the rationale and the boundary this relies on; do not change it from here.
        var forms = endpoints.MapGroup("/api/checkins/forms")
            .RequireAuthorization(AuthorizationPolicies.TenantCoach)
            .WithTags(CheckInsModule.Name);

        forms.MapGet("", async (
            int? skip,
            int? take,
            ICheckInApplicationService service,
            CancellationToken token) =>
            Results.Ok(await service.ListFormsAsync(
                Math.Max(skip ?? 0, 0),
                Math.Clamp(take ?? DefaultPageSize, 1, MaximumPageSize),
                token)))
        .WithName("ListCheckInForms")
        .Produces<CheckInFormPage>();

        forms.MapGet("/{formId:guid}", async (
            Guid formId,
            ICheckInApplicationService service,
            CancellationToken token) =>
        {
            var view = await service.GetFormAsync(formId, token);
            return view is null ? Results.NotFound() : Results.Ok(view);
        })
        .WithName("GetCheckInForm")
        .Produces<CheckInFormDetails>()
        .ProducesProblem(StatusCodes.Status404NotFound);

        forms.MapGet("/{formId:guid}/versions/{versionId:guid}", async (
            Guid formId,
            Guid versionId,
            ICheckInApplicationService service,
            CancellationToken token) =>
        {
            var view = await service.GetVersionAsync(formId, versionId, token);
            return view is null ? Results.NotFound() : Results.Ok(view);
        })
        .WithName("GetCheckInFormVersion")
        .Produces<CheckInFormVersionView>()
        .ProducesProblem(StatusCodes.Status404NotFound);

        forms.MapPost("", async (
            CreateCheckInFormRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ICheckInApplicationService service,
            CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToFormResult(await service.CreateFormAsync(request, token));
        })
        .WithName("CreateCheckInForm")
        .Produces<CheckInFormDetails>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict)
        .RequireRateLimiting(RateLimitPolicies.SensitiveWrite);

        forms.MapPut("/{formId:guid}", async (
            Guid formId,
            RenameCheckInFormRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ICheckInApplicationService service,
            CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToFormResult(await service.RenameFormAsync(formId, request, token));
        })
        .WithName("RenameCheckInForm")
        .Produces<CheckInFormDetails>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status404NotFound)
        .ProducesProblem(StatusCodes.Status409Conflict);

        forms.MapPost("/{formId:guid}/archive", async (
            Guid formId,
            CheckInConcurrencyRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ICheckInApplicationService service,
            CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToFormResult(await service.ArchiveFormAsync(formId, request, token));
        })
        .WithName("ArchiveCheckInForm")
        .Produces<CheckInFormDetails>()
        .ProducesProblem(StatusCodes.Status404NotFound)
        .ProducesProblem(StatusCodes.Status409Conflict);

        forms.MapPost("/{formId:guid}/restore", async (
            Guid formId,
            CheckInConcurrencyRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ICheckInApplicationService service,
            CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToFormResult(await service.RestoreFormAsync(formId, request, token));
        })
        .WithName("RestoreCheckInForm")
        .Produces<CheckInFormDetails>()
        .ProducesProblem(StatusCodes.Status404NotFound)
        .ProducesProblem(StatusCodes.Status409Conflict);

        forms.MapPost("/{formId:guid}/versions", async (
            Guid formId,
            DeriveCheckInDraftRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ICheckInApplicationService service,
            CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToVersionResult(await service.DeriveDraftAsync(formId, request, token));
        })
        .WithName("DeriveCheckInDraftVersion")
        .Produces<CheckInFormVersionView>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status404NotFound)
        .ProducesProblem(StatusCodes.Status409Conflict)
        .RequireRateLimiting(RateLimitPolicies.SensitiveWrite);

        forms.MapPut("/{formId:guid}/versions/{versionId:guid}", async (
            Guid formId,
            Guid versionId,
            SaveCheckInDraftRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ICheckInApplicationService service,
            CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToVersionResult(await service.SaveDraftAsync(formId, versionId, request, token));
        })
        .WithName("SaveCheckInDraftVersion")
        .Produces<CheckInFormVersionView>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status404NotFound)
        .ProducesProblem(StatusCodes.Status409Conflict)
        .RequireRateLimiting(RateLimitPolicies.SensitiveWrite);

        forms.MapPost("/{formId:guid}/versions/{versionId:guid}/publish", async (
            Guid formId,
            Guid versionId,
            CheckInConcurrencyRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ICheckInApplicationService service,
            CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToVersionResult(await service.PublishVersionAsync(formId, versionId, request, token));
        })
        .WithName("PublishCheckInFormVersion")
        .Produces<CheckInFormVersionView>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status404NotFound)
        .ProducesProblem(StatusCodes.Status409Conflict);
    }

    private static void MapCoachAssignments(IEndpointRouteBuilder endpoints)
    {
        var coach = endpoints.MapGroup("/api/checkins/clients/{clientProfileId:guid}/assignments")
            .RequireAuthorization(AuthorizationPolicies.TenantCoach)
            .WithTags(CheckInsModule.Name);

        coach.MapGet("", async (
            Guid clientProfileId,
            ICheckInApplicationService service,
            CancellationToken token) =>
            ToListResult(await service.ListClientAssignmentsAsync(clientProfileId, token)))
        .WithName("ListClientCheckInAssignments")
        .Produces<CheckInAssignmentListView>()
        .ProducesProblem(StatusCodes.Status403Forbidden)
        .ProducesProblem(StatusCodes.Status404NotFound);

        coach.MapGet("/{assignmentId:guid}", async (
            Guid clientProfileId,
            Guid assignmentId,
            ICheckInApplicationService service,
            CancellationToken token) =>
            ToDetailResult(await service.GetClientAssignmentAsync(clientProfileId, assignmentId, token)))
        .WithName("GetClientCheckInAssignment")
        .Produces<CheckInAssignmentDetail>()
        .ProducesProblem(StatusCodes.Status403Forbidden)
        .ProducesProblem(StatusCodes.Status404NotFound);

        coach.MapPost("", async (
            Guid clientProfileId,
            AssignCheckInRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ICheckInApplicationService service,
            CancellationToken token) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToAssignmentResult(await service.AssignAsync(clientProfileId, request, token));
        })
        .WithName("AssignCheckIn")
        .Produces<CheckInAssignmentDetail>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status403Forbidden)
        .ProducesProblem(StatusCodes.Status404NotFound)
        .ProducesProblem(StatusCodes.Status409Conflict)
        .RequireRateLimiting(RateLimitPolicies.SensitiveWrite);
    }

    private static void MapClientAssignments(IEndpointRouteBuilder endpoints)
    {
        // Read-only in this chunk: a client sees what they were asked and by when. Answering,
        // drafting and submitting are a separate chunk and have no route here.
        var client = endpoints.MapGroup("/api/checkins/me/assignments")
            .RequireAuthorization(AuthorizationPolicies.TenantClient)
            .WithTags(CheckInsModule.Name);

        client.MapGet("", async (
            ICheckInApplicationService service,
            CancellationToken token) =>
            ToListResult(await service.ListOwnAssignmentsAsync(token)))
        .WithName("ListOwnCheckInAssignments")
        .Produces<CheckInAssignmentListView>()
        .ProducesProblem(StatusCodes.Status403Forbidden)
        .ProducesProblem(StatusCodes.Status404NotFound);

        client.MapGet("/{assignmentId:guid}", async (
            Guid assignmentId,
            ICheckInApplicationService service,
            CancellationToken token) =>
            ToDetailResult(await service.GetOwnAssignmentAsync(assignmentId, token)))
        .WithName("GetOwnCheckInAssignment")
        .Produces<CheckInAssignmentDetail>()
        .ProducesProblem(StatusCodes.Status403Forbidden)
        .ProducesProblem(StatusCodes.Status404NotFound);
    }

    private static IResult ToFormResult(CheckInFormCommandResult result) => result.Status switch
    {
        CheckInCommandStatus.Success => Results.Ok(result.Form),
        CheckInCommandStatus.NotFound => Results.NotFound(),
        CheckInCommandStatus.Invalid => Results.ValidationProblem(result.Errors ?? new Dictionary<string, string[]>()),
        CheckInCommandStatus.Conflict => Conflict(result.Code, result.Message),
        CheckInCommandStatus.Forbidden => Results.Forbid(),
        _ => Results.Problem(statusCode: StatusCodes.Status500InternalServerError),
    };

    private static IResult ToVersionResult(CheckInVersionCommandResult result) => result.Status switch
    {
        CheckInCommandStatus.Success => Results.Ok(result.Version),
        CheckInCommandStatus.NotFound => Results.NotFound(),
        CheckInCommandStatus.Invalid => Results.ValidationProblem(result.Errors ?? new Dictionary<string, string[]>()),
        CheckInCommandStatus.Conflict => Conflict(result.Code, result.Message),
        CheckInCommandStatus.Forbidden => Results.Forbid(),
        _ => Results.Problem(statusCode: StatusCodes.Status500InternalServerError),
    };

    private static IResult ToAssignmentResult(CheckInAssignmentCommandResult result) => result.Status switch
    {
        CheckInCommandStatus.Success => Results.Ok(result.Assignment),
        CheckInCommandStatus.NotFound => Results.NotFound(),
        CheckInCommandStatus.Invalid => Results.ValidationProblem(result.Errors ?? new Dictionary<string, string[]>()),
        CheckInCommandStatus.Conflict => Conflict(result.Code, result.Message),
        CheckInCommandStatus.Forbidden => Denied(result.AccessReason),
        _ => Results.Problem(statusCode: StatusCodes.Status500InternalServerError),
    };

    private static IResult ToListResult(CheckInAssignmentListResult result) => result.Status switch
    {
        CheckInCommandStatus.Success => Results.Ok(result.Assignments),
        CheckInCommandStatus.NotFound => Results.NotFound(),
        CheckInCommandStatus.Forbidden => Denied(result.AccessReason),
        _ => Results.Problem(statusCode: StatusCodes.Status500InternalServerError),
    };

    private static IResult ToDetailResult(CheckInAssignmentDetailResult result) => result.Status switch
    {
        CheckInCommandStatus.Success => Results.Ok(result.Assignment),
        CheckInCommandStatus.NotFound => Results.NotFound(),
        CheckInCommandStatus.Forbidden => Denied(result.AccessReason),
        _ => Results.Problem(statusCode: StatusCodes.Status500InternalServerError),
    };

    private static IResult Conflict(string? code, string? message) =>
        Results.Problem(
            statusCode: StatusCodes.Status409Conflict,
            title: message ?? "The check-in conflicts with current state.",
            extensions: code is null
                ? null
                : new Dictionary<string, object?> { ["code"] = code });

    // The deciding reason travels with the 403 so the client can be told why access is closed
    // instead of being shown an unexplained denial. It never lets the caller override the decision.
    private static IResult Denied(FeatureAccessReason? reason) =>
        reason is null
            ? Results.Forbid()
            : Results.Problem(
                statusCode: StatusCodes.Status403Forbidden,
                title: "Check-ins are not available for this client.",
                extensions: new Dictionary<string, object?> { ["accessReason"] = reason.ToString() });
}
