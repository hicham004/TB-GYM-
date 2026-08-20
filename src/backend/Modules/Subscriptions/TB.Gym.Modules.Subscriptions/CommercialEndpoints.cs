using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.Subscriptions;

public static class CommercialEndpoints
{
    public static IEndpointRouteBuilder MapSubscriptionsModule(this IEndpointRouteBuilder endpoints)
    {
        var coachGroup = endpoints
            .MapGroup("/api/commercial")
            .RequireAuthorization(AuthorizationPolicies.TenantCoach)
            .WithTags(SubscriptionsModule.Name);

        coachGroup.MapGet("/products", async (
            ICommercialApplicationService service,
            CancellationToken cancellationToken) =>
            Results.Ok(await service.ListProductsAsync(cancellationToken)))
            .WithName("ListCoachingProducts")
            .Produces<ProductCatalog>();

        coachGroup.MapPost("/products", async (
            CreateCoachingProductRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ICommercialApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.CreateProductAsync(request, cancellationToken));
        })
        .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
        .WithName("CreateCoachingProduct")
        .Produces<CoachingProductView>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict);

        coachGroup.MapPut("/products/{productId:guid}", async (
            Guid productId,
            UpdateCoachingProductRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ICommercialApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.UpdateProductAsync(productId, request, cancellationToken));
        })
        .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
        .WithName("UpdateCoachingProduct")
        .Produces<CoachingProductView>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict);

        coachGroup.MapPost("/products/{productId:guid}/offers", async (
            Guid productId,
            CreateProductOfferRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ICommercialApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.AddOfferAsync(productId, request, cancellationToken));
        })
        .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
        .WithName("AddProductOffer")
        .Produces<CoachingProductView>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict);

        coachGroup.MapPut("/offers/{offerId:guid}/availability", async (
            Guid offerId,
            SetOfferAvailabilityRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ICommercialApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.SetOfferAvailabilityAsync(offerId, request, cancellationToken));
        })
        .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
        .WithName("SetProductOfferAvailability")
        .Produces<CoachingProductView>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict);

        coachGroup.MapGet("/clients/{clientProfileId:guid}", async (
            Guid clientProfileId,
            ICommercialApplicationService service,
            CancellationToken cancellationToken) =>
        {
            var overview = await service.GetClientOverviewAsync(clientProfileId, cancellationToken);
            return overview is null ? Results.NotFound() : Results.Ok(overview);
        })
        .WithName("GetClientCommercialOverview")
        .Produces<ClientCommercialOverview>()
        .Produces(StatusCodes.Status404NotFound);

        coachGroup.MapPost("/clients/{clientProfileId:guid}/enrollments", async (
            Guid clientProfileId,
            AssignProductRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ICommercialApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.AssignAsync(clientProfileId, request, cancellationToken));
        })
        .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
        .WithName("AssignProductToClient")
        .Produces<ClientEnrollmentView>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict);

        coachGroup.MapPost("/enrollments/{enrollmentId:guid}/payments", async (
            Guid enrollmentId,
            RecordManualPaymentRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ICommercialApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.RecordManualPaymentAsync(enrollmentId, request, cancellationToken));
        })
        .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
        .WithName("RecordManualPayment")
        .Produces<ClientEnrollmentView>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict);

        coachGroup.MapPost("/enrollments/{enrollmentId:guid}/renew", async (
            Guid enrollmentId,
            RenewEnrollmentRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ICommercialApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.RenewAsync(enrollmentId, request, cancellationToken));
        })
        .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
        .WithName("RenewClientEnrollment")
        .Produces<ClientEnrollmentView>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict);

        coachGroup.MapPost("/enrollments/{enrollmentId:guid}/pause", async (
            Guid enrollmentId,
            ChangeEnrollmentStatusRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ICommercialApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.PauseAsync(enrollmentId, request, cancellationToken));
        })
        .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
        .WithName("PauseClientEnrollment")
        .Produces<ClientEnrollmentView>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict);

        coachGroup.MapPost("/enrollments/{enrollmentId:guid}/resume", async (
            Guid enrollmentId,
            ResumeEnrollmentRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ICommercialApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.ResumeAsync(enrollmentId, request, cancellationToken));
        })
        .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
        .WithName("ResumeClientEnrollment")
        .Produces<ClientEnrollmentView>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict);

        coachGroup.MapPost("/enrollments/{enrollmentId:guid}/cancel", async (
            Guid enrollmentId,
            ChangeEnrollmentStatusRequest request,
            HttpContext context,
            IAntiforgery antiforgery,
            ICommercialApplicationService service,
            CancellationToken cancellationToken) =>
        {
            await antiforgery.ValidateRequestAsync(context);
            return ToResult(await service.CancelAsync(enrollmentId, request, cancellationToken));
        })
        .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
        .WithName("CancelClientEnrollment")
        .Produces<ClientEnrollmentView>()
        .ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status409Conflict);

        endpoints.MapGet("/api/client-access/me", async (
            ICommercialApplicationService service,
            CancellationToken cancellationToken) =>
        {
            var decisions = await service.GetSelfAccessAsync(cancellationToken);
            return decisions is null ? Results.NotFound() : Results.Ok(decisions);
        })
        .RequireAuthorization(AuthorizationPolicies.TenantClient)
        .WithName("GetOwnCoachingFeatureAccess")
        .WithTags(SubscriptionsModule.Name)
        .Produces<FeatureAccessDecision[]>()
        .Produces(StatusCodes.Status404NotFound);

        return endpoints;
    }

    private static IResult ToResult(CommercialCommandResult result) =>
        result.Status switch
        {
            CommercialCommandStatus.Success => Results.Ok(
                (object?)result.Product ?? (object?)result.Enrollment ?? result.Overview),
            CommercialCommandStatus.NotFound => Results.NotFound(),
            CommercialCommandStatus.Invalid => Results.ValidationProblem(
                result.Errors ?? new Dictionary<string, string[]>()),
            _ => Results.Conflict(new
            {
                code = result.Code ?? "commercial_conflict",
                message = result.Message ?? "The commercial record changed or conflicts with existing coverage.",
            }),
        };
}
