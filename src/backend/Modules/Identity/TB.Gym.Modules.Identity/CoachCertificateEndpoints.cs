using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Identity;

/// <summary>
/// The platform admin's certificate record (CLI-021, notes plan N4a): the <c>PlatformAdmin</c> policy on every route,
/// no workspace header read, antiforgery and the <c>SensitiveWrite</c> limit on every write. No route answers with
/// anything but the admin's own views; nothing here reaches a coach or a client.
/// </summary>
public static class CoachCertificateEndpoints
{
    public static IEndpointRouteBuilder MapCoachCertificateEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var admin = endpoints
            .MapGroup("/api/platform-admin/coaches")
            .RequireAuthorization(AuthorizationPolicies.PlatformAdmin)
            .WithTags("Coach certificates");

        admin.MapGet("/", async (ICoachCertificateAdminService service, CancellationToken cancellationToken) =>
                Results.Ok(await service.ListCoachesAsync(cancellationToken)))
            .WithName("ListCertificateCoaches")
            .Produces<CoachCertificateCoachView[]>();

        admin.MapGet("/{userId:guid}/spaces/{tenantId:guid}/lines", async (
                Guid userId,
                Guid tenantId,
                ICoachCertificateAdminService service,
                CancellationToken cancellationToken) =>
                ToResult(await service.ListLinesAsync(userId, tenantId, cancellationToken)))
            .WithName("ListCoachCertificateLines")
            .Produces<CoachCertificateLinesView>()
            .Produces(StatusCodes.Status404NotFound);

        // 201 for a new waiting line; 200 with the line already recorded for the same words and day.
        admin.MapPost("/{userId:guid}/spaces/{tenantId:guid}/lines", async (
                Guid userId,
                Guid tenantId,
                AddCoachCertificateLineRequest request,
                HttpContext context,
                IAntiforgery antiforgery,
                ICoachCertificateAdminService service,
                CancellationToken cancellationToken) =>
            {
                await antiforgery.ValidateRequestAsync(context);
                return ToResult(
                    await service.AddLineAsync(userId, tenantId, request, cancellationToken),
                    $"/api/platform-admin/coaches/{userId:D}/spaces/{tenantId:D}/lines");
            })
            .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
            .WithName("AddCoachCertificateLine")
            .Produces<CoachCertificateLineView>(StatusCodes.Status201Created)
            .Produces<CoachCertificateLineView>()
            .Produces(StatusCodes.Status404NotFound)
            .ProducesValidationProblem();

        admin.MapPost("/{userId:guid}/spaces/{tenantId:guid}/lines/{lineId:guid}/confirm", async (
                Guid userId,
                Guid tenantId,
                Guid lineId,
                ConfirmCoachCertificateLineRequest request,
                HttpContext context,
                IAntiforgery antiforgery,
                ICoachCertificateAdminService service,
                CancellationToken cancellationToken) =>
            {
                await antiforgery.ValidateRequestAsync(context);
                return ToResult(await service.ConfirmLineAsync(userId, tenantId, lineId, request, cancellationToken));
            })
            .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
            .WithName("ConfirmCoachCertificateLine")
            .Produces<CoachCertificateLineView>()
            .Produces(StatusCodes.Status404NotFound)
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status409Conflict);

        // A waiting line goes outright: nothing about a "not confirmed" result is kept.
        admin.MapPost("/{userId:guid}/spaces/{tenantId:guid}/lines/{lineId:guid}/drop", async (
                Guid userId,
                Guid tenantId,
                Guid lineId,
                CoachCertificateLineChangeRequest request,
                HttpContext context,
                IAntiforgery antiforgery,
                ICoachCertificateAdminService service,
                CancellationToken cancellationToken) =>
            {
                await antiforgery.ValidateRequestAsync(context);
                return ToResult(await service.DropLineAsync(userId, tenantId, lineId, request, cancellationToken));
            })
            .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
            .WithName("DropCoachCertificateLine")
            .Produces<CoachCertificateDropView>()
            .Produces(StatusCodes.Status404NotFound)
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status409Conflict);

        admin.MapPost("/{userId:guid}/spaces/{tenantId:guid}/lines/{lineId:guid}/take-down", async (
                Guid userId,
                Guid tenantId,
                Guid lineId,
                CoachCertificateLineChangeRequest request,
                HttpContext context,
                IAntiforgery antiforgery,
                ICoachCertificateAdminService service,
                CancellationToken cancellationToken) =>
            {
                await antiforgery.ValidateRequestAsync(context);
                return ToResult(await service.TakeDownLineAsync(userId, tenantId, lineId, request, cancellationToken));
            })
            .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
            .WithName("TakeDownCoachCertificateLine")
            .Produces<CoachCertificateLineView>()
            .Produces(StatusCodes.Status404NotFound)
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status409Conflict);

        // A coach's request to be erased: every line of theirs in this space; the answer is counts only.
        admin.MapPost("/{userId:guid}/spaces/{tenantId:guid}/erase", async (
                Guid userId,
                Guid tenantId,
                EraseCoachCertificateLinesRequest request,
                HttpContext context,
                IAntiforgery antiforgery,
                ICoachCertificateAdminService service,
                CancellationToken cancellationToken) =>
            {
                await antiforgery.ValidateRequestAsync(context);
                return ToResult(await service.EraseAsync(userId, tenantId, request, cancellationToken));
            })
            .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
            .WithName("EraseCoachCertificateLines")
            .Produces<CoachCertificateErasureView>()
            .Produces(StatusCodes.Status404NotFound)
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status409Conflict);

        return endpoints;
    }

    private static IResult ToResult<T>(CoachCertificateCommandResult<T> result, string? createdAt = null) =>
        result.Status switch
        {
            CoachCertificateCommandStatus.Success => Results.Ok(result.Value),
            CoachCertificateCommandStatus.Created => Results.Created(createdAt, result.Value),
            CoachCertificateCommandStatus.NotFound => Results.NotFound(),
            CoachCertificateCommandStatus.Invalid => Results.ValidationProblem(
                result.Errors ?? new Dictionary<string, string[]>()),
            _ => Results.Conflict(new
            {
                code = result.Code ?? CoachCertificateText.StateCode,
                message = result.Message,
            }),
        };
}
