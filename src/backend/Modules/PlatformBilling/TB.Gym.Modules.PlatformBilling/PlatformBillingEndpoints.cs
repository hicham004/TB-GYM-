using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using TB.Gym.SharedKernel;

namespace TB.Gym.Modules.PlatformBilling;

public static class PlatformBillingEndpoints
{
    public static IEndpointRouteBuilder MapPlatformBillingModule(this IEndpointRouteBuilder endpoints)
    {
        // The owner's own bill. Coaches never see it (ADR 0028).
        endpoints.MapGet("/api/billing", async (IWorkspaceBillingService service, CancellationToken cancellationToken) =>
                Results.Ok(await service.GetForOwnerAsync(cancellationToken)))
            .RequireAuthorization(AuthorizationPolicies.TenantOwner)
            .WithTags(PlatformBillingModule.Name)
            .WithName("GetWorkspaceBilling")
            .Produces<WorkspaceBillingView>();

        // What the coach app's banner needs: read-only or not, and for the owner an overdue warning.
        endpoints.MapGet("/api/billing/access", async (IWorkspaceBillingService service, CancellationToken cancellationToken) =>
                Results.Ok(await service.GetAccessAsync(cancellationToken)))
            .RequireAuthorization(AuthorizationPolicies.TenantCoach)
            .WithTags(PlatformBillingModule.Name)
            .WithName("GetWorkspaceBillingAccess")
            .Produces<WorkspaceBillingAccessView>();

        // The owner's own Founding coach badge (decision 15, 5 Nov 2026). Nobody else in the space reads it.
        endpoints.MapGet("/api/billing/founding", async (IWorkspaceBillingService service, CancellationToken cancellationToken) =>
                Results.Ok(await service.GetFoundingAsync(cancellationToken)))
            .RequireAuthorization(AuthorizationPolicies.TenantOwner)
            .WithTags(PlatformBillingModule.Name)
            .WithName("GetWorkspaceFounding")
            .Produces<FoundingBadgeView>();

        // Showing the badge to one's clients is the owner's personal setting, so it stays open while an
        // unpaid workspace is read-only.
        endpoints.MapPut("/api/billing/founding/visibility", async (
                SetFoundingBadgeVisibilityRequest request,
                HttpContext context,
                IAntiforgery antiforgery,
                IWorkspaceBillingService service,
                CancellationToken cancellationToken) =>
            {
                await antiforgery.ValidateRequestAsync(context);
                return ToResult(await service.SetFoundingBadgeHiddenAsync(request, cancellationToken));
            })
            .RequireAuthorization(AuthorizationPolicies.TenantOwner)
            .RequireRateLimiting(RateLimitPolicies.RoutineWrite)
            .WithMetadata(AllowedWhileWorkspaceReadOnly.Instance)
            .WithTags(PlatformBillingModule.Name)
            .WithName("SetFoundingBadgeVisibility")
            .Produces<FoundingBadgeView>()
            .Produces(StatusCodes.Status404NotFound)
            .ProducesValidationProblem();

        // The platform admin's surface. No workspace header is read: the admin is not a member, and the
        // policy re-reads the global role from the database on every request.
        var admin = endpoints
            .MapGroup("/api/platform-admin")
            .RequireAuthorization(AuthorizationPolicies.PlatformAdmin)
            .WithTags(PlatformBillingModule.Name);

        admin.MapGet("/workspaces", async (IPlatformBillingAdminService service, CancellationToken cancellationToken) =>
                Results.Ok(await service.ListWorkspacesAsync(cancellationToken)))
            .WithName("ListBillingWorkspaces")
            .Produces<AdminWorkspaceSummary[]>();

        admin.MapGet("/workspaces/{tenantId:guid}", async (
                Guid tenantId,
                IPlatformBillingAdminService service,
                CancellationToken cancellationToken) =>
                await service.GetWorkspaceAsync(tenantId, cancellationToken) is { } detail
                    ? Results.Ok(detail)
                    : Results.NotFound())
            .WithName("GetBillingWorkspace")
            .Produces<AdminWorkspaceDetail>()
            .Produces(StatusCodes.Status404NotFound);

        admin.MapGet("/price-plans", async (IPlatformBillingAdminService service, CancellationToken cancellationToken) =>
                Results.Ok(await service.ListPricePlansAsync(cancellationToken)))
            .WithName("ListPricePlans")
            .Produces<PricePlanView[]>();

        admin.MapPost("/price-plans", async (
                PublishPricePlanRequest request,
                HttpContext context,
                IAntiforgery antiforgery,
                IPlatformBillingAdminService service,
                CancellationToken cancellationToken) =>
            {
                await antiforgery.ValidateRequestAsync(context);
                return ToResult(await service.PublishPricePlanAsync(request, cancellationToken));
            })
            .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
            .WithName("PublishPricePlan")
            .Produces<PricePlanView>()
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status409Conflict);

