using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Identity;

public static class LegalConsentEndpoints
{
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

        return endpoints;
    }
}
