using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Identity;

public static class LegalConsentEndpoints
{
    /// <summary>
    /// The largest publish body read: 200,000 characters of text, each at most six bytes once JSON escapes
    /// it, with room for the rest of the request.
    /// </summary>
    public const long MaximumPublishRequestBytes = 2 * 1024 * 1024;

    public static IEndpointRouteBuilder MapLegalConsentEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints
            .MapGroup("/api/legal")
            .RequireAuthorization()
            .WithTags("Legal");

        group.MapGet("/documents/current", async (
            Guid? workspaceId,
            ILegalConsentApplicationService service,
            CancellationToken cancellationToken) =>
            Results.Ok(await service.ListCurrentAsync(workspaceId, cancellationToken)))
            .WithName("ListCurrentLegalDocuments")
            .Produces<LegalDocumentView[]>();

        // What registration and an invitation ask a person to accept (INV-3). Public: the person has no
        // account yet, and published legal documents are for anyone to read.
        group.MapGet("/documents/to-accept", async (
            LegalAudience audience,
            ILegalConsentApplicationService service,
            CancellationToken cancellationToken) =>
            Enum.IsDefined(audience)
                ? Results.Ok(await service.ListToAcceptAsync(audience, cancellationToken))
                : Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["audience"] = ["Ask for an owner, a coach or a client."],
                }))
            .AllowAnonymous()
            .WithName("ListLegalDocumentsToAccept")
            .Produces<LegalDocumentToAccept[]>()
            .ProducesValidationProblem();

        group.MapGet("/documents/{documentVersionId:guid}", async (
            Guid documentVersionId,
            ILegalConsentApplicationService service,
            CancellationToken cancellationToken) =>
            await service.GetPublishedAsync(documentVersionId, cancellationToken) is { } document
                ? Results.Ok(document)
                : Results.NotFound())
            .AllowAnonymous()
            .WithName("GetPublishedLegalDocument")
            .Produces<LegalDocumentText>()
            .Produces(StatusCodes.Status404NotFound);

        group.MapPost("/consents", async (
            AcceptLegalDocumentRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ILegalConsentApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            var result = await service.AcceptAsync(request, cancellationToken);
            return result.Status switch
            {
                LegalConsentCommandStatus.Success => Results.Ok(result.Acceptance),
                LegalConsentCommandStatus.NotFound => Results.NotFound(),
                LegalConsentCommandStatus.Forbidden => Results.Forbid(),
                _ => Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["documentVersionId"] = [result.Message ?? "The document cannot be accepted."],
                }),
            };
        })
        .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
        .WithName("AcceptLegalDocument")
        .Produces<LegalConsentAcceptanceView>()
        .ProducesValidationProblem()
        .Produces(StatusCodes.Status403Forbidden)
        .Produces(StatusCodes.Status404NotFound);

        // The platform admin publishes reviewed documents (INV-3, CLI-010). No workspace header is read;
        // the policy re-reads the global role from the database on every request.
        var admin = endpoints
            .MapGroup("/api/platform-admin/legal-documents")
            .RequireAuthorization(AuthorizationPolicies.PlatformAdmin)
            .WithTags("Legal");

        admin.MapGet("/", async (ILegalDocumentAdminService service, CancellationToken cancellationToken) =>
                Results.Ok(await service.ListAsync(cancellationToken)))
            .WithName("ListLegalDocumentVersions")
            .Produces<LegalDocumentAdminView[]>();

        admin.MapPost("/", async (
                PublishLegalDocumentRequest request,
                HttpContext context,
                IAntiforgery antiforgery,
                ILegalDocumentAdminService service,
                CancellationToken cancellationToken) =>
            {
                await antiforgery.ValidateRequestAsync(context);
                return ToResult(await service.PublishAsync(request, cancellationToken));
            })
            .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
            .WithMetadata(new RequestSizeLimitAttribute(MaximumPublishRequestBytes))
            .WithName("PublishLegalDocumentVersion")
            .Produces<LegalDocumentAdminView>()
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status409Conflict);

        // A version published by mistake stops being asked for; its words and acceptances stay.
        admin.MapPost("/{documentVersionId:guid}/withdraw", async (
                Guid documentVersionId,
                HttpContext context,
                IAntiforgery antiforgery,
                ILegalDocumentAdminService service,
                CancellationToken cancellationToken) =>
            {
                await antiforgery.ValidateRequestAsync(context);
                return ToResult(await service.WithdrawAsync(documentVersionId, cancellationToken));
            })
            .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
            .WithName("WithdrawLegalDocumentVersion")
            .Produces<LegalDocumentAdminView>()
            .Produces(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        return endpoints;
    }

    private static IResult ToResult(LegalDocumentCommandResult result) => result.Status switch
    {
        LegalConsentCommandStatus.Success => Results.Ok(result.Document),
        LegalConsentCommandStatus.NotFound => Results.NotFound(),
        LegalConsentCommandStatus.Conflict => Results.Conflict(new
        {
            code = result.ConflictCode,
            message = result.ConflictMessage,
        }),
        _ => Results.ValidationProblem(result.Errors ?? new Dictionary<string, string[]>()),
    };
}