        admin.MapPost("/invoices/issue", async (
                IssueInvoicesRequest request,
                HttpContext context,
                IAntiforgery antiforgery,
                IPlatformInvoiceRun run,
                IClock clock,
                CancellationToken cancellationToken) =>
            {
                await antiforgery.ValidateRequestAsync(context);
                var previous = BillingMonth.Containing(clock.UtcNow).Previous();
                BillingMonth month;
                if (request.PeriodStart is { } start)
                {
                    if (start.Day != 1 || start > previous.Start)
                    {
                        return Results.ValidationProblem(new Dictionary<string, string[]>
                        {
                            [nameof(IssueInvoicesRequest.PeriodStart)] = ["Choose the first day of a month that has ended."],
                        });
                    }

                    month = BillingMonth.StartingOn(start);
                }
                else
                {
                    month = previous;
                }

                return Results.Ok(await run.IssueForMonthAsync(month, cancellationToken));
            })
            .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
            .WithName("IssuePlatformInvoices")
            .Produces<InvoiceRunOutcome>()
            .ProducesValidationProblem();

        admin.MapPost("/invoices/{invoiceId:guid}/payments", async (
                Guid invoiceId,
                RecordPlatformPaymentRequest request,
                HttpContext context,
                IAntiforgery antiforgery,
                IPlatformBillingAdminService service,
                CancellationToken cancellationToken) =>
            {
                await antiforgery.ValidateRequestAsync(context);
                return ToResult(await service.RecordPaymentAsync(invoiceId, request, cancellationToken));
            })
            .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
            .WithName("RecordPlatformPayment")
            .Produces<PlatformPaymentView>()
            .Produces(StatusCodes.Status404NotFound)
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status409Conflict);

        admin.MapPost("/invoices/{invoiceId:guid}/void", async (
                Guid invoiceId,
                VoidInvoiceRequest request,
                HttpContext context,
                IAntiforgery antiforgery,
                IPlatformBillingAdminService service,
                CancellationToken cancellationToken) =>
            {
                await antiforgery.ValidateRequestAsync(context);
                return ToResult(await service.VoidInvoiceAsync(invoiceId, request, cancellationToken));
            })
            .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
            .WithName("VoidPlatformInvoice")
            .Produces<VoidInvoiceResponse>()
            .Produces(StatusCodes.Status404NotFound)
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status409Conflict);

        admin.MapPost("/workspaces/{tenantId:guid}/discounts", async (
                Guid tenantId,
                GrantDiscountRequest request,
                HttpContext context,
                IAntiforgery antiforgery,
                IPlatformBillingAdminService service,
                CancellationToken cancellationToken) =>
            {
                await antiforgery.ValidateRequestAsync(context);
                return ToResult(await service.GrantDiscountAsync(tenantId, request, cancellationToken));
            })
            .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
            .WithName("GrantWorkspaceDiscount")
            .Produces<WorkspaceDiscountView>()
            .Produces(StatusCodes.Status404NotFound)
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status409Conflict);

        admin.MapPost("/discounts/{discountId:guid}/revoke", async (
                Guid discountId,
                HttpContext context,
                IAntiforgery antiforgery,
                IPlatformBillingAdminService service,
                CancellationToken cancellationToken) =>
            {
                await antiforgery.ValidateRequestAsync(context);
                return ToResult(await service.RevokeDiscountAsync(discountId, cancellationToken));
            })
            .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
            .WithName("RevokeWorkspaceDiscount")
            .Produces<WorkspaceDiscountView>()
            .Produces(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        // Extra included clients (notes plan N11a, decision 17): granted to a founding space alone, for
        // whole calendar months, and revoked once.
        admin.MapPost("/workspaces/{tenantId:guid}/included-client-grants", async (
                Guid tenantId,
                GrantIncludedClientsRequest request,
                HttpContext context,
                IAntiforgery antiforgery,
                IPlatformBillingAdminService service,
                CancellationToken cancellationToken) =>
            {
                await antiforgery.ValidateRequestAsync(context);
                return ToResult(await service.GrantIncludedClientsAsync(tenantId, request, cancellationToken));
            })
            .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
            .WithName("GrantIncludedClients")
            .Produces<IncludedClientGrantView>()
            .Produces(StatusCodes.Status404NotFound)
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status409Conflict);

        admin.MapPost("/included-client-grants/{grantId:guid}/revoke", async (
                Guid grantId,
                HttpContext context,
                IAntiforgery antiforgery,
                IPlatformBillingAdminService service,
                CancellationToken cancellationToken) =>
            {
                await antiforgery.ValidateRequestAsync(context);
                return ToResult(await service.RevokeIncludedClientGrantAsync(grantId, cancellationToken));
            })
            .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
            .WithName("RevokeIncludedClientGrant")
            .Produces<IncludedClientGrantView>()
            .Produces(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        // Founding status (decision 15, 5 Nov 2026): marked and ended by the admin's hand only, and
        // separate from any discount.
        admin.MapPost("/workspaces/{tenantId:guid}/founding", async (
                Guid tenantId,
                MarkFoundingRequest request,
                HttpContext context,
                IAntiforgery antiforgery,
                IFoundingAdminService service,
                CancellationToken cancellationToken) =>
            {
                await antiforgery.ValidateRequestAsync(context);
                return ToResult(await service.MarkAsync(tenantId, request, cancellationToken));
            })
            .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
            .WithName("MarkWorkspaceFounding")
            .Produces<AdminFoundingView>()
            .Produces(StatusCodes.Status404NotFound)
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status409Conflict);

        admin.MapPost("/founding/{foundingId:guid}/end", async (
                Guid foundingId,
                EndFoundingRequest request,
                HttpContext context,
                IAntiforgery antiforgery,
                IFoundingAdminService service,
                CancellationToken cancellationToken) =>
            {
                await antiforgery.ValidateRequestAsync(context);
                return ToResult(await service.EndAsync(foundingId, request, cancellationToken));
            })
            .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
            .WithName("EndWorkspaceFounding")
            .Produces<AdminFoundingView>()
            .Produces(StatusCodes.Status404NotFound)
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status409Conflict);

        // The Worker checks on every sweep; this looks at once.
        admin.MapPost("/founding/check", async (
                HttpContext context,
                IAntiforgery antiforgery,
                IFoundingBadgeCheck check,
                CancellationToken cancellationToken) =>
            {
                await antiforgery.ValidateRequestAsync(context);
                return Results.Ok(await check.RunAsync(cancellationToken));
            })
            .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
            .WithName("CheckFoundingBadges")
            .Produces<FoundingCheckOutcome>();

        admin.MapGet("/founding-terms", async (IFoundingAdminService service, CancellationToken cancellationToken) =>
                Results.Ok(await service.ListTermsAsync(cancellationToken)))
            .WithName("ListFoundingTerms")
            .Produces<FoundingTermsView[]>();

        admin.MapPost("/founding-terms", async (
                PublishFoundingTermsRequest request,
                HttpContext context,
                IAntiforgery antiforgery,
                IFoundingAdminService service,
                CancellationToken cancellationToken) =>
            {
                await antiforgery.ValidateRequestAsync(context);
                return ToResult(await service.PublishTermsAsync(request, cancellationToken));
            })
            .RequireRateLimiting(RateLimitPolicies.SensitiveWrite)
            .WithName("PublishFoundingTerms")
            .Produces<FoundingTermsView>()
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status409Conflict);

        return endpoints;
    }

    private static IResult ToResult<T>(BillingCommandResult<T> result) =>
        result.Status switch
        {
            BillingCommandStatus.Success => Results.Ok(result.Value),
            BillingCommandStatus.NotFound => Results.NotFound(),
            BillingCommandStatus.Invalid => Results.ValidationProblem(
                result.Errors ?? new Dictionary<string, string[]>()),
            _ => Results.Conflict(new
            {
                code = result.Code ?? "billing_conflict",
                message = result.Message ?? "The billing record changed. Refresh and try again.",
            }),
        };
}
